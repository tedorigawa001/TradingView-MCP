import nodeTest from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath, chmod, symlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NativeBarHistory } from "../../build/nativeBarHistory.js";
import { canonical, evidenceHash, nativeBarCaptureSchema, nativeBarTimestamp } from "../../build/nativeBarEvidence.js";

const symbols = ["PEPPERSTONE:MXNJPY", "OANDA:XAUUSD"];
const test = process.platform === "win32" ? nodeTest.skip : nodeTest;
const targets = symbols.map((symbol, chart_index) => ({ symbol, chart_index, expected_timeframe: "240" }));
const query = { symbol: symbols[0], timeframe: "15" };
function capture(time, close = 8.54, volume = null, contextChange = {}) {
  return { capture_as_of: time, restoration_verified: true, restoration_hash: evidenceHash("synthetic-layout"),
    series: symbols.flatMap((symbol) => ["15", "60"].map((timeframe) => {
      const context = { symbol, full_name: symbol, exchange: symbol.split(":")[0], type: "forex", currency: "JPY",
        timezone: "Etc/UTC", session: "24x7", subsession_id: "regular", pricescale: 100000, minmov: 1,
        minmove2: 10, fractional: false, chart_style: "candles", adjustment: "not_applicable",
        capture_contract: "native-bar-v1:successor-confirmed", ...contextChange };
      return { symbol, timeframe, context, series_context_id: evidenceHash(context), source: "tradingview_native_ohlcv", price_basis: "unknown",
        observed_at: time, history_shortage: true, provenance: { session_holidays: null, corrections: null },
        bars: [{ bar_open_at: "2026-10-20T00:00:00.000Z", confirmed_by_next_bar_at: "2026-10-20T01:00:00.000Z",
          open: 8.54, high: 9, low: 8, close, volume }] };
    })) };
}
async function fixture(t, extra = {}) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "native-history-synthetic-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const directory = join(base, "store");
  let time = "2026-10-22T00:00:00.000Z", tick = 0;
  const options = { directory, now: () => new Date(time), monotonic: () => tick, lockWaitMs: 0,
    testOnly: { allowTemporaryRoot: true, ...extra } };
  const store = new NativeBarHistory(options);
  return { base, directory, options, store, time: () => time, setTime: (s) => { time = s; }, setTick: (n) => { tick = n; } };
}
async function record(f, close = 8.54, volume = null, contextChange = {}) {
  const plan = await f.store.prepareRecording(targets);
  const result = await f.store.record(plan.plan_id, plan.plan_hash, true, async () => capture(f.time(), close, volume, contextChange));
  return { ...result, plan };
}
const filePaths = (f, receipt) => ({ payload: join(f.directory, "captures", receipt.day, `${receipt.recording_id}.json`),
  receipt: join(f.directory, "receipts", receipt.day, `${receipt.recording_id}.json`) });

test("105-3 missing-root preview/history/status/maintenance create no data or lock", async (t) => {
  const f = await fixture(t);
  const p = await f.store.prepareRecording(targets);
  assert.equal(p.bindings_verified, false); assert.equal(p.store_status, "missing");
  assert.equal((await f.store.history(query)).bars.length, 0);
  assert.equal((await f.store.status(p.recording_id)).status, "not_found");
  await f.store.prepareMaintenance("prune"); await f.store.prepareMaintenance("clock_recovery");
  assert.deepEqual(await readdir(f.base), []);
});

test("105-3 consent plans are single-use, process-local, bounded, expired by monotonic time", async (t) => {
  const f = await fixture(t); let calls = 0;
  const cb = async () => { calls++; return capture(f.time()); };
  let p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, false, cb), /confirm_required/);
  const other = new NativeBarHistory(f.options);
  await assert.rejects(other.record(p.plan_id, p.plan_hash, true, cb), /plan_not_found/);
  await assert.rejects(f.store.record(p.plan_id, "f".repeat(64), true, cb), /binding_mismatch/);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, cb), /plan_not_found/);
  p = await f.store.prepareRecording(targets); f.setTick(600001);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, cb), /plan_expired/);
  assert.equal(calls, 0); assert.deepEqual(await readdir(f.base), []);
  for (let i = 0; i < 128; i++) await f.store.prepareRecording(targets);
  await assert.rejects(f.store.prepareRecording(targets), /registry_full/);
});

test("105-3 A A B A volume-only/context epochs and as-of never backdate", async (t) => {
  const f = await fixture(t);
  const a = await record(f);
  assert.equal(a.status, "committed");
  assert.equal((await lstat(f.directory)).mode & 0o077, 0);
  assert.equal((await lstat(filePaths(f, a.receipt).payload)).mode & 0o077, 0);
  f.setTime("2026-10-22T00:01:00.000Z"); await record(f);
  f.setTime("2026-10-22T00:02:00.000Z"); await record(f, 8.55);
  f.setTime("2026-10-22T00:03:00.000Z"); await record(f);
  f.setTime("2026-10-22T00:04:00.000Z"); await record(f, 8.54, 0);
  let h = await f.store.history(query), row = h.bars[0];
  assert.equal(h.storage_visibility_at_as_of, "not_proven");
  assert.equal(row.versions.length, 4); assert.equal(row.first_seen_at, "2026-10-22T00:00:00.000Z");
  assert.equal(row.versions[0].last_observed_at, "2026-10-22T00:01:00.000Z");
  assert.equal(row.versions[2].value_hash, row.versions[0].value_hash);
  assert.equal(row.versions[2].version_first_seen_at, "2026-10-22T00:03:00.000Z");
  assert.equal(row.versions[3].change_kind, "volume_only");
  assert.deepEqual(row.versions[3].changed_fields, ["volume"]);
  assert.equal((await f.store.history({ ...query, as_of: "2026-10-21T23:59:00.000Z" })).bars.length, 0);
  h = await f.store.history({ ...query, as_of: "2026-10-22T00:02:00.000Z" });
  assert.equal(h.bars[0].versions.at(-1).values.close, 8.55);
  f.setTime("2026-10-22T00:05:00.000Z"); await record(f, 8.54, null, { pricescale: 1000 });
  h = await f.store.history(query); assert.equal(h.bars.length, 2);
  assert.equal(h.bars.find((b) => b.context.pricescale === 1000).versions.length, 1);
  const before = await readFile(filePaths(f, a.receipt).payload);
  await assert.rejects(f.store.record(a.plan.plan_id, a.plan.plan_hash, true, async () => { throw new Error("must not recapture"); }), /plan_not_found/);
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "committed");
  assert.deepEqual(await readFile(filePaths(f, a.receipt).payload), before);
});

