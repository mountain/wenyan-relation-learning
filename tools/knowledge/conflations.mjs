/**
 * Do the declared forbidden conflations actually hold?
 *
 *   node tools/knowledge/conflations.mjs [--json]
 *
 * Exit codes: 0 every checkable conflation holds; 1 a conflation was observed;
 *             2 Unknown — a required artifact could not be read, so the check has no
 *             basis and must not be reported as a pass.
 *
 * Six conflations are declared in knowledge/conflations.json, each with a witness from a
 * defect that actually occurred in this repository. This tool exists because declaring
 * them in a file would otherwise be decoration: C6 forbids 'the file says so' as a
 * substitute for 'the code obeys it', and C6 is checked here too.
 *
 * WHAT THIS TOOL DOES NOT DO
 *   - It does not prove the labels are linguistically right; C5 only proves no live
 *     record carries a span the declared admissibility rules refuse.
 *   - It does not check the v1 grammar's probe coverage (C2): relations.ts is a patch
 *     file and exports no construction list, so the declared set cannot be derived.
 *     That gap is REPORTED as unchecked rather than skipped silently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createTsLoader } from '../lib/tsload.mjs';
import { loadEvidence } from './store.mjs';
import { selectOperationalCore } from './projection.mjs';
import { inadmissibleReason } from '../grammar/admissibility.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const load = createTsLoader();
const reporting = load(path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/conflations.json'), 'utf8'));
const GRAMMAR_CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/grammar/contract.json'), 'utf8'));
const STORE = path.join(ROOT, 'knowledge/relations/evidence.jsonl');
const READINESS = path.join(ROOT, 'knowledge/relations/readiness.json');

const results = [];
const record = (id, ok, detail) => results.push({ id, ok, detail });

// ---------------------------------------------------------------- C1
// A record the grammar merely RECOGNISES must not reach the operational core. The check
// has teeth only if the same record WOULD be admitted without the consistency predicate,
// so both directions are asserted.
function checkC1() {
  const text = '子曰：「學而時習之。」';
  const good = { schema: 'wenyan.relations.reporting.v1', id: 'c1-good', grammar: 'wenyan.relations.reporting.v1',
    text, expected: { agent: '子', recipient: null, theme: '學而時習之。' },
    label: { kind: 'supervisor' }, source: { kind: 'authored' } };
  const bad = { ...good, id: 'c1-bad', expected: { agent: '王', recipient: null, theme: '學而時習之。' } };
  const records = [good, bad];
  const constructionOf = (t) => reporting.readReporting(t, reporting.emptyReportingModel()).construction ?? null;
  const recognised = records.filter((r) => constructionOf(r.text));
  const consistent = (r) => reporting.labelIsConsistent(r.text, r.expected);
  const withPredicate = selectOperationalCore(records, { grammar: 'wenyan.relations.reporting.v1', constructionOf, isConsistent: consistent });
  const withoutPredicate = selectOperationalCore(records, { grammar: 'wenyan.relations.reporting.v1', constructionOf });

  if (recognised.length !== 2) throw new Error('both records should be RECOGNISED, otherwise the check is vacuous');
  if (!withPredicate.outOfGrammar.includes('c1-bad')) {
    throw new Error('a record whose label the grammar refuses was ADMITTED to the core');
  }
  if (!withPredicate.model.examples.some((e) => e.id === 'c1-good')) {
    throw new Error('the admissible record was not admitted');
  }
  if (withoutPredicate.outOfGrammar.includes('c1-bad')) {
    throw new Error('without the predicate the bad record is already excluded — the check would prove nothing');
  }
  return 'a refused label is held out by isConsistent, and would have been admitted without it';
}

// ---------------------------------------------------------------- C2
// Every construction the grammar DECLARES must appear among the probed constructions.
function checkC2() {
  if (!fs.existsSync(READINESS)) {
    return { unknown: `no readiness report at ${path.relative(ROOT, READINESS)}; run readiness.mjs --write` };
  }
  const report = JSON.parse(fs.readFileSync(READINESS, 'utf8'));
  const probed = new Set((report.perConstruction ?? [])
    .filter((c) => c.grammar === reporting.REPORTING_GRAMMAR_ID).map((c) => c.construction));
  const declared = reporting.CONSTRUCTION_IDS;
  const missing = declared.filter((c) => !probed.has(c));
  if (missing.length) {
    throw new Error(`${missing.length} declared construction(s) were never probed: ${missing.join(', ')}`);
  }
  const v1Probed = new Set((report.perConstruction ?? [])
    .filter((c) => c.grammar === 'wenyan.relations.v1').map((c) => c.construction));
  return `reporting ${probed.size}/${declared.length} declared constructions probed; ` +
    `v1 probed ${v1Probed.size} but exports NO construction list, so its coverage is UNCHECKED ` +
    `(relations.ts is a patch file; adding an export would change the upstream deliverable)`;
}

// ---------------------------------------------------------------- C3
// A construction expressing fewer than three roles requires the missing-role contract.
function checkC3() {
  const partial = reporting.CONSTRUCTION_IDS.filter((c) => reporting.ROLES_FOR_CONSTRUCTION(c).length < 3);
  if (!partial.length) return 'no partial-role construction is declared, so no contract is required';
  const m = GRAMMAR_CONTRACT.missingRoleSemantics;
  if (!m || typeof m !== 'object') {
    throw new Error(`${partial.length} construction(s) express fewer than three roles (${partial.join(', ')}) ` +
      'but tools/grammar/contract.json has no missingRoleSemantics');
  }
  const required = ['statement', 'labelRule', 'replayRule', 'assertionRule', 'answerRule', 'comparisonRule'];
  const absent = required.filter((k) => !m[k]);
  if (absent.length) throw new Error(`missingRoleSemantics is incomplete: no ${absent.join(', ')}`);
  return `${partial.length} partial-role construction(s) (${partial.join(', ')}) are covered by a complete missingRoleSemantics`;
}

// ---------------------------------------------------------------- C4
// The reported permutation denominator must be the construction's own role-set size.
function checkC4() {
  if (!fs.existsSync(READINESS)) {
    return { unknown: `no readiness report at ${path.relative(ROOT, READINESS)}; run readiness.mjs --write` };
  }
  const report = JSON.parse(fs.readFileSync(READINESS, 'utf8'));
  const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));
  const wrong = [];
  for (const c of report.perConstruction ?? []) {
    if (c.grammar !== reporting.REPORTING_GRAMMAR_ID) continue;
    const expect = factorial(reporting.ROLES_FOR_CONSTRUCTION(c.construction).length);
    if (c.rolePermutations !== expect) {
      wrong.push(`${c.construction}: reported ${c.rolePermutations}, space is ${expect}`);
    }
  }
  if (wrong.length) throw new Error(`reported denominator differs from the permutation space — ${wrong.join('; ')}`);
  const twoSlot = (report.perConstruction ?? []).filter((c) => c.grammar === reporting.REPORTING_GRAMMAR_ID && c.rolePermutations === 2);
  return `all ${(report.perConstruction ?? []).filter((c) => c.grammar === reporting.REPORTING_GRAMMAR_ID).length} reporting constructions report their own space; ` +
    `${twoSlot.length} are two-slot (space 2, not 6)`;
}

// ---------------------------------------------------------------- C5
// No LIVE record may carry a span the declared admissibility rules refuse.
function checkC5() {
  // loadEvidence returns retractedIds as an ARRAY (it uses a Set internally). Coerce, so
  // the audit depends on the documented shape rather than on the internal one.
  const { records, allRecords, retractedIds } = loadEvidence(STORE);
  const retractedSet = new Set(retractedIds);
  const offenders = [];
  for (const r of records) {
    if (r.source?.kind !== 'corpus') continue;
    // The construction is the id's last colon-separated field (corpus:<work>:<passage>:<id>).
    const construction = String(r.id).split(':').pop();
    const roles = reporting.CONSTRUCTION_IDS.includes(construction)
      ? reporting.ROLES_FOR_CONSTRUCTION(construction) : ['agent', 'recipient', 'theme'];
    for (const role of ['agent', 'recipient']) {
      if (!roles.includes(role)) continue;
      const why = inadmissibleReason(role, r.expected?.[role]);
      if (why) offenders.push(`${r.id}: ${why}`);
    }
  }
  if (offenders.length) {
    throw new Error(`${offenders.length} live record(s) assert an inadmissible span:\n      ` + offenders.join('\n      '));
  }
  const retracted = allRecords.filter((r) => retractedSet.has(r.id)).length;
  return `${records.length} live record(s) clean; ${retracted} retracted record(s) kept in the log as history ` +
    '(a retracted record stops licensing answers but is not deleted)';
}

// ---------------------------------------------------------------- C6
// Every declaration must have an implementation and vice versa.
function checkC6() {
  const declared = new Set(REGISTRY.conflations.map((c) => c.id));
  const implemented = new Set(Object.keys(CHECKS));
  const noImpl = [...declared].filter((id) => !implemented.has(id));
  const noDecl = [...implemented].filter((id) => !declared.has(id));
  if (noImpl.length) throw new Error(`declared but not enforced: ${noImpl.join(', ')}`);
  if (noDecl.length) throw new Error(`enforced but not declared: ${noDecl.join(', ')}`);

  // Declarations in the CONTRACTS must reference ids that exist here, so a contract
  // cannot forbid something this tool has never heard of.
  // Both trees are scanned. The patch-owned experiments/relations/contract.json is NOT
  // edited this round: it is part of the upstream deliverable, and changing it would force
  // a patch regeneration in the same commit as a new feature. Recorded as an open item.
  const contractFiles = ['tools', 'experiments'].flatMap((tree) =>
    fs.readdirSync(path.join(ROOT, tree))
      .map((d) => path.join(ROOT, tree, d, 'contract.json'))
      .filter((f) => fs.existsSync(f)));
  const dangling = [];
  let referenced = 0;
  for (const f of contractFiles) {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const entry of c.forbidden_conflations ?? []) {
      // Entries are plain strings led by their id (Adva's shape), e.g. "C1 recognising a
      // construction is not accepting its label"; an object form is accepted too.
      const id = typeof entry === 'string' ? entry.trim().split(/[\s:—–-]/)[0] : entry.id;
      referenced++;
      if (!declared.has(id)) dangling.push(`${path.relative(ROOT, f)} -> ${id}`);
    }
  }
  if (dangling.length) throw new Error(`contracts name undeclared conflations: ${dangling.join(', ')}`);
  return `${declared.size} conflation(s) declared and enforced 1:1; ${referenced} reference(s) from ` +
    `${contractFiles.length} contract(s) all resolve (tools/ and experiments/)`;
}

const CHECKS = { C1: checkC1, C2: checkC2, C3: checkC3, C4: checkC4, C5: checkC5, C6: checkC6 };
if (process.argv.includes('--write')) {
  // The readiness report is a derived artifact and this tool reads it; refreshing it here
  // keeps the check from passing on a report that predates the grammar it is checking.
  execFileSync(process.execPath, [path.join(HERE, 'readiness.mjs'), '--write'], { stdio: 'ignore' });
}

let failed = 0;
let unknown = 0;
for (const c of REGISTRY.conflations) {
  const fn = CHECKS[c.id];
  if (!fn) { record(c.id, false, 'no implementation'); failed++; continue; }
  try {
    const out = fn();
    if (out && typeof out === 'object' && out.unknown) { record(c.id, null, out.unknown); unknown++; }
    else record(c.id, true, out);
  } catch (e) {
    record(c.id, false, e.message);
    failed++;
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ schema: 'wenyan.conflations.report.v1', results }, null, 2));
} else {
  console.log(`[conflations] registry=${path.relative(ROOT, 'knowledge/conflations.json')} declared=${REGISTRY.conflations.length}`);
  for (const c of REGISTRY.conflations) {
    const r = results.find((x) => x.id === c.id);
    const mark = r.ok === true ? 'ok  ' : r.ok === null ? 'UNKN' : 'FAIL';
    console.log(`  ${mark} ${c.id} ${c.forbidden}`);
    console.log(`       ${r.detail}`);
  }
  console.log(`\n[conflations] ${results.filter((r) => r.ok === true).length} hold, ${failed} violated, ${unknown} unchecked`);
}
process.exit(failed ? 1 : unknown ? 2 : 0);
