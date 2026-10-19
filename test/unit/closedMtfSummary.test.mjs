import test from "node:test";
import assert from "node:assert/strict";
import { buildClosedMtfSummary, summarizeClosedTimeframe } from "../../build/closedMtfSummary.js";

const symbol = "OANDA:EURUSD";
const cutoff = new Date("2030-01-01T00:00:00.000Z");
function series(resolution = "60", n = 201) {
  const step = /^[1]?[DW]$/.test(resolution) ? (resolution.endsWith("W") ? 604800 : 86400) : Number(resolution) * 60;
  return { symbol, resolution, count: n, bars: Array.from({ length: n }, (_, i) => {
    const time = Date.parse("2020-01-01T00:00:00Z") / 1000 + i * step;
    return { time, timeIso: new Date(time * 1000).toISOString(), open: 100 + i, close: 100 + i,
      high: 101 + i, low: 99 + i, volume: null };
  }) };
}
function api({ charts = [{ index: 0, symbol, resolution: "60", studies: [] }], failRead, failRestore, replayAfter, drift } = {}) {
  charts = structuredClone(charts);
  const calls = [], switches = [];
  let reads = 0;
  return { calls, switches, charts,
    async getChartContext() { return { charts: structuredClone(charts), activeChartIndex: 0, chartsCount: charts.length }; },
    async getReplayStatus() { return { available: true, started: replayAfter !== undefined && reads >= replayAfter, toolbarVisible: false }; },
    async setSymbol(next, index) { charts[index].symbol = next; },
    async setResolution(next, index) {
      switches.push(next);
      if (failRestore && switches.length > 1 && next === "60") throw new Error("restore failed");
      charts[index].resolution = next;
    },
    async getOhlcv(count, index) {
      calls.push({ count, index, resolution: charts[index].resolution }); reads++;
      if (failRead === charts[index].resolution) throw new Error("read failed");
      const result = series(charts[index].resolution, count);
      if (drift) charts[index].symbol = "OANDA:USDJPY";
      return result;
    },
  };
}
const options = { symbol, expectedTimeframe: "60", timeframes: ["60"], count: 201 };

test("closed MTF computes seeded indicators on successor-confirmed closes, not the latest bar", () => {
  const result = summarizeClosedTimeframe(series(), symbol, "60", cutoff);
  assert.equal(result.status, "complete");
  assert.equal(result.close, 299);
  assert.deepEqual(result.indicators, { sma20: 289.5, sma50: 274.5, sma200: 199.5, ema20: 289.5, rsi14: 100, atr14: 2 });
  assert.equal(result.history.closed_bars_used, 200);
  assert.equal(result.history.unconfirmed_tail_bars_excluded, 1);
  assert.equal(result.confirmed_by_next_bar_at, series().bars.at(-1).timeIso);
});

test("forming and post-cutoff observations cannot change any closed indicator", () => {
  const input = series();
  input.bars.at(-1).forming = true;
  const at = new Date(input.bars.at(-1).time * 1000 + 1000);
  const before = summarizeClosedTimeframe(input, symbol, "60", at);
  input.bars.at(-1).close = input.bars.at(-1).high = 9999;
  const future = { ...input.bars.at(-1), time: input.bars.at(-1).time + 3600 };
  future.timeIso = new Date(future.time * 1000).toISOString();
  input.bars.push(future);
  const after = summarizeClosedTimeframe(input, symbol, "60", at);
  assert.deepEqual(after.indicators, before.indicators);
  assert.equal(after.close, before.close);
  assert.equal(after.history.future_bars_excluded, 1);
});

