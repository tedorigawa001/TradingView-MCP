import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStrategyByRegime } from "../../build/strategyRegimeEvaluation.js";

const start = Date.UTC(2026, 0, 1);

function observation(index, directionalRegime, volatilityRegime) {
  return { time: (start + index * 3_600_000) / 1000,
    timeIso: new Date(start + index * 3_600_000).toISOString(), close: 100,
    directionalRegime, volatilityRegime, efficiencyRatio: 0.5, directionalMoveAtr: 2,
    atrPercent: 0.01, volatilityRatio: 1 };
}

function trade(index, profit, entryOffset = 0) {
  const entryTime = start + index * 3_600_000 + entryOffset;
  return { reportIndex: index, number: index, direction: "long", status: "closed",
    entry: { time: entryTime, timeIso: new Date(entryTime).toISOString(), price: 100, label: null },
    exit: { time: entryTime + 3_600_000, timeIso: new Date(entryTime + 3_600_000).toISOString(),
      price: 100, label: null }, durationMilliseconds: 3_600_000, profit, profitPercent: null,
    cumulativeProfit: null, quantity: 1, commission: 0.1, commissionPercent: null,
    runUp: Math.max(profit, 0) + 1, runUpPercent: null, drawDown: Math.max(-profit, 0) + 1,
    drawDownPercent: null };
}

function ledger(trades, overrides = {}) {
  return { schemaVersion: "1.0", ledgerId: `sha256:${"a".repeat(64)}`, strategy: "Test Strategy",
    symbol: "OANDA:EURUSD", timeframe: "60", studyId: "test", pineId: "USER;test12345",
    pineVersion: "1.0", inputs: [], currency: "USD", initialCapital: 100000,
    dateRange: null, summary: { totalTrades: trades.length }, totalTrades: trades.length,
    availableTrades: trades.length, countMatchesSummary: true, ordering: "strategy_report",
    offset: 0, limit: 500, returned: trades.length, nextOffset: null, complete: true,
    unavailableFields: [], qualityIssues: [], trades, ...overrides };
}

function evaluate(trades, observations, overrides = {}) {
  return evaluateStrategyByRegime({ ledger: ledger(trades), observations, timeframe: "60",
    minimumGroupTrades: 2, minimumCoverageRatio: 0.75, maxRegimeAgeBars: 1, ...overrides });
}

test("strategy regime evaluation computes PF and expectancy per entry regime", () => {
  const observations = [
    observation(0, "trend_up", "normal"), observation(1, "trend_up", "normal"),
    observation(2, "range", "low"), observation(3, "range", "low"),
  ];
  const result = evaluate([trade(4, -1), trade(1, 4), trade(3, 3), trade(2, -2)], observations);
  assert.equal(result.status, "complete");
  assert.equal(result.coverage.joinedTrades, 4);
  assert.equal(result.overall.profitFactor, 7 / 3);
  assert.equal(result.overall.maxClosedTradeEquityDrawdown, 2);
  assert.equal(result.byDirectionalRegime.trend_up.profitFactor, 2);
  assert.equal(result.byDirectionalRegime.range.profitFactor, 3);
  assert.equal(result.byCombinedRegime["range:low"].minimumTradesMet, true);
});

test("strategy regime join never uses the still-open entry bar", () => {
  const observations = [observation(0, "range", "low"), observation(1, "trend_up", "high")];
  const atSecondBarOpen = trade(1, 2);
  const afterSecondBarClose = trade(2, 3);
  const result = evaluate([atSecondBarOpen, afterSecondBarClose], observations, { minimumCoverageRatio: 1 });
  assert.equal(result.byDirectionalRegime.range.trades, 1);
  assert.equal(result.byDirectionalRegime.trend_up.trades, 1);
});

test("strategy regime evaluation reports stale evidence and incomplete ledgers", () => {
  const observations = [observation(0, "range", "normal")];
  const stale = trade(5, 2);
  const partial = evaluateStrategyByRegime({
    ledger: ledger([stale], { complete: false }), observations, timeframe: "60",
    minimumGroupTrades: 1, minimumCoverageRatio: 1, maxRegimeAgeBars: 1,
  });
  assert.equal(partial.status, "blocked");
  assert.equal(partial.coverage.excluded.staleRegimeEvidence, 1);
  assert.ok(partial.qualityIssues.includes("strategy_ledger_incomplete"));
  assert.ok(partial.qualityIssues.includes("no_trades_joined_to_regimes"));
});

test("strategy regime evaluation groups entry times into non-exclusive DST-aware sessions", () => {
  const observations = Array.from({ length: 24 }, (_, index) => observation(index, "range", "normal"));
  const londonOpen = trade(8, 4);
  const londonNewYorkOverlap = trade(13, -2);
  const outside = trade(22, 3);
  const result = evaluate([londonOpen, londonNewYorkOverlap, outside], observations, {
    minimumGroupTrades: 1,
    minimumCoverageRatio: 1,
    sessions: [
      { sessionId: "london", timezone: "Europe/London", start: "08:00", end: "16:00" },
      { sessionId: "new_york", timezone: "America/New_York", start: "08:00", end: "17:00" },
    ],
  });
  assert.equal(result.joinContract.sessionMatchPolicy, "all_matches_non_exclusive");
  assert.equal(result.bySession.london.trades, 2);
  assert.equal(result.bySession.new_york.trades, 1);
  assert.equal(result.bySession.outside_defined_sessions.trades, 1);
  assert.equal(result.bySession.london.netProfit, 2);
});
