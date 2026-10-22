import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { captureNativeBarEvidence } from "../../build/nativeBarCapture.js";
import { TradingView } from "../../build/tradingview.js";

const cutoff = new Date("2026-10-22T12:00:00.000Z");
const initial = { layoutName: "synthetic-layout", activeChartIndex: 0, chartsCount: 2, charts: [
  { index: 0, symbol: "PEPPERSTONE:MXNJPY", resolution: "240", studies: [{ id: "private-study", name: "private" }] },
  { index: 1, symbol: "OANDA:XAUUSD", resolution: "1D", studies: [] },
] };
const targets = initial.charts.map((p) => ({ symbol: p.symbol, chart_index: p.index, expected_timeframe: p.resolution }));
function fixture(hooks = {}) {
  const context = structuredClone(initial), calls = [];
  const tv = {
    getChartContext: async () => structuredClone(context),
    getReplayStatus: async () => ({ available: true, started: hooks.replay === true, toolbarVisible: false }),
    async setResolution(tf, index) {
      calls.push(["change", index, tf]);
      if (hooks.restoreFailure && tf === initial.charts[index].resolution) throw new Error("synthetic restore failure");
      context.charts[index].resolution = tf; context.activeChartIndex = index; return {};
    },
    async getNativeBarSeriesContext(index) {
      const p = context.charts[index]; calls.push(["context", index, p.resolution]);
      const result = { symbol: p.symbol, resolution: p.resolution, context: { symbol: p.symbol, full_name: p.symbol,
        exchange: "synthetic", type: "forex", currency: "JPY", timezone: "Etc/UTC", session: "24x7", subsession_id: "regular",
        pricescale: 1000, minmov: 1, minmove2: 10, fractional: false, chart_style: "candles", adjustment: "not_applicable",
        capture_contract: "native-bar-v1:successor-confirmed" }, provenance: { session_holidays: null, corrections: null } };
      if (hooks.context) hooks.context(result, calls.filter((c) => c[0] === "context").length);
      return result;
    },
    async getOhlcv(count, index) {
      const p = context.charts[index]; calls.push(["bars", index, p.resolution]);
      const step = p.resolution === "1D" ? 86400 : Number(p.resolution) * 60;
      const raw = { symbol: p.symbol, resolution: p.resolution, count, bars: [] };
      const length = hooks.short ? 3 : count;
      raw.bars = Array.from({ length }, (_, i) => {
        const time = cutoff.getTime() / 1000 - (length - 1 - i) * step;
        return { time, timeIso: new Date(time * 1000).toISOString(), open: 100, high: 102, low: 99, close: 101,
          volume: null, forming: i === length - 1 };
      });
      if (hooks.drift && p.resolution === "15") context.charts[1].symbol = "OANDA:USDJPY";
      if (hooks.bars) hooks.bars(raw);
      return raw;
    },
  };
  return { tv, context, calls };
}
test("105-3 synthetic native acquisition binds context around every native read and restores full layout", async () => {
  const f = fixture(); let tick = cutoff.getTime();
  const result = await captureNativeBarEvidence(f.tv, targets, () => new Date(tick++));
  assert.equal(result.series.length, 4); assert.equal(result.restoration_verified, true);
  assert.deepEqual(f.context, initial);
  for (const s of result.series) {
    assert.equal(s.bars.length, 40); assert.equal(s.bars.at(-1).confirmed_by_next_bar_at, cutoff.toISOString());
    assert.equal(s.price_basis, "unknown"); assert.ok(s.observed_at >= result.capture_as_of);
    assert.equal(s.bars[0].volume, null); assert.equal(s.history_shortage, false);
  }
  assert.equal(f.calls.filter((c) => c[0] === "context").length, 10);
  assert.ok(!JSON.stringify(result).includes("private-study"));
  assert.ok(!JSON.stringify(result).includes("execution"));
});
test("105-3 valid short loaded history is retained without fabricated indicators or bars", async () => {
  const f = fixture({ short: true });
  const r = await captureNativeBarEvidence(f.tv, targets, () => cutoff);
  assert.ok(r.series.every((s) => s.bars.length === 2 && s.history_shortage));
  assert.deepEqual(f.context, initial);
});
test("105-3 context drift or missing mandatory context refuses evidence after owned restoration", async () => {
  for (const context of [
    (c, n) => { if (n === 2) c.context.pricescale = 100; },
    (c) => { delete c.context.subsession_id; },
    (c) => { c.context.chart_style = "heikin_ashi"; },
    (c) => { c.resolution = "240"; },
  ]) {
    const f = fixture({ context });
    await assert.rejects(captureNativeBarEvidence(f.tv, targets, () => cutoff));
    assert.deepEqual(f.context, initial);
  }
});
test("105-3 Replay, user changes and restore failure return no persistable bundle", async () => {
  for (const hooks of [{ replay: true }, { drift: true }, { restoreFailure: true }]) {
    const f = fixture(hooks);
    await assert.rejects(captureNativeBarEvidence(f.tv, targets, () => cutoff));
    if (hooks.drift) assert.equal(f.context.charts[1].symbol, "OANDA:USDJPY");
    if (hooks.replay) assert.equal(f.calls.length, 0);
    if (hooks.restoreFailure) assert.ok(f.calls.every((c) => c[1] === 0));
  }
});
test("105-3 source context changes after native reads are caught by final restored-pane check", async () => {
  const f = fixture({ context: (c, n) => { if (n === 9) c.context.minmov = 2; } });
  await assert.rejects(captureNativeBarEvidence(f.tv, targets, () => cutoff), /aborted/);
  assert.deepEqual(f.context, initial);
});

