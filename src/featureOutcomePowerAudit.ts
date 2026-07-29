import {
  computeFeatureOutcomeRelationships,
  type FeatureOutcomeRelationshipsInput,
} from "./featureOutcomeRelationships.js";
import {
  DEFAULT_VOLATILITY,
  MAX_SEED,
  generateSyntheticNullSeries,
  type SyntheticNullModel,
} from "./syntheticNullSeries.js";
import type { OhlcvBar } from "./tradingview.js";

type FeatureStudyDefinition = Omit<FeatureOutcomeRelationshipsInput, "bars" | "symbol" | "timeframe">;
type BodyDirectionBucket = "bullish_body" | "bearish_body" | "indecision";

export interface FeatureOutcomePowerAuditInput {
  audit: {
    model: SyntheticNullModel;
    replications: number;
    firstSeed?: number;
    bars: number;
    timeframeMinutes: number;
    volatility?: number;
    nominalAlpha: number;
  };
  study: FeatureStudyDefinition & { timeframe: string };
  injection: {
    feature: "body_direction";
    bucket: BodyDirectionBucket;
    effectBps: number;
  };
}

export interface FeatureOutcomePowerAuditResult {
  schemaVersion: "1.0";
  methodologyVersion: "feature_outcome_power_audit_v1";
  studyDefinition: FeatureStudyDefinition & {
    timeframe: string;
    confidenceLevel: 0.9 | 0.95 | 0.99;
    configurationTrials: number;
    empiricalNullCalibration: true;
  };
  injection: {
    feature: "body_direction";
    bucket: BodyDirectionBucket;
    effectBps: number;
    horizon: 1;
    mechanism: "persistent_ohlc_rescaling_after_matching_signal_bar";
  };
  candidateRule: {
    evidence: "target_bucket_candidate_eligible_with_injected_direction_mean";
    empiricalNullMethodology: "feature_outcome_empirical_null_circular_moving_block_v2";
  };
  audit: {
    model: SyntheticNullModel;
    replications: number;
    firstSeed: number;
    bars: number;
    timeframeMinutes: number;
    volatility: number;
    status: "complete" | "incomplete";
    completed: number;
    evaluated: number;
    notEvaluableSeeds: number[];
    failed: Array<{ seed: number; error: string }>;
    detections: number;
    detectedSeeds: number[];
    detectionRate: number | null;
    detectionRateInterval: { lower: number; upper: number } | null;
    missRate: number | null;
  };
  limitations: string[];
}

const MAX_REPLICATIONS = 2_000;

function matchesBodyDirection(
  bar: OhlcvBar,
  bucket: BodyDirectionBucket,
  bodyRatioThreshold: number,
): boolean {
  const range = bar.high - bar.low;
  const bodyRatio = range === 0 ? 0 : Math.abs(bar.close - bar.open) / range;
  const observed = bodyRatio < bodyRatioThreshold ? "indecision"
    : bar.close > bar.open ? "bullish_body"
      : bar.close < bar.open ? "bearish_body" : "indecision";
  return observed === bucket;
}

export function injectBodyDirectionEffect(
  bars: OhlcvBar[],
  input: { bucket: BodyDirectionBucket; effectBps: number; bodyRatioThreshold: number },
): OhlcvBar[] {
  if (!Number.isFinite(input.effectBps) || input.effectBps === 0 || Math.abs(input.effectBps) > 500) {
    throw new Error("feature-outcome power audit effect bps must be non-zero and at most 500 in absolute value");
  }
  const factor = 1 + input.effectBps / 10_000;
  if (factor <= 0) throw new Error("feature-outcome power audit effect factor must be positive");
  let cumulativeScale = 1;
  return bars.map((bar, index) => {
    if (index > 0 && matchesBodyDirection(bars[index - 1], input.bucket, input.bodyRatioThreshold)) {
      cumulativeScale *= factor;
    }
    const scaled = {
      ...bar,
      open: bar.open * cumulativeScale,
      high: bar.high * cumulativeScale,
      low: bar.low * cumulativeScale,
      close: bar.close * cumulativeScale,
    };
    if (![scaled.open, scaled.high, scaled.low, scaled.close].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("feature-outcome power audit injected price became non-finite; reduce effect bps or bars");
    }
    return scaled;
  });
}

function wilsonInterval(successes: number, observations: number): { lower: number; upper: number } {
  const z = 1.959963984540054;
  const rate = successes / observations;
  const denominator = 1 + (z * z) / observations;
  const centre = rate + (z * z) / (2 * observations);
  const spread = z * Math.sqrt((rate * (1 - rate)) / observations +
    (z * z) / (4 * observations * observations));
  return {
    lower: successes === 0 ? 0 : Math.max(0, (centre - spread) / denominator),
    upper: successes === observations ? 1 : Math.min(1, (centre + spread) / denominator),
  };
}

