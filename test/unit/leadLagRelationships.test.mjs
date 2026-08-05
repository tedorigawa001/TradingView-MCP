import assert from "node:assert/strict";
import test from "node:test";
import {
  LEAD_LAG_CAUSAL_VOLATILITY_WINDOW_BARS,
  causalPriorRmsStandardizePair,
  computeLeadLagRelationships,
  leadLagSignFlipBlockBars,
  resampleClosedBarsToUtcGrid,
} from "../../build/leadLagRelationships.js";

function bar(time, close, forming = false) {
  return { time, timeIso: new Date(time * 1000).toISOString(), open: close, high: close, low: close, close, volume: 1, forming };
}

function seriesFromReturns(returns, start = 100) {
  const closes = [start];
  for (const value of returns) closes.push(closes.at(-1) * Math.exp(value));
  return closes;
}

const BASE = {
  primarySymbol: "OANDA:USDJPY",
  referenceSymbol: "TVC:US10Y",
  timeframe: "60",
  minimumObservations: 4,
  confidenceLevel: 0.95,
  folds: [],
  configurationTrials: 1,
};

// A deterministic driver where the primary return echoes the reference return `lead` bars later,
// plus a small deterministic perturbation so the pair is strongly but not perfectly collinear.
function laggedPair(driverReturns, lead) {
  const primaryReturns = driverReturns.map((_, index) =>
    (index - lead >= 0 ? driverReturns[index - lead] : 0) + ((index % 3) - 1) * 0.0006);
  const referenceCloses = seriesFromReturns(driverReturns);
  const primaryCloses = seriesFromReturns(primaryReturns);
  const times = referenceCloses.map((_, index) => index * 3600);
  return {
    primaryBars: primaryCloses.map((close, index) => bar(times[index], close)),
    referenceBars: referenceCloses.map((close, index) => bar(times[index], close)),
  };
}

const DRIVER = [0.004, -0.003, 0.006, -0.002, 0.005, -0.007, 0.003, 0.008, -0.004, 0.002,
  0.007, -0.006, 0.001, 0.009, -0.005, 0.004, -0.008, 0.006, -0.001, 0.003];

test("causal volatility scaling uses only the prior fixed 20 returns", () => {
  const prior = Array.from({ length: LEAD_LAG_CAUSAL_VOLATILITY_WINDOW_BARS }, (_, index) => index + 1);
  const result = causalPriorRmsStandardizePair({
    primaryReturns: [...prior, 1_000],
    referenceReturns: [...prior.map((value) => value * 2), -2_000],
  });
  const rms = Math.sqrt(prior.reduce((sum, value) => sum + value ** 2, 0) / prior.length);
  assert.equal(result.primaryReturns.length, 1);
  assert.ok(Math.abs(result.primaryReturns[0] - 1_000 / rms) < 1e-12);
  assert.ok(Math.abs(result.referenceReturns[0] - (-2_000 / (2 * rms))) < 1e-12);
  assert.equal(result.warmupReturnsExcluded, 20);
  assert.throws(() => causalPriorRmsStandardizePair({
    primaryReturns: [...new Array(20).fill(0), 1], referenceReturns: [...new Array(20).fill(1), 1],
  }), /causal volatility scale is unavailable/);
});

test("lead/lag v3 records causal scaling and retains a planted lag", () => {
  const driver = Array.from({ length: 160 }, (_, index) =>
    (((index * 47) % 101) - 50) / 10_000 + ((index % 5) - 2) / 100_000);
  const pair = laggedPair(driver, 2);
  const result = computeLeadLagRelationships({
    ...BASE, ...pair, maxLagBars: 4, minimumObservations: 30,
    returnStandardization: "causal_prior_20_rms",
  });
  assert.equal(result.methodologyVersion, "lead_lag_relationships_v3_causal_prior_20_rms");
  assert.deepEqual(result.definition.returnStandardization, {
    method: "causal_prior_rms", windowBars: 20, currentReturnExcludedFromScale: true, centering: "none",
  });
  assert.equal(result.sample.standardizationWarmupReturnsExcluded, 20);
  assert.equal(result.sample.returnObservations, result.sample.rawReturnObservations - 20);
  assert.ok(result.byLag.find((entry) => entry.lagBars === 2).correlation > 0.8);
});

