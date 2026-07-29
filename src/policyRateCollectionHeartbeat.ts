import { homedir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";
import { POLICY_RATE_SYMBOLS, type PolicyRateCurrency } from "./policyRateHistory.js";
import { businessDaysSince } from "./businessDays.js";
import { CARRY_CORE_PRIMARY_TEST_V1 } from "./carryPanelPrimaryTest.js";

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 2_048;
const CURRENCIES = ["USD", "EUR", "JPY", "GBP", "AUD", "NZD", "CAD", "CHF"] as const;

export type PolicyRateCollectionHeartbeatRecord = {
  schema_version: "1.0";
  sequence: number;
  series: "policy_rate_collection_heartbeat";
  observation_date: string;
  first_seen_at: string;
  chart_index: number;
  currencies: Array<{ currency: PolicyRateCurrency; source_symbol: string; decision_observation_date: string; bars: number }>;
};

export const resolvePolicyRateCollectionHeartbeatPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_POLICY_RATE_COLLECTION_HEARTBEAT_PATH,
) => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "policy-rate-collection-heartbeats.jsonl");

const validateRecord = (value: unknown, line?: number): PolicyRateCollectionHeartbeatRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid policy-rate collection heartbeat${suffix}`);
  const record = value as Partial<PolicyRateCollectionHeartbeatRecord>;
  if (record.schema_version !== "1.0" || record.series !== "policy_rate_collection_heartbeat") throw new Error(`unsupported policy-rate collection heartbeat schema${suffix}`);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) throw new Error(`invalid policy-rate collection heartbeat sequence${suffix}`);
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) throw new Error(`invalid policy-rate collection heartbeat observation_date${suffix}`);
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) throw new Error(`invalid policy-rate collection heartbeat first_seen_at${suffix}`);
  if (record.observation_date !== record.first_seen_at.slice(0, 10)) throw new Error(`policy-rate collection heartbeat observation_date must equal first_seen date${suffix}`);
  if (!Number.isInteger(record.chart_index) || (record.chart_index ?? -1) < 0) throw new Error(`invalid policy-rate collection heartbeat chart_index${suffix}`);
  if (!Array.isArray(record.currencies) || record.currencies.length !== CURRENCIES.length) throw new Error(`policy-rate collection heartbeat must contain every currency${suffix}`);
  const seen = new Set<PolicyRateCurrency>();
  for (const item of record.currencies) {
    if (!item || typeof item !== "object" || !CURRENCIES.includes(item.currency)) throw new Error(`invalid policy-rate collection heartbeat currency${suffix}`);
    if (seen.has(item.currency)) throw new Error(`duplicate policy-rate collection heartbeat currency${suffix}`);
    seen.add(item.currency);
    if (item.source_symbol !== POLICY_RATE_SYMBOLS[item.currency]) throw new Error(`invalid policy-rate collection heartbeat source_symbol${suffix}`);
    if (!isCalendarDate(item.decision_observation_date)) throw new Error(`invalid policy-rate collection heartbeat decision_observation_date${suffix}`);
    if (!Number.isInteger(item.bars) || item.bars < 1 || item.bars > 5_000) throw new Error(`invalid policy-rate collection heartbeat bars${suffix}`);
  }
  return record as PolicyRateCollectionHeartbeatRecord;
};

export class PolicyRateCollectionHeartbeatStore {
  private readonly log: AppendOnlyFirstSeenLog<PolicyRateCollectionHeartbeatRecord>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "policy-rate collection heartbeat", validateRecord, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  async recordRun(input: Omit<PolicyRateCollectionHeartbeatRecord, "schema_version" | "sequence" | "series" | "observation_date" | "first_seen_at"> & { observed_at: string }) {
    if (!isCanonicalTimestamp(input.observed_at)) throw new Error("policy-rate collection heartbeat observed_at must be a canonical timestamp");
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const record = validateRecord({
        schema_version: "1.0",
        sequence: records.length + 1,
        series: "policy_rate_collection_heartbeat",
        observation_date: input.observed_at.slice(0, 10),
        first_seen_at: input.observed_at,
        chart_index: input.chart_index,
        currencies: input.currencies,
      });
      await this.log.appendUnlocked(record);
      return record;
    });
  }

  async coverage(asOf = new Date()) {
    if (!Number.isFinite(asOf.getTime())) throw new Error("as_of must be a valid timestamp");
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const dates = [...new Set(records.map((record) => record.observation_date))].sort();
      const businessDayAges = dates.slice(1).map((date, index) => businessDaysSince(dates[index], date));
      const latestDate = dates.at(-1) ?? null;
      return {
        records: records.length,
        distinct_observation_dates: dates.length,
        duplicate_run_dates: records.length - dates.length,
        earliest_collected_at: records[0]?.first_seen_at ?? null,
        latest_collected_at: records.at(-1)?.first_seen_at ?? null,
        chart_indexes: [...new Set(records.map((record) => record.chart_index))].sort((left, right) => left - right),
        maximum_business_day_age_between_runs: businessDayAges.length === 0 ? null : Math.max(...businessDayAges),
        intervals_exceeding_primary_max_gap: businessDayAges.filter((age) => age > CARRY_CORE_PRIMARY_TEST_V1.max_heartbeat_gap_business_days).length,
        latest_run_age_business_days: latestDate === null ? null : businessDaysSince(latestDate, asOf.toISOString().slice(0, 10)),
      };
    });
  }

  async getRunsAsOf(asOf: Date): Promise<PolicyRateCollectionHeartbeatRecord[]> {
    if (!Number.isFinite(asOf.getTime())) throw new Error("as_of must be a valid timestamp");
    const cutoff = asOf.toISOString();
    return this.log.serialize(async () => (await this.log.readAllUnlocked()).filter((record) => record.first_seen_at <= cutoff));
  }
}
