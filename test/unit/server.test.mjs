import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../build/server.js";
import { EconomicCalendar } from "../../build/calendar.js";
import {
  ANALYSIS_OVERLAY_INPUTS,
  ANALYSIS_OVERLAY_LEGACY_INPUTS,
  ANALYSIS_OVERLAY_NAME,
  ANALYSIS_OVERLAY_SOURCE,
} from "../../build/analysisOverlay.js";
import { AnalysisDefinitionConflictError } from "../../build/analysisJournal.js";
import { analysisAlertOwnershipName } from "../../build/analysisAlerts.js";
import {
  COT_CROWDING_UNWIND_OVERLAY_NAME,
  COT_CROWDING_UNWIND_OVERLAY_SOURCE,
} from "../../build/cotCrowdingUnwindOverlay.js";
import {
  VOLUME_PROFILE_CONTEXT_NAME,
  VOLUME_PROFILE_CONTEXT_PLOTS,
  VOLUME_PROFILE_CONTEXT_SOURCE,
} from "../../build/volumeProfileContext.js";
import {
  PRICE_ACTION_CONTEXT_INPUTS,
  PRICE_ACTION_CONTEXT_NAME,
  PRICE_ACTION_CONTEXT_PLOTS,
  PRICE_ACTION_CONTEXT_SOURCE,
} from "../../build/priceActionContext.js";

function makeDeps(overrides = {}) {
  return {
    chartOperationLock: overrides.chartOperationLock ?? { acquire: async () => async () => {} },
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
      lastAttempts: async () => new Map(),
      recordAttempt: async (_analysisId, _definitionHash, result) => ({ attemptedAt: "2026-07-02T00:00:00.000Z", result }),
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
      registerEventHypothesis: async (payload) => ({ recorded: true, idempotent: false, entry: { payload } }),
      recordEventStudy: async (payload) => ({ recorded: true, idempotent: false, entry: { payload, evidence_hash: `sha256:${"f".repeat(64)}` } }),
      listEventStudies: async () => [],
      compareEventStudies: async (references) => ({ comparable: true, incompatibilities: [], studies: references }),
      compare: async (references) => ({ comparable: true, incompatibilities: [], experiments: references }),
      findHypothesis: async () => { throw new Error('unexpected research journal hypothesis lookup'); },
      ...overrides.researchJournal,
    },
    // Collecting first-seen open interest is optional, so it is only present when a test asks for it.
    ...(overrides.futuresOpenInterestHistory
      ? { futuresOpenInterestHistory: overrides.futuresOpenInterestHistory }
      : {}),
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
    policyRateHistory: {
      getAsOf: async (currency) => ({
        schema_version: "1.0", sequence: 1, series: "policy_rate", currency,
        source_symbol: `ECONOMICS:${currency === "USD" ? "US" : currency === "EUR" ? "EU" : currency.slice(0, 2)}INTR`,
        observation_date: "2026-06-17", value: currency === "USD" ? 3.75 : 2.4,
        source_observed_at: "2026-06-17T00:00:00.000Z", available_at: "2026-06-18T00:00:00.000Z",
        available_at_basis: "next_utc_business_day_start", first_seen_at: "2026-07-28T13:00:00.000Z",
      }),
      ...overrides.policyRateHistory,
    },
    policyRateOfficialHistory: {
      getLatest: async (currency) => ({
        schema_version: "1.0", sequence: 1, series: "policy_rate_official_history", evidence_tier: "exploratory_revised_history", currency,
        source_symbol: `ECONOMICS:${currency === "USD" ? "US" : currency === "EUR" ? "EU" : currency.slice(0, 2)}INTR`,
        observation_date: "2026-06-17", value: currency === "USD" ? 3.75 : 2.4,
        source_url: "https://example.test/policy-rate", source_vintage_at: null,
        raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        retrieved_at: "2026-07-29T13:00:00.000Z", first_seen_at: "2026-07-29T13:00:00.000Z",
      }),
      coverage: async () => ({ evidence_tier: "exploratory_revised_history", records: 1, raw_snapshots: 1, source_coverage: { ecb_deposit_facility: { coverage_status: "complete" } } }),
      ...overrides.policyRateOfficialHistory,
    },
    policyRateHeartbeats: overrides.policyRateHeartbeats,
    bookmapFlowDirectory: overrides.bookmapFlowDirectory,
    backtestLedgers: overrides.backtestLedgers,
    backtestSliceJournal: overrides.backtestSliceJournal,
    researchPeriodUsage: overrides.researchPeriodUsage ?? {
      recordToolAccess: async input => ({...input, source:'tool_observed', idempotent:false}),
      record: async () => {throw new Error('unexpected manual period write');},
      check: async () => {throw new Error('unexpected period check');},
      recordToolAccessBatch: async () => {throw new Error('unexpected forecast period write');},
      declareForwardPeriod: async () => {throw new Error('unexpected forward period declaration');},
      shortenForwardPeriod: async () => {throw new Error('unexpected forward period shortening');},
    },
    forecastSets: overrides.forecastSets ?? { get: async () => { throw new Error('unexpected forecast set read'); } },
    forecastLossJournal: overrides.forecastLossJournal ?? { record: async () => { throw new Error('unexpected forecast loss journal write'); } },
    // Every method of every realized covariance dependency throws unless injected: no test reads a default path.
    barSeries: overrides.barSeries ?? { get: async () => { throw new Error('unexpected bar series read'); } },
    proxySets: overrides.proxySets ?? {
      get: async () => { throw new Error('unexpected proxy set read'); },
      register: async () => { throw new Error('unexpected proxy set write'); },
    },
    realizedCovarianceJournal: overrides.realizedCovarianceJournal ?? {
      record: async () => { throw new Error('unexpected realized covariance journal write'); },
      findByProxySetId: async () => { throw new Error('unexpected realized covariance journal read'); },
      search: async () => { throw new Error('unexpected realized covariance journal read'); },
    },
    riskBacktestJournal: overrides.riskBacktestJournal ?? { record: async () => { throw new Error('unexpected risk backtest journal write'); } },
    zoneResolver: overrides.zoneResolver,
    cmeGoldOpenInterest: {
      getLatestGoldOpenInterest: async () => ({
        schema_version: "1.0",
        status: "complete",
        observation_date: "2026-07-24",
        open_interest: 376079,
        report_status: "final",
        bulletin_number: 141,
        source: "cme_daily_bulletin",
        source_detail: "GC_FUT",
        source_url: "https://example.test/Section62.pdf",
        observed_at: "2026-07-25T15:00:00.000Z",
      }),
      ...overrides.cmeGoldOpenInterest,
    },
    futuresOpenInterestHistory: overrides.futuresOpenInterestHistory,
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

test("summarize_backtest_ledger reads registered evidence without touching the chart", async (t) => {
  const { BacktestLedgerStore } = await import("../../build/backtestLedger.js");
  const { rm } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "mcp-ledger-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const data = JSON.parse(await readFile(new URL("../fixtures/backtest-ledger.json", import.meta.url), "utf8"));
  const store = new BacktestLedgerStore(dir);
  const { artifact_id } = await store.register(data);
  let chartCalls = 0;
  const client = await connectedClient(makeDeps({ backtestLedgers: store,
    tv: { getChartContext: async () => { chartCalls++; throw new Error("must not read chart"); } } }));
  t.after(() => client.close());
  const response = await client.callTool({ name: "summarize_backtest_ledger", arguments: {
    artifact_id, round_trip_cost_bps: 2, exclude_symbols: ["XAUUSD"], group_by: "symbol",
  } });
  assert.ok(!response.isError);
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.overall.profit_factor, 2);
  assert.equal(result.comparison.contract, 'same_ledger_filter_partition_v1');
  assert.equal(result.comparison.baseline.records, 5);
  assert.equal(result.comparison.baseline.break_even_cost.max_nonnegative_round_trip_cost_bps, 27.5);
  assert.equal(result.comparison.excluded.break_even_cost.max_nonnegative_round_trip_cost_bps, 100);
  assert.equal(result.overall.break_even_cost.mean_gross_bps, 10 / 3);
  assert.equal(result.overall.break_even_cost.missing_outcomes, 1);
  assert.equal(result.overall.break_even_cost.contract, 'flat_round_trip_cost_complete_case_v1');
  assert.equal(result.comparison.excluded.records, 1);
  assert.deepEqual(result.comparison.selected, result.overall);
  assert.equal(result.comparison.common_opportunities.delta_mean_net_bps, -24.5);
  assert.equal(result.comparison.status, 'partial');
  assert.equal(result.ledger_records, data.trades.length);
  assert.equal(result.selected_fraction, 4 / data.trades.length);
  assert.equal(result.overall.closed_trades, 3);
  assert.equal(result.overall.missing_outcomes, 1);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups.find(g => g.key === 'EURUSD').break_even_cost.max_nonnegative_round_trip_cost_bps, 6);
  assert.equal(result.groups.find(g => g.key === 'USDJPY').break_even_cost.status, 'negative_gross_mean');
  assert.equal(result.groups.find(g => g.key === 'USDJPY').break_even_cost.max_nonnegative_round_trip_cost_bps, null);
  assert.equal(result.artifact_id, artifact_id);
  assert.equal(result.exploration.status, 'untracked');
  assert.equal(chartCalls, 0);
  for (const args of [{ artifact_id }, { artifact_id: "../private", round_trip_cost_bps: 2 },
    { artifact_id: "sha256:" + "f".repeat(64), round_trip_cost_bps: 2 },
    { artifact_id, round_trip_cost_bps: 2, from: "2025-01-01T00:00:00.000Z", to: "2024-01-01T00:00:00.000Z" }]) {
    const failed = await client.callTool({ name: "summarize_backtest_ledger", arguments: args });
    assert.equal(failed.isError, true);
  }
});

test("summarize_backtest_ledger journals before exposing metrics and fails closed on recording failure", async (t) => {
  const { BacktestLedgerStore } = await import('../../build/backtestLedger.js');
  const { rm } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'slice-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const data = JSON.parse(await readFile(new URL('../fixtures/backtest-ledger.json', import.meta.url), 'utf8'));
  const store = new BacktestLedgerStore(dir);
  const { artifact_id } = await store.register(data);
  const calls = [];
  let fail = false;
  const client = await connectedClient(makeDeps({ backtestLedgers: store, backtestSliceJournal: {
    recordSummary: async (researchId, summary) => {
      calls.push({researchId, summary});
      if (fail) throw new Error('journal unavailable');
      return { status: 'tracked', call_count: calls.length };
    },
  }}));
  t.after(() => client.close());
  const args = {artifact_id, round_trip_cost_bps: 2, research_id: 'slice-review', group_by: 'symbol'};
  const response = await client.callTool({name: 'summarize_backtest_ledger', arguments: args});
  assert.ok(!response.isError);
  assert.equal(JSON.parse(response.content[0].text).exploration.call_count, 1);
  assert.equal(calls[0].researchId, 'slice-review');
  assert.equal(calls[0].summary.ledger_records, data.trades.length);
  assert.equal(calls[0].summary.filters.research_id, undefined);
  fail = true;
  const failed = await client.callTool({name: 'summarize_backtest_ledger', arguments: args});
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /journal unavailable/);
  assert.ok(!failed.content[0].text.includes('profit_factor'));
  const before = calls.length;
  for (const patch of [{research_id: '../invalid'}, {include_symbols: ['TYPO']}]) {
    const invalid = await client.callTool({name: 'summarize_backtest_ledger', arguments: {...args, ...patch}});
    assert.equal(invalid.isError, true);
  }
  assert.equal(calls.length, before);
  const {research_id, ...untrackedArgs} = args;
  const untracked = await client.callTool({name: 'summarize_backtest_ledger', arguments: untrackedArgs});
  assert.ok(!untracked.isError);
  assert.equal(JSON.parse(untracked.content[0].text).exploration.status, 'untracked');
  assert.equal(calls.length, before);
});

test("summarize_backtest_ledger persists slice counts across MCP calls", async (t) => {
  const { BacktestLedgerStore } = await import('../../build/backtestLedger.js');
  const { BacktestSliceJournalStore } = await import('../../build/backtestSliceJournal.js');
  const { rm } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'slice-persist-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const data = JSON.parse(await readFile(new URL('../fixtures/backtest-ledger.json', import.meta.url), 'utf8'));
  const store = new BacktestLedgerStore(join(dir, 'ledgers'));
  const { artifact_id } = await store.register(data);
  const client = await connectedClient(makeDeps({backtestLedgers: store,
    backtestSliceJournal: new BacktestSliceJournalStore(join(dir, 'slices.jsonl'))}));
  t.after(() => client.close());
  const args = {artifact_id, round_trip_cost_bps: 2, research_id: 'integration', group_by: 'symbol'};
  for (let i = 1; i <= 2; i++) {
    const response = await client.callTool({name: 'summarize_backtest_ledger', arguments: args});
    assert.ok(!response.isError, response.content[0].text);
    const r = JSON.parse(response.content[0].text);
    assert.equal(r.exploration.call_count, i);
    assert.equal(r.exploration.distinct_conditions, 1);
    assert.equal(r.candidateEligible, false);
    assert.ok(!r.limitations.includes('slice_search_count_is_not_tracked'));
  }
  const response = await client.callTool({name: 'summarize_backtest_ledger', arguments: {...args, round_trip_cost_bps: 3}});
  const r = JSON.parse(response.content[0].text);
  assert.equal(r.exploration.call_count, 3);
  assert.equal(r.exploration.distinct_conditions, 2);
  const boundary = await client.callTool({name: 'summarize_backtest_ledger', arguments: {...args, research_id: 'a'.repeat(120)}});
  assert.ok(!boundary.isError, boundary.content[0].text);
  assert.equal(JSON.parse(boundary.content[0].text).exploration.call_count, 1);
  const tooLong = await client.callTool({name: 'summarize_backtest_ledger', arguments: {...args, research_id: 'a'.repeat(121)}});
  assert.equal(tooLong.isError, true);
});

test('ledger automatic usage records the full envelope, retries safely and fails before metrics',async t=>{
  const {BacktestLedgerStore}=await import('../../build/backtestLedger.js');
  const {ResearchPeriodUsageStore}=await import('../../build/researchPeriodUsage.js');
  const {rm}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'automatic-usage-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const ledger=JSON.parse(await readFile(new URL('../fixtures/backtest-ledger.json',import.meta.url),'utf8'));
  const ledgers=new BacktestLedgerStore(join(dir,'ledgers'));
  const {artifact_id}=await ledgers.register(ledger);
  const path=join(dir,'usage.jsonl');
  const usage=new ResearchPeriodUsageStore(path);
  let failUsage=false,failSlice=false,sliceCalls=0;
  const client=await connectedClient(makeDeps({backtestLedgers:ledgers,
    researchPeriodUsage:{record:input=>usage.record(input),check:input=>usage.check(input),
      recordToolAccess:input=>{if(failUsage)throw new Error('usage unavailable');return usage.recordToolAccess(input);}},
    backtestSliceJournal:{recordSummary:async()=>{sliceCalls++;if(failSlice)throw new Error('slice unavailable');return {status:'tracked'};}}}));
  t.after(()=>client.close());
  const args={artifact_id,round_trip_cost_bps:2,research_id:'auto',usage_access_id:'attempt-1',exclude_symbols:['XAUUSD']};
  const call=async input=>client.callTool({name:'summarize_backtest_ledger',arguments:input});
  const first=await call(args);
  assert.ok(!first.isError,first.content[0].text);
  const value=JSON.parse(first.content[0].text).period_usage;
  assert.equal(value.record.source,'tool_observed');
  assert.equal(value.record.from,'2024-01-02T00:00:00.000Z');
  assert.equal(value.record.to,'2024-02-01T00:00:00.001Z');
  assert.equal(value.record.data_version,artifact_id);
  const retry=await call(args);
  assert.ok(!retry.isError,retry.content[0].text);
  assert.equal(JSON.parse(retry.content[0].text).period_usage.record.idempotent,true);
  assert.equal((await readFile(path,'utf8')).trim().split('\n').length,1);
  const conflict=await call({...args,round_trip_cost_bps:3});
  assert.equal(conflict.isError,true);
  assert.equal(sliceCalls,2);
  failUsage=true;
  const fail=await call({...args,usage_access_id:'attempt-2'});
  assert.equal(fail.isError,true);
  assert.ok(!fail.content[0].text.includes('profit_factor'));
  assert.equal(sliceCalls,2);
  failUsage=false;failSlice=true;
  const partial=await call({...args,usage_access_id:'attempt-2'});
  assert.equal(partial.isError,true);
  assert.equal((await readFile(path,'utf8')).trim().split('\n').length,2);
  failSlice=false;
  assert.ok(!(await call({...args,usage_access_id:'attempt-2'})).isError);
  assert.equal((await readFile(path,'utf8')).trim().split('\n').length,2);
  const empty=await call({...args,usage_access_id:'empty',from:'2025-01-01T00:00:00.000Z'});
  assert.ok(!empty.isError,empty.content[0].text);
  assert.equal(JSON.parse(empty.content[0].text).period_usage.record.from,value.record.from);
  const {research_id,usage_access_id,...untracked}=args;
  const count=(await readFile(path,'utf8')).trim().split('\n').length;
  assert.equal(JSON.parse((await call(untracked)).content[0].text).period_usage.status,'untracked');
  assert.equal((await readFile(path,'utf8')).trim().split('\n').length,count);
  assert.equal((await call({...untracked,usage_access_id:'orphan'})).isError,true);
});

test('automatic usage preserves source identity across revisions and separates retry counts',async t=>{
  const {BacktestLedgerStore}=await import('../../build/backtestLedger.js');
  const {BacktestSliceJournalStore}=await import('../../build/backtestSliceJournal.js');
  const {ResearchPeriodUsageStore}=await import('../../build/researchPeriodUsage.js');
  const {rm}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'auto-real-journals-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const ledger=JSON.parse(await readFile(new URL('../fixtures/backtest-ledger.json',import.meta.url),'utf8'));
  const ledgers=new BacktestLedgerStore(join(dir,'ledgers'));
  const original=await ledgers.register(ledger);
  const revised=await ledgers.register({...ledger,trades:ledger.trades.map(r=>({...r,gross_return_bps:r.gross_return_bps===null?null:r.gross_return_bps+1}))});
  const path=join(dir,'usage.jsonl');
  const client=await connectedClient(makeDeps({backtestLedgers:ledgers,
    researchPeriodUsage:new ResearchPeriodUsageStore(path),
    backtestSliceJournal:new BacktestSliceJournalStore(join(dir,'slices.jsonl'))}));
  t.after(()=>client.close());
  const args={artifact_id:original.artifact_id,round_trip_cost_bps:2,research_id:'real-auto'};
  const call=async patch=>{
    const response=await client.callTool({name:'summarize_backtest_ledger',arguments:{...args,...patch}});
    assert.ok(!response.isError,response.content[0].text);
    return JSON.parse(response.content[0].text);
  };
  const first=await call({usage_access_id:'same'});
  const retry=await call({usage_access_id:'same'});
  assert.equal(first.exploration.call_count,1);
  assert.equal(retry.exploration.call_count,2);
  assert.equal(retry.period_usage.record.idempotent,true);
  // The ledger summary returns the full record, so it carries the forward period fields too (plan P-Q10).
  assert.equal(first.period_usage.record.overlapped_forward_period_declarations.status,'available');
  assert.equal(first.period_usage.record.prior_overlap.forward_period_declarations.total,0);
  assert.deepEqual(retry.period_usage.record.overlapped_forward_period_declarations,first.period_usage.record.overlapped_forward_period_declarations);
  assert.equal((await readFile(path,'utf8')).trim().split('\n').length,1);
  const other=await call({artifact_id:revised.artifact_id,usage_access_id:'revision'});
  assert.equal(other.period_usage.record.series_id,first.period_usage.record.series_id);
  assert.notEqual(other.period_usage.record.data_version,first.period_usage.record.data_version);
  assert.equal(other.period_usage.record.prior_overlap.overlapping_records,1);
  assert.equal(other.period_usage.record.prior_overlap.matches[0].version_relation,'different');
  const a=await call({}),b=await call({});
  assert.match(a.period_usage.access_id,/^ledger-access:[a-f0-9-]{36}$/);
  assert.notEqual(a.period_usage.access_id,b.period_usage.access_id);
  assert.equal((await readFile(path,'utf8')).trim().split('\n').length,4);
});

test('research period tools require explicit recording and do not hide storage failures', async (t) => {
  const calls=[];
  const client=await connectedClient(makeDeps({researchPeriodUsage:{
    record:async(input)=>{calls.push(input);return {recorded:true,unused_proven:false};},
    check:async(input)=>{calls.push(input);return {status:'no_recorded_overlap',unused_proven:false};},
  }}));
  t.after(()=>client.close());
  const base={series_id:'FX.EURUSD',data_version:'sha256:'+'a'.repeat(64),from:'2024-01-01T00:00:00.000Z',to:'2024-02-01T00:00:00.000Z'};
  const record={...base,access_id:'access-1',research_id:'study-1',purpose:'exploration',accessed_at:'2025-01-01T00:00:00.000Z'};
  const denied=await client.callTool({name:'record_research_period_usage',arguments:record});
  assert.equal(denied.isError,true);
  assert.equal(calls.length,0);
  const ok=await client.callTool({name:'record_research_period_usage',arguments:{...record,confirm:true}});
  assert.ok(!ok.isError,ok.content[0].text);
  assert.deepEqual(calls[0],record);
  const checked=await client.callTool({name:'check_research_period_usage',arguments:base});
  assert.ok(!checked.isError,checked.content[0].text);
  assert.equal(JSON.parse(checked.content[0].text).unused_proven,false);
  for(const name of ['record_research_period_usage','check_research_period_usage']) {
    const bad=await client.callTool({name,arguments:{...record,confirm:true,to:base.from}});
    assert.equal(bad.isError,true);
  }
  assert.equal(calls.length,2);
  const broken=await connectedClient(makeDeps({researchPeriodUsage:{
    record:async()=>{throw new Error('period journal unavailable');},
    check:async()=>{throw new Error('period journal unavailable');},
  }}));
  t.after(()=>broken.close());
  for(const name of ['record_research_period_usage','check_research_period_usage']) {
    const r=await broken.callTool({name,arguments:name.startsWith('record')?{...record,confirm:true}:base});
    assert.equal(r.isError,true);
    assert.match(r.content[0].text,/period journal unavailable/);
  }
});

test('research period usage detects cross-version access through the real MCP store', async (t) => {
  const {ResearchPeriodUsageStore}=await import('../../build/researchPeriodUsage.js');
  const {rm}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'period-mcp-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let chartCalls=0;
  const client=await connectedClient(makeDeps({researchPeriodUsage:new ResearchPeriodUsageStore(join(dir,'usage.jsonl')),
    tv:{getChartContext:async()=>{chartCalls++;throw new Error('no chart');}}}));
  t.after(()=>client.close());
  const base={series_id:'FX.EURUSD',data_version:'sha256:'+'a'.repeat(64),from:'2024-01-01T00:00:00.000Z',to:'2024-02-01T00:00:00.000Z'};
  const call=async(name,args)=>{
    const r=await client.callTool({name,arguments:args});
    assert.ok(!r.isError,r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  const empty=await call('check_research_period_usage',{...base,prior_usage_declaration:'declared_unused'});
  assert.equal(empty.unused_proven,false);
  assert.equal(empty.overlapping_records,0);
  const record={...base,access_id:'mcp-access',research_id:'old-study',purpose:'exploration',accessed_at:'2025-01-01T00:00:00.000Z',confirm:true};
  await call('record_research_period_usage',record);
  await call('record_research_period_usage',record);
  const found=await call('check_research_period_usage',{...base,data_version:'sha256:'+'b'.repeat(64),from:'2024-01-15T00:00:00.000Z'});
  assert.equal(found.overlapping_records,1);
  assert.equal(found.unused_proven,false);
  const adjacent=await call('check_research_period_usage',{...base,from:base.to,to:'2024-03-01T00:00:00.000Z'});
  assert.equal(adjacent.overlapping_records,0);
  assert.equal(chartCalls,0);
});

test('research period usage batch and summary_only through the real MCP store', async (t) => {
  const {ResearchPeriodUsageStore}=await import('../../build/researchPeriodUsage.js');
  const {rm,readFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'period-batch-mcp-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'usage.jsonl');
  const client=await connectedClient(makeDeps({researchPeriodUsage:new ResearchPeriodUsageStore(path)}));
  t.after(()=>client.close());
  const period=(series)=>({series_id:series,data_version:'sha256:'+'a'.repeat(64),from:'2024-01-01T00:00:00.000Z',to:'2024-02-01T00:00:00.000Z'});
  const entry=(id,series,research='study-a')=>({...period(series),access_id:id,research_id:research,purpose:'exploration',accessed_at:'2025-01-01T00:00:00.000Z'});
  const call=async(name,args)=>{
    const r=await client.callTool({name,arguments:args});
    assert.ok(!r.isError,r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  const records=[entry('b1','FX.EURUSD'),entry('b2','FX.USDJPY'),entry('b3','FX.EURUSD','study-b')];
  const denied=await client.callTool({name:'record_research_period_usage_batch',arguments:{records}});
  assert.equal(denied.isError,true);
  const first=await call('record_research_period_usage_batch',{records,confirm:true,summary_only:true});
  assert.deepEqual([first.recorded,first.idempotent],[3,0]);
  assert.deepEqual(first.results.map((r)=>r.sequence),[1,2,3]);
  // Appended in order: the third record sees the first as prior overlap, in summary form.
  assert.equal(first.results[2].prior_overlap.overlapping_records,1);
  assert.deepEqual(first.results[2].prior_overlap.overlapping_research_ids,['study-a']);
  assert.equal('matches' in first.results[2].prior_overlap,false);
  const retry=await call('record_research_period_usage_batch',{records,confirm:true});
  assert.deepEqual([retry.recorded,retry.idempotent],[0,3]);
  assert.equal(retry.results[2].prior_overlap.matches.length,1);
  const before=await readFile(path,'utf8');
  for(const bad of [[...records.slice(0,2),{...records[2],purpose:'validation'}],
    [entry('new-1','FX.GBPUSD'),entry('new-1','FX.AUDNZD')], []]) {
    const r=await client.callTool({name:'record_research_period_usage_batch',arguments:{records:bad,confirm:true}});
    assert.equal(r.isError,true);
  }
  assert.equal(await readFile(path,'utf8'),before,'a rejected batch writes nothing');
  // A future accessed_at is checked by the store on its own clock, so it is a tool error, not an input error
  // (docs/FORWARD_PERIOD_PLAN.md, P-Q1). Either way nothing is written.
  for(const [name,args] of [['record_research_period_usage_batch',{records:[{...entry('future-1','FX.GBPUSD'),accessed_at:'2099-01-01T00:00:00.000Z'}],confirm:true}],
    ['record_research_period_usage',{...entry('future-2','FX.GBPUSD'),accessed_at:'2099-01-01T00:00:00.000Z',confirm:true}]]) {
    const r=await client.callTool({name,arguments:args});
    assert.equal(r.isError,true,name);
    assert.match(r.content[0].text,/^Error: accessed_at must not be in the future$/,name);
  }
  assert.equal(await readFile(path,'utf8'),before);
  const full=await call('check_research_period_usage',period('FX.EURUSD'));
  const brief=await call('check_research_period_usage',{...period('FX.EURUSD'),summary_only:true});
  assert.equal(full.matches.length,2);
  assert.deepEqual([brief.overlapping_records,brief.matches_omitted,brief.unused_proven],[2,2,false]);
  assert.deepEqual(brief.overlapping_research_ids,['study-a','study-b']);
  assert.ok(brief.limitations.includes('no_recorded_overlap_is_not_proof_of_unused_data'));
  const pre=await call('preflight_research_oos',{...period('FX.EURUSD'),summary_only:true});
  assert.equal(pre.status,'blocked');
  assert.equal('matches' in pre.usage,false);
  const single=await call('record_research_period_usage',{...entry('s1','FX.EURUSD','study-c'),confirm:true,summary_only:true});
  assert.equal(single.prior_overlap.matches_omitted,2);
});

test('compare_research_evidence reports changed and unknown declarations without chart access', async (t) => {
  let calls=0;
  const client=await connectedClient(makeDeps({tv:{getChartContext:async()=>{calls++;throw new Error('unexpected chart');}}}));
  t.after(()=>client.close());
  const keys=['data_sha256','code_sha256','runner_sha256','candidate_rule_sha256','parameters_sha256','environment_sha256'];
  const previous=Object.fromEntries(keys.map(k=>[k,'sha256:'+'a'.repeat(64)]));
  const call=async(current)=>{
    const response=await client.callTool({name:'compare_research_evidence',arguments:{previous,current}});
    assert.ok(!response.isError);
    return JSON.parse(response.content[0].text);
  };
  const changed=await call({...previous,code_sha256:'sha256:'+'b'.repeat(64)});
  assert.deepEqual(changed.changed_fields,['code_sha256']);
  assert.equal(changed.fields[0].status,'match');
  assert.equal(changed.revalidation,'required');
  assert.ok(changed.required_checks.includes('reproduce_previous_ledger'));
  const unknown=await call({});
  assert.equal(unknown.status,'incomplete');
  assert.equal(unknown.unknown_fields.length,6);
  const same=await call(previous);
  assert.equal(same.status,'matching_declarations');
  assert.equal(same.compatibility_proven,false);
  assert.equal(same.candidateEligible,false);
  const extra=await client.callTool({name:'compare_research_evidence',arguments:{previous,current:previous,execute:true}});
  assert.equal(extra.isError,true);
  for(const current of [{data_sha256:'invalid'}, {path:'/tmp/data'}]) {
    const response=await client.callTool({name:'compare_research_evidence',arguments:{previous,current}});
    assert.equal(response.isError,true);
  }
  assert.equal(calls,0);
});

test('OOS preflight returns refusal or review without accessing charts, and propagates failures',async t=>{
  const {ResearchPeriodUsageStore}=await import('../../build/researchPeriodUsage.js');
  const {rm,writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'oos-preflight-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'usage.jsonl'), store=new ResearchPeriodUsageStore(path);
  let chartCalls=0;
  const client=await connectedClient(makeDeps({researchPeriodUsage:store,
    tv:{getChartContext:async()=>{chartCalls++;throw new Error('unexpected chart');}}}));
  t.after(()=>client.close());
  const args={series_id:'test',data_version:'sha256:'+'a'.repeat(64),from:'2024-01-01T00:00:00.000Z',to:'2024-02-01T00:00:00.000Z',prior_usage_declaration:'declared_unused'};
  const call=()=>client.callTool({name:'preflight_research_oos',arguments:args});
  const empty=await call();
  assert.ok(!empty.isError);
  assert.equal(JSON.parse(empty.content[0].text).status,'review_required');
  const {prior_usage_declaration,...period}=args;
  await store.recordToolAccess({...period,access_id:'observed',research_id:'other',purpose:'exploration',request_sha256:'sha256:'+'b'.repeat(64)});
  const blocked=await call();
  assert.ok(!blocked.isError);
  const r=JSON.parse(blocked.content[0].text);
  assert.equal(r.status,'blocked');
  assert.equal(r.execution_allowed,false);
  assert.equal(r.usage.matches[0].source,'tool_observed');
  const extra=await client.callTool({name:'preflight_research_oos',arguments:{...args,execute:true}});
  assert.equal(extra.isError,true);
  await writeFile(path,'broken\n');
  assert.equal((await call()).isError,true);
  assert.equal(chartCalls,0);
});

test("exposes exactly the one hundred twelve expected tools", async () => {
  const client = await connectedClient(makeDeps());
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "add_pine_to_chart",
      "apply_analysis_overlay",
      "audit_pine_indicator",
      "backtest_risk_forecast",
      "carry_panel_preflight",
      "check_research_period_usage",
      "classify_cross_asset_shocks",
      "compare_forecast_losses",
      "compare_indicator_observations",
      "compare_research_evidence",
      "compare_strategy_experiments",
      "compute_correlation_regimes",
      "compute_feature_outcome_relationships",
      "compute_lead_lag_relationships",
      "compute_market_features",
      "compute_market_regimes",
      "compute_position_size",
      "compute_realized_covariance",
      "compute_round_trip_cost",
      "compute_session_profile",
      "create_analysis_alerts",
      "declare_forward_period",
      "ensure_analysis_overlay",
      "estimate_carry_panel_effective_sample",
      "evaluate_analysis_overlay_outcome",
      "evaluate_cross_asset_shock_outcomes",
      "evaluate_due_analyses",
      "get_aligned_history",
      "get_analysis_calibration",
      "get_analysis_journal",
      "get_analysis_overlay_status",
      "get_analysis_overlay_template",
      "get_analysis_performance",
      "get_carry_core_primary_readiness",
      "get_chart_context",
      "get_chart_screenshot",
      "get_cme_gold_open_interest",
      "get_cot_crowding_unwind_context",
      "get_cot_crowding_unwind_overlay_template",
      "get_dxy_context_gate_template",
      "get_economic_events",
      "get_event_study_journal",
      "get_execution_snapshot",
      "get_exploratory_policy_rate_history",
      "get_futures_flow_context",
      "get_indicator_graphics",
      "get_indicator_inputs",
      "get_indicator_tables",
      "get_indicator_values",
      "get_key_levels",
      "get_market_snapshot",
      "get_mtf_overview",
      "get_oanda_flow_collection_readiness",
      "get_ohlcv",
      "get_pine_source",
      "get_policy_rate_context",
      "get_positioning_context",
      "get_price_action_context",
      "get_price_action_context_template",
      "get_quotes",
      "get_real_yield_context",
      "get_replay_status",
      "get_strategy_report",
      "get_strategy_trade_ledger",
      "get_trade_decision_context",
      "get_volume_profile_context",
      "get_volume_profile_context_template",
      "get_watchlist",
      "list_alerts",
      "list_pine_scripts",
      "load_more_history",
      "measure_carry_panel_dependence",
      "preflight_bookmap_flow_price_join",
      "preflight_cross_asset_shock",
      "preflight_research_oos",
      "reconcile_gold_open_interest",
      "record_research_period_usage",
      "record_research_period_usage_batch",
      "record_strategy_experiment",
      "register_event_study_hypothesis",
      "register_strategy_hypothesis",
      "remove_owned_study",
      "run_backtest",
      "run_backtest_matrix",
      "run_carry_core_primary_test",
      "run_event_study_falsification_audit",
      "run_external_label_study",
      "run_feature_outcome_falsification_audit",
      "run_feature_outcome_power_audit",
      "run_lead_lag_falsification_audit",
      "run_market_event_study",
      "run_price_action_pattern_study",
      "run_strategy_experiment",
      "run_strategy_regime_analysis",
      "run_strategy_regime_matrix",
      "run_strategy_walk_forward",
      "run_volume_profile_poc_reversion_study",
      "run_volume_profile_reaction_study",
      "run_yield_price_nonconfirmation_study",
      "save_pine_script",
      "scan_market",
      "set_indicator_input",
      "set_symbol",
      "set_timeframe",
      "shorten_forward_period",
      "start_chart_replay",
      "step_chart_replay",
      "stop_chart_replay",
      "stress_test_strategy",
      "summarize_backtest_ledger",
      "validate_research_protocol",
      "validate_trade_plan",
    ],
  );
});

test("Bookmap flow price preflight binds EURUSD M1 and reads only the configured local evidence session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tv-mcp-bookmap-flow-"));
  const fileName = "bookmap-flow-6EQ6.CME_BMD-1.jsonl";
  const receivedAt = "2026-08-10T00:00:10.000Z";
  const rows = [
    { schema_version: "1.1", source: "bookmap", event_type: "instrument", instrument_alias: "6EQ6.CME@BMD", bookmap_time_ns: "1780000000000000001", received_at: "2026-08-10T00:00:01.000Z", symbol: "6EQ6", exchange: "CME", is_full_depth: true, mbo_captured: false, is_crypto: false },
    { schema_version: "1.1", source: "bookmap", event_type: "snapshot_end", instrument_alias: "6EQ6.CME@BMD", bookmap_time_ns: "1780000000000000002", received_at: "2026-08-10T00:00:02.000Z" },
    { schema_version: "1.1", source: "bookmap", event_type: "trade", instrument_alias: "6EQ6.CME@BMD", bookmap_time_ns: "1780000000000000003", received_at: receivedAt, aggressor: "buy", size: 2 },
  ];
  await writeFile(join(directory, fileName), `${rows.map(JSON.stringify).join("\n")}\n`);
  const bars = [
    { time: Date.parse("2026-08-10T00:01:00.000Z") / 1000, timeIso: "2026-08-10T00:01:00.000Z", open: 1.1, high: 1.1, low: 1.1, close: 1.1, volume: 1 },
  ];
  const client = await connectedClient(makeDeps({
    bookmapFlowDirectory: directory,
    tv: {
      getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1, charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "1", studies: [] }] }),
      getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "1", count: bars.length, bars }),
    },
  }));
  const response = await client.callTool({ name: "preflight_bookmap_flow_price_join", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "1", session_file: fileName, minimum_intervals: 1,
  } });
  assert.notEqual(response.isError, true, response.content[0].text);
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.coverage.exact_target_bar_intervals, 1);
  assert.equal(parsed.contract.minimum_target_lag_bars, 1);
});