test("UTC-grid resampling requires every closed source interval in a target bucket", () => {
  const source = Array.from({ length: 8 }, (_, index) => ({
    ...bar(index * 3_600, 100 + index), high: 101 + index, low: 99 + index, volume: index + 1,
  }));
  const resampled = resampleClosedBarsToUtcGrid({
    bars: source, sourceTimeframe: "60", targetTimeframe: "240",
  });
  assert.equal(resampled.bars.length, 2);
  assert.equal(resampled.intervalsPerBucket, 4);
  assert.equal(resampled.bars[0].time, 0);
  assert.equal(resampled.bars[0].open, 100);
  assert.equal(resampled.bars[0].close, 103);
  assert.equal(resampled.bars[0].high, 104);
  assert.equal(resampled.bars[0].low, 99);
  assert.equal(resampled.bars[0].volume, 10);

  const missing = resampleClosedBarsToUtcGrid({
    bars: source.filter((candidate) => candidate.time !== 7_200), sourceTimeframe: "60", targetTimeframe: "240",
  });
  assert.equal(missing.bars.length, 1, "a partial bucket must never be forward-filled into a synthetic 4H bar");
  assert.equal(missing.incompleteBucketsExcluded, 1);
});

test("lead/lag reports an explicit UTC-grid resampling policy", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER, 1);
  const result = computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 2,
    alignmentPolicy: "utc_grid_resampled_from_closed_60m_bars",
  });
  assert.equal(result.alignmentPolicy, "utc_grid_resampled_from_closed_60m_bars");
  assert.equal(result.definition.alignmentPolicy, "utc_grid_resampled_from_closed_60m_bars");
});

test("lead/lag scan finds a planted reference lead at the correct positive lag", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER, 2);
  const result = computeLeadLagRelationships({ ...BASE, primaryBars, referenceBars, maxLagBars: 4 });

  const atLag = (lagBars) => result.byLag.find((entry) => entry.lagBars === lagBars);
  assert.equal(atLag(2).status, "evaluable");
  assert.ok(atLag(2).correlation > 0.9, `lag +2 correlation was ${atLag(2).correlation}`);
  assert.ok(atLag(2).correlation < 1, "the fixture must not be perfectly collinear");
  assert.equal(atLag(2).leadDirection, "reference_leads_primary");
  assert.equal(atLag(2).tradableOnPrimary, true);

  // The planted relationship exists only at lag +2; the contemporaneous pairing must not see it.
  assert.ok(Math.abs(atLag(0).correlation) < 0.5, `lag 0 correlation was ${atLag(0).correlation}`);
  assert.ok(atLag(2).confidenceInterval.lower > 0);
  assert.equal(atLag(2).confidenceInterval.method, "fisher_z");
});

test("lead/lag scan labels negative lags as not tradable on the primary", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER, 2);
  const result = computeLeadLagRelationships({ ...BASE, primaryBars, referenceBars, maxLagBars: 3 });

  const negative = result.byLag.filter((entry) => entry.lagBars < 0);
  assert.equal(negative.length, 3);
  assert.ok(negative.every((entry) => entry.leadDirection === "primary_leads_reference"));
  assert.ok(negative.every((entry) => entry.tradableOnPrimary === false));
  assert.equal(result.byLag.find((entry) => entry.lagBars === 0).leadDirection, "contemporaneous");
});

