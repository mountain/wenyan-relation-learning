/**
 * Feed the whole wenyan.corpus.v1 corpus through the project's own inscription
 * pipeline and record what actually comes out.
 *
 *   node experiments/corpus-pipeline/run.mjs [--sample N]
 *
 * Method: the four TypeScript modules are loaded through Node's type stripping
 * with `mode: 'strip'` (the only mode accepted by Node 24 and 26) and a small
 * isolated loader, so the experiment runs the real shipped code, not a copy.
 *
 * The point is a census, not a benchmark. The inscription pipeline targets
 * bronze-inscription formulas; 諸子/儒家 prose is a different genre. Whatever the
 * distribution turns out to be — including "the output does not discriminate
 * between inputs at all" — is the result, and is written to evidence.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const sampleArg = (() => {
  const i = argv.indexOf('--sample');
  return i >= 0 ? Number(argv[i + 1]) : null;
})();

// ---------------------------------------------------------------- TS loading
const modCache = new Map();
function loadTs(file) {
  file = path.resolve(file);
  if (modCache.has(file)) return modCache.get(file);
  const original = fs.readFileSync(file, 'utf8');
  let code = stripTypeScriptTypes(original, { mode: 'strip' });
  const bindings = {};
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*["'](.+?)["'];?/g,
    (_m, names, relative) => {
      const dep = loadTs(path.resolve(path.dirname(file), relative + '.ts'));
      for (const name of names.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (Object.hasOwn(dep, name)) bindings[name] = dep[name];
      }
      return '';
    });
  const exported = [...code.matchAll(/export\s+(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
  code = code.replace(/export\s+(?=function|const)/g, '');
  const script = new vm.Script(`(function(){${code}\nreturn {${exported.join(',')}};})()`, { filename: file });
  const out = script.runInNewContext(bindings, { timeout: 10000 });
  modCache.set(file, out);
  return out;
}

const MODULES = [
  'src/inscription/analysis.ts',
  'src/inscription/reverse.ts',
  'src/inscription/relations.ts',
  'src/inscription/pipeline.ts',
];
const { runInscriptionPipeline } = loadTs(path.join(ROOT, 'src/inscription/pipeline.ts'));
const relations = loadTs(path.join(ROOT, 'src/inscription/relations.ts'));

// -------------------------------------------------------------------- corpus
const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const passages = [];
for (const w of manifest.works) {
  if (!w.file) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
  for (const s of doc.sections) {
    for (const p of s.passages) {
      passages.push({ work: w.id, zh: w.zh, section: s.title, id: p.id, text: p.text });
    }
  }
}
const selected = sampleArg
  ? passages.filter((_, i) => i % Math.max(1, Math.floor(passages.length / sampleArg)) === 0).slice(0, sampleArg)
  : passages;

// ------------------------------------------------------------------- run
// Mirrors ORACLE_TONE_MARKER_GROUPS in src/inscription/reverse.ts (post-fix):
// one entry per marker, listing accepted spelling variants.
const ORACLE_MARKER_GROUPS = [
  ['王在'], ['令'], ['成事'], ['用乍'],
  ['万年', '萬年'], ['永宝用', '永寶用'], ['卜'], ['贞', '貞'],
];
const markerLabel = (g) => g[0];
const ORACLE_MARKERS = ORACLE_MARKER_GROUPS.map(markerLabel);
const emptyModel = relations.emptyRelationModel();

const perWork = new Map();
const bandCounts = { exploratory: 0, working: 0, strong: 0 };
const hypothesisCounts = new Map();
const markerHits = Object.fromEntries(ORACLE_MARKERS.map((m) => [m, 0]));
const signalCounts = {};
const relationStatusCounts = {};
const errors = [];
let sumConvergence = 0;
let maxConvergence = { score: -1, text: '', zh: '' };
let minConvergence = { score: 2, text: '', zh: '' };
let containsThree = 0;
let acceptedAll = 0;
let rejectedAll = 0;
let growthPulseSum = 0;
const examples = [];

for (const item of selected) {
  try {
    const out = runInscriptionPipeline(item.text, { steps: 3 });
    if (out.blocked) { errors.push(`${item.zh} ${item.id}: unexpectedly blocked`); continue; }
    const { analysis, reverse, growth, optimization } = out;
    const band = reverse.hypothesisMeta.confidenceBand;
    bandCounts[band]++;
    hypothesisCounts.set(reverse.hypothesis, (hypothesisCounts.get(reverse.hypothesis) ?? 0) + 1);
    sumConvergence += reverse.convergenceScore;
    growthPulseSum += growth.learningPulse;
    acceptedAll += optimization.acceptedSteps;
    rejectedAll += optimization.rejectedSteps;
    if (analysis.containsThree) containsThree++;
    for (const s of analysis.signals) signalCounts[s] = (signalCounts[s] ?? 0) + 1;
    for (const g of ORACLE_MARKER_GROUPS) {
      if (g.some((m) => analysis.normalized.includes(m))) markerHits[markerLabel(g)]++;
    }
    const rel = relations.readRelation(item.text, emptyModel);
    relationStatusCounts[rel.status] = (relationStatusCounts[rel.status] ?? 0) + 1;

    const agg = perWork.get(item.work) ?? {
      zh: item.zh, passages: 0, three: 0, sum: 0, bands: { exploratory: 0, working: 0, strong: 0 },
      signals: 0, unknownRelation: 0,
    };
    agg.passages++; if (analysis.containsThree) agg.three++;
    agg.sum += reverse.convergenceScore; agg.bands[band]++;
    if (analysis.signals.length) agg.signals++;
    if (rel.status !== 'KnownFiniteGrammar') agg.unknownRelation++;
    perWork.set(item.work, agg);

    if (reverse.convergenceScore > maxConvergence.score) {
      maxConvergence = { score: reverse.convergenceScore, text: item.text.slice(0, 60), zh: item.zh };
    }
    if (reverse.convergenceScore < minConvergence.score) {
      minConvergence = { score: reverse.convergenceScore, text: item.text.slice(0, 60), zh: item.zh };
    }
    if (examples.length < 5 && ['analects', 'laozi', 'classic-of-poetry'].includes(item.work)) {
      examples.push({
        work: item.zh, id: item.id, text: item.text.slice(0, 50),
        convergence: reverse.convergenceScore, band,
        hypothesis: reverse.hypothesis,
        oracleTone: reverse.matched.oracleToneScore,
        signals: analysis.signals,
      });
    }
  } catch (err) {
    errors.push(`${item.zh} ${item.id}: ${err.message}`);
  }
}

// acknowledgement gate still runs first
const gate = runInscriptionPipeline(selected[0].text, { safety: { requireAcknowledgement: true } });

// ---------------------------------------------------------------------------
// Variant diagnostic. Before the fix in src/inscription/reverse.ts the marker
// list was simplified-only, so markers whose traditional form differs could
// never match a traditional corpus and the score was capped at 6/8. The fix
// accepts both forms; this measures, per marker, whether each spelling occurs,
// and confirms the cap is gone.
const markerDiagnostics = ORACLE_MARKER_GROUPS.map((group) => {
  const counts = group.map((form) => {
    let n = 0;
    for (const p of passages) if (p.text.includes(form)) n++;
    return { form, passages: n };
  });
  const reachable = counts.some((c) => c.passages > 0);
  return {
    marker: markerLabel(group),
    acceptedForms: counts,
    matchableOnThisCorpus: reachable,
  };
});
const simplifiedOnlyForms = markerDiagnostics.flatMap((d) =>
  d.acceptedForms.filter((c, i) => i === 0 && c.passages === 0 &&
    d.acceptedForms.slice(1).some((o) => o.passages > 0))
    .map((c) => ({ marker: d.marker, simplifiedForm: c.form,
      traditionalForm: d.acceptedForms.find((o) => o.passages > 0).form })));

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const evidence = {
  schema: 'wenyan.corpus-pipeline.evidence.v1',
  baseline: 'mountain/wenyan@6143e22ca8319a8ebca89b59a29f20158812b63f',
  corpus: { format: manifest.format, works: manifest.counts.works, passagesTotal: passages.length, passagesProcessed: selected.length },
  runtime: process.version,
  census: {
    errors: errors.length,
    containsThree,
    containsThreeRate: +(containsThree / selected.length).toFixed(4),
    meanConvergenceScore: +(sumConvergence / selected.length).toFixed(4),
    meanGrowthLearningPulse: +(growthPulseSum / selected.length).toFixed(4),
    confidenceBands: bandCounts,
    distinctHypothesisSentences: hypothesisCounts.size,
    hypothesisSentences: [...hypothesisCounts.entries()].map(([text, n]) => ({ text, count: n })),
    oracleToneMarkerHits: markerHits,
    analysisSignals: signalCounts,
    optimization: { acceptedSteps: acceptedAll, rejectedSteps: rejectedAll },
    relationGrammarStatus: relationStatusCounts,
    maxConvergence, minConvergence,
  },
  perWork: [...perWork.entries()].map(([id, a]) => ({
    id, zh: a.zh, passages: a.passages, containsThree: a.three,
    meanConvergenceScore: +(a.sum / a.passages).toFixed(4),
    confidenceBands: a.bands, passagesWithAnySignal: a.signals, passagesNotMatchingRelationGrammar: a.unknownRelation,
  })),
  acknowledgementGate: { blocked: gate.blocked === true, blockedReason: gate.blockedReason ?? null },
  oracleMarkerDiagnostics: {
    note:
      'Post-fix state. scoreOracleTone() (src/inscription/reverse.ts) now tests each of its 8 markers ' +
      'against a group of accepted spelling variants. Before the fix the list held simplified forms ' +
      'only, so on this traditional corpus two markers could never match and the score was capped at ' +
      '6/8 regardless of input. Counted over the whole corpus, not the sample.',
    perMarker: markerDiagnostics,
    markersWhoseSimplifiedFormAloneWouldNeverMatch: simplifiedOnlyForms,
    theoreticalMaxOracleToneScore: 1,
    noteOnDenominator: 'The denominator is still 8 one-hit-per-marker groups, so existing profile weights and thresholds remain comparable.',
  },
  examples,
  sha256: Object.fromEntries(MODULES.map((f) => [f, sha(f)])),
  limitations: [
    'Census, not a benchmark: no accuracy measure exists for this genre under this pipeline.',
    'The reverse hypothesis sentence is drawn from a fixed set (see hypothesisSentences); its information content about the input is therefore limited to which set member was chosen.',
    'oracleToneScore counts bronze-inscription markers; their presence in classical prose is lexical coincidence, not evidence that the pipeline recognised an inscription.',
    'convergenceScore mixes containsThree, channel structure and oracle tone according to the preset weights; it is not a quality or correctness measure.',
    'Corpus text is the Wikisource transcription as built in data/corpus; transcription errors, if any, are outside this experiment.',
  ],
};

fs.writeFileSync(path.join(HERE, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({
  passages: selected.length,
  errors: evidence.census.errors,
  bands: bandCounts,
  distinctHypotheses: hypothesisCounts.size,
  meanConvergence: evidence.census.meanConvergenceScore,
  containsThreeRate: evidence.census.containsThreeRate,
  relationStatus: relationStatusCounts,
  gate: evidence.acknowledgementGate,
}, null, 2));
