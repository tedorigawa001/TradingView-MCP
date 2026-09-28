import type { ForecastSet, ForecastValue } from "./forecastSet.js";
import {
  allFinite, cholesky, frobeniusInner, inverseFromCholesky, logDeterminantFromCholesky, normalCdf,
  positiveSemidefinite, spearman, symmetricWithin, symmetrize, type Matrix,
} from "./numerics.js";
import { createRandom } from "./seededRandom.js";

/**
 * compare_forecast_losses, the computation (docs/FORECAST_LOSS_COMPARISON_DESIGN.md rev 4.1 and
 * docs/FORECAST_LOSS_COMPARISON_PLAN.md section 7). Pure: no I/O, no clock. The server adds the
 * exploration search and the input-path limitation.
 */
export const FORECAST_LOSS_CONTRACT = "forecast_loss_comparison_v1";
export const BOOTSTRAP_SEED = 20_260_928;
export const BOOTSTRAP_DRAWS = 2_000;
export const BOOTSTRAP_MEAN_BLOCK = 20;
export const MIN_USED_DAYS = 100;
export const MAX_DROPPED_SHARE = 0.05;
export const FAVOURED_P = 0.05;
export const DISTINCT_RHO = 0.99;
const SYMMETRY_TOLERANCE = 1e-12;

export type ForecastLoss = "qlike" | "mse";
export type Side = "A" | "B";
type Forecast = { s: Matrix; inverse: Matrix; logDet: number };

const asMatrix = (value: number | number[][]): Matrix => typeof value === "number" ? [[value]] : value;
const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / values.length;
const meanOrNull = (values: number[]) => values.length ? mean(values) : null;
const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** Forecast validity: finite, symmetric within 1e-12·max|S|, Cholesky positive-definite. */
function forecast(value: ForecastValue): Forecast | null {
  if (value === null) return null;
  const m = asMatrix(value);
  if (!allFinite(m) || !symmetricWithin(m, SYMMETRY_TOLERANCE)) return null;
  const s = symmetrize(m);
  const l = cholesky(s);
  if (!l) return null;
  return { s, inverse: inverseFromCholesky(l), logDet: logDeterminantFromCholesky(l) };
}

/** Proxy validity: finite, symmetric within tolerance, PSD within 1e-12·max|P| (plan section 7). */
function proxy(value: ForecastValue): Matrix | null {
  if (value === null) return null;
  const m = asMatrix(value);
  if (!allFinite(m) || !symmetricWithin(m, SYMMETRY_TOLERANCE) || !positiveSemidefinite(m)) return null;
  return symmetrize(m);
}

/** Lower is better. qlike: log det S + tr(S⁻¹P); mse: ‖S − P‖²_F. */
function lossOf(f: Forecast, p: Matrix, loss: ForecastLoss): number {
  if (loss === "qlike") return f.logDet + frobeniusInner(f.inverse, p);
  return f.s.reduce((sum, row, i) => sum + row.reduce((acc, x, j) => acc + (x - p[i][j]) ** 2, 0), 0);
}

/** One day's loss under the design's validity rules; null when the forecast or proxy is invalid. */
export function evaluateLoss(forecastValue: ForecastValue, proxyValue: ForecastValue, loss: ForecastLoss): number | null {
  const f = forecast(forecastValue), p = proxy(proxyValue);
  return f && p ? lossOf(f, p, loss) : null;
}

/** The proxy-dependent part ⟨G, P⟩ of d = c + ⟨G, P⟩ (design M3). */
function proxyPart(a: Forecast, b: Forecast, p: Matrix, loss: ForecastLoss): number {
  if (loss === "qlike") return frobeniusInner(a.inverse, p) - frobeniusInner(b.inverse, p);
  return -2 * (frobeniusInner(a.s, p) - frobeniusInner(b.s, p));
}

export interface Hac { dbar: number; S: number; L: number; T: number }

/** Newey-West long-run variance: Bartlett weights 1 − l/(L+1), divisor T, L = min(T − 1, ⌊4(T/100)^(2/9)⌋). */
export function neweyWest(d: number[]): Hac {
  const T = d.length;
  const L = Math.min(T - 1, Math.floor(4 * (T / 100) ** (2 / 9)));
  const dbar = mean(d);
  const e = d.map((x) => x - dbar);
  const gamma = (lag: number) => {
    let sum = 0;
    for (let t = lag; t < T; t++) sum += e[t] * e[t - lag];
    return sum / T;
  };
  let S = gamma(0);
  for (let lag = 1; lag <= L; lag++) S += 2 * (1 - lag / (L + 1)) * gamma(lag);
  return { dbar, S, L, T };
}

