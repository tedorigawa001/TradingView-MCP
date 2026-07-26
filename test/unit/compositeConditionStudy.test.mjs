import test from "node:test";
import assert from "node:assert/strict";
import { runCompositeConditionStudy } from "../../build/compositeConditionStudy.js";

function makeHourBars(count) {
  const start = Date.UTC(2026, 0, 1, 0, 0);
  const hour = 3_600_000;
  const bars = [];
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const time = (start + i * hour) / 1000;
    bars.push({
      time,
      timeIso: new Date(time * 1000).toISOString(),
      open: price,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 100,
    });
  }
  return bars;
}

test("runCompositeConditionStudy validates input parameters strictly", () => {
  const bars = makeHourBars(50);
  const baseInput = {
    bars,
    symbol: "EURUSD",
    timeframe: "60",
    operator: "intersection",
    conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10 },
    ],
    horizons: [1, 4],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: null,
    regime: null,
  };

  assert.throws(
    () => runCompositeConditionStudy(baseInput),
    /composite_condition requires 2 to 4 sub-conditions/,
  );

  assert.throws(
    () => runCompositeConditionStudy({
      ...baseInput,
      conditions: [
        { type: "fair_value_gap_retest", minimum_gap_bps: 10 },
        { type: "fair_value_gap_retest", minimum_gap_bps: 20 },
      ],
      maxAlignmentBars: 25,
    }),
    /max_alignment_bars must be an integer between 0 and 24/,
  );
});

test("runCompositeConditionStudy evaluates intersection (AND) composite condition", () => {
  const start = Date.UTC(2026, 0, 5, 0, 0);
  const hour = 3_600_000;
  const bars = [];
  for (let i = 0; i < 60; i += 1) {
    const time = (start + i * hour) / 1000;
    bars.push({
      time,
      timeIso: new Date(time * 1000).toISOString(),
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 100,
    });
  }

  // FVG Bullish Gap on bars 5,6,7 and retest on bar 8
  bars[5] = { ...bars[5], open: 100, high: 100.2, low: 99.8, close: 100 };
  bars[6] = { ...bars[6], open: 100.3, high: 102.5, low: 100.2, close: 102.3 }; // Impulse
  bars[7] = { ...bars[7], open: 102.4, high: 103.5, low: 102.3, close: 103.2 }; // Confirms gap 100.2..102.3
  bars[8] = { ...bars[8], open: 103.0, high: 103.1, low: 100.5, close: 102.0 }; // Retest into 100.2..102.3 zone

  const res = runCompositeConditionStudy({
    bars,
    symbol: "EURUSD",
    timeframe: "60",
    operator: "intersection",
    maxAlignmentBars: 5,
    requireSameDirection: false,
    conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 10, min_impulse_body_ratio: 0.5 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 5, retest_within_bars: 10, min_impulse_body_ratio: 0.3 },
    ],
    horizons: [1, 4],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: null,
  });

  assert.equal(res.schemaVersion, "1.0");
  assert.equal(res.methodologyVersion, "composite_condition_event_study_v1");
  assert.equal(res.conditionContract.operator, "intersection");
  assert.equal(res.conditionContract.alignmentRule, "pairwise_span");
  assert.equal(res.conditionContract.subConditionCount, 2);
  assert.equal(res.byBranch.composite_long.events >= 1, true);
});

test("runCompositeConditionStudy versions handoff composites separately after the decision-time correction", () => {
  const res = runCompositeConditionStudy({
    bars: makeHourBars(100),
    symbol: "EURUSD",
    timeframe: "60",
    operator: "intersection",
    conditions: [
      {
        type: "session_exhaustion_handoff",
        timezone: "UTC",
        prior_sessions: [{ session_id: "prior", start: "00:00", end: "08:00" }],
        handoff_start: "08:00",
        handoff_end: "11:00",
        prior_direction: "session_return",
      },
      { type: "fair_value_gap_retest", minimum_gap_bps: 10 },
    ],
    horizons: [1],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: 1,
    regime: null,
  });

  assert.equal(res.methodologyVersion, "composite_condition_event_study_v3");
});

