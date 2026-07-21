import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../build/server.js";
import {
  ANALYSIS_OVERLAY_INPUTS,
  ANALYSIS_OVERLAY_LEGACY_INPUTS,
  ANALYSIS_OVERLAY_NAME,
  ANALYSIS_OVERLAY_SOURCE,
} from "../../build/analysisOverlay.js";
import { AnalysisDefinitionConflictError } from "../../build/analysisJournal.js";

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
      getReplayStatus: async () => ({
        available: true,
        toolbarVisible: false,
        started: false,
        ready: false,
        autoplay: false,
        jumpToBarMode: false,
        currentTime: null,
        currentTimeIso: null,
        selectedTime: null,
        selectedTimeIso: null,
        currentResolution: null,
        replayResolutions: [],
        autoResolution: "1D",
        autoplayDelayMs: 1000,
        activeChart: { symbol: "EURUSD", resolution: "1D", index: 0 },
      }),
      startReplay: async (options) => ({
        requestedStartAt: options.startAt,
        status: { started: true, currentTimeIso: options.startAt },
      }),
      stepReplay: async (steps) => ({
        requestedSteps: steps,
        completedSteps: steps,
        reachedEnd: false,
        before: { currentTime: 1 },
        after: { currentTime: 2 },
      }),
      stopReplay: async () => ({ changed: true, before: { started: true }, after: { started: false } }),
      getExecutionQuotes: async () => [],
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
        symbol: "OANDA:EURUSD",
        timeframe: "60",
        studyId: "strategy-1",
        pineId: "USER;71f1e4e6807c4bb48bd55edb886908a0",
        pineVersion: "2.0",
        inputs: [],
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
      getStrategyTradeLedger: async (options) => ({
        schemaVersion: "1.0",
        ledgerId: `sha256:${"a".repeat(64)}`,
        strategy: "Test Strategy",
        currency: "USD",
        initialCapital: 1000000,
        dateRange: { from: "2020-01-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
        summary: { netProfit: -1675, totalTrades: 21 },
        totalTrades: 21,
        availableTrades: 21,
        countMatchesSummary: true,
        ordering: "strategy_report",
        offset: options.offset,
        limit: options.limit,
        returned: 1,
        nextOffset: null,
        complete: true,
        unavailableFields: ["trade_run_up"],
        qualityIssues: [],
        options,
        trades: [{ number: 21, direction: "short", status: "closed" }],
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
      createPriceAlert: async (options) => ({
        requestId: 1,
        alertId: 2,
        name: options.name,
        symbol: options.symbol,
        resolution: options.resolution,
        operator: options.operator,
        level: options.level,
        expiration: options.expiration,
        verified: true,
      }),
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
      setSymbol: async (symbol) => ({ symbol, resolution: "1D", changed: true, bars: 1 }),
      setResolution: async (resolution) => ({ symbol: "EURUSD", resolution }),
      ...overrides.tv,
    },
    journal: {
      recordAnalysis: async (definition) => ({
        recorded: true,
        idempotent: false,
        entry: {
          event_id: "11111111-1111-4111-8111-111111111111",
          payload: definition,
        },
      }),
      recordOutcome: async (_analysisId, _definitionHash, outcome) => ({
        recorded: true,
        idempotent: false,
        entry: {
          event_id: "22222222-2222-4222-8222-222222222222",
          payload: outcome,
        },
      }),
      recordAlertSet: async (_analysisId, _definitionHash, alerts) => ({
        recorded: true,
        idempotent: false,
        entry: {
          event_id: "44444444-4444-4444-8444-444444444444",
          payload: { alerts },
        },
      }),
      list: async (options) => ({ total: 0, returned: 0, analyses: [], options }),
      calibration: async (options) => ({
        population: 0,
        included: 0,
        excluded: {},
        labelDefinition: { positive: "target_before_stop", negative: "stop_before_target" },
        calibration: null,
        options,
      }),
      ...overrides.journal,
    },
    researchJournal: {
      registerHypothesis: async (payload) => ({ recorded: true, idempotent: false, entry: { payload } }),
      recordExperiment: async (payload) => ({ recorded: true, idempotent: false, entry: { payload, evidence_hash: `sha256:${"e".repeat(64)}` } }),
      compare: async (references) => ({ comparable: true, incompatibilities: [], experiments: references }),
      ...overrides.researchJournal,
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
  const contextDefaults = {
    in_14: "OANDA:USDJPY",
    in_15: "240",
    in_16: "",
    in_17: "",
  };
  return {
    id,
    name: ANALYSIS_OVERLAY_NAME,
    title: ANALYSIS_OVERLAY_NAME,
    inputs: ANALYSIS_OVERLAY_INPUTS.map((input) => ({
      id: input.id,
      name: input.name,
      type: typeof (values[input.id] ?? contextDefaults[input.id] ?? 0),
      value: values[input.id] ?? contextDefaults[input.id] ?? 0,
      defval: 0,
      tooltip: null,
    })),
  };
}

function legacyOverlayStudy(id, values = {}) {
  const study = overlayStudy(id, values);
  const legacyIds = new Set(ANALYSIS_OVERLAY_LEGACY_INPUTS.map((input) => input.id));
  return { ...study, inputs: study.inputs.filter((input) => legacyIds.has(input.id)) };
}

function dueAnalysisRecord(analysisId, symbol, timeframe, expiresAt, latestOutcome = null) {
  const payload = {
    analysisId,
    analyzedAt: "2026-07-01T00:00:00.000Z",
    expiresAt,
    bias: "bullish",
    entryLow: 1.1,
    entryHigh: 1.2,
    confirmation: null,
    invalidation: 0.95,
    stop: 0.9,
    targets: [1.4],
    confidence: 0.6,
    note: "batch test",
    symbol,
    timeframe,
    chartIndex: 0,
    pineId: null,
    pineVersion: null,
    studyId: "journalStudy",
  };
  return {
    definition: {
      schema_version: "1.0",
      event_id: `definition-${analysisId}`,
      sequence: 1,
      recorded_at: "2026-07-01T00:00:00.000Z",
      kind: "analysis_applied",
      analysis_id: analysisId,
      definition_hash: `hash-${analysisId}`,
      payload,
    },
    latestOutcome,
    outcomeCount: latestOutcome === null ? 0 : 1,
    latestAlertLink: null,
    alertLinkCount: 0,
  };
}

function dueBars({ incomplete = false } = {}) {
  const base = Date.parse("2026-07-01T00:00:00.000Z") / 1000;
  if (incomplete) {
    return [{
      time: base + 900,
      timeIso: "2026-07-01T00:15:00.000Z",
      open: 1.1,
      high: 1.2,
      low: 1.05,
      close: 1.15,
      volume: 1,
      forming: false,
    }];
  }
  return [
    { time: base - 900, timeIso: "2026-06-30T23:45:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1, forming: false },
    { time: base, timeIso: "2026-07-01T00:00:00.000Z", open: 1.05, high: 1.2, low: 1.05, close: 1.15, volume: 1, forming: false },
    { time: base + 900, timeIso: "2026-07-01T00:15:00.000Z", open: 1.2, high: 1.45, low: 1.15, close: 1.4, volume: 1, forming: false },
  ];
}

const OUTCOME_PINE_ID = "USER;8f868f366873411aa46bd30872711544";
const OUTCOME_ANALYZED_AT = Date.parse("2026-07-15T12:35:00.000Z");

function outcomeOverlayValues() {
  return {
    in_0: "USDJPY-timeframe-evaluation",
    in_1: OUTCOME_ANALYZED_AT,
    in_2: "bullish",
    in_3: 162.1,
    in_4: 162.24,
    in_5: 0,
    in_6: 161.95,
    in_7: 161.9,
    in_8: 162.6,
    in_9: 162.8,
    in_10: 0,
    in_11: 0.6,
    in_12: Date.parse("2026-07-15T14:00:00.000Z"),
    in_13: "",
  };
}

function outcomeBar(iso, open, high, low, close) {
  return {
    time: Date.parse(iso) / 1000,
    timeIso: iso,
    open,
    high,
    low,
    close,
    volume: null,
  };
}

function outcomeEvidenceBars() {
  return [
    outcomeBar("2026-07-15T12:30:00.000Z", 162.2, 162.3, 162, 162.2),
    outcomeBar("2026-07-15T12:45:00.000Z", 162.2, 162.23, 162.15, 162.2),
    outcomeBar("2026-07-15T13:00:00.000Z", 162.2, 162.65, 162.18, 162.55),
  ];
}

function outcomeTimeframeDeps(state, overrides = {}) {
  return makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "FX",
        activeChartIndex: 1,
        chartsCount: 2,
        charts: [
          { index: 0, symbol: "OANDA:USDJPY", resolution: state.resolution, studies: [] },
          { index: 1, symbol: "OANDA:XAUUSD", resolution: "240", studies: [] },
        ],
      }),
      listPineScripts: async () => [
        {
          pineId: OUTCOME_PINE_ID,
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
        pineId: OUTCOME_PINE_ID,
        name: ANALYSIS_OVERLAY_NAME,
        kind: "study",
        version: "2.0",
        updated: null,
        sourceLength: ANALYSIS_OVERLAY_SOURCE.length,
        source: ANALYSIS_OVERLAY_SOURCE,
      }),
      getIndicatorInputs: async () => [overlayStudy("overlay2", outcomeOverlayValues())],
      getOhlcv: async () => ({
        symbol: "OANDA:USDJPY",
        resolution: state.resolution,
        count: 3,
        bars: outcomeEvidenceBars(),
      }),
      setResolution: async (resolution, chartIndex) => {
        assert.equal(chartIndex, 0);
        state.calls.push(resolution);
        state.resolution = resolution;
        return { symbol: "OANDA:USDJPY", resolution, changed: true, bars: 3 };
      },
      ...overrides,
    },
  });
}

test("exposes exactly the sixty-eight expected tools", async () => {
  const client = await connectedClient(makeDeps());
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "add_pine_to_chart",
      "apply_analysis_overlay",
      "audit_pine_indicator",
      "compare_indicator_observations",
      "compare_strategy_experiments",
      "compute_feature_outcome_relationships",
      "compute_market_features",
      "compute_market_regimes",
      "compute_position_size",
      "compute_round_trip_cost",
      "compute_session_profile",
      "create_analysis_alerts",
      "ensure_analysis_overlay",
      "evaluate_analysis_overlay_outcome",
      "evaluate_due_analyses",
      "get_aligned_history",
      "get_analysis_calibration",
      "get_analysis_journal",
      "get_analysis_overlay_status",
      "get_analysis_overlay_template",
      "get_analysis_performance",
      "get_chart_context",
      "get_chart_screenshot",
      "get_economic_events",
      "get_execution_snapshot",
      "get_futures_flow_context",
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
      "get_replay_status",
      "get_strategy_report",
      "get_strategy_trade_ledger",
      "get_trade_decision_context",
      "get_watchlist",
      "list_alerts",
      "list_pine_scripts",
      "load_more_history",
      "record_strategy_experiment",
      "register_strategy_hypothesis",
      "remove_owned_study",
      "run_backtest",
      "run_backtest_matrix",
      "run_market_event_study",
      "run_strategy_experiment",
      "run_strategy_regime_analysis",
      "run_strategy_regime_matrix",
      "run_strategy_walk_forward",
      "run_yield_price_nonconfirmation_study",
      "save_pine_script",
      "scan_market",
      "set_indicator_input",
      "set_symbol",
      "set_timeframe",
      "start_chart_replay",
      "step_chart_replay",
      "stop_chart_replay",
      "stress_test_strategy",
      "validate_research_protocol",
      "validate_trade_plan",
    ],
  );
});

