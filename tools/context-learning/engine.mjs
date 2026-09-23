// SPDX-License-Identifier: MIT
// Generalized derivative of tools/changes/learning.mjs, whose v1 bytes stay frozen.
// Design: Mingli Yuan. Implementation: Codex (OpenAI), via Mingli Yuan.
// Finite supervised feature-family learning. Predictions are proposals.
// Single-writer append-only log; no automatic execution and no majority vote.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../knowledge/store.mjs';
import { sha256 } from '../changes/catalog.mjs';

const hash = o => sha256(JSON.stringify(canonicalJson(o)));
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).sort().join(',') === keys.slice().sort().join(',');
const name = s => typeof s === 'string' && s.length > 0 && s.length <= 128;

export function createContextLearner(adapter) {
  const { schema: SCHEMA, features: FEATURES } = adapter;
  if (!name(SCHEMA) || !Array.isArray(FEATURES) || !FEATURES.length || new Set(FEATURES).size !== FEATURES.length
      || FEATURES.some(x => !name(x)) || ['context', 'key', 'record'].some(k => typeof adapter[k] !== 'function'))
    throw new Error('invalid context adapter');

  function replayLearning(events, catalog) {
    const profiles = new Map(), examples = new Map(), retracted = new Set(), ids = new Set();
    let previous = null;
    for (const event of events) {
      if (!exact(event, ['schema', 'id', 'previous', 'payload', 'provenance', 'hash']) || event.schema !== SCHEMA
          || !name(event.id) || ids.has(event.id) || event.previous !== previous) throw new Error('invalid event identity or chain');
      const { hash: recorded, ...body } = event;
      if (recorded !== hash(body)) throw new Error('event hash mismatch');
      if (!exact(event.provenance, ['by', 'basis']) || !name(event.provenance.by)
          || typeof event.provenance.basis !== 'string' || !event.provenance.basis) throw new Error('missing declared supervision');
      const p = event.payload;
      if (p?.kind === 'profile') {
        if (!exact(p, ['kind', 'profile', 'task', 'labels', 'hypotheses']) || !name(p.profile) || !name(p.task)
            || profiles.has(p.profile) || !Array.isArray(p.labels) || p.labels.length < 2 || p.labels.length > 32
            || p.labels.some(x => !name(x)) || new Set(p.labels).size !== p.labels.length
            || !Array.isArray(p.hypotheses) || !p.hypotheses.length || p.hypotheses.length > 64) throw new Error('invalid profile');
        const signatures = new Set();
        for (const h of p.hypotheses) {
          if (!Array.isArray(h) || !h.length || h.length > FEATURES.length || new Set(h).size !== h.length
              || h.some(f => !FEATURES.includes(f))) throw new Error('undeclared feature');
          const signature = h.slice().sort().join(',');
          if (signatures.has(signature)) throw new Error('duplicate hypothesis');
          signatures.add(signature);
        }
        profiles.set(p.profile, { ...p, eventId: event.id });
      } else if (p?.kind === 'example') {
        if (!exact(p, ['kind', 'profile', 'context', 'label', 'source']) || !profiles.has(p.profile)
            || !profiles.get(p.profile).labels.includes(p.label)) throw new Error('invalid labelled example');
        adapter.context(p.context);
        if (p.source?.kind === 'corpus') {
          const line = adapter.record(catalog, p.context);
          if (!exact(p.source, ['kind', 'reference', 'text']) || hash(p.source.reference) !== hash(line.source)
              || p.source.text !== line.text) throw new Error('stale or mismatched source binding');
        } else if (!exact(p.source, ['kind', 'note']) || p.source.kind !== 'authored'
            || typeof p.source.note !== 'string' || !p.source.note) throw new Error('missing source kind');
        examples.set(event.id, { ...p, id: event.id, provenance: event.provenance });
      } else if (p?.kind === 'retract') {
        if (!exact(p, ['kind', 'target', 'reason']) || !examples.has(p.target) || retracted.has(p.target)
            || typeof p.reason !== 'string' || !p.reason) throw new Error('invalid retraction');
        retracted.add(p.target);
      } else throw new Error('unknown learning event');
      ids.add(event.id); previous = recorded;
    }
    return { profiles, active: [...examples.values()].filter(e => !retracted.has(e.id)), retracted: [...retracted], head: previous };
  }

  function makeLearningEvent(events, { id, payload, provenance }, catalog) {
    const body = { schema: SCHEMA, id, previous: events.length ? events[events.length - 1].hash : null, payload, provenance };
    const event = { ...body, hash: hash(body) };
    replayLearning([...events, event], catalog);
    return event;
  }
  function loadLearning(file, catalog) {
    const events = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(x => x.trim()).map(x => JSON.parse(x)) : [];
    replayLearning(events, catalog);
    return events;
  }
  function appendLearning(file, input, catalog) {
    const events = loadLearning(file, catalog);
    const old = events.find(e => e.id === input.id);
    if (old) {
      if (hash(old.payload) === hash(input.payload) && hash(old.provenance) === hash(input.provenance))
        return { appended: false, event: old };
      throw new Error('event id already names different content');
    }
    const event = makeLearningEvent(events, input, catalog);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // The CLI is single-writer. A concurrent writer requires an external lock.
    const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    fs.appendFileSync(file, (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(event) + '\n');
    return { appended: true, event };
  }

  function predictContext(events, profileId, context, catalog, fuel = 100000) {
    const state = replayLearning(events, catalog);
    const profile = state.profiles.get(profileId);
    if (!profile) throw new Error('undeclared profile');
    const query = adapter.context(context);
    if (!Number.isSafeInteger(fuel) || fuel < 0 || fuel > 1000000) throw new Error('invalid prediction fuel');
    // Explicit extension may use a new feature family for the same declared task.
    // Old labels are reusable only with an identical label inventory.
    const examples = state.active.filter(e => {
      const p = state.profiles.get(e.profile);
      return p.task === profile.task && hash(p.labels) === hash(profile.labels);
    });
    const contexts = new Map();
    for (const e of examples) {
      const k = adapter.key(e.context);
      if (!contexts.has(k)) contexts.set(k, []);
      contexts.get(k).push(e);
    }
    const conflicts = [...contexts].filter(([, es]) => new Set(es.map(e => e.label)).size > 1);
    const queryKey = adapter.key(context);
    const conflict = conflicts.find(([k]) => k === queryKey);
    if (conflict) return { status: 'Contested', context, profile: profileId,
      disagreement: conflict[1].map(e => ({ id: e.id, label: e.label, provenance: e.provenance })) };
    // Conflicts are local: retain and name them, omit them from rule induction.
    const excluded = new Set(conflicts.map(([k]) => k));
    const usable = examples.filter(e => !excluded.has(adapter.key(e.context)));
    const excludedConflicts = conflicts.map(([key, es]) => ({ key, refs: es.map(e => e.id) }));
    const survivors = [], refuted = []; let checked = 0;
    for (const features of profile.hypotheses) {
      const table = new Map(); let counterexample = null;
      for (const e of usable) {
        if (checked === fuel) return { status: 'Unknown', reason: 'fuel-exhausted', checked, profile: profileId, excludedConflicts };
        checked++;
        const c = adapter.context(e.context);
        const key = JSON.stringify(features.map(f => c[f]));
        const old = table.get(key);
        if (old && old.label !== e.label) { counterexample = [old.refs[0], e.id]; break; }
        if (old) old.refs.push(e.id); else table.set(key, { label: e.label, refs: [e.id] });
      }
      if (counterexample) refuted.push({ features, counterexample });
      else survivors.push({ features, prediction: table.get(JSON.stringify(features.map(f => query[f]))) ?? null });
    }
    const common = { profile: profileId, context, checked, survivors, refuted, excludedConflicts, head: state.head };
    if (!survivors.length) return { status: 'Unknown', reason: 'hypothesis-family-refuted', ...common };
    if (survivors.some(h => !h.prediction)) return { status: 'Unknown', reason: 'uncovered-context', ...common };
    if (new Set(survivors.map(h => h.prediction.label)).size !== 1)
      return { status: 'Unknown', reason: 'surviving-hypotheses-disagree', ...common };
    return { status: 'CandidateReading', label: survivors[0].prediction.label,
      authority: 'conditional-on-supervisor-labels-and-declared-feature-family',
      warrant: { profile: profile.eventId, refs: usable.map(e => e.id) }, ...common };
  }

  return Object.freeze({ replayLearning, makeLearningEvent, loadLearning, appendLearning, predictContext });
}
