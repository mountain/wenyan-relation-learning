/**
 * Retract a stored record — without editing or deleting it.
 *
 *   node tools/knowledge/retract.mjs --target <id> --reason "..." [--by "..."]
 *                                    [--superseded-by <id>] [--store path] [--dry-run]
 *
 * Retraction is a judgement, so it requires a reason and a named retractor, and
 * it is appended rather than applied: the record stays in the log and stops being
 * ACTIVE. The tool prints the consequence before and after, because retracting
 * evidence can quietly downgrade a grammar from determined to ambiguous — and a
 * quiet downgrade is exactly the kind of change this project refuses to make.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEvidence, makeRetraction, appendRetraction } from './store.mjs';
import { selectOperationalCore, provenanceClass } from './projection.mjs';
import { makeContext, GRAMMARS } from '../dialogue/ask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const storePath = path.resolve(flag('store', path.join(ROOT, 'knowledge/relations/evidence.jsonl')));
const targetId = flag('target');
const reason = flag('reason');
const dryRun = argv.includes('--dry-run');

if (!targetId || !reason) {
  console.error('usage: retract.mjs --target <record-id> --reason "<why>" [--by <who>] [--superseded-by <id>] [--dry-run]');
  console.error('\nA retraction must say WHAT it retracts and WHY. Both are required.');
  process.exit(2);
}

/** Per-grammar consequence of the current active set. */
function consequences(records) {
  const ctx = makeContext({ storePath });
  const out = [];
  for (const [id, spec] of Object.entries(GRAMMARS)) {
    const impl = ctx.forGrammar(id);
    if (!impl) continue;
    const core = selectOperationalCore(records, {
      grammar: id, constructionOf: impl.constructionOf, provenance: spec.provenance ?? 'any',
      expectedConstructions: spec.constructions ?? null,
    });
    out.push({
      grammar: id,
      short: id.includes('reporting') ? 'reporting' : 'experimental',
      provenance: spec.provenance ?? 'any',
      core: core.included.length,
      complete: core.complete,
      insufficient: Object.entries(core.perConstruction)
        .filter(([, v]) => !v.sufficient).map(([c, v]) => `${c} (${v.selected}/${v.available})`),
    });
  }
  return out;
}

const before = loadEvidence(storePath);
const target = before.allRecords.find((r) => r.id === targetId);
if (!target) {
  console.error(`no such record: ${targetId}`);
  console.error(`active records: ${before.records.length}; retracted: ${before.retractedIds.length}`);
  process.exit(3);
}
if (before.retractedIds.includes(targetId)) {
  console.log(`[retract] ${targetId} is already retracted — nothing to do (idempotent).`);
  process.exit(0);
}

const record = makeRetraction({
  targetId,
  reason,
  retractedBy: {
    kind: 'operator',
    by: flag('by', 'tools/knowledge/retract.mjs (unspecified operator)'),
    at: new Date().toISOString(),
  },
  supersededBy: flag('superseded-by'),
});

console.log(`[retract] target   ${targetId}`);
console.log(`           grammar  ${target.grammar}`);
console.log(`           text     ${JSON.stringify(target.text.slice(0, 60))}`);
console.log(`           source   ${target.source?.kind ?? 'authored'} (${provenanceClass(target)})`);
console.log(`           reason   ${reason}`);

const consequenceBefore = consequences(before.records);
const simulated = before.records.filter((r) => r.id !== targetId);
const consequenceAfter = consequences(simulated);

console.log('\n[consequence] grammar cores before -> after');
let downgrades = 0;
for (const b of consequenceBefore) {
  const a = consequenceAfter.find((x) => x.grammar === b.grammar);
  const changed = b.core !== a.core || b.complete !== a.complete;
  if (b.complete && !a.complete) downgrades++;
  console.log(`  ${b.short.padEnd(13)} core ${b.core} -> ${a.core}, complete ${b.complete} -> ${a.complete}` +
    (changed ? `   <-- CHANGED${a.insufficient.length ? ` (insufficient: ${a.insufficient.join(', ')})` : ''}` : ''));
}
console.log(`  active records ${before.records.length} -> ${simulated.length}`);

if (downgrades) {
  console.log(`\n[warning] this retraction DOWNGRADES ${downgrades} grammar(s) from complete to incomplete.`);
  console.log('          Readings for the affected constructions will become Unknown.');
}

if (dryRun) {
  console.log('\n[dry-run] nothing was written. Re-run without --dry-run to apply.');
  process.exit(0);
}

const res = appendRetraction(storePath, record);
const after = loadEvidence(storePath);
console.log(`\n[retract] ${res.appended ? 'appended' : 'skipped'} ${res.id}`);
console.log(`  active ${after.records.length}, retracted ${after.retractedIds.length}, issues ${after.issues.length}`);
if (after.issues.length) {
  console.log('  ISSUES:');
  for (const i of after.issues) console.log('   ', i);
  process.exit(1);
}
console.log('  the retracted record remains in the log and is no longer active.');
