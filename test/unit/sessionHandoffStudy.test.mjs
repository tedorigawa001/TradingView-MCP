import assert from "node:assert/strict";
import test from "node:test";
import { runSessionExhaustionHandoffStudy } from "../../build/sessionHandoffStudy.js";

function bar(timeMs, open, high, low, close, forming = false) {
  return { time: timeMs / 1000, timeIso: new Date(timeMs).toISOString(), open, high, low, close,
    volume: 1, ...(forming ? { forming: true } : {}) };
}

function handoffDay(day, mode = "exhaustion") {
  const start = Date.UTC(2026, 0, day);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    const open = 1 + index * 0.006;
    bars.push(bar(start + index * 900_000, open, open + 0.008, open - 0.004, open + 0.006));
  }
  const high = bars.at(-1).high;
  for (let index = 32; index < 52; index += 1) bars.push(bar(start + index * 900_000, 1.19, 1.195, 1.185, 1.19));
  if (mode === "exhaustion") {
    bars.push(bar(start + 52 * 900_000, 1.19, high - 0.002, 1.16, 1.17));
  } else if (mode === "ambiguous") {
    bars.push(bar(start + 52 * 900_000, 1.19, high + 0.01, 1.16, 1.17));
  } else {
    bars.push(bar(start + 52 * 900_000, 1.19, high + 0.01, 1.18, 1.20));
  }
  for (let index = 53; index < 64; index += 1) {
    const close = 1.17 - (index - 52) * 0.002;
    bars.push(bar(start + index * 900_000, close + 0.002, close + 0.003, close - 0.003, close));
  }
  return bars;
}

function input(bars, overrides = {}) {
  return {
    bars, symbol: "OANDA:EURUSD", timeframe: "15", timezone: "UTC",
    priorSessions: [{ sessionId: "Tokyo", start: "00:00", end: "08:00" }],
    handoffStart: "13:00", handoffEnd: "16:00", priorDirection: "session_return",
    directionMinimumReturnBps: 1, closeLocationThreshold: 0.75, handoffWindowBars: 3,
    forwardUpdateThresholdBps: 0, requireRangeReentry: true, requireOppositeBody: true,
    minimumPriorCoverage: 1, horizons: [1, 4], targetReturnBps: 10, minimumEvents: 2,
    folds: [
      { foldId: "d1", from: "2026-01-05T00:00:00.000Z", to: "2026-01-06T00:00:00.000Z" },
      { foldId: "d2", from: "2026-01-06T00:00:00.000Z", to: "2026-01-07T00:00:00.000Z" },
    ],
    eventLimit: 20, confidenceLevel: 0.95, configurationTrials: 2, regime: null, ...overrides,
  };
}

test("session handoff study uses only prior closed sessions and studies the reversal direction", () => {
  const result = runSessionExhaustionHandoffStudy(input([...handoffDay(5), ...handoffDay(6)]));
  assert.equal(result.status, "complete");
  assert.equal(result.methodologyVersion, "session_exhaustion_handoff_event_study_v1");
  assert.equal(result.byBranch.exhaustion_up.events, 2);
  assert.equal(result.events[0].priorDirection, "up");
  assert.equal(result.events[0].direction, "short");
  assert.ok(result.byBranch.exhaustion_up.horizons["4"].directionalReturn.mean > 0);
  assert.equal(result.conditionContract.ambiguousForwardAndReversalExcluded, true);
});

test("session handoff study excludes an early window that both extends and reverses", () => {
  const result = runSessionExhaustionHandoffStudy(input(handoffDay(5, "ambiguous"), {
    minimumEvents: 1, folds: [],
  }));
  assert.equal(result.sample.events, 0);
  assert.equal(result.quality.ambiguousForwardAndReversal, 1);
  assert.ok(result.qualityIssues.includes("minimum_event_count_not_met"));
});

test("session handoff study classifies local session clocks through London daylight saving time", () => {
  const utcStart = Date.UTC(2026, 2, 29, 23);
  const sourceStart = Date.UTC(2026, 0, 5);
  const bars = handoffDay(5).map((item) => {
    const time = item.time * 1000 - sourceStart + utcStart;
    return { ...item, time: time / 1000, timeIso: new Date(time).toISOString() };
  });
  const result = runSessionExhaustionHandoffStudy(input(bars, {
    timezone: "Europe/London", minimumEvents: 1, folds: [],
  }));
  assert.equal(result.sample.events, 1);
  assert.equal(result.events[0].localDate, "2026-03-30");
});

test("session handoff study supports a cross-midnight prior session anchored to handoff day", () => {
  const start = Date.UTC(2026, 0, 4, 18);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    const open = 1 + index * 0.006;
    bars.push(bar(start + index * 900_000, open, open + 0.008, open - 0.004, open + 0.006));
  }
  const high = bars.at(-1).high;
  for (let index = 0; index < 3; index += 1) {
    const time = Date.UTC(2026, 0, 5, 2) + index * 900_000;
    bars.push(bar(time, 1.19, high - 0.002, 1.16, 1.17 - index * 0.002));
  }
  const result = runSessionExhaustionHandoffStudy(input(bars, {
    priorSessions: [{ sessionId: "overnight", start: "18:00", end: "02:00" }],
    handoffStart: "02:00", handoffEnd: "04:00", minimumEvents: 1, folds: [],
  }));
  assert.equal(result.sample.events, 1);
  assert.equal(result.events[0].localDate, "2026-01-05");
});

test("session handoff study joins a prior-day Asia session with same-day London range break", () => {
  const asiaStart = Date.UTC(2026, 0, 4, 18);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    const close = 1.04 + (index % 3) * 0.002;
    bars.push(bar(asiaStart + index * 900_000, close - 0.001, 1.06, 1.03, close));
  }
  const londonStart = Date.UTC(2026, 0, 5, 8);
  for (let index = 0; index < 16; index += 1) {
    const open = 1.07 + index * 0.01;
    bars.push(bar(londonStart + index * 900_000, open, open + 0.004, open - 0.002, open + 0.003));
  }
  const londonHigh = bars.at(-1).high;
  const handoffStart = Date.UTC(2026, 0, 5, 13);
  bars.push(bar(handoffStart, 1.22, londonHigh - 0.002, 1.16, 1.17));
  for (let index = 1; index < 5; index += 1) {
    const close = 1.17 - index * 0.002;
    bars.push(bar(handoffStart + index * 900_000, close + 0.002, close + 0.003, close - 0.003, close));
  }
  const result = runSessionExhaustionHandoffStudy(input(bars, {
    priorSessions: [
      { sessionId: "Asia", start: "18:00", end: "02:00" },
      { sessionId: "London", start: "08:00", end: "12:00" },
    ],
    handoffStart: "13:00", handoffEnd: "16:00", priorDirection: "range_break",
    minimumEvents: 1, folds: [],
  }));
  assert.equal(result.sample.events, 1);
  assert.equal(result.events[0].priorDirection, "up");
  assert.equal(result.events[0].direction, "short");
  assert.equal(result.events[0].priorBars, 48);
});

test("session handoff study rejects range_break without a reference session", () => {
  assert.throws(() => runSessionExhaustionHandoffStudy(input(handoffDay(5), {
    priorDirection: "range_break", minimumEvents: 1, folds: [],
  })), /range_break prior direction requires at least two prior sessions/);
});
