/**
 * WHAT OPERATIONAL TEXT IS ACTUALLY MADE OF.
 *
 * tools/grammar/density.mjs measured the hypothesis and contradicted it: 天工開物 reads at 0.67%
 * (3/449 passages) while the corpus reads at 23.81%. The reason is structural — the reporting
 * grammar is a SPEECH-REPORT grammar (A曰：「S」) and a manual reports no speech. 夢溪筆談 beats the
 * baseline only because it is anecdote.
 *
 * So the question is no longer "download more technical books" but "which structure do they share".
 * This tool answers it from the text, in two independent ways, on the passages the current grammar
 * does NOT read — the same discipline as tools/relations/discover-frames.mjs, applied to a different
 * kind of book:
 *
 *   1. RAW N-GRAMS, no theory: what character sequences actually recur. If 凡…者 is the backbone of
 *      procedure, it shows up here without anyone proposing it first.
 *   2. DECLARED OPERATIONAL SKELETONS: a short list of candidate frames, each counted with the
 *      number of passages it would make readable. That number — not plausibility — is what decides
 *      whether a frame is worth declaring, and it is reported even when it is ZERO. 上曰-style
 *      candidates were proposed on intuition before and measured 0; recording that is cheaper than
 *      arguing about it later.
 *
 * What this tool does NOT do: declare a frame. A frame is a claim that a span is an agent, a theme
 * or a result, and that claim has to be stateable truthfully before anything is stored. Candidates
 * here are counted, not adopted.
 *
 *   node tools/relations/discover-operational.mjs [--write]
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
const readable = (t) => {
  try {
    const r = readReporting(t, empty);
    return r.reason !== 'ambiguous-frame-occurrence' && Boolean(r.construction);
  } catch { return false; }
};

// Which works count as operational? Declared, from the expansion triage, not guessed here.
const triage = read('knowledge/corpus-expansion/practical-and-urban-triage.json');
const declared = new Map();
for (const [group, list] of Object.entries(triage.groups ?? {})) {
  if (!Array.isArray(list)) continue;
  for (const e of list) declared.set(e.work, group);
}

const dir = path.join(ROOT, 'data/corpus/works');
const manifest = read('data/corpus/manifest.json');
const zhOf = new Map(manifest.works.map((w) => [w.id, w.zh ?? w.id]));

const unread = [];
const perWork = {};
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const id = doc.id ?? f.replace(/\.json$/, '');
  const zh = zhOf.get(id) ?? id;
  const group = declared.get(zh);
  if (!group) continue;                       // only the declared expansion groups
  const row = perWork[zh] ?? (perWork[zh] = { group, passages: 0, read: 0 });
  for (const s of doc.sections ?? []) {
    for (const p of s.passages ?? []) {
      if (p.text.length > MAX_TEXT_UNITS) continue;
      row.passages += 1;
      if (readable(p.text)) { row.read += 1; continue; }
      unread.push({ zh, group, text: p.text, section: s.id, passageId: p.id });
    }
  }
}

// ---------------------------------------------------------------- 1. raw n-grams
const PUNCT = /[\s，。；：、！？「」『』（）()《》〈〉·—…"'']/;
const ngram = new Map();
for (const p of unread) {
  const t = p.text;
  for (let n = 2; n <= 8; n += 1) {
    for (let i = 0; i + n <= t.length; i += 1) {
      const g = t.slice(i, i + n);
      if (PUNCT.test(g)) continue;
      ngram.set(g, (ngram.get(g) ?? 0) + 1);
    }
  }
}
// Keep only grams that are not contained in a longer, equally frequent gram — otherwise 凡X者 is
// hidden under 凡X者Y and every list reads as noise.
const grams = [...ngram.entries()].filter(([, c]) => c >= 8).sort((a, b) => b[1] - a[1]);
const top = [];
for (const [g, c] of grams) {
  if (top.some(([t2, c2]) => t2.includes(g) && c2 >= c * 0.9)) continue;
  top.push([g, c]);
  if (top.length >= 40) break;
}

// ------------------------------------------------- 2. declared operational skeletons
/** Each candidate: a pattern, the roles it would state, and the reason it might be a frame. */
const CANDIDATES = [
  { id: 'fan-zhe', re: /凡([^，。；：]{1,24})者/g, roles: ['theme'], hint: '凡X者 — the classical conditional' },
  { id: 'fan-jie', re: /凡([^，。；：]{1,24})(皆|俱|並|盡)/g, roles: ['theme'], hint: '凡X皆Y — universal procedure' },
  { id: 'zhe-ye', re: /([^，。；：]{1,16})者[，、]([^，。；：]{1,24})也/g, roles: ['theme', 'definition'], hint: 'X者，Y也 — definition' },
  { id: 'yi-wei', re: /以([^，。；：]{1,16})為([^，。；：]{1,16})/g, roles: ['theme', 'result'], hint: '以X為Y — operation on a material' },
  { id: 'yi-yue', re: /一曰([^，。；：]{1,20})/g, roles: ['definition'], hint: '一曰X — alternate name' },
  { id: 'ruo-ze', re: /若([^，。；：]{1,16})[，、]?則([^，。；：]{1,20})/g, roles: ['condition', 'result'], hint: '若X則Y — conditional procedure' },
  { id: 'qi-fa', re: /其法([^。]{1,40})/g, roles: ['theme'], hint: '其法… — the recipe' },
  { id: 'shao-zhi', re: /(少|多|久|細|熟)([^，。；：]{0,6})(之|而)/g, roles: ['theme'], hint: 'verb-object modifiers' },
  { id: 'ri-yong-shu', re: /(每|各)([^，。；：]{1,12})(一|二|三|四|五|六|七|八|九|十|百|千|萬)/g, roles: ['theme'], hint: '每X一Y — quantity. WEAKEST candidate in the list: the example it returns (每行廣步而從十六) shows the pattern matching a quantity word 十 inside an ordinary measurement sentence, not the shape the hint describes. High count, low meaning — kept and labelled rather than dropped, because the count is what a reader would otherwise trust.' },
  { id: 'shang-yue', re: /上曰/g, roles: [], hint: 'CONTROL, and it FAILED as a control: on this slice 上曰 occurs 13 times, not 0. The earlier zero was measured on a different slice (the 77-work manifest corpus) and does not transfer to a slice that now includes 資治通鑑-style narrative. A control that is not re-measured on the slice it is quoted in is not a control.' },
];
const found = [];
for (const c of CANDIDATES) {
  const hits = [];
  const matchedPassages = new Set();
  for (const p of unread) {
    const m = [...p.text.matchAll(c.re)];
    if (!m.length) continue;
    matchedPassages.add(p.text);
    if (hits.length < 3) hits.push({ text: p.text, match: m[0][0], zh: p.zh, at: `${p.section}#${p.passageId}` });
  }
  found.push({
    id: c.id, pattern: String(c.re), roles: c.roles, hint: c.hint,
    occurrences: unread.reduce((n, p) => n + [...p.text.matchAll(c.re)].length, 0),
    passagesMatched: matchedPassages.size,
    shareOfUnread: unread.length ? +(matchedPassages.size / unread.length).toFixed(4) : 0,
    examples: hits,
  });
}
found.sort((a, b) => b.passagesMatched - a.passagesMatched);

