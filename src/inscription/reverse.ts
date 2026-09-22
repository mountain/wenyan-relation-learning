import { analyzeInscription, InscriptionAnalysis } from "./analysis";

export type TriComputeState = {
  observation: number;
  action: number;
  memory: number;
  evidence: {
    observation: string[];
    action: string[];
    memory: string[];
  };
};

export type ReverseScoringProfile = {
  weights?: {
    containsThree?: number;
    structure?: number;
    style?: number;
  };
  thresholds?: {
    working?: number;
    strong?: number;
  };
};

export type ReverseProfilePresetName = "seed" | "oracle" | "strict";

export type ReverseTarget = {
  mustContainThree?: boolean;
  preferOracleTone?: boolean;
  profilePreset?: ReverseProfilePresetName;
  profile?: ReverseScoringProfile;
};

export type ReverseResult = {
  analysis: InscriptionAnalysis;
  state: TriComputeState;
  convergenceScore: number;
  hypothesis: string;
  hypothesisMeta: {
    isNewHypothesis: true;
    confidenceBand: "exploratory" | "working" | "strong";
    note: string;
  };
  matched: {
    containsThree: boolean;
    oracleToneScore: number;
  };
};

function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function average(nums: number[]) {
  if (!nums.length) {
    return 0;
  }
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Markers used to score "oracle tone": characters/formulas characteristic of
 * bronze-inscription language.
 *
 * Each entry is a group of spelling variants for ONE marker; the group counts as
 * a single hit if any of its variants occurs, so the denominator stays 8 and
 * existing profiles and thresholds remain comparable.
 *
 * Variants exist because the original list was written in simplified characters
 * only, while classical corpora are normally traditional. `贞` could therefore
 * never match `貞` — which occurs in 154 passages of the wenyan.corpus.v1
 * classical corpus and 171 times in 周易 alone, precisely the divination
 * vocabulary this function is meant to detect — silently capping the score at
 * 6/8 regardless of input. Both forms are accepted so neither simplified nor
 * traditional text is penalised.
 */
const ORACLE_TONE_MARKER_GROUPS: readonly (readonly string[])[] = [
  ["王在"],
  ["令"],
  ["成事"],
  ["用乍"],
  ["万年", "萬年"],
  ["永宝用", "永寶用"],
  ["卜"],
  ["贞", "貞"],
];

function scoreOracleTone(analysis: InscriptionAnalysis) {
  let hits = 0;
  for (const variants of ORACLE_TONE_MARKER_GROUPS) {
    if (variants.some((marker) => analysis.normalized.includes(marker))) {
      hits++;
    }
  }
  return hits / ORACLE_TONE_MARKER_GROUPS.length;
}

const DEFAULT_PROFILE = {
  weights: {
    containsThree: 0.5,
    structure: 0.3,
    style: 0.2,
  },
  thresholds: {
    working: 0.6,
    strong: 0.8,
  },
};

const REVERSE_PROFILE_PRESETS: Record<
  ReverseProfilePresetName,
  ReverseScoringProfile
> = {
  seed: {
    weights: { containsThree: 0.45, structure: 0.35, style: 0.2 },
    thresholds: { working: 0.58, strong: 0.78 },
  },
  oracle: {
    weights: { containsThree: 0.55, structure: 0.25, style: 0.2 },
    thresholds: { working: 0.6, strong: 0.82 },
  },
  strict: {
    weights: { containsThree: 0.5, structure: 0.3, style: 0.2 },
    thresholds: { working: 0.75, strong: 0.9 },
  },
};

export function getReverseProfilePreset(
  name: ReverseProfilePresetName
): ReverseScoringProfile {
  return REVERSE_PROFILE_PRESETS[name];
}

function resolveProfile(
  profile?: ReverseScoringProfile,
  presetName: ReverseProfilePresetName = "seed"
) {
  const preset = getReverseProfilePreset(presetName);
  return {
    weights: {
      containsThree:
        profile?.weights?.containsThree ??
        preset.weights?.containsThree ??
        DEFAULT_PROFILE.weights.containsThree,
      structure:
        profile?.weights?.structure ??
        preset.weights?.structure ??
        DEFAULT_PROFILE.weights.structure,
      style:
        profile?.weights?.style ??
        preset.weights?.style ??
        DEFAULT_PROFILE.weights.style,
    },
    thresholds: {
      working:
        profile?.thresholds?.working ??
        preset.thresholds?.working ??
        DEFAULT_PROFILE.thresholds.working,
      strong:
        profile?.thresholds?.strong ??
        preset.thresholds?.strong ??
        DEFAULT_PROFILE.thresholds.strong,
    },
  };
}

function weightedAverage(values: number[], weights: number[]) {
  const pairCount = Math.min(values.length, weights.length);
  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < pairCount; i++) {
    const w = Math.max(0, weights[i]);
    weighted += values[i] * w;
    weightSum += w;
  }
  if (weightSum <= 0) {
    return average(values);
  }
  return weighted / weightSum;
}

