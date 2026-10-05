import { homedir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";
import { POLICY_RATE_SYMBOLS, type PolicyRateCurrency } from "./policyRateHistory.js";

const MAX_HISTORY_BYTES = 32 * 1024 * 1024;
const MAX_RECORD_BYTES = 4_096;

export const POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER = "exploratory_revised_history" as const;

export const resolvePolicyRateOfficialHistoryPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_POLICY_RATE_OFFICIAL_HISTORY_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "policy-rate-official-revised-history.jsonl");

/**
 * A current download of an official historical series. It is intentionally separate from the
 * locally first-seen log: its retrieval timestamp says when this installation downloaded a
 * revised history, not when a trader could have known each old observation.
 */
export type OfficialPolicyRateHistoryRecord = {
  schema_version: "1.0";
  sequence: number;
  series: "policy_rate_official_history";
  evidence_tier: typeof POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER;
  currency: PolicyRateCurrency;
  source_symbol: string;
  observation_date: string;
  /**
   * null means that this policy framework has no single short-rate target to use as carry input, or, with the
   * "withdrawn" status, that a later download no longer has a change on this date (BACKLOG 102-09).
   */
  value: number | null;
  rate_status?: "numeric" | "no_single_rate_target" | "withdrawn";
  source_url: string;
  source_vintage_at: string | null;
  raw_sha256: string;
  retrieved_at: string;
  first_seen_at: string;
};

export type OfficialPolicyRateObservation = Omit<OfficialPolicyRateHistoryRecord,
  "schema_version" | "sequence" | "series" | "evidence_tier" | "first_seen_at">;

/**
 * One downloaded file and every date it gives a valid rate for, in order (BACKLOG 102-09). The sources keep only their
 * change points, so each observed date has the rate of the download's last change on or before it, and a change point
 * stored on an observed date where that rate no longer changes has been withdrawn by the source. A date the file leaves
 * out or blank is not judged, nor is any date outside it or after the retrieval day, so a missing row or a shorter
 * download leaves what is stored there as it was.
 */
export type OfficialPolicyRateDownloadSpan = {
  source_url: string;
  raw_sha256: string;
  source_vintage_at: string | null;
  observed_dates: string[];
};

const MAX_OBSERVED_DATES = 100_000;

export type OfficialPolicyRateRawSnapshot = {
  schema_version: "1.0";
  sequence: number;
  series: "policy_rate_official_raw_snapshot";
  source_id: string;
  source_url: string;
  raw_sha256: string;
  source_observation_count: number | null;
  source_first_observation_date: string | null;
  source_last_observation_date: string | null;
  raw_bytes: number;
  retrieved_at: string;
  observation_date: string;
  first_seen_at: string;
};

const validUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length < 12 || value.length > 1_500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

