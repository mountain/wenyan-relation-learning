/**
 * TESTING THE CLAIM, NOT THE PAPER: "122 magnetic point groups and 1651 magnetic space groups show
 * 100% octave-normalized correspondence with the 22 shrutis".
 *
 * Mingli Yuan asked for this by serial number, and said a failure is also progress — which is the right
 * frame, because the claim as stated is testable in two ways and BOTH are run here:
 *
 *   A. OCTAVE NORMALISATION OF THE SERIAL NUMBERS.  n -> 2^{frac(log2 n)} brings a serial number into
 *      one octave. Ask whether a shruti position 2^{k/22} is hit. The trap: {log2 n mod 1} is
 *      EQUIDISTRIBUTED, so for n up to 1651 the normalised values are ~1/1651 octave apart and EVERY
 *      position in the octave is hit to within a fraction of a percent. "100% coverage" is therefore
 *      not a finding, it is a density. The honest questions are (i) how dense, (ii) what a random set
 *      of the same size achieves, and (iii) how many hits are EXACT rather than within a tolerance.
 *
 *   B. COUNT ARITHMETIC.  1651, 1191, 528, 394, 230, 122 against 22. Not part of the paper's method
 *      necessarily, but it is where a claim like this usually lives, and it is cheap to check with the
 *      multiplicity correction stated: with six numbers and one modulus, some exact hit is likely.
 *
 * A CHOICE IS MADE AND DECLARED: the 22 shrutis are taken as 22 equal divisions of the octave, 2^{k/22}.
 * The traditional values are not equal-tempered and there are competing schemes; equal division is the
 * most favourable reading for the claim (it puts the targets as evenly as possible), so using it means a
 * failure here is not an artefact of a harsh choice.
 *
 *   node tools/relations/shruti-correspondence.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);

const SHRUTI = Array.from({ length: 22 }, (_, k) => k / 22);           // positions in octaves
const norm = (n) => { const x = Math.log2(n); return x - Math.floor(x); };
/** Distance in octaves from the nearest shruti position, wrapping at the octave. */
const nearest = (u) => Math.min(...SHRUTI.map((s) => { const d = Math.abs(u - s); return Math.min(d, 1 - d); }));

const coverage = (Ns) => {
  const used = Ns.filter((n) => n >= 1);
  const dists = used.map((n) => nearest(norm(n)));
  const hit = (eps) => SHRUTI.filter((s) => used.some((n) => {
    const d = Math.abs(norm(n) - s);
    return Math.min(d, 1 - d) <= eps;
  })).length;
  return {
    n: used.length,
    maxNearestDistanceOctaves: +Math.max(...dists).toFixed(6),
    coverageAt1percent: hit(0.01), coverageAt0_1percent: hit(0.001), coverageAt0_01percent: hit(0.0001),
    meanNearestDistance: +(dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(6),
    exactHits: used.filter((n) => nearest(norm(n)) < 1e-12).length,
    exactHitValues: used.filter((n) => nearest(norm(n)) < 1e-12),
  };
};

const counts = { magneticSpaceGroups: 1651, typeIII: 1191, magneticLayerGroups: 528, magneticRodGroups: 394, greyOrColorless: 230, magneticPointGroups: 122 };

// Null: same number of RANDOM positions in one octave — what any set of that size achieves.
const rndCoverage = (n, trials = 2000, eps = 0.001) => {
  let full = 0;
  let seed = 20260925;
  const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let t = 0; t < trials; t += 1) {
    const vals = Array.from({ length: n }, r);
    const c = SHRUTI.filter((s) => vals.some((v) => Math.min(Math.abs(v - s), 1 - Math.abs(v - s)) <= eps)).length;
    if (c === 22) full += 1;
  }
  return { trials, eps, shareFullCoverage: +(full / trials).toFixed(4) };
};

