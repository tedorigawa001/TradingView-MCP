import type { OhlcvBar } from "./tradingview.js";
import { marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

export interface YieldPriceNonconfirmationFold {
  foldId: string;
  from: string;
  to: string;
}

export interface YieldPriceNonconfirmationInput {
  targetBars: OhlcvBar[];
  driverBars: OhlcvBar[];
  targetSymbol: string;
  driverSymbol: string;
  targetTimeframe: string;
  driverTimeframe: string;
  relationship: "direct" | "inverse";
  driverLookback: number;
  driverChangeThreshold: number;
  priceBreakoutLookback: number;
  nonconfirmationBars: number;
  triggerLookback: number;
  triggerWithinBars: number;
  maxDriverAgeBars: number;
  horizons: number[];
  targetReturnBps: number;
  minimumEvents: number;
  folds: YieldPriceNonconfirmationFold[];
  eventLimit: number;
}

type Branch = "driver_up_target_failure" | "driver_down_target_failure";

function canonicalTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed;
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

function stats(values: number[]) {
  return {
    count: values.length,
    mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    p25: percentile(values, 0.25),
    p75: percentile(values, 0.75),
    minimum: values.length === 0 ? null : Math.min(...values),
    maximum: values.length === 0 ? null : Math.max(...values),
  };
}

function validateBars(bars: OhlcvBar[], label: string): OhlcvBar[] {
  if (bars.length < 3) throw new Error(`${label} requires at least three OHLC bars`);
  const ordered = [...bars].sort((left, right) => left.time - right.time);
  if (ordered.some((bar, index) => index > 0 && bar.time === ordered[index - 1].time)) {
    throw new Error(`${label} contains duplicate timestamps`);
  }
  if (ordered.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) || !Number.isFinite(bar.close) || bar.low > bar.high ||
      bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high ||
      bar.close <= 0)) throw new Error(`${label} contains invalid OHLC`);
  return ordered;
}

function summarize(events: Array<ReturnType<typeof outcome>>, horizons: number[]) {
  return Object.fromEntries(horizons.map((horizon) => {
    const available = events.map((event) => event.outcomes[String(horizon)]).filter((item) => item !== null);
    const returns = available.map((item) => item!.directionalReturn);
    const hits = available.filter((item) => item!.targetHitBars !== null);
    return [String(horizon), {
      availableEvents: available.length,
      unavailableEvents: events.length - available.length,
      directionalReturn: stats(returns),
      positiveRate: returns.length === 0 ? null : returns.filter((value) => value > 0).length / returns.length,
      mfe: stats(available.map((item) => item!.mfe)),
      mae: stats(available.map((item) => item!.mae)),
      targetHitRate: available.length === 0 ? null : hits.length / available.length,
      targetHitBars: stats(hits.map((item) => item!.targetHitBars!)),
    }];
  }));
}

function outcome<T extends { signalIndex: number; direction: 1 | -1 }>(
  event: T,
  bars: OhlcvBar[],
  horizons: number[],
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
    if (future.length !== horizon) { outcomes[String(horizon)] = null; continue; }
    const reference = signal.close;
    const directionalReturn = event.direction * (future.at(-1)!.close / reference - 1);
    const mfe = event.direction === 1
      ? Math.max(0, ...future.map((bar) => bar.high / reference - 1))
      : Math.max(0, ...future.map((bar) => 1 - bar.low / reference));
    const mae = event.direction === 1
      ? Math.max(0, ...future.map((bar) => 1 - bar.low / reference))
      : Math.max(0, ...future.map((bar) => bar.high / reference - 1));
    const target = targetReturnBps / 10_000;
    const hit = future.findIndex((bar) => event.direction === 1
      ? bar.high >= reference * (1 + target)
      : bar.low <= reference * (1 - target));
    outcomes[String(horizon)] = { directionalReturn, mfe, mae, targetHitBars: hit < 0 ? null : hit + 1 };
  }
  return { ...event, signalTime: signal.timeIso, signalPrice: signal.close, outcomes };
}

