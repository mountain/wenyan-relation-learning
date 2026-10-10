// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const contractPath = resolve(
  root,
  "experiments/relations/receiving-contract-v0.1.json"
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameMembers(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

function validate(contract, evidence, evidenceBytes) {
  assert.equal(
    contract.schema,
    "wenyan.relation-evidence-receiving-contract.v1"
  );
  assert.equal(contract.revision, 1);
  assert.ok(evidenceBytes.length <= contract.input.max_bytes);
  assert.equal(sha256(evidenceBytes), contract.input.sha256);

  assert.equal(evidence.schema, contract.input.schema);
  assert.equal(evidence.source.repository, contract.input.repository);
  assert.equal(evidence.source.commit, contract.input.source_commit);
  assert.deepEqual(evidence.source.gitBlobShas, contract.required_source_blobs);
  assert.equal(evidence.retainedEvidence.unchanged, true);
  assert.match(evidence.scope, /not .*native Adva admission/i);

  sameMembers(
    evidence.comparison.differingTopLevelFields,
    ["runtime", "sha256"],
    "only runtime and source hashes may differ from retained evidence"
  );
  sameMembers(
    evidence.comparison.sourceHashDifferences.map((item) => item.path),
    [
      "src/inscription/reverse.ts",
      "src/inscription/pipeline.ts",
      "src/inscription/relations.ts",
      "experiments/relations/run.cjs"
    ],
    "the four disclosed source-hash differences must remain explicit"
  );

  const result = evidence.freshEvidence;
  const required = contract.required_result;
  assert.equal(result.schema, "wenyan.relation-calibration.evidence.v1");
  assert.equal(result.status, required.status);
  assert.equal(result.training, required.training);
  assert.equal(result.heldOutEntities, required.held_out_entities);
  assert.equal(result.positivePairs, required.positive_pairs);
  assert.equal(result.roleReversals, required.role_reversals);
  assert.equal(
    result.legacyHypothesisCollisions,
    required.legacy_hypothesis_collisions
  );
  sameMembers(result.controls, required.controls, "control set must be exact");
  assert.equal(result.updates.length, required.training);
  assert.equal(result.model.examples.length, required.training);
  assert.equal(result.receipts.length, required.positive_pairs);
  for (const receipt of result.receipts) {
    assert.equal(receipt.positive, "SameRelation");
    assert.equal(receipt.negative, "RoleReversal");
  }
  assert.ok(
    result.limitations.includes(
      "external Adva-policy adapter, not native learn"
    )
  );

  assert.equal(contract.authority.scope, "external-evidence-only");
  assert.equal(contract.authority.native_admission, false);
  assert.equal(contract.authority.may_select_or_invoke_adva_learner, false);
  assert.equal(contract.authority.may_promote_semantic_claims, false);

  return {
    schema: "wenyan.relation-evidence-receipt.v1",
    status: contract.authority.accepted_status,
    contract_sha256: sha256(readFileSync(contractPath)),
    evidence_sha256: sha256(evidenceBytes),
    source_commit: evidence.source.commit,
    result: {
      training: result.training,
      positive_pairs: result.positivePairs,
      role_reversals: result.roleReversals,
      controls: result.controls.length
    },
    authority: {
      scope: contract.authority.scope,
      native_admission: false
    }
  };
}

function expectReject(contract, evidence, evidenceBytes, mutate) {
  const changedContract = structuredClone(contract);
  const changedEvidence = structuredClone(evidence);
  mutate(changedContract, changedEvidence);
  assert.throws(() => validate(changedContract, changedEvidence, evidenceBytes));
}

const contractBytes = readFileSync(contractPath);
const contract = JSON.parse(contractBytes);
const evidencePath = resolve(root, contract.input.path);
const evidenceBytes = readFileSync(evidencePath);
const evidence = JSON.parse(evidenceBytes);

const receipt = validate(contract, evidence, evidenceBytes);

if (process.argv.includes("--selftest")) {
  expectReject(contract, evidence, evidenceBytes, (_contract, item) => {
    item.source.commit = "0".repeat(40);
  });
  expectReject(contract, evidence, evidenceBytes, (_contract, item) => {
    item.freshEvidence.roleReversals = 8;
  });
  expectReject(contract, evidence, evidenceBytes, (_contract, item) => {
    item.freshEvidence.controls = item.freshEvidence.controls.filter(
      (name) => name !== "out-of-grammar"
    );
  });
  expectReject(contract, evidence, evidenceBytes, (_contract, item) => {
    item.scope = "native Adva admission";
  });
  expectReject(contract, evidence, evidenceBytes, (item) => {
    item.authority.native_admission = true;
  });
  const tamperedBytes = Buffer.from(
    evidenceBytes.toString("utf8").replace(
      '"roleReversals": 9',
      '"roleReversals": 8'
    )
  );
  assert.throws(() =>
    validate(contract, JSON.parse(tamperedBytes), tamperedBytes)
  );
}

process.stdout.write(JSON.stringify(receipt) + "\n");
