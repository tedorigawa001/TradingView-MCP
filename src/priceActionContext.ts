import type { IndicatorInputs, IndicatorValues } from "./tradingview.js";

export const PRICE_ACTION_CONTEXT_NAME = "Bushido Price Action Context";
export const PRICE_ACTION_CONTEXT_VERSION = "1.0";

export const PRICE_ACTION_CONTEXT_INPUTS = [
  { id: "in_0", name: "Pin Wick %" },
  { id: "in_1", name: "Pin Max Body %" },
  { id: "in_2", name: "Pin Max Opposite Wick %" },
  { id: "in_3", name: "Engulfing Needs Opposite Prior Body" },
  { id: "in_4", name: "Engulfing Min Prior Body %" },
  { id: "in_5", name: "Sweep Lookback" },
  { id: "in_6", name: "Confirm On Bar Close" },
  { id: "in_7", name: "Alert On Pin Bar" },
  { id: "in_8", name: "Alert On Engulfing" },
  { id: "in_9", name: "Alert On Sweep" },
] as const;

/**
 * Named conditions for TradingView's alert dialog, so one pattern can be subscribed to without the
 * others. The alert() call beside them covers all three at once and names what fired.
 */
export const PRICE_ACTION_CONTEXT_ALERTS = [
  "Bullish Pin Bar",
  "Bearish Pin Bar",
  "Bullish Engulfing",
  "Bearish Engulfing",
  "Low Sweep Reclaimed",
  "High Sweep Rejected",
] as const;

export const PRICE_ACTION_CONTEXT_PLOTS = [
  "Pin Bar",
  "Engulfing",
  "Sweep",
  "Sweep High Level",
  "Sweep Low Level",
  "Upper Wick %",
  "Lower Wick %",
  "Body %",
  "Bar Confirmed",
] as const;

/** +1 reads bullish, -1 bearish, 0 no pattern on this bar. */
export type PriceActionSignal = 1 | 0 | -1;

export interface PriceActionContext {
  status: "ready" | "unavailable";
  pinBar: PriceActionSignal;
  engulfing: PriceActionSignal;
  sweep: PriceActionSignal;
  levels: { sweepHigh: number | null; sweepLow: number | null };
  shape: { upperWickPercent: number; lowerWickPercent: number; bodyPercent: number } | null;
  barConfirmed: boolean;
  qualityIssues: string[];
}

/**
 * Three patterns, each stated as a rule over one bar and its immediate context, so the same
 * definition can be read off the chart and out of the data window.
 *
 * The defaults implement the three rules exactly. Pin Max Body % and Pin Max Opposite Wick % are
 * both 40 because a 60% wick already forces the rest of the bar under 40%, so at their defaults
 * they constrain nothing and only bite when tightened. Engulfing Min Prior Body % is 0 for the same
 * reason of matching the stated rule, but it is worth raising: every bar engulfs a doji, so a run
 * of engulfing marks around flat bars is the default doing what it was told, not a bug.
 */
