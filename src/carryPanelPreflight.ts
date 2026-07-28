import type { PolicyRateCurrency } from "./policyRateHistory.js";
import type { DirectionalRegime, VolatilityRegime } from "./marketRegimes.js";

export type CarryPanelPair = { pair_id: string; base_currency: PolicyRateCurrency; quote_currency: PolicyRateCurrency };

type ContextRate = { currency: PolicyRateCurrency; status: "available" | "unavailable"; value: number | null; available_at: string | null; first_seen_at: string | null };
export type CarryPriceEvidence = { pair_id: string; symbol: string; timeframe: string; closed_bars: number; classified_bars: number; from: string | null; to: string | null; regime_dates: Array<{ date: string; directional: DirectionalRegime; volatility: VolatilityRegime }> };

const calendarDate = (value: string, label: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a calendar date`);
  return value;
};

const later = (...values: string[]) => values.sort().at(-1)!;

function businessDaysBetweenInclusive(from: string, to: string): string[] {
  const result: string[] = [];
  for (const date = new Date(`${from}T00:00:00.000Z`); date.toISOString().slice(0, 10) <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) result.push(date.toISOString().slice(0, 10));
  }
  return result;
}

export function carryPanelPreflight(input: {
  asOf: string;
  rates: ContextRate[];
  pairs: CarryPanelPair[];
  from: string;
  to: string;
  horizonBusinessDays: number;
  oosFrom: string | null;
  minimumObservations: number;
  priceEvidence?: CarryPriceEvidence[];
  regime?: { directional: DirectionalRegime; volatility: VolatilityRegime | null };
}) {
  const from = calendarDate(input.from, "from");
  const to = calendarDate(input.to, "to");
  if (from >= to) throw new Error("from must be before to");
  if (!Number.isInteger(input.horizonBusinessDays) || input.horizonBusinessDays < 1 || input.horizonBusinessDays > 260) throw new Error("horizon_business_days must be 1 to 260");
  if (!Number.isInteger(input.minimumObservations) || input.minimumObservations < 1 || input.minimumObservations > 10_000) throw new Error("minimum_observations must be 1 to 10000");
  if (input.pairs.length < 1 || input.pairs.length > 28) throw new Error("pairs must contain 1 to 28 entries");
  if (new Set(input.pairs.map((pair) => pair.pair_id)).size !== input.pairs.length) throw new Error("pair_id values must be unique");
  const rateByCurrency = new Map(input.rates.map((rate) => [rate.currency, rate]));
  const priceByPair = new Map((input.priceEvidence ?? []).map((item) => [item.pair_id, item]));
  const oosFrom = input.oosFrom === null ? null : calendarDate(input.oosFrom, "oos_from");
  if (oosFrom !== null && (oosFrom <= from || oosFrom >= to)) throw new Error("oos_from must lie within from and to");

  const pairs = input.pairs.map((pair) => {
    if (pair.base_currency === pair.quote_currency) throw new Error(`pair ${pair.pair_id} must use two currencies`);
    const base = rateByCurrency.get(pair.base_currency);
    const quote = rateByCurrency.get(pair.quote_currency);
    if (!base || !quote || base.status !== "available" || quote.status !== "available" || base.value === null || quote.value === null || base.available_at === null || quote.available_at === null || base.first_seen_at === null || quote.first_seen_at === null) {
      return { ...pair, status: "blocked" as const, carry_rate_difference: null, data_available_from: null, non_overlapping_anchors: 0, oos_anchors: 0, quality_issues: ["policy_rate_pair_unavailable_as_of"] };
    }
    const dataAvailableFrom = later(base.available_at.slice(0, 10), quote.available_at.slice(0, 10), base.first_seen_at.slice(0, 10), quote.first_seen_at.slice(0, 10));
    const dates = businessDaysBetweenInclusive(later(from, dataAvailableFrom), to);
    const eligible = dates.filter((_, index) => index + input.horizonBusinessDays < dates.length);
    const anchors = eligible.filter((_, index) => index % input.horizonBusinessDays === 0);
    const oosAnchors = oosFrom === null ? 0 : anchors.filter((date) => date >= oosFrom).length;
    const evidence = priceByPair.get(pair.pair_id);
    if (input.priceEvidence !== undefined && evidence === undefined) {
      return { ...pair, status: "blocked" as const, carry_rate_difference: base.value - quote.value, data_available_from: dataAvailableFrom, non_overlapping_anchors: anchors.length, oos_anchors: oosAnchors, price_coverage: null, quality_issues: ["price_evidence_missing_for_pair"] };
    }
    const labels = new Map((evidence?.regime_dates ?? []).map((item) => [item.date, item]));
    const priceMatched = evidence === undefined ? anchors.length : anchors.filter((date) => labels.has(date)).length;
    const regimeMatched = evidence === undefined ? anchors.length : anchors.filter((date) => {
      const label = labels.get(date);
      return label !== undefined && (input.regime === undefined || (label.directional === input.regime.directional && (input.regime.volatility === null || label.volatility === input.regime.volatility)));
    }).length;
    const availableAnchors = evidence === undefined ? anchors.length : regimeMatched;
    const qualityIssues = [
      ...(evidence !== undefined && priceMatched < anchors.length ? ["one_or_more_policy_anchors_missing_price_or_regime"] : []),
      ...(availableAnchors < input.minimumObservations ? ["minimum_observations_not_met", "insufficient_first_seen_history"] : []),
    ];
    return { ...pair, status: availableAnchors >= input.minimumObservations ? "ready" as const : "not_evaluable" as const, carry_rate_difference: base.value - quote.value, data_available_from: dataAvailableFrom, non_overlapping_anchors: anchors.length, oos_anchors: evidence === undefined ? oosAnchors : (oosFrom === null ? 0 : anchors.filter((date) => date >= oosFrom && labels.has(date)).length),
      price_coverage: evidence === undefined ? null : { symbol: evidence.symbol, timeframe: evidence.timeframe, closed_bars: evidence.closed_bars, classified_bars: evidence.classified_bars, price_matched_anchors: priceMatched, fixed_regime_anchors: regimeMatched }, quality_issues: qualityIssues };
  });
  const status = pairs.every((pair) => pair.status === "ready") ? "ready" as const : "not_evaluable" as const;
  return { schema_version: "1.0", as_of: input.asOf, status, from, to, horizon_business_days: input.horizonBusinessDays, oos_from: oosFrom, minimum_observations: input.minimumObservations, pairs, quality_issues: status === "ready" ? [] : ["carry_panel_not_evaluable"] };
}
