import test from "node:test";
import assert from "node:assert/strict";
import {
  compareStrategyConditions,
  compareStrategyMetrics,
  summarizeStrategyEvidence,
} from "../../build/strategyExperiment.js";

function evidence({ profits = [10, -5], commission = 0.01 } = {}) {
  const trades = profits.map((profit, reportIndex) => ({
    reportIndex,
    number: null,
    direction: reportIndex % 2 ? "short" : "long",
    status: "closed",
    entry: null,
    exit: null,
    durationMilliseconds: (reportIndex + 1) * 1000,
    profit,
    profitPercent: null,
    cumulativeProfit: null,
    quantity: 1,
    commission: 1,
    commissionPercent: null,
    runUp: profit > 0 ? profit + 2 : 1,
    runUpPercent: null,
    drawDown: profit < 0 ? -profit + 1 : 2,
    drawDownPercent: null,
  }));
  return {
    report: {
      strategy: "Test",
      currency: "USD",
      initialCapital: 1000,
      dateRange: null,
      summary: { netProfit: profits.reduce((sum, value) => sum + value, 0), profitFactor: 2 },
      totalTrades: trades.length,
      trades: [],
    },
    ledger: {
      schemaVersion: "1.0",
      ledgerId: `sha256:${"a".repeat(64)}`,
      strategy: "Test",
      symbol: "OANDA:USDJPY",
      timeframe: "240",
      studyId: "st1",
      pineId: "USER;aaaaaaaa",
      pineVersion: "1.0",
      inputs: [{ id: "in_0", name: "Commission Value", value: commission }],
      currency: "USD",
      initialCapital: 1000,
      dateRange: null,
      summary: { totalTrades: trades.length },
      totalTrades: trades.length,
      availableTrades: trades.length,
      countMatchesSummary: true,
      ordering: "strategy_report",
      offset: 0,
      limit: trades.length,
      returned: trades.length,
      nextOffset: null,
      complete: true,
      unavailableFields: [],
      qualityIssues: [],
      trades,
    },
  };
}

test("strategy experiment summarizes path metrics and keeps null metric deltas honest", () => {
  const baseline = summarizeStrategyEvidence(evidence(), 2);
  const candidate = summarizeStrategyEvidence(evidence({ profits: [20, 30] }), 2);
  assert.equal(baseline.minimumTradesMet, true);
  assert.equal(baseline.metrics.expectancy, 2.5);
  assert.equal(candidate.metrics.expectancy, 25);
  const comparison = compareStrategyMetrics(baseline.metrics, candidate.metrics);
  assert.equal(comparison.expectancy.delta, 22.5);
  assert.equal(comparison.sortinoRatio.delta, null);
});

test("strategy experiment blocks comparisons whose cost conditions differ", () => {
  const conditions = compareStrategyConditions(
    evidence({ commission: 0.01 }).ledger,
    evidence({ commission: 0.02 }).ledger,
  );
  assert.equal(conditions.matched, false);
  assert.equal(conditions.differences[0].condition, "commission value");
  assert.ok(conditions.qualityIssues.includes("experiment_conditions_differ"));
});