test("Bar Replay tools preview writes, context-bind start, step, and stop", async () => {
  const calls = [];
  const inactive = {
    available: true,
    toolbarVisible: false,
    started: false,
    ready: false,
    autoplay: false,
    jumpToBarMode: false,
    currentTime: null,
    currentTimeIso: null,
    selectedTime: null,
    selectedTimeIso: null,
    currentResolution: null,
    replayResolutions: [],
    autoResolution: "1D",
    autoplayDelayMs: 1000,
    activeChart: { symbol: "EURUSD", resolution: "1D", index: 0 },
  };
  const client = await connectedClient(makeDeps({
    tv: {
      getReplayStatus: async () => inactive,
      startReplay: async (options) => {
        calls.push(["start", options]);
        return { requestedStartAt: options.startAt, status: { ...inactive, started: true } };
      },
      stepReplay: async (steps) => {
        calls.push(["step", steps]);
        return { requestedSteps: steps, completedSteps: steps, reachedEnd: false };
      },
      stopReplay: async () => {
        calls.push(["stop"]);
        return { changed: true, before: { ...inactive, started: true }, after: inactive };
      },
    },
  }));

  const args = {
    start_at: "2025-01-01T00:00:00.000Z",
    expected_symbol: "EURUSD",
    expected_timeframe: "1D",
  };
  const dryStart = JSON.parse((await client.callTool({ name: "start_chart_replay", arguments: args })).content[0].text);
  assert.equal(dryStart.dryRun, true);
  assert.deepEqual(calls, []);

  const started = JSON.parse((await client.callTool({
    name: "start_chart_replay",
    arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(started.dryRun, false);
  assert.equal(calls[0][0], "start");
  assert.equal(calls[0][1].expectedSymbol, "EURUSD");

  const stepped = JSON.parse((await client.callTool({
    name: "step_chart_replay",
    arguments: { steps: 3 },
  })).content[0].text);
  assert.equal(stepped.completedSteps, 3);
  assert.deepEqual(calls[1], ["step", 3]);

  const dryStop = JSON.parse((await client.callTool({ name: "stop_chart_replay", arguments: {} })).content[0].text);
  assert.equal(dryStop.dryRun, true);
  assert.equal(calls.length, 2);
  const stopped = JSON.parse((await client.callTool({
    name: "stop_chart_replay",
    arguments: { confirm: true },
  })).content[0].text);
  assert.equal(stopped.dryRun, false);
  assert.deepEqual(calls[2], ["stop"]);
});

test("start_chart_replay rejects active-chart binding mismatches without writing", async () => {
  let wrote = false;
  const client = await connectedClient(makeDeps({
    tv: {
      startReplay: async () => { wrote = true; },
    },
  }));
  const result = await client.callTool({
    name: "start_chart_replay",
    arguments: {
      start_at: "2025-01-01T00:00:00.000Z",
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "1D",
      confirm: true,
    },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /does not match expected_symbol/);
  assert.equal(wrote, false);
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

test("validate_research_protocol resolves and audits an exact strategy without chart access", async () => {
  const pineId = "USER;adc40b1dfee344f19412f1ae9af74f3f";
  const hash = (letter) => `sha256:${letter.repeat(64)}`;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => { throw new Error("chart must not be accessed"); },
      getPineSource: async (requestedId, version) => {
        assert.equal(requestedId, pineId);
        assert.equal(version, "3.0");
        const source = "//@version=6\nstrategy('Protocol')\nplot(close)";
        return { pineId, version: "3.0", name: "Protocol", kind: "strategy", updated: null,
          sourceLength: source.length, source };
      },
    },
  }));
  const res = await client.callTool({
    name: "validate_research_protocol",
    arguments: {
      pine_id: pineId,
      pine_version: "3.0",
      candidate_ids: [hash("a"), hash("b")],
      windows: [
        { window_id: "is", population: "in_sample", from: "2025-01-01T00:00:00.000Z", to: "2025-07-01T00:00:00.000Z" },
        { window_id: "oos", population: "out_of_sample", from: "2025-07-02T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
      ],
      minimum_trades: 30,
      observed_trades: 45,
      costs: { spread_pips: 1, slippage_pips_per_side: 0.2, commission_per_round_trip: 10 },
      closed_bars_only: true,
      restart_diff_checked: true,
      definition_frozen_at: "2025-01-01T00:00:00.000Z",
      definition_last_changed_at: "2025-01-01T00:00:00.000Z",
    },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.definition.pineVersion, "3.0");
  assert.equal(parsed.adoptionEligible, true);
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

test("compute_position_size exposes a risk-capped quantity through MCP", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "compute_position_size",
    arguments: {
      symbol: "OANDA:USDJPY",
      account_currency: "JPY",
      account_equity: 1_000_000,
      risk_percent: 1,
      entry_price: 162.4,
      stop_price: 162.2,
      round_trip_cost_price_per_unit: 0.014,
      quantity_step: 1,
      minimum_quantity: 1,
    },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.quantity, 46_728);
  assert.ok(parsed.estimated_loss_at_stop <= parsed.risk_budget);
});

test("validate_trade_plan accepts a fresh cost-adjusted bullish plan", async () => {
  const now = Date.now();
  const client = await connectedClient(makeDeps());
  const result = await client.callTool({
    name: "validate_trade_plan",
    arguments: {
      symbol: "OANDA:USDJPY",
      timeframe: "240",
      analysis_id: "USDJPY-valid-plan",
      analyzed_at: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 2 * 60 * 60_000).toISOString(),
      bias: "bullish",
      entry_low: 162.42,
      entry_high: 162.46,
      confirmation: 162.5,
      invalidation: 162.3,
      stop: 162.24,
      targets: [162.8],
      confidence: 0.6,
      current_price: 162.35,
      market_observed_at: new Date(now - 5_000).toISOString(),
      estimated_round_trip_cost_price: 0.01,
      minimum_risk_reward: 1.5,
      events: [],
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "valid");
  assert.deepEqual(parsed.issues, []);
  assert.ok(parsed.metrics.netRiskRewardToTarget1 >= 1.5);
});

function validTradePlanArguments(now = Date.now()) {
  return {
    symbol: "OANDA:USDJPY",
    timeframe: "240",
    analysis_id: "USDJPY-plan-validation",
    analyzed_at: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 2 * 60 * 60_000).toISOString(),
    bias: "bullish",
    entry_low: 162.42,
    entry_high: 162.46,
    confirmation: 162.5,
    invalidation: 162.3,
    stop: 162.24,
    targets: [162.8],
    confidence: 0.6,
    current_price: 162.35,
    market_observed_at: new Date(now - 5_000).toISOString(),
    estimated_round_trip_cost_price: 0.01,
    minimum_risk_reward: 1.5,
    events: [],
  };
}

test("validate_trade_plan returns structured blocks for invalid levels and expiry", async () => {
  const now = Date.now();
  const client = await connectedClient(makeDeps());
  const invalidLevels = await client.callTool({
    name: "validate_trade_plan",
    arguments: { ...validTradePlanArguments(now), stop: 162.45 },
  });
  assert.notEqual(invalidLevels.isError, true);
  const invalidParsed = JSON.parse(invalidLevels.content[0].text);
  assert.equal(invalidParsed.status, "blocked");
  assert.ok(invalidParsed.issues.some((issue) => issue.code === "stop_or_invalidation_direction_invalid"));

  const expired = await client.callTool({
    name: "validate_trade_plan",
    arguments: {
      ...validTradePlanArguments(now),
      analyzed_at: new Date(now - 3 * 60 * 60_000).toISOString(),
      expires_at: new Date(now - 60 * 60_000).toISOString(),
    },
  });
  const expiredParsed = JSON.parse(expired.content[0].text);
  assert.equal(expiredParsed.status, "blocked");
  assert.ok(expiredParsed.issues.some((issue) => issue.code === "analysis_expired"));

  const bearishInvalid = await client.callTool({
    name: "validate_trade_plan",
    arguments: {
      ...validTradePlanArguments(now),
      bias: "bearish",
      confirmation: 162.3,
      invalidation: 162.55,
      stop: 162.4,
      targets: [162.1],
      current_price: 162.5,
    },
  });
  const bearishParsed = JSON.parse(bearishInvalid.content[0].text);
  assert.equal(bearishParsed.status, "blocked");
  assert.ok(bearishParsed.issues.some((issue) => issue.code === "stop_or_invalidation_direction_invalid"));

  const nonMonotonic = await client.callTool({
    name: "validate_trade_plan",
    arguments: { ...validTradePlanArguments(now), targets: [162.8, 162.7] },
  });
  const nonMonotonicParsed = JSON.parse(nonMonotonic.content[0].text);
  assert.equal(nonMonotonicParsed.status, "blocked");
  assert.ok(nonMonotonicParsed.issues.some((issue) => issue.code === "targets_not_monotonic"));
});

test("validate_trade_plan blocks stale evidence and active event blackouts", async () => {
  const now = Date.now();
  const client = await connectedClient(makeDeps());
  const result = await client.callTool({
    name: "validate_trade_plan",
    arguments: {
      ...validTradePlanArguments(now),
      market_observed_at: new Date(now - 5 * 60_000).toISOString(),
      max_market_age_seconds: 60,
      events: [{
        name: "FOMC decision",
        event_at: new Date(now + 10 * 60_000).toISOString(),
        importance: "high",
        country: "US",
      }],
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.ok(parsed.issues.some((issue) => issue.code === "market_data_stale"));
  assert.ok(parsed.issues.some((issue) => issue.code === "event_blackout_active"));
});

test("validate_trade_plan blocks passed levels and insufficient net risk reward", async () => {
  const now = Date.now();
  const client = await connectedClient(makeDeps());
  const result = await client.callTool({
    name: "validate_trade_plan",
    arguments: {
      ...validTradePlanArguments(now),
      current_price: 162.51,
      targets: [162.6],
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.ok(parsed.issues.some((issue) => issue.code === "confirmation_already_at_or_beyond"));
  assert.ok(parsed.issues.some((issue) => issue.code === "cost_adjusted_rr_below_minimum"));
});

test("validate_trade_plan warns when price left entry but has not reached confirmation", async () => {
  const now = Date.now();
  const client = await connectedClient(makeDeps());
  const result = await client.callTool({
    name: "validate_trade_plan",
    arguments: { ...validTradePlanArguments(now), current_price: 162.48 },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "warning");
  assert.deepEqual(parsed.issues.map((issue) => issue.code), ["entry_zone_currently_passed"]);
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
  assert.equal(template.version, "2.0");
  assert.match(template.source, /entryBox := box\.new/);
  assert.equal(template.inputContract.length, 18);
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
    ANALYSIS_OVERLAY_LEGACY_INPUTS.map((input, index) => [input.id, index + 10]),
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
          studyId === "overlay1"
            ? legacyOverlayStudy(studyId, valuesByStudy.get(studyId))
            : overlayStudy(studyId, valuesByStudy.get(studyId)),
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
  const previewResult = await client.callTool({
    name: "ensure_analysis_overlay",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
    },
  });
  const preview = JSON.parse(previewResult.content[0].text);
  assert.equal(preview.contextBindingRequired, true);
  assert.match(preview.warnings[0], /currently verified chart context/);

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
  assert.deepEqual(valuesByStudy.get("overlay2"), {
    ...oldValues,
    in_14: "OANDA:USDJPY",
    in_15: "240",
    in_16: "",
    in_17: "",
  });
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

test("get_analysis_overlay_status blocks an analysis bound to another symbol", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  let marketReads = 0;
  const analyzedAt = new Date(Date.now() - 30 * 60_000).toISOString();
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
            usedBy: [{ chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" }],
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
            in_0: "EURUSD-on-USDJPY",
            in_1: Date.parse(analyzedAt),
            in_2: "bullish",
            in_3: 1.16,
            in_4: 1.161,
            in_5: 1.162,
            in_6: 1.158,
            in_7: 1.157,
            in_8: 1.165,
            in_9: 0,
            in_10: 0,
            in_11: 0.6,
            in_12: 0,
            in_13: "",
            in_14: "OANDA:EURUSD",
            in_15: "240",
            in_16: "",
            in_17: "",
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
  assert.equal(parsed.status, "stale_context");
  assert.equal(parsed.trusted, false);
  assert.equal(parsed.reason, "analysis_context_mismatch");
  assert.equal(marketReads, 0);
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
    in_14: "OANDA:USDJPY",
    in_15: "15",
    in_16: "",
    in_17: "",
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

test("evaluate_analysis_overlay_outcome evaluates on a temporary timeframe and restores the selected chart", async () => {
  const state = { resolution: "240", calls: [] };
  const client = await connectedClient(outcomeTimeframeDeps(state));
  const result = await client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: {
      pine_id: OUTCOME_PINE_ID,
      chart_index: 0,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      evaluation_timeframe: "15",
    },
  });
  assert.equal(result.isError, undefined, result.content[0].text);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.outcome, "target_before_stop");
  assert.equal(parsed.timeframe, "240");
  assert.equal(parsed.evaluationTimeframe, "15");
  assert.equal(parsed.source.kind, "temporary_evaluation_timeframe_closed_ohlcv");
  assert.equal(parsed.chartState.restored, true);
  assert.equal(parsed.chartState.currentTimeframe, "240");
  assert.deepEqual(state.calls, ["15", "240"]);
});

test("evaluate_analysis_overlay_outcome refuses evidence for an overlay bound to another symbol", async () => {
  const state = { resolution: "240", calls: [] };
  let marketReads = 0;
  const client = await connectedClient(
    outcomeTimeframeDeps(state, {
      getIndicatorInputs: async () => [
        overlayStudy("overlay2", { ...outcomeOverlayValues(), in_14: "OANDA:EURUSD" }),
      ],
      getOhlcv: async () => {
        marketReads += 1;
        return { symbol: "OANDA:USDJPY", resolution: "240", count: 0, bars: [] };
      },
    }),
  );
  const result = await client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: {
      pine_id: OUTCOME_PINE_ID,
      chart_index: 0,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      evaluation_timeframe: "15",
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "stale_context");
  assert.equal(parsed.outcome, "not_evaluable");
  assert.equal(parsed.trusted, false);
  assert.equal(parsed.reason, "analysis_context_mismatch");
  assert.equal(marketReads, 0);
  assert.deepEqual(state.calls, []);
});

test("evaluate_analysis_overlay_outcome records only when explicitly requested", async () => {
  const state = { resolution: "240", calls: [] };
  const deps = outcomeTimeframeDeps(state);
  const recorded = [];
  deps.journal.recordOutcome = async (...args) => {
    recorded.push(args);
    return {
      recorded: true,
      idempotent: false,
      entry: { event_id: "44444444-4444-4444-8444-444444444444" },
    };
  };
  const client = await connectedClient(deps);
  const argumentsBase = {
    pine_id: OUTCOME_PINE_ID,
    chart_index: 0,
    expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "240",
    evaluation_timeframe: "15",
  };

  const readOnly = JSON.parse((await client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: argumentsBase,
  })).content[0].text);
  assert.equal(readOnly.journal.requested, false);
  assert.equal(recorded.length, 0);

  const persisted = JSON.parse((await client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: { ...argumentsBase, record: true },
  })).content[0].text);
  assert.equal(persisted.journal.recorded, true);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0][0], "USDJPY-timeframe-evaluation");
  assert.match(recorded[0][1], /^[0-9a-f]{64}$/);
  assert.equal(recorded[0][2].outcome, "target_before_stop");
  assert.equal(recorded[0][2].evidenceThrough, "2026-07-15T13:00:00.000Z");
});

test("evaluate_analysis_overlay_outcome blocks stale-resolution evidence and still restores the chart", async () => {
  const state = { resolution: "240", calls: [] };
  const client = await connectedClient(
    outcomeTimeframeDeps(state, {
      getOhlcv: async () => ({
        symbol: "OANDA:USDJPY",
        resolution: "240",
        count: 3,
        bars: outcomeEvidenceBars(),
      }),
    }),
  );
  const result = await client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: {
      pine_id: OUTCOME_PINE_ID,
      chart_index: 0,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      evaluation_timeframe: "15",
    },
  });
  assert.equal(result.isError, undefined, result.content[0].text);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.reason, "evaluation_evidence_unavailable");
  assert.match(parsed.detail, /does not match evaluation timeframe/);
  assert.equal(parsed.chartState.restored, true);
  assert.deepEqual(state.calls, ["15", "240"]);
});

test("evaluate_analysis_overlay_outcome preserves the result and reports a restore failure", async () => {
  const state = { resolution: "240", calls: [] };
  const client = await connectedClient(
    outcomeTimeframeDeps(state, {
      setResolution: async (resolution, chartIndex) => {
        assert.equal(chartIndex, 0);
        state.calls.push(resolution);
        if (resolution === "240") throw new Error("restore refused");
        state.resolution = resolution;
        return { symbol: "OANDA:USDJPY", resolution, changed: true, bars: 3 };
      },
    }),
  );
  const result = await client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: {
      pine_id: OUTCOME_PINE_ID,
      chart_index: 0,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      evaluation_timeframe: "15",
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.outcome, "target_before_stop");
  assert.equal(parsed.chartState.restored, false);
  assert.equal(parsed.chartState.currentTimeframe, "15");
  assert.match(parsed.chartState.restoreError, /restore refused/);
  assert.ok(parsed.qualityIssues.includes("chart_timeframe_restore_failed"));
});

test("temporary outcome evaluation serializes a concurrent set_timeframe operation", async () => {
  const state = { resolution: "240", calls: [] };
  let signalSwitchStarted;
  let releaseSwitch;
  const switchStarted = new Promise((resolve) => { signalSwitchStarted = resolve; });
  const switchGate = new Promise((resolve) => { releaseSwitch = resolve; });
  const client = await connectedClient(
    outcomeTimeframeDeps(state, {
      setResolution: async (resolution, chartIndex) => {
        state.calls.push(resolution);
        if (resolution === "15") {
          assert.equal(chartIndex, 0);
          signalSwitchStarted();
          await switchGate;
        }
        state.resolution = resolution;
        return { symbol: "OANDA:USDJPY", resolution, changed: true, bars: 3 };
      },
    }),
  );
  const evaluation = client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: {
      pine_id: OUTCOME_PINE_ID,
      chart_index: 0,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240",
      evaluation_timeframe: "15",
    },
  });
  await switchStarted;
  const contextRead = client.callTool({
    name: "get_chart_context",
    arguments: {},
  });
  const timeframeChange = client.callTool({
    name: "set_timeframe",
    arguments: { resolution: "60" },
  });
  releaseSwitch();
  const [, contextResult] = await Promise.all([evaluation, contextRead, timeframeChange]);
  const context = JSON.parse(contextResult.content[0].text);
  assert.equal(context.charts[0].resolution, "240");
  assert.deepEqual(state.calls, ["15", "240", "60"]);
});

test("evaluate_due_analyses previews, restores multiple symbols, records non-guessed outcomes, and retries idempotently", async () => {
  const records = [
    dueAnalysisRecord("EURUSD-due", "OANDA:EURUSD", "15", "2026-07-01T01:00:00.000Z"),
    dueAnalysisRecord("XAUUSD-month", "OANDA:XAUUSD", "M", "2026-07-01T02:00:00.000Z"),
  ];
  const state = { symbol: "OANDA:USDJPY", resolution: "240", changes: [], recorded: new Set() };
  const context = async () => ({
    layoutName: "batch",
    activeChartIndex: 0,
    chartsCount: 1,
    charts: [{ index: 0, symbol: state.symbol, resolution: state.resolution, studies: [] }],
  });
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: context,
      setSymbol: async (symbol, chartIndex) => {
        assert.equal(chartIndex, 0);
        state.changes.push(["symbol", symbol]);
        state.symbol = symbol;
        return { symbol, resolution: state.resolution, changed: true, bars: 10 };
      },
      setResolution: async (resolution, chartIndex) => {
        assert.equal(chartIndex, 0);
        state.changes.push(["timeframe", resolution]);
        state.resolution = resolution;
        return { symbol: state.symbol, resolution, changed: true, bars: 10 };
      },
      getOhlcv: async () => ({
        symbol: state.symbol,
        resolution: state.resolution,
        count: 3,
        bars: state.symbol === "OANDA:EURUSD" ? dueBars({ incomplete: true }) : dueBars(),
      }),
    },
    journal: {
      list: async () => ({ total: records.length, returned: records.length, analyses: records }),
      recordOutcome: async (analysisId, _hash, value) => {
        const key = `${analysisId}:${value.status}:${value.outcome}:${value.evidenceTimeframe}:${value.evidenceThrough}`;
        const idempotent = state.recorded.has(key);
        state.recorded.add(key);
        return {
          recorded: !idempotent,
          idempotent,
          entry: { event_id: `outcome-${analysisId}`, payload: value },
        };
      },
    },
  }));
  const args = { chart_index: 0 };
  const dry = JSON.parse((await client.callTool({ name: "evaluate_due_analyses", arguments: args })).content[0].text);
  assert.equal(dry.status, "preview");
  assert.equal(dry.preview.selected, 2);
  assert.deepEqual(state.changes, []);

  const first = JSON.parse((await client.callTool({
    name: "evaluate_due_analyses",
    arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(first.status, "complete");
  assert.equal(first.processed, 2);
  assert.equal(first.results[0].result.status, "incomplete");
  assert.equal(first.results[1].result.outcome, "calendar_month_resolution_unsupported");
  assert.deepEqual([state.symbol, state.resolution], ["OANDA:USDJPY", "240"]);

  const repeated = JSON.parse((await client.callTool({
    name: "evaluate_due_analyses",
    arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(repeated.status, "complete");
  assert.equal(repeated.results[0].journal.idempotent, true);
  assert.deepEqual([state.symbol, state.resolution], ["OANDA:USDJPY", "240"]);
});

test("evaluate_due_analyses continues after one evaluation failure", async () => {
  const records = [
    dueAnalysisRecord("EURUSD-fails", "OANDA:EURUSD", "15", "2026-07-01T01:00:00.000Z"),
    dueAnalysisRecord("XAUUSD-continues", "OANDA:XAUUSD", "15", "2026-07-01T02:00:00.000Z"),
  ];
  const state = { symbol: "OANDA:USDJPY", resolution: "240" };
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "batch", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: state.symbol, resolution: state.resolution, studies: [] }],
      }),
      setSymbol: async (symbol) => ((state.symbol = symbol), { symbol, resolution: state.resolution, changed: true, bars: 10 }),
      setResolution: async (resolution) => ((state.resolution = resolution), { symbol: state.symbol, resolution, changed: true, bars: 10 }),
      getOhlcv: async () => {
        if (state.symbol === "OANDA:EURUSD") throw new Error("EURUSD feed unavailable");
        return { symbol: state.symbol, resolution: state.resolution, count: 3, bars: dueBars() };
      },
    },
    journal: {
      list: async () => ({ total: 2, returned: 2, analyses: records }),
    },
  }));
  const result = JSON.parse((await client.callTool({
    name: "evaluate_due_analyses",
    arguments: { chart_index: 0, confirm: true },
  })).content[0].text);
  assert.equal(result.status, "partial");
  assert.equal(result.processed, 2);
  assert.equal(result.results[0].status, "failed");
  assert.equal(result.results[1].status, "evaluated");
  assert.deepEqual([state.symbol, state.resolution], ["OANDA:USDJPY", "240"]);
});

