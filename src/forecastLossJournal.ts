import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BACKTEST_LEDGER_MAX_BYTES, readBacktestLedgerFile } from "./backtestLedger.js";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";
import { BATTERY_OUTCOMES, FORECAST_LOSS_CONTRACT, type BatteryOutcome, type ForecastLoss } from "./forecastLossComparison.js";
import { FORECAST_SET_MAX_DIMENSION, forecastSetComponentHashes, type ForecastSet } from "./forecastSet.js";
import type { OverlappedForwardPeriodDeclarations, ResearchPeriodUsageAssessment } from "./researchPeriodUsage.js";

export const FORECAST_LOSS_JOURNAL_NAMESPACE = "forecast_loss_comparison_exploration";
/**
 * The framing check reads through readBacktestLedgerFile, which is capped at the ledger limit, so the
 * log's own cap must not exceed it: a larger cap let one append cross the reader's limit and fail
 * every later call (code review L6).
 */
export const FORECAST_LOSS_JOURNAL_MAX_BYTES = BACKTEST_LEDGER_MAX_BYTES;
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const optionalHash = z.union([hash, z.literal("absent")]);
const timestamp = z.string().refine(isCanonicalTimestamp);

const recordSchema = z.object({
  schema_version: z.literal("1.0"),
  namespace: z.literal(FORECAST_LOSS_JOURNAL_NAMESPACE),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  observation_date: z.string().refine(isCalendarDate),
  first_seen_at: timestamp,
  contract: z.literal(FORECAST_LOSS_CONTRACT),
  loss: z.enum(["qlike", "mse"]),
  research_id: identifier,
  artifact_id: hash,
  component_hashes: z.object({
    dates: hash, a: hash, b: hash, primary: hash, secondary: optionalHash, labels: optionalHash,
  }).strict(),
  source_hash: hash,
  underlying_series_ids: z.array(identifier).min(1).max(FORECAST_SET_MAX_DIMENSION),
  envelope: z.object({ from: timestamp, to: timestamp }).strict(),
  battery_outcome: z.enum(BATTERY_OUTCOMES),
}).strict();
type JournalRecord = z.infer<typeof recordSchema>;

function validateRecord(value: unknown): JournalRecord {
  const record = recordSchema.parse(value);
  const ids = record.underlying_series_ids;
  if (JSON.stringify(ids) !== JSON.stringify([...new Set(ids)].sort())) {
    throw new Error("forecast loss journal series IDs must be sorted and unique");
  }
  if (!(record.envelope.from < record.envelope.to) || record.observation_date !== record.first_seen_at.slice(0, 10)) {
    throw new Error("invalid forecast loss journal envelope or date");
  }
  return record;
}

/** The evaluation envelope: the earliest window start to the latest window end, over every date, dropped ones included. */
export function forecastSetEnvelope(set: ForecastSet): { from: string; to: string } {
  return {
    from: set.windows.reduce((min, w) => (w.from < min ? w.from : min), set.windows[0].from),
    to: set.windows.reduce((max, w) => (w.to > max ? w.to : max), set.windows[0].to),
  };
}

export const FORECAST_LOSS_JOURNAL_LIMITATIONS = [
  "local_recorded_calls_only",
  "prior_and_external_exploration_is_not_tracked",
  "research_id_is_an_exploration_namespace_not_a_preregistered_hypothesis",
  "overlap_key_is_caller_supplied_series_ids_and_windows",
  "retries_increment_call_counts",
  "content_hash_is_integrity_not_source_authentication",
] as const;

export interface ForecastLossExposure {
  research_id: string;
  artifact_id: string;
  set: ForecastSet;
  loss: ForecastLoss;
  battery_outcome: BatteryOutcome;
}