const validateRecord = (value: unknown, line?: number): OfficialPolicyRateHistoryRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid official policy-rate history record${suffix}`);
  const record = value as Partial<OfficialPolicyRateHistoryRecord>;
  if (record.schema_version !== "1.0" || record.series !== "policy_rate_official_history") throw new Error(`unsupported official policy-rate history schema${suffix}`);
  if (record.evidence_tier !== POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER) throw new Error(`invalid official policy-rate evidence tier${suffix}`);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) throw new Error(`invalid official policy-rate sequence${suffix}`);
  if (typeof record.currency !== "string" || !(record.currency in POLICY_RATE_SYMBOLS)) throw new Error(`invalid official policy-rate currency${suffix}`);
  if (record.source_symbol !== POLICY_RATE_SYMBOLS[record.currency as PolicyRateCurrency]) throw new Error(`invalid official policy-rate source_symbol${suffix}`);
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) throw new Error(`invalid official policy-rate observation_date${suffix}`);
  const rateStatus = record.rate_status ?? "numeric";
  if (rateStatus !== "numeric" && rateStatus !== "no_single_rate_target" && rateStatus !== "withdrawn") throw new Error(`invalid official policy-rate status${suffix}`);
  if (rateStatus === "numeric" && (typeof record.value !== "number" || !Number.isFinite(record.value) || record.value < -10 || record.value > 100)) throw new Error(`invalid official policy-rate value${suffix}`);
  if (rateStatus === "no_single_rate_target" && record.value !== null) throw new Error(`official policy-rate no-single-target state must have null value${suffix}`);
  if (rateStatus === "withdrawn" && record.value !== null) throw new Error(`official policy-rate withdrawal must have null value${suffix}`);
  if (!validUrl(record.source_url)) throw new Error(`invalid official policy-rate source_url${suffix}`);
  if (record.source_vintage_at !== null && (typeof record.source_vintage_at !== "string" || !isCanonicalTimestamp(record.source_vintage_at))) throw new Error(`invalid official policy-rate source_vintage_at${suffix}`);
  if (typeof record.raw_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.raw_sha256)) throw new Error(`invalid official policy-rate raw_sha256${suffix}`);
  if (typeof record.retrieved_at !== "string" || !isCanonicalTimestamp(record.retrieved_at)) throw new Error(`invalid official policy-rate retrieved_at${suffix}`);
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at) || record.first_seen_at !== record.retrieved_at) throw new Error(`invalid official policy-rate first_seen_at${suffix}`);
  if (record.observation_date > record.retrieved_at.slice(0, 10)) throw new Error(`official policy-rate observation_date is after retrieved_at${suffix}`);
  return record as OfficialPolicyRateHistoryRecord;
};

const validateRawSnapshot = (value: unknown, line?: number): OfficialPolicyRateRawSnapshot => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid official policy-rate raw snapshot${suffix}`);
  const record = value as Partial<OfficialPolicyRateRawSnapshot>;
  if (record.schema_version !== "1.0" || record.series !== "policy_rate_official_raw_snapshot") throw new Error(`unsupported official policy-rate raw snapshot schema${suffix}`);
  if (typeof record.source_id !== "string" || !/^[a-z0-9_]{3,80}$/.test(record.source_id)) throw new Error(`invalid official policy-rate raw snapshot source_id${suffix}`);
  if (!validUrl(record.source_url)) throw new Error(`invalid official policy-rate raw snapshot source_url${suffix}`);
  if (typeof record.raw_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.raw_sha256)) throw new Error(`invalid official policy-rate raw snapshot hash${suffix}`);
  const hasCoverage = record.source_observation_count !== undefined || record.source_first_observation_date !== undefined || record.source_last_observation_date !== undefined;
  if (hasCoverage) {
    const count = record.source_observation_count;
    const firstDate = record.source_first_observation_date;
    const lastDate = record.source_last_observation_date;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 10_000_000 || typeof firstDate !== "string" || !isCalendarDate(firstDate) || typeof lastDate !== "string" || !isCalendarDate(lastDate) || firstDate > lastDate) throw new Error(`invalid official policy-rate raw snapshot coverage${suffix}`);
  }
  if (!Number.isSafeInteger(record.raw_bytes) || (record.raw_bytes ?? 0) < 1 || (record.raw_bytes ?? 0) > 32 * 1024 * 1024) throw new Error(`invalid official policy-rate raw snapshot size${suffix}`);
  if (typeof record.retrieved_at !== "string" || !isCanonicalTimestamp(record.retrieved_at)) throw new Error(`invalid official policy-rate raw snapshot retrieved_at${suffix}`);
  if (record.observation_date !== record.retrieved_at.slice(0, 10)) throw new Error(`invalid official policy-rate raw snapshot observation_date${suffix}`);
  if (record.first_seen_at !== record.retrieved_at) throw new Error(`invalid official policy-rate raw snapshot first_seen_at${suffix}`);
  return record as OfficialPolicyRateRawSnapshot;
};

const withdrawn = (record: OfficialPolicyRateHistoryRecord): boolean => record.rate_status === "withdrawn";

/**
 * The revised series of one currency's records: the latest version of each date, without the dates whose latest version
 * is a withdrawal, in date order.
 */
export function latestRevisedSeries(records: OfficialPolicyRateHistoryRecord[]): OfficialPolicyRateHistoryRecord[] {
  const latestByDate = new Map<string, OfficialPolicyRateHistoryRecord>();
  for (const record of records) {
    const current = latestByDate.get(record.observation_date);
    if (current === undefined || record.sequence > current.sequence) latestByDate.set(record.observation_date, record);
  }
  return [...latestByDate.values()].filter((record) => !withdrawn(record))
    .sort((left, right) => left.observation_date.localeCompare(right.observation_date));
}

/**
 * The span of each observed date, after checking the spans, that they do not overlap, that each observation is an
 * observed date of the file it was read from, and that the first observed date is a change, which gives every later
 * observed date its rate.
 */