/** Four contiguous blocks of equal count in date order; the first T mod 4 blocks get one more day. */
export function blockBounds(T: number, blocks = 4): [number, number][] {
  const base = Math.floor(T / blocks), extra = T % blocks;
  const bounds: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < blocks; i++) {
    const size = base + (i < extra ? 1 : 0);
    bounds.push([start, start + size]);
    start += size;
  }
  return bounds;
}

/**
 * Stationary bootstrap (plan section 7): one createRandom(seed) stream across R draws in order.
 * First index floor(u·T); then, per position, draw u: if u < 1/block the next index is floor(u′·T)
 * with a fresh draw, else (previous + 1) mod T. Centred, unstudentized one-sided p for side s.
 */
export function stationaryBootstrap(d: number[], s: 1 | -1, draws = BOOTSTRAP_DRAWS, block = BOOTSTRAP_MEAN_BLOCK, seed = BOOTSTRAP_SEED) {
  const T = d.length;
  const dbar = mean(d);
  const random = createRandom(seed);
  let extreme = 0;
  for (let r = 0; r < draws; r++) {
    let index = Math.floor(random() * T);
    let sum = d[index];
    for (let t = 1; t < T; t++) {
      index = random() < 1 / block ? Math.floor(random() * T) : (index + 1) % T;
      sum += d[index];
    }
    if (s * (sum / T - dbar) <= s * dbar) extreme++;
  }
  const p = (1 + extreme) / (1 + draws);
  return { p, mc_se: Math.sqrt(p * (1 - p) / draws), draws, mean_block: block, seed };
}

/** k* on the imputed sample: fewest most-favourable removals whose remaining mean crosses zero. */
export function breakdownCount(sample: number[], side: Side): number | null {
  const ordered = [...sample].sort((x, y) => (side === "A" ? x - y : y - x));   // most favourable first
  let rest = ordered.reduce((sum, x) => sum + x, 0);
  for (let j = 0; j < ordered.length; j++) {
    const m = rest / (ordered.length - j);
    if (side === "A" ? m >= 0 : m <= 0) return j;
    rest -= ordered[j];
  }
  return null;
}

/** Mean after removing the k values most favourable to side (smallest for A, largest for B). */
export function trimFavourable(sample: number[], k: number, side: Side): number {
  const ordered = [...sample].sort((x, y) => (side === "A" ? x - y : y - x));
  return mean(ordered.slice(k));
}

export const LIMITATIONS = [
  "no_listed_conflict_is_not_evidence_of_superiority",
  "battery_checks_sign_not_significance",
  "battery_items_are_not_independent_tests",
  "proxy_noise_can_reverse_rankings",
  "one_historical_path_no_forward_evidence",
  "pairwise_only_no_correction_across_multiple_benchmarks",
  "dm_normal_approximation_weak_under_heavy_tailed_d",
  "forecast_units_and_variance_vs_volatility_are_caller_asserted",
  "not_a_trading_or_risk_management_result",
  "secondary_proxy_independence_is_caller_asserted",
  "secondary_proxy_mean_not_imputed_for_own_nulls",
  "distinctness_measure_shares_forecast_difference_factor",
  "search_counts_cover_this_journal_only",
] as const;

