import {
  DEFAULT_FACTOR_RHO,
  DEFAULT_VOLATILITY,
  MAX_SEED,
  generateFactorNullPair,
  generateIndependentNullPair,
  generateSyntheticNullSeries,
  factorPairMarginalModel,
  type FactorNullPairModel,
  type PairedSyntheticNullModel,
  type SyntheticNullModel,
  type SyntheticNullSeriesInput,
} from "./syntheticNullSeries.js";
import type { OhlcvBar } from "./tradingview.js";

/**
 * Counts how often a study reports a candidate on data that provably contains none.
 *
 * A study is not audited by its interval alone. What matters is the whole path a result travels
 * before anyone acts on it: the search over branches and horizons, the fold split, the regime join,
 * the interval, and the sign-stability rule this project uses to decide. So the caller supplies the
 * same decision rule it would apply to real evidence, and the audit reports how often that rule
 * fires against nothing. The gap between that rate and the nominal alpha is the calibration.
 */
export interface FalsificationAuditInput<TResult> {
  /** Independent draws. Each uses its own seed, so replications never share a series. */
  replications: number;
  firstSeed?: number;
  bars: number;
  timeframeMinutes: number;
  volatility?: number;
  /** The rate the decision rule is supposed to fire at when nothing is there. */
  nominalAlpha: number;
  runStudy: (bars: OhlcvBar[]) => TResult;
  /** The project decision rule, applied exactly as it would be to real evidence. */
  isCandidate: (result: TResult) => boolean;
  /** Use when a valid synthetic draw cannot evaluate the frozen rule (for example, too few events). */
  evaluate?: (result: TResult) => "candidate" | "non_candidate" | "not_evaluable";
}

export interface FalsificationAuditResult {
  model: PairedSyntheticNullModel;
  replications: number;
  firstSeed: number;
  bars: number;
  timeframeMinutes: number;
  /** Effective values, never the caller shorthand, so the run can be repeated from this record alone. */
  volatility: number;
  rho?: number;
  pairStructure?: {
    marginalModel: SyntheticNullModel;
    crossSeriesDependence: "independent" | "contemporaneous_factor";
    volatilityStateDependence: "not_applicable_constant" | "independent" | "shared";
  };
  /** A failed replication can bias the surviving subset, so it cannot support a calibration conclusion. */
  status: "complete" | "incomplete";
  completed: number;
  /** Replicas that generated successfully and supplied enough evidence to evaluate the decision rule. */
  evaluated: number;
  /** Valid synthetic draws excluded from the rate denominator because the frozen rule was not evaluable. */
  notEvaluableSeeds: number[];
  failed: Array<{ seed: number; error: string }>;
  candidates: number;
  candidateSeeds: number[];
  observedRate: number | null;
  nominalAlpha: number;
  /** Wilson interval on the observed rate. Normal approximation breaks down near a rate of zero. */
  observedRateInterval: { lower: number; upper: number } | null;
  /** True only when the nominal rate sits outside the interval, so noise alone does not explain it. */
  exceedsNominalAlpha: boolean;
  limitations: string[];
}

const MAX_REPLICATIONS = 2_000;

/** Wilson score interval at 95 percent. Chosen because an observed rate here is often zero or near it. */
function wilsonInterval(successes: number, observations: number): { lower: number; upper: number } {
  const z = 1.959963984540054;
  const rate = successes / observations;
  const denominator = 1 + (z * z) / observations;
  const centre = rate + (z * z) / (2 * observations);
  const spread = z * Math.sqrt((rate * (1 - rate)) / observations + (z * z) / (4 * observations * observations));
  return {
    // The interval is exactly [0, u] with no successes and [l, 1] with nothing but successes. The
    // general formula leaves a rounding residue near 1e-18 there, and a lower bound of 1.7e-18 reads
    // as a real number rather than as the zero it is.
    lower: successes === 0 ? 0 : Math.max(0, (centre - spread) / denominator),
    upper: successes === observations ? 1 : Math.min(1, (centre + spread) / denominator),
  };
}

