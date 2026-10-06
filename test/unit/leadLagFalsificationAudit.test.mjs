import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLeadLagCandidate, runLeadLagFalsificationAudit } from "../../build/leadLagFalsificationAudit.js";

test("lead/lag falsification audit runs the empirical-null candidate rule on a factor-null pair", () => {
  const result = runLeadLagFalsificationAudit({
    replications: 2,
    firstSeed: 100,
    bars: 300,
    timeframeMinutes: 60,
    nominalAlpha: 0.05,
    maxLagBars: 2,
    minimumObservations: 30,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    folds: [
      { foldId: "first", from: "2006-01-02T00:00:00.000Z", to: "2006-01-08T00:00:00.000Z" },
      { foldId: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-15T00:00:00.000Z" },
    ],
  });
  assert.equal(result.model, "factor_null_pair");
  assert.equal(result.status, "complete");
  assert.equal(result.evaluated, 2);
  assert.equal(result.candidates, 0);
});

test("lead-lag falsification audit pins its own resolved configuration by hash", () => {
  const base = {
    replications: 2, bars: 400, timeframeMinutes: 60, nominalAlpha: 0.05, maxLagBars: 3,
    minimumObservations: 30, confidenceLevel: 0.95, configurationTrials: 1,
    folds: [
      { foldId: "first", from: "2006-01-02T00:00:00.000Z", to: "2006-01-08T00:00:00.000Z" },
      { foldId: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-15T00:00:00.000Z" },
    ],
  };
  const omitted = runLeadLagFalsificationAudit(base);
  assert.equal(omitted.auditDefinition.runner, "lead_lag_falsification_audit_v7");
  assert.match(omitted.auditDefinition.inputHash, /^sha256:[a-f0-9]{64}$/);
  // An omitted seed and rho are still pinned, because the hash is built from resolved values.
  assert.equal(omitted.auditDefinition.input.generation.firstSeed, omitted.firstSeed);
  assert.equal(omitted.auditDefinition.input.generation.rho, omitted.rho);
  assert.deepEqual(omitted.auditDefinition.input.generation.pairStructure, omitted.pairStructure);
  assert.equal(omitted.auditDefinition.input.study.returnStandardization, "causal_prior_20_rms");
  assert.equal(omitted.auditDefinition.input.study.folds.length, 2);
  // Re-running the same configuration reproduces the hash.
  assert.equal(runLeadLagFalsificationAudit(base).auditDefinition.inputHash, omitted.auditDefinition.inputHash);
  // Fold boundaries alone changed an otherwise identical rate, so they must change the hash.
  const movedFold = runLeadLagFalsificationAudit({
    ...base,
    folds: [base.folds[0], { foldId: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-16T00:00:00.000Z" }],
  });
  assert.notEqual(movedFold.auditDefinition.inputHash, omitted.auditDefinition.inputHash);
  const legacy = runLeadLagFalsificationAudit({ ...base, returnStandardization: "none" });
  assert.equal(legacy.auditDefinition.runner, "lead_lag_falsification_audit_v6");
  assert.notEqual(legacy.auditDefinition.inputHash, omitted.auditDefinition.inputHash);
});

test("lead-lag audit records each independent null model and refuses factor rho outside that model", () => {
  const base = {
    replications: 2, firstSeed: 10, bars: 300, timeframeMinutes: 60, nominalAlpha: 0.05, maxLagBars: 2,
    minimumObservations: 30, confidenceLevel: 0.95, configurationTrials: 1,
    folds: [{ foldId: "first", from: "2006-01-02T00:00:00.000Z", to: "2006-01-08T00:00:00.000Z" }, { foldId: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-15T00:00:00.000Z" }],
  };
  for (const model of ["white_noise", "regime_switching_volatility", "bid_ask_bounce"]) {
    const result = runLeadLagFalsificationAudit({ ...base, model });
    assert.equal(result.model, model);
    assert.equal(result.auditDefinition.input.generation.model, model);
    assert.equal(result.auditDefinition.input.generation.rho, null);
  }
  const shared = runLeadLagFalsificationAudit({ ...base, model: "factor_regime_switching_volatility_pair", rho: 0.7 });
  assert.equal(shared.auditDefinition.input.generation.pairStructure.volatilityStateDependence, "shared");
  assert.throws(() => runLeadLagFalsificationAudit({ ...base, model: "white_noise", rho: 0.7 }), /rho is supported only/);
});

test("the runner version names the null and the statistic, not just the code", () => {
  // A rate is quoted with its runner before anyone opens the hash. Two different nulls sharing one
  // name is how a measured rate ends up attributed to a procedure that never produced it.
  const base = {
    replications: 2, firstSeed: 10, bars: 300, timeframeMinutes: 60, nominalAlpha: 0.05, maxLagBars: 2,
    minimumObservations: 30, confidenceLevel: 0.95, configurationTrials: 1,
    folds: [{ foldId: "first", from: "2006-01-02T00:00:00.000Z", to: "2006-01-08T00:00:00.000Z" },
            { foldId: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-15T00:00:00.000Z" }],
  };
  const expected = [
    ["circular_shift", "none", "lead_lag_falsification_audit_v6"],
    ["circular_shift", "causal_prior_20_rms", "lead_lag_falsification_audit_v7"],
    ["block_sign_flip", "none", "lead_lag_falsification_audit_v8"],
    ["block_sign_flip", "causal_prior_20_rms", "lead_lag_falsification_audit_v9"],
  ];
  const hashes = new Set();
  for (const [nullPolicy, returnStandardization, runner] of expected) {
    const result = runLeadLagFalsificationAudit({ ...base, nullPolicy, returnStandardization });
    assert.equal(result.auditDefinition.runner, runner, `${nullPolicy}/${returnStandardization}`);
    assert.equal(result.auditDefinition.input.study.nullPolicy, nullPolicy);
    hashes.add(result.auditDefinition.inputHash);
  }
  // Four distinct procedures, four distinct hashes; neither field alone stands in for the other.
  assert.equal(hashes.size, 4);
});

// BACKLOG 102-15: a draw on which no positive lag could show the statistical gate is not evaluable, not a rejection.
test("lead-lag audit leaves draws too sparse to judge out of the denominator and binds that rule into its hash", () => {
  const base = {
    replications: 3, firstSeed: 10, bars: 300, timeframeMinutes: 60, nominalAlpha: 0.05, maxLagBars: 2,
    minimumObservations: 30, confidenceLevel: 0.95, configurationTrials: 1,
    folds: [{ foldId: "first", from: "2006-01-02T00:00:00.000Z", to: "2006-01-08T00:00:00.000Z" },
            { foldId: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-15T00:00:00.000Z" }],
  };
  // 1000 observations cannot come from 300 bars: no draw is judged, and there is no rate.
  const sparse = runLeadLagFalsificationAudit({ ...base, minimumObservations: 1000 });
  assert.deepEqual([sparse.status, sparse.completed, sparse.evaluated, sparse.notEvaluableSeeds, sparse.observedRate, sparse.exceedsNominalAlpha],
    ["complete", 3, 0, [10, 11, 12], null, false]);
  // Enough data: every draw is judged, and those without a gate are the rejections the rate counts.
  const judged = runLeadLagFalsificationAudit(base);
  assert.deepEqual([judged.evaluated, judged.notEvaluableSeeds, judged.candidates, judged.observedRate], [3, [], 0, 0]);
  assert.equal(judged.auditDefinition.input.decision.notEvaluableDraws, "excluded_from_rate_denominator");
});

test("a lead-lag draw is judged when one positive lag has a correlation, two folds with one, and a complete null", () => {
  const lag = (lagBars, { correlation = 0.1, evaluableFolds = 2, gate = false } = {}) => ({
    lagBars, correlation, foldStability: { evaluableFolds }, inference: { statisticalGateEligible: gate },
  });
  const complete = { status: "complete" };
  assert.equal(evaluateLeadLagCandidate({ empiricalNullCalibration: complete, byLag: [lag(-1), lag(0), lag(1), lag(2)] }), "non_candidate");
  assert.equal(evaluateLeadLagCandidate({ empiricalNullCalibration: complete, byLag: [lag(1, { gate: true })] }), "candidate");
  // One judged positive lag is enough, though the other is not.
  assert.equal(evaluateLeadLagCandidate({ empiricalNullCalibration: complete, byLag: [lag(1, { correlation: null }), lag(2)] }), "non_candidate");
  // Not judged: an empirical null that is missing or not complete, only non-positive lags with a correlation, a positive
  // lag without one, or one with fewer than two folds that have one.
  assert.equal(evaluateLeadLagCandidate({ empiricalNullCalibration: { status: "not_evaluable" }, byLag: [lag(1)] }), "not_evaluable");
  assert.equal(evaluateLeadLagCandidate({ byLag: [lag(1)] }), "not_evaluable");
  assert.equal(evaluateLeadLagCandidate({ empiricalNullCalibration: complete, byLag: [lag(-1), lag(0), lag(1, { correlation: null })] }), "not_evaluable");
  assert.equal(evaluateLeadLagCandidate({ empiricalNullCalibration: complete, byLag: [lag(1, { evaluableFolds: 1 }), lag(2, { evaluableFolds: 0 })] }), "not_evaluable");
});
