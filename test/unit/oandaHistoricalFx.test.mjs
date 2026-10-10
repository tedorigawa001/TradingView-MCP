import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalOandaSymbol, collectOandaEurUsdM15History, collectOandaM15History, FxHistoricalCheckpointStore, FxHistoricalManifestStore,
  OANDA_FX_INSTRUMENTS, resolveFxHistoricalManifestPathFor } from "../../build/oandaHistoricalFx.js";
import { parseFxHistoryCollectionCliArguments, runFxHistoryCollection } from "../../build/fxHistoryCollectionCli.js";

const candle = (time, close = "1.1002") => ({ complete: true, volume: 17, time, mid: { o: "1.1000", h: "1.1004", l: "1.0998", c: close } });
const response = (candles) => new Response(JSON.stringify({ candles }), { status: 200, headers: { "content-type": "application/json" } });
const checkpointStore = () => {
  const rows = [];
  return {
    completed: async (key) => rows.filter((row) => row.collection_key === key),
    append: async (row, first_seen_at) => { rows.push({ ...row, first_seen_at, sequence: rows.length + 1 }); return { recorded: true, sequence: rows.length }; },
  };
};

test("OANDA M15 collector preserves each raw page and normalizes a page-boundary duplicate", async () => {
  const archived = [];
  let manifest;
  const result = await collectOandaEurUsdM15History({
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", from: "2026-01-01T00:00:00.000Z", to: "2026-02-12T00:00:00.000Z",
    now: () => new Date("2026-07-31T00:00:00.000Z"),
    checkpoints: checkpointStore(),
    archive: { store: async (hash, body) => { archived.push({ hash, bytes: body.byteLength }); return { stored: true, bytes: body.byteLength }; } },
    store: { append: async (row) => { manifest = row; return { recorded: true, sequence: 1 }; } },
    fetch: async (url) => {
      const query = new URL(url).searchParams;
      const start = query.get("from");
      return start === "2026-01-01T00:00:00.000Z"
        ? response([candle("2026-01-01T00:00:00.000000000Z"), candle("2026-02-11T16:00:00.000Z")])
        : response([candle("2026-02-11T16:00:00.000Z"), candle("2026-02-11T16:15:00.000Z", "1.1003")]);
    },
  });
  assert.equal(result.bars.length, 3);
  assert.equal(result.quality.duplicate_timestamps_removed, 1);
  assert.equal(archived.length, 2);
  assert.equal(manifest.bar_count, 3);
  assert.equal(manifest.source_url_template.includes("1234567"), false);
  assert.match(result.normalized_sha256, /^sha256:[a-f0-9]{64}$/);
});

test("OANDA M15 collector excludes incomplete candles and rejects redirect-host changes", async () => {
  await assert.rejects(() => collectOandaEurUsdM15History({
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T00:15:00.000Z",
    archive: { store: async () => ({ stored: true, bytes: 1 }) }, store: { append: async () => ({ recorded: true, sequence: 1 }) },
    checkpoints: checkpointStore(),
    fetch: async () => response([{ ...candle("2026-01-01T00:00:00.000Z"), complete: false }]),
  }), /no complete M15 candles/);
  await assert.rejects(() => collectOandaEurUsdM15History({
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T00:15:00.000Z",
    archive: { store: async () => ({ stored: true, bytes: 1 }) }, store: { append: async () => ({ recorded: true, sequence: 1 }) },
    checkpoints: checkpointStore(),
    fetch: async () => ({ ...response([candle("2026-01-01T00:00:00.000Z")]), url: "https://example.invalid/redirect" }),
  }), /did not match the requested host/);
});

test("OANDA M15 collector retries transient failures but rejects conflicting page-boundary values", async () => {
  let attempts = 0;
  const result = await collectOandaEurUsdM15History({
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T00:15:00.000Z",
    archive: { store: async () => ({ stored: true, bytes: 1 }) }, store: { append: async () => ({ recorded: true, sequence: 1 }) }, sleep: async () => {},
    checkpoints: checkpointStore(),
    fetch: async () => (++attempts === 1 ? new Response("busy", { status: 429 }) : response([candle("2026-01-01T00:00:00.000Z")])),
  });
  assert.equal(attempts, 2);
  assert.equal(result.bars.length, 1);
  await assert.rejects(() => collectOandaEurUsdM15History({
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", from: "2026-01-01T00:00:00.000Z", to: "2026-02-12T00:00:00.000Z",
    archive: { store: async () => ({ stored: true, bytes: 1 }) }, store: { append: async () => ({ recorded: true, sequence: 1 }) },
    checkpoints: checkpointStore(),
    fetch: async (url) => new URL(url).searchParams.get("from") === "2026-01-01T00:00:00.000Z" ? response([candle("2026-02-11T16:00:00.000Z")]) : response([candle("2026-02-11T16:00:00.000Z", "1.1003")]),
  }), /conflicting values/);
});

