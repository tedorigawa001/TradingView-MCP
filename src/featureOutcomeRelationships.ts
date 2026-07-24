import type { OhlcvBar } from "./tradingview.js";
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

export interface FeatureOutcomeRelationshipsInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  features: FeatureOutcomeFeature[];
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

function stats(values: number[]) {
  return {
    count: values.length,
    mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    minimum: values.length === 0 ? null : Math.min(...values),
    maximum: values.length === 0 ? null : Math.max(...values),
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

function summarize(observations: Observation[], horizons: number[]) {
  return Object.fromEntries(horizons.map((horizon) => {
    const outcomes = observations.map((row) => row.outcomes[String(horizon)]).filter((value) => value !== null);
    const returns = outcomes.map((outcome) => outcome!.forwardReturn);
    return [String(horizon), {
      availableObservations: outcomes.length,
      unavailableObservations: observations.length - outcomes.length,
      forwardReturn: stats(returns),
      positiveRate: returns.length === 0 ? null : returns.filter((value) => value > 0).length / returns.length,
      maxUpside: stats(outcomes.map((outcome) => outcome!.maxUpside)),
      maxDownside: stats(outcomes.map((outcome) => outcome!.maxDownside)),
    }];
  }));
}

function classify<T extends Observation>(
  rows: T[],
  features: FeatureOutcomeFeature[],
  horizons: number[],
) {
  return Object.fromEntries(features.map((feature) => {
    const buckets = [...new Set(rows.map((row) => row.labels[feature]).filter((value): value is string => value !== undefined))]
      .sort();
    return [feature, Object.fromEntries(buckets.map((bucket) => {
      const selected = rows.filter((row) => row.labels[feature] === bucket);
      return [bucket, { observations: selected.length, horizons: summarize(selected, horizons) }];
    }))];
  }));
}

export function computeFeatureOutcomeRelationships(input: FeatureOutcomeRelationshipsInput) {
  const timeframeMs = marketRegimeResolutionMilliseconds(input.timeframe);
  if (!timeframeMs || /M$/i.test(input.timeframe)) {
    throw new Error("feature-outcome relationships require a fixed-duration timeframe");
  }
  if (input.features.length < 1 || input.features.length > 6 || new Set(input.features).size !== input.features.length) {
    throw new Error("features must contain one to six unique feature names");
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
    if (input.regime !== null) {
      const regime = regimesByTime.get(bar.time);
      if (!regime) { regimeUnclassified += 1; continue; }
      if (regime.directionalRegime !== input.regime.directionalRegime ||
          (input.regime.volatilityRegime !== null && regime.volatilityRegime !== input.regime.volatilityRegime)) {
        regimeExcluded += 1;
        continue;
      }
    }
    observations.push({ signalIndex: index, signalTime: bar.timeIso, labels, outcomes: outcomeFor(bars, index, input.horizons) });
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
    ...(input.regime !== null && observations.length === 0 ? ["no_observations_match_regime"] : []),
    ...(regimeEvidence?.qualityIssues ?? []).map((issue) => `regime_${issue}`),
  ];
  const returnedObservations = input.observationLimit === 0 ? [] : observations.slice(-input.observationLimit);
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "feature_outcome_relationships_v1" as const,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    features: input.features,
    definition: {
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
    },
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
    quality: { formingBarsExcluded, irregularIntervals, warmupBars, regimeUnclassified, regimeExcluded },
    qualityIssues,
    ...(regimeEvidence === null ? {} : { regimeEvidence: {
      methodologyVersion: regimeEvidence.methodologyVersion,
      thresholds: regimeEvidence.thresholds,
      sample: regimeEvidence.sample,
      quality: regimeEvidence.quality,
      qualityIssues: regimeEvidence.qualityIssues,
      filter: input.regime,
    } }),
    byFeature: classify(observations, input.features, input.horizons),
    folds: folds.map((fold) => {
      const selected = observations.filter((row) => {
        const time = Date.parse(row.signalTime);
        return time >= fold.fromMs && time < fold.toMs;
      });
      return { foldId: fold.foldId, from: fold.from, to: fold.to, observations: selected.length,
        byFeature: classify(selected, input.features, input.horizons) };
    }),
    observations: returnedObservations.map((row) => ({
      signalTime: row.signalTime,
      labels: row.labels,
      outcomes: row.outcomes,
    })),
    observationsReturned: returnedObservations.length,
    observationsTruncated: observations.length > input.observationLimit,
  };
}
