import type { StrategyTradeLedger } from "./tradingview.js";
import {
  evaluateStrategyWalkForward,
  type StrategyWalkForwardCandidate,
  type StrategyWalkForwardFold,
  type WalkForwardMode,
  type WalkForwardSelectionMetric,
} from "./strategyWalkForward.js";

const MAX_REPLICATIONS = 2_000;
const MAX_SEED = 2_147_483_647;
const DAY_MS = 86_400_000;

export interface StrategyWalkForwardFalsificationAuditInput {
  candidates: StrategyWalkForwardCandidate[];
  folds: StrategyWalkForwardFold[];
  mode: WalkForwardMode;
  timeframe: string;
  embargoBars: number;
  minimumTrainTrades: number;
  minimumTestTrades: number;
  selectionMetric: WalkForwardSelectionMetric;
  replications: number;
  firstSeed?: number;
  /** Shared UTC calendar blocks retain contemporaneous dependence between candidates. */
  blockLengthCalendarDays?: number;
  nominalAlpha: number;
}

type Decision = {
  outcome: "candidate" | "non_candidate" | "not_evaluable";
  reason: string;
  postSelectionOosNetProfit: number | null;
  empiricalPValue: number | null;
};

export interface StrategyWalkForwardFalsificationAuditResult {
  methodologyVersion: "strategy_walk_forward_falsification_audit_v2";
  nullModel: "shared_calendar_block_sign_flip_centered_trade_profit";
  replications: number;
  firstSeed: number;
  blockLengthCalendarDays: number;
  nominalAlpha: number;
  observed: Decision;
  status: "complete" | "incomplete";
  completed: number;
  evaluated: number;
  notEvaluableSeeds: number[];
  failed: Array<{ seed: number; error: string }>;
  candidates: number;
  candidateSeeds: number[];
  observedRate: number | null;
  observedRateInterval: { lower: number; upper: number } | null;
  exceedsNominalAlpha: boolean;
  candidateRule: {
    allFoldsEvaluable: true;
    aggregateNetProfit: "positive";
    aggregateProfitFactor: "greater_than_one";
    postSelectionOosNetProfit: "empirical_one_sided_p_at_most_nominal_alpha";
  };
  limitations: string[];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function wilsonInterval(successes: number, observations: number): { lower: number; upper: number } {
  const z = 1.959963984540054;
  const rate = successes / observations;
  const denominator = 1 + (z * z) / observations;
  const centre = rate + (z * z) / (2 * observations);
  const spread = z * Math.sqrt((rate * (1 - rate)) / observations + (z * z) / (4 * observations * observations));
  return {
    lower: successes === 0 ? 0 : Math.max(0, (centre - spread) / denominator),
    upper: successes === observations ? 1 : Math.min(1, (centre + spread) / denominator),
  };
}

function evaluate(input: Omit<StrategyWalkForwardFalsificationAuditInput, "replications" | "firstSeed" | "blockLengthCalendarDays" | "nominalAlpha">) {
  return evaluateStrategyWalkForward({
    candidates: input.candidates,
    folds: input.folds,
    mode: input.mode,
    timeframe: input.timeframe,
    embargoBars: input.embargoBars,
    minimumTrainTrades: input.minimumTrainTrades,
    minimumTestTrades: input.minimumTestTrades,
    selectionMetric: input.selectionMetric,
  });
}

type AggregateEvidence = { netProfit: number; profitFactor: number };

function aggregateEvidence(evaluation: ReturnType<typeof evaluateStrategyWalkForward>): AggregateEvidence | null {
  if (evaluation.status !== "complete") {
    return null;
  }
  const metrics = evaluation.oosAggregate?.metrics;
  if (metrics === undefined || metrics === null || metrics.netProfit === null || metrics.profitFactor === null) {
    return null;
  }
  return { netProfit: metrics.netProfit, profitFactor: metrics.profitFactor };
}

export function assessStrategyWalkForwardCandidate(
  evaluation: ReturnType<typeof evaluateStrategyWalkForward>,
  empiricalPValue: number | null,
  nominalAlpha: number,
): Decision {
  const evidence = aggregateEvidence(evaluation);
  if (evidence === null) {
    return {
      outcome: "not_evaluable",
      reason: evaluation.status !== "complete" ? `walk_forward_${evaluation.status}` : "aggregate_metrics_unavailable",
      postSelectionOosNetProfit: null,
      empiricalPValue: null,
    };
  }
  return assessAggregateEvidence(evidence, empiricalPValue, nominalAlpha);
}

function assessAggregateEvidence(
  evidence: AggregateEvidence,
  empiricalPValue: number | null,
  nominalAlpha: number,
): Decision {
  if (empiricalPValue === null) {
    return {
      outcome: "not_evaluable",
      reason: "empirical_null_distribution_unavailable",
      postSelectionOosNetProfit: evidence.netProfit,
      empiricalPValue: null,
    };
  }
  if (evidence.netProfit > 0 && evidence.profitFactor > 1 && empiricalPValue <= nominalAlpha) {
    return {
      outcome: "candidate",
      reason: "all_oos_folds_evaluable_with_positive_net_profit_profit_factor_above_one_and_empirical_p_at_most_nominal_alpha",
      postSelectionOosNetProfit: evidence.netProfit,
      empiricalPValue,
    };
  }
  return {
    outcome: "non_candidate",
    reason: "aggregate_oos_candidate_rule_not_met",
    postSelectionOosNetProfit: evidence.netProfit,
    empiricalPValue,
  };
}

type CenteredProfit = { reportIndex: number; time: number; value: number };

function centeredProfits(ledger: StrategyTradeLedger): CenteredProfit[] {
  const values = ledger.trades.flatMap((trade) => {
    const profit = trade.profit;
    const time = trade.exit?.time;
    if (trade.status !== "closed" || profit === null || !Number.isFinite(profit) ||
        time === null || time === undefined || !Number.isFinite(time)) return [];
    return [{ reportIndex: trade.reportIndex, time, value: profit }];
  });
  if (values.length < 2) throw new Error(`${ledger.ledgerId} requires at least two closed trades with finite profit and exit time`);
  const average = values.reduce((sum, item) => sum + item.value, 0) / values.length;
  return values.map((item) => ({ ...item, value: item.value - average }));
}

function nullLedger(
  ledger: StrategyTradeLedger,
  centered: CenteredProfit[],
  origin: number,
  blockLengthCalendarDays: number,
  signs: Map<number, number>,
  random: () => number,
  seed: number,
): StrategyTradeLedger {
  const profitByReportIndex = new Map<number, number>();
  for (const item of centered) {
    const block = Math.floor((item.time - origin) / (blockLengthCalendarDays * DAY_MS));
    let sign = signs.get(block);
    if (sign === undefined) {
      sign = random() < 0.5 ? -1 : 1;
      signs.set(block, sign);
    }
    profitByReportIndex.set(item.reportIndex, item.value * sign);
  }
  return {
    ...ledger,
    ledgerId: `${ledger.ledgerId}:falsification:${seed}`,
    trades: ledger.trades.map((trade) => {
      const profit = profitByReportIndex.get(trade.reportIndex);
      return profit === undefined ? trade : { ...trade, profit, profitPercent: null, cumulativeProfit: null };
    }),
  };
}

function validate(input: StrategyWalkForwardFalsificationAuditInput): { firstSeed: number; blockLengthCalendarDays: number } {
  if (!Number.isInteger(input.replications) || input.replications < 1 || input.replications > MAX_REPLICATIONS) {
    throw new Error(`strategy walk-forward falsification replications must be an integer from 1 to ${MAX_REPLICATIONS}`);
  }
  const firstSeed = input.firstSeed ?? 1;
  if (!Number.isInteger(firstSeed) || firstSeed < 0 || firstSeed + input.replications - 1 > MAX_SEED) {
    throw new Error(`strategy walk-forward falsification seeds must stay within 0 to ${MAX_SEED}`);
  }
  const blockLengthCalendarDays = input.blockLengthCalendarDays ?? 5;
  if (!Number.isInteger(blockLengthCalendarDays) || blockLengthCalendarDays < 1 || blockLengthCalendarDays > 60) {
    throw new Error("strategy walk-forward falsification blockLengthCalendarDays must be an integer from 1 to 60");
  }
  if (!Number.isFinite(input.nominalAlpha) || input.nominalAlpha <= 0 || input.nominalAlpha >= 1) {
    throw new Error("strategy walk-forward falsification nominal alpha must be between zero and one");
  }
  return { firstSeed, blockLengthCalendarDays };
}

/**
 * Calibrates the whole candidate-selection to OOS-decision path with a ledger-level empirical null.
 * It intentionally does not synthesize OHLC or rerun Pine: it tests selection inflation after the
 * exact full ledgers have been collected, while retaining the observed timestamp, trade-count, and
 * contemporaneous cross-candidate shock structure.
 */
export function runStrategyWalkForwardFalsificationAudit(
  input: StrategyWalkForwardFalsificationAuditInput,
): StrategyWalkForwardFalsificationAuditResult {
  const { firstSeed, blockLengthCalendarDays } = validate(input);
  const baseInput = {
    candidates: input.candidates,
    folds: input.folds,
    mode: input.mode,
    timeframe: input.timeframe,
    embargoBars: input.embargoBars,
    minimumTrainTrades: input.minimumTrainTrades,
    minimumTestTrades: input.minimumTestTrades,
    selectionMetric: input.selectionMetric,
  };
  const observedEvaluation = evaluate(baseInput);
  const centeredByCandidate = new Map(input.candidates.map((candidate) => [candidate.candidateId, centeredProfits(candidate.ledger)]));
  const origin = Math.min(...[...centeredByCandidate.values()].flatMap((items) => items.map((item) => item.time)));
  const notEvaluableSeeds: number[] = [];
  const failed: Array<{ seed: number; error: string }> = [];
  const nullRuns: Array<{ seed: number; evidence: AggregateEvidence }> = [];
  for (let index = 0; index < input.replications; index += 1) {
    const seed = firstSeed + index;
    try {
      const random = mulberry32(seed);
      const signs = new Map<number, number>();
      const evaluation = evaluate({
        ...baseInput,
        candidates: input.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          ledger: nullLedger(candidate.ledger, centeredByCandidate.get(candidate.candidateId)!, origin,
            blockLengthCalendarDays, signs, random, seed),
        })),
      });
      const evidence = aggregateEvidence(evaluation);
      if (evidence === null) notEvaluableSeeds.push(seed);
      else nullRuns.push({ seed, evidence });
    } catch (error) {
      failed.push({ seed, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const completed = input.replications - failed.length;
  const evaluated = nullRuns.length;
  const observedEvidence = aggregateEvidence(observedEvaluation);
  const observedPValue = observedEvidence === null || evaluated === 0 ? null
    : (1 + nullRuns.filter((run) => run.evidence.netProfit >= observedEvidence.netProfit).length) / (evaluated + 1);
  const observed = assessStrategyWalkForwardCandidate(observedEvaluation, observedPValue, input.nominalAlpha);
  const candidateSeeds = nullRuns.filter((run) => {
    // Leave this draw out of its own reference distribution. Otherwise every null draw receives a
    // free self-exceedance and the calibration becomes unnecessarily conservative.
    const pValue = (1 + nullRuns.filter((other) => other.seed !== run.seed &&
      other.evidence.netProfit >= run.evidence.netProfit).length) / evaluated;
    const decision = assessAggregateEvidence(run.evidence, pValue, input.nominalAlpha);
    return decision.outcome === "candidate";
  }).map((run) => run.seed);
  const observedRate = evaluated === 0 ? null : candidateSeeds.length / evaluated;
  const observedRateInterval = evaluated === 0 ? null : wilsonInterval(candidateSeeds.length, evaluated);
  return {
    methodologyVersion: "strategy_walk_forward_falsification_audit_v2",
    nullModel: "shared_calendar_block_sign_flip_centered_trade_profit",
    replications: input.replications,
    firstSeed,
    blockLengthCalendarDays,
    nominalAlpha: input.nominalAlpha,
    observed,
    status: failed.length === 0 ? "complete" : "incomplete",
    completed,
    evaluated,
    notEvaluableSeeds,
    failed,
    candidates: candidateSeeds.length,
    candidateSeeds,
    observedRate,
    observedRateInterval,
    exceedsNominalAlpha: failed.length === 0 && observedRateInterval !== null && input.nominalAlpha < observedRateInterval.lower,
    candidateRule: {
      allFoldsEvaluable: true,
      aggregateNetProfit: "positive",
      aggregateProfitFactor: "greater_than_one",
      postSelectionOosNetProfit: "empirical_one_sided_p_at_most_nominal_alpha",
    },
    limitations: [
      "This is a ledger-level empirical null. It calibrates candidate selection after collection, not Pine signal generation, fills, costs, or chart data quality.",
      "Centered trade profit is multiplied by a shared random sign per UTC calendar block. This retains timestamps, trade counts, magnitudes, and contemporaneous candidate shocks, but not every form of serial dependence.",
      "Failed and not-evaluable replications are reported separately and never counted as non-candidates.",
      "The observed empirical p-value compares selected OOS net profit to the full null distribution; null calibration uses leave-one-out p-values.",
      "The rate only calibrates the explicit aggregate OOS rule recorded here; it is not an adoption recommendation.",
    ],
  };
}
