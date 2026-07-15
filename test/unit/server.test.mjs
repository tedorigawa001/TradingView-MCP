import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../build/server.js";
import {
  ANALYSIS_OVERLAY_INPUTS,
  ANALYSIS_OVERLAY_NAME,
  ANALYSIS_OVERLAY_SOURCE,
} from "../../build/analysisOverlay.js";

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
      getMtfOverview: async (symbols, timeframes, fields) =>
        symbols.map((symbol) => ({
          symbol,
          timeframes: Object.fromEntries(
            (timeframes ?? ["15", "60", "240", "1D"]).map((tf) => [tf, { fields: fields ?? null }]),
          ),
        })),
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
      setIndicatorInput: async (studyId, inputs, options) => ({
        studyId,
        applied: inputs.map((i) => ({ id: i.id, name: "Length", value: i.value })),
        options,
      }),
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
      getIndicatorTables: async (options) => [
        {
          id: "st1",
          name: "Test Study",
          options,
          tables: [
            {
              id: 1,
              position: "bottom_right",
              rows: 2,
              columns: 2,
              cellCount: 4,
              grid: [
                ["TREND", "5M"],
                ["Predict", "UP"],
              ],
            },
          ],
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
      listPineScripts: async () => [
        {
          pineId: "USER;adc40b1dfee344f19412f1ae9af74f3f",
          name: "Test Script",
          kind: "study",
          version: "3.0",
          usedBy: [{ chartIndex: 0, studyId: "st1", name: "Test Study", version: "3.0" }],
        },
      ],
      getPineSource: async (pineId, version) => ({
        pineId,
        version: version ?? "last",
        name: "Test Script",
        kind: "study",
        updated: null,
        sourceLength: 24,
        source: "//@version=5\nplot(close)",
      }),
      savePineScript: async (options) =>
        options.confirm === true
          ? {
              dryRun: false,
              action: options.pineId ? "new_version" : "create_new",
              saved: true,
              pineId: options.pineId ?? "USER;abcdef1234567890",
              name: options.name ?? "Test Script",
              version: "4.0",
              compileOk: true,
              compileErrors: [],
              compileWarnings: [],
              verified: true,
              options,
            }
          : {
              dryRun: true,
              action: options.pineId ? "new_version" : "create_new",
              pineId: options.pineId ?? null,
              name: options.name ?? null,
              currentVersion: options.pineId ? "3.0" : null,
              currentSourceLength: options.pineId ? 100 : null,
              newSourceLength: options.source.length,
              note: "DRY RUN",
              options,
            },
      addPineToChart: async (pineId, chartIndex) => ({
        studyId: "stNew",
        name: "Test Script",
        isStrategy: false,
        version: "3.0",
        chartIndex: chartIndex ?? null,
      }),
      removePineFromChart: async (pineId, studyId, chartIndex) => ({
        removed: true,
        pineId,
        pineVersion: "3.0",
        studyId,
        name: "Test Script",
        chartIndex: chartIndex ?? null,
      }),
      getStrategyReport: async (options) => ({
        strategy: "Test Strategy",
        currency: "USD",
        initialCapital: 1000000,
        dateRange: { from: "2020-01-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
        summary: { netProfit: -1675, percentProfitable: 0.33, profitFactor: 0.9 },
        totalTrades: 21,
        options,
        trades: [
          {
            number: 21,
            direction: "short",
            entry: { time: 1, timeIso: "x", price: 1.14, label: "Short" },
            exit: { time: 2, timeIso: "y", price: 1.15, label: "Short Exit" },
            profit: -1019,
            profitPercent: -0.0102,
            cumulativeProfit: -1675,
            quantity: 87528,
          },
        ],
      }),
      runBacktest: async (options) => ({
        pineId: options.pineId,
        studyId: options.keepOnChart ? "st9" : null,
        keptOnChart: !!options.keepOnChart,
        removedFromChart: !options.keepOnChart,
        strategy: "Test Strategy",
        currency: "USD",
        initialCapital: 1000000,
        dateRange: null,
        summary: { netProfit: -1675 },
        totalTrades: 21,
        options,
        trades: [],
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
    cot: {
      getLatest: async (symbol) => ({
        symbol,
        report_date: "2026-07-07T00:00:00.000Z",
        positions: [],
        positioning_features: { point_in_time_status: "blocked", groups: [] },
      }),
      getHistory: async (symbol, weeks) => ({
        symbol,
        requested_weeks: weeks,
        observations: Array.from({ length: weeks }, (_, index) => ({
          symbol,
          report_date: `2026-07-${String(7 - index).padStart(2, "0")}T00:00:00.000Z`,
          positions: [],
        })),
        positioning_features: { point_in_time_status: "blocked", groups: [] },
        cache_status: "miss",
      }),
      ...overrides.cot,
    },
    realYield: {
      getLatest: async () => ({
        schema_version: "1.1",
        status: "partial",
        series: "US_TREASURY_PAR_REAL_CMT_10Y",
        observation_date: "2026-07-13",
        value: 2.01,
        value_status: "valid",
        unit: "percent_per_annum_bond_equivalent",
        source: "us_treasury",
        source_url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/",
        observed_at: "2026-07-14T01:00:00.000Z",
        source_at: null,
        available_at: null,
        available_at_basis: "unavailable",
        first_seen_at: null,
        source_updated_at_raw: "2026-07-14T00:30:00Z",
        latency_class: "end_of_day",
        revision_status: "unknown",
        freshness_weekdays: 1,
        freshness_status: "fresh",
        point_in_time_status: "blocked",
        as_of: null,
        quality_issues: ["publication_time_unavailable"],
        cache_status: "miss",
        source_error: null,
      }),
      getAsOf: async (asOf) => ({
        schema_version: "1.1",
        status: "partial",
        series: "US_TREASURY_PAR_REAL_CMT_10Y",
        observation_date: "2026-07-10",
        value: 1.98,
        value_status: "valid",
        unit: "percent_per_annum_bond_equivalent",
        source: "us_treasury",
        source_url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/",
        observed_at: "2026-07-11T01:00:00.000Z",
        source_at: null,
        available_at: "2026-07-11T01:00:00.000Z",
        available_at_basis: "local_first_seen",
        first_seen_at: "2026-07-11T01:00:00.000Z",
        source_updated_at_raw: "2026-07-11T00:30:00Z",
        latency_class: "end_of_day",
        revision_status: "first_seen_tracked",
        freshness_weekdays: 1,
        freshness_status: "fresh",
        point_in_time_status: "observed_first_seen",
        as_of: asOf.toISOString(),
        quality_issues: ["publication_time_unavailable"],
        cache_status: "not_applicable",
        source_error: null,
      }),
      ...overrides.realYield,
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

function overlayStudy(id, values = {}) {
  return {
    id,
    name: ANALYSIS_OVERLAY_NAME,
    title: ANALYSIS_OVERLAY_NAME,
    inputs: ANALYSIS_OVERLAY_INPUTS.map((input) => ({
      id: input.id,
      name: input.name,
      type: typeof (values[input.id] ?? 0),
      value: values[input.id] ?? 0,
      defval: 0,
      tooltip: null,
    })),
  };
}

test("exposes exactly the thirty-eight expected tools", async () => {
  const client = await connectedClient(makeDeps());
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "add_pine_to_chart",
      "apply_analysis_overlay",
      "audit_pine_indicator",
      "compare_indicator_observations",
      "compute_market_features",
      "compute_round_trip_cost",
      "ensure_analysis_overlay",
      "evaluate_analysis_overlay_outcome",
      "get_aligned_history",
      "get_analysis_overlay_status",
      "get_analysis_overlay_template",
      "get_chart_context",
      "get_chart_screenshot",
      "get_economic_events",
      "get_indicator_graphics",
      "get_indicator_inputs",
      "get_indicator_tables",
      "get_indicator_values",
      "get_key_levels",
      "get_market_snapshot",
      "get_mtf_overview",
      "get_ohlcv",
      "get_pine_source",
      "get_positioning_context",
      "get_quotes",
      "get_real_yield_context",
      "get_strategy_report",
      "get_watchlist",
      "list_alerts",
      "list_pine_scripts",
      "load_more_history",
      "remove_owned_study",
      "run_backtest",
      "save_pine_script",
      "scan_market",
      "set_indicator_input",
      "set_symbol",
      "set_timeframe",
    ],
  );
});

test("tool errors are redacted before reaching the MCP client", async () => {
  const client = await connectedClient(
    makeDeps({
      tv: {
        getOhlcv: async () => {
          throw new Error(
            "fetch failed for http://admin:hunter2@10.0.0.5:9222/json?token=abc123 while connecting",
          );
        },
      },
    }),
  );
  const res = await client.callTool({ name: "get_ohlcv", arguments: {} });
  assert.equal(res.isError, true);
  const text = res.content[0].text;
  assert.ok(!text.includes("hunter2"), "must not leak URL credentials");
  assert.ok(!text.includes("token=abc123"), "must not leak query tokens");
  assert.ok(text.includes("fetch failed"), "the error must stay recognizable");
  assert.ok(text.includes("while connecting"), "text after the URL must survive");
});

test("get_mtf_overview forwards symbols, timeframes and fields", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "get_mtf_overview",
    arguments: { symbols: ["OANDA:EURUSD", "OANDA:USDJPY"], timeframes: ["60", "1D"], fields: ["RSI"] },
  });
  const [eur, jpy] = JSON.parse(res.content[0].text);
  assert.equal(eur.symbol, "OANDA:EURUSD");
  assert.equal(jpy.symbol, "OANDA:USDJPY");
  assert.deepEqual(Object.keys(eur.timeframes), ["60", "1D"]);
  assert.deepEqual(eur.timeframes["60"].fields, ["RSI"]);
});

test("get_aligned_history aligns closed bars without forward filling", async () => {
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "test",
          activeChartIndex: 0,
          chartsCount: 2,
          charts: [
            { index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] },
            { index: 1, symbol: "TVC:DXY", resolution: "60", studies: [] },
          ],
        }),
        getOhlcv: async (_count, chartIndex) => ({
          symbol: chartIndex === 0 ? "OANDA:EURUSD" : "TVC:DXY",
          resolution: "60",
          count: 3,
          bars: [
            { time: 100, timeIso: "1970-01-01T00:01:40.000Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
            { time: 200, timeIso: "1970-01-01T00:03:20.000Z", open: 2, high: 3, low: 1.5, close: 2.5, volume: 200 },
            { time: 300, timeIso: "1970-01-01T00:05:00.000Z", open: 3, high: 4, low: 2.5, close: 3.5, volume: 300, ...(chartIndex === 0 ? { forming: true } : {}) },
          ],
        }),
      },
    }),
  );
  const res = await client.callTool({ name: "get_aligned_history", arguments: { count: 10 } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "blocked", "the DXY bar at 300 cannot be forward-filled onto EURUSD");
  assert.equal(parsed.alignment_policy, "exact_utc_timestamp_no_forward_fill");
  assert.equal(parsed.observations.length, 2);
  assert.equal(parsed.observations[0].bars.length, 2);
  assert.equal(parsed.forming_bars_excluded["0"], 1);
});

