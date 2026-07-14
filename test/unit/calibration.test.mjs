import test from "node:test";
import assert from "node:assert/strict";
import { binaryCalibration } from "../../build/calibration.js";
test("binaryCalibration reports Brier score and observed bin rates", () => {
  const result = binaryCalibration([{ probability: 0.8, outcome: true }, { probability: 0.2, outcome: false }], 2);
  assert.ok(Math.abs(result.brier_score - 0.04) < 1e-12);
  assert.equal(result.bins[1].observed_rate, 1);
});
