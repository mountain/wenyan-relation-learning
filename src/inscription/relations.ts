// SPDX-License-Identifier: MIT
/** Research-only language adapter of Adva 0131's evidence-bound update policy.
 * Fixed controlled grammar, supervised role labels; not native Adva learn.
 * Codex (OpenAI), 2026-09-22. New contribution under Unknown v0.3.
 */
export type Roles = { agent: string; recipient: string; theme: string };
export type Example = { id: string; text: string; expected: Roles };
export type RelationModel = {
  schema: "wenyan.relations.v1";
  examples: Example[];
};
export type RelationReading = {
  status: "KnownFiniteGrammar" | "Unknown";
  reason?: string;
  source: string;
  candidates: Roles[];
  occurrences: { slot: number; value: string; start: number; end: number }[];
  construction?: string;
};
const ROLE_KEYS = ["agent", "recipient", "theme"] as const;
const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const SLOT = "「([^「」\\r\\n]{1,32})」";
const GRAMMAR = [
  { id: "grant", pattern: new RegExp(`^${SLOT}授${SLOT}${SLOT}。?$`, "u") },
  {
    id: "hand-over",
    pattern: new RegExp(`^${SLOT}把${SLOT}交给${SLOT}。?$`, "u"),
  },
  {
    id: "receive",
    pattern: new RegExp(`^${SLOT}获${SLOT}所授${SLOT}。?$`, "u"),
  },
];

function parse(text: string) {
  if (typeof text !== "string" || text.length > 256) return undefined;
  for (const rule of GRAMMAR) {
    const m = rule.pattern.exec(text);
    if (!m) continue;
    let cursor = 0;
    const occurrences = m.slice(1).map((value, slot) => {
      const start = text.indexOf("「", cursor) + 1;
      const end = text.indexOf("」", start);
      cursor = end + 1;
      return { slot, value, start, end };
    });
    return { construction: rule.id, slots: m.slice(1), occurrences };
  }
  return undefined;
}

function assign(slots: string[], order: number[]): Roles {
  return {
    agent: slots[order[0]],
    recipient: slots[order[1]],
    theme: slots[order[2]],
  };
}
function equal(a: Roles, b: Roles) {
  return ROLE_KEYS.every((k) => a[k] === b[k]);
}
function validRoles(r: Roles) {
  return (
    r &&
    Object.keys(r).sort().join(",") === "agent,recipient,theme" &&
    ROLE_KEYS.every((k) => typeof r[k] === "string" && r[k].length > 0)
  );
}
function replay(model: RelationModel) {
  if (
    !model ||
    model.schema !== "wenyan.relations.v1" ||
    !Array.isArray(model.examples) ||
    model.examples.length > 32
  ) {
    throw new Error("invalid relation model");
  }
  const rules: Record<string, number[][]> = {};
  for (const rule of GRAMMAR) rules[rule.id] = ORDERS.slice();
  const seen = new Set<string>();
  for (const e of model.examples) {
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      e.id.length > 128 ||
      seen.has(e.id) ||
      !validRoles(e.expected)
    )
      throw new Error("invalid evidence");
    seen.add(e.id);
    const p = parse(e.text);
    if (!p) throw new Error("out-of-grammar evidence");
    rules[p.construction] = rules[p.construction].filter((order) =>
      equal(assign(p.slots, order), e.expected)
    );
    if (!rules[p.construction].length)
      throw new Error("contradictory evidence");
  }
  return rules;
}
export function emptyRelationModel(): RelationModel {
  return { schema: "wenyan.relations.v1", examples: [] };
}
export function readRelation(
  text: string,
  model: RelationModel
): RelationReading {
  const rules = replay(model);
  const p = parse(text);
  if (!p)
    return {
      status: "Unknown",
      reason: "outside-controlled-grammar",
      source: text,
      candidates: [],
      occurrences: [],
    };
  const candidates = rules[p.construction].map((order) =>
    assign(p.slots, order)
  );
  return {
    status: candidates.length === 1 ? "KnownFiniteGrammar" : "Unknown",
    ...(candidates.length === 1 ? {} : { reason: "ambiguous-role-mapping" }),
    source: text,
    construction: p.construction,
    candidates,
    occurrences: p.occurrences,
  };
}

/** Explicit invocation; no hidden process-global state and no automatic restart.
 * A unit of fuel checks one candidate against one declared labelled example.
 * Incomplete checks add no constraint. Call again explicitly to continue.
 */
export function learnRelations(
  model: RelationModel,
  example: Example,
  fuel: number
) {
  const rules = replay(model);
  if (!Number.isSafeInteger(fuel) || fuel < 0 || fuel > 192)
    throw new Error("invalid fuel");
  if (
    !example ||
    typeof example.id !== "string" ||
    !example.id ||
    example.id.length > 128 ||
    !validRoles(example.expected)
  )
    throw new Error("invalid training example");
  if (model.examples.length >= 32) throw new Error("evidence capacity reached");
  if (model.examples.some((e) => e.id === example.id))
    throw new Error("duplicate evidence id");
  const p = parse(example.text);
  if (!p)
    return {
      status: "Unknown",
      reason: "outside-controlled-grammar",
      model,
      checked: 0,
      refutations: [],
    };
  const candidates = rules[p.construction];
  const refutations: { order: number[]; actual: Roles; expected: Roles }[] = [];
  const survivors: number[][] = [];
  let checked = 0;
  for (const order of candidates) {
    if (checked === fuel)
      return {
        status: "Unknown",
        reason: "fuel-exhausted",
        model,
        checked,
        refutations,
      };
    checked++;
    const actual = assign(p.slots, order);
    if (equal(actual, example.expected)) survivors.push(order);
    else
      refutations.push({
        order: order.slice(),
        actual,
        expected: { ...example.expected },
      });
  }
  if (!survivors.length)
    return {
      status: "Conflict",
      reason: "contradictory-label",
      model,
      checked,
      refutations,
    };
  // The label is a declared supervisor constraint, not an inferred historical fact.
  const next: RelationModel = JSON.parse(
    JSON.stringify({ ...model, examples: [...model.examples, example] })
  );
  replay(next);
  return {
    status: "Updated",
    model: next,
    checked,
    refutations,
    remainingMappings: survivors.length,
  };
}

export function compareRelations(a: string, b: string, model: RelationModel) {
  const left = readRelation(a, model),
    right = readRelation(b, model);
  if (left.status === "Unknown" || right.status === "Unknown")
    return { status: "Unknown", left, right };
  const x = left.candidates[0],
    y = right.candidates[0];
  const status = equal(x, y)
    ? "SameRelation"
    : x.agent !== x.recipient &&
      x.agent === y.recipient &&
      x.recipient === y.agent &&
      x.theme === y.theme
    ? "RoleReversal"
    : "DifferentRelation";
  return { status, left, right };
}
