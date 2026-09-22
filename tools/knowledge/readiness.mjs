/**
 * Readiness gates for the relation layer.
 *
 *   node tools/knowledge/readiness.mjs [--store path] [--write]
 *
 * WHY GATES AND NOT A "RICHNESS" SCORE
 * A scalar richness number cannot tell you what the store is ready FOR, and it
 * tends to only ever grow. These gates are instead:
 *   - task-specific: "ready for computation" and "ready for conversation" are
 *     different bars, and the second one has a prerequisite this repo does not
 *     have at all (a dialogue contract), which is reported as MISSING rather
 *     than quietly scored as zero;
 *   - falsifiable: each gate names the measurement that would close it;
 *   - REVERSIBLE: because the network is `replay(evidence)`, contradicting
 *     evidence can put survivors back above 1 and re-open a gate that was
 *     passed. Maturity here is not monotone, by construction.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
import { loadEvidence, integrityReport, projectModel, verifySources } from './store.mjs';
import { selectOperationalCore } from './projection.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');
const GRAMMAR = 'wenyan.relations.v1';
const REPORTING_GRAMMAR = 'wenyan.relations.reporting.v1';

const argv = process.argv.slice(2);
const storePath = (() => {
  const i = argv.indexOf('--store');
  return i >= 0 ? path.resolve(argv[i + 1]) : path.join(ROOT, 'knowledge/relations/evidence.jsonl');
})();

const load = createTsLoader();
const relations = load(path.join(ROOT, 'src/inscription/relations.ts'));
const { readRelation, compareRelations, emptyRelationModel } = relations;
const reporting = load(path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const reportingConstructionOf = (text) => {
  try {
    return reporting.readReporting(text, reporting.emptyReportingModel()).construction ?? null;
  } catch { return null; }
};

/** A fresh in-grammar probe per construction, used only to count survivors. */
const PROBES = {
  grant: '「丙」授「丁」「帛」。',
  'hand-over': '「丙」把「帛」交给「丁」。',
  receive: '「丁」获「丙」所授「帛」。',
};
const CONSTRUCTIONS = Object.keys(PROBES);

/** Declared floors. These are the thresholds; change them deliberately. */
const FLOORS = {
  labelledPerConstructionForDetermination: 2,
  labelledPerConstructionForHoldout: 2,
  negativeCases: 6,
  corpusCoverageRate: 0.01,
};

const NEGATIVES = [
  '「甲」未授「乙」「书」。',
  '甲给乙一本书。',
  '「甲」把「书」交给「乙」，然后离开。',
  '',
  '「甲」授「乙」。',
  '子曰：「學而時習之。」',
];

const constructionOf = (text) => readRelation(text, emptyRelationModel()).construction ?? null;

/**
 * Every read goes through this. `replay()` deliberately THROWS on a
 * contradictory evidence set, and a contradictory store is exactly the finding
 * this tool exists to report — so it must never crash the run. An earlier
 * version called readRelation unguarded inside perConstruction and died with
 * "contradictory evidence" instead of reporting it.
 */
function safeRead(text, model) {
  try {
    return { ok: true, reading: readRelation(text, model) };
  } catch (e) {
    return { ok: false, error: e.message, reading: null };
  }
}

// --------------------------------------------------------------------- store
const { records, issues: parseIssues } = loadEvidence(storePath);
const integrity = integrityReport(records);
const sourceChecks = verifySources(records, CORPUS);
const projection = projectModel(records, {
  grammar: GRAMMAR,
  parse: (t) => (constructionOf(t) ? { construction: constructionOf(t) } : null),
});
// Selected by role, not truncated by position; hoisted so every gate can use it.
const reportingProjection = selectOperationalCore(records, {
  grammar: REPORTING_GRAMMAR,
  constructionOf: reportingConstructionOf,
});

// replay() is private; reading an in-grammar probe exercises it. A throw here
// means the projected evidence set is contradictory — a reportable finding.
const probeRead = safeRead(PROBES.grant, projection.model);
const replayError = probeRead.ok ? null : probeRead.error;

