import test from "node:test";
import assert from "node:assert/strict";
import { computePositionSize } from "../../build/positionSize.js";

const NOW = new Date("2026-07-20T10:00:00.000Z");

test("sizes USDJPY in a JPY account and rounds down to whole units", () => {
  const result = computePositionSize({
    symbol: "OANDA:USDJPY",
    account_currency: "JPY",
    account_equity: 1_000_000,
    risk_percent: 1,
    entry_price: 162.4,
    stop_price: 162.2,
    round_trip_cost_price_per_unit: 0.014,
    quantity_step: 1,
    minimum_quantity: 1,
  }, NOW);

  assert.equal(result.status, "ready");
  assert.equal(result.quantity, 46_728);
  assert.ok(result.estimated_loss_at_stop <= result.risk_budget);
  assert.equal(result.conversion.basis, "same_currency");
});

test("sizes EURUSD in a JPY account from fresh USDJPY conversion evidence", () => {
  const result = computePositionSize({
    symbol: "OANDA:EURUSD",
    account_currency: "JPY",
    account_equity: 1_000_000,
    risk_percent: 1,
    entry_price: 1.1435,
    stop_price: 1.1405,
    round_trip_cost_price_per_unit: 0.0002,
    quantity_step: 1,
    minimum_quantity: 1,
    quote_to_account_rate: 162.44,
    conversion_symbol: "OANDA:USDJPY",
    conversion_observed_at: "2026-07-20T09:59:58.000Z",
  }, NOW);

  assert.equal(result.status, "ready");
  assert.equal(result.quantity, 19_237);
  assert.ok(result.estimated_loss_at_stop <= result.risk_budget);
  assert.equal(result.conversion.meaning, "JPY per 1 USD");
});

test("supports fractional XAUUSD quantity while preserving the risk ceiling", () => {
  const result = computePositionSize({
    symbol: "OANDA:XAUUSD",
    account_currency: "JPY",
    account_equity: 1_000_000,
    risk_amount: 10_000,
    entry_price: 4004,
    stop_price: 3994,
    round_trip_cost_price_per_unit: 0.54,
    quantity_step: 0.1,
    minimum_quantity: 0.1,
    quote_to_account_rate: 162.44,
    conversion_symbol: "OANDA:USDJPY",
    conversion_observed_at: "2026-07-20T09:59:58.000Z",
  }, NOW);

  assert.equal(result.status, "ready");
  assert.equal(result.quantity, 5.8);
  assert.ok(result.estimated_loss_at_stop <= result.risk_budget);
  assert.equal(result.quote_currency, "USD");
});

test("blocks missing and stale conversion evidence", () => {
  const base = {
    symbol: "OANDA:EURUSD",
    account_currency: "JPY",
    account_equity: 1_000_000,
    risk_percent: 1,
    entry_price: 1.14,
    stop_price: 1.13,
    quantity_step: 1,
    minimum_quantity: 1,
  };
  const missing = computePositionSize(base, NOW);
  assert.equal(missing.status, "blocked");
  assert.equal(missing.quantity, null);
  assert.equal(missing.quality_issues[0].code, "conversion_evidence_missing");

  const stale = computePositionSize({
    ...base,
    quote_to_account_rate: 162,
    conversion_symbol: "OANDA:USDJPY",
    conversion_observed_at: "2026-07-20T09:58:00.000Z",
  }, NOW);
  assert.equal(stale.status, "blocked");
  assert.equal(stale.quality_issues[0].code, "conversion_evidence_stale");
});

test("rejects zero stop distance and blocks quantities below the minimum", () => {
  assert.throws(() => computePositionSize({
    symbol: "OANDA:USDJPY",
    account_currency: "JPY",
    account_equity: 100_000,
    risk_percent: 1,
    entry_price: 162,
    stop_price: 162,
    quantity_step: 1,
    minimum_quantity: 1,
  }, NOW), /non-zero stop distance/);

  const belowMinimum = computePositionSize({
    symbol: "OANDA:XAUUSD",
    account_currency: "USD",
    account_equity: 100,
    risk_amount: 1,
    entry_price: 4000,
    stop_price: 3900,
    quantity_step: 0.1,
    minimum_quantity: 0.1,
  }, NOW);
  assert.equal(belowMinimum.status, "blocked");
  assert.equal(belowMinimum.quality_issues[0].code, "below_minimum_quantity");
});

test("honors a maximum quantity and blocks future conversion evidence", () => {
  const capped = computePositionSize({
    symbol: "OANDA:USDJPY",
    account_currency: "JPY",
    account_equity: 1_000_000,
    risk_percent: 1,
    entry_price: 162.4,
    stop_price: 162.2,
    quantity_step: 1,
    minimum_quantity: 1,
    maximum_quantity: 10_000,
  }, NOW);
  assert.equal(capped.status, "ready");
  assert.equal(capped.quantity, 10_000);
  assert.equal(capped.capped_by_maximum, true);

  const future = computePositionSize({
    symbol: "OANDA:EURUSD",
    account_currency: "JPY",
    account_equity: 1_000_000,
    risk_percent: 1,
    entry_price: 1.14,
    stop_price: 1.13,
    quantity_step: 1,
    minimum_quantity: 1,
    quote_to_account_rate: 162,
    conversion_symbol: "OANDA:USDJPY",
    conversion_observed_at: "2026-07-20T10:00:01.000Z",
  }, NOW);
  assert.equal(future.status, "blocked");
  assert.equal(future.quality_issues[0].code, "conversion_timestamp_in_future");
});
