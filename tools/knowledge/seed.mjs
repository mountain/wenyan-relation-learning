/**
 * Seed the evidence store.
 *
 *   node tools/knowledge/seed.mjs [--store path]
 *
 * Two sources, deliberately kept apart because they carry different weight:
 *
 *   AUTHORED evidence comes from the controlled-grammar experiment: sentences
 *   written for that experiment with supervised role labels. Its provenance says
 *   so; it is not evidence about any real text.
 *
 *   CORPUS evidence would come from data/corpus with the passage id, page and
 *   revision pinned, plus the licence that applies to that passage. This script
 *   also COUNTS how much such evidence the corpus can supply — which is the
 *   honest way to state whether the network can be grown from real text at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
import { makeRecord, appendEvidence, loadEvidence } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');
const GRAMMAR = 'wenyan.relations.v1';

const argv = process.argv.slice(2);
const storePath = (() => {
  const i = argv.indexOf('--store');
  return i >= 0 ? path.resolve(argv[i + 1]) : path.join(ROOT, 'knowledge/relations/evidence.jsonl');
})();

const load = createTsLoader();
const { readRelation, emptyRelationModel } = load(path.join(ROOT, 'src/inscription/relations.ts'));
const probe = emptyRelationModel();
const constructionOf = (t) => readRelation(t, probe).construction ?? null;

// ------------------------------------------------- authored seed (experiment)
const expPath = path.join(ROOT, 'experiments/relations/evidence.json');
let authored = 0;
let skipped = 0;
if (fs.existsSync(expPath)) {
  const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  const model = exp.model ?? exp.updates?.[exp.updates.length - 1]?.model;
  for (const e of model?.examples ?? []) {
    const record = makeRecord({
      id: `authored:${e.id}`,
      grammar: GRAMMAR,
      text: e.text,
      expected: e.expected,
      label: {
        kind: 'supervisor',
        by: 'experiments/relations controlled-grammar fixture',
        at: exp.generatedAt ?? null,
        note: 'Sentence written for the experiment; the label is a declared supervisor constraint, not an inferred fact about any text.',
      },
      source: {
        kind: 'authored',
        note: 'Not taken from a text. No corpus passage is involved, so no text licence attaches.',
      },
    });
    const r = appendEvidence(storePath, record);
    if (r.appended) authored++; else skipped++;
  }
}

// ------------------------------------------- how much can the corpus supply?
let corpusScanned = 0;
let corpusInGrammar = 0;
const corpusCandidates = [];
let licenseUntagged = 0;
if (fs.existsSync(path.join(CORPUS, 'manifest.json'))) {
  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
  const byId = new Map(manifest.works.map((w) => [w.id, w]));
  for (const w of manifest.works) {
    if (!w.file) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
    for (const s of doc.sections) {
      for (const p of s.passages) {
        corpusScanned++;
        if (constructionOf(p.text)) {
          corpusInGrammar++;
          corpusCandidates.push({ work: w.id, section: s.id, passageId: p.id, text: p.text });
          if (!(w.licenseTemplates && Object.keys(w.licenseTemplates).length)) {
            licenseUntagged++;
            byId.get(w.id);
          }
        }
      }
    }
  }
}

const { records } = loadEvidence(storePath);
console.log(`[seed] store: ${path.relative(ROOT, storePath)}`);
console.log(`  authored evidence appended: ${authored} (already present: ${skipped})`);
console.log(`  total records in store      : ${records.length}`);
console.log(`\n[seed] corpus as an evidence source`);
console.log(`  passages scanned            : ${corpusScanned}`);
console.log(`  passages inside the grammar : ${corpusInGrammar}`);
if (!corpusInGrammar) {
  console.log('  => the corpus cannot supply labelled relation evidence: no passage matches the');
  console.log('     controlled grammar, so nothing can be read, let alone labelled. Growing the');
  console.log('     network from real text requires a grammar that occurs in real text.');
}
if (licenseUntagged) {
  console.log(`  note: ${licenseUntagged} in-grammar passage(s) come from works with no licence tag,`);
  console.log('        so corpus-derived evidence must record the site-default licence per record.');
}
