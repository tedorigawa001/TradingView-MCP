import assert from "node:assert/strict";
import test from "node:test";
import { runSessionAuctionStudy } from "../../build/sessionAuctionStudy.js";

function bar(timeMs, open, high, low, close, forming = false) {
  return { time: timeMs / 1000, timeIso: new Date(timeMs).toISOString(), open, high, low, close,
    volume: 1, ...(forming ? { forming: true } : {}) };
}

function utcDay(day, branch) {
  const start = Date.UTC(2026, 0, day);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    bars.push(bar(start + index * 900_000, 1.05, 1.1, 1, 1.05));
  }
  if (branch === "accepted_up") {
    bars.push(bar(start + 32 * 900_000, 1.05, 1.12, 1.04, 1.11));
    bars.push(bar(start + 33 * 900_000, 1.11, 1.13, 1.1, 1.12));
  } else if (branch === "failed_up") {
    bars.push(bar(start + 32 * 900_000, 1.05, 1.12, 1.04, 1.06));
    bars.push(bar(start + 33 * 900_000, 1.06, 1.08, 1.03, 1.04));
  } else {
    bars.push(bar(start + 32 * 900_000, 1.05, 1.12, 0.98, 1.05));
    bars.push(bar(start + 33 * 900_000, 1.05, 1.08, 1.02, 1.04));
  }
  for (let index = 34; index < 56; index += 1) {
    const close = branch === "accepted_up" ? 1.12 + (index - 33) * 0.001 : 1.04 - (index - 33) * 0.001;
    bars.push(bar(start + index * 900_000, close, close + 0.002, close - 0.002, close));
  }
  return bars;
}

function input(bars, overrides = {}) {
  return {
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "15",
    timezone: "UTC",
    rangeStart: "00:00",
    rangeEnd: "08:00",
    auctionEnd: "10:00",
    acceptanceCloses: 2,
    failureWithinBars: 2,
    minimumRangeCoverage: 1,
    horizons: [1, 4, 8],
    targetReturnBps: 10,
    minimumEvents: 2,
    folds: [
      { foldId: "d1", from: "2026-01-05T00:00:00.000Z", to: "2026-01-06T00:00:00.000Z" },
      { foldId: "d2", from: "2026-01-06T00:00:00.000Z", to: "2026-01-07T00:00:00.000Z" },
    ],
    eventLimit: 20,
    confidenceLevel: 0.95,
    configurationTrials: 3,
    ...overrides,
  };
}

test("session auction study separates accepted and failed breakouts with directional outcomes", () => {
  const result = runSessionAuctionStudy(input([...utcDay(5, "accepted_up"), ...utcDay(6, "failed_up")]));
  assert.equal(result.status, "complete");
  assert.equal(result.byBranch.accepted_up.events, 1);
  assert.equal(result.byBranch.failed_up.events, 1);
  assert.equal(result.events.find((event) => event.branch === "accepted_up").direction, "long");
  assert.equal(result.events.find((event) => event.branch === "failed_up").direction, "short");
  assert.ok(result.byBranch.accepted_up.horizons["4"].directionalReturn.mean > 0);
  assert.ok(result.byBranch.failed_up.horizons["4"].directionalReturn.mean > 0);
  assert.equal(result.methodologyVersion, "session_auction_event_study_v2");
  assert.equal(result.inferenceContract.configurationTrials, 3);
  assert.equal(result.inferenceContract.trialTrackingStatus, "declared");
  assert.equal(result.inferenceContract.configuredMetricIntervals, 36);
  assert.equal(result.byBranch.accepted_up.horizons["4"].directionalReturn.meanConfidenceInterval.status,
    "insufficient_sample");
  assert.equal(result.byBranch.accepted_up.horizons["4"].positiveRateConfidenceInterval.method,
    "wilson_score");
  assert.equal(result.folds[0].events, 1);
  assert.equal(result.folds[1].events, 1);
  assert.equal("meanConfidenceInterval" in
    result.folds[0].byBranch.accepted_up.horizons["4"].directionalReturn, false);
  assert.equal("mfe" in result.folds[0].byBranch.accepted_up.horizons["4"], false);
  assert.equal(result.foldContract.detail, "compact_directional_outcomes");
});

test("session auction study excludes forming bars and refuses ambiguous two-sided sweeps", () => {
  const bars = utcDay(5, "ambiguous");
  bars.push({ ...bars.at(-1), time: bars.at(-1).time + 900, timeIso: new Date((bars.at(-1).time + 900) * 1000).toISOString(), forming: true });
  const result = runSessionAuctionStudy(input(bars, { minimumEvents: 1, folds: [] }));
  assert.equal(result.sample.events, 0);
  assert.equal(result.quality.ambiguousBothSides, 1);
  assert.equal(result.quality.formingBarsExcluded, 1);
  assert.ok(result.qualityIssues.includes("minimum_event_count_not_met"));
  assert.ok(result.qualityIssues.includes("fewer_than_two_time_folds"));
});

test("session auction study uses IANA timezone across London daylight saving time", () => {
  const utcStart = Date.UTC(2026, 2, 29, 23, 0);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    bars.push(bar(utcStart + index * 900_000, 1.05, 1.1, 1, 1.05));
  }
  bars.push(bar(utcStart + 32 * 900_000, 1.05, 1.12, 1.04, 1.11));
  bars.push(bar(utcStart + 33 * 900_000, 1.11, 1.13, 1.1, 1.12));
  for (let index = 34; index < 42; index += 1) {
    bars.push(bar(utcStart + index * 900_000, 1.12, 1.13, 1.11, 1.12));
  }
  const result = runSessionAuctionStudy(input(bars, {
    timezone: "Europe/London",
    minimumEvents: 1,
    folds: [],
    horizons: [1, 4],
  }));
  assert.equal(result.byBranch.accepted_up.events, 1);
  assert.equal(result.events[0].localDate, "2026-03-30");
  assert.equal(result.events[0].touchTime, "2026-03-30T07:00:00.000Z");
});

test("session auction study returns bounded confidence intervals and explicit trial tracking", () => {
  const bars = [
    ...utcDay(5, "accepted_up"),
    ...utcDay(6, "accepted_up"),
    ...utcDay(7, "accepted_up"),
  ];
  const result = runSessionAuctionStudy(input(bars, {
    folds: [], minimumEvents: 1, confidenceLevel: 0.99, configurationTrials: null,
  }));
  const horizon = result.byBranch.accepted_up.horizons["4"];
  assert.equal(horizon.directionalReturn.meanConfidenceInterval.status, "available");
  assert.equal(horizon.directionalReturn.meanConfidenceInterval.confidenceLevel, 0.99);
  assert.ok(horizon.directionalReturn.meanConfidenceInterval.lower <= horizon.directionalReturn.mean);
  assert.ok(horizon.directionalReturn.meanConfidenceInterval.upper >= horizon.directionalReturn.mean);
  assert.ok(horizon.positiveRateConfidenceInterval.lower >= 0);
  assert.ok(horizon.positiveRateConfidenceInterval.upper <= 1);
  assert.equal(result.inferenceContract.trialTrackingStatus, "not_declared");
  assert.ok(result.inferenceWarnings.includes("configuration_trial_count_not_declared"));
});
