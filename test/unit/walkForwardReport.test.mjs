import test from "node:test";
import assert from "node:assert/strict";
import { buildWalkForwardReport } from "../../build/walkForwardReport.js";
test("walk-forward report keeps fold metrics separate", () => {
  const r = buildWalkForwardReport([{ id: "f1", labels: [{ predicted: "up", actual: "up" }], probabilities: [{ probability: 0.8, outcome: true }] }]);
  assert.equal(r.total_folds, 1); assert.equal(r.folds[0].metrics.accuracy, 1);
});