function adapterFixture(patch = {}, style = 1) {
  const info = { full_name: "OANDA:XAUUSD", exchange: "OANDA", type: "commodity", typespecs: ["spot"], currency_code: "USD",
    timezone: "Etc/UTC", session: "24x7", subsession_id: "regular", pricescale: 1000, minmov: 1, minmove2: 10, fractional: false,
    session_holidays: "20261022", corrections: "", ...patch };
  const chart = { symbol: () => "OANDA:XAUUSD", resolution: () => "15", chartModel: () => ({ mainSeries: () => ({
    symbolInfo: () => info, properties: () => ({ childs: () => ({ style: { value: () => style } }) }),
  }) }) };
  const cdp = { evaluate: async (expression) => vm.runInNewContext(expression, { window: { TradingViewApi: { chart: () => chart } } }) };
  return { tv: new TradingView(cdp), info };
}
test("105-3 read-only CDP context adapter reads actual metadata/style; holidays stay provenance", async () => {
  for (const style of [0, 1, 9]) {
    const f = adapterFixture({}, style), a = await f.tv.getNativeBarSeriesContext(0);
    assert.equal(a.context.chart_style, ({ 0: "bars", 1: "candles", 9: "hollow_candles" })[style]);
    assert.equal(a.context.adjustment, "not_applicable");
    f.info.session_holidays = "20261231";
    const b = await f.tv.getNativeBarSeriesContext(0);
    assert.deepEqual(a.context, b.context); assert.notDeepEqual(a.provenance, b.provenance);
  }
});
test("105-3 adapter refuses unreadable/synthetic styles, inferred commodity spot and missing identity fields", async () => {
  for (const style of [undefined, null, 2, 3, 4, 5, 6, 7, 8, 10, "candles"]) {
    const f = adapterFixture({}, style === undefined ? 999 : style);
    await assert.rejects(f.tv.getNativeBarSeriesContext(0), /style/);
  }
  for (const patch of [{ typespecs: [] }, { type: "futures", typespecs: ["spot"] }, { exchange: undefined },
    { subsession_id: undefined }, { minmov: undefined }, { fractional: null }, { full_name: "OANDA:OTHER" },
    { session_holidays: "a".repeat(65537) }]) {
    await assert.rejects(adapterFixture(patch).tv.getNativeBarSeriesContext(0));
  }
});
