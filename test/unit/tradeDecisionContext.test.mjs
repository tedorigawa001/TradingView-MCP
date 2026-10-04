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

function deps(calendar, { onOhlcv = () => {} } = {}) {
  let quoteCalls = 0;
  return {
    tv: {
      getChartContext: async () => ({
        layoutName: "FX", activeChartIndex: 0, chartsCount: 1,
        charts: [{ index: 0, symbol: "OANDA:EURUSD", resolution: "60", studies: [] }],
      }),
      getReplayStatus: async () => ({ available: true, toolbarVisible: false, started: false, ready: true, autoplay: false, currentTimeIso: null }),
      getExecutionQuotes: async () => [],
      getOhlcv: async () => {
        onOhlcv();
        return {
          symbol: "OANDA:EURUSD", resolution: "60", count: 1,
          bars: [{ time: now.getTime() / 1000 - 3600, timeIso: new Date(now.getTime() - 3600_000).toISOString(), open: 1.1, high: 1.2, low: 1, close: 1.1, volume: 1 }],
        };
      },
      getKeyLevels: async () => ({ symbol: "OANDA:EURUSD", resolution: "60", price: 1.1, rangePercent: 3, count: 0, levels: [] }),
    },
    scanner: {
      // Every read moves bid/ask on a streaming quote, so the execution gate clears and only the event gate decides.
      getQuotes: async (symbols) => {
        quoteCalls += 1;
        const offset = (quoteCalls % 2) * 0.0001;
        return {
          totalCount: symbols.length,
          returned: symbols.length,
          rows: symbols.map((symbol) => ({ symbol, values: { close: 1.1015, bid: 1.1014 + offset, ask: 1.1016 + offset, update_mode: "streaming", pricescale: 100000, minmov: 1 } })),
        };
      },
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
  countries: ["US", "JP"],
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
  executionWaitForUpdateMs: 300,
  executionSampleIntervalMs: 100,
  executionMaxQuoteAgeMs: 1000,
};

const decide = async (events, overrides = {}, calls = [], depOptions = {}) =>
  buildTradeDecisionContext(deps(calendarOf(events, calls), depOptions), { ...options, ...overrides }, now);
const summary = (result) => [result.event_gate.status, result.decision_status];

test("with no event near the request the gate is clear and the decision trade_ready", async () => {
  assert.deepEqual(summary(await decide([event("2026-07-15T14:00:00.000Z")])), ["clear", "trade_ready"]);
});

test("an important release five minutes ago is inside the after-release blackout (102-06)", async () => {
  const calls = [];
  const result = await decide([event("2026-07-15T11:55:00.000Z")], {}, calls);
  assert.deepEqual(summary(result), ["blackout", "wait"]);
  assert.deepEqual(result.event_gate.active_events.map((item) => item.date), ["2026-07-15T11:55:00.000Z"]);
  assert.equal(result.event_gate.window.from, "2026-07-15T11:45:00.000Z");
  assert.ok(result.quality_issues.some((issue) => issue.code === "event_blackout_active"));
  // The gate asks the source for its own window, a minute wider either side, for the requested countries, at the
  // gate's importance and the most events.
  const gateCall = calls.find((call) => call.limit === 200);
  assert.deepEqual([gateCall.from, gateCall.to, gateCall.minImportance, gateCall.countries],
    ["2026-07-15T11:44:00.000Z", "2026-07-15T12:31:00.000Z", "high", ["US", "JP"]]);
});

test("the blackout window includes both ends and nothing beyond them", async (t) => {
  // A stopped clock makes the request take no time, so the window ends exactly 30 minutes after it.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const status = async (date) => (await decide([event(date)], { executionWaitForUpdateMs: 0 })).event_gate.status;
  assert.equal(await status("2026-07-15T11:45:00.000Z"), "blackout", "15 minutes after the release");
  assert.equal(await status("2026-07-15T11:44:59.999Z"), "clear");
  assert.equal(await status("2026-07-15T12:30:00.000Z"), "blackout", "30 minutes before the release");
  assert.equal(await status("2026-07-15T12:30:00.001Z"), "clear");
  // An upcoming release is in the snapshot as well as the gate's read, and is listed once.
  const upcoming = await decide([event("2026-07-15T12:10:00.000Z")], { executionWaitForUpdateMs: 0 });
  assert.deepEqual([upcoming.event_gate.status, upcoming.event_gate.active_events.length], ["blackout", 1]);
  assert.equal(upcoming.evidence.market_snapshot.data.economic_events.events.length, 1);
});

test("the end of the window is measured when the request completes", async (t) => {
  // The chart read takes 300 ms by a clock the test drives, so a release 30 minutes and 100 ms after the request is
  // within 30 minutes at the end.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const slow = await decide([event("2026-07-15T12:30:00.100Z")], { executionWaitForUpdateMs: 0 }, [], { onOhlcv: () => t.mock.timers.tick(300) });
  assert.deepEqual([slow.event_gate.status, slow.event_gate.window.to], ["blackout", "2026-07-15T12:30:00.300Z"]);
});

test("a request that outlasts the fetch's minute of slack leaves the gate incomplete", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const result = await decide([], { executionWaitForUpdateMs: 0 }, [], { onOhlcv: () => t.mock.timers.tick(61_000) });
  assert.equal(result.event_gate.status, "incomplete");
  assert.deepEqual(result.quality_issues.find((issue) => issue.code === "event_gate_incomplete").details.reasons, ["request_outlasted_window"]);
});

test("the gate reads events at its own importance, and also checks what the snapshot shows", async () => {
  const medium = [event("2026-07-15T11:55:00.000Z", "medium", "Retail Sales")];
  // The snapshot lists only high events, but the gate is set to medium.
  const gated = await decide(medium, { minImportance: "high", minimumEventImportance: "medium" });
  assert.deepEqual(summary(gated), ["blackout", "wait"]);
  assert.deepEqual(gated.evidence.market_snapshot.data.economic_events.events, [], "the snapshot keeps its own filter");
  assert.deepEqual(summary(await decide(medium)), ["clear", "trade_ready"], "a medium event under a high gate");
  // A gate read that misses an event the snapshot shows inside the window still waits.
  const fomc = event("2026-07-15T12:10:00.000Z", "high", "FOMC");
  const inconsistent = {
    getEvents: async (callOptions) => callOptions.limit === 200
      ? { ...(await calendarOf([]).getEvents(callOptions)) }
      : { ...(await calendarOf([fomc]).getEvents(callOptions)) },
  };
  const shown = await buildTradeDecisionContext(deps(inconsistent), options, now);
  assert.deepEqual(summary(shown), ["blackout", "wait"]);
});

test("a calendar that cannot be read leaves the gate unavailable and the decision wait", async () => {
  for (const getEvents of [async () => { throw new Error("calendar down"); }, () => { throw new Error("thrown at once"); }]) {
    const result = await buildTradeDecisionContext(deps({ getEvents }), options, now);
    assert.deepEqual(summary(result), ["unavailable", "wait"]);
    assert.ok(result.quality_issues.some((issue) => issue.code === "event_gate_unavailable"));
  }
});

test("a full answer is incomplete only when it ends inside the window; an unreadable time is incomplete", async () => {
  const reasons = (result) => result.quality_issues.find((issue) => issue.code === "event_gate_incomplete")?.details.reasons;
  // 200 events in the minute before the window: the source cut there, so later ones inside it could be missing.
  const early = Array.from({ length: 200 }, (_, index) => event("2026-07-15T11:44:30.000Z", "high", `Auction ${index}`));
  const cut = await decide(early);
  assert.deepEqual([...summary(cut), reasons(cut)], ["incomplete", "wait", ["limit_reached"]]);
  assert.deepEqual(summary(await decide(early.slice(1))), ["clear", "trade_ready"], "fewer than the limit is the whole answer");
  // 200 events after the window end: nothing inside the window can have been cut.
  const late = Array.from({ length: 200 }, (_, index) => event("2026-07-15T12:30:30.000Z", "high", `Auction ${index}`));
  assert.deepEqual(summary(await decide(late)), ["clear", "trade_ready"]);
  // A double that leaves out the count is counted by its events.
  const uncounted = {
    getEvents: async (callOptions) => {
      const answer = await calendarOf(early).getEvents(callOptions);
      return callOptions.limit === 200 ? { ...answer, returned: undefined } : answer;
    },
  };
  assert.equal((await buildTradeDecisionContext(deps(uncounted), options, now)).event_gate.status, "incomplete");
  // The source chose this event for the gate's window, but its time cannot be read.
  const garbled = {
    getEvents: async (callOptions) => {
      const answer = await calendarOf([]).getEvents(callOptions);
      return callOptions.limit === 200 ? { ...answer, returned: 1, events: [event("2026-13-45 99:99")] } : answer;
    },
  };
  const unreadable = await buildTradeDecisionContext(deps(garbled), options, now);
  assert.deepEqual([...summary(unreadable), reasons(unreadable)], ["incomplete", "wait", ["unreadable_event_time"]]);
  // Below the gate's importance, an unreadable time does not matter.
  const garbledLow = {
    getEvents: async (callOptions) => {
      const answer = await calendarOf([]).getEvents(callOptions);
      return callOptions.limit === 200 ? { ...answer, returned: 1, events: [event("2026-13-45 99:99", "medium")] } : answer;
    },
  };
  assert.deepEqual(summary(await buildTradeDecisionContext(deps(garbledLow), options, now)), ["clear", "trade_ready"]);
});
