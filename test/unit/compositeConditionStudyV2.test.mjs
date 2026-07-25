import test from "node:test";
import assert from "node:assert/strict";
import { runCompositeConditionStudy } from "../../build/compositeConditionStudy.js";

const HOUR = 3_600_000;

function createBars(start, ohlcList) {
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
      forming: false,
    };
  });
}

test("runCompositeConditionStudy validates v2 boundary and error parameters strictly", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const bars = createBars(start, [[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100]]);
  const folds = [{ foldId: "f1", from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" }];
  const cond = { type: "fair_value_gap_retest", minimum_gap_bps: 10 };

  const baseConfig = {
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    operator: "negation",
    conditions: [cond, cond],
    horizons: [1],
    targetReturnBps: 10,
    minimumEvents: 1,
    folds,
    eventLimit: 10,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: null,
  };

  // Test sequence operator requires exactly 2 conditions
  assert.throws(
    () => runCompositeConditionStudy({ ...baseConfig, operator: "sequence", conditions: [cond, cond, cond] }),
    /sequence operator requires exactly 2 conditions/
  );

  // Test invalid sequenceWindowBars
  assert.throws(
    () => runCompositeConditionStudy({ ...baseConfig, sequenceWindowBars: 0 }),
    /sequence_window_bars must be an integer between 1 and 24/
  );
  assert.throws(
    () => runCompositeConditionStudy({ ...baseConfig, sequenceWindowBars: 25 }),
    /sequence_window_bars must be an integer between 1 and 24/
  );

  // Test invalid lookbackBars & lookaheadBars
  assert.throws(
    () => runCompositeConditionStudy({ ...baseConfig, lookbackBars: -1 }),
    /lookback_bars must be an integer between 0 and 48/
  );
  assert.throws(
    () => runCompositeConditionStudy({ ...baseConfig, lookaheadBars: 50 }),
    /lookahead_bars must be an integer between 0 and 48/
  );

  // Test invalid regimeGate labels
  assert.throws(
    () => runCompositeConditionStudy({ ...baseConfig, regimeGate: { directional: ["invalid_regime"] } }),
    /invalid regime_gate directional label/
  );
  assert.throws(
    () => runCompositeConditionStudy({ ...baseConfig, regimeGate: { volatility: ["super_high"] } }),
    /invalid regime_gate volatility label/
  );
});

test("runCompositeConditionStudy evaluates negation (NOT gate) and emits lookahead_bars warning when > 0", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const ohlc = [
    [100, 100.2, 99.8, 100],        // 0
    [100.3, 101.8, 100.2, 101.6],    // 1
    [101.7, 103, 101.4, 102.8],      // 2 (gap 120bps)
    [102.8, 103, 102.5, 102.7],      // 3
    [102.7, 102.8, 100.5, 101],      // 4 (retest 1)
    [101, 102.5, 100.8, 102.2],      // 5
    [102.2, 104, 102, 103.8],        // 6
    [103.8, 104, 103.5, 103.9],      // 7
    [104.0, 108.0, 103.9, 107.8],    // 8
    [107.7, 110.0, 107.2, 109.5],    // 9 (gap 307bps)
    [109.5, 110.0, 109.0, 109.8],    // 10
    [109.8, 110.0, 105.0, 108.0],    // 11 (retest 2)
    [108.0, 112.0, 107.8, 111.5],    // 12
    [111.5, 113.0, 111.0, 112.5],    // 13
  ];

  const bars = createBars(start, ohlc);
  const folds = [
    { foldId: "fold1", from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T06:00:00.000Z" },
    { foldId: "fold2", from: "2026-01-01T06:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
  ];

  const primaryCondition = {
    type: "fair_value_gap_retest",
    minimum_gap_bps: 10,
    retest_within_bars: 12,
  };

  const exclusionCondition = {
    type: "fair_value_gap_retest",
    minimum_gap_bps: 200,
    retest_within_bars: 12,
  };

  const res = runCompositeConditionStudy({
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    operator: "negation",
    conditions: [primaryCondition, exclusionCondition],
    lookbackBars: 2,
    lookaheadBars: 2,
    requireSameDirection: false,
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds,
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: null,
  });

  assert.equal(res.methodologyVersion, "composite_condition_event_study_v2");
  assert.equal(res.conditionContract.operator, "negation");
  assert.equal(res.conditionContract.alignmentRule, "exclusion_window");
  assert.equal(res.events.length, 1);
  assert.ok(
    res.inferenceWarnings.includes("lookahead_bars_gt_zero_introduces_future_information_relative_to_primary_signal"),
    "inferenceWarnings must include lookahead warning when lookaheadBars > 0"
  );

  const impossibleExclusion = {
    type: "fair_value_gap_retest",
    minimum_gap_bps: 950,
    retest_within_bars: 12,
  };

  const resPassed = runCompositeConditionStudy({
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    operator: "negation",
    conditions: [primaryCondition, impossibleExclusion],
    lookbackBars: 2,
    lookaheadBars: 0,
    requireSameDirection: false,
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds,
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: null,
  });

  assert.equal(resPassed.events.length, 2);
  assert.equal(
    resPassed.inferenceWarnings.includes("lookahead_bars_gt_zero_introduces_future_information_relative_to_primary_signal"),
    false,
    "inferenceWarnings must not include lookahead warning when lookaheadBars is 0"
  );
});

test("runCompositeConditionStudy evaluates sequence (A -> B) operator and sequence window boundary", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const ohlc = [
    [100, 100.2, 99.8, 100],        // 0
    [100.3, 101.8, 100.2, 101.6],    // 1
    [101.7, 103, 101.4, 102.8],      // 2 (gap 120bps)
    [102.8, 103, 102.5, 102.7],      // 3
    [102.7, 102.8, 100.5, 101],      // 4 (retest 1)
    [101, 102.5, 100.8, 102.2],      // 5
    [102.2, 104, 102, 103.8],        // 6
    [103.8, 104, 103.5, 103.9],      // 7
    [104.0, 108.0, 103.9, 107.8],    // 8
    [107.7, 110.0, 107.2, 109.5],    // 9 (gap 307bps)
    [109.5, 110.0, 109.0, 109.8],    // 10
    [109.8, 110.0, 105.0, 108.0],    // 11 (retest 2)
    [108.0, 112.0, 107.8, 111.5],    // 12
    [111.5, 113.0, 111.0, 112.5],    // 13
  ];

  const bars = createBars(start, ohlc);
  const folds = [
    { foldId: "fold1", from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T06:00:00.000Z" },
    { foldId: "fold2", from: "2026-01-01T06:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
  ];

  const cond1 = {
    type: "fair_value_gap_retest",
    minimum_gap_bps: 10,
    retest_within_bars: 12,
  };

  const cond2 = {
    type: "fair_value_gap_retest",
    minimum_gap_bps: 200,
    retest_within_bars: 12,
  };

  const resMatch = runCompositeConditionStudy({
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    operator: "sequence",
    conditions: [cond1, cond2],
    sequenceWindowBars: 10,
    requireSameDirection: false,
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds,
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: null,
  });

  assert.equal(resMatch.methodologyVersion, "composite_condition_event_study_v2");
  assert.equal(resMatch.conditionContract.operator, "sequence");
  assert.equal(resMatch.conditionContract.alignmentRule, "sequential_window");
  assert.equal(resMatch.events.length, 1);

  const resOutOfWindow = runCompositeConditionStudy({
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    operator: "sequence",
    conditions: [cond1, cond2],
    sequenceWindowBars: 4,
    requireSameDirection: false,
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds,
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: null,
  });

  assert.equal(resOutOfWindow.events.length, 0);

  const resReverse = runCompositeConditionStudy({
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    operator: "sequence",
    conditions: [cond2, cond1],
    sequenceWindowBars: 10,
    requireSameDirection: false,
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds,
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: null,
  });

  assert.equal(resReverse.events.length, 0);
});

test("runCompositeConditionStudy applies regime_gate filtering using prior closed bar (signalIndex - 1)", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  // Generate 75 bars so computeMarketRegimes has >50 bars to establish baseline lookback
  const ohlc = [];
  for (let i = 0; i < 60; i++) {
    ohlc.push([100 + i * 0.1, 100.2 + i * 0.1, 99.8 + i * 0.1, 100.1 + i * 0.1]);
  }
  // Add FVG retest bars at index 64 and 71
  ohlc.push(
    [106.0, 106.2, 105.8, 106.0],      // 60
    [106.3, 107.8, 106.2, 107.6],      // 61
    [107.7, 109.0, 107.4, 108.8],      // 62 (gap 120bps)
    [108.8, 109.0, 108.5, 108.7],      // 63
    [108.7, 108.8, 106.5, 107.0],      // 64 (retest 1)
    [107.0, 108.5, 106.8, 108.2],      // 65
    [108.2, 110.0, 108.0, 109.8],      // 66
    [109.8, 110.0, 109.5, 109.9],      // 67
    [110.0, 114.0, 109.9, 113.8],      // 68
    [113.7, 116.0, 113.2, 115.5],      // 69 (gap 307bps)
    [115.5, 116.0, 115.0, 115.8],      // 70
    [115.8, 116.0, 111.0, 114.0],      // 71 (retest 2)
    [114.0, 118.0, 113.8, 117.5],      // 72
    [117.5, 119.0, 117.0, 118.5]       // 73
  );

  const bars = createBars(start, ohlc);
  const folds = [
    { foldId: "fold1", from: "2026-01-01T00:00:00.000Z", to: "2026-01-03T00:00:00.000Z" },
    { foldId: "fold2", from: "2026-01-03T00:00:00.000Z", to: "2026-01-05T00:00:00.000Z" },
  ];

  const cond = {
    type: "fair_value_gap_retest",
    minimum_gap_bps: 10,
    retest_within_bars: 12,
  };

  // Custom regime config with minimumClassifiedBars: 30
  const customRegimeConfig = {
    trendLookback: 20,
    atrLookback: 14,
    volatilityBaselineLookback: 30,
    trendEfficiencyThreshold: 0.6,
    rangeEfficiencyThreshold: 0.25,
    directionalMoveAtrThreshold: 1.5,
    highVolatilityRatio: 1.5,
    lowVolatilityRatio: 0.7,
    minimumClassifiedBars: 30,
    minimumGroupEvents: 1,
    minimumCoverageRatio: 0.5,
    maxRegimeAgeBars: 4,
  };

  // All directional regime labels allowed -> events pass
  const resAll = runCompositeConditionStudy({
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    operator: "union",
    conditions: [cond, cond],
    regimeGate: {
      directional: ["range", "transition", "trend_up", "trend_down"],
    },
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds,
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: customRegimeConfig,
  });

  assert.equal(resAll.methodologyVersion, "composite_condition_event_regime_study_v2");
  assert.ok(resAll.conditionContract.regimeGate !== null);
  const initialEventsCount = resAll.events.length;
  assert.ok(initialEventsCount > 0, `Initial study must produce events (got ${initialEventsCount})`);

  // Restrict regime gate to non-matching volatility regime ("high" only) -> events get filtered out
  const resRestricted = runCompositeConditionStudy({
    bars,
    symbol: "OANDA:EURUSD",
    timeframe: "60",
    operator: "union",
    conditions: [cond, cond],
    regimeGate: {
      volatility: ["high"],
    },
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds,
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: customRegimeConfig,
  });

  assert.ok(
    resRestricted.events.length < initialEventsCount,
    `Restricted regime gate must filter out non-matching events (before: ${initialEventsCount}, after: ${resRestricted.events.length})`
  );
  assert.ok(
    resRestricted.quality.alignmentExclusions > resAll.quality.alignmentExclusions,
    "alignmentExclusions count must increase when regime gate filters out events"
  );
});
