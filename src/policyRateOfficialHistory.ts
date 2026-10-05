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
 * The dates one downloaded file covers, from its first observation to its last (BACKLOG 102-09). The sources keep only
 * their change points, so inside the span a date the download does not list is no change: a change point stored from
 * an earlier download on that date has been withdrawn by the source. Outside the span the download says nothing, so a
 * shorter download leaves the dates it no longer reaches as they were.
 */
export type OfficialPolicyRateDownloadSpan = {
  source_url: string;
  raw_sha256: string;
  source_vintage_at: string | null;
  first_observation_date: string;
  last_observation_date: string;
};

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

/** Spans in date order, after checking them and that each observation lies in one, read from that span's file. */
function checkedSpans(spans: OfficialPolicyRateDownloadSpan[], candidates: OfficialPolicyRateHistoryRecord[]): OfficialPolicyRateDownloadSpan[] {
  if (spans.length === 0) return [];
  if (spans.length > 8) throw new Error("official policy-rate batch must name at most 8 download spans");
  const [first] = candidates;
  if (candidates.some((candidate) => candidate.currency !== first.currency || candidate.retrieved_at !== first.retrieved_at)) {
    throw new Error("official policy-rate batch with download spans must hold one currency retrieved at one time");
  }
  const sorted = [...spans].sort((left, right) => left.first_observation_date.localeCompare(right.first_observation_date));
  let priorLast: string | null = null;
  for (const span of sorted) {
    if (!validUrl(span.source_url) || typeof span.raw_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(span.raw_sha256)
      || (span.source_vintage_at !== null && (typeof span.source_vintage_at !== "string" || !isCanonicalTimestamp(span.source_vintage_at)))
      || typeof span.first_observation_date !== "string" || !isCalendarDate(span.first_observation_date)
      || typeof span.last_observation_date !== "string" || !isCalendarDate(span.last_observation_date)
      || span.first_observation_date > span.last_observation_date) throw new Error("invalid official policy-rate download span");
    if (priorLast !== null && span.first_observation_date <= priorLast) throw new Error("official policy-rate download spans overlap");
    priorLast = span.last_observation_date;
  }
  for (const candidate of candidates) {
    const span = sorted.find((item) => item.first_observation_date <= candidate.observation_date && candidate.observation_date <= item.last_observation_date);
    if (span === undefined) throw new Error(`official policy-rate observation ${candidate.observation_date} lies outside every download span`);
    if (span.raw_sha256 !== candidate.raw_sha256) throw new Error(`official policy-rate observation ${candidate.observation_date} was not read from its download span`);
  }
  return sorted;
}

