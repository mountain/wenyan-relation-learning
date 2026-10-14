import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contractPath = resolve(root, 'experiments/relations/adva-interface-selection-v0.1.json');
const expectedCommit = '1b9bd090b2c4710916b6a0ccca0ad88fb7d323bd';
const expectedTree = 'bc5774f1e810bf95a66cfa09ffc89bd5a8a91831';
const expectedMethod = 'Current-main code search for learner and relation candidates, followed by source inspection of the two closest interfaces';
const expectedSelectionReason = 'Neither inspected candidate satisfies the required interface and authority fields';
const expectedMinimumAction = 'A receiving-side maintainer must select or implement one exact learner interface and freeze every required interface field before any invocation';
const requiredFields = [
  'exact learner implementation and version',
  'task and observer identity',
  'supervision source and train/holdout isolation',
  'work, time and evidence budgets',
  'Accepted, Refuted, Unknown and NotRun transitions',
  'failure and partial-evidence retention',
  'independent output verifier',
  'receiving-side invocation and update authority'
];
const f7Blockers = [
  'fixed F7 quadratic grammar rather than the Wenyan transfer-relation grammar',
  'accepts arithmetic task and trial records, not DocumentaryAccepted relation receipts',
  'declares external finite model with no native Adva types, identities or commands',
  'supplied substitution and fixed-family reuse do not authorize cross-task adaptation',
  'no receiving-side authority for this evidence or state update'
];
const relationBlockers = [
  'implementation contract is not frozen',
  'relation, checker and supervisor are not implemented',
  'task split, features, algorithms, accounting and environment hashes remain unset',
  'all six experiments are NotRun',
  'external F5 relation-query task is not an adapter for the Wenyan receipt',
  'no native admission or receiving-side invocation authority'
];

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function equalArray(actual, expected, message) {
  requireCondition(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function check(contract) {
  requireCondition(contract.schema === 'wenyan.relation-learning.adva-interface-selection.v0', 'schema drift');
  requireCondition(contract.date === '2026-10-11', 'audit date drift');
  requireCondition(contract.status === 'NoEligibleInterfaceInBoundedInventory', 'selection status drift');
  requireCondition(contract.scope.repository === 'mountain/adva', 'source repository drift');
  requireCondition(contract.scope.branch === 'main', 'source branch drift');
  requireCondition(contract.scope.commit === expectedCommit, 'source commit drift');
  requireCondition(contract.scope.tree === expectedTree, 'source tree drift');
  requireCondition(contract.scope.method === expectedMethod, 'inventory method drift');
  requireCondition(contract.scope.exhaustive_history_search === false, 'bounded search overstated');

  const receipt = contract.input_receipt;
  requireCondition(receipt.repository === 'mountain/wenyan-relation-learning', 'receipt repository drift');
  requireCondition(receipt.commit === '86c5295d01d126dec02f12f009f4cf3fbab0db17', 'receipt commit drift');
  requireCondition(receipt.contract_path === 'experiments/relations/receiving-contract-v0.1.json', 'receipt contract path drift');
  requireCondition(receipt.contract_git_blob === '97950fffbddd19de987f13b9c97f4b1e680aeccd', 'receipt contract blob drift');
  requireCondition(receipt.evidence_path === 'experiments/relations/evidence.replay-2026-10-09.json', 'receipt evidence path drift');
  requireCondition(receipt.evidence_git_blob === 'e52d65dd961dc476b096b712a450bd0617b180b1', 'receipt evidence blob drift');
  requireCondition(receipt.checker_path === 'tools/relations/check-receiving-contract.mjs', 'receipt checker path drift');
  requireCondition(receipt.checker_git_blob === '367baf1a6729c6220c0522c3a61135c8d1826c5b', 'receipt checker blob drift');
  requireCondition(receipt.required_status === 'DocumentaryAccepted', 'receipt status escalation');
  equalArray(contract.required_interface_fields, requiredFields, 'required interface fields drift');

  requireCondition(Array.isArray(contract.candidates) && contract.candidates.length === 2, 'candidate inventory drift');
  const byId = new Map(contract.candidates.map(candidate => [candidate.id, candidate]));
  requireCondition(byId.size === 2, 'duplicate candidate id');

  const f7 = byId.get('adva-external-f7-quadratic-v0');
  requireCondition(f7?.classification === 'ExecutableExternalCalibration', 'F7 classification drift');
  requireCondition(f7.implementation.path === 'experiments/finite_learner/calibration.py', 'F7 implementation path drift');
  requireCondition(f7.implementation.git_blob === 'b59d9d9d26fd0a3a64e9516b61bdba24b512384e', 'F7 implementation blob drift');
  requireCondition(f7.implementation.declared_version === 'external-f7-quadratic-v0', 'F7 version drift');
  requireCondition(f7.boundary_note.path === 'docs/research/0131-finite-learner-judgment-and-reuse.md', 'F7 boundary note path drift');
  requireCondition(f7.boundary_note.git_blob === 'cdea6309c7004822f7c5f28ccdb7c5a26ba89bfe', 'F7 boundary note blob drift');
  requireCondition(f7.eligible === false, 'F7 candidate must remain ineligible');
  equalArray(f7.blockers, f7Blockers, 'F7 blocker set drift');

  const relation = byId.get('adva-six-relation-queries-arrangement-v0');
  requireCondition(relation?.classification === 'RelatedPreparationOnlyProposal', 'relation proposal classification drift');
  requireCondition(relation.plan.path === 'experiments/six_relation_queries/plan.json', 'relation plan path drift');
  requireCondition(relation.plan.git_blob === 'f1f29b8795e3e3624e02f99eb4b041aa05c2ef6e', 'relation plan blob drift');
  requireCondition(relation.reconciliation.path === 'experiments/six_relation_queries/SOURCE_RECONCILIATION.md', 'relation reconciliation path drift');
  requireCondition(relation.reconciliation.git_blob === 'd4706eb919cee4e199fde0a763dcc9472357c481', 'relation reconciliation blob drift');
  requireCondition(relation.plan.status === 'PreparationOnly', 'relation proposal status drift');
  requireCondition(relation.plan.frozen === false && relation.plan.implemented === false && relation.plan.run_ready === false, 'unimplemented proposal promoted');
  requireCondition(relation.plan.campaign_runs === 0 && relation.plan.g0 === 'Open', 'relation run state drift');
  equalArray(relation.plan.experiment_statuses, Array(6).fill('NotRun'), 'relation experiment status drift');
  requireCondition(relation.eligible === false, 'relation proposal must remain ineligible');
  equalArray(relation.blockers, relationBlockers, 'relation proposal blocker set drift');

  requireCondition(contract.semantic_scope.path === 'docs/SEMANTIC_SCOPE.md', 'semantic scope path drift');
  requireCondition(contract.semantic_scope.git_blob === '1d255f47cc9c9c68206cb818ed74d387e537a5fc', 'semantic scope blob drift');
  requireCondition(contract.semantic_scope.current_boundary === 'No stable learner or general convergence detector is installed', 'semantic boundary drift');
  requireCondition(contract.selection.selected_candidate === null, 'candidate selected without a new contract');
  requireCondition(contract.selection.invocation_status === 'NotRun', 'learner invocation falsely claimed');
  requireCondition(contract.selection.write_authority === false, 'write authority escalation');
  requireCondition(contract.selection.native_admission === false, 'native admission escalation');
  requireCondition(contract.selection.reason === expectedSelectionReason, 'selection reason drift');
  requireCondition(contract.next_gate.status === 'Blocked', 'blocked gate falsely closed');
  requireCondition(contract.next_gate.minimum_action === expectedMinimumAction, 'minimum action drift');
  requireCondition(contract.next_gate.may_reuse_documentary_receipt_as_input_precondition === true, 'receipt precondition removed');
  requireCondition(contract.next_gate.may_treat_receipt_as_native_admission === false, 'receipt promoted to native admission');

  return {
    schema: contract.schema,
    status: contract.status,
    inspected_candidates: contract.candidates.length,
    invocation_status: contract.selection.invocation_status,
    native_admission: contract.selection.native_admission
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectRejected(base, mutate, label) {
  const changed = clone(base);
  mutate(changed);
  let rejected = false;
  try { check(changed); } catch { rejected = true; }
  requireCondition(rejected, `negative control accepted: ${label}`);
}

const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const receipt = check(contract);

if (process.argv.includes('--selftest')) {
  const controls = [
    ['status promotion', value => { value.status = 'EligibleInterfaceSelected'; }],
    ['silent selection', value => { value.selection.selected_candidate = value.candidates[0].id; }],
    ['F7 eligibility', value => { value.candidates[0].eligible = true; }],
    ['F7 blocker deletion', value => { value.candidates[0].blockers.pop(); }],
    ['F7 blocker substitution', value => { value.candidates[0].blockers[0] = 'none'; }],
    ['relation blocker substitution', value => { value.candidates[1].blockers[0] = 'none'; }],
    ['Adva commit drift', value => { value.scope.commit = '0'.repeat(40); }],
    ['inventory method drift', value => { value.scope.method = 'all history searched'; }],
    ['relation plan path drift', value => { value.candidates[1].plan.path = 'README.md'; }],
    ['relation plan blob drift', value => { value.candidates[1].plan.git_blob = '0'.repeat(40); }],
    ['F7 boundary path drift', value => { value.candidates[0].boundary_note.path = 'README.md'; }],
    ['receipt repository drift', value => { value.input_receipt.repository = 'other/repository'; }],
    ['receipt contract path drift', value => { value.input_receipt.contract_path = 'README.md'; }],
    ['receipt promotion', value => { value.input_receipt.required_status = 'NativeAccepted'; }],
    ['semantic boundary drift', value => { value.semantic_scope.current_boundary = 'stable learner installed'; }],
    ['selection reason drift', value => { value.selection.reason = 'eligible'; }],
    ['invented invocation', value => { value.selection.invocation_status = 'Accepted'; }],
    ['native admission', value => { value.selection.native_admission = true; }],
    ['write authority', value => { value.selection.write_authority = true; }],
    ['gate action drift', value => { value.next_gate.minimum_action = 'invoke now'; }]
  ];
  for (const [label, mutate] of controls) expectRejected(contract, mutate, label);
  receipt.negative_controls = controls.length;
}

console.log(JSON.stringify(receipt));
