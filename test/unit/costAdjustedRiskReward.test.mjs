import test from "node:test";
import assert from "node:assert/strict";
import { computeCostAdjustedRiskReward } from "../../build/costAdjustedRiskReward.js";

const base = {
  symbol: "EXAMPLE:ASSET",
  direction: "long",
  price_basis: "mid",
  price_unit: "quote currency per asset unit",
  entry_price: 100,
  stop_price: 95,
  target_price: 110,
  bid: 99.9,
  ask: 100.1,
  entry_slippage_price: 0.1,
  stop_slippage_price: 0.2,
  target_slippage_price: 0.05,
  round_trip_fee_price: 0.04,
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("long mid-price scenario includes spread once, adverse slippage per leg and one round-trip fee", () => {
  const r = computeCostAdjustedRiskReward(base);
  assert.equal(r.status, "computed");
  assert.equal(r.candidateEligible, false);
  assert.equal(r.price_unit, base.price_unit);
  near(r.fills.entry.modeled_price, 100.2);
  near(r.fills.stop.modeled_price, 94.7);
  near(r.fills.target.modeled_price, 109.85);
  assert.equal(r.fills.entry.quote_side, "ask");
  assert.equal(r.fills.stop.quote_side, "bid");
  near(r.gross.reward_to_risk, 2);
  near(r.costs.stop_round_trip_price, 0.54);
  near(r.costs.target_round_trip_price, 0.39);
  near(r.net.loss_at_stop_price, 5.54);
  near(r.net.profit_at_target_price, 9.61);
  near(r.net.reward_to_risk, 9.61 / 5.54);
  assert.equal(r.net.target_profitable_after_costs, true);
  assert.equal(r.quote.source, "caller_supplied");
  assert.equal(r.quote.freshness_verified, false);
});

test("both directions and all four explicit price bases produce the expected quote-side fills", () => {
  const cases = [
    ["long", "mid", 100.2, 94.7, 109.85],
    ["long", "bid", 100.3, 94.8, 109.95],
    ["long", "ask", 100.1, 94.6, 109.75],
    ["long", "executable", 100.1, 94.8, 109.95],
    ["short", "mid", 99.8, 105.3, 90.15],
    ["short", "bid", 99.9, 105.4, 90.25],
    ["short", "ask", 99.7, 105.2, 90.05],
    ["short", "executable", 99.9, 105.2, 90.05],
  ];
  for (const [direction, price_basis, entry, stop, target] of cases) {
    const r = computeCostAdjustedRiskReward({
      ...base, direction, price_basis,
      stop_price: direction === "long" ? 95 : 105,
      target_price: direction === "long" ? 110 : 90,
    });
    near(r.fills.entry.modeled_price, entry);
    near(r.fills.stop.modeled_price, stop);
    near(r.fills.target.modeled_price, target);
    const sign = direction === "long" ? 1 : -1;
    near(r.net.loss_at_stop_price, sign * (entry - stop) + base.round_trip_fee_price);
    near(r.net.profit_at_target_price, sign * (target - entry) - base.round_trip_fee_price);
    near(r.costs.applied_spread_price, price_basis === "executable" ? 0 : 0.2);
    near(r.net.loss_at_stop_price, price_basis === "executable" ? 5.34 : 5.54);
    near(r.net.profit_at_target_price, price_basis === "executable" ? 9.81 : 9.61);
    assert.equal(r.fills.entry.quote_side, direction === "long" ? "ask" : "bid");
    assert.equal(r.fills.target.quote_side, direction === "long" ? "bid" : "ask");
  }
});

test("executable-side levels never add the indicative spread again", () => {
  const narrow = computeCostAdjustedRiskReward({ ...base, price_basis: "executable" });
  const wide = computeCostAdjustedRiskReward({ ...base, price_basis: "executable", bid: 90, ask: 110 });
  assert.deepEqual(wide.net, narrow.net);
  assert.deepEqual(wide.fills, narrow.fills);
  assert.equal(wide.quote.used_for_spread_adjustment, false);
  assert.notEqual(wide.quote.spread_price, narrow.quote.spread_price);
});

test("zero and negative net target profits and their ratios remain visible", () => {
  const zeroCosts = { entry_slippage_price: 0, stop_slippage_price: 0, target_slippage_price: 0, round_trip_fee_price: 0 };
  const input = { ...base, ...zeroCosts, bid: 99.5, ask: 100.5, target_price: 101 };
  const flat = computeCostAdjustedRiskReward(input);
  assert.equal(flat.net.profit_at_target_price, 0);
  assert.equal(flat.net.reward_to_risk, 0);
  assert.equal(flat.net.target_profitable_after_costs, false);
  const negative = computeCostAdjustedRiskReward({ ...input, round_trip_fee_price: 0.25 });
  near(negative.net.profit_at_target_price, -0.25);
  near(negative.net.reward_to_risk, -0.04);
  assert.equal(negative.net.target_profitable_after_costs, false);
});

test("no spread or costs restores gross RR; no pip registry, quantity or money conversion is required", () => {
  for (const symbol of ["PEPPERSTONE:MXNJPY", "OANDA:XAUUSD", "CUSTOM:UNKNOWN"]) {
    const input = { ...base, symbol, bid: 100, ask: 100, entry_slippage_price: 0, stop_slippage_price: 0, target_slippage_price: 0, round_trip_fee_price: 0 };
    const result = computeCostAdjustedRiskReward(input);
    near(result.net.reward_to_risk, 2);
    assert.deepEqual(computeCostAdjustedRiskReward(input), result, "identical inputs must be deterministic");
    assert.equal("quantity" in result, false);
    assert.equal("account_currency" in result, false);
  }
});

test("each cost component has only the declared effect and is not silently defaulted", () => {
  const r = computeCostAdjustedRiskReward(base);
  const stop = computeCostAdjustedRiskReward({ ...base, stop_slippage_price: 0.7 });
  near(stop.net.loss_at_stop_price - r.net.loss_at_stop_price, 0.5);
  near(stop.net.profit_at_target_price, r.net.profit_at_target_price);
  const target = computeCostAdjustedRiskReward({ ...base, target_slippage_price: 0.55 });
  near(r.net.profit_at_target_price - target.net.profit_at_target_price, 0.5);
  near(target.net.loss_at_stop_price, r.net.loss_at_stop_price);
  const entry = computeCostAdjustedRiskReward({ ...base, entry_slippage_price: 0.6 });
  near(entry.net.loss_at_stop_price - r.net.loss_at_stop_price, 0.5);
  near(r.net.profit_at_target_price - entry.net.profit_at_target_price, 0.5);
  for (const key of ["entry_slippage_price", "stop_slippage_price", "target_slippage_price", "round_trip_fee_price"]) {
    const missing = { ...base };
    delete missing[key];
    assert.throws(() => computeCostAdjustedRiskReward(missing), /explicit non-negative/);
  }
});

test("invalid geometry, crossed quotes, units and non-finite or negative inputs are rejected", () => {
  for (const patch of [
    { direction: "neutral" }, { price_basis: "last" }, { price_basis: undefined },
    { symbol: "" }, { symbol: "bad symbol" }, { price_unit: "" }, { price_unit: "x\ny" }, { price_unit: "x".repeat(81) },
    { ask: 99 }, { entry_price: 0 }, { stop_price: 100 }, { target_price: 100 },
    { stop_price: 105 }, { target_price: 95 }, { direction: "short" },
    { bid: NaN }, { ask: Infinity }, { entry_slippage_price: -1 },
    { stop_slippage_price: NaN }, { target_slippage_price: Infinity }, { round_trip_fee_price: -0.1 },
    { stop_slippage_price: 1000 },
  ]) assert.throws(() => computeCostAdjustedRiskReward({ ...base, ...patch }), JSON.stringify(patch));
});

test("overflow cannot become a JSON null that looks like a valid computed ratio", () => {
  assert.throws(() => computeCostAdjustedRiskReward({
    ...base, price_basis: "executable", bid: 1, ask: 1,
    entry_slippage_price: Number.MAX_VALUE, stop_slippage_price: 0,
    target_slippage_price: 0, round_trip_fee_price: Number.MAX_VALUE,
  }), /finite numeric range/);
});
