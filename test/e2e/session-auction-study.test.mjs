import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_SESSION_AUCTION_E2E_CONFIG";
const config = process.env[CONFIG_ENV] ? JSON.parse(process.env[CONFIG_ENV]) : null;

function payload(result, name) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no text`);
  if (result.isError === true) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text);
}

function containsKey(value, key) {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([name, item]) => name === key || containsKey(item, key));
}

test("session auction event study over MCP stdio and live TradingView", {
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
  const client = new Client({ name: "tradingview-session-auction-e2e", version: "1.0.0" });
  try {
    await client.connect(transport);
    const call = async (name, args, timeout = 30_000) =>
      payload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "run_market_event_study"));
    const before = await call("get_chart_context", {});
    const result = await call("run_market_event_study", config, 60_000);
    assert.equal(result.conditionType, "session_auction");
    assert.equal(result.symbol.toUpperCase(), config.expected_symbol.toUpperCase());
    assert.equal(result.timeframe, config.expected_timeframe);
    assert.ok(result.sample.events >= 1);
    assert.equal(result.eventsTruncated, result.sample.events > (config.event_limit ?? 50));
    assert.equal(result.inferenceContract.confidenceLevel, config.confidence_level ?? 0.95);
    assert.equal(result.inferenceContract.configurationTrials, config.configuration_trials ?? null);
    assert.equal(result.inferenceContract.multipleTestingAdjustment, "none");
    assert.equal(containsKey(result, "bars"), false, "raw OHLC arrays must not amplify the response");
    t.diagnostic(`source=${result.source.from}..${result.source.to} events=${result.sample.events} ` +
      `accepted_up=${result.byBranch.accepted_up.events} accepted_down=${result.byBranch.accepted_down.events} ` +
      `failed_up=${result.byBranch.failed_up.events} failed_down=${result.byBranch.failed_down.events}`);
    const after = await call("get_chart_context", {});
    assert.deepEqual(after, before);
  } catch (error) {
    if (stderr.length > 0) error.message += `\nMCP stderr:\n${stderr.join("").slice(-4000)}`;
    throw error;
  } finally {
    await client.close();
  }
});
