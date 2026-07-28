import assert from "node:assert/strict";
import test from "node:test";
import { computeFeatureOutcomeRelationships } from "../../build/featureOutcomeRelationships.js";

const HOUR = 3_600_000;

function bars(start, closes) {
  return closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    const time = start + index * HOUR;
    return { time: time / 1000, timeIso: new Date(time).toISOString(), open: previous,
      high: Math.max(previous, close) + 0.4, low: Math.min(previous, close) - 0.4,
      close, volume: 1 };
  });
}

function input(series, overrides = {}) {
  return {
    bars: series, symbol: "OANDA:EURUSD", timeframe: "60",
    features: ["atr_compression", "body_direction", "wick_imbalance", "directional_streak", "range_position", "gap_direction"],
    atrLookback: 2, atrBaselineLookback: 5, rangeLookback: 3, streakMinimumBars: 2,
    bodyRatioThreshold: 0.2, wickImbalanceThreshold: 0.2,
    atrCompressionLowRatio: 0.8, atrCompressionHighRatio: 1.2,
    rangePositionLower: 0.33, rangePositionUpper: 0.67, gapAtrThreshold: 0.2,
    horizons: [1, 3], minimumObservations: 2, folds: [], regime: null, observationLimit: 50,
    ...overrides,
  };
}

test("feature-outcome relationships classify only closed-bar evidence and return future distributions", () => {
  const series = bars(Date.UTC(2026, 0, 1), [100, 101, 102, 103, 104, 103, 102, 101, 100, 101, 102, 103]);
  const result = computeFeatureOutcomeRelationships(input(series));
  assert.ok(result.sample.observations >= 2);
  assert.equal(result.byFeature.directional_streak.up_streak.observations > 0, true);
  assert.equal(result.byFeature.range_position.upper_range.observations > 0, true);
  assert.equal(result.outcomeContract.forwardFill, false);
  assert.equal(result.outcomeContract.horizonClock, "observed_market_bars");
  assert.equal(result.outcomeContract.contiguousBarsRequired, false);
  assert.equal(result.outcomeContract.calendarGapsIncluded, true);
  assert.ok(result.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.count > 0);
  const interval = result.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.meanConfidenceInterval;
  assert.equal(interval.status, "available");
  assert.ok(interval.lower <= result.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.mean);
  assert.ok(interval.upper >= result.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.mean);
  assert.equal(result.inferenceContract.confidenceLevel, 0.95);
  assert.equal(result.inferenceContract.multipleTestingAdjustment, "bonferroni_family_wise_error_rate");
  assert.ok(result.inferenceContract.familyTests > 1);
  assert.ok(result.inferenceWarnings.includes("bonferroni_adjustment_is_applied_to_feature_bucket_horizon_eligibility"));
  assert.equal(typeof result.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.inference.passesBonferroni, "boolean");
});

test("feature labels at an existing bar are unchanged when later bars are appended", () => {
  const start = Date.UTC(2026, 0, 1);
  const base = bars(start, [100, 101, 102, 103, 102, 101, 102, 103, 104, 103, 102, 101]);
  const extended = [...base, ...bars(start + base.length * HOUR, [100, 99, 98])];
  const baseResult = computeFeatureOutcomeRelationships(input(base, { observationLimit: 50 }));
  const extendedResult = computeFeatureOutcomeRelationships(input(extended, { observationLimit: 50 }));
  const time = baseResult.observations[2].signalTime;
  assert.deepEqual(extendedResult.observations.find((row) => row.signalTime === time).labels, baseResult.observations[2].labels);
});

