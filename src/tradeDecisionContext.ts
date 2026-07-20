import type { Scanner, MtfTimeframe } from "./scanner.js";
import type { EconomicCalendar, ImportanceLevel } from "./calendar.js";
import type { CotClient } from "./cot.js";
import { cotFreshness } from "./cot.js";
import type { TreasuryRealYieldClient } from "./realYield.js";
import type { TradingView } from "./tradingview.js";
import { normalizeResolution } from "./analysisOverlay.js";
import { buildMarketSnapshot } from "./marketSnapshot.js";
import { buildExecutionSnapshot } from "./executionSnapshot.js";

export type TradeDecisionContextOptions = {
  symbol: string;
  chartIndex?: number;
  expectedTimeframe: string;
  auxiliarySymbols?: string[];
  timeframes?: MtfTimeframe[];
  fields?: string[];
  countries?: string[];
  minImportance?: ImportanceLevel;
  ohlcvCount: number;
  keyLevelRangePercent: number;
  keyLevelLimit: number;
  includePositioning: boolean;
  requirePositioning: boolean;
  includeRealYield: boolean;
  requireRealYield: boolean;
  eventBlackoutBeforeMinutes: number;
  eventBlackoutAfterMinutes: number;
  minimumEventImportance: "medium" | "high";
  executionWaitForUpdateMs: number;
  executionSampleIntervalMs: number;
  executionMaxQuoteAgeMs: number;
};

type ContextIssue = {
  code: string;
  severity: "warning" | "error";
  component: string;
  message: string;
  details?: Record<string, unknown>;
};

type EvidenceStatus = "available" | "partial" | "unavailable" | "blocked";

function evidence(
  required: boolean,
  status: EvidenceStatus,
  source: string,
  observedAt: string,
  sourceAt: string | null,
  freshness: unknown,
  data: unknown,
) {
  return {
    required,
    status,
    source,
    observed_at: observedAt,
    source_at: sourceAt,
    freshness,
    data,
  };
}

function matchesSymbol(actual: string, expected: string): boolean {
  return actual.toUpperCase() === expected.toUpperCase();
}

function topLevelStatus(issues: ContextIssue[]): "complete" | "partial" | "blocked" {
  if (issues.some((issue) => issue.severity === "error")) return "blocked";
  if (issues.length > 0) return "partial";
  return "complete";
}

