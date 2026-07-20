import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_WALK_FORWARD_E2E_CONFIG";
const config = process.env[CONFIG_ENV] ? JSON.parse(process.env[CONFIG_ENV]) : null;

function toolPayload(result, name) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no text`);
  try {
    return { value: JSON.parse(text), isError: result.isError === true };
  } catch (error) {
    if (result.isError === true) return { value: { error: text }, isError: true };
    throw error;
  }
}

function containsKey(value, key) {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([name, item]) => name === key || containsKey(item, key));
}

test("research protocol and ledger stress over MCP stdio and live TradingView", {
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
  const client = new Client({ name: "tradingview-research-stress-e2e", version: "1.0.0" });
  const call = async (name, args, timeout = 30_000) =>
    toolPayload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);

  try {
    await client.connect(transport);
    const before = (await call("get_chart_context", {})).value;
    const walkForward = await call("run_strategy_walk_forward", config);
    assert.equal(walkForward.isError, false);
    assert.equal(walkForward.value.status, "preview");
    const candidate = walkForward.value.definition.candidates[0];
    const firstFold = config.folds[0];
    const lastFold = config.folds.at(-1);

    let protocol;
    await t.test("validates the exact Pine version and frozen IS/OOS contract", async () => {
      const result = await call("validate_research_protocol", {
        pine_id: candidate.pineId,
        pine_version: candidate.pineVersion,
        candidate_ids: walkForward.value.definition.candidates.map((item) => item.candidateId),
        windows: [
          { window_id: "e2e-is", population: "in_sample", from: firstFold.train_from, to: firstFold.train_to },
          { window_id: "e2e-oos", population: "out_of_sample", from: lastFold.test_from, to: lastFold.test_to },
        ],
        minimum_trades: config.minimum_train_trades ?? 30,
        observed_trades: null,
        costs: { spread_pips: 1, slippage_pips_per_side: 0.2, commission_per_round_trip: 10 },
        closed_bars_only: true,
        restart_diff_checked: false,
        definition_frozen_at: firstFold.train_from,
        definition_last_changed_at: firstFold.train_from,
        oos_first_viewed_at: null,
      });
      assert.equal(result.isError, false);
      assert.notEqual(result.value.status, "blocked");
      assert.equal(result.value.definition.pineVersion, candidate.pineVersion);
      assert.match(result.value.protocolId, /^sha256:[a-f0-9]{64}$/);
      protocol = result.value;
      const current = (await call("get_chart_context", {})).value;
      assert.deepEqual(current, before);
    });

    const stressArgs = {
      protocol_id: protocol.protocolId,
      expected_symbol: config.expected_symbol,
      expected_timeframe: config.expected_timeframe,
      pine_id: candidate.pineId,
      pine_version: candidate.pineVersion,
      inputs: candidate.inputs,
      evaluation_from: firstFold.train_from,
      evaluation_to: lastFold.test_to,
      minimum_trades: config.minimum_train_trades ?? 30,
      scenarios: [
        { scenario_id: "e2e-cost", kind: "additional_cost_per_trade", value: 10 },
        { scenario_id: "e2e-commission", kind: "commission_multiplier", value: 2 },
        { scenario_id: "e2e-start-shift", kind: "start_shift_bars", value: 1 },
      ],
      bootstrap: { seed: "e2e-fixed-seed", iterations: 100, failure_net_profit: 0 },
    };

    await t.test("previews without changing the chart", async () => {
      const preview = await call("stress_test_strategy", stressArgs);
      assert.equal(preview.isError, false);
      assert.equal(preview.value.status, "preview");
      assert.equal(preview.value.execution.automaticAdoption, false);
      assert.deepEqual((await call("get_chart_context", {})).value, before);
    });

    await t.test("collects one ledger, returns bounded stress evidence, and restores", async () => {
      const completed = await call("stress_test_strategy", { ...stressArgs, confirm: true }, 210_000);
      assert.equal(completed.isError, false);
      assert.ok(["complete", "partial"].includes(completed.value.status));
      assert.equal(completed.value.collection.status, "complete");
      assert.ok(completed.value.evaluation.baseline.metrics.totalTrades >= stressArgs.minimum_trades);
      assert.equal(completed.value.evaluation.bootstrap.iterations, 100);
      assert.equal(containsKey(completed.value, "trades"), false);
      assert.equal(completed.value.chartState.restored, true);
      assert.deepEqual((await call("get_chart_context", {})).value, before);
    });
  } catch (error) {
    if (stderr.length > 0) error.message += `\nMCP stderr:\n${stderr.join("").slice(-4000)}`;
    throw error;
  } finally {
    await client.close();
  }
});
