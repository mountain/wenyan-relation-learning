/**
 * Integration smoke check: can the project's own TypeScript consume the corpus?
 *
 *   node tools/corpus/smoke-pipeline.mjs [--sample 200]
 *
 * Loads src/inscription/analysis.ts through Node's type stripping (the same
 * technique experiments/relations/run.cjs uses, with `mode: 'strip'` so it runs
 * on Node 24 and 26), feeds real corpus passages to analyzeInscription(), and
 * reports what came back. This is a boundary/seam check, not a claim of meaning:
 * the inscription analyzer targets bronze-inscription formulas, so low signal
 * counts on 諸子/儒家 prose are the expected result and are reported as such.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const sampleSize = (() => {
  const i = argv.indexOf('--sample');
  return i >= 0 ? Number(argv[i + 1]) : 200;
})();

const cache = new Map();
function loadTs(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const code = stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip' })
    .replace(/import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/g, '')
    .replace(/export\s+(?=function|const|type)/g, '');
  const names = [...fs.readFileSync(file, 'utf8').matchAll(/export\s+(?:function|const)\s+(\w+)/g)]
    .map((m) => m[1]);
  const script = new vm.Script(`(function(){${code}\nreturn {${names.join(',')}};})()`, { filename: file });
  const out = script.runInNewContext({}, { timeout: 2000 });
  cache.set(file, out);
  return out;
}

const manifestPath = path.join(OUT_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('manifest.json not found — run tools/corpus/build.mjs first');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const { analyzeInscription, normalizeInscriptionText } = loadTs(path.join(ROOT, 'src/inscription/analysis.ts'));

const all = [];
for (const w of manifest.works ?? []) {
  if (!w.file) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(OUT_DIR, w.file), 'utf8'));
  for (const s of doc.sections) {
    for (const p of s.passages) all.push({ work: doc.id, section: s.id, id: p.id, text: p.text });
  }
}
const stride = Math.max(1, Math.floor(all.length / sampleSize));
const sample = all.filter((_, i) => i % stride === 0).slice(0, sampleSize);

let withSignals = 0;
let withThree = 0;
const signalHistogram = {};
const failures = [];
const normalizedNonEmpty = { yes: 0, no: 0 };

for (const item of sample) {
  try {
    const a = analyzeInscription(item.text);
    const n = normalizeInscriptionText(item.text);
    if (n.length) normalizedNonEmpty.yes++; else normalizedNonEmpty.no++;
    if (a.signals.length) withSignals++;
    if (a.containsThree) withThree++;
    for (const s of a.signals) signalHistogram[s] = (signalHistogram[s] ?? 0) + 1;
  } catch (err) {
    failures.push(`${item.work} ${item.id}: ${err.message}`);
  }
}

console.log(`[smoke] corpus passages total=${all.length}, sampled=${sample.length} (stride ${stride})`);
console.log(`[smoke] analyzeInscription threw on ${failures.length} passages`);
for (const f of failures.slice(0, 10)) console.log('   !', f);
console.log(`[smoke] normalizeInscriptionText produced non-empty text: ${normalizedNonEmpty.yes}/${sample.length}`);
console.log(`[smoke] sample passages yielding any inscription signal: ${withSignals}`);
console.log(`[smoke] sample passages containing 三: ${withThree}`);
console.log(`[smoke] signal histogram: ${JSON.stringify(signalHistogram)}`);
console.log('\n[note] The inscription analyzer targets bronze-inscription formulas ' +
  '(隹…年…月…干支 / 王在… / 令… / 用乍彝). 諸子 and 儒家 prose is out of that genre, ' +
  'so few signals is the expected outcome. This check verifies the corpus is ' +
  'loadable and consumable by the project\'s own modules; it is not a semantic evaluation.');
