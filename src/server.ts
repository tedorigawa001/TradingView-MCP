import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { CdpClient } from "./cdp.js";
import type { StrategyReport, StrategyTradeLedger, TradingView } from "./tradingview.js";
import {
  MAX_MTF_SYMBOLS,
  MTF_TIMEFRAMES,
  SCAN_OPERATIONS,
  type Scanner,
} from "./scanner.js";
import { IMPORTANCE_LEVELS, type EconomicCalendar } from "./calendar.js";
import { cotFreshness, type CotClient } from "./cot.js";
import type { TreasuryRealYieldClient } from "./realYield.js";
import { compareIndicatorObservations } from "./indicatorAudit.js";
import { computeRoundTripCost } from "./costModel.js";
import { computePositionSize } from "./positionSize.js";
import { auditPineSource } from "./pineAudit.js";
import { validateResearchProtocol } from "./researchProtocol.js";
import { buildAnalysisAlertPlans, matchExistingAnalysisAlerts } from "./analysisAlerts.js";
import { validateTradePlan } from "./tradePlan.js";
import { buildMarketSnapshot } from "./marketSnapshot.js";
import { buildTradeDecisionContext } from "./tradeDecisionContext.js";
import { buildExecutionSnapshot } from "./executionSnapshot.js";
import { selectDueAnalyses, type JournalAnalysisRecord } from "./dueAnalyses.js";
import { buildAnalysisPerformance } from "./analysisPerformance.js";
import {
  compareStrategyConditions,
  compareStrategyMetrics,
  summarizeStrategyEvidence,
} from "./strategyExperiment.js";
import type { StrategyResearchJournalStore } from "./strategyResearchJournal.js";
import {
  evaluateStrategyWalkForward,
  validateStrategyWalkForwardFolds,
  type StrategyWalkForwardFold,
} from "./strategyWalkForward.js";
import {
  evaluateStrategyRerunStress,
  evaluateStrategyStress,
  type StrategyStressScenario,
} from "./strategyStress.js";
import { runSessionAuctionStudy } from "./sessionAuctionStudy.js";
import { runSessionExhaustionHandoffStudy } from "./sessionHandoffStudy.js";
import { runEventAftershockRetestStudy } from "./eventAftershockRetestStudy.js";
import { runYieldPriceNonconfirmationStudy } from "./yieldPriceNonconfirmation.js";
import { computeFeatureOutcomeRelationships } from "./featureOutcomeRelationships.js";
import { computeFuturesFlowContext, futuresFlowMapping } from "./futuresFlowContext.js";
import { computeSessionProfile, validateSessionClockDefinitions } from "./sessionProfile.js";
import { computeMarketRegimes, MAX_MARKET_REGIME_OBSERVATIONS } from "./marketRegimes.js";
import { evaluateStrategyByRegime } from "./strategyRegimeEvaluation.js";
import { assertChartState, changeChartState, withTemporaryChartState } from "./chartTransaction.js";
import { redactSecrets } from "./redact.js";
import {
  ANALYSIS_OVERLAY_INPUTS,
  ANALYSIS_OVERLAY_LEGACY_INPUTS,
  ANALYSIS_OVERLAY_DEFAULT_ANALYSIS_ID,
  ANALYSIS_OVERLAY_DEFAULT_ANALYZED_AT,
  ANALYSIS_OVERLAY_NAME,
  ANALYSIS_OVERLAY_SOURCE,
  ANALYSIS_OVERLAY_VERSION,
  assertAnalysisOverlayStudy,
  assertLegacyAnalysisOverlayStudy,
  buildAnalysisOverlayInputs,
  compareAnalysisOverlayBinding,
  computeAnalysisOverlayPriceStatus,
  parseAnalysisOverlayState,
  normalizeResolution,
  resolveAnalysisChart,
  validateAnalysisPayload,
} from "./analysisOverlay.js";
import { computeAnalysisPathMetrics, evaluateAnalysisOverlayOutcome } from "./analysisOutcome.js";
import {
  AnalysisDefinitionConflictError,
  analysisDefinitionHash,
  type AnalysisJournalDefinition,
  type AnalysisJournalStore,
} from "./analysisJournal.js";

/** Injectable dependencies so the server can be tested without a live app. */
export interface ServerDeps {
  cdp: Pick<CdpClient, "screenshot">;
  tv: Pick<
    TradingView,
    | "getChartContext"
    | "getReplayStatus"
    | "startReplay"
    | "stepReplay"
    | "stopReplay"
    | "getExecutionQuotes"
    | "getOhlcv"
    | "getIndicatorValues"
    | "getIndicatorInputs"
    | "setIndicatorInput"
    | "getIndicatorGraphics"
    | "getIndicatorTables"
    | "loadMoreHistory"
    | "listPineScripts"
    | "getPineSource"
    | "savePineScript"
    | "addPineToChart"
    | "removePineFromChart"
    | "getStrategyReport"
    | "getStrategyTradeLedger"
    | "runBacktest"
    | "listAlerts"
    | "createPriceAlert"
    | "getWatchlists"
    | "getChartRect"
    | "getKeyLevels"
    | "setSymbol"
    | "setResolution"
  >;
  scanner: Pick<Scanner, "getQuotes" | "scanMarket" | "getMtfOverview">;
  calendar: Pick<EconomicCalendar, "getEvents">;
  cot: Pick<CotClient, "getLatest" | "getHistory">;
  realYield: Pick<TreasuryRealYieldClient, "getLatest" | "getAsOf">;
  journal: Pick<AnalysisJournalStore, "recordAnalysis" | "recordOutcome" | "recordAlertSet" | "list" | "calibration">;
  researchJournal: Pick<StrategyResearchJournalStore, "registerHypothesis" | "recordExperiment" | "compare">;
}

const FIELD_SCHEMA = z.string().regex(/^[\w.|]{1,64}$/);
const SYMBOL_SCHEMA = z.string().regex(/^[\w!.:&-]{1,48}$/);
const STRATEGY_SESSION_SCHEMA = z.object({
  session_id: z.string().regex(/^[\w.:-]{1,80}$/),
  timezone: z.string().min(1).max(64),
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});
const SESSION_MATCH_POLICY_SCHEMA = z.enum(["all_matches_non_exclusive", "first_match_exclusive"]);
const CANONICAL_ISO_TIMESTAMP_SCHEMA = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  }, "must be a canonical ISO timestamp");
const RESEARCH_POPULATION_SCHEMA = z.enum(["in_sample", "out_of_sample", "walk_forward", "stress", "live"]);
const RESEARCH_METRICS_SCHEMA = z.record(z.string().min(1).max(64), z.number().nullable());
const REAL_YIELD_OUTPUT_SCHEMA = {
  schema_version: z.literal("1.1"),
  status: z.enum(["partial", "unavailable"]),
  series: z.literal("US_TREASURY_PAR_REAL_CMT_10Y"),
  observation_date: z.string().nullable(),
  value: z.number().nullable(),
  value_status: z.enum(["valid", "missing", "invalid", "out_of_range", "future_date", "unavailable"]),
  unit: z.literal("percent_per_annum_bond_equivalent"),
  source: z.literal("us_treasury"),
  source_url: z.string(),
  observed_at: z.string().nullable(),
  source_at: z.null(),
  available_at: z.string().nullable(),
  available_at_basis: z.enum(["local_first_seen", "unavailable"]),
  first_seen_at: z.string().nullable(),
  source_updated_at_raw: z.string().nullable(),
  latency_class: z.literal("end_of_day"),
  revision_status: z.enum(["unknown", "first_seen_tracked"]),
  freshness_weekdays: z.number().int().nonnegative().nullable(),
  freshness_status: z.enum(["fresh", "stale", "unavailable"]),
  point_in_time_status: z.enum(["blocked", "observed_first_seen"]),
  as_of: z.string().nullable(),
  quality_issues: z.array(z.string()),
  cache_status: z.enum(["hit", "miss", "not_applicable"]),
  source_error: z.string().nullable(),
};

type SnapshotStatus = "ok" | "partial" | "blocked";

class SerialOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function journalDefinition(
  analysis: ReturnType<typeof parseAnalysisOverlayState>,
  placement: {
    symbol: string;
    timeframe: string;
    chartIndex: number;
    studyId: string;
    pineId?: string | null;
    pineVersion?: string | null;
  },
): AnalysisJournalDefinition {
  return {
    ...analysis,
    symbol: placement.symbol.toUpperCase(),
    timeframe: normalizeResolution(placement.timeframe),
    chartIndex: placement.chartIndex,
    studyId: placement.studyId,
    pineId: placement.pineId ?? null,
    pineVersion: placement.pineVersion ?? null,
  };
}
type AlignedHistoryIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  chart_indexes?: number[];
};

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function structuredJsonResult(value: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorResult(err: unknown): ToolResult {
  const raw = err instanceof Error ? err.message : String(err);
  // Last line of defense: whatever the layers below let through, no
  // credential/query/token material may reach the MCP client. Details go
  // to the local log (stderr) instead, also redacted.
  const message = redactSecrets(raw);
  if (message !== raw) {
    const detail = err instanceof Error ? err.stack ?? raw : raw;
    console.error(`[tradingview-mcp] tool error (redacted for client): ${redactSecrets(detail)}`);
  }
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

function alignedHistoryStatus(issues: AlignedHistoryIssue[]): SnapshotStatus {
  if (issues.some((issue) => issue.severity === "error")) return "blocked";
  if (issues.length > 0) return "partial";
  return "ok";
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] - leftMean;
    const b = right[i] - rightMean;
    numerator += a * b;
    leftSum += a * a;
    rightSum += b * b;
  }
  const denominator = Math.sqrt(leftSum * rightSum);
  return denominator === 0 ? null : numerator / denominator;
}

