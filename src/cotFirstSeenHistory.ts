import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";

const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_BYTES = 1_024;

export const resolveCotFirstSeenHistoryPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_COT_FIRST_SEEN_HISTORY_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "cot-first-seen.jsonl");

export type CotFirstSeenRecord = {
  schema_version: "1.0";
  sequence: number;
  series: "cftc_cot";
  symbol: string;
  observation_date: string;
  value_hash: string;
  first_seen_at: string;
};

export type CotObservationVersion = {
  symbol: string;
  observation_date: string;
  value: unknown;
  observed_at: string;
};

const validateRecord = (value: unknown, line?: number): CotFirstSeenRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid COT first-seen record${suffix}`);
  const record = value as Partial<CotFirstSeenRecord>;
  if (record.schema_version !== "1.0" || record.series !== "cftc_cot") throw new Error(`unsupported COT first-seen schema${suffix}`);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) throw new Error(`invalid COT first-seen sequence${suffix}`);
  if (typeof record.symbol !== "string" || !/^[A-Z0-9:_!.-]{1,80}$/.test(record.symbol)) throw new Error(`invalid COT first-seen symbol${suffix}`);
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) throw new Error(`invalid COT first-seen observation_date${suffix}`);
  if (typeof record.value_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.value_hash)) throw new Error(`invalid COT first-seen value_hash${suffix}`);
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) throw new Error(`invalid COT first-seen first_seen_at${suffix}`);
  return record as CotFirstSeenRecord;
};

const digest = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export class CotFirstSeenStore {
  private readonly log: AppendOnlyFirstSeenLog<CotFirstSeenRecord>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "COT first-seen", validateRecord,
      { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  async observeMany(versions: CotObservationVersion[]): Promise<CotFirstSeenRecord[]> {
    if (versions.length < 1 || versions.length > 300) throw new Error("COT first-seen batch must contain 1 to 300 versions");
    return this.log.serialize(async () => {
      const seen = new Set<string>();
      const candidates = versions.map((version) => {
        const key = `${version.symbol}:${version.observation_date}`;
        if (seen.has(key)) throw new Error(`duplicate COT first-seen observation in batch ${key}`);
        seen.add(key);
        return validateRecord({ schema_version: "1.0", sequence: 1, series: "cftc_cot", symbol: version.symbol,
          observation_date: version.observation_date, value_hash: digest(version.value), first_seen_at: new Date(version.observed_at).toISOString() });
      });
      const records = await this.log.readAllUnlocked();
      const latestSeen = records.at(-1)?.first_seen_at;
      if (latestSeen && candidates.some((item) => item.first_seen_at < latestSeen)) throw new Error("COT first-seen clock moved backwards");
      let sequence = records.length;
      const results: CotFirstSeenRecord[] = [];
      for (const candidate of candidates) {
        const current = records.filter((item) => item.symbol === candidate.symbol && item.observation_date === candidate.observation_date).at(-1);
        if (current?.value_hash === candidate.value_hash) {
          results.push(current);
          continue;
        }
        const next = { ...candidate, sequence: ++sequence };
        await this.log.appendUnlocked(next);
        records.push(next);
        results.push(next);
      }
      return results;
    });
  }
}
