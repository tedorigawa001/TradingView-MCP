import { fdlibmLog } from "./fdlibmLog.js";
import { blockBounds, isValidForecast } from "./forecastLossComparison.js";
import type { ForecastValue } from "./forecastSet.js";
import { averageRanks, erfc } from "./numerics.js";
import { createRandom } from "./seededRandom.js";

/**
 * backtest_risk_forecast (docs/RISK_FORECAST_BACKTEST_DESIGN.md rev 2.3; plan rev 2.1, section 6). VaR coverage tests
 * on one hit sequence and ex-post volatility-targeting metrics. Nothing here says a forecast is correct or better:
 * a test that does not reject says only that this hit sequence did not contradict the nominal rate.
 *
 * Determinism: every statistic is a function of integer counts through fdlibmLog, and the Monte Carlo draws come
 * from the seeded generator, so every count, p-value and result is the same on every CPU.
 */
export const RISK_BACKTEST_CONTRACT = "risk_forecast_backtest_v1" as const;
/** Correctly rounded standard normal quantiles (90-digit bisection on Φ; design D3). */
export const VAR_LEVELS = [
  { level: 0.01, z: -2.326347874040841 },
  { level: 0.05, z: -1.6448536269514726 },
] as const;
export const MONTE_CARLO_DRAWS = 9_999;
export const SEED_BASE = 20_261_001;
/** Below this many expected hits a non-rejection says almost nothing (design F9). */
export const UNDERPOWERED_EXPECTED_HITS = 10;

/** Always returned (design "Limitations"). */
export const RISK_BACKTEST_LIMITATIONS = [
  "var_from_forecast_variance_under_normal_quantile_zero_mean",
  "coverage_non_rejection_is_not_evidence_of_a_correct_risk_model",
  "hit_tests_use_one_hit_sequence_of_this_length",
  "one_realized_history_not_forward_evidence",
  "tests_reported_without_multiplicity_correction",
  "own_nulls_evaluated_both_as_hits_and_as_non_hits",
  "series_returns_combined_without_currency_conversion",
  "forecasts_and_their_timing_are_caller_supplied_and_unverified",
  "forecast_units_and_variance_vs_volatility_are_caller_asserted",
  "vol_targeting_is_ex_post_without_costs_or_execution",
  "leverage_uncapped",
  "position_pnl_on_return_missing_dates_omitted",
  "returns_rederived_from_imported_bars_not_source_authenticated",
  "search_counts_cover_this_journal_only",
  "expected_shortfall_not_assessed",
] as const;
/** With within_day rules a day's return leaves out its first bar and the gap before it, where tail losses concentrate. */
export const WITHIN_DAY_LIMITATION = "within_day_returns_exclude_first_interval_and_gaps";

export type LevelIndex = 0 | 1;
export type ForecastIndex = 0 | 1;
/** 0: own nulls count as hits; 1: as non-hits (design N1). */
export type NullCase = 0 | 1;

export const coverageSeed = (level: LevelIndex) => SEED_BASE + 1 + level;
export const independenceSeed = (forecast: ForecastIndex, level: LevelIndex, nullCase: NullCase) =>
  SEED_BASE + 10 * (forecast + 1) + 2 * level + nullCase + 1;

// ---------------------------------------------------------------------------------------------------------------
// Statistics

export interface TransitionCounts { n00: number; n01: number; n10: number; n11: number }

/**
 * Transitions between consecutive dates of one segment; a missing return ends a segment, so the pair across it is
 * not counted (design "Christoffersen independence").
 */
export function transitionCounts(hits: ArrayLike<number>, segments: readonly number[]): TransitionCounts {
  let n00 = 0, n01 = 0, n10 = 0, n11 = 0;
  let start = 0;
  for (const length of segments) {
    for (let t = start + 1; t < start + length; t++) {
      if (hits[t - 1]) { if (hits[t]) n11++; else n10++; } else if (hits[t]) n01++; else n00++;
    }
    start += length;
  }
  return { n00, n01, n10, n11 };
}

/** 1 where date t + 1 is in the same segment as t, so the pair (t, t + 1) is a transition. */
function continuesTo(T: number, segments: readonly number[]): Uint8Array {
  const next = new Uint8Array(T);
  let start = 0;
  for (const length of segments) {
    for (let t = start; t < start + length - 1; t++) next[t] = 1;
    start += length;
  }
  return next;
}