test("audit_pine_indicator identifies repaint-prone source constructs", async () => {
  const client = await connectedClient(
    makeDeps({
      tv: {
        getPineSource: async () => ({
          pineId: "USER;adc40b1dfee344f19412f1ae9af74f3f",
          version: "5",
          name: "Risky",
          kind: "study",
          updated: null,
          sourceLength: 150,
          source: "//@version=5\nvarip float x = na\nh = request.security(syminfo.tickerid, 'D', high)\np = ta.pivothigh(high, 2, 2)\nplot(timenow)",
        }),
      },
    }),
  );
  const res = await client.callTool({
    name: "audit_pine_indicator",
    arguments: { pine_id: "USER;adc40b1dfee344f19412f1ae9af74f3f" },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "restricted");
  assert.equal(parsed.uses_request_security, true);
  assert.equal(parsed.uses_pivots, true);
  assert.equal(parsed.uses_varip, true);
  assert.equal(parsed.uses_timenow, true);
  assert.equal(parsed.restart_diff_checked, false);
});

test("compare_indicator_observations exposes restart differences without persistence", async () => {
  const client = await connectedClient(makeDeps());
  const before = { study_id: "st1", symbol: "OANDA:EURUSD", resolution: "60", bars: [{ time: 1, values: { Signal: 1 } }] };
  const res = await client.callTool({ name: "compare_indicator_observations", arguments: { before, after: { ...before, bars: [{ time: 1, values: { Signal: 2 } }] } } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "changed");
  assert.equal(parsed.changed_values[0].plot, "Signal");
});

test("compute_market_features returns deterministic return, volatility, ATR, and correlations", async () => {
  const client = await connectedClient(makeDeps());
  const observations = [100, 101, 102, 103].map((close, index) => ({
    time: index,
    bars: [
      { symbol: "OANDA:EURUSD", open: close - 0.5, high: close + 1, low: close - 1, close },
      { symbol: "TVC:DXY", open: 200 + index * index, high: 201 + index * index, low: 199 + index * index, close: 200 + index * index },
    ],
  }));
  const res = await client.callTool({
    name: "compute_market_features",
    arguments: { primary_symbol: "OANDA:EURUSD", window: 3, observations },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.observations_used, 4);
  assert.ok(parsed.return_log > 0);
  assert.ok(parsed.atr > 0);
  assert.ok(parsed.correlations["TVC:DXY"] < 0);
});

test("compute_round_trip_cost exposes explicit execution assumptions", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "compute_round_trip_cost", arguments: { symbol: "OANDA:EURUSD", bid: 1.1, ask: 1.1002, quantity: 100000, slippage_pips_per_side: 0.5 } });
  const parsed = JSON.parse(res.content[0].text);
  assert.ok(Math.abs(parsed.spread_pips - 2) < 1e-12);
  assert.equal(parsed.slippage_pips_round_trip, 1);
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

test("get_indicator_tables forwards options and returns grids", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "get_indicator_tables",
    arguments: { study_id: "st1", chart_index: 1 },
  });
  const [study] = JSON.parse(res.content[0].text);
  assert.deepEqual(study.options, { studyId: "st1", chartIndex: 1 });
  assert.deepEqual(study.tables[0].grid[1], ["Predict", "UP"]);
});

