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
    scanner: {
      getQuotes: async (symbols, columns) => ({
        totalCount: symbols.length,
        returned: symbols.length,
        rows: symbols.map((s) => ({ symbol: s, values: { close: 1, columns } })),
      }),
      scanMarket: async (options) => ({
        totalCount: 1,
        returned: 1,
        rows: [{ symbol: "TSE:9501", values: { options } }],
      }),
      getMtfOverview: async (symbol, timeframes, fields) => ({
        symbol,
        timeframes: Object.fromEntries(
          (timeframes ?? ["15", "60", "240", "1D"]).map((tf) => [tf, { fields: fields ?? null }]),
        ),
      }),
      ...overrides.scanner,
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
      getIndicatorValues: async (options) => [
        {
          id: "st1",
          name: "Test Study",
          options,
          plots: [{ id: "plot_0", title: "Signal", type: "line" }],
          bars: [{ time: 1, values: { Signal: 42 } }],
        },
      ],
      getIndicatorInputs: async (options) => [
        {
          id: "st1",
          name: "Test Study",
          title: "Test Study (5)",
          options,
          inputs: [
            { id: "in_0", name: "Length", type: "integer", value: 5, defval: 14, tooltip: null },
          ],
        },
      ],
      getIndicatorGraphics: async (options) => [
        {
          id: "st1",
          name: "Test Study",
          options,
          totals: { labels: 1, lines: 0, boxes: 0 },
          labels: [{ time: 1, price: 1.5, text: "(3)", size: "normal" }],
          lines: [],
          boxes: [],
        },
      ],
      loadMoreHistory: async (options) => ({
        requested: options.count,
        barsBefore: 300,
        barsAfter: 300 + options.count,
        added: options.count,
        earliestTime: 1,
        moreAvailable: true,
      }),
      listAlerts: async () => [
        {
          id: 1,
          name: null,
          symbol: "OANDA:USDJPY",
          resolution: null,
          condition: null,
          message: null,
          active: false,
          type: "price",
          createTime: null,
          lastFireTime: null,
          expiration: null,
          lastError: null,
        },
      ],
      getChartRect: async (chartIndex) => ({
        x: 50 + chartIndex * 500,
        y: 40,
        width: 500,
        height: 700,
        devicePixelRatio: 2,
      }),
      getWatchlists: async () => [
        {
          id: 1,
          name: "Watchlist",
          type: "custom",
          symbolCount: 2,
          sections: [{ name: "Crypto", symbols: ["BITSTAMP:BTCUSD", "OANDA:EURUSD"] }],
        },
      ],
      getKeyLevels: async (options) => ({
        symbol: "EURUSD",
        resolution: "1D",
        price: 1.1,
        rangePercent: options.rangePercent,
        count: 1,
        options,
        levels: [
          {
            price: 1.105,
            distancePercent: 0.45,
            kind: "line",
            study: "SMC",
            detail: "horizontal line",
            time: 1,
          },
        ],
      }),
      setSymbol: async (symbol) => ({ symbol, resolution: "1D" }),
      setResolution: async (resolution) => ({ symbol: "EURUSD", resolution }),
      ...overrides.tv,
    },
    calendar: {
      getEvents: async (options) => ({
        from: "2026-07-08T00:00:00.000Z",
        to: "2026-07-15T00:00:00.000Z",
        countries: options.countries ?? ["US", "EU", "JP", "GB"],
        minImportance: options.minImportance ?? "medium",
        totalInRange: 1,
        returned: 1,
        options,
        events: [
          {
            id: "1",
            date: "2026-07-08T18:00:00.000Z",
            country: "US",
            currency: "USD",
            title: "FOMC Minutes",
            indicator: null,
            importance: "high",
            period: null,
            actual: null,
            forecast: null,
            previous: null,
            unit: null,
          },
        ],
      }),
      ...overrides.calendar,
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

test("exposes exactly the sixteen expected tools", async () => {
  const client = await connectedClient(makeDeps());
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "get_chart_context",
      "get_chart_screenshot",
      "get_economic_events",
      "get_indicator_graphics",
      "get_indicator_inputs",
      "get_indicator_values",
      "get_key_levels",
      "get_mtf_overview",
      "get_ohlcv",
      "get_quotes",
      "get_watchlist",
      "list_alerts",
      "load_more_history",
      "scan_market",
      "set_symbol",
      "set_timeframe",
    ],
  );
});

