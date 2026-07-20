import type { StrategyLedgerTrade, StrategyTradeLedger } from "./tradingview.js";

export type WalkForwardMode = "anchored" | "rolling";
export type WalkForwardSelectionMetric = "expectancy" | "netProfit" | "profitFactor";

export interface StrategyWalkForwardFold {
  foldId: string;
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
}

export interface StrategyWalkForwardCandidate {
  candidateId: string;
  ledger: StrategyTradeLedger;
}

type FoldMetrics = {
  totalTrades: number;
  tradesWithProfit: number;
  expectancy: number | null;
  netProfit: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxClosedTradeEquityDrawdown: number | null;
  averageDurationMilliseconds: number | null;
  averageRunUp: number | null;
  averageDrawDown: number | null;
};

type WindowEvidence = {
  metrics: FoldMetrics;
  excluded: {
    openTrades: number;
    missingTimestamps: number;
    crossingStart: number;
    crossingEnd: number;
  };
  qualityIssues: string[];
};

function resolutionMilliseconds(resolution: string): number {
  const value = resolution.trim().toUpperCase();
  if (/^\d+$/.test(value)) return Number(value) * 60_000;
  const match = value.match(/^(\d*)([SHDW])$/);
  if (!match) throw new Error(`walk-forward does not support timeframe ${JSON.stringify(resolution)}`);
  const count = Number(match[1] || "1");
  const units: Record<string, number> = { S: 1_000, H: 3_600_000, D: 86_400_000, W: 604_800_000 };
  const unit = units[match[2]];
  if (unit === undefined) throw new Error(`walk-forward does not support timeframe ${JSON.stringify(resolution)}`);
  return count * unit;
}

function timestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a valid timestamp`);
  return parsed;
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function metricsForTrades(trades: StrategyLedgerTrade[]): FoldMetrics {
  const profits = trades.map((trade) => trade.profit);
  const completeProfits = profits.every((value) => value !== null && Number.isFinite(value));
  const usableProfits = profits.filter((value): value is number => value !== null && Number.isFinite(value));
  const gains = usableProfits.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = usableProfits.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  if (completeProfits) {
    for (const profit of usableProfits) {
      equity += profit;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }
  }
  return {
    totalTrades: trades.length,
    tradesWithProfit: usableProfits.length,
    expectancy: completeProfits && trades.length > 0 ? average(usableProfits) : null,
    netProfit: completeProfits && trades.length > 0
      ? usableProfits.reduce((sum, value) => sum + value, 0)
      : null,
    profitFactor: completeProfits && trades.length > 0 && losses < 0 ? gains / Math.abs(losses) : null,
    winRate: completeProfits && trades.length > 0
      ? usableProfits.filter((value) => value > 0).length / trades.length
      : null,
    maxClosedTradeEquityDrawdown: completeProfits && trades.length > 0 ? maxDrawdown : null,
    averageDurationMilliseconds: average(trades.map((trade) => trade.durationMilliseconds)),
    averageRunUp: average(trades.map((trade) => trade.runUp)),
    averageDrawDown: average(trades.map((trade) => trade.drawDown)),
  };
}

function evidenceForWindow(ledger: StrategyTradeLedger, from: number, to: number): {
  evidence: WindowEvidence;
  trades: StrategyLedgerTrade[];
} {
  const included: StrategyLedgerTrade[] = [];
  const excluded = { openTrades: 0, missingTimestamps: 0, crossingStart: 0, crossingEnd: 0 };
  for (const trade of ledger.trades) {
    if (trade.status !== "closed") {
      excluded.openTrades += 1;
      continue;
    }
    const entry = trade.entry?.time;
    const exit = trade.exit?.time;
    if (entry === null || entry === undefined || exit === null || exit === undefined) {
      excluded.missingTimestamps += 1;
      continue;
    }
    if (entry < from && exit >= from) excluded.crossingStart += 1;
    if (entry < to && exit >= to) excluded.crossingEnd += 1;
    if (entry >= from && exit < to) included.push(trade);
  }
  const metrics = metricsForTrades(included);
  const qualityIssues = [
    ...(excluded.missingTimestamps > 0 ? ["closed_trades_missing_timestamps"] : []),
    ...(metrics.totalTrades > metrics.tradesWithProfit ? ["included_trades_missing_profit"] : []),
    ...(metrics.totalTrades > 0 && metrics.profitFactor === null ? ["profit_factor_unavailable"] : []),
  ];
  return { evidence: { metrics, excluded, qualityIssues }, trades: included };
}

export function validateStrategyWalkForwardFolds(
  folds: StrategyWalkForwardFold[],
  mode: WalkForwardMode,
  timeframe: string,
  embargoBars: number,
) {
  if (folds.length < 2 || folds.length > 12) throw new Error("walk-forward requires 2 to 12 folds");
  if (!Number.isInteger(embargoBars) || embargoBars < 1 || embargoBars > 100) {
    throw new Error("embargoBars must be an integer from 1 to 100");
  }
  const embargoMs = resolutionMilliseconds(timeframe) * embargoBars;
  const seen = new Set<string>();
  const parsed = folds.map((fold, index) => {
    if (!/^[\w.:-]{1,80}$/.test(fold.foldId)) throw new Error(`invalid fold id at index ${index}`);
    if (seen.has(fold.foldId)) throw new Error(`duplicate fold id ${fold.foldId}`);
    seen.add(fold.foldId);
    const trainFrom = timestamp(fold.trainFrom, `${fold.foldId}.trainFrom`);
    const trainTo = timestamp(fold.trainTo, `${fold.foldId}.trainTo`);
    const testFrom = timestamp(fold.testFrom, `${fold.foldId}.testFrom`);
    const testTo = timestamp(fold.testTo, `${fold.foldId}.testTo`);
    if (!(trainFrom < trainTo && trainTo <= testFrom && testFrom < testTo)) {
      throw new Error(`${fold.foldId} must satisfy trainFrom < trainTo <= testFrom < testTo`);
    }
    if (testFrom - trainTo < embargoMs) {
      throw new Error(`${fold.foldId} does not provide ${embargoBars} embargo bars`);
    }
    return { ...fold, trainFromMs: trainFrom, trainToMs: trainTo, testFromMs: testFrom, testToMs: testTo };
  });
  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    if (current.testFromMs < previous.testToMs) throw new Error("walk-forward test windows must not overlap");
    if (current.trainToMs <= previous.trainToMs || current.testToMs <= previous.testToMs) {
      throw new Error("walk-forward folds must advance chronologically");
    }
    if (mode === "anchored" && current.trainFromMs !== parsed[0].trainFromMs) {
      throw new Error("anchored folds must share the same trainFrom");
    }
    if (mode === "rolling" && current.trainFromMs <= previous.trainFromMs) {
      throw new Error("rolling fold trainFrom values must advance");
    }
  }
  return { folds: parsed, embargoMilliseconds: embargoMs };
}

export function evaluateStrategyWalkForward(input: {
  candidates: StrategyWalkForwardCandidate[];
  folds: StrategyWalkForwardFold[];
  mode: WalkForwardMode;
  timeframe: string;
  embargoBars: number;
  minimumTrainTrades: number;
  minimumTestTrades: number;
  selectionMetric: WalkForwardSelectionMetric;
}) {
  const { folds, embargoMilliseconds } = validateStrategyWalkForwardFolds(
    input.folds,
    input.mode,
    input.timeframe,
    input.embargoBars,
  );
  if (input.candidates.length < 2 || input.candidates.length > 8) {
    throw new Error("walk-forward requires 2 to 8 candidates");
  }
  if (new Set(input.candidates.map((candidate) => candidate.candidateId)).size !== input.candidates.length) {
    throw new Error("walk-forward candidate ids must be unique");
  }
  const earliest = Math.min(...folds.map((fold) => fold.trainFromMs));
  const latest = Math.max(...folds.map((fold) => fold.testToMs));
  const blockers: string[] = [];
  for (const candidate of input.candidates) {
    const rangeFrom = candidate.ledger.dateRange?.from ? Date.parse(candidate.ledger.dateRange.from) : NaN;
    const rangeTo = candidate.ledger.dateRange?.to ? Date.parse(candidate.ledger.dateRange.to) : NaN;
    if (!Number.isFinite(rangeFrom) || !Number.isFinite(rangeTo) || rangeFrom > earliest || rangeTo < latest) {
      blockers.push(`${candidate.candidateId}:ledger_date_range_does_not_cover_folds`);
    }
    if (!candidate.ledger.complete) blockers.push(`${candidate.candidateId}:ledger_incomplete`);
    if (candidate.ledger.qualityIssues.length > 0 || candidate.ledger.countMatchesSummary === false) {
      blockers.push(`${candidate.candidateId}:ledger_quality_issues`);
    }
  }
  if (blockers.length > 0) {
    return {
      status: "not_evaluable" as const,
      methodologyVersion: "ledger_partition_v1",
      blockers: [...new Set(blockers)],
      folds: [],
      oosAggregate: null,
    };
  }

  const aggregateTrades: StrategyLedgerTrade[] = [];
  const foldResults = folds.map((fold) => {
    const train = input.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      evidence: evidenceForWindow(candidate.ledger, fold.trainFromMs, fold.trainToMs).evidence,
    }));
    const eligible = train.filter(({ evidence }) =>
      evidence.metrics.totalTrades >= input.minimumTrainTrades &&
      evidence.qualityIssues.length === 0 &&
      evidence.metrics[input.selectionMetric] !== null &&
      Number.isFinite(evidence.metrics[input.selectionMetric]),
    );
    const best = eligible.length === 0
      ? null
      : Math.max(...eligible.map(({ evidence }) => evidence.metrics[input.selectionMetric] as number));
    const winners = best === null
      ? []
      : eligible.filter(({ evidence }) => Math.abs((evidence.metrics[input.selectionMetric] as number) - best) <= 1e-12);
    if (winners.length !== 1) {
      return {
        foldId: fold.foldId,
        trainWindow: { from: fold.trainFrom, to: fold.trainTo },
        embargoWindow: { from: fold.trainTo, to: fold.testFrom, bars: input.embargoBars },
        testWindow: { from: fold.testFrom, to: fold.testTo },
        train,
        selection: {
          status: winners.length === 0 ? "no_eligible_candidate" : "selection_tie",
          metric: input.selectionMetric,
          candidateId: null,
          value: best,
          tiedCandidateIds: winners.map((winner) => winner.candidateId),
        },
        test: null,
      };
    }
    const selected = input.candidates.find((candidate) => candidate.candidateId === winners[0].candidateId)!;
    const testWindow = evidenceForWindow(selected.ledger, fold.testFromMs, fold.testToMs);
    const test = testWindow.evidence;
    if (test.metrics.totalTrades >= input.minimumTestTrades && test.qualityIssues.length === 0) {
      aggregateTrades.push(...testWindow.trades);
    }
    return {
      foldId: fold.foldId,
      trainWindow: { from: fold.trainFrom, to: fold.trainTo },
      embargoWindow: { from: fold.trainTo, to: fold.testFrom, bars: input.embargoBars },
      testWindow: { from: fold.testFrom, to: fold.testTo },
      train,
      selection: {
        status: "selected",
        metric: input.selectionMetric,
        candidateId: selected.candidateId,
        value: best,
        tiedCandidateIds: [],
      },
      test: {
        candidateId: selected.candidateId,
        minimumTrades: input.minimumTestTrades,
        minimumTradesMet: test.metrics.totalTrades >= input.minimumTestTrades,
        evidence: test,
      },
    };
  });
  const selectedFolds = foldResults.filter((fold) => fold.selection.status === "selected");
  const evaluableTests = selectedFolds.filter((fold) => fold.test?.minimumTradesMet &&
    fold.test.evidence.qualityIssues.length === 0);
  return {
    status: evaluableTests.length === folds.length ? "complete" as const : "partial" as const,
    methodologyVersion: "ledger_partition_v1",
    mode: input.mode,
    embargoBars: input.embargoBars,
    embargoMilliseconds,
    selectionMetric: input.selectionMetric,
    minimumTrainTrades: input.minimumTrainTrades,
    minimumTestTrades: input.minimumTestTrades,
    blockers: [],
    folds: foldResults,
    oosAggregate: {
      evaluableFolds: evaluableTests.length,
      totalFolds: folds.length,
      metrics: metricsForTrades(aggregateTrades),
    },
  };
}