test("reconcile_gold_open_interest only returns same-day official CME evidence", async () => {
  const client = await connectedClient(makeDeps({
    cot: {
      getHistory: async () => ({
        symbol: "OANDA:XAUUSD",
        requested_weeks: 2,
        observations: [
          { report_date: "2026-07-21T00:00:00.000Z", open_interest: 383368 },
          { report_date: "2026-07-14T00:00:00.000Z", open_interest: 383689 },
        ],
        positioning_features: {},
      }),
    },
    futuresOpenInterestHistory: {
      getSeriesAsOf: async (input) => {
        assert.equal(input.source, "cme_daily_bulletin");
        assert.equal(input.sourceDetail, "GC_FUT");
        assert.equal(input.from, "2026-07-14");
        assert.equal(input.to, "2026-07-21");
        return [{ observation_date: "2026-07-21", open_interest: 379963, first_seen_at: "2026-07-22T15:00:00.000Z" }];
      },
    },
  }));
  const response = await client.callTool({ name: "reconcile_gold_open_interest", arguments: { weeks: 2 } });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.status, "partial");
  assert.deepEqual(parsed.comparisons.map((item) => item.observation_date), ["2026-07-21"]);
  assert.deepEqual(parsed.unmatched_cot_dates, ["2026-07-14"]);
});

test("get_cme_gold_open_interest records the official aggregate in its own source series", async () => {
  const observations = [];
  const client = await connectedClient(makeDeps({
    futuresOpenInterestHistory: {
      observeMany: async (items) => {
        observations.push(...items);
        return { recorded: items, unchanged: 0, revisions: 0 };
      },
    },
  }));
  const response = await client.callTool({ name: "get_cme_gold_open_interest", arguments: {} });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.open_interest, 376079);
  assert.deepEqual(parsed.first_seen, { recorded: 1, unchanged: 0, revisions: 0 });
  assert.deepEqual(observations, [{
    futures_symbol: "COMEX_DL:GC1!",
    scope: "all_months_aggregated",
    observation_date: "2026-07-24",
    open_interest: 376079,
    source: "cme_daily_bulletin",
    source_detail: "GC_FUT",
    report_status: "final",
    observed_at: "2026-07-25T15:00:00.000Z",
  }]);
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

test("a tool error carrying Authorization headers reaches neither the client nor stderr with the credential (102-02)", async (t) => {
  const client = await connectedClient(makeDeps({ tv: { getOhlcv: async () => {
    throw new Error('request failed with headers {"Authorization":"Basic dXNlcjpwYXNz"} and Authorization: Bearer sk-live-123');
  } } }));
  const logged = t.mock.method(console, "error", () => {});
  const res = await client.callTool({ name: "get_ohlcv", arguments: {} });
  assert.equal(res.isError, true);
  const text = res.content[0].text;
  assert.match(text, /request failed with headers/);
  for (const secret of ["dXNlcjpwYXNz", "sk-live-123"]) {
    assert.ok(!text.includes(secret), text);
    for (const call of logged.mock.calls) assert.ok(!call.arguments.join(" ").includes(secret), "stderr must not carry it either");
  }
  assert.ok(logged.mock.calls.length > 0, "the redacted detail goes to stderr");
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

test("compute_correlation_regimes binds two exact-time chart histories", async () => {
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
      { index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] },
      { index: 1, symbol: "TVC:DXY", resolution: "60", studies: [] },
    ] }),
    getOhlcv: async (_count, chartIndex) => {
      const closes = chartIndex === 0 ? [100, 101, 103, 106] : [100, 99, 97, 94];
      return { symbol: chartIndex === 0 ? "OANDA:EURUSD" : "TVC:DXY", resolution: "60", count: closes.length,
        bars: closes.map((close, index) => ({ time: index * 3600, timeIso: new Date(index * 3_600_000).toISOString(),
          open: close, high: close, low: close, close, volume: 1 })) };
    },
  }}));
  const response = await client.callTool({ name: "compute_correlation_regimes", arguments: {
    primary_chart_index: 0, reference_chart_index: 1, expected_primary_symbol: "OANDA:EURUSD",
    expected_reference_symbol: "TVC:DXY", expected_timeframe: "60", window: 2,
  } });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.alignmentPolicy, "exact_utc_timestamp_no_forward_fill");
  assert.equal(parsed.observations.at(-1).regime, "strong_negative");
});

test("preflight_cross_asset_shock reads exact-time contexts and restores the auxiliary chart", async () => {
  const targetChart = { symbol: "OANDA:EURUSD", resolution: "15" };
  const auxiliaryChart = { symbol: "OANDA:GBPUSD", resolution: "60" };
  const operations = [];
  const historyLoads = [];
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
    { index: 0, symbol: targetChart.symbol, resolution: targetChart.resolution, studies: [] },
    { index: 1, symbol: auxiliaryChart.symbol, resolution: auxiliaryChart.resolution, studies: [] },
  ] });
  const barsFor = (symbol) => Array.from({ length: 120 }, (_, index) => {
    const close = 100 + index + symbol.length / 100;
    const time = Date.UTC(2026, 0, 2) / 1_000 + index * 900;
    return { time, timeIso: new Date(time * 1_000).toISOString(), open: close - 0.1,
      high: close + 0.2, low: close - 0.2, close, volume: 1 };
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getOhlcv: async (count, chartIndex) => {
      const chart = chartIndex === 0 ? targetChart : auxiliaryChart;
      return { symbol: chart.symbol, resolution: chart.resolution, count, bars: barsFor(chart.symbol) };
    },
    setSymbol: async (symbol, chartIndex) => {
      assert.equal(chartIndex, 1);
      auxiliaryChart.symbol = symbol;
      operations.push(`symbol:${symbol}`);
      return { symbol, resolution: auxiliaryChart.resolution, bars: 120 };
    },
    setResolution: async (resolution, chartIndex) => {
      assert.equal(chartIndex, 1);
      auxiliaryChart.resolution = resolution;
      operations.push(`resolution:${resolution}`);
      return { symbol: auxiliaryChart.symbol, resolution, bars: 120 };
    },
    loadMoreHistory: async ({ count, chartIndex }) => {
      historyLoads.push({ count, chartIndex });
      return { requested: count, barsBefore: 300, barsAfter: 400, added: 100, moreAvailable: true };
    },
  }}));

  const response = await client.callTool({ name: "preflight_cross_asset_shock", arguments: {
    target_chart_index: 0, auxiliary_chart_index: 1, expected_target_symbol: "OANDA:EURUSD",
    expected_timeframe: "15", count: 120, minimum_aligned_bars: 100, load_more_bars: 100,
  } });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.alignment.common_closed_bars, 120);
  assert.deepEqual(parsed.execution.auxiliary_original, { symbol: "OANDA:GBPUSD", timeframe: "60" });
  assert.equal(parsed.execution.auxiliary_restored_after_each_context_read, true);
  assert.deepEqual(historyLoads, [
    { count: 100, chartIndex: 0 }, { count: 100, chartIndex: 1 },
    { count: 100, chartIndex: 1 }, { count: 100, chartIndex: 1 },
  ]);
  assert.equal(parsed.execution.history_load.requested_additional_bars_per_series, 100);
  assert.equal(parsed.execution.history_load.results.us_yield.added, 100);
  assert.deepEqual(auxiliaryChart, { symbol: "OANDA:GBPUSD", resolution: "60" });
  assert.deepEqual(operations, [
    "resolution:15", "symbol:TVC:DXY", "symbol:OANDA:GBPUSD", "resolution:60",
    "resolution:15", "symbol:TVC:US10Y", "symbol:OANDA:GBPUSD", "resolution:60",
    "resolution:15", "symbol:OANDA:XAUUSD", "symbol:OANDA:GBPUSD", "resolution:60",
  ]);
});

test("preflight_cross_asset_shock restores the auxiliary chart when a temporary history is misbound", async () => {
  const targetChart = { symbol: "OANDA:USDJPY", resolution: "5" };
  const auxiliaryChart = { symbol: "OANDA:EURUSD", resolution: "15" };
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
    { index: 0, symbol: targetChart.symbol, resolution: targetChart.resolution, studies: [] },
    { index: 1, symbol: auxiliaryChart.symbol, resolution: auxiliaryChart.resolution, studies: [] },
  ] });
  const bars = Array.from({ length: 120 }, (_, index) => ({ time: 1_700_000_000 + index * 300,
    timeIso: new Date((1_700_000_000 + index * 300) * 1_000).toISOString(), open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getOhlcv: async (_count, chartIndex) => {
      const chart = chartIndex === 0 ? targetChart : auxiliaryChart;
      return { symbol: chart.symbol === "TVC:US10Y" ? "TVC:DXY" : chart.symbol, resolution: chart.resolution, count: bars.length, bars };
    },
    setSymbol: async (symbol, chartIndex) => {
      assert.equal(chartIndex, 1);
      auxiliaryChart.symbol = symbol;
      return { symbol, resolution: auxiliaryChart.resolution, bars: bars.length };
    },
    setResolution: async (resolution, chartIndex) => {
      assert.equal(chartIndex, 1);
      auxiliaryChart.resolution = resolution;
      return { symbol: auxiliaryChart.symbol, resolution, bars: bars.length };
    },
  }}));

  const response = await client.callTool({ name: "preflight_cross_asset_shock", arguments: {
    target_chart_index: 0, auxiliary_chart_index: 1, expected_target_symbol: "OANDA:USDJPY",
    expected_timeframe: "5", count: 120, minimum_aligned_bars: 100,
  } });
  assert.match(response.content[0].text, /cross-asset shock us_yield OHLC does not match/);
  assert.deepEqual(auxiliaryChart, { symbol: "OANDA:EURUSD", resolution: "15" });
});

test("classify_cross_asset_shocks classifies a frozen observed state and restores the auxiliary chart", async () => {
  const targetChart = { symbol: "OANDA:EURUSD", resolution: "15" };
  const auxiliaryChart = { symbol: "OANDA:XAUUSD", resolution: "1D" };
  const historyLoads = [];
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
    { index: 0, symbol: targetChart.symbol, resolution: targetChart.resolution, studies: [] },
    { index: 1, symbol: auxiliaryChart.symbol, resolution: auxiliaryChart.resolution, studies: [] },
  ] });
  const barsFor = (symbol) => {
    const start = Date.UTC(2026, 0, 2, 13, 45) / 1_000;
    const rows = [];
    for (let week = 0; week < 13; week += 1) {
      const time = start + week * 7 * 24 * 60 * 60;
      const movement = week < 12 ? 0.0001 : 0.005;
      const polarity = symbol === "TVC:DXY" || symbol === "TVC:US10Y" ? -1 : 1;
      rows.push({ time, timeIso: new Date(time * 1_000).toISOString(), open: 100, high: 100, low: 100, close: 100, volume: 1 });
      rows.push({ time: time + 900, timeIso: new Date((time + 900) * 1_000).toISOString(), open: 100,
        high: 101, low: 99, close: 100 * (1 + movement * polarity), volume: 1 });
    }
    return rows;
  };
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getOhlcv: async (count, chartIndex) => {
      const chart = chartIndex === 0 ? targetChart : auxiliaryChart;
      return { symbol: chart.symbol, resolution: chart.resolution, count, bars: barsFor(chart.symbol) };
    },
    setSymbol: async (symbol, chartIndex) => {
      assert.equal(chartIndex, 1);
      auxiliaryChart.symbol = symbol;
      return { symbol, resolution: auxiliaryChart.resolution, bars: 26 };
    },
    setResolution: async (resolution, chartIndex) => {
      assert.equal(chartIndex, 1);
      auxiliaryChart.resolution = resolution;
      return { symbol: auxiliaryChart.symbol, resolution, bars: 26 };
    },
    loadMoreHistory: async ({ count, chartIndex }) => {
      historyLoads.push({ count, chartIndex });
      return { requested: count, barsBefore: 300, barsAfter: 300 + count, added: count, moreAvailable: true };
    },
  }}));

  const response = await client.callTool({ name: "classify_cross_asset_shocks", arguments: {
    target_chart_index: 0, auxiliary_chart_index: 1, expected_target_symbol: "OANDA:EURUSD",
    expected_timeframe: "15", count: 100, minimum_classified_states: 1, load_more_bars: 6000,
  } });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.classified_states, 1);
  assert.equal(parsed.states[0].state, "cross_asset_confirmed");
  assert.equal(parsed.states[0].context.us_yield.direction, "confirming");
  assert.deepEqual(historyLoads.map((item) => item.count), [5000, 1000, 5000, 1000, 5000, 1000, 5000, 1000]);
  assert.equal(parsed.execution.history_load.results.dxy.calls.length, 2);
  assert.equal(parsed.execution.history_load.results.dxy.added, 6000);
  assert.deepEqual(auxiliaryChart, { symbol: "OANDA:XAUUSD", resolution: "1D" });
});

test("evaluate_cross_asset_shock_outcomes wires frozen states to outcomes and restores the auxiliary chart", async () => {
  const targetChart = { symbol: "OANDA:EURUSD", resolution: "15" };
  const auxiliaryChart = { symbol: "OANDA:XAUUSD", resolution: "1D" };
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
    { index: 0, symbol: targetChart.symbol, resolution: targetChart.resolution, studies: [] },
    { index: 1, symbol: auxiliaryChart.symbol, resolution: auxiliaryChart.resolution, studies: [] },
  ] });
  const barsFor = (symbol) => {
    const start = Date.UTC(2026, 0, 2, 13, 45) / 1_000;
    const rows = [];
    for (let week = 0; week < 13; week += 1) {
      const time = start + week * 7 * 24 * 60 * 60;
      const movement = week < 12 ? 0.0001 : 0.005;
      const polarity = symbol === "TVC:DXY" || symbol === "TVC:US10Y" ? -1 : 1;
      rows.push({ time, timeIso: new Date(time * 1_000).toISOString(), open: 100, high: 100, low: 100, close: 100, volume: 1 });
      rows.push({ time: time + 900, timeIso: new Date((time + 900) * 1_000).toISOString(), open: 100,
        high: 101, low: 99, close: 100 * (1 + movement * polarity), volume: 1 });
    }
    return rows;
  };
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getOhlcv: async (count, chartIndex) => {
      const chart = chartIndex === 0 ? targetChart : auxiliaryChart;
      return { symbol: chart.symbol, resolution: chart.resolution, count, bars: barsFor(chart.symbol) };
    },
    setSymbol: async (symbol, chartIndex) => {
      assert.equal(chartIndex, 1);
      auxiliaryChart.symbol = symbol;
      return { symbol, resolution: auxiliaryChart.resolution, bars: 26 };
    },
    setResolution: async (resolution, chartIndex) => {
      assert.equal(chartIndex, 1);
      auxiliaryChart.resolution = resolution;
      return { symbol: auxiliaryChart.symbol, resolution, bars: 26 };
    },
  }}));

  const response = await client.callTool({ name: "evaluate_cross_asset_shock_outcomes", arguments: {
    target_chart_index: 0, auxiliary_chart_index: 1, expected_target_symbol: "OANDA:EURUSD",
    expected_timeframe: "15", count: 100, minimum_events_per_state: 1,
  } });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.contract.contract_id, "cross_asset_shock_outcome_v1");
  assert.equal(parsed.classification.state_counts.cross_asset_confirmed, 1);
  assert.equal(parsed.by_state.cross_asset_confirmed.events, 1);
  assert.equal(parsed.quality.overlapping_states_excluded, 0);
  assert.deepEqual(auxiliaryChart, { symbol: "OANDA:XAUUSD", resolution: "1D" });
});

test("compute_correlation_regimes with confirm:true performs multi-ref symbol verification and restores chart state", async () => {
  const symbolLog = [];
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
      { index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] },
      { index: 1, symbol: "TVC:DXY", resolution: "60", studies: [] },
    ] }),
    getOhlcv: async (_count, chartIndex) => {
      const closes = chartIndex === 0 ? [100, 101, 103, 106] : [100, 99, 97, 94];
      return { symbol: chartIndex === 0 ? "OANDA:EURUSD" : "TVC:DXY", resolution: "60", count: closes.length,
        bars: closes.map((close, index) => ({ time: index * 3600, timeIso: new Date(index * 3_600_000).toISOString(),
          open: close, high: close, low: close, close, volume: 1 })) };
    },
    setSymbol: async (symbol, chartIndex) => {
      symbolLog.push({ action: "setSymbol", symbol, chartIndex });
      return { symbol, chartIndex };
    },
  }}));

  const response = await client.callTool({ name: "compute_correlation_regimes", arguments: {
    primary_chart_index: 0, reference_chart_index: 1, expected_primary_symbol: "OANDA:EURUSD",
    expected_reference_symbol: "TVC:DXY", expected_timeframe: "60", window: 2,
    confirm: true,
  } });

  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.alignmentPolicy, "exact_utc_timestamp_no_forward_fill");
  assert.equal(parsed.observations.at(-1).regime, "strong_negative");
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

test("get_cot_crowding_unwind_overlay_template returns the fixed explicit-input Pine source", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_cot_crowding_unwind_overlay_template", arguments: {} });
  const template = JSON.parse(res.content[0].text);
  assert.equal(template.name, COT_CROWDING_UNWIND_OVERLAY_NAME);
  assert.equal(template.source, COT_CROWDING_UNWIND_OVERLAY_SOURCE);
  assert.equal(template.inputContract.length, 13);
  assert.equal(template.semantics, "crowded_position_unwind_proxy_not_observed_orders_or_stops");
  assert.match(template.source, /COT values are explicit MCP inputs/);
});

test("get_volume_profile_context_template returns the fixed audited Pine source", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_volume_profile_context_template", arguments: {} });
  const template = JSON.parse(res.content[0].text);
  assert.equal(template.name, VOLUME_PROFILE_CONTEXT_NAME);
  assert.equal(template.version, "2.0");
  assert.match(template.source, /bins = array\.new_float\(rows, 0\.0\)/);
  assert.match(template.source, /"Profile Complete"/);
  assert.equal(template.inputContract.length, 4);
});

test("get_volume_profile_context verifies the placed audited template and returns only a completed profile", async () => {
  const pineId = "USER;9f868f366873411aa46bd30872711544";
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }],
      }),
      listPineScripts: async () => [{
        pineId, name: VOLUME_PROFILE_CONTEXT_NAME, kind: "study", version: "2.0",
        usedBy: [{ chartIndex: 0, studyId: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, version: "2.0" }],
      }],
      getPineSource: async () => ({ pineId, version: "2.0", source: VOLUME_PROFILE_CONTEXT_SOURCE }),
      getIndicatorInputs: async () => [{
        id: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, title: VOLUME_PROFILE_CONTEXT_NAME,
        inputs: [
          { id: "in_0", name: "Rows", type: "integer", value: 24, defval: 24, tooltip: null },
          { id: "in_1", name: "Value Area %", type: "integer", value: 70, defval: 70, tooltip: null },
          { id: "in_2", name: "Volume Type", type: "text", value: "provider_tick_volume", defval: "unknown", tooltip: null },
          { id: "in_3", name: "Maximum Session Bars", type: "integer", value: 500, defval: 500, tooltip: null },
        ],
      }],
      getIndicatorValues: async (options) => {
        assert.deepEqual(options.plotTitles, [...VOLUME_PROFILE_CONTEXT_PLOTS]);
        return [{
          id: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, options,
          plots: [],
          bars: [{ time: 1, values: {
            "Prior POC": 1.084, "Prior VAH": 1.09, "Prior VAL": 1.08,
            "Profile Start": 1_720_000_000_000, "Profile End": 1_720_086_400_000,
            "Trading Day": 1_720_051_200_000,
            "Profile Complete": 1, "Bars Included": 96,
          } }],
        }];
      },
    },
  }));
  const res = await client.callTool({
    name: "get_volume_profile_context",
    arguments: {
      pine_id: pineId, study_id: "vp", expected_symbol: "OANDA:EURUSD", expected_timeframe: "60",
    },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.levels.poc, 1.084);
  assert.deepEqual(parsed.profile, {
    start: "2024-07-03T09:46:40.000Z",
    end: "2024-07-04T09:46:40.000Z",
    tradingDay: "2024-07-04T00:00:00.000Z",
    rows: 24,
    valueAreaPercent: 70,
    barsIncluded: 96,
  });
  assert.ok(parsed.qualityIssues.includes("provider_tick_volume_not_consolidated_order_flow"));
  assert.equal(parsed.semantics, "completed_chart_bar_volume_range_allocation_profile_proxy");
});

test("get_volume_profile_context refuses a same-named Pine script whose source was changed", async () => {
  const pineId = "USER;9f868f366873411aa46bd30872711544";
  let inputsRead = false;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }],
      }),
      listPineScripts: async () => [{
        pineId, name: VOLUME_PROFILE_CONTEXT_NAME, kind: "study", version: "2.0",
        usedBy: [{ chartIndex: 0, studyId: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, version: "2.0" }],
      }],
      getPineSource: async () => ({ pineId, version: "2.0", source: "//@version=6\nplot(close)" }),
      getIndicatorInputs: async () => { inputsRead = true; return []; },
    },
  }));
  const res = await client.callTool({
    name: "get_volume_profile_context",
    arguments: {
      pine_id: pineId, study_id: "vp", expected_symbol: "OANDA:EURUSD", expected_timeframe: "60",
    },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /does not match the audited volume-profile template/);
  assert.equal(inputsRead, false);
});

test("run_volume_profile_reaction_study binds the audited profile and keeps candidacy disabled", async () => {
  const pineId = "USER;9f868f366873411aa46bd30872711544";
  const base = Date.parse("2026-01-01T00:00:00.000Z") / 1000;
  const bars = Array.from({ length: 100 }, (_, index) => ({
    time: base + index * 14_400,
    timeIso: new Date((base + index * 14_400) * 1000).toISOString(),
    open: 100, high: 101, low: 99, close: 100, volume: 1000,
  }));
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "CME_DL:6E1!", resolution: "240", studies: [] }],
      }),
      getOhlcv: async () => ({ symbol: "CME_DL:6E1!", resolution: "240", count: bars.length, bars }),
      listPineScripts: async () => [{
        pineId, name: VOLUME_PROFILE_CONTEXT_NAME, kind: "study", version: "3.0",
        usedBy: [{ chartIndex: 0, studyId: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, version: "3.0" }],
      }],
      getPineSource: async () => ({ pineId, version: "3.0", source: VOLUME_PROFILE_CONTEXT_SOURCE }),
      getIndicatorInputs: async () => [{
        id: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, title: VOLUME_PROFILE_CONTEXT_NAME,
        inputs: [
          { id: "in_0", name: "Rows", type: "integer", value: 24, defval: 24, tooltip: null },
          { id: "in_1", name: "Value Area %", type: "integer", value: 70, defval: 70, tooltip: null },
          { id: "in_2", name: "Volume Type", type: "text", value: "exchange_reported_volume", defval: "unknown", tooltip: null },
          { id: "in_3", name: "Maximum Session Bars", type: "integer", value: 500, defval: 500, tooltip: null },
        ],
      }],
      getIndicatorValues: async (options) => {
        assert.equal(options.count, 100);
        assert.deepEqual(options.plotTitles, [...VOLUME_PROFILE_CONTEXT_PLOTS]);
        return [{ id: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, plots: [], bars: bars.map((bar) => ({
          time: bar.time, timeIso: bar.timeIso, values: {
            "Prior POC": 100, "Prior VAH": 110, "Prior VAL": 90,
            "Profile Start": (base - 86_400) * 1000, "Profile End": base * 1000,
            "Trading Day": (base - 43_200) * 1000, "Profile Complete": 1, "Bars Included": 6,
          },
        })) }];
      },
    },
  }));
  const res = await client.callTool({
    name: "run_volume_profile_reaction_study",
    arguments: {
      pine_id: pineId, study_id: "vp", expected_symbol: "CME_DL:6E1!",
      expected_timeframe: "240", chart_index: 0, count: 100, event_limit: 0,
    },
  });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.methodologyVersion, "chart_bar_volume_profile_reaction_event_study_v1");
  assert.equal(parsed.profileContract.nativeLowerTimeframeVolumeProfile, false);
  assert.equal(parsed.inferenceContract.candidacy, "disabled_descriptive_only_pending_falsification");
  assert.equal(parsed.sameRegimeBaseline.contract.regimeKey, "directional_regime:volatility_regime");
  assert.equal(parsed.sameRegimeBaseline.contract.baselineEventExclusion, "all_volume_profile_event_signal_bars");
  assert.equal(parsed.source.returnedBars, 100);
  assert.equal(JSON.stringify(parsed).includes('"bars"'), false);
});

test("run_volume_profile_reaction_study routes the 60-minute contract to its separate methodology", async () => {
  const pineId = "USER;9f868f366873411aa46bd30872711544";
  const base = Date.parse("2026-01-01T00:00:00.000Z") / 1000;
  let requestedOhlcv = 0;
  let requestedIndicatorValues = 0;
  const bars = Array.from({ length: 100 }, (_, index) => ({
    time: base + index * 3_600,
    timeIso: new Date((base + index * 3_600) * 1000).toISOString(),
    open: 100, high: 101, low: 99, close: 100, volume: 1000,
  }));
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "CME_DL:6E1!", resolution: "60", studies: [] }],
      }),
      getOhlcv: async (count) => {
        requestedOhlcv = count;
        return { symbol: "CME_DL:6E1!", resolution: "60", count: bars.length, bars };
      },
      listPineScripts: async () => [{
        pineId, name: VOLUME_PROFILE_CONTEXT_NAME, kind: "study", version: "3.0",
        usedBy: [{ chartIndex: 0, studyId: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, version: "3.0" }],
      }],
      getPineSource: async () => ({ pineId, version: "3.0", source: VOLUME_PROFILE_CONTEXT_SOURCE }),
      getIndicatorInputs: async () => [{
        id: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, title: VOLUME_PROFILE_CONTEXT_NAME,
        inputs: [
          { id: "in_0", name: "Rows", type: "integer", value: 24, defval: 24, tooltip: null },
          { id: "in_1", name: "Value Area %", type: "integer", value: 70, defval: 70, tooltip: null },
          { id: "in_2", name: "Volume Type", type: "text", value: "exchange_reported_volume", defval: "unknown", tooltip: null },
          { id: "in_3", name: "Maximum Session Bars", type: "integer", value: 500, defval: 500, tooltip: null },
        ],
      }],
      getIndicatorValues: async (options) => {
        requestedIndicatorValues = options.count ?? 0;
        return [{ id: "vp", name: VOLUME_PROFILE_CONTEXT_NAME, plots: [], bars: bars.map((bar) => ({
          time: bar.time, timeIso: bar.timeIso, values: {
            "Prior POC": 100, "Prior VAH": 110, "Prior VAL": 90,
            "Profile Start": (base - 86_400) * 1000, "Profile End": base * 1000,
            "Trading Day": (base - 43_200) * 1000, "Profile Complete": 1, "Bars Included": 6,
          },
        })) }];
      },
    },
  }));
  const res = await client.callTool({
    name: "run_volume_profile_reaction_study",
    arguments: {
      pine_id: pineId, study_id: "vp", expected_symbol: "CME_DL:6E1!",
      expected_timeframe: "60", chart_index: 0, count: 15_000, event_limit: 0,
    },
  });
  assert.notEqual(res.isError, true, res.content[0].text);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.methodologyVersion, "chart_bar_volume_profile_reaction_event_study_1h_v1");
  assert.equal(parsed.sameRegimeBaseline.methodologyVersion,
    "volume_profile_same_regime_unconditional_baseline_1h_v1");
  assert.equal(parsed.source.studyVariant, "1h_v1");
  assert.equal(requestedOhlcv, 15_000);
  assert.equal(requestedIndicatorValues, 15_000);
  assert.equal(parsed.inferenceContract.candidacy, "disabled_descriptive_only_pending_falsification");
  const pocRes = await client.callTool({
    name: "run_volume_profile_poc_reversion_study",
    arguments: {
      pine_id: pineId, study_id: "vp", expected_symbol: "CME_DL:6E1!",
      expected_timeframe: "60", chart_index: 0, count: 15_000, event_limit: 0,
    },
  });
  assert.notEqual(pocRes.isError, true, pocRes.content[0].text);
  const poc = JSON.parse(pocRes.content[0].text);
  assert.equal(poc.methodologyVersion, "chart_bar_volume_profile_poc_reversion_event_study_1h_v1");
  assert.equal(poc.pocContract.maximumEventsPerProfileAndBranch, 1);
  assert.equal(poc.sameRegimeBaseline.methodologyVersion,
    "volume_profile_poc_reversion_same_regime_unconditional_baseline_1h_v1");
  assert.equal(poc.inferenceContract.candidacy, "disabled_descriptive_only_pending_falsification");
});

test("run_volume_profile_reaction_study keeps the 240-minute contract at 5000 bars", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({
    name: "run_volume_profile_reaction_study",
    arguments: {
      pine_id: "USER;9f868f366873411aa46bd30872711544", study_id: "vp",
      expected_symbol: "CME_DL:6E1!", expected_timeframe: "240", count: 15_000,
    },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /240-minute #61b v1 contract allows at most 5000 bars/);
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

test("evaluate_analysis_overlay_outcome keeps a result open while closed bars stop before the expiry or miss a bar (102-04)", async () => {
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
  // The entry, then nothing past analyzedAt + 25 minutes, though the expiry was at + 55.
  let bars = [
    makeBar(analyzedAtMs - 5 * 60_000, 162.3, 162.7, 161.8, 162.3),
    makeBar(analyzedAtMs + 10 * 60_000, 162.3, 162.35, 162.15, 162.25),
  ];
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
        getOhlcv: async () => ({ symbol: "OANDA:USDJPY", resolution: "15", count: bars.length, bars }),
      },
    }),
  );
  const evaluate = async () => JSON.parse((await client.callTool({
    name: "evaluate_analysis_overlay_outcome",
    arguments: {
      pine_id: pineId,
      expected_symbol: "OANDA:USDJPY",
      expected_timeframe: "15",
      count: 500,
    },
  })).content[0].text);
  const parsed = await evaluate();
  assert.deepEqual([parsed.status, parsed.outcome], ["incomplete", "history_ends_before_expiry"]);
  assert.ok(parsed.qualityIssues.includes("history_ends_before_expiry"));
  assert.match(parsed.remediation, /closed bars through the expiry/, "older history from load_more_history would not help");
  // Through the expiry, but the bar at + 25 is missing.
  bars = [...bars, makeBar(analyzedAtMs + 40 * 60_000, 162.3, 162.35, 162.25, 162.3)];
  const gapped = await evaluate();
  assert.deepEqual([gapped.status, gapped.outcome, gapped.qualityIssues], ["incomplete", "gap_in_evaluation_window", ["gap_in_evaluation_window"]]);
  assert.match(gapped.remediation, /missing inside the window \(evidence\.gaps\)/);
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

test("evaluate_due_analyses names a gapped result with history through the expiry unless rechecked otherwise (102-04)", async () => {
  const gapped = {
    schema_version: "1.0",
    event_id: "outcome-EURUSD-gapped",
    sequence: 2,
    recorded_at: "2026-07-01T02:00:00.000Z",
    kind: "outcome_evaluated",
    analysis_id: "EURUSD-gapped",
    definition_hash: "hash-EURUSD-gapped",
    payload: {
      status: "incomplete",
      outcome: "gap_in_evaluation_window",
      evaluatedAt: "2026-07-01T02:00:00.000Z",
      evidenceTimeframe: "15",
      evidenceThrough: "2026-07-01T00:45:00.000Z",
      result: { evidence: { expiryCoveredBy: "closed_bar", gaps: [], gapCount: 1 } },
    },
  };
  const records = [dueAnalysisRecord("EURUSD-gapped", "OANDA:EURUSD", "15", "2026-07-01T01:00:00.000Z", gapped)];
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "batch",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
      }),
    },
    journal: { list: async () => ({ total: records.length, returned: records.length, analyses: records }) },
  }));
  const preview = async (args) => JSON.parse((await client.callTool({ name: "evaluate_due_analyses", arguments: args })).content[0].text).preview;
  const plain = await preview({ chart_index: 0 });
  assert.deepEqual([plain.selected, plain.skipped], [0, [{ analysisId: "EURUSD-gapped", reason: "open_result_fixed_for_timeframe" }]]);
  assert.equal((await preview({ chart_index: 0, evaluation_timeframe: "15" })).selected, 0);
  const longer = await preview({ chart_index: 0, evaluation_timeframe: "1H" });
  assert.deepEqual([longer.selected, longer.candidates[0].evaluationTimeframe], [1, "60"]);
  const forced = await preview({ chart_index: 0, include_fixed: true });
  assert.deepEqual([forced.selected, forced.includeFixed, forced.candidates[0].evaluationTimeframe], [1, true, "15"]);
});

test("evaluate_due_analyses names a history that does not reach back unless the run asks for more, and counts legacy completes (102-32)", async () => {
  const entry = (analysisId, payload) => ({
    schema_version: "1.0", event_id: `outcome-${analysisId}`, sequence: 2, recorded_at: "2026-10-10T00:00:00.000Z",
    kind: "outcome_evaluated", analysis_id: analysisId, definition_hash: `hash-${analysisId}`, payload,
  });
  const short = entry("EURUSD-short", {
    status: "incomplete", outcome: "history_incomplete", evaluatedAt: "2026-10-10T00:00:00.000Z", evidenceTimeframe: "60",
    evidenceThrough: null, result: { source: { requestedBars: 1000, returnedBars: 1000, loadMoreBars: 0 } },
  });
  const legacy = entry("EURUSD-legacy", {
    status: "complete", outcome: "not_activated", evaluatedAt: "2026-07-01T02:00:00.000Z", evidenceTimeframe: "15",
    evidenceThrough: "2026-07-01T00:30:00.000Z", result: { evidence: { closedThrough: "2026-07-01T00:30:00.000Z" } },
  });
  const records = [
    dueAnalysisRecord("EURUSD-short", "OANDA:EURUSD", "60", "2026-07-01T01:00:00.000Z", short),
    dueAnalysisRecord("EURUSD-legacy", "OANDA:EURUSD", "15", "2026-07-01T01:00:00.000Z", legacy),
  ];
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "batch",
        activeChartIndex: 0,
        chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
      }),
    },
    journal: { list: async () => ({ total: records.length, returned: records.length, analyses: records }) },
  }));
  const preview = async (args) => JSON.parse((await client.callTool({ name: "evaluate_due_analyses", arguments: args })).content[0].text).preview;
  const plain = await preview({ chart_index: 0 });
  assert.deepEqual(plain.candidates.map((item) => [item.analysisId, item.reason]), [["EURUSD-legacy", "legacy_complete_recheck"]]);
  assert.deepEqual(plain.skipped, [{ analysisId: "EURUSD-short", reason: "history_short_fixed_for_request" }]);
  assert.equal(plain.legacyCompleteWithoutCoverage, 1);
  assert.deepEqual((await preview({ chart_index: 0, count: 1000 })).skipped.map((item) => item.analysisId), ["EURUSD-short"]);
  for (const args of [{ load_more_bars: 500 }, { count: 2000 }]) {
    const more = await preview({ chart_index: 0, ...args });
    assert.deepEqual(more.candidates.map((item) => [item.analysisId, item.reason]),
      [["EURUSD-short", "non_terminal_recheck"], ["EURUSD-legacy", "legacy_complete_recheck"]], JSON.stringify(args));
  }
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

