import { createHash } from "node:crypto";
import type { StrategyLedgerTrade, StrategyTradeLedger } from "./tradingview.js";

export type StrategyStressScenario =
  | { scenarioId: string; kind: "additional_cost_per_trade"; value: number }
  | { scenarioId: string; kind: "commission_multiplier"; value: number }
  | { scenarioId: string; kind: "start_shift_bars"; value: number };

export interface StrategyStressInput {
  ledger: StrategyTradeLedger;
  evaluationFrom: string;
  evaluationTo: string;
  timeframe: string;
  minimumTrades: number;
  scenarios: StrategyStressScenario[];
  bootstrap: { seed: string; iterations: number; failureNetProfit: number } | null;
}

type StressTrade = { profit: number; commission: number | null };

const parseTime = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed;
};

function resolutionMilliseconds(value: string): number {
  const match = value.toUpperCase().match(/^(\d*)([SHDW]?)$/);
  if (!match) throw new Error(`strategy stress does not support timeframe ${JSON.stringify(value)}`);
  const count = Number(match[1] || "1");
  const multiplier = match[2] === "S" ? 1_000
    : match[2] === "H" ? 3_600_000
      : match[2] === "D" ? 86_400_000
        : match[2] === "W" ? 604_800_000
          : 60_000;
  return count * multiplier;
}

function metrics(trades: StressTrade[]) {
  const profits = trades.map((trade) => trade.profit);
  const gains = profits.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = -profits.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  let equity = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
  }
  const netProfit = profits.reduce((sum, value) => sum + value, 0);
  return {
    totalTrades: profits.length,
    expectancy: profits.length === 0 ? null : netProfit / profits.length,
    netProfit,
    profitFactor: losses === 0 ? (gains > 0 ? null : 0) : gains / losses,
    winRate: profits.length === 0 ? null : profits.filter((value) => value > 0).length / profits.length,
    maxClosedTradeEquityDrawdown: maximumDrawdown,
  };
}

