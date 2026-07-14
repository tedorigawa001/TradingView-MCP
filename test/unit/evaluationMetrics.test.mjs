import test from "node:test";
import assert from "node:assert/strict";
import { classificationMetrics } from "../../build/evaluationMetrics.js";
test("classificationMetrics returns a labelled confusion matrix", () => {
  const result = classificationMetrics([{ predicted: "up", actual: "up" }, { predicted: "up", actual: "down" }]);
  assert.equal(result.accuracy, 0.5);
  assert.equal(result.confusion.down.up, 1);
});
