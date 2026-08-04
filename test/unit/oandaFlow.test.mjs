import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OandaFlowRawArchive, collectOandaFlow, oandaFlowTokenConfigured, parseOandaOrderBook, parseOandaPositionRatios } from "../../build/oandaFlow.js";
import { parseOandaFlowCollectionCliArguments } from "../../build/oandaFlowCollectionCli.js";

// Each series is a share across the price buckets, so each totals a hundred. The earlier fixture
// used values that could never come from a complete response, which the share check now refuses.
const orderBook = JSON.stringify({
  "1720000000": { rate: 1.08, price_points: {
    "1.079": { os: 30, ol: 70, ps: 25, pl: 75 },
    "1.081": { os: 70, ol: 30, ps: 75, pl: 25 },
  } },
});
const ratios = JSON.stringify({ data: { EUR_USD: { data: [[1720000000, 55.2, 1.08], [1720001200, 54.8, 1.0802]] } } });

test("OANDA flow parsers preserve provider time and reject non-finite percentage data", () => {
  const collectedAt = "2026-08-02T00:00:00.000Z";
  assert.deepEqual(parseOandaOrderBook(orderBook, collectedAt)[0].pricePoints.map((point) => point.price), [1.079, 1.081]);
  assert.equal(parseOandaPositionRatios(ratios, "EUR_USD", collectedAt)[1].longPositionPercent, 54.8);
  assert.throws(() => parseOandaOrderBook(JSON.stringify({ "1720000000": { rate: 1, price_points: { "1": { os: -1, ol: 0, ps: 0, pl: 0 } } } }), collectedAt), /percent is invalid/);
  // A per-value range check passes here; only the share total sees that the body is not whole.
  assert.throws(() => parseOandaOrderBook(JSON.stringify({ "1720000000": { rate: 1, price_points: { "1": { os: 100, ol: 100, ps: 100, pl: 30 } } } }), collectedAt), /shares total 30.00 percent/);
});

test("OANDA collector archives raw responses and never places its token in the result", async () => {
  const archivePath = await mkdtemp(join(tmpdir(), "oanda-flow-"));
  const urls = [];
  const result = await collectOandaFlow({
    instrument: "EUR_USD", token: "secret-token", now: new Date("2026-08-02T00:00:00.000Z"), rawArchivePath: archivePath,
    fetch: async (url) => {
      urls.push(url);
      const body = url.includes("orderbook_data") ? orderBook : ratios;
      return new Response(body, { status: 200, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } });
    },
  });
  assert.equal(result.orderBook.snapshots.length, 1);
  assert.equal(result.positionRatios.snapshots.length, 2);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
  assert.equal(urls.every((url) => !url.includes("secret-token")), true);
  const raw = await readFile(join(archivePath, `${result.orderBook.rawSha256.slice(7)}.raw`), "utf8");
  assert.equal(raw, orderBook);
});

test("OANDA raw archive rejects a pre-existing path with mismatched content", async () => {
  const archivePath = await mkdtemp(join(tmpdir(), "oanda-flow-"));
  const hash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await writeFile(join(archivePath, `${hash.slice(7)}.raw`), "different", { mode: 0o600 });
  await assert.rejects(() => new OandaFlowRawArchive(archivePath).store(hash, "expected"), /hash does not match payload/);
});

test("OANDA flow CLI makes external fetch confirmation and readiness explicit", () => {
  assert.throws(() => parseOandaFlowCollectionCliArguments(["--instrument", "EUR_USD"]), /requires --instrument and --confirm-external-fetch/);
  assert.deepEqual(parseOandaFlowCollectionCliArguments(["--readiness"]), { instrument: null, outputPath: null, confirmExternalFetch: false, readiness: true });
  assert.equal(oandaFlowTokenConfigured({ OANDA_FX_PRACTICE_TOKEN: "configured" }), true);
  assert.equal(oandaFlowTokenConfigured({}), false);
});

test("collectedAt is a fetch time and says so by moving when the same bytes are collected again", async () => {
  // The endpoints return history. Naming this a first-seen time would promise the append-only,
  // monotonic guarantee firstSeenStore gives, which this collector does not use.
  const orderBook = JSON.stringify({ "1754006400": { rate: 1.1, price_points: {
    "1.0999": { os: 45, ol: 55, ps: 40, pl: 60 }, "1.1001": { os: 55, ol: 45, ps: 60, pl: 40 } } } });
  const ratios = JSON.stringify({ data: { EUR_USD: { data: [[1754006400, 55, 1.1]] } } });
  const fetcher = async (url) => ({ ok: true, status: 200, url, headers: { get: () => null },
    text: async () => (url.includes("orderbook") ? orderBook : ratios) });
  const directory = await mkdtemp(join(tmpdir(), "oanda-flow-"));
  const first = await collectOandaFlow({ instrument: "EUR_USD", token: "t", fetch: fetcher,
    rawArchivePath: directory, now: new Date("2026-08-02T00:00:00.000Z") });
  const second = await collectOandaFlow({ instrument: "EUR_USD", token: "t", fetch: fetcher,
    rawArchivePath: directory, now: new Date("2026-08-05T00:00:00.000Z") });
  assert.equal(first.orderBook.snapshots[0].providerTimestamp, second.orderBook.snapshots[0].providerTimestamp);
  assert.equal(first.orderBook.snapshots[0].collectedAt, "2026-08-02T00:00:00.000Z");
  assert.equal(second.orderBook.snapshots[0].collectedAt, "2026-08-05T00:00:00.000Z");
  // The raw bytes are deduplicated even though the stamp moves, which is what makes the distinction
  // between the two visible rather than a contradiction.
  assert.equal(first.orderBook.rawSha256, second.orderBook.rawSha256);
  assert.equal(first.environment, "practice");
  assert.match(first.limitations.join(" "), /not a first-seen record/);
  assert.match(first.limitations.join(" "), /practice environment/);
});

test("a truncated order book is refused rather than parsed into partial shares", () => {
  // Every value can sit inside nought to a hundred while the body is missing most of its buckets.
  // The shares are what reveal it, and the response size limit is exactly how that would happen.
  const truncated = JSON.stringify({ "1754006400": { rate: 1.1, price_points: {
    "1.0999": { os: 45, ol: 55, ps: 40, pl: 60 } } } });
  assert.throws(() => parseOandaOrderBook(truncated, "2026-08-02T00:00:00.000Z"),
    /shares total 45.00 percent across price points, so the body is incomplete/);
  const complete = JSON.stringify({ "1754006400": { rate: 1.1, price_points: {
    "1.0999": { os: 45, ol: 55, ps: 40, pl: 60 }, "1.1001": { os: 55, ol: 45, ps: 60, pl: 40 } } } });
  assert.doesNotThrow(() => parseOandaOrderBook(complete, "2026-08-02T00:00:00.000Z"));
});
