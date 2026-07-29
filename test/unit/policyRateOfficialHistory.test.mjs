import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialPolicyRateHistoryStore } from "../../build/policyRateOfficialHistory.js";
import { getOfficialPolicyRateHistoryContext } from "../../build/policyRateOfficialHistoryContext.js";

const observation = (overrides = {}) => ({
  currency: "USD", source_symbol: "ECONOMICS:USINTR", observation_date: "2020-03-15", value: 0.25,
  source_url: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm", source_vintage_at: null,
  raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  retrieved_at: "2026-07-29T12:00:00.000Z", ...overrides,
});

test("official revised history is stored separately and retains downloaded revisions", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-official-policy-rate-")), "history.jsonl");
  const store = new OfficialPolicyRateHistoryStore(path);
  assert.equal((await store.observeMany([observation()])).recorded.length, 1);
  const revision = await store.observeMany([observation({ value: 0.5, retrieved_at: "2026-07-30T12:00:00.000Z" })]);
  assert.equal(revision.revisions, 1);
  assert.equal((await store.getLatest("USD")).value, 0.5);
  const coverage = await store.coverage();
  assert.equal(coverage.evidence_tier, "exploratory_revised_history");
  assert.equal(coverage.currencies.USD.revisions, 1);
  const snapshot = await store.observeRawSnapshot({ source_id: "ecb_deposit_facility", source_url: "https://data-api.ecb.europa.eu/service/data/FM", raw_sha256: observation().raw_sha256, source_observation_count: 10, source_first_observation_date: "2020-01-01", source_last_observation_date: "2020-03-15", raw_bytes: 100, retrieved_at: "2026-07-30T12:00:00.000Z" });
  assert.equal(snapshot.recorded, true);
  assert.equal((await store.coverage()).raw_snapshots, 1);
  assert.equal((await store.coverage()).source_coverage.ecb_deposit_facility.source_observation_count, 10);
});

test("official revised history does not treat a response-level vintage timestamp as a value revision", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-official-policy-rate-")), "history.jsonl");
  const store = new OfficialPolicyRateHistoryStore(path);
  await store.observeMany([observation({ source_vintage_at: "2026-07-29T01:00:00.000Z" })]);
  const repeat = await store.observeMany([observation({ source_vintage_at: "2026-07-30T01:00:00.000Z", retrieved_at: "2026-07-30T12:00:00.000Z" })]);
  assert.equal(repeat.recorded.length, 0);
  assert.equal(repeat.unchanged, 1);
  assert.equal(repeat.revisions, 0);
  assert.equal((await store.coverage()).currencies.USD.revisions, 0);
  assert.equal((await store.coverage()).currencies.USD.metadata_only_versions, 0);
});

test("official revised history context is explicitly exploratory and never point-in-time evidence", async () => {
  const provider = { getLatest: async (currency) => currency === "USD" ? {
    schema_version: "1.0", sequence: 1, series: "policy_rate_official_history", evidence_tier: "exploratory_revised_history",
    ...observation(), first_seen_at: "2026-07-29T12:00:00.000Z",
  } : null };
  const result = await getOfficialPolicyRateHistoryContext({ provider, currencies: ["USD", "EUR"] });
  assert.equal(result.evidence_tier, "exploratory_revised_history");
  assert.equal(result.eligibility, "exploratory_only");
  assert.equal(result.point_in_time_status, "not_available");
  assert.equal(result.source_coverage, null);
  assert.equal(result.rates[0].quality_issues[0], "revised_history_not_point_in_time");
  assert.equal(result.rates[0].raw_sha256, observation().raw_sha256);
  assert.equal(result.rates[1].status, "unavailable");
});

test("official revised history preserves a no-single-rate-target policy framework as an explicit gap", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-official-policy-rate-")), "history.jsonl");
  const store = new OfficialPolicyRateHistoryStore(path);
  await store.observeMany([observation({ currency: "JPY", source_symbol: "ECONOMICS:JPINTR", observation_date: "2013-04-04", value: null, rate_status: "no_single_rate_target" })]);
  const row = await store.getLatest("JPY");
  assert.equal(row.value, null);
  const result = await getOfficialPolicyRateHistoryContext({ provider: store, currencies: ["JPY"] });
  assert.equal(result.status, "partial");
  assert.equal(result.rates[0].status, "unavailable");
  assert.equal(result.rates[0].quality_issues[0], "official_policy_framework_has_no_single_rate_target");
});