function validate(input: FeatureOutcomePowerAuditInput) {
  if (!input.study.features.includes("body_direction")) {
    throw new Error("feature-outcome power audit study features must include body_direction");
  }
  if (!input.study.horizons.includes(1)) {
    throw new Error("feature-outcome power audit requires horizon 1");
  }
  if (!Number.isInteger(input.audit.replications) ||
      input.audit.replications < 1 || input.audit.replications > MAX_REPLICATIONS) {
    throw new Error(`feature-outcome power audit replications must be an integer from 1 to ${MAX_REPLICATIONS}`);
  }
  const firstSeed = input.audit.firstSeed ?? 1;
  if (!Number.isInteger(firstSeed) || firstSeed < 0 ||
      firstSeed + input.audit.replications - 1 > MAX_SEED) {
    throw new Error(`feature-outcome power audit seeds must stay within 0 to ${MAX_SEED}`);
  }
  const candidateAlpha = 1 - (input.study.confidenceLevel ?? 0.95);
  if (Math.abs(input.audit.nominalAlpha - candidateAlpha) > Number.EPSILON * 4) {
    throw new Error(
      `feature-outcome power audit nominal alpha must equal 1 - confidence level (${candidateAlpha})`,
    );
  }
  // Reuse the injection validation before entering a potentially expensive replication loop.
  injectBodyDirectionEffect([], {
    bucket: input.injection.bucket,
    effectBps: input.injection.effectBps,
    bodyRatioThreshold: input.study.bodyRatioThreshold,
  });
  return { firstSeed, volatility: input.audit.volatility ?? DEFAULT_VOLATILITY };
}

export function runFeatureOutcomePowerAudit(
  input: FeatureOutcomePowerAuditInput,
): FeatureOutcomePowerAuditResult {
  const { firstSeed, volatility } = validate(input);
  const detectedSeeds: number[] = [];
  const notEvaluableSeeds: number[] = [];
  const failed: Array<{ seed: number; error: string }> = [];
  for (let index = 0; index < input.audit.replications; index += 1) {
    const seed = firstSeed + index;
    try {
      const nullBars = generateSyntheticNullSeries({
        model: input.audit.model,
        bars: input.audit.bars,
        seed,
        timeframeMinutes: input.audit.timeframeMinutes,
        volatility,
      });
      const bars = injectBodyDirectionEffect(nullBars, {
        bucket: input.injection.bucket,
        effectBps: input.injection.effectBps,
        bodyRatioThreshold: input.study.bodyRatioThreshold,
      });
      const result = computeFeatureOutcomeRelationships({
        ...input.study,
        bars,
        symbol: "SYNTH:FEATURE_OUTCOME_POWER",
        empiricalNullCalibration: true,
      });
      const target = result.byFeature.body_direction?.[input.injection.bucket]?.horizons["1"]
        ?.nonOverlappingForwardReturn;
      const inference = target?.candidateInference;
      if (inference === undefined || !inference.minimumObservationsMet ||
          inference.empiricalNullCalibration?.status !== "available" || target.mean === null) {
        notEvaluableSeeds.push(seed);
        continue;
      }
      const directionMatches = Math.sign(target.mean) === Math.sign(input.injection.effectBps);
      if (inference.candidateEligible && directionMatches) detectedSeeds.push(seed);
    } catch (error) {
      failed.push({ seed, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const completed = input.audit.replications - failed.length;
  const evaluated = completed - notEvaluableSeeds.length;
  const detectionRate = evaluated === 0 ? null : detectedSeeds.length / evaluated;
  return {
    schemaVersion: "1.0",
    methodologyVersion: "feature_outcome_power_audit_v1",
    studyDefinition: {
      ...input.study,
      confidenceLevel: input.study.confidenceLevel ?? 0.95,
      configurationTrials: input.study.configurationTrials ?? 1,
      empiricalNullCalibration: true,
    },
    injection: {
      ...input.injection,
      horizon: 1,
      mechanism: "persistent_ohlc_rescaling_after_matching_signal_bar",
    },
    candidateRule: {
      evidence: "target_bucket_candidate_eligible_with_injected_direction_mean",
      empiricalNullMethodology: "feature_outcome_empirical_null_circular_moving_block_v2",
    },
    audit: {
      model: input.audit.model,
      replications: input.audit.replications,
      firstSeed,
      bars: input.audit.bars,
      timeframeMinutes: input.audit.timeframeMinutes,
      volatility,
      status: failed.length === 0 ? "complete" : "incomplete",
      completed,
      evaluated,
      notEvaluableSeeds,
      failed,
      detections: detectedSeeds.length,
      detectedSeeds,
      detectionRate,
      detectionRateInterval: evaluated === 0 ? null : wilsonInterval(detectedSeeds.length, evaluated),
      missRate: detectionRate === null ? null : 1 - detectionRate,
    },
    limitations: [
      "This audit measures detection power for one predeclared body-direction bucket, not for every feature family.",
      "Persistent OHLC rescaling preserves the injected signal bar's body-direction label but can alter path-dependent non-target feature labels.",
      "Detection requires candidateEligible and a target-bucket mean with the injected sign.",
      "Synthetic power does not establish real-market effect size, profitability, execution quality, or out-of-sample validity.",
    ],
  };
}
