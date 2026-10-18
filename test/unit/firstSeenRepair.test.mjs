import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FirstSeenRepairRefused, parseFirstSeenRepairArguments, runFirstSeenRepair } from "../../build/firstSeenRepairCli.js";
import { AppendOnlyFirstSeenLog } from "../../build/firstSeenStore.js";
import { ResearchCollectionHeartbeatStore } from "../../build/researchCollectionHeartbeat.js";
import { RealYieldFirstSeenStore } from "../../build/realYieldHistory.js";
import { FuturesOpenInterestFirstSeenStore } from "../../build/futuresOpenInterestHistory.js";
import { OfficialPolicyRateHistoryStore } from "../../build/policyRateOfficialHistory.js";
import { MacroSurpriseEvidenceStore } from "../../build/macroSurpriseEvidence.js";
import { checkCollectionHealth, parseCollectionHealthCliArguments } from "../../build/collectionHealthCli.js";
import { FxHistoricalRunLog } from "../../build/fxHistoryRunLog.js";
import { FxHistoricalCheckpointStore, FxHistoricalManifestStore } from "../../build/oandaHistoricalFx.js";
import { runFxHistoryCollection } from "../../build/fxHistoryCollectionCli.js";
import { exportFxHistory } from "../../build/fxHistoryExport.js";

// BACKLOG 103-11 (security review of 0.1.43, L2, and the review of 0.1.44): a record stamped by a clock that ran ahead
// blocks every later record of its first-seen log until the clock reaches it, and setting the clock right does not clear
// it. tradingview-mcp-repair-first-seen moves that tail to a sidecar, by default only saying what it would move.

