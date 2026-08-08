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

/** Every input the template exposes, with the domain the Pine declaration enforces. */
export const PRICE_ACTION_CONTEXT_INPUT_DOMAINS = {
  in_0: { kind: "int", min: 30, max: 95, auditedDefault: 60 },
  in_1: { kind: "int", min: 1, max: 70, auditedDefault: 40 },
  in_2: { kind: "int", min: 1, max: 70, auditedDefault: 40 },
  in_3: { kind: "bool", auditedDefault: true },
  in_4: { kind: "int", min: 0, max: 90, auditedDefault: 0 },
  in_5: { kind: "int", min: 2, max: 200, auditedDefault: 20 },
  in_6: { kind: "bool", auditedDefault: true },
  in_7: { kind: "bool", auditedDefault: true },
  in_8: { kind: "bool", auditedDefault: true },
  in_9: { kind: "bool", auditedDefault: true },
} as const;

export interface PriceActionContext {
  status: "ready" | "unavailable";
  /** The settings actually in force on the chart, not the ones the template ships with. */
  settings: Record<string, number | boolean>;
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

/**
 * The same three rules as the Pine template, at its default settings, so a measurement and the marks
 * on the chart cannot describe different things. The horizons and the entry are the whole trading
 * rule: enter at the signal bar's close in the direction the pattern reads, leave h bars later. No
 * stop, no target, no filter - each one would be a choice made after seeing the data.
 */
export const PRICE_ACTION_PATTERN_STUDY_V1 = {
  methodologyVersion: "price_action_pattern_forward_return_study_v1",
  pinWickPercent: 60,
  pinMaxBodyPercent: 40,
  pinMaxOppositeWickPercent: 40,
  engulfingNeedsOppositePriorBody: true,
  engulfingMinPriorBodyPercent: 0,
  sweepLookback: 20,
  horizons: [1, 2, 4, 8, 16],
  minimumEvents: 30,
  confidenceLevel: 0.95,
} as const;

export type PriceActionStudyBar = {
  time: number;
  timeIso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  forming?: boolean;
};

export type PriceActionPattern = "pin" | "engulfing" | "sweep";
export const PRICE_ACTION_PATTERNS = ["pin", "engulfing", "sweep"] as const;

export type PriceActionHorizonResult = {
  horizon: number;
  events: number;
  meanBps: number;
  lowerBps: number;
  upperBps: number;
  /**
   * These bounds use an IID normal approximation only. Pattern signals and their forward windows
   * overlap in time, so the interval is descriptive and cannot make a candidate eligible.
   */
  intervalMethod: "iid_normal_approximation_descriptive_only";
  /**
   * Mean absolute move of any bar in the same clock hours at this same horizon, weighted by where
   * the pattern fires. A scale to read meanBps against, never a threshold it has to clear: this is
   * an absolute move and meanBps is a signed one.
   */
  hourMatchedAbsoluteMoveBps: number;
};

export type PriceActionPatternStudy = {
  schema_version: "1.0";
  methodology_version: string;
  contract: typeof PRICE_ACTION_PATTERN_STUDY_V1;
  symbol: string;
  timeframe: string;
  bars: { closed: number; from: string | null; to: string | null; spacingSeconds: number | null };
  patterns: Record<PriceActionPattern, {
    events: number;
    bullish: number;
    bearish: number;
    triggerHourShare: Record<string, number>;
    horizons: PriceActionHorizonResult[];
  }>;
  limitations: string[];
  qualityIssues: string[];
};

function detectSignals(bars: PriceActionStudyBar[], contract: typeof PRICE_ACTION_PATTERN_STUDY_V1) {
  const signals: Array<{ index: number; pin: number; engulfing: number; sweep: number }> = [];
  for (let i = contract.sweepLookback; i < bars.length; i += 1) {
    const bar = bars[i], prior = bars[i - 1];
    const range = bar.high - bar.low;
    if (!(range > 0)) continue;
    const bodyHigh = Math.max(bar.open, bar.close);
    const bodyLow = Math.min(bar.open, bar.close);
    const upper = (bar.high - bodyHigh) / range * 100;
    const lower = (bodyLow - bar.low) / range * 100;
    const body = (bodyHigh - bodyLow) / range * 100;

    let pin = 0;
    if (lower >= contract.pinWickPercent && body <= contract.pinMaxBodyPercent && upper <= contract.pinMaxOppositeWickPercent) pin = 1;
    else if (upper >= contract.pinWickPercent && body <= contract.pinMaxBodyPercent && lower <= contract.pinMaxOppositeWickPercent) pin = -1;

    const priorBodyHigh = Math.max(prior.open, prior.close);
    const priorBodyLow = Math.min(prior.open, prior.close);
    const priorRange = prior.high - prior.low;
    const priorBody = priorRange > 0 ? (priorBodyHigh - priorBodyLow) / priorRange * 100 : 0;
    const covers = bodyHigh >= priorBodyHigh && bodyLow <= priorBodyLow && priorBody >= contract.engulfingMinPriorBodyPercent;
    let engulfing = 0;
    if (covers && bar.close > bar.open && (!contract.engulfingNeedsOppositePriorBody || prior.close < prior.open)) engulfing = 1;
    else if (covers && bar.close < bar.open && (!contract.engulfingNeedsOppositePriorBody || prior.close > prior.open)) engulfing = -1;

    let highest = -Infinity, lowest = Infinity;
    for (let k = i - contract.sweepLookback; k < i; k += 1) {
      if (bars[k].high > highest) highest = bars[k].high;
      if (bars[k].low < lowest) lowest = bars[k].low;
    }
    let sweep = 0;
    if (bar.low < lowest && bar.close > lowest) sweep = 1;
    else if (bar.high > highest && bar.close < highest) sweep = -1;

    if (pin !== 0 || engulfing !== 0 || sweep !== 0) signals.push({ index: i, pin, engulfing, sweep });
  }
  return signals;
}

/** Modal gap between consecutive bars, which is what a horizon has to be a whole number of. */
function barSpacingSeconds(bars: PriceActionStudyBar[]): number | null {
  const counts = new Map<number, number>();
  for (let i = 1; i < bars.length; i += 1) {
    const gap = bars[i].time - bars[i - 1].time;
    if (gap > 0) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  let best: number | null = null, bestCount = 0;
  for (const [gap, count] of counts) if (count > bestCount) { best = gap; bestCount = count; }
  return best;
}

export function runPriceActionPatternStudy(input: {
  bars: PriceActionStudyBar[];
  symbol: string;
  timeframe: string;
}): PriceActionPatternStudy {
  const contract = PRICE_ACTION_PATTERN_STUDY_V1;
  const closed = input.bars.filter((bar) => bar.forming !== true);
  const spacing = barSpacingSeconds(closed);
  const qualityIssues: string[] = [];
  if (closed.length < contract.sweepLookback + Math.max(...contract.horizons) + 1) {
    qualityIssues.push("insufficient_bars_for_the_longest_horizon");
  }
  if (spacing === null) qualityIssues.push("bar_spacing_could_not_be_determined");

  const signals = detectSignals(closed, contract);
  // A horizon is a span of time, not a count of rows. Sessions break, so a window whose endpoints
  // are not exactly h spacings apart is measuring something longer than it claims.
  const contiguous = (i: number, h: number) =>
    spacing !== null && i + h < closed.length && closed[i + h].time - closed[i].time === h * spacing;

  // How far any bar in a given clock hour travels over each horizon. A pattern that only fires in
  // one part of the day would otherwise report that part of the day's ordinary movement as its own.
  //
  // This is a scale, not a threshold. It is a mean absolute move and the pattern statistic is a mean
  // signed move, and mean(|X|) is never below |mean(X)| - so "beat the baseline" is a test nothing
  // can pass, and asking a caller to apply it would have them reject a real edge. What it answers is
  // how big the pattern's mean is next to the movement already present in the hours it fires in.
  const meanOf = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const hourAbsolute = new Map<number, Map<number, number[]>>();
  for (const horizon of contract.horizons) {
    const byHour = new Map<number, number[]>();
    for (let i = 0; i < closed.length; i += 1) {
      if (!contiguous(i, horizon)) continue;
      const hour = Number(closed[i].timeIso.slice(11, 13));
      if (!byHour.has(hour)) byHour.set(hour, []);
      byHour.get(hour)!.push(Math.abs(Math.log(closed[i + horizon].close / closed[i].close)) * 1e4);
    }
    hourAbsolute.set(horizon, byHour);
  }
  /**
   * Weighted by where the pattern fires. An hour with no sample of its own is dropped from both
   * sides of the average rather than contributing zero to the numerator - counting it as zero would
   * push the scale down hardest for a pattern confined to the hours the series covers worst, which
   * is the case this number exists to expose.
   */
  const hourWeightedAbsolute = (hourCounts: Map<number, number>, horizon: number) => {
    const byHour = hourAbsolute.get(horizon)!;
    let total = 0;
    let weight = 0;
    for (const [hour, count] of hourCounts) {
      const sample = byHour.get(hour);
      if (sample === undefined || sample.length === 0) continue;
      total += meanOf(sample) * count;
      weight += count;
    }
    return weight === 0 ? Number.NaN : total / weight;
  };

  const patterns = {} as PriceActionPatternStudy["patterns"];
  for (const pattern of PRICE_ACTION_PATTERNS) {
    const fired = signals.filter((signal) => signal[pattern] !== 0);
    const hourCounts = new Map<number, number>();
    for (const signal of fired) {
      const hour = Number(closed[signal.index].timeIso.slice(11, 13));
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }
    const horizons = contract.horizons.map((horizon) => {
      const returns: number[] = [];
      for (const signal of fired) {
        if (!contiguous(signal.index, horizon)) continue;
        returns.push(signal[pattern] * Math.log(closed[signal.index + horizon].close / closed[signal.index].close) * 1e4);
      }
      if (returns.length < contract.minimumEvents) {
        return { horizon, events: returns.length, meanBps: Number.NaN, lowerBps: Number.NaN, upperBps: Number.NaN, intervalMethod: "iid_normal_approximation_descriptive_only" as const, hourMatchedAbsoluteMoveBps: hourWeightedAbsolute(hourCounts, horizon) };
      }
      const mean = meanOf(returns);
      const variance = returns.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (returns.length - 1);
      const half = 1.96 * Math.sqrt(variance / returns.length);
      return { horizon, events: returns.length, meanBps: mean, lowerBps: mean - half, upperBps: mean + half, intervalMethod: "iid_normal_approximation_descriptive_only" as const, hourMatchedAbsoluteMoveBps: hourWeightedAbsolute(hourCounts, horizon) };
    });

    if (fired.length < contract.minimumEvents) qualityIssues.push(`minimum_event_count_not_met:${pattern}`);
    patterns[pattern] = {
      events: fired.length,
      bullish: fired.filter((signal) => signal[pattern] === 1).length,
      bearish: fired.filter((signal) => signal[pattern] === -1).length,
      triggerHourShare: Object.fromEntries([...hourCounts].sort((a, b) => a[0] - b[0])
        .map(([hour, count]) => [String(hour).padStart(2, "0"), count / Math.max(1, fired.length)])),
      horizons,
    };
  }

  return {
    schema_version: "1.0",
    methodology_version: contract.methodologyVersion,
    contract,
    symbol: input.symbol,
    timeframe: input.timeframe,
    bars: {
      closed: closed.length,
      from: closed[0]?.timeIso ?? null,
      to: closed.at(-1)?.timeIso ?? null,
      spacingSeconds: spacing,
    },
    patterns,
    limitations: [
      "forward_returns_overlap_and_are_serially_correlated;_iid_normal_intervals_are_descriptive_only",
      "no_candidate_eligibility_or_trade_adoption_claim_is_produced_by_this_study",
    ],
    qualityIssues,
  };
}

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

/**
 * Names alone are not the contract. A study can carry every expected label and still be running a
 * 35% pin wick with confirmation switched off, at which point the returned signals mean something
 * other than what this module says they mean.
 */
export function readPriceActionSettings(study: IndicatorInputs): Record<string, number | boolean> {
  const settings: Record<string, number | boolean> = {};
  for (const expected of PRICE_ACTION_CONTEXT_INPUTS) {
    const domain = PRICE_ACTION_CONTEXT_INPUT_DOMAINS[expected.id];
    const value = study.inputs.find((input) => input.id === expected.id)?.value;
    if (domain.kind === "bool") {
      if (typeof value !== "boolean") throw new Error(`${expected.name} must be a boolean`);
    } else if (typeof value !== "number" || !Number.isInteger(value) || value < domain.min || value > domain.max) {
      throw new Error(`${expected.name} must be an integer in [${domain.min}, ${domain.max}]`);
    }
    settings[expected.name] = value as number | boolean;
  }
  return settings;
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

  const settings = readPriceActionSettings(study);
  // Confirmation is not a threshold, it decides what a signal means: with it off a non-zero reading
  // can appear on a bar that has not closed and be gone by the time it does. Every statement this
  // module makes about an unconfirmed bar assumes it is on, so it is refused rather than reported.
  if (settings["Confirm On Bar Close"] !== true) {
    throw new Error(`study ${study.id} has Confirm On Bar Close switched off, so its signals can change after they are read`);
  }
  const changed = PRICE_ACTION_CONTEXT_INPUTS
    .filter((input) => settings[input.name] !== PRICE_ACTION_CONTEXT_INPUT_DOMAINS[input.id].auditedDefault)
    .map((input) => `${input.name}=${settings[input.name]}`);

  // Anything other than the two values the plot can emit means the row is not what it claims to be,
  // and reading it as "unconfirmed" would turn a broken read into an ordinary in-progress bar.
  const confirmedPlot = raw["Bar Confirmed"];
  if (confirmedPlot !== 0 && confirmedPlot !== 1) {
    throw new Error("Bar Confirmed must be 0 or 1");
  }
  const barConfirmed = confirmedPlot === 1;
  const qualityIssues = [
    ...(barConfirmed ? [] : ["bar_not_closed"]),
    // The rules still hold, but they are not the audited defaults the study contract measures with.
    ...(changed.length === 0 ? [] : [`settings_differ_from_audited_defaults:${changed.join(",")}`]),
  ];

  // A zero-range bar has no shape to report, and the Pine side emits na rather than dividing by it.
  const shapePlots = ["Upper Wick %", "Lower Wick %", "Body %"] as const;
  const shapeMissing = shapePlots.some((plot) => raw[plot] === null || raw[plot] === undefined);
  if (shapeMissing) {
    return {
      status: "unavailable",
      settings,
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
    settings,
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