test("evaluate_due_analyses notes evaluations that record nothing, and selects by when each was last looked at (102-34)", async () => {
  const records = [
    dueAnalysisRecord("EURUSD-fails", "OANDA:EURUSD", "15", "2026-07-01T01:00:00.000Z"),
    dueAnalysisRecord("XAUUSD-same", "OANDA:XAUUSD", "15", "2026-07-01T02:00:00.000Z"),
    dueAnalysisRecord("GBPUSD-new", "OANDA:GBPUSD", "15", "2026-07-01T03:00:00.000Z"),
    dueAnalysisRecord("AUDUSD-unjournaled", "OANDA:AUDUSD", "15", "2026-07-01T04:00:00.000Z"),
  ];
  const state = { symbol: "OANDA:USDJPY", resolution: "240" };
  const attempts = new Map();
  const noted = [];
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
      list: async () => ({ total: records.length, returned: records.length, analyses: records }),
      recordOutcome: async (analysisId, _hash, value) => {
        if (analysisId === "AUDUSD-unjournaled") throw new Error("journal lock timed out");
        const idempotent = analysisId === "XAUUSD-same";
        return { recorded: !idempotent, idempotent, entry: { event_id: `outcome-${analysisId}`, payload: value } };
      },
      lastAttempts: async () => new Map(attempts),
      recordAttempt: async (analysisId, definitionHash, result) => {
        noted.push([analysisId, definitionHash, result]);
        if (analysisId === "AUDUSD-unjournaled") throw new Error("attempt log refused", { cause: new Error("ENOSPC") });
        const attempt = { attemptedAt: new Date(Date.parse("2026-07-02T00:00:00.000Z") + noted.length * 1000).toISOString(), result };
        attempts.set(analysisId, { ...attempt, definitionHash });
        return attempt;
      },
    },
  }));
  const call = async (args) => JSON.parse((await client.callTool({ name: "evaluate_due_analyses", arguments: { chart_index: 0, ...args } })).content[0].text);
  const first = await call({ confirm: true });
  assert.deepEqual(first.preview.attemptLog, { status: "read" });
  assert.deepEqual(first.results.map((item) => item.analysisId), ["EURUSD-fails", "XAUUSD-same", "GBPUSD-new", "AUDUSD-unjournaled"]);
  // A failure, a result already recorded and a result the journal could not take are noted; a recorded one is not.
  assert.deepEqual(noted, [["EURUSD-fails", "hash-EURUSD-fails", "failed"], ["XAUUSD-same", "hash-XAUUSD-same", "unchanged"],
    ["AUDUSD-unjournaled", "hash-AUDUSD-unjournaled", "failed"]]);
  assert.deepEqual(first.results.map((item) => item.attemptLog), [{ result: "failed", recorded: true }, { result: "unchanged", recorded: true },
    undefined, { result: "failed", recorded: false, error: "attempt log refused: ENOSPC" }]);
  // Failing to note an attempt changes nothing else: the run is partial for its failures, as before.
  assert.equal(first.status, "partial");
  // Next time the analysis never looked at goes first, the failed one goes after the ongoing and unseen ones, and the
  // one the log could not note stays unseen.
  const next = await call({});
  assert.deepEqual(next.preview.candidates.map((item) => [item.analysisId, item.lastAttempt?.result ?? null]),
    [["GBPUSD-new", null], ["AUDUSD-unjournaled", null], ["XAUUSD-same", "unchanged"], ["EURUSD-fails", "failed"]]);
  assert.equal(next.preview.candidates[2].lastSeenAt, "2026-07-02T00:00:02.000Z");
});

test("evaluate_due_analyses selects without the attempt log when it cannot be read, and says so (102-34)", async () => {
  const records = [dueAnalysisRecord("EURUSD-due", "OANDA:EURUSD", "15", "2026-07-01T01:00:00.000Z")];
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "batch", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }],
      }),
    },
    journal: {
      list: async () => ({ total: records.length, returned: records.length, analyses: records }),
      lastAttempts: async () => { throw new Error("invalid analysis attempt JSON at line 3 of /x/journal.jsonl.attempts.jsonl"); },
    },
  }));
  const preview = JSON.parse((await client.callTool({ name: "evaluate_due_analyses", arguments: { chart_index: 0 } })).content[0].text).preview;
  assert.deepEqual(preview.attemptLog, { status: "unavailable", error: "invalid analysis attempt JSON at line 3 of /x/journal.jsonl.attempts.jsonl" });
  assert.deepEqual(preview.candidates.map((item) => [item.analysisId, item.lastSeenAt, item.lastAttempt]), [["EURUSD-due", null, null]]);
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
  assert.equal(dry.definition.methodologyVersion, "ledger_partition_v2");
  assert.equal(runCount, 0);
  assert.equal(dry.execution.nonSelectedOosMetricsExposed, false);

  const result = JSON.parse((await client.callTool({ name: "run_strategy_walk_forward",
    arguments: { ...args, falsification_audit: { replications: 20, first_seed: 41, nominal_alpha: 0.05 },
      confirm: true } })).content[0].text);
  assert.equal(result.status, "complete");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.evaluation.folds[0].selection.status, "selected");
  assert.equal(result.evaluation.folds[0].test.evidence.metrics.totalTrades, 2);
  assert.equal(result.evaluation.folds[0].test.candidateId,
    result.evaluation.folds[0].selection.candidateId);
  assert.equal(result.evaluation.oosAggregate.evaluableFolds, 2);
  assert.equal(result.falsificationAudit.methodologyVersion, "strategy_walk_forward_falsification_audit_v3");
  assert.equal("observedRate" in result.falsificationAudit, false);
  assert.equal(result.falsificationAudit.leaveOneOutTailCalibration.status,
    "not_measurable_structural_rank_uniformity");
  assert.equal(result.falsificationAudit.replications, 20);
  assert.equal(result.falsificationAudit.completed, 20);
  assert.equal(result.falsificationAudit.failed.length, 0);
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
  assert.equal(dry.definition.methodologyVersion, "strategy_stress_v3");
  assert.equal(runs, 0);
  const result = JSON.parse((await client.callTool({ name: "stress_test_strategy",
    arguments: { ...args, confirm: true } })).content[0].text);
  assert.equal(result.status, "complete");
  assert.equal(result.evaluation.baseline.metrics.netProfit, 110);
  assert.equal(result.evaluation.scenarios[0].metrics.netProfit, 70);
  assert.equal(result.rerunEvaluation.scenarios[0].metrics.netProfit, 55);
  assert.deepEqual([result.evaluation.methodologyVersion, result.rerunEvaluation.methodologyVersion], ["ledger_stress_v2", "strategy_rerun_stress_v2"]);
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
      registerEventHypothesis: async (payload) => (calls.push(["event-hypothesis", payload]), { recorded: true, entry: { payload } }),
      listEventStudies: async (hypothesisId) => (calls.push(["event-list", hypothesisId]), [{ studyId: hash("a") }]),
      compareEventStudies: async (references) => (calls.push(["event-compare", references]), { comparable: true, studies: references }),
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

  const eventHypothesis = await client.callTool({ name: "register_event_study_hypothesis", arguments: {
    hypothesis_id: "feature-eurusd", title: "Feature relationship", thesis: "A predeclared feature may separate later returns.",
    audit_definition: { runner: "event_study_falsification_audit_standard_v1", input: {
      candidate: { branch: "feature_high", horizon: 4 }, study: { type: "feature_outcome_relationships" },
    } },
    evaluation_contract: { population: "out_of_sample", primary_metric: "meanForwardReturn", primary_horizon_bars: 4, minimum_events: 20, symbols: ["OANDA:EURUSD"], timeframes: ["60"] },
  } });
  assert.equal(JSON.parse(eventHypothesis.content[0].text).recorded, true);
  assert.equal(calls[3][1].evaluationContract.primaryMetric, "meanForwardReturn");
  const listed = await client.callTool({ name: "get_event_study_journal", arguments: { hypothesis_id: "feature-eurusd" } });
  assert.equal(JSON.parse(listed.content[0].text)[0].studyId, hash("a"));
  const eventCompared = await client.callTool({ name: "get_event_study_journal", arguments: { study_ids: [hash("a"), hash("b")], evidence_hashes: [hash("c"), hash("d")] } });
  assert.equal(JSON.parse(eventCompared.content[0].text).comparable, true);
  assert.equal(calls[3][0], "event-hypothesis");
  assert.equal(calls[5][0], "event-compare");
});

test("get_dxy_context_gate_template returns the fixed Pine and plot contract", async () => {
  const client = await connectedClient(makeDeps());
  const response = await client.callTool({ name: "get_dxy_context_gate_template", arguments: {} });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.name, "Bushido DXY Context Gate v1");
  assert.equal(parsed.plots.gate, "dxy_gate");
  assert.match(parsed.source, /barmerge\.lookahead_off/);
  assert.match(parsed.source, /barmerge\.gaps_on/);
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

test("create_analysis_alerts blocks execution when owned alert definition conflicts", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const now = Date.now();
  const analysisId = "USDJPY-conflict-test";
  const values = {
    in_0: analysisId, in_1: now - 60_000, in_2: "bullish", in_3: 162.1, in_4: 162.2, in_5: 162.3,
    in_6: 161.9, in_7: 161.8, in_8: 162.6, in_9: 0, in_10: 0, in_11: 0.65, in_12: now + 3600_000, in_13: "",
  };
  const conflictingAlert = {
    id: 999,
    name: analysisAlertOwnershipName(analysisId, "confirmation"),
    symbol: "OANDA:USDJPY",
    resolution: "240",
    condition: { type: "cross_up", series: [{ type: "value", value: 999.9 }] }, // Mismatched level!
    message: "conflict",
    active: true,
    expiration: new Date(now + 3600_000).toISOString(),
  };
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ activeChartIndex: 0, charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }] }),
      listPineScripts: async () => [{ pineId, name: ANALYSIS_OVERLAY_NAME, kind: "study", version: "2.0", usedBy: [{ chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" }] }],
      getPineSource: async () => ({ pineId, name: ANALYSIS_OVERLAY_NAME, kind: "study", version: "2.0", source: ANALYSIS_OVERLAY_SOURCE }),
      getIndicatorInputs: async () => [overlayStudy("overlay2", values)],
      getOhlcv: async () => ({ symbol: "OANDA:USDJPY", resolution: "240", count: 1, bars: [{ time: now / 1000, open: 162.0, high: 162.1, low: 161.9, close: 162.0 }] }),
      listAlerts: async () => [conflictingAlert],
    },
  }));
  const res = JSON.parse((await client.callTool({
    name: "create_analysis_alerts",
    arguments: { pine_id: pineId, expected_symbol: "OANDA:USDJPY", expected_timeframe: "4H", analysis_id: analysisId, confirm: true },
  })).content[0].text);
  assert.equal(res.status, "blocked");
  assert.equal(res.reason, "owned_alert_definition_conflict");
});

test("create_analysis_alerts omits confirmation alert when price already reached confirmation", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const now = Date.now();
  const analysisId = "USDJPY-reached-test";
  const values = {
    in_0: analysisId, in_1: now - 60_000, in_2: "bullish", in_3: 162.0, in_4: 162.1, in_5: 162.2,
    in_6: 161.9, in_7: 161.8, in_8: 162.6, in_9: 0, in_10: 0, in_11: 0.65, in_12: now + 3600_000, in_13: "",
  };
  const alerts = [];
  let creates = 0;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ activeChartIndex: 0, charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }] }),
      listPineScripts: async () => [{ pineId, name: ANALYSIS_OVERLAY_NAME, kind: "study", version: "2.0", usedBy: [{ chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" }] }],
      getPineSource: async () => ({ pineId, name: ANALYSIS_OVERLAY_NAME, kind: "study", version: "2.0", source: ANALYSIS_OVERLAY_SOURCE }),
      getIndicatorInputs: async () => [overlayStudy("overlay2", values)],
      getOhlcv: async () => ({ symbol: "OANDA:USDJPY", resolution: "240", count: 1, bars: [{ time: now / 1000, open: 162.2, high: 162.28, low: 162.15, close: 162.25 }] }), // > confirmation 162.2 and < target_1 162.3
      listAlerts: async () => alerts,
      createPriceAlert: async (options) => {
        creates += 1;
        const alert = {
          id: creates,
          name: options.name,
          symbol: options.symbol,
          resolution: options.resolution,
          condition: { type: options.operator, series: [{ type: "value", value: options.level }] },
          message: options.message,
          active: true,
          expiration: options.expiration,
        };
        alerts.push(alert);
        return { alertId: creates, name: options.name, symbol: options.symbol, verified: true };
      },
    },
  }));
  const res = JSON.parse((await client.callTool({
    name: "create_analysis_alerts",
    arguments: { pine_id: pineId, expected_symbol: "OANDA:USDJPY", expected_timeframe: "4H", analysis_id: analysisId, confirm: true },
  })).content[0].text);
  assert.equal(res.status, "complete");
  assert.equal(creates, 2); // Invalidation & Target 1 only
  assert.equal(res.omitted[0].kind, "confirmation");
  assert.equal(res.omitted[0].reason, "confirmation_currently_reached");
});

test("create_analysis_alerts reports partial status when alert creation fails midway", async () => {
  const pineId = "USER;8f868f366873411aa46bd30872711544";
  const now = Date.now();
  const analysisId = "USDJPY-partial-fail-test";
  const values = {
    in_0: analysisId, in_1: now - 60_000, in_2: "bullish", in_3: 162.1, in_4: 162.2, in_5: 162.3,
    in_6: 161.9, in_7: 161.8, in_8: 162.6, in_9: 0, in_10: 0, in_11: 0.65, in_12: now + 3600_000, in_13: "",
  };
  const alerts = [];
  let creates = 0;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ activeChartIndex: 0, charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] }] }),
      listPineScripts: async () => [{ pineId, name: ANALYSIS_OVERLAY_NAME, kind: "study", version: "2.0", usedBy: [{ chartIndex: 0, studyId: "overlay2", name: ANALYSIS_OVERLAY_NAME, version: "2.0" }] }],
      getPineSource: async () => ({ pineId, name: ANALYSIS_OVERLAY_NAME, kind: "study", version: "2.0", source: ANALYSIS_OVERLAY_SOURCE }),
      getIndicatorInputs: async () => [overlayStudy("overlay2", values)],
      getOhlcv: async () => ({ symbol: "OANDA:USDJPY", resolution: "240", count: 1, bars: [{ time: now / 1000, open: 162.0, high: 162.1, low: 161.9, close: 162.0 }] }),
      listAlerts: async () => alerts,
      createPriceAlert: async (options) => {
        creates += 1;
        if (creates > 1) throw new Error("TradingView API rate limit");
        const alert = {
          id: creates,
          name: options.name,
          symbol: options.symbol,
          resolution: options.resolution,
          condition: { type: options.operator, series: [{ type: "value", value: options.level }] },
          message: options.message,
          active: true,
          expiration: options.expiration,
        };
        alerts.push(alert);
        return { alertId: creates, name: options.name, symbol: options.symbol, verified: true };
      },
    },
  }));
  const res = JSON.parse((await client.callTool({
    name: "create_analysis_alerts",
    arguments: { pine_id: pineId, expected_symbol: "OANDA:USDJPY", expected_timeframe: "4H", analysis_id: analysisId, confirm: true },
  })).content[0].text);
  assert.equal(res.status, "partial");
  assert.equal(creates, 2);
  assert.equal(res.failures.length, 1);
  assert.equal(res.failures[0].error, "TradingView API rate limit");
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

test("get_trade_decision_context waits after a release minutes ago, read from the calendar's own window (102-06)", async (t) => {
  // A local calendar answering like the real one: only events between from and to.
  let calendarEvents = [];
  const requests = [];
  const calendarServer = http.createServer((req, res) => {
    const url = new URL(req.url, "http://calendar");
    requests.push(url);
    if (calendarEvents === null) {
      res.statusCode = 503;
      res.end("unavailable");
      return;
    }
    const from = Date.parse(url.searchParams.get("from"));
    const to = Date.parse(url.searchParams.get("to"));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok", result: calendarEvents.filter((item) => Date.parse(item.date) >= from && Date.parse(item.date) <= to) }));
  });
  await new Promise((resolve) => calendarServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => calendarServer.close(resolve)));
  const calendar = new EconomicCalendar(`http://127.0.0.1:${calendarServer.address().port}`);
  let quoteCalls = 0;
  const client = await connectedClient(makeDeps({
    // makeDeps spreads the override, which would drop the class's methods.
    calendar: { getEvents: (options) => calendar.getEvents(options) },
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
      // Every read moves bid/ask, so the execution gate clears and only the event gate decides.
      getQuotes: async (symbols) => {
        quoteCalls += 1;
        const offset = (quoteCalls % 2) * 0.0001;
        return {
          totalCount: symbols.length,
          returned: symbols.length,
          rows: symbols.map((symbol) => ({ symbol, values: { close: 1.1015, bid: 1.1014 + offset, ask: 1.1016 + offset, update_mode: "streaming", pricescale: 100000, minmov: 1 } })),
        };
      },
    },
  }));
  const decide = async () => JSON.parse((await client.callTool({
    name: "get_trade_decision_context",
    arguments: { symbol: "OANDA:EURUSD", chart_index: 0, expected_timeframe: "60", execution_wait_for_update_ms: 100, execution_sample_interval_ms: 100 },
  })).content[0].text);
  const release = (minutesAgo) => ({ id: 1, title: "CPI YoY", country: "US", currency: "USD", importance: 1, date: new Date(Date.now() - minutesAgo * 60_000).toISOString() });

  calendarEvents = [release(5)];
  const recent = await decide();
  assert.deepEqual([recent.decision_status, recent.event_gate.status], ["wait", "blackout"]);
  assert.equal(recent.event_gate.active_events[0].title, "CPI YoY");
  const gateRequest = requests.find((url) => Date.parse(url.searchParams.get("to")) - Date.parse(url.searchParams.get("from")) < 86_400_000);
  assert.ok(Date.now() - Date.parse(gateRequest.searchParams.get("from")) >= 15 * 60_000, "the request reaches back past the after-release window");

  calendarEvents = [release(20)];
  const past = await decide();
  assert.deepEqual([past.decision_status, past.event_gate.status], ["trade_ready", "clear"], "past the default 15 minutes");

  calendarEvents = null;
  const down = await decide();
  assert.deepEqual([down.decision_status, down.event_gate.status], ["wait", "unavailable"]);
  assert.ok(down.quality_issues.some((issue) => issue.code === "event_gate_unavailable"));
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
  assert.equal(res.isError, undefined, res.content[0].text);
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

test("get_futures_flow_context forwards open_interest_data and returns 4-quadrant price x OI classification", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 10 }, (_, index) => {
    const open = 100 + index;
    const close = open + 1;
    return { time: (start + index * 86_400_000) / 1000,
      timeIso: new Date(start + index * 86_400_000).toISOString(), open,
      high: close + 0.2, low: open - 0.2, close, volume: 100 };
  });
  const open_interest_data = bars.map((bar, i) => ({ time: bar.timeIso, openInterest: 5000 + i * 100 }));
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
        { index: 0, symbol: "CME:6E1!", resolution: "1D", studies: [] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "CME:6E1!", resolution: "1D", count: bars.length, bars }),
    },
    cot: {
      getHistory: async () => { throw new Error("COT unavailable"); },
    },
  }));
  const res = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    count: 100, volume_lookback: 5, open_interest_data, open_interest_scope: "front_month",
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.schemaVersion, "1.1");
  assert.equal(parsed.methodologyVersion, "futures_flow_context_v2");
  assert.equal(parsed.openInterest.status, "available");
  assert.equal(parsed.openInterest.value, 5900);
  assert.equal(parsed.priceOpenInterestQuadrant.status, "available");
  assert.equal(parsed.priceOpenInterestQuadrant.distribution.long_build.count, 5);

  const missingScope = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    count: 100, volume_lookback: 5, open_interest_data,
  } });
  assert.equal(missingScope.isError, true);
  assert.match(missingScope.content[0].text, /open_interest_scope is required/);

  // Automatic detection only matches the official front-month study, so a declared scope there
  // could only ever file front-month values under the wrong series.
  const unsupportedScope = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    count: 100, volume_lookback: 5, open_interest_scope: "all_months_aggregated",
  } });
  assert.equal(unsupportedScope.isError, true);
  assert.match(unsupportedScope.content[0].text, /open_interest_scope must not be set without/);
});

test("get_futures_flow_context maps official CME GC OI by CME session date without chart fallback", async () => {
  const start = Date.UTC(2026, 0, 1, 22);
  const bars = Array.from({ length: 100 }, (_, index) => {
    const open = 3700 + index;
    const close = open + 1;
    const time = start + index * 86_400_000;
    return { time: time / 1000, timeIso: new Date(time).toISOString(), open,
      high: close + 0.2, low: open - 0.2, close, volume: 100 };
  });
  const sessionDates = bars.map((bar) => new Date(new Date(bar.timeIso).getTime() + 86_400_000).toISOString().slice(0, 10));
  const asOf = "2026-07-25T15:00:00.000Z";
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ charts: [{ index: 0, symbol: "COMEX_DL:GC1!", resolution: "1D", studies: [] }] }),
      getOhlcv: async () => ({ symbol: "COMEX_DL:GC1!", resolution: "1D", bars }),
    },
    futuresOpenInterestHistory: {
      getSeriesAsOf: async (input) => {
        assert.equal(input.source, "cme_daily_bulletin");
        assert.equal(input.sourceDetail, "GC_FUT");
        assert.equal(input.scope, "all_months_aggregated");
        assert.equal(input.asOf.toISOString(), asOf);
        return bars.map((_, index) => ({ observation_date: sessionDates[index], open_interest: 370000 + index, first_seen_at: "2026-07-25T15:00:00.000Z" }));
      },
    },
  }));
  const response = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:XAUUSD", futures_chart_index: 0, expected_futures_symbol: "COMEX_DL:GC1!",
    count: 100, volume_lookback: 5, open_interest_provider: "cme_daily_bulletin", as_of: asOf,
  } });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.openInterest.status, "available");
  assert.equal(parsed.openInterest.source, "cme_daily_bulletin");
  assert.equal(parsed.openInterest.value, 370099);
  assert.deepEqual(parsed.openInterestAsOf, { asOf, selection: "local_first_seen_as_of" });
  assert.equal(parsed.openInterestFirstSeen.source, "already_first_seen_official_cme_series");
});

test("get_futures_flow_context rejects mixing the official CME provider with chart OI inputs", async () => {
  const client = await connectedClient(makeDeps());
  const response = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:XAUUSD", futures_chart_index: 0, expected_futures_symbol: "COMEX_DL:GC1!",
    open_interest_provider: "cme_daily_bulletin", open_interest_scope: "all_months_aggregated",
  } });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /cannot be combined/);

  const invalidAsOf = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:XAUUSD", futures_chart_index: 0, expected_futures_symbol: "COMEX_DL:GC1!",
    as_of: "2026-07-25T15:00:00.000Z",
  } });
  assert.equal(invalidAsOf.isError, true);
  assert.match(invalidAsOf.content[0].text, /as_of is supported only with open_interest_provider/);
});

test("get_futures_flow_context automatically detects official on-chart Open Interest study when open_interest_data is omitted", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 10 }, (_, index) => {
    const open = 100 + index;
    const close = open + 1;
    return { time: (start + index * 86_400_000) / 1000,
      timeIso: new Date(start + index * 86_400_000).toISOString(), open,
      high: close + 0.2, low: open - 0.2, close, volume: 100 };
  });
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
        { index: 0, symbol: "CME:6E1!", resolution: "1D", studies: [{ id: "oi_123", name: "Open Interest" }] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "CME:6E1!", resolution: "1D", count: bars.length, bars }),
      getIndicatorValues: async ({ studyId }) => {
        assert.equal(studyId, "oi_123");
        return [{
          id: "oi_123", name: "Open Interest", plots: [{ id: "open_interest", title: "Open Interest", type: "line" }],
          bars: bars.map((b, i) => ({ time: b.time, timeIso: b.timeIso, values: { open_interest: 5000 + i * 100 } })),
        }];
      },
    },
    cot: {
      getHistory: async () => { throw new Error("COT unavailable"); },
    },
  }));
  const res = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    count: 100, volume_lookback: 5,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.openInterest.status, "available");
  assert.equal(parsed.openInterest.source, "tradingview_chart_indicator");
  assert.equal(parsed.openInterest.value, 5900);
  assert.equal(parsed.priceOpenInterestQuadrant.status, "available");
});

test("get_futures_flow_context reads the official Open Interest plot whose bar values are keyed by title", async () => {
  // The official TradingView study exposes plot id "plot_0" and carries the name in the title.
  // Bar values are keyed by that title, so reading the plot id yields undefined and silently
  // drops every observation, leaving open interest unavailable even though it was on the chart.
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 10 }, (_, index) => {
    const open = 100 + index;
    const close = open + 1;
    return { time: (start + index * 86_400_000) / 1000,
      timeIso: new Date(start + index * 86_400_000).toISOString(), open,
      high: close + 0.2, low: open - 0.2, close, volume: 100 };
  });
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
        { index: 0, symbol: "CME:6E1!", resolution: "1D", studies: [{ id: "K9FNVr", name: "Open Interest" }] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "CME:6E1!", resolution: "1D", count: bars.length, bars }),
      getIndicatorValues: async ({ studyId }) => {
        assert.equal(studyId, "K9FNVr");
        return [{
          id: "K9FNVr", name: "Open Interest",
          plots: [{ id: "plot_0", title: "Open Interest", type: "line" }],
          bars: bars.map((bar, index) => ({ time: bar.time, timeIso: bar.timeIso,
            values: { "Open Interest": 5000 + index * 100 } })),
        }];
      },
    },
    cot: { getHistory: async () => { throw new Error("COT unavailable"); } },
  }));
  const res = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    count: 100, volume_lookback: 5,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.openInterest.status, "available");
  assert.equal(parsed.openInterest.source, "tradingview_chart_indicator");
  assert.equal(parsed.openInterest.value, 5900);
  assert.equal(parsed.priceOpenInterestQuadrant.status, "available");
  // The payload must not simultaneously return quadrant labels and claim OI was unavailable.
  assert.equal(parsed.limitations.some((item) => /open interest is unavailable/i.test(item)), false);
  assert.ok(parsed.limitations.some((item) => /front month approaches expiry/i.test(item)),
    "roll contamination of continuous-contract open interest must be disclosed");
});

test("get_futures_flow_context reads open interest from an explicitly named study and plot", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 10 }, (_, index) => {
    const open = 100 + index;
    const close = open + 1;
    return { time: (start + index * 86_400_000) / 1000,
      timeIso: new Date(start + index * 86_400_000).toISOString(), open,
      high: close + 0.2, low: open - 0.2, close, volume: 100 };
  });
  let requested = null;
  const deps = {
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
        // An aggregated all-months OI indicator whose name cannot match the official study.
        { index: 0, symbol: "CME:6E1!", resolution: "1D", studies: [{ id: "1STpgW", name: "Total Volume / OI" }] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "CME:6E1!", resolution: "1D", count: bars.length, bars }),
      getIndicatorValues: async (options) => {
        requested = options;
        return [{
          id: "1STpgW", name: "Total Volume / OI",
          plots: [{ id: "plot_8", title: "Total OI", type: "line" }],
          bars: bars.map((bar, index) => ({ time: bar.time, timeIso: bar.timeIso,
            values: { "Total OI": 5000 + index * 100 } })),
        }];
      },
    },
    cot: { getHistory: async () => { throw new Error("COT unavailable"); } },
  };

  const client = await connectedClient(makeDeps(deps));
  const res = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    count: 100, volume_lookback: 5,
    open_interest_study_id: "1STpgW", open_interest_plot_title: "Total OI", open_interest_scope: "all_months_aggregated",
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.openInterest.status, "available");
  assert.equal(parsed.openInterest.source, "tradingview_chart_indicator");
  assert.equal(parsed.openInterest.value, 5900);
  assert.equal(parsed.priceOpenInterestQuadrant.status, "available");
  // The named plot must be pushed down so a deep read stays small.
  assert.deepEqual(requested.plotTitles, ["Total OI"]);
  assert.equal(requested.studyId, "1STpgW");

  // A plot title alone is meaningless without the study it belongs to.
  const orphan = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    open_interest_plot_title: "Total OI",
  } });
  assert.equal(orphan.isError, true);
  assert.match(orphan.content[0].text, /requires open_interest_study_id/);
});

test("get_futures_flow_context surfaces a named open interest study that yields nothing", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 10 }, (_, index) => ({
    time: (start + index * 86_400_000) / 1000,
    timeIso: new Date(start + index * 86_400_000).toISOString(),
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 100,
  }));
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
        { index: 0, symbol: "CME:6E1!", resolution: "1D", studies: [{ id: "1STpgW", name: "Total Volume / OI" }] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "CME:6E1!", resolution: "1D", count: bars.length, bars }),
      getIndicatorValues: async () => ([{
        id: "1STpgW", name: "Total Volume / OI",
        plots: [{ id: "plot_8", title: "Total OI", type: "line" }],
        // Zeros are what an aggregated indicator emits where it cannot rebuild the contract set.
        bars: bars.map((bar) => ({ time: bar.time, timeIso: bar.timeIso, values: { "Total OI": 0 } })),
      }]),
    },
    cot: { getHistory: async () => { throw new Error("COT unavailable"); } },
  }));
  const res = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    open_interest_study_id: "1STpgW", open_interest_plot_title: "Total OI", open_interest_scope: "all_months_aggregated",
  } });
  // Naming a study explicitly means a failure is the caller mistake, not a reason to degrade.
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /produced no positive values/);
});

test("get_futures_flow_context records what open interest it just saw, and survives a failing store", async () => {
  // CME daily sessions start on the previous UTC date. The Sunday 22:00 UTC bar is Monday's
  // trading session and must not be persisted as a Sunday observation.
  const start = Date.UTC(2026, 0, 4, 22);
  const bars = Array.from({ length: 10 }, (_, index) => {
    const close = 101 + index;
    return { time: (start + index * 86_400_000) / 1000,
      timeIso: new Date(start + index * 86_400_000).toISOString(), open: 100 + index,
      high: close + 0.2, low: 99 + index, close, volume: 100 };
  });
  const baseTv = {
    getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
      { index: 0, symbol: "CME:6E1!", resolution: "1D", studies: [{ id: "1STpgW", name: "Total Volume / OI" }] },
    ] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "CME:6E1!", resolution: "1D", count: bars.length, bars }),
    getIndicatorValues: async () => ([{
      id: "1STpgW", name: "Total Volume / OI",
      plots: [{ id: "plot_8", title: "Total OI", type: "line" }],
      bars: bars.map((bar, index) => ({ time: bar.time, timeIso: bar.timeIso,
        values: { "Total OI": 5000 + index * 100 } })),
    }]),
  };
  const args = {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
    count: 100, volume_lookback: 5,
    open_interest_study_id: "1STpgW", open_interest_plot_title: "Total OI", open_interest_scope: "all_months_aggregated",
  };

  let captured = null;
  const client = await connectedClient(makeDeps({
    tv: baseTv,
    cot: { getHistory: async () => { throw new Error("COT unavailable"); } },
    futuresOpenInterestHistory: {
      observeMany: async (observations) => {
        captured = observations;
        return { recorded: observations, unchanged: 0, revisions: 0 };
      },
    },
  }));
  const parsed = JSON.parse((await client.callTool({ name: "get_futures_flow_context", arguments: args })).content[0].text);
  assert.equal(parsed.openInterest.status, "available");
  assert.equal(parsed.openInterestFirstSeen.recorded, captured.length);
  // Collection must cover every closed bar carrying open interest. Reading it from the displayed
  // observations instead would silently drop the first volume_lookback bars.
  assert.equal(captured.length, bars.length,
    "the log must receive every closed OI point, not only the volume-normalised observations");
  // An explicitly named aggregated study is a different quantity from front-month open interest.
  assert.ok(captured.every((item) => item.scope === "all_months_aggregated"));
  assert.ok(captured.every((item) => item.futures_symbol === "CME:6E1!"));
  assert.equal(captured[0].observation_date, "2026-01-05");
  assert.ok(captured.every((item) => item.observation_date <= item.observed_at.slice(0, 10)),
    "an observation can never be dated after the moment it was seen");

  // Collecting history is a side benefit; losing it must not cost the caller their context.
  const failing = await connectedClient(makeDeps({
    tv: baseTv,
    cot: { getHistory: async () => { throw new Error("COT unavailable"); } },
    futuresOpenInterestHistory: {
      observeMany: async () => { throw new Error("disk is full"); },
    },
  }));
  const survived = JSON.parse((await failing.callTool({ name: "get_futures_flow_context", arguments: args })).content[0].text);
  assert.equal(survived.openInterest.status, "available");
  assert.equal(survived.priceOpenInterestQuadrant.status, "available");
  assert.equal(survived.openInterestFirstSeen.recorded, 0);
  assert.match(survived.openInterestFirstSeen.error, /disk is full/);
});

test("get_futures_flow_context fails closed to unavailable when on-chart study is loose or plot title is unrelated", async () => {
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 10 }, (_, index) => {
    const open = 100 + index;
    const close = open + 1;
    return { time: (start + index * 86_400_000) / 1000,
      timeIso: new Date(start + index * 86_400_000).toISOString(), open,
      high: close + 0.2, low: open - 0.2, close, volume: 100 };
  });

  // Case A: Loose study name "Open Interest Oscillator"
  const clientA = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
        { index: 0, symbol: "CME:6E1!", resolution: "1D", studies: [{ id: "custom_oi", name: "Open Interest Oscillator" }] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "CME:6E1!", resolution: "1D", count: bars.length, bars }),
      getIndicatorValues: async () => {
        throw new Error("Should not be called for unmatched study name");
      },
    },
    cot: { getHistory: async () => { throw new Error("COT unavailable"); } },
  }));
  const resA = await clientA.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
  } });
  const parsedA = JSON.parse(resA.content[0].text);
  assert.equal(parsedA.openInterest.status, "unavailable");

  // Case B: Official study name "Open Interest", but plot is unrelated "plot_0" with title "Delta Signal"
  const clientB = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
        { index: 0, symbol: "CME:6E1!", resolution: "1D", studies: [{ id: "oi_unrelated", name: "Open Interest" }] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "CME:6E1!", resolution: "1D", count: bars.length, bars }),
      getIndicatorValues: async () => [{
        id: "oi_unrelated", name: "Open Interest", plots: [{ id: "plot_0", title: "Delta Signal", type: "line" }],
        bars: bars.map((b) => ({ time: b.time, timeIso: b.timeIso, values: { plot_0: 12345 } })),
      }],
    },
    cot: { getHistory: async () => { throw new Error("COT unavailable"); } },
  }));
  const resB = await clientB.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:EURUSD", futures_chart_index: 0, expected_futures_symbol: "CME:6E1!",
  } });
  const parsedB = JSON.parse(resB.content[0].text);
  assert.equal(parsedB.openInterest.status, "unavailable");
});

test("get_futures_flow_context handles roll_anomaly_threshold and new symbol mappings", async () => {
  const bars = [
    { time: 1700000000, timeIso: "2026-01-01T00:00:00.000Z", open: 100, high: 105, low: 99, close: 101, volume: 1000 },
    { time: 1700086400, timeIso: "2026-01-02T00:00:00.000Z", open: 101, high: 106, low: 100, close: 102, volume: 1000 },
    { time: 1700172800, timeIso: "2026-01-03T00:00:00.000Z", open: 102, high: 107, low: 101, close: 103, volume: 1000 },
    { time: 1700259200, timeIso: "2026-01-04T00:00:00.000Z", open: 103, high: 108, low: 102, close: 104, volume: 1000 },
    { time: 1700345600, timeIso: "2026-01-05T00:00:00.000Z", open: 104, high: 109, low: 103, close: 105, volume: 1000 },
    { time: 1700432000, timeIso: "2026-01-06T00:00:00.000Z", open: 105, high: 110, low: 104, close: 106, volume: 5000 },
  ];
  const oiData = [
    { time: "2026-01-01T00:00:00.000Z", openInterest: 10000 },
    { time: "2026-01-02T00:00:00.000Z", openInterest: 10000 },
    { time: "2026-01-03T00:00:00.000Z", openInterest: 10000 },
    { time: "2026-01-04T00:00:00.000Z", openInterest: 10000 },
    { time: "2026-01-05T00:00:00.000Z", openInterest: 10000 },
    { time: "2026-01-06T00:00:00.000Z", openInterest: 13000 }, // 30% jump
  ];

  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "flow", activeChartIndex: 0, chartsCount: 1, charts: [
        { index: 0, symbol: "CME:ES1!", resolution: "1D", studies: [] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "CME:ES1!", resolution: "1D", count: bars.length, bars }),
    },
    cot: { getHistory: async () => { throw new Error("COT unavailable"); } },
  }));

  const res = await client.callTool({ name: "get_futures_flow_context", arguments: {
    target_symbol: "OANDA:SPX500USD",
    futures_chart_index: 0,
    expected_futures_symbol: "CME:ES1!",
    volume_lookback: 5,
    roll_anomaly_threshold: 0.20,
    open_interest_data: oiData,
    open_interest_scope: "front_month",
  } });

  assert.equal(res.isError, undefined, res.content[0].text);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.mapping.targetSymbol, "OANDA:SPX500USD");
  assert.equal(parsed.mapping.futuresSymbol, "CME:ES1!");
  assert.equal(parsed.quality.rollAnomalyBars, 1);
  assert.ok(parsed.qualityIssues.includes("contract_roll_anomaly_detected"));
  assert.equal(parsed.openInterest.volumeOpenInterestRatio, 5000 / 13000);
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