export class OfficialPolicyRateHistoryStore {
  private readonly log: AppendOnlyFirstSeenLog<OfficialPolicyRateHistoryRecord>;
  private readonly rawSnapshotLog: AppendOnlyFirstSeenLog<OfficialPolicyRateRawSnapshot>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "official policy-rate", validateRecord, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
    this.rawSnapshotLog = new AppendOnlyFirstSeenLog(`${filePath}.raw-snapshots`, "official policy-rate raw snapshot", validateRawSnapshot, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  /**
   * Records the change points of one download. With the download's spans, a change point stored earlier on a date
   * inside a span that the download no longer lists is recorded as withdrawn (BACKLOG 102-09); without spans nothing is
   * withdrawn. Every record of the batch is checked before the first is written.
   */
  async observeMany(observations: OfficialPolicyRateObservation[], spans: OfficialPolicyRateDownloadSpan[] = []): Promise<{
    recorded: OfficialPolicyRateHistoryRecord[]; unchanged: number; revisions: number; reappeared: number; withdrawn: number;
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
      const downloadSpans = checkedSpans(spans, candidates);
      const records = await this.log.readAllUnlocked();
      const latestFirstSeen = records.at(-1)?.first_seen_at;
      if (latestFirstSeen && candidates.some((candidate) => candidate.first_seen_at < latestFirstSeen)) throw new Error("official policy-rate retrieval clock moved backwards");
      const latest = new Map<string, OfficialPolicyRateHistoryRecord>();
      for (const record of records) latest.set(`${record.currency}:${record.observation_date}`, record);
      const live = downloadSpans.length === 0 ? [] : latestRevisedSeries(records.filter((record) => record.currency === candidates[0].currency));
      const inSpan = (date: string) => downloadSpans.find((span) => span.first_observation_date <= date && date <= span.last_observation_date);
      // A parser lists a download's first row as a change, having nothing before it, so when a download starts later
      // than before, that row may only repeat the rate the series already holds. Against the series as it stands once
      // this batch is in (the batch's rows and the stored change points outside its spans), a row at the rate before it
      // is no change point: it is not recorded, and a stored change point on its date is withdrawn. Otherwise a shorter
      // download would leave a change point behind, withdrawn once the full download is back as if the source had
      // revised it.
      // The value alone tells a held rate: withdrawals are neither batch rows nor live, so a null is always the
      // no-single-target state. Only batch dates are looked up in `held`, so marking a stored date does nothing.
      const held = new Set<string>();
      if (downloadSpans.length > 0) {
        const series = [...candidates, ...live.filter((record) => inSpan(record.observation_date) === undefined)]
          .sort((left, right) => left.observation_date.localeCompare(right.observation_date));
        series.forEach((row, index) => { if (index > 0 && series[index - 1].value === row.value) held.add(row.observation_date); });
      }
      const recorded: OfficialPolicyRateHistoryRecord[] = [];
      let unchanged = 0;
      let revisions = 0;
      let reappeared = 0;
      let sequence = records.length;
      for (const candidate of candidates) {
        const current = latest.get(`${candidate.currency}:${candidate.observation_date}`);
        if (held.has(candidate.observation_date)) {
          // No change point; a stored one on this date is withdrawn below.
          if (current === undefined || withdrawn(current)) unchanged += 1;
          continue;
        }
        // source_vintage_at is a response-level retrieval hint. Raw snapshots retain it without
        // turning an unchanged historical observation into a spurious value revision.
        if (current?.value === candidate.value && (current.rate_status ?? "numeric") === (candidate.rate_status ?? "numeric") && current.source_url === candidate.source_url) { unchanged += 1; continue; }
        if (current !== undefined && withdrawn(current)) reappeared += 1;
        else if (current !== undefined) revisions += 1;
        recorded.push({ ...candidate, sequence: ++sequence });
      }
      let withdrawals = 0;
      if (downloadSpans.length > 0) {
        const [{ currency, retrieved_at: retrievedAt, first_seen_at: firstSeenAt }] = candidates;
        const listed = new Set(candidates.map((candidate) => candidate.observation_date).filter((date) => !held.has(date)));
        for (const record of live) {
          if (listed.has(record.observation_date)) continue;
          // The withdrawal names the file whose span holds the date.
          const span = inSpan(record.observation_date);
          if (span === undefined) continue;
          recorded.push(validateRecord({
            schema_version: "1.0", sequence: ++sequence, series: "policy_rate_official_history", evidence_tier: POLICY_RATE_OFFICIAL_HISTORY_EVIDENCE_TIER,
            currency, source_symbol: record.source_symbol, observation_date: record.observation_date, value: null, rate_status: "withdrawn",
            source_url: span.source_url, source_vintage_at: span.source_vintage_at, raw_sha256: span.raw_sha256, retrieved_at: retrievedAt, first_seen_at: firstSeenAt,
          }));
          withdrawals += 1;
        }
      }
      await this.log.assertAppendableUnlocked(records, recorded);
      for (const record of recorded) await this.log.appendUnlocked(record);
      return { recorded, unchanged, revisions, reappeared, withdrawn: withdrawals };
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
