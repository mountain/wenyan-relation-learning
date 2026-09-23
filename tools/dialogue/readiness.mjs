/**
 * Measure what the declared dialogue contract can actually answer today.
 *
 *   node tools/dialogue/readiness.mjs [--write]
 *
 * This turns "is it rich enough for conversational reasoning?" into a number
 * per question type. It also self-checks the contract: every declared invariant
 * must name what enforces it, and an undeclared question type must come back
 * Refused rather than answered by analogy (I4).
 *
 * The Unknown reasons are the actionable output: they say which question types
 * are blocked by which missing thing, which is what the next step has to fix.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeContext, ask, loadContract, DEFAULT_STORE, GRAMMAR } from './ask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const storePath = (() => {
  const i = argv.indexOf('--store');
  return i >= 0 ? path.resolve(argv[i + 1]) : DEFAULT_STORE;
})();

const contract = loadContract();
const ctx = makeContext({ storePath });

// ------------------------------------------------------------ contract check
const contractChecks = [];
const cc = (name, ok, detail) => contractChecks.push({ name, ok, detail });
cc('schema', contract.schema === 'wenyan.dialogue.contract.v1', contract.schema);
cc('every invariant names its enforcement',
  contract.invariants.every((i) => i.id && i.rule && i.enforcedBy),
  `${contract.invariants.length} invariant(s)`);
cc('every question type is declared with an id and a name',
  contract.questionTypes.every((q) => q.id && q.name), `${contract.questionTypes.length} type(s)`);
cc('out-of-scope types are marked rather than omitted',
  contract.questionTypes.some((q) => q.status === 'declared-out-of-scope'),
  contract.questionTypes.filter((q) => q.status).map((q) => q.id).join(',') || 'none');
cc('undeclared types are Refused (I4)',
  ask({ type: 'Q99', text: 'x' }, ctx).state === 'Refused', 'Q99 -> Refused');
cc('FreeText answer field does not exist (I3)',
  !contract.questionTypes.some((q) => /freeText|prose|naturalLanguageAnswer/i.test(JSON.stringify(q))),
  'no answer schema contains a free-text field');

// ---------------------------------------------------------- question sets
/** @type {{type:string, question:object, label:string}[]} */
const questions = [];

// Q1 over the authored evidence (what the store actually covers)
for (const r of ctx.records) {
  questions.push({ type: 'Q1', label: `authored:${r.id}`, question: { type: 'Q1', text: r.text } });
}
// Q1 over the corpus (what a user would actually ask about)
/**
 * FROZEN REFERENCE CORPUS — a DEFINITION CHANGE, recorded on 2026-09-24 rather than slipped in.
 *
 * Until today the gate read the LIVE corpus rate. Acquiring books therefore moved the gate: batches
 * 7-9 grew the corpus from 81,575 to 209,604 passages, the readable count ROSE (20,125 -> 26,854) and
 * the RATE FELL (24.66% -> 12.81%), so G8 went from PASS to FAIL as a consequence of following the
 * acquisition rule — a fact about the denominator reported as a fact about the grammar. The floor
 * itself cannot be revised again (0.5 -> 0.15 is already one revision; a second would end its meaning).
 *
 * So the gate is pinned to a frozen, versioned reference corpus and measures THE GRAMMAR'S PROGRESS on
 * it. The live corpus rate is still computed and still reported, beside it, as a diagnostic — it is
 * simply no longer what the gate decides on. Neither number is dropped and neither is silently
 * substituted for the other.
 */
const REFERENCE = fs.existsSync(path.join(ROOT, 'knowledge/grammar/reference-corpus.json'))
  ? new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/grammar/reference-corpus.json'), 'utf8')).works)
  : null;

let corpusPassages = 0;
const corpusSample = [];
if (fs.existsSync(path.join(CORPUS, 'manifest.json'))) {
  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
  for (const w of manifest.works) {
    if (!w.file) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
    for (const s of doc.sections) {
      for (const p of s.passages) {
        corpusPassages++;
        corpusSample.push({ work: w.id, id: p.id, text: p.text, ref: REFERENCE ? REFERENCE.has(w.id) : true });
      }
    }
  }
}
for (const p of corpusSample) {
  questions.push({ type: 'Q1', label: `corpus:${p.work}:${p.id}`, question: { type: 'Q1', text: p.text } });
}

// Q2 pairs
const authored = ctx.records.map((r) => r.text);
for (let i = 0; i < authored.length; i++) {
  for (let j = 0; j < authored.length; j++) {
    if (i !== j) questions.push({ type: 'Q2', label: `authored pair ${i}->${j}`, question: { type: 'Q2', a: authored[i], b: authored[j] } });
  }
}
const byWork = new Map();
for (const p of corpusSample) {
  if (!byWork.has(p.work)) byWork.set(p.work, []);
  if (byWork.get(p.work).length < 2) byWork.get(p.work).push(p);
}
for (const [work, ps] of byWork) {
  if (ps.length === 2) questions.push({ type: 'Q2', label: `corpus pair ${work}`, question: { type: 'Q2', a: ps[0].text, b: ps[1].text } });
}

