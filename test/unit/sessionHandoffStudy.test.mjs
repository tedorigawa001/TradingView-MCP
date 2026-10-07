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
    signalTiming: "window_close",
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
  assert.equal(result.methodologyVersion, "session_exhaustion_handoff_event_study_v2");
  assert.equal(result.byBranch.exhaustion_up.events, 2);
  assert.equal(result.events[0].priorDirection, "up");
  assert.equal(result.events[0].direction, "short");
  assert.ok(result.byBranch.exhaustion_up.horizons["4"].directionalReturn.mean > 0);
  assert.equal(result.conditionContract.ambiguousForwardAndReversalExcluded, true);
  assert.equal(result.conditionContract.decisionTiming, "after_complete_handoff_window");
  assert.equal(result.outcomeContract.reference,
    "handoff_window_final_bar_close_event_study_only_not_assumed_fill");
});

test("session handoff study waits for the complete no-extension window before measuring outcomes", () => {
  const bars = handoffDay(5);
  const result = runSessionExhaustionHandoffStudy(input(bars, {
    minimumEvents: 1, folds: [],
  }));
  assert.equal(result.events[0].signalTime, bars[54].timeIso);
  assert.equal(result.events[0].signalPrice, bars[54].close);
});

test("session handoff study can reference the first reversal after the same complete no-extension window", () => {
  const bars = handoffDay(5);
  const result = runSessionExhaustionHandoffStudy(input(bars, {
    signalTiming: "first_reversal", minimumEvents: 1, folds: [],
  }));
  assert.equal(result.methodologyVersion, "session_exhaustion_handoff_event_study_v3");
  assert.equal(result.events[0].signalTime, bars[52].timeIso);
  assert.equal(result.events[0].signalPrice, bars[52].close);
  assert.equal(result.session.signalTiming, "first_reversal");
  assert.equal(result.conditionContract.decisionTiming, "at_first_reversal_bar_close");
  assert.equal(result.outcomeContract.reference,
    "first_reversal_bar_close_event_study_only_not_assumed_fill");
});

