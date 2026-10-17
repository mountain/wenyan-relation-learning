# Independent-supervision relation evaluation v0

Status: `PreparationOnly`. No cohort, label file, prediction, score, or independent-supervision claim exists in this change.

This preregistration freezes the parts of the next experiment that do not require an independent supervisor. It binds the tested mainline at `cba40627ca9ce49dcbd89527f1d904debad14009`, the external learner, producer and strict receiver by Git blob; fixes task identity, budgets, metrics, ordering and failure retention; and keeps native authority false.

## Why this is separate

The merged v0/v0.1 results use project-authored synthetic labels and a known three-construction grammar. They verify a finite mechanism and receiving boundary. They are not an independently authored blind evaluation. This directory must not retroactively rename them as one.

## Required execution order

1. Select a supervisor who did not implement the learner, producer or checker.
2. Without seeing predictions, the supervisor authors:
   - at least 36 in-profile queries covering all six role permutations for all three frozen constructions with new entities;
   - at least 12 independently worded paraphrase or grammar-boundary queries.
3. Commit the query text and a cryptographic commitment to labels. Do not expose labels to the implementation or prediction environment.
4. Run the frozen baseline without network or label access. Retain every `Unknown`, failure and partial record.
5. Commit a digest of predictions before disclosing labels.
6. Disclose labels, score every row, and report all preregistered metrics separately.
7. If code, grammar, labels, thresholds or metrics are tuned after inspecting results, classify the batch as development data and obtain a fresh final cohort.

The paraphrase/boundary arm is explicitly diagnostic: the frozen parser may return `Unknown`. No successful synonym generalization is assumed.

## Authority boundary

A documentary receipt binds provenance only. This experiment cannot grant native Adva admission or native state-write authority. It also does not alter the separate “64 configurations / 64 moods” encoding boundary or turn those moods into 64 tautologies.

## Check

```sh
node tools/relations/check-blind-preregistration.mjs --selftest
```

The checker verifies the exact contract, referenced Git blobs, absence of premature cohort/label/prediction files, and mutation refusals. The next legitimate change is supervisor selection and committed input/label digests—not fabricated independent labels.
