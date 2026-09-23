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
 * sentence punctuation and no quote marks, length 1..10. Segmentation is a declared
 * rule with a MEASURED rate, not a hidden guess: of the 8,726 passages the seven
 * constructions read, 1,002 (11.48%) carry an agent span that begins with a particle
 * or adverb. That measurement is what forced an admissibility filter on labels — a span
 * like `於是武王遍` (from `於是武王遍告諸侯曰`) cannot be stated as the agent without
 * asserting something false, so it may not be stored as evidence.
 *
 * A passage containing SEVERAL frames used to return Unknown. That was reversed once
 * measurement showed the cost: 8,323 passages (10.69%) were being given up, and a
 * passage stating two relations is not made more honest by refusing to read either.
 * The most explicit frame is now read and the number of further frames is reported in
 * `additionalMatches`.
 */
/**
 * A role is `null` when the construction does NOT EXPRESS it.
 *
 * `子曰：「學而時習之。」` names a speaker and a quotation and no addressee. Writing
 * some addressee in would be invention, and returning Unknown would throw away the
 * agent and theme the text does state, so the reading carries `recipient: null` and
 * the construction declares which roles it expresses. Measured consequence: this one
 * construction covers 16,907 of 77,884 passages (21.71%) against 2,440 (3.13%) for
 * all four three-slot frames together — the addressee is simply absent most of the time.
 */
export type Roles = { agent: string | null; recipient: string | null; theme: string | null };
export type RoleName = "agent" | "recipient" | "theme";
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
  /**
   * How many FURTHER frames this passage contains beyond the one read.
   *
   * A passage holding `子曰：「…」……王曰：「…」` states two relations. Reporting
   * Unknown discarded both; silently returning one would pretend only one exists. So the
   * most explicit frame is read AND the count of the rest is reported, which is what makes
   * this a declared rule with a measured rate rather than a hidden choice.
   */
  additionalMatches?: number;
};

export const REPORTING_GRAMMAR_ID = "wenyan.relations.reporting.v1";

/** Entity spans: no sentence punctuation, no quotes, 1..10 characters. */
const ENTITY = "[^，。；：︰﹕「」？！、]{1,10}";
/** Quoted speech is delimited by the text's own quotation marks. */
// Quotation delimiters are NOT one pair. 「」 is primary and 『』 nested — but some
// texts and editions use 『』 or plain " or “” as the PRIMARY delimiter, and the grammar then
// read none of those passages: measured, 563 passages use 『』 as the outer quote, 863 use ASCII
// quotes, 366 use “”. Declared as a character class rather than a guess about which is which.
const SPEECH = '[^」』"”]{1,300}';
/** Opener and closer for the four delimiter styles, kept in one place. */
const Q_OPEN = '[「『"“]';
/** The colon is ALSO not one character: 本草綱目 and other Ming/Qing editions use ︰ (︰) and
 * some use ﹕. Measured: ︰ alone occurs 13,019 times after 曰 in this corpus, and the grammar
 * read none of them because it demanded ：. Same class of mistake as the quotation delimiters. */
const COLON = '[：︰﹕]';
const Q_CLOSE = '[」』"”]';

/**
 * Frame verbs attested in the corpus, with their measured passage counts
 * (see tools/grammar/measure.mjs). Each is its own construction, because each
 * must earn its role mapping from its own evidence.
 */
const ALL_ROLES: RoleName[] = ['agent', 'recipient', 'theme'];

/**
 * The 2-slot frame needs its own entity pattern: `曰` is not excluded from ENTITY, so
 * a greedy ENTITY would swallow the verb and read `或謂孔子曰：「…」` as agent
 * `或謂孔子`. Three-slot frames are tried FIRST for the same reason — they are the
 * more specific reading — and this pattern additionally refuses to contain a
 * reporting verb, so `王問曰：「…」` cannot be read with agent `王問`.
 */
const ENTITY_NO_VERB = "(?:(?![謂問告語])[^，。；：︰﹕「」？！、]){1,10}";
/** Recipient slot: may not be the 曰 that belongs to the verb. */
const ENTITY_NO_YUE = "(?:(?!曰)[^，。；：︰﹕「」？！、]){1,10}";
const AGENT_THEME: RoleName[] = ['agent', 'theme'];

