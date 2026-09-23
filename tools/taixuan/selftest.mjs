// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildCatalog, checkCatalogSources, ROOT, sha256, renderText, findZan, readTaixuan } from './catalog.mjs';
import { fromOrdinal, toOrdinal, encodeAddress, decodeAddress, contextFeatures, nextZan } from './structure.mjs';
import { runExperiment } from './experiment.mjs';
import * as learning from './learning.mjs';
import { askTaixuan } from './ask.mjs';
import { createContextLearner } from '../context-learning/engine.mjs';
import * as legacy from '../changes/learning.mjs';
import { buildCatalog as buildZhouyi, core, findLine } from '../changes/catalog.mjs';
const clone = x => JSON.parse(JSON.stringify(x));
const catalog = buildCatalog(), corpus = checkCatalogSources(catalog);
assert.equal(corpus.heads, 81); assert.equal(corpus.zans, 729); assert.equal(corpus.extras, 2);
assert.equal(corpus.separatedPairs, 728); assert.equal(corpus.unresolved.length, 1);
assert.equal(corpus.unresolved[0].head, '達'); assert.equal(corpus.unresolved[0].zan, 2);
const raw = fs.readFileSync(path.join(ROOT, catalog.provenance.file), 'utf8');
const addresses = new Set(); let spanChecks = 0, inquiries = 0, successorChecks = 0, carryChanges = 0;
function checkSpan(record) {
  assert.equal(record.source.snapshotSha256, sha256(raw));
  assert.equal(record.source.unit, 'UTF-16');
  assert.equal(renderText(raw.slice(record.source.start, record.source.end)), record.text); spanChecks++;
}
for (const e of catalog.entries) {
  assert.equal(toOrdinal(e.digits), e.ordinal); assert.equal(fromOrdinal(e.ordinal), e.digits); checkSpan(e.statement);
  for (const z of e.zans) {
    const context = { system: 'taixuan', digits: e.digits, zan: z.zan }, address = encodeAddress(e.digits, z.zan);
    assert.ok(!addresses.has(address)); addresses.add(address); assert.deepEqual(decodeAddress(address), context);
    const result = readTaixuan(`觀「${e.name}」之${'一二三四五六七八九'[z.zan - 1]}贊。`, catalog);
    assert.equal(result.status, 'IndexedText'); assert.deepEqual(result.record, z); inquiries++;
    checkSpan(z.passage); if (z.statement) checkSpan(z.statement); if (z.commentary) checkSpan(z.commentary);
    const next = nextZan(context);
    if (z.zan === 9) assert.equal(next.status, 'Boundary');
    else {
      assert.deepEqual(next.context, { ...context, zan: z.zan + 1 });
      const n = encodeAddress(next.context.digits, next.context.zan);
      const changed = [...n].filter((x, i) => x !== address[i]).length;
      assert.equal(changed, z.zan % 3 === 0 ? 2 : 1); carryChanges += changed === 2 ? 1 : 0;
    }
    successorChecks++;
  }
}
assert.equal(addresses.size, 729); assert.equal(carryChanges, 162);
for (const e of [...catalog.extra, ...catalog.supplemental]) checkSpan(e);
const uncertain = readTaixuan('觀「達」之二贊。', catalog).record;
assert.equal(uncertain.segmentation, 'unresolved-missing-marker'); assert.equal(uncertain.statement, null); assert.equal(uncertain.commentary, null);
assert.equal(readTaixuan('觀「不存在」之二贊。', catalog).status, 'Unknown');
assert.equal(readTaixuan('預測明日吉凶', catalog).status, 'Unknown');
assert.equal(askTaixuan({ kind: 'execute', code: 'anything' }, catalog).status, 'Refused');
for (const digits of ['000', '00000', '0003', '00U0', null, 0]) assert.throws(() => encodeAddress(digits, 1));
for (const zan of [0, 10, 1.5, NaN, null, '1']) assert.throws(() => encodeAddress('0000', zan));
assert.throws(() => decodeAddress('000003')); assert.throws(() => decodeAddress('00000'));
assert.throws(() => contextFeatures({ system: 'zhouyi', digits: '0000', zan: 1 }));
assert.throws(() => contextFeatures({ system: 'taixuan', digits: '0000', zan: 1, truth: true }));
assert.throws(() => renderText('{{unknown|text}}'));
const poisoned = clone(catalog); poisoned.entries[0].zans[0].passage.text = 'tampered';
assert.throws(() => checkCatalogSources(poisoned));

