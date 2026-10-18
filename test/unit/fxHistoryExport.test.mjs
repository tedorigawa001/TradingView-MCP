import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { collectOandaM15History, FxHistoricalCheckpointStore, FxHistoricalManifestStore, oandaPageRanges } from "../../build/oandaHistoricalFx.js";
import { FxHistoricalArchive } from "../../build/fxHistoricalArchive.js";
import { FxHistoricalRunLog } from "../../build/fxHistoryRunLog.js";
import { exportFxHistory, fxHistoryBarSeries, listFxHistoryCollections, rebuildFxHistoryCollection, splitFxHistoryExport } from "../../build/fxHistoryExport.js";
import { fxHistoryExportPartPaths, runFxHistoryExport, writeFxHistoryExportParts } from "../../build/fxHistoryExportCli.js";
import { normalizeBarSeries } from "../../build/barSeries.js";

const candle = (time, close = "1.1002", complete = true) => ({ complete, volume: 17, time, mid: { o: "1.1000", h: "1.1004", l: "1.0998", c: close } });
const response = (candles) => new Response(JSON.stringify({ candles }), { status: 200, headers: { "content-type": "application/json" } });
const sha = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const lstatOrNull = (path) => lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });

/** A temporary home for one instrument's manifest, checkpoints and raw archive, and a collection run against a fake OANDA. */
async function setup(instrument = "EUR_USD") {
  const dir = await mkdtemp(join(tmpdir(), "fx-export-"));
  const manifestPath = join(dir, `manifest.${instrument}.jsonl`);
  const store = new FxHistoricalManifestStore(manifestPath, instrument);
  const checkpoints = new FxHistoricalCheckpointStore(`${manifestPath}.checkpoints`, instrument);
  const archive = new FxHistoricalArchive(join(dir, "raw"));
  const runs = new FxHistoricalRunLog(`${manifestPath}.runs`, instrument);
  const collect = (from, to, pages, at = "2026-07-31T00:00:00.000Z") => collectOandaM15History({
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", instrument, from, to,
    now: () => new Date(at), sleep: async () => {}, archive, store, checkpoints, runs,
    fetch: async (url) => response(pages(new URL(url).searchParams.get("from"))),
  });
  const reads = { count: 0 };
  const counting = { read: async (hash) => { reads.count += 1; return archive.read(hash); } };
  return { dir, store, checkpoints, runs, archive, counting, reads, collect, sources: { store, checkpoints, runs, archive } };
}
// Two pages (42 days is more than 4,000 candles) with the boundary candle in both, nanosecond times, and an unfinished
// candle at the end that the collection leaves out: the first page is checkpointed, the second is not final.
const twoPages = (start) => start === "2026-01-01T00:00:00.000Z"
  ? [candle("2026-01-01T00:00:00.000000000Z"), candle("2026-01-01T00:15:00.000000000Z", "1.1001"), candle("2026-02-11T16:00:00.000Z")]
  : [candle("2026-02-11T16:00:00.000Z"), candle("2026-02-11T16:15:00.000Z", "1.1003"), candle("2026-02-11T16:30:00.000Z", "1.1005", false)];
const FROM = "2026-01-01T00:00:00.000Z", TO = "2026-02-12T00:00:00.000Z";

test("a recorded collection is rebuilt from its raw pages into the bars the collection returned", async () => {
  const { store, sources, collect } = await setup();
  const collected = await collect(FROM, TO, twoPages);
  assert.equal(collected.unfinished_pages, 1);
  assert.equal(oandaPageRanges(FROM, TO).length, 2);
  // Pinned, so a change in how bars are normalized cannot pass unnoticed.
  assert.equal(collected.normalized_sha256, "sha256:f5cb053d75def564770878bd42df75b71d5cefd808a1436615daf727631470db");
  const [record] = await store.records();
  // Page 1 is checkpointed under the exact range; page 2 still had a forming candle, so not every page is.
  assert.deepEqual(await rebuildFxHistoryCollection(record, sources.archive, sources.checkpoints), { bars: collected.bars, rangeCheckpointed: false });
  const exported = await exportFxHistory({ instrument: "EUR_USD", sequences: [1], ...sources });
  assert.deepEqual([exported.evidence_tier, exported.granularity, exported.price, exported.canonical_symbol], ["official_revised_history", "M15", "M", "OANDA:EURUSD"]);
  const { bars, ...fields } = exported.collections[0];
  assert.deepEqual(bars, collected.bars);
  assert.deepEqual(fields, { sequence: 1, requested_from: FROM, requested_to: TO, retrieved_at: record.retrieved_at, source_url_template: record.source_url_template,
    raw_sha256: record.raw_sha256, normalized_sha256: collected.normalized_sha256, bar_count: 4, first_bar_at: "2026-01-01T00:00:00.000Z",
    last_bar_at: "2026-02-11T16:15:00.000Z", duplicate_timestamps_removed: 1, non_contiguous_weekday_intervals: record.non_contiguous_weekday_intervals,
    environment: "practice", range_checkpointed: false });
  assert.equal(sha(JSON.stringify(bars)), collected.normalized_sha256, "the normalized hash is the hash of the bars as a JSON array");
  // The same records give the same bytes.
  assert.equal(JSON.stringify(await exportFxHistory({ instrument: "EUR_USD", all: true, ...sources })), JSON.stringify(exported));
});

test("a collection that resumed a checkpointed page, and one with an empty page, rebuild too", async () => {
  const { store, sources, collect } = await setup();
  await collect(FROM, TO, twoPages);
  // The same range later: the first page resumes from its checkpoint, the second is fetched again and is now final.
  const later = (start) => start === FROM ? [] : [candle("2026-02-11T16:00:00.000Z"), candle("2026-02-11T16:15:00.000Z", "1.1003"), candle("2026-02-11T16:30:00.000Z", "1.1003")];
  const second = await collect(FROM, TO, later, "2026-08-01T00:00:00.000Z");
  assert.equal(second.resumed_pages, 1);
  const records = await store.records();
  assert.equal(records[1].raw_sha256[0], records[0].raw_sha256[0]);
  const resumed = (await exportFxHistory({ instrument: "EUR_USD", sequences: [2], ...sources })).collections[0];
  assert.deepEqual([resumed.bars, resumed.range_checkpointed], [second.bars, true]);
  // Three pages, the middle one empty.
  const three = (start) => start === "2026-03-01T00:00:00.000Z" ? [candle("2026-03-02T00:00:00.000Z")] : start === "2026-04-11T16:00:00.000Z" ? [] : [candle("2026-05-25T00:00:00.000Z")];
  const collected = await collect("2026-03-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z", three, "2026-08-02T00:00:00.000Z");
  assert.equal(oandaPageRanges("2026-03-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z")[1].requestFrom, "2026-04-11T16:00:00.000Z");
  const exported = await exportFxHistory({ instrument: "EUR_USD", sequences: [3], ...sources });
  assert.deepEqual([exported.collections[0].bars, exported.collections[0].raw_sha256.length, exported.collections[0].range_checkpointed], [collected.bars, 3, true]);
});

