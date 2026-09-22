/**
 * Build data/corpus from Wikisource into the wenyan.corpus.v1 format.
 *
 *   node tools/corpus/build.mjs [--only id1,id2] [--refresh]
 *
 * Behaviour:
 *   - every page is fetched through the on-disk cache, so re-runs resume;
 *   - the exact revision id of each page is recorded per section;
 *   - content-dropping steps (annotations, templates, files) are counted per
 *     work and reported, never silently discarded;
 *   - a work whose discovered chapter count differs from `expectedChapters`
 *     is still written but flagged, so a mismatch is visible rather than fatal.
 *
 * The manifest records what was NOT verified as well as what was: this is a
 * derived text corpus, not a critical edition, and it says so explicitly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WikiClient, DEFAULT_USER_AGENT } from './lib/client.mjs';
import { WORKS } from './works.config.mjs';
import { discoverChapters } from './lib/discover.mjs';
import {
  cleanWikitext,
  cleanInline,
  splitSections,
  splitPassages,
  dropSections,
  dropLines,
  transclusionTargets,
  sha256,
} from './lib/wikitext.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(ROOT, 'data/corpus');
const WORKS_DIR = path.join(OUT_DIR, 'works');
const CACHE_DIR = path.join(OUT_DIR, '.cache/wikisource');

const argv = process.argv.slice(2);
const only = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 ? new Set(argv[i + 1].split(',')) : null;
})();
const refresh = argv.includes('--refresh');

const client = new WikiClient({ cacheDir: CACHE_DIR, userAgent: DEFAULT_USER_AGENT });

/** License/copyright templates found on a page, e.g. {{PD-old}}, {{先秦作品}}. */
const LICENSE_TEMPLATE_RE =
  /\{\{\s*(PD-old[^|}]*|PD[^|}]*|先秦作品|曹魏作品|Cc[^|}]*|CC[^|}]*|GFDL|版權[^|}]*|Copyright[^|}]*)\s*[|}]/gi;
function scanLicenseTemplates(content, into) {
  for (const m of content.matchAll(LICENSE_TEMPLATE_RE)) {
    const name = m[1].trim();
    into[name] = (into[name] ?? 0) + 1;
  }
}

/** True when a page is mostly a transclusion container rather than text. */
function isContainer(raw) {
  const targets = transclusionTargets(raw);
  if (!targets.length) return false;
  const stripped = raw
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  return stripped.length < 200;
}

async function pageText(pageTitle, work, agg, depth = 0) {
  const rec = await client.wikitext(pageTitle, { refresh });
  if (rec.missing) return { text: '', revid: null, resolvedTitle: null, sources: [], missing: true };
  agg.licenseTemplates ??= {};
  scanLicenseTemplates(rec.content, agg.licenseTemplates);
  const sources = [{ page: rec.resolvedTitle || pageTitle, revid: rec.revid, timestamp: rec.timestamp }];
  let raw = rec.content;
  if (depth < 2 && isContainer(raw)) {
    const parts = [];
    for (const target of transclusionTargets(raw)) {
      const sub = await pageText(target, work, agg, depth + 1);
      parts.push(sub.text);
      sources.push(...sub.sources);
    }
    const joined = parts.filter(Boolean).join('\n\n');
    const cleaned = cleanWikitext(joined);
    Object.assign(agg, accumulate(agg, cleaned.stats));
    return { text: cleaned.text, revid: rec.revid, resolvedTitle: rec.resolvedTitle, sources, missing: false };
  }
  const cleaned = cleanWikitext(raw, { dropAnnotation: work.dropAnnotation });
  Object.assign(agg, accumulate(agg, cleaned.stats));
  return { text: cleaned.text, revid: rec.revid, resolvedTitle: rec.resolvedTitle, sources, missing: false };
}

/**
 * Structural markers: text in the corpus that is NOT 正文.
 *
 * DETECTED BY DECLARED FORM, NEVER BY LENGTH. A length threshold would be a
 * disaster here: 老子 has 21 passages of ≤4 characters that are genuine
 * scripture, split at commas by the source's own line breaks —
 *   生之，/ 畜之。  知常容，/ 容乃公，/ 公乃全，  曲則全，/ 枉則直，
 * Filtering "short" passages would have deleted them. Each rule below was
 * checked against the corpus for false positives before being adopted.
 */
