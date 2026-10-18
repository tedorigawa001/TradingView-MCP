import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FirstSeenRepairRefused, parseFirstSeenRepairArguments, runFirstSeenRepair } from "../../build/firstSeenRepairCli.js";
import { ResearchCollectionHeartbeatStore } from "../../build/researchCollectionHeartbeat.js";
import { RealYieldFirstSeenStore } from "../../build/realYieldHistory.js";
import { checkCollectionHealth, parseCollectionHealthCliArguments } from "../../build/collectionHealthCli.js";
import { FxHistoricalRunLog } from "../../build/fxHistoryRunLog.js";
import { FxHistoricalCheckpointStore, FxHistoricalManifestStore } from "../../build/oandaHistoricalFx.js";
import { runFxHistoryCollection } from "../../build/fxHistoryCollectionCli.js";
import { exportFxHistory } from "../../build/fxHistoryExport.js";

// BACKLOG 103-11 (security review of 0.1.43, L2): a record stamped by a clock that ran ahead blocks every later record of
// its first-seen log until the clock reaches it, and setting the clock right does not clear it. tradingview-mcp-repair-first-seen
// moves that tail to a sidecar under the store's lock, by default only saying what it would move.

/** Points the named environment variables at paths in a new directory for one test; returns the directory. */
async function withPaths(t, names) {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-first-seen-repair-"));
  const saved = Object.fromEntries(Object.keys(names).map((name) => [name, process.env[name]]));
  for (const [name, file] of Object.entries(names)) process.env[name] = join(directory, file);
  t.after(async () => {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
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

test("a dry run changes nothing and says which records it would move (BACKLOG 103-11)", async (t) => {
  const { directory, path, store, now } = await researchLogAhead(t);
  const before = await readFile(path);
  // The clock is right again, yet the log still refuses the next heartbeat.
  await assert.rejects(() => store.recordRun({ observed_at: now.toISOString(), hypotheses, chart_restored: true }), /clock moved backwards/);
  const summary = await runFirstSeenRepair(["--store", "research-heartbeat"], now);
  assert.deepEqual(summary, { store: "research-heartbeat", now: now.toISOString(), tolerance_ms: 60_000, applied: false, force_required: false,
    logs: [{ label: "research collection heartbeat", path, records: 4, kept: 2, moved: { records: 2, first_sequence: 3, last_sequence: 4,
      first_seen_from: "2099-01-01T00:00:00.000Z", first_seen_to: "2099-01-01T01:00:00.000Z", next_sequence: 3 } }],
    references: ["no store or evidence file of this package cites heartbeat sequences; a collector prints its run's heartbeat sequence only"] });
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual((await readdir(directory)).sort(), ["research-collection-heartbeats.jsonl"], "no sidecar, no temporary file, no lock left");
});

test("--apply moves exactly the tail stamped ahead to an owner-only sidecar, and the store then takes new records (BACKLOG 103-11)", async (t) => {
  const { directory, path, store, now } = await researchLogAhead(t);
  const original = lines(await readFile(path, "utf8"));
  const summary = await runFirstSeenRepair(["--store", "research-heartbeat", "--apply"], now);
  const sidecar = `${path}.ahead-20261018T000030.000Z.jsonl`;
  assert.deepEqual([summary.applied, summary.sidecars, summary.logs[0].sidecar, summary.logs[0].records_after, summary.logs[0].moved.records], [true, [sidecar], sidecar, 2, 2]);
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

test("a repair that fails before its rename removes what it wrote and changes nothing (BACKLOG 103-11)", async (t) => {
  const { directory, path, now } = await researchLogAhead(t);
  const before = await readFile(path);
  const fsp = createRequire(import.meta.url)("node:fs/promises");
  const realRename = fsp.rename;
  fsp.rename = async () => { throw Object.assign(new Error("EXDEV: injected"), { code: "EXDEV" }); };
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => runFirstSeenRepair(["--store", "research-heartbeat", "--apply"], now),
      /^Error: research collection heartbeat repair failed \(EXDEV: injected\): .*research-collection-heartbeats\.jsonl; nothing was changed$/);
  } finally {
    fsp.rename = realRename;
    syncBuiltinESMExports();
  }
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual(await readdir(directory), ["research-collection-heartbeats.jsonl"], "neither the sidecar nor the rewritten log is left");
});

test("a log that does not read as the store reads it, or is framed otherwise, is refused and left as it was (BACKLOG 103-11)", async (t) => {
  const { path, now } = await researchLogAhead(t);
  const original = await readFile(path, "utf8");
  const refusedUnchanged = async (contents, pattern) => {
    await writeFile(path, contents, { mode: 0o600 });
    await assert.rejects(() => runFirstSeenRepair(["--store", "research-heartbeat", "--apply"], now), pattern);
    assert.equal(await readFile(path, "utf8"), contents);
  };
  const [one, two, three, four] = lines(original);
  await refusedUnchanged(`${one}\n${two}\n{"broken":\n${three}\n${four}\n`, /research collection heartbeat history .* does not read as the store reads it \(invalid research collection heartbeat history JSON at line 3\); nothing was changed$/);
  await refusedUnchanged(`${one}\n${three}\n${four}\n`, /does not read as the store reads it \(non-contiguous research collection heartbeat sequence at line 2\); nothing was changed$/);
  await refusedUnchanged(`${one}\n${two}\n${three}\n${four}`, /research collection heartbeat history is not framed as the store writes it .*; settle it by hand; nothing was changed$/);
  await refusedUnchanged(`${one}\n\n${two}\n${three}\n${four}\n`, /is not framed as the store writes it/);
  // No log at all: nothing to repair, and no directory or lock is made for it.
  await rm(path);
  await assert.rejects(() => runFirstSeenRepair(["--store", "research-heartbeat"], now), /^Error: there is no research collection heartbeat history at .*; nothing was changed$/);
});

test("the arguments name one known store, take --instrument only for fx-history, and --force only with --apply (BACKLOG 103-11)", () => {
  assert.deepEqual(parseFirstSeenRepairArguments(["--store", "cot"]), { store: "cot", apply: false, force: false });
  assert.deepEqual(parseFirstSeenRepairArguments(["--store", "fx-history", "--instrument", "USD_JPY", "--apply", "--force"]), { store: "fx-history", instrument: "USD_JPY", apply: true, force: true });
  assert.throws(() => parseFirstSeenRepairArguments([]), /--store must be one of research-heartbeat, policy-rate-heartbeat, first-seen-heartbeat, cot, policy-rate, real-yield, fx-history/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "analysis-journal"]), /--store must be one of/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "fx-history"]), /--store fx-history needs --instrument/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "cot", "--instrument", "EUR_USD"]), /--instrument belongs to --store fx-history/);
  assert.throws(() => parseFirstSeenRepairArguments(["--store", "cot", "--force"]), /--force goes only with --apply/);
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

