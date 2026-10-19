# First committed blind cohort: 2026-10-19-agent01

Stage: `LabelsCommitted`; predictions and scoring: `NotRun`.

The user requested a supervisor who did not implement the learner or checker.
A fresh Codex agent, with no inherited conversation, authored the queries and
sealed labels after receiving only the public protocol and training examples.
It did not read implementation sources, existing held-out data, evidence or
predictions. See [its attestation](supervisor-attestation.md) for the exact
input inventory, annotation decisions and limitations. A separate task using
the same model family is not independent human or organizational review.

## Public and sealed artifacts

- `queries.json` contains only opaque identifiers and unlabelled text, in
  randomized order. The supervisor reports 36 in-profile queries (two new
  entity triples, three constructions, six role permutations) plus 12
  independently authored paraphrase or grammar-boundary diagnostics.
- `commitment.json` binds exact query bytes, the tested learner baseline
  `cba40627ca9ce49dcbd89527f1d904debad14009`, the original preregistration
  contract blob, a domain-separated salted label commitment and the encrypted
  envelope. Counts and semantic coverage are supervisor attestations;
  the receiving check does not read the labels to verify them.
- `encrypted-labels.json` holds AES-256-GCM ciphertext and public nonce/tag/AAD.
  Its key, the random commitment salt, annotation metadata and exact plaintext
  label bytes are held in a separate private opening package. They must not
  be included in a prediction checkout or execution environment.

The integrating agent received the public files without reading or modifying
the plaintext labels or opening secrets. The supervisor used the shared host;
this is a recorded workflow separation, not an operating-system access-control
or adversarial sandbox claim. Shared model priors remain a limitation.

## Next gate

1. Freeze the public cohort commit before running any new predictions.
2. Execute the pinned baseline in a clean environment containing only frozen
   training inputs and the unlabelled query file; no labels, opening bundle,
   decryption key, network access or additional data. Do not tune the baseline.
3. Preserve every output, `Unknown`, error and failure, and commit the exact
   prediction digest before retrieving the private opening package.
4. Only then disclose and verify the salt/labels against the commitment and
   decrypt/reproduce the AES-GCM envelope. Score all rows with the registered
   metrics and retain ambiguous/boundary annotations and failure records.

No prediction, decryption, scoring, native Adva admission or state write is
performed by this change. CI replays only historical fixtures, not this cohort.

## Receiving check

```sh
node tools/relations/check-blind-preregistration.mjs --selftest
node tools/relations/check-blind-cohort.mjs --selftest
```

The cohort check binds the exact supervisor commitment/query/envelope bytes,
validates the public shape, count, ciphertext dimensions and authority fields,
and refuses unexpected batch files. It cannot verify label correctness or
semantic coverage until a later, prediction-locked reveal.

Authorship: supervisor annotations and public batch artifacts by a task-isolated
Codex agent (OpenAI); receiving check, integration and this README by the
integrating Codex agent. Mingli Yuan supplied direction and authorization.
