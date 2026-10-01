import { fdlibmLog } from "./fdlibmLog.js";
import { erfc } from "./numerics.js";
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
  const counts = { n00: 0, n01: 0, n10: 0, n11: 0 };
  let start = 0;
  for (const length of segments) {
    for (let t = start + 1; t < start + length; t++) {
      const key = hits[t - 1] ? (hits[t] ? "n11" : "n10") : (hits[t] ? "n01" : "n00");
      counts[key]++;
    }
    start += length;
  }
  return counts;
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
  const hits = new Uint8Array(T);
  for (let d = 0; d < draws; d++) {
    let x = 0;
    for (let t = 0; t < T; t++) {
      hits[t] = random() < alpha ? 1 : 0;
      x += hits[t];
    }
    kupiec[d] = kupiecStatistic(x, T, alpha);
    conditional[d] = kupiec[d] + independenceStatistic(transitionCounts(hits, segments));
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
  const statistics = new Float64Array(draws);
  for (let d = 0; d < draws; d++) {
    for (let i = 0; i < x; i++) {
      const j = i + Math.floor(random() * (T - i));
      swapped[i] = j;
      const held = index[i]; index[i] = index[j]; index[j] = held;
      hits[index[i]] = 1;
    }
    statistics[d] = independenceStatistic(transitionCounts(hits, segments));
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
 * - LR_cc is indeterminate when the two cases have opposite directions, even if both reject.
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
  const conditionalResult: TestResult = opposite ? "indeterminate_due_to_own_nulls" : combine(conditional);
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
