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
    horizons: [1, 3], minimumObservations: 2, minimumEffectBps: 10, folds: [], regime: null, observationLimit: 50,
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
    features: ["body_direction"], horizons: [1, 3], minimumObservations: 2, minimumEffectBps: 10,
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

test("feature-outcome empirical null block bootstrap is deterministic and bound to the supplied bars", () => {
  let price = 100;
  let state = 0x12345678;
  let priorDirection = 1;
  let priorMagnitude = 0.004;
  const start = Date.UTC(2026, 0, 1);
  const series = Array.from({ length: 400 }, (_, index) => {
    const open = price;
    price *= 1 + priorDirection * priorMagnitude;
    const close = price;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const direction = (state & 1) === 0 ? -1 : 1;
    priorDirection = direction;
    priorMagnitude = 0.003 + ((state >>> 1) % 3) * 0.001;
    const time = start + index * HOUR;
    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    return {
      time: time / 1000, timeIso: new Date(time).toISOString(), open, close,
      high: bodyHigh + (direction < 0 ? 1.2 : 0.1),
      low: bodyLow - (direction > 0 ? 1.2 : 0.1),
      volume: 1,
    };
  });
  const definition = input(series, {
    features: ["wick_imbalance"], horizons: [1], minimumObservations: 50, minimumEffectBps: 10,
    observationLimit: 0, empiricalNullCalibration: true,
  });
  const first = computeFeatureOutcomeRelationships(definition);
  const again = computeFeatureOutcomeRelationships(definition);
  assert.equal(first.empiricalNullCalibration.methodologyVersion,
    "feature_outcome_empirical_null_circular_moving_block_v2");
  assert.equal(first.empiricalNullCalibration.iterations, 1000);
  assert.equal(first.empiricalNullCalibration.seed, 20260729);
  assert.ok(first.empiricalNullCalibration.blockLength >= 2);
  assert.match(first.empiricalNullCalibration.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.empiricalNullCalibration.calibrationId, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(first.empiricalNullCalibration, again.empiricalNullCalibration);

  const lowerWick = first.byFeature.wick_imbalance.lower_wick_dominant.horizons["1"]
    .nonOverlappingForwardReturn.candidateInference;
  assert.equal(lowerWick.empiricalNullCalibration.status, "available");
  assert.ok(lowerWick.empiricalNullCalibration.familyWisePValue <= 0.05);
  assert.equal(lowerWick.empiricalNullCalibration.passes, true);
  assert.equal(lowerWick.candidateEligible, true);
  assert.deepEqual(lowerWick.candidateBlockers, []);

  const changed = structuredClone(series);
  changed[100].high += 0.01;
  const changedResult = computeFeatureOutcomeRelationships(input(changed, {
    features: ["wick_imbalance"], horizons: [1], minimumObservations: 50, minimumEffectBps: 10,
    observationLimit: 0, empiricalNullCalibration: true,
  }));
  assert.notEqual(changedResult.empiricalNullCalibration.evidenceHash,
    first.empiricalNullCalibration.evidenceHash);
  assert.notEqual(changedResult.empiricalNullCalibration.calibrationId,
    first.empiricalNullCalibration.calibrationId);
});

test("feature-outcome empirical null does not promote an unconditional drift", () => {
  const series = bars(Date.UTC(2026, 0, 1),
    Array.from({ length: 300 }, (_, index) => 100 + index));
  const result = computeFeatureOutcomeRelationships(input(series, {
    features: ["body_direction"], horizons: [1], minimumObservations: 50, minimumEffectBps: 10,
    observationLimit: 0, empiricalNullCalibration: true,
  }));
  const inference = result.byFeature.body_direction.bullish_body.horizons["1"]
    .nonOverlappingForwardReturn.candidateInference;
  assert.equal(inference.exploratoryEligible, true);
  assert.equal(inference.empiricalNullCalibration.status, "available");
  assert.equal(inference.empiricalNullCalibration.passes, false);
  assert.equal(inference.candidateEligible, false);
  assert.ok(inference.candidateBlockers.includes("empirical_null_family_wise_threshold_not_met"));
});

test("feature-outcome empirical null treats a nonzero constant-return bucket as non-studentizable", () => {
  const start = Date.UTC(2026, 0, 1);
  const series = Array.from({ length: 60 }, (_, index) => {
    const open = 2 ** index;
    const close = 2 ** (index + 1);
    const time = start + index * HOUR;
    return {
      time: time / 1000, timeIso: new Date(time).toISOString(),
      open, high: close, low: open, close, volume: 1,
    };
  });
  const result = computeFeatureOutcomeRelationships(input(series, {
    features: ["body_direction"], horizons: [1], minimumObservations: 20, minimumEffectBps: 10,
    observationLimit: 0, empiricalNullCalibration: true,
  }));
  const calibration = result.byFeature.body_direction.bullish_body.horizons["1"]
    .nonOverlappingForwardReturn.candidateInference.empiricalNullCalibration;
  assert.equal(calibration.status, "insufficient_sample");
  assert.equal(calibration.observedStatistic, null);
  assert.equal(result.empiricalNullCalibration.status, "not_evaluable");
});

test("feature-outcome empirical null excludes buckets below the candidate sample floor from its family maximum", () => {
  const start = Date.UTC(2026, 0, 1);
  let price = 100;
  const series = Array.from({ length: 300 }, (_, index) => {
    const open = price;
    const direction = index > 0 && index % 20 === 0 ? -1 : 1;
    const close = open * (1 + direction * 0.005);
    price = close;
    const time = start + index * HOUR;
    return {
      time: time / 1000, timeIso: new Date(time).toISOString(),
      open, high: Math.max(open, close) + 0.01, low: Math.min(open, close) - 0.01, close, volume: 1,
    };
  });
  const result = computeFeatureOutcomeRelationships(input(series, {
    features: ["body_direction"], horizons: [1], minimumObservations: 50, minimumEffectBps: 10,
    observationLimit: 0, empiricalNullCalibration: true,
  }));
  assert.equal(result.empiricalNullCalibration.familyEligibleBuckets, 1);
  assert.equal(result.empiricalNullCalibration.familyExcludedInsufficientSampleBuckets, 1);
  assert.equal(result.byFeature.body_direction.bearish_body.horizons["1"]
    .nonOverlappingForwardReturn.candidateInference.empiricalNullCalibration.status, "insufficient_sample");
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
    empiricalNullCalibration: true,
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
  assert.ok(result.empiricalNullCalibration.source.referenceEligibleObservations >
    result.empiricalNullCalibration.source.selectedEligibleObservations);
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
  assert.throws(() => computeFeatureOutcomeRelationships(input(series, {
    horizons: [3], empiricalNullCalibration: true,
  })), /empirical null calibration requires horizon 1/);
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
    features: ["body_direction"], horizons: [1], minimumObservations: 1, minimumEffectBps: 10, confidenceLevel: 0.99,
  }));
  const single = Object.values(result.byFeature.body_direction)
    .find((bucket) => bucket.horizons["1"].forwardReturn.count === 1);
  assert.ok(single);
  assert.deepEqual(single.horizons["1"].forwardReturn.meanConfidenceInterval, {
    status: "insufficient_sample", method: "normal_approximation", confidenceLevel: 0.99,
    observations: 1, lower: null, upper: null,
  });
});