const experiment = runExperiment(catalog), events = experiment.events;
assert.equal(experiment.report.checkpoints.length, 3);
for (const cp of experiment.report.checkpoints) {
  assert.equal(cp.heldOutHeadOverlap, 0);
  for (const p of cp.profiles) {
    assert.equal(p.metrics.total, 9);
    assert.equal(p.metrics.correct + p.metrics.wrong + p.metrics.unknown, 9);
  }
}
// These are observations of the frozen pilot, not a success criterion for semantic transfer.
const first = experiment.report.checkpoints[0].profiles;
assert.equal(first[0].metrics.answered, 9); assert.equal(first[0].metrics.correct, 3);
const last = experiment.report.checkpoints.at(-1).profiles;
assert.ok(last.every(p => p.metrics.answered === 0 && p.metrics.unknown === 9));
assert.equal(last[0].predictions[0].result.reason, 'hypothesis-family-refuted');
assert.equal(last[2].predictions[0].result.reason, 'uncovered-context');
assert.ok(experiment.report.finalKnown.every(p => p.status === 'CandidateReading' && p.proposed === p.expected));

const original = events.find(e => e.id === 'taixuan-1-1');
const provenance = { by: 'Codex (OpenAI), via Mingli Yuan', basis: 'Deliberate conflict/retraction test; excluded from pilot training log.' };
const add = (es, id, payload) => [...es, learning.makeLearningEvent(es, { id, payload, provenance }, catalog)];
const conflict = add(events, 'conflict-test', { ...original.payload, label: 'adverse' });
assert.equal(learning.predictContext(conflict, 'taixuan-context-v1', original.payload.context, catalog).status, 'Contested');
const other = learning.predictContext(conflict, 'taixuan-context-v1', { system: 'taixuan', digits: '0000', zan: 5 }, catalog);
assert.equal(other.label, 'affirming'); assert.equal(other.excludedConflicts.length, 1);
const withdrawn = add(conflict, 'retract-test', { kind: 'retract', target: 'conflict-test', reason: 'Withdraw deliberate fixture.' });
assert.equal(learning.predictContext(withdrawn, 'taixuan-context-v1', original.payload.context, catalog).label, 'affirming');
const withdrawnOriginal = add(withdrawn, 'retract-original-test', { kind: 'retract', target: original.id, reason: 'Counterfactual withdrawal.' });
assert.equal(learning.predictContext(withdrawnOriginal, 'taixuan-context-v1', original.payload.context, catalog).status, 'Unknown');
assert.equal(learning.predictContext(events, 'taixuan-context-v1', original.payload.context, catalog).label, 'affirming');
assert.equal(learning.predictContext(events, 'taixuan-context-v1', original.payload.context, catalog, 0).reason, 'fuel-exhausted');
for (const fuel of [-1, 1.2, NaN, 1000001]) assert.throws(() => learning.predictContext(events, 'taixuan-context-v1', original.payload.context, catalog, fuel));
const fullyKnownTrits = { system: 'taixuan', digits: '2222', zan: 9 };
assert.equal(contextFeatures(fullyKnownTrits).jia, 2);
assert.equal(learning.predictContext(events, 'taixuan-context-v1', fullyKnownTrits, catalog).reason, 'uncovered-context');
const tampered = clone(events); tampered[3].payload.label = 'adverse'; assert.throws(() => learning.replayLearning(tampered, catalog));
assert.throws(() => learning.replayLearning(events.slice(1), catalog));
assert.throws(() => add(events, original.id, original.payload));
const badSource = clone(original.payload); badSource.source.text = 'invented'; assert.throws(() => add(events, 'bad-source', badSource));
const wrongReference = clone(original.payload); wrongReference.source.reference.start++; assert.throws(() => add(events, 'wrong-span', wrongReference));
const badFeature = clone(events[0].payload); badFeature.profile = 'bad'; badFeature.hypotheses = [['commentary']];
assert.throws(() => add(events, 'text-leakage', badFeature));
assert.throws(() => add(events, 'untyped', { ...original.payload, context: { bits: '111111', position: 1 } }));

// Compare the generalized kernel with the exact frozen implementation, not a hand-copied expected result.
const zhouyi = buildZhouyi();
const oldLog = legacy.loadLearning(path.join(ROOT, 'knowledge/changes/learning.jsonl'), zhouyi);
const compatible = createContextLearner({ schema: 'wenyan.changes.learning-event.v1',
  // This harness replays the `changes` log, whose references pin the DERIVED corpus
  // file rather than a frozen snapshot, so the parity peer must declare the same
  // source-binding policy as that log: whole-file digest drift is reported, not fatal.
  sourceBinding: 'evidence',
  features: ['bits', 'position', 'polarity', 'lower', 'upper', 'central', 'proper', 'oppositeAtCorrespondence'],
  context: c => {
    if (!c || Object.keys(c).sort().join(',') !== 'bits,position') throw new Error('invalid Zhouyi context');
    return core.lineContext(c.bits, c.position);
  }, key: c => `${c.bits}:${c.position}`, record: (c, x) => findLine(c, x.bits, x.position).line });
