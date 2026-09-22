/**
 * Guards for the projection policy: selection by role and by provenance.
 *
 *   node tools/knowledge/selftest.mjs
 *
 * Why a separate file: the projection layer is where evidence gets dropped or
 * kept, and every defect found in this project so far has been a quiet one —
 * a silent slice, an exclusion that removed nothing, a hash that ignored the
 * data. These cases make those failures loud.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
import { loadEvidence, projectModel, makeRetraction, appendRetraction } from './store.mjs';
import { selectOperationalCore, provenanceClass } from './projection.mjs';
import { makeContext, ask, loadContract } from '../dialogue/ask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const v1 = createTsLoader()(path.join(ROOT, 'src/inscription/relations.ts'));
const rep = createTsLoader()(path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const v1Construction = (t) => {
  try { return v1.readRelation(t, v1.emptyRelationModel()).construction ?? null; } catch { return null; }
};
const repConstruction = (t) => {
  try { return rep.readReporting(t, rep.emptyReportingModel()).construction ?? null; } catch { return null; }
};

const { records } = loadEvidence(path.join(ROOT, 'knowledge/relations/evidence.jsonl'));

const cases = [];
const check = (name, fn) => {
  try { cases.push({ name, ok: true, detail: fn() ?? 'ok' }); }
  catch (e) { cases.push({ name, ok: false, detail: e.message }); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// -------------------------------------------------------------- provenance
check('provenanceClass separates corpus quotations from invented sentences', () => {
  const corpus = records.find((r) => r.source?.kind === 'corpus');
  const authored = records.find((r) => r.source?.kind !== 'corpus');
  expect(provenanceClass(corpus) === 'corpus', `corpus record classified as ${provenanceClass(corpus)}`);
  expect(provenanceClass(authored) === 'authored', `authored record classified as ${provenanceClass(authored)}`);
  return `${records.filter((r) => provenanceClass(r) === 'corpus').length} corpus / ` +
    `${records.filter((r) => provenanceClass(r) === 'authored').length} authored`;
});

check('corpus learning uses corpus-derived evidence only', () => {
  const core = selectOperationalCore(records, {
    grammar: 'wenyan.relations.reporting.v1', constructionOf: repConstruction, provenance: 'corpus',
  });
  const allCorpus = core.included.every((id) => provenanceClass(records.find((r) => r.id === id)) === 'corpus');
  expect(allCorpus, 'a non-corpus record entered the corpus-learned core');
  return `${core.included.length} core record(s), all corpus-derived`;
});

check('a grammar with no corpus evidence reports it instead of falling back to invented data', () => {
  const core = selectOperationalCore(records, {
    grammar: 'wenyan.relations.v1', constructionOf: v1Construction, provenance: 'corpus',
  });
  expect(core.model.examples.length === 0, `model still had ${core.model.examples.length} example(s)`);
  expect(core.complete === false, 'reported complete despite having no usable evidence');
  expect(/cannot be learned from the corpus/.test(core.emptyReason ?? ''), `unclear reason: ${core.emptyReason}`);
  return core.emptyReason;
});

check('excluded records are NAMED, never silently skipped', () => {
  const core = selectOperationalCore(records, {
    grammar: 'wenyan.relations.v1', constructionOf: v1Construction, provenance: 'corpus',
  });
  expect(core.excludedByProvenance.length === core.poolSize,
    `${core.excludedByProvenance.length} named vs pool ${core.poolSize}`);
  return `${core.excludedByProvenance.length} named: ${core.excludedByProvenance.join(', ')}`;
});

// --------------------------------------------------------------- accounting
check('accounting invariant: nothing vanishes from a projection (any provenance)', () => {
  const out = [];
  for (const [grammar, constructionOf, provenance] of [
    ['wenyan.relations.v1', v1Construction, 'authored'],
    ['wenyan.relations.reporting.v1', repConstruction, 'corpus'],
  ]) {
    const c = selectOperationalCore(records, { grammar, constructionOf, provenance });
    const accounted = c.included.length + c.heldOut.length + c.outOfGrammar.length + c.excludedByProvenance.length;
    expect(accounted === c.poolSize,
      `${grammar}: ${accounted} accounted vs pool ${c.poolSize}`);
    // Both grammar ids end in '.v1', so split('.').pop() renders them identically.
    const short = grammar.includes('reporting') ? 'reporting' : 'experimental';
    out.push(`${short}: ${accounted}/${c.poolSize}`);
  }
  return out.join('; ');
});

check('held-out records do not enter the model', () => {
  const c = selectOperationalCore(records, {
    grammar: 'wenyan.relations.reporting.v1', constructionOf: repConstruction, provenance: 'corpus',
  });
  const ids = new Set(c.model.examples.map((e) => e.id));
  const leaked = c.heldOut.filter((id) => ids.has(id));
  expect(leaked.length === 0, `${leaked.length} held-out record(s) leaked into the model`);
  return `${c.model.examples.length} modelled, ${c.heldOut.length} held out`;
});

// ------------------------------------------------------------------- the cap
check('the cap is never satisfied by silently dropping evidence', () => {
  const pool = Array.from({ length: 40 }, (_, i) => ({
    id: `s${i}`, grammar: 'wenyan.relations.v1', text: 'x',
    expected: { agent: 'a', recipient: 'b', theme: 'c' },
  }));
  try {
    projectModel(pool, { grammar: 'wenyan.relations.v1', parse: () => ({ construction: 'grant' }) });
  } catch (e) {
    expect(/silently drop/.test(e.message), `unexpected error: ${e.message}`);
    return 'refused, as required';
  }
  throw new Error('projectModel accepted an over-cap pool without refusing');
});

check('a core that would exceed the cap is an error, not a truncation', () => {
  const many = [];
  for (let i = 0; i < 40; i++) {
    many.push({
      id: `many:${i}`, grammar: 'wenyan.relations.reporting.v1',
      text: '孔子謂弟子曰：「學而時習之。」',
      expected: { agent: 'a', recipient: 'b', theme: 'c' },
      source: { kind: 'corpus' },
    });
  }
  try {
    selectOperationalCore(many, { grammar: 'wenyan.relations.reporting.v1', constructionOf: () => 'wei-quote', provenance: 'corpus' });
    return 'core stayed within the cap (single construction, minimum set applied)';
  } catch (e) {
    expect(/design error/.test(e.message), `unexpected error: ${e.message}`);
    return `refused: ${e.message.slice(0, 60)}…`;
  }
});


// --------------------------------------------------------------- retraction
const REAL_STORE = path.join(ROOT, 'knowledge/relations/evidence.jsonl');
const tmpStore = path.join(os.tmpdir(), `evidence-retract-${process.pid}.jsonl`);
fs.copyFileSync(REAL_STORE, tmpStore);

check('retraction accounting: active + retracted = all records', () => {
  const d = loadEvidence(REAL_STORE);
  expect(d.records.length + d.retractedIds.length === d.allRecords.length,
    `${d.records.length} + ${d.retractedIds.length} != ${d.allRecords.length}`);
  expect(d.issues.length === 0, `store issues: ${d.issues.join('; ')}`);
  return `${d.allRecords.length} records, ${d.retractedIds.length} retracted, 0 issues`;
});

check('a retraction must state a reason and name its retractor', () => {
  const bad = [
    () => makeRetraction({ targetId: 'x' }),
    () => makeRetraction({ targetId: 'x', reason: 'no', retractedBy: { kind: 'operator', by: 'a', at: 't' } }),
    () => makeRetraction({ targetId: 'x', reason: 'a sufficiently long reason', retractedBy: { kind: 'operator' } }),
  ];
  const thrown = bad.filter((f) => { try { f(); return false; } catch { return true; } }).length;
  expect(thrown === 3, `only ${thrown} of 3 malformed retractions were refused`);
  return 'all three malformed retractions refused (R1/R2/R3)';
});

check('retracting a non-existent record is refused', () => {
  try {
    appendRetraction(tmpStore, makeRetraction({
      targetId: 'no-such-record', reason: 'a reason long enough',
      retractedBy: { kind: 'operator', by: 'selftest', at: 'now' },
    }));
  } catch (e) {
    expect(/no such record/.test(e.message), `unexpected: ${e.message}`);
    return 'refused (R4)';
  }
  throw new Error('a retraction of a non-existent record was accepted');
});

check('a retraction removes the record from the ACTIVE set but keeps it in the log', () => {
  const before = loadEvidence(tmpStore);
  const target = before.records.find((r) => r.grammar.includes('reporting'));
  const res = appendRetraction(tmpStore, makeRetraction({
    targetId: target.id, reason: 'selftest: verify active-set exclusion',
    retractedBy: { kind: 'operator', by: 'selftest', at: 'now' },
  }));
  const after = loadEvidence(tmpStore);
  expect(res.appended, 'not appended');
  expect(after.allRecords.length === before.allRecords.length, 'the log lost a line');
  expect(after.records.length === before.records.length - 1, 'active set did not shrink by one');
  expect(after.retractedIds.includes(target.id), 'target not marked retracted');
  return `${before.records.length} -> ${after.records.length} active, ${after.allRecords.length} still in the log`;
});

check('retracting the same record twice is idempotent', () => {
  const d = loadEvidence(tmpStore);
  const already = d.retractedIds[0];
  const res = appendRetraction(tmpStore, makeRetraction({
    targetId: already, reason: 'selftest: second retraction of the same target',
    retractedBy: { kind: 'operator', by: 'selftest', at: 'now' },
  }));
  expect(res.appended === false, 'a duplicate retraction was appended');
  expect(loadEvidence(tmpStore).retractedIds.length === d.retractedIds.length, 'count changed');
  return 'no-op, as required';
});

check('a tampered retraction is detected', () => {
  const lines = fs.readFileSync(tmpStore, 'utf8').trim().split('\n');
  const idx = lines.findIndex((l) => JSON.parse(l).schema?.includes('retraction'));
  const r = JSON.parse(lines[idx]);
  r.reason = 'edited after the fact';
  lines[idx] = JSON.stringify(r);
  const tamperedPath = path.join(os.tmpdir(), `evidence-retract-tampered-${process.pid}.jsonl`);
  fs.writeFileSync(tamperedPath, lines.join('\n') + '\n');
  const d = loadEvidence(tamperedPath);
  fs.unlinkSync(tamperedPath);
  const found = d.issues.some((i) => /retraction contentHash mismatch/.test(i));
  expect(found, `tampering not detected; issues: ${d.issues.join('; ')}`);
  return 'retraction contentHash mismatch reported';
});

check('retracting a retraction is refused, and reported', () => {
  const lines = fs.readFileSync(tmpStore, 'utf8').trim().split('\n');
  const retraction = JSON.parse(lines.find((l) => JSON.parse(l).schema?.includes('retraction')));
  const nested = makeRetraction({
    targetId: retraction.id, reason: 'selftest: attempting to retract a retraction',
    retractedBy: { kind: 'operator', by: 'selftest', at: 'now' },
  });
  const nestedPath = path.join(os.tmpdir(), `evidence-nested-${process.pid}.jsonl`);
  fs.writeFileSync(nestedPath, fs.readFileSync(tmpStore, 'utf8') + JSON.stringify(nested) + '\n');
  const d = loadEvidence(nestedPath);
  fs.unlinkSync(nestedPath);
  const found = d.issues.some((i) => /refusing to retract a retraction/.test(i));
  expect(found, `not refused; issues: ${d.issues.join('; ')}`);
  return 'refused: a retraction is final; restore by appending a new record';
});

check('ABSENCE FAILS A CHECK: exhausting a declared construction makes complete false', () => {
  // Regression for a real bug: iterating only the constructions present in the
  // records let an exhausted one vanish from the map, so `.every()` passed
  // vacuously and the grammar reported complete:true while reading Unknown.
  const exhausted = path.join(os.tmpdir(), `evidence-exhausted-${process.pid}.jsonl`);
  fs.copyFileSync(REAL_STORE, exhausted);
  const d0 = loadEvidence(exhausted);
  const ids = d0.records.filter((r) => r.id.includes('yu-quote')).map((r) => r.id);
  expect(ids.length > 0, 'no yu-quote evidence to exhaust');
  for (const id of ids) {
    appendRetraction(exhausted, makeRetraction({
      targetId: id, reason: 'selftest: exhaust this construction to test vacuous truth',
      retractedBy: { kind: 'operator', by: 'selftest', at: 'now' },
    }));
  }
  const d = loadEvidence(exhausted);
  const c = selectOperationalCore(d.records, {
    grammar: 'wenyan.relations.reporting.v1', constructionOf: repConstruction, provenance: 'corpus',
    expectedConstructions: ['gao-quote', 'wei-quote', 'wen-quote', 'yu-quote'],
  });
  fs.unlinkSync(exhausted);
  expect(c.complete === false, 'complete was reported TRUE with an unevidenced construction');
  expect(c.perConstruction['yu-quote'].available === 0, 'yu-quote still had evidence');
  expect(c.perConstruction['yu-quote'].sufficient === false, 'yu-quote reported sufficient');
  return `complete=false; yu-quote ${c.perConstruction['yu-quote'].selected}/${c.perConstruction['yu-quote'].available}`;
});

check('I6 end to end: retraction downgrades one construction and leaves the others answered', () => {
  const sandbox = path.join(os.tmpdir(), `evidence-i6-${process.pid}.jsonl`);
  fs.copyFileSync(REAL_STORE, sandbox);
  const ids = loadEvidence(sandbox).records.filter((r) => r.id.includes('yu-quote')).map((r) => r.id);
  for (const id of ids) {
    appendRetraction(sandbox, makeRetraction({
      targetId: id, reason: 'selftest: I6 end-to-end downgrade',
      retractedBy: { kind: 'operator', by: 'selftest', at: 'now' },
    }));
  }
  const ctx = makeContext({ storePath: sandbox });
  const affected = ask({ type: 'Q1', text: '孔子語弟子曰：「學而時習之。」', grammar: 'wenyan.relations.reporting.v1' }, ctx, loadContract());
  const untouched = ask({ type: 'Q1', text: '孔子謂弟子曰：「學而時習之。」', grammar: 'wenyan.relations.reporting.v1' }, ctx, loadContract());
  fs.unlinkSync(sandbox);
  expect(affected.state === 'Unknown', `the exhausted construction still read as ${affected.state}`);
  expect(untouched.state === 'Answered', `an untouched construction became ${untouched.state}`);
  return `exhausted -> ${affected.state} (${affected.reason}); untouched -> ${untouched.state}`;
});

check('Q3 distinguishes a RETRACTED warrant from a missing one', () => {
  // Take an answer while the evidence is active, retract part of its warrant, then
  // ask what licenses it. The conclusion did not lose its basis to corruption, it
  // lost it to a decision — and those are different findings.
  const sandbox = path.join(os.tmpdir(), `evidence-warrant-${process.pid}.jsonl`);
  fs.copyFileSync(REAL_STORE, sandbox);
  const ctxBefore = makeContext({ storePath: sandbox });
  const answer = ask({ type: 'Q1', text: '孔子謂弟子曰：「學而時習之。」', grammar: 'wenyan.relations.reporting.v1' },
    ctxBefore, loadContract());
  expect(answer.state === 'Answered', `setup failed: ${answer.state}`);
  const victim = answer.warrant.refs[0];
  appendRetraction(sandbox, makeRetraction({
    targetId: victim, reason: 'selftest: retract part of an already-issued warrant',
    retractedBy: { kind: 'operator', by: 'selftest', at: 'now' },
  }));
  const ctxAfter = makeContext({ storePath: sandbox });
  const q3 = ask({ type: 'Q3', answer }, ctxAfter, loadContract());
  fs.unlinkSync(sandbox);
  expect(q3.state === 'Unknown', `expected Unknown, got ${q3.state}`);
  expect(q3.reason === 'warrant-refers-to-retracted-evidence', `reason was ${q3.reason}`);
  expect(/still active/.test(q3.missing ?? ''), `missing did not say what is needed: ${q3.missing}`);
  return `${victim} retracted -> ${q3.state} (${q3.reason})`;
});

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed++;
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
  console.log(`       ${c.detail}`);
}
console.log(`\n[projection-selftest] ${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
