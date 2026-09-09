import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";
import { noFollowFlag, posixModeEnforced } from "./fsDurability.js";

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(isCanonicalTimestamp);
const period = { series_id: identifier, data_version: hash, from: timestamp, to: timestamp };
const ordered = (value: { from: string; to: string }): boolean => value.from < value.to;
const inputSchema = z.object({
  access_id: identifier,
  research_id: identifier,
  ...period,
  accessed_at: timestamp,
  purpose: z.enum(["exploration", "validation"]),
}).strict().refine(ordered, "from must be before to");

export const researchPeriodUsageRecordSchema = inputSchema.refine(
  (value) => value.accessed_at <= new Date().toISOString(), "accessed_at must not be in the future",
);
export const researchPeriodUsageCheckSchema = z.object({
  ...period,
  prior_usage_declaration: z.enum(["unknown", "declared_unused"]).default("unknown"),
}).strict().refine(ordered, "from must be before to");

export type ResearchPeriodUsageInput = z.infer<typeof researchPeriodUsageRecordSchema>;
export type ResearchPeriodUsageCheckInput = z.input<typeof researchPeriodUsageCheckSchema>;
const storedSchema = z.object({
  ...inputSchema.shape,
  schema_version: z.literal("1.0"),
  namespace: z.literal("research_period_usage"),
  source: z.literal("user_reported"),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recorded_at: timestamp,
  first_seen_at: timestamp,
  observation_date: z.string().refine(isCalendarDate),
}).strict().refine(ordered, "from must be before to");
export type ResearchPeriodUsageRecord = z.infer<typeof storedSchema>;

function validateRecord(value: unknown): ResearchPeriodUsageRecord {
  const record = storedSchema.parse(value);
  if (record.recorded_at !== record.first_seen_at
    || record.observation_date !== record.recorded_at.slice(0, 10)
    || record.accessed_at > record.recorded_at) {
    throw new Error("invalid research period usage dates");
  }
  return record;
}

export interface ResearchPeriodUsageAssessment {
  /** Prior means ledger append order, not accessed_at order or causal knowledge. */
  scope: "prior_recorded_access_reports";
  status: "recorded_overlap" | "no_recorded_overlap";
  series_id: string;
  data_version: string;
  from: string;
  to: string;
  prior_usage_declaration: "unknown" | "declared_unused";
  prior_usage_declaration_source: "importer_supplied";
  unused_proven: false;
  candidateEligible: false;
  overlapping_records: number;
  exploration_records: number;
  validation_records: number;
  matches: (ResearchPeriodUsageRecord & { version_relation: "same" | "different" })[];
  truncated: boolean;
  limitations: string[];
}

function assess(records: ResearchPeriodUsageRecord[], query: z.infer<typeof researchPeriodUsageCheckSchema>): ResearchPeriodUsageAssessment {
  const overlaps = records.filter((entry) => entry.series_id === query.series_id
    && entry.from < query.to && query.from < entry.to);
  return {
    ...query,
    scope: "prior_recorded_access_reports",
    status: overlaps.length ? "recorded_overlap" : "no_recorded_overlap",
    prior_usage_declaration_source: "importer_supplied",
    unused_proven: false,
    candidateEligible: false,
    overlapping_records: overlaps.length,
    exploration_records: overlaps.filter((entry) => entry.purpose === "exploration").length,
    validation_records: overlaps.filter((entry) => entry.purpose === "validation").length,
    matches: overlaps.slice(0, 100).map((entry) => ({ ...entry,
      version_relation: entry.data_version === query.data_version ? "same" : "different" })),
    truncated: overlaps.length > 100,
    limitations: ["user_reported_local_usage_only", "prior_and_external_usage_may_be_missing",
      "no_recorded_overlap_is_not_proof_of_unused_data", "declarations_do_not_authorize_candidate_eligibility",
      "data_version_is_caller_supplied_not_source_authentication",
      "prior_means_ledger_append_order_not_access_time"],
  };
}

export class ResearchPeriodUsageStore {
  private readonly log: AppendOnlyFirstSeenLog<ResearchPeriodUsageRecord>;