/** Points the FX history paths into a new directory for one test. */
const withFxPaths = (t) => withPaths(t, { TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH: "fx-history-m15-manifest.jsonl", TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH: "raw" });
const credentials = { OANDA_FX_HISTORY_ACCOUNT_ID: "001-001-1234567-001", OANDA_FX_HISTORY_ACCESS_TOKEN: "a-valid-token-with-enough-length" };
const candle = (time) => ({ complete: true, volume: 17, time, mid: { o: "1.1000", h: "1.1004", l: "1.0998", c: "1.1002" } });
/** A collection of the half hour from `from`, run at `at`, against a fake OANDA. */
const collect = (from, at) => runFxHistoryCollection(["--from", from, "--to", new Date(Date.parse(from) + 30 * 60_000).toISOString(), "--confirm-external-fetch"], credentials, {
  now: () => new Date(at),
  fetch: async (url) => {
    const start = Date.parse(new URL(url).searchParams.get("from"));
    return new Response(JSON.stringify({ candles: [candle(new Date(start).toISOString()), candle(new Date(start + 15 * 60_000).toISOString())] }), { status: 200, headers: { "content-type": "application/json" } });
  },
});

test("an FX history collection stamped ahead is moved out of the run log, the manifest and the checkpoints together, with --force, and the next run records (BACKLOG 103-11)", async (t) => {
  const directory = await withFxPaths(t);
  await collect("2026-01-05T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
  // A run by a clock decades ahead stamps a page checkpoint, a manifest record and a run; the clock set right, the next
  // run is refused before it fetches anything, and would be refused by the checkpoints and the manifest after.
  await collect("2026-01-06T00:00:00.000Z", "2099-02-01T00:00:00.000Z");
  const now = new Date("2026-02-02T00:00:00.000Z");
  await assert.rejects(() => collect("2026-01-07T00:00:00.000Z", now.toISOString()), /starts before the latest recorded run finished/);
  const paths = { runs: join(directory, "fx-history-m15-manifest.jsonl.runs"), manifest: join(directory, "fx-history-m15-manifest.jsonl"), checkpoints: join(directory, "fx-history-m15-manifest.jsonl.checkpoints") };
  const bytes = async () => Promise.all(Object.values(paths).map((path) => readFile(path, "utf8")));
  const before = await bytes();
  const dry = await runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD"], now);
  assert.deepEqual(dry.logs.map((log) => [log.label, log.path, log.records, log.kept, log.moved.first_sequence]),
    [["FX history run", paths.runs, 2, 1, 2], ["FX history manifest", paths.manifest, 2, 1, 2], ["FX history page checkpoint", paths.checkpoints, 2, 1, 2]]);
  assert.equal(dry.force_required, true);
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

test("an FX history repair that would leave a kept run without its content is refused, even with --force (BACKLOG 103-11)", async (t) => {
  const directory = await withFxPaths(t);
  await collect("2026-01-05T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
  await collect("2026-01-06T00:00:00.000Z", "2099-02-01T00:00:00.000Z");
  // The run log is moved back by hand to before the clock ran ahead, as if its tail were already gone: its kept second
  // run (here, made by hand) names content only the manifest's moved record holds.
  const runsPath = join(directory, "fx-history-m15-manifest.jsonl.runs");
  const [first, second] = lines(await readFile(runsPath, "utf8"));
  const moved = { ...JSON.parse(second), started_at: "2026-02-01T00:30:00.000Z", retrieved_at: "2026-02-01T01:00:00.000Z", first_seen_at: "2026-02-01T01:00:00.000Z", observation_date: "2026-02-01" };
  await writeFile(runsPath, `${first}\n${JSON.stringify(moved)}\n`, { mode: 0o600 });
  const before = await readFile(join(directory, "fx-history-m15-manifest.jsonl"));
  await assert.rejects(() => runFirstSeenRepair(["--store", "fx-history", "--instrument", "EUR_USD", "--apply", "--force"], new Date("2026-02-02T00:00:00.000Z")),
    (error) => error instanceof FirstSeenRepairRefused && error.message === "FX history run 2 would name content the manifest no longer holds; settle it by hand; nothing was changed");
  assert.deepEqual(await readFile(join(directory, "fx-history-m15-manifest.jsonl")), before);
});
