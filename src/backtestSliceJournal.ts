import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BACKTEST_LEDGER_MAX_BYTES, backtestLedgerSummarySchema, readBacktestLedgerFile, type summarizeBacktestLedger } from "./backtestLedger.js";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";

export const backtestSliceResearchIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const identifier = backtestSliceResearchIdSchema;
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(100_000);
const requestFields = backtestLedgerSummarySchema.shape;
const conditionsSchema = z.object({
  include_symbols: z.array(requestFields.include_symbols.unwrap().element).max(100),
  exclude_symbols: z.array(requestFields.exclude_symbols.unwrap().element).max(100),
  direction: requestFields.direction.unwrap().nullable(),
  from: requestFields.from.unwrap().nullable(),
  to: requestFields.to.unwrap().nullable(),
  group_by: requestFields.group_by.removeDefault(),
  round_trip_cost_bps: requestFields.round_trip_cost_bps,
}).strict();

export type BacktestSliceConditions = z.infer<typeof conditionsSchema>;
type Summary = ReturnType<typeof summarizeBacktestLedger>;
export type BacktestSliceSummary = Pick<Summary, "artifact_id" | "source_sha256" | "filters" | "ledger_records" | "selected_fraction">
  & { overall: Pick<Summary["overall"], "records">; groups: { key: string }[] };

export function normalizeBacktestSliceConditions(filters: unknown): BacktestSliceConditions {
  const request = backtestLedgerSummarySchema.parse(filters);
  if (request.include_symbols?.some((symbol) => request.exclude_symbols?.includes(symbol))) {
    throw new Error("slice include/exclude symbols overlap");
  }
  return {
    include_symbols: [...new Set(request.include_symbols ?? [])].sort(),
    exclude_symbols: [...new Set(request.exclude_symbols ?? [])].sort(),
    direction: request.direction ?? null,
    from: request.from ?? null,
    to: request.to ?? null,
    group_by: request.group_by,
    round_trip_cost_bps: request.round_trip_cost_bps === 0 ? 0 : request.round_trip_cost_bps,
  };
}

