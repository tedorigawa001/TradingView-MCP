import type { OhlcvBar } from "./tradingview.js";
import {
  buildEventRegimeAnalysis,
  canonicalTime,
  outcomeForEvent,
  summarizeOutcomes,
  timeframeMinutes,
  type SessionAuctionFold,
} from "./sessionAuctionStudy.js";
import { computeMarketRegimes, marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

type Direction = 1 | -1;
type Branch = "retest_up" | "retest_down";

export interface EventAftershockRetestStudyInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  events: Array<{ eventId: string; occurredAt: string }>;
  initialRangeBars: number;
  breakoutWithinBars: number;
  retestWithinBars: number;
  overlapPolicy: "exclude_later_event";
  requireRetestCloseOutside: boolean;
  minimumInitialRangeCoverage: number;
  horizons: number[];
  targetReturnBps: number;
  minimumEvents: number;
  folds: SessionAuctionFold[];
  eventLimit: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  configurationTrials: number | null;
  regime: {
    trendLookback: number; atrLookback: number; volatilityBaselineLookback: number;
    trendEfficiencyThreshold: number; rangeEfficiencyThreshold: number;
    directionalMoveAtrThreshold: number; highVolatilityRatio: number; lowVolatilityRatio: number;
    minimumClassifiedBars: number; minimumGroupEvents: number; minimumCoverageRatio: number;
    maxRegimeAgeBars: number;
  } | null;
}

function contiguous(bars: OhlcvBar[], timeframeMs: number): boolean {
  return bars.length < 2 || bars.slice(1).every((bar, index) =>
    bar.time * 1000 - bars[index].time * 1000 <= timeframeMs * 1.5);
}