/** Points the named environment variables at paths in a new directory for one test; returns the directory. */
async function withPaths(t, names) {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-first-seen-repair-"));
  const saved = Object.fromEntries(Object.keys(names).map((name) => [name, process.env[name]]));
  for (const [name, file] of Object.entries(names)) process.env[name] = file === null ? undefined : join(directory, file);
  for (const [name, file] of Object.entries(names)) if (file === null) delete process.env[name];
  t.after(async () => {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
/** Sets TV_MCP_HISTORY_LOCK_WAIT_MS for one test. */
function lockWait(t, ms) {
  const saved = process.env.TV_MCP_HISTORY_LOCK_WAIT_MS;
  process.env.TV_MCP_HISTORY_LOCK_WAIT_MS = String(ms);
  t.after(() => { if (saved === undefined) delete process.env.TV_MCP_HISTORY_LOCK_WAIT_MS; else process.env.TV_MCP_HISTORY_LOCK_WAIT_MS = saved; });
}
/** Takes a store log's lock from this process, as a collector would hold it; returns its release. */
const holdLock = (path) => new AppendOnlyFirstSeenLog(path, "test", (value) => value, { maxFileBytes: 1e8, maxRecordBytes: 1e6 }).acquireFileLock();
const RESEARCH = "TRADINGVIEW_MCP_RESEARCH_COLLECTION_HEARTBEAT_PATH";
const hypotheses = [{ hypothesis_id: "xauusd-15m-bearish-fvg", status: "complete", events: 0, recorded: false }];
const lines = (text) => text.split("\n").filter(Boolean);

/** A research heartbeat log of two runs, then two stamped by a clock years ahead; the clock is right again at `now`. */
async function researchLogAhead(t) {
  const directory = await withPaths(t, { [RESEARCH]: "research-collection-heartbeats.jsonl" });
  const path = process.env[RESEARCH];
  const store = new ResearchCollectionHeartbeatStore(path);
  for (const observed_at of ["2026-10-17T22:00:00.000Z", "2026-10-17T23:00:00.000Z", "2099-01-01T00:00:00.000Z", "2099-01-01T01:00:00.000Z"]) {
    await store.recordRun({ observed_at, hypotheses, chart_restored: true });
  }
  return { directory, path, store, now: new Date("2026-10-18T00:00:30.000Z") };
}

test("a dry run takes no lock, changes nothing and says which records it would move (BACKLOG 103-11)", async (t) => {
  const { directory, path, store, now } = await researchLogAhead(t);
  const before = await readFile(path);
  // The clock is right again, yet the log still refuses the next heartbeat.
  await assert.rejects(() => store.recordRun({ observed_at: now.toISOString(), hypotheses, chart_restored: true }), /clock moved backwards/);
  // A collector holding the lock does not hold a dry run up: it reads and writes nothing.
  const release = await holdLock(path);
  let summary;
  try { summary = await runFirstSeenRepair(["--store", "research-heartbeat"], now); } finally { await release(); }
  assert.deepEqual(summary, { store: "research-heartbeat", now: now.toISOString(), tolerance_ms: 60_000, applied: false, force_required: false,
    logs: [{ label: "research collection heartbeat", path, records: 4, kept: 2, moved: { records: 2, first_sequence: 3, last_sequence: 4,
      first_seen_from: "2099-01-01T00:00:00.000Z", first_seen_to: "2099-01-01T01:00:00.000Z", next_sequence: 3 } }],
    references: ["no store or evidence file of this package cites heartbeat sequences; a collector prints its run's heartbeat sequence only"] });
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual((await readdir(directory)).sort(), ["research-collection-heartbeats.jsonl"], "no sidecar, no temporary file, no lock left");
});

test("--apply takes the time once its locks are held and moves exactly the tail stamped ahead to an owner-only sidecar; the store then takes new records (BACKLOG 103-11)", async (t) => {
  const { directory, path, store, now } = await researchLogAhead(t);
  const original = lines(await readFile(path, "utf8"));
  let lockedWhenTimed = null;
  const summary = await runFirstSeenRepair(["--store", "research-heartbeat", "--apply"], () => { lockedWhenTimed = existsSync(`${path}.lock`); return now; });
  assert.equal(lockedWhenTimed, true, "the clock is read with the store's lock held");
  const sidecar = `${path}.ahead-20261018T000030.000Z.jsonl`;
  assert.deepEqual([summary.applied, summary.sidecars, summary.logs[0].sidecar, summary.logs[0].reused_sidecar, summary.logs[0].records_after, summary.logs[0].moved.records],
    [true, [sidecar], sidecar, false, 2, 2]);
  // The tail, byte for byte, in the sidecar; the rest, byte for byte, in the log.
  assert.equal(await readFile(sidecar, "utf8"), `${original.slice(2).join("\n")}\n`);
  assert.equal(await readFile(path, "utf8"), `${original.slice(0, 2).join("\n")}\n`);
  assert.deepEqual((await readdir(directory)).sort(), ["research-collection-heartbeats.jsonl", "research-collection-heartbeats.jsonl.ahead-20261018T000030.000Z.jsonl"]);
  if (process.platform !== "win32") {   // POSIX modes
    assert.equal((await lstat(sidecar)).mode & 0o777, 0o600);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
  }
  // The store reads the log, takes the next heartbeat at the first moved sequence, and the health check is healthy.
  assert.equal((await store.recordRun({ observed_at: now.toISOString(), hypotheses, chart_restored: true })).sequence, 3);
  assert.equal((await new ResearchCollectionHeartbeatStore(path).coverage(now)).records, 3);
  const health = await checkCollectionHealth(parseCollectionHealthCliArguments(["--scope", "research"]), now);
  assert.deepEqual([health.status, health.research.latest_in_future, health.issues], ["healthy", false, []]);
  // Nothing is ahead any more: a second run refuses, and still says what it found.
  await assert.rejects(() => runFirstSeenRepair(["--store", "research-heartbeat", "--apply"], now),
    (error) => error instanceof FirstSeenRepairRefused && /^nothing in the research-heartbeat store is stamped more than 60 s after 2026-10-18T00:00:30\.000Z; nothing was changed$/.test(error.message)
      && error.summary.logs[0].moved === null);
});

test("records holding bytes that are not UTF-8 are kept and moved byte for byte (BACKLOG 103-11)", async (t) => {
  const directory = await withPaths(t, { [RESEARCH]: "research-collection-heartbeats.jsonl" });
  const path = process.env[RESEARCH];
  const record = (sequence, at, id) => Buffer.concat([Buffer.from(`{"schema_version":"1.0","sequence":${sequence},"series":"research_collection_heartbeat","observation_date":"${at.slice(0, 10)}","first_seen_at":"${at}","hypotheses":[{"hypothesis_id":"`),
    id, Buffer.from(`","status":"complete","events":0,"recorded":false}],"chart_restored":true}\n`)]);
  const kept = record(1, "2026-10-17T22:00:00.000Z", Buffer.from([0x68, 0xff, 0x69])), tail = record(2, "2099-01-01T00:00:00.000Z", Buffer.from([0x78, 0xfe]));
  await writeFile(path, Buffer.concat([kept, tail]), { mode: 0o600 });
  const summary = await runFirstSeenRepair(["--store", "research-heartbeat", "--apply"], new Date("2026-10-18T00:00:30.000Z"));
  assert.ok((await readFile(path)).equals(kept), "the kept record is byte for byte the one written, its stray byte included");
  assert.ok((await readFile(summary.sidecars[0])).equals(tail));
  assert.deepEqual(await readdir(directory).then((names) => names.length), 2);
});

test("a repair that fails before its rename removes what it wrote and changes nothing (BACKLOG 103-11)", async (t) => {
  const { directory, path, now } = await researchLogAhead(t);
  const before = await readFile(path);
  const fsp = createRequire(import.meta.url)("node:fs/promises");
  const realRename = fsp.rename;
  fsp.rename = async () => { throw Object.assign(new Error("EXDEV: injected"), { code: "EXDEV" }); };
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => runFirstSeenRepair(["--store", "research-heartbeat", "--apply"], now),
      (error) => error.message === `research collection heartbeat repair failed (EXDEV: injected): nothing in ${path} was changed`);
  } finally {
    fsp.rename = realRename;
    syncBuiltinESMExports();
  }
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual(await readdir(directory), ["research-collection-heartbeats.jsonl"], "neither the sidecar, the rewritten log nor the lock is left");
});

test("a log that does not read as the store reads it, or is framed otherwise, is refused and left as it was (BACKLOG 103-11)", async (t) => {
  const { path, now } = await researchLogAhead(t);
  const original = await readFile(path, "utf8");
  const refusedUnchanged = async (contents, pattern, apply = false) => {
    await writeFile(path, contents, { mode: 0o600 });
    await assert.rejects(() => runFirstSeenRepair(["--store", "research-heartbeat", ...(apply ? ["--apply"] : [])], now), pattern);
    assert.equal(await readFile(path, "utf8"), contents);
  };
  const [one, two, three, four] = lines(original);
  // A dry run reads without the lock, so a record being appended could be what it saw: it says to run again.
  await refusedUnchanged(`${one}\n${two}\n{"broken":\n${three}\n${four}\n`,
    /research collection heartbeat history .* does not read as the store reads it \(invalid research collection heartbeat history JSON at line 3\); if a collector was appending to it, run the repair again; nothing in it was changed$/);
  await refusedUnchanged(`${one}\n${three}\n${four}\n`, /does not read as the store reads it \(non-contiguous research collection heartbeat sequence at line 2\); nothing in it was changed$/, true);
  await refusedUnchanged(`${one}\n${two}\n${three}\n${four}`, /research collection heartbeat history is not framed as the store writes it .*; settle it by hand; nothing in it was changed$/);
  await refusedUnchanged(`${one}\n\n${two}\n${three}\n${four}\n`, /is not framed as the store writes it/);
  // No log at all: nothing to repair, and no directory or lock is made for it.
  await rm(path);
  await assert.rejects(() => runFirstSeenRepair(["--store", "research-heartbeat"], now), /^Error: there is no research collection heartbeat history at .*; nothing was changed$/);
});

test("the arguments name one known store, take --instrument and --recollect only for fx-history, and --force and --recollect only with --apply (BACKLOG 103-11)", () => {
  assert.deepEqual(parseFirstSeenRepairArguments(["--store", "cot"]), { store: "cot", apply: false, force: false, recollect: false });
  assert.deepEqual(parseFirstSeenRepairArguments(["--store", "fx-history", "--instrument", "USD_JPY", "--apply", "--force", "--recollect"]),
    { store: "fx-history", instrument: "USD_JPY", apply: true, force: true, recollect: true });
  assert.throws(() => parseFirstSeenRepairArguments([]), /--store must be one of research-heartbeat, policy-rate-heartbeat, first-seen-heartbeat, cot, policy-rate, real-yield, futures-open-interest, official-policy-rate, macro-surprise, fx-history/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "analysis-journal"]), /--store must be one of/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "fx-history"]), /--store fx-history needs --instrument/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "cot", "--instrument", "EUR_USD"]), /--instrument belongs to --store fx-history/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "cot", "--apply", "--recollect"]), /--recollect belongs to --store fx-history/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "cot", "--force"]), /--force goes only with --apply/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "fx-history", "--instrument", "EUR_USD", "--recollect"]), /--recollect goes only with --apply/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "cot", "--path", "/x"]), /Unknown option/);
});

