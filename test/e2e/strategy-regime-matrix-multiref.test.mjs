import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_REGIME_MATRIX_MULTIREF_E2E_CONFIG";

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

const config = parseConfig();

test("run_strategy_regime_matrix multi-reference-symbol correlation over MCP stdio and live TradingView", {
  skip: config ? false : `${CONFIG_ENV} is not set`,
  timeout: 240_000,
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
  const client = new Client({ name: "tradingview-regime-matrix-multiref-e2e", version: "1.0.0" });

  const callJson = async (name, args, timeout = 30_000) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
    return parseJsonToolResult(result, name);
  };

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "run_strategy_regime_matrix"));

    const beforeResult = await callJson("get_chart_context", {});
    assert.equal(beforeResult.isError, false);
    const before = beforeResult.payload;

    // Each job in config.jobs is expected to carry its own correlation_regime with a
    // distinct expected_reference_symbol; at least one should require
    // allow_reference_symbol_switch: true to exercise the temporary-switch-and-restore path.
    const referenceSymbols = new Set(
      (config.jobs ?? [])
        .map((job) => job.correlation_regime?.expected_reference_symbol)
        .filter((symbol) => typeof symbol === "string"),
    );
    assert.ok(referenceSymbols.size >= 2, "config must exercise at least two distinct reference symbols");

    let preview;
    await t.test("preview reports unique reference symbols and a multiple-reference warning", async () => {
      const first = await callJson("run_strategy_regime_matrix", config);
      assert.equal(first.isError, false);
      preview = first.payload;
      assert.equal(preview.dryRun, true);
      assert.equal(preview.status, "preview");
      assert.deepEqual(new Set(preview.definition.uniqueReferenceSymbols), referenceSymbols);
      assert.ok(preview.definition.inferenceWarnings.includes("multiple_reference_symbols_inspected_in_matrix"));
      const current = await callJson("get_chart_context", {});
      assert.deepEqual(current.payload, before);
    });

    await t.test("confirmed run collects per-job correlation evidence and restores every chart", async () => {
      const completed = await callJson(
        "run_strategy_regime_matrix",
        { ...config, confirm: true },
        Math.max(210_000, (config.max_runtime_seconds ?? 180) * 1000 + 30_000),
      );
      assert.equal(completed.isError, false);
      const result = completed.payload;
      assert.equal(result.dryRun, false);
      assert.equal(result.matrixId, preview.matrixId);
      assert.equal(result.results.length, config.jobs.length);
      for (const row of result.results) {
        if (row.correlationEvidence) {
          assert.ok(referenceSymbols.has(row.correlationEvidence.referenceSymbol));
          assert.ok(row.correlationEvidence.sample.observations >= 0);
        }
      }
      assert.equal(result.chartStateAfter.restored, true);
      assert.equal(result.chartStateAfter.referenceRestored, true);

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