/**
 * The same counts as transitionCounts, from the hit positions alone (plan step 2 allows it because the counts, and so
 * the statistic, are identical): every transition touching a hit is counted from that hit, and the rest are 0 → 0.
 */
function transitionCountsFromPositions(positions: ArrayLike<number>, x: number, hits: Uint8Array, next: Uint8Array, transitions: number): TransitionCounts {
  let n01 = 0, n10 = 0, n11 = 0;
  for (let i = 0; i < x; i++) {
    const t = positions[i];
    if (next[t]) { if (hits[t + 1]) n11++; else n10++; }
    if (t > 0 && next[t - 1] && !hits[t - 1]) n01++;
  }
  return { n00: transitions - n01 - n10 - n11, n01, n10, n11 };
}

/** LR_uc = 2·[x·ln(π̂/α) + (T − x)·ln((1 − π̂)/(1 − α))], a term with a zero count being 0; clamped at 0. */
export function kupiecStatistic(x: number, T: number, alpha: number): number {
  let sum = 0;
  if (x > 0) sum += x * fdlibmLog((x / T) / alpha);
  if (T - x > 0) sum += (T - x) * fdlibmLog(((T - x) / T) / (1 - alpha));
  return Math.max(0, 2 * sum);
}

/**
 * LR_ind = 2·Σ n_ij·ln((n_ij·N)/(m_i·c_j)) over the cells with n_ij > 0 (design F7). Numerator and denominator are
 * exact integer products, so equal conditional and marginal rates give a ratio of exactly 1 and a term of exactly 0.
 */
export function independenceStatistic({ n00, n01, n10, n11 }: TransitionCounts): number {
  const N = n00 + n01 + n10 + n11;
  const m0 = n00 + n01, m1 = n10 + n11, c0 = n00 + n10, c1 = n01 + n11;
  const term = (n: number, m: number, c: number) => (n > 0 ? n * fdlibmLog((n * N) / (m * c)) : 0);
  return Math.max(0, 2 * (term(n00, m0, c0) + term(n01, m0, c1) + term(n10, m1, c0) + term(n11, m1, c1)));
}

/** χ² survival for 1 or 2 degrees of freedom. Reported beside the Monte Carlo p-values; it never decides a result. */
export const chiSquareSurvival = (statistic: number, df: 1 | 2) =>
  (df === 1 ? erfc(Math.sqrt(statistic / 2)) : Math.exp(-statistic / 2));

// ---------------------------------------------------------------------------------------------------------------
// Monte Carlo

