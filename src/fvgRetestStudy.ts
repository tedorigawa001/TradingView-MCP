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
type Branch = "fvg_retest_bullish" | "fvg_retest_bearish";

type RegimeInput = {
  trendLookback: number; atrLookback: number; volatilityBaselineLookback: number;
  trendEfficiencyThreshold: number; rangeEfficiencyThreshold: number;
  directionalMoveAtrThreshold: number; highVolatilityRatio: number; lowVolatilityRatio: number;
  minimumClassifiedBars: number; minimumGroupEvents: number; minimumCoverageRatio: number;
  maxRegimeAgeBars: number;
};

export interface FvgRetestStudyInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  minimumGapBps: number;
  retestWithinBars: number;
  minImpulseBodyRatio: number;
  requireBoundaryHold: boolean;
  horizons: number[];
  targetReturnBps: number;
  minimumEvents: number;
  folds: SessionAuctionFold[];
  eventLimit: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  configurationTrials: number | null;
  regime: RegimeInput | null;
}

function validate(input: FvgRetestStudyInput) {
  timeframeMinutes(input.timeframe);
  if (!Number.isFinite(input.minimumGapBps) || input.minimumGapBps <= 0 || input.minimumGapBps > 1000) {
    throw new Error("minimum gap bps must be a finite number between 0 and 1000");
  }
  if (!Number.isInteger(input.retestWithinBars) || input.retestWithinBars < 1 || input.retestWithinBars > 96) {
    throw new Error("retest within bars must be an integer between 1 and 96");
  }
  if (!Number.isFinite(input.minImpulseBodyRatio) || input.minImpulseBodyRatio < 0 || input.minImpulseBodyRatio > 1) {
    throw new Error("min impulse body ratio must be a finite number between 0 and 1");
  }
  if (typeof input.requireBoundaryHold !== "boolean") {
    throw new Error("require boundary hold must be a boolean");
  }
  if (input.horizons.length < 1 || input.horizons.length > 8 || input.horizons.some((val) => !Number.isInteger(val) || val < 1 || val > 96) || new Set(input.horizons).size !== input.horizons.length) {
    throw new Error("invalid event-study horizons");
  }
  if (![0.9, 0.95, 0.99].includes(input.confidenceLevel)) throw new Error("unsupported confidence level");
  if (input.configurationTrials !== null && (!Number.isInteger(input.configurationTrials) || input.configurationTrials < 1 || input.configurationTrials > 100_000)) {
    throw new Error("configuration trials must be an integer from 1 to 100000");
  }
}

