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
    horizons: [1, 3], minimumObservations: 2, folds: [], observationLimit: 50,
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
  assert.ok(result.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.count > 0);
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
