/**
 * Pre-compute answers for a static front end.
 *
 *   node tools/interaction/generate.mjs [--write] [--sample N]
 *
 * WHY STATIC
 * tools/dialogue/ask.mjs already turns a question into a JSON answer, so a site needs no
 * server: it needs the answers, the shape they come in, and the obligations that govern
 * rendering them (knowledge/interaction/contract.json). This tool produces the first of
 * those; that contract states the other two.
 *
 * THE QUESTION SET IS DECLARED, AND DERIVED RATHER THAN HAND-LISTED
 *   - a STRATIFIED sample of corpus passages, one per work, so the sample cannot be quietly
 *     dominated by one text (a hand-picked list would hide exactly that);
 *   - plus four FIXED diagnostics chosen to exercise the answer states a UI must handle:
 *     an out-of-grammar passage, a two-slot passage (recipient null), a multi-frame passage
 *     (additionalMatches), and a bare 曰 passage with no reporting verb.
 *   Every question carries the work/section/passageId it came from, so a UI can link back to
 *   the source page and revision rather than showing text with no provenance.
 *
 * WHAT IT DOES NOT DO
 *   It does not grade, rank or summarise. It reports the answers as ask.mjs produced them,
 *   including answers that are Unknown, Refused or Inconsistent, and it records any question
 *   that made the contract throw rather than dropping it — a missing question would look
 *   like a question that was never asked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeContext, ask, loadContract, DEFAULT_STORE } from '../dialogue/ask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const PER_WORK = flag('per-work', 1);
/** The grammar a corpus question is put to: the only one that occurs in real text. */
const GRAMMAR = 'wenyan.relations.reporting.v1';

