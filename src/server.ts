import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CdpClient } from "./cdp.js";
import type { TradingView } from "./tradingview.js";
import {
  DEFAULT_MTF_FIELDS,
  DEFAULT_MTF_TIMEFRAMES,
  MAX_MTF_SYMBOLS,
  MTF_TIMEFRAMES,
  SCAN_OPERATIONS,
  type Scanner,
} from "./scanner.js";
import { IMPORTANCE_LEVELS, type EconomicCalendar } from "./calendar.js";
import { cotFreshness, type CotClient } from "./cot.js";
import type { TreasuryRealYieldClient } from "./realYield.js";
import { compareIndicatorObservations } from "./indicatorAudit.js";
import { getInstrumentMetadata } from "./instrumentMetadata.js";
import { computeRoundTripCost } from "./costModel.js";
import { redactSecrets } from "./redact.js";
import {
  ANALYSIS_OVERLAY_INPUTS,
  ANALYSIS_OVERLAY_DEFAULT_ANALYSIS_ID,
  ANALYSIS_OVERLAY_DEFAULT_ANALYZED_AT,
  ANALYSIS_OVERLAY_NAME,
  ANALYSIS_OVERLAY_SOURCE,
  ANALYSIS_OVERLAY_VERSION,
  assertAnalysisOverlayStudy,
  buildAnalysisOverlayInputs,
  computeAnalysisOverlayPriceStatus,
  parseAnalysisOverlayState,
  normalizeResolution,
  resolveAnalysisChart,
  validateAnalysisPayload,
} from "./analysisOverlay.js";
import { evaluateAnalysisOverlayOutcome } from "./analysisOutcome.js";
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
    | "runBacktest"
    | "listAlerts"
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
  journal: Pick<AnalysisJournalStore, "recordAnalysis" | "recordOutcome" | "list" | "calibration">;
}

const FIELD_SCHEMA = z.string().regex(/^[\w.|]{1,64}$/);
const SYMBOL_SCHEMA = z.string().regex(/^[\w!.:&-]{1,48}$/);
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
type SnapshotQualityIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  symbols?: string[];
};

type SnapshotSource<T> = {
  name: string;
  status: "ok" | "error";
  requested_at: string;
  received_at: string;
  latency_ms: number;
  timestamp_basis: "mcp_receipt_time" | "scheduled_event_time";
  value: T | null;
};

type NormalizedQuote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread_price: number | null;
  spread_pips: number | null;
  pip_size: number | null;
  tick_size: number | null;
  spread_status: "derived_from_bid_ask" | "bid_ask_incomplete" | "unavailable";
};

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

function addIssue(
  issues: SnapshotQualityIssue[],
  code: string,
  severity: SnapshotQualityIssue["severity"],
  message: string,
  symbols?: string[],
): void {
  issues.push({ code, severity, message, ...(symbols && symbols.length > 0 ? { symbols } : {}) });
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeQuote(row: { symbol: string; values: Record<string, unknown> }): NormalizedQuote {
  const metadata = getInstrumentMetadata(row.symbol);
  const bid = finiteNumber(row.values.bid);
  const ask = finiteNumber(row.values.ask);
  if (bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid) {
    return {
      symbol: row.symbol,
      bid,
      ask,
      mid: (bid + ask) / 2,
      spread_price: ask - bid,
      spread_pips: metadata.pip_size === null ? null : (ask - bid) / metadata.pip_size,
      pip_size: metadata.pip_size,
      tick_size: metadata.tick_size,
      spread_status: "derived_from_bid_ask",
    };
  }
  return {
    symbol: row.symbol,
    bid,
    ask,
    mid: null,
    spread_price: null,
    spread_pips: null,
    pip_size: metadata.pip_size,
    tick_size: metadata.tick_size,
    spread_status: bid !== null || ask !== null ? "bid_ask_incomplete" : "unavailable",
  };
}

function alignedHistoryStatus(issues: AlignedHistoryIssue[]): SnapshotStatus {
  if (issues.some((issue) => issue.severity === "error")) return "blocked";
  if (issues.length > 0) return "partial";
  return "ok";
}

function pineCodeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
}