test("105-3 receipt time gates as-of independently of observation time", async (t) => {
  const f = await fixture(t, { afterPublish: async (stage) => { if (stage === "payload") f.setTime("2026-10-22T00:01:00.000Z"); } });
  await record(f);
  assert.equal((await f.store.history({ ...query, as_of: "2026-10-22T00:00:30.000Z" })).bars.length, 0);
  assert.equal((await f.store.history(query)).bars[0].first_seen_at, "2026-10-22T00:00:00.000Z");
});

test("105-3 pending payload is not committed; lost acknowledgement uses original status", async (t) => {
  let fail = "payload";
  const f = await fixture(t, { afterPublish: async (stage) => { if (stage === fail) throw new Error("synthetic publication failure"); } });
  let p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => capture(f.time())), /synthetic publication/);
  assert.equal((await f.store.status(p.recording_id)).status, "pending");
  assert.equal((await f.store.history(query)).bars.length, 0);
  fail = "receipt"; p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => capture(f.time())), /synthetic publication/);
  assert.equal((await f.store.status(p.recording_id)).status, "committed");
  assert.equal((await f.store.history(query)).bars.length, 1);
});

test("105-3 corrupted/missing receipt evidence is an error, never empty history", async (t) => {
  const f = await fixture(t), a = await record(f), paths = filePaths(f, a.receipt);
  const original = await readFile(paths.payload);
  await writeFile(paths.payload, "{}"); await assert.rejects(f.store.history(query));
  await writeFile(paths.payload, original); await rm(paths.payload);
  await assert.rejects(f.store.history(query), /ENOENT/);
  await writeFile(paths.receipt, "malformed"); await assert.rejects(f.store.history(query), /JSON/);
});

nodeTest("105-3 strict scope, finite OHLCV, context and successor clocks", () => {
  const valid = capture("2026-10-22T00:00:00.000Z");
  for (const mutate of [
    (p) => p.series.pop(), (p) => { p.series[0].bars = []; },
    (p) => { p.series[0].bars[0].close = NaN; }, (p) => { p.series[0].bars[0].volume = -1; },
    (p) => { p.series[0].bars[0].high = 7; }, (p) => { p.series[0].context.chart_style = "renko"; },
    (p) => { delete p.series[0].context.subsession_id; }, (p) => { p.series[0].context.minmov = 2; },
    (p) => { p.series[0].observed_at = "2026-10-19T00:00:00.000Z"; },
    (p) => { p.series[0].bars[0].confirmed_by_next_bar_at = "2026-10-23T00:00:00.000Z"; },
    (p) => { p.series[0].imported = true; },
  ]) { const p = structuredClone(valid); mutate(p); assert.equal(nativeBarCaptureSchema.safeParse(p).success, false); }
});

nodeTest("105-3 Windows refuses unverified private access before any write", { skip: process.platform !== "win32" }, async () => {
  await assert.rejects(new NativeBarHistory().prepareRecording(targets), /private_access_unverified/);
});

nodeTest("105-3 timestamps use the four-digit UTC year supported by receipt partitions and ordering", () => {
  assert.equal(nativeBarTimestamp.safeParse("2026-10-22T00:00:00.000Z").success, true);
  assert.equal(nativeBarTimestamp.safeParse("+010000-01-01T00:00:00.000Z").success, false);
});

test("105-3 pre-capture quota/lock contention/stale plans never touch charts", async (t) => {
  const f = await fixture(t, { quotaBytes: 1024 ** 2 }); let called = false;
  const p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => { called = true; return capture(f.time()); }), /capacity/);
  assert.equal(called, false);
  const g = await fixture(t); await record(g);
  const old = await g.store.prepareRecording(targets);
  await record(g);
  await assert.rejects(g.store.record(old.plan_id, old.plan_hash, true, async () => { called = true; return capture(g.time()); }), /store_changed/);
  const busy = await g.store.prepareRecording(targets);
  await writeFile(join(g.directory, ".writer.lock"), "synthetic-owner", { mode: 0o600 });
  await assert.rejects(g.store.record(busy.plan_id, busy.plan_hash, true, async () => { called = true; return capture(g.time()); }), /lock_busy/);
  assert.equal(called, false); assert.equal(await readFile(join(g.directory, ".writer.lock"), "utf8"), "synthetic-owner");
});

test("105-3 clock rollback refuses capture; recovery quarantines exact bytes without restamping", async (t) => {
  const f = await fixture(t), a = await record(f), paths = filePaths(f, a.receipt);
  const bytes = await readFile(paths.payload);
  f.setTime("2026-10-21T00:00:00.000Z");
  assert.equal((await f.store.history(query)).clock.status, "clock_ahead");
  const p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => { throw new Error("must not capture"); }), /clock_ahead/);
  const recovery = await f.store.prepareMaintenance("clock_recovery");
  assert.equal(recovery.pairs.length, 1);
  const result = await f.store.maintain(recovery.plan_id, recovery.plan_hash, true, "clock_recovery");
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "quarantined");
  assert.deepEqual(await readFile(join(f.directory, "quarantine", result.maintenance_id, `${a.receipt.recording_id}.payload.json`)), bytes);
  assert.equal((await f.store.history(query)).bars.length, 0);
  const b = await record(f);
  assert.ok(b.receipt.sequence > a.receipt.sequence);
  assert.equal((await f.store.history(query)).bars[0].first_seen_at, f.time());
});

