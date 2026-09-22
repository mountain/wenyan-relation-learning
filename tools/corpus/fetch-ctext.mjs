/**
 * CTP (ctext.org) ingestion layer — the sanctioned, subscription-only route.
 *
 *   CTEXT_API_KEY=... node tools/corpus/fetch-ctext.mjs --check
 *   CTEXT_API_KEY=... node tools/corpus/fetch-ctext.mjs --probe
 *   CTEXT_API_KEY=... node tools/corpus/fetch-ctext.mjs
 *
 * The URN table below is a list of CANDIDATES, not verified fact: CTP's URN
 * scheme could not be confirmed without legitimate API access, and this tool
 * refuses to guess. Run `--probe` first; it resolves each candidate against the
 * API, writes data/corpus-ctext/urn-map.json, and only that verified map is
 * used for a build. Nothing here touches the ctext.org website, and no
 * unauthenticated or bypass route is attempted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CtextClient, CtextAuthError } from './lib/ctext.mjs';
import { WORKS } from './works.config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(ROOT, 'data/corpus-ctext');
const URN_MAP = path.join(OUT_DIR, 'urn-map.json');

/** Candidate URN prefixes per work. UNVERIFIED — resolved by --probe. */
export const URN_CANDIDATES = {
  analects: ['ctp:analects'],
  mencius: ['ctp:mencius'],
  'great-learning': ['ctp:great-learning', 'ctp:liji/great-learning', 'ctp:da-xue'],
  'doctrine-of-the-mean': ['ctp:doctrine-of-the-mean', 'ctp:liji/zhong-yong', 'ctp:zhong-yong'],
  'classic-of-poetry': ['ctp:book-of-poetry', 'ctp:shijing', 'ctp:classic-of-poetry'],
  'book-of-documents': ['ctp:book-of-documents', 'ctp:shangshu'],
  zhouyi: ['ctp:zhouyi', 'ctp:book-of-changes', 'ctp:yijing'],
  'book-of-rites': ['ctp:liji', 'ctp:book-of-rites'],
  laozi: ['ctp:laozi', 'ctp:dao-de-jing'],
  zhuangzi: ['ctp:zhuangzi'],
  xunzi: ['ctp:xunzi'],
  hanfeizi: ['ctp:hanfeizi'],
  mozi: ['ctp:mozi'],
  guanzi: ['ctp:guanzi'],
  liezi: ['ctp:liezi'],
  sunzi: ['ctp:art-of-war', 'ctp:sunzi', 'ctp:sun-tzu'],
};

