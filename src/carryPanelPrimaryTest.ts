import { createHash } from "node:crypto";
import type { PolicyRateCurrency, PolicyRateFirstSeenRecord } from "./policyRateHistory.js";

export const CARRY_CORE_PRIMARY_TEST_V1 = {
  id: "carry_core_primary_v1",
  evidence_tier: "prospective_first_seen",
  sample_start: "2026-07-28",
  horizon_business_days: 20,
  minimum_anchor_clusters: 60,
  block_length_anchors: 3,
  bootstrap_iterations: 2_000,
  minimum_annualized_effect: 0.027,
} as const;

export const CARRY_CORE_PRIMARY_PAIRS = [
  { pair_id: "EURUSD", expected_symbol: "OANDA:EURUSD", base_currency: "EUR", quote_currency: "USD" },
  { pair_id: "AUDUSD", expected_symbol: "OANDA:AUDUSD", base_currency: "AUD", quote_currency: "USD" },
  { pair_id: "USDJPY", expected_symbol: "OANDA:USDJPY", base_currency: "USD", quote_currency: "JPY" },
  { pair_id: "USDCAD", expected_symbol: "OANDA:USDCAD", base_currency: "USD", quote_currency: "CAD" },
  { pair_id: "USDCHF", expected_symbol: "OANDA:USDCHF", base_currency: "USD", quote_currency: "CHF" },
] as const satisfies ReadonlyArray<{ pair_id: string; expected_symbol: string; base_currency: PolicyRateCurrency; quote_currency: PolicyRateCurrency }>;

export type CarryPrimaryPriceBar = { timeIso: string; close: number; forming?: boolean };

type CarryPrimaryPair = {
  pair_id: string;
  base_currency: PolicyRateCurrency;
  quote_currency: PolicyRateCurrency;
  bars: CarryPrimaryPriceBar[];
};

type RegressionObservation = {
  anchor_date: string;
  pair_id: string;
  forward_return: number;
  rate_differential: number;
};