for (const kind of ["clock_recovery", "prune"]) test(`105-3 interrupted ${kind} blocks partial history and needs fresh exact approval`, async (t) => {
  let fail = true;
  const f = await fixture(t, { afterPublish: async (stage) => { if (fail && stage === "maintenance_receipt") throw new Error("synthetic interruption"); } });
  const a = await record(f);
  f.setTime(kind === "prune" ? "2027-02-01T00:00:00.000Z" : "2026-10-21T00:00:00.000Z");
  const p = await f.store.prepareMaintenance(kind);
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, kind), /synthetic interruption/);
  await assert.rejects(f.store.history(query), /maintenance_incomplete/);
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "maintenance_incomplete");
  const resume = await f.store.prepareMaintenance(kind); assert.ok(resume.resume_id); fail = false;
  await f.store.maintain(resume.plan_id, resume.plan_hash, true, kind);
  assert.equal((await f.store.status(a.receipt.recording_id)).status, kind === "prune" ? "pruned" : "quarantined");
  const h = await f.store.history(query); assert.equal(h.bars.length, 0); assert.equal(h.history_truncated, kind === "prune");
});

test("105-3 retention is elapsed receipt age, never old bar-open age; no automatic deletion", async (t) => {
  const f = await fixture(t), a = await record(f);
  assert.equal((await f.store.prepareMaintenance("prune")).pairs.length, 0);
  f.setTime("2027-01-20T00:00:00.000Z"); // exactly 90 days is not older than the cutoff
  assert.equal((await f.store.prepareMaintenance("prune")).pairs.length, 0);
  f.setTime("2027-01-20T00:00:00.001Z");
  const p = await f.store.prepareMaintenance("prune"); assert.equal(p.pairs.length, 1);
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "committed");
  f.setTime("2027-01-21T00:00:00.000Z"); const b = await record(f, 8.55);
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "prune"), /stale|expired/);
  const fresh = await f.store.prepareMaintenance("prune"); await f.store.maintain(fresh.plan_id, fresh.plan_hash, true, "prune");
  const h = await f.store.history(query); assert.equal(h.history_truncated, true);
  assert.equal(h.bars[0].first_seen_at, b.receipt.recorded_at);
  assert.equal(h.bars[0].first_seen_scope, "earliest_retained");
  assert.equal((await f.store.history({ ...query, as_of: a.receipt.recorded_at })).bars.length, 0);
});

test("105-3 path safety refuses links, unsafe owned modes, Git and production temporary roots", async (t) => {
  const f = await fixture(t);
  const production = new NativeBarHistory({ directory: f.directory });
  await assert.rejects(production.prepareRecording(targets), /temporary_root/);
  await symlink(f.base, f.directory);
  await assert.rejects(f.store.prepareRecording(targets), /unsafe_path/);
  await rm(f.directory); await mkdir(f.directory, { mode: 0o777 }); await chmod(f.directory, 0o777);
  await assert.rejects(f.store.prepareRecording(targets), /permissions/);
  await chmod(f.directory, 0o700); await mkdir(join(f.base, ".git"));
  await assert.rejects(f.store.prepareRecording(targets), /git_checkout/);
});

test("105-3 initialized metadata is distinguished from failed collection; backdating rejected", async (t) => {
  const f = await fixture(t); let p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => { throw new Error("synthetic Replay/restore failure"); }), /Replay/);
  assert.deepEqual((await readdir(f.directory)).sort(), ["policy.json"]);
  assert.equal((await f.store.status(p.recording_id)).status, "not_found");
  p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => capture("2026-10-21T00:00:00.000Z")), /clock/);
  assert.equal((await f.store.history(query)).bars.length, 0);
});

test("105-3 simultaneous processes serialize before collection and never reclaim a live lock", async (t) => {
  const f = await fixture(t), second = new NativeBarHistory(f.options);
  const a = await f.store.prepareRecording(targets), b = await second.prepareRecording(targets);
  let release, entered;
  const gate = new Promise((r) => { release = r; }), started = new Promise((r) => { entered = r; });
  const first = f.store.record(a.plan_id, a.plan_hash, true, async () => { entered(); await gate; return capture(f.time()); });
  await started;
  await assert.rejects(second.record(b.plan_id, b.plan_hash, true, async () => { throw new Error("second collector must not run"); }), /lock_busy/);
  release(); assert.equal((await first).status, "committed");
  assert.equal((await second.history(query)).bars[0].versions.length, 1);
});

test("105-3 capture completes chart restoration before payload publication; collection failure publishes no bars", async (t) => {
  let chartLocked = false;
  const f = await fixture(t, { afterPublish: async () => { assert.equal(chartLocked, false); } });
  const p = await f.store.prepareRecording(targets);
  await f.store.record(p.plan_id, p.plan_hash, true, async () => {
    assert.ok((await lstat(join(f.directory, ".writer.lock"))).isFile());
    chartLocked = true;
    try { return capture(f.time()); }
    finally { chartLocked = false; }
  });
  assert.equal((await f.store.status(p.recording_id)).status, "committed");
});