test("lead/lag scan reports every scanned lag and never selects a best lag", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER, 2);
  const result = computeLeadLagRelationships({ ...BASE, primaryBars, referenceBars, maxLagBars: 5 });

  assert.equal(result.byLag.length, 11);
  assert.deepEqual(result.byLag.map((entry) => entry.lagBars),
    [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  assert.equal(result.inferenceContract.automaticLagSelection, false);
  assert.equal(result.inferenceContract.ranking, false);
  assert.equal(result.inferenceContract.lagsInspected, 11);
  assert.equal(result.inferenceContract.multipleTestingAdjustment, "bonferroni_family_wise_error_rate");
  assert.ok(result.inferenceWarnings.includes("every_scanned_lag_is_reported_and_no_best_lag_is_selected"));
  assert.ok(result.inferenceWarnings.includes("bonferroni_adjustment_is_applied_to_lag_eligibility"));
  // No field may hand the caller a pre-picked winner.
  assert.equal(Object.keys(result).some((key) => /best|selected|optimal/i.test(key)), false);
});

test("lead/lag Bonferroni gates lag eligibility across lags and declared trials", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER, 2);
  const result = computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 2, configurationTrials: 5,
  });
  // 5 lags inspected here, times 5 declared trials.
  assert.equal(result.inferenceContract.familyTests, 25);
  assert.equal(result.inferenceContract.bonferroniAdjustedAlpha, (1 - 0.95) / 25);
  assert.equal(result.inferenceContract.confidenceLevel, 0.95);
  const lagTwo = result.byLag.find((entry) => entry.lagBars === 2);
  assert.equal(lagTwo.confidenceInterval.confidenceLevel, 0.95);
  assert.ok(lagTwo.inference.fisherTwoSidedPValue < 0.002);
  assert.equal(lagTwo.inference.passesBonferroni, true);
  assert.ok(lagTwo.inference.bonferroniAdjustedPValue <= 0.05);
  const nonTradable = result.byLag.find((entry) => entry.lagBars === -2);
  assert.equal(nonTradable.inference.passesBonferroni, false, "negative lags cannot become a primary-market candidate");
});

test("lead/lag empirical null is deterministic and exposes the statistical gate while candidacy is disabled", () => {
  const driver = Array.from({ length: 140 }, (_, index) =>
    (((index * 47) % 101) - 50) / 10_000 + ((index % 5) - 2) / 100_000);
  const { primaryBars, referenceBars } = laggedPair(driver, 2);
  const args = {
    ...BASE,
    primaryBars,
    referenceBars,
    maxLagBars: 4,
    minimumObservations: 30,
    empiricalNullCalibration: true,
    folds: [
      { foldId: "first", from: new Date(0).toISOString(), to: new Date(70 * 3_600_000).toISOString() },
      { foldId: "second", from: new Date(70 * 3_600_000).toISOString(), to: new Date(140 * 3_600_000).toISOString() },
    ],
  };
  const result = computeLeadLagRelationships(args);
  const again = computeLeadLagRelationships(args);
  assert.equal(result.empiricalNullCalibration.status, "complete");
  assert.equal(result.empiricalNullCalibration.iterations, 1000);
  assert.equal(result.empiricalNullCalibration.methodologyVersion, "lead_lag_empirical_null_circular_shift_v1");
  assert.deepEqual(result.empiricalNullCalibration, again.empiricalNullCalibration);
  const lagTwo = result.byLag.find((entry) => entry.lagBars === 2);
  assert.equal(lagTwo.inference.statisticalGateEligible, true);
  assert.equal(lagTwo.inference.candidateEligible, false);
  assert.ok(lagTwo.inference.candidateBlockers.includes(
    "candidate_rule_not_calibrated_for_shared_clustered_volatility"));
  assert.ok(result.byLag.find((entry) => entry.lagBars === 2).inference.empiricalNull.familyWisePValue <= 0.05);
  assert.equal(result.byLag.find((entry) => entry.lagBars === -2).inference.candidateEligible, false);
  assert.ok(result.byLag.find((entry) => entry.lagBars === -2).inference.candidateBlockers.includes("not_a_positive_reference_lead"));
});