test("get_policy_rate_context returns only persisted policy-rate versions at the requested cutoff", async () => {
  let received = null;
  const client = await connectedClient(makeDeps({
    policyRateHistory: { getAsOf: async (currency, asOf) => {
      received = asOf;
      if (currency === "EUR") return null;
      return {
        schema_version: "1.0", sequence: 3, series: "policy_rate", currency, source_symbol: "ECONOMICS:USINTR",
        observation_date: "2026-06-17", value: 3.75, source_observed_at: "2026-06-17T00:00:00.000Z",
        available_at: "2026-06-18T00:00:00.000Z", available_at_basis: "next_utc_business_day_start", first_seen_at: "2026-07-28T13:00:00.000Z",
      };
    } },
  }));
  const res = await client.callTool({ name: "get_policy_rate_context", arguments: { currencies: ["USD", "EUR"], as_of: "2026-07-28T13:00:00.000Z" } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(received.toISOString(), "2026-07-28T13:00:00.000Z");
  assert.equal(parsed.status, "partial");
  assert.equal(parsed.rates[0].value, 3.75);
  assert.equal(parsed.rates[1].status, "unavailable");
});

test("get_exploratory_policy_rate_history labels revised history as ineligible for OOS evidence", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_exploratory_policy_rate_history", arguments: { currencies: ["USD", "EUR"] } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(parsed.evidence_tier, "exploratory_revised_history");
  assert.equal(parsed.eligibility, "exploratory_only");
  assert.equal(parsed.point_in_time_status, "not_available");
  assert.equal(parsed.rates[0].value, 3.75);
  assert.equal(parsed.source_coverage.source_coverage.ecb_deposit_facility.coverage_status, "complete");
});

test("carry_panel_preflight reports no historical sample before first-seen collection", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "carry_panel_preflight", arguments: {
    pairs: [{ pair_id: "EURUSD", base_currency: "EUR", quote_currency: "USD" }],
    from: "2006-07-20", to: "2026-07-28", oos_from: "2021-07-28", as_of: "2026-07-28T13:00:00.000Z",
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(parsed.status, "not_evaluable");
  assert.equal(parsed.pairs[0].non_overlapping_anchors, 0);
  assert.ok(parsed.pairs[0].quality_issues.includes("insufficient_first_seen_history"));
});

test("run_carry_core_primary_test exposes one frozen first-seen-only contract before switching charts", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "run_carry_core_primary_test", arguments: { chart_index: 0 } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(parsed.dry_run, true);
  assert.equal(parsed.changed, false);
  assert.equal(parsed.contract.id, "carry_core_primary_v1");
  assert.equal(parsed.contract.horizon_business_days, 20);
  assert.equal(parsed.contract.minimum_anchor_clusters, 60);
  assert.equal(parsed.contract.max_heartbeat_gap_business_days, 5);
  assert.equal(parsed.pairs.length, 5);
});

test("get_carry_core_primary_readiness rounds the first heartbeat onto the frozen anchor grid", async () => {
  const policyRecord = (currency) => ({
    schema_version: "1.0", sequence: 1, series: "policy_rate", currency,
    source_symbol: `ECONOMICS:${currency}INTR`, observation_date: "2026-07-28", value: 1,
    source_observed_at: "2026-07-28T00:00:00.000Z", available_at: "2026-07-28T00:00:00.000Z",
    available_at_basis: "next_utc_business_day_start", first_seen_at: "2026-07-28T00:00:00.000Z",
  });
  const client = await connectedClient(makeDeps({
    policyRateHistory: { getVersionsAsOf: async (currency) => [policyRecord(currency)] },
    policyRateHeartbeats: { getRunsAsOf: async () => [{ first_seen_at: "2026-07-30T01:45:00.000Z" }] },
  }));
  const res = await client.callTool({ name: "get_carry_core_primary_readiness", arguments: { as_of: "2026-07-30T12:00:00.000Z" } });
  assert.equal(res.isError, undefined, res.content[0].text);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.contract.max_heartbeat_gap_business_days, 5);
  assert.equal(parsed.first_collection_heartbeat_date, "2026-07-30");
  assert.equal(parsed.first_eligible_anchor_date, "2026-08-25");
  assert.equal(parsed.estimated_earliest_complete_window_date, "2031-04-01");
  assert.equal(parsed.collection_continuity_status, "collecting_within_gap_limit");
});

test("get_oanda_flow_collection_readiness exposes no credential and makes its evidence boundary explicit", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "get_oanda_flow_collection_readiness", arguments: {} });
  assert.equal(res.isError, undefined, res.content[0].text);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.token_configured, false);
  assert.deepEqual(parsed.supported_instruments, ["EUR_USD", "USD_JPY"]);
  assert.equal(parsed.evidence_tier, "broker_retail_sentiment_history");
});

test("run_carry_core_primary_test refuses execution without collection heartbeat evidence", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "run_carry_core_primary_test", arguments: { chart_index: 0, confirm: true } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /collection heartbeats are not configured/);
});

test("estimate_carry_panel_effective_sample preserves same-date cross-section clusters", async () => {
  const observations = Array.from({ length: 12 }, (_, index) => {
    const anchor_date = new Date(Date.UTC(2026, 0, 1 + index * 7)).toISOString().slice(0, 10);
    const carry_return = Math.sin(index * 0.7);
    return [
      { anchor_date, pair_id: "EURUSD", carry_return },
      { anchor_date, pair_id: "GBPUSD", carry_return },
    ];
  }).flat();
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "estimate_carry_panel_effective_sample", arguments: {
    observations, block_length_anchors: 1, iterations: 500, seed: "server-fixed",
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(res.isError, undefined);
  assert.equal(parsed.methodology, "circular_moving_block_bootstrap_of_anchor_date_clusters");
  assert.equal(parsed.nominal_observations, 24);
  assert.equal(parsed.anchor_clusters, 12);
  assert.equal(parsed.pair_count, 2);
  assert.ok(parsed.design_effect > 1);
  assert.ok(parsed.effective_observations < parsed.nominal_observations);
});

test("measure_carry_panel_dependence can use explicitly exploratory time-varying official-rate signs", async () => {
  const chart = { symbol: "EURUSD", resolution: "1D" };
  const bars = Array.from({ length: 240 }, (_, index) => ({
    time: Date.UTC(2020, 0, 1 + index) / 1000,
    timeIso: new Date(Date.UTC(2020, 0, 1 + index)).toISOString(), open: 1, high: 1, low: 1, close: 1 + index * 0.001, volume: 1,
  }));
  const official = (currency, value) => [{
    schema_version: "1.0", sequence: 1, series: "policy_rate_official_history", evidence_tier: "exploratory_revised_history", currency,
    source_symbol: `ECONOMICS:${currency === "USD" ? "US" : currency}INTR`, observation_date: "2019-01-01", value,
    source_url: "https://example.test/rates", source_vintage_at: null, raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    retrieved_at: "2026-07-29T00:00:00.000Z", first_seen_at: "2026-07-29T00:00:00.000Z",
  }];
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1, charts: [{ index: 0, symbol: chart.symbol, resolution: chart.resolution, studies: [] }] }),
      setSymbol: async (symbol) => { chart.symbol = symbol; return { symbol, resolution: chart.resolution, changed: true, bars: bars.length }; },
      setResolution: async (resolution) => { chart.resolution = resolution; return { symbol: chart.symbol, resolution, changed: true, bars: bars.length }; },
      getOhlcv: async (count, chartIndex) => ({ symbol: chart.symbol, resolution: chart.resolution, count, chartIndex: chartIndex ?? null, bars }),
    },
    policyRateOfficialHistory: { getRevisedSeries: async (currency) => official(currency, currency === "USD" ? 3 : currency === "EUR" ? 1 : 4) },
  }));
  const res = await client.callTool({ name: "measure_carry_panel_dependence", arguments: {
    pairs: [
      { pair_id: "EURUSD", chart_index: 0, expected_symbol: "OANDA:EURUSD", base_currency: "EUR", quote_currency: "USD" },
      { pair_id: "AUDUSD", chart_index: 0, expected_symbol: "OANDA:AUDUSD", base_currency: "AUD", quote_currency: "USD" },
    ], count: 200, horizon_business_days: 20, block_length_anchors: 1, iterations: 100, seed: "exploratory-time-varying-signs", use_exploratory_official_rate_signs: true, confirm: true,
  } });
  assert.equal(res.isError, undefined, res.content[0].text);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.sign_source, "exploratory_revised_history");
  assert.equal(parsed.exploratory_signs.point_in_time_status, "not_available");
  assert.equal(parsed.result.anchors_excluded_for_missing_dynamic_sign, 0);
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

test("get_indicator_values requires plot_titles before reading more than 500 bars", async () => {
  const client = await connectedClient(makeDeps());
  // Returning every plot over thousands of bars produces a payload no caller can use, so the
  // deep read has to name its plots instead of silently emitting one.
  const unfiltered = await client.callTool({
    name: "get_indicator_values", arguments: { study_id: "st1", count: 2000 },
  });
  assert.equal(unfiltered.isError, true);
  assert.match(unfiltered.content[0].text, /count above 500 requires plot_titles/);

  const filtered = await client.callTool({
    name: "get_indicator_values",
    arguments: { study_id: "st1", count: 2000, plot_titles: ["Total OI"] },
  });
  assert.notEqual(filtered.isError, true);
  const [study] = JSON.parse(filtered.content[0].text);
  assert.equal(study.options.count, 2000);
  assert.deepEqual(study.options.plotTitles, ["Total OI"]);
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

test("run_event_study_falsification_audit calibrates a frozen FVG rule without chart access", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "run_event_study_falsification_audit", arguments: {
    study: {
      type: "fvg_retest", timeframe: "60", minimum_gap_bps: 10, retest_within_bars: 12,
      min_impulse_body_ratio: 0.5, require_boundary_hold: true, direction: "bearish",
      horizons: [1, 2], candidate_horizon: 2, target_return_bps: 20, minimum_events: 2,
      minimum_fold_events: 1, folds: 2, configuration_trials: 1,
    },
    models: ["white_noise"], replications: 2, bars: 800,
  } });
  assert.equal(res.isError, undefined);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.methodologyVersion, "event_study_falsification_audit_standard_v3");
  assert.deepEqual(parsed.standard.models, ["white_noise"]);
  assert.equal(parsed.runs[0].candidateRule.branch, "fvg_retest_bearish");
  assert.equal(parsed.runs[0].audit.completed, 2);
});

test("run_event_study_falsification_audit accepts a declared synthetic aftershock event schedule", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "run_event_study_falsification_audit", arguments: {
    study: {
      type: "event_aftershock_retest", timeframe: "15", initial_range_bars: 4,
      breakout_within_bars: 8, retest_within_bars: 8, require_retest_close_outside: true,
      minimum_initial_range_coverage: 1, candidate_branch: "retest_up", horizons: [1, 4],
      candidate_horizon: 4, target_return_bps: 10, minimum_events: 2, minimum_fold_events: 1,
      folds: 2, event_first_bar: 16, event_every_bars: 96, maximum_synthetic_events: 10,
      configuration_trials: 1,
    },
    models: ["white_noise"], replications: 2, bars: 800,
  } });
  assert.equal(res.isError, undefined);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.study, "event_aftershock_retest");
  assert.deepEqual(parsed.runs[0].syntheticEventSchedule, { firstBar: 16, everyBars: 96, maximumEvents: 10 });
});

test("run_feature_outcome_falsification_audit calibrates the empirical-null candidate gate without chart access", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "run_feature_outcome_falsification_audit", arguments: {
    timeframe: "60", features: ["body_direction"], horizons: [1, 3], minimum_observations: 10, minimum_effect_bps: 10,
    configuration_trials: 1, models: ["white_noise"], replications: 2, bars: 500,
  } });
  assert.equal(res.isError, undefined);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.methodologyVersion, "feature_outcome_falsification_audit_standard_v2");
  assert.equal(parsed.runs[0].candidateRule.evidence,
    "non_overlapping_newey_west_bonferroni_and_empirical_null_candidate_eligibility");
  assert.equal(parsed.runs[0].audit.evaluated, 2);
});

test("run_lead_lag_falsification_audit returns a bound configuration hash without chart access", async () => {
  const client = await connectedClient(makeDeps());
  const response = await client.callTool({ name: "run_lead_lag_falsification_audit", arguments: {
    timeframe: "60",
    max_lag_bars: 2,
    minimum_observations: 30,
    configuration_trials: 1,
    folds: [
      { fold_id: "first", from: "2006-01-02T00:00:00.000Z", to: "2006-01-08T00:00:00.000Z" },
      { fold_id: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-15T00:00:00.000Z" },
    ],
    replications: 2,
    bars: 300,
  } });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.methodologyVersion, "lead_lag_falsification_audit_standard_v7");
  assert.equal(parsed.audit.auditDefinition.runner, "lead_lag_falsification_audit_v7");
  assert.match(parsed.audit.auditDefinition.inputHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(parsed.audit.auditDefinition.input.study.folds.length, 2);
  assert.equal(parsed.audit.auditDefinition.input.study.returnStandardization, "causal_prior_20_rms");
  assert.equal(parsed.audit.status, "complete");
  assert.equal(parsed.audit.pairStructure.crossSeriesDependence, "contemporaneous_factor");

  const clustered = await client.callTool({ name: "run_lead_lag_falsification_audit", arguments: {
    timeframe: "60", max_lag_bars: 2, minimum_observations: 30, configuration_trials: 1,
    folds: [
      { fold_id: "first", from: "2006-01-02T00:00:00.000Z", to: "2006-01-08T00:00:00.000Z" },
      { fold_id: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-15T00:00:00.000Z" },
    ],
    model: "factor_regime_switching_volatility_pair", rho: 0.7, replications: 2, bars: 300,
  } });
  const clusteredParsed = JSON.parse(clustered.content[0].text);
  assert.equal(clusteredParsed.audit.model, "factor_regime_switching_volatility_pair");
  assert.equal(clusteredParsed.audit.auditDefinition.input.generation.pairStructure.volatilityStateDependence, "shared");

  // The legacy contract keeps its own runner and standard name; a run too sparse to judge has no rate.
  const legacy = await client.callTool({ name: "run_lead_lag_falsification_audit", arguments: {
    timeframe: "60", max_lag_bars: 2, minimum_observations: 1000, configuration_trials: 1,
    folds: [
      { fold_id: "first", from: "2006-01-02T00:00:00.000Z", to: "2006-01-08T00:00:00.000Z" },
      { fold_id: "second", from: "2006-01-08T00:00:00.000Z", to: "2006-01-15T00:00:00.000Z" },
    ],
    return_standardization: "none", replications: 2, bars: 300,
  } });
  const legacyParsed = JSON.parse(legacy.content[0].text);
  assert.deepEqual([legacyParsed.methodologyVersion, legacyParsed.audit.auditDefinition.runner, legacyParsed.audit.evaluated, legacyParsed.audit.observedRate],
    ["lead_lag_falsification_audit_standard_v6", "lead_lag_falsification_audit_v6", 0, null]);
});

test("run_feature_outcome_power_audit returns separate effect-size detection runs without chart access", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "run_feature_outcome_power_audit", arguments: {
    timeframe: "60", features: ["body_direction"], target_bucket: "bullish_body",
    effect_bps: [25, 100], horizons: [1, 3], minimum_observations: 10, minimum_effect_bps: 10,
    configuration_trials: 1, models: ["white_noise"], replications: 1, bars: 500,
  } });
  assert.equal(res.isError, undefined, res.content[0].text);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.methodologyVersion, "feature_outcome_power_audit_standard_v1");
  assert.deepEqual(parsed.effectBps, [25, 100]);
  assert.equal(parsed.runs.length, 2);
  assert.deepEqual(parsed.runs.map((run) => run.injection.effectBps), [25, 100]);
  assert.ok(parsed.runs.every((run) => run.audit.evaluated === 1));
  assert.ok(parsed.runs.every((run) =>
    run.candidateRule.evidence === "target_bucket_candidate_eligible_with_injected_direction_mean"));
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
  let requestedCount = null;
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async (count) => {
      requestedCount = count;
      return { symbol: "OANDA:EURUSD", resolution: "15", count: bars.length, bars };
    },
  } }));
  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "15", count: 10_000,
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
  assert.equal(res.isError, undefined, res.content[0].text);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(requestedCount, 10_000);
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
  const journalRecords = [];
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
  const client = await connectedClient(makeDeps({ researchJournal: {
    recordEventStudy: async (payload) => (journalRecords.push(payload), { recorded: true, entry: { payload, evidence_hash: `sha256:${"f".repeat(64)}` } }),
  }, tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "15", count: bars.length, bars }),
  } }));
  const handoffArguments = {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "15", count: 100,
    condition: { type: "session_exhaustion_handoff", timezone: "UTC",
      prior_sessions: [{ session_id: "Tokyo", start: "00:00", end: "08:00" }],
      handoff_start: "13:00", handoff_end: "16:00", prior_direction: "session_return",
      direction_minimum_return_bps: 1, handoff_window_bars: 3, signal_timing: "first_reversal", minimum_prior_coverage: 1 },
    horizons: [1, 4], target_return_bps: 10, minimum_events: 1, event_limit: 10,
    journal: { hypothesis_id: "handoff-eurusd", population: "out_of_sample", decision: "inconclusive" },
  };
  const res = await client.callTool({ name: "run_market_event_study", arguments: handoffArguments });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "session_exhaustion_handoff");
  assert.equal(parsed.methodologyVersion, "session_exhaustion_handoff_event_study_v3");
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.byBranch.exhaustion_up.events, 1);
  assert.equal(parsed.events[0].direction, "short");
  assert.equal(parsed.events[0].signalTime, bars[52].timeIso);
  assert.equal(parsed.session.signalTiming, "first_reversal");
  assert.equal(parsed.conditionContract.decisionTiming, "at_first_reversal_bar_close");
  assert.equal(parsed.outcomeContract.reference,
    "first_reversal_bar_close_event_study_only_not_assumed_fill");
  assert.match(parsed.studyId, /^sha256:/);
  assert.match(parsed.definitionHash, /^sha256:/);
  assert.equal(parsed.journal.recorded, true);
  assert.equal(journalRecords[0].conditionType, "session_exhaustion_handoff");
  assert.equal(journalRecords[0].outcomes.some((item) => item.branch === "exhaustion_up" && item.horizonBars === 4), true);
  assert.equal(JSON.stringify(parsed).includes('"bars"'), false);

  const otherClient = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:NZDUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:NZDUSD", resolution: "15", count: bars.length, bars }),
  } }));
  const { journal: _journal, ...otherArguments } = handoffArguments;
  const otherResponse = await otherClient.callTool({ name: "run_market_event_study", arguments: {
    ...otherArguments,
    expected_symbol: "OANDA:NZDUSD",
  } });
  const otherParsed = JSON.parse(otherResponse.content[0].text);
  assert.notEqual(otherParsed.studyId, parsed.studyId);
});

test("run_market_event_study binds caller-supplied event times to aftershock retests", async () => {
  const start = Date.UTC(2026, 0, 5, 13, 30);
  const bars = [
    [1.05, 1.10, 1.00, 1.06], [1.06, 1.09, 1.01, 1.04], [1.04, 1.08, 1.02, 1.07],
    [1.07, 1.10, 1.03, 1.08], [1.08, 1.14, 1.07, 1.12], [1.12, 1.14, 1.09, 1.11],
    [1.11, 1.15, 1.10, 1.14], [1.14, 1.17, 1.13, 1.16],
  ].map(([open, high, low, close], index) => ({ time: (start + index * 900_000) / 1000,
    timeIso: new Date(start + index * 900_000).toISOString(), open, high, low, close, volume: 1 }));
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "15", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "15", count: 100,
    condition: { type: "event_aftershock_retest", events: [
      { event_id: "us-cpi", occurred_at: "2026-01-05T13:30:00.000Z" },
      { event_id: "later-event", occurred_at: "2026-01-05T13:45:00.000Z" },
    ], initial_range_bars: 4, breakout_within_bars: 1, retest_within_bars: 1,
      overlap_policy: "exclude_later_event" },
    horizons: [1], target_return_bps: 10, minimum_events: 1, event_limit: 10, configuration_trials: 1,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "event_aftershock_retest");
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.byBranch.retest_up.events, 1);
  assert.equal(parsed.events[0].direction, "long");
  assert.equal(parsed.quality.overlappingEventsExcluded, 1);
  assert.equal(parsed.eventContract.overlapPolicy, "exclude_later_event");
  assert.equal(JSON.stringify(parsed).includes('"bars"'), false);
});

test("run_market_event_study binds failed breakout evidence to the active chart", async () => {
  const start = Date.UTC(2026, 0, 5);
  const bars = [];
  for (let index = 0; index < 32; index += 1) bars.push({ time: (start + index * 900_000) / 1000,
    timeIso: new Date(start + index * 900_000).toISOString(), open: 1.05, high: 1.1, low: 1, close: 1.05, volume: 1 });
  bars.push({ time: (start + 32 * 900_000) / 1000, timeIso: new Date(start + 32 * 900_000).toISOString(), open: 1.05, high: 1.12, low: 1.03, close: 1.06, volume: 1 });
  bars.push({ time: (start + 33 * 900_000) / 1000, timeIso: new Date(start + 33 * 900_000).toISOString(), open: 1.06, high: 1.07, low: 1.02, close: 1.04, volume: 1 });
  for (let index = 34; index < 40; index += 1) {
    const close = 1.04 - (index - 34) * 0.002;
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(), open: close + 0.002, high: close + 0.003, low: close - 0.003, close, volume: 1 });
  }
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1, charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "15", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "15", count: 100,
    condition: { type: "failed_breakout", timezone: "UTC", range_start: "00:00", range_end: "08:00", failure_end: "10:00", confirmation_bars: 1, minimum_range_coverage: 1 },
    horizons: [1, 4], target_return_bps: 10, minimum_events: 1, event_limit: 10, configuration_trials: 1,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "failed_breakout");
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.byBranch.failed_breakout_up.events, 1);
  assert.equal(parsed.events[0].direction, "short");
  assert.equal(parsed.conditionContract.oneEventPerLocalDay, true);
  assert.equal(JSON.stringify(parsed).includes('"bars"'), false);
});

test("run_market_event_study handles cross-day session windows (22:00 -> 06:00 -> 12:00)", async () => {
  const start = Date.UTC(2026, 0, 5, 22, 0);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(), open: 1.05, high: 1.10, low: 1.00, close: 1.05, volume: 1 });
  }
  bars.push({ time: (start + 32 * 900_000) / 1000, timeIso: new Date(start + 32 * 900_000).toISOString(), open: 1.05, high: 1.12, low: 1.04, close: 1.11, volume: 1 });
  bars.push({ time: (start + 33 * 900_000) / 1000, timeIso: new Date(start + 33 * 900_000).toISOString(), open: 1.11, high: 1.13, low: 1.10, close: 1.12, volume: 1 });
  for (let index = 34; index < 56; index += 1) {
    const close = 1.12 + (index - 33) * 0.001;
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(), open: close, high: close + 0.002, low: close - 0.002, close, volume: 1 });
  }
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "15", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "15", count: 100,
    condition: { type: "session_auction", timezone: "UTC", range_start: "22:00", range_end: "06:00", auction_end: "12:00", acceptance_closes: 2, failure_within_bars: 2, minimum_range_coverage: 1 },
    horizons: [1, 4], target_return_bps: 10, minimum_events: 1, event_limit: 10, configuration_trials: 1,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "session_auction");
  assert.equal(parsed.byBranch.accepted_up.events, 1);
  assert.equal(parsed.events[0].branch, "accepted_up");
  assert.equal(parsed.events[0].localDate, "2026-01-05");
});

test("run_market_event_study handles cross-day failed_breakout session windows (22:00 -> 06:00 -> 12:00)", async () => {
  const start = Date.UTC(2026, 0, 5, 22, 0);
  const bars = [];
  for (let index = 0; index < 32; index += 1) {
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(), open: 1.05, high: 1.10, low: 1.00, close: 1.05, volume: 1 });
  }
  bars.push({ time: (start + 32 * 900_000) / 1000, timeIso: new Date(start + 32 * 900_000).toISOString(), open: 1.05, high: 1.12, low: 1.03, close: 1.06, volume: 1 });
  bars.push({ time: (start + 33 * 900_000) / 1000, timeIso: new Date(start + 33 * 900_000).toISOString(), open: 1.06, high: 1.07, low: 1.02, close: 1.04, volume: 1 });
  for (let index = 34; index < 44; index += 1) {
    const close = 1.04 - (index - 34) * 0.002;
    bars.push({ time: (start + index * 900_000) / 1000, timeIso: new Date(start + index * 900_000).toISOString(), open: close + 0.002, high: close + 0.003, low: close - 0.003, close, volume: 1 });
  }
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "15", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "15", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "15", count: 100,
    condition: { type: "failed_breakout", timezone: "UTC", range_start: "22:00", range_end: "06:00", failure_end: "12:00", confirmation_bars: 1, minimum_range_coverage: 1 },
    horizons: [1, 4], target_return_bps: 10, minimum_events: 1, event_limit: 10, configuration_trials: 1,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "failed_breakout");
  assert.equal(parsed.byBranch.failed_breakout_up.events, 1);
  assert.equal(parsed.events[0].branch, "failed_breakout_up");
  assert.equal(parsed.events[0].localDate, "2026-01-05");
});

test("run_market_event_study evaluates composite_condition and records evidence to research journal", async () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const hour = 3_600_000;
  const ohlc = [
    [100, 100.2, 99.8, 100],
    [100.3, 101.8, 100.2, 101.6],
    [101.7, 103, 101.4, 102.8],
    [102.8, 103, 102.5, 102.7],
    [102.7, 102.8, 100.5, 101],
    [101, 102.5, 100.8, 102.2],
    [102.2, 104, 102, 103.8],
  ];
  const bars = ohlc.map(([open, high, low, close], index) => {
    const time = (start + index * hour) / 1000;
    return { time, timeIso: new Date(time * 1000).toISOString(), open, high, low, close, volume: 1000 };
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }),
  } }));

  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
    condition: {
      type: "composite_condition",
      operator: "intersection",
      max_alignment_bars: 5,
      require_same_direction: false,
      conditions: [
        { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 10 },
        { type: "fair_value_gap_retest", minimum_gap_bps: 5, retest_within_bars: 10 },
      ],
    },
    horizons: [1, 2], target_return_bps: 10, minimum_events: 1, event_limit: 10, configuration_trials: 1,
    journal: { hypothesis_id: "hyp_composite_1", population: "in_sample", decision: "adopted", note: "composite test" },
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "composite_condition");
  assert.equal(parsed.methodologyVersion, "composite_condition_event_study_v1");
  assert.equal(parsed.conditionContract.alignmentRule, "pairwise_span");
  assert.equal(parsed.conditionContract.overlapPolicy, "exclude_later_event");
  assert.equal(parsed.journal.recorded, true);
});

test("run_market_event_study evaluates composite_condition_v2 with negation operator", async () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const hour = 3_600_000;
  const ohlc = [
    [100, 100.2, 99.8, 100],
    [100.3, 101.8, 100.2, 101.6],
    [101.7, 103, 101.4, 102.8],
    [102.8, 103, 102.5, 102.7],
    [102.7, 102.8, 100.5, 101],
    [101, 102.5, 100.8, 102.2],
    [102.2, 104, 102, 103.8],
  ];
  const bars = ohlc.map(([open, high, low, close], index) => {
    const time = (start + index * hour) / 1000;
    return { time, timeIso: new Date(time * 1000).toISOString(), open, high, low, close, volume: 1000 };
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }),
  } }));

  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
    condition: {
      type: "composite_condition",
      operator: "negation",
      lookback_bars: 2,
      lookahead_bars: 2,
      conditions: [
        { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 10 },
        { type: "fair_value_gap_retest", minimum_gap_bps: 500, retest_within_bars: 10 },
      ],
    },
    horizons: [1, 2], target_return_bps: 10, minimum_events: 1, event_limit: 10, configuration_trials: 1,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "composite_condition");
  assert.equal(parsed.methodologyVersion, "composite_condition_event_study_v2");
  assert.equal(parsed.conditionContract.alignmentRule, "exclusion_window");
});

test("run_market_event_study evaluates fair_value_gap_retest and records evidence to research journal", async () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const hour = 3_600_000;
  const ohlc = [
    [100, 100.2, 99.8, 100],
    [100.3, 101.8, 100.2, 101.6],
    [101.7, 103, 101.4, 102.8],
    [102.8, 103, 102.5, 102.7],
    [102.7, 102.8, 100.5, 101],
    [101, 102.5, 100.8, 102.2],
    [102.2, 104, 102, 103.8],
  ];
  const bars = ohlc.map(([open, high, low, close], index) => {
    const time = (start + index * hour) / 1000;
    return { time, timeIso: new Date(time * 1000).toISOString(), open, high, low, close, volume: 1000 };
  });

  const journalRecords = [];
  const client = await connectedClient(makeDeps({
    researchJournal: {
      recordEventStudy: async (payload) => (journalRecords.push(payload), { recorded: true, entry: { payload } }),
    },
    tv: {
      getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1, charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }),
    },
  }));

  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
    condition: {
      type: "fair_value_gap_retest",
      minimum_gap_bps: 10,
      retest_within_bars: 12,
      min_impulse_body_ratio: 0.5,
      require_boundary_hold: true,
      direction: "bullish",
      signal_from: new Date(start + 4 * hour).toISOString(),
      signal_to: new Date(start + 6 * hour).toISOString(),
    },
    horizons: [1, 2, 4], target_return_bps: 20, minimum_events: 1, event_limit: 10, configuration_trials: 1,
    journal: { hypothesis_id: "hyp_fvg_test", population: "in_sample", decision: "adopted" },
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.conditionType, "fair_value_gap_retest");
  assert.equal(parsed.sample.events, 1);
  assert.equal(parsed.events[0].branch, "fvg_retest_bullish");
  assert.equal(parsed.events[0].direction, "long");
  assert.equal(parsed.selectionContract.signalFrom, new Date(start + 4 * hour).toISOString());
  assert.equal(parsed.selectionContract.signalTo, new Date(start + 6 * hour).toISOString());
  assert.equal(parsed.selectionContract.branch, "bullish");
  assert.deepEqual(Object.keys(parsed.byBranch), ["fvg_retest_bullish"]);
  assert.equal(parsed.journal.recorded, true);
  assert.equal(journalRecords[0].conditionType, "fair_value_gap_retest");
  assert.equal(journalRecords[0].outcomes.every((outcome) => outcome.branch === "fvg_retest_bullish"), true);
});

test("run_market_event_study applies a single prior-closed regime to FVG primary aggregates", async () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const hour = 3_600_000;
  const descending = Array.from({ length: 18 }, (_, index) => {
    const close = 110 - index * 0.5;
    return [close + 0.2, close + 1, close - 1, close];
  });
  const ohlc = [
    ...descending,
    [101.2, 101.3, 100.7, 101],
    [100.8, 100.9, 98.8, 99],
    [98.8, 99.2, 98.2, 98.4],
    [98.4, 98.6, 97.9, 98.1],
    [98.1, 100.8, 97.9, 100.5],
    [100.5, 100.6, 99.2, 99.4],
    [99.4, 99.5, 98.4, 98.7],
  ];
  const bars = ohlc.map(([open, high, low, close], index) => {
    const time = (start + index * hour) / 1000;
    return { time, timeIso: new Date(time * 1000).toISOString(), open, high, low, close, volume: 1000 };
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:XAUUSD", resolution: "60", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:XAUUSD", resolution: "60", count: bars.length, bars }),
  } }));

  const res = await client.callTool({ name: "run_market_event_study", arguments: {
    expected_symbol: "OANDA:XAUUSD", expected_timeframe: "60", count: 100,
    condition: {
      type: "fair_value_gap_retest",
      minimum_gap_bps: 10,
      retest_within_bars: 12,
      min_impulse_body_ratio: 0.5,
      require_boundary_hold: true,
      direction: "bearish",
      regime_filter: { directional: "trend_down" },
    },
    regime: {
      trend_lookback: 5,
      atr_lookback: 2,
      volatility_baseline_lookback: 5,
      trend_efficiency_threshold: 0.5,
      range_efficiency_threshold: 0.2,
      directional_move_atr_threshold: 0.5,
      minimum_classified_bars: 1,
      minimum_group_events: 1,
      minimum_coverage_ratio: 0.8,
      max_regime_age_bars: 1,
    },
    horizons: [1, 2], target_return_bps: 20, minimum_events: 1, event_limit: 10,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.sample.events, 1);
  assert.deepEqual(Object.keys(parsed.byBranch), ["fvg_retest_bearish"]);
  assert.equal(parsed.selectionContract.regime.directional, "trend_down");
  assert.equal(parsed.quality.regimeMismatchExcluded, 0);
});

test("run_yield_price_nonconfirmation_study binds optional third-chart context evidence", async () => {
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
  const contextBars = makeBars([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
  const calls = [];
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 3,
      charts: [
        { index: 0, symbol: "OANDA:USDJPY", resolution: "1D", studies: [] },
        { index: 1, symbol: "TVC:US10Y", resolution: "1D", studies: [] },
        { index: 2, symbol: "TVC:DXY", resolution: "1D", studies: [] },
      ] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async (count, chartIndex) => {
      calls.push({ count, chartIndex });
      if (chartIndex === 0) return { symbol: "OANDA:USDJPY", resolution: "1D", count: targetBars.length, bars: targetBars };
      if (chartIndex === 1) return { symbol: "TVC:US10Y", resolution: "1D", count: driverBars.length, bars: driverBars };
      return { symbol: "TVC:DXY", resolution: "1D", count: contextBars.length, bars: contextBars };
    },
  } }));
  const res = await client.callTool({ name: "run_yield_price_nonconfirmation_study", arguments: {
    target_chart_index: 0, driver_chart_index: 1,
    context_regime: { chart_index: 2, expected_symbol: "TVC:DXY", expected_timeframe: "1D", lookback: 2, minimum_return: 0, max_age_bars: 2 },
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
  assert.equal(parsed.source.context.chartIndex, 2);
  assert.equal(parsed.definition.contextRegime.symbol, "TVC:DXY");
  assert.deepEqual(calls.sort((left, right) => left.chartIndex - right.chartIndex), [
    { count: 100, chartIndex: 0 }, { count: 100, chartIndex: 1 }, { count: 100, chartIndex: 2 },
  ]);
});

test("run_yield_price_nonconfirmation_study reads the fixed DXY Pine gate from the target chart", async () => {
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
  const ohlcvCalls = [];
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2,
      charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "1D", studies: [{ id: "gate1", name: "Bushido DXY Context Gate v1" }] },
        { index: 1, symbol: "TVC:US10Y", resolution: "1D", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async (count, chartIndex) => {
      ohlcvCalls.push(chartIndex);
      return chartIndex === 0
        ? { symbol: "OANDA:USDJPY", resolution: "1D", count: targetBars.length, bars: targetBars }
        : { symbol: "TVC:US10Y", resolution: "1D", count: driverBars.length, bars: driverBars };
    },
    getIndicatorValues: async () => [{ id: "gate1", name: "Bushido DXY Context Gate v1",
      plots: [{ id: "plot_1", title: "dxy_gate", type: "line" }],
      bars: targetBars.map((bar) => ({ time: bar.time, timeIso: bar.timeIso, values: { plot_1: 0 } })) }],
  } }));
  const res = await client.callTool({ name: "run_yield_price_nonconfirmation_study", arguments: {
    target_chart_index: 0, driver_chart_index: 1,
    context_indicator: { study_id: "gate1", gate_plot_id: "dxy_gate", max_age_bars: 2,
      accepted_gate_value: 0 },
    expected_target_symbol: "OANDA:USDJPY", expected_driver_symbol: "TVC:US10Y",
    expected_target_timeframe: "1D", expected_driver_timeframe: "1D", count: 100,
    relationship: "direct", driver_lookback: 2, driver_change_threshold: 0.1,
    price_breakout_lookback: 3, nonconfirmation_bars: 2, trigger_lookback: 2,
    trigger_within_bars: 3, max_driver_age_bars: 2, horizons: [1, 2],
    target_return_bps: 50, minimum_events: 1, event_limit: 10,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.sample.events, 1);
  assert.equal(parsed.definition.contextIndicator.studyId, "gate1");
  assert.equal(parsed.definition.contextIndicator.acceptedGateValue, 0);
  assert.equal(parsed.source.contextIndicator.chartIndex, 0);
  assert.deepEqual(ohlcvCalls.sort(), [0, 1]);
});

