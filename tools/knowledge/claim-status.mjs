/**
 * How strong is the claim a gate is making?
 *
 * Vocabulary taken from `adva/docs/claims.toml`, where every claim carries a `status`.
 * Adva's own distribution is the point of importing it: of 193 claims, only 14 are
 * `exact` and 118 are merely `bounded-experiment` — a registry that says out loud that
 * most of what it holds is provisional.
 *
 * Wenyan reported `PASS`/`FAIL` only, which conflates two different things: "we ran a
 * bounded measurement and it came out above a floor" and "this holds, and here is why".
 * `G2 PASS` read like a property of the network when it is a measurement over a ledger of
 * 49 records; `G5`'s coverage number read like a fact when it is a bounded experiment.
 *
 * The rungs are ordered from weakest to strongest:
 *
 *   construction-target  a named target that is NOT met (the gate fails and says so)
 *   definition           conformance to a declared structure; nothing is measured
 *   bounded-experiment   a measured value from one bounded run over a declared input set
 *   bounded-verified     a claim checked within declared bounds, with the bounds named
 *   exact                holds over the whole finite space, by exhaustion rather than sampling
 *
 * WHAT THIS MODULE DOES NOT DO
 *   It does not make anything stronger. Every rung is what the gate ALREADY did; this
 *   only stops the output from implying more. A gate cannot be promoted by editing this
 *   file — the mapping must match what the gate's code actually runs, and the basis
 *   string is part of the report.
 *
 * NO GATE MAY BE UNDECLARED. `statusOf()` throws for an unknown gate id, so adding a gate
 * to readiness.mjs without declaring its rung is a loud failure rather than a silent
 * assumption that the new gate is as strong as its neighbours.
 */

export const LADDER = ['construction-target', 'definition', 'bounded-experiment', 'bounded-verified', 'exact'];

/** gate id -> { status, basis, bounds } */
export const GATE_STATUS = {
  G1: {
    status: 'bounded-verified',
    basis: 'parse issues, integrity issues and a replay probe are all checked on the store as it exists',
    bounds: 'this store, at this revision',
  },
  G2: {
    status: 'bounded-verified',
    basis: 'per-construction survival is read from the operational core, and every declared construction is probed',
    bounds: 'the ledger\'s declared constructions',
  },
  G3: {
    status: 'bounded-verified',
    basis: 'leave-one-out over the operational core; each held-out record is re-read without itself',
    bounds: 'the core, not the whole store — records held out of the core are not re-read',
  },
  G4: {
    status: 'bounded-verified',
    basis: 'six declared negatives must all return Unknown',
    bounds: 'exactly those six sentences; nothing else is tested for failing closed',
  },
  G5: {
    status: 'bounded-experiment',
    basis: 'a coverage rate measured over the corpus by running each declared grammar over every passage',
    bounds: 'one corpus build; a rebuild moves the denominator',
  },
  G6: {
    status: 'bounded-verified',
    basis: 'record and retraction hashes are recomputed, and corpus-derived sources are re-matched by TEXT',
    bounds: 'text equality, not label truth — a record can verify and still be wrong (see conflation C5)',
  },
  G7: {
    status: 'definition',
    basis: 'the contract file is read and its invariants are required to name an enforcer; nothing is measured',
    bounds: 'structure only',
  },
  G8: {
    status: 'construction-target',
    basis: 'the floor is 0.5 and the best measured rate is far below it; the gate fails and names the target',
    bounds: 'unreachable by any construction with a defensible segmentation rule — see CAP-REVIEW.md 补篇二',
  },
  G9: {
    status: 'exact',
    basis: 'a partition identity over a finite set: core + named held-out + declared out-of-grammar + '
      + 'provenance-excluded must equal the pool, checked by exhaustion over the actual records',
    bounds: 'the pool as loaded; the identity is arithmetic and admits no sampling error',
  },
};


