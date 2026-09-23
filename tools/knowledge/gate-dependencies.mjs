/**
 * Which gate must be re-derived when what changes?
 *
 *   node tools/knowledge/gate-dependencies.mjs                 # print the map
 *   node tools/knowledge/gate-dependencies.mjs --since <rev>    # gates affected by a change
 *   node tools/knowledge/gate-dependencies.mjs --paths a b      # gates affected by named paths
 *
 * WHY THIS EXISTS
 * readiness.mjs already says, in a comment above G7/G8, that "a gate must be re-derived
 * from the workspace, not remembered from the day it was written" — a statement written
 * because G7's text ("no dialogue contract exists") was true when written and false
 * afterwards. The comment states the rule; this file is the mechanism. Adva keeps the same
 * thing as a first-class field: every claim in docs/claims.toml carries `dependencies`,
 * and docs/RESEARCH_ENGINEERING_AGENDA.md calls itself a "durable research backlog and
 * dependency map".
 *
 * Three kinds of edge, kept apart because they are not the same relation:
 *
 *   READS     gate -> gate it reads through. G3 is computed over the operational core, so
 *             a broken core makes G3's accuracy meaningless rather than false.
 *   TRIGGERS  artifact -> gates that must be re-derived when that artifact changes. This is
 *             the actionable one: it answers "I just rebuilt the corpus, what is now stale?"
 *   REOPEN    a non-monotone edge. Adding contradicting evidence can raise survivors above 1
 *             and re-open G2, which re-opens the gates computed from it. Maturity is not
 *             monotone — a fact this project found by measurement, not by reasoning.
 *
 * NO GATE MAY BE UNDECLARED, and no edge may point at a gate that does not exist. A gate
 * added to readiness.mjs without a row here is a loud failure, because an undeclared gate
 * silently looks permanent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

export const GATE_IDS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'];

/** gate -> gates it reads through (a broken dependency makes it MEANINGLESS, not false). */
export const READS = {
  G1: [],
  G2: ['G1'],          // the operational core is projected from the store
  G3: ['G2'],          // leave-one-out is computed over the core G2 determines
  G4: ['G1'],          // failing closed needs a store that replays
  G5: [],              // counts passages, not evidence: it never touches the store
  G6: ['G1'],          // hash and source verification read the store
  G7: [],              // reads contract files only
  G8: ['G1', 'G2'],    // the dialogue pipeline builds its model from the store
  G9: ['G1', 'G2'],    // the partition identity is over the projection
};

/** artifact (path prefix) -> gates that must be re-derived when it changes. */
export const TRIGGERS = [
  { artifact: 'data/corpus/', gates: ['G5', 'G6', 'G8'],
    why: 'coverage denominators and source verification both move with the corpus; the dialogue rate is measured over it' },
  { artifact: 'knowledge/relations/evidence.jsonl', gates: ['G1', 'G2', 'G3', 'G6', 'G8', 'G9'],
    why: 'the store is what every reading gate is a statement about' },
  { artifact: 'src/inscription/relations', gates: ['G2', 'G3', 'G4', 'G5', 'G8'],
    why: 'the grammar defines what a construction is, so every mapping and coverage claim follows it' },
  { artifact: 'tools/grammar/contract.json', gates: ['G7'],
    why: 'declared rules and the missing-role contract' },
  { artifact: 'tools/dialogue/', gates: ['G7', 'G8'],
    why: 'the contract and the answerability measurement' },
  { artifact: 'knowledge/dialogue/readiness.json', gates: ['G8'],
    why: 'G8 reads this report directly; a stale report is a stale gate' },
  { artifact: 'knowledge/grammar/measurement.json', gates: ['G5'],
    why: 'the measured reach figures' },
  { artifact: 'tools/corpus/', gates: ['G5', 'G6'],
    why: 'the build and its validators determine what the corpus contains' },
];