test("load_more_history forwards count with default", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "load_more_history", arguments: {} });
  assert.equal(JSON.parse(res.content[0].text).requested, 300);
  const res2 = await client.callTool({ name: "load_more_history", arguments: { count: 42 } });
  assert.equal(JSON.parse(res2.content[0].text).added, 42);
});

test("list_pine_scripts and get_pine_source expose own Pine sources", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "list_pine_scripts", arguments: {} });
  const [script] = JSON.parse(res.content[0].text);
  assert.equal(script.kind, "study");
  assert.equal(script.usedBy[0].studyId, "st1");

  const res2 = await client.callTool({
    name: "get_pine_source",
    arguments: { pine_id: script.pineId },
  });
  const parsed = JSON.parse(res2.content[0].text);
  assert.equal(parsed.pineId, script.pineId);
  assert.match(parsed.source, /^\/\/@version=5/);
});

test("save_pine_script defaults to a dry run; confirm must be explicit", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "save_pine_script",
    arguments: { source: "//@version=5\nplot(close)", name: "New Script" },
  });
  const dry = JSON.parse(res.content[0].text);
  assert.equal(dry.dryRun, true, "omitting confirm must not write");
  assert.equal(dry.options.confirm, false);

  const res2 = await client.callTool({
    name: "save_pine_script",
    arguments: {
      source: "//@version=5\nplot(close)",
      pine_id: "USER;adc40b1dfee344f19412f1ae9af74f3f",
      confirm: true,
    },
  });
  const saved = JSON.parse(res2.content[0].text);
  assert.equal(saved.saved, true);
  assert.equal(saved.action, "new_version");
  assert.equal(saved.options.pineId, "USER;adc40b1dfee344f19412f1ae9af74f3f");
});

test("add_pine_to_chart and get_pine_source version forward correctly", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "add_pine_to_chart",
    arguments: { pine_id: "USER;adc40b1dfee344f19412f1ae9af74f3f", chart_index: 1 },
  });
  const added = JSON.parse(res.content[0].text);
  assert.equal(added.studyId, "stNew");
  assert.equal(added.chartIndex, 1);

  const res2 = await client.callTool({
    name: "get_pine_source",
    arguments: { pine_id: "USER;adc40b1dfee344f19412f1ae9af74f3f", version: "2" },
  });
  assert.equal(JSON.parse(res2.content[0].text).version, "2");
});

test("get_analysis_overlay_template returns the fixed Pine source", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_analysis_overlay_template", arguments: {} });
  const template = JSON.parse(res.content[0].text);
  assert.equal(template.name, ANALYSIS_OVERLAY_NAME);
  assert.equal(template.version, "1.0");
  assert.match(template.source, /entryBox := box\.new/);
  assert.equal(template.inputContract.length, 14);
});

test("ensure_analysis_overlay reuses one current instance without writing", async () => {
  let writes = 0;
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: [
              {
                chartIndex: 0,
                studyId: "overlay2",
                name: ANALYSIS_OVERLAY_NAME,
                version: "2.0",
              },
            ],
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async () => [overlayStudy("overlay2")],
        addPineToChart: async () => ((writes += 1), {}),
        removePineFromChart: async () => ((writes += 1), {}),
      },
    }),
  );
  const result = await client.callTool({
    name: "ensure_analysis_overlay",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "4H",
      confirm: true,
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.changed, false);
  assert.equal(parsed.studyId, "overlay2");
  assert.equal("dryRun" in parsed, false);
  assert.equal(writes, 0);
});

test("ensure_analysis_overlay previews and confirms cleanup of one outdated duplicate", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  let usages = [
    { chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" },
    { chartIndex: 0, studyId: "overlay1", name: ANALYSIS_OVERLAY_NAME, version: "1.0" },
  ];
  const removed = [];
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: usages,
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async ({ studyId }) => [overlayStudy(studyId)],
        removePineFromChart: async (_pineId, studyId) => {
          removed.push(studyId);
          usages = usages.filter((usage) => usage.studyId !== studyId);
          return { removed: true, studyId };
        },
      },
    }),
  );
  const args = {
    pine_id: pineId,
    expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "240",
  };
  const preview = JSON.parse(
    (await client.callTool({ name: "ensure_analysis_overlay", arguments: args })).content[0].text,
  );
  assert.equal(preview.action, "cleanup_outdated_analysis_overlay");
  assert.equal(preview.keepStudyId, "overlay2");
  assert.equal(preview.removeStudyId, "overlay1");
  assert.match(preview.warnings[0], /without migrating its inputs/);
  assert.deepEqual(removed, []);

  const confirmed = JSON.parse(
    (
      await client.callTool({
        name: "ensure_analysis_overlay",
        arguments: { ...args, confirm: true },
      })
    ).content[0].text,
  );
  assert.equal(confirmed.status, "ready");
  assert.equal(confirmed.studyId, "overlay2");
  assert.deepEqual(removed, ["overlay1"]);
});

test("ensure_analysis_overlay refuses multiple latest or three total instances", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const makeClient = (usedBy) =>
    connectedClient(
      makeDeps({
        tv: {
          getChartContext: async () => ({
            layoutName: "FX",
            activeChartIndex: 0,
            chartsCount: 1,
            charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
          }),
          listPineScripts: async () => [
            {
              pineId,
              name: ANALYSIS_OVERLAY_NAME,
              kind: "study",
              version: "2.0",
              usedBy,
            },
          ],
          getPineSource: async () => ({
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            updated: null,
            sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
            source: ANALYSIS_OVERLAY_SOURCE,
          }),
          getIndicatorInputs: async ({ studyId }) => [overlayStudy(studyId)],
        },
      }),
    );
  const args = {
    pine_id: pineId,
    expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "240",
  };

  const duplicateLatest = await makeClient([
    { chartIndex: 0, studyId: "latestA", name: ANALYSIS_OVERLAY_NAME, version: "2.0" },
    { chartIndex: 0, studyId: "latestB", name: ANALYSIS_OVERLAY_NAME, version: "2.0" },
  ]);
  const latestResult = await duplicateLatest.callTool({
    name: "ensure_analysis_overlay",
    arguments: args,
  });
  assert.equal(latestResult.isError, true);
  assert.match(latestResult.content[0].text, /multiple latest overlay instances/);

  const threeInstances = await makeClient([
    { chartIndex: 0, studyId: "latest", name: ANALYSIS_OVERLAY_NAME, version: "2.0" },
    { chartIndex: 0, studyId: "oldA", name: ANALYSIS_OVERLAY_NAME, version: "1.0" },
    { chartIndex: 0, studyId: "oldB", name: ANALYSIS_OVERLAY_NAME, version: "1.0" },
  ]);
  const totalResult = await threeInstances.callTool({
    name: "ensure_analysis_overlay",
    arguments: args,
  });
  assert.equal(totalResult.isError, true);
  assert.match(totalResult.content[0].text, /3 instances.*refusing ambiguous automatic cleanup/);
});

