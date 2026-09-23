import { analyzeInscription, InscriptionAnalysis } from "./analysis";
import { readRelation } from "./relations";
import { readChanges } from "./changes";
import type { ChangesCatalog } from "./changes";
import type { RelationModel, RelationReading } from "./relations";
import {
  forwardTriCompute,
  reverseTriCompute,
  ReverseResult,
  ReverseTarget,
  ReverseScoringProfile,
  getReverseProfilePreset,
  ReverseProfilePresetName,
  TriComputeState,
} from "./reverse";

export type NarrativeGrowth = {
  worldFeatureDensity: number;
  storyHumanCoupling: number;
  learningPulse: number;
};

export type OptimizationSnapshot = {
  accepted: boolean;
  compositeScore: number;
  deltaScore: number;
  bestScore: number;
  reason: "initial" | "improved" | "damped";
};

export type CoIterationStep = {
  step: number;
  target: ReverseTarget;
  reverse: ReverseResult;
  drift: {
    observationGap: number;
    actionGap: number;
    memoryGap: number;
  };
  growth: NarrativeGrowth;
  optimization: OptimizationSnapshot;
};

export type InscriptionPipelineSuccessResult = {
  changes?: ReturnType<typeof readChanges>;
  relation?: RelationReading;
  blocked: false;
  entryWarning: string;
  analysis: InscriptionAnalysis;
  forward: TriComputeState;
  reverse: ReverseResult;
  trajectory: CoIterationStep[];
  growth: NarrativeGrowth;
  optimization: {
    acceptedSteps: number;
    rejectedSteps: number;
    bestScore: number;
  };
};

export type InscriptionPipelineBlockedResult = {
  blocked: true;
  entryWarning: string;
  blockedReason: string;
};

export type InscriptionPipelineResult =
  | InscriptionPipelineSuccessResult
  | InscriptionPipelineBlockedResult;

export const INSCRIPTION_EXPERIMENT_WARNING =
  "[warning] 这不是真实的故事，只是一个探索游戏。";

export const INSCRIPTION_ACK_REQUIRED_WARNING =
  "[warning] 请先确认这不是真实故事、只是探索游戏，然后再继续。";

export type InscriptionPipelineOptions = {
  changes?: { catalog: ChangesCatalog };
  relationModel?: RelationModel;
  steps?: number;
  target?: ReverseTarget;
  optimizer?: {
    damping?: number;
    minGain?: number;
  };
  safety?: {
    requireAcknowledgement?: boolean;
    acknowledged?: boolean;
  };
};

function round3(v: number) {
  return Math.round(v * 1000) / 1000;
}

function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function computeDrift(state: TriComputeState) {
  // A balanced state means the three channels are close after each iteration.
  const mean = (state.observation + state.action + state.memory) / 3;
  return {
    observationGap: round3(Math.abs(state.observation - mean)),
    actionGap: round3(Math.abs(state.action - mean)),
    memoryGap: round3(Math.abs(state.memory - mean)),
  };
}

function computeGrowth(
  state: TriComputeState,
  drift: CoIterationStep["drift"]
): NarrativeGrowth {
  const featureDensity = state.observation;
  const coupling = clamp01((state.action + state.memory) / 2);
  const balance = clamp01(
    1 - (drift.observationGap + drift.actionGap + drift.memoryGap) / 3
  );
  const learningPulse = clamp01(
    0.4 * featureDensity + 0.35 * coupling + 0.25 * balance
  );

  return {
    worldFeatureDensity: round3(featureDensity),
    storyHumanCoupling: round3(coupling),
    learningPulse: round3(learningPulse),
  };
}

function averageGrowth(steps: NarrativeGrowth[]): NarrativeGrowth {
  if (!steps.length) {
    return {
      worldFeatureDensity: 0,
      storyHumanCoupling: 0,
      learningPulse: 0,
    };
  }
  const n = steps.length;
  return {
    worldFeatureDensity: round3(
      steps.reduce((acc, x) => acc + x.worldFeatureDensity, 0) / n
    ),
    storyHumanCoupling: round3(
      steps.reduce((acc, x) => acc + x.storyHumanCoupling, 0) / n
    ),
    learningPulse: round3(
      steps.reduce((acc, x) => acc + x.learningPulse, 0) / n
    ),
  };
}

function scoreComposite(reverse: ReverseResult, growth: NarrativeGrowth) {
  return round3(
    clamp01(0.7 * reverse.convergenceScore + 0.3 * growth.learningPulse)
  );
}

function mergeProfiles(
  presetName: ReverseProfilePresetName,
  profile?: ReverseScoringProfile
): ReverseScoringProfile {
  const preset = getReverseProfilePreset(presetName);
  return {
    weights: {
      containsThree:
        profile?.weights?.containsThree ?? preset.weights?.containsThree,
      structure: profile?.weights?.structure ?? preset.weights?.structure,
      style: profile?.weights?.style ?? preset.weights?.style,
    },
    thresholds: {
      working: profile?.thresholds?.working ?? preset.thresholds?.working,
      strong: profile?.thresholds?.strong ?? preset.thresholds?.strong,
    },
  };
}

