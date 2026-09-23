/**
 * Measure how far the reporting-frame grammar reaches into the real corpus.
 *
 *   node tools/grammar/measure.mjs [--write]
 *
 * Two distinct numbers matter and must not be confused:
 *
 *   REACH  — passages the grammar can parse unambiguously. This is an upper
 *            bound: it holds with or without evidence, because it depends only
 *            on segmentation, not on role mapping.
 *   ANSWERABLE — passages the layer can actually read, which additionally needs
 *            every construction's role mapping pinned by supervised evidence.
 *
 * Reach with no evidence is the honest feasibility number for this grammar;
 * answerable is what the coverage gate (G5) will eventually see.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
import { selectOperationalCore } from '../knowledge/projection.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const storePath = (() => {
  const i = argv.indexOf('--store');
  return i >= 0 ? path.resolve(argv[i + 1]) : path.join(ROOT, 'knowledge/relations/evidence.jsonl');
})();

const load = createTsLoader();
const mod = load(path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const { readReporting, emptyReportingModel, CONSTRUCTION_IDS, MAX_TEXT_UNITS } = mod;
const empty = emptyReportingModel();

// ------------------------------------------------------------------- corpus
const passages = [];
let maxLength = 0;
if (fs.existsSync(path.join(CORPUS, 'manifest.json'))) {
  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
  for (const w of manifest.works) {
    if (!w.file) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
    for (const s of doc.sections) {
      for (const p of s.passages) {
        maxLength = Math.max(maxLength, p.text.length);
        passages.push({
          work: w.id, zh: w.zh, section: s.id, passageId: p.id,
          sourcePage: s.sourcePage, sourceRevid: s.sourceRevid, text: p.text,
        });
      }
    }
  }
}

// ------------------------------------------------- reach (no evidence needed)
const perConstruction = Object.fromEntries(CONSTRUCTION_IDS.map((c) => [c, 0]));
const perWork = {};
let uniqueParse = 0;
let ambiguous = 0;
let tooLong = 0;
const ambiguousExamples = [];
const reachExamples = {};

for (const p of passages) {
  if (p.text.length > MAX_TEXT_UNITS) { tooLong++; continue; }
  let r;
  try {
    r = readReporting(p.text, empty);
  } catch {
    continue;
  }
  if (r.reason === 'ambiguous-frame-occurrence') {
    ambiguous++;
    if (ambiguousExamples.length < 3) {
      // Record the FULL text: an earlier version stored a truncated slice, and
      // the second frame occurrence fell outside the slice, so the "ambiguous
      // example" re-read as unambiguous. Evidence that cannot reproduce the
      // property it is cited for is worse than no evidence.
      ambiguousExamples.push({ work: p.work, zh: p.zh, passageId: p.passageId,
        sourcePage: p.sourcePage, sourceRevid: p.sourceRevid,
        matches: r.ambiguousMatches, text: p.text });
    }
    continue;
  }
  if (!r.construction) continue;
  uniqueParse++;
  perConstruction[r.construction]++;
  perWork[p.work] = (perWork[p.work] ?? 0) + 1;
  if (!reachExamples[r.construction]) {
    reachExamples[r.construction] = {
      work: p.work, section: p.section, passageId: p.passageId,
      sourcePage: p.sourcePage, sourceRevid: p.sourceRevid,
      text: p.text, occurrences: r.occurrences,
    };
  }
}

// ---------------------------------------------- answerable, given the store
let records = [];
if (fs.existsSync(storePath)) {
  records = fs.readFileSync(storePath, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((r) => r.grammar === mod.REPORTING_GRAMMAR_ID);
}
// Selected by role, not truncated by position: the operational core is the
// minimum falsifiable set, and anything held out is named rather than dropped.
const core = selectOperationalCore(
  records.map((r) => ({ ...r, grammar: mod.REPORTING_GRAMMAR_ID })),
  { grammar: mod.REPORTING_GRAMMAR_ID, constructionOf: (t) => {
    try {
      const r = readReporting(t, empty);
      // Uniquely parsed only; a multi-frame passage is held out, not admitted.
      if (!r.construction || r.reason === 'ambiguous-frame-occurrence') return null;
      return r.construction;
    } catch { return null; }
  } });
const model = core.model;
let answerable = 0;
if (model.examples.length) {
  for (const p of passages) {
    try {
      if (readReporting(p.text, model).status === 'KnownFiniteGrammar') answerable++;
    } catch { /* contradictory store is reported elsewhere */ }
  }
}

const report = {
  schema: 'wenyan.grammar.measurement.v1',
  generatedAt: new Date().toISOString(),
  grammar: mod.REPORTING_GRAMMAR_ID,
  corpus: { passages: passages.length, maxPassageLength: maxLength, maxTextUnits: MAX_TEXT_UNITS },
  reach: {
    uniqueParse,
    rate: +(uniqueParse / passages.length).toFixed(6),
    ambiguousFrameOccurrences: ambiguous,
    tooLong,
    perConstruction,
    perWork,
    examples: reachExamples,
    ambiguousExamples,
  },
  answerable: {
    evidenceRecords: model.examples.length,
    passages: answerable,
    rate: +(answerable / passages.length).toFixed(6),
    note: 'Requires every construction below to be pinned by supervised evidence; ' +
      'reach is the ceiling this can approach.',
  },
};

const out = path.join(ROOT, 'knowledge/grammar/measurement.json');
if (argv.includes('--write')) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}

console.log(`[grammar] ${report.grammar}`);
console.log(`  corpus passages        : ${passages.length} (max length ${maxLength}, grammar limit ${MAX_TEXT_UNITS})`);
console.log(`  REACH (unique parse)   : ${uniqueParse} (${(uniqueParse / passages.length * 100).toFixed(2)}%)`);
console.log(`  ambiguous (multi-match): ${ambiguous}`);
console.log(`  over length limit      : ${tooLong}`);
console.log('  per construction:');
for (const [c, n] of Object.entries(perConstruction)) console.log(`    ${c.padEnd(12)} ${n}`);
console.log(`  ANSWERABLE now         : ${answerable} (${(answerable / passages.length * 100).toFixed(2)}%) with ${model.examples.length} reporting record(s)`);
if (Object.keys(perWork).length) {
  console.log('  reach per work:');
  for (const [w, n] of Object.entries(perWork).sort((a, b) => b[1] - a[1])) console.log(`    ${w.padEnd(20)} ${n}`);
}
if (argv.includes('--write')) console.log(`\n[written] ${path.relative(ROOT, out)}`);
process.exit(0);
