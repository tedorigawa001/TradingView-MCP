import test from "node:test";
import assert from "node:assert/strict";
import { buildOhlcvKeyLevels, extractOhlcvKeyLevels, OHLCV_KEY_LEVEL_RULE } from "../../build/ohlcvKeyLevels.js";

const symbol = "OANDA:EURUSD";
const cutoff = new Date("2030-01-01T00:00:00.000Z");
function series(n = 20, resolution = "60") {
  const step = resolution === "1D" ? 86400 : resolution === "1W" ? 604800 : Number(resolution) * 60;
  return { symbol, resolution, count: n, bars: Array.from({ length: n }, (_, i) => {
    const time = Date.parse("2020-01-01T00:00:00Z") / 1000 + i * step;
    return { time, timeIso: new Date(time * 1000).toISOString(), open: 99.8, high: 99.9, low: 99.7, close: 99.8, volume: null };
  }) };
}
const extract = (input, options) => extractOhlcvKeyLevels(input, symbol, input.resolution, cutoff, options);
function shift(input, index, seconds) {
  for (const bar of input.bars.slice(index)) { bar.time += seconds; bar.timeIso = new Date(bar.time * 1000).toISOString(); }
}
function visits() {
  const input = series(16);
  input.bars[3].high = 100;
  for (const index of [7, 8, 10, 12, 14]) input.bars[index].high = 100;
  for (const index of [11, 13]) Object.assign(input.bars[index], { open: 100.25, high: 100.3, low: 100.2, close: 100.25 });
  return input;
}

test("OHLC levels freeze strict 3/3 pivots and wait for the last right bar's native successor", () => {
  assert.equal(Object.isFrozen(OHLCV_KEY_LEVEL_RULE), true);
  assert.deepEqual(OHLCV_KEY_LEVEL_RULE, { version: "ohlcv_swing_levels_v1.1", left_bars: 3, right_bars: 3, merge_tolerance_bps: 5, touch_half_width_bps: 5 });
  const input = series(8);
  input.bars[3].high = 100; input.bars[3].low = 99.6;
  const before = extractOhlcvKeyLevels(input, symbol, "60", new Date(input.bars[7].time * 1000 - 1));
  assert.equal(before.counts.source_pivots, 0);
  const at = extractOhlcvKeyLevels(input, symbol, "60", new Date(input.bars[7].time * 1000));
  assert.equal(at.counts.source_pivots, 2);
  assert.equal(at.status, "complete");
  assert.deepEqual(at.levels.map((row) => row.kind).sort(), ["swing_high", "swing_low"]);
  for (const row of at.levels) {
    assert.equal(row.known_at, input.bars[7].timeIso);
    assert.equal(row.origins[0].bar_open_at, input.bars[3].timeIso);
    assert.equal(row.touch_episodes, 0); assert.equal(row.observation_from, null);
  }
  assert.equal(at.reference.price, 99.8);
  assert.equal(at.history.closed_bars_used, 7);
});

test("equal neighbouring extrema and unconfirmed right flanks do not create levels", () => {
  for (const equal of [0, 2, 4, 6]) {
    const input = series(8); input.bars[3].high = input.bars[equal].high = 100;
    assert.equal(extract(input).counts.source_pivots, 0);
  }
  const tail = series(9); tail.bars[5].high = 100;
  assert.equal(extract(tail).counts.source_pivots, 0);
});

test("touch episodes start only after a level is known; rejections, crossings and open visits stay separate", () => {
  const input = visits(), result = extract(input);
  assert.equal(result.counts.source_pivots, 1);
  const row = result.levels[0];
  assert.equal(row.price, 100); assert.deepEqual(row.zone, { lower: 99.95, upper: 100.05 });
  assert.equal(row.observation_from, input.bars[7].timeIso);
  assert.equal(row.touch_episodes, 4); assert.equal(row.confirmed_rejections, 2);
  assert.equal(row.cross_through_episodes, 1); assert.equal(row.open_touch_episode, true);
  assert.equal(row.last_touch_bar_open_at, input.bars[14].timeIso);
  assert.equal(row.last_touch_confirmed_at, input.bars[15].timeIso);
  assert.equal(row.last_rejection_bar_open_at, input.bars[13].timeIso);
  assert.equal(row.last_rejection_confirmed_at, input.bars[14].timeIso);
  assert.ok(Math.abs(row.distance_bps - (100 / 99.8 - 1) * 10000) < 1e-12);
  assert.equal(row.relative_to_reference_close, "above");
});