test("first-reversal timing retains a later handoff extension as a tradable outcome", () => {
  const bars = handoffDay(5);
  bars[53] = { ...bars[53], high: bars[31].high + 0.01 };
  const firstReversal = runSessionExhaustionHandoffStudy(input(bars, {
    signalTiming: "first_reversal", minimumEvents: 1, folds: [],
  }));
  const windowClose = runSessionExhaustionHandoffStudy(input(bars, {
    signalTiming: "window_close", minimumEvents: 1, folds: [],
  }));
  assert.equal(firstReversal.sample.events, 1);
  assert.equal(firstReversal.quality.forwardAfterFirstReversal, 1);
  assert.equal(windowClose.sample.events, 0);
  assert.equal(windowClose.quality.ambiguousForwardAndReversal, 1);
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

// BACKLOG 102-17: the windows are read on every local day they span, so moving prices and session clocks together
// through the day, with prior sessions or the handoff crossing midnight, finds the same events.
const clock = (minutes) => {
  const minute = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};
const shifted = (bars, minutes) => bars.map((item) => bar(item.time * 1000 + minutes * 60_000, item.open, item.high, item.low, item.close));
const eventsOf = (result) => [result.sample.events, result.events.map((event) => [event.priorDirection, event.direction, event.priorBars])];

test("moving one-session handoffs through the day, across midnight, finds the same events", () => {
  const base = [...handoffDay(5), ...handoffDay(6), ...handoffDay(7)];
  const run = (minutes) => runSessionExhaustionHandoffStudy(input(shifted(base, minutes), {
    priorSessions: [{ sessionId: "Tokyo", start: clock(0 + minutes), end: clock(480 + minutes) }],
    handoffStart: clock(780 + minutes), handoffEnd: clock(960 + minutes), minimumEvents: 1, folds: [],
  }));
  const unshifted = run(0);
  assert.deepEqual(eventsOf(unshifted), [3, Array(3).fill(["up", "short", 32])]);
  const mean = unshifted.byBranch.exhaustion_up.horizons["4"].directionalReturn.mean;
  for (let minutes = 15; minutes < 1440; minutes += 15) {
    const result = run(minutes);
    assert.deepEqual(eventsOf(result), eventsOf(unshifted), `handoff at ${clock(780 + minutes)}`);
    assert.ok(Math.abs(result.byBranch.exhaustion_up.horizons["4"].directionalReturn.mean - mean) < 1e-12, `handoff at ${clock(780 + minutes)}`);
  }
  // At 23:30 the three-bar handoff window ends on the next day: its third bar is 00:00 there.
  const acrossMidnight = run(630);
  assert.equal(acrossMidnight.events[0].localDate, "2026-01-05");
});

test("moving a two-session range break through the day, with either session or the handoff across midnight, finds the same event", () => {
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
  const run = (minutes) => runSessionExhaustionHandoffStudy(input(shifted(bars, minutes), {
    priorSessions: [
      { sessionId: "Asia", start: clock(1080 + minutes), end: clock(120 + minutes) },
      { sessionId: "London", start: clock(480 + minutes), end: clock(720 + minutes) },
    ],
    handoffStart: clock(780 + minutes), handoffEnd: clock(960 + minutes), priorDirection: "range_break", minimumEvents: 1, folds: [],
  }));
  for (let minutes = 0; minutes < 1440; minutes += 15) {
    assert.deepEqual(eventsOf(run(minutes)), [1, [["up", "short", 48]]], `handoff at ${clock(780 + minutes)}`);
  }
});

test("a handoff day is found from its bars after midnight when none falls before it", () => {
  // Handoffs at 23:45-02:45 with every 23:45 bar missing: each day's window starts at 00:00 on the next day.
  const minutes = 645;
  const base = shifted([...handoffDay(5), ...handoffDay(6), ...handoffDay(7)], minutes)
    .filter((item) => !item.timeIso.endsWith("T23:45:00.000Z"));
  const result = runSessionExhaustionHandoffStudy(input(base, {
    priorSessions: [{ sessionId: "Tokyo", start: clock(minutes), end: clock(480 + minutes) }],
    handoffStart: clock(780 + minutes), handoffEnd: clock(960 + minutes), minimumEvents: 1, folds: [],
  }));
  assert.equal(result.quality.candidateHandoffDays, 3);
  assert.equal(result.quality.insufficientHandoffCoverage, 0);
});

test("a handoff window follows time order where a clock change steps the local date back", () => {
  // America/Goose_Bay fell back at 00:01 on 2009-11-01 to 23:01 on 10-31, so 03:15Z-03:45Z carry the earlier local
  // date. The eight-bar window from 23:00 ADT ends at 03:45Z; stamping the signal at 03:00Z read three later bars.
  const build = (changed = null) => {
    const bars = [];
    const priorStart = Date.UTC(2009, 9, 31, 15);
    for (let index = 0; index < 32; index += 1) {
      const open = 1 + index * 0.006;
      bars.push(bar(priorStart + index * 900_000, open, open + 0.008, open - 0.004, open + 0.006));
    }
    const high = bars.at(-1).high;
    for (let index = 32; index < 44; index += 1) bars.push(bar(priorStart + index * 900_000, 1.19, 1.195, 1.185, 1.19));
    const handoffStart = Date.UTC(2009, 10, 1, 2);
    bars.push(bar(handoffStart, 1.19, high - 0.002, 1.16, 1.17));
    for (let index = 1; index < 24; index += 1) {
      const time = handoffStart + index * 900_000;
      const close = 1.17 - index * 0.002;
      bars.push(new Date(time).toISOString() === changed
        ? bar(time, close, high + 0.05, close - 0.003, close + 0.001)
        : bar(time, close + 0.002, close + 0.003, close - 0.003, close));
    }
    return bars;
  };
  const run = (bars) => runSessionExhaustionHandoffStudy(input(bars, {
    timezone: "America/Goose_Bay", priorSessions: [{ sessionId: "day", start: "12:00", end: "20:00" }],
    handoffStart: "23:00", handoffEnd: "03:00", handoffWindowBars: 8, minimumEvents: 1, folds: [],
  }));
  const result = run(build());
  assert.deepEqual(result.events.map((event) => [event.localDate, event.signalTime]), [["2009-10-31", "2009-11-01T03:45:00.000Z"]]);
  // The signal stands on bars up to its own time only: a later bar leaves it, the signal bar itself decides it.
  assert.equal(run(build("2009-11-01T04:00:00.000Z")).events[0].signalTime, "2009-11-01T03:45:00.000Z");
  assert.equal(run(build("2009-11-01T03:45:00.000Z")).sample.events, 0);
});
