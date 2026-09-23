/**
 * Propose a discovery route for each work on a portal, so a batch can be declared
 * without hand-inspecting every work.
 *
 *   node tools/corpus/resolve-routes.mjs --works A,B,C [--write]
 *
 * WHY THIS EXISTS
 * The hand-curated method does not scale: for 15 canonical works an automatic
 * resolver settled only 6, and two of those were WRONG (春秋 is a hub page and
 * 孝經 a {{versions}} disambiguation page, both misread as single-page works).
 * So this tool does not decide — it proposes, records WHY, and leaves anything
 * it cannot settle as "needs manual" with the reason. Nothing is silently
 * skipped and no route is guessed.
 *
 * Routes tried, in order:
 *   index        <work>/全覽 exists and yields >= 3 chapters
 *   mainPageLinks the work's main page carries an ordered link list (>= 3)
 *   single        0 subpages and a substantial main page (not a versions page)
 *   nextChain     a next= chain of >= 3 starting from the first volume found
 *   allpages      falls back to enumerating the prefix, with a numeric sort key
 *                 derived from volume names (卷一二三… included), and says so
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WikiClient } from './lib/client.mjs';
import * as D from './lib/discover.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const works = (flag('works') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!works.length) {
  console.error('usage: resolve-routes.mjs --works 搜神記,異苑,… [--write]');
  process.exit(2);
}

const client = new WikiClient({ cacheDir: path.join(ROOT, 'data/corpus/.cache/wikisource') });

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 兩: 2 };
const CN_UNITS = { 十: 10, 百: 100, 千: 1000 };

/** 卷一百七十七 -> 177 ; 卷01 -> 1 ; 卷三 -> 3 ; text with no numeral -> null */
export function volumeSortKey(name) {
  const m = name.match(/[卷卷]?\s*([0-9]+|[零一二三四五六七八九十百千兩]+)/);
  if (!m) return null;
  const t = m[1];
  if (/^[0-9]+$/.test(t)) return Number(t);
  let total = 0;
  let section = 0;
  for (const ch of t) {
    if (ch in CN_DIGITS) { section = CN_DIGITS[ch]; continue; }
    const unit = CN_UNITS[ch];
    if (unit) { total += (section || 1) * unit; section = 0; continue; }
    return null;
  }
  return total + section;
}

