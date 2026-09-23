/**
 * Projection policy: how evidence is turned into the model the module can replay.
 *
 * WHY THIS EXISTS
 * The 32-example cap is a hard budget on ONE model inside the verified module
 * (`learnRelations` throws at 32; `replay` rejects above it). This step may not
 * change that module, so the cap stays. What had to change is what the projection
 * layer does around it, because `projectModel` used to do `pool.slice(0, cap)`:
 * it silently discarded the tail and reported only a count. Measured on a
 * synthetic pool of 40, that is 8 records dropped with no name attached. Three
 * call sites had the same `slice(0, 32)` bug of their own.
 *
 * THE POLICY
 * Evidence is split by ROLE rather than truncated by position:
 *
 *   operational core  the minimum falsifiable set — `minPerConstruction` (2 by
 *                     default) per construction. One correct label already
 *                     collapses the 6 role permutations to 1 (measured); the
 *                     second is what makes a WRONG first label detectable
 *                     instead of silently authoritative.
 *   held out          every other record, kept in the store, deliberately NOT in
 *                     the model.
 *
 * Holding records out is not a compromise. Loading them would add no mapping
 * information — the mapping is already pinned — while making one bad label fatal
 * to every construction, because `replay` throws on contradiction and runs
 * before every read. Measured: one contradicting record in `wei-quote` made all
 * four reporting constructions throw. The held-out set is more useful as a
 * contradiction detector than as model input.
 */
import { MODEL_CAP } from './store.mjs';

/** Deterministic priority: supervisor labels first, corpus-sourced first, then id. */
function priorityOf(r) {
  return [
    r.label?.kind === 'supervisor' ? 0 : 1,
    r.source?.kind === 'corpus' ? 0 : 1,
    String(r.id),
  ];
}

function compare(a, b) {
  const A = priorityOf(a);
  const B = priorityOf(b);
  for (let i = 0; i < A.length; i++) {
    if (A[i] < B[i]) return -1;
    if (A[i] > B[i]) return 1;
  }
  return 0;
}

const toExample = (r) => ({
  id: r.id,
  text: r.text,
  expected: { agent: r.expected.agent, recipient: r.expected.recipient, theme: r.expected.theme },
});

/**
 * Where a record's text came from. This is the field that makes filtering
 * possible at all: `corpus` records are quotations of real text with a passage
 * id and a revision behind them; anything else is a sentence written to exercise
 * the machinery (`「甲」授「乙」「书」。` and friends).
 */
export function provenanceClass(record) {
  return record?.source?.kind === 'corpus' ? 'corpus' : 'authored';
}

/**
 * Select the operational core for one grammar.
 *
 * `provenance` narrows the pool by where the text came from:
 *   'any'      no filter (default; used by grammars that are themselves fixtures)
 *   'corpus'   corpus-derived evidence ONLY — the rule for learning from the corpus
 *   'authored' synthetic evidence only
 *
 * Records excluded by the filter are NAMED, never silently skipped, and a
 * construction left without evidence makes `complete` false with a reason —
 * so a grammar that cannot be learned from the corpus says so instead of quietly
 * falling back to sentences someone invented.
 */
