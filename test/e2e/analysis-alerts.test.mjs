import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_ANALYSIS_ALERTS_E2E_CONFIG";
let config = null;
if (process.env[CONFIG_ENV]) {
  try {
    config = JSON.parse(process.env[CONFIG_ENV]);
  } catch (err) {
    throw new Error(`Invalid JSON in ${CONFIG_ENV}: ${err.message}`);
  }
}

function payload(result, name) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no text`);
  if (result.isError === true) throw new Error(`${name} failed: ${text}`);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${name} returned non-JSON payload: ${text} (${err.message})`);
  }
}

test("analysis alerts creation over MCP stdio and live TradingView", {
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
  const client = new Client({ name: "tradingview-analysis-alerts-e2e", version: "1.0.0" });
  try {
    await client.connect(transport);
    const call = async (name, args, timeout = 30_000) =>
      payload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);

    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "create_analysis_alerts"));

    const before = await call("get_chart_context", {});

    // Step 1: Always test dry-run preview mode first
    const previewConfig = { ...config, confirm: false };
    const previewResult = await call("create_analysis_alerts", previewConfig, 60_000);
    assert.equal(previewResult.status, "preview");
    assert.equal(previewResult.dryRun, true);
    assert.equal(typeof previewResult.ownershipName, "string");
    assert.ok(previewResult.ownershipName.startsWith("BUSHIDO-MCP:"));
    assert.ok(Array.isArray(previewResult.plans));

    t.diagnostic(`preview status=${previewResult.status} ownershipName=${previewResult.ownershipName} plans=${previewResult.plans.length}`);

    // Step 2: Test live creation if config.confirm is explicitly true
    if (config.confirm) {
      const liveResult = await call("create_analysis_alerts", config, 60_000);
      assert.equal(liveResult.dryRun, false);
      assert.ok(["complete", "partial"].includes(liveResult.status));
      assert.ok(Array.isArray(liveResult.alerts));

      const alertsOnApp = await call("list_alerts", {});
      assert.ok(Array.isArray(alertsOnApp));
      for (const alert of liveResult.alerts) {
        assert.ok(alertsOnApp.some((item) => item.name === alert.name));
      }
      t.diagnostic(`confirm status=${liveResult.status} createdAlerts=${liveResult.alerts.length}`);
    }

    const after = await call("get_chart_context", {});
    assert.deepEqual(after, before);
  } catch (error) {
    const msg = String(error?.message || error);
    if (stderr.length > 0) {
      throw new Error(`${msg}\nMCP stderr:\n${stderr.join("").slice(-4000)}`);
    }
    throw error;
  } finally {
    await client.close();
  }
});