function observedDates(spans: OfficialPolicyRateDownloadSpan[], candidates: OfficialPolicyRateHistoryRecord[]): Map<string, OfficialPolicyRateDownloadSpan> {
  const observed = new Map<string, OfficialPolicyRateDownloadSpan>();
  if (spans.length === 0) return observed;
  if (spans.length > 8) throw new Error("official policy-rate batch must name at most 8 download spans");
  const [first] = candidates;
  if (candidates.some((candidate) => candidate.currency !== first.currency || candidate.retrieved_at !== first.retrieved_at)) {
    throw new Error("official policy-rate batch with download spans must hold one currency retrieved at one time");
  }
  for (const span of spans) {
    const dates: unknown = span.observed_dates;
    if (!validUrl(span.source_url) || typeof span.raw_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(span.raw_sha256)
      || (span.source_vintage_at !== null && (typeof span.source_vintage_at !== "string" || !isCanonicalTimestamp(span.source_vintage_at)))
      || !Array.isArray(dates) || dates.length < 1 || dates.length > MAX_OBSERVED_DATES
      // Array.from reads a hole as undefined, which `some` alone would skip.
      || Array.from(dates).some((date, index) => typeof date !== "string" || !isCalendarDate(date) || (index > 0 && date <= dates[index - 1]))) {
      throw new Error("invalid official policy-rate download span");
    }
  }
  const sorted = [...spans].sort((left, right) => left.observed_dates[0].localeCompare(right.observed_dates[0]));
  // A date after the retrieval day is no observation yet: SNB dates a month by its last day, so the current month would
  // otherwise turn a change found there into a record dated after it was seen.
  const retrievalDay = first.retrieved_at.slice(0, 10);
  sorted.forEach((span, index) => {
    if (index > 0 && span.observed_dates[0] <= sorted[index - 1].observed_dates.at(-1)!) throw new Error("official policy-rate download spans overlap");
    for (const date of span.observed_dates) if (date <= retrievalDay) observed.set(date, span);
  });
  for (const candidate of candidates) {
    const span = observed.get(candidate.observation_date);
    if (span === undefined) throw new Error(`official policy-rate observation ${candidate.observation_date} is no observed date of its download`);
    if (span.raw_sha256 !== candidate.raw_sha256) throw new Error(`official policy-rate observation ${candidate.observation_date} was not read from the file that observed it`);
  }
  if (!candidates.some((candidate) => candidate.observation_date === sorted[0].observed_dates[0])) throw new Error("the first observed date of an official policy-rate download must be a change");
  return observed;
}

