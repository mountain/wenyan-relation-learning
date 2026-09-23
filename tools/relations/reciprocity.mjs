/**
 * IS THE RELATION NETWORK SYMMETRIC UNDER THE 我↔你 EXCHANGE?
 *
 * This is step 1 of the tetrahedron programme: Mingli Yuan's scheme puts VALUES on vertices and
 * PERSONS on edges (我 = 丑–恶, 你 = 丑–美, 他 = 美–恶), and 恕 / 大學詰矩之道 is, in that language, an
 * INVARIANCE: 「所惡於上，毋以使下」 asks a judgement to be unchanged when the two ends of an
 * exchange are swapped. 《大學》 enumerates three such swaps — 上下, 前後, 左右 — i.e. the three
 * opposite pairs of the tetrahedron's six edges.
 *
 * So the claim is testable on what this project has already extracted: the three-slot constructions
 * (<A>謂<B>曰, 問, 告, 語) give a directed relation network agent → recipient, and the question is
 * whether that network is more symmetric than chance.
 *
 * THE NULL MODEL MATTERS AND IS NOT OPTIONAL. Any network of speech reports has SOME two-way pairs
 * (teachers and students talk to each other, kings and ministers talk to each other); the only
 * meaningful question is whether the observed rate exceeds what the same agents and the same
 * recipients would produce if pairing were random. A permutation test is used, preserving both
 * marginals: recipients are reshuffled across edges while agents stay put.
 *
 * Not claimed: this measures the SYMMETRY OF ATTESTED SPEECH RELATIONS. It does not measure 恕, which
 * is a norm about what SHOULD be done, and no count of who-spoke-to-whom can decide a norm. If the
 * network turns out symmetric, that is a fact about the texts' social texture; if asymmetric, it is
 * not a refutation of 恕 — only of the stronger claim that the corpus's relations already realise it.
 *
 *   node tools/relations/reciprocity.mjs [--write] [--permutations N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const PERM = Number(argv[argv.indexOf('--permutations') + 1]) || 200;

const { readReporting, emptyReportingModel, MAX_TEXT_UNITS, ROLES_FOR_CONSTRUCTION } = createTsLoader()(
  path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const empty = emptyReportingModel();

/**
 * ROLES ARE READ WITH THE REAL MODEL, NOT THE EMPTY ONE.
 *
 * The first two runs of this tool read slots through `emptyReportingModel()`, and that is a trap this
 * project has fallen into before: with no evidence records the role ORDER is undetermined, replay()
 * leaves every permutation alive, and candidates[0] is whatever permutation happens to come first —
 * so `.agent` returns a slot that may be the theme. The giveaway was in the output: agents like
 * 「請問乘馬」「益者與」 are quotation fragments, and a top recipient was 「》」, the closing bracket of a
 * book title. Those numbers were about the labeler, not the corpus.
 *
 * So the model is selected from the store exactly as tools/grammar/measure.mjs does it: the operational
 * core, whose role orders are pinned by supervised labels. Any tool that reports ROLES rather than
 * constructions must do this; a construction-only comparison is safe with the empty model, which is
 * why the earlier probes used one and this one cannot.
 */
