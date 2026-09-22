/**
 * Evidence-licensed dialogue: the executor that ENFORCES the contract.
 *
 *   node tools/dialogue/ask.mjs Q1 --text '「甲」授「乙」「书」。'
 *   node tools/dialogue/ask.mjs Q2 --a '…' --b '…'
 *   node tools/dialogue/ask.mjs Q5
 *   node tools/dialogue/ask.mjs Q6 --text '子曰：「學而時習之。」'
 *
 * The point is not that answers are produced — it is that an answer WITHOUT a
 * warrant cannot be produced. Every return value passes validateAnswer(), and
 * every Answered value is independently recomputed by verifyAnswer() before it
 * is handed back. A handler that tries to answer beyond its evidence is a bug
 * that fails loudly here rather than a fluent paragraph that fails silently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
import { loadEvidence, integrityReport } from '../knowledge/store.mjs';
import { selectOperationalCore } from '../knowledge/projection.mjs';
import { loadJudgments, evaluateClaim } from '../semantics/lib/judgments.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const DEFAULT_STORE = path.join(ROOT, 'knowledge/relations/evidence.jsonl');
export const GRAMMAR = 'wenyan.relations.v1';

export function loadContract(file = path.join(HERE, 'contract.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ------------------------------------------------------------------ context
/**
 * Declared grammars. The dialogue layer is grammar-agnostic: a question may name
 * which grammar should read the text, and the answer's warrant says which one
 * produced it. Without this, adding a grammar that occurs in real text would
 * have improved the knowledge layer while leaving the dialogue still reading
 * only the experimental one.
 */
export const GRAMMARS = {
  [GRAMMAR]: {
    module: 'src/inscription/relations.ts',
    read: 'readRelation', empty: 'emptyRelationModel',
    probe: '「甲」授「乙」「书」。',
    constructions: ['grant', 'hand-over', 'receive'],
    // A FIXTURE grammar: it occurs nowhere in the corpus, so it can only ever be
    // licensed by sentences written to exercise it. Declared as such, so its
    // answers never masquerade as corpus knowledge.
    provenance: 'authored',
    label: 'experimental fixture (invented, 0/8208 corpus coverage)',
  },
  'wenyan.relations.reporting.v1': {
    module: 'src/inscription/relations-reporting.ts',
    read: 'readReporting', empty: 'emptyReportingModel',
    probe: '孔子謂弟子曰：「學而時習之。」',
    constructions: ['wei-quote', 'wen-quote', 'gao-quote', 'yu-quote'],
    // A CORPUS grammar: learned only from real passage text.
    provenance: 'corpus',
    label: 'reporting frame (occurs in ~4.5% of corpus passages)',
  },
};
export const DEFAULT_GRAMMAR = GRAMMAR;

