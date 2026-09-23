/** SPDX-License-Identifier: MIT
 * Exact categorical syllogisms in two declared first-order set semantics.
 * Complete small-model check: only occupancy of the eight S/M/P atoms matters.
 */
import { checkBits } from "./changes";
export type PropositionKind = "A" | "E" | "I" | "O";
export type ExistentialPolicy = "boolean" | "terms-nonempty";
export type Syllogism = { mood: string; figure: number; policy: ExistentialPolicy };
const KINDS = ["A", "E", "I", "O"];
const CODES: { [k: string]: string } = { A: "11", E: "10", I: "01", O: "00" };
const WIRES = [[[1, 2], [0, 1]], [[2, 1], [0, 1]], [[1, 2], [1, 0]], [[2, 1], [1, 0]]];

export function checkSyllogism(s: Syllogism): void {
  if (!s || typeof s.mood !== "string" || !/^[AEIO]{3}$/.test(s.mood) || !Number.isInteger(s.figure) || s.figure < 1 || s.figure > 4
      || !["boolean", "terms-nonempty"].includes(s.policy)) throw new Error("invalid syllogism contract");
}
export function moods(): string[] {
  const out: string[] = [];
  for (const a of KINDS) for (const b of KINDS) for (const c of KINDS) out.push(a + b + c);
  return out;
}
export function encodeMood(mood: string): string {
  if (typeof mood !== "string" || !/^[AEIO]{3}$/.test(mood)) throw new Error("invalid mood");
  return mood.split("").map(k => CODES[k][0]).join("") + mood.split("").map(k => CODES[k][1]).join("");
}
export function decodeMood(bits: string): string {
  checkBits(bits);
  return [0, 1, 2].map(i => KINDS.find(k => CODES[k] === bits[i] + bits[i + 3])!).join("");
}
function admits(mask: number, policy: ExistentialPolicy): boolean {
  if (policy === "boolean") return true;
  return [0, 1, 2].every(t => Array.from({ length: 8 }, (_, a) => a).some(a => (mask & (1 << a)) && (a & (1 << t))));
}
function proposition(kind: string, subject: number, predicate: number, mask: number): boolean {
  let yes = false, no = false;
  for (let atom = 0; atom < 8; atom++) {
    if ((mask & (1 << atom)) && (atom & (1 << subject))) {
      if (atom & (1 << predicate)) yes = true; else no = true;
    }
  }
  return kind === "A" ? !no : kind === "E" ? !yes : kind === "I" ? yes : no;
}
export function modelTruth(s: Syllogism, mask: number) {
  checkSyllogism(s);
  if (!Number.isInteger(mask) || mask < 1 || mask > 255) throw new Error("invalid nonempty-universe mask");
  const [major, minor] = WIRES[s.figure - 1];
  return { admissible: admits(mask, s.policy),
    major: proposition(s.mood[0], major[0], major[1], mask),
    minor: proposition(s.mood[1], minor[0], minor[1], mask),
    conclusion: proposition(s.mood[2], 0, 2, mask) };
}
export function checkCountermodel(s: Syllogism, mask: number): boolean {
  const t = modelTruth(s, mask);
  return t.admissible && t.major && t.minor && !t.conclusion;
}
/** Fuel counts visited masks, including those excluded by existential policy. */
export function judgeSyllogism(s: Syllogism, fuel = 255) {
  checkSyllogism(s);
  if (!Number.isInteger(fuel) || fuel < 0 || fuel > 255) throw new Error("fuel must be 0..255");
  let admissible = 0, premisesSatisfied = 0;
  for (let mask = 1; mask <= fuel; mask++) {
    const t = modelTruth(s, mask);
    if (t.admissible) admissible++;
    if (t.admissible && t.major && t.minor) premisesSatisfied++;
    if (t.admissible && t.major && t.minor && !t.conclusion) {
      const atoms = Array.from({ length: 8 }, (_, i) => i).filter(i => mask & (1 << i));
      return { status: "Refuted", checked: mask, contract: { ...s },
        countermodel: { mask, universe: atoms.map(atom => ({ id: `a${atom}`, S: !!(atom & 1), M: !!(atom & 2), P: !!(atom & 4) })) } };
    }
  }
  if (fuel < 255) return { status: "Unknown", reason: "fuel-exhausted", checked: fuel, contract: { ...s } };
  return { status: "Valid", checked: 255, contract: { ...s },
    certificate: { method: "complete-eight-atom-occupancy", admissible, premisesSatisfied } };
}

