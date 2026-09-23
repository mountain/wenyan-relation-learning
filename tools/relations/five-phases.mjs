/**
 * THE FIVE-PHASE LABELLING, MEASURED — is the correspondence table actually in the text, and is it
 * symmetric?
 *
 * 五行 is usually stated as a cycle (相生 +1, 相剋 +2 in Z/5), but a first pass over the 273 passages
 * holding all five phases refused that: most of them are NOT cyclic (洪範's 水火木金土 has steps
 * (+2,−1,+3,−1,+2)). What 五行 looks like in text is a LABELLED FIVE-ELEMENT SET with several canonical
 * listings, plus a table of correspondences (方 / 色 / 音 / 臟 / 味 / 數 / 穀 / 臭). The correspondence
 * table is a labelling in the technical sense — a bijection from the five phases to five items — and
 * that is the object this tool measures.
 *
 * Two questions, both answered by counting passages:
 *   1. DIAGONAL DOMINANCE. For each category, is the canonical item for a phase more often found with
 *      that phase than the other four items are? If the table is a real structure in the text, the
 *      canonical pairing should dominate its row.
 *   2. SYMMETRY. Is that dominance EVEN across the five phases? A regular pentagon (or a regular
 *      tetrahedron, or a Goldberg polyhedron with icosahedral symmetry) predicts the five phases carry
 *      comparable weight. Measured asymmetry is not a nuisance here: it is the direct evidence about
 *      whether the regular structure is the right model, the same way 醜:861 against 惡:7371 was.
 *
 * Greedy argmax assignment is used, not Hungarian: if the canonical item is NOT the row max, saying so
 * plainly is worth more than a globally optimal assignment nobody can check by eye. Collisions are
 * reported instead of hidden.
 *
 *   node tools/relations/five-phases.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);

const PHASES = ['木', '火', '土', '金', '水'];
/** Canonical tables, all written in the phase order 木火土金水. */
const CATEGORIES = {
  五方: ['東', '南', '中', '西', '北'],
  五色: ['青', '赤', '黃', '白', '黑'],
  五音: ['角', '徵', '宮', '商', '羽'],
  五臟: ['肝', '心', '脾', '肺', '腎'],
  五味: ['酸', '苦', '甘', '辛', '鹹'],
  五數: ['八', '七', '五', '九', '六'],
  五穀: ['麥', '菽', '稷', '麻', '黍'],
  五臭: ['羶', '焦', '香', '腥', '朽'],
  五常: ['仁', '禮', '信', '義', '智'],
};

const count = {};      // count[category][phaseIndex][itemIndex]
for (const [c, items] of Object.entries(CATEGORIES)) {
  count[c] = PHASES.map(() => items.map(() => 0));
}
let passages = 0;
const dir = path.join(ROOT, 'data/corpus/works');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const s of doc.sections ?? []) {
    for (const p of s.passages ?? []) {
      passages += 1;
      const t = p.text;
      for (const [c, items] of Object.entries(CATEGORIES)) {
        const here = items.map((x) => t.includes(x));
        if (!here.some(Boolean)) continue;
        for (let i = 0; i < PHASES.length; i += 1) {
          if (!t.includes(PHASES[i])) continue;
          for (let j = 0; j < items.length; j += 1) if (here[j]) count[c][i][j] += 1;
        }
      }
    }
  }
}

const report = {
  schema: 'wenyan.relations.five-phases.v1',
  generatedAt: new Date().toISOString(),
  question: 'Is the 五行 correspondence table present in the text as a bijection, and is its weight even '
    + 'across the five phases?',
  scope: { passages, phases: PHASES, categories: Object.keys(CATEGORIES) },
  perCategory: {},
  nonClaims: [
    'Co-occurrence inside one passage is not assertion: 西 and 金 share passages for geographic reasons too. The diagonal test is therefore an UPPER bound on support, and the asymmetry measured between rows is the part that cannot be explained that way.',
    'The canonical tables are taken from the classical standard, not derived from this corpus; if a table is wrong, the tool reports the corpus as disagreeing with it rather than correcting itself.',
    'Greedy argmax, not an optimal assignment: collisions are reported rather than resolved.',
  ],
};

for (const [c, items] of Object.entries(CATEGORIES)) {
  const m = count[c];
  const diag = PHASES.map((_, i) => m[i][i]);
  const rowSum = m.map((row) => row.reduce((a, b) => a + b, 0));
  const total = rowSum.reduce((a, b) => a + b, 0);
  const diagSum = diag.reduce((a, b) => a + b, 0);
  const argmax = m.map((row) => row.indexOf(Math.max(...row)));
  const canonical = argmax.every((j, i) => j === i);
  const collisions = argmax.filter((j, i) => j !== i)
    .map((j, i) => `${PHASES[i]}→${items[j]}(非典范 ${items[i]})`);
  report.perCategory[c] = {
    table: Object.fromEntries(PHASES.map((p, i) => [p, items[i]])),
    diagonalCounts: Object.fromEntries(PHASES.map((p, i) => [p, diag[i]])),
    diagonalShare: total ? +(diagSum / total).toFixed(4) : null,
    chanceShare: +(1 / items.length).toFixed(4),
    argmaxIsCanonical: canonical,
    mismatches: collisions,
    // The symmetry test: max/min over the five diagonal counts.
    diagonalSpread: Math.min(...diag) > 0 ? +(Math.max(...diag) / Math.min(...diag)).toFixed(2) : null,
  };
}

const rows = Object.values(report.perCategory).map((r) => r.diagonalSpread).filter((x) => x !== null);
report.symmetry = {
  diagonalSpreadPerCategory: Object.fromEntries(Object.entries(report.perCategory).map(([c, r]) => [c, r.diagonalSpread])),
  medianSpread: rows.length ? +rows.slice().sort((a, b) => a - b)[Math.floor(rows.length / 2)].toFixed(2) : null,
  reading: 'A regular structure predicts a spread near 1 (all five phases equally attested). Larger means '
    + 'the labelling is carried unevenly by the corpus, so the regularity is an idealisation rather than a '
    + 'measured property — which is exactly the kind of thing this project reports instead of assuming.',
};

console.log(`[five-phases] ${passages} passages`);
for (const [c, r] of Object.entries(report.perCategory)) {
  console.log(`  ${c}  对角占比 ${(r.diagonalShare * 100).toFixed(1)}%（随机 ${(r.chanceShare * 100).toFixed(0)}%）`
    + `  典范成立=${r.argmaxIsCanonical ? '是' : '否'}  五相跨度 ${r.diagonalSpread}×`);
  if (!r.argmaxIsCanonical) console.log(`      不符：${r.mismatches.join('，')}`);
  console.log(`      对角计数 ${Object.entries(r.diagonalCounts).map(([k, v]) => k + ':' + v).join(' ')}`);
}
console.log(`[five-phases] median spread ${report.symmetry.medianSpread}×`);

if (argv.includes('--write')) {
  const out = path.join(ROOT, 'knowledge/relations/five-phases.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[written] ${path.relative(ROOT, out)}`);
}