test("lead/lag scan cannot claim candidate eligibility without the empirical-null calibration", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER, 2);
  const result = computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 2,
    folds: [
      { foldId: "first", from: new Date(0).toISOString(), to: new Date(10 * 3_600_000).toISOString() },
      { foldId: "second", from: new Date(10 * 3_600_000).toISOString(), to: new Date(20 * 3_600_000).toISOString() },
    ],
  });
  const lagTwo = result.byLag.find((entry) => entry.lagBars === 2);
  assert.equal(lagTwo.inference.candidateEligible, false);
  assert.ok(lagTwo.inference.candidateBlockers.includes("empirical_null_calibration_required"));
});

test("lead/lag scan joins on exact timestamps and never forward fills a missing reference bar", () => {
  const times = [0, 3600, 7200, 10800, 14400];
  const primaryBars = times.map((time, index) => bar(time, 100 + index));
  // The 7200 reference bar is absent, so that pair is dropped rather than filled.
  const referenceBars = times.filter((time) => time !== 7200).map((time, index) => bar(time, 200 - index));
  const result = computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 1, minimumObservations: 4,
  });
  assert.equal(result.alignmentPolicy, "exact_utc_timestamp_no_forward_fill");
  assert.equal(result.sample.primaryClosedBars, 5);
  assert.equal(result.sample.referenceClosedBars, 4);
  assert.equal(result.sample.alignedBars, 4);
  assert.equal(result.sample.returnObservations, 3);
  assert.ok(result.qualityIssues.includes("one_or_more_non_contiguous_bar_intervals"));
});

test("lead/lag scan excludes forming bars from both series", () => {
  const times = [0, 3600, 7200, 10800];
  const result = computeLeadLagRelationships({
    ...BASE,
    primaryBars: times.map((time, index) => bar(time, 100 + index, time === 10800)),
    referenceBars: times.map((time, index) => bar(time, 200 - index, time === 10800)),
    maxLagBars: 1,
  });
  assert.equal(result.quality.formingBarsExcluded, 2);
  assert.equal(result.sample.alignedBars, 3);
});

test("lead/lag scan marks lags below the minimum observation count as insufficient", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER.slice(0, 6), 1);
  const result = computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 4, minimumObservations: 5,
  });
  const shallow = result.byLag.find((entry) => entry.lagBars === 4);
  assert.equal(shallow.status, "insufficient_sample");
  assert.equal(shallow.correlation, null);
  assert.equal(shallow.confidenceInterval.status, "insufficient_sample");
  assert.equal(shallow.confidenceInterval.lower, null);
  assert.ok(result.qualityIssues.includes("one_or_more_lags_not_evaluable"));
});

test("lead/lag scan exposes a fold sign flip instead of hiding it in the pooled correlation", () => {
  // First half: reference leads primary positively. Second half: the same lead flips sign.
  const firstHalf = [0.005, -0.004, 0.006, -0.003, 0.007, -0.005, 0.004, -0.006, 0.003, -0.002];
  const primaryReturns = [
    ...firstHalf.map((value, index) => (index === 0 ? 0 : firstHalf[index - 1])),
    ...firstHalf.map((value, index) => (index === 0 ? 0 : -firstHalf[index - 1])),
  ];
  const driver = [...firstHalf, ...firstHalf];
  const referenceCloses = seriesFromReturns(driver);
  const primaryCloses = seriesFromReturns(primaryReturns);
  const times = referenceCloses.map((_, index) => index * 3600);
  const iso = (index) => new Date(times[index] * 1000).toISOString();

  const result = computeLeadLagRelationships({
    ...BASE,
    primaryBars: primaryCloses.map((close, index) => bar(times[index], close)),
    referenceBars: referenceCloses.map((close, index) => bar(times[index], close)),
    maxLagBars: 2,
    folds: [
      { foldId: "first", from: iso(0), to: iso(10) },
      { foldId: "second", from: iso(10), to: iso(20) },
    ],
  });

  const lagOne = result.byLag.find((entry) => entry.lagBars === 1);
  assert.equal(lagOne.folds.length, 2);
  const evaluated = lagOne.folds.filter((fold) => fold.correlation !== null);
  assert.equal(evaluated.length, 2);
  assert.ok(Math.sign(evaluated[0].correlation) !== Math.sign(evaluated[1].correlation),
    "the planted per-fold sign flip must survive into the fold report");
  assert.equal(lagOne.foldStability.signStable, false);
  assert.equal(lagOne.foldStability.evaluableFolds, 2);
});