const realYield = (overrides) => ({ series: "US_TREASURY_PAR_REAL_CMT_10Y", value: 2.01, source_updated_at_raw: null, observed_feed_year: 2026, ...overrides });

test("the real-yield log, whose sequences evaluation logs cite, is repaired only with --force (BACKLOG 103-11)", async (t) => {
  const directory = await withPaths(t, { TRADINGVIEW_MCP_REAL_YIELD_HISTORY_PATH: "real-yield-first-seen.jsonl" });
  const path = process.env.TRADINGVIEW_MCP_REAL_YIELD_HISTORY_PATH;
  const store = new RealYieldFirstSeenStore(path);
  await store.observe(realYield({ observation_date: "2026-10-15", observed_at: "2026-10-16T01:00:00.000Z" }));
  await store.observe(realYield({ observation_date: "2026-10-16", value: 2.02, observed_at: "2099-10-17T01:00:00.000Z" }));
  const now = new Date("2026-10-18T00:00:00.000Z");
  const before = await readFile(path);
  const dry = await runFirstSeenRepair(["--store", "real-yield"], now);
  assert.deepEqual([dry.force_required, dry.logs[0].moved.first_sequence, dry.references[0]],
    [true, 2, "evaluation_context.real_yield_10y.history_sequence in the evaluation logs `evaluate` writes, at the --log path it was given, which this command cannot find"]);
  await assert.rejects(() => runFirstSeenRepair(["--store", "real-yield", "--apply"], now),
    /^Error: the next records would take the moved sequences again \(real-yield 2-2\), and these may cite a moved record: evaluation_context\.real_yield_10y\.history_sequence .*; check them, then run again with --force; nothing was changed$/);
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual(await readdir(directory), ["real-yield-first-seen.jsonl"]);
  const forced = await runFirstSeenRepair(["--store", "real-yield", "--apply", "--force"], now);
  assert.deepEqual([forced.applied, forced.logs[0].records_after], [true, 1]);
  assert.equal((await store.observe(realYield({ observation_date: "2026-10-16", value: 2.02, observed_at: now.toISOString() }))).sequence, 2);
});