function confidenceBandOf(
  score: number,
  thresholds: { working: number; strong: number }
): "exploratory" | "working" | "strong" {
  const strongThreshold = Math.max(thresholds.working, thresholds.strong);
  if (score >= strongThreshold) {
    return "strong";
  }
  if (score >= thresholds.working) {
    return "working";
  }
  return "exploratory";
}

export function forwardTriCompute(
  analysis: InscriptionAnalysis
): TriComputeState {
  const observationEvidence = [
    analysis.time.year ? "time" : undefined,
    analysis.location ? "location" : undefined,
    analysis.actor ? "actor" : undefined,
  ].filter(Boolean) as string[];

  const actionEvidence = [
    analysis.commandClause ? "command" : undefined,
    analysis.eventStatus ? "completion" : undefined,
    analysis.rewards.length ? "reward" : undefined,
  ].filter(Boolean) as string[];

  const memoryEvidence = [
    analysis.purpose ? "artifact" : undefined,
    analysis.blessing ? "blessing" : undefined,
    analysis.containsThree ? "contains-three" : undefined,
  ].filter(Boolean) as string[];

  return {
    observation: clamp01(observationEvidence.length / 3),
    action: clamp01(actionEvidence.length / 3),
    memory: clamp01(memoryEvidence.length / 3),
    evidence: {
      observation: observationEvidence,
      action: actionEvidence,
      memory: memoryEvidence,
    },
  };
}

export function reverseTriCompute(
  txt: string,
  target: ReverseTarget = {}
): ReverseResult {
  const analysis = analyzeInscription(txt);
  const state = forwardTriCompute(analysis);
  const oracleToneScore = scoreOracleTone(analysis);

  const wantsThree = target.mustContainThree !== false;
  const containsThreeScore = wantsThree ? (analysis.containsThree ? 1 : 0) : 1;

  const profile = resolveProfile(
    target.profile,
    target.profilePreset ?? "seed"
  );

  const structureScore = average([
    state.observation,
    state.action,
    state.memory,
  ]);
  const styleScore = target.preferOracleTone === false ? 1 : oracleToneScore;
  const convergenceScore = clamp01(
    weightedAverage(
      [containsThreeScore, structureScore, styleScore],
      [
        profile.weights.containsThree,
        profile.weights.structure,
        profile.weights.style,
      ]
    )
  );

  const band = confidenceBandOf(convergenceScore, profile.thresholds);

  const hypothesisBody = analysis.containsThree
    ? "贞：三事其成，用乍彝，子孙永宝用。"
    : "贞：其事其成，用乍彝，子孙永宝用。";
  const hypothesis = `【新假设（实验性）】${hypothesisBody}`;

  return {
    analysis,
    state,
    convergenceScore,
    hypothesis,
    hypothesisMeta: {
      isNewHypothesis: true,
      confidenceBand: band,
      note: "This sentence is a newly introduced experimental hypothesis for reverse convergence, not an established philological conclusion.",
    },
    matched: {
      containsThree: analysis.containsThree,
      oracleToneScore,
    },
  };
}