test("ensure_analysis_overlay migrates inputs before removing one old instance", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  let usages = [
    { chartIndex: 0, studyId: "overlay1", name: ANALYSIS_OVERLAY_NAME, version: "1.0" },
  ];
  const oldValues = Object.fromEntries(
    ANALYSIS_OVERLAY_INPUTS.map((input, index) => [input.id, index + 10]),
  );
  oldValues.in_0 = "analysis-old";
  oldValues.in_2 = "bullish";
  oldValues.in_13 = "event risk";
  const valuesByStudy = new Map([["overlay1", oldValues]]);
  const removed = [];
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: usages,
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async ({ studyId }) => [
          overlayStudy(studyId, valuesByStudy.get(studyId)),
        ],
        addPineToChart: async () => {
          usages = [...usages, { chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" }];
          valuesByStudy.set("overlay2", {});
          return {
            studyId: "overlay2",
            name: ANALYSIS_OVERLAY_NAME,
            isStrategy: false,
            version: "2.0",
            chartIndex: 0,
          };
        },
        setIndicatorInput: async (studyId, inputs) => {
          valuesByStudy.set(studyId, Object.fromEntries(inputs.map((input) => [input.id, input.value])));
          return { studyId, applied: inputs, settled: true };
        },
        removePineFromChart: async (_pineId, studyId) => {
          removed.push(studyId);
          usages = usages.filter((usage) => usage.studyId !== studyId);
          return { removed: true, studyId };
        },
      },
    }),
  );
  const result = await client.callTool({
    name: "ensure_analysis_overlay",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      confirm: true,
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.studyId, "overlay2");
  assert.equal(parsed.migrated, true);
  assert.deepEqual(removed, ["overlay1"]);
  assert.deepEqual(valuesByStudy.get("overlay2"), oldValues);
});

test("ensure_analysis_overlay rolls the new instance back when migration does not settle", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  let usages = [
    { chartIndex: 0, studyId: "overlay1", name: ANALYSIS_OVERLAY_NAME, version: "1.0" },
  ];
  const removed = [];
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: usages,
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async ({ studyId }) => [overlayStudy(studyId)],
        addPineToChart: async () => {
          usages = [...usages, { chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" }];
          return { studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" };
        },
        setIndicatorInput: async () => ({ settled: false }),
        removePineFromChart: async (_pineId, studyId) => {
          removed.push(studyId);
          usages = usages.filter((usage) => usage.studyId !== studyId);
          return { removed: true, studyId };
        },
      },
    }),
  );
  const result = await client.callTool({
    name: "ensure_analysis_overlay",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      confirm: true,
    },
  });
  assert.equal(result.isError, true);
  assert.deepEqual(removed, ["overlay2"]);
  assert.deepEqual(usages.map((usage) => usage.studyId), ["overlay1"]);
});

test("ensure_analysis_overlay preserves the original error when rollback also fails", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  let usages = [
    { chartIndex: 0, studyId: "overlay1", name: ANALYSIS_OVERLAY_NAME, version: "1.0" },
  ];
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: usages,
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async ({ studyId }) => [overlayStudy(studyId)],
        addPineToChart: async () => {
          usages = [
            ...usages,
            { chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" },
          ];
          return { studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" };
        },
        setIndicatorInput: async () => ({ settled: false }),
        removePineFromChart: async () => {
          throw new Error("rollback remove timed out");
        },
      },
    }),
  );
  const result = await client.callTool({
    name: "ensure_analysis_overlay",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      confirm: true,
    },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /input migration did not settle/);
  assert.match(result.content[0].text, /rollback remove timed out/);
});

test("get_analysis_overlay_status returns trusted current-price and render state", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const analyzedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const mapped = {
    in_0: "USDJPY-status",
    in_1: Date.parse(analyzedAt),
    in_2: "bullish",
    in_3: 162.24,
    in_4: 162.32,
    in_5: 162.44,
    in_6: 162.075,
    in_7: 162.04,
    in_8: 162.6,
    in_9: 162.8,
    in_10: 0,
    in_11: 0.64,
    in_12: Date.parse(expiresAt),
    in_13: "event risk",
  };
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: [
              {
                chartIndex: 0,
                studyId: "overlay2",
                name: ANALYSIS_OVERLAY_NAME,
                version: "2.0",
              },
            ],
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async () => [overlayStudy("overlay2", mapped)],
        getOhlcv: async () => ({
          symbol: "OANDA:USDJPY",
          resolution: "240",
          count: 1,
          bars: [
            {
              time: Math.floor(Date.now() / 1000),
              timeIso: new Date().toISOString(),
              open: 162.3,
              high: 162.5,
              low: 162.2,
              close: 162.45,
              volume: null,
              forming: true,
            },
          ],
        }),
        getIndicatorGraphics: async () => [
          {
            id: "overlay2",
            name: ANALYSIS_OVERLAY_NAME,
            totals: { labels: 1, lines: 5, boxes: 1 },
            labels: [],
            lines: [],
            boxes: [],
          },
        ],
      },
    }),
  );
  const result = await client.callTool({
    name: "get_analysis_overlay_status",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "4H",
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.trusted, true);
  assert.equal(parsed.versionStatus, "current");
  assert.equal(parsed.analysis.analysisId, "USDJPY-status");
  assert.equal(parsed.marketObservation.entryRelation, "above_entry");
  assert.equal(parsed.marketObservation.confirmation, "current_price_at_or_beyond");
  assert.equal(parsed.render.verified, true);
  assert.deepEqual(parsed.qualityIssues, []);
});