const report = {
  schema: 'wenyan.relations.shruti-correspondence.v1',
  generatedAt: new Date().toISOString(),
  claim: '122 magnetic point groups and 1651 magnetic space groups show 100% octave-normalized correspondence with the 22 shrutis.',
  choice: { shrutis: '22 equal divisions of the octave, 2^{k/22}', why: 'the most favourable reading for the claim' },
  A_serialNumbers: {
    mpg122: coverage(Array.from({ length: 122 }, (_, i) => i + 1)),
    msg1651: coverage(Array.from({ length: 1651 }, (_, i) => i + 1)),
    null122: rndCoverage(122),
    null1651: rndCoverage(1651),
  },
  B_counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, {
    value: v, mod22: v % 22, quotient: +(v / 22).toFixed(3), exactMultipleOf22: v % 22 === 0,
  }])),
  nonClaims: [
    'The paper\'s own method is not reproduced here; only the two readings a reader can check from the numbers themselves.',
    'Equal-tempered shrutis are a modern idealisation of a scheme with competing traditional versions; the choice is declared above because it favours the claim.',
    'Nothing here shows the paper is wrong about whatever it actually computed — it shows what the stated claim does and does not establish when read this way.',
  ],
};

{
  const a = report.A_serialNumbers;
  a.reading = `With 1651 serial numbers the octave is covered to within ${(a.msg1651.maxNearestDistanceOctaves * 100).toFixed(3)}% `
    + `of an octave, so a 100% coverage claim is a statement about DENSITY, not correspondence: the null `
    + `(random values of the same size) reaches full coverage in ${(a.null1651.shareFullCoverage * 100).toFixed(1)}% of trials. `
    + `Exact hits: ${a.msg1651.exactHits} for 1651 and ${a.mpg122.exactHits} for 122, and they are the powers of two `
    + `[${a.msg1651.exactHitValues.join(', ')}] — i.e. the UNISON/octave, the one position that is forced for any n and therefore carries no information.`;
  const exact = Object.entries(report.B_counts).filter(([, v]) => v.exactMultipleOf22);
  report.B_counts.reading = exact.length
    ? `Exactly divisible by 22: ${exact.map(([k, v]) => `${k}=${v.value}`).join(', ')}. With 6 numbers and one modulus, `
      + `P(at least one exact multiple) = 1-(21/22)^6 = ${((1 - (21 / 22) ** 6) * 100).toFixed(1)}%, so this is expected, not a signal.`
    : 'No count is an exact multiple of 22.';
  report.verdict = 'FAILED AS STATED, and for an instructive reason: the 100% is coverage, which equidistribution '
    + 'guarantees at this size, and the only exact correspondence is the trivial unison. A correspondence claim '
    + 'needs a rule that maps a specific group to a specific shruti, and no such rule is stated or recovered here.';
}

console.log('[shruti] A. octave-normalised serial numbers');
for (const k of ['mpg122', 'msg1651']) {
  const v = report.A_serialNumbers[k];
  console.log(`  ${k}: n=${v.n} maximum nearest distance ${(v.maxNearestDistanceOctaves * 100).toFixed(3)}% of an octave; `
    + `coverage ${v.coverageAt1percent}/22 @1%, ${v.coverageAt0_1percent}/22 @0.1%, ${v.coverageAt0_01percent}/22 @0.01%; `
    + `exact hits ${v.exactHits}`);
}
console.log(`  null 1651: full coverage in ${(report.A_serialNumbers.null1651.shareFullCoverage * 100).toFixed(1)}% of random trials`);
console.log(`  exact-hit values: ${report.A_serialNumbers.msg1651.exactHitValues.join(', ')}`);
console.log('[shruti] B. counts mod 22');
for (const [k, v] of Object.entries(report.B_counts)) {
  if (k === 'reading' || typeof v !== 'object') continue;
  console.log(`  ${k} = ${v.value} → ${v.value} mod 22 = ${v.mod22}${v.exactMultipleOf22 ? '  (exact multiple)' : ''}`);
}
console.log(`[shruti] ${report.verdict}`);

if (argv.includes('--write')) {
  const out = path.join(ROOT, 'knowledge/relations/shruti-correspondence.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[written] ${path.relative(ROOT, out)}`);
}