const FRAMES: { id: string; verb: string; source: string; roles: RoleName[] }[] = [
  // ORDER IS THE RULE, not a detail: the frames are tried most-explicit-first; a match that
  // PARTIALLY overlaps an already-claimed span is discarded; and a match that FULLY CONTAINS
  // already-claimed spans SUPERSEDES them (containment precedence — an outer quotation beats a
  // frame nested inside it). The third clause is not decoration: widening the quotation
  // delimiters below let an inner frame claim first, and the outer match was then discarded as an
  // overlap, so 116 passages silently changed from the outer relation to an inner one. Measured necessity —
  // `孔子謂弟子曰：「學而時習之。」` matches the three-slot frame (correct: agent 孔子,
  // recipient 弟子) AND the bare-曰 frame (agent 弟子), and treating that as two
  // matches made every three-slot passage "ambiguous" and destroyed all 29 existing
  // corpus records. And `王問曰：「何謂也？」` was silently absorbed by the no-曰
  // three-slot frame with recipient `曰` — a slot holding the verb itself. Both are
  // fixed by ordering the frames by how many markers they require.
  { id: 'wei-quote', verb: '謂', source: `(${ENTITY})謂(${ENTITY_NO_YUE})曰${COLON}${Q_OPEN}(${SPEECH})${Q_CLOSE}`, roles: ALL_ROLES },
  { id: 'wen-quote', verb: '問', source: `(${ENTITY})問(${ENTITY_NO_YUE})曰${COLON}${Q_OPEN}(${SPEECH})${Q_CLOSE}`, roles: ALL_ROLES },
  { id: 'gao-quote', verb: '告', source: `(${ENTITY})告(${ENTITY_NO_YUE})曰${COLON}${Q_OPEN}(${SPEECH})${Q_CLOSE}`, roles: ALL_ROLES },
  { id: 'yu-quote', verb: '語', source: `(${ENTITY})語(${ENTITY_NO_YUE})曰${COLON}${Q_OPEN}(${SPEECH})${Q_CLOSE}`, roles: ALL_ROLES },
  // Two-slot forms: the addressee is simply not there. `子曰：「學而時習之。」` is the
  // commonest shape in the corpus and states a speaker and a quotation only.
  // Only the two-slot 問/告 forms are declared: measured on the corpus, the two-slot
  // 謂/語 forms are dominated by adverbials and particles (厲聲謂曰, 樅公相謂曰,
  // 蓋其語曰, 故諸儒爲之語曰). Labelling those spans as the agent would assert something
  // false, and this grammar may only carry evidence a supervisor can state truthfully.
  { id: 'wen-plain', verb: '問', source: `(${ENTITY_NO_VERB})問曰${COLON}${Q_OPEN}(${SPEECH})${Q_CLOSE}`, roles: AGENT_THEME },
  { id: 'gao-plain', verb: '告', source: `(${ENTITY_NO_VERB})告曰${COLON}${Q_OPEN}(${SPEECH})${Q_CLOSE}`, roles: AGENT_THEME },
  { id: 'yue-quote', verb: '曰', source: `(${ENTITY_NO_VERB})曰${COLON}${Q_OPEN}(${SPEECH})${Q_CLOSE}`, roles: AGENT_THEME },
];

export const CONSTRUCTION_IDS = FRAMES.map((f) => f.id);

/**
 * Which roles a construction expresses. Exported because a LABEL must be checked
 * against it: the seeding tool may not invent a recipient for a construction that
 * does not express one, and may not leave one null for a construction that does.
 */
export function ROLES_FOR_CONSTRUCTION(id: string): RoleName[] {
  const f = FRAMES.find((x) => x.id === id);
  if (!f) throw new Error(`unknown construction: ${id}`);
  return f.roles.slice();
}

/**
 * Word-formation: a construction as a NAMED UNIT with an interpretation and a reuse contract.
 *
 * Vocabulary from Adva 0131: "`word-formation` records a named unit within a language, with
 * its interpretation and reuse contract. A word may denote a hypothesis; forming the name
 * does not prove it."
 *
 * Until now the seven constructions were a regex plus prose comments: the name `yue-quote`
 * carried no stated interpretation, and nothing said what a caller may NOT conclude from
 * it. `doesNotLicence` is that field. It is REQUIRED and must be non-empty, because a name
 * whose limits are unstated is precisely the thing 0131 warns about — and this project’s
 * record shows the cost: `verifySources()` reported 29/29 healthy while eleven records
 * carried labels that could not be stated truthfully.
 *
 * NO CORPUS REACH FIGURE APPEARS HERE, deliberately. A hardcoded "yue-quote covers 20.57%"
 * goes stale the next time the corpus grows — exactly the failure the gate-dependency map
 * caught in knowledge/dialogue/readiness.json. Reach is measured by tools/grammar/measure.mjs
 * and audited by readiness G5.
 */
