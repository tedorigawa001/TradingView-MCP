import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectOandaM15History, FxHistoricalCheckpointStore, FxHistoricalManifestStore, oandaPageRanges } from "../../build/oandaHistoricalFx.js";
import { FxHistoricalArchive } from "../../build/fxHistoricalArchive.js";
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
  const archive = new FxHistoricalArchive(join(dir, "raw"));
  const collect = (from, to, pages) => collectOandaM15History({
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", instrument, from, to,
    now: () => new Date("2026-07-31T00:00:00.000Z"), sleep: async () => {},
    archive, store, checkpoints: new FxHistoricalCheckpointStore(`${manifestPath}.checkpoints`, instrument),
    fetch: async (url) => response(pages(new URL(url).searchParams.get("from"))),
  });
  return { dir, store, archive, collect };
}
// Two pages (42 days is more than 4,000 candles) with the boundary candle in both, nanosecond times, and an unfinished
// candle at the end that the collection leaves out.
const twoPages = (start) => start === "2026-01-01T00:00:00.000Z"
  ? [candle("2026-01-01T00:00:00.000000000Z"), candle("2026-01-01T00:15:00.000000000Z", "1.1001"), candle("2026-02-11T16:00:00.000Z")]
  : [candle("2026-02-11T16:00:00.000Z"), candle("2026-02-11T16:15:00.000Z", "1.1003"), candle("2026-02-11T16:30:00.000Z", "1.1005", false)];

test("a recorded collection is rebuilt from its raw pages into the bars the collection returned", async () => {
  const { store, archive, collect } = await setup();
  const collected = await collect("2026-01-01T00:00:00.000Z", "2026-02-12T00:00:00.000Z", twoPages);
  assert.equal(collected.unfinished_pages, 1);
  assert.equal(oandaPageRanges("2026-01-01T00:00:00.000Z", "2026-02-12T00:00:00.000Z").length, 2);
  const [record] = await store.records();
  assert.deepEqual(await rebuildFxHistoryCollection(record, archive), collected.bars);
  const exported = await exportFxHistory({ instrument: "EUR_USD", sequences: [1], store, archive });
  assert.equal(exported.collections.length, 1);
  const { bars, ...fields } = exported.collections[0];
  assert.deepEqual(bars, collected.bars);
  assert.deepEqual(fields, { sequence: 1, requested_from: record.requested_from, requested_to: record.requested_to, retrieved_at: record.retrieved_at,
    raw_sha256: record.raw_sha256, normalized_sha256: collected.normalized_sha256, bar_count: 4, first_bar_at: "2026-01-01T00:00:00.000Z",
    last_bar_at: "2026-02-11T16:15:00.000Z", duplicate_timestamps_removed: 1, non_contiguous_weekday_intervals: record.non_contiguous_weekday_intervals });
  assert.equal(`sha256:${createHash("sha256").update(JSON.stringify(bars)).digest("hex")}`, collected.normalized_sha256, "the normalized hash is the hash of the bars as a JSON array");
  // The same records give the same bytes.
  assert.equal(JSON.stringify(await exportFxHistory({ instrument: "EUR_USD", all: true, store, archive })), JSON.stringify(exported));
});

test("a record that does not match its raw pages is refused, field by field", async () => {
  const { store, archive, collect } = await setup();
  await collect("2026-01-01T00:00:00.000Z", "2026-02-12T00:00:00.000Z", twoPages);
  const [record] = await store.records();
  const altered = (change) => ({ instrument: "EUR_USD", records: async () => [{ ...record, ...change }] });
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
  ]) await assert.rejects(() => exportFxHistory({ instrument: "EUR_USD", sequences: [1], store: altered(change), archive }), pattern, JSON.stringify(change));
  // The raw responses do not carry the range they answered: a last page's end moved outward is not detectable.
  assert.equal((await exportFxHistory({ instrument: "EUR_USD", sequences: [1], store: altered({ requested_to: "2026-02-13T00:00:00.000Z" }), archive })).collections[0].bar_count, 4);
  // An archive that hands back other bytes than the hash names.
  const lying = { read: async (hash) => Buffer.from(JSON.stringify({ candles: [] })) };
  await assert.rejects(() => exportFxHistory({ instrument: "EUR_USD", sequences: [1], store, archive: lying }), /raw page 1 does not match its hash/);
});

