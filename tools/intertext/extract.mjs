/**
 * Intertextual relations: where one work in this corpus CITES another.
 *
 *   node tools/intertext/extract.mjs [--write]
 *
 * WHY THIS IS EVIDENCE-BOUND RATHER THAN A SEARCH
 *   A quotation is a textual relation, and this repository's rule is that a relation is
 *   reported with the thing it was derived from. So a citation record carries: the host
 *   passage, the marker that announced the citation, the quoted span, and the result of
 *   looking that span up in the CITED work's own text in this corpus. "《詩》曰：X" and "X
 *   occurs in 詩經" are two different facts, and they are recorded as two.
 *
 * THE DETECTOR'S OWN FALSE POSITIVES, MEASURED BEFORE THE TOOL WAS WRITTEN
 *   A first, naive marker regex `(《|「)?(詩|書|易|禮|春秋|論語|孝經|爾雅)(》|」)?\s*(曰|云)`
 *   reported 12,501 citations. Sampling showed four classes of contamination, every one of
 *   them a real sentence that is not a citation:
 *
 *     遺羽書曰 / 遺章邯書曰 / 遺項王書曰   a LETTER (書 = letter), not 尚書
 *     自為詩曰：「力拔山兮氣蓋世」          COMPOSING a poem, not citing 詩經
 *     范曄《後漢書》曰                     matched on 「書》曰」 inside 後漢書
 *     諸稱書、不書…書曰之類               a term of art in 春秋 exegesis
 *
 *   Hence the strict rule: the bracketed form `《詩》曰` only. That gives 861. The unbracketed
 *   forms (824) are a HOST-RELATIVE CONVENTION and are listed separately, not silently
 *   dropped: in 左傳 「書曰」 means 春秋, while elsewhere 「詩云」 may be a line of verse the
 *   author is composing. Which of them is a citation cannot be decided from the marker alone,
 *   so they are reported as unresolved rather than counted or discarded.
 *
 * WHAT A RECORD DOES NOT CLAIM
 *   A match says the host's quoted text also occurs in the cited work here. It does NOT say
 *   the citation is accurate, that the host meant that source, or that one work influenced
 *   the other: classical citations are frequently paraphrased, and 逸詩 (lines quoted but
 *   absent from the received 詩經) are expected and were found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

/** The work each cited name refers to IN THIS CORPUS, if it is here at all. */
const CITED = {
  詩: 'classic-of-poetry', 書: 'book-of-documents', 易: 'zhouyi', 禮: 'book-of-rites',
  周禮: '周禮', 儀禮: 'yili', 春秋: '春秋經', 左傳: 'zuozhuan', 國語: '國語',
  論語: 'analects', 孝經: '今文孝經', 爾雅: '爾雅',
};

/** Strict: the bracketed form. This is the only pattern that survived sampling. */
const STRICT = /《\s*(詩|書|易|禮|春秋|論語|孝經|爾雅|周禮|儀禮|左傳|國語)\s*》\s*(?:曰|云|稱|之言)/g;
/** Unbracketed: a host-relative convention. Reported, never counted as a citation. */
const BARE = /(?<![》\u4e00-\u9fff])(詩|書|易|禮)\s*(?:曰|云)(?![》「])/g;

/** Punctuation and whitespace carry no weight in a classical quotation. */
const norm = (t) => t.replace(/[\s，。；：、！？「」『』（）()《》〈〉·—…"'']/g, '');

const works = new Map();
for (const w of JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8')).works) {
  if (!w.file) continue;
  works.set(w.id, JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8')));
}

/** Every passage of the cited work, normalised, for lookup. Built once per work. */
const indexCache = new Map();
function indexOf(workId) {
  if (indexCache.has(workId)) return indexCache.get(workId);
  const doc = works.get(workId);
  const rows = [];
  if (doc) {
    for (const s of doc.sections) {
      for (const p of s.passages) rows.push({ section: s.id, passageId: p.id, text: p.text, norm: norm(p.text) });
    }
  }
  indexCache.set(workId, rows);
  return rows;
}

/** The quotation that follows a marker: the bracketed run, or the sentence up to its end. */
function quotedAfter(text, from) {
  const rest = text.slice(from);
  const q = /^\s*[：:]?\s*[「『]([^」』]{2,300})[」』]/.exec(rest);
  if (q) return q[1];
  const bare = /^\s*[：:]?\s*([^。！？]{2,120})[。！？]/.exec(rest);
  return bare ? bare[1] : null;
}

const records = [];
const bareCounts = {};
let unresolved = 0;
for (const [hostId, doc] of works) {
  for (const s of doc.sections) {
    for (const p of s.passages) {
      for (const m of p.text.matchAll(BARE)) bareCounts[m[1]] = (bareCounts[m[1]] ?? 0) + 1;
      for (const m of p.text.matchAll(STRICT)) {
        const citedName = m[1];
        const citedId = CITED[citedName];
        const quote = quotedAfter(p.text, m.index + m[0].length);
        const q = quote ? norm(quote) : null;
        let found = null;
        if (q && q.length >= 4 && citedId) {
          found = indexOf(citedId).find((r) => r.norm.includes(q)) ?? null;
        }
        if (!found) unresolved++;
        records.push({
          schema: 'wenyan.intertext.citation.v1',
          host: { work: hostId, section: s.id, passageId: p.id, sourcePage: s.sourcePage, sourceRevid: s.sourceRevid },
          marker: m[0].trim(),
          citedName,
          citedWork: citedId ?? null,
          quote,
          status: !quote ? 'no-quotation-follows'
            : !citedId ? 'cited-work-not-in-corpus'
            : q.length < 4 ? 'quotation-too-short-to-verify'
            : found ? 'found-in-cited-work' : 'not-found-in-cited-work',
          ...(found ? { foundAt: { section: found.section, passageId: found.passageId } } : {}),
        });
      }
    }
  }
}

const byStatus = {};
const byPair = {};
for (const r of records) {
  byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  if (r.status === 'found-in-cited-work' || r.status === 'not-found-in-cited-work') {
    const k = `${r.host.work} → ${r.citedName}`;
    byPair[k] = byPair[k] ?? { found: 0, notFound: 0 };
    byPair[k][r.status === 'found-in-cited-work' ? 'found' : 'notFound']++;
  }
}

const out = path.join(ROOT, 'knowledge/intertext/citations.jsonl');
if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
console.log(`[intertext] ${records.length} strict citation(s) across ${works.size} works`);
for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`);
console.log(`\n[intertext] host → cited (verified / not found), top 14`);
const pairs = Object.entries(byPair).sort((a, b) => (b[1].found + b[1].notFound) - (a[1].found + a[1].notFound));
for (const [k, v] of pairs.slice(0, 14)) {
  const rate = ((v.found / (v.found + v.notFound)) * 100).toFixed(0);
  console.log(`  ${k.padEnd(34)} ${String(v.found).padStart(4)} / ${String(v.notFound).padStart(3)}  (${rate}% found)`);
}
console.log(`\n[intertext] unbracketed markers reported, NOT counted as citations: ` +
  Object.entries(bareCounts).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('            (host-relative: in 左傳 「書曰」 means 春秋; elsewhere 「詩云」 may be the author composing)');
if (process.argv.includes('--write')) console.log(`\n[written] ${path.relative(ROOT, out)}`);