test("105-3 preview objects cannot mutate the process-local approved scope or policy", async (t) => {
  const f = await fixture(t), p = await f.store.prepareRecording(targets);
  p.targets[0].symbol = "OANDA:OTHER"; p.policy.symbols[0] = "OANDA:OTHER";
  await f.store.record(p.plan_id, p.plan_hash, true, async (actual) => {
    assert.equal(actual[0].symbol, symbols[0]); return capture(f.time());
  });
  assert.equal((await f.store.history(query)).bars.length, 1);
});

test("105-3 query limits and noncanonical/duplicate-key evidence fail closed", async (t) => {
  const f = await fixture(t), a = await record(f), path = filePaths(f, a.receipt).receipt;
  await assert.rejects(f.store.history({ ...query, limit: 1000 }));
  const bytes = await readFile(path, "utf8");
  await writeFile(path, " " + bytes); await assert.rejects(f.store.history(query), /noncanonical/);
  await writeFile(path, bytes.replace('{', '{"schema":"ignored",'));
  await assert.rejects(f.store.history(query), /noncanonical/);
});

test("105-3 maintenance rechecks eligibility if wall clock moves backward after preview", async (t) => {
  const f = await fixture(t); await record(f);
  f.setTime("2027-02-01T00:00:00.000Z"); const p = await f.store.prepareMaintenance("prune");
  f.setTime("2026-10-23T00:00:00.000Z");
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "prune"), /eligibility_changed/);
  assert.equal((await f.store.history(query)).bars.length, 1);
});

test("105-3 interrupted exclusive quarantine publication resumes without overwriting or restamping", async (t) => {
  let fail = true;
  const f = await fixture(t, { afterPublish: async (stage) => { if (fail && stage === "quarantine_linked") throw new Error("synthetic link interruption"); } });
  const a = await record(f); f.setTime("2026-10-21T00:00:00.000Z");
  let p = await f.store.prepareMaintenance("clock_recovery");
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "clock_recovery"), /link interruption/);
  await assert.rejects(f.store.history(query), /maintenance_incomplete/);
  p = await f.store.prepareMaintenance("clock_recovery"); fail = false;
  await f.store.maintain(p.plan_id, p.plan_hash, true, "clock_recovery");
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "quarantined");
});

test("105-3 observations less than a minute ahead still refuse new evidence rather than clamping clocks", async (t) => {
  const f = await fixture(t); await record(f); f.setTime("2026-10-21T23:59:30.000Z");
  assert.equal((await f.store.prepareMaintenance("clock_recovery")).pairs.length, 0);
  const p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => { throw new Error("not fresh"); }), /clock_ahead/);
});

test("105-3 exact prune preserves unplanned owner files", async (t) => {
  const f = await fixture(t); await record(f);
  const path = join(f.directory, "unfamiliar-owner-file.json");
  await writeFile(path, "synthetic owner note", { mode: 0o600 });
  f.setTime("2027-02-01T00:00:00.000Z");
  const p = await f.store.prepareMaintenance("prune"); await f.store.maintain(p.plan_id, p.plan_hash, true, "prune");
  assert.equal(await readFile(path, "utf8"), "synthetic owner note");
});

test("105-3 rejects a capture before it exceeds the readable evidence budget", async (t) => {
  const payloadBytes = Buffer.byteLength(canonical(capture("2026-10-22T00:00:00.000Z")));
  const f = await fixture(t, { queryBytesLimit: payloadBytes + 16384 + 1024 });
  const first = await record(f);
  const p = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => capture(f.time())), /history_query_capacity/);
  assert.equal((await f.store.status(first.receipt.recording_id)).status, "committed");
  assert.equal((await f.store.history(query)).bars.length, 1);
  f.setTime("2027-02-01T00:00:00.000Z");
  const prune = await f.store.prepareMaintenance("prune");
  await f.store.maintain(prune.plan_id, prune.plan_hash, true, "prune");
  assert.equal((await f.store.history(query)).bars.length, 0);
});

test("105-3 unchanged values keep latest successor proof paired with their latest receipt", async (t) => {
  const f = await fixture(t), first = await record(f);
  f.setTime("2026-10-22T00:01:00.000Z");
  const payload = capture(f.time()), p = await f.store.prepareRecording(targets);
  for (const s of payload.series) s.bars[0].confirmed_by_next_bar_at = "2026-10-20T01:15:00.000Z";
  const latest = await f.store.record(p.plan_id, p.plan_hash, true, async () => payload);
  const row = (await f.store.history(query)).bars[0];
  assert.equal(row.versions.length, 1); assert.equal(row.first_seen_at, first.receipt.recorded_at);
  assert.equal(row.versions[0].recording_id, latest.receipt.recording_id);
  assert.equal(row.versions[0].confirmed_by_next_bar_at, "2026-10-20T01:15:00.000Z");
  const earlier = await f.store.history({ ...query, as_of: first.receipt.recorded_at });
  assert.equal(earlier.bars[0].versions[0].confirmed_by_next_bar_at, "2026-10-20T01:00:00.000Z");
});

test("105-3 invalid UTF-8 cannot alias a canonical replacement character", async (t) => {
  const f = await fixture(t), a = await record(f, 8.54, null, { exchange: "\ufffd" });
  const path = filePaths(f, a.receipt).payload, bytes = await readFile(path), index = bytes.indexOf(Buffer.from("\ufffd"));
  assert.ok(index >= 0);
  await writeFile(path, Buffer.concat([bytes.subarray(0, index), Buffer.from([0xff]), bytes.subarray(index + 3)]));
  await assert.rejects(f.store.history(query), /canonical|UTF-8/);
});

