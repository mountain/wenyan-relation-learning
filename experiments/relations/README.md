# Evidence-bound role learning in the existing Wenyan pipeline

Author/self-review: Codex (OpenAI), 2026-09-22. Direction: Mingli Yuan.
New adapter, experiment and prose are project-original contributions under
Unknown v0.3. Existing Wenyan source retains its upstream MIT notice; see
`LICENSE.upstream`. No material is imported into the Adva repository.

## Implementation and limits

This patch adds `relationModel` as an optional argument to the existing
`runInscriptionPipeline`. When present, its result contains an additional
`relation` reading. When absent, the legacy API output is unchanged. The
existing acknowledgement gate runs first. The inscription analyzer, weight
adaptation, reverse templates and confidence labels retain their meanings.
No new confidence label is used as a proof of a relation.

`src/inscription/relations.ts` supplies an explicit, serializable evidence model:

1. Begin with six candidate permutations of three roles for each construction.
2. Check a supplied supervisor-labelled example against every candidate.
3. Record counterexamples and retain the surviving mappings.
4. Replay the retained examples before every read or update.
5. Apply the surviving rule to a fresh entity tuple and check the result.

This is an independent language adapter of the update discipline in Adva
[Research 0131](https://github.com/mountain/adva/blob/79f6353511d736ae743b109f1c573b652eff170a/docs/research/0131-finite-learner-judgment-and-reuse.md).
The arithmetic-specific F7 implementation is not imported or called. This
does not demonstrate a native `adva learn` invocation, native admission,
general language learning or six-germ/six-shu identification. Actual execution
through Adva is a remaining separate interface task.

The supplied controlled grammar comprises exactly:

    「A」授「B」「T」。
    「A」把「T」交给「B」。
    「B」获「A」所授「T」。

Three explicitly labelled training sentences use A=甲, B=乙, T=书. Each
construction starts with all six role permutations. Roles are not assigned
by the regex: it only locates three slots. Supervision selects the role
permutation. Each construction needs its own evidence; training one grants
no authority to the other two. The synonym relationship among these supplied
constructions belongs to the experimental task definition, not a discovery
of new vocabulary. The predicate is fixed to transfer throughout this grammar.

Quoted entities are opaque identifiers of length 1..32 UTF-16 units. Text is
at most 256 UTF-16 units. The final Chinese full stop is optional. Negation,
pronouns, multiple clauses, unquoted natural text, and other constructions
return Unknown. Distinct quoted occurrences retain their source offsets even
when their values coincide. Offsets are UTF-16 offsets into the unmodified
source string, not byte offsets or native Adva occurrence identities.

Model evidence is bounded to 32 examples; fuel is an integer 0..192. A
partial-fuel result records checked refutations but commits no incomplete
update. A caller may explicitly retry with a new allowance; no continuation
cursor or automatic retry is claimed. Conflicting labels return Conflict
without replacing the previous model. Previous labels are assumptions, not
historical or independently certified truths. Replay detects inconsistent
evidence, not malicious but self-consistent replacement of the entire model.
Authentication is outside scope.

## Use

```typescript
import { runInscriptionPipeline } from "../../src/inscription/pipeline";
import { emptyRelationModel, learnRelations, compareRelations }
  from "../../src/inscription/relations";

const update = learnRelations(emptyRelationModel(), {
  id: "grant-1",
  text: "「甲」授「乙」「书」。",
  expected: { agent: "甲", recipient: "乙", theme: "书" }
}, 6);

const result = runInscriptionPipeline("「丙」授「丁」「帛」。", {
  relationModel: update.model,
  steps: 3
});
const comparison = compareRelations(
  "「丙」授「丁」「帛」。", "「丁」授「丙」「帛」。", update.model
); // RoleReversal
// Persist update.model as JSON explicitly; no implicit file writes occur.
```

New exports are available directly from the relations module. They are not
added to the top-level parser export list in this narrow patch.

## Measured result

One bounded run passed on Node v24.19.0. After the runtime-mode portability fix
described under "Reproduce and integrate", a second run on Node v26.4.0
reproduced every value in this table identically; the accompanying
`evidence.json` records the runtime and source hashes of the run it belongs to.

| Check | Result |
|---|---|
| Training | Three examples; five refuted maps per construction, one survivor |
| Held-out identities | Nine fresh identities in three triples |
| Held-out paraphrase comparisons | 9/9 SameRelation |
| Held-out agent/recipient reversals | 9/9 RoleReversal |
| Remove all training evidence | Reversal comparisons become Unknown |
| Legacy output, opt-in disabled | Unchanged |
| Legacy reverse-template output on reversed pairs | Identical in 9/9 cases |
| Negative/control categories | 12 passed |

The legacy pipeline has no equivalent typed relation judgment. Its template
collisions are diagnostic, not a claim of zero accuracy on a comparable task:
the original analysis still retains its input text. This experiment measures
new task-specific discrimination, not a benchmark against general NLP.
A conventional hand-written slot parser could also solve this tiny grammar;
no accuracy or efficiency superiority over that baseline is claimed.

Controls cover zero/partial fuel, contradictory labels, unseen constructions,
negation, out-of-grammar sentences, stale schema, duplicate IDs, infinite fuel,
inconsistent replay, the existing acknowledgement gate and occurrence identity.
All held-out readings are also checked against separately specified role tuples.

## Reproduce and integrate

Node 24 or later, from the package/repository root:

```sh
node --max-old-space-size=256 experiments/relations/run.cjs
```

No wall-clock wrapper is used: `timeout(1)` is not portable, because macOS
ships it only as `gtimeout` via GNU coreutils, and a single run completes in
about a tenth of a second on the reference machine anyway.

The runner executes the actual four TypeScript modules through Node's type
stripping and a small isolated runtime loader. It requests `mode: 'strip'`,
the only mode accepted by both Node 24 and Node 26, because `mode: 'transform'`
was removed in Node 26. The loader removes type-only imports and collects
function/constant exports for this fixed subset. This is a runtime integration
check, not a TypeScript type check or execution of Jest. Node prints an
`ExperimentalWarning` for `stripTypeScriptTypes` on stderr; it is expected and
does not affect the result, which is the single JSON line written to stdout.
Node heap is bounded to 256 MiB, not a bound on total process memory.
`evidence.json` records source hashes, training updates, model, all nine
held-out readings and eighteen comparisons. `contract.json` preceded the run.

`wenyan-relations.patch` is based on upstream commit
`6143e22ca8319a8ebca89b59a29f20158812b63f`. Check it with `git apply --check`
against that source before applying. Full repository type checking, Jest,
CLI/browser packaging and remote CI remain integration gates. This deliverable
is a reviewed local patch, not a remote commit or an edit to upstream PR #717.

Direct Git cloning was unavailable in the current environment; the three
dependency modules were fetched through GitHub at the pinned commit. The
reproduction bundle contains only this subset, the patch and experiment;
it is not a full checkout. The inherited source is separately MIT-licensed
and must not be copied into Adva's public-domain-only publication path.

## Interpretation and next step

The small result supports evidence-bound reuse across entity substitutions.
Its real contribution is a distinction between changed scores and changed
relation proposals, with failures and Unknown retained. It does not yet put
the Adva runtime in Wenyan's execution path. The next integration should fix
an explicit receiving/checking contract for these relation examples, then
connect an appropriate existing Adva learner through a declared adapter.
Do not encode roles as arbitrary F7 polynomials merely to claim a native call.
