// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildCatalog, checkCatalogSources, core, findLine, sha256 } from './catalog.mjs';
import { makeLearningEvent, replayLearning, predictContext, appendLearning, loadLearning } from './learning.mjs';
import { checkCore } from './core-checks.mjs';
import { createTsLoader } from '../lib/tsload.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = buildCatalog();
const logic = createTsLoader()(path.join(ROOT, 'src/inscription/syllogism.ts'));
const corpus = checkCatalogSources(catalog);
const exact = checkCore(ROOT);
const clone = x => JSON.parse(JSON.stringify(x));
const poisoned = clone(catalog); poisoned.entries[0].lines[0].text = 'tampered';
assert.throws(() => checkCatalogSources(poisoned));
let inquiries = 0;
for (const entry of catalog.entries) for (let i = 1; i <= 6; i++) {
  const result = core.readChanges(`觀「${entry.name}」之${'初二三四五上'[i - 1]}爻。`, catalog);
  assert.equal(result.status, 'IndexedText'); assert.equal(result.line.position, i);
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, catalog.provenance.file), 'utf8'));
  const section = source.sections.find(s => s.id === result.line.source.section);
  const passage = section.passages.find(p => p.id === result.line.source.passageId);
  assert.equal(passage.text.slice(result.line.source.start, result.line.source.end), result.line.text);
  inquiries++;
}
assert.equal(core.readChanges('解释宇宙的命运', catalog).status, 'Unknown');
assert.equal(core.readChanges('觀「不存在」之初爻。', catalog).status, 'Unknown');

let events = [];
const provenance = { by: 'Codex (OpenAI), via Mingli Yuan', basis: 'Explicit bounded research fixture; not scholarly consensus or a factual judgment licensed by the text.' };
const append = (id, payload) => { const e = makeLearningEvent(events, { id, payload, provenance }, catalog); events.push(e); return e; };
const profile = (id, task, labels, hypotheses) => append(id, { kind: 'profile', profile: id, task, labels, hypotheses });
const authored = (id, p, bits, position, label) => append(id, { kind: 'example', profile: p, context: { bits, position }, label,
  source: { kind: 'authored', note: 'Synthetic geometry label; explicitly separate from corpus interpretation.' } });
profile('fixture-v1', 'fixture-polarity', ['yin', 'yang'], [['position'], ['polarity']]);
authored('synthetic-yang', 'fixture-v1', '111111', 1, 'yang');
authored('synthetic-yin', 'fixture-v1', '000000', 1, 'yin');
let transfers = 0;
for (const bits of core.hexagrams()) for (let position = 1; position <= 6; position++) {
  if (position === 1 && ['111111', '000000'].includes(bits)) continue;
  const r = predictContext(events, 'fixture-v1', { bits, position }, catalog);
  assert.equal(r.status, 'CandidateReading'); assert.equal(r.label, bits[position - 1] === '1' ? 'yang' : 'yin'); transfers++;
}
assert.equal(predictContext(events, 'fixture-v1', { bits: '101010', position: 2 }, catalog, 0).status, 'Unknown');
// Corpus experiment: a position-only reading is proposed and then refuted.
profile('advice-coarse-v1', 'declared-action-reading', ['wait', 'act'], [['position'], ['position', 'polarity']]);
function corpusLabel(id, p, ordinal, position, label) {
  const entry = catalog.entries.find(e => e.ordinal === ordinal), line = entry.lines[position - 1];
  return append(id, { kind: 'example', profile: p, context: { bits: entry.bits, position }, label,
    source: { kind: 'corpus', reference: line.source, text: line.text } });
}
corpusLabel('qian-wait', 'advice-coarse-v1', 1, 1, 'wait');
const lu = catalog.entries.find(e => e.ordinal === 10);
assert.ok(lu.lines[0].text.includes('往无咎'));
const before = predictContext(events, 'advice-coarse-v1', { bits: lu.bits, position: 1 }, catalog);
assert.equal(before.status, 'CandidateReading'); assert.equal(before.label, 'wait');
corpusLabel('lu-act', 'advice-coarse-v1', 10, 1, 'act');
const refutation = predictContext(events, 'advice-coarse-v1', { bits: lu.bits, position: 1 }, catalog);
assert.equal(refutation.status, 'Unknown'); assert.equal(refutation.reason, 'hypothesis-family-refuted');
assert.equal(refutation.refuted.length, 2);
profile('advice-context-v2', 'declared-action-reading', ['wait', 'act'], [['bits', 'position']]);
assert.equal(predictContext(events, 'advice-context-v2', { bits: lu.bits, position: 1 }, catalog).label, 'act');
assert.equal(predictContext(events, 'advice-context-v2', { bits: '000000', position: 1 }, catalog).status, 'Unknown');
corpusLabel('qian-disagreement', 'advice-context-v2', 1, 1, 'act');
const contested = predictContext(events, 'advice-context-v2', { bits: '111111', position: 1 }, catalog);
assert.equal(contested.status, 'Contested'); assert.equal(contested.disagreement.length, 2);
const local = predictContext(events, 'advice-context-v2', { bits: lu.bits, position: 1 }, catalog);
assert.equal(local.label, 'act'); assert.equal(local.excludedConflicts.length, 1);
append('retract-disagreement', { kind: 'retract', target: 'qian-disagreement', reason: 'Deliberate conflict fixture withdrawn; original judgment remains auditable.' });
assert.equal(predictContext(events, 'advice-context-v2', { bits: '111111', position: 1 }, catalog).label, 'wait');
// Retraction restores uncertainty without deleting history.
const retained = clone(events);
append('retract-qian', { kind: 'retract', target: 'qian-wait', reason: 'Counterfactual withdrawal test.' });
assert.equal(predictContext(events, 'advice-context-v2', { bits: '111111', position: 1 }, catalog).status, 'Unknown');
events = retained;
const tampered = clone(events); tampered[1].payload.label = 'yin'; assert.throws(() => replayLearning(tampered, catalog));
assert.throws(() => replayLearning(events.slice(1), catalog));
const badSource = clone(events.find(e => e.id === 'qian-wait').payload); badSource.source.text = 'invented';
assert.throws(() => makeLearningEvent(events, { id: 'bad-source', payload: badSource, provenance }, catalog));

