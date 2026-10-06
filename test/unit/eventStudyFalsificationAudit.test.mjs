import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateEventStudyCandidate,
  isEventStudyCandidate,
  runFvgRetestFalsificationAudit,
  runSessionAuctionFalsificationAudit,
  runEventAftershockFalsificationAudit,
  runFailedBreakoutFalsificationAudit,
  runSessionHandoffFalsificationAudit,
  runCompositeConditionFalsificationAudit,
  runYieldPriceNonconfirmationFalsificationAudit,
  runStandardEventStudyFalsificationAudit,
} from "../../build/eventStudyFalsificationAudit.js";

const candidate = {
  branch: "fvg_retest_bullish",
  horizon: 2,
  minimumEvents: 2,
  minimumFoldEvents: 1,
  folds: 2,
};

function candidateResult(overrides = {}) {
  const outcome = {
    availableEvents: 2,
    directionalReturn: {
      mean: 0.01,
      meanConfidenceInterval: { status: "available", lower: 0.002 },
    },
  };
  return {
    status: "complete",
    byBranch: { fvg_retest_bullish: { events: 2, horizons: { "2": outcome } } },
    folds: [
      { byBranch: { fvg_retest_bullish: { events: 1, horizons: { "2": { ...outcome, availableEvents: 1 } } } } },
      { byBranch: { fvg_retest_bullish: { events: 1, horizons: { "2": { ...outcome, availableEvents: 1 } } } } },
    ],
    ...overrides,
  };
}

test("event-study candidate requires global interval evidence and every predeclared fold", () => {
  assert.equal(isEventStudyCandidate(candidateResult(), candidate), true);
  assert.equal(isEventStudyCandidate(candidateResult({ status: "partial" }), candidate), false);
  assert.equal(isEventStudyCandidate(candidateResult({
    byBranch: { fvg_retest_bullish: { events: 2, horizons: { "2": {
      availableEvents: 2,
      directionalReturn: { mean: 0.01, meanConfidenceInterval: { status: "available", lower: 0 } },
    } } } },
  }), candidate), false, "a confidence interval touching zero is not a candidate");
  const missingFold = candidateResult();
  missingFold.folds[1].byBranch.fvg_retest_bullish.horizons["2"].directionalReturn.mean = -0.001;
  assert.equal(isEventStudyCandidate(missingFold, candidate), false);
});

test("FVG falsification audit uses synthetic folds and remains reproducible", () => {
  const input = {
    audit: { model: "white_noise", replications: 4, firstSeed: 30, bars: 1200, timeframeMinutes: 60, nominalAlpha: 0.05 },
    study: {
      symbol: "SYNTH:FVG", timeframe: "60", minimumGapBps: 10, retestWithinBars: 12,
      minImpulseBodyRatio: 0.5, requireBoundaryHold: true, horizons: [1, 2], targetReturnBps: 20,
      minimumEvents: 2, eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: null,
    },
    candidate,
  };
  const first = runFvgRetestFalsificationAudit(input);
  const again = runFvgRetestFalsificationAudit(input);
  assert.equal(first.study, "fvg_retest");
  assert.deepEqual(first.audit.candidateSeeds, again.audit.candidateSeeds);
  assert.equal(first.audit.completed, 4);
  assert.equal(first.audit.failed.length, 0);
  assert.equal(first.candidateRule.globalEvidence, "positive_mean_confidence_interval_excludes_zero");
});

test("session auction falsification audit runs the same study path over synthetic OHLC", () => {
  const result = runSessionAuctionFalsificationAudit({
    audit: { model: "regime_switching_volatility", replications: 3, firstSeed: 70, bars: 1500, timeframeMinutes: 60, nominalAlpha: 0.05 },
    study: {
      symbol: "SYNTH:AUCTION", timeframe: "60", timezone: "UTC", rangeStart: "00:00", rangeEnd: "08:00",
      auctionEnd: "12:00", acceptanceCloses: 2, failureWithinBars: 2, minimumRangeCoverage: 1,
      horizons: [1, 2], targetReturnBps: 20, minimumEvents: 2, eventLimit: 0,
      confidenceLevel: 0.95, configurationTrials: 1, regime: null,
    },
    candidate: { branch: "accepted_up", horizon: 2, minimumEvents: 2, minimumFoldEvents: 1, folds: 2 },
  });
  assert.equal(result.study, "session_auction");
  assert.equal(result.audit.completed, 3);
  assert.equal(result.audit.failed.length, 0);
  assert.equal(result.candidateRule.foldEvidence, "every_predeclared_fold_has_positive_mean");
});