test("a record that does not match its raw pages, or whose range no checkpoint binds, is refused", async () => {
  const { store, sources, collect } = await setup();
  await collect(FROM, TO, twoPages);
  const [record] = await store.records();
  const altered = (change) => ({ instrument: "EUR_USD", records: async () => [{ ...record, ...change }] });
  const noRuns = { instrument: "EUR_USD", records: async () => [] };   // so the rebuild itself is what refuses
  const run = (change, extra = {}) => exportFxHistory({ instrument: "EUR_USD", sequences: [1], ...sources, store: altered(change), runs: noRuns, ...extra });
  for (const [change, pattern] of [
    [{ normalized_sha256: sha("other") }, /rebuilt normalized_sha256 does not match/],
    [{ bar_count: 5 }, /rebuilt bar_count does not match/],
    [{ first_bar_at: "2026-01-01T00:15:00.000Z" }, /rebuilt first_bar_at does not match/],
    [{ last_bar_at: "2026-02-11T16:30:00.000Z" }, /rebuilt last_bar_at does not match/],
    [{ duplicate_timestamps_removed: 0 }, /rebuilt duplicate_timestamps_removed does not match/],
    [{ non_contiguous_weekday_intervals: record.non_contiguous_weekday_intervals + 1 }, /rebuilt non_contiguous_weekday_intervals does not match/],
    [{ raw_sha256: [record.raw_sha256[0]] }, /records 1 raw pages for a range of 2/],
    [{ raw_sha256: [...record.raw_sha256].reverse() }, /outside its requested page|not time ordered/],
    [{ requested_from: "2025-12-31T00:00:00.000Z" }, /outside its requested page/],   // the pages move, and a bar leaves its page
    // Ranges the raw pages alone cannot tell apart: the checkpoints, kept under the exact range, refuse them.
    [{ requested_to: "2026-02-13T00:00:00.000Z" }, /no page checkpoint binds page 1 of its requested range/],
    [{ requested_from: "2025-12-31T23:45:00.000Z", requested_to: "2026-02-11T23:45:00.000Z" }, /no page checkpoint binds|outside its requested page/],
    [{ source_url_template: "https://api-fxtrade.oanda.com/v3/accounts/{account}/instruments/EUR_USD/candles" }, /no page checkpoint binds/],   // another environment
    [{ source_url_template: "https://example.invalid/v3/accounts/{account}/instruments/EUR_USD/candles" }, /unknown OANDA host/],
  ]) await assert.rejects(() => run(change), pattern, JSON.stringify(change));
  // An archive that hands back other bytes than the hash names, and one that has lost a page.
  // With the run log, a record whose hash changed leaves the recorded run without its content.
  await assert.rejects(() => exportFxHistory({ instrument: "EUR_USD", sequences: [1], ...sources, store: altered({ normalized_sha256: sha("other") }) }), /run 1 names content/);
  await assert.rejects(() => run({}, { archive: { read: async () => Buffer.from(JSON.stringify({ candles: [] })) } }), /raw page 1 does not match its hash/);
  await assert.rejects(() => run({}, { archive: { read: async (hash) => { if (hash === record.raw_sha256[1]) throw new Error("ENOENT"); return sources.archive.read(hash); } } }),
    /collection 1, raw page 2: ENOENT/);
});

test("a collection whose pages could all still have been forming exports without a checkpoint, marked so", async () => {
  const { sources, collect } = await setup();
  // One page ending 15 minutes before it was read, its last candle still forming: nothing is final, nothing is checkpointed.
  const forming = () => [candle("2026-07-30T23:30:00.000Z"), candle("2026-07-30T23:45:00.000Z", "1.1003", false)];
  const collected = await collect("2026-07-30T23:30:00.000Z", "2026-07-30T23:45:00.000Z", forming);
  assert.equal(collected.unfinished_pages, 1);
  const exported = await exportFxHistory({ instrument: "EUR_USD", all: true, ...sources });
  assert.deepEqual([exported.collections[0].range_checkpointed, exported.collections[0].bar_count], [false, 1]);
  // A final page that ended within six hours and 15 minutes before the record need not be checkpointed; one that ended earlier must be.
  const body = Buffer.from(JSON.stringify({ candles: [candle("2026-07-30T23:30:00.000Z")] }));
  const archive = { read: async () => body }, none = { instrument: "EUR_USD", completed: async () => [] };
  const bars = [{ time: "2026-07-30T23:30:00.000Z", open: 1.1, high: 1.1004, low: 1.0998, close: 1.1002, volume: 17 }];
  const record = { ...exported.collections[0], instrument: "EUR_USD", raw_sha256: [sha(body)], normalized_sha256: sha(JSON.stringify(bars)), bar_count: 1,
    first_bar_at: bars[0].time, last_bar_at: bars[0].time, duplicate_timestamps_removed: 0, non_contiguous_weekday_intervals: 0 };
  assert.equal((await rebuildFxHistoryCollection({ ...record, retrieved_at: "2026-07-31T00:00:00.000Z" }, archive, none)).rangeCheckpointed, false);
  assert.equal((await rebuildFxHistoryCollection({ ...record, retrieved_at: "2026-07-31T05:59:00.000Z" }, archive, none)).rangeCheckpointed, false);
  await assert.rejects(() => rebuildFxHistoryCollection({ ...record, retrieved_at: "2026-07-31T06:01:00.000Z" }, archive, none), /no page checkpoint binds page 1/);
});

