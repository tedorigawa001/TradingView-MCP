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

test("futures flow context classifies 4-quadrant price x Open Interest analysis when OI data is supplied", () => {
  const series = bars([100, 101, 102, 103, 101, 103], [10, 11, 9, 10, 10, 30]);
  const oiData = [
    { time: series[0].timeIso, openInterest: 1000 },
    { time: series[1].timeIso, openInterest: 1000 },
    { time: series[2].timeIso, openInterest: 1100 }, // price up (101->102) + OI up (1000->1100) => long_build
    { time: series[3].timeIso, openInterest: 1050 }, // price up (102->103) + OI down (1100->1050) => short_covering
    { time: series[4].timeIso, openInterest: 1150 }, // price down (103->101) + OI up (1050->1150) => short_build
    { time: series[5].timeIso, openInterest: 1100 }, // price up (101->103) + OI down (1150->1100) => short_covering
  ];

  const result = computeFuturesFlowContext(input(series, { openInterestData: oiData }));
  assert.equal(result.schemaVersion, "1.1");
  assert.equal(result.methodologyVersion, "futures_flow_context_v2");
  assert.equal(result.openInterest.status, "available");
  assert.equal(result.openInterest.value, 1100);
  assert.equal(result.openInterest.changeFromPrevious, -50);
  assert.equal(result.priceOpenInterestQuadrant.status, "available");
  assert.equal(result.priceOpenInterestQuadrant.classification, "short_covering");
  assert.equal(result.priceOpenInterestQuadrant.futuresClassification, "short_covering");
  assert.equal(result.priceOpenInterestQuadrant.distribution.short_covering.count, 1);
  assert.equal(result.priceOpenInterestQuadrant.distribution.long_build.count, 0);

  // Check observation level fields
  const obs1 = result.observations[0]; // index 5
  assert.equal(obs1.openInterest, 1100);
  assert.equal(obs1.openInterestChange, -50);
  assert.equal(obs1.futuresQuadrant, "short_covering");
  assert.equal(obs1.targetOrientedQuadrant, "short_covering");
});

test("futures flow context reverses 4-quadrant classification for USDJPY inverse multiplier (-1)", () => {
  const series = bars([100, 101, 102, 103, 104, 105], [10, 11, 9, 10, 10, 30]);
  const oiData = [
    { time: series[0].timeIso, openInterest: 1000 },
    { time: series[1].timeIso, openInterest: 1000 },
    { time: series[2].timeIso, openInterest: 1000 },
    { time: series[3].timeIso, openInterest: 1000 },
    { time: series[4].timeIso, openInterest: 1000 },
    { time: series[5].timeIso, openInterest: 1200 }, // 6J price up (104->105) + 6J OI up (1000->1200) => 6J long_build => USDJPY short_build
  ];

  const result = computeFuturesFlowContext(input(series, {
    targetSymbol: "OANDA:USDJPY",
    futuresSymbol: "CME:6J1!",
    openInterestData: oiData,
  }));

  assert.equal(result.priceOpenInterestQuadrant.futuresClassification, "long_build");
  assert.equal(result.priceOpenInterestQuadrant.classification, "short_build"); // mapped to USDJPY
  assert.equal(result.current.futuresQuadrant, "long_build");
  assert.equal(result.current.targetOrientedQuadrant, "short_build");
});

test("futures flow context reports partial status and quality issue when open interest is partially missing", () => {
  const series = bars([100, 101, 102, 103, 104, 105, 106, 107, 108, 109], [10, 11, 9, 10, 10, 30, 20, 15, 25, 30]);
  // Supply OI for first 7 bars out of 10 (series[0..6]), so observations 5, 6 have OI, observations 7, 8, 9 do not
  const oiData = [
    { time: series[0].timeIso, openInterest: 1000 },
    { time: series[1].timeIso, openInterest: 1000 },
    { time: series[2].timeIso, openInterest: 1100 },
    { time: series[3].timeIso, openInterest: 1200 },
    { time: series[4].timeIso, openInterest: 1250 },
    { time: series[5].timeIso, openInterest: 1300 },
    { time: series[6].timeIso, openInterest: 1350 },
  ];

  const result = computeFuturesFlowContext(input(series, { volumeLookback: 5, openInterestData: oiData }));
  assert.equal(result.openInterest.status, "partial");
  assert.equal(result.priceOpenInterestQuadrant.status, "partial");
  assert.equal(result.status, "partial");
  assert.ok(result.qualityIssues.includes("daily_open_interest_partially_missing"));
});