function quantile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function seededRandom(seed: string): () => number {
  let state = createHash("sha256").update(seed, "utf8").digest().readUInt32LE(0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function degradation(baseline: ReturnType<typeof metrics>, stressed: ReturnType<typeof metrics>) {
  const relative = (base: number | null, value: number | null) =>
    base === null || value === null || base === 0 ? null : (value - base) / Math.abs(base);
  return {
    expectancy: relative(baseline.expectancy, stressed.expectancy),
    netProfit: relative(baseline.netProfit, stressed.netProfit),
    profitFactor: relative(baseline.profitFactor, stressed.profitFactor),
  };
}

function windowTrades(ledger: StrategyTradeLedger, from: number, to: number) {
  const included: Array<StrategyLedgerTrade & { entry: NonNullable<StrategyLedgerTrade["entry"]>; exit: NonNullable<StrategyLedgerTrade["exit"]> }> = [];
  const excluded = { openTrades: 0, missingTimestamps: 0, crossingStart: 0, crossingEnd: 0 };
  for (const trade of ledger.trades) {
    if (trade.status !== "closed") { excluded.openTrades += 1; continue; }
    if (trade.entry?.time === null || trade.entry?.time === undefined ||
        trade.exit?.time === null || trade.exit?.time === undefined) {
      excluded.missingTimestamps += 1; continue;
    }
    if (trade.entry.time < from && trade.exit.time >= from) { excluded.crossingStart += 1; continue; }
    if (trade.entry.time < to && trade.exit.time >= to) { excluded.crossingEnd += 1; continue; }
    if (trade.entry.time >= from && trade.exit.time < to) included.push(trade as typeof included[number]);
  }
  return { included, excluded };
}

export function evaluateStrategyStress(input: StrategyStressInput) {
  if (input.scenarios.length < 1 || input.scenarios.length > 20) throw new Error("strategy stress requires 1 to 20 scenarios");
  if (!Number.isInteger(input.minimumTrades) || input.minimumTrades < 1) throw new Error("minimumTrades must be a positive integer");
  if (new Set(input.scenarios.map((scenario) => scenario.scenarioId)).size !== input.scenarios.length) {
    throw new Error("strategy stress scenario ids must be unique");
  }
  for (const scenario of input.scenarios) {
    if (!Number.isFinite(scenario.value)) throw new Error(`scenario ${scenario.scenarioId} value must be finite`);
    if (scenario.kind === "additional_cost_per_trade" && scenario.value < 0) throw new Error("additional cost must be non-negative");
    if (scenario.kind === "commission_multiplier" && scenario.value < 1) throw new Error("commission multiplier must be at least one");
    if (scenario.kind === "start_shift_bars" && (!Number.isInteger(scenario.value) || scenario.value < 1 || scenario.value > 100)) {
      throw new Error("start shift bars must be an integer from 1 to 100");
    }
  }
  if (input.bootstrap !== null &&
      (!Number.isInteger(input.bootstrap.iterations) || input.bootstrap.iterations < 100 || input.bootstrap.iterations > 10_000 ||
       input.bootstrap.seed.length < 1 || input.bootstrap.seed.length > 128 || !Number.isFinite(input.bootstrap.failureNetProfit))) {
    throw new Error("invalid bootstrap contract");
  }
  const from = parseTime(input.evaluationFrom, "evaluation_from");
  const to = parseTime(input.evaluationTo, "evaluation_to");
  if (from >= to) throw new Error("evaluation_to must be after evaluation_from");
  const ledgerFrom = input.ledger.dateRange?.from ? parseTime(input.ledger.dateRange.from, "ledger.dateRange.from") : null;
  const ledgerTo = input.ledger.dateRange?.to ? parseTime(input.ledger.dateRange.to, "ledger.dateRange.to") : null;
  const blockers = [
    ...(!input.ledger.complete ? ["ledger_incomplete"] : []),
    ...(input.ledger.countMatchesSummary === false ? ["report_trade_count_mismatch"] : []),
    ...input.ledger.qualityIssues.map((issue) => `ledger_quality:${issue}`),
    ...(ledgerFrom === null || ledgerTo === null || ledgerFrom > from || ledgerTo < to ? ["ledger_date_range_does_not_cover_evaluation"] : []),
  ];
  const selected = windowTrades(input.ledger, from, to);
  const baselineTrades: StressTrade[] = [];
  if (selected.included.some((trade) => typeof trade.profit !== "number" || !Number.isFinite(trade.profit))) {
    blockers.push("included_trade_profit_unavailable");
  } else {
    baselineTrades.push(...selected.included.map((trade) => ({ profit: trade.profit!, commission: trade.commission })));
  }
  if (baselineTrades.length < input.minimumTrades) blockers.push("minimum_trade_count_not_met");
  if (blockers.length > 0) {
    return { status: "not_evaluable" as const, methodologyVersion: "ledger_stress_v1" as const,
      blockers: [...new Set(blockers)], baseline: null, scenarios: [], distribution: null, bootstrap: null };
  }

  const baselineMetrics = metrics(baselineTrades);
  const timeframeMs = resolutionMilliseconds(input.timeframe);
  const scenarioResults = input.scenarios.map((scenario) => {
    let adjusted: StressTrade[] | null = null;
    let reason: string | null = null;
    let excluded = selected.excluded;
    if (scenario.kind === "additional_cost_per_trade") {
      adjusted = baselineTrades.map((trade) => ({ ...trade, profit: trade.profit - scenario.value }));
    } else if (scenario.kind === "commission_multiplier") {
      if (baselineTrades.some((trade) => trade.commission === null)) reason = "trade_commission_unavailable";
      else adjusted = baselineTrades.map((trade) => ({ ...trade,
        profit: trade.profit - trade.commission! * (scenario.value - 1) }));
    } else {
      const shifted = windowTrades(input.ledger, from + scenario.value * timeframeMs, to);
      excluded = shifted.excluded;
      if (shifted.included.some((trade) => typeof trade.profit !== "number" || !Number.isFinite(trade.profit))) {
        reason = "included_trade_profit_unavailable";
      } else if (shifted.included.length < input.minimumTrades) {
        reason = "minimum_trade_count_not_met";
      } else {
        adjusted = shifted.included.map((trade) => ({ profit: trade.profit!, commission: trade.commission }));
      }
    }
    if (adjusted === null) return { ...scenario, status: "not_evaluable" as const, reason, metrics: null, degradation: null, excluded };
    const scenarioMetrics = metrics(adjusted);
    return { ...scenario, status: "complete" as const, reason: null, metrics: scenarioMetrics,
      degradation: degradation(baselineMetrics, scenarioMetrics), excluded };
  });
  const evaluable = scenarioResults.filter((scenario) => scenario.metrics !== null);
  const distributionFor = (key: "expectancy" | "netProfit" | "profitFactor" | "maxClosedTradeEquityDrawdown") => {
    const values = evaluable.map((scenario) => scenario.metrics![key]).filter((value): value is number => value !== null);
    const minimum = values.length ? Math.min(...values) : null;
    const maximum = values.length ? Math.max(...values) : null;
    return { minimum, median: quantile(values, 0.5), maximum,
      worst: key === "maxClosedTradeEquityDrawdown" ? maximum : minimum };
  };
  const deterministicDistribution = {
    evaluableScenarios: evaluable.length,
    totalScenarios: scenarioResults.length,
    failureRate: evaluable.length === 0 ? null : evaluable.filter((scenario) => scenario.metrics!.netProfit <= 0).length / evaluable.length,
    expectancy: distributionFor("expectancy"),
    netProfit: distributionFor("netProfit"),
    profitFactor: distributionFor("profitFactor"),
    maxClosedTradeEquityDrawdown: distributionFor("maxClosedTradeEquityDrawdown"),
  };

  let bootstrap = null;
  if (input.bootstrap !== null) {
    const random = seededRandom(input.bootstrap.seed);
    const samples: Array<ReturnType<typeof metrics>> = [];
    for (let iteration = 0; iteration < input.bootstrap.iterations; iteration += 1) {
      const sampled = Array.from({ length: baselineTrades.length }, () =>
        baselineTrades[Math.floor(random() * baselineTrades.length)]);
      samples.push(metrics(sampled));
    }
    const summarize = (key: "expectancy" | "netProfit" | "profitFactor" | "maxClosedTradeEquityDrawdown") => {
      const values = samples.map((sample) => sample[key]).filter((value): value is number => value !== null);
      return { p05: quantile(values, 0.05), median: quantile(values, 0.5), p95: quantile(values, 0.95), worst: values.length ? (key === "maxClosedTradeEquityDrawdown" ? Math.max(...values) : Math.min(...values)) : null };
    };
    bootstrap = {
      seed: input.bootstrap.seed,
      iterations: input.bootstrap.iterations,
      failureNetProfit: input.bootstrap.failureNetProfit,
      failureRate: samples.filter((sample) => sample.netProfit <= input.bootstrap!.failureNetProfit).length / samples.length,
      expectancy: summarize("expectancy"), netProfit: summarize("netProfit"),
      profitFactor: summarize("profitFactor"), maxClosedTradeEquityDrawdown: summarize("maxClosedTradeEquityDrawdown"),
    };
  }
  return {
    status: scenarioResults.every((scenario) => scenario.status === "complete") ? "complete" as const : "partial" as const,
    methodologyVersion: "ledger_stress_v1" as const,
    blockers: [],
    baseline: { window: { from: input.evaluationFrom, to: input.evaluationTo }, metrics: baselineMetrics, excluded: selected.excluded },
    scenarios: scenarioResults,
    distribution: deterministicDistribution,
    bootstrap,
  };
}
