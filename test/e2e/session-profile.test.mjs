import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_SESSION_PROFILE_E2E_CONFIG";
const config = process.env[CONFIG_ENV] ? JSON.parse(process.env[CONFIG_ENV]) : null;

function payload(result, name) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no text`);
  if (result.isError === true) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text);
}

function containsArrayAtKey(value, key) {
  if (Array.isArray(value)) return value.some((item) => containsArrayAtKey(item, key));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([name, item]) =>
    (name === key && Array.isArray(item)) || containsArrayAtKey(item, key));
}

test("session profile over MCP stdio and live TradingView", {
  skip: config ? false : `${CONFIG_ENV} is not set`,
  timeout: 90_000,
}, async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    cwd: process.cwd(),
    env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
    stderr: "pipe",
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const client = new Client({ name: "tradingview-session-profile-e2e", version: "1.0.0" });
  try {
    await client.connect(transport);
    const call = async (name, args, timeout = 30_000) =>
      payload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "compute_session_profile"));
    const before = await call("get_chart_context", {});
    const result = await call("compute_session_profile", config, 60_000);
    assert.equal(result.symbol.toUpperCase(), config.expected_symbol.toUpperCase());
    assert.equal(result.timeframe, config.expected_timeframe);
    assert.equal(result.volumeKind, "tradingview_bar_volume_unverified_tick_or_exchange_volume");
    assert.equal(containsArrayAtKey(result, "bars"), false, "raw OHLC arrays must not be returned");
    assert.ok(result.sample.sessionObservations > 0);
    t.diagnostic(`status=${result.status} sample=${JSON.stringify(result.sample)} quality=${JSON.stringify(result.quality)}`);
    const summary = Object.fromEntries(Object.entries(result.bySession).map(([sessionId, details]) => [sessionId, {
      sessionDays: details.sessionDays,
      completeSessionDays: details.completeSessionDays,
      rangeMedian: details.range.median,
      returnMean: details.return.mean,
      openingRangeMedian: details.openingRange.median,
    }]));
    t.diagnostic(`summary=${JSON.stringify(summary)}`);
    const after = await call("get_chart_context", {});
    assert.deepEqual(after, before);
  } catch (error) {
    if (stderr.length > 0) error.message += `\nMCP stderr:\n${stderr.join("").slice(-4000)}`;
    throw error;
  } finally {
    await client.close();
  }
});