export type Construction = {
  id: string;
  frame: string;
  roles: RoleName[];
  interpretation: string;
  reuseContract: string;
  doesNotLicence: string[];
};

export const CONSTRUCTIONS: Construction[] = [
  {
    id: 'wei-quote', frame: '<A>謂<B>曰：「<S>」', roles: ALL_ROLES,
    interpretation: 'A speaks to B; S is what A said. All three roles are stated by the frame.',
    reuseContract: 'The three spans are the surface agent, addressee and quotation, and the mapping was '
      + 'pinned by supervised labels for THIS construction.',
    doesNotLicence: [
      'that 謂 means "said to" everywhere — the name records a frame, not a lexeme',
      'that B heard, accepted or acted on S',
      'that A believes S: speakers report other people constantly, and 謂-quotes often do exactly that',
    ],
  },
  {
    id: 'wen-quote', frame: '<A>問<B>曰：「<S>」', roles: ALL_ROLES,
    interpretation: 'A asks B, and S is the question asked. All three roles are stated.',
    reuseContract: 'As wei-quote: three surface spans, mapping pinned by THIS construction’s labels.',
    doesNotLicence: [
      'that S is interrogative in form — the frame marks asking, and the quotation is whatever follows',
      'that B answered: the answer, if any, is outside this construction',
    ],
  },
  {
    id: 'gao-quote', frame: '<A>告<B>曰：「<S>」', roles: ALL_ROLES,
    interpretation: 'A informs B; S is what A told B. All three roles are stated.',
    reuseContract: 'As wei-quote: three surface spans, mapping pinned by THIS construction’s labels.',
    doesNotLicence: [
      'that the information was requested or welcome',
      'that 告 carries the same force here as in 告于宗廟-style ritual formulae',
    ],
  },
  {
    id: 'yu-quote', frame: '<A>語<B>曰：「<S>」', roles: ALL_ROLES,
    interpretation: 'A speaks to B; S is what A said. All three roles are stated.',
    reuseContract: 'As wei-quote: three surface spans, mapping pinned by THIS construction’s labels.',
    doesNotLicence: [
      'that 語 implies advice or instruction rather than speech',
      'anything about the relative status of A and B — that is not in the frame',
    ],
  },
  {
    id: 'wen-plain', frame: '<A>問曰：「<S>」', roles: AGENT_THEME,
    interpretation: 'A asks, and S is the question. The frame names a speaker and a question and NO addressee.',
    reuseContract: 'Two surface spans; recipient is null because the construction does not express it, and '
      + 'the missing-role contract (tools/grammar/contract.json missingRoleSemantics) governs what that means.',
    doesNotLicence: [
      'that there was no addressee — only that this frame does not state one',
      'that the addressee is unknown, or that it can be recovered from context; if a caller needs it, the '
      + 'answer about that role is Unknown',
    ],
  },
  {
    id: 'gao-plain', frame: '<A>告曰：「<S>」', roles: AGENT_THEME,
    interpretation: 'A announces; S is what was announced. No addressee is expressed.',
    reuseContract: 'As wen-plain: two spans, recipient null under the missing-role contract.',
    doesNotLicence: [
      'that the announcement was public or addressed to anyone in particular',
      'that A is the origin of S rather than its transmitter',
    ],
  },
  {
    id: 'yue-quote', frame: '<A>曰：「<S>」', roles: AGENT_THEME,
    interpretation: 'A speaks; S is what A said. The commonest shape in the corpus, and it states no addressee.',
    reuseContract: 'Two spans, recipient null under the missing-role contract; the agent span may not contain '
      + 'a reporting verb, so a verb-bearing run before 曰 is not read as an agent.',
    doesNotLicence: [
      'that A is the author of S rather than a quoter — 子曰 quotes, transmits and reports',
      'that the whole passage is about A: only the frame is read, and a passage may hold several frames '
      + '(see additionalMatches)',
      'that A is a person: a book title can occupy the agent slot, and the frame cannot tell',
    ],
  },
];