test("105-3 maintenance refuses metadata growth before making existing history unreadable", async (t) => {
  const f = await fixture(t, { maintenanceMetadataLimitBytes: 1500 });
  let now = Date.parse(f.time());
  for (let i = 0; i < 3; i++) {
    const latest = await record(f);
    now += 91 * 86400000; f.setTime(new Date(now).toISOString());
    const p = await f.store.prepareMaintenance("prune");
    if (i < 2) await f.store.maintain(p.plan_id, p.plan_hash, true, "prune");
    else {
      await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "prune"), /maintenance_metadata_capacity/);
      assert.equal((await f.store.status(latest.receipt.recording_id)).status, "committed");
      assert.equal((await f.store.history(query)).bars.length, 1);
    }
  }
});

test("105-3 review: dead process locks recover but live and unknown owners do not", async (t) => {
  const f = await fixture(t); await record(f);
  const child = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
  const lock = join(f.directory, ".writer.lock");
  await writeFile(lock, canonical({ pid: Number(child.stdout), token: "00000000-0000-4000-8000-000000000001" }), { mode: 0o600 });
  assert.equal((await record(f)).status, "committed");
  await writeFile(lock, canonical({ pid: process.pid, token: "00000000-0000-4000-8000-000000000002" }), { mode: 0o600 });
  await assert.rejects(record(f), /lock_busy/);
  await writeFile(lock, "unknown owner");
  await assert.rejects(record(f), /lock_busy/);
});

test("105-3 review: receipt side files never become committed evidence or pending records", async (t) => {
  const f = await fixture(t), a = await record(f), paths = filePaths(f, a.receipt);
  const dir = join(f.directory, "receipts", a.receipt.day);
  for (const name of [".DS_Store", ".interrupted.stage", "owner-note.json"]) {
    await writeFile(join(dir, name), "not a receipt", { mode: 0o644 });
  }
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "committed");
  assert.equal((await f.store.history(query)).bars.length, 1);
  await writeFile(paths.receipt, "broken committed receipt");
  await assert.rejects(f.store.history(query), /JSON/);
});

test("105-3 review: pruning never fabricates an initial version or original occurrence number", async (t) => {
  const f = await fixture(t), a = await record(f);
  f.setTime("2027-01-21T00:00:00.000Z"); const b = await record(f, 8.55);
  const p = await f.store.prepareMaintenance("prune");
  await f.store.maintain(p.plan_id, p.plan_hash, true, "prune");
  const h = await f.store.history(query), v = h.bars[0].versions[0];
  assert.equal(v.change_kind, "retained_origin_unknown");
  assert.equal(v.occurrence, null);
  assert.equal(v.retained_occurrence, 1);
  assert.equal(h.retention_coverage.pruned_through_recorded_at, a.receipt.recorded_at);
  assert.equal(h.retention_coverage.earliest_retained_recorded_at, b.receipt.recorded_at);
  assert.equal(h.retention_coverage.continuous_market_coverage, false);
});

test("105-3 review: wall-clock expiry cannot be bypassed with an unchanged monotonic clock", async (t) => {
  const f = await fixture(t), p = await f.store.prepareRecording(targets);
  f.setTime(p.expires_at);
  await assert.rejects(f.store.record(p.plan_id, p.plan_hash, true, async () => { throw new Error("must not capture"); }), /plan_expired/);
  assert.deepEqual(await readdir(f.base), []);
});

test("105-3 review: UTC midnight does not orphan an otherwise valid capture", async (t) => {
  const f = await fixture(t, { afterPublish: async (s) => { if (s === "payload") f.setTime("2026-10-23T00:00:00.001Z"); } });
  f.setTime("2026-10-22T23:59:59.999Z");
  const a = await record(f);
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "committed");
  assert.equal((await f.store.history(query)).bars.length, 1);
  assert.equal(a.receipt.day, "2026-10-22"); assert.equal(a.receipt.partition_at, "2026-10-22T23:59:59.999Z");
  assert.equal(a.receipt.recorded_at, "2026-10-23T00:00:00.001Z");
  assert.equal((await f.store.history({ ...query, as_of: "2026-10-23T00:00:00.000Z" })).bars.length, 0);
});

test("105-3 review: an empty interrupted initialization can be previewed without writes", async (t) => {
  const f = await fixture(t); await mkdir(f.directory, { mode: 0o700 });
  const p = await f.store.prepareRecording(targets);
  assert.equal(p.store_status, "initialization_incomplete");
  assert.deepEqual(await readdir(f.directory), []);
  assert.equal((await record(f)).status, "committed");
});

test("105-3 review: recording preview discloses temporary pane changes", async (t) => {
  const f = await fixture(t), p = await f.store.prepareRecording(targets);
  assert.deepEqual(p.chart_changes.targets.map((v) => v.temporary_timeframes), [["15", "60"], ["15", "60"]]);
  assert.equal(p.chart_changes.restore_selected_pane, true);
});

test("105-3 review: maintenance ids are not pending recording ids", async (t) => {
  const f = await fixture(t); await record(f); f.setTime("2027-02-01T00:00:00.000Z");
  const p = await f.store.prepareMaintenance("prune"), m = await f.store.maintain(p.plan_id, p.plan_hash, true, "prune");
  assert.equal((await f.store.status(m.maintenance_id)).status, "not_found");
});

nodeTest("105-3 review: explicit and inherited macOS ACLs fail closed without changing them", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture(t); await record(f);
  await promisify(execFile)("/bin/chmod", ["+a", "everyone allow write", f.directory]);
  await assert.rejects(f.store.prepareRecording(targets), /acl/);
  await promisify(execFile)("/bin/chmod", ["-N", f.directory]);
  await promisify(execFile)("/bin/chmod", ["+a", "everyone allow write,directory_inherit,file_inherit", f.base]);
  const inherited = join(f.base, "inherited"); await mkdir(inherited, { mode: 0o700 });
  const store = new NativeBarHistory({ ...f.options, directory: inherited });
  await assert.rejects(store.prepareRecording(targets), /acl/);
});

