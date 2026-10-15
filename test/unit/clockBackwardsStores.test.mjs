import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CotFirstSeenStore } from "../../build/cotFirstSeenHistory.js";
import { FirstSeenCollectionHeartbeatStore } from "../../build/firstSeenCollectionHeartbeat.js";
import { PolicyRateCollectionHeartbeatStore } from "../../build/policyRateCollectionHeartbeat.js";
import { PolicyRateFirstSeenStore } from "../../build/policyRateHistory.js";
import { RealYieldFirstSeenStore } from "../../build/realYieldHistory.js";
import { ResearchCollectionHeartbeatStore } from "../../build/researchCollectionHeartbeat.js";
import { checkCollectionHealth, parseCollectionHealthCliArguments } from "../../build/collectionHealthCli.js";

// BACKLOG 102-36: a store on AppendOnlyFirstSeenLog refuses, before it writes, a record the log's reader would refuse
// afterwards: one stamped before the latest record (a clock moved back, or a run that took its time before another run
// recorded), a later record of a batch stamped before an earlier one, and one dated after it was seen. Written, any of
// these would make every later read of the log fail. The file is left byte for byte as it was, and still reads.

async function newPath(t, name) {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-clock-backwards-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, name);
}

/** `refused` must fail with `pattern`, leave the file as it was, and leave it readable through `reads`. */
async function assertRefusedUnchanged(path, refused, pattern, reads) {
  const before = await readFile(path);
  await assert.rejects(refused, pattern);
  assert.deepEqual(await readFile(path), before);
  await reads();
}

const firstSeenRun = (observed_at) => ({
  observed_at, status: "complete", cot_symbols: ["OANDA:EURUSD", "OANDA:XAUUSD"], cot_complete: 2,
  real_yield_status: "complete", cme_gold_open_interest_status: "complete", coverage_status: "complete",
});

test("the first-seen collection heartbeat refuses a run stamped before the latest one and writes nothing", async (t) => {
  const path = await newPath(t, "first-seen-collection-heartbeats.jsonl");
  const store = new FirstSeenCollectionHeartbeatStore(path);
  await store.recordRun(firstSeenRun("2026-09-04T13:30:00.000Z"));
  const reads = async () => assert.equal((await new FirstSeenCollectionHeartbeatStore(path).coverage(new Date("2026-09-04T14:00:00.000Z"))).records, 1);
  // A run that took its time a moment before the latest one, and so waited for the lock while that one recorded.
  await assertRefusedUnchanged(path, () => store.recordRun(firstSeenRun("2026-09-04T13:29:59.999Z")),
    /first-seen collection heartbeat first-seen clock moved backwards/, reads);
  // A clock a day behind.
  await assertRefusedUnchanged(path, () => store.recordRun(firstSeenRun("2026-09-03T13:30:00.000Z")), /clock moved backwards/, reads);
  // The same stamp and a later one are appended as before.
  assert.equal((await store.recordRun(firstSeenRun("2026-09-04T13:30:00.000Z"))).sequence, 2);
  assert.equal((await store.recordRun(firstSeenRun("2026-09-07T01:30:00.000Z"))).sequence, 3);
  assert.equal((await store.coverage(new Date("2026-09-07T02:00:00.000Z"))).latest_run_meets_schedule, true);
});

const policyRateCurrencies = [["USD", "US"], ["EUR", "EU"], ["JPY", "JP"], ["GBP", "GB"], ["AUD", "AU"], ["NZD", "NZ"], ["CAD", "CA"], ["CHF", "CH"]];
const policyRateRun = (observed_at) => ({
  observed_at, chart_index: 0,
  currencies: policyRateCurrencies.map(([currency, code]) => ({ currency, source_symbol: `ECONOMICS:${code}INTR`, decision_observation_date: "2026-06-17", bars: 300 })),
});

