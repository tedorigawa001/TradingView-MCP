import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyRateCollectionHeartbeatStore } from "../../build/policyRateCollectionHeartbeat.js";

const currencies = ["USD", "EUR", "JPY", "GBP", "AUD", "NZD", "CAD", "CHF"];
const symbols = { USD: "US", EUR: "EU", JPY: "JP", GBP: "GB", AUD: "AU", NZD: "NZ", CAD: "CA", CHF: "CH" };

const run = (observed_at) => ({
  observed_at,
  chart_index: 0,
  currencies: currencies.map((currency) => ({ currency, source_symbol: `ECONOMICS:${symbols[currency]}INTR`, decision_observation_date: "2026-06-17", bars: 300 })),
});

test("policy-rate collection heartbeat records complete successful runs independently of value changes", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-heartbeat-")), "heartbeats.jsonl");
  const store = new PolicyRateCollectionHeartbeatStore(path);
  const first = await store.recordRun(run("2026-07-01T12:00:00.000Z"));
  const second = await store.recordRun(run("2026-07-02T12:00:00.000Z"));
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual(await store.coverage(new Date("2026-07-02T12:00:00.000Z")), {
    records: 2,
    distinct_observation_dates: 2,
    duplicate_run_dates: 0,
    earliest_collected_at: "2026-07-01T12:00:00.000Z",
    latest_collected_at: "2026-07-02T12:00:00.000Z",
    chart_indexes: [0],
    maximum_business_day_age_between_runs: 1,
    intervals_exceeding_primary_max_gap: 0,
    latest_run_age_business_days: 0,
  });
});

test("policy-rate collection heartbeat rejects partial currency evidence", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-heartbeat-")), "heartbeats.jsonl");
  const store = new PolicyRateCollectionHeartbeatStore(path);
  await assert.rejects(() => store.recordRun({ ...run("2026-07-01T12:00:00.000Z"), currencies: run("2026-07-01T12:00:00.000Z").currencies.slice(0, 7) }), /every currency/);
});

test("policy-rate collection heartbeat coverage exposes duplicate dates and primary-test gap breaches", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-heartbeat-")), "heartbeats.jsonl");
  const store = new PolicyRateCollectionHeartbeatStore(path);
  await store.recordRun(run("2026-07-01T01:00:00.000Z"));
  await store.recordRun(run("2026-07-01T12:00:00.000Z"));
  await store.recordRun(run("2026-07-15T12:00:00.000Z"));
  const coverage = await store.coverage(new Date("2026-07-20T12:00:00.000Z"));
  assert.equal(coverage.records, 3);
  assert.equal(coverage.distinct_observation_dates, 2);
  assert.equal(coverage.duplicate_run_dates, 1);
  assert.equal(coverage.maximum_business_day_age_between_runs, 10);
  assert.equal(coverage.intervals_exceeding_primary_max_gap, 1);
  assert.equal(coverage.latest_run_age_business_days, 3);
});
