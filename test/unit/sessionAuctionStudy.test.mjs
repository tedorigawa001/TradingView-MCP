import assert from "node:assert/strict";
import test from "node:test";
import { outcomeForEvent, runSessionAuctionStudy } from "../../build/sessionAuctionStudy.js";

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
    regime: null,
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

test("session auction study joins events only to regimes closed before the signal bar", () => {
  const bars = [];
  for (let day = 5; day <= 16; day += 1) bars.push(...utcDay(day, day % 2 ? "accepted_up" : "failed_up"));
  const result = runSessionAuctionStudy(input(bars, {
    folds: [], minimumEvents: 1, horizons: [1, 4],
    regime: {
      trendLookback: 2,
      atrLookback: 2,
      volatilityBaselineLookback: 5,
      trendEfficiencyThreshold: 0.6,
      rangeEfficiencyThreshold: 0.25,
      directionalMoveAtrThreshold: 0.5,
      highVolatilityRatio: 1.5,
      lowVolatilityRatio: 0.75,
      minimumClassifiedBars: 1,
      minimumGroupEvents: 1,
      minimumCoverageRatio: 0.5,
      maxRegimeAgeBars: 1,
    },
  }));
  assert.equal(result.methodologyVersion, "session_auction_event_regime_study_v1");
  assert.equal(result.regimeAnalysis.joinContract.signalBarRegimeExcluded, true);
  assert.equal(result.regimeAnalysis.joinContract.labelAt,
    "latest_regime_bar_with_nominal_close_at_or_before_signal_bar_start");
  assert.ok(result.regimeAnalysis.coverage.joinedEvents > 0);
  assert.ok(result.regimeAnalysis.coverage.coverageRatio >= 0.5);
  const evaluable = Object.values(result.regimeAnalysis.byDirectionalRegime)
    .find((group) => group.status === "evaluable");
  assert.ok(evaluable);
  assert.equal(evaluable.horizons["1"].directionalReturn.meanConfidenceInterval.method,
    "normal_approximation");
  assert.equal("mfe" in evaluable.horizons["1"], false);
});

test("session auction study keeps sparse regime groups not evaluable", () => {
  const bars = [];
  for (let day = 5; day <= 12; day += 1) bars.push(...utcDay(day, "accepted_up"));
  const result = runSessionAuctionStudy(input(bars, {
    folds: [], minimumEvents: 1, horizons: [1],
    regime: {
      trendLookback: 2, atrLookback: 2, volatilityBaselineLookback: 5,
      trendEfficiencyThreshold: 0.6, rangeEfficiencyThreshold: 0.25,
      directionalMoveAtrThreshold: 0.5, highVolatilityRatio: 1.5, lowVolatilityRatio: 0.75,
      minimumClassifiedBars: 1, minimumGroupEvents: 100,
      minimumCoverageRatio: 0.5, maxRegimeAgeBars: 1,
    },
  }));
  assert.equal(result.regimeAnalysis.inferenceContract.groupsEvaluable, 0);
  assert.ok(Object.values(result.regimeAnalysis.byCombinedRegime)
    .every((group) => group.status === "not_evaluable" && group.horizons === null));
});

test("session auction study never joins the signal bar's contemporaneous regime", () => {
  const result = runSessionAuctionStudy(input(utcDay(5, "accepted_up"), {
    folds: [], minimumEvents: 1, horizons: [1],
    regime: {
      trendLookback: 2, atrLookback: 2, volatilityBaselineLookback: 32,
      trendEfficiencyThreshold: 0.6, rangeEfficiencyThreshold: 0.25,
      directionalMoveAtrThreshold: 0.5, highVolatilityRatio: 1.5, lowVolatilityRatio: 0.75,
      minimumClassifiedBars: 1, minimumGroupEvents: 1,
      minimumCoverageRatio: 0.5, maxRegimeAgeBars: 1,
    },
  }));
  assert.ok(result.regimeEvidence.sample.classifiedBars > 0,
    "the signal bar and later bars should be classifiable");
  assert.equal(result.regimeAnalysis.coverage.joinedEvents, 0,
    "the only classification available at the event belongs to the signal bar itself");
  assert.equal(result.regimeAnalysis.status, "blocked");
  assert.ok(result.regimeAnalysis.qualityIssues.includes("no_events_joined_to_regimes"));
});

test("event outcomes keep MFE and MAE at zero when future bars never cross the entry", () => {
  const start = Date.UTC(2026, 0, 5);
  const bars = [
    bar(start, 100, 101, 99, 100),
    bar(start + 900_000, 99, 99.5, 98, 99),
  ];
  const outcome = outcomeForEvent({ signalIndex: 0, direction: 1 }, bars, [1], 900_000, 10);
  assert.equal(outcome.outcomes["1"].mfe, 0);
  assert.ok(outcome.outcomes["1"].mae > 0);
});
