/**
 * FRAME DENSITY per work, per group — the measurement behind the corpus-expansion hypothesis.
 *
 * The hypothesis under test is Mingli Yuan’s: another class of book carries a much higher share of
 * shared structure than 經史 do — 操作性的技术 (齊民要術, 夢溪筆談, 天工開物 …) and 市井文化
 * (金瓶梅, 三言二拍, 東京夢華錄 …). If that is true, the same amount of downloading buys far more
 * relations, and the expansion order should follow density rather than prestige.
 *
 * This tool does NOT test that hypothesis by assertion. It reports, per work and per declared group:
 * how many passages the reporting grammar can read, out of how many. Everything else is left to the
 * reader, and the caveats are printed with the numbers rather than kept in someone’s head:
 *
 *   1. DENSITY IS GRAMMAR-DEPENDENT. These rates are for wenyan.relations.reporting.v1 as it stands
 *      today. The quotation-delimiter widening alone moved the corpus rate 22.43% -> 24.66%, so an
 *      old density figure is not comparable with a new one. `measuredUnder` records which grammar
 *      and when; the triage ledger’s earlier SAMPLED rates are marked stale for exactly this reason.
 *   2. GENRE, ERA AND EDITION ARE CONFOUNDED. A dense 操作體 book is also often a Ming/Qing book and
 *      often a different edition. Nothing here separates those, and this tool does not pretend to.
 *   3. POOLED ≠ TYPICAL. Pooling lets 文獻通考 (16,957 passages) dominate any average it is in; the
 *      median and the per-work range are printed beside every pooled rate.
 *   4. COVERAGE IS PARTIAL WHILE THE BUILD RUNS. Works still being downloaded are listed as
 *      not-yet-built, and a group rate computed from half a group is labelled as such.
 *
 *   node tools/grammar/density.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/**
 * DIRECT MODE. A work file can exist before the manifest lists it: `build.mjs --only` writes the
 * work, and the manifest is written by a later step. Reading only the manifest therefore reported
 * "not yet built" for works already sitting on disk — a fact about the pipeline being read as a
 * fact about the corpus. Passages from those files are measured here directly, under the same
 * grammar and the same length limit as tools/grammar/measure.mjs, and flagged `unmanifested: true`
 * so that a rate computed from a half-written corpus cannot be mistaken for the official one.
 */
const directRows = (manifestIds) => {
  const load = createTsLoader();
  const { readReporting, emptyReportingModel, MAX_TEXT_UNITS } = load(
    path.join(ROOT, 'src/inscription/relations-reporting.ts'));
  const empty = emptyReportingModel();
  const dir = path.join(ROOT, 'data/corpus/works');
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const id = doc.id ?? f.replace(/\.json$/, '');
    if (manifestIds.has(id)) continue;
    let passages = 0;
    let readable = 0;
    for (const s of doc.sections ?? []) {
      for (const p of s.passages ?? []) {
        passages += 1;
        if (p.text.length > MAX_TEXT_UNITS) continue;
        try {
          const r = readReporting(p.text, empty);
          if (r.reason !== 'ambiguous-frame-occurrence' && r.construction) readable += 1;
        } catch { /* outside the declared grammar: counted by its absence */ }
      }
    }
    if (passages) out[id] = { passages, readable, density: +(readable / passages).toFixed(4), unmanifested: true };
  }
  return out;
};

const measurement = read('knowledge/grammar/measurement.json');
const density = measurement.reach?.perWorkDensity;
if (!density) {
  throw new Error('knowledge/grammar/measurement.json has no perWorkDensity — re-run '
    + 'tools/grammar/measure.mjs --write first (the artifact must carry the denominator, not just the count)');
}
const manifest = read('data/corpus/manifest.json');
const manifestIds = new Set(manifest.works.map((w) => w.id));
const direct = directRows(manifestIds);
const densityAll = { ...density, ...direct };

// STALE-ARTIFACT GUARD. measurement.json is generated from the manifest; a work built AFTER that run
// is in the manifest but absent from the artifact, and this tool then reports it as "not yet built" —
// a fact about the artifact printed as a fact about the corpus. Measured instance: 齊民要術 built
// successfully on retry, the manifest went to 107 works, the artifact still held 106, and the group
// line read "not built: 齊民要術 (OK)" while its text sat on disk. Same failure class as the hardcoded
// G8 ceiling and the stale sampled densities; guarded here instead of being noticed again.
const unmeasured = [...manifestIds].filter((id) => !density[id]);
if (unmeasured.length) {
  console.error(`[density] STALE measurement.json: ${unmeasured.length} work(s) now in the manifest `
    + `are absent from it (${unmeasured.slice(0, 4).join(', ')}${unmeasured.length > 4 ? ' …' : ''}). `
    + 'Per-work and per-group figures below are NOT current — re-run tools/grammar/measure.mjs --write.');
  process.exitCode = 2;
}
const byZh = new Map();
for (const w of manifest.works) if (w.zh) byZh.set(w.zh, w.id);

const triage = exists('knowledge/corpus-expansion/practical-and-urban-triage.json')
  ? read('knowledge/corpus-expansion/practical-and-urban-triage.json') : { groups: {} };
const routes = exists('knowledge/corpus-expansion/practical-urban-routes.json')
  ? read('knowledge/corpus-expansion/practical-urban-routes.json').routes : {};
const routeStatus = new Map(Object.entries(routes).map(([zh, r]) => [zh, r.status]));

