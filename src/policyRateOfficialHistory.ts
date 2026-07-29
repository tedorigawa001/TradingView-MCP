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
  /** null means that this policy framework has no single short-rate target to use as carry input. */
  value: number | null;
  rate_status?: "numeric" | "no_single_rate_target";
  source_url: string;
  source_vintage_at: string | null;
  raw_sha256: string;
  retrieved_at: string;
  first_seen_at: string;
};

export type OfficialPolicyRateObservation = Omit<OfficialPolicyRateHistoryRecord,
  "schema_version" | "sequence" | "series" | "evidence_tier" | "first_seen_at">;

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
  if (rateStatus !== "numeric" && rateStatus !== "no_single_rate_target") throw new Error(`invalid official policy-rate status${suffix}`);
  if (rateStatus === "numeric" && (typeof record.value !== "number" || !Number.isFinite(record.value) || record.value < -10 || record.value > 100)) throw new Error(`invalid official policy-rate value${suffix}`);
  if (rateStatus === "no_single_rate_target" && record.value !== null) throw new Error(`official policy-rate no-single-target state must have null value${suffix}`);
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

export class OfficialPolicyRateHistoryStore {
  private readonly log: AppendOnlyFirstSeenLog<OfficialPolicyRateHistoryRecord>;
  private readonly rawSnapshotLog: AppendOnlyFirstSeenLog<OfficialPolicyRateRawSnapshot>;

  constructor(filePath: string) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "official policy-rate", validateRecord, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
    this.rawSnapshotLog = new AppendOnlyFirstSeenLog(`${filePath}.raw-snapshots`, "official policy-rate raw snapshot", validateRawSnapshot, { maxFileBytes: MAX_HISTORY_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }

  async observeMany(observations: OfficialPolicyRateObservation[]): Promise<{ recorded: OfficialPolicyRateHistoryRecord[]; unchanged: number; revisions: number }> {
    if (observations.length < 1 || observations.length > 10_000) throw new Error("official policy-rate batch must contain 1 to 10000 observations");
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
      const records = await this.log.readAllUnlocked();
      const latestFirstSeen = records.at(-1)?.first_seen_at;
      if (latestFirstSeen && candidates.some((candidate) => candidate.first_seen_at < latestFirstSeen)) throw new Error("official policy-rate retrieval clock moved backwards");
      const recorded: OfficialPolicyRateHistoryRecord[] = [];
      let unchanged = 0;
      let revisions = 0;
      let sequence = records.length;
      for (const candidate of candidates) {
        const current = records.filter((record) => record.currency === candidate.currency && record.observation_date === candidate.observation_date)
          .sort((a, b) => b.sequence - a.sequence)[0];
        // source_vintage_at is a response-level retrieval hint. Raw snapshots retain it without
        // turning an unchanged historical observation into a spurious value revision.
        if (current?.value === candidate.value && (current.rate_status ?? "numeric") === (candidate.rate_status ?? "numeric") && current.source_url === candidate.source_url) { unchanged += 1; continue; }
        if (current) revisions += 1;
        const record = { ...candidate, sequence: ++sequence };
        await this.log.appendUnlocked(record);
        records.push(record);
        recorded.push(record);
      }
      return { recorded, unchanged, revisions };
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

  async getLatest(currency: PolicyRateCurrency): Promise<OfficialPolicyRateHistoryRecord | null> {
    return this.log.serialize(async () => (await this.log.readAllUnlocked())
      .filter((record) => record.currency === currency)
      .sort((a, b) => b.observation_date.localeCompare(a.observation_date) || b.first_seen_at.localeCompare(a.first_seen_at) || b.sequence - a.sequence)[0] ?? null);
  }

  async coverage() {
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const currencies = Object.fromEntries(Object.keys(POLICY_RATE_SYMBOLS).map((currency) => {
        const rows = records.filter((record) => record.currency === currency);
        const dates = [...new Set(rows.map((record) => record.observation_date))].sort();
        const valueRevisions = dates.reduce((count, date) => {
          const versions = rows.filter((record) => record.observation_date === date).sort((left, right) => left.sequence - right.sequence);
          return count + versions.slice(1).filter((record, index) => record.value !== versions[index].value || (record.rate_status ?? "numeric") !== (versions[index].rate_status ?? "numeric")).length;
        }, 0);
        return [currency, { records: rows.length, dates: dates.length, revisions: valueRevisions, metadata_only_versions: rows.length - dates.length - valueRevisions, earliest_date: dates[0] ?? null, latest_date: dates.at(-1) ?? null, last_retrieved_at: rows.at(-1)?.retrieved_at ?? null }];
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
