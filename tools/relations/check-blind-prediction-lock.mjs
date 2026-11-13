import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const batch = path.join(root, 'experiments/blind_relation_v0/batches/2026-10-19-agent01');
const lockDir = path.join(root, 'experiments/blind_relation_v0/prediction-locks/2026-10-19-agent01');
const read = relative => fs.readFileSync(path.join(root, relative));
const json = bytes => JSON.parse(bytes.toString('utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => crypto.createHash('sha1')
  .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

const lockBytes = fs.readFileSync(path.join(lockDir, 'lock.json'));
const requestBytes = fs.readFileSync(path.join(lockDir, 'request.json'));
const predictionBytes = fs.readFileSync(path.join(lockDir, 'predictions.json'));
const queryBytes = fs.readFileSync(path.join(batch, 'queries.json'));
const lock = json(lockBytes);
const request = json(requestBytes);
const predictions = json(predictionBytes);
const queries = json(queryBytes);
const contract = json(read('experiments/blind_relation_v0/contract.json'));
const training = json(read('experiments/external_relation_v0/train.json'));

assert.equal(lock.schema, 'wenyan.blind-relation.prediction-lock.v1');
assert.equal(lock.batch_id, '2026-10-19-agent01');
assert.equal(lock.status, 'PredictionsCommitted');
assert.equal(lock.cohort_commit, '5c1af139129f56f9870bcdab769f8589f6cd65d5');
assert.equal(lock.tested_baseline_commit, contract.baseline.commit);
assert.equal(sha256(queryBytes), lock.queries_sha256);
assert.equal(sha256(requestBytes), lock.request_sha256);
assert.equal(sha256(predictionBytes), lock.predictions_sha256);
assert.equal(lock.labels_revealed, false);
assert.equal(lock.label_opening_accessed, false);
assert.equal(lock.scores, 'NotRun');
assert.equal(lock.authority.native_admission, false);
assert.equal(lock.authority.native_state_write, false);
assert.equal(lock.attempts.length, 2);
assert.equal(lock.attempts[0].predictions_sha256, lock.predictions_sha256);
assert.equal(lock.attempts[1].predictions_sha256, lock.predictions_sha256);

for (const [relative, expected] of Object.entries(contract.baseline.git_blobs)) {
  assert.equal(gitBlob(read(relative)), expected, `baseline blob drift: ${relative}`);
}

assert.deepEqual(Object.keys(request).sort(),
  ['fuel', 'observer', 'queries', 'schema', 'task', 'training']);
assert.equal(request.schema, contract.identity.learner_schema);
assert.equal(request.task, contract.identity.task);
assert.equal(request.observer, contract.identity.observer);
assert.equal(request.fuel, contract.budget.fuel);
assert.deepEqual(request.training, training);
assert.deepEqual(request.queries, queries.map(row => row.text));
assert.equal(request.queries.length, 48);

assert.equal(predictions.schema, request.schema);
assert.equal(predictions.task, request.task);
assert.equal(predictions.observer, request.observer);
assert.equal(predictions.native_admission, false);
assert.equal(predictions.native_state_write, false);
assert.equal(predictions.answers.length, 48);
const known = predictions.answers.filter(row => row.status === 'KnownFiniteGrammar').length;
const unknown = predictions.answers.filter(row => row.status === 'Unknown').length;
assert.deepEqual(lock.counts_without_labels, {
  queries: 48,
  known_finite_grammar: known,
  unknown,
  execution_failures: 0,
});

const py = [
  'import json,sys',
  'sys.path.insert(0,"experiments/postfreeze_relation_v0")',
  'import strict_check',
  `req=json.load(open(${JSON.stringify(path.relative(root, path.join(lockDir, 'request.json')))}))`,
  `out=json.load(open(${JSON.stringify(path.relative(root, path.join(lockDir, 'predictions.json')))}))`,
  'strict_check.verify(req,out)',
].join(';');
const checked = spawnSync('python3', ['-c', py], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
});
assert.equal(checked.status, 0, checked.stderr || checked.stdout);

if (process.argv.includes('--selftest')) {
  const changed = Buffer.from(predictionBytes);
  changed[changed.length - 2] ^= 1;
  assert.notEqual(sha256(changed), lock.predictions_sha256);
}

console.log(JSON.stringify({
  status: lock.status,
  batch: lock.batch_id,
  queries: request.queries.length,
  knownFiniteGrammar: known,
  unknown,
  predictionsSha256: lock.predictions_sha256,
  labelsRevealed: false,
  scores: 'NotRun',
}));
