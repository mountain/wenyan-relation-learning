import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contractPath = resolve(root, 'experiments/relations/adva-interface-selection-v0.1.json');
const expectedCommit = '1b9bd090b2c4710916b6a0ccca0ad88fb7d323bd';
const expectedTree = 'bc5774f1e810bf95a66cfa09ffc89bd5a8a91831';

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
  requireCondition(contract.scope.exhaustive_history_search === false, 'bounded search overstated');

  const receipt = contract.input_receipt;
  requireCondition(receipt.commit === '86c5295d01d126dec02f12f009f4cf3fbab0db17', 'receipt commit drift');
  requireCondition(receipt.contract_git_blob === '97950fffbddd19de987f13b9c97f4b1e680aeccd', 'receipt contract blob drift');
  requireCondition(receipt.evidence_git_blob === 'e52d65dd961dc476b096b712a450bd0617b180b1', 'receipt evidence blob drift');
  requireCondition(receipt.checker_git_blob === '367baf1a6729c6220c0522c3a61135c8d1826c5b', 'receipt checker blob drift');
  requireCondition(receipt.required_status === 'DocumentaryAccepted', 'receipt status escalation');

  const required = [
    'exact learner implementation and version',
    'task and observer identity',
    'supervision source and train/holdout isolation',
    'work, time and evidence budgets',
    'Accepted, Refuted, Unknown and NotRun transitions',
    'failure and partial-evidence retention',
    'independent output verifier',
    'receiving-side invocation and update authority'
  ];
  equalArray(contract.required_interface_fields, required, 'required interface fields drift');

  requireCondition(Array.isArray(contract.candidates) && contract.candidates.length === 2, 'candidate inventory drift');
  const byId = new Map(contract.candidates.map(candidate => [candidate.id, candidate]));
  requireCondition(byId.size === 2, 'duplicate candidate id');

  const f7 = byId.get('adva-external-f7-quadratic-v0');
  requireCondition(f7?.classification === 'ExecutableExternalCalibration', 'F7 classification drift');
  requireCondition(f7.implementation.path === 'experiments/finite_learner/calibration.py', 'F7 implementation path drift');
  requireCondition(f7.implementation.git_blob === 'b59d9d9d26fd0a3a64e9516b61bdba24b512384e', 'F7 implementation blob drift');
  requireCondition(f7.implementation.declared_version === 'external-f7-quadratic-v0', 'F7 version drift');
  requireCondition(f7.boundary_note.git_blob === 'cdea6309c7004822f7c5f28ccdb7c5a26ba89bfe', 'F7 boundary note drift');
  requireCondition(f7.eligible === false, 'F7 candidate must remain ineligible');
  requireCondition(f7.blockers.length === 5, 'F7 blocker set drift');

  const relation = byId.get('adva-six-relation-queries-arrangement-v0');
  requireCondition(relation?.classification === 'RelatedPreparationOnlyProposal', 'relation proposal classification drift');
  requireCondition(relation.plan.git_blob === 'f1f29b8795e3e3624e02f99eb4b041aa05c2ef6e', 'relation plan blob drift');
  requireCondition(relation.reconciliation.git_blob === 'd4706eb919cee4e199fde0a763dcc9472357c481', 'relation reconciliation blob drift');
  requireCondition(relation.plan.status === 'PreparationOnly', 'relation proposal status drift');
  requireCondition(relation.plan.frozen === false && relation.plan.implemented === false && relation.plan.run_ready === false, 'unimplemented proposal promoted');
  requireCondition(relation.plan.campaign_runs === 0 && relation.plan.g0 === 'Open', 'relation run state drift');
  equalArray(relation.plan.experiment_statuses, Array(6).fill('NotRun'), 'relation experiment status drift');
  requireCondition(relation.eligible === false, 'relation proposal must remain ineligible');
  requireCondition(relation.blockers.length === 6, 'relation proposal blocker set drift');

  requireCondition(contract.semantic_scope.git_blob === '1d255f47cc9c9c68206cb818ed74d387e537a5fc', 'semantic scope blob drift');
  requireCondition(contract.selection.selected_candidate === null, 'candidate selected without a new contract');
  requireCondition(contract.selection.invocation_status === 'NotRun', 'learner invocation falsely claimed');
  requireCondition(contract.selection.write_authority === false, 'write authority escalation');
  requireCondition(contract.selection.native_admission === false, 'native admission escalation');
  requireCondition(contract.next_gate.status === 'Blocked', 'blocked gate falsely closed');
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
    ['Adva commit drift', value => { value.scope.commit = '0'.repeat(40); }],
    ['relation plan blob drift', value => { value.candidates[1].plan.git_blob = '0'.repeat(40); }],
    ['receipt promotion', value => { value.input_receipt.required_status = 'NativeAccepted'; }],
    ['invented invocation', value => { value.selection.invocation_status = 'Accepted'; }],
    ['native admission', value => { value.selection.native_admission = true; }],
    ['write authority', value => { value.selection.write_authority = true; }],
    ['gate closure', value => { value.next_gate.status = 'Satisfied'; }]
  ];
  for (const [label, mutate] of controls) expectRejected(contract, mutate, label);
  receipt.negative_controls = controls.length;
}

console.log(JSON.stringify(receipt));