test("a touch with no outside approach is not called a rejection", () => {
  const input = series(10); input.bars[3].high = 100;
  input.bars[6].close = input.bars[6].high = 99.96;
  input.bars[7].high = 100;
  const row = extract(input).levels[0];
  assert.equal(row.touch_episodes, 1); assert.equal(row.confirmed_rejections, 0); assert.equal(row.cross_through_episodes, 0);
});

test("swing-low visits mirror swing-high rejections and crossings without reversing the observations", () => {
  const input = visits();
  for (const bar of input.bars) {
    const old = { ...bar };
    Object.assign(bar, { open: 200 - old.open, close: 200 - old.close, high: 200 - old.low, low: 200 - old.high });
  }
  const result = extract(input), row = result.levels[0];
  assert.equal(result.counts.source_pivots, 1); assert.equal(row.kind, "swing_low");
  assert.equal(row.price, 100); assert.equal(row.relative_to_reference_close, "below");
  assert.equal(row.touch_episodes, 4); assert.equal(row.confirmed_rejections, 2); assert.equal(row.cross_through_episodes, 1);
  assert.equal(row.last_touch_bar_open_at, input.bars[14].timeIso);
});

test("mixed high/low origins can merge, but retain their kind, price and individual confirmation", () => {
  const input = series(17); input.bars[3].high = 100;
  for (const bar of input.bars.slice(7, 14)) Object.assign(bar, { open: 100.3, high: 100.4, low: 100.2, close: 100.3 });
  input.bars[10].low = 100.04;
  const result = extract(input);
  assert.equal(result.counts.source_pivots, 2); assert.equal(result.counts.level_candidates, 1);
  const row = result.levels[0];
  assert.equal(row.kind, "mixed_swings"); assert.equal(row.price, 100);
  assert.deepEqual(row.origins.map((origin) => origin.kind), ["swing_high", "swing_low"]);
  assert.deepEqual(row.origins.map((origin) => origin.price), [100, 100.04]);
  assert.deepEqual(row.origins.map((origin) => origin.confirmed_at), [input.bars[7].timeIso, input.bars[14].timeIso]);
});

test("causal seed merging never moves the earliest price and cannot chain through a later origin", () => {
  const input = series(24);
  input.bars[3].high = 100; input.bars[10].high = 100.04; input.bars[17].high = 100.08;
  const result = extract(input);
  assert.equal(result.counts.source_pivots, 3); assert.equal(result.counts.level_candidates, 2);
  const seed = result.levels.find((row) => row.price === 100);
  assert.equal(seed.pivot_count, 2); assert.deepEqual(seed.origins.map((row) => row.price), [100, 100.04]);
  assert.equal(seed.known_at, input.bars[7].timeIso);
  assert.equal(result.levels.find((row) => row.price === 100.08).pivot_count, 1);
  assert.deepEqual(input.bars[3].high, 100, "input is not mutated");
});

test("a pivot matching several seeds joins the nearest seed, not the last origin", () => {
  const input = series(24);
  input.bars[3].high = 100; input.bars[10].high = 100.08; input.bars[17].high = 100.045;
  const result = extract(input);
  assert.equal(result.levels.find((row) => row.price === 100).pivot_count, 1);
  assert.equal(result.levels.find((row) => row.price === 100.08).pivot_count, 2);
});

