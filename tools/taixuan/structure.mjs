// SPDX-License-Identifier: MIT
// Design direction: Mingli Yuan. Implementation: Codex (OpenAI), via Mingli Yuan.
// Coordinates are addresses, not truth values or a six-germ semantic mapping.
export function checkDigits(digits) {
  if (typeof digits !== 'string' || !/^[012]{4}$/.test(digits)) throw new Error('expected four ternary digits');
  return digits;
}
export function checkZan(zan) {
  if (!Number.isInteger(zan) || zan < 1 || zan > 9) throw new Error('expected zan 1..9');
  return zan;
}
export function fromOrdinal(ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 81) throw new Error('expected head 1..81');
  return (ordinal - 1).toString(3).padStart(4, '0');
}
export function toOrdinal(digits) { return parseInt(checkDigits(digits), 3) + 1; }
export function encodeAddress(digits, zan) {
  checkDigits(digits); checkZan(zan);
  return digits + (zan - 1).toString(3).padStart(2, '0');
}
export function decodeAddress(address) {
  if (typeof address !== 'string' || !/^[012]{6}$/.test(address)) throw new Error('expected six ternary address digits');
  return { system: 'taixuan', digits: address.slice(0, 4), zan: parseInt(address.slice(4), 3) + 1 };
}
export function contextFeatures(context) {
  if (!context || Object.keys(context).sort().join(',') !== 'digits,system,zan' || context.system !== 'taixuan')
    throw new Error('expected a typed Taixuan context');
  const { digits, zan } = context; checkDigits(digits); checkZan(zan);
  const [fang, zhou, bu, jia] = [...digits].map(Number);
  return { digits, zan, fang, zhou, bu, jia, phaseGroup: Math.floor((zan - 1) / 3), phaseWithin: (zan - 1) % 3 };
}
// Explicit within-head successor only. No implicit wrap, calendar, or head transition.
export function nextZan(context) {
  contextFeatures(context);
  return context.zan === 9 ? { status: 'Boundary', reason: 'end-of-head', context }
    : { status: 'Next', context: { ...context, zan: context.zan + 1 } };
}
