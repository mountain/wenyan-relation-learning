/**
 * Is the intertext relation set still true of the corpus it was derived from?
 *
 *   node tools/intertext/verify.mjs [--json]
 *
 * Exit: 0 no drift; 1 drift observed; 2 the corpus or the record set could not be read —
 *       Unknown must not share an output with a pass.
 *
 * WHY
 * `knowledge/intertext/citations.jsonl` was an orphan: the extractor wrote it and nothing
 * ever checked it again, so after any corpus rebuild it would have gone on asserting a
 * status that no longer held — and this session has already produced one stale number that
 * was reported for several rounds (G8's denominator, caught by the gate-dependency map).
 *
 * So the set is made RE-DERIVABLE, the way the evidence store is: every record's status is
 * recomputed from the corpus and compared with what was recorded. The comparison is by
 * TEXT, following `verifySources()` in tools/knowledge/store.mjs — a passage id is a
 * position, and a rebuild that inserts a section moves every id after it, so an id-based
 * check would report drift where nothing changed.
 *
 * WHAT A PASS MEANS
 *   The recorded status still matches a fresh derivation. It does NOT mean the citation is
 *   accurate, that the host meant that work, or that one work influenced another — those
 *   are disclaimed in tools/intertext/README.md and are not testable here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');
const RECORDS = path.join(ROOT, 'knowledge/intertext/citations.jsonl');

if (!fs.existsSync(RECORDS)) {
  console.error(`[intertext:verify] no record set at ${path.relative(ROOT, RECORDS)} — run extract.mjs --write first`);
  process.exit(2);
}
if (!fs.existsSync(path.join(CORPUS, 'manifest.json'))) {
  console.error('[intertext:verify] no corpus to verify against');
  process.exit(2);
}

const variants = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/intertext/variants.json'), 'utf8')).accepted;
const conventions = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/intertext/conventions.json'), 'utf8')).declared;
const norm = (t) => {
  let s = String(t).replace(/[\s，。；：、！？「」『』（）()《》〈》·—…"'']/g, '');
  for (const v of variants) s = s.split(v.from).join(v.to);
  return s;
};

const works = new Map();
for (const w of JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8')).works) {
  if (!w.file) continue;
  works.set(w.id, JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8')));
}
const normCache = new Map();
const normedWork = (id) => {
  if (normCache.has(id)) return normCache.get(id);
  const doc = works.get(id);
  const rows = doc ? doc.sections.flatMap((s) => s.passages.map((p) => ({ section: s.id, passageId: p.id, text: p.text, n: norm(p.text) }))) : [];
  normCache.set(id, rows);
  return rows;
};
const hostText = (r) => {
  const doc = works.get(r.host.work);
  if (!doc) return null;
  for (const s of doc.sections) for (const p of s.passages) if (p.id === r.host.passageId) return p.text;
  return null;
};

// A variant entry whose `from` character NEVER occurs in the corpus cannot fire, so it is dead
// weight and now a loud failure rather than a silent zero.
//
// WHAT THIS CHECK DOES NOT CATCH — recorded because its negative control failed. It was written
// to catch the mistake that actually happened (惟→维 recorded as a rejected pair with gain 0,
// while the intended pair 惟/維 measures +17), and it does NOT catch it: 维 occurs 35 times
// corpus-wide, just never in 詩經. A `from` character being absent everywhere is a stricter
// condition than being absent where the pair would have to fire. Detecting the real case needs
// per-work counts (`维` 0 in 詩經 against `維` 260) and a judgement about which work the pair is
// for — that is a report, not a guard, and it is not implemented here rather than pretended.
const corpusText = [...works.values()].flatMap((d) => d.sections.flatMap((s) => s.passages.map((p) => p.text))).join('');
const inert = variants.filter((v) => !corpusText.includes(v.from));
if (inert.length) {
  console.error(`[intertext:verify] ${inert.length} variant entry(ies) can never fire — their \`from\` character ` +
    `does not occur in the corpus: ${inert.map((v) => `${v.from}→${v.to}`).join(', ')}. ` +
    'Either the entry is dead weight or its form is mistyped.');
  process.exit(1);
}

const records = fs.readFileSync(RECORDS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const drift = [];
let ok = 0;

/** Recompute the status a record WOULD get now, from the corpus alone. */
function rederive(r) {
  const text = hostText(r);
  if (text === null) return { status: 'host-passage-gone' };
  if (!r.quote) return { status: 'no-quotation-follows' };
  const doc = r.citedWork ? works.get(r.citedWork) : null;
  if (!doc) return { status: 'cited-work-not-in-corpus' };
  const q = norm(r.quote);
  if (q.length < 4) return { status: 'quotation-too-short-to-verify' };
  const found = normedWork(r.citedWork).find((x) => x.n.includes(q));
  const base = found ? 'found-in-cited-work' : 'not-found-in-cited-work';
  if (r.status === 'by-declared-convention') {
    const declared = conventions.some((c) => c.host === r.host.work && c.marker === r.marker);
    return { status: declared ? 'by-declared-convention' : 'convention-no-longer-declared', found };
  }
  return { status: base, found };
}

for (const r of records) {
  const now = rederive(r);
  if (now.status === r.status) { ok++; continue; }
  drift.push({ host: `${r.host.work}:${r.host.passageId}`, marker: r.marker, cited: r.citedName,
    recorded: r.status, now: now.status });
}

const summary = {
  schema: 'wenyan.intertext.verification.v1',
  records: records.length, unchanged: ok, drift: drift.length,
  ...(drift.length ? { drifts: drift.slice(0, 20) } : {}),
};
if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`[intertext:verify] ${records.length} record(s); ${ok} reproduce, ${drift.length} drifted`);
  for (const d of drift.slice(0, 12)) console.log(`  ${d.host} ${d.marker} → ${d.cited}: ${d.recorded} became ${d.now}`);
  if (drift.length > 12) console.log(`  … and ${drift.length - 12} more`);
  if (!drift.length) console.log('  every recorded status is re-derived from the corpus, matched by TEXT');
}
process.exit(drift.length ? 1 : 0);
