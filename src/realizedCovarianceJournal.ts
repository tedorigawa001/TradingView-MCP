import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BACKTEST_LEDGER_MAX_BYTES, readBacktestLedgerFile } from "./backtestLedger.js";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";
import { REALIZED_COVARIANCE_ALGORITHM } from "./realizedCovariance.js";
import { hashRules, realizedCovarianceRulesSchema } from "./realizedCovarianceRules.js";

/**
 * The computation journal of compute_realized_covariance (docs/REALIZED_COVARIANCE_DESIGN.md, "Records";
 * design F8, G6, H2). Every call is journaled, with or without a research_id, so rule shopping and bar
 * re-imports stay countable. The proxy-set verification (D12) requires a record naming the proxy set.
 */
export const REALIZED_COVARIANCE_JOURNAL_NAMESPACE = "realized_covariance_computation";
/** Capped at the framing reader's limit, as in the forecast-loss journal (code review L6). */
export const REALIZED_COVARIANCE_JOURNAL_MAX_BYTES = BACKTEST_LEDGER_MAX_BYTES;
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.string().refine(isCanonicalTimestamp);
const calendarDate = z.string().refine(isCalendarDate);

const recordSchema = z.object({
  schema_version: z.literal("1.0"),
  namespace: z.literal(REALIZED_COVARIANCE_JOURNAL_NAMESPACE),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observation_date: calendarDate,
  first_seen_at: timestamp,
  algorithm_version: z.literal(REALIZED_COVARIANCE_ALGORITHM),
  rules: realizedCovarianceRulesSchema,
  rules_sha256: hash,
  bar_series: z.array(hash).min(1).max(8),
  underlying_series_ids: z.array(identifier).min(1).max(8),
  from_date: calendarDate,
  to_date: calendarDate,
  proxy_set_id: hash,
  research_id: identifier.nullable(),
  tzdata: z.string().min(1).max(64),
  kept_days: z.number().int().min(0).max(5_000),
  dropped_days: z.number().int().min(0).max(5_000),
  envelope: z.object({ from: timestamp, to: timestamp }).strict(),
}).strict();
export type RealizedCovarianceJournalRecord = z.infer<typeof recordSchema>;
export type RealizedCovarianceExposure = Omit<RealizedCovarianceJournalRecord,
  "schema_version" | "namespace" | "sequence" | "observation_date" | "first_seen_at" | "algorithm_version">;

function validateRecord(value: unknown): RealizedCovarianceJournalRecord {
  const record = recordSchema.parse(value);
  if (record.rules_sha256 !== hashRules(record.rules)) throw new Error("realized covariance journal rules hash mismatch");
  if (record.bar_series.length !== record.underlying_series_ids.length) throw new Error("realized covariance journal series lengths differ");
  if (!(record.envelope.from < record.envelope.to) || record.from_date > record.to_date
    || record.observation_date !== record.first_seen_at.slice(0, 10)) {
    throw new Error("invalid realized covariance journal envelope or dates");
  }
  return record;
}

/**
 * H2: a proxy_set_id recorded twice must agree on these fields. research_id and tzdata may differ: the
 * same computation under another research ID, or after a tzdata update that resolves the same boundaries.
 */
const identity = (r: RealizedCovarianceJournalRecord) => JSON.stringify([r.algorithm_version, r.rules_sha256, r.bar_series,
  r.underlying_series_ids, r.from_date, r.to_date, r.envelope, r.kept_days, r.dropped_days]);

export interface RealizedCovarianceSearch {
  calls: number;
  distinct_rules: number;
  distinct_bar_series_versions: number;
}

export const resolveRealizedCovarianceJournalPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_REALIZED_COVARIANCE_JOURNAL_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "realized-covariance-journal.jsonl");

/** Records sharing an underlying series ID whose envelope overlaps [from, to), half-open. */
function overlapping(records: RealizedCovarianceJournalRecord[], seriesIds: string[], envelope: { from: string; to: string }) {
  return records.filter((r) => r.underlying_series_ids.some((id) => seriesIds.includes(id))
    && r.envelope.from < envelope.to && envelope.from < r.envelope.to);
}
const count = (records: RealizedCovarianceJournalRecord[]): RealizedCovarianceSearch => ({
  calls: records.length,
  distinct_rules: new Set(records.map((r) => r.rules_sha256)).size,
  distinct_bar_series_versions: new Set(records.map((r) => JSON.stringify(r.bar_series))).size,
});

export class RealizedCovarianceJournalStore {
  private readonly log: AppendOnlyFirstSeenLog<RealizedCovarianceJournalRecord>;

  constructor(private readonly filePath = resolveRealizedCovarianceJournalPath()) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "realized covariance journal", validateRecord,
      { maxFileBytes: REALIZED_COVARIANCE_JOURNAL_MAX_BYTES, maxRecordBytes: 16 * 1024 });
  }

  private async readChecked(): Promise<RealizedCovarianceJournalRecord[]> {
    try {
      const text = (await readBacktestLedgerFile(this.filePath, true)).toString("utf8");
      if (!text.endsWith("\n") || text.slice(0, -1).split("\n").some((line) => !line.trim())) {
        throw new Error("invalid realized covariance journal JSONL framing");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return this.log.readAllUnlocked();
  }

  /** Appends one record and returns the search over the overlap set, this call included. */
  async record(exposure: RealizedCovarianceExposure): Promise<{ sequence: number; recorded_at: string; search: RealizedCovarianceSearch }> {
    const draft = validateRecord({
      schema_version: "1.0", namespace: REALIZED_COVARIANCE_JOURNAL_NAMESPACE, sequence: 1,
      observation_date: "1970-01-01", first_seen_at: "1970-01-01T00:00:00.000Z",
      algorithm_version: REALIZED_COVARIANCE_ALGORITHM, ...exposure,
    });
    return this.log.serialize(async () => {
      const records = await this.readChecked();
      for (const previous of records) {
        if (previous.proxy_set_id === draft.proxy_set_id && identity(previous) !== identity(draft)) {
          throw new Error("realized covariance journal proxy set metadata mismatch");
        }
      }
      const recordedAt = new Date().toISOString();
      if (records.length && records[records.length - 1].first_seen_at > recordedAt) {
        throw new Error("realized covariance journal clock moved backwards");
      }
      const record = validateRecord({ ...draft, sequence: records.length + 1, first_seen_at: recordedAt, observation_date: recordedAt.slice(0, 10) });
      await this.log.appendUnlocked(record);
      return { sequence: record.sequence, recorded_at: recordedAt,
        search: count(overlapping([...records, record], record.underlying_series_ids, record.envelope)) };
    });
  }

  /** Every record naming this proxy set, oldest first (the D12 verification). */
  async findByProxySetId(proxySetId: string): Promise<RealizedCovarianceJournalRecord[]> {
    hash.parse(proxySetId);
    return this.log.serialize(async () => (await this.readChecked()).filter((r) => r.proxy_set_id === proxySetId));
  }

  /** Read-only counts over records sharing a series ID with an overlapping envelope (compare_forecast_losses). */
  async search(seriesIds: string[], envelope: { from: string; to: string }): Promise<RealizedCovarianceSearch> {
    return this.log.serialize(async () => count(overlapping(await this.readChecked(), seriesIds, envelope)));
  }
}