test("daily/weekly confirmation follows native successors across DST and closures, never nominal durations", () => {
  for (const resolution of ["D", "W"]) {
    const input = series(resolution, 3);
    const dates = resolution === "D"
      ? ["2026-03-06T22:00:00Z", "2026-03-08T21:00:00Z", "2026-03-09T21:00:00Z"]
      : ["2026-03-01T22:00:00Z", "2026-03-08T21:00:00Z", "2026-03-15T21:00:00Z"];
    for (const [i, date] of dates.entries()) {
      input.bars[i].time = Date.parse(date) / 1000;
      input.bars[i].timeIso = new Date(date).toISOString();
    }
    const result = summarizeClosedTimeframe(input, symbol, `1${resolution}`, cutoff);
    assert.equal(result.history.closed_bars_used, 2);
    assert.equal(result.last_closed_bar_open_at, "2026-03-08T21:00:00.000Z");
    assert.equal(result.confirmed_by_next_bar_at, new Date(dates[2]).toISOString());
  }
});

test("native cadence rejects stale hourly bars merely relabelled as 4H, daily or weekly", () => {
  for (const timeframe of ["240", "1D", "1W"]) {
    const input = { ...series("60"), resolution: timeframe };
    assert.throws(() => summarizeClosedTimeframe(input, symbol, timeframe, cutoff), /cadence/);
  }
  const daily = { ...series("1D"), resolution: "1W" };
  assert.throws(() => summarizeClosedTimeframe(daily, symbol, "1W", cutoff), /cadence/);
});

test("calendar cadence accepts DST shifts and weekly holiday shifts but refuses unproven sparse cadence", () => {
  for (const [tf, intervals] of [["1D", [25, 72, 24]], ["1W", [167, 192, 168]]]) {
    const input = series(tf, 4);
    for (let i = 1; i < input.bars.length; i++) {
      input.bars[i].time = input.bars[i - 1].time + intervals[i - 1] * 3600;
      input.bars[i].timeIso = new Date(input.bars[i].time * 1000).toISOString();
    }
    assert.equal(summarizeClosedTimeframe(input, symbol, tf, cutoff).history.closed_bars_used, 3);
  }
  const sparse = { ...series("240"), resolution: "60" };
  assert.throws(() => summarizeClosedTimeframe(sparse, symbol, "60", cutoff), /cadence/);
});

test("sparse/empty histories stay partial with null metrics; flat and falling RSI are explicit", () => {
  for (const count of [0, 1, 10]) {
    const result = summarizeClosedTimeframe(series("60", count), symbol, "60", cutoff);
    assert.equal(result.status, "partial");
    assert.ok(Object.values(result.indicators).every((value) => value === null));
  }
  for (const [step, expected] of [[0, 50], [-1, 0]]) {
    const input = series("60", 16);
    input.bars.forEach((bar, i) => Object.assign(bar, { open: 100 + i * step, close: 100 + i * step, high: 101 + i * step, low: 99 + i * step }));
    assert.equal(summarizeClosedTimeframe(input, symbol, "60", cutoff).indicators.rsi14, expected);
  }
});

test("malformed, duplicate, unordered and mismatched native evidence is refused", () => {
  for (const change of [
    (r) => { r.symbol = "OANDA:USDJPY"; }, (r) => { r.resolution = "15"; },
    (r) => { r.bars[1] = { ...r.bars[0] }; }, (r) => { r.bars.reverse(); },
    (r) => { r.bars[0].close = NaN; }, (r) => { r.bars[0].timeIso = "bad"; },
    (r) => { r.bars[0].forming = "false"; },
  ]) {
    const input = series(); change(input);
    assert.throws(() => summarizeClosedTimeframe(input, symbol, "60", cutoff));
  }
});

