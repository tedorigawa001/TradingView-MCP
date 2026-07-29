import type { OfficialPolicyRateHistoryRecord } from "./policyRateOfficialHistory.js";
import type { PolicyRateCurrency } from "./policyRateHistory.js";

export type ExploratoryCarryPair = { pair_id: string; base_currency: PolicyRateCurrency; quote_currency: PolicyRateCurrency };

/**
 * Reconstruct carry direction from revised official history. This deliberately
 * has no availability-time claim and must stay outside prospective/OOS paths.
 */
export function buildExploratoryCarrySigns(input: {
  pairs: ExploratoryCarryPair[];
  dates: string[];
  histories: Record<PolicyRateCurrency, OfficialPolicyRateHistoryRecord[]>;
}) {
  const normalizedHistories = Object.fromEntries(Object.entries(input.histories).map(([currency, records]) => {
    const latestByDate = new Map<string, OfficialPolicyRateHistoryRecord>();
    for (const record of records) {
      const current = latestByDate.get(record.observation_date);
      if (current === undefined || record.sequence > current.sequence) latestByDate.set(record.observation_date, record);
    }
    return [currency, [...latestByDate.values()].sort((left, right) => left.observation_date.localeCompare(right.observation_date))];
  })) as Record<PolicyRateCurrency, OfficialPolicyRateHistoryRecord[]>;
  const latestAt = (currency: PolicyRateCurrency, date: string) => {
    const rows = normalizedHistories[currency] ?? [];
    let latest: OfficialPolicyRateHistoryRecord | null = null;
    for (const row of rows) {
      if (row.observation_date > date) break;
      latest = row;
    }
    return latest;
  };
  const signs: Record<string, Record<string, 1 | -1>> = {};
  const unavailable: Record<string, number> = {};
  for (const pair of input.pairs) {
    const byDate: Record<string, 1 | -1> = {};
    let skipped = 0;
    for (const date of input.dates) {
      const base = latestAt(pair.base_currency, date);
      const quote = latestAt(pair.quote_currency, date);
      if (base?.value === null || quote?.value === null || base === null || quote === null || base.value === quote.value) { skipped += 1; continue; }
      byDate[date] = base.value > quote.value ? 1 : -1;
    }
    signs[pair.pair_id] = byDate;
    unavailable[pair.pair_id] = skipped;
  }
  return {
    evidence_tier: "exploratory_revised_history" as const,
    point_in_time_status: "not_available" as const,
    signs,
    unavailable_dates_by_pair: unavailable,
  };
}
