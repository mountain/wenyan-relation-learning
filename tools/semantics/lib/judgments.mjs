/**
 * Judgement store for the semantic layer.
 *
 * A syntax label can be checked by pointing at the span it describes. A semantic
 * judgement cannot be checked that way — the text does not witness that two
 * strings mean the same thing — so the warrant chain necessarily ends in a
 * declared judgement. This module stores those judgements and reconciles them.
 *
 * THE ONE THING THAT DOES NOT TRANSFER FROM THE GRAMMAR LAYER
 * There, two conflicting labels on the same text mean one of them is WRONG, and
 * `replay` throws. Here, two conflicting judgements may BOTH be defensible: on a
 * real text, "他们 refers to 我的怨敌" and "他们 refers to 新式的人" can be a
 * genuine disagreement rather than an error. Treating that as corruption would
 * brick the store; treating it as agreement would be a lie. Hence Contested:
 * a LOCAL state that names both sides and blocks nothing else.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalJson } from '../../knowledge/store.mjs';

export const JUDGMENT_SCHEMA = 'wenyan.semantics.judgment.v1';

/** Fields that identify a claim. Anything not listed here is not part of identity. */
const IDENTITY_FIELDS = [
  'type', 'text', 'span', 'link', 'form', 'meaning', 'act',
  'word', 'layerA', 'layerB', 'relation',
];

/** Canonical form of a claim: identity fields only, keys sorted at every level. */
export function canonicalClaim(claim) {
  const picked = {};
  for (const k of IDENTITY_FIELDS) if (claim?.[k] !== undefined) picked[k] = claim[k];
  return canonicalJson(picked);
}

export function claimHash(claim) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalClaim(claim)), 'utf8')
    .digest('hex');
}

export function judgmentHash(record) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalJson({
      claimHash: record.claimHash,
      verdict: record.verdict,
      judge: record.judge,
    })), 'utf8')
    .digest('hex');
}

/**
 * Build one judgement record.
 * @param {object} o
 * @param {object} o.claim   the claim being judged (identity fields)
 * @param {'holds'|'fails'} o.verdict
 * @param {object} o.judge   {kind, by, at, basis} — provenance is mandatory (S5)
 */
export function makeJudgment({ id, claim, verdict, judge, note = null, evidence = null }) {
  if (!claim || typeof claim.type !== 'string' || !claim.type) throw new Error('claim.type is required');
  if (!claim.text) throw new Error('claim.text is required');
  if (!['holds', 'fails'].includes(verdict)) throw new Error(`invalid verdict: ${verdict}`);
  if (!judge || !judge.kind || !judge.by || !judge.basis) {
    throw new Error('S5 violated: a judgement must name its kind, judge and basis');
  }
  const record = {
    schema: JUDGMENT_SCHEMA,
    id: id ?? `${claim.type}:${claimHash(claim).slice(0, 12)}:${judge.by}:${verdict}`,
    claimHash: claimHash(claim),
    claim: canonicalClaim(claim),
    verdict,
    judge,
    ...(evidence ? { evidence } : {}),
    ...(note ? { note } : {}),
  };
  record.contentHash = judgmentHash(record);
  return record;
}

/** Idempotent by (claim, verdict, judge): re-recording the same judgement is a no-op. */
export function appendJudgment(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = loadJudgments(file).records;
  const clash = existing.find((r) => r.contentHash === record.contentHash);
  if (clash) return { appended: false, reason: 'identical-judgement-already-present', id: clash.id };
  if (existing.some((r) => r.id === record.id)) {
    throw new Error(`duplicate judgement id with different content: ${record.id}`);
  }
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return { appended: true, id: record.id };
}

export function loadJudgments(file) {
  if (!fs.existsSync(file)) return { records: [], issues: [] };
  const records = [];
  const issues = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    let r;
    try { r = JSON.parse(t); } catch (e) {
      issues.push(`line ${i + 1}: not valid JSON (${e.message})`);
      return;
    }
    if (r.schema !== JUDGMENT_SCHEMA) issues.push(`line ${i + 1}: wrong schema ${r.schema}`);
    if (r.claimHash !== claimHash(r.claim)) issues.push(`line ${i + 1}: claimHash mismatch (claim edited or tampered)`);
    if (r.contentHash !== judgmentHash(r)) issues.push(`line ${i + 1}: contentHash mismatch (record tampered)`);
    if (!r.judge?.by || !r.judge?.basis) issues.push(`line ${i + 1}: S5 violated — judgement without judge/basis`);
    records.push(r);
  });
  return { records, issues };
}

/**
 * Reconcile the judgements recorded about one claim.
 *
 * Deliberately NOT a vote: a majority does not settle a claim. Disagreement
 * stays visible as Contested, with both sides named.
 * @returns {{state:'Answered'|'Contested'|'Unknown', ...}}
 */
export function evaluateClaim(records, claim) {
  const hash = claimHash(claim);
  const mine = records.filter((r) => r.claimHash === hash);
  if (!mine.length) {
    return {
      state: 'Unknown',
      reason: 'no-judgement-recorded',
      missing: 'at least one recorded judgement about this claim (S4: absence of a judgement is never a verdict)',
      claimHash: hash,
    };
  }
  const holds = mine.filter((r) => r.verdict === 'holds');
  const fails = mine.filter((r) => r.verdict === 'fails');
  if (holds.length && fails.length) {
    return {
      state: 'Contested',
      claimHash: hash,
      reason: `${holds.length} judgement(s) hold the claim and ${fails.length} reject it`,
      disagreement: {
        about: `verdict disagreement on ${claim.type} claim`,
        holds: holds.map((r) => ({ id: r.id, by: r.judge.by, basis: r.judge.basis })),
        fails: fails.map((r) => ({ id: r.id, by: r.judge.by, basis: r.judge.basis })),
      },
      warrant: {
        kind: 'judgement',
        refs: mine.map((r) => r.id),
        derivation: 'all recorded judgements about this claim, both sides named; no majority is taken',
      },
    };
  }
  return {
    state: 'Answered',
    claimHash: hash,
    verdict: holds.length ? 'holds' : 'fails',
    judges: mine.length,
    warrant: {
      kind: 'judgement',
      refs: mine.map((r) => r.id),
      derivation: `${mine.length} recorded judgement(s), unanimous`,
    },
  };
}

/** How many distinct claims have judgements, and how they resolve. */
export function storeSummary(records) {
  const byClaim = new Map();
  for (const r of records) {
    if (!byClaim.has(r.claimHash)) byClaim.set(r.claimHash, []);
    byClaim.get(r.claimHash).push(r);
  }
  const summary = { claims: byClaim.size, Answered: 0, Contested: 0, byType: {}, conceded: [] };
  for (const [, list] of byClaim) {
    const v = evaluateClaim(records, list[0].claim);
    summary[v.state] = (summary[v.state] ?? 0) + 1;
    const t = list[0].claim.type;
    summary.byType[t] = summary.byType[t] ?? { claims: 0, Contested: 0 };
    summary.byType[t].claims++;
    if (v.state === 'Contested') {
      summary.byType[t].Contested++;
      summary.conceded.push({ type: t, claim: list[0].claim, reason: v.reason });
    }
  }
  return summary;
}
