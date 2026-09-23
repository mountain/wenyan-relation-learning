/**
 * Seed the store with supervised evidence drawn from REAL corpus passages, for
 * the reporting-frame grammar.
 *
 *   node tools/grammar/seed-reporting.mjs [--per-construction 2] [--store path]
 *
 * Every record is corpus-derived, so unlike the authored v1 evidence it carries
 * the passage id, the page, the exact revision and the licence that applies to
 * that passage. This is the first time the store's corpus-source path is
 * exercised, and the first time `verifySources()` has anything to check.
 *
 * The label is a DECLARATION, not a discovery: the declared reading is
 * speaker -> agent, addressee -> recipient, quoted speech -> theme. The
 * machinery then treats it as an authoritative constraint and eliminates the
 * five competing role permutations. If that reading is wrong, the record is
 * wrong — which is why the provenance names who declared it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
import { makeRecord, appendEvidence } from '../knowledge/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CORPUS = path.join(ROOT, 'data/corpus');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const perConstruction = Number(flag('per-construction', 2));
const storePath = path.resolve(flag('store', path.join(ROOT, 'knowledge/relations/evidence.jsonl')));

const load = createTsLoader();
const mod = load(path.join(ROOT, 'src/inscription/relations-reporting.ts'));
const { readReporting, emptyReportingModel, REPORTING_GRAMMAR_ID, CONSTRUCTION_IDS } = mod;
const empty = emptyReportingModel();

const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const workMeta = new Map(manifest.works.map((w) => [w.id, w]));

/**
 * Is a captured span admissible as a SUPERVISED LABEL?
 *
 * The original picker took the first passages that parsed, and the corpus promptly
 * supplied spans that cannot be labelled truthfully: `於是武王遍告諸侯曰` yields agent
 * `於是武王遍`, `厲聲謂曰` yields agent `厲聲` (an adverbial), `樅公相謂曰` yields
 * `樅公相`, `野語有之曰` yields agent `野`. Labelling those as the agent ASSERTS
 * SOMETHING FALSE about who spoke, so they are rejected rather than stored.
 *
 * Measured cost of the rule: of the 8,726 passages the seven constructions can read
 * under the single-match rule, 1,002 (11.48%) have an agent span that starts with a
 * particle or adverb. This is a DECLARED filter with a measured rejection rate, not a
 * taste judgement, and the rate is reported by tools/grammar/measure.mjs.
 */
const PARTICLE_PREFIX = /^(且|復|亦|又|乃|遂|蓋|故|而|則|皆|盡|共|竊|嘗|數|相|於是|因|既|始|方|將|欲|敢|請|可|不|傳|使|若|夫|今|昔|初|後|其|之|以|為|所|與|野)/;
const PARTICLE_SUFFIX = /(且|復|亦|又|乃|遂|蓋|故|而|則|皆|盡|共|竊|嘗|數|相|有|以|傳|歸)$/;
const VERBISH = /[曰謂問告語於于乎]/;
function admissibleAgent(v) {
  return !!v && v.length <= 5 && !PARTICLE_PREFIX.test(v) && !PARTICLE_SUFFIX.test(v) && !VERBISH.test(v);
}
function admissibleRecipient(v) {
  // A prepositional or relative recipient (`於子貢`, `乎長梧子`, `敖者`) records the
  // wrong span; a pronominal one (`人`, `余`) IS the recipient expression and is kept.
  return !!v && v.length <= 5 && !VERBISH.test(v) && !/者$/.test(v) && !/^有/.test(v);
}

/** Pick passages that parse uniquely AND whose spans can be labelled truthfully. */
const chosen = new Map(CONSTRUCTION_IDS.map((c) => [c, []]));
const seenWorks = new Map(CONSTRUCTION_IDS.map((c) => [c, new Set()]));
for (const w of manifest.works) {
  if (!w.file) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(CORPUS, w.file), 'utf8'));
  for (const s of doc.sections) {
    for (const p of s.passages) {
      let r;
      try { r = readReporting(p.text, empty); } catch { continue; }
      if (!r.construction || r.reason === 'ambiguous-frame-occurrence') continue;
      // Admissibility is checked against the span the label would actually carry.
      const spans = r.occurrences.map((o) => o.value);
      const expressed = mod.ROLES_FOR_CONSTRUCTION(r.construction);
      if (!admissibleAgent(spans[0])) continue;
      if (expressed.includes('recipient') && !admissibleRecipient(spans[1])) continue;
      const theme = spans[spans.length - 1];
      if (!theme || theme.length < 5) continue;
      const bucket = chosen.get(r.construction);
      if (!bucket || bucket.length >= perConstruction) continue;
      if (seenWorks.get(r.construction).has(w.id) && bucket.length < perConstruction) {
        // prefer distinct works, but do not skip the construction entirely
        if (seenWorks.get(r.construction).size < perConstruction) continue;
      }
      seenWorks.get(r.construction).add(w.id);
      bucket.push({
        construction: r.construction,
        work: w.id, zh: w.zh, section: s.id, passageId: p.id,
        sourcePage: s.sourcePage, sourceRevid: s.sourceRevid,
        text: p.text, occurrences: r.occurrences,
      });
    }
  }
}

let appended = 0;
let skipped = 0;
const summary = [];
for (const [construction, items] of chosen) {
  for (const it of items) {
    const spans = it.occurrences.map((o) => o.value);
    const expressed = mod.ROLES_FOR_CONSTRUCTION(construction);
    const [speaker, speech] = expressed.includes('recipient')
      ? [spans[0], spans[2]] : [spans[0], spans[1]];
    const addressee = expressed.includes('recipient') ? spans[1] : null;
    const meta = workMeta.get(it.work);
    const record = makeRecord({
      id: `corpus:${it.work}:${it.passageId}:${construction}`,
      grammar: REPORTING_GRAMMAR_ID,
      text: it.text,
      expected: { agent: speaker, recipient: addressee, theme: speech },
      label: {
        kind: 'supervisor',
        by: 'tools/grammar/seed-reporting.mjs',
        at: new Date().toISOString(),
        reading: expressed.includes('recipient')
          ? 'speaker -> agent, addressee -> recipient, quoted speech -> theme'
          : 'speaker -> agent, quoted speech -> theme; this construction does NOT express '
            + 'an addressee, so recipient is null rather than invented',
        note: 'Declared reading for the reporting frame. A declaration, not a discovery: if it is wrong, this record is wrong.',
      },
      source: {
        kind: 'corpus',
        corpus: manifest.format,
        work: it.work,
        section: it.section,
        passageId: it.passageId,
        sourcePage: it.sourcePage,
        sourceRevid: it.sourceRevid,
        passageTextAtLabel: it.text,
        license: {
          templates: meta?.licenseTemplates ?? {},
          status: meta?.licenseStatus ?? 'unrecorded',
        },
      },
    });
    const r = appendEvidence(storePath, record);
    if (r.appended) appended++; else skipped++;
  }
  summary.push(`${construction}: ${items.length} label(s)`);
}

console.log(`[seed-reporting] store ${path.relative(ROOT, storePath)}`);
console.log(`  appended ${appended}, already present ${skipped}`);
for (const s of summary) console.log(`  ${s}`);
const withoutEvidence = CONSTRUCTION_IDS.filter((c) => chosen.get(c).length === 0);
if (withoutEvidence.length) {
  console.log(`  WARNING: no label for ${withoutEvidence.join(', ')} — those constructions stay unmapped`);
}
