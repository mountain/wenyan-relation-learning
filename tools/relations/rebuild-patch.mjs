/**
 * Re-anchor wenyan-relations.patch onto the declared upstream commit.
 *
 *   node tools/relations/rebuild-patch.mjs [--upstream <path>] [--write]
 *
 * WHY THIS EXISTS
 *   The patch is a FILE deliverable pinned to an upstream commit. Upstream's
 *   inscription pipeline and this deliverable both add an optional field to the SAME
 *   two types and a spread at the SAME return site, so a collision is not bad luck —
 *   it is the expected outcome of two lines of work adding opt-in capabilities to one
 *   pipeline. Measured once already: upstream's `2377c2c` (merged as `bcd05ba`) added
 *   `changes?: { catalog }` exactly where this patch adds `relationModel`, and the
 *   `6143e22`-based patch stopped applying.
 *
 *   The first re-anchoring was done ad hoc from a scratch script that was deleted, which
 *   made the operation unrepeatable. This file is that procedure, written down.
 *
 * WHAT IT DOES NOT DO
 *   It does not decide the base. `BASE` below is DECLARED and checked: if the upstream
 *   clone is not at that commit the tool refuses to run rather than silently producing a
 *   patch against some other tree. Moving the base is a deliberate edit of this file.
 *
 *   It does not verify the deliverable's correctness — only that the patch reproduces
 *   the working tree from the declared base. Four checks are run and reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

/** The declared upstream commitment this patch is re-anchored to. */
export const BASE = 'bcd05ba';

/**
 * The commit that DELIVERED these files upstream. Once the relations line went into PR #717,
 * the patch stopped being the delivery and became a REPRODUCTION BUNDLE: its base is the
 * delivery commit's PARENT, which is no longer the branch head. So the base check below asks
 * whether BASE is an ANCESTOR of origin/master, not whether it equals it — and check 5 asks
 * whether the delivered commit's blobs still match this repository's files.
 */
export const DELIVERED_AS = 'dbe3294';
export const DEFAULT_UPSTREAM = '/Users/mingli/Adva/mingli-wenyan';

/**
 * The seven sections, in the order the patch has always carried them.
 * `modified` files are diffed against the base tree; `added` files do not exist upstream.
 */
const SECTIONS = [
  { file: 'src/inscription/pipeline.ts', kind: 'modified' },
  { file: 'src/inscription/reverse.ts', kind: 'modified' },
  { file: 'src/inscription/relations.ts', kind: 'added' },
  { file: 'experiments/relations/contract.json', kind: 'added' },
  { file: 'experiments/relations/run.cjs', kind: 'added' },
  { file: 'experiments/relations/evidence.json', kind: 'added' },
  { file: 'experiments/relations/README.md', kind: 'added' },
];

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const upstream = path.resolve(flag('upstream', DEFAULT_UPSTREAM));
const write = argv.includes('--write');
const gitDir = path.join(upstream, '.git');
const git = (...args) => execFileSync('git', [`--git-dir=${gitDir}`, ...args], { encoding: 'utf8' });

if (!fs.existsSync(gitDir)) {
  console.error(`[rebuild-patch] no upstream clone at ${upstream}`);
  process.exit(2);
}

