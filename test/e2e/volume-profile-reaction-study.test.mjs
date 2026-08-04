import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONFIG_ENV = "TRADINGVIEW_VOLUME_PROFILE_REACTION_E2E_CONFIG";
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

test("volume-profile reaction study over MCP stdio and live TradingView", {
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
  const client = new Client({ name: "tradingview-volume-profile-reaction-e2e", version: "1.0.0" });
  try {
    await client.connect(transport);
    const call = async (name, args, timeout = 30_000) =>
      payload(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "run_volume_profile_reaction_study"));

    const before = await call("get_chart_context", {});
    const result = await call("run_volume_profile_reaction_study", config, 60_000);
    assert.equal(result.methodologyVersion, "chart_bar_volume_profile_reaction_event_study_v1");
    assert.equal(result.symbol.toUpperCase(), config.expected_symbol.toUpperCase());
    assert.equal(result.timeframe, "240");
    assert.deepEqual(result.profileContract, {
      semantics: "completed_chart_bar_volume_range_allocation_profile_proxy",
      rows: 24,
      valueAreaPercent: 70,
      volumeType: "exchange_reported_volume",
      nativeLowerTimeframeVolumeProfile: false,
    });
    assert.deepEqual(result.outcomeContract.horizons, [1, 2, 4, 8]);
    assert.equal(result.outcomeContract.targetReturnBps, 20);
    assert.equal(result.outcomeContract.contiguousBarsRequired, true);
    assert.equal(result.inferenceContract.candidacy,
      "disabled_descriptive_only_pending_falsification");
    assert.equal(result.inferenceContract.serialDependenceAdjustment, "none");
    assert.equal(result.inferenceContract.multipleTestingAdjustment, "none");
    assert.deepEqual(Object.keys(result.byBranch), [
      "vah_rejection_short",
      "val_rejection_long",
      "vah_acceptance_long",
      "val_acceptance_short",
    ]);
    assert.equal(result.sameRegimeBaseline.methodologyVersion,
      "volume_profile_same_regime_unconditional_baseline_v1");
    assert.equal(result.sameRegimeBaseline.contract.regimeKey, "directional_regime:volatility_regime");
    assert.equal(result.sameRegimeBaseline.contract.baselineEventExclusion,
      "all_volume_profile_event_signal_bars");
    assert.equal(result.sameRegimeBaseline.contract.standardization,
      "baseline_regime_means_weighted_by_event_outcome_counts");
    assert.ok(result.sample.profileObservations > 0);
    assert.ok(result.sample.events > 0);
    assert.equal(result.source.pineId, config.pine_id);
    assert.equal(result.source.studyId, config.study_id);
    assert.equal(result.source.chartIndex, config.chart_index ?? before.activeChartIndex);
    assert.equal(containsKey(result, "bars"), false, "raw OHLC arrays must not be returned");
    if (config.folds) {
      assert.deepEqual(result.folds.map((fold) => fold.foldId), config.folds.map((fold) => fold.fold_id));
    }

    t.diagnostic(`status=${result.status} events=${result.sample.events} ` +
      `branches=${JSON.stringify(Object.fromEntries(Object.entries(result.byBranch)
        .map(([branch, evidence]) => [branch, evidence.events])))} ` +
      `regimeJoined=${result.sameRegimeBaseline.coverage.joinedEvents} ` +
      `baselineBars=${result.sameRegimeBaseline.coverage.joinedBaselineBars} ` +
      `quality=${JSON.stringify(result.qualityIssues)}`);
    const after = await call("get_chart_context", {});
    assert.deepEqual(after, before);
  } catch (error) {
    if (stderr.length > 0) error.message += `\nMCP stderr:\n${stderr.join("").slice(-4000)}`;
    throw error;
  } finally {
    await client.close();
  }
});
