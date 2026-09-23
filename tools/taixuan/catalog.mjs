// SPDX-License-Identifier: MIT
// Source transcription keeps its own attribution and license.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../changes/catalog.mjs';
import { checkDigits, checkZan, fromOrdinal, contextFeatures, encodeAddress } from './structure.mjs';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export { sha256 };
export function renderText(raw) {
  // Only this explicit, observed content template is rendered. Unknown markup fails closed.
  const text = raw.replace(/\{\{!\|([^|{}]+)\|[^{}]*\}\}/gu, '$1');
  if (/[{}]|\[\[|\]\]|<\/?\w/u.test(text)) throw new Error('unrecognized source markup');
  return text;
}
export function buildCatalog(root = ROOT) {
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'data/taixuan/source.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(root, provenance.file)), raw = bytes.toString('utf8');
  if (sha256(bytes) !== provenance.sha256 || provenance.revision !== 2651096) throw new Error('source snapshot mismatch');
  const headings = [...raw.matchAll(/^(={2,3})([^=\n]+)\1\r?$/gm)];
  const entries = [], extra = [], anomalies = [], supplemental = [];
  function span(start, end, part) {
    while (start < end && /\s/u.test(raw[start])) start++;
    while (end > start && /\s/u.test(raw[end - 1])) end--;
    if (start === end) throw new Error('empty source span');
    return { text: renderText(raw.slice(start, end)), source: { snapshotSha256: provenance.sha256, start, end, unit: 'UTF-16', part } };
  }
  let region = null;
  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h], title = heading[2];
    const start = heading.index + heading[0].length, end = headings[h + 1]?.index ?? raw.indexOf('{{footer}}');
    if (heading[1] === '==') region = title;
    if (heading[1] === '===' && ['一方', '二方', '三方'].includes(region)) {
      const ordinal = entries.length + 1, digits = fromOrdinal(ordinal);
      const block = raw.slice(start, end), glyph = /[\u{1D306}-\u{1D356}]/u.exec(block);
      if (!glyph || glyph[0].codePointAt(0) !== 0x1D306 + ordinal - 1
          || Number(digits[0]) !== ['一方', '二方', '三方'].indexOf(region)) throw new Error('head order/glyph/region mismatch');
      const labels = [...block.matchAll(/^(初一|次[二三四五六七八九]|上九)[：:。，、]/gm)];
      if (labels.length !== 9) throw new Error(`expected nine zan: ${title}`);
      const zans = labels.map((m, i) => {
        const zan = '一二三四五六七八九'.indexOf(m[1][1]) + 1;
        if (zan !== i + 1) throw new Error(`zan order mismatch: ${title}`);
        const a = start + m.index + m[0].length, b = start + (labels[i + 1]?.index ?? block.length);
        const body = raw.slice(a, b), markers = [...body.matchAll(/[測側]曰[：:。，、]/g)];
        const record = { zan, label: m[1], passage: span(a, b, 'passage'), segmentation: null, statement: null, commentary: null };
        if (markers.length === 0) {
          record.segmentation = 'unresolved-missing-marker';
          anomalies.push({ head: title, zan, kind: record.segmentation, source: record.passage.source });
        } else {
          if (markers.length !== 1) throw new Error(`ambiguous commentary boundary: ${title}/${zan}`);
          const marker = markers[0]; record.segmentation = 'explicit-marker'; record.marker = marker[0];
          record.statement = span(a, a + marker.index, 'zan');
          record.commentary = span(a + marker.index + marker[0].length, b, 'ce');
          if (marker[0] !== '測曰：') anomalies.push({ head: title, zan, kind: 'marker-variant', marker: marker[0] });
        }
        if (m[1] === '次九') anomalies.push({ head: title, zan, kind: 'label-variant', label: m[1] });
        return record;
      });
      entries.push({ ordinal, name: title, glyph: glyph[0], digits, region,
        statement: span(start, start + labels[0].index, 'head'), zans });
    } else if (title === '踦嬴') {
      const block = raw.slice(start, end), labels = [...block.matchAll(/^(踦贊一|嬴贊二)，/gm)];
      if (labels.length !== 2) throw new Error('missing supplementary zan');
      labels.forEach((m, i) => extra.push({ label: m[1], ...span(start + m.index + m[0].length, start + (labels[i + 1]?.index ?? block.length), 'extra') }));
    } else if (['玄首序', '玄測序'].includes(title) || (heading[1] === '===' && region === '太玄傳')) {
      supplemental.push({ title, ...span(start, end, 'supplemental') });
    }
  }
  if (entries.length !== 81 || extra.length !== 2) throw new Error('unexpected Taixuan corpus shape');
  return { schema: 'wenyan.taixuan.catalog.v1', provenance,
    encoding: { digits: '方州部家, top to bottom; historical values 1/2/3 encoded 0/1/2',
      ordinal: '1 + 27*方 + 9*州 + 3*部 + 家 (zero-based digits)',
      address: 'four head digits followed by two base-3 digits for zan-1; address only, no transition or truth semantics',
      glyphReference: 'https://www.unicode.org/charts/PDF/U1D300.pdf',
      nonclaims: ['No Unknown digit', 'No Adva six-germ isomorphism', 'No automatic meaning or calendar model'] },
    entries, extra, supplemental, anomalies };
}
export function checkCatalogSources(catalog, root = ROOT) {
  const expected = buildCatalog(root);
  if (JSON.stringify(catalog) !== JSON.stringify(expected)) throw new Error('catalog differs from pinned source reconstruction');
  return { heads: catalog.entries.length, zans: catalog.entries.reduce((n, e) => n + e.zans.length, 0),
    separatedPairs: catalog.entries.flatMap(e => e.zans).filter(z => z.statement && z.commentary).length,
    unresolved: catalog.anomalies.filter(a => a.kind === 'unresolved-missing-marker'), extras: catalog.extra.length,
    anomalies: catalog.anomalies.length, snapshotSha256: catalog.provenance.sha256 };
}
export function findZan(catalog, digits, zan) {
  checkDigits(digits); checkZan(zan);
  const entry = catalog.entries.find(e => e.digits === digits);
  if (!entry) throw new Error('unknown head');
  return { entry, record: entry.zans[zan - 1] };
}
export function readTaixuan(text, catalog) {
  const m = /^(?:觀|观)「([^」]+)」(?:之([一二三四五六七八九])(?:贊|赞))?。?$/u.exec(text);
  if (!m) return { status: 'Unknown', reason: 'outside-declared-query-grammar' };
  const entry = catalog.entries.find(e => e.name === m[1]);
  if (!entry) return { status: 'Unknown', reason: 'unknown-head' };
  const base = { status: 'IndexedText', system: 'taixuan', sourceVerification: 'caller-supplied-catalog',
    provenance: catalog.provenance, head: { name: entry.name, digits: entry.digits, statement: entry.statement } };
  if (!m[2]) return { ...base, zans: entry.zans };
  const zan = '一二三四五六七八九'.indexOf(m[2]) + 1;
  const context = { system: 'taixuan', digits: entry.digits, zan };
  return { ...base, context, address: encodeAddress(entry.digits, zan), features: contextFeatures(context), record: entry.zans[zan - 1] };
}
