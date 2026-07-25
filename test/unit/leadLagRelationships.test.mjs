import assert from "node:assert/strict";
import test from "node:test";
import { computeLeadLagRelationships } from "../../build/leadLagRelationships.js";

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
  assert.equal(result.inferenceContract.multipleTestingAdjustment, "none");
  assert.ok(result.inferenceWarnings.includes("every_scanned_lag_is_reported_and_no_best_lag_is_selected"));
  assert.ok(result.inferenceWarnings.includes(
    "scanning_many_lags_inflates_the_chance_of_one_interval_excluding_zero"));
  // No field may hand the caller a pre-picked winner.
  assert.equal(Object.keys(result).some((key) => /best|selected|optimal/i.test(key)), false);
});

test("lead/lag Bonferroni reference alpha divides by lags and declared trials without touching intervals", () => {
  const { primaryBars, referenceBars } = laggedPair(DRIVER, 2);
  const result = computeLeadLagRelationships({
    ...BASE, primaryBars, referenceBars, maxLagBars: 2, configurationTrials: 5,
  });
  // 5 lags inspected here, times 5 declared trials.
  assert.equal(result.inferenceContract.bonferroniAdjustedAlphaReference, (1 - 0.95) / 25);
  assert.equal(result.inferenceContract.confidenceLevel, 0.95);
  const lagTwo = result.byLag.find((entry) => entry.lagBars === 2);
  assert.equal(lagTwo.confidenceInterval.confidenceLevel, 0.95);
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