export function compareForecastLosses(set: ForecastSet, options: { loss: ForecastLoss; tracked: boolean }) {
  const { loss, tracked } = options;
  const N = set.dates.length;
  const drops = { N, used: 0, proxy_invalid: 0, both_null: 0, a_only_null: 0, b_only_null: 0 };
  const d: number[] = [], usedDates: string[] = [], usedLabels: string[] = [], lossA: number[] = [], lossB: number[] = [];
  const bOnANull: number[] = [], aOnBNull: number[] = [];
  const secondary = { d: [] as number[], primaryD: [] as number[], partP: [] as number[], partP2: [] as number[] };
  for (let t = 0; t < N; t++) {
    const p = proxy(set.primary[t]);
    const a = forecast(set.a[t]), b = forecast(set.b[t]);
    // Drop causes in design order (N9): proxy first, then both, then one side.
    if (!p) { drops.proxy_invalid++; continue; }
    if (!a && !b) { drops.both_null++; continue; }
    if (!a) { drops.a_only_null++; bOnANull.push(lossOf(b!, p, loss)); continue; }
    if (!b) { drops.b_only_null++; aOnBNull.push(lossOf(a, p, loss)); continue; }
    const la = lossOf(a, p, loss), lb = lossOf(b, p, loss);
    lossA.push(la); lossB.push(lb); d.push(la - lb); usedDates.push(set.dates[t]);
    if (set.labels) usedLabels.push(set.labels[t]);
    if (set.secondary) {
      const p2 = proxy(set.secondary[t]);
      if (p2) {
        secondary.d.push(lossOf(a, p2, loss) - lossOf(b, p2, loss));
        secondary.primaryD.push(la - lb);
        secondary.partP.push(proxyPart(a, b, p, loss));
        secondary.partP2.push(proxyPart(a, b, p2, loss));
      }
    }
  }
  const T = d.length;
  drops.used = T;
  const hardDays = {
    b_loss_on_a_only_null_days: meanOrNull(bOnANull), b_loss_on_used_days: meanOrNull(lossB),
    a_loss_on_b_only_null_days: meanOrNull(aOnBNull), a_loss_on_used_days: meanOrNull(lossA),
  };

  // The secondary proxy: evaluated on used days where it is valid; > 5% of them dropped = not evaluable.
  const secondaryDropped = T - secondary.d.length;
  const secondaryStatus: "absent" | "not_evaluable" | "evaluable" = !set.secondary ? "absent"
    : (T === 0 || secondary.d.length === 0 || secondaryDropped / T > MAX_DROPPED_SHARE ? "not_evaluable" : "evaluable");
  const rho = set.secondary ? spearman(secondary.partP, secondary.partP2) : null;
  const distinct = secondaryStatus === "evaluable" ? rho !== null && rho <= DISTINCT_RHO : null;
  const secondaryResult = {
    status: secondaryStatus,
    mean: meanOrNull(secondary.d),
    used: secondary.d.length,
    dropped: set.secondary ? secondaryDropped : null,
    spearman_rho: rho,
    sign_change_share: secondary.d.length
      ? secondary.d.filter((x, i) => sign(x) !== sign(secondary.primaryD[i])).length / secondary.d.length : null,
    distinct,
  };
  // Side-independent withheld reasons (rows 5-7).
  const sideIndependent: string[] = [
    ...(secondaryStatus !== "evaluable" ? ["not_assessed_secondary_proxy_absent"] : []),
    ...(secondaryStatus === "evaluable" && distinct === false ? ["not_assessed_secondary_proxy_not_distinct"] : []),
    ...(!tracked ? ["no_listed_conflict_untracked"] : []),
  ];
  const labelMeans = set.labels ? [...new Set(usedLabels)].sort().map((label) => {
    const values = d.filter((_, i) => usedLabels[i] === label);
    return { label, days: values.length, mean: mean(values) };
  }) : null;
  const base = {
    contract: FORECAST_LOSS_CONTRACT,
    loss,
    candidateEligible: false as const,
    statistical_calibration: "not_assessed" as const,
    limitations: [...LIMITATIONS],
  };

  // Evaluability of the primary.
  let reason: string | null = null;
  if (N === 0 || (N - T) / N > MAX_DROPPED_SHARE) reason = "more_than_5_percent_of_dates_dropped";
  else if (T < MIN_USED_DAYS) reason = "fewer_than_100_used_days";
  const hac = T >= 2 ? neweyWest(d) : null;
  if (!reason && hac && (!(hac.S > 0) || hac.S < 1e-12 * mean(d.map((x) => x * x)))) reason = "hac_variance_not_positive";
  if (reason) {
    return {
      ...base,
      status: { evaluable: false, reason },
      battery_outcome: "not_evaluable" as const,
      robustness_conflicts: [] as string[],
      withheld_reasons: sideIndependent,
      withheld_reasons_scope: "side_independent_only" as const,
      non_decisive_disagreements: [] as string[],
      dm: hac ? { dbar: hac.dbar, S: hac.S, L: hac.L, DM: null, p_a: null, p_b: null, T } : null,
      mean_favours: null,
      mean_favours_test: "two_sided_10_percent" as const,
      drops, hard_days: hardDays, sub_periods: null, trimmed: null, breakdown: null,
      secondary: secondaryResult, bootstrap: null, caller_label_means: labelMeans,
    };
  }

  const { dbar, S, L } = hac!;
  const DM = dbar / Math.sqrt(S / T);
  const pA = normalCdf(DM), pB = normalCdf(-DM);
  const favours: Side | "neither" = pA < FAVOURED_P ? "A" : pB < FAVOURED_P ? "B" : "neither";
  const k = Math.floor((T + 99) / 100);   // ceil(T/100) in integers
  const subPeriods = blockBounds(T).map(([from, to]) => ({
    from_date: usedDates[from], to_date: usedDates[to - 1], days: to - from, mean: mean(d.slice(from, to)),
  }));
  const sorted = [...d].sort((x, y) => x - y);
  const bothTails = mean(sorted.slice(k, T - k));
  const common = {
    ...base,
    status: { evaluable: true, reason: null },
    dm: { dbar, S, L, DM, p_a: pA, p_b: pB, T },
    mean_favours: favours,
    mean_favours_test: "two_sided_10_percent" as const,
    drops, hard_days: hardDays, sub_periods: subPeriods, secondary: secondaryResult, caller_label_means: labelMeans,
  };

  if (favours === "neither") {
    const s = sign(dbar);
    return {
      ...common,
      battery_outcome: "not_applicable" as const,
      robustness_conflicts: [] as string[],
      withheld_reasons: sideIndependent,
      withheld_reasons_scope: "side_independent_only" as const,
      non_decisive_disagreements: [] as string[],
      trimmed: { k, decisive: null, both_tails: bothTails,
        a_tail_removed: trimFavourable(d, k, "A"), b_tail_removed: trimFavourable(d, k, "B") },
      breakdown: null,
      bootstrap: s === 0 ? null : stationaryBootstrap(d, s as 1 | -1),
    };
  }

  const side = favours;
  const reverses = (x: number) => (side === "A" ? x >= 0 : x <= 0);
  // D′: used d plus m copies of the least favourable observed d (design M1).
  const m = side === "A" ? drops.a_only_null : drops.b_only_null;
  const worst = side === "A" ? sorted[T - 1] : sorted[0];
  const imputed = [...d, ...new Array<number>(m).fill(worst)];
  const decisive = trimFavourable(imputed, k, side);
  const kStar = breakdownCount(imputed, side);
  const secondaryMean = secondaryResult.mean;
  const bootstrap = stationaryBootstrap(d, side === "A" ? 1 : -1);

  const conflicts = [
    ...subPeriods.flatMap((block, i) => (reverses(block.mean) ? [`sub_period_${i + 1}_reverses`] : [])),
    ...(reverses(decisive) ? ["trimmed_mean_reverses"] : []),
    ...(secondaryStatus === "evaluable" && secondaryMean !== null && reverses(secondaryMean) ? ["secondary_proxy_reverses"] : []),
  ];
  const withheld = [
    ...(m > k ? ["blocked_by_dropped_days"] : []),
    ...sideIndependent,
  ];
  const nonDecisive = [
    ...(reverses(bothTails) ? ["both_tail_trimmed_mean_reverses"] : []),
    ...(bootstrap.p >= FAVOURED_P ? ["bootstrap_p_not_below_0.05_while_favoured_dm_p_is"] : []),
    ...(labelMeans ?? []).filter((l) => reverses(l.mean)).map((l) => `caller_label_reverses:${l.label}`),
    ...(secondaryStatus === "not_evaluable" && secondaryMean !== null && reverses(secondaryMean)
      ? ["non_evaluable_secondary_mean_reverses"] : []),
  ];
  const outcome = conflicts.length ? "conflicts_found"
    : m > k ? "blocked_by_dropped_days"
      : secondaryStatus !== "evaluable" ? "not_assessed_secondary_proxy_absent"
        : distinct === false ? "not_assessed_secondary_proxy_not_distinct"
          : !tracked ? "no_listed_conflict_untracked"
            : "no_listed_conflict";
  return {
    ...common,
    battery_outcome: outcome,
    robustness_conflicts: conflicts,
    withheld_reasons: withheld,
    withheld_reasons_scope: "all" as const,
    non_decisive_disagreements: nonDecisive,
    trimmed: { k, decisive: { mean: decisive, own_nulls_imputed_worst_case: m }, both_tails: bothTails },
    breakdown: { k_star: kStar, fraction: kStar === null ? null : kStar / (T + m),
      k_star_status: kStar === null ? "no_crossing" : "crossed" },
    bootstrap,
  };
}

export type ForecastLossResult = ReturnType<typeof compareForecastLosses>;