test("OANDA M15 collector resumes from preserved page checkpoints after an interrupted range", async () => {
  const checkpoints = checkpointStore();
  const raw = new Map();
  const archive = {
    store: async (hash, body) => { raw.set(hash, Buffer.from(body)); return { stored: true, bytes: body.byteLength }; },
    read: async (hash) => raw.get(hash),
  };
  const common = {
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", from: "2026-01-01T00:00:00.000Z", to: "2026-02-12T00:00:00.000Z",
    archive, checkpoints, store: { append: async () => ({ recorded: true, sequence: 1 }) }, now: () => new Date("2026-07-31T00:00:00.000Z"), sleep: async () => {},
  };
  await assert.rejects(() => collectOandaEurUsdM15History({ ...common, fetch: async (url) => new URL(url).searchParams.get("from") === "2026-01-01T00:00:00.000Z" ? response([candle("2026-01-01T00:00:00.000Z"), candle("2026-02-11T16:00:00.000Z")]) : new Response("bad", { status: 400 }) }), /HTTP 400/);
  const requested = [];
  const resumed = await collectOandaEurUsdM15History({ ...common, fetch: async (url) => {
    const from = new URL(url).searchParams.get("from"); requested.push(from);
    if (from === "2026-01-01T00:00:00.000Z") throw new Error("completed page was fetched again");
    return response([candle("2026-02-11T16:00:00.000Z"), candle("2026-02-11T16:15:00.000Z")]);
  } });
  assert.deepEqual(requested, ["2026-02-11T16:00:00.000Z"]);
  assert.equal(resumed.resumed_pages, 1);
  assert.equal(resumed.bars.length, 3);
});

// BACKLOG 102-12: a page is checkpointed only once it is final, so a later run fetches a page that was still open.
const FROM = "2026-01-01T00:00:00.000Z";
const TO = "2026-02-12T00:00:00.000Z";
const SECOND_PAGE = "2026-02-11T16:00:00.000Z";
const memoryArchive = () => {
  const raw = new Map();
  return { raw, store: async (hash, body) => { raw.set(hash, Buffer.from(body)); return { stored: true, bytes: body.byteLength }; }, read: async (hash) => raw.get(hash) };
};
const run = (common, at, pages, requested = []) => collectOandaEurUsdM15History({
  ...common, now: () => new Date(at),
  fetch: async (url) => { const from = new URL(url).searchParams.get("from"); requested.push(from); return response(pages[from]); },
});
const firstPage = [candle("2026-01-01T00:00:00.000Z"), candle(SECOND_PAGE)];
const freshCheckpoints = async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-fx-checkpoints-")), "manifest.jsonl.checkpoints");
  return { path, checkpoints: new FxHistoricalCheckpointStore(path) };
};

