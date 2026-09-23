#!/usr/bin/env node
// Modern exact arithmetic reconstruction; no historical or native execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bindings = {
  checker_sha256: sha256(readFileSync(new URL('./check.mjs', import.meta.url))),
  sources_sha256: sha256(readFileSync(new URL('./sources.json', import.meta.url))),
};
const checks = [];
function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  checks.push({ name, status: 'Passed' });
}
const sum = values => values.reduce((a, b) => a + b, 0);
const product = values => values.reduce((a, b) => a * b, 1);
const mod = (value, modulus) => ((value % modulus) + modulus) % modulus;
const observe = (value, moduli) => moduli.map(modulus => mod(value, modulus));
// A positive remainder is a representation in 1..m, not a modular inverse.
const positiveObserve = (value, moduli) =>
  moduli.map(modulus => mod(value, modulus) || modulus);
const complementaryProducts = values =>
  values.map((_, omitted) => product(values.filter((_, i) => i !== omitted)));

const originalNumbers = [1, 2, 3, 4];
const firstComplementaryProducts = complementaryProducts(originalNumbers);
check('original complementary products', firstComplementaryProducts, [24, 12, 8, 6]);
check('original complementary products sum', sum(firstComplementaryProducts), 50);

const adjustedNumbers = [1, 1, 3, 4];
const modulus = product(adjustedNumbers);
const adjustedComplementaryProducts = complementaryProducts(adjustedNumbers);
check('adjusted product', modulus, 12);
check('adjusted complementary products', adjustedComplementaryProducts, [12, 12, 4, 3]);
const multipliers = [1, 1, 1, 3];
const coefficients37 = adjustedComplementaryProducts.map((value, i) => value * multipliers[i]);
check('coefficients before representative adjustment', coefficients37, [12, 12, 4, 9]);
check('coefficient sum before representative adjustment', sum(coefficients37), 37);
const coefficients49 = coefficients37.map((value, i) => value + (i === 1 ? modulus : 0));
check('coefficients after representative adjustment', coefficients49, [12, 24, 4, 9]);
check('coefficient sum after representative adjustment', sum(coefficients49), 49);
const coefficientChanges = coefficients49.map((value, i) => value - coefficients37[i]);
check('representative changes are multiples of twelve', observeChanges(coefficientChanges), [0, 0, 0, 0]);
check('three is an inverse of three modulo four', mod(3 * 3, 4), 1);

function observeChanges(changes) {
  return changes.map(value => mod(value, modulus));
}

const yarrowInput = 33;
// Both remainder conventions here use the original divisors 1,2,3,4.
const positiveRemainders = positiveObserve(yarrowInput, originalNumbers);
const standardRemainders = observe(yarrowInput, originalNumbers);
check('positive remainders of thirty-three', positiveRemainders, [1, 1, 3, 1]);
check('standard remainders of thirty-three', standardRemainders, [0, 1, 0, 1]);
check('the two remainder conventions differ', positiveRemainders.some((x, i) => x !== standardRemainders[i]), true);
const weightedTerms = positiveRemainders.map((value, i) => value * coefficients49[i]);
const weightedSum = sum(weightedTerms);
const reducedValue = mod(weightedSum, modulus);
// Qin's stated divisor for the image number is three; a remaining fraction
// is counted as one. Only the nonzero reduced value nine is exercised here.
const imageDivisor = 3;
const imageNumber = Math.ceil(reducedValue / imageDivisor);
check('weighted terms', weightedTerms, [12, 24, 12, 9]);
check('weighted sum', weightedSum, 57);
check('weighted sum remainder', reducedValue, 9);
check('image number for the declared nonzero remainder', imageNumber, 3);

const selectors = [4, 9];
check('selector four projects to one and zero', observe(selectors[0], [3, 4]), [1, 0]);
check('selector nine projects to zero and one', observe(selectors[1], [3, 4]), [0, 1]);
check('selectors are idempotent modulo twelve', selectors.map(x => mod(x * x, modulus)), selectors);
check('selectors are orthogonal modulo twelve', mod(product(selectors), modulus), 0);
check('selectors sum to one modulo twelve', mod(sum(selectors), modulus), 1);
const reconstruct = residues => mod(residues[0] * selectors[0] + residues[1] * selectors[1], modulus);