test("event-aftershock audit records a fixed exogenous synthetic event schedule", () => {
  const result = runEventAftershockFalsificationAudit({
    audit: { model: "white_noise", replications: 3, firstSeed: 100, bars: 1200, timeframeMinutes: 15, nominalAlpha: 0.05 },
    study: {
      symbol: "SYNTH:AFTERSHOCK", timeframe: "15", sameTimestampPolicy: "represent_first",
      initialRangeBars: 4, breakoutWithinBars: 8, retestWithinBars: 8, overlapPolicy: "exclude_later_event",
      requireRetestCloseOutside: true, minimumInitialRangeCoverage: 1, horizons: [1, 4], targetReturnBps: 10,
      minimumEvents: 2, eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: null,
    },
    candidate: { branch: "retest_up", horizon: 4, minimumEvents: 2, minimumFoldEvents: 1, folds: 2 },
    eventSchedule: { firstBar: 16, everyBars: 96, maximumEvents: 10 },
  });
  assert.equal(result.study, "event_aftershock_retest");
  assert.deepEqual(result.syntheticEventSchedule, { firstBar: 16, everyBars: 96, maximumEvents: 10 });
  assert.equal(result.audit.completed, 3);
  assert.equal(result.audit.failed.length, 0);
});

test("remaining event-study paths run over their matching synthetic null contracts", () => {
  const audit = { model: "white_noise", replications: 2, firstSeed: 140, bars: 1800, timeframeMinutes: 60, nominalAlpha: 0.05 };
  const common = { horizons: [1, 2], targetReturnBps: 20, minimumEvents: 2, eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: null };
  const failed = runFailedBreakoutFalsificationAudit({ audit, study: {
    symbol: "SYNTH:FAILED", timeframe: "60", timezone: "UTC", rangeStart: "00:00", rangeEnd: "08:00",
    failureEnd: "12:00", confirmationBars: 1, minimumRangeCoverage: 1, ...common,
  }, candidate: { branch: "failed_breakout_up", horizon: 2, minimumEvents: 2, minimumFoldEvents: 1, folds: 2 } });
  const handoff = runSessionHandoffFalsificationAudit({ audit, study: {
    symbol: "SYNTH:HANDOFF", timeframe: "60", timezone: "UTC", priorSessions: [{ sessionId: "asia", start: "00:00", end: "08:00" }],
    handoffStart: "08:00", handoffEnd: "12:00", priorDirection: "session_return", directionMinimumReturnBps: 1,
    closeLocationThreshold: 0.7, handoffWindowBars: 2, forwardUpdateThresholdBps: 1, requireRangeReentry: false,
    requireOppositeBody: false, minimumPriorCoverage: 1, ...common,
  }, candidate: { branch: "exhaustion_up", horizon: 2, minimumEvents: 2, minimumFoldEvents: 1, folds: 2 } });
  const composite = runCompositeConditionFalsificationAudit({ audit, study: {
    symbol: "SYNTH:COMPOSITE", timeframe: "60", operator: "union", conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 8, min_impulse_body_ratio: 0.5, require_boundary_hold: true },
      { type: "failed_breakout", timezone: "UTC", range_start: "00:00", range_end: "08:00", failure_end: "12:00", confirmation_bars: 1, minimum_range_coverage: 1 },
    ], overlapPolicy: "exclude_later_event", horizons: [1, 2], targetReturnBps: 20, minimumEvents: 2,
    eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: null,
  }, candidate: { branch: "composite_long", horizon: 2, minimumEvents: 2, minimumFoldEvents: 1, folds: 2 } });
  const yieldPrice = runYieldPriceNonconfirmationFalsificationAudit({ audit, study: {
    targetSymbol: "SYNTH:TARGET", driverSymbol: "SYNTH:DRIVER", targetTimeframe: "60", driverTimeframe: "60",
    relationship: "inverse", driverLookback: 3, driverChangeThreshold: 0.001, priceBreakoutLookback: 3,
    nonconfirmationBars: 2, triggerLookback: 2, triggerWithinBars: 3, maxDriverAgeBars: 1, horizons: [1, 2],
    targetReturnBps: 20, minimumEvents: 2, eventLimit: 0, configurationTrials: 1, confidenceLevel: 0.95,
  }, candidate: { branch: "driver_up_target_failure", horizon: 2, minimumEvents: 2, minimumFoldEvents: 1, folds: 2 }, rho: 0.5 });
  assert.equal(failed.study, "failed_breakout");
  assert.equal(handoff.study, "session_exhaustion_handoff");
  assert.equal(composite.study, "composite_condition");
  assert.equal(yieldPrice.study, "yield_price_nonconfirmation");
  assert.equal(yieldPrice.audit.model, "factor_null_pair");
  assert.equal(yieldPrice.audit.pairStructure.crossSeriesDependence, "contemporaneous_factor");
  assert.ok([failed, handoff, composite, yieldPrice].every((result) => result.audit.completed === 2));
});