/** The named units and the pattern table must describe the same set. */
function assertConstructions() {
  const ids = FRAMES.map((f) => f.id);
  const named = CONSTRUCTIONS.map((c) => c.id);
  if (ids.length !== named.length || ids.some((id, i) => id !== named[i])) {
    throw new Error(`CONSTRUCTIONS and FRAMES disagree: [${named}] vs [${ids}]`);
  }
  for (const c of CONSTRUCTIONS) {
    const f = FRAMES.find((x) => x.id === c.id)!;
    if (c.roles.length !== f.roles.length || c.roles.some((r, i) => r !== f.roles[i])) {
      throw new Error(`construction ${c.id}: declared roles differ from its frame`);
    }
    if (!c.interpretation || !c.reuseContract) throw new Error(`construction ${c.id}: no interpretation or reuse contract`);
    // The field that makes "forming the name does not prove it" checkable.
    if (!Array.isArray(c.doesNotLicence) || !c.doesNotLicence.length) {
      throw new Error(`construction ${c.id}: doesNotLicence is empty — a name whose limits are unstated is `
        + 'exactly what word-formation is supposed to prevent');
    }
  }
}
assertConstructions();

function permutations(n: number): number[][] {
  // Base case must be n === 0. Written as `n <= 1` it returned `[[]]` for n === 1 — an
  // empty order rather than `[0]` — so permutations(2) and permutations(3) came back
  // EMPTY and every construction reported "contradictory evidence".
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let i = 0; i <= rest.length; i++) out.push([...rest.slice(0, i), n - 1, ...rest.slice(i)]);
  }
  return out;
}
/** All orderings of the roles a construction actually expresses. */
const ORDERS_FOR = (roles: RoleName[]) => permutations(roles.length);
function assertFrames() {
  for (const f of FRAMES) {
    // Count CAPTURING groups only: the patterns contain non-capturing groups
    // (`(?:`, `(?!`) and a first version of this check counted those too, which
    // rejected the two-slot frame as "4 captures but 2 roles".
    const n = (f.source.match(/\((?!\?)/g) ?? []).length;
    if (n !== f.roles.length) throw new Error(`frame ${f.id}: ${n} capture(s) but ${f.roles.length} role(s)`);
  }
}
assertFrames();

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
  roles: RoleName[];
  occurrences: Occurrence[];
  matches: number;
};

/** Unexpressed roles stay null; expressed roles take the slot the order assigns them. */
function assign(slots: string[], order: number[], roles: RoleName[]): Roles {
  const out: Roles = { agent: null, recipient: null, theme: null };
  roles.forEach((role, i) => { out[role] = slots[order[i]]; });
  return out;
}

function equal(a: Roles, b: Roles) {
  return a.agent === b.agent && a.recipient === b.recipient && a.theme === b.theme;
}

/**
 * An expectation is valid against a construction when every role the construction
 * EXPRESSES is a non-empty string and every role it does not express is null. This is
 * what keeps "unexpressed" from decaying into "whatever was convenient": a label may
 * not quietly supply a recipient the text never states.
 */
function validExpected(r: unknown, roles: RoleName[]): r is Roles {
  const x = r as Roles;
  if (!x || typeof x !== 'object') return false;
  for (const role of ALL_ROLES) {
    const v = x[role];
    if (roles.includes(role)) {
      if (typeof v !== 'string' || !v) return false;
    } else if (v !== null) return false;
  }
  return true;
}

/**
 * Locate the frame(s) in a passage. Unlike the experimental grammar this is a
 * SEARCH, not a whole-string match: real passages embed the frame in context.
 * More than one match is reported as ambiguous instead of resolved by fiat.
 */