/** The first index whose value is at least `target`, in an ascending array. */
function lowerBound(sorted: Float64Array, target: number): number {
  let low = 0, high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * p = (1 + #{draw ≥ observed})/(N + 1). The rejection rule p ≤ 0.05 is decided in integers, 20·(1 + #) ≤ N + 1, so
 * no rounding of p can move it.
 */
export function monteCarloP(observed: number, sortedDraws: Float64Array): { p: number; rejects: boolean } {
  const atLeast = sortedDraws.length - lowerBound(sortedDraws, observed);
  return { p: (1 + atLeast) / (sortedDraws.length + 1), rejects: 20 * (1 + atLeast) <= sortedDraws.length + 1 };
}

export interface CoverageNull {
  level: LevelIndex;
  T: number;
  /** Simulated statistics under independent Bernoulli(α) hits, sorted ascending. */
  kupiec: Float64Array;
  conditional: Float64Array;
  /** The hit counts whose Monte Carlo p for LR_uc exceeds 0.05: an interval, since LR_uc is convex in x. */
  region: [number, number] | null;
}

/**
 * The coverage null (design D6): N hit sequences over the same T dates and segments, a hit when u < α. Draws are
 * sequence-major. One stream per level serves LR_uc and LR_cc for both forecasts and both own-null cases.
 */
export function coverageNull(level: LevelIndex, T: number, segments: readonly number[], draws = MONTE_CARLO_DRAWS): CoverageNull {
  const alpha = VAR_LEVELS[level].level;
  const random = createRandom(coverageSeed(level));
  const kupiec = new Float64Array(draws), conditional = new Float64Array(draws);
  const next = continuesTo(T, segments);
  for (let d = 0; d < draws; d++) {
    // Transitions are counted while drawing, with numeric counters: the same counts as transitionCounts.
    let x = 0, n00 = 0, n01 = 0, n10 = 0, n11 = 0, previous = 0;
    for (let t = 0; t < T; t++) {
      const hit = random() < alpha ? 1 : 0;
      x += hit;
      if (t > 0 && next[t - 1]) { if (previous) { if (hit) n11++; else n10++; } else if (hit) n01++; else n00++; }
      previous = hit;
    }
    kupiec[d] = kupiecStatistic(x, T, alpha);
    conditional[d] = kupiec[d] + independenceStatistic({ n00, n01, n10, n11 });
  }
  kupiec.sort();
  conditional.sort();
  let low = -1, high = -1;
  for (let k = 0; k <= T; k++) {
    if (!monteCarloP(kupiecStatistic(k, T, alpha), kupiec).rejects) {
      if (low < 0) low = k;
      high = k;
    }
  }
  return { level, T, kupiec, conditional, region: low < 0 ? null : [low, high] };
}

/**
 * The independence null (design F2): each draw places the observed x hits at x uniformly chosen dates among the T,
 * by a partial Fisher–Yates shuffle (position i takes index i + ⌊u·(T − i)⌋), keeping the segments. The index array
 * is 0, …, T − 1 at the start of every draw: the swaps are undone in reverse order, which restores it exactly.
 */
export function independenceNull(T: number, segments: readonly number[], x: number, seed: number, draws = MONTE_CARLO_DRAWS): Float64Array {
  const random = createRandom(seed);
  const index = new Int32Array(T);
  for (let t = 0; t < T; t++) index[t] = t;
  const swapped = new Int32Array(x);
  const hits = new Uint8Array(T);
  const next = continuesTo(T, segments);
  const transitions = T - segments.length;
  const statistics = new Float64Array(draws);
  for (let d = 0; d < draws; d++) {
    for (let i = 0; i < x; i++) {
      const j = i + Math.floor(random() * (T - i));
      swapped[i] = j;
      const held = index[i]; index[i] = index[j]; index[j] = held;
      hits[index[i]] = 1;
    }
    statistics[d] = independenceStatistic(transitionCountsFromPositions(index, x, hits, next, transitions));
    for (let i = x - 1; i >= 0; i--) {
      hits[index[i]] = 0;
      const j = swapped[i];
      const held = index[i]; index[i] = index[j]; index[j] = held;
    }
  }
  return statistics.sort();
}

// ---------------------------------------------------------------------------------------------------------------
// One forecast at one level, in both own-null cases

export type TestResult = "rejected" | "not_rejected" | "not_rejected_underpowered" | "indeterminate_due_to_own_nulls";
export type Direction = "too_many" | "too_few" | "as_expected";

export interface CaseValues { statistic: number; p_asymptotic: number; p_monte_carlo: number }
interface CaseRun { values: CaseValues; rejects: boolean }

export const directionOf = (x: number, alpha: number, T: number): Direction =>
  (x > alpha * T ? "too_many" : x < alpha * T ? "too_few" : "as_expected");

export interface LevelInput {
  forecast: ForecastIndex;
  level: LevelIndex;
  T: number;
  segments: readonly number[];
  /** 1 where the forecast is valid and r_p,t < z_α·σ̂_t, else 0. */
  hits: Uint8Array;
  /** 1 on own-null dates. A date is never both a hit and an own null. */
  ownNull: Uint8Array;
  coverage: CoverageNull;
  draws?: number;
}

/**
 * Every test in both own-null cases, combined into one result (design N1, P1):
 * - rejected only if both cases reject, not_rejected (or _underpowered when αT < 10) only if neither does, otherwise
 *   indeterminate_due_to_own_nulls;
 * - LR_uc depends only on x, so it is decided against the region: rejected only if [x₀, x₀ + m] does not overlap it,
 *   not rejected only if it lies inside;
 * - LR_cc is indeterminate when both cases reject with opposite directions (design rev 2.4, code review C1).
 */
export function evaluateLevel(input: LevelInput) {
  const { forecast, level, T, segments, hits, ownNull, coverage } = input;
  const draws = input.draws ?? MONTE_CARLO_DRAWS;
  const alpha = VAR_LEVELS[level].level;
  const asHits = Uint8Array.from(hits, (hit, t) => hit | ownNull[t]);
  const sum = (values: Uint8Array) => values.reduce((total, value) => total + value, 0);
  const xNon = sum(hits), m = sum(ownNull), xHits = xNon + m;
  const sequences = [asHits, hits] as const;
  const xs = [xHits, xNon] as const;
  const transitions = sequences.map((sequence) => transitionCounts(sequence, segments));
  // With no own nulls the two cases coincide, and the as-non-hits independence stream is not drawn.
  const independenceDraws = [independenceNull(T, segments, xHits, independenceSeed(forecast, level, 0), draws)];
  independenceDraws.push(m === 0 ? independenceDraws[0] : independenceNull(T, segments, xNon, independenceSeed(forecast, level, 1), draws));

  const run = (statistic: number, df: 1 | 2, nullDraws: Float64Array): CaseRun => {
    const { p, rejects } = monteCarloP(statistic, nullDraws);
    return { values: { statistic, p_asymptotic: chiSquareSurvival(statistic, df), p_monte_carlo: p }, rejects };
  };
  const kupiec = xs.map((x) => run(kupiecStatistic(x, T, alpha), 1, coverage.kupiec));
  const independence = transitions.map((counts, c) => run(independenceStatistic(counts), 1, independenceDraws[c]));
  const conditional = [0, 1].map((c) => run(kupiec[c].values.statistic + independence[c].values.statistic, 2, coverage.conditional));
  const direction = xs.map((x) => directionOf(x, alpha, T));

  const underpowered = alpha * T < UNDERPOWERED_EXPECTED_HITS;
  const notRejected: TestResult = underpowered ? "not_rejected_underpowered" : "not_rejected";
  const combine = ([a, b]: CaseRun[]): TestResult =>
    (a.rejects && b.rejects ? "rejected" : !a.rejects && !b.rejects ? notRejected : "indeterminate_due_to_own_nulls");
  const region = coverage.region;
  const kupiecResult: TestResult = region === null ? combine(kupiec)
    : xHits < region[0] || xNon > region[1] ? "rejected"
      : xNon >= region[0] && xHits <= region[1] ? notRejected : "indeterminate_due_to_own_nulls";
  const opposite = (direction[0] === "too_many" && direction[1] === "too_few") || (direction[0] === "too_few" && direction[1] === "too_many");
  // Only when both cases reject (code review C1): with opposite directions some placement of the nulls in between
  // could avoid the rejection. When neither rejects, LR_uc in between is at most the larger of the two, by convexity.
  const conditionalResult: TestResult = opposite && conditional[0].rejects && conditional[1].rejects
    ? "indeterminate_due_to_own_nulls" : combine(conditional);
  const cases = (runs: CaseRun[]) => ({ as_hits: runs[0].values, as_non_hits: runs[1].values });

  return {
    level: alpha,
    T,
    hits: { without_own_nulls: xNon, with_own_nulls: xHits },
    expected: alpha * T,
    expected_hits_below_10: underpowered,
    direction: { as_hits: direction[0], as_non_hits: direction[1] },
    kupiec: { result: kupiecResult, ...cases(kupiec) },
    independence: {
      result: combine(independence), ...cases(independence),
      independence_uninformative: {
        as_hits: transitions[0].n10 + transitions[0].n11 < 2,
        as_non_hits: transitions[1].n10 + transitions[1].n11 < 2,
      },
    },
    conditional_coverage: { result: conditionalResult, ...cases(conditional) },
    kupiec_non_rejection_region: region,
  };
}
export type VarEntry = ReturnType<typeof evaluateLevel>;

/** The number of tests a response reports: 3 per level per evaluated forecast. */
export const testsReported = (evaluatedForecasts: number) => evaluatedForecasts * VAR_LEVELS.length * 3;

// ---------------------------------------------------------------------------------------------------------------
// Days, weights and volatility targeting (design "Days", "Volatility targeting"; plan step 3)

export const MAX_MISSING_RETURN_SHARE_TENTHS = 1;   // 10·missing > run dates is not evaluable
export const MIN_RETURN_DATES = 250;
export const REGIME_SHORT = 5;
export const REGIME_LONG = 60;
export const WORST_DAYS = 10;
export const SCALE_CHECK_BOUNDS = [0.1, 10] as const;
export const SCALE_FLAG = "forecast_scale_differs_from_proxy_by_over_10x";

export class RiskBacktestError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "RiskBacktestError";
  }
}