const contract = loadContract();
const ctx = makeContext({ storePath: DEFAULT_STORE });
const declared = new Set((contract.questionTypes ?? []).map((q) => q.id));
if (!declared.has('Q1')) {
  console.error('[interaction] the dialogue contract declares no Q1 — refusing to guess a question type');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const questions = [];
for (const w of manifest.works) {
  if (!w.file) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
  let taken = 0;
  for (const s of doc.sections) {
    for (const p of s.passages) {
      if (taken >= PER_WORK) break;
      if ([...p.text].length < 12) continue;         // too short to read into a relation
      questions.push({ id: `corpus:${w.id}:${p.id}`, origin: 'stratified-corpus-sample',
        work: w.id, section: s.id, passageId: p.id, sourcePage: s.sourcePage, sourceRevid: s.sourceRevid,
        text: p.text });
      taken++;
    }
    if (taken >= PER_WORK) break;
  }
}

/** Diagnostics: fixed texts that force each answer state a UI has to render. */
for (const d of [
  { id: 'diag:two-slot', why: 'two-slot construction: recipient is UNEXPRESSED, not unknown',
    text: '子曰：「學而時習之。」' },
  { id: 'diag:three-slot', why: 'three-slot construction: all three roles are stated',
    text: '孔子謂弟子曰：「學而時習之。」' },
  { id: 'diag:out-of-grammar', why: 'outside every declared construction: must be Unknown with a reason',
    text: '甲给乙一本书。' },
  { id: 'diag:bare-yue', why: 'bare 曰 with no reporting verb and no addressee',
    text: '王曰：「何謂也？」' },
]) questions.push({ ...d, origin: 'declared-diagnostic', work: null, section: null, passageId: null });

const out = [];
const byState = {};
let threw = 0;
for (const q of questions) {
  let answer;
  try {
    answer = ask({ type: 'Q1', text: q.text, grammar: GRAMMAR }, ctx, contract);
  } catch (e) {
    // Recorded, not dropped: a question that made the contract throw must not disappear from
    // the set, or a UI would show a smaller set with no sign that anything was missing.
    answer = { state: 'ContractThrew', reason: e.message };
    threw++;
  }
  byState[answer.state] = (byState[answer.state] ?? 0) + 1;
  out.push({ id: q.id, origin: q.origin, why: q.why ?? null,
    source: { work: q.work, section: q.section, passageId: q.passageId,
      sourcePage: q.sourcePage ?? null, sourceRevid: q.sourceRevid ?? null },
    question: { type: 'Q1', text: q.text, grammar: GRAMMAR }, answer });
}

// ---------------------------------------------------------------- extra shapes
// A front end has to render FIVE states (knowledge/interaction/contract.json answerStates).
// Q1 alone exercises two of them, so the shipped data would leave a builder unable to test the
// rest. Everything below is added for that reason, and whatever CANNOT be produced from this
// repository is declared rather than faked.

/** Q2 comparisons: do two passages express the same relation? Exercises the comparison vocabulary. */
const pairs = [
  ['two different three-slot speakers', '孔子謂弟子曰：「學而時習之。」', '孟子告齊宣王曰：「君之視臣如手足。」'],
  ['the same three-slot frame twice', '孔子謂弟子曰：「學而時習之。」', '孔子謂弟子曰：「何謂也？」'],
  ['a three-slot against a two-slot', '孔子謂弟子曰：「學而時習之。」', '子曰：「學而時習之。」'],
];
for (const [why, a, b] of pairs) {
  let answer;
  try { answer = ask({ type: 'Q2', a, b, grammar: GRAMMAR }, ctx, contract); }
  catch (e) { answer = { state: 'ContractThrew', reason: e.message }; threw++; }
  byState[answer.state] = (byState[answer.state] ?? 0) + 1;
  out.push({ id: `diag:q2:${pairs.indexOf(pairs.find((x) => x[0] === why))}`, origin: 'declared-diagnostic',
    why: `Q2 — ${why}`, source: { work: null, section: null, passageId: null, sourcePage: null, sourceRevid: null },
    question: { type: 'Q2', a, b, grammar: GRAMMAR }, answer });
}

/** Refused: an UNDECLARED question type must be refused, not guessed at (contract). */
{
  let answer;
  try { answer = ask({ type: 'Q42', text: '子曰：「學而時習之。」', grammar: GRAMMAR }, ctx, contract); }
  catch (e) { answer = { state: 'ContractThrew', reason: e.message }; threw++; }
  byState[answer.state] = (byState[answer.state] ?? 0) + 1;
  out.push({ id: 'diag:refused-undeclared-type', origin: 'declared-diagnostic',
    why: 'an undeclared question type must be Refused with a reason, never guessed at',
    source: { work: null, section: null, passageId: null, sourcePage: null, sourceRevid: null },
    question: { type: 'Q42', text: '子曰：「學而時習之。」', grammar: GRAMMAR }, answer });
}

/** Citation navigation: the intertext relation set, grouped for browsing rather than searching. */
const citations = fs.existsSync(path.join(ROOT, 'knowledge/intertext/citations.jsonl'))
  ? fs.readFileSync(path.join(ROOT, 'knowledge/intertext/citations.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const navMap = new Map();
for (const c of citations) {
  if (!c.citedWork) continue;
  const key = `${c.host.work} → ${c.citedWork}`;
  if (!navMap.has(key)) navMap.set(key, { host: c.host.work, cited: c.citedWork, total: 0, byStatus: {}, examples: [] });
  const e = navMap.get(key);
  e.total++;
  e.byStatus[c.status] = (e.byStatus[c.status] ?? 0) + 1;
  if (e.examples.length < 3 && c.status === 'found-in-cited-work') {
    e.examples.push({ hostPassage: c.host.passageId, marker: c.marker, quote: (c.quote ?? '').slice(0, 40),
      foundAt: c.foundAt ?? null });
  }
}
const citationNavigation = [...navMap.values()].sort((a, b) => b.total - a.total);
const GRAMMAR_ID = 'wenyan.interaction.answers.v1';

const doc = {
  schema: 'wenyan.interaction.answers.v1',
  generatedBy: 'tools/interaction/generate.mjs',
  renderingObligations: 'knowledge/interaction/contract.json — read it: this file is the data, that file says '
    + 'what a UI must and must not show for each answer state.',
  grammar: GRAMMAR,
  store: path.relative(ROOT, DEFAULT_STORE),
  policy: { perWork: PER_WORK, diagnostics: 4, note: 'stratified one-per-work plus fixed diagnostics' },
  totals: { questions: out.length, byState, contractThrew: threw },
  // Which answer states the SHIPPED DATA exercises, so a builder is not left guessing whether a
  // state is unreachable or merely absent here. Two states cannot be produced from this
  // repository as it stands, and saying so is more useful than synthesising them.
  exercisedStates: {
    Answered: (byState.Answered ?? 0) > 0, Unknown: (byState.Unknown ?? 0) > 0,
    Refused: (byState.Refused ?? 0) > 0,
    Contested: false, Inconsistent: false,
    note: 'Contested needs a store holding a named disagreement fed to a question type that surfaces it; '
      + 'the semantics store HAS one (the Lu Xun 他们-coreference judgement) but no Q1 input here reaches it. '
      + 'Inconsistent needs a contradictory store, which this repository is not: it is the state a UI must '
      + 'render when the evidence stops replaying, so it can only be shown from a synthetic store. Both are '
      + 'declared in knowledge/interaction/contract.json and must be implemented; they are simply not '
      + 'exercised by this data.'
  },
  citationNavigation,
  // Observed payload keys per question type, DERIVED from the answers above rather than written by
  // hand, because the payload of an Answered answer varies by question type and a builder should not
  // have to guess which keys a given type can carry.
  payloadKeysByQuestionType: (() => {
    const byType = {};
    for (const a of out) {
      const t = a.question.type;
      byType[t] = byType[t] ?? { states: {}, keys: {} };
      const st = a.answer.state;
      byType[t].states[st] = (byType[t].states[st] ?? 0) + 1;
      for (const k of Object.keys(a.answer)) {
        if (k === 'state') continue;
        byType[t].keys[k] = byType[t].keys[k] ?? new Set();
        if (st === 'Answered') byType[t].keys[k].add(typeof a.answer[k]);
      }
    }
    for (const t of Object.keys(byType)) {
      byType[t].keys = Object.fromEntries(Object.entries(byType[t].keys)
        .map(([k, v]) => [k, [...v]]).filter(([, v]) => v.length));
    }
    return byType;
  })(),
  answers: out,
};
if (process.argv.includes('--write')) {
  const dir = path.join(ROOT, 'dist');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(doc, null, 2) + '\n');
}
console.log(`[interaction] ${out.length} question(s) asked under ${GRAMMAR}`);
console.log(`  by state: ${Object.entries(byState).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
if (threw) console.log(`  ${threw} question(s) made the contract throw — recorded in the output, not dropped`);
if (process.argv.includes('--write')) console.log('\n[written] dist/answers.json');