test("evaluate_due_analyses aborts remaining work when chart restoration fails", async () => {
  const records = [
    dueAnalysisRecord("EURUSD-restore", "OANDA:EURUSD", "15", "2026-07-01T01:00:00.000Z"),
    dueAnalysisRecord("XAUUSD-unprocessed", "OANDA:XAUUSD", "15", "2026-07-01T02:00:00.000Z"),
  ];
  const state = { symbol: "OANDA:USDJPY", resolution: "240" };
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "batch", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: state.symbol, resolution: state.resolution, studies: [] }],
      }),
      setSymbol: async (symbol) => {
        if (symbol === "OANDA:USDJPY") throw new Error("restore refused");
        state.symbol = symbol;
        return { symbol, resolution: state.resolution, changed: true, bars: 10 };
      },
      setResolution: async (resolution) => ((state.resolution = resolution), { symbol: state.symbol, resolution, changed: true, bars: 10 }),
      getOhlcv: async () => ({ symbol: state.symbol, resolution: state.resolution, count: 3, bars: dueBars() }),
    },
    journal: {
      list: async () => ({ total: 2, returned: 2, analyses: records }),
    },
  }));
  const result = JSON.parse((await client.callTool({
    name: "evaluate_due_analyses",
    arguments: { chart_index: 0, confirm: true },
  })).content[0].text);
  assert.equal(result.status, "aborted");
  assert.equal(result.processed, 1);
  assert.equal(result.remaining, 1);
  assert.equal(result.results[0].result.chartState.restored, false);
});

test("get_analysis_performance aggregates journal path metrics without chart access", async () => {
  let chartRead = false;
  const record = dueAnalysisRecord(
    "EURUSD-performance",
    "OANDA:EURUSD",
    "60",
    "2026-07-01T01:00:00.000Z",
  );
  record.latestOutcome = {
    schema_version: "1.0",
    event_id: "performance-outcome",
    sequence: 2,
    recorded_at: "2026-07-01T02:00:00.000Z",
    kind: "outcome_evaluated",
    analysis_id: record.definition.analysis_id,
    definition_hash: record.definition.definition_hash,
    payload: {
      status: "complete",
      outcome: "target_before_stop",
      evaluatedAt: "2026-07-01T02:00:00.000Z",
      evidenceTimeframe: "15",
      evidenceThrough: "2026-07-01T00:45:00.000Z",
      result: {
        performance: {
          methodologyVersion: "1.0",
          structuralRiskPrice: 0.01,
          grossRealizedR: 2,
          excursion: { mfeR: 2.5, maeR: 0.4 },
          timing: { analyzedToEntryMs: 60_000, entryToConfirmationMs: null, activationToTerminalMs: 120_000 },
        },
      },
    },
  };
  const client = await connectedClient(makeDeps({
    tv: { getChartContext: async () => ((chartRead = true), { charts: [] }) },
    journal: { list: async () => ({ total: 1, returned: 1, analyses: [record] }) },
  }));
  const result = JSON.parse((await client.callTool({
    name: "get_analysis_performance",
    arguments: {
      group_by: "symbol",
      cost_assumptions: [{ symbol: "OANDA:EURUSD", total_price_per_unit: 0.001 }],
    },
  })).content[0].text);
  assert.equal(result.groups[0].key, "OANDA:EURUSD");
  assert.equal(result.groups[0].binary.winRate, 1);
  assert.ok(Math.abs(result.groups[0].rMultiples.meanNetRealizedR - 1.9) < 1e-9);
  assert.equal(chartRead, false);
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
  let journalFailure = null;
  const journaled = [];
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
      journal: {
        recordAnalysis: async (definition) => {
          if (journalFailure) throw journalFailure;
          journaled.push(definition);
          return {
            recorded: true,
            idempotent: false,
            entry: { event_id: "33333333-3333-4333-8333-333333333333" },
          };
        },
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
    snapshot_id: "67fa3a10-fdf7-47ac-a4f7-9a3047545930",
    strategy_version: "Bushido-2026.07",
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
  assert.equal(applied.journal.recorded, true);
  assert.equal(journaled[0].analysisId, args.analysis_id);
  assert.equal(journaled[0].symbol, "OANDA:USDJPY");
  assert.equal(journaled[0].analysisSymbol, "OANDA:USDJPY");
  assert.equal(journaled[0].analysisTimeframe, "240");
  assert.equal(journaled[0].snapshotId, args.snapshot_id);
  assert.equal(journaled[0].strategyVersion, args.strategy_version);
  assert.equal(values.in_14, "OANDA:USDJPY");
  assert.equal(values.in_15, "240");

  journalFailure = new Error("journal disk unavailable");
  const appliedWithoutJournal = JSON.parse((await client.callTool({
    name: "apply_analysis_overlay",
    arguments: { ...args, analysis_id: `${args.analysis_id}-retry`, confirm: true },
  })).content[0].text);
  assert.equal(appliedWithoutJournal.applied, true);
  assert.equal(appliedWithoutJournal.verified, true);
  assert.equal(appliedWithoutJournal.journal.recorded, false);
  assert.match(appliedWithoutJournal.journal.error, /journal disk unavailable/);
  assert.equal(appliedWithoutJournal.journal.reason, "journal_write_failed");
  assert.ok(appliedWithoutJournal.warnings.some((warning) => warning.includes("journal write failed")));

  journalFailure = new AnalysisDefinitionConflictError(args.analysis_id);
  const appliedWithConflict = JSON.parse((await client.callTool({
    name: "apply_analysis_overlay",
    arguments: { ...args, confidence: 0.71, confirm: true },
  })).content[0].text);
  assert.equal(appliedWithConflict.applied, true);
  assert.equal(appliedWithConflict.journal.reason, "analysis_id_definition_conflict");
  assert.match(appliedWithConflict.journal.remediation, /new analysis_id/);
  assert.doesNotMatch(appliedWithConflict.journal.remediation, /retry idempotently/);
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

test("get_strategy_trade_ledger exposes stable bounded pages", async () => {
  const client = await connectedClient(makeDeps());
  const ledgerId = `sha256:${"a".repeat(64)}`;
  const res = await client.callTool({
    name: "get_strategy_trade_ledger",
    arguments: { offset: 20, limit: 100, expected_ledger_id: ledgerId },
  });
  const ledger = JSON.parse(res.content[0].text);
  assert.equal(ledger.ledgerId, ledgerId);
  assert.equal(ledger.trades[0].status, "closed");
  assert.deepEqual(ledger.options, {
    offset: 20,
    limit: 100,
    expectedLedgerId: ledgerId,
  });
});

test("run_strategy_experiment previews, compares full ledgers, and cleans both variants", async () => {
  const baselineId = "USER;baseline123";
  const candidateId = "USER;candidate123";
  let activePine = null;
  let runCount = 0;
  const removed = [];
  const requestedInputs = new Map();
  const profits = {
    [baselineId]: [10, -5],
    [candidateId]: [20, 30],
  };
  const ledger = (pineId) => {
    const trades = profits[pineId].map((profit, reportIndex) => ({
      reportIndex,
      number: null,
      direction: "long",
      status: "closed",
      entry: null,
      exit: null,
      durationMilliseconds: 1000,
      profit,
      profitPercent: null,
      cumulativeProfit: null,
      quantity: 1,
      commission: 1,
      commissionPercent: null,
      runUp: profit + 10,
      runUpPercent: null,
      drawDown: 2,
      drawDownPercent: null,
    }));
    return {
      schemaVersion: "1.0",
      ledgerId: `sha256:${(pineId === baselineId ? "a" : "b").repeat(64)}`,
      strategy: pineId,
      symbol: "OANDA:USDJPY",
      timeframe: "240",
      studyId: "temporary",
      pineId,
      pineVersion: "1.0",
      inputs: [
        { id: "in_cost", name: "Commission Value", value: 0.01 },
        ...(requestedInputs.get(pineId) ?? []),
      ],
      currency: "JPY",
      initialCapital: 1000000,
      dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
      summary: { totalTrades: 2 },
      totalTrades: 2,
      availableTrades: 2,
      countMatchesSummary: true,
      ordering: "strategy_report",
      offset: 0,
      limit: 500,
      returned: 2,
      nextOffset: null,
      complete: true,
      unavailableFields: [],
      qualityIssues: [],
      trades,
    };
  };
  const deps = makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [{ id: "original", name: "RSI" }] }],
      }),
      listPineScripts: async () => [
        { pineId: baselineId, name: "Baseline", kind: "strategy", version: "1.0", usedBy: [] },
        { pineId: candidateId, name: "Candidate", kind: "strategy", version: "1.0", usedBy: [] },
      ],
      runBacktest: async ({ pineId, keepOnChart }) => {
        runCount += 1;
        activePine = pineId;
        return {
          pineId,
          studyId: keepOnChart ? `temporary-${runCount}` : null,
          keptOnChart: keepOnChart,
          removedFromChart: false,
          strategy: pineId,
          currency: "JPY",
          initialCapital: 1000000,
          dateRange: null,
          summary: {},
          totalTrades: 2,
          trades: [],
        };
      },
      setIndicatorInput: async (studyId, inputs) => {
        requestedInputs.set(activePine, inputs.map((input) => ({ ...input, name: input.id })));
        return { studyId, applied: inputs, settled: true };
      },
      getStrategyReport: async () => ({
        strategy: activePine,
        currency: "JPY",
        initialCapital: 1000000,
        dateRange: null,
        summary: {
          netProfit: profits[activePine].reduce((sum, value) => sum + value, 0),
          profitFactor: activePine === baselineId ? 1.1 : 1.8,
        },
        totalTrades: 2,
        trades: [],
      }),
      getStrategyTradeLedger: async () => ledger(activePine),
      removePineFromChart: async (pineId, studyId) => {
        removed.push({ pineId, studyId });
        activePine = null;
        return { removed: true, pineId, pineVersion: "1.0", studyId, name: pineId, chartIndex: null };
      },
    },
  });
  const client = await connectedClient(deps);
  const args = {
    expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "240",
    baseline: { pine_id: baselineId },
    candidate: { pine_id: candidateId, inputs: [{ id: "in_0", value: 7 }] },
    minimum_trades: 2,
  };
  const dry = JSON.parse((await client.callTool({ name: "run_strategy_experiment", arguments: args })).content[0].text);
  assert.equal(dry.dryRun, true);
  assert.equal(runCount, 0, "dry-run must not add a strategy");

  const result = JSON.parse((await client.callTool({
    name: "run_strategy_experiment",
    arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(result.status, "complete");
  assert.equal(result.comparisonStatus, "eligible");
  assert.equal(result.comparison.expectancy.delta, 22.5);
  assert.equal(result.chartState.restored, true);
  assert.equal(removed.length, 2);
  assert.match(result.baseline.ledgerId, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.candidate.ledgerId, /^sha256:[a-f0-9]{64}$/);
});

test("run_strategy_experiment preserves baseline evidence when the candidate fails", async () => {
  const baselineId = "USER;baseline999";
  const candidateId = "USER;candidate999";
  let activePine = null;
  const removed = [];
  const deps = makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
      }),
      listPineScripts: async () => [
        { pineId: baselineId, name: "Baseline", kind: "strategy", version: "1.0", usedBy: [] },
        { pineId: candidateId, name: "Candidate", kind: "strategy", version: "1.0", usedBy: [] },
      ],
      runBacktest: async ({ pineId }) => {
        activePine = pineId;
        return { pineId, studyId: `temp-${pineId}`, keptOnChart: true, removedFromChart: false, strategy: pineId, currency: "JPY", initialCapital: null, dateRange: null, summary: {}, totalTrades: 1, trades: [] };
      },
      getStrategyReport: async () => {
        if (activePine === candidateId) throw new Error("candidate calculation failed");
        return { strategy: activePine, currency: "JPY", initialCapital: null, dateRange: null, summary: { netProfit: 1 }, totalTrades: 1, trades: [] };
      },
      getStrategyTradeLedger: async () => ({
        schemaVersion: "1.0", ledgerId: `sha256:${"c".repeat(64)}`, strategy: activePine,
        symbol: "OANDA:USDJPY", timeframe: "240", studyId: "temp", pineId: activePine,
        pineVersion: "1.0", inputs: [], currency: "JPY", initialCapital: null, dateRange: null,
        summary: { totalTrades: 1 }, totalTrades: 1, availableTrades: 1, countMatchesSummary: true,
        ordering: "strategy_report", offset: 0, limit: 500, returned: 1, nextOffset: null,
        complete: true, unavailableFields: [], qualityIssues: [],
        trades: [{ reportIndex: 0, number: null, direction: "long", status: "closed", entry: null,
          exit: null, durationMilliseconds: 1, profit: 1, profitPercent: null, cumulativeProfit: 1,
          quantity: 1, commission: null, commissionPercent: null, runUp: null, runUpPercent: null,
          drawDown: null, drawDownPercent: null }],
      }),
      removePineFromChart: async (pineId, studyId) => {
        removed.push(pineId);
        activePine = null;
        return { removed: true, pineId, pineVersion: "1.0", studyId, name: pineId, chartIndex: null };
      },
    },
  });
  const client = await connectedClient(deps);
  const result = JSON.parse((await client.callTool({
    name: "run_strategy_experiment",
    arguments: {
      expected_symbol: "OANDA:USDJPY", expected_timeframe: "240", minimum_trades: 1, confirm: true,
      baseline: { pine_id: baselineId }, candidate: { pine_id: candidateId },
    },
  })).content[0].text);
  assert.equal(result.status, "partial");
  assert.equal(result.baseline.summary.metrics.netProfit, 1);
  assert.match(result.candidate.error, /candidate calculation failed/);
  assert.deepEqual(removed, [baselineId, candidateId]);
  assert.equal(result.chartState.restored, true);
});

