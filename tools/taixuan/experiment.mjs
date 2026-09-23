// SPDX-License-Identifier: MIT
// Fixed split diagnostic; no model sees held-out labels, commentary or rationale.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, buildCatalog, findZan } from './catalog.mjs';
import { makeLearningEvent, predictContext, replayLearning } from './learning.mjs';

export function runExperiment(catalog = buildCatalog(), root = ROOT) {
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'experiments/taixuan/contract.json'), 'utf8'));
  const annotations = JSON.parse(fs.readFileSync(path.join(root, 'experiments/taixuan/annotations.json'), 'utf8'));
  assert.equal(annotations.sourceRevision, contract.sourceRevision);
  assert.equal(annotations.task, contract.task);
  assert.equal(catalog.provenance.sha256, contract.sourceSha256);
  assert.equal(annotations.labels.length, (contract.trainingHeads.length + contract.heldOutHeads.length) * contract.positions.length);
  assert.equal(new Set([...contract.trainingHeads, ...contract.heldOutHeads]).size, 6);
  const contexts = new Set(), ids = new Set();
  for (const a of annotations.labels) {
    assert.ok(!ids.has(a.id)); ids.add(a.id);
    const { entry, record } = findZan(catalog, a.context.digits, a.context.zan);
    assert.equal(a.context.system, 'taixuan'); assert.equal(a.head, entry.name);
    assert.ok(contract.positions.includes(a.context.zan)); assert.ok(Object.hasOwn(contract.labels, a.label));
    const heads = a.split === 'train' ? contract.trainingHeads : a.split === 'held-out' ? contract.heldOutHeads : [];
    assert.ok(heads.includes(a.head));
    assert.deepEqual(a.source, { kind: 'corpus', reference: record.passage.source, text: record.passage.text });
    assert.ok(typeof a.rationale === 'string' && a.rationale.length > 0);
    const key = `${a.context.digits}:${a.context.zan}`; assert.ok(!contexts.has(key)); contexts.add(key);
  }
  const events = [], checkpoints = [];
  const append = (id, payload, basis) => events.push(makeLearningEvent(events, {
    id, payload, provenance: { by: annotations.by, basis }
  }, catalog));
  for (const p of contract.profiles) append(p.id, { kind: 'profile', profile: p.id, task: contract.task,
    labels: Object.keys(contract.labels), hypotheses: [p.features] }, 'Fixed feature family from experiments/taixuan/contract.json; diagnostic pilot only.');
  const heldOut = annotations.labels.filter(a => a.split === 'held-out');
  for (const head of contract.trainingHeads) {
    for (const a of annotations.labels.filter(a => a.split === 'train' && a.head === head))
      append(a.id, { kind: 'example', profile: contract.profiles[0].id, context: a.context, label: a.label, source: a.source }, a.rationale);
    const active = replayLearning(events, catalog).active;
    const trainingDigits = new Set(active.map(a => a.context.digits));
    assert.ok(heldOut.every(a => !trainingDigits.has(a.context.digits)));
    const profiles = contract.profiles.map(p => {
      const predictions = heldOut.map(a => ({ id: a.id, head: a.head, zan: a.context.zan, expected: a.label,
        result: predictContext(events, p.id, a.context, catalog) }));
      const answers = predictions.filter(p => p.result.status === 'CandidateReading');
      const correct = answers.filter(p => p.result.label === p.expected).length;
      const metrics = { total: predictions.length, answered: answers.length, correct, wrong: answers.length - correct,
        unknown: predictions.filter(p => p.result.status === 'Unknown').length,
        coverage: answers.length / predictions.length, accuracyAmongAnswered: answers.length ? correct / answers.length : null };
      return { profile: p.id, features: p.features, metrics, predictions };
    });
    checkpoints.push({ addedHead: head, trainingExamples: active.length, trainingHeads: [...trainingDigits].map(d => catalog.entries.find(e => e.digits === d).name),
      logHead: replayLearning(events, catalog).head, heldOutHeadOverlap: 0, profiles });
  }
  const finalKnown = annotations.labels.filter(a => a.split === 'train').map(a => {
    const r = predictContext(events, 'taixuan-context-v1', a.context, catalog);
    return { id: a.id, expected: a.label, status: r.status, proposed: r.label };
  });
  return { events, report: { schema: 'wenyan.taixuan.holdout.v1', task: contract.task,
    supervision: { by: annotations.by, status: annotations.status, training: 9, heldOut: 9, blind: false },
    checkpoints, finalKnown,
    interpretation: 'Diagnostic of proposed annotations: feature refinement may memorize training contexts while abstaining on every held-out head. No semantic-transfer success is assumed.' } };
}
