import assert from "node:assert/strict";
import test from "node:test";
import { runFeatureOutcomeFalsificationAudit } from "../../build/featureOutcomeFalsificationAudit.js";

const study = {
  timeframe: "60",
  features: ["body_direction"], selection: null, signalFrom: null, signalTo: null,
  atrLookback: 2, atrBaselineLookback: 5, rangeLookback: 3, streakMinimumBars: 2,
  bodyRatioThreshold: 0.2, wickImbalanceThreshold: 0.2,
  atrCompressionLowRatio: 0.8, atrCompressionHighRatio: 1.2,
  rangePositionLower: 0.33, rangePositionUpper: 0.67, gapAtrThreshold: 0.2,
  horizons: [1, 3], minimumObservations: 10, minimumEffectBps: 10, folds: [], regime: null,
  observationLimit: 0, confidenceLevel: 0.95, configurationTrials: 1,
};

test("feature-outcome falsification audit uses the empirical-null candidate gate reproducibly", () => {
  const input = {
    audit: { model: "white_noise", replications: 4, firstSeed: 30, bars: 500,
      timeframeMinutes: 60, nominalAlpha: 0.05 },
    study,
  };
  const first = runFeatureOutcomeFalsificationAudit(input);
  const again = runFeatureOutcomeFalsificationAudit(input);
  assert.equal(first.methodologyVersion, "feature_outcome_falsification_audit_v2");
  assert.equal(first.candidateRule.horizon, 1);
  assert.equal(first.candidateRule.evidence,
    "non_overlapping_newey_west_bonferroni_and_empirical_null_candidate_eligibility");
  assert.equal(first.candidateRule.empiricalNullIterations, 1000);
  assert.equal(first.audit.evaluated, 4);
  assert.deepEqual(first.audit.candidateSeeds, again.audit.candidateSeeds);
});

test("feature-outcome falsification audit does not count an exploratory-only seed as a candidate", () => {
  const result = runFeatureOutcomeFalsificationAudit({
    audit: { model: "white_noise", replications: 1, firstSeed: 39, bars: 500,
      timeframeMinutes: 60, nominalAlpha: 0.05 },
    study,
  });
  assert.equal(result.audit.evaluated, 1);
  assert.equal(result.audit.candidates, 0);
  assert.deepEqual(result.audit.candidateSeeds, []);
});

test("feature-outcome falsification audit refuses a candidate rule without horizon one", () => {
  assert.throws(() => runFeatureOutcomeFalsificationAudit({
    audit: { model: "white_noise", replications: 1, bars: 500, timeframeMinutes: 60, nominalAlpha: 0.05 },
    study: { ...study, horizons: [3] },
  }), /requires horizon 1/);
});

test("feature-outcome falsification audit binds nominal alpha to the candidate confidence level", () => {
  assert.throws(() => runFeatureOutcomeFalsificationAudit({
    audit: { model: "white_noise", replications: 1, bars: 500, timeframeMinutes: 60, nominalAlpha: 0.1 },
    study,
  }), /nominal alpha must equal 1 - confidence level/);
});
