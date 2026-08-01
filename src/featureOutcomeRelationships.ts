import type { OhlcvBar } from "./tradingview.js";
import { createHash } from "node:crypto";
import {
  computeMarketRegimes,
  marketRegimeResolutionMilliseconds,
  type DirectionalRegime,
  type VolatilityRegime,
} from "./marketRegimes.js";

export type FeatureOutcomeFeature =
  | "atr_compression"
  | "body_direction"
  | "wick_imbalance"
  | "directional_streak"
  | "range_position"
  | "gap_direction";

export interface FeatureOutcomeFold {
  foldId: string;
  from: string;
  to: string;
}

export interface FeatureOutcomeRegimeFilter {
  trendLookback: number;
  atrLookback: number;
  volatilityBaselineLookback: number;
  trendEfficiencyThreshold: number;
  rangeEfficiencyThreshold: number;
  directionalMoveAtrThreshold: number;
  highVolatilityRatio: number;
  lowVolatilityRatio: number;
  directionalRegime: DirectionalRegime;
  volatilityRegime: VolatilityRegime | null;
}

export interface FeatureOutcomeSelection {
  feature: FeatureOutcomeFeature;
  bucket: string;
}

export interface FeatureOutcomeRelationshipsInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  features: FeatureOutcomeFeature[];
  selection: FeatureOutcomeSelection | null;
  signalFrom: string | null;
  signalTo: string | null;
  atrLookback: number;
  atrBaselineLookback: number;
  rangeLookback: number;
  streakMinimumBars: number;
  bodyRatioThreshold: number;
  wickImbalanceThreshold: number;
  atrCompressionLowRatio: number;
  atrCompressionHighRatio: number;
  rangePositionLower: number;
  rangePositionUpper: number;
  gapAtrThreshold: number;
  horizons: number[];
  minimumObservations: number;
  folds: FeatureOutcomeFold[];
  regime: FeatureOutcomeRegimeFilter | null;
  observationLimit: number;
  confidenceLevel?: 0.9 | 0.95 | 0.99;
  configurationTrials?: number;
  empiricalNullCalibration?: boolean;
  /**
   * Must equal FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS. Stated at every call site so it
   * reaches the definition hash, and rejected otherwise so the frozen rule cannot be relaxed
   * per call.
   */
  minimumEffectBps: typeof FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS;
}

const FEATURE_BUCKETS: Record<FeatureOutcomeFeature, readonly string[]> = {
  atr_compression: ["compressed", "normal", "expanded"],
  body_direction: ["bullish_body", "bearish_body", "indecision"],
  wick_imbalance: ["upper_wick_dominant", "lower_wick_dominant", "balanced_wicks"],
  directional_streak: ["up_streak", "down_streak", "mixed"],
  range_position: ["lower_range", "middle_range", "upper_range"],
  gap_direction: ["gap_up", "gap_down", "no_material_gap"],
};

/**
 * Pre-registered floor for candidacy, common to every symbol. It is a frozen rule and not a knob:
 * a caller that could pass zero could record sub-floor candidates again, which is the researcher
 * degree of freedom this project exists to remove. Exploration is unaffected - exploratoryEligible
 * never applied a floor and effectBps is always reported.
 */
export const FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS = 10 as const;

/**
 * The one classification the candidate rule was calibrated at. Its false-positive rates against the
 * three null models, and its power across the minimum effect size, were measured with these exact
 * thresholds and this exact family, so a candidate verdict issued at any other setting carries an
 * error rate nobody has measured. The thresholds define what a bucket is, and minimumObservations
 * decides which buckets enter the empirical-null family - a larger one shrinks that family and
 * loosens the very test it looks like it is tightening.
 *
 * Only the candidate path is bound by this. Exploration passes empiricalNullCalibration false and
 * may use any classification it likes.
 */
export const FEATURE_OUTCOME_CALIBRATED_STUDY = {
  features: [
    "atr_compression", "body_direction", "wick_imbalance", "directional_streak", "range_position", "gap_direction",
  ] as readonly FeatureOutcomeFeature[],
  atrLookback: 14,
  atrBaselineLookback: 50,
  rangeLookback: 20,
  streakMinimumBars: 3,
  bodyRatioThreshold: 0.5,
  wickImbalanceThreshold: 0.6,
  atrCompressionLowRatio: 0.8,
  atrCompressionHighRatio: 1.2,
  rangePositionLower: 0.33,
  rangePositionUpper: 0.67,
  gapAtrThreshold: 0.5,
  horizons: [1, 5, 21] as readonly number[],
  minimumObservations: 30,
  confidenceLevel: 0.95,
} as const;

/**
 * Names every way a study departs from the calibrated one, empty when it does not.
 *
 * This reports rather than refuses, and the distinction matters: the falsification and power audits
 * exist to measure the error rate of whatever configuration they are handed, so a pure function that
 * rejected uncalibrated studies would make calibrating a new one impossible. Enforcement belongs at
 * the boundaries that issue verdicts about a real market - the MCP tool and the CSV scan - not here.
 *
 * configurationTrials is deliberately not checked: stating more trials only shrinks the Bonferroni
 * threshold, so a larger count is conservative, and a smaller one is impossible - the floor is one.
 */