const STRUCTURAL_MARKER_RULES = [
  {
    id: 'right-colophon',
    pattern: /^右[^\n]{0,8}$/,
    reason: '「右…」is the classical colophon 「the foregoing is …」 — a section boundary marker, not text (管子 48, 韓非子 2)',
  },
  {
    id: 'numbered-heading',
    pattern: /^[^\n]{1,4}[一二三四五六七八九十]$/,
    reason: 'a short label plus an ordinal — a section heading such as 參觀一/必罰二 in 韓非子/內儲說, not text (12)',
    maxUnits: 4,
  },
  {
    id: 'heading-after-numbered',
    pattern: /^[^\n]{2,4}$/,
    afterNumberedParagraph: true,
    reason: 'a very short paragraph directly after one beginning 「N。」 is that section\'s name, e.g. 因情/主道 in 韓非子/八經 (8)',
  },
];

/** Passages this short or shorter are FLAGGED for review, never dropped. */
const FLAG_SHORT_UNITS = 4;

function classifyStructuralMarker(text, prevText) {
  for (const rule of STRUCTURAL_MARKER_RULES) {
    if (rule.maxUnits && [...text].length > rule.maxUnits) continue;
    if (rule.afterNumberedParagraph) {
      if (!/^[一二三四五六七八九十]+。/.test(prevText ?? '')) continue;
      if (!rule.pattern.test(text)) continue;
      return rule;
    }
    if (rule.pattern.test(text)) return rule;
  }
  return null;
}

function accumulate(agg, stats) {
  const out = { ...agg };
  for (const [k, v] of Object.entries(stats)) out[k] = (out[k] ?? 0) + v;
  return out;
}

