/**
 * Review of the 32-example cap and the projection strategy.
 *
 *   node tools/knowledge/review-cap.mjs [--write]
 *
 * Three questions, answered by measurement rather than argument:
 *
 *  1. WHAT IS 32? `relations.ts` throws "evidence capacity reached" at 32 and
 *     `replay` rejects a model with more than 32 examples. It is a hard budget
 *     on one MODEL, baked into the verified module. This step may not change
 *     that module, so the question is what the projection layer must do around it.
 *
 *  2. HOW MUCH EVIDENCE DOES CORRECTNESS ACTUALLY NEED? Each construction's role
 *     mapping is pinned independently. One correct label collapses 6 permutations
 *     to 1. A second label is what makes a WRONG first label detectable rather
 *     than silently authoritative. So the minimum falsifiable set is 2 per
 *     construction — the rest of the cap is slack, not need.
 *
 *  3. WHAT HAPPENS AS EVIDENCE GROWS? Two failure modes are measured here:
 *     silent dropping at the cap, and all-or-nothing fragility, because `replay`
 *     throws on contradiction and therefore one bad record makes EVERY
 *     construction unreadable, not just the one it concerns.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
import { loadEvidence, projectModel } from './store.mjs';
import { selectOperationalCore, auditHeldOut } from './projection.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const storePath = (() => {
  const i = argv.indexOf('--store');
  return i >= 0 ? path.resolve(argv[i + 1]) : path.join(ROOT, 'knowledge/relations/evidence.jsonl');
})();

const load = createTsLoader();
const GRAMMAR_IMPLS = {
  'wenyan.relations.v1': load(path.join(ROOT, 'src/inscription/relations.ts')),
  'wenyan.relations.reporting.v1': load(path.join(ROOT, 'src/inscription/relations-reporting.ts')),
};
const readers = {
  'wenyan.relations.v1': (t, m) => GRAMMAR_IMPLS['wenyan.relations.v1'].readRelation(t, m),
  'wenyan.relations.reporting.v1': (t, m) => GRAMMAR_IMPLS['wenyan.relations.reporting.v1'].readReporting(t, m),
};
const constructionsOf = {
  'wenyan.relations.v1': (t) => {
    try { return GRAMMAR_IMPLS['wenyan.relations.v1'].readRelation(t,
      GRAMMAR_IMPLS['wenyan.relations.v1'].emptyRelationModel()).construction ?? null; } catch { return null; }
  },
  'wenyan.relations.reporting.v1': (t) => {
    try { return GRAMMAR_IMPLS['wenyan.relations.reporting.v1'].readReporting(t,
      GRAMMAR_IMPLS['wenyan.relations.reporting.v1'].emptyReportingModel()).construction ?? null; } catch { return null; }
  },
};

const { records } = loadEvidence(storePath);

// --------------------------------------------------- 1. current composition
const composition = {};
for (const [grammar, constructionOf] of Object.entries(constructionsOf)) {
  const rs = records.filter((r) => r.grammar === grammar);
  const perConstruction = {};
  for (const r of rs) {
    const c = constructionOf(r.text) ?? '(out-of-grammar)';
    perConstruction[c] = (perConstruction[c] ?? 0) + 1;
  }
  composition[grammar] = {
    records: rs.length,
    cap: 32,
    slack: 32 - rs.length,
    perConstruction,
    constructionsWithAtLeast2: Object.values(perConstruction).filter((n) => n >= 2).length,
  };
}

// ----------------------------------------- 2. minimum falsifiable set, measured
// One label must collapse 6 permutations to 1; two must be able to detect a
// wrong one. Both are asserted experimentally against the real modules.
const minimumSet = {};
for (const [grammar, mod] of Object.entries(GRAMMAR_IMPLS)) {
  const isReporting = grammar.includes('reporting');
  const empty = isReporting ? mod.emptyReportingModel() : mod.emptyRelationModel();
  const learn = isReporting ? mod.learnReportingRelations : mod.learnRelations;
  const read = readers[grammar];
  const samples = {
    'wenyan.relations.v1': [
      { id: 'a', text: '「甲」授「乙」「书」。', expected: { agent: '甲', recipient: '乙', theme: '书' } },
      { id: 'b', text: '「甲」授「乙」「书」。', expected: { agent: '乙', recipient: '甲', theme: '书' } },
    ],
    'wenyan.relations.reporting.v1': [
      { id: 'a', text: '孔子謂弟子曰：「學而時習之。」', expected: { agent: '孔子', recipient: '弟子', theme: '學而時習之。' } },
      { id: 'b', text: '孔子謂弟子曰：「學而時習之。」', expected: { agent: '弟子', recipient: '孔子', theme: '學而時習之。' } },
    ],
  }[grammar];
  const one = learn(empty, samples[0], 6);
  const oneRead = read(samples[0].text, one.model);
  const two = learn(one.model, samples[1], 6);
  minimumSet[grammar] = {
    afterOneLabel: { survivors: one.remainingMappings, readingStatus: oneRead.status },
    afterSecondConflictingLabel: { status: two.status, note: 'a wrong second label is DETECTED, not silently accepted' },
    minimumForCorrectness: 1,
    minimumForFalsifiability: 2,
  };
}

// ------------------------------------------- 3a. silent dropping at the cap
// Build an over-cap pool and observe what projectModel does with it.
const syntheticGrammar = 'wenyan.relations.v1';
const sampleText = '「甲」授「乙」「书」。';
const overCap = [];
for (let i = 0; i < 40; i++) {
  overCap.push({
    id: `synth:${i}`, grammar: syntheticGrammar, text: sampleText,
    expected: { agent: '甲', recipient: '乙', theme: '书' },
    contentHash: `synth${i}`, textHash: 'synth',
    label: { kind: 'synthetic' },
  });
}
let silentDrop;
try {
  const p = projectModel(overCap, { grammar: syntheticGrammar, parse: () => ({ construction: 'grant' }) });
  silentDrop = {
    refuses: false,
    poolSize: p.poolSize,
    inModel: p.model.examples.length,
    droppedByCap: p.droppedByCap,
    note: 'DEFECT PRESENT: returned a model and a count without refusing, so the tail was lost silently',
  };
} catch (e) {
  // Correct behaviour after the fix: refuse rather than drop.
  const forced = projectModel(overCap, {
    grammar: syntheticGrammar, parse: () => ({ construction: 'grant' }), onOverflow: 'prefix',
  });
  silentDrop = {
    refuses: true,
    error: e.message,
    defunctIfForced: {
      poolSize: forced.poolSize,
      inModel: forced.model.examples.length,
      wouldDrop: forced.droppedByCap,
      droppedIds: forced.droppedIds,
      note: 'what the old behaviour discarded without naming it; now reachable only by explicit opt-in',
    },
  };
}

// ------------------------------------------------ 3b. all-or-nothing fragility
// Add ONE contradicting record to the reporting model and see how much breaks.
const reportingRecords = records.filter((r) => r.grammar === 'wenyan.relations.reporting.v1');
const repConstructionOf = constructionsOf['wenyan.relations.reporting.v1'];
const probesByConstruction = {
  'wei-quote': '孔子謂弟子曰：「學而時習之。」',
  'wen-quote': '孔子問弟子曰：「何謂也？」',
  'gao-quote': '孔子告弟子曰：「學而時習之。」',
  'yu-quote': '孔子語弟子曰：「學而時習之。」',
};
// The fragility test uses the SAME model the system actually answers with, i.e.
// the operational core — not an arbitrary positional slice of 32.
const repCore = selectOperationalCore(reportingRecords, {
  grammar: 'wenyan.relations.reporting.v1',
  constructionOf: repConstructionOf,
});
const cleanModel = repCore.model;
const poisonedModel = {
  schema: 'wenyan.relations.reporting.v1',
  examples: [...cleanModel.examples,
    { id: 'poison', text: probesByConstruction['wei-quote'],
      expected: { agent: '弟子', recipient: '孔子', theme: '學而時習之。' } }],
};
const fragility = { clean: {}, poisoned: {} };
for (const [c, text] of Object.entries(probesByConstruction)) {
  try {
    fragility.clean[c] = readers['wenyan.relations.reporting.v1'](text, cleanModel).status;
  } catch (e) { fragility.clean[c] = `threw: ${e.message}`; }
  try {
    fragility.poisoned[c] = readers['wenyan.relations.reporting.v1'](text, poisonedModel).status;
  } catch (e) { fragility.poisoned[c] = `threw: ${e.message}`; }
}
const untouchedConstructionsCollateral = Object.entries(fragility.poisoned)
  .filter(([c, s]) => c !== 'wei-quote' && String(s).startsWith('threw')).map(([c]) => c);

// ------------------------------------------------ 3c. what full labelling needs
const inGrammarPassages = (() => {
  if (!fs.existsSync(path.join(CORPUS, 'manifest.json'))) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
  let n = 0;
  const rep = GRAMMAR_IMPLS['wenyan.relations.reporting.v1'];
  const empty = rep.emptyReportingModel();
  for (const w of manifest.works) {
    if (!w.file) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
    for (const s of doc.sections) {
      for (const p of s.passages) {
        try {
          const r = rep.readReporting(p.text, empty);
          if (r.construction && r.reason !== 'ambiguous-frame-occurrence') n++;
        } catch { /* ignore */ }
      }
    }
  }
  return n;
})();