// Every gate below is evaluated PER DECLARED GRAMMAR. An earlier version checked
// only the experimental grammar's three constructions, which meant the reporting
// grammar's four constructions — each with 2 labels and a single surviving role
// mapping — were never examined at all. A gate suite that inspects one half of
// the system under-reports it, which is a worse failure than reporting nothing.
const REPORTING_PROBES = {
  'wei-quote': '孔子謂弟子曰：「學而時習之。」',
  'wen-quote': '孔子問弟子曰：「何謂也？」',
  'gao-quote': '孔子告弟子曰：「學而時習之。」',
  'yu-quote': '孔子語弟子曰：「學而時習之。」',
};
const GRAMMAR_SETS = {
  [GRAMMAR]: {
    id: GRAMMAR, short: 'experimental', probes: PROBES, model: projection.model,
    constructionOf, read: (t, m) => readRelation(t, m),
  },
  [REPORTING_GRAMMAR]: {
    id: REPORTING_GRAMMAR, short: 'reporting', probes: REPORTING_PROBES, model: reportingProjection.model,
    constructionOf: reportingConstructionOf, read: (t, m) => reporting.readReporting(t, m),
  },
};
// Both grammar ids end in '.v1', so split('.').pop() rendered them identically
// and the per-grammar lines were unreadable. Use an explicit short name.
const shortOf = (id) => GRAMMAR_SETS[id]?.short ?? id;

// ------------------------------------------------------- per-construction
const perConstruction = [];
for (const set of Object.values(GRAMMAR_SETS)) {
  for (const [c, probe] of Object.entries(set.probes)) {
    const labelled = records.filter((r) => r.grammar === set.id && set.constructionOf(r.text) === c);
    let read;
    try {
      read = { ok: true, reading: set.read(probe, set.model) };
    } catch (e) {
      read = { ok: false, error: e.message };
    }
    perConstruction.push({
      grammar: set.id,
      construction: c,
      labelledExamples: labelled.length,
      survivingRoleMappings: read.ok ? read.reading.candidates.length : null,
      statusOnProbe: read.ok ? read.reading.status : 'replay-error',
      ...(read.ok ? {} : { error: read.error }),
      distinctEntities: new Set(
        labelled.flatMap((r) => [r.expected.agent, r.expected.recipient, r.expected.theme]),
      ).size,
    });
  }
}

// --------------------------------------------------- leave-one-out holdout
// Each core record is re-read from the operational core built WITHOUT it. The
// core is the model that actually answers, so this is the meaningful holdout —
// running it over the whole store would let surplus records mask a construction
// that only its own single label determines.
//
// NOTE: an earlier version wrote the exclusion as
//   records.filter(x => x.id !== r.id || x.contentHash !== r.contentHash)
// which removed nothing — the projected examples carry no contentHash, so the
// second disjunct was always true and the "held-out" reading was really taken
// from the full training set. It reported a perfect accuracy of 1 that meant
// nothing. Kept here as a reminder that a gate is only as good as its measurement.
const looByGrammar = {};
for (const set of Object.values(GRAMMAR_SETS)) {
  const coreExamples = set.model.examples;
  const looFailures = [];
  let looTotal = 0;
  for (const ex of coreExamples) {
    const others = coreExamples.filter((e) => e.id !== ex.id);
    const reduced = { schema: set.id, examples: others };
    looTotal++;
    let got;
    try {
      got = set.read(ex.text, reduced);
    } catch (e) {
      looFailures.push({ id: ex.id, reason: `replay threw: ${e.message}` });
      continue;
    }
    if (got.status !== 'KnownFiniteGrammar') {
      looFailures.push({
        id: ex.id,
        reason: `held out, the reading became ${got.status} (${got.reason ?? 'no reason'}); ` +
          `the remaining ${others.length} core record(s) do not determine this construction`,
      });
      continue;
    }
    const c = got.candidates[0];
    if (c.agent !== ex.expected.agent || c.recipient !== ex.expected.recipient || c.theme !== ex.expected.theme) {
      looFailures.push({ id: ex.id, reason: `expected ${JSON.stringify(ex.expected)} got ${JSON.stringify(c)}` });
    }
  }
  looByGrammar[set.id] = {
    coreSize: coreExamples.length,
    total: looTotal,
    failures: looFailures,
    accuracy: looTotal ? +(1 - looFailures.length / looTotal).toFixed(4) : null,
  };
}
// Kept for the report's top level: the accuracy of the grammar that answers by default.
const looFailures = looByGrammar[GRAMMAR]?.failures ?? [];
const looTotal = looByGrammar[GRAMMAR]?.total ?? 0;
const looAccuracy = looByGrammar[GRAMMAR]?.accuracy ?? null;