export interface ForecastLossSearch {
  status: "tracked";
  research_id: string;
  sequence: number;
  recorded_at: string;
  /** This research_id across all artifacts; counts include this call, `earlier_*` counts do not. */
  this_research_id: {
    calls: number;
    distinct_a_for_same_b_primary_dates: number;
    distinct_label_sets: number;
    distinct_secondaries: number;
    distinct_losses: number;
    earlier_no_listed_conflict: number;
  };
  /**
   * Every research_id, keyed by data rather than by exact hash: records sharing an underlying series
   * ID with this call whose envelope overlaps this call's. The set includes this call.
   */
  overlapping_data: {
    key: "shared_underlying_series_id_and_envelope_overlap";
    calls: number;
    distinct_research_ids: number;
    earlier_no_listed_conflict: number;
    distinct_unordered_ab_pairs: number;
    distinct_b: number;
    distinct_dates: number;
    distinct_primary: number;
  };
  limitations: string[];
}

export const resolveForecastLossJournalPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_FORECAST_LOSS_JOURNAL_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "forecast-loss-journal.jsonl");

const distinct = <T>(records: T[], key: (record: T) => string) => new Set(records.map(key)).size;
const overlaps = (x: JournalRecord, y: JournalRecord) =>
  x.underlying_series_ids.some((id) => y.underlying_series_ids.includes(id))
  && x.envelope.from < y.envelope.to && y.envelope.from < x.envelope.to;

/** Separate exploration namespace; recording does not register or reference a hypothesis. */
export class ForecastLossJournalStore {
  private readonly log: AppendOnlyFirstSeenLog<JournalRecord>;

