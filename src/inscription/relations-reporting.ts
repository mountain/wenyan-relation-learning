/**
 * Reporting-frame grammar: a role grammar that actually occurs in real text.
 *
 * WHY A SECOND MODULE
 * `relations.ts` is the verified artifact of the reviewed patch, and its grammar
 * is a three-sentence construction invented for an experiment: it occurs in
 * 0 of 8208 corpus passages, so nothing learned from it can ever be checked
 * against real text. This module defines a grammar that DOES occur, while
 * keeping the identical discipline:
 *
 *   - the model stores ONLY evidence (supervised labelled examples);
 *   - the surviving role permutations are recomputed by replay() on every read;
 *   - incomplete checks add no constraint, contradictions throw;
 *   - no match, too many matches, or exhausted fuel all yield Unknown.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE
 * `relations.ts` is not modified and shares no code with this module. The
 * discipline is duplicated rather than extracted into a common core on purpose:
 * extracting it would change the verified module, and that refactor should be
 * its own reviewed change rather than a side effect of adding a grammar. The
 * duplication is a known debt, recorded in tools/grammar/contract.json.
 *
 * SEGMENTATION — the honest hard part
 * The experimental grammar could delimit every slot with 「」. Real text offers
 * no such help for the two entity slots, so the frame is:
 *
 *     <entity> <frame verb> <entity> 曰：「<quoted speech>」
 *
 * Entity boundaries are declared as maximal runs of characters that contain no
 * sentence punctuation and no quote marks, length 1..10. Two passages out of
 * 399 in the corpus contain more than one such match; those return Unknown
 * rather than picking one. Segmentation is therefore a declared rule with a
 * measured failure rate, not a hidden guess.
 */
export type Roles = { agent: string; recipient: string; theme: string };
export type Example = { id: string; text: string; expected: Roles };
export type ReportingModel = {
  schema: "wenyan.relations.reporting.v1";
  examples: Example[];
};
export type Occurrence = {
  slot: number;
  value: string;
  start: number;
  end: number;
};
export type ReportingReading = {
  status: "KnownFiniteGrammar" | "Unknown";
  reason?: string;
  source: string;
  construction?: string;
  candidates: Roles[];
  occurrences: Occurrence[];
  ambiguousMatches?: number;
};

export const REPORTING_GRAMMAR_ID = "wenyan.relations.reporting.v1";

/** Entity spans: no sentence punctuation, no quotes, 1..10 characters. */
const ENTITY = "[^，。；：「」？！、]{1,10}";
/** Quoted speech is delimited by the text's own quotation marks. */
const SPEECH = '[^」]{1,300}';

/**
 * Frame verbs attested in the corpus, with their measured passage counts
 * (see tools/grammar/measure.mjs). Each is its own construction, because each
 * must earn its role mapping from its own evidence.
 */
const FRAMES: { id: string; verb: string; source: string }[] = [
  { id: 'wei-quote', verb: '謂', source: `(${ENTITY})謂(${ENTITY})曰：「(${SPEECH})」` },
  { id: 'wen-quote', verb: '問', source: `(${ENTITY})問(${ENTITY})曰：「(${SPEECH})」` },
  { id: 'gao-quote', verb: '告', source: `(${ENTITY})告(${ENTITY})曰：「(${SPEECH})」` },
  { id: 'yu-quote', verb: '語', source: `(${ENTITY})語(${ENTITY})曰：「(${SPEECH})」` },
];

export const CONSTRUCTION_IDS = FRAMES.map((f) => f.id);

const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/**
 * Longest text this grammar will look at; longer input is out of scope.
 * Set above the corpus maximum (1617 units) on purpose: a safety bound must not
 * silently double as a filter that excludes real passages. The measurement tool
 * reports how many passages exceed it.
 */
export const MAX_TEXT_UNITS = 2048;

type Parsed = {
  construction: string;
  slots: string[];
  occurrences: Occurrence[];
  matches: number;
};

function assign(slots: string[], order: number[]): Roles {
  return { agent: slots[order[0]], recipient: slots[order[1]], theme: slots[order[2]] };
}

function equal(a: Roles, b: Roles) {
  return a.agent === b.agent && a.recipient === b.recipient && a.theme === b.theme;
}

function validRoles(r: unknown): r is Roles {
  const x = r as Roles;
  return !!x && typeof x.agent === 'string' && !!x.agent
    && typeof x.recipient === 'string' && !!x.recipient
    && typeof x.theme === 'string' && !!x.theme;
}

/**
 * Locate the frame(s) in a passage. Unlike the experimental grammar this is a
 * SEARCH, not a whole-string match: real passages embed the frame in context.
 * More than one match is reported as ambiguous instead of resolved by fiat.
 */