test("run_backtest_matrix previews, runs serial jobs, isolates failures, and restores the chart", async () => {
  const pineId = "USER;matrixstrategy123";
  const chart = { symbol: "OANDA:USDJPY", resolution: "240" };
  let activePine = null;
  let runCount = 0;
  const runs = [];
  const removed = [];
  const profits = { "OANDA:USDJPY": 10, "OANDA:XAUUSD": 30 };
  const context = () => ({
    layoutName: "test",
    activeChartIndex: 0,
    chartsCount: 1,
    charts: [{
      index: 0,
      symbol: chart.symbol,
      resolution: chart.resolution,
      studies: [{ id: "original", name: "RSI" }],
    }],
  });
  const deps = makeDeps({
    tv: {
      getChartContext: async () => context(),
      setSymbol: async (symbol) => {
        chart.symbol = symbol;
        return { symbol, resolution: chart.resolution, bars: 100 };
      },
      setResolution: async (resolution) => {
        chart.resolution = resolution;
        return { symbol: chart.symbol, resolution, bars: 100 };
      },
      listPineScripts: async () => [
        { pineId, name: "Matrix Strategy", kind: "strategy", version: "4.0", usedBy: [] },
      ],
      runBacktest: async ({ pineId: requested, keepOnChart }) => {
        runCount += 1;
        activePine = requested;
        runs.push({ symbol: chart.symbol, timeframe: chart.resolution });
        return {
          pineId: requested,
          studyId: keepOnChart ? `matrix-${runCount}` : null,
          keptOnChart: keepOnChart,
          removedFromChart: false,
          strategy: requested,
          currency: "JPY",
          initialCapital: 1000000,
          dateRange: null,
          summary: {},
          totalTrades: 1,
          trades: [],
        };
      },
      setIndicatorInput: async (studyId, inputs) => ({ studyId, applied: inputs, settled: true }),
      getStrategyReport: async () => {
        if (chart.symbol === "OANDA:EURUSD") throw new Error("EURUSD calculation failed");
        return {
          strategy: activePine,
          currency: "JPY",
          initialCapital: 1000000,
          dateRange: null,
          summary: { netProfit: profits[chart.symbol], profitFactor: 1.5 },
          totalTrades: 1,
          trades: [],
        };
      },
      getStrategyTradeLedger: async () => ({
        schemaVersion: "1.0",
        ledgerId: `sha256:${(chart.symbol === "OANDA:USDJPY" ? "a" : "b").repeat(64)}`,
        strategy: activePine,
        symbol: chart.symbol,
        timeframe: chart.resolution,
        studyId: "temporary",
        pineId: activePine,
        pineVersion: "4.0",
        inputs: [{ id: "cost", name: "Commission Value", value: 0.01 }],
        currency: "JPY",
        initialCapital: 1000000,
        dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
        summary: { totalTrades: 1 },
        totalTrades: 1,
        availableTrades: 1,
        countMatchesSummary: chart.symbol !== "OANDA:XAUUSD",
        ordering: "strategy_report",
        offset: 0,
        limit: 500,
        returned: 1,
        nextOffset: null,
        complete: true,
        unavailableFields: [],
        qualityIssues: [],
        trades: [{ reportIndex: 0, number: null, direction: "long", status: "closed", entry: null,
          exit: null, durationMilliseconds: 1000, profit: profits[chart.symbol], profitPercent: null,
          cumulativeProfit: profits[chart.symbol], quantity: 1, commission: 0.01, commissionPercent: null,
          runUp: 20, runUpPercent: null, drawDown: 5, drawDownPercent: null }],
      }),
      removePineFromChart: async (requested, studyId) => {
        removed.push({ pineId: requested, studyId });
        activePine = null;
        return { removed: true, pineId: requested, pineVersion: "4.0", studyId,
          name: "Matrix Strategy", chartIndex: 0 };
      },
    },
  });
  const client = await connectedClient(deps);
  const args = {
    expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "240",
    minimum_trades: 1,
    jobs: [
      { symbol: "OANDA:USDJPY", timeframe: "240", pine_id: pineId },
      { symbol: "OANDA:EURUSD", timeframe: "15", pine_id: pineId },
      { symbol: "OANDA:XAUUSD", timeframe: "30", pine_id: pineId, inputs: [{ id: "length", value: 20 }] },
    ],
  };
  const dry = JSON.parse((await client.callTool({ name: "run_backtest_matrix", arguments: args })).content[0].text);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.jobCount, 3);
  assert.equal(runCount, 0);
  assert.deepEqual(chart, { symbol: "OANDA:USDJPY", resolution: "240" });

  const result = JSON.parse((await client.callTool({
    name: "run_backtest_matrix",
    arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.results.map((row) => row.status), ["complete", "failed", "complete"]);
  assert.match(result.results[1].error, /EURUSD calculation failed/);
  assert.equal(result.results[2].summary.metrics.netProfit, 30);
  assert.equal(result.jobsWithQualityIssues, 1);
  assert.ok(result.qualityIssues.includes("one_or_more_jobs_have_quality_issues"));
  assert.equal(result.chartState.restored, true);
  assert.deepEqual(runs, [
    { symbol: "OANDA:USDJPY", timeframe: "240" },
    { symbol: "OANDA:EURUSD", timeframe: "15" },
    { symbol: "OANDA:XAUUSD", timeframe: "30" },
  ]);
  assert.equal(removed.length, 3);
  assert.deepEqual(chart, { symbol: "OANDA:USDJPY", resolution: "240" });
});

test("run_backtest_matrix stops remaining jobs after a chart restore failure", async () => {
  const pineId = "USER;matrixrestore123";
  const chart = { symbol: "OANDA:USDJPY", resolution: "240" };
  let activePine = null;
  let runCount = 0;
  const deps = makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: chart.symbol, resolution: chart.resolution, studies: [] }],
      }),
      setSymbol: async (symbol) => {
        if (symbol === "OANDA:USDJPY" && chart.symbol !== symbol) throw new Error("restore blocked");
        chart.symbol = symbol;
        return { symbol, resolution: chart.resolution, bars: 100 };
      },
      setResolution: async (resolution) => {
        chart.resolution = resolution;
        return { symbol: chart.symbol, resolution, bars: 100 };
      },
      listPineScripts: async () => [
        { pineId, name: "Restore Strategy", kind: "strategy", version: "1.0", usedBy: [] },
      ],
      runBacktest: async ({ pineId: requested }) => {
        runCount += 1;
        activePine = requested;
        return { pineId: requested, studyId: `restore-${runCount}`, keptOnChart: true,
          removedFromChart: false, strategy: requested, currency: "JPY", initialCapital: null,
          dateRange: null, summary: {}, totalTrades: 1, trades: [] };
      },
      getStrategyReport: async () => ({
        strategy: activePine, currency: "JPY", initialCapital: null, dateRange: null,
        summary: { netProfit: 1 }, totalTrades: 1, trades: [],
      }),
      getStrategyTradeLedger: async () => ({
        schemaVersion: "1.0", ledgerId: `sha256:${"d".repeat(64)}`, strategy: activePine,
        symbol: chart.symbol, timeframe: chart.resolution, studyId: "temporary", pineId: activePine,
        pineVersion: "1.0", inputs: [], currency: "JPY", initialCapital: null, dateRange: null,
        summary: { totalTrades: 1 }, totalTrades: 1, availableTrades: 1, countMatchesSummary: true,
        ordering: "strategy_report", offset: 0, limit: 500, returned: 1, nextOffset: null,
        complete: true, unavailableFields: [], qualityIssues: [],
        trades: [{ reportIndex: 0, number: null, direction: "long", status: "closed", entry: null,
          exit: null, durationMilliseconds: 1, profit: 1, profitPercent: null, cumulativeProfit: 1,
          quantity: 1, commission: null, commissionPercent: null, runUp: null, runUpPercent: null,
          drawDown: null, drawDownPercent: null }],
      }),
      removePineFromChart: async (requested, studyId) => {
        activePine = null;
        return { removed: true, pineId: requested, pineVersion: "1.0", studyId,
          name: "Restore Strategy", chartIndex: 0 };
      },
    },
  });
  const client = await connectedClient(deps);
  const result = JSON.parse((await client.callTool({
    name: "run_backtest_matrix",
    arguments: {
      expected_symbol: "OANDA:USDJPY", expected_timeframe: "240", minimum_trades: 1, confirm: true,
      jobs: [
        { symbol: "OANDA:EURUSD", timeframe: "15", pine_id: pineId },
        { symbol: "OANDA:XAUUSD", timeframe: "30", pine_id: pineId },
      ],
    },
  })).content[0].text);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.results.map((row) => row.status), ["restore_failed", "skipped"]);
  assert.match(result.results[0].error, /restore blocked/);
  assert.match(result.results[1].error, /chart restore failed/);
  assert.equal(runCount, 1);
  assert.equal(result.chartState.restored, false);
});

