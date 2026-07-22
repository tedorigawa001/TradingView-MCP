import type { OhlcvBar } from "./tradingview.js";
import { marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

export type CorrelationRegime = "strong_positive" | "positive" | "neutral" | "negative" | "strong_negative";

export type CorrelationRegimeObservation = {
  time: number;
  timeIso: string;
  correlation: number;
  regime: CorrelationRegime;
};

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftSum += a * a;
    rightSum += b * b;
  }
  const denominator = Math.sqrt(leftSum * rightSum);
  return denominator === 0 ? null : numerator / denominator;
}

export function computeCorrelationRegimes(input: {
  primaryBars: OhlcvBar[];
  referenceBars: OhlcvBar[];
  timeframe: string;
  window: number;
  strongThreshold: number;
  neutralThreshold: number;
}) {
  if (!Number.isInteger(input.window) || input.window < 2 || input.window > 500) {
    throw new Error("correlation window must be an integer from 2 to 500");
  }
  if (!(input.neutralThreshold >= 0 && input.neutralThreshold < input.strongThreshold && input.strongThreshold <= 1)) {
    throw new Error("correlation thresholds must satisfy 0 <= neutral < strong <= 1");
  }
  const primary = input.primaryBars.filter((bar) => !bar.forming).sort((a, b) => a.time - b.time);
  const reference = new Map(input.referenceBars.filter((bar) => !bar.forming).map((bar) => [bar.time, bar]));
  const aligned = primary.flatMap((bar) => {
    const match = reference.get(bar.time);
    return match === undefined ? [] : [{ primary: bar, reference: match }];
  });
  const nominalIntervalMs = marketRegimeResolutionMilliseconds(input.timeframe);
  const irregularIntervals = nominalIntervalMs === null ? 0 : aligned.slice(1).filter((item, index) =>
    (item.primary.time - aligned[index].primary.time) * 1000 > nominalIntervalMs * 1.5).length;
  const observations: CorrelationRegimeObservation[] = [];
  for (let index = input.window; index < aligned.length; index += 1) {
    const sample = aligned.slice(index - input.window, index + 1);
    const primaryReturns = sample.slice(1).map((item, offset) => Math.log(item.primary.close / sample[offset].primary.close));
    const referenceReturns = sample.slice(1).map((item, offset) => Math.log(item.reference.close / sample[offset].reference.close));
    const value = pearson(primaryReturns, referenceReturns);
    if (value === null) continue;
    const regime: CorrelationRegime = value >= input.strongThreshold ? "strong_positive"
      : value >= input.neutralThreshold ? "positive"
      : value <= -input.strongThreshold ? "strong_negative"
      : value <= -input.neutralThreshold ? "negative" : "neutral";
    observations.push({ time: aligned[index].primary.time, timeIso: aligned[index].primary.timeIso, correlation: value, regime });
  }
  return {
    methodologyVersion: "rolling_exact_timestamp_return_correlation_v1" as const,
    alignmentPolicy: "exact_utc_timestamp_no_forward_fill" as const,
    sample: { primaryClosedBars: primary.length, referenceClosedBars: reference.size, alignedBars: aligned.length, observations: observations.length },
    quality: { irregularIntervals },
    qualityIssues: [
      ...(aligned.length < input.window + 1 ? ["insufficient_exactly_aligned_history"] : []),
      ...(irregularIntervals > 0 ? ["one_or_more_non_contiguous_bar_intervals"] : []),
    ],
    observations,
  };
}
