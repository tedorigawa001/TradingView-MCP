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

test("strategy regime evaluation assigns overlaps to the first matching session when exclusive", () => {
  const observations = Array.from({ length: 24 }, (_, index) => observation(index, "range", "normal"));
  const londonOpen = trade(8, 4);
  const londonNewYorkOverlap = trade(13, -2);
  const outside = trade(22, 3);
  const sessions = [
    { sessionId: "london", timezone: "Europe/London", start: "08:00", end: "16:00" },
    { sessionId: "new_york", timezone: "America/New_York", start: "08:00", end: "17:00" },
  ];
  const result = evaluate([londonOpen, londonNewYorkOverlap, outside], observations, {
    minimumGroupTrades: 1,
    minimumCoverageRatio: 1,
    sessions,
    sessionMatchPolicy: "first_match_exclusive",
  });
  assert.equal(result.joinContract.sessionMatchPolicy, "first_match_exclusive");
  assert.deepEqual(result.joinContract.sessionPriority, ["london", "new_york"]);
  assert.equal(result.bySession.london.trades, 2);
  assert.equal(result.bySession.new_york.trades, 0);
  assert.equal(result.bySession.outside_defined_sessions.trades, 1);
  assert.equal(Object.values(result.bySession).reduce((sum, group) => sum + group.trades, 0), 3);
});

test("strategy regime evaluation rejects a session policy without sessions", () => {
  assert.throws(() => evaluate([trade(1, 1)], [observation(0, "range", "normal")], {
    sessionMatchPolicy: "first_match_exclusive",
  }), /requires session definitions/);
});

test("strategy regime evaluation groups entries by caller-supplied scheduled event proximity", () => {
  const observations = Array.from({ length: 10 }, (_, index) => observation(index, "range", "normal"));
  const result = evaluate([trade(2, 3), trade(4, -2), trade(6, 1), trade(8, 2)], observations, {
    minimumGroupTrades: 1,
    minimumCoverageRatio: 1,
    eventProximity: {
      events: [
        { eventId: "us-cpi", occurredAt: "2026-01-01T02:00:00.000Z" },
        { eventId: "fed", occurredAt: "2026-01-01T06:00:00.000Z" },
      ],
      coverageFrom: "2026-01-01T01:30:00.000Z",
      coverageTo: "2026-01-01T07:00:00.000Z",
      beforeMinutes: 30,
      afterMinutes: 60,
    },
  });
  assert.equal(result.joinContract.eventProximity.interval, "[event_time - before_minutes, event_time + after_minutes)");
  assert.equal(result.byEventProximity.near_scheduled_event.trades, 2);
  assert.equal(result.byEventProximity.outside_scheduled_event_window.trades, 1);
  assert.equal(result.byEventProximity.outside_event_calendar_coverage.trades, 1);
});

test("strategy regime evaluation rejects duplicate scheduled event timestamps", () => {
  assert.throws(() => evaluate([trade(2, 1)], [observation(0, "range", "normal")], {
    eventProximity: {
      events: [
        { eventId: "first", occurredAt: "2026-01-01T02:00:00.000Z" },
        { eventId: "second", occurredAt: "2026-01-01T02:00:00.000Z" },
      ],
      coverageFrom: "2026-01-01T01:30:00.000Z",
      coverageTo: "2026-01-01T03:00:00.000Z",
      beforeMinutes: 30,
      afterMinutes: 30,
    },
  }), /timestamps must be unique/);
});

test("strategy regime evaluation joins only prior fresh correlation observations", () => {
  const observations = Array.from({ length: 6 }, (_, index) => observation(index, "range", "normal"));
  const result = evaluate([trade(2, 3), trade(3, -2), trade(5, 1)], observations, {
    minimumGroupTrades: 1,
    minimumCoverageRatio: 0.75,
    correlationRegime: {
      referenceSymbol: "TVC:DXY",
      observations: [
        { time: observation(1, "range", "normal").time, timeIso: observation(1, "range", "normal").timeIso,
          correlation: -0.8, regime: "strong_negative" },
        { time: observation(2, "range", "normal").time, timeIso: observation(2, "range", "normal").timeIso,
          correlation: -0.4, regime: "negative" },
      ],
      maximumAgeBars: 1,
      window: 20,
      strongThreshold: 0.7,
      neutralThreshold: 0.2,
    },
  });
  assert.equal(result.joinContract.correlationRegime.referenceSymbol, "TVC:DXY");
  assert.equal(result.coverage.correlationJoinedTrades, 2);
  assert.equal(result.coverage.correlationCoverageRatio, 2 / 3);
  assert.equal(result.byCorrelationRegime.strong_negative.trades, 1);
  assert.equal(result.byCorrelationRegime.negative.trades, 1);
  assert.equal(result.byCorrelationRegime.outside_correlation_evidence.trades, 1);
  assert.ok(result.qualityIssues.includes("minimum_correlation_join_coverage_not_met"));
  assert.equal(result.status, "partial");
});