test("the CME futures open-interest, official policy-rate and macro-surprise logs are repaired as the others are (BACKLOG 103-11)", async (t) => {
  const directory = await withPaths(t, { TRADINGVIEW_MCP_FUTURES_OI_HISTORY_PATH: "futures-oi.jsonl", TRADINGVIEW_MCP_POLICY_RATE_OFFICIAL_HISTORY_PATH: "official.jsonl",
    TRADINGVIEW_MCP_MACRO_SURPRISE_EVIDENCE_PATH: "macro.jsonl" });
  const now = new Date("2026-10-18T02:00:00.000Z");
  // The first-seen collector's CME gold open interest, stamped once by a clock decades ahead.
  const futures = new FuturesOpenInterestFirstSeenStore(process.env.TRADINGVIEW_MCP_FUTURES_OI_HISTORY_PATH);
  const oi = (date, value, at) => ({ futures_symbol: "COMEX_DL:GC1!", scope: "all_months_aggregated", observation_date: date, open_interest: value, source: "cme_daily_bulletin",
    source_detail: "GC_FUT", report_status: "final", observed_at: at });
  await futures.observeMany([oi("2026-10-15", 500000, "2026-10-16T01:00:00.000Z")]);
  await futures.observeMany([oi("2026-10-16", 510000, "2099-01-01T00:00:00.000Z")]);
  await assert.rejects(() => futures.observeMany([oi("2026-10-17", 520000, "2026-10-18T01:00:00.000Z")]), /clock moved backwards/);
  const futuresRepair = await runFirstSeenRepair(["--store", "futures-open-interest", "--apply"], now);
  assert.deepEqual([futuresRepair.logs[0].label, futuresRepair.logs[0].moved.first_sequence, futuresRepair.logs[0].records_after], ["futures open interest", 2, 1]);
  assert.equal((await futures.observeMany([oi("2026-10-17", 520000, "2026-10-18T01:00:00.000Z")])).recorded[0].sequence, 2);
  // The official policy-rate raw snapshots (its history log, absent here, has nothing to move).
  const official = new OfficialPolicyRateHistoryStore(process.env.TRADINGVIEW_MCP_POLICY_RATE_OFFICIAL_HISTORY_PATH);
  const snapshot = (n, at) => ({ source_id: "fred_fed_target_range_midpoint", source_url: "https://fred.stlouisfed.org/data/x.txt", raw_sha256: `sha256:${String(n).repeat(64)}`, raw_bytes: 10, retrieved_at: at });
  await official.observeRawSnapshot(snapshot(1, "2026-10-16T01:00:00.000Z"));
  await official.observeRawSnapshot(snapshot(2, "2099-01-01T00:00:00.000Z"));
  const officialRepair = await runFirstSeenRepair(["--store", "official-policy-rate", "--apply"], now);
  assert.deepEqual(officialRepair.logs.map((log) => [log.label, log.records, log.kept]), [["official policy-rate", 0, 0], ["official policy-rate raw snapshot", 2, 1]]);
  assert.equal((await official.observeRawSnapshot(snapshot(3, "2026-10-18T01:00:00.000Z"))).sequence, 2);
  // The macro-surprise evidence: an actual captured by a clock decades ahead, in that release's window.
  let clock = new Date("2026-08-07T12:00:00.000Z");
  const macro = new MacroSurpriseEvidenceStore(process.env.TRADINGVIEW_MCP_MACRO_SURPRISE_EVIDENCE_PATH, () => clock);
  const consensus = { event_id: "us_nfp:2026-08-07", event_kind: "us_nfp", occurred_at: "2026-08-07T12:30:00.000Z", metric_id: "us_nfp_total_nonfarm_change_thousands", role: "consensus",
    value: 75, source_id: "licensed_calendar", source_url: "https://calendar.example.test/nfp", raw_sha256: `sha256:${"a".repeat(64)}` };
  await macro.observe(consensus);
  clock = new Date("2099-01-02T13:31:00.000Z");
  await macro.observe({ ...consensus, event_id: "us_nfp:2099-01-02", occurred_at: "2099-01-02T13:30:00.000Z", role: "actual", value: 110, source_id: "bls_official", source_url: "https://www.bls.gov/news.release/archives/empsit_01022099.htm" });
  clock = new Date("2026-09-04T12:00:00.000Z");
  await assert.rejects(() => macro.observe({ ...consensus, event_id: "us_nfp:2026-09-04", occurred_at: "2026-09-04T12:30:00.000Z" }), /clock moved backwards/);
  const macroRepair = await runFirstSeenRepair(["--store", "macro-surprise", "--apply"], now);
  assert.deepEqual([macroRepair.logs[0].label, macroRepair.logs[0].moved.first_sequence, macroRepair.logs[0].records_after], ["macro-surprise evidence", 2, 1]);
  assert.equal((await macro.observe({ ...consensus, event_id: "us_nfp:2026-09-04", occurred_at: "2026-09-04T12:30:00.000Z" })).recorded.sequence, 2);
  assert.equal((await readdir(directory)).filter((name) => name.endsWith(".lock")).length, 0, "no lock is left");
});