export function runYieldPriceNonconfirmationStudy(input: YieldPriceNonconfirmationInput) {
  const targetResolutionMs = marketRegimeResolutionMilliseconds(input.targetTimeframe);
  const driverResolutionMs = marketRegimeResolutionMilliseconds(input.driverTimeframe);
  if (!targetResolutionMs || !driverResolutionMs || /M$/i.test(input.targetTimeframe) || /M$/i.test(input.driverTimeframe)) {
    throw new Error("yield-price study requires fixed-duration target and driver timeframes");
  }
  if (!Number.isInteger(input.driverLookback) || input.driverLookback < 1 || input.driverLookback > 250 ||
      !(input.driverChangeThreshold > 0)) throw new Error("invalid driver impulse definition");
  if (!Number.isInteger(input.priceBreakoutLookback) || input.priceBreakoutLookback < 2 ||
      input.priceBreakoutLookback > 500 || !Number.isInteger(input.nonconfirmationBars) ||
      input.nonconfirmationBars < 1 || input.nonconfirmationBars > 20 ||
      !Number.isInteger(input.triggerLookback) || input.triggerLookback < 1 || input.triggerLookback > 100 ||
      !Number.isInteger(input.triggerWithinBars) || input.triggerWithinBars < 1 || input.triggerWithinBars > 20 ||
      !Number.isInteger(input.maxDriverAgeBars) || input.maxDriverAgeBars < 0 || input.maxDriverAgeBars > 20) {
    throw new Error("invalid target nonconfirmation definition");
  }
  if (input.horizons.length < 1 || input.horizons.length > 8 ||
      input.horizons.some((value) => !Number.isInteger(value) || value < 1 || value > 250) ||
      new Set(input.horizons).size !== input.horizons.length) throw new Error("invalid event-study horizons");

  const targetAll = validateBars(input.targetBars, "target bars");
  const driverAll = validateBars(input.driverBars, "driver bars");
  const targetFormingExcluded = targetAll.filter((bar) => bar.forming === true).length;
  const driverFormingExcluded = driverAll.filter((bar) => bar.forming === true).length;
  const target = targetAll.filter((bar) => bar.forming !== true);
  const driver = driverAll.filter((bar) => bar.forming !== true);
  const quality = {
    targetFormingBarsExcluded: targetFormingExcluded,
    driverFormingBarsExcluded: driverFormingExcluded,
    driverImpulses: 0,
    insufficientPriorTargetBars: 0,
    noTargetBarAfterDriverClose: 0,
    staleDriverEvidence: 0,
    incompleteNonconfirmationWindow: 0,
    expectedBreakoutConfirmed: 0,
    triggerNotConfirmed: 0,
    overlappingSignalsExcluded: 0,
  };
  const detected: Array<{
    eventId: string;
    branch: Branch;
    direction: 1 | -1;
    driverDirection: 1 | -1;
    driverChange: number;
    driverTime: string;
    driverAvailableAt: string;
    driverAgeMilliseconds: number;
    priorTargetHigh: number;
    priorTargetLow: number;
    signalIndex: number;
  }> = [];
  const usedSignals = new Set<number>();

  for (let index = input.driverLookback; index < driver.length; index += 1) {
    const change = driver[index].close - driver[index - input.driverLookback].close;
    const direction: 1 | -1 = change > 0 ? 1 : -1;
    if (Math.abs(change) < input.driverChangeThreshold) continue;
    const previousChange = index === input.driverLookback ? 0
      : driver[index - 1].close - driver[index - 1 - input.driverLookback].close;
    if (Math.abs(previousChange) >= input.driverChangeThreshold && Math.sign(previousChange) === direction) continue;
    quality.driverImpulses += 1;
    const availableAt = driver[index].time * 1000 + driverResolutionMs;
    const prior = target.filter((bar) => bar.time * 1000 + targetResolutionMs <= availableAt)
      .slice(-input.priceBreakoutLookback);
    if (prior.length < input.priceBreakoutLookback) { quality.insufficientPriorTargetBars += 1; continue; }
    const firstTargetIndex = target.findIndex((bar) => bar.time * 1000 >= availableAt);
    if (firstTargetIndex < 0) { quality.noTargetBarAfterDriverClose += 1; continue; }
    const driverAge = target[firstTargetIndex].time * 1000 - availableAt;
    if (driverAge > input.maxDriverAgeBars * driverResolutionMs) { quality.staleDriverEvidence += 1; continue; }
    const nonconfirmation = target.slice(firstTargetIndex, firstTargetIndex + input.nonconfirmationBars);
    if (nonconfirmation.length !== input.nonconfirmationBars) {
      quality.incompleteNonconfirmationWindow += 1; continue;
    }
    const priorHigh = Math.max(...prior.map((bar) => bar.high));
    const priorLow = Math.min(...prior.map((bar) => bar.low));
    const expectedDirection = (direction * (input.relationship === "direct" ? 1 : -1)) as 1 | -1;
    const expectedBreakout = nonconfirmation.some((bar) => expectedDirection === 1
      ? bar.close > priorHigh : bar.close < priorLow);
    if (expectedBreakout) { quality.expectedBreakoutConfirmed += 1; continue; }

    let signalIndex = -1;
    const triggerFrom = firstTargetIndex + input.nonconfirmationBars;
    const triggerTo = Math.min(target.length, triggerFrom + input.triggerWithinBars);
    for (let candidate = triggerFrom; candidate < triggerTo; candidate += 1) {
      const comparison = target.slice(Math.max(0, candidate - input.triggerLookback), candidate);
      if (comparison.length !== input.triggerLookback) continue;
      const oppositeBreak = expectedDirection === 1
        ? target[candidate].close < Math.min(...comparison.map((bar) => bar.low))
        : target[candidate].close > Math.max(...comparison.map((bar) => bar.high));
      if (oppositeBreak) { signalIndex = candidate; break; }
    }
    if (signalIndex < 0) { quality.triggerNotConfirmed += 1; continue; }
    if (usedSignals.has(signalIndex)) { quality.overlappingSignalsExcluded += 1; continue; }
    usedSignals.add(signalIndex);
    const branch: Branch = direction === 1 ? "driver_up_target_failure" : "driver_down_target_failure";
    detected.push({
      eventId: `${driver[index].timeIso}:${branch}`,
      branch,
      direction: (-expectedDirection) as 1 | -1,
      driverDirection: direction,
      driverChange: change,
      driverTime: driver[index].timeIso,
      driverAvailableAt: new Date(availableAt).toISOString(),
      driverAgeMilliseconds: driverAge,
      priorTargetHigh: priorHigh,
      priorTargetLow: priorLow,
      signalIndex,
    });
  }

  const events = detected.map((event) => outcome(event, target, input.horizons, input.targetReturnBps));
  const folds = input.folds.map((fold) => ({ ...fold,
    fromMs: canonicalTime(fold.from, `${fold.foldId}.from`), toMs: canonicalTime(fold.to, `${fold.foldId}.to`) }));
  if (new Set(folds.map((fold) => fold.foldId)).size !== folds.length) throw new Error("fold ids must be unique");
  if (folds.some((fold) => fold.fromMs >= fold.toMs)) throw new Error("fold end must be after fold start");
  if (folds.some((left, index) => folds.slice(index + 1)
    .some((right) => left.fromMs < right.toMs && right.fromMs < left.toMs))) throw new Error("folds must not overlap");
  const branches: Branch[] = ["driver_up_target_failure", "driver_down_target_failure"];
  const byBranch = Object.fromEntries(branches.map((branch) => {
    const selected = events.filter((event) => event.branch === branch);
    return [branch, { events: selected.length, horizons: summarize(selected, input.horizons) }];
  }));
  const foldResults = folds.map((fold) => {
    const selected = events.filter((event) => {
      const time = Date.parse(event.signalTime);
      return time >= fold.fromMs && time < fold.toMs;
    });
    return { foldId: fold.foldId, from: fold.from, to: fold.to, events: selected.length,
      byBranch: Object.fromEntries(branches.map((branch) => {
        const branchEvents = selected.filter((event) => event.branch === branch);
        return [branch, { events: branchEvents.length, horizons: summarize(branchEvents, input.horizons) }];
      })) };
  });
  const qualityIssues = [
    ...(events.length < input.minimumEvents ? ["minimum_event_count_not_met"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
  ];
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "yield_price_nonconfirmation_event_study_v1" as const,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    target: { symbol: input.targetSymbol, timeframe: input.targetTimeframe },
    driver: { symbol: input.driverSymbol, timeframe: input.driverTimeframe },
    relationship: input.relationship,
    definition: {
      driverLookback: input.driverLookback,
      driverChangeThreshold: input.driverChangeThreshold,
      priceBreakoutLookback: input.priceBreakoutLookback,
      nonconfirmationBars: input.nonconfirmationBars,
      triggerLookback: input.triggerLookback,
      triggerWithinBars: input.triggerWithinBars,
      maxDriverAgeBars: input.maxDriverAgeBars,
    },
    joinContract: {
      policy: "driver_nominal_close_then_target_bar_start" as const,
      exactTimestampRequired: false,
      forwardFill: false,
      targetResolutionMilliseconds: targetResolutionMs,
      driverResolutionMilliseconds: driverResolutionMs,
    },
    outcomeContract: {
      reference: "signal_bar_close_event_study_only_not_assumed_fill" as const,
      horizons: input.horizons,
      horizonUnit: "subsequent_observed_target_bars" as const,
      targetReturnBps: input.targetReturnBps,
      intrabarOrderingAssumed: false,
    },
    sample: {
      targetBarsReceived: input.targetBars.length,
      targetClosedBars: target.length,
      driverBarsReceived: input.driverBars.length,
      driverClosedBars: driver.length,
      events: events.length,
      minimumEvents: input.minimumEvents,
    },
    quality,
    qualityIssues,
    byBranch,
    folds: foldResults,
    events: events.slice(0, input.eventLimit).map((event) => ({
      eventId: event.eventId,
      branch: event.branch,
      direction: event.direction === 1 ? "long" : "short",
      driverChange: event.driverChange,
      driverTime: event.driverTime,
      driverAvailableAt: event.driverAvailableAt,
      driverAgeMilliseconds: event.driverAgeMilliseconds,
      priorTargetHigh: event.priorTargetHigh,
      priorTargetLow: event.priorTargetLow,
      signalTime: event.signalTime,
      signalPrice: event.signalPrice,
      outcomes: event.outcomes,
    })),
    eventsReturned: Math.min(events.length, input.eventLimit),
    eventsTruncated: events.length > input.eventLimit,
  };
}
