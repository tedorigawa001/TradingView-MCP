import assert from "node:assert/strict";
import test from "node:test";
import {
  injectBodyDirectionEffect,
  runFeatureOutcomePowerAudit,
} from "../../build/featureOutcomePowerAudit.js";
import { computeFeatureOutcomeRelationships } from "../../build/featureOutcomeRelationships.js";
import { generateSyntheticNullSeries } from "../../build/syntheticNullSeries.js";

const study = {
  timeframe: "60",
  features: ["body_direction"], selection: null, signalFrom: null, signalTo: null,
  atrLookback: 2, atrBaselineLookback: 5, rangeLookback: 3, streakMinimumBars: 2,
  bodyRatioThreshold: 0.2, wickImbalanceThreshold: 0.2,
  atrCompressionLowRatio: 0.8, atrCompressionHighRatio: 1.2,
  rangePositionLower: 0.33, rangePositionUpper: 0.67, gapAtrThreshold: 0.2,
  horizons: [1, 3], minimumObservations: 10, minimumEffectBps: 10, folds: [], regime: null,
  observationLimit: 500, confidenceLevel: 0.95, configurationTrials: 1,
};

test("body-direction effect injection preserves signal labels and shifts only following returns", () => {
  const bars = generateSyntheticNullSeries({
    model: "white_noise", bars: 200, seed: 17, timeframeMinutes: 60,
  });
  const injected = injectBodyDirectionEffect(bars, {
    bucket: "bullish_body", effectBps: 25, bodyRatioThreshold: 0.2,
  });
  const classify = (series) => computeFeatureOutcomeRelationships({
    ...study, bars: series, symbol: "SYNTH:POWER", empiricalNullCalibration: false,
  });
  const before = classify(bars);
  const after = classify(injected);
  assert.deepEqual(
    after.observations.map((row) => row.labels.body_direction),
    before.observations.map((row) => row.labels.body_direction),
  );
  const beforeBullish = before.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.mean;
  const afterBullish = after.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.mean;
  assert.ok(afterBullish > beforeBullish + 0.002);
});

test("feature-outcome power audit measures target-direction candidate detection reproducibly", () => {
  const input = {
    audit: {
      model: "white_noise", replications: 3, firstSeed: 20, bars: 500,
      timeframeMinutes: 60, nominalAlpha: 0.05,
    },
    study,
    injection: { feature: "body_direction", bucket: "bullish_body", effectBps: 100 },
  };
  const first = runFeatureOutcomePowerAudit(input);
  const again = runFeatureOutcomePowerAudit(input);
  assert.equal(first.methodologyVersion, "feature_outcome_power_audit_v1");
  assert.deepEqual(first.studyDefinition.features, ["body_direction"]);
  assert.equal(first.studyDefinition.empiricalNullCalibration, true);
  assert.equal(first.audit.evaluated, 3);
  assert.ok(first.audit.detections > 0);
  assert.deepEqual(first.audit.detectedSeeds, again.audit.detectedSeeds);
  assert.equal(first.audit.missRate, 1 - first.audit.detectionRate);
});

test("feature-outcome power audit rejects an absent target feature and zero effect", () => {
  const base = {
    audit: {
      model: "white_noise", replications: 1, bars: 500,
      timeframeMinutes: 60, nominalAlpha: 0.05,
    },
    study,
    injection: { feature: "body_direction", bucket: "bullish_body", effectBps: 10 },
  };
  assert.throws(() => runFeatureOutcomePowerAudit({
    ...base, study: { ...study, features: ["wick_imbalance"] },
  }), /study features must include body_direction/);
  assert.throws(() => runFeatureOutcomePowerAudit({
    ...base, injection: { ...base.injection, effectBps: 0 },
  }), /effect bps must be non-zero/);
});
