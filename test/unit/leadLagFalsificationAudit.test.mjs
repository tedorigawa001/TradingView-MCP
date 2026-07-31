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
