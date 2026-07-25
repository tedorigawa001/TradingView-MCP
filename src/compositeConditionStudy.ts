import type { OhlcvBar } from "./tradingview.js";
import {
  buildEventRegimeAnalysis,
  canonicalTime,
  outcomeForEvent,
  runSessionAuctionStudy,
  summarizeOutcomes,
  timeframeMinutes,
  type SessionAuctionFold,
} from "./sessionAuctionStudy.js";
import { runFailedBreakoutStudy } from "./failedBreakoutStudy.js";
import { runFvgRetestStudy } from "./fvgRetestStudy.js";
import { runEventAftershockRetestStudy } from "./eventAftershockRetestStudy.js";
import { runSessionExhaustionHandoffStudy } from "./sessionHandoffStudy.js";
import { computeMarketRegimes, marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

export type CompositeOperator = "intersection" | "filter_gate" | "union";

export type PrimitiveConditionInput =
  | {
      type: "session_auction";
      timezone: string;
      range_start: string;
      range_end: string;
      auction_end: string;
      acceptance_closes?: number;
      failure_within_bars?: number;
      minimum_range_coverage?: number;
    }
  | {
      type: "session_exhaustion_handoff";
      timezone: string;
      prior_sessions: Array<{ session_id: string; start: string; end: string }>;
      handoff_start: string;
      handoff_end: string;
      prior_direction: "range_break" | "session_return" | "close_location";
      direction_minimum_return_bps?: number;
      close_location_threshold?: number;
      handoff_window_bars?: number;
      forward_update_threshold_bps?: number;
      require_range_reentry?: boolean;
      require_opposite_body?: boolean;
      minimum_prior_coverage?: number;
    }
  | {
      type: "event_aftershock_retest";
      events: Array<{ event_id: string; occurred_at: string }>;
      initial_range_bars?: number;
      breakout_within_bars?: number;
      retest_within_bars?: number;
      same_timestamp_policy?: "represent_first" | "reject";
      overlap_policy?: "exclude_later_event";
      require_retest_close_outside?: boolean;
      minimum_initial_range_coverage?: number;
    }
  | {
      type: "failed_breakout";
      timezone: string;
      range_start: string;
      range_end: string;
      failure_end: string;
      confirmation_bars?: number;
      minimum_range_coverage?: number;
    }
  | {
      type: "fair_value_gap_retest";
      minimum_gap_bps?: number;
      retest_within_bars?: number;
      min_impulse_body_ratio?: number;
      require_boundary_hold?: boolean;
    };

type RegimeInput = {
  trendLookback: number;
  atrLookback: number;
  volatilityBaselineLookback: number;
  trendEfficiencyThreshold: number;
  rangeEfficiencyThreshold: number;
  directionalMoveAtrThreshold: number;
  highVolatilityRatio: number;
  lowVolatilityRatio: number;
  minimumClassifiedBars: number;
  minimumGroupEvents: number;
  minimumCoverageRatio: number;
  maxRegimeAgeBars: number;
};

export interface CompositeConditionStudyInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  operator: CompositeOperator;
  conditions: PrimitiveConditionInput[];
  maxAlignmentBars?: number;
  requireSameDirection?: boolean;
  overlapPolicy?: "exclude_later_event";
  horizons: number[];
  targetReturnBps: number;
  minimumEvents: number;
  folds: SessionAuctionFold[];
  eventLimit: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  configurationTrials: number | null;
  regime: RegimeInput | null;
}

export type DetectedSignal = {
  eventId: string;
  signalIndex: number;
  direction: 1 | -1;
  branch: string;
  sourceCondition: string;
};