test("standard yield-price audit runs all three correlated marginal models", () => {
  const result = runStandardEventStudyFalsificationAudit({
    study: { type: "yield_price_nonconfirmation", definition: {
      targetSymbol: "SYNTH:TARGET", driverSymbol: "SYNTH:DRIVER", targetTimeframe: "60", driverTimeframe: "60",
      relationship: "inverse", driverLookback: 3, driverChangeThreshold: 0.001, priceBreakoutLookback: 3,
      nonconfirmationBars: 2, triggerLookback: 2, triggerWithinBars: 3, maxDriverAgeBars: 1, horizons: [1, 2],
      targetReturnBps: 20, minimumEvents: 2, eventLimit: 0, configurationTrials: 1, confidenceLevel: 0.95,
    }, rho: 0.5 },
    candidate: { branch: "driver_up_target_failure", horizon: 2, minimumEvents: 2, minimumFoldEvents: 1 },
    replications: 2, bars: 800,
  });
  assert.deepEqual(result.standard.models, [
    "factor_null_pair",
    "factor_regime_switching_volatility_pair",
    "factor_bid_ask_bounce_pair",
  ]);
  assert.equal(result.methodologyVersion, "event_study_falsification_audit_standard_v4");
  assert.deepEqual(result.runs.map((run) => run.audit.model), result.standard.models);
  assert.equal(result.runs[1].audit.pairStructure.volatilityStateDependence, "shared");
  assert.ok(result.runs.every((run) => run.audit.completed === 2));
});

test("event-study audit refuses a rule that differs from the frozen study contract", () => {
  assert.throws(() => runFvgRetestFalsificationAudit({
    audit: { model: "white_noise", replications: 1, bars: 100, timeframeMinutes: 60, nominalAlpha: 0.05 },
    study: {
      symbol: "SYNTH:FVG", timeframe: "60", minimumGapBps: 10, retestWithinBars: 5,
      minImpulseBodyRatio: 0.5, requireBoundaryHold: true, horizons: [1], targetReturnBps: 10,
      minimumEvents: 2, eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: null,
    },
    candidate: { ...candidate, horizon: 1, minimumEvents: 3 },
  }), /must match the study minimum events/);
});

test("event-study audit does not count a partial synthetic study as a rejected candidate", () => {
  const result = runFvgRetestFalsificationAudit({
    audit: { model: "white_noise", replications: 3, bars: 200, timeframeMinutes: 60, nominalAlpha: 0.05 },
    study: {
      symbol: "SYNTH:FVG", timeframe: "60", minimumGapBps: 10, retestWithinBars: 12,
      minImpulseBodyRatio: 0.5, requireBoundaryHold: true, horizons: [1], targetReturnBps: 20,
      minimumEvents: 500, eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: null,
    },
    candidate: { branch: "fvg_retest_bullish", horizon: 1, minimumEvents: 500, minimumFoldEvents: 1, folds: 2 },
  });
  assert.equal(result.audit.completed, 3);
  assert.equal(result.audit.evaluated, 0);
  assert.deepEqual(result.audit.notEvaluableSeeds, [1, 2, 3]);
  assert.equal(result.audit.observedRate, null);
});

test("standard event-study audit records separate standard-model calibrations", () => {
  const result = runStandardEventStudyFalsificationAudit({
    study: { type: "fvg_retest", definition: {
      symbol: "SYNTH:FVG", timeframe: "60", minimumGapBps: 10, retestWithinBars: 12,
      minImpulseBodyRatio: 0.5, requireBoundaryHold: true, horizons: [1, 2], targetReturnBps: 20,
      minimumEvents: 2, eventLimit: 0, confidenceLevel: 0.95, configurationTrials: 1, regime: null,
    } },
    candidate: { branch: "fvg_retest_bullish", horizon: 2, minimumEvents: 2, minimumFoldEvents: 1 },
    models: ["white_noise", "bid_ask_bounce"], replications: 2, bars: 800,
  });
  assert.equal(result.methodologyVersion, "event_study_falsification_audit_standard_v3");
  assert.equal(result.standard.folds, 3);
  assert.deepEqual(result.standard.models, ["white_noise", "bid_ask_bounce"]);
  assert.equal(result.runs.length, 2);
  assert.ok(result.runs.every((run) => run.audit.completed === 2));
});

