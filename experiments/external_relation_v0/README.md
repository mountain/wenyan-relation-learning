# Executable external Wenyan relation learner v0

Project-original implementation and synthetic annotations by Codex (OpenAI),
2026-10-12, under the repository's Unknown v0.3 contribution scope. No third-party
corpus or code is imported. Self-review only; no independent human review implied.

This implements the next step after PR #5's bounded inventory, without changing
its historical conclusion. It is based on merged PR #4 (`86c5295...`), not on the
unmerged PR #5 branch. No Adva dependency lock or frozen historical evidence changes.

## Reuse decisions

Inspected `mountain/adva@1b9bd090b2c4710916b6a0ccca0ad88fb7d323bd`:

| Candidate | Safe mechanism to reuse | Mechanism not reused |
| --- | --- | --- |
| `experiments/finite_learner/calibration.py`, external-f7-quadratic-v0 | Bounded canonical enumeration, counterexample retention, independently checked state transitions, explicit fuel | F7 coefficient grammar, arithmetic oracle, native authority (none exists) |
| `experiments/six_relation_queries/plan.json` | Separate supervision and held-out tasks, no-experience / incorrect-label controls, Unknown on exhaustion | PreparationOnly proposal: no executable learner, frozen features or receiving authority to import |
| This repository's `src/inscription/relations.ts` | Six role permutations per controlled construction, eliminate candidates using labelled examples | Historical runtime harness is not relabelled as new evidence; new process and separate verifier are implemented |

No candidate code is copied. The F5 plan remains PreparationOnly. The new learner
is an external hypothesis-elimination baseline, not native Adva execution.

## Frozen finite task and interface

`contract.json` defines exact version, task, observer, supervision source, split
hashes, receipt dependencies, budget and authority. The observer reports the ordered
(agent, recipient, theme) tuple. The three predefined constructions are 授、把…交给、
获…所授. Parsing these constructions is a pre-encoded rule; assigning roles is learned
by eliminating six permutations, not by a predefined correct role map.

`learner.py` accepts stdin JSON `{training, fuel}` and returns a transcript, candidate
state, charged checks and verdict. Training examples contain exactly id/text/roles.
The learner reads no holdout file, expected holdout label or historical model.
The subprocess receives training only. This is a source-audited information boundary,
not an adversarial filesystem sandbox: the worker has ordinary filesystem access.

`train.json`: three synthetic labelled sentences, one per construction. `holdout.json`:
18 sentences across three disjoint entity triples, including role reversals. Texts
and quoted entity values are checked disjoint. Both files are authored and frozen in
this same change; this is a held-out fixture, not a prospective unseen-data experiment.
Supervision is a project-authored synthetic annotation, not a historical-language truth.

`verify.py` imports no learner code; it splits quoted tokens rather than using the
learner's regular expressions and reconstructs the exhaustive transcript and state.
Acceptance requires the entire expected transcript, exact charged work and verdict.
The supervisor checks holdout predictions only after learning ends. A valid output
therefore certifies this finite algorithm and dataset, not general linguistic correctness.

## Receipt and authority

The supervisor first checks SHA-256 of PR #4's contract, evidence and checker,
then invokes that unchanged checker to obtain DocumentaryAccepted. The enclosing
source commit identifies the merged receiver; the receipt's source_commit identifies
the older evidence source (`cfb6e4...`). These distinct identities are retained.
The historical receipt binds provenance only: it neither labels the new dataset nor
provides invocation rights. External invocation is explicitly allowed by this new
contract and the user's task authorization. Native admission and native state write
remain false. No native receiver is called and no cross-repository state is written.

## States, budgets and evidence

Initial state is NotRun before explicit invocation. Each construction begins with six
possible permutations. Accepted means all three maps are unique after checked training;
Refuted means a completed labelled check has no surviving map; Unknown means ambiguity,
out-of-grammar input or resource exhaustion. No new task is accepted merely because
an earlier task succeeded. Partial checks are recorded but do not update that construction.
Contradictory supervision retains the trace without installing an invalid state.

Maximum 18 candidate checks per invocation, 32 examples, 256 characters per sentence,
64 KiB input/output, 128 MiB worker address space, 4 CPU seconds, 5 wall seconds;
no automatic retry or expansion. The campaign has a fixed roster of seven worker
invocations. Worker failures exit nonzero with Unknown and retain previously verified
runs. Hard termination cannot recover in-flight worker memory; only the explicit fuel
exit guarantees that current partial transcript is retained. No timing speedup is claimed.

## Reproduce and results

Linux, Python 3 with standard library, Node 24 or 26, repository root:

```sh
python3 experiments/external_relation_v0/run.py > /tmp/external-relation-evidence.json
diff experiments/external_relation_v0/evidence.json /tmp/external-relation-evidence.json
```

Fresh execution verifies receipt, split isolation, all worker transcripts, role-reversal
holdout results, four forged-output rejection controls and out-of-grammar rejection.
Frozen evidence binds the contract and all three executable source SHA-256 values.
CI runs this campaign and requires exact replay in both existing Node matrix jobs.

| Arm / control | Result |
| --- | --- |
| Supervised permutation elimination | 18/18 holdout tuples correct, 18 checks |
| No training | 0/18, ambiguous maps |
| Swapped agent/recipient supervision | 0/18; coherent wrong maps remain possible |
| Training answer lookup | 0/18 exact-text coverage |
| Pre-encoded identity role map for all constructions | 6/18 |
| Fuel 2 | Unknown; 2 checks and refutations retained, no incomplete update |
| Contradictory label | Refuted with independently checked trace |
| Forged verdict / count / state / trace | Four rejected |

These controls show that the correct tuple is not fixed in the learner and that training
changes new-entity predictions in this grammar. They do not exclude every possible
shortcut, establish broad generalization, or measure learning efficiency statistically.

## Native integration conditions still open

1. A receiving-side versioned task/observer type for this controlled relation grammar.
2. Native enumeration and application of role-permutation candidates with charged work.
3. A supervisor operation binding annotated training constraints to task identity.
4. Native counterexample, partial-evidence and continuation records.
5. Evidence-checked state transition and independently checked holdout output operation.
6. Explicit receiving profile and invocation permission; separate state-update capability.
7. Cross-repository consumer pin, provenance verification and native admission policy.

No external correctness count closes these gates. The next useful experiment is to freeze
this learner before independently authoring new constructions/tasks, and then measure
which unseen variations require new parsing rules or a richer hypothesis family.

## Receiving-boundary audit (2026-10-14)

The frozen `verify.py` compares Python structures and accepts boolean or float
substitutions for integer ordinals/counts (`False == 0`, `1.0 == 1`). Preserve it
only for historical replay; it is not a safe untrusted-input receiver. PR #7 adds
a strict versioned receiver and regression controls without changing these seven
frozen files. Accepted still means finite computation against supplied labels,
not independently correct supervision or native authority.
