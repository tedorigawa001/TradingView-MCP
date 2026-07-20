import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisPerformance } from "../../build/analysisPerformance.js";

const record = (id, symbol, outcome, performance, strategyVersion = "v1") => ({
  definition: {
    analysis_id: id,
    definition_hash: `hash-${id}`,
    payload: {
      analysisId: id,
      symbol,
      timeframe: "60",
      bias: "bullish",
      strategyVersion,
    },
  },
  latestOutcome: outcome === null ? null : {
    payload: {
      status: "complete",
      outcome,
      result: performance === null ? {} : { performance },
    },
  },
  outcomeCount: outcome === null ? 0 : 1,
});

const metrics = (grossRealizedR, mfeR, maeR) => ({
  methodologyVersion: "1.0",
  structuralRiskPrice: 0.01,
  grossRealizedR,
  excursion: { mfeR, maeR },
  timing: {
    analyzedToEntryMs: 60_000,
    entryToConfirmationMs: null,
    activationToTerminalMs: 120_000,
  },
});

test("buildAnalysisPerformance keeps metric populations explicit and applies only supplied costs", () => {
  const report = buildAnalysisPerformance([
    record("win", "OANDA:EURUSD", "target_before_stop", metrics(2, 2.5, 0.4)),
    record("loss", "OANDA:EURUSD", "stop_before_target", metrics(-1, 0.3, 1)),
    record("legacy", "OANDA:EURUSD", "target_before_stop", null),
    record("none", "OANDA:EURUSD", null, null),
  ], {
    costs: [{ symbol: "OANDA:EURUSD", totalPricePerUnit: 0.001 }],
  });
  const group = report.groups[0];
  assert.equal(group.analyses, 4);
  assert.equal(group.binary.included, 3);
  assert.equal(group.binary.winRate, 2 / 3);
  assert.equal(group.rMultiples.grossIncluded, 2);
  assert.ok(Math.abs(group.rMultiples.meanGrossRealizedR - 0.5) < 1e-9);
  assert.ok(Math.abs(group.rMultiples.meanNetRealizedR - 0.4) < 1e-9);
  assert.equal(group.excursions.included, 2);
  assert.equal(group.excluded.path_metrics_unavailable, 1);
  assert.equal(group.excluded.no_latest_evaluation, 1);
});

test("buildAnalysisPerformance filters and groups without mixing strategy versions", () => {
  const report = buildAnalysisPerformance([
    record("one", "OANDA:EURUSD", "target_before_stop", metrics(1, 1, 0.2), "v1"),
    record("two", "OANDA:USDJPY", "stop_before_target", metrics(-1, 0.1, 1), "v2"),
  ], { groupBy: "strategy_version", strategyVersion: "v2" });
  assert.equal(report.filtered, 1);
  assert.equal(report.groups[0].key, "v2");
  assert.equal(report.groups[0].binary.losses, 1);
});

test("buildAnalysisPerformance rejects duplicate symbol cost assumptions", () => {
  assert.throws(() => buildAnalysisPerformance([], {
    costs: [
      { symbol: "OANDA:EURUSD", totalPricePerUnit: 0.001 },
      { symbol: "oanda:eurusd", totalPricePerUnit: 0.002 },
    ],
  }), /duplicate cost assumption/);
});
