import type { OhlcvBar } from "./tradingview.js";
import { marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

export const CROSS_ASSET_SHOCK_PREFLIGHT_V1 = {
  contract_id: "cross_asset_shock_preflight_v1",
  target_fx_symbols: ["OANDA:EURUSD", "OANDA:USDJPY"],
  required_context: { dxy: "TVC:DXY", us_yield: "TVC:US10Y", xauusd: "OANDA:XAUUSD" },
  timeframes: ["5", "15"],
  alignment: "exact_utc_closed_bar_no_forward_fill",
  purpose: "coverage_and_continuity_preflight_only_not_a_shock_signal",
} as const;

export type CrossAssetShockRole = "target_fx" | "dxy" | "us_yield" | "xauusd";
type InputSeries = { role: CrossAssetShockRole; symbol: string; bars: OhlcvBar[] };

const ROLES: readonly CrossAssetShockRole[] = ["target_fx", "dxy", "us_yield", "xauusd"];

function expectedSymbol(role: CrossAssetShockRole): string[] {
  if (role === "target_fx") return [...CROSS_ASSET_SHOCK_PREFLIGHT_V1.target_fx_symbols];
  return [CROSS_ASSET_SHOCK_PREFLIGHT_V1.required_context[role]];
}

function validateBars(series: InputSeries): OhlcvBar[] {
  const closed = series.bars.filter((bar) => bar.forming !== true).sort((left, right) => left.time - right.time);
  let previous = -Infinity;
  for (const bar of closed) {
    if (!Number.isFinite(bar.time) || bar.time <= previous || !Number.isFinite(bar.close) || bar.close <= 0) {
      if (bar.time === previous) throw new Error(`${series.role} has a duplicate closed timestamp`);
      throw new Error(`${series.role} has an invalid closed OHLC bar`);
    }
    previous = bar.time;
  }
  return closed;
}

/**
 * Measures whether the minimum cross-asset evidence exists before defining any shock threshold or
 * continuation rule.  It never fills a missing close from another time or another symbol.
 */
export function computeCrossAssetShockPreflight(input: {
  timeframe: string;
  minimumAlignedBars: number;
  series: readonly InputSeries[];
}) {
  if (!CROSS_ASSET_SHOCK_PREFLIGHT_V1.timeframes.includes(input.timeframe as "5" | "15")) {
    throw new Error("cross-asset shock preflight only supports 5 or 15 minute timeframes");
  }
  if (!Number.isInteger(input.minimumAlignedBars) || input.minimumAlignedBars < 2 || input.minimumAlignedBars > 20_000) {
    throw new Error("minimum aligned bars must be an integer from 2 to 20000");
  }
  if (input.series.length !== ROLES.length) throw new Error("cross-asset shock preflight requires exactly four series");
  const byRole = new Map<CrossAssetShockRole, InputSeries>();
  for (const series of input.series) {
    if (!ROLES.includes(series.role) || byRole.has(series.role)) throw new Error("cross-asset shock preflight roles are duplicate or unsupported");
    const symbol = series.symbol.toUpperCase();
    if (!expectedSymbol(series.role).includes(symbol)) {
      const label = series.role === "target_fx" ? "target FX symbol" : `${series.role} symbol`;
      throw new Error(`cross-asset shock preflight ${label} is unsupported: ${series.symbol}`);
    }
    byRole.set(series.role, series);
  }
  if (ROLES.some((role) => !byRole.has(role))) throw new Error("cross-asset shock preflight requires target_fx, dxy, us_yield, and xauusd");

  const closed = Object.fromEntries(ROLES.map((role) => [role, validateBars(byRole.get(role)!)])) as Record<CrossAssetShockRole, OhlcvBar[]>;
  const targetTimes = new Set(closed.target_fx.map((bar) => bar.time));
  const byTime = Object.fromEntries(ROLES.map((role) => [role, new Map(closed[role].map((bar) => [bar.time, bar]))])) as Record<CrossAssetShockRole, Map<number, OhlcvBar>>;
  const commonTimes = [...targetTimes].filter((time) => ROLES.every((role) => byTime[role].has(time))).sort((left, right) => left - right);
  const intervalMilliseconds = marketRegimeResolutionMilliseconds(input.timeframe);
  if (intervalMilliseconds === null) throw new Error("cross-asset shock preflight timeframe resolution is invalid");
  const contiguousReturns = commonTimes.slice(1).filter((time, index) => time - commonTimes[index] === intervalMilliseconds / 1000).length;
  const nonContiguousIntervals = Math.max(0, commonTimes.length - 1 - contiguousReturns);
  const missingFromTarget = Object.fromEntries(ROLES.filter((role) => role !== "target_fx").map((role) => [role, [...targetTimes].filter((time) => !byTime[role].has(time)).length])) as Record<Exclude<CrossAssetShockRole, "target_fx">, number>;
  const formingBarsExcluded = Object.fromEntries(ROLES.map((role) => [role, byRole.get(role)!.bars.length - closed[role].length])) as Record<CrossAssetShockRole, number>;
  const qualityIssues = [
    ...(commonTimes.length < input.minimumAlignedBars ? ["minimum_exactly_aligned_closed_bars_not_met"] : []),
    ...(nonContiguousIntervals > 0 ? ["one_or_more_non_contiguous_common_bar_intervals"] : []),
  ];
  return {
    schema_version: "1.0" as const,
    series: "cross_asset_shock_preflight" as const,
    contract: CROSS_ASSET_SHOCK_PREFLIGHT_V1,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    timeframe: input.timeframe,
    sources: Object.fromEntries(ROLES.map((role) => {
      const bars = closed[role];
      return [role, { symbol: byRole.get(role)!.symbol.toUpperCase(), closed_bars: bars.length, first_closed_at: bars[0]?.timeIso ?? null, last_closed_at: bars.at(-1)?.timeIso ?? null }];
    })),
    alignment: {
      policy: CROSS_ASSET_SHOCK_PREFLIGHT_V1.alignment,
      minimum_aligned_bars: input.minimumAlignedBars,
      common_closed_bars: commonTimes.length,
      contiguous_common_return_intervals: contiguousReturns,
      non_contiguous_common_intervals: nonContiguousIntervals,
      missing_from_target: missingFromTarget,
    },
    quality: { forming_bars_excluded: formingBarsExcluded },
    quality_issues: qualityIssues,
    limitations: [
      "preflight_only_no_shock_threshold_direction_or_forward_outcome_is_evaluated",
      "us_yield_and_dxy_are_market_data_proxies_not_a_complete_macro_or_order_flow_source",
      "missing_times_are_not_forward_filled_or_nearest_matched",
    ],
  };
}