test("get_analysis_overlay_status does not trust an unconfigured overlay", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  let marketReads = 0;
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: [
              {
                chartIndex: 0,
                studyId: "overlay2",
                name: ANALYSIS_OVERLAY_NAME,
                version: "2.0",
              },
            ],
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async () => [
          overlayStudy("overlay2", {
            in_0: "unassigned",
            in_1: Date.parse("2020-01-01T00:00:00.000Z"),
            in_2: "neutral",
            in_3: 1,
            in_4: 1,
            in_5: 0,
            in_6: 1,
            in_7: 1,
            in_8: 0,
            in_9: 0,
            in_10: 0,
            in_11: 0.5,
            in_12: 0,
            in_13: "",
          }),
        ],
        getOhlcv: async () => {
          marketReads += 1;
          return { bars: [] };
        },
      },
    }),
  );
  const result = await client.callTool({
    name: "get_analysis_overlay_status",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "unconfigured");
  assert.equal(parsed.trusted, false);
  assert.equal(parsed.reason, "default_analysis_inputs");
  assert.equal(marketReads, 0);
});

test("get_analysis_overlay_status blocks inputs that violate the analysis contract", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: [
              {
                chartIndex: 0,
                studyId: "overlay2",
                name: ANALYSIS_OVERLAY_NAME,
                version: "2.0",
              },
            ],
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async () => [
          overlayStudy("overlay2", {
            in_0: "USDJPY-invalid",
            in_1: Date.now() - 60_000,
            in_2: "bullish",
            in_3: 162.1,
            in_4: 162.2,
            in_5: 162.3,
            in_6: 161.9,
            in_7: 162.4,
            in_8: 162.6,
            in_9: 0,
            in_10: 0,
            in_11: 0.5,
            in_12: 0,
            in_13: "",
          }),
        ],
      },
    }),
  );
  const result = await client.callTool({
    name: "get_analysis_overlay_status",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(result.isError, undefined);
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.trusted, false);
  assert.equal(parsed.reason, "inputs_violate_contract");
});

test("evaluate_analysis_overlay_outcome returns first-hit evidence from closed bars", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const analyzedAtMs = Date.now() - 60 * 60_000;
  const expiresAtMs = Date.now() - 5 * 60_000;
  const values = {
    in_0: "USDJPY-outcome",
    in_1: analyzedAtMs,
    in_2: "bullish",
    in_3: 162.1,
    in_4: 162.2,
    in_5: 0,
    in_6: 161.95,
    in_7: 161.9,
    in_8: 162.6,
    in_9: 162.8,
    in_10: 0,
    in_11: 0.6,
    in_12: expiresAtMs,
    in_13: "",
  };
  const makeBar = (timeMs, open, high, low, close, forming = false) => ({
    time: timeMs / 1000,
    timeIso: new Date(timeMs).toISOString(),
    open,
    high,
    low,
    close,
    volume: null,
    ...(forming ? { forming: true } : {}),
  });
  let requestedCount = null;
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "15", studies: [] }],
        }),
        listPineScripts: async () => [
          {
            pineId,
            name: ANALYSIS_OVERLAY_NAME,
            kind: "study",
            version: "2.0",
            usedBy: [
              {
                chartIndex: 0,
                studyId: "overlay2",
                name: ANALYSIS_OVERLAY_NAME,
                version: "2.0",
              },
            ],
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
          source: ANALYSIS_OVERLAY_SOURCE,
        }),
        getIndicatorInputs: async () => [overlayStudy("overlay2", values)],
        getOhlcv: async (count) => {
          requestedCount = count;
          return {
            symbol: "OANDA:USDJPY",
            resolution: "15",
            count: 4,
            bars: [
              makeBar(analyzedAtMs - 5 * 60_000, 162.3, 162.7, 161.8, 162.3),
              makeBar(analyzedAtMs + 10 * 60_000, 162.3, 162.35, 162.15, 162.25),
              makeBar(analyzedAtMs + 25 * 60_000, 162.25, 162.65, 162.22, 162.55),
              makeBar(analyzedAtMs + 40 * 60_000, 162.55, 162.9, 162.5, 162.8, true),
            ],
          };
        },
      },
    }),
  );
  const result = await client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "15",
      count: 500,
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(requestedCount, 500);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.outcome, "target_before_stop");
  assert.equal(parsed.terminal.targetIndex, 1);
  assert.equal(parsed.source.formingBarsExcluded, 1);
});

test("get_analysis_overlay_status reports missing and blocks unaudited placed source", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const baseScript = {
    pineId,
    name: ANALYSIS_OVERLAY_NAME,
    kind: "study",
    version: "2.0",
  };
  const context = async () => ({
    layoutName: "FX",
    activeChartIndex: 0,
    chartsCount: 1,
    charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
  });
  const missingClient = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: context,
        listPineScripts: async () => [{ ...baseScript, usedBy: [] }],
      },
    }),
  );
  const args = {
    pine_id: pineId,
    expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "240",
  };
  const missing = await missingClient.callTool({
    name: "get_analysis_overlay_status",
    arguments: args,
  });
  assert.equal(JSON.parse(missing.content[0].text).status, "not_installed");

  const blockedClient = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: context,
        listPineScripts: async () => [
          {
            ...baseScript,
            usedBy: [
              {
                chartIndex: 0,
                studyId: "overlay2",
                name: ANALYSIS_OVERLAY_NAME,
                version: "2.0",
              },
            ],
          },
        ],
        getPineSource: async () => ({
          pineId,
          name: ANALYSIS_OVERLAY_NAME,
          kind: "study",
          version: "2.0",
          updated: null,
          sourceLength: 13,
          source: "plot(close)",
        }),
      },
    }),
  );
  const blocked = await blockedClient.callTool({
    name: "get_analysis_overlay_status",
    arguments: args,
  });
  const blockedResult = JSON.parse(blocked.content[0].text);
  assert.equal(blockedResult.status, "blocked");
  assert.equal(blockedResult.trusted, false);
  assert.equal(blockedResult.reason, "on_chart_source_does_not_match_audited_template");
});

test("remove_owned_study requires confirmation and forwards an ownership-verified removal", async () => {
  let removals = 0;
  const pineId = "USER;adc40b1dfee344f19412f1ae9af74f3f";
  const client = await connectedClient(
    makeDeps({
      tv: {
        removePineFromChart: async (actualPineId, studyId, chartIndex) => {
          removals += 1;
          return { removed: true, pineId: actualPineId, studyId, chartIndex };
        },
      },
    }),
  );
  const args = {
    pine_id: pineId,
    study_id: "st1",
    expected_symbol: "EURUSD",
    expected_timeframe: "1D",
  };
  const dry = await client.callTool({ name: "remove_owned_study", arguments: args });
  assert.equal(JSON.parse(dry.content[0].text).dryRun, true);
  assert.equal(removals, 0);
  const live = await client.callTool({
    name: "remove_owned_study",
    arguments: { ...args, confirm: true },
  });
  assert.equal(JSON.parse(live.content[0].text).removed, true);
  assert.equal(removals, 1);
});

