import test from "node:test";
import assert from "node:assert/strict";
import { collectOandaEurUsdM15History } from "../../build/oandaHistoricalFx.js";

const candle = (time, close = "1.1002") => ({ complete: true, volume: 17, time, mid: { o: "1.1000", h: "1.1004", l: "1.0998", c: close } });
const response = (candles) => new Response(JSON.stringify({ candles }), { status: 200, headers: { "content-type": "application/json" } });
const checkpointStore = () => {
  const rows = [];
  return {
    completed: async (key) => rows.filter((row) => row.collection_key === key),
    append: async (row, first_seen_at) => { rows.push({ ...row, first_seen_at }); return { recorded: true, sequence: rows.length }; },
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
