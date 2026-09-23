/**
 * Propose FRAMES from the passages the grammar cannot read.
 *
 *   node tools/relations/discover-frames.mjs [--top N] [--min-count M]
 *
 * THE LOOP THIS IS THE FIRST STEP OF
 * A question the system cannot answer is not a dead end — it is a work item. `ask.mjs` already
 * says why it could not answer, and for 77.57% of this corpus the reason is a single string:
 * `outside-declared-grammar`, whose `missing` field reads "a declared grammar in which this text
 * is in-grammar". That is a queue. This tool reads the queue and proposes what to declare next.
 *
 * HOW IT PROPOSES (and why it is not a guess)
 * It does NOT invent frames. It counts recurring n-grams in the unread passages, keeps those that
 * contain a ROLE MARKER — a character that delimits an argument rather than merely joining
 * clauses (曰 delimit a quotation, 以 marks a theme, 於/于 marks a recipient, 之 marks a
 * pronominal slot) — and reports each candidate with the count it would unlock and the contexts
 * it came from. A human then decides whether a SEGMENTATION RULE exists for it, which is the
 * criterion the whole grammar rests on: this project refuses frames whose slots can only be
 * guessed (the unmarked ditransitive, 23.81% of the corpus, is excluded for exactly that reason).
 *
 * WHAT IT DOES NOT DO
 *   It does not declare anything, measure a witness set, or judge admissibility. Those are the
 *   next steps of the loop, and each already has a tool (seed-reporting.mjs finds admissible
 *   witnesses; measure.mjs measures reach; the contract declares).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const TOP = flag('top', 30);
const MIN_COUNT = flag('min-count', 40);

/** A role marker delimits an argument; a mere connector does not. Declared, not learned. */
const MARKERS = {
  曰: 'quotation', 云: 'quotation', 謂: 'speech-to', 問: 'speech-to', 告: 'speech-to', 語: 'speech-to',
  以: 'theme-marker', 於: 'recipient-marker', 于: 'recipient-marker', 之: 'pronominal-slot',
  與: 'comitative-or-transfer', 為: 'benefactive-or-copula', 受: 'reception', 得: 'reception',
  使: 'causative', 令: 'causative', 賜: 'transfer', 獻: 'transfer', 遣: 'dispatch', 召: 'summons',
};

const reporting = createTsLoader()(path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const empty = reporting.emptyReportingModel();

const works = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8')).works.filter((w) => w.file);
const unread = [];
let passages = 0, read = 0;
for (const w of works) {
  const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
  for (const s of doc.sections) {
    for (const p of s.passages) {
      passages++;
      let ok = false;
      try { ok = !!reporting.readReporting(p.text, empty).construction; } catch { /* unreadable */ }
      if (ok) { read++; continue; }
      if ([...p.text].length >= 12) unread.push({ work: w.id, passageId: p.id, text: p.text });
    }
  }
}

/** Count n-grams of length 2..3 in the unread set, keeping only those carrying a marker. */
const grams = new Map();
for (const u of unread) {
  const seen = new Set();
  const chars = [...u.text];
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= chars.length; i++) {
      const g = chars.slice(i, i + n).join('');
      if (![...g].some((c) => MARKERS[c])) continue;
      if (!/^[\u4e00-\u9fff]+$/.test(g)) continue;
      if (seen.has(g)) continue;
      seen.add(g);
      if (!grams.has(g)) grams.set(g, { gram: g, count: 0, works: new Set(), examples: [] });
      const e = grams.get(g);
      e.count++; e.works.add(u.work);
      if (e.examples.length < 2) e.examples.push({ work: u.work, passageId: u.passageId, text: u.text.slice(0, 60) });
    }
  }
}

const ranked = [...grams.values()].filter((e) => e.count >= MIN_COUNT)
  .sort((a, b) => b.count - a.count).slice(0, TOP)
  .map((e) => ({ gram: e.gram, unreadPassagesContainingIt: e.count, worksSpanned: e.works.size,
    markers: [...new Set([...e.gram].filter((c) => MARKERS[c]))].map((c) => `${c}=${MARKERS[c]}`),
    examples: e.examples }));

console.log(`[frames] corpus ${passages} passages; readable ${read} (${(read / passages * 100).toFixed(2)}%); `
  + `UNREAD ${unread.length} — the queue this tool reads`);
console.log(`[frames] ${ranked.length} candidate(s) with a role marker, appearing in >= ${MIN_COUNT} unread passages\n`);
for (const c of ranked.slice(0, 20)) {
  console.log(`  「${c.gram}」 ${c.unreadPassagesContainingIt} 段 / 跨 ${c.worksSpanned} 部   ${c.markers.join(' ')}`);
  console.log(`      ${c.examples[0].work}:${c.examples[0].passageId}  ${c.examples[0].text.replace(/\n/g, ' ')}`);
}
console.log('\n[frames] 这一步只提议。下一步各自已有工具：找可采纳见证 = tools/grammar/seed-reporting.mjs；');
console.log('         测可达率 = tools/grammar/measure.mjs；声明 = tools/grammar/contract.json + 帧表。');
if (process.argv.includes('--write')) {
  fs.mkdirSync(path.join(ROOT, 'knowledge/relations'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'knowledge/relations/frame-candidates.json'),
    JSON.stringify({ schema: 'wenyan.relations.frame-candidates.v1',
      method: 'recurring 2-3 character n-grams carrying a ROLE MARKER, counted over passages the current '
        + 'grammar cannot read; a candidate is a proposal, and whether a SEGMENTATION RULE exists for it is '
        + 'the human decision the grammar rests on',
      corpus: { passages, readable: read, unread: unread.length }, candidates: ranked }, null, 2) + '\n');
  console.log('[written] knowledge/relations/frame-candidates.json');
}