/** Divided by max|wᵢ|, then by Σ|wᵢ|, so huge or tiny values cannot overflow or vanish (design F12). */
export function normalizeWeights(raw: readonly number[], n: number): number[] {
  if (raw.length !== n || !raw.every(Number.isFinite) || raw.every((w) => w === 0)) {
    throw new RiskBacktestError("weights_invalid", `${n} finite weights, not all zero, are required`);
  }
  const largest = raw.reduce((max, w) => Math.max(max, Math.abs(w)), 0);
  const scaled = raw.map((w) => w / largest);
  const gross = scaled.reduce((sum, w) => sum + Math.abs(w), 0);
  return scaled.map((w) => w / gross);
}

/** w'Sw summed row-major over the stored value as it is, (wᵢ·Sᵢⱼ)·wⱼ; a scalar for n = 1. */
export function quadraticForm(w: readonly number[], value: number | number[][]): number {
  if (typeof value === "number") return w[0] * value * w[0];
  let sum = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) sum += w[i] * value[i][j] * w[j];
  return sum;
}

/** The middle value, or the mean of the two middle values for an even count. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const nearestRank = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
};
const mean = (values: readonly number[]) => values.reduce((sum, x) => sum + x, 0) / values.length;

export interface BacktestInput {
  /** The forecast set's run: every date, with the proxy set's drop cause (null when kept). */
  dates: readonly string[];
  dropCause: readonly (string | null)[];
  /** The re-derived return vectors, null on dropped dates. */
  returns: readonly (readonly number[] | null)[];
  /** The primary proxy (realized covariance), null on dropped dates. */
  rc: readonly ForecastValue[];
  forecasts: readonly [readonly ForecastValue[], readonly ForecastValue[]];
  /** Normalized by normalizeWeights. */
  weights: readonly number[];
  targetValue: number;
  returnUnit: "log" | "log_percent";
  /** |day_weekdays| of the proxy set's rules. */
  weekdays: number;
  draws?: number;
}