function parse(text: string): Parsed | undefined {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_UNITS) return undefined;
  const found: Parsed[] = [];
  // Spans already claimed by a MORE EXPLICIT frame. A later frame may not re-read them.
  const claimed: [number, number][] = [];
  for (const frame of FRAMES) {
    const re = new RegExp(frame.source, 'gu');
    for (const m of text.matchAll(re)) {
      const spanStart = m.index ?? 0;
      const spanEnd = spanStart + m[0].length;
      const partial = claimed.some(([a, b]) => spanStart < b && a < spanEnd && !(a >= spanStart && b <= spanEnd));
      if (partial) continue;
      // CONTAINMENT PRECEDENCE, declared: an OUTER quotation beats any frame nested inside it.
      // Without this, widening the delimiters let an inner frame claim first and the outer match
      // was then discarded as an overlap - measured, 116 passages changed construction, almost all
      // from an outer frame to an inner one, i.e. the primary relation was being thrown away.
      const swallowed = found.filter((f) => f.spanStart >= spanStart && f.spanEnd <= spanEnd);
      for (const sw of swallowed) {
        const i = found.indexOf(sw);
        if (i >= 0) found.splice(i, 1);
      }
      const keptClaims = claimed.filter(([a, b]) => !(a >= spanStart && b <= spanEnd));
      claimed.length = 0;
      claimed.push(...keptClaims);
      claimed.push([spanStart, spanEnd]);
      const occurrences: Occurrence[] = [];
      for (let slot = 0; slot < frame.roles.length; slot++) {
        const value = m[slot + 1];
        // Locate each capture inside the match so offsets point at the source.
        const localStart = m[0].indexOf(value);
        const start = (m.index ?? 0) + localStart;
        occurrences.push({ slot, value, start, end: start + value.length });
      }
      found.push({ construction: frame.id, slots: m.slice(1, 1 + frame.roles.length),
        roles: frame.roles, occurrences, matches: 1, spanStart, spanEnd });
    }
  }
  if (!found.length) return undefined;
  if (found.length > 1) {
    return { construction: found[0].construction, slots: found[0].slots,
      roles: found[0].roles, occurrences: found[0].occurrences, matches: found.length };
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
  for (const frame of FRAMES) rules[frame.id] = ORDERS_FOR(frame.roles);
  const seen = new Set<string>();
  for (const e of model.examples) {
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 128 || seen.has(e.id)) {
      throw new Error('invalid evidence');
    }
    seen.add(e.id);
    const p = parse(e.text);
    if (!p) throw new Error('out-of-grammar evidence');
    // The expectation is checked against THIS construction's expressed roles, so a
    // label cannot supply a role the construction does not express.
    if (!validExpected(e.expected, p.roles)) throw new Error('invalid evidence');
    rules[p.construction] = rules[p.construction].filter((order) =>
      equal(assign(p.slots, order, p.roles), e.expected));
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
  const candidates = rules[p.construction].map((order) => assign(p.slots, order, p.roles));
  return {
    status: candidates.length === 1 ? 'KnownFiniteGrammar' : 'Unknown',
    ...(candidates.length === 1 ? {} : { reason: 'ambiguous-role-mapping' }),
    source: text,
    construction: p.construction,
    candidates,
    occurrences: p.occurrences,
    ...(p.matches > 1 ? { additionalMatches: p.matches - 1 } : {}),
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
  if (!example || typeof example.id !== 'string' || !example.id || example.id.length > 128) {
    throw new Error('invalid training example');
  }
  if (model.examples.length >= 32) throw new Error('evidence capacity reached');
  if (model.examples.some((e) => e.id === example.id)) throw new Error('duplicate evidence id');
  const p = parse(example.text);
  if (!p) {
    return { status: 'Unknown', reason: 'outside-reporting-grammar',
      model, checked: 0, refutations: [] };
  }
  if (!validExpected(example.expected, p.roles)) throw new Error('invalid training example');
  const candidates = rules[p.construction];
  const refutations: { order: number[]; actual: Roles; expected: Roles }[] = [];
  const survivors: number[][] = [];
  let checked = 0;
  for (const order of candidates) {
    if (checked === fuel) {
      return { status: 'Unknown', reason: 'fuel-exhausted', model, checked, refutations };
    }
    checked++;
    const actual = assign(p.slots, order, p.roles);
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

/**
 * Would `replay` accept this label? The real criterion for "in grammar".
 *
 * A record is usable only if the grammar can read its text and the label is consistent
 * with the construction's permutation space. Testing merely that a construction was
 * RECOGNISED admitted records `replay` then rejected, and because replay is
 * all-or-nothing one such record made every construction throw.
 */
export function labelIsConsistent(text: string, expected: Roles): boolean {
  try {
    const p = parse(text);
    if (!p || !validExpected(expected, p.roles)) return false;
    return ORDERS_FOR(p.roles).some((order) => equal(assign(p.slots, order, p.roles), expected));
  } catch {
    return false;
  }
}

export function compareReporting(a: string, b: string, model: ReportingModel) {
  const left = readReporting(a, model);
  const right = readReporting(b, model);
  if (left.status === 'Unknown' || right.status === 'Unknown') {
    return { status: 'Unknown', left, right };
  }
  const x = left.candidates[0];
  const y = right.candidates[0];
  // A null role can never be "the same as" another: an unexpressed role is not a value,
  // so two readings of an addressee-less construction are SameRelation only when their
  // expressed roles agree, and they can never be a RoleReversal of each other.
  const status = equal(x, y) ? 'SameRelation'
    : (x.agent !== null && x.recipient !== null && y.agent !== null && y.recipient !== null
      && x.agent !== x.recipient && x.agent === y.recipient && x.recipient === y.agent
      && x.theme === y.theme) ? 'RoleReversal' : 'DifferentRelation';
  return { status, left, right };
}
