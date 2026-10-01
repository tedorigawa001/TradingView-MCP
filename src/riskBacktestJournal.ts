import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BACKTEST_LEDGER_MAX_BYTES, readBacktestLedgerFile } from "./backtestLedger.js";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";
import { RISK_BACKTEST_CONTRACT, VAR_LEVELS } from "./riskForecastBacktest.js";

/**
 * The search journal of backtest_risk_forecast (docs/RISK_FORECAST_BACKTEST_DESIGN.md, "Records", D8, F5). Every call
 * is journaled, with or without a research_id, so trying weights or forecast variants until a coverage test stops
 * rejecting stays countable. The target is recorded but not counted: hits, tests and every realized-to-target ratio are
 * invariant to it.
 */
export const RISK_BACKTEST_JOURNAL_NAMESPACE = "risk_forecast_backtest_search";
export const RISK_BACKTEST_JOURNAL_MAX_BYTES = BACKTEST_LEDGER_MAX_BYTES;
export const RISK_BACKTEST_SEARCH_LIMITATIONS = [
  "local_recorded_calls_only",
  "overlap_key_is_importer_supplied_series_ids_and_read_spans",
  "retries_increment_call_counts",
] as const;

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.string().refine(isCanonicalTimestamp);
const calendarDate = z.string().refine(isCalendarDate);
const result = z.enum(["rejected", "not_rejected", "not_rejected_underpowered", "indeterminate_due_to_own_nulls"]);
const levelRecord = z.object({
  level: z.number(),
  x: z.number().int().min(0).max(5_000),
  T: z.number().int().min(0).max(5_000),
  results: z.object({ kupiec: result, independence: result, conditional_coverage: result }).strict(),
}).strict();
const forecastRecord = z.discriminatedUnion("status", [
  z.object({ status: z.literal("evaluated"), own_nulls: z.number().int().min(0).max(5_000), levels: z.array(levelRecord).length(VAR_LEVELS.length) }).strict(),
  z.object({ status: z.literal("blocked"), own_nulls: z.number().int().min(0).max(5_000) }).strict(),
]);

const recordSchema = z.object({
  schema_version: z.literal("1.0"),
  namespace: z.literal(RISK_BACKTEST_JOURNAL_NAMESPACE),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observation_date: calendarDate,
  first_seen_at: timestamp,
  contract: z.literal(RISK_BACKTEST_CONTRACT),
  research_id: identifier.nullable(),
  forecast_set_id: hash,
  proxy_set_id: hash,
  rules_sha256: hash,
  bar_series: z.array(hash).min(1).max(8),
  underlying_series_ids: z.array(identifier).min(1).max(8),
  run: z.object({ from_date: calendarDate, to_date: calendarDate }).strict(),
  span: z.object({ from: timestamp, to: timestamp }).strict(),
  a_sha256: hash,
  b_sha256: hash,
  weights: z.array(z.number().finite()).min(1).max(8),
  weights_sha256: hash,
  target: z.object({ value: z.number().finite().positive(), unit: z.enum(["log", "log_percent"]) }).strict(),
  forecasts: z.object({ a: forecastRecord, b: forecastRecord }).strict().nullable(),
  outcome: z.enum(["evaluated", "not_evaluable"]),
}).strict();
export type RiskBacktestJournalRecord = z.infer<typeof recordSchema>;
export type RiskBacktestExposure = Omit<RiskBacktestJournalRecord, "schema_version" | "namespace" | "sequence" | "observation_date"
  | "first_seen_at" | "contract" | "weights_sha256">;

export const weightsHash = (weights: readonly number[]) => `sha256:${createHash("sha256").update(JSON.stringify(weights)).digest("hex")}`;

function validateRecord(value: unknown): RiskBacktestJournalRecord {
  const record = recordSchema.parse(value);
  const n = record.underlying_series_ids.length;
  if (record.bar_series.length !== n || record.weights.length !== n) throw new Error("risk backtest journal series lengths differ");
  if (record.weights_sha256 !== weightsHash(record.weights)) throw new Error("risk backtest journal weights hash mismatch");
  if (record.run.from_date > record.run.to_date || !(record.span.from < record.span.to)
    || record.observation_date !== record.first_seen_at.slice(0, 10)) {
    throw new Error("invalid risk backtest journal dates or span");
  }
  if ((record.outcome === "evaluated") !== (record.forecasts !== null)) throw new Error("risk backtest journal outcome and forecasts disagree");
  return record;
}

export const resolveRiskBacktestJournalPath = (configuredPath = process.env.TRADINGVIEW_MCP_RISK_BACKTEST_JOURNAL_PATH): string =>
  configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "risk-backtest-journal.jsonl");

/** Records sharing an underlying series ID whose read span overlaps [from, to), half-open. */
function overlapping(records: RiskBacktestJournalRecord[], seriesIds: readonly string[], span: { from: string; to: string }) {
  return records.filter((r) => r.underlying_series_ids.some((id) => seriesIds.includes(id)) && r.span.from < span.to && span.from < r.span.to);
}

