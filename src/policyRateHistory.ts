import { homedir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 2_048;
const CURRENCIES = ["USD", "EUR", "JPY", "GBP", "AUD", "NZD", "CAD", "CHF"] as const;

export type PolicyRateCurrency = typeof CURRENCIES[number];

export const POLICY_RATE_SYMBOLS: Record<PolicyRateCurrency, string> = {
  USD: "ECONOMICS:USINTR", EUR: "ECONOMICS:EUINTR", JPY: "ECONOMICS:JPINTR", GBP: "ECONOMICS:GBINTR",
  AUD: "ECONOMICS:AUINTR", NZD: "ECONOMICS:NZINTR", CAD: "ECONOMICS:CAINTR", CHF: "ECONOMICS:CHINTR",
};

export const resolvePolicyRateHistoryPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_POLICY_RATE_HISTORY_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "policy-rate-first-seen.jsonl");

export type PolicyRateFirstSeenRecord = {
  schema_version: "1.0";
  sequence: number;
  series: "policy_rate";
  currency: PolicyRateCurrency;
  source_symbol: string;
  observation_date: string;
  value: number;
  source_observed_at: string;
  available_at: string;
  available_at_basis: "next_utc_business_day_start";
  first_seen_at: string;
};

export type PolicyRateObservationVersion = Omit<PolicyRateFirstSeenRecord, "schema_version" | "sequence" | "series" | "first_seen_at"> & { observed_at: string };

export function nextUtcBusinessDayStart(observationDate: string): string {
  if (!isCalendarDate(observationDate)) throw new Error("policy-rate observation_date must be a calendar date");
  const date = new Date(`${observationDate}T00:00:00.000Z`);
  do { date.setUTCDate(date.getUTCDate() + 1); } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString();
}

const validateRecord = (value: unknown, line?: number): PolicyRateFirstSeenRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid policy-rate history record${suffix}`);
  const record = value as Partial<PolicyRateFirstSeenRecord>;
  if (record.schema_version !== "1.0" || record.series !== "policy_rate") throw new Error(`unsupported policy-rate history schema${suffix}`);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) throw new Error(`invalid policy-rate sequence${suffix}`);
  if (typeof record.currency !== "string" || !CURRENCIES.includes(record.currency as PolicyRateCurrency)) throw new Error(`invalid policy-rate currency${suffix}`);
  if (record.source_symbol !== POLICY_RATE_SYMBOLS[record.currency as PolicyRateCurrency]) throw new Error(`invalid policy-rate source_symbol${suffix}`);
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) throw new Error(`invalid policy-rate observation_date${suffix}`);
  if (typeof record.value !== "number" || !Number.isFinite(record.value) || record.value < -10 || record.value > 100) throw new Error(`invalid policy-rate value${suffix}`);
  if (typeof record.source_observed_at !== "string" || !isCanonicalTimestamp(record.source_observed_at)) throw new Error(`invalid policy-rate source_observed_at${suffix}`);
  if (typeof record.available_at !== "string" || !isCanonicalTimestamp(record.available_at) || record.available_at !== nextUtcBusinessDayStart(record.observation_date)) throw new Error(`invalid policy-rate available_at${suffix}`);
  if (record.available_at_basis !== "next_utc_business_day_start") throw new Error(`invalid policy-rate available_at_basis${suffix}`);
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) throw new Error(`invalid policy-rate first_seen_at${suffix}`);
  if (record.observation_date > record.first_seen_at.slice(0, 10)) throw new Error(`policy-rate observation_date is after first_seen_at${suffix}`);
  return record as PolicyRateFirstSeenRecord;
};

export class PolicyRateFirstSeenStore {
  private readonly log: AppendOnlyFirstSeenLog<PolicyRateFirstSeenRecord>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "policy-rate", validateRecord, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  async observeMany(versions: PolicyRateObservationVersion[]): Promise<{ recorded: PolicyRateFirstSeenRecord[]; unchanged: number; revisions: number }> {
    if (versions.length < 1 || versions.length > CURRENCIES.length) throw new Error("policy-rate observation batch must contain 1 to 8 versions");
    return this.log.serialize(async () => {
      const seen = new Set<PolicyRateCurrency>();
      const candidates = versions.map((version) => {
        if (seen.has(version.currency)) throw new Error(`duplicate policy-rate currency in batch ${version.currency}`);
        seen.add(version.currency);
        return validateRecord({ ...version, schema_version: "1.0", sequence: 1, series: "policy_rate", first_seen_at: new Date(version.observed_at).toISOString() });
      });
      const records = await this.log.readAllUnlocked();
      const latestFirstSeen = records.at(-1)?.first_seen_at;
      if (latestFirstSeen && candidates.some((candidate) => candidate.first_seen_at < latestFirstSeen)) throw new Error("policy-rate first-seen clock moved backwards");
      const recorded: PolicyRateFirstSeenRecord[] = [];
      let unchanged = 0;
      let revisions = 0;
      let sequence = records.length;
      for (const candidate of candidates) {
        const current = records.filter((record) => record.currency === candidate.currency && record.observation_date === candidate.observation_date)
          .sort((a, b) => b.sequence - a.sequence)[0];
        if (current?.value === candidate.value) { unchanged += 1; continue; }
        if (current) revisions += 1;
        const record = { ...candidate, sequence: ++sequence };
        await this.log.appendUnlocked(record);
        records.push(record);
        recorded.push(record);
      }
      return { recorded, unchanged, revisions };
    });
  }

  async getAsOf(currency: PolicyRateCurrency, asOf: Date): Promise<PolicyRateFirstSeenRecord | null> {
    if (!Number.isFinite(asOf.getTime())) throw new Error("as_of must be a valid timestamp");
    const cutoff = asOf.toISOString();
    return this.log.serialize(async () => (await this.log.readAllUnlocked())
      .filter((record) => record.currency === currency && record.first_seen_at <= cutoff && record.available_at <= cutoff)
      .sort((a, b) => b.observation_date.localeCompare(a.observation_date) || b.first_seen_at.localeCompare(a.first_seen_at) || b.sequence - a.sequence)[0] ?? null);
  }

  async coverage() {
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const currencies = Object.fromEntries(CURRENCIES.map((currency) => {
        const rows = records.filter((record) => record.currency === currency);
        const dates = [...new Set(rows.map((record) => record.observation_date))].sort();
        return [currency, { records: rows.length, dates: dates.length, revisions: rows.length - dates.length, earliest_date: dates[0] ?? null, latest_date: dates.at(-1) ?? null, first_collected_at: rows[0]?.first_seen_at ?? null }];
      }));
      return { records: records.length, currencies };
    });
  }
}
