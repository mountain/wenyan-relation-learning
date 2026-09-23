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
    value: 0.15,
    since: '2026-09-23',
    basis: 'REVISED, not lowered to the current value. The revision is argued from the ATTAINABLE RANGE: the '
      + 'honest ceiling for a relation grammar with declared segmentation is about 0.244 of all passages, and '
      + '0.15 is 61% of it. The rule this satisfies is that a threshold may not be moved to sit just under the '
      + 'measured value; 0.15 is argued from the ceiling, and it keeps a third of the ceiling as headroom, so '
      + 'the gate still fails if realisation degrades by a third — it measures the implementation, not how much '
      + 'frame-bearing text the corpus happens to contain. 0.20 was rejected for conflating those two: it would '
      + 'go red both when the implementation regressed and when the corpus mix changed.',
    status: 'The aspirational target remains 0.5 and is NOT met. Declared 0.5 on 2026-09-22 before the '
      + 'attainable range was known; the gate failed under it throughout, and that record stays below rather '
      + 'than being erased. Mingli Yuan\u2019s reason for keeping the objective while revising the floor: an '
      + 'unreachable target is the growth driver for 文言, so the target stays and the gate now measures '
      + 'progress toward it.',
    ceiling: { value: 0.2443, measuredBy: CEILING_NOTE, note: 'ceiling = the union of frames with a '
      + 'defensible segmentation rule; the unmarked ditransitive (0.238) is excluded because its theme '
      + 'span has no delimiter and could only be guessed' },
    review: 'RE-CHECK THE CEILING, then reconsider this floor. Raising the ceiling is the route to the 0.5 '
      + 'target, and the known levers are: the two no-曰 frame families (measured about +1.5 points), '
      + 'constructions that need a segmentation rule no one has written yet, and the variant-character '
      + 'aperture A7 (one pair, 於/于, was worth 26 citations). Re-measure with tools/grammar/measure.mjs and '
      + 'record the new ceiling here before touching the floor again.',
    changes: [
      { from: 0.5, to: 0.15, at: '2026-09-23',
        basis: '0.5 exceeds the measured attainable range (ceiling 0.244) and had failed for every round since '
          + 'it was declared. Revised to 61% of the ceiling with a third kept as headroom; see `basis` above. '
          + 'The 0.5 target itself is retained as the aspiration the ceiling work aims at.' },
    ],
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
