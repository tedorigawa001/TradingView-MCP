import type { OhlcvBar } from "./tradingview.js";
import { createHash } from "node:crypto";
import { estimateEffectiveMultiplicity, type EffectiveMultiplicityEstimate } from "./effectiveMultiplicity.js";
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
  empiricalNullCalibration?: boolean;
  alignmentPolicy?: LeadLagAlignmentPolicy;
  returnStandardization?: LeadLagReturnStandardization;
}

export type LeadLagReturnStandardization = "none" | "causal_prior_20_rms";

export type LeadLagAlignmentPolicy =
  | "exact_utc_timestamp_no_forward_fill"
  | "utc_grid_resampled_from_closed_60m_bars";

const NORMAL_Z = { 0.9: 1.6448536269514722, 0.95: 1.959963984540054, 0.99: 2.5758293035489004 } as const;
const EMPIRICAL_NULL_ITERATIONS = 1_000;
const EMPIRICAL_NULL_SEED = 20_260_731;
const EMPIRICAL_NULL_METHODOLOGY_RAW = "lead_lag_empirical_null_circular_shift_v1" as const;
const EMPIRICAL_NULL_METHODOLOGY_STANDARDIZED =
  "lead_lag_empirical_null_circular_shift_causal_prior_20_rms_v2" as const;
type EmpiricalNullMethodology =
  | typeof EMPIRICAL_NULL_METHODOLOGY_RAW
  | typeof EMPIRICAL_NULL_METHODOLOGY_STANDARDIZED;
export const LEAD_LAG_CAUSAL_VOLATILITY_WINDOW_BARS = 20;

export function causalPriorRmsStandardizePair(input: {
  primaryReturns: number[];
  referenceReturns: number[];
}) {
  if (input.primaryReturns.length !== input.referenceReturns.length) {
    throw new Error("lead/lag return series must have equal length before volatility standardization");
  }
  const window = LEAD_LAG_CAUSAL_VOLATILITY_WINDOW_BARS;
  const primary: number[] = [];
  const reference: number[] = [];
  for (let index = window; index < input.primaryReturns.length; index += 1) {
    let primarySquares = 0;
    let referenceSquares = 0;
    for (let prior = index - window; prior < index; prior += 1) {
      primarySquares += input.primaryReturns[prior] ** 2;
      referenceSquares += input.referenceReturns[prior] ** 2;
    }
    const primaryScale = Math.sqrt(primarySquares / window);
    const referenceScale = Math.sqrt(referenceSquares / window);
    if (!Number.isFinite(primaryScale) || primaryScale <= 0 ||
        !Number.isFinite(referenceScale) || referenceScale <= 0) {
      throw new Error(`lead/lag causal volatility scale is unavailable at return index ${index}`);
    }
    primary.push(input.primaryReturns[index] / primaryScale);
    reference.push(input.referenceReturns[index] / referenceScale);
  }
  return {
    primaryReturns: primary,
    referenceReturns: reference,
    warmupReturnsExcluded: Math.min(window, input.primaryReturns.length),
    windowBars: window,
  };
}

/**
 * Rebuild a shared UTC grid from closed lower-timeframe bars. This is deliberately stricter than
 * matching nearby pre-aggregated bars: every source interval in a target bucket must exist, or
 * the bucket is omitted. That prevents two vendors' differently anchored 4H/D bars from being
 * represented as if they measured the same return window.
 */