test("a bucket large enough to overflow a spread still reports its extremes", () => {
  // Spreading a bucket into Math.min throws RangeError past roughly a hundred thousand elements.
  // A 261,141-bar sample reached that on the first real run, so the size is pinned here.
  const bars = [];
  let price = 1.1;
  for (let index = 0; index < 140_000; index += 1) {
    const open = price;
    price = price * (1 + (index % 7 === 0 ? 0.0004 : -0.0002));
    const close = price;
    bars.push({
      time: 1_600_000_000 + index * 900,
      timeIso: new Date((1_600_000_000 + index * 900) * 1000).toISOString(),
      open, high: Math.max(open, close) * 1.0002, low: Math.min(open, close) * 0.9998, close, volume: 10,
    });
  }
  const result = computeFeatureOutcomeRelationships({
    bars, symbol: "SYNTH:LARGE", timeframe: "15", features: ["body_direction"],
    selection: null, signalFrom: null, signalTo: null,
    atrLookback: 14, atrBaselineLookback: 50, rangeLookback: 20, streakMinimumBars: 3,
    bodyRatioThreshold: 0.5, wickImbalanceThreshold: 0.6,
    atrCompressionLowRatio: 0.8, atrCompressionHighRatio: 1.2,
    rangePositionLower: 0.33, rangePositionUpper: 0.67, gapAtrThreshold: 0.5,
    horizons: [1], minimumObservations: 30, minimumEffectBps: 10, folds: [], regime: null,
    observationLimit: 0, confidenceLevel: 0.95, configurationTrials: 1,
  });
  const bucket = Object.values(result.byFeature.body_direction)
    .find((entry) => entry.observations > 100_000);
  assert.ok(bucket, "expected one bucket past the spread limit");
  const summary = bucket.horizons["1"].forwardReturn;
  assert.equal(typeof summary.minimum, "number");
  assert.equal(typeof summary.maximum, "number");
  assert.ok(summary.minimum <= summary.maximum);
});