/**
 * The whole evaluation over a run. Missing returns and own forecast nulls have separate budgets (design F4): more than
 * 10% missing or fewer than 250 return dates is not evaluable; more than ⌈T/100⌉ own nulls blocks that forecast only.
 */
export function backtestRiskForecast(input: BacktestInput) {
  const { dates, returns, weights, targetValue } = input;
  const runDates = dates.length;
  const index: number[] = [];
  returns.forEach((value, d) => { if (value !== null) index.push(d); });
  const T = index.length;
  const missing = runDates - T;
  const byCause: Record<string, number> = {};
  input.dropCause.forEach((cause, d) => { if (returns[d] === null) byCause[cause ?? "unknown"] = (byCause[cause ?? "unknown"] ?? 0) + 1; });
  const segments: number[] = [];
  index.forEach((d, k) => { if (k === 0 || d !== index[k - 1] + 1) segments.push(1); else segments[segments.length - 1]++; });
  const reason = 10 * missing > MAX_MISSING_RETURN_SHARE_TENTHS * runDates ? "more_than_10_percent_of_returns_missing"
    : T < MIN_RETURN_DATES ? "fewer_than_250_return_days" : null;
  const days = {
    run_dates: runDates, missing_returns: { total: missing, by_cause: byCause }, return_dates: T,
    chain_breaks: Math.max(0, segments.length - 1), outcome: reason === null ? "evaluated" as const : "not_evaluable" as const,
    ...(reason === null ? {} : { reason }),
  };

  // Per return date: the portfolio return, the unlevered realized variance, and each forecast's σ̂² (NaN on own nulls).
  // The proxy is PSD (a sum of rr'), so w'RC w below 0 is rounding, as on a hedged portfolio, and counts as 0.
  const portfolio = index.map((d) => (returns[d] as readonly number[]).reduce((sum, r, i) => sum + weights[i] * r, 0));
  const realized = index.map((d) => Math.max(0, quadraticForm(weights, input.rc[d] as number | number[][])));
  const variances = input.forecasts.map((values) => index.map((d) => {
    const value = values[d];
    if (!isValidForecast(value)) return Number.NaN;
    const v = quadraticForm(weights, value as number | number[][]);
    return Number.isFinite(v) && v > 0 ? v : Number.NaN;
  }));
  const scaleOf = (variance: number[]) => {
    const ratios = variance.flatMap((v, k) => (Number.isNaN(v) || !(realized[k] > 0) ? [] : [v / realized[k]]));
    return ratios.length ? { median_ratio: median(ratios), dates: ratios.length } : null;
  };
  const scales = variances.map(scaleOf);
  const scale_check = {
    a: scales[0], b: scales[1],
    flags: scales.flatMap((scale, f) => (scale && (scale.median_ratio < SCALE_CHECK_BOUNDS[0] || scale.median_ratio > SCALE_CHECK_BOUNDS[1])
      ? [{ forecast: f === 0 ? "a" : "b", flag: SCALE_FLAG }] : [])),
  };
  if (reason !== null) return { days, scale_check, forecasts: null, tests_reported: 0 };

  const draws = input.draws ?? MONTE_CARLO_DRAWS;
  const nulls = ([0, 1] as const).map((level) => coverageNull(level, T, segments, draws));
  const cap = Math.floor((T + 99) / 100);
  const rootPeriods = Math.sqrt(52 * input.weekdays);
  const scale = input.returnUnit === "log_percent" ? 100 : 1;
  const simpleReturns = index.map((d) => (returns[d] as readonly number[]).reduce((sum, r, i) => sum + weights[i] * (Math.exp(r / scale) - 1), 0));
  const regime = regimeGroups(realized);
  let evaluated = 0;

  const forecasts = ([0, 1] as const).map((f) => {
    const variance = variances[f];
    const ownNull = Uint8Array.from(variance, (v) => (Number.isNaN(v) ? 1 : 0));
    const m = ownNull.reduce((sum, x) => sum + x, 0);
    if (m > cap) return { status: "blocked_by_forecast_nulls" as const, own_nulls: m, cap };
    evaluated++;
    const sigma = variance.map((v) => Math.sqrt(v));
    const varEntries = ([0, 1] as const).map((level) => {
      const z = VAR_LEVELS[level].z;
      const hits = Uint8Array.from(portfolio, (r, k) => (!ownNull[k] && r < z * sigma[k] ? 1 : 0));
      return evaluateLevel({ forecast: f, level, T, segments, hits, ownNull, coverage: nulls[level], draws });
    });
    // Leverage L = value·(u/√P) with the unit leverage u = 1/σ̂: on an own-null date that of the most recent return date
    // with a valid forecast; flat (0) before the first. u is finite and positive for every valid σ̂², and holds no target.
    const unit: number[] = [];
    let carried = 0, seenValid = false, carriedOwnNulls = 0;
    for (let k = 0; k < T; k++) {
      if (!ownNull[k]) { carried = 1 / sigma[k]; seenValid = true; } else if (seenValid) carriedOwnNulls++;
      unit.push(seenValid ? carried : 0);
    }
    const hitSets = varEntries.map((_, level) => Uint8Array.from(portfolio, (r, k) => (!ownNull[k] && r < VAR_LEVELS[level].z * sigma[k] ? 1 : 0)));
    const subset = (ks: number[]) => volatilityTargetSubset(ks, { portfolio, realized, unit, targetValue, rootPeriods, ownNull, hitSets });
    return {
      status: "evaluated" as const,
      own_nulls: m,
      own_null_dates_with_carried_leverage: carriedOwnNulls,
      var: varEntries,
      vol_target: volatilityTarget({ dates: index.map((d) => dates[d]), portfolio, realized, unit, targetValue, rootPeriods, ownNull,
        hitSets, simpleReturns, regime, subset }),
    };
  });
  return { days, scale_check, forecasts: { a: forecasts[0], b: forecasts[1] }, tests_reported: testsReported(evaluated) };
}