test("collections are chosen by sequence or all, for the instrument of the store, within the size limit", async () => {
  const { store, archive, collect } = await setup("USD_JPY");
  const flat = (time, c) => ({ complete: true, volume: 5, time, mid: { o: c, h: c, l: c, c } });
  const yen = (start) => [flat(start, "150.10"), flat(new Date(new Date(start).getTime() + 900_000).toISOString(), "150.12")];
  await collect("2026-03-02T00:00:00.000Z", "2026-03-02T00:30:00.000Z", yen);
  await collect("2026-03-03T00:00:00.000Z", "2026-03-03T00:30:00.000Z", yen);
  assert.deepEqual((await listFxHistoryCollections({ instrument: "USD_JPY", store })).map((row) => [row.sequence, row.pages, row.bar_count]), [[1, 1, 2], [2, 1, 2]]);
  const both = await exportFxHistory({ instrument: "USD_JPY", sequences: [2, 1], store, archive });
  assert.deepEqual(both.collections.map((c) => c.sequence), [1, 2], "manifest order");
  assert.equal(both.canonical_symbol, "OANDA:USDJPY");
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", sequences: [3], store, archive }), /no USD_JPY FX history collection has sequence 3/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", sequences: [1], all: true, store, archive }), /by sequence, or export all/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", store, archive }), /by sequence, or export all/);
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", sequences: [0], store, archive }), /positive integer/);
  await assert.rejects(() => exportFxHistory({ instrument: "EUR_USD", all: true, store, archive }), /store is for USD_JPY, not EUR_USD/);
  const [record] = await store.records();
  let reads = 0;
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, store: { instrument: "USD_JPY", records: async () => [{ ...record, bar_count: 1_000_001 }] },
    archive: { read: async () => { reads += 1; return Buffer.from(""); } } }), /more than 1000000/);
  assert.equal(reads, 0, "the size is checked before any page is read");
  await assert.rejects(() => exportFxHistory({ instrument: "USD_JPY", all: true, store: { instrument: "USD_JPY", records: async () => [] }, archive }), /no USD_JPY FX history collection is recorded/);
});

test("the CLI writes a new file once, reports a rerun as identical, refuses other bytes, lists records and writes a bar series", async () => {
  const { dir, store, archive, collect } = await setup();
  await collect("2026-01-01T00:00:00.000Z", "2026-02-12T00:00:00.000Z", twoPages);
  const deps = { store, archive }, output = join(dir, "eurusd.json");
  const first = await runFxHistoryExport(["--instrument", "EUR_USD", "--sequence", "1", "--output", output], deps);
  assert.equal(first.result, "created");
  const body = await readFile(output, "utf8");
  assert.equal(first.sha256, sha(body));
  assert.equal(JSON.parse(body).collections[0].bars.length, 4);
  assert.equal((await runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", output], deps)).result, "identical");
  const other = join(dir, "other.json"); await writeFile(other, "{}\n");
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--output", other], deps), /a different file already exists/);
  assert.equal(await readFile(other, "utf8"), "{}\n");
  const listed = await runFxHistoryExport(["--instrument", "EUR_USD", "--list"], deps);
  assert.deepEqual(listed.collections.map((row) => row.sequence), [1]);
  assert.equal("bars" in listed.collections[0], false);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--list", "--all"], deps), /--list takes only --instrument/);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EURUSD", "--all", "--output", output], deps), /--instrument must be one of/);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all"], deps), /--output is required/);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--sequence", "1.5", "--output", output], deps), /--sequence must be a positive integer/);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--format", "csv", "--output", output], deps), /--format must be/);
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--series-id", "x", "--output", join(dir, "y.json")], deps), /belong to --format bar-series/);
  const seriesPath = join(dir, "series.json");
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--sequence", "1", "--format", "bar-series", "--output", seriesPath], deps), /requires --series-id and --evidence-tier/);
  const series = await runFxHistoryExport(["--instrument", "EUR_USD", "--sequence", "1", "--format", "bar-series", "--series-id", "oanda:EUR_USD:M15",
    "--evidence-tier", "historical_exploration", "--output", seriesPath], deps);
  assert.equal(series.result, "created");
  const parsed = JSON.parse(await readFile(seriesPath, "utf8"));
  assert.deepEqual(parsed.open_time, ["2026-01-01T00:00:00Z", "2026-01-01T00:15:00Z", "2026-02-11T16:00:00Z", "2026-02-11T16:15:00Z"].map((t) => Date.parse(t) / 1000));
  assert.deepEqual(parsed.close, [1.1002, 1.1001, 1.1002, 1.1003]);
  assert.equal(parsed.source_sha256, (await store.records())[0].normalized_sha256);
  assert.deepEqual(normalizeBarSeries(parsed).series, parsed, "importable as it is");
  await assert.rejects(() => runFxHistoryExport(["--instrument", "EUR_USD", "--all", "--format", "bar-series", "--series-id", "forecast-set-source:x",
    "--evidence-tier", "prospective", "--output", join(dir, "z.json")], deps), /reserved prefix/);
});

test("a bar series refuses bars off the 15-minute grid", () => {
  const collection = { normalized_sha256: sha("x"), bars: [{ time: "2026-01-01T00:07:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 }] };
  assert.throws(() => fxHistoryBarSeries(collection, { seriesId: "s", evidenceTier: "synthetic_test" }), /15-minute grid/);
});
