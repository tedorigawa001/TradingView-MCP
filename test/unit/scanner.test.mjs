import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Scanner, DEFAULT_QUOTE_COLUMNS } from "../../build/scanner.js";

/** Fake scanner.tradingview.com: records requests, returns a canned response. */
async function startMockScanner(handler) {
  const state = { requests: [] };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = { url: req.url, body: JSON.parse(body) };
    state.requests.push(parsed);
    const out = handler
      ? handler(parsed, res)
      : {
          totalCount: 1,
          data: [{ s: "OANDA:EURUSD", d: parsed.body.columns.map((_, i) => i) }],
        };
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

test("getQuotes posts tickers and maps columns onto row values", async (t) => {
  const mock = await startMockScanner();
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  const result = await scanner.getQuotes(["OANDA:EURUSD"], ["close", "RSI"]);
  const req = mock.state.requests[0];
  assert.equal(req.url, "/global/scan");
  assert.deepEqual(req.body.symbols, { tickers: ["OANDA:EURUSD"] });
  assert.deepEqual(req.body.columns, ["close", "RSI"]);
  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.rows[0], { symbol: "OANDA:EURUSD", values: { close: 0, RSI: 1 } });
});

test("getQuotes uses the default column set when none given", async (t) => {
  const mock = await startMockScanner();
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);
  await scanner.getQuotes(["NASDAQ:AAPL"]);
  assert.deepEqual(mock.state.requests[0].body.columns, DEFAULT_QUOTE_COLUMNS);
  assert.ok(DEFAULT_QUOTE_COLUMNS.includes("Recommend.All"), "technical rating included by default");
});

test("getQuotes validates tickers and columns before any request", async (t) => {
  const mock = await startMockScanner();
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  await assert.rejects(() => scanner.getQuotes([]), /non-empty/);
  await assert.rejects(() => scanner.getQuotes(["has space"]), /invalid ticker/);
  await assert.rejects(() => scanner.getQuotes(['EVIL:"}]'],), /invalid ticker/);
  await assert.rejects(() => scanner.getQuotes(Array(101).fill("A:B")), /at most 100/);
  await assert.rejects(() => scanner.getQuotes(["A:B"], ["bad column!"]), /invalid column/);
  assert.equal(mock.state.requests.length, 0, "nothing should reach the network");
});

test("scanMarket builds filter/sort/range and validates inputs", async (t) => {
  const mock = await startMockScanner();
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  await scanner.scanMarket({
    market: "japan",
    filters: [{ field: "RSI", operation: "less", value: 30 }],
    columns: ["name", "close"],
    sortBy: "volume",
    sortOrder: "asc",
    limit: 5,
  });
  const req = mock.state.requests[0];
  assert.equal(req.url, "/japan/scan");
  assert.deepEqual(req.body.filter, [{ left: "RSI", operation: "less", right: 30 }]);
  assert.deepEqual(req.body.sort, { sortBy: "volume", sortOrder: "asc" });
  assert.deepEqual(req.body.range, [0, 5]);

  await assert.rejects(
    () => scanner.scanMarket({ market: "japan/../evil" }),
    /invalid market/,
  );
  await assert.rejects(
    () => scanner.scanMarket({ market: "japan", filters: [{ field: "RSI", operation: "drop table", value: 1 }] }),
    /invalid operation/,
  );
  await assert.rejects(
    () => scanner.scanMarket({ market: "japan", filters: [{ field: "RSI", operation: "in_range", value: [1, 2, 3] }] }),
    /at most 2/,
  );
  await assert.rejects(
    () => scanner.scanMarket({ market: "japan", limit: 0 }),
    /limit must be/,
  );
  await assert.rejects(
    () => scanner.scanMarket({ market: "japan", sortBy: "vol;ume" }),
    /invalid sortBy/,
  );
});

test("HTTP errors and malformed responses are surfaced clearly", async (t) => {
  const mock = await startMockScanner((req, res) => {
    if (req.body.columns.includes("boom")) {
      res.statusCode = 500;
      res.end("internal error");
      return undefined;
    }
    return { data: "not an array" };
  });
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  await assert.rejects(() => scanner.getQuotes(["A:B"], ["boom"]), /HTTP 500/);
  await assert.rejects(() => scanner.getQuotes(["A:B"], ["close"]), /unexpected scanner response shape/);
});

test("requests time out instead of hanging", async (t) => {
  const server = http.createServer(() => {
    /* never respond */
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  const scanner = new Scanner(`http://127.0.0.1:${server.address().port}`, 150);

  await assert.rejects(() => scanner.getQuotes(["A:B"]), /scanner request failed/);
});
