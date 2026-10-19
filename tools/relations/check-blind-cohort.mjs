import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const batch = path.join(root, 'experiments/blind_relation_v0/batches/2026-10-19-agent01');
// Supervisor's exact public commitment bytes; no labels or opening secrets read.
const commitmentSha256 = '60ff6f8b3d390aa2ec4a6a71f2bcf5ac194ff7f27b733fb42378fe77d824102e';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) => {
  assert.equal(typeof value, 'object');
  assert.ok(value !== null && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};

function verify(cBytes, qBytes, eBytes) {
  assert.equal(digest(cBytes), commitmentSha256, 'commitment drift');
  const c = JSON.parse(cBytes);
  const q = JSON.parse(qBytes);
  const e = JSON.parse(eBytes);
  assert.equal(c.batch_id, '2026-10-19-agent01');
  assert.equal(c.status, 'LabelsCommitted');
  assert.equal(c.baseline_commit, 'cba40627ca9ce49dcbd89527f1d904debad14009');
  assert.equal(c.preregistration_git_blob, '9576593c667f6103b6dcffa982e036ca139392f0');
  assert.equal(digest(qBytes), c.queries_sha256, 'query bytes drift');
  assert.equal(qBytes.length, c.queries_byte_length);
  assert.equal(digest(eBytes), c.encryption.envelope_sha256, 'envelope bytes drift');
  assert.equal(c.counts.total, 48);
  assert.equal(c.counts.in_profile, 36);
  assert.equal(c.counts.paraphrase_or_boundary, 12);
  assert.equal(c.counts.entity_triples, 2);
  assert.equal(c.counts.constructions, 3);
  assert.equal(c.counts.permutations_per_triple_per_construction, 6);
  assert.equal(c.supervisor.independent_human_review, false);
  assert.equal(c.supervisor.independent_organizational_review, false);
  assert.equal(c.authority.native_admission, false);
  assert.equal(c.authority.native_state_write, false);
  assert.equal(c.labels_commitment.algorithm, 'SHA-256');
  assert.match(c.labels_commitment.digest, /^[0-9a-f]{64}$/);
  assert.equal(c.labels_commitment.salt_bytes, 32);
  assert.ok(Number.isInteger(c.labels_commitment.labels_byte_length));
  assert.ok(c.labels_commitment.labels_byte_length > 0);
  assert.equal(c.encryption.algorithm, 'AES-256-GCM');
  assert.equal(e.algorithm, c.encryption.algorithm);
  assert.equal(e.aad_utf8, c.encryption.aad);
  exactKeys(e, ['schema', 'algorithm', 'nonce_base64', 'ciphertext_base64', 'tag_base64', 'aad_utf8']);
  function decode(s) {
    assert.equal(typeof s, 'string');
    const bytes = Buffer.from(s, 'base64');
    assert.equal(bytes.toString('base64'), s, 'noncanonical base64');
    return bytes;
  }
  assert.equal(decode(e.nonce_base64).length, 12);
  assert.equal(decode(e.tag_base64).length, 16);
  assert.equal(decode(e.ciphertext_base64).length, c.labels_commitment.labels_byte_length);
  assert.ok(Array.isArray(q));
  assert.equal(q.length, 48);
  const ids = new Set();
  for (const row of q) {
    exactKeys(row, ['id', 'text']);
    assert.equal(typeof row.id, 'string');
    assert.ok(row.id.length > 0 && !ids.has(row.id), 'empty/duplicate query id');
    ids.add(row.id);
    assert.equal(typeof row.text, 'string');
    assert.ok(row.text.length > 0 && [...row.text].length <= 256);
  }
  assert.ok(qBytes.length < 65536);
  // Surface-entity freshness is checkable without opening the sealed labels.
  const quoted = text => [...text.matchAll(/「([^」]+)」/gu)].map(m => m[1]);
  const historicalEntities = new Set([
    'experiments/external_relation_v0/train.json',
    'experiments/external_relation_v0/holdout.json',
    'experiments/postfreeze_relation_v0/cohort.json'
  ].flatMap(p => quoted(fs.readFileSync(path.join(root, p), 'utf8'))));
  for (const row of q) {
    for (const entity of quoted(row.text)) {
      assert.equal(historicalEntities.has(entity), false, 'historical entity reuse');
    }
  }
  return {status: 'BlindLabelsCommitmentAccepted', batch_id: c.batch_id,
    queries: q.length, predictions: 'NotRun', scores: 'NotRun',
    supervision: 'TaskIsolatedAI', independent_human_review: false,
    native_admission: false, native_state_write: false};
}

const cBytes = fs.readFileSync(path.join(batch, 'commitment.json'));
const qBytes = fs.readFileSync(path.join(batch, 'queries.json'));
const eBytes = fs.readFileSync(path.join(batch, 'encrypted-labels.json'));
const result = verify(cBytes, qBytes, eBytes);
// Only these four supervisor artifacts and the receiving README may be public.
assert.deepEqual(fs.readdirSync(batch).sort(), [
  'README.md', 'commitment.json', 'encrypted-labels.json', 'queries.json',
  'supervisor-attestation.md'
].sort(), 'unexpected batch artifact; labels, keys, salts and predictions are forbidden');

if (process.argv.includes('--selftest')) {
  const mutate = (bytes, fn) => { const j = JSON.parse(bytes); fn(j); return Buffer.from(JSON.stringify(j)); };
  const bad = [
    [mutate(cBytes, c => c.status = 'Executed'), qBytes, eBytes],
    [mutate(cBytes, c => c.labels_commitment.digest = '0'.repeat(64)), qBytes, eBytes],
    [cBytes, mutate(qBytes, q => q[0].text += '变'), eBytes],
    [cBytes, mutate(qBytes, q => q[0].roles = [0, 1, 2]), eBytes],
    [cBytes, mutate(qBytes, q => q.pop()), eBytes],
    [cBytes, qBytes, mutate(eBytes, e => e.key = 'forbidden')],
    [cBytes, qBytes, mutate(eBytes, e => e.tag_base64 = Buffer.alloc(16).toString('base64'))]
  ];
  for (const args of bad) assert.throws(() => verify(...args));
  result.byte_binding_negative_controls = bad.length;
}
console.log(JSON.stringify(result, null, 2));
