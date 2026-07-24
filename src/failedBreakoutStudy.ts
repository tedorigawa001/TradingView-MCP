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

type Direction = 1 | -1;
type Branch = "failed_breakout_up" | "failed_breakout_down";

type RegimeInput = {
  trendLookback: number; atrLookback: number; volatilityBaselineLookback: number;
  trendEfficiencyThreshold: number; rangeEfficiencyThreshold: number;
  directionalMoveAtrThreshold: number; highVolatilityRatio: number; lowVolatilityRatio: number;
  minimumClassifiedBars: number; minimumGroupEvents: number; minimumCoverageRatio: number;
  maxRegimeAgeBars: number;
};

export interface FailedBreakoutStudyInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  timezone: string;
  rangeStart: string;
  rangeEnd: string;
  failureEnd: string;
  confirmationBars: number;
  minimumRangeCoverage: number;
  horizons: number[];
  targetReturnBps: number;
  minimumEvents: number;
  folds: SessionAuctionFold[];
  eventLimit: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  configurationTrials: number | null;
  regime: RegimeInput | null;
}

function clockMinute(value: string, label: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`${label} must use HH:MM`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function validate(input: FailedBreakoutStudyInput) {
  const timeframe = timeframeMinutes(input.timeframe);
  const start = clockMinute(input.rangeStart, "range_start");
  const end = clockMinute(input.rangeEnd, "range_end");
  const failureEnd = clockMinute(input.failureEnd, "failure_end");
  if (!(start < end && end < failureEnd)) throw new Error("failed breakout clocks must satisfy range_start < range_end < failure_end on one local day");
  if (failureEnd - start < timeframe) throw new Error("failed breakout session must span at least one chart bar");
  if (!Number.isInteger(input.confirmationBars) || input.confirmationBars < 0 || input.confirmationBars > 4) {
    throw new Error("confirmation bars must be an integer from 0 to 4");
  }
  if (!(input.minimumRangeCoverage > 0 && input.minimumRangeCoverage <= 1)) throw new Error("minimum range coverage must be greater than zero and at most one");
  if (input.horizons.length < 1 || input.horizons.length > 8 || input.horizons.some((value) => !Number.isInteger(value) || value < 1 || value > 96) || new Set(input.horizons).size !== input.horizons.length) throw new Error("invalid event-study horizons");
  if (![0.9, 0.95, 0.99].includes(input.confidenceLevel)) throw new Error("unsupported confidence level");
  if (input.configurationTrials !== null && (!Number.isInteger(input.configurationTrials) || input.configurationTrials < 1 || input.configurationTrials > 100_000)) throw new Error("configuration trials must be an integer from 1 to 100000");
}

export function runFailedBreakoutStudy(input: FailedBreakoutStudyInput) {
  validate(input);
  const timeframe = timeframeMinutes(input.timeframe);
  const timeframeMs = timeframe * 60_000;
  const rangeStart = clockMinute(input.rangeStart, "range_start");
  const rangeEnd = clockMinute(input.rangeEnd, "range_end");
  const failureEnd = clockMinute(input.failureEnd, "failure_end");
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.length < 3) throw new Error("at least three OHLC bars are required");
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) throw new Error("duplicate OHLC timestamps");
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close) || bar.low > bar.high || bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high)) throw new Error("invalid OHLC bar");
  const closed = bars.filter((bar) => bar.forming !== true);
  const localized = localize(closed, input.timezone);
  const expectedRangeBars = Math.ceil((rangeEnd - rangeStart) / timeframe);
  const minimumRangeBars = Math.ceil(expectedRangeBars * input.minimumRangeCoverage);
  const dates = [...new Set(localized.filter((bar) => bar.weekday !== "Sat" && bar.weekday !== "Sun" && bar.localMinute >= rangeStart && bar.localMinute < rangeEnd).map((bar) => bar.localDate))];
  const quality = { localDays: new Set(localized.map((bar) => bar.localDate)).size, candidateDays: dates.length, eligibleDays: 0, insufficientRangeCoverage: 0, noSweep: 0, ambiguousBothSides: 0, failedConfirmation: 0, formingBarsExcluded: bars.length - closed.length };
  const detected: Array<{ eventId: string; localDate: string; branch: Branch; direction: Direction; rangeHigh: number; rangeLow: number; rangeBars: number; sweepTime: string; signalIndex: number }> = [];

  for (const localDate of dates) {
    const day = localized.filter((bar) => bar.localDate === localDate);
    const range = day.filter((bar) => bar.localMinute >= rangeStart && bar.localMinute < rangeEnd);
    if (range.length < minimumRangeBars) { quality.insufficientRangeCoverage += 1; continue; }
    const rangeHigh = Math.max(...range.map((bar) => bar.high));
    const rangeLow = Math.min(...range.map((bar) => bar.low));
    const window = day.filter((bar) => bar.localMinute >= rangeEnd && bar.localMinute < failureEnd);
    const sweep = window.find((bar) => bar.high > rangeHigh || bar.low < rangeLow);
    if (!sweep) { quality.noSweep += 1; continue; }
    const sweptUp = sweep.high > rangeHigh;
    const sweptDown = sweep.low < rangeLow;
    if (sweptUp === sweptDown) { quality.ambiguousBothSides += 1; continue; }
    const rejected = sweptUp ? sweep.close < rangeHigh : sweep.close > rangeLow;
    if (!rejected) { quality.noSweep += 1; continue; }
    const direction: Direction = sweptUp ? -1 : 1;
    const sweepPosition = window.indexOf(sweep);
    const confirmation = window.slice(sweepPosition + 1, sweepPosition + 1 + input.confirmationBars);
    const confirmationPasses = confirmation.length === input.confirmationBars && confirmation.every((bar, index) => {
      const priorClose = index === 0 ? sweep.close : confirmation[index - 1].close;
      return direction === 1 ? bar.close > priorClose : bar.close < priorClose;
    });
    if (!confirmationPasses) { quality.failedConfirmation += 1; continue; }
    const terminal = confirmation.at(-1) ?? sweep;
    quality.eligibleDays += 1;
    detected.push({ eventId: `${localDate}:${sweptUp ? "failed_breakout_up" : "failed_breakout_down"}`, localDate,
      branch: sweptUp ? "failed_breakout_up" : "failed_breakout_down", direction, rangeHigh, rangeLow,
      rangeBars: range.length, sweepTime: sweep.timeIso, signalIndex: terminal.globalIndex });
  }
  const events = detected.map((event) => outcomeForEvent(event, closed, input.horizons, timeframeMs, input.targetReturnBps));
  const folds = input.folds.map((fold) => ({ ...fold, fromMs: canonicalTime(fold.from, `${fold.foldId}.from`), toMs: canonicalTime(fold.to, `${fold.foldId}.to`) }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) throw new Error("event-study folds must not overlap");
  const branches = ["failed_breakout_up", "failed_breakout_down"] as const;
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [branch, { events: selected.length, horizons: summarizeOutcomes(selected, input.horizons, input.confidenceLevel, "global") }];
  }));
  const foldResults = folds.map((fold) => {
    const selected = events.filter((event) => { const time = Date.parse(event.signalTime); return time >= fold.fromMs && time < fold.toMs; });
    return { foldId: fold.foldId, from: fold.from, to: fold.to, events: selected.length, byBranch: Object.fromEntries(branches.map((branch) => {
      const branchEvents = selected.filter((event) => event.branch === branch);
      return [branch, { events: branchEvents.length, horizons: summarizeOutcomes(branchEvents, input.horizons, input.confidenceLevel, "fold") }];
    })) };
  });
  const regimeEvidence = input.regime === null ? null : computeMarketRegimes({ bars: input.bars, symbol: input.symbol, timeframe: input.timeframe, trendLookback: input.regime.trendLookback, atrLookback: input.regime.atrLookback, volatilityBaselineLookback: input.regime.volatilityBaselineLookback, trendEfficiencyThreshold: input.regime.trendEfficiencyThreshold, rangeEfficiencyThreshold: input.regime.rangeEfficiencyThreshold, directionalMoveAtrThreshold: input.regime.directionalMoveAtrThreshold, highVolatilityRatio: input.regime.highVolatilityRatio, lowVolatilityRatio: input.regime.lowVolatilityRatio, minimumClassifiedBars: input.regime.minimumClassifiedBars, observationLimit: input.bars.length });
  const regimeResolutionMs = input.regime === null ? null : marketRegimeResolutionMilliseconds(input.timeframe);
  if (input.regime !== null && (regimeResolutionMs === null || regimeResolutionMs <= 0)) throw new Error(`event regime join does not support timeframe ${JSON.stringify(input.timeframe)}`);
  const regimeAnalysis = input.regime === null || regimeEvidence === null || regimeResolutionMs === null ? null : buildEventRegimeAnalysis(events, regimeEvidence.observations, regimeResolutionMs, input.horizons, input.confidenceLevel, input.regime.minimumGroupEvents, input.regime.minimumCoverageRatio, input.regime.maxRegimeAgeBars);
  const issues = [...(events.length < input.minimumEvents ? ["minimum_event_count_not_met"] : []), ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []), ...(quality.insufficientRangeCoverage > 0 ? ["one_or_more_sessions_have_incomplete_range"] : []), ...(regimeEvidence?.status === "partial" ? ["regime_classification_incomplete"] : []), ...(regimeAnalysis?.qualityIssues ?? [])];
  return {
    schemaVersion: "1.0" as const, methodologyVersion: input.regime === null ? "failed_breakout_study_v1" as const : "failed_breakout_regime_study_v1" as const,
    status: issues.length === 0 ? "complete" as const : "partial" as const, symbol: input.symbol, timeframe: input.timeframe,
    session: { timezone: input.timezone, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, failureEnd: input.failureEnd, confirmationBars: input.confirmationBars, minimumRangeCoverage: input.minimumRangeCoverage },
    conditionContract: { range: "closed_bars_in_configured_local_session", sweep: "first_post_range_bar_to_trade_outside_range", rejection: "same_sweep_bar_closes_back_inside_range", confirmation: "configured_subsequent_closes_each_extend_opposite_to_sweep", oneEventPerLocalDay: true, ambiguousTwoSidedSweepExcluded: true },
    outcomeContract: { reference: "signal_bar_close_event_study_only_not_assumed_fill", horizons: input.horizons, targetReturnBps: input.targetReturnBps, contiguousBarsRequired: true },
    inferenceContract: { confidenceLevel: input.confidenceLevel, meanIntervalMethod: "normal_approximation", rateIntervalMethod: "wilson_score", serialDependenceAdjustment: "none", multipleTestingAdjustment: "none", configurationTrials: input.configurationTrials, trialTrackingStatus: input.configurationTrials === null ? "not_declared" : "declared", inferenceScope: "global_branch_horizon_primary_outcomes_only", configuredMetricIntervals: branches.length * input.horizons.length * 3 },
    inferenceWarnings: [...(input.configurationTrials === null ? ["configuration_trial_count_not_declared"] : []), "confidence_intervals_do_not_adjust_for_serial_dependence", "no_multiple_testing_adjustment_applied", ...(input.regime === null ? [] : ["regime_subgroups_expand_the_number_of_inspected_outcomes"])],
    foldContract: { detail: "compact_directional_outcomes", fields: ["availableEvents", "unavailableEvents", "directionalReturn.count", "directionalReturn.mean", "directionalReturn.median", "positiveRate", "targetHitRate"], omitted: ["confidenceIntervals", "mfe", "mae", "targetHitBars"] },
    sample: { barsReceived: input.bars.length, closedBars: closed.length, events: events.length, minimumEvents: input.minimumEvents }, quality, qualityIssues: issues, byBranch, folds: foldResults,
    ...(regimeEvidence === null ? {} : { regimeEvidence: { methodologyVersion: regimeEvidence.methodologyVersion, status: regimeEvidence.status, thresholds: regimeEvidence.thresholds, sample: regimeEvidence.sample, quality: regimeEvidence.quality, qualityIssues: regimeEvidence.qualityIssues, distribution: regimeEvidence.distribution }, regimeAnalysis }),
    events: events.slice(0, input.eventLimit).map((event) => ({ eventId: event.eventId, localDate: event.localDate, branch: event.branch, direction: event.direction === 1 ? "long" : "short", rangeHigh: event.rangeHigh, rangeLow: event.rangeLow, rangeBars: event.rangeBars, sweepTime: event.sweepTime, signalTime: event.signalTime, signalPrice: event.signalPrice, outcomes: event.outcomes })),
    eventsReturned: Math.min(events.length, input.eventLimit), eventsTruncated: events.length > input.eventLimit,
  };
}
