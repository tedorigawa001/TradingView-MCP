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
  assert.equal(result.methodologyVersion, "fvg_retest_event_study_v2");
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

test("fvgRetestStudy applies an inclusive signal start, exclusive signal end, and one branch before aggregation", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const ohlc = [
    [100, 100.2, 99.8, 100],
    [99.7, 99.8, 98.2, 98.4],
    [98.3, 98.6, 97, 97.2],
    [97.2, 97.5, 97, 97.3],
    [97.3, 99.5, 97.1, 98.8],
    [98.8, 99, 97, 97.5],
  ];
  const signalTime = new Date(start + 4 * HOUR).toISOString();
  const afterSignal = new Date(start + 5 * HOUR).toISOString();

  const selected = runFvgRetestStudy(baseInput(bars(start, ohlc), {
    signalFrom: signalTime,
    signalTo: afterSignal,
    branchFilter: "bearish",
  }));
  assert.equal(selected.sample.events, 1);
  assert.deepEqual(Object.keys(selected.byBranch), ["fvg_retest_bearish"]);
  assert.equal(selected.selectionContract.signalFrom, signalTime);
  assert.equal(selected.selectionContract.signalTo, afterSignal);
  assert.equal(selected.selectionContract.branch, "bearish");

  const excludedAtEnd = runFvgRetestStudy(baseInput(bars(start, ohlc), {
    signalTo: signalTime,
    branchFilter: "bearish",
  }));
  assert.equal(excludedAtEnd.sample.events, 0);
  assert.equal(excludedAtEnd.quality.signalAtOrAfterWindowExcluded, 1);

  const excludedByBranch = runFvgRetestStudy(baseInput(bars(start, ohlc), {
    signalFrom: signalTime,
    branchFilter: "bullish",
  }));
  assert.equal(excludedByBranch.sample.events, 0);
  assert.equal(excludedByBranch.quality.branchExcluded, 1);
});

test("fvgRetestStudy filters events by the latest regime bar closed before the signal", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const descending = Array.from({ length: 18 }, (_, index) => {
    const close = 110 - index * 0.5;
    return [close + 0.2, close + 1, close - 1, close];
  });
  const ohlc = [
    ...descending,
    [101.2, 101.3, 100.7, 101],
    [100.8, 100.9, 98.8, 99],
    [98.8, 99.2, 98.2, 98.4],
    [98.4, 98.6, 97.9, 98.1],
    [98.1, 100.8, 97.9, 100.5],
    [100.5, 100.6, 99.2, 99.4],
    [99.4, 99.5, 98.4, 98.7],
  ];
  const regime = {
    trendLookback: 5,
    atrLookback: 2,
    volatilityBaselineLookback: 5,
    trendEfficiencyThreshold: 0.5,
    rangeEfficiencyThreshold: 0.2,
    directionalMoveAtrThreshold: 0.5,
    highVolatilityRatio: 1.5,
    lowVolatilityRatio: 0.75,
    minimumClassifiedBars: 1,
    minimumGroupEvents: 1,
    minimumCoverageRatio: 0.8,
    maxRegimeAgeBars: 1,
  };

  const selected = runFvgRetestStudy(baseInput(bars(start, ohlc), {
    branchFilter: "bearish",
    regime,
    regimeFilter: { directional: "trend_down" },
  }));
  assert.equal(selected.sample.events, 1);
  assert.equal(selected.quality.regimeMismatchExcluded, 0);
  assert.equal(selected.selectionContract.regime.directional, "trend_down");

  const rejected = runFvgRetestStudy(baseInput(bars(start, ohlc), {
    branchFilter: "bearish",
    regime,
    regimeFilter: { directional: "trend_up" },
  }));
  assert.equal(rejected.sample.events, 0);
  assert.equal(rejected.quality.regimeMismatchExcluded, 1);
});

test("fvgRetestStudy rejects invalid prospective selection contracts", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const ohlc = [
    [100, 100.2, 99.8, 100],
    [99.7, 99.8, 98.2, 98.4],
    [98.3, 98.6, 97, 97.2],
    [97.2, 97.5, 97, 97.3],
    [97.3, 99.5, 97.1, 98.8],
    [98.8, 99, 97, 97.5],
  ];

  assert.throws(() => runFvgRetestStudy(baseInput(bars(start, ohlc), {
    signalFrom: "2026-01-01T00:00:00+00:00",
  })), /signal_from must be a canonical ISO timestamp/);
  assert.throws(() => runFvgRetestStudy(baseInput(bars(start, ohlc), {
    signalFrom: "2026-01-02T00:00:00.000Z",
    signalTo: "2026-01-01T00:00:00.000Z",
  })), /signal_to must be after signal_from/);
  assert.throws(() => runFvgRetestStudy(baseInput(bars(start, ohlc), {
    regimeFilter: { directional: "trend_down" },
  })), /regime_filter requires regime configuration/);
});