function auditPineSource(source: string) {
  const code = pineCodeOnly(source);
  const usesRequestSecurity = /\brequest\.security(?:_lower_tf)?\s*\(/.test(code);
  const usesPivots = /\bta\.pivot(?:high|low)\s*\(/.test(code);
  const usesVarip = /\bvarip\b/.test(code);
  const usesTimenow = /\btimenow\b/.test(code);
  const calcOnEveryTick = /\bcalc_on_every_tick\s*=\s*true\b/.test(code);
  const usesRealtimeState = /\bbarstate\.isrealtime\b/.test(code);
  const findings = [
    ...(usesRequestSecurity ? [{ code: "request_security", severity: "warning", message: "request.security can introduce higher-timeframe lookahead/recalculation risk." }] : []),
    ...(usesPivots ? [{ code: "pivots", severity: "warning", message: "Pivot values are only confirmed after future bars have elapsed." }] : []),
    ...(usesVarip ? [{ code: "varip", severity: "warning", message: "varip can preserve intrabar state that differs after restart." }] : []),
    ...(usesTimenow ? [{ code: "timenow", severity: "warning", message: "timenow makes values depend on wall-clock execution time." }] : []),
    ...(calcOnEveryTick ? [{ code: "calc_on_every_tick", severity: "warning", message: "Intrabar strategy recalculation can differ from closed-bar history." }] : []),
    ...(usesRealtimeState ? [{ code: "barstate_isrealtime", severity: "warning", message: "Realtime-only branches can differ from historical execution." }] : []),
  ];
  return { usesRequestSecurity, usesPivots, usesVarip, usesTimenow, calcOnEveryTick, usesRealtimeState, findings };
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

function snapshotStatus(issues: SnapshotQualityIssue[]): SnapshotStatus {
  if (issues.some((issue) => issue.severity === "error")) return "blocked";
  if (issues.length > 0) return "partial";
  return "ok";
}

async function captureSnapshotSource<T>(
  name: string,
  timestampBasis: SnapshotSource<T>["timestamp_basis"],
  load: () => Promise<T>,
): Promise<SnapshotSource<T>> {
  const requestedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const value = await load();
    return {
      name,
      status: "ok",
      requested_at: requestedAt,
      received_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      timestamp_basis: timestampBasis,
      value,
    };
  } catch {
    return {
      name,
      status: "error",
      requested_at: requestedAt,
      received_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      timestamp_basis: timestampBasis,
      value: null,
    };
  }
}

export function createServer({ cdp, tv, scanner, calendar, cot, realYield, journal }: ServerDeps): McpServer {
  const chartOperations = new SerialOperationQueue();
  const server = new McpServer({
    name: "tradingview-mcp",
    version: "0.1.0",
  });

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
        "adds a missing one, or transactionally adds the latest version, migrates all 14 " +
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
          inspected.push({ usage, study: assertAnalysisOverlayStudy(studies, usage.studyId) });
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
              if (!input) throw new Error(`old overlay is missing input ${expected.id}`);
              return { id: expected.id, value: input.value };
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
        "source and 14-input contract, then returns analysis metadata, expiry, current-price " +
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
        const response = {
          ...result,
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
        const inputs = buildAnalysisOverlayInputs(analysis);
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
        "state, last fire time. Creating or modifying alerts is not supported.",
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
      const requestedAt = new Date().toISOString();
      const requiredQuoteFields = required_quote_fields ?? ["close"];
      if (new Set(symbols).size !== symbols.length || new Set(auxiliary_symbols ?? []).size !== (auxiliary_symbols ?? []).length) {
        return errorResult(new Error("symbols and auxiliary_symbols must not contain duplicates"));
      }
      if ((auxiliary_symbols ?? []).some((symbol) => symbols.includes(symbol))) {
        return errorResult(new Error("a symbol cannot be both required and auxiliary"));
      }
      if (new Set(timeframes ?? []).size !== (timeframes ?? []).length || new Set(fields ?? []).size !== (fields ?? []).length) {
        return errorResult(new Error("timeframes and fields must not contain duplicates"));
      }
      if (new Set(requiredQuoteFields).size !== requiredQuoteFields.length) {
        return errorResult(new Error("required_quote_fields must not contain duplicates"));
      }
      const effectiveTimeframes = timeframes ?? DEFAULT_MTF_TIMEFRAMES;
      const effectiveFields = fields ?? DEFAULT_MTF_FIELDS;
      if (effectiveTimeframes.length * effectiveFields.length > 50) {
        return errorResult(
          new Error(
            `too many MTF columns: ${effectiveTimeframes.length} timeframes x ${effectiveFields.length} fields > 50`,
          ),
        );
      }
      const requestedSymbols = [...new Set([...symbols, ...(auxiliary_symbols ?? [])])];
      if (requestedSymbols.length > MAX_MTF_SYMBOLS) {
        return errorResult(new Error(`symbols plus auxiliary_symbols must contain at most ${MAX_MTF_SYMBOLS} unique symbols`));
      }

      const quoteColumns = [...new Set(["description", ...requiredQuoteFields])];
      const sources = await Promise.all([
        captureSnapshotSource("tradingview_scanner_quotes", "mcp_receipt_time", () =>
          scanner.getQuotes(requestedSymbols, quoteColumns),
        ),
        captureSnapshotSource("tradingview_scanner_mtf", "mcp_receipt_time", () =>
          scanner.getMtfOverview(requestedSymbols, effectiveTimeframes, effectiveFields),
        ),
        ...(include_events
          ? [
              captureSnapshotSource("tradingview_economic_calendar", "scheduled_event_time", () =>
                calendar.getEvents({ countries, minImportance: min_importance }),
              ),
            ]
          : []),
      ]);
      const [quotes, overview, events] = sources;
      const receivedAt = new Date().toISOString();
      const sourceReceiptTimes = sources.map((source) => Date.parse(source.received_at));
      const maxReceiptSkewMs =
        sourceReceiptTimes.length < 2 ? 0 : Math.max(...sourceReceiptTimes) - Math.min(...sourceReceiptTimes);
      const qualityIssues: SnapshotQualityIssue[] = [];

      // The scanner response has no source/candle timestamp. Keep that limitation
      // visible rather than presenting separately fetched values as atomic market state.
      addIssue(
        qualityIssues,
        "source_timestamp_unavailable",
        "warning",
        "TradingView scanner responses do not include a common source timestamp; received_at is the MCP receipt time, not market-data time.",
      );

      let quoteRows: Array<{ symbol: string; values: Record<string, unknown> }> = [];
      if (quotes.status === "ok" && quotes.value !== null) {
        const rawQuoteRows = quotes.value.rows;
        const rowCounts = new Map<string, number>();
        for (const row of rawQuoteRows) rowCounts.set(row.symbol, (rowCounts.get(row.symbol) ?? 0) + 1);
        const duplicateRequired = symbols.filter((symbol) => (rowCounts.get(symbol) ?? 0) > 1);
        if (duplicateRequired.length > 0) {
          addIssue(qualityIssues, "duplicate_required_quote", "error", "The quote source returned duplicate rows for a required symbol.", duplicateRequired);
        }
        const duplicateAuxiliary = (auxiliary_symbols ?? []).filter((symbol) => (rowCounts.get(symbol) ?? 0) > 1);
        if (duplicateAuxiliary.length > 0) {
          addIssue(qualityIssues, "duplicate_auxiliary_quote", "warning", "The quote source returned duplicate rows for an auxiliary symbol.", duplicateAuxiliary);
        }
        const unexpectedSymbols = rawQuoteRows
          .map((row) => row.symbol)
          .filter((symbol, index, all) => !requestedSymbols.includes(symbol) && all.indexOf(symbol) === index);
        if (unexpectedSymbols.length > 0) {
          addIssue(qualityIssues, "unexpected_quote_symbol", "warning", "The quote source returned symbols that were not requested.", unexpectedSymbols);
        }
        const quotedBySymbol = new Map(rawQuoteRows.map((row) => [row.symbol, row]));
        quoteRows = requestedSymbols.flatMap((symbol) => {
          const row = quotedBySymbol.get(symbol);
          return row ? [row] : [];
        });
        const missingTargets = symbols.filter((symbol) => !quotedBySymbol.has(symbol));
        if (missingTargets.length > 0) {
          addIssue(qualityIssues, "required_symbol_missing", "error", "No quote data was returned for a required symbol.", missingTargets);
        }
        const missingAuxiliary = (auxiliary_symbols ?? []).filter((symbol) => !quotedBySymbol.has(symbol));
        if (missingAuxiliary.length > 0) {
          addIssue(qualityIssues, "auxiliary_symbol_missing", "warning", "No quote data was returned for an auxiliary symbol.", missingAuxiliary);
        }
        const invalidFields = symbols.filter((symbol) => {
          const row = quotedBySymbol.get(symbol);
          return row !== undefined && requiredQuoteFields.some((field) => {
            const value = row.values[field];
            return !isPresent(value) || !Number.isFinite(value) || ((field === "bid" || field === "ask") && (value as number) <= 0);
          });
        });
        if (invalidFields.length > 0) {
          addIssue(
            qualityIssues,
            "required_quote_field_invalid",
            "error",
            `A required symbol is missing or has a non-numeric required quote field: ${requiredQuoteFields.join(", ")}.`,
            invalidFields,
          );
        }
        const invertedQuotes = symbols.filter((symbol) => {
          const values = quotedBySymbol.get(symbol)?.values;
          return values !== undefined && Number.isFinite(values.bid) && Number.isFinite(values.ask) && (values.ask as number) < (values.bid as number);
        });
        if (invertedQuotes.length > 0) {
          addIssue(qualityIssues, "bid_ask_inverted", "error", "A required symbol has ask below bid.", invertedQuotes);
        }
      } else {
        addIssue(qualityIssues, "quotes_unavailable", "error", "Quote retrieval failed; the snapshot cannot support analysis.");
      }

      const mtf = overview?.status === "ok" ? overview.value : null;
      if (overview?.status === "error") {
        addIssue(qualityIssues, "mtf_overview_unavailable", "warning", "Multi-timeframe overview retrieval failed.");
      }
      const economicEvents = events?.status === "ok" ? events.value : null;
      if (events?.status === "error") {
        addIssue(qualityIssues, "economic_events_unavailable", "warning", "Economic calendar retrieval failed.");
      }

      return jsonResult({
        schema_version: "1.0",
        snapshot_id: randomUUID(),
        status: snapshotStatus(qualityIssues),
        data_use: {
          mode: "display_only_analysis_assist",
          automated_trading_decision: "not_permitted",
        },
        requested_at: requestedAt,
        received_at: receivedAt,
        request_started_at: requestedAt,
        request_completed_at: receivedAt,
        latency_ms: Date.parse(receivedAt) - Date.parse(requestedAt),
        max_source_skew_ms: null,
        max_receipt_skew_ms: maxReceiptSkewMs,
        sources: sources.map(({ value: _value, ...source }) => source),
        requested_symbols: requestedSymbols,
        required_symbols: symbols,
        auxiliary_symbols: auxiliary_symbols ?? [],
        returned_symbols: quoteRows.map((row) => row.symbol),
        required_quote_fields: requiredQuoteFields,
        quotes: quoteRows,
        normalized_quotes: quoteRows.map(normalizeQuote),
        mtf_overview: mtf,
        economic_events: economicEvents,
        quality_issues: qualityIssues,
      });
    },
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
        "Change the active TradingView chart to a different symbol, e.g. 'BTCUSD', " +
        "'OANDA:EURUSD', 'NASDAQ:AAPL'. Returns the resulting symbol and timeframe.",
      inputSchema: {
        symbol: z
          .string()
          .min(1)
          .describe("Symbol to display, optionally exchange-prefixed"),
      },
    },
    async ({ symbol }) =>
      chartOperations.run(async () => {
        try {
          return jsonResult(await tv.setSymbol(symbol));
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  server.registerTool(
    "set_timeframe",
    {
      description:
        "Change the active TradingView chart's timeframe. Examples: '1', '5', '15', '60', " +
        "'240' (minutes), '1D', '1W', '1M'. Returns the resulting symbol and timeframe.",
      inputSchema: {
        resolution: z.string().min(1).describe("Timeframe/resolution string"),
      },
    },
    async ({ resolution }) =>
      chartOperations.run(async () => {
        try {
          return jsonResult(await tv.setResolution(resolution));
        } catch (err) {
          return errorResult(err);
        }
      }),
  );

  return server;
}
