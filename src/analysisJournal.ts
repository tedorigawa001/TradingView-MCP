import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assertAppendableJsonl, assertNotSymbolicLink, syncDirectoryEntry, noFollowFlag, posixModeEnforced, attemptLockFile, lockBeingReleased } from "./fsDurability.js";
import { binaryCalibration } from "./calibration.js";
import { asksForMoreHistory, isLegacyUncoveredComplete, isTerminalWithoutGapCheck, recordedHistoryRequest } from "./analysisOutcomeEvidence.js";
import type { AnalysisBias, AnalysisOverlayState } from "./analysisOverlay.js";

const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 60_000;
// The attempt log is scheduling data only, so it keeps two segments of this size: the current one is renamed over the
// previous one when it is full (BACKLOG 102-34).
const ATTEMPT_SEGMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPT_RECORD_BYTES = 1024;
// An open that waits for a writer would hang on a FIFO put in the attempt log's place; Windows has neither.
const NON_BLOCKING_OPEN = process.platform === "win32" ? 0 : constants.O_NONBLOCK;

export class AnalysisDefinitionConflictError extends Error {
  readonly code = "analysis_id_definition_conflict";

  constructor(readonly analysisId: string, message?: string) {
    super(message ?? `analysis_id ${analysisId} is already bound to a different definition`);
    this.name = "AnalysisDefinitionConflictError";
  }
}

export const resolveAnalysisJournalPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_ANALYSIS_JOURNAL_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "analysis-journal.jsonl");

export type AnalysisJournalDefinition = AnalysisOverlayState & {
  symbol: string;
  timeframe: string;
  chartIndex: number;
  pineId: string | null;
  pineVersion: string | null;
  studyId: string;
};

export type AnalysisJournalOutcome = {
  status: string;
  outcome: string;
  evaluatedAt: string;
  evidenceTimeframe: string;
  evidenceThrough: string | null;
  result: Record<string, unknown>;
};

/**
 * A due evaluation that recorded no outcome: it found the result already recorded (unchanged), or it failed, its outcome
 * included (BACKLOG 102-34). Kept in a log beside the journal, so due selection knows when an analysis was last looked at
 * and an earlier version still reads the journal.
 */
export type AnalysisAttemptResult = "unchanged" | "failed";
export type AnalysisAttempt = { attemptedAt: string; result: AnalysisAttemptResult };
type AnalysisAttemptEntry = {
  schema_version: "1.0";
  attempt_id: string;
  attempted_at: string;
  analysis_id: string;
  definition_hash: string;
  result: AnalysisAttemptResult;
};

export type AnalysisJournalAlertLink = {
  linkedAt: string;
  alerts: Array<{
    kind: "confirmation" | "invalidation" | "target_1";
    alertId: number | string;
    ownershipName: string;
    operator: "cross_up" | "cross_down";
    level: number;
    expiration: string;
  }>;
};

export type AnalysisJournalEntry = {
  schema_version: "1.0";
  event_id: string;
  sequence: number;
  recorded_at: string;
  kind: "analysis_applied" | "outcome_evaluated" | "alerts_created";
  analysis_id: string;
  definition_hash: string;
  payload: AnalysisJournalDefinition | AnalysisJournalOutcome | AnalysisJournalAlertLink;
};

export type AnalysisJournalRecordResult = {
  recorded: boolean;
  idempotent: boolean;
  entry: AnalysisJournalEntry;
};

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const validateAnalysisId = (value: unknown): value is string =>
  typeof value === "string" && /^[\w.:-]{1,80}$/.test(value);

