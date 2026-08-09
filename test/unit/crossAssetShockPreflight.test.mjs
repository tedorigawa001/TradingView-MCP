import assert from "node:assert/strict";
import test from "node:test";
import { computeCrossAssetShockPreflight } from "../../build/crossAssetShockPreflight.js";

const base = Date.parse("2026-08-03T00:00:00.000Z") / 1000;
const bars = (offsets, forming = new Set()) => offsets.map((offset) => ({
  time: base + offset * 15 * 60,
  timeIso: new Date((base + offset * 15 * 60) * 1000).toISOString(),
  open: 100 + offset, high: 101 + offset, low: 99 + offset, close: 100 + offset, volume: 1,
  forming: forming.has(offset),
}));
const series = (role, symbol, offsets, forming) => ({ role, symbol, bars: bars(offsets, forming) });

test("cross-asset preflight keeps only exactly aligned closed timestamps and never fills a missing reference", () => {
  const result = computeCrossAssetShockPreflight({
    timeframe: "15", minimumAlignedBars: 3,
    series: [
      series("target_fx", "OANDA:EURUSD", [0, 1, 2, 3, 4]),
      series("dxy", "TVC:DXY", [0, 1, 3, 4]),
      series("us_yield", "TVC:US10Y", [0, 1, 2, 3, 4]),
      series("xauusd", "OANDA:XAUUSD", [0, 1, 2, 3, 4]),
    ],
  });
  assert.equal(result.status, "partial");
  assert.equal(result.alignment.common_closed_bars, 4);
  assert.equal(result.alignment.contiguous_common_return_intervals, 2);
  assert.equal(result.alignment.missing_from_target.dxy, 1);
  assert.ok(result.quality_issues.includes("one_or_more_non_contiguous_common_bar_intervals"));
});

test("cross-asset preflight excludes forming bars before exact-time alignment", () => {
  const result = computeCrossAssetShockPreflight({
    timeframe: "15", minimumAlignedBars: 3,
    series: [
      series("target_fx", "OANDA:USDJPY", [0, 1, 2, 3]),
      series("dxy", "TVC:DXY", [0, 1, 2, 3]),
      series("us_yield", "TVC:US10Y", [0, 1, 2, 3], new Set([3])),
      series("xauusd", "OANDA:XAUUSD", [0, 1, 2, 3]),
    ],
  });
  assert.equal(result.alignment.common_closed_bars, 3);
  assert.equal(result.quality.forming_bars_excluded.us_yield, 1);
  assert.equal(result.status, "complete");
});

test("cross-asset preflight rejects duplicate timestamps and unsupported target bindings", () => {
  assert.throws(() => computeCrossAssetShockPreflight({
    timeframe: "15", minimumAlignedBars: 2,
    series: [
      series("target_fx", "OANDA:GBPUSD", [0, 1]),
      series("dxy", "TVC:DXY", [0, 1]),
      series("us_yield", "TVC:US10Y", [0, 1]),
      series("xauusd", "OANDA:XAUUSD", [0, 1]),
    ],
  }), /target FX symbol/);
  assert.throws(() => computeCrossAssetShockPreflight({
    timeframe: "15", minimumAlignedBars: 2,
    series: [
      series("target_fx", "OANDA:EURUSD", [0, 1]),
      series("dxy", "TVC:DXY", [0, 1]),
      series("us_yield", "TVC:US10Y", [0, 1]),
      series("xauusd", "OANDA:XAUUSD", [0, 1, 1]),
    ],
  }), /duplicate closed timestamp/);
});
