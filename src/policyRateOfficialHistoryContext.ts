import { POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER, type OfficialPolicyRateHistoryRecord } from "./policyRateOfficialHistory.js";
import type { PolicyRateCurrency } from "./policyRateHistory.js";

export type OfficialPolicyRateHistoryProvider = Pick<import("./policyRateOfficialHistory.js").OfficialPolicyRateHistoryStore, "getLatest">;

export async function getOfficialPolicyRateHistoryContext(input: {
  provider: OfficialPolicyRateHistoryProvider;
  currencies: PolicyRateCurrency[];
  sourceCoverage?: unknown;
}) {
  const unique = [...new Set(input.currencies)];
  if (unique.length < 1 || unique.length > 8) throw new Error("official policy-rate context requires 1 to 8 currencies");
  const rows = await Promise.all(unique.map(async (currency) => ({ currency, record: await input.provider.getLatest(currency) })));
  const rates = rows.map(({ currency, record }) => record === null ? unavailable(currency) : available(record));
  return {
    schema_version: "1.0",
    evidence_tier: POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER,
    eligibility: "exploratory_only" as const,
    point_in_time_status: "not_available" as const,
    status: rates.every((rate) => rate.status === "available") ? "complete" as const : "partial" as const,
    rates,
    source_coverage: input.sourceCoverage ?? null,
    quality_issues: ["revised_history_must_not_be_used_for_prospective_or_oos_evidence"],
  };
}

function unavailable(currency: PolicyRateCurrency) {
  return {
    currency, status: "unavailable" as const, observation_date: null, value: null, source_symbol: null,
    source_url: null, source_vintage_at: null, raw_sha256: null, retrieved_at: null, history_sequence: null,
    quality_issues: ["no_official_revised_history_loaded"],
  };
}

function available(record: OfficialPolicyRateHistoryRecord) {
  if (record.value === null) {
    return {
      currency: record.currency, status: "unavailable" as const, observation_date: record.observation_date, value: null,
      source_symbol: record.source_symbol, source_url: record.source_url, source_vintage_at: record.source_vintage_at, raw_sha256: record.raw_sha256,
      retrieved_at: record.retrieved_at, history_sequence: record.sequence,
      quality_issues: ["official_policy_framework_has_no_single_rate_target", "revised_history_not_point_in_time"],
    };
  }
  return {
    currency: record.currency, status: "available" as const, observation_date: record.observation_date, value: record.value,
    source_symbol: record.source_symbol, source_url: record.source_url, source_vintage_at: record.source_vintage_at, raw_sha256: record.raw_sha256,
    retrieved_at: record.retrieved_at, history_sequence: record.sequence,
    quality_issues: ["revised_history_not_point_in_time"],
  };
}
