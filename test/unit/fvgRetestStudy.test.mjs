import assert from "node:assert/strict";
import test from "node:test";
import { runFvgRetestStudy } from "../../build/fvgRetestStudy.js";

const HOUR = 3_600_000;

function bars(start, ohlcList) {
  return ohlcList.map(([open, high, low, close], index) => {
    const time = (start + index * HOUR) / 1000;
    return {
      time,
      timeIso: new Date(time * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 1000,
    };
  });
}

function baseInput(ohlcBars, overrides = {}) {
  return {
    bars: ohlcBars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    minimumGapBps: 10,
    retestWithinBars: 12,
    minImpulseBodyRatio: 0.5,
    requireBoundaryHold: true,
    horizons: [1, 2, 4],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: null,
    regime: null,
    ...overrides,
  };
}

test("fvgRetestStudy detects a bullish Fair Value Gap retest and computes long outcomes", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  // bar0: [100, 100.2, 99.8, 100] (Bar 1, high: 100.2)
  // bar1: [100.3, 101.8, 100.2, 101.6] (Bar 2 impulse! body 1.3 / range 1.6 = 0.8125 >= 0.5, bullish)
  // bar2: [101.7, 103, 101.4, 102.8] (Bar 3, low: 101.4 -> gap between 100.2 and 101.4 is 120 bps >= 10 bps)
  // bar3: [102.8, 103, 102.5, 102.7] (no retest yet)
  // bar4: [102.7, 102.8, 100.5, 101] (retest! low 100.5 <= fvgTop 101.4, close 101 >= fvgBottom 100.2)
  // bar5: [101, 102.5, 100.8, 102.2] (forward outcome 1)
  // bar6: [102.2, 104, 102, 103.8] (forward outcome 2)
  const ohlc = [
    [100, 100.2, 99.8, 100],
    [100.3, 101.8, 100.2, 101.6],
    [101.7, 103, 101.4, 102.8],
    [102.8, 103, 102.5, 102.7],
    [102.7, 102.8, 100.5, 101],
    [101, 102.5, 100.8, 102.2],
    [102.2, 104, 102, 103.8],
  ];

  const result = runFvgRetestStudy(baseInput(bars(start, ohlc)));
  assert.equal(result.schemaVersion, "1.0");
  assert.equal(result.methodologyVersion, "fvg_retest_event_study_v1");
  assert.equal(result.status, "partial"); // minimum_event_count_not_met or folds < 2
  assert.equal(result.sample.events, 1);
  assert.equal(result.events[0].branch, "fvg_retest_bullish");
  assert.equal(result.events[0].direction, "long");
  assert.equal(result.events[0].fvgBottom, 100.2);
  assert.equal(result.events[0].fvgTop, 101.4);
  assert.ok(result.byBranch.fvg_retest_bullish.horizons["2"].directionalReturn.mean > 0);
});

test("fvgRetestStudy detects a bearish Fair Value Gap retest and computes short outcomes", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  // bar0: [100, 100.2, 99.8, 100] (Bar 1, low: 99.8)
  // bar1: [99.7, 99.8, 98.2, 98.4] (Bar 2 impulse! body 1.3 / range 1.6 = 0.8125 >= 0.5, bearish)
  // bar2: [98.3, 98.6, 97, 97.2] (Bar 3, high: 98.6 -> gap between 99.8 and 98.6 is 120 bps >= 10 bps)
  // bar3: [97.2, 97.5, 97, 97.3] (no retest)
  // bar4: [97.3, 99.5, 97.1, 98.8] (retest! high 99.5 >= fvgBottom 98.6, close 98.8 <= fvgTop 99.8)
  // bar5: [98.8, 99, 97, 97.5] (forward outcome 1)
  const ohlc = [
    [100, 100.2, 99.8, 100],
    [99.7, 99.8, 98.2, 98.4],
    [98.3, 98.6, 97, 97.2],
    [97.2, 97.5, 97, 97.3],
    [97.3, 99.5, 97.1, 98.8],
    [98.8, 99, 97, 97.5],
  ];

  const result = runFvgRetestStudy(baseInput(bars(start, ohlc)));
  assert.equal(result.sample.events, 1);
  assert.equal(result.events[0].branch, "fvg_retest_bearish");
  assert.equal(result.events[0].direction, "short");
  assert.equal(result.events[0].fvgBottom, 98.6);
  assert.equal(result.events[0].fvgTop, 99.8);
  assert.ok(result.byBranch.fvg_retest_bearish.horizons["1"].directionalReturn.mean > 0);
});

test("fvgRetestStudy rejects gaps smaller than minimumGapBps and weak impulse body ratios on middle bar", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const smallGapOhlc = [
    [100, 100.2, 99.8, 100],
    [100.1, 100.5, 100, 100.4],
    [100.21, 100.5, 100.205, 100.4], // gap is ~0.5 bps < 10 bps
    [100.4, 100.5, 100.1, 100.3],
    [100.3, 100.4, 100.1, 100.2],
  ];
  const smallGapResult = runFvgRetestStudy(baseInput(bars(start, smallGapOhlc), { minimumGapBps: 10 }));
  assert.equal(smallGapResult.sample.events, 0);
  assert.equal(smallGapResult.quality.fvgFormed, 0);

  const dojiImpulseOhlc = [
    [100, 100.2, 99.8, 100],
    [100.1, 105, 100, 100.2], // doji / weak body ratio on middle bar (0.1 / 5 = 0.02 < 0.5)
    [101.5, 105, 101.4, 102.8],
    [101.6, 102, 100.5, 101],
    [101, 101.5, 100.8, 101.2],
  ];
  const dojiResult = runFvgRetestStudy(baseInput(bars(start, dojiImpulseOhlc), { minImpulseBodyRatio: 0.5 }));
  assert.equal(dojiResult.sample.events, 0);
  assert.equal(dojiResult.quality.fvgFormed, 0);
});

test("fvgRetestStudy tracks boundary hold failures when requireBoundaryHold is enabled", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  // Bullish FVG bottom 100.2, top 101.4. Retest bar closes at 99.5 (< fvgBottom 100.2 -> broken!)
  const brokenOhlc = [
    [100, 100.2, 99.8, 100],
    [100.3, 101.8, 100.2, 101.6],
    [101.7, 103, 101.4, 102.8],
    [102.8, 103, 99, 99.5], // retests and closes below fvgBottom
    [99.5, 100, 99.2, 99.8],
  ];

  const failedResult = runFvgRetestStudy(baseInput(bars(start, brokenOhlc), { requireBoundaryHold: true }));
  assert.equal(failedResult.sample.events, 0);
  assert.equal(failedResult.quality.boundaryHoldFailed, 1);
});
