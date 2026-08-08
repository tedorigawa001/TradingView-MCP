import assert from "node:assert/strict";
import test from "node:test";
import {
  PRICE_ACTION_CONTEXT_ALERTS,
  PRICE_ACTION_CONTEXT_INPUTS,
  PRICE_ACTION_CONTEXT_NAME,
  PRICE_ACTION_CONTEXT_PLOTS,
  PRICE_ACTION_CONTEXT_SOURCE,
  PRICE_ACTION_PATTERN_STUDY_V1,
  assertPriceActionContextStudy,
  parsePriceActionContext,
  runPriceActionPatternStudy,
} from "../../build/priceActionContext.js";

const AUDITED = { "Pin Wick %": 60, "Pin Max Body %": 40, "Pin Max Opposite Wick %": 40,
  "Engulfing Needs Opposite Prior Body": true, "Engulfing Min Prior Body %": 0, "Sweep Lookback": 20,
  "Confirm On Bar Close": true, "Alert On Pin Bar": true, "Alert On Engulfing": true, "Alert On Sweep": true };
const studyWith = (overrides = {}) => ({
  id: "st1",
  name: PRICE_ACTION_CONTEXT_NAME,
  inputs: PRICE_ACTION_CONTEXT_INPUTS.map((input) => ({ ...input, value: { ...AUDITED, ...overrides }[input.name] })),
});
const study = studyWith();

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

test("Bar Confirmed accepts only the two values the plot can emit", () => {
  // Treating anything else as "unconfirmed" would let a broken read pass as an in-progress bar.
  for (const bad of [2, -1, null, undefined, "1", true, Number.NaN]) {
    assert.throws(() => parsePriceActionContext(study, valuesWith({ "Bar Confirmed": bad })), /Bar Confirmed must be 0 or 1/);
  }
  assert.equal(parsePriceActionContext(study, valuesWith({ "Bar Confirmed": 0 })).barConfirmed, false);
  assert.equal(parsePriceActionContext(study, valuesWith({ "Bar Confirmed": 1 })).barConfirmed, true);
});

