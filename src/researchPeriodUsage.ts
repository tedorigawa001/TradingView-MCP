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
export const RESEARCH_PERIOD_USAGE_BATCH_MAX = 20;
export const researchPeriodUsageBatchSchema = z.array(researchPeriodUsageRecordSchema)
  .min(1).max(RESEARCH_PERIOD_USAGE_BATCH_MAX)
  .refine((records) => new Set(records.map((record) => record.access_id)).size === records.length,
    "access_id must be unique within a batch");
const toolAccessSchema = z.object({
  access_id: identifier,
  research_id: identifier,
  ...period,
  purpose: inputSchema.shape.purpose,
  request_sha256: hash,
}).strict().refine(ordered, "from must be before to");
export type ResearchPeriodToolAccessInput = z.infer<typeof toolAccessSchema>;
const toolAccessBatchSchema = z.array(toolAccessSchema).min(1).max(RESEARCH_PERIOD_USAGE_BATCH_MAX)
  .refine((records) => new Set(records.map((record) => record.access_id)).size === records.length,
    "access_id must be unique within a batch");
export type ResearchPeriodUsageCheckInput = z.input<typeof researchPeriodUsageCheckSchema>;
const storedFields = {
  ...inputSchema.shape,
  schema_version: z.literal("1.0"),
  namespace: z.literal("research_period_usage"),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recorded_at: timestamp,
  first_seen_at: timestamp,
  observation_date: z.string().refine(isCalendarDate),
};
/** Each observing tool records one fixed scope; the binding is enforced on every stored record. */
export const OBSERVING_TOOL_SCOPES = {
  summarize_backtest_ledger: "ledger_trade_envelope_only",
  compare_forecast_losses: "forecast_evaluation_window_only",
} as const;
export type ObservingTool = keyof typeof OBSERVING_TOOL_SCOPES;
const observingTools = Object.keys(OBSERVING_TOOL_SCOPES) as [ObservingTool, ...ObservingTool[]];
const observingScopes = Object.values(OBSERVING_TOOL_SCOPES) as [string, ...string[]];
const observingToolSchema = z.enum(observingTools);
const toolMetadata = {
  source: "tool_observed",
  tool_name: "summarize_backtest_ledger",
  scope: OBSERVING_TOOL_SCOPES.summarize_backtest_ledger,
} as const;
// One tool_observed variant: zod rejects a second variant with the same discriminator value.
const storedSchema = z.discriminatedUnion("source", [
  z.object({ ...storedFields, source: z.literal("user_reported") }).strict(),
  z.object({ ...storedFields, source: z.literal("tool_observed"),
    tool_name: observingToolSchema, scope: z.enum(observingScopes),
    request_sha256: hash }).strict(),
]).refine(ordered, "from must be before to")
  .refine((record) => record.source !== "tool_observed" || OBSERVING_TOOL_SCOPES[record.tool_name] === record.scope,
    "tool_name and scope do not match");
export type ResearchPeriodUsageRecord = z.infer<typeof storedSchema>;

function validateRecord(value: unknown): ResearchPeriodUsageRecord {
  const record = storedSchema.parse(value);
  if (record.recorded_at !== record.first_seen_at
    || record.observation_date !== record.recorded_at.slice(0, 10)
    || record.accessed_at > record.recorded_at
    || (record.source === "tool_observed" && record.accessed_at !== record.recorded_at)) {
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
    limitations: [...new Set([
      ...(observed(records, "summarize_backtest_ledger")
        ? ["tool_observed_usage_is_ledger_trade_envelope_only",
          "series_id_and_data_version_are_importer_supplied_metadata",
          "ledger_trade_envelope_does_not_include_indicator_lookbacks"] : []),
      ...(observed(records, "compare_forecast_losses")
        ? ["tool_observed_usage_is_forecast_evaluation_window_only",
          "series_id_and_data_version_are_importer_supplied_metadata",
          "forecast_estimation_history_not_covered"] : []),
      ...(records.some((entry) => entry.source === "tool_observed") ? [] : ["user_reported_local_usage_only"]),
      ...(records.some((entry) => entry.source === "tool_observed")
        && records.some((entry) => entry.source === "user_reported") ? ["manual_usage_is_user_reported"] : []),
      "prior_and_external_usage_may_be_missing", "untracked_external_accesses_may_be_missing",
      "no_recorded_overlap_is_not_proof_of_unused_data", "declarations_do_not_authorize_candidate_eligibility",
      "data_version_is_caller_supplied_not_source_authentication",
      "prior_means_ledger_append_order_not_access_time"])],
  };
}