export function runFvgRetestStudy(input: FvgRetestStudyInput) {
  validate(input);
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.length < 5) throw new Error("at least five OHLC bars are required");
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) throw new Error("duplicate OHLC timestamps");
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close) || bar.low > bar.high || bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high)) throw new Error("invalid OHLC bar");

  const formingBarsExcluded = bars.filter((bar) => bar.forming === true).length;
  const closed = bars.filter((bar) => bar.forming !== true);

  const quality = {
    formingBarsExcluded,
    fvgFormed: 0,
    retestWindowExpired: 0,
    boundaryHoldFailed: 0,
    overlappingSignalsExcluded: 0,
  };

  const detected: Array<{
    eventId: string;
    branch: Branch;
    direction: Direction;
    fvgTime: string;
    fvgBottom: number;
    fvgTop: number;
    signalIndex: number;
  }> = [];

  const usedSignals = new Set<number>();

  for (let i = 2; i < closed.length; i += 1) {
    const bar1 = closed[i - 2];
    const bar2 = closed[i - 1]; // Middle bar: actual displacement/impulse bar
    const bar3 = closed[i];

    const range2 = bar2.high - bar2.low;
    const body2 = Math.abs(bar2.close - bar2.open);
    const bodyRatio2 = range2 > 0 ? body2 / range2 : 0;

    // Check Bullish FVG: bar2 is strong bullish impulse, bar1.high < bar3.low
    if (bar2.close > bar2.open && bodyRatio2 >= input.minImpulseBodyRatio && bar1.high > 0 && bar1.high < bar3.low) {
      const gapBps = ((bar3.low / bar1.high) - 1) * 10_000;
      if (gapBps >= input.minimumGapBps) {
        quality.fvgFormed += 1;
        const fvgBottom = bar1.high;
        const fvgTop = bar3.low;

        // Monitor retest
        let signalIndex = -1;
        const maxIndex = Math.min(closed.length - 1, i + input.retestWithinBars);
        for (let k = i + 1; k <= maxIndex; k += 1) {
          // Check if barTouches FVG zone: low <= fvgTop
          if (closed[k].low <= fvgTop) {
            if (input.requireBoundaryHold && closed[k].close < fvgBottom) {
              quality.boundaryHoldFailed += 1;
              break;
            }
            signalIndex = k;
            break;
          }
        }

        if (signalIndex < 0) {
          quality.retestWindowExpired += 1;
          continue;
        }

        if (usedSignals.has(signalIndex)) {
          quality.overlappingSignalsExcluded += 1;
          continue;
        }

        usedSignals.add(signalIndex);
        detected.push({
          eventId: `${bar3.timeIso}:fvg_retest_bullish`,
          branch: "fvg_retest_bullish",
          direction: 1,
          fvgTime: bar3.timeIso,
          fvgBottom,
          fvgTop,
          signalIndex,
        });
      }
    }

    // Check Bearish FVG: bar2 is strong bearish impulse, bar1.low > bar3.high
    if (bar2.close < bar2.open && bodyRatio2 >= input.minImpulseBodyRatio && bar1.low > 0 && bar1.low > bar3.high) {
      const gapBps = (1 - (bar3.high / bar1.low)) * 10_000;
      if (gapBps >= input.minimumGapBps) {
        quality.fvgFormed += 1;
        const fvgBottom = bar3.high;
        const fvgTop = bar1.low;

        // Monitor retest
        let signalIndex = -1;
        const maxIndex = Math.min(closed.length - 1, i + input.retestWithinBars);
        for (let k = i + 1; k <= maxIndex; k += 1) {
          // Check if barTouches FVG zone: high >= fvgBottom
          if (closed[k].high >= fvgBottom) {
            if (input.requireBoundaryHold && closed[k].close > fvgTop) {
              quality.boundaryHoldFailed += 1;
              break;
            }
            signalIndex = k;
            break;
          }
        }

        if (signalIndex < 0) {
          quality.retestWindowExpired += 1;
          continue;
        }

        if (usedSignals.has(signalIndex)) {
          quality.overlappingSignalsExcluded += 1;
          continue;
        }

        usedSignals.add(signalIndex);
        detected.push({
          eventId: `${bar3.timeIso}:fvg_retest_bearish`,
          branch: "fvg_retest_bearish",
          direction: -1,
          fvgTime: bar3.timeIso,
          fvgBottom,
          fvgTop,
          signalIndex,
        });
      }
    }
  }

  const timeframe = timeframeMinutes(input.timeframe);
  const timeframeMs = timeframe * 60_000;

  const events = detected.map((event) => outcomeForEvent(event, closed, input.horizons, timeframeMs, input.targetReturnBps));
  const folds = input.folds.map((fold) => ({
    ...fold,
    fromMs: canonicalTime(fold.from, `${fold.foldId}.from`),
    toMs: canonicalTime(fold.to, `${fold.foldId}.to`),
  }));

  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("folds must not overlap");
  }

  const branches: Branch[] = ["fvg_retest_bullish", "fvg_retest_bearish"];
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [branch, { events: selected.length, horizons: summarizeOutcomes(selected, input.horizons, input.confidenceLevel, "global") }];
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
        return [branch, { events: branchEvents.length, horizons: summarizeOutcomes(branchEvents, input.horizons, input.confidenceLevel, "fold") }];
      })),
    };
  });

  const regimeEvidence = input.regime === null ? null
    : computeMarketRegimes({
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
    : buildEventRegimeAnalysis(events, regimeEvidence.observations, regimeResolutionMs, input.horizons, input.confidenceLevel, input.regime.minimumGroupEvents, input.regime.minimumCoverageRatio, input.regime.maxRegimeAgeBars);

  const qualityIssues = [
    ...(events.length < input.minimumEvents ? ["minimum_event_count_not_met"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
  ];

  const configurationTrials = input.configurationTrials ?? 1;
  const bonferroniAdjustedAlphaReference = (1 - input.confidenceLevel) / configurationTrials;
  const inferenceWarnings = [
    ...(configurationTrials > 1 ? ["confidence_intervals_do_not_adjust_for_multiple_testing_bonferroni_reference_only"] : []),
  ];

  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "fvg_retest_event_study_v1" as const,
    status: qualityIssues.length === 0 ? ("complete" as const) : ("partial" as const),
    conditionType: "fair_value_gap_retest" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    conditionContract: {
      minimumGapBps: input.minimumGapBps,
      retestWithinBars: input.retestWithinBars,
      minImpulseBodyRatio: input.minImpulseBodyRatio,
      requireBoundaryHold: input.requireBoundaryHold,
    },
    inferenceContract: {
      confidenceLevel: input.confidenceLevel,
      configurationTrials,
      bonferroniAdjustedAlphaReference,
      multipleTestingAdjustment: "none_returned_intervals_do_not_adjust_for_multiple_testing" as const,
    },
    inferenceWarnings,
    outcomeContract: {
      reference: "signal_bar_close_event_study_only_not_assumed_fill" as const,
      horizons: input.horizons,
      horizonUnit: "subsequent_observed_bars" as const,
      horizonClock: "observed_market_bars" as const,
      contiguousBarsRequired: false,
      calendarGapsIncluded: true,
      forwardFill: false,
      targetReturnBps: input.targetReturnBps,
      intrabarOrderingAssumed: false,
    },
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
    regimes: regimeAnalysis,
    events: events.slice(0, input.eventLimit).map((event) => ({
      eventId: event.eventId,
      branch: event.branch,
      direction: event.direction === 1 ? "long" : "short",
      fvgTime: event.fvgTime,
      fvgBottom: event.fvgBottom,
      fvgTop: event.fvgTop,
      signalTime: event.signalTime,
      signalPrice: event.signalPrice,
      outcomes: event.outcomes,
    })),
    eventsReturned: Math.min(events.length, input.eventLimit),
    eventsTruncated: events.length > input.eventLimit,
  };
}
