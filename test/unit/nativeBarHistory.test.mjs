import nodeTest from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath, chmod, symlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  await assert.rejects(f.store.maintain(p.plan_id, p.plan_hash, true, "prune"), /stale/);
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
  const f = await fixture(t, { maintenanceMetadataLimitBytes: 1024 });
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
