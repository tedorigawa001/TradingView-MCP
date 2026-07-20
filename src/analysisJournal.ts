import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { binaryCalibration } from "./calibration.js";
import type { AnalysisBias, AnalysisOverlayState } from "./analysisOverlay.js";

const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 60_000;

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

const outcomeRank = (entry: AnalysisJournalEntry): [number, string, string, number] => {
  const payload = entry.payload as AnalysisJournalOutcome;
  return [
    payload.status === "complete" ? 1 : 0,
    payload.evidenceThrough ?? "",
    payload.evaluatedAt,
    entry.sequence,
  ];
};

const compareRank = (left: AnalysisJournalEntry, right: AnalysisJournalEntry): number => {
  const a = outcomeRank(left);
  const b = outcomeRank(right);
  return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3] - b[3];
};

export class AnalysisJournalStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    if (!filePath) throw new Error("analysis journal path is required");
  }

  private async ensureDirectory(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("analysis journal directory is unsafe");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error("analysis journal directory must be owned by the current user");
    }
    if ((stat.mode & 0o077) !== 0) throw new Error("analysis journal directory permissions must be 0700");
  }

  private async reclaimStaleLock(lockPath: string, observed: Awaited<ReturnType<typeof lstat>>): Promise<boolean> {
    if (Date.now() - Number(observed.mtimeMs) <= STALE_LOCK_MS) return false;
    if (typeof process.getuid === "function" && observed.uid !== process.getuid()) {
      throw new Error(`analysis journal lock must be owned by the current user: ${lockPath}`);
    }

    let handle;
    try {
      handle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== observed.ino) return true;
      const contents = await handle.readFile("utf8");
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
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
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
    while (true) {
      try {
        const handle = await open(
          lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.writeFile(`${token} ${process.pid}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        return async () => {
          let handle;
          try {
            handle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
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
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        let stat;
        try {
          stat = await lstat(lockPath);
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw statError;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("analysis journal lock path is unsafe");
        if (await this.reclaimStaleLock(lockPath, stat)) continue;
        if (Date.now() >= deadline) {
          throw new Error(
            `timed out acquiring analysis journal lock at ${lockPath}; ` +
              "if no TradingView-MCP process is using it, remove that lock file and retry",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async readAllUnlocked(): Promise<AnalysisJournalEntry[]> {
    let handle;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
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
      if ((stat.mode & 0o077) !== 0) throw new Error("analysis journal file permissions must be 0600");
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
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("analysis journal path must be a regular file");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error("analysis journal file must be owned by the current user");
      }
      await handle.chmod(0o600);
      if (stat.size + line.byteLength > MAX_JOURNAL_BYTES) throw new Error("analysis journal file is too large");
      const { bytesWritten } = await handle.write(line, 0, line.byteLength, null);
      if (bytesWritten !== line.byteLength) throw new Error("short write to analysis journal");
      await handle.sync();
      if (stat.size === 0) {
        const directoryHandle = await open(dirname(this.filePath), constants.O_RDONLY | constants.O_NOFOLLOW);
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
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
      const conflicting = outcomes.find((entry) => {
        const prior = entry.payload as AnalysisJournalOutcome;
        return prior.status === "complete" && outcome.status === "complete" && prior.outcome !== outcome.outcome;
      });
      if (conflicting) throw new Error(`analysis_id ${analysisId} has conflicting terminal outcomes`);
      const semanticDuplicates = outcomes.filter((entry) => {
        const prior = entry.payload as AnalysisJournalOutcome;
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
        const latest = outcomes.sort(compareRank).at(-1) ?? null;
        return {
          definition,
          latestOutcome: latest,
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
      for (const definition of definitions) {
        const outcomes = entries
          .filter((entry) => entry.kind === "outcome_evaluated" && entry.analysis_id === definition.analysis_id)
          .sort(compareRank);
        const latest = outcomes.at(-1);
        if (!latest) {
          excluded.no_evaluation = (excluded.no_evaluation ?? 0) + 1;
          continue;
        }
        const label = (latest.payload as AnalysisJournalOutcome).outcome;
        if (label !== "target_before_stop" && label !== "stop_before_target") {
          excluded[label] = (excluded[label] ?? 0) + 1;
          continue;
        }
        rows.push({
          probability: (definition.payload as AnalysisJournalDefinition).confidence,
          outcome: label === "target_before_stop",
        });
      }
      return {
        population: definitions.length,
        included: rows.length,
        excluded,
        labelDefinition: { positive: "target_before_stop", negative: "stop_before_target" },
        calibration: rows.length === 0 ? null : binaryCalibration(rows, bins),
      };
    });
  }
}
