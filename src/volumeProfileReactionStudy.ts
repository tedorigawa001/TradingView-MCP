import type { IndicatorValues, OhlcvBar } from "./tradingview.js";
import {
  canonicalTime,
  joinEventsToPriorClosedRegimes,
  outcomeForEvent,
  summarizeOutcomes,
  timeframeMinutes,
  type SessionAuctionFold,
} from "./sessionAuctionStudy.js";
import {
  computeMarketRegimes,
  marketRegimeResolutionMilliseconds,
  type ClassifiedMarketRegimeObservation,
} from "./marketRegimes.js";

export const VOLUME_PROFILE_REACTION_STUDY_V1 = {
  methodologyVersion: "chart_bar_volume_profile_reaction_event_study_v1",
  rows: 24,
  valueAreaPercent: 70,
  acceptanceCloses: 2,
  horizons: [1, 2, 4, 8],
  targetReturnBps: 20,
  minimumEventsPerBranch: 30,
  confidenceLevel: 0.95,
} as const;

export const VOLUME_PROFILE_SAME_REGIME_BASELINE_V1 = {
  methodologyVersion: "volume_profile_same_regime_unconditional_baseline_v1",
  trendLookback: 20,
  atrLookback: 14,
  volatilityBaselineLookback: 50,
  trendEfficiencyThreshold: 0.6,
  rangeEfficiencyThreshold: 0.25,
  directionalMoveAtrThreshold: 2,
  highVolatilityRatio: 1.5,
  lowVolatilityRatio: 0.75,
  minimumClassifiedBars: 100,
  minimumBaselineObservations: 30,
  maxRegimeAgeBars: 1,
  bootstrapIterations: 2_000,
} as const;

export const VOLUME_PROFILE_REACTION_STUDY_1H_V1 = {
  ...VOLUME_PROFILE_REACTION_STUDY_V1,
  methodologyVersion: "chart_bar_volume_profile_reaction_event_study_1h_v1",
  timeframe: "60",
} as const;

export const VOLUME_PROFILE_SAME_REGIME_BASELINE_1H_V1 = {
  ...VOLUME_PROFILE_SAME_REGIME_BASELINE_V1,
  methodologyVersion: "volume_profile_same_regime_unconditional_baseline_1h_v1",
} as const;

export const VOLUME_PROFILE_POC_REVERSION_STUDY_1H_V1 = {
  methodologyVersion: "chart_bar_volume_profile_poc_reversion_event_study_1h_v1",
  timeframe: "60",
  rows: 24,
  valueAreaPercent: 70,
  minimumDisplacementBps: 20,
  horizons: [1, 2, 4, 8],
  minimumEventsPerBranch: 30,
  confidenceLevel: 0.95,
} as const;

export const VOLUME_PROFILE_POC_REVERSION_SAME_REGIME_BASELINE_1H_V1 = {
  ...VOLUME_PROFILE_SAME_REGIME_BASELINE_1H_V1,
  methodologyVersion: "volume_profile_poc_reversion_same_regime_unconditional_baseline_1h_v1",
} as const;

export const VOLUME_PROFILE_REACTION_BRANCHES = [
  "vah_rejection_short",
  "val_rejection_long",
  "vah_acceptance_long",
  "val_acceptance_short",
] as const;

type Branch = typeof VOLUME_PROFILE_REACTION_BRANCHES[number];
type PocBranch = "poc_reversion_from_above_short" | "poc_reversion_from_below_long";
const POC_REVERSION_BRANCHES = ["poc_reversion_from_above_short", "poc_reversion_from_below_long"] as const;
const REACTION_DIRECTIONS: Record<Branch, 1 | -1> = {
  vah_rejection_short: -1,
  val_rejection_long: 1,
  vah_acceptance_long: 1,
  val_acceptance_short: -1,
};
const POC_REVERSION_DIRECTIONS: Record<PocBranch, 1 | -1> = {
  poc_reversion_from_above_short: -1,
  poc_reversion_from_below_long: 1,
};
type ProfileObservation = {
  time: number;
  poc: number;
  vah: number;
  val: number;
  profileStartMs: number;
  profileEndMs: number;
  tradingDayMs: number;
  barsIncluded: number;
};
type DirectionalOutcome = {
  directionalReturn: number;
  mfe: number;
  mae: number;
  targetHitBars: number | null;
};
type BaselineEvent<TBranch extends string = string> = {
  signalIndex: number;
  signalTime: string;
  direction: 1 | -1;
  branch: TBranch;
  outcomes: Record<string, DirectionalOutcome | null>;
};

