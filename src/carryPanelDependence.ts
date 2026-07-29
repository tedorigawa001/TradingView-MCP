import { estimateCarryPanelEffectiveSample } from "./carryPanelBootstrap.js";

export type CarryPanelPriceBar = { timeIso: string; close: number; forming?: boolean };

const correlation = (left: number[], right: number[]) => {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }
  if (leftSum === 0 || rightSum === 0) throw new Error("pair returns must have non-zero variance");
  return numerator / Math.sqrt(leftSum * rightSum);
};

export function measureCarryPanelDependence(input: {
  series: Array<{ pair_id: string; return_sign: 1 | -1; return_sign_by_date?: Record<string, 1 | -1>; bars: CarryPanelPriceBar[] }>;
  horizonBusinessDays: number;
  blockLengthAnchors: number;
  iterations: number;
  seed: string;
}) {
  if (input.series.length < 2 || input.series.length > 28) throw new Error("series must contain 2 to 28 pairs");
  if (new Set(input.series.map((series) => series.pair_id)).size !== input.series.length) throw new Error("pair_id values must be unique");
  if (!Number.isInteger(input.horizonBusinessDays) || input.horizonBusinessDays < 1 || input.horizonBusinessDays > 260) throw new Error("horizon_business_days must be an integer from 1 to 260");

  const datesByPair = input.series.map((series) => {
    const dates = new Map<string, number>();
    for (const bar of series.bars) {
      if (bar.forming === true) continue;
      const date = bar.timeIso.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) throw new Error("bars must use canonical ISO timestamps");
      if (!Number.isFinite(bar.close) || bar.close <= 0) throw new Error("bar close must be finite and positive");
      if (dates.has(date)) throw new Error(`series ${series.pair_id} has duplicate daily dates`);
      dates.set(date, bar.close);
    }
    return dates;
  });
  const commonDates = [...datesByPair[0].keys()].filter((date) => datesByPair.every((dates) => dates.has(date))).sort();
  const eligible = commonDates.filter((_, index) => index + input.horizonBusinessDays < commonDates.length);
  const anchorCandidates = eligible.filter((_, index) => index % input.horizonBusinessDays === 0);
  const anchors = anchorCandidates.filter((date) => input.series.every((series) => series.return_sign_by_date === undefined || series.return_sign_by_date[date] !== undefined));
  if (anchors.length < 6) throw new Error("common price history must produce at least 6 non-overlapping anchors");

  const returnsByPair = input.series.map((series, seriesIndex) => anchors.map((date) => {
    const start = datesByPair[seriesIndex].get(date)!;
    const end = datesByPair[seriesIndex].get(commonDates[commonDates.indexOf(date) + input.horizonBusinessDays])!;
    return (series.return_sign_by_date?.[date] ?? series.return_sign) * (end / start - 1);
  }));
  const observations = anchors.flatMap((anchor_date, anchorIndex) => input.series.map((series, seriesIndex) => ({
    anchor_date,
    pair_id: series.pair_id,
    carry_return: returnsByPair[seriesIndex][anchorIndex],
  })));
  const pairwise = [] as Array<{ left_pair_id: string; right_pair_id: string; correlation: number }>;
  for (let left = 0; left < input.series.length; left += 1) for (let right = left + 1; right < input.series.length; right += 1) {
    pairwise.push({ left_pair_id: input.series[left].pair_id, right_pair_id: input.series[right].pair_id, correlation: correlation(returnsByPair[left], returnsByPair[right]) });
  }
  const averagePairwiseCorrelation = pairwise.reduce((sum, item) => sum + item.correlation, 0) / pairwise.length;
  const rawCrossSectionalDesignEffect = 1 + (input.series.length - 1) * averagePairwiseCorrelation;
  const bootstrap = estimateCarryPanelEffectiveSample({ observations, blockLengthAnchors: input.blockLengthAnchors, iterations: input.iterations, seed: input.seed });
  return {
    schema_version: "1.0",
    methodology: "exact_date_aligned_non_overlapping_returns_then_anchor_cluster_block_bootstrap",
    interpretation: "This measures dependence in a fixed price panel before a carry study. It does not supply policy-rate history, point-in-time carry evidence, or a trading decision.",
    common_price_dates: commonDates.length,
    first_common_date: commonDates[0],
    last_common_date: commonDates.at(-1),
    horizon_business_days: input.horizonBusinessDays,
    non_overlapping_anchors: anchors.length,
    anchors_excluded_for_missing_dynamic_sign: anchorCandidates.length - anchors.length,
    pairwise_correlations: pairwise,
    average_pairwise_correlation: averagePairwiseCorrelation,
    raw_cross_sectional_design_effect: rawCrossSectionalDesignEffect,
    cross_sectional_design_effect: Math.max(1, rawCrossSectionalDesignEffect),
    bootstrap,
  };
}