/**
 * WHAT KIND OF SUPPORT does a gate's PASS rest on?
 *
 * Adva 0131 separates three objects that Wenyan had merged into one word ("warrant"):
 *
 *   `verify` checks a fixed obligation; `proof` is a proof object and `evidence` may be broader.
 *
 *   evidence      supervised labels in the store. Broader than a proof: it can support a
 *                 reading without establishing it, and a label can be wrong.
 *   proof         an object that establishes the claim over a declared finite space, by
 *                 exhaustion rather than sampling.
 *   verification  a check against a FIXED OBLIGATION — a hash, a text's presence, a
 *                 declared structural requirement. It says the obligation holds, nothing more.
 *
 * A FOURTH KIND IS DECLARED HERE, not taken from Adva: `measurement`. A rate is not a proof
 * (nothing is exhausted) and not a fixed obligation (it moves when the corpus moves), and
 * filing it under `evidence` would blur a computed ratio with a supervised label. The
 * distinction is load-bearing in this repository: G6 verified 29/29 sources while eleven
 * records carried labels that could not be stated truthfully, so "verified" and "supported"
 * are not the same claim and must not share a word.
 */
export const SUPPORT_KINDS = ['evidence', 'proof', 'verification', 'measurement'];

const SUPPORT = {
  G1: ['verification', 'parse, integrity and replay are fixed obligations checked against the store'],
  G2: ['evidence', 'the mapping survives because supervised labels eliminated the other permutations'],
  G3: ['evidence', 'accuracy is computed from held-out labelled records'],
  G4: ['verification', 'six declared negatives are a fixed obligation: each must return Unknown'],
  G5: ['measurement', 'a coverage rate over one corpus build; it is a ratio, not a proof'],
  G6: ['verification', 'hashes recomputed and source text re-matched — text presence, not label truth'],
  G7: ['verification', 'structural conformance of the contract file'],
  G8: ['measurement', 'the answer rate over the corpus under the declared questions'],
  G9: ['proof', 'a partition identity over the finite record set, established by exhaustion'],
};

export function supportOf(gateId) {
  const e = SUPPORT[gateId];
  if (!e) throw new Error(`gate ${gateId} declares no support kind`);
  const [kind, basis] = e;
  if (!SUPPORT_KINDS.includes(kind)) throw new Error(`gate ${gateId}: unknown support kind ${kind}`);
  return { kind, basis };
}

export function statusOf(gateId) {
  const e = GATE_STATUS[gateId];
  if (!e) {
    throw new Error(`gate ${gateId} has no declared claim status — add it to GATE_STATUS with its basis, ` +
      'because an undeclared rung would silently inherit the strength of the gates beside it');
  }
  if (!LADDER.includes(e.status)) throw new Error(`gate ${gateId}: ${e.status} is not on the ladder`);
  if (!e.basis || !e.bounds) throw new Error(`gate ${gateId}: a status needs both a basis and declared bounds`);
  return e;
}

/**
 * How strong the passing suite is — reported as a DISTRIBUTION plus its weakest link.
 *
 * A first version returned the strongest rung among the passing gates and printed
 * "strongest rung achieved: exact". That was itself an overclaim of exactly the kind the
 * ladder exists to prevent: only G9 is exact (a partition identity over a finite set), and
 * a reader would take the line as a statement about the network. A suite is not stronger
 * than its weakest REQUIRED gate, so that is what gets named.
 */
export function rungSummary(gates) {
  const passing = gates.filter((g) => g.pass);
  const histogram = {};
  for (const r of LADDER) histogram[r] = 0;
  for (const g of passing) histogram[statusOf(g.id).status]++;
  const required = passing.filter((g) => g.required);
  const weakestRequired = LADDER.filter((r) => required.some((g) => statusOf(g.id).status === r))[0] ?? null;
  return { histogram, weakestRequired, passing: passing.length, total: gates.length };
}
