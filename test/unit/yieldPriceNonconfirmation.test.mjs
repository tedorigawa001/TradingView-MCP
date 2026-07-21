import assert from "node:assert/strict";
import test from "node:test";
import { runYieldPriceNonconfirmationStudy } from "../../build/yieldPriceNonconfirmation.js";

const DAY = 86_400_000;

function bars(start, closes, offset = 0) {
  return closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    const time = start + offset + index * DAY;
    return { time: time / 1000, timeIso: new Date(time).toISOString(), open: previous,
      high: Math.max(previous, close) + 0.2, low: Math.min(previous, close) - 0.2,
      close, volume: 1 };
  });
}

function input(targetBars, driverBars, overrides = {}) {
  return {
    targetBars, driverBars,
    targetSymbol: "OANDA:USDJPY", driverSymbol: "TVC:US10Y",
    targetTimeframe: "1D", driverTimeframe: "1D", relationship: "direct",
    driverLookback: 2, driverChangeThreshold: 0.1,
    priceBreakoutLookback: 3, nonconfirmationBars: 2,
    triggerLookback: 2, triggerWithinBars: 3, maxDriverAgeBars: 2,
    horizons: [1, 2], targetReturnBps: 50, minimumEvents: 1,
    folds: [], eventLimit: 20, ...overrides,
  };
}

test("yield-price study detects a direct yield-up price failure without exact timestamps", () => {
  const start = Date.UTC(2026, 0, 1);
  const driver = bars(start, [4, 4, 4, 4, 4, 4.15, 4.16, 4.16, 4.16, 4.16, 4.16]);
  const target = bars(start, [100, 100.1, 100, 100.2, 100.1, 100, 99.9, 98, 97, 96, 95], 22 * 3_600_000);
  const result = runYieldPriceNonconfirmationStudy(input(target, driver));
  assert.equal(result.sample.events, 1);
  assert.equal(result.events[0].branch, "driver_up_target_failure");
  assert.equal(result.events[0].direction, "short");
  assert.ok(result.byBranch.driver_up_target_failure.horizons["2"].directionalReturn.mean > 0);
  assert.equal(result.joinContract.policy, "driver_nominal_close_then_target_bar_start");
});

test("yield-price study never uses a target bar that started before driver availability", () => {
  const start = Date.UTC(2026, 0, 1);
  const driver = bars(start, [4, 4, 4, 4, 4, 4.15, 4.16, 4.16, 4.16]);
  const target = bars(start, [100, 100, 100, 100, 100, 97, 100, 100, 100], 22 * 3_600_000);
  const result = runYieldPriceNonconfirmationStudy(input(target, driver));
  assert.equal(result.sample.events, 0);
  assert.ok(result.qualityIssues.includes("minimum_event_count_not_met"));
});

test("yield-price study cancels nonconfirmation when price breaks in the expected direction", () => {
  const start = Date.UTC(2026, 0, 1);
  const driver = bars(start, [4, 4, 4, 4, 4, 4.15, 4.16, 4.16, 4.16, 4.16]);
  const target = bars(start, [100, 100, 100, 100, 100, 101, 102, 101, 99, 98], 22 * 3_600_000);
  const result = runYieldPriceNonconfirmationStudy(input(target, driver));
  assert.equal(result.sample.events, 0);
  assert.equal(result.quality.expectedBreakoutConfirmed, 1);
});

test("yield-price study reverses the expected price direction for an inverse relationship", () => {
  const start = Date.UTC(2026, 0, 1);
  const driver = bars(start, [4, 4, 4, 4, 4, 4.15, 4.16, 4.16, 4.16, 4.16, 4.16]);
  const target = bars(start, [100, 100, 100, 100, 100, 100.1, 100.2, 102, 103, 104, 105], 22 * 3_600_000);
  const result = runYieldPriceNonconfirmationStudy(input(target, driver, {
    targetSymbol: "OANDA:XAUUSD", relationship: "inverse",
  }));
  assert.equal(result.sample.events, 1);
  assert.equal(result.events[0].branch, "driver_up_target_failure");
  assert.equal(result.events[0].direction, "long");
  assert.ok(result.byBranch.driver_up_target_failure.horizons["2"].directionalReturn.mean > 0);
});

test("yield-price study never reports negative favorable or adverse excursion", () => {
  const start = Date.UTC(2026, 0, 1);
  const driver = bars(start, [4, 4, 4, 4, 4, 4.15, 4.16, 4.16, 4.16, 4.16, 4.16]);
  const target = bars(start, [100, 100.1, 100, 100.2, 100.1, 100, 99.9, 98, 97, 100, 101], 22 * 3_600_000);
  target[9] = { ...target[9], open: 100, high: 100.2, low: 99.8 };
  const result = runYieldPriceNonconfirmationStudy(input(target, driver));
  const horizon = result.byBranch.driver_up_target_failure.horizons["1"];
  assert.equal(horizon.mfe.minimum, 0);
  assert.ok(horizon.mae.minimum >= 0);
});
