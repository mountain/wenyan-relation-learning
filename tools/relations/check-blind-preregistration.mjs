import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractPath = path.join(root, "experiments/blind_relation_v0/contract.json");
const expectedContractBlob = "9576593c667f6103b6dcffa982e036ca139392f0";
const premature = [
  "experiments/blind_relation_v0/cohort.json",
  "experiments/blind_relation_v0/labels.json",
  "experiments/blind_relation_v0/predictions.json",
  "experiments/blind_relation_v0/results.json"
];

function gitBlob(bytes) {
  return crypto.createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
}

function checkContractBytes(bytes) {
  assert.equal(gitBlob(bytes), expectedContractBlob, "preregistration contract drift");
  const c = JSON.parse(bytes.toString("utf8"));
  assert.equal(c.schema, "wenyan.blind-relation-preregistration.v0");
  assert.equal(c.status, "PreparationOnly");
  assert.equal(c.baseline.repository, "mountain/wenyan-relation-learning");
  assert.equal(c.baseline.commit, "cba40627ca9ce49dcbd89527f1d904debad14009");
  assert.equal(c.blind_protocol.supervisor_status, "Unselected");
  for (const key of [
    "implementation_author_must_not_author_or_modify_labels",
    "supervisor_must_not_see_predictions_before_label_commitment",
    "prediction_digest_precedes_label_disclosure",
    "learner_receives_training_and_unlabelled_queries_only",
    "evaluation_process_must_not_access_labels_or_network",
    "all_unknown_and_failures_retained",
    "any_tuning_invalidates_cohort_for_final_evaluation"
  ]) assert.equal(c.blind_protocol[key], true, key);
  assert.equal(c.cohort_plan.in_profile_minimum, 36);
  assert.equal(c.cohort_plan.paraphrase_or_boundary_minimum, 12);
  assert.equal(c.cohort_plan.cohort_files_present, false);
  assert.equal(c.cohort_plan.labels_present, false);
  assert.equal(c.cohort_plan.predictions_present, false);
  assert.deepEqual(c.authority, {
    documentary_receipt_only: true,
    native_admission: false,
    native_state_write: false
  });
  assert.equal(c.budget.maximum_queries, 64);
  assert.equal(c.budget.fuel, 18);
  assert.equal(c.budget.automatic_retry, false);
  return c;
}

function verify() {
  const bytes = fs.readFileSync(contractPath);
  const c = checkContractBytes(bytes);
  for (const [relative, expected] of Object.entries(c.baseline.git_blobs)) {
    const actual = gitBlob(fs.readFileSync(path.join(root, relative)));
    assert.equal(actual, expected, `baseline blob drift: ${relative}`);
  }
  for (const relative of premature) {
    assert.equal(fs.existsSync(path.join(root, relative)), false, `premature blind artifact: ${relative}`);
  }
  return {
    status: "BlindRelationPreregistrationFrozen",
    baseline_commit: c.baseline.commit,
    bound_blobs: Object.keys(c.baseline.git_blobs).length,
    supervisor_status: c.blind_protocol.supervisor_status,
    cohort_files_present: false,
    labels_present: false,
    predictions_present: false,
    native_admission: false,
    native_state_write: false
  };
}

if (process.argv.includes("--selftest")) {
  const raw = fs.readFileSync(contractPath, "utf8");
  const mutations = [
    ['"PreparationOnly"', '"Executed"'],
    ['"Unselected"', '"Selected"'],
    ['"commit": "cba40627ca9ce49dcbd89527f1d904debad14009"', '"commit": "other"'],
    ['"in_profile_minimum": 36', '"in_profile_minimum": 0'],
    ['"paraphrase_or_boundary_minimum": 12', '"paraphrase_or_boundary_minimum": 0'],
    ['"prediction_digest_precedes_label_disclosure": true', '"prediction_digest_precedes_label_disclosure": false'],
    ['"all_unknown_and_failures_retained": true', '"all_unknown_and_failures_retained": false'],
    ['"native_admission": false', '"native_admission": true'],
    ['"native_state_write": false', '"native_state_write": true']
  ];
  for (const [from, to] of mutations) {
    assert.notEqual(raw.indexOf(from), -1, `missing mutation target: ${from}`);
    assert.throws(() => checkContractBytes(Buffer.from(raw.replace(from, to))));
  }
  const result = verify();
  console.log(JSON.stringify({ ...result, negative_controls: mutations.length }, null, 2));
} else {
  console.log(JSON.stringify(verify(), null, 2));
}
