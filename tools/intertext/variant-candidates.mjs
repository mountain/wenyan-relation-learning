/**
 * Propose variant-character pairs, with witnesses. Admission stays manual.
 *
 *   node tools/intertext/variant-candidates.mjs [--write] [--max-witnesses N]
 *
 * THE PROBLEM THIS SOLVES
 * `knowledge/APERTURES.md` A7 records that variant character forms hide citations, and that the
 * table in variants.json is hand-built: "how to find an UNKNOWN pair" was left open, because no
 * one can enumerate character variants by hand.
 *
 * THE LEVER THIS USES
 * This corpus has something a variant dictionary does not need to supply: 861 MARKED citations.
 * Where a host says `《詩》曰：X` and X is one character away from text that occurs in 詩經, the
 * differing character is a candidate pair AND the citation is its witness. So the marked
 * citations become the test-bed, and discovery stops being guesswork.
 *
 * IT PROPOSES; IT DOES NOT ADMIT
 * A one-character difference is NOT proof of a variant. It is equally consistent with a genuine
 * textual difference between recensions — a real reading, not an orthographic variant — and this
 * tool cannot tell those apart. So the output is a ranked list of CANDIDATES with their witnesses
 * and their explanatory power, and `variants.json` keeps its admission rule (same word, written
 * two ways; never a phonetic loan) under human judgement. Loosely analogous to
 * tools/corpus/resolve-routes.mjs: propose, record why, leave the rest to a person.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const MAX_WITNESSES = flag('max-witnesses', 3);

const records = fs.readFileSync(path.join(ROOT, 'knowledge/intertext/citations.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
const accepted = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge/intertext/variants.json'), 'utf8')).accepted;

/** Normalise exactly as the extractor does, so a candidate is not an artefact of punctuation. */
const norm = (t) => {
  let s = String(t).replace(/[\s，。；：、！？「」『』（）()《》〈〉·—…"']/g, '');
  for (const v of accepted) s = s.split(v.from).join(v.to);
  return s;
};

const works = new Map();
for (const w of JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8')).works) {
  if (!w.file) continue;
  works.set(w.id, JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8')));
}

/** Passages of a cited work, normalised, with a 6-gram index so the scan stays bounded. */
const cache = new Map();
function indexOf(id) {
  if (cache.has(id)) return cache.get(id);
  const doc = works.get(id);
  const rows = [];
  if (doc) {
    for (const s of doc.sections) {
      for (const p of s.passages) rows.push({ section: s.id, passageId: p.id, n: norm(p.text) });
    }
  }
  const grams = new Map();
  for (const r of rows) {
    for (let i = 0; i + 6 <= r.n.length; i++) {
      const g = r.n.slice(i, i + 6);
      if (!grams.has(g)) grams.set(g, []);
      grams.get(g).push(r);
    }
  }
  const out = { rows, grams };
  cache.set(id, out);
  return out;
}

/** The single-character difference that would make `quote` occur in `passage`, if there is one. */
function oneEdit(quote, passage) {
  if (quote.length > passage.length) return null;
  for (let i = 0; i + quote.length <= passage.length; i++) {
    const win = passage.slice(i, i + quote.length);
    if (win === quote) return null;            // already matches; not a variant candidate
    let diff = -1, count = 0;
    for (let j = 0; j < quote.length; j++) {
      if (win[j] !== quote[j]) { count++; diff = j; if (count > 1) break; }
    }
    if (count === 1) {
      return { hostChar: quote[diff], sourceChar: win[diff], at: diff, window: win,
        section: null, passageId: null, offset: i };
    }
  }
  return null;
}

const candidates = new Map();
let scanned = 0, explained = 0;
for (const r of records) {
  if (r.status !== 'not-found-in-cited-work' || !r.citedWork || !r.quote) continue;
  const q = norm(r.quote);
  if (q.length < 6) continue;
  scanned++;
  const idx = indexOf(r.citedWork);
  // Candidate passages share at least one 6-gram with the quote.
  const see = new Set();
  for (let i = 0; i + 6 <= q.length; i++) for (const row of idx.grams.get(q.slice(i, i + 6)) ?? []) see.add(row);
  let hit = null;
  for (const row of see) {
    const e = oneEdit(q, row.n);
    if (e) { hit = { ...e, section: row.section, passageId: row.passageId }; break; }
  }
  if (!hit) continue;
  explained++;
  const key = `${hit.hostChar}→${hit.sourceChar}`;
  if (!candidates.has(key)) candidates.set(key, { hostChar: hit.hostChar, sourceChar: hit.sourceChar, count: 0, witnesses: [] });
  const c = candidates.get(key);
  c.count++;
  if (c.witnesses.length < MAX_WITNESSES) {
    c.witnesses.push({ host: `${r.host.work}:${r.host.passageId}`, cited: r.citedWork,
      quote: r.quote.slice(0, 40), sourceWindow: hit.window.slice(0, 40),
      sourceAt: { section: hit.section, passageId: hit.passageId } });
  }
}

const ranked = [...candidates.values()].sort((a, b) => b.count - a.count);
const doc = {
  schema: 'wenyan.intertext.variant-candidates.v1',
  method: 'a marked citation that is ONE character away from text in the cited work; the differing '
    + 'character is the candidate and the citation is its witness',
  statusOfTheseEntries: 'CANDIDATES, not variants. A one-character difference is equally consistent with '
    + 'a genuine difference between recensions, and this tool cannot tell the two apart. Admission into '
    + 'knowledge/intertext/variants.json stays under the rule stated there (same word written two ways, '
    + 'never a phonetic loan) and under human judgement.',
  scannedNotYetMatched: scanned,
  explainedByOneEdit: explained,
  candidates: ranked,
};
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(ROOT, 'knowledge/intertext/variant-candidates.json'),
    JSON.stringify(doc, null, 2) + '\n');
}
console.log(`[variant-candidates] ${scanned} unmatched citation(s) scanned; ${explained} explained by ONE character`);
console.log(`[variant-candidates] ${ranked.length} candidate pair(s), ranked by how many citations each explains:`);
for (const c of ranked.slice(0, 12)) {
  console.log(`  ${c.hostChar}→${c.sourceChar}  explains ${c.count}`);
  for (const w of c.witnesses.slice(0, 2)) console.log(`      ${w.host} → ${w.cited}: ${w.sourceWindow}`);
}
if (!ranked.length) console.log('  (none — no unmatched citation is one character from its cited work)');
if (process.argv.includes('--write')) console.log('\n[written] knowledge/intertext/variant-candidates.json');
