/**
 * Does Contested behave as a LOCal, warranted state — and do the other four
 * states still behave?
 *
 *   node tools/semantics/selftest.mjs
 *
 * The important case is locality (S3/I8). A disagreement about one claim must
 * not stop any other claim from being answered, because the alternative —
 * treating a real disagreement as store corruption — would make the semantic
 * layer unusable on exactly the texts where it matters.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeContext, ask, validateAnswer, loadContract } from '../dialogue/ask.mjs';
import { makeJudgment, appendJudgment, evaluateClaim } from './lib/judgments.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const contract = loadContract();
const ctx = makeContext({});
const sem = ctx.semantics;

if (!sem.contract) throw new Error('no semantic contract loaded');
const cases = [];
const check = (name, fn) => {
  try { cases.push({ name, ok: true, detail: fn() ?? 'ok' }); }
  catch (e) { cases.push({ name, ok: false, detail: e.message }); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// The passage used by the fixture.
const TEXT = '我的怨敌可谓多矣，倘有新式的人问起我来，怎么回答呢？我想了一想，决定的是：让他们怨恨去，我也一个都不宽恕。';
const claimOf = (extra) => ({ text: TEXT, ...extra });

const askClaim = (claim, c = ctx) => ask({ type: 'Q7', claim }, c, contract);

// ------------------------------------------------------------ the five states
check('Answered: unanimous judgements yield the verdict', () => {
  const a = askClaim(claimOf({ type: 'coreference', span: '我', link: '我的' }));
  expect(a.state === 'Answered', `got ${a.state}`);
  expect(a.verdict === 'holds', `verdict ${a.verdict}`);
  expect(a.warrant.refs.length >= 1, 'no warrant refs');
  return `${a.verdict} on ${a.judges} judgement(s)`;
});

check('Contested: a real disagreement yields Contested, both sides named', () => {
  const a = askClaim(claimOf({ type: 'coreference', span: '他们', link: '我的怨敌' }));
  expect(a.state === 'Contested', `got ${a.state}`);
  expect(a.disagreement.holds.length >= 1, 'no holds side');
  expect(a.disagreement.fails.length >= 1, 'no fails side');
  expect(a.disagreement.about, 'no statement of what the disagreement is about');
  for (const side of [...a.disagreement.holds, ...a.disagreement.fails]) {
    expect(side.by && side.basis, 'a side without judge or basis');
  }
  return `${a.disagreement.holds.length} hold vs ${a.disagreement.fails.length} reject`;
});

check('Unknown: an unjudged claim is Unknown, never a verdict', () => {
  const a = askClaim(claimOf({ type: 'construction-meaning', span: '可謂多矣', form: '可謂…矣', meaning: 'assessment of degree' }));
  expect(a.state === 'Unknown', `got ${a.state}`);
  expect(a.reason === 'no-judgement-recorded', `reason ${a.reason}`);
  expect(a.missing, 'Unknown without a statement of what is missing');
  return a.reason;
});

check('Refused: declared-out-of-scope claim types (gloss, interpretation)', () => {
  const g = askClaim(claimOf({ type: 'gloss' }));
  const i = askClaim(claimOf({ type: 'interpretation' }));
  expect(g.state === 'Refused', `gloss -> ${g.state}`);
  expect(i.state === 'Refused', `interpretation -> ${i.state}`);
  return 'gloss and interpretation both Refused';
});

check('Refused: an undeclared claim type is never answered by analogy (S6)', () => {
  const a = askClaim(claimOf({ type: 'sentiment' }));
  expect(a.state === 'Refused', `got ${a.state}`);
  return 'sentiment -> Refused';
});

// ------------------------------------------------------------------- locality
check('LOCALITY (S3/I8): a contested claim blocks nothing else', () => {
  const contested = askClaim(claimOf({ type: 'coreference', span: '他们', link: '我的怨敌' }));
  expect(contested.state === 'Contested', `expected the contested claim, got ${contested.state}`);
  // Every other question must still work while that disagreement stands.
  const other = askClaim(claimOf({ type: 'speech-act', span: '决定的是：让他们怨恨去，我也一个都不宽恕', act: 'decision' }));
  expect(other.state === 'Answered', `a neighbouring claim became ${other.state}`);
  const q5 = ask({ type: 'Q5' }, ctx, contract);
  expect(q5.state === 'Answered', `store consistency became ${q5.state}`);
  const q1 = ask({ type: 'Q1', text: '孔子謂弟子曰：「學而時習之。」', grammar: 'wenyan.relations.reporting.v1' }, ctx, contract);
  expect(q1.state === 'Answered', `an unrelated reading became ${q1.state}`);
  return 'contested claim + answered claim + Q5 + Q1 all coexist';
});

// -------------------------------------------------- I7 enforcement has teeth
check('I7 enforced: a one-sided "Contested" is rejected', () => {
  try {
    validateAnswer({
      state: 'Contested', reason: 'made up',
      disagreement: { about: 'x', holds: [{ id: 'a', by: 'b', basis: 'c' }], fails: [] },
      warrant: { kind: 'judgement', refs: ['a'], derivation: 'd' },
    }, contract);
  } catch (e) {
    return `rejected: ${e.message}`;
  }
  throw new Error('NOT rejected — a one-sided disagreement was accepted as Contested');
});

check('I7 enforced: Contested without warrant refs is rejected', () => {
  try {
    validateAnswer({
      state: 'Contested', reason: 'made up',
      disagreement: { about: 'x', holds: [{ id: 'a', by: 'b', basis: 'c' }], fails: [{ id: 'd', by: 'e', basis: 'f' }] },
    }, contract);
  } catch (e) {
    return `rejected: ${e.message}`;
  }
  throw new Error('NOT rejected — Contested without a warrant was accepted');
});

check('S5 enforced: a judgement without provenance cannot be stored', () => {
  try {
    makeJudgment({ claim: claimOf({ type: 'coreference', span: 'x', link: 'y' }), verdict: 'holds', judge: { kind: 'declared-reading' } });
  } catch (e) {
    return `rejected: ${e.message}`;
  }
  throw new Error('NOT rejected — a judgement without a judge/basis was accepted');
});

// ------------------------------- Inconsistent takes precedence over Contested
check('I8: a malformed store is Inconsistent, NOT Contested, even for a contested claim', () => {
  const tmp = path.join(os.tmpdir(), `judgments-tampered-${process.pid}.jsonl`);
  const good = makeJudgment({
    claim: claimOf({ type: 'coreference', span: '他们', link: '我的怨敌' }),
    verdict: 'holds',
    judge: { kind: 'declared-reading', by: 'tamper-test', at: 'now', basis: 'test' },
  });
  // Tamper: change the verdict without recomputing the hashes.
  const bad = { ...good, verdict: 'fails' };
  fs.writeFileSync(tmp, JSON.stringify(bad) + '\n');
  const tampered = makeContext({ semanticStorePath: tmp });
  const a = ask({ type: 'Q7', claim: claimOf({ type: 'coreference', span: '他们', link: '我的怨敌' }) }, tampered, contract);
  fs.unlinkSync(tmp);
  expect(a.state === 'Inconsistent', `got ${a.state} — a broken store must not be reported as Contested`);
  return 'tampered store -> Inconsistent';
});

// ---------------------------------------------- the store is not a vote counter
check('a majority does not settle a claim (no voting)', () => {
  const claim = claimOf({ type: 'coreference', span: '他们', link: '我的怨敌' });
  const three = [];
  for (const [v, by] of [['holds', 'A'], ['holds', 'B'], ['fails', 'C']]) {
    three.push(makeJudgment({ claim, verdict: v, judge: { kind: 'declared-reading', by, at: 'now', basis: `${by} basis` } }));
  }
  const v = evaluateClaim(three, claim);
  expect(v.state === 'Contested', `2-vs-1 was resolved as ${v.state}`);
  return '2 holds vs 1 fails stays Contested';
});

check('Contested is recomputed (I5), not waved through', () => {
  const a = askClaim(claimOf({ type: 'coreference', span: '他们', link: '我的怨敌' }));
  expect(a.state === 'Contested', `got ${a.state}`);
  expect(a.verified.ok === true, `verification failed: ${a.verified.note}`);
  expect(/reproduce/.test(a.verified.note),
    `Contested was not recomputed — verification note was ${JSON.stringify(a.verified.note)}`);
  return a.verified.note;
});

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed++;
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
  console.log(`       ${c.detail}`);
}
console.log(`\n[semantics-selftest] ${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
