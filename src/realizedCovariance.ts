import type { BarSeries } from "./barSeries.js";
import { fdlibmLog } from "./fdlibmLog.js";
import { allFinite, positiveSemidefinite, symmetricWithin, type Matrix } from "./numerics.js";
import {
  RealizedCovarianceError, assertSeriesAgainstRules, isoWeekday, planCalendar, type CalendarDay, type RealizedCovarianceRules,
} from "./realizedCovarianceRules.js";
import { intlZoneResolver, offsetTimeline, type ZoneResolver } from "./zonedTime.js";

/**
 * compute_realized_covariance, the computation (docs/REALIZED_COVARIANCE_DESIGN.md sections "Slots,
 * endpoints and missing slots", "Returns", "Kept and dropped days" and "Realized windows"; plan
 * section 7). Pure apart from the injectable zone resolver: no I/O and no clock.
 */
export const REALIZED_COVARIANCE_ALGORITHM = "realized_covariance_v1";
export const DROP_CAUSES = ["no_endpoint", "no_previous_endpoint", "too_many_missing_slots", "numerically_not_psd"] as const;
export type DropCause = (typeof DROP_CAUSES)[number];
export type ProxyValue = number | number[][] | null;

export const REALIZED_COVARIANCE_LIMITATIONS = [
  "realized_covariance_is_a_noisy_proxy_not_the_true_covariance",
  "rules_are_caller_asserted_research_choices",
  "missing_bars_widen_intervals_no_fill",
  "bar_timestamps_assumed_open_time",
  "holidays_cascade_with_from_previous_endpoint",
  "tzdata_version_reported_not_pinned",
  "bar_source_integrity_not_source_authentication",
  "not_a_trading_or_risk_management_result",
] as const;
/** Returned only with from_previous_endpoint (design rev 2.3, Q6). */
export const FIRST_INTERVAL_LIMITATION = "first_interval_spans_non_slot_bars";

export interface RealizedCovarianceInput {
  rules: RealizedCovarianceRules;
  rules_sha256: string;
  from_date: string;
  to_date: string;
  /** In axis order. */
  series: { artifact_id: string; bars: BarSeries }[];
  resolver?: ZoneResolver;
}

const iso = (ms: number) => new Date(ms).toISOString();
const reject = (code: string, detail: string): never => { throw new RealizedCovarianceError(code, detail); };