export async function buildTradeDecisionContext(
  dependencies: {
    tv: Pick<TradingView, "getChartContext" | "getReplayStatus" | "getExecutionQuotes" | "getOhlcv" | "getKeyLevels">;
    scanner: Pick<Scanner, "getQuotes" | "getMtfOverview">;
    calendar: Pick<EconomicCalendar, "getEvents">;
    cot: Pick<CotClient, "getLatest">;
    realYield: Pick<TreasuryRealYieldClient, "getLatest">;
  },
  options: TradeDecisionContextOptions,
  now = new Date(),
) {
  const requestedAt = now.toISOString();
  const issues: ContextIssue[] = [];
  let replayStatus: Awaited<ReturnType<typeof dependencies.tv.getReplayStatus>> | null = null;
  try {
    replayStatus = await dependencies.tv.getReplayStatus();
    if (replayStatus.started || replayStatus.toolbarVisible) {
      issues.push({
        code: "chart_replay_active",
        severity: "error",
        component: "chart",
        message: "TradingView Bar Replay is active; historical chart evidence cannot be mixed with real-time execution evidence.",
        details: {
          started: replayStatus.started,
          toolbarVisible: replayStatus.toolbarVisible,
          currentTime: replayStatus.currentTimeIso,
        },
      });
    }
  } catch {
    issues.push({
      code: "replay_status_unavailable",
      severity: "error",
      component: "chart",
      message: "Bar Replay state could not be verified, so live chart evidence is blocked.",
    });
  }
  let context: Awaited<ReturnType<typeof dependencies.tv.getChartContext>> | null = null;
  try {
    context = await dependencies.tv.getChartContext();
  } catch {
    issues.push({
      code: "chart_context_unavailable",
      severity: "error",
      component: "chart",
      message: "TradingView chart context retrieval failed.",
    });
  }
  const chartIndex = options.chartIndex ?? context?.activeChartIndex ?? null;
  const chart = chartIndex === null || context === null
    ? undefined
    : context.charts.find((candidate) => candidate.index === chartIndex);
  let replaySafe = replayStatus !== null && !replayStatus.started && !replayStatus.toolbarVisible;
  const chartMatches = replaySafe && chart !== undefined
    && matchesSymbol(chart.symbol, options.symbol)
    && normalizeResolution(chart.resolution) === normalizeResolution(options.expectedTimeframe);

  if (context === null) {
    // The structured chart_context_unavailable issue was added above.
  } else if (!chart) {
    issues.push({
      code: "chart_unavailable",
      severity: "error",
      component: "chart",
      message: "The requested TradingView chart is not present in the current layout.",
      details: { chartIndex },
    });
  } else if (!matchesSymbol(chart.symbol, options.symbol)) {
    issues.push({
      code: "chart_symbol_mismatch",
      severity: "error",
      component: "chart",
      message: "The selected chart symbol does not match the requested analysis symbol.",
      details: { expected: options.symbol, observed: chart.symbol },
    });
  } else if (normalizeResolution(chart.resolution) !== normalizeResolution(options.expectedTimeframe)) {
    issues.push({
      code: "chart_timeframe_mismatch",
      severity: "error",
      component: "chart",
      message: "The selected chart timeframe does not match expected_timeframe.",
      details: { expected: normalizeResolution(options.expectedTimeframe), observed: normalizeResolution(chart.resolution) },
    });
  }

  const marketPromise = buildMarketSnapshot(
    { scanner: dependencies.scanner, calendar: dependencies.calendar },
    {
      symbols: [options.symbol],
      auxiliarySymbols: options.auxiliarySymbols,
      timeframes: options.timeframes,
      fields: options.fields,
      quoteFields: ["bid", "ask"],
      requiredQuoteFields: ["close"],
      includeEvents: true,
      countries: options.countries,
      minImportance: options.minImportance,
    },
  );
  const chartEvidencePromise = chartMatches
    ? Promise.allSettled([
        dependencies.tv.getOhlcv(options.ohlcvCount, chartIndex!),
        dependencies.tv.getKeyLevels({
          chartIndex: chartIndex!,
          rangePercent: options.keyLevelRangePercent,
          limit: options.keyLevelLimit,
          includeAllPlots: false,
        }),
      ])
    : Promise.resolve(null);
  const positioningPromise = options.includePositioning
    ? dependencies.cot.getLatest(options.symbol).then(
        (value) => ({ status: "fulfilled" as const, value }),
        () => ({ status: "rejected" as const }),
      )
    : Promise.resolve(null);
  const realYieldPromise = options.includeRealYield
    ? dependencies.realYield.getLatest().then(
        (value) => ({ status: "fulfilled" as const, value }),
        () => ({ status: "rejected" as const }),
      )
    : Promise.resolve(null);

  const [market, initialChartResults, positioningResult, realYieldResult] = await Promise.all([
    marketPromise,
    chartEvidencePromise,
    positioningPromise,
    realYieldPromise,
  ]);
  let chartResults = initialChartResults;
  try {
    replayStatus = await dependencies.tv.getReplayStatus();
    replaySafe = !replayStatus.started && !replayStatus.toolbarVisible;
    if (!replaySafe) {
      chartResults = null;
      if (!issues.some((issue) => issue.code === "chart_replay_active")) {
        issues.push({
          code: "chart_replay_started_during_snapshot",
          severity: "error",
          component: "chart",
          message: "Bar Replay became active while chart evidence was being collected; the chart evidence was discarded.",
          details: { currentTime: replayStatus.currentTimeIso },
        });
      }
    }
  } catch {
    replaySafe = false;
    chartResults = null;
    if (!issues.some((issue) => issue.code === "replay_status_unavailable")) {
      issues.push({
        code: "replay_status_unavailable_after_chart_read",
        severity: "error",
        component: "chart",
        message: "Bar Replay state could not be re-verified after chart evidence collection; the chart evidence was discarded.",
      });
    }
  }
  let executionSnapshot: Awaited<ReturnType<typeof buildExecutionSnapshot>> | null = null;
  try {
    executionSnapshot = await buildExecutionSnapshot(
      { scanner: dependencies.scanner, tv: dependencies.tv },
      {
        symbols: [options.symbol],
        waitForUpdateMs: options.executionWaitForUpdateMs,
        sampleIntervalMs: options.executionSampleIntervalMs,
        maxQuoteAgeMs: options.executionMaxQuoteAgeMs,
        snapshotId: market.snapshot_id,
      },
    );
  } catch {
    issues.push({
      code: "execution_snapshot_unavailable",
      severity: "warning",
      component: "execution",
      message: "Execution snapshot retrieval failed.",
    });
  }
  const completedAt = new Date().toISOString();

  for (const issue of market.quality_issues) {
    issues.push({
      code: `market_${issue.code}`,
      severity: issue.severity,
      component: "market_snapshot",
      message: issue.message,
      ...(issue.symbols ? { details: { symbols: issue.symbols } } : {}),
    });
  }

  let chartData: unknown = null;
  let keyLevelsData: unknown = null;
  let chartSourceAt: string | null = null;
  let chartEvidenceValid = false;
  if (chartResults) {
    const [ohlcvResult, keyLevelsResult] = chartResults;
    if (ohlcvResult.status === "fulfilled") {
      const ohlcv = ohlcvResult.value;
      const bindingMatches = matchesSymbol(ohlcv.symbol, options.symbol)
        && normalizeResolution(ohlcv.resolution) === normalizeResolution(options.expectedTimeframe);
      if (!bindingMatches || ohlcv.bars.length === 0) {
        issues.push({
          code: "chart_ohlcv_invalid",
          severity: "error",
          component: "chart",
          message: "OHLCV evidence is empty or does not match the requested symbol and timeframe.",
        });
      } else {
        const closedBars = ohlcv.bars.filter((bar) => !bar.forming);
        const formingBar = [...ohlcv.bars].reverse().find((bar) => bar.forming) ?? null;
        chartSourceAt = ohlcv.bars.at(-1)?.timeIso ?? null;
        chartData = {
          chart_index: chartIndex,
          symbol: ohlcv.symbol,
          timeframe: normalizeResolution(ohlcv.resolution),
          closed_bars: closedBars,
          forming_bar: formingBar,
        };
        if (closedBars.length === 0) {
          issues.push({
            code: "closed_bars_unavailable",
            severity: "error",
            component: "chart",
            message: "The selected chart has no closed OHLCV bars in the requested window.",
          });
        } else {
          chartEvidenceValid = true;
        }
      }
    } else {
      issues.push({
        code: "chart_ohlcv_unavailable",
        severity: "error",
        component: "chart",
        message: "Required chart OHLCV retrieval failed.",
      });
    }

    if (keyLevelsResult.status === "fulfilled") {
      const keyLevels = keyLevelsResult.value;
      if (
        matchesSymbol(keyLevels.symbol, options.symbol)
        && normalizeResolution(keyLevels.resolution) === normalizeResolution(options.expectedTimeframe)
      ) {
        keyLevelsData = keyLevels;
      } else {
        issues.push({
          code: "key_levels_context_mismatch",
          severity: "warning",
          component: "key_levels",
          message: "Key-level evidence does not match the requested symbol and timeframe and was discarded.",
        });
      }
    } else {
      issues.push({
        code: "key_levels_unavailable",
        severity: "warning",
        component: "key_levels",
        message: "Key-level retrieval failed; no levels were inferred or substituted.",
      });
    }
  }

  let positioningData: unknown = null;
  let positioningFreshness: unknown = { status: "not_requested" };
  if (positioningResult?.status === "fulfilled") {
    positioningData = {
      schema_version: "1.1",
      status: "partial",
      as_of: positioningResult.value.report_date,
      cot: positioningResult.value,
      freshness: cotFreshness(positioningResult.value.report_date),
      limitations: [
        "COT is weekly delayed futures positioning, not realtime institutional order flow.",
        "Publication availability time is unavailable and is not inferred from report_date.",
      ],
    };
    positioningFreshness = cotFreshness(positioningResult.value.report_date);
  } else if (positioningResult?.status === "rejected") {
    issues.push({
      code: "positioning_unavailable",
      severity: options.requirePositioning ? "error" : "warning",
      component: "positioning",
      message: "COT positioning is unavailable for this request.",
    });
  }

  let realYieldData: unknown = null;
  let realYieldFreshness: unknown = { status: "not_requested" };
  if (realYieldResult?.status === "fulfilled") {
    realYieldData = realYieldResult.value;
    realYieldFreshness = {
      status: realYieldResult.value.freshness_status,
      weekdays: realYieldResult.value.freshness_weekdays,
      latency_class: realYieldResult.value.latency_class,
    };
    if (realYieldResult.value.status === "unavailable") {
      issues.push({
        code: "real_yield_unavailable",
        severity: options.requireRealYield ? "error" : "warning",
        component: "real_yield",
        message: "U.S. real-yield context is unavailable.",
      });
    }
  } else if (realYieldResult?.status === "rejected") {
    issues.push({
      code: "real_yield_unavailable",
      severity: options.requireRealYield ? "error" : "warning",
      component: "real_yield",
      message: "U.S. real-yield context retrieval failed.",
    });
  }

  const executionQuote = executionSnapshot?.quotes.find((quote) => matchesSymbol(quote.symbol, options.symbol));
  const executionReady = executionSnapshot?.status === "ready" && executionQuote?.status === "ready";
  if (executionSnapshot?.status === "blocked") {
    issues.push({
      code: "execution_quote_invalid",
      severity: "error",
      component: "execution",
      message: "Execution evidence failed an integrity check.",
    });
  } else if (!executionReady) {
    issues.push({
      code: "execution_not_ready",
      severity: "warning",
      component: "execution",
      message: "A streaming post-request bid/ask update was not verified; chart close is not substituted for execution evidence.",
    });
  }

  const importanceRank = { low: 0, medium: 1, high: 2 } as const;
  const eventThreshold = importanceRank[options.minimumEventImportance];
  const activeEvents = (market.economic_events?.events ?? []).filter((event) => {
    if (importanceRank[event.importance] < eventThreshold) return false;
    const minutesUntil = (Date.parse(event.date) - now.getTime()) / 60_000;
    return minutesUntil >= -options.eventBlackoutAfterMinutes
      && minutesUntil <= options.eventBlackoutBeforeMinutes;
  });
  if (activeEvents.length > 0) {
    issues.push({
      code: "event_blackout_active",
      severity: "warning",
      component: "economic_events",
      message: "The request is inside a configured important-event blackout window.",
      details: { events: activeEvents.map((event) => ({ title: event.title, date: event.date, importance: event.importance })) },
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  const decisionStatus = hasErrors
    ? "blocked"
    : activeEvents.length > 0 || !executionReady
      ? "wait"
      : "trade_ready";
  return {
    schema_version: "1.0",
    snapshot_id: market.snapshot_id,
    status: topLevelStatus(issues),
    decision_status: decisionStatus,
    directional_recommendation: null,
    data_use: {
      mode: "decision_support_only",
      automated_trading_decision: "not_permitted",
      order_execution: "not_supported",
    },
    symbol: options.symbol.toUpperCase(),
    timeframe: normalizeResolution(options.expectedTimeframe),
    chart_index: chartIndex,
    requested_at: requestedAt,
    completed_at: completedAt,
    quality_issues: issues,
    evidence: {
      replay: evidence(
        true,
        replaySafe ? "available" : "blocked",
        "tradingview_replay_state",
        completedAt,
        replayStatus?.currentTimeIso ?? null,
        { status: "not_applicable" },
        replayStatus,
      ),
      market_snapshot: evidence(true, market.status === "blocked" ? "blocked" : "partial", "tradingview_scanner_and_calendar", market.received_at, null, { status: "source_timestamp_unavailable" }, market),
      chart: evidence(true, chartEvidenceValid ? "available" : "blocked", "tradingview_chart_ohlcv", completedAt, chartSourceAt, { status: "not_assessed", basis: "bar_timestamp" }, chartData),
      key_levels: evidence(false, keyLevelsData === null ? "unavailable" : "available", "tradingview_chart_indicators", completedAt, chartSourceAt, { status: "not_assessed" }, keyLevelsData),
      positioning: evidence(options.requirePositioning, positioningData === null ? "unavailable" : "partial", "cftc_cot", completedAt, positioningResult?.status === "fulfilled" ? positioningResult.value.report_date : null, positioningFreshness, positioningData),
      real_yield: evidence(options.requireRealYield, realYieldData === null ? "unavailable" : "partial", "us_treasury", realYieldResult?.status === "fulfilled" ? realYieldResult.value.observed_at ?? completedAt : completedAt, realYieldResult?.status === "fulfilled" ? realYieldResult.value.observation_date : null, realYieldFreshness, realYieldData),
      execution: evidence(
        true,
        executionReady ? "available" : executionSnapshot?.status === "blocked" ? "blocked" : "partial",
        executionQuote?.source ?? "execution_snapshot",
        executionQuote?.observed_at ?? executionSnapshot?.completed_at ?? completedAt,
        executionQuote?.source_at ?? null,
        executionQuote?.freshness ?? { status: "unavailable" },
        executionSnapshot,
      ),
    },
    event_gate: {
      status: activeEvents.length > 0 ? "blackout" : "clear",
      before_minutes: options.eventBlackoutBeforeMinutes,
      after_minutes: options.eventBlackoutAfterMinutes,
      minimum_importance: options.minimumEventImportance,
      active_events: activeEvents,
    },
    limitations: [
      "trade_ready describes evidence completeness and configured gates, not a directional recommendation.",
      "Open-chart execution evidence uses quote lp_time; scanner fallback receipt times are not exchange timestamps and require a post-request bid/ask change.",
      "Bar Replay chart evidence is historical while alerts, orders, quotes lists, and trading-panel quotes remain real-time; replay blocks trade_ready.",
      "COT and real yield are slow macro context and must not be treated as intraday triggers.",
      "No order, alert, Pine script, chart setting, or journal entry is created or changed.",
    ],
  };
}
