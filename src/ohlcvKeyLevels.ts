import type { OhlcvResult, TradingView } from "./tradingview.js";
import { normalizeResolution } from "./analysisOverlay.js";
import { assertChartState, symbolSatisfies } from "./chartTransaction.js";
import { CLOSED_MTF_TIMEFRAMES, selectClosedNativeBars } from "./closedMtfSummary.js";

export const OHLCV_KEY_LEVEL_RULE = Object.freeze({
  version: "ohlcv_swing_levels_v1.1", left_bars: 3, right_bars: 3,
  merge_tolerance_bps: 5, touch_half_width_bps: 5,
});

type Filters = { rangePercent?: number; limit?: number };
type Origin = { kind: "swing_high" | "swing_low"; price: number; bar_index: number;
  bar_open_at: string; confirmed_at: string };
type Level = { seed: Origin; origins: Origin[] };

function filters(options: Filters) {
  const rangePercent = options.rangePercent ?? 3;
  const limit = options.limit ?? 30;
  if (!Number.isFinite(rangePercent) || rangePercent <= 0 || rangePercent > 50) throw new Error("OHLC level range percent must be in (0, 50]");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("OHLC level limit must be an integer between 1 and 100");
  return { rangePercent, limit };
}

export function extractOhlcvKeyLevels(result: OhlcvResult, symbol: string, timeframe: string, asOf: Date, options: Filters = {}) {
  const { rangePercent, limit } = filters(options);
  const { eligible, closed, end, firstForming, cadence } = selectClosedNativeBars(result, symbol, timeframe, asOf);
  const rule = OHLCV_KEY_LEVEL_RULE;
  const calendarNative = ["1D", "1W"].includes(normalizeResolution(timeframe));
  const gapLimit = cadence.expected_interval_seconds + Math.max(cadence.tolerance_seconds, cadence.expected_interval_seconds / 2);
  const gapBefore = eligible.map((bar, index) => index > 0 && bar.time - eligible[index - 1].time > gapLimit);
  const origins: Origin[] = [];
  let excludedPivotWindows = 0, spanningPivotWindows = 0;
  for (let i = rule.left_bars; i + rule.right_bars < closed.length; i++) {
    const confirmationIndex = i + rule.right_bars + 1;
    if (gapBefore.slice(i - rule.left_bars + 1, confirmationIndex + 1).some(Boolean)) {
      spanningPivotWindows++;
      // Calendar pivots count observed sessions; ordinary weekends must not erase every 3/3 window.
      // This does not prove calendar completeness: expose all such windows and keep visit resets below.
      if (!calendarNative) { excludedPivotWindows++; continue; }
    }
    const neighbours = closed.slice(i - rule.left_bars, i + rule.right_bars + 1).filter((_, index) => index !== rule.left_bars);
    for (const kind of ["swing_high", "swing_low"] as const) {
      const price = kind === "swing_high" ? closed[i].high : closed[i].low;
      const pivot = neighbours.every((bar) => kind === "swing_high" ? price > bar.high : price < bar.low);
      if (pivot) origins.push({ kind, price, bar_index: i, bar_open_at: closed[i].timeIso, confirmed_at: eligible[confirmationIndex].timeIso });
    }
  }

  // Earliest confirmed pivot anchors a fixed price; later pivots never move it or rewrite old touches.
  const levels: Level[] = [];
  for (const origin of origins) {
    const candidates = levels.filter((level) => Math.abs(origin.price - level.seed.price) <= level.seed.price * (rule.merge_tolerance_bps / 1e4));
    candidates.sort((a, b) => Math.abs(origin.price - a.seed.price) - Math.abs(origin.price - b.seed.price) || a.seed.bar_index - b.seed.bar_index);
    if (candidates.length > 0) candidates[0].origins.push(origin);
    else levels.push({ seed: origin, origins: [origin] });
  }
  const latest = closed.at(-1) ?? null;
  const rows = levels.map((level) => {
    const price = level.seed.price;
    const halfWidth = price * (rule.touch_half_width_bps / 1e4);
    const lower = price - halfWidth, upper = price + halfWidth;
    const distanceBps = latest === null ? null : (price / latest.close - 1) * 1e4;
    if (![lower, upper, ...(distanceBps === null ? [] : [distanceBps])].every(Number.isFinite)) {
      throw new Error("OHLC key level calculation produced a non-finite value");
    }
    const side = (close: number) => close > upper ? 1 : close < lower ? -1 : 0;
    let touches = 0, rejections = 0, crossings = 0;
    let inVisit = false, approach = 0;
    let lastTouch: string | null = null, lastTouchConfirmed: string | null = null;
    let lastRejection: string | null = null, lastRejectionConfirmed: string | null = null;
    const start = level.seed.bar_index + rule.right_bars + 1;
    for (let index = start; index < closed.length; index++) {
      const bar = closed[index];
      if (gapBefore[index]) { inVisit = false; approach = 0; }
      if (bar.high >= lower && bar.low <= upper) {
        if (!inVisit) { touches++; approach = gapBefore[index] ? 0 : side(closed[index - 1].close); }
        inVisit = true;
        lastTouch = bar.timeIso; lastTouchConfirmed = eligible[index + 1].timeIso;
      } else if (inVisit) {
        const departure = side(bar.close);
        if (approach !== 0 && departure === approach) {
          rejections++; lastRejection = bar.timeIso; lastRejectionConfirmed = eligible[index + 1].timeIso;
        } else if (approach !== 0 && departure === -approach) crossings++;
        inVisit = false; approach = 0;
      }
    }
    const kinds = new Set(level.origins.map((origin) => origin.kind));
    return {
      id: `${level.seed.kind}:${level.seed.bar_open_at}`, price, zone: { lower, upper },
      source: "confirmed_native_ohlcv_pivots", kind: kinds.size === 1 ? level.seed.kind : "mixed_swings",
      known_at: level.seed.confirmed_at, origins: level.origins, pivot_count: level.origins.length,
      relative_to_reference_close: latest === null ? null : price > latest.close ? "above" : price < latest.close ? "below" : "at",
      distance_bps: distanceBps,
      touch_episodes: touches, confirmed_rejections: rejections, cross_through_episodes: crossings,
      open_touch_episode: inVisit, last_touch_bar_open_at: lastTouch, last_touch_confirmed_at: lastTouchConfirmed,
      last_rejection_bar_open_at: lastRejection, last_rejection_confirmed_at: lastRejectionConfirmed,
      observation_from: closed[start]?.timeIso ?? null, observation_to: latest !== null && start < closed.length ? latest.timeIso : null,
    };
  });
  const inRange = rows.filter((row) => row.distance_bps !== null && Math.abs(row.distance_bps) <= rangePercent * 100);
  inRange.sort((a, b) => Math.abs(a.distance_bps!) - Math.abs(b.distance_bps!) || a.price - b.price || a.id.localeCompare(b.id));
  const issues: string[] = [];
  if (closed.length < rule.left_bars + rule.right_bars + 1) issues.push("insufficient_closed_history_for_strict_pivots");
  if (closed.length === 0) issues.push("no_successor_confirmed_bars");
  if (firstForming >= 0 && firstForming < eligible.length - 1) issues.push("forming_bar_before_end_of_history");
  if (excludedPivotWindows > 0) issues.push("pivot_windows_crossing_native_gaps_excluded");
  if (calendarNative && spanningPivotWindows > 0) issues.push("calendar_pivot_windows_span_timestamp_gaps");
  return {
    schema_version: "1.0", symbol: result.symbol, timeframe: normalizeResolution(timeframe), as_of: asOf.toISOString(),
    source: "tradingview_native_ohlcv", data_use: "descriptive_context_only_not_a_trade_signal", candidateEligible: false,
    status: issues.length === 0 ? "complete" : "partial", rule: { ...rule,
      pivot_comparison: "strict_against_every_left_and_right_neighbour;_equal_extrema_are_not_pivots",
      pivot_confirmation: "successor_open_after_the_last_right_flank_bar",
      merge: "chronological_pivots_to_nearest_existing_seed_within_tolerance;_ties_earliest_seed;_seed_price_never_moves",
      touch: "closed_bar_range_intersects_seed_zone;_consecutive_touching_bars_are_one_episode;_only_after_known_at",
      rejection: "first_non_touching_closed_bar_exits_on_the_same_side_as_the_close_before_the_episode;_unknown_approach_is_not_counted",
      pivot_gap_policy: calendarNative ? "observed_native_calendar_bars_with_spanning_gap_counts;_session_coverage_not_proven"
        : "exclude_pivot_windows_spanning_gaps",
      gap: "reset_all_visits_above_gap_limit;_intraday_pivot_windows_are_excluded;_calendar_pivot_windows_are_reported;_no_imputation", gap_limit_seconds: gapLimit },
    reference: { price: latest?.close ?? null, basis: "latest_successor_confirmed_close", bar_open_at: latest?.timeIso ?? null,
      confirmed_at: latest === null ? null : eligible[end].timeIso },
    history: { loaded_bars: result.bars.length, closed_bars_used: closed.length,
      from: closed[0]?.timeIso ?? null, to: latest?.timeIso ?? null, future_bars_excluded: result.bars.length - eligible.length,
      unconfirmed_tail_bars_excluded: eligible.length - closed.length, forming_bars_excluded: eligible.filter((bar) => bar.forming === true).length,
      native_gap_intervals: gapBefore.filter(Boolean).length, pivot_windows_excluded_by_gaps: excludedPivotWindows,
      pivot_windows_spanning_gaps: spanningPivotWindows },
    native_cadence: cadence, filters: { range_percent: rangePercent, limit },
    counts: { source_pivots: origins.length, level_candidates: levels.length, levels_in_range: inRange.length,
      excluded_by_range: rows.length - inRange.length, excluded_by_limit: Math.max(0, inRange.length - limit), returned_levels: Math.min(inRange.length, limit) },
    levels: inRange.slice(0, limit), quality_issues: issues,
    limitations: [
      "Fixed descriptive rules, not calibrated support/resistance strength, trade signals, stop orders, or evidence of an edge. Nearest-first ordering is not importance ranking.",
      "No indicator, scanner, volume, resampling or forward fill is used. The latest bar without a native successor is excluded even during closures.",
      "Times name bar opens and successor confirmation, not intrabar touch times or exchange publication. A touch is not a confirmed rejection or an executable fill.",
      "Gap handling is based on observed timestamps, not an exchange calendar. Calendar pivots count observed native sessions across gaps and report partial coverage; intraday pivot windows spanning gaps are excluded. Visits reset at gaps on every timeframe. Missing-session coverage is not proven; sparse cadence can be refused.",
      "The loaded window determines earliest seeds and counts. Merged later origins do not move a seed; only events after its confirmation are counted. No historical vintage or real-time freshness guarantee.",
    ],
  };
}