test("run_yield_price_nonconfirmation_study rejects simultaneous OHLC and Pine context gates", async () => {
  const client = await connectedClient(makeDeps());
  const res = await client.callTool({ name: "run_yield_price_nonconfirmation_study", arguments: {
    target_chart_index: 0, driver_chart_index: 1,
    context_regime: { chart_index: 2, expected_symbol: "TVC:DXY",
      expected_timeframe: "1D", lookback: 20, minimum_return: 0, max_age_bars: 2 },
    context_indicator: { study_id: "gate1", gate_plot_id: "dxy_gate", max_age_bars: 2 },
    expected_target_symbol: "OANDA:USDJPY", expected_driver_symbol: "TVC:US10Y",
    expected_target_timeframe: "1D", expected_driver_timeframe: "1D", count: 100,
    relationship: "direct", driver_lookback: 2, driver_change_threshold: 0.1,
    price_breakout_lookback: 3, nonconfirmation_bars: 2, trigger_lookback: 2,
    trigger_within_bars: 3, max_driver_age_bars: 2, horizons: [1, 2],
    target_return_bps: 50, minimum_events: 1, event_limit: 10,
  } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /context_regime and context_indicator are mutually exclusive/);
});

test("run_yield_price_nonconfirmation_study fails closed for an untrusted DXY gate study", async (t) => {
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
  const arguments_ = {
    target_chart_index: 0, driver_chart_index: 1,
    context_indicator: { study_id: "gate1", gate_plot_id: "dxy_gate", max_age_bars: 2 },
    expected_target_symbol: "OANDA:USDJPY", expected_driver_symbol: "TVC:US10Y",
    expected_target_timeframe: "1D", expected_driver_timeframe: "1D", count: 100,
    relationship: "direct", driver_lookback: 2, driver_change_threshold: 0.1,
    price_breakout_lookback: 3, nonconfirmation_bars: 2, trigger_lookback: 2,
    trigger_within_bars: 3, max_driver_age_bars: 2, horizons: [1, 2],
    target_return_bps: 50, minimum_events: 1, event_limit: 10,
  };
  const run = async (indicator) => {
    const client = await connectedClient(makeDeps({ tv: {
      getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2,
        charts: [{ index: 0, symbol: "OANDA:USDJPY", resolution: "1D",
          studies: [{ id: "gate1", name: indicator.name }] },
        { index: 1, symbol: "TVC:US10Y", resolution: "1D", studies: [] }] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async (count, chartIndex) => chartIndex === 0
        ? { symbol: "OANDA:USDJPY", resolution: "1D", count: targetBars.length, bars: targetBars }
        : { symbol: "TVC:US10Y", resolution: "1D", count: driverBars.length, bars: driverBars },
      getIndicatorValues: async () => [indicator],
    } }));
    return client.callTool({ name: "run_yield_price_nonconfirmation_study", arguments: arguments_ });
  };
  const validBars = targetBars.map((bar) => ({
    time: bar.time, timeIso: bar.timeIso, values: { plot_1: 1 },
  }));

  await t.test("rejects a different study name", async () => {
    const res = await run({ id: "gate1", name: "Another Indicator", hasError: false,
      plots: [{ id: "plot_1", title: "dxy_gate", type: "line" }], bars: validBars });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /does not match the fixed DXY gate template/);
  });

  await t.test("rejects a study calculation error", async () => {
    const res = await run({ id: "gate1", name: "Bushido DXY Context Gate v1", hasError: true,
      plots: [{ id: "plot_1", title: "dxy_gate", type: "line" }], bars: validBars });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /does not match the fixed DXY gate template/);
  });

  await t.test("rejects a missing gate plot", async () => {
    const res = await run({ id: "gate1", name: "Bushido DXY Context Gate v1", hasError: false,
      plots: [{ id: "plot_0", title: "dxy_return_20", type: "line" }], bars: validBars });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /dxy_gate plot not found/);
  });
});

test("run_yield_price_nonconfirmation_study forwards driver_lag_bars and configuration_trials over MCP", async () => {
  const day = 86_400_000;
  const start = Date.UTC(2026, 0, 1);
  const makeBars = (closes, offset = 0) => closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    const time = start + offset + index * day;
    return { time: time / 1000, timeIso: new Date(time).toISOString(), open: previous,
      high: Math.max(previous, close) + 0.2, low: Math.min(previous, close) - 0.2,
      close, volume: 1 };
  });
  const driverBars = makeBars([4, 4, 4, 4, 4, 4.15, 4.16, 4.16, 4.16, 4.16, 4.16, 4.16, 4.16]);
  const targetBars = makeBars([100, 100.1, 100, 100.2, 100.1, 100.1, 100.1, 100, 99.9, 98, 97, 96, 95], 22 * 3_600_000);
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2,
      charts: [
        { index: 0, symbol: "OANDA:USDJPY", resolution: "1D", studies: [] },
        { index: 1, symbol: "TVC:US10Y", resolution: "1D", studies: [] },
      ] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async (count, chartIndex) => chartIndex === 0
      ? { symbol: "OANDA:USDJPY", resolution: "1D", count: targetBars.length, bars: targetBars }
      : { symbol: "TVC:US10Y", resolution: "1D", count: driverBars.length, bars: driverBars },
  } }));

  const res = await client.callTool({ name: "run_yield_price_nonconfirmation_study", arguments: {
    target_chart_index: 0, driver_chart_index: 1,
    expected_target_symbol: "OANDA:USDJPY", expected_driver_symbol: "TVC:US10Y",
    expected_target_timeframe: "1D", expected_driver_timeframe: "1D", count: 100,
    relationship: "direct", driver_lookback: 2, driver_change_threshold: 0.1,
    driver_lag_bars: 2, configuration_trials: 10,
    price_breakout_lookback: 3, nonconfirmation_bars: 2, trigger_lookback: 2,
    trigger_within_bars: 3, max_driver_age_bars: 2, horizons: [1, 2],
    target_return_bps: 50, minimum_events: 1, event_limit: 10,
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.schemaVersion, "1.1");
  assert.equal(parsed.methodologyVersion, "yield_price_nonconfirmation_event_study_v2");
  assert.equal(parsed.definition.driverLagBars, 2);
  assert.equal(parsed.definition.configurationTrials, 10);
  assert.equal(parsed.inferenceContract.configurationTrials, 10);
  assert.equal(parsed.inferenceContract.bonferroniAdjustedAlphaReference, 0.005);
  assert.ok(parsed.inferenceWarnings.includes("confidence_intervals_do_not_adjust_for_multiple_testing_bonferroni_reference_only"));
  assert.equal(parsed.sample.events, 1);
});

test("compute_feature_outcome_relationships binds closed OHLC to the active chart", async () => {
  const journalRecords = [];
  let journalFailure = null;
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 30 }, (_, index) => {
    const open = 100 + Math.sin(index / 3);
    const close = open + (index % 3 === 0 ? 0.8 : -0.35);
    return { time: (start + index * 3_600_000) / 1000,
      timeIso: new Date(start + index * 3_600_000).toISOString(),
      open, high: Math.max(open, close) + 0.3, low: Math.min(open, close) - 0.3, close, volume: 1 };
  });
  const client = await connectedClient(makeDeps({ researchJournal: {
    recordEventStudy: async (payload) => {
      if (journalFailure) throw journalFailure;
      journalRecords.push(payload);
      return { recorded: true, entry: { payload, evidence_hash: `sha256:${"f".repeat(64)}` } };
    },
  }, tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
      charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }),
  } }));
  const res = await client.callTool({ name: "compute_feature_outcome_relationships", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
    features: ["body_direction", "range_position"], atr_lookback: 2, atr_baseline_lookback: 5,
    range_lookback: 3, streak_minimum_bars: 2, horizons: [1, 3], minimum_observations: 5, minimum_effect_bps: 10,
    confidence_level: 0.99,
    configuration_trials: 18,
    journal: { hypothesis_id: "feature-eurusd", population: "out_of_sample", decision: "inconclusive" },
    observation_limit: 2,
  } });
  assert.equal(res.isError, undefined, res.content[0].text);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.inferenceContract.configurationTrials, 18);
  assert.equal(parsed.inferenceContract.multipleTestingAdjustment, "bonferroni_family_wise_error_rate");
  assert.equal(parsed.inferenceContract.candidateEligibility, "requires_empirical_null_calibration_after_horizon_1_newey_west_and_bonferroni");
  // A fixture this small cannot be the calibrated study, and the result says so rather than leaving
  // the reader to work it out. Without empirical-null calibration no candidate verdict is issued.
  assert.equal(parsed.inferenceContract.matchesCalibratedStudy, false);
  assert.ok(parsed.inferenceContract.calibratedStudyDepartures.length > 0);
  assert.equal("empiricalNullCalibration" in parsed, false);
  assert.equal(parsed.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.inference.familyTests, 216);
  assert.equal(parsed.symbol, "OANDA:EURUSD");
  assert.equal(parsed.conditionType, "feature_outcome_relationships");
  assert.match(parsed.studyId, /^sha256:/);
  assert.match(parsed.definitionHash, /^sha256:/);
  assert.equal(parsed.source.chartIndex, 0);
  assert.equal(parsed.outcomeContract.forwardFill, false);
  assert.equal(parsed.inferenceContract.confidenceLevel, 0.99);
  assert.equal(parsed.byFeature.body_direction.bullish_body.horizons["1"].forwardReturn.meanConfidenceInterval.confidenceLevel, 0.99);
  assert.ok(parsed.byFeature.body_direction.bullish_body.observations > 0);
  assert.equal(parsed.observations.length, 2);
  assert.equal(parsed.journal.recorded, true);
  assert.equal(journalRecords[0].configurationTrials, 18);
  assert.equal(journalRecords[0].conditionType, "feature_outcome_relationships");
  const bullish = journalRecords[0].outcomes.find((item) => item.branch === "body_direction:bullish_body" &&
    item.horizonBars === 1);
  assert.equal(typeof bullish.meanForwardReturn, "number");
  assert.equal("meanDirectionalReturn" in bullish, false);
  assert.equal(JSON.stringify(parsed).includes('"bars"'), false);

  journalFailure = new Error("research journal unavailable");
  const failedJournal = JSON.parse((await client.callTool({
    name: "compute_feature_outcome_relationships",
    arguments: {
      expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
      features: ["body_direction"], atr_lookback: 2, atr_baseline_lookback: 5,
      range_lookback: 3, streak_minimum_bars: 2, horizons: [1], minimum_observations: 5, minimum_effect_bps: 10,
      journal: { hypothesis_id: "feature-eurusd", population: "out_of_sample", decision: "inconclusive" },
      observation_limit: 0,
    },
  })).content[0].text);
  assert.ok(failedJournal.byFeature.body_direction);
  assert.equal(failedJournal.journal.recorded, false);
  assert.match(failedJournal.journal.error, /research journal unavailable/);

  const regimeFiltered = JSON.parse((await client.callTool({
    name: "compute_feature_outcome_relationships",
    arguments: {
      expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
      features: ["range_position"], atr_lookback: 2, atr_baseline_lookback: 5,
      range_lookback: 3, streak_minimum_bars: 2, horizons: [1], minimum_observations: 1, minimum_effect_bps: 10,
      regime: {
        directional_regime: "trend_up", trend_lookback: 2, atr_lookback: 2,
        volatility_baseline_lookback: 5, directional_move_atr_threshold: 0.1,
      }, observation_limit: 0,
    },
  })).content[0].text);
  assert.equal(regimeFiltered.definition.regime.directionalRegime, "trend_up");
  assert.equal(regimeFiltered.regimeEvidence.filter.directionalRegime, "trend_up");
  assert.ok(regimeFiltered.sample.observations < parsed.sample.observations);
  assert.ok(regimeFiltered.quality.regimeExcluded > 0);

  const forwardSelected = JSON.parse((await client.callTool({
    name: "compute_feature_outcome_relationships",
    arguments: {
      expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 100,
      feature_selection: { feature: "body_direction", bucket: "bullish_body" },
      signal_from: bars[15].timeIso, signal_to: bars[25].timeIso,
      atr_lookback: 2, atr_baseline_lookback: 5, range_lookback: 3, streak_minimum_bars: 2,
      horizons: [1], minimum_observations: 1, minimum_effect_bps: 10, observation_limit: 20,
    },
  })).content[0].text);
  assert.deepEqual(forwardSelected.features, ["body_direction"]);
  assert.deepEqual(forwardSelected.definition.selection, { feature: "body_direction", bucket: "bullish_body" });
  assert.equal(forwardSelected.definition.signalFrom, bars[15].timeIso);
  assert.equal(forwardSelected.definition.signalTo, bars[25].timeIso);
  assert.deepEqual(Object.keys(forwardSelected.byFeature.body_direction), ["bullish_body"]);
  assert.ok(forwardSelected.observations.every((row) => row.signalTime >= bars[15].timeIso && row.signalTime < bars[25].timeIso));
  assert.ok(forwardSelected.quality.signalBeforeWindowExcluded > 0);

  const incompatibleSelection = await client.callTool({
    name: "compute_feature_outcome_relationships",
    arguments: {
      expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", features: ["body_direction"],
      feature_selection: { feature: "body_direction", bucket: "bullish_body" }, horizons: [1],
      minimum_observations: 30, minimum_effect_bps: 10, configuration_trials: 1,
    },
  });
  assert.equal(incompatibleSelection.isError, true);
  assert.match(incompatibleSelection.content[0].text, /feature_selection cannot be combined with features/);
});

test("a candidate verdict from the chart is refused unless the study is the calibrated one", async () => {
  // The tool judges a real market. The falsification and power audits deliberately run uncalibrated
  // studies - that is how a new one gets calibrated - so the refusal belongs here, at the boundary
  // that issues verdicts, and not in the computation both share.
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 400 }, (_, index) => {
    const open = 100 + Math.sin(index / 7) * 2;
    const close = open + (index % 5 === 0 ? 0.4 : -0.1);
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
  const calibrated = {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 400,
    horizons: [1, 5, 21], minimum_effect_bps: 10, empirical_null_calibration: true, observation_limit: 0,
  };
  const refused = await client.callTool({ name: "compute_feature_outcome_relationships", arguments: {
    ...calibrated, wick_imbalance_threshold: 0.2,
  } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /bound to the study those verdicts were calibrated at/);
  assert.match(refused.content[0].text, /wickImbalanceThreshold must be 0.6/);

  // Omitting the thresholds has to land on the calibrated study rather than on a set of defaults
  // that merely look reasonable - that mismatch is what let an unmeasured rule issue verdicts.
  const accepted = await client.callTool({ name: "compute_feature_outcome_relationships", arguments: calibrated });
  assert.equal(accepted.isError, undefined, accepted.content[0].text);
  const parsed = JSON.parse(accepted.content[0].text);
  assert.equal(parsed.inferenceContract.matchesCalibratedStudy, true);
  assert.deepEqual(parsed.inferenceContract.calibratedStudyDepartures, []);
  assert.equal(parsed.definition.wickImbalanceThreshold, 0.6);
  assert.equal(parsed.definition.gapAtrThreshold, 0.5);
  assert.equal(parsed.sample.minimumObservations, 30);
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
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2,
    charts: [
      { index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [{ id: "original", name: "RSI" }] },
      { index: 1, symbol: "TVC:DXY", resolution: "60", studies: [] },
    ] });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    listPineScripts: async () => [{ pineId, name: "Regime Strategy", kind: "strategy",
      version: "1.0", usedBy: [] }],
    getOhlcv: async (count, chartIndex = 0) => ((requestedOhlcvCount = count),
      chartIndex === 0
        ? { symbol: "OANDA:EURUSD", resolution: "60", count: bars.length, bars }
        : { symbol: "TVC:DXY", resolution: "60", count: bars.length, bars: bars.map((bar, index) => ({
          ...bar, open: 300 - Math.max(0, index - 1) * 0.5, high: 300 - index * 0.5 + 0.2,
          low: 300 - index * 0.5 - 0.2, close: 300 - index * 0.5,
        })) }),
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
  assert.equal(preview.definition.methodologyVersion, "strategy_regime_analysis_v2");
  const matrixPreview = JSON.parse((await client.callTool({ name: "run_strategy_regime_matrix", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", jobs: [{ symbol: "OANDA:EURUSD", timeframe: "60", pine_id: pineId }],
  } })).content[0].text);
  assert.deepEqual([matrixPreview.dryRun, matrixPreview.definition.methodologyVersion], [true, "strategy_regime_matrix_v2"]);
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
    event_proximity: { events: [{ event_id: "us-cpi", occurred_at: "2026-01-05T04:00:00.000Z" }],
      coverage_from: "2026-01-05T03:30:00.000Z", coverage_to: "2026-01-05T05:00:00.000Z",
      before_minutes: 30, after_minutes: 60 },
    correlation_regime: { reference_chart_index: 1, expected_reference_symbol: "TVC:DXY", count: 200,
      window: 20, strong_threshold: 0.7, neutral_threshold: 0.2, max_age_bars: 1 },
  } })).content[0].text);
  assert.equal(result.status, "complete");
  assert.equal(result.evaluation.coverage.joinedTrades, 4);
  assert.equal(result.evaluation.byDirectionalRegime.trend_up.profitFactor, 7 / 3);
  assert.equal(result.evaluation.byEventProximity.near_scheduled_event.trades, 1);
  assert.equal(result.definition.join.eventProximity.events.length, 1);
  assert.equal(result.definition.join.eventProximity.coverageFrom, "2026-01-05T03:30:00.000Z");
  assert.equal(result.definition.join.correlationRegime.referenceSymbol, "TVC:DXY");
  assert.equal(result.correlationEvidence.sample.observations, 180);
  assert.equal(Object.values(result.evaluation.byCorrelationRegime)
    .reduce((sum, group) => sum + group.trades, 0), 4);
  assert.equal(result.evaluation.byCorrelationRegime.outside_correlation_evidence, undefined);
  assert.equal(result.chartStateAfter.restored, true);
  assert.equal(result.strategyEvidence.ledgerTrades, 4);
  assert.equal(runs, 1);
  assert.equal(removed, 1);
  assert.equal(requestedOhlcvCount, 200);
});

test("run_strategy_regime_matrix evaluates serial jobs and restores the original chart", async () => {
  const pineId = "USER;regimematrix123";
  const chart = { symbol: "OANDA:USDJPY", resolution: "60" };
  const referenceChart = { symbol: "TVC:DXY", resolution: "60" };
  const start = Date.UTC(2026, 0, 1);
  let activePine = null;
  let runs = 0;
  let removed = 0;
  const historyLoadsByChart = [];
  const operations = [];
  const context = () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2,
    charts: [{ index: 0, symbol: chart.symbol, resolution: chart.resolution,
      studies: [{ id: "original", name: "RSI" }] },
    { index: 1, symbol: referenceChart.symbol, resolution: referenceChart.resolution, studies: [] }] });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    setSymbol: async (symbol, chartIndex = 0) => {
      const target = chartIndex === 1 ? referenceChart : chart;
      target.symbol = symbol;
      return { symbol, resolution: target.resolution, bars: 200 };
    },
    setResolution: async (resolution, chartIndex = 0) => {
      const target = chartIndex === 1 ? referenceChart : chart;
      target.resolution = resolution;
      operations.push(`resolution:${chartIndex}:${resolution}`);
      return { symbol: target.symbol, resolution, bars: 200 };
    },
    listPineScripts: async () => [{ pineId, name: "Regime Matrix Strategy", kind: "strategy",
      version: "2.0", usedBy: [] }],
    getOhlcv: async (count, chartIndex) => {
      assert.equal(count, 200);
      assert.ok(chartIndex === 0 || chartIndex === 1);
      const source = chartIndex === 0 ? chart : referenceChart;
      const step = Number(source.resolution) * 60_000;
      const bars = Array.from({ length: 200 }, (_, index) => {
        const open = chartIndex === 0
          ? 100 + Math.max(0, index - 1) * 0.5
          : 200 - Math.max(0, index - 1) * 0.5;
        const close = chartIndex === 0 ? 100 + index * 0.5 : 200 - index * 0.5;
        const time = start + index * step;
        return { time: time / 1000, timeIso: new Date(time).toISOString(), open,
          high: close + 0.2, low: open - 0.2, close, volume: 1 };
      });
      return { symbol: source.symbol, resolution: source.resolution, count: bars.length, bars };
    },
    loadMoreHistory: async ({ count, chartIndex }) => {
      historyLoadsByChart.push({ count, chartIndex });
      return { requested: count, barsBefore: 300, barsAfter: 300 + count, added: count, moreAvailable: true };
    },
    runBacktest: async () => ((runs += 1), (activePine = pineId), operations.push(`run:${runs}`),
      { studyId: `temporary-${runs}`, pineId, keptOnChart: true, removedFromChart: false,
        strategy: "Regime Matrix Strategy", summary: {}, totalTrades: 4, trades: [] }),
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
    expected_symbol: "OANDA:USDJPY", expected_timeframe: "60", count: 200, load_more_bars: 6000,
    trend_lookback: 10, atr_lookback: 5, volatility_baseline_lookback: 20,
    minimum_classified_bars: 20, minimum_group_trades: 1, minimum_coverage_ratio: 1,
    max_regime_age_bars: 1,
    session_match_policy: "first_match_exclusive",
    sessions: [{ session_id: "london", timezone: "Europe/London", start: "08:00", end: "16:00" }],
    event_proximity: {
      events: [{ event_id: "us-cpi", occurred_at: "2026-01-05T04:00:00.000Z" }],
      coverage_from: "2026-01-05T03:30:00.000Z", coverage_to: "2026-01-05T05:00:00.000Z",
      before_minutes: 30, after_minutes: 60,
    },
    correlation_regime: {
      reference_chart_index: 1, expected_reference_symbol: "TVC:DXY", count: 200,
      window: 10, strong_threshold: 0.7, neutral_threshold: 0.2, max_age_bars: 1,
    },
    jobs: [
      { symbol: "OANDA:EURUSD", timeframe: "60", pine_id: pineId },
      { symbol: "OANDA:XAUUSD", timeframe: "60", pine_id: pineId },
    ],
  };
  const preview = JSON.parse((await client.callTool({
    name: "run_strategy_regime_matrix", arguments: args,
  })).content[0].text);
  assert.equal(preview.status, "preview");
  assert.equal(preview.jobCount, 2);
  assert.equal(preview.execution.historyLoadPerJob, 6000);
  assert.deepEqual(preview.execution.correlationReferenceHistoryLoad, {
    chartIndex: 1, requestedBars: 6000, onceBeforeJobs: true, perJobBeforeCapture: false,
  });
  assert.equal(preview.definition.join.eventProximity.events.length, 1);
  assert.equal(preview.definition.join.eventProximity.coverageFrom, "2026-01-05T03:30:00.000Z");
  assert.equal(preview.definition.join.correlationRegime.referenceSymbol, "TVC:DXY");
  assert.equal(runs, 0);

  const result = JSON.parse((await client.callTool({
    name: "run_strategy_regime_matrix", arguments: { ...args, confirm: true },
  })).content[0].text);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.results.map((row) => row.status), ["complete", "complete"]);
  assert.deepEqual(result.results.map((row) => row.evaluation.coverage.joinedTrades), [4, 4]);
  assert.equal(result.results[0].evaluation.overall.profitFactor, 7 / 3);
  assert.equal(result.results[1].evaluation.overall.profitFactor, 11 / 3);
  assert.deepEqual(result.results.map((row) => row.evaluation.bySession.london.trades), [2, 2]);
  assert.deepEqual(result.results.map((row) => row.regimeEvidence.source.historyLoad.attempts), [2, 2]);
  assert.deepEqual(result.results.map((row) => row.regimeEvidence.source.historyLoad.addedBars), [6000, 6000]);
  assert.deepEqual(result.correlationReferenceHistoryLoad, {
    chartIndex: 1, requestedBars: 6000, attempts: 2, addedBars: 6000, moreAvailable: true,
  });
  assert.deepEqual(historyLoadsByChart.filter((load) => load.chartIndex === 1), [
    { count: 5000, chartIndex: 1 }, { count: 1000, chartIndex: 1 },
  ]);
  assert.equal(preview.definition.join.sessionMatchPolicy, "first_match_exclusive");
  assert.equal(result.results[0].evaluation.joinContract.sessionMatchPolicy, "first_match_exclusive");
  assert.deepEqual(result.results[0].evaluation.joinContract.sessionPriority, ["london"]);
  assert.deepEqual(result.results.map((row) => row.evaluation.joinContract.eventProximity.events), [1, 1]);
  assert.deepEqual(result.results.map((row) => row.evaluation.joinContract.eventProximity.coverageTo), [
    "2026-01-05T05:00:00.000Z", "2026-01-05T05:00:00.000Z",
  ]);
  assert.deepEqual(result.results.map((row) => row.correlationEvidence.referenceSymbol), ["TVC:DXY", "TVC:DXY"]);
  assert.deepEqual(result.results.map((row) => row.correlationEvidence.sample.observations), [190, 190]);
  assert.deepEqual(result.results.map((row) => Object.values(row.evaluation.byCorrelationRegime)
    .reduce((sum, group) => sum + group.trades, 0)), [4, 4]);

  const operationCountBeforeMixed = operations.length;
  const mixedTimeframe = JSON.parse((await client.callTool({
    name: "run_strategy_regime_matrix",
    arguments: {
      ...args,
      correlation_regime: { ...args.correlation_regime, allow_reference_timeframe_switch: true },
      jobs: [{ symbol: "OANDA:XAUUSD", timeframe: "240", pine_id: pineId }],
      confirm: true,
    },
  })).content[0].text);
  assert.equal(mixedTimeframe.status, "complete");
  assert.equal(mixedTimeframe.definition.join.correlationRegime.allowReferenceTimeframeSwitch, true);
  assert.deepEqual(mixedTimeframe.execution.correlationReferenceHistoryLoad, {
    chartIndex: 1, requestedBars: 6000, onceBeforeJobs: false, perJobBeforeCapture: true,
  });
  assert.equal(mixedTimeframe.results[0].correlationEvidence.referenceTimeframeSwitched, true);
  assert.deepEqual(mixedTimeframe.results[0].correlationEvidence.source.historyLoad, {
    requestedBars: 6000, attempts: 2, addedBars: 6000, moreAvailable: true,
  });
  assert.equal(mixedTimeframe.results[0].referenceChartRestored, true);
  assert.equal(mixedTimeframe.chartStateAfter.referenceRestored, true);
  const mixedOperations = operations.slice(operationCountBeforeMixed);
  assert.ok(mixedOperations.indexOf("run:3") < mixedOperations.indexOf("resolution:1:240"),
    "the primary strategy ledger must be collected before the reference pane becomes active");
  assert.equal(result.chartStateAfter.restored, true);
  assert.equal(runs, 3);
  assert.equal(removed, 3);
  assert.deepEqual(historyLoadsByChart.filter((load) => load.chartIndex === 1), [
    { count: 5000, chartIndex: 1 }, { count: 1000, chartIndex: 1 },
    { count: 5000, chartIndex: 1 }, { count: 1000, chartIndex: 1 },
  ]);
  assert.deepEqual(chart, { symbol: "OANDA:USDJPY", resolution: "60" });
  assert.deepEqual(referenceChart, { symbol: "TVC:DXY", resolution: "60" });
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
    { name: "get_indicator_values", arguments: { count: 5001 } },
    { name: "get_indicator_values", arguments: { plot_titles: [] } },
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
    { name: "run_market_event_study", arguments: {
      expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 30_001,
      condition: { type: "session_auction", timezone: "UTC", range_start: "08:00", range_end: "09:00",
        auction_end: "10:00" }, horizons: [1], target_return_bps: 10, minimum_events: 1,
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

test("set_symbol takes a symbol without its exchange and refuses one resolved to another instrument (102-21)", async () => {
  const charts = [{ index: 0, symbol: "OANDA:XAUUSD", resolution: "60", studies: [] }];
  // As TradingView: "EURUSD" resolves to OANDA's; "GBPUSD" lands on another instrument.
  const resolve = (symbol) => (symbol === "GBPUSD" ? "OANDA:GBPJPY" : symbol.includes(":") ? symbol : `OANDA:${symbol}`);
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "one", activeChartIndex: 0, chartsCount: 1, charts }),
      setSymbol: async (symbol, chartIndex) => {
        charts[chartIndex].symbol = resolve(symbol);
        return { symbol: charts[chartIndex].symbol, resolution: charts[chartIndex].resolution, changed: true, bars: 100 };
      },
      setResolution: async () => { throw new Error("unused"); },
    },
  }));
  const res = await client.callTool({ name: "set_symbol", arguments: { symbol: "EURUSD" } });
  assert.equal(res.isError, undefined);
  const result = JSON.parse(res.content[0].text);
  assert.deepEqual([result.symbol, result.changed, result.transaction.original.symbol], ["OANDA:EURUSD", true, "OANDA:XAUUSD"]);
  assert.equal(charts[0].symbol, "OANDA:EURUSD");

  const wrong = await client.callTool({ name: "set_symbol", arguments: { symbol: "GBPUSD" } });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0].text, /requested GBPUSD, chart shows OANDA:GBPJPY/);
  assert.equal(charts[0].symbol, "OANDA:EURUSD");
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

test("run_strategy_regime_matrix supports per-job correlation_regime override and reference symbol switching", async () => {
  const bars = [
    { time: 1767225600, timeIso: "2026-01-01T00:00:00.000Z", open: 100, high: 101, low: 99, close: 100.5, volume: 100 },
    { time: 1767229200, timeIso: "2026-01-01T01:00:00.000Z", open: 100.5, high: 102, low: 100, close: 101.5, volume: 110 },
    { time: 1767232800, timeIso: "2026-01-01T02:00:00.000Z", open: 101.5, high: 103, low: 101, close: 102.5, volume: 120 },
  ];

  let chart0Symbol = "OANDA:EURUSD";
  let chart1Symbol = "TVC:DXY";

  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test_layout",
        activeChartIndex: 0,
        chartsCount: 2,
        charts: [
          { index: 0, symbol: chart0Symbol, resolution: "60", studies: [] },
          { index: 1, symbol: chart1Symbol, resolution: "60", studies: [] },
        ],
      }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      listPineScripts: async () => [
        { pineId: "USER;strat12345", kind: "strategy", version: "v1.0", name: "Test Strategy" },
      ],
      getOhlcv: async (count, chartIndex) => {
        const sym = chartIndex === 0 ? chart0Symbol : chart1Symbol;
        return { symbol: sym, resolution: "60", count: bars.length, bars };
      },
      setSymbol: async (sym, chartIndex) => {
        if (chartIndex === 0) chart0Symbol = sym;
        else if (chartIndex === 1) chart1Symbol = sym;
        return { symbol: sym };
      },
      setResolution: async (res, chartIndex) => ({ resolution: res }),
    },
  }));

  const previewRes = await client.callTool({
    name: "run_strategy_regime_matrix",
    arguments: {
      expected_symbol: "OANDA:EURUSD",
      expected_timeframe: "60",
      jobs: [
        {
          symbol: "OANDA:EURUSD",
          timeframe: "60",
          pine_id: "USER;strat12345",
          correlation_regime: {
            reference_chart_index: 1,
            expected_reference_symbol: "TVC:DXY",
          },
        },
        {
          symbol: "OANDA:EURUSD",
          timeframe: "60",
          pine_id: "USER;strat12345",
          correlation_regime: {
            reference_chart_index: 1,
            expected_reference_symbol: "TVC:US10Y",
            allow_reference_symbol_switch: true,
          },
        },
      ],
    },
  });

  const preview = JSON.parse(previewRes.content[0].text);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.status, "preview");
  assert.deepEqual(preview.definition.uniqueReferenceSymbols, ["TVC:DXY", "TVC:US10Y"]);
  assert.equal(preview.definition.referenceComparisonCount, 2);
  assert.equal(preview.definition.inferenceWarnings.includes("multiple_reference_symbols_inspected_in_matrix"), true);
});

test("run_strategy_regime_matrix rejects reference symbol switch when allow_reference_symbol_switch is omitted", async () => {
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test_layout",
        activeChartIndex: 0,
        chartsCount: 2,
        charts: [
          { index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] },
          { index: 1, symbol: "TVC:DXY", resolution: "60", studies: [] },
        ],
      }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      listPineScripts: async () => [
        { pineId: "USER;strat12345", kind: "strategy", version: "v1.0", name: "Test Strategy" },
      ],
    },
  }));

  const res = await client.callTool({
    name: "run_strategy_regime_matrix",
    arguments: {
      expected_symbol: "OANDA:EURUSD",
      expected_timeframe: "60",
      jobs: [
        {
          symbol: "OANDA:EURUSD",
          timeframe: "60",
          pine_id: "USER;strat12345",
          correlation_regime: {
            reference_chart_index: 1,
            expected_reference_symbol: "TVC:US10Y",
          },
        },
      ],
    },
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /allow_reference_symbol_switch=true is required/);
});

