import assert from "node:assert/strict";
import test from "node:test";
import { COT_CROWDING_UNWIND_OVERLAY_INPUTS, COT_CROWDING_UNWIND_OVERLAY_NAME, COT_CROWDING_UNWIND_OVERLAY_SOURCE } from "../../build/cotCrowdingUnwindOverlay.js";

test("COT crowding overlay makes its source inputs and non-order-flow boundary explicit", () => {
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, new RegExp(`indicator\\(\"${COT_CROWDING_UNWIND_OVERLAY_NAME}`));
  assert.deepEqual(COT_CROWDING_UNWIND_OVERLAY_INPUTS.map((input) => input.name), ["COT Percentile (3Y)", "Target Net OI Ratio %", "COT Report Date", "COT Available At", "Structure Lookback", "Show Context Table", "Volume Profile POC", "Volume Profile VAH", "Volume Profile VAL", "Volume Profile Trading Day", "Volume Profile Type", "Direct COT Futures Currency", "Direct COT Futures % / Percentile"]);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /COT values are explicit MCP inputs/);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /longUnwindProxy = barstate\.islast/);
  assert.doesNotMatch(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /plot\(support/);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /table\.new\(position\.bottom_right, 2, 8/);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /COT \+ Volume Context/);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /Volume Profile POC/);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /Direct COT Futures Currency/);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /exchange volume/);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /20D support \/ resist/);
  assert.match(COT_CROWDING_UNWIND_OVERLAY_SOURCE, /COT unwind/);
});
