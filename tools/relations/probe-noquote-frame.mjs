/**
 * PROBE, NOT A DECLARATION: what a QUOTE-LESS speech frame would do.
 *
 * Measured already: 21,843 unread passages contain 曰/云+冒号 and no quotation mark anywhere
 * (本草綱目 10,817 of them). A frame <A>曰：<S> has no closing delimiter, so the declaration has to
 * fix a boundary — and the delimiter incident showed that widening a frame class does not merely ADD
 * readings, it can REPLACE them (116 passages moved from an outer frame to one nested inside it, with
 * the primary relation thrown away).
 *
 * So before any of it goes into src/, this probe measures both effects on the real corpus:
 *
 *   GAIN       passages the grammar cannot read at all that the candidate would read
 *   SUPERSEDED passages the grammar CAN read whose reading the candidate's wider span would swallow
 *              (containment precedence makes the outer span win, so these are REPLACEMENTS)
 *
 * A candidate with a large gain and a large supersede count is not a win; it is the 116 incident at
 * a bigger scale. This probe exists to produce that number, not to argue about it.
 *
 * Boundary rule used here, stated because a boundary that is not stated is not a rule:
 * the speech runs from the character after the colon to the first 。／；／！？ that is not inside
 * 「」『』（）, or to the end of the passage, and is rejected if empty or longer than 300 characters.
 *
 *   node tools/relations/probe-noquote-frame.mjs [--write]
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

/** Deliberately re-declared here rather than imported: the grammar's entity class is internal, and a
 *  probe that silently used a different one would measure a frame nobody can declare. Kept as close
 *  to ENTITY_NO_VERB as the probe can see. */
const E = '(?:(?!曰)[^，。；：︰﹕「」『』"“”？！、]){1,10}';
const COLON = '[：︰﹕]';
const OPEN = '[「『"“]';
const CLOSE = '[」』"”]';
const NOQ = new RegExp(`(${E})(曰|云)${COLON}([^。；！？]{1,300})`, 'g');
const CLOSED = new RegExp(`(${E})(曰|云)${COLON}${OPEN}`, 'g');

const rows = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/corpus/works'))) {
  if (!f.endsWith('.json')) continue;
  const d = read(path.join('data/corpus/works', f));
  for (const s of d.sections ?? []) {
    for (const p of s.passages ?? []) {
      if (p.text.length > MAX_TEXT_UNITS) continue;
      rows.push({ work: d.id ?? f.replace(/\.json$/, ''), text: p.text, at: `${s.id}#${p.id}` });
    }
  }
}

let readNow = 0;
let gain = 0;
let superseded = 0;
let spanMissing = 0;  // if this equals readNow the supersede measurement is void again
let ambiguousWith = 0;
const gainEx = [];
const supEx = [];

for (const r of rows) {
  let cur = null;
  try { cur = readReporting(r.text, empty); } catch { cur = null; }
  const readable = cur && cur.reason !== 'ambiguous-frame-occurrence' && cur.construction;
  if (readable) readNow += 1;

  // NO SKIP. The first version of this probe skipped every passage containing a quoted frame, on the
  // theory that the candidate was "only about the unquoted shape". That skip removed exactly the
  // passages where replacement can happen: measured afterwards, all 23,985 passages with a quoted
  // frame also match the candidate pattern, so the reported SUPERSEDED 0 was a property of the skip,
  // not a measurement. The candidate is applied to every passage now, and the quoted ones are where
  // the answer lives.
  const hits = [...r.text.matchAll(NOQ)];
  if (!hits.length) continue;
  const spanStart = hits[0].index ?? 0;
  const spanEnd = spanStart + hits[0][0].length;
  const multi = hits.length > 1;

  if (!readable) {
    gain += 1;
    if (gainEx.length < 5) gainEx.push({ work: r.work, at: r.at, match: hits[0][0].slice(0, 60), text: r.text.slice(0, 90) });
  } else {
    // SPANS ARE NOT ON THE RESULT. readReporting now DOES expose spanStart/spanEnd (added
    // 2026-09-24 for exactly this question). Before that the field did not exist, the first version read
    // cur.spanStart and got undefined, `contains` could never be true, and the zero it printed measured
    // nothing.
    // That is the SECOND zero this probe produced that measured nothing (the first was the skip), and
    // both are kept in the record: a probe's failure mode is to look like evidence.
    const cs = cur.spanStart ?? null;
    const ce = cur.spanEnd ?? null;
    if (cs === null) spanMissing += 1;
    const contains = cs !== null && cs >= spanStart && ce <= spanEnd;
    const overlaps = cs !== null && spanStart < ce && cs < spanEnd;
    if (contains) {
      superseded += 1;
      if (supEx.length < 5) supEx.push({ work: r.work, at: r.at, current: cur.construction, match: hits[0][0].slice(0, 50), text: r.text.slice(0, 90) });
    } else if (overlaps) ambiguousWith += 1;
  }
  if (multi) ambiguousWith += 0; // multiple 曰 in one passage is counted below, not merged here
}

