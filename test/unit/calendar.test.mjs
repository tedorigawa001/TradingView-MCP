import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EconomicCalendar, DEFAULT_COUNTRIES } from "../../build/calendar.js";

const EVENTS = [
  {
    id: 3,
    title: "CPI YoY",
    country: "US",
    indicator: "Inflation Rate",
    comment: "A very long explanation that must never be forwarded to the client.",
    period: "Jun",
    actual: null,
    previous: 2.4,
    forecast: 2.5,
    currency: "USD",
    unit: "%",
    importance: 1,
    date: "2026-07-10T12:30:00.000Z",
  },
  {
    id: "2",
    title: "6-Month Bill Auction",
    country: "JP",
    previous: 0.98,
    currency: "JPY",
    importance: -1,
    date: "2026-07-09T03:35:00.000Z",
  },
  {
    id: 1,
    title: "Balance of Trade",
    country: "JP",
    forecast: 14.8,
    previous: 14.5,
    currency: "JPY",
    importance: 0,
    date: "2026-07-08T06:00:00.000Z",
  },
  // malformed rows must be skipped, not crash
  { id: 99, country: "US", importance: 1 },
];

/** Fake economic-calendar.tradingview.com: records requests, returns canned events. */
async function startMockCalendar(handler) {
  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    state.requests.push({ url: req.url, headers: req.headers });
    const out = handler ? handler(req, res) : { status: "ok", result: EVENTS };
    if (out !== undefined) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise((r) => server.close(r)),
  };
}

test("getEvents builds the query, sends the tradingview Origin and maps fields", async (t) => {
  const mock = await startMockCalendar();
  t.after(() => mock.close());
  const cal = new EconomicCalendar(mock.baseUrl);

  const r = await cal.getEvents({
    countries: ["us", "jp"],
    from: "2026-07-08T00:00:00Z",
    to: "2026-07-11T00:00:00Z",
    minImportance: "low",
  });
  const req = mock.state.requests[0];
  const url = new URL(req.url, "http://x");
  assert.equal(url.pathname, "/events");
  assert.equal(url.searchParams.get("countries"), "US,JP", "codes are uppercased");
  assert.equal(url.searchParams.get("from"), "2026-07-08T00:00:00.000Z");
  assert.equal(url.searchParams.get("to"), "2026-07-11T00:00:00.000Z");
  assert.equal(req.headers.origin, "https://www.tradingview.com");

  assert.equal(r.totalInRange, 3, "malformed rows are skipped");
  assert.equal(r.returned, 3);
  const cpi = r.events.find((e) => e.title === "CPI YoY");
  assert.deepEqual(cpi, {
    id: "3",
    date: "2026-07-10T12:30:00.000Z",
    country: "US",
    currency: "USD",
    title: "CPI YoY",
    indicator: "Inflation Rate",
    importance: "high",
    period: "Jun",
    actual: null,
    forecast: 2.5,
    previous: 2.4,
    unit: "%",
  });
  assert.ok(!JSON.stringify(r).includes("never be forwarded"), "comment field is dropped");
});

test("getEvents filters by importance (default: medium+) and sorts by date", async (t) => {
  const mock = await startMockCalendar();
  t.after(() => mock.close());
  const cal = new EconomicCalendar(mock.baseUrl);

  const defaults = await cal.getEvents({ from: "2026-07-08T00:00:00Z" });
  assert.equal(defaults.minImportance, "medium");
  assert.deepEqual(
    defaults.events.map((e) => e.title),
    ["Balance of Trade", "CPI YoY"],
    "low importance dropped, earliest first",
  );
  assert.equal(defaults.totalInRange, 3);

  const high = await cal.getEvents({ from: "2026-07-08T00:00:00Z", minImportance: "high" });
  assert.deepEqual(high.events.map((e) => e.title), ["CPI YoY"]);

  const low = await cal.getEvents({ from: "2026-07-08T00:00:00Z", minImportance: "low" });
  assert.equal(low.events.length, 3);

  const limited = await cal.getEvents({
    from: "2026-07-08T00:00:00Z",
    minImportance: "low",
    limit: 1,
  });
  assert.deepEqual(limited.events.map((e) => e.title), ["Balance of Trade"]);
  assert.equal(limited.returned, 1);
});

test("getEvents defaults: major countries, now .. now+7d", async (t) => {
  const mock = await startMockCalendar();
  t.after(() => mock.close());
  const cal = new EconomicCalendar(mock.baseUrl);

  const before = Date.now();
  const r = await cal.getEvents();
  const after = Date.now();
  assert.deepEqual(r.countries, DEFAULT_COUNTRIES);
  const from = Date.parse(r.from);
  const to = Date.parse(r.to);
  assert.ok(from >= before && from <= after, "from defaults to now");
  assert.equal(to - from, 7 * 86_400_000, "to defaults to from + 7 days");
});

test("getEvents validates inputs before any request", async (t) => {
  const mock = await startMockCalendar();
  t.after(() => mock.close());
  const cal = new EconomicCalendar(mock.baseUrl);

  await assert.rejects(() => cal.getEvents({ countries: [] }), /non-empty/);
  await assert.rejects(() => cal.getEvents({ countries: ["USA"] }), /invalid country code/);
  await assert.rejects(() => cal.getEvents({ countries: ['U"'] }), /invalid country code/);
  await assert.rejects(() => cal.getEvents({ countries: Array(31).fill("US") }), /at most 30/);
  await assert.rejects(() => cal.getEvents({ minImportance: "extreme" }), /invalid minImportance/);
  await assert.rejects(() => cal.getEvents({ limit: 0 }), /limit must be/);
  await assert.rejects(() => cal.getEvents({ limit: 201 }), /limit must be/);
  await assert.rejects(() => cal.getEvents({ from: "not a date" }), /from must be an ISO 8601/);
  await assert.rejects(() => cal.getEvents({ to: "someday" }), /to must be an ISO 8601/);
  await assert.rejects(
    () => cal.getEvents({ from: "2026-07-08T00:00:00Z", to: "2026-07-08T00:00:00Z" }),
    /to must be after from/,
  );
  await assert.rejects(
    () => cal.getEvents({ from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" }),
    /92 days or less/,
  );
  assert.equal(mock.state.requests.length, 0, "nothing should reach the network");
});

test("HTTP errors and malformed responses are surfaced clearly", async (t) => {
  let mode = "http500";
  const mock = await startMockCalendar((req, res) => {
    if (mode === "http500") {
      res.statusCode = 500;
      res.end("internal error");
      return undefined;
    }
    return { result: "not an array" };
  });
  t.after(() => mock.close());
  const cal = new EconomicCalendar(mock.baseUrl);

  await assert.rejects(() => cal.getEvents(), /HTTP 500/);
  mode = "malformed";
  await assert.rejects(() => cal.getEvents(), /unexpected calendar response shape/);
});

test("requests time out instead of hanging", async (t) => {
  const server = http.createServer(() => {
    /* never respond */
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  const cal = new EconomicCalendar(`http://127.0.0.1:${server.address().port}`, 150);

  await assert.rejects(() => cal.getEvents(), /calendar request failed/);
});