/**
 * Per level, the calls with at least one evaluated forecast in which no test of an evaluated forecast was rejected. A
 * not-evaluable call, or one with both forecasts blocked, is never counted.
 */
function noRejection(records: RiskBacktestJournalRecord[]) {
  return VAR_LEVELS.map(({ level }, l) => ({
    level,
    calls: records.filter((r) => {
      if (r.forecasts === null) return false;
      const evaluated = [r.forecasts.a, r.forecasts.b].filter((f) => f.status === "evaluated");
      return evaluated.length > 0 && evaluated.every((f) => f.status === "evaluated"
        && Object.values(f.levels[l].results).every((outcome) => outcome !== "rejected"));
    }).length,
  }));
}

export interface RiskBacktestSearch {
  this_research_id: { status: "untracked" } | {
    calls: number; distinct_weight_vectors: number; distinct_a: number; distinct_b: number;
    earlier_no_rejection: { level: number; calls: number }[];
  };
  overlapping_data: {
    calls: number; untracked_calls: number; distinct_research_ids: number; distinct_weight_vectors: number; distinct_forecast_hashes: number;
    earlier_no_rejection: { level: number; calls: number }[];
  };
  limitations: string[];
}

/** The search over the overlap set, this call (the last record) included; earlier_no_rejection excludes it. */
export function searchOf(records: RiskBacktestJournalRecord[], current: RiskBacktestJournalRecord): RiskBacktestSearch {
  const overlap = overlapping(records, current.underlying_series_ids, current.span);
  const earlier = overlap.filter((r) => r.sequence !== current.sequence);
  const distinct = (values: string[]) => new Set(values).size;
  const own = current.research_id === null ? null : overlap.filter((r) => r.research_id === current.research_id);
  return {
    this_research_id: own === null ? { status: "untracked" } : {
      calls: own.length,
      distinct_weight_vectors: distinct(own.map((r) => r.weights_sha256)),
      distinct_a: distinct(own.map((r) => r.a_sha256)),
      distinct_b: distinct(own.map((r) => r.b_sha256)),
      earlier_no_rejection: noRejection(own.filter((r) => r.sequence !== current.sequence)),
    },
    overlapping_data: {
      calls: overlap.length,
      untracked_calls: overlap.filter((r) => r.research_id === null).length,
      distinct_research_ids: distinct(overlap.flatMap((r) => (r.research_id === null ? [] : [r.research_id]))),
      distinct_weight_vectors: distinct(overlap.map((r) => r.weights_sha256)),
      distinct_forecast_hashes: distinct(overlap.flatMap((r) => [r.a_sha256, r.b_sha256])),
      earlier_no_rejection: noRejection(earlier),
    },
    limitations: [...RISK_BACKTEST_SEARCH_LIMITATIONS],
  };
}

export class RiskBacktestJournalStore {
  private readonly log: AppendOnlyFirstSeenLog<RiskBacktestJournalRecord>;

  constructor(private readonly filePath = resolveRiskBacktestJournalPath()) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "risk backtest journal", validateRecord,
      { maxFileBytes: RISK_BACKTEST_JOURNAL_MAX_BYTES, maxRecordBytes: 16 * 1024 });
  }

  /** Strict framing, as the other journals; a missing file holds no records. */
  private async readChecked(): Promise<RiskBacktestJournalRecord[]> {
    try {
      const text = (await readBacktestLedgerFile(this.filePath, true)).toString("utf8");
      if (!text.endsWith("\n") || text.slice(0, -1).split("\n").some((line) => !line.trim())) {
        throw new Error("invalid risk backtest journal JSONL framing");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return this.log.readAllUnlocked();
  }

  /** Appends one record and returns the search over the overlap set, this call included. */
  async record(exposure: RiskBacktestExposure): Promise<{ sequence: number; recorded_at: string; search: RiskBacktestSearch }> {
    const draft = validateRecord({
      schema_version: "1.0", namespace: RISK_BACKTEST_JOURNAL_NAMESPACE, sequence: 1, observation_date: "1970-01-01",
      first_seen_at: "1970-01-01T00:00:00.000Z", contract: RISK_BACKTEST_CONTRACT, ...exposure, weights_sha256: weightsHash(exposure.weights),
    });
    return this.log.serialize(async () => {
      const records = await this.readChecked();
      const recordedAt = new Date().toISOString();
      if (records.length && records[records.length - 1].first_seen_at > recordedAt) throw new Error("risk backtest journal clock moved backwards");
      const record = validateRecord({ ...draft, sequence: records.length + 1, first_seen_at: recordedAt, observation_date: recordedAt.slice(0, 10) });
      await this.log.appendUnlocked(record);
      return { sequence: record.sequence, recorded_at: recordedAt, search: searchOf([...records, record], record) };
    });
  }
}