const conditionHash = (conditions: BacktestSliceConditions): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(conditions)).digest("hex")}`;

const recordSchema = z.object({
  schema_version: z.literal("1.0"),
  namespace: z.literal("backtest_slice_exploration"),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observation_date: z.string().refine(isCalendarDate),
  first_seen_at: z.string().refine(isCanonicalTimestamp),
  research_id: identifier,
  artifact_id: hash,
  source_sha256: hash,
  conditions: conditionsSchema,
  condition_hash: hash,
  ledger_records: count.min(1),
  selected_records: count,
  selected_fraction: z.number().min(0).max(1),
  group_keys: z.array(z.string().min(1).max(64)).max(500),
}).strict();
type SliceRecord = z.infer<typeof recordSchema>;

function validateRecord(value: unknown): SliceRecord {
  const record = recordSchema.parse(value);
  const c = record.conditions;
  const normalized = normalizeBacktestSliceConditions({
    artifact_id: record.artifact_id,
    include_symbols: c.include_symbols.length ? c.include_symbols : undefined,
    exclude_symbols: c.exclude_symbols.length ? c.exclude_symbols : undefined,
    direction: c.direction ?? undefined, from: c.from ?? undefined, to: c.to ?? undefined,
    group_by: c.group_by, round_trip_cost_bps: c.round_trip_cost_bps,
  });
  if (JSON.stringify(c) !== JSON.stringify(normalized) || record.condition_hash !== conditionHash(c)) {
    throw new Error("invalid slice journal canonical conditions or condition hash");
  }
  if (record.observation_date !== record.first_seen_at.slice(0, 10)
    || record.selected_records > record.ledger_records
    || record.selected_fraction !== record.selected_records / record.ledger_records) {
    throw new Error("invalid slice journal exposure counts or date");
  }
  const keys = record.group_keys;
  if (JSON.stringify(keys) !== JSON.stringify([...new Set(keys)].sort())
    || keys.length > record.selected_records
    || (c.group_by === "none" ? keys.length !== 0 : (keys.length === 0) !== (record.selected_records === 0))) {
    throw new Error("invalid slice journal group keys");
  }
  for (const key of keys) {
    const valid = c.group_by === "symbol"
      ? /^[A-Za-z0-9_.!:&/-]{1,64}$/.test(key)
        && (!c.include_symbols.length || c.include_symbols.includes(key)) && !c.exclude_symbols.includes(key)
      : c.group_by === "year" ? /^\d{4}$/.test(key) : /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
    if (!valid) throw new Error("invalid slice journal group key for grouping");
  }
  return record;
}

export const BACKTEST_SLICE_JOURNAL_LIMITATIONS = [
  "local_recorded_summary_exposures_only",
  "prior_and_external_exploration_is_not_tracked",
  "research_id_is_an_exploration_namespace_not_a_preregistered_hypothesis",
  "condition_counts_do_not_prove_prespecified_selection",
  "grouped_cells_are_not_independent_trials",
  "content_hash_is_integrity_not_source_authentication",
] as const;

export interface BacktestSliceExploration {
  status: "tracked";
  research_id: string;
  artifact_id: string;
  call_count: number;
  distinct_conditions: number;
  condition_hash: string;
  sequence: number;
  recording_started_at: string;
  group_keys: string[];
  /** Cumulative grouped cells exposed, including repeated invocations; not independent trials. */
  grouped_cell_count: number;
  limitations: string[];
}

export const resolveBacktestSliceJournalPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_BACKTEST_SLICE_JOURNAL_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "backtest-slice-journal.jsonl");

/** Separate exploration namespace; recording does not register or reference a hypothesis. */
export class BacktestSliceJournalStore {
  private readonly log: AppendOnlyFirstSeenLog<SliceRecord>;

  constructor(private readonly filePath = resolveBacktestSliceJournalPath()) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "backtest slice journal", validateRecord,
      { maxFileBytes: BACKTEST_LEDGER_MAX_BYTES, maxRecordBytes: 64 * 1024 });
  }

  async recordSummary(researchId: string, summary: BacktestSliceSummary): Promise<BacktestSliceExploration> {
    identifier.parse(researchId);
    const conditions = normalizeBacktestSliceConditions(summary.filters);
    if (summary.filters.artifact_id !== summary.artifact_id) throw new Error("slice summary artifact ID mismatch");
    // Snapshot caller-owned input before waiting for the writer lock.
    const exposure = validateRecord({
      schema_version: "1.0", namespace: "backtest_slice_exploration", sequence: 1,
      observation_date: "1970-01-01", first_seen_at: "1970-01-01T00:00:00.000Z",
      research_id: researchId, artifact_id: summary.artifact_id, source_sha256: summary.source_sha256,
      conditions, condition_hash: conditionHash(conditions), ledger_records: summary.ledger_records,
      selected_records: summary.overall.records, selected_fraction: summary.selected_fraction,
      group_keys: summary.groups.map((group) => group.key).sort(),
    });
    return this.log.serialize(async () => {
      // The generic log tolerates blank lines and missing terminators. For an exposure
      // journal those can indicate a torn append, so reject them before another write.
      try {
        const body = await readBacktestLedgerFile(this.filePath, true);
        const text = body.toString("utf8");
        if (!text.endsWith("\n") || text.slice(0, -1).split("\n").some((line) => !line.trim())) {
          throw new Error("invalid slice journal JSONL framing");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const records = await this.log.readAllUnlocked();
      const artifacts = new Map<string, SliceRecord>();
      for (const record of [...records, exposure]) {
        const previous = artifacts.get(record.artifact_id);
        if (previous && (previous.source_sha256 !== record.source_sha256 || previous.ledger_records !== record.ledger_records)) {
          throw new Error("slice journal artifact metadata mismatch");
        }
        artifacts.set(record.artifact_id, record);
      }
      const prior = records.filter((record) => record.research_id === researchId && record.artifact_id === exposure.artifact_id);
      const recordedAt = new Date().toISOString();
      if (records.length && records[records.length - 1].first_seen_at > recordedAt) {
        throw new Error("slice journal clock moved backwards");
      }
      const record = validateRecord({ ...exposure, sequence: records.length + 1,
        first_seen_at: recordedAt, observation_date: recordedAt.slice(0, 10) });
      await this.log.appendUnlocked(record);
      return {
        status: "tracked", research_id: researchId, artifact_id: record.artifact_id,
        call_count: prior.length + 1,
        distinct_conditions: new Set([...prior.map((item) => item.condition_hash), record.condition_hash]).size,
        condition_hash: record.condition_hash, sequence: record.sequence,
        recording_started_at: prior[0]?.first_seen_at ?? record.first_seen_at,
        group_keys: [...record.group_keys],
        grouped_cell_count: prior.reduce((total, item) => total + item.group_keys.length, record.group_keys.length),
        limitations: [...BACKTEST_SLICE_JOURNAL_LIMITATIONS],
      };
    });
  }
}