/** The first index whose value is at least `target`, in an ascending array. */
function lowerBound(sorted: ArrayLike<number>, target: number): number {
  let low = 0, high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Nearest-rank quantile of a sorted array. */
const nearestRank = (sorted: number[], q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];

/**
 * `includeReturns` also returns each date's daily return vector r_D (a copy, an array of n numbers even for n = 1, or
 * null on a dropped date) for backtest_risk_forecast's re-derivation (docs/RISK_FORECAST_BACKTEST_PLAN.md, step 1).
 * It only adds an output: the proxy set, and so its ID, is the same with or without it.
 */
export function computeRealizedCovariance(input: RealizedCovarianceInput, options: { includeReturns?: boolean } = {}) {
  const { rules, rules_sha256 } = input;
  const resolver = input.resolver ?? intlZoneResolver;
  const n = input.series.length;
  if (n < 1 || n > 8) reject("invalid_series", "between 1 and 8 series are required");
  assertSeriesAgainstRules(input.series.map((s) => ({ artifact_id: s.artifact_id, series_id: s.bars.series_id,
    interval_minutes: s.bars.interval_minutes })), rules);
  const { days, tzdata } = planCalendar(rules, input.from_date, input.to_date, resolver);
  const step = rules.interval_minutes * 60_000;
  const fromPrevious = rules.first_interval === "from_previous_endpoint";

  // Coverage (F7, G8): the span the call reads must lie inside every series' coverage.
  const spanFrom = fromPrevious ? days[0].previous_end - step : days[0].start;
  const spanTo = days[days.length - 1].end;
  const coverage = input.series.map(({ bars }) => ({
    series_id: bars.series_id,
    first_bar: iso(bars.open_time[0] * 1000),
    last_bar: iso(bars.open_time[bars.open_time.length - 1] * 1000),
    from: bars.open_time[0] * 1000,
    to: bars.open_time[bars.open_time.length - 1] * 1000 + step,
  }));
  if (coverage.some((c) => c.from > spanFrom || c.to < spanTo)) {
    reject("range_outside_series_coverage", `the call reads ${iso(spanFrom)} to ${iso(spanTo)}; coverage: `
      + coverage.map((c) => `${c.series_id} ${c.first_bar}..${c.last_bar}`).join(", "));
  }

  // The valid closes inside the span the call reads, as sorted slot indexes (open − spanFrom) / interval with
  // their closes. Every point the computation reads lies in the span, and memory follows the bars there, never
  // the series' whole extent or the span's length (code review C3). NaN marks a missing bar or a close that is
  // null or not positive (design "Bar series artifact"). Bars are on the grid, so the index is exact.
  const grids = input.series.map(({ bars }) => {
    const slots: number[] = [], values: number[] = [];
    for (let b = lowerBound(bars.open_time, spanFrom / 1000); b < bars.open_time.length && bars.open_time[b] * 1000 < spanTo; b++) {
      const close = bars.close[b];
      if (typeof close === "number" && close > 0) {
        slots.push((bars.open_time[b] * 1000 - spanFrom) / step);
        values.push(close);
      }
    }
    return { slots: Float64Array.from(slots), values: Float64Array.from(values) };
  });
  const closeAt = (series: number, at: number) => {
    const { slots, values } = grids[series];
    const found = lowerBound(slots, (at - spanFrom) / step);
    return found < slots.length && slots[found] === (at - spanFrom) / step ? values[found] : Number.NaN;
  };
  const allValid = (at: number) => grids.every((_, i) => !Number.isNaN(closeAt(i, at)));
  const scale = rules.return_unit === "log_percent" ? 100 : 1;
  // fdlibm's log, not Math.log, whose bits differ between V8's arm64 and x64 builds (see fdlibmLog.ts).
  const level = (series: number, at: number) => scale * fdlibmLog(closeAt(series, at));

  const identicalCandidates = new Set<string>();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) identicalCandidates.add(`${i},${j}`);
  let keptAny = false;

  const dates: string[] = [], windows: { from: string; to: string }[] = [];
  const rc: ProxyValue[] = [], dailyOuter: ProxyValue[] = [], returns: (number[] | null)[] = [];
  const commonSlots: number[] = [], expectedSlots: number[] = [], dropCause: (DropCause | null)[] = [];
  const missing: number[] = [];

  for (const day of days) {
    const expected: number[] = [];
    for (let k = 0; k < day.expected_slots; k++) expected.push(day.start + k * step);
    const common = expected.filter(allValid);
    const endpoint = day.end - step;
    const previousEndpoint = day.previous_end - step;
    dates.push(day.label);
    windows.push({ from: iso(day.window_from), to: iso(day.end) });
    expectedSlots.push(day.expected_slots);
    commonSlots.push(common.length);
    missing.push(day.expected_slots - common.length);

    let cause: DropCause | null = null;
    if (!allValid(endpoint)) cause = "no_endpoint";
    else if (fromPrevious && !allValid(previousEndpoint)) cause = "no_previous_endpoint";
    else if (day.expected_slots - common.length > rules.max_missing_slots) cause = "too_many_missing_slots";

    let value: { rc: ProxyValue; outer: ProxyValue; r: number[] | null } = { rc: null, outer: null, r: null };
    let points: number[] = [];
    if (!cause) {
      // P₀ and P₁…P_m (design "Returns"): the previous produced endpoint, or the first common slot.
      points = fromPrevious ? [previousEndpoint, ...common] : common;
      const result = dayProxies(points, n, level);
      if (result) value = result; else cause = "numerically_not_psd";
    }
    if (!cause) {
      keptAny = true;
      // Q1: a pair stays identical only if its closes are bitwise equal at every point a kept day uses.
      for (const pair of [...identicalCandidates]) {
        const [i, j] = pair.split(",").map(Number);
        // Every point of a kept day has a valid close in every series, so comparing the numbers is bitwise.
        if (points.some((at) => !Object.is(closeAt(i, at), closeAt(j, at)))) identicalCandidates.delete(pair);
      }
    }
    dropCause.push(cause);
    rc.push(value.rc);
    dailyOuter.push(value.outer);
    returns.push(cause ? null : value.r);
  }
  const identicalClosePairs = keptAny ? [...identicalCandidates].map((pair) => pair.split(",").map(Number) as [number, number]) : [];

  const diagnostics = buildDiagnostics(input, days, spanFrom, spanTo, step, resolver);
  const sortedMissing = [...missing].sort((x, y) => x - y);
  const dropped = Object.fromEntries(DROP_CAUSES.map((c) => [c, dropCause.filter((x) => x === c).length]));
  const keptByWeekday: Record<string, number> = {};
  dates.forEach((date, i) => {
    if (dropCause[i] === null) keptByWeekday[isoWeekday(date)] = (keptByWeekday[isoWeekday(date)] ?? 0) + 1;
  });

  return {
    proxy: {
      schema_version: "1.0" as const,
      algorithm_version: REALIZED_COVARIANCE_ALGORITHM,
      bar_series: input.series.map((s) => s.artifact_id),
      underlying_series_ids: input.series.map((s) => s.bars.series_id),
      evidence_tiers: input.series.map((s) => s.bars.evidence_tier),
      rules,
      rules_sha256,
      from_date: input.from_date,
      to_date: input.to_date,
      dates,
      windows,
      rc,
      daily_outer: dailyOuter,
      common_slots: commonSlots,
      expected_slots: expectedSlots,
      drop_cause: dropCause,
      identical_close_pairs: identicalClosePairs,
    },
    summary: {
      produced_days: dates.length,
      kept_days: dropCause.filter((c) => c === null).length,
      dropped,
      kept_by_weekday: keptByWeekday,
      missing_slots: {
        days: sortedMissing.length,
        zero_missing_days: sortedMissing.filter((m) => m === 0).length,
        min: sortedMissing[0],
        p50: nearestRank(sortedMissing, 0.5),
        p90: nearestRank(sortedMissing, 0.9),
        max: sortedMissing[sortedMissing.length - 1],
      },
    },
    diagnostics,
    envelope: { from: iso(spanFrom), to: iso(spanTo) },
    tzdata,
    limitations: [...REALIZED_COVARIANCE_LIMITATIONS, ...(fromPrevious ? [FIRST_INTERVAL_LIMITATION] : [])],
    ...(options.includeReturns ? { returns } : {}),
  };
}

