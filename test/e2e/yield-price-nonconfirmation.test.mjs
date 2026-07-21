import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_YIELD_PRICE_E2E_CONFIG";
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

test("yield-price nonconfirmation over MCP stdio and live TradingView", {
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
  const client = new Client({ name: "tradingview-yield-price-e2e", version: "1.0.0" });
  try {
    await client.connect(transport);
    const call = async (name, args, timeout = 30_000) =>
      payload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "run_yield_price_nonconfirmation_study"));
    const before = await call("get_chart_context", {});
    const result = await call("run_yield_price_nonconfirmation_study", config, 60_000);
    assert.equal(result.target.symbol.toUpperCase(), config.expected_target_symbol.toUpperCase());
    assert.equal(result.driver.symbol.toUpperCase(), config.expected_driver_symbol.toUpperCase());
    assert.equal(result.relationship, config.relationship);
    assert.equal(result.joinContract.forwardFill, false);
    assert.equal(result.joinContract.exactTimestampRequired, false);
    assert.equal(containsKey(result, "bars"), false, "raw OHLC arrays must not amplify the response");
    t.diagnostic(`events=${result.sample.events} driver_impulses=${result.quality.driverImpulses} ` +
      `up_failures=${result.byBranch.driver_up_target_failure.events} ` +
      `down_failures=${result.byBranch.driver_down_target_failure.events}`);
    t.diagnostic(`by_branch=${JSON.stringify(result.byBranch)}`);
    t.diagnostic(`folds=${JSON.stringify(result.folds)}`);
    const after = await call("get_chart_context", {});
    assert.deepEqual(after, before);
  } catch (error) {
    if (stderr.length > 0) error.message += `\nMCP stderr:\n${stderr.join("").slice(-4000)}`;
    throw error;
  } finally {
    await client.close();
  }
});
