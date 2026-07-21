import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStrategyRerunStress, evaluateStrategyStress } from "../../build/strategyStress.js";

const side = (time) => ({ time, timeIso: new Date(time).toISOString(), price: 1, label: null });

function ledger({ profits = [100, -50, 80, -20], commissions = [5, 5, 5, 5], qualityIssues = [] } = {}) {
  const trades = profits.map((profit, index) => {
    const entry = Date.UTC(2025, 0, 2 + index);
    return { reportIndex: index, number: index + 1, direction: "long", status: "closed",
      entry: side(entry), exit: side(entry + 3_600_000), durationMilliseconds: 3_600_000,
      profit, profitPercent: null, cumulativeProfit: null, quantity: 1,
      commission: commissions[index], commissionPercent: null, runUp: null, runUpPercent: null,
      drawDown: null, drawDownPercent: null };
  });
  return { schemaVersion: "1.0", ledgerId: `sha256:${"a".repeat(64)}`, strategy: "Stress",
    symbol: "OANDA:USDJPY", timeframe: "240", studyId: null, pineId: "USER;aaaaaaaaaaaaaaaa",
    pineVersion: "1.0", inputs: [], currency: "JPY", initialCapital: 1_000_000,
    dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-02-01T00:00:00.000Z" },
    summary: {}, totalTrades: trades.length, availableTrades: trades.length, countMatchesSummary: true,
    ordering: "strategy_report", offset: 0, limit: 500, returned: trades.length, nextOffset: null,
    complete: true, unavailableFields: [], qualityIssues, trades };
}

const base = {
  evaluationFrom: "2025-01-01T00:00:00.000Z",
  evaluationTo: "2025-02-01T00:00:00.000Z",
  timeframe: "240",
  minimumTrades: 2,
  scenarios: [
    { scenarioId: "cost-10", kind: "additional_cost_per_trade", value: 10 },
    { scenarioId: "commission-2x", kind: "commission_multiplier", value: 2 },
    { scenarioId: "shift-1", kind: "start_shift_bars", value: 1 },
  ],
  bootstrap: { seed: "fixed-seed", iterations: 200, failureNetProfit: 0 },
};

test("strategy stress returns deterministic scenario degradation and bootstrap distributions", () => {
  const first = evaluateStrategyStress({ ...base, ledger: ledger() });
  const second = evaluateStrategyStress({ ...base, ledger: ledger() });
  assert.equal(first.status, "complete");
  assert.equal(first.baseline.metrics.netProfit, 110);
  assert.equal(first.scenarios[0].metrics.netProfit, 70);
  assert.equal(first.scenarios[1].metrics.netProfit, 90);
  assert.equal(first.distribution.totalScenarios, 3);
  assert.equal(first.distribution.netProfit.worst, 70);
  assert.deepEqual(first.scenarios[2].excluded, first.baseline.excluded);
  assert.deepEqual(first.bootstrap, second.bootstrap);
  assert.equal(first.bootstrap.iterations, 200);
});

test("strategy stress keeps unavailable commission scenarios explicit", () => {
  const result = evaluateStrategyStress({ ...base, ledger: ledger({ commissions: [null, null, null, null] }), bootstrap: null });
  assert.equal(result.status, "partial");
  assert.equal(result.scenarios.find((scenario) => scenario.kind === "commission_multiplier").status, "not_evaluable");
  assert.equal(result.distribution.evaluableScenarios, 2);
});

test("strategy stress fails closed for ledger quality and uncovered windows", () => {
  const badQuality = evaluateStrategyStress({ ...base, ledger: ledger({ qualityIssues: ["report_trade_count_mismatch"] }) });
  assert.equal(badQuality.status, "not_evaluable");
  assert.ok(badQuality.blockers.some((issue) => issue.includes("ledger_quality")));
  const uncovered = evaluateStrategyStress({ ...base, evaluationFrom: "2024-01-01T00:00:00.000Z", ledger: ledger() });
  assert.ok(uncovered.blockers.includes("ledger_date_range_does_not_cover_evaluation"));
});

test("strategy rerun stress compares independently collected ledgers", () => {
  const baseline = ledger();
  const weaker = ledger({ profits: [50, -70, 20, -40] });
  weaker.ledgerId = `sha256:${"b".repeat(64)}`;
  const result = evaluateStrategyRerunStress({
    baselineLedger: baseline,
    evaluationFrom: base.evaluationFrom,
    evaluationTo: base.evaluationTo,
    timeframe: base.timeframe,
    minimumTrades: 2,
    scenarios: [{ scenarioId: "entry-delay-1", ledger: weaker }],
  });
  assert.equal(result.status, "complete");
  assert.equal(result.baseline.metrics.netProfit, 110);
  assert.equal(result.scenarios[0].metrics.netProfit, -40);
  assert.ok(result.scenarios[0].degradation.netProfit < -1);
  assert.equal(result.distribution.failureRate, 1);
});

test("strategy rerun stress preserves collection and ledger failures", () => {
  const poorQuality = ledger({ qualityIssues: ["missing_trade_profit"] });
  poorQuality.ledgerId = `sha256:${"c".repeat(64)}`;
  const result = evaluateStrategyRerunStress({
    baselineLedger: ledger(),
    evaluationFrom: base.evaluationFrom,
    evaluationTo: base.evaluationTo,
    timeframe: base.timeframe,
    minimumTrades: 2,
    scenarios: [
      { scenarioId: "failed-collection", ledger: null, collectionIssue: "strategy_cleanup_failed" },
      { scenarioId: "poor-quality", ledger: poorQuality },
    ],
  });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.scenarios[0].blockers, ["strategy_cleanup_failed"]);
  assert.ok(result.scenarios[1].blockers.some((issue) => issue.includes("ledger_quality")));
  assert.equal(result.distribution.evaluableScenarios, 0);
});

test("strategy rerun stress shares baseline ledger blockers with modeled stress", () => {
  const baselineLedger = ledger({ qualityIssues: ["missing_trade_profit"] });
  const modeled = evaluateStrategyStress({ ...base, ledger: baselineLedger, bootstrap: null });
  const rerun = evaluateStrategyRerunStress({
    baselineLedger,
    evaluationFrom: base.evaluationFrom,
    evaluationTo: base.evaluationTo,
    timeframe: base.timeframe,
    minimumTrades: base.minimumTrades,
    scenarios: [{ scenarioId: "entry-delay-1", ledger: ledger() }],
  });
  assert.equal(modeled.status, "not_evaluable");
  assert.equal(rerun.status, "not_evaluable");
  assert.deepEqual(rerun.blockers, modeled.blockers);
});
