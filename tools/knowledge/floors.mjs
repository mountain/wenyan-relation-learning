/**
 * Declared floors, with their history.
 *
 * readiness.mjs already said the right thing — "These are the thresholds; change them
 * deliberately" — but a bare constant carries no record of WHAT was changed, WHEN, or WHY.
 * A threshold silently edited to sit just under the measured value is indistinguishable, in
 * the file, from one that was always there. That is the failure mode this module removes.
 *
 * THE RULE
 *   Every floor's value lives here ONCE. Code calls `floorValue(id)`; nothing else declares
 *   a threshold. Adding or changing a floor requires an entry in `changes` with a basis, and
 *   `floorValue` throws if the code asks for an id that has no record — so a threshold can
 *   never be introduced quietly.
 *
 * WHAT A BASIS MAY NOT BE
 *   "it is just below the current value" is not a basis. A revision has to argue from
 *   something other than the number it is about to admit — the attainable range, a declared
 *   fraction of it, or a change in what is being measured. Otherwise the floor stops being a
 *   threshold and becomes a restatement of the result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

/** Where the measured ceiling for G8 is recorded, so the floor can be argued against it. */
const CEILING_NOTE = (() => {
  const f = path.join(ROOT, 'tools/knowledge/CAP-REVIEW.md');
  return fs.existsSync(f) ? 'tools/knowledge/CAP-REVIEW.md 补篇二/三' : 'unrecorded';
})();

export const FLOORS = {
  'labelled-per-construction-determination': {
    value: 2,
    since: '2026-09-22',
    basis: 'CAP-REVIEW.md §实测一: one label suffices to pin a mapping; the second is what makes a '
      + 'mislabelling detectable. Measured, so the floor is the minimal falsifiable set.',
    changes: [],
  },
  'labelled-per-construction-holdout': {
    value: 2,
    since: '2026-09-22',
    basis: 'leave-one-out needs at least one record left after the one held out.',
    changes: [],
  },
  'negative-cases': {
    value: 6,
    since: '2026-09-22',
    basis: 'the declared out-of-grammar negatives; the count is the declaration, not a measurement.',
    changes: [],
  },
  'corpus-coverage-rate': {
    value: 0.01,
    since: '2026-09-22',
    basis: 'a floor for "the grammar occurs in real text at all", deliberately far below the measured '
      + 'value so that it fails only if reach collapses. The substantive reading gate is G8.',
    changes: [],
  },
  'g8-corpus-answerability': {
    value: 0.5,
    since: '2026-09-22',
    basis: 'DECLARED BEFORE THE ATTAINABLE RANGE WAS KNOWN: the intention was "a declared question can be '
      + 'answered about half of real text".',
    status: 'UNREACHABLE as measured. The honest ceiling for a relation grammar with declared segmentation '
      + 'is about 0.244 of ALL passages (CAP-REVIEW.md 补篇二); the strict upper bound for "named subject + '
      + 'reporting verb" is 0.459, itself below this floor. The gate therefore fails, and it is left '
      + 'failing rather than lowered to the current value.',
    ceiling: { value: 0.2443, measuredBy: CEILING_NOTE, note: 'ceiling = the union of frames with a '
      + 'defensible segmentation rule; the unmarked ditransitive (0.238) is excluded because its theme '
      + 'span has no delimiter and could only be guessed' },
    changes: [],
  },
};

export function floorValue(id) {
  const f = FLOORS[id];
  if (!f) {
    throw new Error(`floor ${JSON.stringify(id)} is not declared — a threshold may not be introduced without ` +
      'a recorded basis, because a floor nobody can audit is indistinguishable from one that was moved');
  }
  return f.value;
}

export function floorRecord(id) {
  const f = FLOORS[id];
  if (!f) throw new Error(`floor ${JSON.stringify(id)} is not declared`);
  return f;
}

/** Lines for the readiness report: what each substantive floor is, and whether it has moved. */
export function floorLines() {
  return Object.entries(FLOORS)
    .filter(([, f]) => f.status || f.changes.length)
    .map(([id, f]) => {
      const moved = f.changes.length
        ? `revised ${f.changes.length} time(s): ` + f.changes.map((c) => `${c.from}→${c.to} on ${c.at}`).join(', ')
        : 'never revised';
      return `${id} = ${f.value} (since ${f.since}, ${moved})${f.status ? ` — ${f.status}` : ''}`;
    });
}