export const PRICE_ACTION_CONTEXT_SOURCE = `//@version=6
indicator("${PRICE_ACTION_CONTEXT_NAME}", overlay = true)

pinWickPercent = input.int(60, "Pin Wick %", minval = 30, maxval = 95)
pinMaxBodyPercent = input.int(40, "Pin Max Body %", minval = 1, maxval = 70)
pinMaxOppositePercent = input.int(40, "Pin Max Opposite Wick %", minval = 1, maxval = 70)
engulfNeedsOpposite = input.bool(true, "Engulfing Needs Opposite Prior Body")
engulfMinPriorBodyPercent = input.int(0, "Engulfing Min Prior Body %", minval = 0, maxval = 90)
sweepLookback = input.int(20, "Sweep Lookback", minval = 2, maxval = 200)
confirmOnClose = input.bool(true, "Confirm On Bar Close")
alertOnPin = input.bool(true, "Alert On Pin Bar")
alertOnEngulfing = input.bool(true, "Alert On Engulfing")
alertOnSweep = input.bool(true, "Alert On Sweep")

barRange = high - low
measurable = barRange > 0
bodyHigh = math.max(open, close)
bodyLow = math.min(open, close)
upperPercent = measurable ? (high - bodyHigh) / barRange * 100 : na
lowerPercent = measurable ? (bodyLow - low) / barRange * 100 : na
bodyPercent = measurable ? (bodyHigh - bodyLow) / barRange * 100 : na

// A wick at or above the threshold on one side, with the body and the far side no larger than their
// caps. Both sides cannot clear a 60% threshold at once, so the two pin readings are exclusive.
bullishPin = measurable and lowerPercent >= pinWickPercent and bodyPercent <= pinMaxBodyPercent and upperPercent <= pinMaxOppositePercent
bearishPin = measurable and upperPercent >= pinWickPercent and bodyPercent <= pinMaxBodyPercent and lowerPercent <= pinMaxOppositePercent

priorBodyHigh = math.max(open[1], close[1])
priorBodyLow = math.min(open[1], close[1])
priorRange = high[1] - low[1]
priorBodyPercent = priorRange > 0 ? (priorBodyHigh - priorBodyLow) / priorRange * 100 : 0.0
// Bodies, not ranges: the rule is that this body covers the previous body outright.
coversPriorBody = not na(open[1]) and bodyHigh >= priorBodyHigh and bodyLow <= priorBodyLow and priorBodyPercent >= engulfMinPriorBodyPercent
bullishEngulfing = coversPriorBody and close > open and (not engulfNeedsOpposite or close[1] < open[1])
bearishEngulfing = coversPriorBody and close < open and (not engulfNeedsOpposite or close[1] > open[1])

// The level has to come from bars before this one, or a bar could never take out its own extreme.
sweepHighLevel = ta.highest(high, sweepLookback)[1]
sweepLowLevel = ta.lowest(low, sweepLookback)[1]
sweptHigh = not na(sweepHighLevel) and high > sweepHighLevel and close < sweepHighLevel
sweptLow = not na(sweepLowLevel) and low < sweepLowLevel and close > sweepLowLevel

// An unconfirmed bar can satisfy any of these and then close somewhere else entirely. Gating on
// confirmation is what keeps a mark that appeared intrabar from vanishing again.
readable = not confirmOnClose or barstate.isconfirmed
pinSignal = not readable ? 0 : bullishPin ? 1 : bearishPin ? -1 : 0
engulfingSignal = not readable ? 0 : bullishEngulfing ? 1 : bearishEngulfing ? -1 : 0
// A swept low is a bullish reading, because the side that was taken out is the one that failed.
sweepSignal = not readable ? 0 : sweptLow ? 1 : sweptHigh ? -1 : 0

plotshape(pinSignal == 1, "Bullish Pin", shape.triangleup, location.belowbar, color.new(color.teal, 0), size = size.tiny)
plotshape(pinSignal == -1, "Bearish Pin", shape.triangledown, location.abovebar, color.new(color.maroon, 0), size = size.tiny)
plotshape(engulfingSignal == 1, "Bullish Engulfing", shape.labelup, location.belowbar, color.new(color.teal, 20), size = size.tiny, text = "E", textcolor = color.white)
plotshape(engulfingSignal == -1, "Bearish Engulfing", shape.labeldown, location.abovebar, color.new(color.maroon, 20), size = size.tiny, text = "E", textcolor = color.white)
bgcolor(sweepSignal == 1 ? color.new(color.teal, 82) : sweepSignal == -1 ? color.new(color.maroon, 82) : na, title = "Sweep Background")

plot(pinSignal, "Pin Bar", display = display.data_window)
plot(engulfingSignal, "Engulfing", display = display.data_window)
plot(sweepSignal, "Sweep", display = display.data_window)
plot(sweepHighLevel, "Sweep High Level", display = display.data_window)
plot(sweepLowLevel, "Sweep Low Level", display = display.data_window)
plot(upperPercent, "Upper Wick %", display = display.data_window)
plot(lowerPercent, "Lower Wick %", display = display.data_window)
plot(bodyPercent, "Body %", display = display.data_window)
plot(barstate.isconfirmed ? 1 : 0, "Bar Confirmed", display = display.data_window)

// Named conditions for the alert dialog. Each reads the same gated signal the marks are drawn from,
// so with Confirm On Bar Close left on, none of them can fire on a close that has not happened yet.
alertcondition(pinSignal == 1, "Bullish Pin Bar", "Bullish pin bar on {{ticker}} {{interval}} at {{close}}")
alertcondition(pinSignal == -1, "Bearish Pin Bar", "Bearish pin bar on {{ticker}} {{interval}} at {{close}}")
alertcondition(engulfingSignal == 1, "Bullish Engulfing", "Bullish engulfing on {{ticker}} {{interval}} at {{close}}")
alertcondition(engulfingSignal == -1, "Bearish Engulfing", "Bearish engulfing on {{ticker}} {{interval}} at {{close}}")
alertcondition(sweepSignal == 1, "Low Sweep Reclaimed", "Low sweep reclaimed on {{ticker}} {{interval}} at {{close}}")
alertcondition(sweepSignal == -1, "High Sweep Rejected", "High sweep rejected on {{ticker}} {{interval}} at {{close}}")

// One alert for all three, naming whatever fired. A bar can carry more than one pattern, so the
// message is built up rather than picked, and the three inputs decide what it is allowed to mention.
alertText = ""
if alertOnPin and pinSignal != 0
    alertText := alertText + (pinSignal == 1 ? "bullish pin bar. " : "bearish pin bar. ")
if alertOnEngulfing and engulfingSignal != 0
    alertText := alertText + (engulfingSignal == 1 ? "bullish engulfing. " : "bearish engulfing. ")
if alertOnSweep and sweepSignal != 0
    alertText := alertText + (sweepSignal == 1 ? "low sweep reclaimed. " : "high sweep rejected. ")
if alertText != ""
    alert(syminfo.ticker + " " + timeframe.period + ": " + alertText + "close " + str.tostring(close, format.mintick), alert.freq_once_per_bar_close)
`;

