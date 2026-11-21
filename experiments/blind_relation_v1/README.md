# Independent lexical-construction blind relation contract v1

Status: **PreparationOnly**. This directory freezes an evaluation contract. It
contains no supervisor batch, query text, label, encrypted label envelope,
prediction, reveal, score, or candidate implementation.

## Why a new contract

The revealed v0 batch showed that the historical worker was exact on the three
frozen constructions but rejected all six independently written paraphrases.
The follow-up boundary analysis localized both lexical-only and syntax-only
failures to whole-sentence matching before learned role mappings were used.
Those 48 revealed rows and all derived probes are development data.

This contract therefore asks a narrower question: after relation-word evidence
and construction-slot evidence have been separated and frozen, can a candidate
apply both to combinations that neither it nor the explicit-coverage control
has seen as complete templates?

## Cohort and controls

An independent supervisor supplies exactly 64 rows after all systems are
frozen: 18 known constructions with fresh entities, 12 lexical holdouts, 12
syntactic holdouts, 12 combined lexical-syntactic holdouts, and 10 semantic
negative controls. The same batch is run against:

1. the historical exact-match baseline at `cba40627...4009`;
2. an explicit coverage control limited to already revealed development forms;
3. the factorized candidate.

The 54 positive rows are scored by exact ordered `(agent, recipient, theme)`
tuples. Rejection is not counted as correct on a positive row. The 10 negative
rows measure false acceptance. Coverage and accuracy among accepted rows are
reported separately so abstention cannot hide failure.

For continuity with v0, the primary reversal swaps agent and theme while
holding recipient fixed; v0 called theme the operational patient. Any
agent-recipient swap must be labelled and reported as a separate diagnostic.

## Independence and order

The implementer and a witness first pin commits, digests, runtime, receiver,
scorer and resource bounds. Only then may a supervisor who did not implement or
inspect those components produce the batch. The supervisor commits canonical
query bytes, salted label digests and an authenticated encrypted label envelope.
All three predictions are executed without network or label openings and locked
by digest before reveal. Scoring happens offline after the reveal authenticates.

Task separation inside one model family is recorded as limited independence;
it is not called independent human or organizational review.

## Advancement gate

The candidate advances only if it has no execution failure or negative false
acceptance, does not regress below the historical baseline on the known arm,
strictly exceeds both controls on combined-holdout exact accuracy, and gets a
complete declared primary reversal pair correct in at least two distinct
lexicon-construction families. No single aggregate score can waive an arm.

The next state is `SystemsFrozen`, not query generation. Before that transition,
the explicit coverage control and factorized candidate must receive immutable
commits, the evaluation envelope and budgets must be filled, and the witness
must publish their digests.
