import assert from "node:assert/strict";
import test from "node:test";
import {
  PRICE_ACTION_CONTEXT_ALERTS,
  PRICE_ACTION_CONTEXT_INPUTS,
  PRICE_ACTION_CONTEXT_NAME,
  PRICE_ACTION_CONTEXT_PLOTS,
  PRICE_ACTION_CONTEXT_SOURCE,
  assertPriceActionContextStudy,
  parsePriceActionContext,
} from "../../build/priceActionContext.js";

const study = {
  id: "st1",
  name: PRICE_ACTION_CONTEXT_NAME,
  inputs: PRICE_ACTION_CONTEXT_INPUTS.map((input) => ({ ...input, value: 0 })),
};

const valuesWith = (overrides) => [{
  id: "st1",
  hasError: false,
  error: null,
  bars: [{
    values: {
      "Pin Bar": 0,
      "Engulfing": 0,
      "Sweep": 0,
      "Sweep High Level": 1.1,
      "Sweep Low Level": 1.09,
      "Upper Wick %": 20,
      "Lower Wick %": 65,
      "Body %": 15,
      "Bar Confirmed": 1,
      ...overrides,
    },
  }],
}];

test("the Pine source and the exported contract cannot drift apart", () => {
  const declaredInputs = [...PRICE_ACTION_CONTEXT_SOURCE.matchAll(/input\.\w+\([^,]+,\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(declaredInputs, PRICE_ACTION_CONTEXT_INPUTS.map((input) => input.name));
  // Input ids are positional in TradingView, so declaration order is part of the contract.
  assert.deepEqual(PRICE_ACTION_CONTEXT_INPUTS.map((input) => input.id), ["in_0", "in_1", "in_2", "in_3", "in_4", "in_5", "in_6", "in_7", "in_8", "in_9"]);

  const declaredPlots = [...PRICE_ACTION_CONTEXT_SOURCE.matchAll(/^plot\([^,]+,\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(declaredPlots, [...PRICE_ACTION_CONTEXT_PLOTS]);

  const declaredAlerts = [...PRICE_ACTION_CONTEXT_SOURCE.matchAll(/^alertcondition\([^,]+,\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(declaredAlerts, [...PRICE_ACTION_CONTEXT_ALERTS]);
});

test("alerts read the same gated signals as the marks, so nothing can fire on an unclosed bar", () => {
  // Every named condition is stated over pinSignal, engulfingSignal or sweepSignal - the series that
  // Confirm On Bar Close already forces to zero until the bar closes - and never over the raw rules.
  for (const [, condition] of PRICE_ACTION_CONTEXT_SOURCE.matchAll(/^alertcondition\(([^,]+),/gm)) {
    assert.match(condition, /^(pinSignal|engulfingSignal|sweepSignal) == -?1$/);
  }
  assert.match(PRICE_ACTION_CONTEXT_SOURCE, /alert\.freq_once_per_bar_close/);
  // A bar can carry more than one pattern, so the single alert accumulates rather than picking one.
  assert.match(PRICE_ACTION_CONTEXT_SOURCE, /alertText := alertText \+/);
});

test("the sweep level is taken from bars before the current one, so a bar cannot sweep itself", () => {
  assert.match(PRICE_ACTION_CONTEXT_SOURCE, /sweepHighLevel = ta\.highest\(high, sweepLookback\)\[1\]/);
  assert.match(PRICE_ACTION_CONTEXT_SOURCE, /sweepLowLevel = ta\.lowest\(low, sweepLookback\)\[1\]/);
  // Taken out on the wick, recovered by the close - both halves are required.
  assert.match(PRICE_ACTION_CONTEXT_SOURCE, /sweptHigh = .*high > sweepHighLevel and close < sweepHighLevel/);
  assert.match(PRICE_ACTION_CONTEXT_SOURCE, /sweptLow = .*low < sweepLowLevel and close > sweepLowLevel/);
});

test("engulfing compares bodies rather than ranges", () => {
  assert.match(PRICE_ACTION_CONTEXT_SOURCE, /coversPriorBody = .*bodyHigh >= priorBodyHigh and bodyLow <= priorBodyLow/);
});

test("a ready bar reports its three signals and its shape", () => {
  const context = parsePriceActionContext(study, valuesWith({ "Pin Bar": 1, "Sweep": -1 }));
  assert.equal(context.status, "ready");
  assert.equal(context.pinBar, 1);
  assert.equal(context.engulfing, 0);
  assert.equal(context.sweep, -1);
  assert.deepEqual(context.levels, { sweepHigh: 1.1, sweepLow: 1.09 });
  assert.equal(context.shape.lowerWickPercent, 65);
  assert.equal(context.barConfirmed, true);
  assert.deepEqual(context.qualityIssues, []);
});

test("a bar with no range has no shape to report and says so instead of dividing by it", () => {
  const context = parsePriceActionContext(study, valuesWith({ "Upper Wick %": null, "Lower Wick %": null, "Body %": null }));
  assert.equal(context.status, "unavailable");
  assert.equal(context.shape, null);
  assert.deepEqual(context.pinBar, 0);
  assert.ok(context.qualityIssues.includes("bar_has_no_measurable_range"));
});

test("an unconfirmed bar is readable but flagged, because its close can still move", () => {
  const context = parsePriceActionContext(study, valuesWith({ "Bar Confirmed": 0 }));
  assert.equal(context.barConfirmed, false);
  assert.ok(context.qualityIssues.includes("bar_not_closed"));
});

test("a sweep level is optional but a present one must be a real price", () => {
  const missing = parsePriceActionContext(study, valuesWith({ "Sweep High Level": null }));
  assert.equal(missing.levels.sweepHigh, null);
  assert.throws(() => parsePriceActionContext(study, valuesWith({ "Sweep Low Level": 0 })), /Sweep Low Level/);
});

test("a signal outside -1, 0 and 1 is refused rather than coerced", () => {
  assert.throws(() => parsePriceActionContext(study, valuesWith({ "Engulfing": 2 })), /Engulfing must be -1, 0 or 1/);
  assert.throws(() => parsePriceActionContext(study, valuesWith({ "Pin Bar": null })), /Pin Bar must be -1, 0 or 1/);
});

test("the study contract refuses another indicator or a renamed input", () => {
  assert.doesNotThrow(() => assertPriceActionContextStudy([study], "st1"));
  assert.throws(() => assertPriceActionContextStudy([{ ...study, name: "Something Else" }], "st1"), /is not Bushido Price Action Context/);
  const renamed = { ...study, inputs: study.inputs.map((input) => input.id === "in_5" ? { ...input, name: "Lookback" } : input) };
  assert.throws(() => assertPriceActionContextStudy([renamed], "st1"), /in_5 \(Sweep Lookback\)/);
  assert.throws(() => assertPriceActionContextStudy([study], "st2"), /was not returned by get_indicator_inputs/);
});