test("apply_analysis_overlay is a dry run by default and verifies after confirmation", async () => {
  let values = Object.fromEntries(ANALYSIS_OVERLAY_INPUTS.map((input) => [input.id, 0]));
  let writes = 0;
  const overlayInputs = () => [
    {
      id: "overlay1",
      name: ANALYSIS_OVERLAY_NAME,
      title: ANALYSIS_OVERLAY_NAME,
      inputs: ANALYSIS_OVERLAY_INPUTS.map((input) => ({
        id: input.id,
        name: input.name,
        type: typeof values[input.id],
        value: values[input.id],
        defval: 0,
        tooltip: null,
      })),
    },
  ];
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        getIndicatorInputs: async () => overlayInputs(),
        setIndicatorInput: async (studyId, inputs, options) => {
          writes += 1;
          values = { ...values, ...Object.fromEntries(inputs.map((input) => [input.id, input.value])) };
          return { studyId, applied: inputs, options, settled: true };
        },
        getIndicatorGraphics: async () => [
          {
            id: "overlay1",
            name: ANALYSIS_OVERLAY_NAME,
            totals: { labels: 1, lines: 5, boxes: 1 },
            labels: [],
            lines: [],
            boxes: [],
          },
        ],
      },
    }),
  );
  const args = {
    study_id: "overlay1",
    expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "4H",
    analysis_id: "USDJPY-20260715-1930",
    analyzed_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    bias: "bullish",
    entry_low: 162.28,
    entry_high: 162.35,
    confirmation: 162.43,
    invalidation: 162.18,
    stop: 162.15,
    targets: [162.6, 162.85],
    confidence: 0.72,
    note: "PPI risk",
  };
  const dry = await client.callTool({ name: "apply_analysis_overlay", arguments: args });
  assert.equal(JSON.parse(dry.content[0].text).dryRun, true);
  assert.equal(writes, 0);

  const live = await client.callTool({
    name: "apply_analysis_overlay",
    arguments: { ...args, confirm: true },
  });
  const applied = JSON.parse(live.content[0].text);
  assert.equal(writes, 1);
  assert.equal(applied.verified, true);
  assert.deepEqual(applied.graphicsVerification, { labels: 1, lines: 5, boxes: 1 });
});

test("apply_analysis_overlay does not report verified when recalculation misses its deadline", async () => {
  let values = Object.fromEntries(ANALYSIS_OVERLAY_INPUTS.map((input) => [input.id, 0]));
  const overlayInputs = () => [
    {
      id: "overlay1",
      name: ANALYSIS_OVERLAY_NAME,
      title: ANALYSIS_OVERLAY_NAME,
      inputs: ANALYSIS_OVERLAY_INPUTS.map((input) => ({
        id: input.id,
        name: input.name,
        type: typeof values[input.id],
        value: values[input.id],
        defval: 0,
        tooltip: null,
      })),
    },
  ];
  const client = await connectedClient(
    makeDeps({
      tv: {
        getChartContext: async () => ({
          layoutName: "FX",
          activeChartIndex: 0,
          chartsCount: 1,
          charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
        }),
        getIndicatorInputs: async () => overlayInputs(),
        setIndicatorInput: async (studyId, inputs) => {
          values = { ...values, ...Object.fromEntries(inputs.map((input) => [input.id, input.value])) };
          return { studyId, applied: inputs, settled: false, warning: "deadline hit" };
        },
        getIndicatorGraphics: async () => [
          {
            id: "overlay1",
            name: ANALYSIS_OVERLAY_NAME,
            totals: { labels: 1, lines: 5, boxes: 1 },
            labels: [],
            lines: [],
            boxes: [],
          },
        ],
      },
    }),
  );
  const result = await client.callTool({
    name: "apply_analysis_overlay",
    arguments: {
      study_id: "overlay1",
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      analysis_id: "USDJPY-timeout",
      analyzed_at: new Date(Date.now() - 60_000).toISOString(),
      bias: "bullish",
      entry_low: 162.24,
      entry_high: 162.32,
      confirmation: 162.44,
      invalidation: 162.075,
      stop: 162.04,
      targets: [162.6],
      confidence: 0.64,
      confirm: true,
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.verified, false);
  assert.equal(parsed.inputsVerified, true);
  assert.equal(parsed.recalculationSettled, false);
  assert.match(parsed.warnings.join(" "), /recalculation did not settle/);
});

test("get_strategy_report and run_backtest expose the strategy tester", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_strategy_report", arguments: {} });
  const report = JSON.parse(res.content[0].text);
  assert.equal(report.strategy, "Test Strategy");
  assert.deepEqual(report.options, { tradesLimit: 20 });
  assert.equal(report.trades[0].direction, "short");

  const res2 = await client.callTool({
    name: "run_backtest",
    arguments: { pine_id: "USER;71f1e4e6807c4bb48bd55edb886908a0", trades_limit: 5 },
  });
  const bt = JSON.parse(res2.content[0].text);
  assert.equal(bt.pineId, "USER;71f1e4e6807c4bb48bd55edb886908a0");
  assert.equal(bt.removedFromChart, true, "auto-remove is the default");
  assert.deepEqual(bt.options, {
    pineId: "USER;71f1e4e6807c4bb48bd55edb886908a0",
    tradesLimit: 5,
    keepOnChart: false,
  });
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

test("get_market_snapshot joins sources and exposes timestamp/data-quality limits", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "get_market_snapshot",
    arguments: {
      symbols: ["OANDA:EURUSD"],
      auxiliary_symbols: ["TVC:DXY"],
      timeframes: ["60", "1D"],
      fields: ["RSI"],
      required_quote_fields: ["close"],
      include_events: true,
      countries: ["US"],
      min_importance: "high",
    },
  });
  assert.equal(res.isError, undefined);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.schema_version, "1.0");
  assert.match(parsed.snapshot_id, /^[0-9a-f-]{36}$/i);
  assert.equal(parsed.status, "partial", "receipt time is not a common market-data timestamp");
  assert.equal(parsed.data_use.automated_trading_decision, "not_permitted");
  assert.deepEqual(parsed.requested_symbols, ["OANDA:EURUSD", "TVC:DXY"]);
  assert.deepEqual(parsed.required_symbols, ["OANDA:EURUSD"]);
  assert.equal(parsed.quotes.length, 2);
  assert.equal(parsed.normalized_quotes[0].spread_status, "unavailable");
  assert.deepEqual(Object.keys(parsed.mtf_overview[0].timeframes), ["60", "1D"]);
  assert.equal(parsed.economic_events.events[0].title, "FOMC Minutes");
  assert.equal(parsed.quality_issues[0].code, "source_timestamp_unavailable");
  assert.equal(parsed.max_source_skew_ms, null, "source timestamps are unavailable");
  assert.equal(typeof parsed.max_receipt_skew_ms, "number");
});

test("get_positioning_context exposes delayed COT data with limitations", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_positioning_context", arguments: { symbol: "OANDA:EURUSD" } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.schema_version, "1.1");
  assert.equal(parsed.status, "partial");
  assert.equal(parsed.schema_version, "1.1");
  assert.equal(parsed.cot.symbol, "OANDA:EURUSD");
  assert.equal(parsed.cot.positioning_features.point_in_time_status, "blocked");
  assert.match(parsed.limitations[0], /weekly/);
});

