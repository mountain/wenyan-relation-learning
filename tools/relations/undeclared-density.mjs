/**
 * THE SECOND METRIC: UNDECLARED-STRUCTURE DENSITY.
 *
 * Density under the CURRENT grammar turned out to point the wrong way as an acquisition rule: it
 * ranks highest the books the grammar already reads — where buying more text buys no new readings —
 * and ranks last the books where an undeclared construction is hiding. 本草綱目 reads 10 of 42,293
 * passages (0.024%) and holds the single largest unclaimed structure in the corpus.
 *
 * So each work gets a second number, measured on the SAME text:
 *
 *   density            readable passages / passages            (what the grammar already reads)
 *   undeclaredDensity  passages the DECLARED CANDIDATES would read / passages
 *                      where "candidates" are the skeletons in
 *                      knowledge/relations/operational-candidates.json — counted, NOT adopted
 *
 * The candidates are read back out of that artifact rather than re-typed here, so there is one list
 * and a change to it cannot leave this metric measuring a different thing. Their union is taken: a
 * passage matched by three skeletons counts once, because the question is how many passages become
 * readable, not how many patterns fire.
 *
 * WHAT THIS IS NOT: a candidate is a counted shape, not a frame. No span in this measurement has been
 * labelled an agent or a theme, nothing is stored, and the biggest candidate (the quote-less speech
 * frame) additionally has an UNMEASURED replacement risk — see knowledge/relations/noquote-probe.json,
 * where a span a reading does not expose made that check impossible. This ranks where to LOOK next.
 *
 *   node tools/relations/undeclared-density.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const { readReporting, emptyReportingModel, MAX_TEXT_UNITS } = createTsLoader()(
  path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const empty = emptyReportingModel();

/** Candidates come from the artifact: `pattern` is String(regex), so it is rebuilt, not duplicated. */
const artifact = read('knowledge/relations/operational-candidates.json');
const revive = (s) => {
  const i = s.lastIndexOf('/');
  return new RegExp(s.slice(1, i), s.slice(i + 1));
};
const candidates = artifact.candidateFrames.map((f) => ({ id: f.id, re: revive(f.pattern), hint: f.hint }));
/** Declared here because it is newer than the artifact: the quote-less speech frame, with its
 *  boundary rule (to the first 。／；／！？ outside brackets, or the end of the passage). */
const E = '(?:(?!曰)[^，。；：︰﹕「」『』"“”？！、]){1,10}';
candidates.push({
  id: 'yue-noquote',
  re: new RegExp(`(${E})(曰|云)[：︰﹕]([^。；！？]{1,300})`, 'g'),
  hint: '无引号言语帧 <A>曰：<S>（言语止于括号外第一个。；！？）— 候选，替换风险未测',
});

const triage = read('knowledge/corpus-expansion/practical-and-urban-triage.json');
const groupOf = new Map();
for (const [g, list] of Object.entries(triage.groups ?? {})) {
  if (Array.isArray(list)) for (const e of list) groupOf.set(e.work, g);
}

const rows = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/corpus/works'))) {
  if (!f.endsWith('.json')) continue;
  const doc = read(path.join('data/corpus/works', f));
  const zh = doc.id ?? f.replace(/\.json$/, '');
  let passages = 0;
  let readable = 0;
  let undeclared = 0;
  const perCandidate = {};
  for (const s of doc.sections ?? []) {
    for (const p of s.passages ?? []) {
      if (p.text.length > MAX_TEXT_UNITS) continue;
      passages += 1;
      let ok = false;
      try {
        const r = readReporting(p.text, empty);
        ok = r.reason !== 'ambiguous-frame-occurrence' && Boolean(r.construction);
      } catch { ok = false; }
      if (ok) { readable += 1; continue; }
      let hit = false;
      for (const c of candidates) {
        c.re.lastIndex = 0;
        if (c.re.test(p.text)) {
          perCandidate[c.id] = (perCandidate[c.id] ?? 0) + 1;
          hit = true;
        }
      }
      if (hit) undeclared += 1;
    }
  }
  if (!passages) continue;
  rows.push({
    work: zh, group: groupOf.get(zh) ?? null, passages, readable,
    density: +(readable / passages).toFixed(4),
    undeclared, undeclaredDensity: +(undeclared / passages).toFixed(4),
    perCandidate: Object.fromEntries(Object.entries(perCandidate).sort((a, b) => b[1] - a[1])),
  });
}

const byYield = [...rows].sort((a, b) => b.undeclared - a.undeclared);
const byRate = [...rows].filter((r) => r.passages >= 300).sort((a, b) => b.undeclaredDensity - a.undeclaredDensity);
const inv = [...rows].filter((r) => r.passages >= 300)
  .sort((a, b) => (a.density - a.undeclaredDensity) - (b.density - b.undeclaredDensity));

const total = rows.reduce((a, r) => a + r.passages, 0);
/**
 * WHERE TO LOOK NEXT — derived, not asserted. The works at the top of this ranking carry a genre, and
 * the triage already declares works of some of those genres that are not built yet. Those are listed
 * here mechanically. The genre classes below them are JUDGEMENT and are labelled as such: 類書 (徵引
 * 曰 everywhere), 字書/詞典 (X者，Y也 definitions — 爾雅 reads 0 of 1,092 under this grammar), 醫方,
 * 政書 (典制 — 文獻通考 is already the second-largest source of undeclared structure). None of them is
 * measured, because measuring them needs their text, and needing their text is the whole point.
 */