/**
 * The regime view's groups (design F3): g_t = mean of w'RC w over the 5 earlier return dates / over the 60 earlier
 * return dates, known before t. Dates without 60 earlier return dates, or with a zero 60-date mean, are excluded. The
 * rest are sorted by (g_t, date) and split by index into falling, steady and rising.
 */
export function regimeGroups(realized: readonly number[]) {
  const included: { k: number; g: number }[] = [];
  for (let k = REGIME_LONG; k < realized.length; k++) {
    let short = 0, long = 0;
    for (let j = k - REGIME_SHORT; j < k; j++) short += realized[j];
    for (let j = k - REGIME_LONG; j < k; j++) long += realized[j];
    if (long === 0) continue;
    included.push({ k, g: (short / REGIME_SHORT) / (long / REGIME_LONG) });
  }
  included.sort((x, y) => x.g - y.g || x.k - y.k);
  const n = included.length;
  const slice = (g: number) => included.slice(Math.floor((g * n) / 3), Math.floor(((g + 1) * n) / 3)).map((e) => e.k).sort((x, y) => x - y);
  return { excluded: realized.length - n, groups: { falling: slice(0), steady: slice(1), rising: slice(2) } };
}

interface SubsetInput {
  portfolio: readonly number[]; realized: readonly number[];
  /**
   * The unit leverage 1/σ̂ per return date, the target and √P: the leverage is value·(u/√P), with the target last so
   * that a tiny one cannot underflow σ* = value/√P first.
   */
  unit: readonly number[]; targetValue: number; rootPeriods: number;
  ownNull: Uint8Array; hitSets: readonly Uint8Array[];
}

