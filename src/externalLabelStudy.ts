import type { OhlcvBar } from "./tradingview.js";
import {
  buildEventRegimeAnalysis,
  canonicalTime,
  outcomeForEvent,
  summarizeOutcomes,
  type SessionAuctionFold,
} from "./sessionAuctionStudy.js";
import { computeMarketRegimes, marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

type Direction = 1 | -1;

type RegimeInput = {
  trendLookback: number; atrLookback: number; volatilityBaselineLookback: number;
  trendEfficiencyThreshold: number; rangeEfficiencyThreshold: number;
  directionalMoveAtrThreshold: number; highVolatilityRatio: number; lowVolatilityRatio: number;
  minimumClassifiedBars: number; minimumGroupEvents: number; minimumCoverageRatio: number;
  maxRegimeAgeBars: number;
};

export interface ExternalLabelObservation {
  time: string;
  label: string;
}

export interface ExternalLabelAcceptance {
  label: string;
  direction: "long" | "short";
}

export interface ExternalLabelStudyInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  observations: ExternalLabelObservation[];
  acceptedLabels: ExternalLabelAcceptance[];
  observationLagBars: number;
  overlapPolicy: "exclude_later_event" | "allow_overlapping_windows";
  horizons: number[];
  targetReturnBps: number;
  minimumEvents: number;
  folds: SessionAuctionFold[];
  eventLimit: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  configurationTrials: number | null;
  regime: RegimeInput | null;
}

/**
 * Forward-outcome study over caller-supplied point-in-time labels.
 *
 * The caller owns the labels; this study owns only the point-in-time contract and the outcome
 * measurement. An external label carrying the timestamp of bar T is almost never known when bar T
 * closes: exchange open interest, settlement statistics and survey data are all published later.
 * The label is therefore attached to the bar `observation_lag_bars` later, and a lag of zero is
 * refused outright rather than trusted to the caller, because a zero-lag join of a same-bar label
 * is indistinguishable from look-ahead in the result.
 *
 * Horizons count subsequent observed bars rather than contiguous nominal bars, because external
 * labels are usually daily and a daily series is not contiguous across weekends. Calendar gaps are
 * therefore included in the return rather than dropping the window.
 */