function validate(input: { replications: number; nominalAlpha: number; firstSeed?: number; volatility?: number }) {
  if (!Number.isInteger(input.replications) || input.replications < 1 || input.replications > MAX_REPLICATIONS) {
    throw new Error(`falsification audit replications must be an integer from 1 to ${MAX_REPLICATIONS}`);
  }
  if (!Number.isFinite(input.nominalAlpha) || input.nominalAlpha <= 0 || input.nominalAlpha >= 1) {
    throw new Error("falsification audit nominal alpha must be between zero and one");
  }
  const firstSeed = input.firstSeed ?? 1;
  if (!Number.isInteger(firstSeed) || firstSeed < 0) throw new Error("falsification audit first seed must be a non-negative integer");
  // Past the generator seed space every further replication throws, and the rate would then be
  // reported over however many happened to fit. Refusing up front keeps the requested number of
  // independent draws a guarantee rather than a hope.
  if (firstSeed + input.replications - 1 > MAX_SEED) {
    throw new Error(`falsification audit seeds must stay within 0 to ${MAX_SEED}: ${firstSeed} plus ${input.replications} replications overflows`);
  }
  const volatility = input.volatility ?? DEFAULT_VOLATILITY;
  if (!Number.isFinite(volatility) || volatility <= 0 || volatility > 0.5) {
    throw new Error("falsification audit volatility must be greater than zero and at most 0.5");
  }
  return { firstSeed, volatility };
}

function validateRho(value: number): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error("falsification audit rho must be between -1 and 1");
  }
  return value;
}

function summarize(
  model: FalsificationAuditResult["model"],
  input: { replications: number; bars: number; timeframeMinutes: number; nominalAlpha: number },
  generation: { firstSeed: number; volatility: number; rho?: number },
  candidateSeeds: number[],
  notEvaluableSeeds: number[],
  failed: Array<{ seed: number; error: string }>,
): FalsificationAuditResult {
  const { firstSeed, volatility, rho } = generation;
  const factorModel = model.startsWith("factor_");
  const marginalModel = factorModel ? factorPairMarginalModel(model as FactorNullPairModel) : model as SyntheticNullModel;
  const pairStructure = model === "factor_null_pair" || model === "factor_regime_switching_volatility_pair" ||
      model === "factor_bid_ask_bounce_pair"
    ? {
        marginalModel,
        crossSeriesDependence: "contemporaneous_factor" as const,
        volatilityStateDependence: marginalModel === "regime_switching_volatility"
          ? "shared" as const : "not_applicable_constant" as const,
      }
    : undefined;
  const completed = input.replications - failed.length;
  const status = failed.length === 0 ? "complete" as const : "incomplete" as const;
  const evaluated = completed - notEvaluableSeeds.length;
  const observedRate = evaluated === 0 ? null : candidateSeeds.length / evaluated;
  const observedRateInterval = evaluated === 0 ? null : wilsonInterval(candidateSeeds.length, evaluated);
  return {
    model,
    replications: input.replications,
    firstSeed,
    bars: input.bars,
    timeframeMinutes: input.timeframeMinutes,
    volatility,
    ...(rho === undefined ? {} : { rho }),
    ...(pairStructure === undefined ? {} : { pairStructure }),
    status,
    completed,
    evaluated,
    notEvaluableSeeds,
    failed,
    candidates: candidateSeeds.length,
    candidateSeeds,
    observedRate,
    nominalAlpha: input.nominalAlpha,
    observedRateInterval,
    // A study failure can depend on the same path that would make a candidate likely. Its surviving
    // subset is therefore descriptive only; never call it a calibration failure.
    exceedsNominalAlpha: status === "complete" && observedRateInterval !== null && input.nominalAlpha < observedRateInterval.lower,
    limitations: [
      "The rate is measured against these null models only; a structure absent from them cannot be detected here.",
      "It calibrates the decision rule that was supplied, not the study tool in general.",
      "A replication that throws is reported rather than counted as a non-candidate, because a failure is not evidence of absence.",
      "A generated draw that cannot evaluate the frozen rule is excluded from the candidate-rate denominator rather than counted as a rejection.",
    ],
  };
}

