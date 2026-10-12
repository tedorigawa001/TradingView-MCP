import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";
import { syncJournalForRetry } from "./fsDurability.js";

/**
 * The research trial journal (docs/RESEARCH_TRIALS.md, BACKLOG 103-4): how many configurations each study tried on
 * which data, so that multiple-testing corrections have a written trial count. Counts only, never results.
 */
export const RESEARCH_TRIALS_NAMESPACE = "research_trials";
export const RESEARCH_TRIALS_BATCH_MAX = 20;
export const RESEARCH_TRIALS_MAX_CONFIGURATIONS = 1_000_000;
/** The research IDs and matches a check lists; the counts always cover every match. */
const LISTED_CAP = 100;
export const RESEARCH_TRIALS_LIMITATIONS = [
  "counts_are_caller_reported",
  "unrecorded_research_is_missing",
  "configurations_are_not_independent_trials",
  "overlap_key_is_caller_supplied_series_ids_and_interval",
  "related_series_and_aliases_are_not_linked",
  "reuses_are_caller_declared",
  "counts_span_all_research_ids_and_data_versions",
] as const;

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(isCanonicalTimestamp, "must be a canonical UTC timestamp");
const seriesIds = z.array(identifier).min(1).max(20)
  .refine((ids) => new Set(ids).size === ids.length, "series_ids must be distinct");
const configurationCount = z.number().int().min(1).max(RESEARCH_TRIALS_MAX_CONFIGURATIONS);
const reuseSchema = z.object({ trial_set_id: identifier, configuration_count: configurationCount }).strict();
const countBasis = z.enum(["enumerated", "inferred", "lower_bound"]);
const outcomeSeen = z.enum(["pnl", "forecast_only", "none"]);

const requiredFields = {
  trial_set_id: identifier,
  research_id: identifier,
  series_ids: seriesIds,
  data_version: hash,
  from: timestamp,
  to: timestamp,
  tried_at: timestamp,
  configuration_count: configurationCount,
  count_basis: countBasis,
  outcome_seen: outcomeSeen,
};
/** The input's fields, in the order an identical retry is compared in. */
const INPUT_KEYS = ["trial_set_id", "research_id", "series_ids", "data_version", "from", "to", "tried_at",
  "configuration_count", "count_basis", "outcome_seen", "configuration_list_sha256", "reuses", "note"] as const;

type TrialFields = { trial_set_id: string; from: string; to: string; configuration_count: number;
  reuses: { trial_set_id: string; configuration_count: number }[] };
/** The rules one trial set must keep on its own; the references to earlier ones are checked against the journal. */
const withRules = <T extends z.ZodType<TrialFields>>(schema: T) => schema
  .refine((v) => v.from < v.to, "from must be before to")
  .refine((v) => new Set(v.reuses.map((r) => r.trial_set_id)).size === v.reuses.length,
    "reuses must name each trial set at most once")
  .refine((v) => v.reuses.every((r) => r.trial_set_id !== v.trial_set_id), "a trial set cannot reuse itself")
  .refine((v) => v.reuses.reduce((sum, r) => sum + r.configuration_count, 0) <= v.configuration_count,
    "reused configurations must not exceed configuration_count");

const inputSchema = withRules(z.object({
  ...requiredFields,
  configuration_list_sha256: hash.nullable().default(null),
  reuses: z.array(reuseSchema).max(20).default([]),
  note: z.string().max(500).default(""),
}).strict());
export type ResearchTrialInput = z.input<typeof inputSchema>;
type ParsedInput = z.output<typeof inputSchema>;

export const researchTrialsBatchSchema = z.array(inputSchema).min(1).max(RESEARCH_TRIALS_BATCH_MAX)
  .refine((records) => new Set(records.map((r) => r.trial_set_id)).size === records.length,
    "trial_set_id must be unique within a call");
export const researchTrialsCheckSchema = z.object({ series_ids: seriesIds, from: timestamp, to: timestamp }).strict()
  .refine((v) => v.from < v.to, "from must be before to");
export type ResearchTrialsQuery = z.infer<typeof researchTrialsCheckSchema>;

const storedSchema = withRules(z.object({
  ...requiredFields,
  configuration_list_sha256: hash.nullable(),
  reuses: z.array(reuseSchema).max(20),
  note: z.string().max(500),
  schema_version: z.literal("1.0"),
  namespace: z.literal(RESEARCH_TRIALS_NAMESPACE),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recorded_at: timestamp,
  first_seen_at: timestamp,
  observation_date: z.string().refine(isCalendarDate),
}).strict());
export type ResearchTrialRecord = z.infer<typeof storedSchema>;