test("collections are chosen by sequence or all, for the instrument of the stores, within the size limit", async (t) => {
  const { store, checkpoints, runs, sources, collect } = await setup("USD_JPY");
  const flat = (time, c) => ({ complete: true, volume: 5, time, mid: { o: c, h: c, l: c, c } });
  const yen = (start) => [flat(start, "150.10"), flat(new Date(new Date(start).getTime() + 900_000).toISOString(), "150.12")];
  await collect("2026-03-02T00:00:00.000Z", "2026-03-02T00:30:00.000Z", yen);
  await collect("2026-03-03T00:00:00.000Z", "2026-03-03T00:30:00.000Z", yen);
  const listed = await listFxHistoryCollections({ instrument: "USD_JPY", ...sources });
  assert.equal(listed.manifest_path, store.path);
  assert.deepEqual(listed.collections.map((row) => [row.sequence, row.pages, row.bar_count, row.environment]), [[1, 1, 2, "practice"], [2, 1, 2, "practice"]]);
  await collect("2026-03-03T00:00:00.000Z", "2026-03-03T00:30:00.000Z", yen, "2026-08-01T00:00:00.000Z");   // the same content again, later
  const both = await exportFxHistory({ instrument: "USD_JPY", sequences: [2, 1], ...sources });
  assert.deepEqual(both.collections.map((c) => c.sequence), [1, 2], "manifest order");
  assert.deepEqual(both.runs.map((run) => [run.sequence, run.trigger, run.retrieved_at, run.manifest_recorded, run.normalized_sha256 === both.collections[1].normalized_sha256]),
    [[1, "manual", "2026-07-31T00:00:00.000Z", true, false], [2, "manual", "2026-07-31T00:00:00.000Z", true, true], [3, "manual", "2026-08-01T00:00:00.000Z", false, true]]);
  assert.deepEqual(Object.keys(both.runs[0]), ["sequence", "trigger", "environment", "requested_from", "requested_to", "started_at", "retrieved_at", "raw_sha256",
    "normalized_sha256", "bar_count", "resumed_pages", "unfinished_pages", "manifest_recorded"]);
  assert.deepEqual((await exportFxHistory({ instrument: "USD_JPY", sequences: [1], ...sources })).runs.map((run) => run.sequence), [1]);
  // The totals tell a whole export from a partial one (BACKLOG 103-9).
  assert.deepEqual([both.manifest_records, both.collections.length, both.run_records, both.runs.length], [2, 2, 3, 3]);
  const part = await exportFxHistory({ instrument: "USD_JPY", sequences: [1], ...sources });
  assert.deepEqual([part.manifest_records, part.collections.length, part.run_records, part.runs.length], [2, 1, 3, 1]);
  assert.deepEqual(Object.keys(both).slice(0, 12), ["schema_version", "series", "source_id", "evidence_tier", "instrument", "canonical_symbol", "granularity", "price",
    "manifest_records", "run_records", "collections", "runs"]);
  // A run whose content the manifest does not hold, or whose bar count differs from it, is refused.
  const [firstRun] = await runs.records();
  const oneRun = (change) => ({ instrument: "USD_JPY", records: async () => [{ ...firstRun, ...change }] });
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, ...sources, runs: oneRun({ normalized_sha256: sha("gone") }) }), /run 1 names content the USD_JPY manifest in .* does not hold/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, ...sources, runs: oneRun({ bar_count: 3 }) }), /run 1 records 3 bars for content of 2/);
  assert.equal(both.canonical_symbol, "OANDA:USDJPY");
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", sequences: [3], ...sources }), /no USD_JPY FX history collection in .*manifest\.USD_JPY\.jsonl has sequence 3/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", sequences: [1], all: true, ...sources }), /by sequence, or export all/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", ...sources }), /by sequence, or export all/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", sequences: [0], ...sources }), /positive integer/);
  await assert.rejects(() => exportFxHistory({ instrument: "EUR_USD", all: true, ...sources }), /manifest store is for USD_JPY, not EUR_USD/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, store, checkpoints, archive: sources.archive }), /checkpoint store and its run log together/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, checkpoints, runs, archive: sources.archive }), /checkpoint store and its run log together/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, ...sources, runs: { instrument: "EUR_USD", records: async () => [] } }), /run log is for EUR_USD, not USD_JPY/);
  const [record] = await store.records();
  let reads = 0;
  const emptyRuns = { instrument: "USD_JPY", records: async () => [] };
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, checkpoints, runs: emptyRuns, store: { instrument: "USD_JPY", records: async () => [{ ...record, bar_count: 1_000_001 }] },
    archive: { read: async () => { reads += 1; return Buffer.from(""); } } }), /more than 1000000; write a whole export in parts with --split/);
  assert.equal(reads, 0, "the size is checked before any page is read");
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, checkpoints, runs: emptyRuns, store: { instrument: "USD_JPY", records: async () => [] }, archive: sources.archive }),
    /no USD_JPY FX history collection is recorded/);
  // A directory at the configured manifest path is refused for every instrument, as the collector refuses it.
  const directory = await mkdtemp(join(tmpdir(), "fx-export-dir-")); await mkdir(join(directory, "base"));
  const saved = process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH;
  process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH = join(directory, "base");
  t.after(() => { if (saved === undefined) delete process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH; else process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH = saved; });
  await assert.rejects(() => listFxHistoryCollections({ instrument: "USD_JPY" }), /must name a file, not a directory/);
});