test("mixed RSI and nonlinear EMA/ATR pin both arithmetic seeds and Wilder/EMA updates", () => {
  const rsi = series("60", 18);
  let close = 100;
  rsi.bars.forEach((bar, i) => {
    if (i > 0) close += i <= 14 ? (i % 2 ? 2 : -1) : i === 15 ? 4 : -3;
    Object.assign(bar, { open: close, close, high: close + 1, low: close - 1 });
  });
  const at = (input, n) => summarizeClosedTimeframe({ ...input, bars: input.bars.slice(0, n) }, symbol, "60", cutoff).indicators;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
  assert.equal(at(rsi, 15).rsi14, null);
  near(at(rsi, 16).rsi14, 200 / 3);
  near(at(rsi, 17).rsi14, 3400 / 47);
  near(at(rsi, 18).rsi14, 44200 / 695);
  const ema = series("60", 23);
  ema.bars.forEach((bar, i) => {
    const value = i === 19 ? 120 : i === 20 ? 90 : i === 21 ? 130 : 100;
    Object.assign(bar, { open: value, close: value, high: value + 1, low: value - 1 });
  });
  assert.equal(at(ema, 20).ema20, null);
  near(at(ema, 21).ema20, 101);
  near(at(ema, 22).ema20, 2099 / 21);
  near(at(ema, 23).ema20, 45341 / 441);
  const atr = series("60", 18);
  atr.bars.forEach((bar) => Object.assign(bar, { open: 100, close: 100, high: 101, low: 99 }));
  atr.bars[14].high = 111;
  Object.assign(atr.bars[15], { open: 121, close: 121, high: 123, low: 119 });
  Object.assign(atr.bars[16], { open: 120, close: 120, high: 122, low: 118 });
  assert.equal(at(atr, 15).atr14, null);
  near(at(atr, 16).atr14, 19 / 7);
  near(at(atr, 17).atr14, 204 / 49);
  near(at(atr, 18).atr14, 1424 / 343);
});

test("a forming bar inside a series truncates its entire following suffix", () => {
  const input = series(); input.bars[100].forming = true;
  const result = summarizeClosedTimeframe(input, symbol, "60", cutoff);
  assert.equal(result.history.closed_bars_used, 100);
  assert.equal(result.history.unconfirmed_tail_bars_excluded, 101);
  assert.ok(result.quality_issues.includes("forming_bar_before_end_of_history"));
});

test("missing timeframes preview without OHLC reads or chart mutations", async () => {
  const tv = api();
  const result = await buildClosedMtfSummary(tv, { ...options, timeframes: ["60", "240", "1D"] }, () => cutoff);
  assert.equal(result.status, "confirmation_required");
  assert.deepEqual(result.chart_changes.map((p) => p.temporary_switch), [false, true, true]);
  assert.deepEqual(tv.calls, []); assert.deepEqual(tv.switches, []);
});

test("a data-ready timeout note prevents OHLC acquisition even if the chart reports the target resolution", async () => {
  const tv = api();
  const set = tv.setResolution.bind(tv);
  tv.setResolution = async (resolution, index) => {
    await set(resolution, index);
    return resolution === "240" ? { note: "data-ready callback did not fire within 8s" } : {};
  };
  const result = await buildClosedMtfSummary(tv, { ...options, timeframes: ["240"], confirm: true }, () => cutoff);
  assert.equal(result.status, "partial");
  assert.equal(result.chart_restored, true);
  assert.deepEqual(result.summaries, []);
  assert.deepEqual(tv.calls, []);
  assert.equal(tv.charts[0].resolution, "60");
});

test("an unqualified ticker binds to the selected full symbol and reuses only that listing's panes", async () => {
  const tv = api();
  const result = await buildClosedMtfSummary(tv, { ...options, symbol: "EURUSD" }, () => cutoff);
  assert.equal(result.status, "complete");
  assert.equal(result.symbol, symbol);
  assert.deepEqual(tv.switches, []);
  assert.equal(tv.calls.length, 1);
  const anotherListing = api({ charts: [{ index: 0, symbol, resolution: "60", studies: [] }, { index: 1, symbol: "FX:EURUSD", resolution: "1D", studies: [] }] });
  const preview = await buildClosedMtfSummary(anotherListing, { ...options, symbol: "EURUSD", timeframes: ["1D"] }, () => cutoff);
  assert.equal(preview.status, "confirmation_required");
  assert.equal(preview.chart_changes[0].chart_index, 0);
});