const validateDefinition = (value: unknown): AnalysisJournalDefinition => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("analysis journal definition must be an object");
  }
  const definition = value as Partial<AnalysisJournalDefinition>;
  if (!validateAnalysisId(definition.analysisId)) throw new Error("invalid journal analysisId");
  if (typeof definition.symbol !== "string" || !/^[\w!.:&-]{1,48}$/.test(definition.symbol)) {
    throw new Error("invalid journal symbol");
  }
  if (typeof definition.timeframe !== "string" ||
      !/^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i.test(definition.timeframe) ||
      definition.timeframe.length > 8) {
    throw new Error("invalid journal timeframe");
  }
  if (!Number.isInteger(definition.chartIndex) || (definition.chartIndex ?? -1) < 0) {
    throw new Error("invalid journal chartIndex");
  }
  if (definition.pineId !== null &&
      (typeof definition.pineId !== "string" || !/^USER;[\w]{8,64}$/.test(definition.pineId))) {
    throw new Error("invalid journal pineId");
  }
  if (definition.pineVersion !== null &&
      (typeof definition.pineVersion !== "string" || definition.pineVersion.length > 32)) {
    throw new Error("invalid journal pineVersion");
  }
  if (typeof definition.studyId !== "string" || !/^[\w$]{1,64}$/.test(definition.studyId)) {
    throw new Error("invalid journal studyId");
  }
  if (!isCanonicalTimestamp(definition.analyzedAt)) throw new Error("invalid journal analyzedAt");
  if (definition.expiresAt !== null && !isCanonicalTimestamp(definition.expiresAt)) {
    throw new Error("invalid journal expiresAt");
  }
  if (!(["bullish", "bearish", "neutral"] as unknown[]).includes(definition.bias)) {
    throw new Error("invalid journal bias");
  }
  const prices = [
    definition.entryLow,
    definition.entryHigh,
    definition.invalidation,
    definition.stop,
    ...(definition.confirmation === null ? [] : [definition.confirmation]),
    ...(Array.isArray(definition.targets) ? definition.targets : []),
  ];
  if (prices.some((price) => typeof price !== "number" || !Number.isFinite(price) || price <= 0)) {
    throw new Error("invalid journal price level");
  }
  if (!Array.isArray(definition.targets) || definition.targets.length < 1 || definition.targets.length > 3) {
    throw new Error("invalid journal targets");
  }
  if (typeof definition.confidence !== "number" || !Number.isFinite(definition.confidence) ||
      definition.confidence < 0 || definition.confidence > 1) {
    throw new Error("invalid journal confidence");
  }
  if (typeof definition.note !== "string" || definition.note.length > 160) {
    throw new Error("invalid journal note");
  }
  if (definition.analysisSymbol !== undefined &&
      (typeof definition.analysisSymbol !== "string" ||
       definition.analysisSymbol.toUpperCase() !== definition.symbol.toUpperCase())) {
    throw new Error("journal analysisSymbol does not match symbol");
  }
  if (definition.analysisTimeframe !== undefined &&
      (typeof definition.analysisTimeframe !== "string" ||
       definition.analysisTimeframe !== definition.timeframe)) {
    throw new Error("journal analysisTimeframe does not match timeframe");
  }
  if (definition.snapshotId !== undefined && definition.snapshotId !== null &&
      (typeof definition.snapshotId !== "string" ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(definition.snapshotId))) {
    throw new Error("invalid journal snapshotId");
  }
  if (definition.strategyVersion !== undefined && definition.strategyVersion !== null &&
      (typeof definition.strategyVersion !== "string" || definition.strategyVersion.length < 1 ||
       definition.strategyVersion.length > 80)) {
    throw new Error("invalid journal strategyVersion");
  }
  return definition as AnalysisJournalDefinition;
};

const validateOutcome = (value: unknown): AnalysisJournalOutcome => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("analysis journal outcome must be an object");
  }
  const outcome = value as Partial<AnalysisJournalOutcome>;
  if (typeof outcome.status !== "string" || outcome.status.length < 1 || outcome.status.length > 40) {
    throw new Error("invalid journal outcome status");
  }
  if (typeof outcome.outcome !== "string" || outcome.outcome.length < 1 || outcome.outcome.length > 80) {
    throw new Error("invalid journal outcome label");
  }
  if (!isCanonicalTimestamp(outcome.evaluatedAt)) throw new Error("invalid journal evaluatedAt");
  if (typeof outcome.evidenceTimeframe !== "string" || outcome.evidenceTimeframe.length < 1 ||
      outcome.evidenceTimeframe.length > 8) {
    throw new Error("invalid journal evidenceTimeframe");
  }
  if (outcome.evidenceThrough !== null && !isCanonicalTimestamp(outcome.evidenceThrough)) {
    throw new Error("invalid journal evidenceThrough");
  }
  if (!outcome.result || typeof outcome.result !== "object" || Array.isArray(outcome.result)) {
    throw new Error("invalid journal outcome result");
  }
  return outcome as AnalysisJournalOutcome;
};

const validateAlertLink = (value: unknown): AnalysisJournalAlertLink => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("analysis journal alert link must be an object");
  }
  const link = value as Partial<AnalysisJournalAlertLink>;
  if (!isCanonicalTimestamp(link.linkedAt)) throw new Error("invalid journal alert linkedAt");
  if (!Array.isArray(link.alerts) || link.alerts.length < 1 || link.alerts.length > 3) {
    throw new Error("journal alert link must contain one to three alerts");
  }
  const kinds = new Set<string>();
  for (const alert of link.alerts) {
    if (!alert || typeof alert !== "object" || Array.isArray(alert)) throw new Error("invalid journal alert");
    if (!(["confirmation", "invalidation", "target_1"] as unknown[]).includes(alert.kind)) {
      throw new Error("invalid journal alert kind");
    }
    if (kinds.has(alert.kind)) throw new Error("duplicate journal alert kind");
    kinds.add(alert.kind);
    const validNumericId = typeof alert.alertId === "number" &&
      Number.isSafeInteger(alert.alertId) && alert.alertId >= 0;
    const validStringId = typeof alert.alertId === "string" &&
      /^[A-Za-z0-9._:-]{1,80}$/.test(alert.alertId);
    if (!validNumericId && !validStringId) {
      throw new Error("invalid journal alert id");
    }
    if (typeof alert.ownershipName !== "string" ||
        !new RegExp(`^BUSHIDO-MCP:[0-9a-f]{16}:${alert.kind}$`).test(alert.ownershipName)) {
      throw new Error("invalid journal alert ownership name");
    }
    if (alert.operator !== "cross_up" && alert.operator !== "cross_down") {
      throw new Error("invalid journal alert operator");
    }
    if (typeof alert.level !== "number" || !Number.isFinite(alert.level) || alert.level <= 0) {
      throw new Error("invalid journal alert level");
    }
    if (!isCanonicalTimestamp(alert.expiration)) throw new Error("invalid journal alert expiration");
  }
  return link as AnalysisJournalAlertLink;
};