type LevelsApi = Pick<TradingView, "getChartContext" | "getReplayStatus" | "getOhlcv">;
type LevelsOptions = Filters & { symbol: string; expectedTimeframe: string; chartIndex?: number; count?: number };

async function noReplay(tv: LevelsApi) {
  const replay = await tv.getReplayStatus();
  if (!replay.available || replay.started || replay.toolbarVisible) throw new Error("OHLC key levels require verified inactive Bar Replay");
}

export async function buildOhlcvKeyLevels(tv: LevelsApi, options: LevelsOptions, now: () => Date = () => new Date()) {
  const asOf = now();
  if (!Number.isFinite(asOf.getTime())) throw new Error("OHLC key levels need a valid cutoff");
  filters(options);
  const count = options.count ?? 500;
  if (!Number.isInteger(count) || count < 8 || count > 1000) throw new Error("OHLC key level count must be an integer between 8 and 1000");
  const timeframe = normalizeResolution(options.expectedTimeframe);
  if (!CLOSED_MTF_TIMEFRAMES.includes(timeframe as typeof CLOSED_MTF_TIMEFRAMES[number])) throw new Error("unsupported OHLC key level timeframe");
  await noReplay(tv);
  const context = await tv.getChartContext();
  const chartIndex = options.chartIndex ?? context.activeChartIndex;
  if (chartIndex === null || !Number.isInteger(chartIndex) || chartIndex < 0) throw new Error("OHLC key levels require an available chart index");
  const selected = context.charts.find((chart) => chart.index === chartIndex);
  if (!selected || !symbolSatisfies(selected.symbol, options.symbol, true)) throw new Error("OHLC key level chart symbol does not match the request");
  const original = await assertChartState(tv, chartIndex, { symbol: selected.symbol, resolution: timeframe });
  const result = await tv.getOhlcv(count, chartIndex);
  const observedAt = now().toISOString();
  await assertChartState(tv, chartIndex, { symbol: original.symbol, resolution: original.resolution });
  await noReplay(tv);
  return { ...extractOhlcvKeyLevels(result, original.symbol, timeframe, asOf, options), chart_index: chartIndex, observed_at: observedAt,
    requested_bars: count, chart_changes: false };
}