test("get_mtf_overview forwards symbol, timeframes and fields", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "get_mtf_overview",
    arguments: { symbol: "OANDA:EURUSD", timeframes: ["60", "1D"], fields: ["RSI"] },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.symbol, "OANDA:EURUSD");
  assert.deepEqual(Object.keys(parsed.timeframes), ["60", "1D"]);
  assert.deepEqual(parsed.timeframes["60"].fields, ["RSI"]);
});

test("get_key_levels forwards options with defaults applied", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_key_levels", arguments: {} });
  const parsed = JSON.parse(res.content[0].text);
  // undefined chartIndex is dropped by the JSON round-trip
  assert.deepEqual(parsed.options, { rangePercent: 3, limit: 30, includeAllPlots: false });
  assert.equal(parsed.levels[0].study, "SMC");

  const res2 = await client.callTool({
    name: "get_key_levels",
    arguments: { range_percent: 1.5, limit: 10, chart_index: 1, include_all_plots: true },
  });
  assert.deepEqual(JSON.parse(res2.content[0].text).options, {
    rangePercent: 1.5,
    limit: 10,
    chartIndex: 1,
    includeAllPlots: true,
  });
});

test("get_economic_events forwards filters under calendar names", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_economic_events", arguments: {} });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.events[0].title, "FOMC Minutes");

  const res2 = await client.callTool({
    name: "get_economic_events",
    arguments: {
      countries: ["US", "JP"],
      from: "2026-07-08T00:00:00Z",
      to: "2026-07-10T00:00:00Z",
      min_importance: "high",
      limit: 5,
    },
  });
  assert.deepEqual(JSON.parse(res2.content[0].text).options, {
    countries: ["US", "JP"],
    from: "2026-07-08T00:00:00Z",
    to: "2026-07-10T00:00:00Z",
    minImportance: "high",
    limit: 5,
  });
});

test("get_indicator_graphics forwards options with defaults applied", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "get_indicator_graphics",
    arguments: { study_id: "st1" },
  });
  const [study] = JSON.parse(res.content[0].text);
  assert.deepEqual(study.options, { studyId: "st1", limitPerKind: 50 });
  assert.equal(study.labels[0].text, "(3)");
});

test("load_more_history forwards count with default", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "load_more_history", arguments: {} });
  assert.equal(JSON.parse(res.content[0].text).requested, 300);
  const res2 = await client.callTool({ name: "load_more_history", arguments: { count: 42 } });
  assert.equal(JSON.parse(res2.content[0].text).added, 42);
});

test("list_alerts returns the user's alerts", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "list_alerts", arguments: {} });
  const [alert] = JSON.parse(res.content[0].text);
  assert.equal(alert.symbol, "OANDA:USDJPY");
  assert.equal(alert.active, false);
});

test("get_watchlist returns the user's lists", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_watchlist", arguments: {} });
  const [list] = JSON.parse(res.content[0].text);
  assert.equal(list.name, "Watchlist");
  assert.equal(list.sections[0].name, "Crypto");
});

test("get_quotes forwards symbols and columns", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "get_quotes",
    arguments: { symbols: ["OANDA:EURUSD"], columns: ["close", "RSI"] },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.rows[0].symbol, "OANDA:EURUSD");
  assert.deepEqual(parsed.rows[0].values.columns, ["close", "RSI"]);
});

test("scan_market forwards options under scanner names", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "scan_market",
    arguments: {
      market: "japan",
      filters: [{ field: "RSI", operation: "less", value: 30 }],
      sort_by: "volume",
      limit: 5,
    },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.deepEqual(parsed.rows[0].values.options, {
    market: "japan",
    filters: [{ field: "RSI", operation: "less", value: 30 }],
    sortBy: "volume",
    limit: 5,
  });
});

