/**
 * Durable evidence store for the relation layer.
 *
 * DESIGN CLAIM, grounded in the code that already exists: `RelationModel` holds
 * only `examples` (supervised labelled sentences). The "network" — per
 * construction, which role permutations survive — is recomputed by the private
 * `replay(model)` on every read and every update; it is never stored.
 *
 *   model  = { schema, examples[] }        <- the atoms: evidence
 *   rules  = replay(model)                  <- a pure function, a derived view
 *
 * So the thing that must not be lost is the EVIDENCE, not the network. Storing
 * the derived network would mean storing a cache that can silently drift from
 * its own inputs. Storing the evidence means:
 *   - the network is always recomputable, so schema changes need a re-project,
 *     not a data migration;
 *   - `replay()` doubles as a built-in validator: any evidence set that replays
 *     is internally consistent by construction;
 *   - when new evidence contradicts old evidence, that is detectable instead of
 *     being hidden inside a stale derived graph.
 *
 * The in-memory model caps out at 32 examples, so a store may hold many more
 * records than any single model: a model is a PROJECTION of the store (by
 * grammar version, and optionally by construction), not the store itself.
 *
 * Each record carries the GRAMMAR VERSION it was labelled under. Without that,
 * a future grammar change would silently reinterpret every historical label.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RECORD_SCHEMA = 'wenyan.relations.evidence.v1';
export const MODEL_CAP = 32;

/**
 * Canonical JSON: keys sorted at EVERY level, so a hash covers the actual
 * claim values. Exported because the semantic layer hashes claims too, and
 * re-implementing this is how the bug below gets repeated.
 *
 * BUG WORTH REMEMBERING: this was first written as
 *   const stable = (o) => JSON.stringify(o, Object.keys(o).sort());
 * An array second argument to JSON.stringify is a recursive key WHITELIST, so it
 * also applied to the nested `expected` object — whose keys (agent/recipient/
 * theme) are not in that list — and silently reduced it to `{}`. The hash then
 * ignored the role labels entirely. Two consequences, both fatal to the design:
 * a record could be edited without the tamper being detected, and
 * appendEvidence() would treat the SAME sentence with a CONTRADICTING label as
 * "identical claim already present" and silently drop it — the opposite of
 * preserving conflicts.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, canonicalJson(value[k])]),
    );
  }
  return value;
}
const stable = (o) => JSON.stringify(canonicalJson(o));

/** Hash over the CLAIM only (grammar + text + label), not over provenance. */
export function contentHash({ grammar, text, expected }) {
  return crypto.createHash('sha256')
    .update(stable({ grammar, text, expected }), 'utf8').digest('hex');
}

/** Hash over the text alone, to spot the same sentence labelled two ways. */
export function textHash({ grammar, text }) {
  return crypto.createHash('sha256').update(stable({ grammar, text }), 'utf8').digest('hex');
}

export function makeRecord({
  id, grammar, text, expected, label, source = null,
}) {
  if (!id || typeof id !== 'string' || id.length > 128) throw new Error('invalid evidence id');
  if (!grammar || typeof grammar !== 'string') throw new Error('missing grammar version');
  if (typeof text !== 'string' || !text) throw new Error('missing text');
  // A role is a non-empty string when the construction EXPRESSES it and null when it
  // does not. Requiring all three to be strings made `子曰：「學而時習之。」` — which
  // names a speaker and a quotation and no addressee — unstorable except by inventing
  // an addressee. At least one role must be expressed, and the grammar re-checks each
  // expectation against its own construction's role set (see relations-reporting.ts).
  if (!expected || typeof expected !== 'object') throw new Error('missing expected roles');
  let expressed = 0;
  for (const k of ['agent', 'recipient', 'theme']) {
    const v = expected[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'string' || !v) throw new Error(`invalid expected.${k}`);
    expressed++;
  }
  if (!expressed) throw new Error('expected has no expressed role');
  if (!label || typeof label !== 'object') throw new Error('missing label provenance');
  const record = {
    schema: RECORD_SCHEMA,
    id,
    grammar,
    text,
    expected: { agent: expected.agent ?? null, recipient: expected.recipient ?? null, theme: expected.theme ?? null },
    label,
    ...(source ? { source } : {}),
  };
  record.contentHash = contentHash(record);
  record.textHash = textHash(record);
  return record;
}

/**
 * Append one record. Idempotent by contentHash: re-appending the same claim is
 * a no-op, so a resumed or repeated learning session cannot duplicate evidence.
 * A duplicate id with different content is an error, not a silent overwrite.
 */
export function appendEvidence(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? loadEvidence(file).records : [];
  if (existing.some((r) => r.contentHash === record.contentHash)) {
    return { appended: false, reason: 'identical-claim-already-present' };
  }
  const clash = existing.find((r) => r.id === record.id);
  if (clash) throw new Error(`duplicate evidence id with different content: ${record.id}`);
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return { appended: true };
}

