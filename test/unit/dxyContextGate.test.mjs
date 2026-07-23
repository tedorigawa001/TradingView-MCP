import assert from "node:assert/strict";
import test from "node:test";
import {
  DXY_CONTEXT_GATE_NAME,
  DXY_CONTEXT_GATE_SOURCE,
} from "../../build/dxyContextGate.js";

test("DXY context gate computes the return inside confirmed lookahead-off security evidence", () => {
  assert.equal(DXY_CONTEXT_GATE_NAME, "Bushido DXY Context Gate v1");
  assert.match(DXY_CONTEXT_GATE_SOURCE, /request\.security\("TVC:DXY", "D"/);
  assert.match(DXY_CONTEXT_GATE_SOURCE, /barmerge\.gaps_on/);
  assert.match(DXY_CONTEXT_GATE_SOURCE, /barmerge\.lookahead_off/);
  assert.match(DXY_CONTEXT_GATE_SOURCE, /barstate\.isconfirmed \? close \/ close\[20\] - 1\.0 : na/);
  assert.match(DXY_CONTEXT_GATE_SOURCE, /dxyReturn20 >= 0 \? 1\.0 : 0\.0/);
  assert.doesNotMatch(DXY_CONTEXT_GATE_SOURCE, /barmerge\.gaps_off/);
});
