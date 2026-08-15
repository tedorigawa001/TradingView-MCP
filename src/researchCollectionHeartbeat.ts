import { homedir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";

/**
 * Proof that the research collector ran, kept separately from proof that it saw
 * anything.
 *
 * research-collection.jsonl is appended to only when a hypothesis has at least
 * one closed event, and the frozen hypotheses produce roughly one event every
 * ten days. A quiet week and a collector that died four days ago therefore look
 * identical in the evidence, and the second is unrecoverable: this is a
 * point-in-time series, so a gap cannot be filled in afterwards.
 *
 * The policy-rate collector already separates the two this way. This is the same
 * device for the hourly research run.
 */

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 4_096;

export type ResearchCollectionHeartbeatRecord = {
  schema_version: "1.0";
  sequence: number;
  series: "research_collection_heartbeat";
  observation_date: string;
  first_seen_at: string;
  /** Hypotheses attempted on this run, with what each one actually observed. */
  hypotheses: Array<{
    hypothesis_id: string;
    status: "complete" | "partial";
    events: number;
    recorded: boolean;
  }>;
  chart_restored: boolean;
};

export const resolveResearchCollectionHeartbeatPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_RESEARCH_COLLECTION_HEARTBEAT_PATH,
) => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "research-collection-heartbeats.jsonl");

const validateRecord = (value: unknown, line?: number): ResearchCollectionHeartbeatRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid research collection heartbeat${suffix}`);
  const record = value as Partial<ResearchCollectionHeartbeatRecord>;
  if (record.schema_version !== "1.0" || record.series !== "research_collection_heartbeat") throw new Error(`unsupported research collection heartbeat schema${suffix}`);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) throw new Error(`invalid research collection heartbeat sequence${suffix}`);
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) throw new Error(`invalid research collection heartbeat observation_date${suffix}`);
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) throw new Error(`invalid research collection heartbeat first_seen_at${suffix}`);
  if (record.observation_date !== record.first_seen_at.slice(0, 10)) throw new Error(`research collection heartbeat observation_date must equal first_seen date${suffix}`);
  if (typeof record.chart_restored !== "boolean") throw new Error(`invalid research collection heartbeat chart_restored${suffix}`);
  if (!Array.isArray(record.hypotheses) || record.hypotheses.length === 0) throw new Error(`research collection heartbeat must name the hypotheses it attempted${suffix}`);
  const seen = new Set<string>();
  for (const item of record.hypotheses) {
    if (!item || typeof item !== "object") throw new Error(`invalid research collection heartbeat hypothesis${suffix}`);
    if (typeof item.hypothesis_id !== "string" || item.hypothesis_id.length === 0 || item.hypothesis_id.length > 128) throw new Error(`invalid research collection heartbeat hypothesis_id${suffix}`);
    if (seen.has(item.hypothesis_id)) throw new Error(`duplicate research collection heartbeat hypothesis_id${suffix}`);
    seen.add(item.hypothesis_id);
    if (item.status !== "complete" && item.status !== "partial") throw new Error(`invalid research collection heartbeat status${suffix}`);
    if (!Number.isInteger(item.events) || item.events < 0) throw new Error(`invalid research collection heartbeat events${suffix}`);
    if (typeof item.recorded !== "boolean") throw new Error(`invalid research collection heartbeat recorded${suffix}`);
  }
  return record as ResearchCollectionHeartbeatRecord;
};

export class ResearchCollectionHeartbeatStore {
  private readonly log: AppendOnlyFirstSeenLog<ResearchCollectionHeartbeatRecord>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "research collection heartbeat", validateRecord, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  async recordRun(input: Omit<ResearchCollectionHeartbeatRecord, "schema_version" | "sequence" | "series" | "observation_date" | "first_seen_at"> & { observed_at: string }) {
    if (!isCanonicalTimestamp(input.observed_at)) throw new Error("research collection heartbeat observed_at must be a canonical timestamp");
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const record = validateRecord({
        schema_version: "1.0",
        sequence: records.length + 1,
        series: "research_collection_heartbeat",
        observation_date: input.observed_at.slice(0, 10),
        first_seen_at: input.observed_at,
        hypotheses: input.hypotheses,
        chart_restored: input.chart_restored,
      });
      await this.log.appendUnlocked(record);
      return record;
    });
  }

  async coverage(asOf = new Date()) {
    if (!Number.isFinite(asOf.getTime())) throw new Error("as_of must be a valid timestamp");
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const times = records.map((record) => Date.parse(record.first_seen_at));
      // The job is hourly, so continuity is measured in hours rather than in the
      // business days a weekday-scheduled collector is judged by.
      const gapHours = times.slice(1).map((time, index) => (time - times[index]) / 3_600_000);
      const latest = records.at(-1);
      const perHypothesis = new Map<string, { attempts: number; recorded: number; events: number }>();
      for (const record of records) {
        for (const item of record.hypotheses) {
          const entry = perHypothesis.get(item.hypothesis_id) ?? { attempts: 0, recorded: 0, events: 0 };
          entry.attempts += 1;
          entry.recorded += item.recorded ? 1 : 0;
          entry.events += item.events;
          perHypothesis.set(item.hypothesis_id, entry);
        }
      }
      return {
        records: records.length,
        distinct_observation_dates: new Set(records.map((record) => record.observation_date)).size,
        earliest_collected_at: records[0]?.first_seen_at ?? null,
        latest_collected_at: latest?.first_seen_at ?? null,
        maximum_gap_hours: gapHours.length === 0 ? null : Number(Math.max(...gapHours).toFixed(2)),
        latest_run_age_hours: latest === undefined ? null : Number(((asOf.getTime() - Date.parse(latest.first_seen_at)) / 3_600_000).toFixed(2)),
        chart_restoration_failures: records.filter((record) => !record.chart_restored).length,
        by_hypothesis: Object.fromEntries([...perHypothesis].map(([id, entry]) => [id, entry])),
      };
    });
  }
}
