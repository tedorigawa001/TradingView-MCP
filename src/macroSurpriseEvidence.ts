import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isCanonicalTimestamp } from "./firstSeenStore.js";
import { noFollowFlag, posixModeEnforced } from "./fsDurability.js";

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 4_096;
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 60_000;
const ACTUAL_CAPTURE_WINDOW_MS = 15 * 60_000;

export type MacroSurpriseEventKind = "us_cpi" | "us_nfp" | "fomc_statement";
export type MacroSurpriseMetricId = "us_cpi_all_items_yoy_percent" | "us_nfp_total_nonfarm_change_thousands" | "fomc_target_rate_midpoint_percent";
export type MacroSurpriseRole = "consensus" | "actual";

export const MACRO_SURPRISE_DATA_CONTRACT_V1 = {
  contract_id: "us_macro_surprise_evidence_v1",
  event_kinds: ["us_cpi", "us_nfp", "fomc_statement"],
  metric_by_event_kind: {
    us_cpi: "us_cpi_all_items_yoy_percent",
    us_nfp: "us_nfp_total_nonfarm_change_thousands",
    fomc_statement: "fomc_target_rate_midpoint_percent",
  },
  consensus_availability: "locally_first_seen_strictly_before_official_release",
  actual_availability: "locally_first_seen_from_official_release_through_15_minutes_after_release",
  historical_provider_exports: "exploratory_only_not_accepted_by_this_forward_store",
  surprise: "actual_minus_consensus_in_the_fixed_metric_unit",
} as const;

const METRIC_BY_KIND: Record<MacroSurpriseEventKind, MacroSurpriseMetricId> = MACRO_SURPRISE_DATA_CONTRACT_V1.metric_by_event_kind;

export const resolveMacroSurpriseEvidencePath = (
  configuredPath = process.env.TRADINGVIEW_MCP_MACRO_SURPRISE_EVIDENCE_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "macro-surprise-first-seen.jsonl");

export const resolveMacroSurpriseRawArchivePath = (
  configuredPath = process.env.TRADINGVIEW_MCP_MACRO_SURPRISE_RAW_ARCHIVE_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "macro-surprise-raw");

export type MacroSurpriseEvidenceRecord = {
  schema_version: "1.0";
  sequence: number;
  series: "macro_surprise_evidence";
  event_id: string;
  event_kind: MacroSurpriseEventKind;
  occurred_at: string;
  metric_id: MacroSurpriseMetricId;
  role: MacroSurpriseRole;
  value: number;
  source_id: string;
  source_url: string;
  raw_sha256: string;
  first_seen_at: string;
};

export type MacroSurpriseObservation = Omit<MacroSurpriseEvidenceRecord, "schema_version" | "sequence" | "series" | "first_seen_at"> & {
};

type EligibleMacroSurprise = {
  event_id: string;
  event_kind: MacroSurpriseEventKind;
  occurred_at: string;
  metric_id: MacroSurpriseMetricId;
  consensus: Pick<MacroSurpriseEvidenceRecord, "value" | "source_id" | "source_url" | "raw_sha256" | "first_seen_at">;
  actual: Pick<MacroSurpriseEvidenceRecord, "value" | "source_id" | "source_url" | "raw_sha256" | "first_seen_at">;
  surprise: number;
  evidence_tier: "forward_first_seen";
};

const validHash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const validSourceId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9_]{3,80}$/.test(value);
const validUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 1_500) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};
const validEventId = (value: unknown): value is string => typeof value === "string" && /^(us_cpi|us_nfp|fomc_statement):\d{4}-\d{2}-\d{2}$/.test(value);