function observed(records: ResearchPeriodUsageRecord[], tool: ObservingTool): boolean {
  return records.some((entry) => entry.source === "tool_observed" && entry.tool_name === tool);
}

export type ResearchPeriodUsageSummary = Omit<ResearchPeriodUsageAssessment, "matches" | "truncated"> & {
  matches_omitted: number;
  overlapping_research_ids: string[];
  overlapping_research_ids_truncated: boolean;
};

/** summary_only view: counts and distinct research IDs instead of every overlapping record. */
export function summarizeAssessment(assessment: ResearchPeriodUsageAssessment): ResearchPeriodUsageSummary {
  const { matches, truncated, ...rest } = assessment;
  const ids = [...new Set(matches.map((entry) => entry.research_id))].sort();
  return { ...rest, matches_omitted: assessment.overlapping_records, overlapping_research_ids: ids,
    overlapping_research_ids_truncated: truncated,
    limitations: [...assessment.limitations, "summary_omits_matching_records_use_full_check_for_detail"] };
}

type RecordRequest = (ResearchPeriodUsageInput & { source: "user_reported" })
  | (ResearchPeriodToolAccessInput & { source: "tool_observed"; tool_name: ObservingTool;
    scope: (typeof OBSERVING_TOOL_SCOPES)[ObservingTool] });
type RecordResult = ResearchPeriodUsageRecord & { idempotent: boolean; prior_overlap: ResearchPeriodUsageAssessment };

export class ResearchPeriodUsageStore {
  private readonly log: AppendOnlyFirstSeenLog<ResearchPeriodUsageRecord>;