function validateRecord(value: unknown): ResearchTrialRecord {
  const record = storedSchema.parse(value);
  if (record.recorded_at !== record.first_seen_at || record.observation_date !== record.recorded_at.slice(0, 10)
    || record.tried_at > record.recorded_at) {
    throw new Error("invalid research trials dates");
  }
  return record;
}

const sameInput = (record: ResearchTrialRecord, request: ParsedInput) =>
  JSON.stringify(INPUT_KEYS.map((key) => record[key])) === JSON.stringify(INPUT_KEYS.map((key) => request[key]));

/** Each reuse names a trial set recorded before, and reuses at most the configurations it holds. */
function assertReuses(reuses: ParsedInput["reuses"], earlier: ResearchTrialRecord[]): void {
  for (const reuse of reuses) {
    const target = earlier.find((entry) => entry.trial_set_id === reuse.trial_set_id);
    if (!target) throw new Error(`reuses names ${reuse.trial_set_id}, which is not recorded before this trial set`);
    if (reuse.configuration_count > target.configuration_count) {
      throw new Error(`reuses takes more configurations from ${reuse.trial_set_id} than it holds`);
    }
  }
}

export interface ResearchTrialsAssessment extends ResearchTrialsQuery {
  scope: "recorded_trial_reports";
  status: "recorded_trials" | "no_recorded_trials";
  matching_sets: number;
  configurations_reported: number;
  configurations_reused_within: number;
  configurations_net: number;
  by_count_basis: Record<z.infer<typeof countBasis>, number>;
  by_outcome_seen: Record<z.infer<typeof outcomeSeen>, number>;
  distinct_data_versions: number;
  research_ids: { research_id: string; sets: number; configurations_reported: number }[];
  research_ids_truncated: boolean;
  matches: ResearchTrialRecord[];
  truncated: boolean;
  total_is_lower_bound: true;
  limitations: string[];
}
export type ResearchTrialsSummary = Omit<ResearchTrialsAssessment, "matches" | "truncated"> & { matches_omitted: number };

/** Trial sets sharing a series ID with the query whose interval overlaps [from, to), half-open. */
function assess(records: ResearchTrialRecord[], query: ResearchTrialsQuery): ResearchTrialsAssessment {
  const matches = records.filter((entry) => entry.series_ids.some((id) => query.series_ids.includes(id))
    && entry.from < query.to && query.from < entry.to);
  const matched = new Set(matches.map((entry) => entry.trial_set_id));
  const sum = (entries: ResearchTrialRecord[]) => entries.reduce((total, entry) => total + entry.configuration_count, 0);
  const reported = sum(matches);
  // A reuse is subtracted only when the trial set it names is counted here too.
  const reused = matches.reduce((total, entry) => total + entry.reuses
    .filter((reuse) => matched.has(reuse.trial_set_id))
    .reduce((subtotal, reuse) => subtotal + reuse.configuration_count, 0), 0);
  const byResearch = new Map<string, { sets: number; configurations_reported: number }>();
  for (const entry of matches) {
    const current = byResearch.get(entry.research_id) ?? { sets: 0, configurations_reported: 0 };
    byResearch.set(entry.research_id, { sets: current.sets + 1,
      configurations_reported: current.configurations_reported + entry.configuration_count });
  }
  const researchIds = [...byResearch].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([research_id, counts]) => ({ research_id, ...counts }));
  return {
    series_ids: query.series_ids, from: query.from, to: query.to,
    scope: "recorded_trial_reports",
    status: matches.length ? "recorded_trials" : "no_recorded_trials",
    matching_sets: matches.length,
    configurations_reported: reported,
    configurations_reused_within: reused,
    configurations_net: reported - reused,
    by_count_basis: { enumerated: sum(matches.filter((e) => e.count_basis === "enumerated")),
      inferred: sum(matches.filter((e) => e.count_basis === "inferred")),
      lower_bound: sum(matches.filter((e) => e.count_basis === "lower_bound")) },
    by_outcome_seen: { pnl: sum(matches.filter((e) => e.outcome_seen === "pnl")),
      forecast_only: sum(matches.filter((e) => e.outcome_seen === "forecast_only")),
      none: sum(matches.filter((e) => e.outcome_seen === "none")) },
    distinct_data_versions: new Set(matches.map((entry) => entry.data_version)).size,
    research_ids: researchIds.slice(0, LISTED_CAP),
    research_ids_truncated: researchIds.length > LISTED_CAP,
    matches: matches.slice(0, LISTED_CAP),
    truncated: matches.length > LISTED_CAP,
    total_is_lower_bound: true,
    limitations: [...RESEARCH_TRIALS_LIMITATIONS,
      ...(matches.length ? [] : ["no_recorded_trials_is_not_proof_of_no_search"])],
  };
}