function parse(text: string): Parsed | undefined {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_UNITS) return undefined;
  const found: Parsed[] = [];
  for (const frame of FRAMES) {
    const re = new RegExp(frame.source, 'gu');
    for (const m of text.matchAll(re)) {
      const occurrences: Occurrence[] = [];
      for (let slot = 0; slot < 3; slot++) {
        const value = m[slot + 1];
        // Locate each capture inside the match so offsets point at the source.
        const localStart = m[0].indexOf(value);
        const start = (m.index ?? 0) + localStart;
        occurrences.push({ slot, value, start, end: start + value.length });
      }
      found.push({ construction: frame.id, slots: [m[1], m[2], m[3]], occurrences, matches: 1 });
    }
  }
  if (!found.length) return undefined;
  if (found.length > 1) {
    return { construction: found[0].construction, slots: found[0].slots,
      occurrences: found[0].occurrences, matches: found.length };
  }
  return found[0];
}

/** Replay the evidence into surviving role permutations per construction. */
function replay(model: ReportingModel) {
  if (!model || model.schema !== REPORTING_GRAMMAR_ID
    || !Array.isArray(model.examples) || model.examples.length > 32) {
    throw new Error('invalid reporting model');
  }
  const rules: Record<string, number[][]> = {};
  for (const frame of FRAMES) rules[frame.id] = ORDERS.slice();
  const seen = new Set<string>();
  for (const e of model.examples) {
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 128
      || seen.has(e.id) || !validRoles(e.expected)) throw new Error('invalid evidence');
    seen.add(e.id);
    const p = parse(e.text);
    if (!p || p.matches > 1) throw new Error('out-of-grammar evidence');
    rules[p.construction] = rules[p.construction].filter((order) =>
      equal(assign(p.slots, order), e.expected));
    if (!rules[p.construction].length) throw new Error('contradictory evidence');
  }
  return rules;
}

export function emptyReportingModel(): ReportingModel {
  return { schema: REPORTING_GRAMMAR_ID, examples: [] };
}

export function readReporting(text: string, model: ReportingModel): ReportingReading {
  const rules = replay(model);
  const p = parse(text);
  if (!p) {
    return { status: 'Unknown', reason: 'outside-reporting-grammar',
      source: text, candidates: [], occurrences: [] };
  }
  if (p.matches > 1) {
    return { status: 'Unknown', reason: 'ambiguous-frame-occurrence',
      source: text, construction: p.construction, candidates: [], occurrences: p.occurrences,
      ambiguousMatches: p.matches };
  }
  const candidates = rules[p.construction].map((order) => assign(p.slots, order));
  return {
    status: candidates.length === 1 ? 'KnownFiniteGrammar' : 'Unknown',
    ...(candidates.length === 1 ? {} : { reason: 'ambiguous-role-mapping' }),
    source: text,
    construction: p.construction,
    candidates,
    occurrences: p.occurrences,
  };
}

/**
 * Explicit invocation; no hidden state, no automatic restart. One unit of fuel
 * checks one candidate against one declared labelled example. An incomplete
 * check adds no constraint.
 */
export function learnReportingRelations(model: ReportingModel, example: Example, fuel: number) {
  const rules = replay(model);
  if (!Number.isSafeInteger(fuel) || fuel < 0 || fuel > 192) throw new Error('invalid fuel');
  if (!example || typeof example.id !== 'string' || !example.id || example.id.length > 128
    || !validRoles(example.expected)) throw new Error('invalid training example');
  if (model.examples.length >= 32) throw new Error('evidence capacity reached');
  if (model.examples.some((e) => e.id === example.id)) throw new Error('duplicate evidence id');
  const p = parse(example.text);
  if (!p || p.matches > 1) {
    return { status: 'Unknown', reason: 'outside-reporting-grammar',
      model, checked: 0, refutations: [] };
  }
  const candidates = rules[p.construction];
  const refutations: { order: number[]; actual: Roles; expected: Roles }[] = [];
  const survivors: number[][] = [];
  let checked = 0;
  for (const order of candidates) {
    if (checked === fuel) {
      return { status: 'Unknown', reason: 'fuel-exhausted', model, checked, refutations };
    }
    checked++;
    const actual = assign(p.slots, order);
    if (equal(actual, example.expected)) survivors.push(order);
    else refutations.push({ order: order.slice(), actual, expected: { ...example.expected } });
  }
  if (!survivors.length) {
    return { status: 'Conflict', reason: 'contradictory-label', model, checked, refutations };
  }
  // The label is a declared supervisor constraint, not an inferred fact.
  const next: ReportingModel = JSON.parse(JSON.stringify({ ...model,
    examples: [...model.examples, example] }));
  replay(next);
  return { status: 'Updated', model: next, checked, refutations,
    remainingMappings: survivors.length };
}

export function compareReporting(a: string, b: string, model: ReportingModel) {
  const left = readReporting(a, model);
  const right = readReporting(b, model);
  if (left.status === 'Unknown' || right.status === 'Unknown') {
    return { status: 'Unknown', left, right };
  }
  const x = left.candidates[0];
  const y = right.candidates[0];
  const status = equal(x, y) ? 'SameRelation'
    : (x.agent !== x.recipient && x.agent === y.recipient && x.recipient === y.agent
      && x.theme === y.theme) ? 'RoleReversal' : 'DifferentRelation';
  return { status, left, right };
}