export function selectOperationalCore(records, {
  grammar,
  constructionOf,
  expectedConstructions = null,
  minPerConstruction = 2,
  cap = MODEL_CAP,
  provenance = 'any',
  isConsistent = null,
} = {}) {
  if (typeof constructionOf !== 'function') {
    throw new Error('selectOperationalCore requires constructionOf(text)');
  }
  const pool = records.filter((r) => r.grammar === grammar);
  const excludedByProvenance = provenance === 'any'
    ? [] : pool.filter((r) => provenanceClass(r) !== provenance).map((r) => r.id);
  const usable = provenance === 'any'
    ? pool : pool.filter((r) => provenanceClass(r) === provenance);

  const byConstruction = new Map();
  const outOfGrammar = [];
  for (const r of usable) {
    const c = constructionOf(r.text);
    // Recognising a construction is NOT enough: the grammar must also ACCEPT the label.
    // Records that merely look in-grammar were admitted before, and replay — being
    // all-or-nothing — then threw for every construction. `isConsistent` is the real
    // criterion; constructionOf alone is only a bucketing key.
    if (!c || (isConsistent && !isConsistent(r))) { outOfGrammar.push(r.id); continue; }
    if (!byConstruction.has(c)) byConstruction.set(c, []);
    byConstruction.get(c).push(r);
  }

  // DECLARED constructions are checked even when they have NO evidence left.
  // Iterating only the constructions observed in the records meant that
  // exhausting one made it vanish from the map, and `.every()` then passed
  // VACUOUSLY — so a grammar with a completely unevidenced construction reported
  // complete: true while its readings were Unknown. Absence must fail a check,
  // never satisfy it.
  const allConstructions = [...new Set([...(expectedConstructions ?? []), ...byConstruction.keys()])].sort();

  const core = [];
  const perConstruction = {};
  for (const c of allConstructions) {
    const list = byConstruction.get(c) ?? [];
    const sorted = [...list].sort(compare);
    const take = sorted.slice(0, minPerConstruction);
    perConstruction[c] = {
      available: list.length,
      selected: take.length,
      sufficient: take.length >= minPerConstruction,
      selectedIds: take.map((r) => r.id),
      ...(list.length === 0 ? { note: 'no evidence at all remaining for this declared construction' } : {}),
    };
    core.push(...take);
  }

  if (core.length > cap) {
    throw new Error(
      `operational core for ${grammar} needs ${core.length} examples but the model cap is ${cap}. ` +
      `This is a design error, not a data problem: either lower minPerConstruction or declare fewer ` +
      `constructions. Silently dropping the tail is not an option.`);
  }

  const selectedIds = new Set(core.map((r) => r.id));
  const emptyReason = provenance === 'any' ? null
    : Object.keys(perConstruction).length === 0
      ? `no ${provenance}-derived evidence exists for ${grammar}; ` +
        `${excludedByProvenance.length} record(s) were excluded by provenance. This grammar cannot be ` +
        `learned from the corpus — it says so rather than falling back to invented sentences.`
      : null;
  return {
    model: { schema: grammar, examples: core.map(toExample) },
    included: [...selectedIds],
    heldOut: usable.filter((r) => !selectedIds.has(r.id) && !outOfGrammar.includes(r.id)).map((r) => r.id),
    outOfGrammar,
    excludedByProvenance,
    provenance,
    ...(emptyReason ? { emptyReason } : {}),
    perConstruction,
    complete: emptyReason === null
      && Object.values(perConstruction).every((p) => p.sufficient)
      && Object.keys(perConstruction).length > 0,
    poolSize: pool.length,
    usableSize: usable.length,
    cap,
  };
}

/**
 * Replay the held-out records against the core in batches to find disagreements.
 * This is what the held-out set is FOR. Batches keep the model within the cap and
 * keep a single bad record from being indistinguishable from a bad core.
 * @returns {{batchSize:number, batches:number, conflicts:object[], clean:number}}
 */
export function auditHeldOut(records, core, { grammar, read, constructionOf, batchSize = 8 } = {}) {
  const heldOut = records.filter((r) => r.grammar === grammar && !core.included.includes(r.id));
  const usable = heldOut.filter((r) => constructionOf(r.text));
  const conflicts = [];
  let clean = 0;
  const coreExamples = core.model.examples;
  for (let i = 0; i < usable.length; i += batchSize) {
    const batch = usable.slice(i, i + batchSize);
    const model = { schema: grammar, examples: [...coreExamples, ...batch.map(toExample)] };
    try {
      // A batch that replays cleanly agrees with the core on every record in it.
      read(batch[0].text, model);
      clean += batch.length;
    } catch (e) {
      // Something in this batch disagrees (or the batch exceeded the cap).
      for (const r of batch) {
        const solo = { schema: grammar, examples: [...coreExamples, toExample(r)] };
        try {
          read(r.text, solo);
          clean++;
        } catch (err) {
          conflicts.push({ id: r.id, source: r.source?.kind ?? null,
            labelBy: r.label?.by ?? null, reason: err.message });
        }
      }
    }
  }
  return { batchSize, batches: Math.ceil(usable.length / batchSize), conflicts, clean };
}