let parityQueries = 0;
for (let i = 0; i < oldLog.length; i++) {
  const { id, payload, provenance } = oldLog[i];
  assert.deepEqual(compatible.makeLearningEvent(oldLog.slice(0, i), { id, payload, provenance }, zhouyi), oldLog[i]);
}
for (const profile of legacy.replayLearning(oldLog, zhouyi).profiles.keys())
  for (const bits of core.hexagrams()) for (let position = 1; position <= 6; position++) {
    const c = { bits, position };
    assert.deepEqual(clone(compatible.predictContext(oldLog, profile, c, zhouyi)), clone(legacy.predictContext(oldLog, profile, c, zhouyi))); parityQueries++;
  }
assert.throws(() => learning.replayLearning(oldLog, catalog));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wenyan-taixuan-'));
try {
  const file = path.join(temp, 'learning.jsonl');
  for (const e of events) learning.appendLearning(file, e, catalog);
  assert.equal(learning.appendLearning(file, events[0], catalog).appended, false);
  assert.deepEqual(learning.loadLearning(file, catalog), events);
  assert.throws(() => learning.appendLearning(file, { ...events[0], provenance }, catalog));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

const ownPaths = ['data/taixuan/source.wiki', 'data/taixuan/source.json', 'tools/context-learning/engine.mjs',
  ...['structure', 'catalog', 'learning', 'experiment', 'ask', 'fetch-source', 'selftest'].map(n => `tools/taixuan/${n}.mjs`),
  'experiments/taixuan/contract.json', 'experiments/taixuan/annotations.json'];
const historical = JSON.parse(fs.readFileSync(path.join(ROOT, 'experiments/changes/evidence.json'), 'utf8'));
for (const [file, hash] of Object.entries(historical.sources)) assert.equal(sha256(fs.readFileSync(path.join(ROOT, file))), hash);
const report = { schema: 'wenyan.taixuan.validation.v1', runtime: process.version, corpus,
  encoding: { roundtrips: addresses.size, inquiries, spanChecks, successorChecks, twoCoordinateCarryTransitions: carryChanges },
  learning: { trainingLabels: 9, heldOutLabels: 9, wholeHeadOverlap: 0, conflictRetractionReplay: true,
    sourceAndChainTamperRejected: true, trit2DistinctFromUnknown: true, parityQueries,
    scope: 'Fixed supervisor pilot; no semantic generalization established' },
  pilot: experiment.report.checkpoints.map(c => ({ addedHead: c.addedHead, trainingExamples: c.trainingExamples,
    profiles: c.profiles.map(p => ({ profile: p.profile, metrics: p.metrics })) })),
  sources: Object.fromEntries(ownPaths.map(p => [p, sha256(fs.readFileSync(path.join(ROOT, p)))])),
  preserved: Object.fromEntries(['experiments/changes/evidence.json', 'knowledge/changes/learning.jsonl', 'experiments/relations/evidence.json']
    .map(p => [p, sha256(fs.readFileSync(path.join(ROOT, p)))])) };
const outputs = [['knowledge/taixuan/catalog.json', catalog], ['experiments/taixuan/holdout.json', experiment.report]];
if (process.argv.includes('--write')) {
  for (const [file, value] of outputs) fs.writeFileSync(path.join(ROOT, file), JSON.stringify(value, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'experiments/taixuan/evidence.json'), JSON.stringify(report, null, 2) + '\n');
  for (const e of events) learning.appendLearning(path.join(ROOT, 'knowledge/taixuan/learning.jsonl'), e, catalog);
} else {
  for (const [file, value] of outputs) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')), value);
  const recorded = JSON.parse(fs.readFileSync(path.join(ROOT, 'experiments/taixuan/evidence.json'), 'utf8'));
  assert.deepEqual({ ...recorded, runtime: report.runtime }, report);
  const log = learning.loadLearning(path.join(ROOT, 'knowledge/taixuan/learning.jsonl'), catalog);
  assert.deepEqual(log.slice(0, events.length), events); // Future append-only supervision is allowed.
}
console.log(JSON.stringify(report, null, 2));
