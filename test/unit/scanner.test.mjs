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

test("getMtfOverview builds suffixed columns and regroups by timeframe", async (t) => {
  const mock = await startMockScanner();
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  const [o] = await scanner.getMtfOverview(["OANDA:EURUSD"], ["60", "1D"], ["close", "RSI"]);
  const req = mock.state.requests[0];
  assert.deepEqual(req.body.columns, ["close|60", "RSI|60", "close", "RSI"]);
  assert.deepEqual(req.body.symbols, { tickers: ["OANDA:EURUSD"] });
  // canned response returns column index as value
  assert.deepEqual(o.timeframes, {
    "60": { close: 0, RSI: 1 },
    "1D": { close: 2, RSI: 3 },
  });
});

test("getMtfOverview accepts multiple symbols in one call, sharing the column set", async (t) => {
  const mock = await startMockScanner((req) => ({
    totalCount: req.body.symbols.tickers.length,
    data: req.body.symbols.tickers.map((s, row) => ({
      s,
      d: req.body.columns.map((_, col) => row * 100 + col),
    })),
  }));
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  const tickers = ["OANDA:EURUSD", "OANDA:USDJPY", "OANDA:GBPAUD"];
  const results = await scanner.getMtfOverview(tickers, ["60", "1D"], ["close", "RSI"]);
  const req = mock.state.requests[0];
  assert.deepEqual(req.body.symbols, { tickers }, "one shared request for all symbols");
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => r.symbol),
    tickers,
    "results are returned in request order regardless of API row order",
  );
  assert.deepEqual(results[1].timeframes, { "60": { close: 100, RSI: 101 }, "1D": { close: 102, RSI: 103 } });
});

test("getMtfOverview reorders results to match the requested ticker order", async (t) => {
  const mock = await startMockScanner((req) => ({
    // API returns rows in a different order than requested
    data: [...req.body.symbols.tickers].reverse().map((s) => ({ s, d: [s.length] })),
  }));
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  const tickers = ["OANDA:EURUSD", "OANDA:USDJPY"];
  const results = await scanner.getMtfOverview(tickers, ["1D"], ["close"]);
  assert.deepEqual(results.map((r) => r.symbol), tickers);
});

test("getMtfOverview fails loudly listing tickers the API returned no data for", async (t) => {
  const mock = await startMockScanner((req) => ({
    data: req.body.symbols.tickers
      .filter((s) => s !== "OANDA:BADTICKER")
      .map((s) => ({ s, d: req.body.columns.map(() => 1) })),
  }));
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  await assert.rejects(
    () => scanner.getMtfOverview(["OANDA:EURUSD", "OANDA:BADTICKER"], ["1D"], ["close"]),
    /no data for: OANDA:BADTICKER/,
  );
});

test("getMtfOverview validates inputs before any request", async (t) => {
  const mock = await startMockScanner();
  t.after(() => mock.close());
  const scanner = new Scanner(mock.baseUrl);

  await assert.rejects(() => scanner.getMtfOverview(["bad ticker"]), /invalid ticker/);
  await assert.rejects(() => scanner.getMtfOverview([]), /non-empty array of at most/);
  await assert.rejects(() => scanner.getMtfOverview(Array(21).fill("A:B")), /at most 20 symbols/);
  await assert.rejects(() => scanner.getMtfOverview(["A:B"], ["3"]), /invalid timeframe/);
  await assert.rejects(() => scanner.getMtfOverview(["A:B"], ["60"], ["RSI|240"]), /invalid field/);
  await assert.rejects(() => scanner.getMtfOverview(["A:B"], [], ["RSI"]), /non-empty/);
  await assert.rejects(
    () => scanner.getMtfOverview(["A:B"], ["1", "5", "15", "30", "60", "120", "240", "1D"], Array(7).fill("RSI")),
    /too many columns/,
  );
  assert.equal(mock.state.requests.length, 0);
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