test("run_strategy_walk_forward selects on train, exposes selected OOS only, and restores", async () => {
  const pineId = "USER;walkforward123";
  let activeLength = null;
  let runCount = 0;
  const removed = [];
  const context = () => ({
    layoutName: "test", activeChartIndex: 0, chartsCount: 1,
    charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240",
      studies: [{ id: "original", name: "RSI" }] }],
  });
  const profits = {
    5: { 2020: [2, -1], 2021: [3, -1], 2022: [4, -1], 2023: [5, -1] },
    10: { 2020: [1, -2], 2021: [1, -2], 2022: [100, -1], 2023: [100, -1] },
  };
  const ledgerFor = (length) => {
    const trades = Object.entries(profits[length]).flatMap(([year, values]) => values.map((profit, index) => {
      const entryTime = Date.UTC(Number(year), 1, 1 + index);
      return {
        reportIndex: Number(year) * 100 + index, number: null, direction: "long", status: "closed",
        entry: { time: entryTime, timeIso: new Date(entryTime).toISOString(), price: 1, label: null },
        exit: { time: entryTime + 3_600_000, timeIso: new Date(entryTime + 3_600_000).toISOString(),
          price: 1, label: null },
        durationMilliseconds: 3_600_000, profit, profitPercent: null, cumulativeProfit: null,
        quantity: 1, commission: 0.01, commissionPercent: null, runUp: Math.max(profit, 0) + 1,
        runUpPercent: null, drawDown: Math.max(-profit, 0) + 1, drawDownPercent: null,
      };
    }));
    return {
      schemaVersion: "1.0", ledgerId: `sha256:${(length === 5 ? "a" : "b").repeat(64)}`,
      strategy: "Walk Forward", symbol: "OANDA:USDJPY", timeframe: "240", studyId: "temporary",
      pineId, pineVersion: "1.0",
      inputs: [{ id: "commission", name: "Commission Value", value: 0.01 },
        { id: "length", name: "Length", value: length }],
      currency: "JPY", initialCapital: 1000000,
      dateRange: { from: "2020-01-01T00:00:00.000Z", to: "2025-01-01T00:00:00.000Z" },
      summary: { totalTrades: trades.length }, totalTrades: trades.length, availableTrades: trades.length,
      countMatchesSummary: true, ordering: "strategy_report", offset: 0, limit: 500,
      returned: trades.length, nextOffset: null, complete: true, unavailableFields: [], qualityIssues: [], trades,
    };
  };
  const deps = makeDeps({
    tv: {
      getChartContext: async () => context(),
      listPineScripts: async () => [
        { pineId, name: "Walk Forward", kind: "strategy", version: "1.0", usedBy: [] },
      ],
      runBacktest: async ({ pineId: requested }) => {
        runCount += 1;
        activeLength = null;
        return { pineId: requested, studyId: `walk-${runCount}`, keptOnChart: true,
          removedFromChart: false, strategy: "Walk Forward", currency: "JPY", initialCapital: 1000000,
          dateRange: null, summary: {}, totalTrades: 8, trades: [] };
      },
      setIndicatorInput: async (studyId, inputs) => {
        activeLength = inputs.find((input) => input.id === "length").value;
        return { studyId, applied: inputs, settled: true };
      },
      getStrategyReport: async () => ({
        strategy: "Walk Forward", currency: "JPY", initialCapital: 1000000,
        dateRange: null, summary: { netProfit: 1 }, totalTrades: 8, trades: [],
      }),
      getStrategyTradeLedger: async () => ledgerFor(activeLength),
      removePineFromChart: async (requested, studyId) => {
        removed.push({ requested, studyId });
        return { removed: true, pineId: requested, pineVersion: "1.0", studyId,
          name: "Walk Forward", chartIndex: 0 };
      },
    },
  });
  const client = await connectedClient(deps);
  const args = {
    expected_symbol: "OANDA:USDJPY", expected_timeframe: "240", mode: "anchored",
    minimum_train_trades: 2, minimum_test_trades: 2, selection_metric: "expectancy",
    candidates: [
      { pine_id: pineId, inputs: [{ id: "length", value: 5 }] },
      { pine_id: pineId, inputs: [{ id: "length", value: 10 }] },
    ],
    folds: [
      { fold_id: "f1", train_from: "2020-01-01T00:00:00.000Z",
        train_to: "2021-12-31T00:00:00.000Z", test_from: "2022-01-01T00:00:00.000Z",
        test_to: "2022-12-31T00:00:00.000Z" },
      { fold_id: "f2", train_from: "2020-01-01T00:00:00.000Z",
        train_to: "2022-12-31T00:00:00.000Z", test_from: "2023-01-01T00:00:00.000Z",
        test_to: "2023-12-31T00:00:00.000Z" },
    ],
  };
  const dry = JSON.parse((await client.callTool({ name: "run_strategy_walk_forward", arguments: args })).content[0].text);
  assert.equal(dry.dryRun, true);
  assert.equal(runCount, 0);
  assert.equal(dry.execution.nonSelectedOosMetricsExposed, false);

  const result = JSON.parse((await client.callTool({ name: "run_strategy_walk_forward",
    arguments: { ...args, confirm: true } })).content[0].text);
  assert.equal(result.status, "complete");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.evaluation.folds[0].selection.status, "selected");
  assert.equal(result.evaluation.folds[0].test.evidence.metrics.totalTrades, 2);
  assert.equal(result.evaluation.folds[0].test.candidateId,
    result.evaluation.folds[0].selection.candidateId);
  assert.equal(result.evaluation.oosAggregate.evaluableFolds, 2);
  assert.equal(result.chartState.restored, true);
  assert.equal(runCount, 2);
  assert.equal(removed.length, 2);
});

test("stress_test_strategy previews, evaluates a complete ledger, and restores", async () => {
  const pineId = "USER;stresstest12345";
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
    charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240",
      studies: [{ id: "original", name: "RSI" }] }] });
  const trades = [100, -50, 80, -20].map((profit, index) => {
    const entryTime = Date.UTC(2025, 0, 2 + index);
    return { reportIndex: index, number: index + 1, direction: "long", status: "closed",
      entry: { time: entryTime, timeIso: new Date(entryTime).toISOString(), price: 1, label: null },
      exit: { time: entryTime + 3_600_000, timeIso: new Date(entryTime + 3_600_000).toISOString(), price: 1, label: null },
      durationMilliseconds: 3_600_000, profit, profitPercent: null, cumulativeProfit: null,
      quantity: 1, commission: 5, commissionPercent: null, runUp: null, runUpPercent: null,
      drawDown: null, drawDownPercent: null };
  });
  let runs = 0;
  let removes = 0;
  let entryDelay = 0;
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    listPineScripts: async () => [{ pineId, name: "Stress", kind: "strategy", version: "3.0", usedBy: [] }],
    runBacktest: async () => (runs++, { pineId, studyId: "temporary", keptOnChart: true,
      removedFromChart: false, strategy: "Stress", currency: "JPY", initialCapital: 1_000_000,
      dateRange: null, summary: {}, totalTrades: trades.length, trades: [] }),
    setIndicatorInput: async (_studyId, appliedInputs) => {
      entryDelay = appliedInputs.find((input) => input.id === "entryDelay")?.value ?? 0;
      return { applied: appliedInputs, settled: true };
    },
    getStrategyReport: async () => ({ strategy: "Stress", currency: "JPY", initialCapital: 1_000_000,
      dateRange: null, summary: { netProfit: 110 }, totalTrades: trades.length, trades: [] }),
    getStrategyTradeLedger: async () => {
      const ledgerTrades = entryDelay === 0 ? trades : trades.map((trade) => ({
        ...trade, profit: trade.profit / 2,
      }));
      return { schemaVersion: "1.0", ledgerId: `sha256:${(entryDelay === 0 ? "d" : "e").repeat(64)}`,
      strategy: "Stress", symbol: "OANDA:USDJPY", timeframe: "240", studyId: "temporary", pineId,
      pineVersion: "3.0", inputs: [], currency: "JPY", initialCapital: 1_000_000,
      dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-02-01T00:00:00.000Z" },
      summary: {}, totalTrades: ledgerTrades.length, availableTrades: ledgerTrades.length, countMatchesSummary: true,
      ordering: "strategy_report", offset: 0, limit: 500, returned: ledgerTrades.length, nextOffset: null,
      complete: true, unavailableFields: [], qualityIssues: [], trades: ledgerTrades };
    },
    removePineFromChart: async () => (removes++, { removed: true, pineId, pineVersion: "3.0",
      studyId: "temporary", name: "Stress", chartIndex: 0 }),
  } }));
  const args = {
    protocol_id: `sha256:${"a".repeat(64)}`,
    expected_symbol: "OANDA:USDJPY", expected_timeframe: "240", pine_id: pineId, pine_version: "3.0",
    inputs: [{ id: "entryDelay", value: 0 }],
    evaluation_from: "2025-01-01T00:00:00.000Z", evaluation_to: "2025-02-01T00:00:00.000Z",
    minimum_trades: 2,
    scenarios: [
      { scenario_id: "cost-10", kind: "additional_cost_per_trade", value: 10 },
      { scenario_id: "commission-2x", kind: "commission_multiplier", value: 2 },
    ],
    rerun_scenarios: [
      { scenario_id: "entry-delay-1", input_overrides: [{ id: "entryDelay", value: 1 }] },
    ],
    bootstrap: { seed: "fixed", iterations: 100, failure_net_profit: 0 },
  };
  const dry = JSON.parse((await client.callTool({ name: "stress_test_strategy", arguments: args })).content[0].text);
  assert.equal(dry.status, "preview");
  assert.equal(runs, 0);
  const result = JSON.parse((await client.callTool({ name: "stress_test_strategy",
    arguments: { ...args, confirm: true } })).content[0].text);
  assert.equal(result.status, "complete");
  assert.equal(result.evaluation.baseline.metrics.netProfit, 110);
  assert.equal(result.evaluation.scenarios[0].metrics.netProfit, 70);
  assert.equal(result.rerunEvaluation.scenarios[0].metrics.netProfit, 55);
  assert.equal(result.rerunCollections[0].appliedInputs[0].value, 1);
  assert.equal(result.chartState.restored, true);
  assert.equal(runs, 2);
  assert.equal(removes, 2);
});

test("stress_test_strategy stops reruns after a chart restore failure", async () => {
  const pineId = "USER;stressrestore1";
  const originalStudies = [{ id: "original", name: "RSI" }];
  let contextReads = 0;
  let runs = 0;
  let removes = 0;
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
    charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240",
      studies: contextReads++ >= 2
        ? [...originalStudies, { id: "stuck", name: "Stress" }]
        : originalStudies }] });
  const trades = [100, -20].map((profit, index) => {
    const entryTime = Date.UTC(2025, 0, 2 + index);
    return { reportIndex: index, number: index + 1, direction: "long", status: "closed",
      entry: { time: entryTime, timeIso: new Date(entryTime).toISOString(), price: 1, label: null },
      exit: { time: entryTime + 3_600_000, timeIso: new Date(entryTime + 3_600_000).toISOString(), price: 1, label: null },
      durationMilliseconds: 3_600_000, profit, profitPercent: null, cumulativeProfit: null,
      quantity: 1, commission: 0, commissionPercent: null, runUp: null, runUpPercent: null,
      drawDown: null, drawDownPercent: null };
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    listPineScripts: async () => [{ pineId, name: "Stress", kind: "strategy", version: "1.0", usedBy: [] }],
    runBacktest: async () => ({ pineId, studyId: ++runs === 1 ? "baseline" : "stuck",
      keptOnChart: true, removedFromChart: false, strategy: "Stress", currency: "JPY",
      initialCapital: 1_000_000, dateRange: null, summary: {}, totalTrades: 2, trades: [] }),
    setIndicatorInput: async (_studyId, applied) => ({ applied, settled: true }),
    getStrategyReport: async () => ({ strategy: "Stress", currency: "JPY", initialCapital: 1_000_000,
      dateRange: null, summary: { netProfit: 80 }, totalTrades: 2, trades: [] }),
    getStrategyTradeLedger: async () => ({ schemaVersion: "1.0", ledgerId: `sha256:${"f".repeat(64)}`,
      strategy: "Stress", symbol: "OANDA:USDJPY", timeframe: "240", studyId: "temporary", pineId,
      pineVersion: "1.0", inputs: [], currency: "JPY", initialCapital: 1_000_000,
      dateRange: { from: "2025-01-01T00:00:00.000Z", to: "2025-02-01T00:00:00.000Z" },
      summary: {}, totalTrades: 2, availableTrades: 2, countMatchesSummary: true,
      ordering: "strategy_report", offset: 0, limit: 500, returned: 2, nextOffset: null,
      complete: true, unavailableFields: [], qualityIssues: [], trades }),
    removePineFromChart: async (_requested, studyId) => {
      removes += 1;
      if (studyId === "stuck") throw new Error("removal failed");
      return { removed: true, pineId, pineVersion: "1.0", studyId, name: "Stress", chartIndex: 0 };
    },
  } }));
  const result = JSON.parse((await client.callTool({ name: "stress_test_strategy", arguments: {
    protocol_id: `sha256:${"a".repeat(64)}`, expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "240", pine_id: pineId, pine_version: "1.0",
    evaluation_from: "2025-01-01T00:00:00.000Z", evaluation_to: "2025-02-01T00:00:00.000Z",
    minimum_trades: 2, scenarios: [{ scenario_id: "cost", kind: "additional_cost_per_trade", value: 0 }],
    rerun_scenarios: [
      { scenario_id: "first", input_overrides: [{ id: "in_0", value: 2 }] },
      { scenario_id: "second", input_overrides: [{ id: "in_0", value: 3 }] },
    ], confirm: true,
  } })).content[0].text);
  assert.equal(result.status, "partial");
  assert.equal(result.rerunCollections[0].status, "failed");
  assert.equal(result.rerunCollections[0].chartRestored, false);
  assert.equal(result.rerunCollections[1].status, "skipped");
  assert.equal(runs, 2);
  assert.equal(removes, 2);
  assert.ok(result.qualityIssues.includes("chart_state_restore_failed"));
});

test("strategy research journal tools map immutable records without chart access", async () => {
  const calls = [];
  const hash = (letter) => `sha256:${letter.repeat(64)}`;
  const deps = makeDeps({
    tv: { getChartContext: async () => { throw new Error("chart must not be accessed"); } },
    researchJournal: {
      registerHypothesis: async (payload) => (calls.push(["hypothesis", payload]), { recorded: true, entry: { payload } }),
      recordExperiment: async (payload) => (calls.push(["experiment", payload]), { recorded: true, entry: { payload, evidence_hash: hash("e") } }),
      compare: async (references) => (calls.push(["compare", references]), { comparable: true, experiments: references }),
    },
  });
  const client = await connectedClient(deps);
  const registered = await client.callTool({
    name: "register_strategy_hypothesis",
    arguments: {
      hypothesis_id: "next-bar-confirmation",
      title: "Next-bar confirmation",
      thesis: "Continuation should reduce false entries.",
      evaluation_contract: {
        population: "in_sample", primary_metric: "expectancy", minimum_trades: 30,
        symbols: ["OANDA:USDJPY"], timeframes: ["240"], minimum_profit_factor: 1.2,
      },
    },
  });
  assert.equal(JSON.parse(registered.content[0].text).recorded, true);
  assert.equal(calls[0][1].evaluationContract.primaryMetric, "expectancy");

  const variant = {
    pine_id: "USER;aaaaaaaa", pine_version: "3.0", ledger_id: hash("b"),
    metrics: { totalTrades: 37, expectancy: 6.41 },
  };
  const recorded = await client.callTool({
    name: "record_strategy_experiment",
    arguments: {
      experiment_id: hash("a"), hypothesis_id: "next-bar-confirmation", population: "in_sample",
      methodology_version: "1.0", symbol: "OANDA:USDJPY", timeframe: "240",
      baseline: { ...variant, ledger_id: hash("c") }, candidate: variant,
      conditions_matched: true, minimum_trades_met: true, decision: "rejected",
    },
  });
  assert.equal(JSON.parse(recorded.content[0].text).recorded, true);
  assert.equal(calls[1][1].candidate.ledgerId, hash("b"));

  const compared = await client.callTool({
    name: "compare_strategy_experiments",
    arguments: { references: [
      { experiment_id: hash("a"), evidence_hash: hash("e") },
      { experiment_id: hash("d"), evidence_hash: hash("f") },
    ] },
  });
  assert.equal(JSON.parse(compared.content[0].text).comparable, true);
  assert.equal(calls[2][1][0].experimentId, hash("a"));
});

