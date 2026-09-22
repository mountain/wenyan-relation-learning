/**
 * Validate data/corpus against the wenyan.corpus.v1 format.
 *
 *   node tools/corpus/validate.mjs [--strict]
 *
 * Errors mean the artifact is malformed (duplicate ids, empty text, leftover
 * markup, hash mismatch). Warnings mean the artifact is well-formed but carries
 * a recorded limitation (chapter-count mismatch, non-canonical order) — those
 * are expected to exist and must stay visible, so they never fail the run unless
 * --strict is given.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib/wikitext.mjs';
import { WORKS } from './works.config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(ROOT, 'data/corpus');
const strict = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/** Markup that must not survive into base text. */
const RESIDUE = [
  [/\{\{|\}\}/, 'template braces'],
  [/\[\[|\]\]/, 'wiki link brackets'],
  [/<\/?[a-zA-Z][^>]*>/, 'html tag'],
  [/__NOTOC__|__NOEDITSECTION__/, 'behaviour switch'],
  [/-\{|\}-/, 'language conversion marker'],
  [/\u0000/, 'internal anchor marker'],
  [/&(?:nbsp|amp|lt|gt|quot);/, 'html entity'],
  [/<!--|-->/, 'comment marker'],
];

function checkWorkJson(file, entry) {
  const rel = `works/${entry.id}.json`;
  const abs = path.join(OUT_DIR, rel);
  if (!fs.existsSync(abs)) { err(`${entry.id}: file missing (${rel})`); return null; }
  const raw = fs.readFileSync(abs, 'utf8');
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { err(`${entry.id}: invalid JSON (${e.message})`); return null; }

  if (doc.schema !== 'wenyan.corpus.work.v1') err(`${entry.id}: wrong schema ${doc.schema}`);
  if (doc.id !== entry.id) err(`${entry.id}: id mismatch (${doc.id})`);
  if (!doc.title?.zh) err(`${entry.id}: missing title.zh`);
  if (!['confucian', 'philosophers'].includes(doc.tradition)) err(`${entry.id}: bad tradition`);

  // manifest hash must match file content
  if (entry.sha256 && entry.sha256 !== sha256(raw)) {
    err(`${entry.id}: sha256 mismatch (manifest ${entry.sha256.slice(0, 12)}… != actual ${sha256(raw).slice(0, 12)}…)`);
  }

  if (!Array.isArray(doc.sections) || !doc.sections.length) { err(`${entry.id}: no sections`); return doc; }

  const secIds = new Set();
  const passIds = new Set();
  let passages = 0;
  let characters = 0;
  let anchored = 0;

  doc.sections.forEach((s, si) => {
    if (!s.id) err(`${entry.id}: section ${si} has no id`);
    if (secIds.has(s.id)) err(`${entry.id}: duplicate section id ${s.id}`);
    secIds.add(s.id);
    if (s.ordinal !== si + 1) err(`${entry.id}: section ${s.id} ordinal ${s.ordinal} != position ${si + 1}`);
    if (!s.title) err(`${entry.id}: section ${s.id} has no title`);
    if (!s.sourcePage) err(`${entry.id}: section ${s.id} has no sourcePage`);
    if (!Array.isArray(s.passages) || !s.passages.length) { err(`${entry.id}: section ${s.id} has no passages`); return; }

    s.passages.forEach((p) => {
      if (!p.id) err(`${entry.id}: passage in ${s.id} has no id`);
      if (passIds.has(p.id)) err(`${entry.id}: duplicate passage id ${p.id}`);
      passIds.add(p.id);
      if (typeof p.text !== 'string' || !p.text.trim()) err(`${entry.id}: empty passage ${p.id}`);
      if (p.sourceAnchor) anchored++;
      for (const [re, label] of RESIDUE) {
        if (re.test(p.text)) {
          err(`${entry.id}: ${p.id} contains ${label}: ${JSON.stringify(p.text.slice(0, 60))}`);
          break;
        }
      }
      passages++;
      characters += [...p.text].length;
    });
  });

  if (doc.counts?.sections !== doc.sections.length) {
    err(`${entry.id}: counts.sections ${doc.counts?.sections} != ${doc.sections.length}`);
  }
  if (doc.counts?.passages !== passages) err(`${entry.id}: counts.passages ${doc.counts?.passages} != ${passages}`);
  if (doc.counts?.characters !== characters) err(`${entry.id}: counts.characters ${doc.counts?.characters} != ${characters}`);

  // recorded limitations are expected, but must be visible
  if (Array.isArray(doc.limitations) && doc.limitations.includes(
      `chapter count ${doc.sections.length} != expected ${entry.expectedChapters}`)) {
    warn(`${entry.id}: chapter count mismatch recorded`);
  }
  if (doc.source?.discovery?.route === 'allpages') {
    warn(`${entry.id}: section order is wiki sort order (not verified canonical)`);
  }
  if (!doc.textEdition) {
    // only notable for works that had a versions page; keep it informational
  }
  return { doc, passages, characters, anchored };
}