  constructor(private readonly filePath = join(homedir(), ".tradingview-mcp", "research-period-usage.jsonl")) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "research period usage", validateRecord,
      { maxFileBytes: 32 * 1024 * 1024, maxRecordBytes: 16 * 1024 });
  }

  private async readUnlocked(): Promise<ResearchPeriodUsageRecord[]> {
    // The shared log accepts missing terminators and blank lines; this ledger must not.
    try {
      const text = (await readBacktestLedgerFile(this.filePath, true)).toString("utf8");
      if (!text.endsWith("\n") || text.slice(0, -1).split("\n").some((line) => !line.trim()
        || Buffer.byteLength(line, "utf8") + 1 > 16 * 1024)) {
        throw new Error("invalid research period usage JSONL framing or record size");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const records = await this.log.readAllUnlocked();
    const ids = new Set<string>();
    for (const record of records) {
      if (ids.has(record.access_id)) throw new Error("duplicate research period usage access_id");
      ids.add(record.access_id);
    }
    if (records.length && records[records.length - 1].recorded_at > new Date().toISOString()) {
      throw new Error("research period usage clock moved backwards");
    }
    return records;
  }

  private async syncRetryUnlocked(): Promise<void> {
    // A previous append may have written complete bytes but failed either fsync.
    // Re-establish both durability barriers before acknowledging an identical retry.
    const paths = [{ path: this.filePath, directory: false }];
    if (process.platform !== "win32") paths.push({ path: dirname(this.filePath), directory: true });
    for (const { path, directory } of paths) {
      const before = await lstat(path);
      if (before.isSymbolicLink() || !(directory ? before.isDirectory() : before.isFile())) {
        throw new Error("research period usage retry sync path has unsafe file type");
      }
      const handle = await open(path, (directory ? constants.O_RDONLY : constants.O_RDWR)
        | noFollowFlag() | (constants.O_NONBLOCK ?? 0));
      try {
        const stat = await handle.stat();
        if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.dev !== before.dev || stat.ino !== before.ino) {
          throw new Error("research period usage retry sync path changed while opening");
        }
        if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
          throw new Error("research period usage retry sync path must be owned by the current user");
        }
        if (posixModeEnforced() && (stat.mode & 0o077) !== 0) {
          throw new Error("research period usage retry sync permissions must be owner-only");
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }

  async record(input: unknown): Promise<ResearchPeriodUsageRecord & {
    idempotent: boolean; prior_overlap: ResearchPeriodUsageAssessment;
  }> {
    // Parse before queueing to detach the request from caller-owned mutable data.
    const request = researchPeriodUsageRecordSchema.parse(input);
    return this.log.serialize(async () => {
      const records = await this.readUnlocked();
      const existing = records.find((entry) => entry.access_id === request.access_id);
      if (existing && Object.keys(request).some((key) =>
        existing[key as keyof ResearchPeriodUsageInput] !== request[key as keyof ResearchPeriodUsageInput])) {
        throw new Error("research period usage access_id conflicts with its original input");
      }
      // Retries replay the original prefix, so later reports cannot rewrite this assessment.
      // Reports in that prefix may describe accesses later than request.accessed_at.
      const prior = existing ? records.filter((entry) => entry.sequence < existing.sequence) : records;
      const prior_overlap = assess(prior, {
        series_id: request.series_id, data_version: request.data_version,
        from: request.from, to: request.to, prior_usage_declaration: "unknown",
      });
      if (existing) {
        await this.syncRetryUnlocked();
        return { ...existing, idempotent: true, prior_overlap };
      }
      const now = new Date().toISOString();
      if (records.length && records[records.length - 1].recorded_at > now) {
        throw new Error("research period usage clock moved backwards");
      }
      const record = validateRecord({ ...request, schema_version: "1.0", namespace: "research_period_usage",
        source: "user_reported", sequence: records.length + 1, recorded_at: now, first_seen_at: now,
        observation_date: now.slice(0, 10) });
      await this.log.appendUnlocked(record);
      return { ...record, idempotent: false, prior_overlap };
    });
  }

  async check(input: unknown): Promise<ResearchPeriodUsageAssessment> {
    const query = researchPeriodUsageCheckSchema.parse(input);
    return this.log.serialize(async () => assess(await this.readUnlocked(), query));
  }
}
