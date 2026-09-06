import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FirstSeenCollectionHeartbeatStore,
  latestExpectedFirstSeenRunAt,
  resolveFirstSeenCollectionHeartbeatPath,
} from "../../build/firstSeenCollectionHeartbeat.js";

const store = async () => new FirstSeenCollectionHeartbeatStore(join(await mkdtemp(join(tmpdir(), "fsch-")), "h.jsonl"));
const run = (observed_at, status = "complete") => ({
  observed_at,
  status,
  cot_symbols: ["OANDA:EURUSD", "OANDA:USDJPY", "OANDA:XAUUSD"],
  cot_complete: status === "complete" ? 3 : 2,
  real_yield_status: "complete",
  cme_gold_open_interest_status: status === "complete" ? "complete" : "error",
  coverage_status: "complete",
});

test("first-seen heartbeat records quiet and partial collection runs", async () => {
  const heartbeat = await store();
  await heartbeat.recordRun(run("2026-09-04T01:30:00.000Z"));
  await heartbeat.recordRun(run("2026-09-04T13:30:00.000Z", "partial"));
  const coverage = await heartbeat.coverage(new Date("2026-09-04T14:15:00.000Z"));
  assert.equal(coverage.records, 2);
  assert.equal(coverage.latest_run_status, "partial");
  assert.equal(coverage.latest_expected_run_at, "2026-09-04T13:30:00.000Z");
  assert.equal(coverage.latest_run_meets_schedule, true);
});

test("first-seen expected slots skip weekends and distinguish both daily windows", () => {
  assert.equal(latestExpectedFirstSeenRunAt(new Date("2026-09-04T02:15:00.000Z")), "2026-09-04T01:30:00.000Z");
  assert.equal(latestExpectedFirstSeenRunAt(new Date("2026-09-04T14:15:00.000Z")), "2026-09-04T13:30:00.000Z");
  assert.equal(latestExpectedFirstSeenRunAt(new Date("2026-09-06T02:15:00.000Z")), "2026-09-04T13:30:00.000Z");
});

test("first-seen coverage exposes a missed scheduled run", async () => {
  const heartbeat = await store();
  await heartbeat.recordRun(run("2026-09-04T01:30:00.000Z"));
  const coverage = await heartbeat.coverage(new Date("2026-09-04T14:15:00.000Z"));
  assert.equal(coverage.latest_expected_run_at, "2026-09-04T13:30:00.000Z");
  assert.equal(coverage.latest_run_meets_schedule, false);
});

test("first-seen heartbeat preserves a partial coverage read even when sources completed", async () => {
  const heartbeat = await store();
  const record = await heartbeat.recordRun({ ...run("2026-09-04T13:30:00.000Z", "partial"), cme_gold_open_interest_status: "complete", cot_complete: 3, coverage_status: "partial" });
  assert.equal(record.status, "partial");
});

test("first-seen heartbeat validates provenance and resolves beside other ledgers", async () => {
  const heartbeat = await store();
  await assert.rejects(() => heartbeat.recordRun({ ...run("2026-09-04T01:30:00.000Z"), cot_symbols: [] }), /COT symbol/);
  assert.match(resolveFirstSeenCollectionHeartbeatPath(undefined), /first-seen-collection-heartbeats\.jsonl$/);
});
