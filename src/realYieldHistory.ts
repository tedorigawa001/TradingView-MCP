import { homedir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 2_048;
const SERIES = "US_TREASURY_PAR_REAL_CMT_10Y";
const UNIT = "percent_per_annum_bond_equivalent";
const SOURCE = "us_treasury";

export const resolveRealYieldHistoryPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_REAL_YIELD_HISTORY_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "real-yield-first-seen.jsonl");

export type RealYieldFirstSeenRecord = {
  schema_version: "1.1";
  sequence: number;
  series: typeof SERIES;
  observation_date: string;
  value: number;
  unit: typeof UNIT;
  source: typeof SOURCE;
  first_seen_at: string;
  source_updated_at_raw: string | null;
  observed_feed_year: number;
};

export type RealYieldObservationVersion = Pick<
  RealYieldFirstSeenRecord,
  "series" | "observation_date" | "value" | "source_updated_at_raw"
> & { observed_at: string; observed_feed_year: number };

const validateRecord = (value: unknown, line?: number): RealYieldFirstSeenRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid real-yield history record${suffix}`);
  }
  const record = value as Partial<RealYieldFirstSeenRecord>;
  if (record.schema_version !== "1.1" || record.series !== SERIES || record.unit !== UNIT || record.source !== SOURCE) {
    throw new Error(`unsupported real-yield history schema${suffix}`);
  }
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) {
    throw new Error(`invalid real-yield sequence${suffix}`);
  }
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) {
    throw new Error(`invalid real-yield observation_date${suffix}`);
  }
  if (typeof record.value !== "number" || !Number.isFinite(record.value) || record.value < -25 || record.value > 25) {
    throw new Error(`invalid real-yield value${suffix}`);
  }
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) {
    throw new Error(`invalid real-yield first_seen_at${suffix}`);
  }
  if (record.observation_date > record.first_seen_at.slice(0, 10)) {
    throw new Error(`real-yield observation_date is after first_seen_at${suffix}`);
  }
  if (record.source_updated_at_raw !== null && typeof record.source_updated_at_raw !== "string") {
    throw new Error(`invalid real-yield source_updated_at_raw${suffix}`);
  }
  if (typeof record.source_updated_at_raw === "string" && record.source_updated_at_raw.length > 256) {
    throw new Error(`real-yield source_updated_at_raw is too long${suffix}`);
  }
  if (typeof record.observed_feed_year !== "number" || !Number.isInteger(record.observed_feed_year) ||
      record.observed_feed_year < 1990 || record.observed_feed_year > 2200) {
    throw new Error(`invalid real-yield observed_feed_year${suffix}`);
  }
  return record as RealYieldFirstSeenRecord;
};

export class RealYieldFirstSeenStore {
  private readonly log: AppendOnlyFirstSeenLog<RealYieldFirstSeenRecord>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "real-yield", validateRecord,
      { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  private readAllUnlocked(): Promise<RealYieldFirstSeenRecord[]> {
    return this.log.readAllUnlocked();
  }

  private appendUnlocked(record: RealYieldFirstSeenRecord): Promise<void> {
    return this.log.appendUnlocked(record);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    return this.log.serialize(operation);
  }

  private acquireFileLock(): Promise<() => Promise<void>> {
    return this.log.acquireFileLock();
  }

  async observe(version: RealYieldObservationVersion): Promise<RealYieldFirstSeenRecord> {
    return (await this.observeMany([version]))[0];
  }

  async observeMany(versions: RealYieldObservationVersion[]): Promise<RealYieldFirstSeenRecord[]> {
    if (versions.length === 0 || versions.length > 400) {
      throw new Error("real-yield observation batch must contain 1 to 400 versions");
    }
    return this.serialize(async () => {
      const seenDates = new Set<string>();
      const candidates = versions.map((version) => {
        if (seenDates.has(version.observation_date)) {
          throw new Error(`duplicate real-yield observation_date in batch ${version.observation_date}`);
        }
        seenDates.add(version.observation_date);
        return validateRecord({
        schema_version: "1.1",
        sequence: 1,
        series: version.series,
        observation_date: version.observation_date,
        value: version.value,
        unit: UNIT,
        source: SOURCE,
        first_seen_at: new Date(version.observed_at).toISOString(),
        source_updated_at_raw: version.source_updated_at_raw,
        observed_feed_year: version.observed_feed_year,
      });
      });
      const records = await this.readAllUnlocked();
      const latestFirstSeen = records.map((record) => record.first_seen_at).sort().at(-1);
      const latestForDate = (candidate: RealYieldFirstSeenRecord) => records
        .filter((record) => record.series === candidate.series && record.observation_date === candidate.observation_date)
        .sort((a, b) => b.sequence - a.sequence)[0];
      if (latestFirstSeen && candidates.some((candidate) =>
        latestForDate(candidate)?.value !== candidate.value && candidate.first_seen_at < latestFirstSeen)) {
        throw new Error("real-yield first-seen clock moved backwards");
      }
      const results: RealYieldFirstSeenRecord[] = [];
      let nextSequence = records.reduce((maximum, record) => Math.max(maximum, record.sequence), 0);
      for (const candidate of candidates) {
        const current = latestForDate(candidate);
        if (current?.value === candidate.value) {
          results.push(current);
          continue;
        }
        const version = { ...candidate, sequence: ++nextSequence };
        await this.appendUnlocked(version);
        records.push(version);
        results.push(version);
      }
      return results;
    });
  }

  async getAsOf(asOf: Date): Promise<RealYieldFirstSeenRecord | null> {
    if (!Number.isFinite(asOf.getTime())) throw new Error("as_of must be a valid timestamp");
    const asOfIso = asOf.toISOString();
    return this.serialize(async () => {
      const eligible = (await this.readAllUnlocked()).filter((record) => record.first_seen_at <= asOfIso);
      eligible.sort((a, b) =>
        b.observation_date.localeCompare(a.observation_date) ||
        b.first_seen_at.localeCompare(a.first_seen_at) ||
        b.sequence - a.sequence);
      return eligible[0] ?? null;
    });
  }

  async coverage(): Promise<{
    records: number;
    dates: number;
    revisions: number;
    earliest_date: string | null;
    latest_date: string | null;
    first_collected_at: string | null;
  }> {
    return this.serialize(async () => {
      const records = await this.readAllUnlocked();
      const dates = new Set(records.map((record) => record.observation_date));
      return {
        records: records.length,
        dates: dates.size,
        revisions: records.length - dates.size,
        earliest_date: dates.size === 0 ? null : [...dates].sort()[0],
        latest_date: dates.size === 0 ? null : [...dates].sort().at(-1)!,
        first_collected_at: records.length === 0 ? null : records.map((record) => record.first_seen_at).sort()[0],
      };
    });
  }
}
