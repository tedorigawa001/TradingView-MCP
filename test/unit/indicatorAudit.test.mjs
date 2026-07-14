import test from "node:test";
import assert from "node:assert/strict";
import { compareIndicatorObservations } from "../../build/indicatorAudit.js";

const base = {
  study_id: "st1",
  symbol: "OANDA:EURUSD",
  resolution: "60",
  bars: [
    { time: 100, values: { Signal: 1, Label: "UP" } },
    { time: 200, values: { Signal: 2, Label: "UP" } },
  ],
};

test("compareIndicatorObservations accepts stable closed-bar values within epsilon", () => {
  const result = compareIndicatorObservations(base, { ...base, bars: [{ time: 100, values: { Signal: 1 + 1e-12, Label: "UP" } }, base.bars[1]] });
  assert.equal(result.status, "stable");
  assert.equal(result.matched_bars, 2);
});

test("compareIndicatorObservations reports changed values and incompatible inputs", () => {
  const changed = compareIndicatorObservations(base, { ...base, bars: [{ time: 100, values: { Signal: 3, Label: "UP" } }] });
  assert.equal(changed.status, "changed");
  assert.deepEqual(changed.changed_values[0], { time: 100, plot: "Signal", before: 1, after: 3 });
  assert.equal(compareIndicatorObservations(base, { ...base, resolution: "15" }).status, "incompatible");
});
