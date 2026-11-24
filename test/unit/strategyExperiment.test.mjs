import test from "node:test";
import assert from "node:assert/strict";
import {
  compareStrategyConditions,
  compareStrategyMetrics,
  diagnoseStrategyTradeOverlap,
  strategyOverlapSchema,
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

function overlappingRuns() {
  const at = minutes => Date.parse("2026-01-01T00:00:00Z") + minutes * 60_000;
  const iso = minutes => new Date(at(minutes)).toISOString();
  const trade = (entry, exit, quantity, profit) => ({
    direction: "long", status: exit === null ? "open" : "closed",
    entry: { time: at(entry), price: 1.2, label: "buy" },
    exit: exit === null ? null : { time: at(exit), price: 1.3, label: "exit" },
    quantity, profit, commission: 0.25,
  });
  const ledger = (start, end, trades) => ({
    ...evidence().ledger, symbol: "OANDA:EURUSD", timeframe: "5",
    dateRange: { from: iso(start), to: iso(end) },
    availableTrades: trades.length, totalTrades: trades.filter(row => row.status === "closed").length, trades,
  });
  return {
    earlier: ledger(0, 55, [trade(5, 15, 1, 10), trade(20, 40, 2, 5)]),
    later: ledger(15, 65, [trade(20, 40, 3, 7)]),
    from: iso(20), to: iso(50), boundary: iso(25),
  };
}

test("trade overlap detects equal-price trades with different quantities and realized equity resets", () => {
  const input = strategyOverlapSchema.parse(overlappingRuns());
  const result = diagnoseStrategyTradeOverlap(input);
  assert.equal(result.counts.matchedByIdentity, 1);
  assert.equal(result.counts.different, 1);
  assert.deepEqual(result.firstDifference, { entryTime: Date.parse(input.from), kind: "different", fields: ["quantity", "profit"] });
  assert.equal(result.boundary.earlier.realizedEquity, 1010);
  assert.equal(result.boundary.later.realizedEquity, 1000);
  assert.equal(result.boundary.realizedEquityMatches, false);
  assert.equal(result.boundary.positionsMatch, false);
  assert.equal(result.boundary.indicators, "unconfirmed");
  assert.equal(result.boundary.pendingOrders, "unconfirmed");
  assert.equal(result.continuity, "discontinuous");
  assert.equal(result.continuousAggregationEligible, false);
});

test("trade overlap keeps missing and ambiguous trades out of exact matches", () => {
  const input = overlappingRuns();
  input.earlier.trades = [structuredClone(input.later.trades[0])];
  input.earlier.availableTrades = input.earlier.totalTrades = 1;
  assert.equal(diagnoseStrategyTradeOverlap(input).counts.identical, 1);
  input.later.trades[0].commission = null;
  const missing = diagnoseStrategyTradeOverlap(input);
  assert.equal(missing.counts.unconfirmed, 1);
  assert.equal(missing.continuity, "unconfirmed");
  assert.equal(missing.continuousAggregationEligible, false);
  input.later.trades.push(structuredClone(input.later.trades[0]));
  input.later.availableTrades = input.later.totalTrades = 2;
  assert.equal(diagnoseStrategyTradeOverlap(input).counts.ambiguous, 1);
  input.later.inputs = [{ id: "in_0", name: "Commission Value", value: 9 }];
  assert.throws(() => diagnoseStrategyTradeOverlap(input), /identical inputs/);
  assert.throws(() => diagnoseStrategyTradeOverlap({ ...overlappingRuns(), to: "2026-01-02T00:00:00Z" }), /outside/);
});

test("trade overlap compares entries while censoring exits after the overlap", () => {
  const input = overlappingRuns();
  const closed = input.later.trades[0];
  input.to = new Date(closed.exit.time).toISOString();
  input.earlier.trades = [{ ...closed, status: "open", exit: null, commission: null, profit: 100 }];
  input.earlier.availableTrades = 1;
  input.earlier.totalTrades = 0;
  const result = diagnoseStrategyTradeOverlap(input);
  assert.equal(result.counts.identical, 1);
  assert.equal(result.firstDifference, null);
  assert.equal(result.boundary.positionsMatch, true);
  assert.equal(result.continuity, "unconfirmed");
  assert.equal(result.continuousAggregationEligible, false);
});

test("a missing label cannot turn a shared trade into a confirmed discontinuity", () => {
  const input = overlappingRuns();
  input.earlier.trades = [structuredClone(input.later.trades[0])];
  input.earlier.availableTrades = input.earlier.totalTrades = 1;
  input.later.trades[0].entry.label = null;
  input.earlier.trades[0].exit.label = null;
  const result = diagnoseStrategyTradeOverlap(input);
  assert.equal(result.counts.earlierOnly + result.counts.laterOnly, 0);
  assert.equal(result.counts.unconfirmed, 1);
  assert.equal(result.firstDifference.kind, "unconfirmed");
  assert.equal(result.boundary.positionsMatch, true);
  assert.equal(result.continuity, "unconfirmed");
});