export function runExternalLabelStudy(input: ExternalLabelStudyInput) {
  if (!Number.isInteger(input.observationLagBars) || input.observationLagBars < 1 || input.observationLagBars > 20) {
    throw new Error("observation_lag_bars must be an integer from 1 to 20; a zero lag would use a label the market could not have seen");
  }
  if (input.acceptedLabels.length === 0) {
    throw new Error("accepted_labels must name at least one label");
  }
  if (new Set(input.acceptedLabels.map((item) => item.label)).size !== input.acceptedLabels.length) {
    throw new Error("accepted_labels must not repeat a label");
  }

  const directionByLabel = new Map<string, Direction>(
    input.acceptedLabels.map((item) => [item.label, item.direction === "long" ? 1 : -1] as const),
  );

  const closed = input.bars.filter((bar) => !bar.forming);
  const formingBarsExcluded = input.bars.length - closed.length;

  // Exact bar timestamps first. A UTC date is only accepted when exactly one bar carries it, so a
  // coarse daily label can still be joined without silently picking one of several intraday bars.
  const byTime = new Map<number, number>();
  const byDate = new Map<string, number[]>();
  closed.forEach((bar, index) => {
    byTime.set(bar.time * 1000, index);
    const date = bar.timeIso.slice(0, 10);
    const list = byDate.get(date);
    if (list === undefined) byDate.set(date, [index]); else list.push(index);
  });

  const quality = {
    observationsReceived: input.observations.length,
    matchedByExactTime: 0,
    matchedByUniqueDate: 0,
    unmatchedObservations: 0,
    ambiguousDateObservations: 0,
    unacceptedLabelObservations: 0,
    duplicateObservationTimes: 0,
    laggedBeyondLoadedHistory: 0,
    overlappingEventsExcluded: 0,
    formingBarsExcluded,
  };

  const seenTimes = new Set<string>();
  const detected: Array<{ eventId: string; label: string; branch: string; direction: Direction;
    observationTime: string; signalIndex: number }> = [];

  for (const observation of input.observations) {
    const timeMs = canonicalTime(observation.time, "external label observation time");
    if (seenTimes.has(observation.time)) { quality.duplicateObservationTimes += 1; continue; }
    seenTimes.add(observation.time);
    if (!directionByLabel.has(observation.label)) { quality.unacceptedLabelObservations += 1; continue; }

    let barIndex = byTime.get(timeMs);
    if (barIndex === undefined) {
      const candidates = byDate.get(observation.time.slice(0, 10));
      if (candidates === undefined) { quality.unmatchedObservations += 1; continue; }
      if (candidates.length !== 1) { quality.ambiguousDateObservations += 1; continue; }
      barIndex = candidates[0];
      quality.matchedByUniqueDate += 1;
    } else {
      quality.matchedByExactTime += 1;
    }

    const signalIndex = barIndex + input.observationLagBars;
    if (signalIndex >= closed.length) { quality.laggedBeyondLoadedHistory += 1; continue; }
    const direction = directionByLabel.get(observation.label)!;
    detected.push({
      eventId: `${observation.time}:${observation.label}`,
      label: observation.label,
      branch: observation.label,
      direction,
      observationTime: observation.time,
      signalIndex,
    });
  }

  const timeframeMs = marketRegimeResolutionMilliseconds(input.timeframe);
  if (timeframeMs === null || timeframeMs <= 0) {
    throw new Error(`external label study does not support timeframe ${JSON.stringify(input.timeframe)}`);
  }
  const maxHorizon = Math.max(...input.horizons);

  // Overlapping evaluation windows reuse the same forward bars across events, which makes the sample
  // look larger and more independent than it is. Excluding them is the default. A dense label series
  // that carries a label on nearly every bar loses most of its sample that way, so the caller can
  // keep the overlap instead and accept intervals that are narrower than the effective sample
  // supports. The choice applies to every branch equally, so it cannot move a branch difference.
  const sorted = [...detected].sort((left, right) => left.signalIndex - right.signalIndex);
  let kept: typeof sorted = sorted;
  if (input.overlapPolicy === "exclude_later_event") {
    kept = [];
    for (const event of sorted) {
      const last = kept.at(-1);
      if (last !== undefined && event.signalIndex - last.signalIndex <= maxHorizon) {
        quality.overlappingEventsExcluded += 1;
        continue;
      }
      kept.push(event);
    }
  }

  const events = kept.map((event) =>
    // Number.POSITIVE_INFINITY selects the observed-bar clock declared in outcomeContract below.
    outcomeForEvent(event, closed, input.horizons, timeframeMs, input.targetReturnBps, Number.POSITIVE_INFINITY));

  const folds = input.folds.map((fold) => ({
    ...fold,
    fromMs: canonicalTime(fold.from, `${fold.foldId}.from`),
    toMs: canonicalTime(fold.to, `${fold.foldId}.to`),
  }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) =>
    folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("folds must not overlap");
  }

  const branches = input.acceptedLabels.map((item) => item.label);
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [branch, {
      events: selected.length,
      direction: directionByLabel.get(branch) === 1 ? "long" : "short",
      horizons: summarizeOutcomes(selected, input.horizons, input.confidenceLevel, "global"),
    }];
  }));

  const foldResults = folds.map((fold) => {
    const selected = events.filter((event) => {
      const time = Date.parse(event.signalTime);
      return time >= fold.fromMs && time < fold.toMs;
    });
    return {
      foldId: fold.foldId,
      from: fold.from,
      to: fold.to,
      events: selected.length,
      byBranch: Object.fromEntries(branches.map((branch) => {
        const branchEvents = selected.filter((event) => event.branch === branch);
        return [branch, {
          events: branchEvents.length,
          horizons: summarizeOutcomes(branchEvents, input.horizons, input.confidenceLevel, "fold"),
        }];
      })),
    };
  });

  const regimeEvidence = input.regime === null ? null : computeMarketRegimes({
    bars: input.bars,
    symbol: input.symbol,
    timeframe: input.timeframe,
    trendLookback: input.regime.trendLookback,
    atrLookback: input.regime.atrLookback,
    volatilityBaselineLookback: input.regime.volatilityBaselineLookback,
    trendEfficiencyThreshold: input.regime.trendEfficiencyThreshold,
    rangeEfficiencyThreshold: input.regime.rangeEfficiencyThreshold,
    directionalMoveAtrThreshold: input.regime.directionalMoveAtrThreshold,
    highVolatilityRatio: input.regime.highVolatilityRatio,
    lowVolatilityRatio: input.regime.lowVolatilityRatio,
    minimumClassifiedBars: input.regime.minimumClassifiedBars,
    observationLimit: input.bars.length,
  });
  const regimeResolutionMs = input.regime === null ? null : marketRegimeResolutionMilliseconds(input.timeframe);
  if (input.regime !== null && (regimeResolutionMs === null || regimeResolutionMs <= 0)) {
    throw new Error(`event regime join does not support timeframe ${JSON.stringify(input.timeframe)}`);
  }
  const regimeAnalysis = input.regime === null || regimeEvidence === null || regimeResolutionMs === null ? null
    : buildEventRegimeAnalysis(events, regimeEvidence.observations, regimeResolutionMs, input.horizons,
      input.confidenceLevel, input.regime.minimumGroupEvents, input.regime.minimumCoverageRatio,
      input.regime.maxRegimeAgeBars);

  const qualityIssues = [
    ...(events.length < input.minimumEvents ? ["minimum_event_count_not_met"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
    ...(quality.unmatchedObservations > 0 ? ["one_or_more_observations_matched_no_loaded_bar"] : []),
    ...(quality.ambiguousDateObservations > 0 ? ["one_or_more_observation_dates_matched_multiple_bars"] : []),
    ...(quality.duplicateObservationTimes > 0 ? ["duplicate_observation_timestamps_ignored"] : []),
    ...(quality.overlappingEventsExcluded > 0 ? ["overlapping_evaluation_windows_excluded"] : []),
    ...(input.overlapPolicy === "allow_overlapping_windows" ? ["overlapping_evaluation_windows_kept"] : []),
  ];

  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "external_label_forward_outcome_study_v1" as const,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    conditionContract: {
      labelSource: "caller_supplied_point_in_time_observations" as const,
      acceptedLabels: input.acceptedLabels,
      observationLagBars: input.observationLagBars,
      // The label is read on the observation bar and acted on this many bars later, so nothing
      // published after that bar closed can reach the event.
      signalReference: "observation_bar_plus_observation_lag_bars" as const,
      zeroLagRejected: true,
      joinPolicy: "exact_bar_timestamp_then_unique_utc_date" as const,
      overlapPolicy: input.overlapPolicy,
    },
    outcomeContract: {
      reference: "signal_bar_close_event_study_only_not_assumed_fill" as const,
      horizons: input.horizons,
      targetReturnBps: input.targetReturnBps,
      horizonClock: "observed_market_bars" as const,
      contiguousBarsRequired: false,
      calendarGapsIncluded: true,
      forwardFill: false,
    },
    inferenceContract: {
      confidenceLevel: input.confidenceLevel,
      meanIntervalMethod: "normal_approximation" as const,
      rateIntervalMethod: "wilson_score" as const,
      serialDependenceAdjustment: "none" as const,
      multipleTestingAdjustment: "none" as const,
      configurationTrials: input.configurationTrials,
      trialTrackingStatus: input.configurationTrials === null ? "undeclared" as const : "declared" as const,
      ranking: false,
    },
    inferenceWarnings: [
      "confidence_intervals_do_not_adjust_for_serial_dependence",
      "no_multiple_testing_adjustment_applied",
      ...(input.overlapPolicy === "allow_overlapping_windows"
        ? ["overlapping_evaluation_windows_kept_so_intervals_are_narrower_than_the_effective_sample"]
        : []),
      ...(input.configurationTrials === null ? ["configuration_trials_not_declared_by_caller"] : []),
      ...(branches.length > 1
        ? ["comparing_branches_requires_the_caller_to_account_for_the_shared_unconditional_drift"]
        : []),
    ],
    sample: {
      barsReceived: input.bars.length,
      closedBars: closed.length,
      events: events.length,
      minimumEvents: input.minimumEvents,
    },
    quality,
    qualityIssues,
    byBranch,
    folds: foldResults,
    regimeEvidence,
    regimeAnalysis,
    events: events.slice(0, input.eventLimit).map((event) => ({
      eventId: event.eventId,
      label: event.label,
      branch: event.branch,
      direction: event.direction === 1 ? "long" : "short",
      observationTime: event.observationTime,
      signalTime: event.signalTime,
      signalPrice: event.signalPrice,
      outcomes: event.outcomes,
    })),
    eventsReturned: Math.min(events.length, input.eventLimit),
    eventsTruncated: events.length > input.eventLimit,
    limitations: [
      "This is an event study, not a fill, execution, or profitability simulation.",
      "Label correctness, revisions and vintages are the responsibility of whoever supplied them; only the join is point-in-time here.",
      "A lag in bars does not prove the label was public by then, only that this study did not read it earlier.",
      "Every branch shares the unconditional drift of the window, so a single branch mean is not evidence that the label carries information.",
    ],
  };
}
