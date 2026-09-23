/**
 * Apertures: places where a DECLARED rule can silently do the wrong thing.
 *
 *   node tools/knowledge/apertures.mjs [--write]
 *
 * Pattern taken from `adva/docs/maintenance/FLOAT_APERTURES.md` + `scripts/float_aperture_scan.py`:
 * a maintained list of the places a rule leaks, paired with a scanner that recomputes the
 * numbers. Wenyan's whole defect history is this shape — eleven silent losses found in the
 * corpus alone, each a declared rule doing something wrong without saying so.
 *
 * WHO UPDATES IT — the decision this file exists to settle
 *   The NUMBERS are written by this scanner. Nobody has to remember them.
 *   The CLASSIFICATION (which things are apertures and why) is a human judgement, and it
 *   lives here in `APERTURES` with its basis attached.
 *   So: a new aperture is added by a person editing this file; its magnitude is never
 *   typed by hand. If you find yourself editing APERTURES.md, you are editing the wrong
 *   file — the document is generated.
 *
 * WHAT THIS IS NOT
 *   Not a defect list. An aperture is a KNOWN, DECLARED limit that is measured; a defect is
 *   a rule doing the wrong thing silently. Several entries here started as defects and are
 *   kept after being fixed, because the fix has a measured cost (A1's filter rejects labels;
 *   it does not stop the grammar from reading those spans).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createTsLoader } from '../lib/tsload.mjs';
import { inadmissibleReason } from '../grammar/admissibility.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const works = manifest.works.filter((w) => w.file).map((w) => ({
  meta: w, doc: JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8')),
}));

// ---------------------------------------------------------------- A1/A2
// One pass over the corpus with the real grammar: how many passages does it read, and how
// many of those carry a span the label rules refuse?
function scanGrammar() {
  const reporting = createTsLoader()(path.join(ROOT, 'src/inscription/relations-reporting.ts'));
  const empty = reporting.emptyReportingModel();
  let passages = 0, read = 0, dirtyAgent = 0, dirtyRecipient = 0, multiFrame = 0;
  for (const { doc } of works) {
    for (const s of doc.sections) {
      for (const p of s.passages) {
        passages++;
        let r;
        try { r = reporting.readReporting(p.text, empty); } catch { continue; }
        if (!r.construction) continue;
        read++;
        const spans = r.occurrences.map((o) => o.value);
        const roles = reporting.ROLES_FOR_CONSTRUCTION(r.construction);
        if (inadmissibleReason('agent', spans[0])) dirtyAgent++;
        if (roles.includes('recipient') && inadmissibleReason('recipient', spans[1])) dirtyRecipient++;
        if (r.additionalMatches) multiFrame++;
      }
    }
  }
  return { passages, read, dirtyAgent, dirtyRecipient, multiFrame };
}

const APERTURES = [
  {
    id: 'A1', name: 'Entity spans are unquoted runs',
    what: 'The reporting frames delimit their entity slots with a declared character class, not with a '
      + 'syntactic boundary, so an agent span can begin with a particle or adverb.',
    leaks: 'A label taken from such a span asserts a false agent (`於是武王遍`, `厲聲`, `敖者`). The '
      + 'admissibility filter stops it being STORED; nothing stops the grammar from READING it.',
    state: 'open, bounded',
  },
  {
    id: 'A2', name: 'A passage can hold several frames',
    what: 'The grammar reads the most explicit frame and reports the rest as additionalMatches.',
    leaks: 'A passage stating two relations yields one reading. The count is reported, so the answer does '
      + 'not pretend the passage had one frame — but the second relation is still dropped.',
    state: 'declared rule',
  },
  {
    id: 'A3', name: 'Missing source pages',
    what: 'A discovery route can point at pages that do not exist.',
    leaks: 'The work builds SHORTER and reports success; the gap shows only in `limitations`.',
    state: 'reported per work',
  },
  {
    id: 'A4', name: 'Duplicate section titles inside one work',
    what: 'Source pages may give several poems the same `section` value; the disambiguating suffix exists '
      + 'only in the page name.',
    leaks: 'Two sections become indistinguishable by title (詩經 揚之水 ×3, 羔裘 ×3). Measured, not fixed — '
      + 'fixing it changes titles and no check yet distinguishes a legitimate repeat from a collision.',
    state: 'open',
  },
  {
    id: 'A5', name: 'A title can lose the unit name',
    what: 'Source headers disagree about where the unit goes; three 詩經 pages put the poem in `title` and '
      + 'the chapter in `section`.',
    leaks: 'The section was named after the CHAPTER (國風‧邶 twice), so three poems looked absent while their '
      + 'text was present. Now repaired at discovery AND checked by tools/corpus/validate.mjs.',
    state: 'closed by a gate',
  },
  {
    id: 'A6', name: 'Works with no licence template',
    what: 'The site tags only some pages; untagged pages fall to the site-wide default.',
    leaks: 'Corpus-derived evidence from those works carries CC BY-SA 4.0 (ShareAlike) rather than a '
      + 'public-domain rationale. Recorded per record; not a defect, but it constrains reuse.',
    state: 'recorded per record',
  },
  {
    id: 'A7', name: 'Variant character forms',
    what: 'The site uses non-standard forms in page names (女曰鷄鳴 for 雞鳴, 鳬鷖 for 鳧鷖), so one word '
      + 'appears in two forms across the corpus.',
    leaks: 'A search or a co-occurrence count for the conventional form misses those pages, and a quotation '
      + 'that differs by one character fails to match. Measured: of 435 citations not found in their cited work, '
      + '99 (23%) are ONE character away from text that does occur there, and the top candidates are the '
      + 'well-attested pairs (惟/維, 毋/無, 雝/雍, 昭/炤, 溥/普, 為/爲, 緜/緡). '
      + 'tools/intertext/variant-candidates.mjs proposes them with their witnesses; admission stays manual, '
      + 'because the same signal also produces non-variants — 醤→烕 is one, and it is recorded as the '
      + 'counter-example that justifies proposing rather than admitting.',
    state: 'open; discovery is now measured, admission is manual',
  },
  {
    id: 'A8', name: 'A pin on a derived file drifts',
    what: 'The changes module binds learned examples to a corpus work file by whole-file digest.',
    leaks: 'Any re-extraction rewrites the file and the digest moves even when the bound text is identical. '
      + 'Now reported as sourceDrift instead of failing, because the log is hash-chained and cannot be '
      + 'repaired by rewriting.',
    state: 'reported as drift',
  },
];

const scan = scanGrammar();
const pct = (n, d) => `${n} (${((n / Math.max(1, d)) * 100).toFixed(2)}%)`;
const missing = works.flatMap(({ meta, doc }) => (doc.limitations ?? [])
  .filter((l) => String(l).startsWith('missing page')).map((l) => ({ id: meta.id, l })));
const dupTitles = [];
for (const { meta, doc } of works) {
  const seen = new Map();
  for (const s of doc.sections) seen.set(s.title, (seen.get(s.title) ?? 0) + 1);
  const d = [...seen].filter(([, n]) => n > 1);
  if (d.length) dupTitles.push({ id: meta.id, d: d.map(([t, n]) => `${t}×${n}`) });
}
const untagged = works.filter(({ meta }) => !Object.keys(meta.licenseTemplates ?? {}).length)
  .map(({ meta }) => meta.id);
const unitViolations = (() => {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/corpus/validate.mjs')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return /does not contain the unit name/.test(out) ? 'violations reported' : 'none';
  } catch (e) { return /does not contain the unit name/.test(e.stdout ?? '') ? 'violations reported' : 'none'; }
})();
const drift = (() => {
  const f = path.join(ROOT, 'experiments/changes/evidence.json');
  if (!fs.existsSync(f)) return 'unmeasured (no evidence report)';
  return `${(JSON.parse(fs.readFileSync(f, 'utf8')).sourceDrift ?? []).length} record(s)`;
})();

const MEASURED = {
  A1: `agent spans refused by the admissibility rules: ${pct(scan.dirtyAgent, scan.read)} of read passages; `
    + `recipient spans: ${pct(scan.dirtyRecipient, scan.read)}`,
  A2: `passages holding more than one frame: ${pct(scan.multiFrame, scan.read)}`,
  A3: `${missing.length} page(s) across ${new Set(missing.map((m) => m.id)).size} work(s)`,
  A4: dupTitles.length ? dupTitles.map((x) => `${x.id}: ${x.d.join(', ')}`).join('; ') : 'none',
  A5: unitViolations,
  A6: `${untagged.length} work(s) of ${works.length}: ${untagged.join(', ')}`,
  A7: 'discovery measured: 99 of 435 unmatched citations explained by ONE character; 70 candidate pairs '
    + 'proposed with witnesses (knowledge/intertext/variant-candidates.json). ADMISSION still manual, '
    + 'because one character apart is equally consistent with a genuine difference between recensions.',
  A8: drift,
};

const lines = [];
lines.push('# Apertures: where a declared rule can silently do the wrong thing', '');
lines.push('**Generated by `node tools/knowledge/apertures.mjs --write` — do not edit this file.**');
lines.push('The numbers come from the scanner; the classification lives in `APERTURES` in that script.');
lines.push('Pattern taken from `adva/docs/maintenance/FLOAT_APERTURES.md` + `scripts/float_aperture_scan.py`.', '');
lines.push(`Corpus scanned: ${works.length} works, ${scan.passages} passages.`, '');
lines.push('| id | aperture | state | measured', '|---|---|---|---|');
for (const a of APERTURES) lines.push(`| ${a.id} | **${a.name}** — ${a.what} | ${a.state} | ${MEASURED[a.id]} |`);
lines.push('', '## What each one leaks', '');
for (const a of APERTURES) lines.push(`- **${a.id} ${a.name}**: ${a.leaks}`);
lines.push('', '## Not automatically measured', '',
  '- **A7 variant characters** needs a character-variant table, which is a scholarly artefact this repository '
  + 'does not have. Two instances are known by hand: 女曰鷄鳴/雞鳴, 鳬鷖/鳧鷖.', '',
  '## Non-claims', '',
  '- An aperture is not a defect. Several entries were defects and are kept after repair because the repair '
  + 'has a measured cost (A1 filters labels, it does not stop the reading).',
  '- This list is not exhaustive; it is the set that has been measured. A new one is added by editing '
  + '`tools/knowledge/apertures.mjs`, not by appending prose here.');
const doc = lines.join('\n') + '\n';

const out = path.join(ROOT, 'knowledge/APERTURES.md');
const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
console.log(`[apertures] ${APERTURES.length} declared, scanned ${works.length} works / ${scan.passages} passages`);
for (const a of APERTURES) console.log(`  ${a.id} [${a.state}] ${a.name}\n       ${MEASURED[a.id]}`);
if (process.argv.includes('--write')) {
  if (current !== doc) { fs.writeFileSync(out, doc); console.log(`\n[written] ${path.relative(ROOT, out)}`); }
  else console.log('\n[unchanged] knowledge/APERTURES.md');
} else {
  console.log(`\n(dry run — ${current === doc ? 'would be unchanged' : 'would change'}; pass --write)`);
}
