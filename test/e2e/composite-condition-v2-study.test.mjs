import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_COMPOSITE_V2_E2E_CONFIG";
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

test("composite_condition v2 event study MCP tool definition and stdio interface", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    cwd: process.cwd(),
    env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
    stderr: "pipe",
  });
  const client = new Client({ name: "tradingview-composite-v2-e2e", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const eventStudyTool = tools.tools.find((tool) => tool.name === "run_market_event_study");
    assert.ok(eventStudyTool, "run_market_event_study tool must be registered in MCP server");

    // Verify MCP JSON Schema includes v2 composite_condition operator enums and regime_gate
    const schema = JSON.stringify(eventStudyTool.inputSchema);
    assert.ok(schema.includes("negation"), "schema must support negation operator");
    assert.ok(schema.includes("sequence"), "schema must support sequence operator");
    assert.ok(schema.includes("sequence_window_bars"), "schema must support sequence_window_bars");
    assert.ok(schema.includes("lookback_bars"), "schema must support lookback_bars");
    assert.ok(schema.includes("lookahead_bars"), "schema must support lookahead_bars");
    assert.ok(schema.includes("regime_gate"), "schema must support regime_gate");

    // If live configuration is provided via env, perform live E2E tool execution
    if (config) {
      const call = async (name, args, timeout = 30_000) =>
        payload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);

      const result = await call("run_market_event_study", config, 60_000);
      assert.equal(result.conditionType, "composite_condition");
      assert.ok(
        result.methodologyVersion === "composite_condition_event_study_v2" ||
        result.methodologyVersion === "composite_condition_event_regime_study_v2"
      );
      assert.equal(result.symbol.toUpperCase(), config.expected_symbol.toUpperCase());
      assert.equal(result.timeframe, config.expected_timeframe);
      assert.equal(containsKey(result, "bars"), false, "raw OHLC arrays must not amplify the response");
      if (config.journal) {
        assert.equal(result.journal.recorded, true);
      }
    }
  } finally {
    await client.close();
  }
});
