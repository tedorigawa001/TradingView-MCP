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
    collectionHeartbeats: [{ first_seen_at: "2026-07-30T01:45:00.000Z" }],
  });
  assert.equal(result.status, "collecting");
  assert.equal(result.common_first_usable_date, "2026-07-30");
  assert.equal(result.required_business_days_after_first_eligible_anchor, 1200);
  assert.equal("required_business_days_after_common_start" in result, false);
  assert.equal(result.first_eligible_anchor_date, "2026-08-25");
  assert.equal(result.estimated_earliest_complete_window_date, "2031-04-01");
  assert.equal(result.collection_continuity_status, "collecting_within_gap_limit");
});

test("carry primary readiness blocks when one core currency lacks first-seen evidence", () => {
  const result = getCarryCorePrimaryReadiness({ asOf: "2026-07-29T12:00:00.000Z", policyRateVersions: {}, collectionHeartbeats: [] });
  assert.equal(result.status, "blocked");
  assert.ok(result.missing_currencies.includes("USD"));
  assert.equal(result.estimated_earliest_complete_window_date, null);
  assert.equal(result.collection_continuity_status, "not_proven_no_collection_heartbeats");
});

test("carry primary readiness reaches the fixed 1,200-business-day boundary exactly", () => {
  const policyRateVersions = Object.fromEntries(["USD", "EUR", "JPY", "AUD", "CAD", "CHF"].map((currency) => [
    currency,
    [record(currency, "2026-07-30T00:00:00.000Z", "2026-07-30T00:00:00.000Z")],
  ]));
  const collectionHeartbeats = [{ first_seen_at: "2026-07-30T01:45:00.000Z" }, { first_seen_at: "2031-04-01T01:45:00.000Z" }];
  const before = getCarryCorePrimaryReadiness({ asOf: "2031-03-31T12:00:00.000Z", policyRateVersions, collectionHeartbeats });
  const atBoundary = getCarryCorePrimaryReadiness({ asOf: "2031-04-01T12:00:00.000Z", policyRateVersions, collectionHeartbeats });
  assert.equal(before.required_business_days_after_first_eligible_anchor, 1200);
  assert.equal(before.first_eligible_anchor_date, "2026-08-25");
  assert.equal(before.estimated_earliest_complete_window_date, "2031-04-01");
  assert.equal(before.status, "collecting");
  assert.equal(atBoundary.status, "ready_for_price_preflight");
});

test("carry primary readiness reports when the latest heartbeat exceeds the frozen five-day gap", () => {
  const policyRateVersions = Object.fromEntries(["USD", "EUR", "JPY", "AUD", "CAD", "CHF"].map((currency) => [
    currency,
    [record(currency, "2026-07-28T00:00:00.000Z", "2026-07-28T00:00:00.000Z")],
  ]));
  const result = getCarryCorePrimaryReadiness({
    asOf: "2026-08-10T12:00:00.000Z",
    policyRateVersions,
    collectionHeartbeats: [{ first_seen_at: "2026-07-30T01:45:00.000Z" }],
  });
  assert.equal(result.collection_continuity_status, "gap_exceeded");
  assert.equal(result.latest_heartbeat_age_business_days, 7);
  assert.equal(result.status, "collecting");
});

test("carry primary readiness rejects a malformed future heartbeat before as-of filtering", () => {
  assert.throws(() => getCarryCorePrimaryReadiness({
    asOf: "2026-07-30T12:00:00.000Z",
    policyRateVersions: {},
    collectionHeartbeats: [{ first_seen_at: "9999-not-a-canonical-timestamp" }],
  }), /heartbeat first_seen_at must be a canonical ISO timestamp/);
});