export interface VolumeProfileReactionStudyInput {
  bars: OhlcvBar[];
  indicatorValues: IndicatorValues[];
  studyId: string;
  symbol: string;
  timeframe: string;
  folds: SessionAuctionFold[];
  signalFrom?: string | null;
  signalTo?: string | null;
  eventLimit: number;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function profileObservations(values: IndicatorValues[], studyId: string): ProfileObservation[] {
  const study = values.find((candidate) => candidate.id === studyId);
  if (!study || study.hasError || study.error) throw new Error("volume-profile study values are unavailable");
  const observations: ProfileObservation[] = [];
  for (const bar of study.bars) {
    const row = bar.values;
    if (row["Profile Complete"] !== 1) continue;
    const required = ["Prior POC", "Prior VAH", "Prior VAL", "Profile Start", "Profile End", "Trading Day", "Bars Included"];
    if (required.some((key) => row[key] === null || row[key] === undefined)) continue;
    const poc = finite(row["Prior POC"], "Prior POC");
    const vah = finite(row["Prior VAH"], "Prior VAH");
    const val = finite(row["Prior VAL"], "Prior VAL");
    const profileStartMs = finite(row["Profile Start"], "Profile Start");
    const profileEndMs = finite(row["Profile End"], "Profile End");
    const tradingDayMs = finite(row["Trading Day"], "Trading Day");
    const barsIncluded = finite(row["Bars Included"], "Bars Included");
    if (!(val <= poc && poc <= vah)) throw new Error("volume-profile levels must satisfy VAL <= POC <= VAH");
    if (!Number.isSafeInteger(profileStartMs) || !Number.isSafeInteger(profileEndMs) ||
        !Number.isSafeInteger(tradingDayMs) || profileStartMs >= profileEndMs) {
      throw new Error("volume-profile timestamps are invalid");
    }
    if (!Number.isInteger(barsIncluded) || barsIncluded < 1) throw new Error("Bars Included must be a positive integer");
    if (profileEndMs > bar.time * 1000) throw new Error("profile level became visible before its profile ended");
    observations.push({ time: bar.time, poc, vah, val, profileStartMs, profileEndMs, tradingDayMs, barsIncluded });
  }
  return observations;
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

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function combinedRegime(observation: ClassifiedMarketRegimeObservation): string {
  return `${observation.directionalRegime}:${observation.volatilityRegime}`;
}

function stratifiedDifference(
  strata: Array<{ key: string; events: number[]; baseline: number[] }>,
  seed: string,
) {
  const supported = strata.filter((stratum) => stratum.events.length > 0 && stratum.baseline.length > 0);
  const eventObservations = supported.reduce((sum, stratum) => sum + stratum.events.length, 0);
  const baselineObservations = supported.reduce((sum, stratum) => sum + stratum.baseline.length, 0);
  const eventMean = eventObservations === 0 ? null
    : supported.reduce((sum, stratum) => sum + stratum.events.reduce((part, value) => part + value, 0), 0) /
      eventObservations;
  const standardizedBaselineMean = eventObservations === 0 ? null
    : supported.reduce((sum, stratum) => {
      const baselineMean = stratum.baseline.reduce((part, value) => part + value, 0) / stratum.baseline.length;
      return sum + baselineMean * stratum.events.length;
    }, 0) / eventObservations;
  const difference = eventMean === null || standardizedBaselineMean === null
    ? null : eventMean - standardizedBaselineMean;
  if (eventObservations < 2 || baselineObservations < 2) {
    return {
      status: "insufficient_sample" as const,
      method: "event_regime_weighted_stratified_nonparametric_bootstrap" as const,
      iterations: 0,
      seed,
      eventObservations,
      baselineObservations,
      eventMean,
      standardizedBaselineMean,
      difference,
      lower: null,
      upper: null,
    };
  }
  const random = seededRandom(seed);
  const samples: number[] = [];
  for (let iteration = 0; iteration < VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.bootstrapIterations; iteration += 1) {
    let eventSum = 0;
    let baselineWeightedSum = 0;
    for (const stratum of supported) {
      for (let index = 0; index < stratum.events.length; index += 1) {
        eventSum += stratum.events[Math.floor(random() * stratum.events.length)];
      }
      let baselineSum = 0;
      for (let index = 0; index < stratum.baseline.length; index += 1) {
        baselineSum += stratum.baseline[Math.floor(random() * stratum.baseline.length)];
      }
      baselineWeightedSum += baselineSum / stratum.baseline.length * stratum.events.length;
    }
    samples.push(eventSum / eventObservations - baselineWeightedSum / eventObservations);
  }
  return {
    status: "available" as const,
    method: "event_regime_weighted_stratified_nonparametric_bootstrap" as const,
    iterations: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.bootstrapIterations,
    seed,
    eventObservations,
    baselineObservations,
    eventMean,
    standardizedBaselineMean,
    difference,
    lower: percentile(samples, 0.025),
    upper: percentile(samples, 0.975),
  };
}

function buildSameRegimeBaseline<TBranch extends string>(
  events: BaselineEvent<TBranch>[],
  branches: readonly TBranch[],
  directions: Readonly<Record<TBranch, 1 | -1>>,
  methodologyVersion: string,
  seedPrefix: string,
  closed: OhlcvBar[],
  observations: ClassifiedMarketRegimeObservation[],
  resolutionMs: number,
  signalFromMs: number | null,
  signalToMs: number | null,
) {
  const eventJoin = joinEventsToPriorClosedRegimes(
    events, observations, resolutionMs, VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.maxRegimeAgeBars);
  const eventSignalIndices = new Set(events.map((event) => event.signalIndex));
  const candidates = closed.flatMap((bar, signalIndex) => {
    const signalMs = bar.time * 1000;
    if (eventSignalIndices.has(signalIndex) || (signalFromMs !== null && signalMs < signalFromMs) ||
        (signalToMs !== null && signalMs >= signalToMs)) return [];
    return [{ signalIndex, signalTime: bar.timeIso }];
  });
  const baselineJoin = joinEventsToPriorClosedRegimes(
    candidates, observations, resolutionMs, VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.maxRegimeAgeBars);
  const baselineByRegime = new Map<string, typeof baselineJoin.joined>();
  for (const joined of baselineJoin.joined) {
    const key = combinedRegime(joined.observation);
    const group = baselineByRegime.get(key) ?? [];
    group.push(joined);
    baselineByRegime.set(key, group);
  }
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const joinedEvents = eventJoin.joined.filter((joined) => joined.event.branch === branch);
    const eventsByRegime = new Map<string, BaselineEvent<TBranch>[]>();
    for (const joined of joinedEvents) {
      const key = combinedRegime(joined.observation);
      const group = eventsByRegime.get(key) ?? [];
      group.push(joined.event);
      eventsByRegime.set(key, group);
    }
    const baselineOutcomesByRegime = new Map<string, BaselineEvent<TBranch>[]>();
    for (const [key, joinedCandidates] of baselineByRegime) {
      if (!eventsByRegime.has(key)) continue;
      baselineOutcomesByRegime.set(key, joinedCandidates.map((joined) => outcomeForEvent({
        signalIndex: joined.event.signalIndex,
        signalTime: joined.event.signalTime,
        direction: directions[branch],
        branch,
      }, closed, [...VOLUME_PROFILE_REACTION_STUDY_V1.horizons], resolutionMs,
      VOLUME_PROFILE_REACTION_STUDY_V1.targetReturnBps)));
    }
    const regimeKeys = [...eventsByRegime.keys()].sort();
    const horizons = Object.fromEntries(VOLUME_PROFILE_REACTION_STUDY_V1.horizons.map((horizon) => {
      const strata = regimeKeys.map((key) => ({
        key,
        events: (eventsByRegime.get(key) ?? []).map((event) => event.outcomes[String(horizon)])
          .filter((outcome): outcome is DirectionalOutcome => outcome !== null)
          .map((outcome) => outcome.directionalReturn),
        baseline: (baselineOutcomesByRegime.get(key) ?? []).map((event) => event.outcomes[String(horizon)])
          .filter((outcome): outcome is DirectionalOutcome => outcome !== null)
          .map((outcome) => outcome.directionalReturn),
      }));
      return [String(horizon), stratifiedDifference(
        strata, `${seedPrefix}:${branch}:${horizon}`)];
    }));
    const baselineBars = regimeKeys.reduce((sum, key) => sum + (baselineByRegime.get(key)?.length ?? 0), 0);
    const minimumEventsMet = joinedEvents.length >= VOLUME_PROFILE_REACTION_STUDY_V1.minimumEventsPerBranch;
    const minimumBaselineMet = baselineBars >= VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.minimumBaselineObservations;
    return [branch, {
      status: minimumEventsMet && minimumBaselineMet ? "evaluable" as const : "not_evaluable" as const,
      reason: !minimumEventsMet ? "minimum_event_count_not_met" as const
        : !minimumBaselineMet ? "minimum_same_regime_baseline_count_not_met" as const : null,
      joinedEvents: joinedEvents.length,
      baselineBars,
      regimes: Object.fromEntries(regimeKeys.map((key) => [key, {
        events: eventsByRegime.get(key)?.length ?? 0,
        baselineBars: baselineByRegime.get(key)?.length ?? 0,
      }])),
      horizons,
    }];
  }));
  const evaluableBranches = Object.values(byBranch).filter((branch) => branch.status === "evaluable").length;
  const coverageRatio = events.length === 0 ? 0 : eventJoin.joined.length / events.length;
  const qualityIssues = [
    ...(eventJoin.joined.length === 0 ? ["no_events_joined_to_prior_regimes"] : []),
    ...(coverageRatio < 0.8 ? ["minimum_event_regime_join_coverage_not_met"] : []),
    ...(evaluableBranches < branches.length
      ? ["one_or_more_same_regime_baselines_not_evaluable"] : []),
  ];
  return {
    methodologyVersion,
    status: eventJoin.joined.length === 0 ? "blocked" as const
      : qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    contract: {
      regimeKey: "directional_regime:volatility_regime",
      regimeAvailability: "latest_regime_bar_with_nominal_close_at_or_before_signal_bar_start",
      signalBarRegimeExcluded: true,
      maxRegimeAgeBars: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.maxRegimeAgeBars,
      baselinePopulation: "closed_non_volume_profile_event_bars_with_the_same_prior_combined_regime",
      baselineEventExclusion: "all_volume_profile_event_signal_bars",
      standardization: "baseline_regime_means_weighted_by_event_outcome_counts",
      bootstrap: {
        method: "event_regime_weighted_stratified_nonparametric_bootstrap",
        iterations: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.bootstrapIterations,
        interval: "percentile_95",
      },
    },
    coverage: {
      events: events.length,
      joinedEvents: eventJoin.joined.length,
      eventJoinCoverageRatio: coverageRatio,
      eventJoinExcluded: eventJoin.excluded,
      baselineCandidateBars: candidates.length,
      joinedBaselineBars: baselineJoin.joined.length,
      baselineJoinExcluded: baselineJoin.excluded,
      evaluableBranches,
    },
    qualityIssues,
    byBranch,
  };
}

