import assert from "node:assert/strict";
import test from "node:test";
import { runFailedBreakoutStudy } from "../../build/failedBreakoutStudy.js";

function bar(timeMs, open, high, low, close, forming = false) {
  return { time: timeMs / 1000, timeIso: new Date(timeMs).toISOString(), open, high, low, close, volume: 1, ...(forming ? { forming: true } : {}) };
}

function day(dayOfMonth, kind) {
  const start = Date.UTC(2026, 0, dayOfMonth);
  const bars = Array.from({ length: 32 }, (_, index) => bar(start + index * 900_000, 1.05, 1.1, 1, 1.05));
  if (kind === "up") {
    bars.push(bar(start + 32 * 900_000, 1.05, 1.12, 1.03, 1.06));
    bars.push(bar(start + 33 * 900_000, 1.06, 1.07, 1.02, 1.04));
    for (let index = 34; index < 44; index += 1) {
      const close = 1.04 - (index - 34) * 0.002;
      bars.push(bar(start + index * 900_000, close + 0.002, close + 0.003, close - 0.003, close));
    }
  } else {
    bars.push(bar(start + 32 * 900_000, 1.05, 1.07, 0.98, 1.04));
    bars.push(bar(start + 33 * 900_000, 1.04, 1.08, 1.03, 1.06));
    for (let index = 34; index < 44; index += 1) {
      const close = 1.06 + (index - 34) * 0.002;
      bars.push(bar(start + index * 900_000, close - 0.002, close + 0.003, close - 0.003, close));
    }
  }
  return bars;
}

function input(bars, overrides = {}) {
  return {
    bars, symbol: "OANDA:EURUSD", timeframe: "15", timezone: "UTC",
    rangeStart: "00:00", rangeEnd: "08:00", failureEnd: "10:00", confirmationBars: 1,
    minimumRangeCoverage: 1, horizons: [1, 4], targetReturnBps: 10, minimumEvents: 2,
    folds: [
      { foldId: "up", from: "2026-01-05T00:00:00.000Z", to: "2026-01-06T00:00:00.000Z" },
      { foldId: "down", from: "2026-01-06T00:00:00.000Z", to: "2026-01-07T00:00:00.000Z" },
    ], eventLimit: 20, confidenceLevel: 0.95, configurationTrials: 1, regime: null, ...overrides,
  };
}

test("failed breakout study requires a rejection and fixed directional confirmation", () => {
  const result = runFailedBreakoutStudy(input([...day(5, "up"), ...day(6, "down")]));
  assert.equal(result.status, "complete");
  assert.equal(result.byBranch.failed_breakout_up.events, 1);
  assert.equal(result.byBranch.failed_breakout_down.events, 1);
  assert.equal(result.events.find((event) => event.branch === "failed_breakout_up").direction, "short");
  assert.equal(result.events.find((event) => event.branch === "failed_breakout_down").direction, "long");
  assert.ok(result.byBranch.failed_breakout_up.horizons["4"].directionalReturn.mean > 0);
  assert.ok(result.byBranch.failed_breakout_down.horizons["4"].directionalReturn.mean > 0);
  assert.equal(result.conditionContract.oneEventPerLocalDay, true);
  assert.equal(result.events[0].signalTime, "2026-01-05T08:15:00.000Z");
});

test("failed breakout study excludes two-sided sweeps and unconfirmed rejections", () => {
  const ambiguous = day(5, "up");
  ambiguous[32] = bar(Date.UTC(2026, 0, 5, 8), 1.05, 1.12, 0.98, 1.05);
  const noConfirmation = day(6, "up");
  noConfirmation[33] = bar(Date.UTC(2026, 0, 6, 8, 15), 1.06, 1.08, 1.03, 1.07);
  const result = runFailedBreakoutStudy(input([...ambiguous, ...noConfirmation], { minimumEvents: 1, folds: [] }));
  assert.equal(result.sample.events, 0);
  assert.equal(result.quality.ambiguousBothSides, 1);
  assert.equal(result.quality.failedConfirmation, 1);
  assert.ok(result.qualityIssues.includes("minimum_event_count_not_met"));
});

test("failed breakout study accepts zero confirmation bars without changing rejection direction", () => {
  const result = runFailedBreakoutStudy(input(day(5, "up"), { confirmationBars: 0, minimumEvents: 1, folds: [] }));
  assert.equal(result.events[0].direction, "short");
  assert.equal(result.events[0].signalTime, "2026-01-05T08:00:00.000Z");
});