const report = {
  schema: 'wenyan.relations.operational-candidates.v1',
  generatedAt: new Date().toISOString(),
  why: 'The practical/technical expansion was justified by a density hypothesis that measurement '
    + 'contradicted (天工開物 0.67%). The structure these books share is therefore looked for in the '
    + 'text rather than assumed: raw n-grams, plus a declared candidate list counted honestly.',
  scope: {
    groups: ['practical-technology', 'urban-and-market'],
    worksIncluded: Object.fromEntries(Object.entries(perWork).map(([k, v]) => [k, v])),
    unreadPassages: unread.length,
    note: 'Only works present on disk and declared in the expansion triage; the manifest lags the '
      + 'background build, so this slice grows as more works are built.',
  },
  rawNgrams: top.map(([gram, count]) => ({ gram, count })),
  candidateFrames: found,
  nonClaims: [
    'A candidate is a counted pattern, NOT an adopted frame: no span here has been labelled as an agent or a theme.',
    'The counts are for the passages the current grammar does NOT read, so a high count means "this shape is common where we are blind", not "this shape is common in the corpus".',
    'Overlapping candidates are not deduplicated: 凡…者 and 凡…皆 can match the same passage, so their counts must not be added.',
  ],
};

console.log(`[operational] slice: ${Object.keys(perWork).length} work(s), ${unread.length} UNREAD passage(s)`);
for (const [zh, v] of Object.entries(perWork)) {
  console.log(`    ${zh.padEnd(10)} ${v.read}/${v.passages} readable  [${v.group}]`);
}
console.log('\n  raw n-grams (top 20, punctuation-free, not contained in a longer equally-frequent gram):');
for (const [g, c] of top.slice(0, 20)) console.log(`    ${String(c).padStart(5)}  ${g}`);
console.log('\n  declared candidate skeletons (on the UNREAD slice):');
for (const f of found) {
  console.log(`    ${String(f.passagesMatched).padStart(4)} passage(s) ${(f.shareOfUnread * 100).toFixed(1).padStart(5)}%  `
    + `${String(f.occurrences).padStart(5)} hit(s)  ${f.id.padEnd(11)} ${f.hint}`);
}
const ex = found.find((f) => f.passagesMatched > 0 && f.examples.length);
if (ex) console.log(`\n  e.g. ${ex.id}: ${ex.examples[0].match}  ← ${ex.examples[0].zh} ${ex.examples[0].at}`);

if (argv.includes('--write')) {
  const out = path.join(ROOT, 'knowledge/relations/operational-candidates.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[written] ${path.relative(ROOT, out)}`);
}