function adaptProfileWeights(
  profile: ReverseScoringProfile | undefined,
  reverse: ReverseResult,
  drift: CoIterationStep["drift"],
  damping: number
): ReverseScoringProfile {
  const d = clamp01(damping);
  const w = profile?.weights || {};
  const rawContainsThree = w.containsThree ?? 0.5;
  const rawStructure = w.structure ?? 0.3;
  const rawStyle = w.style ?? 0.2;

  const structurePressure = clamp01(
    1 - (drift.observationGap + drift.actionGap + drift.memoryGap)
  );
  const stylePressure = reverse.matched.oracleToneScore;

  const nextContainsThree = rawContainsThree;
  const nextStructure = rawStructure * d + structurePressure * (1 - d);
  const nextStyle = rawStyle * d + stylePressure * (1 - d);

  const sum = nextContainsThree + nextStructure + nextStyle || 1;

  return {
    ...(profile || {}),
    weights: {
      containsThree: round3(nextContainsThree / sum),
      structure: round3(nextStructure / sum),
      style: round3(nextStyle / sum),
    },
  };
}

function defaultedTarget(target?: ReverseTarget): ReverseTarget {
  const profilePreset = target?.profilePreset ?? "seed";
  return {
    mustContainThree: target?.mustContainThree !== false,
    preferOracleTone: target?.preferOracleTone !== false,
    profilePreset,
    profile: mergeProfiles(profilePreset, target?.profile),
  };
}

export function runInscriptionPipeline(
  txt: string,
  options: InscriptionPipelineOptions = {}
): InscriptionPipelineResult {
  if (
    options.safety?.requireAcknowledgement === true &&
    options.safety?.acknowledged !== true
  ) {
    return {
      blocked: true,
      entryWarning: INSCRIPTION_EXPERIMENT_WARNING,
      blockedReason: INSCRIPTION_ACK_REQUIRED_WARNING,
    };
  }

  const steps = Math.max(1, options.steps ?? 3);
  const analysis = analyzeInscription(txt);
  const forward = forwardTriCompute(analysis);

  const minGain = options.optimizer?.minGain ?? 0.005;
  const damping = options.optimizer?.damping ?? 0.85;

  let target: ReverseTarget = defaultedTarget(options.target);

  const trajectory: CoIterationStep[] = [];
  const growthSteps: NarrativeGrowth[] = [];
  let lastReverse = reverseTriCompute(txt, target);
  let bestScore = 0;
  let acceptedSteps = 0;
  let rejectedSteps = 0;

  for (let i = 0; i < steps; i++) {
    const reverse = reverseTriCompute(txt, target);
    const drift = computeDrift(reverse.state);
    const growth = computeGrowth(reverse.state, drift);
    const compositeScore = scoreComposite(reverse, growth);
    const deltaScore = round3(compositeScore - bestScore);
    const isInitial = i === 0;
    const accepted = isInitial || deltaScore >= minGain;

    if (accepted) {
      bestScore = Math.max(bestScore, compositeScore);
      acceptedSteps++;
    } else {
      rejectedSteps++;
    }

    const optimization: OptimizationSnapshot = {
      accepted,
      compositeScore,
      deltaScore,
      bestScore,
      reason: isInitial ? "initial" : accepted ? "improved" : "damped",
    };

    growthSteps.push(growth);
    trajectory.push({
      step: i + 1,
      target: { ...target },
      reverse,
      drift,
      growth,
      optimization,
    });

    const merged = defaultedTarget(target);
    const adaptedProfile = adaptProfileWeights(
      merged.profile,
      reverse,
      drift,
      accepted ? damping : (1 + damping) / 2
    );

    target = {
      ...merged,
      profile: adaptedProfile,
      mustContainThree:
        merged.mustContainThree !== false || reverse.state.memory < 0.6,
      preferOracleTone:
        merged.preferOracleTone !== false ||
        reverse.matched.oracleToneScore < 0.5,
    };

    lastReverse = reverse;
  }

  return {
    blocked: false,
    ...(options.changes
      ? { changes: readChanges(txt, options.changes.catalog) }
      : {}),
    ...(options.relationModel
      ? { relation: readRelation(txt, options.relationModel) }
      : {}),
    entryWarning: INSCRIPTION_EXPERIMENT_WARNING,
    analysis,
    forward,
    reverse: lastReverse,
    trajectory,
    growth: averageGrowth(growthSteps),
    optimization: {
      acceptedSteps,
      rejectedSteps,
      bestScore: round3(bestScore),
    },
  };
}