test("the CLI checks every argument before reading, writes a new file once, refuses other bytes, lists records and writes a bar series", async () => {
  const { dir, store, sources, counting, reads, collect } = await setup();
  await collect(FROM, TO, twoPages);
  const deps = { ...sources, archive: counting }, output = join(dir, "eurusd.json");
  for (const [argv, pattern] of [
    [["--instrument", "EUR_USD", "--sequence", "1", "--format", "bar-series", "--output", join(dir, "a.json")], /requires --series-id and --evidence-tier/],
    [["--instrument", "EUR_USD", "--all", "--format", "bar-series", "--series-id", "s", "--evidence-tier", "prospective", "--output", join(dir, "a.json")], /exactly one collection/],
    [["--instrument", "EUR_USD", "--sequence", "1", "--format", "bar-series", "--series-id", "forecast-set-source:x", "--evidence-tier", "prospective", "--output", join(dir, "a.json")], /reserved prefix/],
    [["--instrument", "EUR_USD", "--sequence", "1", "--format", "bar-series", "--series-id", "a b", "--evidence-tier", "prospective", "--output", join(dir, "a.json")], /--series-id must be/],
    [["--instrument", "EUR_USD", "--all", "--series-id", "x", "--output", join(dir, "a.json")], /belong to --format bar-series/],
    [["--instrument", "EURUSD", "--all", "--output", output], /--instrument must be one of/],
    [["--instrument", "EUR_USD", "--all"], /--output is required/],
    [["--instrument", "EUR_USD", "--sequence", "1.5", "--output", output], /--sequence must be a positive integer/],
    [["--instrument", "EUR_USD", "--all", "--format", "csv", "--output", output], /--format must be/],
    [["--instrument", "EUR_USD", "--list", "--all"], /--list takes only --instrument/],
  ]) await assert.rejects(() => runFxHistoryExport(argv, deps), pattern, JSON.stringify(argv));
  assert.equal(reads.count, 0, "no raw page was read for a usage error");
  const first = await runFxHistoryExport(["--instrument", "EUR_USD", "--sequence", "1", "--output", output], deps);
  assert.equal(first.result, "created");
  const body = await readFile(output, "utf8");
  assert.equal(first.sha256, sha(body));
  assert.deepEqual(first.collections, [{ sequence: 1, bar_count: 4, normalized_sha256: JSON.parse(body).collections[0].normalized_sha256, range_checkpointed: false }]);
  assert.equal((await runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", output], deps)).result, "identical");
  const other = join(dir, "other.json"); await writeFile(other, "{}\n");
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", other], deps), /a different file already exists/);
  assert.equal(await readFile(other, "utf8"), "{}\n");
  const listed = await runFxHistoryExport(["--instrument", "EUR_USD", "--list"], deps);
  assert.deepEqual([listed.manifest_path, listed.collections.map((row) => row.sequence), "bars" in listed.collections[0]], [store.path, [1], false]);
  const seriesPath = join(dir, "series.json");
  const series = await runFxHistoryExport(["--instrument", "EUR_USD", "--sequence", "1", "--format", "bar-series", "--series-id", "oanda:EUR_USD:M15",
    "--evidence-tier", "historical_exploration", "--output", seriesPath], deps);
  assert.equal(series.result, "created");
  const parsed = JSON.parse(await readFile(seriesPath, "utf8"));
  assert.deepEqual(parsed.open_time, ["2026-01-01T00:00:00Z", "2026-01-01T00:15:00Z", "2026-02-11T16:00:00Z", "2026-02-11T16:15:00Z"].map((t) => Date.parse(t) / 1000));
  assert.deepEqual(parsed.close, [1.1002, 1.1001, 1.1002, 1.1003]);
  assert.equal(parsed.source_sha256, (await store.records())[0].normalized_sha256);
  assert.deepEqual(normalizeBarSeries(parsed).series, parsed, "importable as it is");
});

test("a bar series refuses bars off the 15-minute grid", () => {
  const collection = { normalized_sha256: sha("x"), bars: [{ time: "2026-01-01T00:07:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 }] };
  assert.throws(() => fxHistoryBarSeries(collection, { seriesId: "s", evidenceTier: "synthetic_test" }), /15-minute grid/);
});

test("every page that must have been final needs its own checkpoint: a shared first page does not bind another range", async () => {
  const { store, sources, collect } = await setup();
  // Two collections from the same start, two final pages each, the first page identical.
  const pages = (end) => (start) => start === FROM ? [candle("2026-01-01T00:00:00.000Z")] : [candle("2026-02-11T16:00:00.000Z"), candle(end)];
  await collect(FROM, "2026-02-13T00:00:00.000Z", pages("2026-02-12T00:00:00.000Z"));
  await collect(FROM, "2026-02-16T00:00:00.000Z", pages("2026-02-13T12:00:00.000Z"), "2026-08-01T00:00:00.000Z");
  const [a, b] = await store.records();
  assert.equal(a.raw_sha256[0], b.raw_sha256[0]);
  assert.deepEqual((await exportFxHistory({ instrument: "EUR_USD", all: true, ...sources })).collections.map((c) => c.range_checkpointed), [true, true]);
  // A's record moved to B's range: its first page is checkpointed there, its second is not.
  const moved = { instrument: "EUR_USD", records: async () => [{ ...a, requested_to: b.requested_to }] };
  await assert.rejects(() => exportFxHistory({ instrument: "EUR_USD", all: true, ...sources, store: moved, runs: { instrument: "EUR_USD", records: async () => [] } }),
    /no page checkpoint binds page 2/);
});

test("a page re-fetched after a checkpoint written before it was final rebuilds and is bound by the checkpoint that replaced it", async () => {
  const { store, checkpoints, archive, sources, collect } = await setup();
  // An earlier collector version checkpointed this page while its last candle was still forming.
  const early = Buffer.from(JSON.stringify({ candles: [candle("2026-03-02T00:00:00.000Z"), candle("2026-03-02T00:15:00.000Z", "1.1003", false)] }));
  const earlyHash = sha(early);
  await archive.store(earlyHash, early);
  const { fxHistoryCollectionKey } = await import("../../build/oandaHistoricalFx.js");
  const key = fxHistoryCollectionKey("practice", "EUR_USD", "2026-03-02T00:00:00.000Z", "2026-03-02T00:30:00.000Z");
  await checkpoints.append({ collection_key: key, requested_from: "2026-03-02T00:00:00.000Z", requested_to: "2026-03-02T00:30:00.000Z", raw_sha256: earlyHash, raw_bytes: early.byteLength },
    "2026-03-02T00:20:00.000Z");
  const collected = await collect("2026-03-02T00:00:00.000Z", "2026-03-02T00:30:00.000Z", () => [candle("2026-03-02T00:00:00.000Z"), candle("2026-03-02T00:15:00.000Z", "1.1003")]);
  assert.equal(collected.resumed_pages, 0);
  const rows = await checkpoints.completed(key);
  assert.deepEqual(rows.map((row) => row.supersedes_sequence ?? null), [null, 1]);
  const exported = await exportFxHistory({ instrument: "EUR_USD", all: true, ...sources });
  assert.deepEqual([exported.collections[0].bars, exported.collections[0].range_checkpointed], [collected.bars, true]);
  assert.equal((await store.records())[0].raw_sha256[0], rows[1].raw_sha256);
});

test("a bar series holds at most 600,000 bars, checked before any page is read", async () => {
  const { store, checkpoints, runs, collect, dir } = await setup();
  await collect(FROM, TO, twoPages);
  const [record] = await store.records();
  let reads = 0;
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--sequence", "1", "--format", "bar-series", "--series-id", "s", "--evidence-tier", "historical_exploration",
    "--output", join(dir, "big.json")], { checkpoints, runs: { instrument: "EUR_USD", records: async () => [] },
    store: { instrument: "EUR_USD", records: async () => [{ ...record, bar_count: 600_001 }] }, archive: { read: async () => { reads += 1; return Buffer.from(""); } } }), /more than 600000/);
  assert.equal(reads, 0);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", join(dir, "missing", "x.json")], { store, checkpoints, runs, archive: { read: async () => { reads += 1; return Buffer.from(""); } } }),
    /--output must be in an existing directory/);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", dir], { store, checkpoints, runs, archive: { read: async () => { reads += 1; return Buffer.from(""); } } }),
    /--output names a directory/);
  assert.equal(reads, 0);
});