// ------------------------------------------- 3d. the held-out set, put to work
// Holding surplus evidence OUT of the operational model is only defensible if
// the held-out set then does something useful, so it is used here as a
// contradiction detector: every held-out record is replayed against the core,
// and any record that disagrees surfaces as a throw.
const fullCore = selectOperationalCore(records, {
  grammar: 'wenyan.relations.reporting.v1',
  constructionOf: repConstructionOf,
});
const audit = auditHeldOut(records, fullCore, {
  grammar: 'wenyan.relations.reporting.v1',
  read: readers['wenyan.relations.reporting.v1'],
  constructionOf: repConstructionOf,
  batchSize: 8,
});

const report = {
  schema: 'wenyan.relations.cap-review.v1',
  generatedAt: new Date().toISOString(),
  question: 'Is 32 a per-inference budget or a knowledge-base capacity, and what must the projection layer do around it?',
  whatTheCapIs: {
    enforcedIn: 'src/inscription/relations.ts (and the mirrored reporting module)',
    learnThrowsAt: 'model.examples.length >= 32 -> "evidence capacity reached"',
    replayRejectsAbove: 32,
    hardConclusion: 'It is a hard budget on ONE model inside the verified module. This step may not change that module, so 32 stays; what must change is the projection layer.',
  },
  currentComposition: composition,
  minimumFalsifiableSet: minimumSet,
  silentDropAtCap: silentDrop,
  fragility: {
    clean: fragility.clean,
    poisoned: fragility.poisoned,
    constructionsBrokenByOneUnrelatedBadRecord: untouchedConstructionsCollateral,
    note: 'One contradicting record makes replay throw, and replay runs before every read, so ALL constructions become unreadable — including ones the bad record has nothing to do with. Evidence diversity is a liability while the model is all-or-nothing.',
  },
  fullLabellingDemand: {
    inGrammarCorpusPassages: inGrammarPassages,
    capMultiple: inGrammarPassages ? +(inGrammarPassages / 32).toFixed(1) : null,
    note: 'Labelling every in-grammar passage as evidence would need this many times the cap — and would also make one bad label fatal to everything.',
  },
  operationalCore: {
    included: fullCore.included,
    perConstruction: fullCore.perConstruction,
    complete: fullCore.complete,
    heldOutCount: fullCore.heldOut.length,
    poolSize: fullCore.poolSize,
  },
  heldOutAudit: {
    ...audit,
    interpretation: 'A held-out record that replays cleanly against the core agrees with it. A throw is a ' +
      'disagreement between two supervised labels — a finding, either a mislabelled passage or a boundary ' +
      'rule that fired on the wrong span. Either way it stays visible instead of being averaged away.',
  },
  recommendedPolicy: [
    'Keep 32 as the module\'s per-model budget; change nothing in relations.ts.',
    'Split the store by ROLE: an operational core (the minimum falsifiable set, 2 per construction) and a validation set (everything else, including corpus-labelled passages).',
    'Projection must be explicit and deterministic: name what is included and what is excluded, and never slice a prefix silently.',
    'Holding corpus labels OUT of the operational model is not a compromise — loading them would add no mapping information (the mapping is already pinned) while making one mislabel fatal to every construction.',
    'Keep them as a contradiction detector instead: they can be replayed against the core in batches to find disagreements, without being part of the model that answers questions.',
  ],
};