test("the policy-rate collection heartbeat refuses a run stamped before the latest one and writes nothing", async (t) => {
  const path = await newPath(t, "policy-rate-collection-heartbeats.jsonl");
  const store = new PolicyRateCollectionHeartbeatStore(path);
  await store.recordRun(policyRateRun("2026-07-02T12:00:00.000Z"));
  const reads = async () => {
    const reader = new PolicyRateCollectionHeartbeatStore(path);
    assert.equal((await reader.coverage(new Date("2026-07-03T00:00:00.000Z"))).records, 1);
    assert.equal((await reader.getRunsAsOf(new Date("2026-07-03T00:00:00.000Z"))).length, 1);
  };
  await assertRefusedUnchanged(path, () => store.recordRun(policyRateRun("2026-07-02T11:59:59.999Z")),
    /policy-rate collection heartbeat first-seen clock moved backwards/, reads);
  await assertRefusedUnchanged(path, () => store.recordRun(policyRateRun("2026-07-01T12:00:00.000Z")), /clock moved backwards/, reads);
  assert.equal((await store.recordRun(policyRateRun("2026-07-02T12:00:00.000Z"))).sequence, 2);
  assert.equal((await store.recordRun(policyRateRun("2026-07-03T12:00:00.000Z"))).sequence, 3);
  assert.equal((await store.coverage(new Date("2026-07-03T12:00:00.000Z"))).records, 3);
});

const researchHypotheses = [{ hypothesis_id: "xauusd-15m-bearish-fvg", status: "complete", events: 0, recorded: false }];

test("the research collection heartbeat refuses a run stamped before the latest one and writes nothing", async (t) => {
  const path = await newPath(t, "research-collection-heartbeats.jsonl");
  const store = new ResearchCollectionHeartbeatStore(path);
  const run = (observed_at) => store.recordRun({ observed_at, hypotheses: researchHypotheses, chart_restored: true });
  await run("2026-08-15T02:00:00.000Z");
  const reads = async () => assert.equal((await new ResearchCollectionHeartbeatStore(path).coverage(new Date("2026-08-15T03:00:00.000Z"))).records, 1);
  await assertRefusedUnchanged(path, () => run("2026-08-15T01:59:59.999Z"), /research collection heartbeat first-seen clock moved backwards/, reads);
  await assertRefusedUnchanged(path, () => run("2026-08-14T02:00:00.000Z"), /clock moved backwards/, reads);
  assert.equal((await run("2026-08-15T02:00:00.000Z")).sequence, 2);
  assert.equal((await run("2026-08-15T03:00:00.000Z")).sequence, 3);
  assert.equal((await store.coverage(new Date("2026-08-15T03:00:00.000Z"))).maximum_gap_hours, 1);
});

