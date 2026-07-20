import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStrategyWalkForward } from "../../build/strategyWalkForward.js";

const side = (time) => ({ time, timeIso: new Date(time).toISOString(), price: 1, label: null });

function ledger(letter, profitsByYear, qualityIssues = []) {
  const trades = Object.entries(profitsByYear).flatMap(([year, profits]) => profits.map((profit, index) => {
    const entry = Date.UTC(Number(year), 1, 1 + index, 0, 0);
    return {
      reportIndex: Number(year) * 100 + index,
      number: null,
      direction: "long",
      status: "closed",
      entry: side(entry),
      exit: side(entry + 3_600_000),
      durationMilliseconds: 3_600_000,
      profit,
      profitPercent: null,
      cumulativeProfit: null,
      quantity: 1,
      commission: 0,
      commissionPercent: null,
      runUp: Math.max(profit, 0) + 1,
      runUpPercent: null,
      drawDown: Math.max(-profit, 0) + 1,
      drawDownPercent: null,
    };
  }));
  return {
    schemaVersion: "1.0",
    ledgerId: `sha256:${letter.repeat(64)}`,
    strategy: letter,
    symbol: "OANDA:USDJPY",
    timeframe: "240",
    studyId: null,
    pineId: `USER;${letter.repeat(16)}`,
    pineVersion: "1.0",
    inputs: [],
    currency: "JPY",
    initialCapital: 1000000,
    dateRange: { from: "2020-01-01T00:00:00.000Z", to: "2025-01-01T00:00:00.000Z" },
    summary: {},
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
    qualityIssues,
    trades,
  };
}

const folds = [
  {
    foldId: "f1",
    trainFrom: "2020-01-01T00:00:00.000Z",
    trainTo: "2021-12-31T00:00:00.000Z",
    testFrom: "2022-01-01T00:00:00.000Z",
    testTo: "2022-12-31T00:00:00.000Z",
  },
  {
    foldId: "f2",
    trainFrom: "2020-01-01T00:00:00.000Z",
    trainTo: "2022-12-31T00:00:00.000Z",
    testFrom: "2023-01-01T00:00:00.000Z",
    testTo: "2023-12-31T00:00:00.000Z",
  },
];

test("strategy walk-forward selects on train and exposes test only for the selected candidate", () => {
  const result = evaluateStrategyWalkForward({
    candidates: [
      { candidateId: "steady", ledger: ledger("a", { 2020: [2, -1], 2021: [3, -1], 2022: [4, -1], 2023: [5, -1] }) },
      { candidateId: "late", ledger: ledger("b", { 2020: [1, -2], 2021: [1, -2], 2022: [100, -1], 2023: [100, -1] }) },
    ],
    folds,
    mode: "anchored",
    timeframe: "240",
    embargoBars: 1,
    minimumTrainTrades: 2,
    minimumTestTrades: 2,
    selectionMetric: "expectancy",
  });
  assert.equal(result.status, "complete");
  assert.equal(result.folds[0].selection.candidateId, "steady");
  assert.equal(result.folds[0].test.candidateId, "steady");
  assert.equal(result.folds[0].test.evidence.metrics.expectancy, 1.5);
  assert.ok(!("includedReportIndexes" in result.folds[0].test.evidence),
    "per-trade indexes must not amplify the MCP response");
  assert.ok(!("candidates" in result.folds[0].test), "unselected OOS metrics must not be returned");
  assert.equal(result.folds[1].selection.candidateId, "late");
  assert.equal(result.oosAggregate.evaluableFolds, 2);
  assert.equal(result.oosAggregate.metrics.totalTrades, 4);
});

test("strategy walk-forward rejects weak embargo, inconsistent mode, and selection ties", () => {
  const candidates = [
    { candidateId: "one", ledger: ledger("c", { 2020: [1, -1], 2021: [1, -1], 2022: [1, -1], 2023: [1, -1] }) },
    { candidateId: "two", ledger: ledger("d", { 2020: [1, -1], 2021: [1, -1], 2022: [1, -1], 2023: [1, -1] }) },
  ];
  const tied = evaluateStrategyWalkForward({
    candidates, folds, mode: "anchored", timeframe: "240", embargoBars: 1,
    minimumTrainTrades: 2, minimumTestTrades: 2, selectionMetric: "netProfit",
  });
  assert.equal(tied.status, "partial");
  assert.equal(tied.folds[0].selection.status, "selection_tie");
  assert.equal(tied.folds[0].test, null);

  assert.throws(() => evaluateStrategyWalkForward({
    candidates,
    folds: [{ ...folds[0], testFrom: "2021-12-31T01:00:00.000Z" }, folds[1]],
    mode: "anchored", timeframe: "240", embargoBars: 1,
    minimumTrainTrades: 2, minimumTestTrades: 2, selectionMetric: "expectancy",
  }), /embargo bars/);
  assert.throws(() => evaluateStrategyWalkForward({
    candidates,
    folds: [folds[0], { ...folds[1], trainFrom: "2020-02-01T00:00:00.000Z" }],
    mode: "anchored", timeframe: "240", embargoBars: 1,
    minimumTrainTrades: 2, minimumTestTrades: 2, selectionMetric: "expectancy",
  }), /anchored folds/);
});

test("strategy walk-forward fails closed for ledger quality and uncovered windows", () => {
  const result = evaluateStrategyWalkForward({
    candidates: [
      { candidateId: "bad", ledger: ledger("e", { 2020: [1, -1] }, ["report_trade_count_mismatch"]) },
      { candidateId: "short", ledger: { ...ledger("f", { 2020: [1, -1] }),
        dateRange: { from: "2021-01-01T00:00:00.000Z", to: "2025-01-01T00:00:00.000Z" } } },
    ],
    folds,
    mode: "anchored",
    timeframe: "240",
    embargoBars: 1,
    minimumTrainTrades: 2,
    minimumTestTrades: 2,
    selectionMetric: "profitFactor",
  });
  assert.equal(result.status, "not_evaluable");
  assert.ok(result.blockers.some((issue) => issue.includes("ledger_quality_issues")));
  assert.ok(result.blockers.some((issue) => issue.includes("date_range_does_not_cover")));
});
