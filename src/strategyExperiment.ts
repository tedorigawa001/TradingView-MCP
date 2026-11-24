import { z } from "zod";
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

export function compareStrategyInputOverrides(
  baseline: StrategyTradeLedger,
  candidate: StrategyTradeLedger,
  allowed: string[],
) {
  const before = new Map(baseline.inputs.map(input => [input.id, input.value]));
  const after = new Map(candidate.inputs.map(input => [input.id, input.value]));
  const ids = new Set([...before.keys(), ...after.keys(), ...allowed]);
  return [...ids].sort().filter(id => !before.has(id) || !after.has(id) ||
    (!allowed.includes(id) && !Object.is(before.get(id), after.get(id))));
}

const overlapSide = z.object({
  time: z.number().int().nullable(),
  price: z.number().finite().nullable(),
  label: z.string().max(256).nullable(),
});
const overlapTrade = z.object({
  direction: z.enum(["long", "short"]).nullable(),
  status: z.enum(["closed", "open"]),
  entry: overlapSide.nullable(),
  exit: overlapSide.nullable(),
  quantity: z.number().finite().nullable(),
  profit: z.number().finite().nullable(),
  commission: z.number().finite().nullable(),
});
const overlapLedger = z.object({
  ledgerId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  symbol: z.string().min(1).max(100),
  timeframe: z.string().regex(/^[1-9]\d{0,3}$/),
  pineId: z.string().regex(/^USER;[\w]{8,64}$/),
  pineVersion: z.string().regex(/^[0-9]{1,6}(\.[0-9]{1,3})?$/),
  currency: z.string().min(1).max(12),
  dateRange: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  initialCapital: z.number().finite().nullable(),
  inputs: z.array(z.object({
    id: z.string().min(1).max(64),
    name: z.string().max(256),
    value: z.union([z.string().max(1024), z.number().finite(), z.boolean(), z.null()]),
  })).max(128),
  availableTrades: z.number().int().min(0).max(2000),
  totalTrades: z.number().int().min(0).max(2000),
  complete: z.literal(true),
  countMatchesSummary: z.literal(true),
  trades: z.array(overlapTrade).max(2000),
});
export const strategyOverlapSchema = z.object({
  earlier: overlapLedger,
  later: overlapLedger,
  from: z.string().datetime(),
  to: z.string().datetime(),
  boundary: z.string().datetime(),
});
type OverlapLedger = z.infer<typeof overlapLedger>;
type OverlapTrade = z.infer<typeof overlapTrade>;

function overlapExit(trade: OverlapTrade, to: number) {
  return trade.exit?.time != null && trade.exit.time < to ? trade.exit : null;
}

function overlapTimingKey(trade: OverlapTrade, to: number) {
  return JSON.stringify([trade.direction, trade.entry?.time, overlapExit(trade, to)?.time]);
}

function indexTrades(trades: OverlapTrade[], from: number, to: number, incompleteLabels: Set<string>) {
  const byIdentity = new Map<string, OverlapTrade[]>();
  for (const trade of trades) {
    if (trade.entry!.time! >= to || (trade.exit && trade.exit.time! < from)) continue;
    const exit = overlapExit(trade, to);
    const timing = overlapTimingKey(trade, to);
    const key = incompleteLabels.has(timing) ? timing : JSON.stringify([timing, trade.entry?.label, exit?.label]);
    const group = byIdentity.get(key);
    if (group) group.push(trade);
    else byIdentity.set(key, [trade]);
  }
  return byIdentity;
}

