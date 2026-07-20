import type { StrategyReport, StrategyTradeLedger } from "./tradingview.js";

export interface StrategyExperimentEvidence {
  report: StrategyReport;
  ledger: StrategyTradeLedger;
}

const METRIC_KEYS = [
  "netProfit",
  "netProfitPercent",
  "profitFactor",
  "maxDrawdown",
  "maxDrawdownPercent",
  "sharpeRatio",
  "sortinoRatio",
] as const;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null);
  return usable.length === 0 ? null : usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

export function summarizeStrategyEvidence(
  evidence: StrategyExperimentEvidence,
  minimumTrades: number,
): {
  metrics: Record<string, number | null>;
  minimumTrades: number;
  minimumTradesMet: boolean;
  sample: {
    availableTrades: number;
    closedTrades: number;
    profitableTradesWithValue: number;
    tradesWithDuration: number;
    tradesWithRunUp: number;
    tradesWithDrawDown: number;
  };
  qualityIssues: string[];
} {
  const { report, ledger } = evidence;
  const closed = ledger.trades.filter((trade) => trade.status === "closed");
  const profits = closed.map((trade) => finite(trade.profit));
  const durations = closed.map((trade) => finite(trade.durationMilliseconds));
  const runUps = closed.map((trade) => finite(trade.runUp));
  const drawDowns = closed.map((trade) => finite(trade.drawDown));
  const metrics: Record<string, number | null> = {
    totalTrades: finite(ledger.totalTrades) ?? ledger.availableTrades,
    expectancy: average(profits),
    averageDurationMilliseconds: average(durations),
    averageRunUp: average(runUps),
    averageDrawDown: average(drawDowns),
    worstTradeDrawDown: drawDowns.some((value) => value !== null)
      ? Math.max(...drawDowns.filter((value): value is number => value !== null))
      : null,
  };
  for (const key of METRIC_KEYS) metrics[key] = finite(report.summary[key]);
  const qualityIssues = [...new Set(ledger.qualityIssues)];
  if (ledger.countMatchesSummary === false) qualityIssues.push("report_trade_count_mismatch");
  if (closed.length < minimumTrades) qualityIssues.push("minimum_trade_count_not_met");
  return {
    metrics,
    minimumTrades,
    minimumTradesMet: closed.length >= minimumTrades,
    sample: {
      availableTrades: ledger.availableTrades,
      closedTrades: closed.length,
      profitableTradesWithValue: profits.filter((value) => value !== null).length,
      tradesWithDuration: durations.filter((value) => value !== null).length,
      tradesWithRunUp: runUps.filter((value) => value !== null).length,
      tradesWithDrawDown: drawDowns.filter((value) => value !== null).length,
    },
    qualityIssues: [...new Set(qualityIssues)],
  };
}

export function compareStrategyMetrics(
  baseline: Record<string, number | null>,
  candidate: Record<string, number | null>,
): Record<string, { baseline: number | null; candidate: number | null; delta: number | null }> {
  const keys = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort();
  return Object.fromEntries(keys.map((key) => {
    const before = finite(baseline[key]);
    const after = finite(candidate[key]);
    return [key, {
      baseline: before,
      candidate: after,
      delta: before === null || after === null ? null : after - before,
    }];
  }));
}

const CONDITION_NAME_PATTERN =
  /(commission|slippage|initial capital|base currency|qty|quantity|margin|fill assumption|bar magnifier|process orders|calculate strategy)/i;

export function strategyConditionInputs(ledger: StrategyTradeLedger): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    ledger.inputs
      .filter((input) => CONDITION_NAME_PATTERN.test(input.name))
      .map((input) => [input.name.trim().toLowerCase(), input.value]),
  );
}

export function compareStrategyConditions(
  baseline: StrategyTradeLedger,
  candidate: StrategyTradeLedger,
): {
  matched: boolean;
  differences: Array<{ condition: string; baseline: unknown; candidate: unknown }>;
  qualityIssues: string[];
} {
  const baselineInputs = strategyConditionInputs(baseline);
  const candidateInputs = strategyConditionInputs(candidate);
  const names = [...new Set([...Object.keys(baselineInputs), ...Object.keys(candidateInputs)])].sort();
  const differences: Array<{ condition: string; baseline: unknown; candidate: unknown }> = names
    .filter((name) => baselineInputs[name] !== candidateInputs[name])
    .map((condition) => ({
      condition,
      baseline: baselineInputs[condition] ?? null,
      candidate: candidateInputs[condition] ?? null,
    }));
  if (baseline.currency !== candidate.currency) {
    differences.push({ condition: "report_currency", baseline: baseline.currency, candidate: candidate.currency });
  }
  if (baseline.initialCapital !== candidate.initialCapital) {
    differences.push({
      condition: "report_initial_capital",
      baseline: baseline.initialCapital,
      candidate: candidate.initialCapital,
    });
  }
  if (JSON.stringify(baseline.dateRange) !== JSON.stringify(candidate.dateRange)) {
    differences.push({ condition: "report_date_range", baseline: baseline.dateRange, candidate: candidate.dateRange });
  }
  const qualityIssues: string[] = [];
  if (names.length === 0) qualityIssues.push("cost_and_sizing_inputs_not_identified");
  if (differences.length > 0) qualityIssues.push("experiment_conditions_differ");
  return { matched: differences.length === 0, differences, qualityIssues };
}
