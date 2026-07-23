import type { StrategyLedgerTrade, StrategyTradeLedger } from "./tradingview.js";
import {
  marketRegimeResolutionMilliseconds,
  type ClassifiedMarketRegimeObservation,
} from "./marketRegimes.js";
import {
  createSessionClockClassifier,
  OUTSIDE_DEFINED_SESSIONS_ID,
  type SessionClockDefinition,
} from "./sessionProfile.js";
import type { CorrelationRegimeObservation } from "./correlationRegimes.js";

export interface StrategyRegimeEvaluationInput {
  ledger: StrategyTradeLedger;
  observations: ClassifiedMarketRegimeObservation[];
  timeframe: string;
  minimumGroupTrades: number;
  minimumCoverageRatio: number;
  maxRegimeAgeBars: number;
  sessions?: SessionClockDefinition[];
  sessionMatchPolicy?: SessionMatchPolicy;
  eventProximity?: {
    events: Array<{ eventId: string; occurredAt: string }>;
    coverageFrom: string;
    coverageTo: string;
    beforeMinutes: number;
    afterMinutes: number;
  };
  correlationRegime?: {
    referenceSymbol: string;
    observations: CorrelationRegimeObservation[];
    maximumAgeBars: number;
    window: number;
    strongThreshold: number;
    neutralThreshold: number;
  };
}

export type SessionMatchPolicy = "all_matches_non_exclusive" | "first_match_exclusive";

type JoinedTrade = {
  trade: StrategyLedgerTrade;
  entryTime: number;
  observation: ClassifiedMarketRegimeObservation;
  regimeAgeMilliseconds: number;
  sessionIds: string[];
};

type EventProximityLabel = "near_scheduled_event" | "outside_scheduled_event_window" | "outside_event_calendar_coverage";
type CorrelationLabel = CorrelationRegimeObservation["regime"] | "outside_correlation_evidence";

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metrics(joined: JoinedTrade[]) {
  const ordered = [...joined].sort((left, right) =>
    (left.trade.entry?.time ?? Number.MAX_SAFE_INTEGER) -
      (right.trade.entry?.time ?? Number.MAX_SAFE_INTEGER) ||
    left.trade.reportIndex - right.trade.reportIndex);
  const trades = ordered.map((item) => item.trade);
  const profits = trades.map((trade) => trade.profit!);
  const gains = profits.filter((profit) => profit > 0).reduce((sum, profit) => sum + profit, 0);
  const losses = -profits.filter((profit) => profit < 0).reduce((sum, profit) => sum + profit, 0);
  let equity = 0;
  let peak = 0;
  let maxClosedTradeEquityDrawdown = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    maxClosedTradeEquityDrawdown = Math.max(maxClosedTradeEquityDrawdown, peak - equity);
  }
  const runUps = trades.map((trade) => trade.runUp).filter((value): value is number => value !== null);
  const drawDowns = trades.map((trade) => trade.drawDown).filter((value): value is number => value !== null);
  const commissions = trades.map((trade) => trade.commission).filter((value): value is number => value !== null);
  const ages = ordered.map((item) => item.regimeAgeMilliseconds);
  return {
    trades: trades.length,
    netProfit: profits.reduce((sum, profit) => sum + profit, 0),
    grossProfit: gains,
    grossLoss: losses,
    profitFactor: losses === 0 ? (gains > 0 ? null : 0) : gains / losses,
    winRate: trades.length === 0 ? null : profits.filter((profit) => profit > 0).length / trades.length,
    expectancy: average(profits),
    maxClosedTradeEquityDrawdown,
    averageRunUp: average(runUps),
    averageDrawDown: average(drawDowns),
    runUpCoverage: trades.length === 0 ? null : runUps.length / trades.length,
    drawDownCoverage: trades.length === 0 ? null : drawDowns.length / trades.length,
    totalCommission: commissions.length === trades.length
      ? commissions.reduce((sum, commission) => sum + commission, 0) : null,
    commissionCoverage: trades.length === 0 ? null : commissions.length / trades.length,
    averageRegimeAgeMilliseconds: average(ages),
    maximumRegimeAgeMilliseconds: ages.length === 0 ? null : Math.max(...ages),
  };
}

function groupEvidence(joined: JoinedTrade[], keyOf: (item: JoinedTrade) => string, minimumGroupTrades: number) {
  const groups = new Map<string, JoinedTrade[]>();
  for (const item of joined) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, evidence]) => [key, {
      ...metrics(evidence),
      minimumTradesMet: evidence.length >= minimumGroupTrades,
    }]));
}

