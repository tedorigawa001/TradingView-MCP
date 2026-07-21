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

export interface StrategyRegimeEvaluationInput {
  ledger: StrategyTradeLedger;
  observations: ClassifiedMarketRegimeObservation[];
  timeframe: string;
  minimumGroupTrades: number;
  minimumCoverageRatio: number;
  maxRegimeAgeBars: number;
  sessions?: SessionClockDefinition[];
}

type JoinedTrade = {
  trade: StrategyLedgerTrade;
  observation: ClassifiedMarketRegimeObservation;
  regimeAgeMilliseconds: number;
  sessionIds: string[];
};

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

function latestClosedObservation(
  observations: ClassifiedMarketRegimeObservation[],
  entryTime: number,
  resolutionMs: number,
): ClassifiedMarketRegimeObservation | null {
  let low = 0;
  let high = observations.length - 1;
  let result: ClassifiedMarketRegimeObservation | null = null;
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
  const classifySession = input.sessions === undefined ? null : createSessionClockClassifier(input.sessions);
  const resolutionMs = marketRegimeResolutionMilliseconds(input.timeframe);
  if (resolutionMs === null || resolutionMs <= 0) throw new Error(`unsupported timeframe: ${input.timeframe}`);
  const observations = [...input.observations].sort((left, right) => left.time - right.time);
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
    const sessionIds = classifySession === null
      ? []
      : classifySession(trade.entry.time).map((match) => match.sessionId);
    joined.push({ trade, observation, regimeAgeMilliseconds, sessionIds });
  }

  const eligibleClosedTrades = closedTrades.length - excluded.missingEntryTime - excluded.missingProfit;
  const coverageRatio = eligibleClosedTrades === 0 ? 0 : joined.length / eligibleClosedTrades;
  const fatalLedgerIssues = [
    ...(!input.ledger.complete ? ["strategy_ledger_incomplete"] : []),
    ...(input.ledger.countMatchesSummary === false ? ["strategy_ledger_count_mismatch"] : []),
  ];
  const qualityIssues = [...new Set([
    ...fatalLedgerIssues,
    ...input.ledger.qualityIssues.map((issue) => `strategy_ledger:${issue}`),
    ...(coverageRatio < input.minimumCoverageRatio ? ["minimum_regime_join_coverage_not_met"] : []),
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
      sessionMatchPolicy: input.sessions === undefined ? null : "all_matches_non_exclusive",
      unmatchedSessionLabel: input.sessions === undefined ? null : OUTSIDE_DEFINED_SESSIONS_ID,
      sessions: input.sessions ?? [],
    },
    coverage: {
      ledgerTrades: input.ledger.trades.length,
      closedTrades: closedTrades.length,
      eligibleClosedTrades,
      joinedTrades: joined.length,
      coverageRatio,
      excluded,
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
  };
}