/** Non-monotone edges: a change that RE-OPENS a gate that was passing. */
export const REOPEN = [
  { via: 'contradicting evidence appended to the store', reopens: ['G2', 'G3', 'G9'],
    why: 'survivors can rise above 1 again; the harness exercises this in knowledge/selftest.mjs' },
  { via: 'a construction added to the grammar', reopens: ['G2', 'G3', 'G5'],
    why: 'a new construction needs its own evidence, its own probe, and moves coverage — measured '
      + 'when three two-slot constructions were added and G2 re-opened on all three' },
  { via: 'the upstream base moving under wenyan-relations.patch', reopens: [],
    why: 'not a gate: it re-opens tools/relations/rebuild-patch.mjs, which has its own refusal path' },
];

export function affectedBy(changedPaths) {
  const hit = new Map();
  for (const p of changedPaths) {
    for (const t of TRIGGERS) {
      if (p === t.artifact || p.startsWith(t.artifact)) {
        for (const g of t.gates) {
          if (!hit.has(g)) hit.set(g, []);
          hit.get(g).push(`${t.artifact} (${t.why})`);
        }
      }
    }
  }
  return hit;
}

function selfCheck() {
  for (const id of GATE_IDS) {
    if (!(id in READS)) throw new Error(`gate ${id} has no READS row — an undeclared gate looks permanent`);
  }
  for (const [g, deps] of Object.entries(READS)) {
    if (!GATE_IDS.includes(g)) throw new Error(`READS names unknown gate ${g}`);
    for (const d of deps) if (!GATE_IDS.includes(d)) throw new Error(`${g} depends on unknown gate ${d}`);
  }
  for (const t of TRIGGERS) for (const g of t.gates) {
    if (!GATE_IDS.includes(g)) throw new Error(`TRIGGERS names unknown gate ${g}`);
  }
  for (const r of REOPEN) for (const g of r.reopens) {
    if (!GATE_IDS.includes(g)) throw new Error(`REOPEN names unknown gate ${g}`);
  }
  // The gate list must match readiness.mjs, or this map describes a different suite.
  const src = fs.readFileSync(path.join(ROOT, 'tools/knowledge/readiness.mjs'), 'utf8');
  const declared = new Set([...src.matchAll(/gate\('(G\d)'/g)].map((m) => m[1]));
  const missing = [...declared].filter((g) => !GATE_IDS.includes(g));
  const extra = GATE_IDS.filter((g) => !declared.has(g));
  if (missing.length || extra.length) {
    throw new Error(`gate list differs from readiness.mjs — only there: ${missing.join(',') || 'none'}; ` +
      `only here: ${extra.join(',') || 'none'}`);
  }
}

selfCheck();

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const since = flag('since');

if (since) {
  const changed = execFileSync('git', ['diff', '--name-only', `${since}..HEAD`], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const hit = affectedBy(changed);
  console.log(`[gate-deps] ${changed.length} path(s) changed since ${since}`);
  if (!hit.size) console.log('  no declared trigger fired — no gate needs re-derivation');
  for (const [g, whys] of [...hit].sort()) console.log(`  ${g} must be re-derived — because ${whys[0]}`);
} else {
  console.log('[gate-deps] READS — a broken dependency makes the gate meaningless, not false');
  for (const [g, deps] of Object.entries(READS)) console.log(`  ${g} <- ${deps.join(', ') || '(nothing)'}`);
  console.log('\n[gate-deps] TRIGGERS — what to re-derive when an artifact changes');
  for (const t of TRIGGERS) console.log(`  ${t.artifact.padEnd(38)} -> ${t.gates.join(', ')}`);
  console.log('\n[gate-deps] REOPEN — non-monotone: a passing gate can be re-opened');
  for (const r of REOPEN) {
    console.log(`  ${r.via}`);
    console.log(`      re-opens ${r.reopens.join(', ') || '(no gate)'}`);
    console.log(`      ${r.why}`);
  }
  console.log(`\n[gate-deps] self-check ok: ${GATE_IDS.length} gates, ${TRIGGERS.length} triggers, ` +
    `${REOPEN.length} reopen edges; the gate list matches readiness.mjs`);
}