// BACKLOG 103-11 review: locks are all taken or none, never waited on while another is held, and released on a signal;
// what a kill leaves is reported and finished by the next run.

/** Points the FX history paths into a new directory for one test. */
const withFxPaths = (t) => withPaths(t, { TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH: "fx-history-m15-manifest.jsonl", TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH: "raw" });
const credentials = { OANDA_FX_HISTORY_ACCOUNT_ID: "001-001-1234567-001", OANDA_FX_HISTORY_ACCESS_TOKEN: "a-valid-token-with-enough-length" };
const candle = (time, close = "1.1002") => ({ complete: true, volume: 17, time, mid: { o: "1.1000", h: "1.1004", l: "1.0998", c: close } });
const respond = (candles) => new Response(JSON.stringify({ candles }), { status: 200, headers: { "content-type": "application/json" } });
/** A collection of [from, to] run at `at` against a fake OANDA whose pages hold `page(start)`, a half hour of two candles by default. */
const collect = (from, at, to = new Date(Date.parse(from) + 30 * 60_000).toISOString(), page = (start) => [candle(new Date(start).toISOString()), candle(new Date(start + 15 * 60_000).toISOString())]) =>
  runFxHistoryCollection(["--from", from, "--to", to, "--confirm-external-fetch"], credentials, { now: () => new Date(at), fetch: async (url) => respond(page(Date.parse(new URL(url).searchParams.get("from")))) });
const fxFiles = (directory) => ({ runs: join(directory, "fx-history-m15-manifest.jsonl.runs"), manifest: join(directory, "fx-history-m15-manifest.jsonl"), checkpoints: join(directory, "fx-history-m15-manifest.jsonl.checkpoints") });