function sessionEvidence(
  joined: JoinedTrade[],
  sessions: SessionClockDefinition[],
  minimumGroupTrades: number,
) {
  const groups = new Map(sessions.map((session) => [session.sessionId, [] as JoinedTrade[]]));
  groups.set(OUTSIDE_DEFINED_SESSIONS_ID, []);
  for (const item of joined) {
    const keys = item.sessionIds.length === 0 ? [OUTSIDE_DEFINED_SESSIONS_ID] : item.sessionIds;
    for (const key of keys) groups.get(key)!.push(item);
  }
  return Object.fromEntries([...groups].map(([key, evidence]) => [key, {
    ...metrics(evidence),
    minimumTradesMet: evidence.length >= minimumGroupTrades,
  }]));
}

function latestClosedObservation<T extends { time: number }>(
  observations: T[],
  entryTime: number,
  resolutionMs: number,
): T | null {
  let low = 0;
  let high = observations.length - 1;
  let result: T | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const observation = observations[middle];
    if (observation.time * 1000 + resolutionMs <= entryTime) {
      result = observation;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function canonicalEventTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function validateEventProximity(eventProximity: StrategyRegimeEvaluationInput["eventProximity"]) {
  if (eventProximity === undefined) return null;
  if (eventProximity.events.length < 1 || eventProximity.events.length > 200) {
    throw new Error("event proximity requires one to 200 events");
  }
  if (!Number.isInteger(eventProximity.beforeMinutes) || !Number.isInteger(eventProximity.afterMinutes) ||
      eventProximity.beforeMinutes < 0 || eventProximity.beforeMinutes > 1440 ||
      eventProximity.afterMinutes < 0 || eventProximity.afterMinutes > 1440 ||
      eventProximity.beforeMinutes + eventProximity.afterMinutes === 0) {
    throw new Error("event proximity windows must be integers from zero to 1440 minutes with one non-zero window");
  }
  if (eventProximity.events.some((event) => !/^[A-Za-z0-9_.:-]{1,120}$/.test(event.eventId))) {
    throw new Error("event proximity ids must use letters, digits, _, ., :, or -");
  }
  if (new Set(eventProximity.events.map((event) => event.eventId)).size !== eventProximity.events.length) {
    throw new Error("event proximity ids must be unique");
  }
  const events = eventProximity.events.map((event) => ({ ...event,
    occurredAtMs: canonicalEventTime(event.occurredAt, `${event.eventId}.occurredAt`) }));
  if (new Set(events.map((event) => event.occurredAtMs)).size !== events.length) {
    throw new Error("event proximity timestamps must be unique");
  }
  const coverageFromMs = canonicalEventTime(eventProximity.coverageFrom, "eventProximity.coverageFrom");
  const coverageToMs = canonicalEventTime(eventProximity.coverageTo, "eventProximity.coverageTo");
  if (coverageFromMs >= coverageToMs || events.some((event) => event.occurredAtMs < coverageFromMs || event.occurredAtMs >= coverageToMs)) {
    throw new Error("event proximity coverage must be ordered and contain every event timestamp");
  }
  return { events: events.sort((left, right) => left.occurredAtMs - right.occurredAtMs), coverageFromMs, coverageToMs };
}

function eventProximityLabel(entryTime: number, eventTimes: Array<{ occurredAtMs: number }>, coverageFromMs: number,
  coverageToMs: number, beforeMinutes: number,
  afterMinutes: number): EventProximityLabel {
  if (entryTime < coverageFromMs || entryTime >= coverageToMs) return "outside_event_calendar_coverage";
  const beforeMs = beforeMinutes * 60_000;
  const afterMs = afterMinutes * 60_000;
  return eventTimes.some((event) => entryTime >= event.occurredAtMs - beforeMs && entryTime < event.occurredAtMs + afterMs)
    ? "near_scheduled_event" : "outside_scheduled_event_window";
}

function validateCorrelationRegime(correlationRegime: StrategyRegimeEvaluationInput["correlationRegime"]) {
  if (correlationRegime === undefined) return null;
  if (!/^[A-Za-z0-9:._-]{1,80}$/.test(correlationRegime.referenceSymbol)) {
    throw new Error("correlation reference symbol is invalid");
  }
  if (!Number.isInteger(correlationRegime.maximumAgeBars) || correlationRegime.maximumAgeBars < 0 || correlationRegime.maximumAgeBars > 100) {
    throw new Error("correlation maximum age bars must be an integer between 0 and 100");
  }
  if (!Number.isInteger(correlationRegime.window) || correlationRegime.window < 2 || correlationRegime.window > 500 ||
      !(correlationRegime.neutralThreshold >= 0 && correlationRegime.neutralThreshold < correlationRegime.strongThreshold &&
        correlationRegime.strongThreshold <= 1)) {
    throw new Error("correlation regime contract is invalid");
  }
  const observations = [...correlationRegime.observations].sort((left, right) => left.time - right.time);
  if (observations.some((item, index) => !Number.isFinite(item.time) || !Number.isFinite(item.correlation) ||
      index > 0 && item.time === observations[index - 1].time)) {
    throw new Error("correlation observations must have unique finite timestamps and values");
  }
  return observations;
}

function correlationLabel(entryTime: number, observations: CorrelationRegimeObservation[], resolutionMs: number,
  maximumAgeBars: number): CorrelationLabel {
  const observation = latestClosedObservation(observations, entryTime, resolutionMs);
  if (observation === null || entryTime - (observation.time * 1000 + resolutionMs) > maximumAgeBars * resolutionMs) {
    return "outside_correlation_evidence";
  }
  return observation.regime;
}

export function evaluateStrategyByRegime(input: StrategyRegimeEvaluationInput) {
  if (!Number.isInteger(input.minimumGroupTrades) || input.minimumGroupTrades < 1) {
    throw new Error("minimum group trades must be a positive integer");
  }
  if (!(input.minimumCoverageRatio > 0 && input.minimumCoverageRatio <= 1)) {
    throw new Error("minimum coverage ratio must be greater than zero and at most one");
  }
  if (!Number.isInteger(input.maxRegimeAgeBars) || input.maxRegimeAgeBars < 0 || input.maxRegimeAgeBars > 100) {
    throw new Error("maximum regime age bars must be an integer between 0 and 100");
  }
  if (input.sessions === undefined && input.sessionMatchPolicy !== undefined) {
    throw new Error("session match policy requires session definitions");
  }
  const sessionMatchPolicy: SessionMatchPolicy = input.sessionMatchPolicy ?? "all_matches_non_exclusive";
  const classifySession = input.sessions === undefined ? null : createSessionClockClassifier(input.sessions);
  const eventTimes = validateEventProximity(input.eventProximity);
  const resolutionMs = marketRegimeResolutionMilliseconds(input.timeframe);
  if (resolutionMs === null || resolutionMs <= 0) throw new Error(`unsupported timeframe: ${input.timeframe}`);
  const observations = [...input.observations].sort((left, right) => left.time - right.time);
  const correlationObservations = validateCorrelationRegime(input.correlationRegime);
  if (observations.some((observation, index) => index > 0 && observation.time === observations[index - 1].time)) {
    throw new Error("duplicate regime timestamps");
  }

  const closedTrades = input.ledger.trades.filter((trade) => trade.status === "closed");
  const excluded = {
    openTrades: input.ledger.trades.length - closedTrades.length,
    missingEntryTime: 0,
    missingProfit: 0,
    noPriorClosedRegime: 0,
    staleRegimeEvidence: 0,
  };
  const joined: JoinedTrade[] = [];
  const maximumAgeMs = input.maxRegimeAgeBars * resolutionMs;
  for (const trade of closedTrades) {
    if (trade.entry?.time === null || trade.entry?.time === undefined || !Number.isFinite(trade.entry.time)) {
      excluded.missingEntryTime += 1;
      continue;
    }
    if (trade.profit === null || !Number.isFinite(trade.profit)) {
      excluded.missingProfit += 1;
      continue;
    }
    const observation = latestClosedObservation(observations, trade.entry.time, resolutionMs);
    if (!observation) {
      excluded.noPriorClosedRegime += 1;
      continue;
    }
    const regimeAgeMilliseconds = trade.entry.time - (observation.time * 1000 + resolutionMs);
    if (regimeAgeMilliseconds > maximumAgeMs) {
      excluded.staleRegimeEvidence += 1;
      continue;
    }
    const sessionMatches = classifySession === null ? [] : classifySession(trade.entry.time);
    const sessionIds = (sessionMatchPolicy === "first_match_exclusive"
      ? sessionMatches.slice(0, 1)
      : sessionMatches).map((match) => match.sessionId);
    joined.push({ trade, entryTime: trade.entry.time, observation, regimeAgeMilliseconds, sessionIds });
  }

  const eligibleClosedTrades = closedTrades.length - excluded.missingEntryTime - excluded.missingProfit;
  const coverageRatio = eligibleClosedTrades === 0 ? 0 : joined.length / eligibleClosedTrades;
  const correlationJoinedTrades = correlationObservations === null ? null : joined.filter((item) =>
    correlationLabel(item.entryTime, correlationObservations, resolutionMs, input.correlationRegime!.maximumAgeBars) !== "outside_correlation_evidence").length;
  const correlationCoverageRatio = correlationJoinedTrades === null ? null :
    (joined.length === 0 ? 0 : correlationJoinedTrades / joined.length);
  const fatalLedgerIssues = [
    ...(!input.ledger.complete ? ["strategy_ledger_incomplete"] : []),
    ...(input.ledger.countMatchesSummary === false ? ["strategy_ledger_count_mismatch"] : []),
  ];
  const qualityIssues = [...new Set([
    ...fatalLedgerIssues,
    ...input.ledger.qualityIssues.map((issue) => `strategy_ledger:${issue}`),
    ...(coverageRatio < input.minimumCoverageRatio ? ["minimum_regime_join_coverage_not_met"] : []),
    ...(correlationCoverageRatio !== null && correlationCoverageRatio < input.minimumCoverageRatio
      ? ["minimum_correlation_join_coverage_not_met"] : []),
    ...(joined.length === 0 ? ["no_trades_joined_to_regimes"] : []),
  ])];
  const blocked = fatalLedgerIssues.length > 0 || joined.length === 0;
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "entry_prior_closed_bar_regime_join_v1" as const,
    status: blocked ? "blocked" as const : qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    ledger: {
      ledgerId: input.ledger.ledgerId,
      strategy: input.ledger.strategy,
      symbol: input.ledger.symbol,
      timeframe: input.ledger.timeframe,
      pineId: input.ledger.pineId,
      pineVersion: input.ledger.pineVersion,
      currency: input.ledger.currency,
      complete: input.ledger.complete,
      qualityIssues: input.ledger.qualityIssues,
    },
    joinContract: {
      labelAt: "latest_regime_bar_with_nominal_close_at_or_before_entry",
      resolutionMilliseconds: resolutionMs,
      maxRegimeAgeBars: input.maxRegimeAgeBars,
      maximumAgeMilliseconds: maximumAgeMs,
      minimumCoverageRatio: input.minimumCoverageRatio,
      minimumGroupTrades: input.minimumGroupTrades,
      sessionMatchPolicy: input.sessions === undefined ? null : sessionMatchPolicy,
      sessionPriority: input.sessions === undefined || sessionMatchPolicy !== "first_match_exclusive"
        ? null
        : input.sessions.map((session) => session.sessionId),
      unmatchedSessionLabel: input.sessions === undefined ? null : OUTSIDE_DEFINED_SESSIONS_ID,
      sessions: input.sessions ?? [],
      eventProximity: eventTimes === null ? null : {
        labelAt: "trade_entry_time",
        eventTime: "caller_supplied_scheduled_canonical_utc_timestamp",
        interval: "[event_time - before_minutes, event_time + after_minutes)",
        events: eventTimes.events.length,
        coverageFrom: input.eventProximity!.coverageFrom,
        coverageTo: input.eventProximity!.coverageTo,
        beforeMinutes: input.eventProximity!.beforeMinutes,
        afterMinutes: input.eventProximity!.afterMinutes,
      },
      correlationRegime: correlationObservations === null ? null : {
        labelAt: "latest_correlation_bar_with_nominal_close_at_or_before_entry",
        referenceSymbol: input.correlationRegime!.referenceSymbol,
        window: input.correlationRegime!.window,
        strongThreshold: input.correlationRegime!.strongThreshold,
        neutralThreshold: input.correlationRegime!.neutralThreshold,
        maximumAgeBars: input.correlationRegime!.maximumAgeBars,
        maximumAgeMilliseconds: input.correlationRegime!.maximumAgeBars * resolutionMs,
        observations: correlationObservations.length,
      },
    },
    coverage: {
      ledgerTrades: input.ledger.trades.length,
      closedTrades: closedTrades.length,
      eligibleClosedTrades,
      joinedTrades: joined.length,
      coverageRatio,
      excluded,
      correlationJoinedTrades,
      correlationCoverageRatio,
    },
    qualityIssues,
    overall: metrics(joined),
    byDirectionalRegime: groupEvidence(joined, (item) => item.observation.directionalRegime,
      input.minimumGroupTrades),
    byVolatilityRegime: groupEvidence(joined, (item) => item.observation.volatilityRegime,
      input.minimumGroupTrades),
    byCombinedRegime: groupEvidence(joined, (item) =>
      `${item.observation.directionalRegime}:${item.observation.volatilityRegime}`, input.minimumGroupTrades),
    bySession: input.sessions === undefined
      ? null
      : sessionEvidence(joined, input.sessions, input.minimumGroupTrades),
    byEventProximity: eventTimes === null
      ? null
      : groupEvidence(joined, (item) => eventProximityLabel(item.entryTime, eventTimes.events,
        eventTimes.coverageFromMs, eventTimes.coverageToMs,
        input.eventProximity!.beforeMinutes, input.eventProximity!.afterMinutes), input.minimumGroupTrades),
    byCorrelationRegime: correlationObservations === null
      ? null
      : groupEvidence(joined, (item) => correlationLabel(item.entryTime, correlationObservations,
        resolutionMs, input.correlationRegime!.maximumAgeBars), input.minimumGroupTrades),
  };
}
