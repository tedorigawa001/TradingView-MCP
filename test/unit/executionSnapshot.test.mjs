import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionSnapshot } from "../../build/executionSnapshot.js";

function runtime(start = "2026-07-20T03:00:00.000Z") {
  let now = Date.parse(start);
  return {
    now: () => new Date(now),
    sleep: async (milliseconds) => { now += milliseconds; },
  };
}

function scanner(samples) {
  let index = 0;
  return {
    getQuotes: async (symbols) => {
      const sample = samples[Math.min(index++, samples.length - 1)];
      return {
        totalCount: symbols.length,
        returned: symbols.length,
        rows: symbols.map((symbol) => ({ symbol, values: { ...sample } })),
      };
    },
  };
}

const metadata = {
  update_mode: "streaming",
  pricescale: 100000,
  minmov: 1,
  minmove2: 10,
  fractional: "false",
  type: "forex",
  market: "forex",
  currency: "USD",
  exchange: "OANDA",
  timezone: "America/New_York",
};

test("execution snapshot is ready only after a streaming bid/ask update", async () => {
  const result = await buildExecutionSnapshot(
    { scanner: scanner([
      { ...metadata, bid: 1.1, ask: 1.1002 },
      { ...metadata, bid: 1.1001, ask: 1.1003 },
    ]) },
    { symbols: ["OANDA:EURUSD"], waitForUpdateMs: 600, sampleIntervalMs: 300, maxQuoteAgeMs: 1_000 },
    runtime(),
  );
  assert.equal(result.status, "ready");
  assert.equal(result.quotes[0].status, "ready");
  assert.equal(result.quotes[0].freshness.status, "verified_live_update");
  assert.equal(result.quotes[0].freshness.basis, "post_request_bid_ask_change");
  assert.equal(result.quotes[0].market_state, "active");
  assert.equal(result.quotes[0].spread_pips, 1.9999999999997797);
  assert.equal(result.quotes[0].tick_size, 0.00001);
  assert.equal(result.source_timestamp_available, false);
});

test("execution snapshot prefers fresh active quote state from an open chart", async () => {
  const chartQuote = {
    chartIndex: 2,
    symbol: "OANDA:EURUSD",
    bid: 1.1,
    ask: 1.1002,
    lastPrice: 1.1001,
    lpTime: Date.parse("2026-07-20T03:00:00.000Z") / 1_000,
    updateMode: "streaming",
    currentSession: "market",
    hubRealtimeLoaded: true,
    tradeLoaded: true,
    pricescale: 100000,
    minmov: 1,
    minmove2: 10,
    fractional: false,
    type: "forex",
    currency: "USD",
    exchange: "OANDA",
    timezone: "America/New_York",
    session: "1700-1700",
  };
  const neverScanner = { getQuotes: async () => { throw new Error("scanner must not be used"); } };
  const result = await buildExecutionSnapshot(
    { scanner: neverScanner, tv: { getExecutionQuotes: async () => [chartQuote] } },
    { symbols: ["OANDA:EURUSD"], waitForUpdateMs: 600, sampleIntervalMs: 300, maxQuoteAgeMs: 5_000 },
    runtime(),
  );
  assert.equal(result.status, "ready");
  assert.equal(result.source_timestamp_available, true);
  assert.equal(result.quotes[0].source, "tradingview_chart_quotes");
  assert.equal(result.quotes[0].chart_index, 2);
  assert.equal(result.quotes[0].freshness.status, "verified_source_timestamp");
  assert.equal(result.quotes[0].instrument.session, "1700-1700");
});

