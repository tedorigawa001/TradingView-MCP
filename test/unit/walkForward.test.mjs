import test from "node:test";
import assert from "node:assert/strict";
import { createWalkForwardSplits } from "../../build/walkForward.js";
test("walk-forward splits embargo future-adjacent observations", () => {
  assert.deepEqual(createWalkForwardSplits({ length: 12, train_size: 5, test_size: 2, embargo: 1 })[0], { train: [0, 4], embargo: [5, 5], test: [6, 7] });
});
