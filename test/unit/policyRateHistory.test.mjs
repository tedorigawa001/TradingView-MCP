import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextUtcBusinessDayStart, PolicyRateFirstSeenStore } from "../../build/policyRateHistory.js";
import { latestPolicyRateDecision } from "../../build/policyRateCollection.js";

const observation = (overrides = {}) => ({
  currency: "USD", source_symbol: "ECONOMICS:USINTR", observation_date: "2026-06-17", value: 3.75,
  source_observed_at: "2026-06-17T00:00:00.000Z", available_at: "2026-06-18T00:00:00.000Z",
  available_at_basis: "next_utc_business_day_start", observed_at: "2026-06-18T12:00:00.000Z", ...overrides,
});

test("policy-rate availability begins on the next UTC business day", () => {
  assert.equal(nextUtcBusinessDayStart("2026-06-19"), "2026-06-22T00:00:00.000Z");
  assert.equal(nextUtcBusinessDayStart("2026-06-17"), "2026-06-18T00:00:00.000Z");
});

test("PolicyRateFirstSeenStore retains revisions and blocks pre-availability reads", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-")), "history.jsonl");
  const store = new PolicyRateFirstSeenStore(path);
  const first = await store.observeMany([observation()]);
  assert.equal(first.recorded.length, 1);
  assert.equal(await store.getAsOf("USD", new Date("2026-06-18T11:59:59.000Z")), null);
  assert.equal((await store.getAsOf("USD", new Date("2026-06-18T12:00:00.000Z"))).value, 3.75);
  const changed = await store.observeMany([observation({ value: 3.5, observed_at: "2026-06-19T12:00:00.000Z" })]);
  assert.equal(changed.revisions, 1);
  assert.equal((await store.getAsOf("USD", new Date("2026-06-20T00:00:00.000Z"))).value, 3.5);
});

test("latestPolicyRateDecision ignores carry-forward bars and selects the latest changed value", () => {
  const value = latestPolicyRateDecision("USD", [
    { timeIso: "2026-05-31T00:00:00.000Z", close: 4 },
    { timeIso: "2026-06-17T00:00:00.000Z", close: 3.75 },
    { timeIso: "2026-06-30T00:00:00.000Z", close: 3.75 },
  ], new Date("2026-07-01T12:00:00.000Z"));
  assert.deepEqual(value, observation({ observed_at: "2026-07-01T12:00:00.000Z" }));
});

// BACKLOG 102-41: the MCP server and the collection CLIs write the same log, and a run takes its time before it waits for
// the lock. Only a version that will be appended has to be later than the log's last; unchanged ones are counted as such.
test("PolicyRateFirstSeenStore counts unchanged versions even when another writer appended later meanwhile", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-")), "history.jsonl");
  const lines = async () => (await readFile(path, "utf8")).trim().split("\n").length;
  const run = new PolicyRateFirstSeenStore(path);
  await run.observeMany([observation(), observation({ currency: "EUR", source_symbol: "ECONOMICS:EUINTR", value: 2 })]);
  // Another process records a third currency with a later time.
  await new PolicyRateFirstSeenStore(path).observeMany([observation({ currency: "JPY", source_symbol: "ECONOMICS:JPINTR", value: 0.5,
    observed_at: "2026-06-18T13:00:00.000Z" })]);
  // The run, with an earlier time, finds both unchanged.
  const again = await run.observeMany([observation({ observed_at: "2026-06-18T12:30:00.000Z" }),
    observation({ currency: "EUR", source_symbol: "ECONOMICS:EUINTR", value: 2, observed_at: "2026-06-18T12:30:00.000Z" })]);
  assert.deepEqual([again.recorded.length, again.unchanged, again.revisions], [0, 2, 0]);
  assert.equal(await lines(), 3);
  // A version to append with an earlier time is still refused, and nothing of the batch is written, even after one that
  // could be appended.
  await assert.rejects(() => run.observeMany([observation({ observed_at: "2026-06-18T12:30:00.000Z" }),
    observation({ currency: "EUR", source_symbol: "ECONOMICS:EUINTR", value: 2.25, observed_at: "2026-06-18T12:30:00.000Z" })]), /clock moved backwards/);
  await assert.rejects(() => run.observeMany([observation({ value: 3.5, observed_at: "2026-06-18T14:00:00.000Z" }),
    observation({ currency: "EUR", source_symbol: "ECONOMICS:EUINTR", value: 2.25, observed_at: "2026-06-18T12:30:00.000Z" })]), /clock moved backwards/);
  assert.equal(await lines(), 3);
  // At or after the log's last time, a revision is appended.
  const revised = await run.observeMany([observation({ currency: "EUR", source_symbol: "ECONOMICS:EUINTR", value: 2.25, observed_at: "2026-06-18T13:00:00.000Z" })]);
  assert.deepEqual([revised.recorded.length, revised.revisions], [1, 1]);
});
