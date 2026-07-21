import type { OhlcvBar } from "./tradingview.js";
import {
  buildEventRegimeAnalysis,
  canonicalTime,
  localize,
  outcomeForEvent,
  summarizeOutcomes,
  timeframeMinutes,
  type SessionAuctionFold,
} from "./sessionAuctionStudy.js";
import { computeMarketRegimes, marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

export interface SessionHandoffStudyInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  timezone: string;
  priorSessions: Array<{ sessionId: string; start: string; end: string }>;
  handoffStart: string;
  handoffEnd: string;
  priorDirection: "range_break" | "session_return" | "close_location";
  directionMinimumReturnBps: number;
  closeLocationThreshold: number;
  handoffWindowBars: number;
  forwardUpdateThresholdBps: number;
  requireRangeReentry: boolean;
  requireOppositeBody: boolean;
  minimumPriorCoverage: number;
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

type Branch = "exhaustion_up" | "exhaustion_down";
type Direction = 1 | -1;

function clockMinute(value: string, label: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`${label} must use HH:MM`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function localDayIndex(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function validate(input: SessionHandoffStudyInput) {
  if (input.priorSessions.length < 1 || input.priorSessions.length > 4) {
    throw new Error("session handoff study requires one to four prior sessions");
  }
  if (new Set(input.priorSessions.map((session) => session.sessionId)).size !== input.priorSessions.length) {
    throw new Error("prior session ids must be unique");
  }
  if (input.priorSessions.some((session) => !/^[A-Za-z0-9_.:-]{1,80}$/.test(session.sessionId))) {
    throw new Error("prior session ids must use letters, digits, _, ., :, or -");
  }
  if (input.priorDirection === "range_break" && input.priorSessions.length < 2) {
    throw new Error("range_break prior direction requires at least two prior sessions");
  }
  if (!Number.isInteger(input.handoffWindowBars) || input.handoffWindowBars < 1 || input.handoffWindowBars > 24) {
    throw new Error("handoff window must be an integer from 1 to 24 bars");
  }
  if (!(input.minimumPriorCoverage > 0 && input.minimumPriorCoverage <= 1)) {
    throw new Error("minimum prior coverage must be greater than zero and at most one");
  }
  if (!(input.closeLocationThreshold >= 0.5 && input.closeLocationThreshold < 1)) {
    throw new Error("close location threshold must be from 0.5 inclusive to 1 exclusive");
  }
  if (input.directionMinimumReturnBps < 0 || input.directionMinimumReturnBps > 10_000 ||
      input.forwardUpdateThresholdBps < 0 || input.forwardUpdateThresholdBps > 10_000) {
    throw new Error("handoff thresholds must be from 0 to 10000 bps");
  }
  if (input.horizons.length < 1 || input.horizons.length > 8 ||
      input.horizons.some((value) => !Number.isInteger(value) || value < 1 || value > 96) ||
      new Set(input.horizons).size !== input.horizons.length) throw new Error("invalid event-study horizons");
  if (![0.9, 0.95, 0.99].includes(input.confidenceLevel)) throw new Error("unsupported confidence level");
  if (input.configurationTrials !== null && (!Number.isInteger(input.configurationTrials) ||
      input.configurationTrials < 1 || input.configurationTrials > 100_000)) {
    throw new Error("configuration trials must be an integer from 1 to 100000");
  }
}

function anchorPriorSessionBeforeHandoff(start: number, end: number, handoffStart: number) {
  const endAfterStart = end <= start ? end + 1440 : end;
  // Sessions ending after the handoff clock belong to the preceding local day.
  return endAfterStart <= handoffStart
    ? { start, end: endAfterStart }
    : { start: start - 1440, end: endAfterStart - 1440 };
}

export function runSessionExhaustionHandoffStudy(input: SessionHandoffStudyInput) {
  validate(input);
  const timeframe = timeframeMinutes(input.timeframe);
  const timeframeMs = timeframe * 60_000;
  const handoffStart = clockMinute(input.handoffStart, "handoff_start");
  const rawHandoffEnd = clockMinute(input.handoffEnd, "handoff_end");
  const handoffEnd = rawHandoffEnd <= handoffStart ? rawHandoffEnd + 1440 : rawHandoffEnd;
  if (handoffEnd - handoffStart < timeframe) throw new Error("handoff session must span at least one chart bar");
  const sessions = input.priorSessions.map((session) => ({ ...session,
    ...anchorPriorSessionBeforeHandoff(clockMinute(session.start, `${session.sessionId}.start`),
      clockMinute(session.end, `${session.sessionId}.end`), handoffStart) }));
  if (sessions.some((session) => session.end > handoffStart)) {
    throw new Error("every prior session must end at or before handoff_start");
  }
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.length < 3) throw new Error("at least three OHLC bars are required");
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) throw new Error("duplicate OHLC timestamps");
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) || bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
      bar.close < bar.low || bar.close > bar.high)) throw new Error("invalid OHLC bar");
  const closed = bars.filter((bar) => bar.forming !== true);
  const localized = localize(closed, input.timezone);
  const expectedPriorBars = sessions.reduce((sum, session) => sum + Math.ceil((session.end - session.start) / timeframe), 0);
  const minimumPriorBars = Math.ceil(expectedPriorBars * input.minimumPriorCoverage);
  const handoffDays = [...new Set(localized.filter((bar) => bar.localMinute >= handoffStart && bar.localMinute < handoffEnd)
    .map((bar) => bar.localDate))];
  const quality = {
    localDays: new Set(localized.map((bar) => bar.localDate)).size,
    candidateHandoffDays: handoffDays.length,
    eligibleDays: 0,
    insufficientPriorCoverage: 0,
    insufficientHandoffCoverage: 0,
    noPriorDirection: 0,
    forwardUpdate: 0,
    noReversalSignal: 0,
    ambiguousForwardAndReversal: 0,
    formingBarsExcluded: bars.length - closed.length,
  };
  const detected: Array<{
    eventId: string; localDate: string; branch: Branch; direction: Direction; priorDirection: Direction;
    priorHigh: number; priorLow: number; priorBars: number; signalIndex: number;
  }> = [];
  for (const localDate of handoffDays) {
    const anchor = localDayIndex(localDate);
    const relativeMinute = (bar: ReturnType<typeof localize>[number]) =>
      (localDayIndex(bar.localDate) - anchor) * 1440 + bar.localMinute;
    const prior = localized.filter((bar) => sessions.some((session) => {
      const minute = relativeMinute(bar);
      return minute >= session.start && minute < session.end;
    }));
    const handoff = localized.filter((bar) => {
      const minute = relativeMinute(bar);
      return minute >= handoffStart && minute < handoffEnd;
    });
    if (prior.length < minimumPriorBars) { quality.insufficientPriorCoverage += 1; continue; }
    if (handoff.length < input.handoffWindowBars) { quality.insufficientHandoffCoverage += 1; continue; }
    const orderedPrior = [...prior].sort((left, right) => left.globalIndex - right.globalIndex);
    const priorHigh = Math.max(...prior.map((bar) => bar.high));
    const priorLow = Math.min(...prior.map((bar) => bar.low));
    const lastPrior = orderedPrior.at(-1)!;
    let priorDirection: Direction | null = null;
    if (input.priorDirection === "session_return") {
      const change = lastPrior.close / orderedPrior[0].open - 1;
      if (Math.abs(change) >= input.directionMinimumReturnBps / 10_000) priorDirection = change > 0 ? 1 : -1;
    } else if (input.priorDirection === "close_location") {
      const location = (lastPrior.close - priorLow) / (priorHigh - priorLow || 1);
      if (location >= input.closeLocationThreshold) priorDirection = 1;
      if (location <= 1 - input.closeLocationThreshold) priorDirection = -1;
    } else {
      const first = sessions[0];
      const initial = prior.filter((bar) => {
        const minute = relativeMinute(bar);
        return minute >= first.start && minute < first.end;
      });
      if (initial.length > 0) {
        const initialHigh = Math.max(...initial.map((bar) => bar.high));
        const initialLow = Math.min(...initial.map((bar) => bar.low));
        if (lastPrior.close > initialHigh) priorDirection = 1;
        if (lastPrior.close < initialLow) priorDirection = -1;
      }
    }
    if (priorDirection === null) { quality.noPriorDirection += 1; continue; }
    quality.eligibleDays += 1;
    const window = handoff.slice(0, input.handoffWindowBars);
    const forward = (bar: typeof window[number]) => priorDirection === 1
      ? bar.high >= priorHigh * (1 + input.forwardUpdateThresholdBps / 10_000)
      : bar.low <= priorLow * (1 - input.forwardUpdateThresholdBps / 10_000);
    const reverse = (bar: typeof window[number]) => {
      const reentered = !input.requireRangeReentry || (bar.close < priorHigh && bar.close > priorLow);
      const oppositeBody = !input.requireOppositeBody || (priorDirection === 1 ? bar.close < bar.open : bar.close > bar.open);
      return reentered && oppositeBody;
    };
    const forwardAt = window.findIndex(forward);
    const reversalAt = window.findIndex(reverse);
    if (forwardAt >= 0 && reversalAt >= 0) { quality.ambiguousForwardAndReversal += 1; continue; }
    if (forwardAt >= 0) { quality.forwardUpdate += 1; continue; }
    if (reversalAt < 0) { quality.noReversalSignal += 1; continue; }
    const signal = window[reversalAt];
    const branch: Branch = priorDirection === 1 ? "exhaustion_up" : "exhaustion_down";
    detected.push({ eventId: `${localDate}:${branch}`, localDate, branch, direction: priorDirection === 1 ? -1 : 1,
      priorDirection, priorHigh, priorLow, priorBars: prior.length, signalIndex: signal.globalIndex });
  }
  const events = detected.map((event) => outcomeForEvent(event, closed, input.horizons, timeframeMs, input.targetReturnBps));
  const folds = input.folds.map((fold) => ({ ...fold, fromMs: canonicalTime(fold.from, `${fold.foldId}.from`),
    toMs: canonicalTime(fold.to, `${fold.foldId}.to`) }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("event-study folds must not overlap");
  }
  const branches = ["exhaustion_up", "exhaustion_down"] as const;
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [branch, { events: selected.length, horizons: summarizeOutcomes(selected, input.horizons, input.confidenceLevel, "global") }];
  }));
  const foldResults = folds.map((fold) => {
    const selected = events.filter((event) => { const time = Date.parse(event.signalTime); return time >= fold.fromMs && time < fold.toMs; });
    return { foldId: fold.foldId, from: fold.from, to: fold.to, events: selected.length,
      byBranch: Object.fromEntries(branches.map((branch) => { const branchEvents = selected.filter((event) => event.branch === branch);
        return [branch, { events: branchEvents.length, horizons: summarizeOutcomes(branchEvents, input.horizons, input.confidenceLevel, "fold") }]; })) };
  });
  const regimeEvidence = input.regime === null ? null : computeMarketRegimes({ bars: input.bars, symbol: input.symbol,
    timeframe: input.timeframe, trendLookback: input.regime.trendLookback, atrLookback: input.regime.atrLookback,
    volatilityBaselineLookback: input.regime.volatilityBaselineLookback, trendEfficiencyThreshold: input.regime.trendEfficiencyThreshold,
    rangeEfficiencyThreshold: input.regime.rangeEfficiencyThreshold, directionalMoveAtrThreshold: input.regime.directionalMoveAtrThreshold,
    highVolatilityRatio: input.regime.highVolatilityRatio, lowVolatilityRatio: input.regime.lowVolatilityRatio,
    minimumClassifiedBars: input.regime.minimumClassifiedBars, observationLimit: input.bars.length });
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
    ...(quality.insufficientPriorCoverage > 0 ? ["one_or_more_prior_sessions_have_incomplete_coverage"] : []),
    ...(quality.insufficientHandoffCoverage > 0 ? ["one_or_more_handoff_windows_are_incomplete"] : []),
    ...(regimeEvidence?.status === "partial" ? ["regime_classification_incomplete"] : []),
    ...(regimeAnalysis?.qualityIssues ?? []),
  ];
  return {
    schemaVersion: "1.0" as const, methodologyVersion: input.regime === null
      ? "session_exhaustion_handoff_event_study_v1" as const : "session_exhaustion_handoff_event_regime_study_v1" as const,
    status: issues.length === 0 ? "complete" as const : "partial" as const, symbol: input.symbol, timeframe: input.timeframe,
    session: { timezone: input.timezone, priorSessions: input.priorSessions, handoffStart: input.handoffStart, handoffEnd: input.handoffEnd,
      priorDirection: input.priorDirection, directionMinimumReturnBps: input.directionMinimumReturnBps,
      closeLocationThreshold: input.closeLocationThreshold, handoffWindowBars: input.handoffWindowBars,
      forwardUpdateThresholdBps: input.forwardUpdateThresholdBps, requireRangeReentry: input.requireRangeReentry,
      requireOppositeBody: input.requireOppositeBody, minimumPriorCoverage: input.minimumPriorCoverage },
    conditionContract: { priorEvidence: "closed_bars_before_handoff_start_only", rangeBreakReference: "first_prior_session_range",
      forwardUpdate: "any_handoff_window_bar_extends_prior_direction", reversal: "configured_range_reentry_and_opposite_body",
      ambiguousForwardAndReversalExcluded: true },
    outcomeContract: { reference: "signal_bar_close_event_study_only_not_assumed_fill", horizons: input.horizons,
      targetReturnBps: input.targetReturnBps, contiguousBarsRequired: true },
    inferenceContract: { confidenceLevel: input.confidenceLevel, meanIntervalMethod: "normal_approximation", rateIntervalMethod: "wilson_score",
      serialDependenceAdjustment: "none", multipleTestingAdjustment: "none", configurationTrials: input.configurationTrials,
      trialTrackingStatus: input.configurationTrials === null ? "not_declared" : "declared",
      inferenceScope: "global_branch_horizon_primary_outcomes_only", configuredMetricIntervals: branches.length * input.horizons.length * 3 },
    inferenceWarnings: [...(input.configurationTrials === null ? ["configuration_trial_count_not_declared"] : []),
      "confidence_intervals_do_not_adjust_for_serial_dependence", "no_multiple_testing_adjustment_applied",
      ...(input.regime === null ? [] : ["regime_subgroups_expand_the_number_of_inspected_outcomes"])],
    foldContract: { detail: "compact_directional_outcomes", fields: ["availableEvents", "unavailableEvents", "directionalReturn.count",
      "directionalReturn.mean", "directionalReturn.median", "positiveRate", "targetHitRate"],
      omitted: ["confidenceIntervals", "mfe", "mae", "targetHitBars"] },
    sample: { barsReceived: input.bars.length, closedBars: closed.length, events: events.length, minimumEvents: input.minimumEvents }, quality,
    qualityIssues: issues, byBranch, folds: foldResults,
    ...(regimeEvidence === null ? {} : { regimeEvidence: { methodologyVersion: regimeEvidence.methodologyVersion, status: regimeEvidence.status,
      thresholds: regimeEvidence.thresholds, sample: regimeEvidence.sample, quality: regimeEvidence.quality,
      qualityIssues: regimeEvidence.qualityIssues, distribution: regimeEvidence.distribution }, regimeAnalysis }),
    events: events.slice(0, input.eventLimit).map((event) => ({ eventId: event.eventId, localDate: event.localDate, branch: event.branch,
      priorDirection: event.priorDirection === 1 ? "up" : "down", direction: event.direction === 1 ? "long" : "short", priorHigh: event.priorHigh,
      priorLow: event.priorLow, priorBars: event.priorBars, signalTime: event.signalTime, signalPrice: event.signalPrice, outcomes: event.outcomes })),
    eventsReturned: Math.min(events.length, input.eventLimit), eventsTruncated: events.length > input.eventLimit,
  };
}
