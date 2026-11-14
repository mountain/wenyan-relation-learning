import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const batch = path.join(root, 'experiments/blind_relation_v0/batches/2026-10-19-agent01');
const lockDir = path.join(root, 'experiments/blind_relation_v0/prediction-locks/2026-10-19-agent01');
const reveal = path.join(root, 'experiments/blind_relation_v0/reveals/2026-10-19-agent01');
const bytes = file => fs.readFileSync(file);
const json = file => JSON.parse(bytes(file).toString('utf8'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const tuple = intended => intended === null ? null
  : [intended.agent, intended.recipient, intended.theme];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const queryBytes = bytes(path.join(batch, 'queries.json'));
const commitment = json(path.join(batch, 'commitment.json'));
const envelopeBytes = bytes(path.join(batch, 'encrypted-labels.json'));
const envelope = JSON.parse(envelopeBytes.toString('utf8'));
const lock = json(path.join(lockDir, 'lock.json'));
const predictionBytes = bytes(path.join(lockDir, 'predictions.json'));
const predictions = JSON.parse(predictionBytes.toString('utf8'));
const labelBytes = bytes(path.join(reveal, 'labels.json'));
const labels = JSON.parse(labelBytes.toString('utf8'));
const secrets = json(path.join(reveal, 'opening-secrets.json'));
const queries = JSON.parse(queryBytes.toString('utf8'));

assert.equal(lock.status, 'PredictionsCommitted');
assert.equal(lock.labels_revealed, false);
assert.equal(lock.scores, 'NotRun');
assert.equal(sha256(predictionBytes), lock.predictions_sha256);
assert.equal(commitment.batch_id, lock.batch_id);
assert.equal(commitment.status, 'LabelsCommitted');
assert.equal(sha256(queryBytes), commitment.queries_sha256);
assert.equal(labels.queries_sha256, commitment.queries_sha256);
assert.equal(labelBytes.length, commitment.labels_commitment.labels_byte_length);
assert.equal(envelope.aad_utf8, commitment.encryption.aad);
assert.equal(sha256(envelopeBytes), commitment.encryption.envelope_sha256);

const domain = Buffer.from(commitment.labels_commitment.domain_hex, 'hex');
const salt = Buffer.from(secrets.salt_hex, 'hex');
const length = Buffer.alloc(8);
length.writeBigUInt64BE(BigInt(labelBytes.length));
assert.equal(salt.length, commitment.labels_commitment.salt_bytes);
assert.equal(sha256(Buffer.concat([domain, salt, length, labelBytes])),
  commitment.labels_commitment.digest);

const key = Buffer.from(secrets.aes_256_gcm_key_hex, 'hex');
const nonce = Buffer.from(envelope.nonce_base64, 'base64');
const tag = Buffer.from(envelope.tag_base64, 'base64');
const ciphertext = Buffer.from(envelope.ciphertext_base64, 'base64');
assert.equal(key.length, 32);
assert.equal(nonce.length, commitment.encryption.nonce_bytes);
assert.equal(tag.length, commitment.encryption.tag_bytes);
const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
decipher.setAAD(Buffer.from(envelope.aad_utf8, 'utf8'));
decipher.setAuthTag(tag);
const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
assert.deepEqual(decrypted, labelBytes);

assert.equal(queries.length, 48);
assert.equal(labels.records.length, queries.length);
assert.equal(predictions.answers.length, queries.length);
const labelById = new Map(labels.records.map(record => [record.id, record]));
assert.equal(labelById.size, labels.records.length);

const rows = queries.map((query, index) => {
  const label = labelById.get(query.id);
  assert.ok(label, `missing label: ${query.id}`);
  assert.equal(label.text, query.text);
  const answer = predictions.answers[index];
  const valid = answer && (answer.status === 'KnownFiniteGrammar' || answer.status === 'Unknown');
  const actual = answer?.status === 'KnownFiniteGrammar' ? answer.roles : null;
  const expected = tuple(label.intended);
  const exact = answer?.status === 'KnownFiniteGrammar' && expected !== null && same(actual, expected);
  const failure = !valid;
  const falseAcceptance = answer?.status === 'KnownFiniteGrammar'
    && (!label.unique_relation || !exact);
  return {
    id: query.id,
    arm: label.arm,
    parser_scope_expectation: label.parser_scope_expectation,
    unique_relation: label.unique_relation,
    intended_roles: expected,
    prediction: answer ?? null,
    exact_role_match: exact,
    false_acceptance: falseAcceptance,
    execution_failure: failure,
  };
});
const rowById = new Map(rows.map(row => [row.id, row]));

const arms = name => rows.filter(row => row.arm === name);
const inProfile = arms('in_profile');
const paraphrase = arms('paraphrase');
const boundary = arms('boundary');
assert.equal(inProfile.length, 36);
assert.equal(paraphrase.length, 6);
assert.equal(boundary.length, 6);

const exactInProfile = inProfile.filter(row => row.exact_role_match).length;
const pairKeys = new Set();
let reversalSuccess = 0;
for (const label of labels.records.filter(row => row.arm === 'in_profile')) {
  const partnerId = label.reversal_links.agent_theme;
  assert.equal(typeof partnerId, 'string');
  const pair = [label.id, partnerId].sort();
  const keyName = pair.join('\0');
  if (pairKeys.has(keyName)) continue;
  pairKeys.add(keyName);
  const partner = labelById.get(partnerId);
  assert.ok(partner && partner.reversal_links.agent_theme === label.id);
  const left = tuple(label.intended);
  const right = tuple(partner.intended);
  const relationIsReversed = left[0] === right[2]
    && left[1] === right[1]
    && left[2] === right[0];
  const predictionsCorrect = rowById.get(label.id).exact_role_match
    && rowById.get(partnerId).exact_role_match;
  if (relationIsReversed && predictionsCorrect) reversalSuccess += 1;
}
assert.equal(pairKeys.size, 18);

const paraphraseKnown = paraphrase.filter(row => row.prediction?.status === 'KnownFiniteGrammar');
const paraphraseUnknown = paraphrase.filter(row => row.prediction?.status === 'Unknown');
const boundaryUnknown = boundary.filter(row => row.prediction?.status === 'Unknown');
const diagnostics = [...paraphrase, ...boundary];
const failures = rows.filter(row => row.execution_failure);
const failureBreakdown = Object.fromEntries(['in_profile', 'paraphrase', 'boundary']
  .map(arm => [arm, failures.filter(row => row.arm === arm).length]));

const result = {
  schema: 'wenyan.blind-relation.scored-result.v1',
  batch_id: lock.batch_id,
  status: 'Scored',
  prediction_lock: {
    commit: 'a75492d914d09524d8e8220ac80e196d8ad73ce7',
    sha256: lock.predictions_sha256,
  },
  opening_verification: {
    public_query_bytes_match: true,
    salted_label_commitment_match: true,
    encrypted_envelope_sha256_match: true,
    aes_256_gcm_authenticated_decryption_match: true,
    row_id_and_text_correspondence_match: true,
  },
  metrics: {
    in_profile_role_accuracy: {
      numerator: exactInProfile,
      denominator: inProfile.length,
      rate: exactInProfile / inProfile.length,
    },
    agent_patient_reversal_consistency: {
      operational_patient: 'theme',
      numerator: reversalSuccess,
      denominator: pairKeys.size,
      rate: reversalSuccess / pairKeys.size,
    },
    paraphrase_known_finite_grammar_count: paraphraseKnown.length,
    paraphrase_exact_tuple_among_accepted: {
      numerator: paraphraseKnown.filter(row => row.exact_role_match).length,
      denominator: paraphraseKnown.length,
      rate: paraphraseKnown.length
        ? paraphraseKnown.filter(row => row.exact_role_match).length / paraphraseKnown.length
        : null,
    },
    paraphrase_unknown_count: paraphraseUnknown.length,
    boundary_unknown_rate: {
      numerator: boundaryUnknown.length,
      denominator: boundary.length,
      rate: boundaryUnknown.length / boundary.length,
    },
    false_acceptance_count: {
      total: diagnostics.filter(row => row.false_acceptance).length,
      paraphrase: paraphrase.filter(row => row.false_acceptance).length,
      boundary: boundary.filter(row => row.false_acceptance).length,
    },
    execution_failure_count: {
      total: failures.length,
      by_arm: failureBreakdown,
    },
  },
  boundaries: {
    finite_three_construction_external_profile_only: true,
    independent_human_review: false,
    native_admission: false,
    native_state_write: false,
    general_wenyan_understanding_claimed: false,
  },
  rows,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
