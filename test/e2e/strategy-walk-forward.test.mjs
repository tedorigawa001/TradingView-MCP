import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_WALK_FORWARD_E2E_CONFIG";

function parseConfig() {
  const raw = process.env[CONFIG_ENV];
  if (!raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${CONFIG_ENV} must be valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${CONFIG_ENV} must be a JSON object`);
  }
  if (value.confirm !== undefined) {
    throw new Error(`${CONFIG_ENV} must not contain confirm; the test controls write confirmation`);
  }
  return value;
}

function parseJsonToolResult(result, name) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no JSON text`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    if (result.isError === true) return { payload: { error: text }, isError: true };
    throw new Error(`${name} returned invalid JSON: ${error.message}`);
  }
  return { payload, isError: result.isError === true };
}

function containsKey(value, forbidden) {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, forbidden));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => key === forbidden || containsKey(item, forbidden));
}

function normalizeResolution(value) {
  return String(value).toUpperCase().replace(/^1([SHDW])$/, "$1");
}

const config = parseConfig();

test("run_strategy_walk_forward over MCP stdio and live TradingView", {
  skip: config ? false : `${CONFIG_ENV} is not set`,
  timeout: 240_000,
}, async (t) => {
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    cwd: process.cwd(),
    env: childEnv,
    stderr: "pipe",
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const client = new Client({ name: "tradingview-walk-forward-e2e", version: "1.0.0" });

  const callJson = async (name, args, timeout = 30_000) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
    return parseJsonToolResult(result, name);
  };

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "run_strategy_walk_forward"));

    const beforeResult = await callJson("get_chart_context", {});
    assert.equal(beforeResult.isError, false);
    const before = beforeResult.payload;
    const active = before.charts[before.activeChartIndex ?? 0];
    assert.equal(active.symbol.toUpperCase(), config.expected_symbol.toUpperCase());
    assert.equal(normalizeResolution(active.resolution), normalizeResolution(config.expected_timeframe));

    await t.test("rejects a stale chart binding without mutation", async () => {
      const bad = await callJson("run_strategy_walk_forward", {
        ...config,
        expected_symbol: "INVALID:E2E_BINDING",
      });
      assert.equal(bad.isError, true);
      assert.match(bad.payload.error, /active chart symbol changed/);
      const current = await callJson("get_chart_context", {});
      assert.deepEqual(current.payload, before);
    });

    let preview;
    await t.test("dry-run is deterministic and does not touch the chart", async () => {
      const first = await callJson("run_strategy_walk_forward", config);
      const second = await callJson("run_strategy_walk_forward", config);
      assert.equal(first.isError, false);
      assert.equal(second.isError, false);
      assert.equal(first.payload.dryRun, true);
      assert.equal(first.payload.status, "preview");
      assert.equal(first.payload.walkForwardId, second.payload.walkForwardId);
      assert.equal(first.payload.execution.nonSelectedOosMetricsExposed, false);
      assert.equal(containsKey(first.payload, "includedReportIndexes"), false);
      preview = first.payload;
      const current = await callJson("get_chart_context", {});
      assert.deepEqual(current.payload, before);
    });

    await t.test("confirmed run selects on train, exposes selected OOS only, and restores", async () => {
      const completed = await callJson(
        "run_strategy_walk_forward",
        { ...config, confirm: true },
        Math.max(210_000, (config.max_runtime_seconds ?? 180) * 1000 + 30_000),
      );
      assert.equal(completed.isError, false);
      const result = completed.payload;
      assert.equal(result.dryRun, false);
      assert.equal(result.status, "complete");
      assert.equal(result.walkForwardId, preview.walkForwardId);
      assert.equal(result.candidates.length, config.candidates.length);
      assert.ok(result.candidates.every((candidate) => candidate.status === "collected"));
      assert.equal(result.conditions.matched, true);
      assert.equal(result.evaluation.status, "complete");
      assert.equal(result.evaluation.folds.length, config.folds.length);
      assert.equal(result.evaluation.oosAggregate.evaluableFolds, config.folds.length);
      assert.ok(result.evaluation.oosAggregate.metrics.totalTrades >= (config.minimum_test_trades ?? 10));
      for (const fold of result.evaluation.folds) {
        assert.equal(fold.selection.status, "selected");
        assert.equal(fold.test.candidateId, fold.selection.candidateId);
        assert.equal(fold.test.minimumTradesMet, true);
        assert.equal(Object.hasOwn(fold, "nonSelectedTest"), false);
      }
      assert.deepEqual(result.qualityIssues, []);
      assert.equal(containsKey(result, "includedReportIndexes"), false);
      assert.equal(containsKey(result, "trades"), false);
      assert.equal(result.chartState.restored, true);

      const after = await callJson("get_chart_context", {});
      assert.deepEqual(after.payload, before);
    });
  } catch (error) {
    if (stderr.length > 0) error.message += `\nMCP stderr:\n${stderr.join("").slice(-4000)}`;
    throw error;
  } finally {
    await client.close();
  }
});
