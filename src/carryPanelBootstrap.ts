import { createHash } from "node:crypto";

export type CarryPanelBootstrapObservation = {
  anchor_date: string;
  pair_id: string;
  carry_return: number;
};

const calendarDate = (value: string, label: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a calendar date`);
  }
  return value;
};

const seededRandom = (seed: string): (() => number) => {
  let state = createHash("sha256").update(seed, "utf8").digest().readUInt32LE(0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleVariance = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
};

const quantile = (values: number[], probability: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

export function estimateCarryPanelEffectiveSample(input: {
  observations: CarryPanelBootstrapObservation[];
  blockLengthAnchors: number;
  iterations: number;
  seed: string;
}) {
  if (!Number.isInteger(input.blockLengthAnchors) || input.blockLengthAnchors < 1 || input.blockLengthAnchors > 52) {
    throw new Error("block_length_anchors must be an integer from 1 to 52");
  }
  if (!Number.isInteger(input.iterations) || input.iterations < 100 || input.iterations > 10_000) {
    throw new Error("iterations must be an integer from 100 to 10000");
  }
  if (input.seed.length < 1 || input.seed.length > 128) throw new Error("seed must contain 1 to 128 characters");
  if (input.observations.length < 12 || input.observations.length > 10_000) throw new Error("observations must contain 12 to 10000 entries");

  const byAnchor = new Map<string, CarryPanelBootstrapObservation[]>();
  const seen = new Set<string>();
  for (const observation of input.observations) {
    const anchorDate = calendarDate(observation.anchor_date, "anchor_date");
    if (!/^[A-Z0-9:_./-]{3,48}$/.test(observation.pair_id)) throw new Error("pair_id has invalid characters");
    if (!Number.isFinite(observation.carry_return)) throw new Error("carry_return must be finite");
    const key = `${anchorDate}\u0000${observation.pair_id}`;
    if (seen.has(key)) throw new Error("observations must be unique per anchor_date and pair_id");
    seen.add(key);
    const rows = byAnchor.get(anchorDate) ?? [];
    rows.push(observation);
    byAnchor.set(anchorDate, rows);
  }
  const anchors = [...byAnchor.keys()].sort();
  if (anchors.length < 6) throw new Error("observations must span at least 6 anchor dates");
  const pairIds = [...new Set(input.observations.map((observation) => observation.pair_id))].sort();
  if (pairIds.length < 2 || pairIds.length > 28) throw new Error("observations must contain 2 to 28 pair_id values");

  const clusteredValues = anchors.map((anchor) => byAnchor.get(anchor)!.map((observation) => observation.carry_return));
  const values = clusteredValues.flat();
  const iidVarianceOfMean = sampleVariance(values) / values.length;
  if (!Number.isFinite(iidVarianceOfMean) || iidVarianceOfMean <= 0) throw new Error("carry_return values must have non-zero variance");

  const random = seededRandom(input.seed);
  const bootstrapMeans: number[] = [];
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    const sampled: number[] = [];
    while (sampled.length === 0 || sampled.length < values.length) {
      const start = Math.floor(random() * anchors.length);
      for (let offset = 0; offset < input.blockLengthAnchors; offset += 1) {
        sampled.push(...clusteredValues[(start + offset) % anchors.length]);
      }
    }
    bootstrapMeans.push(mean(sampled));
  }
  const bootstrapVarianceOfMean = sampleVariance(bootstrapMeans);
  const rawDesignEffect = bootstrapVarianceOfMean / iidVarianceOfMean;
  const designEffect = Math.max(1, rawDesignEffect);
  const effectiveObservations = Math.min(values.length, values.length / designEffect);
  const pairsPerAnchor = clusteredValues.map((rows) => rows.length);
  const qualityIssues = [
    ...(rawDesignEffect < 1 ? ["bootstrap_variance_below_iid_variance_capped_at_nominal_sample"] : []),
    ...(new Set(pairsPerAnchor).size > 1 ? ["unbalanced_pair_coverage_across_anchor_dates"] : []),
  ];

  return {
    schema_version: "1.0",
    methodology: "circular_moving_block_bootstrap_of_anchor_date_clusters",
    interpretation: "effective_observations is a conservative precision-equivalent count for the supplied grand-mean carry return, not an independent observation count or an adoption rule",
    nominal_observations: values.length,
    anchor_clusters: anchors.length,
    pair_count: pairIds.length,
    pair_ids: pairIds,
    // Reduced rather than spread: this array grows with the anchor count, and a spread of that
    // size overflows the call stack.
    pairs_per_anchor: pairsPerAnchor.reduce(
      (range, count) => ({ minimum: Math.min(range.minimum, count), maximum: Math.max(range.maximum, count) }),
      { minimum: Infinity, maximum: -Infinity },
    ),
    block_length_anchors: input.blockLengthAnchors,
    seed: input.seed,
    iterations: input.iterations,
    observed_mean: mean(values),
    iid_standard_error: Math.sqrt(iidVarianceOfMean),
    bootstrap_standard_error: Math.sqrt(bootstrapVarianceOfMean),
    bootstrap_mean_interval_95: { lower: quantile(bootstrapMeans, 0.025), upper: quantile(bootstrapMeans, 0.975) },
    raw_design_effect: rawDesignEffect,
    design_effect: designEffect,
    effective_observations: effectiveObservations,
    quality_issues: qualityIssues,
  };
}
