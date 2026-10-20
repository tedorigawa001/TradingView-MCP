import type { OhlcvResult, TradingView } from "./tradingview.js";
import { normalizeResolution } from "./analysisOverlay.js";
import { assertChartState, symbolSatisfies, withTemporaryChartState } from "./chartTransaction.js";

export const CLOSED_MTF_TIMEFRAMES = ["1", "5", "15", "30", "60", "120", "240", "1D", "1W"] as const;
export type ClosedMtfTimeframe = typeof CLOSED_MTF_TIMEFRAMES[number];
const DEFAULT_TIMEFRAMES: ClosedMtfTimeframe[] = ["15", "60", "240", "1D"];
const sma = (values: number[], period: number) => values.length < period ? null
  : values.slice(-period).reduce((sum, value) => sum + value, 0) / period;

function recursiveAverage(values: number[], period: number, alpha: number): number | null {
  if (values.length < period) return null;
  let value = sma(values.slice(0, period), period)!;
  for (const next of values.slice(period)) value += alpha * (next - value);
  return value;
}

/** Cadence is an additional stale-series guard, not a substitute for binding or data-ready confirmation. */
function nativeCadence(bars: OhlcvResult["bars"], timeframe: string) {
  const normalized = normalizeResolution(timeframe);
  if (!CLOSED_MTF_TIMEFRAMES.includes(normalized as ClosedMtfTimeframe)) throw new Error("unsupported closed MTF cadence");
  const expected = normalized === "1D" ? 86400 : normalized === "1W" ? 604800 : Number(normalized) * 60;
  // Calendar-native opens can move with DST and weekly holidays; intraday opens must demonstrate the exact interval.
  const tolerance = normalized === "1D" ? 3600 : normalized === "1W" ? 90000 : 0;
  const intervals = bars.slice(1).map((bar, index) => bar.time - bars[index].time);
  const minimum = intervals.length === 0 ? null : Math.min(...intervals);
  if (minimum !== null && Math.abs(minimum - expected) > tolerance) {
    throw new Error("native OHLC cadence does not match the requested timeframe; data may still belong to the previous timeframe");
  }
  return { status: minimum === null ? "unverifiable" : "verified_minimum_interval",
    minimum_interval_seconds: minimum, expected_interval_seconds: expected, tolerance_seconds: tolerance };
}

/** Shared native-bar boundary for descriptive tools; never expose its raw bars in an MCP response. */
export function selectClosedNativeBars(result: OhlcvResult, symbol: string, timeframe: string, asOf: Date) {
  if (!Number.isFinite(asOf.getTime())) throw new Error("closed MTF summary needs a valid cutoff");
  if (result.symbol.toUpperCase() !== symbol.toUpperCase() || normalizeResolution(result.resolution) !== normalizeResolution(timeframe)) {
    throw new Error("closed MTF OHLC symbol or timeframe does not match the request");
  }
  const bars = result.bars;
  if (bars.length > 1000) throw new Error("closed MTF summary accepts at most 1000 bars per timeframe");
  for (const [index, bar] of bars.entries()) {
    if (!Number.isSafeInteger(bar.time) || !Number.isFinite(new Date(bar.time * 1000).getTime())
      || bar.timeIso !== new Date(bar.time * 1000).toISOString()
      || (index > 0 && bar.time <= bars[index - 1].time)
      || ![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0)
      || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)
      || (bar.forming !== undefined && typeof bar.forming !== "boolean")) {
      throw new Error("closed MTF OHLC bars must be valid, strictly ordered native observations");
    }
  }
  const eligible = bars.filter((bar) => bar.time * 1000 <= asOf.getTime());
  const cadence = nativeCadence(eligible, timeframe);
  const firstForming = eligible.findIndex((bar) => bar.forming === true);
  // A forming observation ends the usable prefix even if malformed upstream data follows it.
  const end = firstForming < 0 ? Math.max(0, eligible.length - 1) : firstForming;
  const closed = eligible.slice(0, end);
  return { eligible, closed, end, firstForming, cadence };
}