/**
 * Retraction: how a stored record stops licensing answers, without editing it.
 *
 * WHY APPEND-ONLY RATHER THAN DELETE OR EDIT
 * contentHash makes any edit detectable, which also means a record cannot be
 * corrected in place — and deleting it would destroy the history that makes the
 * store auditable. A retraction is therefore its own record, carrying a required
 * reason and a named retractor: retracting evidence is a judgement, and like every
 * other judgement here it must say who made it and on what basis.
 *
 * Restoring retracted evidence means appending a NEW record, never undoing
 * history. Retracting a retraction is refused.
 */
export const RETRACTION_SCHEMA = 'wenyan.relations.evidence-retraction.v1';

export function retractionHash(record) {
  return crypto.createHash('sha256').update(stable({
    targetId: record.targetId,
    reason: record.reason,
    retractedBy: record.retractedBy,
    supersededBy: record.supersededBy ?? null,
  }), 'utf8').digest('hex');
}

export function makeRetraction({ id, targetId, reason, retractedBy, supersededBy = null }) {
  if (!targetId || typeof targetId !== 'string') throw new Error('R1: a retraction must name the record it retracts');
  if (!reason || typeof reason !== 'string' || reason.trim().length < 8) {
    throw new Error('R2: a retraction must state a reason (at least a sentence)');
  }
  if (!retractedBy?.kind || !retractedBy?.by || !retractedBy?.at) {
    throw new Error('R3: a retraction must name its retractor (kind, by, at)');
  }
  const record = {
    schema: RETRACTION_SCHEMA,
    id: id ?? `retract:${targetId}`,
    targetId,
    reason,
    retractedBy,
    ...(supersededBy ? { supersededBy } : {}),
  };
  record.contentHash = retractionHash(record);
  return record;
}

/** Append a retraction. Idempotent: retracting the same target twice is a no-op. */
export function appendRetraction(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const loaded = loadEvidence(file);
  if (loaded.retractedIds.includes(record.targetId)) {
    return { appended: false, reason: 'already-retracted', targetId: record.targetId };
  }
  if (!loaded.allRecords.some((r) => r.id === record.targetId)) {
    throw new Error(`R4: no such record to retract: ${record.targetId}`);
  }
  if (loaded.retractions.some((r) => r.id === record.id)) {
    throw new Error(`duplicate retraction id: ${record.id}`);
  }
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return { appended: true, id: record.id, targetId: record.targetId };
}

export function loadEvidence(file) {
  if (!fs.existsSync(file)) {
    return { records: [], allRecords: [], retractedIds: [], retractions: [], issues: [] };
  }
  const allRecords = [];
  const retractions = [];
  const issues = [];
  const retractedIds = new Set();
  const retractionIds = new Set();
  const seenIds = new Set();

  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    let r;
    try { r = JSON.parse(t); } catch (e) {
      issues.push(`line ${i + 1}: not valid JSON (${e.message})`);
      return;
    }

    if (r.schema === RETRACTION_SCHEMA) {
      if (r.contentHash !== retractionHash(r)) {
        issues.push(`line ${i + 1}: retraction contentHash mismatch (retraction tampered)`);
      }
      if (!r.reason || !r.retractedBy?.by || !r.retractedBy?.kind) {
        issues.push(`line ${i + 1}: retraction without reason or retractor (R5)`);
      }
      // The target must already appear earlier in the log: a retraction cannot
      // precede what it retracts, and it cannot reference nothing.
      if (!seenIds.has(r.targetId)) {
        issues.push(`line ${i + 1}: retraction target not found earlier in the log: ${r.targetId}`);
      }
      // Retracting a retraction is refused: a retraction is final, and restoring
      // evidence means appending a NEW record, not undoing history.
      if (retractionIds.has(r.targetId)) {
        issues.push(`line ${i + 1}: refusing to retract a retraction: ${r.targetId}`);
      }
      if (retractedIds.has(r.targetId)) {
        issues.push(`line ${i + 1}: duplicate retraction of ${r.targetId} (idempotent, but recorded twice)`);
      }
      retractedIds.add(r.targetId);
      retractionIds.add(r.id);
      retractions.push(r);
      return;
    }

    if (r.schema !== RECORD_SCHEMA) issues.push(`line ${i + 1}: wrong schema ${r.schema}`);
    if (r.contentHash !== contentHash(r)) issues.push(`line ${i + 1}: contentHash mismatch (record tampered or edited)`);
    seenIds.add(r.id);
    allRecords.push(r);
  });

  const retracted = allRecords.filter((r) => retractedIds.has(r.id));
  return {
    // ACTIVE records by default. A retracted record must stop licensing answers
    // the moment it is retracted, so the safe set is the default one; `allRecords`
    // remains available for audit.
    records: allRecords.filter((r) => !retractedIds.has(r.id)),
    allRecords,
    retractedIds: [...retractedIds],
    retracted,
    retractions,
    issues,
  };
}

