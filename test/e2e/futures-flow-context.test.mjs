import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_FUTURES_FLOW_E2E_CONFIG";
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

test("futures flow context over MCP stdio and live TradingView", {
  skip: config ? false : `${CONFIG_ENV} is not set`, timeout: 90_000,
}, async (t) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["build/index.js"], cwd: process.cwd(),
    env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)), stderr: "pipe" });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const client = new Client({ name: "tradingview-futures-flow-e2e", version: "1.0.0" });
  try {
    await client.connect(transport);
    const call = async (name, args, timeout = 30_000) =>
      payload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "get_futures_flow_context"));
    const before = await call("get_chart_context", {});
    const result = await call("get_futures_flow_context", config, 60_000);
    assert.equal(result.mapping.targetSymbol.toUpperCase(), config.target_symbol.toUpperCase());
    assert.equal(result.mapping.futuresSymbol.toUpperCase(), config.expected_futures_symbol.toUpperCase());
    assert.ok(["unavailable", "available", "partial"].includes(result.openInterest.status));
    assert.equal(containsArrayAtKey(result, "bars"), false, "raw OHLCV arrays must not be returned");
    assert.ok(result.sample.observations > 0);
    t.diagnostic(`current=${JSON.stringify(result.current)} quality=${JSON.stringify(result.quality)}`);
    t.diagnostic(`cot_status=${result.cot.status} issues=${JSON.stringify(result.qualityIssues)}`);
    const after = await call("get_chart_context", {});
    assert.deepEqual(after, before);
  } catch (error) {
    if (stderr.length > 0) error.message += `\nMCP stderr:\n${stderr.join("").slice(-4000)}`;
    throw error;
  } finally {
    await client.close();
  }
});
