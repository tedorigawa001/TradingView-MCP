import assert from "node:assert/strict";
import test from "node:test";
import { computeSessionProfile } from "../../build/sessionProfile.js";

function bar(time, open, close, volume = 1) {
  return { time: time / 1000, timeIso: new Date(time).toISOString(), open,
    high: Math.max(open, close) + 0.1, low: Math.min(open, close) - 0.1, close, volume };
}

function input(bars, sessions, overrides = {}) {
  return { bars, symbol: "OANDA:EURUSD", timeframe: "60", sessions,
    openingRangeBars: 2, minimumSessionDays: 1, observationLimit: 20, ...overrides };
}

test("session profile honors London daylight saving time", () => {
  const bars = [
    bar(Date.UTC(2026, 2, 27, 8), 100, 101), bar(Date.UTC(2026, 2, 27, 9), 101, 102),
    bar(Date.UTC(2026, 2, 30, 7), 102, 103), bar(Date.UTC(2026, 2, 30, 8), 103, 104),
  ];
  const result = computeSessionProfile(input(bars, [{ sessionId: "london", timezone: "Europe/London",
    start: "08:00", end: "10:00", minimumCoverage: 1 }]));
  assert.equal(result.bySession.london.completeSessionDays, 2);
  assert.equal(result.observations[0].startTime, "2026-03-27T08:00:00.000Z");
  assert.equal(result.observations[1].startTime, "2026-03-30T07:00:00.000Z");
});

test("session profile assigns after-midnight bars to the prior cross-midnight session date", () => {
  const bars = [
    bar(Date.UTC(2026, 0, 5, 22), 100, 101), bar(Date.UTC(2026, 0, 5, 23), 101, 102),
    bar(Date.UTC(2026, 0, 6, 0), 102, 103), bar(Date.UTC(2026, 0, 6, 1), 103, 104),
  ];
  const result = computeSessionProfile(input(bars, [{ sessionId: "overnight", timezone: "UTC",
    start: "22:00", end: "02:00", minimumCoverage: 1 }]));
  assert.equal(result.bySession.overnight.sessionDays, 1);
  assert.equal(result.observations[0].sessionDate, "2026-01-05");
  assert.equal(result.observations[0].bars, 4);
});

test("session profile keeps Saturday bars that belong to a Friday cross-midnight session", () => {
  const bars = [
    bar(Date.UTC(2026, 0, 9, 22), 100, 101), bar(Date.UTC(2026, 0, 9, 23), 101, 102),
    bar(Date.UTC(2026, 0, 10, 0), 102, 103), bar(Date.UTC(2026, 0, 10, 1), 103, 104),
  ];
  const result = computeSessionProfile(input(bars, [{ sessionId: "overnight", timezone: "UTC",
    start: "22:00", end: "02:00", minimumCoverage: 1 }]));
  assert.equal(result.observations[0].sessionDate, "2026-01-09");
  assert.equal(result.observations[0].bars, 4);
  assert.equal(result.observations[0].complete, true);
});

test("session profile excludes forming bars and keeps incomplete coverage explicit", () => {
  const bars = [
    bar(Date.UTC(2026, 0, 5, 8), 100, 101), bar(Date.UTC(2026, 0, 5, 9), 101, 102, null),
    { ...bar(Date.UTC(2026, 0, 5, 10), 102, 103), forming: true },
  ];
  const result = computeSessionProfile(input(bars, [{ sessionId: "day", timezone: "UTC",
    start: "08:00", end: "12:00", minimumCoverage: 0.75 }]));
  assert.equal(result.quality.formingBarsExcluded, 1);
  assert.equal(result.bySession.day.incompleteSessionDays, 1);
  assert.equal(result.observations[0].tickVolume, null);
  assert.ok(result.qualityIssues.includes("one_or_more_sessions_have_incomplete_coverage"));
});

test("session profile compares only to a previously closed session", () => {
  const bars = [
    bar(Date.UTC(2026, 0, 5, 8), 100, 101), bar(Date.UTC(2026, 0, 5, 9), 101, 102),
    bar(Date.UTC(2026, 0, 5, 10), 102, 103), bar(Date.UTC(2026, 0, 5, 11), 103, 104),
  ];
  const result = computeSessionProfile(input(bars, [
    { sessionId: "first", timezone: "UTC", start: "08:00", end: "10:00", minimumCoverage: 1 },
    { sessionId: "second", timezone: "UTC", start: "10:00", end: "12:00", minimumCoverage: 1 },
  ]));
  const second = result.observations.find((row) => row.sessionId === "second");
  assert.equal(second.previousClosedSessionId, "first");
  assert.equal(second.gapFromPreviousClose, 0);
});

test("session profile selects the most recently closed overlapping session", () => {
  const bars = Array.from({ length: 5 }, (_, index) =>
    bar(Date.UTC(2026, 0, 5, 7 + index), 100 + index, 101 + index));
  const result = computeSessionProfile(input(bars, [
    { sessionId: "long", timezone: "UTC", start: "07:00", end: "10:00", minimumCoverage: 1 },
    { sessionId: "short", timezone: "UTC", start: "08:00", end: "09:00", minimumCoverage: 1 },
    { sessionId: "current", timezone: "UTC", start: "11:00", end: "12:00", minimumCoverage: 1 },
  ], { openingRangeBars: 1 }));
  const current = result.observations.find((row) => row.sessionId === "current");
  assert.equal(current.previousClosedSessionId, "long");
});