// One wide bar can be the first retest of both a bullish and a bearish gap. Bar 8 below is that
// bar: it dips into the bullish zone [100, 101] and reaches into the bearish zone [105, 106].
const contestedSignalOhlc = [
  [99.5, 100, 99, 99.8],          // 0  bar 1 of the bullish gap
  [100.1, 101.6, 100.0, 101.5],   // 1  bullish impulse
  [101.5, 102, 101, 101.55],      // 2  bar 3 of the bullish gap -> zone [100, 101]
  [106.5, 107, 106, 106.4],       // 3  bar 1 of the bearish gap
  [106.4, 106.5, 104.5, 104.6],   // 4  bearish impulse
  [104.6, 105, 104, 104.8],       // 5  bar 3 of the bearish gap -> zone [105, 106]
  [104.5, 104.8, 104.2, 104.6],   // 6  touches neither zone
  [104.5, 104.8, 104.2, 104.6],   // 7  touches neither zone
  [104.5, 106, 100, 101],         // 8  first retest of both gaps
  ...Array.from({ length: 8 }, () => [101, 101.5, 100.5, 101]),
];

const contestedInput = (ohlcBars, overrides = {}) => baseInput(ohlcBars, {
  minimumGapBps: 1, retestWithinBars: 20, requireBoundaryHold: false, horizons: [1, 2], ...overrides,
});

test("fvgRetestStudy claims a signal bar per branch, so a bullish gap cannot consume a bearish one", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const all = bars(start, contestedSignalOhlc);
  const signalFrom = new Date(start + 8 * HOUR).toISOString();

  // Same frozen prospective window, same direction; only the amount of history before it differs.
  const withPriorHistory = runFvgRetestStudy(contestedInput(all, {
    signalFrom, branchFilter: "bearish",
  }));
  const withoutPriorHistory = runFvgRetestStudy(contestedInput(all.slice(3), {
    signalFrom, branchFilter: "bearish",
  }));

  // A study frozen to one direction must not lose events to the other one, and its sample must not
  // depend on how far back the loaded window happens to start.
  assert.equal(withPriorHistory.sample.events, withoutPriorHistory.sample.events);
  assert.deepEqual(
    withPriorHistory.events.map((event) => event.signalTime),
    withoutPriorHistory.events.map((event) => event.signalTime));
  assert.equal(withPriorHistory.quality.overlappingSignalsExcludedByBranch.fvg_retest_bearish, 0);
});

test("fvgRetestStudy still excludes a same-branch competitor and attributes it to that branch", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const ohlc = [
    [99.5, 100, 99, 99.8],          // 0  bar 1 of the first bullish gap
    [100.1, 101.6, 100.0, 101.5],   // 1  bullish impulse
    [101.2, 102, 101, 101.8],       // 2  bar 3 -> zone [100, 101]
    [101.6, 102, 101.5, 101.9],     // 3  bar 1 of the second bullish gap
    [102, 103.6, 101.9, 103.5],     // 4  bullish impulse
    [103.2, 103.8, 103, 103.6],     // 5  bar 3 -> zone [102, 103]
    [103.5, 104, 103.2, 103.55],    // 6  touches neither zone
    [103.5, 104, 103.2, 103.55],    // 7  touches neither zone
    [103.5, 103.6, 100.5, 101],     // 8  first retest of both bullish gaps
    ...Array.from({ length: 8 }, () => [101, 101.5, 100.5, 101]),
  ];
  const result = runFvgRetestStudy(contestedInput(bars(start, ohlc), { branchFilter: "bullish" }));

  // Two bullish gaps cannot both be measured at one signal bar; the loser is counted under bullish.
  assert.equal(result.quality.overlappingSignalsExcludedByBranch.fvg_retest_bullish, 1);
  assert.equal(result.quality.overlappingSignalsExcludedByBranch.fvg_retest_bearish, 0);
  assert.equal(result.quality.overlappingSignalsExcluded, 1);
  assert.equal(result.byBranch.fvg_retest_bullish.events, 1);
});