test("get_indicator_values forwards options with defaults applied", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "get_indicator_values",
    arguments: { study_id: "st1", chart_index: 1 },
  });
  const [study] = JSON.parse(res.content[0].text);
  assert.deepEqual(study.options, {
    studyId: "st1",
    count: 10,
    chartIndex: 1,
    includeAllPlots: false,
  });
  assert.equal(study.bars[0].values.Signal, 42);
});

test("get_indicator_inputs returns named parameters", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_indicator_inputs", arguments: {} });
  const [study] = JSON.parse(res.content[0].text);
  assert.equal(study.inputs[0].name, "Length");
  assert.equal(study.inputs[0].value, 5);
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

test("get_chart_screenshot with chart_index clips to the chart rect at device scale", async () => {
  let capturedClip;
  const client = await connectedClient(
    makeDeps({
      cdp: {
        screenshot: async (fmt, quality, clip) => ((capturedClip = clip), "aW1n"),
      },
    }),
  );
  const whole = await client.callTool({ name: "get_chart_screenshot", arguments: {} });
  assert.equal(capturedClip, undefined, "no clip without chart_index");
  assert.equal(whole.content[0].type, "image");

  await client.callTool({ name: "get_chart_screenshot", arguments: { chart_index: 1 } });
  assert.deepEqual(capturedClip, { x: 550, y: 40, width: 500, height: 700, scale: 2 });
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
      getIndicatorValues: async () => ((handlerRan = true), []),
      getIndicatorInputs: async () => ((handlerRan = true), []),
      getIndicatorGraphics: async () => ((handlerRan = true), []),
      loadMoreHistory: async () => ((handlerRan = true), {}),
      listAlerts: async () => ((handlerRan = true), []),
      getWatchlists: async () => ((handlerRan = true), []),
      setSymbol: async () => ((handlerRan = true), {}),
      setResolution: async () => ((handlerRan = true), {}),
      getKeyLevels: async () => ((handlerRan = true), {}),
    },
    cdp: { screenshot: async () => ((handlerRan = true), "x") },
    scanner: {
      getQuotes: async () => ((handlerRan = true), {}),
      scanMarket: async () => ((handlerRan = true), {}),
    },
    calendar: {
      getEvents: async () => ((handlerRan = true), {}),
    },
  });
  const client = await connectedClient(spyingDeps);
  for (const args of [
    { name: "get_ohlcv", arguments: { count: 0 } },
    { name: "get_ohlcv", arguments: { count: 99999 } },
    { name: "get_ohlcv", arguments: { count: "50; rm -rf" } },
    { name: "set_symbol", arguments: {} },
    { name: "set_timeframe", arguments: { resolution: 42 } },
    { name: "get_chart_screenshot", arguments: { format: "gif" } },
    { name: "get_indicator_values", arguments: { study_id: '"); hack(); ("' } },
    { name: "get_indicator_values", arguments: { count: 501 } },
    { name: "get_indicator_inputs", arguments: { study_id: "has space" } },
    { name: "get_quotes", arguments: { symbols: [] } },
    { name: "get_quotes", arguments: { symbols: ["bad ticker!"] } },
    { name: "scan_market", arguments: { market: "JAPAN/../x" } },
    { name: "scan_market", arguments: { market: "japan", filters: [{ field: "RSI", operation: "drop" }] } },
    { name: "scan_market", arguments: { market: "japan", limit: 101 } },
    { name: "get_mtf_overview", arguments: { symbol: "OANDA:EURUSD", timeframes: ["7"] } },
    { name: "get_mtf_overview", arguments: {} },
    { name: "get_indicator_graphics", arguments: { study_id: "has space" } },
    { name: "get_indicator_graphics", arguments: { limit_per_kind: 501 } },
    { name: "load_more_history", arguments: { count: 5001 } },
    { name: "load_more_history", arguments: { count: "many" } },
    { name: "get_key_levels", arguments: { range_percent: 0 } },
    { name: "get_key_levels", arguments: { range_percent: 51 } },
    { name: "get_key_levels", arguments: { limit: 0 } },
    { name: "get_economic_events", arguments: { countries: ["USA"] } },
    { name: "get_economic_events", arguments: { countries: [] } },
    { name: "get_economic_events", arguments: { min_importance: "extreme" } },
    { name: "get_economic_events", arguments: { limit: 201 } },
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