export function calibratedStudyDepartures(input: FeatureOutcomeRelationshipsInput): string[] {
  const study = FEATURE_OUTCOME_CALIBRATED_STUDY;
  const mismatched: string[] = [];
  const numbers = [
    "atrLookback", "atrBaselineLookback", "rangeLookback", "streakMinimumBars", "bodyRatioThreshold",
    "wickImbalanceThreshold", "atrCompressionLowRatio", "atrCompressionHighRatio", "rangePositionLower",
    "rangePositionUpper", "gapAtrThreshold", "minimumObservations",
  ] as const;
  for (const key of numbers) {
    if (input[key] !== study[key]) mismatched.push(`${key} must be ${study[key]}, received ${input[key]}`);
  }
  if ((input.confidenceLevel ?? study.confidenceLevel) !== study.confidenceLevel) {
    mismatched.push(`confidenceLevel must be ${study.confidenceLevel}`);
  }
  if (input.selection !== null) {
    mismatched.push("a single pre-registered feature bucket is a different study that was never calibrated");
  }
  const sorted = [...input.features].sort().join(",");
  if (sorted !== [...study.features].sort().join(",")) {
    mismatched.push(`features must be the calibrated six, received ${sorted || "none"}`);
  }
  const horizons = [...input.horizons].join(",");
  if (horizons !== [...study.horizons].join(",")) {
    mismatched.push(`horizons must be ${[...study.horizons].join(",")}, received ${horizons}`);
  }
  return mismatched;
}

/**
 * For the boundaries that do issue verdicts about a real market. Exploration is untouched: a run
 * without empirical-null calibration cannot reach candidateEligible in the first place.
 */
export function assertCalibratedStudy(input: FeatureOutcomeRelationshipsInput): void {
  const departures = calibratedStudyDepartures(input);
  if (departures.length > 0) {
    throw new Error(
      "empirical-null calibration issues candidate verdicts and is bound to the study those verdicts " +
      `were calibrated at: ${departures.join("; ")}. Run without empirical_null_calibration to explore ` +
      "at other settings, or use the falsification audit to calibrate this one first.",
    );
  }
}

const NORMAL_Z = { 0.9: 1.6448536269514722, 0.95: 1.959963984540054, 0.99: 2.5758293035489004 } as const;
const EMPIRICAL_NULL_ITERATIONS = 1_000;
const EMPIRICAL_NULL_SEED = 20_260_729;
const EMPIRICAL_NULL_METHODOLOGY = "feature_outcome_empirical_null_circular_moving_block_v2" as const;

type EmpiricalBucketCalibration = {
  status: "available" | "insufficient_sample";
  observedStatistic: number | null;
  familyWisePValue: number | null;
  nominalAlpha: number;
  passes: boolean;
};

type EmpiricalNullCalibration = {
  schemaVersion: "1.0";
  methodologyVersion: typeof EMPIRICAL_NULL_METHODOLOGY;
  status: "complete" | "not_evaluable";
  iterations: number;
  seed: number;
  blockLengthRule: "floor_cube_root_of_eligible_observations_minimum_2";
  blockLength: number | null;
  horizon: 1;
  familyStatistic: "maximum_absolute_studentized_mean_across_candidate_evaluable_observed_feature_buckets";
  familyEligibleBuckets: number;
  familyExcludedInsufficientSampleBuckets: number;
  nominalAlpha: number;
  evidenceHash: string;
  calibrationId: string;
  source: {
    symbol: string;
    timeframe: string;
    closedBars: number;
    selectedEligibleObservations: number;
    referenceEligibleObservations: number;
    from: string | null;
    to: string | null;
  };
  byFeature: Partial<Record<FeatureOutcomeFeature, Record<string, EmpiricalBucketCalibration>>>;
  limitations: string[];
};

function normalCdf(value: number): number {
  const x = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * x);
  const density = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - tail;
  return value < 0 ? 1 - cdf : cdf;
}

type Outcome = {
  forwardReturn: number;
  maxUpside: number;
  maxDownside: number;
};

type Observation = {
  signalIndex: number;
  signalTime: string;
  labels: Partial<Record<FeatureOutcomeFeature, string>>;
  outcomes: Record<string, Outcome | null>;
};

function canonicalTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function percentile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function meanConfidenceInterval(values: number[], confidenceLevel: 0.9 | 0.95 | 0.99) {
  if (values.length < 2) {
    return { status: "insufficient_sample" as const, method: "normal_approximation" as const,
      confidenceLevel, observations: values.length, lower: null, upper: null };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const standardError = Math.sqrt(variance / values.length);
  const margin = NORMAL_Z[confidenceLevel] * standardError;
  return { status: "available" as const, method: "normal_approximation" as const,
    confidenceLevel, observations: values.length, lower: mean - margin, upper: mean + margin,
    twoSidedPValue: standardError === 0 ? (mean === 0 ? 1 : 0) : Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(mean / standardError)))))};
}

function neweyWestConfidenceInterval(values: number[], confidenceLevel: 0.9 | 0.95 | 0.99) {
  if (values.length < 2) {
    return { status: "insufficient_sample" as const, method: "newey_west_bartlett" as const,
      confidenceLevel, observations: values.length, lags: 0, lower: null, upper: null };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviations = values.map((value) => value - mean);
  const lags = Math.min(values.length - 1, Math.floor(4 * (values.length / 100) ** (2 / 9)));
  let longRunVariance = deviations.reduce((sum, value) => sum + value * value, 0) / values.length;
  for (let lag = 1; lag <= lags; lag += 1) {
    const covariance = deviations.slice(lag).reduce((sum, value, index) => sum + value * deviations[index], 0) / values.length;
    longRunVariance += 2 * (1 - lag / (lags + 1)) * covariance;
  }
  const standardError = Math.sqrt(Math.max(0, longRunVariance) / values.length);
  const margin = NORMAL_Z[confidenceLevel] * standardError;
  return { status: "available" as const, method: "newey_west_bartlett" as const,
    confidenceLevel, observations: values.length, lags, lower: mean - margin, upper: mean + margin,
    twoSidedPValue: standardError === 0 ? (mean === 0 ? 1 : 0) : Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(mean / standardError)))))};
}