test("105-3 review: forged resume intents cannot prune fresh evidence", async (t) => {
  const f = await fixture(t), a = await record(f), paths = filePaths(f, a.receipt);
  const id = "00000000-0000-4000-8000-000000000099", before = await readFile(paths.payload);
  await mkdir(join(f.directory, "maintenance"), { mode: 0o700 });
  await writeFile(join(f.directory, "maintenance", `${id}.json`), canonical({ schema: "native-bar-maintenance-v1", id,
    kind: "prune", created_at: f.time(), generation: evidenceHash("forged synthetic generation"),
    pairs: [{ recording_id: a.receipt.recording_id, sequence: a.receipt.sequence, day: a.receipt.day,
      payload_hash: a.receipt.payload_hash, receipt_hash: evidenceHash(a.receipt), bytes: before.length + 1024,
      recorded_at: "2020-01-01T00:00:00.000Z", last_observed_at: "2020-01-01T00:00:00.000Z" }] }), { mode: 0o600 });
  const p = await f.store.prepareMaintenance("prune");
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "prune"), /maintenance_(evidence|eligibility)/);
  assert.deepEqual(await readFile(paths.payload), before);
  assert.ok((await lstat(paths.receipt)).isFile());
});

test("105-3 review: startup overrides are restricted to explicit private storage namespaces", async () => {
  const store = new NativeBarHistory({ directory: "/Users/Shared/native-bar-data" });
  await assert.rejects(store.prepareRecording(targets), /root_not_allowlisted/);
});

test("105-3 review: production maintenance fails closed before IO even with an otherwise valid plan", async (t) => {
  const f = await fixture(t), a = await record(f), path = filePaths(f, a.receipt).payload, before = await readFile(path);
  f.setTime("2027-02-01T00:00:00.000Z");
  const p = await f.store.prepareMaintenance("prune");
  assert.equal(p.execution_available, true); // this fixture alone opts into the synthetic implementation
  delete f.options.testOnly;
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "prune"), /anchored_filesystem_operations_required/);
  assert.deepEqual(await readFile(path), before);
  assert.equal((await readdir(f.directory)).includes("maintenance"), false);
});

test("105-3 review: concurrent side-file churn does not invalidate committed receipt inventory", async (t) => {
  const f = await fixture(t), a = await record(f), original = f.store.inventory.bind(f.store);
  let scans = 0;
  f.store.inventory = async () => {
    const result = await original();
    if (++scans === 1) await writeFile(join(f.directory, "receipts", a.receipt.day, ".another-process.stage"), "synthetic staging", { mode: 0o600 });
    return result;
  };
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "committed");
  assert.ok(scans >= 2);
});

test("105-3 review: dead takeover marker is recoverable but a live marker is preserved", async (t) => {
  const f = await fixture(t); await record(f);
  const child = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
  const path = join(f.directory, ".writer.takeover");
  await writeFile(path, canonical({ pid: Number(child.stdout), token: "00000000-0000-4000-8000-000000000008" }), { mode: 0o600 });
  assert.equal((await record(f)).status, "committed");
  const live = canonical({ pid: process.pid, token: "00000000-0000-4000-8000-000000000009" });
  await writeFile(path, live, { mode: 0o600 });
  await assert.rejects(record(f), /lock_busy/);
  assert.equal(await readFile(path, "utf8"), live);
});

test("105-3 review: multiple real processes serialize dead-lock takeover and collection", async (t) => {
  const f = await fixture(t); await mkdir(f.directory, { mode: 0o700 });
  const child = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
  const owner = { pid: Number(child.stdout), token: "00000000-0000-4000-8000-000000000071" };
  for (const name of [".writer.lock", ".writer.takeover", `.writer-claim-${owner.token}.json`]) {
    await writeFile(join(f.directory, name), canonical(owner), { mode: 0o600 });
  }
  const code = `import {open,unlink} from 'node:fs/promises';
    import {join} from 'node:path';
    const {takeNativeWriterLock}=await import(process.argv[1]);
    for(let i=0;i<8;i++){
      const lock=await takeNativeWriterLock(process.argv[2],async()=>{},10000);
      const sentinel=join(process.argv[2],'synthetic-exclusive-section');
      try{const fd=await open(sentinel,'wx',0o600);await fd.close();
        await new Promise(r=>setTimeout(r,3));await unlink(sentinel);
      }finally{if(!lock.release())throw Error('release failed');}
    }`;
  const url = new URL("../../build/nativeBarAccess.js", import.meta.url).href;
  await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath,
    ["--input-type=module", "-e", code, url, f.directory], { timeout: 30000 })));
  assert.equal((await readdir(f.directory)).includes("synthetic-exclusive-section"), false);
});

const incarnationTest = ["darwin", "linux"].includes(process.platform) ? nodeTest : nodeTest.skip;
incarnationTest("105-3 re-review: a reused PID or another boot session never keeps a dead writer's entries alive", async (t) => {
  const f = await fixture(t); await record(f);
  // The parent process is alive, but it is not the process that wrote these entries.
  const reused = { boot: null, pid: process.ppid, start: "000000000000", token: "00000000-0000-4000-8000-000000000081" };
  await writeFile(join(f.directory, `.writer-claim-${reused.token}.json`), canonical(reused), { mode: 0o600 });
  await writeFile(join(f.directory, `.writer-ticket-${reused.token}.json`), canonical({ ...reused, ticket: 1 }), { mode: 0o600 });
  const otherBoot = { boot: "ffffffffffff", pid: process.ppid, start: null, token: "00000000-0000-4000-8000-000000000082" };
  await writeFile(join(f.directory, ".writer.lock"), canonical(otherBoot), { mode: 0o600 });
  const r = await record(f, 8.55);
  assert.equal(r.status, "committed");
  const status = await f.store.status(r.receipt.recording_id);
  assert.ok(status.side_files.writer_coordination >= 3); // dead entries are preserved and counted, never deleted
  assert.ok((await readdir(f.directory)).includes(`.writer-claim-${reused.token}.json`));
  // An earlier-build entry naming a live PID cannot be proven dead, so it still blocks.
  const legacy = join(f.directory, ".writer-claim-00000000-0000-4000-8000-000000000083.json");
  await writeFile(legacy, canonical({ pid: process.ppid, token: "00000000-0000-4000-8000-000000000083" }), { mode: 0o600 });
  await assert.rejects(record(f), /active writer queue/);
  await rm(legacy); assert.equal((await record(f, 8.56)).status, "committed");
});