test("get_real_yield_context exposes official daily macro context", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_real_yield_context", arguments: {} });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(parsed.status, "partial");
  assert.equal(parsed.series, "US_TREASURY_PAR_REAL_CMT_10Y");
  assert.equal(parsed.value, 2.01);
  assert.equal(parsed.available_at, null);
  assert.equal(parsed.point_in_time_status, "blocked");
  assert.deepEqual(res.structuredContent, parsed);
});

test("get_real_yield_context forwards an as_of cutoff to persisted history", async () => {
  let receivedAsOf = null;
  const client = await connectedClient(makeDeps({
    realYield: {
      getAsOf: async (asOf) => {
        receivedAsOf = asOf;
        return {
          schema_version: "1.1",
          status: "partial",
          series: "US_TREASURY_PAR_REAL_CMT_10Y",
          observation_date: "2026-07-10",
          value: 1.98,
          value_status: "valid",
          unit: "percent_per_annum_bond_equivalent",
          source: "us_treasury",
          source_url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/",
          observed_at: "2026-07-11T01:00:00.000Z",
          source_at: null,
          available_at: "2026-07-11T01:00:00.000Z",
          available_at_basis: "local_first_seen",
          first_seen_at: "2026-07-11T01:00:00.000Z",
          source_updated_at_raw: "2026-07-11T00:30:00Z",
          latency_class: "end_of_day",
          revision_status: "first_seen_tracked",
          freshness_weekdays: 1,
          freshness_status: "fresh",
          point_in_time_status: "observed_first_seen",
          as_of: asOf.toISOString(),
          quality_issues: ["publication_time_unavailable"],
          cache_status: "not_applicable",
          source_error: null,
        };
      },
    },
  }));
  const res = await client.callTool({
    name: "get_real_yield_context",
    arguments: { as_of: "2026-07-12T00:00:00.000Z" },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(receivedAsOf.toISOString(), "2026-07-12T00:00:00.000Z");
  assert.equal(parsed.observation_date, "2026-07-10");
  assert.equal(parsed.available_at_basis, "local_first_seen");
  assert.equal(parsed.point_in_time_status, "observed_first_seen");
  assert.deepEqual(res.structuredContent, parsed);
});

test("get_real_yield_context fails closed when Treasury is unavailable", async () => {
  const client = await connectedClient(makeDeps({
    realYield: { getLatest: async () => { throw new Error("Treasury unavailable"); } },
  }));
  const res = await client.callTool({ name: "get_real_yield_context", arguments: {} });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(parsed.status, "unavailable");
  assert.equal(parsed.observation_date, null);
  assert.equal(parsed.value, null);
  assert.equal(parsed.value_status, "unavailable");
  assert.equal(parsed.unit, "percent_per_annum_bond_equivalent");
  assert.equal(parsed.source_at, null);
  assert.equal(parsed.first_seen_at, null);
  assert.equal(parsed.freshness_weekdays, null);
  assert.equal(parsed.freshness_status, "unavailable");
  assert.equal(parsed.quality_issues[0], "source_request_failed");
});

test("get_positioning_context exposes requested COT history", async () => {
  let requestedWeeks = null;
  const client = await connectedClient(makeDeps({
    cot: {
      getHistory: async (symbol, weeks) => {
        requestedWeeks = weeks;
        return {
          symbol,
          requested_weeks: weeks,
          observations: [
            { symbol, report_date: "2026-07-07T00:00:00.000Z", positions: [] },
            { symbol, report_date: "2026-06-30T00:00:00.000Z", positions: [] },
          ],
          cache_status: "miss",
        };
      },
    },
  }));
  const res = await client.callTool({
    name: "get_positioning_context",
    arguments: { symbol: "OANDA:EURUSD", weeks: 2 },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(requestedWeeks, 2);
  assert.equal(parsed.as_of, "2026-07-07T00:00:00.000Z");
  assert.equal(parsed.cot.observations.length, 2);
});

test("get_positioning_context treats an explicit one week request as history", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "get_positioning_context",
    arguments: { symbol: "OANDA:EURUSD", weeks: 1 },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(parsed.cot.requested_weeks, 1);
  assert.equal(parsed.cot.observations.length, 1);
});

test("get_market_snapshot blocks required quote gaps but preserves the evidence", async () => {
  const client = await connectedClient(
    makeDeps({
      scanner: {
        getQuotes: async () => ({
          totalCount: 1,
          returned: 1,
          rows: [{ symbol: "OANDA:EURUSD", values: { close: null } }],
        }),
      },
    }),
  );
  const res = await client.callTool({
    name: "get_market_snapshot",
    arguments: { symbols: ["OANDA:EURUSD"], required_quote_fields: ["close"] },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "required_quote_field_invalid"));
  assert.equal(parsed.quotes[0].values.close, null);
});

test("get_market_snapshot blocks a crossed bid/ask quote and reports source timing", async () => {
  const client = await connectedClient(
    makeDeps({
      scanner: {
        getQuotes: async () => ({
          totalCount: 1,
          returned: 1,
          rows: [{ symbol: "OANDA:EURUSD", values: { bid: 1.2, ask: 1.1 } }],
        }),
      },
    }),
  );
  const res = await client.callTool({
    name: "get_market_snapshot",
    arguments: { symbols: ["OANDA:EURUSD"], required_quote_fields: ["bid", "ask"] },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "bid_ask_inverted"));
  assert.equal(parsed.sources[0].status, "ok");
  assert.equal(typeof parsed.sources[0].latency_ms, "number");
  assert.equal(parsed.normalized_quotes[0].spread_status, "bid_ask_incomplete");
});

test("get_market_snapshot derives mid and spread from a valid bid/ask pair", async () => {
  const client = await connectedClient(
    makeDeps({
      scanner: {
        getQuotes: async () => ({
          totalCount: 1,
          returned: 1,
          rows: [{ symbol: "OANDA:EURUSD", values: { bid: 1.1, ask: 1.1002 } }],
        }),
      },
    }),
  );
  const res = await client.callTool({
    name: "get_market_snapshot",
    arguments: { symbols: ["OANDA:EURUSD"], required_quote_fields: ["bid", "ask"] },
  });
  const quote = JSON.parse(res.content[0].text).normalized_quotes[0];
  assert.equal(quote.spread_status, "derived_from_bid_ask");
  assert.equal(quote.mid, 1.1001);
  assert.ok(Math.abs(quote.spread_price - 0.0002) < 1e-12);
  assert.equal(quote.pip_size, 0.0001);
  assert.equal(quote.tick_size, 0.00001);
  assert.ok(Math.abs(quote.spread_pips - 2) < 1e-12);
});

test("get_market_snapshot rejects an MTF column combination before it reaches the scanner", async () => {
  let scannerCalled = false;
  const client = await connectedClient(
    makeDeps({
      scanner: {
        getQuotes: async () => ((scannerCalled = true), {}),
        getMtfOverview: async () => ((scannerCalled = true), []),
      },
    }),
  );
  const res = await client.callTool({
    name: "get_market_snapshot",
    arguments: { symbols: ["OANDA:EURUSD"], timeframes: ["1", "5", "15", "30", "60", "240"] },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /too many MTF columns/);
  assert.equal(scannerCalled, false);
});

test("get_market_snapshot blocks duplicate required quotes and drops unexpected rows", async () => {
  const client = await connectedClient(
    makeDeps({
      scanner: {
        getQuotes: async () => ({
          totalCount: 3,
          returned: 3,
          rows: [
            { symbol: "OANDA:EURUSD", values: { close: 1.1 } },
            { symbol: "OANDA:EURUSD", values: { close: 1.2 } },
            { symbol: "OANDA:USDJPY", values: { close: 150 } },
          ],
        }),
      },
    }),
  );
  const res = await client.callTool({ name: "get_market_snapshot", arguments: { symbols: ["OANDA:EURUSD"] } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.deepEqual(parsed.returned_symbols, ["OANDA:EURUSD"]);
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "duplicate_required_quote"));
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "unexpected_quote_symbol"));
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

test("set_indicator_input forwards study_id, inputs and chart_index", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "set_indicator_input",
    arguments: { study_id: "st1", inputs: [{ id: "in_0", value: 20 }], chart_index: 1 },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.studyId, "st1");
  assert.equal(parsed.applied[0].value, 20);
  assert.equal(parsed.options.chartIndex, 1);
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
      setIndicatorInput: async () => ((handlerRan = true), {}),
      getIndicatorGraphics: async () => ((handlerRan = true), []),
      loadMoreHistory: async () => ((handlerRan = true), {}),
      listAlerts: async () => ((handlerRan = true), []),
      getWatchlists: async () => ((handlerRan = true), []),
      setSymbol: async () => ((handlerRan = true), {}),
      setResolution: async () => ((handlerRan = true), {}),
      getKeyLevels: async () => ((handlerRan = true), {}),
      getIndicatorTables: async () => ((handlerRan = true), []),
      listPineScripts: async () => ((handlerRan = true), []),
      getPineSource: async () => ((handlerRan = true), {}),
      getStrategyReport: async () => ((handlerRan = true), {}),
      runBacktest: async () => ((handlerRan = true), {}),
      savePineScript: async () => ((handlerRan = true), {}),
      addPineToChart: async () => ((handlerRan = true), {}),
    },
    cdp: { screenshot: async () => ((handlerRan = true), "x") },
    scanner: {
      getQuotes: async () => ((handlerRan = true), {}),
      scanMarket: async () => ((handlerRan = true), {}),
      getMtfOverview: async () => ((handlerRan = true), []),
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
    { name: "set_indicator_input", arguments: {} },
    { name: "set_indicator_input", arguments: { study_id: "has space", inputs: [{ id: "in_0", value: 1 }] } },
    { name: "set_indicator_input", arguments: { study_id: "st1", inputs: [] } },
    { name: "set_indicator_input", arguments: { study_id: "st1", inputs: [{ id: "has space", value: 1 }] } },
    { name: "set_indicator_input", arguments: { study_id: "st1", inputs: [{ id: "in_0", value: { nested: true } }] } },
    { name: "get_quotes", arguments: { symbols: [] } },
    { name: "get_quotes", arguments: { symbols: ["bad ticker!"] } },
    { name: "get_market_snapshot", arguments: {} },
    { name: "get_market_snapshot", arguments: { symbols: [] } },
    { name: "get_market_snapshot", arguments: { symbols: ["bad ticker!"] } },
    { name: "get_market_snapshot", arguments: { symbols: ["OANDA:EURUSD"], timeframes: ["7"] } },
    { name: "get_market_snapshot", arguments: { symbols: ["OANDA:EURUSD"], fields: Array(9).fill("RSI") } },
    { name: "scan_market", arguments: { market: "JAPAN/../x" } },
    { name: "scan_market", arguments: { market: "japan", filters: [{ field: "RSI", operation: "drop" }] } },
    { name: "scan_market", arguments: { market: "japan", limit: 101 } },
    { name: "get_mtf_overview", arguments: { symbols: ["OANDA:EURUSD"], timeframes: ["7"] } },
    { name: "get_mtf_overview", arguments: {} },
    { name: "get_mtf_overview", arguments: { symbols: [] } },
    { name: "get_mtf_overview", arguments: { symbols: Array(21).fill("OANDA:EURUSD") } },
    { name: "get_mtf_overview", arguments: { symbols: ["bad ticker!"] } },
    { name: "get_indicator_graphics", arguments: { study_id: "has space" } },
    { name: "get_indicator_graphics", arguments: { limit_per_kind: 501 } },
    { name: "load_more_history", arguments: { count: 5001 } },
    { name: "load_more_history", arguments: { count: "many" } },
    { name: "get_indicator_tables", arguments: { study_id: "has space" } },
    { name: "get_indicator_tables", arguments: { chart_index: -1 } },
    { name: "get_key_levels", arguments: { range_percent: 0 } },
    { name: "get_key_levels", arguments: { range_percent: 51 } },
    { name: "get_key_levels", arguments: { limit: 0 } },
    { name: "get_economic_events", arguments: { countries: ["USA"] } },
    { name: "get_economic_events", arguments: { countries: [] } },
    { name: "get_economic_events", arguments: { min_importance: "extreme" } },
    { name: "get_economic_events", arguments: { limit: 201 } },
    { name: "get_pine_source", arguments: {} },
    { name: "get_pine_source", arguments: { pine_id: "PUB;abcdef1234567890" } },
    { name: "get_pine_source", arguments: { pine_id: 'USER;x"); hack(); ("' } },
    { name: "run_backtest", arguments: {} },
    { name: "run_backtest", arguments: { pine_id: "PUB;abcdef1234567890" } },
    { name: "run_backtest", arguments: { pine_id: "USER;71f1e4e6807c4bb48bd55edb886908a0", trades_limit: 501 } },
    { name: "get_strategy_report", arguments: { trades_limit: 0 } },
    { name: "save_pine_script", arguments: {} },
    { name: "save_pine_script", arguments: { source: "x", pine_id: "PUB;abcdef1234567890" } },
    { name: "save_pine_script", arguments: { source: "x", name: "n", confirm: "yes" } },
    { name: "add_pine_to_chart", arguments: {} },
    { name: "add_pine_to_chart", arguments: { pine_id: "PUB;abcdef1234567890" } },
    { name: "get_pine_source", arguments: { pine_id: "USER;adc40b1dfee344f19412f1ae9af74f3f", version: "evil" } },
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