function validate(input: EventAftershockRetestStudyInput) {
  timeframeMinutes(input.timeframe);
  if (input.events.length < 1 || input.events.length > 200) throw new Error("event aftershock study requires one to 200 events");
  if (input.events.some((event) => !/^[A-Za-z0-9_.:-]{1,120}$/.test(event.eventId))) {
    throw new Error("event ids must use letters, digits, _, ., :, or -");
  }
  if (new Set(input.events.map((event) => event.eventId)).size !== input.events.length) throw new Error("event ids must be unique");
  const eventTimes = input.events.map((event) => canonicalTime(event.occurredAt, `${event.eventId}.occurredAt`));
  if (new Set(eventTimes).size !== eventTimes.length) throw new Error("event timestamps must be unique");
  for (const [label, value, maximum] of [
    ["initial range bars", input.initialRangeBars, 24],
    ["breakout window", input.breakoutWithinBars, 96],
    ["retest window", input.retestWithinBars, 96],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${label} must be an integer from 1 to ${maximum}`);
  }
  if (!(input.minimumInitialRangeCoverage > 0 && input.minimumInitialRangeCoverage <= 1)) {
    throw new Error("minimum initial range coverage must be greater than zero and at most one");
  }
  if (input.horizons.length < 1 || input.horizons.length > 8 || input.horizons.some((value) => !Number.isInteger(value) || value < 1 || value > 96) ||
      new Set(input.horizons).size !== input.horizons.length) throw new Error("invalid event-study horizons");
  if (![0.9, 0.95, 0.99].includes(input.confidenceLevel)) throw new Error("unsupported confidence level");
  if (input.configurationTrials !== null && (!Number.isInteger(input.configurationTrials) || input.configurationTrials < 1 || input.configurationTrials > 100_000)) {
    throw new Error("configuration trials must be an integer from 1 to 100000");
  }
}

export function runEventAftershockRetestStudy(input: EventAftershockRetestStudyInput) {
  validate(input);
  const timeframeMs = timeframeMinutes(input.timeframe) * 60_000;
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.length < 3) throw new Error("at least three OHLC bars are required");
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) throw new Error("duplicate OHLC timestamps");
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close) ||
      bar.low > bar.high || bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high)) {
    throw new Error("invalid OHLC bar");
  }
  const closed = bars.filter((bar) => bar.forming !== true);
  const byStartTime = new Map(closed.map((bar, index) => [bar.time * 1000, { bar, index }]));
  const minimumInitialBars = Math.ceil(input.initialRangeBars * input.minimumInitialRangeCoverage);
  const maximumEvaluationWindowBars = input.initialRangeBars + input.breakoutWithinBars + input.retestWithinBars + Math.max(...input.horizons);
  const minimumEventSeparationMilliseconds = maximumEvaluationWindowBars * timeframeMs;
  const orderedEvents = input.events.map((event) => ({ ...event,
    occurredAtMs: canonicalTime(event.occurredAt, `${event.eventId}.occurredAt`) }))
    .sort((left, right) => left.occurredAtMs - right.occurredAtMs);
  const selectedEvents: typeof orderedEvents = [];
  let overlappingEventsExcluded = 0;
  for (const event of orderedEvents) {
    const prior = selectedEvents.at(-1);
    if (prior && event.occurredAtMs - prior.occurredAtMs < minimumEventSeparationMilliseconds) {
      overlappingEventsExcluded += 1;
      continue;
    }
    selectedEvents.push(event);
  }
  const quality = {
    suppliedEvents: input.events.length,
    eventsAfterOverlapPolicy: selectedEvents.length,
    overlappingEventsExcluded,
    alignedEvents: 0,
    insufficientInitialRangeCoverage: 0,
    irregularInitialRange: 0,
    insufficientBreakoutWindow: 0,
    irregularBreakoutWindow: 0,
    noBreakout: 0,
    insufficientRetestWindow: 0,
    irregularRetestWindow: 0,
    noRetest: 0,
    retestClosedInsideRange: 0,
    formingBarsExcluded: bars.length - closed.length,
  };
  const detected: Array<{
    eventId: string; occurredAt: string; branch: Branch; direction: Direction; initialRangeHigh: number; initialRangeLow: number;
    initialRangeBars: number; breakoutTime: string; signalIndex: number;
  }> = [];

  for (const event of selectedEvents) {
    const aligned = byStartTime.get(event.occurredAtMs);
    if (!aligned) { quality.insufficientInitialRangeCoverage += 1; continue; }
    quality.alignedEvents += 1;
    const initial = closed.slice(aligned.index, aligned.index + input.initialRangeBars);
    if (initial.length < minimumInitialBars) { quality.insufficientInitialRangeCoverage += 1; continue; }
    if (initial.length < input.initialRangeBars) { quality.insufficientInitialRangeCoverage += 1; continue; }
    if (!contiguous(initial, timeframeMs)) { quality.irregularInitialRange += 1; continue; }
    const initialRangeHigh = Math.max(...initial.map((bar) => bar.high));
    const initialRangeLow = Math.min(...initial.map((bar) => bar.low));
    const breakoutWindow = closed.slice(aligned.index + input.initialRangeBars,
      aligned.index + input.initialRangeBars + input.breakoutWithinBars);
    if (breakoutWindow.length < input.breakoutWithinBars) { quality.insufficientBreakoutWindow += 1; continue; }
    if (!contiguous([...initial.slice(-1), ...breakoutWindow], timeframeMs)) { quality.irregularBreakoutWindow += 1; continue; }
    const breakoutAt = breakoutWindow.findIndex((bar) => bar.close > initialRangeHigh || bar.close < initialRangeLow);
    if (breakoutAt < 0) { quality.noBreakout += 1; continue; }
    const breakout = breakoutWindow[breakoutAt];
    const direction: Direction = breakout.close > initialRangeHigh ? 1 : -1;
    const retestStart = aligned.index + input.initialRangeBars + breakoutAt + 1;
    const retestWindow = closed.slice(retestStart, retestStart + input.retestWithinBars);
    if (retestWindow.length < input.retestWithinBars) { quality.insufficientRetestWindow += 1; continue; }
    if (!contiguous([breakout, ...retestWindow], timeframeMs)) { quality.irregularRetestWindow += 1; continue; }
    const retestAt = retestWindow.findIndex((bar) => direction === 1 ? bar.low <= initialRangeHigh : bar.high >= initialRangeLow);
    if (retestAt < 0) { quality.noRetest += 1; continue; }
    const signal = retestWindow[retestAt];
    const heldOutside = direction === 1 ? signal.close >= initialRangeHigh : signal.close <= initialRangeLow;
    if (input.requireRetestCloseOutside && !heldOutside) { quality.retestClosedInsideRange += 1; continue; }
    detected.push({
      eventId: `${event.eventId}:${direction === 1 ? "retest_up" : "retest_down"}`,
      occurredAt: event.occurredAt,
      branch: direction === 1 ? "retest_up" : "retest_down",
      direction,
      initialRangeHigh,
      initialRangeLow,
      initialRangeBars: initial.length,
      breakoutTime: breakout.timeIso,
      signalIndex: closed.indexOf(signal),
    });
  }

  const events = detected.map((event) => outcomeForEvent(event, closed, input.horizons, timeframeMs, input.targetReturnBps));
  const folds = input.folds.map((fold) => ({ ...fold, fromMs: canonicalTime(fold.from, `${fold.foldId}.from`), toMs: canonicalTime(fold.to, `${fold.foldId}.to`) }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("event-study folds must not overlap");
  }
  const branches = ["retest_up", "retest_down"] as const;
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [branch, { events: selected.length, horizons: summarizeOutcomes(selected, input.horizons, input.confidenceLevel, "global") }];
  }));
  const foldResults = folds.map((fold) => {
    const selected = events.filter((event) => { const time = Date.parse(event.signalTime); return time >= fold.fromMs && time < fold.toMs; });
    return { foldId: fold.foldId, from: fold.from, to: fold.to, events: selected.length,
      byBranch: Object.fromEntries(branches.map((branch) => {
        const branchEvents = selected.filter((event) => event.branch === branch);
        return [branch, { events: branchEvents.length, horizons: summarizeOutcomes(branchEvents, input.horizons, input.confidenceLevel, "fold") }];
      })) };
  });
  const regimeEvidence = input.regime === null ? null : computeMarketRegimes({ bars: input.bars, symbol: input.symbol, timeframe: input.timeframe,
    trendLookback: input.regime.trendLookback, atrLookback: input.regime.atrLookback, volatilityBaselineLookback: input.regime.volatilityBaselineLookback,
    trendEfficiencyThreshold: input.regime.trendEfficiencyThreshold, rangeEfficiencyThreshold: input.regime.rangeEfficiencyThreshold,
    directionalMoveAtrThreshold: input.regime.directionalMoveAtrThreshold, highVolatilityRatio: input.regime.highVolatilityRatio,
    lowVolatilityRatio: input.regime.lowVolatilityRatio, minimumClassifiedBars: input.regime.minimumClassifiedBars, observationLimit: input.bars.length });
  const regimeResolutionMs = input.regime === null ? null : marketRegimeResolutionMilliseconds(input.timeframe);
  if (input.regime !== null && (regimeResolutionMs === null || regimeResolutionMs <= 0)) {
    throw new Error(`event regime join does not support timeframe ${JSON.stringify(input.timeframe)}`);
  }
  const regimeAnalysis = input.regime === null || regimeEvidence === null || regimeResolutionMs === null ? null : buildEventRegimeAnalysis(
    events, regimeEvidence.observations, regimeResolutionMs, input.horizons, input.confidenceLevel,
    input.regime.minimumGroupEvents, input.regime.minimumCoverageRatio, input.regime.maxRegimeAgeBars);
  const issues = [
    ...(events.length < input.minimumEvents ? ["minimum_event_count_not_met"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
    ...(quality.insufficientInitialRangeCoverage > 0 || quality.irregularInitialRange > 0 ? ["one_or_more_events_lack_complete_initial_range"] : []),
    ...(quality.insufficientBreakoutWindow > 0 || quality.irregularBreakoutWindow > 0 ? ["one_or_more_events_lack_complete_breakout_window"] : []),
    ...(quality.insufficientRetestWindow > 0 || quality.irregularRetestWindow > 0 ? ["one_or_more_events_lack_complete_retest_window"] : []),
    ...(regimeEvidence?.status === "partial" ? ["regime_classification_incomplete"] : []),
    ...(regimeAnalysis?.qualityIssues ?? []),
  ];
  return {
    schemaVersion: "1.0" as const, methodologyVersion: input.regime === null ? "event_aftershock_retest_study_v1" as const : "event_aftershock_retest_regime_study_v1" as const,
    status: issues.length === 0 ? "complete" as const : "partial" as const, symbol: input.symbol, timeframe: input.timeframe,
    eventContract: { eventTimes: "caller_supplied_canonical_utc_timestamps", eventBar: "closed_bar_starting_exactly_at_occurred_at", initialRange: "first_closed_bars_after_event", breakout: "first_close_outside_initial_range", retest: "first_boundary_touch_after_breakout", requireRetestCloseOutside: input.requireRetestCloseOutside, duplicateEventTimestampsRejected: true, overlapPolicy: input.overlapPolicy, laterEventExcludedWhenStartWithinMaximumEvaluationWindow: true, maximumEvaluationWindowBars, minimumEventSeparationMilliseconds },
    parameters: { initialRangeBars: input.initialRangeBars, breakoutWithinBars: input.breakoutWithinBars, retestWithinBars: input.retestWithinBars, minimumInitialRangeCoverage: input.minimumInitialRangeCoverage, overlapPolicy: input.overlapPolicy },
    outcomeContract: { reference: "retest_bar_close_event_study_only_not_assumed_fill", horizons: input.horizons, targetReturnBps: input.targetReturnBps, contiguousBarsRequired: true },
    inferenceContract: { confidenceLevel: input.confidenceLevel, meanIntervalMethod: "normal_approximation", rateIntervalMethod: "wilson_score", serialDependenceAdjustment: "none", multipleTestingAdjustment: "none", configurationTrials: input.configurationTrials, trialTrackingStatus: input.configurationTrials === null ? "not_declared" : "declared", inferenceScope: "global_branch_horizon_primary_outcomes_only", configuredMetricIntervals: branches.length * input.horizons.length * 3 },
    inferenceWarnings: [...(input.configurationTrials === null ? ["configuration_trial_count_not_declared"] : []), "confidence_intervals_do_not_adjust_for_serial_dependence", "no_multiple_testing_adjustment_applied", "economic_event_times_are_caller_supplied_and_not_independently_verified", ...(input.regime === null ? [] : ["regime_subgroups_expand_the_number_of_inspected_outcomes"])],
    foldContract: { detail: "compact_directional_outcomes", fields: ["availableEvents", "unavailableEvents", "directionalReturn.count", "directionalReturn.mean", "directionalReturn.median", "positiveRate", "targetHitRate"], omitted: ["confidenceIntervals", "mfe", "mae", "targetHitBars"] },
    sample: { barsReceived: input.bars.length, closedBars: closed.length, suppliedEvents: input.events.length, events: events.length, minimumEvents: input.minimumEvents }, quality, qualityIssues: issues, byBranch, folds: foldResults,
    ...(regimeEvidence === null ? {} : { regimeEvidence: { methodologyVersion: regimeEvidence.methodologyVersion, status: regimeEvidence.status, thresholds: regimeEvidence.thresholds, sample: regimeEvidence.sample, quality: regimeEvidence.quality, qualityIssues: regimeEvidence.qualityIssues, distribution: regimeEvidence.distribution }, regimeAnalysis }),
    events: events.slice(0, input.eventLimit).map((event) => ({ eventId: event.eventId, occurredAt: event.occurredAt, branch: event.branch, direction: event.direction === 1 ? "long" : "short", initialRangeHigh: event.initialRangeHigh, initialRangeLow: event.initialRangeLow, initialRangeBars: event.initialRangeBars, breakoutTime: event.breakoutTime, signalTime: event.signalTime, signalPrice: event.signalPrice, outcomes: event.outcomes })),
    eventsReturned: Math.min(events.length, input.eventLimit), eventsTruncated: events.length > input.eventLimit,
  };
}
