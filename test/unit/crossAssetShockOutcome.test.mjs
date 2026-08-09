import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCrossAssetShockOutcomes } from "../../build/crossAssetShockOutcome.js";

const bars = Array.from({ length: 12 }, (_, index) => {
  const close = 100 + index;
  return { time: 1_700_000_000 + index * 900, timeIso: new Date((1_700_000_000 + index * 900) * 1_000).toISOString(), open: close, high: close + 1, low: close - 1, close, volume: 1 };
});

test("cross-asset outcomes measure fixed horizons in shock direction and exclude overlapping states", () => {
  const result = evaluateCrossAssetShockOutcomes({ timeframe: "15", targetSymbol: "OANDA:EURUSD", bars, minimumEventsPerState: 1, eventLimit: 10, states: [
    { time: bars[1].time, state: "cross_asset_confirmed", target_return_bps: 5 },
    { time: bars[2].time, state: "target_only", target_return_bps: -5 },
  ] });
  assert.equal(result.contract.contract_id, "cross_asset_shock_outcome_v1");
  assert.equal(result.quality.overlapping_states_excluded, 1);
  assert.equal(result.by_state.cross_asset_confirmed.horizons["1"].directionalReturn.mean > 0, true);
  assert.equal(result.by_state.target_only.events, 0);
});