test("--output is judged in its resolved directory: one reached through a link is written into; a link as its own name, and a directory others can write to, are refused before any raw page is read (BACKLOG 103-11)", async () => {
  const { dir, store, checkpoints, runs, archive, collect } = await setup();
  await collect(FROM, TO, twoPages);
  let reads = 0;
  const deps = { store, checkpoints, runs, archive: { read: async (hash) => { reads += 1; return archive.read(hash); } } };
  // A directory whose own name is a link (/tmp on macOS was refused as not a directory).
  const real = join(dir, "real"), alias = join(dir, "alias");
  await mkdir(real, { mode: 0o700 });
  await symlink(real, alias, "junction");   // a junction on Windows, which needs no privilege
  if (process.platform !== "win32") {   // a symbolic link to a file needs privileges on Windows; owners and modes are POSIX
    await symlink(join(dir, "elsewhere.json"), join(real, "linked.json"));
    await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", join(alias, "linked.json")], deps),
      /--output names a symbolic link: .*linked\.json; nothing was written$/);
    const shared = join(dir, "shared");
    await mkdir(shared); await chmod(shared, 0o777);
    for (const split of [[], ["--split"]]) {
      await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", ...split, "--output", join(shared, "eurusd.json")], deps),
        /FX history export will not publish into .*shared: .*shared \(mode 0777, gid \d+\) can be written by its group \(gid \d+\) and every user and has no sticky bit, .*\(run chmod g-w,o-w '.*shared', or choose a directory only you can write to\); nothing was written$/);
    }
    assert.deepEqual(await readdir(shared), []);
  }
  assert.equal(reads, 0);
  const result = await runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", join(alias, "eurusd.json")], deps);
  assert.equal(result.result, "created");
  assert.equal(result.sha256, sha(await readFile(join(real, "eurusd.json"), "utf8")));
  assert.deepEqual(await readdir(real), process.platform === "win32" ? ["eurusd.json"] : ["eurusd.json", "linked.json"]);
  if (process.platform === "win32") return;
  // An export already in such a directory is confirmed, and nothing is written there (BACKLOG 103-11 review): a re-run
  // over evidence in place need not move it.
  const shared = join(dir, "shared");
  await writeFile(join(shared, "eurusd.json"), await readFile(join(real, "eurusd.json")), { mode: 0o600 });
  assert.equal((await runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", join(shared, "eurusd.json")], deps)).result, "identical");
  const parts = await runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--split", "--output", join(real, "split.json")], deps);
  for (const part of parts.parts) await writeFile(join(shared, basename(part.output)), await readFile(part.output), { mode: 0o600 });
  assert.deepEqual((await runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--split", "--output", join(shared, "split.json")], deps)).parts.map((part) => part.result), ["identical"]);
  assert.deepEqual((await readdir(shared)).sort(), ["eurusd.json", "split.part01.json"]);
});

test("the totals describe one moment: the run log is read again after the manifest until both reads agree (BACKLOG 103-9 review)", async () => {
  const { store, checkpoints, runs, archive, sources, collect, dir } = await setup("USD_JPY");
  const flat = (time, c) => ({ complete: true, volume: 5, time, mid: { o: c, h: c, l: c, c } });
  const yen = (start) => [flat(start, "150.10"), flat(new Date(new Date(start).getTime() + 900_000).toISOString(), "150.12")];
  await collect("2026-03-02T00:00:00.000Z", "2026-03-02T00:30:00.000Z", yen);
  await collect("2026-03-03T00:00:00.000Z", "2026-03-03T00:30:00.000Z", yen);
  const all = await runs.records();
  // A run log that grows while the manifest is read: the first reads see one run, then both; the export reads again.
  const reads = { runs: 0, manifest: 0 };
  const growing = (counts) => ({ instrument: "USD_JPY", records: async () => all.slice(0, counts[Math.min(reads.runs++, counts.length - 1)]) });
  const counted = { instrument: "USD_JPY", path: store.path, records: async () => { reads.manifest += 1; return store.records(); } };
  const settled = await exportFxHistory({ instrument: "USD_JPY", all: true, store: counted, checkpoints, archive, runs: growing([1, 2, 2, 2]) });
  // Each attempt reads the manifest twice: before the checkpoints and after them.
  assert.deepEqual([settled.schema_version, settled.manifest_records, settled.run_records, settled.runs.length, reads.manifest], ["1.1", 2, 2, 2, 4]);
  // One that grows every time is given up on after five reads of the manifest, before any raw page is read.
  reads.runs = 0; reads.manifest = 0;
  let pages = 0;
  const everGrowing = { instrument: "USD_JPY", records: async () => Array.from({ length: reads.runs++ }, () => all[0]) };
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, store: counted, checkpoints, runs: everGrowing,
    archive: { read: async (hash) => { pages += 1; return archive.read(hash); } } }), /USD_JPY FX history manifest in .* or its run log grew each of the 5 times they were read; export again when no collection is running/);
  assert.deepEqual([reads.manifest, pages], [10, 0]);
  // The CLI prints the totals. A partial export's bytes change when a run is recorded, though its own collection did not
  // change: export again to a new name.
  const output = join(dir, "usdjpy-1.json");
  const first = await runFxHistoryExport(["--instrument", "USD_JPY", "--sequence", "1", "--output", output], sources);
  assert.deepEqual([first.manifest_records, first.run_records, first.runs, first.collections.length], [2, 2, 1, 1]);
  assert.equal(JSON.parse(await readFile(output, "utf8")).schema_version, "1.1");
  await collect("2026-03-03T00:00:00.000Z", "2026-03-03T00:30:00.000Z", yen, "2026-08-01T00:00:00.000Z");   // collection 2's content again
  await assert.rejects(() => runFxHistoryExport(["--instrument", "USD_JPY", "--sequence", "1", "--output", output], sources), /a different file already exists/);
  const again = await runFxHistoryExport(["--instrument", "USD_JPY", "--sequence", "1", "--output", join(dir, "usdjpy-1b.json")], sources);
  assert.deepEqual([again.result, again.run_records, again.runs, again.collections[0].normalized_sha256], ["created", 3, 1, first.collections[0].normalized_sha256]);
});

/**
 * Four USD_JPY collections of 2, 2, 3 and 2 bars, and five runs: one per collection, then the first collection's content
 * again. Manifest and run-log reads, and raw page reads, are counted.
 */
async function fourCollections() {
  const env = await setup("USD_JPY");
  const flat = (time, c) => ({ complete: true, volume: 5, time, mid: { o: c, h: c, l: c, c } });
  const bars = (n) => (start) => Array.from({ length: n }, (_, i) => flat(new Date(Date.parse(start) + i * 900_000).toISOString(), (150.1 + i / 100).toFixed(2)));
  await env.collect("2026-03-02T00:00:00.000Z", "2026-03-02T00:30:00.000Z", bars(2));
  await env.collect("2026-03-03T00:00:00.000Z", "2026-03-03T00:30:00.000Z", bars(2));
  await env.collect("2026-03-04T00:00:00.000Z", "2026-03-04T00:45:00.000Z", bars(3));
  await env.collect("2026-03-05T00:00:00.000Z", "2026-03-05T00:30:00.000Z", bars(2));
  await env.collect("2026-03-02T00:00:00.000Z", "2026-03-02T00:30:00.000Z", bars(2), "2026-08-01T00:00:00.000Z");
  const logReads = { manifest: 0, runs: 0, checkpoints: 0, byKey: 0 };
  const store = { instrument: "USD_JPY", path: env.store.path, records: async () => { logReads.manifest += 1; return env.store.records(); } };
  const runs = { instrument: "USD_JPY", records: async () => { logReads.runs += 1; return env.runs.records(); } };
  const checkpoints = { instrument: "USD_JPY", records: async () => { logReads.checkpoints += 1; return env.checkpoints.records(); },
    completed: async (key) => { logReads.byKey += 1; return env.checkpoints.completed(key); } };
  return { ...env, logReads, counted: { store, runs, checkpoints, archive: env.counting } };
}

