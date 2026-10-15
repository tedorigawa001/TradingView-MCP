import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectOandaM15History, FxHistoricalCheckpointStore, FxHistoricalManifestStore, oandaPageRanges } from "../../build/oandaHistoricalFx.js";
import { FxHistoricalArchive } from "../../build/fxHistoricalArchive.js";
import { FxHistoricalRunLog } from "../../build/fxHistoryRunLog.js";
import { exportFxHistory, fxHistoryBarSeries, listFxHistoryCollections, rebuildFxHistoryCollection } from "../../build/fxHistoryExport.js";
import { runFxHistoryExport } from "../../build/fxHistoryExportCli.js";
import { normalizeBarSeries } from "../../build/barSeries.js";

const candle = (time, close = "1.1002", complete = true) => ({ complete, volume: 17, time, mid: { o: "1.1000", h: "1.1004", l: "1.0998", c: close } });
const response = (candles) => new Response(JSON.stringify({ candles }), { status: 200, headers: { "content-type": "application/json" } });
const sha = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

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
    archive: { read: async () => { reads += 1; return Buffer.from(""); } } }), /more than 1000000/);
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
  assert.deepEqual([settled.schema_version, settled.manifest_records, settled.run_records, settled.runs.length, reads.manifest], ["1.1", 2, 2, 2, 2]);
  // One that grows every time is given up on after five reads of the manifest, before any raw page is read.
  reads.runs = 0; reads.manifest = 0;
  let pages = 0;
  const everGrowing = { instrument: "USD_JPY", records: async () => Array.from({ length: reads.runs++ }, () => all[0]) };
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, store: counted, checkpoints, runs: everGrowing,
    archive: { read: async (hash) => { pages += 1; return archive.read(hash); } } }), /USD_JPY FX history run log grew each of the 5 times the manifest in .* was read; export again when no collection is running/);
  assert.deepEqual([reads.manifest, pages], [5, 0]);
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
