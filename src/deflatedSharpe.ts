import { normalCdf, normalQuantile } from "./numerics.js";

/**
 * Deflated Sharpe ratio and minimum backtest length (BACKLOG 103-2; contract in docs/DEFLATED_SHARPE.md). A pure
 * computation over the numbers it is given.
 */
const EULER_GAMMA = 0.5772156649015329;
const MAX_LENGTH = 100_000;
const MAX_TRIALS = 1_000_000_000;
// Input ranges that keep every returned number finite (BACKLOG 103-2 review): wide enough for any real use.
export const DEFLATED_SHARPE_LIMITS = {
  maxAbsReturn: 1e300,
  maxAbsTrialSharpe: 1e6,
  maxTrialSharpeVariance: 1e12,
  maxPeriodsPerYear: 1e8,
  minTargetAnnualSharpe: 1e-4,
  maxTargetAnnualSharpe: 1e4,
} as const;

export type DeflatedSharpeInput = {
  returns: number[];
  trial_sharpes?: number[];
  effective_trial_count?: number;
  trial_count?: number;
  trial_sharpe_variance?: number;
  periods_per_year?: number;
  target_annual_sharpe?: number;
};

const LIMITATIONS = [
  "Every Sharpe ratio is per period of the returns, computed as mean divided by the standard deviation with T - 1 and no risk-free rate, over the same sample and length for every trial. Annualized Sharpe ratios must be divided by the square root of the periods per year, and an annualized variance by the periods per year. TradingView's sharpeRatio (computed against a 2% risk-free rate) is not compatible.",
  "SR0 assumes independent trials. With trial_sharpes, correlated or duplicated trials shrink the estimated variance and can inflate the deflated Sharpe ratio, while clusters of similar trials can deflate it: the direction is not guaranteed. Group similar configurations and pass the group-level count and variance, or an effective_trial_count.",
  "N must count every configuration tried, discarded ones included; an undercount inflates the deflated Sharpe ratio.",
  "The standard error assumes no serial correlation in the returns; autocorrelated returns can misstate the Sharpe ratio's precision (Lo 2002).",
  "A high deflated Sharpe ratio is not evidence of profitability after costs; it only says the selection is unlikely to be luck alone, given the stated N and variance.",
];

/**
 * (1 − γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)), the expected maximum of N standard normals (Bailey et al. 2014). The upper
 * quantiles are taken as −Φ⁻¹ of the small tail probability, so 1 − 1/N is never rounded first.
 */
export function expectedMaxStandardNormal(trialCount: number): number {
  if (!Number.isInteger(trialCount) || trialCount < 2) throw new Error("trial count must be an integer of at least 2");
  return -(1 - EULER_GAMMA) * normalQuantile(1 / trialCount) - EULER_GAMMA * normalQuantile(1 / (trialCount * Math.E));
}

const finiteArray = (values: unknown, label: string, min: number, maxAbsValue: number) => {
  if (!Array.isArray(values) || values.length < min || values.length > MAX_LENGTH
    || values.some((value) => typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maxAbsValue)) {
    throw new Error(`${label} must hold ${min} to ${MAX_LENGTH} finite numbers of magnitude at most ${maxAbsValue}`);
  }
  return values as number[];
};
const trialCountOf = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2 || value > MAX_TRIALS) throw new Error(`${label} must be an integer from 2 to 1,000,000,000`);
  return value;
};
/** A number that is finite: the range checks below rely on it, since null, "5" or false would compare as numbers. */
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const maxAbs = (values: number[]) => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const meanOf = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Throws if any number in a result is not finite: a guard, since the input ranges keep every result finite. */
function assertAllFinite(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`compute_deflated_sharpe produced a non-finite value at ${path}`);
  } else if (Array.isArray(value)) value.forEach((item, index) => assertAllFinite(item, `${path}[${index}]`));
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) assertAllFinite(item, `${path}.${key}`);
}