/**
 * RC and the daily outer product for one kept day (design "Returns", pinned formulas):
 * y_k = L(P_k) − L(P₀), step_k = y_k − y_{k−1}, r_D = L(endpoint) − L(P₀), RC summed in time order for
 * i ≤ j and mirrored. Returns null when the consumer's own checks fail (numerically_not_psd).
 */
function dayProxies(points: number[], n: number, level: (series: number, at: number) => number): { rc: ProxyValue; outer: ProxyValue; r: number[] } | null {
  const origin = Array.from({ length: n }, (_, i) => level(i, points[0]));
  const rcMatrix: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const previous = new Array<number>(n).fill(0);
  const sums = new Array<number>(n).fill(0);
  const largest = new Array<number>(n).fill(0);
  for (let k = 1; k < points.length; k++) {
    const y = Array.from({ length: n }, (_, i) => level(i, points[k]) - origin[i]);
    const stepK = y.map((value, i) => value - previous[i]);
    for (let i = 0; i < n; i++) {
      sums[i] += stepK[i];
      largest[i] = Math.max(largest[i], Math.abs(y[i]));
      for (let j = i; j < n; j++) rcMatrix[i][j] += stepK[i] * stepK[j];
    }
    for (let i = 0; i < n; i++) previous[i] = y[i];
  }
  const r = previous;   // y_m: the last point is D's endpoint
  for (let i = 0; i < n; i++) {
    // The invariant (F6): the steps sum to the endpoint difference, within a tolerance scaled to the levels.
    if (Math.abs(sums[i] - r[i]) > 1e-12 * Math.max(1, largest[i])) {
      throw new RealizedCovarianceError("internal_invariant", `interval returns do not sum to the daily return for series ${i}`);
    }
  }
  const outer: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      outer[i][j] = r[i] * r[j];
      if (j > i) { rcMatrix[j][i] = rcMatrix[i][j]; outer[j][i] = outer[i][j]; }
    }
  }
  const acceptable = (m: Matrix) => allFinite(m) && symmetricWithin(m, 1e-12) && positiveSemidefinite(m);
  if (!acceptable(rcMatrix) || !acceptable(outer)) return null;
  // r is copied, so a caller changing it cannot reach the proxies.
  return n === 1 ? { rc: rcMatrix[0][0], outer: outer[0][0], r: [...r] } : { rc: rcMatrix, outer, r: [...r] };
}