test("run_strategy_regime_matrix loads history once for every invariant reference pane", async () => {
  const pineId = "USER;regimemultiref123";
  const chart = { symbol: "OANDA:USDJPY", resolution: "60" };
  const referencePanes = new Map([
    [1, { symbol: "TVC:DXY", resolution: "60" }],
    [2, { symbol: "TVC:US10Y", resolution: "60" }],
  ]);
  const start = Date.UTC(2026, 0, 1);
  let runs = 0;
  let removed = 0;
  let activePine = null;
  const historyLoadsByChart = [];
  const paneFor = (chartIndex) => (chartIndex === 0 ? chart : referencePanes.get(chartIndex));
  const context = () => ({
    layoutName: "test", activeChartIndex: 0, chartsCount: 3,
    charts: [0, 1, 2].map((index) => ({
      index, symbol: paneFor(index).symbol, resolution: paneFor(index).resolution, studies: [],
    })),
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => context(),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    setSymbol: async (symbol, chartIndex = 0) => {
      const target = paneFor(chartIndex);
      target.symbol = symbol;
      return { symbol, resolution: target.resolution, bars: 200 };
    },
    setResolution: async (resolution, chartIndex = 0) => {
      const target = paneFor(chartIndex);
      target.resolution = resolution;
      return { symbol: target.symbol, resolution, bars: 200 };
    },
    listPineScripts: async () => [{ pineId, name: "MultiRef Strategy", kind: "strategy",
      version: "2.0", usedBy: [] }],
    getOhlcv: async (count, chartIndex) => {
      const source = paneFor(chartIndex);
      const step = Number(source.resolution) * 60_000;
      const drift = chartIndex === 0 ? 0.5 : chartIndex === 1 ? -0.5 : 0.25;
      const bars = Array.from({ length: 200 }, (_, index) => {
        const open = 100 + Math.max(0, index - 1) * drift;
        const close = 100 + index * drift;
        const time = start + index * step;
        return { time: time / 1000, timeIso: new Date(time).toISOString(), open,
          high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2, close, volume: 1 };
      });
      return { symbol: source.symbol, resolution: source.resolution, count: bars.length, bars };
    },
    loadMoreHistory: async ({ count, chartIndex }) => {
      historyLoadsByChart.push({ count, chartIndex });
      return { requested: count, barsBefore: 300, barsAfter: 300 + count, added: count, moreAvailable: true };
    },
    runBacktest: async () => ((runs += 1), (activePine = pineId),
      { studyId: `temporary-${runs}`, pineId, keptOnChart: true, removedFromChart: false,
        strategy: "MultiRef Strategy", summary: {}, totalTrades: 4, trades: [] }),
    getStrategyReport: async () => ({ strategy: "MultiRef Strategy", symbol: chart.symbol,
      timeframe: chart.resolution, studyId: `temporary-${runs}`, pineId, pineVersion: "2.0", inputs: [],
      currency: "USD", initialCapital: 100000, dateRange: null, summary: { netProfit: 4 },
      totalTrades: 4, trades: [] }),
    getStrategyTradeLedger: async () => {
      const step = Number(chart.resolution) * 60_000;
      const trades = [4, -2, 3, -1].map((profit, index) => {
        const entryTime = start + (100 + index * 10) * step;
        return { reportIndex: index, number: index + 1, direction: "long", status: "closed",
          entry: { time: entryTime, timeIso: new Date(entryTime).toISOString(), price: 1, label: null },
          exit: { time: entryTime + step, timeIso: new Date(entryTime + step).toISOString(),
            price: 1, label: null }, durationMilliseconds: step, profit, profitPercent: null,
          cumulativeProfit: null, quantity: 1, commission: 0.1, commissionPercent: null,
          runUp: Math.max(profit, 0) + 1, runUpPercent: null, drawDown: Math.max(-profit, 0) + 1,
          drawDownPercent: null };
      });
      return { schemaVersion: "1.0", ledgerId: `sha256:${"e".repeat(64)}`,
        strategy: "MultiRef Strategy", symbol: chart.symbol, timeframe: chart.resolution,
        studyId: `temporary-${runs}`, pineId: activePine, pineVersion: "2.0", inputs: [],
        currency: "USD", initialCapital: 100000, dateRange: null, summary: { totalTrades: 4 },
        totalTrades: 4, availableTrades: 4, countMatchesSummary: true, ordering: "strategy_report",
        offset: 0, limit: 500, returned: 4, nextOffset: null, complete: true,
        unavailableFields: [], qualityIssues: [], trades };
    },
    removePineFromChart: async (requested, studyId) => ((removed += 1), (activePine = null),
      { removed: true, pineId: requested, pineVersion: "2.0", studyId,
        name: "MultiRef Strategy", chartIndex: 0 }),
  } }));

  const args = {
    expected_symbol: "OANDA:USDJPY", expected_timeframe: "60", count: 200, load_more_bars: 6000,
    trend_lookback: 10, atr_lookback: 5, volatility_baseline_lookback: 20,
    minimum_classified_bars: 20, minimum_group_trades: 1, minimum_coverage_ratio: 1,
    max_regime_age_bars: 1,
    jobs: [
      { symbol: "OANDA:EURUSD", timeframe: "60", pine_id: pineId,
        correlation_regime: { reference_chart_index: 1, expected_reference_symbol: "TVC:DXY",
          count: 200, window: 10, max_age_bars: 1 } },
      { symbol: "OANDA:XAUUSD", timeframe: "60", pine_id: pineId,
        correlation_regime: { reference_chart_index: 2, expected_reference_symbol: "TVC:US10Y",
          count: 200, window: 10, max_age_bars: 1 } },
    ],
  };

  const preview = JSON.parse((await client.callTool({
    name: "run_strategy_regime_matrix", arguments: args,
  })).content[0].text);
  assert.equal(preview.status, "preview");
  assert.deepEqual(preview.execution.invariantReferenceChartIndices, [1, 2]);
  assert.deepEqual(preview.execution.uniqueReferenceSymbols, ["TVC:DXY", "TVC:US10Y"]);
  // Every pane is invariant, so nothing is reloaded inside a job; claiming otherwise would
  // contradict invariantReferenceHistoryLoads in the same response.
  assert.equal(preview.execution.correlationReferenceHistoryLoad.perJobBeforeCapture, false);
  assert.equal(historyLoadsByChart.length, 0);

  const result = JSON.parse((await client.callTool({
    name: "run_strategy_regime_matrix", arguments: { ...args, confirm: true },
  })).content[0].text);

  // Every invariant pane must have its history extended once before the jobs run; without this the
  // correlation evidence would silently be computed on whatever bars each pane happened to hold.
  assert.deepEqual(historyLoadsByChart.filter((load) => load.chartIndex === 1),
    [{ count: 5000, chartIndex: 1 }, { count: 1000, chartIndex: 1 }]);
  assert.deepEqual(historyLoadsByChart.filter((load) => load.chartIndex === 2),
    [{ count: 5000, chartIndex: 2 }, { count: 1000, chartIndex: 2 }]);
  assert.deepEqual(result.invariantReferenceHistoryLoads, [
    { chartIndex: 1, requestedBars: 6000, attempts: 2, addedBars: 6000, moreAvailable: true },
    { chartIndex: 2, requestedBars: 6000, attempts: 2, addedBars: 6000, moreAvailable: true },
  ]);

  assert.deepEqual(result.results.map((row) => row.correlationEvidence.referenceSymbol),
    ["TVC:DXY", "TVC:US10Y"]);
  assert.deepEqual(result.results.map((row) => row.correlationEvidence.referenceChartIndex), [1, 2]);
  assert.equal(result.chartStateAfter.referenceRestored, true);
  assert.equal(result.chartStateAfter.restored, true);
  assert.deepEqual(chart, { symbol: "OANDA:USDJPY", resolution: "60" });
  assert.deepEqual(referencePanes.get(1), { symbol: "TVC:DXY", resolution: "60" });
  assert.deepEqual(referencePanes.get(2), { symbol: "TVC:US10Y", resolution: "60" });
  assert.equal(runs, 2);
  assert.equal(removed, 2);
});

test("run_external_label_study binds a daily chart, lags the label and records to the journal", async () => {
  const bars = [];
  let day = Date.UTC(2026, 0, 5, 22);
  for (let index = 0; index < 40; index += 1) {
    const date = new Date(day);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
    const close = 100 + index;
    bars.push({ time: date.getTime() / 1000, timeIso: new Date(date.getTime()).toISOString(),
      open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1 });
    day = date.getTime() + 86_400_000;
  }
  let recorded = null;
  const client = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "t", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "COMEX_DL:GC1!", resolution: "1D", studies: [] }] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async () => ({ symbol: "COMEX_DL:GC1!", resolution: "1D", count: bars.length, bars }),
    },
    researchJournal: {
      recordEventStudy: async (payload) => { recorded = payload; return { recorded: true, idempotent: false, entry: { payload } }; },
    },
  }));

  const res = await client.callTool({ name: "run_external_label_study", arguments: {
    expected_symbol: "COMEX_DL:GC1!", expected_timeframe: "1D", count: 100,
    observations: [{ time: bars[5].timeIso, label: "long_build" }, { time: bars[25].timeIso, label: "long_unwinding" }],
    accepted_labels: [{ label: "long_build", direction: "long" }, { label: "long_unwinding", direction: "short" }],
    observation_lag_bars: 2, horizons: [1, 5], target_return_bps: 20, minimum_events: 1,
    journal: { hypothesis_id: "oi-quadrant", population: "in_sample", decision: "inconclusive" },
  } });
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.methodologyVersion, "external_label_forward_outcome_study_v1");
  assert.equal(parsed.conditionType, "external_label_event");
  assert.equal(parsed.sample.events, 2);
  // The signal must sit two bars after the observation, never on it.
  assert.equal(parsed.events[0].observationTime, bars[5].timeIso);
  assert.equal(parsed.events[0].signalTime, bars[7].timeIso);
  // Daily bars skip weekends, so the five bar window only exists under the observed-bar clock.
  assert.equal(parsed.outcomeContract.contiguousBarsRequired, false);
  assert.ok(parsed.byBranch.long_build.horizons["5"].directionalReturn.mean !== null);
  assert.equal(parsed.journal.recorded, true);
  assert.equal(recorded.conditionType, "external_label_event");
  assert.equal(recorded.hypothesisId, "oi-quadrant");

  const zeroLag = await client.callTool({ name: "run_external_label_study", arguments: {
    expected_symbol: "COMEX_DL:GC1!", expected_timeframe: "1D",
    observations: [{ time: bars[5].timeIso, label: "long_build" }],
    accepted_labels: [{ label: "long_build", direction: "long" }],
    observation_lag_bars: 0, horizons: [1], target_return_bps: 20, minimum_events: 1,
  } });
  assert.equal(zeroLag.isError, true);

  const wrongChart = await client.callTool({ name: "run_external_label_study", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "1D",
    observations: [{ time: bars[5].timeIso, label: "long_build" }],
    accepted_labels: [{ label: "long_build", direction: "long" }],
    observation_lag_bars: 1, horizons: [1], target_return_bps: 20, minimum_events: 1,
  } });
  assert.equal(wrongChart.isError, true);
  assert.match(wrongChart.content[0].text, /binding does not match/);
});

test("compute_lead_lag_relationships binds both charts and returns every scanned lag", async () => {
  const driver = Array.from({ length: 160 }, (_, index) =>
    (((index * 47) % 101) - 50) / 10_000 + ((index % 5) - 2) / 100_000);
  // The primary echoes the reference one bar later, so the planted lead sits at lag +1.
  const primaryReturns = driver.map((_, index) =>
    (index >= 1 ? driver[index - 1] : 0) + ((index % 3) - 1) * 0.0006);
  const closesFrom = (returns) => {
    const closes = [100];
    for (const value of returns) closes.push(closes.at(-1) * Math.exp(value));
    return closes;
  };
  const primaryCloses = closesFrom(primaryReturns);
  const referenceCloses = closesFrom(driver);
  const barsFor = (closes) => closes.map((close, index) => ({
    time: index * 3600, timeIso: new Date(index * 3_600_000).toISOString(),
    open: close, high: close, low: close, close, volume: 1,
  }));

  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
      { index: 0, symbol: "OANDA:USDJPY", resolution: "60", studies: [] },
      { index: 1, symbol: "TVC:US10Y", resolution: "60", studies: [] },
    ] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async (_count, chartIndex) => ({
      symbol: chartIndex === 0 ? "OANDA:USDJPY" : "TVC:US10Y",
      resolution: "60",
      count: primaryCloses.length,
      bars: barsFor(chartIndex === 0 ? primaryCloses : referenceCloses),
    }),
  }}));

  const response = await client.callTool({ name: "compute_lead_lag_relationships", arguments: {
    primary_chart_index: 0, reference_chart_index: 1, expected_primary_symbol: "OANDA:USDJPY",
    expected_reference_symbol: "TVC:US10Y", expected_timeframe: "60",
    max_lag_bars: 3, minimum_observations: 10,
  } });
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.alignmentPolicy, "exact_utc_timestamp_no_forward_fill");
  assert.equal(parsed.methodologyVersion, "lead_lag_relationships_v3_causal_prior_20_rms");
  assert.equal(parsed.definition.returnStandardization.windowBars, 20);
  assert.deepEqual(parsed.byLag.map((entry) => entry.lagBars), [-3, -2, -1, 0, 1, 2, 3]);
  const lagOne = parsed.byLag.find((entry) => entry.lagBars === 1);
  assert.equal(lagOne.leadDirection, "reference_leads_primary");
  assert.equal(lagOne.tradableOnPrimary, true);
  assert.ok(lagOne.correlation > 0.9, `planted lead correlation was ${lagOne.correlation}`);
  assert.equal(parsed.inferenceContract.automaticLagSelection, false);
  assert.equal(lagOne.inference.candidateEligible, false);
  assert.ok(lagOne.inference.candidateBlockers.includes(
    "candidate_rule_not_calibrated_for_shared_clustered_volatility"));
  assert.equal(parsed.primary.chartIndex, 0);
  assert.equal(parsed.reference.symbol, "TVC:US10Y");
  // Raw OHLC must never leak back through the response.
  assert.equal(JSON.stringify(parsed).includes("\"open\""), false);

  const journalRecords = [];
  const journalling = await connectedClient(makeDeps({
    tv: {
      getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
        { index: 0, symbol: "OANDA:USDJPY", resolution: "60", studies: [] },
        { index: 1, symbol: "TVC:US10Y", resolution: "60", studies: [] },
      ] }),
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getOhlcv: async (_count, chartIndex) => ({
        symbol: chartIndex === 0 ? "OANDA:USDJPY" : "TVC:US10Y",
        resolution: "60",
        count: primaryCloses.length,
        bars: barsFor(chartIndex === 0 ? primaryCloses : referenceCloses),
      }),
    },
    researchJournal: {
      recordEventStudy: async (payload) => (journalRecords.push(payload), { recorded: true, entry: { sequence: 1 } }),
    },
  }));
  const args = {
    primary_chart_index: 0, reference_chart_index: 1, expected_primary_symbol: "OANDA:USDJPY",
    expected_reference_symbol: "TVC:US10Y", expected_timeframe: "60",
    max_lag_bars: 3, minimum_observations: 10,
    empirical_null_calibration: true,
    return_standardization: "none",
    folds: [
      { fold_id: "f1", from: "1970-01-01T00:00:00.000Z", to: "1970-01-01T08:00:00.000Z" },
      { fold_id: "f2", from: "1970-01-01T08:00:00.000Z", to: "1970-01-01T20:00:00.000Z" },
    ],
  };
  const recorded = JSON.parse((await journalling.callTool({ name: "compute_lead_lag_relationships", arguments: {
    ...args, journal: { hypothesis_id: "usdjpy-us10y-lead-lag", population: "in_sample", decision: "inconclusive" },
  } })).content[0].text);
  assert.equal(recorded.empiricalNullCalibration.status, "complete");
  assert.equal(recorded.journal.recorded, false);
  assert.match(recorded.journal.error, /empirical-null candidate eligibility/);
  assert.equal(journalRecords.length, 0, "a scan without evaluable, sign-stable folds must not reach the journal");

  // A scan inspects every lag at once, so its strongest lag is never an out-of-sample result.
  const adopted = JSON.parse((await journalling.callTool({ name: "compute_lead_lag_relationships", arguments: {
    ...args, journal: { hypothesis_id: "usdjpy-us10y-lead-lag", population: "in_sample", decision: "adopted" },
  } })).content[0].text);
  assert.equal(adopted.journal.recorded, false);
  assert.match(adopted.journal.error, /empirical-null candidate eligibility/);
  assert.equal(journalRecords.length, 0, "a refused decision must not reach the journal");
});

test("compute_lead_lag_relationships rebuilds a shared 4H UTC grid from closed 60-minute bars and restores both charts", async () => {
  const charts = [
    { index: 0, symbol: "OANDA:USDJPY", resolution: "240", studies: [] },
    { index: 1, symbol: "THINKMARKETS:USDINDEX", resolution: "240", studies: [] },
  ];
  const barsFor = (chartIndex) => Array.from({ length: 100 }, (_, index) => {
    const close = (chartIndex === 0 ? 150 : 100) + index * (chartIndex === 0 ? 0.04 : 0.02) + (index % 3) * 0.01;
    return {
      time: index * 3_600, timeIso: new Date(index * 3_600_000).toISOString(),
      open: close - 0.01, high: close + 0.02, low: close - 0.03, close, volume: 1,
    };
  });
  const client = await connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async (_count, chartIndex) => {
      const chart = charts[chartIndex];
      assert.equal(chart.resolution, "60", "resampling must collect lower-timeframe evidence only after the switch");
      return { symbol: chart.symbol, resolution: chart.resolution, count: 100, bars: barsFor(chartIndex) };
    },
    loadMoreHistory: async ({ count }) => ({ requested: count, barsBefore: 100, barsAfter: 100, added: 0, earliestTime: 0, moreAvailable: false }),
    setResolution: async (resolution, chartIndex) => {
      const chart = charts[chartIndex];
      chart.resolution = resolution;
      return { symbol: chart.symbol, resolution, changed: true, bars: 100 };
    },
  }}));
  const response = await client.callTool({ name: "compute_lead_lag_relationships", arguments: {
    primary_chart_index: 0, reference_chart_index: 1,
    expected_primary_symbol: "OANDA:USDJPY", expected_reference_symbol: "THINKMARKETS:USDINDEX",
    expected_timeframe: "240", count: 20, max_lag_bars: 2, minimum_observations: 4,
    alignment_mode: "resample_closed_60m_to_utc_grid",
  } });
  assert.notEqual(response.isError, true, response.content[0].text);
  const parsed = JSON.parse(response.content[0].text);
  assert.equal(parsed.alignmentPolicy, "utc_grid_resampled_from_closed_60m_bars");
  assert.equal(parsed.resampling.primary.outputBars, 25);
  assert.equal(parsed.resampling.reference.incompleteBucketsExcluded, 0);
  assert.equal(JSON.stringify(parsed).includes('"bars"'), false, "raw source bars must not leak through resampling metadata");
  assert.equal(charts[0].resolution, "240");
  assert.equal(charts[1].resolution, "240");
});

test("compute_lead_lag_relationships rejects a mismatched binding, an identical pane and Bar Replay", async () => {
  const makeClient = (overrides) => connectedClient(makeDeps({ tv: {
    getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 2, charts: [
      { index: 0, symbol: "OANDA:USDJPY", resolution: "60", studies: [] },
      { index: 1, symbol: "TVC:US10Y", resolution: "60", studies: [] },
    ] }),
    getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
    getOhlcv: async (_count, chartIndex) => ({
      symbol: chartIndex === 0 ? "OANDA:USDJPY" : "TVC:US10Y", resolution: "60", count: 2,
      bars: [0, 1].map((index) => ({ time: index * 3600, timeIso: new Date(index * 3_600_000).toISOString(),
        open: 100, high: 100, low: 100, close: 100 + index, volume: 1 })),
    }),
    ...overrides,
  }}));
  const args = {
    primary_chart_index: 0, reference_chart_index: 1, expected_primary_symbol: "OANDA:USDJPY",
    expected_reference_symbol: "TVC:US10Y", expected_timeframe: "60", max_lag_bars: 2,
  };

  const bound = await makeClient({});
  const samePane = await bound.callTool({ name: "compute_lead_lag_relationships",
    arguments: { ...args, reference_chart_index: 0 } });
  assert.equal(samePane.isError, true);
  assert.match(samePane.content[0].text, /chart indexes must differ/);

  const wrongSymbol = await bound.callTool({ name: "compute_lead_lag_relationships",
    arguments: { ...args, expected_reference_symbol: "TVC:DXY" } });
  assert.equal(wrongSymbol.isError, true);
  assert.match(wrongSymbol.content[0].text, /binding does not match/);

  const replaying = await makeClient({
    getReplayStatus: async () => ({ started: true, toolbarVisible: true }),
  });
  const blocked = await replaying.callTool({ name: "compute_lead_lag_relationships", arguments: args });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /Bar Replay/);
});

test("get_cot_crowding_unwind_context holds its declared FX daily binding at the entrance", async () => {
  const tuesday = (index) => new Date(Date.UTC(2026, 6, 7 - index * 7)).toISOString();
  const observations = Array.from({ length: 160 }, (_, index) => ({
    symbol: "OANDA:EURUSD", report_date: tuesday(index), available_at: "2026-08-01T00:00:00.000Z",
    open_interest: 100, target_direction_multiplier: 1,
    positions: [{ group: "lev_money", long: index === 0 ? 100 : 10, short: 0, net: index === 0 ? 100 : 10 }],
  }));
  const bars = Array.from({ length: 21 }, (_, index) => ({
    time: Date.UTC(2026, 6, 1 + index) / 1_000, timeIso: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
    open: 1.1, high: 1.11, low: 1.09, close: index === 20 ? 1.08 : 1.1, volume: 1,
  }));
  let requestedPeriods = null;
  const client = await connectedClient(makeDeps({
    cot: { getHistory: async (symbol, periods) => { requestedPeriods = periods; return { observations }; } },
    tv: {
      getReplayStatus: async () => ({ started: false, toolbarVisible: false }),
      getChartContext: async () => ({ layoutName: "test", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "1D", studies: [] }] }),
      getOhlcv: async () => ({ symbol: "OANDA:EURUSD", resolution: "1D", count: bars.length, bars }),
    },
  }));
  const ok = await client.callTool({ name: "get_cot_crowding_unwind_context", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "1D" } });
  assert.equal(ok.isError, undefined, ok.content[0].text);
  const parsed = JSON.parse(ok.content[0].text);
  assert.equal(parsed.crowding.condition, "crowded_long_downside_unwind_proxy");
  assert.equal(parsed.currencyBias.proxyScope, "direct_base_asset");
  assert.equal(parsed.priceStructure.latestBarAt, bars.at(-1).timeIso);
  assert.equal(parsed.researchContract.candidateEligible, false);
  // The three-year percentile needs the full reference set, not the short public window.
  assert.equal(requestedPeriods, 250);

  // The declared contract is a daily FX chart. Gold and the cross proxies are refused here, not
  // only in the pure function, so the entrance and the implementation agree on the same scope.
  for (const symbol of ["OANDA:XAUUSD", "OANDA:GBPJPY", "OANDA:GBPAUD"]) {
    const refused = await client.callTool({ name: "get_cot_crowding_unwind_context", arguments: {
      expected_symbol: symbol, expected_timeframe: "1D" } });
    assert.equal(refused.isError, true, symbol);
  }
  const intraday = await client.callTool({ name: "get_cot_crowding_unwind_context", arguments: {
    expected_symbol: "OANDA:EURUSD", expected_timeframe: "240" } });
  assert.equal(intraday.isError, true);
});

test("the price-action study pages the chart back before measuring, and says so when it cannot", async () => {
  // A chart hands over a few hundred bars until it is paged. Reading it once would answer a
  // five-thousand-bar request with a fortnight of history and nothing in the result to reveal it.
  const bar = (index) => ({
    time: 1700000000 + index * 3600,
    timeIso: new Date((1700000000 + index * 3600) * 1000).toISOString(),
    open: 100, high: 100.5, low: 99.5, close: 100, volume: 10,
  });
  let available = 300;
  const pagingDeps = makeDeps({
    tv: {
      getChartContext: async () => ({
        activeChartIndex: 0,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }],
      }),
      getOhlcv: async (count) => ({
        symbol: "OANDA:EURUSD",
        resolution: "60",
        count,
        bars: Array.from({ length: Math.min(count, available) }, (_, index) => bar(index)),
      }),
      loadMoreHistory: async (options) => {
        const before = available;
        available = Math.min(2000, available + options.count);
        return { requested: options.count, barsBefore: before, barsAfter: available, added: available - before, earliestTime: 1, moreAvailable: available < 2000 };
      },
    },
  });
  const client = await connectedClient(pagingDeps);
  const args = { expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", count: 5000 };
  const parsed = JSON.parse((await client.callTool({ name: "run_price_action_pattern_study", arguments: args })).content[0].text);

  // The source ran dry at 2000, so the request is not met and the shortfall is named rather than
  // left to be inferred from a bar count nobody checks.
  assert.equal(parsed.coverage.sufficient, false);
  assert.ok(parsed.coverage.finalBars > 300, `expected paging beyond the first read, got ${parsed.coverage.finalBars}`);
  assert.ok(parsed.qualityIssues.includes(`requested_history_not_loaded:${parsed.coverage.finalBars}_of_5000`));
  assert.equal(parsed.bars.spacingSeconds, 3600);
});

const PA_PINE_ID = "USER;321b4d4f2fca44a0beba0b1e4271d811";
const PA_AUDITED = { "Pin Wick %": 60, "Pin Max Body %": 40, "Pin Max Opposite Wick %": 40,
  "Engulfing Needs Opposite Prior Body": true, "Engulfing Min Prior Body %": 0, "Sweep Lookback": 20,
  "Confirm On Bar Close": true, "Alert On Pin Bar": true, "Alert On Engulfing": true, "Alert On Sweep": true };
function priceActionDeps({ source = PRICE_ACTION_CONTEXT_SOURCE, version = "1.0", usedVersion = "1.0",
  name = PRICE_ACTION_CONTEXT_NAME, chartIndex = 0, settings = {}, onInputs = () => {} } = {}) {
  return makeDeps({
    tv: {
      getChartContext: async () => ({
        layoutName: "test", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }],
      }),
      listPineScripts: async () => [{
        pineId: PA_PINE_ID, name, kind: "study", version,
        usedBy: [{ chartIndex, studyId: "pa", name, version: usedVersion }],
      }],
      getPineSource: async () => ({ pineId: PA_PINE_ID, version, source }),
      getIndicatorInputs: async () => {
        onInputs();
        return [{
          id: "pa", name: PRICE_ACTION_CONTEXT_NAME, title: PRICE_ACTION_CONTEXT_NAME,
          inputs: PRICE_ACTION_CONTEXT_INPUTS.map((input) => ({
            ...input, type: "integer", defval: null, tooltip: null,
            value: { ...PA_AUDITED, ...settings }[input.name],
          })),
        }];
      },
      getIndicatorValues: async (options) => {
        assert.deepEqual(options.plotTitles, [...PRICE_ACTION_CONTEXT_PLOTS]);
        return [{
          id: "pa", name: PRICE_ACTION_CONTEXT_NAME, options, plots: [],
          bars: [{ time: 1, values: {
            "Pin Bar": 1, "Engulfing": 0, "Sweep": 0,
            "Sweep High Level": 1.16, "Sweep Low Level": 1.15,
            "Upper Wick %": 10, "Lower Wick %": 70, "Body %": 20, "Bar Confirmed": 1,
          } }],
        }];
      },
    },
  });
}
const readPriceAction = (client, args = {}) => client.callTool({
  name: "get_price_action_context",
  arguments: { pine_id: PA_PINE_ID, study_id: "pa", expected_symbol: "OANDA:EURUSD", expected_timeframe: "60", ...args },
});

test("get_price_action_context_template returns the fixed audited Pine source", async () => {
  const client = await connectedClient(makeDeps());
  const template = JSON.parse((await client.callTool({ name: "get_price_action_context_template", arguments: {} })).content[0].text);
  // Byte-identical, because get_price_action_context refuses any study whose source differs from
  // this constant - a template that drifts by one character rejects every study saved from it.
  assert.equal(template.source, PRICE_ACTION_CONTEXT_SOURCE);
  assert.equal(template.name, PRICE_ACTION_CONTEXT_NAME);
  assert.deepEqual(template.alertConditions.length, 6);
});

test("get_price_action_context reads the placed audited template and reports the settings in force", async () => {
  const client = await connectedClient(priceActionDeps());
  const context = JSON.parse((await readPriceAction(client)).content[0].text);
  assert.equal(context.status, "ready");
  assert.equal(context.pinBar, 1);
  assert.equal(context.barConfirmed, true);
  assert.equal(context.settings["Pin Wick %"], 60);
  assert.deepEqual(context.qualityIssues, []);
  assert.equal(context.symbol, "OANDA:EURUSD");
  assert.equal(context.timeframe, "60");
});

test("get_price_action_context refuses a same-named Pine script whose source was changed", async () => {
  let inputsRead = false;
  const client = await connectedClient(priceActionDeps({
    source: "//@version=6\nplot(close)", onInputs: () => { inputsRead = true; },
  }));
  const res = await readPriceAction(client);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /does not match the audited price-action template/);
  // The refusal has to come before anything is read off the chart.
  assert.equal(inputsRead, false);
});

test("get_price_action_context refuses another script, a stale version and a study on another chart", async () => {
  const wrongName = await readPriceAction(await connectedClient(priceActionDeps({ name: "Something Else" })));
  assert.equal(wrongName.isError, true);
  assert.match(wrongName.content[0].text, /is not the Bushido Price Action Context study/);

  const stale = await readPriceAction(await connectedClient(priceActionDeps({ version: "2.0", usedVersion: "1.0" })));
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /is not the latest saved/);

  const otherChart = await readPriceAction(await connectedClient(priceActionDeps({ chartIndex: 3 })));
  assert.equal(otherChart.isError, true);
  assert.match(otherChart.content[0].text, /is not an on-chart instance/);
});

test("get_price_action_context refuses a study whose settings change what a signal means", async () => {
  const off = await readPriceAction(await connectedClient(priceActionDeps({ settings: { "Confirm On Bar Close": false } })));
  assert.equal(off.isError, true);
  assert.match(off.content[0].text, /Confirm On Bar Close switched off/);

  const loosened = JSON.parse((await readPriceAction(await connectedClient(priceActionDeps({ settings: { "Pin Wick %": 35 } })))).content[0].text);
  assert.equal(loosened.settings["Pin Wick %"], 35);
  assert.ok(loosened.qualityIssues.some((issue) => issue.startsWith("settings_differ_from_audited_defaults:")));
});

test("get_price_action_context and the pattern study refuse a chart that is not the one asked for", async () => {
  const wrongSymbol = await readPriceAction(await connectedClient(priceActionDeps()), { expected_symbol: "OANDA:USDJPY" });
  assert.equal(wrongSymbol.isError, true);
  assert.match(wrongSymbol.content[0].text, /symbol/i);

  const wrongTimeframe = await readPriceAction(await connectedClient(priceActionDeps()), { expected_timeframe: "15" });
  assert.equal(wrongTimeframe.isError, true);
  assert.match(wrongTimeframe.content[0].text, /timeframe/i);

  const study = await (await connectedClient(priceActionDeps())).callTool({
    name: "run_price_action_pattern_study",
    arguments: { expected_symbol: "OANDA:USDJPY", expected_timeframe: "60", count: 500 },
  });
  assert.equal(study.isError, true);
  assert.match(study.content[0].text, /symbol/i);
});

test("the version clients are told is the one the package ships", async () => {
  // It was written out by hand, so 0.1.1 packed and installed while every
  // handshake still announced 0.1.0. Reading the manifest is what keeps a
  // release and what it says about itself from drifting apart again.
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const source = await readFile(new URL("../../build/server.js", import.meta.url), "utf8");
  assert.ok(!/version:\s*"\d+\.\d+\.\d+"/.test(source),
    "server.js must not carry a literal version string");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);

  const client = await connectedClient(makeDeps());
  assert.equal(client.getServerVersion().version, manifest.version);
});

// compare_forecast_losses (docs/FORECAST_LOSS_COMPARISON_PLAN.md, step 6). Synthetic sets only: an MSE
// scalar set whose daily d = loss(A) − loss(B) is chosen directly (a = p + √(1 + d), b = p + 1).
const forecastDay = (i) => new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
function forecastSetInput({ days = 400, d = (i) => -0.05 + 0.02 * Math.sin(i * 1.3), series = ['fx:EURUSD'], secondary = true,
  labels, source = 'synthetic-forecasts', start = 0 } = {}) {
  const idx = Array.from({ length: days }, (_, i) => start + i);
  const p = idx.map((i) => 1 + ((i * 7919) % 13) / 10);
  return {
    schema_version: '1.0', source_id: source, source_sha256: 'sha256:' + 'a'.repeat(64), evidence_tier: 'synthetic_test',
    horizon: 1, n: 1, underlying_series_ids: series, dates: idx.map(forecastDay),
    windows: idx.map((i) => ({ from: `${forecastDay(i)}T00:00:00.000Z`, to: `${forecastDay(i)}T23:00:00.000Z` })),
    a: p.map((x, i) => x + Math.sqrt(1 + d(idx[i]))), b: p.map((x) => x + 1), primary: p,
    ...(secondary ? { secondary: idx.map((i) => 0.8 + ((i * 104729) % 17) / 12) } : {}),
    ...(labels ? { labels: idx.map(labels) } : {}),
  };
}
async function forecastStores(t) {
  const { ForecastSetStore } = await import('../../build/forecastSet.js');
  const { ForecastLossJournalStore } = await import('../../build/forecastLossJournal.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { rm } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'forecast-loss-tool-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = { sets: join(dir, 'sets'), usage: join(dir, 'usage.jsonl'), journal: join(dir, 'journal.jsonl') };
  return { dir, paths, forecastSets: new ForecastSetStore(paths.sets), researchPeriodUsage: new ResearchPeriodUsageStore(paths.usage),
    forecastLossJournal: new ForecastLossJournalStore(paths.journal) };
}
const jsonLines = async (path) => {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
async function forecastClient(t, deps) {
  const client = await connectedClient(makeDeps(deps));
  t.after(() => client.close());
  const raw = (args) => client.callTool({ name: 'compare_forecast_losses', arguments: args });
  const call = async (args) => {
    const response = await raw(args);
    assert.ok(!response.isError, response.content[0].text);
    return JSON.parse(response.content[0].text);
  };
  return { raw, call };
}

test('compare_forecast_losses records period usage, then the journal, then responds in the design order', async (t) => {
  const stores = await forecastStores(t);
  const order = [];
  const { artifact_id } = await stores.forecastSets.register(forecastSetInput({ series: ['fx:EURUSD', 'fx:USDJPY'].slice(0, 1) }));
  const { call } = await forecastClient(t, { forecastSets: stores.forecastSets,
    researchPeriodUsage: { recordToolAccessBatch: async (tool, inputs) => { order.push('period'); return stores.researchPeriodUsage.recordToolAccessBatch(tool, inputs); } },
    forecastLossJournal: { record: async (exposure) => { order.push('journal'); return stores.forecastLossJournal.record(exposure); } } });
  const r = await call({ artifact_id, loss: 'mse', research_id: 'study:forecast', usage_access_id: 'forecast-run-1' });
  assert.deepEqual(order, ['period', 'journal']);
  // The design's field order, statistics included (code review L3).
  assert.deepEqual(Object.keys(r), ['contract', 'status', 'battery_outcome', 'robustness_conflicts',
    'non_decisive_disagreements', 'withheld_reasons', 'withheld_reasons_scope', 'search', 'period_usage', 'input',
    'artifact_id', 'loss', 'd_unit_log2', 'dm', 'mean_favours', 'mean_favours_test', 'drops', 'hard_days', 'sub_periods', 'trimmed',
    'breakdown', 'secondary', 'bootstrap', 'caller_label_means', 'candidateEligible', 'statistical_calibration', 'limitations']);
  assert.equal(r.battery_outcome, 'no_listed_conflict');
  assert.equal(r.mean_favours, 'A');
  assert.equal(r.candidateEligible, false);
  assert.equal(r.statistical_calibration, 'not_assessed');
  assert.equal(r.input, 'artifact');
  assert.ok(!r.limitations.includes('inline_input_not_stored_hash_not_reverifiable'));
  // Period usage: index 0 is the set source, then the series; one scope, bound to this tool.
  const usage = await jsonLines(stores.paths.usage);
  assert.deepEqual(usage.map((row) => [row.access_id, row.tool_name, row.scope, row.data_version, row.from, row.to]), [
    ['forecast-run-1:0', 'compare_forecast_losses', 'forecast_evaluation_window_only', artifact_id, '2020-01-01T00:00:00.000Z', '2021-02-03T23:00:00.000Z'],
    ['forecast-run-1:1', 'compare_forecast_losses', 'forecast_evaluation_window_only', artifact_id, '2020-01-01T00:00:00.000Z', '2021-02-03T23:00:00.000Z'],
  ]);
  const { createHash } = await import('node:crypto');
  const sha = (value) => 'sha256:' + createHash('sha256').update(value).digest('hex');
  assert.deepEqual(usage.map((row) => row.series_id), [`forecast-set-source:${sha('synthetic-forecasts').slice(7)}`, 'fx:EURUSD']);
  assert.equal(usage[0].request_sha256, sha(JSON.stringify({ artifact: artifact_id, contract: 'forecast_loss_comparison_v1', loss: 'mse' })));
  assert.deepEqual(r.period_usage.records.map((row) => row.idempotent), [false, false]);
  const journal = await jsonLines(stores.paths.journal);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].battery_outcome, 'no_listed_conflict');
  // The journal and the period record join on the same source digest (code review L5).
  assert.equal(journal[0].source_hash, 'sha256:' + usage[0].series_id.slice('forecast-set-source:'.length));
  assert.equal(r.search.status, 'tracked');
  assert.equal(r.search.this_research_id.calls, 1);
  assert.deepEqual(r.search.period_usage_prior_overlap.per_series.map((row) => row.overlapping_records), [0, 0]);
  assert.ok(!JSON.stringify(r.search).includes('"matches"'), 'the prior overlap is summarized, never listed');
});

test('compare_forecast_losses: untracked calls write nothing and cap the outcome', async (t) => {
  const stores = await forecastStores(t);
  const { artifact_id } = await stores.forecastSets.register(forecastSetInput());
  const { call, raw } = await forecastClient(t, { forecastSets: stores.forecastSets });   // throwing period and journal defaults
  const r = await call({ artifact_id, loss: 'mse' });
  assert.equal(r.battery_outcome, 'no_listed_conflict_untracked');
  assert.deepEqual(r.withheld_reasons, ['no_listed_conflict_untracked']);
  assert.equal(r.search.status, 'untracked');
  assert.equal(r.period_usage.status, 'untracked');
  // A misspelled argument fails instead of running silently untracked (code review L9).
  const typo = await raw({ artifact_id, loss: 'mse', researchid: 'r' });
  assert.equal(typo.isError, true);
  const orphan = await raw({ artifact_id, loss: 'mse', usage_access_id: 'x' });
  assert.equal(orphan.isError, true);
  assert.match(orphan.content[0].text, /usage_access_id requires research_id/);
});