export function resampleClosedBarsToUtcGrid(input: {
  bars: OhlcvBar[];
  sourceTimeframe: string;
  targetTimeframe: string;
}) {
  const sourceMs = marketRegimeResolutionMilliseconds(input.sourceTimeframe);
  const targetMs = marketRegimeResolutionMilliseconds(input.targetTimeframe);
  if (sourceMs === null || targetMs === null || targetMs <= sourceMs || targetMs % sourceMs !== 0) {
    throw new Error("target timeframe must be an integer multiple of the source timeframe");
  }
  const intervalsPerBucket = targetMs / sourceMs;
  const closed = input.bars.filter((bar) => bar.forming !== true);
  const byTime = new Map<number, OhlcvBar>();
  for (const bar of closed) {
    if (!Number.isInteger(bar.time) || (bar.time * 1_000) % sourceMs !== 0) {
      throw new Error("source bars must be aligned to their declared UTC timeframe grid");
    }
    if (!Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close)) {
      throw new Error("source bars must contain finite OHLC values");
    }
    if (byTime.has(bar.time)) throw new Error("source bars contain duplicate UTC timestamps");
    byTime.set(bar.time, bar);
  }
  const starts = [...new Set([...byTime.keys()].map((time) =>
    Math.floor((time * 1_000) / targetMs) * targetMs / 1_000,
  ))].sort((left, right) => left - right);
  const bars: OhlcvBar[] = [];
  let incompleteBucketsExcluded = 0;
  for (const start of starts) {
    const bucket = Array.from({ length: intervalsPerBucket }, (_, index) => byTime.get(start + index * sourceMs / 1_000));
    if (bucket.some((bar) => bar === undefined)) {
      incompleteBucketsExcluded += 1;
      continue;
    }
    const complete = bucket as OhlcvBar[];
    const volumes = complete.map((bar) => bar.volume);
    bars.push({
      time: start,
      timeIso: new Date(start * 1_000).toISOString(),
      open: complete[0].open,
      high: Math.max(...complete.map((bar) => bar.high)),
      low: Math.min(...complete.map((bar) => bar.low)),
      close: complete.at(-1)!.close,
      volume: volumes.every((volume) => volume !== null)
        ? volumes.reduce((sum, volume) => sum + volume!, 0)
        : null,
    });
  }
  return {
    bars,
    sourceClosedBars: closed.length,
    sourceFormingBarsExcluded: input.bars.length - closed.length,
    intervalsPerBucket,
    incompleteBucketsExcluded,
  };
}

function normalCdf(value: number): number {
  // Abramowitz-Stegun 7.1.26. This is sufficient for a transparent Fisher-z screening threshold;
  // the returned p-value is descriptive, while the adjusted alpha is the actual decision boundary.
  const x = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * x);
  const density = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - tail;
  return value < 0 ? 1 - cdf : cdf;
}

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

function fisherTwoSidedPValue(correlation: number | null, observations: number): number | null {
  if (correlation === null || observations <= 3 || Math.abs(correlation) >= 1) return null;
  const statistic = Math.abs(Math.atanh(correlation)) * Math.sqrt(observations - 3);
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(statistic))));
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

function lagStatistic(primary: number[], reference: number[], lagBars: number): number | null {
  const pairedPrimary: number[] = [];
  const pairedReference: number[] = [];
  for (let index = 0; index < primary.length; index += 1) {
    const referenceIndex = index - lagBars;
    if (referenceIndex < 0 || referenceIndex >= reference.length) continue;
    pairedPrimary.push(primary[index]);
    pairedReference.push(reference[referenceIndex]);
  }
  const correlation = pearson(pairedPrimary, pairedReference);
  if (correlation === null || pairedPrimary.length <= 3 || Math.abs(correlation) >= 1) return null;
  const statistic = Math.abs(Math.atanh(correlation)) * Math.sqrt(pairedPrimary.length - 3);
  return Number.isFinite(statistic) ? statistic : null;
}