function validate(input: VolumeProfileReactionStudyInput) {
  timeframeMinutes(input.timeframe);
  if (!Number.isInteger(input.eventLimit) || input.eventLimit < 0 || input.eventLimit > 500) {
    throw new Error("event limit must be an integer from 0 to 500");
  }
  const from = input.signalFrom === null || input.signalFrom === undefined ? null : canonicalTime(input.signalFrom, "signal_from");
  const to = input.signalTo === null || input.signalTo === undefined ? null : canonicalTime(input.signalTo, "signal_to");
  if (from !== null && to !== null && from >= to) throw new Error("signal_to must be after signal_from");
}

export function runVolumeProfileReactionStudy(input: VolumeProfileReactionStudyInput) {
  validate(input);
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.length < 10) throw new Error("at least ten OHLC bars are required");
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) throw new Error("duplicate OHLC timestamps");
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) || bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
      bar.close < bar.low || bar.close > bar.high)) throw new Error("invalid OHLC bar");
  const formingBarsExcluded = bars.filter((bar) => bar.forming === true).length;
  const closed = bars.filter((bar) => bar.forming !== true);
  const observations = profileObservations(input.indicatorValues, input.studyId);
  const profileByTime = new Map(observations.map((observation) => [observation.time, observation]));
  const signalFromMs = input.signalFrom === null || input.signalFrom === undefined
    ? null : canonicalTime(input.signalFrom, "signal_from");
  const signalToMs = input.signalTo === null || input.signalTo === undefined
    ? null : canonicalTime(input.signalTo, "signal_to");
  const claimed = new Set<string>();
  const detected: Array<{
    eventId: string;
    branch: Branch;
    direction: 1 | -1;
    signalIndex: number;
    profileEnd: string;
    poc: number;
    vah: number;
    val: number;
  }> = [];
  let missingProfileObservation = 0;
  let profileChangedInsideConfirmation = 0;
  let beforeWindowExcluded = 0;
  let atOrAfterWindowExcluded = 0;

  const add = (branch: Branch, direction: 1 | -1, signalIndex: number, profile: ProfileObservation) => {
    const signalMs = closed[signalIndex].time * 1000;
    if (signalFromMs !== null && signalMs < signalFromMs) { beforeWindowExcluded += 1; return; }
    if (signalToMs !== null && signalMs >= signalToMs) { atOrAfterWindowExcluded += 1; return; }
    const claim = `${profile.profileEndMs}:${branch}`;
    if (claimed.has(claim)) return;
    claimed.add(claim);
    detected.push({
      eventId: `${new Date(profile.profileEndMs).toISOString()}:${branch}`,
      branch,
      direction,
      signalIndex,
      profileEnd: new Date(profile.profileEndMs).toISOString(),
      poc: profile.poc,
      vah: profile.vah,
      val: profile.val,
    });
  };

  for (let index = 1; index < closed.length; index += 1) {
    const bar = closed[index];
    const previous = closed[index - 1];
    const profile = profileByTime.get(bar.time);
    const previousProfile = profileByTime.get(previous.time);
    if (!profile) { missingProfileObservation += 1; continue; }
    // Every branch below asks whether an earlier bar closed inside the value area, so every branch
    // needs that bar to have been judged against the same value area. On the first bar of a new
    // trading day the previous bar belongs to the old profile, and testing its close against limits
    // that did not exist when it closed answers a different question from the one the branch names.
    // The acceptance branches already refused that case; the rejection branches did not, and were
    // not counted here either, so the mixing was invisible.
    if (!previousProfile || previousProfile.profileEndMs !== profile.profileEndMs) {
      profileChangedInsideConfirmation += 1;
      continue;
    }
    const previousClosedInside = previous.close >= profile.val && previous.close <= profile.vah;
    const signalClosedInside = bar.close >= profile.val && bar.close <= profile.vah;
    if (bar.high >= profile.vah && signalClosedInside && previousClosedInside) {
      add("vah_rejection_short", -1, index, profile);
    }
    if (bar.low <= profile.val && signalClosedInside && previousClosedInside) {
      add("val_rejection_long", 1, index, profile);
    }
    if (index >= 2) {
      const prior = closed[index - 2];
      const priorProfile = profileByTime.get(prior.time);
      if (!priorProfile || priorProfile.profileEndMs !== profile.profileEndMs) {
        profileChangedInsideConfirmation += 1;
        continue;
      }
      const priorClosedInside = prior.close >= profile.val && prior.close <= profile.vah;
      if (priorClosedInside && previous.close > profile.vah && bar.close > profile.vah) {
        add("vah_acceptance_long", 1, index, profile);
      }
      if (priorClosedInside && previous.close < profile.val && bar.close < profile.val) {
        add("val_acceptance_short", -1, index, profile);
      }
    }
  }

  const timeframeMs = timeframeMinutes(input.timeframe) * 60_000;
  const events = detected.map((event) => outcomeForEvent(
    event,
    closed,
    [...VOLUME_PROFILE_REACTION_STUDY_V1.horizons],
    timeframeMs,
    VOLUME_PROFILE_REACTION_STUDY_V1.targetReturnBps,
  ));
  const regimeEvidence = computeMarketRegimes({
    bars: input.bars,
    symbol: input.symbol,
    timeframe: input.timeframe,
    trendLookback: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.trendLookback,
    atrLookback: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.atrLookback,
    volatilityBaselineLookback: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.volatilityBaselineLookback,
    trendEfficiencyThreshold: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.trendEfficiencyThreshold,
    rangeEfficiencyThreshold: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.rangeEfficiencyThreshold,
    directionalMoveAtrThreshold: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.directionalMoveAtrThreshold,
    highVolatilityRatio: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.highVolatilityRatio,
    lowVolatilityRatio: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.lowVolatilityRatio,
    minimumClassifiedBars: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.minimumClassifiedBars,
    observationLimit: input.bars.length,
  });
  const regimeResolutionMs = marketRegimeResolutionMilliseconds(input.timeframe);
  if (regimeResolutionMs === null || regimeResolutionMs <= 0) {
    throw new Error(`same-regime baseline does not support timeframe ${JSON.stringify(input.timeframe)}`);
  }
  const sameRegimeBaseline = buildSameRegimeBaseline(
    events,
    VOLUME_PROFILE_REACTION_BRANCHES,
    REACTION_DIRECTIONS,
    VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.methodologyVersion,
    "volume-profile-same-regime-v1",
    closed,
    regimeEvidence.observations,
    regimeResolutionMs,
    signalFromMs,
    signalToMs,
  );
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
  const byBranch = Object.fromEntries(VOLUME_PROFILE_REACTION_BRANCHES.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [branch, {
      events: selected.length,
      horizons: summarizeOutcomes(selected, [...VOLUME_PROFILE_REACTION_STUDY_V1.horizons], 0.95, "global"),
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
      byBranch: Object.fromEntries(VOLUME_PROFILE_REACTION_BRANCHES.map((branch) => {
        const branchEvents = selected.filter((event) => event.branch === branch);
        return [branch, { events: branchEvents.length,
          horizons: summarizeOutcomes(branchEvents, [...VOLUME_PROFILE_REACTION_STUDY_V1.horizons], 0.95, "fold") }];
      })),
    };
  });
  const sparseBranches = VOLUME_PROFILE_REACTION_BRANCHES.filter((branch) =>
    events.filter((event) => event.branch === branch).length < VOLUME_PROFILE_REACTION_STUDY_V1.minimumEventsPerBranch);
  const qualityIssues = [
    ...(observations.length === 0 ? ["no_completed_profile_observations"] : []),
    ...(sparseBranches.length > 0 ? ["one_or_more_branches_below_minimum_event_count"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
    ...(regimeEvidence.status === "partial" ? ["regime_classification_incomplete"] : []),
    ...(sameRegimeBaseline.qualityIssues ?? []),
  ];
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: VOLUME_PROFILE_REACTION_STUDY_V1.methodologyVersion,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    profileContract: {
      semantics: "completed_chart_bar_volume_range_allocation_profile_proxy",
      rows: 24,
      valueAreaPercent: 70,
      volumeType: "exchange_reported_volume",
      nativeLowerTimeframeVolumeProfile: false,
    },
    signalContract: {
      rejection: "first intrabar boundary touch per completed profile whose signal bar closes back inside value area",
      acceptance: "first two consecutive closes outside one boundary per completed profile",
      maximumEventsPerProfileAndBranch: 1,
      signalReference: "signal_bar_close_event_study_only_not_assumed_fill",
    },
    outcomeContract: {
      horizons: [...VOLUME_PROFILE_REACTION_STUDY_V1.horizons],
      targetReturnBps: 20,
      contiguousBarsRequired: true,
    },
    inferenceContract: {
      confidenceLevel: 0.95,
      serialDependenceAdjustment: "none",
      multipleTestingAdjustment: "none",
      candidacy: "disabled_descriptive_only_pending_falsification",
    },
    sample: {
      barsReceived: input.bars.length,
      closedBars: closed.length,
      profileObservations: observations.length,
      events: events.length,
      minimumEventsPerBranch: 30,
      sparseBranches,
    },
    quality: {
      formingBarsExcluded,
      missingProfileObservation,
      profileChangedInsideConfirmation,
      signalBeforeWindowExcluded: beforeWindowExcluded,
      signalAtOrAfterWindowExcluded: atOrAfterWindowExcluded,
    },
    qualityIssues,
    byBranch,
    folds: foldResults,
    regimeEvidence: {
      methodologyVersion: regimeEvidence.methodologyVersion,
      status: regimeEvidence.status,
      thresholds: regimeEvidence.thresholds,
      sample: regimeEvidence.sample,
      quality: regimeEvidence.quality,
      qualityIssues: regimeEvidence.qualityIssues,
      distribution: regimeEvidence.distribution,
    },
    sameRegimeBaseline,
    events: events.slice(0, input.eventLimit).map((event) => ({
      eventId: event.eventId,
      branch: event.branch,
      direction: event.direction === 1 ? "long" : "short",
      profileEnd: event.profileEnd,
      poc: event.poc,
      vah: event.vah,
      val: event.val,
      signalTime: event.signalTime,
      signalPrice: event.signalPrice,
      outcomes: event.outcomes,
    })),
    limitations: [
      "The levels come from the audited chart-bar range-allocation proxy, not TradingView native lower-timeframe VP or order flow.",
      "The same-regime baseline is descriptive and its bootstrap does not adjust for serial dependence or selection.",
      "No empirical-null candidate gate is implemented in v1.",
      "The four branches and four horizons are descriptive; no branch is ranked or eligible for adoption.",
    ],
  };
}