export function assertPriceActionContextStudy(
  studies: IndicatorInputs[],
  studyId: string,
): IndicatorInputs {
  const study = studies.find((candidate) => candidate.id === studyId);
  if (!study) throw new Error(`study ${studyId} was not returned by get_indicator_inputs`);
  if (study.name !== PRICE_ACTION_CONTEXT_NAME) {
    throw new Error(`study ${studyId} is not ${PRICE_ACTION_CONTEXT_NAME}`);
  }
  for (const expected of PRICE_ACTION_CONTEXT_INPUTS) {
    const actual = study.inputs.find((input) => input.id === expected.id);
    if (!actual || actual.name !== expected.name) {
      throw new Error(
        `study ${studyId} does not match price-action input contract at ${expected.id} (${expected.name})`,
      );
    }
  }
  return study;
}

function signal(value: unknown, label: string): PriceActionSignal {
  if (value === 1 || value === -1 || value === 0) return value;
  throw new Error(`${label} must be -1, 0 or 1`);
}

function percent(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a percentage between 0 and 100`);
  }
  return value;
}

function levelOrNull(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number when present`);
  }
  return value;
}

export function parsePriceActionContext(
  study: IndicatorInputs,
  values: IndicatorValues[],
): PriceActionContext {
  const valueStudy = values.find((candidate) => candidate.id === study.id);
  if (!valueStudy || valueStudy.hasError || valueStudy.error) {
    throw new Error(`study ${study.id} did not return readable price-action plots`);
  }
  const row = valueStudy.bars.at(-1);
  if (!row) throw new Error(`study ${study.id} returned no price-action values`);
  const raw = row.values;

  const barConfirmed = raw["Bar Confirmed"] === 1;
  const qualityIssues = barConfirmed ? [] : ["bar_not_closed"];

  // A zero-range bar has no shape to report, and the Pine side emits na rather than dividing by it.
  const shapePlots = ["Upper Wick %", "Lower Wick %", "Body %"] as const;
  const shapeMissing = shapePlots.some((plot) => raw[plot] === null || raw[plot] === undefined);
  if (shapeMissing) {
    return {
      status: "unavailable",
      pinBar: 0,
      engulfing: 0,
      sweep: 0,
      levels: { sweepHigh: null, sweepLow: null },
      shape: null,
      barConfirmed,
      qualityIssues: [...qualityIssues, "bar_has_no_measurable_range"],
    };
  }

  return {
    status: "ready",
    pinBar: signal(raw["Pin Bar"], "Pin Bar"),
    engulfing: signal(raw["Engulfing"], "Engulfing"),
    sweep: signal(raw["Sweep"], "Sweep"),
    levels: {
      sweepHigh: levelOrNull(raw["Sweep High Level"], "Sweep High Level"),
      sweepLow: levelOrNull(raw["Sweep Low Level"], "Sweep Low Level"),
    },
    shape: {
      upperWickPercent: percent(raw["Upper Wick %"], "Upper Wick %"),
      lowerWickPercent: percent(raw["Lower Wick %"], "Lower Wick %"),
      bodyPercent: percent(raw["Body %"], "Body %"),
    },
    barConfirmed,
    qualityIssues,
  };
}