test("a whole export is split into parts of at most the limit, collections whole and runs with their content, from one snapshot (BACKLOG 103-10)", async () => {
  const { counted, reads, logReads, sources } = await fourCollections();
  assert.deepEqual((await sources.store.records()).map((record) => record.bar_count), [2, 2, 3, 2]);
  const split = await splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 5, ...counted });
  // Planned from one snapshot, before any raw page is read: the run log, the manifest, the whole checkpoint log once
  // (not key by key), then the manifest and the run log again.
  assert.deepEqual([logReads.manifest, logReads.runs, logReads.checkpoints, logReads.byKey, reads.count], [2, 2, 1, 0, 0]);
  assert.deepEqual([split.manifest_records, split.run_records], [4, 5]);
  assert.deepEqual(split.parts, [{ index: 1, of: 2, sequences: [1, 2], bars: 4, runs: 3 }, { index: 2, of: 2, sequences: [3, 4], bars: 5, runs: 2 }]);
  const [one, two] = [await split.build(1), await split.build(2)];
  assert.deepEqual([logReads.manifest, logReads.runs, logReads.checkpoints, logReads.byKey], [2, 2, 1, 0], "building a part reads none of them again");
  // Each part is a whole document with the same header and totals, and says which part of how many it is.
  const { collections: c1, runs: r1, ...header1 } = one, { collections: c2, runs: r2, ...header2 } = two;
  assert.deepEqual(Object.keys(one), ["schema_version", "series", "source_id", "evidence_tier", "instrument", "canonical_symbol", "granularity", "price",
    "manifest_records", "run_records", "part", "collections", "runs"]);
  assert.deepEqual([header1.part, header2.part], [{ index: 1, of: 2 }, { index: 2, of: 2 }]);
  assert.deepEqual({ ...header1, part: null }, { ...header2, part: null });
  assert.deepEqual([header1.schema_version, header1.manifest_records, header1.run_records], ["1.1", 4, 5]);
  assert.deepEqual([c1.map((c) => c.sequence), c2.map((c) => c.sequence)], [[1, 2], [3, 4]]);
  // Each run is in the part holding its content, in run-log order: the fifth repeats the first collection's content.
  assert.deepEqual([r1.map((run) => run.sequence), r2.map((run) => run.sequence)], [[1, 2, 5], [3, 4]]);
  assert.ok(r1.every((run) => c1.some((c) => c.normalized_sha256 === run.normalized_sha256)) && r2.every((run) => c2.some((c) => c.normalized_sha256 === run.normalized_sha256)));
  // Recombined, the parts are the whole export: every collection and every run exactly once.
  const whole = await exportFxHistory({ instrument: "USD_JPY", all: true, ...sources });
  assert.deepEqual([...c1, ...c2], whole.collections);
  assert.deepEqual([...r1, ...r2].sort((a, b) => a.sequence - b.sequence), whole.runs);
  assert.deepEqual([whole.collections.length, whole.runs.length], [whole.manifest_records, whole.run_records]);
  // A part built again is the same.
  assert.equal(JSON.stringify(await split.build(1)), JSON.stringify(one));
  await assert.rejects(() => split.build(3), /parts 1 to 2, not 3/);
  await assert.rejects(() => split.build(0), /parts 1 to 2, not 0/);
  // One part when all fit, as many as collections when each fills a part.
  assert.deepEqual((await splitFxHistoryExport({ instrument: "USD_JPY", ...sources })).parts.map((part) => [part.index, part.of, part.sequences]), [[1, 1, [1, 2, 3, 4]]]);
  assert.deepEqual((await splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 3, ...sources })).parts.map((part) => part.sequences), [[1], [2], [3], [4]]);
  // A collection over the part limit, or a whole over the total limit, is refused before any raw page is read.
  reads.count = 0;
  await assert.rejects(() => splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 2, ...counted }), /FX history collection 3 in .* holds 3 bars, more than 2, the most one part holds/);
  await assert.rejects(() => splitFxHistoryExport({ instrument: "USD_JPY", maxBars: 8, ...counted }), /the whole export would hold 9 bars, more than 8, the most an export in parts holds/);
  const [record] = await sources.store.records();
  const huge = { ...counted, runs: { instrument: "USD_JPY", records: async () => [] }, store: { instrument: "USD_JPY", records: async () => [{ ...record, bar_count: 20_000_001 }] } };
  await assert.rejects(() => splitFxHistoryExport({ instrument: "USD_JPY", ...huge }), /would hold 20000001 bars, more than 20000000/);
  const large = { ...huge, store: { instrument: "USD_JPY", records: async () => [{ ...record, bar_count: 1_000_001 }] } };
  await assert.rejects(() => splitFxHistoryExport({ instrument: "USD_JPY", ...large }), /holds 1000001 bars, more than 1000000, the most one part holds/);
  const twoLarge = { ...huge, store: { instrument: "USD_JPY", records: async () => [{ ...record, bar_count: 600_000 }, { ...record, sequence: 2, bar_count: 600_000, normalized_sha256: sha("second") }] } };
  assert.deepEqual((await splitFxHistoryExport({ instrument: "USD_JPY", ...twoLarge })).parts.map((part) => [part.sequences, part.bars]), [[[1], 600_000], [[2], 600_000]]);
  assert.equal(reads.count, 0);
  await assert.rejects(() => splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 0, ...sources }), /bar limits must be positive integers/);
});

