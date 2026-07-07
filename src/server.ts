import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CdpClient } from "./cdp.js";
import type { TradingView } from "./tradingview.js";

/** Injectable dependencies so the server can be tested without a live app. */
export interface ServerDeps {
  cdp: Pick<CdpClient, "screenshot">;
  tv: Pick<
    TradingView,
    "getChartContext" | "getOhlcv" | "setSymbol" | "setResolution"
  >;
}

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

export function createServer({ cdp, tv }: ServerDeps): McpServer {
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
        "active indicators, plus which chart is active. Call this first to know what the " +
        "user is looking at.",
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