const calendarDate = (value: string, label: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a calendar date`);
  }
  return value;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const quantile = (values: number[], probability: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

const seededRandom = (seed: string) => {
  let state = createHash("sha256").update(seed, "utf8").digest().readUInt32LE(0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

function latestRateAt(records: PolicyRateFirstSeenRecord[], date: string): PolicyRateFirstSeenRecord | null {
  const cutoff = `${date}T23:59:59.999Z`;
  return records
    .filter((record) => record.available_at <= cutoff && record.first_seen_at <= cutoff)
    .sort((left, right) => right.observation_date.localeCompare(left.observation_date) || right.first_seen_at.localeCompare(left.first_seen_at) || right.sequence - left.sequence)[0] ?? null;
}

function fitPairFixedEffects(observations: RegressionObservation[]) {
  const byPair = new Map<string, RegressionObservation[]>();
  for (const observation of observations) {
    const rows = byPair.get(observation.pair_id) ?? [];
    rows.push(observation);
    byPair.set(observation.pair_id, rows);
  }
  if (byPair.size < 2 || [...byPair.values()].some((rows) => rows.length < 2)) throw new Error("pair fixed-effects regression requires at least two observations for every pair");

  let numerator = 0;
  let denominator = 0;
  let withinTotal = 0;
  const pairMeans = new Map<string, { x: number; y: number }>();
  for (const [pairId, rows] of byPair) {
    const x = mean(rows.map((row) => row.rate_differential));
    const y = mean(rows.map((row) => row.forward_return));
    pairMeans.set(pairId, { x, y });
    for (const row of rows) {
      const xDeviation = row.rate_differential - x;
      const yDeviation = row.forward_return - y;
      numerator += xDeviation * yDeviation;
      denominator += xDeviation ** 2;
      withinTotal += yDeviation ** 2;
    }
  }
  if (!Number.isFinite(denominator) || denominator <= 0) throw new Error("policy-rate differentials have no within-pair variation");
  const beta = numerator / denominator;
  let residualSum = 0;
  for (const row of observations) {
    const pairMean = pairMeans.get(row.pair_id)!;
    residualSum += (row.forward_return - pairMean.y - beta * (row.rate_differential - pairMean.x)) ** 2;
  }
  const degreesOfFreedom = observations.length - byPair.size - 1;
  if (degreesOfFreedom < 1) throw new Error("pair fixed-effects regression has insufficient degrees of freedom");
  return {
    beta,
    intercept_by_pair: Object.fromEntries([...pairMeans].map(([pairId, values]) => [pairId, values.y - beta * values.x])),
    within_r_squared: withinTotal === 0 ? null : 1 - residualSum / withinTotal,
    residual_standard_error: Math.sqrt(residualSum / degreesOfFreedom),
    degrees_of_freedom: degreesOfFreedom,
  };
}

function bootstrapPairFixedEffects(input: {
  observations: RegressionObservation[];
  blockLengthAnchors: number;
  iterations: number;
  seed: string;
}) {
  const byAnchor = new Map<string, RegressionObservation[]>();
  for (const observation of input.observations) {
    const rows = byAnchor.get(observation.anchor_date) ?? [];
    rows.push(observation);
    byAnchor.set(observation.anchor_date, rows);
  }
  const anchors = [...byAnchor.keys()].sort();
  const random = seededRandom(input.seed);
  const betaSamples: number[] = [];
  let excludedForNoWithinPairRateVariation = 0;
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    const sampled: RegressionObservation[] = [];
    let sampledAnchors = 0;
    while (sampledAnchors < anchors.length) {
      const start = Math.floor(random() * anchors.length);
      for (let offset = 0; offset < input.blockLengthAnchors && sampledAnchors < anchors.length; offset += 1) {
        sampled.push(...byAnchor.get(anchors[(start + offset) % anchors.length])!);
        sampledAnchors += 1;
      }
    }
    try {
      betaSamples.push(fitPairFixedEffects(sampled).beta);
    } catch (error) {
      if (error instanceof Error && error.message === "policy-rate differentials have no within-pair variation") {
        excludedForNoWithinPairRateVariation += 1;
        continue;
      }
      throw error;
    }
  }
  if (betaSamples.length < Math.max(100, Math.ceil(input.iterations * 0.9))) throw new Error("too many bootstrap replications lack within-pair policy-rate variation");
  const bootstrapMean = mean(betaSamples);
  const variance = betaSamples.length < 2 ? 0 : betaSamples.reduce((sum, value) => sum + (value - bootstrapMean) ** 2, 0) / (betaSamples.length - 1);
  return {
    methodology: "circular_moving_block_bootstrap_of_anchor_date_clusters_refitting_pair_fixed_effects",
    block_length_anchors: input.blockLengthAnchors,
    iterations: input.iterations,
    valid_iterations: betaSamples.length,
    replications_excluded_for_no_within_pair_rate_variation: excludedForNoWithinPairRateVariation,
    seed: input.seed,
    standard_error: Math.sqrt(variance),
    interval_95: { lower: quantile(betaSamples, 0.025), upper: quantile(betaSamples, 0.975) },
    positive_share: betaSamples.filter((value) => value > 0).length / betaSamples.length,
  };
}

export function runCarryPanelPrimaryTest(input: {
  pairs: CarryPrimaryPair[];
  policyRateVersions: Partial<Record<PolicyRateCurrency, PolicyRateFirstSeenRecord[]>>;
  from: string;
  to: string;
  horizonBusinessDays?: number;
  minimumAnchorClusters?: number;
  blockLengthAnchors?: number;
  iterations?: number;
  seed: string;
}) {
  const from = calendarDate(input.from, "from");
  const to = calendarDate(input.to, "to");
  if (from >= to) throw new Error("from must be before to");
  const horizonBusinessDays = input.horizonBusinessDays ?? CARRY_CORE_PRIMARY_TEST_V1.horizon_business_days;
  const minimumAnchorClusters = input.minimumAnchorClusters ?? CARRY_CORE_PRIMARY_TEST_V1.minimum_anchor_clusters;
  const blockLengthAnchors = input.blockLengthAnchors ?? CARRY_CORE_PRIMARY_TEST_V1.block_length_anchors;
  const iterations = input.iterations ?? CARRY_CORE_PRIMARY_TEST_V1.bootstrap_iterations;
  if (input.pairs.length < 2 || input.pairs.length > 28 || new Set(input.pairs.map((pair) => pair.pair_id)).size !== input.pairs.length) throw new Error("pairs must contain 2 to 28 unique pair_id values");
  if (!Number.isInteger(horizonBusinessDays) || horizonBusinessDays < 1 || horizonBusinessDays > 260) throw new Error("horizon_business_days must be an integer from 1 to 260");
  if (!Number.isInteger(minimumAnchorClusters) || minimumAnchorClusters < 6 || minimumAnchorClusters > 10_000) throw new Error("minimum_anchor_clusters must be an integer from 6 to 10000");
  if (!Number.isInteger(blockLengthAnchors) || blockLengthAnchors < 1 || blockLengthAnchors > 52) throw new Error("block_length_anchors must be an integer from 1 to 52");
  if (!Number.isInteger(iterations) || iterations < 100 || iterations > 10_000) throw new Error("iterations must be an integer from 100 to 10000");

  const closesByPair = input.pairs.map((pair) => {
    const closes = new Map<string, number>();
    for (const bar of pair.bars) {
      if (bar.forming === true) continue;
      const date = calendarDate(bar.timeIso.slice(0, 10), "bar date");
      if (!Number.isFinite(bar.close) || bar.close <= 0) throw new Error(`pair ${pair.pair_id} close must be finite and positive`);
      if (closes.has(date)) throw new Error(`pair ${pair.pair_id} has duplicate daily dates`);
      closes.set(date, bar.close);
    }
    return closes;
  });
  const commonDates = [...closesByPair[0].keys()].filter((date) => date >= from && date <= to && closesByPair.every((closes) => closes.has(date))).sort();
  const candidates = commonDates.filter((_, index) => index + horizonBusinessDays < commonDates.length).filter((_, index) => index % horizonBusinessDays === 0);
  const observations: RegressionObservation[] = [];
  let unavailablePolicyAnchors = 0;
  for (const anchorDate of candidates) {
    const endDate = commonDates[commonDates.indexOf(anchorDate) + horizonBusinessDays];
    const rows = input.pairs.map((pair, index) => {
      const base = latestRateAt(input.policyRateVersions[pair.base_currency] ?? [], anchorDate);
      const quote = latestRateAt(input.policyRateVersions[pair.quote_currency] ?? [], anchorDate);
      if (base === null || quote === null || base.value === quote.value) return null;
      return { anchor_date: anchorDate, pair_id: pair.pair_id, forward_return: closesByPair[index].get(endDate)! / closesByPair[index].get(anchorDate)! - 1, rate_differential: base.value - quote.value };
    });
    if (rows.some((row) => row === null)) {
      unavailablePolicyAnchors += 1;
      continue;
    }
    observations.push(...rows as RegressionObservation[]);
  }
  const anchorClusters = [...new Set(observations.map((row) => row.anchor_date))].length;
  const base = {
    schema_version: "1.0" as const,
    contract: {
      ...CARRY_CORE_PRIMARY_TEST_V1,
      model: "forward_pair_return = pair_fixed_effect + beta * policy_rate_differential + residual",
      regime_condition: "none; the unconditional fixed-pair panel is the pre-registered baseline",
      policy_rate_timing: "latest first-seen version with available_at and first_seen_at no later than the anchor-date close",
    },
    status: anchorClusters >= minimumAnchorClusters ? "complete" as const : "not_evaluable" as const,
    from,
    to,
    common_price_dates: commonDates.length,
    candidate_anchor_clusters: candidates.length,
    anchor_clusters: anchorClusters,
    observations: observations.length,
    anchors_excluded_for_unavailable_or_zero_policy_difference: unavailablePolicyAnchors,
    pair_ids: input.pairs.map((pair) => pair.pair_id),
    evidence_tier: "prospective_first_seen" as const,
    point_in_time_status: "available" as const,
  };
  if (anchorClusters < minimumAnchorClusters) return { ...base, model: null, bootstrap: null, quality_issues: ["minimum_anchor_clusters_not_met", "insufficient_first_seen_history"] };
  const fit = fitPairFixedEffects(observations);
  const bootstrap = bootstrapPairFixedEffects({ observations, blockLengthAnchors, iterations, seed: input.seed });
  const annualization = 252 / horizonBusinessDays;
  return {
    ...base,
    model: {
      ...fit,
      beta_annualized_per_one_percentage_point: fit.beta * annualization,
      minimum_annualized_effect: CARRY_CORE_PRIMARY_TEST_V1.minimum_annualized_effect,
      exceeds_minimum_effect: Math.abs(fit.beta * annualization) >= CARRY_CORE_PRIMARY_TEST_V1.minimum_annualized_effect,
    },
    bootstrap: {
      ...bootstrap,
      annualized_interval_95_per_one_percentage_point: { lower: bootstrap.interval_95.lower * annualization, upper: bootstrap.interval_95.upper * annualization },
    },
    quality_issues: [],
  };
}