function fft(real: number[], imaginary: number[], inverse: boolean): void {
  const length = real.length;
  for (let index = 1, j = 0; index < length; index += 1) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (index < j) {
      [real[index], real[j]] = [real[j], real[index]];
      [imaginary[index], imaginary[j]] = [imaginary[j], imaginary[index]];
    }
  }
  for (let size = 2; size <= length; size <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    const phaseReal = Math.cos(angle);
    const phaseImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let currentReal = 1;
      let currentImaginary = 0;
      const half = size >> 1;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const productReal = real[odd] * currentReal - imaginary[odd] * currentImaginary;
        const productImaginary = real[odd] * currentImaginary + imaginary[odd] * currentReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + productReal;
        imaginary[even] = evenImaginary + productImaginary;
        real[odd] = evenReal - productReal;
        imaginary[odd] = evenImaginary - productImaginary;
        const nextReal = currentReal * phaseReal - currentImaginary * phaseImaginary;
        currentImaginary = currentReal * phaseImaginary + currentImaginary * phaseReal;
        currentReal = nextReal;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

/** Cross sums for every circular offset: sum(primary[i] * reference[(i + offset) % n]). */
function circularCrossSums(primary: number[], reference: number[]): number[] {
  const length = primary.length;
  let fftLength = 1;
  while (fftLength < length * 3 - 1) fftLength <<= 1;
  const leftReal = new Array<number>(fftLength).fill(0);
  const leftImaginary = new Array<number>(fftLength).fill(0);
  const rightReal = new Array<number>(fftLength).fill(0);
  const rightImaginary = new Array<number>(fftLength).fill(0);
  for (let index = 0; index < length; index += 1) {
    leftReal[length - 1 - index] = primary[index];
    rightReal[index] = reference[index];
    rightReal[length + index] = reference[index];
  }
  fft(leftReal, leftImaginary, false);
  fft(rightReal, rightImaginary, false);
  for (let index = 0; index < fftLength; index += 1) {
    const real = leftReal[index] * rightReal[index] - leftImaginary[index] * rightImaginary[index];
    const imaginary = leftReal[index] * rightImaginary[index] + leftImaginary[index] * rightReal[index];
    leftReal[index] = real;
    leftImaginary[index] = imaginary;
  }
  fft(leftReal, leftImaginary, true);
  return Array.from({ length }, (_, offset) => leftReal[length - 1 + offset]);
}

function shiftedLagStatistic(input: {
  primary: number[];
  reference: number[];
  primaryPrefix: number[];
  primarySquaresPrefix: number[];
  referenceDoubledPrefix: number[];
  referenceDoubledSquaresPrefix: number[];
  crossSums: number[];
  lag: number;
  shift: number;
}): number | null {
  const { primary, reference, primaryPrefix, primarySquaresPrefix, referenceDoubledPrefix,
    referenceDoubledSquaresPrefix, crossSums, lag, shift } = input;
  const count = primary.length;
  const observations = count - lag;
  if (observations <= 3) return null;
  const sumPrimary = primaryPrefix[count] - primaryPrefix[lag];
  const sumPrimarySquares = primarySquaresPrefix[count] - primarySquaresPrefix[lag];
  const referenceStart = shift;
  const referenceEnd = referenceStart + observations;
  const sumReference = referenceDoubledPrefix[referenceEnd] - referenceDoubledPrefix[referenceStart];
  const sumReferenceSquares = referenceDoubledSquaresPrefix[referenceEnd] - referenceDoubledSquaresPrefix[referenceStart];
  const offset = (shift - lag + count) % count;
  let cross = crossSums[offset];
  for (let index = 0; index < lag; index += 1) {
    cross -= primary[index] * reference[(index + offset) % count];
  }
  const covariance = cross - (sumPrimary * sumReference) / observations;
  const primaryVariance = sumPrimarySquares - (sumPrimary * sumPrimary) / observations;
  const referenceVariance = sumReferenceSquares - (sumReference * sumReference) / observations;
  const correlation = covariance / Math.sqrt(primaryVariance * referenceVariance);
  if (!Number.isFinite(correlation) || Math.abs(correlation) >= 1) return null;
  const statistic = Math.abs(Math.atanh(correlation)) * Math.sqrt(observations - 3);
  return Number.isFinite(statistic) ? statistic : null;
}

type EmpiricalNullCalibration = {
  schemaVersion: "1.0";
  methodologyVersion: EmpiricalNullMethodology;
  status: "complete" | "not_evaluable";
  iterations: number;
  seed: number;
  shiftPolicy: "uniform_circular_shift_of_reference_returns_outside_scanned_lag_family";
  excludedShiftRadiusBars: number;
  eligibleCircularShifts: number;
  familyStatistic: "maximum_absolute_fisher_z_statistic_across_positive_evaluable_lags";
  familyEligibleLags: number;
  nominalAlpha: number;
  /**
   * How many independent lags this family behaves like. Adjacent lags move together, so the
   * Bonferroni threshold built from the nominal count is stricter than the family warrants. Reported
   * beside that count and used by nothing.
   */
  effectiveMultiplicity: EffectiveMultiplicityEstimate;
  evidenceHash: string;
  calibrationId: string;
  byLag: Record<string, {
    status: "available" | "insufficient_sample";
    observedStatistic: number | null;
    familyWisePValue: number | null;
    passes: boolean;
  }>;
  limitations: string[];
};

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function buildEmpiricalNullCalibration(input: {
  primaryReturns: number[];
  referenceReturns: number[];
  lags: number[];
  minimumObservations: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  evidence: unknown;
  definition: unknown;
  methodology: EmpiricalNullMethodology;
}): EmpiricalNullCalibration {
  const positiveLags = input.lags.filter((lag) => lag > 0);
  const observed = new Map(positiveLags.map((lag) => [lag, lagStatistic(input.primaryReturns, input.referenceReturns, lag)]));
  const familyLags = positiveLags.filter((lag) => {
    const observations = input.primaryReturns.length - lag;
    return observations >= input.minimumObservations && observed.get(lag) !== null;
  });
  // A shift inside the inspected lag family could preserve exactly the relation being tested. It is
  // excluded so every null draw breaks every tested reference-leads-primary alignment.
  const count = input.referenceReturns.length;
  const shifts = Array.from({ length: Math.max(0, count - 1) }, (_, index) => index + 1)
    .filter((shift) => Math.min(shift, count - shift) > Math.max(...positiveLags));
  const primaryPrefix = [0];
  const primarySquaresPrefix = [0];
  const referenceDoubled = [...input.referenceReturns, ...input.referenceReturns];
  const referenceDoubledPrefix = [0];
  const referenceDoubledSquaresPrefix = [0];
  for (const value of input.primaryReturns) {
    primaryPrefix.push(primaryPrefix.at(-1)! + value);
    primarySquaresPrefix.push(primarySquaresPrefix.at(-1)! + value * value);
  }
  for (const value of referenceDoubled) {
    referenceDoubledPrefix.push(referenceDoubledPrefix.at(-1)! + value);
    referenceDoubledSquaresPrefix.push(referenceDoubledSquaresPrefix.at(-1)! + value * value);
  }
  const crossSums = circularCrossSums(input.primaryReturns, input.referenceReturns);
  const exceedances = new Map(positiveLags.map((lag) => [lag, 0]));
  // Kept, not recomputed. These are the per-lag statistics the maximum below is already taken over,
  // so retaining them costs one array and adds no draw to the sequence the calibration depends on.
  const nullStatistics: number[][] = [];
  if (familyLags.length > 0 && shifts.length > 0) {
    const random = createRandom(EMPIRICAL_NULL_SEED);
    for (let iteration = 0; iteration < EMPIRICAL_NULL_ITERATIONS; iteration += 1) {
      const shift = shifts[Math.floor(random() * shifts.length)];
      const replication = familyLags.map((lag) =>
        shiftedLagStatistic({ primary: input.primaryReturns, reference: input.referenceReturns,
          primaryPrefix, primarySquaresPrefix, referenceDoubledPrefix, referenceDoubledSquaresPrefix,
          crossSums, lag, shift }) ?? 0);
      nullStatistics.push(replication);
      const maximum = replication.reduce((value, statistic) => Math.max(value, statistic), 0);
      for (const lag of familyLags) {
        const statistic = observed.get(lag);
        if (statistic !== null && statistic !== undefined && maximum >= statistic) {
          exceedances.set(lag, (exceedances.get(lag) ?? 0) + 1);
        }
      }
    }
  }
  const nominalAlpha = 1 - input.confidenceLevel;
  const effectiveMultiplicity = estimateEffectiveMultiplicity({
    nullStatistics, nominalTests: familyLags.length, nominalAlpha,
  });
  const byLag = Object.fromEntries(positiveLags.map((lag) => {
    const observedStatistic = observed.get(lag) ?? null;
    const available = familyLags.includes(lag) && shifts.length > 0;
    const familyWisePValue = available ? (1 + (exceedances.get(lag) ?? 0)) / (EMPIRICAL_NULL_ITERATIONS + 1) : null;
    return [String(lag), {
      status: available ? "available" as const : "insufficient_sample" as const,
      observedStatistic,
      familyWisePValue,
      passes: familyWisePValue !== null && familyWisePValue <= nominalAlpha,
    }];
  }));
  const evidenceHash = sha256(input.evidence);
  const contract = {
    methodologyVersion: input.methodology,
    iterations: EMPIRICAL_NULL_ITERATIONS,
    seed: EMPIRICAL_NULL_SEED,
    shiftPolicy: "uniform_circular_shift_of_reference_returns_outside_scanned_lag_family",
    excludedShiftRadiusBars: Math.max(...positiveLags),
    eligibleCircularShifts: shifts.length,
    familyStatistic: "maximum_absolute_fisher_z_statistic_across_positive_evaluable_lags",
    familyEligibleLags: familyLags,
    nominalAlpha,
    // The estimator identity, not its value. Which method produced the number has to be recoverable
    // from the calibration it travelled with; the number itself is an output and would make the
    // identity of the calibration depend on the data it was run on.
    effectiveMultiplicityEstimator: effectiveMultiplicity.preRegisteredEstimator,
    effectiveMultiplicityMethodology: effectiveMultiplicity.methodologyVersion,
    evidenceHash,
    definition: input.definition,
  };
  return {
    schemaVersion: "1.0",
    methodologyVersion: input.methodology,
    status: familyLags.length > 0 && shifts.length > 0 ? "complete" : "not_evaluable",
    iterations: EMPIRICAL_NULL_ITERATIONS,
    seed: EMPIRICAL_NULL_SEED,
    shiftPolicy: "uniform_circular_shift_of_reference_returns_outside_scanned_lag_family",
    excludedShiftRadiusBars: Math.max(...positiveLags),
    eligibleCircularShifts: shifts.length,
    familyStatistic: "maximum_absolute_fisher_z_statistic_across_positive_evaluable_lags",
    familyEligibleLags: familyLags.length,
    nominalAlpha,
    effectiveMultiplicity,
    evidenceHash,
    calibrationId: sha256(contract),
    byLag,
    limitations: [
      "The reference return sequence is circularly shifted as a whole, preserving each series' return order, autocorrelation, exact timestamp gaps, and the original contemporaneous dependence only before the shift.",
      "Shifts inside the scanned lag family are excluded so a null draw cannot retain a tested lead alignment by construction.",
      "This calibrates the scanned correlation family on this evidence window; it does not establish causality, execution quality, profitability, or out-of-sample validity.",
    ],
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

  const alignmentPolicy = input.alignmentPolicy ?? "exact_utc_timestamp_no_forward_fill";
  if (!(alignmentPolicy === "exact_utc_timestamp_no_forward_fill" ||
    alignmentPolicy === "utc_grid_resampled_from_closed_60m_bars")) {
    throw new Error("unsupported lead/lag alignment policy");
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
  const rawReturnTimes = aligned.slice(1).map((item) => item.primary);
  const rawPrimaryReturns = aligned.slice(1).map((item, index) =>
    Math.log(item.primary.close / aligned[index].primary.close));
  const rawReferenceReturns = aligned.slice(1).map((item, index) =>
    Math.log(item.reference.close / aligned[index].reference.close));
  const returnStandardization = input.returnStandardization ?? "none";
  if (!(returnStandardization === "none" || returnStandardization === "causal_prior_20_rms")) {
    throw new Error("unsupported lead/lag return standardization");
  }
  const standardized = returnStandardization === "causal_prior_20_rms"
    ? causalPriorRmsStandardizePair({ primaryReturns: rawPrimaryReturns, referenceReturns: rawReferenceReturns })
    : {
        primaryReturns: rawPrimaryReturns,
        referenceReturns: rawReferenceReturns,
        warmupReturnsExcluded: 0,
        windowBars: null,
      };
  const primaryReturns = standardized.primaryReturns;
  const referenceReturns = standardized.referenceReturns;
  const returnTimes = rawReturnTimes.slice(standardized.warmupReturnsExcluded);
  const empiricalNullMethodology = returnStandardization === "causal_prior_20_rms"
    ? EMPIRICAL_NULL_METHODOLOGY_STANDARDIZED
    : EMPIRICAL_NULL_METHODOLOGY_RAW;

  const foldOf = (timeMs: number) =>
    folds.find((fold) => timeMs >= fold.fromMs && timeMs < fold.toMs)?.foldId ?? null;

  const lags = Array.from({ length: input.maxLagBars * 2 + 1 }, (_, index) => index - input.maxLagBars);
  const familyTests = lags.length * input.configurationTrials;
  const nominalAlpha = 1 - input.confidenceLevel;
  const bonferroniAdjustedAlpha = nominalAlpha / familyTests;
  const empiricalNullCalibration = input.empiricalNullCalibration === true ? buildEmpiricalNullCalibration({
    primaryReturns,
    referenceReturns,
    lags,
    minimumObservations: input.minimumObservations,
    confidenceLevel: input.confidenceLevel,
    evidence: aligned.map((item) => ({ time: item.primary.time, primaryClose: item.primary.close, referenceClose: item.reference.close })),
    definition: { maxLagBars: input.maxLagBars, minimumObservations: input.minimumObservations,
      confidenceLevel: input.confidenceLevel, configurationTrials: input.configurationTrials, folds: input.folds,
      returnStandardization },
    methodology: empiricalNullMethodology,
  }) : undefined;
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

    const pValue = evaluable ? fisherTwoSidedPValue(correlation, observations) : null;
    const passesBonferroni = lagBars > 0 && pValue !== null && pValue <= bonferroniAdjustedAlpha;
    const empirical = lagBars > 0 ? empiricalNullCalibration?.byLag[String(lagBars)] : undefined;
    const statisticalGateBlockers = [
      ...(lagBars <= 0 ? ["not_a_positive_reference_lead"] : []),
      ...(!passesBonferroni ? ["bonferroni_threshold_not_met"] : []),
      ...(folds.length < 2 ? ["at_least_two_preregistered_folds_required"] : []),
      ...(folds.length >= 2 && !(evaluableFolds.length >= 2 && sameSignFolds === evaluableFolds.length)
        ? ["fold_sign_stability_not_met"] : []),
      ...(empiricalNullCalibration === undefined ? ["empirical_null_calibration_required"] : []),
      ...(empiricalNullCalibration !== undefined && empiricalNullCalibration.status !== "complete"
        ? ["empirical_null_calibration_not_evaluable"] : []),
      ...(empiricalNullCalibration?.status === "complete" && empirical?.passes !== true
        ? ["empirical_null_family_wise_threshold_not_met"] : []),
    ];
    const statisticalGateEligible = statisticalGateBlockers.length === 0;
    const candidateBlockers = [
      ...statisticalGateBlockers,
      "candidate_rule_not_calibrated_for_shared_clustered_volatility",
    ];
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
      inference: {
        fisherTwoSidedPValue: pValue,
        bonferroniAdjustedPValue: pValue === null ? null : Math.min(1, pValue * familyTests),
        familyTests,
        nominalAlpha,
        bonferroniAdjustedAlpha,
        passesBonferroni,
        ...(empirical === undefined ? {} : { empiricalNull: empirical }),
        statisticalGateEligible,
        candidateEligible: false,
        candidateBlockers,
      },
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
    ...(returnStandardization === "causal_prior_20_rms" && rawPrimaryReturns.length <= LEAD_LAG_CAUSAL_VOLATILITY_WINDOW_BARS
      ? ["insufficient_history_for_causal_volatility_standardization"] : []),
    ...(irregularIntervals > 0 ? ["one_or_more_non_contiguous_bar_intervals"] : []),
    ...(evaluableLags < lagsInspected ? ["one_or_more_lags_not_evaluable"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
  ];

  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: returnStandardization === "causal_prior_20_rms"
      ? "lead_lag_relationships_v3_causal_prior_20_rms" as const
      : "exact_timestamp_lead_lag_return_correlation_v1" as const,
    alignmentPolicy,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    primarySymbol: input.primarySymbol,
    referenceSymbol: input.referenceSymbol,
    timeframe: input.timeframe,
    definition: {
      maxLagBars: input.maxLagBars,
      minimumObservations: input.minimumObservations,
      alignmentPolicy,
      returnBasis: "log_close_to_close_on_consecutive_aligned_bars" as const,
      returnStandardization: returnStandardization === "causal_prior_20_rms"
        ? {
            method: "causal_prior_rms" as const,
            windowBars: LEAD_LAG_CAUSAL_VOLATILITY_WINDOW_BARS,
            currentReturnExcludedFromScale: true,
            centering: "none" as const,
          }
        : { method: "none" as const },
      lagConvention: "positive_lag_pairs_an_earlier_reference_return_with_a_later_primary_return" as const,
      empiricalNullCalibration: input.empiricalNullCalibration === true,
    },
    sample: {
      primaryClosedBars: primary.length,
      referenceClosedBars: reference.size,
      alignedBars: aligned.length,
      rawReturnObservations: rawPrimaryReturns.length,
      returnObservations: primaryReturns.length,
      standardizationWarmupReturnsExcluded: standardized.warmupReturnsExcluded,
    },
    quality: { formingBarsExcluded, irregularIntervals },
    qualityIssues,
    inferenceContract: {
      confidenceLevel: input.confidenceLevel,
      intervalMethod: "fisher_z" as const,
      lagsInspected,
      evaluableLags,
      configurationTrials: input.configurationTrials,
      serialDependenceAdjustment: returnStandardization === "causal_prior_20_rms"
        ? "causal_prior_20_rms_volatility_standardization_only" as const
        : "none" as const,
      multipleTestingAdjustment: "bonferroni_family_wise_error_rate" as const,
      empiricalNullMethodology,
      candidateEligibility: "disabled_until_shared_clustered_volatility_false_positive_rate_is_calibrated" as const,
      familyTests,
      nominalAlpha,
      bonferroniAdjustedAlpha,
      automaticLagSelection: false,
      ranking: false,
    },
    inferenceWarnings: [
      "confidence_intervals_do_not_adjust_for_serial_dependence",
      ...(returnStandardization === "causal_prior_20_rms"
        ? ["returns_are_scaled_by_each_series_prior_20_return_rms_without_current_return"] : []),
      "bonferroni_adjustment_is_applied_to_lag_eligibility",
      "candidate_eligibility_requires_a_same-evidence empirical-null family-wise calibration",
      "candidate_eligibility_is_disabled_after_shared_clustered_volatility_exceeded_nominal_alpha",
      "every_scanned_lag_is_reported_and_no_best_lag_is_selected",
      ...(input.maxLagBars > 1 ? ["scanning_many_lags_inflates_the_chance_of_one_interval_excluding_zero"] : []),
    ],
    ...(empiricalNullCalibration === undefined ? {} : { empiricalNullCalibration }),
    byLag,
    limitations: [
      "This is a descriptive correlation scan, not an event study, a forecast, or a tradable signal.",
      "Correlation between contemporaneous or lagged returns does not establish a causal lead.",
      "Only positive lags describe the reference leading the primary; negative lags are not tradable on the primary.",
      returnStandardization === "causal_prior_20_rms"
        ? "Causal RMS scaling removes local variance level from the statistic but does not correct directional serial dependence; Fisher intervals can still be narrower than the effective sample supports."
        : "Single-bar returns do not overlap, but financial returns are still autocorrelated and volatility-clustered, and the Fisher interval assumes independent pairs, so it is narrower than the effective sample supports.",
      "Passing Bonferroni marks a lag as statistically eligible for a preregistered forward hypothesis; it is not out-of-sample evidence or a trading signal.",
    ],
  };
}
