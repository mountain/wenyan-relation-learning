// SPDX-License-Identifier: MIT
// Source text is indexed with its existing license/provenance, never relicensed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const core = createTsLoader()(path.join(ROOT, 'src/inscription/changes.ts'));
const TRIGRAMS = { 乾: '111', 兌: '110', 離: '101', 震: '100', 巽: '011', 坎: '010', 艮: '001', 坤: '000' };

export function buildCatalog(root = ROOT) {
  const filename = 'data/corpus/works/zhouyi.json';
  const bytes = fs.readFileSync(path.join(root, filename));
  const work = JSON.parse(bytes);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/corpus/manifest.json'), 'utf8'));
  const digest = sha256(bytes);
  if (work.id !== 'zhouyi' || work.sections.length !== 64) throw new Error('unexpected Zhouyi corpus');
  const entries = work.sections.map(section => {
    const passages = section.passages.filter(p => p.text.startsWith('易經：'));
    if (passages.length !== 1) throw new Error(`missing/ambiguous main text: ${section.id}`);
    const passage = passages[0];
    const matches = [...passage.text.matchAll(/^(初[六九]|[六九][二三四五]|上[六九]|用[六九])[：，]/gm)];
    const ordinary = matches.filter(m => !m[1].startsWith('用'));
    if (ordinary.length !== 6) throw new Error(`expected six ordinary lines: ${section.id}`);
    const bits = ordinary.map(m => m[1].includes('九') ? '1' : '0').join('');
    const trigramText = section.passages.map(p => p.text).join('\n');
    const trigram = /([乾兌離震巽坎艮坤])下([乾兌離震巽坎艮坤])上/.exec(trigramText);
    if (!trigram || bits !== TRIGRAMS[trigram[1]] + TRIGRAMS[trigram[2]]) throw new Error(`trigram/line mismatch: ${section.id}`);
    function span(start, end) {
      while (/\s/u.test(passage.text[start] ?? '') && start < end) start++;
      while (/\s/u.test(passage.text[end - 1] ?? '') && end > start) end--;
      const text = passage.text.slice(start, end);
      if (!text) throw new Error('empty text span');
      return { text, source: { work: work.id, section: section.id, passageId: passage.id,
        sourcePage: section.sourcePage, sourceRevid: section.sourceRevid,
        passageHash: sha256(passage.text), start, end,
        license: { source: filename, corpusSha256: digest, field: 'license', attribution: section.sourcePage } } };
    }
    const lines = [], extra = [];
    matches.forEach((m, i) => {
      const record = { label: m[1], ...span(m.index + m[0].length, matches[i + 1]?.index ?? passage.text.length) };
      if (m[1].startsWith('用')) extra.push(record);
      else {
        const position = m[1].startsWith('初') ? 1 : m[1].startsWith('上') ? 6 : '二三四五'.indexOf(m[1][1]) + 2;
        if (position !== lines.length + 1) throw new Error('line ordering mismatch');
        lines.push({ position, ...record });
      }
    });
    const expectedExtra = section.ordinal === 1 ? '用九' : section.ordinal === 2 ? '用六' : null;
    if (extra.length !== (expectedExtra ? 1 : 0) || (expectedExtra && extra[0].label !== expectedExtra))
      throw new Error('unexpected extra-use statement');
    return { ordinal: section.ordinal, name: section.title, bits,
      statement: span('易經：'.length, matches[0].index), lines, extra };
  });
  const catalog = { schema: 'wenyan.changes.catalog.v1',
    provenance: { file: filename, sha256: digest, license: work.license,
      siteDefault: manifest.source?.license?.siteDefault ?? null,
      note: 'The catalog retains the corpus transcription license; labels and logical rules have separate provenance.' }, entries };
  core.validateCatalog(catalog);
  return catalog;
}

export function checkCatalogSources(catalog, root = ROOT) {
  // Rebuild also checks labels, bit order, trigrams, extra lines, and every span.
  const expected = buildCatalog(root);
  if (JSON.stringify(catalog) !== JSON.stringify(expected)) throw new Error('catalog differs from source reconstruction');
  return { hexagrams: 64, statements: 64, ordinaryLines: 384, extraUseLines: 2, sourceSha256: expected.provenance.sha256 };
}

export function findLine(catalog, bits, position) {
  core.checkBits(bits); core.checkPosition(position);
  const entry = catalog.entries.find(e => e.bits === bits);
  if (!entry) throw new Error('unknown hexagram');
  return { entry, line: entry.lines[position - 1] };
}