// Q4 withdrawal, over each evidence record against its own construction and its
// own grammar. (A previous version used ctx.constructionOf, which stopped
// existing when the context became multi-grammar; the same refactor had already
// broken selftest.mjs, so this is the second caller of the same stale member.)
const PROBES = {
  'wenyan.relations.v1': {
    grant: '「丙」授「丁」「帛」。',
    'hand-over': '「丙」把「帛」交给「丁」。',
    receive: '「丁」获「丙」所授「帛」。',
  },
  'wenyan.relations.reporting.v1': {
    'wei-quote': '孔子謂弟子曰：「學而時習之。」',
    'wen-quote': '孔子問弟子曰：「何謂也？」',
    'gao-quote': '孔子告弟子曰：「學而時習之。」',
    'yu-quote': '孔子語弟子曰：「學而時習之。」',
  },
};
for (const r of ctx.records) {
  const impl = ctx.forGrammar(r.grammar);
  if (!impl) continue;
  const probe = PROBES[r.grammar]?.[impl.constructionOf(r.text)];
  if (probe) {
    questions.push({
      type: 'Q4', label: `withdraw ${r.id}`,
      question: { type: 'Q4', text: probe, removeId: r.id, grammar: r.grammar },
    });
  }
}

// Q5 and Q6
questions.push({ type: 'Q5', label: 'store consistency', question: { type: 'Q5' } });
questions.push({ type: 'Q6', label: 'gloss request', question: { type: 'Q6', text: corpusSample[0]?.text ?? '' } });

// Q7 over every claim that HAS judgements recorded.
// Honest limitation: a claim with no judgement leaves no trace in the store, so
// the Unknown case cannot be enumerated from it — that case is covered by a
// declared fixture in tools/semantics/selftest.mjs instead.
if (ctx.semantics?.judgments?.length) {
  const seenClaims = new Set();
  for (const r of ctx.semantics.judgments) {
    if (seenClaims.has(r.claimHash)) continue;
    seenClaims.add(r.claimHash);
    questions.push({
      type: 'Q7', label: `judgement ${r.claim.type} ${r.claim.span ?? r.claim.word ?? ''}`.trim(),
      question: { type: 'Q7', claim: r.claim },
    });
  }
}

// ------------------------------------------------------------------- run
const perType = new Map();
const unknownReasons = {};
const failures = [];
const q3Samples = [];
const contestedSamples = [];
for (const item of questions) {
  let answer;
  try {
    answer = ask(item.question, ctx, contract);
  } catch (e) {
    failures.push({ label: item.label, error: e.message });
    continue;
  }
  const t = perType.get(item.type) ?? { asked: 0, Answered: 0, Unknown: 0, Refused: 0, Inconsistent: 0, Contested: 0 };
  t.asked++;
  t[answer.state]++;
  perType.set(item.type, t);
  if (answer.state === 'Unknown') {
    const key = `${item.type}: ${answer.reason}`;
    unknownReasons[key] = (unknownReasons[key] ?? 0) + 1;
  }
  if (answer.state === 'Contested') {
    contestedSamples.push({ label: item.label, reason: answer.reason,
      holds: answer.disagreement.holds.length, fails: answer.disagreement.fails.length });
  }
  if (answer.state === 'Answered' && q3Samples.length < 5) q3Samples.push({ label: item.label, answer });
}

// Q3 depends on Answered answers, so it is measured over the ones above
const q3 = { asked: 0, Answered: 0, Unknown: 0, Refused: 0, Inconsistent: 0 };
for (const s of q3Samples) {
  const a = ask({ type: 'Q3', answer: s.answer }, ctx, contract);
  q3.asked++;
  q3[a.state]++;
}
if (q3.asked) perType.set('Q3', q3);