/** The store, not just a collector, owns the boundary between a provider forecast and official actual. */
export function assertOfficialMacroActualSource(input: Pick<MacroSurpriseEvidenceRecord, "event_id" | "event_kind" | "source_id" | "source_url">): void {
  const date = input.event_id.slice(input.event_id.indexOf(":") + 1);
  const compactYmd = date.replaceAll("-", "");
  const compactMdy = `${date.slice(5, 7)}${date.slice(8, 10)}${date.slice(0, 4)}`;
  let url: URL;
  try { url = new URL(input.source_url); } catch { throw new Error("macro-surprise actual official source provenance is invalid"); }
  const isBls = url.protocol === "https:" && url.host === "www.bls.gov" && !url.search && !url.hash;
  const isFed = url.protocol === "https:" && url.host === "www.federalreserve.gov" && !url.search && !url.hash;
  if (input.event_kind === "us_cpi" && input.source_id === "bls_official" && isBls && url.pathname === `/news.release/archives/cpi_${compactMdy}.htm`) return;
  if (input.event_kind === "us_nfp" && input.source_id === "bls_official" && isBls && url.pathname === `/news.release/archives/empsit_${compactMdy}.htm`) return;
  if (input.event_kind === "fomc_statement" && input.source_id === "federal_reserve_official" && isFed && url.pathname === `/newsevents/pressreleases/monetary${compactYmd}a.htm`) return;
  throw new Error("macro-surprise actual official source provenance is invalid");
}

function validateRecord(value: unknown, line?: number): MacroSurpriseEvidenceRecord {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid macro-surprise evidence record${suffix}`);
  const record = value as Partial<MacroSurpriseEvidenceRecord>;
  if (record.schema_version !== "1.0" || record.series !== "macro_surprise_evidence") throw new Error(`unsupported macro-surprise evidence schema${suffix}`);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) throw new Error(`invalid macro-surprise evidence sequence${suffix}`);
  if (!validEventId(record.event_id) || record.event_id.slice(0, record.event_id.indexOf(":")) !== record.event_kind) throw new Error(`invalid macro-surprise event identity${suffix}`);
  if (record.event_kind !== "us_cpi" && record.event_kind !== "us_nfp" && record.event_kind !== "fomc_statement") throw new Error(`invalid macro-surprise event kind${suffix}`);
  if (typeof record.occurred_at !== "string" || !isCanonicalTimestamp(record.occurred_at)) throw new Error(`invalid macro-surprise release timestamp${suffix}`);
  if (record.metric_id !== METRIC_BY_KIND[record.event_kind]) throw new Error(`invalid macro-surprise metric for event kind${suffix}`);
  if (record.role !== "consensus" && record.role !== "actual") throw new Error(`invalid macro-surprise evidence role${suffix}`);
  if (typeof record.value !== "number" || !Number.isFinite(record.value) || Math.abs(record.value) > 1_000_000) throw new Error(`invalid macro-surprise value${suffix}`);
  if (!validSourceId(record.source_id) || !validUrl(record.source_url) || !validHash(record.raw_sha256)) throw new Error(`invalid macro-surprise source provenance${suffix}`);
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) throw new Error(`invalid macro-surprise first_seen_at${suffix}`);
  const releaseMs = Date.parse(record.occurred_at);
  const observedMs = Date.parse(record.first_seen_at);
  if (record.role === "consensus" && observedMs >= releaseMs) throw new Error(`macro-surprise consensus was not observed before release${suffix}`);
  if (record.role === "actual" && (observedMs < releaseMs || observedMs > releaseMs + ACTUAL_CAPTURE_WINDOW_MS)) throw new Error(`macro-surprise actual was not observed in the release capture window${suffix}`);
  if (record.role === "actual") assertOfficialMacroActualSource(record as MacroSurpriseEvidenceRecord);
  return record as MacroSurpriseEvidenceRecord;
}

async function ensureOwnerDirectory(directory: string, label: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} directory must be a regular directory`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`${label} directory must be owned by the current user`);
  if ((posixModeEnforced() && (stat.mode & 0o077) !== 0)) throw new Error(`${label} directory permissions must not allow group or other access`);
}

/** Raw provider payloads are kept independently of the normalized values they support. */
export class MacroSurpriseRawArchive {
  constructor(private readonly directory: string) { if (!directory) throw new Error("macro-surprise raw archive path is required"); }

  async store(rawSha256: string, raw: string | Buffer): Promise<{ stored: boolean; bytes: number }> {
    if (!validHash(rawSha256)) throw new Error("macro-surprise raw archive requires a SHA-256 key");
    const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    if (body.byteLength < 1 || body.byteLength > MAX_RAW_BYTES) throw new Error("macro-surprise raw archive payload size is unsafe");
    if (`sha256:${createHash("sha256").update(body).digest("hex")}` !== rawSha256) throw new Error("macro-surprise raw archive hash does not match payload");
    await ensureOwnerDirectory(this.directory, "macro-surprise raw archive");
    const path = join(this.directory, `${rawSha256.slice(7)}.raw`);
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
      try { const written = await handle.write(body); if (written.bytesWritten !== body.byteLength) throw new Error("short write to macro-surprise raw archive"); await handle.sync(); } finally { await handle.close(); }
      return { stored: true, bytes: body.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || stat.size !== body.byteLength || (posixModeEnforced() && (stat.mode & 0o077) !== 0)) throw new Error("macro-surprise raw archive existing payload is unsafe");
      const existing = await readFile(path);
      if (`sha256:${createHash("sha256").update(existing).digest("hex")}` !== rawSha256) throw new Error("macro-surprise raw archive existing payload hash does not match");
      return { stored: false, bytes: body.byteLength };
    }
  }
}

export class MacroSurpriseEvidenceStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string, private readonly now: () => Date = () => new Date()) { if (!filePath) throw new Error("macro-surprise evidence path is required"); }

  private async readUnlocked(): Promise<MacroSurpriseEvidenceRecord[]> {
    try {
      const stat = await lstat(this.filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || (posixModeEnforced() && (stat.mode & 0o077) !== 0) || stat.size > MAX_HISTORY_BYTES) throw new Error("macro-surprise evidence path is unsafe");
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const text = await readFile(this.filePath, "utf8");
    const records = text.trim().split("\n").filter(Boolean).map((line, index) => {
      if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) throw new Error(`macro-surprise evidence record is too large at line ${index + 1}`);
      try { return validateRecord(JSON.parse(line), index + 1); } catch (error) { throw error instanceof Error ? error : new Error("invalid macro-surprise evidence JSON"); }
    });
    for (const [index, record] of records.entries()) {
      if (record.sequence !== index + 1) throw new Error(`non-contiguous macro-surprise evidence sequence at line ${index + 1}`);
      if (index > 0 && record.first_seen_at < records[index - 1].first_seen_at) throw new Error(`macro-surprise first_seen_at moved backwards at line ${index + 1}`);
    }
    return records;
  }

  private async appendUnlocked(record: MacroSurpriseEvidenceRecord): Promise<void> {
    await ensureOwnerDirectory(dirname(this.filePath), "macro-surprise evidence");
    const line = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    if (line.byteLength > MAX_RECORD_BYTES) throw new Error("macro-surprise evidence record is too large");
    const handle = await open(this.filePath, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollowFlag(), 0o600);
    try { await handle.chmod(0o600); const written = await handle.write(line); if (written.bytesWritten !== line.byteLength) throw new Error("short write to macro-surprise evidence"); await handle.sync(); } finally { await handle.close(); }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await ensureOwnerDirectory(dirname(this.filePath), "macro-surprise evidence");
    const path = `${this.filePath}.lock`; const token = randomUUID(); const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      try {
        const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
        try { await handle.writeFile(`${token}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
        return async () => {
          let handle;
          try {
            handle = await open(path, constants.O_RDONLY | noFollowFlag());
            const stat = await handle.stat(); const contents = await handle.readFile("utf8");
            const current = await lstat(path);
            if (!stat.isFile() || current.ino !== stat.ino || current.mtimeMs !== stat.mtimeMs || contents !== `${token}\n`) throw new Error("macro-surprise evidence lock ownership was lost");
            await unlink(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          } finally { await handle?.close(); }
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let handle;
        try {
          handle = await open(path, constants.O_RDONLY | noFollowFlag());
          const stat = await handle.stat();
          if (!stat.isFile() || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || (posixModeEnforced() && (stat.mode & 0o077) !== 0)) throw new Error("macro-surprise evidence lock path is unsafe");
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            await handle.readFile("utf8");
            const current = await lstat(path);
            if (current.ino === stat.ino && current.mtimeMs === stat.mtimeMs && current.size === stat.size) { await handle.close(); handle = undefined; await unlink(path); continue; }
          }
        } finally { await handle?.close(); }
        if (Date.now() >= deadline) throw new Error(`timed out acquiring macro-surprise evidence lock at ${path}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => { const release = await this.acquireLock(); try { return await operation(); } finally { await release(); } });
    this.queue = result.then(() => undefined, () => undefined); return result;
  }

  async observe(observation: MacroSurpriseObservation): Promise<{ recorded: MacroSurpriseEvidenceRecord | null; unchanged: boolean; revision: boolean }> {
    return this.serialize(async () => {
      // The collector does not supply this timestamp.  Accepting an imported historical timestamp
      // here would let a later export impersonate a forecast seen before the release.
      const candidate = validateRecord({ ...observation, schema_version: "1.0", sequence: 1, series: "macro_surprise_evidence", first_seen_at: this.now().toISOString() });
      const records = await this.readUnlocked();
      if (records.at(-1)?.first_seen_at && candidate.first_seen_at < records.at(-1)!.first_seen_at) throw new Error("macro-surprise observation clock moved backwards");
      const prior = records.filter((record) => record.event_id === candidate.event_id && record.metric_id === candidate.metric_id && record.role === candidate.role).at(-1);
      if (prior?.value === candidate.value && prior.source_id === candidate.source_id && prior.source_url === candidate.source_url && prior.raw_sha256 === candidate.raw_sha256) return { recorded: null, unchanged: true, revision: false };
      const record = { ...candidate, sequence: records.length + 1 };
      await this.appendUnlocked(record);
      return { recorded: record, unchanged: false, revision: prior !== undefined };
    });
  }

  async getEligible(eventId: string, asOf: Date): Promise<{ status: "ready"; value: EligibleMacroSurprise } | { status: "blocked"; blockers: string[] }> {
    if (!validEventId(eventId) || !Number.isFinite(asOf.getTime())) throw new Error("macro-surprise eligibility input is invalid");
    return this.serialize(async () => {
      const rows = (await this.readUnlocked()).filter((record) => record.event_id === eventId && record.first_seen_at <= asOf.toISOString());
      const event = rows[0];
      if (!event) return { status: "blocked" as const, blockers: ["no_first_seen_macro_surprise_evidence"] };
      const consensus = rows.filter((record) => record.role === "consensus" && record.first_seen_at < event.occurred_at).at(-1);
      const actual = rows.filter((record) => record.role === "actual").at(-1);
      const blockers = [
        ...(consensus === undefined ? ["no_consensus_first_seen_before_release"] : []),
        ...(actual === undefined ? ["no_actual_first_seen_in_release_capture_window"] : []),
      ];
      if (blockers.length > 0 || consensus === undefined || actual === undefined) return { status: "blocked" as const, blockers };
      return { status: "ready" as const, value: {
        event_id: event.event_id, event_kind: event.event_kind, occurred_at: event.occurred_at, metric_id: event.metric_id,
        consensus: { value: consensus.value, source_id: consensus.source_id, source_url: consensus.source_url, raw_sha256: consensus.raw_sha256, first_seen_at: consensus.first_seen_at },
        actual: { value: actual.value, source_id: actual.source_id, source_url: actual.source_url, raw_sha256: actual.raw_sha256, first_seen_at: actual.first_seen_at },
        surprise: actual.value - consensus.value, evidence_tier: "forward_first_seen",
      } };
    });
  }

  async list(): Promise<MacroSurpriseEvidenceRecord[]> {
    return this.serialize(async () => [...await this.readUnlocked()]);
  }

  async coverage() {
    return this.serialize(async () => {
      const records = await this.readUnlocked();
      const eventKeys = [...new Set(records.map((record) => `${record.event_id}:${record.metric_id}`))];
      return { contract: MACRO_SURPRISE_DATA_CONTRACT_V1.contract_id, records: records.length, event_metrics: eventKeys.length, consensus_records: records.filter((record) => record.role === "consensus").length, actual_records: records.filter((record) => record.role === "actual").length, first_collected_at: records[0]?.first_seen_at ?? null, last_collected_at: records.at(-1)?.first_seen_at ?? null };
    });
  }
}

/** Archive first, then append the normalized observation. A failed archive never creates evidence. */
export async function persistMacroSurpriseObservation(input: {
  archive: Pick<MacroSurpriseRawArchive, "store">;
  store: Pick<MacroSurpriseEvidenceStore, "observe">;
  raw: string | Buffer;
  observation: Omit<MacroSurpriseObservation, "raw_sha256">;
}) {
  const body = Buffer.isBuffer(input.raw) ? input.raw : Buffer.from(input.raw, "utf8");
  const rawSha256 = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const archived = await input.archive.store(rawSha256, body);
  const saved = await input.store.observe({ ...input.observation, raw_sha256: rawSha256 });
  return { raw_sha256: rawSha256, raw_archive: archived, first_seen: saved };
}
