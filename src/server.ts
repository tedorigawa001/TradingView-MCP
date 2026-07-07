import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CdpClient } from "./cdp.js";
import type { TradingView } from "./tradingview.js";
import { MTF_TIMEFRAMES, SCAN_OPERATIONS, type Scanner } from "./scanner.js";

/** Injectable dependencies so the server can be tested without a live app. */
export interface ServerDeps {
  cdp: Pick<CdpClient, "screenshot">;
  tv: Pick<
    TradingView,
    | "getChartContext"
    | "getOhlcv"
    | "getIndicatorValues"
    | "getIndicatorInputs"
    | "getIndicatorGraphics"
    | "loadMoreHistory"
    | "listAlerts"
    | "getWatchlists"
    | "setSymbol"
    | "setResolution"
  >;
  scanner: Pick<Scanner, "getQuotes" | "scanMarket" | "getMtfOverview">;
}

const FIELD_SCHEMA = z.string().regex(/^[\w.|]{1,64}$/);

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export function createServer({ cdp, tv, scanner }: ServerDeps): McpServer {
  const server = new McpServer({
    name: "tradingview-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "get_chart_screenshot",
    {
      description:
        "Capture a screenshot of the TradingView desktop app window (all visible charts, " +
        "indicators, drawings and watchlist) for visual analysis.",
      inputSchema: {
        format: z
          .enum(["png", "jpeg"])
          .optional()
          .describe("Image format. jpeg is smaller; png is sharper. Default: jpeg"),
      },
    },
    async ({ format }) => {
      try {
        const fmt = format ?? "jpeg";
        const data = await cdp.screenshot(fmt);
        return {
          content: [{ type: "image" as const, data, mimeType: `image/${fmt}` }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async () => {
      try {
        return jsonResult(await tv.getChartContext());
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async ({ count, chart_index }) => {
      try {
        return jsonResult(await tv.getOhlcv(count ?? 100, chart_index));
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async ({ study_id, count, chart_index, include_all_plots }) => {
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
    },
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
    async ({ study_id, chart_index }) => {
      try {
        return jsonResult(
          await tv.getIndicatorInputs({ studyId: study_id, chartIndex: chart_index }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async ({ study_id, chart_index, limit_per_kind }) => {
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
    },
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
    async ({ count, chart_index }) => {
      try {
        return jsonResult(
          await tv.loadMoreHistory({ count: count ?? 300, chartIndex: chart_index }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
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
    "get_mtf_overview",
    {
      description:
        "Multi-timeframe overview of one symbol WITHOUT touching the user's chart: the " +
        "same indicator fields (default: close, RSI, ADX, ATR, EMA20, SMA50, SMA200 and " +
        "Recommend.* ratings) across several timeframes in a single call. Use this for " +
        "top-down analysis (e.g. 1D trend, 240/60 timing) before or instead of " +
        "set_timeframe.",
      inputSchema: {
        symbol: z
          .string()
          .regex(/^[\w!.:&-]{1,48}$/)
          .describe("Symbol in EXCHANGE:SYMBOL form, e.g. 'OANDA:EURUSD'"),
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
    async ({ symbol, timeframes, fields }) => {
      try {
        return jsonResult(await scanner.getMtfOverview(symbol, timeframes, fields));
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
    async ({ symbol }) => {
      try {
        return jsonResult(await tv.setSymbol(symbol));
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async ({ resolution }) => {
      try {
        return jsonResult(await tv.setResolution(resolution));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
