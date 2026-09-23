/**
 * SHAPE MEASUREMENT FOR THE 「标记＋陈述」 FAMILY (label + statement).
 *
 * Evidence for the family, gathered so far: 易 「初九：潛龍勿用」, 太玄 「初一：昆侖磅礴。幽。測曰：…」,
 * 本草綱目 「【主治】…」, 營造法式 制度條目, 唐國史補 「謂之「鄉葬」」「尤勝蜀者」. Five genres, one shape:
 * a MARKER, then a statement that is a judgement, definition or evaluation rather than reported speech.
 *
 * 唐國史補 forced this: 89% of its 190 unread passages contain no speech verb at all, so the failures the
 * grammar has been accumulating (delimiters, colons, entity spans, quote-less speech) are not what is
 * missing there. What is missing is a construction family that does not report speech.
 *
 * This probe does NOT declare anything. For each marker class it measures, on the unread passages, how much
 * would become readable; on the already-readable passages, how many existing readings the candidate span
 * would CONTAIN and therefore SUPERSEDE under the declared containment precedence; and — because a pattern
 * concentrated in one work is that work's property rather than a language's — how DISPERSED the gain is
 * across works. Dispersion is reported with the same prominence as the total, per the corpus-linguistic
 * lesson that raw counts hide spikiness.
 *
 * Boundary rule, stated because an unstated boundary is not a rule: the statement runs from the marker to
 * the first 。／；／！？ outside 「」『』（）, or to the end of the passage; rejected if empty or over 300 chars.
 *
 *   node tools/relations/probe-labeled-statement.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const { readReporting, emptyReportingModel, MAX_TEXT_UNITS } = createTsLoader()(
  path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const empty = emptyReportingModel();

const TAIL = '[^。；！？]{1,300}';
const CLASSES = [
  { id: 'position', why: '爻位/贊次：易與太玄的位置標記', re: new RegExp(`((初|次|上)[一二三四五六七八九]|[九六][一二三四五])[：︰﹕]${TAIL}`, 'g') },
  { id: 'ganzhi', why: '干支紀日：史料體的日期標記', re: new RegExp(`[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥][^。；！？]{0,40}`, 'g') },
  { id: 'naming', why: '命名與定義：謂之X／名曰X／一曰X', re: new RegExp(`(謂之|謂曰|名曰|號曰|是為|一曰|亦曰)[「『"“]?[^，。；：]{1,12}${TAIL}`, 'g') },
  { id: 'bracket', why: '方括號標簽：本草綱目的【主治】式', re: new RegExp(`【[^】]{1,8}】${TAIL}`, 'g') },
  { id: 'grade', why: '品第：上上／中中／下下，第X', re: new RegExp(`(上上|上中|上下|中上|中中|中下|下上|下中|下下)(品|第)?${TAIL}`, 'g') },
];

const rows = [];
const dir = path.join(ROOT, 'data/corpus/works');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const id = doc.id ?? f.replace(/\.json$/, '');
  for (const s of doc.sections ?? []) {
    for (const p of s.passages ?? []) {
      if (p.text.length > MAX_TEXT_UNITS) continue;
      rows.push({ id, text: p.text });
    }
  }
}

const out = [];
for (const c of CLASSES) {
  let gain = 0;
  let superseded = 0;
  let partial = 0;
  let readableHit = 0;
  const gainByWork = new Map();
  const examples = [];
  for (const r of rows) {
    c.re.lastIndex = 0;
    const m = c.re.exec(r.text);
    let cur = null;
    try { cur = readReporting(r.text, empty); } catch { cur = null; }
    const readable = cur && cur.reason !== 'ambiguous-frame-occurrence' && cur.construction;
    if (!m) { if (readable) readableHit += 1; continue; }
    const spanStart = m.index;
    const spanEnd = spanStart + m[0].length;
    if (!readable) {
      gain += 1;
      gainByWork.set(r.id, (gainByWork.get(r.id) ?? 0) + 1);
      if (examples.length < 3) examples.push({ work: r.id, match: m[0].slice(0, 46), text: r.text.slice(0, 60) });
    } else {
      const cs = cur.spanStart;
      const ce = cur.spanEnd;
      if (cs !== undefined && cs >= spanStart && ce <= spanEnd) superseded += 1;
      else if (cs !== undefined && spanStart < ce && cs < spanEnd) partial += 1;
    }
  }
  const byWork = [...gainByWork].sort((a, b) => b[1] - a[1]);
  const top3 = byWork.slice(0, 3).reduce((a, [, v]) => a + v, 0);
  out.push({
    id: c.id, why: c.why, pattern: String(c.re),
    gain, superseded, partialOverlap: partial,
    dispersion: {
      worksContributing: byWork.length,
      top3Works: byWork.slice(0, 3).map(([w, v]) => `${w}:${v}`),
      top3Share: gain ? +(top3 / gain).toFixed(3) : null,
      reading: 'top3Share near 1 means the pattern is one work’s property, not the language’s',
    },
    examples,
  });
}

const totalGain = out.reduce((a, c) => a + c.gain, 0);
const report = {
  schema: 'wenyan.relations.labeled-statement-probe.v1',
  generatedAt: new Date().toISOString(),
  status: 'PROBE — measured only. No marker class here is a declared construction, nothing is stored, and no role is assigned to any span.',
  why: '唐國史補 showed 89% of its unread passages contain no speech verb, so the labelled-statement family, not another speech frame, is the candidate the evidence points at.',
  boundaryRule: 'statement = marker to the first 。／；／！？ outside 「」『』（）, or end of passage; rejected if empty or over 300 chars',
  scope: { passages: rows.length },
  classes: out,
  combined: {
    gainSum: totalGain,
    note: 'Class gains OVERLAP (a passage can carry a 干支 and a grade) and must NOT be added to anything.',
  },
  nonClaims: [
    'A marker match is not a construction: no span here has been labelled a position, a judgement or a theme.',
    'The classes are declared by hand from five genres and are therefore selected to fit them; a hold-out genre was not used.',
    'superseded counts only containments of an EXISTING reading; the class spans are not declared, so this is the replacement risk a declaration WOULD carry, not one it has.',
  ],
};

console.log(`[labeled] probe over ${rows.length} passages; boundary: marker → first 。／；／！？ outside brackets`);
for (const c of out) {
  console.log(`  ${c.id.padEnd(9)} gain ${String(c.gain).padStart(6)}  supersede ${String(c.superseded).padStart(5)}  `
    + `partial ${String(c.partialOverlap).padStart(5)}  works ${String(c.dispersion.worksContributing).padStart(4)}  `
    + `top3 ${c.dispersion.top3Works.join(' ')} (${c.dispersion.top3Share})`);
  if (c.examples[0]) console.log(`        e.g. ${c.examples[0].work}: ${c.examples[0].match}`);
}
if (argv.includes('--write')) {
  const o = path.join(ROOT, 'knowledge/relations/labeled-statement-probe.json');
  fs.writeFileSync(o, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[written] ${path.relative(ROOT, o)}`);
}