test("105-3 re-review: a live lock outside the queue is waited on for the whole lock wait", async (t) => {
  const f = await fixture(t); await record(f);
  await writeFile(join(f.directory, ".writer.lock"), canonical({ pid: process.pid, token: "00000000-0000-4000-8000-000000000084" }), { mode: 0o600 });
  const store = new NativeBarHistory({ ...f.options, lockWaitMs: 600 }), p = await store.prepareRecording(targets);
  const started = performance.now();
  await assert.rejects(store.record(p.plan_id, p.plan_hash, true, async () => { throw new Error("must not capture"); }), /live or unknown owner/);
  assert.ok(performance.now() - started >= 550);
});

test("105-3 re-review: a failed lock release is reported without hiding a committed recording", async (t) => {
  const f = await fixture(t), p = await f.store.prepareRecording(targets);
  const r = await f.store.record(p.plan_id, p.plan_hash, true, async () => {
    await rm(join(f.directory, ".writer.lock")); return capture(f.time());
  });
  assert.equal(r.status, "committed"); assert.match(r.writer_lock_release, /failed/);
  assert.equal((await f.store.status(p.recording_id)).status, "committed");
});

nodeTest("105-3 re-review: batched ACL inspection accepts deny-only entries and refuses a grant on any evidence file", { skip: process.platform !== "darwin" }, async (t) => {
  const f = await fixture(t), a = await record(f); f.setTime("2026-10-22T01:00:00.000Z");
  const b = await record(f, 8.55); f.setTime("2026-10-22T02:00:00.000Z"); await record(f, 8.56);
  const exec = promisify(execFile);
  await exec("/bin/chmod", ["+a", "everyone deny write", filePaths(f, a.receipt).receipt]);
  assert.equal((await f.store.history(query)).bars[0].versions.length, 3);
  await exec("/bin/chmod", ["+a", "everyone allow read", filePaths(f, b.receipt).payload]);
  await assert.rejects(f.store.history(query), /unsafe_acl/);
});

test("105-3 re-review: an approved clock recovery can finish after the corrected clock passes its stamps", async (t) => {
  let fail = true;
  const f = await fixture(t, { afterPublish: async (stage) => { if (fail && stage === "quarantine_linked") throw new Error("synthetic link interruption"); } });
  const a = await record(f); f.setTime("2026-10-21T22:00:00.000Z");
  let p = await f.store.prepareMaintenance("clock_recovery");
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "clock_recovery"), /link interruption/);
  f.setTime("2026-10-22T03:00:00.000Z"); fail = false;
  p = await f.store.prepareMaintenance("clock_recovery"); assert.ok(p.resume_id);
  await f.store.maintain(p.plan_id, p.plan_hash, true, "clock_recovery");
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "quarantined");
  assert.equal((await f.store.history(query)).bars.length, 0);
});

test("105-3 re-review: a prune approved under a clock running ahead resumes after the correction", async (t) => {
  let fail = true;
  const f = await fixture(t, { afterPublish: async (stage) => { if (fail && stage === "maintenance_receipt") throw new Error("synthetic interruption"); } });
  const a = await record(f); f.setTime("2027-03-01T00:00:00.000Z");
  let p = await f.store.prepareMaintenance("prune");
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "prune"), /synthetic interruption/);
  f.setTime("2027-02-01T00:00:00.000Z"); fail = false;
  p = await f.store.prepareMaintenance("prune"); assert.ok(p.resume_id);
  await f.store.maintain(p.plan_id, p.plan_hash, true, "prune");
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "pruned");
});

test("105-3 re-review: a forged clock-recovery intent with an old approval time is not bound to the store", async (t) => {
  const f = await fixture(t), a = await record(f), paths = filePaths(f, a.receipt);
  const id = "00000000-0000-4000-8000-000000000098", before = await readFile(paths.payload);
  await mkdir(join(f.directory, "maintenance"), { mode: 0o700 });
  await writeFile(join(f.directory, "maintenance", `${id}.json`), canonical({ schema: "native-bar-maintenance-v1", id,
    kind: "clock_recovery", created_at: "2020-01-01T00:00:00.000Z", generation: evidenceHash("forged synthetic generation"),
    pairs: [{ recording_id: a.receipt.recording_id, sequence: a.receipt.sequence, day: a.receipt.day,
      payload_hash: a.receipt.payload_hash, receipt_hash: evidenceHash(a.receipt), bytes: before.length + 1024,
      recorded_at: a.receipt.recorded_at, last_observed_at: f.time() }] }), { mode: 0o600 });
  const p = await f.store.prepareMaintenance("clock_recovery");
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "clock_recovery"), /not bound to this store state/);
  assert.deepEqual(await readFile(paths.payload), before);
});

test("105-3 re-review: plan expiry during payload publication cannot strand the payload", async (t) => {
  let expires = null;
  const f = await fixture(t, { afterPublish: async (s) => { if (s === "payload" && expires) f.setTime(expires); } });
  const p = await f.store.prepareRecording(targets); expires = p.expires_at;
  assert.equal((await f.store.record(p.plan_id, p.plan_hash, true, async () => capture(f.time()))).status, "committed");
  assert.equal((await f.store.status(p.recording_id)).status, "committed");
});