function main() {
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('manifest.json not found — run tools/corpus/build.mjs first');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== 'wenyan.corpus.manifest.v1') err(`manifest: wrong schema ${manifest.schema}`);
  if (manifest.format !== 'wenyan.corpus.v1') err(`manifest: wrong format ${manifest.format}`);
  if (!manifest.source?.license?.siteDefault) err('manifest: missing site license statement');
  for (const w of manifest.works ?? []) {
    if (w.file && !w.licenseStatus) err(`${w.id}: missing licenseStatus`);
  }

  const byId = new Map((manifest.works ?? []).map((w) => [w.id, w]));
  for (const work of WORKS) {
    if (!byId.has(work.id)) err(`manifest: work ${work.id} not listed`);
  }

  let totalSections = 0, totalPassages = 0, totalChars = 0, totalAnchored = 0;
  for (const entry of manifest.works ?? []) {
    if (entry.error) { err(`${entry.id}: build error recorded: ${entry.error}`); continue; }
    const r = checkWorkJson(null, { ...entry, expectedChapters: WORKS.find((w) => w.id === entry.id)?.expectedChapters });
    if (!r) continue;
    totalSections += r.doc.sections.length;
    totalPassages += r.passages;
    totalChars += r.characters;
    totalAnchored += r.anchored;
    for (const lim of entry.limitations ?? []) warn(`${entry.id}: ${lim}`);
  }

  if (manifest.counts?.sections !== totalSections) err(`manifest counts.sections ${manifest.counts?.sections} != ${totalSections}`);
  if (manifest.counts?.passages !== totalPassages) err(`manifest counts.passages ${manifest.counts?.passages} != ${totalPassages}`);
  if (manifest.counts?.characters !== totalChars) err(`manifest counts.characters ${manifest.counts?.characters} != ${totalChars}`);

  console.log(`[validate] works=${manifest.works?.length ?? 0} sections=${totalSections} ` +
    `passages=${totalPassages} characters=${totalChars} anchoredPassages=${totalAnchored}`);
  if (warnings.length) {
    console.log(`\n[warnings] ${warnings.length} (recorded limitations, expected):`);
    for (const w of warnings.slice(0, 60)) console.log('  -', w);
    if (warnings.length > 60) console.log(`  ... ${warnings.length - 60} more`);
  }
  if (errors.length) {
    console.log(`\n[ERRORS] ${errors.length}:`);
    for (const e of errors.slice(0, 60)) console.log('  !', e);
    if (errors.length > 60) console.log(`  ... ${errors.length - 60} more`);
    process.exit(1);
  }
  console.log('\n[ok] no format errors');
  if (strict && warnings.length) {
    console.log('[strict] failing because warnings are present');
    process.exit(1);
  }
}

main();
