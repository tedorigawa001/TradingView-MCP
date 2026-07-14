import test from "node:test";
import assert from "node:assert/strict";
import { computeRoundTripCost } from "../../build/costModel.js";

test("computeRoundTripCost keeps spread, slippage and commission assumptions explicit", () => {
  const cost = computeRoundTripCost({ symbol: "OANDA:EURUSD", bid: 1.1, ask: 1.1002, quantity: 100000, commission_per_unit: 0.00001, slippage_pips_per_side: 0.5 });
  assert.ok(Math.abs(cost.spread_pips - 2) < 1e-12);
  assert.equal(cost.slippage_pips_round_trip, 1);
  assert.ok(cost.total_quote_currency > 0);
});