test("a busy lock is waited for with none of the others held, and a lock a killed run left is named (BACKLOG 103-11)", async (t) => {
  const directory = await withFxPaths(t);
  lockWait(t, 400);
  await collect("2026-01-05T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
  await collect("2026-01-06T00:00:00.000Z", "2099-02-01T00:00:00.000Z");
  const files = fxFiles(directory), now = new Date("2026-02-02T00:00:00.000Z");
  const release = await holdLock(files.checkpoints);
  try {
    await assert.rejects(() => runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"], now),
      new RegExp(`^Error: timed out after \\d+ ms waiting for .*fx-history-m15-manifest\\.jsonl\\.checkpoints\\.lock, which another process holds; run the repair again when no collector is running; nothing was changed$`));
    assert.deepEqual([existsSync(`${files.runs}.lock`), existsSync(`${files.manifest}.lock`)], [false, false], "the locks it took were given back");
    // A dry run is not held up by it.
    assert.equal((await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD"], now)).logs.length, 3);
  } finally { await release(); }
  // A lock naming a process that is gone: a dry run reports it, --apply names it as a killed run's.
  const ended = spawn(process.execPath, ["-e", ""]); await once(ended, "exit");
  for (let look = 0; look < 200; look += 1) { try { process.kill(ended.pid, 0); await new Promise((resolve) => setTimeout(resolve, 50)); } catch { break; } }
  await writeFile(`${files.manifest}.lock`, `${randomUUID()} ${ended.pid}\n`, { mode: 0o600 });
  const dry = await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD"], now);
  assert.deepEqual(dry.logs[1].leftovers.stale_lock, { path: `${files.manifest}.lock`, pid: ended.pid, note: "a run killed while it held the lock left it: remove it when no collector, server or repair is running" });
  await assert.rejects(() => runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"], now),
    new RegExp(`^Error: the lock .*\\.jsonl\\.lock names process ${ended.pid}, which is gone: a run killed while it held the lock left it; remove it if no collector, server or repair is running, then run the repair again; nothing was changed$`));
  assert.deepEqual([existsSync(`${files.runs}.lock`), existsSync(`${files.checkpoints}.lock`)], [false, false]);
});

/** A child process running the built repair CLI with `args`, the test's store paths, and `preload` (a module path) if any. */
function repairChild(args, preload) {
  const cli = fileURLToPath(new URL("../../build/firstSeenRepairCli.js", import.meta.url));
  const child = spawn(process.execPath, [...(preload ? ["--import", pathToFileURL(preload).href] : []), cli, ...args], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output, until: async (text) => { while (!output.includes(text)) await once(child.stdout.readableEnded ? child : child.stdout, "data"); } };
}

test("a signal while --apply waits for a lock releases every lock it took (BACKLOG 103-11)", { timeout: 60_000 }, async (t) => {
  if (process.platform === "win32") { t.skip("POSIX signals"); return; }
  const directory = await withFxPaths(t);
  lockWait(t, 20_000);
  await collect("2026-01-05T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
  await collect("2026-01-06T00:00:00.000Z", "2099-02-01T00:00:00.000Z");
  const files = fxFiles(directory);
  const release = await holdLock(files.checkpoints);
  t.after(() => release().catch(() => undefined));
  const { child } = repairChild(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"]);
  t.after(() => child.kill("SIGKILL"));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  child.kill("SIGINT");
  const [code, signal] = await once(child, "exit");
  assert.deepEqual([code, signal], [null, "SIGINT"]);
  assert.deepEqual([existsSync(`${files.runs}.lock`), existsSync(`${files.manifest}.lock`)], [false, false], "the reviewer's repro left the run log's lock here");
});

test("a repair killed before its rename leaves what the next dry run reports, and the next --apply finishes it without a second sidecar (BACKLOG 103-11)", { timeout: 60_000 }, async (t) => {
  const { directory, path, store } = await researchLogAhead(t);
  const original = lines(await readFile(path, "utf8"));
  // The child stops for good at the rename over the log, after its sidecar and its rewritten log are written and synced.
  const preload = join(directory, "stall-rename.mjs");
  await writeFile(preload, `import { createRequire, syncBuiltinESMExports } from "node:module";
const fs = createRequire(import.meta.url)("node:fs");
const real = fs.promises.rename;
fs.promises.rename = async (from, to) => { if (String(to) === ${JSON.stringify(path)}) { process.stdout.write("STALLED\\n"); await new Promise(() => setInterval(() => {}, 1000)); } return real(from, to); };
syncBuiltinESMExports();
`);
  const { child, until } = repairChild(["--store", "research-heartbeat", "--apply"], preload);
  t.after(() => child.kill("SIGKILL"));
  await until("STALLED");
  child.kill("SIGKILL");
  await once(child, "exit");
  // The log is as it was; a sidecar with the tail, the rewritten log as a temporary file, and the lock remain.
  assert.deepEqual(lines(await readFile(path, "utf8")), original);
  const dry = await runFirstSeenRepair(["--store", "research-heartbeat"]);
  const { leftovers } = dry.logs[0];
  assert.deepEqual([leftovers.temporaries.length, leftovers.sidecars.length, leftovers.stale_lock?.pid], [1, 1, child.pid]);
  assert.equal(await readFile(leftovers.sidecars[0], "utf8"), `${original.slice(2).join("\n")}\n`);
  // Once the lock is cleared (as the message says to), the next --apply uses that sidecar and removes the temporary file.
  await rm(`${path}.lock`);
  const done = await runFirstSeenRepair(["--store", "research-heartbeat", "--apply"]);
  assert.deepEqual([done.logs[0].reused_sidecar, done.logs[0].sidecar, done.logs[0].removed_temporaries, done.logs[0].records_after],
    [true, leftovers.sidecars[0], leftovers.temporaries, 2]);
  assert.deepEqual((await readdir(directory)).filter((name) => name !== "stall-rename.mjs").sort(), ["research-collection-heartbeats.jsonl", leftovers.sidecars[0].slice(directory.length + 1)].sort());
  assert.equal((await store.recordRun({ observed_at: new Date().toISOString(), hypotheses, chart_restored: true })).sequence, 3);
});

test("an FX history collection stamped ahead is moved out of the run log, the manifest and the checkpoints together, with --force, and the next run records (BACKLOG 103-11)", async (t) => {
  const directory = await withFxPaths(t);
  await collect("2026-01-05T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
  // A run by a clock decades ahead stamps a page checkpoint, a manifest record and a run; the clock set right, the next
  // run is refused before it fetches anything, and would be refused by the checkpoints and the manifest after.
  await collect("2026-01-06T00:00:00.000Z", "2099-02-01T00:00:00.000Z");
  const now = new Date("2026-02-02T00:00:00.000Z");
  await assert.rejects(() => collect("2026-01-07T00:00:00.000Z", now.toISOString()), /starts before the latest recorded run finished/);
  const paths = fxFiles(directory);
  const bytes = async () => Promise.all(Object.values(paths).map((path) => readFile(path, "utf8")));
  const before = await bytes();
  const dry = await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD"], now);
  assert.deepEqual(dry.logs.map((log) => [log.label, log.path, log.records, log.kept, log.moved.first_sequence]),
    [["FX history run", paths.runs, 2, 1, 2], ["FX history manifest", paths.manifest, 2, 1, 2], ["FX history page checkpoint", paths.checkpoints, 2, 1, 2]]);
  assert.deepEqual([dry.force_required, "dependents" in dry], [true, false]);
  // Exports already written cite these sequences: --apply alone refuses.
  await assert.rejects(() => runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply"], now),
    /the next records would take the moved sequences again \(FX history run 2-2, FX history manifest 2-2, FX history page checkpoint 2-2\), and these may cite a moved record: .*FX history exports/);
  assert.deepEqual(await bytes(), before);
  const forced = await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"], now);
  assert.equal(forced.sidecars.length, 3);
  for (const [index, sidecar] of forced.sidecars.entries()) assert.equal(await readFile(sidecar, "utf8"), `${lines(before[index])[1]}\n`);
  assert.deepEqual(await bytes(), before.map((text) => `${lines(text)[0]}\n`));
  // The next run fetches, checkpoints, records its content and its run; the logs read together for an export.
  const next = await collect("2026-01-06T00:00:00.000Z", now.toISOString());
  assert.deepEqual([next.manifest.recorded, next.run.sequence], [true, 2]);
  assert.deepEqual((await new FxHistoricalCheckpointStore(undefined, "EUR_USD").records()).map((row) => row.sequence), [1, 2]);
  assert.equal((await new FxHistoricalManifestStore(undefined, "EUR_USD").records()).length, 2);
  assert.deepEqual((await new FxHistoricalRunLog(undefined, "EUR_USD").records()).map((run) => run.retrieved_at), ["2026-02-01T00:00:00.000Z", now.toISOString()]);
  const exported = await exportFxHistory({ instrument: "EUR_USD", all: true });
  assert.deepEqual([exported.manifest_records, exported.run_records, exported.collections.length], [2, 2, 2]);
});

test("an FX history repair stopped after its run log is rewritten says which logs were rewritten and to run it again, which finishes it (BACKLOG 103-11)", async (t) => {
  const directory = await withFxPaths(t);
  await collect("2026-01-05T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
  await collect("2026-01-06T00:00:00.000Z", "2099-02-01T00:00:00.000Z");
  const paths = fxFiles(directory), now = new Date("2026-02-02T00:00:00.000Z");
  // The reviewer's case first: the manifest's sidecar name is taken already. It takes the next name.
  await writeFile(`${paths.manifest}.ahead-20260202T000000.000Z.jsonl`, "", { mode: 0o600 });
  const fsp = createRequire(import.meta.url)("node:fs/promises");
  const realRename = fsp.rename;
  fsp.rename = async (from, to) => { if (String(to) === paths.manifest) throw Object.assign(new Error("EIO: injected"), { code: "EIO" }); return realRename(from, to); };
  syncBuiltinESMExports();
  let refusal;
  try {
    await assert.rejects(() => runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"], now), (error) => { refusal = error; return error instanceof FirstSeenRepairRefused; });
  } finally {
    fsp.rename = realRename;
    syncBuiltinESMExports();
  }
  assert.equal(refusal.message, `the repair stopped part-way: ${paths.runs} (its records stamped ahead are in ${paths.runs}.ahead-20260202T000000.000Z.jsonl) was rewritten and read as its store reads it, `
    + `then FX history manifest repair failed (EIO: injected): nothing in ${paths.manifest} was changed; run the repair again to finish`);
  assert.deepEqual([refusal.summary.applied, refusal.summary.logs.map((log) => log.sidecar ?? null)], ["partial", [`${paths.runs}.ahead-20260202T000000.000Z.jsonl`, null, null]]);
  assert.equal((await readdir(directory)).filter((name) => name.includes(".manifest.jsonl.ahead-") || name.endsWith("-2.jsonl")).length, 0, "the manifest's sidecar written was removed again");
  // Running again finishes: the run log has nothing ahead now, the manifest and the checkpoints are moved.
  const again = await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"], new Date(now.getTime() + 1));
  assert.deepEqual(again.logs.map((log) => [log.label, log.moved?.records ?? 0]), [["FX history run", 0], ["FX history manifest", 1], ["FX history page checkpoint", 1]]);
  assert.match(again.logs[1].sidecar, /\.ahead-20260202T000000\.001Z\.jsonl$/);
  assert.equal((await collect("2026-01-07T00:00:00.000Z", "2026-02-02T00:00:01.000Z")).run.sequence, 2);
});

test("records the repair would move that kept FX history records need are named by collection key, range and hash, and moved only with --recollect (BACKLOG 103-11)", async (t) => {
  const directory = await withFxPaths(t);
  // Two collections from the same start share their first page's raw response, under two collection keys; the second,
  // by a clock decades ahead, checkpoints that page under its own key. The first collection keeps its own checkpoint, so
  // nothing it needs is moved (a match on the raw hash alone refused here).
  const from = "2026-01-01T00:00:00.000Z";
  const page = (end) => (start) => (start === Date.parse(from) ? [candle(from)] : [candle("2026-02-11T16:00:00.000Z"), candle(end)]);
  await collect(from, "2026-08-01T00:00:00.000Z", "2026-02-13T00:00:00.000Z", page("2026-02-12T00:00:00.000Z"));
  await collect(from, "2099-08-01T00:00:00.000Z", "2026-02-16T00:00:00.000Z", page("2026-02-13T12:00:00.000Z"));
  const now = new Date("2026-08-02T00:00:00.000Z");
  const dry = await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD"], now);
  assert.deepEqual([dry.logs.map((log) => log.moved?.records ?? 0), "dependents" in dry], [[1, 1, 2], false]);
  assert.equal((await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"], now)).applied, true);
  // A kept run naming content only a moved manifest record holds (made by hand here): refused without --recollect, which
  // moves it anyway and names the range to collect again.
  const other = await withFxPaths(t);
  await collect("2026-01-05T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
  await collect("2026-01-06T00:00:00.000Z", "2099-02-01T00:00:00.000Z");
  const files = fxFiles(other);
  const [first, second] = lines(await readFile(files.runs, "utf8"));
  const kept = { ...JSON.parse(second), started_at: "2026-02-01T00:30:00.000Z", retrieved_at: "2026-02-01T01:00:00.000Z", first_seen_at: "2026-02-01T01:00:00.000Z", observation_date: "2026-02-01" };
  await writeFile(files.runs, `${first}\n${JSON.stringify(kept)}\n`, { mode: 0o600 });
  const before = await readFile(files.manifest);
  const at = new Date("2026-02-02T00:00:00.000Z");
  await assert.rejects(() => runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"], at),
    (error) => error instanceof FirstSeenRepairRefused && error.message.startsWith("FX history run 2 would name content only a moved manifest record holds; run again with --recollect")
      && error.summary.dependents[0].collect_again.from === "2026-01-06T00:00:00.000Z");
  assert.deepEqual(await readFile(files.manifest), before);
  const recollected = await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force", "--recollect"], at);
  assert.deepEqual([recollected.applied, recollected.dependents.map((item) => item.collect_again)], [true, [{ from: "2026-01-06T00:00:00.000Z", to: "2026-01-06T00:30:00.000Z" }]]);
});
