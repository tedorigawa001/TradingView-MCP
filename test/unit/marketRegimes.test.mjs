import assert from "node:assert/strict";
import test from "node:test";
import { computeMarketRegimes } from "../../build/marketRegimes.js";

function barsFromCloses(closes, ranges = []) {
  const start = Date.UTC(2026, 0, 1);
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    const range = ranges[index] ?? 0.2;
    return { time: (start + index * 3_600_000) / 1000,
      timeIso: new Date(start + index * 3_600_000).toISOString(),
      open, high: Math.max(open, close) + range, low: Math.min(open, close) - range, close, volume: 1 };
  });
}

function input(bars, overrides = {}) {
  return { bars, symbol: "OANDA:EURUSD", timeframe: "60", trendLookback: 10, atrLookback: 5,
    volatilityBaselineLookback: 20, trendEfficiencyThreshold: 0.6, rangeEfficiencyThreshold: 0.25,
    directionalMoveAtrThreshold: 2, highVolatilityRatio: 1.5, lowVolatilityRatio: 0.7,
    minimumClassifiedBars: 10, observationLimit: 500, ...overrides };
}

test("market regimes distinguish directional trends from balanced ranges", () => {
  const trend = barsFromCloses(Array.from({ length: 80 }, (_, index) => 100 + index * 0.5));
  const trendResult = computeMarketRegimes(input(trend));
  assert.equal(trendResult.status, "complete");
  assert.equal(trendResult.current.directionalRegime, "trend_up");
  assert.ok(trendResult.distribution.directional.trend_up > 30);

  const range = barsFromCloses(Array.from({ length: 80 }, (_, index) => 100 + (index % 2 === 0 ? 0.5 : -0.5)));
  const rangeResult = computeMarketRegimes(input(range));
  assert.equal(rangeResult.current.directionalRegime, "range");
  assert.ok(rangeResult.distribution.directional.range > 30);
});

test("market regimes identify trailing volatility expansion without future data", () => {
  const closes = Array.from({ length: 90 }, (_, index) => 100 + index * 0.1);
  const ranges = closes.map((_, index) => index < 85 ? 0.1 : 2);
  const full = computeMarketRegimes(input(barsFromCloses(closes, ranges)));
  assert.equal(full.current.volatilityRegime, "high");

  const cutoff = 70;
  const prefixBars = barsFromCloses(closes.slice(0, cutoff), ranges.slice(0, cutoff));
  const prefix = computeMarketRegimes(input(prefixBars, { minimumClassifiedBars: 1 }));
  const sameBar = full.observations.find((item) => item.time === prefix.current.time);
  assert.deepEqual(sameBar, prefix.current);
});

test("market regimes exclude forming bars and report irregular intervals", () => {
  const bars = barsFromCloses(Array.from({ length: 80 }, (_, index) => 100 + index * 0.2));
  for (let index = 40; index < bars.length; index += 1) {
    bars[index] = { ...bars[index], time: bars[index].time + 7_200,
      timeIso: new Date((bars[index].time + 7_200) * 1000).toISOString() };
  }
  bars.at(-1).forming = true;
  const result = computeMarketRegimes(input(bars));
  assert.equal(result.quality.formingBarsExcluded, 1);
  assert.ok(result.quality.irregularIntervals > 0);
  assert.ok(result.qualityIssues.includes("one_or_more_non_contiguous_bar_intervals"));
});

test("market regimes retain up to the internal 20000-observation analysis limit", () => {
  const bars = barsFromCloses(Array.from({ length: 80 }, (_, index) => 100 + index * 0.2));
  const result = computeMarketRegimes(input(bars, { observationLimit: 20_000 }));
  assert.equal(result.observationsReturned, result.sample.classifiedBars);
  assert.equal(result.observationsTruncated, false);
});