// The checker gathers fibres by direct integer enumeration, independently of
// the reconstruction formula. The fixed domain is exactly 0 <= x < 12.
const domain = Array.from({ length: modulus }, (_, x) => x);
function collectFibres(moduli) {
  const fibres = new Map();
  for (const x of domain) {
    const observation = observe(x, moduli);
    const key = JSON.stringify(observation);
    if (!fibres.has(key)) fibres.set(key, { observation, members: [] });
    fibres.get(key).members.push(x);
  }
  return [...fibres.values()];
}
const fibres34 = collectFibres([3, 4]);
check('joint three-four observation has twelve fibres', fibres34.length, 12);
check('joint fibres are singleton', fibres34.map(fibre => fibre.members.length), Array(12).fill(1));
const reconstructions = fibres34.map(fibre => ({
  ...fibre,
  reconstructed: reconstruct(fibre.observation),
}));
check('all enumerated fibres agree with CRT reconstruction',
  reconstructions.map(row => row.reconstructed),
  reconstructions.map(row => row.members[0]));

const observationFamilies = [[3, 4], [1, 3, 4], [2, 3, 4], [1, 2, 3, 4]];
const fibreCounts = observationFamilies.map(moduli => ({ moduli, count: collectFibres(moduli).length }));
check('moduli one and two add no distinction to three-four observation', fibreCounts.map(row => row.count), [12, 12, 12, 12]);
check('modulo two is already determined by modulo four', domain.map(x => mod(x, 2) === mod(mod(x, 4), 2)), Array(12).fill(true));
check('modulo one has only zero as its standard remainder', domain.map(x => mod(x, 1)), Array(12).fill(0));
const aliases = [9, 21, 33].map(value => ({
  value,
  in_declared_domain: value >= 0 && value < modulus,
  observation: observe(value, originalNumbers),
}));
check('nine twenty-one and thirty-three have the same observation', aliases.map(row => row.observation), Array.from({ length: 3 }, () => [0, 1, 0, 1]));

const oldCalibrationReplay = {
  source: 5,
  moduli: [3, 4],
  honest_observation: observe(5, [3, 4]),
  altered_observation: [0, 1],
  attribution: 'Replays adva-library calibrations/crt-source-boundary-v0; not a new finding.',
};
oldCalibrationReplay.honest_reconstruction = reconstruct(oldCalibrationReplay.honest_observation);
oldCalibrationReplay.altered_reconstruction = reconstruct(oldCalibrationReplay.altered_observation);
check('old calibration honest observation', oldCalibrationReplay.honest_observation, [2, 1]);
check('old calibration honest reconstruction', oldCalibrationReplay.honest_reconstruction, 5);
check('old calibration altered reconstruction', oldCalibrationReplay.altered_reconstruction, 9);
check('old calibration altered answer differs from source', oldCalibrationReplay.altered_reconstruction !== oldCalibrationReplay.source, true);

const report = {
  schema: 'wenyan-relation-learning.qin-dayan-arithmetic-check.v1',
  status: 'FiniteArithmeticReconstructionChecked',
  scope: 'modern arithmetic reconstruction',
  native_calls: 0,
  historical_algorithm_replay: 'NotRun',
  zero_residue_yarrow_endpoint: 'NotChecked',
  semantic_mapping: 'NotEstablished',
  bindings,
  checks_count: checks.length,
  checks,
  arithmetic: {
    original_numbers: originalNumbers,
    original_complementary_products: firstComplementaryProducts,
    original_sum: sum(firstComplementaryProducts),
    adjusted_numbers: adjustedNumbers,
    modulus,
    adjusted_complementary_products: adjustedComplementaryProducts,
    multipliers,
    coefficients_before_adjustment: coefficients37,
    coefficients_after_adjustment: coefficients49,
    coefficient_changes: coefficientChanges,
    yarrow_input: yarrowInput,
    remainder_divisors: originalNumbers,
    positive_remainders: positiveRemainders,
    standard_remainders: standardRemainders,
    weighted_terms: weightedTerms,
    weighted_sum: weightedSum,
    reduced_value: reducedValue,
    image_divisor: imageDivisor,
    image_number: imageNumber,
  },
  modern_crt: {
    moduli: [3, 4],
    selectors,
    domain: { lower_inclusive: 0, upper_exclusive: modulus },
    reconstructions,
    fibre_counts: fibreCounts,
    alias_witnesses: aliases,
  },
  old_calibration_replay: oldCalibrationReplay,
  boundaries: [
    'The multipliers attached to modulus one are bookkeeping values, not inverse witnesses.',
    'The positive remainder convention uses representatives 1..m and differs from ordinary representatives 0..m-1.',
    'The image-number check uses only input 33 and its nonzero reduced value 9; no zero-remainder endpoint is interpreted.',
    'Uniqueness is checked only in [0,12); the listed outside-domain aliases remain distinct integers.',
    'CRT reconstruction does not establish source fidelity; the altered-observation example repeats an existing calibration.',
    'This arithmetic does not replay Qin Jiushao\'s full historical procedure or establish a mapping to Adva, hexagrams, Taixuan, or role semantics.',
    'The source digest binds the companion manifest bytes; it does not validate the manifest\'s historical claims.',
  ],
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
