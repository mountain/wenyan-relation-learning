# Post-freeze relation evaluation and external inference profile v0.1

Project-original synthetic cohort and implementation by Codex (OpenAI),
2026-10-12, under the repository's Unknown v0.3 contribution scope. Same-author
self-review, no independent human review and no third-party corpus intake.

This change is stacked on PR #6. The learner and all seven frozen v0 files remain
byte-identical to `452cc20718d689f9af151baede060085608d9648`. The next cohort and
initial runner/worker/checker were committed before execution at
`29b81a2439cc3f7214bc94fa6e275246417bc828`. The first run failed at import due to
a checker syntax error; its bracket was corrected before the first successful run.
The checker was subsequently hardened with strict request/type controls. Cohort,
expected labels and worker were not tuned after seeing the results. This chronology
is source auditable, but not an independently blinded evaluation: the same author
knows the synthetic grammar and role maps. The new cohort's labels are unavailable
through the worker interface, not protected against malicious filesystem access.

## What changes

v0 evaluated predictions inside its verifier. This profile adds an executable producer
inference path: `worker.py` receives an exact request envelope and returns the checked
training transcript plus predictions. Query labels are not accepted in that envelope.
`check.py` independently checks both training and inference using quoted-token
splitting, and enforces task, observer, schema, fuel and size constraints.

Request fields: schema, task, observer, training, queries, fuel. Schema is
`wenyan.external-role-inference.v0.1`; task and observer retain their v0 identities.
Each query is a text string, with no expected answer. The worker invokes the unchanged
v0 learner with training only. Inference is allowed only after Accepted training;
otherwise it returns Unknown. No historical model is automatically installed and no
native receiver/state is written. The new wrapper defines a strict profile: quoted
entities of 1–32 characters, no nested brackets or CR/LF, a fixed construction and
exactly one final full stop. It implements boundaries in the adapter rather than
silently expanding the frozen learner grammar.

The supervisor replays v0 exactly before the new campaign, thereby verifying its
DocumentaryAccepted prerequisite. That receipt remains provenance, not supervision
or admission. Native admission and native state write remain false. The external
profile has no authority to close any of v0's seven native integration conditions.

## Cohort and observations

`cohort.json` has 36 known-profile queries: two new entity triples, all six permutations
of agent/recipient/theme, each in three constructions. Entity values are disjoint from
both v0 training and v0 holdout. Eight boundary cases cover new verbs, unquoted text,
missing punctuation, trailing text, newline, excessive entity length, nested quotes
and missing slots. An independent checker checks every producer answer, then the
supervisor compares those answers with separately held synthetic expected labels.

| Check | Result |
| --- | --- |
| Frozen learner + new producer inference | 36/36 known-profile role tuples correct |
| Out-of-profile queries | 8/8 Unknown |
| No supervision | 0/36; Unknown |
| Swapped agent/recipient labels | 0/36; syntactically valid wrong maps |
| Agent and recipient collapsed to the same training entity | Unknown; multiple permutations remain |
| Output/task/authority/type/coverage and request controls | Ten rejected |

Repeated training entities are important: observational ambiguity prevents unique
identification even though the labels are consistent. Wrong but coherent supervision
can produce Accepted maps; verification checks computation, not label truth. The
boundary results show that frozen parsing limits dominate new-construction behavior.
These are finite findings, not a general language-learning or native Adva result.

## Concrete v0 verifier counterexample

Python equality treats `False == 0` and `True == 1`. Replacing a role ordinal `0`
with `false` in the JSON transcript passes the frozen verifier's structural equality.
The campaign replays this exact counterexample and records
`legacy_bool_ordinal_accepted=true`. The new checker refuses non-integer ordinals
and counts, non-boolean match flags, and native authority flags other than exact false.
The historical verifier/evidence remain unchanged for reproducibility; they must not
be used alone as a public untrusted-input receiving boundary. This is a type validation
repair, not a discovered improvement in the mathematical learning method.

## Budgets, evidence and reproduction

Linux Python 3 + standard library, Node 24/26, repository root:

```sh
python3 experiments/postfreeze_relation_v0/run.py > /tmp/postfreeze-relation-evidence.json
diff experiments/postfreeze_relation_v0/evidence.json /tmp/postfreeze-relation-evidence.json
```

Every worker runs with 18 candidate checks, 5 seconds wall, 4 seconds CPU,
128 MiB address space, 64 KiB input/output, at most 64 query strings of 256 characters.
Four new worker invocations plus the historical fixed campaign; no automatic retry
or pool expansion. Failure exits nonzero with Unknown and previously verified runs.
Hard termination does not recover unfinished worker memory. Frozen output contains
all cohort readings, the learned transcript, source/cohort/contract digests and the
negative-control roster. CI requires exact replay on both Node matrix jobs.

## Next gate

Before expanding grammar, obtain independently authored supervision or a second
reviewer for the label/observer specification, then freeze and test a richer hypothesis
family. A new verb currently needs a new adapter/profile, not a native learner claim.
Native execution still requires the receiving-side types, candidate operations,
evidence-ledger transitions, independent verifier and separate invocation/update
capabilities enumerated in v0. PR #6 remains the preserved baseline.