function pocTargetSummary(
  events: Array<BaselineEvent<PocBranch> & { poc: number }>,
  horizon: number,
  closed: OhlcvBar[],
) {
  const hits: number[] = [];
  let unavailable = 0;
  for (const event of events) {
    if (event.outcomes[String(horizon)] === null) { unavailable += 1; continue; }
    const future = closed.slice(event.signalIndex + 1, event.signalIndex + horizon + 1);
    if (future.length !== horizon) { unavailable += 1; continue; }
    const firstHit = future.findIndex((bar) => event.direction === 1 ? bar.high >= event.poc : bar.low <= event.poc);
    hits.push(firstHit === -1 ? 0 : firstHit + 1);
  }
  const successes = hits.filter((hit) => hit > 0).length;
  const firstHitBars = hits.filter((hit) => hit > 0).sort((left, right) => left - right);
  return {
    availableEvents: hits.length,
    unavailableEvents: unavailable,
    hits: successes,
    hitRate: hits.length === 0 ? null : successes / hits.length,
    firstHitBars: {
      count: firstHitBars.length,
      mean: firstHitBars.length === 0 ? null : firstHitBars.reduce((sum, value) => sum + value, 0) / firstHitBars.length,
      minimum: firstHitBars.at(0) ?? null,
      p25: percentile(firstHitBars, 0.25),
      median: percentile(firstHitBars, 0.5),
      p75: percentile(firstHitBars, 0.75),
      maximum: firstHitBars.at(-1) ?? null,
    },
  };
}