export function createServer({ cdp, tv, scanner, calendar, cot, realYield, journal, researchJournal }: ServerDeps): McpServer {
  const chartOperations = new SerialOperationQueue();
  const server = new McpServer({
    name: "tradingview-mcp",
    version: "0.1.0",
  });

  type ExperimentVariant = {
    pineId: string;
    inputs: Array<{ id: string; value: string | number | boolean }>;
  };

  const chartFingerprint = (context: Awaited<ReturnType<typeof tv.getChartContext>>) => {
    const chart = context.charts.find((item) => item.index === context.activeChartIndex);
    if (!chart) throw new Error("active chart is missing from chart context");
    return {
      index: chart.index,
      symbol: chart.symbol,
      timeframe: chart.resolution,
      studies: [...chart.studies]
        .map((study) => ({ id: study.id, name: study.name }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
  };

  const collectExperimentVariant = async (
    variant: ExperimentVariant,
    expectedVersion: string,
    expectedChart?: { symbol: string; timeframe: string },
  ): Promise<{
    evidence: { report: StrategyReport; ledger: StrategyTradeLedger } | null;
    error: string | null;
    cleanupError: string | null;
  }> => {
    let studyId: string | null = null;
    let evidence: { report: StrategyReport; ledger: StrategyTradeLedger } | null = null;
    let error: string | null = null;
    let cleanupError: string | null = null;
    try {
      const started = await tv.runBacktest({
        pineId: variant.pineId,
        tradesLimit: 1,
        keepOnChart: true,
      });
      studyId = started.studyId;
      if (!studyId) throw new Error("temporary strategy did not return its study id");
      if (variant.inputs.length > 0) {
        const applied = await tv.setIndicatorInput(studyId, variant.inputs);
        if (applied.settled === false) {
          throw new Error(applied.warning ?? "strategy input recalculation did not settle");
        }
        const appliedById = new Map(applied.applied.map((input) => [input.id, input.value]));
        for (const requested of variant.inputs) {
          if (!appliedById.has(requested.id) || !Object.is(appliedById.get(requested.id), requested.value)) {
            throw new Error(`strategy input ${requested.id} did not match its requested value after apply`);
          }
        }
      }
      const report = await tv.getStrategyReport({ tradesLimit: 1 });
      const first = await tv.getStrategyTradeLedger({ offset: 0, limit: 500 });
      const trades = [...first.trades];
      let nextOffset = first.nextOffset;
      while (nextOffset !== null) {
        const page = await tv.getStrategyTradeLedger({
          offset: nextOffset,
          limit: 500,
          expectedLedgerId: first.ledgerId,
        });
        trades.push(...page.trades);
        nextOffset = page.nextOffset;
      }
      const ledger: StrategyTradeLedger = {
        ...first,
        offset: 0,
        limit: trades.length,
        returned: trades.length,
        nextOffset: null,
        complete: true,
        trades,
      };
      if (ledger.pineId !== variant.pineId) {
        throw new Error(`active strategy attribution changed: expected ${variant.pineId}, found ${ledger.pineId}`);
      }
      if (ledger.pineVersion !== expectedVersion) {
        throw new Error(
          `strategy version changed during experiment: expected ${expectedVersion}, found ${ledger.pineVersion}`,
        );
      }
      if (expectedChart && !ledger.symbol) {
        throw new Error(`strategy ledger symbol is unavailable; expected ${expectedChart.symbol}`);
      }
      if (expectedChart && ledger.symbol!.toUpperCase() !== expectedChart.symbol.toUpperCase()) {
        throw new Error(
          `strategy ledger symbol changed: expected ${expectedChart.symbol}, found ${ledger.symbol}`,
        );
      }
      if (expectedChart && !ledger.timeframe) {
        throw new Error(`strategy ledger timeframe is unavailable; expected ${expectedChart.timeframe}`);
      }
      if (expectedChart &&
        normalizeResolution(ledger.timeframe!) !== normalizeResolution(expectedChart.timeframe)) {
        throw new Error(
          `strategy ledger timeframe changed: expected ${expectedChart.timeframe}, found ${ledger.timeframe}`,
        );
      }
      evidence = { report, ledger };
    } catch (err) {
      error = redactSecrets(err instanceof Error ? err.message : String(err));
    } finally {
      if (studyId) {
        try {
          await tv.removePineFromChart(variant.pineId, studyId);
        } catch (err) {
          cleanupError = redactSecrets(err instanceof Error ? err.message : String(err));
        }
      }
    }
    return { evidence, error, cleanupError };
  };

  server.registerTool(
    "get_chart_screenshot",
    {
      description:
        "Capture a screenshot of the TradingView desktop app for visual analysis. By " +
        "default the whole window (all charts, drawings, watchlist); pass chart_index to " +
        "capture just one chart of a multi-chart layout at full resolution.",
      inputSchema: {
        format: z
          .enum(["png", "jpeg"])
          .optional()
          .describe("Image format. jpeg is smaller; png is sharper. Default: jpeg"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Capture only this chart (index from get_chart_context). Default: whole window"),
      },
    },
    async ({ format, chart_index }) =>
      chartOperations.run(async () => {
        try {
        const fmt = format ?? "jpeg";
        let clip;
        if (chart_index !== undefined) {
          const r = await tv.getChartRect(chart_index);
          clip = {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            scale: r.devicePixelRatio,
          };
        }
        const data = await cdp.screenshot(fmt, undefined, clip);
        return {
          content: [{ type: "image" as const, data, mimeType: `image/${fmt}` }],
        };
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_chart_context",
    {
      description:
        "Get the current TradingView layout state: every chart's symbol, timeframe and " +
        "active indicators as {id, name} (the id is what get_indicator_* tools accept as " +
        "study_id), plus which chart is active. Call this first to know what the user is " +
        "looking at.",
      inputSchema: {},
    },
    async () =>
      chartOperations.run(async () => {
        try {
          return jsonResult(await tv.getChartContext());
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_replay_status",
    {
      description:
        "Read the current TradingView Bar Replay state, active chart binding, historical " +
        "cursor time, and replay resolution. This is read-only and never starts, advances, " +
        "or stops replay trading.",
      inputSchema: {},
    },
    async () => chartOperations.run(async () => {
      try {
        return jsonResult(await tv.getReplayStatus());
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "start_chart_replay",
    {
      description:
        "Preview or start TradingView Bar Replay on the active chart at one historical " +
        "instant. expected_symbol and expected_timeframe are checked immediately before " +
        "the write. confirm=true is required. Replay Trading orders and autoplay are never used.",
      inputSchema: {
        start_at: z.string().datetime({ offset: true }),
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/),
        confirm: z.boolean().optional().describe("Must be true to enter Bar Replay. Default: false"),
      },
    },
    async ({ start_at, expected_symbol, expected_timeframe, confirm }) =>
      chartOperations.run(async () => {
        try {
          const startMs = Date.parse(start_at);
          if (startMs >= Date.now()) throw new Error("start_at must be in the past");
          const [status, context] = await Promise.all([tv.getReplayStatus(), tv.getChartContext()]);
          const activeIndex = context.activeChartIndex;
          const activeChart = activeIndex === null
            ? undefined
            : context.charts.find((chart) => chart.index === activeIndex);
          if (!activeChart) throw new Error("no active chart is available for Bar Replay");
          if (activeChart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
            throw new Error(`active chart symbol ${activeChart.symbol} does not match expected_symbol ${expected_symbol}`);
          }
          if (normalizeResolution(activeChart.resolution) !== normalizeResolution(expected_timeframe)) {
            throw new Error(
              `active chart timeframe ${activeChart.resolution} does not match expected_timeframe ${expected_timeframe}`,
            );
          }
          if (!status.available) throw new Error("Bar Replay is unavailable for the active chart");
          if (status.started || status.toolbarVisible) {
            throw new Error("Bar Replay is already active; stop it before starting another session");
          }
          const preview = {
            action: "start_chart_replay",
            startAt: new Date(startMs).toISOString(),
            activeChart: { index: activeIndex, symbol: activeChart.symbol, resolution: activeChart.resolution },
            effects: [
              "The chart display moves to historical data and remains there until replay is stopped.",
              "Server-side alerts, trading orders, and quote lists remain tied to real-time data.",
            ],
            excludedCapabilities: ["autoplay", "buy", "sell", "close_position", "replay_trading"],
          };
          if (confirm !== true) return jsonResult({ dryRun: true, preview });
          return jsonResult({
            dryRun: false,
            preview,
            result: await tv.startReplay({
              startAt: start_at,
              expectedSymbol: expected_symbol,
              expectedResolution: expected_timeframe,
            }),
          });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "step_chart_replay",
    {
      description:
        "Advance an already started, paused TradingView Bar Replay by 1-100 bars. Each " +
        "step is read back and must advance the replay cursor. Autoplay and Replay Trading " +
        "orders are not supported.",
      inputSchema: {
        steps: z.number().int().min(1).max(100).optional().describe("Bars to advance. Default: 1"),
      },
    },
    async ({ steps }) => chartOperations.run(async () => {
      try {
        return jsonResult(await tv.stepReplay(steps ?? 1));
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "stop_chart_replay",
    {
      description:
        "Preview or stop TradingView Bar Replay and return the chart to real-time mode. " +
        "confirm=true is required when replay or its toolbar is active.",
      inputSchema: {
        confirm: z.boolean().optional().describe("Must be true to leave Bar Replay. Default: false"),
      },
    },
    async ({ confirm }) => chartOperations.run(async () => {
      try {
        const status = await tv.getReplayStatus();
        const preview = {
          action: "stop_chart_replay",
          active: status.started || status.toolbarVisible,
          currentTime: status.currentTimeIso,
          activeChart: status.activeChart,
        };
        if (confirm !== true) return jsonResult({ dryRun: true, preview });
        return jsonResult({ dryRun: false, preview, result: await tv.stopReplay() });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "get_ohlcv",
    {
      description:
        "Get OHLCV candle data (time, open, high, low, close, volume) currently loaded in a " +
        "TradingView chart. Time is a unix timestamp in seconds.",
      inputSchema: {
        count: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe("Number of most recent bars to return. Default: 100"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
      },
    },
    async ({ count, chart_index }) =>
      chartOperations.run(async () => {
        try {
          return jsonResult(await tv.getOhlcv(count ?? 100, chart_index));
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "run_market_event_study",
    {
      description:
        "Run a bounded, read-only market event study on closed OHLC bars from the active chart. " +
        "Condition session_auction classifies the first break of a prior local-session range as accepted " +
        "outside closes or a failed return inside. Condition session_exhaustion_handoff tests whether a " +
        "closed-bar prior-session direction fails to extend in an early handoff session and reverses. " +
        "Condition event_aftershock_retest evaluates caller-supplied, canonical economic-event timestamps " +
        "through a post-event initial range, close breakout, and first boundary retest. " +
        "It returns directional forward returns, MFE, MAE, target timing, explicit exclusions, and " +
        "optional non-overlapping time folds with bounded mean and rate confidence intervals. The caller " +
        "can declare the number of configurations inspected; serial dependence and multiple testing are " +
        "not silently adjusted. An optional regime split joins each event only to a price/volatility label " +
        "whose bar closed before the signal bar began, and keeps sparse cells not evaluable. Signal-bar " +
        "close is an event reference, not an assumed fill. " +
        "It never ranks parameters, changes the chart, or places orders.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^[1-9]\d*$/),
        count: z.number().int().min(100).max(5000).optional()
          .describe("Most recent loaded bars to inspect. Default: 5000"),
        condition: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("session_auction"),
            timezone: z.string().min(1).max(64),
            range_start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            range_end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            auction_end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            acceptance_closes: z.number().int().min(1).max(4).optional(),
            failure_within_bars: z.number().int().min(0).max(4).optional(),
            minimum_range_coverage: z.number().finite().gt(0).max(1).optional(),
          }),
          z.object({
            type: z.literal("session_exhaustion_handoff"),
            timezone: z.string().min(1).max(64),
            prior_sessions: z.array(z.object({
              session_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/),
              start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
              end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            })).min(1).max(4),
            handoff_start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            handoff_end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            prior_direction: z.enum(["range_break", "session_return", "close_location"]),
            direction_minimum_return_bps: z.number().finite().min(0).max(10_000).optional(),
            close_location_threshold: z.number().finite().min(0.5).lt(1).optional(),
            handoff_window_bars: z.number().int().min(1).max(24).optional(),
            forward_update_threshold_bps: z.number().finite().min(0).max(10_000).optional(),
            require_range_reentry: z.boolean().optional(),
            require_opposite_body: z.boolean().optional(),
            minimum_prior_coverage: z.number().finite().gt(0).max(1).optional(),
          }),
          z.object({
            type: z.literal("event_aftershock_retest"),
            events: z.array(z.object({
              event_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),
              occurred_at: CANONICAL_ISO_TIMESTAMP_SCHEMA,
            })).min(1).max(200),
            initial_range_bars: z.number().int().min(1).max(24).optional(),
            breakout_within_bars: z.number().int().min(1).max(96).optional(),
            retest_within_bars: z.number().int().min(1).max(96).optional(),
            require_retest_close_outside: z.boolean().optional(),
            minimum_initial_range_coverage: z.number().finite().gt(0).max(1).optional(),
          }),
        ]),
        horizons: z.array(z.number().int().min(1).max(96)).min(1).max(8),
        target_return_bps: z.number().finite().gt(0).max(1000),
        minimum_events: z.number().int().min(1).max(5000),
        confidence_level: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.99)]).optional()
          .describe("Confidence level for normal-approximation mean and Wilson rate intervals. Default: 0.95"),
        configuration_trials: z.number().int().min(1).max(100_000).optional()
          .describe("Total related parameter/configuration trials inspected so far, including this one"),
        regime: z.object({
          trend_lookback: z.number().int().min(2).max(500).optional(),
          atr_lookback: z.number().int().min(2).max(250).optional(),
          volatility_baseline_lookback: z.number().int().min(5).max(1000).optional(),
          trend_efficiency_threshold: z.number().finite().min(0).max(1).optional(),
          range_efficiency_threshold: z.number().finite().min(0).max(1).optional(),
          directional_move_atr_threshold: z.number().finite().gt(0).max(100).optional(),
          high_volatility_ratio: z.number().finite().gt(1).max(100).optional(),
          low_volatility_ratio: z.number().finite().gt(0).lt(1).optional(),
          minimum_classified_bars: z.number().int().min(1).max(5000).optional(),
          minimum_group_events: z.number().int().min(1).max(5000).optional(),
          minimum_coverage_ratio: z.number().finite().gt(0).max(1).optional(),
          max_regime_age_bars: z.number().int().min(0).max(100).optional(),
        }).nullable().optional()
          .describe("Optional point-in-time price/volatility regime split using only bars closed before each signal bar"),
        folds: z.array(z.object({
          fold_id: z.string().regex(/^[\w.:-]{1,80}$/),
          from: CANONICAL_ISO_TIMESTAMP_SCHEMA,
          to: CANONICAL_ISO_TIMESTAMP_SCHEMA,
        })).max(12).optional(),
        event_limit: z.number().int().min(0).max(200).optional()
          .describe("Maximum per-event rows to return. Aggregate metrics always use all events. Default: 50"),
      },
    },
    async ({ expected_symbol, expected_timeframe, count, condition, horizons, target_return_bps,
      minimum_events, confidence_level, configuration_trials, regime, folds, event_limit }) =>
      chartOperations.run(async () => {
      try {
        const context = await tv.getChartContext();
        const activeIndex = context.activeChartIndex ?? 0;
        const chart = context.charts.find((item) => item.index === activeIndex);
        if (!chart) throw new Error(`active chart ${activeIndex} not found`);
        if (chart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
          throw new Error(`active chart symbol changed: expected ${expected_symbol}, found ${chart.symbol}`);
        }
        if (normalizeResolution(chart.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error(`active chart timeframe changed: expected ${expected_timeframe}, found ${chart.resolution}`);
        }
        const replay = await tv.getReplayStatus();
        if (replay.started || replay.toolbarVisible) throw new Error("market event study is blocked while Bar Replay is active");
        const history = await tv.getOhlcv(count ?? 5000, activeIndex);
        if (history.symbol.toUpperCase() !== expected_symbol.toUpperCase() ||
            normalizeResolution(history.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error("OHLC evidence does not match the bound chart");
        }
        const common = {
          bars: history.bars,
          symbol: history.symbol,
          timeframe: history.resolution,
          horizons,
          targetReturnBps: target_return_bps,
          minimumEvents: minimum_events,
          confidenceLevel: confidence_level ?? 0.95,
          configurationTrials: configuration_trials ?? null,
          regime: regime === null || regime === undefined ? null : {
            trendLookback: regime.trend_lookback ?? 20,
            atrLookback: regime.atr_lookback ?? 14,
            volatilityBaselineLookback: regime.volatility_baseline_lookback ?? 50,
            trendEfficiencyThreshold: regime.trend_efficiency_threshold ?? 0.6,
            rangeEfficiencyThreshold: regime.range_efficiency_threshold ?? 0.25,
            directionalMoveAtrThreshold: regime.directional_move_atr_threshold ?? 2,
            highVolatilityRatio: regime.high_volatility_ratio ?? 1.5,
            lowVolatilityRatio: regime.low_volatility_ratio ?? 0.75,
            minimumClassifiedBars: regime.minimum_classified_bars ?? 100,
            minimumGroupEvents: regime.minimum_group_events ?? 10,
            minimumCoverageRatio: regime.minimum_coverage_ratio ?? 0.8,
            maxRegimeAgeBars: regime.max_regime_age_bars ?? 3,
          },
          folds: (folds ?? []).map((fold) => ({ foldId: fold.fold_id, from: fold.from, to: fold.to })),
          eventLimit: event_limit ?? 50,
        };
        const result = condition.type === "session_auction"
          ? runSessionAuctionStudy({
            ...common, timezone: condition.timezone, rangeStart: condition.range_start, rangeEnd: condition.range_end,
            auctionEnd: condition.auction_end, acceptanceCloses: condition.acceptance_closes ?? 2,
            failureWithinBars: condition.failure_within_bars ?? 2, minimumRangeCoverage: condition.minimum_range_coverage ?? 0.8,
          })
          : condition.type === "session_exhaustion_handoff"
          ? runSessionExhaustionHandoffStudy({
            ...common, timezone: condition.timezone,
            priorSessions: condition.prior_sessions.map((session) => ({ sessionId: session.session_id, start: session.start, end: session.end })),
            handoffStart: condition.handoff_start, handoffEnd: condition.handoff_end, priorDirection: condition.prior_direction,
            directionMinimumReturnBps: condition.direction_minimum_return_bps ?? 0,
            closeLocationThreshold: condition.close_location_threshold ?? 0.75,
            handoffWindowBars: condition.handoff_window_bars ?? 3,
            forwardUpdateThresholdBps: condition.forward_update_threshold_bps ?? 0,
            requireRangeReentry: condition.require_range_reentry ?? true,
            requireOppositeBody: condition.require_opposite_body ?? true,
            minimumPriorCoverage: condition.minimum_prior_coverage ?? 0.8,
          })
          : runEventAftershockRetestStudy({
            ...common,
            events: condition.events.map((event) => ({ eventId: event.event_id, occurredAt: event.occurred_at })),
            initialRangeBars: condition.initial_range_bars ?? 4,
            breakoutWithinBars: condition.breakout_within_bars ?? 16,
            retestWithinBars: condition.retest_within_bars ?? 16,
            requireRetestCloseOutside: condition.require_retest_close_outside ?? true,
            minimumInitialRangeCoverage: condition.minimum_initial_range_coverage ?? 1,
          });
        return jsonResult({
          ...result,
          conditionType: condition.type,
          source: {
            chartIndex: activeIndex,
            requestedBars: count ?? 5000,
            returnedBars: history.bars.length,
            from: history.bars[0]?.timeIso ?? null,
            to: history.bars.at(-1)?.timeIso ?? null,
          },
          limitations: [
            "This is an event study, not a fill, execution, or profitability simulation.",
            "Loaded chart history can be shorter than the requested count and differs by TradingView plan.",
            "MFE and MAE use bar extremes; intrabar ordering is unknown.",
            "Confidence intervals use asymptotic formulas and do not adjust for serial dependence or multiple testing.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "run_yield_price_nonconfirmation_study",
    {
      description:
        "Run a bounded, read-only cross-asset event study over two exact TradingView charts. " +
        "A driver impulse becomes usable only after its nominal bar close; the study then tests whether " +
        "the target fails to break in the expected direction and confirms an opposite structural close. " +
        "It uses an as-of join without forward-fill and returns forward return, MFE, MAE, target timing, " +
        "fold results, and explicit exclusions. Signal-bar close is an event reference, not an assumed fill. " +
        "It never changes charts, ranks parameters, or places orders.",
      inputSchema: {
        target_chart_index: z.number().int().min(0),
        driver_chart_index: z.number().int().min(0),
        expected_target_symbol: SYMBOL_SCHEMA,
        expected_driver_symbol: SYMBOL_SCHEMA,
        expected_target_timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDW]|[SDW])$/i),
        expected_driver_timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDW]|[SDW])$/i),
        count: z.number().int().min(100).max(5000).optional()
          .describe("Most recent loaded bars to inspect on each chart. Default: 5000"),
        relationship: z.enum(["direct", "inverse"]),
        driver_lookback: z.number().int().min(1).max(250),
        driver_change_threshold: z.number().finite().gt(0),
        price_breakout_lookback: z.number().int().min(2).max(500),
        nonconfirmation_bars: z.number().int().min(1).max(20),
        trigger_lookback: z.number().int().min(1).max(100),
        trigger_within_bars: z.number().int().min(1).max(20),
        max_driver_age_bars: z.number().int().min(0).max(20),
        horizons: z.array(z.number().int().min(1).max(250)).min(1).max(8),
        target_return_bps: z.number().finite().gt(0).max(10_000),
        minimum_events: z.number().int().min(1).max(5000),
        folds: z.array(z.object({
          fold_id: z.string().regex(/^[\w.:-]{1,80}$/),
          from: CANONICAL_ISO_TIMESTAMP_SCHEMA,
          to: CANONICAL_ISO_TIMESTAMP_SCHEMA,
        })).max(12).optional(),
        event_limit: z.number().int().min(0).max(200).optional()
          .describe("Maximum per-event rows to return. Aggregate metrics always use all events. Default: 50"),
      },
    },
    async ({ target_chart_index, driver_chart_index, expected_target_symbol, expected_driver_symbol,
      expected_target_timeframe, expected_driver_timeframe, count, relationship, driver_lookback,
      driver_change_threshold, price_breakout_lookback, nonconfirmation_bars, trigger_lookback,
      trigger_within_bars, max_driver_age_bars, horizons, target_return_bps, minimum_events, folds,
      event_limit }) => chartOperations.run(async () => {
      try {
        if (target_chart_index === driver_chart_index) {
          throw new Error("target and driver must use different chart indexes");
        }
        const context = await tv.getChartContext();
        const targetChart = context.charts.find((chart) => chart.index === target_chart_index);
        const driverChart = context.charts.find((chart) => chart.index === driver_chart_index);
        if (!targetChart) throw new Error(`target chart ${target_chart_index} not found`);
        if (!driverChart) throw new Error(`driver chart ${driver_chart_index} not found`);
        if (targetChart.symbol.toUpperCase() !== expected_target_symbol.toUpperCase() ||
            normalizeResolution(targetChart.resolution) !== normalizeResolution(expected_target_timeframe)) {
          throw new Error("target chart does not match the expected symbol and timeframe");
        }
        if (driverChart.symbol.toUpperCase() !== expected_driver_symbol.toUpperCase() ||
            normalizeResolution(driverChart.resolution) !== normalizeResolution(expected_driver_timeframe)) {
          throw new Error("driver chart does not match the expected symbol and timeframe");
        }
        const replay = await tv.getReplayStatus();
        if (replay.started || replay.toolbarVisible) {
          throw new Error("yield-price nonconfirmation study is blocked while Bar Replay is active");
        }
        const requestedBars = count ?? 5000;
        const [targetHistory, driverHistory] = await Promise.all([
          tv.getOhlcv(requestedBars, target_chart_index),
          tv.getOhlcv(requestedBars, driver_chart_index),
        ]);
        if (targetHistory.symbol.toUpperCase() !== expected_target_symbol.toUpperCase() ||
            normalizeResolution(targetHistory.resolution) !== normalizeResolution(expected_target_timeframe)) {
          throw new Error("target OHLC evidence does not match the bound chart");
        }
        if (driverHistory.symbol.toUpperCase() !== expected_driver_symbol.toUpperCase() ||
            normalizeResolution(driverHistory.resolution) !== normalizeResolution(expected_driver_timeframe)) {
          throw new Error("driver OHLC evidence does not match the bound chart");
        }
        const result = runYieldPriceNonconfirmationStudy({
          targetBars: targetHistory.bars,
          driverBars: driverHistory.bars,
          targetSymbol: targetHistory.symbol,
          driverSymbol: driverHistory.symbol,
          targetTimeframe: targetHistory.resolution,
          driverTimeframe: driverHistory.resolution,
          relationship,
          driverLookback: driver_lookback,
          driverChangeThreshold: driver_change_threshold,
          priceBreakoutLookback: price_breakout_lookback,
          nonconfirmationBars: nonconfirmation_bars,
          triggerLookback: trigger_lookback,
          triggerWithinBars: trigger_within_bars,
          maxDriverAgeBars: max_driver_age_bars,
          horizons,
          targetReturnBps: target_return_bps,
          minimumEvents: minimum_events,
          folds: (folds ?? []).map((fold) => ({ foldId: fold.fold_id, from: fold.from, to: fold.to })),
          eventLimit: event_limit ?? 50,
        });
        return jsonResult({
          ...result,
          source: {
            requestedBars,
            target: {
              chartIndex: target_chart_index,
              returnedBars: targetHistory.bars.length,
              from: targetHistory.bars[0]?.timeIso ?? null,
              to: targetHistory.bars.at(-1)?.timeIso ?? null,
            },
            driver: {
              chartIndex: driver_chart_index,
              returnedBars: driverHistory.bars.length,
              from: driverHistory.bars[0]?.timeIso ?? null,
              to: driverHistory.bars.at(-1)?.timeIso ?? null,
            },
          },
          limitations: [
            "This is an event study, not a fill, execution, or profitability simulation.",
            "The relationship and thresholds are caller-specified and are not optimized by this tool.",
            "Bar availability uses nominal timeframe duration, not exchange publication metadata.",
            "Loaded chart history can be shorter than requested and differs by TradingView plan.",
            "MFE and MAE use bar extremes; intrabar ordering is unknown.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "compute_feature_outcome_relationships",
    {
      description:
        "Measure point-in-time relationships between selected closed-bar price features and later observed " +
        "returns on one exact TradingView chart. It classifies ATR compression, candle body direction, wick " +
        "imbalance, directional streaks, range position, and opening gaps using only the signal bar and prior " +
        "OHLC. It returns bucketed forward-return, upside, downside, and fold distributions without optimizing " +
        "thresholds, changing the chart, or making a trade recommendation.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDW]|[SDW])$/i),
        count: z.number().int().min(100).max(5000).optional()
          .describe("Most recent loaded bars to inspect. Default: 5000"),
        features: z.array(z.enum([
          "atr_compression", "body_direction", "wick_imbalance", "directional_streak", "range_position", "gap_direction",
        ])).min(1).max(6).optional()
          .describe("Point-in-time features to classify. Default: all six"),
        atr_lookback: z.number().int().min(2).max(250).optional(),
        atr_baseline_lookback: z.number().int().min(5).max(1000).optional(),
        range_lookback: z.number().int().min(2).max(500).optional(),
        streak_minimum_bars: z.number().int().min(1).max(100).optional(),
        body_ratio_threshold: z.number().finite().min(0).lt(1).optional(),
        wick_imbalance_threshold: z.number().finite().min(0).max(1).optional(),
        atr_compression_low_ratio: z.number().finite().gt(0).lt(1).optional(),
        atr_compression_high_ratio: z.number().finite().gt(1).optional(),
        range_position_lower: z.number().finite().gt(0).lt(0.5).optional(),
        range_position_upper: z.number().finite().gt(0.5).lt(1).optional(),
        gap_atr_threshold: z.number().finite().min(0).optional(),
        horizons: z.array(z.number().int().min(1).max(250)).min(1).max(8),
        minimum_observations: z.number().int().min(1).max(5000).optional(),
        folds: z.array(z.object({
          fold_id: z.string().regex(/^[\w.:-]{1,80}$/),
          from: CANONICAL_ISO_TIMESTAMP_SCHEMA,
          to: CANONICAL_ISO_TIMESTAMP_SCHEMA,
        })).max(12).optional(),
        observation_limit: z.number().int().min(0).max(500).optional()
          .describe("Maximum labelled observations to return. Aggregates always use all rows. Default: 100"),
      },
    },
    async ({ expected_symbol, expected_timeframe, count, features, atr_lookback, atr_baseline_lookback,
      range_lookback, streak_minimum_bars, body_ratio_threshold, wick_imbalance_threshold,
      atr_compression_low_ratio, atr_compression_high_ratio, range_position_lower, range_position_upper,
      gap_atr_threshold, horizons, minimum_observations, folds, observation_limit }) => chartOperations.run(async () => {
      try {
        const context = await tv.getChartContext();
        const activeIndex = context.activeChartIndex ?? 0;
        const chart = context.charts.find((item) => item.index === activeIndex);
        if (!chart) throw new Error(`active chart ${activeIndex} not found`);
        if (chart.symbol.toUpperCase() !== expected_symbol.toUpperCase() ||
            normalizeResolution(chart.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error("active chart does not match the expected symbol and timeframe");
        }
        const replay = await tv.getReplayStatus();
        if (replay.started || replay.toolbarVisible) {
          throw new Error("feature-outcome relationships are blocked while Bar Replay is active");
        }
        const requestedBars = count ?? 5000;
        const history = await tv.getOhlcv(requestedBars, activeIndex);
        if (history.symbol.toUpperCase() !== expected_symbol.toUpperCase() ||
            normalizeResolution(history.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error("OHLC evidence does not match the bound chart");
        }
        const result = computeFeatureOutcomeRelationships({
          bars: history.bars,
          symbol: history.symbol,
          timeframe: history.resolution,
          features: features ?? [
            "atr_compression", "body_direction", "wick_imbalance", "directional_streak", "range_position", "gap_direction",
          ],
          atrLookback: atr_lookback ?? 14,
          atrBaselineLookback: atr_baseline_lookback ?? 50,
          rangeLookback: range_lookback ?? 20,
          streakMinimumBars: streak_minimum_bars ?? 3,
          bodyRatioThreshold: body_ratio_threshold ?? 0.5,
          wickImbalanceThreshold: wick_imbalance_threshold ?? 0.2,
          atrCompressionLowRatio: atr_compression_low_ratio ?? 0.75,
          atrCompressionHighRatio: atr_compression_high_ratio ?? 1.5,
          rangePositionLower: range_position_lower ?? 0.33,
          rangePositionUpper: range_position_upper ?? 0.67,
          gapAtrThreshold: gap_atr_threshold ?? 0.25,
          horizons,
          minimumObservations: minimum_observations ?? 100,
          folds: (folds ?? []).map((fold) => ({ foldId: fold.fold_id, from: fold.from, to: fold.to })),
          observationLimit: observation_limit ?? 100,
        });
        return jsonResult({
          ...result,
          source: {
            chartIndex: activeIndex,
            requestedBars,
            returnedBars: history.bars.length,
            from: history.bars[0]?.timeIso ?? null,
            to: history.bars.at(-1)?.timeIso ?? null,
          },
          limitations: [
            "This is an observational event study, not a fill, execution, or profitability simulation.",
            "Feature thresholds are caller-specified constants and are not optimized or ranked by this tool.",
            "Associations do not establish causality or imply a trade direction.",
            "Loaded chart history can be shorter than requested and differs by TradingView plan.",
            "Upside and downside use bar extremes; intrabar ordering is unknown.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "compute_session_profile",
    {
      description:
        "Summarize deterministic session-day profiles from closed minute bars on one exact TradingView chart. " +
        "Sessions use caller-specified IANA timezones and support daylight-saving and cross-midnight boundaries. " +
        "The tool returns coverage, OHLC range, return, opening-range extension, high/low timing, prior closed-session " +
        "overlap, and TradingView bar volume clearly labelled as unverified tick-or-exchange volume. It does not " +
        "change the chart, optimize session definitions, or make a trade recommendation.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^[1-9]\d*$/)
          .describe("Exact active minute timeframe, such as 5, 15, or 60"),
        count: z.number().int().min(100).max(5000).optional()
          .describe("Most recent loaded bars to inspect. Default: 5000"),
        sessions: z.array(z.object({
          session_id: z.string().regex(/^[\w.:-]{1,80}$/),
          timezone: z.string().min(1).max(64),
          start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          minimum_coverage: z.number().finite().gt(0).max(1).optional(),
        })).min(1).max(8),
        opening_range_bars: z.number().int().min(1).max(100).optional()
          .describe("Bars from session start used for the opening range. Default: 3"),
        minimum_session_days: z.number().int().min(1).max(5000).optional()
          .describe("Minimum complete days required for each session. Default: 20"),
        observation_limit: z.number().int().min(0).max(500).optional()
          .describe("Maximum recent session observations returned. Aggregates use all rows. Default: 100"),
      },
    },
    async ({ expected_symbol, expected_timeframe, count, sessions, opening_range_bars,
      minimum_session_days, observation_limit }) => chartOperations.run(async () => {
      try {
        const context = await tv.getChartContext();
        const activeIndex = context.activeChartIndex ?? 0;
        const chart = context.charts.find((item) => item.index === activeIndex);
        if (!chart) throw new Error(`active chart ${activeIndex} not found`);
        if (chart.symbol.toUpperCase() !== expected_symbol.toUpperCase() ||
            normalizeResolution(chart.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error("active chart does not match the expected symbol and timeframe");
        }
        const replay = await tv.getReplayStatus();
        if (replay.started || replay.toolbarVisible) {
          throw new Error("session profile is blocked while Bar Replay is active");
        }
        const requestedBars = count ?? 5000;
        const history = await tv.getOhlcv(requestedBars, activeIndex);
        if (history.symbol.toUpperCase() !== expected_symbol.toUpperCase() ||
            normalizeResolution(history.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error("OHLC evidence does not match the bound chart");
        }
        const result = computeSessionProfile({
          bars: history.bars,
          symbol: history.symbol,
          timeframe: history.resolution,
          sessions: sessions.map((session) => ({
            sessionId: session.session_id,
            timezone: session.timezone,
            start: session.start,
            end: session.end,
            minimumCoverage: session.minimum_coverage ?? 0.8,
          })),
          openingRangeBars: opening_range_bars ?? 3,
          minimumSessionDays: minimum_session_days ?? 20,
          observationLimit: observation_limit ?? 100,
        });
        return jsonResult({
          ...result,
          source: {
            chartIndex: activeIndex,
            requestedBars,
            returnedBars: history.bars.length,
            from: history.bars[0]?.timeIso ?? null,
            to: history.bars.at(-1)?.timeIso ?? null,
          },
          limitations: [
            "This is a retrospective session description, not a forecast, fill, execution, or profitability simulation.",
            "TradingView bar volume can be tick volume or exchange volume depending on the symbol and is not independently verified.",
            "Sessions, coverage thresholds, and opening-range length are caller-specified and are not optimized by this tool.",
            "Weekday filtering uses the local session start date; exchange holidays are reported through incomplete coverage, not inferred.",
            "Loaded chart history can be shorter than requested and differs by TradingView plan.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "compute_market_regimes",
    {
      description:
        "Classify deterministic directional and volatility regimes from closed OHLC bars already loaded " +
        "on the active chart. Every label uses only that bar and earlier evidence: efficiency ratio and " +
        "ATR-normalized directional movement classify trend/range/transition, while current ATR relative " +
        "to a trailing ATR median classifies low/normal/high volatility. Thresholds are explicit and no " +
        "future-fitted quantiles, ranking, chart changes, or trade recommendations are used.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().min(1).max(16),
        count: z.number().int().min(100).max(5000).optional()
          .describe("Most recent loaded bars to inspect. Default: 1000"),
        trend_lookback: z.number().int().min(2).max(500).optional()
          .describe("Bars used for direction and efficiency ratio. Default: 20"),
        atr_lookback: z.number().int().min(2).max(250).optional()
          .describe("Bars used for point-in-time ATR. Default: 14"),
        volatility_baseline_lookback: z.number().int().min(5).max(1000).optional()
          .describe("Trailing ATR-percent observations used for the baseline median. Default: 50"),
        trend_efficiency_threshold: z.number().finite().min(0).max(1).optional()
          .describe("Minimum efficiency ratio for a trend candidate. Default: 0.6"),
        range_efficiency_threshold: z.number().finite().min(0).max(1).optional()
          .describe("Maximum efficiency ratio for a range candidate. Default: 0.25"),
        directional_move_atr_threshold: z.number().finite().gt(0).max(100).optional()
          .describe("Minimum absolute lookback move in current ATR units for trend. Default: 2"),
        high_volatility_ratio: z.number().finite().gt(1).max(100).optional()
          .describe("Current ATR-percent / trailing median ratio for high volatility. Default: 1.5"),
        low_volatility_ratio: z.number().finite().gt(0).lt(1).optional()
          .describe("Current ATR-percent / trailing median ratio for low volatility. Default: 0.75"),
        minimum_classified_bars: z.number().int().min(1).max(5000).optional()
          .describe("Classified observations required for complete status. Default: 100"),
        observation_limit: z.number().int().min(0).max(500).optional()
          .describe("Maximum recent classified rows returned; aggregates use all rows. Default: 100"),
      },
    },
    async ({ expected_symbol, expected_timeframe, count, trend_lookback, atr_lookback,
      volatility_baseline_lookback, trend_efficiency_threshold, range_efficiency_threshold,
      directional_move_atr_threshold, high_volatility_ratio, low_volatility_ratio,
      minimum_classified_bars, observation_limit }) => chartOperations.run(async () => {
      try {
        const context = await tv.getChartContext();
        const activeIndex = context.activeChartIndex ?? 0;
        const chart = context.charts.find((item) => item.index === activeIndex);
        if (!chart) throw new Error(`active chart ${activeIndex} not found`);
        if (chart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
          throw new Error(`active chart symbol changed: expected ${expected_symbol}, found ${chart.symbol}`);
        }
        if (normalizeResolution(chart.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error(`active chart timeframe changed: expected ${expected_timeframe}, found ${chart.resolution}`);
        }
        const replay = await tv.getReplayStatus();
        if (replay.started || replay.toolbarVisible) throw new Error("market regime classification is blocked while Bar Replay is active");
        const requestedBars = count ?? 1000;
        const history = await tv.getOhlcv(requestedBars, activeIndex);
        if (history.symbol.toUpperCase() !== expected_symbol.toUpperCase() ||
            normalizeResolution(history.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error("OHLC evidence does not match the bound chart");
        }
        const result = computeMarketRegimes({
          bars: history.bars,
          symbol: history.symbol,
          timeframe: history.resolution,
          trendLookback: trend_lookback ?? 20,
          atrLookback: atr_lookback ?? 14,
          volatilityBaselineLookback: volatility_baseline_lookback ?? 50,
          trendEfficiencyThreshold: trend_efficiency_threshold ?? 0.6,
          rangeEfficiencyThreshold: range_efficiency_threshold ?? 0.25,
          directionalMoveAtrThreshold: directional_move_atr_threshold ?? 2,
          highVolatilityRatio: high_volatility_ratio ?? 1.5,
          lowVolatilityRatio: low_volatility_ratio ?? 0.75,
          minimumClassifiedBars: minimum_classified_bars ?? 100,
          observationLimit: observation_limit ?? 100,
        });
        return jsonResult({
          ...result,
          source: {
            chartIndex: activeIndex,
            requestedBars,
            returnedBars: history.bars.length,
            from: history.bars[0]?.timeIso ?? null,
            to: history.bars.at(-1)?.timeIso ?? null,
          },
          limitations: [
            "Regime labels describe past price behavior and are not trade signals or forecasts.",
            "Thresholds are caller-specified constants; this tool does not optimize or rank them.",
            "Loaded chart history can be shorter than requested and differs by TradingView plan.",
            "Irregular timestamps are reported and never forward-filled.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "run_strategy_regime_analysis",
    {
      description:
        "Run one exact saved Pine Strategy temporarily, collect its complete immutable trade ledger, " +
        "and join each closed trade to the latest market-regime bar whose nominal close was available " +
        "by entry time. Returns PF, expectancy, win rate, closed-trade drawdown, run-up/drawdown, and " +
        "coverage by directional, volatility, and combined regime. Dry-run by default; confirm=true " +
        "is required. The strategy is removed and the original chart fingerprint is verified. It never " +
        "ranks regimes, changes the saved Pine source, or places orders.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i),
        pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
        pine_version: z.string().min(1).max(64),
        inputs: z.array(z.object({
          id: z.string().regex(/^[\w$]{1,64}$/),
          value: z.union([z.number(), z.string().max(256), z.boolean()]),
        })).max(20).optional(),
        count: z.number().int().min(100).max(MAX_MARKET_REGIME_OBSERVATIONS).optional()
          .describe("Most recent loaded bars used for regime evidence. Default: 20000"),
        trend_lookback: z.number().int().min(2).max(500).optional(),
        atr_lookback: z.number().int().min(2).max(250).optional(),
        volatility_baseline_lookback: z.number().int().min(5).max(1000).optional(),
        trend_efficiency_threshold: z.number().finite().min(0).max(1).optional(),
        range_efficiency_threshold: z.number().finite().min(0).max(1).optional(),
        directional_move_atr_threshold: z.number().finite().gt(0).max(100).optional(),
        high_volatility_ratio: z.number().finite().gt(1).max(100).optional(),
        low_volatility_ratio: z.number().finite().gt(0).lt(1).optional(),
        minimum_classified_bars: z.number().int().min(1).max(MAX_MARKET_REGIME_OBSERVATIONS).optional()
          .describe("Regime observations required before evaluation is complete. Default: 100"),
        minimum_group_trades: z.number().int().min(1).max(100_000).optional()
          .describe("Joined trades required for an individual regime group. Default: 30"),
        minimum_coverage_ratio: z.number().finite().gt(0).max(1).optional()
          .describe("Eligible closed trades that must join to a regime. Default: 0.8"),
        max_regime_age_bars: z.number().int().min(0).max(100).optional()
          .describe("Maximum age of the prior closed regime evidence. Default: 3 bars"),
        sessions: z.array(STRATEGY_SESSION_SCHEMA).min(1).max(8).optional()
          .describe("Optional DST-aware session windows used for entry-time grouping"),
        session_match_policy: SESSION_MATCH_POLICY_SCHEMA.optional()
          .describe("Session overlap handling. Default: all_matches_non_exclusive; exclusive uses input order"),
        confirm: z.boolean().optional()
          .describe("Must be true to add the strategy temporarily and run the analysis. Default: false"),
      },
    },
    async ({ expected_symbol, expected_timeframe, pine_id, pine_version, inputs, count,
      trend_lookback, atr_lookback, volatility_baseline_lookback, trend_efficiency_threshold,
      range_efficiency_threshold, directional_move_atr_threshold, high_volatility_ratio,
      low_volatility_ratio, minimum_classified_bars, minimum_group_trades, minimum_coverage_ratio,
      max_regime_age_bars, sessions, session_match_policy, confirm }) => chartOperations.run(async () => {
      try {
        const initialChart = chartFingerprint(await tv.getChartContext());
        if (initialChart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
          throw new Error(`active chart symbol changed: expected ${expected_symbol}, found ${initialChart.symbol}`);
        }
        if (normalizeResolution(initialChart.timeframe) !== normalizeResolution(expected_timeframe)) {
          throw new Error(
            `active chart timeframe changed: expected ${expected_timeframe}, found ${initialChart.timeframe}`,
          );
        }
        const replay = await tv.getReplayStatus();
        if (replay.started || replay.toolbarVisible) {
          throw new Error("strategy regime analysis is blocked while Bar Replay is active");
        }
        const script = (await tv.listPineScripts()).find((item) => item.pineId === pine_id);
        if (!script) throw new Error(`strategy not found: ${pine_id}`);
        if (script.kind !== "strategy") throw new Error(`${pine_id} is not a saved strategy`);
        if (script.version !== pine_version) {
          throw new Error(`strategy version changed: expected ${pine_version}, found ${script.version ?? "unavailable"}`);
        }
        const requestedInputs = [...(inputs ?? [])].sort((left, right) => left.id.localeCompare(right.id));
        if (new Set(requestedInputs.map((input) => input.id)).size !== requestedInputs.length) {
          throw new Error("duplicate strategy input id");
        }
        const regimeDefinition = {
          count: count ?? MAX_MARKET_REGIME_OBSERVATIONS,
          trendLookback: trend_lookback ?? 20,
          atrLookback: atr_lookback ?? 14,
          volatilityBaselineLookback: volatility_baseline_lookback ?? 50,
          trendEfficiencyThreshold: trend_efficiency_threshold ?? 0.6,
          rangeEfficiencyThreshold: range_efficiency_threshold ?? 0.25,
          directionalMoveAtrThreshold: directional_move_atr_threshold ?? 2,
          highVolatilityRatio: high_volatility_ratio ?? 1.5,
          lowVolatilityRatio: low_volatility_ratio ?? 0.75,
          minimumClassifiedBars: minimum_classified_bars ?? 100,
        };
        if (sessions === undefined && session_match_policy !== undefined) {
          throw new Error("session_match_policy requires sessions");
        }
        const joinDefinition = {
          minimumGroupTrades: minimum_group_trades ?? 30,
          minimumCoverageRatio: minimum_coverage_ratio ?? 0.8,
          maxRegimeAgeBars: max_regime_age_bars ?? 3,
          sessionMatchPolicy: sessions === undefined
            ? undefined
            : session_match_policy ?? "all_matches_non_exclusive" as const,
          sessions: sessions?.map((session) => ({
            sessionId: session.session_id,
            timezone: session.timezone,
            start: session.start,
            end: session.end,
          })),
        };
        if (joinDefinition.sessions !== undefined) validateSessionClockDefinitions(joinDefinition.sessions);
        const definition = {
          methodologyVersion: "strategy_regime_analysis_v1",
          symbol: initialChart.symbol,
          timeframe: initialChart.timeframe,
          strategy: { pineId: pine_id, pineVersion: pine_version, name: script.name, inputs: requestedInputs },
          regime: regimeDefinition,
          join: joinDefinition,
        };
        const analysisId = "sha256:" + createHash("sha256")
          .update(JSON.stringify(definition), "utf8").digest("hex");
        const preview = {
          schemaVersion: "1.0",
          analysisId,
          definition,
          chartState: initialChart,
          operations: [
            "read_loaded_closed_ohlc",
            "compute_point_in_time_regime_labels",
            "temporarily_add_exact_strategy",
            "apply_strategy_inputs",
            "collect_complete_strategy_ledger",
            "remove_temporary_strategy",
            "verify_original_chart_fingerprint",
            "join_entry_to_prior_closed_regime",
          ],
        };
        if (confirm !== true) return jsonResult({ dryRun: true, status: "preview", ...preview });

        const history = await tv.getOhlcv(regimeDefinition.count, initialChart.index);
        if (history.symbol.toUpperCase() !== expected_symbol.toUpperCase() ||
            normalizeResolution(history.resolution) !== normalizeResolution(expected_timeframe)) {
          throw new Error("OHLC evidence does not match the bound chart");
        }
        const regimes = computeMarketRegimes({
          bars: history.bars,
          symbol: history.symbol,
          timeframe: history.resolution,
          ...regimeDefinition,
          observationLimit: MAX_MARKET_REGIME_OBSERVATIONS,
        });
        const run = await collectExperimentVariant(
          { pineId: pine_id, inputs: requestedInputs },
          pine_version,
          { symbol: initialChart.symbol, timeframe: initialChart.timeframe },
        );
        const finalChart = chartFingerprint(await tv.getChartContext());
        const chartRestored = JSON.stringify(finalChart) === JSON.stringify(initialChart);
        const evaluation = run.evidence ? evaluateStrategyByRegime({
          ledger: run.evidence.ledger,
          observations: regimes.observations,
          timeframe: history.resolution,
          ...joinDefinition,
        }) : null;
        const qualityIssues = [...new Set([
          ...(regimes.qualityIssues ?? []),
          ...(evaluation?.qualityIssues ?? []),
          ...(run.error ? ["strategy_evidence_unavailable"] : []),
          ...(run.cleanupError ? ["strategy_cleanup_failed"] : []),
          ...(chartRestored ? [] : ["chart_state_restore_failed"]),
        ])];
        const operationallyComplete = Boolean(run.evidence && !run.error && !run.cleanupError && chartRestored);
        const status = !operationallyComplete || evaluation?.status === "blocked"
          ? "blocked" : qualityIssues.length === 0 && evaluation?.status === "complete" ? "complete" : "partial";
        return jsonResult({
          dryRun: false,
          status,
          ...preview,
          strategyEvidence: {
            ledgerId: run.evidence?.ledger.ledgerId ?? null,
            reportDateRange: run.evidence?.ledger.dateRange ?? null,
            currency: run.evidence?.ledger.currency ?? null,
            ledgerTrades: run.evidence?.ledger.trades.length ?? null,
            error: run.error,
            cleanupError: run.cleanupError,
          },
          regimeEvidence: {
            methodologyVersion: regimes.methodologyVersion,
            status: regimes.status,
            current: regimes.current,
            sample: regimes.sample,
            quality: regimes.quality,
            qualityIssues: regimes.qualityIssues,
            distribution: regimes.distribution,
            source: {
              chartIndex: initialChart.index,
              requestedBars: regimeDefinition.count,
              returnedBars: history.bars.length,
              from: history.bars[0]?.timeIso ?? null,
              to: history.bars.at(-1)?.timeIso ?? null,
            },
          },
          evaluation,
          qualityIssues,
          chartStateAfter: { fingerprint: finalChart, restored: chartRestored },
          limitations: [
            "Regime attribution uses the latest nominally closed regime bar available by trade entry time.",
            "Only trades covered by loaded OHLC and the explicit regime-age limit are aggregated.",
            "Profit and commission fields use TradingView Strategy Tester ledger values without reconstruction.",
            "Regime groups are descriptive evidence and are not ranked or adopted automatically.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "run_strategy_regime_matrix",
    {
      description:
        "Run a bounded serial matrix of exact saved Pine Strategies across explicit symbols and timeframes, " +
        "then join each complete trade ledger to point-in-time market regimes. Each job reads loaded closed " +
        "OHLC, temporarily adds one strategy, removes it, and verifies restoration of the original chart. " +
        "Returns coverage and descriptive performance by regime without ranking or automatic adoption. " +
        "Dry-run by default; confirm=true is required. It never changes saved Pine source or places orders.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA.describe("Exact active-chart symbol before and after the matrix"),
        expected_timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i)
          .describe("Exact active-chart timeframe before and after the matrix"),
        jobs: z.array(z.object({
          symbol: SYMBOL_SCHEMA,
          timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i),
          pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
          inputs: z.array(z.object({
            id: z.string().regex(/^[\w$]{1,64}$/),
            value: z.union([z.number(), z.string().max(256), z.boolean()]),
          })).max(20).optional(),
        })).min(1).max(12),
        count: z.number().int().min(100).max(MAX_MARKET_REGIME_OBSERVATIONS).optional(),
        load_more_bars: z.number().int().min(0).max(MAX_MARKET_REGIME_OBSERVATIONS).optional()
          .describe("History load per job before OHLC capture, split into 5000-bar requests. Default: 0"),
        trend_lookback: z.number().int().min(2).max(500).optional(),
        atr_lookback: z.number().int().min(2).max(250).optional(),
        volatility_baseline_lookback: z.number().int().min(5).max(1000).optional(),
        trend_efficiency_threshold: z.number().finite().min(0).max(1).optional(),
        range_efficiency_threshold: z.number().finite().min(0).max(1).optional(),
        directional_move_atr_threshold: z.number().finite().gt(0).max(100).optional(),
        high_volatility_ratio: z.number().finite().gt(1).max(100).optional(),
        low_volatility_ratio: z.number().finite().gt(0).lt(1).optional(),
        minimum_classified_bars: z.number().int().min(1).max(MAX_MARKET_REGIME_OBSERVATIONS).optional(),
        minimum_group_trades: z.number().int().min(1).max(100_000).optional(),
        minimum_coverage_ratio: z.number().finite().gt(0).max(1).optional(),
        max_regime_age_bars: z.number().int().min(0).max(100).optional(),
        sessions: z.array(STRATEGY_SESSION_SCHEMA).min(1).max(8).optional()
          .describe("Optional DST-aware session windows used for entry-time grouping"),
        session_match_policy: SESSION_MATCH_POLICY_SCHEMA.optional()
          .describe("Session overlap handling. Default: all_matches_non_exclusive; exclusive uses input order"),
        max_runtime_seconds: z.number().int().min(30).max(1800).optional()
          .describe("Do not start another job after this soft deadline. Default: 900"),
        confirm: z.boolean().optional(),
      },
    },
    async ({ expected_symbol, expected_timeframe, jobs, count, load_more_bars, trend_lookback, atr_lookback,
      volatility_baseline_lookback, trend_efficiency_threshold, range_efficiency_threshold,
      directional_move_atr_threshold, high_volatility_ratio, low_volatility_ratio,
      minimum_classified_bars, minimum_group_trades, minimum_coverage_ratio,
      max_regime_age_bars, sessions, session_match_policy, max_runtime_seconds, confirm }) => chartOperations.run(async () => {
      try {
        const initialChart = chartFingerprint(await tv.getChartContext());
        if (initialChart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
          throw new Error(`active chart symbol changed: expected ${expected_symbol}, found ${initialChart.symbol}`);
        }
        if (normalizeResolution(initialChart.timeframe) !== normalizeResolution(expected_timeframe)) {
          throw new Error(
            `active chart timeframe changed: expected ${expected_timeframe}, found ${initialChart.timeframe}`,
          );
        }
        const replay = await tv.getReplayStatus();
        if (replay.started || replay.toolbarVisible) {
          throw new Error("strategy regime matrix is blocked while Bar Replay is active");
        }
        const scripts = await tv.listPineScripts();
        const resolvedJobs = jobs.map((job) => {
          const script = scripts.find((item) => item.pineId === job.pine_id);
          if (!script) throw new Error(`strategy not found: ${job.pine_id}`);
          if (script.kind !== "strategy") throw new Error(`${job.pine_id} is not a saved strategy`);
          if (typeof script.version !== "string" || script.version.length === 0) {
            throw new Error(`saved strategy version is unavailable: ${job.pine_id}`);
          }
          const requestedInputs = [...(job.inputs ?? [])].sort((left, right) => left.id.localeCompare(right.id));
          if (new Set(requestedInputs.map((input) => input.id)).size !== requestedInputs.length) {
            throw new Error(`duplicate input id in regime matrix job for ${job.pine_id}`);
          }
          const definition = {
            symbol: job.symbol.toUpperCase(),
            timeframe: normalizeResolution(job.timeframe),
            pineId: job.pine_id,
            pineVersion: script.version,
            name: script.name,
            inputs: requestedInputs,
          };
          const jobId = "sha256:" + createHash("sha256")
            .update(JSON.stringify(definition), "utf8").digest("hex");
          return { jobId, ...definition };
        });
        if (new Set(resolvedJobs.map((job) => job.jobId)).size !== resolvedJobs.length) {
          throw new Error("regime matrix contains duplicate resolved jobs");
        }
        const regimeDefinition = {
          count: count ?? MAX_MARKET_REGIME_OBSERVATIONS,
          trendLookback: trend_lookback ?? 20,
          atrLookback: atr_lookback ?? 14,
          volatilityBaselineLookback: volatility_baseline_lookback ?? 50,
          trendEfficiencyThreshold: trend_efficiency_threshold ?? 0.6,
          rangeEfficiencyThreshold: range_efficiency_threshold ?? 0.25,
          directionalMoveAtrThreshold: directional_move_atr_threshold ?? 2,
          highVolatilityRatio: high_volatility_ratio ?? 1.5,
          lowVolatilityRatio: low_volatility_ratio ?? 0.75,
          minimumClassifiedBars: minimum_classified_bars ?? 100,
        };
        if (sessions === undefined && session_match_policy !== undefined) {
          throw new Error("session_match_policy requires sessions");
        }
        const joinDefinition = {
          minimumGroupTrades: minimum_group_trades ?? 30,
          minimumCoverageRatio: minimum_coverage_ratio ?? 0.8,
          maxRegimeAgeBars: max_regime_age_bars ?? 3,
          sessionMatchPolicy: sessions === undefined
            ? undefined
            : session_match_policy ?? "all_matches_non_exclusive" as const,
          sessions: sessions?.map((session) => ({
            sessionId: session.session_id,
            timezone: session.timezone,
            start: session.start,
            end: session.end,
          })),
        };
        if (joinDefinition.sessions !== undefined) validateSessionClockDefinitions(joinDefinition.sessions);
        const maxRuntimeSeconds = max_runtime_seconds ?? 900;
        const loadMoreBars = load_more_bars ?? 0;
        const definition = {
          methodologyVersion: "strategy_regime_matrix_v1",
          regime: regimeDefinition,
          join: joinDefinition,
          loadMoreBars,
          maxRuntimeSeconds,
          jobs: resolvedJobs,
        };
        const matrixId = "sha256:" + createHash("sha256")
          .update(JSON.stringify(definition), "utf8").digest("hex");
        const preview = {
          schemaVersion: "1.0",
          matrixId,
          definition,
          jobCount: resolvedJobs.length,
          execution: {
            mode: "serial",
            maxJobs: 12,
            softRuntimeDeadlineSeconds: maxRuntimeSeconds,
            restoreAfterEveryJob: true,
            stopRemainingJobsOnRestoreFailure: true,
            historyLoadPerJob: loadMoreBars,
            ranking: false,
          },
          chartState: initialChart,
        };
        if (confirm !== true) return jsonResult({ dryRun: true, status: "preview", ...preview });

        const startedAt = Date.now();
        const deadline = startedAt + maxRuntimeSeconds * 1000;
        let abortReason: string | null = null;
        const results: Array<Record<string, unknown>> = [];
        for (const job of resolvedJobs) {
          if (abortReason || Date.now() >= deadline) {
            results.push({
              jobId: job.jobId,
              symbol: job.symbol,
              timeframe: job.timeframe,
              pineId: job.pineId,
              pineVersion: job.pineVersion,
              name: job.name,
              requestedInputs: job.inputs,
              status: "skipped",
              qualityIssues: [abortReason ? "prior_chart_restore_failed" : "matrix_runtime_deadline_reached"],
              error: abortReason ?? "matrix soft runtime deadline reached before this job started",
              chartRestored: abortReason === null,
              strategyEvidence: null,
              regimeEvidence: null,
              evaluation: null,
            });
            continue;
          }

          const transaction = await withTemporaryChartState(
            tv,
            initialChart.index,
            { symbol: job.symbol, resolution: job.timeframe },
            async () => {
              const historyLoads = [];
              let remainingHistoryBars = loadMoreBars;
              while (remainingHistoryBars > 0) {
                const requested = Math.min(5_000, remainingHistoryBars);
                const loaded = await tv.loadMoreHistory({ count: requested, chartIndex: initialChart.index });
                historyLoads.push(loaded);
                remainingHistoryBars -= requested;
                if (loaded.moreAvailable === false || loaded.added === 0) break;
              }
              const history = await tv.getOhlcv(regimeDefinition.count, initialChart.index);
              if (history.symbol.toUpperCase() !== job.symbol ||
                  normalizeResolution(history.resolution) !== job.timeframe) {
                throw new Error(`OHLC evidence does not match regime matrix job ${job.jobId}`);
              }
              const regimes = computeMarketRegimes({
                bars: history.bars,
                symbol: history.symbol,
                timeframe: history.resolution,
                ...regimeDefinition,
                observationLimit: MAX_MARKET_REGIME_OBSERVATIONS,
              });
              const run = await collectExperimentVariant(
                { pineId: job.pineId, inputs: job.inputs },
                job.pineVersion,
                { symbol: job.symbol, timeframe: job.timeframe },
              );
              const evaluation = run.evidence ? evaluateStrategyByRegime({
                ledger: run.evidence.ledger,
                observations: regimes.observations,
                timeframe: history.resolution,
                ...joinDefinition,
              }) : null;
              return { historyLoads, history, regimes, run, evaluation };
            },
          );
          let afterJob: ReturnType<typeof chartFingerprint> | null = null;
          let fingerprintError: string | null = null;
          try {
            afterJob = chartFingerprint(await tv.getChartContext());
          } catch (err) {
            fingerprintError = redactSecrets(err instanceof Error ? err.message : String(err));
          }
          const chartRestored = transaction.restored && afterJob !== null &&
            JSON.stringify(afterJob) === JSON.stringify(initialChart);
          if (!chartRestored) {
            const restoreMessage = transaction.restoreError instanceof Error
              ? transaction.restoreError.message
              : transaction.restoreError
                ? String(transaction.restoreError)
                : fingerprintError ?? "chart fingerprint differs from its pre-matrix state";
            abortReason = `chart restore failed after ${job.jobId}: ${redactSecrets(restoreMessage)}`;
          }
          const operationError = transaction.operationError
            ? redactSecrets(transaction.operationError instanceof Error
              ? transaction.operationError.message
              : String(transaction.operationError))
            : null;
          const value = transaction.value;
          const qualityIssues = [...new Set([
            ...(value?.regimes.qualityIssues ?? []),
            ...(value?.evaluation?.qualityIssues ?? []),
            ...(operationError || value?.run.error || !value?.run.evidence ? ["strategy_or_regime_evidence_unavailable"] : []),
            ...(value?.run.cleanupError ? ["strategy_cleanup_failed"] : []),
            ...(chartRestored ? [] : ["chart_state_restore_failed"]),
          ])];
          const status = !chartRestored
            ? "restore_failed"
            : operationError || !value
              ? "failed"
              : value.run.cleanupError
                ? "cleanup_failed"
                : value.run.error || !value.run.evidence || value.evaluation?.status === "blocked"
                  ? "blocked"
                  : qualityIssues.length === 0 && value.evaluation?.status === "complete"
                    ? "complete"
                    : "partial";
          results.push({
            jobId: job.jobId,
            symbol: job.symbol,
            timeframe: job.timeframe,
            pineId: job.pineId,
            pineVersion: job.pineVersion,
            name: job.name,
            requestedInputs: job.inputs,
            status,
            qualityIssues,
            error: operationError ?? value?.run.error ?? (chartRestored ? null : abortReason),
            chartRestored,
            strategyEvidence: value ? {
              ledgerId: value.run.evidence?.ledger.ledgerId ?? null,
              reportDateRange: value.run.evidence?.ledger.dateRange ?? null,
              currency: value.run.evidence?.ledger.currency ?? null,
              ledgerTrades: value.run.evidence?.ledger.trades.length ?? null,
              cleanupError: value.run.cleanupError,
            } : null,
            regimeEvidence: value ? {
              methodologyVersion: value.regimes.methodologyVersion,
              status: value.regimes.status,
              sample: value.regimes.sample,
              quality: value.regimes.quality,
              qualityIssues: value.regimes.qualityIssues,
              distribution: value.regimes.distribution,
              source: {
                requestedBars: regimeDefinition.count,
                historyLoad: {
                  requestedBars: loadMoreBars,
                  attempts: value.historyLoads.length,
                  addedBars: value.historyLoads.reduce((sum, load) => sum + load.added, 0),
                  moreAvailable: value.historyLoads.at(-1)?.moreAvailable ?? null,
                },
                returnedBars: value.history.bars.length,
                from: value.history.bars[0]?.timeIso ?? null,
                to: value.history.bars.at(-1)?.timeIso ?? null,
              },
            } : null,
            evaluation: value?.evaluation ?? null,
          });
        }

        let finalChart: ReturnType<typeof chartFingerprint> | null = null;
        try {
          finalChart = chartFingerprint(await tv.getChartContext());
        } catch {
          // A per-job failure carries the actionable redacted error.
        }
        const chartRestored = finalChart !== null && JSON.stringify(finalChart) === JSON.stringify(initialChart);
        const counts = results.reduce<Record<string, number>>((acc, result) => {
          const key = String(result.status);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        const jobsWithQualityIssues = results.filter((result) =>
          Array.isArray(result.qualityIssues) && result.qualityIssues.length > 0).length;
        const allEvaluated = results.every((result) => result.status === "complete" || result.status === "partial");
        const allComplete = results.every((result) => result.status === "complete");
        return jsonResult({
          dryRun: false,
          status: !chartRestored || counts.restore_failed ? "blocked" : allComplete ? "complete" : "partial",
          ...preview,
          results,
          counts,
          jobsWithQualityIssues,
          qualityIssues: [
            ...(jobsWithQualityIssues > 0 ? ["one_or_more_jobs_have_quality_issues"] : []),
            ...(allEvaluated ? [] : ["one_or_more_jobs_not_evaluated"]),
            ...(counts.cleanup_failed ? ["one_or_more_job_cleanups_failed"] : []),
            ...(counts.restore_failed || !chartRestored ? ["chart_state_restore_failed"] : []),
            ...(counts.skipped ? ["one_or_more_jobs_were_skipped"] : []),
          ],
          elapsedMilliseconds: Date.now() - startedAt,
          chartStateAfter: { fingerprint: finalChart, restored: chartRestored },
          limitations: [
            "Every job uses the same explicit regime and join thresholds; no threshold is optimized per market.",
            "Results retain their native Strategy Tester currencies and are not aggregated into a portfolio metric.",
            "Regime groups are descriptive evidence and are never ranked or adopted automatically.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "get_indicator_values",
    {
      description:
        "Get recent plot values of indicators (studies) on a TradingView chart — e.g. " +
        "signal levels, bands, oscillator readings. Plot names come from the indicator's " +
        "own style titles. Cosmetic plots (colors, alert flags) are excluded by default. " +
        "Use get_chart_context first to see which indicators exist.",
      inputSchema: {
        study_id: z
          .string()
          .regex(/^[\w$]{1,64}$/)
          .optional()
          .describe("Indicator id from get_chart_context. Default: all indicators"),
        count: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Number of most recent bars to return per indicator. Default: 10"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
        include_all_plots: z
          .boolean()
          .optional()
          .describe("Include cosmetic plots (colorers, alert conditions). Default: false"),
      },
    },
    async ({ study_id, count, chart_index, include_all_plots }) =>
      chartOperations.run(async () => {
        try {
        return jsonResult(
          await tv.getIndicatorValues({
            studyId: study_id,
            count: count ?? 10,
            chartIndex: chart_index,
            includeAllPlots: include_all_plots ?? false,
          }),
        );
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_indicator_inputs",
    {
      description:
        "Get the input parameters (settings) of indicators on a TradingView chart, with " +
        "names, current values, defaults and tooltips — e.g. 'Pivot Length: 5'.",
      inputSchema: {
        study_id: z
          .string()
          .regex(/^[\w$]{1,64}$/)
          .optional()
          .describe("Indicator id from get_chart_context. Default: all indicators"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
      },
    },
    async ({ study_id, chart_index }) =>
      chartOperations.run(async () => {
        try {
        return jsonResult(
          await tv.getIndicatorInputs({ studyId: study_id, chartIndex: chart_index }),
        );
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "set_indicator_input",
    {
      description:
        "Change input values of an indicator or strategy already on a chart — the write " +
        "counterpart to get_indicator_inputs. The Pine source is untouched, but the " +
        "study's input values on the chart remain changed until set back (this is a live " +
        "chart edit, like opening the study's Settings dialog, and may be captured by " +
        "TradingView's own layout autosave). Works for both plain indicators and " +
        "strategies (for a strategy, follow up with get_strategy_report to read the " +
        "recalculated backtest). Use this to A/B-test parameters without re-saving the " +
        "script each time, and restore the original values when done.",
      inputSchema: {
        study_id: z
          .string()
          .regex(/^[\w$]{1,64}$/)
          .describe("Indicator/strategy id from get_chart_context or add_pine_to_chart/run_backtest(keep_on_chart:true)"),
        inputs: z
          .array(
            z.object({
              id: z.string().regex(/^[\w$]{1,64}$/).describe("Input id from get_indicator_inputs"),
              value: z.union([z.number(), z.string(), z.boolean()]),
            }),
          )
          .min(1)
          .max(20)
          .describe("Inputs to change, e.g. [{id:'in_0', value:14}]. Get ids/current values from get_indicator_inputs"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
      },
    },
    async ({ study_id, inputs, chart_index }) =>
      chartOperations.run(async () => {
        try {
          return jsonResult(
            await tv.setIndicatorInput(study_id, inputs, { chartIndex: chart_index }),
          );
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_indicator_graphics",
    {
      description:
        "Get drawing primitives (labels with text+price, trend lines, boxes/zones) that a " +
        "Pine indicator has drawn on a TradingView chart. This is how to read drawing-only " +
        "indicators (e.g. Elliott Wave labels, support/resistance lines, order blocks) that " +
        "have no numeric plots. Most recent primitives first. Times beyond the last bar are " +
        "extrapolated and flagged timeEstimated.",
      inputSchema: {
        study_id: z
          .string()
          .regex(/^[\w$]{1,64}$/)
          .optional()
          .describe("Indicator id from get_chart_context. Default: all indicators"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
        limit_per_kind: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max labels/lines/boxes each, most recent first. Default: 50"),
      },
    },
    async ({ study_id, chart_index, limit_per_kind }) =>
      chartOperations.run(async () => {
        try {
        return jsonResult(
          await tv.getIndicatorGraphics({
            studyId: study_id,
            chartIndex: chart_index,
            limitPerKind: limit_per_kind ?? 50,
          }),
        );
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_indicator_tables",
    {
      description:
        "Read tables drawn by Pine indicators on a TradingView chart (e.g. a " +
        "multi-timeframe trend dashboard in the corner) as text grids: grid[row][column] " +
        "plus the table's on-chart position. This is the only way to read table-only " +
        "summaries that have no plots or drawings.",
      inputSchema: {
        study_id: z
          .string()
          .regex(/^[\w$]{1,64}$/)
          .optional()
          .describe("Indicator id from get_chart_context. Default: all indicators"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
      },
    },
    async ({ study_id, chart_index }) =>
      chartOperations.run(async () => {
        try {
        return jsonResult(
          await tv.getIndicatorTables({ studyId: study_id, chartIndex: chart_index }),
        );
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "load_more_history",
    {
      description:
        "Load more historical bars into a TradingView chart (like scrolling left), so that " +
        "get_ohlcv and get_indicator_values can see further back. The visible chart view is " +
        "not changed. Returns how many bars were added and the new earliest bar time.",
      inputSchema: {
        count: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe("How many additional bars to request. Default: 300"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
      },
    },
    async ({ count, chart_index }) =>
      chartOperations.run(async () => {
        try {
        return jsonResult(
          await tv.loadMoreHistory({ count: count ?? 300, chartIndex: chart_index }),
        );
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "list_pine_scripts",
    {
      description:
        "List the user's own saved Pine scripts (indicators and strategies) with their " +
        "pine_id, kind and version, cross-referenced with the charts: usedBy shows which " +
        "on-chart indicators are rendered from each script. Use this to find the pine_id " +
        "for get_pine_source. Read-only.",
      inputSchema: {},
    },
    async () =>
      chartOperations.run(async () => {
        try {
          return jsonResult(await tv.listPineScripts());
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_pine_source",
    {
      description:
        "Get the full Pine source code of one of the user's OWN saved scripts, for " +
        "review or improvement suggestions. Only 'USER;...' ids from list_pine_scripts " +
        "are accepted; published/protected third-party scripts are refused. Read-only — " +
        "editing or saving scripts is not supported.",
      inputSchema: {
        pine_id: z
          .string()
          .regex(/^USER;[\w]{8,64}$/)
          .describe("Script id from list_pine_scripts, e.g. 'USER;adc40b1dfee344f19412f1ae9af74f3f'"),
        version: z
          .string()
          .regex(/^(last|[0-9]{1,6}(\.[0-9]{1,3})?)$/)
          .optional()
          .describe("Version to fetch, e.g. '3'. Default: 'last'. Older versions are how you revert a bad save"),
      },
    },
    async ({ pine_id, version }) => {
      try {
        return jsonResult(await tv.getPineSource(pine_id, version ?? "last"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_analysis_overlay_template",
    {
      description:
        "Get the audited generic Pine overlay used to render a structured market analysis " +
        "(entry zone, confirmation, invalidation, stop, targets, confidence and expiry). " +
        "Read-only: pass the returned source to save_pine_script, then add_pine_to_chart once; " +
        "subsequent analyses should update that study with apply_analysis_overlay.",
      inputSchema: {},
    },
    async () =>
      jsonResult({
        name: ANALYSIS_OVERLAY_NAME,
        version: ANALYSIS_OVERLAY_VERSION,
        source: ANALYSIS_OVERLAY_SOURCE,
        inputContract: ANALYSIS_OVERLAY_INPUTS,
        setup: [
          "Save this source with save_pine_script (dry-run, then confirm).",
          "Add the resulting pine_id once with add_pine_to_chart.",
          "Use the returned study_id with apply_analysis_overlay.",
        ],
      }),
  );

  server.registerTool(
    "save_pine_script",
    {
      description:
        "Save Pine source to the user's script library — the ONLY write tool, with a " +
        "confirm flow: without confirm=true nothing is written and a dry-run preview is " +
        "returned; show it to the user and get their approval before calling again with " +
        "confirm=true. Non-destructive by design: creates a new script (name, no pine_id) " +
        "or a new version of an existing one (pine_id), and every older version stays " +
        "retrievable via get_pine_source(pine_id, version). Compile errors are returned " +
        "with line numbers; note the version is stored even if compilation fails (see " +
        "revertHint). Typical PDCA loop: get_pine_source -> edit -> save_pine_script -> " +
        "run_backtest.",
      inputSchema: {
        source: z
          .string()
          .min(1)
          .max(200_000)
          .describe("Full Pine source, e.g. starting with //@version=5"),
        pine_id: z
          .string()
          .regex(/^USER;[\w]{8,64}$/)
          .optional()
          .describe("Existing script to save a NEW VERSION of. Omit to create a new script"),
        name: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Script name — required when creating a new script, optional rename otherwise"),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to actually write. Default: false = dry run only"),
      },
    },
    async ({ source, pine_id, name, confirm }) => {
      try {
        return jsonResult(
          await tv.savePineScript({ source, pineId: pine_id, name, confirm: confirm ?? false }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "add_pine_to_chart",
    {
      description:
        "Add one of the user's OWN saved Pine scripts (latest version) to a TradingView " +
        "chart as a study — e.g. to show an improved indicator after save_pine_script. " +
        "Additive only: never removes or replaces existing studies (the user can remove " +
        "it from the chart UI). For strategies prefer run_backtest, which cleans up " +
        "after itself.",
      inputSchema: {
        pine_id: z
          .string()
          .regex(/^USER;[\w]{8,64}$/)
          .describe("Script id from list_pine_scripts"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
      },
    },
    async ({ pine_id, chart_index }) =>
      chartOperations.run(async () => {
        try {
          return jsonResult(await tv.addPineToChart(pine_id, chart_index));
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "remove_owned_study",
    {
      description:
        "Preview or remove one on-chart instance of the user's OWN saved Pine script. " +
        "The tool verifies the USER pine_id against both list_pine_scripts and the " +
        "study's hidden Pine id before removal. It also fails closed if the chart symbol " +
        "or timeframe changed. Without confirm=true nothing is removed.",
      inputSchema: {
        pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
        study_id: z.string().regex(/^[\w$]{1,64}$/),
        chart_index: z.number().int().min(0).optional(),
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/),
        confirm: z.boolean().optional(),
      },
    },
    async ({ pine_id, study_id, chart_index, expected_symbol, expected_timeframe, confirm }) =>
      chartOperations.run(async () => {
        try {
        const context = await tv.getChartContext();
        const chart = resolveAnalysisChart(
          context,
          chart_index,
          expected_symbol,
          expected_timeframe,
        );
        const scripts = await tv.listPineScripts();
        const script = scripts.find((candidate) => candidate.pineId === pine_id);
        if (!script) throw new Error(`${pine_id} is not one of the user's saved Pine scripts`);
        const usage = script.usedBy.find(
          (candidate) => candidate.chartIndex === chart.index && candidate.studyId === study_id,
        );
        if (!usage) {
          throw new Error(
            `study ${study_id} is not mapped to ${pine_id} on chart ${chart.index}; nothing was removed`,
          );
        }
        const preview = {
          pineId: pine_id,
          pineVersion: usage.version,
          studyId: study_id,
          name: usage.name,
          chartIndex: chart.index,
          symbol: chart.symbol,
          timeframe: chart.resolution,
        };
        if (confirm !== true) {
          return jsonResult({
            dryRun: true,
            action: "remove_owned_study",
            preview,
            confirmRequired: true,
          });
        }
        const removed = await tv.removePineFromChart(pine_id, study_id, chart.index);
        return jsonResult({
          dryRun: false,
          action: "remove_owned_study",
          removed: true,
          preview,
          operation: removed,
        });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "ensure_analysis_overlay",
    {
      description:
        "Idempotently ensure that the audited Bushido Analysis Overlay is present once " +
        "on a target chart at the latest saved Pine version. It reuses a current instance, " +
        "adds a missing one, or transactionally adds the latest version, migrates the " +
        "analysis inputs, verifies them, then removes the old instance. Source, symbol, " +
        "timeframe, pine_id, version and input contract are checked fail-closed. Without " +
        "confirm=true, any chart-changing action is preview-only.",
      inputSchema: {
        pine_id: z
          .string()
          .regex(/^USER;[\w]{8,64}$/)
          .describe("Saved Bushido Analysis Overlay id from list_pine_scripts"),
        chart_index: z.number().int().min(0).optional(),
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/),
        confirm: z.boolean().optional(),
      },
    },
    async ({ pine_id, chart_index, expected_symbol, expected_timeframe, confirm }) =>
      chartOperations.run(async () => {
        try {
        const context = await tv.getChartContext();
        const chart = resolveAnalysisChart(
          context,
          chart_index,
          expected_symbol,
          expected_timeframe,
        );
        const scripts = await tv.listPineScripts();
        const script = scripts.find((candidate) => candidate.pineId === pine_id);
        if (!script) throw new Error(`${pine_id} is not one of the user's saved Pine scripts`);
        if (script.name !== ANALYSIS_OVERLAY_NAME || script.kind !== "study") {
          throw new Error(`${pine_id} is not the ${ANALYSIS_OVERLAY_NAME} study`);
        }
        if (!script.version) throw new Error(`${pine_id} has no readable latest version`);
        const latestSource = await tv.getPineSource(pine_id, "last");
        const normalizeSource = (source: string) => source.replace(/\r\n/g, "\n");
        if (normalizeSource(latestSource.source) !== normalizeSource(ANALYSIS_OVERLAY_SOURCE)) {
          throw new Error(
            `${pine_id} latest source does not match the audited analysis overlay template; save the template first`,
          );
        }

        const usages = script.usedBy.filter((usage) => usage.chartIndex === chart.index);
        if (usages.length > 2) {
          throw new Error(
            `chart ${chart.index} has ${usages.length} instances of ${pine_id}; refusing ambiguous automatic cleanup`,
          );
        }
        const inspected = [];
        for (const usage of usages) {
          const studies = await tv.getIndicatorInputs({
            studyId: usage.studyId,
            chartIndex: chart.index,
          });
          let study;
          if (usage.version === script.version) {
            study = assertAnalysisOverlayStudy(studies, usage.studyId);
          } else {
            try {
              study = assertAnalysisOverlayStudy(studies, usage.studyId);
            } catch {
              study = assertLegacyAnalysisOverlayStudy(studies, usage.studyId);
            }
          }
          inspected.push({ usage, study });
        }
        const latest = inspected.filter(({ usage }) => usage.version === script.version);
        const outdated = inspected.filter(({ usage }) => usage.version !== script.version);
        if (latest.length > 1) {
          throw new Error(
            `chart ${chart.index} has multiple latest overlay instances; refusing to choose one automatically`,
          );
        }

        if (latest.length === 1) {
          const active = latest[0].usage;
          if (outdated.length === 0) {
            return jsonResult({
              action: "reuse_analysis_overlay",
              changed: false,
              status: "ready",
              pineId: pine_id,
              pineVersion: active.version,
              studyId: active.studyId,
              chartIndex: chart.index,
              symbol: chart.symbol,
              timeframe: chart.resolution,
            });
          }
          const stale = outdated[0].usage;
          if (confirm !== true) {
            return jsonResult({
              dryRun: true,
              action: "cleanup_outdated_analysis_overlay",
              keepStudyId: active.studyId,
              removeStudyId: stale.studyId,
              warnings: [
                "The outdated overlay will be removed without migrating its inputs because " +
                  "the latest overlay instance is retained.",
              ],
              confirmRequired: true,
            });
          }
          const removed = await tv.removePineFromChart(pine_id, stale.studyId, chart.index);
          return jsonResult({
            dryRun: false,
            action: "cleanup_outdated_analysis_overlay",
            changed: true,
            status: "ready",
            pineId: pine_id,
            pineVersion: active.version,
            studyId: active.studyId,
            removed,
          });
        }

        if (outdated.length > 1) {
          throw new Error(
            `chart ${chart.index} has multiple outdated overlay instances; refusing ambiguous migration`,
          );
        }
        const old = outdated[0] ?? null;
        const plannedAction = old ? "upgrade_analysis_overlay" : "add_analysis_overlay";
        const contextBindingRequired = old !== null && ANALYSIS_OVERLAY_INPUTS.some(
          (expected) => !old.study.inputs.some((candidate) => candidate.id === expected.id),
        );
        if (confirm !== true) {
          return jsonResult({
            dryRun: true,
            action: plannedAction,
            pineId: pine_id,
            fromVersion: old?.usage.version ?? null,
            toVersion: script.version,
            migrateStudyId: old?.usage.studyId ?? null,
            chartIndex: chart.index,
            symbol: chart.symbol,
            timeframe: chart.resolution,
            contextBindingRequired,
            warnings: contextBindingRequired
              ? [
                  "The legacy overlay does not contain a trusted symbol/timeframe binding. " +
                    "Confirming this upgrade will bind its migrated analysis to the currently verified chart context.",
                ]
              : [],
            confirmRequired: true,
          });
        }

        let newStudyId: string | null = null;
        try {
          const added = await tv.addPineToChart(pine_id, chart.index);
          newStudyId = added.studyId;
          const newInputs = await tv.getIndicatorInputs({
            studyId: newStudyId,
            chartIndex: chart.index,
          });
          const newStudy = assertAnalysisOverlayStudy(newInputs, newStudyId);

          let migrated = false;
          if (old) {
            const migrationInputs = ANALYSIS_OVERLAY_INPUTS.map((expected) => {
              const input = old.study.inputs.find((candidate) => candidate.id === expected.id);
              if (input) return { id: expected.id, value: input.value };
              if (!ANALYSIS_OVERLAY_LEGACY_INPUTS.every((legacy) =>
                old.study.inputs.some((candidate) => candidate.id === legacy.id))) {
                throw new Error(`old overlay is missing input ${expected.id}`);
              }
              if (expected.id === "in_14") return { id: expected.id, value: chart.symbol };
              if (expected.id === "in_15") {
                return { id: expected.id, value: normalizeResolution(chart.resolution) };
              }
              if (expected.id === "in_16" || expected.id === "in_17") {
                return { id: expected.id, value: "" };
              }
              throw new Error(`old overlay is missing input ${expected.id}`);
            });
            const operation = await tv.setIndicatorInput(newStudyId, migrationInputs, {
              chartIndex: chart.index,
            });
            if (operation.settled === false) {
              throw new Error("new overlay input migration did not settle; retaining the old overlay");
            }
            const after = assertAnalysisOverlayStudy(
              await tv.getIndicatorInputs({ studyId: newStudyId, chartIndex: chart.index }),
              newStudyId,
            );
            const observed = new Map(after.inputs.map((input) => [input.id, input.value]));
            if (migrationInputs.some((input) => observed.get(input.id) !== input.value)) {
              throw new Error("new overlay input migration could not be verified; retaining the old overlay");
            }
            migrated = true;
          } else {
            assertAnalysisOverlayStudy([newStudy], newStudyId);
          }

          const refreshed = await tv.listPineScripts();
          const refreshedScript = refreshed.find((candidate) => candidate.pineId === pine_id);
          const refreshedUsage = refreshedScript?.usedBy.find(
            (usage) => usage.chartIndex === chart.index && usage.studyId === newStudyId,
          );
          if (!refreshedUsage || refreshedUsage.version !== script.version) {
            throw new Error("new overlay did not load the latest Pine version");
          }

          let removed = null;
          if (old) {
            removed = await tv.removePineFromChart(pine_id, old.usage.studyId, chart.index);
          }
          return jsonResult({
            dryRun: false,
            action: plannedAction,
            changed: true,
            status: "ready",
            pineId: pine_id,
            pineVersion: refreshedUsage.version,
            studyId: newStudyId,
            migrated,
            removed,
          });
        } catch (err) {
          if (newStudyId) {
            try {
              await tv.removePineFromChart(pine_id, newStudyId, chart.index);
            } catch (rollbackErr) {
              const originalMessage = err instanceof Error ? err.message : String(err);
              const rollbackMessage =
                rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
              throw new Error(
                `analysis overlay ensure failed (${originalMessage}) and rollback also failed ` +
                  `for new study ${newStudyId} (${rollbackMessage})`,
              );
            }
          }
          throw err;
        }
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_analysis_overlay_status",
    {
      description:
        "Read the current Bushido Analysis Overlay state without changing the chart. " +
        "It resolves the study by USER pine_id, verifies the exact on-chart Pine version " +
        "source and context-bound input contract, then returns analysis metadata, expiry, current-price " +
        "relations, risk/reward references and drawing integrity. Level states describe only " +
        "the current price, not historical touch order; use a future outcome tool for that.",
      inputSchema: {
        pine_id: z
          .string()
          .regex(/^USER;[\w]{8,64}$/)
          .describe("Saved Bushido Analysis Overlay id from list_pine_scripts"),
        chart_index: z.number().int().min(0).optional(),
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/),
      },
    },
    async ({ pine_id, chart_index, expected_symbol, expected_timeframe }) =>
      chartOperations.run(async () => {
        try {
        const context = await tv.getChartContext();
        const chart = resolveAnalysisChart(
          context,
          chart_index,
          expected_symbol,
          expected_timeframe,
        );
        const scripts = await tv.listPineScripts();
        const script = scripts.find((candidate) => candidate.pineId === pine_id);
        if (!script) throw new Error(`${pine_id} is not one of the user's saved Pine scripts`);
        if (script.name !== ANALYSIS_OVERLAY_NAME || script.kind !== "study") {
          throw new Error(`${pine_id} is not the ${ANALYSIS_OVERLAY_NAME} study`);
        }
        const usages = script.usedBy.filter((usage) => usage.chartIndex === chart.index);
        if (usages.length === 0) {
          return jsonResult({
            status: "not_installed",
            trusted: false,
            pineId: pine_id,
            latestPineVersion: script.version,
            chartIndex: chart.index,
            symbol: chart.symbol,
            timeframe: chart.resolution,
            remediation: "call ensure_analysis_overlay",
          });
        }
        if (usages.length > 1) {
          return jsonResult({
            status: "ambiguous",
            trusted: false,
            pineId: pine_id,
            latestPineVersion: script.version,
            chartIndex: chart.index,
            symbol: chart.symbol,
            timeframe: chart.resolution,
            usages,
            remediation: "call ensure_analysis_overlay or remove_owned_study",
          });
        }
        const usage = usages[0];
        if (!usage.version) {
          return jsonResult({
            status: "blocked",
            trusted: false,
            reason: "on_chart_pine_version_unavailable",
            pineId: pine_id,
            studyId: usage.studyId,
          });
        }
        const placedSource = await tv.getPineSource(pine_id, usage.version);
        const normalizeSource = (source: string) => source.replace(/\r\n/g, "\n");
        if (normalizeSource(placedSource.source) !== normalizeSource(ANALYSIS_OVERLAY_SOURCE)) {
          return jsonResult({
            status: "blocked",
            trusted: false,
            reason: "on_chart_source_does_not_match_audited_template",
            pineId: pine_id,
            pineVersion: usage.version,
            studyId: usage.studyId,
            remediation: "save the template and call ensure_analysis_overlay",
          });
        }
        const inputResult = await tv.getIndicatorInputs({
          studyId: usage.studyId,
          chartIndex: chart.index,
        });
        let analysis: ReturnType<typeof parseAnalysisOverlayState>;
        try {
          const study = assertAnalysisOverlayStudy(inputResult, usage.studyId);
          analysis = parseAnalysisOverlayState(study);
        } catch (err) {
          return jsonResult({
            status: "blocked",
            trusted: false,
            reason: "inputs_violate_contract",
            detail: err instanceof Error ? err.message : "overlay inputs are invalid",
            pineId: pine_id,
            pineVersion: usage.version,
            studyId: usage.studyId,
            chartIndex: chart.index,
            symbol: chart.symbol,
            timeframe: chart.resolution,
            remediation: "call apply_analysis_overlay with a valid analysis",
          });
        }
        if (
          analysis.analysisId.trim().toLowerCase() === ANALYSIS_OVERLAY_DEFAULT_ANALYSIS_ID ||
          analysis.analyzedAt === ANALYSIS_OVERLAY_DEFAULT_ANALYZED_AT
        ) {
          return jsonResult({
            status: "unconfigured",
            trusted: false,
            reason: "default_analysis_inputs",
            pineId: pine_id,
            pineVersion: usage.version,
            studyId: usage.studyId,
            chartIndex: chart.index,
            symbol: chart.symbol,
            timeframe: chart.resolution,
            analysis,
            remediation: "call apply_analysis_overlay with a real analysis",
          });
        }
        const binding = compareAnalysisOverlayBinding(
          analysis,
          chart.symbol,
          chart.resolution,
        );
        if (!binding.matches) {
          return jsonResult({
            status: "stale_context",
            trusted: false,
            reason: "analysis_context_mismatch",
            pineId: pine_id,
            pineVersion: usage.version,
            studyId: usage.studyId,
            chartIndex: chart.index,
            symbol: chart.symbol,
            timeframe: chart.resolution,
            analysis,
            mismatches: binding.mismatches,
            remediation: "apply a new analysis for the current symbol and timeframe",
          });
        }
        const ohlcv = await tv.getOhlcv(1, chart.index);
        const latestBar = ohlcv.bars.at(-1);
        if (!latestBar || !Number.isFinite(latestBar.close) || latestBar.close <= 0) {
          throw new Error("current chart price is unavailable");
        }
        const priceStatus = computeAnalysisOverlayPriceStatus(analysis, latestBar.close);

        const expectedGraphics = {
          labels: 1,
          lines: 2 + analysis.targets.length + (analysis.confirmation === null ? 0 : 1),
          boxes: 1,
        };
        let graphics: unknown = null;
        let renderVerified = false;
        const qualityIssues: string[] = [];
        try {
          const graphicsResult = await tv.getIndicatorGraphics({
            studyId: usage.studyId,
            chartIndex: chart.index,
            limitPerKind: 20,
          });
          graphics = graphicsResult[0]?.totals ?? null;
          const totals = graphicsResult[0]?.totals;
          renderVerified =
            totals?.labels === expectedGraphics.labels &&
            totals.lines === expectedGraphics.lines &&
            totals.boxes === expectedGraphics.boxes;
          if (!renderVerified) qualityIssues.push("drawing_totals_do_not_match_analysis_inputs");
        } catch {
          qualityIssues.push("drawing_verification_unavailable");
        }

        return jsonResult({
          status: "ready",
          trusted: true,
          pineId: pine_id,
          pineVersion: usage.version,
          latestPineVersion: script.version,
          versionStatus: usage.version === script.version ? "current" : "outdated",
          studyId: usage.studyId,
          chartIndex: chart.index,
          symbol: chart.symbol,
          timeframe: chart.resolution,
          analysis,
          marketObservation: {
            source: "active_chart_last_loaded_bar",
            barTime: latestBar.timeIso,
            forming: latestBar.forming ?? null,
            ...priceStatus,
          },
          render: {
            verified: renderVerified,
            expected: expectedGraphics,
            observed: graphics,
          },
          qualityIssues,
        });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "evaluate_analysis_overlay_outcome",
    {
      description:
        "Evaluate the first confirmed Target-versus-Stop outcome of an audited Bushido " +
        "Analysis Overlay using only loaded, closed OHLCV bars after the analysis time. " +
        "The analysis-containing bar and forming bars are excluded. Entry must precede an " +
        "optional confirmation; invalidation reached before confirmation cancels the setup. " +
        "Same-bar ordering, gaps and incomplete history are reported as ambiguous or incomplete " +
        "rather than guessed. Calendar-month charts are not evaluable because their duration " +
        "varies. By default it is read-only. When evaluation_timeframe is specified, it " +
        "temporarily changes only the selected chart's timeframe, captures evidence, and " +
        "restores the original timeframe; restoration failures are returned explicitly.",
      inputSchema: {
        pine_id: z
          .string()
          .regex(/^USER;[\w]{8,64}$/)
          .describe("Saved Bushido Analysis Overlay id from list_pine_scripts"),
        chart_index: z.number().int().min(0).optional(),
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/),
        evaluation_timeframe: z
          .string()
          .max(8)
          .regex(/^(?:[1-9]\d*|[1-9]\d*[SHDWM]|[SDWM])$/i)
          .optional()
          .describe(
            "Optional evidence timeframe, e.g. 15 or 1H. The overlay remains verified " +
              "against expected_timeframe and the chart is restored afterward",
          ),
        count: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe("Most recent loaded bars to inspect. Default: 1000"),
        record: z
          .boolean()
          .optional()
          .describe("Explicitly append this evaluation to the local analysis journal. Default: false"),
      },
    },
    async ({
      pine_id,
      chart_index,
      expected_symbol,
      expected_timeframe,
      evaluation_timeframe,
      count,
      record,
    }) =>
      chartOperations.run(async () => {
        try {
        const context = await tv.getChartContext();
        const chart = resolveAnalysisChart(
          context,
          chart_index,
          expected_symbol,
          expected_timeframe,
        );
        const scripts = await tv.listPineScripts();
        const script = scripts.find((candidate) => candidate.pineId === pine_id);
        if (!script) throw new Error(`${pine_id} is not one of the user's saved Pine scripts`);
        if (script.name !== ANALYSIS_OVERLAY_NAME || script.kind !== "study") {
          throw new Error(`${pine_id} is not the ${ANALYSIS_OVERLAY_NAME} study`);
        }
        const usages = script.usedBy.filter((usage) => usage.chartIndex === chart.index);
        if (usages.length === 0) {
          return jsonResult({
            status: "not_installed",
            outcome: "not_evaluable",
            trusted: false,
            pineId: pine_id,
            chartIndex: chart.index,
            remediation: "call ensure_analysis_overlay",
          });
        }
        if (usages.length > 1) {
          return jsonResult({
            status: "ambiguous",
            outcome: "not_evaluable",
            trusted: false,
            reason: "multiple_overlay_instances",
            pineId: pine_id,
            chartIndex: chart.index,
            usages,
            remediation: "call ensure_analysis_overlay or remove_owned_study",
          });
        }
        const usage = usages[0];
        if (!usage.version) {
          return jsonResult({
            status: "blocked",
            outcome: "not_evaluable",
            trusted: false,
            reason: "on_chart_pine_version_unavailable",
            pineId: pine_id,
            studyId: usage.studyId,
          });
        }
        const placedSource = await tv.getPineSource(pine_id, usage.version);
        const normalizeSource = (source: string) => source.replace(/\r\n/g, "\n");
        if (normalizeSource(placedSource.source) !== normalizeSource(ANALYSIS_OVERLAY_SOURCE)) {
          return jsonResult({
            status: "blocked",
            outcome: "not_evaluable",
            trusted: false,
            reason: "on_chart_source_does_not_match_audited_template",
            pineId: pine_id,
            pineVersion: usage.version,
            studyId: usage.studyId,
            remediation: "save the template and call ensure_analysis_overlay",
          });
        }
        const inputResult = await tv.getIndicatorInputs({
          studyId: usage.studyId,
          chartIndex: chart.index,
        });
        let analysis: ReturnType<typeof parseAnalysisOverlayState>;
        try {
          const study = assertAnalysisOverlayStudy(inputResult, usage.studyId);
          analysis = parseAnalysisOverlayState(study);
        } catch (err) {
          return jsonResult({
            status: "blocked",
            outcome: "not_evaluable",
            trusted: false,
            reason: "inputs_violate_contract",
            detail: err instanceof Error ? err.message : "overlay inputs are invalid",
            pineId: pine_id,
            pineVersion: usage.version,
            studyId: usage.studyId,
          });
        }
        if (
          analysis.analysisId.trim().toLowerCase() === ANALYSIS_OVERLAY_DEFAULT_ANALYSIS_ID ||
          analysis.analyzedAt === ANALYSIS_OVERLAY_DEFAULT_ANALYZED_AT
        ) {
          return jsonResult({
            status: "unconfigured",
            outcome: "not_evaluable",
            trusted: false,
            reason: "default_analysis_inputs",
            pineId: pine_id,
            studyId: usage.studyId,
            remediation: "call apply_analysis_overlay with a real analysis",
          });
        }
        const binding = compareAnalysisOverlayBinding(
          analysis,
          chart.symbol,
          chart.resolution,
        );
        if (!binding.matches) {
          return jsonResult({
            status: "stale_context",
            outcome: "not_evaluable",
            trusted: false,
            reason: "analysis_context_mismatch",
            pineId: pine_id,
            pineVersion: usage.version,
            studyId: usage.studyId,
            chartIndex: chart.index,
            symbol: chart.symbol,
            timeframe: chart.resolution,
            analysis,
            mismatches: binding.mismatches,
            remediation: "apply a new analysis for the current symbol and timeframe",
          });
        }

        const requestedBars = count ?? 1000;
        const originalTimeframe = chart.resolution;
        const evidenceTimeframe = normalizeResolution(
          evaluation_timeframe ?? originalTimeframe,
        );
        const timeframeChangeRequired =
          normalizeResolution(originalTimeframe) !== evidenceTimeframe;

        const collectEvidence = async () => {
          let history: Awaited<ReturnType<typeof tv.getOhlcv>> | null = null;
          let operationError: string | null = null;
          let restoreError: string | null = null;
          let restored = true;
          let currentTimeframe = originalTimeframe;
          let switchResult: Awaited<ReturnType<typeof tv.setResolution>> | null = null;
          let restoreResult: Awaited<ReturnType<typeof tv.setResolution>> | null = null;

          resolveAnalysisChart(
            await tv.getChartContext(),
            chart.index,
            expected_symbol,
            expected_timeframe,
          );

          try {
            if (timeframeChangeRequired) {
              switchResult = await tv.setResolution(evidenceTimeframe, chart.index);
              resolveAnalysisChart(
                await tv.getChartContext(),
                chart.index,
                expected_symbol,
                evidenceTimeframe,
              );
            }
            history = await tv.getOhlcv(requestedBars, chart.index);
            if (history.symbol !== chart.symbol) {
              throw new Error(
                `OHLCV symbol ${history.symbol} does not match expected ${chart.symbol}`,
              );
            }
            if (normalizeResolution(history.resolution) !== evidenceTimeframe) {
              throw new Error(
                `OHLCV resolution ${history.resolution} does not match evaluation timeframe ${evidenceTimeframe}`,
              );
            }
            if (history.bars.length === 0) {
              throw new Error(`no OHLCV bars loaded for evaluation timeframe ${evidenceTimeframe}`);
            }
          } catch (err) {
            operationError = redactSecrets(err instanceof Error ? err.message : String(err));
          } finally {
            if (timeframeChangeRequired) {
              try {
                restoreResult = await tv.setResolution(originalTimeframe, chart.index);
                const restoredChart = resolveAnalysisChart(
                  await tv.getChartContext(),
                  chart.index,
                  expected_symbol,
                  expected_timeframe,
                );
                currentTimeframe = restoredChart.resolution;
              } catch (err) {
                restored = false;
                restoreError = redactSecrets(err instanceof Error ? err.message : String(err));
                try {
                  const current = (await tv.getChartContext()).charts.find(
                    (candidate) => candidate.index === chart.index,
                  );
                  currentTimeframe = current?.resolution ?? "unknown";
                } catch {
                  currentTimeframe = "unknown";
                }
              }
            }
          }

          return {
            history,
            operationError,
            chartState: {
              changed: timeframeChangeRequired,
              originalTimeframe,
              evaluationTimeframe: evidenceTimeframe,
              restored,
              currentTimeframe,
              switchResult,
              restoreResult,
              restoreError,
            },
          };
        };

        const evidence = await collectEvidence();
        if (evidence.operationError || evidence.history === null) {
          return jsonResult({
            status: "blocked",
            outcome: "not_evaluable",
            trusted: false,
            reason: "evaluation_evidence_unavailable",
            detail: evidence.operationError ?? "OHLCV evidence was not returned",
            pineId: pine_id,
            pineVersion: usage.version,
            studyId: usage.studyId,
            chartIndex: chart.index,
            symbol: chart.symbol,
            timeframe: originalTimeframe,
            evaluationTimeframe: evidenceTimeframe,
            chartState: evidence.chartState,
          });
        }
        const history = evidence.history;
        const result = evaluateAnalysisOverlayOutcome(
          analysis,
          history.bars,
          history.resolution,
        );
        const performance = computeAnalysisPathMetrics(analysis, history.bars, result);
        const response = {
          ...result,
          performance,
          trusted: true,
          pineId: pine_id,
          pineVersion: usage.version,
          studyId: usage.studyId,
          chartIndex: chart.index,
          symbol: chart.symbol,
          timeframe: originalTimeframe,
          evaluationTimeframe: evidenceTimeframe,
          chartState: evidence.chartState,
          qualityIssues: [
            ...result.qualityIssues,
            ...(evidence.chartState.restored ? [] : ["chart_timeframe_restore_failed"]),
          ],
          source: {
            kind: timeframeChangeRequired
              ? "temporary_evaluation_timeframe_closed_ohlcv"
              : "active_chart_loaded_closed_ohlcv",
            requestedBars,
            returnedBars: history.bars.length,
            formingBarsExcluded: history.bars.filter((bar) => bar.forming === true).length,
          },
          ...(result.status === "incomplete"
            ? {
                remediation:
                  result.outcome === "no_closed_bars_in_evaluation_window"
                    ? "set evaluation_timeframe to a shorter interval with closed bars inside the analysis window"
                    : "call load_more_history, then evaluate again",
              }
            : {}),
          ...(result.outcome === "calendar_month_resolution_unsupported"
            ? { remediation: "use an intraday, daily, or weekly chart timeframe" }
            : {}),
        };
        if (record !== true) return jsonResult({ ...response, journal: { requested: false } });

        try {
          const definition = journalDefinition(analysis, {
            symbol: chart.symbol,
            timeframe: originalTimeframe,
            chartIndex: chart.index,
            studyId: usage.studyId,
            pineId: pine_id,
            pineVersion: usage.version,
          });
          const journalResult = await journal.recordOutcome(
            analysis.analysisId,
            analysisDefinitionHash(definition),
            {
              status: result.status,
              outcome: result.outcome,
              evaluatedAt: new Date().toISOString(),
              evidenceTimeframe,
              evidenceThrough: result.evidence.evidenceThrough,
              result: response as Record<string, unknown>,
            },
          );
          return jsonResult({
            ...response,
            journal: {
              requested: true,
              recorded: journalResult.recorded,
              idempotent: journalResult.idempotent,
              eventId: journalResult.entry.event_id,
            },
          });
        } catch (err) {
          const definitionConflict = err instanceof AnalysisDefinitionConflictError;
          return jsonResult({
            ...response,
            qualityIssues: [...response.qualityIssues, "analysis_journal_write_failed"],
            journal: {
              requested: true,
              recorded: false,
              reason: definitionConflict ? err.code : "journal_write_failed",
              error: redactSecrets(err instanceof Error ? err.message : String(err)),
              remediation: definitionConflict
                ? "assign a new analysis_id, re-apply the overlay with confirm=true, then evaluate it again with record=true"
                : "verify the journal path and re-run with record=true",
            },
          });
        }
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "evaluate_due_analyses",
    {
      description:
        "Preview or evaluate due analyses directly from the local analysis journal. " +
        "Without confirm=true it only lists candidates and estimated chart changes. With " +
        "confirmation it temporarily changes one selected chart's symbol and evidence " +
        "timeframe for each analysis, evaluates closed OHLCV, records the result, and " +
        "restores the original chart after every item. Individual failures do not stop the " +
        "batch; a chart restoration failure stops all remaining work.",
      inputSchema: {
        chart_index: z.number().int().min(0).optional(),
        evaluation_timeframe: z
          .string()
          .max(8)
          .regex(/^(?:[1-9]\d*|[1-9]\d*[SHDWM]|[SDWM])$/i)
          .optional()
          .describe("Optional evidence timeframe for every candidate; defaults to each analysis timeframe"),
        count: z.number().int().min(1).max(5000).optional()
          .describe("Loaded OHLCV bars inspected per analysis. Default: 1000"),
        load_more_bars: z.number().int().min(0).max(5000).optional()
          .describe("Explicit history load before evaluation. Default: 0 (no persistent history load)"),
        limit: z.number().int().min(1).max(50).optional()
          .describe("Maximum analyses to evaluate. Default: 20"),
        include_active: z.boolean().optional()
          .describe("Include active analyses with no prior evaluation. Default: false"),
        confirm: z.boolean().optional()
          .describe("Must be true to change the chart and append outcomes. Default: false"),
      },
    },
    async ({
      chart_index,
      evaluation_timeframe,
      count,
      load_more_bars,
      limit,
      include_active,
      confirm,
    }) => chartOperations.run(async () => {
      try {
        const initialContext = await tv.getChartContext();
        const selectedIndex = chart_index ?? initialContext.activeChartIndex;
        if (selectedIndex === null) {
          return jsonResult({
            status: "blocked",
            reason: "evaluation_chart_not_selected",
            trusted: false,
            remediation: "provide chart_index explicitly",
          });
        }
        const originalChart = initialContext.charts.find((chart) => chart.index === selectedIndex);
        if (!originalChart) {
          return jsonResult({
            status: "blocked",
            reason: "evaluation_chart_not_found",
            trusted: false,
            chartIndex: selectedIndex,
          });
        }
        const journalView = await journal.list({ limit: 500 });
        const selection = selectDueAnalyses(
          journalView.analyses as JournalAnalysisRecord[],
          { includeActive: include_active ?? false, limit: limit ?? 20 },
        );
        const requestedBars = count ?? 1000;
        const historyLoad = load_more_bars ?? 0;
        const previewItems = selection.candidates.map((candidate) => {
          const evidenceTimeframe = normalizeResolution(
            evaluation_timeframe ?? candidate.definition.timeframe,
          );
          return {
            analysisId: candidate.analysisId,
            reason: candidate.reason,
            symbol: candidate.definition.symbol,
            analysisTimeframe: candidate.definition.timeframe,
            evaluationTimeframe: evidenceTimeframe,
            expiresAt: candidate.definition.expiresAt,
            latestOutcome: candidate.latestOutcome === null ? null : {
              status: candidate.latestOutcome.status,
              outcome: candidate.latestOutcome.outcome,
              evidenceThrough: candidate.latestOutcome.evidenceThrough,
            },
            estimatedChanges: {
              symbol: originalChart.symbol.toUpperCase() !== candidate.definition.symbol.toUpperCase(),
              timeframe: normalizeResolution(originalChart.resolution) !== evidenceTimeframe,
              persistentHistoryLoad: historyLoad > 0,
            },
          };
        });
        const preview = {
          chartIndex: selectedIndex,
          originalChart: { symbol: originalChart.symbol, timeframe: originalChart.resolution },
          requestedBars,
          loadMoreBars: historyLoad,
          includeActive: include_active ?? false,
          journalPopulation: journalView.total,
          journalScanned: journalView.returned,
          journalScanTruncated: journalView.total > journalView.returned,
          eligible: selection.eligible,
          selected: previewItems.length,
          truncated: selection.truncated,
          candidates: previewItems,
          skipped: selection.skipped,
        };
        if (confirm !== true) {
          return jsonResult({
            status: "preview",
            dryRun: true,
            changed: false,
            confirmRequired: previewItems.length > 0,
            preview,
          });
        }

        const results: Array<Record<string, unknown>> = [];
        let aborted = false;

        for (const candidate of selection.candidates) {
          const evidenceTimeframe = normalizeResolution(
            evaluation_timeframe ?? candidate.definition.timeframe,
          );
          await assertChartState(tv, selectedIndex, {
            symbol: originalChart.symbol,
            resolution: originalChart.resolution,
          });
          const transaction = await withTemporaryChartState(
            tv,
            selectedIndex,
            { symbol: candidate.definition.symbol, resolution: evidenceTimeframe },
            async () => {
              const operationChanges: Array<Record<string, unknown>> = [];
              let historyLoadResult: unknown = null;
            if (historyLoad > 0) {
                historyLoadResult = await tv.loadMoreHistory({ count: historyLoad, chartIndex: selectedIndex });
                operationChanges.push({ kind: "history_load", result: historyLoadResult });
            }
              const history = await tv.getOhlcv(requestedBars, selectedIndex);
            if (history.symbol.toUpperCase() !== candidate.definition.symbol.toUpperCase()) {
              throw new Error(`OHLCV symbol ${history.symbol} does not match ${candidate.definition.symbol}`);
            }
            if (normalizeResolution(history.resolution) !== evidenceTimeframe) {
              throw new Error(`OHLCV timeframe ${history.resolution} does not match ${evidenceTimeframe}`);
            }
            if (history.bars.length === 0) throw new Error("no OHLCV bars were returned");
              const evaluation = evaluateAnalysisOverlayOutcome(
              candidate.definition,
              history.bars,
              history.resolution,
            );
              return { history, evaluation, operationChanges };
            },
          );
          const operationError = transaction.operationError === null
            ? null
            : redactSecrets(transaction.operationError instanceof Error
              ? transaction.operationError.message
              : String(transaction.operationError));
          const restoreError = transaction.restoreError === null
            ? null
            : redactSecrets(transaction.restoreError instanceof Error
              ? transaction.restoreError.message
              : String(transaction.restoreError));
          const history = transaction.value?.history ?? null;
          const evaluation = transaction.value?.evaluation ?? null;
          const changes: Array<Record<string, unknown>> = [
            ...(transaction.change?.operations ?? []),
            ...(transaction.value?.operationChanges ?? []),
          ];

          if (operationError !== null || evaluation === null || history === null) {
            results.push({
              analysisId: candidate.analysisId,
              status: "failed",
              reason: "evaluation_failed",
              error: operationError ?? "evaluation did not produce a result",
              changes,
              chartRestored: restoreError === null,
              restoreError,
            });
          } else {
            const performance = computeAnalysisPathMetrics(
              candidate.definition,
              history.bars,
              evaluation,
            );
            const response = {
              ...evaluation,
              performance,
              trusted: true,
              symbol: candidate.definition.symbol,
              analysisTimeframe: candidate.definition.timeframe,
              evaluationTimeframe: evidenceTimeframe,
              source: {
                kind: "temporary_batch_evaluation_closed_ohlcv",
                requestedBars,
                returnedBars: history.bars.length,
                loadMoreBars: historyLoad,
              },
              chartState: {
                chartIndex: selectedIndex,
                restored: restoreError === null,
                restoreError,
                changes,
              },
              qualityIssues: [
                ...evaluation.qualityIssues,
                ...(restoreError === null ? [] : ["chart_state_restore_failed"]),
              ],
            };
            try {
              const journalResult = await journal.recordOutcome(
                candidate.analysisId,
                candidate.definitionHash,
                {
                  status: evaluation.status,
                  outcome: evaluation.outcome,
                  evaluatedAt: new Date().toISOString(),
                  evidenceTimeframe,
                  evidenceThrough: evaluation.evidence.evidenceThrough,
                  result: response,
                },
              );
              results.push({
                analysisId: candidate.analysisId,
                status: "evaluated",
                result: response,
                journal: {
                  recorded: journalResult.recorded,
                  idempotent: journalResult.idempotent,
                  eventId: journalResult.entry.event_id,
                },
              });
            } catch (err) {
              results.push({
                analysisId: candidate.analysisId,
                status: "evaluated",
                result: response,
                journal: {
                  recorded: false,
                  error: redactSecrets(err instanceof Error ? err.message : String(err)),
                },
              });
            }
          }
          if (restoreError !== null) {
            aborted = true;
            break;
          }
        }

        return jsonResult({
          status: aborted
            ? "aborted"
            : results.some((result) => result.status === "failed" ||
                (result.journal as { error?: string } | undefined)?.error !== undefined)
              ? "partial"
              : "complete",
          dryRun: false,
          changed: results.length > 0,
          chartIndex: selectedIndex,
          processed: results.length,
          remaining: selection.candidates.length - results.length,
          aborted,
          preview,
          results,
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "apply_analysis_overlay",
    {
      description:
        "Preview or apply a structured market analysis to an existing Bushido Analysis " +
        "Overlay study. The tool fails closed when the chart symbol, timeframe or overlay " +
        "input contract does not match. Without confirm=true it is read-only and returns a " +
        "preview. With confirm=true it changes only that overlay's inputs, then reads them " +
        "and its drawing totals back for verification. It never places orders or alerts.",
      inputSchema: {
        study_id: z
          .string()
          .regex(/^[\w$]{1,64}$/)
          .describe("Overlay study id returned by add_pine_to_chart or get_chart_context"),
        chart_index: z.number().int().min(0).optional(),
        expected_symbol: SYMBOL_SCHEMA.describe(
          "Exact symbol expected on the target chart, e.g. OANDA:USDJPY",
        ),
        expected_timeframe: z
          .string()
          .regex(/^[A-Za-z0-9]{1,8}$/)
          .describe("Expected chart resolution, e.g. 15, 240, 4H or 1D"),
        analysis_id: z.string().regex(/^[\w.:-]{1,80}$/),
        analyzed_at: z.string().datetime({ offset: true }),
        expires_at: z.string().datetime({ offset: true }).optional(),
        bias: z.enum(["bullish", "bearish", "neutral"]),
        entry_low: z.number().positive(),
        entry_high: z.number().positive(),
        confirmation: z.number().positive().optional(),
        invalidation: z.number().positive(),
        stop: z.number().positive(),
        targets: z.array(z.number().positive()).min(1).max(3),
        confidence: z.number().min(0).max(1),
        note: z.string().max(160).optional(),
        snapshot_id: z.string().uuid().optional().describe(
          "Optional get_market_snapshot snapshot_id binding this analysis to its evidence",
        ),
        strategy_version: z.string().min(1).max(80).optional().describe(
          "Optional strategy or decision-policy version used for this analysis",
        ),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to edit the live chart. Default: false = dry run"),
      },
    },
    async ({
      study_id,
      chart_index,
      expected_symbol,
      expected_timeframe,
      analysis_id,
      analyzed_at,
      expires_at,
      bias,
      entry_low,
      entry_high,
      confirmation,
      invalidation,
      stop,
      targets,
      confidence,
      note,
      snapshot_id,
      strategy_version,
      confirm,
    }) =>
      chartOperations.run(async () => {
        try {
        const analysis = {
          analysisId: analysis_id,
          analyzedAt: analyzed_at,
          expiresAt: expires_at,
          bias,
          entryLow: entry_low,
          entryHigh: entry_high,
          confirmation,
          invalidation,
          stop,
          targets,
          confidence,
          note,
        };
        const quality = validateAnalysisPayload(analysis);
        const context = await tv.getChartContext();
        const chart = resolveAnalysisChart(
          context,
          chart_index,
          expected_symbol,
          expected_timeframe,
        );
        const resolvedChartIndex = chart.index;
        const before = await tv.getIndicatorInputs({
          studyId: study_id,
          chartIndex: resolvedChartIndex,
        });
        assertAnalysisOverlayStudy(before, study_id);
        const inputs = buildAnalysisOverlayInputs(analysis, {
          symbol: chart.symbol,
          timeframe: chart.resolution,
          snapshotId: snapshot_id,
          strategyVersion: strategy_version,
        });
        const preview = {
          analysisId: analysis_id,
          symbol: chart.symbol,
          timeframe: chart.resolution,
          studyId: study_id,
          analyzedAt: analyzed_at,
          expiresAt: expires_at ?? null,
          stale: quality.stale,
          bias,
          entryZone: [entry_low, entry_high],
          confirmation: confirmation ?? null,
          invalidation,
          stop,
          targets,
          confidence,
          note: note ?? "",
          snapshotId: snapshot_id ?? null,
          strategyVersion: strategy_version ?? null,
          warnings: quality.warnings,
        };
        if (confirm !== true) {
          return jsonResult({
            dryRun: true,
            action: "apply_analysis_overlay",
            preview,
            confirmRequired: true,
          });
        }

        const applied = await tv.setIndicatorInput(study_id, inputs, {
          chartIndex: resolvedChartIndex,
        });
        const after = await tv.getIndicatorInputs({
          studyId: study_id,
          chartIndex: resolvedChartIndex,
        });
        const verifiedStudy = assertAnalysisOverlayStudy(after, study_id);
        const observed = new Map(verifiedStudy.inputs.map((input) => [input.id, input.value]));
        const inputVerification = inputs.map((input) => ({
          id: input.id,
          expected: input.value,
          observed: observed.get(input.id) ?? null,
          matches: observed.get(input.id) === input.value,
        }));
        const inputsVerified = inputVerification.every((item) => item.matches);
        const observedAnalysis = parseAnalysisOverlayState(verifiedStudy);
        const recalculationSettled = applied.settled !== false;
        if (!recalculationSettled) {
          quality.warnings.push(
            "overlay inputs were applied, but recalculation did not settle within the 20s " +
              "deadline; drawing verification was skipped and dependent reads may be stale",
          );
        }

        let graphicsVerification: unknown = null;
        if (recalculationSettled) {
          try {
            const graphics = await tv.getIndicatorGraphics({
              studyId: study_id,
              chartIndex: resolvedChartIndex,
              limitPerKind: 20,
            });
            graphicsVerification = graphics[0]?.totals ?? null;
          } catch {
            quality.warnings.push("overlay inputs were applied, but drawing verification was unavailable");
          }
        }

        let journalStatus: Record<string, unknown>;
        if (!inputsVerified) {
          journalStatus = {
            recorded: false,
            reason: "overlay_inputs_not_verified",
            remediation: "fix the chart input mismatch, then apply again with confirm=true",
          };
        } else {
          try {
            const scripts = await tv.listPineScripts();
            const owner = scripts.find((script) =>
              script.name === ANALYSIS_OVERLAY_NAME &&
              script.usedBy.some((usage) =>
                usage.chartIndex === resolvedChartIndex && usage.studyId === study_id));
            const usage = owner?.usedBy.find((candidate) =>
              candidate.chartIndex === resolvedChartIndex && candidate.studyId === study_id);
            const journalResult = await journal.recordAnalysis(journalDefinition(observedAnalysis, {
              symbol: chart.symbol,
              timeframe: chart.resolution,
              chartIndex: resolvedChartIndex,
              studyId: study_id,
              pineId: owner?.pineId ?? null,
              pineVersion: usage?.version ?? null,
            }));
            journalStatus = {
              recorded: journalResult.recorded,
              idempotent: journalResult.idempotent,
              eventId: journalResult.entry.event_id,
            };
          } catch (err) {
            const definitionConflict = err instanceof AnalysisDefinitionConflictError;
            quality.warnings.push(
              "overlay inputs were applied and verified, but the local analysis journal write failed",
            );
            journalStatus = {
              recorded: false,
              reason: definitionConflict ? err.code : "journal_write_failed",
              error: redactSecrets(err instanceof Error ? err.message : String(err)),
              remediation: definitionConflict
                ? "assign a new analysis_id and re-apply this chart definition with confirm=true"
                : "verify the journal path, then apply the same analysis again to retry idempotently",
            };
          }
        }

        return jsonResult({
          dryRun: false,
          action: "apply_analysis_overlay",
          applied: true,
          verified: inputsVerified && recalculationSettled,
          inputsVerified,
          recalculationSettled,
          preview,
          inputVerification,
          graphicsVerification,
          operation: applied,
          journal: journalStatus,
          warnings: quality.warnings,
        });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_analysis_journal",
    {
      description:
        "Read locally journaled analysis definitions and their monotonic latest evaluations. " +
        "A completed evaluation is never displaced by a later stale ongoing read. This tool " +
        "does not access or change the TradingView chart.",
      inputSchema: {
        analysis_id: z.string().regex(/^[\w.:-]{1,80}$/).optional(),
        symbol: SYMBOL_SCHEMA.optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ analysis_id, symbol, limit }) => {
      try {
        return jsonResult(await journal.list({
          analysisId: analysis_id,
          symbol,
          limit: limit ?? 50,
        }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_analysis_performance",
    {
      description:
        "Aggregate live analysis-journal outcomes into explicit populations for binary " +
        "win rate, gross/net R, MFE/MAE and timing. Missing historical path metrics, " +
        "non-binary outcomes and absent cost assumptions are excluded with counts rather " +
        "than filled with zero. This read-only tool never mixes Strategy Tester backtests " +
        "into the live-analysis population.",
      inputSchema: {
        symbol: SYMBOL_SCHEMA.optional(),
        bias: z.enum(["bullish", "bearish", "neutral"]).optional(),
        timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/).optional(),
        strategy_version: z.string().min(1).max(80).optional(),
        group_by: z.enum(["overall", "symbol", "bias", "timeframe", "strategy_version"]).optional(),
        cost_assumptions: z.array(z.object({
          symbol: SYMBOL_SCHEMA,
          total_price_per_unit: z.number().finite().nonnegative(),
        })).max(20).optional().describe(
          "Optional symbol-specific round-trip costs in instrument price units per unit",
        ),
      },
    },
    async ({ symbol, bias, timeframe, strategy_version, group_by, cost_assumptions }) => {
      try {
        const journalView = await journal.list({ limit: 500 });
        const report = buildAnalysisPerformance(
          journalView.analyses as JournalAnalysisRecord[],
          {
            symbol,
            bias,
            timeframe,
            strategyVersion: strategy_version,
            groupBy: group_by,
            costs: cost_assumptions?.map((cost) => ({
              symbol: cost.symbol,
              totalPricePerUnit: cost.total_price_per_unit,
            })),
          },
        );
        return jsonResult({
          ...report,
          journalPopulation: journalView.total,
          journalScanned: journalView.returned,
          journalScanTruncated: journalView.total > journalView.returned,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_analysis_calibration",
    {
      description:
        "Calculate confidence calibration from the local analysis journal. Only " +
        "target_before_stop is labelled positive and stop_before_target negative; ambiguous, " +
        "incomplete, cancelled, neutral, and unevaluated analyses are reported as exclusions.",
      inputSchema: {
        symbol: SYMBOL_SCHEMA.optional(),
        bias: z.enum(["bullish", "bearish", "neutral"]).optional(),
        bins: z.number().int().min(2).max(50).optional(),
      },
    },
    async ({ symbol, bias, bins }) => {
      try {
        return jsonResult(await journal.calibration({ symbol, bias, bins: bins ?? 10 }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_strategy_report",
    {
      description:
        "Read the backtest report (Strategy Tester) of the strategy currently on the " +
        "active TradingView chart: net profit, win rate, profit factor, drawdown, Sharpe/" +
        "Sortino, and the most recent trades with entry/exit details. Percent-style " +
        "fields are fractions (0.33 = 33%). Fails if no strategy is on the chart — use " +
        "run_backtest to test a saved strategy without leaving it on the chart.",
      inputSchema: {
        trades_limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max most-recent trades to include. Default: 20"),
      },
    },
    async ({ trades_limit }) =>
      chartOperations.run(async () => {
        try {
          return jsonResult(await tv.getStrategyReport({ tradesLimit: trades_limit ?? 20 }));
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_strategy_trade_ledger",
    {
      description:
        "Read a stable, paginated ledger of every trade available in the active Strategy " +
        "Tester report. Returns entry/exit, direction, profit, quantity, duration, and " +
        "run-up/drawdown/commission when TradingView exposes them. Start with offset 0; " +
        "pass the returned ledgerId as expected_ledger_id on later pages to fail closed if " +
        "the strategy recalculates. Read-only and requires an active strategy.",
      inputSchema: {
        offset: z
          .number()
          .int()
          .min(0)
          .max(10_000_000)
          .optional()
          .describe("Zero-based trade offset. Default: 0"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Trades to return in this page. Default: 200, maximum: 500"),
        expected_ledger_id: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/)
          .optional()
          .describe("ledgerId from page 1; rejects mixed pages after recalculation"),
      },
    },
    async ({ offset, limit, expected_ledger_id }) =>
      chartOperations.run(async () => {
        try {
          return jsonResult(await tv.getStrategyTradeLedger({
            offset: offset ?? 0,
            limit: limit ?? 200,
            expectedLedgerId: expected_ledger_id,
          }));
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "run_strategy_experiment",
    {
      description:
        "Run one bounded baseline-versus-candidate Strategy Tester experiment on the " +
        "active chart. Both variants are resolved to exact saved Pine versions, applied " +
        "serially with optional input overrides, bound to full-ledger SHA-256 ids, and " +
        "removed after collection. Returns metric deltas without a synthetic score. " +
        "Without confirm=true it only previews the experiment. It never places orders.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA.describe("Exact active-chart symbol, e.g. OANDA:USDJPY"),
        expected_timeframe: z.string().min(1).max(16).describe("Exact active-chart timeframe, e.g. 240 or 1D"),
        baseline: z.object({
          pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
          inputs: z.array(z.object({
            id: z.string().regex(/^[\w$]{1,64}$/),
            value: z.union([z.number(), z.string().max(256), z.boolean()]),
          })).max(20).optional(),
        }),
        candidate: z.object({
          pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
          inputs: z.array(z.object({
            id: z.string().regex(/^[\w$]{1,64}$/),
            value: z.union([z.number(), z.string().max(256), z.boolean()]),
          })).max(20).optional(),
        }),
        minimum_trades: z.number().int().min(1).max(100_000).optional()
          .describe("Closed trades required per variant. Default: 30"),
        confirm: z.boolean().optional()
          .describe("Must be true to temporarily add strategies and run the experiment. Default: false"),
      },
    },
    async ({ expected_symbol, expected_timeframe, baseline, candidate, minimum_trades, confirm }) =>
      chartOperations.run(async () => {
        try {
          const minimumTrades = minimum_trades ?? 30;
          const initialContext = await tv.getChartContext();
          const initialChart = chartFingerprint(initialContext);
          if (initialChart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
            throw new Error(`active chart symbol changed: expected ${expected_symbol}, found ${initialChart.symbol}`);
          }
          if (normalizeResolution(initialChart.timeframe) !== normalizeResolution(expected_timeframe)) {
            throw new Error(
              `active chart timeframe changed: expected ${expected_timeframe}, found ${initialChart.timeframe}`,
            );
          }
          const scripts = await tv.listPineScripts();
          const resolveVariant = (variant: typeof baseline) => {
            const script = scripts.find((item) => item.pineId === variant.pine_id);
            if (!script) throw new Error(`strategy not found: ${variant.pine_id}`);
            if (script.kind !== "strategy") throw new Error(`${variant.pine_id} is not a saved strategy`);
            if (typeof script.version !== "string" || script.version.length === 0) {
              throw new Error(`saved strategy version is unavailable: ${variant.pine_id}`);
            }
            return {
              pineId: variant.pine_id,
              pineVersion: script.version,
              name: script.name,
              inputs: [...(variant.inputs ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
            };
          };
          const resolvedBaseline = resolveVariant(baseline);
          const resolvedCandidate = resolveVariant(candidate);
          const definition = {
            methodologyVersion: "1.0",
            symbol: initialChart.symbol,
            timeframe: initialChart.timeframe,
            minimumTrades,
            baseline: resolvedBaseline,
            candidate: resolvedCandidate,
          };
          const experimentId = "sha256:" + createHash("sha256")
            .update(JSON.stringify(definition), "utf8")
            .digest("hex");
          const preview = {
            schemaVersion: "1.0",
            experimentId,
            definition,
            operations: [
              "temporarily_add_baseline",
              "apply_baseline_inputs",
              "collect_baseline_report_and_full_ledger",
              "remove_baseline",
              "temporarily_add_candidate",
              "apply_candidate_inputs",
              "collect_candidate_report_and_full_ledger",
              "remove_candidate",
              "verify_original_chart_state",
            ],
            chartState: initialChart,
          };
          if (confirm !== true) return jsonResult({ dryRun: true, status: "preview", ...preview });

          const expectedChart = { symbol: initialChart.symbol, timeframe: initialChart.timeframe };
          const baselineRun = await collectExperimentVariant(
            resolvedBaseline,
            resolvedBaseline.pineVersion,
            expectedChart,
          );
          let candidateRun: Awaited<ReturnType<typeof collectExperimentVariant>> | null = null;
          if (baselineRun.evidence && !baselineRun.cleanupError) {
            const afterBaseline = chartFingerprint(await tv.getChartContext());
            if (JSON.stringify(afterBaseline) === JSON.stringify(initialChart)) {
              candidateRun = await collectExperimentVariant(
                resolvedCandidate,
                resolvedCandidate.pineVersion,
                expectedChart,
              );
            } else {
              candidateRun = {
                evidence: null,
                error: "chart state did not restore after baseline; candidate was not run",
                cleanupError: null,
              };
            }
          } else {
            candidateRun = {
              evidence: null,
              error: baselineRun.cleanupError
                ? "baseline cleanup failed; candidate was not run"
                : "baseline evidence was unavailable; candidate was not run",
              cleanupError: null,
            };
          }

          const finalChart = chartFingerprint(await tv.getChartContext());
          const chartRestored = JSON.stringify(finalChart) === JSON.stringify(initialChart);
          const baselineSummary = baselineRun.evidence
            ? summarizeStrategyEvidence(baselineRun.evidence, minimumTrades)
            : null;
          const candidateSummary = candidateRun?.evidence
            ? summarizeStrategyEvidence(candidateRun.evidence, minimumTrades)
            : null;
          const conditions = baselineRun.evidence && candidateRun?.evidence
            ? compareStrategyConditions(baselineRun.evidence.ledger, candidateRun.evidence.ledger)
            : null;
          const comparison = baselineSummary && candidateSummary
            ? compareStrategyMetrics(baselineSummary.metrics, candidateSummary.metrics)
            : null;
          const qualityIssues = [...new Set([
            ...(baselineSummary?.qualityIssues ?? []),
            ...(candidateSummary?.qualityIssues ?? []),
            ...(conditions?.qualityIssues ?? []),
            ...(baselineRun.cleanupError ? ["baseline_cleanup_failed"] : []),
            ...(candidateRun?.cleanupError ? ["candidate_cleanup_failed"] : []),
            ...(chartRestored ? [] : ["chart_state_restore_failed"]),
          ])];
          const complete = Boolean(baselineRun.evidence && candidateRun?.evidence && chartRestored &&
            !baselineRun.cleanupError && !candidateRun?.cleanupError);
          const comparisonEligible = Boolean(
            complete && conditions?.matched && baselineSummary?.minimumTradesMet && candidateSummary?.minimumTradesMet,
          );
          const variantResult = (
            resolved: typeof resolvedBaseline,
            run: Awaited<ReturnType<typeof collectExperimentVariant>> | null,
            summary: typeof baselineSummary,
          ) => ({
            pineId: resolved.pineId,
            pineVersion: resolved.pineVersion,
            name: resolved.name,
            requestedInputs: resolved.inputs,
            ledgerId: run?.evidence?.ledger.ledgerId ?? null,
            reportDateRange: run?.evidence?.ledger.dateRange ?? null,
            summary,
            error: run?.error ?? null,
            cleanupError: run?.cleanupError ?? null,
          });
          return jsonResult({
            dryRun: false,
            status: complete ? "complete" : "partial",
            comparisonStatus: comparisonEligible
              ? "eligible"
              : !complete
                ? "incomplete"
                : !conditions?.matched
                  ? "conditions_differ"
                  : "insufficient_sample",
            ...preview,
            baseline: variantResult(resolvedBaseline, baselineRun, baselineSummary),
            candidate: variantResult(resolvedCandidate, candidateRun, candidateSummary),
            conditions,
            comparison,
            qualityIssues,
            chartState: { before: initialChart, after: finalChart, restored: chartRestored },
          });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "run_backtest_matrix",
    {
      description:
        "Run a bounded, serial matrix of saved Pine strategies across explicit symbol, " +
        "timeframe, and input combinations. The matrix is limited to 24 jobs and a soft " +
        "runtime budget. Each strategy is temporarily added, bound to a full-ledger SHA-256 " +
        "id, removed, and the original chart state is restored after every job. Failures and " +
        "insufficient samples remain as rows; results are never ranked. Without confirm=true " +
        "this only returns the resolved execution plan. It never places orders.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA.describe("Exact active-chart symbol before and after the matrix"),
        expected_timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i)
          .describe("Exact active-chart timeframe before and after the matrix"),
        jobs: z.array(z.object({
          symbol: SYMBOL_SCHEMA,
          timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i),
          pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
          inputs: z.array(z.object({
            id: z.string().regex(/^[\w$]{1,64}$/),
            value: z.union([z.number(), z.string().max(256), z.boolean()]),
          })).max(20).optional(),
        })).min(1).max(24),
        minimum_trades: z.number().int().min(1).max(100_000).optional()
          .describe("Closed trades required per job. Default: 30"),
        max_runtime_seconds: z.number().int().min(30).max(1800).optional()
          .describe("Do not start another job after this soft deadline. Default: 600, maximum: 1800"),
        confirm: z.boolean().optional()
          .describe("Must be true to change the chart and run the matrix. Default: false"),
      },
    },
    async ({ expected_symbol, expected_timeframe, jobs, minimum_trades, max_runtime_seconds, confirm }) =>
      chartOperations.run(async () => {
        try {
          const minimumTrades = minimum_trades ?? 30;
          const maxRuntimeSeconds = max_runtime_seconds ?? 600;
          const initialChart = chartFingerprint(await tv.getChartContext());
          if (initialChart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
            throw new Error(`active chart symbol changed: expected ${expected_symbol}, found ${initialChart.symbol}`);
          }
          if (normalizeResolution(initialChart.timeframe) !== normalizeResolution(expected_timeframe)) {
            throw new Error(
              `active chart timeframe changed: expected ${expected_timeframe}, found ${initialChart.timeframe}`,
            );
          }

          const scripts = await tv.listPineScripts();
          const resolvedJobs = jobs.map((job) => {
            const script = scripts.find((item) => item.pineId === job.pine_id);
            if (!script) throw new Error(`strategy not found: ${job.pine_id}`);
            if (script.kind !== "strategy") throw new Error(`${job.pine_id} is not a saved strategy`);
            if (typeof script.version !== "string" || script.version.length === 0) {
              throw new Error(`saved strategy version is unavailable: ${job.pine_id}`);
            }
            const inputs = [...(job.inputs ?? [])].sort((left, right) => left.id.localeCompare(right.id));
            if (new Set(inputs.map((input) => input.id)).size !== inputs.length) {
              throw new Error(`duplicate input id in matrix job for ${job.pine_id}`);
            }
            const definition = {
              symbol: job.symbol.toUpperCase(),
              timeframe: normalizeResolution(job.timeframe),
              pineId: job.pine_id,
              pineVersion: script.version,
              name: script.name,
              inputs,
            };
            const jobId = "sha256:" + createHash("sha256")
              .update(JSON.stringify(definition), "utf8")
              .digest("hex");
            return { jobId, ...definition };
          });
          if (new Set(resolvedJobs.map((job) => job.jobId)).size !== resolvedJobs.length) {
            throw new Error("matrix contains duplicate resolved jobs");
          }
          const definition = {
            methodologyVersion: "1.0",
            minimumTrades,
            maxRuntimeSeconds,
            jobs: resolvedJobs,
          };
          const matrixId = "sha256:" + createHash("sha256")
            .update(JSON.stringify(definition), "utf8")
            .digest("hex");
          const preview = {
            schemaVersion: "1.0",
            matrixId,
            definition,
            jobCount: resolvedJobs.length,
            execution: {
              mode: "serial",
              maxJobs: 24,
              softRuntimeDeadlineSeconds: maxRuntimeSeconds,
              stopRemainingJobsOnRestoreFailure: true,
              ranking: false,
            },
            chartState: initialChart,
          };
          if (confirm !== true) return jsonResult({ dryRun: true, status: "preview", ...preview });

          const startedAt = Date.now();
          const deadline = startedAt + maxRuntimeSeconds * 1000;
          let abortReason: string | null = null;
          const results: Array<Record<string, unknown>> = [];
          for (const job of resolvedJobs) {
            if (abortReason || Date.now() >= deadline) {
              const reason = abortReason ?? "matrix soft runtime deadline reached before this job started";
              results.push({
                jobId: job.jobId,
                symbol: job.symbol,
                timeframe: job.timeframe,
                pineId: job.pineId,
                pineVersion: job.pineVersion,
                requestedInputs: job.inputs,
                status: "skipped",
                ledgerId: null,
                reportDateRange: null,
                summary: null,
                error: reason,
                cleanupError: null,
                chartRestored: abortReason === null,
              });
              continue;
            }

            const transaction = await withTemporaryChartState(
              tv,
              initialChart.index,
              { symbol: job.symbol, resolution: job.timeframe },
              () => collectExperimentVariant(
                { pineId: job.pineId, inputs: job.inputs },
                job.pineVersion,
                { symbol: job.symbol, timeframe: job.timeframe },
              ),
            );
            const run = transaction.value;
            let afterJob: ReturnType<typeof chartFingerprint> | null = null;
            let fingerprintError: string | null = null;
            try {
              afterJob = chartFingerprint(await tv.getChartContext());
            } catch (err) {
              fingerprintError = redactSecrets(err instanceof Error ? err.message : String(err));
            }
            const chartRestored = transaction.restored && afterJob !== null &&
              JSON.stringify(afterJob) === JSON.stringify(initialChart);
            if (!chartRestored) {
              const restoreMessage = transaction.restoreError instanceof Error
                ? transaction.restoreError.message
                : transaction.restoreError
                  ? String(transaction.restoreError)
                  : fingerprintError ?? "chart fingerprint differs from its pre-matrix state";
              abortReason = `chart restore failed after ${job.jobId}: ${redactSecrets(restoreMessage)}`;
            }
            const operationError = transaction.operationError
              ? redactSecrets(transaction.operationError instanceof Error
                ? transaction.operationError.message
                : String(transaction.operationError))
              : null;
            const summary = run?.evidence ? summarizeStrategyEvidence(run.evidence, minimumTrades) : null;
            const status = !chartRestored
              ? "restore_failed"
              : operationError || !run?.evidence
                ? "failed"
                : run.cleanupError
                  ? "cleanup_failed"
                  : summary?.minimumTradesMet
                    ? "complete"
                    : "insufficient_sample";
            results.push({
              jobId: job.jobId,
              symbol: job.symbol,
              timeframe: job.timeframe,
              pineId: job.pineId,
              pineVersion: job.pineVersion,
              name: job.name,
              requestedInputs: job.inputs,
              status,
              ledgerId: run?.evidence?.ledger.ledgerId ?? null,
              reportDateRange: run?.evidence?.ledger.dateRange ?? null,
              summary,
              error: operationError ?? run?.error ?? (chartRestored ? null : abortReason),
              cleanupError: run?.cleanupError ?? null,
              chartRestored,
            });
          }

          let finalChart: ReturnType<typeof chartFingerprint> | null = null;
          try {
            finalChart = chartFingerprint(await tv.getChartContext());
          } catch {
            // A per-job restore failure already carries the actionable error.
          }
          const chartRestored = finalChart !== null && JSON.stringify(finalChart) === JSON.stringify(initialChart);
          const counts = results.reduce<Record<string, number>>((acc, result) => {
            const key = String(result.status);
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {});
          const jobsWithQualityIssues = results.filter((result) => {
            const summary = result.summary;
            return summary !== null && typeof summary === "object" &&
              Array.isArray((summary as { qualityIssues?: unknown }).qualityIssues) &&
              ((summary as { qualityIssues: unknown[] }).qualityIssues.length > 0);
          }).length;
          const completedAllJobs = results.every((result) =>
            result.status === "complete" || result.status === "insufficient_sample");
          return jsonResult({
            dryRun: false,
            status: completedAllJobs && chartRestored ? "complete" : "partial",
            ...preview,
            results,
            counts,
            jobsWithQualityIssues,
            qualityIssues: [
              ...(jobsWithQualityIssues > 0 ? ["one_or_more_jobs_have_quality_issues"] : []),
              ...(counts.insufficient_sample ? ["one_or_more_jobs_have_insufficient_samples"] : []),
              ...(counts.failed ? ["one_or_more_jobs_failed"] : []),
              ...(counts.cleanup_failed ? ["one_or_more_job_cleanups_failed"] : []),
              ...(counts.restore_failed ? ["chart_state_restore_failed"] : []),
              ...(counts.skipped ? ["one_or_more_jobs_were_skipped"] : []),
            ],
            elapsedMilliseconds: Date.now() - startedAt,
            chartState: { before: initialChart, after: finalChart, restored: chartRestored },
          });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "run_strategy_walk_forward",
    {
      description:
        "Run a bounded Pine Strategy walk-forward evaluation from full, immutable trade " +
        "ledgers. Two to eight exact saved strategy/input candidates are collected serially " +
        "on the bound chart, then partitioned into two to twelve explicit train, embargo, " +
        "and test windows by closed-trade entry/exit time. Selection uses train metrics only; " +
        "only the selected candidate's test metrics are exposed. Candidate failure, ledger " +
        "quality issues, cost-condition differences, ties, and insufficient samples are not " +
        "silently ignored. Without confirm=true this only previews the plan. Never places orders.",
      inputSchema: {
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SHDW]|[SHDW])$/i),
        candidates: z.array(z.object({
          pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
          inputs: z.array(z.object({
            id: z.string().regex(/^[\w$]{1,64}$/),
            value: z.union([z.number(), z.string().max(256), z.boolean()]),
          })).max(20).optional(),
        })).min(2).max(8),
        folds: z.array(z.object({
          fold_id: z.string().regex(/^[\w.:-]{1,80}$/),
          train_from: z.string().datetime({ offset: true }),
          train_to: z.string().datetime({ offset: true }),
          test_from: z.string().datetime({ offset: true }),
          test_to: z.string().datetime({ offset: true }),
        })).min(2).max(12),
        mode: z.enum(["anchored", "rolling"]),
        embargo_bars: z.number().int().min(1).max(100).optional()
          .describe("Closed bars between train and test. Default: 1"),
        minimum_train_trades: z.number().int().min(1).max(100_000).optional()
          .describe("Trades required to select a candidate in each train fold. Default: 30"),
        minimum_test_trades: z.number().int().min(1).max(100_000).optional()
          .describe("Trades required for each selected OOS fold. Default: 10"),
        selection_metric: z.enum(["expectancy", "netProfit", "profitFactor"]).optional()
          .describe("Train-only metric to maximize. Default: expectancy"),
        max_runtime_seconds: z.number().int().min(30).max(1800).optional()
          .describe("Do not start another candidate after this soft deadline. Default: 600"),
        confirm: z.boolean().optional(),
      },
    },
    async ({ expected_symbol, expected_timeframe, candidates, folds, mode, embargo_bars,
      minimum_train_trades, minimum_test_trades, selection_metric, max_runtime_seconds, confirm }) =>
      chartOperations.run(async () => {
        try {
          const embargoBars = embargo_bars ?? 1;
          const minimumTrainTrades = minimum_train_trades ?? 30;
          const minimumTestTrades = minimum_test_trades ?? 10;
          const selectionMetric = selection_metric ?? "expectancy";
          const maxRuntimeSeconds = max_runtime_seconds ?? 600;
          const initialChart = chartFingerprint(await tv.getChartContext());
          if (initialChart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
            throw new Error(`active chart symbol changed: expected ${expected_symbol}, found ${initialChart.symbol}`);
          }
          if (normalizeResolution(initialChart.timeframe) !== normalizeResolution(expected_timeframe)) {
            throw new Error(
              `active chart timeframe changed: expected ${expected_timeframe}, found ${initialChart.timeframe}`,
            );
          }
          const scripts = await tv.listPineScripts();
          const resolvedCandidates = candidates.map((candidate) => {
            const script = scripts.find((item) => item.pineId === candidate.pine_id);
            if (!script) throw new Error(`strategy not found: ${candidate.pine_id}`);
            if (script.kind !== "strategy") throw new Error(`${candidate.pine_id} is not a saved strategy`);
            if (typeof script.version !== "string" || script.version.length === 0) {
              throw new Error(`saved strategy version is unavailable: ${candidate.pine_id}`);
            }
            const inputs = [...(candidate.inputs ?? [])].sort((left, right) => left.id.localeCompare(right.id));
            if (new Set(inputs.map((input) => input.id)).size !== inputs.length) {
              throw new Error(`duplicate input id in walk-forward candidate ${candidate.pine_id}`);
            }
            const candidateDefinition = {
              pineId: candidate.pine_id,
              pineVersion: script.version,
              name: script.name,
              inputs,
            };
            const candidateId = "sha256:" + createHash("sha256")
              .update(JSON.stringify(candidateDefinition), "utf8")
              .digest("hex");
            return { candidateId, ...candidateDefinition };
          });
          if (new Set(resolvedCandidates.map((candidate) => candidate.candidateId)).size !==
            resolvedCandidates.length) {
            throw new Error("walk-forward contains duplicate resolved candidates");
          }
          const resolvedFolds: StrategyWalkForwardFold[] = folds.map((fold) => ({
            foldId: fold.fold_id,
            trainFrom: fold.train_from,
            trainTo: fold.train_to,
            testFrom: fold.test_from,
            testTo: fold.test_to,
          }));
          validateStrategyWalkForwardFolds(
            resolvedFolds,
            mode,
            initialChart.timeframe,
            embargoBars,
          );
          const definition = {
            methodologyVersion: "ledger_partition_v1",
            symbol: initialChart.symbol,
            timeframe: initialChart.timeframe,
            mode,
            embargoBars,
            minimumTrainTrades,
            minimumTestTrades,
            selectionMetric,
            maxRuntimeSeconds,
            candidates: resolvedCandidates,
            folds: resolvedFolds,
          };
          const walkForwardId = "sha256:" + createHash("sha256")
            .update(JSON.stringify(definition), "utf8")
            .digest("hex");
          const preview = {
            schemaVersion: "1.0",
            walkForwardId,
            definition,
            execution: {
              mode: "serial_candidate_collection_then_ledger_partition",
              candidateCount: resolvedCandidates.length,
              foldCount: resolvedFolds.length,
              maxCandidates: 8,
              maxFolds: 12,
              nonSelectedOosMetricsExposed: false,
              stopOnRestoreFailure: true,
              ranking: false,
            },
            chartState: initialChart,
          };
          if (confirm !== true) return jsonResult({ dryRun: true, status: "preview", ...preview });

          const startedAt = Date.now();
          const deadline = startedAt + maxRuntimeSeconds * 1000;
          let abortReason: string | null = null;
          const runs: Array<{
            candidate: typeof resolvedCandidates[number];
            evidence: { report: StrategyReport; ledger: StrategyTradeLedger } | null;
            error: string | null;
            cleanupError: string | null;
            chartRestored: boolean;
          }> = [];
          for (const candidate of resolvedCandidates) {
            if (abortReason || Date.now() >= deadline) {
              runs.push({
                candidate,
                evidence: null,
                error: abortReason ?? "walk-forward soft runtime deadline reached before candidate started",
                cleanupError: null,
                chartRestored: abortReason === null,
              });
              continue;
            }
            const run = await collectExperimentVariant(
              { pineId: candidate.pineId, inputs: candidate.inputs },
              candidate.pineVersion,
              { symbol: initialChart.symbol, timeframe: initialChart.timeframe },
            );
            let afterCandidate: ReturnType<typeof chartFingerprint> | null = null;
            try {
              afterCandidate = chartFingerprint(await tv.getChartContext());
            } catch {
              // The failed fingerprint is represented as a restore failure below.
            }
            const chartRestored = afterCandidate !== null &&
              JSON.stringify(afterCandidate) === JSON.stringify(initialChart);
            if (!chartRestored) {
              abortReason = `chart restore failed after candidate ${candidate.candidateId}`;
            }
            runs.push({ candidate, ...run, chartRestored });
          }

          const allEvidenceAvailable = runs.every((run) =>
            run.evidence !== null && run.error === null && run.cleanupError === null && run.chartRestored);
          let conditionChecks: Array<ReturnType<typeof compareStrategyConditions>> = [];
          if (allEvidenceAvailable) {
            const reference = runs[0].evidence!.ledger;
            conditionChecks = runs.slice(1).map((run) =>
              compareStrategyConditions(reference, run.evidence!.ledger));
          }
          const conditionsMatched = allEvidenceAvailable && conditionChecks.every((check) => check.matched);
          const evaluation = !allEvidenceAvailable
            ? null
            : !conditionsMatched
              ? {
                status: "not_evaluable" as const,
                methodologyVersion: "ledger_partition_v1",
                blockers: ["candidate_conditions_differ"],
                folds: [],
                oosAggregate: null,
              }
              : evaluateStrategyWalkForward({
                candidates: runs.map((run) => ({
                  candidateId: run.candidate.candidateId,
                  ledger: run.evidence!.ledger,
                })),
                folds: resolvedFolds,
                mode,
                timeframe: initialChart.timeframe,
                embargoBars,
                minimumTrainTrades,
                minimumTestTrades,
                selectionMetric,
              });
          let finalChart: ReturnType<typeof chartFingerprint> | null = null;
          try {
            finalChart = chartFingerprint(await tv.getChartContext());
          } catch {
            // Candidate results retain the restore failure.
          }
          const chartRestored = finalChart !== null && JSON.stringify(finalChart) === JSON.stringify(initialChart);
          const candidateResults = runs.map((run) => ({
            candidateId: run.candidate.candidateId,
            pineId: run.candidate.pineId,
            pineVersion: run.candidate.pineVersion,
            name: run.candidate.name,
            requestedInputs: run.candidate.inputs,
            status: run.evidence && !run.error && !run.cleanupError && run.chartRestored ? "collected" : "failed",
            ledgerId: run.evidence?.ledger.ledgerId ?? null,
            reportDateRange: run.evidence?.ledger.dateRange ?? null,
            ledgerQualityIssues: run.evidence?.ledger.qualityIssues ?? [],
            countMatchesSummary: run.evidence?.ledger.countMatchesSummary ?? null,
            error: run.error,
            cleanupError: run.cleanupError,
            chartRestored: run.chartRestored,
          }));
          return jsonResult({
            dryRun: false,
            status: evaluation?.status ?? "partial",
            ...preview,
            candidates: candidateResults,
            conditions: {
              matched: conditionsMatched,
              comparisons: conditionChecks,
            },
            evaluation,
            qualityIssues: [
              ...(!allEvidenceAvailable ? ["candidate_collection_incomplete"] : []),
              ...(allEvidenceAvailable && !conditionsMatched ? ["candidate_conditions_differ"] : []),
              ...(!chartRestored ? ["chart_state_restore_failed"] : []),
              ...((evaluation?.blockers.length ?? 0) > 0 ? ["walk_forward_not_evaluable"] : []),
              ...(evaluation?.status === "partial" ? ["one_or_more_folds_not_evaluable"] : []),
            ],
            elapsedMilliseconds: Date.now() - startedAt,
            chartState: { before: initialChart, after: finalChart, restored: chartRestored },
          });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "stress_test_strategy",
    {
      description:
        "Run bounded robustness tests for one exact saved Pine strategy. After a dry-run preview, " +
        "confirm=true collects a baseline full ledger, applies modeled cost, commission, period-start, " +
        "and seeded bootstrap scenarios, and can serially rerun up to eight explicit Pine input-override " +
        "scenarios for Entry-delay, Stop/Target, or parameter-neighbor effects. Every temporary Strategy " +
        "is removed and the chart fingerprint is checked before continuing. Results include failures, " +
        "distributions, worst cases, and degradation without ranking, adoption, fabricated fills, or orders.",
      inputSchema: {
        protocol_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SHDW]|[SHDW])$/i),
        pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
        pine_version: z.string().regex(/^\d+(?:\.\d+)*$/),
        inputs: z.array(z.object({
          id: z.string().regex(/^[\w$]{1,64}$/),
          value: z.union([z.number(), z.string().max(256), z.boolean()]),
        })).max(20).optional(),
        evaluation_from: z.string().datetime({ offset: true }),
        evaluation_to: z.string().datetime({ offset: true }),
        minimum_trades: z.number().int().min(1).max(100_000),
        scenarios: z.array(z.discriminatedUnion("kind", [
          z.object({ scenario_id: z.string().regex(/^[\w.:-]{1,80}$/), kind: z.literal("additional_cost_per_trade"), value: z.number().finite().min(0) }),
          z.object({ scenario_id: z.string().regex(/^[\w.:-]{1,80}$/), kind: z.literal("commission_multiplier"), value: z.number().finite().min(1).max(100) }),
          z.object({ scenario_id: z.string().regex(/^[\w.:-]{1,80}$/), kind: z.literal("start_shift_bars"), value: z.number().int().min(1).max(100) }),
        ])).min(1).max(20),
        rerun_scenarios: z.array(z.object({
          scenario_id: z.string().regex(/^[\w.:-]{1,80}$/),
          input_overrides: z.array(z.object({
            id: z.string().regex(/^[\w$]{1,64}$/),
            value: z.union([z.number(), z.string().max(256), z.boolean()]),
          })).min(1).max(20),
        })).max(8).optional(),
        bootstrap: z.object({
          seed: z.string().min(1).max(128),
          iterations: z.number().int().min(100).max(10_000),
          failure_net_profit: z.number().finite().optional(),
        }).nullable().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ protocol_id, expected_symbol, expected_timeframe, pine_id, pine_version, inputs,
      evaluation_from, evaluation_to, minimum_trades, scenarios, rerun_scenarios, bootstrap, confirm }) =>
      chartOperations.run(async () => {
        try {
          const initialChart = chartFingerprint(await tv.getChartContext());
          if (initialChart.symbol.toUpperCase() !== expected_symbol.toUpperCase()) {
            throw new Error(`active chart symbol changed: expected ${expected_symbol}, found ${initialChart.symbol}`);
          }
          if (normalizeResolution(initialChart.timeframe) !== normalizeResolution(expected_timeframe)) {
            throw new Error(`active chart timeframe changed: expected ${expected_timeframe}, found ${initialChart.timeframe}`);
          }
          const script = (await tv.listPineScripts()).find((item) => item.pineId === pine_id);
          if (!script) throw new Error(`strategy not found: ${pine_id}`);
          if (script.kind !== "strategy") throw new Error(`${pine_id} is not a saved strategy`);
          if (script.version !== pine_version) {
            throw new Error(`saved strategy version changed: expected ${pine_version}, found ${script.version ?? "unavailable"}`);
          }
          const resolvedInputs = [...(inputs ?? [])].sort((left, right) => left.id.localeCompare(right.id));
          if (new Set(resolvedInputs.map((input) => input.id)).size !== resolvedInputs.length) {
            throw new Error("stress test contains duplicate input ids");
          }
          const resolvedScenarios: StrategyStressScenario[] = scenarios.map((scenario) => ({
            scenarioId: scenario.scenario_id,
            kind: scenario.kind,
            value: scenario.value,
          }));
          if (new Set(resolvedScenarios.map((scenario) => scenario.scenarioId)).size !== resolvedScenarios.length) {
            throw new Error("stress test scenario ids must be unique");
          }
          const resolvedRerunScenarios = (rerun_scenarios ?? []).map((scenario) => {
            const inputOverrides = [...scenario.input_overrides]
              .sort((left, right) => left.id.localeCompare(right.id));
            if (new Set(inputOverrides.map((input) => input.id)).size !== inputOverrides.length) {
              throw new Error(`rerun scenario ${scenario.scenario_id} contains duplicate input ids`);
            }
            return { scenarioId: scenario.scenario_id, inputOverrides };
          });
          const allScenarioIds = [
            ...resolvedScenarios.map((scenario) => scenario.scenarioId),
            ...resolvedRerunScenarios.map((scenario) => scenario.scenarioId),
          ];
          if (new Set(allScenarioIds).size !== allScenarioIds.length) {
            throw new Error("modeled and rerun stress scenario ids must be unique");
          }
          const hasReruns = resolvedRerunScenarios.length > 0;
          const definition = {
            methodologyVersion: hasReruns ? "strategy_stress_v2" : "ledger_stress_v1",
            protocolId: protocol_id,
            symbol: initialChart.symbol,
            timeframe: initialChart.timeframe,
            pineId: pine_id,
            pineVersion: pine_version,
            inputs: resolvedInputs,
            evaluationFrom: evaluation_from,
            evaluationTo: evaluation_to,
            minimumTrades: minimum_trades,
            scenarios: resolvedScenarios,
            ...(hasReruns ? { rerunScenarios: resolvedRerunScenarios } : {}),
            bootstrap: bootstrap === null || bootstrap === undefined ? null : {
              seed: bootstrap.seed,
              iterations: bootstrap.iterations,
              failureNetProfit: bootstrap.failure_net_profit ?? 0,
            },
          };
          const stressTestId = "sha256:" + createHash("sha256")
            .update(JSON.stringify(definition), "utf8").digest("hex");
          const preview = {
            schemaVersion: "1.0",
            stressTestId,
            definition,
            execution: {
              mode: hasReruns
                ? "baseline_ledger_plus_serial_strategy_reruns_then_modeled_stress"
                : "single_ledger_collection_then_modeled_stress",
              chartWrites: "temporary_strategy_add_input_apply_remove",
              automaticRanking: false,
              automaticAdoption: false,
              ...(hasReruns ? {
                rerunEffects: "caller_defined_pine_input_overrides_executed_by_strategy_tester",
                maximumReruns: 8,
              } : {
                unsupportedModeledEffects: ["entry_delay", "stop_target_perturbation", "parameter_neighbors"],
              }),
            },
            chartState: initialChart,
          };
          if (confirm !== true) return jsonResult({ dryRun: true, status: "preview", ...preview });

          const run = await collectExperimentVariant(
            { pineId: pine_id, inputs: resolvedInputs },
            pine_version,
            { symbol: initialChart.symbol, timeframe: initialChart.timeframe },
          );
          let afterBaseline: ReturnType<typeof chartFingerprint> | null = null;
          try { afterBaseline = chartFingerprint(await tv.getChartContext()); } catch { /* represented below */ }
          const baselineRestored = afterBaseline !== null &&
            JSON.stringify(afterBaseline) === JSON.stringify(initialChart);
          const baselineCollectionComplete = run.evidence !== null && run.error === null &&
            run.cleanupError === null && baselineRestored;
          const rerunCollections: Array<{
            scenarioId: string;
            inputOverrides: typeof resolvedInputs;
            appliedInputs: typeof resolvedInputs;
            status: "complete" | "failed" | "skipped";
            ledgerId: string | null;
            reportDateRange: StrategyTradeLedger["dateRange"] | null;
            ledgerQualityIssues: string[];
            countMatchesSummary: boolean | null;
            error: string | null;
            cleanupError: string | null;
            chartRestored: boolean;
            ledger: StrategyTradeLedger | null;
          }> = [];
          let stopReruns = !baselineCollectionComplete;
          for (const scenario of resolvedRerunScenarios) {
            const merged = new Map(resolvedInputs.map((input) => [input.id, input]));
            for (const override of scenario.inputOverrides) merged.set(override.id, override);
            const appliedInputs = [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
            if (stopReruns) {
              rerunCollections.push({
                scenarioId: scenario.scenarioId,
                inputOverrides: scenario.inputOverrides,
                appliedInputs,
                status: "skipped",
                ledgerId: null,
                reportDateRange: null,
                ledgerQualityIssues: [],
                countMatchesSummary: null,
                error: baselineCollectionComplete
                  ? "prior_rerun_did_not_restore_chart"
                  : "baseline_collection_incomplete",
                cleanupError: null,
                chartRestored: false,
                ledger: null,
              });
              continue;
            }
            const rerun = await collectExperimentVariant(
              { pineId: pine_id, inputs: appliedInputs },
              pine_version,
              { symbol: initialChart.symbol, timeframe: initialChart.timeframe },
            );
            let afterRerun: ReturnType<typeof chartFingerprint> | null = null;
            try { afterRerun = chartFingerprint(await tv.getChartContext()); } catch { /* represented below */ }
            const rerunRestored = afterRerun !== null &&
              JSON.stringify(afterRerun) === JSON.stringify(initialChart);
            const complete = rerun.evidence !== null && rerun.error === null &&
              rerun.cleanupError === null && rerunRestored;
            rerunCollections.push({
              scenarioId: scenario.scenarioId,
              inputOverrides: scenario.inputOverrides,
              appliedInputs,
              status: complete ? "complete" : "failed",
              ledgerId: rerun.evidence?.ledger.ledgerId ?? null,
              reportDateRange: rerun.evidence?.ledger.dateRange ?? null,
              ledgerQualityIssues: rerun.evidence?.ledger.qualityIssues ?? [],
              countMatchesSummary: rerun.evidence?.ledger.countMatchesSummary ?? null,
              error: rerun.error,
              cleanupError: rerun.cleanupError,
              chartRestored: rerunRestored,
              ledger: complete ? rerun.evidence!.ledger : null,
            });
            if (!rerunRestored) stopReruns = true;
          }
          let finalChart: ReturnType<typeof chartFingerprint> | null = null;
          try { finalChart = chartFingerprint(await tv.getChartContext()); } catch { /* represented below */ }
          const chartRestored = finalChart !== null && JSON.stringify(finalChart) === JSON.stringify(initialChart);
          const collectionComplete = baselineCollectionComplete && chartRestored;
          const evaluation = collectionComplete ? evaluateStrategyStress({
            ledger: run.evidence!.ledger,
            evaluationFrom: evaluation_from,
            evaluationTo: evaluation_to,
            timeframe: initialChart.timeframe,
            minimumTrades: minimum_trades,
            scenarios: resolvedScenarios,
            bootstrap: definition.bootstrap,
          }) : null;
          const rerunEvaluation = collectionComplete && hasReruns ? evaluateStrategyRerunStress({
            baselineLedger: run.evidence!.ledger,
            evaluationFrom: evaluation_from,
            evaluationTo: evaluation_to,
            timeframe: initialChart.timeframe,
            minimumTrades: minimum_trades,
            scenarios: rerunCollections.map((item) => ({
              scenarioId: item.scenarioId,
              ledger: item.ledger,
              collectionIssue: item.error ?? item.cleanupError ??
                (item.chartRestored ? null : "chart_state_restore_failed"),
            })),
          }) : null;
          const combinedStatus = evaluation === null
            ? "partial"
            : evaluation.status !== "complete" || (hasReruns && rerunEvaluation?.status !== "complete")
              ? "partial"
              : "complete";
          return jsonResult({
            dryRun: false,
            status: combinedStatus,
            ...preview,
            collection: {
              status: collectionComplete ? "complete" : "failed",
              ledgerId: run.evidence?.ledger.ledgerId ?? null,
              reportDateRange: run.evidence?.ledger.dateRange ?? null,
              ledgerQualityIssues: run.evidence?.ledger.qualityIssues ?? [],
              countMatchesSummary: run.evidence?.ledger.countMatchesSummary ?? null,
              error: run.error,
              cleanupError: run.cleanupError,
            },
            ...(hasReruns ? {
              rerunCollections: rerunCollections.map(({ ledger: _ledger, ...item }) => item),
            } : {}),
            evaluation,
            ...(hasReruns ? { rerunEvaluation } : {}),
            qualityIssues: [
              ...(!collectionComplete ? ["ledger_collection_incomplete"] : []),
              ...(!chartRestored ? ["chart_state_restore_failed"] : []),
              ...(evaluation?.status === "not_evaluable" ? ["stress_not_evaluable"] : []),
              ...(evaluation?.status === "partial" ? ["one_or_more_scenarios_not_evaluable"] : []),
              ...(hasReruns && rerunCollections.some((item) => item.status !== "complete")
                ? ["one_or_more_rerun_collections_incomplete"] : []),
              ...(hasReruns && rerunEvaluation?.status === "not_evaluable"
                ? ["rerun_stress_not_evaluable"] : []),
              ...(hasReruns && rerunEvaluation?.status === "partial"
                ? ["one_or_more_rerun_scenarios_not_evaluable"] : []),
            ],
            chartState: { before: initialChart, after: finalChart, restored: chartRestored },
          });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "register_strategy_hypothesis",
    {
      description:
        "Register one immutable strategy-research hypothesis and its evaluation contract " +
        "in a local append-only journal. This does not access TradingView or run a test. " +
        "Reusing a hypothesis_id with a different definition is rejected.",
      inputSchema: {
        hypothesis_id: z.string().regex(/^[\w.:-]{1,80}$/),
        title: z.string().min(1).max(120),
        thesis: z.string().min(1).max(2000),
        parent_experiment_id: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
        evaluation_contract: z.object({
          population: RESEARCH_POPULATION_SCHEMA,
          primary_metric: z.string().min(1).max(64),
          minimum_trades: z.number().int().min(1).max(100_000),
          symbols: z.array(SYMBOL_SCHEMA).min(1).max(20),
          timeframes: z.array(z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i)).min(1).max(20),
          minimum_profit_factor: z.number().min(0).nullable().optional(),
          maximum_drawdown_percent: z.number().min(0).nullable().optional(),
        }),
      },
    },
    async ({ hypothesis_id, title, thesis, parent_experiment_id, evaluation_contract }) => {
      try {
        return jsonResult(await researchJournal.registerHypothesis({
          hypothesisId: hypothesis_id,
          title,
          thesis,
          parentExperimentId: parent_experiment_id ?? null,
          evaluationContract: {
            population: evaluation_contract.population,
            primaryMetric: evaluation_contract.primary_metric,
            minimumTrades: evaluation_contract.minimum_trades,
            symbols: evaluation_contract.symbols,
            timeframes: evaluation_contract.timeframes,
            minimumProfitFactor: evaluation_contract.minimum_profit_factor ?? null,
            maximumDrawdownPercent: evaluation_contract.maximum_drawdown_percent ?? null,
          },
        }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  const researchVariantSchema = z.object({
    pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
    pine_version: z.string().min(1).max(32),
    ledger_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    metrics: RESEARCH_METRICS_SCHEMA,
  });

  server.registerTool(
    "record_strategy_experiment",
    {
      description:
        "Append one exact strategy experiment result to the research journal. The record " +
        "binds the hypothesis, population, Pine versions, full-ledger ids, known metrics, " +
        "guardrails, and decision. It stores no OHLC or source code and never touches a chart.",
      inputSchema: {
        experiment_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        hypothesis_id: z.string().regex(/^[\w.:-]{1,80}$/),
        parent_experiment_id: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
        population: RESEARCH_POPULATION_SCHEMA,
        methodology_version: z.string().min(1).max(40),
        symbol: SYMBOL_SCHEMA,
        timeframe: z.string().regex(/^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i),
        baseline: researchVariantSchema,
        candidate: researchVariantSchema,
        conditions_matched: z.boolean(),
        minimum_trades_met: z.boolean(),
        decision: z.enum(["adopted", "rejected", "inconclusive"]),
        note: z.string().max(500).optional(),
      },
    },
    async ({ experiment_id, hypothesis_id, parent_experiment_id, population, methodology_version,
      symbol, timeframe, baseline, candidate, conditions_matched, minimum_trades_met, decision, note }) => {
      try {
        return jsonResult(await researchJournal.recordExperiment({
          experimentId: experiment_id,
          hypothesisId: hypothesis_id,
          parentExperimentId: parent_experiment_id ?? null,
          population,
          methodologyVersion: methodology_version,
          symbol,
          timeframe,
          baseline: {
            pineId: baseline.pine_id,
            pineVersion: baseline.pine_version,
            ledgerId: baseline.ledger_id,
            metrics: baseline.metrics,
          },
          candidate: {
            pineId: candidate.pine_id,
            pineVersion: candidate.pine_version,
            ledgerId: candidate.ledger_id,
            metrics: candidate.metrics,
          },
          conditionsMatched: conditions_matched,
          minimumTradesMet: minimum_trades_met,
          decision,
          note: note ?? "",
        }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "compare_strategy_experiments",
    {
      description:
        "Compare two to twenty exact saved experiment-evidence records without ranking or " +
        "combining incompatible populations. References must include both experiment_id " +
        "and evidence_hash. Read-only and does not access TradingView.",
      inputSchema: {
        references: z.array(z.object({
          experiment_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          evidence_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        })).min(2).max(20),
      },
    },
    async ({ references }) => {
      try {
        return jsonResult(await researchJournal.compare(references.map((reference) => ({
          experimentId: reference.experiment_id,
          evidenceHash: reference.evidence_hash,
        }))));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "run_backtest",
    {
      description:
        "Backtest one of the user's OWN saved strategies on the active chart's current " +
        "symbol and timeframe: temporarily applies the strategy, waits for the Strategy " +
        "Tester report, returns it (same shape as get_strategy_report) and removes the " +
        "strategy again so the chart is left unchanged (set keep_on_chart to keep it). " +
        "Get strategy pine_ids (kind 'strategy') from list_pine_scripts. Combine with " +
        "set_symbol/set_timeframe to test other markets.",
      inputSchema: {
        pine_id: z
          .string()
          .regex(/^USER;[\w]{8,64}$/)
          .describe("Strategy script id from list_pine_scripts, e.g. 'USER;71f1e4e6807c4bb48bd55edb886908a0'"),
        trades_limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max most-recent trades to include. Default: 20"),
        keep_on_chart: z
          .boolean()
          .optional()
          .describe("Leave the strategy on the chart after the test. Default: false (auto-remove)"),
      },
    },
    async ({ pine_id, trades_limit, keep_on_chart }) =>
      chartOperations.run(async () => {
        try {
          return jsonResult(
            await tv.runBacktest({
              pineId: pine_id,
              tradesLimit: trades_limit ?? 20,
              keepOnChart: keep_on_chart ?? false,
            }),
          );
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "list_alerts",
    {
      description:
        "List the user's TradingView price alerts (read-only): symbol, condition, active " +
        "state, last fire time. This tool does not create, modify, restart, or delete alerts.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await tv.listAlerts());
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "create_analysis_alerts",
    {
      description:
        "Preview or create bounded, one-shot TradingView price alerts for Confirmation, " +
        "Invalidation, and Target 1 from one audited Bushido Analysis Overlay. It verifies " +
        "the exact Pine source, chart binding, analysis_id, current price, existing owned " +
        "alerts, and post-create readback. Without confirm=true it is read-only. It never " +
        "uses webhooks, email, SMS, broker APIs, or orders.",
      inputSchema: {
        pine_id: z.string().regex(/^USER;[\w]{8,64}$/),
        chart_index: z.number().int().min(0).optional(),
        expected_symbol: SYMBOL_SCHEMA,
        expected_timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/),
        analysis_id: z.string().regex(/^[\w.:-]{1,80}$/),
        mobile_push: z.boolean().optional().describe("Notify in the TradingView app. Default: true"),
        popup: z.boolean().optional().describe("Show a TradingView popup. Default: true"),
        play_sound: z.boolean().optional().describe("Play TradingView's calling sound. Default: false"),
        confirm: z.boolean().optional().describe("Must be true to create alerts. Default: false"),
      },
    },
    async ({
      pine_id,
      chart_index,
      expected_symbol,
      expected_timeframe,
      analysis_id,
      mobile_push,
      popup,
      play_sound,
      confirm,
    }) => chartOperations.run(async () => {
      try {
        const context = await tv.getChartContext();
        const chart = resolveAnalysisChart(context, chart_index, expected_symbol, expected_timeframe);
        const scripts = await tv.listPineScripts();
        const script = scripts.find((candidate) => candidate.pineId === pine_id);
        if (!script || script.name !== ANALYSIS_OVERLAY_NAME || script.kind !== "study") {
          return jsonResult({ status: "blocked", reason: "analysis_overlay_not_owned", trusted: false });
        }
        const usages = script.usedBy.filter((usage) => usage.chartIndex === chart.index);
        if (usages.length !== 1) {
          return jsonResult({
            status: "blocked",
            reason: usages.length === 0 ? "analysis_overlay_not_installed" : "multiple_overlay_instances",
            trusted: false,
            usages,
          });
        }
        const usage = usages[0];
        if (!usage.version) {
          return jsonResult({ status: "blocked", reason: "on_chart_pine_version_unavailable", trusted: false });
        }
        const placedSource = await tv.getPineSource(pine_id, usage.version);
        if (placedSource.source.replace(/\r\n/g, "\n") !== ANALYSIS_OVERLAY_SOURCE.replace(/\r\n/g, "\n")) {
          return jsonResult({
            status: "blocked",
            reason: "on_chart_source_does_not_match_audited_template",
            trusted: false,
          });
        }
        const inputResult = await tv.getIndicatorInputs({ studyId: usage.studyId, chartIndex: chart.index });
        let analysis: ReturnType<typeof parseAnalysisOverlayState>;
        try {
          analysis = parseAnalysisOverlayState(assertAnalysisOverlayStudy(inputResult, usage.studyId));
        } catch (err) {
          return jsonResult({
            status: "blocked",
            reason: "inputs_violate_contract",
            trusted: false,
            detail: err instanceof Error ? err.message : "overlay inputs are invalid",
          });
        }
        if (
          analysis.analysisId.trim().toLowerCase() === ANALYSIS_OVERLAY_DEFAULT_ANALYSIS_ID
          || analysis.analyzedAt === ANALYSIS_OVERLAY_DEFAULT_ANALYZED_AT
        ) {
          return jsonResult({ status: "blocked", reason: "default_analysis_inputs", trusted: false });
        }
        if (analysis.analysisId !== analysis_id) {
          return jsonResult({
            status: "blocked",
            reason: "analysis_id_mismatch",
            trusted: false,
            expectedAnalysisId: analysis_id,
            observedAnalysisId: analysis.analysisId,
          });
        }
        const binding = compareAnalysisOverlayBinding(analysis, chart.symbol, chart.resolution);
        if (!binding.matches) {
          return jsonResult({
            status: "blocked",
            reason: "analysis_context_mismatch",
            trusted: false,
            mismatches: binding.mismatches,
          });
        }

        let plans;
        try {
          plans = buildAnalysisAlertPlans(analysis, chart.symbol, chart.resolution);
        } catch (err) {
          return jsonResult({
            status: "blocked",
            reason: "analysis_not_alertable",
            trusted: true,
            detail: err instanceof Error ? err.message : "analysis cannot be monitored with price alerts",
          });
        }
        const ohlcv = await tv.getOhlcv(1, chart.index);
        const latestBar = ohlcv.bars.at(-1);
        if (!latestBar || ohlcv.symbol.toUpperCase() !== chart.symbol.toUpperCase()
            || normalizeResolution(ohlcv.resolution) !== normalizeResolution(chart.resolution)
            || !Number.isFinite(latestBar.close) || latestBar.close <= 0) {
          return jsonResult({ status: "blocked", reason: "current_price_unavailable", trusted: false });
        }
        const currentPrice = latestBar.close;
        const bullish = analysis.bias === "bullish";
        const terminalReached = bullish
          ? currentPrice <= analysis.invalidation || currentPrice >= analysis.targets[0]
          : currentPrice >= analysis.invalidation || currentPrice <= analysis.targets[0];
        if (terminalReached) {
          return jsonResult({
            status: "blocked",
            reason: "terminal_level_currently_reached",
            trusted: true,
            currentPrice,
            invalidation: analysis.invalidation,
            target1: analysis.targets[0],
            limitation: "Current price does not prove historical touch order.",
          });
        }
        const confirmationCurrentlyReached = analysis.confirmation !== null && (bullish
          ? currentPrice >= analysis.confirmation
          : currentPrice <= analysis.confirmation);
        const omitted = confirmationCurrentlyReached
          ? [{ kind: "confirmation", reason: "confirmation_currently_reached" }]
          : [];
        if (confirmationCurrentlyReached) plans = plans.filter((plan) => plan.kind !== "confirmation");

        const beforeAlerts = await tv.listAlerts();
        const beforeMatches = matchExistingAnalysisAlerts(plans, beforeAlerts);
        const conflicts = beforeMatches.filter((match) => match.status === "conflict");
        if (conflicts.length > 0) {
          return jsonResult({
            status: "blocked",
            reason: "owned_alert_definition_conflict",
            trusted: true,
            conflicts: conflicts.map((match) => ({
              kind: match.plan.kind,
              ownershipName: match.plan.ownershipName,
              alertId: match.alert?.id ?? null,
              mismatches: match.mismatches,
            })),
            remediation: "Resolve the conflicting owned alerts in TradingView before retrying; MCP never overwrites them.",
          });
        }
        const existing = beforeMatches.filter((match) => match.status === "exact");
        const missing = beforeMatches.filter((match) => match.status === "missing");
        const missingConfirmation = missing.some((match) => match.plan.kind === "confirmation");
        const existingTerminalMonitor = existing.some((match) =>
          match.plan.kind === "invalidation" || match.plan.kind === "target_1");
        if (!confirmationCurrentlyReached && missingConfirmation && existingTerminalMonitor) {
          return jsonResult({
            status: "blocked",
            reason: "ambiguous_missing_confirmation_alert",
            trusted: true,
            existing: existing.map((match) => ({ kind: match.plan.kind, alertId: match.alert?.id ?? null })),
            remediation:
              "Do not add Confirmation retroactively. Inspect the analysis journal and TradingView alert history; use a new analysis_id for a new monitoring lifecycle.",
          });
        }
        const notification = {
          mobilePush: mobile_push ?? true,
          popup: popup ?? true,
          playSound: play_sound ?? false,
          email: false,
          smsOverEmail: false,
          webhook: false,
        };
        const preview = {
          analysisId: analysis.analysisId,
          symbol: chart.symbol,
          timeframe: chart.resolution,
          currentPrice,
          expiresAt: analysis.expiresAt,
          notification,
          existing: existing.map((match) => ({ kind: match.plan.kind, alertId: match.alert?.id ?? null })),
          create: missing.map((match) => match.plan),
          omitted,
          limitation: "Alerts monitor crossings from creation time; they do not prove earlier level touches.",
        };
        if (confirm !== true) {
          return jsonResult({
            status: "preview",
            dryRun: true,
            changed: false,
            trusted: true,
            confirmRequired: missing.length > 0,
            preview,
          });
        }

        const created: unknown[] = [];
        const failures: Array<{ kind: string; error: string; state: "not_verified" }> = [];
        for (const match of missing) {
          try {
            created.push(await tv.createPriceAlert({
              symbol: match.plan.symbol,
              resolution: match.plan.resolution,
              operator: match.plan.operator,
              level: match.plan.level,
              expiration: match.plan.expiration,
              name: match.plan.ownershipName,
              message: match.plan.message,
              mobilePush: notification.mobilePush,
              popup: notification.popup,
              playSound: notification.playSound,
            }));
          } catch (err) {
            failures.push({
              kind: match.plan.kind,
              error: redactSecrets(err instanceof Error ? err.message : String(err)),
              state: "not_verified",
            });
            break;
          }
        }
        const finalAlerts = await tv.listAlerts();
        const finalMatches = matchExistingAnalysisAlerts(plans, finalAlerts);
        const verified = finalMatches.filter((match) => match.status === "exact");
        const unresolved = finalMatches.filter((match) => match.status !== "exact");
        const complete = failures.length === 0 && unresolved.length === 0;
        let journalStatus: Record<string, unknown> = { requested: complete, recorded: false };
        if (complete) {
          try {
            const definition = journalDefinition(analysis, {
              symbol: chart.symbol,
              timeframe: chart.resolution,
              chartIndex: chart.index,
              studyId: usage.studyId,
              pineId: pine_id,
              pineVersion: usage.version,
            });
            const journalResult = await journal.recordAlertSet(
              analysis.analysisId,
              analysisDefinitionHash(definition),
              verified.map((match) => ({
                kind: match.plan.kind,
                alertId: match.alert!.id,
                ownershipName: match.plan.ownershipName,
                operator: match.plan.operator,
                level: match.plan.level,
                expiration: match.plan.expiration,
              })),
            );
            journalStatus = {
              requested: true,
              recorded: journalResult.recorded,
              idempotent: journalResult.idempotent,
              eventId: journalResult.entry.event_id,
            };
          } catch (err) {
            journalStatus = {
              requested: true,
              recorded: false,
              reason: err instanceof AnalysisDefinitionConflictError
                ? err.code
                : "journal_write_failed",
              error: redactSecrets(err instanceof Error ? err.message : String(err)),
              remediation: err instanceof AnalysisDefinitionConflictError
                ? "Do not recreate alerts; assign a new analysis_id and apply a new analysis before monitoring it."
                : "The TradingView alerts remain active; repair the journal path, then call this tool again to link the verified existing alerts.",
            };
          }
        }
        return jsonResult({
          status: complete ? "complete" : "partial",
          dryRun: false,
          changed: created.length > 0,
          trusted: complete,
          analysisId: analysis.analysisId,
          created,
          verified: verified.map((match) => ({ kind: match.plan.kind, alertId: match.alert?.id ?? null })),
          omitted,
          failures,
          unresolved: unresolved.map((match) => ({
            kind: match.plan.kind,
            status: match.status,
            mismatches: match.mismatches,
          })),
          journal: journalStatus,
          remediation: complete
            ? null
            : "Call list_alerts and inspect owned alert names before retrying; a timed-out create may still have reached TradingView.",
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "get_watchlist",
    {
      description:
        "Get the user's TradingView watchlists: list names and their symbols, grouped by " +
        "the user's section headers. Uses the app's logged-in session.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await tv.getWatchlists());
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_quotes",
    {
      description:
        "Get current quotes and technical data for specific symbols via TradingView's " +
        "scanner API (no chart interaction). Default columns include close, change, " +
        "volume, RSI and 'Recommend.All' — the overall technical rating in [-1, 1] " +
        "(-1 strong sell, +1 strong buy). Other fields (e.g. 'MACD.macd', 'EMA50', " +
        "'price_earnings_ttm') can be requested via columns.",
      inputSchema: {
        symbols: z
          .array(z.string().regex(/^[\w!.:&-]{1,48}$/))
          .min(1)
          .max(100)
          .describe("Symbols in EXCHANGE:SYMBOL form, e.g. ['OANDA:EURUSD', 'NASDAQ:AAPL']"),
        columns: z
          .array(FIELD_SCHEMA)
          .min(1)
          .max(50)
          .optional()
          .describe("Data fields to return. Default: description/close/change/volume/RSI/Recommend.All"),
      },
    },
    async ({ symbols, columns }) => {
      try {
        return jsonResult(await scanner.getQuotes(symbols, columns));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_market_snapshot",
    {
      description:
        "Build a read-only, point-in-time market data snapshot for environment analysis. " +
        "It fetches quotes and a shared multi-timeframe overview for target and optional " +
        "auxiliary symbols, with optional economic events. The result explicitly reports " +
        "missing data, request-time timestamps, and quality status; it does not produce " +
        "a trade instruction. TradingView scanner values do not expose a common source " +
        "timestamp, so intraday timing must be treated as partial-quality evidence.",
      inputSchema: {
        symbols: z
          .array(SYMBOL_SCHEMA)
          .min(1)
          .max(MAX_MTF_SYMBOLS)
          .describe("Required analysis symbols in EXCHANGE:SYMBOL form, e.g. ['OANDA:EURUSD']"),
        auxiliary_symbols: z
          .array(SYMBOL_SCHEMA)
          .max(MAX_MTF_SYMBOLS)
          .optional()
          .describe("Optional context symbols such as TVC:DXY or TVC:US10Y; total symbols may not exceed 20"),
        timeframes: z
          .array(z.enum(MTF_TIMEFRAMES))
          .min(1)
          .max(6)
          .optional()
          .describe("Shared timeframes for the overview. Default: ['15','60','240','1D']"),
        fields: z
          .array(z.string().regex(/^[\w.]{1,64}$/))
          .min(1)
          .max(8)
          .optional()
          .describe("Shared overview fields without timeframe suffix. Default: common trend/momentum set"),
        required_quote_fields: z
          .array(FIELD_SCHEMA)
          .min(1)
          .max(10)
          .optional()
          .describe("Numeric quote fields that every required symbol must contain. Default: ['close']"),
        include_events: z
          .boolean()
          .optional()
          .describe("Include economic calendar data. Default: false"),
        countries: z
          .array(z.string().regex(/^[A-Za-z]{2}$/))
          .min(1)
          .max(30)
          .optional()
          .describe("Economic-event countries when include_events is true"),
        min_importance: z
          .enum(IMPORTANCE_LEVELS)
          .optional()
          .describe("Minimum event importance when include_events is true. Default: medium"),
      },
    },
    async ({ symbols, auxiliary_symbols, timeframes, fields, required_quote_fields, include_events, countries, min_importance }) => {
      try {
        return jsonResult(await buildMarketSnapshot(
          { scanner, calendar },
          {
            symbols,
            auxiliarySymbols: auxiliary_symbols,
            timeframes,
            fields,
            requiredQuoteFields: required_quote_fields,
            includeEvents: include_events,
            countries,
            minImportance: min_importance,
          },
        ));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_execution_snapshot",
    {
      description:
        "Observe read-only TradingView scanner bid/ask conditions for one or more symbols. " +
        "It normalizes spread and tick/pip units, rejects crossed quotes and delayed data, and " +
        "reports ready only when a streaming bid/ask change is observed after the request. " +
        "It does not access accounts or create, modify, or execute orders.",
      inputSchema: {
        symbols: z.array(SYMBOL_SCHEMA).min(1).max(MAX_MTF_SYMBOLS),
        wait_for_update_ms: z.number().int().min(0).max(5_000).optional()
          .describe("How long to poll for a post-request bid/ask change. Default: 1200"),
        sample_interval_ms: z.number().int().min(100).max(1_000).optional()
          .describe("Polling interval while waiting for an update. Default: 300"),
        max_quote_age_ms: z.number().int().min(100).max(10_000).optional()
          .describe("Maximum age of chart lp_time or a locally observed scanner update. Default: 5000"),
      },
    },
    async ({ symbols, wait_for_update_ms, sample_interval_ms, max_quote_age_ms }) => {
      try {
        return jsonResult(await buildExecutionSnapshot(
          { scanner, tv },
          {
            symbols,
            waitForUpdateMs: wait_for_update_ms ?? 1_200,
            sampleIntervalMs: sample_interval_ms ?? 300,
            maxQuoteAgeMs: max_quote_age_ms ?? 5_000,
          },
        ));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_trade_decision_context",
    {
      description:
        "Build one read-only evidence bundle for trade analysis from a symbol-bound TradingView " +
        "chart, OHLCV, key levels, scanner MTF/quotes, events, COT, U.S. real yield, and bid/ask " +
        "execution evidence. decision_status reports only data and gate readiness; it never " +
        "produces a directional recommendation or changes charts, Pine, alerts, orders, or journals.",
      inputSchema: {
        symbol: SYMBOL_SCHEMA,
        chart_index: z.number().int().min(0).optional(),
        expected_timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/),
        auxiliary_symbols: z.array(SYMBOL_SCHEMA).max(MAX_MTF_SYMBOLS - 1).optional(),
        timeframes: z.array(z.enum(MTF_TIMEFRAMES)).min(1).max(6).optional(),
        fields: z.array(z.string().regex(/^[\w.]{1,64}$/)).min(1).max(8).optional(),
        countries: z.array(z.string().regex(/^[A-Za-z]{2}$/)).min(1).max(30).optional(),
        min_importance: z.enum(IMPORTANCE_LEVELS).optional(),
        ohlcv_count: z.number().int().min(10).max(500).optional(),
        key_level_range_percent: z.number().positive().max(50).optional(),
        key_level_limit: z.number().int().min(1).max(200).optional(),
        include_positioning: z.boolean().optional(),
        require_positioning: z.boolean().optional(),
        include_real_yield: z.boolean().optional(),
        require_real_yield: z.boolean().optional(),
        event_blackout_before_minutes: z.number().int().nonnegative().max(1440).optional(),
        event_blackout_after_minutes: z.number().int().nonnegative().max(1440).optional(),
        minimum_event_importance: z.enum(["medium", "high"]).optional(),
        execution_wait_for_update_ms: z.number().int().min(0).max(5_000).optional(),
        execution_sample_interval_ms: z.number().int().min(100).max(1_000).optional(),
        execution_max_quote_age_ms: z.number().int().min(100).max(10_000).optional(),
      },
    },
    async ({
      symbol,
      chart_index,
      expected_timeframe,
      auxiliary_symbols,
      timeframes,
      fields,
      countries,
      min_importance,
      ohlcv_count,
      key_level_range_percent,
      key_level_limit,
      include_positioning,
      require_positioning,
      include_real_yield,
      require_real_yield,
      event_blackout_before_minutes,
      event_blackout_after_minutes,
      minimum_event_importance,
      execution_wait_for_update_ms,
      execution_sample_interval_ms,
      execution_max_quote_age_ms,
    }) => chartOperations.run(async () => {
      try {
        const positioningIncluded = include_positioning ?? true;
        const realYieldIncluded = include_real_yield ?? true;
        if ((require_positioning ?? false) && !positioningIncluded) {
          return errorResult(new Error("require_positioning cannot be true when include_positioning is false"));
        }
        if ((require_real_yield ?? false) && !realYieldIncluded) {
          return errorResult(new Error("require_real_yield cannot be true when include_real_yield is false"));
        }
        return jsonResult(await buildTradeDecisionContext(
          { tv, scanner, calendar, cot, realYield },
          {
            symbol,
            chartIndex: chart_index,
            expectedTimeframe: expected_timeframe,
            auxiliarySymbols: auxiliary_symbols,
            timeframes,
            fields,
            countries,
            minImportance: min_importance,
            ohlcvCount: ohlcv_count ?? 100,
            keyLevelRangePercent: key_level_range_percent ?? 3,
            keyLevelLimit: key_level_limit ?? 30,
            includePositioning: positioningIncluded,
            requirePositioning: require_positioning ?? false,
            includeRealYield: realYieldIncluded,
            requireRealYield: require_real_yield ?? false,
            eventBlackoutBeforeMinutes: event_blackout_before_minutes ?? 30,
            eventBlackoutAfterMinutes: event_blackout_after_minutes ?? 15,
            minimumEventImportance: minimum_event_importance ?? "high",
            executionWaitForUpdateMs: execution_wait_for_update_ms ?? 1_200,
            executionSampleIntervalMs: execution_sample_interval_ms ?? 300,
            executionMaxQuoteAgeMs: execution_max_quote_age_ms ?? 5_000,
          },
        ));
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "get_real_yield_context",
    {
      description:
        "Get the latest official U.S. Treasury 10-year par real yield. This is end-of-day macro context, " +
        "not an intraday trigger. Pass as_of to read only locally persisted versions first seen by that time.",
      inputSchema: {
        as_of: z.string().datetime({ offset: true }).optional()
          .describe("Point-in-time cutoff as an ISO-8601 timestamp. Omit for the latest official feed."),
      },
      outputSchema: REAL_YIELD_OUTPUT_SCHEMA,
    },
    async ({ as_of }) => {
      try {
        return structuredJsonResult(
          as_of === undefined ? await realYield.getLatest() : await realYield.getAsOf(new Date(as_of)),
        );
      } catch (err) {
        return structuredJsonResult({
          schema_version: "1.1",
          status: "unavailable",
          series: "US_TREASURY_PAR_REAL_CMT_10Y",
          observation_date: null,
          value: null,
          value_status: "unavailable",
          unit: "percent_per_annum_bond_equivalent",
          source: "us_treasury",
          source_url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/",
          observed_at: new Date().toISOString(),
          source_at: null,
          available_at: null,
          available_at_basis: "unavailable",
          first_seen_at: null,
          source_updated_at_raw: null,
          latency_class: "end_of_day",
          revision_status: "unknown",
          freshness_weekdays: null,
          freshness_status: "unavailable",
          point_in_time_status: "blocked",
          as_of: as_of ?? null,
          quality_issues: [as_of === undefined ? "source_request_failed" : "history_query_failed"],
          cache_status: as_of === undefined ? "miss" : "not_applicable",
          source_error: redactSecrets(err instanceof Error ? err.message : String(err)),
        });
      }
    },
  );

  server.registerTool(
    "get_futures_flow_context",
    {
      description:
        "Combine one exact TradingView CME/COMEX continuous-futures daily chart with delayed CFTC COT " +
        "positioning. It returns target-oriented futures price change, trailing volume z-score, participation " +
        "hypotheses, mapping and data-quality evidence. Daily open interest and price/OI quadrants remain " +
        "explicitly unavailable until an authenticated, first-seen-tracked provider is configured. This is a " +
        "market-participation proxy, not realtime institutional order flow, and it never changes the chart.",
      inputSchema: {
        target_symbol: SYMBOL_SCHEMA.describe("Supported spot target mapped to 6E, 6J, 6B, or GC"),
        futures_chart_index: z.number().int().min(0),
        expected_futures_symbol: SYMBOL_SCHEMA.describe("Exact continuous futures symbol required by the fixed mapping"),
        count: z.number().int().min(100).max(5000).optional()
          .describe("Most recent loaded daily futures bars to inspect. Default: 1000"),
        volume_lookback: z.number().int().min(5).max(250).optional()
          .describe("Prior bars used for volume mean and z-score. Current bar is excluded. Default: 20"),
        elevated_volume_z_score: z.number().finite().gt(0).max(10).optional()
          .describe("Absolute z-score threshold for elevated/subdued participation. Default: 1.5"),
        minimum_observations: z.number().int().min(1).max(5000).optional()
          .describe("Minimum normalized daily observations. Default: 20"),
        observation_limit: z.number().int().min(0).max(500).optional()
          .describe("Maximum recent normalized observations returned. Default: 20"),
        cot_weeks: z.number().int().min(1).max(52).optional()
          .describe("Recent delayed CFTC observations to include. Default: 2"),
      },
    },
    async ({ target_symbol, futures_chart_index, expected_futures_symbol, count, volume_lookback,
      elevated_volume_z_score, minimum_observations, observation_limit, cot_weeks }) => chartOperations.run(async () => {
      try {
        const mapping = futuresFlowMapping(target_symbol);
        if (!mapping) throw new Error(`futures flow mapping is unavailable for ${JSON.stringify(target_symbol)}`);
        if (!mapping.allowedFuturesSymbols.includes(expected_futures_symbol.toUpperCase())) {
          throw new Error(`expected one of ${mapping.allowedFuturesSymbols.join(", ")} for ${mapping.targetSymbol}`);
        }
        const context = await tv.getChartContext();
        const chart = context.charts.find((item) => item.index === futures_chart_index);
        if (!chart) throw new Error(`futures chart ${futures_chart_index} not found`);
        if (chart.symbol.toUpperCase() !== expected_futures_symbol.toUpperCase() ||
            normalizeResolution(chart.resolution) !== "1D") {
          throw new Error("futures chart does not match the expected symbol and daily timeframe");
        }
        const replay = await tv.getReplayStatus();
        if (replay.started || replay.toolbarVisible) {
          throw new Error("futures flow context is blocked while Bar Replay is active");
        }
        const requestedBars = count ?? 1000;
        const history = await tv.getOhlcv(requestedBars, futures_chart_index);
        if (history.symbol.toUpperCase() !== expected_futures_symbol.toUpperCase() ||
            normalizeResolution(history.resolution) !== "1D") {
          throw new Error("futures OHLCV evidence does not match the bound chart");
        }
        const futures = computeFuturesFlowContext({
          bars: history.bars,
          targetSymbol: mapping.targetSymbol,
          futuresSymbol: expected_futures_symbol,
          timeframe: history.resolution,
          volumeLookback: volume_lookback ?? 20,
          elevatedVolumeZScore: elevated_volume_z_score ?? 1.5,
          minimumObservations: minimum_observations ?? 20,
          observationLimit: observation_limit ?? 20,
        });
        let cotEvidence;
        try {
          const data = await cot.getHistory(mapping.targetSymbol, cot_weeks ?? 2);
          const latest = data.observations[0];
          cotEvidence = {
            status: "partial" as const,
            source: "cftc_cot" as const,
            asOf: latest?.report_date ?? null,
            freshness: cotFreshness(latest?.report_date ?? null),
            pointInTimeStatus: data.positioning_features?.point_in_time_status ?? "blocked",
            data,
          };
        } catch (err) {
          cotEvidence = {
            status: "unavailable" as const,
            source: "cftc_cot" as const,
            asOf: null,
            freshness: null,
            pointInTimeStatus: "blocked" as const,
            error: redactSecrets(err instanceof Error ? err.message : String(err)),
          };
        }
        const qualityIssues = [...new Set([
          ...futures.qualityIssues,
          ...(futures.openInterest.status === "unavailable"
            ? ["daily_open_interest_provider_not_configured"]
            : []),
          ...(cotEvidence.status === "unavailable" ? ["cot_unavailable"] : []),
          ...(cotEvidence.status === "partial" ? ["cot_point_in_time_incomplete"] : []),
        ])];
        return jsonResult({
          ...futures,
          status: qualityIssues.length === 0 ? "complete" : "partial",
          observedAt: new Date().toISOString(),
          cot: cotEvidence,
          source: {
            chartIndex: futures_chart_index,
            requestedBars,
            returnedBars: history.bars.length,
            from: history.bars[0]?.timeIso ?? null,
            to: history.bars.at(-1)?.timeIso ?? null,
          },
          qualityIssues,
          limitations: [
            "Continuous futures price and volume are participation proxies and can be affected by contract rolls.",
            "TradingView volume is not independently verified against the final CME Daily Bulletin.",
            "Daily open interest is unavailable; price/OI quadrant labels are not inferred from COT weekly open interest.",
            "COT is weekly delayed positioning with unavailable publication timestamps, not an intraday trigger.",
            "No result identifies institutions, aggressive buyers or sellers, order-book flow, fills, or profitability.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.registerTool(
    "get_positioning_context",
    {
      description: "Get the latest or recent public CFTC COT positioning proxy for a supported FX or gold symbol. COT is weekly, delayed futures data, not a realtime order-flow signal.",
      inputSchema: {
        symbol: SYMBOL_SCHEMA.describe("Supported: OANDA:EURUSD, USDJPY, GBPJPY, GBPAUD, XAUUSD"),
        weeks: z.number().int().min(1).max(52).optional().describe("Number of weekly observations. Default: 1"),
      },
    },
    async ({ symbol, weeks }) => {
      try {
        const cotData = weeks !== undefined
          ? await cot.getHistory(symbol, weeks)
          : await cot.getLatest(symbol);
        const latest = "observations" in cotData ? cotData.observations[0] : cotData;
        const freshness = cotFreshness(latest.report_date);
        return jsonResult({
          schema_version: "1.1",
          status: "partial",
          as_of: latest.report_date,
          cot: cotData,
          freshness,
          limitations: [
            "COT is a weekly futures positioning report and is not realtime institutional flow.",
            "available_at is unavailable from this API response and must not be inferred from report_date.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_aligned_history",
    {
      description:
        "Align closed OHLCV bars already loaded in two or more TradingView layout charts " +
        "on their exact UTC timestamps. It never changes charts and never forward-fills; " +
        "forming bars, different resolutions, missing bars, and retrieval failures are " +
        "reported as quality conditions. Use a layout where each required market is already open.",
      inputSchema: {
        chart_indexes: z
          .array(z.number().int().min(0))
          .min(2)
          .max(8)
          .optional()
          .describe("Charts to align. Default: every chart in the current layout; at least two are required"),
        count: z
          .number()
          .int()
          .min(10)
          .max(500)
          .optional()
          .describe("Closed bars to inspect per chart before alignment. Default: 200"),
        max_missing_ratio: z
          .number()
          .min(0)
          .max(0.5)
          .optional()
          .describe("Block when the worst chart's timestamp-missing ratio exceeds this value. Default: 0.05"),
      },
    },
    async ({ chart_indexes, count, max_missing_ratio }) =>
      chartOperations.run(async () => {
        try {
        const context = await tv.getChartContext();
        const indexes = chart_indexes ?? context.charts.map((chart) => chart.index);
        if (indexes.length < 2) {
          return errorResult(new Error("get_aligned_history requires at least two layout charts"));
        }
        if (new Set(indexes).size !== indexes.length) {
          return errorResult(new Error("chart_indexes must not contain duplicates"));
        }
        const knownIndexes = new Set(context.charts.map((chart) => chart.index));
        const unknown = indexes.filter((index) => !knownIndexes.has(index));
        if (unknown.length > 0) {
          return errorResult(new Error(`chart indexes not present in the current layout: ${unknown.join(", ")}`));
        }

        const requestedCount = count ?? 200;
        const maximumMissingRatio = max_missing_ratio ?? 0.05;
        const results = await Promise.allSettled(indexes.map((index) => tv.getOhlcv(requestedCount, index)));
        const issues: AlignedHistoryIssue[] = [];
        const histories = results.flatMap((result, position) => {
          if (result.status === "fulfilled") return [{ chartIndex: indexes[position], history: result.value }];
          issues.push({
            code: "history_unavailable",
            severity: "error",
            message: "OHLCV retrieval failed for a required chart.",
            chart_indexes: [indexes[position]],
          });
          return [];
        });
        const resolutions = [...new Set(histories.map(({ history }) => history.resolution))];
        if (resolutions.length > 1) {
          issues.push({
            code: "resolution_mismatch",
            severity: "error",
            message: `All charts must use the same timeframe; found: ${resolutions.join(", ")}.`,
            chart_indexes: histories.map(({ chartIndex }) => chartIndex),
          });
        }

        const closed = histories.map(({ chartIndex, history }) => {
          const formingBars = history.bars.filter((bar) => bar.forming).length;
          return {
            chartIndex,
            symbol: history.symbol,
            bars: history.bars.filter((bar) => !bar.forming),
            formingBars,
          };
        });
        const allTimes = new Set(closed.flatMap(({ bars }) => bars.map((bar) => bar.time)));
        const commonTimes = closed.length === indexes.length
          ? closed[0].bars.map((bar) => bar.time).filter((time) => closed.every(({ bars }) => bars.some((bar) => bar.time === time)))
          : [];
        if (commonTimes.length === 0) {
          issues.push({
            code: "no_common_closed_bars",
            severity: "error",
            message: "No closed bars share an exact UTC timestamp across all required charts.",
            chart_indexes: indexes,
          });
        }
        const missingRatioByChart = Object.fromEntries(
          closed.map(({ chartIndex, bars }) => [
            String(chartIndex),
            allTimes.size === 0 ? 1 : 1 - bars.filter((bar) => commonTimes.includes(bar.time)).length / allTimes.size,
          ]),
        );
        const worstMissingRatio = Math.max(1, ...Object.values(missingRatioByChart)) === 1 && allTimes.size === 0
          ? 1
          : Math.max(0, ...Object.values(missingRatioByChart));
        if (worstMissingRatio > maximumMissingRatio) {
          issues.push({
            code: "missing_ratio_exceeded",
            severity: "error",
            message: `Timestamp-missing ratio ${worstMissingRatio.toFixed(4)} exceeds the limit ${maximumMissingRatio.toFixed(4)}.`,
            chart_indexes: indexes,
          });
        }

        const byTime = closed.map(({ bars }) => new Map(bars.map((bar) => [bar.time, bar])));
        const observations = commonTimes.map((time) => {
          const reference = byTime[0].get(time)!;
          return {
            time,
            time_iso: reference.timeIso,
            bars: closed.map(({ chartIndex, symbol }, position) => ({
              chart_index: chartIndex,
              symbol,
              ...byTime[position].get(time)!,
            })),
          };
        });
        const windowStart = observations[0]?.time_iso ?? null;
        const windowEnd = observations.at(-1)?.time_iso ?? null;
        return jsonResult({
          schema_version: "1.0",
          status: alignedHistoryStatus(issues),
          alignment_policy: "exact_utc_timestamp_no_forward_fill",
          timeframe: resolutions.length === 1 ? resolutions[0] : null,
          chart_indexes: indexes,
          window_start: windowStart,
          window_end: windowEnd,
          observations,
          missing_ratio: worstMissingRatio,
          missing_ratio_by_chart: missingRatioByChart,
          max_source_skew_ms: null,
          forming_bars_excluded: Object.fromEntries(closed.map(({ chartIndex, formingBars }) => [String(chartIndex), formingBars])),
          contract_rolls: null,
          basis_adjustment: null,
          quality_issues: issues,
        });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "validate_research_protocol",
    {
      description:
        "Validate a frozen strategy-research protocol before adoption decisions. Resolves and " +
        "statically audits one exact saved Pine strategy version, then checks IS/OOS overlap, " +
        "future windows, forming-bar use, candidate multiplicity, minimum trades, explicit costs, " +
        "restart-difference evidence, and definition changes after OOS access. This is read-only " +
        "and does not run a backtest, inspect the chart, or prove non-repainting.",
      inputSchema: {
        pine_id: z.string().regex(/^USER;[a-zA-Z0-9]{16,64}$/),
        pine_version: z.string().regex(/^\d+(?:\.\d+)*$/),
        candidate_ids: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)).min(1).max(24),
        windows: z.array(z.object({
          window_id: z.string().regex(/^[\w.:-]{1,80}$/),
          population: z.enum(["in_sample", "out_of_sample"]),
          from: z.string().datetime({ offset: true }),
          to: z.string().datetime({ offset: true }),
        })).min(2).max(24),
        minimum_trades: z.number().int().min(1).max(100_000),
        observed_trades: z.number().int().min(0).max(1_000_000).nullable().optional(),
        costs: z.object({
          spread_pips: z.number().finite().min(0).nullable(),
          slippage_pips_per_side: z.number().finite().min(0).nullable(),
          commission_per_round_trip: z.number().finite().min(0).nullable(),
        }),
        closed_bars_only: z.boolean(),
        restart_diff_checked: z.boolean(),
        definition_frozen_at: z.string().datetime({ offset: true }),
        definition_last_changed_at: z.string().datetime({ offset: true }),
        oos_first_viewed_at: z.string().datetime({ offset: true }).nullable().optional(),
      },
    },
    async ({ pine_id, pine_version, candidate_ids, windows, minimum_trades, observed_trades,
      costs, closed_bars_only, restart_diff_checked, definition_frozen_at,
      definition_last_changed_at, oos_first_viewed_at }) => {
      try {
        const pine = await tv.getPineSource(pine_id, pine_version);
        if (pine.pineId !== pine_id || pine.version !== pine_version) {
          throw new Error(`resolved Pine identity changed: expected ${pine_id} v${pine_version}`);
        }
        return jsonResult(validateResearchProtocol({
          pineId: pine_id,
          pineVersion: pine_version,
          pineKind: pine.kind,
          candidateIds: candidate_ids,
          windows: windows.map((window) => ({
            windowId: window.window_id,
            population: window.population,
            from: window.from,
            to: window.to,
          })),
          minimumTrades: minimum_trades,
          observedTrades: observed_trades ?? null,
          costs: {
            spreadPips: costs.spread_pips,
            slippagePipsPerSide: costs.slippage_pips_per_side,
            commissionPerRoundTrip: costs.commission_per_round_trip,
          },
          closedBarsOnly: closed_bars_only,
          restartDiffChecked: restart_diff_checked,
          definitionFrozenAt: definition_frozen_at,
          definitionLastChangedAt: definition_last_changed_at,
          oosFirstViewedAt: oos_first_viewed_at ?? null,
        }, auditPineSource(pine.source)));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "audit_pine_indicator",
    {
      description:
        "Statically audit one of the user's Pine scripts for constructs that can repaint or " +
        "make realtime values differ from historical values. This is a source-level screen, " +
        "not proof of non-repainting; every result remains restricted until restart-difference " +
        "validation is recorded by the evaluation pipeline.",
      inputSchema: {
        pine_id: z
          .string()
          .regex(/^USER;[a-zA-Z0-9]{16,64}$/)
          .describe("Your Pine script id from list_pine_scripts"),
        version: z
          .string()
          .regex(/^(last|\d+(?:\.\d+)*)$/)
          .optional()
          .describe("Pine version to inspect. Default: last"),
      },
    },
    async ({ pine_id, version }) => {
      try {
        const pine = await tv.getPineSource(pine_id, version);
        const audit = auditPineSource(pine.source);
        return jsonResult({
          schema_version: "1.0",
          pine_id: pine.pineId,
          version: pine.version,
          audited_at: new Date().toISOString(),
          source_length: pine.sourceLength,
          uses_request_security: audit.usesRequestSecurity,
          uses_pivots: audit.usesPivots,
          uses_varip: audit.usesVarip,
          uses_timenow: audit.usesTimenow,
          calc_on_every_tick: audit.calcOnEveryTick,
          uses_barstate_isrealtime: audit.usesRealtimeState,
          restart_diff_checked: false,
          status: "restricted",
          findings: audit.findings,
          limitations: [
            "Static inspection cannot prove that an indicator does not repaint.",
            "Restart-difference validation and closed-bar comparison are required before policy scoring.",
          ],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "compare_indicator_observations",
    {
      description: "Compare two closed-bar captures of the same indicator after a chart reload/restart. Returns changed plot values; it does not persist either capture.",
      inputSchema: {
        before: z.object({ study_id: z.string().min(1), symbol: z.string().min(1), resolution: z.string().min(1), bars: z.array(z.object({ time: z.number().finite(), values: z.record(z.string(), z.union([z.number().finite(), z.string(), z.null()])) })).min(1).max(500) }),
        after: z.object({ study_id: z.string().min(1), symbol: z.string().min(1), resolution: z.string().min(1), bars: z.array(z.object({ time: z.number().finite(), values: z.record(z.string(), z.union([z.number().finite(), z.string(), z.null()])) })).min(1).max(500) }),
        epsilon: z.number().finite().min(0).max(1).optional(),
      },
    },
    async ({ before, after, epsilon }) => jsonResult(compareIndicatorObservations(before, after, epsilon)),
  );

  server.registerTool(
    "compute_market_features",
    {
      description:
        "Compute deterministic, non-directional features from exact-time-aligned closed OHLCV " +
        "observations, typically returned by get_aligned_history: close-to-close return, " +
        "realized volatility, ATR, and return correlations. It does not fetch data, fill " +
        "gaps, or produce a trade recommendation.",
      inputSchema: {
        primary_symbol: z.string().min(1).max(80).describe("Symbol whose return, volatility, and ATR to compute"),
        window: z.number().int().min(2).max(250).optional().describe("Number of latest observations. Default: 20"),
        observations: z
          .array(
            z.object({
              time: z.number().finite(),
              bars: z
                .array(
                  z.object({
                    symbol: z.string().min(1).max(80),
                    open: z.number().finite(),
                    high: z.number().finite(),
                    low: z.number().finite(),
                    close: z.number().finite(),
                  }),
                )
                .min(2)
                .max(8),
            }),
          )
          .min(3)
          .max(500)
          .describe("Exact-time-aligned, closed-bar observations from get_aligned_history"),
      },
    },
    async ({ primary_symbol, window, observations }) => {
      const chosenWindow = window ?? 20;
      if (observations.length < chosenWindow + 1) {
        return errorResult(new Error(`at least ${chosenWindow + 1} observations are required for a ${chosenWindow}-bar feature window`));
      }
      const latest = observations.slice(-(chosenWindow + 1));
      const symbols = [...new Set(latest.flatMap((observation) => observation.bars.map((bar) => bar.symbol)))];
      if (!symbols.includes(primary_symbol)) {
        return errorResult(new Error(`primary_symbol ${JSON.stringify(primary_symbol)} is absent from the observations`));
      }
      const closesBySymbol = new Map<string, number[]>();
      const primaryBars = [] as Array<{ high: number; low: number; close: number }>;
      for (const observation of latest) {
        const perSymbol = new Map(observation.bars.map((bar) => [bar.symbol, bar]));
        const missing = symbols.filter((symbol) => !perSymbol.has(symbol));
        if (missing.length > 0) {
          return errorResult(new Error(`observations must contain every aligned symbol; missing: ${missing.join(", ")}`));
        }
        for (const symbol of symbols) {
          const series = closesBySymbol.get(symbol) ?? [];
          series.push(perSymbol.get(symbol)!.close);
          closesBySymbol.set(symbol, series);
        }
        const primary = perSymbol.get(primary_symbol)!;
        primaryBars.push(primary);
      }
      const returnsBySymbol = new Map(
        [...closesBySymbol.entries()].map(([symbol, closes]) => [
          symbol,
          closes.slice(1).map((close, index) => Math.log(close / closes[index])),
        ]),
      );
      const primaryReturns = returnsBySymbol.get(primary_symbol)!;
      const trueRanges = primaryBars.slice(1).map((bar, index) => {
        const previousClose = primaryBars[index].close;
        return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
      });
      const correlations = Object.fromEntries(
        [...returnsBySymbol.entries()]
          .filter(([symbol]) => symbol !== primary_symbol)
          .map(([symbol, returns]) => [symbol, correlation(primaryReturns, returns)]),
      );
      return jsonResult({
        schema_version: "1.0",
        status: "ok",
        primary_symbol,
        window: chosenWindow,
        observations_used: latest.length,
        return_log: primaryReturns.reduce((sum, value) => sum + value, 0),
        realized_volatility: sampleStdDev(primaryReturns),
        atr: mean(trueRanges),
        correlations,
        assumptions: [
          "All observations are closed bars on an exact shared UTC time axis.",
          "Returns are natural-log close-to-close returns; no costs, carry, or directional policy are applied.",
        ],
      });
    },
  );

  server.registerTool(
    "compute_round_trip_cost",
    {
      description: "Compute explicit round-trip spread, slippage, and commission cost for a supported instrument. This is an assumption model, not broker execution data.",
      inputSchema: {
        symbol: SYMBOL_SCHEMA,
        bid: z.number().finite().positive(),
        ask: z.number().finite().positive(),
        quantity: z.number().finite().positive(),
        commission_per_unit: z.number().finite().min(0).optional(),
        slippage_pips_per_side: z.number().finite().min(0).optional(),
      },
    },
    async ({ symbol, bid, ask, quantity, commission_per_unit, slippage_pips_per_side }) => {
      try {
        return jsonResult(computeRoundTripCost({ symbol, bid, ask, quantity, commission_per_unit, slippage_pips_per_side }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "compute_position_size",
    {
      description:
        "Compute a risk-budgeted instrument quantity from entry, stop, explicit execution cost, " +
        "quantity constraints, and fresh quote-to-account currency evidence. The quantity is always " +
        "rounded down and the tool fails closed when conversion evidence or minimum-size capacity is " +
        "missing. It does not access an account or place an order.",
      inputSchema: {
        symbol: SYMBOL_SCHEMA,
        account_currency: z.string().regex(/^[A-Za-z]{3}$/),
        account_equity: z.number().finite().positive(),
        risk_percent: z.number().finite().positive().max(100).optional(),
        risk_amount: z.number().finite().positive().optional(),
        entry_price: z.number().finite().positive(),
        stop_price: z.number().finite().positive(),
        round_trip_cost_price_per_unit: z.number().finite().nonnegative().optional(),
        contract_multiplier: z.number().finite().positive().optional(),
        quantity_step: z.number().finite().positive(),
        minimum_quantity: z.number().finite().positive(),
        maximum_quantity: z.number().finite().positive().optional(),
        quote_to_account_rate: z.number().finite().positive().optional()
          .describe("Account-currency units per one quote-currency unit"),
        conversion_symbol: SYMBOL_SCHEMA.optional(),
        conversion_observed_at: z.string().datetime({ offset: true }).optional(),
        max_conversion_age_seconds: z.number().finite().positive().max(86_400).optional(),
      },
    },
    async (input) => {
      try {
        return jsonResult(computePositionSize(input));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "validate_trade_plan",
    {
      description:
        "Validate a proposed trade plan without changing TradingView, Pine, alerts, orders, " +
        "or journals. Returns structured quality issues and cost-adjusted Target 1 risk/reward.",
      inputSchema: {
        symbol: SYMBOL_SCHEMA,
        timeframe: z.string().regex(/^[A-Za-z0-9]{1,8}$/),
        analysis_id: z.string().regex(/^[\w.:-]{1,80}$/),
        analyzed_at: z.string().datetime({ offset: true }),
        expires_at: z.string().datetime({ offset: true }).optional(),
        bias: z.enum(["bullish", "bearish", "neutral"]),
        entry_low: z.number().positive(),
        entry_high: z.number().positive(),
        confirmation: z.number().positive().optional(),
        invalidation: z.number().positive(),
        stop: z.number().positive(),
        targets: z.array(z.number().positive()).min(1).max(3),
        confidence: z.number().min(0).max(1),
        note: z.string().max(160).optional(),
        current_price: z.number().positive(),
        market_observed_at: z.string().datetime({ offset: true }),
        estimated_round_trip_cost_price: z.number().nonnegative().optional(),
        minimum_risk_reward: z.number().positive().max(10).optional(),
        max_market_age_seconds: z.number().int().positive().max(86_400).optional(),
        events: z.array(z.object({
          name: z.string().min(1).max(160),
          event_at: z.string().datetime({ offset: true }),
          importance: z.enum(["low", "medium", "high"]),
          country: z.string().regex(/^[A-Za-z]{2}$/).optional(),
        })).max(100).optional(),
        event_blackout_before_minutes: z.number().int().nonnegative().max(1440).optional(),
        event_blackout_after_minutes: z.number().int().nonnegative().max(1440).optional(),
        minimum_event_importance: z.enum(["medium", "high"]).optional(),
      },
    },
    async ({
      symbol,
      timeframe,
      analysis_id,
      analyzed_at,
      expires_at,
      bias,
      entry_low,
      entry_high,
      confirmation,
      invalidation,
      stop,
      targets,
      confidence,
      note,
      current_price,
      market_observed_at,
      estimated_round_trip_cost_price,
      minimum_risk_reward,
      max_market_age_seconds,
      events,
      event_blackout_before_minutes,
      event_blackout_after_minutes,
      minimum_event_importance,
    }) => {
      try {
        return jsonResult(validateTradePlan({
          symbol,
          timeframe,
          analysisId: analysis_id,
          analyzedAt: analyzed_at,
          expiresAt: expires_at,
          bias,
          entryLow: entry_low,
          entryHigh: entry_high,
          confirmation,
          invalidation,
          stop,
          targets,
          confidence,
          note,
          currentPrice: current_price,
          marketObservedAt: market_observed_at,
          estimatedRoundTripCostPrice: estimated_round_trip_cost_price ?? 0,
          minimumRiskReward: minimum_risk_reward ?? 1.5,
          maxMarketAgeSeconds: max_market_age_seconds ?? 60,
          events: (events ?? []).map((event) => ({
            name: event.name,
            eventAt: event.event_at,
            importance: event.importance,
            country: event.country,
          })),
          eventBlackoutBeforeMinutes: event_blackout_before_minutes ?? 30,
          eventBlackoutAfterMinutes: event_blackout_after_minutes ?? 15,
          minimumEventImportance: minimum_event_importance ?? "high",
        }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_mtf_overview",
    {
      description:
        "Multi-timeframe overview of one or more symbols WITHOUT touching the user's " +
        "chart: the same indicator fields (default: close, RSI, ADX, ATR, EMA20, SMA50, " +
        "SMA200 and Recommend.* ratings) across several timeframes in a single call — " +
        "pass several symbols to compare majors side by side in one call. Use this for " +
        "top-down analysis (e.g. 1D trend, 240/60 timing) before or instead of " +
        "set_timeframe.",
      inputSchema: {
        symbols: z
          .array(z.string().regex(/^[\w!.:&-]{1,48}$/))
          .min(1)
          .max(MAX_MTF_SYMBOLS)
          .describe("Symbols in EXCHANGE:SYMBOL form, e.g. ['OANDA:EURUSD', 'OANDA:USDJPY']"),
        timeframes: z
          .array(z.enum(MTF_TIMEFRAMES))
          .min(1)
          .max(6)
          .optional()
          .describe("Timeframes (minutes or 1D/1W/1M). Default: ['15','60','240','1D']"),
        fields: z
          .array(z.string().regex(/^[\w.]{1,64}$/))
          .min(1)
          .max(15)
          .optional()
          .describe("Indicator fields without timeframe suffix. Default: common trend/momentum set"),
      },
    },
    async ({ symbols, timeframes, fields }) => {
      try {
        return jsonResult(await scanner.getMtfOverview(symbols, timeframes, fields));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "scan_market",
    {
      description:
        "Screen a market for symbols matching field filters via TradingView's scanner " +
        "API, e.g. RSI < 30 sorted by volume. Markets: 'america', 'japan', 'crypto', " +
        "'forex', 'global', etc. Filter fields use scanner names like 'RSI', 'close', " +
        "'volume', 'change', 'market_cap_basic', 'Recommend.All'.",
      inputSchema: {
        market: z
          .string()
          .regex(/^[a-z]{2,24}$/)
          .describe("Market to screen, e.g. 'japan', 'america', 'crypto', 'forex'"),
        filters: z
          .array(
            z.object({
              field: FIELD_SCHEMA,
              operation: z.enum(SCAN_OPERATIONS),
              value: z
                .union([
                  z.number(),
                  z.string().max(100),
                  z.boolean(),
                  z.array(z.union([z.number(), z.string().max(100)])).max(2),
                ])
                .optional(),
            }),
          )
          .max(20)
          .optional()
          .describe("Conditions, e.g. [{field:'RSI', operation:'less', value:30}]"),
        columns: z
          .array(FIELD_SCHEMA)
          .min(1)
          .max(50)
          .optional()
          .describe("Data fields to return per match"),
        sort_by: FIELD_SCHEMA.optional().describe("Field to sort by, e.g. 'volume'"),
        sort_order: z.enum(["asc", "desc"]).optional().describe("Default: desc"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results. Default: 20"),
      },
    },
    async ({ market, filters, columns, sort_by, sort_order, limit }) => {
      try {
        return jsonResult(
          await scanner.scanMarket({
            market,
            filters,
            columns,
            sortBy: sort_by,
            sortOrder: sort_order,
            limit,
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_key_levels",
    {
      description:
        "Aggregate key price levels near the current price from ALL price-scale " +
        "indicators on a TradingView chart: plot values whose titles name a level " +
        "(S/R, pivot, VWAP, bands, BOS/CHoCH...), horizontal lines, box/zone edges and " +
        "label prices, each tagged with its source indicator. Oscillator panes (RSI " +
        "etc.) and generic value plots (open/high/low/close mirrors) are excluded. " +
        "Sorted by distance from the current price. Use this instead of manually " +
        "combining get_indicator_values and get_indicator_graphics when you need a " +
        "support/resistance table.",
      inputSchema: {
        range_percent: z
          .number()
          .gt(0)
          .max(50)
          .optional()
          .describe("Only levels within ±this % of the current price. Default: 3"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max levels to return, nearest first. Default: 30"),
        chart_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Chart index in a multi-chart layout. Default: the active chart"),
        include_all_plots: z
          .boolean()
          .optional()
          .describe(
            "Include every numeric plot as a level, not just level-named ones. " +
            "Use when an indicator names its S/R plots unusually. Default: false",
          ),
      },
    },
    async ({ range_percent, limit, chart_index, include_all_plots }) =>
      chartOperations.run(async () => {
        try {
        return jsonResult(
          await tv.getKeyLevels({
            rangePercent: range_percent ?? 3,
            limit: limit ?? 30,
            chartIndex: chart_index,
            includeAllPlots: include_all_plots ?? false,
          }),
        );
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "get_economic_events",
    {
      description:
        "Get economic calendar events (CPI, NFP, central bank decisions, PMIs...) from " +
        "TradingView's public calendar: scheduled time, country/currency, importance, " +
        "forecast/previous/actual values. Use this to check whether upcoming news could " +
        "invalidate a technical setup. Defaults: next 7 days, medium+ importance, " +
        "US/EU/JP/GB.",
      inputSchema: {
        countries: z
          .array(z.string().regex(/^[A-Za-z]{2}$/))
          .min(1)
          .max(30)
          .optional()
          .describe("2-letter country codes, e.g. ['US','JP','EU','GB','DE','CN','AU']. Default: US, EU, JP, GB"),
        from: z
          .string()
          .max(40)
          .optional()
          .describe("Range start, ISO 8601 (e.g. '2026-07-08T00:00:00Z'). Default: now"),
        to: z
          .string()
          .max(40)
          .optional()
          .describe("Range end, ISO 8601. Default: from + 7 days"),
        min_importance: z
          .enum(IMPORTANCE_LEVELS)
          .optional()
          .describe("Minimum importance to include. Default: medium"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max events to return, earliest first. Default: 50"),
      },
    },
    async ({ countries, from, to, min_importance, limit }) => {
      try {
        return jsonResult(
          await calendar.getEvents({
            countries,
            from,
            to,
            minImportance: min_importance,
            limit,
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "set_symbol",
    {
      description:
        "Change one TradingView chart to a different symbol, e.g. 'BTCUSD', " +
        "'OANDA:EURUSD', 'NASDAQ:AAPL'. chart_index selects a pane in multi-chart layouts; " +
        "the active chart is used by default. The target pane is read back and failures are rolled back.",
      inputSchema: {
        symbol: z
          .string()
          .min(1)
          .describe("Symbol to display, optionally exchange-prefixed"),
        chart_index: z.number().int().min(0).optional()
          .describe("Chart index in a multi-chart layout. Default: active chart"),
      },
    },
    async ({ symbol, chart_index }) =>
      chartOperations.run(async () => {
        try {
          const context = await tv.getChartContext();
          const selectedIndex = chart_index ?? context.activeChartIndex;
          if (selectedIndex === null) throw new Error("no active chart; provide chart_index explicitly");
          const result = await changeChartState(tv, selectedIndex, { symbol });
          return jsonResult({ ...result.current, changed: result.changed, bars: result.bars, transaction: result });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "set_timeframe",
    {
      description:
        "Change one TradingView chart's timeframe. Examples: '1', '5', '15', '60', " +
        "'240' (minutes), '1D', '1W', '1M'. chart_index selects a pane in multi-chart " +
        "layouts; the target pane is read back and failures are rolled back.",
      inputSchema: {
        resolution: z.string().min(1).describe("Timeframe/resolution string"),
        chart_index: z.number().int().min(0).optional()
          .describe("Chart index in a multi-chart layout. Default: active chart"),
      },
    },
    async ({ resolution, chart_index }) =>
      chartOperations.run(async () => {
        try {
          const context = await tv.getChartContext();
          const selectedIndex = chart_index ?? context.activeChartIndex;
          if (selectedIndex === null) throw new Error("no active chart; provide chart_index explicitly");
          const result = await changeChartState(tv, selectedIndex, { resolution });
          return jsonResult({ ...result.current, changed: result.changed, bars: result.bars, transaction: result });
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  return server;
}