test("list_alerts returns the user's alerts", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "list_alerts", arguments: {} });
  const [alert] = JSON.parse(res.content[0].text);
  assert.equal(alert.symbol, "OANDA:USDJPY");
  assert.equal(alert.active, false);
});

test("create_analysis_alerts previews, creates, verifies, and reuses owned alerts", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const now = Date.now();
  const analysisId = "USDJPY-alert-monitor";
  const values = {
    in_0: analysisId,
    in_1: now - 60_000,
    in_2: "bullish",
    in_3: 162.1,
    in_4: 162.2,
    in_5: 162.3,
    in_6: 161.9,
    in_7: 161.8,
    in_8: 162.6,
    in_9: 0,
    in_10: 0,
    in_11: 0.65,
    in_12: now + 60 * 60_000,
    in_13: "",
  };
  const alerts = [];
  let creates = 0;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "FX",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
      }),
      listPineScripts: async () => [{
        pineId,
        name: ANALYSIS_OVERLAY_NAME,
        kind: "study",
        version: "2.0",
        usedBy: [{ chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" }],
      }],
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
      getOhlcv: async () => ({
        symbol: "OANDA:USDJPY",
        resolution: "240",
        count: 1,
        bars: [{ time: now / 1000, timeIso: new Date(now).toISOString(), open: 162.2, high: 162.25, low: 162.15, close: 162.2, volume: null }],
      }),
      listAlerts: async () => alerts,
      createPriceAlert: async (options) => {
        creates += 1;
        const alert = {
          id: 100 + creates,
          name: options.name,
          symbol: options.symbol,
          resolution: options.resolution,
          condition: {
            type: options.operator,
            frequency: "on_first_fire",
            series: [{ type: "barset" }, { type: "value", value: options.level }],
          },
          message: options.message,
          active: true,
          type: "price",
          createTime: new Date().toISOString(),
          lastFireTime: null,
          expiration: options.expiration,
          lastError: null,
        };
        alerts.push(alert);
        return {
          requestId: creates,
          alertId: alert.id,
          name: options.name,
          symbol: options.symbol,
          resolution: options.resolution,
          operator: options.operator,
          level: options.level,
          expiration: options.expiration,
          verified: true,
        };
      },
    },
  }));
  const args = {
    pine_id: pineId,
    expected_symbol: "OANDA:USDJPY",
    expected_timeframe: "4H",
    analysis_id: analysisId,
  };
  const dry = JSON.parse((await client.callTool({ name: "create_analysis_alerts", arguments: args })).content[0].text);
  assert.equal(dry.status, "preview");
  assert.equal(dry.dryRun, true);
  assert.equal(dry.preview.create.length, 3);
  assert.equal(creates, 0);

  const confirmed = JSON.parse((await client.callTool({
    name: "create_analysis_alerts",
    arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(confirmed.status, "complete");
  assert.equal(confirmed.created.length, 3);
  assert.equal(confirmed.verified.length, 3);
  assert.equal(creates, 3);

  const repeated = JSON.parse((await client.callTool({
    name: "create_analysis_alerts",
    arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(repeated.status, "complete");
  assert.equal(repeated.changed, false);
  assert.equal(creates, 3);

  const confirmationIndex = alerts.findIndex((alert) => alert.name.endsWith(":confirmation"));
  alerts.splice(confirmationIndex, 1);
  const ambiguous = JSON.parse((await client.callTool({
    name: "create_analysis_alerts",
    arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(ambiguous.status, "blocked");
  assert.equal(ambiguous.reason, "ambiguous_missing_confirmation_alert");
  assert.equal(creates, 3);
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

test("get_execution_snapshot exposes verified liveness without account or chart access", async () => {
  let calls = 0;
  const client = await connectedClient(makeDeps({
    scanner: {
      getQuotes: async (symbols) => {
        calls += 1;
        const offset = calls > 1 ? 0.0001 : 0;
        return {
          totalCount: symbols.length,
          returned: symbols.length,
          rows: symbols.map((symbol) => ({
            symbol,
            values: {
              bid: 1.1 + offset,
              ask: 1.1002 + offset,
              update_mode: "streaming",
              pricescale: 100000,
              minmov: 1,
              type: "forex",
            },
          })),
        };
      },
    },
  }));
  const res = await client.callTool({
    name: "get_execution_snapshot",
    arguments: {
      symbols: ["OANDA:EURUSD"],
      wait_for_update_ms: 100,
      sample_interval_ms: 100,
      max_quote_age_ms: 500,
    },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.quotes[0].market_state, "active");
  assert.equal(parsed.quotes[0].freshness.status, "verified_live_update");
});

test("get_trade_decision_context binds chart, market, macro, positioning, and execution evidence", async () => {
  const now = Date.now();
  let quoteCalls = 0;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "FX",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }],
      }),
      getOhlcv: async () => ({
        symbol: "OANDA:EURUSD",
        resolution: "60",
        count: 2,
        bars: [
          { time: now / 1000 - 3600, timeIso: new Date(now - 3600_000).toISOString(), open: 1.1, high: 1.101, low: 1.099, close: 1.1005, volume: 100 },
          { time: now / 1000, timeIso: new Date(now).toISOString(), open: 1.1005, high: 1.102, low: 1.1, close: 1.1015, volume: 50, forming: true },
        ],
      }),
      getKeyLevels: async () => ({
        symbol: "OANDA:EURUSD",
        resolution: "60",
        price: 1.1015,
        rangePercent: 3,
        count: 1,
        levels: [{ price: 1.105, distancePercent: 0.32, kind: "line", study: "SMC", detail: "resistance", time: now / 1000 }],
      }),
    },
    scanner: {
      getQuotes: async (symbols) => {
        quoteCalls += 1;
        const offset = quoteCalls >= 3 ? 0.0001 : 0;
        return {
          totalCount: symbols.length,
          returned: symbols.length,
          rows: symbols.map((symbol) => ({ symbol, values: {
            close: 1.1015,
            bid: 1.1014 + offset,
            ask: 1.1016 + offset,
            update_mode: "streaming",
            pricescale: 100000,
            minmov: 1,
          } })),
        };
      },
    },
  }));
  const result = await client.callTool({
    name: "get_trade_decision_context",
    arguments: {
      symbol: "OANDA:EURUSD",
      chart_index: 0,
      expected_timeframe: "60",
      auxiliary_symbols: ["TVC:DXY"],
      timeframes: ["15", "60", "240", "1D"],
      countries: ["US", "EU"],
      execution_wait_for_update_ms: 100,
      execution_sample_interval_ms: 100,
    },
  });
  assert.notEqual(result.isError, true);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.schema_version, "1.0");
  assert.match(parsed.snapshot_id, /^[0-9a-f-]{36}$/i);
  assert.equal(parsed.status, "partial", "scanner timestamps and delayed macro evidence remain explicit");
  assert.equal(parsed.decision_status, "trade_ready", "a post-request streaming update clears the execution gate");
  assert.equal(parsed.directional_recommendation, null);
  assert.equal(parsed.evidence.market_snapshot.data.snapshot_id, parsed.snapshot_id);
  assert.equal(parsed.evidence.chart.data.closed_bars.length, 1);
  assert.equal(parsed.evidence.chart.data.forming_bar.forming, true);
  assert.equal(parsed.evidence.key_levels.data.levels[0].price, 1.105);
  assert.equal(parsed.evidence.positioning.data.cot.symbol, "OANDA:EURUSD");
  assert.equal(parsed.evidence.real_yield.data.value, 2.01);
  assert.equal(parsed.evidence.execution.status, "available");
  assert.equal(parsed.evidence.execution.source, "tradingview_scanner");
  assert.equal(parsed.evidence.execution.data.snapshot_id, parsed.snapshot_id);
  assert.equal(parsed.evidence.execution.data.quotes[0].freshness.status, "verified_live_update");
});

test("get_trade_decision_context blocks a chart binding mismatch without reading chart evidence", async () => {
  let chartEvidenceRead = false;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "FX",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "60", studies: [] }],
      }),
      getOhlcv: async () => ((chartEvidenceRead = true), { symbol: "OANDA:USDJPY", resolution: "60", count: 0, bars: [] }),
      getKeyLevels: async () => ((chartEvidenceRead = true), { symbol: "OANDA:USDJPY", resolution: "60", price: 1, rangePercent: 3, count: 0, levels: [] }),
    },
  }));
  const result = await client.callTool({
    name: "get_trade_decision_context",
    arguments: { symbol: "OANDA:EURUSD", chart_index: 0, expected_timeframe: "60" },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.decision_status, "blocked");
  assert.equal(chartEvidenceRead, false);
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "chart_symbol_mismatch"));
});

test("get_trade_decision_context blocks Bar Replay without reading historical chart evidence", async () => {
  let chartEvidenceRead = false;
  const client = await connectedClient(makeDeps({
    tv: {
      getReplayStatus: async () => ({
        available: true,
        toolbarVisible: true,
        started: true,
        ready: true,
        autoplay: false,
        jumpToBarMode: false,
        currentTime: 1735689600,
        currentTimeIso: "2025-01-01T00:00:00.000Z",
        selectedTime: 1735689600,
        selectedTimeIso: "2025-01-01T00:00:00.000Z",
        currentResolution: "60",
        replayResolutions: ["60"],
        autoResolution: "60",
        autoplayDelayMs: 1000,
        activeChart: { symbol: "EURUSD", resolution: "1D", index: 0 },
      }),
      getOhlcv: async () => ((chartEvidenceRead = true), { symbol: "EURUSD", resolution: "1D", count: 0, bars: [] }),
      getKeyLevels: async () => ((chartEvidenceRead = true), { symbol: "EURUSD", resolution: "1D", price: 1, rangePercent: 3, count: 0, levels: [] }),
    },
  }));
  const result = await client.callTool({
    name: "get_trade_decision_context",
    arguments: { symbol: "EURUSD", chart_index: 0, expected_timeframe: "1D" },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.decision_status, "blocked");
  assert.equal(parsed.evidence.replay.status, "blocked");
  assert.equal(parsed.evidence.chart.data, null);
  assert.equal(chartEvidenceRead, false);
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "chart_replay_active"));
});

test("get_trade_decision_context discards chart evidence when replay starts during collection", async () => {
  let replayReads = 0;
  const base = {
    available: true,
    toolbarVisible: false,
    started: false,
    ready: false,
    autoplay: false,
    jumpToBarMode: false,
    currentTime: null,
    currentTimeIso: null,
    selectedTime: null,
    selectedTimeIso: null,
    currentResolution: null,
    replayResolutions: [],
    autoResolution: "1D",
    autoplayDelayMs: 1000,
    activeChart: { symbol: "EURUSD", resolution: "1D", index: 0 },
  };
  const client = await connectedClient(makeDeps({
    tv: {
      getReplayStatus: async () => {
        replayReads += 1;
        return replayReads === 1
          ? base
          : { ...base, toolbarVisible: true, started: true, currentTimeIso: "2025-01-01T00:00:00.000Z" };
      },
    },
  }));
  const result = await client.callTool({
    name: "get_trade_decision_context",
    arguments: { symbol: "EURUSD", chart_index: 0, expected_timeframe: "1D" },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.decision_status, "blocked");
  assert.equal(parsed.evidence.chart.data, null);
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "chart_replay_started_during_snapshot"));
});

test("get_trade_decision_context waits during an important-event blackout", async () => {
  const eventAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "FX",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }],
      }),
      getOhlcv: async () => ({
        symbol: "OANDA:EURUSD",
        resolution: "60",
        count: 1,
        bars: [{ time: Date.now() / 1000 - 3600, timeIso: new Date(Date.now() - 3600_000).toISOString(), open: 1.1, high: 1.2, low: 1, close: 1.1, volume: 1 }],
      }),
      getKeyLevels: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", price: 1.1, rangePercent: 3, count: 0, levels: [] }),
    },
    scanner: {
      getQuotes: async (symbols) => ({ totalCount: symbols.length, returned: symbols.length, rows: symbols.map((symbol) => ({ symbol, values: { close: 1.1, bid: 1.0999, ask: 1.1001 } })) }),
    },
    calendar: {
      getEvents: async () => ({
        from: new Date().toISOString(),
        to: new Date(Date.now() + 86_400_000).toISOString(),
        countries: ["US"],
        minImportance: "medium",
        totalInRange: 1,
        returned: 1,
        events: [{ id: "fomc", date: eventAt, country: "US", currency: "USD", title: "FOMC", indicator: null, importance: "high", period: null, actual: null, forecast: null, previous: null, unit: null }],
      }),
    },
  }));
  const result = await client.callTool({
    name: "get_trade_decision_context",
    arguments: { symbol: "OANDA:EURUSD", expected_timeframe: "60", countries: ["US"] },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.decision_status, "wait");
  assert.equal(parsed.event_gate.status, "blackout");
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "event_blackout_active"));
});

test("get_trade_decision_context blocks a failed required positioning source", async () => {
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "FX",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "1D", studies: [] }],
      }),
    },
    cot: { getLatest: async () => { throw new Error("COT unavailable"); } },
  }));
  const result = await client.callTool({
    name: "get_trade_decision_context",
    arguments: { symbol: "OANDA:EURUSD", expected_timeframe: "1D", require_positioning: true },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.decision_status, "blocked");
  assert.equal(parsed.evidence.positioning.required, true);
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "positioning_unavailable" && issue.severity === "error"));
});

