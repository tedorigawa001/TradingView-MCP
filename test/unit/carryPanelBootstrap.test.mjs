import assert from "node:assert/strict";
import test from "node:test";
import { estimateCarryPanelEffectiveSample } from "../../build/carryPanelBootstrap.js";

const observations = Array.from({ length: 60 }, (_, index) => {
  const anchor_date = new Date(Date.UTC(2020, 0, 1 + index * 7)).toISOString().slice(0, 10);
  const value = Math.sin(index * 0.71) + index / 100;
  return [
    { anchor_date, pair_id: "EURUSD", carry_return: value },
    { anchor_date, pair_id: "GBPUSD", carry_return: value },
  ];
}).flat();

test("carry panel bootstrap keeps same-date pairs together and reports a deterministic effective sample", () => {
  const input = { observations, blockLengthAnchors: 1, iterations: 2_000, seed: "carry-panel-fixed" };
  const first = estimateCarryPanelEffectiveSample(input);
  const second = estimateCarryPanelEffectiveSample({ ...input, observations: [...observations].reverse() });
  assert.deepEqual(first, second);
  assert.equal(first.nominal_observations, 120);
  assert.equal(first.anchor_clusters, 60);
  assert.equal(first.pair_count, 2);
  assert.ok(first.design_effect > 1.5);
  assert.ok(first.effective_observations > 45 && first.effective_observations < 75);
});

test("carry panel bootstrap rejects duplicate pair evidence within an anchor", () => {
  assert.throws(() => estimateCarryPanelEffectiveSample({
    observations: [...observations.slice(0, 11), observations[0]], blockLengthAnchors: 1, iterations: 100, seed: "fixed",
  }), /unique per anchor_date and pair_id/);
});
