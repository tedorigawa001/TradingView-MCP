import test from "node:test";
import assert from "node:assert/strict";
import {
  assessStrategyWalkForwardCandidate,
  runStrategyWalkForwardFalsificationAudit,
} from "../../build/strategyWalkForwardFalsificationAudit.js";
import { evaluateStrategyWalkForward } from "../../build/strategyWalkForward.js";

const side = (time) => ({ time, timeIso: new Date(time).toISOString(), price: 1, label: null });

function ledger(id, profitsByYear) {
  const trades = Object.entries(profitsByYear).flatMap(([year, profits]) => profits.map((profit, index) => {
    const entry = Date.UTC(Number(year), 1, 1 + index);
    return {
      reportIndex: Number(year) * 100 + index, number: null, direction: "long", status: "closed",
      entry: side(entry), exit: side(entry + 3_600_000), durationMilliseconds: 3_600_000,
      profit, profitPercent: null, cumulativeProfit: null, quantity: 1, commission: 0,
      commissionPercent: null, runUp: null, runUpPercent: null, drawDown: null, drawDownPercent: null,
    };
  }));
  return {
    schemaVersion: "1.0", ledgerId: `sha256:${id.repeat(64)}`, strategy: id,
    symbol: "OANDA:USDJPY", timeframe: "240", studyId: null, pineId: `USER;${id.repeat(16)}`,
    pineVersion: "1.0", inputs: [], currency: "JPY", initialCapital: 1000000,
    dateRange: { from: "2020-01-01T00:00:00.000Z", to: "2025-01-01T00:00:00.000Z" },
    summary: {}, totalTrades: trades.length, availableTrades: trades.length, countMatchesSummary: true,
    ordering: "strategy_report", offset: 0, limit: trades.length, returned: trades.length, nextOffset: null,
    complete: true, unavailableFields: [], qualityIssues: [], trades,
  };
}

const folds = [
  { foldId: "f1", trainFrom: "2020-01-01T00:00:00.000Z", trainTo: "2021-12-31T00:00:00.000Z", testFrom: "2022-01-01T00:00:00.000Z", testTo: "2022-12-31T00:00:00.000Z" },
  { foldId: "f2", trainFrom: "2020-01-01T00:00:00.000Z", trainTo: "2022-12-31T00:00:00.000Z", testFrom: "2023-01-01T00:00:00.000Z", testTo: "2023-12-31T00:00:00.000Z" },
];

function input(overrides = {}) {
  return {
    candidates: [
      { candidateId: "steady", ledger: ledger("a", { 2020: [2, -1], 2021: [3, -1], 2022: [4, -1], 2023: [5, -1] }) },
      { candidateId: "late", ledger: ledger("b", { 2020: [1, -2], 2021: [1, -2], 2022: [100, -1], 2023: [100, -1] }) },
    ],
    folds, mode: "anchored", timeframe: "240", embargoBars: 1,
    minimumTrainTrades: 2, minimumTestTrades: 2, selectionMetric: "expectancy",
    replications: 40, firstSeed: 17, blockLengthCalendarDays: 5, nominalAlpha: 0.05,
    ...overrides,
  };
}

test("strategy walk-forward falsification audit is deterministic and preserves failures separately", () => {
  const first = runStrategyWalkForwardFalsificationAudit(input());
  const second = runStrategyWalkForwardFalsificationAudit(input());
  assert.deepEqual(first, second);
  assert.equal(first.methodologyVersion, "strategy_walk_forward_falsification_audit_v3");
  assert.equal(first.status, "complete");
  assert.equal(first.completed, 40);
  assert.equal(first.evaluated + first.notEvaluableSeeds.length, 40);
  assert.equal(first.failed.length, 0);
  assert.equal("observedRate" in first, false);
  assert.equal("exceedsNominalAlpha" in first, false);
  assert.deepEqual(first.leaveOneOutTailCalibration, {
    status: "not_measurable_structural_rank_uniformity",
    nominalTailSlots: Math.floor(first.nominalAlpha * first.evaluated),
    reason: "leave_one_out_rank_p_values_make_p_at_most_nominal_alpha_a_fixed_tail_count",
  });
  assert.ok(first.candidates <= Math.floor(first.nominalAlpha * first.evaluated),
    "leave-one-out empirical p-values must not admit more than the nominal upper tail");
  assert.match(first.nullModel, /shared_calendar_block/);
});

test("strategy walk-forward falsification audit excludes partial draws instead of treating them as rejections", () => {
  const result = runStrategyWalkForwardFalsificationAudit(input({ minimumTestTrades: 3 }));
  assert.equal(result.evaluated, 0);
  assert.equal(result.notEvaluableSeeds.length, 40);
  assert.equal(result.leaveOneOutTailCalibration.nominalTailSlots, null);
  assert.equal(result.candidates, 0);
});

test("strategy walk-forward candidate rule requires complete OOS evidence, profitable aggregate, and empirical p", () => {
  const evaluation = evaluateStrategyWalkForward({
    ...input(),
    candidates: [
      { candidateId: "one", ledger: ledger("c", { 2020: [2, -1], 2021: [3, -1], 2022: [4, -1], 2023: [5, -1] }) },
      { candidateId: "two", ledger: ledger("d", { 2020: [1, -2], 2021: [1, -2], 2022: [1, -2], 2023: [1, -2] }) },
    ],
  });
  assert.equal(assessStrategyWalkForwardCandidate(evaluation, 0.05, 0.05).outcome, "candidate");
  assert.equal(assessStrategyWalkForwardCandidate(evaluation, 0.051, 0.05).outcome, "non_candidate");
  assert.equal(assessStrategyWalkForwardCandidate({ ...evaluation, status: "partial" }, null, 0.05).outcome,
    "not_evaluable");
});
