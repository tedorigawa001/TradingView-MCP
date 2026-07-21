import type { OhlcvBar } from "./tradingview.js";
import {
  computeMarketRegimes,
  marketRegimeResolutionMilliseconds,
  type ClassifiedMarketRegimeObservation,
} from "./marketRegimes.js";

export interface SessionAuctionFold {
  foldId: string;
  from: string;
  to: string;
}

export interface SessionAuctionStudyInput {
  bars: OhlcvBar[];
  symbol: string;
  timeframe: string;
  timezone: string;
  rangeStart: string;
  rangeEnd: string;
  auctionEnd: string;
  acceptanceCloses: number;
  failureWithinBars: number;
  minimumRangeCoverage: number;
  horizons: number[];
  targetReturnBps: number;
  minimumEvents: number;
  folds: SessionAuctionFold[];
  eventLimit: number;
  confidenceLevel: 0.9 | 0.95 | 0.99;
  configurationTrials: number | null;
  regime: {
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
  } | null;
}

export type LocalBar = OhlcvBar & { localDate: string; localMinute: number; weekday: string; globalIndex: number };
type Branch = "accepted_up" | "accepted_down" | "failed_up" | "failed_down";

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

export function canonicalTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function clockMinute(value: string, label: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`${label} must use HH:MM`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function timeframeMinutes(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("session auction study requires a minute-based timeframe");
  return Number(value);
}

function percentile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const NORMAL_Z = { 0.9: 1.6448536269514722, 0.95: 1.959963984540054, 0.99: 2.5758293035489004 } as const;

function meanConfidenceInterval(values: number[], confidenceLevel: 0.9 | 0.95 | 0.99) {
  if (values.length < 2) {
    return { status: "insufficient_sample" as const, method: "normal_approximation" as const,
      confidenceLevel, observations: values.length, lower: null, upper: null };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const margin = NORMAL_Z[confidenceLevel] * Math.sqrt(variance / values.length);
  return { status: "available" as const, method: "normal_approximation" as const,
    confidenceLevel, observations: values.length, lower: mean - margin, upper: mean + margin };
}

function wilsonConfidenceInterval(successes: number, observations: number, confidenceLevel: 0.9 | 0.95 | 0.99) {
  if (observations === 0) {
    return { status: "insufficient_sample" as const, method: "wilson_score" as const,
      confidenceLevel, observations, successes, lower: null, upper: null };
  }
  const z = NORMAL_Z[confidenceLevel];
  const rate = successes / observations;
  const denominator = 1 + z ** 2 / observations;
  const center = (rate + z ** 2 / (2 * observations)) / denominator;
  const margin = z * Math.sqrt(rate * (1 - rate) / observations + z ** 2 / (4 * observations ** 2)) /
    denominator;
  return { status: "available" as const, method: "wilson_score" as const,
    confidenceLevel, observations, successes, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function stats(
  values: number[],
  confidenceLevel: 0.9 | 0.95 | 0.99,
  includeMeanConfidenceInterval = false,
) {
  return {
    count: values.length,
    mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    minimum: values.length === 0 ? null : Math.min(...values),
    maximum: values.length === 0 ? null : Math.max(...values),
    ...(includeMeanConfidenceInterval
      ? { meanConfidenceInterval: meanConfidenceInterval(values, confidenceLevel) }
      : {}),
  };
}

function formatter(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
  } catch {
    throw new Error(`invalid IANA timezone: ${timezone}`);
  }
}

export function localize(bars: OhlcvBar[], timezone: string): LocalBar[] {
  const format = formatter(timezone);
  return bars.map((bar, globalIndex) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(bar.time * 1000))
      .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return {
      ...bar,
      localDate: `${parts.year}-${parts.month}-${parts.day}`,
      localMinute: Number(parts.hour) * 60 + Number(parts.minute),
      weekday: parts.weekday,
      globalIndex,
    };
  });
}

export function summarizeOutcomes(
  events: Array<ReturnType<typeof outcomeForEvent>>,
  horizons: number[],
  confidenceLevel: 0.9 | 0.95 | 0.99,
  mode: "global" | "fold" | "regime",
) {
  return Object.fromEntries(horizons.map((horizon) => {
    const outcomes = events.map((event) => event.outcomes[String(horizon)]).filter((value) => value !== null);
    const returns = outcomes.map((outcome) => outcome!.directionalReturn);
    const targetHits = outcomes.filter((outcome) => outcome!.targetHitBars !== null);
    if (mode === "fold") {
      return [String(horizon), {
        availableEvents: outcomes.length,
        unavailableEvents: events.length - outcomes.length,
        directionalReturn: {
          count: returns.length,
          mean: returns.length === 0 ? null : returns.reduce((sum, value) => sum + value, 0) / returns.length,
          median: percentile(returns, 0.5),
        },
        positiveRate: returns.length === 0 ? null : returns.filter((value) => value > 0).length / returns.length,
        targetHitRate: outcomes.length === 0 ? null : targetHits.length / outcomes.length,
      }];
    }
    const directionalReturn = mode === "global"
      ? stats(returns, confidenceLevel, true)
      : {
        count: returns.length,
        mean: returns.length === 0 ? null : returns.reduce((sum, value) => sum + value, 0) / returns.length,
        median: percentile(returns, 0.5),
        meanConfidenceInterval: meanConfidenceInterval(returns, confidenceLevel),
      };
    const primary = {
      availableEvents: outcomes.length,
      unavailableEvents: events.length - outcomes.length,
      directionalReturn,
      positiveRate: returns.length === 0 ? null : returns.filter((value) => value > 0).length / returns.length,
      positiveRateConfidenceInterval: wilsonConfidenceInterval(
        returns.filter((value) => value > 0).length, returns.length, confidenceLevel),
      targetHitRate: outcomes.length === 0 ? null : targetHits.length / outcomes.length,
      targetHitRateConfidenceInterval: wilsonConfidenceInterval(
        targetHits.length, outcomes.length, confidenceLevel),
    };
    if (mode === "regime") return [String(horizon), primary];
    return [String(horizon), {
      ...primary,
      mfe: stats(outcomes.map((outcome) => outcome!.mfe), confidenceLevel),
      mae: stats(outcomes.map((outcome) => outcome!.mae), confidenceLevel),
      targetHitBars: stats(targetHits.map((outcome) => outcome!.targetHitBars!), confidenceLevel),
    }];
  }));
}

export function outcomeForEvent<T extends { signalIndex: number; direction: 1 | -1 }>(
  event: T,
  bars: OhlcvBar[],
  horizons: number[],
  timeframeMs: number,
  targetReturnBps: number,
) {
  const signal = bars[event.signalIndex];
  const outcomes: Record<string, {
    directionalReturn: number;
    mfe: number;
    mae: number;
    targetHitBars: number | null;
  } | null> = {};
  for (const horizon of horizons) {
    const future = bars.slice(event.signalIndex + 1, event.signalIndex + horizon + 1);
    const sequence = [signal, ...future];
    const contiguous = future.length === horizon && sequence.slice(1).every((bar, index) =>
      bar.time * 1000 - sequence[index].time * 1000 <= timeframeMs * 1.5);
    if (!contiguous) { outcomes[String(horizon)] = null; continue; }
    const entry = signal.close;
    const directionalReturn = event.direction * (future.at(-1)!.close / entry - 1);
    const favorable = event.direction === 1
      ? Math.max(...future.map((bar) => bar.high / entry - 1))
      : Math.max(...future.map((bar) => 1 - bar.low / entry));
    const adverse = event.direction === 1
      ? Math.max(...future.map((bar) => 1 - bar.low / entry))
      : Math.max(...future.map((bar) => bar.high / entry - 1));
    const targetFraction = targetReturnBps / 10_000;
    const targetIndex = future.findIndex((bar) => event.direction === 1
      ? bar.high >= entry * (1 + targetFraction)
      : bar.low <= entry * (1 - targetFraction));
    outcomes[String(horizon)] = {
      directionalReturn,
      mfe: favorable,
      mae: adverse,
      targetHitBars: targetIndex < 0 ? null : targetIndex + 1,
    };
  }
  return { ...event, signalTime: signal.timeIso, signalPrice: signal.close, outcomes };
}

function latestRegimeClosedBeforeSignal(
  observations: ClassifiedMarketRegimeObservation[],
  signalStartMs: number,
  resolutionMs: number,
): ClassifiedMarketRegimeObservation | null {
  let low = 0;
  let high = observations.length - 1;
  let result: ClassifiedMarketRegimeObservation | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const observation = observations[middle];
    if (observation.time * 1000 + resolutionMs <= signalStartMs) {
      result = observation;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function buildEventRegimeAnalysis(
  events: Array<ReturnType<typeof outcomeForEvent>>,
  observations: ClassifiedMarketRegimeObservation[],
  resolutionMs: number,
  horizons: number[],
  confidenceLevel: 0.9 | 0.95 | 0.99,
  minimumGroupEvents: number,
  minimumCoverageRatio: number,
  maxRegimeAgeBars: number,
) {
  const excluded = { noPriorClosedRegime: 0, staleRegimeEvidence: 0 };
  const maximumAgeMilliseconds = maxRegimeAgeBars * resolutionMs;
  const joined: Array<{
    event: ReturnType<typeof outcomeForEvent>;
    observation: ClassifiedMarketRegimeObservation;
    regimeAgeMilliseconds: number;
  }> = [];
  for (const event of events) {
    const signalStartMs = Date.parse(event.signalTime);
    const observation = latestRegimeClosedBeforeSignal(observations, signalStartMs, resolutionMs);
    if (!observation) { excluded.noPriorClosedRegime += 1; continue; }
    const regimeAgeMilliseconds = signalStartMs - (observation.time * 1000 + resolutionMs);
    if (regimeAgeMilliseconds > maximumAgeMilliseconds) {
      excluded.staleRegimeEvidence += 1;
      continue;
    }
    joined.push({ event, observation, regimeAgeMilliseconds });
  }
  const coverageRatio = events.length === 0 ? 0 : joined.length / events.length;
  const directional = ["trend_up", "trend_down", "range", "transition"] as const;
  const volatility = ["low", "normal", "high"] as const;
  const combined = directional.flatMap((direction) =>
    volatility.map((volatilityLabel) => `${direction}:${volatilityLabel}`));
  const groupEvidence = (
    keys: readonly string[],
    keyOf: (item: typeof joined[number]) => string,
  ) => Object.fromEntries(keys.map((key) => {
    const selected = joined.filter((item) => keyOf(item) === key).map((item) => item.event);
    const minimumEventsMet = selected.length >= minimumGroupEvents;
    return [key, {
      status: minimumEventsMet ? "evaluable" as const : "not_evaluable" as const,
      events: selected.length,
      minimumEvents: minimumGroupEvents,
      reason: minimumEventsMet ? null : "minimum_regime_group_events_not_met",
      horizons: minimumEventsMet
        ? summarizeOutcomes(selected, horizons, confidenceLevel, "regime")
        : null,
    }];
  }));
  const byDirectionalRegime = groupEvidence(directional,
    (item) => item.observation.directionalRegime);
  const byVolatilityRegime = groupEvidence(volatility,
    (item) => item.observation.volatilityRegime);
  const byCombinedRegime = groupEvidence(combined,
    (item) => `${item.observation.directionalRegime}:${item.observation.volatilityRegime}`);
  const evaluableGroups = [...Object.values(byDirectionalRegime), ...Object.values(byVolatilityRegime),
    ...Object.values(byCombinedRegime)].filter((group) => group.status === "evaluable").length;
  const qualityIssues = [
    ...(joined.length === 0 ? ["no_events_joined_to_regimes"] : []),
    ...(coverageRatio < minimumCoverageRatio ? ["minimum_event_regime_join_coverage_not_met"] : []),
  ];
  const ages = joined.map((item) => item.regimeAgeMilliseconds);
  return {
    methodologyVersion: "event_prior_closed_bar_regime_join_v1" as const,
    status: joined.length === 0 ? "blocked" as const
      : qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    joinContract: {
      labelAt: "latest_regime_bar_with_nominal_close_at_or_before_signal_bar_start",
      signalAvailability: "signal_bar_close",
      signalBarRegimeExcluded: true,
      resolutionMilliseconds: resolutionMs,
      maxRegimeAgeBars,
      maximumAgeMilliseconds,
      minimumCoverageRatio,
      minimumGroupEvents,
    },
    coverage: {
      events: events.length,
      joinedEvents: joined.length,
      coverageRatio,
      excluded,
      averageRegimeAgeMilliseconds: ages.length === 0 ? null
        : ages.reduce((sum, value) => sum + value, 0) / ages.length,
      maximumRegimeAgeMilliseconds: ages.length === 0 ? null : Math.max(...ages),
    },
    qualityIssues,
    inferenceContract: {
      groupsConfigured: directional.length + volatility.length + combined.length,
      groupsEvaluable: evaluableGroups,
      configuredMetricIntervals: evaluableGroups * horizons.length * 3,
      automaticRanking: false,
      multipleTestingAdjustment: "none",
    },
    byDirectionalRegime,
    byVolatilityRegime,
    byCombinedRegime,
  };
}

export function runSessionAuctionStudy(input: SessionAuctionStudyInput) {
  const timeframe = timeframeMinutes(input.timeframe);
  const timeframeMs = timeframe * 60_000;
  const rangeStart = clockMinute(input.rangeStart, "range_start");
  const rangeEnd = clockMinute(input.rangeEnd, "range_end");
  const auctionEnd = clockMinute(input.auctionEnd, "auction_end");
  if (!(rangeStart < rangeEnd && rangeEnd < auctionEnd)) {
    throw new Error("session clocks must satisfy range_start < range_end < auction_end on one local day");
  }
  if (input.horizons.length < 1 || input.horizons.length > 8 ||
      input.horizons.some((value) => !Number.isInteger(value) || value < 1 || value > 96) ||
      new Set(input.horizons).size !== input.horizons.length) throw new Error("invalid event-study horizons");
  if (input.acceptanceCloses < 1 || input.acceptanceCloses > 4 ||
      input.failureWithinBars < 0 || input.failureWithinBars > 4) throw new Error("invalid auction classification window");
  if (!(input.minimumRangeCoverage > 0 && input.minimumRangeCoverage <= 1)) throw new Error("invalid minimum range coverage");
  if (input.bars.length < 3) throw new Error("at least three OHLC bars are required");
  if (![0.9, 0.95, 0.99].includes(input.confidenceLevel)) throw new Error("unsupported confidence level");
  if (input.configurationTrials !== null &&
      (!Number.isInteger(input.configurationTrials) || input.configurationTrials < 1 || input.configurationTrials > 100_000)) {
    throw new Error("configuration trials must be an integer from 1 to 100000");
  }
  if (input.regime !== null) {
    if (!Number.isInteger(input.regime.minimumGroupEvents) || input.regime.minimumGroupEvents < 1 ||
        input.regime.minimumGroupEvents > 5000) {
      throw new Error("minimum regime group events must be an integer from 1 to 5000");
    }
    if (!(input.regime.minimumCoverageRatio > 0 && input.regime.minimumCoverageRatio <= 1)) {
      throw new Error("minimum regime coverage ratio must be greater than zero and at most one");
    }
    if (!Number.isInteger(input.regime.maxRegimeAgeBars) || input.regime.maxRegimeAgeBars < 0 ||
        input.regime.maxRegimeAgeBars > 100) {
      throw new Error("maximum regime age bars must be an integer from 0 to 100");
    }
  }
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) throw new Error("duplicate OHLC timestamps");
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) || bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
      bar.close < bar.low || bar.close > bar.high)) throw new Error("invalid OHLC bar");

  const formingBarsExcluded = bars.filter((bar) => bar.forming === true).length;
  const closed = bars.filter((bar) => bar.forming !== true);
  const localized = localize(closed, input.timezone);
  const perDay = new Map<string, LocalBar[]>();
  for (const bar of localized) {
    const day = perDay.get(bar.localDate) ?? [];
    day.push(bar);
    perDay.set(bar.localDate, day);
  }
  const expectedRangeBars = Math.ceil((rangeEnd - rangeStart) / timeframe);
  const minimumRangeBars = Math.ceil(expectedRangeBars * input.minimumRangeCoverage);
  const quality = {
    localDays: perDay.size,
    eligibleDays: 0,
    insufficientRangeCoverage: 0,
    noBoundaryTouch: 0,
    ambiguousBothSides: 0,
    unclassifiedTouches: 0,
    formingBarsExcluded,
  };
  const detected: Array<{
    eventId: string;
    localDate: string;
    branch: Branch;
    direction: 1 | -1;
    rangeHigh: number;
    rangeLow: number;
    rangeBars: number;
    touchTime: string;
    signalIndex: number;
  }> = [];

  for (const [localDate, day] of perDay) {
    if (!WEEKDAYS.has(day[0]?.weekday)) continue;
    const range = day.filter((bar) => bar.localMinute >= rangeStart && bar.localMinute < rangeEnd);
    const auction = day.filter((bar) => bar.localMinute >= rangeEnd && bar.localMinute < auctionEnd);
    if (range.length < minimumRangeBars) { quality.insufficientRangeCoverage += 1; continue; }
    if (auction.length === 0) continue;
    quality.eligibleDays += 1;
    const rangeHigh = Math.max(...range.map((bar) => bar.high));
    const rangeLow = Math.min(...range.map((bar) => bar.low));
    const touchPosition = auction.findIndex((bar) => bar.high > rangeHigh || bar.low < rangeLow);
    if (touchPosition < 0) { quality.noBoundaryTouch += 1; continue; }
    const touch = auction[touchPosition];
    const up = touch.high > rangeHigh;
    const down = touch.low < rangeLow;
    if (up && down) { quality.ambiguousBothSides += 1; continue; }
    const maxBars = Math.max(input.acceptanceCloses - 1, input.failureWithinBars);
    const classification = auction.slice(touchPosition, touchPosition + maxBars + 1);
    if (classification.some((bar) => up ? bar.low < rangeLow : bar.high > rangeHigh)) {
      quality.ambiguousBothSides += 1; continue;
    }
    const outside = (bar: LocalBar) => up ? bar.close > rangeHigh : bar.close < rangeLow;
    const acceptanceSlice = classification.slice(0, input.acceptanceCloses);
    const acceptedAt = acceptanceSlice.length === input.acceptanceCloses && acceptanceSlice.every(outside)
      ? input.acceptanceCloses - 1 : null;
    const failedAt = classification.slice(0, input.failureWithinBars + 1).findIndex((bar) => !outside(bar));
    const failureIndex = failedAt < 0 ? null : failedAt;
    let branch: Branch | null = null;
    let terminal = -1;
    if (acceptedAt !== null && (failureIndex === null || acceptedAt < failureIndex)) {
      branch = up ? "accepted_up" : "accepted_down";
      terminal = acceptedAt;
    } else if (failureIndex !== null) {
      branch = up ? "failed_up" : "failed_down";
      terminal = failureIndex;
    }
    if (branch === null || classification[terminal] === undefined) {
      quality.unclassifiedTouches += 1; continue;
    }
    const signal = classification[terminal];
    const direction: 1 | -1 = branch === "accepted_up" || branch === "failed_down" ? 1 : -1;
    detected.push({
      eventId: `${localDate}:${branch}`,
      localDate,
      branch,
      direction,
      rangeHigh,
      rangeLow,
      rangeBars: range.length,
      touchTime: touch.timeIso,
      signalIndex: signal.globalIndex,
    });
  }

  const events = detected.map((event) => outcomeForEvent(event, closed, input.horizons, timeframeMs, input.targetReturnBps));
  const folds = input.folds.map((fold) => ({ ...fold,
    fromMs: canonicalTime(fold.from, `${fold.foldId}.from`), toMs: canonicalTime(fold.to, `${fold.foldId}.to`) }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("event-study folds must not overlap");
  }
  const branches = ["accepted_up", "accepted_down", "failed_up", "failed_down"] as const;
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [branch, { events: selected.length,
      horizons: summarizeOutcomes(selected, input.horizons, input.confidenceLevel, "global") }];
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
        return [branch, { events: branchEvents.length,
          horizons: summarizeOutcomes(branchEvents, input.horizons, input.confidenceLevel, "fold") }];
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
  const regimeResolutionMs = input.regime === null
    ? null : marketRegimeResolutionMilliseconds(input.timeframe);
  if (input.regime !== null && (regimeResolutionMs === null || regimeResolutionMs <= 0)) {
    throw new Error(`event regime join does not support timeframe ${JSON.stringify(input.timeframe)}`);
  }
  const regimeAnalysis = input.regime === null || regimeEvidence === null || regimeResolutionMs === null
    ? null : buildEventRegimeAnalysis(
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
    ...(quality.insufficientRangeCoverage > 0 ? ["one_or_more_sessions_have_incomplete_range"] : []),
    ...(regimeEvidence?.status === "partial" ? ["regime_classification_incomplete"] : []),
    ...(regimeAnalysis?.qualityIssues ?? []),
  ];
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: input.regime === null
      ? "session_auction_event_study_v2" as const
      : "session_auction_event_regime_study_v1" as const,
    status: issues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    session: {
      timezone: input.timezone,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      auctionEnd: input.auctionEnd,
      acceptanceCloses: input.acceptanceCloses,
      failureWithinBars: input.failureWithinBars,
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
      fields: ["availableEvents", "unavailableEvents", "directionalReturn.count",
        "directionalReturn.mean", "directionalReturn.median", "positiveRate", "targetHitRate"],
      omitted: ["confidenceIntervals", "mfe", "mae", "targetHitBars"],
    },
    sample: { barsReceived: input.bars.length, closedBars: closed.length, events: events.length, minimumEvents: input.minimumEvents },
    quality,
    qualityIssues: issues,
    byBranch,
    folds: foldResults,
    ...(regimeEvidence === null ? {} : {
      regimeEvidence: {
        methodologyVersion: regimeEvidence.methodologyVersion,
        status: regimeEvidence.status,
        thresholds: regimeEvidence.thresholds,
        sample: regimeEvidence.sample,
        quality: regimeEvidence.quality,
        qualityIssues: regimeEvidence.qualityIssues,
        distribution: regimeEvidence.distribution,
      },
      regimeAnalysis,
    }),
    events: events.slice(0, input.eventLimit).map((event) => ({
      eventId: event.eventId,
      localDate: event.localDate,
      branch: event.branch,
      direction: event.direction === 1 ? "long" : "short",
      rangeHigh: event.rangeHigh,
      rangeLow: event.rangeLow,
      rangeBars: event.rangeBars,
      touchTime: event.touchTime,
      signalTime: event.signalTime,
      signalPrice: event.signalPrice,
      outcomes: event.outcomes,
    })),
    eventsReturned: Math.min(events.length, input.eventLimit),
    eventsTruncated: events.length > input.eventLimit,
  };
}