function wilsonConfidenceInterval(successes: number, observations: number, confidenceLevel: 0.9 | 0.95 | 0.99) {
  if (observations === 0) {
    return { status: "insufficient_sample" as const, method: "wilson_score" as const,
      confidenceLevel, observations, successes, lower: null, upper: null };
  }
  const z = NORMAL_Z[confidenceLevel];
  const rate = successes / observations;
  const denominator = 1 + z ** 2 / observations;
  const center = (rate + z ** 2 / (2 * observations)) / denominator;
  const margin = z * Math.sqrt(rate * (1 - rate) / observations + z ** 2 / (4 * observations ** 2)) /
    denominator;
  return { status: "available" as const, method: "wilson_score" as const,
    confidenceLevel, observations, successes, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

/**
 * Spreading a bucket into Math.min overflows the call stack once a bucket holds enough
 * observations, which a large sample reaches long before anything else here strains.
 */
function extremes(values: number[]): { minimum: number | null; maximum: number | null } {
  if (values.length === 0) return { minimum: null, maximum: null };
  let minimum = values[0];
  let maximum = values[0];
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return { minimum, maximum };
}

function stats(values: number[], confidenceLevel: 0.9 | 0.95 | 0.99, includeMeanConfidenceInterval = false) {
  return {
    count: values.length,
    mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    ...extremes(values),
    ...(includeMeanConfidenceInterval ? { meanConfidenceInterval: meanConfidenceInterval(values, confidenceLevel) } : {}),
  };
}

function median(values: number[]): number {
  const result = percentile(values, 0.5);
  if (result === null) throw new Error("median requires at least one value");
  return result;
}

function validateBars(bars: OhlcvBar[]): OhlcvBar[] {
  if (bars.length < 3) throw new Error("feature-outcome relationships require at least three OHLC bars");
  const ordered = [...bars].sort((left, right) => left.time - right.time);
  if (ordered.some((bar, index) => index > 0 && bar.time === ordered[index - 1].time)) {
    throw new Error("OHLC bars contain duplicate timestamps");
  }
  if (ordered.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) || !Number.isFinite(bar.close) || bar.close <= 0 ||
      bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
      bar.close < bar.low || bar.close > bar.high)) {
    throw new Error("OHLC bars contain invalid values");
  }
  return ordered;
}

function assertInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid ${label}`);
  }
}

function outcomeFor(bars: OhlcvBar[], signalIndex: number, horizons: number[]): Record<string, Outcome | null> {
  const signal = bars[signalIndex];
  return Object.fromEntries(horizons.map((horizon) => {
    const future = bars.slice(signalIndex + 1, signalIndex + horizon + 1);
    if (future.length !== horizon) return [String(horizon), null];
    const entry = signal.close;
    return [String(horizon), {
      forwardReturn: future.at(-1)!.close / entry - 1,
      maxUpside: Math.max(0, ...future.map((bar) => bar.high / entry - 1)),
      maxDownside: Math.max(0, ...future.map((bar) => 1 - bar.low / entry)),
    }];
  }));
}

type BonferroniInference = {
  familyTests: number;
  nominalAlpha: number;
  adjustedAlpha: number;
  candidateHorizon: 1;
  minimumObservations: number;
  /**
   * Significance reports whether an effect exists, never how large it is, and a large enough
   * sample makes a fraction of a basis point extreme. The first real candidates this project
   * produced were all smaller than a fifth of the spread they would have to cross.
   */
  minimumEffectBps: number;
};

function inferenceFor(
  interval: { status: string; twoSidedPValue?: number } | undefined,
  mean: number | null,
  observations: number,
  bonferroni: BonferroniInference,
  horizon: number,
  exploratoryGateEnabled: boolean,
  missingExploratoryPrerequisite: string,
  empiricalNullCalibration?: EmpiricalBucketCalibration,
) {
  const pValue: number | null = interval?.status === "available" && typeof interval.twoSidedPValue === "number"
    ? interval.twoSidedPValue : null;
  const passesBonferroni = pValue !== null && pValue <= bonferroni.adjustedAlpha;
  const minimumObservationsMet = observations >= bonferroni.minimumObservations;
  const exploratoryEligible = exploratoryGateEnabled && horizon === bonferroni.candidateHorizon &&
    minimumObservationsMet && passesBonferroni;
  const empiricalAvailable = empiricalNullCalibration?.status === "available";
  const empiricalPasses = empiricalAvailable && empiricalNullCalibration.passes;
  const effectBps = mean === null ? null : Math.abs(mean) * 10_000;
  const meetsMinimumEffect = effectBps !== null && effectBps >= bonferroni.minimumEffectBps;
  return {
    effectBps,
    meetsMinimumEffect,
    twoSidedPValue: pValue,
    bonferroniAdjustedPValue: pValue === null ? null : Math.min(1, pValue * bonferroni.familyTests),
    ...bonferroni,
    minimumObservationsMet,
    passesBonferroni,
    exploratoryEligible,
    ...(empiricalNullCalibration === undefined ? {} : { empiricalNullCalibration }),
    candidateEligible: exploratoryEligible && empiricalPasses && meetsMinimumEffect,
    candidateBlockers: [
      ...(meetsMinimumEffect ? [] : ["minimum_effect_size_not_met"]),
      ...(empiricalNullCalibration === undefined
        ? ["empirical_null_calibration_required"]
        : !empiricalAvailable
          ? ["empirical_null_calibration_not_evaluable"]
          : empiricalPasses ? [] : ["empirical_null_family_wise_threshold_not_met"]),
      ...(exploratoryEligible ? [] : [
      ...(exploratoryGateEnabled ? [] : [missingExploratoryPrerequisite]),
      ...(horizon === bonferroni.candidateHorizon ? [] : ["candidate_horizon_must_be_1"]),
      ...(minimumObservationsMet ? [] : ["minimum_observation_count_not_met"]),
      ...(passesBonferroni ? [] : ["bonferroni_threshold_not_met"]),
      ]),
    ],
  };
}

function nonOverlappingObservations(observations: Observation[], horizon: number): Observation[] {
  const selected: Observation[] = [];
  let nextEligibleSignalIndex = -Infinity;
  for (const observation of observations) {
    if (observation.outcomes[String(horizon)] === null || observation.signalIndex < nextEligibleSignalIndex) continue;
    selected.push(observation);
    // A later signal may use this outcome's final bar as its signal bar, but not as a future return bar.
    nextEligibleSignalIndex = observation.signalIndex + horizon;
  }
  return selected;
}

function summarize(
  observations: Observation[],
  horizons: number[],
  confidenceLevel: 0.9 | 0.95 | 0.99,
  bonferroni?: BonferroniInference,
  empiricalNullCalibration?: EmpiricalBucketCalibration,
) {
  return Object.fromEntries(horizons.map((horizon) => {
    const outcomes = observations.map((row) => row.outcomes[String(horizon)]).filter((value) => value !== null);
    const returns = outcomes.map((outcome) => outcome!.forwardReturn);
    const forwardReturn = stats(returns, confidenceLevel, true);
    const nonOverlapping = nonOverlappingObservations(observations, horizon);
    const nonOverlappingReturns = nonOverlapping.map((row) => row.outcomes[String(horizon)]!.forwardReturn);
    const nonOverlappingForwardReturn = stats(nonOverlappingReturns, confidenceLevel, true);
    const neweyWestInterval = neweyWestConfidenceInterval(nonOverlappingReturns, confidenceLevel);
    return [String(horizon), {
      availableObservations: outcomes.length,
      unavailableObservations: observations.length - outcomes.length,
      forwardReturn: { ...forwardReturn, ...(bonferroni === undefined ? {} : { inference:
        inferenceFor(forwardReturn.meanConfidenceInterval, forwardReturn.mean, forwardReturn.count, bonferroni, horizon, false,
          "candidate_requires_non_overlapping_series") }) },
      nonOverlappingForwardReturn: {
        sampling: "greedy_non_overlapping_future_return_windows" as const,
        ...nonOverlappingForwardReturn,
        neweyWestConfidenceInterval: neweyWestInterval,
        ...(bonferroni === undefined ? {} : { inference:
          inferenceFor(nonOverlappingForwardReturn.meanConfidenceInterval, nonOverlappingForwardReturn.mean, nonOverlappingForwardReturn.count,
            bonferroni, horizon, false, "candidate_requires_newey_west_inference"),
          candidateInference: inferenceFor(neweyWestInterval, nonOverlappingForwardReturn.mean, nonOverlappingForwardReturn.count,
            bonferroni, horizon, true, "", horizon === 1 ? empiricalNullCalibration : undefined) }),
      },
      positiveRate: returns.length === 0 ? null : returns.filter((value) => value > 0).length / returns.length,
      positiveRateConfidenceInterval: wilsonConfidenceInterval(
        returns.filter((value) => value > 0).length, returns.length, confidenceLevel),
      maxUpside: stats(outcomes.map((outcome) => outcome!.maxUpside), confidenceLevel),
      maxDownside: stats(outcomes.map((outcome) => outcome!.maxDownside), confidenceLevel),
    }];
  }));
}

function classify<T extends Observation>(
  rows: T[],
  features: FeatureOutcomeFeature[],
  horizons: number[],
  confidenceLevel: 0.9 | 0.95 | 0.99,
  bonferroni?: BonferroniInference,
  empiricalNullCalibration?: EmpiricalNullCalibration,
) {
  return Object.fromEntries(features.map((feature) => {
    const buckets = [...new Set(rows.map((row) => row.labels[feature]).filter((value): value is string => value !== undefined))]
      .sort();
    return [feature, Object.fromEntries(buckets.map((bucket) => {
      const selected = rows.filter((row) => row.labels[feature] === bucket);
      return [bucket, { observations: selected.length, horizons: summarize(selected, horizons, confidenceLevel,
        bonferroni, empiricalNullCalibration?.byFeature[feature]?.[bucket]) }];
    }))];
  }));
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function absoluteStudentizedMean(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const standardError = Math.sqrt(variance / values.length);
  if (standardError === 0) return null;
  const statistic = Math.abs(mean / standardError);
  return Number.isFinite(statistic) ? statistic : null;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function buildEmpiricalNullCalibration(input: {
  observations: Observation[];
  referenceObservations: Observation[];
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  features: FeatureOutcomeFeature[];
  horizons: number[];
  confidenceLevel: 0.9 | 0.95 | 0.99;
  definition: unknown;
  configurationTrials: number;
  minimumObservations: number;
}): EmpiricalNullCalibration {
  const eligible = input.observations.filter((row) => row.outcomes["1"] !== null);
  const referenceEligible = input.referenceObservations.filter((row) => row.outcomes["1"] !== null);
  const returns = referenceEligible.map((row) => row.outcomes["1"]!.forwardReturn);
  const evidenceHash = sha256(input.bars.map((bar) => ({
    time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
  })));
  const blockLength = referenceEligible.length < 2 ? null : Math.min(referenceEligible.length,
    Math.max(2, Math.floor(Math.cbrt(referenceEligible.length))));
  const nominalAlpha = 1 - input.confidenceLevel;
  const buckets = input.features.flatMap((feature) =>
    [...new Set(input.observations.map((row) => row.labels[feature]).filter((value): value is string => value !== undefined))]
      .sort()
      .map((bucket) => ({
        feature,
        bucket,
        indexes: eligible.flatMap((row, index) => row.labels[feature] === bucket ? [index] : []),
      })));
  const observed = new Map<string, number | null>(buckets.map((bucket) => {
    const statistic = absoluteStudentizedMean(bucket.indexes.map((index) =>
      eligible[index].outcomes["1"]!.forwardReturn));
    return [`${bucket.feature}:${bucket.bucket}`, statistic] as const;
  }));
  const familyBuckets = buckets.filter((bucket) =>
    bucket.indexes.length >= input.minimumObservations &&
    observed.get(`${bucket.feature}:${bucket.bucket}`) !== null);
  const familyExcludedInsufficientSampleBuckets = buckets.length - familyBuckets.length;
  const exceedances = new Map<string, number>(buckets.map((bucket) => [`${bucket.feature}:${bucket.bucket}`, 0]));
  if (blockLength !== null) {
    const random = createRandom(EMPIRICAL_NULL_SEED);
    for (let iteration = 0; iteration < EMPIRICAL_NULL_ITERATIONS; iteration += 1) {
      const sampled: number[] = [];
      while (sampled.length < eligible.length) {
        const start = Math.floor(random() * returns.length);
        for (let offset = 0; offset < blockLength && sampled.length < eligible.length; offset += 1) {
          sampled.push(returns[(start + offset) % returns.length]);
        }
      }
      const familyMaximum = familyBuckets.reduce((maximum, bucket) => {
        const statistic = absoluteStudentizedMean(bucket.indexes.map((index) => sampled[index]));
        return statistic === null ? maximum : Math.max(maximum, statistic);
      }, 0);
      for (const bucket of familyBuckets) {
        const key = `${bucket.feature}:${bucket.bucket}`;
        const statistic = observed.get(key);
        if (statistic !== null && statistic !== undefined && familyMaximum >= statistic) {
          exceedances.set(key, (exceedances.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const byFeature: EmpiricalNullCalibration["byFeature"] = {};
  for (const bucket of buckets) {
    const key = `${bucket.feature}:${bucket.bucket}`;
    const observedStatistic = observed.get(key) ?? null;
    const enough = bucket.indexes.length >= input.minimumObservations && observedStatistic !== null && blockLength !== null;
    const familyWisePValue = enough ? (1 + (exceedances.get(key) ?? 0)) / (EMPIRICAL_NULL_ITERATIONS + 1) : null;
    (byFeature[bucket.feature] ??= {})[bucket.bucket] = {
      status: enough ? "available" : "insufficient_sample",
      observedStatistic,
      familyWisePValue,
      nominalAlpha,
      passes: familyWisePValue !== null && familyWisePValue <= nominalAlpha,
    };
  }
  const contract = {
    methodologyVersion: EMPIRICAL_NULL_METHODOLOGY,
    iterations: EMPIRICAL_NULL_ITERATIONS,
    seed: EMPIRICAL_NULL_SEED,
    blockLengthRule: "floor_cube_root_of_eligible_observations_minimum_2",
    blockLength,
    horizon: 1,
    familyStatistic: "maximum_absolute_studentized_mean_across_candidate_evaluable_observed_feature_buckets",
    familyEligibleBuckets: familyBuckets.length,
    familyExcludedInsufficientSampleBuckets,
    nominalAlpha,
    symbol: input.symbol,
    timeframe: input.timeframe,
    features: input.features,
    horizons: input.horizons,
    definition: input.definition,
    configurationTrials: input.configurationTrials,
    minimumObservations: input.minimumObservations,
    evidenceHash,
  };
  return {
    schemaVersion: "1.0",
    methodologyVersion: EMPIRICAL_NULL_METHODOLOGY,
    status: blockLength !== null && familyBuckets.length > 0 ? "complete" : "not_evaluable",
    iterations: EMPIRICAL_NULL_ITERATIONS,
    seed: EMPIRICAL_NULL_SEED,
    blockLengthRule: "floor_cube_root_of_eligible_observations_minimum_2",
    blockLength,
    horizon: 1,
    familyStatistic: "maximum_absolute_studentized_mean_across_candidate_evaluable_observed_feature_buckets",
    familyEligibleBuckets: familyBuckets.length,
    familyExcludedInsufficientSampleBuckets,
    nominalAlpha,
    evidenceHash,
    calibrationId: sha256(contract),
    source: {
      symbol: input.symbol,
      timeframe: input.timeframe,
      closedBars: input.bars.length,
      selectedEligibleObservations: eligible.length,
      referenceEligibleObservations: referenceEligible.length,
      from: input.bars[0]?.timeIso ?? null,
      to: input.bars.at(-1)?.timeIso ?? null,
    },
    byFeature,
    limitations: [
      "Feature labels and original bar timestamps stay fixed; circular moving blocks resample horizon-one outcomes only.",
      "When one feature bucket is preselected, null outcomes come from the same signal-window and regime population before feature selection.",
      "The family-wise p-value compares each observed bucket statistic with the maximum across observed feature buckets that meet the frozen candidate minimum-observation floor and have a finite studentized statistic.",
      "Observed buckets below that floor or with zero standard error are reported as insufficient_sample and excluded from the family maximum because they cannot become candidates.",
      "This calibration does not establish causality, profitability, execution quality, or out-of-sample validity.",
    ],
  };
}

function selectionContrast(
  selected: Observation[], reference: Observation[], horizons: number[], confidenceLevel: 0.9 | 0.95 | 0.99,
) {
  const selectedSummary = summarize(selected, horizons, confidenceLevel);
  const referenceSummary = summarize(reference, horizons, confidenceLevel);
  return {
    referencePopulation: "same_signal_window_and_regime_before_feature_selection" as const,
    populationsOverlap: true,
    selectedObservations: selected.length,
    referenceObservations: reference.length,
    horizons: Object.fromEntries(horizons.map((horizon) => {
      const key = String(horizon);
      const selectedHorizon = selectedSummary[key];
      const referenceHorizon = referenceSummary[key];
      const selectedMean = selectedHorizon.forwardReturn.mean;
      const referenceMean = referenceHorizon.forwardReturn.mean;
      const selectedPositiveRate = selectedHorizon.positiveRate;
      const referencePositiveRate = referenceHorizon.positiveRate;
      return [key, {
        selected: selectedHorizon,
        reference: referenceHorizon,
        meanForwardReturnDifference: selectedMean === null || referenceMean === null ? null : selectedMean - referenceMean,
        positiveRateDifference: selectedPositiveRate === null || referencePositiveRate === null
          ? null : selectedPositiveRate - referencePositiveRate,
      }];
    })),
  };
}

export function computeFeatureOutcomeRelationships(input: FeatureOutcomeRelationshipsInput) {
  const selection = input.selection ?? null;
  const signalFrom = input.signalFrom ?? null;
  const signalTo = input.signalTo ?? null;
  const timeframeMs = marketRegimeResolutionMilliseconds(input.timeframe);
  if (!timeframeMs || /M$/i.test(input.timeframe)) {
    throw new Error("feature-outcome relationships require a fixed-duration timeframe");
  }
  const confidenceLevel = input.confidenceLevel ?? 0.95;
  const configurationTrials = input.configurationTrials ?? 1;
  if (![0.9, 0.95, 0.99].includes(confidenceLevel)) throw new Error("unsupported confidence level");
  if (!Number.isInteger(configurationTrials) || configurationTrials < 1 || configurationTrials > 100_000) {
    throw new Error("configuration trials must be an integer from 1 to 100000");
  }
  if (input.features.length < 1 || input.features.length > 6 || new Set(input.features).size !== input.features.length) {
    throw new Error("features must contain one to six unique feature names");
  }
  if (selection !== null) {
    if (!input.features.includes(selection.feature)) {
      throw new Error("feature selection must be included in features");
    }
    if (!FEATURE_BUCKETS[selection.feature].includes(selection.bucket)) {
      throw new Error("feature selection bucket is invalid for the selected feature");
    }
  }
  const signalFromMs = signalFrom === null ? null : canonicalTime(signalFrom, "signal_from");
  const signalToMs = signalTo === null ? null : canonicalTime(signalTo, "signal_to");
  if (signalFromMs !== null && signalToMs !== null && signalFromMs >= signalToMs) {
    throw new Error("signal_to must be after signal_from");
  }
  assertInteger(input.atrLookback, 2, 250, "atr lookback");
  assertInteger(input.atrBaselineLookback, 5, 1_000, "atr baseline lookback");
  assertInteger(input.rangeLookback, 2, 500, "range lookback");
  assertInteger(input.streakMinimumBars, 1, 100, "streak minimum bars");
  if (!(input.bodyRatioThreshold >= 0 && input.bodyRatioThreshold < 1) ||
      !(input.wickImbalanceThreshold >= 0 && input.wickImbalanceThreshold <= 1) ||
      !(input.atrCompressionLowRatio > 0 && input.atrCompressionLowRatio < 1) ||
      !(input.atrCompressionHighRatio > 1) ||
      input.atrCompressionLowRatio >= input.atrCompressionHighRatio ||
      !(input.rangePositionLower > 0 && input.rangePositionLower < 0.5) ||
      !(input.rangePositionUpper > 0.5 && input.rangePositionUpper < 1) ||
      !(input.gapAtrThreshold >= 0)) {
    throw new Error("invalid feature classification thresholds");
  }
  if (input.horizons.length < 1 || input.horizons.length > 8 ||
      input.horizons.some((horizon) => !Number.isInteger(horizon) || horizon < 1 || horizon > 250) ||
      new Set(input.horizons).size !== input.horizons.length) {
    throw new Error("invalid feature-outcome horizons");
  }
  assertInteger(input.minimumObservations, 1, 5_000, "minimum observations");
  // Runtime-checked as well as typed: the JavaScript callers would otherwise pass undefined and
  // silently restore a rule with no floor on effect size.
  if (input.minimumEffectBps !== FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS) {
    throw new Error(
      `minimum effect bps is a frozen pre-registered rule and must be ${FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS}`,
    );
  }
  const calibratedStudyDeparturesFound = calibratedStudyDepartures(input);
  assertInteger(input.observationLimit, 0, 500, "observation limit");

  const allBars = validateBars(input.bars);
  const formingBarsExcluded = allBars.filter((bar) => bar.forming === true).length;
  const bars = allBars.filter((bar) => bar.forming !== true);
  const regimeEvidence = input.regime === null ? null : computeMarketRegimes({
    bars: input.bars,
    symbol: input.symbol,
    timeframe: input.timeframe,
    trendLookback: input.regime.trendLookback,
    atrLookback: input.regime.atrLookback,
    volatilityBaselineLookback: input.regime.volatilityBaselineLookback,
    trendEfficiencyThreshold: input.regime.trendEfficiencyThreshold,
    rangeEfficiencyThreshold: input.regime.rangeEfficiencyThreshold,
    directionalMoveAtrThreshold: input.regime.directionalMoveAtrThreshold,
    highVolatilityRatio: input.regime.highVolatilityRatio,
    lowVolatilityRatio: input.regime.lowVolatilityRatio,
    minimumClassifiedBars: 1,
    observationLimit: 20_000,
  });
  const regimesByTime = new Map(regimeEvidence?.observations.map((item) => [item.time, item]) ?? []);
  let regimeUnclassified = 0;
  let regimeExcluded = 0;
  let signalBeforeWindowExcluded = 0;
  let signalAfterWindowExcluded = 0;
  let featureSelectionExcluded = 0;
  let signalWindowEligible = 0;
  let regimeMatched = 0;
  let featureSelectionMatched = 0;
  const trueRanges: Array<number | null> = bars.map((bar, index) => index === 0 ? null : Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - bars[index - 1].close),
    Math.abs(bar.low - bars[index - 1].close),
  ));
  const atr: Array<number | null> = bars.map((_, index) => {
    if (index < input.atrLookback) return null;
    const window = trueRanges.slice(index - input.atrLookback + 1, index + 1);
    if (window.some((value) => value === null)) return null;
    return window.reduce<number>((sum, value) => sum + (value ?? 0), 0) / input.atrLookback;
  });
  const warmupBars = Math.max(input.atrLookback + input.atrBaselineLookback, input.rangeLookback, input.streakMinimumBars);
  const observations: Observation[] = [];
  const referenceObservations: Observation[] = [];
  const irregularIntervals = bars.slice(1).filter((bar, index) => bar.time * 1_000 - bars[index].time * 1_000 > timeframeMs * 1.5).length;

  for (let index = warmupBars; index < bars.length; index += 1) {
    const currentAtr = atr[index];
    if (currentAtr === null || currentAtr === 0) continue;
    const baselineAtr = atr.slice(index - input.atrBaselineLookback, index).filter((value): value is number => value !== null);
    if (baselineAtr.length !== input.atrBaselineLookback) continue;
    const bar = bars[index];
    const barRange = bar.high - bar.low;
    const bodyRatio = barRange === 0 ? 0 : Math.abs(bar.close - bar.open) / barRange;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const wickImbalance = barRange === 0 ? 0 : (upperWick - lowerWick) / barRange;
    const rangeBars = bars.slice(index - input.rangeLookback + 1, index + 1);
    const rangeHigh = Math.max(...rangeBars.map((item) => item.high));
    const rangeLow = Math.min(...rangeBars.map((item) => item.low));
    const rangePosition = rangeHigh === rangeLow ? 0.5 : (bar.close - rangeLow) / (rangeHigh - rangeLow);
    let firstSign: 1 | -1 | 0 = 0;
    let effectiveStreak = 0;
    if (input.features.includes("directional_streak")) {
      for (let cursor = index; cursor > 0 && effectiveStreak < input.streakMinimumBars; cursor -= 1) {
        const change = bars[cursor].close - bars[cursor - 1].close;
        const sign = change > 0 ? 1 : change < 0 ? -1 : 0;
        if (effectiveStreak === 0) firstSign = sign;
        if (sign === 0 || sign !== firstSign) break;
        effectiveStreak += 1;
      }
    }
    const gapAtr = (bar.open - bars[index - 1].close) / currentAtr;
    const labels: Partial<Record<FeatureOutcomeFeature, string>> = {};
    if (input.features.includes("atr_compression")) {
      const ratio = currentAtr / median(baselineAtr);
      labels.atr_compression = ratio < input.atrCompressionLowRatio ? "compressed"
        : ratio > input.atrCompressionHighRatio ? "expanded" : "normal";
    }
    if (input.features.includes("body_direction")) {
      labels.body_direction = bodyRatio < input.bodyRatioThreshold ? "indecision"
        : bar.close > bar.open ? "bullish_body" : bar.close < bar.open ? "bearish_body" : "indecision";
    }
    if (input.features.includes("wick_imbalance")) {
      labels.wick_imbalance = wickImbalance > input.wickImbalanceThreshold ? "upper_wick_dominant"
        : wickImbalance < -input.wickImbalanceThreshold ? "lower_wick_dominant" : "balanced_wicks";
    }
    if (input.features.includes("directional_streak")) {
      labels.directional_streak = effectiveStreak >= input.streakMinimumBars
        ? firstSign === 1 ? "up_streak" : "down_streak" : "mixed";
    }
    if (input.features.includes("range_position")) {
      labels.range_position = rangePosition < input.rangePositionLower ? "lower_range"
        : rangePosition > input.rangePositionUpper ? "upper_range" : "middle_range";
    }
    if (input.features.includes("gap_direction")) {
      labels.gap_direction = gapAtr > input.gapAtrThreshold ? "gap_up"
        : gapAtr < -input.gapAtrThreshold ? "gap_down" : "no_material_gap";
    }
    const signalTimeMs = bar.time * 1_000;
    if (signalFromMs !== null && signalTimeMs < signalFromMs) {
      signalBeforeWindowExcluded += 1;
      continue;
    }
    if (signalToMs !== null && signalTimeMs >= signalToMs) {
      signalAfterWindowExcluded += 1;
      continue;
    }
    signalWindowEligible += 1;
    if (input.regime !== null) {
      const regime = regimesByTime.get(bar.time);
      if (!regime) { regimeUnclassified += 1; continue; }
      if (regime.directionalRegime !== input.regime.directionalRegime ||
          (input.regime.volatilityRegime !== null && regime.volatilityRegime !== input.regime.volatilityRegime)) {
        regimeExcluded += 1;
        continue;
      }
    }
    regimeMatched += 1;
    const observation = { signalIndex: index, signalTime: bar.timeIso, labels, outcomes: outcomeFor(bars, index, input.horizons) };
    referenceObservations.push(observation);
    if (selection !== null && labels[selection.feature] !== selection.bucket) {
      featureSelectionExcluded += 1;
      continue;
    }
    featureSelectionMatched += 1;
    observations.push(observation);
  }

  const folds = input.folds.map((fold) => ({ ...fold,
    fromMs: canonicalTime(fold.from, `${fold.foldId}.from`), toMs: canonicalTime(fold.to, `${fold.foldId}.to`) }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("feature-outcome folds must not overlap");
  }
  const qualityIssues = [
    ...(observations.length < input.minimumObservations ? ["minimum_observation_count_not_met"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
    ...(irregularIntervals > 0 ? ["irregular_timestamps_not_forward_filled"] : []),
    ...(input.regime !== null && signalWindowEligible > 0 && regimeMatched === 0 ? ["no_observations_match_regime"] : []),
    ...(selection !== null && regimeMatched > 0 && featureSelectionMatched === 0 ? ["no_observations_match_feature_selection"] : []),
    ...((signalFromMs !== null || signalToMs !== null) && signalWindowEligible === 0 ? ["no_observations_match_signal_window"] : []),
    ...(regimeEvidence?.qualityIssues ?? []).map((issue) => `regime_${issue}`),
  ];
  const returnedObservations = input.observationLimit === 0 ? [] : observations.slice(-input.observationLimit);
  const familyTests = (selection === null
    ? input.features.reduce((sum, feature) => sum + FEATURE_BUCKETS[feature].length, 0)
    : 1) * input.horizons.length * configurationTrials;
  const bonferroni = {
    familyTests,
    nominalAlpha: 1 - confidenceLevel,
    adjustedAlpha: (1 - confidenceLevel) / familyTests,
    candidateHorizon: 1 as const,
    minimumObservations: input.minimumObservations,
    minimumEffectBps: input.minimumEffectBps,
  };
  const definition = {
    minimumEffectBps: input.minimumEffectBps,
    atrLookback: input.atrLookback,
    atrBaselineLookback: input.atrBaselineLookback,
    rangeLookback: input.rangeLookback,
    streakMinimumBars: input.streakMinimumBars,
    bodyRatioThreshold: input.bodyRatioThreshold,
    wickImbalanceThreshold: input.wickImbalanceThreshold,
    atrCompressionLowRatio: input.atrCompressionLowRatio,
    atrCompressionHighRatio: input.atrCompressionHighRatio,
    rangePositionLower: input.rangePositionLower,
    rangePositionUpper: input.rangePositionUpper,
    gapAtrThreshold: input.gapAtrThreshold,
    regime: input.regime,
    selection,
    signalFrom,
    signalTo,
  };
  if (input.empiricalNullCalibration === true && !input.horizons.includes(1)) {
    throw new Error("empirical null calibration requires horizon 1");
  }
  const empiricalNullCalibration = input.empiricalNullCalibration === true
    ? buildEmpiricalNullCalibration({
      observations,
      referenceObservations,
      bars,
      symbol: input.symbol,
      timeframe: input.timeframe,
      features: input.features,
      horizons: input.horizons,
      confidenceLevel,
      definition,
      configurationTrials,
      minimumObservations: input.minimumObservations,
    })
    : undefined;
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "feature_outcome_relationships_v1" as const,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    features: input.features,
    definition,
    outcomeContract: {
      reference: "signal_bar_close_event_study_only_not_assumed_fill" as const,
      horizons: input.horizons,
      horizonUnit: "subsequent_observed_bars" as const,
      horizonClock: "observed_market_bars" as const,
      contiguousBarsRequired: false,
      calendarGapsIncluded: true,
      forwardFill: false,
      intrabarOrderingAssumed: false,
    },
    sample: {
      barsReceived: input.bars.length,
      closedBars: bars.length,
      observations: observations.length,
      minimumObservations: input.minimumObservations,
    },
    quality: {
      formingBarsExcluded, irregularIntervals, warmupBars, regimeUnclassified, regimeExcluded,
      signalBeforeWindowExcluded, signalAfterWindowExcluded, featureSelectionExcluded,
      signalWindowEligible, regimeMatched, featureSelectionMatched,
    },
    qualityIssues,
    ...(regimeEvidence === null ? {} : { regimeEvidence: {
      methodologyVersion: regimeEvidence.methodologyVersion,
      thresholds: regimeEvidence.thresholds,
      sample: regimeEvidence.sample,
      quality: regimeEvidence.quality,
      qualityIssues: regimeEvidence.qualityIssues,
      filter: input.regime,
    } }),
    inferenceContract: {
      confidenceLevel,
      meanIntervalMethod: "normal_approximation" as const,
      rateIntervalMethod: "wilson_score" as const,
      serialDependenceAdjustment: "none" as const,
      multipleTestingAdjustment: "bonferroni_family_wise_error_rate" as const,
      configurationTrials,
      familyTests,
      bonferroniAdjustedAlpha: bonferroni.adjustedAlpha,
      candidateEligibility: "requires_empirical_null_calibration_after_horizon_1_newey_west_and_bonferroni" as const,
      // False means candidateEligible here has an error rate nobody has measured. Audits set this
      // deliberately while calibrating a new study; a real-market run should not.
      matchesCalibratedStudy: calibratedStudyDeparturesFound.length === 0,
      calibratedStudyDepartures: calibratedStudyDeparturesFound,
    },
    inferenceWarnings: [
        "confidence_intervals_do_not_adjust_for_serial_dependence",
        "bonferroni_adjustment_is_applied_to_feature_bucket_horizon_eligibility",
        "candidate_eligibility_is_limited_to_horizon_1_non_overlapping_forward_returns_with_newey_west_inference",
    ],
    ...(empiricalNullCalibration === undefined ? {} : { empiricalNullCalibration }),
    byFeature: classify(observations, input.features, input.horizons, confidenceLevel, bonferroni,
      empiricalNullCalibration),
    ...(selection === null ? {} : { selectionContrast: selectionContrast(observations, referenceObservations, input.horizons, confidenceLevel) }),
    folds: folds.map((fold) => {
      const selected = observations.filter((row) => {
        const time = Date.parse(row.signalTime);
        return time >= fold.fromMs && time < fold.toMs;
      });
      const reference = referenceObservations.filter((row) => {
        const time = Date.parse(row.signalTime);
        return time >= fold.fromMs && time < fold.toMs;
      });
      return { foldId: fold.foldId, from: fold.from, to: fold.to, observations: selected.length,
        byFeature: classify(selected, input.features, input.horizons, confidenceLevel),
        ...(selection === null ? {} : { selectionContrast: selectionContrast(selected, reference, input.horizons, confidenceLevel) }) };
    }),
    observations: returnedObservations.map((row) => ({
      signalTime: row.signalTime,
      labels: row.labels,
      outcomes: row.outcomes,
    })),
    observationsReturned: returnedObservations.length,
    observationsTruncated: observations.length > input.observationLimit,
    ...(selection === null ? {} : { contrastLimitations: [
      "The selected population is contained in the reference population, so this descriptive difference is not an independent-sample test.",
      "The contrast does not adjust for serial dependence, multiple testing, costs, or execution assumptions.",
    ] }),
  };
}