test("get_trade_decision_context preserves other evidence when chart context retrieval fails", async () => {
  const client = await connectedClient(makeDeps({
    tv: { getChartContext: async () => { throw new Error("chart unavailable"); } },
  }));
  const result = await client.callTool({
    name: "get_trade_decision_context",
    arguments: { symbol: "OANDA:EURUSD", expected_timeframe: "60" },
  });
  assert.notEqual(result.isError, true);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.decision_status, "blocked");
  assert.match(parsed.snapshot_id, /^[0-9a-f-]{36}$/i);
  assert.equal(parsed.evidence.chart.status, "blocked");
  assert.ok(parsed.evidence.market_snapshot.data);
  assert.ok(parsed.quality_issues.some((issue) => issue.code === "chart_context_unavailable"));
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

test("get_futures_flow_context binds a daily futures chart and keeps daily OI unavailable", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 30 }, (_, index) => {
    const open = 100 + index;
    const close = open + 1;
    return { time: (start + index * 86_400_000) / 1000,
      timeIso: new Date(start + index * 86_400_000).toISOString(), open,
      high: close + 0.2, low: open - 0.2, close, volume: index === 29 ? 500 : 100 + index };
  });
  let requestedCot = null;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 2, charts: [
        { index: 0, symbol: "OANDA:USDJPY", resolution: "1D", studies: [] },
        { index: 1, symbol: "CME:6J1!", resolution: "1D", studies: [] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async (count, chartIndex) => {
        assert.equal(count, 100);
        assert.equal(chartIndex, 1);
        return { symbol: "CME:6J1!", resolution: "1D", count: bars.length, bars };
      },
    },
    cot: {
      getHistory: async (symbol, weeks) => {
        requestedCot = { symbol, weeks };
        return { symbol, requested_weeks: weeks,
          observations: [{ symbol, report_date: "2026-01-27T00:00:00.000Z", positions: [] }],
          positioning_features: { point_in_time_status: "blocked", groups: [] }, cache_status: "miss" };
      },
    },
  }));
  const res = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:USDJPY", futures_chart_index: 1, expected_futures_symbol: "CME:6J1!",
    count: 100, volume_lookback: 5, elevated_volume_z_score: 1, minimum_observations: 1,
    observation_limit: 2, cot_weeks: 2,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "partial");
  assert.equal(parsed.mapping.targetDirectionMultiplier, -1);
  assert.equal(parsed.current.targetOrientedDirection, "down");
  assert.equal(parsed.current.participation, "elevated");
  assert.equal(parsed.openInterest.status, "unavailable");
  assert.equal(parsed.priceOpenInterestQuadrant.classification, null);
  assert.equal(parsed.cot.status, "partial");
  assert.ok(parsed.qualityIssues.includes("daily_open_interest_provider_not_configured"));
  assert.ok(parsed.qualityIssues.includes("cot_point_in_time_incomplete"));
  assert.equal(parsed.status, parsed.qualityIssues.length === 0 ? "complete" : "partial");
  assert.deepEqual(requestedCot, { symbol: "OANDA:USDJPY", weeks: 2 });
  assert.equal(parsed.source.chartIndex, 1);
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

test("run_market_event_study binds the chart and returns session auction evidence", async () => {
  const start = Date.UTC(2026, 0, 5);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    bars.push({ time: (start + index * 900_000) / 1000,
      timeIso: new Date(start + index * 900_000).toISOString(),
      open: 1.05, high: 1.1, low: 1, close: 1.05, volume: 1 });
  }
  bars.push({ time: (start + 32 * 900_000) / 1000, timeIso: new Date(start + 32 * 900_000).toISOString(),
    open: 1.05, high: 1.12, low: 1.04, close: 1.11, volume: 1 });
  bars.push({ time: (start + 33 * 900_000) / 1000, timeIso: new Date(start + 33 * 900_000).toISOString(),
    open: 1.11, high: 1.13, low: 1.1, close: 1.12, volume: 1 });
  for (let index = 34; index < 42; index += 1) {
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(),
      open: 1.12, high: 1.13, low: 1.11, close: 1.12, volume: 1 });
  }
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "15", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "15", count: 100,
    condition: { type: "session_auction", timezone: "UTC", range_start: "00:00",
      range_end: "08:00", auction_end: "10:00", minimum_range_coverage: 1 },
    horizons: [1, 4], target_return_bps: 10, minimum_events: 1, event_limit: 10,
    confidence_level: 0.99, configuration_trials: 7,
    regime: {
      trend_lookback: 2, atr_lookback: 2, volatility_baseline_lookback: 5,
      trend_efficiency_threshold: 0.6, range_efficiency_threshold: 0.25,
      directional_move_atr_threshold: 0.5, high_volatility_ratio: 1.5,
      low_volatility_ratio: 0.75, minimum_classified_bars: 1,
      minimum_group_events: 1, minimum_coverage_ratio: 0.5, max_regime_age_bars: 1,
    },
    folds: [{ fold_id: "all", from: "2026-01-05T00:00:00.000Z", to: "2026-01-06T00:00:00.000Z" }],
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.byBranch.accepted_up.events, 1);
  assert.equal(parsed.conditionType, "session_auction");
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.events[0].direction, "long");
  assert.equal(parsed.folds[0].events, 1);
  assert.equal(parsed.inferenceContract.confidenceLevel, 0.99);
  assert.equal(parsed.inferenceContract.configurationTrials, 7);
  assert.equal(parsed.byBranch.accepted_up.horizons["1"].positiveRateConfidenceInterval.method,
    "wilson_score");
  assert.equal(parsed.regimeAnalysis.coverage.joinedEvents, 1);
  assert.equal(parsed.regimeAnalysis.joinContract.signalBarRegimeExcluded, true);
  assert.equal(parsed.regimeAnalysis.inferenceContract.automaticRanking, false);
});

test("run_market_event_study binds the chart and returns session handoff evidence", async () => {
  const start = Date.UTC(2026, 0, 5);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    const open = 1 + index * 0.006;
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(),
      open, high: open + 0.008, low: open - 0.004, close: open + 0.006, volume: 1 });
  }
  const priorHigh = bars.at(-1).high;
  for (let index = 32; index < 52; index += 1) {
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(),
      open: 1.19, high: 1.195, low: 1.185, close: 1.19, volume: 1 });
  }
  bars.push({ time: (start + 52 * 900_000) / 1000, timeIso: new Date(start + 52 * 900_000).toISOString(),
    open: 1.19, high: priorHigh - 0.002, low: 1.16, close: 1.17, volume: 1 });
  for (let index = 53; index < 58; index += 1) {
    const close = 1.17 - (index - 52) * 0.002;
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(),
      open: close + 0.002, high: close + 0.003, low: close - 0.003, close, volume: 1 });
  }
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "15", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "15", count: 100,
    condition: { type: "session_exhaustion_handoff", timezone: "UTC",
      prior_sessions: [{ session_id: "Tokyo", start: "00:00", end: "08:00" }],
      handoff_start: "13:00", handoff_end: "16:00", prior_direction: "session_return",
      direction_minimum_return_bps: 1, handoff_window_bars: 3, minimum_prior_coverage: 1 },
    horizons: [1, 4], target_return_bps: 10, minimum_events: 1, event_limit: 10,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "session_exhaustion_handoff");
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.byBranch.exhaustion_up.events, 1);
  assert.equal(parsed.events[0].direction, "short");
  assert.equal(JSON.stringify(parsed).includes('"bars"'), false);
});

test("run_yield_price_nonconfirmation_study binds two charts and returns as-of joined evidence", async () => {
  const day = 86_400_000;
  const start = Date.UTC(2026, 0, 1);
  const makeBars = (closes, offset = 0) => closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    const time = start + offset + index * day;
    return { time: time / 1000, timeIso: new Date(time).toISOString(), open: previous,
      high: Math.max(previous, close) + 0.2, low: Math.min(previous, close) - 0.2,
      close, volume: 1 };
  });
  const driverBars = makeBars([4, 4, 4, 4, 4, 4.15, 4.16, 4.16, 4.16, 4.16, 4.16]);
  const targetBars = makeBars([100, 100.1, 100, 100.2, 100.1, 100, 99.9, 98, 97, 96, 95], 22 * 3_600_000);
  const calls = [];
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2,
      charts: [
        { index: 0, symbol: "OANDA:USDJPY", resolution: "1D", studies: [] },
        { index: 1, symbol: "TVC:US10Y", resolution: "1D", studies: [] },
      ] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async (count, chartIndex) => {
      calls.push({ count, chartIndex });
      return chartIndex === 0
        ? { symbol: "OANDA:USDJPY", resolution: "1D", count: targetBars.length, bars: targetBars }
        : { symbol: "TVC:US10Y", resolution: "1D", count: driverBars.length, bars: driverBars };
    },
  } }));
  const res = await client.callTool({ name: "run_yield_price_nonconfirmation_study", arguments: {
    target_chart_index: 0, driver_chart_index: 1,
    expected_target_symbol: "OANDA:USDJPY", expected_driver_symbol: "TVC:US10Y",
    expected_target_timeframe: "1D", expected_driver_timeframe: "1D", count: 100,
    relationship: "direct", driver_lookback: 2, driver_change_threshold: 0.1,
    price_breakout_lookback: 3, nonconfirmation_bars: 2, trigger_lookback: 2,
    trigger_within_bars: 3, max_driver_age_bars: 2, horizons: [1, 2],
    target_return_bps: 50, minimum_events: 1, event_limit: 10,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.sample.events, 1);
  assert.equal(parsed.events[0].direction, "short");
  assert.equal(parsed.source.target.chartIndex, 0);
  assert.equal(parsed.source.driver.chartIndex, 1);
  assert.deepEqual(calls.sort((left, right) => left.chartIndex - right.chartIndex), [
    { count: 100, chartIndex: 0 }, { count: 100, chartIndex: 1 },
  ]);
});

test("compute_feature_outcome_relationships binds closed OHLC to the active chart", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 30 }, (_, index) => {
    const open = 100 + Math.sin(index / 3);
    const close = open + (index % 3 === 0 ? 0.8 : -0.35);
    return { time: (start + index * 3_600_000) / 1000,
      timeIso: new Date(start + index * 3_600_000).toISOString(),
      open, high: Math.max(open, close) + 0.3, low: Math.min(open, close) - 0.3, close, volume: 1 };
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "compute_feature_outcome_relationships", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
    features: ["body_direction", "range_position"], atr_lookback: 2, atr_baseline_lookback: 5,
    range_lookback: 3, streak_minimum_bars: 2, horizons: [1, 3], minimum_observations: 5,
    observation_limit: 2,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.symbol, "OANDA:EURUSD");
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.outcomeContract.forwardFill, false);
  assert.ok(parsed.byFeature.body_direction.bullish_body.observations > 0);
  assert.equal(parsed.observations.length, 2);
});

test("compute_session_profile binds minute OHLC to the active chart", async () => {
  const start = Date.UTC(2026, 0, 5, 8);
  const bars = Array.from({ length: 4 }, (_, index) => ({
    time: (start + index * 3_600_000) / 1000,
    timeIso: new Date(start + index * 3_600_000).toISOString(),
    open: 100 + index, high: 101.2 + index, low: 99.8 + index, close: 101 + index, volume: 10 + index,
  }));
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "compute_session_profile", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
    sessions: [{ session_id: "london", timezone: "Europe/London", start: "08:00", end: "12:00",
      minimum_coverage: 1 }],
    opening_range_bars: 2, minimum_session_days: 1, observation_limit: 1,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.bySession.london.completeSessionDays, 1);
  assert.equal(parsed.volumeKind, "tradingview_bar_volume_unverified_tick_or_exchange_volume");
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.observations.length, 1);
});

test("compute_market_regimes binds the chart and returns point-in-time labels", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 160 }, (_, index) => {
    const open = 100 + Math.max(0, index - 1) * 0.5;
    const close = 100 + index * 0.5;
    return { time: (start + index * 3_600_000) / 1000,
      timeIso: new Date(start + index * 3_600_000).toISOString(),
      open, high: close + 0.2, low: open - 0.2, close, volume: 1 };
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "compute_market_regimes", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 160,
    trend_lookback: 10, atr_lookback: 5, volatility_baseline_lookback: 20,
    trend_efficiency_threshold: 0.6, range_efficiency_threshold: 0.25,
    directional_move_atr_threshold: 2, minimum_classified_bars: 20,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.current.directionalRegime, "trend_up");
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.source.requestedBars, 160);
  assert.ok(parsed.distribution.directional.trend_up > 20);
});

test("run_strategy_regime_analysis joins a complete temporary ledger and restores the chart", async () => {
  const pineId = "USER;regime12345";
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 200 }, (_, index) => {
    const open = 100 + Math.max(0, index - 1) * 0.5;
    const close = 100 + index * 0.5;
    return { time: (start + index * 3_600_000) / 1000,
      timeIso: new Date(start + index * 3_600_000).toISOString(),
      open, high: close + 0.2, low: open - 0.2, close, volume: 1 };
  });
  const profits = [4, -2, 3, -1];
  const trades = profits.map((profit, index) => {
    const entryTime = start + (100 + index * 10) * 3_600_000;
    return { reportIndex: index, number: index + 1, direction: "long", status: "closed",
      entry: { time: entryTime, timeIso: new Date(entryTime).toISOString(), price: 1, label: null },
      exit: { time: entryTime + 3_600_000, timeIso: new Date(entryTime + 3_600_000).toISOString(),
        price: 1, label: null }, durationMilliseconds: 3_600_000, profit, profitPercent: null,
      cumulativeProfit: null, quantity: 1, commission: 0.1, commissionPercent: null,
      runUp: Math.max(profit, 0) + 1, runUpPercent: null, drawDown: Math.max(-profit, 0) + 1,
      drawDownPercent: null };
  });
  let removed = 0;
  let runs = 0;
  let requestedOhlcvCount = null;
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
    charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60",
      studies: [{ id: "original", name: "RSI" }] }] });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    listPineScripts: async () => [{ pineId, name: "Regime Strategy", kind: "strategy",
      version: "1.0", usedBy: [] }],
    getOhlcv: async (count) => ((requestedOhlcvCount = count),
      { symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }),
    runBacktest: async () => ((runs += 1), { studyId: "temporary", pineId, keptOnChart: true,
      removedFromChart: false, strategy: "Regime Strategy", summary: {}, totalTrades: trades.length,
      trades: [] }),
    getStrategyReport: async () => ({ strategy: "Regime Strategy", symbol: "OANDA:EURUSD",
      timeframe: "60", studyId: "temporary", pineId, pineVersion: "1.0", inputs: [],
      currency: "USD", initialCapital: 100000, dateRange: null, summary: { netProfit: 4 },
      totalTrades: trades.length, trades: [] }),
    getStrategyTradeLedger: async () => ({ schemaVersion: "1.0",
      ledgerId: `sha256:${"b".repeat(64)}`, strategy: "Regime Strategy", symbol: "OANDA:EURUSD",
      timeframe: "60", studyId: "temporary", pineId, pineVersion: "1.0", inputs: [],
      currency: "USD", initialCapital: 100000, dateRange: null, summary: { totalTrades: trades.length },
      totalTrades: trades.length, availableTrades: trades.length, countMatchesSummary: true,
      ordering: "strategy_report", offset: 0, limit: 500, returned: trades.length,
      nextOffset: null, complete: true, unavailableFields: [], qualityIssues: [], trades }),
    removePineFromChart: async () => ((removed += 1), { removed: true, pineId,
      pineVersion: "1.0", studyId: "temporary", name: "Regime Strategy", chartIndex: 0 }),
  } }));
  const preview = JSON.parse((await client.callTool({ name: "run_strategy_regime_analysis", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", pine_id: pineId,
    pine_version: "1.0",
  } })).content[0].text);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.definition.regime.count, 20_000);
  assert.equal(runs, 0);
  const invalidSessions = await client.callTool({ name: "run_strategy_regime_analysis", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", pine_id: pineId,
    pine_version: "1.0", sessions: [
      { session_id: "duplicate", timezone: "UTC", start: "08:00", end: "10:00" },
      { session_id: "duplicate", timezone: "UTC", start: "10:00", end: "12:00" },
    ], confirm: true,
  } });
  assert.equal(invalidSessions.isError, true);
  assert.match(invalidSessions.content[0].text, /unique session ids/);
  assert.equal(runs, 0);
  const invalidPolicy = await client.callTool({ name: "run_strategy_regime_analysis", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", pine_id: pineId,
    pine_version: "1.0", session_match_policy: "first_match_exclusive", confirm: true,
  } });
  assert.equal(invalidPolicy.isError, true);
  assert.match(invalidPolicy.content[0].text, /requires sessions/);
  assert.equal(runs, 0);
  const result = JSON.parse((await client.callTool({ name: "run_strategy_regime_analysis", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", pine_id: pineId,
    pine_version: "1.0", count: 200, trend_lookback: 10, atr_lookback: 5,
    volatility_baseline_lookback: 20, minimum_classified_bars: 20,
    minimum_group_trades: 2, minimum_coverage_ratio: 1, max_regime_age_bars: 1, confirm: true,
  } })).content[0].text);
  assert.equal(result.status, "complete");
  assert.equal(result.evaluation.coverage.joinedTrades, 4);
  assert.equal(result.evaluation.byDirectionalRegime.trend_up.profitFactor, 7 / 3);
  assert.equal(result.chartStateAfter.restored, true);
  assert.equal(result.strategyEvidence.ledgerTrades, 4);
  assert.equal(runs, 1);
  assert.equal(removed, 1);
  assert.equal(requestedOhlcvCount, 200);
});

