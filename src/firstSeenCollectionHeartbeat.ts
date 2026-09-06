import { homedir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 2_048;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const RUN_SLOTS = [{ hour: 22, minute: 30 }, { hour: 10, minute: 30 }] as const;

export type FirstSeenCollectionHeartbeatRecord = {
  schema_version: "1.0";
  sequence: number;
  series: "first_seen_collection_heartbeat";
  observation_date: string;
  first_seen_at: string;
  status: "complete" | "partial";
  cot_symbols: string[];
  cot_complete: number;
  real_yield_status: "complete" | "error";
  cme_gold_open_interest_status: "complete" | "error";
  coverage_status: "complete" | "partial";
};

export const resolveFirstSeenCollectionHeartbeatPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_FIRST_SEEN_COLLECTION_HEARTBEAT_PATH,
) => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "first-seen-collection-heartbeats.jsonl");

export function latestExpectedFirstSeenRunAt(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error("as_of must be a valid timestamp");
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  for (let daysBack = 0; daysBack < 8; daysBack += 1) {
    const day = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - daysBack));
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const slot of RUN_SLOTS) {
      const expected = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), slot.hour - 9, slot.minute));
      if (expected.getTime() <= now.getTime()) return expected.toISOString();
    }
  }
  throw new Error("could not resolve the latest first-seen collection schedule");
}

const validateRecord = (value: unknown, line?: number): FirstSeenCollectionHeartbeatRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid first-seen collection heartbeat${suffix}`);
  const record = value as Partial<FirstSeenCollectionHeartbeatRecord>;
  if (record.schema_version !== "1.0" || record.series !== "first_seen_collection_heartbeat") throw new Error(`unsupported first-seen collection heartbeat schema${suffix}`);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) throw new Error(`invalid first-seen collection heartbeat sequence${suffix}`);
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) throw new Error(`invalid first-seen collection heartbeat observation_date${suffix}`);
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) throw new Error(`invalid first-seen collection heartbeat first_seen_at${suffix}`);
  if (record.observation_date !== record.first_seen_at.slice(0, 10)) throw new Error(`first-seen collection heartbeat observation_date must equal first_seen date${suffix}`);
  if (record.status !== "complete" && record.status !== "partial") throw new Error(`invalid first-seen collection heartbeat status${suffix}`);
  if (!Array.isArray(record.cot_symbols) || record.cot_symbols.length < 1 || record.cot_symbols.some((symbol) => typeof symbol !== "string" || symbol.length < 1)) throw new Error(`first-seen collection heartbeat must name every COT symbol${suffix}`);
  if (new Set(record.cot_symbols).size !== record.cot_symbols.length) throw new Error(`duplicate first-seen collection heartbeat COT symbol${suffix}`);
  if (!Number.isInteger(record.cot_complete) || (record.cot_complete ?? -1) < 0 || (record.cot_complete ?? 0) > record.cot_symbols.length) throw new Error(`invalid first-seen collection heartbeat COT count${suffix}`);
  if (record.real_yield_status !== "complete" && record.real_yield_status !== "error") throw new Error(`invalid first-seen collection heartbeat real-yield status${suffix}`);
  if (record.cme_gold_open_interest_status !== "complete" && record.cme_gold_open_interest_status !== "error") throw new Error(`invalid first-seen collection heartbeat CME status${suffix}`);
  if (record.coverage_status !== "complete" && record.coverage_status !== "partial") throw new Error(`invalid first-seen collection heartbeat coverage status${suffix}`);
  const expectedStatus = record.cot_complete === record.cot_symbols.length && record.real_yield_status === "complete" && record.cme_gold_open_interest_status === "complete" && record.coverage_status === "complete" ? "complete" : "partial";
  if (record.status !== expectedStatus) throw new Error(`first-seen collection heartbeat status does not match source outcomes${suffix}`);
  return record as FirstSeenCollectionHeartbeatRecord;
};

export class FirstSeenCollectionHeartbeatStore {
  private readonly log: AppendOnlyFirstSeenLog<FirstSeenCollectionHeartbeatRecord>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "first-seen collection heartbeat", validateRecord, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  async recordRun(input: Omit<FirstSeenCollectionHeartbeatRecord, "schema_version" | "sequence" | "series" | "observation_date" | "first_seen_at"> & { observed_at: string }) {
    if (!isCanonicalTimestamp(input.observed_at)) throw new Error("first-seen collection heartbeat observed_at must be a canonical timestamp");
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const record = validateRecord({
        schema_version: "1.0",
        sequence: records.length + 1,
        series: "first_seen_collection_heartbeat",
        observation_date: input.observed_at.slice(0, 10),
        first_seen_at: input.observed_at,
        status: input.status,
        cot_symbols: input.cot_symbols,
        cot_complete: input.cot_complete,
        real_yield_status: input.real_yield_status,
        cme_gold_open_interest_status: input.cme_gold_open_interest_status,
        coverage_status: input.coverage_status,
      });
      await this.log.appendUnlocked(record);
      return record;
    });
  }

  async coverage(asOf = new Date()) {
    const expected = latestExpectedFirstSeenRunAt(asOf);
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const latest = records.at(-1);
      return {
        records: records.length,
        earliest_collected_at: records[0]?.first_seen_at ?? null,
        latest_collected_at: latest?.first_seen_at ?? null,
        latest_run_status: latest?.status ?? null,
        partial_runs: records.filter((record) => record.status === "partial").length,
        latest_expected_run_at: expected,
        latest_run_meets_schedule: latest !== undefined && latest.first_seen_at >= expected,
      };
    });
  }
}