test("runCompositeConditionStudy excludes overlapping composite events via overlap_policy", () => {
  const start = Date.UTC(2026, 0, 5, 0, 0);
  const hour = 3_600_000;
  const bars = [];
  for (let i = 0; i < 70; i += 1) {
    const time = (start + i * hour) / 1000;
    bars.push({
      time,
      timeIso: new Date(time * 1000).toISOString(),
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 100,
    });
  }

  // First FVG retest on bar 8
  bars[5] = { ...bars[5], open: 100, high: 100.2, low: 99.8, close: 100 };
  bars[6] = { ...bars[6], open: 100.3, high: 102.5, low: 100.2, close: 102.3 };
  bars[7] = { ...bars[7], open: 102.4, high: 103.5, low: 102.3, close: 103.2 };
  bars[8] = { ...bars[8], open: 103.0, high: 103.1, low: 100.5, close: 102.0 };

  // Second FVG retest on bar 12 (only 4 bars after bar 8; max horizon = 5)
  bars[9] = { ...bars[9], open: 102.0, high: 102.2, low: 101.8, close: 102.0 };
  bars[10] = { ...bars[10], open: 102.1, high: 104.5, low: 102.0, close: 104.3 };
  bars[11] = { ...bars[11], open: 104.4, high: 105.5, low: 104.3, close: 105.2 };
  bars[12] = { ...bars[12], open: 105.0, high: 105.1, low: 102.5, close: 104.0 };

  const res = runCompositeConditionStudy({
    bars,
    symbol: "EURUSD",
    timeframe: "60",
    operator: "intersection",
    maxAlignmentBars: 5,
    overlapPolicy: "exclude_later_event",
    conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 10 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 5, retest_within_bars: 10 },
    ],
    horizons: [1, 5],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: null,
    regime: null,
  });

  assert.equal(res.conditionContract.overlapPolicy, "exclude_later_event");
  assert.equal(res.quality.overlappingEventsExcluded >= 1, true);
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].eventId.includes(":8:"), true);
});

test("runCompositeConditionStudy enforces 3-condition pairwise-span alignment and boundary limits", () => {
  const start = Date.UTC(2026, 0, 5, 0, 0);
  const hour = 3_600_000;
  const bars = [];
  for (let i = 0; i < 70; i += 1) {
    const time = (start + i * hour) / 1000;
    bars.push({
      time,
      timeIso: new Date(time * 1000).toISOString(),
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 100,
    });
  }

  // FVG 1 on bars 4,5,6 retest at bar 7 (impulse body ratio 0.56 -> matches C0 and C1, fails C2)
  bars[4] = { ...bars[4], open: 100, high: 100.2, low: 99.8, close: 100 };
  bars[5] = { ...bars[5], open: 100.3, high: 102.5, low: 100.2, close: 101.6 };
  bars[6] = { ...bars[6], open: 101.7, high: 103.5, low: 101.6, close: 103.2 };
  bars[7] = { ...bars[7], open: 103.0, high: 103.1, low: 100.5, close: 102.0 };

  // FVG 2 on bars 10,11,12 retest at bar 13 (impulse body ratio 0.93 -> matches C0 and C2, fails C1)
  bars[10] = { ...bars[10], open: 100, high: 100.2, low: 99.8, close: 100 };
  bars[11] = { ...bars[11], open: 100.3, high: 102.5, low: 100.2, close: 102.45 };
  bars[12] = { ...bars[12], open: 102.5, high: 103.5, low: 102.4, close: 103.2 };
  bars[13] = { ...bars[13], open: 103.0, high: 103.1, low: 100.5, close: 102.0 };

  // Pairwise span across (C0@13, C1@7, C2@13) is 13 - 7 = 6 bars.

  // With maxAlignmentBars = 4, span 6 > 4, so pairwise-span rejects it
  const resNarrow = runCompositeConditionStudy({
    bars,
    symbol: "EURUSD",
    timeframe: "60",
    operator: "intersection",
    maxAlignmentBars: 4,
    conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15, min_impulse_body_ratio: 0.5 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15, min_impulse_body_ratio: 0.5 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15, min_impulse_body_ratio: 0.8 },
    ],
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: null,
    regime: null,
  });

  assert.equal(resNarrow.quality.alignmentExclusions >= 1, true);

  // With maxAlignmentBars = 6, span 6 <= 6, so pairwise-span accepts it!
  const resWide = runCompositeConditionStudy({
    bars,
    symbol: "EURUSD",
    timeframe: "60",
    operator: "intersection",
    maxAlignmentBars: 6,
    conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15, min_impulse_body_ratio: 0.5 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15, min_impulse_body_ratio: 0.5 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15, min_impulse_body_ratio: 0.8 },
    ],
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: null,
    regime: null,
  });

  assert.equal(resWide.byBranch.composite_long.events >= 1, true);
});