/** Subjects/predicates are occurrence-sensitive in the retained syntax. */
export function parseSyllogism(text: string, policy: ExistentialPolicy = "boolean") {
  if (!["boolean", "terms-nonempty"].includes(policy)) throw new Error("unknown existential policy");
  if (typeof text !== "string" || text.length > 512) return { status: "Unknown", reason: "outside-syllogism-grammar" };
  const parts = text.split("。");
  if (parts[parts.length - 1] === "") parts.pop();
  if (parts.length !== 3 || !parts[2].startsWith("故")) return { status: "Unknown", reason: "expected-two-premises-and-conclusion" };
  const clauses: { kind: string; subject: string; predicate: string; occurrences: { slot: string; value: string; start: number; end: number }[] }[] = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = i === 2 ? parts[i].slice(1) : parts[i];
    const m = /^(凡|有)「([^「」\r\n]{1,32})」(皆非|皆|非|為|为)「([^「」\r\n]{1,32})」$/.exec(part);
    if (!m || (m[1] === "凡" ? !["皆", "皆非"].includes(m[3]) : !["為", "为", "非"].includes(m[3])))
      return { status: "Unknown", reason: "outside-syllogism-grammar" };
    const kind = m[1] === "凡" ? (m[3] === "皆" ? "A" : "E") : (m[3] === "非" ? "O" : "I");
    const spans: { slot: string; value: string; start: number; end: number }[] = [];
    let cursor = 0;
    for (const [slot, value] of [["subject", m[2]], ["predicate", m[4]]]) {
      const localStart = parts[i].indexOf("「", cursor) + 1;
      const localEnd = parts[i].indexOf("」", localStart); cursor = localEnd + 1;
      spans.push({ slot: `${i}:${slot}`, value, start: offset + localStart, end: offset + localEnd });
    }
    clauses.push({ kind, subject: m[2], predicate: m[4], occurrences: spans }); offset += parts[i].length + 1;
  }
  const S = clauses[2].subject, P = clauses[2].predicate;
  const terms = Array.from(new Set(clauses.reduce<string[]>((a, c) => a.concat([c.subject, c.predicate]), [])));
  if (terms.length !== 3 || S === P) return { status: "Unknown", reason: "requires-three-distinct-term-names" };
  const M = terms.find(t => t !== S && t !== P)!;
  const names = [S, M, P];
  const candidates = WIRES.map((w, i) => ({ w, figure: i + 1 })).filter(({ w }) =>
    [0, 1].every(i => clauses[i].subject === names[w[i][0]] && clauses[i].predicate === names[w[i][1]]));
  if (candidates.length !== 1) return { status: "Unknown", reason: "not-a-standard-figure-in-declared-premise-order" };
  const contract = { mood: clauses.map(c => c.kind).join(""), figure: candidates[0].figure, policy };
  return { status: "Parsed", contract, terms: { S, M, P }, clauses, bits: encodeMood(contract.mood) };
}
export function readSyllogism(text: string, policy: ExistentialPolicy = "boolean", fuel = 255) {
  const parsed = parseSyllogism(text, policy);
  return parsed.status === "Parsed" && parsed.contract
    ? { ...parsed, judgment: judgeSyllogism(parsed.contract, fuel) } : parsed;
}