test("lead/lag scan rejects overlapping folds and out-of-range lag requests", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER, 1);
  assert.throws(() => computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 0,
  }), /max_lag_bars must be an integer from 1 to 50/);

  assert.throws(() => computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 2,
    folds: [
      { foldId: "a", from: "2026-01-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" },
      { foldId: "b", from: "2026-02-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" },
    ],
  }), /folds must not overlap/);

  assert.throws(() => computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 2,
    folds: [
      { foldId: "same", from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" },
      { foldId: "same", from: "2026-03-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" },
    ],
  }), /unique fold ids/);
});

test("the block sign-flip null leaves every absolute return exactly where it was", () => {
  // This is the whole point of the policy. The circular shift preserves each leg volatility path
  // but slides them apart, which removes the synchronisation between them along with the lag
  // structure. Flipping signs inside blocks touches neither path nor their alignment.
  const start = Date.UTC(2024, 0, 1) / 1000;
  const next = (() => { let state = 4242 >>> 0;
    return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; }; })();
  const bars = (drift) => Array.from({ length: 600 }, (_, index) => {
    const close = 100 * Math.exp(drift * index / 600 + (next() - 0.5) * 0.02);
    return { time: start + index * 3600, timeIso: new Date((start + index * 3600) * 1000).toISOString(),
      open: close, high: close * 1.001, low: close * 0.999, close, volume: 1 };
  });
  const study = {
    primaryBars: bars(0.01), referenceBars: bars(-0.01),
    primarySymbol: "A", referenceSymbol: "B", timeframe: "60",
    maxLagBars: 3, minimumObservations: 30, confidenceLevel: 0.95,
    folds: [], configurationTrials: 1, empiricalNullCalibration: true,
  };
  const shift = computeLeadLagRelationships({ ...study, nullPolicy: "circular_shift" });
  const flip = computeLeadLagRelationships({ ...study, nullPolicy: "block_sign_flip" });

  // Each null carries its own identity, because a rate cannot be read without knowing which
  // produced it. They are different nulls, not two settings of one.
  assert.equal(shift.empiricalNullCalibration.nullPolicy, "circular_shift");
  assert.equal(flip.empiricalNullCalibration.nullPolicy, "block_sign_flip");
  assert.notEqual(shift.empiricalNullCalibration.methodologyVersion, flip.empiricalNullCalibration.methodologyVersion);
  assert.match(flip.empiricalNullCalibration.methodologyVersion, /block_sign_flip/);
  assert.notEqual(shift.empiricalNullCalibration.calibrationId, flip.empiricalNullCalibration.calibrationId);

  // Blocks are long relative to the scanned lags so most within-block lag pairs survive intact.
  assert.equal(flip.empiricalNullCalibration.signFlipBlockBars, 50);
  assert.equal(shift.empiricalNullCalibration.signFlipBlockBars, null);
  assert.equal(flip.empiricalNullCalibration.status, "complete");
  // The observed statistics are a property of the data, so the two nulls must agree on them and
  // differ only in what they compare them against.
  for (const lag of ["1", "2", "3"]) {
    assert.equal(flip.empiricalNullCalibration.byLag[lag].observedStatistic,
      shift.empiricalNullCalibration.byLag[lag].observedStatistic, `lag ${lag}`);
  }
});

test("the sign-flip block length is a stated rule rather than a free number", () => {
  // Ten times the scanned lag, floored at fifty bars. Fixed before any rate was measured with it.
  assert.equal(leadLagSignFlipBlockBars(1), 50);
  assert.equal(leadLagSignFlipBlockBars(5), 50);
  assert.equal(leadLagSignFlipBlockBars(10), 100);
  assert.equal(leadLagSignFlipBlockBars(50), 500);
});