const results = [];
for (const zh of works) {
  const entry = { zh, route: null, chapters: 0, note: '', stopReason: null, sample: [] };
  try {
    const main = await client.wikitext(zh);
    if (main.missing) { entry.route = 'MISSING'; entry.note = 'main page does not exist'; results.push(entry); continue; }
    const subs = await client.allpages(zh + '/');
    entry.subpages = subs.length;
    entry.mainBytes = main.size;
    entry.isVersionsPage = /\{\{\s*versions/i.test(main.content);
    entry.licenseTags = [...new Set([...main.content.matchAll(
      /\{\{\s*(PD-old[^|}]*|PD[^|}]*|[東西南北]?[漢唐宋元明清秦周魏晉隋]朝?作品|Cc[^|}]*|GFDL|版權[^|}]*)\s*[|}]/gi)].map((x) => x[1].trim()))];

    // 1) index
    const idx = await D.discoverByIndex(client, zh + '/全覽').catch(() => ({ chapters: [] }));
    if (idx.chapters?.length >= 3) {
      entry.route = 'index'; entry.chapters = idx.chapters.length;
      entry.index = zh + '/全覽';
      entry.sample = idx.chapters.slice(0, 3).map((c) => c.title);
      results.push(entry); continue;
    }
    // 2) main-page links — and VERIFY that the linked pages exist. 聊齋誌異's
    // table of contents pointed at 聊齋誌異/第01卷… while the real pages live
    // under its redirect target 聊齋志異, so the proposal was a silent empty build.
    const mpl = await D.discoverByMainPageLinks(client, zh, { zh }).catch(() => ({ chapters: [] }));
    if (mpl.chapters?.length >= 3) {
      const probe = await client.exists(mpl.chapters.slice(0, 5).map((c) => c.pageTitle));
      if (probe.missing.length) {
        entry.route = 'NEEDS-MANUAL';
        entry.note = `main-page links point at ${probe.missing.length}/5 non-existent page(s), e.g. ${probe.missing[0]}`;
        results.push(entry); continue;
      }
      entry.route = 'mainPageLinks'; entry.chapters = mpl.chapters.length;
      entry.mainPage = zh;
      entry.mainPageResolved = mpl.mainPageResolved ?? zh;
      entry.sample = mpl.chapters.slice(0, 3).map((c) => c.title);
      results.push(entry); continue;
    }
    // 3) single page
    if (subs.length === 0 && main.size >= 1500 && !entry.isVersionsPage) {
      entry.route = 'single'; entry.chapters = 1;
      entry.sample = [...main.content.matchAll(/^==\s*([^=]+?)\s*==\s*$/gm)].map((m) => m[1]).slice(0, 3);
      entry.note = 'no subpages; treated as a single page split at == headings';
      results.push(entry); continue;
    }
    // 4) next-chain from the first volume-like subpage
    if (subs.length) {
      const first = [...subs].sort((a, b) => (volumeSortKey(a) ?? 1e9) - (volumeSortKey(b) ?? 1e9))[0];
      const chain = await D.discoverByNextChain(client, first, { stopPrefix: zh + '/' }).catch(() => ({ chapters: [] }));
      if (chain.chapters?.length >= 3) {
        entry.route = 'nextChain'; entry.chapters = chain.chapters.length;
        entry.startPage = first; entry.stopReason = chain.stopReason ?? null;
        entry.sample = chain.chapters.slice(0, 3).map((c) => c.title);
        results.push(entry); continue;
      }
      // 5) allpages with numeric sort
      const withKeys = subs.map((s) => ({ s, k: volumeSortKey(s) })).filter((x) => x.k !== null);
      if (withKeys.length >= 3) {
        entry.route = 'allpages(numbered)'; entry.chapters = withKeys.length;
        // A numbered-key filter can silently keep only a SUBSET of the subpages
        // (楚辭: 5 of 14 — the rest are named 離騷, 九歌 … with no numeral). Say so.
        const excluded = subs.length - withKeys.length;
        entry.subpagesTotal = subs.length;
        entry.excludedSubpages = excluded;
        entry.note = `ordered by a numeric key read from the page name; NOT verified against a table of contents`
          + (excluded ? `; WARNING: excludes ${excluded} of ${subs.length} subpage(s) that carry no numeral` : '');
        entry.sample = withKeys.slice(0, 3).map((x) => x.s);
        results.push(entry); continue;
      }
    }
    // nothing settled
    entry.route = 'NEEDS-MANUAL';
    entry.note = entry.isVersionsPage
      ? 'main page is a {{versions}} disambiguation page: a recension must be chosen explicitly'
      : subs.length ? `has ${subs.length} subpage(s) but no index, no ordered link list, and no usable chain`
        : 'no subpages and the main page is too small to be a text (likely a disambiguation page)';
    results.push(entry);
  } catch (e) {
    entry.route = 'ERROR'; entry.note = e.message; results.push(entry);
  }
}

// VERIFY the single/nextChain proposals too: a route whose target does not exist
// is not a proposal, it is an empty build waiting to happen.
for (const r of results) {
  const target = r.route === 'single' ? r.zh
    : r.route === 'nextChain' ? r.startPage
      : null;
  if (!target) continue;
  const { missing } = await client.exists([target]);
  if (missing.length) {
    r.route = 'NEEDS-MANUAL';
    r.note = `proposed target does not exist: ${missing[0]}`;
  }
}

const usable = results.filter((r) => !['NEEDS-MANUAL', 'MISSING', 'ERROR'].includes(r.route));
console.log(`作品          路由                 章节   授权标签              备注`);
for (const r of results) {
  console.log(`${r.zh.padEnd(12)}${String(r.route).padEnd(21)}${String(r.chapters).padEnd(7)}` +
    `${(r.licenseTags?.join(',') || '⚠ 无').padEnd(21)}${r.excludedSubpages ? `[取 ${r.chapters}/${r.subpagesTotal}] ` : ''}${r.note ? r.note.slice(0, 40) : ''}`);
}
console.log(`\n可自动解析 ${usable.length}/${results.length}；需人工 ${results.filter((r) => r.route === 'NEEDS-MANUAL').length}；` +
  `缺失 ${results.filter((r) => r.route === 'MISSING').length}`);

if (argv.includes('--write')) {
  const out = path.join(ROOT, 'knowledge/corpus-expansion/resolved-routes.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    schema: 'wenyan.corpus.route-proposal.v1',
    generatedAt: new Date().toISOString(),
    note: 'Proposals, not decisions. NEEDS-MANUAL entries state why they were not settled.',
    results,
  }, null, 2) + '\n');
  console.log(`[written] ${path.relative(ROOT, out)}`);
}
