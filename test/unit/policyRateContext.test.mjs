import test from "node:test";
import assert from "node:assert/strict";
import { getPolicyRateContext } from "../../build/policyRateContext.js";
import { carryPanelPreflight } from "../../build/carryPanelPreflight.js";

const record = (currency, value) => ({ currency, value, observation_date: "2026-06-17", source_symbol: `ECONOMICS:${currency === "USD" ? "US" : currency}INTR`, source_observed_at: "2026-06-17T00:00:00.000Z", available_at: "2026-06-18T00:00:00.000Z", first_seen_at: "2026-07-28T13:00:00.000Z", sequence: 1 });

test("policy-rate context returns only first-seen, available values as of the cutoff", async () => {
  const provider = { getAsOf: async (currency) => currency === "USD" ? record("USD", 3.75) : null };
  const result = await getPolicyRateContext({ provider, currencies: ["USD", "EUR"], asOf: new Date("2026-07-28T13:00:00.000Z"), now: new Date("2026-07-28T14:00:00.000Z") });
  assert.equal(result.status, "partial");
  assert.equal(result.rates[0].value, 3.75);
  assert.equal(result.rates[1].status, "unavailable");
});

test("carry preflight refuses to invent a long historical sample before first-seen collection", () => {
  const result = carryPanelPreflight({
    asOf: "2026-07-28T13:00:00.000Z", rates: [
      { currency: "USD", status: "available", value: 3.75, available_at: "2026-06-18T00:00:00.000Z", first_seen_at: "2026-07-28T13:00:00.000Z" },
      { currency: "EUR", status: "available", value: 2.4, available_at: "2026-06-12T00:00:00.000Z", first_seen_at: "2026-07-28T13:00:00.000Z" },
    ], pairs: [{ pair_id: "EURUSD", base_currency: "EUR", quote_currency: "USD" }], from: "2006-07-20", to: "2026-07-28", horizonBusinessDays: 20, oosFrom: "2021-07-28", minimumObservations: 60,
  });
  assert.equal(result.status, "not_evaluable");
  assert.equal(result.pairs[0].data_available_from, "2026-07-28");
  assert.equal(result.pairs[0].non_overlapping_anchors, 0);
  assert.ok(result.pairs[0].quality_issues.includes("insufficient_first_seen_history"));
});

test("carry preflight counts only loaded daily price bars that match the fixed regime", () => {
  const result = carryPanelPreflight({
    asOf: "2026-08-31T00:00:00.000Z", rates: [
      { currency: "USD", status: "available", value: 3.75, available_at: "2026-06-18T00:00:00.000Z", first_seen_at: "2026-07-01T00:00:00.000Z" },
      { currency: "EUR", status: "available", value: 2.4, available_at: "2026-06-12T00:00:00.000Z", first_seen_at: "2026-07-01T00:00:00.000Z" },
    ], pairs: [{ pair_id: "EURUSD", base_currency: "EUR", quote_currency: "USD" }], from: "2026-07-01", to: "2026-08-31", horizonBusinessDays: 20, oosFrom: null, minimumObservations: 1,
    regime: { directional: "trend_down", volatility: null },
    priceEvidence: [{ pair_id: "EURUSD", symbol: "OANDA:EURUSD", timeframe: "1D", closed_bars: 100, classified_bars: 40, from: "2026-07-01", to: "2026-08-31", regime_dates: [{ date: "2026-07-01", directional: "trend_down", volatility: "normal" }, { date: "2026-07-29", directional: "range", volatility: "normal" }] }],
  });
  assert.equal(result.status, "ready");
  assert.equal(result.pairs[0].price_coverage.fixed_regime_anchors, 1);
  assert.equal(result.pairs[0].price_coverage.price_matched_anchors, 2);
});

test("carry preflight filters OOS anchors even before price evidence is loaded", () => {
  const result = carryPanelPreflight({
    asOf: "2026-07-28T00:00:00.000Z", rates: [
      { currency: "USD", status: "available", value: 3.75, available_at: "2006-07-20T00:00:00.000Z", first_seen_at: "2006-07-20T00:00:00.000Z" },
      { currency: "EUR", status: "available", value: 2.4, available_at: "2006-07-20T00:00:00.000Z", first_seen_at: "2006-07-20T00:00:00.000Z" },
    ], pairs: [{ pair_id: "EURUSD", base_currency: "EUR", quote_currency: "USD" }], from: "2006-07-20", to: "2026-07-28", horizonBusinessDays: 20, oosFrom: "2021-07-28", minimumObservations: 1,
  });
  assert.ok(result.pairs[0].non_overlapping_anchors > 200);
  assert.ok(result.pairs[0].oos_anchors > 40 && result.pairs[0].oos_anchors < 80);
  assert.ok(result.pairs[0].oos_anchors < result.pairs[0].non_overlapping_anchors);
});