const STORE = path.join(ROOT, 'knowledge/relations/evidence.jsonl');
const { selectOperationalCore } = await import('../knowledge/projection.mjs');
const { labelIsConsistent } = createTsLoader()(path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const storeRecords = fs.readFileSync(STORE, 'utf8').split('\n').filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((r) => r.grammar === 'wenyan.relations.reporting.v1')
  .map((r) => ({ ...r, grammar: 'wenyan.relations.reporting.v1' }));
const model = selectOperationalCore(storeRecords, {
  grammar: 'wenyan.relations.reporting.v1',
  constructionOf: (t) => { try { return readReporting(t, empty).construction ?? null; } catch { return null; } },
  isConsistent: (r) => labelIsConsistent(r.text, r.expected),
}).model;
console.log(`[reciprocity] role model: ${model.examples.length} supervised record(s) pinning the role order`);
const THREE = ['wei-quote', 'wen-quote', 'gao-quote', 'yu-quote'];

const clean = (s) => (s ?? '').replace(/[，。；：︰﹕「」『』"“”？！、\s]/g, '');

const edges = [];
const slotAgent = new Map();
const slotRecipient = new Map();
const lexical = { 己所不欲: 0, 勿施於人: 0, 施諸己: 0, 反求諸己: 0, 忠恕: 0, 絜矩: 0, 所惡於: 0, 恕: 0, 我不欲: 0, 人之不欲: 0 };
let passages = 0;
let threeSlot = 0;
let rejected = 0;   // ends dropped as impossibly long for a person — see the filter below
const rejectExamples = [];

const dir = path.join(ROOT, 'data/corpus/works');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const s of doc.sections ?? []) {
    for (const p of s.passages ?? []) {
      if (p.text.length > MAX_TEXT_UNITS) continue;
      passages += 1;
      for (const k of Object.keys(lexical)) if (p.text.includes(k)) lexical[k] += 1;
      let r;
      try { r = readReporting(p.text, model); } catch { continue; }
      if (!r.construction || r.reason === 'ambiguous-frame-occurrence') continue;
      if (ROLES_FOR_CONSTRUCTION(r.construction).length !== 3) continue;
      threeSlot += 1;
      const a = clean(r.candidates?.[0]?.agent);
      const b = clean(r.candidates?.[0]?.recipient);
      if (!a || !b || a === b) continue;
      // ADMISSIBILITY FILTER, and it is doing most of the work here. The first run produced 3,634
      // edges whose top agents were runs like 「豐故梁徙也今魏地已定者數十城齒今下魏魏以齒為侯守豐不下且屠豐」
      // and whose reciprocity was 0/3634 — a number about the LABELS, not about the relations. The
      // cause is aperture A1: an entity span is an unquoted run, and 史記/漢書 passages in this corpus
      // are unpunctuated in places, so the span swallows whole clauses. A span that long cannot be a
      // person, so ends longer than 4 characters are dropped — a CHOICE, stated, not a derivation.
      const NAME = (x) => x.length >= 1 && x.length <= 4;
      if (!NAME(a) || !NAME(b)) { rejected += 1; if (rejectExamples.length < 4) rejectExamples.push(a); continue; }
      edges.push({ a, b, c: r.construction });
      slotAgent.set(a, (slotAgent.get(a) ?? 0) + 1);
      slotRecipient.set(b, (slotRecipient.get(b) ?? 0) + 1);
    }
  }
}

// ------------------------------------------------------------------ reciprocity
const keys = new Set(edges.map((e) => `${e.a}|${e.b}`));
const reciprocal = (es, ks) => {
  let both = 0;
  let total = 0;
  for (const e of es) {
    if (e.a === e.b) continue;
    total += 1;
    if (ks.has(`${e.b}|${e.a}`)) both += 1;
  }
  return { both, total, rate: total ? +(both / total).toFixed(6) : 0 };
};
const observed = reciprocal(edges, keys);

// Permutation null: keep agents, reshuffle recipients.
let seed = 20260924;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const nullRates = [];
const recipients = edges.map((e) => e.b);
for (let i = 0; i < PERM; i += 1) {
  const shuffled = recipients.slice();
  for (let j = shuffled.length - 1; j > 0; j -= 1) {
    const k = Math.floor(rnd() * (j + 1));
    [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
  }
  const es = edges.map((e, j) => ({ a: e.a, b: shuffled[j], c: e.c }));
  nullRates.push(reciprocal(es, new Set(es.map((e) => `${e.a}|${e.b}`))).rate);
}
nullRates.sort((x, y) => x - y);
const mean = nullRates.reduce((a, b) => a + b, 0) / nullRates.length;
const below = nullRates.filter((x) => x < observed.rate).length;

const head = (m, n = 8) => [...m].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${k}:${v}`);

const report = {
  schema: 'wenyan.relations.reciprocity.v1',
  generatedAt: new Date().toISOString(),
  question: 'Are attested three-slot relations symmetric under the 我↔你 exchange more often than chance?',
  scope: {
    passagesScanned: passages, threeSlotReadings: threeSlot,
    edgesWithDistinctEnds: edges.length, edgesRejectedAsUnnameable: rejected,
    note: 'The rejected ends are the A1 aperture showing up as a blocker: with unpunctuated text the '
      + 'entity span is a whole clause, so no relation can be attributed to anyone. The filter keeps '
      + 'ends of 1-4 characters; examples of what it dropped: ' + rejectExamples.slice(0, 3).map((x) => x.slice(0, 24)).join(' / '),
  },
  observed,
  null: {
    permutations: PERM, meanRate: +mean.toFixed(6),
    min: nullRates[0], max: nullRates[nullRates.length - 1],
    percentileOfObserved: +((below / PERM) * 100).toFixed(1),
  },
  verdict: null,
  slotAsymmetry: {
    topAgents: head(slotAgent), topRecipients: head(slotRecipient),
    note: 'The person words are the interesting rows: 我/吾 in the agent slot against 我/吾 in the '
      + 'recipient slot is the direct lexical trace of who is allowed to be the ends of an exchange.',
  },
  lexicalFormulas: lexical,
  nonClaims: [
    'This measures the symmetry of attested SPEECH relations, not 恕. 恕 is a norm about what should be done, and no who-spoke-to-whom count can settle a norm.',
    'The null preserves both marginals and nothing else: agents stay, recipients are reshuffled. It does not model genre, era or a work’s internal cast.',
    'Reciprocity is counted on EXACT cleaned strings, so 孔子/夫子 are two people here. That under-counts reciprocity in works that name the same person two ways, which biases against the hypothesis rather than for it.',
  ],
};
{
  const z = observed.rate - mean;
  report.verdict = observed.rate === 0
    ? 'UNMEASURED — no reciprocal pair at all, which would itself need checking before being believed.'
    : z > 0
      ? `Observed reciprocity ${observed.rate} against a null mean of ${mean.toFixed(6)} `
        + `(percentile ${report.null.percentileOfObserved}); the network IS more symmetric than chance. `
        + 'Whether that is 恕 or just conversation is not decided here.'
      : `Observed reciprocity ${observed.rate} against a null mean of ${mean.toFixed(6)}: NOT more `
        + `symmetric than chance. The stronger claim — that the corpus already realises the 我↔你 `
        + 'invariance — is not supported by its speech relations.';
}

console.log(`[reciprocity] passages ${passages}, three-slot readings ${threeSlot}, edges ${edges.length}`);
console.log(`[reciprocity] observed reciprocal ${observed.both}/${observed.total} = ${observed.rate}`);
console.log(`[reciprocity] null (${PERM} permutations) mean ${mean.toFixed(6)} range ${nullRates[0]}..${nullRates[nullRates.length - 1]}, percentile of observed ${report.null.percentileOfObserved}`);
console.log(`[reciprocity] ${report.verdict}`);
console.log(`[reciprocity] top agents: ${report.slotAsymmetry.topAgents.join(' ')}`);
console.log(`[reciprocity] top recipients: ${report.slotAsymmetry.topRecipients.join(' ')}`);
console.log(`[reciprocity] 恕 lexical: ${Object.entries(lexical).map(([k, v]) => `${k}:${v}`).join(' ')}`);

if (argv.includes('--write')) {
  const out = path.join(ROOT, 'knowledge/relations/reciprocity.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[written] ${path.relative(ROOT, out)}`);
}