test("the CLI writes a split export's parts once each, checks every target before writing any, and lists them (BACKLOG 103-10)", async () => {
  const { counted, reads, sources, dir } = await fourCollections();
  assert.deepEqual(fxHistoryExportPartPaths(join(dir, "usdjpy.json"), 2), [join(dir, "usdjpy.part01.json"), join(dir, "usdjpy.part02.json")]);
  assert.deepEqual(fxHistoryExportPartPaths("usdjpy", 1), ["usdjpy.part01.json"]);
  assert.deepEqual(fxHistoryExportPartPaths("usdjpy.json", 100).slice(-2), ["usdjpy.part099.json", "usdjpy.part100.json"]);
  // --split splits a whole collections export only, and every argument is checked before a raw page is read.
  for (const [argv, pattern] of [
    [["--instrument", "USD_JPY", "--split", "--output", join(dir, "a.json")], /--split goes only with --all and --format collections/],
    [["--instrument", "USD_JPY", "--split", "--sequence", "1", "--output", join(dir, "a.json")], /--split goes only with --all/],
    [["--instrument", "USD_JPY", "--split", "--all", "--format", "bar-series", "--output", join(dir, "a.json")], /--split goes only with --all and --format collections/],
    [["--instrument", "USD_JPY", "--list", "--split"], /--list takes only --instrument/],
    [["--instrument", "USD_JPY", "--split", "--all", "--output", join(dir, "missing", "a.json")], /--output must be in an existing directory/],
  ]) await assert.rejects(() => runFxHistoryExport(argv, counted), pattern, JSON.stringify(argv));
  assert.equal(reads.count, 0);
  // Under the default limit everything fits in one part, written as part01.
  const single = await runFxHistoryExport(["--instrument", "USD_JPY", "--all", "--split", "--output", join(dir, "usdjpy.json")], sources);
  assert.deepEqual([single.split, single.manifest_records, single.run_records, single.runs], [true, 4, 5, 5]);
  assert.deepEqual(single.parts.map((part) => [part.output, part.result, part.collections, part.runs, part.bars]), [[join(dir, "usdjpy.part01.json"), "created", 4, 5, 9]]);
  const body = await readFile(join(dir, "usdjpy.part01.json"), "utf8");
  assert.equal(single.parts[0].sha256, sha(body));
  assert.deepEqual(JSON.parse(body).part, { index: 1, of: 1 });
  assert.deepEqual(single.collections.map((c) => [c.sequence, c.part, c.range_checkpointed]), [[1, 1, true], [2, 1, true], [3, 1, true], [4, 1, true]]);
  assert.equal(await lstatOrNull(join(dir, "usdjpy.json")), null, "--output itself is not written");
  // In two parts: each written, then each found identical.
  const output = join(dir, "two.json"), [first, second] = fxHistoryExportPartPaths(output, 2);
  const split = () => splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 5, ...counted });
  const written = await writeFxHistoryExportParts(await split(), output);
  assert.deepEqual(written.parts.map((part) => [part.index, part.output, part.result, part.collections, part.runs, part.bars]),
    [[1, first, "created", 2, 3, 4], [2, second, "created", 2, 2, 5]]);
  const files = [JSON.parse(await readFile(first, "utf8")), JSON.parse(await readFile(second, "utf8"))];
  assert.deepEqual(files.map((file) => [file.part, file.manifest_records, file.run_records, file.collections.length, file.runs.length]),
    [[{ index: 1, of: 2 }, 4, 5, 2, 3], [{ index: 2, of: 2 }, 4, 5, 2, 2]]);
  assert.deepEqual(written.parts.map((part) => part.sha256), [sha(await readFile(first, "utf8")), sha(await readFile(second, "utf8"))]);
  assert.deepEqual(written.collections.map((c) => [c.sequence, c.part]), [[1, 1], [2, 1], [3, 2], [4, 2]]);
  assert.deepEqual((await writeFxHistoryExportParts(await split(), output)).parts.map((part) => part.result), ["identical", "identical"]);
  // A part found with other bytes refuses the export before anything is written: a missing first part is not created.
  const changed = join(dir, "changed.json"), [changedFirst, changedSecond] = fxHistoryExportPartPaths(changed, 2);
  await writeFile(changedSecond, "{}\n");
  await assert.rejects(async () => writeFxHistoryExportParts(await split(), changed), new RegExp(`a different file already exists at ${changedSecond.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}; nothing was written`));
  assert.equal(await lstatOrNull(changedFirst), null);
  assert.equal(await readFile(changedSecond, "utf8"), "{}\n");
  // A directory at a part's path is refused before any raw page is read.
  const blocked = join(dir, "blocked.json"), [blockedFirst, blockedSecond] = fxHistoryExportPartPaths(blocked, 2);
  await mkdir(blockedSecond);
  reads.count = 0;
  await assert.rejects(async () => writeFxHistoryExportParts(await split(), blocked), /a part of the export would replace a directory: .*blocked\.part02\.json; nothing was written/);
  assert.deepEqual([reads.count, await lstatOrNull(blockedFirst)], [0, null]);
  assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith(".publish-") || name.endsWith(".stage")), [], "no staging is left behind");
  assert.equal((await stat(first)).isFile(), true);
});

test("a split export writes all its parts or none: a later part that fails to build, or a symbolic link at a part's path, leaves no part (BACKLOG 103-10 review)", async () => {
  const { counted, reads, sources, dir } = await fourCollections();
  const third = (await sources.store.records())[2];
  const broken = { read: async (hash) => { if (hash === third.raw_sha256[0]) throw new Error("ENOENT: the raw page is gone"); return sources.archive.read(hash); } };
  const staging = async () => (await readdir(dir)).filter((name) => name.startsWith(".publish-") || name.endsWith(".stage"));
  // The first part is built and staged; the second cannot be built: neither is written.
  const output = join(dir, "broken.json"), paths = fxHistoryExportPartPaths(output, 2);
  await assert.rejects(async () => writeFxHistoryExportParts(await splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 5, ...counted, archive: broken }), output),
    /FX history collection 3, raw page 1: ENOENT: the raw page is gone.*; nothing was written$/);
  assert.deepEqual([await lstatOrNull(paths[0]), await lstatOrNull(paths[1]), await staging()], [null, null, []]);
  // The same through the CLI, in one part.
  await assert.rejects(() => runFxHistoryExport(["--instrument", "USD_JPY", "--all", "--split", "--output", output], { ...sources, archive: broken }), /raw page 1: ENOENT.*; nothing was written$/);
  assert.deepEqual([await lstatOrNull(paths[0]), await staging()], [null, []]);
  // A symbolic link at a part's path is refused before any raw page is read.
  const linked = join(dir, "linked.json"), [linkedFirst, linkedSecond] = fxHistoryExportPartPaths(linked, 2);
  await symlink(join(dir, "elsewhere.json"), linkedSecond);
  reads.count = 0;
  await assert.rejects(async () => writeFxHistoryExportParts(await splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 5, ...counted }), linked),
    /a part of the export would replace a symbolic link: .*linked\.part02\.json; nothing was written/);
  assert.deepEqual([reads.count, await lstatOrNull(linkedFirst), await lstatOrNull(join(dir, "elsewhere.json"))], [0, null, null]);
  // Without --split, a whole export over the limit points to --split; a chosen one does not.
  const [record] = await sources.store.records();
  const big = { ...sources, runs: { instrument: "USD_JPY", records: async () => [] }, store: { instrument: "USD_JPY", records: async () => [{ ...record, bar_count: 1_000_001 }] } };
  await assert.rejects(() => runFxHistoryExport(["--instrument", "USD_JPY", "--all", "--output", join(dir, "big.json")], big), /more than 1000000; write a whole export in parts with --split/);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "USD_JPY", "--sequence", "1", "--output", join(dir, "big.json")], big), /more than 1000000; export fewer collections at a time/);
});