export function makeContext({ storePath = DEFAULT_STORE, semanticStorePath = null } = {}) {
  const load = createTsLoader();
  const { records, issues, retractedIds, retractions, allRecords } = loadEvidence(storePath);

  // The semantic layer: a judgement store plus its claim-type contract. Loaded
  // here so Q7 has a warrant source; a missing contract is reported, not guessed.
  const semanticContractPath = path.join(ROOT, 'tools/semantics/contract.json');
  const judgmentsPath = semanticStorePath ?? path.join(ROOT, 'knowledge/semantics/judgments.jsonl');
  const semanticContract = fs.existsSync(semanticContractPath)
    ? JSON.parse(fs.readFileSync(semanticContractPath, 'utf8')) : null;
  const judgments = loadJudgments(judgmentsPath);

  const impls = new Map();
  for (const [id, spec] of Object.entries(GRAMMARS)) {
    const mod = load(path.join(ROOT, spec.module));
    const evidence = records.filter((r) => r.grammar === id);
    const constructionOf = (text) => {
      try {
        return mod[spec.read](text, mod[spec.empty]()).construction ?? null;
      } catch {
        return null;
      }
    };
    // Evidence is selected by ROLE, never by position, and — for a corpus
    // grammar — by PROVENANCE, so invented detection sentences cannot enter
    // corpus learning. Excluded records are named by the projection.
    const projection = selectOperationalCore(evidence, {
      grammar: id, constructionOf, provenance: spec.provenance ?? 'any',
      expectedConstructions: spec.constructions ?? null,
    });
    impls.set(id, {
      id, module: mod, spec, model: projection.model, evidenceRecords: evidence.length,
      provenance: spec.provenance ?? 'any',
      excludedByProvenance: projection.excludedByProvenance,
      projection,
      constructionOf,
      /** Guarded: replay() throws on a contradictory store. */
      read(text) {
        try {
          return { ok: true, reading: mod[spec.read](text, projection.model) };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
    });
  }

  return {
    root: ROOT, storePath, records, parseIssues: issues,
    retractedIds, retractions, allRecords,
    semantics: {
      contract: semanticContract,
      storePath: judgmentsPath,
      judgments: judgments.records,
      issues: judgments.issues,
    },
    impls,
    grammarIds: [...impls.keys()],
    forGrammar(name) {
      const impl = impls.get(name ?? DEFAULT_GRAMMAR);
      if (!impl) return null;
      return impl;
    },
    storeReplayError() {
      for (const impl of impls.values()) {
        if (!impl.model.examples.length) continue; // nothing to contradict
        const probe = impl.read(impl.spec.probe);
        if (!probe.ok) return probe.error;
      }
      return null;
    },
  };
}

// ------------------------------------------------------------- answer forms
const answered = (payload, warrant) => ({ state: 'Answered', ...payload, warrant });
const unknown = (reason, missing) => ({ state: 'Unknown', reason, missing });
const refused = (reason) => ({ state: 'Refused', reason });
const inconsistent = (reason) => ({
  state: 'Inconsistent',
  reason: `store is contradictory, so nothing is licensed: ${reason}`,
  missing: 'a store whose evidence replays without contradiction',
});

// ---------------------------------------------------------------- handlers
const HANDLERS = {
  /** Q1 reading */
  reading({ text, grammar }, ctx) {
    const impl = ctx.forGrammar(grammar);
    if (!impl) {
      return refused(`grammar ${JSON.stringify(grammar)} is not declared (declared: ${ctx.grammarIds.join(', ')})`);
    }
    const probe = impl.read(text);
    if (!probe.ok) return inconsistent(probe.error);
    const r = probe.reading;
    if (!r.construction) {
      return unknown('outside-declared-grammar',
        `a declared grammar in which this text is in-grammar; tried ${impl.id} — ` +
        `${ctx.grammarIds.length} grammar(s) are declared`);
    }
    if (r.status !== 'KnownFiniteGrammar') {
      return unknown(r.reason ?? 'ambiguous-role-mapping',
        `at least one more labelled example for construction '${r.construction}' in ${impl.id}; ` +
        `${r.candidates.length} of 6 role permutations still survive`);
    }
    const refs = ctx.records
      .filter((x) => x.grammar === impl.id && impl.constructionOf(x.text) === r.construction)
      .map((x) => x.id);
    return answered(
      { roles: r.candidates[0], construction: r.construction, grammar: impl.id, occurrences: r.occurrences },
      { kind: 'evidence', refs,
        derivation: `replay(evidence) leaves 1 of 6 role permutations for '${r.construction}' in ${impl.id}` });
  },

  /** Q2 comparison */
  comparison({ a, b, grammar }, ctx) {
    const left = HANDLERS.reading({ text: a, grammar }, ctx);
    if (left.state !== 'Answered') {
      return unknown(`left side: ${left.reason ?? left.state}`, left.missing ?? 'a determinable reading for the left sentence');
    }
    const right = HANDLERS.reading({ text: b, grammar }, ctx);
    if (right.state !== 'Answered') {
      return unknown(`right side: ${right.reason ?? right.state}`, right.missing ?? 'a determinable reading for the right sentence');
    }
    if (left.grammar !== right.grammar) {
      return unknown('the two sides were read under different grammars',
        'a single grammar covering both sentences');
    }
    const x = left.roles, y = right.roles;
    const eq = (p, q) => p.agent === q.agent && p.recipient === q.recipient && p.theme === q.theme;
    const relation = eq(x, y) ? 'SameRelation'
      : (x.agent !== x.recipient && x.agent === y.recipient && x.recipient === y.agent && x.theme === y.theme)
        ? 'RoleReversal' : 'DifferentRelation';
    return answered({ relation, grammar: left.grammar }, {
      kind: 'evidence',
      refs: [...new Set([...(left.warrant.refs ?? []), ...(right.warrant.refs ?? [])])],
      derivation: 'both readings determined by replay(evidence), then compared structurally',
    });
  },

  /** Q3 warrant — the "how do you know?" move */
  warrant({ answer }, ctx) {
    if (!answer || answer.state !== 'Answered') {
      return unknown('the supplied conclusion is not Answered', 'an Answered conclusion to explain');
    }
    const refs = (answer.warrant?.refs ?? []).map((id) => {
      const r = ctx.records.find((x) => x.id === id);
      if (!r) {
        // A retracted record still EXISTS — it is simply no longer active. That is
        // a different finding from a record that never existed: the conclusion did
        // not lose its basis to corruption, it lost it to a decision.
        if ((ctx.retractedIds ?? []).includes(id)) return { id, present: false, retracted: true };
        return { id, present: false };
      }
      return {
        id: r.id, present: true, text: r.text, expected: r.expected,
        labelKind: r.label?.kind ?? null, labelBy: r.label?.by ?? null,
        source: r.source?.kind ?? null,
      };
    });
    const retractedRefs = refs.filter((r) => r.retracted);
    if (retractedRefs.length) {
      return unknown('warrant-refers-to-retracted-evidence',
        `a warrant resting on evidence that is still active; ${retractedRefs.length} named record(s) were ` +
        `retracted (${retractedRefs.map((m) => m.id).join(', ')}), so this conclusion is no longer licensed`);
    }
    const missingRefs = refs.filter((r) => !r.present);
    if (missingRefs.length) {
      return inconsistent(`warrant names ${missingRefs.length} record(s) that are not in the store: ${missingRefs.map((m) => m.id).join(', ')}`);
    }
    return answered({ refs }, {
      kind: 'store', derivation: 'each named record resolved in the store and its contentHash verified on load',
    });
  },

  /** Q4 counterfactual — withdrawal test; makes I6 concrete */
  counterfactual({ text, removeId, grammar }, ctx) {
    const impl = ctx.forGrammar(grammar);
    if (!impl) {
      return refused(`grammar ${JSON.stringify(grammar)} is not declared (declared: ${ctx.grammarIds.join(', ')})`);
    }
    const target = ctx.records.find((r) => r.id === removeId);
    if (!target) {
      return unknown(`no such evidence record: ${removeId}`, 'the id of a record present in the store');
    }
    const before = HANDLERS.reading({ text, grammar }, ctx);
    const reduced = {
      schema: impl.id,
      examples: impl.model.examples.filter((e) => e.id !== removeId),
    };
    let after;
    try {
      after = impl.module[impl.spec.read](text, reduced);
    } catch (e) {
      return inconsistent(e.message);
    }
    const survivors = after.candidates.length;
    const changed = (before.state !== 'Answered') || (survivors !== 1)
      || after.candidates[0].agent !== before.roles.agent;
    return answered(
      { status: after.status, survivingRoleMappings: survivors, changed,
        withoutEvidence: removeId, grammar: impl.id },
      { kind: 'derivation', refs: reduced.examples.map((r) => r.id),
        derivation: `replay(evidence minus ${removeId}) in ${impl.id}` });
  },

  /** Q5 consistency */
  consistency(_input, ctx) {
    const integrity = integrityReport(ctx.records);
    const replayError = ctx.storeReplayError();
    if (replayError || integrity.issues.length || ctx.parseIssues.length) {
      return inconsistent(replayError ?? [...integrity.issues, ...ctx.parseIssues].join('; '));
    }
    return answered(
      { replayOk: true, recordCount: ctx.records.length,
        integrityIssues: [], grammarVersions: integrity.grammars },
      { kind: 'store', derivation: 'content hashes verified on load, then replay over the whole store' });
  },

  /** Q7 judgement — the only question type warranted by judgements, not spans */
  judgement({ claim }, ctx) {
    const sem = ctx.semantics;
    if (!sem?.contract) {
      return inconsistent('no semantic contract is configured, so claim types cannot be checked');
    }
    if (!claim || typeof claim.type !== 'string') {
      return unknown('the request carries no claim type',
        'a claim with a declared type, e.g. { type: "coreference", text, span, link }');
    }
    const outOfScope = (sem.contract.declaredOutOfScope ?? []).find((c) => c.id === claim.type);
    if (outOfScope) {
      return refused(`claim type '${claim.type}' is declared out of scope in ${sem.contract.schema}: ${outOfScope.reason}`);
    }
    const declared = (sem.contract.claimTypes ?? []).find((c) => c.id === claim.type);
    if (!declared) {
      // S6: an undeclared claim type is Refused, never answered by analogy.
      return refused(`claim type ${JSON.stringify(claim.type)} is not declared in ${sem.contract.schema}`);
    }
    if (sem.issues.length) {
      return inconsistent(`the judgement store is malformed: ${sem.issues[0]}`);
    }
    const result = evaluateClaim(sem.judgments, claim);
    if (result.state === 'Unknown') return unknown(result.reason, result.missing);
    if (result.state === 'Contested') {
      // Local by construction (I8): this names both sides and blocks nothing else.
      return {
        state: 'Contested',
        claimHash: result.claimHash,
        reason: result.reason,
        disagreement: result.disagreement,
        warrant: result.warrant,
      };
    }
    return answered(
      { verdict: result.verdict, judges: result.judges, claimHash: result.claimHash },
      result.warrant);
  },

  /** Q6 gloss — declared out of scope: Refused, not guessed */
  gloss() {
    return refused('gloss is declared out of scope in wenyan.dialogue.contract.v1: ' +
      'answering requires a lexicon or sense inventory, and none exists in this repository');
  },
};

const TYPE_TO_HANDLER = {
  Q1: 'reading', Q2: 'comparison', Q3: 'warrant',
  Q4: 'counterfactual', Q5: 'consistency', Q6: 'gloss', Q7: 'judgement',
};

// ------------------------------------------------------------------ enforcing
/** Throws when an answer breaks the contract. Enforces I1–I4. */
export function validateAnswer(answer, contract) {
  const states = Object.keys(contract.answerStates);
  if (!states.includes(answer.state)) throw new Error(`invalid answer state: ${answer.state}`);
  if (answer.state === 'Answered') {
    if (!answer.warrant) throw new Error('I1 violated: Answered without a warrant');
    if (answer.warrant.kind !== 'store' && !(answer.warrant.refs ?? []).length) {
      throw new Error('I1 violated: Answered with a non-store warrant and no refs');
    }
    if (!answer.warrant.derivation) throw new Error('I1 violated: warrant without a derivation string');
  }
  if (answer.state === 'Unknown' && (!answer.reason || !answer.missing)) {
    throw new Error('I2 violated: Unknown without reason and missing');
  }
  if ((answer.state === 'Refused' || answer.state === 'Inconsistent') && !answer.reason) {
    throw new Error(`I2 violated: ${answer.state} without a reason`);
  }
  // I7/I8: Contested is a warranted disagreement, not a bare state, and it must
  // be usable without contradicting the store-wide meaning of Inconsistent.
  if (answer.state === 'Contested') {
    const d = answer.disagreement;
    if (!d || !Array.isArray(d.holds) || !Array.isArray(d.fails)) {
      throw new Error('I7 violated: Contested without a disagreement object');
    }
    if (!d.holds.length || !d.fails.length) {
      throw new Error('I7 violated: Contested must name BOTH sides; a one-sided "disagreement" is just an answer');
    }
    if (!d.about) throw new Error('I7 violated: Contested without stating what the disagreement is about');
    if (!answer.reason) throw new Error('I2 violated: Contested without a reason');
    if (!answer.warrant || !(answer.warrant.refs ?? []).length) {
      throw new Error('I7 violated: Contested without warrant refs (the records that disagree)');
    }
    for (const side of [...d.holds, ...d.fails]) {
      if (!side.id || !side.by || !side.basis) {
        throw new Error('I7 violated: a contested side must carry id, judge and basis');
      }
    }
  }
  return true;
}

/** Independent recomputation. Enforces I5. */
export function verifyAnswer(question, answer, ctx) {
  // Contested must be reproducible too — arguably more so, since it is the state
  // where a store could be misread as disagreement (or a disagreement missed).
  // An earlier version returned early for every non-Answered state, so a
  // Contested answer was never recomputed at all and reported "nothing to
  // recompute", which is exactly the warrant that I5 exists to provide.
  if (answer.state === 'Contested') {
    if (question.type !== 'Q7') {
      return { ok: false, note: `Contested is only defined for Q7, got ${question.type}` };
    }
    const again = HANDLERS.judgement({ claim: question.claim }, ctx);
    if (again.state !== 'Contested') {
      return { ok: false, note: `recompute gave ${again.state} instead of Contested` };
    }
    const sameSides = again.disagreement.holds.length === answer.disagreement.holds.length
      && again.disagreement.fails.length === answer.disagreement.fails.length
      && again.warrant.refs.length === answer.warrant.refs.length;
    return {
      ok: sameSides,
      note: sameSides
        ? `both sides reproduce from the judgement store (${again.disagreement.holds.length} hold, ${again.disagreement.fails.length} reject)`
        : 'the disagreement changed on recomputation',
    };
  }
  if (answer.state !== 'Answered') return { ok: true, note: 'nothing to recompute' };
  switch (question.type) {
    case 'Q1': {
      const again = HANDLERS.reading({ text: question.text, grammar: question.grammar }, ctx);
      if (again.state !== 'Answered') return { ok: false, note: `recompute gave ${again.state}` };
      const same = again.roles.agent === answer.roles.agent
        && again.roles.recipient === answer.roles.recipient && again.roles.theme === answer.roles.theme;
      return { ok: same, note: same ? 'roles reproduce' : 'roles differ on recomputation' };
    }
    case 'Q2': {
      const again = HANDLERS.comparison({ a: question.a, b: question.b, grammar: question.grammar }, ctx);
      if (again.state !== 'Answered') return { ok: false, note: `recompute gave ${again.state}` };
      return { ok: again.relation === answer.relation, note: 'relation reproduces' };
    }
    case 'Q3': {
      const missing = answer.refs.filter((r) => !r.present);
      return { ok: missing.length === 0, note: `${answer.refs.length} ref(s) resolved` };
    }
    case 'Q4': {
      const again = HANDLERS.counterfactual(
        { text: question.text, removeId: question.removeId, grammar: question.grammar }, ctx);
      if (again.state !== 'Answered') return { ok: false, note: `recompute gave ${again.state}` };
      return { ok: again.survivingRoleMappings === answer.survivingRoleMappings
        && again.changed === answer.changed, note: 'counterfactual reproduces' };
    }
    case 'Q5': {
      const again = HANDLERS.consistency({}, ctx);
      return { ok: again.state === 'Answered', note: 'consistency reproduces' };
    }
    case 'Q7': {
      // Recomputed from the store, never from the answer.
      const again = HANDLERS.judgement({ claim: question.claim }, ctx);
      if (again.state !== answer.state) return { ok: false, note: `recompute gave ${again.state}` };
      if (answer.state === 'Answered') {
        return { ok: again.verdict === answer.verdict, note: 'verdict reproduces from the judgement store' };
      }
      if (answer.state === 'Contested') {
        const same = again.disagreement.holds.length === answer.disagreement.holds.length
          && again.disagreement.fails.length === answer.disagreement.fails.length;
        return { ok: same, note: same ? 'both sides reproduce from the judgement store'
          : 'the sides changed on recomputation' };
      }
      return { ok: true, note: 'nothing to recompute' };
    }
    default:
      return { ok: true, note: 'no recomputation defined for this type' };
  }
}

// --------------------------------------------------------------------- ask()
export function ask(question, ctx, contract = loadContract()) {
  const handlerName = TYPE_TO_HANDLER[question?.type];
  let answer;
  if (!handlerName) {
    // I4: an undeclared question type is Refused, never answered by analogy.
    answer = refused(`question type ${JSON.stringify(question?.type)} is not declared in the contract (see notDeclared)`);
  } else {
    answer = HANDLERS[handlerName](question, ctx);
  }
  answer = { type: question?.type ?? null, ...answer };
  validateAnswer(answer, contract);
  const verification = verifyAnswer(question, answer, ctx);
  if (!verification.ok) {
    throw new Error(`I5 violated for ${question?.type}: ${verification.note}`);
  }
  return { ...answer, verified: verification };
}

// ----------------------------------------------------------------------- CLI
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const flag = (name, dflt = undefined) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : dflt;
  };
  const type = argv.find((a) => /^Q\d+$/.test(a));
  const question = {
    type,
    text: flag('text'),
    a: flag('a'),
    b: flag('b'),
    removeId: flag('removeId'),
    grammar: flag('grammar'),
  };
  if (flag('claim')) question.claim = JSON.parse(flag('claim'));
  if (flag('answer')) question.answer = JSON.parse(fs.readFileSync(flag('answer'), 'utf8'));
  const ctx = makeContext({ storePath: flag('store', DEFAULT_STORE) });
  const answer = ask(question, ctx);
  console.log(JSON.stringify(answer, null, 2));
  console.log(`\n[verified] ${answer.verified.note}`);
  // Exit codes per state, so scripts can branch without parsing text.
  // 0 Answered · 3 Unknown · 4 Refused/Inconsistent · 5 Contested
  const code = { Answered: 0, Unknown: 3, Refused: 4, Inconsistent: 4, Contested: 5 }[answer.state] ?? 6;
  process.exit(code);
}
