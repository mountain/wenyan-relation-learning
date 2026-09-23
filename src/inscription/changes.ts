/** SPDX-License-Identifier: MIT
 * Finite six-position research grammar. Design: Mingli Yuan.
 * Implementation: Codex (OpenAI), 2026-09-23, via Mingli's account.
 * Bits run from the bottom line to the top. No divination or Adva semantics.
 */
export type HexagramBits = string;
export type ChangeSource = {
  work: string; section: string; passageId: string; sourcePage: string;
  sourceRevid: number; passageHash: string; start: number; end: number;
  license: unknown;
};
export type ChangeLine = {
  position: number; label: string; text: string; source: ChangeSource;
};
export type ChangeEntry = {
  ordinal: number; name: string; bits: HexagramBits;
  statement: { text: string; source: ChangeSource };
  lines: ChangeLine[]; extra: { label: string; text: string; source: ChangeSource }[];
};
export type ChangesCatalog = { schema: "wenyan.changes.catalog.v1"; entries: ChangeEntry[] };

export function checkBits(bits: string): string {
  if (typeof bits !== "string" || !/^[01]{6}$/.test(bits)) throw new Error("expected six bottom-to-top bits");
  return bits;
}
export function checkPosition(position: number): number {
  if (!Number.isInteger(position) || position < 1 || position > 6) throw new Error("position must be 1..6");
  return position;
}
/** Return fresh arrays: callers cannot mutate the authoritative pairings. */
export function positionPairings() {
  return { strata: [[1, 2], [3, 4], [5, 6]], correspondence: [[1, 4], [2, 5], [3, 6]] };
}
export function hexagrams(): string[] {
  return Array.from({ length: 64 }, (_, n) => Array.from({ length: 6 }, (_, i) => (n >> i) & 1).join(""));
}
export function changeLines(bits: string, positions: number[]): string {
  checkBits(bits);
  if (!Array.isArray(positions) || positions.length > 6 || new Set(positions).size !== positions.length)
    throw new Error("moving positions must be distinct");
  const out = bits.split("");
  for (const p of positions) { checkPosition(p); out[p - 1] = out[p - 1] === "1" ? "0" : "1"; }
  return out.join("");
}
export function transformHexagram(bits: string, kind: "complement" | "reverse" | "exchange-trigrams"): string {
  checkBits(bits);
  if (kind === "complement") return bits.split("").map(x => x === "1" ? "0" : "1").join("");
  if (kind === "reverse") return bits.split("").reverse().join("");
  if (kind === "exchange-trigrams") return bits.slice(3) + bits.slice(0, 3);
  throw new Error("undeclared transformation");
}
export function lineContext(bits: string, position: number) {
  checkBits(bits); checkPosition(position);
  const paired = position <= 3 ? position + 3 : position - 3;
  return {
    bits, position, polarity: bits[position - 1] === "1" ? "yang" : "yin",
    lower: bits.slice(0, 3), upper: bits.slice(3),
    central: position === 2 || position === 5,
    proper: Number(bits[position - 1]) === position % 2,
    correspondingPosition: paired,
    oppositeAtCorrespondence: bits[position - 1] !== bits[paired - 1],
    // These are structural observations, never good/bad or valid/invalid.
  };
}
export function validateCatalog(catalog: ChangesCatalog): void {
  if (!catalog || catalog.schema !== "wenyan.changes.catalog.v1" || !Array.isArray(catalog.entries)
      || catalog.entries.length !== 64) throw new Error("invalid changes catalog");
  const names = new Set<string>(), words = new Set<string>(), ordinals = new Set<number>();
  for (const e of catalog.entries) {
    checkBits(e.bits);
    if (!Number.isInteger(e.ordinal) || e.ordinal < 1 || e.ordinal > 64 || typeof e.name !== "string" || !e.name
        || names.has(e.name) || words.has(e.bits) || ordinals.has(e.ordinal)) throw new Error("duplicate or invalid hexagram");
    names.add(e.name); words.add(e.bits); ordinals.add(e.ordinal);
    if (!Array.isArray(e.lines) || e.lines.length !== 6 || !e.statement || typeof e.statement.text !== "string")
      throw new Error("incomplete line or statement index");
    e.lines.forEach((l, i) => {
      if (l.position !== i + 1 || typeof l.text !== "string" || !l.text || !l.source)
        throw new Error("invalid line index");
    });
  }
}

/** A controlled inquiry, not a parser for arbitrary classical prose. */
export function readChanges(text: string, catalog: ChangesCatalog) {
  validateCatalog(catalog);
  const m = typeof text === "string" && text.length <= 128
    ? /^(?:觀|观)「([^「」\r\n]{1,12})」(?:之([初二三四五上])爻)?。?$/.exec(text) : null;
  if (!m) return { status: "Unknown", reason: "outside-changes-inquiry-grammar" };
  const entry = catalog.entries.find(e => e.name === m[1]);
  if (!entry) return { status: "Unknown", reason: "hexagram-name-not-in-catalog" };
  if (!m[2]) return { status: "IndexedText", entry, authority: "source-index-only", sourceVerification: "caller-supplied-catalog" };
  const position = "初二三四五上".indexOf(m[2]) + 1;
  const context = lineContext(entry.bits, position);
  const changedBits = changeLines(entry.bits, [position]);
  const target = catalog.entries.find(e => e.bits === changedBits)!;
  return { status: "IndexedText", hexagram: entry.name, context, line: entry.lines[position - 1],
    change: { convention: "single-line-flip", bits: changedBits, hexagram: target.name },
    authority: "source-index-and-declared-combinatorics", sourceVerification: "caller-supplied-catalog" };
}