// ------------------------------------------------------------ fail-closed
const negativeResults = NEGATIVES.map((t) => {
  const read = safeRead(t, projection.model);
  return { text: t, status: read.ok ? read.reading.status : 'replay-error' };
});
const negativesClosed = negativeResults.every((r) => r.status === 'Unknown');

// ------------------------------------------------ corpus coverage, per grammar
// G5 asks whether the network can be fed from real text. That answer is
// grammar-specific, so it is measured per declared grammar rather than once:
// the experimental grammar occurs nowhere in the corpus, the reporting-frame
// grammar occurs in ~4.5% of passages. Reporting a single number would hide
// exactly the fact that matters.
let coverage = { passages: 0, known: 0, rate: 0, readErrors: 0, firstReadError: null, perGrammar: {} };
if (fs.existsSync(path.join(CORPUS, 'manifest.json'))) {
  const grammarReaders = [
    { id: GRAMMAR, model: projection.model, read: readRelation,
      evidence: projection.model.examples.length },
    { id: reporting.REPORTING_GRAMMAR_ID, model: reportingProjection.model, read: reporting.readReporting,
      evidence: reportingProjection.model.examples.length },
  ];
  for (const g of grammarReaders) {
    g.known = 0;
    g.errors = 0;
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
  for (const w of manifest.works) {
    if (!w.file) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
    for (const s of doc.sections) {
      for (const p of s.passages) {
        coverage.passages++;
        for (const g of grammarReaders) {
          try {
            if (g.read(p.text, g.model).status === 'KnownFiniteGrammar') g.known++;
          } catch (e) {
            g.errors++;
            coverage.readErrors++;
            coverage.firstReadError ??= e.message;
          }
        }
      }
    }
  }
  for (const g of grammarReaders) {
    coverage.perGrammar[g.id] = {
      known: g.known,
      rate: coverage.passages ? +(g.known / coverage.passages).toFixed(6) : 0,
      evidenceRecords: g.evidence,
      readErrors: g.errors,
    };
  }
  const best = Object.entries(coverage.perGrammar).sort((a, b) => b[1].rate - a[1].rate)[0];
  coverage.known = best ? best[1].known : 0;
  coverage.rate = best ? best[1].rate : 0;
  coverage.bestGrammar = best ? best[0] : null;
}

// ------------------------------------------------------------------ gates
const gates = [];
const gate = (id, name, required, pass, evidence, missing = null) =>
  gates.push({ id, name, required, pass, evidence, ...(missing ? { missing } : {}) });

const unverifiedSources = sourceChecks.filter((s) => !s.ok);
gate('G1', 'well-formed store', true,
  parseIssues.length === 0 && integrity.issues.length === 0 && !replayError,
  `parse issues=${parseIssues.length}, integrity issues=${integrity.issues.length}, replay=${replayError ? `threw: ${replayError}` : 'ok'}`);

// Both gates are evaluated per grammar: a grammar is not excused by another
// grammar's health, and is not condemned by another's weakness.
const determined = perConstruction.filter(
  (c) => c.survivingRoleMappings === 1 && c.labelledExamples >= FLOORS.labelledPerConstructionForDetermination);
const g2Detail = perConstruction.map((c) =>
  `${shortOf(c.grammar)}/${c.construction}: survivors=${c.survivingRoleMappings ?? 'n/a'}/6, labels=${c.labelledExamples} (floor ${FLOORS.labelledPerConstructionForDetermination})${c.error ? `, ERROR: ${c.error}` : ''}`).join('; ');
gate('G2', 'role mapping determined per construction, per grammar', true,
  determined.length === perConstruction.length, g2Detail,
  determined.length === perConstruction.length ? null
    : `${perConstruction.length - determined.length} construction(s) need >= ${FLOORS.labelledPerConstructionForDetermination} labels and exactly 1 surviving mapping`);

const holdoutReady = perConstruction.every((c) => c.labelledExamples >= FLOORS.labelledPerConstructionForHoldout);
const g3Detail = Object.entries(looByGrammar).map(([g, v]) =>
  `${shortOf(g)}: core ${v.coreSize}, accuracy=${v.accuracy}, failures=${v.failures.length}` +
  (v.failures.length ? ` (first ${v.failures[0].id}: ${v.failures[0].reason})` : '')).join('; ');
gate('G3', 'generalises when its own evidence is held out, per grammar', true,
  holdoutReady && Object.values(looByGrammar).every((v) => v.accuracy === 1), g3Detail,
  holdoutReady ? null : `each construction needs >= ${FLOORS.labelledPerConstructionForHoldout} independent labels before this can be measured at all`);

gate('G4', 'fails closed outside the grammar', true, negativesClosed,
  `${negativeResults.filter((r) => r.status === 'Unknown').length}/${NEGATIVES.length} declared negatives returned Unknown`,
  negativesClosed ? null : 'a non-grammatical input was read as if it were in-grammar');

const coverageDetail = Object.entries(coverage.perGrammar ?? {})
  .map(([id, v]) => `${id}: ${v.known}/${coverage.passages} (${v.rate}, evidence ${v.evidenceRecords})`)
  .join('; ') || `0/${coverage.passages}`;
gate('G5', 'grounded in the target corpus', false, coverage.rate >= FLOORS.corpusCoverageRate,
  `${coverageDetail} — floor ${FLOORS.corpusCoverageRate}, best grammar ${coverage.bestGrammar ?? 'n/a'}`,
  coverage.rate >= FLOORS.corpusCoverageRate ? null
    : 'no declared grammar occurs in the corpus, so the network cannot be fed from it by reading');

const storeLoad = loadEvidence(storePath);
gate('G6', 'durable and re-derivable', true,
  parseIssues.length === 0 && integrity.issues.length === 0 && unverifiedSources.length === 0 && !replayError,
  `${storeLoad.allRecords.length} record(s), ${storeLoad.retractedIds.length} retracted (${storeLoad.retractions.length} retraction record(s)); ` +
  `content hashes verified; corpus-derived sources verified=${sourceChecks.length - unverifiedSources.length}/${sourceChecks.length}`,
  unverifiedSources.length ? `${unverifiedSources.length} source(s) no longer match the corpus` : null);

// G7/G8 replace an earlier single gate that read "no dialogue contract exists in
// this repository". That statement was true when written and false afterwards —
// the contract was built in step 1 of the agreed plan. A gate must be re-derived
// from the workspace, not remembered from the day it was written.
//
// G7 is structural: does a declared, enforced contract exist?
// G8 is the richness question: can the declared questions be answered about the
//    target corpus? Its floor is a DECLARED parameter, and it is deliberately
//    not lowered to match the current value.
const dialogueDir = path.join(ROOT, 'tools/dialogue');
const dialogueReadinessFile = path.join(ROOT, 'knowledge/dialogue/readiness.json');
let dialogue = { contractExists: false, schema: null, types: 0, invariants: 0, outOfScope: [], violations: null, bestCorpusRate: null, bestGrammar: null };
try {
  const c = JSON.parse(fs.readFileSync(path.join(dialogueDir, 'contract.json'), 'utf8'));
  dialogue.contractExists = c.schema === 'wenyan.dialogue.contract.v1';
  dialogue.schema = c.schema;
  dialogue.types = (c.questionTypes ?? []).length;
  dialogue.invariants = (c.invariants ?? []).length;
  dialogue.outOfScope = (c.questionTypes ?? []).filter((q) => q.status === 'declared-out-of-scope').map((q) => q.id);
  dialogue.everyInvariantEnforced = (c.invariants ?? []).every((i) => i.enforcedBy);
  if (fs.existsSync(dialogueReadinessFile)) {
    const dr = JSON.parse(fs.readFileSync(dialogueReadinessFile, 'utf8'));
    dialogue.violations = (dr.contractViolations ?? []).length;
    dialogue.bestCorpusRate = dr.verdict?.bestCorpusAnswerRate ?? null;
    dialogue.bestGrammar = dr.verdict?.bestGrammarOnCorpus ?? null;
  }
} catch { /* reported through the gate below */ }

gate('G7', 'dialogue contract exists and is enforced', true,
  dialogue.contractExists && dialogue.everyInvariantEnforced && dialogue.violations === 0,
  `contract=${dialogue.schema ?? 'missing'}, ${dialogue.types} question type(s), ${dialogue.invariants} invariant(s) each naming its enforcement, ` +
  `out-of-scope declared: ${dialogue.outOfScope.join(',') || 'none'}, recorded contract violations=${dialogue.violations ?? 'no measurement'}`,
  dialogue.contractExists ? null : 'no declared dialogue contract');

const G8_FLOOR = 0.5;
gate('G8', 'declared questions answer the target corpus', true,
  dialogue.bestCorpusRate !== null && dialogue.bestCorpusRate >= G8_FLOOR,
  `best corpus answer rate ${dialogue.bestCorpusRate ?? 'unmeasured'} under ${dialogue.bestGrammar ?? 'n/a'}; floor ${G8_FLOOR}`,
  `the floor is a declared parameter and is not lowered to match the current value: answering a question ` +
  `about real text still fails for the large majority of passages`);

// G9 enforces the projection policy rather than only documenting it. The cap is a
// per-model budget inside the verified module; the projection layer must never
// satisfy it by discarding evidence silently. The falsifiable invariant here is
// ACCOUNTING: every record in a grammar's pool is either in the operational core,
// or named as held out, or declared out of grammar. Nothing may vanish.
// (Whether the core is big enough is G2's check, not this one.)
const coreProjections = {
  [GRAMMAR]: selectOperationalCore(records, {
    grammar: GRAMMAR, constructionOf, provenance: 'authored',
    expectedConstructions: ['grant', 'hand-over', 'receive'],
  }),
  [REPORTING_GRAMMAR]: selectOperationalCore(records, {
    grammar: REPORTING_GRAMMAR, constructionOf: reportingConstructionOf, provenance: 'corpus',
    expectedConstructions: ['gao-quote', 'wei-quote', 'wen-quote', 'yu-quote'],
  }),
};
const accounting = Object.entries(coreProjections).map(([g, p]) => ({
  g,
  pool: p.poolSize,
  accounted: p.included.length + p.heldOut.length + p.outOfGrammar.length + p.excludedByProvenance.length,
  core: p.included.length,
  cap: p.cap,
  heldOut: p.heldOut.length,
  outOfGrammar: p.outOfGrammar.length,
  excludedByProvenance: p.excludedByProvenance.length,
  provenance: p.provenance,
}));
const unaccounted = accounting.filter((a) => a.accounted !== a.pool);
const overCap = accounting.filter((a) => a.core > a.cap);
gate('G9', 'every record accounted for: modelled, held out, out of grammar, or excluded by provenance', true,
  unaccounted.length === 0 && overCap.length === 0,
  accounting.map((a) => `${a.g}: core ${a.core}/${a.cap} + held out ${a.heldOut} + out-of-grammar ${a.outOfGrammar} ` +
    `+ provenance-excluded ${a.excludedByProvenance} = ${a.accounted}/${a.pool} (provenance ${a.provenance})`).join('; '),
  unaccounted.length ? `${unaccounted.length} grammar(s) have records that are neither modelled nor named`
    : overCap.length ? 'an operational core exceeds the model cap; the projection must be split, not truncated' : null);

// Gates are grouped by WHAT THEY ARE ABOUT, so one verdict cannot be dragged down
// by an unrelated one. An earlier version required every gate for
// readyForComputation, which made the reading machinery's readiness depend on the
// dialogue layer's — conceptually wrong, and it hid the fact that the reading
// gates had started passing.
const READING_GATES = ['G1', 'G2', 'G3', 'G4', 'G6', 'G9'];
const DIALOGUE_GATES = ['G7', 'G8'];
const gatePass = (id) => gates.find((g) => g.id === id)?.pass === true;
const systemGatesPass = ['G1', 'G4', 'G6', 'G9'].every(gatePass);

// Reading readiness is attributed PER GRAMMAR, because "the system can read" is
// only meaningful together with "under which grammar". A grammar that is
// determined and generalises on its own evidence counts; one that is not does
// not become ready by borrowing another's health. This mirrors how G5 treats
// coverage ("best grammar") and keeps the detail visible either way.
const perGrammarReading = {};
for (const [id, set] of Object.entries(GRAMMAR_SETS)) {
  const cons = perConstruction.filter((c) => c.grammar === id);
  const determined = cons.length > 0 && cons.every(
    (c) => c.survivingRoleMappings === 1 && c.labelledExamples >= FLOORS.labelledPerConstructionForDetermination);
  const generalises = looByGrammar[id]?.accuracy === 1;
  perGrammarReading[id] = {
    short: set.short,
    constructions: cons.length,
    determined,
    generalises,
    readingReady: determined && generalises,
  };
}
const readingReadyGrammars = Object.entries(perGrammarReading)
  .filter(([, v]) => v.readingReady).map(([id]) => id);
const readingReady = systemGatesPass && readingReadyGrammars.length > 0;
const dialogueReady = DIALOGUE_GATES.every(gatePass);
const readyForComputation = readingReady;
const deficits = gates.filter((g) => !g.pass && g.missing).map((g) => `${g.id} ${g.name}: ${g.missing}`);

const report = {
  schema: 'wenyan.relations.readiness.v1',
  generatedAt: new Date().toISOString(),
  grammar: GRAMMAR,
  store: {
    path: path.relative(ROOT, storePath),
    records: records.length,
    grammarVersions: integrity.grammars,
    sha256: fs.existsSync(storePath)
      ? crypto.createHash('sha256').update(fs.readFileSync(storePath)).digest('hex') : null,
  },
  floors: FLOORS,
  perConstruction,
  leaveOneOut: { total: looTotal, failures: looFailures, accuracy: looAccuracy },
  negatives: negativeResults,
  corpusCoverage: coverage,
  sourceVerification: { checked: sourceChecks.length, failed: unverifiedSources },
  integrity: { parseIssues, issues: integrity.issues, notes: integrity.notes, replayError },
  projection: { poolSize: projection.poolSize, inModel: projection.model.examples.length, droppedByCap: projection.droppedByCap },
  gates,
  verdict: {
    readyForComputation,
    readingReady,
    dialogueReady,
    readyForConversationalReasoning: readingReady && dialogueReady,
    readingReadyGrammars,
    perGrammarReading,
    gateGroups: { reading: READING_GATES, dialogue: DIALOGUE_GATES },
    reversible: 'Because the network is replay(evidence), adding contradicting evidence can raise survivors above 1 and re-open G2. Maturity is not monotone.',
    deficits,
  },
};

const out = path.join(ROOT, 'knowledge/relations/readiness.json');
if (argv.includes('--write')) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}

// ------------------------------------------------------------------ print
const mark = (p) => (p ? 'PASS' : 'FAIL');
console.log(`[readiness] store=${report.store.path} records=${records.length} projection=${projection.model.examples.length}`);
for (const g of gates) {
  console.log(`  ${mark(g.pass)} ${g.id} ${g.name}${g.required ? '' : ' (optional)'}`);
  console.log(`       ${g.evidence}`);
  if (g.missing) console.log(`       missing: ${g.missing}`);
}
console.log(`\n[verdict] ready for computation: ${readyForComputation}` +
  (readingReadyGrammars.length
    ? ` (via ${readingReadyGrammars.map(shortOf).join(', ')} — the verdict is per grammar, not global)`
    : ' (no grammar passes both determination and generalisation)'));
console.log(`[verdict] ready for conversational reasoning: ${report.verdict.readyForConversationalReasoning}` +
  ` (G7 contract/enforcement, G8 corpus answerability)`);
console.log(`[verdict] corpus coverage: ${coverage.known}/${coverage.passages} (best grammar ${coverage.bestGrammar ?? 'n/a'})`);
if (argv.includes('--write')) console.log(`[written] ${path.relative(ROOT, out)}`);
process.exit(readyForComputation ? 0 : 1);
