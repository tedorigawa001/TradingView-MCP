import assert from "node:assert/strict";
import test from "node:test";
import { runCarryPanelPrimaryTest } from "../../build/carryPanelPrimaryTest.js";

const bars = (multiplier) => Array.from({ length: 120 }, (_, index) => ({
  timeIso: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
  close: 100 * Math.exp(multiplier * index),
}));

const record = (currency, observationDate, value, firstSeenAt, sequence) => ({
  schema_version: "1.0",
  sequence,
  series: "policy_rate",
  currency,
  source_symbol: `ECONOMICS:${currency === "EUR" ? "EU" : currency}INTR`,
  observation_date: observationDate,
  value,
  source_observed_at: `${observationDate}T00:00:00.000Z`,
  available_at: `${observationDate}T00:00:00.000Z`,
  available_at_basis: "next_utc_business_day_start",
  first_seen_at: firstSeenAt,
});

const pairs = [
  { pair_id: "EURUSD", base_currency: "EUR", quote_currency: "USD", bars: bars(0.001) },
  { pair_id: "AUDUSD", base_currency: "AUD", quote_currency: "USD", bars: bars(0.0012) },
];

test("carry primary test fits pair fixed effects and refits them in anchor-date blocks", () => {
  const result = runCarryPanelPrimaryTest({
    pairs,
    policyRateVersions: {
      EUR: [record("EUR", "2025-12-31", 1, "2025-12-31T00:00:00.000Z", 1), record("EUR", "2026-02-15", 2, "2026-02-15T00:00:00.000Z", 2)],
      AUD: [record("AUD", "2025-12-31", 2, "2025-12-31T00:00:00.000Z", 3), record("AUD", "2026-02-15", 3, "2026-02-15T00:00:00.000Z", 4)],
      USD: [record("USD", "2025-12-31", 0, "2025-12-31T00:00:00.000Z", 5)],
    },
    collectionHeartbeats: pairs[0].bars.map((bar) => ({ first_seen_at: bar.timeIso })),
    from: "2026-01-01",
    to: "2026-04-30",
    horizonBusinessDays: 5,
    minimumAnchorClusters: 6,
    blockLengthAnchors: 2,
    iterations: 100,
    seed: "carry-primary-test",
  });
  assert.equal(result.status, "complete");
  assert.equal(result.evidence_tier, "prospective_first_seen");
  assert.equal(result.contract.regime_condition, "none; the unconditional fixed-pair panel is the pre-registered baseline");
  assert.equal(result.anchor_clusters, 23);
  assert.equal(result.observations, 46);
  assert.ok(Number.isFinite(result.model.beta));
  assert.equal(result.bootstrap.iterations, 100);
  assert.equal(result.bootstrap.block_length_anchors, 2);
});

test("carry primary test excludes anchors whose rates were first seen only later", () => {
  const result = runCarryPanelPrimaryTest({
    pairs,
    policyRateVersions: {
      EUR: [record("EUR", "2026-01-01", 2, "2026-04-15T00:00:00.000Z", 1)],
      AUD: [record("AUD", "2026-01-01", 3, "2026-04-15T00:00:00.000Z", 2)],
      USD: [record("USD", "2026-01-01", 1, "2026-04-15T00:00:00.000Z", 3)],
    },
    collectionHeartbeats: pairs[0].bars.map((bar) => ({ first_seen_at: bar.timeIso })),
    from: "2026-01-01",
    to: "2026-04-30",
    horizonBusinessDays: 5,
    minimumAnchorClusters: 6,
    blockLengthAnchors: 2,
    iterations: 100,
    seed: "carry-primary-no-leak",
  });
  assert.equal(result.status, "not_evaluable");
  assert.ok(result.anchors_excluded_for_unavailable_or_zero_policy_difference > 0);
  assert.equal(result.model, null);
});

test("carry primary test excludes an entire anchor cluster after the fixed heartbeat gap", () => {
  const result = runCarryPanelPrimaryTest({
    pairs,
    policyRateVersions: {
      EUR: [record("EUR", "2025-12-31", 2, "2025-12-31T00:00:00.000Z", 1)],
      AUD: [record("AUD", "2025-12-31", 3, "2025-12-31T00:00:00.000Z", 2)],
      USD: [record("USD", "2025-12-31", 1, "2025-12-31T00:00:00.000Z", 3)],
    },
    collectionHeartbeats: [{ first_seen_at: "2026-01-01T12:00:00.000Z" }],
    from: "2026-01-01",
    to: "2026-04-30",
    horizonBusinessDays: 5,
    minimumAnchorClusters: 6,
    blockLengthAnchors: 2,
    iterations: 100,
    seed: "carry-primary-heartbeat-gap",
  });
  assert.equal(result.anchor_clusters, 2);
  assert.equal(result.anchors_excluded_for_collection_gap, 21);
  assert.equal(result.status, "not_evaluable");
});
