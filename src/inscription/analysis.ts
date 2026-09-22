export type InscriptionTime = {
  year?: string;
  month?: string;
  dayGanzhi?: string;
};

export type InscriptionAnalysis = {
  mode: "inscription";
  input: string;
  normalized: string;
  time: InscriptionTime;
  actor?: string;
  location?: string;
  commandClause?: string;
  eventStatus?: string;
  rewards: string[];
  purpose?: string;
  blessing?: string;
  containsThree: boolean;
  threeOccurrences: number;
  signals: string[];
};

const GAN = "甲乙丙丁戊己庚辛壬癸";
const ZHI = "子丑寅卯辰巳午未申酉戌亥";

function countChar(txt: string, ch: string) {
  let cnt = 0;
  for (const c of txt) {
    if (c === ch) {
      cnt++;
    }
  }
  return cnt;
}

export function normalizeInscriptionText(txt: string) {
  return (txt || "")
    .replace(/[\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .replace(/[「『]/g, "“")
    .replace(/[」』]/g, "”")
    .trim();
}

export function analyzeInscription(txt: string): InscriptionAnalysis {
  const normalized = normalizeInscriptionText(txt);
  const timeMatch = normalized.match(
    new RegExp(`[隹惟唯]([^，。；]+?)年([^，。；]+?)月([${GAN}][${ZHI}])`)
  );

  const time: InscriptionTime = {
    year: timeMatch ? `${timeMatch[1]}年` : undefined,
    month: timeMatch ? `${timeMatch[2]}月` : undefined,
    dayGanzhi: timeMatch ? timeMatch[3] : undefined,
  };

  const actorMatch = normalized.match(/(王)在/);
  const locationMatch = normalized.match(/王在([^，。；]+)/);
  const commandQuotedMatch = normalized.match(/令“(.+?)”/);
  const commandPlainMatch = normalized.match(/令(.+?)(?:休又成事|成事)/);
  const rewardsMatch = normalized.match(/(?:休又)?成事，(.+?)，用乍彝/);
  const blessingMatch = normalized.match(/颂其(.+?)(?:。|$)/);

  const rewards = rewardsMatch
    ? rewardsMatch[1]
        .split(/[、，]/)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

  const commandClause = commandQuotedMatch
    ? commandQuotedMatch[1]
    : commandPlainMatch
    ? commandPlainMatch[1].replace(/^[，。]+|[，。]+$/g, "")
    : undefined;

  const purpose = normalized.includes("用乍彝") ? "用乍彝" : undefined;

  const signals = [
    time.year ? "time" : undefined,
    locationMatch ? "location" : undefined,
    commandClause ? "command" : undefined,
    normalized.includes("成事") ? "completion" : undefined,
    rewards.length ? "rewards" : undefined,
    purpose ? "artifact" : undefined,
    blessingMatch ? "blessing" : undefined,
  ].filter(Boolean) as string[];

  return {
    mode: "inscription",
    input: txt,
    normalized,
    time,
    actor: actorMatch ? actorMatch[1] : undefined,
    location: locationMatch ? locationMatch[1] : undefined,
    commandClause,
    eventStatus: normalized.includes("成事") ? "成事" : undefined,
    rewards,
    purpose,
    blessing: blessingMatch ? blessingMatch[1] : undefined,
    containsThree: normalized.includes("三"),
    threeOccurrences: countChar(normalized, "三"),
    signals,
  };
}