/** Native bars only: a successor, not a duration guess or the forming flag, proves completion. */
export function summarizeClosedTimeframe(result: OhlcvResult, symbol: string, timeframe: string, asOf: Date) {
  const { eligible, closed, end, firstForming, cadence } = selectClosedNativeBars(result, symbol, timeframe, asOf);
  const bars = result.bars;
  const latest = closed.at(-1) ?? null;
  const closes = closed.map((bar) => bar.close);
  const changes = closes.slice(1).map((close, index) => close - closes[index]);
  const gain = recursiveAverage(changes.map((change) => Math.max(0, change)), 14, 1 / 14);
  const loss = recursiveAverage(changes.map((change) => Math.max(0, -change)), 14, 1 / 14);
  const rsi = gain === null || loss === null ? null : loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  const ranges = closed.slice(1).map((bar, index) => Math.max(bar.high - bar.low,
    Math.abs(bar.high - closed[index].close), Math.abs(bar.low - closed[index].close)));
  const indicators = {
    sma20: sma(closes, 20), sma50: sma(closes, 50), sma200: sma(closes, 200),
    ema20: recursiveAverage(closes, 20, 2 / 21), rsi14: rsi, atr14: recursiveAverage(ranges, 14, 1 / 14),
  };
  const qualityIssues: string[] = [];
  if (closed.length < 200) qualityIssues.push("insufficient_history_for_one_or_more_indicators");
  if (closed.length === 0) qualityIssues.push("no_successor_confirmed_bars");
  if (firstForming >= 0 && firstForming < eligible.length - 1) qualityIssues.push("forming_bar_before_end_of_history");
  const allValues = Object.values(indicators).filter((value): value is number => value !== null);
  if (allValues.some((value) => !Number.isFinite(value))) throw new Error("closed MTF calculation produced a non-finite value");
  return {
    timeframe: normalizeResolution(timeframe), status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    as_of: asOf.toISOString(), confirmation_basis: "successor_native_bar_open_at_or_before_cutoff",
    last_closed_bar_open_at: latest?.timeIso ?? null,
    confirmed_by_next_bar_at: latest === null ? null : eligible[end].timeIso,
    seconds_since_confirmation: latest === null ? null : (asOf.getTime() - eligible[end].time * 1000) / 1000,
    close: latest?.close ?? null, indicators, native_cadence: cadence,
    history: { loaded_bars: bars.length, closed_bars_used: closed.length, first_used_bar_at: closed[0]?.timeIso ?? null,
      future_bars_excluded: bars.length - eligible.length,
      forming_bars_excluded: eligible.filter((bar) => bar.forming === true).length,
      unconfirmed_tail_bars_excluded: eligible.length - closed.length },
    quality_issues: qualityIssues,
  };
}

type SummaryApi = Pick<TradingView, "getChartContext" | "getReplayStatus" | "getOhlcv" | "setSymbol" | "setResolution">;
type SummaryOptions = { symbol: string; chartIndex?: number; expectedTimeframe: string; timeframes?: ClosedMtfTimeframe[]; count?: number; confirm?: boolean };

class ClosedMtfSafetyError extends Error {}

async function assertNoReplay(tv: SummaryApi) {
  let replay;
  try { replay = await tv.getReplayStatus(); }
  catch { throw new ClosedMtfSafetyError("closed MTF summary could not verify inactive Bar Replay"); }
  if (!replay.available || replay.started || replay.toolbarVisible) throw new ClosedMtfSafetyError("closed MTF summary requires verified inactive Bar Replay");
}

async function assertSummaryChart(tv: SummaryApi, index: number, symbol: string, resolution: string) {
  try { return await assertChartState(tv, index, { symbol, resolution }); }
  catch { throw new ClosedMtfSafetyError("closed MTF chart binding could not be verified"); }
}