  constructor(private readonly filePath = join(homedir(), ".tradingview-mcp", "research-period-usage.jsonl"),
    private readonly limits = { maxFileBytes: 32 * 1024 * 1024, maxRecordBytes: 16 * 1024 }) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "research period usage", validateRecord, limits);
  }

  private async readUnlocked(): Promise<ResearchPeriodUsageRecord[]> {
    // The shared log accepts missing terminators and blank lines; this ledger must not.
    try {
      const text = (await readBacktestLedgerFile(this.filePath, true)).toString("utf8");
      if (!text.endsWith("\n") || text.slice(0, -1).split("\n").some((line) => !line.trim()
        || Buffer.byteLength(line, "utf8") + 1 > this.limits.maxRecordBytes)) {
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

  async record(input: unknown): Promise<RecordResult> {
    // Parse before queueing to detach the request from caller-owned mutable data.
    const request = researchPeriodUsageRecordSchema.parse(input);
    return (await this.recordBound([{ ...request, source: "user_reported" }]))[0];
  }

  /**
   * Records 1-20 user-reported accesses under one lock. Every request is validated, conflict-checked
   * and capacity-checked (record and file limits for the whole batch) before anything is written,
   * so a rejected batch writes nothing. If an I/O failure stops the append after complete lines,
   * an identical retry treats those lines as idempotent and appends the rest. A torn partial line
   * is not resumable: the next read fails closed on JSONL framing until the file is repaired.
   */
  async recordBatch(input: unknown): Promise<RecordResult[]> {
    const requests = researchPeriodUsageBatchSchema.parse(input);
    return this.recordBound(requests.map((request) => ({ ...request, source: "user_reported" as const })));
  }

  async recordToolAccess(input: unknown): Promise<RecordResult> {
    const request = toolAccessSchema.parse(input);
    return (await this.recordBound([{ ...request, ...toolMetadata }]))[0];
  }

  /**
   * Tool-observed batch for a server-chosen tool. The tool is an argument, never input: the input
   * schema stays strict, so a caller cannot supply tool_name or scope. Same all-or-nothing
   * validation, conflict and capacity checks as recordBatch.
   */
  async recordToolAccessBatch(tool: unknown, inputs: unknown): Promise<RecordResult[]> {
    const name = observingToolSchema.parse(tool);   // TypeScript types are erased at runtime
    const requests = toolAccessBatchSchema.parse(inputs);
    return this.recordBound(requests.map((request) => ({ ...request, source: "tool_observed" as const,
      tool_name: name, scope: OBSERVING_TOOL_SCOPES[name] })));
  }

  private async recordBound(requests: RecordRequest[]): Promise<RecordResult[]> {
    return this.log.serialize(async () => {
      const records = await this.readUnlocked();
      const now = new Date().toISOString();
      const planned: ResearchPeriodUsageRecord[] = [];
      const results: RecordResult[] = [];
      let retried = false;
      for (const request of requests) {
        // Earlier requests of this batch are prior reports in ledger append order.
        const current = [...records, ...planned];
        const existing = current.find((entry) => entry.access_id === request.access_id);
        if (existing && Object.entries(request).some(([key, value]) =>
          (existing as Record<string, unknown>)[key] !== value)) {
          throw new Error("research period usage access_id conflicts with its original input");
        }
        // Retries replay the original prefix, so later reports cannot rewrite this assessment.
        // Reports in that prefix may describe accesses later than request.accessed_at.
        const prior = existing ? current.filter((entry) => entry.sequence < existing.sequence) : current;
        const prior_overlap = assess(prior, {
          series_id: request.series_id, data_version: request.data_version,
          from: request.from, to: request.to, prior_usage_declaration: "unknown",
        });
        if (existing) {
          retried = true;
          results.push({ ...existing, idempotent: true, prior_overlap });
          continue;
        }
        if (current.length && current[current.length - 1].recorded_at > now) {
          throw new Error("research period usage clock moved backwards");
        }
        const record = validateRecord({ ...request,
          accessed_at: request.source === "tool_observed" ? now : request.accessed_at,
          schema_version: "1.0", namespace: "research_period_usage",
          sequence: current.length + 1, recorded_at: now, first_seen_at: now,
          observation_date: now.slice(0, 10) });
        planned.push(record);
        results.push({ ...record, idempotent: false, prior_overlap });
      }
      // Nothing is written until every request has passed validation, the conflict check and a
      // capacity check for the whole batch (per-record checks alone could stop part-way).
      if (planned.length) await this.log.assertAppendCapacityUnlocked(planned);
      if (retried) await this.syncRetryUnlocked();
      for (const record of planned) await this.log.appendUnlocked(record);
      return results;
    });
  }

  async check(input: unknown): Promise<ResearchPeriodUsageAssessment> {
    const query = researchPeriodUsageCheckSchema.parse(input);
    return this.log.serialize(async () => assess(await this.readUnlocked(), query));
  }

  async preflightOos(input: unknown) {
    const query = researchPeriodUsageCheckSchema.parse(input);
    return this.log.serialize(async () => {
      const usage = assess(await this.readUnlocked(), query);
      const overlap = usage.overlapping_records > 0;
      return {
        contract: "recorded_usage_oos_preflight_v1",
        checked_at: new Date().toISOString(),
        status: overlap ? "blocked" : "review_required",
        reason: overlap ? "evaluation_period_has_recorded_usage" : "absence_of_usage_records_is_not_unused_evidence",
        execution_allowed: false,
        candidateEligible: false,
        unused_proven: false,
        usage,
        required_actions: overlap
          ? ["do_not_label_this_period_unused_oos", "choose_a_separate_uninspected_period_or_report_as_exploratory"]
          : ["review_untracked_external_and_related_series_access", "verify_frozen_protocol_and_data_provenance"],
        limitations: ["read_only_snapshot_not_a_reservation_or_execution_token",
          "existing_backtest_tools_are_not_intercepted", "concurrent_or_later_access_may_change_readiness",
          "all_research_ids_versions_and_purposes_are_considered_for_exact_series_id",
          "no_automatic_approval_path_in_v1"],
      };
    });
  }
}