/** Structural health of the store, before any grammar is involved. */
export function integrityReport(records) {
  const issues = [];
  const notes = [];
  const byId = new Map();
  const byText = new Map();
  for (const r of records) {
    if (byId.has(r.id)) issues.push(`duplicate id: ${r.id}`);
    byId.set(r.id, r);
    if (!r.label?.kind) issues.push(`${r.id}: label has no kind (who asserted this?)`);
    if (!r.label?.at) notes.push(`${r.id}: label has no timestamp`);
    if (!r.source) notes.push(`${r.id}: no source (authored, not corpus-derived)`);
    const list = byText.get(r.textHash) ?? [];
    list.push(r);
    byText.set(r.textHash, list);
  }
  for (const [, list] of byText) {
    const distinct = new Set(list.map((r) => r.contentHash));
    if (distinct.size > 1) {
      issues.push(`same sentence labelled differently by ${list.length} records: ${JSON.stringify(list[0].text.slice(0, 30))}`);
    }
  }
  const grammars = {};
  for (const r of records) grammars[r.grammar] = (grammars[r.grammar] ?? 0) + 1;
  if (Object.keys(grammars).length > 1) {
    notes.push(`store spans multiple grammar versions: ${JSON.stringify(grammars)}`);
  }
  return { issues, notes, grammars, uniqueIds: byId.size };
}

/**
 * Project the store into a RelationModel the module can actually replay.
 *
 * This is the RAW primitive and it will not silently discard evidence. An earlier
 * version did `pool.slice(0, cap)` and reported only a count — measured on a
 * synthetic pool of 40, that silently dropped 8 records with no name attached,
 * and three call sites had grown their own `slice(0, 32)` of the same kind.
 *
 * @param {object} opts
 * @param {'refuse'|'prefix'} [opts.onOverflow] 'refuse' (default) throws when the
 *   pool exceeds the cap; 'prefix' accepts a positional cut AND returns the
 *   dropped ids so the loss is named. Prefer selectOperationalCore() from
 *   projection.mjs, which chooses by role instead of by position.
 */
export function projectModel(records, {
  grammar, constructionIds = null, parse, cap = MODEL_CAP, onOverflow = 'refuse',
} = {}) {
  let pool = records.filter((r) => r.grammar === grammar);
  if (constructionIds) {
    pool = pool.filter((r) => {
      const p = parse(r.text);
      return p && constructionIds.includes(p.construction);
    });
  }
  if (pool.length > cap && onOverflow !== 'prefix') {
    throw new Error(
      `projectModel would silently drop ${pool.length - cap} of ${pool.length} record(s) for ${grammar} ` +
      `(cap ${cap}). Use selectOperationalCore() in tools/knowledge/projection.mjs to choose explicitly, ` +
      `or pass onOverflow: 'prefix' to accept a positional cut and receive the dropped ids.`);
  }
  const chosen = pool.slice(0, cap);
  const dropped = pool.slice(cap);
  return {
    model: {
      schema: grammar,
      examples: chosen.map((r) => ({
        id: r.id,
        text: r.text,
        expected: { agent: r.expected.agent, recipient: r.expected.recipient, theme: r.expected.theme },
      })),
    },
    droppedByCap: dropped.length,
    droppedIds: dropped.map((r) => r.id),
    cutPositionally: dropped.length > 0,
    poolSize: pool.length,
  };
}

/**
 * Re-check every corpus-derived record against data/corpus.
 *
 * MATCHED BY TEXT, NOT BY POSITION. Passage ids (`30.38`) are positional, so any
 * change in the passage list renumbers them — and a judgement is about the TEXT,
 * not about a position number. An earlier version compared ids, and the first
 * corpus rebuild that removed structural markers made a perfectly valid label
 * look like drift. Now the id is treated as a locator: if the labelled text is
 * still in the work, the label still stands, and a moved id is reported as a
 * move rather than a failure. A label whose TEXT is gone is real drift.
 */
export function verifySources(records, corpusDir) {
  const results = [];
  const workCache = new Map();
  const loadWork = (id) => {
    if (!workCache.has(id)) {
      const f = path.join(corpusDir, 'works', `${id}.json`);
      workCache.set(id, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
    }
    return workCache.get(id);
  };
  for (const r of records) {
    const s = r.source;
    if (!s || s.kind !== 'corpus') continue;
    const doc = loadWork(s.work);
    if (!doc) { results.push({ id: r.id, ok: false, reason: `work not found: ${s.work}` }); continue; }

    const findPassage = (want) => {
      for (const sec of doc.sections) {
        for (const p of sec.passages) if (p.text === want) return { sec, p };
      }
      return null;
    };
    const hit = findPassage(s.passageTextAtLabel);
    if (!hit) {
      // The text itself is gone: that is genuine drift, not a renumbering.
      results.push({ id: r.id, ok: false, reason: 'the labelled passage text is no longer present in this work' });
      continue;
    }
    const moved = hit.p.id !== s.passageId || hit.sec.id !== s.section;
    const revidChanged = hit.sec.sourceRevid !== s.sourceRevid;
    results.push({
      id: r.id, ok: true,
      license: s.license?.status ?? 'unrecorded',
      ...(moved ? { passageIdMoved: { from: `${s.section}/${s.passageId}`, to: `${hit.sec.id}/${hit.p.id}` } } : {}),
      ...(revidChanged ? { sourceRevidChanged: { from: s.sourceRevid, to: hit.sec.sourceRevid } } : {}),
    });
  }
  return results;
}