test("a bucket below the minimum effect size is refused however significant it is", () => {
  // The first real candidates were all under a fifth of the spread they would have to cross, and
  // a large enough sample drives an extreme p-value for an effect that small. Significance
  // reports that an effect exists and never how large it is, so the floor is separate.
  const bars = [];
  let price = 1.1;
  for (let index = 0; index < 4000; index += 1) {
    const open = price;
    // A tiny, highly consistent alternation: significant on this many bars, far under 10 bps.
    price = price * (1 + (index % 2 === 0 ? 0.00002 : -0.000015));
    const close = price;
    bars.push({
      time: 1_600_000_000 + index * 900,
      timeIso: new Date((1_600_000_000 + index * 900) * 1000).toISOString(),
      open, high: Math.max(open, close) * 1.00005, low: Math.min(open, close) * 0.99995, close, volume: 5,
    });
  }
  const run = (minimumEffectBps) => computeFeatureOutcomeRelationships({
    bars, symbol: "SYNTH:FLOOR", timeframe: "15", features: ["body_direction"],
    selection: null, signalFrom: null, signalTo: null,
    atrLookback: 14, atrBaselineLookback: 50, rangeLookback: 20, streakMinimumBars: 3,
    bodyRatioThreshold: 0.5, wickImbalanceThreshold: 0.6,
    atrCompressionLowRatio: 0.8, atrCompressionHighRatio: 1.2,
    rangePositionLower: 0.33, rangePositionUpper: 0.67, gapAtrThreshold: 0.5,
    horizons: [1], minimumObservations: 30, minimumEffectBps, folds: [], regime: null,
    observationLimit: 0, confidenceLevel: 0.95, configurationTrials: 1,
    empiricalNullCalibration: true,
  });
  const pick = (result) => Object.values(result.byFeature.body_direction)
    .map((entry) => entry.horizons["1"].nonOverlappingForwardReturn.candidateInference)
    .filter((inference) => inference !== undefined);
  const floored = pick(run(10));
  assert.ok(floored.length > 0);
  for (const inference of floored) {
    assert.equal(inference.candidateEligible, false);
    assert.equal(typeof inference.effectBps, "number");
    if (Math.abs(inference.effectBps) < 10) {
      assert.ok(inference.candidateBlockers.includes("minimum_effect_size_not_met"));
    }
  }
  // The floor is a frozen rule, not a knob: relaxing it per call is refused outright, so a caller
  // cannot record sub-floor candidates by passing zero.
  assert.throws(() => run(0), /frozen pre-registered rule/);
  assert.throws(() => run(5), /frozen pre-registered rule/);
});

test("the minimum effect size cannot be omitted into a rule without a floor", () => {
  const bars = [{ time: 1, timeIso: "2024-01-01T00:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  assert.throws(() => computeFeatureOutcomeRelationships({
    bars, symbol: "S", timeframe: "15", features: ["body_direction"], selection: null,
    signalFrom: null, signalTo: null, atrLookback: 14, atrBaselineLookback: 50, rangeLookback: 20,
    streakMinimumBars: 3, bodyRatioThreshold: 0.5, wickImbalanceThreshold: 0.6,
    atrCompressionLowRatio: 0.8, atrCompressionHighRatio: 1.2, rangePositionLower: 0.33,
    rangePositionUpper: 0.67, gapAtrThreshold: 0.5, horizons: [1], minimumObservations: 30,
    folds: [], regime: null, observationLimit: 0,
  }), /frozen pre-registered rule/);
});
