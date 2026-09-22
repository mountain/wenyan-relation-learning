/**
 * First semantic fixture: the Lu Xun passage, with recorded judgements.
 *
 *   node tools/semantics/seed-luxun.mjs [--store path]
 *
 * WHY THE PASSAGE IS THE FIXTURE
 * It carries a genuine disgreement rather than a manufactured one: 「他们」 has
 * two plural antecedents in the same short passage (我的怨敌 and 新式的人), and
 * both readings are defensible from the text. That is what Contested exists for —
 * not a corrupted store, but a real text on which judges may differ.
 *
 * HONESTY ABOUT AUTHORITY
 * Every judgement here is a DECLARED READING by this session with a stated basis.
 * It is not a scholarly consensus and carries no authority beyond that; the
 * semantic contract says so in its nonclaims, and each record names its judge.
 * The passage is a user-supplied quotation and its attribution is NOT verified
 * in this workspace — that is recorded on each judgement's evidence.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeJudgment, appendJudgment, loadJudgments, storeSummary } from './lib/judgments.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const argv = process.argv.slice(2);
const storePath = (() => {
  const i = argv.indexOf('--store');
  return i >= 0 ? path.resolve(argv[i + 1]) : path.join(ROOT, 'knowledge/semantics/judgments.jsonl');
})();

const TEXT = '我的怨敌可谓多矣，倘有新式的人问起我来，怎么回答呢？我想了一想，决定的是：让他们怨恨去，我也一个都不宽恕。';
const AT = new Date().toISOString();
const JUDGE = 'tools/semantics/seed-luxun.mjs (declared reading, DSH agent session)';
const TEXT_SOURCE = {
  attribution: 'quoted by the user from Lu Xun\'s prose; attribution NOT verified in this workspace',
  verified: false,
};

const records = [];
const add = (claim, verdict, basis, extra = {}) => records.push(makeJudgment({
  claim: { text: TEXT, ...claim },
  verdict,
  judge: { kind: 'declared-reading', by: JUDGE, at: AT, basis },
  evidence: { textSource: TEXT_SOURCE, ...(extra.evidence ?? {}) },
  note: extra.note ?? null,
}));

// ---------------------------------------------------------------- coreference
// Uncontroversial: the three 我 all belong to the same speaker.
add({ type: 'coreference', span: '我', link: '我的' }, 'holds',
  'The first person never shifts: no quotation and no change of speaker intervenes, so 我 in 我想了一想 is the same 我 as in 我的怨敌.');

// THE CONTESTED ONE — two defensible readings, so this claim is Contested.
add({ type: 'coreference', span: '他们', link: '我的怨敌' }, 'holds',
  'Nearest-antecedent reading: 我的怨敌 is the first plural NP of the passage and 怨恨 continues its 怨; 让他们怨恨去 then reads "let my enemies go on hating".');
add({ type: 'coreference', span: '他们', link: '我的怨敌' }, 'fails',
  'Discourse-topic reading: 新式的人 is the plural NP in the immediately preceding clause and supplies the questioner of the passage; 让他们怨恨去 then reads "let those who ask me hate me", which fits a passage about how to answer questioners.');

// ------------------------------------------------------------------ 构式义
add({ type: 'construction-meaning', span: '一个都不宽恕', form: '一个都不+V', meaning: 'universal negation (not a single one)' },
  'holds',
  'The form is attested as universal negation in the classical layer (一…不… in 122 of 8208 corpus passages) and carries the same force here: the scope is every member, not one member.');

// --------------------------------------------------------------- speech act
add({ type: 'speech-act', span: '决定的是：让他们怨恨去，我也一个都不宽恕', act: 'decision' },
  'holds',
  'RESTRICTED to what the text marks: 决定的是： explicitly announces the content that follows as what the speaker decided. No inference about tone or intent is involved.');

// --------------------------------------------- layer-to-layer sense relation
add({ type: 'layer-sense-relation', word: '恕', layerA: '先秦（wenyan.corpus.v1）', layerB: '現代白話（本句用法）', relation: 'sense-shift' },
  'holds',
  'Classical 恕 is a virtue of self-extension — 禮記: 忠恕違道不遠。施諸己而不願，亦勿施於人 — attested in 14 corpus passages; the modern word 寬恕/宽恕 denotes forgiving an offender and is attested in 0 corpus passages, so the two-syllable form is later. The character is continuous; the sense and the wordhood are not.');

// A claim deliberately left unjudged, so Q7 returns Unknown rather than guessing.
const unjudgedClaim = {
  text: TEXT, type: 'construction-meaning',
  span: '可謂多矣', form: '可謂…矣', meaning: 'assessment of degree (classical-flavoured)',
};

// ------------------------------------------------------------------- persist
let appended = 0;
let skipped = 0;
for (const r of records) {
  const res = appendJudgment(storePath, r);
  if (res.appended) appended++; else skipped++;
}

const { records: all, issues } = loadJudgments(storePath);
const summary = storeSummary(all);

console.log(`[semantics] store ${path.relative(ROOT, storePath)}`);
console.log(`  appended ${appended}, already present ${skipped}, total ${all.length}`);
console.log(`  issues: ${issues.length}`);
console.log(`\n  claims ${summary.claims}: Answered ${summary.Answered ?? 0}, Contested ${summary.Contested ?? 0}`);
for (const [t, v] of Object.entries(summary.byType)) {
  console.log(`    ${t.padEnd(22)} claims ${v.claims}, contested ${v.Contested}`);
}
console.log(`\n  contested claims (this is a finding, not a defect):`);
for (const c of summary.conceded) console.log(`    ${c.type}: ${c.reason}`);
console.log(`\n  left unjudged on purpose (Q7 must return Unknown):`);
console.log(`    construction-meaning 可謂…矣`);
