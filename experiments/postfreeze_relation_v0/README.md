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

## Integration audit and strict receiving entry (2026-10-14)

`strict_check.verify(request, decoded_output)` is the current untrusted JSON
receiving entry. It checks exact dict/list/string/integer/boolean types and field
sets at every level, bounded JSON depth/nodes/bytes, list shapes and role
permutations, then reconstructs the entire training transcript and inference.
It imports no worker or learner. The profile parser is reused from the frozen
v0.1 checker; it is independent of the producer's regular expressions, but this
reuse is not a separately authored third-party grammar specification. Explicit
verdict comparisons remain active under Python `-O`. Frozen `verify.py` and
`check.py` remain historical replay components, not standalone receiving gates.
The existing two campaign outputs and their source hashes are untouched.

`strict_selftest.py` runs the actual worker and independently checks the complete
2 entity triples × 6 permutations × 3 constructions and all eight boundary cases.
It verifies entity separation, train-only learner calls, 22 valid transcripts
(including every fuel value 0–18, ambiguity and contradiction), 5,700 rejected type
or value changes and 336 rejected structure changes. Both normal Python and `-O`
execute the same checks in Node 24/26 CI. The counters enumerate deterministic
mutations, not statistical confidence or exhaustive coverage of all possible JSON.
Four legacy forgeries are reproduced: bool ordinal, float ordinal, float count,
and integer match flag. None passes the new receiver. Parsing boundary probes
compare the distinct worker/checker implementations on quotes, line breaks,
entity lengths and terminal punctuation. The train-only interface audit is not
an adversarial filesystem sandbox.

The main/#6 conflict was exclusively in the CI workflow. Integration keeps the
main interface-selection selftest and both experiment replays. #6 is integrated
first, preserving its baseline identity; #7 is then retargeted to main and checked
against the merged tree. No dependency lock, native receiving policy or historical
DocumentaryAccepted receipt is changed.

### Mathematical scope

Within a predeclared three-slot construction and its six permutation hypotheses,
a labelled example with three distinct entities uniquely determines the role map.
The checker verifies exhaustive elimination and charged work. Repeated entities
can leave multiple hypotheses; coherent incorrect supervision can identify an
incorrect map. The 36 cases cover the stated finite factorial design, not arbitrary
sentences. Eight Unknown cases test refusal at the declared parsing boundary,
not discovery of new grammar. No general language or native learner theorem follows.

### Minimum next independent supervision / blind-test gate

1. Freeze the exact learner, adapter, checker, hypothesis family, metrics, budgets
   and Unknown policy by full commit and source digests **before** label authoring.
2. A person or genuinely separate evaluator authors supervision under the explicit
   agent/recipient/theme observer. Record author, sources, licensing, ambiguities
   and disagreement resolution; keep DocumentaryAccepted provenance separate from
   correctness of labels. Synthetic templates alone remain synthetic supervision.
3. A separate custodian authors a new cohort, with new entities and role permutations,
   plus agreed ambiguous and outside-profile inputs. Commit the cohort/labels in a
   private store and publish its digest before evaluation. Neither implementation
   author nor learner may inspect test labels; the implementation author also must
   not tune to test queries. A new construction requires a separately frozen profile.
4. Run in a clean container/process with only frozen program, approved training and
   query texts mounted: no labels, repository checkout containing labels, network,
   or previous model. Retain exact input/output digests, resource limits and failures.
5. Lock producer outputs before the custodian reveals labels. An independent checker
   verifies execution; the custodian scores correctness, Unknown/coverage and all
   declared controls, without retries or post-result edits. Any changed implementation
   needs a fresh unseen cohort. Record the evaluator's identity and review separately.

This can establish an independently supervised, prospectively blinded **external
finite** result. Native task/observer admission, invocation and state update still
require all seven receiving-side gates listed in v0; these tests grant none of them.