/** Points the health check at the given heartbeat logs for one test. */
function withHeartbeatPaths(t, paths) {
  const names = { first: "TRADINGVIEW_MCP_FIRST_SEEN_COLLECTION_HEARTBEAT_PATH", policy: "TRADINGVIEW_MCP_POLICY_RATE_COLLECTION_HEARTBEAT_PATH",
    research: "TRADINGVIEW_MCP_RESEARCH_COLLECTION_HEARTBEAT_PATH" };
  const saved = Object.fromEntries(Object.values(names).map((name) => [name, process.env[name]]));
  for (const [key, name] of Object.entries(names)) process.env[name] = paths[key];
  t.after(() => { for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
}

test("a heartbeat stamped ahead of the clock holds off every later one, and each coverage and the health check report it (BACKLOG 102-36 review)", async (t) => {
  const paths = { first: await newPath(t, "first-seen-collection-heartbeats.jsonl"), policy: await newPath(t, "policy-rate-collection-heartbeats.jsonl"),
    research: await newPath(t, "research-collection-heartbeats.jsonl") };
  withHeartbeatPaths(t, paths);
  const firstSeen = new FirstSeenCollectionHeartbeatStore(paths.first), policy = new PolicyRateCollectionHeartbeatStore(paths.policy);
  const research = new ResearchCollectionHeartbeatStore(paths.research);
  // A clock two hours ahead stamped one run of each collector, and has since been set right.
  const now = new Date(), ahead = new Date(now.getTime() + 2 * 3_600_000).toISOString(), later = new Date(now.getTime() + 60_000).toISOString();
  await firstSeen.recordRun(firstSeenRun(ahead));
  await policy.recordRun(policyRateRun(ahead));
  await research.recordRun({ observed_at: ahead, hypotheses: researchHypotheses, chart_restored: true });
  // Every heartbeat the corrected clock stamps is refused until it reaches the stamp, while the stamp reads as fresh.
  await assert.rejects(() => firstSeen.recordRun(firstSeenRun(later)), /clock moved backwards/);
  await assert.rejects(() => policy.recordRun(policyRateRun(later)), /clock moved backwards/);
  await assert.rejects(() => research.recordRun({ observed_at: later, hypotheses: researchHypotheses, chart_restored: true }), /clock moved backwards/);
  const [first, rate, hourly] = [await firstSeen.coverage(now), await policy.coverage(now), await research.coverage(now)];
  assert.deepEqual([first.latest_run_meets_schedule, rate.latest_run_age_business_days, hourly.latest_run_age_hours], [true, 0, -2]);
  // Each coverage says the latest heartbeat is stamped ahead; as of a moment after the stamp it is not.
  assert.deepEqual([first.latest_in_future, rate.latest_in_future, hourly.latest_in_future], [true, true, true]);
  const afterStamp = new Date(Date.parse(ahead) + 1_000);
  assert.deepEqual([(await firstSeen.coverage(afterStamp)).latest_in_future, (await policy.coverage(afterStamp)).latest_in_future,
    (await research.coverage(afterStamp)).latest_in_future], [false, false, false]);
  // The health check, which read every one of them as healthy, is stale and notifies.
  const result = await checkCollectionHealth(parseCollectionHealthCliArguments([]), now);
  assert.deepEqual([result.status, result.should_notify], ["stale", true]);
  assert.deepEqual(result.issues.map((issue) => [issue.code, issue.age, issue.unit]),
    [["policy_rate_clock_ahead", -2, "hours"], ["research_clock_ahead", -2, "hours"], ["first_seen_clock_ahead", -2, "hours"]]);
  assert.deepEqual([result.policy_rate.latest_in_future, result.research.latest_in_future, result.first_seen.latest_in_future], [true, true, true]);
  const researchOnly = await checkCollectionHealth(parseCollectionHealthCliArguments(["--scope", "research"]), now);
  assert.deepEqual(researchOnly.issues.map((issue) => issue.code), ["research_clock_ahead"]);
});

test("a heartbeat written while the check waited for its log is not ahead, and its negative age no longer fails the check (BACKLOG 102-36 review)", async (t) => {
  const paths = { first: await newPath(t, "first-seen-collection-heartbeats.jsonl"), policy: await newPath(t, "policy-rate-collection-heartbeats.jsonl"),
    research: await newPath(t, "research-collection-heartbeats.jsonl") };
  withHeartbeatPaths(t, paths);
  // The check took its time a minute ago; a run stamped half a minute later recorded while the check waited for the lock.
  const checkedAt = new Date(Date.now() - 60_000);
  await new ResearchCollectionHeartbeatStore(paths.research).recordRun({ observed_at: new Date(checkedAt.getTime() + 30_000).toISOString(), hypotheses: researchHypotheses, chart_restored: true });
  const result = await checkCollectionHealth(parseCollectionHealthCliArguments(["--scope", "research"]), checkedAt);
  assert.deepEqual([result.status, result.research.latest_in_future, result.research.latest_run_age_hours, result.issues], ["healthy", false, -0.01, []]);
});

const cotVersion = (overrides = {}) => ({
  symbol: "OANDA:EURUSD", observation_date: "2026-07-21", value: { open_interest: 800061 }, observed_at: "2026-07-24T19:30:00.000Z", ...overrides,
});

test("the COT store refuses a batch stamped out of order or a version dated after it was seen, and writes nothing", async (t) => {
  const path = await newPath(t, "cot-first-seen.jsonl");
  const store = new CotFirstSeenStore(path);
  // On an empty log, a batch whose second version is stamped before its first writes nothing, not even the file.
  await assert.rejects(() => store.observeMany([cotVersion({ observed_at: "2026-07-24T21:00:00.000Z" }),
    cotVersion({ symbol: "OANDA:USDJPY", observed_at: "2026-07-24T20:00:00.000Z" })]), /COT first-seen first-seen clock moved backwards/);
  await assert.rejects(lstat(path), { code: "ENOENT" });
  await store.observeMany([cotVersion()]);
  const reads = async () => assert.equal((await new CotFirstSeenStore(path).coverage()).records, 1);
  // Both versions are at or after the log's last; the second is stamped before the first.
  await assertRefusedUnchanged(path, () => store.observeMany([cotVersion({ symbol: "OANDA:XAUUSD", observed_at: "2026-07-24T21:00:00.000Z" }),
    cotVersion({ symbol: "OANDA:USDJPY", observed_at: "2026-07-24T20:00:00.000Z" })]), /COT first-seen first-seen clock moved backwards/, reads);
  // A report dated after the moment it was seen, which a clock days behind produces.
  await assertRefusedUnchanged(path, () => store.observeMany([cotVersion({ symbol: "OANDA:XAUUSD", observation_date: "2026-07-28",
    observed_at: "2026-07-27T19:30:00.000Z" })]), /COT first-seen observation_date is after first_seen_at/, reads);
  // Stamped before the log's last, as before (BACKLOG 102-29).
  await assertRefusedUnchanged(path, () => store.observeMany([cotVersion({ value: { revised: true }, observed_at: "2026-07-24T19:29:59.999Z" })]),
    /COT first-seen clock moved backwards/, reads);
  // In order, the same versions are appended.
  const recorded = await store.observeMany([cotVersion({ symbol: "OANDA:USDJPY", observed_at: "2026-07-24T20:00:00.000Z" }),
    cotVersion({ symbol: "OANDA:XAUUSD", observed_at: "2026-07-24T21:00:00.000Z" })]);
  assert.deepEqual(recorded.map((record) => record.sequence), [2, 3]);
  assert.equal((await store.coverage()).records, 3);
});

test("the COT store refuses, whole, a batch that would take its file over the size limit, and writes nothing (BACKLOG 102-36 review)", async (t) => {
  const path = await newPath(t, "cot-first-seen.jsonl");
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  // A record as the store writes it; every value hash has the same length, so this one's length is the written one's.
  const line = (sequence, symbol, first_seen_at = "2026-07-24T19:30:00.000Z") => `${JSON.stringify({ schema_version: "1.0", sequence, series: "cftc_cot", symbol,
    observation_date: "2026-07-21", value_hash: `sha256:${"0".repeat(64)}`, first_seen_at })}\n`;
  const first = { symbol: "OANDA:USDJPY", observed_at: "2026-07-25T19:30:00.000Z" }, second = { symbol: "OANDA:XAUUSD", observed_at: "2026-07-25T19:30:00.000Z" };
  // Fill the log with short records until the first version of the batch still fits but the first two do not: the
  // second is longer than the next short record would have been.
  const lines = [];
  let size = 0;
  const firstBytes = (sequence) => Buffer.byteLength(line(sequence, first.symbol, "2026-07-25T19:30:00.000Z"));
  while (size + Buffer.byteLength(line(lines.length + 1, "X")) <= MAX_FILE_BYTES - firstBytes(lines.length + 2)) {
    const next = line(lines.length + 1, "X");
    lines.push(next);
    size += Buffer.byteLength(next);
  }
  await writeFile(path, lines.join(""), { mode: 0o600 });
  const count = lines.length;
  assert.ok(size + firstBytes(count + 1) <= MAX_FILE_BYTES);
  assert.ok(size + firstBytes(count + 1) + Buffer.byteLength(line(count + 2, second.symbol, second.observed_at)) > MAX_FILE_BYTES);
  const store = new CotFirstSeenStore(path);
  const reads = async () => assert.equal((await new CotFirstSeenStore(path).coverage()).records, count);
  // Before 102-36 the first version was written and the second then failed on the size, leaving half a batch.
  await assertRefusedUnchanged(path, () => store.observeMany([cotVersion(first), cotVersion(second)]), /COT first-seen history file is too large/, reads);
  // Alone, the first version fits.
  assert.deepEqual((await store.observeMany([cotVersion(first)])).map((record) => record.sequence), [count + 1]);
  assert.equal((await lstat(path)).size <= MAX_FILE_BYTES, true);
});

const policyRate = (overrides = {}) => ({
  currency: "USD", source_symbol: "ECONOMICS:USINTR", observation_date: "2026-06-17", value: 3.75,
  source_observed_at: "2026-06-17T00:00:00.000Z", available_at: "2026-06-18T00:00:00.000Z",
  available_at_basis: "next_utc_business_day_start", observed_at: "2026-06-18T12:00:00.000Z", ...overrides,
});
const euro = { currency: "EUR", source_symbol: "ECONOMICS:EUINTR", value: 2 };

test("the policy-rate store refuses a batch stamped out of order and writes nothing", async (t) => {
  const path = await newPath(t, "policy-rates.jsonl");
  const store = new PolicyRateFirstSeenStore(path);
  await store.observeMany([policyRate()]);
  const reads = async () => assert.equal((await new PolicyRateFirstSeenStore(path).getAsOf("USD", new Date("2026-06-19T00:00:00.000Z"))).value, 3.75);
  // Both versions are at or after the log's last; the second is stamped before the first.
  await assertRefusedUnchanged(path, () => store.observeMany([policyRate({ value: 3.5, observed_at: "2026-06-18T14:00:00.000Z" }),
    policyRate({ ...euro, observed_at: "2026-06-18T13:00:00.000Z" })]), /policy-rate first-seen clock moved backwards/, reads);
  // Stamped before the log's last, as before (BACKLOG 102-41).
  await assertRefusedUnchanged(path, () => store.observeMany([policyRate({ ...euro, observed_at: "2026-06-18T11:59:59.999Z" })]),
    /policy-rate first-seen clock moved backwards/, reads);
  // In order, the same versions are appended.
  const result = await store.observeMany([policyRate({ ...euro, observed_at: "2026-06-18T13:00:00.000Z" }),
    policyRate({ value: 3.5, observed_at: "2026-06-18T14:00:00.000Z" })]);
  assert.deepEqual([result.recorded.map((record) => record.sequence), result.revisions], [[2, 3], 1]);
  assert.equal((await store.getAsOf("USD", new Date("2026-06-19T00:00:00.000Z"))).value, 3.5);
});

const realYield = (overrides = {}) => ({
  series: "US_TREASURY_PAR_REAL_CMT_10Y", observation_date: "2026-07-13", value: 2.01, observed_at: "2026-07-14T01:00:00.000Z",
  source_updated_at_raw: "2026-07-14T00:30:00Z", observed_feed_year: 2026, ...overrides,
});

test("the real-yield store refuses a batch stamped out of order and writes nothing", async (t) => {
  const path = await newPath(t, "real-yield.jsonl");
  const store = new RealYieldFirstSeenStore(path);
  await store.observe(realYield());
  const reads = async () => assert.equal((await new RealYieldFirstSeenStore(path).getAsOf(new Date("2026-07-20T00:00:00.000Z"))).value, 2.01);
  // Both versions are at or after the log's last; the second is stamped before the first.
  await assertRefusedUnchanged(path, () => store.observeMany([realYield({ observation_date: "2026-07-14", value: 2.02, observed_at: "2026-07-15T02:00:00.000Z" }),
    realYield({ observation_date: "2026-07-10", value: 1.99, observed_at: "2026-07-15T01:00:00.000Z" })]), /real-yield first-seen clock moved backwards/, reads);
  // Stamped before the log's last, as before.
  await assertRefusedUnchanged(path, () => store.observe(realYield({ observation_date: "2026-07-10", value: 1.99, observed_at: "2026-07-14T00:59:59.999Z" })),
    /real-yield first-seen clock moved backwards/, reads);
  // In order, the same versions are appended.
  const recorded = await store.observeMany([realYield({ observation_date: "2026-07-10", value: 1.99, observed_at: "2026-07-15T01:00:00.000Z" }),
    realYield({ observation_date: "2026-07-14", value: 2.02, observed_at: "2026-07-15T02:00:00.000Z" })]);
  assert.deepEqual(recorded.map((record) => record.sequence), [2, 3]);
  assert.equal((await store.getAsOf(new Date("2026-07-20T00:00:00.000Z"))).value, 2.02);
});