function refuse(err) {
  console.error(`\n[refused] ${err.message}\n`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--check') ? 'check'
    : argv.includes('--probe') ? 'probe'
    : 'build';

  const client = new CtextClient({ cacheDir: path.join(OUT_DIR, '.cache') });

  if (!client.hasCredential) {
    refuse(new CtextAuthError(
      'No CTP credential configured.\n\n' +
      'ctext.org authorizes API access only through a subscription ' +
      '(https://ctext.org/tools/subscribe), which gives you an API key or a ' +
      'registered IP. Set CTEXT_API_KEY before running, e.g.\n' +
      '    CTEXT_API_KEY=your-key node tools/corpus/fetch-ctext.mjs --check\n' +
      'For a registered-IP proxy, set CTEXT_API_URL instead.\n\n' +
      'The ctext.org website is NOT scraped by this tool and will not be: its ' +
      'robots.txt and anti-scraping notice state that automated access is not ' +
      'authorized. The Wikisource corpus (data/corpus) is the source used by ' +
      'default and does not require any credential.'));
  }

  try {
    if (mode === 'check') {
      const r = await client.checkAccess();
      console.log(`[ctext] credential accepted; probe ${r.probeUrn} -> ${r.title}`);
      return;
    }

    if (mode === 'probe') {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const resolved = {};
      const unresolved = [];
      for (const work of WORKS) {
        const candidates = URN_CANDIDATES[work.id] ?? [];
        let found = null;
        for (const urn of candidates) {
          try {
            const info = await client.getTextInfo(urn);
            found = { urn, title: info?.title ?? null };
            break;
          } catch (err) {
            if (err instanceof CtextAuthError && /AUTH/i.test(err.message)) refuse(err);
          }
        }
        if (found) {
          resolved[work.id] = found;
          console.log(`[probe] ${work.id.padEnd(22)} -> ${found.urn}  (${found.title ?? '?'})`);
        } else {
          unresolved.push({ id: work.id, zh: work.zh, tried: candidates });
          console.log(`[probe] ${work.id.padEnd(22)} -> UNRESOLVED (tried: ${candidates.join(', ') || 'none'})`);
        }
      }
      fs.writeFileSync(URN_MAP, JSON.stringify({
        schema: 'wenyan.corpus.ctext-urn-map.v1',
        generatedAt: new Date().toISOString(),
        note: 'URNs resolved against the CTP API with a valid credential. Only these are used for a build.',
        resolved,
        unresolved,
      }, null, 2) + '\n');
      console.log(`\n[probe] wrote ${path.relative(ROOT, URN_MAP)} (${Object.keys(resolved).length}/${WORKS.length} resolved)`);
      if (unresolved.length) {
        console.log('[probe] unresolved works need their real URNs added to URN_CANDIDATES, then re-probe.');
      }
      return;
    }

    // build
    if (!fs.existsSync(URN_MAP)) {
      refuse(new Error(`no verified URN map at ${path.relative(ROOT, URN_MAP)}; run --probe first`));
    }
    const map = JSON.parse(fs.readFileSync(URN_MAP, 'utf8'));
    fs.mkdirSync(path.join(OUT_DIR, 'works'), { recursive: true });
    const entries = [];
    for (const work of WORKS) {
      const hit = map.resolved?.[work.id];
      if (!hit) {
        console.log(`[ctext] ${work.id.padEnd(22)} SKIP (no verified URN)`);
        entries.push({ id: work.id, zh: work.zh, skipped: 'no verified URN' });
        continue;
      }
      try {
        const info = await client.getTextInfo(hit.urn);
        const subs = (info?.subsections ?? []).map((s) => s.urn).filter(Boolean);
        const sections = [];
        let ordinal = 0;
        const urns = subs.length ? subs : [hit.urn];
        for (const urn of urns) {
          ordinal++;
          const t = await client.getText(urn);
          const passages = (t.fulltext ?? []).map((x, i) => ({ id: `${ordinal}.${i + 1}`, text: x }));
          if (!passages.length) continue;
          sections.push({
            id: `${work.id}.${sections.length + 1}`,
            ordinal: sections.length + 1,
            title: t.title ?? urn,
            sourceUrn: urn,
            passages: passages.map((p, i) => ({ ...p, id: `${sections.length + 1}.${i + 1}` })),
          });
        }
        const characters = sections.reduce((n, s) => n + s.passages.reduce((m, p) => m + [...p.text].length, 0), 0);
        const doc = {
          schema: 'wenyan.corpus.work.v1',
          id: work.id,
          title: { zh: work.zh, en: work.en },
          tradition: work.tradition,
          source: { site: 'ctext.org', api: 'https://api.ctext.org', urnRoot: hit.urn },
          counts: { sections: sections.length, passages: sections.reduce((n, s) => n + s.passages.length, 0), characters },
          sections,
        };
        const file = `works/${work.id}.json`;
        fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(doc, null, 2) + '\n');
        entries.push({ id: work.id, zh: work.zh, urnRoot: hit.urn, file, counts: doc.counts });
        console.log(`[ctext] ${work.id.padEnd(22)} ${doc.counts.sections} sections, ${doc.counts.passages} passages`);
      } catch (err) {
        if (err instanceof CtextAuthError) refuse(err);
        console.log(`[ctext] ${work.id.padEnd(22)} FAILED: ${err.message}`);
        entries.push({ id: work.id, zh: work.zh, error: err.message });
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      schema: 'wenyan.corpus.manifest.v1',
      format: 'wenyan.corpus.v1',
      generatedAt: new Date().toISOString(),
      source: {
        sitename: 'Chinese Text Project (ctext.org)',
        api: 'https://api.ctext.org',
        access: 'subscription API key / registered IP; see https://ctext.org/tools/subscribe',
        license: 'Per CTP terms of use for subscribed API access; verify before redistribution.',
      },
      counts: {
        works: entries.filter((e) => e.file).length,
        sections: entries.reduce((n, e) => n + (e.counts?.sections ?? 0), 0),
        passages: entries.reduce((n, e) => n + (e.counts?.passages ?? 0), 0),
        characters: entries.reduce((n, e) => n + (e.counts?.characters ?? 0), 0),
      },
      works: entries,
      note: 'Built through the sanctioned CTP API. Kept separate from data/corpus (Wikisource) so the two sources can be compared rather than merged.',
    }, null, 2) + '\n');
    console.log(`\n[ctext] wrote ${path.relative(ROOT, path.join(OUT_DIR, 'manifest.json'))}`);
  } catch (err) {
    if (err instanceof CtextAuthError) refuse(err);
    throw err;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
