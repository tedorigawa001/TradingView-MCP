import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStrategyByRegime } from "../../build/strategyRegimeEvaluation.js";
import { computeCorrelationRegimes } from "../../build/correlationRegimes.js";

const HOUR = 3_600_000;

function createBars(start, ohlcList) {
  return ohlcList.map(([open, high, low, close], index) => {
    const time = (start + index * HOUR) / 1000;
    return {
      time,
      timeIso: new Date(time * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 1000,
      forming: false,
    };
  });
}

test("strategyRegimeEvaluation evaluates multi-reference correlation regime matrix with confirm:true flow", async () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);

  // Generate 15 bars
  const primaryCloses = [100, 101, 102, 103, 104, 106, 108, 110, 112, 115, 118, 120, 122, 125, 128];
  const primaryBars = createBars(start, primaryCloses.map((c) => [c, c + 0.5, c - 0.5, c]));

  const refCloses = [100, 99, 98, 97, 96, 94, 92, 90, 88, 85, 82, 80, 78, 75, 72];
  const refBars = createBars(start, refCloses.map((c) => [c, c + 0.5, c - 0.5, c]));

  // 1. Compute multi-reference correlation regimes
  const corrRes = computeCorrelationRegimes({
    primaryBars,
    referenceBars: refBars,
    primarySymbol: "OANDA:EURUSD",
    referenceSymbol: "TVC:DXY",
    timeframe: "60",
    window: 3,
    strongThreshold: 0.7,
    neutralThreshold: 0.3,
  });

  assert.equal(corrRes.alignmentPolicy, "exact_utc_timestamp_no_forward_fill");
  assert.ok(corrRes.observations.length > 0);
  assert.equal(corrRes.observations.at(-1).regime, "strong_negative");

  // Mock strategy ledger with entries at bar 6 and bar 10
  const ledger = {
    schemaVersion: "1.0",
    ledgerId: `sha256:${"a".repeat(64)}`,
    strategy: "Test Strategy MultiRef",
    currency: "USD",
    initialCapital: 100000,
    dateRange: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
    summary: { netProfit: 500, totalTrades: 2 },
    totalTrades: 2,
    availableTrades: 2,
    countMatchesSummary: true,
    ordering: "strategy_report",
    offset: 0,
    limit: 10,
    returned: 2,
    nextOffset: null,
    complete: true,
    unavailableFields: [],
    qualityIssues: [],
    trades: [
      {
        number: 1,
        direction: "long",
        status: "closed",
        entry: { time: primaryBars[6].time * 1000, price: 108 },
        exit: { time: primaryBars[8].time * 1000, price: 112 },
        profit: 400,
        runUp: 500,
        drawDown: 50,
        commission: 2,
        reportIndex: 0,
      },
      {
        number: 2,
        direction: "short",
        status: "closed",
        entry: { time: primaryBars[10].time * 1000, price: 118 },
        exit: { time: primaryBars[12].time * 1000, price: 122 },
        profit: 100,
        runUp: 200,
        drawDown: 30,
        commission: 2,
        reportIndex: 1,
      },
    ],
  };

  // Mock classified market regimes
  const marketRegimeObs = primaryBars.slice(3).map((bar) => ({
    time: bar.time,
    directionalRegime: "trend_up",
    volatilityRegime: "normal",
    trendEfficiencyRatio: 0.8,
    volatilityRatio: 1.0,
  }));

  // 2. Evaluate strategy regime matrix joined with multi-reference correlation regime
  const evalRes = evaluateStrategyByRegime({
    ledger,
    observations: marketRegimeObs,
    timeframe: "60",
    minimumGroupTrades: 1,
    minimumCoverageRatio: 0.5,
    maxRegimeAgeBars: 4,
    correlationRegime: {
      referenceSymbol: "TVC:DXY",
      observations: corrRes.observations,
      maximumAgeBars: 4,
      window: 3,
      strongThreshold: 0.7,
      neutralThreshold: 0.3,
    },
  });

  assert.equal(evalRes.status, "complete");
  assert.ok(evalRes.byCorrelationRegime !== null);
  assert.ok(evalRes.byCorrelationRegime["strong_negative"]);
  assert.equal(evalRes.byCorrelationRegime["strong_negative"].trades, 2);
});
