import assert from "node:assert/strict";
import test from "node:test";
import { getCarryCorePrimaryReadiness } from "../../build/carryPanelPrimaryReadiness.js";

const record = (currency, availableAt, firstSeenAt) => ({
  schema_version: "1.0", sequence: 1, series: "policy_rate", currency, source_symbol: `ECONOMICS:${currency === "EUR" ? "EU" : currency}INTR`,
  observation_date: availableAt.slice(0, 10), value: 1, source_observed_at: availableAt,
  available_at: availableAt, available_at_basis: "next_utc_business_day_start", first_seen_at: firstSeenAt,
});

test("carry primary readiness separates a calendar estimate from collection continuity proof", () => {
  const result = getCarryCorePrimaryReadiness({
    asOf: "2026-07-30T12:00:00.000Z",
    policyRateVersions: {
      USD: [record("USD", "2026-07-29T00:00:00.000Z", "2026-07-28T12:00:00.000Z")],
      EUR: [record("EUR", "2026-07-30T00:00:00.000Z", "2026-07-29T12:00:00.000Z")],
      JPY: [record("JPY", "2026-07-29T00:00:00.000Z", "2026-07-28T12:00:00.000Z")],
      AUD: [record("AUD", "2026-07-29T00:00:00.000Z", "2026-07-28T12:00:00.000Z")],
      CAD: [record("CAD", "2026-07-29T00:00:00.000Z", "2026-07-28T12:00:00.000Z")],
      CHF: [record("CHF", "2026-07-29T00:00:00.000Z", "2026-07-28T12:00:00.000Z")],
    },
  });
  assert.equal(result.status, "collecting");
  assert.equal(result.common_first_usable_date, "2026-07-30");
  assert.equal(result.required_business_days_after_common_start, 1200);
  assert.equal(result.collection_continuity_status, "not_proven_from_change_only_policy_rate_versions");
});

test("carry primary readiness blocks when one core currency lacks first-seen evidence", () => {
  const result = getCarryCorePrimaryReadiness({ asOf: "2026-07-29T12:00:00.000Z", policyRateVersions: {} });
  assert.equal(result.status, "blocked");
  assert.ok(result.missing_currencies.includes("USD"));
  assert.equal(result.estimated_earliest_complete_window_date, null);
});

test("carry primary readiness reaches the fixed 1,200-business-day boundary exactly", () => {
  const policyRateVersions = Object.fromEntries(["USD", "EUR", "JPY", "AUD", "CAD", "CHF"].map((currency) => [
    currency,
    [record(currency, "2026-07-30T00:00:00.000Z", "2026-07-30T00:00:00.000Z")],
  ]));
  const before = getCarryCorePrimaryReadiness({ asOf: "2031-03-05T12:00:00.000Z", policyRateVersions });
  const atBoundary = getCarryCorePrimaryReadiness({ asOf: "2031-03-06T12:00:00.000Z", policyRateVersions });
  assert.equal(before.required_business_days_after_common_start, 1200);
  assert.equal(before.estimated_earliest_complete_window_date, "2031-03-06");
  assert.equal(before.status, "collecting");
  assert.equal(atBoundary.status, "ready_for_price_preflight");
});
