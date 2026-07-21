import type { OhlcvBar } from "./tradingview.js";

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
}

type LocalBar = OhlcvBar & { localDate: string; localMinute: number; weekday: string; globalIndex: number };
type Branch = "accepted_up" | "accepted_down" | "failed_up" | "failed_down";

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

function canonicalTime(value: string, label: string): number {
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

function timeframeMinutes(value: string): number {
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

function localize(bars: OhlcvBar[], timezone: string): LocalBar[] {
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

function summarizeOutcomes(events: Array<ReturnType<typeof outcomeForEvent>>, horizons: number[]) {
  return Object.fromEntries(horizons.map((horizon) => {
    const outcomes = events.map((event) => event.outcomes[String(horizon)]).filter((value) => value !== null);
    const returns = outcomes.map((outcome) => outcome!.directionalReturn);
    const targetHits = outcomes.filter((outcome) => outcome!.targetHitBars !== null);
    return [String(horizon), {
      availableEvents: outcomes.length,
      unavailableEvents: events.length - outcomes.length,
      directionalReturn: stats(returns),
      positiveRate: returns.length === 0 ? null : returns.filter((value) => value > 0).length / returns.length,
      mfe: stats(outcomes.map((outcome) => outcome!.mfe)),
      mae: stats(outcomes.map((outcome) => outcome!.mae)),
      targetHitRate: outcomes.length === 0 ? null : targetHits.length / outcomes.length,
      targetHitBars: stats(targetHits.map((outcome) => outcome!.targetHitBars!)),
    }];
  }));
}

function outcomeForEvent<T extends { signalIndex: number; direction: 1 | -1 }>(
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
    return [branch, { events: selected.length, horizons: summarizeOutcomes(selected, input.horizons) }];
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
        return [branch, { events: branchEvents.length, horizons: summarizeOutcomes(branchEvents, input.horizons) }];
      })),
    };
  });
  const issues = [
    ...(events.length < input.minimumEvents ? ["minimum_event_count_not_met"] : []),
    ...(folds.length < 2 ? ["fewer_than_two_time_folds"] : []),
    ...(quality.insufficientRangeCoverage > 0 ? ["one_or_more_sessions_have_incomplete_range"] : []),
  ];
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "session_auction_event_study_v1" as const,
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
    sample: { barsReceived: input.bars.length, closedBars: closed.length, events: events.length, minimumEvents: input.minimumEvents },
    quality,
    qualityIssues: issues,
    byBranch,
    folds: foldResults,
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