test("inclusive merge/touch boundaries and exact equidistant ties follow the frozen rule", () => {
  const scaled = (n) => {
    const input = series(n);
    for (const bar of input.bars) Object.assign(bar, { open: 998.7, high: 998.8, low: 998.6, close: 998.7 });
    return input;
  };
  for (const [price, groups] of [[1000.5, 1], [1000.5000001, 2]]) {
    const input = scaled(16); input.bars[3].high = 1000; input.bars[10].high = price;
    assert.equal(extract(input).counts.level_candidates, groups);
  }
  for (const touching of [{ open: 1000.55, high: 1000.6, low: 1000.5, close: 1000.55 },
    { open: 999.45, high: 999.5, low: 999.4, close: 999.45 }]) {
    const input = scaled(10); input.bars[3].high = 1000; Object.assign(input.bars[7], touching);
    assert.equal(extract(input).levels.find((row) => row.price === 1000).touch_episodes, 1);
  }
  const tied = scaled(24); tied.bars[3].high = 1000; tied.bars[10].high = 1000.75; tied.bars[17].high = 1000.375;
  const result = extract(tied);
  assert.equal(result.levels.find((row) => row.price === 1000).pivot_count, 2);
  assert.equal(result.levels.find((row) => row.price === 1000.75).pivot_count, 1);
});

test("forming and post-cutoff changes never affect extracted levels or reference prices", () => {
  const input = visits(); input.bars[15].forming = true;
  const at = new Date(input.bars[15].time * 1000 + 1000);
  const before = extractOhlcvKeyLevels(input, symbol, "60", at);
  Object.assign(input.bars[15], { high: 999, close: 900 });
  const future = { ...input.bars[15], time: input.bars[15].time + 3600 };
  future.timeIso = new Date(future.time * 1000).toISOString(); input.bars.push(future);
  const after = extractOhlcvKeyLevels(input, symbol, "60", at);
  assert.deepEqual(after.levels, before.levels); assert.deepEqual(after.reference, before.reference);
  assert.equal(after.history.future_bars_excluded, 1); assert.equal(after.history.forming_bars_excluded, 1);
});

test("an early forming bar cuts off all following observations", () => {
  const input = visits(); input.bars[9].forming = true;
  const result = extract(input), row = result.levels[0];
  assert.equal(result.history.closed_bars_used, 9); assert.equal(result.status, "partial");
  assert.equal(row.touch_episodes, 1); assert.equal(row.confirmed_rejections, 0);
  assert.equal(row.last_touch_bar_open_at, input.bars[8].timeIso);
  assert.ok(result.quality_issues.includes("forming_bar_before_end_of_history"));
});

test("native gaps refuse pivot windows including the confirmation boundary", () => {
  for (const gapAt of [1, 5, 7]) {
    const input = series(8); input.bars[3].high = 100; shift(input, gapAt, 3600 * 48);
    const result = extract(input);
    assert.equal(result.counts.source_pivots, 0); assert.equal(result.history.pivot_windows_excluded_by_gaps, 1);
    assert.equal(result.history.native_gap_intervals, 1); assert.equal(result.status, "partial");
  }
});

test("visits never imply a rejection across gaps and touching after a gap starts a new episode", () => {
  const input = visits(); shift(input, 8, 3600 * 48);
  const result = extract(input), row = result.levels.find((row) => row.price === 100);
  assert.equal(row.touch_episodes, 5);
  assert.equal(row.confirmed_rejections, 1, "the renewed touch has no known approach across the gap");
  assert.equal(row.cross_through_episodes, 1);
  const departureGap = visits(); shift(departureGap, 9, 3600 * 48);
  assert.equal(extract(departureGap).levels.find((row) => row.price === 100).confirmed_rejections, 1);
});

test("daily and weekly pivots use successor confirmation; DST shifts do not break a window", () => {
  for (const tf of ["1D", "1W"]) {
    const input = series(8, tf); input.bars[3].high = 100; shift(input, 5, -3600);
    const row = extract(input).levels[0];
    assert.equal(row.known_at, input.bars[7].timeIso);
    assert.equal(row.touch_episodes, 0);
  }
});