test("runCompositeConditionStudy evaluates 4 sub-conditions intersection (AND) alignment", () => {
  const start = Date.UTC(2026, 0, 5, 0, 0);
  const hour = 3_600_000;
  const bars = [];
  for (let i = 0; i < 70; i += 1) {
    const time = (start + i * hour) / 1000;
    bars.push({
      time,
      timeIso: new Date(time * 1000).toISOString(),
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 100,
    });
  }

  bars[4] = { ...bars[4], open: 100, high: 100.2, low: 99.8, close: 100 };
  bars[5] = { ...bars[5], open: 100.3, high: 102.5, low: 100.2, close: 102.3 };
  bars[6] = { ...bars[6], open: 102.4, high: 103.5, low: 102.3, close: 103.2 };
  bars[7] = { ...bars[7], open: 103.0, high: 103.1, low: 100.5, close: 102.0 };

  const res = runCompositeConditionStudy({
    bars,
    symbol: "EURUSD",
    timeframe: "60",
    operator: "intersection",
    maxAlignmentBars: 5,
    conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 10, retest_within_bars: 15 },
    ],
    horizons: [1, 2],
    targetReturnBps: 20,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: null,
    regime: null,
  });

  assert.equal(res.conditionContract.subConditionCount, 4);
  assert.equal(res.byBranch.composite_long.events >= 1, true);
});

test("runCompositeConditionStudy evaluates filter_gate composite condition", () => {
  const bars = makeHourBars(50);
  const res = runCompositeConditionStudy({
    bars,
    symbol: "EURUSD",
    timeframe: "60",
    operator: "filter_gate",
    maxAlignmentBars: 10,
    requireSameDirection: true,
    conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 5 },
    ],
    horizons: [1, 4],
    targetReturnBps: 10,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: null,
    regime: null,
  });

  assert.equal(res.conditionContract.operator, "filter_gate");
  assert.equal(res.conditionContract.alignmentRule, "primary_anchored_lookback");
  assert.equal(res.conditionContract.requireSameDirection, true);
});

test("runCompositeConditionStudy evaluates union (OR) and rejects ambiguous opposite-direction signals", () => {
  const bars = makeHourBars(40);
  const res = runCompositeConditionStudy({
    bars,
    symbol: "EURUSD",
    timeframe: "60",
    operator: "union",
    maxAlignmentBars: 0,
    conditions: [
      { type: "fair_value_gap_retest", minimum_gap_bps: 10 },
      { type: "fair_value_gap_retest", minimum_gap_bps: 15 },
    ],
    horizons: [1, 4],
    targetReturnBps: 10,
    minimumEvents: 1,
    folds: [],
    eventLimit: 50,
    confidenceLevel: 0.95,
    configurationTrials: null,
    regime: null,
  });

  assert.equal(res.conditionContract.operator, "union");
  assert.equal(res.conditionContract.alignmentRule, "exact_signal_bar");
  assert.equal(typeof res.quality.ambiguousBothSides, "number");
});
