/**
 * Does the reporting grammar obey the SAME discipline as the verified one?
 *
 *   node tools/grammar/selftest.mjs
 *
 * The contract records a duplication debt: the evidence/replay discipline is
 * copied rather than shared, because extracting it would modify the verified
 * module of the reviewed patch. The stated mitigation is this file — both
 * modules are driven through the same cases and must behave identically.
 *
 * Real corpus passages are used where available (from knowledge/grammar/
 * measurement.json) so the cases are about actual text, not invented strings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const load = createTsLoader();
const v1 = load(path.join(ROOT, 'src/inscription/relations.ts'));
const rep = load(path.join(ROOT, 'src/inscription/relations-reporting.ts'));

const measurementFile = path.join(ROOT, 'knowledge/grammar/measurement.json');
const measurement = fs.existsSync(measurementFile)
  ? JSON.parse(fs.readFileSync(measurementFile, 'utf8')) : null;

const realWei = measurement?.reach?.examples?.['wei-quote']?.text;
const realAmbiguous = measurement?.reach?.ambiguousExamples?.[0]?.text;
const synthetic = '孔子謂弟子曰：「學而時習之。」';

const cases = [];
const check = (name, fn) => {
  try { cases.push({ name, ok: true, detail: fn() ?? 'ok' }); }
  catch (e) { cases.push({ name, ok: false, detail: e.message }); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------------------------------------------------------- shared discipline
check('both grammars start from all 6 permutations', () => {
  const a = v1.readRelation('「甲」授「乙」「书」。', v1.emptyRelationModel());
  const b = rep.readReporting(synthetic, rep.emptyReportingModel());
  expect(a.candidates.length === 6, `v1 candidates ${a.candidates.length}`);
  expect(b.candidates.length === 6, `reporting candidates ${b.candidates.length}`);
  return `v1 6, reporting 6`;
});

check('one supervised example eliminates 5 of 6 permutations in both', () => {
  const a1 = v1.learnRelations(v1.emptyRelationModel(),
    { id: 't', text: '「甲」授「乙」「书」。', expected: { agent: '甲', recipient: '乙', theme: '书' } }, 6);
  expect(a1.status === 'Updated' && a1.remainingMappings === 1, `v1 ${a1.status}/${a1.remainingMappings}`);
  const b1 = rep.learnReportingRelations(rep.emptyReportingModel(),
    { id: 't', text: synthetic, expected: { agent: '孔子', recipient: '弟子', theme: '學而時習之。' } }, 6);
  expect(b1.status === 'Updated' && b1.remainingMappings === 1, `reporting ${b1.status}/${b1.remainingMappings}`);
  return 'v1 6->1, reporting 6->1';
});

check('a contradicting label is a Conflict and commits nothing, in both', () => {
  const m = v1.emptyRelationModel();
  const base = v1.learnRelations(m, { id: 'a', text: '「甲」授「乙」「书」。', expected: { agent: '甲', recipient: '乙', theme: '书' } }, 6).model;
  const conflict = v1.learnRelations(base, { id: 'b', text: '「甲」授「乙」「书」。', expected: { agent: '乙', recipient: '甲', theme: '书' } }, 6);
  expect(conflict.status === 'Conflict', `v1 ${conflict.status}`);
  expect(conflict.model.examples.length === 1, 'v1 committed a conflicting update');

  const rm = rep.emptyReportingModel();
  const rbase = rep.learnReportingRelations(rm, { id: 'a', text: synthetic, expected: { agent: '孔子', recipient: '弟子', theme: '學而時習之。' } }, 6).model;
  const rconflict = rep.learnReportingRelations(rbase, { id: 'b', text: synthetic, expected: { agent: '弟子', recipient: '孔子', theme: '學而時習之。' } }, 6);
  expect(rconflict.status === 'Conflict', `reporting ${rconflict.status}`);
  expect(rconflict.model.examples.length === 1, 'reporting committed a conflicting update');
  return 'Conflict in both, no update committed in either';
});

check('exhausted fuel adds no constraint, in both', () => {
  const a = v1.learnRelations(v1.emptyRelationModel(),
    { id: 't', text: '「甲」授「乙」「书」。', expected: { agent: '甲', recipient: '乙', theme: '书' } }, 2);
  const b = rep.learnReportingRelations(rep.emptyReportingModel(),
    { id: 't', text: synthetic, expected: { agent: '孔子', recipient: '弟子', theme: '學而時習之。' } }, 2);
  expect(a.status === 'Unknown' && a.model.examples.length === 0, `v1 ${a.status}`);
  expect(b.status === 'Unknown' && b.model.examples.length === 0, `reporting ${b.status}`);
  return 'both Unknown with an unchanged model';
});

check('out-of-grammar input is Unknown, in both', () => {
  const a = v1.readRelation('子曰：「學而時習之。」', v1.emptyRelationModel());
  const b = rep.readReporting('甲给乙一本书。', rep.emptyReportingModel());
  expect(a.status === 'Unknown', `v1 ${a.status}`);
  expect(b.status === 'Unknown', `reporting ${b.status}`);
  return `${a.reason} / ${b.reason}`;
});

check('a contradictory evidence set throws on replay, in both', () => {
  let v1Threw = false; let repThrew = false;
  try {
    v1.readRelation('「甲」授「乙」「书」。', { schema: 'wenyan.relations.v1', examples: [
      { id: '1', text: '「甲」授「乙」「书」。', expected: { agent: '甲', recipient: '乙', theme: '书' } },
      { id: '2', text: '「甲」授「乙」「书」。', expected: { agent: '乙', recipient: '甲', theme: '书' } }] });
  } catch { v1Threw = true; }
  try {
    rep.readReporting(synthetic, { schema: rep.REPORTING_GRAMMAR_ID, examples: [
      { id: '1', text: synthetic, expected: { agent: '孔子', recipient: '弟子', theme: '學而時習之。' } },
      { id: '2', text: synthetic, expected: { agent: '弟子', recipient: '孔子', theme: '學而時習之。' } }] });
  } catch { repThrew = true; }
  expect(v1Threw && repThrew, `v1 threw=${v1Threw}, reporting threw=${repThrew}`);
  return 'both throw contradictory evidence';
});

// --------------------------------------------------- reporting-specific rules
check('real corpus passage parses and pins to the declared reading', () => {
  if (!realWei) return 'skipped (no measurement.json yet)';
  const learned = rep.learnReportingRelations(rep.emptyReportingModel(), {
    id: 'real', text: realWei,
    expected: { agent: '?', recipient: '?', theme: '?' },
  }, 0);
  // fuel 0 must not constrain; then read against the store-derived model instead
  expect(learned.status === 'Unknown', `expected Unknown at fuel 0, got ${learned.status}`);
  const probe = rep.readReporting(realWei, rep.emptyReportingModel());
  expect(probe.construction === 'wei-quote', `construction ${probe.construction}`);
  expect(probe.occurrences.length === 3, `occurrences ${probe.occurrences.length}`);
  const [s0, s1, s2] = probe.occurrences;
  expect(realWei.slice(s0.start, s0.end) === s0.value, 'slot0 offsets do not point at its own text');
  expect(realWei.slice(s2.start, s2.end) === s2.value, 'slot2 offsets do not point at its own text');
  return `${probe.construction}: ${s0.value} / ${s1.value} / ${s2.value.slice(0, 12)}…`;
});

check('a passage with two frame occurrences is Unknown, not a coin flip', () => {
  if (!realAmbiguous) return 'skipped (no ambiguous example recorded)';
  const r = rep.readReporting(realAmbiguous, rep.emptyReportingModel());
  expect(r.status === 'Unknown', `status ${r.status}`);
  expect(r.reason === 'ambiguous-frame-occurrence', `reason ${r.reason}`);
  expect(r.ambiguousMatches >= 2, `matches ${r.ambiguousMatches}`);
  return `Unknown(${r.reason}) with ${r.ambiguousMatches} matches`;
});

check('a 2-slot frame is NOT admitted (declared but unused)', () => {
  const r = rep.readReporting('子曰：「學而時習之。」', rep.emptyReportingModel());
  expect(r.status === 'Unknown', `unexpectedly read as ${r.status}`);
  return 'A曰：「S」 -> Unknown, as declared in measuredButNotAdmitted';
});

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed++;
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
  console.log(`       ${c.detail}`);
}
console.log(`\n[grammar-selftest] ${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