test("calendar-native pivots survive ordinary session gaps but report them instead of claiming contiguous coverage", () => {
  for (const tf of ["1D", "1W"]) {
    const input = series(12, tf); input.bars[3].high = 100;
    input.bars[7].high = input.bars[8].high = 100;
    if (tf === "1D") {
      const monday = Date.parse("2026-10-05T21:00:00.000Z") / 1000;
      for (const [i, bar] of input.bars.entries()) {
        bar.time = monday + (i + Math.floor(i / 5) * 2) * 86400;
        bar.timeIso = new Date(bar.time * 1000).toISOString();
      }
    } else shift(input, 5, 604800 * 2);
    const result = extract(input);
    assert.equal(result.counts.source_pivots, 1, "a calendar pivot is defined over observed native bars, not calendar days");
    assert.equal(result.levels[0].price, 100);
    assert.equal(result.levels[0].known_at, input.bars[7].timeIso);
    assert.equal(result.levels[0].touch_episodes, 1);
    assert.equal(result.levels[0].confirmed_rejections, 1);
    assert.equal(result.history.pivot_windows_excluded_by_gaps, 0);
    assert.equal(result.history.pivot_windows_spanning_gaps, 5);
    assert.equal(result.status, "partial");
    assert.deepEqual(result.quality_issues, ["calendar_pivot_windows_span_timestamp_gaps"]);
    const confirmationGap = series(8, tf); confirmationGap.bars[3].high = 100;
    shift(confirmationGap, 7, tf === "1D" ? 2 * 86400 : 2 * 604800);
    const atBoundary = extract(confirmationGap);
    assert.equal(atBoundary.counts.source_pivots, 1);
    assert.equal(atBoundary.history.pivot_windows_spanning_gaps, 1);
    assert.equal(atBoundary.levels[0].known_at, confirmationGap.bars[7].timeIso);
    assert.equal(atBoundary.levels[0].touch_episodes, 0);
  }
});

test("calendar-native visits still cannot confirm rejections across a gap", () => {
  for (const tf of ["1D", "1W"]) {
    for (const gapAt of [8, 9]) {
      const input = visits(), clock = series(input.bars.length, tf);
      input.resolution = tf;
      for (const [index, bar] of input.bars.entries()) Object.assign(bar, { time: clock.bars[index].time, timeIso: clock.bars[index].timeIso });
      shift(input, gapAt, tf === "1D" ? 2 * 86400 : 2 * 604800);
      const row = extract(input).levels.find((level) => level.price === 100);
      assert.equal(row.touch_episodes, gapAt === 8 ? 5 : 4);
      assert.equal(row.confirmed_rejections, 1);
      assert.equal(row.cross_through_episodes, 1);
    }
  }
});

test("range/limit selection exposes pre-filter denominators and nearest-first ordering", () => {
  const input = series(24);
  input.bars[3].high = 100; input.bars[10].high = 101; input.bars[17].high = 104;
  const result = extract(input, { rangePercent: 2, limit: 1 });
  assert.deepEqual(result.counts, { source_pivots: 3, level_candidates: 3, levels_in_range: 2,
    excluded_by_range: 1, excluded_by_limit: 1, returned_levels: 1 });
  assert.equal(result.levels[0].price, 100); assert.equal(result.candidateEligible, false);
  assert.equal(JSON.stringify(result).includes('"bars"'), false);
  const none = extract(input, { rangePercent: 0.01 });
  assert.equal(none.levels.length, 0); assert.equal(none.counts.excluded_by_range, 3); assert.equal(none.status, "complete");
});

test("short histories are partial but sufficiently long flat histories can honestly have zero levels", () => {
  for (const n of [0, 1, 6, 7]) {
    const result = extract(series(n));
    assert.equal(result.status, "partial"); assert.equal(result.counts.source_pivots, 0);
  }
  assert.equal(extract(series(8)).status, "complete");
  assert.equal(extract(series(8)).levels.length, 0);
  assert.equal(extract(series(1)).reference.price, null);
});