test("timeout notes on both change and rollback block even when the original resolution label is restored", async () => {
  const tv = api();
  const set = tv.setResolution.bind(tv);
  tv.setResolution = async (resolution, index) => {
    await set(resolution, index);
    return { note: "data-ready callback did not fire within 8s" };
  };
  const result = await buildClosedMtfSummary(tv, { ...options, timeframes: ["60", "240", "1D"], confirm: true }, () => cutoff);
  assert.equal(result.status, "blocked");
  assert.equal(result.chart_restored, false);
  assert.deepEqual(result.summaries, []);
  assert.deepEqual(tv.switches, ["240", "60"]);
  assert.equal(tv.calls.length, 1);
  assert.equal(tv.charts[0].resolution, "60");
  assert.ok(result.quality_issues.includes("chart_restore_failed"));
});

test("matching native panes are read without switching and retain one cutoff", async () => {
  const tv = api({ charts: [{ index: 0, symbol, resolution: "60", studies: [] }, { index: 1, symbol, resolution: "D", studies: [] }] });
  let tick = cutoff.getTime();
  const result = await buildClosedMtfSummary(tv, { ...options, timeframes: ["60", "1D"] }, () => new Date(tick += 1000));
  assert.equal(result.status, "complete");
  assert.deepEqual(result.summaries.map((s) => s.chart_index), [0, 1]);
  assert.ok(result.summaries.every((s) => s.as_of === result.as_of));
  assert.deepEqual(tv.switches, []);
});

test("confirmed temporary reads restore the original pane after each timeframe, including failed reads", async () => {
  const tv = api({ failRead: "240" });
  const result = await buildClosedMtfSummary(tv, { ...options, timeframes: ["240", "1D"], confirm: true }, () => cutoff);
  assert.equal(result.status, "partial");
  assert.equal(result.chart_restored, true);
  assert.deepEqual(tv.switches, ["240", "60", "1D", "60"]);
  assert.deepEqual(result.summaries.map((s) => s.timeframe), ["1D"]);
  assert.deepEqual(result.quality_issues, ["timeframe_read_failed:240"]);
});

test("restoration failure stops all remaining reads and discards statistics", async () => {
  const tv = api({ failRestore: true });
  const result = await buildClosedMtfSummary(tv, { ...options, timeframes: ["240", "1D"], confirm: true }, () => cutoff);
  assert.equal(result.status, "blocked"); assert.equal(result.chart_restored, false);
  assert.deepEqual(result.summaries, []); assert.equal(tv.calls.length, 1);
  assert.ok(result.quality_issues.includes("chart_restore_failed"));
});

test("Replay, wrong chart binding, or binding drift never yields an accepted summary", async () => {
  await assert.rejects(buildClosedMtfSummary(api({ replayAfter: 0 }), options, () => cutoff), /Replay/);
  await assert.rejects(buildClosedMtfSummary(api(), { ...options, symbol: "OANDA:USDJPY" }, () => cutoff), /symbol/);
  for (const settings of [{ replayAfter: 1 }, { drift: true }]) {
    const result = await buildClosedMtfSummary(api(settings), options, () => cutoff);
    assert.equal(result.status, "blocked"); assert.deepEqual(result.summaries, []);
  }
});

test("Replay starting during a temporary read restores once but stops all later timeframe changes", async () => {
  const tv = api({ replayAfter: 1 });
  const result = await buildClosedMtfSummary(tv, { ...options, timeframes: ["240", "1D"], confirm: true }, () => cutoff);
  assert.equal(result.status, "blocked"); assert.deepEqual(result.summaries, []);
  assert.deepEqual(tv.switches, ["240", "60"]);
  assert.equal(tv.calls.length, 1);
});

test("duplicate and unsupported frames or invalid counts fail before chart access", async () => {
  for (const patch of [{ timeframes: ["60", "60"] }, { timeframes: ["1M"] }, { timeframes: [] }, { count: 1001 }, { count: 1 }]) {
    await assert.rejects(buildClosedMtfSummary({}, { ...options, ...patch }, () => cutoff));
  }
});