/** summary_only view: the counts and the research IDs, without the matching records. */
export function summarizeTrialsAssessment(assessment: ResearchTrialsAssessment): ResearchTrialsSummary {
  const { matches: _matches, truncated: _truncated, ...rest } = assessment;
  return { ...rest, matches_omitted: assessment.matching_sets,
    limitations: [...assessment.limitations, "summary_omits_matching_records_use_full_check_for_detail"] };
}

export type ResearchTrialRecordResult = ResearchTrialRecord & { idempotent: boolean; prior_trials: ResearchTrialsSummary };

export const resolveResearchTrialsPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_RESEARCH_TRIALS_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "research-trials.jsonl");

export interface ResearchTrialStoreOptions {
  /** Test seam; one reading per call drives recorded_at and the clock checks. */
  now?: () => Date;
}

export class ResearchTrialStore {
  private readonly log: AppendOnlyFirstSeenLog<ResearchTrialRecord>;
  private readonly clock: () => Date;

  constructor(private readonly filePath = resolveResearchTrialsPath(),
    private readonly limits = { maxFileBytes: 32 * 1024 * 1024, maxRecordBytes: 16 * 1024 },
    options: ResearchTrialStoreOptions = {}) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "research trials", validateRecord, limits);
    this.clock = options.now ?? (() => new Date());
  }

  private async readUnlocked(now: string): Promise<ResearchTrialRecord[]> {
    // The shared log accepts missing terminators and blank lines; this journal must not.
    try {
      const text = (await readBacktestLedgerFile(this.filePath, true)).toString("utf8");
      if (!text.endsWith("\n") || text.slice(0, -1).split("\n").some((line) => !line.trim()
        || Buffer.byteLength(line, "utf8") + 1 > this.limits.maxRecordBytes)) {
        throw new Error("invalid research trials JSONL framing or record size");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const records = await this.log.readAllUnlocked();
    for (const [index, record] of records.entries()) {
      const earlier = records.slice(0, index);
      if (earlier.some((entry) => entry.trial_set_id === record.trial_set_id)) {
        throw new Error("duplicate research trials trial_set_id");
      }
      assertReuses(record.reuses, earlier);
    }
    if (records.length && records[records.length - 1].recorded_at > now) {
      throw new Error("research trials clock moved backwards");
    }
    return records;
  }

  /**
   * Records 1-20 trial sets under one lock. Every request is validated, conflict-checked and capacity-checked before
   * anything is written, so a rejected call writes nothing. If an I/O failure stops the append after complete lines,
   * an identical retry treats those lines as idempotent, syncs the journal again and appends the rest. A torn partial
   * line is not resumable: the next read fails closed on JSONL framing until the file is repaired.
   */
  async recordBatch(input: unknown): Promise<ResearchTrialRecordResult[]> {
    // Parse before queueing to detach the request from caller-owned mutable data.
    const requests = researchTrialsBatchSchema.parse(input);
    return this.log.serialize(async () => {
      const now = this.clock().toISOString();
      const records = await this.readUnlocked(now);
      const planned: ResearchTrialRecord[] = [];
      const results: ResearchTrialRecordResult[] = [];
      let retried = false;
      for (const request of requests) {
        // Earlier requests of this call are earlier trial sets in journal order.
        const current = [...records, ...planned];
        const existing = current.find((entry) => entry.trial_set_id === request.trial_set_id);
        if (existing) {
          if (!sameInput(existing, request)) throw new Error("research trials trial_set_id conflicts with its original input");
          retried = true;
          // A retry reports the counts its first write reported: the trial sets before it.
          results.push({ ...existing, idempotent: true, prior_trials: summarizeTrialsAssessment(assess(
            current.filter((entry) => entry.sequence < existing.sequence), existing)) });
          continue;
        }
        if (request.tried_at > now) throw new Error("tried_at must not be in the future");
        assertReuses(request.reuses, current);
        const record = validateRecord({ ...request, schema_version: "1.0", namespace: RESEARCH_TRIALS_NAMESPACE,
          sequence: current.length + 1, recorded_at: now, first_seen_at: now, observation_date: now.slice(0, 10) });
        planned.push(record);
        results.push({ ...record, idempotent: false, prior_trials: summarizeTrialsAssessment(assess(current, record)) });
      }
      // Nothing is written until every request has passed validation, the conflict check and the append checks.
      if (planned.length) await this.log.assertAppendableUnlocked(records, planned);
      if (retried) await syncJournalForRetry(this.filePath, "research trials");
      for (const record of planned) await this.log.appendUnlocked(record);
      return results;
    });
  }

  /** Read-only counts over the trial sets sharing a series ID with the query and overlapping its interval. */
  async check(input: unknown): Promise<ResearchTrialsAssessment> {
    const query = researchTrialsCheckSchema.parse(input);
    return this.log.serialize(async () => assess(await this.readUnlocked(this.clock().toISOString()), query));
  }
}