const topGroups = [...new Set(byYield.slice(0, 12).map((r) => r.group).filter(Boolean))];
const onDisk = new Set(rows.map((r) => r.work));
const acquire = [];
for (const g of topGroups) {
  for (const e of triage.groups?.[g] ?? []) if (!onDisk.has(e.work)) acquire.push({ work: e.work, group: g, status: e.status ?? null, chapters: e.chapters ?? null, sampledDensity: e.density?.rate ?? null });
}
const genreHypothesis = [
  { class: '政書／典制', exemplarsOnDisk: ['wenxian-tongkao'], why: '典制叙述＋徵引，第二大体量的未声明结构', measured: false },
  { class: '類書', exemplarsOnDisk: [], why: '通篇「《書》曰」「X曰」，若无引号形态占比高，与 yue-noquote 直接相干', measured: false },
  { class: '字書／詞典', exemplarsOnDisk: [], why: '爾雅 0/1092 可读，而候选骨架 X者，Y也 是全库最像词典的形状', measured: false },
  { class: '醫方／本草', exemplarsOnDisk: ['本草綱目', '黃帝內經', '傷寒論'], why: '本表第一名与第四名都在这一类', measured: false },
];

const report = {
  schema: 'wenyan.relations.undeclared-density.v1',
  generatedAt: new Date().toISOString(),
  why: 'Density under the current grammar ranks the already-read books first, which is the wrong order '
    + 'for acquisition. This measures the complement: passages the declared CANDIDATES would read.',
  candidates: candidates.map((c) => ({ id: c.id, hint: c.hint, pattern: String(c.re) })),
  scope: { works: rows.length, passages: total, readable: rows.reduce((a, r) => a + r.readable, 0) },
  perWork: rows,
  ranking: {
    byAbsoluteYield: byYield.slice(0, 15).map((r) => ({ work: r.work, undeclared: r.undeclared, of: r.passages, rate: r.undeclaredDensity })),
    byRateMin300Passages: byRate.slice(0, 15).map((r) => ({ work: r.work, rate: r.undeclaredDensity, undeclared: r.undeclared, density: r.density })),
    gapDensity: inv.slice(0, 15).map((r) => ({ work: r.work, gap: +(r.undeclaredDensity - r.density).toFixed(4), density: r.density, undeclaredDensity: r.undeclaredDensity })),
  },
  nextBatch: {
    derivedFrom: '作品在盘上、且属 triage 已声明组、且尚未建',
    sameGroupNotBuilt: acquire,
    genreHypothesis,
  },
  nonClaims: [
    'A candidate is a counted shape, not a frame: nothing here is labelled, stored or licensed.',
    'Skeletons overlap and are NOT deduplicated into a total that could be summed: the union per work is reported, the per-candidate counts are not additive.',
    'The biggest candidate (yue-noquote) has an UNMEASURED replacement risk because a reading does not expose its span; a large yield is not yet a gain.',
    'Works not on disk cannot be ranked at all by this metric — for those, genre is a proxy and a weak one.',
    'BLIND SPOT, and it is structural: the derivation can only reach a group that has at least one built exemplar. spanning-antiquity (通典, 資治通鑑, 通鑑紀事本末, 日知錄, 廿二史劄記) has NOTHING built, so it is invisible here even though 通鑑紀事本末 sampled at 41.4% under the older grammar. 通典 is a 政書 like 文獻通考, which is second in this ranking — that inference is made in the genre hypothesis, not in the derived list, and the two must not be confused.', 
  ],
};
report.reading = '按绝对产出排，本草綱目一部占了大头；按比率排（≥300 段）才是「这部书有多少比例是我们还读不懂的」。'
  + '两列都要看：比率高但体量小的书，绝对增量有限；体量大又比率高的，才是下一批优先。';

console.log(`[undeclared] ${rows.length} work(s), ${total} passages, readable ${report.scope.readable} (${(report.scope.readable / total * 100).toFixed(2)}%)`);
console.log('\n  按绝对产出（未读中候选帧可读的段数）:');
for (const r of byYield.slice(0, 12)) {
  console.log(`    ${String(r.undeclared).padStart(6)} 段  ${(r.undeclaredDensity * 100).toFixed(1).padStart(5)}%  `
    + `已读 ${(r.density * 100).toFixed(2).padStart(6)}%  ${r.work}`);
}
console.log('\n  按比率（≥300 段）:');
for (const r of byRate.slice(0, 10)) {
  console.log(`    ${(r.undeclaredDensity * 100).toFixed(1).padStart(5)}%  未读段 ${String(r.undeclared).padStart(6)}  已读 ${(r.density * 100).toFixed(2).padStart(6)}%  ${r.work}`);
}
console.log('\n  最大落差（未声明结构比率 − 已读比率）:');
for (const r of inv.slice(0, 8)) {
  console.log(`    +${((r.undeclaredDensity - r.density) * 100).toFixed(1).padStart(5)}%  ${r.work}`);
}
console.log('\n  同组未建（按上表前 12 名所属组推导，不是手写）:');
for (const a of acquire.slice(0, 12)) console.log(`    ${a.work}  [${a.group}] ${a.chapters ?? '?'}章 ${a.sampledDensity !== null ? '抽样密度 ' + (a.sampledDensity * 100).toFixed(1) + '%（旧语法，过时）' : ''}`);
console.log('\n  体裁假说（判断，未测量）: ' + genreHypothesis.map((g) => g.class).join('、'));

if (argv.includes('--write')) {
  const out = path.join(ROOT, 'knowledge/relations/undeclared-density.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[written] ${path.relative(ROOT, out)}`);
}