test("feature-outcome candidate eligibility uses horizon one and non-overlapping return windows", () => {
  const series = bars(Date.UTC(2026, 0, 1), [
    100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
  ]);
  const result = computeFeatureOutcomeRelationships(input(series, {
    features: ["body_direction"], horizons: [1, 3], minimumObservations: 2,
  }));
  const bullish = result.byFeature.body_direction.bullish_body;
  const horizonOne = bullish.horizons["1"];
  const horizonThree = bullish.horizons["3"];
  assert.equal(horizonOne.nonOverlappingForwardReturn.sampling, "greedy_non_overlapping_future_return_windows");
  assert.equal(horizonOne.nonOverlappingForwardReturn.count, horizonOne.forwardReturn.count);
  assert.ok(horizonThree.nonOverlappingForwardReturn.count < horizonThree.forwardReturn.count);
  assert.equal(horizonOne.nonOverlappingForwardReturn.neweyWestConfidenceInterval.method, "newey_west_bartlett");
  assert.ok(horizonOne.nonOverlappingForwardReturn.neweyWestConfidenceInterval.lags >= 1);
  assert.equal(horizonOne.nonOverlappingForwardReturn.candidateInference.twoSidedPValue,
    horizonOne.nonOverlappingForwardReturn.neweyWestConfidenceInterval.twoSidedPValue);
  assert.equal(horizonOne.nonOverlappingForwardReturn.candidateInference.exploratoryEligible, true);
  assert.equal(horizonOne.nonOverlappingForwardReturn.candidateInference.candidateEligible, false);
  assert.ok(horizonOne.nonOverlappingForwardReturn.candidateInference.candidateBlockers.includes("empirical_null_calibration_required"));
  assert.equal(horizonThree.nonOverlappingForwardReturn.candidateInference.exploratoryEligible, false);
  assert.ok(horizonThree.nonOverlappingForwardReturn.candidateInference.candidateBlockers.includes("candidate_horizon_must_be_1"));
  assert.ok(horizonOne.nonOverlappingForwardReturn.inference.candidateBlockers.includes("candidate_requires_newey_west_inference"));
  assert.ok(horizonOne.forwardReturn.inference.candidateBlockers.includes("candidate_requires_non_overlapping_series"));
});

test("feature-outcome relationships exclude forming bars and preserve irregular intervals as quality evidence", () => {
  const series = bars(Date.UTC(2026, 0, 1), [100, 101, 102, 101, 102, 103, 104, 103, 102, 101]);
  series.at(-1).forming = true;
  series[6].time += HOUR * 6;
  series[6].timeIso = new Date(series[6].time * 1000).toISOString();
  const result = computeFeatureOutcomeRelationships(input(series));
  assert.equal(result.quality.formingBarsExcluded, 1);
  assert.ok(result.quality.irregularIntervals > 0);
  assert.ok(result.qualityIssues.includes("irregular_timestamps_not_forward_filled"));
});

test("feature-outcome relationships retain observed-bar outcomes across a calendar gap", () => {
  const series = bars(Date.UTC(2026, 0, 1), [100, 101, 102, 103, 104, 103, 102, 101, 102, 103, 104, 105]);
  for (let index = 8; index < series.length; index += 1) {
    series[index].time += 48 * HOUR / 1000;
    series[index].timeIso = new Date(series[index].time * 1000).toISOString();
  }
  const result = computeFeatureOutcomeRelationships(input(series, { horizons: [1] }));
  const beforeGap = result.observations.find((row) => row.signalTime === series[7].timeIso);
  assert.ok(beforeGap);
  assert.notEqual(beforeGap.outcomes["1"], null);
  assert.equal(result.quality.irregularIntervals, 1);
});

test("feature-outcome relationships condition only on a predeclared same-bar regime", () => {
  const series = bars(Date.UTC(2026, 0, 1), [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113]);
  const result = computeFeatureOutcomeRelationships(input(series, {
    features: ["range_position"],
    horizons: [1],
    regime: {
      directionalRegime: "trend_up", volatilityRegime: null,
      trendLookback: 2, atrLookback: 2, volatilityBaselineLookback: 5,
      trendEfficiencyThreshold: 0.6, rangeEfficiencyThreshold: 0.25,
      directionalMoveAtrThreshold: 0.5, highVolatilityRatio: 1.5, lowVolatilityRatio: 0.75,
    },
  }));
  assert.ok(result.sample.observations > 0);
  assert.equal(result.quality.regimeExcluded, 0);
  assert.equal(result.definition.regime.directionalRegime, "trend_up");
  assert.equal(result.regimeEvidence.filter.directionalRegime, "trend_up");

  const excluded = computeFeatureOutcomeRelationships(input(series, {
    features: ["range_position"],
    horizons: [1],
    regime: {
      directionalRegime: "range", volatilityRegime: null,
      trendLookback: 2, atrLookback: 2, volatilityBaselineLookback: 5,
      trendEfficiencyThreshold: 0.6, rangeEfficiencyThreshold: 0.25,
      directionalMoveAtrThreshold: 0.5, highVolatilityRatio: 1.5, lowVolatilityRatio: 0.75,
    },
  }));
  assert.equal(excluded.sample.observations, 0);
  assert.ok(excluded.quality.regimeExcluded > 0);
  assert.ok(excluded.qualityIssues.includes("no_observations_match_regime"));
});

