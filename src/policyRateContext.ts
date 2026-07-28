import type { PolicyRateCurrency, PolicyRateFirstSeenRecord } from "./policyRateHistory.js";

export type PolicyRateAsOfProvider = Pick<import("./policyRateHistory.js").PolicyRateFirstSeenStore, "getAsOf">;

export async function getPolicyRateContext(input: {
  provider: PolicyRateAsOfProvider;
  currencies: PolicyRateCurrency[];
  asOf: Date;
  now?: Date;
}) {
  if (!Number.isFinite(input.asOf.getTime())) throw new Error("as_of must be a valid timestamp");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || input.asOf > now) throw new Error("as_of must not be in the future");
  const unique = [...new Set(input.currencies)];
  if (unique.length < 1 || unique.length > 8) throw new Error("policy-rate context requires 1 to 8 currencies");
  const rows = await Promise.all(unique.map(async (currency) => ({ currency, record: await input.provider.getAsOf(currency, input.asOf) })));
  const rates = rows.map(({ currency, record }) => record === null ? {
    currency, status: "unavailable" as const, observation_date: null, value: null, source_symbol: null,
    source_observed_at: null, available_at: null, first_seen_at: null, history_sequence: null,
    quality_issues: ["no_first_seen_policy_rate_as_of"],
  } : toContextRate(currency, record));
  return {
    schema_version: "1.0",
    as_of: input.asOf.toISOString(),
    status: rates.every((rate) => rate.status === "available") ? "complete" as const : "partial" as const,
    rates,
    quality_issues: rates.some((rate) => rate.status !== "available") ? ["one_or_more_policy_rates_unavailable_as_of"] : [],
  };
}

function toContextRate(currency: PolicyRateCurrency, record: PolicyRateFirstSeenRecord) {
  return {
    currency, status: "available" as const, observation_date: record.observation_date, value: record.value,
    source_symbol: record.source_symbol, source_observed_at: record.source_observed_at,
    available_at: record.available_at, first_seen_at: record.first_seen_at, history_sequence: record.sequence,
    quality_issues: [],
  };
}