/** Diagnostics (design F14; plan section 7 "Diagnostics"). */
function buildDiagnostics(input: RealizedCovarianceInput, days: CalendarDay[], spanFrom: number, spanTo: number, step: number,
  resolver: ZoneResolver) {
  const zone = input.rules.time_zone;
  const offset = offsetTimeline(zone, spanFrom, spanTo, resolver);
  const DAY = 86_400_000;
  const hhmm = (minuteOfDay: number) => `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
  return input.series.map(({ bars }) => {
    let nonSlot = 0, invalid = 0;
    let dayIndex = 0;
    // Local calendar day number → minute of day of its first and last valid-close bar.
    const perDate = new Map<number, { first: number; last: number }>();
    for (let b = 0; b < bars.open_time.length; b++) {
      const at = bars.open_time[b] * 1000;
      if (at < spanFrom || at >= spanTo) continue;
      const close = bars.close[b];
      const isValid = typeof close === "number" && close > 0;
      if (!isValid) invalid++;
      // Non-slot bars: inside some produced day's realized window, but not one of that day's expected slots.
      while (dayIndex < days.length && days[dayIndex].end <= at) dayIndex++;
      const day = days[dayIndex];
      if (day && at >= day.window_from && at < day.start) nonSlot++;
      if (isValid) {
        const local = at + offset(at);
        const dayNumber = Math.floor(local / DAY), minuteOfDay = Math.floor((local - dayNumber * DAY) / 60_000);
        const entry = perDate.get(dayNumber);
        if (!entry) perDate.set(dayNumber, { first: minuteOfDay, last: minuteOfDay });
        else entry.last = minuteOfDay;
      }
    }
    const byWeekday = new Map<number, { first: Map<string, number>; last: Map<string, number>; dates: number }>();
    for (const [dayNumber, { first, last }] of perDate) {
      const weekday = ((new Date(dayNumber * DAY).getUTCDay() + 6) % 7) + 1;
      const tally = byWeekday.get(weekday) ?? { first: new Map(), last: new Map(), dates: 0 };
      tally.first.set(hhmm(first), (tally.first.get(hhmm(first)) ?? 0) + 1);
      tally.last.set(hhmm(last), (tally.last.get(hhmm(last)) ?? 0) + 1);
      tally.dates++;
      byWeekday.set(weekday, tally);
    }
    // Ties go to the earlier time.
    const mode = (counts: Map<string, number>) => [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0];
    return {
      series_id: bars.series_id,
      first_bar: iso(bars.open_time[0] * 1000),
      last_bar: iso(bars.open_time[bars.open_time.length - 1] * 1000),
      non_slot_bars: nonSlot,
      invalid_closes: invalid,
      modal_local_times: [...byWeekday].sort((x, y) => x[0] - y[0]).map(([weekday, t]) => ({
        weekday, dates: t.dates, first_bar: mode(t.first), last_bar: mode(t.last),
      })),
    };
  });
}