test("malformed, mismatched, unordered, oversized and stale-cadence OHLC is refused", () => {
  for (const change of [
    (x) => { x.symbol = "OANDA:USDJPY"; }, (x) => { x.resolution = "240"; },
    (x) => { x.bars[2].high = NaN; }, (x) => { x.bars[2].low = 101; },
    (x) => { x.bars[2].timeIso = "2020-01-01T00:00:00Z"; },
    (x) => { x.bars[2].time = x.bars[1].time; },
  ]) { const input = series(); change(input); assert.throws(() => extractOhlcvKeyLevels(input, symbol, "60", cutoff)); }
  assert.throws(() => extract(series(1001)), /1000/);
  const stale = series(); stale.resolution = "240";
  assert.throws(() => extract(stale), /cadence/);
  for (const options of [{ rangePercent: 0 }, { rangePercent: Infinity }, { limit: 101 }, { limit: 1.5 }]) {
    assert.throws(() => extract(series(), options));
  }
  assert.throws(() => extractOhlcvKeyLevels(series(), symbol, "60", new Date(NaN)), /cutoff/);
  const overflow = series(8); overflow.bars[3].high = Number.MAX_VALUE;
  assert.throws(() => extract(overflow), /non-finite/);
});

function api({ replay = false, unavailable = false, drift, throwRead = false, responseSymbol = symbol } = {}) {
  const calls = []; let reads = 0;
  const chart = { index: 1, symbol, resolution: "60", studies: [] };
  return { calls, chart,
    async getChartContext() { calls.push("context"); return { activeChartIndex: 1, chartsCount: 1, charts: [{ ...chart }] }; },
    async getReplayStatus() { calls.push("replay"); return { available: !unavailable, started: replay || drift === "replay" && reads > 0, toolbarVisible: false }; },
    async getOhlcv(count, index) {
      calls.push({ count, index }); reads++;
      if (throwRead) throw new Error("read failed");
      if (drift === "symbol") chart.symbol = "OTHER:EURUSD";
      if (drift === "resolution") chart.resolution = "240";
      return { ...visits(), symbol: responseSymbol };
    },
  };
}
const options = { symbol: "EURUSD", expectedTimeframe: "60" };

test("read-only acquisition binds the selected full listing, fixes cutoff and never changes the chart", async () => {
  const tv = api(); let ticks = 0;
  const result = await buildOhlcvKeyLevels(tv, options, () => new Date(cutoff.getTime() + ticks++ * 1000));
  assert.equal(result.symbol, symbol); assert.equal(result.chart_index, 1); assert.equal(result.requested_bars, 500);
  assert.equal(result.chart_changes, false); assert.equal(result.as_of, cutoff.toISOString());
  assert.equal(result.observed_at, new Date(cutoff.getTime() + 1000).toISOString());
  assert.equal(result.levels[0].touch_episodes, 4);
  assert.deepEqual(tv.calls.filter((call) => typeof call === "object"), [{ count: 500, index: 1 }]);
});

test("Replay, chart drift and wrong OHLC feed all refuse output", async () => {
  for (const mode of [{ replay: true }, { unavailable: true }, { drift: "replay" }, { drift: "symbol" }, { drift: "resolution" }, { responseSymbol: "OTHER:EURUSD" }, { throwRead: true }]) {
    await assert.rejects(buildOhlcvKeyLevels(api(mode), options, () => cutoff));
  }
  for (const patch of [{ symbol: "OTHER:EURUSD" }, { expectedTimeframe: "240" }, { chartIndex: 0 }]) {
    const tv = api(); await assert.rejects(buildOhlcvKeyLevels(tv, { ...options, ...patch }, () => cutoff));
    assert.equal(tv.calls.some((call) => typeof call === "object"), false);
  }
});

test("direct acquisition validates options before any chart or replay access", async () => {
  for (const patch of [{ count: 7 }, { count: 1001 }, { count: NaN }, { rangePercent: 0 }, { limit: 0 }, { expectedTimeframe: "1M" }]) {
    const tv = api(); await assert.rejects(buildOhlcvKeyLevels(tv, { ...options, ...patch }, () => cutoff));
    assert.deepEqual(tv.calls, []);
  }
});