export function extractPrimitiveSignals(
  bars: OhlcvBar[],
  symbol: string,
  timeframe: string,
  condition: PrimitiveConditionInput,
): DetectedSignal[] {
  const timeToIdx = new Map(bars.map((b, idx) => [b.time, idx]));
  const getIdx = (signalTimeStr: string) => {
    const sec = Math.floor(Date.parse(signalTimeStr) / 1000);
    const idx = timeToIdx.get(sec);
    if (idx === undefined) return -1;
    return idx;
  };

  const dummyFold: SessionAuctionFold = {
    foldId: "dummy",
    from: "2000-01-01T00:00:00.000Z",
    to: "2099-12-31T23:59:59.000Z",
  };
  const baseConfig = {
    bars,
    symbol,
    timeframe,
    horizons: [1],
    targetReturnBps: 10,
    minimumEvents: 1,
    folds: [dummyFold],
    eventLimit: 200,
    confidenceLevel: 0.95 as const,
    configurationTrials: null,
    regime: null,
  };

  switch (condition.type) {
    case "session_auction": {
      const res = runSessionAuctionStudy({
        ...baseConfig,
        timezone: condition.timezone,
        rangeStart: condition.range_start,
        rangeEnd: condition.range_end,
        auctionEnd: condition.auction_end,
        acceptanceCloses: condition.acceptance_closes ?? 2,
        failureWithinBars: condition.failure_within_bars ?? 2,
        minimumRangeCoverage: condition.minimum_range_coverage ?? 1,
      });
      return res.events
        .map((e) => ({
          eventId: e.eventId,
          signalIndex: getIdx(e.signalTime),
          direction: e.direction === "long" ? (1 as const) : (-1 as const),
          branch: e.branch,
          sourceCondition: "session_auction",
        }))
        .filter((e) => e.signalIndex >= 0);
    }
    case "failed_breakout": {
      const res = runFailedBreakoutStudy({
        ...baseConfig,
        timezone: condition.timezone,
        rangeStart: condition.range_start,
        rangeEnd: condition.range_end,
        failureEnd: condition.failure_end,
        confirmationBars: condition.confirmation_bars ?? 1,
        minimumRangeCoverage: condition.minimum_range_coverage ?? 1,
      });
      return res.events
        .map((e) => ({
          eventId: e.eventId,
          signalIndex: getIdx(e.signalTime),
          direction: e.direction === "long" ? (1 as const) : (-1 as const),
          branch: e.branch,
          sourceCondition: "failed_breakout",
        }))
        .filter((e) => e.signalIndex >= 0);
    }
    case "fair_value_gap_retest": {
      const res = runFvgRetestStudy({
        ...baseConfig,
        minimumGapBps: condition.minimum_gap_bps ?? 10,
        retestWithinBars: condition.retest_within_bars ?? 16,
        minImpulseBodyRatio: condition.min_impulse_body_ratio ?? 0.5,
        requireBoundaryHold: condition.require_boundary_hold ?? true,
      });
      return res.events
        .map((e) => ({
          eventId: e.eventId,
          signalIndex: getIdx(e.signalTime),
          direction: e.direction === "long" ? (1 as const) : (-1 as const),
          branch: e.branch,
          sourceCondition: "fair_value_gap_retest",
        }))
        .filter((e) => e.signalIndex >= 0);
    }
    case "event_aftershock_retest": {
      const res = runEventAftershockRetestStudy({
        ...baseConfig,
        events: condition.events.map((ev) => ({ eventId: ev.event_id, occurredAt: ev.occurred_at })),
        initialRangeBars: condition.initial_range_bars ?? 4,
        breakoutWithinBars: condition.breakout_within_bars ?? 16,
        retestWithinBars: condition.retest_within_bars ?? 16,
        sameTimestampPolicy: condition.same_timestamp_policy ?? "represent_first",
        overlapPolicy: condition.overlap_policy ?? "exclude_later_event",
        requireRetestCloseOutside: condition.require_retest_close_outside ?? true,
        minimumInitialRangeCoverage: condition.minimum_initial_range_coverage ?? 1,
      });
      return res.events
        .map((e) => ({
          eventId: e.eventId,
          signalIndex: getIdx(e.signalTime),
          direction: e.direction === "long" ? (1 as const) : (-1 as const),
          branch: e.branch,
          sourceCondition: "event_aftershock_retest",
        }))
        .filter((e) => e.signalIndex >= 0);
    }
    case "session_exhaustion_handoff": {
      const res = runSessionExhaustionHandoffStudy({
        ...baseConfig,
        timezone: condition.timezone,
        priorSessions: condition.prior_sessions.map((s) => ({ sessionId: s.session_id, start: s.start, end: s.end })),
        handoffStart: condition.handoff_start,
        handoffEnd: condition.handoff_end,
        priorDirection: condition.prior_direction,
        directionMinimumReturnBps: condition.direction_minimum_return_bps ?? 0,
        closeLocationThreshold: condition.close_location_threshold ?? 0.6,
        handoffWindowBars: condition.handoff_window_bars ?? 4,
        forwardUpdateThresholdBps: condition.forward_update_threshold_bps ?? 0,
        requireRangeReentry: condition.require_range_reentry ?? false,
        requireOppositeBody: condition.require_opposite_body ?? false,
        minimumPriorCoverage: condition.minimum_prior_coverage ?? 1,
      });
      return res.events
        .map((e) => ({
          eventId: e.eventId,
          signalIndex: getIdx(e.signalTime),
          direction: e.direction === "long" ? (1 as const) : (-1 as const),
          branch: e.branch,
          sourceCondition: "session_exhaustion_handoff",
        }))
        .filter((e) => e.signalIndex >= 0);
    }
  }
}