test("a page read before it was final is not checkpointed, and a later run fetches only that page again", async () => {
  const checkpoints = checkpointStore();
  const common = { accountId: "001-001-1234567-001", token: "a-made-up-token-for-tests-only", from: FROM, to: TO, archive: memoryArchive(), checkpoints,
    store: { append: async () => ({ recorded: true, sequence: 1 }) }, sleep: async () => {} };
  // At 23:50 the second page still has time to come (its end, midnight, plus a candle), though all it returned is complete.
  const early = await run(common, "2026-02-11T23:50:00.000Z", { [FROM]: firstPage, [SECOND_PAGE]: [candle(SECOND_PAGE), candle("2026-02-11T23:30:00.000Z")] });
  assert.deepEqual([early.unfinished_pages, (await checkpoints.completed(early.collection_key)).map((row) => row.requested_from)], [1, [FROM]]);
  // At 00:15 the page's time is up, but OANDA still has the midnight candle open.
  const forming = [];
  const open = await run(common, "2026-02-12T00:15:00.000Z", { [SECOND_PAGE]: [candle(SECOND_PAGE), candle("2026-02-11T23:45:00.000Z"), { ...candle("2026-02-12T00:00:00.000Z"), complete: false }] }, forming);
  assert.deepEqual([forming, open.resumed_pages, open.unfinished_pages, open.bars.at(-1).time], [[SECOND_PAGE], 1, 1, "2026-02-11T23:45:00.000Z"]);
  // Read again at 00:15 the candle has closed: the page is final, the candle is collected and the page checkpointed; the
  // first page is never fetched again.
  const requested = [];
  const done = await run(common, "2026-02-12T00:15:00.000Z", { [SECOND_PAGE]: [candle(SECOND_PAGE), candle("2026-02-11T23:45:00.000Z"), candle("2026-02-12T00:00:00.000Z")] }, requested);
  assert.deepEqual([requested, done.resumed_pages, done.unfinished_pages, done.bars.at(-1).time], [[SECOND_PAGE], 1, 0, "2026-02-12T00:00:00.000Z"]);
  assert.deepEqual((await checkpoints.completed(done.collection_key)).map((row) => row.requested_from), [FROM, SECOND_PAGE]);
  const again = [];
  assert.deepEqual([(await run(common, "2026-02-13T00:00:00.000Z", {}, again)).resumed_pages, again], [2, []]);
});

