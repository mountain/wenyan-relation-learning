import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(here, "../../experiments/blind_relation_v1/contract.json");

function validate(contract) {
  assert.equal(contract.schema, "wenyan.independent-blind-relation.v1");
  assert.equal(contract.status, "PreparationOnly");
  assert.equal(contract.historical_evidence.baseline_commit, "cba40627ca9ce49dcbd89527f1d904debad14009");

  const arms = new Map(contract.cohort.arms.map((arm) => [arm.id, arm]));
  assert.equal(contract.cohort.total, 64);
  assert.equal([...arms.values()].reduce((sum, arm) => sum + arm.count, 0), 64);
  assert.equal(arms.get("known-construction-new-entities").count, 18);
  assert.equal(arms.get("lexicon-only-holdout").count, 12);
  assert.equal(arms.get("syntax-only-holdout").count, 12);
  assert.equal(arms.get("combined-lexicon-syntax-holdout").count, 12);
  assert.equal(arms.get("semantic-negative-boundary").count, 10);
  assert.equal(arms.get("semantic-negative-boundary").positive, false);

  assert.deepEqual(contract.roles.ordered_tuple, ["agent", "recipient", "theme"]);
  assert.deepEqual(contract.roles.legacy_primary_reversal.swap, ["agent", "theme"]);
  assert.equal(contract.roles.legacy_primary_reversal.fixed, "recipient");

  assert.deepEqual(contract.systems.map((system) => system.id), [
    "historical-exact-match-baseline",
    "explicit-development-coverage-control",
    "factorized-candidate"
  ]);
  assert.deepEqual(contract.sequence, [
    "PreparationOnly",
    "SystemsFrozen",
    "LabelsCommitted",
    "PredictionsLocked",
    "LabelsRevealed",
    "Scored"
  ]);
  assert.equal(contract.success.execution_failures, 0);
  assert.equal(contract.success.semantic_negative_false_acceptances, 0);
  assert.equal(contract.commitment.labels.includes("AES-256-GCM"), true);
  assert.equal(contract.independence.supervisor.includes("Must not implement"), true);
  assert.equal(contract.nonclaims.includes("sixty-four hexagrams equal sixty-four tautologies"), true);
  return true;
}

const original = JSON.parse(fs.readFileSync(contractPath, "utf8"));
validate(original);

if (process.argv.includes("--selftest")) {
  const mutations = [
    (x) => { x.status = "Scored"; },
    (x) => { x.cohort.total = 63; },
    (x) => { x.cohort.arms[3].count = 11; },
    (x) => { x.roles.legacy_primary_reversal.swap = ["agent", "recipient"]; },
    (x) => { x.sequence[3] = "LabelsRevealed"; },
    (x) => { x.systems[0].id = "moving-baseline"; },
    (x) => { x.success.semantic_negative_false_acceptances = 1; }
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() => validate(changed));
  }
}

process.stdout.write(JSON.stringify({
  schema: original.schema,
  status: original.status,
  total: original.cohort.total,
  arms: original.cohort.arms.length,
  systems: original.systems.length
}) + "\n");