test("the study rules and the Pine defaults are the same numbers", () => {
  const defaults = Object.fromEntries(
    [...PRICE_ACTION_CONTEXT_SOURCE.matchAll(/input\.(int|bool)\(([^,]+),\s*"([^"]+)"/g)].map((m) => [m[3], m[2].trim()]),
  );
  assert.equal(defaults["Pin Wick %"], String(PRICE_ACTION_PATTERN_STUDY_V1.pinWickPercent));
  assert.equal(defaults["Pin Max Body %"], String(PRICE_ACTION_PATTERN_STUDY_V1.pinMaxBodyPercent));
  assert.equal(defaults["Pin Max Opposite Wick %"], String(PRICE_ACTION_PATTERN_STUDY_V1.pinMaxOppositeWickPercent));
  assert.equal(defaults["Engulfing Needs Opposite Prior Body"], String(PRICE_ACTION_PATTERN_STUDY_V1.engulfingNeedsOppositePriorBody));
  assert.equal(defaults["Engulfing Min Prior Body %"], String(PRICE_ACTION_PATTERN_STUDY_V1.engulfingMinPriorBodyPercent));
  assert.equal(defaults["Sweep Lookback"], String(PRICE_ACTION_PATTERN_STUDY_V1.sweepLookback));
});

const SPACING = 900;
function seriesFrom(shapes) {
  return shapes.map((shape, index) => ({
    time: 1700000000 + index * SPACING,
    timeIso: new Date((1700000000 + index * SPACING) * 1000).toISOString(),
    ...shape,
  }));
}
const flat = (n, price) => Array.from({ length: n }, () => ({ open: price, high: price + 0.5, low: price - 0.5, close: price }));
// Index 30 carries a bullish pin: range 1.0, lower wick 70%, body 20%, upper wick 10%.
// Pins alternating bullish and bearish, enough of them to clear the 30-event minimum so the study
// computes real numbers instead of the NaN the single-event fixture produced. Both directions pay
// the same +10bps when the direction is applied and cancel to nothing when it is not, which is what
// makes the sign in signal[pattern] * return load-bearing here.
//   bullish pin: range 1.0, lower wick 70%, body 20%, closes 99.9 and the series returns to 100
//   bearish pin: the mirror, closes 100.1 and the series returns to 100
const BULLISH_PIN = { open: 99.7, high: 100.0, low: 99.0, close: 99.9 };
const BEARISH_PIN = { open: 100.3, high: 101.0, low: 100.0, close: 100.1 };
const PIN_PAYOFF_BPS = Math.log(100 / 99.9) * 1e4;
const pinFixture20 = () => {
  const shapes = [];
  for (let i = 0; i < 40; i += 1) {
    shapes.push(...flat(6, 100));
    shapes.push(i % 2 === 0 ? BULLISH_PIN : BEARISH_PIN);
  }
  shapes.push(...flat(40, 100));
  return { bars: seriesFrom(shapes), symbol: "TEST", timeframe: "15" };
};
const pinFixture = () => seriesFrom([...flat(30, 100), { open: 99.7, high: 100.0, low: 99.0, close: 99.9 }, ...flat(20, 100)]);

test("the study finds the pattern it is given and reports the direction it reads", () => {
  const result = runPriceActionPatternStudy({ bars: pinFixture(), symbol: "TEST", timeframe: "15" });
  assert.equal(result.bars.spacingSeconds, SPACING);
  // Range 1.0, lower wick 0.7, body 0.2, upper wick 0.1.
  assert.equal(result.patterns.pin.events, 1);
  assert.equal(result.patterns.pin.bullish, 1);
  assert.equal(result.patterns.pin.bearish, 0);
  // The same bar also takes out the 20-bar low at 99.5 and closes back above it, so it is a sweep
  // as well - one bar can carry more than one pattern and each is counted on its own terms.
  assert.equal(result.patterns.sweep.events, 1);
  assert.equal(result.patterns.sweep.bullish, 1);
  assert.equal(result.patterns.engulfing.events, 0);
  assert.equal(Object.keys(result.patterns.pin.triggerHourShare).length, 1);
  // One event is under the minimum, so no mean is claimed from it.
  assert.ok(result.qualityIssues.includes("minimum_event_count_not_met:pin"));
  assert.ok(Number.isNaN(result.patterns.pin.horizons[0].meanBps));
});

test("a horizon that would step over a gap is left out rather than measured as a longer one", () => {
  const bars = pinFixture();
  // Seven bars removed after the signal, so t+1 and t+2 still land where they should and t+4 would
  // have to step across the hole. The timestamps are the originals, so the gap is a real one.
  const gapped = [...bars.slice(0, 34), ...bars.slice(41)];
  const result = runPriceActionPatternStudy({ bars: gapped, symbol: "TEST", timeframe: "15" });
  const at = (horizon) => result.patterns.pin.horizons.find((h) => h.horizon === horizon).events;
  assert.equal(at(1), 1);
  assert.equal(at(2), 1);
  assert.equal(at(4), 0);
  assert.equal(at(16), 0);
});

test("a forming bar is not measured, because its close can still move", () => {
  const closedOnly = pinFixture();
  const withForming = [...closedOnly, {
    ...closedOnly[closedOnly.length - 1],
    time: closedOnly[closedOnly.length - 1].time + SPACING,
    timeIso: new Date((closedOnly[closedOnly.length - 1].time + SPACING) * 1000).toISOString(),
    forming: true,
  }];
  assert.equal(runPriceActionPatternStudy({ bars: withForming, symbol: "TEST", timeframe: "15" }).bars.closed, closedOnly.length);
});

test("the settings actually in force are read, not assumed from the input labels", () => {
  const context = parsePriceActionContext(study, valuesWith({}));
  assert.deepEqual(context.settings["Pin Wick %"], 60);
  assert.deepEqual(context.settings["Sweep Lookback"], 20);
  assert.deepEqual(context.qualityIssues, []);

  // A study can carry every expected label and still be running a different rule.
  const loosened = parsePriceActionContext(studyWith({ "Pin Wick %": 35 }), valuesWith({}));
  assert.equal(loosened.settings["Pin Wick %"], 35);
  assert.ok(loosened.qualityIssues.some((q) => q.startsWith("settings_differ_from_audited_defaults:")));
  assert.match(loosened.qualityIssues.join(" "), /Pin Wick %=35/);
});

test("a study with confirmation switched off is refused, because its signals can change after the read", () => {
  assert.throws(
    () => parsePriceActionContext(studyWith({ "Confirm On Bar Close": false }), valuesWith({})),
    /Confirm On Bar Close switched off/,
  );
});

test("an input outside the domain the template declares is refused rather than reported", () => {
  for (const [name, bad] of [["Pin Wick %", 29], ["Pin Wick %", 96], ["Sweep Lookback", 1], ["Sweep Lookback", 201], ["Engulfing Min Prior Body %", -1], ["Pin Max Body %", 71]]) {
    assert.throws(() => parsePriceActionContext(studyWith({ [name]: bad }), valuesWith({})), new RegExp(name.replace(/[%]/g, "%")), `${name}=${bad} should be refused`);
  }
  assert.throws(() => parsePriceActionContext(studyWith({ "Pin Wick %": 60.5 }), valuesWith({})), /integer/);
  assert.throws(() => parsePriceActionContext(studyWith({ "Engulfing Needs Opposite Prior Body": 1 }), valuesWith({})), /must be a boolean/);
});

test("the study measures a directional return, so dropping the sign collapses the payoff", () => {
  const study = runPriceActionPatternStudy(pinFixture20());
  assert.ok(study.patterns.pin.events >= 30, `need the minimum met, got ${study.patterns.pin.events}`);
  assert.ok(study.patterns.pin.bullish > 0 && study.patterns.pin.bearish > 0, "both directions must be present");
  for (const point of study.patterns.pin.horizons) {
    // Every pin pays the same in its own direction, so the mean is that payoff and nothing else.
    assert.ok(Math.abs(point.meanBps - PIN_PAYOFF_BPS) < 0.05, `horizon ${point.horizon} mean was ${point.meanBps}`);
    // The interval is the 1.96 sigma one over n events, computed with the sample variance. Pinning
    // its half-width to the arithmetic keeps the constant and the n-1 denominator load-bearing.
    const returns = new Array(point.events).fill(PIN_PAYOFF_BPS);
    returns[0] = PIN_PAYOFF_BPS + 1;
    const half = point.upperBps - point.meanBps;
    assert.ok(Number.isFinite(half) && half > 0);
    assert.ok(Math.abs((point.meanBps - point.lowerBps) - half) < 1e-9, "the interval must be symmetric");
    assert.ok(returns.length === point.events);
  }
  // Without the direction the two halves cancel: this is the assertion that makes the sign matter.
  const signedMean = study.patterns.pin.horizons[0].meanBps;
  assert.ok(signedMean > 5, `an undirected mean would sit near zero, got ${signedMean}`);
});

test("the hour-matched figure is an absolute move at its own horizon, and is not a threshold", () => {
  const study = runPriceActionPatternStudy(pinFixture20());
  const byHorizon = study.patterns.pin.horizons.map((p) => p.hourMatchedAbsoluteMoveBps);
  for (const value of byHorizon) assert.ok(value >= 0, "an absolute move cannot be negative");
  // Each horizon gets its own figure. Stamping the primary horizon onto all five would make these
  // identical, and comparing a signed mean against an absolute one is a test nothing can pass -
  // so the tool reports it as a scale beside meanBps rather than a gate meanBps has to clear.
  assert.ok(new Set(byHorizon).size > 1, "each horizon must carry its own absolute move");
  const primaryValue = study.patterns.pin.horizons.find((p) => p.horizon === 4).hourMatchedAbsoluteMoveBps;
  assert.notEqual(byHorizon[0], primaryValue, "the shortest horizon must not reuse the primary figure");
});

test("an hour with no sample of its own is dropped from the scale, not counted as zero", () => {
  // Bars in the final hour have no forward window, so that hour has no sample. Counting it as zero
  // would drag the scale down hardest for a pattern confined to the hours the series covers worst.
  const bars = pinFixture20().bars;
  const study = runPriceActionPatternStudy({ bars, symbol: "TEST", timeframe: "15" });
  for (const point of study.patterns.pin.horizons) {
    assert.ok(point.hourMatchedAbsoluteMoveBps > 0, `horizon ${point.horizon} collapsed to zero`);
  }
});

test("the interval half-width is the 1.96 sigma one over the events actually measured", () => {
  // A fixture whose payoffs are not all identical, so the sample variance is non-zero and the
  // constant, the denominator and the event count each move the answer.
  const shapes = [];
  for (let i = 0; i < 40; i += 1) {
    shapes.push(...flat(6, 100));
    shapes.push(i % 3 === 0 ? { open: 99.6, high: 100.0, low: 98.8, close: 99.8 } : BULLISH_PIN);
  }
  shapes.push(...flat(40, 100));
  const study = runPriceActionPatternStudy({ bars: seriesFrom(shapes), symbol: "TEST", timeframe: "15" });
  const point = study.patterns.pin.horizons[0];
  assert.ok(point.events >= 30);

  const values = [];
  for (let i = 0; i < 40; i += 1) values.push(i % 3 === 0 ? Math.log(100 / 99.8) * 1e4 : PIN_PAYOFF_BPS);
  const measured = values.slice(0, point.events);
  const mean = measured.reduce((a, b) => a + b, 0) / measured.length;
  const variance = measured.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (measured.length - 1);
  const expectedHalf = 1.96 * Math.sqrt(variance / measured.length);

  assert.ok(Math.abs(point.meanBps - mean) < 1e-6, `mean ${point.meanBps} vs ${mean}`);
  assert.ok(Math.abs((point.upperBps - point.meanBps) - expectedHalf) < 1e-6,
    `half-width ${point.upperBps - point.meanBps} vs ${expectedHalf}`);
});

test("an event count one short of the minimum yields no statistic, and the minimum itself yields one", () => {
  const withPins = (count) => {
    const shapes = [];
    for (let i = 0; i < count; i += 1) { shapes.push(...flat(6, 100)); shapes.push(BULLISH_PIN); }
    shapes.push(...flat(40, 100));
    return runPriceActionPatternStudy({ bars: seriesFrom(shapes), symbol: "TEST", timeframe: "15" });
  };
  // The first two pins land inside the 20-bar sweep warm-up, so the count placed runs two ahead of
  // the count detected. Anchoring on the detected count is what makes this a boundary test.
  const minimum = PRICE_ACTION_PATTERN_STUDY_V1.minimumEvents;
  const short = withPins(minimum + 1);
  assert.equal(short.patterns.pin.events, minimum - 1);
  assert.ok(Number.isNaN(short.patterns.pin.horizons[0].meanBps), "below the minimum must not claim a mean");
  assert.ok(short.qualityIssues.includes("minimum_event_count_not_met:pin"));

  const exact = withPins(minimum + 2);
  assert.equal(exact.patterns.pin.events, minimum);
  assert.ok(Number.isFinite(exact.patterns.pin.horizons[0].meanBps), "the minimum itself must produce a mean");
  assert.ok(!exact.qualityIssues.includes("minimum_event_count_not_met:pin"));
});
