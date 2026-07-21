import type { OhlcvBar } from "./tradingview.js";

export type DirectionalRegime = "trend_up" | "trend_down" | "range" | "transition";
export type VolatilityRegime = "low" | "normal" | "high";

export interface MarketRegimeInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  trendLookback: number;
  atrLookback: number;
  volatilityBaselineLookback: number;
  trendEfficiencyThreshold: number;
  rangeEfficiencyThreshold: number;
  directionalMoveAtrThreshold: number;
  highVolatilityRatio: number;
  lowVolatilityRatio: number;
  minimumClassifiedBars: number;
  observationLimit: number;
}

type ClassifiedObservation = {
  time: number;
  timeIso: string;
  close: number;
  directionalRegime: DirectionalRegime;
  volatilityRegime: VolatilityRegime;
  efficiencyRatio: number;
  directionalMoveAtr: number;
  atrPercent: number;
  volatilityRatio: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function resolutionMilliseconds(value: string): number | null {
  if (/^[1-9]\d*$/.test(value)) return Number(value) * 60_000;
  const match = value.match(/^([1-9]\d*)?([SDWM])$/i);
  if (!match) return null;
  const count = Number(match[1] ?? 1);
  const unit = match[2].toUpperCase();
  return count * ({ S: 1_000, D: 86_400_000, W: 604_800_000, M: 2_592_000_000 }[unit] ?? 0);
}

function validateInput(input: MarketRegimeInput): void {
  if (input.bars.length < 3) throw new Error("at least three OHLC bars are required");
  if (!Number.isInteger(input.trendLookback) || input.trendLookback < 2 || input.trendLookback > 500) {
    throw new Error("trend lookback must be an integer between 2 and 500");
  }
  if (!Number.isInteger(input.atrLookback) || input.atrLookback < 2 || input.atrLookback > 250) {
    throw new Error("ATR lookback must be an integer between 2 and 250");
  }
  if (!Number.isInteger(input.volatilityBaselineLookback) || input.volatilityBaselineLookback < 5 ||
      input.volatilityBaselineLookback > 1000) {
    throw new Error("volatility baseline lookback must be an integer between 5 and 1000");
  }
  if (!(input.rangeEfficiencyThreshold >= 0 &&
      input.rangeEfficiencyThreshold < input.trendEfficiencyThreshold &&
      input.trendEfficiencyThreshold <= 1)) {
    throw new Error("efficiency thresholds must satisfy 0 <= range < trend <= 1");
  }
  if (!(input.directionalMoveAtrThreshold > 0)) throw new Error("directional move threshold must be positive");
  if (!(input.lowVolatilityRatio > 0 && input.lowVolatilityRatio < 1 &&
      input.highVolatilityRatio > 1)) {
    throw new Error("volatility thresholds must satisfy 0 < low < 1 < high");
  }
  if (!Number.isInteger(input.minimumClassifiedBars) || input.minimumClassifiedBars < 1) {
    throw new Error("minimum classified bars must be a positive integer");
  }
  if (!Number.isInteger(input.observationLimit) || input.observationLimit < 0 || input.observationLimit > 500) {
    throw new Error("observation limit must be an integer between 0 and 500");
  }
}

function countValues<T extends string>(values: T[], allowed: readonly T[]): Record<T, number> {
  return Object.fromEntries(allowed.map((value) => [value, values.filter((item) => item === value).length])) as Record<T, number>;
}

export function computeMarketRegimes(input: MarketRegimeInput) {
  validateInput(input);
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) {
    throw new Error("duplicate OHLC timestamps");
  }
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) || !Number.isFinite(bar.close) || bar.low > bar.high ||
      bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high ||
      bar.close <= 0)) {
    throw new Error("invalid OHLC bar");
  }

  const formingBarsExcluded = bars.filter((bar) => bar.forming === true).length;
  const closed = bars.filter((bar) => bar.forming !== true);
  const intervalMs = resolutionMilliseconds(input.timeframe);
  const irregularIntervals = intervalMs === null ? 0 : closed.slice(1).filter((bar, index) =>
    (bar.time - closed[index].time) * 1000 > intervalMs * 1.5).length;

  const trueRanges = closed.map((bar, index) => {
    if (index === 0) return null;
    const previousClose = closed[index - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  const atrPercent: Array<number | null> = closed.map((bar, index) => {
    const from = index - input.atrLookback + 1;
    if (from < 1) return null;
    const values = trueRanges.slice(from, index + 1);
    if (values.some((value) => value === null)) return null;
    const numericValues = values as number[];
    return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length / bar.close;
  });

  const observations: ClassifiedObservation[] = [];
  for (let index = 0; index < closed.length; index += 1) {
    const trendStart = index - input.trendLookback;
    const baselineStart = index - input.volatilityBaselineLookback + 1;
    if (trendStart < 0 || baselineStart < 0 || atrPercent[index] === null) continue;
    const baseline = atrPercent.slice(baselineStart, index + 1);
    if (baseline.some((value) => value === null)) continue;
    const baselineMedian = median(baseline as number[]);
    if (!(baselineMedian > 0)) continue;

    const directionalMove = closed[index].close - closed[trendStart].close;
    const pathLength = closed.slice(trendStart + 1, index + 1).reduce((sum, bar, offset) =>
      sum + Math.abs(bar.close - closed[trendStart + offset].close), 0);
    const efficiencyRatio = pathLength === 0 ? 0 : Math.abs(directionalMove) / pathLength;
    const currentAtrPrice = atrPercent[index]! * closed[index].close;
    const directionalMoveAtr = currentAtrPrice === 0 ? 0 : directionalMove / currentAtrPrice;
    const volatilityRatio = atrPercent[index]! / baselineMedian;

    let directionalRegime: DirectionalRegime = "transition";
    if (efficiencyRatio >= input.trendEfficiencyThreshold &&
        Math.abs(directionalMoveAtr) >= input.directionalMoveAtrThreshold) {
      directionalRegime = directionalMoveAtr > 0 ? "trend_up" : "trend_down";
    } else if (efficiencyRatio <= input.rangeEfficiencyThreshold &&
        Math.abs(directionalMoveAtr) < input.directionalMoveAtrThreshold) {
      directionalRegime = "range";
    }
    const volatilityRegime: VolatilityRegime = volatilityRatio >= input.highVolatilityRatio
      ? "high" : volatilityRatio <= input.lowVolatilityRatio ? "low" : "normal";
    observations.push({
      time: closed[index].time,
      timeIso: closed[index].timeIso ?? new Date(closed[index].time * 1000).toISOString(),
      close: closed[index].close,
      directionalRegime,
      volatilityRegime,
      efficiencyRatio,
      directionalMoveAtr,
      atrPercent: atrPercent[index]!,
      volatilityRatio,
    });
  }

  const directionalLabels = ["trend_up", "trend_down", "range", "transition"] as const;
  const volatilityLabels = ["low", "normal", "high"] as const;
  const combinedCounts: Record<string, number> = {};
  const transitions: Record<string, number> = {};
  for (const [index, observation] of observations.entries()) {
    const combined = `${observation.directionalRegime}:${observation.volatilityRegime}`;
    combinedCounts[combined] = (combinedCounts[combined] ?? 0) + 1;
    if (index > 0) {
      const previous = observations[index - 1];
      const key = `${previous.directionalRegime}:${previous.volatilityRegime}->${combined}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
    }
  }
  const qualityIssues = [
    ...(observations.length < input.minimumClassifiedBars ? ["minimum_classified_bars_not_met"] : []),
    ...(irregularIntervals > 0 ? ["one_or_more_non_contiguous_bar_intervals"] : []),
  ];
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "deterministic_market_regimes_v1" as const,
    status: observations.length >= input.minimumClassifiedBars ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    thresholds: {
      trendLookback: input.trendLookback,
      atrLookback: input.atrLookback,
      volatilityBaselineLookback: input.volatilityBaselineLookback,
      trendEfficiencyThreshold: input.trendEfficiencyThreshold,
      rangeEfficiencyThreshold: input.rangeEfficiencyThreshold,
      directionalMoveAtrThreshold: input.directionalMoveAtrThreshold,
      highVolatilityRatio: input.highVolatilityRatio,
      lowVolatilityRatio: input.lowVolatilityRatio,
    },
    sample: {
      barsReceived: bars.length,
      closedBars: closed.length,
      classifiedBars: observations.length,
      minimumClassifiedBars: input.minimumClassifiedBars,
    },
    quality: { formingBarsExcluded, irregularIntervals },
    qualityIssues,
    current: observations.at(-1) ?? null,
    distribution: {
      directional: countValues(observations.map((item) => item.directionalRegime), directionalLabels),
      volatility: countValues(observations.map((item) => item.volatilityRegime), volatilityLabels),
      combined: combinedCounts,
    },
    transitions,
    observations: input.observationLimit === 0 ? [] : observations.slice(-input.observationLimit),
    observationsReturned: Math.min(observations.length, input.observationLimit),
    observationsTruncated: observations.length > input.observationLimit,
  };
}
