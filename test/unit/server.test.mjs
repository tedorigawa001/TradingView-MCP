import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../build/server.js";

function makeDeps(overrides = {}) {
  return {
    cdp: {
      screenshot: async (fmt) => "ZmFrZQ==", // "fake"
      ...overrides.cdp,
    },
    tv: {
      getChartContext: async () => ({
        layoutName: "test",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "EURUSD", resolution: "1D", studies: [] }],
      }),
      getOhlcv: async (count, chartIndex) => ({
        symbol: "EURUSD",
        resolution: "1D",
        count,
        chartIndex: chartIndex ?? null,
        bars: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
      }),
      setSymbol: async (symbol) => ({ symbol, resolution: "1D" }),
      setResolution: async (resolution) => ({ symbol: "EURUSD", resolution }),
      ...overrides.tv,
    },
  };
}

async function connectedClient(deps) {
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

test("exposes exactly the five expected tools", async () => {
  const client = await connectedClient(makeDeps());
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "get_chart_context",
      "get_chart_screenshot",
      "get_ohlcv",
      "set_symbol",
      "set_timeframe",
    ],
  );
});

test("get_chart_screenshot returns image content, defaulting to jpeg", async () => {
  let captured;
  const client = await connectedClient(
    makeDeps({ cdp: { screenshot: async (fmt) => ((captured = fmt), "aW1n") } }),
  );
  const res = await client.callTool({ name: "get_chart_screenshot", arguments: {} });
  assert.equal(captured, "jpeg");
  assert.equal(res.content[0].type, "image");
  assert.equal(res.content[0].mimeType, "image/jpeg");
  assert.equal(res.content[0].data, "aW1n");
});

test("get_chart_context returns layout JSON", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_chart_context", arguments: {} });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.charts[0].symbol, "EURUSD");
});

test("get_ohlcv defaults count to 100 and forwards chart_index", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_ohlcv", arguments: {} });
  assert.equal(JSON.parse(res.content[0].text).count, 100);

  const res2 = await client.callTool({
    name: "get_ohlcv",
    arguments: { count: 7, chart_index: 1 },
  });
  const parsed = JSON.parse(res2.content[0].text);
  assert.equal(parsed.count, 7);
  assert.equal(parsed.chartIndex, 1);
});

test("input validation rejects out-of-range or wrong-typed arguments before the handler runs", async () => {
  let handlerRan = false;
  const spyingDeps = makeDeps({
    tv: {
      getOhlcv: async () => ((handlerRan = true), {}),
      setSymbol: async () => ((handlerRan = true), {}),
      setResolution: async () => ((handlerRan = true), {}),
    },
    cdp: { screenshot: async () => ((handlerRan = true), "x") },
  });
  const client = await connectedClient(spyingDeps);
  for (const args of [
    { name: "get_ohlcv", arguments: { count: 0 } },
    { name: "get_ohlcv", arguments: { count: 99999 } },
    { name: "get_ohlcv", arguments: { count: "50; rm -rf" } },
    { name: "set_symbol", arguments: {} },
    { name: "set_timeframe", arguments: { resolution: 42 } },
    { name: "get_chart_screenshot", arguments: { format: "gif" } },
  ]) {
    const res = await client.callTool(args);
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.match(res.content[0].text, /validation error/i, JSON.stringify(args));
  }
  assert.equal(handlerRan, false, "invalid input must never reach a tool handler");
});

test("set_symbol and set_timeframe report the resulting state", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "set_symbol",
    arguments: { symbol: "NASDAQ:AAPL" },
  });
  assert.equal(JSON.parse(res.content[0].text).symbol, "NASDAQ:AAPL");

  const res2 = await client.callTool({
    name: "set_timeframe",
    arguments: { resolution: "240" },
  });
  assert.equal(JSON.parse(res2.content[0].text).resolution, "240");
});

test("dependency failures come back as isError results, not crashes", async () => {
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => {
          throw new Error("TradingView desktop app is not reachable via CDP");
        },
      },
    }),
  );
  const res = await client.callTool({ name: "get_chart_context", arguments: {} });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not reachable via CDP/);
});