// ---------------------------------------------------------------- base check
// Every refusal below must be a NAMED refusal. A first version let the `git rev-parse`
// throw when the repository simply did not contain the declared commit, so pointing the
// tool at the wrong clone printed a stack trace and exit 1 instead of the intended
// message and exit 2 — a guard whose failure mode is a crash is not a guard.
function revParse(rev) {
  try {
    return execFileSync('git', [`--git-dir=${gitDir}`, 'rev-parse', '--short', rev],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

const head = revParse(BASE);
if (!head) {
  console.error(`[rebuild-patch] upstream at ${upstream} has no commit ${BASE}.`);
  console.error('  Point --upstream at the clone that carries the declared base (or edit BASE deliberately).');
  process.exit(2);
}
const master = revParse('origin/master');
if (!master) {
  console.error(`[rebuild-patch] upstream at ${upstream} has no origin/master to compare against.`);
  process.exit(2);
}
// ANCESTOR, not equality. Before delivery the base WAS the branch head; after delivery the
// base is the delivery commit's parent and the head has moved past it. Requiring equality
// would refuse to run the moment the work was delivered — which is precisely what happened.
const isAncestor = (() => {
  try {
    execFileSync('git', [`--git-dir=${gitDir}`, 'merge-base', '--is-ancestor', BASE, 'origin/master'],
      { stdio: 'pipe' });
    return true;
  } catch { return false; }
})();
if (!isAncestor) {
  console.error(`[rebuild-patch] DECLARED BASE ${BASE} is not an ancestor of origin/master (${master}).`);
  console.error('  The base is declared, not discovered: update BASE in this file deliberately,');
  console.error('  then re-run. A patch silently re-anchored to a moving branch is not pinned.');
  process.exit(2);
}

// ---------------------------------------------------------------- generate
/** `diff` exits 1 when the files DIFFER — the normal case for a patch. Only >1 is an error. */
const diffOrThrow = (args) => {
  try {
    return execFileSync('diff', args, { encoding: 'utf8' });
  } catch (e) {
    if (e.status === 1 && typeof e.stdout === 'string') return e.stdout;
    throw e;
  }
};

const section = (s) => {
  const mine = path.join(ROOT, s.file);
  if (!fs.existsSync(mine)) throw new Error(`working tree is missing ${s.file}`);
  if (s.kind === 'modified') {
    const base = execFileSync('git', [`--git-dir=${gitDir}`, 'show', `${BASE}:${s.file}`], { encoding: 'utf8' });
    const tmp = path.join(ROOT, 'tmp', `.base-${path.basename(s.file)}`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, base);
    return diffOrThrow(['-u', '--label', `a/${s.file}`, '--label', `b/${s.file}`, tmp, mine]);
  }
  return diffOrThrow(['-u', '--label', '/dev/null', '--label', `b/${s.file}`, '/dev/null', mine]);
};

let patch;
try {
  patch = SECTIONS.map(section).join('');
} finally {
  for (const f of fs.readdirSync(path.join(ROOT, 'tmp')).filter((x) => x.startsWith('.base-'))) {
    fs.rmSync(path.join(ROOT, 'tmp', f), { force: true });
  }
}

const target = path.join(ROOT, 'wenyan-relations.patch');
const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
const identical = current === patch;
console.log(`[rebuild-patch] base=${BASE} upstream=${upstream}`);
console.log(`  sections: ${SECTIONS.length}  bytes: ${patch.length}`);
console.log(`  ${identical ? 'IDENTICAL to the patch on disk' : 'DIFFERS from the patch on disk'}`);

if (write && !identical) {
  fs.writeFileSync(target, patch);
  console.log(`  [written] ${path.relative(ROOT, target)}`);
}

// ---------------------------------------------------------------- four checks
const tmpTree = path.join(ROOT, 'tmp', 'rebuild-check');
fs.rmSync(tmpTree, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpTree, 'src/inscription'), { recursive: true });
for (const s of SECTIONS) {
  if (s.kind !== 'modified') continue;
  fs.writeFileSync(path.join(tmpTree, s.file),
    execFileSync('git', [`--git-dir=${gitDir}`, 'show', `${BASE}:${s.file}`], { encoding: 'utf8' }));
}
const results = [];
const run = (name, fn) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, detail: e.message }); } };

run('git apply --check against the base tree', () => {
  execFileSync('git', ['apply', '--check', target], { cwd: tmpTree, stdio: 'pipe' });
});
run('patch(1) --dry-run', () => {
  execFileSync('patch', ['-p1', '--dry-run', '--silent'], { cwd: tmpTree, input: patch, stdio: ['pipe', 'pipe', 'pipe'] });
});
run('applying reproduces the working tree byte-for-byte', () => {
  execFileSync('patch', ['-p1', '--silent'], { cwd: tmpTree, input: patch, stdio: ['pipe', 'pipe', 'pipe'] });
  const wrong = SECTIONS.filter((s) => !fs.readFileSync(path.join(tmpTree, s.file))
    .equals(fs.readFileSync(path.join(ROOT, s.file)))).map((s) => s.file);
  if (wrong.length) throw new Error(`differ after applying: ${wrong.join(', ')}`);
});
run('git apply --check -R in this repository', () => {
  execFileSync('git', ['apply', '--check', '-R', 'wenyan-relations.patch'], { cwd: ROOT, stdio: 'pipe' });
});

run(`the delivered commit ${DELIVERED_AS} still matches this repository`, () => {
  const out = [];
  for (const s of SECTIONS) {
    const blob = execFileSync('git', [`--git-dir=${gitDir}`, 'show', `${DELIVERED_AS}:${s.file}`],
      { encoding: 'buffer' });
    if (!Buffer.from(blob).equals(fs.readFileSync(path.join(ROOT, s.file)))) out.push(s.file);
  }
  if (out.length) throw new Error(`differ from ${DELIVERED_AS}: ${out.join(', ')}`);
});

for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
fs.rmSync(tmpTree, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok).length;
if (failed) {
  console.error(`\n[rebuild-patch] ${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\n[rebuild-patch] ${results.length}/${results.length} checks pass — this repository equals ${BASE} + the patch, `
  + `and equals the delivered commit ${DELIVERED_AS}`);
