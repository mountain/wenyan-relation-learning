/**
 * Can a captured span be stated truthfully as that ROLE?
 *
 * The frame's entity pattern is an unquoted run, so real text hands back spans that
 * cannot be labelled: `於是武王遍告諸侯曰` yields agent `於是武王遍`, `厲聲謂曰` yields
 * `厲聲` (an adverbial), `樅公相謂曰` yields `樅公相`, `野語有之曰` yields `野`. Storing
 * any of them as the agent ASSERTS SOMETHING FALSE about who spoke, which the evidence
 * discipline forbids.
 *
 * This module is the SINGLE SOURCE of those criteria. Two callers depend on it and must
 * not grow their own copies:
 *   1. tools/grammar/seed-reporting.mjs  — refuses to write an inadmissible label
 *   2. tools/knowledge/conflations.mjs   — audits the LIVE store for records that
 *      slipped in before the filter existed
 *
 * Without the second caller the rule would be a claim about the seeder rather than a
 * property of the store — and "the file says so" is not "the store obeys it".
 */

/** Declared verbatim in tools/grammar/contract.json as labelAdmissibility. */
export const PARTICLE_PREFIX =
  /^(且|復|亦|又|乃|遂|蓋|故|而|則|皆|盡|共|竊|嘗|數|相|於是|因|既|始|方|將|欲|敢|請|可|不|傳|使|若|夫|今|昔|初|後|其|之|以|為|所|與|野)/;
export const PARTICLE_SUFFIX = /(且|復|亦|又|乃|遂|蓋|故|而|則|皆|盡|共|竊|嘗|數|相|有|以|傳|歸)$/;
/** Reporting verbs, prepositions and the interrogative particle may not be a slot value. */
export const VERBISH = /[曰謂問告語於于乎]/;

export function admissibleAgent(v) {
  if (typeof v !== 'string' || !v || v.length > 5) return false;
  if (PARTICLE_PREFIX.test(v) || PARTICLE_SUFFIX.test(v)) return false;
  return !VERBISH.test(v);
}

/**
 * A prepositional recipient (`於子貢`, `于樂正`, `乎長梧子`) records the wrong span — the
 * preposition belongs to the construction, not to the addressee. A pronominal one
 * (`人`, `余`, `之`) IS the recipient expression and is kept.
 */
export function admissibleRecipient(v) {
  if (typeof v !== 'string' || !v || v.length > 5) return false;
  if (VERBISH.test(v) || /者$/.test(v) || /^有/.test(v)) return false;
  return true;
}

/** Why a span is refused, for reports. Returns null when it is admissible. */
export function inadmissibleReason(role, value) {
  if (typeof value !== 'string' || !value) return `${role} is empty`;
  if (value.length > 5) return `${role} is ${value.length} characters (max 5)`;
  if (role === 'agent') {
    if (PARTICLE_PREFIX.test(value)) return `agent ${JSON.stringify(value)} begins with a particle or adverb`;
    if (PARTICLE_SUFFIX.test(value)) return `agent ${JSON.stringify(value)} ends with a particle or adverb`;
    if (VERBISH.test(value)) return `agent ${JSON.stringify(value)} contains a reporting verb or preposition`;
    return null;
  }
  if (role === 'recipient') {
    if (VERBISH.test(value)) {
      return /^(於|于|乎)/.test(value)
        ? `recipient ${JSON.stringify(value)} carries the preposition, which belongs to the construction`
        : `recipient ${JSON.stringify(value)} contains a reporting verb`;
    }
    if (/者$/.test(value)) return `recipient ${JSON.stringify(value)} ends in 者, so it is not the addressee expression`;
    if (/^有/.test(value)) return `recipient ${JSON.stringify(value)} begins with the existential 有`;
    return null;
  }
  return null;
}
