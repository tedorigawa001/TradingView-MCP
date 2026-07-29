import { CARRY_CORE_PRIMARY_PAIRS, CARRY_CORE_PRIMARY_TEST_V1 } from "./carryPanelPrimaryTest.js";
import type { PolicyRateCurrency, PolicyRateFirstSeenRecord } from "./policyRateHistory.js";

const addBusinessDays = (from: string, days: number) => {
  const date = new Date(`${from}T00:00:00.000Z`);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
};

export function getCarryCorePrimaryReadiness(input: {
  asOf: string;
  policyRateVersions: Partial<Record<PolicyRateCurrency, PolicyRateFirstSeenRecord[]>>;
}) {
  const asOf = new Date(input.asOf);
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== input.asOf) throw new Error("as_of must be a canonical ISO timestamp");
  const currencies = [...new Set(CARRY_CORE_PRIMARY_PAIRS.flatMap((pair) => [pair.base_currency, pair.quote_currency]))] as PolicyRateCurrency[];
  const perCurrency = currencies.map((currency) => {
    const records = (input.policyRateVersions[currency] ?? []).filter((record) => record.first_seen_at <= input.asOf && record.available_at <= input.asOf);
    const firstUsable = records.map((record) => [record.available_at.slice(0, 10), record.first_seen_at.slice(0, 10)].sort().at(-1)!).sort()[0] ?? null;
    return { currency, observed_versions: records.length, first_usable_date: firstUsable };
  });
  const missingCurrencies = perCurrency.filter((item) => item.first_usable_date === null).map((item) => item.currency);
  const commonAvailableFrom = missingCurrencies.length === 0
    ? [...perCurrency.map((item) => item.first_usable_date!), CARRY_CORE_PRIMARY_TEST_V1.sample_start].sort().at(-1)!
    : null;
  const requiredBusinessDays = CARRY_CORE_PRIMARY_TEST_V1.horizon_business_days * CARRY_CORE_PRIMARY_TEST_V1.minimum_anchor_clusters;
  const estimatedEarliestCompleteDate = commonAvailableFrom === null ? null : addBusinessDays(commonAvailableFrom, requiredBusinessDays);
  const asOfDate = asOf.toISOString().slice(0, 10);
  return {
    schema_version: "1.0" as const,
    contract: CARRY_CORE_PRIMARY_TEST_V1,
    status: commonAvailableFrom === null ? "blocked" as const : asOfDate >= estimatedEarliestCompleteDate! ? "ready_for_price_preflight" as const : "collecting" as const,
    as_of: input.asOf,
    currencies: perCurrency,
    missing_currencies: missingCurrencies,
    common_first_usable_date: commonAvailableFrom,
    required_business_days_after_common_start: requiredBusinessDays,
    estimated_earliest_complete_window_date: estimatedEarliestCompleteDate,
    collection_continuity_status: "not_proven_from_change_only_policy_rate_versions" as const,
    interpretation: "This is an earliest calendar-date estimate under uninterrupted common daily-price coverage and no zero policy-rate differentials. It is not price coverage, does not prove uninterrupted collection on unchanged-rate days, excludes neither market holidays nor future zero-differential anchors, and never makes the primary test evaluable by itself.",
  };
}