test('compare_forecast_losses: a failure in either write returns no statistics', async (t) => {
  const stores = await forecastStores(t);
  const { artifact_id } = await stores.forecastSets.register(forecastSetInput());
  let journalCalls = 0;
  const periodDown = await forecastClient(t, { forecastSets: stores.forecastSets,
    researchPeriodUsage: { recordToolAccessBatch: async () => { throw new Error('period store unavailable'); } },
    forecastLossJournal: { record: async () => { journalCalls++; return {}; } } });
  const first = await periodDown.raw({ artifact_id, loss: 'mse', research_id: 'r' });
  assert.equal(first.isError, true);
  assert.match(first.content[0].text, /period store unavailable/);
  assert.doesNotMatch(first.content[0].text, /dbar|battery_outcome/);
  assert.equal(journalCalls, 0, 'the journal is never written without the period records');
  const journalDown = await forecastClient(t, { forecastSets: stores.forecastSets, researchPeriodUsage: stores.researchPeriodUsage,
    forecastLossJournal: { record: async () => { throw new Error('journal unavailable'); } } });
  const second = await journalDown.raw({ artifact_id, loss: 'mse', research_id: 'r', usage_access_id: 'half' });
  assert.equal(second.isError, true);
  assert.match(second.content[0].text, /after period usage was recorded as half:0-1; no statistics returned: journal unavailable/);
  assert.doesNotMatch(second.content[0].text, /dbar|battery_outcome/);
  assert.equal((await jsonLines(stores.paths.usage)).length, 2, 'the period records stay, as the error says');
});

test('compare_forecast_losses: usage_access_id derivation, its limit, retries and conflicts', async (t) => {
  const stores = await forecastStores(t);
  const { artifact_id } = await stores.forecastSets.register(forecastSetInput());
  const { call, raw } = await forecastClient(t, stores);
  const a = await call({ artifact_id, loss: 'mse', research_id: 'r' });
  const b = await call({ artifact_id, loss: 'mse', research_id: 'r' });
  assert.match(a.period_usage.access_id_base, /^forecast-access:[a-f0-9-]{36}$/);
  assert.notEqual(a.period_usage.access_id_base, b.period_usage.access_id_base);
  assert.deepEqual(a.period_usage.records.map((row) => row.access_id), [0, 1].map((i) => `${a.period_usage.access_id_base}:${i}`));
  const longest = 'x'.repeat(100);
  const first = await call({ artifact_id, loss: 'mse', research_id: 'r', usage_access_id: longest });
  const retry = await call({ artifact_id, loss: 'mse', research_id: 'r', usage_access_id: longest });
  assert.deepEqual(retry.period_usage.records.map((row) => row.idempotent), [true, true]);
  assert.deepEqual(retry.period_usage.records.map((row) => row.access_id), first.period_usage.records.map((row) => row.access_id));
  assert.equal(retry.search.this_research_id.calls, 4, 'retries still count as calls');
  assert.equal((await jsonLines(stores.paths.usage)).length, 6);
  const tooLong = await raw({ artifact_id, loss: 'mse', research_id: 'r', usage_access_id: 'x'.repeat(101) });
  assert.equal(tooLong.isError, true);
  // The loss is in request_sha256, so reusing the ID for another loss conflicts instead of passing as a retry.
  const otherLoss = await raw({ artifact_id, loss: 'qlike', research_id: 'r', usage_access_id: longest });
  assert.equal(otherLoss.isError, true);
  assert.match(otherLoss.content[0].text, /conflicts with its original input/);
  // Access IDs share one namespace across tools: a ledger record at base:0 makes the base collide.
  await stores.researchPeriodUsage.recordToolAccess({ access_id: 'shared:0', research_id: 'r', series_id: 'ledger-source:abc',
    data_version: 'sha256:' + 'b'.repeat(64), from: '2020-01-01T00:00:00.000Z', to: '2020-02-01T00:00:00.000Z',
    purpose: 'exploration', request_sha256: 'sha256:' + 'c'.repeat(64) });
  const collided = await raw({ artifact_id, loss: 'mse', research_id: 'r', usage_access_id: 'shared' });
  assert.equal(collided.isError, true);
  assert.equal((await jsonLines(stores.paths.journal)).length, 4, 'failed calls add no journal entry');
  assert.equal((await jsonLines(stores.paths.usage)).length, 7);
});

test('compare_forecast_losses: the inline path, input selection and an artifact hash mismatch', async (t) => {
  const stores = await forecastStores(t);
  const { normalizeForecastSet } = await import('../../build/forecastSet.js');
  const { call, raw } = await forecastClient(t, stores);
  const input = forecastSetInput();
  const inline = await call({ inline_set: input, loss: 'mse', research_id: 'inline' });
  assert.equal(inline.input, 'inline');
  assert.equal(inline.artifact_id, normalizeForecastSet(input).artifact_id);
  assert.ok(inline.limitations.includes('inline_input_not_stored_hash_not_reverifiable'));
  const { artifact_id } = await stores.forecastSets.register(input);
  assert.equal(artifact_id, inline.artifact_id, 'the same content hashes the same on either path');
  const stored = await call({ artifact_id, loss: 'mse', research_id: 'inline' });
  assert.equal(stored.dm.DM, inline.dm.DM);
  for (const args of [{ loss: 'mse' }, { artifact_id, inline_set: input, loss: 'mse' }]) {
    const r = await raw(args);
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /exactly one of artifact_id and inline_set/);
  }
  const tooMany = await raw({ inline_set: forecastSetInput({ days: 2001 }), loss: 'mse' });
  assert.equal(tooMany.isError, true);
  assert.match(tooMany.content[0].text, /at most 2000 dates/);
  const matrix = { ...forecastSetInput({ days: 1, secondary: false }), n: 2, underlying_series_ids: ['fx:EURUSD', 'fx:USDJPY'],
    a: [[[2, 0], [0, 2]]], b: [[[1, 0], [0, 1]]], primary: [[[1, 0], [0, 1]]] };
  const matrixInline = await raw({ inline_set: matrix, loss: 'mse' });
  assert.equal(matrixInline.isError, true);
  assert.match(matrixInline.content[0].text, /inline sets must be scalar/);
  // A stored file whose content no longer hashes to its name fails closed before anything is written.
  const before = { usage: (await jsonLines(stores.paths.usage)).length, journal: (await jsonLines(stores.paths.journal)).length };
  const { artifact_id: other } = await stores.forecastSets.register(forecastSetInput({ source: 'other-source' }));
  const { chmod } = await import('node:fs/promises');
  const otherPath = join(stores.paths.sets, `${other.slice(7)}.json`);
  await chmod(otherPath, 0o600);
  await writeFile(otherPath, JSON.stringify(normalizeForecastSet(input).set));
  const mismatch = await raw({ artifact_id: other, loss: 'mse', research_id: 'inline' });
  assert.equal(mismatch.isError, true);
  assert.match(mismatch.content[0].text, /artifact hash mismatch/);
  assert.deepEqual({ usage: (await jsonLines(stores.paths.usage)).length, journal: (await jsonLines(stores.paths.journal)).length }, before);
});

test('compare_forecast_losses: not_evaluable results are still recorded', async (t) => {
  const stores = await forecastStores(t);
  const { artifact_id } = await stores.forecastSets.register(forecastSetInput({ days: 60 }));
  const { call } = await forecastClient(t, stores);
  const r = await call({ artifact_id, loss: 'qlike', research_id: 'short' });
  assert.equal(r.battery_outcome, 'not_evaluable');
  assert.equal(r.status.reason, 'fewer_than_100_used_days');
  assert.equal((await jsonLines(stores.paths.journal))[0].battery_outcome, 'not_evaluable');
  assert.equal((await jsonLines(stores.paths.usage)).length, 2);
});

test('compare_forecast_losses: 5,000 dates, 50 maximum-length labels and a saturated research-ID union stay under 64 KiB', async (t) => {
  const stores = await forecastStores(t);
  const labels = Array.from({ length: 50 }, (_, i) => `${String(i).padStart(2, '0')}`.padEnd(64, 'L'));
  const { artifact_id } = await stores.forecastSets.register(forecastSetInput({ days: 5000, labels: (i) => labels[i % 50] }));
  const researchId = (i) => `${String(i).padStart(4, '0')}`.padEnd(120, 'r');
  let offset = 0;
  const { raw } = await forecastClient(t, { forecastSets: stores.forecastSets, forecastLossJournal: stores.forecastLossJournal,
    researchPeriodUsage: { recordToolAccessBatch: async (tool, inputs) => inputs.map((input) => ({
      ...input, source: 'tool_observed', tool_name: tool, idempotent: false,
      prior_overlap: { status: 'recorded_overlap', overlapping_records: 5000, exploration_records: 5000, validation_records: 0,
        truncated: true, limitations: ['prior_and_external_usage_may_be_missing'],
        matches: Array.from({ length: 100 }, () => ({ research_id: researchId(offset++) })) },
    })) } });
  const response = await raw({ artifact_id, loss: 'mse', research_id: researchId(9999), usage_access_id: 'u'.repeat(100) });
  assert.ok(!response.isError, response.content[0].text);
  const r = JSON.parse(response.content[0].text);
  assert.equal(r.caller_label_means.length, 50);
  assert.equal(r.search.period_usage_prior_overlap.overlapping_research_ids.length, 100);
  assert.equal(r.search.period_usage_prior_overlap.overlapping_research_ids_seen, 200);
  assert.equal(r.search.period_usage_prior_overlap.overlapping_research_ids_truncated, true);
  const bytes = Buffer.byteLength(response.content[0].text, 'utf8');
  assert.ok(bytes < 64 * 1024, `${bytes} bytes`);
  t.diagnostic(`response ${bytes} bytes`);
});

// compute_realized_covariance (docs/REALIZED_COVARIANCE_PLAN.md, step 6). Synthetic bars only: the reference fixture's
// bar sets, and generated bars for the size bound.
let rcReferenceCache;
async function rcReference() {
  rcReferenceCache ??= JSON.parse(await readFile(new URL('../fixtures/realized-covariance/reference.json', import.meta.url), 'utf8'));
  return rcReferenceCache;
}
async function rcStores(t) {
  const { BarSeriesStore } = await import('../../build/barSeries.js');
  const { ProxySetStore } = await import('../../build/proxySet.js');
  const { RealizedCovarianceJournalStore } = await import('../../build/realizedCovarianceJournal.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { rm } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'realized-covariance-tool-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = { bars: join(dir, 'bars'), proxy: join(dir, 'proxy'), usage: join(dir, 'usage.jsonl'), journal: join(dir, 'journal.jsonl') };
  return { dir, paths, barSeries: new BarSeriesStore(paths.bars), proxySets: new ProxySetStore(paths.proxy),
    researchPeriodUsage: new ResearchPeriodUsageStore(paths.usage), realizedCovarianceJournal: new RealizedCovarianceJournalStore(paths.journal) };
}
const rcBarInput = (s, interval, source = 'reference') => ({ schema_version: '1.0', source_id: source, source_sha256: 'sha256:' + 'a'.repeat(64),
  evidence_tier: 'synthetic_test', series_id: s.series_id, interval_minutes: interval, open_time: s.open_time, close: s.close });
async function rcScenario(stores, name, { source } = {}) {
  const ref = await rcReference();
  const scenario = ref.scenarios.find((s) => s.name === name);
  const series = [];
  for (const s of ref.bar_sets[scenario.bars]) {
    series.push((await stores.barSeries.register(rcBarInput(s, scenario.rules.interval_minutes, source))).artifact_id);
  }
  return { series, rules: scenario.rules, from_date: scenario.from_date, to_date: scenario.to_date };
}
/** The same computation run directly, for comparing the tool's summary and proxy-set ID. */
async function rcDirect(stores, args, resolver) {
  const { computeRealizedCovariance } = await import('../../build/realizedCovariance.js');
  const { canonicalizeRules } = await import('../../build/realizedCovarianceRules.js');
  const { normalizeProxySet } = await import('../../build/proxySet.js');
  const { rules, rules_sha256 } = canonicalizeRules(args.rules);
  const series = [];
  for (const artifact_id of args.series) series.push({ artifact_id, bars: await stores.barSeries.get(artifact_id) });
  const result = computeRealizedCovariance({ rules, rules_sha256, from_date: args.from_date, to_date: args.to_date, series, resolver });
  return { ...result, proxy_set_id: normalizeProxySet(result.proxy).artifact_id };
}
async function rcClient(t, deps) {
  const client = await connectedClient(makeDeps(deps));
  t.after(() => client.close());
  const raw = (args) => client.callTool({ name: 'compute_realized_covariance', arguments: args });
  const call = async (args) => {
    const response = await raw(args);
    assert.ok(!response.isError, response.content[0].text);
    return JSON.parse(response.content[0].text);
  };
  return { raw, call };
}
const rcStoreDeps = (stores) => ({ barSeries: stores.barSeries, proxySets: stores.proxySets,
  researchPeriodUsage: stores.researchPeriodUsage, realizedCovarianceJournal: stores.realizedCovarianceJournal });
const rcSha = async (value) => 'sha256:' + (await import('node:crypto')).createHash('sha256').update(value).digest('hex');

test('compute_realized_covariance records period usage, then the journal, then the proxy set, then responds', async (t) => {
  const stores = await rcStores(t);
  const args = await rcScenario(stores, 'A_100_shaped');
  const order = [];
  const { call } = await rcClient(t, { barSeries: stores.barSeries,
    researchPeriodUsage: { recordToolAccessBatch: async (tool, inputs) => { order.push('period'); return stores.researchPeriodUsage.recordToolAccessBatch(tool, inputs); } },
    realizedCovarianceJournal: { record: async (exposure) => { order.push('journal'); return stores.realizedCovarianceJournal.record(exposure); } },
    proxySets: { register: async (set) => { order.push('store'); return stores.proxySets.register(set); } } });
  const r = await call({ ...args, research_id: 'study:rc', usage_access_id: 'rc-run-1' });
  assert.deepEqual(order, ['period', 'journal', 'store']);
  assert.deepEqual(Object.keys(r), ['proxy_set_id', 'algorithm_version', 'rules_sha256', 'rules', 'tzdata', 'from_date', 'to_date',
    'envelope', 'produced_days', 'kept_days', 'dropped', 'kept_by_weekday', 'missing_slots', 'diagnostics', 'search', 'period_usage',
    'limitations']);
  const direct = await rcDirect(stores, args);
  assert.equal(r.proxy_set_id, direct.proxy_set_id);
  assert.equal(r.algorithm_version, 'realized_covariance_v1');
  assert.equal(r.tzdata, direct.tzdata);
  assert.deepEqual(r.envelope, { from: '2026-01-05T21:30:00.000Z', to: '2026-01-30T21:45:00.000Z' },
    'from the open of the previous endpoint bar to the last endpoint');
  assert.deepEqual({ produced_days: r.produced_days, kept_days: r.kept_days, dropped: r.dropped, kept_by_weekday: r.kept_by_weekday,
    missing_slots: r.missing_slots }, direct.summary);
  assert.deepEqual(r.diagnostics, { series: direct.diagnostics, identical_close_pairs: [] });
  assert.deepEqual(r.limitations, direct.limitations);
  assert.ok(r.limitations.includes('first_interval_spans_non_slot_bars'));
  // Never per-day arrays ("dates" appears only as a per-weekday count in the diagnostics).
  assert.ok(!('dates' in r));
  for (const key of ['windows', 'rc', 'daily_outer', 'drop_cause', 'common_slots', 'expected_slots']) {
    assert.ok(!JSON.stringify(r).includes(`"${key}"`), key);
  }
  // Period usage: index 0 is the proxy-set source, then the bar series in axis order, over the span read.
  const usage = await jsonLines(stores.paths.usage);
  assert.deepEqual(usage.map((row) => [row.access_id, row.tool_name, row.scope, row.series_id, row.data_version, row.from, row.to, row.purpose]), [
    ['rc-run-1:0', 'compute_realized_covariance', 'realized_covariance_bar_window_only', `proxy-set-source:${r.proxy_set_id.slice(7)}`, r.proxy_set_id, r.envelope.from, r.envelope.to, 'exploration'],
    ['rc-run-1:1', 'compute_realized_covariance', 'realized_covariance_bar_window_only', 'fx:EURUSD', args.series[0], r.envelope.from, r.envelope.to, 'exploration'],
    ['rc-run-1:2', 'compute_realized_covariance', 'realized_covariance_bar_window_only', 'fx:USDJPY', args.series[1], r.envelope.from, r.envelope.to, 'exploration'],
  ]);
  assert.ok(usage.every((row) => row.request_sha256 === usage[0].request_sha256));
  assert.equal(usage[0].request_sha256, await rcSha(JSON.stringify({ contract: 'realized_covariance_v1', bar_series: args.series,
    rules_sha256: r.rules_sha256, from_date: args.from_date, to_date: args.to_date })));
  assert.deepEqual(r.period_usage.records.map((row) => [row.access_id, row.idempotent]), [0, 1, 2].map((i) => [`rc-run-1:${i}`, false]));
  // The journal: one record naming the stored proxy set, which then verifies.
  const journal = await jsonLines(stores.paths.journal);
  assert.equal(journal.length, 1);
  assert.deepEqual([journal[0].proxy_set_id, journal[0].research_id, journal[0].tzdata, journal[0].kept_days, journal[0].dropped_days],
    [r.proxy_set_id, 'study:rc', r.tzdata, r.kept_days, r.produced_days - r.kept_days]);
  assert.deepEqual(journal[0].envelope, r.envelope);
  const { verifyProxySet } = await import('../../build/proxySet.js');
  const stored = await verifyProxySet(r.proxy_set_id, { proxySets: stores.proxySets, journal: stores.realizedCovarianceJournal });
  assert.equal(JSON.stringify(stored), JSON.stringify(direct.proxy));
  assert.deepEqual([r.search.calls, r.search.distinct_rules, r.search.distinct_bar_series_versions], [1, 1, 1]);
  assert.deepEqual(r.search.period_usage_prior_overlap.per_series.map((row) => row.overlapping_records), [0, 0, 0]);
  assert.ok(r.search.limitations.includes('retries_increment_call_counts'));
  assert.ok(!JSON.stringify(r.search).includes('"matches"'), 'the prior overlap is summarized, never listed');
  // The request hash keeps the axis order: the same bars in the other order are another request.
  const reversed = [...args.series].reverse();
  await call({ ...args, series: reversed, research_id: 'study:rc', usage_access_id: 'rc-run-2' });
  const second = (await jsonLines(stores.paths.usage)).filter((row) => row.access_id.startsWith('rc-run-2:'));
  assert.deepEqual(second.map((row) => row.series_id.slice(0, 9)), ['proxy-set', 'fx:USDJPY', 'fx:EURUSD']);
  assert.equal(second[0].request_sha256, await rcSha(JSON.stringify({ contract: 'realized_covariance_v1', bar_series: reversed,
    rules_sha256: r.rules_sha256, from_date: args.from_date, to_date: args.to_date })));
});

test('compute_realized_covariance: untracked calls are still journaled and stored, with no period write', async (t) => {
  const stores = await rcStores(t);
  const args = await rcScenario(stores, 'B_within_day_log');
  // makeDeps keeps its throwing period stub.
  const { call, raw } = await rcClient(t, { barSeries: stores.barSeries, proxySets: stores.proxySets,
    realizedCovarianceJournal: stores.realizedCovarianceJournal });
  // Rules in another key order with unsorted weekdays are canonicalized before anything is used or written.
  const { canonicalizeRules } = await import('../../build/realizedCovarianceRules.js');
  const canonical = canonicalizeRules(args.rules);
  const shuffled = Object.fromEntries(Object.entries({ ...args.rules, day_weekdays: [5, 3, 1, 4, 2] }).reverse());
  const r = await call({ ...args, rules: shuffled });
  assert.equal(JSON.stringify(r.rules), JSON.stringify(canonical.rules));
  assert.equal(r.rules_sha256, canonical.rules_sha256);
  assert.equal(JSON.stringify((await jsonLines(stores.paths.journal))[0].rules), JSON.stringify(canonical.rules));
  assert.equal(r.period_usage.status, 'untracked');
  assert.ok(r.period_usage.limitations.includes('period_usage_checks_do_not_read_the_computation_journal'));
  assert.ok(!('period_usage_prior_overlap' in r.search));
  assert.deepEqual([r.search.calls, r.search.distinct_rules], [1, 1]);
  const journal = await jsonLines(stores.paths.journal);
  assert.deepEqual([journal.length, journal[0].research_id, journal[0].proxy_set_id], [1, null, r.proxy_set_id]);
  await stores.proxySets.get(r.proxy_set_id);
  // within_day reads from s(first): Monday's endpoint, with no endpoint bar before it, and has no first-interval limitation.
  assert.deepEqual(r.envelope, { from: '2026-01-05T21:45:00.000Z', to: '2026-01-30T21:45:00.000Z' });
  assert.ok(!r.limitations.includes('first_interval_spans_non_slot_bars'));
  // A misspelled argument fails instead of running silently untracked; usage_access_id needs research_id.
  const typo = await raw({ ...args, researchid: 'r' });
  assert.equal(typo.isError, true);
  const orphan = await raw({ ...args, usage_access_id: 'x' });
  assert.equal(orphan.isError, true);
  assert.match(orphan.content[0].text, /usage_access_id requires research_id/);
  assert.equal((await jsonLines(stores.paths.journal)).length, 1);
});

test('compute_realized_covariance: search counts rule variants and bar versions across research IDs and untracked calls', async (t) => {
  const stores = await rcStores(t);
  const a = await rcScenario(stores, 'A_100_shaped');
  const b = await rcScenario(stores, 'B_within_day_log');
  const { call } = await rcClient(t, rcStoreDeps(stores));
  const first = await call({ ...a, research_id: 'r1' });
  assert.deepEqual([first.search.calls, first.search.distinct_rules, first.search.distinct_bar_series_versions], [1, 1, 1]);
  const second = await call(b);
  assert.deepEqual([second.search.calls, second.search.distinct_rules, second.search.distinct_bar_series_versions], [2, 2, 1]);
  // EURUSD re-imported with other cleaning is another bar-series version of the same series_id.
  const ref = await rcReference();
  const reimported = (await stores.barSeries.register(rcBarInput(ref.bar_sets.A_100_shaped[0], 15, 'recleaned'))).artifact_id;
  const third = await call({ ...a, series: [reimported, a.series[1]], research_id: 'r2' });
  assert.deepEqual([third.search.calls, third.search.distinct_rules, third.search.distinct_bar_series_versions], [3, 2, 2]);
  assert.notEqual(third.proxy_set_id, first.proxy_set_id);
  // The period records carry the bar artifact actually read.
  const usage = await jsonLines(stores.paths.usage);
  assert.deepEqual(usage.filter((row) => row.research_id === 'r2').map((row) => row.data_version), [third.proxy_set_id, reimported, a.series[1]]);
  // A series outside the overlap set is not counted.
  const c = await rcScenario(stores, 'C_utc_midnight');
  const other = await call(c);
  assert.deepEqual([other.search.calls, other.search.distinct_rules, other.search.distinct_bar_series_versions], [1, 1, 1]);
});

test('compute_realized_covariance: a failure at any write returns no summary and names what was written', async (t) => {
  const stores = await rcStores(t);
  const args = await rcScenario(stores, 'A_100_shaped');
  const noSummary = (response) => {
    assert.equal(response.isError, true);
    assert.doesNotMatch(response.content[0].text, /kept_days|missing_slots|proxy_set_id/);
  };
  let journalCalls = 0, storeCalls = 0;
  const countingJournal = { record: async (exposure) => { journalCalls++; return stores.realizedCovarianceJournal.record(exposure); } };
  const countingStore = { register: async (set) => { storeCalls++; return stores.proxySets.register(set); } };
  // The period write fails: nothing else is written.
  const periodDown = await rcClient(t, { barSeries: stores.barSeries, proxySets: countingStore, realizedCovarianceJournal: countingJournal,
    researchPeriodUsage: { recordToolAccessBatch: async () => { throw new Error('period store unavailable'); } } });
  const first = await periodDown.raw({ ...args, research_id: 'r' });
  noSummary(first);
  assert.match(first.content[0].text, /period store unavailable/);
  assert.deepEqual([journalCalls, storeCalls], [0, 0]);
  // The journal write fails after the period write: the error names the period records, which stay.
  const journalDown = await rcClient(t, { barSeries: stores.barSeries, proxySets: countingStore, researchPeriodUsage: stores.researchPeriodUsage,
    realizedCovarianceJournal: { record: async () => { throw new Error('journal unavailable'); } } });
  const second = await journalDown.raw({ ...args, research_id: 'r', usage_access_id: 'half' });
  noSummary(second);
  assert.match(second.content[0].text, /journal write failed after period usage was recorded as half:0-2; no summary returned: journal unavailable/);
  assert.equal((await jsonLines(stores.paths.usage)).length, 3);
  const untrackedJournal = await journalDown.raw(args);
  noSummary(untrackedJournal);
  assert.match(untrackedJournal.content[0].text, /journal write failed; no summary returned: journal unavailable/);
  assert.equal(storeCalls, 0, 'the proxy set is never stored without its journal record');
  // The store write fails after both: the error names both, and an identical retry completes it.
  const storeDown = await rcClient(t, { barSeries: stores.barSeries, researchPeriodUsage: stores.researchPeriodUsage,
    realizedCovarianceJournal: stores.realizedCovarianceJournal,
    proxySets: { register: async () => { throw new Error('store unavailable'); } } });
  const third = await storeDown.raw({ ...args, research_id: 'r', usage_access_id: 'late' });
  noSummary(third);
  assert.match(third.content[0].text,
    /proxy set store write failed after period usage was recorded as late:0-2 and computation journal record 1 was appended; no summary returned: store unavailable/);
  const untrackedStore = await storeDown.raw(args);
  assert.match(untrackedStore.content[0].text, /proxy set store write failed after computation journal record 2 was appended; no summary/);
  const { call } = await rcClient(t, rcStoreDeps(stores));
  const retry = await call({ ...args, research_id: 'r', usage_access_id: 'late' });
  assert.deepEqual(retry.period_usage.records.map((row) => row.idempotent), [true, true, true]);
  assert.equal(retry.search.calls, 3, 'every journaled attempt counts');
  const { verifyProxySet } = await import('../../build/proxySet.js');
  await verifyProxySet(retry.proxy_set_id, { proxySets: stores.proxySets, journal: stores.realizedCovarianceJournal });
});

test('compute_realized_covariance: access IDs, retries, request conflicts and a journal identity conflict', async (t) => {
  const stores = await rcStores(t);
  const args = await rcScenario(stores, 'A_100_shaped');
  const { call, raw } = await rcClient(t, rcStoreDeps(stores));
  const a = await call({ ...args, research_id: 'r' });
  const b = await call({ ...args, research_id: 'r' });
  assert.match(a.period_usage.access_id_base, /^rc-access:[a-f0-9-]{36}$/);
  assert.notEqual(a.period_usage.access_id_base, b.period_usage.access_id_base);
  const longest = 'x'.repeat(100);
  await call({ ...args, research_id: 'r', usage_access_id: longest });
  const retry = await call({ ...args, research_id: 'r', usage_access_id: longest });
  assert.deepEqual(retry.period_usage.records.map((row) => row.idempotent), [true, true, true]);
  assert.equal(retry.search.calls, 4, 'retries still count as calls');
  const tooLong = await raw({ ...args, research_id: 'r', usage_access_id: 'x'.repeat(101) });
  assert.equal(tooLong.isError, true);
  // Rules and range are in request_sha256, so reusing the ID for another request conflicts instead of passing as a retry.
  const journalBefore = (await jsonLines(stores.paths.journal)).length;
  for (const other of [{ rules: { ...args.rules, max_missing_slots: 5 } }, { to_date: '2026-01-29' }, { series: [...args.series].reverse() }]) {
    const response = await raw({ ...args, ...other, research_id: 'r', usage_access_id: longest });
    assert.equal(response.isError, true, JSON.stringify(other));
    assert.match(response.content[0].text, /conflicts with its original input/);
  }
  assert.equal((await jsonLines(stores.paths.journal)).length, journalBefore, 'a conflicting call adds no journal record');
  // A journal record for the same proxy set with other content fails closed; the set is not stored.
  const variant = { ...args, from_date: '2026-01-07' };
  const direct = await rcDirect(stores, variant);
  await stores.realizedCovarianceJournal.record({ rules: direct.proxy.rules, rules_sha256: direct.proxy.rules_sha256,
    bar_series: direct.proxy.bar_series, underlying_series_ids: direct.proxy.underlying_series_ids, from_date: variant.from_date,
    to_date: variant.to_date, proxy_set_id: direct.proxy_set_id, research_id: null, tzdata: direct.tzdata,
    kept_days: direct.summary.kept_days - 1, dropped_days: direct.summary.produced_days - direct.summary.kept_days + 1, envelope: direct.envelope });
  const conflict = await raw({ ...variant, research_id: 'r', usage_access_id: 'identity' });
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text, /journal write failed after period usage was recorded as identity:0-2; no summary returned: .*metadata mismatch/);
  await assert.rejects(stores.proxySets.get(direct.proxy_set_id), { code: 'ENOENT' });
});

test('compute_realized_covariance: validation errors write nothing', async (t) => {
  const stores = await rcStores(t);
  const args = await rcScenario(stores, 'A_100_shaped');
  const { raw } = await rcClient(t, rcStoreDeps(stores));
  const cases = [
    [{ series: ['sha256:' + 'f'.repeat(64)] }, /^Error: bar_series_not_found: sha256:f{64}$/],
    [{ series: [args.series[0], args.series[0]] }, /duplicate_series/],
    [{ from_date: '2025-12-01' }, /range_outside_series_coverage/],
    [{ from_date: '2026-01-31', to_date: '2026-01-06' }, /invalid_date_range/],
    [{ from_date: '9999-12-27', to_date: '9999-12-31' }, /invalid_date_range/],   // looped forever before (code review C1)
    [{ from_date: '2026-13-01' }, /invalid_date_range/],   // a RangeError before (re-review R1)
    [{ from_date: '2026-01-31', to_date: '2026-02-01' }, /no_produced_days/],
    [{ rules: { ...args.rules, day_weekdays: [1, 1, 2] } }, /invalid_rules/],
    [{ rules: { ...args.rules, time_zone: 'Mars/Olympus_Mons' } }, /unknown_time_zone/],
    [{ rules: { ...args.rules, time_zone: 'america/new_york' } }, /time_zone_case_variant/],
    [{ rules: { ...args.rules, interval_minutes: 30 } }, /interval_mismatch/],
    [{ rules: { ...args.rules, day_end_local: '16:50' } }, /boundary_not_on_grid/],
    [{ rules: { ...args.rules, max_missing_slots: 95 } }, /too_few_slots_for_rule/],
    [{ rules: { ...args.rules, colour: 'blue' } }, /colour|unrecognized/i],
  ];
  for (const [patch, pattern] of cases) {
    const response = await raw({ ...args, ...patch, research_id: 'r' });
    assert.equal(response.isError, true, JSON.stringify(patch));
    assert.match(response.content[0].text, pattern, JSON.stringify(patch));
  }
  const { stat } = await import('node:fs/promises');
  for (const path of [stores.paths.usage, stores.paths.journal, stores.paths.proxy]) {
    await assert.rejects(stat(path), { code: 'ENOENT' }, path);
  }
});

test('compute_realized_covariance: an injected zone resolver reports its tzdata; the same set recurs under it (H2, H6)', async (t) => {
  const stores = await rcStores(t);
  const args = await rcScenario(stores, 'A_100_shaped');
  const { intlZoneResolver } = await import('../../build/zonedTime.js');
  const current = await rcClient(t, rcStoreDeps(stores));
  const shifted = await rcClient(t, { ...rcStoreDeps(stores), zoneResolver: { tzdata: 'test-2099z', formatAt: intlZoneResolver.formatAt } });
  const a = await current.call({ ...args, research_id: 'r' });
  const b = await shifted.call({ ...args, research_id: 'other' });
  assert.equal(b.tzdata, 'test-2099z');
  assert.equal(b.proxy_set_id, a.proxy_set_id, 'tzdata is not part of the content');
  assert.deepEqual((await jsonLines(stores.paths.journal)).map((row) => [row.research_id, row.tzdata]), [['r', a.tzdata], ['other', 'test-2099z']]);
});

test('compute_realized_covariance: 8 series of maximal IDs, every weekday, 28 identical pairs and a saturated union stay under 64 KiB', async (t) => {
  const stores = await rcStores(t);
  // Eight identical 24/7 M15 series: every local weekday has modal times and every pair is identical.
  const start = Date.UTC(2026, 1, 27) / 1000, bars = 19 * 96;
  const open_time = Array.from({ length: bars }, (_, k) => start + k * 900);
  const close = open_time.map((_, k) => 100 * Math.exp(0.001 * Math.sin(k * 0.7)));
  const seriesId = (i) => `${i}`.padEnd(120, 'S');
  const series = [];
  for (let i = 0; i < 8; i++) {
    series.push((await stores.barSeries.register(rcBarInput({ series_id: seriesId(i), open_time, close }, 15))).artifact_id);
  }
  const researchId = (i) => `${String(i).padStart(4, '0')}`.padEnd(120, 'r');
  let offset = 0;
  const { raw } = await rcClient(t, { barSeries: stores.barSeries, proxySets: stores.proxySets,
    realizedCovarianceJournal: stores.realizedCovarianceJournal,
    researchPeriodUsage: { recordToolAccessBatch: async (tool, inputs) => inputs.map((input) => ({
      ...input, source: 'tool_observed', tool_name: tool, idempotent: false,
      prior_overlap: { status: 'recorded_overlap', overlapping_records: 5000, exploration_records: 5000, validation_records: 0,
        truncated: true, limitations: ['prior_and_external_usage_may_be_missing'],
        matches: Array.from({ length: 100 }, () => ({ research_id: researchId(offset++) })) },
    })) } });
  const response = await raw({ series, rules: { interval_minutes: 15, time_zone: 'America/Argentina/ComodRivadavia', day_end_local: '17:00',
    day_weekdays: [1, 2, 3, 4, 5, 6, 7], max_missing_slots: 0, first_interval: 'from_previous_endpoint', return_unit: 'log_percent' },
  from_date: '2026-03-02', to_date: '2026-03-15', research_id: researchId(9999), usage_access_id: 'u'.repeat(100) });
  assert.ok(!response.isError, response.content[0].text);
  const r = JSON.parse(response.content[0].text);
  assert.equal(r.kept_days, 14);
  assert.equal(r.diagnostics.identical_close_pairs.length, 28);
  assert.ok(r.diagnostics.series.every((s) => s.modal_local_times.length === 7));
  assert.equal(r.period_usage.records.length, 9);
  assert.equal(r.search.period_usage_prior_overlap.overlapping_research_ids.length, 100);
  assert.equal(r.search.period_usage_prior_overlap.overlapping_research_ids_seen, 900);
  const bytes = Buffer.byteLength(response.content[0].text, 'utf8');
  assert.ok(bytes < 64 * 1024, `${bytes} bytes`);
  t.diagnostic(`response ${bytes} bytes`);
});

// compare_forecast_losses on proxy-set sources (docs/REALIZED_COVARIANCE_PLAN.md, step 7): the proxy set comes from
// compute_realized_covariance and the forecast set from the --proxy-set join, end to end.
async function joinedForecastSet(t) {
  const stores = await rcStores(t);
  const { ForecastSetStore } = await import('../../build/forecastSet.js');
  const { ForecastLossJournalStore } = await import('../../build/forecastLossJournal.js');
  const { importForecastSet } = await import('../../build/forecastSetCli.js');
  stores.paths.sets = join(stores.dir, 'sets');
  stores.paths.loss = join(stores.dir, 'loss.jsonl');
  stores.forecastSets = new ForecastSetStore(stores.paths.sets);
  stores.forecastLossJournal = new ForecastLossJournalStore(stores.paths.loss);
  const args = await rcScenario(stores, 'A_100_shaped');
  const rc = await rcClient(t, rcStoreDeps(stores));
  const computed = await rc.call(args);
  const proxy = await stores.proxySets.get(computed.proxy_set_id);
  const input = join(stores.dir, 'forecasts.json');
  await writeFile(input, JSON.stringify({ schema_version: '1.0', evidence_tier: 'historical_exploration',
    from_date: proxy.dates[0], to_date: proxy.dates[8],   // 2026-01-06 to 2026-01-16, a sub-range
    a: proxy.dates.slice(0, 9).map((_, i) => [[1e-3 * (1 + (i % 3)), 0], [0, 2e-3]]), b: proxy.dates.slice(0, 9).map(() => [[2e-3, 0], [0, 1e-3]]) }));
  const { artifact_id } = await importForecastSet(['--proxy-set', computed.proxy_set_id, '--input', input, '--confirm-local-import'],
    { store: stores.forecastSets, proxySets: stores.proxySets, journal: stores.realizedCovarianceJournal });
  const deps = { forecastSets: stores.forecastSets, forecastLossJournal: stores.forecastLossJournal, researchPeriodUsage: stores.researchPeriodUsage,
    proxySets: stores.proxySets, realizedCovarianceJournal: stores.realizedCovarianceJournal };
  return { stores, args, rc, computed, proxy, artifact_id, deps };
}