export class OfficialPolicyRateHistoryStore {
  private readonly log: AppendOnlyFirstSeenLog<OfficialPolicyRateHistoryRecord>;
  private readonly rawSnapshotLog: AppendOnlyFirstSeenLog<OfficialPolicyRateRawSnapshot>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "official policy-rate", validateRecord, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
    this.rawSnapshotLog = new AppendOnlyFirstSeenLog(`${filePath}.raw-snapshots`, "official policy-rate raw snapshot", validateRawSnapshot, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  /**
   * Records the change points of one download. Without spans each observation is recorded unless its date already holds
   * it, and nothing is withdrawn. With the download's spans (BACKLOG 102-09) the store rebuilds the series as it stands
   * once the download is in: on each date the download observed, the rate of its last change on or before that date;
   * on every other date, the stored change points, which the download cannot judge and so are kept. The change points of
   * that series on observed dates are recorded where they differ from what is stored, and a stored change point on an
   * observed date that is no change any more is withdrawn. This also catches a change the parser compacted away across
   * a missing row, or that a download starting later only repeats. Every record is checked before the first is written.
   */
  async observeMany(observations: OfficialPolicyRateObservation[], spans: OfficialPolicyRateDownloadSpan[] = []): Promise<{
    recorded: OfficialPolicyRateHistoryRecord[]; unchanged: number; revisions: number; reappeared: number; withdrawn: number; derived: number;
  }> {
    if (observations.length < 1 || observations.length > 10_000) throw new Error("official policy-rate batch must contain 1 to 10000 observations");
    if (observations.some((observation) => observation.rate_status === "withdrawn")) throw new Error("an official policy-rate observation cannot be a withdrawal");
    return this.log.serialize(async () => {
      const candidates = observations.map((observation) => validateRecord({
        ...observation,
        schema_version: "1.0",
        sequence: 1,
        series: "policy_rate_official_history",
        evidence_tier: POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER,
        first_seen_at: new Date(observation.retrieved_at).toISOString(),
      }));
      const duplicate = new Set<string>();
      for (const candidate of candidates) {
        const key = `${candidate.currency}:${candidate.observation_date}`;
        if (duplicate.has(key)) throw new Error(`duplicate official policy-rate observation in batch ${key}`);
        duplicate.add(key);
      }
      const observed = observedDates(spans, candidates);
      const records = await this.log.readAllUnlocked();
      const latestFirstSeen = records.at(-1)?.first_seen_at;
      if (latestFirstSeen && candidates.some((candidate) => candidate.first_seen_at < latestFirstSeen)) throw new Error("official policy-rate retrieval clock moved backwards");
      const latest = new Map<string, OfficialPolicyRateHistoryRecord>();
      for (const record of records) latest.set(`${record.currency}:${record.observation_date}`, record);
      const recorded: OfficialPolicyRateHistoryRecord[] = [];
      let unchanged = 0;
      let revisions = 0;
      let reappeared = 0;
      let withdrawals = 0;
      let derived = 0;
      let sequence = records.length;
      // source_vintage_at is a response-level retrieval hint. Raw snapshots retain it without
      // turning an unchanged historical observation into a spurious value revision.
      const same = (current: OfficialPolicyRateHistoryRecord | undefined, row: OfficialPolicyRateHistoryRecord) => current?.value === row.value
        && (current.rate_status ?? "numeric") === (row.rate_status ?? "numeric") && current.source_url === row.source_url;
      const record = (current: OfficialPolicyRateHistoryRecord | undefined, row: OfficialPolicyRateHistoryRecord) => {
        if (current !== undefined && withdrawn(current)) reappeared += 1;
        else if (current !== undefined) revisions += 1;
        recorded.push(validateRecord({ ...row, sequence: ++sequence }));
      };
      if (observed.size === 0) {
        for (const candidate of candidates) {
          const current = latest.get(`${candidate.currency}:${candidate.observation_date}`);
          if (same(current, candidate)) unchanged += 1;
          else record(current, candidate);
        }
      } else {
        const [{ currency, retrieved_at: retrievedAt, first_seen_at: firstSeenAt }] = candidates;
        const listed = new Map(candidates.map((candidate) => [candidate.observation_date, candidate]));
        type Entry = { date: string; value: number | null; row: OfficialPolicyRateHistoryRecord | null; span: OfficialPolicyRateDownloadSpan | null };
        const entries: Entry[] = [];
        let row: OfficialPolicyRateHistoryRecord | undefined;
        for (const [date, span] of [...observed].sort(([left], [right]) => left.localeCompare(right))) {
          // The first observed date is a change (checked), so every observed date has the rate of a change.
          row = listed.get(date) ?? row!;
          entries.push({ date, value: row.value, row, span });
        }
        for (const stored of latestRevisedSeries(records.filter((item) => item.currency === currency))) {
          if (!observed.has(stored.observation_date)) entries.push({ date: stored.observation_date, value: stored.value, row: null, span: null });
        }
        entries.sort((left, right) => left.date.localeCompare(right.date));
        // The value alone tells a change: withdrawals are neither batch rows nor live, so a null is always the
        // no-single-target state.
        entries.forEach((entry, index) => {
          if (entry.row === null || entry.span === null) return;
          const change = index === 0 || entries[index - 1].value !== entry.value;
          const current = latest.get(`${currency}:${entry.date}`);
          const live = current !== undefined && !withdrawn(current);
          const candidate = listed.get(entry.date);
          if (!change) {
            if (live) {
              // The withdrawal names the file that observed the date.
              recorded.push(validateRecord({
                schema_version: "1.0", sequence: ++sequence, series: "policy_rate_official_history", evidence_tier: POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER,
                currency, source_symbol: current.source_symbol, observation_date: entry.date, value: null, rate_status: "withdrawn",
                source_url: entry.span.source_url, source_vintage_at: entry.span.source_vintage_at, raw_sha256: entry.span.raw_sha256, retrieved_at: retrievedAt, first_seen_at: firstSeenAt,
              }));
              withdrawals += 1;
            } else if (candidate !== undefined) unchanged += 1;
            return;
          }
          // A change the download does not list follows a stored change it kept: it carries the rate of the download's
          // last change, read from the file that observed this date.
          const point = candidate ?? {
            ...entry.row, observation_date: entry.date,
            source_url: entry.row.raw_sha256 === entry.span.raw_sha256 ? entry.row.source_url : entry.span.source_url,
            source_vintage_at: entry.span.source_vintage_at, raw_sha256: entry.span.raw_sha256,
          };
          if (same(current, point)) { if (candidate !== undefined) unchanged += 1; return; }
          if (candidate === undefined) derived += 1;
          record(current, point);
        });
      }
      await this.log.assertAppendableUnlocked(records, recorded);
      for (const item of recorded) await this.log.appendUnlocked(item);
      return { recorded, unchanged, revisions, reappeared, withdrawn: withdrawals, derived };
    });
  }

  async observeRawSnapshot(snapshot: Omit<OfficialPolicyRateRawSnapshot, "schema_version" | "sequence" | "series" | "observation_date" | "first_seen_at">) {
    return this.rawSnapshotLog.serialize(async () => {
      const candidate = validateRawSnapshot({ ...snapshot, schema_version: "1.0", sequence: 1, series: "policy_rate_official_raw_snapshot", observation_date: snapshot.retrieved_at.slice(0, 10), first_seen_at: snapshot.retrieved_at });
      const records = await this.rawSnapshotLog.readAllUnlocked();
      const existing = records.filter((record) => record.source_id === candidate.source_id && record.raw_sha256 === candidate.raw_sha256).at(-1);
      if (existing?.source_observation_count !== undefined) return { recorded: false, sequence: null };
      const latestFirstSeen = records.at(-1)?.first_seen_at;
      if (latestFirstSeen && candidate.first_seen_at < latestFirstSeen) throw new Error("official policy-rate raw snapshot clock moved backwards");
      const record = { ...candidate, sequence: records.length + 1 };
      await this.rawSnapshotLog.appendUnlocked(record);
      return { recorded: true, sequence: record.sequence };
    });
  }

  /** The last change point of the revised series. */
  async getLatest(currency: PolicyRateCurrency): Promise<OfficialPolicyRateHistoryRecord | null> {
    return (await this.getRevisedSeries(currency)).at(-1) ?? null;
  }

  /** Latest downloaded version per historical observation date, without withdrawn dates; exploratory use only. */
  async getRevisedSeries(currency: PolicyRateCurrency): Promise<OfficialPolicyRateHistoryRecord[]> {
    return this.log.serialize(async () => latestRevisedSeries((await this.log.readAllUnlocked()).filter((record) => record.currency === currency)));
  }

  async coverage() {
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const currencies = Object.fromEntries(Object.keys(POLICY_RATE_SYMBOLS).map((currency) => {
        const rows = records.filter((record) => record.currency === currency);
        const versionsByDate = new Map<string, OfficialPolicyRateHistoryRecord[]>();
        for (const record of rows) versionsByDate.set(record.observation_date, [...(versionsByDate.get(record.observation_date) ?? []), record]);
        // Each later version of a date is a withdrawal, a reappearance after one, a value revision, or metadata only.
        let valueRevisions = 0;
        let withdrawals = 0;
        let reappearances = 0;
        let metadataOnly = 0;
        for (const versions of versionsByDate.values()) {
          versions.slice(1).forEach((record, index) => {
            const prior = versions[index];
            if (withdrawn(record)) withdrawals += 1;
            else if (withdrawn(prior)) reappearances += 1;
            else if (record.value !== prior.value || (record.rate_status ?? "numeric") !== (prior.rate_status ?? "numeric")) valueRevisions += 1;
            else metadataOnly += 1;
          });
        }
        const dates = latestRevisedSeries(rows).map((record) => record.observation_date);
        return [currency, { records: rows.length, dates: dates.length, withdrawn_dates: versionsByDate.size - dates.length, revisions: valueRevisions, withdrawals, reappearances, metadata_only_versions: metadataOnly, earliest_date: dates[0] ?? null, latest_date: dates.at(-1) ?? null, last_retrieved_at: rows.at(-1)?.retrieved_at ?? null }];
      }));
      const rawSnapshots = await this.rawSnapshotLog.readAllUnlocked();
      const sourceCoverage = Object.fromEntries([...new Set(rawSnapshots.map((record) => record.source_id))].map((sourceId) => {
        const latest = rawSnapshots.filter((record) => record.source_id === sourceId).at(-1)!;
        return [sourceId, { raw_snapshots: rawSnapshots.filter((record) => record.source_id === sourceId).length, source_observation_count: latest.source_observation_count ?? null, source_first_observation_date: latest.source_first_observation_date ?? null, source_last_observation_date: latest.source_last_observation_date ?? null, coverage_status: latest.source_observation_count === undefined ? "unknown_legacy_snapshot" : "complete", latest_raw_sha256: latest.raw_sha256, latest_retrieved_at: latest.retrieved_at }];
      }));
      return { evidence_tier: POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER, records: records.length, raw_snapshots: rawSnapshots.length, source_coverage: sourceCoverage, currencies };
    });
  }
}