test("feature-outcome relationships fix one feature bucket and an inclusive-exclusive signal window", () => {
  const series = bars(Date.UTC(2026, 0, 1), [100, 101, 102, 103, 104, 103, 102, 103, 104, 105, 104, 103, 102, 101]);
  const signalFrom = series[8].timeIso;
  const signalTo = series[12].timeIso;
  const result = computeFeatureOutcomeRelationships(input(series, {
    features: ["body_direction"], horizons: [1], signalFrom, signalTo,
    selection: { feature: "body_direction", bucket: "bullish_body" },
  }));
  assert.deepEqual(result.features, ["body_direction"]);
  assert.deepEqual(result.definition.selection, { feature: "body_direction", bucket: "bullish_body" });
  assert.equal(result.definition.signalFrom, signalFrom);
  assert.equal(result.definition.signalTo, signalTo);
  assert.ok(result.quality.signalBeforeWindowExcluded > 0);
  assert.ok(result.quality.signalAfterWindowExcluded > 0);
  assert.ok(result.quality.featureSelectionExcluded > 0);
  assert.ok(result.sample.observations > 0);
  assert.deepEqual(Object.keys(result.byFeature.body_direction), ["bullish_body"]);
  assert.ok(result.observations.every((row) => row.signalTime >= signalFrom && row.signalTime < signalTo));
  assert.ok(result.observations.every((row) => row.labels.body_direction === "bullish_body"));
  assert.equal(result.selectionContrast.referencePopulation, "same_signal_window_and_regime_before_feature_selection");
  assert.equal(result.selectionContrast.populationsOverlap, true);
  assert.ok(result.selectionContrast.referenceObservations > result.selectionContrast.selectedObservations);
  assert.equal(typeof result.selectionContrast.horizons["1"].meanForwardReturnDifference, "number");
  assert.equal(result.folds.length, 0);
});

test("feature-outcome relationships reject invalid fixed feature buckets and signal windows", () => {
  const series = bars(Date.UTC(2026, 0, 1), [100, 101, 102, 103, 104, 103, 102, 101, 102, 103]);
  assert.throws(() => computeFeatureOutcomeRelationships(input(series, {
    features: ["body_direction"], selection: { feature: "body_direction", bucket: "gap_up" },
  })), /feature selection bucket is invalid/);
  assert.throws(() => computeFeatureOutcomeRelationships(input(series, {
    signalFrom: series[6].timeIso, signalTo: series[6].timeIso,
  })), /signal_to must be after signal_from/);
});

test("feature-outcome relationships report only an empty signal window before later filters", () => {
  const series = bars(Date.UTC(2026, 0, 1), [100, 101, 102, 103, 104, 103, 102, 101, 102, 103]);
  const result = computeFeatureOutcomeRelationships(input(series, {
    features: ["body_direction"], selection: { feature: "body_direction", bucket: "bullish_body" },
    signalFrom: new Date(series.at(-1).time * 1_000 + HOUR).toISOString(),
    regime: {
      directionalRegime: "trend_down", volatilityRegime: null,
      trendLookback: 2, atrLookback: 2, volatilityBaselineLookback: 5,
      trendEfficiencyThreshold: 0.6, rangeEfficiencyThreshold: 0.25,
      directionalMoveAtrThreshold: 0.5, highVolatilityRatio: 1.5, lowVolatilityRatio: 0.75,
    },
  }));
  assert.equal(result.quality.signalWindowEligible, 0);
  assert.ok(result.qualityIssues.includes("no_observations_match_signal_window"));
  assert.equal(result.qualityIssues.includes("no_observations_match_regime"), false);
  assert.equal(result.qualityIssues.includes("no_observations_match_feature_selection"), false);
});

test("feature-outcome relationships expose an insufficient interval instead of inventing precision", () => {
  const series = bars(Date.UTC(2026, 0, 1), [100, 101, 102, 103, 104, 103, 102, 101, 102, 103]);
  const result = computeFeatureOutcomeRelationships(input(series, {
    features: ["body_direction"], horizons: [1], minimumObservations: 1, confidenceLevel: 0.99,
  }));
  const single = Object.values(result.byFeature.body_direction)
    .find((bucket) => bucket.horizons["1"].forwardReturn.count === 1);
  assert.ok(single);
  assert.deepEqual(single.horizons["1"].forwardReturn.meanConfidenceInterval, {
    status: "insufficient_sample", method: "normal_approximation", confidenceLevel: 0.99,
    observations: 1, lower: null, upper: null,
  });
});