  constructor(private readonly filePath = resolveForecastLossJournalPath()) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "forecast loss journal", validateRecord,
      { maxFileBytes: FORECAST_LOSS_JOURNAL_MAX_BYTES, maxRecordBytes: 16 * 1024 });
  }

  async record(exposure: ForecastLossExposure): Promise<ForecastLossSearch> {
    const components = forecastSetComponentHashes(exposure.set);
    const draft = validateRecord({
      schema_version: "1.0", namespace: FORECAST_LOSS_JOURNAL_NAMESPACE, sequence: 1,
      observation_date: "1970-01-01", first_seen_at: "1970-01-01T00:00:00.000Z",
      contract: FORECAST_LOSS_CONTRACT, loss: exposure.loss, research_id: exposure.research_id,
      artifact_id: exposure.artifact_id,
      component_hashes: { dates: components.dates, a: components.a, b: components.b, primary: components.primary,
        secondary: components.secondary, labels: components.labels },
      source_hash: components.source,
      underlying_series_ids: [...exposure.set.underlying_series_ids].sort(),
      envelope: forecastSetEnvelope(exposure.set),
      battery_outcome: exposure.battery_outcome,
    });
    return this.log.serialize(async () => {
      try {
        const text = (await readBacktestLedgerFile(this.filePath, true)).toString("utf8");
        if (!text.endsWith("\n") || text.slice(0, -1).split("\n").some((line) => !line.trim())) {
          throw new Error("invalid forecast loss journal JSONL framing");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const records = await this.log.readAllUnlocked();
      // One artifact ID names one content: a record that disagrees means the journal or a hash is wrong.
      const describe = (r: JournalRecord) => JSON.stringify([r.component_hashes, r.source_hash, r.underlying_series_ids, r.envelope]);
      const artifacts = new Map<string, string>();
      for (const record of [...records, draft]) {
        const previous = artifacts.get(record.artifact_id);
        if (previous !== undefined && previous !== describe(record)) throw new Error("forecast loss journal artifact metadata mismatch");
        artifacts.set(record.artifact_id, describe(record));
      }
      const recordedAt = new Date().toISOString();
      if (records.length && records[records.length - 1].first_seen_at > recordedAt) {
        throw new Error("forecast loss journal clock moved backwards");
      }
      const record = validateRecord({ ...draft, sequence: records.length + 1,
        first_seen_at: recordedAt, observation_date: recordedAt.slice(0, 10) });
      await this.log.appendUnlocked(record);
      return search(records, record);
    });
  }
}

function search(earlier: JournalRecord[], current: JournalRecord): ForecastLossSearch {
  const c = current.component_hashes;
  const own = [...earlier.filter((r) => r.research_id === current.research_id), current];
  const sameBase = own.filter((r) => r.component_hashes.b === c.b && r.component_hashes.primary === c.primary
    && r.component_hashes.dates === c.dates);
  const overlapping = [...earlier.filter((r) => overlaps(r, current)), current];
  const listedPass = (r: JournalRecord) => r.battery_outcome === "no_listed_conflict";
  return {
    status: "tracked",
    research_id: current.research_id,
    sequence: current.sequence,
    recorded_at: current.first_seen_at,
    this_research_id: {
      calls: own.length,
      distinct_a_for_same_b_primary_dates: distinct(sameBase, (r) => r.component_hashes.a),
      distinct_label_sets: distinct(own, (r) => r.component_hashes.labels),
      distinct_secondaries: distinct(own, (r) => r.component_hashes.secondary),
      distinct_losses: distinct(own, (r) => r.loss),
      earlier_no_listed_conflict: own.slice(0, -1).filter(listedPass).length,
    },
    overlapping_data: {
      key: "shared_underlying_series_id_and_envelope_overlap",
      calls: overlapping.length,
      distinct_research_ids: distinct(overlapping, (r) => r.research_id),
      earlier_no_listed_conflict: overlapping.slice(0, -1).filter(listedPass).length,
      distinct_unordered_ab_pairs: distinct(overlapping, (r) => [r.component_hashes.a, r.component_hashes.b].sort().join("|")),
      distinct_b: distinct(overlapping, (r) => r.component_hashes.b),
      distinct_dates: distinct(overlapping, (r) => r.component_hashes.dates),
      distinct_primary: distinct(overlapping, (r) => r.component_hashes.primary),
    },
    limitations: [...FORECAST_LOSS_JOURNAL_LIMITATIONS],
  };
}

export const PRIOR_OVERLAP_RESEARCH_ID_CAP = 100;

/**
 * The period records' prior_overlap in summary form (design P3): counts per series ID, with the
 * forecast-set-source record as its own entry, and the union of research IDs across the records.
 * Each assessment carries at most its first 100 matches, so the union is flagged truncated when any
 * record's matches were, and when the union itself exceeds the returned cap.
 */
/**
 * Per series, the forward period declarations the record overlaps (docs/FORWARD_PERIOD_DESIGN.md, D6), from the
 * record's exact counts, never from the listed entries. Unknown stays unavailable, and an absent field omits the
 * column.
 */
function activeDeclarations(overlapped: OverlappedForwardPeriodDeclarations | undefined) {
  if (overlapped === undefined) return {};
  if (overlapped.status === "unavailable") return { active_forward_period_declarations: overlapped };
  const { other_research, declaring_research_exploration, declaring_research_validation } = overlapped.by_relation;
  return { active_forward_period_declarations: { declared_by_this_research: declaring_research_exploration + declaring_research_validation,
    declared_by_other_research: other_research } };
}

export function summarizePriorOverlap(records: { series_id: string; prior_overlap: ResearchPeriodUsageAssessment;
  overlapped_forward_period_declarations?: OverlappedForwardPeriodDeclarations }[]) {
  const union = new Set(records.flatMap((record) => record.prior_overlap.matches.map((match) => match.research_id)));
  const ids = [...union].sort();
  const overlapsDeclaration = records.some((record) => record.overlapped_forward_period_declarations?.status === "available"
    && record.overlapped_forward_period_declarations.total > 0);
  return {
    scope: "prior_recorded_access_reports" as const,
    per_series: records.map(({ series_id, prior_overlap: p, overlapped_forward_period_declarations: overlapped }) => ({
      series_id, status: p.status, overlapping_records: p.overlapping_records,
      exploration_records: p.exploration_records, validation_records: p.validation_records, ...activeDeclarations(overlapped),
    })),
    overlapping_research_ids: ids.slice(0, PRIOR_OVERLAP_RESEARCH_ID_CAP),
    overlapping_research_ids_seen: ids.length,
    overlapping_research_ids_truncated: records.some((record) => record.prior_overlap.truncated)
      || ids.length > PRIOR_OVERLAP_RESEARCH_ID_CAP,
    limitations: [...new Set([...records.flatMap((record) => record.prior_overlap.limitations),
      ...(overlapsDeclaration ? ["access_overlaps_a_declared_forward_period"] : []),
      "summary_omits_matching_records_use_full_check_for_detail"])],
  };
}