/** √(mean of xₖ²), scaled by max|xₖ| so that no square overflows; NaN for no values, like the mean. */
function rootMeanSquare(values: readonly number[]): number {
  const largest = values.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
  if (largest === 0) return values.length ? 0 : Number.NaN;
  return largest * Math.sqrt(mean(values.map((x) => (x / largest) ** 2)));
}

/**
 * Realized-to-target ratios, mean leverage and descriptive hit rates (valid-forecast dates) over some return dates. As
 * L = value·u/√P, √(P·mean(L²x²))/value = √(mean(u²x²)) exactly: the ratios use u alone, so they are the same for
 * every target, extreme ones included.
 */
export function volatilityTargetSubset(ks: readonly number[], s: SubsetInput) {
  const valid = ks.filter((k) => !s.ownNull[k]);
  return {
    dates: ks.length,
    mean_leverage: s.targetValue * (mean(ks.map((k) => s.unit[k])) / s.rootPeriods),
    realized_to_target: {
      daily_returns: rootMeanSquare(ks.map((k) => s.unit[k] * s.portfolio[k])),
      intraday_proxy: rootMeanSquare(ks.map((k) => s.unit[k] * Math.sqrt(s.realized[k]))),
    },
    hit_rates: s.hitSets.map((hits, level) => {
      const count = valid.reduce((sum, k) => sum + hits[k], 0);
      return { level: VAR_LEVELS[level].level, hits: count, valid_dates: valid.length, rate: valid.length ? count / valid.length : null };
    }),
    own_null_dates: ks.length - valid.length,
  };
}

interface VolatilityInput extends SubsetInput {
  dates: readonly string[];
  simpleReturns: readonly number[];
  regime: ReturnType<typeof regimeGroups>;
  subset: (ks: number[]) => ReturnType<typeof volatilityTargetSubset>;
}