/**
 * A standalone POC-reversion contract. It deliberately does not share a methodology id or branch
 * population with VAH/VAL reaction v1, even though both consume the same audited profile proxy.
 */
export function runVolumeProfilePocReversionStudy1h(input: VolumeProfileReactionStudyInput) {
  validate(input);
  if (timeframeMinutes(input.timeframe) !== 60) {
    throw new Error("1h volume-profile POC reversion study requires a 60-minute timeframe");
  }
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.length < 10) throw new Error("at least ten OHLC bars are required");
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) throw new Error("duplicate OHLC timestamps");
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) || bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
      bar.close < bar.low || bar.close > bar.high)) throw new Error("invalid OHLC bar");
  const closed = bars.filter((bar) => bar.forming !== true);
  const observations = profileObservations(input.indicatorValues, input.studyId);
  const profileByTime = new Map(observations.map((observation) => [observation.time, observation]));
  const signalFromMs = input.signalFrom === null || input.signalFrom === undefined ? null : canonicalTime(input.signalFrom, "signal_from");
  const signalToMs = input.signalTo === null || input.signalTo === undefined ? null : canonicalTime(input.signalTo, "signal_to");
  const claimed = new Set<string>();
  const detected: Array<BaselineEvent<PocBranch> & { eventId: string; profileEnd: string; poc: number; vah: number; val: number }> = [];
  let missingProfileObservation = 0;
  let beforeWindowExcluded = 0;
  let atOrAfterWindowExcluded = 0;
  const add = (branch: PocBranch, direction: 1 | -1, signalIndex: number, profile: ProfileObservation) => {
    const signalMs = closed[signalIndex].time * 1000;
    if (signalFromMs !== null && signalMs < signalFromMs) { beforeWindowExcluded += 1; return; }
    if (signalToMs !== null && signalMs >= signalToMs) { atOrAfterWindowExcluded += 1; return; }
    const claim = `${profile.profileEndMs}:${branch}`;
    if (claimed.has(claim)) return;
    claimed.add(claim);
    detected.push({
      eventId: `${new Date(profile.profileEndMs).toISOString()}:${branch}`,
      branch,
      direction,
      signalIndex,
      signalTime: closed[signalIndex].timeIso,
      profileEnd: new Date(profile.profileEndMs).toISOString(),
      poc: profile.poc,
      vah: profile.vah,
      val: profile.val,
      outcomes: {},
    });
  };
  for (let index = 0; index < closed.length; index += 1) {
    const bar = closed[index];
    const profile = profileByTime.get(bar.time);
    if (!profile) { missingProfileObservation += 1; continue; }
    const aboveDistanceBps = (bar.close / profile.poc - 1) * 10_000;
    const belowDistanceBps = (1 - bar.close / profile.poc) * 10_000;
    if (bar.close > profile.vah && aboveDistanceBps >= VOLUME_PROFILE_POC_REVERSION_STUDY_1H_V1.minimumDisplacementBps) {
      add("poc_reversion_from_above_short", -1, index, profile);
    }
    if (bar.close < profile.val && belowDistanceBps >= VOLUME_PROFILE_POC_REVERSION_STUDY_1H_V1.minimumDisplacementBps) {
      add("poc_reversion_from_below_long", 1, index, profile);
    }
  }
  const timeframeMs = timeframeMinutes(input.timeframe) * 60_000;
  const events = detected.map((event) => ({
    ...event,
    ...outcomeForEvent(event, closed, [...VOLUME_PROFILE_POC_REVERSION_STUDY_1H_V1.horizons], timeframeMs, 20),
  }));
  const regimeEvidence = computeMarketRegimes({
    bars: input.bars,
    symbol: input.symbol,
    timeframe: input.timeframe,
    trendLookback: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.trendLookback,
    atrLookback: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.atrLookback,
    volatilityBaselineLookback: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.volatilityBaselineLookback,
    trendEfficiencyThreshold: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.trendEfficiencyThreshold,
    rangeEfficiencyThreshold: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.rangeEfficiencyThreshold,
    directionalMoveAtrThreshold: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.directionalMoveAtrThreshold,
    highVolatilityRatio: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.highVolatilityRatio,
    lowVolatilityRatio: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.lowVolatilityRatio,
    minimumClassifiedBars: VOLUME_PROFILE_SAME_REGIME_BASELINE_V1.minimumClassifiedBars,
    observationLimit: input.bars.length,
  });
  const regimeResolutionMs = marketRegimeResolutionMilliseconds(input.timeframe);
  if (regimeResolutionMs === null || regimeResolutionMs <= 0) throw new Error("same-regime baseline does not support this timeframe");
  const sameRegimeBaseline = buildSameRegimeBaseline(
    events, POC_REVERSION_BRANCHES, POC_REVERSION_DIRECTIONS,
    VOLUME_PROFILE_POC_REVERSION_SAME_REGIME_BASELINE_1H_V1.methodologyVersion,
    "volume-profile-poc-reversion-same-regime-1h-v1",
    closed, regimeEvidence.observations, regimeResolutionMs, signalFromMs, signalToMs,
  );
  const folds = input.folds.map((fold) => ({ ...fold,
    fromMs: canonicalTime(fold.from, `${fold.foldId}.from`), toMs: canonicalTime(fold.to, `${fold.foldId}.to`) }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1).some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) {
    throw new Error("folds must not overlap");
  }
  const branchSummary = (selected: typeof events, scope: "global" | "fold") => Object.fromEntries(POC_REVERSION_BRANCHES.map((branch) => {
    const branchEvents = selected.filter((event) => event.branch === branch);
    return [branch, {
      events: branchEvents.length,
      horizons: summarizeOutcomes(branchEvents, [...VOLUME_PROFILE_POC_REVERSION_STUDY_1H_V1.horizons], 0.95, scope),
      pocTarget: Object.fromEntries(VOLUME_PROFILE_POC_REVERSION_STUDY_1H_V1.horizons.map((horizon) =>
        [String(horizon), pocTargetSummary(branchEvents, horizon, closed)])),
    }];
  }));
  const byBranch = branchSummary(events, "global");
  const foldResults = folds.map((fold) => {
    const selected = events.filter((event) => {
      const time = Date.parse(event.signalTime);
      return time >= fold.fromMs && time < fold.toMs;
    });
    return { foldId: fold.foldId, from: fold.from, to: fold.to, events: selected.length, byBranch: branchSummary(selected, "fold") };
  });
  const sparseBranches = POC_REVERSION_BRANCHES.filter((branch) => events.filter((event) => event.branch === branch).length < 30);
  const qualityIssues = [
    ...(observations.length === 0 ? ["no_completed_profile_observations"] : []),
    ...(sparseBranches.length > 0 ? ["one_or_more_branches_below_minimum_event_count"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
    ...(regimeEvidence.status === "partial" ? ["regime_classification_incomplete"] : []),
    ...sameRegimeBaseline.qualityIssues,
  ];
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: VOLUME_PROFILE_POC_REVERSION_STUDY_1H_V1.methodologyVersion,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    pocContract: {
      signal: "first close outside VAH or VAL after profile completion and at least 20 bps from the completed prior POC",
      branches: { poc_reversion_from_above_short: "close above VAH -> short toward POC", poc_reversion_from_below_long: "close below VAL -> long toward POC" },
      maximumEventsPerProfileAndBranch: 1,
      signalReference: "signal_bar_close_event_study_only_not_assumed_fill",
      pocTarget: "first subsequent bar that touches the fixed completed prior POC",
    },
    outcomeContract: { horizons: [...VOLUME_PROFILE_POC_REVERSION_STUDY_1H_V1.horizons], contiguousBarsRequired: true },
    inferenceContract: { confidenceLevel: 0.95, serialDependenceAdjustment: "none", multipleTestingAdjustment: "none",
      candidacy: "disabled_descriptive_only_pending_falsification" },
    sample: { barsReceived: input.bars.length, closedBars: closed.length, profileObservations: observations.length,
      events: events.length, minimumEventsPerBranch: 30, sparseBranches },
    quality: { missingProfileObservation, signalBeforeWindowExcluded: beforeWindowExcluded, signalAtOrAfterWindowExcluded: atOrAfterWindowExcluded },
    qualityIssues,
    byBranch,
    folds: foldResults,
    sameRegimeBaseline,
    events: events.slice(0, input.eventLimit).map(({ signalIndex, ...event }) => event),
    limitations: [
      "The POC is from the audited chart-bar range-allocation proxy, not native lower-timeframe VP or order flow.",
      "POC touches and signal-close returns are descriptive observations, not assumed fills.",
      "The same-regime baseline bootstrap does not adjust for serial dependence or selection.",
      "No empirical-null candidate gate is implemented; no branch is eligible for adoption.",
    ],
  };
}

/** A separate frozen 60-minute contract; never merge this evidence with the 240-minute v1 study. */
export function runVolumeProfileReactionStudy1h(input: VolumeProfileReactionStudyInput) {
  if (timeframeMinutes(input.timeframe) !== 60) {
    throw new Error("1h volume-profile reaction study requires a 60-minute timeframe");
  }
  const result = runVolumeProfileReactionStudy(input);
  return {
    ...result,
    methodologyVersion: VOLUME_PROFILE_REACTION_STUDY_1H_V1.methodologyVersion,
    sameRegimeBaseline: {
      ...result.sameRegimeBaseline,
      methodologyVersion: VOLUME_PROFILE_SAME_REGIME_BASELINE_1H_V1.methodologyVersion,
    },
  };
}
