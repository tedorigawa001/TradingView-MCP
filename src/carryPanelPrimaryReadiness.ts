import { CARRY_CORE_PRIMARY_PAIRS, CARRY_CORE_PRIMARY_TEST_V1 } from "./carryPanelPrimaryTest.js";
import type { PolicyRateCurrency, PolicyRateFirstSeenRecord } from "./policyRateHistory.js";
import { addBusinessDays, businessDaysSince, firstBusinessDayGridDateOnOrAfter } from "./businessDays.js";

export function getCarryCorePrimaryReadiness(input: {
  asOf: string;
  policyRateVersions: Partial<Record<PolicyRateCurrency, PolicyRateFirstSeenRecord[]>>;
  collectionHeartbeats: Array<{ first_seen_at: string }>;
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
  const heartbeats = input.collectionHeartbeats
    .map((heartbeat) => {
      const observedAt = new Date(heartbeat.first_seen_at);
      if (!Number.isFinite(observedAt.getTime()) || observedAt.toISOString() !== heartbeat.first_seen_at) throw new Error("heartbeat first_seen_at must be a canonical ISO timestamp");
      return heartbeat;
    })
    .filter((heartbeat) => heartbeat.first_seen_at <= input.asOf)
    .sort((left, right) => left.first_seen_at.localeCompare(right.first_seen_at));
  const firstHeartbeatDate = heartbeats[0]?.first_seen_at.slice(0, 10) ?? null;
  const latestHeartbeatDate = heartbeats.at(-1)?.first_seen_at.slice(0, 10) ?? null;
  const evidenceAvailableFrom = commonAvailableFrom === null || firstHeartbeatDate === null
    ? null
    : [commonAvailableFrom, firstHeartbeatDate].sort().at(-1)!;
  const firstEligibleAnchorDate = evidenceAvailableFrom === null
    ? null
    : firstBusinessDayGridDateOnOrAfter(CARRY_CORE_PRIMARY_TEST_V1.sample_start, evidenceAvailableFrom, CARRY_CORE_PRIMARY_TEST_V1.horizon_business_days);
  const requiredBusinessDays = CARRY_CORE_PRIMARY_TEST_V1.horizon_business_days * CARRY_CORE_PRIMARY_TEST_V1.minimum_anchor_clusters;
  const asOfDate = asOf.toISOString().slice(0, 10);
  const estimatedEarliestCompleteDate = firstEligibleAnchorDate === null ? null : addBusinessDays(firstEligibleAnchorDate, requiredBusinessDays);
  const latestHeartbeatAge = latestHeartbeatDate === null ? null : businessDaysSince(latestHeartbeatDate, asOfDate);
  const collectionContinuityStatus = latestHeartbeatAge === null
    ? "not_proven_no_collection_heartbeats" as const
    : latestHeartbeatAge > CARRY_CORE_PRIMARY_TEST_V1.max_heartbeat_gap_business_days
      ? "gap_exceeded" as const
      : "collecting_within_gap_limit" as const;
  const ready = estimatedEarliestCompleteDate !== null
    && asOfDate >= estimatedEarliestCompleteDate
    && collectionContinuityStatus === "collecting_within_gap_limit";
  return {
    schema_version: "1.0" as const,
    contract: CARRY_CORE_PRIMARY_TEST_V1,
    status: commonAvailableFrom === null ? "blocked" as const : ready ? "ready_for_price_preflight" as const : "collecting" as const,
    as_of: input.asOf,
    currencies: perCurrency,
    missing_currencies: missingCurrencies,
    common_first_usable_date: commonAvailableFrom,
    first_collection_heartbeat_date: firstHeartbeatDate,
    first_eligible_anchor_date: firstEligibleAnchorDate,
    required_business_days_after_first_eligible_anchor: requiredBusinessDays,
    estimated_earliest_complete_window_date: estimatedEarliestCompleteDate,
    latest_heartbeat_age_business_days: latestHeartbeatAge,
    collection_continuity_status: collectionContinuityStatus,
    interpretation: "This is an earliest calendar-date estimate on the frozen 20-business-day anchor grid, beginning with the first anchor that can use both policy-rate and collection-heartbeat evidence. It assumes uninterrupted future heartbeat and common daily-price coverage and no zero policy-rate differentials. The five-business-day heartbeat rule deliberately permits that much policy-rate staleness; it never makes the primary test evaluable by itself.",
  };
}