test("run_strategy_regime_matrix evaluates serial jobs and restores the original chart", async () => {
  const pineId = "USER;regimematrix123";
  const chart = { symbol: "OANDA:USDJPY", resolution: "240" };
  const start = Date.UTC(2026, 0, 1);
  let activePine = null;
  let runs = 0;
  let removed = 0;
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
    charts: [{ index: 0, symbol: chart.symbol, resolution: chart.resolution,
      studies: [{ id: "original", name: "RSI" }] }] });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    setSymbol: async (symbol) => ((chart.symbol = symbol),
      { symbol, resolution: chart.resolution, bars: 200 }),
    setResolution: async (resolution) => ((chart.resolution = resolution),
      { symbol: chart.symbol, resolution, bars: 200 }),
    listPineScripts: async () => [{ pineId, name: "Regime Matrix Strategy", kind: "strategy",
      version: "2.0", usedBy: [] }],
    getOhlcv: async (count, chartIndex) => {
      assert.equal(count, 200);
      assert.equal(chartIndex, 0);
      const step = Number(chart.resolution) * 60_000;
      const bars = Array.from({ length: 200 }, (_, index) => {
        const open = 100 + Math.max(0, index - 1) * 0.5;
        const close = 100 + index * 0.5;
        const time = start + index * step;
        return { time: time / 1000, timeIso: new Date(time).toISOString(), open,
          high: close + 0.2, low: open - 0.2, close, volume: 1 };
      });
      return { symbol: chart.symbol, resolution: chart.resolution, count: bars.length, bars };
    },
    runBacktest: async () => ((runs += 1), (activePine = pineId), { studyId: `temporary-${runs}`,
      pineId, keptOnChart: true, removedFromChart: false, strategy: "Regime Matrix Strategy",
      summary: {}, totalTrades: 4, trades: [] }),
    getStrategyReport: async () => ({ strategy: "Regime Matrix Strategy", symbol: chart.symbol,
      timeframe: chart.resolution, studyId: `temporary-${runs}`, pineId, pineVersion: "2.0", inputs: [],
      currency: "USD", initialCapital: 100000, dateRange: null, summary: { netProfit: 4 },
      totalTrades: 4, trades: [] }),
    getStrategyTradeLedger: async () => {
      const step = Number(chart.resolution) * 60_000;
      const profits = chart.symbol === "OANDA:EURUSD" ? [4, -2, 3, -1] : [6, -1, 5, -2];
      const trades = profits.map((profit, index) => {
        const entryTime = start + (100 + index * 10) * step;
        return { reportIndex: index, number: index + 1, direction: "long", status: "closed",
          entry: { time: entryTime, timeIso: new Date(entryTime).toISOString(), price: 1, label: null },
          exit: { time: entryTime + step, timeIso: new Date(entryTime + step).toISOString(),
            price: 1, label: null }, durationMilliseconds: step, profit, profitPercent: null,
          cumulativeProfit: null, quantity: 1, commission: 0.1, commissionPercent: null,
          runUp: Math.max(profit, 0) + 1, runUpPercent: null, drawDown: Math.max(-profit, 0) + 1,
          drawDownPercent: null };
      });
      return { schemaVersion: "1.0",
        ledgerId: `sha256:${(chart.symbol === "OANDA:EURUSD" ? "c" : "d").repeat(64)}`,
        strategy: "Regime Matrix Strategy", symbol: chart.symbol, timeframe: chart.resolution,
        studyId: `temporary-${runs}`, pineId: activePine, pineVersion: "2.0", inputs: [],
        currency: "USD", initialCapital: 100000, dateRange: null, summary: { totalTrades: 4 },
        totalTrades: 4, availableTrades: 4, countMatchesSummary: true, ordering: "strategy_report",
        offset: 0, limit: 500, returned: 4, nextOffset: null, complete: true,
        unavailableFields: [], qualityIssues: [], trades };
    },
    removePineFromChart: async (requested, studyId) => ((removed += 1), (activePine = null),
      { removed: true, pineId: requested, pineVersion: "2.0", studyId,
        name: "Regime Matrix Strategy", chartIndex: 0 }),
  } }));
  const args = {
    expected_symbol: "OANDA:USDJPY", expected_timeframe: "240", count: 200, load_more_bars: 6000,
    trend_lookback: 10, atr_lookback: 5, volatility_baseline_lookback: 20,
    minimum_classified_bars: 20, minimum_group_trades: 1, minimum_coverage_ratio: 1,
    max_regime_age_bars: 1,
    session_match_policy: "first_match_exclusive",
    sessions: [{ session_id: "london", timezone: "Europe/London", start: "08:00", end: "16:00" }],
    jobs: [
      { symbol: "OANDA:EURUSD", timeframe: "60", pine_id: pineId },
      { symbol: "OANDA:XAUUSD", timeframe: "240", pine_id: pineId },
    ],
  };
  const preview = JSON.parse((await client.callTool({
    name: "run_strategy_regime_matrix", arguments: args,
  })).content[0].text);
  assert.equal(preview.status, "preview");
  assert.equal(preview.jobCount, 2);
  assert.equal(preview.execution.historyLoadPerJob, 6000);
  assert.equal(runs, 0);

  const result = JSON.parse((await client.callTool({
    name: "run_strategy_regime_matrix", arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.results.map((row) => row.status), ["complete", "complete"]);
  assert.deepEqual(result.results.map((row) => row.evaluation.coverage.joinedTrades), [4, 4]);
  assert.equal(result.results[0].evaluation.overall.profitFactor, 7 / 3);
  assert.equal(result.results[1].evaluation.overall.profitFactor, 11 / 3);
  assert.deepEqual(result.results.map((row) => row.evaluation.bySession.london.trades), [2, 1]);
  assert.deepEqual(result.results.map((row) => row.regimeEvidence.source.historyLoad.attempts), [2, 2]);
  assert.deepEqual(result.results.map((row) => row.regimeEvidence.source.historyLoad.addedBars), [6000, 6000]);
  assert.equal(preview.definition.join.sessionMatchPolicy, "first_match_exclusive");
  assert.equal(result.results[0].evaluation.joinContract.sessionMatchPolicy, "first_match_exclusive");
  assert.deepEqual(result.results[0].evaluation.joinContract.sessionPriority, ["london"]);
  assert.equal(result.chartStateAfter.restored, true);
  assert.equal(runs, 2);
  assert.equal(removed, 2);
  assert.deepEqual(chart, { symbol: "OANDA:USDJPY", resolution: "240" });
});

test("run_strategy_regime_matrix stops remaining jobs after a chart restore failure", async () => {
  const pineId = "USER;regimerestore123";
  const chart = { symbol: "OANDA:USDJPY", resolution: "240" };
  let historyRequests = 0;
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
    charts: [{ index: 0, symbol: chart.symbol, resolution: chart.resolution, studies: [] }] });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    setSymbol: async (symbol) => {
      if (symbol === "OANDA:USDJPY" && chart.symbol === "OANDA:EURUSD") {
        throw new Error("regime matrix restore rejected");
      }
      chart.symbol = symbol;
      return { symbol, resolution: chart.resolution, bars: 200 };
    },
    setResolution: async (resolution) => ((chart.resolution = resolution),
      { symbol: chart.symbol, resolution, bars: 200 }),
    listPineScripts: async () => [{ pineId, name: "Regime Restore Strategy", kind: "strategy",
      version: "1.0", usedBy: [] }],
    getOhlcv: async () => {
      historyRequests += 1;
      throw new Error("regime history unavailable");
    },
  } }));
  const result = JSON.parse((await client.callTool({ name: "run_strategy_regime_matrix", arguments: {
    expected_symbol: "OANDA:USDJPY", expected_timeframe: "240", confirm: true,
    jobs: [
      { symbol: "OANDA:EURUSD", timeframe: "60", pine_id: pineId },
      { symbol: "OANDA:XAUUSD", timeframe: "240", pine_id: pineId },
    ],
  } })).content[0].text);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.results.map((row) => row.status), ["restore_failed", "skipped"]);
  assert.match(result.results[0].error, /regime history unavailable/);
  assert.match(result.results[1].error, /chart restore failed/);
  assert.equal(historyRequests, 1);
  assert.equal(result.chartStateAfter.restored, false);
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
    { name: "set_symbol", arguments: { symbol: "OANDA:EURUSD", chart_index: -1 } },
    { name: "set_timeframe", arguments: { resolution: 42 } },
    { name: "set_timeframe", arguments: { resolution: "15", chart_index: -1 } },
    { name: "start_chart_replay", arguments: {} },
    { name: "start_chart_replay", arguments: { start_at: "not-a-date", expected_symbol: "EURUSD", expected_timeframe: "1D" } },
    { name: "step_chart_replay", arguments: { steps: 101 } },
    { name: "stop_chart_replay", arguments: { confirm: "yes" } },
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
    { name: "run_market_event_study", arguments: {
      expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
      condition: { type: "session_auction", timezone: "UTC", range_start: "08:00", range_end: "09:00",
        auction_end: "10:00" }, horizons: [1], target_return_bps: 10, minimum_events: 1,
      folds: [{ fold_id: "offset", from: "2026-01-01T09:00:00.000+09:00", to: "2026-01-02T09:00:00.000+09:00" }],
    } },
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
    { name: "run_backtest_matrix", arguments: { expected_symbol: "OANDA:USDJPY", expected_timeframe: "240", jobs: [] } },
    { name: "run_backtest_matrix", arguments: { expected_symbol: "OANDA:USDJPY", expected_timeframe: "240",
      jobs: Array(25).fill({ symbol: "OANDA:USDJPY", timeframe: "240", pine_id: "USER;matrixstrategy123" }) } },
    { name: "run_backtest_matrix", arguments: { expected_symbol: "OANDA:USDJPY", expected_timeframe: "240",
      jobs: [{ symbol: "OANDA:USDJPY", timeframe: "240", pine_id: "USER;matrixstrategy123" }],
      max_runtime_seconds: 1801 } },
    { name: "run_strategy_regime_matrix", arguments: { expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240", jobs: [] } },
    { name: "run_strategy_regime_matrix", arguments: { expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240", jobs: Array(13).fill({ symbol: "OANDA:USDJPY", timeframe: "240",
        pine_id: "USER;regimematrix123" }) } },
    { name: "run_strategy_regime_matrix", arguments: { expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "240", load_more_bars: 20_001,
      jobs: [{ symbol: "OANDA:USDJPY", timeframe: "240", pine_id: "USER;regimematrix123" }] } },
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

test("set_symbol and set_timeframe target one explicit pane and report the resulting state", async () => {
  const charts = [
    { index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] },
    { index: 1, symbol: "OANDA:XAUUSD", resolution: "60", studies: [] },
  ];
  const calls = [];
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "two",
        activeChartIndex: 0,
        chartsCount: charts.length,
        charts,
      }),
      setSymbol: async (symbol, chartIndex) => {
        calls.push(["symbol", symbol, chartIndex]);
        charts[chartIndex].symbol = symbol;
        return { symbol, resolution: charts[chartIndex].resolution, changed: true, bars: 100 };
      },
      setResolution: async (resolution, chartIndex) => {
        calls.push(["timeframe", resolution, chartIndex]);
        charts[chartIndex].resolution = resolution;
        return { symbol: charts[chartIndex].symbol, resolution, changed: true, bars: 100 };
      },
    },
  }));
  const res = await client.callTool({
    name: "set_symbol",
    arguments: { symbol: "NASDAQ:AAPL", chart_index: 1 },
  });
  const symbolResult = JSON.parse(res.content[0].text);
  assert.equal(symbolResult.symbol, "NASDAQ:AAPL");
  assert.equal(symbolResult.transaction.original.symbol, "OANDA:XAUUSD");

  const res2 = await client.callTool({
    name: "set_timeframe",
    arguments: { resolution: "15", chart_index: 1 },
  });
  assert.equal(JSON.parse(res2.content[0].text).resolution, "15");
  assert.deepEqual(calls, [
    ["symbol", "NASDAQ:AAPL", 1],
    ["timeframe", "15", 1],
  ]);
  assert.deepEqual([charts[0].symbol, charts[0].resolution], ["OANDA:USDJPY", "240"]);
  assert.deepEqual([charts[1].symbol, charts[1].resolution], ["NASDAQ:AAPL", "15"]);
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