/** Audits a study that reads one series. */
export function runFalsificationAudit<TResult>(
  input: FalsificationAuditInput<TResult> & { model: SyntheticNullModel },
): FalsificationAuditResult {
  const { firstSeed, volatility } = validate(input);
  const candidateSeeds: number[] = [];
  const notEvaluableSeeds: number[] = [];
  const failed: Array<{ seed: number; error: string }> = [];
  for (let index = 0; index < input.replications; index += 1) {
    const seed = firstSeed + index;
    try {
      const bars = generateSyntheticNullSeries({
        model: input.model, bars: input.bars, seed,
        timeframeMinutes: input.timeframeMinutes, volatility,
      });
      const result = input.runStudy(bars);
      const evaluation = input.evaluate?.(result) ?? (input.isCandidate(result) ? "candidate" : "non_candidate");
      if (evaluation === "candidate") candidateSeeds.push(seed);
      if (evaluation === "not_evaluable") notEvaluableSeeds.push(seed);
    } catch (error) {
      failed.push({ seed, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return summarize(input.model, input, { firstSeed, volatility }, candidateSeeds, notEvaluableSeeds, failed);
}

/** Audits a study that reads two series, such as a lead/lag scan. */
export function runPairedFalsificationAudit<TResult>(
  input: Omit<FalsificationAuditInput<TResult>, "runStudy"> & {
    model?: PairedSyntheticNullModel;
    rho?: number;
    runStudy: (primary: OhlcvBar[], reference: OhlcvBar[]) => TResult;
  },
): FalsificationAuditResult {
  const { firstSeed, volatility } = validate(input);
  const model = input.model ?? "factor_null_pair";
  const factorModel = model.startsWith("factor_");
  if (!factorModel && input.rho !== undefined) throw new Error("rho is supported only by factor pair models");
  const rho = validateRho(input.rho ?? DEFAULT_FACTOR_RHO);
  const candidateSeeds: number[] = [];
  const notEvaluableSeeds: number[] = [];
  const failed: Array<{ seed: number; error: string }> = [];
  for (let index = 0; index < input.replications; index += 1) {
    const seed = firstSeed + index;
    try {
      const pair = factorModel
        ? generateFactorNullPair({ model: factorPairMarginalModel(model as FactorNullPairModel), bars: input.bars, seed, timeframeMinutes: input.timeframeMinutes, volatility, rho } satisfies Omit<SyntheticNullSeriesInput, "model"> & { model: SyntheticNullModel; rho?: number })
        : generateIndependentNullPair({ model: model as SyntheticNullModel, bars: input.bars, seed, timeframeMinutes: input.timeframeMinutes, volatility });
      const result = input.runStudy(pair.primary, pair.reference);
      const evaluation = input.evaluate?.(result) ?? (input.isCandidate(result) ? "candidate" : "non_candidate");
      if (evaluation === "candidate") candidateSeeds.push(seed);
      if (evaluation === "not_evaluable") notEvaluableSeeds.push(seed);
    } catch (error) {
      failed.push({ seed, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const result = summarize(model, input, { firstSeed, volatility, ...(factorModel ? { rho } : {}) }, candidateSeeds, notEvaluableSeeds, failed);
  if (!factorModel) {
    result.pairStructure = {
      marginalModel: model as SyntheticNullModel,
      crossSeriesDependence: "independent",
      volatilityStateDependence: model === "regime_switching_volatility" ? "independent" : "not_applicable_constant",
    };
  }
  return result;
}