const stat = (rows) => {
  const ps = rows.reduce((a, r) => a + r.passages, 0);
  const rd = rows.reduce((a, r) => a + r.readable, 0);
  const rates = rows.map((r) => r.density).sort((a, b) => a - b);
  const med = rates.length
    ? (rates.length % 2 ? rates[(rates.length - 1) / 2]
      : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2) : null;
  return {
    works: rows.length, passages: ps, readable: rd,
    pooled: ps ? +(rd / ps).toFixed(4) : null,
    median: med === null ? null : +med.toFixed(4),
    min: rates.length ? rates[0] : null, max: rates.length ? rates[rates.length - 1] : null,
  };
};

// ------------------------------------------------------------------ per work
const perWork = [];
for (const w of manifest.works) {
  const d = densityAll[w.id];
  if (!d) continue;
  perWork.push({ id: w.id, zh: w.zh ?? w.id, ...d });
}
for (const [id, d] of Object.entries(direct)) perWork.push({ id, zh: id, ...d });
perWork.sort((a, b) => b.density - a.density);

// ------------------------------------------------------------------ per group
const groups = {};
for (const [name, list] of Object.entries(triage.groups ?? {})) {
  if (!Array.isArray(list)) continue;
  const built = [];
  const pending = [];
  for (const e of list) {
    const id = byZh.get(e.work) ?? (densityAll[e.work] ? e.work : undefined);
    const d = id ? densityAll[id] : null;
    if (d) built.push({ id, zh: e.work, ...d });
    else pending.push({ zh: e.work, routeStatus: (manifestIds.has(id ?? '') && !density[id])
      ? '已建，但 measurement.json 滞后（重跑 measure.mjs --write）'
      : (routeStatus.get(e.work) ?? e.status ?? 'not attempted') });
  }
  groups[name] = {
    ...stat(built),
    declared: list.length,
    builtWorks: built.map((b) => b.zh),
    notYetBuilt: pending,
    partial: pending.length > 0,
  };
}

// ---------------------------------------------------- the hypothesis, stated plainly
const practical = ['practical-technology', 'urban-and-market'].flatMap(
  (g) => (triage.groups?.[g] ?? []).map((e) => byZh.get(e.work) ?? (densityAll[e.work] ? e.work : undefined)).filter(Boolean))
  .map((id) => densityAll[id]).filter(Boolean);
const baseline = perWork.map(({ passages, readable, density: r }) => ({ passages, readable, density: r }));

const report = {
  schema: 'wenyan.grammar.density.v1',
  generatedAt: new Date().toISOString(),
  measuredUnder: {
    grammar: measurement.grammar,
    measurementGeneratedAt: measurement.generatedAt,
    corpusPassages: measurement.corpus.passages,
    corpusRate: measurement.reach.rate,
  },
  caveats: [
    'Density is grammar-dependent: it is only comparable with figures measured under the same grammar.',
    'Genre, era and edition are confounded; this tool separates none of them.',
    'Pooled rates are dominated by the largest works (文獻通考 = 20.8% of the corpus); the median and range are printed beside them.',
    'Groups with partial: true are computed from the works that are BUILT, not from the declared list.',
  ],
  perWork,
  unmanifestedWorks: Object.keys(direct),
  groups,
  hypothesis: {
    statement: '操作性的技术 and 市井文化 carry more shared structure per passage than the corpus as a whole.',
    practicalAndUrbanBuilt: stat(practical),
    corpusBaseline: stat(baseline),
    verdict: null,
  },
};
{
  const h = report.hypothesis;
  if (!practical.length) {
    h.verdict = 'UNMEASURED — none of the declared practical/urban works is built yet.';
  } else {
    const pooledDelta = +(h.practicalAndUrbanBuilt.pooled - h.corpusBaseline.pooled).toFixed(4);
    const medianDelta = +(h.practicalAndUrbanBuilt.median - h.corpusBaseline.median).toFixed(4);
    h.pooledDelta = pooledDelta;
    h.medianDelta = medianDelta;
    h.verdict = (pooledDelta > 0 && medianDelta > 0
      ? `CONSISTENT WITH the hypothesis so far (+${pooledDelta} pooled, +${medianDelta} median), `
      : 'NOT SUPPORTED so far (' + pooledDelta + ' pooled, ' + medianDelta + ' median), ')
      + `${h.practicalAndUrbanBuilt.works}/${(triage.groups?.['practical-technology']?.length ?? 0)
        + (triage.groups?.['urban-and-market']?.length ?? 0)} declared works built; `
      + 'confounded with era and edition, and this is a description of two groups, not a test.';
  }
}

const pct = (x) => (x === null ? '  n/a' : `${(x * 100).toFixed(2)}%`);
console.log(`[density] grammar ${report.measuredUnder.grammar} @ ${report.measuredUnder.measurementGeneratedAt}`);
console.log(`[density] corpus ${report.measuredUnder.corpusPassages} passages at ${pct(report.measuredUnder.corpusRate)}`);
console.log('\n  per work (readable / passages):');
for (const w of perWork) {
  console.log(`    ${pct(w.density).padStart(7)}  ${String(w.readable).padStart(6)}/${String(w.passages).padEnd(6)} ${w.zh}`);
}
console.log('\n  per group:');
for (const [name, g] of Object.entries(groups)) {
  console.log(`    ${name}${g.partial ? ' (PARTIAL)' : ''}: pooled ${pct(g.pooled)} median ${pct(g.median)} `
    + `range ${pct(g.min)}..${pct(g.max)} over ${g.works}/${g.declared} work(s), ${g.readable}/${g.passages} passages`);
  if (g.notYetBuilt.length) console.log(`      not built: ${g.notYetBuilt.map((p) => p.zh + ' (' + p.routeStatus + ')').join(', ')}`);
}
console.log('\n  hypothesis');
console.log(`    ${report.hypothesis.statement}`);
console.log(`    ${report.hypothesis.verdict}`);

if (argv.includes('--write')) {
  const out = path.join(ROOT, 'knowledge/grammar/density.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[written] ${path.relative(ROOT, out)}`);
}
