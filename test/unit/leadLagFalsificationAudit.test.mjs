import assert from "node:assert/strict";
import test from "node:test";
import { runLeadLagFalsificationAudit } from "../../build/leadLagFalsificationAudit.js";

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
  assert.equal(omitted.auditDefinition.runner, "lead_lag_falsification_audit_v3");
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
  assert.equal(legacy.auditDefinition.runner, "lead_lag_falsification_audit_v2");
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