test("105-3 re-review: retention coverage keeps the known prune boundary beside legacy intents", async (t) => {
  const f = await fixture(t), a = await record(f); f.setTime("2026-10-23T00:00:00.000Z");
  const b = await record(f, 8.55), legacy = filePaths(f, a.receipt);
  const id = "00000000-0000-4000-8000-000000000097", bytes = (await readFile(legacy.payload)).length + (await readFile(legacy.receipt)).length;
  const intent = { schema: "native-bar-maintenance-v1", id, kind: "prune", created_at: f.time(), generation: evidenceHash("legacy synthetic"),
    pairs: [{ recording_id: a.receipt.recording_id, sequence: a.receipt.sequence, day: a.receipt.day,
      payload_hash: a.receipt.payload_hash, receipt_hash: evidenceHash(a.receipt), bytes }] };
  await mkdir(join(f.directory, "maintenance"), { mode: 0o700 });
  await writeFile(join(f.directory, "maintenance", `${id}.json`), canonical(intent), { mode: 0o600 });
  await writeFile(join(f.directory, "maintenance", `${id}.done.json`), canonical({ id, intent_hash: evidenceHash(intent) }), { mode: 0o600 });
  await rm(legacy.payload); await rm(legacy.receipt);
  f.setTime("2027-02-01T00:00:00.000Z");
  const p = await f.store.prepareMaintenance("prune"); await f.store.maintain(p.plan_id, p.plan_hash, true, "prune");
  await record(f, 8.56);
  const h = await f.store.history(query);
  assert.equal(h.retention_coverage.pruned_through_recorded_at, b.receipt.recorded_at);
  assert.equal(h.retention_coverage.legacy_pruned_times_unknown, true);
  assert.equal(h.bars[0].versions[0].change_kind, "retained_origin_unknown");
});

test("105-3 re-review: bars opening after the prune boundary keep initial versions and occurrence numbers", async (t) => {
  const f = await fixture(t); await record(f);
  f.setTime("2027-01-21T00:00:00.000Z"); await record(f, 8.55);
  const p = await f.store.prepareMaintenance("prune"); await f.store.maintain(p.plan_id, p.plan_hash, true, "prune");
  f.setTime("2027-01-21T02:00:00.000Z");
  const later = capture(f.time());
  for (const s of later.series) s.bars = [{ ...s.bars[0], bar_open_at: "2027-01-21T00:00:00.000Z", confirmed_by_next_bar_at: "2027-01-21T01:00:00.000Z" }];
  const plan = await f.store.prepareRecording(targets);
  await f.store.record(plan.plan_id, plan.plan_hash, true, async () => later);
  const h = await f.store.history(query), fresh = h.bars.find((b) => b.bar_open_at === "2027-01-21T00:00:00.000Z");
  const old = h.bars.find((b) => b.bar_open_at === "2026-10-20T00:00:00.000Z");
  assert.equal(h.history_truncated, true);
  assert.equal(fresh.versions[0].change_kind, "initial"); assert.equal(fresh.versions[0].occurrence, 1);
  assert.equal(fresh.first_seen_scope, "local_observations_only");
  assert.equal(old.versions[0].change_kind, "retained_origin_unknown"); assert.equal(old.first_seen_scope, "earliest_retained");
});

test("105-3 re-review: disabled maintenance issues no plan, refuses before consuming one and names the clock wait", async (t) => {
  const f = await fixture(t, { syntheticMaintenance: false }), a = await record(f);
  f.setTime("2027-02-01T00:00:00.000Z");
  const p = await f.store.prepareMaintenance("prune");
  assert.equal(p.plan_id, null); assert.equal(p.plan_hash, null); assert.equal(p.execution_available, false);
  assert.equal(p.pairs.length, 1); assert.match(p.execution_blocker, /no plan issued/);
  await assert.rejects(f.store.maintain("00000000-0000-4000-8000-000000000001", "f".repeat(64), true, "prune"), /anchored_filesystem_operations_required/);
  assert.equal((await f.store.status(a.receipt.recording_id)).status, "committed");
  f.setTime("2026-10-21T00:00:00.000Z");
  const r = await f.store.prepareRecording(targets);
  await assert.rejects(f.store.record(r.plan_id, r.plan_hash, true, async () => { throw new Error("must not capture"); }), /clock recovery execution is disabled/);
  const synthetic = await fixture(t); await record(synthetic); synthetic.setTime("2027-02-01T00:00:00.000Z");
  const m = await synthetic.store.prepareMaintenance("prune");
  assert.equal("recording_id" in m, false); assert.equal("chart_changes" in m, false); assert.equal("bindings_verified" in m, false);
  assert.equal(m.warnings.some((w) => /initialize metadata/.test(w)), false);
});

test("105-3 re-review: side-file-only roots report initialization_incomplete; evidence without policy is a named refusal", async (t) => {
  const f = await fixture(t); await mkdir(f.directory, { mode: 0o700 });
  await writeFile(join(f.directory, ".DS_Store"), "finder", { mode: 0o644 });
  assert.equal((await f.store.history(query)).store_status, "initialization_incomplete");
  assert.equal((await f.store.prepareRecording(targets)).store_status, "initialization_incomplete");
  assert.equal((await record(f)).status, "committed");
  await rm(join(f.directory, "policy.json"));
  await assert.rejects(f.store.history(query), /policy_missing_or_partial_initialization/);
});

test("105-3 re-review: production roots outside the home default are refused, including external volumes", async () => {
  const store = new NativeBarHistory({ directory: "/Volumes/SyntheticVolume/.tradingview-mcp/native-bar-history/v1" });
  await assert.rejects(store.prepareRecording(targets), /root_not_allowlisted/);
});