test("a page an earlier version checkpointed before it was final is fetched again and its checkpoint replaced, keeping the old one", async () => {
  const { path, checkpoints } = await freshCheckpoints();
  const archive = memoryArchive();
  const common = { accountId: "001-001-1234567-001", token: "a-made-up-token-for-tests-only", from: FROM, to: TO, archive, checkpoints,
    store: { append: async () => ({ recorded: true, sequence: 1 }) }, sleep: async () => {} };
  const first = await run(common, "2026-02-11T23:50:00.000Z", { [FROM]: firstPage, [SECOND_PAGE]: [candle(SECOND_PAGE)] });
  // As 0.1.27 did, the second page was checkpointed with a candle still forming.
  const legacyBody = Buffer.from(JSON.stringify({ candles: [candle(SECOND_PAGE), { ...candle("2026-02-11T23:45:00.000Z"), complete: false }] }));
  const legacyHash = `sha256:${createHash("sha256").update(legacyBody).digest("hex")}`;
  await archive.store(legacyHash, legacyBody);
  await checkpoints.append({ collection_key: first.collection_key, requested_from: SECOND_PAGE, requested_to: TO, raw_sha256: legacyHash, raw_bytes: legacyBody.byteLength }, "2026-02-12T01:00:00.000Z");
  const requested = [];
  const replaced = await run(common, "2026-02-12T02:00:00.000Z", { [SECOND_PAGE]: [candle(SECOND_PAGE), candle("2026-02-11T23:45:00.000Z")] }, requested);
  assert.deepEqual([requested, replaced.resumed_pages, replaced.unfinished_pages, replaced.bars.at(-1).time], [[SECOND_PAGE], 1, 0, "2026-02-11T23:45:00.000Z"]);
  const lines = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((row) => [row.sequence, row.requested_from, row.raw_sha256 === legacyHash, row.supersedes_sequence]), [
    [1, FROM, false, undefined], [2, SECOND_PAGE, true, undefined], [3, SECOND_PAGE, false, 2],
  ]);
  assert.equal(archive.raw.has(legacyHash), true);
  const again = [];
  assert.deepEqual([(await run(common, "2026-02-13T00:00:00.000Z", {}, again)).resumed_pages, again], [2, []]);
  // A checkpoint written a moment before the page's end and one candle is no final page either, even with every candle
  // complete.
  const { path: otherPath, checkpoints: other } = await freshCheckpoints();
  const early = { ...common, checkpoints: other };
  const completeBody = Buffer.from(JSON.stringify({ candles: [candle(SECOND_PAGE)] }));
  const completeHash = `sha256:${createHash("sha256").update(completeBody).digest("hex")}`;
  await archive.store(completeHash, completeBody);
  await other.append({ collection_key: first.collection_key, requested_from: SECOND_PAGE, requested_to: TO, raw_sha256: completeHash, raw_bytes: completeBody.byteLength }, "2026-02-12T00:14:59.999Z");
  // Fetched again, the page returns the very same bytes; the checkpoint read now replaces the early one all the same,
  // so the page is not fetched on every run.
  const refetched = [];
  await run(early, "2026-02-12T02:00:00.000Z", { [FROM]: firstPage, [SECOND_PAGE]: [candle(SECOND_PAGE)] }, refetched);
  assert.deepEqual(refetched, [FROM, SECOND_PAGE]);
  const otherLines = (await readFile(otherPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(otherLines.filter((row) => row.requested_from === SECOND_PAGE).map((row) => [row.raw_sha256 === completeHash, row.supersedes_sequence]), [[true, undefined], [true, 1]]);
  const settled = [];
  await run(early, "2026-02-13T00:00:00.000Z", {}, settled);
  assert.deepEqual(settled, []);
});

test("a page's checkpoints form a chain, and another raw response must name the latest one it replaces", async () => {
  const { path, checkpoints: store } = await freshCheckpoints();
  const hash = (digit) => `sha256:${digit.repeat(64)}`;
  const row = (raw_sha256, extra = {}) => ({ collection_key: hash("a"), requested_from: FROM, requested_to: TO, raw_sha256, raw_bytes: 10, ...extra });
  const at = "2026-02-13T00:00:00.000Z";
  assert.deepEqual(await store.append(row(hash("1")), at), { recorded: true, sequence: 1 });
  assert.deepEqual(await store.append(row(hash("1")), at), { recorded: false, sequence: 1 });
  await assert.rejects(store.append(row(hash("2")), at), /conflicts with a prior raw response/);
  await assert.rejects(store.append(row(hash("2"), { supersedes_sequence: 2 }), at), /conflicts with a prior raw response/);
  await assert.rejects(store.append({ ...row(hash("2"), { supersedes_sequence: 1 }), requested_to: "2026-02-13T00:00:00.000Z" }, at), /conflicts with a prior raw response/);
  assert.deepEqual(await store.append(row(hash("2"), { supersedes_sequence: 1 }), at), { recorded: true, sequence: 2 });
  await assert.rejects(store.append(row(hash("3"), { supersedes_sequence: 1 }), at), /conflicts with a prior raw response/);
  assert.deepEqual(await store.append(row(hash("2")), at), { recorded: false, sequence: 2 });
  assert.deepEqual(await store.append(row(hash("3"), { supersedes_sequence: 2 }), at), { recorded: true, sequence: 3 });
  // A second run that replaced the same checkpoint with the same raw response finds it recorded; another raw response
  // replacing an earlier checkpoint still conflicts, as does the same hash at another size.
  assert.deepEqual(await store.append(row(hash("3"), { supersedes_sequence: 2 }), at), { recorded: false, sequence: 3 });
  await assert.rejects(store.append(row(hash("4"), { supersedes_sequence: 2 }), at), /conflicts with a prior raw response/);
  await assert.rejects(store.append({ ...row(hash("3")), raw_bytes: 11 }, at), /conflicts with a prior raw response/);
  // The same raw response read again once the page is final replaces the latest checkpoint when it says so.
  assert.deepEqual(await store.append(row(hash("3"), { supersedes_sequence: 3 }), at), { recorded: true, sequence: 4 });
  assert.deepEqual((await store.completed(hash("a"))).map((item) => item.supersedes_sequence), [undefined, 1, 2, 3]);
  // A chain broken in the file is refused, as is a checkpoint that names itself or a later one.
  const lines = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  await writeFile(path, `${[lines[0], lines[1], { ...lines[2], supersedes_sequence: 1 }].map((line) => JSON.stringify(line)).join("\n")}\n`, { mode: 0o600 });
  await assert.rejects(store.append(row(hash("4"), { supersedes_sequence: 3 }), at), /do not form a chain/);
  await writeFile(path, `${[lines[0], { ...lines[1], supersedes_sequence: 2 }].map((line) => JSON.stringify(line)).join("\n")}\n`, { mode: 0o600 });
  await assert.rejects(store.completed(hash("a")), /invalid FX history page checkpoint supersedes_sequence/);
});

test("the page's time is judged when it was requested, not when the answer came", async () => {
  // The request goes out at 00:10 and the answer arrives at 00:20: the page ending at midnight was asked for before its
  // last candle could have closed, so it is not final.
  const checkpoints = checkpointStore();
  let clock = "2026-02-12T00:10:00.000Z";
  const result = await collectOandaEurUsdM15History({
    accountId: "001-001-1234567-001", token: "a-made-up-token-for-tests-only", from: SECOND_PAGE, to: TO, archive: memoryArchive(), checkpoints,
    store: { append: async () => ({ recorded: true, sequence: 1 }) }, sleep: async () => {}, now: () => new Date(clock),
    fetch: async () => { clock = "2026-02-12T00:20:00.000Z"; return response([candle(SECOND_PAGE), candle("2026-02-11T23:45:00.000Z")]); },
  });
  assert.deepEqual([result.unfinished_pages, (await checkpoints.completed(result.collection_key)).length], [1, 0]);
});

test("an early checkpoint fetched again but still not final stays, and two runs replacing it at once both succeed", async () => {
  const { path, checkpoints } = await freshCheckpoints();
  const archive = memoryArchive();
  const common = { accountId: "001-001-1234567-001", token: "a-made-up-token-for-tests-only", from: FROM, to: TO, archive, checkpoints,
    store: { append: async () => ({ recorded: true, sequence: 1 }) }, sleep: async () => {} };
  const first = await run(common, "2026-02-11T23:50:00.000Z", { [FROM]: firstPage, [SECOND_PAGE]: [candle(SECOND_PAGE)] });
  const earlyBody = Buffer.from(JSON.stringify({ candles: [candle(SECOND_PAGE)] }));
  const earlyHash = `sha256:${createHash("sha256").update(earlyBody).digest("hex")}`;
  await archive.store(earlyHash, earlyBody);
  await checkpoints.append({ collection_key: first.collection_key, requested_from: SECOND_PAGE, requested_to: TO, raw_sha256: earlyHash, raw_bytes: earlyBody.byteLength }, "2026-02-11T23:55:00.000Z");
  // At 00:12 the page is still open: it is fetched, nothing is checkpointed, and the early checkpoint stays the latest.
  const open = await run(common, "2026-02-12T00:12:00.000Z", { [SECOND_PAGE]: [candle(SECOND_PAGE), candle("2026-02-11T23:45:00.000Z")] });
  assert.deepEqual([open.unfinished_pages, (await readFile(path, "utf8")).trim().split("\n").length], [1, 2]);
  // Two runs at 01:00 both find the early checkpoint, both fetch the same answer, and both replace it: one writes the
  // replacement and the other finds it written.
  let arrived = 0;
  let release;
  const bothFetched = new Promise((resolve) => { release = resolve; });
  const concurrent = () => collectOandaEurUsdM15History({ ...common, now: () => new Date("2026-02-12T01:00:00.000Z"),
    fetch: async () => { arrived += 1; if (arrived === 2) release(); await bothFetched; return response([candle(SECOND_PAGE), candle("2026-02-11T23:45:00.000Z")]); } });
  const results = await Promise.all([concurrent(), concurrent()]);
  assert.deepEqual(results.map((result) => [result.resumed_pages, result.unfinished_pages, result.bars.length]), [[1, 0, 3], [1, 0, 3]]);
  const lines = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((row) => row.supersedes_sequence), [undefined, undefined, 2]);
  // A port that lists checkpoints out of order still yields each page's latest.
  const reversed = { completed: async (key) => (await checkpoints.completed(key)).reverse(), append: (row, at) => checkpoints.append(row, at) };
  const requested = [];
  await run({ ...common, checkpoints: reversed }, "2026-02-13T00:00:00.000Z", {}, requested);
  assert.deepEqual(requested, []);
});

