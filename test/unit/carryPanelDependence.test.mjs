import assert from "node:assert/strict";
import test from "node:test";
import { measureCarryPanelDependence } from "../../build/carryPanelDependence.js";

const bars = (multiplier) => Array.from({ length: 80 }, (_, index) => ({
  timeIso: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
  close: 100 * Math.exp(multiplier * (index + Math.sin(index * 0.9))),
}));

test("carry panel dependence measures aligned price-return correlation and bootstrap design effect", () => {
  const result = measureCarryPanelDependence({
    series: [
      { pair_id: "EURUSD", return_sign: 1, bars: bars(0.001) },
      { pair_id: "GBPUSD", return_sign: 1, bars: bars(0.0011) },
    ], horizonBusinessDays: 5, blockLengthAnchors: 1, iterations: 500, seed: "panel-dependence-fixed",
  });
  assert.equal(result.common_price_dates, 80);
  assert.equal(result.non_overlapping_anchors, 15);
  assert.equal(result.pairwise_correlations.length, 1);
  assert.ok(result.average_pairwise_correlation > 0.99);
  assert.ok(result.cross_sectional_design_effect > 1.9);
  assert.ok(result.bootstrap.effective_observations < result.bootstrap.nominal_observations);
});
