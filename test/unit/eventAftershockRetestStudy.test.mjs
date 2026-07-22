import assert from "node:assert/strict";
import test from "node:test";
import { runEventAftershockRetestStudy } from "../../build/eventAftershockRetestStudy.js";

function bar(timeMs, open, high, low, close, forming = false) {
  return { time: timeMs / 1000, timeIso: new Date(timeMs).toISOString(), open, high, low, close,
    volume: 1, ...(forming ? { forming: true } : {}) };
}

function aftershockBars(retestClosesOutside = true) {
  const start = Date.UTC(2026, 0, 5, 13, 30);
  return [
    bar(start, 1.05, 1.10, 1.00, 1.06),
    bar(start + 900_000, 1.06, 1.09, 1.01, 1.04),
    bar(start + 1_800_000, 1.04, 1.08, 1.02, 1.07),
    bar(start + 2_700_000, 1.07, 1.10, 1.03, 1.08),
    bar(start + 3_600_000, 1.08, 1.14, 1.07, 1.12),
    bar(start + 4_500_000, 1.12, 1.14, retestClosesOutside ? 1.09 : 1.07, retestClosesOutside ? 1.11 : 1.08),
    bar(start + 5_400_000, 1.11, 1.15, 1.10, 1.14),
    bar(start + 6_300_000, 1.14, 1.17, 1.13, 1.16),
    bar(start + 7_200_000, 1.16, 1.19, 1.15, 1.18),
  ];
}

function input(bars, overrides = {}) {
  return {
    bars, symbol: "OANDA:EURUSD", timeframe: "15",
    events: [{ eventId: "us-cpi-2026-01-05", occurredAt: "2026-01-05T13:30:00.000Z" }],
    initialRangeBars: 4, breakoutWithinBars: 1, retestWithinBars: 1, overlapPolicy: "exclude_later_event",
    requireRetestCloseOutside: true, minimumInitialRangeCoverage: 1,
    horizons: [1, 2], targetReturnBps: 10, minimumEvents: 1,
    folds: [], eventLimit: 20, confidenceLevel: 0.95, configurationTrials: 1, regime: null,
    ...overrides,
  };
}

test("event aftershock study evaluates the first confirmed retest in breakout direction", () => {
  const result = runEventAftershockRetestStudy(input(aftershockBars()));
  assert.equal(result.status, "partial"); // One fold is not enough for time stability.
  assert.equal(result.methodologyVersion, "event_aftershock_retest_study_v1");
  assert.equal(result.byBranch.retest_up.events, 1);
  assert.equal(result.events[0].direction, "long");
  assert.equal(result.events[0].signalTime, "2026-01-05T14:45:00.000Z");
  assert.ok(result.byBranch.retest_up.horizons["2"].directionalReturn.mean > 0);
  assert.equal(result.eventContract.eventBar, "closed_bar_starting_exactly_at_occurred_at");
});

test("event aftershock study rejects a first retest that closes back inside the initial range", () => {
  const result = runEventAftershockRetestStudy(input(aftershockBars(false)));
  assert.equal(result.sample.events, 0);
  assert.equal(result.quality.retestClosedInsideRange, 1);
  assert.ok(result.qualityIssues.includes("minimum_event_count_not_met"));
});

test("event aftershock study never shifts an unaligned event timestamp to the next bar", () => {
  const result = runEventAftershockRetestStudy(input(aftershockBars(), {
    events: [{ eventId: "unaligned", occurredAt: "2026-01-05T13:31:00.000Z" }],
  }));
  assert.equal(result.sample.events, 0);
  assert.equal(result.quality.alignedEvents, 0);
  assert.equal(result.quality.insufficientInitialRangeCoverage, 1);
});

test("event aftershock study excludes a later event with an overlapping maximum evaluation window", () => {
  const result = runEventAftershockRetestStudy(input(aftershockBars(), {
    events: [
      { eventId: "first", occurredAt: "2026-01-05T13:30:00.000Z" },
      { eventId: "later", occurredAt: "2026-01-05T13:45:00.000Z" },
    ],
  }));
  assert.equal(result.quality.eventsAfterOverlapPolicy, 1);
  assert.equal(result.quality.overlappingEventsExcluded, 1);
  assert.equal(result.eventContract.overlapPolicy, "exclude_later_event");
  assert.equal(result.eventContract.maximumEvaluationWindowBars, 8);
});

test("event aftershock overlap policy compares each event with the last selected event", () => {
  const result = runEventAftershockRetestStudy(input(aftershockBars(), {
    events: [
      { eventId: "a", occurredAt: "2026-01-05T13:30:00.000Z" },
      { eventId: "b", occurredAt: "2026-01-05T14:30:00.000Z" },
      { eventId: "c", occurredAt: "2026-01-05T15:15:00.000Z" },
    ],
  }));
  // B is excluded, so C must still be compared with selected event A, not B.
  assert.equal(result.quality.eventsAfterOverlapPolicy, 1);
  assert.equal(result.quality.overlappingEventsExcluded, 2);
});

test("event aftershock overlap policy retains events separated by the full maximum window", () => {
  const result = runEventAftershockRetestStudy(input(aftershockBars(), {
    events: [
      { eventId: "first", occurredAt: "2026-01-05T13:30:00.000Z" },
      { eventId: "separate", occurredAt: "2026-01-05T15:30:00.000Z" },
    ],
  }));
  assert.equal(result.quality.eventsAfterOverlapPolicy, 2);
  assert.equal(result.quality.overlappingEventsExcluded, 0);
});
