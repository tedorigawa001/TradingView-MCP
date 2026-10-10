import { normalCdf, normalQuantile } from "./numerics.js";

/**
 * Deflated Sharpe ratio and minimum backtest length (BACKLOG 103-2; contract in docs/DEFLATED_SHARPE.md). A pure
 * computation over the numbers it is given.
 */
const EULER_GAMMA = 0.5772156649015329;
const MAX_LENGTH = 100_000;

export type DeflatedSharpeInput = {
  returns: number[];
  trial_sharpes?: number[];
  trial_count?: number;
  trial_sharpe_variance?: number;
  periods_per_year?: number;
  target_annual_sharpe?: number;
};

const LIMITATIONS = [
  "SR0 assumes the trials are independent; correlated trials have a smaller effective N, so SR0 and the minimum backtest length then overstate the bar. Pass an effective N when it is known.",
  "N must count every configuration tried, discarded ones included; an undercount inflates the deflated Sharpe ratio.",
  "The standard error assumes no serial correlation in the returns; autocorrelated returns can misstate the Sharpe ratio's precision (Lo 2002).",
  "A high deflated Sharpe ratio is not evidence of profitability after costs; it only says the selection is unlikely to be luck alone, given the stated N and V.",
];

/** (1 − γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)): the expected maximum of N standard normals (Bailey et al. 2014). */
export function expectedMaxStandardNormal(trialCount: number): number {
  if (!Number.isInteger(trialCount) || trialCount < 2) throw new Error("trial count must be an integer of at least 2");
  return (1 - EULER_GAMMA) * normalQuantile(1 - 1 / trialCount) + EULER_GAMMA * normalQuantile(1 - 1 / (trialCount * Math.E));
}

const finiteArray = (values: unknown, label: string, min: number) => {
  if (!Array.isArray(values) || values.length < min || values.length > MAX_LENGTH || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${label} must hold ${min} to ${MAX_LENGTH} finite numbers`);
  }
  return values as number[];
};

const meanOf = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function computeDeflatedSharpe(input: DeflatedSharpeInput) {
  const returns = finiteArray(input.returns, "returns", 2);
  const hasTrials = input.trial_sharpes !== undefined;
  const hasSummary = input.trial_count !== undefined || input.trial_sharpe_variance !== undefined;
  if (hasTrials === hasSummary) throw new Error("give either trial_sharpes, or trial_count with trial_sharpe_variance");
  if (hasSummary && (input.trial_count === undefined || input.trial_sharpe_variance === undefined)) {
    throw new Error("trial_count and trial_sharpe_variance must be given together");
  }
  if (input.periods_per_year !== undefined && !(Number.isFinite(input.periods_per_year) && input.periods_per_year > 0)) {
    throw new Error("periods_per_year must be a positive number");
  }
  const target = input.target_annual_sharpe ?? 1;
  if (!(Number.isFinite(target) && target > 0)) throw new Error("target_annual_sharpe must be a positive number");

  // Trials: from every trial's Sharpe ratio (sample variance, N − 1), or from the stated N and V.
  let trialCount: number; let trialVariance: number; let trialDetail: Record<string, unknown>;
  if (hasTrials) {
    const sharpes = finiteArray(input.trial_sharpes, "trial_sharpes", 2);
    const mean = meanOf(sharpes);
    trialCount = sharpes.length;
    trialVariance = sharpes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sharpes.length - 1);
    // reduce, not Math.max(...sharpes): 100,000 arguments can exceed the call stack.
    trialDetail = { mean_sharpe: mean, max_sharpe: sharpes.reduce((max, value) => Math.max(max, value), -Infinity) };
  } else {
    trialCount = input.trial_count!;
    trialVariance = input.trial_sharpe_variance!;
    if (!Number.isInteger(trialCount) || trialCount < 2 || trialCount > 1_000_000_000) throw new Error("trial_count must be an integer from 2 to 1,000,000,000");
    if (!(Number.isFinite(trialVariance) && trialVariance >= 0)) throw new Error("trial_sharpe_variance must be a non-negative number");
    trialDetail = {};
  }

  // Sample statistics in two passes: mean, then central moments.
  const n = returns.length;
  const mean = meanOf(returns);
  let m2 = 0; let m3 = 0; let m4 = 0;
  for (const value of returns) { const c = value - mean; const c2 = c * c; m2 += c2; m3 += c2 * c; m4 += c2 * c2; }
  const standardDeviation = Math.sqrt(m2 / (n - 1));
  m2 /= n; m3 /= n; m4 /= n;

  const maxZ = expectedMaxStandardNormal(trialCount);
  const minBacktestLength = {
    target_annual_sharpe: target,
    years: (maxZ / target) ** 2,
    upper_bound_years: (2 * Math.log(trialCount)) / (target * target),
    ...(input.periods_per_year !== undefined ? { periods: ((maxZ / target) ** 2) * input.periods_per_year } : {}),
  };
  const trials = { count: trialCount, sharpe_variance: trialVariance, source: hasTrials ? "trial_sharpes" : "summary", ...trialDetail };
  const base = { observations: n, mean, standard_deviation: standardDeviation, trials, min_backtest_length: minBacktestLength, limitations: LIMITATIONS };
  const notEvaluable = (reason: string) => ({ status: "not_evaluable" as const, reason, ...base });

  if (!(standardDeviation > 0)) return notEvaluable("returns have zero standard deviation");
  const sharpe = mean / standardDeviation;
  const skewness = m3 / m2 ** 1.5;
  const kurtosis = m4 / (m2 * m2);
  const varianceTerm = 1 - skewness * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe;
  if (!(varianceTerm > 0)) return notEvaluable("the Sharpe ratio's variance term 1 - skewness*SR + (kurtosis - 1)/4*SR^2 is not positive");
  const standardError = Math.sqrt(varianceTerm / (n - 1));
  const expectedMaxSharpe = Math.sqrt(trialVariance) * maxZ;
  const psrZero = normalCdf(sharpe / standardError);
  const deflatedSharpe = normalCdf((sharpe - expectedMaxSharpe) / standardError);
  const results = [sharpe, skewness, kurtosis, standardError, expectedMaxSharpe, psrZero, deflatedSharpe];
  if (results.some((value) => !Number.isFinite(value))) return notEvaluable("a result is not finite");

  const warnings: string[] = [];
  if (n < 30) warnings.push("short_sample");
  if (!hasTrials) warnings.push("trial_count_from_summary");
  let selectedMatchesATrial: boolean | undefined;
  if (hasTrials) {
    const tolerance = 1e-9 * Math.max(1, Math.abs(sharpe));
    selectedMatchesATrial = input.trial_sharpes!.some((value) => Math.abs(value - sharpe) <= tolerance);
    if (!selectedMatchesATrial) warnings.push("selected_not_among_trials");
    if (sharpe < (trialDetail.max_sharpe as number) - tolerance) warnings.push("selected_below_trial_max");
  }
  return {
    status: "evaluated" as const,
    ...base,
    trials: { ...trials, ...(selectedMatchesATrial !== undefined ? { selected_matches_a_trial: selectedMatchesATrial } : {}) },
    sharpe,
    ...(input.periods_per_year !== undefined ? { annualized_sharpe: sharpe * Math.sqrt(input.periods_per_year) } : {}),
    skewness,
    kurtosis,
    sharpe_standard_error: standardError,
    psr_zero: psrZero,
    expected_max_sharpe: expectedMaxSharpe,
    deflated_sharpe: deflatedSharpe,
    warnings,
  };
}
