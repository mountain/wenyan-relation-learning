// SPDX-License-Identifier: MIT
import { createContextLearner } from '../context-learning/engine.mjs';
import { contextFeatures } from './structure.mjs';
import { findZan } from './catalog.mjs';
export const learner = createContextLearner({
  schema: 'wenyan.taixuan.learning-event.v1',
  features: ['digits', 'zan', 'fang', 'zhou', 'bu', 'jia', 'phaseGroup', 'phaseWithin'],
  context: contextFeatures,
  key: c => { contextFeatures(c); return `taixuan:${c.digits}:${c.zan}`; },
  // A reading is bound to the full source passage, including commentary if present.
  // Labels/rationales remain separate from both historical text layers.
  record: (catalog, c) => findZan(catalog, c.digits, c.zan).record.passage
});
export const { replayLearning, makeLearningEvent, loadLearning, appendLearning, predictContext } = learner;
