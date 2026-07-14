import test from "node:test";
import assert from "node:assert/strict";
import { labelFutureReturn } from "../../build/outcomeLabel.js";

test("labelFutureReturn uses a fixed symmetric basis-point threshold", () => {
  assert.equal(labelFutureReturn({ entry_price: 100, exit_price: 100.2, threshold_bps: 10 }).label, "up");
  assert.equal(labelFutureReturn({ entry_price: 100, exit_price: 99.8, threshold_bps: 10 }).label, "down");
  assert.equal(labelFutureReturn({ entry_price: 100, exit_price: 100.05, threshold_bps: 10 }).label, "flat");
});