export function computeDeflatedSharpe(input: DeflatedSharpeInput) {
  const L = DEFLATED_SHARPE_LIMITS;
  const returns = finiteArray(input.returns, "returns", 2, L.maxAbsReturn);
  const hasTrials = input.trial_sharpes !== undefined;
  const hasSummary = input.trial_count !== undefined || input.trial_sharpe_variance !== undefined;
  if (hasTrials === hasSummary) throw new Error("give either trial_sharpes, or trial_count with trial_sharpe_variance");
  if (hasSummary && (input.trial_count === undefined || input.trial_sharpe_variance === undefined)) {
    throw new Error("trial_count and trial_sharpe_variance must be given together");
  }
  if (input.effective_trial_count !== undefined && !hasTrials) throw new Error("effective_trial_count goes with trial_sharpes; with a summary, give the effective count as trial_count");
  if (input.periods_per_year !== undefined && !(isFiniteNumber(input.periods_per_year) && input.periods_per_year > 0 && input.periods_per_year <= L.maxPeriodsPerYear)) {
    throw new Error(`periods_per_year must be a positive number of at most ${L.maxPeriodsPerYear}`);
  }
  // Only an omitted target takes the default; null is refused like any other non-number.
  const target = input.target_annual_sharpe === undefined ? 1 : input.target_annual_sharpe;
  if (!(isFiniteNumber(target) && target >= L.minTargetAnnualSharpe && target <= L.maxTargetAnnualSharpe)) {
    throw new Error(`target_annual_sharpe must be a positive number from ${L.minTargetAnnualSharpe} to ${L.maxTargetAnnualSharpe}`);
  }

  // Trials: from every trial's Sharpe ratio (sample variance, N − 1), or from the stated N and variance.
  let trialCount: number; let trialVariance: number; let trialSharpes: number[] | null = null;
  const trialDetail: Record<string, unknown> = {};
  if (hasTrials) {
    trialSharpes = finiteArray(input.trial_sharpes, "trial_sharpes", 2, L.maxAbsTrialSharpe);
    const mean = meanOf(trialSharpes);
    trialVariance = trialSharpes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (trialSharpes.length - 1);
    trialCount = input.effective_trial_count !== undefined ? trialCountOf(input.effective_trial_count, "effective_trial_count") : trialSharpes.length;
    // reduce, not Math.max(...): 100,000 arguments can exceed the call stack.
    Object.assign(trialDetail, { listed: trialSharpes.length, mean_sharpe: mean, max_sharpe: trialSharpes.reduce((max, value) => Math.max(max, value), -Infinity),
      duplicate_values: trialSharpes.length - new Set(trialSharpes).size });
  } else {
    trialCount = trialCountOf(input.trial_count, "trial_count");
    trialVariance = input.trial_sharpe_variance!;
    if (!(isFiniteNumber(trialVariance) && trialVariance >= 0 && trialVariance <= L.maxTrialSharpeVariance)) throw new Error(`trial_sharpe_variance must be a non-negative number of at most ${L.maxTrialSharpeVariance}`);
  }

  // Sample statistics in normalised units: the returns are first divided by their largest magnitude, and the deviations
  // again by theirs before the moments are formed. Every step then works on numbers near 1, so proportional inputs give
  // the same Sharpe ratio, skewness and kurtosis, subnormal ones included. The mean and standard deviation are reported
  // back in the input's unit; for subnormal inputs they may round towards zero there.
  const n = returns.length;
  const inputScale = maxAbs(returns);
  const normalised = inputScale > 0 ? returns.map((value) => value / inputScale) : returns.map(() => 0);
  const normalisedMean = meanOf(normalised);
  const deviations = normalised.map((value) => value - normalisedMean);
  const scale = maxAbs(deviations);
  let s2 = 0; let s3 = 0; let s4 = 0;
  if (scale > 0) for (const deviation of deviations) { const c = deviation / scale; const c2 = c * c; s2 += c2; s3 += c2 * c; s4 += c2 * c2; }
  const normalisedSd = scale * Math.sqrt(s2 / (n - 1));
  const mean = normalisedMean * inputScale;
  const standardDeviation = normalisedSd * inputScale;

  const maxZ = expectedMaxStandardNormal(trialCount);
  const minBacktestYears = (maxZ / target) ** 2;
  const minBacktestLength = {
    target_annual_sharpe: target,
    years: minBacktestYears,
    upper_bound_years: (2 * Math.log(trialCount)) / (target * target),
    ...(input.periods_per_year !== undefined ? { periods: minBacktestYears * input.periods_per_year } : {}),
  };
  const trials = { count: trialCount, sharpe_variance: trialVariance, source: hasTrials ? "trial_sharpes" : "summary",
    ...(input.effective_trial_count !== undefined ? { count_source: "effective_trial_count" } : {}), ...trialDetail };
  const base = { observations: n, mean, standard_deviation: standardDeviation, trials, min_backtest_length: minBacktestLength, limitations: LIMITATIONS };
  const notEvaluable = (reason: string) => {
    const result = { status: "not_evaluable" as const, reason, ...base };
    assertAllFinite(result, "result");
    return result;
  };

  if (!(scale > 0) || !(normalisedSd > 0)) return notEvaluable("returns have zero standard deviation");
  const sharpe = normalisedMean / normalisedSd;
  const m2 = s2 / n; const skewness = (s3 / n) / m2 ** 1.5; const kurtosis = (s4 / n) / (m2 * m2);
  // Always ≥ 0, since γ₄ ≥ γ₃² + 1 for any distribution; the check only guards against rounding.
  const varianceTerm = 1 - skewness * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe;
  if (!(varianceTerm > 0)) return notEvaluable("the Sharpe ratio's variance term 1 - skewness*SR + (kurtosis - 1)/4*SR^2 is not positive");
  const standardError = Math.sqrt(varianceTerm / (n - 1));
  const expectedMaxSharpe = Math.sqrt(trialVariance) * maxZ;
  const psrZero = normalCdf(sharpe / standardError);
  const deflatedSharpe = normalCdf((sharpe - expectedMaxSharpe) / standardError);
  const annualizedSharpe = input.periods_per_year !== undefined ? sharpe * Math.sqrt(input.periods_per_year) : undefined;
  if ([sharpe, skewness, kurtosis, standardError, expectedMaxSharpe, psrZero, deflatedSharpe].some((value) => !Number.isFinite(value))) {
    return notEvaluable("a result is not finite");
  }

  const warnings: string[] = [];
  if (n < 30) warnings.push("short_sample");
  if (!hasTrials) warnings.push("trial_count_from_summary");
  if (trialVariance === 0) warnings.push("zero_trial_variance");
  // The trials' variance against one Sharpe ratio's sampling variance: about 1 for independent unskilled trials of the
  // same length; far below suggests correlated or duplicated trials, far above suggests annualized or mixed units.
  const varianceRatio = trialVariance / (standardError * standardError);
  if (trialVariance > 0 && varianceRatio < 0.25) warnings.push("trial_variance_far_below_sampling");
  if (varianceRatio > 4) warnings.push("trial_variance_far_above_sampling");
  if (input.periods_per_year !== undefined && n / input.periods_per_year < minBacktestYears) warnings.push("backtest_shorter_than_min_length");
  let selection: Record<string, unknown> = {};
  if (trialSharpes) {
    // A trial matches the selected Sharpe ratio within a hundredth of its standard error, so rounding (to about eight
    // decimals) does not break the match. A trial computed with the population standard deviation differs by
    // SR·(sqrt(T/(T − 1)) − 1) and matches only when that is below the tolerance: long samples and modest Sharpe ratios.
    const tolerance = Math.max(1e-2 * standardError, 1e-9 * Math.max(1, Math.abs(sharpe)));
    const nearest = trialSharpes.reduce((best, value) => (Math.abs(value - sharpe) < Math.abs(best - sharpe) ? value : best), trialSharpes[0]);
    const matches = Math.abs(nearest - sharpe) <= tolerance;
    selection = { selected_matches_a_trial: matches, nearest_trial_sharpe: nearest, nearest_trial_distance: Math.abs(nearest - sharpe) };
    if (!matches) warnings.push("selected_not_among_trials");
    if (sharpe < (trialDetail.max_sharpe as number) - tolerance) warnings.push("selected_below_trial_max");
    if ((trialDetail.duplicate_values as number) > 0) warnings.push("duplicate_trial_sharpes");
    if (annualizedSharpe !== undefined && Math.abs(annualizedSharpe - sharpe) > tolerance
      && trialSharpes.some((value) => Math.abs(value - annualizedSharpe) <= tolerance * Math.sqrt(input.periods_per_year!))) {
      warnings.push("trial_sharpes_look_annualized");
    }
  }
  const result = {
    status: "evaluated" as const,
    ...base,
    trials: { ...trials, ...selection, variance_to_sampling_variance: varianceRatio },
    sharpe,
    ...(annualizedSharpe !== undefined ? { annualized_sharpe: annualizedSharpe } : {}),
    skewness,
    kurtosis,
    sharpe_standard_error: standardError,
    psr_zero: psrZero,
    expected_max_sharpe: expectedMaxSharpe,
    deflated_sharpe: deflatedSharpe,
    warnings,
  };
  assertAllFinite(result, "result");
  return result;
}