test("execution snapshot does not trust stale or inactive open-chart quotes", async () => {
  const result = await buildExecutionSnapshot(
    {
      scanner: { getQuotes: async () => { throw new Error("scanner must not be used"); } },
      tv: {
        getExecutionQuotes: async () => [{
          chartIndex: 0,
          symbol: "OANDA:EURUSD",
          bid: 1.1,
          ask: 1.1002,
          lastPrice: 1.1001,
          lpTime: Date.parse("2026-07-20T02:59:00.000Z") / 1_000,
          updateMode: "streaming",
          currentSession: "closed",
          hubRealtimeLoaded: true,
          tradeLoaded: true,
          pricescale: 100000,
          minmov: 1,
          minmove2: 10,
          fractional: false,
          type: "forex",
          currency: "USD",
          exchange: "OANDA",
          timezone: "America/New_York",
          session: "1700-1700",
        }],
      },
    },
    { symbols: ["OANDA:EURUSD"], waitForUpdateMs: 0, sampleIntervalMs: 300, maxQuoteAgeMs: 5_000 },
    runtime(),
  );
  assert.equal(result.status, "wait");
  assert.equal(result.quotes[0].market_state, "inactive");
  assert.ok(result.quotes[0].issues.some((issue) => issue.code === "quote_timestamp_stale"));
  assert.ok(result.quotes[0].issues.some((issue) => issue.code === "market_session_inactive"));
});

test("execution snapshot waits when a valid streaming quote does not change", async () => {
  const result = await buildExecutionSnapshot(
    { scanner: scanner([{ ...metadata, bid: 1.1, ask: 1.1002 }]) },
    { symbols: ["OANDA:EURUSD"], waitForUpdateMs: 600, sampleIntervalMs: 300, maxQuoteAgeMs: 1_000 },
    runtime(),
  );
  assert.equal(result.status, "wait");
  assert.equal(result.quotes[0].freshness.status, "unverified");
  assert.equal(result.quotes[0].liveness.samples, 3);
  assert.ok(result.quotes[0].issues.some((issue) => issue.code === "live_update_not_observed"));
});

test("execution snapshot rejects delayed data even when prices update", async () => {
  const delayed = { ...metadata, update_mode: "delayed_streaming_900" };
  const result = await buildExecutionSnapshot(
    { scanner: scanner([
      { ...delayed, bid: 333.7, ask: 333.8 },
      { ...delayed, bid: 333.8, ask: 333.9 },
    ]) },
    { symbols: ["NASDAQ:AAPL"], waitForUpdateMs: 300, sampleIntervalMs: 300, maxQuoteAgeMs: 1_000 },
    runtime(),
  );
  assert.equal(result.status, "wait");
  assert.equal(result.quotes[0].data_mode.status, "delayed");
  assert.equal(result.quotes[0].data_mode.delay_seconds, 900);
  assert.equal(result.quotes[0].market_state, "unknown");
});

test("execution snapshot blocks an inverted bid/ask pair", async () => {
  const result = await buildExecutionSnapshot(
    { scanner: scanner([{ ...metadata, bid: 1.2, ask: 1.1 }]) },
    { symbols: ["OANDA:EURUSD"], waitForUpdateMs: 0, sampleIntervalMs: 300, maxQuoteAgeMs: 1_000 },
    runtime(),
  );
  assert.equal(result.status, "blocked");
  assert.equal(result.quotes[0].status, "blocked");
  assert.ok(result.quotes[0].issues.some((issue) => issue.code === "bid_ask_inverted"));
});

test("execution snapshot keeps a missing symbol unavailable without substituting close", async () => {
  const emptyScanner = {
    getQuotes: async () => ({ totalCount: 0, returned: 0, rows: [] }),
  };
  const result = await buildExecutionSnapshot(
    { scanner: emptyScanner },
    { symbols: ["OANDA:EURUSD"], waitForUpdateMs: 0, sampleIntervalMs: 300, maxQuoteAgeMs: 1_000 },
    runtime(),
  );
  assert.equal(result.status, "wait");
  assert.equal(result.quotes[0].status, "unavailable");
  assert.equal(result.quotes[0].bid, null);
  assert.equal(result.quotes[0].ask, null);
});