async function buildWork(work) {
  const agg = {
    annotations: 0, templates: 0, contentTemplates: 0, uncertainGlyphs: 0,
    refFootnotes: 0, unbalancedTemplates: 0, htmlTags: 0,
    files: 0, externalLinks: 0, conversionMarkers: 0,
    licenseTemplates: {},
  };
  const disc = await discoverChapters(client, work);
  const limitations = [];
  if (disc.error) limitations.push(`discovery: ${disc.error}`);
  if (!disc.chapters.length) limitations.push('discovery produced no chapters');

  const sections = [];
  const droppedReport = [];
  const skippedNoText = [];
  const droppedFrontMatter = [];
  const structuralMarkers = [];
  const flaggedShort = [];
  let droppedLines = 0;

  for (const ch of disc.chapters) {
    const pageRes = await pageText(ch.pageTitle, work, agg);
    if (pageRes.missing) { limitations.push(`missing page: ${ch.pageTitle}`); continue; }
    const { sources, revid } = pageRes;
    // Editorial prefaces (e.g. 毛詩序) are apparatus, not the classic text.
    const lineDrop = dropLines(pageRes.text, work.dropLinePatterns);
    droppedLines += lineDrop.dropped;
    const text = lineDrop.text;

    let bodies;
    if (work.discovery.kind === 'single') {
      // Headings inside the page ARE the chapters (道德經 ==一章==, 孫子兵法 ==始計第一==)
      const parts = splitSections(text);
      const isExcluded = (t) => !!t && (work.excludeSections ?? []).includes(t.trim());
      const chapters = [];
      const frontMatter = [];
      let current = null;
      for (const s of parts) {
        if (s.level === 2) {
          current = { title: s.title, body: s.body };
          chapters.push(current);
        } else if (current) {
          // deeper sub-sections belong to the current chapter
          if (s.body) current.body = `${current.body}\n\n${s.body}`.trim();
        } else if (s.body) {
          frontMatter.push(s.body); // edition front matter before the first heading
        }
      }
      if (!chapters.length) {
        // No `==` headings at all: the page IS the work (禮記/大學, 禮記/中庸).
        bodies = [{ title: work.zh, body: parts.map((s) => s.body).join('\n\n').trim() }];
      } else {
        if (frontMatter.length) droppedFrontMatter.push(ch.pageTitle);
        bodies = chapters.filter((c) => !isExcluded(c.title)).map((c) => ({ title: c.title, body: c.body }));
        const excluded = chapters.filter((c) => isExcluded(c.title)).map((c) => c.title.trim());
        if (excluded.length) droppedReport.push(...excluded.map((t) => `${ch.pageTitle}#${t}`));
      }
    } else {
      // The discovered chapter is the section; drop listed sub-sections (e.g. 註釋)
      const parts = splitSections(text);
      const { sections: kept, dropped } = dropSections(parts, work.dropSections);
      if (dropped.length) droppedReport.push(...dropped.map((d) => `${ch.pageTitle}#${d}`));
      const merged = kept.map((s) => s.body).join('\n\n').trim();
      bodies = [{ title: ch.title, body: merged }];
    }

    for (const b of bodies) {
      const title = cleanInline(b.title ?? ch.title ?? work.zh);
      const passages = b.body ? splitPassages(b.body) : [];
      if (!passages.length) {
        // e.g. the 六笙詩 pages survive only as a 毛詩序, with no 辭 to include
        skippedNoText.push(`${ch.pageTitle}${title ? `#${title}` : ''}`);
        continue;
      }
      // Structural markers are moved OUT of the base text but kept in full in
      // extraction.structuralMarkers, so nothing is lost — only relocated.
      const kept = [];
      let prevText = null;
      for (const p of passages) {
        const hit = classifyStructuralMarker(p.text, prevText);
        if (hit) {
          structuralMarkers.push({
            section: title, sourcePage: ch.pageTitle, text: p.text,
            kind: hit.id, reason: hit.reason,
          });
          prevText = p.text;
          continue;
        }
        const units = [...p.text].length;
        if (units <= FLAG_SHORT_UNITS) {
          flaggedShort.push({ section: title, sourcePage: ch.pageTitle, units, text: p.text });
        }
        kept.push(p);
        prevText = p.text;
      }
      if (!kept.length) {
        skippedNoText.push(`${ch.pageTitle}${title ? `#${title}` : ''} (all passages were structural markers)`);
        continue;
      }
      sections.push({
        id: `${work.id}.${sections.length + 1}`,
        ordinal: sections.length + 1,
        title,
        sourcePage: ch.pageTitle,
        sourceRevid: revid ?? ch.revid ?? null,
        sourcePages: sources.map((s) => s.page),
        passages: kept.map((p, i) => ({
          id: `${sections.length + 1}.${i + 1}`,
          ...(p.anchor ? { sourceAnchor: p.anchor } : {}),
          text: p.text,
        })),
      });
    }
  }

  const charCount = sections.reduce(
    (n, s) => n + s.passages.reduce((m, p) => m + [...p.text].length, 0), 0);
  const passageCount = sections.reduce((n, s) => n + s.passages.length, 0);

  if (work.expectedChapters != null && sections.length !== work.expectedChapters) {
    limitations.push(
      `chapter count ${sections.length} != expected ${work.expectedChapters}`);
  }
  if (disc.route === 'allpages') {
    limitations.push('section order is the wiki sort order, not a verified canonical order');
  }
  if (work.note) limitations.push(work.note);

  const doc = {
    schema: 'wenyan.corpus.work.v1',
    id: work.id,
    title: { zh: work.zh, en: work.en },
    tradition: work.tradition,
    ...(work.textEdition ? { textEdition: work.textEdition } : {}),
    source: {
      site: 'zh.wikisource.org',
      discovery: {
        route: disc.route,
        ...(disc.indexPage ? { indexPage: disc.indexPage, indexRevid: disc.indexRevid } : {}),
        ...(disc.startPage ? { startPage: disc.startPage } : {}),
        ...(disc.mainPage ? { mainPage: disc.mainPage, mainRevid: disc.mainRevid } : {}),
        ...(disc.prefix ? { prefix: disc.prefix, prefixMatches: disc.allCount } : {}),
        ...(disc.containers ? { containers: disc.containers } : {}),
        chainLength: disc.chainLength ?? null,
        notReachedByChain: disc.notReachedByChain ?? [],
        chainStopReason: disc.stopReason ?? null,
        chainSubstitutions: disc.substituted ?? [],
        chainExcluded: disc.excluded ?? [],
      },
    },
    counts: { sections: sections.length, passages: passageCount, characters: charCount },
    license: (() => {
      const t = { ...(agg.licenseTemplates ?? {}) };
      const pdTagged = Object.keys(t).some((k) => /^PD-old|^PD-|^先秦作品|^曹魏作品/i.test(k));
      return {
        pageTemplates: t,
        status: pdTagged
          ? `Public-domain templates present on the pages used: ${Object.keys(t).join(', ')}.`
          : 'The pages used carry no license template; the site-wide default (see manifest.source.license.siteDefault) applies.',
        basis:
          'The underlying classical works are public domain by age. What is taken from Wikisource is its ' +
          'transcription: choice of recension, modern punctuation, paragraphing and character forms. ' +
          'Attribution is recorded per section via sourcePage/sourceRevid. This build also modifies the ' +
          'material (template and commentary removal, re-segmentation), and selects recensions and ' +
          'first readings — decisions recorded in textEdition, extraction and limitations.',
      };
    })(),
    extraction: {
      removed: { ...agg },
      droppedSubsections: droppedReport,
      skippedNoText,
      droppedFrontMatter,
      droppedLines,
      structuralMarkers,
      flaggedShortPassages: flaggedShort,
      notes: 'Annotations ({{*|…}}) and site templates are removed; list/verse nesting is flattened; verse line breaks are preserved inside passage text.',
    },
    limitations,
    sections,
  };
  return doc;
}

async function main() {
  fs.mkdirSync(WORKS_DIR, { recursive: true });
  const rights = await client.api({ action: 'query', meta: 'siteinfo', siprop: 'rightsinfo|general' });
  const rightsinfo = rights?.query?.rightsinfo ?? {};
  const sitename = rights?.query?.general?.sitename ?? 'zh.wikisource';

  const entries = [];
  for (const work of WORKS) {
    if (only && !only.has(work.id)) continue;
    process.stdout.write(`[build] ${work.id} (${work.zh}) ... `);
    try {
      const doc = await buildWork(work);
      const json = JSON.stringify(doc, null, 2) + '\n';
      const file = `works/${work.id}.json`;
      fs.writeFileSync(path.join(OUT_DIR, file), json);
      entries.push({
        id: work.id,
        zh: work.zh,
        en: work.en,
        tradition: work.tradition,
        ...(work.textEdition ? { textEdition: work.textEdition } : {}),
        file,
        sha256: sha256(json),
        counts: doc.counts,
        structuralMarkersRemoved: (doc.extraction.structuralMarkers ?? []).length,
        flaggedShortPassages: (doc.extraction.flaggedShortPassages ?? []).length,
        discoveryRoute: doc.source.discovery.route,
        licenseTemplates: doc.license.pageTemplates,
        licenseStatus: doc.license.status,
        limitations: doc.limitations,
      });
      console.log(`${doc.counts.sections} sections, ${doc.counts.passages} passages, ${doc.counts.characters} chars`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      entries.push({ id: work.id, zh: work.zh, en: work.en, tradition: work.tradition,
        file: null, error: String(err.message), limitations: ['build failed'] });
    }
  }

  const manifest = {
    schema: 'wenyan.corpus.manifest.v1',
    format: 'wenyan.corpus.v1',
    generatedAt: new Date().toISOString(),
    source: {
      sitename,
      api: 'https://zh.wikisource.org/w/api.php',
      license: {
        siteDefault: rightsinfo,
        note:
          'siteDefault is the site-wide rights statement as returned live by the MediaWiki API ' +
          '(siprop=rightsinfo). It is the fallback for pages that carry no license template of their ' +
          'own. Per-work evidence of what the pages actually declare is in works[].licenseTemplates / ' +
          'licenseStatus and in each work file\'s `license` object.',
        attribution:
          'Text retrieved from Chinese Wikisource (維基文庫). Each section records its source page and ' +
          'revision id; see data/corpus/works/*.json.',
        classicsArePublicDomain:
          'The classical works themselves (論語, 老子, 詩經, …) are public domain by age; that is not in ' +
          'question. What is taken from Wikisource is its transcription — choice of recension, modern ' +
          'punctuation, paragraphing and character forms — plus this build\'s own editorial decisions ' +
          '(template/commentary removal, re-segmentation, recension selection, first-reading selection).',
      },
      attribution:
        'Text retrieved from Chinese Wikisource (維基文庫). Each section records its source page and ' +
        'revision id; see data/corpus/works/*.json.',
      ctextNotice:
        'ctext.org was NOT used. Its robots.txt and anti-scraping notice state that automated access ' +
        'is not authorized and direct researchers to subscribe; no content was retrieved from it.',
    },
    counts: {
      works: entries.filter((e) => e.file).length,
      sections: entries.reduce((n, e) => n + (e.counts?.sections ?? 0), 0),
      passages: entries.reduce((n, e) => n + (e.counts?.passages ?? 0), 0),
      characters: entries.reduce((n, e) => n + (e.counts?.characters ?? 0), 0),
    },
    works: entries,
    nonclaims: [
      'not a critical edition: no collation against manuscripts, no variant apparatus',
      'not verified against a print edition or against ctext.org',
      'punctuation and paragraphing follow the Wikisource page, not a scholarly edition',
      'text is not segmented into words, nor annotated with parts of speech or glosses',
      'no claim that every chapter of every work was retrieved where a limitation is recorded',
    ],
    limitations: [
      'Works whose section order came from the "allpages" route are in wiki sort order, not a verified canonical order.',
      'Chapter counts differing from the expected count are flagged per work rather than corrected.',
      'Editorial material present inside the base-text region of a page (if any) is retained; only whole sub-sections named in dropSections are removed.',
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('\n[stats] client', JSON.stringify(client.stats));
  console.log(`[done] ${manifest.counts.works} works, ${manifest.counts.sections} sections, ` +
    `${manifest.counts.passages} passages, ${manifest.counts.characters} characters`);
}

main().catch((err) => { console.error(err); process.exit(1); });