function findPairwiseValidCombo(
  candidatesByCond: DetectedSignal[][],
  maxAlignmentBars: number,
): { valid: boolean; latestIndex: number } {
  function helper(
    depth: number,
    currentIndices: number[],
  ): { valid: boolean; latestIndex: number } | null {
    if (depth === candidatesByCond.length) {
      const minIdx = Math.min(...currentIndices);
      const maxIdx = Math.max(...currentIndices);
      if (maxIdx - minIdx <= maxAlignmentBars) {
        return { valid: true, latestIndex: maxIdx };
      }
      return null;
    }
    for (const sig of candidatesByCond[depth]) {
      const res = helper(depth + 1, [...currentIndices, sig.signalIndex]);
      if (res) return res;
    }
    return null;
  }

  const result = helper(0, []);
  if (result) return result;
  return { valid: false, latestIndex: -1 };
}

export function runCompositeConditionStudy(input: CompositeConditionStudyInput) {
  timeframeMinutes(input.timeframe);
  if (input.conditions.length < 2 || input.conditions.length > 4) {
    throw new Error("composite_condition requires 2 to 4 sub-conditions");
  }
  const maxAlignmentBars = input.maxAlignmentBars ?? 0;
  if (!Number.isInteger(maxAlignmentBars) || maxAlignmentBars < 0 || maxAlignmentBars > 24) {
    throw new Error("max_alignment_bars must be an integer between 0 and 24");
  }
  const requireSameDirection = input.requireSameDirection ?? true;
  const overlapPolicy = input.overlapPolicy ?? "exclude_later_event";
  if (input.horizons.length < 1 || input.horizons.length > 8 ||
      input.horizons.some((val) => !Number.isInteger(val) || val < 1 || val > 96) ||
      new Set(input.horizons).size !== input.horizons.length) {
    throw new Error("invalid event-study horizons");
  }
  if (![0.9, 0.95, 0.99].includes(input.confidenceLevel)) throw new Error("unsupported confidence level");
  if (input.configurationTrials !== null &&
      (!Number.isInteger(input.configurationTrials) || input.configurationTrials < 1 || input.configurationTrials > 100_000)) {
    throw new Error("configuration trials must be an integer from 1 to 100000");
  }

  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.length < 3) throw new Error("at least three OHLC bars are required");
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) throw new Error("duplicate OHLC timestamps");
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) || bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
      bar.close < bar.low || bar.close > bar.high)) throw new Error("invalid OHLC bar");

  const formingBarsExcluded = bars.filter((bar) => bar.forming === true).length;
  const closed = bars.filter((bar) => bar.forming !== true);
  const timeframeMs = timeframeMinutes(input.timeframe) * 60_000;

  // Extract signals from all sub-conditions
  const subSignals = input.conditions.map((cond) => extractPrimitiveSignals(closed, input.symbol, input.timeframe, cond));

  const quality = {
    totalSubSignals: subSignals.reduce((sum, s) => sum + s.length, 0),
    eligibleCompositeEvents: 0,
    alignmentExclusions: 0,
    directionMismatchExclusions: 0,
    ambiguousBothSides: 0,
    overlappingEventsExcluded: 0,
    formingBarsExcluded,
  };

  type CompositeBranch = "composite_long" | "composite_short";
  const rawDetected: Array<{
    eventId: string;
    branch: CompositeBranch;
    direction: 1 | -1;
    signalIndex: number;
  }> = [];

  if (input.operator === "intersection") {
    // Intersection (AND): Pairwise mutual alignment across all N sub-conditions (2..4) within maxAlignmentBars
    const primary = subSignals[0];
    for (const pSignal of primary) {
      const candidatesByCond: DetectedSignal[][] = [
        [pSignal],
        ...subSignals.slice(1).map((list) =>
          list.filter((s) => {
            const dirMatch = !requireSameDirection || s.direction === pSignal.direction;
            const inRange = Math.abs(s.signalIndex - pSignal.signalIndex) <= maxAlignmentBars;
            return dirMatch && inRange;
          }),
        ),
      ];

      if (candidatesByCond.some((list) => list.length === 0)) {
        quality.alignmentExclusions += 1;
        continue;
      }

      const combo = findPairwiseValidCombo(candidatesByCond, maxAlignmentBars);
      if (combo.valid) {
        quality.eligibleCompositeEvents += 1;
        const branch: CompositeBranch = pSignal.direction === 1 ? "composite_long" : "composite_short";
        rawDetected.push({
          eventId: `composite_intersection:${combo.latestIndex}:${pSignal.direction}`,
          branch,
          direction: pSignal.direction,
          signalIndex: combo.latestIndex,
        });
      } else {
        quality.alignmentExclusions += 1;
      }
    }
  } else if (input.operator === "filter_gate") {
    // Filter Gate: Primary condition [0] gated by filter condition [1] (and [2]...) within prior maxAlignmentBars
    const primary = subSignals[0];
    for (const pSignal of primary) {
      let gatePass = true;
      for (let cIdx = 1; cIdx < subSignals.length; cIdx += 1) {
        const candidate = subSignals[cIdx].find((s) => {
          const lag = pSignal.signalIndex - s.signalIndex;
          const inWindow = lag >= 0 && lag <= maxAlignmentBars;
          const dirMatch = !requireSameDirection || s.direction === pSignal.direction;
          return inWindow && dirMatch;
        });
        if (!candidate) {
          gatePass = false;
          quality.alignmentExclusions += 1;
          break;
        }
      }
      if (gatePass) {
        quality.eligibleCompositeEvents += 1;
        const branch: CompositeBranch = pSignal.direction === 1 ? "composite_long" : "composite_short";
        rawDetected.push({
          eventId: `composite_gate:${pSignal.signalIndex}:${pSignal.direction}`,
          branch,
          direction: pSignal.direction,
          signalIndex: pSignal.signalIndex,
        });
      }
    }
  } else if (input.operator === "union") {
    // Union (OR): Group signals by signalIndex. Exclude if opposite directions exist at same index
    const byIndex = new Map<number, DetectedSignal[]>();
    for (const list of subSignals) {
      for (const sig of list) {
        const arr = byIndex.get(sig.signalIndex) ?? [];
        arr.push(sig);
        byIndex.set(sig.signalIndex, arr);
      }
    }
    for (const [sIndex, sigs] of byIndex) {
      const dirs = new Set(sigs.map((s) => s.direction));
      if (dirs.has(1) && dirs.has(-1)) {
        quality.ambiguousBothSides += 1;
        continue;
      }
      const dir = sigs[0].direction;
      quality.eligibleCompositeEvents += 1;
      const branch: CompositeBranch = dir === 1 ? "composite_long" : "composite_short";
      rawDetected.push({
        eventId: `composite_union:${sIndex}:${dir}`,
        branch,
        direction: dir,
        signalIndex: sIndex,
      });
    }
  }

  // Deduplicate events by signalIndex + direction and sort by signalIndex ascending
  const seenKeys = new Set<string>();
  const sortedDetected = rawDetected
    .sort((a, b) => a.signalIndex - b.signalIndex)
    .filter((ev) => {
      const key = `${ev.signalIndex}:${ev.direction}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

  // Apply outcome window overlap policy: exclude later events whose evaluation window overlaps an earlier event
  const maxHorizonBars = Math.max(...input.horizons);
  const detected: typeof sortedDetected = [];
  let lastEvaluatedIndex = -Infinity;

  for (const ev of sortedDetected) {
    if (overlapPolicy === "exclude_later_event" && ev.signalIndex - lastEvaluatedIndex < maxHorizonBars) {
      quality.overlappingEventsExcluded += 1;
      continue;
    }
    detected.push(ev);
    lastEvaluatedIndex = ev.signalIndex;
  }

  // Calculate outcomes for composite detected events
  const events = detected.map((event) => outcomeForEvent(event, closed, input.horizons, timeframeMs, input.targetReturnBps));

  const folds = input.folds.map((fold) => ({
    ...fold,
    fromMs: canonicalTime(fold.from, `${fold.foldId}.from`),
    toMs: canonicalTime(fold.to, `${fold.foldId}.to`),
  }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("event-study folds must not overlap");
  }

  const branches = ["composite_long", "composite_short"] as const;
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [
      branch,
      {
        events: selected.length,
        horizons: summarizeOutcomes(selected, input.horizons, input.confidenceLevel, "global"),
      },
    ];
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
        return [
          branch,
          {
            events: branchEvents.length,
            horizons: summarizeOutcomes(branchEvents, input.horizons, input.confidenceLevel, "fold"),
          },
        ];
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

  const regimeAnalysis = input.regime === null || regimeEvidence === null || regimeResolutionMs === null
    ? null
    : buildEventRegimeAnalysis(
        events,
        regimeEvidence.observations,
        regimeResolutionMs,
        input.horizons,
        input.confidenceLevel,
        input.regime.minimumGroupEvents,
        input.regime.minimumCoverageRatio,
        input.regime.maxRegimeAgeBars,
      );

  const issues = [
    ...(events.length < input.minimumEvents ? ["minimum_event_count_not_met"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
    ...(regimeEvidence?.status === "partial" ? ["regime_classification_incomplete"] : []),
    ...(regimeAnalysis?.qualityIssues ?? []),
  ];

  const alignmentRule = input.operator === "intersection"
    ? "pairwise_span" as const
    : input.operator === "filter_gate"
    ? "primary_anchored_lookback" as const
    : "exact_signal_bar" as const;

  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: input.regime === null
      ? "composite_condition_event_study_v1" as const
      : "composite_condition_event_regime_study_v1" as const,
    status: issues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    conditionContract: {
      operator: input.operator,
      alignmentRule,
      subConditionCount: input.conditions.length,
      subConditionTypes: input.conditions.map((c) => c.type),
      maxAlignmentBars,
      requireSameDirection,
      overlapPolicy,
    },
    outcomeContract: {
      reference: "signal_bar_close_event_study_only_not_assumed_fill",
      horizons: input.horizons,
      targetReturnBps: input.targetReturnBps,
      contiguousBarsRequired: true,
    },
    inferenceContract: {
      confidenceLevel: input.confidenceLevel,
      meanIntervalMethod: "normal_approximation",
      rateIntervalMethod: "wilson_score",
      serialDependenceAdjustment: "none",
      multipleTestingAdjustment: "none",
      configurationTrials: input.configurationTrials,
      trialTrackingStatus: input.configurationTrials === null ? "not_declared" : "declared",
      inferenceScope: "global_branch_horizon_primary_outcomes_only",
      configuredMetricIntervals: branches.length * input.horizons.length * 3,
    },
    inferenceWarnings: [
      ...(input.configurationTrials === null ? ["configuration_trial_count_not_declared"] : []),
      "confidence_intervals_do_not_adjust_for_serial_dependence",
      "no_multiple_testing_adjustment_applied",
      ...(input.regime === null ? [] : ["regime_subgroups_expand_the_number_of_inspected_outcomes"]),
    ],
    foldContract: {
      detail: "compact_directional_outcomes",
      fields: [
        "availableEvents",
        "unavailableEvents",
        "directionalReturn.count",
        "directionalReturn.mean",
        "directionalReturn.median",
        "positiveRate",
        "targetHitRate",
      ],
      omitted: ["confidenceIntervals", "mfe", "mae", "targetHitBars"],
    },
    quality,
    qualityIssues: issues,
    sample: {
      barsReceived: input.bars.length,
      closedBars: closed.length,
      events: events.length,
      minimumEvents: input.minimumEvents,
    },
    events: events.slice(0, input.eventLimit),
    byBranch,
    folds: foldResults,
    regimeEvidence,
    regimeAnalysis,
  };
}