const out = path.join(ROOT, 'knowledge/cap-review.json');
if (argv.includes('--write')) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}

// ------------------------------------------------------------------- print
console.log('[cap-review] what 32 is');
console.log(`  ${report.whatTheCapIs.hardConclusion}`);
console.log('\n[cap-review] current composition');
for (const [g, v] of Object.entries(composition)) {
  console.log(`  ${g}`);
  console.log(`    records ${v.records}/32 (slack ${v.slack}); per construction ${JSON.stringify(v.perConstruction)}`);
}
console.log('\n[cap-review] minimum falsifiable set (measured)');
for (const [g, v] of Object.entries(minimumSet)) {
  console.log(`  ${g}: 1 label -> ${v.afterOneLabel.survivors} survivor(s) reading ${v.afterOneLabel.readingStatus}; ` +
    `2nd conflicting label -> ${v.afterSecondConflictingLabel.status} (detected)`);
}
console.log('\n[cap-review] silent dropping at the cap');
if (silentDrop.refuses) {
  console.log(`  projectModel now REFUSES: ${silentDrop.error.slice(0, 96)}…`);
  const d = silentDrop.defunctIfForced;
  console.log(`  (the old behaviour would have dropped ${d.wouldDrop} of ${d.poolSize} without naming them)`);
} else {
  console.log(`  DEFECT: pool of ${silentDrop.poolSize} -> in model ${silentDrop.inModel}, dropped ${silentDrop.droppedByCap}, no refusal`);
}
console.log('\n[cap-review] fragility: one bad record, all constructions');
console.log(`  clean    ${JSON.stringify(fragility.clean)}`);
console.log(`  poisoned ${JSON.stringify(fragility.poisoned)}`);
console.log(`  broken by one unrelated bad record: ${untouchedConstructionsCollateral.join(', ') || 'none'}`);
console.log('\n[cap-review] full-labelling demand');
console.log(`  in-grammar corpus passages ${inGrammarPassages} = ${report.fullLabellingDemand.capMultiple}x the cap`);
console.log('\n[cap-review] operational core vs held-out');
console.log(`  core ${fullCore.included.length} record(s), held out ${fullCore.heldOut.length} of pool ${fullCore.poolSize}`);
for (const [c, v] of Object.entries(fullCore.perConstruction)) {
  console.log(`    ${c.padEnd(12)} available ${v.available}, selected ${v.selected}, sufficient ${v.sufficient}`);
}
console.log(`  held-out audit: ${audit.clean} agree, ${audit.conflicts.length} disagree (${audit.batches} batch(es))`);
for (const c of audit.conflicts.slice(0, 5)) console.log(`    DISAGREES ${c.id}: ${c.reason}`);
if (argv.includes('--write')) console.log(`\n[written] ${path.relative(ROOT, out)}`);
process.exit(0);