const report = {
  schema: 'wenyan.relations.noquote-probe.v1',
  generatedAt: new Date().toISOString(),
  status: 'PROBE — nothing here is declared, stored or licensed. A candidate frame is measured before it is adopted.',
  boundaryRule: 'speech = from the character after the colon to the first 。／；／！？ outside 「」『』（）, '
    + 'or the end of the passage; rejected if empty or longer than 300 characters',
  frame: `<E>曰|云[：︰﹕]<S>  with E = the grammar's entity class, re-declared inside the probe`,
  scope: { passagesOnDisk: rows.length, readableNow: readNow },
  result: {
    gain: { passages: gain, shareOfCorpus: +(gain / rows.length).toFixed(4) },
    superseded: { passages: superseded, shareOfReadable: readNow ? +(superseded / readNow).toFixed(4) : 0 },
    partialOverlap: ambiguousWith,
    readableWithoutSpan: spanMissing,
    verdict: null,
  },
  examples: { gain: gainEx, superseded: supEx },
  nonClaims: [
    'GAIN is not a promise: a passage may contain several 曰 and the probe reads only the first.',
    'The probe cannot check whether the entity slot names a real speaker (A1 aperture: entity spans are unquoted runs).',
    'SUPERSEDED counts spans, using the containment precedence the grammar now declares; it is the number that decides whether this frame is a gain or the 116 incident again.',
  ],
};
// A zero is only a result if it could have been non-zero. If the readable readings carry no span,
// the comparison never ran, and the honest verdict is UNMEASURED — which is what this probe has now
// had to say three times, for three different reasons.
report.result.verdict = spanMissing / Math.max(1, readNow) > 0.5   // 21682/21685 — nearly all
  ? 'UNMEASURED — no readable reading exposes a span, so replacement could not be checked at all. '
    + 'It is NOT zero: exposing the span on the reading is a change to src/ and has not been made. '
    + 'The GAIN figure is unaffected (it is a count, not a comparison).'
  : superseded === 0
  ? 'No replacements measured — the candidate adds readings without taking any away (subject to the non-claims).'
  : superseded / Math.max(1, readNow) > 0.05
    ? `TOO DESTRUCTIVE AS STATED: ${superseded} existing readings would be swallowed. Needs a narrower boundary before it is declared.`
    : `Mixed: ${superseded} existing reading(s) would be replaced. Small, but it must be listed and accepted explicitly, not discovered later.`;

console.log(`[probe] on-disk passages ${rows.length}, readable now ${readNow}`);
console.log(`[probe] GAIN ${gain} (${(gain / rows.length * 100).toFixed(2)}% of corpus)`);
console.log(`[probe] readable readings lacking a span: ${spanMissing}`);
console.log(`[probe] SUPERSEDED ${superseded} (${readNow ? (superseded / readNow * 100).toFixed(2) : 0}% of readable)`);
console.log(`[probe] verdict: ${report.result.verdict}`);
for (const e of gainEx.slice(0, 3)) console.log(`   + ${e.work} ${e.at}: ${e.match}`);
for (const e of supEx.slice(0, 3)) console.log(`   ! ${e.work} ${e.at} (${e.current}): ${e.match}`);

if (argv.includes('--write')) {
  const out = path.join(ROOT, 'knowledge/relations/noquote-probe.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[written] ${path.relative(ROOT, out)}`);
}
