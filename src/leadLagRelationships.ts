import type { OhlcvBar } from "./tradingview.js";
import { marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

export interface LeadLagFold {
  foldId: string;
  from: string;
  to: string;
}

export interface LeadLagInput {
  primaryBars: OhlcvBar[];
  referenceBars: OhlcvBar[];
  primarySymbol: string;
  referenceSymbol: string;
  timeframe: string;
  maxLagBars: number;
  minimumObservations: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  folds: LeadLagFold[];
  configurationTrials: number;
}

const NORMAL_Z = { 0.9: 1.6448536269514722, 0.95: 1.959963984540054, 0.99: 2.5758293035489004 } as const;

function canonicalTime(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be a valid UTC timestamp`);
  return parsed;
}

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

// Fisher z is the standard interval for a correlation coefficient; a normal interval on r itself
// is not valid near the -1/+1 bounds. It needs more than three observations to have any width.
function fisherConfidenceInterval(
  correlation: number | null,
  observations: number,
  confidenceLevel: 0.9 | 0.95 | 0.99,
) {
  const base = { method: "fisher_z" as const, confidenceLevel, observations };
  if (correlation === null || observations <= 3) {
    return { status: "insufficient_sample" as const, ...base, lower: null, upper: null };
  }
  // atanh(+/-1) is infinite, so a perfectly collinear pair has no finite interval. That is a
  // degenerate fit rather than a small sample, and mislabelling it would hide the difference.
  if (Math.abs(correlation) >= 1) {
    return { status: "degenerate_correlation" as const, ...base, lower: null, upper: null };
  }
  const z = Math.atanh(correlation);
  const margin = NORMAL_Z[confidenceLevel] / Math.sqrt(observations - 3);
  return {
    status: "available" as const,
    ...base,
    lower: Math.tanh(z - margin),
    upper: Math.tanh(z + margin),
  };
}

function leadDirection(lagBars: number) {
  if (lagBars > 0) return "reference_leads_primary" as const;
  if (lagBars < 0) return "primary_leads_reference" as const;
  return "contemporaneous" as const;
}

/**
 * Descriptive lead/lag scan between two exactly aligned return series.
 *
 * A positive lag pairs an earlier reference return with a later primary return, so only positive
 * lags describe the reference leading the primary. Negative lags are reported for symmetry and are
 * not tradable on the primary. Every inspected lag is returned; the scan never selects a best lag,
 * because choosing the extreme of a scanned grid and then quoting its interval is precisely the
 * multiple-comparisons error this contract exists to prevent.
 */
export function computeLeadLagRelationships(input: LeadLagInput) {
  if (!Number.isInteger(input.maxLagBars) || input.maxLagBars < 1 || input.maxLagBars > 50) {
    throw new Error("max_lag_bars must be an integer from 1 to 50");
  }
  if (!Number.isInteger(input.minimumObservations) || input.minimumObservations < 4) {
    throw new Error("minimum_observations must be an integer of at least 4");
  }
  if (!Number.isInteger(input.configurationTrials) || input.configurationTrials < 1) {
    throw new Error("configuration_trials must be a positive integer");
  }
  if (new Set(input.folds.map((fold) => fold.foldId)).size !== input.folds.length) {
    throw new Error("lead/lag folds must have unique fold ids");
  }
  const folds = input.folds.map((fold) => ({
    ...fold,
    fromMs: canonicalTime(fold.from, `${fold.foldId}.from`),
    toMs: canonicalTime(fold.to, `${fold.foldId}.to`),
  }));
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) {
    throw new Error("lead/lag fold end must be after fold start");
  }
  if (folds.some((left, index) =>
    folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("lead/lag folds must not overlap");
  }

  const primary = input.primaryBars.filter((bar) => !bar.forming).sort((a, b) => a.time - b.time);
  const referenceClosed = input.referenceBars.filter((bar) => !bar.forming);
  const reference = new Map(referenceClosed.map((bar) => [bar.time, bar]));
  const formingBarsExcluded = (input.primaryBars.length - primary.length) +
    (input.referenceBars.length - referenceClosed.length);

  // Exact UTC timestamp join only; a missing reference bar drops the pair instead of being filled.
  const aligned = primary.flatMap((bar) => {
    const match = reference.get(bar.time);
    return match === undefined ? [] : [{ primary: bar, reference: match }];
  });

  const nominalIntervalMs = marketRegimeResolutionMilliseconds(input.timeframe);
  const irregularIntervals = nominalIntervalMs === null ? 0 : aligned.slice(1).filter((item, index) =>
    (item.primary.time - aligned[index].primary.time) * 1000 > nominalIntervalMs * 1.5).length;

  // Returns are indexed against the later bar of each consecutive aligned pair.
  const returnTimes = aligned.slice(1).map((item) => item.primary);
  const primaryReturns = aligned.slice(1).map((item, index) =>
    Math.log(item.primary.close / aligned[index].primary.close));
  const referenceReturns = aligned.slice(1).map((item, index) =>
    Math.log(item.reference.close / aligned[index].reference.close));

  const foldOf = (timeMs: number) =>
    folds.find((fold) => timeMs >= fold.fromMs && timeMs < fold.toMs)?.foldId ?? null;

  const lags = Array.from({ length: input.maxLagBars * 2 + 1 }, (_, index) => index - input.maxLagBars);
  const byLag = lags.map((lagBars) => {
    const pairedPrimary: number[] = [];
    const pairedReference: number[] = [];
    const pairedTimes: OhlcvBar[] = [];
    for (let index = 0; index < primaryReturns.length; index += 1) {
      const referenceIndex = index - lagBars;
      if (referenceIndex < 0 || referenceIndex >= referenceReturns.length) continue;
      pairedPrimary.push(primaryReturns[index]);
      pairedReference.push(referenceReturns[referenceIndex]);
      pairedTimes.push(returnTimes[index]);
    }
    const observations = pairedPrimary.length;
    const evaluable = observations >= input.minimumObservations;
    const correlation = evaluable ? pearson(pairedPrimary, pairedReference) : null;

    const foldResults = folds.map((fold) => {
      const indices = pairedTimes.flatMap((bar, index) =>
        foldOf(bar.time * 1000) === fold.foldId ? [index] : []);
      const foldObservations = indices.length;
      const foldEvaluable = foldObservations >= input.minimumObservations;
      const foldCorrelation = foldEvaluable
        ? pearson(indices.map((index) => pairedPrimary[index]), indices.map((index) => pairedReference[index]))
        : null;
      return {
        foldId: fold.foldId,
        from: fold.from,
        to: fold.to,
        observations: foldObservations,
        correlation: foldCorrelation,
        status: foldEvaluable
          ? (foldCorrelation === null ? "not_evaluable" as const : "evaluable" as const)
          : "insufficient_sample" as const,
      };
    });

    const evaluableFolds = foldResults.filter((fold) => fold.correlation !== null);
    const sameSignFolds = correlation === null ? 0
      : evaluableFolds.filter((fold) => Math.sign(fold.correlation as number) === Math.sign(correlation)).length;

    return {
      lagBars,
      leadDirection: leadDirection(lagBars),
      tradableOnPrimary: lagBars > 0,
      observations,
      status: evaluable
        ? (correlation === null ? "not_evaluable" as const : "evaluable" as const)
        : "insufficient_sample" as const,
      correlation,
      confidenceInterval: fisherConfidenceInterval(correlation, observations, input.confidenceLevel),
      folds: foldResults,
      foldStability: {
        evaluableFolds: evaluableFolds.length,
        sameSignFolds,
        signStable: evaluableFolds.length > 0 && sameSignFolds === evaluableFolds.length,
      },
    };
  });

  const lagsInspected = byLag.length;
  const evaluableLags = byLag.filter((lag) => lag.status === "evaluable").length;
  const qualityIssues = [
    ...(aligned.length < 2 ? ["insufficient_exactly_aligned_history"] : []),
    ...(irregularIntervals > 0 ? ["one_or_more_non_contiguous_bar_intervals"] : []),
    ...(evaluableLags < lagsInspected ? ["one_or_more_lags_not_evaluable"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
  ];

  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "exact_timestamp_lead_lag_return_correlation_v1" as const,
    alignmentPolicy: "exact_utc_timestamp_no_forward_fill" as const,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    primarySymbol: input.primarySymbol,
    referenceSymbol: input.referenceSymbol,
    timeframe: input.timeframe,
    definition: {
      maxLagBars: input.maxLagBars,
      minimumObservations: input.minimumObservations,
      returnBasis: "log_close_to_close_on_consecutive_aligned_bars" as const,
      lagConvention: "positive_lag_pairs_an_earlier_reference_return_with_a_later_primary_return" as const,
    },
    sample: {
      primaryClosedBars: primary.length,
      referenceClosedBars: reference.size,
      alignedBars: aligned.length,
      returnObservations: primaryReturns.length,
    },
    quality: { formingBarsExcluded, irregularIntervals },
    qualityIssues,
    inferenceContract: {
      confidenceLevel: input.confidenceLevel,
      intervalMethod: "fisher_z" as const,
      lagsInspected,
      evaluableLags,
      configurationTrials: input.configurationTrials,
      serialDependenceAdjustment: "none" as const,
      multipleTestingAdjustment: "none" as const,
      // Reference only. It is never applied to the intervals above.
      bonferroniAdjustedAlphaReference: (1 - input.confidenceLevel) / (lagsInspected * input.configurationTrials),
      automaticLagSelection: false,
      ranking: false,
    },
    inferenceWarnings: [
      "confidence_intervals_do_not_adjust_for_serial_dependence",
      "no_multiple_testing_adjustment_applied",
      "every_scanned_lag_is_reported_and_no_best_lag_is_selected",
      ...(input.maxLagBars > 1 ? ["scanning_many_lags_inflates_the_chance_of_one_interval_excluding_zero"] : []),
    ],
    byLag,
    limitations: [
      "This is a descriptive correlation scan, not an event study, a forecast, or a tradable signal.",
      "Correlation between contemporaneous or lagged returns does not establish a causal lead.",
      "Only positive lags describe the reference leading the primary; negative lags are not tradable on the primary.",
      "Overlapping return windows are serially dependent, so the intervals are narrower than the effective sample supports.",
      "Selecting the strongest lag from this scan and quoting its interval as an out-of-sample result is invalid.",
    ],
  };
}
