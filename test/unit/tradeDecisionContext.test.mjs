import test from "node:test";
import assert from "node:assert/strict";
import { buildTradeDecisionContext } from "../../build/tradeDecisionContext.js";

// BACKLOG 102-06: the event gate reads its own calendar window around the request.
const now = new Date("2026-07-15T12:00:00.000Z");

/** A calendar that, like the real source, returns only events inside from..to, the earliest first, up to the limit. */
function calendarOf(events, calls = []) {
  return {
    getEvents: async (options) => {
      calls.push(options);
      const from = Date.parse(options.from ?? now.toISOString());
      const to = options.to === undefined ? from + 7 * 86_400_000 : Date.parse(options.to);
      const rank = { low: 0, medium: 1, high: 2 };
      const inRange = events.filter((event) => Date.parse(event.date) >= from && Date.parse(event.date) <= to);
      const matching = inRange
        .filter((event) => rank[event.importance] >= rank[options.minImportance ?? "medium"])
        .sort((left, right) => Date.parse(left.date) - Date.parse(right.date))
        .slice(0, options.limit ?? 50);
      return {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        countries: options.countries ?? ["US", "EU", "JP", "GB"],
        minImportance: options.minImportance ?? "medium",
        totalInRange: inRange.length,
        returned: matching.length,
        events: matching,
      };
    },
  };
}

const event = (date, importance = "high", title = "CPI YoY") => ({
  id: `${title}-${date}`, date, country: "US", currency: "USD", title, indicator: null, importance,
  period: null, actual: null, forecast: null, previous: null, unit: null,
});

function deps(calendar) {
  return {
    tv: {
      getChartContext: async () => ({
        layoutName: "FX", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }],
      }),
      getReplayStatus: async () => ({ available: true, toolbarVisible: false, started: false, ready: true, autoplay: false, currentTimeIso: null }),
      getExecutionQuotes: async () => [],
      getOhlcv: async () => ({
        symbol: "OANDA:EURUSD", resolution: "60", count: 1,
        bars: [{ time: now.getTime() / 1000 - 3600, timeIso: new Date(now.getTime() - 3600_000).toISOString(), open: 1.1, high: 1.2, low: 1, close: 1.1, volume: 1 }],
      }),
      getKeyLevels: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", price: 1.1, rangePercent: 3, count: 0, levels: [] }),
    },
    scanner: {
      getQuotes: async (symbols) => ({ totalCount: symbols.length, returned: symbols.length, rows: symbols.map((symbol) => ({ symbol, values: { close: 1.1, bid: 1.0999, ask: 1.1001 } })) }),
      getMtfOverview: async () => [],
    },
    calendar,
    cot: { getLatest: async () => { throw new Error("not requested"); } },
    realYield: { getLatest: async () => { throw new Error("not requested"); } },
  };
}

const options = {
  symbol: "OANDA:EURUSD",
  chartIndex: 0,
  expectedTimeframe: "60",
  ohlcvCount: 10,
  keyLevelRangePercent: 3,
  keyLevelLimit: 10,
  includePositioning: false,
  requirePositioning: false,
  includeRealYield: false,
  requireRealYield: false,
  eventBlackoutBeforeMinutes: 30,
  eventBlackoutAfterMinutes: 15,
  minimumEventImportance: "high",
  executionWaitForUpdateMs: 0,
  executionSampleIntervalMs: 100,
  executionMaxQuoteAgeMs: 1000,
};

const gate = async (events, overrides = {}, calls = []) =>
  buildTradeDecisionContext(deps(calendarOf(events, calls)), { ...options, ...overrides }, now);

test("an important release five minutes ago is inside the after-release blackout (102-06)", async () => {
  const calls = [];
  const result = await gate([event("2026-07-15T11:55:00.000Z")], {}, calls);
  assert.deepEqual([result.event_gate.status, result.decision_status], ["blackout", "wait"]);
  assert.deepEqual(result.event_gate.active_events.map((item) => item.date), ["2026-07-15T11:55:00.000Z"]);
  assert.deepEqual(result.event_gate.window, { from: "2026-07-15T11:45:00.000Z", to: "2026-07-15T12:30:00.000Z" });
  assert.ok(result.quality_issues.some((issue) => issue.code === "event_blackout_active"));
  // The gate asks the source for its own window, a minute wider either side, at the gate's importance and the most events.
  const gateCall = calls.find((call) => call.limit === 200);
  assert.deepEqual([gateCall.from, gateCall.to, gateCall.minImportance],
    ["2026-07-15T11:44:00.000Z", "2026-07-15T12:31:00.000Z", "high"]);
});

test("the blackout window includes both ends and nothing beyond them", async () => {
  const status = async (date) => (await gate([event(date)])).event_gate.status;
  assert.equal(await status("2026-07-15T11:45:00.000Z"), "blackout", "15 minutes after the release");
  assert.equal(await status("2026-07-15T11:44:59.000Z"), "clear");
  assert.equal(await status("2026-07-15T12:30:00.000Z"), "blackout", "30 minutes before the release");
  assert.equal(await status("2026-07-15T12:30:01.000Z"), "clear");
  assert.equal(await status("2026-07-15T12:10:00.000Z"), "blackout", "an upcoming release still counts");
});

test("the gate reads events at its own importance, whatever the snapshot shows", async () => {
  const medium = [event("2026-07-15T11:55:00.000Z", "medium", "Retail Sales")];
  // The snapshot lists only high events, but the gate is set to medium.
  const gated = await gate(medium, { minImportance: "high", minimumEventImportance: "medium" });
  assert.equal(gated.event_gate.status, "blackout");
  assert.deepEqual(gated.evidence.market_snapshot.data.economic_events.events, [], "the snapshot keeps its own filter");
  assert.equal((await gate(medium)).event_gate.status, "clear", "a medium event under a high gate");
});

test("a calendar that cannot be read, or returns the most events with none inside, leaves the gate not clear", async () => {
  const failing = { getEvents: async () => { throw new Error("calendar down"); } };
  const unavailable = await buildTradeDecisionContext(deps(failing), options, now);
  assert.deepEqual([unavailable.event_gate.status, unavailable.decision_status], ["unavailable", "wait"]);
  assert.ok(unavailable.quality_issues.some((issue) => issue.code === "event_gate_unavailable"));
  // 200 events in the minute past the window: the source cut there, so later ones inside it could be missing.
  const crowded = Array.from({ length: 200 }, (_, index) => event("2026-07-15T12:30:30.000Z", "high", `Auction ${index}`));
  const incomplete = await gate(crowded);
  assert.deepEqual([incomplete.event_gate.status, incomplete.decision_status], ["incomplete", "wait"]);
  assert.ok(incomplete.quality_issues.some((issue) => issue.code === "event_gate_incomplete"));
  assert.equal((await gate(crowded.slice(1))).event_gate.status, "clear", "fewer than the limit is the whole window");
});