function volatilityTarget(v: VolatilityInput) {
  const T = v.dates.length;
  const all = Array.from({ length: T }, (_, k) => k);
  const whole = v.subset(all);
  const daily = whole.realized_to_target.daily_returns * v.targetValue;
  const intraday = whole.realized_to_target.intraday_proxy * v.targetValue;

  // Compounded wealth (design F11): R_t = L_t·S_t with S_t = Σ wᵢ(exp(rᵢ/s) − 1). Ruin when 1 + R_t ≤ 0. R_t is
  // value·((u/√P)·S_t), or L_t·S_t if that inner product overflows, so for a finite S_t neither a tiny target nor a
  // leverage beyond the largest double turns a representable R_t into 0 or ∞; a flat date (u = 0) is 0 whatever S_t is.
  // An S_t beyond the largest double (a rise of more than e^709.78-fold in one day) is design limit (b).
  const leverage = v.unit.map((u) => v.targetValue * (u / v.rootPeriods));
  const position = v.simpleReturns.map((r, k) => {
    if (v.unit[k] === 0) return 0;
    const scaled = (v.unit[k] / v.rootPeriods) * r;
    return Number.isFinite(scaled) ? v.targetValue * scaled : leverage[k] * r;
  });
  // Wealth is held relative to its running peak, at most 1 before each day, so a long run of gains cannot overflow it
  // and lose the peak. Ruin sets it to 0: a drawdown of 1, with the ruin date as its trough. Without ruin it reaches 0
  // only after losing more than 1 − 2⁻¹⁰⁷⁴ of the peak, and then stays there: a later recovery is not tracked (0·∞ is NaN).
  let relative = 1, peakK = -1, maxDrawdown = 0, ddPeak = -1, ddTrough = -1, ruinedK = -1;
  let stretch = 0, longest = 0;
  for (let k = 0; k < T; k++) {
    if (ruinedK < 0) {
      if (1 + position[k] <= 0) { relative = 0; ruinedK = k; } else if (relative > 0) relative *= 1 + position[k];
    }
    if (relative >= 1 && ruinedK < 0) { relative = 1; peakK = k; stretch = 0; continue; }
    stretch++;
    longest = Math.max(longest, stretch);
    const drawdown = 1 - relative;
    if (drawdown > maxDrawdown || k === ruinedK) { maxDrawdown = drawdown; ddPeak = peakK; ddTrough = k; }
  }
  let ownNullsInDrawdown = 0;
  if (ddTrough >= 0) for (let k = ddPeak + 1; k <= ddTrough; k++) ownNullsInDrawdown += v.ownNull[k];

  // Ranks, the maximum and the percentiles from u: the same order as L, without ties from L overflowing or underflowing.
  // The worst days are ordered by u·S_t, the order of R_t in exact arithmetic, so a target small enough for every R_t to
  // underflow to 0 still finds them; where u·S_t ties, as at ±∞, by R_t, then by date.
  const ranks = averageRanks([...v.unit]);
  const severity = v.simpleReturns.map((r, k) => (v.unit[k] === 0 ? 0 : v.unit[k] * r));
  const order = all.slice().sort((x, y) => severity[x] - severity[y] || position[x] - position[y] || x - y).slice(0, WORST_DAYS);
  const worst = order.map((k) => ({ date: v.dates[k], position_return: position[k], leverage: leverage[k], leverage_percentile: (ranks[k] - 0.5) / T }));
  let maxK = 0;
  for (let k = 1; k < T; k++) if (v.unit[k] > v.unit[maxK]) maxK = k;

  return {
    realized_to_target: {
      daily_returns: { annualized: daily, ratio: whole.realized_to_target.daily_returns },
      intraday_proxy: { annualized: intraday, ratio: whole.realized_to_target.intraday_proxy },
    },
    drawdown: {
      max: maxDrawdown,
      peak_date: ddTrough >= 0 && ddPeak >= 0 ? v.dates[ddPeak] : null,
      trough_date: ddTrough >= 0 ? v.dates[ddTrough] : null,
      longest_underwater_dates: longest,
      underwater_at_end: ruinedK >= 0 || relative < 1,
      ruined_on: ruinedK >= 0 ? v.dates[ruinedK] : null,
      own_null_dates_in_peak_to_trough: ownNullsInDrawdown,
    },
    leverage: {
      mean: whole.mean_leverage, median: v.targetValue * (median(v.unit) / v.rootPeriods),
      p95: v.targetValue * (nearestRank(v.unit, 0.95) / v.rootPeriods), max: leverage[maxK], max_date: v.dates[maxK],
    },
    regime_view: {
      excluded_dates: v.regime.excluded,
      groups: {
        falling: v.subset(v.regime.groups.falling), steady: v.subset(v.regime.groups.steady), rising: v.subset(v.regime.groups.rising),
      },
    },
    worst_days: {
      days: worst,
      mean_leverage_percentile: mean(worst.map((w) => w.leverage_percentile)),
      own_null_dates: order.reduce((sum, k) => sum + v.ownNull[k], 0),
    },
    sub_periods: blockBounds(T, 4).map(([from, to]) => ({
      from_date: v.dates[from], to_date: v.dates[to - 1], ...v.subset(all.slice(from, to)),
    })),
  };
}