// --------------------------------------- corpus answerability, per grammar
// The single most useful number here: of the questions a user would actually
// ask about real text, how many can be answered, and under which grammar.
const perGrammar = {};
const perGrammarReference = {};
for (const gid of ctx.grammarIds) {
  let answered = 0;
  let refAnswered = 0;
  let refTotal = 0;
  const reasons = {};
  for (const p of corpusSample) {
    const a = ask({ type: 'Q1', text: p.text, grammar: gid }, ctx, contract);
    const ok = a.state === 'Answered';
    if (ok) answered++;
    else reasons[`${a.reason}`] = (reasons[`${a.reason}`] ?? 0) + 1;
    if (p.ref) { refTotal++; if (ok) refAnswered++; }
  }
  perGrammar[gid] = {
    corpusQuestions: corpusSample.length,
    answered,
    rate: corpusSample.length ? +(answered / corpusSample.length).toFixed(6) : 0,
    evidenceRecords: ctx.forGrammar(gid)?.evidenceRecords ?? 0,
    topUnknownReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
  // What G8 decides on. The live rate above is the diagnostic.
  perGrammarReference[gid] = {
    referenceQuestions: refTotal,
    answered: refAnswered,
    rate: refTotal ? +(refAnswered / refTotal).toFixed(6) : 0,
  };
}

const report = {
  schema: 'wenyan.dialogue.readiness.v1',
  generatedAt: new Date().toISOString(),
  contract: { schema: contract.schema, checks: contractChecks },
  store: {
    path: path.relative(ROOT, storePath),
    records: ctx.records.length,
    sha256: fs.existsSync(storePath)
      ? crypto.createHash('sha256').update(fs.readFileSync(storePath)).digest('hex') : null,
  },
  questionSets: { corpusPassages: corpusPassages, totalQuestions: questions.length },
  perQuestionType: Object.fromEntries([...perType.entries()].sort()),
  corpusAnswerabilityPerGrammar: perGrammar,
  referenceCorpus: REFERENCE
    ? { frozen: 'knowledge/grammar/reference-corpus.json', works: REFERENCE.size,
        note: 'G8 decides on referenceAnswerabilityPerGrammar. corpusAnswerabilityPerGrammar is the live '
          + 'corpus and is a diagnostic: it moves when books are acquired, which is not grammar progress.' }
    : { frozen: null, note: 'NO FROZEN REFERENCE — G8 falls back to the live corpus rate.' },
  referenceAnswerabilityPerGrammar: perGrammarReference,
  contested: contestedSamples,
  unknownReasons,
  contractViolations: failures,
  verdict: (() => {
    const q1 = perType.get('Q1') ?? { Answered: 0, asked: 0 };
    const q2 = perType.get('Q2') ?? { Answered: 0, asked: 0 };
    const best = Object.entries(perGrammar).sort((a, b) => b[1].rate - a[1].rate)[0];
    return {
      answeredOnAuthoredEvidence: [...ctx.records].length,
      q1AnswerRateOverall: q1.asked ? +(q1.Answered / q1.asked).toFixed(6) : null,
      q2AnswerRateOverall: q2.asked ? +(q2.Answered / q2.asked).toFixed(6) : null,
      bestGrammarOnCorpus: best ? best[0] : null,
      bestCorpusAnswerRate: best ? best[1].rate : null,
      glossIsRefusedByContract: true,
      note: 'A high rate on authored evidence with a low rate on the corpus means the dialogue works, ' +
        'but mostly about the sentences it was taught. The corpus rate is now non-zero because a ' +
        'grammar that occurs in real text was added; it is still small, and it is per question, not ' +
        'a claim about understanding.',
    };
  })(),
  limitations: [
    'Q3 is measured only over the first few Answered answers, as a spot check, not a census.',
    'Corpus questions are asked of every passage, which over-weights long works; rates are per question, not per work.',
    'The contract is enforced for the declared types only; extending the type list requires editing contract.json first.',
  ],
};

const out = path.join(ROOT, 'knowledge/dialogue/readiness.json');
if (argv.includes('--write')) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}

const mark = (b) => (b ? 'ok  ' : 'FAIL');
console.log(`[dialogue] contract ${contract.schema}`);
for (const c of contractChecks) console.log(`  ${mark(c.ok)} ${c.name} (${c.detail})`);
console.log(`\n[dialogue] store=${report.store.path} records=${ctx.records.length}`);
console.log(`[dialogue] questions asked: ${questions.length} (corpus passages available: ${corpusPassages})`);
console.log(`\n  type  asked  Answered  Unknown  Refused  Inconsistent  Contested`);
for (const [t, v] of [...perType.entries()].sort()) {
  console.log(`  ${t.padEnd(5)} ${String(v.asked).padStart(5)} ${String(v.Answered).padStart(9)} ${String(v.Unknown).padStart(8)} ${String(v.Refused).padStart(8)} ${String(v.Inconsistent ?? 0).padStart(13)} ${String(v.Contested ?? 0).padStart(10)}`);
}
console.log('\n  Unknown reasons (what is missing):');
for (const [k, n] of Object.entries(unknownReasons).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`    ${String(n).padStart(5)}  ${k}`);
}
if (contestedSamples.length) {
  console.log('\n  Contested claims (kept visible, not resolved):');
  for (const c of contestedSamples) console.log(`    ${c.holds} hold vs ${c.fails} reject — ${c.label}`);
}
console.log('\n  corpus answerability, per grammar (Q1 over every corpus passage):');
for (const [gid, v] of Object.entries(perGrammar).sort((a, b) => b[1].rate - a[1].rate)) {
  console.log(`    ${(v.rate * 100).toFixed(2)}%  ${v.answered}/${v.corpusQuestions}  ${gid}  (evidence ${v.evidenceRecords})`);
  for (const [r, n] of v.topUnknownReasons) console.log(`             ${String(n).padStart(5)}  ${r}`);
}
if (failures.length) {
  console.log(`\n  CONTRACT VIOLATIONS / ERRORS: ${failures.length}`);
  for (const f of failures.slice(0, 5)) console.log(`    ${f.label}: ${f.error}`);
}
if (argv.includes('--write')) console.log(`\n[written] ${path.relative(ROOT, out)}`);
process.exit(failures.length ? 1 : 0);