// BACKLOG 103-1: the collector reads one of nine instruments, each into its own manifest and checkpoints; EUR_USD keeps
// the files and the collection key it always had.
// Points the manifest and raw archive paths into a temporary directory for one test, and restores them after it.
async function withFxPaths(t, manifestName = "fx-history-m15-manifest.jsonl") {
  const directory = await mkdtemp(join(tmpdir(), "oanda-instruments-"));
  const base = join(directory, manifestName);
  const saved = { manifest: process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH, archive: process.env.TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH };
  process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH = base;
  process.env.TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH = join(directory, "raw");
  t.after(() => {
    for (const [key, value] of [["TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH", saved.manifest], ["TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH", saved.archive]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return { directory, base };
}
const exists = (path) => access(path).then(() => true, () => false);
const yenCandles = () => [candle("2026-01-05T00:00:00.000Z", "157.012"), candle("2026-01-05T00:15:00.000Z", "157.010")]
  .map((bar) => ({ ...bar, mid: { o: "157.000", h: "157.020", l: "156.990", c: bar.mid.c } }));
const stubPorts = () => ({ checkpoints: checkpointStore(), archive: { store: async () => ({ stored: true, bytes: 1 }) },
  store: { append: async () => ({ recorded: true, sequence: 1 }) } });

test("another instrument is collected into its own manifest and checkpoints, and EUR_USD keeps its files and key (103-1)", async (t) => {
  const { directory, base } = await withFxPaths(t);
  const requested = [];
  const common = {
    accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", from: "2026-01-05T00:00:00.000Z", to: "2026-01-05T00:30:00.000Z",
    now: () => new Date("2026-02-01T00:00:00.000Z"),
    fetch: async (url) => {
      requested.push(new URL(url).pathname);
      return response(yenCandles());
    },
  };
  const yen = await collectOandaM15History({ ...common, instrument: "USD_JPY" });
  assert.deepEqual([yen.instrument, yen.canonical_symbol, yen.bars.length], ["USD_JPY", "OANDA:USDJPY", 2]);
  assert.match(requested[0], /\/instruments\/USD_JPY\/candles$/);
  const yenManifest = `${directory}/fx-history-m15-manifest.USD_JPY.jsonl`;
  const [row] = (await readFile(yenManifest, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual([row.instrument, row.canonical_symbol, row.source_url_template.endsWith("/instruments/USD_JPY/candles")], ["USD_JPY", "OANDA:USDJPY", true]);
  assert.equal(await exists(`${yenManifest}.checkpoints`), true);
  assert.equal(await exists(base), false, "the EUR_USD manifest is not touched");
  assert.equal(await exists(`${base}.checkpoints`), false, "nor are its checkpoints");
  // EUR_USD keeps its paths and its collection key; the two collections of one range do not share a key.
  const euro = await collectOandaM15History({ ...common });
  assert.equal(euro.collection_key, `sha256:${createHash("sha256").update(`oanda_v20|practice|EUR_USD|M15|M|${common.from}|${common.to}`).digest("hex")}`);
  assert.notEqual(euro.collection_key, yen.collection_key);
  assert.equal(await exists(base), true);
  assert.equal(await exists(`${base}.checkpoints`), true);
  // A manifest holds one instrument: a store for another refuses it.
  await assert.rejects(new FxHistoricalManifestStore(yenManifest).coverage(), /unsupported FX history manifest/);
  assert.equal((await new FxHistoricalManifestStore(yenManifest, "USD_JPY").coverage()).records, 1);
  await assert.rejects(new FxHistoricalManifestStore(base, "USD_JPY").coverage(), /unsupported FX history manifest/);
  // The EUR_USD wrapper is the default collection, and a caller cannot turn it into another instrument.
  assert.equal((await collectOandaEurUsdM15History({ ...common })).collection_key, euro.collection_key);
  assert.equal((await collectOandaEurUsdM15History({ ...common, instrument: "USD_JPY" })).instrument, "EUR_USD");
  // Without a path, a store uses its own instrument's files (review: it used EUR_USD's).
  assert.equal((await new FxHistoricalManifestStore(undefined, "USD_JPY").coverage()).records, 1);
  assert.ok((await new FxHistoricalCheckpointStore(undefined, "USD_JPY").completed(yen.collection_key)).length > 0);
  assert.deepEqual(await new FxHistoricalCheckpointStore(undefined, "USD_JPY").completed(euro.collection_key), []);
  // Each half of a row's identity is checked: the instrument, and the symbol that goes with it.
  const [euroRow] = (await readFile(base, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  for (const [name, row, instrument] of [["symbol", { ...euroRow, canonical_symbol: "OANDA:USDJPY" }, "EUR_USD"],
    ["instrument", { ...euroRow, instrument: "USD_JPY" }, "EUR_USD"], ["instrument-for-yen", { ...euroRow, instrument: "USD_JPY" }, "USD_JPY"]]) {
    const path = join(directory, `${name}.jsonl`);
    await writeFile(path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    await assert.rejects(new FxHistoricalManifestStore(path, instrument).coverage(), /unsupported FX history manifest/, name);
  }
});

test("a store, a checkpoint store or a response for another instrument is refused (103-1 review)", async () => {
  let fetched = 0;
  const common = { accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length", from: "2026-01-05T00:00:00.000Z", to: "2026-01-05T00:30:00.000Z",
    now: () => new Date("2026-02-01T00:00:00.000Z"), instrument: "USD_JPY" };
  const directory = await mkdtemp(join(tmpdir(), "oanda-mismatch-"));
  // Before anything is fetched or written.
  for (const [name, ports] of [
    ["manifest store", { ...stubPorts(), store: new FxHistoricalManifestStore(join(directory, "m.jsonl")) }],
    ["checkpoint store", { ...stubPorts(), checkpoints: new FxHistoricalCheckpointStore(join(directory, "m.jsonl.checkpoints")) }],
  ]) {
    await assert.rejects(collectOandaM15History({ ...common, ...ports, fetch: async () => { fetched += 1; return response(yenCandles()); } }),
      new RegExp(`the FX history ${name} is for EUR_USD, not USD_JPY`));
  }
  assert.equal(fetched, 0);
  assert.equal(await exists(join(directory, "m.jsonl")), false);
  // A response that names another instrument or granularity.
  for (const [named, pattern] of [[{ instrument: "EUR_USD", granularity: "M15" }, /named EUR_USD, not USD_JPY/], [{ instrument: "USD_JPY", granularity: "H1" }, /granularity H1, not M15/]]) {
    await assert.rejects(collectOandaM15History({ ...common, ...stubPorts(),
      fetch: async () => new Response(JSON.stringify({ ...named, candles: yenCandles() }), { status: 200 }) }), pattern);
  }
  const ok = await collectOandaM15History({ ...common, ...stubPorts(),
    fetch: async () => new Response(JSON.stringify({ instrument: "USD_JPY", granularity: "M15", candles: yenCandles() }), { status: 200 }) });
  assert.equal(ok.bars.length, 2);
});

test("gold's daily trading break is counted as a weekday discontinuity (103-1 review)", async () => {
  // A summer week of XAU_USD: Monday 00:00 to Friday 20:45 UTC, with the daily break 21:00-22:00 UTC (17:00-18:00 New York).
  const candles = [];
  for (let at = Date.parse("2026-07-06T00:00:00.000Z"); at <= Date.parse("2026-07-10T20:45:00.000Z"); at += 15 * 60 * 1000) {
    if (new Date(at).getUTCHours() === 21) continue;
    candles.push({ complete: true, volume: 5, time: new Date(at).toISOString(), mid: { o: "2650.125", h: "2650.500", l: "2649.875", c: "2650.250" } });
  }
  const result = await collectOandaM15History({ accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length",
    from: "2026-07-06T00:00:00.000Z", to: "2026-07-10T21:00:00.000Z", instrument: "XAU_USD", now: () => new Date("2026-08-01T00:00:00.000Z"),
    ...stubPorts(), fetch: async () => response(candles) });
  assert.deepEqual([result.canonical_symbol, result.bars.length, result.quality.non_contiguous_weekday_intervals], ["OANDA:XAUUSD", candles.length, 4]);
});

test("a configured manifest path that names a directory is refused before anything is fetched (103-1 review)", async (t) => {
  const { directory } = await withFxPaths(t, "manifest-directory");
  await mkdir(join(directory, "manifest-directory"));
  let fetched = 0;
  await assert.rejects(collectOandaM15History({ accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length",
    from: "2026-01-05T00:00:00.000Z", to: "2026-01-05T00:30:00.000Z", instrument: "USD_JPY", fetch: async () => { fetched += 1; return response(yenCandles()); } }),
  /must name a file, not a directory/);
  assert.equal(fetched, 0);
  assert.equal(await exists(join(directory, "manifest-directory.USD_JPY")), false);
});

test("the CLI collects the instrument it names (103-1 review)", async (t) => {
  const { directory } = await withFxPaths(t);
  const requested = [];
  const argv = ["--from", "2026-01-05T00:00:00.000Z", "--to", "2026-01-05T00:30:00.000Z", "--confirm-external-fetch", "--instrument", "USD_JPY"];
  const env = { OANDA_FX_HISTORY_ACCOUNT_ID: "001-001-1234567-001", OANDA_FX_HISTORY_ACCESS_TOKEN: "a-valid-token-with-enough-length" };
  const summary = await runFxHistoryCollection(argv, env, { now: () => new Date("2026-02-01T00:00:00.000Z"),
    fetch: async (url) => { requested.push(new URL(url).pathname); return response(yenCandles()); } });
  assert.deepEqual([summary.instrument, summary.canonical_symbol, summary.bars_collected, "bars" in summary], ["USD_JPY", "OANDA:USDJPY", 2, false]);
  assert.match(requested[0], /\/instruments\/USD_JPY\/candles$/);
  assert.equal(await exists(join(directory, "fx-history-m15-manifest.USD_JPY.jsonl")), true);
  await assert.rejects(runFxHistoryCollection(argv, {}, {}), /set OANDA_FX_HISTORY_ACCOUNT_ID and OANDA_FX_HISTORY_ACCESS_TOKEN/);
});

test("only the listed instruments are read, and each has its own manifest path (103-1)", async () => {
  assert.deepEqual([...OANDA_FX_INSTRUMENTS], ["EUR_USD", "USD_JPY", "GBP_USD", "AUD_USD", "NZD_USD", "USD_CAD", "USD_CHF", "AUD_NZD", "XAU_USD"]);
  assert.deepEqual(OANDA_FX_INSTRUMENTS.map(canonicalOandaSymbol).slice(0, 2), ["OANDA:EURUSD", "OANDA:USDJPY"]);
  assert.equal(canonicalOandaSymbol("XAU_USD"), "OANDA:XAUUSD");
  // Stub ports, so a check that came too late would touch nothing under the real home.
  for (const instrument of ["BTC_USD", "EUR/USD", "eur_usd", "", null]) {
    await assert.rejects(collectOandaM15History({ accountId: "001-001-1234567-001", token: "a-valid-token-with-enough-length",
      from: "2026-01-05T00:00:00.000Z", to: "2026-01-05T00:30:00.000Z", instrument, ...stubPorts(), fetch: async () => { throw new Error("no request expected"); } }),
    /instrument must be one of EUR_USD, USD_JPY/, JSON.stringify(instrument));
  }
  assert.throws(() => new FxHistoricalManifestStore("/x/m.jsonl", "BTC_USD"), /instrument must be one of/);
  assert.equal(resolveFxHistoricalManifestPathFor("EUR_USD", "/x/m.jsonl"), "/x/m.jsonl");
  assert.equal(resolveFxHistoricalManifestPathFor("XAU_USD", "/x/m.jsonl"), "/x/m.XAU_USD.jsonl");
  assert.equal(resolveFxHistoricalManifestPathFor("XAU_USD", "/x/m.JSONL"), "/x/m.XAU_USD.JSONL");
  assert.equal(resolveFxHistoricalManifestPathFor("AUD_NZD", "/x/manifest"), "/x/manifest.AUD_NZD");
  for (const path of ["/x/dir/", "C:\\x\\dir\\"]) {
    assert.throws(() => resolveFxHistoricalManifestPathFor("USD_JPY", path), /must name a file, not a directory/, path);
  }
});

test("the CLI names the instrument, EUR_USD by default (103-1)", () => {
  const base = ["--from", "2026-01-05T00:00:00.000Z", "--to", "2026-01-06T00:00:00.000Z", "--confirm-external-fetch"];
  assert.equal(parseFxHistoryCollectionCliArguments(base).instrument, "EUR_USD");
  assert.equal(parseFxHistoryCollectionCliArguments([...base, "--instrument", "XAU_USD"]).instrument, "XAU_USD");
  assert.throws(() => parseFxHistoryCollectionCliArguments([...base, "--instrument", "XAUUSD"]), /instrument must be one of/);
  assert.throws(() => parseFxHistoryCollectionCliArguments([...base, "--instrument"]), /instrument must be one of/);
});