function summarizeOverlapBoundary(ledger: OverlapLedger, boundary: number) {
  const capitalInput = ledger.inputs.find(input => input.name.trim().toLowerCase() === "initial capital");
  const initialCapital = ledger.initialCapital ?? finite(capitalInput?.value);
  const closed = ledger.trades.filter(trade => trade.exit !== null && trade.exit.time! < boundary);
  const positions = ledger.trades.filter(trade => trade.entry!.time! < boundary &&
    (trade.exit === null || trade.exit.time! >= boundary));
  return {
    realizedEquity: initialCapital !== null && closed.every(trade => trade.profit !== null)
      ? initialCapital + closed.reduce((sum, trade) => sum + trade.profit!, 0)
      : null,
    positionCount: positions.length,
    positions: positions.map(trade => ({
      direction: trade.direction, entry: trade.entry, quantity: trade.quantity,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

export function diagnoseStrategyTradeOverlap(input: z.infer<typeof strategyOverlapSchema>) {
  const { earlier, later } = input;
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const boundary = Date.parse(input.boundary);
  if (!(from <= boundary && boundary < to)) throw new Error("overlap must contain the boundary in [from, to)");
  if (earlier.symbol !== later.symbol || earlier.timeframe !== later.timeframe || earlier.pineId !== later.pineId ||
      earlier.pineVersion !== later.pineVersion || earlier.currency !== later.currency ||
      earlier.initialCapital !== later.initialCapital) {
    throw new Error("overlap ledgers must describe the same instrument, Pine version and account conditions");
  }
  for (const ledger of [earlier, later]) {
    if (new Set(ledger.inputs.map(input => input.id)).size !== ledger.inputs.length) {
      throw new Error("overlap ledger has duplicate input identifiers");
    }
    if (ledger.availableTrades !== ledger.trades.length ||
        ledger.totalTrades !== ledger.trades.filter(trade => trade.status === "closed").length ||
        ledger.trades.some(trade => trade.entry?.time == null || trade.direction === null ||
          (trade.status === "open" ? trade.exit !== null : trade.exit?.time == null || trade.exit.time < trade.entry.time))) {
      throw new Error("overlap ledger trade counts or chronology could not be verified");
    }
    const nativeFrom = Date.parse(ledger.dateRange.from);
    const nativeTo = Date.parse(ledger.dateRange.to);
    if (nativeFrom > nativeTo || nativeFrom > from || nativeTo + Number(ledger.timeframe) * 60_000 < to) {
      throw new Error("overlap is outside the supplied report bar ranges");
    }
  }
  const sortedInputs = (ledger: OverlapLedger) => [...ledger.inputs].sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(sortedInputs(earlier)) !== JSON.stringify(sortedInputs(later))) {
    throw new Error("overlap diagnosis requires identical inputs");
  }

  const incompleteLabels = new Set([...earlier.trades, ...later.trades].filter(trade => {
    const exit = overlapExit(trade, to);
    return !trade.entry?.label || (exit !== null && !exit.label);
  }).map(trade => overlapTimingKey(trade, to)));
  const first = indexTrades(earlier.trades, from, to, incompleteLabels);
  const second = indexTrades(later.trades, from, to, incompleteLabels);
  const identities = [...new Set([...first.keys(), ...second.keys()])].sort((a, b) => {
    const left = first.get(a)?.[0] ?? second.get(a)![0];
    const right = first.get(b)?.[0] ?? second.get(b)![0];
    return left.entry!.time! - right.entry!.time! || a.localeCompare(b);
  });
  const counts = { matchedByIdentity: 0, identical: 0, different: 0, ambiguous: 0, earlierOnly: 0, laterOnly: 0, unconfirmed: 0 };
  let firstDifference: { entryTime: number; kind: string; fields: string[] } | null = null;
  for (const identity of identities) {
    const left = first.get(identity) ?? [];
    const right = second.get(identity) ?? [];
    let kind: keyof typeof counts;
    let fields: string[] = [];
    if (left.length > 1 || right.length > 1) kind = "ambiguous";
    else if (incompleteLabels.has(identity)) kind = "unconfirmed";
    else if (left.length === 0) kind = "laterOnly";
    else if (right.length === 0) kind = "earlierOnly";
    else {
      counts.matchedByIdentity++;
      const [a] = left;
      const [b] = right;
      const exitA = overlapExit(a, to);
      const exitB = overlapExit(b, to);
      const valuesA = { entryPrice: a.entry!.price, quantity: a.quantity,
        ...(exitA ? { exitPrice: exitA.price, profit: a.profit, commission: a.commission } : {}) };
      const valuesB = { entryPrice: b.entry!.price, quantity: b.quantity,
        ...(exitB ? { exitPrice: exitB.price, profit: b.profit, commission: b.commission } : {}) };
      const names = Object.keys(valuesA) as Array<keyof typeof valuesA>;
      fields = names.filter(name => valuesA[name] != null && valuesB[name] != null && !Object.is(valuesA[name], valuesB[name]));
      const missing = names.some(name => valuesA[name] == null || valuesB[name] == null);
      kind = fields.length ? "different" : missing ? "unconfirmed" : "identical";
    }
    counts[kind]++;
    if (kind !== "identical" && firstDifference === null) {
      firstDifference = { entryTime: (left[0] ?? right[0]).entry!.time!, kind, fields };
    }
  }

  const earlierState = summarizeOverlapBoundary(earlier, boundary);
  const laterState = summarizeOverlapBoundary(later, boundary);
  const realizedEquityMatches = earlierState.realizedEquity === null || laterState.realizedEquity === null
    ? null : Math.abs(earlierState.realizedEquity - laterState.realizedEquity) < 0.000001;
  const positionTerms = (state: typeof earlierState) => state.positions.map(position =>
    JSON.stringify([position.direction, position.entry?.time, position.entry?.price, position.quantity])).sort();
  const positionsMatch = [...earlierState.positions, ...laterState.positions].some(position => position.quantity === null || position.entry?.price == null)
    ? null : JSON.stringify(positionTerms(earlierState)) === JSON.stringify(positionTerms(laterState));
  const discontinuity = counts.different > 0 || counts.earlierOnly > 0 || counts.laterOnly > 0 ||
    realizedEquityMatches === false || positionsMatch === false;
  return {
    evidence: "caller_supplied_trade_ledgers",
    ledgerIds: [earlier.ledgerId, later.ledgerId],
    counts,
    firstDifference,
    boundary: {
      earlier: earlierState, later: laterState, realizedEquityMatches, positionsMatch,
      indicators: "unconfirmed", pendingOrders: "unconfirmed",
    },
    continuity: discontinuity ? "discontinuous" : "unconfirmed",
    continuousAggregationEligible: false,
  };
}