export async function buildClosedMtfSummary(tv: SummaryApi, options: SummaryOptions, now: () => Date = () => new Date()) {
  const asOf = now();
  if (!Number.isFinite(asOf.getTime())) throw new Error("closed MTF summary needs a valid cutoff");
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const count = options.count ?? 300;
  if (!Array.isArray(timeframes) || timeframes.length < 1 || timeframes.length > 6
    || timeframes.some((tf) => !CLOSED_MTF_TIMEFRAMES.includes(tf)) || new Set(timeframes).size !== timeframes.length) {
    throw new Error("closed MTF summary needs one to six distinct supported timeframes");
  }
  if (!Number.isInteger(count) || count < 2 || count > 1000) throw new Error("closed MTF count must be an integer between 2 and 1000");
  await assertNoReplay(tv);
  const context = await tv.getChartContext();
  const chartIndex = options.chartIndex ?? context.activeChartIndex;
  if (chartIndex === null || !Number.isInteger(chartIndex) || chartIndex < 0) throw new Error("closed MTF summary requires an available chart index");
  const selected = context.charts.find((chart) => chart.index === chartIndex);
  if (!selected || !symbolSatisfies(selected.symbol, options.symbol, true)) throw new Error("selected chart symbol does not match the requested symbol");
  const original = await assertChartState(tv, chartIndex, { symbol: selected.symbol, resolution: options.expectedTimeframe });
  const plan = timeframes.map((timeframe) => {
    const loaded = context.charts.find((chart) => chart.symbol.toUpperCase() === original.symbol.toUpperCase()
      && normalizeResolution(chart.resolution) === timeframe);
    return { timeframe, chart_index: loaded?.index ?? chartIndex, temporary_switch: loaded === undefined };
  });
  const base = {
    schema_version: "1.0", symbol: original.symbol, as_of: asOf.toISOString(), source: "tradingview_native_ohlcv",
    data_use: "descriptive_context_only_not_a_trade_signal", candidateEligible: false,
    calculation: { price: "close", sma_periods: [20, 50, 200], ema_period: 20, rsi_period: 14, atr_period: 14,
      ema_seed: "first_20_close_mean", rsi_atr_smoothing: "wilder_seeded_with_first_14_changes_or_true_ranges",
      flat_rsi: 50, requested_bars_per_timeframe: count },
    limitations: [
      "Only native loaded OHLC is used; no scanner values, resampling, forward fill, or history loading.",
      "Temporary changes require data-ready confirmation; timeout notes refuse acquisition. Native minimum intervals must match intraday duration, or daily/weekly duration within DST/holiday tolerances. Short sessions or sparse evidence may be refused conservatively; cadence alone does not prove series identity.",
      "The latest native bar without a successor is excluded, even during a market closure; forming bars end the usable prefix.",
      "Confirmation time is the next native bar's open, not an exchange publication timestamp. Freshness and missing-session coverage are not proven.",
      "Periods count observed bars, including across session gaps. EMA/RSI/ATR depend on the disclosed loaded window and seeds; they need not equal TradingView built-ins.",
      "A common cutoff does not make bars across timeframes simultaneous. This is not point-in-time vintage evidence or a calibrated trading rule.",
    ],
  };
  if (plan.some((item) => item.temporary_switch) && options.confirm !== true) {
    return { ...base, status: "confirmation_required", chart_changes: plan, chart_restored: null, summaries: [],
      quality_issues: ["confirm_required_for_temporary_timeframe_switch"] };
  }
  const summaries: Array<ReturnType<typeof summarizeClosedTimeframe> & { chart_index: number; observed_at: string }> = [];
  const issues: string[] = [];
  // Keep the low-level chart API's timeout fallback compatible for other callers, but never consume it here.
  const unverifiedChanges = new Set<string>();
  const verifiedChange = async <T extends { note?: string }>(kind: string, change: () => Promise<T>) => {
    try {
      const result = await change();
      if (result?.note !== undefined) throw new Error(`closed MTF ${kind} change did not confirm data readiness`);
      unverifiedChanges.delete(kind);
      return result;
    } catch (error) {
      unverifiedChanges.add(kind);
      throw error;
    }
  };
  const strictChanges = {
    getChartContext: () => tv.getChartContext(),
    setSymbol: (symbol: string, index?: number) => verifiedChange("symbol", () => tv.setSymbol(symbol, index)),
    setResolution: (resolution: string, index?: number) => verifiedChange("timeframe", () => tv.setResolution(resolution, index)),
  };
  let restored = true;
  let safetyBlocked = false;
  for (const item of plan) {
    // Refuse any new transaction after Replay or manual source-pane drift, before it can mutate the chart.
    try {
      await assertNoReplay(tv);
      await assertSummaryChart(tv, chartIndex, original.symbol, original.resolution);
    } catch { safetyBlocked = true; issues.push("chart_or_replay_safety_check_failed"); break; }
    const read = async () => {
      await assertNoReplay(tv);
      await assertSummaryChart(tv, item.chart_index, original.symbol, item.timeframe);
      const ohlcv = await tv.getOhlcv(count, item.chart_index);
      const observedAt = now().toISOString();
      await assertSummaryChart(tv, item.chart_index, original.symbol, item.timeframe);
      await assertNoReplay(tv);
      return { ...summarizeClosedTimeframe(ohlcv, original.symbol, item.timeframe, asOf), chart_index: item.chart_index, observed_at: observedAt };
    };
    if (item.temporary_switch) {
      const transaction = await withTemporaryChartState(strictChanges, chartIndex, { symbol: original.symbol, resolution: item.timeframe }, read);
      // A nested rollback may restore only the label and fail readiness; an outer no-op restore must not erase that failure.
      if (!transaction.restored || unverifiedChanges.size > 0) { restored = false; issues.push("chart_restore_failed"); break; }
      if (transaction.operationError instanceof ClosedMtfSafetyError) {
        safetyBlocked = true; issues.push("chart_or_replay_safety_check_failed"); break;
      }
      if (transaction.operationError !== null || transaction.value === null) { issues.push(`timeframe_read_failed:${item.timeframe}`); continue; }
      summaries.push(transaction.value);
    } else {
      try { summaries.push(await read()); } catch (error) {
        if (error instanceof ClosedMtfSafetyError) { safetyBlocked = true; issues.push("chart_or_replay_safety_check_failed"); break; }
        issues.push(`timeframe_read_failed:${item.timeframe}`);
      }
    }
  }
  try {
    await assertNoReplay(tv);
    await assertChartState(tv, chartIndex, { symbol: original.symbol, resolution: original.resolution });
    for (const item of plan.filter((item) => !item.temporary_switch)) {
      await assertChartState(tv, item.chart_index, { symbol: original.symbol, resolution: item.timeframe });
    }
  } catch {
    return { ...base, status: "blocked", chart_changes: plan, chart_restored: restored, summaries: [],
      quality_issues: [...issues, "final_chart_or_replay_binding_failed"] };
  }
  return { ...base, status: !restored || safetyBlocked ? "blocked" : issues.length > 0 || summaries.some((summary) => summary.status !== "complete") ? "partial" : "complete",
    chart_changes: plan, chart_restored: plan.some((item) => item.temporary_switch) ? restored : null,
    summaries: restored && !safetyBlocked ? summaries : [], quality_issues: issues };
}
