import assert from "node:assert/strict";
import test from "node:test";
import { computeFuturesFlowContext, futuresFlowMapping } from "../../build/futuresFlowContext.js";

const DAY = 86_400_000;

function bars(closes, volumes, overrides = {}) {
  const start = Date.UTC(2026, 0, 1);
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    const time = start + index * DAY;
    return { time: time / 1000, timeIso: new Date(time).toISOString(), open,
      high: Math.max(open, close) + 0.1, low: Math.min(open, close) - 0.1,
      close, volume: volumes[index], ...overrides };
  });
}

function input(series, overrides = {}) {
  return { bars: series, targetSymbol: "OANDA:EURUSD", futuresSymbol: "CME:6E1!", timeframe: "1D",
    volumeLookback: 5, elevatedVolumeZScore: 1, minimumObservations: 1, observationLimit: 20, ...overrides };
}

test("futures flow context classifies target-oriented price with trailing volume participation", () => {
  const result = computeFuturesFlowContext(input(bars(
    [100, 101, 102, 103, 104, 106, 108], [10, 11, 9, 10, 10, 30, 12],
  )));
  assert.equal(result.current.targetOrientedDirection, "up");
  assert.equal(result.observations[0].participation, "elevated");
  assert.equal(result.observations[0].hypothesis, "target_up_with_elevated_futures_volume");
  assert.equal(result.volumeContract.trailingBaselineExcludesCurrentBar, true);
  assert.equal(result.openInterest.status, "unavailable");
  assert.equal(result.priceOpenInterestQuadrant.classification, null);
});

test("futures flow context reverses Japanese Yen futures into USDJPY direction", () => {
  const result = computeFuturesFlowContext(input(
    bars([100, 101, 102, 103, 104, 106], [10, 11, 9, 10, 10, 30]),
    { targetSymbol: "OANDA:USDJPY", futuresSymbol: "CME:6J1!" },
  ));
  assert.ok(result.current.futuresReturn > 0);
  assert.ok(result.current.targetOrientedReturn < 0);
  assert.equal(result.current.targetOrientedDirection, "down");
  assert.equal(result.mapping.targetDirectionMultiplier, -1);
});

test("futures flow context preserves single-leg proxy scope for crosses", () => {
  const mapping = futuresFlowMapping("OANDA:GBPAUD");
  assert.equal(mapping.futuresSymbol, "CME:6B1!");
  assert.ok(mapping.allowedFuturesSymbols.includes("CME_DL:6B1!"));
  assert.equal(mapping.proxyScope, "base_currency_single_leg");
});

test("futures flow context excludes forming bars and does not invent missing volume", () => {
  const series = bars([100, 101, 102, 103, 104, 105, 106], [10, 11, 9, 10, null, 30, 40]);
  series.at(-1).forming = true;
  series[5].time += 4 * DAY / 1000;
  series[5].timeIso = new Date(series[5].time * 1000).toISOString();
  const result = computeFuturesFlowContext(input(series));
  assert.equal(result.quality.formingBarsExcluded, 1);
  assert.equal(result.quality.missingVolumeBars, 1);
  assert.ok(result.quality.calendarOrDataGaps > 0);
  assert.equal(result.current, null);
  assert.ok(result.qualityIssues.includes("one_or_more_closed_bars_missing_volume"));
});

test("futures flow context rejects an unbound futures symbol", () => {
  assert.throws(() => computeFuturesFlowContext(input(
    bars([100, 101, 102, 103, 104, 105], [10, 11, 9, 10, 10, 30]),
    { futuresSymbol: "CME:6J1!" },
  )), /expected one of/);
});

test("futures flow context accepts TradingView delayed exchange aliases for the same fixed root", () => {
  const result = computeFuturesFlowContext(input(
    bars([100, 101, 102, 103, 104, 105], [10, 11, 9, 10, 10, 30]),
    { futuresSymbol: "CME_DL:6E1!" },
  ));
  assert.equal(result.mapping.futuresSymbol, "CME_DL:6E1!");
});