const canonicalDefinition = (definition: AnalysisJournalDefinition) => ({
  analysisId: definition.analysisId,
  symbol: definition.symbol,
  timeframe: definition.timeframe,
  analyzedAt: definition.analyzedAt,
  expiresAt: definition.expiresAt,
  bias: definition.bias,
  entryLow: definition.entryLow,
  entryHigh: definition.entryHigh,
  confirmation: definition.confirmation,
  invalidation: definition.invalidation,
  stop: definition.stop,
  targets: definition.targets,
  confidence: definition.confidence,
  note: definition.note,
  analysisSymbol: definition.analysisSymbol,
  analysisTimeframe: definition.analysisTimeframe,
  snapshotId: definition.snapshotId,
  strategyVersion: definition.strategyVersion,
});

export function analysisDefinitionHash(definition: AnalysisJournalDefinition): string {
  return createHash("sha256").update(JSON.stringify(canonicalDefinition(validateDefinition(definition)))).digest("hex");
}

const validateEntry = (value: unknown, line?: number): AnalysisJournalEntry => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid analysis journal record${suffix}`);
  }
  const entry = value as Partial<AnalysisJournalEntry>;
  if (entry.schema_version !== "1.0") throw new Error(`unsupported analysis journal schema${suffix}`);
  if (typeof entry.event_id !== "string" || !/^[0-9a-f-]{36}$/i.test(entry.event_id)) {
    throw new Error(`invalid analysis journal event_id${suffix}`);
  }
  if (!Number.isSafeInteger(entry.sequence) || (entry.sequence ?? 0) < 1) {
    throw new Error(`invalid analysis journal sequence${suffix}`);
  }
  if (!isCanonicalTimestamp(entry.recorded_at)) throw new Error(`invalid analysis journal recorded_at${suffix}`);
  if (!validateAnalysisId(entry.analysis_id)) throw new Error(`invalid analysis journal analysis_id${suffix}`);
  if (typeof entry.definition_hash !== "string" || !/^[0-9a-f]{64}$/.test(entry.definition_hash)) {
    throw new Error(`invalid analysis journal definition_hash${suffix}`);
  }
  if (entry.kind !== "analysis_applied" && entry.kind !== "outcome_evaluated" && entry.kind !== "alerts_created") {
    throw new Error(`invalid analysis journal kind${suffix}`);
  }
  const payload = entry.kind === "analysis_applied"
    ? validateDefinition(entry.payload)
    : entry.kind === "outcome_evaluated"
      ? validateOutcome(entry.payload)
      : validateAlertLink(entry.payload);
  if (entry.kind === "analysis_applied") {
    const definition = payload as AnalysisJournalDefinition;
    if (definition.analysisId !== entry.analysis_id || analysisDefinitionHash(definition) !== entry.definition_hash) {
      throw new Error(`analysis journal definition identity mismatch${suffix}`);
    }
  }
  return { ...entry, payload } as AnalysisJournalEntry;
};

const validateAttemptEntry = (value: unknown, where: string): AnalysisAttemptEntry => {
  const entry = (value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}) as Partial<AnalysisAttemptEntry>;
  if (entry.schema_version !== "1.0" || typeof entry.attempt_id !== "string" || !/^[0-9a-f-]{36}$/i.test(entry.attempt_id) ||
    !isCanonicalTimestamp(entry.attempted_at) || !validateAnalysisId(entry.analysis_id) ||
    typeof entry.definition_hash !== "string" || !/^[0-9a-f]{64}$/.test(entry.definition_hash) ||
    (entry.result !== "unchanged" && entry.result !== "failed")) {
    throw new Error(`invalid analysis attempt record ${where}`);
  }
  return entry as AnalysisAttemptEntry;
};

const outcomeRank = (entry: AnalysisJournalEntry): [number, string, string, number] => {
  const payload = entry.payload as AnalysisJournalOutcome;
  return [
    payload.status === "complete" ? 1 : 0,
    payload.evidenceThrough ?? "",
    payload.evaluatedAt,
    entry.sequence,
  ];
};

/** How outcomes of one analysis rank: a complete one above the others, and among equals the later evidence, evaluation and sequence. */
const compareRank = (left: AnalysisJournalEntry, right: AnalysisJournalEntry): number => {
  const a = outcomeRank(left);
  const b = outcomeRank(right);
  return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3] - b[3];
};

/**
 * The latest outcome of one analysis (BACKLOG 102-32). A complete one is final, unless it is a legacy complete: one
 * without a terminal event whose evidence does not reach the expiry, which an evaluator before 0.1.22 closed by the clock
 * alone (BACKLOG 102-04). Such a record gives way to whatever was recorded after it, and only to that: evaluations
 * written before it (an ongoing one while the analysis was active, an incomplete one) stay below it, as they always did.
 * So the latest is the best ranked complete that is not legacy; failing that, the best ranked of the records after the
 * last legacy one; failing that, the best ranked of all.
 */
const latestOutcomeOf = (outcomes: AnalysisJournalEntry[], expiresAt: string | null): AnalysisJournalEntry | null => {
  const best = (entries: AnalysisJournalEntry[]) => [...entries].sort(compareRank).at(-1) ?? null;
  const legacy = (entry: AnalysisJournalEntry) => isLegacyUncoveredComplete(entry.payload as AnalysisJournalOutcome, expiresAt);
  const final = outcomes.filter((entry) => (entry.payload as AnalysisJournalOutcome).status === "complete" && !legacy(entry));
  if (final.length > 0) return best(final);
  const lastLegacy = outcomes.filter(legacy).reduce((last, entry) => Math.max(last, entry.sequence), 0);
  const after = outcomes.filter((entry) => entry.sequence > lastLegacy);
  return best(lastLegacy > 0 && after.length > 0 ? after : outcomes);
};

export class AnalysisJournalStore {
  private queue: Promise<void> = Promise.resolve();

  private readonly attemptSegmentBytes: number;

  constructor(private readonly filePath: string, options: { attemptSegmentBytes?: number } = {}) {
    if (!filePath) throw new Error("analysis journal path is required");
    this.attemptSegmentBytes = options.attemptSegmentBytes ?? ATTEMPT_SEGMENT_BYTES;
  }

  /** The attempt log beside the journal: the current segment, and the previous one it replaced when full (BACKLOG 102-34). */
  get attemptLogPaths(): { current: string; previous: string } {
    return { current: `${this.filePath}.attempts.jsonl`, previous: `${this.filePath}.attempts.1.jsonl` };
  }

  private async ensureDirectory(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("analysis journal directory is unsafe");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error("analysis journal directory must be owned by the current user");
    }
    if ((posixModeEnforced() && (stat.mode & 0o077) !== 0)) throw new Error("analysis journal directory permissions must be 0700");
  }

  /** true: look again at once; false: wait; a Windows refusal: wait, and name it if the deadline passes (BACKLOG 102-39). */
  private async reclaimStaleLock(lockPath: string, observed: Awaited<ReturnType<typeof lstat>>): Promise<boolean | NodeJS.ErrnoException> {
    if (Date.now() - Number(observed.mtimeMs) <= STALE_LOCK_MS) return false;
    if (typeof process.getuid === "function" && observed.uid !== process.getuid()) {
      throw new Error(`analysis journal lock must be owned by the current user: ${lockPath}`);
    }

    let handle;
    try {
      handle = await open(lockPath, constants.O_RDONLY | noFollowFlag());
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== observed.ino) return true;
      const contents = await handle.readFile("utf8");
      // Closed before the unlink: on Windows an open handle keeps a deleted name taken.
      await handle.close();
      handle = undefined;
      const ownerPid = contents.match(/^[0-9a-f-]{36}\s+(\d+)\n$/i)?.[1];
      if (ownerPid) {
        try {
          process.kill(Number(ownerPid), 0);
          return false;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ESRCH") return false;
        }
      }
      const current = await lstat(lockPath);
      if (current.ino !== opened.ino || current.mtimeMs !== opened.mtimeMs) return true;
      await unlink(lockPath);
      return true;
    } catch (err) {
      // Gone since it was found: look again at once. Being deleted on Windows: wait for it, within the deadline.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
      if (lockBeingReleased(err)) return err as NodeJS.ErrnoException;
      throw err;
    } finally {
      await handle?.close();
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await this.ensureDirectory();
    const lockPath = `${this.filePath}.lock`;
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    const timedOut = (cause: NodeJS.ErrnoException | null) => new Error(
      `timed out acquiring analysis journal lock at ${lockPath}; ` +
        "if no TradingView-MCP process is using it, remove that lock file and retry",
      { cause: cause ?? undefined },
    );
    // The deadline is checked before every attempt but the first, an immediate retry included, and no two retries in a
    // row skip the sleep: a lock that kept vanishing or being recreated would otherwise be retried for good (BACKLOG
    // 102-39).
    let refusal: NodeJS.ErrnoException | null = null;
    let retriedAtOnce = false;
    for (let attempted = false; ; attempted = true) {
      if (attempted && Date.now() >= deadline) throw timedOut(refusal);
      const attempt = await attemptLockFile(lockPath, "analysis journal lock", `${token} ${process.pid}\n`);
      if (attempt.taken) {
        return async () => {
          let handle;
          try {
            handle = await open(lockPath, constants.O_RDONLY | noFollowFlag());
            const stat = await handle.stat();
            const contents = await handle.readFile("utf8");
            await handle.close();
            handle = undefined;
            const current = await lstat(lockPath);
            if (current.ino !== stat.ino || !contents.startsWith(`${token} `)) {
              throw new Error("analysis journal lock ownership was lost");
            }
            await unlink(lockPath);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          } finally {
            await handle?.close();
          }
        };
      }
      // Held by another process, or being deleted on Windows: waited for alike (BACKLOG 102-39).
      refusal = attempt.refusal;
      let again = false;
      if (attempt.held) {
        if (!attempt.held.isFile() || attempt.held.isSymbolicLink()) throw new Error("analysis journal lock path is unsafe");
        const reclaimed = await this.reclaimStaleLock(lockPath, attempt.held);
        if (reclaimed === true) again = true;
        else if (reclaimed !== false) refusal = reclaimed;
      }
      if (again && !retriedAtOnce) {
        retriedAtOnce = true;
        continue;
      }
      retriedAtOnce = false;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async readAllUnlocked(): Promise<AnalysisJournalEntry[]> {
    let handle;
    try {
      await assertNotSymbolicLink(this.filePath, "analysis journal");
      handle = await open(this.filePath, constants.O_RDONLY | noFollowFlag());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("unable to open analysis journal as a regular file", { cause: err });
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("analysis journal path must be a regular file");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error("analysis journal file must be owned by the current user");
      }
      if ((posixModeEnforced() && (stat.mode & 0o077) !== 0)) throw new Error("analysis journal file permissions must be 0600");
      if (stat.size > MAX_JOURNAL_BYTES) throw new Error("analysis journal file is too large");
      const text = await handle.readFile("utf8");
      const entries = text.trim().split("\n").filter(Boolean).map((line, index) => {
        if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) {
          throw new Error(`analysis journal record is too large at line ${index + 1}`);
        }
        try {
          return validateEntry(JSON.parse(line) as unknown, index + 1);
        } catch (err) {
          if (err instanceof SyntaxError) throw new Error(`invalid analysis journal JSON at line ${index + 1}`);
          throw err;
        }
      });
      entries.forEach((entry, index) => {
        if (entry.sequence !== index + 1) throw new Error(`non-contiguous analysis journal sequence at line ${index + 1}`);
      });
      const eventIds = new Set<string>();
      const definitionHashes = new Map<string, string>();
      entries.forEach((entry, index) => {
        if (eventIds.has(entry.event_id)) {
          throw new Error(`duplicate analysis journal event_id at line ${index + 1}`);
        }
        eventIds.add(entry.event_id);
        if (entry.kind === "analysis_applied") {
          if (definitionHashes.has(entry.analysis_id)) {
            throw new Error(`duplicate analysis definition at line ${index + 1}`);
          }
          definitionHashes.set(entry.analysis_id, entry.definition_hash);
        } else if (definitionHashes.get(entry.analysis_id) !== entry.definition_hash) {
          const eventType = entry.kind === "outcome_evaluated" ? "analysis outcome" : "analysis alert link";
          throw new Error(`orphaned or mismatched ${eventType} at line ${index + 1}`);
        }
      });
      return entries;
    } finally {
      await handle.close();
    }
  }

  private async appendUnlocked(entry: AnalysisJournalEntry): Promise<void> {
    await this.ensureDirectory();
    const line = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
    if (line.byteLength > MAX_RECORD_BYTES) throw new Error("analysis journal record is too large");
    const handle = await open(
      this.filePath,
      constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | noFollowFlag(),
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("analysis journal path must be a regular file");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error("analysis journal file must be owned by the current user");
      }
      await assertAppendableJsonl(handle, stat.size, "analysis journal", this.filePath);
      await handle.chmod(0o600);
      if (stat.size + line.byteLength > MAX_JOURNAL_BYTES) throw new Error("analysis journal file is too large");
      const { bytesWritten } = await handle.write(line, 0, line.byteLength, null);
      if (bytesWritten !== line.byteLength) throw new Error("short write to analysis journal");
      await handle.sync();
      if (stat.size === 0) {
        await syncDirectoryEntry(dirname(this.filePath));
      }
    } finally {
      await handle.close();
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const release = await this.acquireLock();
      try { return await operation(); } finally { await release(); }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async recordAnalysis(definitionValue: AnalysisJournalDefinition): Promise<AnalysisJournalRecordResult> {
    const definition = validateDefinition(definitionValue);
    const definitionHash = analysisDefinitionHash(definition);
    return this.serialize(async () => {
      const entries = await this.readAllUnlocked();
      const definitions = entries.filter((entry) => entry.kind === "analysis_applied" && entry.analysis_id === definition.analysisId);
      const conflict = definitions.find((entry) => entry.definition_hash !== definitionHash);
      if (conflict) throw new AnalysisDefinitionConflictError(definition.analysisId);
      const existing = definitions[0];
      if (existing) return { recorded: false, idempotent: true, entry: existing };
      const entry = validateEntry({
        schema_version: "1.0",
        event_id: randomUUID(),
        sequence: entries.length + 1,
        recorded_at: new Date().toISOString(),
        kind: "analysis_applied",
        analysis_id: definition.analysisId,
        definition_hash: definitionHash,
        payload: definition,
      });
      await this.appendUnlocked(entry);
      return { recorded: true, idempotent: false, entry };
    });
  }

  async recordOutcome(
    analysisId: string,
    definitionHash: string,
    outcomeValue: AnalysisJournalOutcome,
  ): Promise<AnalysisJournalRecordResult> {
    if (!validateAnalysisId(analysisId)) throw new Error("invalid analysis_id");
    const outcome = validateOutcome(outcomeValue);
    return this.serialize(async () => {
      const entries = await this.readAllUnlocked();
      const definition = entries.find((entry) => entry.kind === "analysis_applied" && entry.analysis_id === analysisId);
      if (!definition) throw new Error(`analysis_id ${analysisId} has no journaled applied definition`);
      if (definition.definition_hash !== definitionHash) {
        throw new AnalysisDefinitionConflictError(
          analysisId,
          `analysis_id ${analysisId} does not match its journaled definition`,
        );
      }
      const outcomes = entries.filter((entry) => entry.kind === "outcome_evaluated" && entry.analysis_id === analysisId);
      // A legacy complete (see latestOutcomeOf) gives way to a later evaluation that is not legacy: a complete of another
      // label recorded after it (a terminal or invalidation found later) does not conflict with it, and one whose
      // evidence reaches the expiry is no duplicate of it, the same label included (BACKLOG 102-32). Legacy completes
      // still conflict with each other, as other completes do.
      const expiresAt = (definition.payload as AnalysisJournalDefinition).expiresAt;
      const legacy = (value: AnalysisJournalOutcome) => isLegacyUncoveredComplete(value, expiresAt);
      const conflicting = outcomes.find((entry) => {
        const prior = entry.payload as AnalysisJournalOutcome;
        return prior.status === "complete" && outcome.status === "complete" && prior.outcome !== outcome.outcome &&
          !(legacy(prior) && !legacy(outcome));
      });
      if (conflicting) throw new Error(`analysis_id ${analysisId} has conflicting terminal outcomes`);
      // A result is a duplicate only of the latest and what was recorded after it. One that repeats an earlier record
      // the latest outranks or replaced is recorded once, so a recheck can become the latest again (a short history
      // evaluated once on another timeframe does not keep the latest away from what every later run on its own timeframe
      // finds), and stays bounded: repeated again, it is a duplicate of that record. Nor is a result that is not legacy a
      // duplicate of anything up to the last legacy complete: recorded after it, it replaces it, even when it repeats a
      // record from before it. A history that does not reach back, found from more history than a record asked for, is
      // no duplicate of it either, so due selection finds the larger request recorded (BACKLOG 102-32).
      const latest = latestOutcomeOf(outcomes, expiresAt);
      const lastLegacy = outcomes.filter((entry) => legacy(entry.payload as AnalysisJournalOutcome))
        .reduce((last, entry) => Math.max(last, entry.sequence), 0);
      const semanticDuplicates = outcomes.filter((entry) => {
        const prior = entry.payload as AnalysisJournalOutcome;
        if (latest !== null && entry.sequence < latest.sequence) return false;
        if (!legacy(outcome) && entry.sequence <= lastLegacy) return false;
        if (outcome.outcome === "history_incomplete" &&
          asksForMoreHistory(recordedHistoryRequest(outcome), recordedHistoryRequest(prior))) return false;
        return prior.status === outcome.status &&
          prior.outcome === outcome.outcome &&
          prior.evidenceTimeframe === outcome.evidenceTimeframe &&
          prior.evidenceThrough === outcome.evidenceThrough;
      });
      const hasPathMetrics = (value: AnalysisJournalOutcome) => {
        const performance = value.result.performance;
        return performance !== null && typeof performance === "object" && !Array.isArray(performance);
      };
      const enriched = hasPathMetrics(outcome);
      const duplicate = semanticDuplicates.find((entry) =>
        !enriched || hasPathMetrics(entry.payload as AnalysisJournalOutcome));
      if (duplicate) return { recorded: false, idempotent: true, entry: duplicate };
      const entry = validateEntry({
        schema_version: "1.0",
        event_id: randomUUID(),
        sequence: entries.length + 1,
        recorded_at: new Date().toISOString(),
        kind: "outcome_evaluated",
        analysis_id: analysisId,
        definition_hash: definitionHash,
        payload: outcome,
      });
      await this.appendUnlocked(entry);
      return { recorded: true, idempotent: false, entry };
    });
  }

  async recordAlertSet(
    analysisId: string,
    definitionHash: string,
    alertsValue: AnalysisJournalAlertLink["alerts"],
  ): Promise<AnalysisJournalRecordResult> {
    if (!validateAnalysisId(analysisId)) throw new Error("invalid analysis_id");
    const alerts = validateAlertLink({ linkedAt: new Date().toISOString(), alerts: alertsValue }).alerts;
    const canonical = (values: AnalysisJournalAlertLink["alerts"]) =>
      JSON.stringify([...values].sort((left, right) => left.kind.localeCompare(right.kind)));
    return this.serialize(async () => {
      const entries = await this.readAllUnlocked();
      const definition = entries.find((entry) => entry.kind === "analysis_applied" && entry.analysis_id === analysisId);
      if (!definition) throw new Error(`analysis_id ${analysisId} has no journaled applied definition`);
      if (definition.definition_hash !== definitionHash) {
        throw new AnalysisDefinitionConflictError(
          analysisId,
          `analysis_id ${analysisId} does not match its journaled definition`,
        );
      }
      const priorLinks = entries.filter((entry) => entry.kind === "alerts_created" && entry.analysis_id === analysisId);
      const duplicate = priorLinks.find((entry) =>
        canonical((entry.payload as AnalysisJournalAlertLink).alerts) === canonical(alerts));
      if (duplicate) return { recorded: false, idempotent: true, entry: duplicate };
      if (priorLinks.length > 0) throw new Error(`analysis_id ${analysisId} has conflicting alert linkage`);
      const entry = validateEntry({
        schema_version: "1.0",
        event_id: randomUUID(),
        sequence: entries.length + 1,
        recorded_at: new Date().toISOString(),
        kind: "alerts_created",
        analysis_id: analysisId,
        definition_hash: definitionHash,
        payload: { linkedAt: new Date().toISOString(), alerts },
      });
      await this.appendUnlocked(entry);
      return { recorded: true, idempotent: false, entry };
    });
  }

  /**
   * The kind of an attempt log segment is checked before it is opened, and the open does not wait, so a FIFO or device
   * in its place is refused instead of blocking the server; one swapped in after the check is refused on the handle.
   */
  private async attemptSegmentKind(path: string): Promise<"missing" | "file"> {
    await assertNotSymbolicLink(path, "analysis attempt log");
    const found = await lstat(path).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (found === null) return "missing";
    if (!found.isFile()) throw new Error(`analysis attempt log path must be a regular file: ${path}`);
    return "file";
  }

  private async readAttemptSegmentUnlocked(path: string): Promise<AnalysisAttemptEntry[]> {
    if (await this.attemptSegmentKind(path) === "missing") return [];
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | noFollowFlag() | NON_BLOCKING_OPEN);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(`unable to open analysis attempt log as a regular file: ${path}`, { cause: err });
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`analysis attempt log path must be a regular file: ${path}`);
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error(`analysis attempt log must be owned by the current user: ${path}`);
      }
      if (posixModeEnforced() && (stat.mode & 0o077) !== 0) throw new Error(`analysis attempt log permissions must be 0600: ${path}`);
      // A segment stays within its size, but for one record larger than a whole segment, alone in a new one.
      if (stat.size > this.attemptSegmentBytes + MAX_ATTEMPT_RECORD_BYTES) throw new Error(`analysis attempt log is too large: ${path}`);
      const text = await handle.readFile("utf8");
      return text.split("\n").filter(Boolean).map((line, index) => {
        try {
          return validateAttemptEntry(JSON.parse(line) as unknown, `at line ${index + 1} of ${path}`);
        } catch (err) {
          if (err instanceof SyntaxError) throw new Error(`invalid analysis attempt JSON at line ${index + 1} of ${path}`);
          throw err;
        }
      });
    } finally {
      await handle.close();
    }
  }

  /**
   * Notes that a due evaluation of an analysis recorded no outcome, so due selection can look at the analyses it has not
   * looked at for longest first (BACKLOG 102-34). Only the format is checked, not the journal: an attempt for an analysis
   * the journal does not hold is never read.
   */
  async recordAttempt(analysisId: string, definitionHash: string, result: AnalysisAttemptResult): Promise<AnalysisAttempt> {
    if (!validateAnalysisId(analysisId)) throw new Error("invalid analysis_id");
    const entry = validateAttemptEntry({
      schema_version: "1.0",
      attempt_id: randomUUID(),
      attempted_at: new Date().toISOString(),
      analysis_id: analysisId,
      definition_hash: definitionHash,
      result,
    }, "to append");
    const line = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
    if (line.byteLength > MAX_ATTEMPT_RECORD_BYTES) throw new Error("analysis attempt record is too large");
    return this.serialize(async () => {
      await this.ensureDirectory();
      const { current, previous } = this.attemptLogPaths;
      // Opened and checked before anything else, a full segment included: a cut-off last line refuses the append before
      // the segment could be moved, so it never ends up in the previous segment behind a successful append.
      const openCurrent = async () => {
        await this.attemptSegmentKind(current);
        const handle = await open(current, constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | noFollowFlag() | NON_BLOCKING_OPEN, 0o600);
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) throw new Error(`analysis attempt log path must be a regular file: ${current}`);
          if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
            throw new Error(`analysis attempt log must be owned by the current user: ${current}`);
          }
          await assertAppendableJsonl(handle, stat.size, "analysis attempt log", current);
          return { handle, size: stat.size };
        } catch (err) {
          await handle.close();
          throw err;
        }
      };
      let opened: Awaited<ReturnType<typeof openCurrent>> | null = await openCurrent();
      try {
        // A full segment replaces the previous one. It is closed first, as an open handle stops a rename on Windows;
        // every reader and writer holds the journal lock, so no other handle is open.
        if (opened.size > 0 && opened.size + line.byteLength > this.attemptSegmentBytes) {
          const full = opened;
          opened = null;
          await full.handle.close();
          await rename(current, previous);
          await syncDirectoryEntry(dirname(current));
          opened = await openCurrent();
        }
        const { handle, size } = opened;
        await handle.chmod(0o600);
        const { bytesWritten } = await handle.write(line, 0, line.byteLength, null);
        if (bytesWritten !== line.byteLength) throw new Error("short write to analysis attempt log");
        await handle.sync();
        if (size === 0) await syncDirectoryEntry(dirname(current));
      } finally {
        await opened?.handle.close();
      }
      return { attemptedAt: entry.attempted_at, result: entry.result };
    });
  }

  /**
   * The last attempt noted for each analysis, from both segments of the attempt log, keyed by analysis_id and definition
   * hash. A segment that cannot be read is named in unreadable and the other is still used: the log only orders due
   * analyses, and a damaged previous segment would otherwise disable it until the current one is full (BACKLOG 102-34).
   */
  async lastAttempts(): Promise<{
    attempts: Map<string, AnalysisAttempt & { definitionHash: string }>;
    unreadable: Array<{ path: string; error: unknown }>;
  }> {
    return this.serialize(async () => {
      const { current, previous } = this.attemptLogPaths;
      const last = new Map<string, AnalysisAttempt & { definitionHash: string }>();
      const unreadable: Array<{ path: string; error: unknown }> = [];
      const entries: AnalysisAttemptEntry[] = [];
      for (const path of [previous, current]) {
        try {
          entries.push(...await this.readAttemptSegmentUnlocked(path));
        } catch (error) {
          unreadable.push({ path, error });
        }
      }
      for (const entry of entries) {
        const known = last.get(entry.analysis_id);
        if (known === undefined || known.attemptedAt <= entry.attempted_at) {
          last.set(entry.analysis_id, { attemptedAt: entry.attempted_at, result: entry.result, definitionHash: entry.definition_hash });
        }
      }
      return { attempts: last, unreadable };
    });
  }

  async list(options: { analysisId?: string; symbol?: string; limit?: number } = {}) {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("journal limit must be between 1 and 500");
    if (options.analysisId !== undefined && !validateAnalysisId(options.analysisId)) throw new Error("invalid analysis_id");
    return this.serialize(async () => {
      const entries = await this.readAllUnlocked();
      const definitions = entries.filter((entry) => entry.kind === "analysis_applied").filter((entry) => {
        const payload = entry.payload as AnalysisJournalDefinition;
        return (!options.analysisId || entry.analysis_id === options.analysisId) &&
          (!options.symbol || payload.symbol.toUpperCase() === options.symbol.toUpperCase());
      });
      const analyses = definitions.map((definition) => {
        const outcomes = entries.filter((entry) => entry.kind === "outcome_evaluated" && entry.analysis_id === definition.analysis_id);
        const alertLinks = entries.filter((entry) => entry.kind === "alerts_created" && entry.analysis_id === definition.analysis_id);
        const latest = latestOutcomeOf(outcomes, (definition.payload as AnalysisJournalDefinition).expiresAt);
        return {
          definition,
          latestOutcome: latest,
          // The outcome recorded last, which due selection groups by: the latest is chosen by its evidence, so an
          // ongoing result stays the latest after a recheck with less evidence (BACKLOG 102-34). Given only when it is
          // not the latest, so the usual record is not repeated.
          ...(outcomes.length > 0 && outcomes.at(-1) !== latest ? { recentOutcome: outcomes.at(-1) } : {}),
          outcomeCount: outcomes.length,
          latestAlertLink: alertLinks.at(-1) ?? null,
          alertLinkCount: alertLinks.length,
        };
      }).sort((a, b) => b.definition.sequence - a.definition.sequence).slice(0, limit);
      return { total: definitions.length, returned: analyses.length, analyses };
    });
  }

  async calibration(options: { symbol?: string; bias?: AnalysisBias; bins?: number } = {}) {
    const bins = options.bins ?? 10;
    if (!Number.isInteger(bins) || bins < 2 || bins > 50) throw new Error("bins must be between 2 and 50");
    return this.serialize(async () => {
      const entries = await this.readAllUnlocked();
      const definitions = entries.filter((entry) => entry.kind === "analysis_applied").filter((entry) => {
        const payload = entry.payload as AnalysisJournalDefinition;
        return (!options.symbol || payload.symbol.toUpperCase() === options.symbol.toUpperCase()) &&
          (!options.bias || payload.bias === options.bias);
      });
      const excluded: Record<string, number> = {};
      const rows: Array<{ probability: number; outcome: boolean }> = [];
      // Records an earlier version left that cannot be told right yet (BACKLOG 102-32): completes without a terminal or
      // evidence through the expiry, still the latest until a recheck replaces them (excluded as their label), and target
      // or stop results from before the gap check, included as they are.
      const legacy = { completeWithoutCoverage: 0, includedWithoutGapCheck: 0 };
      for (const definition of definitions) {
        const expiresAt = (definition.payload as AnalysisJournalDefinition).expiresAt;
        const latest = latestOutcomeOf(entries
          .filter((entry) => entry.kind === "outcome_evaluated" && entry.analysis_id === definition.analysis_id), expiresAt);
        if (!latest) {
          excluded.no_evaluation = (excluded.no_evaluation ?? 0) + 1;
          continue;
        }
        const latestPayload = latest.payload as AnalysisJournalOutcome;
        if (isLegacyUncoveredComplete(latestPayload, expiresAt)) legacy.completeWithoutCoverage += 1;
        const label = latestPayload.outcome;
        if (label !== "target_before_stop" && label !== "stop_before_target") {
          excluded[label] = (excluded[label] ?? 0) + 1;
          continue;
        }
        if (isTerminalWithoutGapCheck(latestPayload)) legacy.includedWithoutGapCheck += 1;
        rows.push({
          probability: (definition.payload as AnalysisJournalDefinition).confidence,
          outcome: label === "target_before_stop",
        });
      }
      return {
        population: definitions.length,
        included: rows.length,
        excluded,
        legacy,
        labelDefinition: { positive: "target_before_stop", negative: "stop_before_target" },
        calibration: rows.length === 0 ? null : binaryCalibration(rows, bins),
      };
    });
  }
}