// Source-binding policy. The corpus work file is DERIVED and re-extracting it rewrites
// its bytes, so its whole-file digest is compared as reported drift rather than as a
// fatal mismatch — the log is hash-chained and cannot be repaired by rewriting. Every
// component of the EVIDENCE stays fatal, and so does the licence once an event declares
// its own digest.
{
  const driftPayload = clone(events.find(e => e.id === 'qian-wait').payload);
  driftPayload.source.reference.license.corpusSha256 = 'f'.repeat(64);
  const withDrift = [...events, makeLearningEvent(events, { id: 'file-rewritten', payload: driftPayload, provenance }, catalog)];
  const replayed = replayLearning(withDrift, catalog);
  assert.equal(replayed.sourceDrift.length, 1, 'a rewritten corpus file must be reported, not silently accepted');
  assert.equal(replayed.sourceDrift[0].event, 'file-rewritten');
  assert.equal(replayed.sourceDrift[0].kind, 'corpus-file-rewritten');

  const spanMoved = clone(driftPayload); spanMoved.source.reference.start += 1;
  assert.throws(() => makeLearningEvent(events, { id: 'span-moved', payload: spanMoved, provenance }, catalog),
    /stale or mismatched source binding/, 'a moved span is evidence drift and stays fatal');

  const revMoved = clone(driftPayload); revMoved.source.reference.sourceRevid += 1;
  assert.throws(() => makeLearningEvent(events, { id: 'rev-moved', payload: revMoved, provenance }, catalog),
    /stale or mismatched source binding/, 'a different source revision is evidence drift and stays fatal');

  const licenceMoved = clone(driftPayload); licenceMoved.source.reference.license.licenseSha256 = '0'.repeat(64);
  assert.throws(() => makeLearningEvent(events, { id: 'licence-moved', payload: licenceMoved, provenance }, catalog),
    /licence changed since this example was recorded/, 'a licence change is fatal once the event pins it');
}
assert.throws(() => makeLearningEvent(events, { id: 'bad-profile', payload: { kind: 'profile', profile: 'bad', task: 'bad', labels: ['a', 'b'], hypotheses: [['destiny']] }, provenance }, catalog));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wenyan-changes-'));
try {
  const file = path.join(temp, 'events.jsonl');
  for (const e of events) appendLearning(file, { id: e.id, payload: e.payload, provenance: e.provenance }, catalog);
  assert.equal(appendLearning(file, events[0], catalog).appended, false);
  assert.deepEqual(loadLearning(file, catalog), events);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
// Opt-in integration must preserve all legacy output fields.
const pipeline = createTsLoader()(path.join(ROOT, 'src/inscription/pipeline.ts')).runInscriptionPipeline;
const query = '觀「乾」之初爻。';
const baseline = clone(pipeline(query, { steps: 2 }));
const integrated = clone(pipeline(query, { steps: 2, changes: { catalog } }));
assert.equal(integrated.changes.status, 'IndexedText'); delete integrated.changes;
assert.deepEqual(integrated, baseline);
const blocked = pipeline(query, { changes: { catalog: {} }, safety: { requireAcknowledgement: true } });
assert.equal(blocked.blocked, true);

const sourcePaths = ['src/inscription/changes.ts', 'src/inscription/syllogism.ts', 'src/inscription/pipeline.ts',
  'tools/changes/catalog.mjs', 'tools/changes/learning.mjs', 'tools/changes/ask.mjs', 'tools/changes/core-checks.mjs', 'tools/changes/selftest.mjs', 'experiments/changes/contract.json'];
const report = { schema: 'wenyan.changes.validation.v1', runtime: process.version,
  corpus, exact, inquiries, learning: { syntheticHeldOut: transfers, corpusLabels: 2,
    coarseHypothesesRefuted: refutation.refuted.length, contestedLocal: true, withdrawalAndReplay: true,
    semanticStatus: 'supervisor-proposals-only; corpus context refinement is not measured semantic generalization' },
  integration: { optIn: true, legacyFieldsEqual: true, acknowledgementGatePreserved: true },
  // Reported, not swallowed: the recorded log pins the corpus work file's bytes, and that
  // file is DERIVED, so a corpus re-extraction moves the digest while the bound passages
  // stay identical. Recording the drift here is what keeps the tolerance auditable.
  sourceDrift: replayLearning(loadLearning(path.join(ROOT, 'knowledge/changes/learning.jsonl'), catalog), catalog).sourceDrift,
  sources: Object.fromEntries(sourcePaths.map(p => [p, sha256(fs.readFileSync(path.join(ROOT, p)))])) };
const atlas = { schema: 'wenyan.changes.syllogism-atlas.v1',
  encoding: 'bottom quantity triple, top quality triple; figure and policy retained separately',
  rows: catalog.entries.map(e => ({ ordinal: e.ordinal, hexagram: e.name, bits: e.bits, mood: logic.decodeMood(e.bits),
    judgments: ['boolean', 'terms-nonempty'].flatMap(policy => [1, 2, 3, 4].map(figure =>
      logic.judgeSyllogism({ mood: logic.decodeMood(e.bits), figure, policy }))) })) };
if (!process.argv.includes('--write')) {
  for (const [p, expected] of [['knowledge/changes/catalog.json', catalog], ['knowledge/changes/syllogisms.json', atlas]]) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')), clone(expected));
  }
  const recorded = JSON.parse(fs.readFileSync(path.join(ROOT, 'experiments/changes/evidence.json'), 'utf8'));
  assert.deepEqual(recorded.sources, report.sources);
  assert.deepEqual(recorded.exact, clone(report.exact));
  loadLearning(path.join(ROOT, 'knowledge/changes/learning.jsonl'), catalog);
}
if (process.argv.includes('--write')) {
  // Only explicitly requested derived outputs; historical evidence is untouched.
  fs.mkdirSync(path.join(ROOT, 'knowledge/changes'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'knowledge/changes/catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'knowledge/changes/syllogisms.json'), JSON.stringify(atlas, null, 2) + '\n');
  // The log is hash-chained history and is NOT regenerated: every payload pins its own
  // corpus revision, so a re-derivation after a corpus re-extraction would name different
  // content under an existing id. Only ids not already recorded are appended; drift in an
  // existing event is reported by loadLearning() (sourceDrift), never repaired by rewriting.
  const log = path.join(ROOT, 'knowledge/changes/learning.jsonl');
  const recordedIds = new Set(fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
  for (const e of events) {
    if (recordedIds.has(e.id)) continue;
    appendLearning(log, { id: e.id, payload: e.payload, provenance: e.provenance }, catalog);
  }
  fs.writeFileSync(path.join(ROOT, 'experiments/changes/evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