// BACKLOG 102-15: a draw too sparse for the frozen rule is left out of the denominator, never counted as a rejection.
test("an event-study draw is evaluable only with the events the rule looks at", () => {
  assert.equal(evaluateEventStudyCandidate(candidateResult(), candidate), "candidate");
  const lowInterval = candidateResult();
  lowInterval.byBranch.fvg_retest_bullish.horizons["2"] = { availableEvents: 2, directionalReturn: { mean: 0.01, meanConfidenceInterval: { status: "available", lower: -0.002 } } };
  assert.equal(evaluateEventStudyCandidate(lowInterval, candidate), "non_candidate", "enough events, no evidence: a rejection");
  assert.equal(evaluateEventStudyCandidate(candidateResult({ status: "partial" }), candidate), "not_evaluable");
  assert.equal(evaluateEventStudyCandidate(candidateResult(), { ...candidate, minimumEvents: 3 }), "not_evaluable", "too few at the branch and horizon");
  assert.equal(evaluateEventStudyCandidate(candidateResult(), { ...candidate, minimumFoldEvents: 2 }), "not_evaluable", "too few in a fold");
  assert.equal(evaluateEventStudyCandidate(candidateResult(), { ...candidate, branch: "fvg_retest_bearish" }), "not_evaluable", "no such branch");
  assert.equal(evaluateEventStudyCandidate(candidateResult(), { ...candidate, horizon: 1 }), "not_evaluable", "no such horizon");
  assert.equal(evaluateEventStudyCandidate(candidateResult(), { ...candidate, folds: 3 }), "not_evaluable", "not the predeclared folds");
  const missingFold = candidateResult();
  missingFold.folds[1] = { byBranch: {} };
  assert.equal(evaluateEventStudyCandidate(missingFold, candidate), "not_evaluable", "a fold without the branch");
  // The whole sample without the horizon is not evaluable whatever the folds hold.
  const missingGlobal = candidateResult();
  missingGlobal.byBranch.fvg_retest_bullish.horizons = {};
  assert.equal(evaluateEventStudyCandidate(missingGlobal, candidate), "not_evaluable", "the whole sample without the horizon");
});

test("yield-price audit tells sparse draws from rejections and candidates", () => {
  const run = (minimumEvents, replications, { minimumFoldEvents = 1, firstSeed = 1 } = {}) => runYieldPriceNonconfirmationFalsificationAudit({
    audit: { model: "white_noise", replications, firstSeed, bars: 400, timeframeMinutes: 60, nominalAlpha: 0.05 },
    study: {
      targetSymbol: "SYNTH:TARGET", driverSymbol: "SYNTH:DRIVER", targetTimeframe: "60", driverTimeframe: "60",
      relationship: "inverse", driverLookback: 3, driverChangeThreshold: 0.001, priceBreakoutLookback: 3,
      nonconfirmationBars: 2, triggerLookback: 2, triggerWithinBars: 3, maxDriverAgeBars: 1, horizons: [1, 2],
      targetReturnBps: 20, minimumEvents, eventLimit: 0, configurationTrials: 1, confidenceLevel: 0.95,
    },
    candidate: { branch: "driver_up_target_failure", horizon: 2, minimumEvents, minimumFoldEvents, folds: 2 }, rho: 0.5,
  }).audit;
  // No draw has 500 events: none is evaluated, and there is no rate rather than a rate of zero.
  const none = run(500, 3);
  assert.deepEqual([none.status, none.completed, none.evaluated, none.notEvaluableSeeds, none.candidates, none.observedRate, none.observedRateInterval, none.exceedsNominalAlpha],
    ["complete", 3, 0, [1, 2, 3], 0, null, null, false]);
  // Each of seeds 1-8 has well over 17 events in all, but at the candidate branch and two-bar horizon it has 18, 27,
  // 18, 16, 15, 16, 17 and 17: seeds 4, 5 and 6 fall short there, and the other five are the rejections the rate counts.
  const branch = run(17, 8);
  assert.deepEqual([branch.completed, branch.evaluated, branch.notEvaluableSeeds, branch.candidates, branch.observedRate], [8, 5, [4, 5, 6], 0, 0]);
  // Their folds hold 9/9, 8/19, 8/10, 10/6, 9/6, 10/6, 11/6 and 7/10 events: nine per fold leaves only seed 1.
  const folds = run(2, 8, { minimumFoldEvents: 9 });
  assert.deepEqual([folds.evaluated, folds.notEvaluableSeeds], [1, [2, 3, 4, 5, 6, 7, 8]]);
  // Seed 96 is a candidate on the null and seed 95 a rejection, both with the events to tell.
  const candidates = run(2, 2, { firstSeed: 95 });
  assert.deepEqual([candidates.evaluated, candidates.candidates, candidates.candidateSeeds, candidates.observedRate], [2, 1, [96], 0.5]);
});