test("the page checkpoints are read with the snapshot, once and whole: one written later is not read, and a manifest with a content twice is refused (BACKLOG 103-10 review)", async () => {
  const { store, checkpoints, archive, sources, collect } = await setup();
  await collect(FROM, TO, twoPages);
  const [record] = await store.records();
  // Page 2 had a forming candle and has no checkpoint. A later run of the same range checkpoints the same response while
  // the export reads its raw pages, after its snapshot: this export does not see it, the next one does.
  const { fxHistoryCollectionKey } = await import("../../build/oandaHistoricalFx.js");
  const key = fxHistoryCollectionKey("practice", "EUR_USD", FROM, TO), page2 = oandaPageRanges(FROM, TO)[1];
  let appended = false;
  const appending = { read: async (hash) => {
    if (!appended) {
      appended = true;
      const body = await archive.read(record.raw_sha256[1]);
      await checkpoints.append({ collection_key: key, requested_from: page2.requestFrom, requested_to: page2.requestTo, raw_sha256: record.raw_sha256[1], raw_bytes: body.byteLength },
        "2026-08-01T00:00:00.000Z");
    }
    return archive.read(hash);
  } };
  const calls = { records: 0, completed: 0 };
  const counted = { instrument: "EUR_USD", records: async () => { calls.records += 1; return checkpoints.records(); }, completed: async (k) => { calls.completed += 1; return checkpoints.completed(k); } };
  const during = await exportFxHistory({ instrument: "EUR_USD", all: true, ...sources, checkpoints: counted, archive: appending });
  assert.deepEqual([appended, during.collections[0].range_checkpointed, calls.records, calls.completed], [true, false, 1, 0]);
  assert.equal((await exportFxHistory({ instrument: "EUR_USD", all: true, ...sources })).collections[0].range_checkpointed, true);
  // A reader without records() is asked key by key, with the same result.
  assert.equal((await exportFxHistory({ instrument: "EUR_USD", all: true, ...sources, checkpoints: { instrument: "EUR_USD", completed: (k) => checkpoints.completed(k) } }))
    .collections[0].range_checkpointed, true);
  // A manifest that grew between its two reads is read again.
  const manifestReads = [];
  const growing = { instrument: "EUR_USD", path: store.path, records: async () => { manifestReads.push(1); return manifestReads.length === 1 ? [] : store.records(); } };
  const settled = await exportFxHistory({ instrument: "EUR_USD", all: true, ...sources, store: growing });
  assert.deepEqual([settled.manifest_records, manifestReads.length], [1, 4]);
  // The manifest keeps each content once; one that holds a content twice is refused before any raw page is read.
  let pages = 0;
  const twice = { instrument: "EUR_USD", path: store.path, records: async () => [record, { ...record, sequence: 2 }] };
  await assert.rejects(() => exportFxHistory({ instrument: "EUR_USD", all: true, ...sources, store: twice, runs: { instrument: "EUR_USD", records: async () => [] },
    archive: { read: async (hash) => { pages += 1; return archive.read(hash); } } }), new RegExp(`EUR_USD FX history manifest in .* records content ${record.normalized_sha256} twice, as collections 1 and 2`));
  await assert.rejects(() => splitFxHistoryExport({ instrument: "EUR_USD", ...sources, store: twice, runs: { instrument: "EUR_USD", records: async () => [] } }), /twice, as collections 1 and 2/);
  assert.equal(pages, 0);
});

test("parts an interrupted export left are named as its debris, and every collection's host is checked before a raw page is read (BACKLOG 103-10 review 2)", async () => {
  const { counted, reads, sources, collect, dir } = await fourCollections();
  const split = () => splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 5, ...counted });
  const output = join(dir, "usdjpy.json"), [first, second] = fxHistoryExportPartPaths(output, 2);
  await writeFxHistoryExportParts(await split(), output);
  // Part01 is linked last: an export cut off while linking leaves part02 without it. The logs then grow.
  await rm(first);
  const flat = (time, c) => ({ complete: true, volume: 5, time, mid: { o: c, h: c, l: c, c } });
  await collect("2026-03-03T00:00:00.000Z", "2026-03-03T00:30:00.000Z", (start) => [flat(start, "150.10"), flat(new Date(Date.parse(start) + 900_000).toISOString(), "150.11")],
    "2026-08-02T00:00:00.000Z");
  const escaped = second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await assert.rejects(async () => writeFxHistoryExportParts(await split(), output), new RegExp(`a different file already exists at ${escaped} \\(part 2 of 2 of an export whose `
    + "other parts are not all there: it looks like debris of an interrupted export; delete it\\); nothing was written$"));
  assert.equal(await lstatOrNull(first), null);
  // A whole set from an earlier moment is not debris: it is named plainly.
  const whole = join(dir, "whole.json"), wholePaths = fxHistoryExportPartPaths(whole, 2);
  await writeFile(wholePaths[0], `${JSON.stringify({ schema_version: "1.1", part: { index: 1, of: 2 } })}\n`);
  await writeFile(wholePaths[1], `${JSON.stringify({ schema_version: "1.1", part: { index: 2, of: 2 } })}\n`);
  await assert.rejects(async () => writeFxHistoryExportParts(await split(), whole),
    (error) => error.message === `a different file already exists at ${wholePaths[0]}, ${wholePaths[1]}; nothing was written`);
  // A collection whose source URL names no OANDA host refuses the split export before any raw page is read.
  const [record] = await sources.store.records();
  reads.count = 0;
  await assert.rejects(() => splitFxHistoryExport({ instrument: "USD_JPY", ...counted, runs: { instrument: "USD_JPY", records: async () => [] },
    store: { instrument: "USD_JPY", path: sources.store.path, records: async () => [{ ...record, source_url_template: "https://example.invalid/v3/accounts/{account}/instruments/USD_JPY/candles" }] } }),
  /FX history collection 1: .*unknown OANDA host \(manifest .*\)/);
  assert.equal(reads.count, 0);
});

test("an --output too long for the lock of its first part is refused before anything is read or written (BACKLOG 103-10 review 5)", async () => {
  const { counted, reads, dir } = await fourCollections();
  const output = join(dir, `${"u".repeat(230)}.json`);
  await assert.rejects(async () => writeFxHistoryExportParts(await splitFxHistoryExport({ instrument: "USD_JPY", maxPartBars: 5, ...counted }), output),
    /--output is too long: the lock of u+\.part01\.json would need 265 bytes of a file name's 255; choose a shorter --output; nothing was written/);
  assert.deepEqual([reads.count, (await readdir(dir)).filter((name) => name.startsWith("uuu"))], [0, []]);
});