test('compare_forecast_losses verifies a joined proxy set and counts its rule variants and bar versions, tracked and untracked', async (t) => {
  const { stores, args, rc, computed, artifact_id, deps } = await joinedForecastSet(t);
  await rc.call({ ...args, rules: { ...args.rules, max_missing_slots: 5 } });   // a rule variant on the same bars
  // Another variant on a later, non-overlapping range is not counted (it reads from 2026-01-23 21:30Z).
  await rc.call({ ...args, from_date: '2026-01-26', rules: { ...args.rules, max_missing_slots: 4 } });
  const { call } = await forecastClient(t, deps);
  const untracked = await call({ artifact_id, loss: 'mse' });
  assert.deepEqual(untracked.search, { status: 'untracked', proxy_rule_variants: 2, proxy_bar_series_versions: 1,
    limitations: ['search_count_is_not_tracked'] });
  const tracked = await call({ artifact_id, loss: 'mse', research_id: 'study:joined' });
  assert.deepEqual(Object.keys(tracked.search).slice(-3), ['proxy_rule_variants', 'proxy_bar_series_versions', 'period_usage_prior_overlap']);
  assert.deepEqual([tracked.search.status, tracked.search.proxy_rule_variants, tracked.search.proxy_bar_series_versions], ['tracked', 2, 1]);
  // The source record is forecast-set-source: + sha256("proxy-set:<hex>"), computable from the proxy-set ID.
  const usage = await jsonLines(stores.paths.usage);
  assert.equal(usage[0].series_id, `forecast-set-source:${(await rcSha(`proxy-set:${computed.proxy_set_id.slice(7)}`)).slice(7)}`);
  assert.deepEqual(usage.slice(1).map((row) => row.series_id), ['fx:EURUSD', 'fx:USDJPY']);
  // A re-imported bar series computed over the same data is another version.
  const ref = await rcReference();
  const reimported = (await stores.barSeries.register(rcBarInput(ref.bar_sets.A_100_shaped[1], 15, 'recleaned'))).artifact_id;
  await rc.call({ ...args, series: [args.series[0], reimported] });
  assert.equal((await call({ artifact_id, loss: 'mse' })).search.proxy_bar_series_versions, 2);
  // The description says what the tool now does for these sources.
  const client = await connectedClient(makeDeps());
  t.after(() => client.close());
  const description = (await client.listTools()).tools.find((tool) => tool.name === 'compare_forecast_losses').description;
  for (const phrase of ['proxy-set:<hex>', '--proxy-set join', 'proxy_rule_variants and proxy_bar_series_versions']) {
    assert.ok(description.includes(phrase), phrase);
  }
});

test('compare_forecast_losses: a proxy-set source that fails verification writes nothing and returns no statistics', async (t) => {
  const { stores, artifact_id, deps } = await joinedForecastSet(t);
  const stored = await stores.forecastSets.get(artifact_id);
  const { labels, ...plain } = stored;
  // The store API admits proxy-set sources (only the entry points refuse them), so tampered sets can be placed directly.
  const register = async (patch) => (await stores.forecastSets.register({ ...plain, ...patch })).artifact_id;
  const kept = stored.primary.findIndex((v) => v !== null);
  const emptyJournal = new (await import('../../build/realizedCovarianceJournal.js')).RealizedCovarianceJournalStore(join(stores.dir, 'empty.jsonl'));
  const cases = [
    ['edited primary', await register({ primary: stored.primary.map((v, i) => (i === kept ? [[v[0][0] * 2, v[0][1]], [v[1][0], v[1][1]]] : v)) }),
      deps, /proxy_set_mismatch: the forecast set differs from its proxy set in primary/],
    ['deleted date', await register(Object.fromEntries(['dates', 'windows', 'a', 'b', 'primary', 'secondary']
      .map((k) => [k, stored[k].filter((_, i) => i !== 2)]))), deps, /proxy_set_mismatch: .*contiguous run/],
    ['hex mismatch', await register({ source_sha256: 'sha256:' + 'e'.repeat(64) }), deps, /proxy_set_mismatch: source_id and source_sha256/],
    ['not journaled', artifact_id, { ...deps, realizedCovarianceJournal: emptyJournal }, /proxy_set_not_journaled/],
  ];
  for (const [name, id, clientDeps, pattern] of cases) {
    const { raw } = await forecastClient(t, clientDeps);
    const response = await raw({ artifact_id: id, loss: 'mse', research_id: 'study:tamper' });
    assert.equal(response.isError, true, name);
    assert.match(response.content[0].text, pattern, name);
    assert.doesNotMatch(response.content[0].text, /battery_outcome|dbar/, name);
  }
  // The injected resolver reaches the verification: tzdata drift that moves the boundaries fails closed (H4, H6).
  const { intlZoneResolver } = await import('../../build/zonedTime.js');
  const drifted = await forecastClient(t, { ...deps,
    zoneResolver: { tzdata: 'test-2099z', formatAt: (zone, ms) => intlZoneResolver.formatAt(zone, ms + 3_600_000) } });
  const drift = await drifted.raw({ artifact_id, loss: 'mse', research_id: 'study:tamper' });
  assert.match(drift.content[0].text, /proxy_set_windows_changed_under_current_tzdata/);
  assert.deepEqual([(await jsonLines(stores.paths.usage)).length, (await jsonLines(stores.paths.loss)).length], [0, 0], 'no record before verification');
});

test('compare_forecast_losses: a stored 0.1.14 set with a proxy-set: source fails closed with proxy_set_not_found (Q6)', async (t) => {
  const stores = await rcStores(t);
  const { ForecastSetStore } = await import('../../build/forecastSet.js');
  const { ForecastLossJournalStore } = await import('../../build/forecastLossJournal.js');
  const { mkdir } = await import('node:fs/promises');
  const golden = JSON.parse(await readFile(new URL('../fixtures/forecast-set/format-0.1.14.json', import.meta.url), 'utf8'))
    .goldens.find((g) => g.name === 'proxy_set_source');
  const sets = join(stores.dir, 'sets');
  await mkdir(sets, { mode: 0o700 });
  await writeFile(join(sets, `${golden.artifact_id.slice(7)}.json`), golden.body, { mode: 0o600 });
  const loss = join(stores.dir, 'loss.jsonl');
  const { raw } = await forecastClient(t, { forecastSets: new ForecastSetStore(sets), forecastLossJournal: new ForecastLossJournalStore(loss),
    researchPeriodUsage: stores.researchPeriodUsage, proxySets: stores.proxySets, realizedCovarianceJournal: stores.realizedCovarianceJournal });
  const response = await raw({ artifact_id: golden.artifact_id, loss: 'mse', research_id: 'study:old' });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /proxy_set_not_found/);
  assert.deepEqual([(await jsonLines(stores.paths.usage)).length, (await jsonLines(loss)).length], [0, 0]);
});

// declare_forward_period and shorten_forward_period (docs/FORWARD_PERIOD_PLAN.md, step 5). Real stores in mkdtemp,
// with the period usage store's clock injected so historical spans can be declared before they "start".
async function forwardStores(t, at) {
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { StrategyResearchJournalStore } = await import('../../build/strategyResearchJournal.js');
  const { rm } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'forward-tool-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const clock = { now: at };
  const usagePath = join(dir, 'usage.jsonl');
  const research = new StrategyResearchJournalStore(join(dir, 'research.jsonl'));
  const researchPeriodUsage = new ResearchPeriodUsageStore(usagePath, undefined, { now: () => new Date(clock.now), researchJournalPath: join(dir, 'research.jsonl') });
  return { dir, clock, usagePath, research, researchPeriodUsage };
}
async function forwardClient(t, deps) {
  const client = await connectedClient(makeDeps(deps));
  t.after(() => client.close());
  const raw = (name, args) => client.callTool({ name, arguments: args });
  const call = async (name, args) => {
    const response = await raw(name, args);
    assert.ok(!response.isError, response.content[0].text);
    return JSON.parse(response.content[0].text);
  };
  return { raw, call };
}
const fwd = (patch = {}) => ({ declaration_id: 'fwd-1', research_id: 'study:fwd', series_ids: ['fx:EURUSD'], from: '2027-01-01T00:00:00.000Z',
  to: '2027-04-01T00:00:00.000Z', protocol_sha256: 'sha256:' + 'a'.repeat(64), ...patch });

test('declare_forward_period and shorten_forward_period: confirm, strict inputs, hypotheses and intent-only answers', async (t) => {
  const s = await forwardStores(t, '2026-10-01T00:00:00.000Z');
  await s.research.registerHypothesis({ hypothesisId: 'h-fwd', title: 't', thesis: 'x', parentExperimentId: null, evaluationContract: {
    population: 'out_of_sample', primaryMetric: 'profitFactor', minimumTrades: 30, symbols: ['OANDA:EURUSD'], timeframes: ['60'],
    minimumProfitFactor: null, maximumDrawdownPercent: null } });
  const { raw, call } = await forwardClient(t, { researchPeriodUsage: s.researchPeriodUsage,
    researchJournal: { findHypothesis: (kind, id) => s.research.findHypothesis(kind, id) } });
  for (const args of [fwd(), { ...fwd(), confirm: true, extra: 1 }, { ...fwd({ series_ids: ['proxy-set-source:x'] }), confirm: true }]) {
    assert.equal((await raw('declare_forward_period', args)).isError, true, JSON.stringify(args).slice(0, 80));
  }
  const declared = await call('declare_forward_period', { ...fwd({ hypothesis: { kind: 'strategy', id: 'h-fwd' } }), confirm: true });
  assert.deepEqual([declared.idempotent, declared.declaration.state, declared.declaration.hypothesis.population], [false, 'pending', 'out_of_sample']);
  assert.equal(declared.limitations.length, 10);
  const lead = await raw('declare_forward_period', { ...fwd({ declaration_id: 'fwd-2', series_ids: ['fx:USDJPY'], from: '2026-10-01T12:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z' }), confirm: true });
  assert.match(lead.content[0].text, /^Error: forward_period_lead_too_short: /);
  assert.equal((await raw('shorten_forward_period', { declaration_id: 'fwd-1', research_id: 'study:fwd', new_end: '2027-03-01T00:00:00.000Z', reason: 'narrower' })).isError, true,
    'shortening needs confirm:true');
  const mismatch = await raw('shorten_forward_period', { declaration_id: 'fwd-1', research_id: 'someone-else', new_end: '2027-03-01T00:00:00.000Z', reason: 'r', confirm: true });
  assert.match(mismatch.content[0].text, /forward_period_research_id_mismatch/);
  const shortened = await call('shorten_forward_period', { declaration_id: 'fwd-1', research_id: 'study:fwd', new_end: '2027-03-01T00:00:00.000Z', reason: 'narrower', confirm: true });
  assert.deepEqual([shortened.shortening.new_end, shortened.declaration.effective_to, shortened.declaration.shortened_after_start],
    ['2027-03-01T00:00:00.000Z', '2027-03-01T00:00:00.000Z', false]);
});

test('preflight_research_oos takes research_id; check_research_period_usage reports declarations and still rejects research_id', async (t) => {
  const s = await forwardStores(t, '2026-10-01T00:00:00.000Z');
  const { raw, call } = await forwardClient(t, { researchPeriodUsage: s.researchPeriodUsage });
  await call('declare_forward_period', { ...fwd(), confirm: true });
  const period = { series_id: 'fx:EURUSD', data_version: 'sha256:' + 'b'.repeat(64), from: '2027-01-01T00:00:00.000Z', to: '2027-04-01T00:00:00.000Z' };
  const checked = await call('check_research_period_usage', period);
  assert.deepEqual([checked.overlapping_records, checked.forward_period_declarations.total], [0, 1]);
  assert.equal((await raw('check_research_period_usage', { ...period, research_id: 'study:fwd' })).isError, true);
  const brief = await call('check_research_period_usage', { ...period, summary_only: true });
  assert.deepEqual(brief.forward_period_declarations.listed_declaration_ids, ['fwd-1']);
  s.clock.now = '2027-05-01T00:00:00.000Z';
  const own = await call('preflight_research_oos', { ...period, research_id: 'study:fwd' });
  assert.deepEqual([own.status, own.reason, own.execution_allowed, own.contract],
    ['review_required', 'declared_intent_without_recorded_usage_is_not_unused_evidence', false, 'recorded_usage_oos_preflight_v2']);
  const other = await call('preflight_research_oos', { ...period, research_id: 'study:other' });
  assert.deepEqual([other.status, other.reason], ['blocked', 'evaluation_period_declared_for_another_research']);
  const anonymous = await call('preflight_research_oos', { ...period, summary_only: true });
  assert.deepEqual([anonymous.status, anonymous.reason], ['blocked', 'evaluation_period_has_a_forward_period_declaration']);
  assert.deepEqual(anonymous.usage.forward_period_declarations.listed_declaration_ids, ['fwd-1']);
});

test('record_research_period_usage_batch shares declaration fields in one top-level map; summary_only keeps counts and IDs', async (t) => {
  const s = await forwardStores(t, '2026-10-01T00:00:00.000Z');
  const { call } = await forwardClient(t, { researchPeriodUsage: s.researchPeriodUsage });
  await call('declare_forward_period', { ...fwd(), confirm: true });
  s.clock.now = '2027-02-15T00:00:00.000Z';
  const entry = (id, patch = {}) => ({ access_id: id, research_id: 'study:peek', series_id: 'fx:EURUSD', data_version: 'sha256:' + 'b'.repeat(64),
    from: '2027-01-10T00:00:00.000Z', to: '2027-01-20T00:00:00.000Z', accessed_at: '2027-02-14T00:00:00.000Z', purpose: 'exploration', ...patch });
  const full = await call('record_research_period_usage_batch', { records: [entry('p1'), entry('p2', { series_id: 'fx:USDJPY' })], confirm: true });
  assert.deepEqual(Object.keys(full), ['recorded', 'idempotent', 'forward_period_declarations_by_id', 'results']);
  assert.deepEqual(Object.keys(full.forward_period_declarations_by_id), ['fwd-1']);
  assert.deepEqual(Object.keys(full.forward_period_declarations_by_id['fwd-1']), ['declaration_id', 'research_id', 'series_ids', 'from', 'to',
    'protocol_sha256', 'hypothesis', 'recorded_at', 'lead_seconds']);
  const listed = full.results[0].prior_overlap.forward_period_declarations.listed[0];
  assert.equal(listed.declaration_id, 'fwd-1');
  assert.equal('series_ids' in listed, false, 'static fields appear once, in the map');
  assert.deepEqual([listed.state, listed.accesses.other_research], ['running', 1], 'as-of fields stay with the result');
  assert.equal(full.results[0].overlapped_forward_period_declarations.by_relation.other_research, 1);
  assert.equal(full.results[1].overlapped_forward_period_declarations.total, 0);
  const brief = await call('record_research_period_usage_batch', { records: [entry('p3')], confirm: true, summary_only: true });
  assert.equal('forward_period_declarations_by_id' in brief, false);
  assert.deepEqual(brief.results[0].prior_overlap.forward_period_declarations.listed_declaration_ids, ['fwd-1']);
});

test('compare_forecast_losses reports overlapped declarations in its records and per-series columns', async (t) => {
  const stores = await forecastStores(t);
  const s = await forwardStores(t, '2019-06-01T00:00:00.000Z');
  const { artifact_id } = await stores.forecastSets.register(forecastSetInput());
  const tools = await forwardClient(t, { researchPeriodUsage: s.researchPeriodUsage });
  await tools.call('declare_forward_period', { ...fwd({ research_id: 'study:other', from: '2020-02-01T00:00:00.000Z', to: '2020-03-01T00:00:00.000Z' }), confirm: true });
  s.clock.now = '2026-09-30T00:00:00.000Z';
  const { call } = await forecastClient(t, { forecastSets: stores.forecastSets, forecastLossJournal: stores.forecastLossJournal,
    researchPeriodUsage: s.researchPeriodUsage });
  const r = await call({ artifact_id, loss: 'mse', research_id: 'study:mine' });
  const [source, eurusd] = r.period_usage.records;
  assert.deepEqual(eurusd.overlapped_forward_period_declarations.by_relation, { other_research: 1, declaring_research_exploration: 0, declaring_research_validation: 0 });
  assert.equal(source.overlapped_forward_period_declarations.total, 0, 'the source record is its own series');
  assert.deepEqual(r.search.period_usage_prior_overlap.per_series.map((row) => row.active_forward_period_declarations),
    [{ declared_by_this_research: 0, declared_by_other_research: 0 }, { declared_by_this_research: 0, declared_by_other_research: 1 }]);
  assert.ok(r.search.period_usage_prior_overlap.limitations.includes('access_overlaps_a_declared_forward_period'));
});

test('compute_realized_covariance reports overlapped declarations in its records and per-series columns', async (t) => {
  const stores = await rcStores(t);
  const s = await forwardStores(t, '2025-12-01T00:00:00.000Z');
  const args = await rcScenario(stores, 'A_100_shaped');
  const tools = await forwardClient(t, { researchPeriodUsage: s.researchPeriodUsage });
  await tools.call('declare_forward_period', { ...fwd({ research_id: 'study:rc', from: '2026-01-06T00:00:00.000Z', to: '2026-01-31T00:00:00.000Z' }), confirm: true });
  s.clock.now = '2026-09-30T00:00:00.000Z';
  const { call } = await rcClient(t, { ...rcStoreDeps(stores), researchPeriodUsage: s.researchPeriodUsage });
  const r = await call({ ...args, research_id: 'study:rc' });
  assert.deepEqual(r.period_usage.records.map((row) => row.overlapped_forward_period_declarations.total), [0, 1, 0]);
  assert.equal(r.period_usage.records[1].overlapped_forward_period_declarations.listed[0].relation, 'declaring_research_exploration');
  assert.deepEqual(r.search.period_usage_prior_overlap.per_series[1].active_forward_period_declarations,
    { declared_by_this_research: 1, declared_by_other_research: 0 });
  assert.ok(r.search.period_usage_prior_overlap.limitations.includes('access_overlaps_a_declared_forward_period'));
});


// backtest_risk_forecast (docs/RISK_FORECAST_BACKTEST_PLAN.md, step 6), end to end with real stores in mkdtemp: synthetic
// M15 bars over about 13 months, compute_realized_covariance through the tool, the --proxy-set join through the CLI.
async function riskFixture(t, { firstInterval = 'from_previous_endpoint', zoneResolver } = {}) {
  const stores = await rcStores(t);
  const { ForecastSetStore } = await import('../../build/forecastSet.js');
  const { RiskBacktestJournalStore } = await import('../../build/riskBacktestJournal.js');
  const { importForecastSet } = await import('../../build/forecastSetCli.js');
  const { createRandom } = await import('../../build/seededRandom.js');
  stores.paths.sets = join(stores.dir, 'sets');
  stores.paths.risk = join(stores.dir, 'risk.jsonl');
  stores.forecastSets = new ForecastSetStore(stores.paths.sets);
  stores.riskBacktestJournal = new RiskBacktestJournalStore(stores.paths.risk);
  const start = Date.parse('2025-01-01T00:00:00.000Z') / 1000, end = Date.parse('2026-02-14T00:00:00.000Z') / 1000;
  const random = createRandom(31);
  const series = [];
  for (const [i, name] of ['fx:RISKA', 'fx:RISKB'].entries()) {
    const open_time = [], close = [];
    let level = 1 + i;
    for (let at = start; at < end; at += 900) { level *= 1 + 0.0004 * (random() - 0.5); open_time.push(at); close.push(level); }
    series.push((await stores.barSeries.register(rcBarInput({ series_id: name, open_time, close }, 15, 'risk-synthetic'))).artifact_id);
  }
  const rules = { interval_minutes: 15, time_zone: 'America/New_York', day_end_local: '16:45', day_weekdays: [1, 2, 3, 4, 5],
    max_missing_slots: 6, first_interval: firstInterval, return_unit: 'log_percent' };
  const rc = await rcClient(t, { ...rcStoreDeps(stores), zoneResolver });
  const computed = await rc.call({ series, rules, from_date: '2025-01-06', to_date: '2026-02-13' });
  const proxy = await stores.proxySets.get(computed.proxy_set_id);
  // A: yesterday's realized covariance plus a ridge; B: a constant matrix.
  const ridge = (m) => [[m[0][0] + 1e-4, m[0][1]], [m[1][0], m[1][1] + 1e-4]];
  const a = proxy.rc.map((_, d) => ridge(proxy.rc[Math.max(0, d - 1)] ?? proxy.rc[d]));
  const b = proxy.rc.map(() => [[0.02, 0.001], [0.001, 0.02]]);
  const input = join(stores.dir, 'risk-forecasts.json');
  await writeFile(input, JSON.stringify({ schema_version: '1.0', evidence_tier: 'historical_exploration', from_date: proxy.dates[0],
    to_date: proxy.dates[proxy.dates.length - 1], a, b }));
  const { artifact_id } = await importForecastSet(['--proxy-set', computed.proxy_set_id, '--input', input, '--confirm-local-import'],
    { store: stores.forecastSets, proxySets: stores.proxySets, journal: stores.realizedCovarianceJournal, resolver: zoneResolver });
  const deps = { forecastSets: stores.forecastSets, researchPeriodUsage: stores.researchPeriodUsage, proxySets: stores.proxySets,
    realizedCovarianceJournal: stores.realizedCovarianceJournal, barSeries: stores.barSeries, riskBacktestJournal: stores.riskBacktestJournal,
    zoneResolver };
  return { stores, proxy, artifact_id, deps, computed, series, a };
}
async function riskClient(t, deps) {
  const client = await connectedClient(makeDeps(deps));
  t.after(() => client.close());
  const raw = (args) => client.callTool({ name: 'backtest_risk_forecast', arguments: args });
  const call = async (args) => {
    const response = await raw(args);
    assert.ok(!response.isError, response.content[0].text);
    return JSON.parse(response.content[0].text);
  };
  const error = async (args) => {
    const response = await raw(args);
    assert.ok(response.isError, response.content[0].text);
    return response.content[0].text;
  };
  return { raw, call, error };
}
const riskArgs = (artifact_id, patch = {}) => ({ artifact_id, weights: [1, 1], target_annual_vol: { value: 10, unit: 'log_percent' }, ...patch });

test('backtest_risk_forecast end to end, tracked: the response, period usage over the span read, the journal and search', async (t) => {
  const { stores, proxy, artifact_id, deps, computed, series, a } = await riskFixture(t);
  const { call } = await riskClient(t, deps);
  const r = await call(riskArgs(artifact_id, { research_id: 'study:risk' }));
  // Leverage is the daily target (value/√(52·5)) over σ̂ from the normalized weights, on each of the worst days.
  for (const day of r.forecasts.a.vol_target.worst_days.days) {
    const m = a[proxy.dates.indexOf(day.date)], w = [0.5, 0.5];
    const sigma = Math.sqrt(w[0] * m[0][0] * w[0] + w[0] * m[0][1] * w[1] + w[1] * m[1][0] * w[0] + w[1] * m[1][1] * w[1]);
    assert.ok(Math.abs(day.leverage - (10 / Math.sqrt(260)) / sigma) <= 1e-12 * day.leverage, `${day.date}: ${day.leverage}`);
  }
  assert.deepEqual(Object.keys(r), ['contract', 'candidateEligible', 'unused_proven', 'input', 'days', 'scale_check', 'forecasts',
    'tests_reported', 'search', 'period_usage', 'limitations']);
  assert.deepEqual([r.contract, r.candidateEligible, r.unused_proven], ['risk_forecast_backtest_v1', false, false]);
  assert.deepEqual(r.input, { artifact_id, evidence_tier: 'historical_exploration', source_id: `proxy-set:${computed.proxy_set_id.slice(7)}`,
    proxy_set_id: computed.proxy_set_id, series_ids: ['fx:RISKA', 'fx:RISKB'], run: { from_date: proxy.dates[0], to_date: proxy.dates[proxy.dates.length - 1] },
    weights: [0.5, 0.5], target: { value: 10, unit: 'log_percent' }, periods_per_year: 260 });
  assert.equal(r.days.outcome, 'evaluated');
  assert.ok(r.days.return_dates >= 250, String(r.days.return_dates));
  assert.deepEqual([r.forecasts.a.status, r.forecasts.b.status, r.tests_reported], ['evaluated', 'evaluated', 12]);
  assert.equal(r.forecasts.a.var[0].T, r.days.return_dates);
  assert.equal(r.limitations.length, 15);
  assert.ok(!r.limitations.includes('within_day_returns_exclude_first_interval_and_gaps'));
  // Period usage: the set source with the set's ID, then each bar series actually read, all over the span read.
  const span = { from: new Date(Date.parse(proxy.windows[0].from) - 900_000).toISOString(), to: proxy.windows[proxy.windows.length - 1].to };
  const usage = await jsonLines(stores.paths.usage);
  const risk = usage.filter((row) => row.tool_name === 'backtest_risk_forecast');
  assert.deepEqual(risk.map((row) => [row.series_id, row.data_version, row.from, row.to, row.scope]), [
    [`forecast-set-source:${(await rcSha(`proxy-set:${computed.proxy_set_id.slice(7)}`)).slice(7)}`, artifact_id, span.from, span.to, 'risk_backtest_bar_window_only'],
    ['fx:RISKA', series[0], span.from, span.to, 'risk_backtest_bar_window_only'],
    ['fx:RISKB', series[1], span.from, span.to, 'risk_backtest_bar_window_only'],
  ]);
  assert.equal(r.period_usage.status, 'tracked');
  assert.deepEqual(r.period_usage.records.map((record) => record.overlapped_forward_period_declarations.status), ['available', 'available', 'available']);
  // The journal and search.
  const [journal] = await jsonLines(stores.paths.risk);
  assert.deepEqual([journal.research_id, journal.forecast_set_id, journal.proxy_set_id, journal.span, journal.outcome],
    ['study:risk', artifact_id, computed.proxy_set_id, span, 'evaluated']);
  assert.deepEqual(journal.forecasts.a.levels.map((level) => level.x), r.forecasts.a.var.map((entry) => entry.hits.without_own_nulls));
  assert.deepEqual(Object.keys(r.search), ['this_research_id', 'overlapping_data', 'proxy_rule_variants', 'proxy_bar_series_versions',
    'period_usage_prior_overlap', 'limitations']);
  assert.deepEqual([r.search.this_research_id.calls, r.search.proxy_rule_variants, r.search.proxy_bar_series_versions], [1, 1, 1]);
  assert.deepEqual(r.search.period_usage_prior_overlap.per_series.map((row) => row.series_id),
    risk.map((row) => row.series_id));
  // A second call with other weights is one more weight vector under this research ID.
  const again = await call(riskArgs(artifact_id, { research_id: 'study:risk', weights: [1, -1] }));
  assert.deepEqual([again.search.this_research_id.calls, again.search.this_research_id.distinct_weight_vectors], [2, 2]);
  assert.deepEqual(again.input.weights, [0.5, -0.5]);
});

test('backtest_risk_forecast untracked: the journal still records the call, nothing is written to period usage', async (t) => {
  const { stores, artifact_id, deps } = await riskFixture(t);
  const before = (await jsonLines(stores.paths.usage)).length;
  const { call } = await riskClient(t, deps);
  const r = await call(riskArgs(artifact_id));
  assert.deepEqual(r.period_usage, { status: 'untracked', limitations: ['research_id_required_for_automatic_period_usage'] });
  assert.deepEqual(r.search.this_research_id, { status: 'untracked' });
  assert.ok(!('period_usage_prior_overlap' in r.search));
  assert.equal((await jsonLines(stores.paths.usage)).length, before);
  const [journal] = await jsonLines(stores.paths.risk);
  assert.equal(journal.research_id, null);
});

test('backtest_risk_forecast errors, in order, write nothing', async (t) => {
  const { stores, artifact_id, deps, series } = await riskFixture(t);
  const { error } = await riskClient(t, deps);
  const usageBefore = (await jsonLines(stores.paths.usage)).length;
  // A plain forecast set is refused before the weights are looked at.
  const plain = await stores.forecastSets.register({ schema_version: '1.0', source_id: 'plain', source_sha256: 'sha256:' + 'c'.repeat(64),
    evidence_tier: 'synthetic_test', horizon: 1, n: 1, underlying_series_ids: ['fx:PLAIN'], dates: ['2026-01-05'],
    windows: [{ from: '2026-01-04T22:00:00.000Z', to: '2026-01-05T22:00:00.000Z' }], a: [1], b: [1], primary: [1] });
  assert.match(await error(riskArgs(plain.artifact_id, { weights: [1, 2, 3] })), /risk_backtest_requires_proxy_set_source/);
  // Then the weights, then the target unit.
  assert.match(await error(riskArgs(artifact_id, { weights: [1], target_annual_vol: { value: 0.1, unit: 'log' } })), /weights_invalid/);
  assert.match(await error(riskArgs(artifact_id, { weights: [0, 0] })), /weights_invalid/);
  assert.match(await error(riskArgs(artifact_id, { target_annual_vol: { value: 0.1, unit: 'log' } })), /target_unit_mismatch/);
  // A verification failure comes before the unit check and the bars.
  const noProxy = await riskClient(t, { ...deps, proxySets: { get: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    register: async () => { throw new Error('unexpected'); } } });
  assert.match(await noProxy.error(riskArgs(artifact_id, { target_annual_vol: { value: 0.1, unit: 'log' } })), /proxy_set_not_found/);
  assert.match(await noProxy.error(riskArgs(artifact_id, { weights: [1] })), /weights_invalid/, 'the weights come before the verification');
  // A missing or edited bar series.
  const missing = await riskClient(t, { ...deps, barSeries: { get: async (id) => {
    if (id === series[1]) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return stores.barSeries.get(id);
  } } });
  assert.match(await missing.error(riskArgs(artifact_id, { research_id: 'study:risk' })), /bar_series_not_found/);
  const edited = await riskClient(t, { ...deps, barSeries: { get: async (id) => {
    const bars = await stores.barSeries.get(id);
    return id === series[0] ? { ...bars, close: bars.close.map((c, i) => (i === 20_000 ? c * 1.01 : c)) } : bars;
  } } });
  assert.match(await edited.error(riskArgs(artifact_id, { research_id: 'study:risk' })), /returns_rederivation_mismatch: \d{4}-\d{2}-\d{2} rc/);
  assert.equal((await jsonLines(stores.paths.usage)).length, usageBefore, 'no period usage on any error');
  await assert.rejects(readFile(stores.paths.risk), { code: 'ENOENT' }, 'no journal entry on any error');
  // Strict input, and usage_access_id needs research_id.
  assert.match(await error({ ...riskArgs(artifact_id), reserch_id: 'typo' }), /reserch_id|unrecognized/i);
  assert.match(await error(riskArgs(artifact_id, { usage_access_id: 'retry-1' })), /usage_access_id requires research_id/);
});

test('backtest_risk_forecast: usage_access_id retries are idempotent; another weight vector or target under it conflicts', async (t) => {
  const { stores, artifact_id, deps } = await riskFixture(t);
  const { call, error } = await riskClient(t, deps);
  const first = await call(riskArgs(artifact_id, { research_id: 'study:risk', usage_access_id: 'risk-retry' }));
  const retry = await call(riskArgs(artifact_id, { research_id: 'study:risk', usage_access_id: 'risk-retry', weights: [2, 2] }));
  assert.deepEqual(first.period_usage.records.map((r) => r.idempotent), [false, false, false]);
  assert.deepEqual(retry.period_usage.records.map((r) => r.idempotent), [true, true, true], 'the normalized weights are what the hash binds');
  assert.deepEqual(retry.forecasts, first.forecasts, 'the scale of the weights changes nothing');
  assert.match(await error(riskArgs(artifact_id, { research_id: 'study:risk', usage_access_id: 'risk-retry', weights: [1, 0] })), /conflicts/);
  assert.match(await error(riskArgs(artifact_id, { research_id: 'study:risk', usage_access_id: 'risk-retry',
    target_annual_vol: { value: 20, unit: 'log_percent' } })), /conflicts/);
  assert.equal((await jsonLines(stores.paths.risk)).length, 2, 'the journal counts every successful call, retries included');
});

test('backtest_risk_forecast: a journal failure after the period write names the records, without statistics', async (t) => {
  const { artifact_id, deps } = await riskFixture(t);
  const { error } = await riskClient(t, { ...deps, riskBacktestJournal: { record: async () => { throw new Error('disk full'); } } });
  const message = await error(riskArgs(artifact_id, { research_id: 'study:risk', usage_access_id: 'risk-retry' }));
  assert.match(message, /risk backtest journal write failed after period usage was recorded as risk-retry:0-2; no statistics returned: disk full/);
  const untracked = await error(riskArgs(artifact_id));
  assert.match(untracked, /risk backtest journal write failed; no statistics returned/);
});

test('backtest_risk_forecast reads the realized-covariance journal counts before writing anything (code review C2)', async (t) => {
  const { stores, artifact_id, deps } = await riskFixture(t);
  const before = (await jsonLines(stores.paths.usage)).length;
  const failing = { ...deps, realizedCovarianceJournal: { findByProxySetId: (id) => stores.realizedCovarianceJournal.findByProxySetId(id),
    search: async () => { throw new Error('realized covariance journal unreadable (simulated)'); } } };
  const { error } = await riskClient(t, failing);
  assert.match(await error(riskArgs(artifact_id, { research_id: 'study:risk' })), /unreadable \(simulated\)/);
  assert.equal((await jsonLines(stores.paths.usage)).length, before, 'no period usage');
  await assert.rejects(readFile(stores.paths.risk), { code: 'ENOENT' }, 'no journal entry');
});

test('backtest_risk_forecast: a short joined set is not evaluable, and within_day rules add their limitation', async (t) => {
  const { stores, artifact_id, deps } = await joinedForecastSet(t);
  const { RiskBacktestJournalStore } = await import('../../build/riskBacktestJournal.js');
  const riskPath = join(stores.dir, 'risk.jsonl');
  const { call } = await riskClient(t, { ...deps, barSeries: stores.barSeries, riskBacktestJournal: new RiskBacktestJournalStore(riskPath) });
  const r = await call(riskArgs(artifact_id));
  // 2 of its 9 dates are dropped, and the missing-return budget is checked before the 250-date minimum.
  assert.deepEqual([r.days.outcome, r.days.reason, r.forecasts, r.tests_reported], ['not_evaluable', 'more_than_10_percent_of_returns_missing', null, 0]);
  assert.deepEqual(r.days.missing_returns, { total: 2, by_cause: { no_endpoint: 1, no_previous_endpoint: 1 } });
  assert.ok(r.scale_check.a !== undefined);
  const [journal] = await jsonLines(riskPath);
  assert.deepEqual([journal.outcome, journal.forecasts], ['not_evaluable', null]);
  const within = await riskFixture(t, { firstInterval: 'within_day' });
  const w = await (await riskClient(t, within.deps)).call(riskArgs(within.artifact_id));
  assert.equal(w.days.outcome, 'evaluated');
  assert.ok(w.limitations.includes('within_day_returns_exclude_first_interval_and_gaps'));
  assert.equal(w.limitations.length, 16);
});

test('backtest_risk_forecast re-derives under the zone resolver the verification used', async (t) => {
  const { intlZoneResolver } = await import('../../build/zonedTime.js');
  const shifted = { tzdata: 'test-shifted', formatAt: (zone, ms) => intlZoneResolver.formatAt(zone, ms + 3_600_000) };
  const { artifact_id, deps } = await riskFixture(t, { zoneResolver: shifted });
  const r = await (await riskClient(t, deps)).call(riskArgs(artifact_id));
  assert.equal(r.days.outcome, 'evaluated');
});

test('backtest_risk_forecast: the description says what the tool does and does not claim', async (t) => {
  const client = await connectedClient(makeDeps());
  t.after(() => client.close());
  const description = (await client.listTools()).tools.find((tool) => tool.name === 'backtest_risk_forecast').description;
  for (const phrase of ['proxy-set:<hex>', 're-derived from the proxy set', 'indeterminate_due_to_own_nulls', 'not evidence of a correct risk model',
    'Every call is journaled', 'candidateEligible is always false', 'No costs or execution']) {
    assert.ok(description.includes(phrase), phrase);
  }
});
