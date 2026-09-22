/**
 * Does the contract actually have teeth?
 *
 *   node tools/dialogue/selftest.mjs
 *
 * Checks that the enforcement rejects answers which break the contract, rather
 * than merely documenting the rules. A contract that is only prose is a
 * wish; these are the cases that prove otherwise.
 */
import { makeContext, ask, validateAnswer, loadContract, DEFAULT_STORE } from './ask.mjs';

const contract = loadContract();
const ctx = makeContext({ storePath: DEFAULT_STORE });
const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? 'ok' });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
};
const expectThrow = (name, fn) => check(name, () => {
  try {
    fn();
  } catch (e) {
    return `rejected: ${e.message}`;
  }
  throw new Error('NOT rejected — the contract did not stop it');
});

// ---------------------------------------------------- I1: no unlicensed answer
expectThrow('I1 rejects Answered without a warrant', () =>
  validateAnswer({ state: 'Answered', roles: { agent: 'a', recipient: 'b', theme: 'c' } }, contract));
expectThrow('I1 rejects a non-store warrant with no refs', () =>
  validateAnswer({ state: 'Answered', warrant: { kind: 'evidence', refs: [], derivation: 'x' } }, contract));
expectThrow('I1 rejects a warrant without a derivation', () =>
  validateAnswer({ state: 'Answered', warrant: { kind: 'store', refs: [] } }, contract));

// ------------------------------------------- I2: Unknown must say what is missing
expectThrow('I2 rejects Unknown without reason/missing', () =>
  validateAnswer({ state: 'Unknown' }, contract));
expectThrow('I2 rejects Unknown with only a reason', () =>
  validateAnswer({ state: 'Unknown', reason: 'x' }, contract));

// ------------------------------------------------------- I3: no free-text answers
expectThrow('I3 state must be one of the declared states', () =>
  validateAnswer({ state: 'Probably' }, contract));

// --------------------------------------------- I4: undeclared types are refused
check('I4 refuses an undeclared question type', () => {
  const a = ask({ type: 'Q42', text: 'x' }, ctx, contract);
  if (a.state !== 'Refused') throw new Error(`got ${a.state}`);
  return 'Q42 -> Refused';
});

// ------------------------------- I6: withdrawing the only evidence retracts it
check('I6 withdrawal retracts a conclusion (maturity is not monotone)', () => {
  // Uses whichever grammar the first stored record belongs to, via the
  // grammar-aware context. (An earlier version called ctx.constructionOf, which
  // stopped existing when the context became multi-grammar.)
  const rec = ctx.records[0];
  const impl = ctx.forGrammar(rec.grammar);
  if (!impl) throw new Error(`no declared grammar for stored record grammar ${rec.grammar}`);
  const construction = impl.constructionOf(rec.text);
  const probes = {
    grant: '「丙」授「丁」「帛」。',
    'hand-over': '「丙」把「帛」交给「丁」。',
    receive: '「丁」获「丙」所授「帛」。',
  };
  const probeText = probes[construction];
  if (!probeText) throw new Error(`no probe sentence for construction ${construction}`);
  const before = ask({ type: 'Q1', text: probeText, grammar: impl.id }, ctx, contract);
  if (before.state !== 'Answered') throw new Error(`probe was ${before.state}, expected Answered`);
  const after = ask({ type: 'Q4', text: probeText, removeId: rec.id, grammar: impl.id }, ctx, contract);
  if (after.state !== 'Answered') throw new Error(`counterfactual was ${after.state}`);
  if (!after.changed) throw new Error('withdrawing the only evidence did not change the conclusion');
  if (after.survivingRoleMappings !== 6) {
    throw new Error(`expected 6 surviving mappings after withdrawal, got ${after.survivingRoleMappings}`);
  }
  return `${before.roles.agent}=agent -> retracted: ${after.survivingRoleMappings}/6 survive, changed=${after.changed}`;
});

// ----------------------------- an Answered answer cannot name evidence it lacks
check('Q3 refuses to invent evidence that is not in the store', () => {
  const bogus = {
    state: 'Answered', type: 'Q1',
    roles: { agent: 'x', recipient: 'y', theme: 'z' },
    warrant: { kind: 'evidence', refs: ['no-such-record'], derivation: 'made up' },
  };
  const a = ask({ type: 'Q3', answer: bogus }, ctx, contract);
  if (a.state !== 'Inconsistent') throw new Error(`expected Inconsistent, got ${a.state}`);
  return 'a warrant naming a non-existent record is reported as Inconsistent';
});

// ------------------------------------------------- an Unknown never gets answered
check('Q3 on an Unknown conclusion stays Unknown', () => {
  const u = ask({ type: 'Q1', text: '子曰：「學而時習之。」' }, ctx, contract);
  if (u.state !== 'Unknown') throw new Error(`expected Unknown, got ${u.state}`);
  const a = ask({ type: 'Q3', answer: u }, ctx, contract);
  if (a.state !== 'Unknown') throw new Error(`Q3 answered an Unknown conclusion: ${a.state}`);
  return 'Unknown in -> Unknown out';
});

// -------------------------------------------------------------------- report
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
  console.log(`       ${r.detail}`);
}
console.log(`\n[selftest] ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
