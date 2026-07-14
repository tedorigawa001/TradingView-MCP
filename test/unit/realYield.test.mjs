import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTreasuryRealYieldXml, TreasuryRealYieldClient } from "../../build/realYield.js";
import { RealYieldFirstSeenStore } from "../../build/realYieldHistory.js";

const entry = (date, value) => `
  <entry>
    <updated>2099-01-01T00:00:00Z</updated>
    <content type="application/xml"><m:properties>
      <d:NEW_DATE m:type="Edm.DateTime">${date}</d:NEW_DATE>
      ${value === null ? '<d:TC_10YEAR m:null="true" />' : `<d:TC_10YEAR m:type="Edm.Double">${value}</d:TC_10YEAR>`}
      <d:UNKNOWN_FIELD>ignored</d:UNKNOWN_FIELD>
    </m:properties></content>
  </entry>`;

const feed = (entries, updated = "2026-07-14T20:00:00Z") => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
      xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <updated>${updated}</updated>
  ${entries.join("\n")}
</feed>`;

async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    handler(req, res, requests.length);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("parseTreasuryRealYieldXml handles namespaces, nulls and row ordering", () => {
  const parsed = parseTreasuryRealYieldXml(feed([
    entry("2026-07-10T00:00:00", "1.98"),
    entry("2026-07-13T00:00:00", "2.01"),
    entry("2026-07-11T00:00:00", null),
    entry("not-a-date", "3.00"),
  ]));
  assert.deepEqual(parsed.observations, [
    { observationDate: "2026-07-13", value: 2.01, valueStatus: "valid" },
    { observationDate: "2026-07-11", value: null, valueStatus: "missing" },
    { observationDate: "2026-07-10", value: 1.98, valueStatus: "valid" },
  ]);
  assert.equal(parsed.sourceUpdatedAtRaw, "2026-07-14T20:00:00Z");
});

test("parseTreasuryRealYieldXml distinguishes missing, invalid and exponent values", () => {
  const parsed = parseTreasuryRealYieldXml(feed([
    entry("2026-07-14", ""),
    entry("2026-07-13", "   "),
    entry("2026-07-12", "2.1abc"),
    entry("2026-07-11", "2.1E+0"),
  ]));
  assert.deepEqual(parsed.observations, [
    { observationDate: "2026-07-14", value: null, valueStatus: "missing" },
    { observationDate: "2026-07-13", value: null, valueStatus: "missing" },
    { observationDate: "2026-07-12", value: null, valueStatus: "invalid" },
    { observationDate: "2026-07-11", value: 2.1, valueStatus: "valid" },
  ]);
});

test("parseTreasuryRealYieldXml rejects malformed dates and out-of-range yields", () => {
  const parsed = parseTreasuryRealYieldXml(feed([
    entry("2026-07-14junk", "2.0"),
    entry("2026-07-13T99:99:99", "2.0"),
    entry("2026-07-12T23:59:59Z", "1e308"),
    entry("2026-07-11", "-25"),
    entry("2026-07-10", "25"),
  ]));
  assert.deepEqual(parsed.observations, [
    { observationDate: "2026-07-12", value: null, valueStatus: "out_of_range" },
    { observationDate: "2026-07-11", value: -25, valueStatus: "valid" },
    { observationDate: "2026-07-10", value: 25, valueStatus: "valid" },
  ]);
});

test("parseTreasuryRealYieldXml rejects duplicate calendar dates and malformed feeds", () => {
  assert.throws(
    () => parseTreasuryRealYieldXml(feed([
      entry("2026-07-13", "2.01"),
      entry("2026-07-13T00:00:00", "2.02"),
    ])),
    /duplicate Treasury real-yield observation date/,
  );
  assert.throws(() => parseTreasuryRealYieldXml("<html>error</html>"), /feed is missing/);
});

test("TreasuryRealYieldClient maps metadata, freshness and cache status", async (t) => {
  const mock = await startServer((_req, res) => {
    res.setHeader("content-type", "application/xml");
    res.end(feed([entry("2026-07-13T00:00:00", "2.01")]));
  });
  t.after(() => mock.close());
  const client = new TreasuryRealYieldClient(mock.baseUrl);
  const first = await client.getLatest(new Date("2026-07-14T12:00:00Z"));
  assert.equal(first.status, "partial");
  assert.equal(first.series, "US_TREASURY_PAR_REAL_CMT_10Y");
  assert.equal(first.observation_date, "2026-07-13");
  assert.equal(first.value, 2.01);
  assert.equal(first.value_status, "valid");
  assert.equal(first.freshness_weekdays, 1);
  assert.equal(first.freshness_status, "fresh");
  assert.equal(first.available_at, null);
  assert.equal(first.point_in_time_status, "blocked");
  assert.equal(first.cache_status, "miss");
  const cached = await client.getLatest(new Date("2026-07-17T12:01:00Z"));
  assert.equal(cached.cache_status, "hit");
  assert.equal(cached.observed_at, first.observed_at);
  assert.equal(cached.freshness_weekdays, 4);
  assert.equal(cached.freshness_status, "stale");
  assert.ok(cached.quality_issues.includes("stale_observation"));
  assert.equal(mock.requests.length, 1);
  const url = new URL(mock.requests[0], "http://localhost");
  assert.equal(url.searchParams.get("data"), "daily_treasury_real_yield_curve");
  assert.equal(url.searchParams.get("field_tdr_date_value"), "2026");
});

test("TreasuryRealYieldClient fails closed when the latest dated value is missing", async (t) => {
  const mock = await startServer((_req, res) => {
    res.end(feed([
      entry("2026-07-14", null),
      entry("2026-07-13", "2.01"),
    ]));
  });
  t.after(() => mock.close());
  const result = await new TreasuryRealYieldClient(mock.baseUrl).getLatest(new Date("2026-07-14T12:00:00Z"));
  assert.equal(result.status, "unavailable");
  assert.equal(result.observation_date, "2026-07-14");
  assert.equal(result.value, null);
  assert.equal(result.value_status, "missing");
  assert.ok(result.quality_issues.includes("latest_value_missing"));
});

test("TreasuryRealYieldClient loads the previous year when the current year is empty", async (t) => {
  const mock = await startServer((req, res) => {
    const year = new URL(req.url, "http://localhost").searchParams.get("field_tdr_date_value");
    res.end(year === "2026" ? feed([]) : feed([entry("2025-12-31", "1.75")]));
  });
  t.after(() => mock.close());
  const result = await new TreasuryRealYieldClient(mock.baseUrl).getLatest(new Date("2026-01-02T12:00:00Z"));
  assert.equal(result.observation_date, "2025-12-31");
  assert.deepEqual(mock.requests.map((request) => new URL(request, "http://localhost").searchParams.get("field_tdr_date_value")), ["2026", "2025"]);
});

test("TreasuryRealYieldClient scans the previous year for late revisions during January", async (t) => {
  const mock = await startServer((req, res) => {
    const year = new URL(req.url, "http://localhost").searchParams.get("field_tdr_date_value");
    res.end(year === "2026"
      ? feed([entry("2026-01-14", "1.90")])
      : feed([entry("2025-12-31", "1.75")]));
  });
  t.after(() => mock.close());
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-january-"));
  const path = join(dir, "history.jsonl");
  const client = new TreasuryRealYieldClient(
    mock.baseUrl,
    15_000,
    new RealYieldFirstSeenStore(path),
    () => new Date("2026-01-15T01:00:00.000Z"),
  );
  const result = await client.getLatest(new Date("2026-01-15T12:00:00.000Z"));
  assert.equal(result.observation_date, "2026-01-14");
  assert.deepEqual(
    mock.requests.map((request) => new URL(request, "http://localhost").searchParams.get("field_tdr_date_value")),
    ["2026", "2025"],
  );
  const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.observed_feed_year), [2026, 2025]);
});

test("TreasuryRealYieldClient reports stale and future observations without filling gaps", async (t) => {
  const staleMock = await startServer((_req, res) => res.end(feed([entry("2026-07-08", "1.90")])));
  t.after(() => staleMock.close());
  const stale = await new TreasuryRealYieldClient(staleMock.baseUrl).getLatest(new Date("2026-07-14T12:00:00Z"));
  assert.equal(stale.freshness_weekdays, 4);
  assert.equal(stale.freshness_status, "stale");
  assert.ok(stale.quality_issues.includes("stale_observation"));

  const futureMock = await startServer((_req, res) => res.end(feed([entry("2026-07-15", "2.20")])));
  t.after(() => futureMock.close());
  const futureClient = new TreasuryRealYieldClient(futureMock.baseUrl);
  const future = await futureClient.getLatest(new Date("2026-07-14T12:00:00Z"));
  assert.equal(future.status, "unavailable");
  assert.equal(future.value, null);
  assert.equal(future.value_status, "future_date");
  assert.equal(future.freshness_weekdays, null);
  assert.equal(future.freshness_status, "stale");
  assert.ok(future.quality_issues.includes("future_observation_date"));
  const current = await futureClient.getLatest(new Date("2026-07-15T12:00:00Z"));
  assert.equal(current.status, "partial");
  assert.equal(current.value, 2.2);
  assert.equal(current.value_status, "valid");
  assert.equal(futureMock.requests.length, 2, "future-date results must not be cached");
});

test("TreasuryRealYieldClient blocks the latest out-of-range value", async (t) => {
  const mock = await startServer((_req, res) => res.end(feed([entry("2026-07-13", "25.01")])));
  t.after(() => mock.close());
  const result = await new TreasuryRealYieldClient(mock.baseUrl).getLatest(new Date("2026-07-14T12:00:00Z"));
  assert.equal(result.status, "unavailable");
  assert.equal(result.value, null);
  assert.equal(result.value_status, "out_of_range");
  assert.ok(result.quality_issues.includes("latest_value_out_of_range"));
});

test("TreasuryRealYieldClient retries 5xx and rejects oversized responses", async (t) => {
  let calls = 0;
  const retryMock = await startServer((_req, res) => {
    calls += 1;
    if (calls === 1) {
      res.statusCode = 503;
      res.end("temporary");
      return;
    }
    res.end(feed([entry("2026-07-13", "2.01")]));
  });
  t.after(() => retryMock.close());
  await new TreasuryRealYieldClient(retryMock.baseUrl).getLatest(new Date("2026-07-14T12:00:00Z"));
  assert.equal(calls, 2);

  const largeMock = await startServer((_req, res) => {
    res.setHeader("content-length", "2000001");
    res.end("too large");
  });
  t.after(() => largeMock.close());
  await assert.rejects(
    () => new TreasuryRealYieldClient(largeMock.baseUrl).getLatest(new Date("2026-07-14T12:00:00Z")),
    /too large/,
  );

  const chunkedMock = await startServer((_req, res) => {
    res.write("x".repeat(1_100_000));
    res.end("x".repeat(1_100_000));
  });
  t.after(() => chunkedMock.close());
  await assert.rejects(
    () => new TreasuryRealYieldClient(chunkedMock.baseUrl).getLatest(new Date("2026-07-14T12:00:00Z")),
    /too large/,
  );
});

test("TreasuryRealYieldClient retries with a fresh signal after timeout", async (t) => {
  let calls = 0;
  const mock = await startServer((_req, res) => {
    calls += 1;
    if (calls === 1) {
      setTimeout(() => {
        if (!res.destroyed) res.end(feed([entry("2026-07-13", "1.99")]));
      }, 300);
      return;
    }
    res.end(feed([entry("2026-07-13", "2.01")]));
  });
  t.after(() => mock.close());
  const result = await new TreasuryRealYieldClient(mock.baseUrl, 100).getLatest(new Date("2026-07-14T12:00:00Z"));
  assert.equal(calls, 2);
  assert.equal(result.value, 2.01);
});

test("TreasuryRealYieldClient persists all valid feed rows and serves point-in-time history", async (t) => {
  const mock = await startServer((_req, res) => res.end(feed([
    entry("2026-07-13", "2.01"),
    entry("2026-07-10", "1.98"),
    entry("2026-07-09", null),
  ])));
  t.after(() => mock.close());
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-client-"));
  const path = join(dir, "history.jsonl");
  const store = new RealYieldFirstSeenStore(path);
  const clock = () => new Date("2026-07-14T01:00:00.000Z");
  const client = new TreasuryRealYieldClient(mock.baseUrl, 15_000, store, clock);
  const latest = await client.getLatest(new Date("2026-07-14T12:00:00.000Z"));
  assert.equal(latest.available_at, "2026-07-14T01:00:00.000Z");
  assert.equal(latest.available_at_basis, "local_first_seen");
  assert.equal(latest.point_in_time_status, "observed_first_seen");
  assert.equal(latest.revision_status, "first_seen_tracked");
  const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.observation_date), ["2026-07-13", "2026-07-10"]);
  assert.ok(rows.every((row) => row.first_seen_at === "2026-07-14T01:00:00.000Z"));

  const historicalClient = new TreasuryRealYieldClient(mock.baseUrl, 15_000, store, () => new Date("2026-07-20T00:00:00.000Z"));
  const before = await historicalClient.getAsOf(new Date("2026-07-14T00:59:59.000Z"));
  assert.equal(before.status, "unavailable");
  const asOf = await historicalClient.getAsOf(new Date("2026-07-14T01:00:00.000Z"));
  assert.equal(asOf.observation_date, "2026-07-13");
  assert.equal(asOf.value, 2.01);
  assert.equal(asOf.available_at_basis, "local_first_seen");
  assert.equal(asOf.history_sequence, 1);
});

test("TreasuryRealYieldClient preserves live context and blocks history when persistence fails", async (t) => {
  const mock = await startServer((_req, res) => res.end(feed([entry("2026-07-13", "2.01")])));
  t.after(() => mock.close());
  const store = {
    observeMany: async () => { throw new Error("disk unavailable"); },
    getAsOf: async () => null,
  };
  const client = new TreasuryRealYieldClient(
    mock.baseUrl,
    15_000,
    store,
    () => new Date("2026-07-14T01:00:00.000Z"),
  );
  const first = await client.getLatest(new Date("2026-07-14T12:00:00.000Z"));
  assert.equal(first.status, "partial");
  assert.equal(first.value, 2.01);
  assert.equal(first.available_at, null);
  assert.equal(first.available_at_basis, "unavailable");
  assert.equal(first.point_in_time_status, "blocked");
  assert.ok(first.quality_issues.includes("first_seen_persistence_failed"));
  await client.getLatest(new Date("2026-07-14T12:01:00.000Z"));
  assert.equal(mock.requests.length, 2, "persistence failures must not be cached as successful history");
});

test("TreasuryRealYieldClient records older valid rows when the latest value is missing", async (t) => {
  const mock = await startServer((_req, res) => res.end(feed([
    entry("2026-07-14", null),
    entry("2026-07-13", "2.01"),
  ])));
  t.after(() => mock.close());
  const dir = await mkdtemp(join(tmpdir(), "tv-mcp-real-yield-missing-"));
  const path = join(dir, "history.jsonl");
  const store = new RealYieldFirstSeenStore(path);
  const client = new TreasuryRealYieldClient(
    mock.baseUrl,
    15_000,
    store,
    () => new Date("2026-07-14T01:00:00.000Z"),
  );
  const result = await client.getLatest(new Date("2026-07-14T12:00:00.000Z"));
  assert.equal(result.status, "unavailable");
  const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.observation_date), ["2026-07-13"]);
});

test("TreasuryRealYieldClient rejects future point-in-time cutoffs", async () => {
  const store = { observeMany: async () => [], getAsOf: async () => null };
  const client = new TreasuryRealYieldClient(
    "https://example.invalid",
    15_000,
    store,
    () => new Date("2026-07-14T01:00:00.000Z"),
  );
  await assert.rejects(() => client.getAsOf(new Date("2026-07-14T01:00:00.001Z")), /must not be in the future/);
});
