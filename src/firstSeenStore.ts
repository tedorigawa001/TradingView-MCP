import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { basename, dirname, join, resolve } from "node:path";
import { assertAppendableJsonl, assertNotSymbolicLink, syncDirectoryEntry, noFollowFlag, nonBlockingFlag, openExclusiveFile, posixModeEnforced, attemptLockFile, type LockFileAttempt } from "./fsDurability.js";

const DEFAULT_LOCK_WAIT_MS = 30_000;
function lockWaitMilliseconds(): number {
  const raw = process.env.TV_MCP_HISTORY_LOCK_WAIT_MS;
  if (raw === undefined) return DEFAULT_LOCK_WAIT_MS;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 100 || value > 120_000) {
    throw new Error("TV_MCP_HISTORY_LOCK_WAIT_MS must be an integer from 100 to 120000");
  }
  return value;
}
const pathQueues = new Map<string, Promise<void>>();

export const isCalendarDate = (value: string): boolean => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
};

export const isCanonicalTimestamp = (value: string): boolean => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

/**
 * Every record in a first-seen log carries the position it was written at and the moment the value
 * was first observed. Those two fields are what make an as-of read meaningful, so they are required
 * of every series rather than left to each caller.
 */
export interface FirstSeenRecordBase {
  sequence: number;
  observation_date: string;
  first_seen_at: string;
}

/**
 * A first-seen log as a repair of its records stamped ahead of the clock found it, under the log's lock (BACKLOG
 * 103-11): every record as the store read and validated it, each record's own line, the file's identity (null when
 * there is no log), and `keep`, how many records stay; the records from `keep` on are the tail stamped ahead.
 */
export type StampedAheadPlan<T extends FirstSeenRecordBase> = {
  readonly label: string; readonly path: string; readonly records: readonly T[]; readonly lines: readonly string[]; readonly identity: Stats | null; readonly keep: number;
};

/**
 * What tradingview-mcp-repair-first-seen may do with a store's log (BACKLOG 103-11): name it, take its lock (serialize,
 * with the store's own queue and lock file), find the tail stamped ahead (plan) and move it out (apply), both under that
 * lock. Nothing here appends.
 */
export type StampedAheadRepair<T extends FirstSeenRecordBase> = {
  readonly label: string;
  readonly path: string;
  serialize<R>(operation: () => Promise<R>): Promise<R>;
  plan(now: Date, toleranceMs: number): Promise<StampedAheadPlan<T>>;
  apply(plan: StampedAheadPlan<T>, now: Date): Promise<{ sidecar: string; kept: number }>;
};

/** The name of a repair's sidecar: `<log>.ahead-<now, ISO 8601 basic>.jsonl`, with no colon, so Windows takes it too. */
export const stampedAheadSidecarPath = (path: string, now: Date) => `${path}.ahead-${now.toISOString().replace(/[-:]/g, "")}.jsonl`;

/**
 * Append-only, owner-only JSONL log shared by every first-seen series.
 *
 * The file safety, locking and structural invariants live here because they are what protect the
 * point-in-time claim: a log that another process can rewrite, or whose first-seen clock can move
 * backwards, cannot answer what was known at a past moment. Series-specific meaning, such as what
 * counts as a changed value, belongs to the caller.
 */
export class AppendOnlyFirstSeenLog<T extends FirstSeenRecordBase> {
  /**
   * The queue is keyed on the file, not on the spelling of the path that reached this
   * constructor. Two logs given `a/x.jsonl` and `a/./x.jsonl` write through the same lock
   * and must share one queue; keying on the raw string would hand them separate queues and
   * silently restore the race the queue exists to prevent.
   */
  private readonly queueKey: string;
  private readonly lockWaitMs: number;

  constructor(
    private readonly filePath: string,
    private readonly label: string,
    private readonly validateRecord: (value: unknown, line?: number) => T,
    private readonly limits: { maxFileBytes: number; maxRecordBytes: number },
  ) {
    if (!filePath) throw new Error(`${label} history path is required`);
    this.queueKey = resolve(filePath);
    this.lockWaitMs = lockWaitMilliseconds();
  }

  private async ensureDirectory(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${this.label} history directory must be a regular directory`);
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error(`${this.label} history directory must be owned by the current user`);
    }
    if ((posixModeEnforced() && (stat.mode & 0o077) !== 0)) {
      throw new Error(`${this.label} history directory permissions must not allow group or other access`);
    }
  }

  /** `budgetMs` defaults to the process-wide wait; serializeWithin passes what is left of its budget. */
  async acquireFileLock(budgetMs = this.lockWaitMs): Promise<() => Promise<void>> {
    await this.ensureDirectory();
    const lockPath = `${this.filePath}.lock`;
    const token = randomUUID();
    const started = performance.now();
    const deadline = started + budgetMs;
    const timeout = (cause?: unknown) => Object.assign(new Error(
      `timed out acquiring ${this.label} history lock after ${Math.round(budgetMs)}ms: ${lockPath}; ` +
      "another process may still hold it; do not remove a live owner's lock",
      { cause },
    ), { code: "HISTORY_LOCK_TIMEOUT" });
    let attempted = false;
    let refusal: NodeJS.ErrnoException | undefined;
    while (true) {
      if (attempted && performance.now() >= deadline) throw timeout(refusal);
      attempted = true;
      let attempt: LockFileAttempt;
      try {
        attempt = await attemptLockFile(lockPath, `${this.label} lock`, `${token} ${process.pid}\n`);
      } catch (err) {
        throw new Error(`unable to acquire ${this.label} history lock`, { cause: err });
      }
      if (attempt.taken) {
        return async () => {
          let handle;
          try {
            handle = await open(lockPath, constants.O_RDONLY | noFollowFlag() | nonBlockingFlag());
            const stat = await handle.stat();
            if (!stat.isFile()) throw new Error(`${this.label} history lock path is unsafe`);
            const contents = await handle.readFile("utf8");
            await handle.close();
            handle = undefined;
            const current = await lstat(lockPath);
            // Releasing a lock that is no longer ours would let two writers append at once.
            if (current.ino !== stat.ino || !contents.startsWith(`${token} `)) {
              throw new Error(`${this.label} history lock ownership was lost`);
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
      refusal = attempt.refusal ?? undefined;
      if (attempt.held && (!attempt.held.isFile() || attempt.held.isSymbolicLink())) {
        throw new Error(`${this.label} history lock path is unsafe`);
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw timeout(refusal);
      // Jitter reduces synchronized polling by collectors in different processes.
      await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 25 + Math.random() * 50)));
    }
  }

  async readAllUnlocked(): Promise<T[]> {
    return (await this.readLogUnlocked()).records;
  }

  /** readAllUnlocked's read, with each record's own line, the file's text and its identity (null when there is no log). */
  private async readLogUnlocked(): Promise<{ records: T[]; lines: string[]; text: string; identity: Stats | null }> {
    let handle;
    await assertNotSymbolicLink(this.filePath, `${this.label} history`);
    try {
      // Without waiting on a FIFO (BACKLOG 103-11): the open would wait for a writer, holding the lock, and the regular
      // file check below could never refuse it.
      handle = await open(this.filePath, constants.O_RDONLY | noFollowFlag() | nonBlockingFlag());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { records: [], lines: [], text: "", identity: null };
      throw new Error(`unable to open ${this.label} history as a regular file`, { cause: err });
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`${this.label} history path must be a regular file`);
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error(`${this.label} history file must be owned by the current user`);
      }
      if ((posixModeEnforced() && (stat.mode & 0o077) !== 0)) throw new Error(`${this.label} history file permissions must be 0600 or stricter`);
      if (stat.size > this.limits.maxFileBytes) throw new Error(`${this.label} history file is too large`);
      const text = await handle.readFile("utf8");
      const lines = text.trim().split("\n").filter(Boolean);
      const records = lines.map((line, index) => {
        if (Buffer.byteLength(line, "utf8") > this.limits.maxRecordBytes) {
          throw new Error(`${this.label} history record is too large at line ${index + 1}`);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          throw new Error(`invalid ${this.label} history JSON at line ${index + 1}`);
        }
        return this.validateRecord(parsed, index + 1);
      });
      let previousFirstSeen = "";
      for (const [index, record] of records.entries()) {
        if (record.sequence !== index + 1) {
          throw new Error(`non-contiguous ${this.label} sequence at line ${index + 1}`);
        }
        // A log whose first-seen clock rewinds cannot answer what was known at a past moment.
        if (record.first_seen_at < previousFirstSeen) {
          throw new Error(`${this.label} first_seen_at moved backwards at line ${index + 1}`);
        }
        if (record.observation_date > record.first_seen_at.slice(0, 10)) {
          throw new Error(`${this.label} observation_date is after first_seen_at at line ${index + 1}`);
        }
        previousFirstSeen = record.first_seen_at;
      }
      return { records, lines, text, identity: stat };
    } finally {
      await handle.close();
    }
  }

  /**
   * Under this log's lock: reads it as readAllUnlocked does, with every check, and finds the tail of records whose
   * first-seen stamp is more than `toleranceMs` after `now` (BACKLOG 103-11). Stamps never decrease in a log that reads,
   * so the records stamped ahead are always a tail; that is checked all the same. A log that is not framed exactly as
   * appendUnlocked writes it (one record per line, each ending in a newline, nothing else) is refused, since rewriting
   * it would change more than the tail.
   */
  async planStampedAheadUnlocked(now: Date, toleranceMs: number): Promise<StampedAheadPlan<T>> {
    if (!Number.isFinite(now.getTime()) || !Number.isFinite(toleranceMs) || toleranceMs < 0) throw new Error(`${this.label} repair needs a valid time and tolerance`);
    const { records, lines, text, identity } = await this.readLogUnlocked();
    if (identity !== null && text !== lines.map((line) => `${line}\n`).join("")) {
      throw new Error(`${this.label} history is not framed as the store writes it (one record per line, each ending in a newline, nothing else): `
        + `${this.filePath}; settle it by hand; nothing was changed`);
    }
    const ahead = (record: T) => Date.parse(record.first_seen_at) - now.getTime() > toleranceMs;
    let keep = records.length;
    while (keep > 0 && ahead(records[keep - 1])) keep -= 1;
    if (records.slice(0, keep).some(ahead)) throw new Error(`${this.label} history holds records stamped ahead that are not its tail: ${this.filePath}; nothing was changed`);
    return { label: this.label, path: this.filePath, records, lines, identity, keep };
  }

  /**
   * Under this log's lock, with a plan made under the same hold (BACKLOG 103-11): moves the tail stamped ahead out of the
   * log. The tail's lines go, byte for byte, to a new sidecar `<log>.ahead-<now>.jsonl` (exclusive create, owner-only
   * 0600, synced with its directory entry); the records that stay go to a new file beside the log, with the log's mode,
   * synced, which must read back as the store reads it, the kept records with their sequences from 1; it is then renamed
   * over the log and the directory synced. The log must still be the file that was read (identity, size, mtime) before
   * the sidecar is written and before the rename. Anything that fails before the rename removes what this repair wrote and
   * changes nothing; the error says so. Windows has no POSIX mode or directory sync, as appendUnlocked has none there.
   */
  async applyStampedAheadUnlocked(plan: StampedAheadPlan<T>, now: Date): Promise<{ sidecar: string; kept: number }> {
    const identity = plan.identity;
    if (plan.path !== this.filePath || identity === null || plan.keep >= plan.records.length) throw new Error(`${this.label} repair has nothing stamped ahead to move: ${this.filePath}; nothing was changed`);
    const directory = dirname(this.filePath);
    const unchanged = async () => {
      const current = await lstat(this.filePath).catch(() => null);
      return current !== null && current.isFile() && current.dev === identity.dev && current.ino === identity.ino && current.size === identity.size && current.mtimeMs === identity.mtimeMs;
    };
    const changed = () => new Error(`${this.label} history changed after the repair read it`);
    const sidecar = stampedAheadSidecarPath(this.filePath, now);
    const temporary = join(directory, `.${basename(this.filePath)}.repair-${randomUUID()}.tmp`);
    const written: { path: string; stat: Stats }[] = [];
    const writeNew = async (path: string, lines: readonly string[], mode: number) => {
      const handle = await openExclusiveFile(path, `${this.label} repair`);
      try {
        written.push({ path, stat: await handle.stat() });
        await handle.writeFile(lines.map((line) => `${line}\n`).join(""), "utf8");
        if (posixModeEnforced()) await handle.chmod(mode);
        await handle.sync();
      } finally {
        await handle.close();
      }
    };
    let renamed = false;
    try {
      if (!(await unchanged())) throw changed();
      await writeNew(sidecar, plan.lines.slice(plan.keep), 0o600);
      await syncDirectoryEntry(directory);
      await writeNew(temporary, plan.lines.slice(0, plan.keep), identity.mode & 0o777);
      const rewritten = await new AppendOnlyFirstSeenLog(temporary, this.label, this.validateRecord, this.limits).readAllUnlocked();
      if (rewritten.length !== plan.keep || rewritten.at(-1)?.sequence !== plan.records[plan.keep - 1]?.sequence) throw new Error(`${this.label} history rewritten without its tail does not read back as its kept records`);
      if (!(await unchanged())) throw changed();
      await rename(temporary, this.filePath);
      renamed = true;
      await syncDirectoryEntry(directory);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (renamed) throw new Error(`${this.label} history ${this.filePath} was rewritten without its records stamped ahead, which are in ${sidecar}, but syncing its directory failed (${message})`, { cause: error });
      for (const { path, stat } of written) {
        const current = await lstat(path).catch(() => null);
        if (current !== null && current.dev === stat.dev && current.ino === stat.ino) await unlink(path).catch(() => undefined);
      }
      throw new Error(`${this.label} repair failed (${message}): ${this.filePath}; nothing was changed`, { cause: error });
    }
    const kept = await this.readAllUnlocked();
    return { sidecar, kept: kept.length };
  }

  /** This log's StampedAheadRepair, for a store to hand to tradingview-mcp-repair-first-seen (BACKLOG 103-11). */
  stampedAheadRepair(): StampedAheadRepair<T> {
    return {
      label: this.label,
      path: this.filePath,
      serialize: (operation) => this.serialize(operation),
      plan: (now, toleranceMs) => this.planStampedAheadUnlocked(now, toleranceMs),
      apply: (plan, now) => this.applyStampedAheadUnlocked(plan, now),
    };
  }

  /**
   * Checks, before any write, that appending every record in order stays within the record and
   * file limits. Callers appending a batch use this so a batch cannot stop part-way on capacity.
   */
  async assertAppendCapacityUnlocked(records: T[]): Promise<void> {
    let total = 0;
    for (const record of records) {
      const bytes = Buffer.byteLength(`${JSON.stringify(record)}\n`, "utf8");
      if (bytes > this.limits.maxRecordBytes) throw new Error(`${this.label} history record is too large`);
      total += bytes;
    }
    let size = 0;
    try {
      size = (await lstat(this.filePath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (size + total > this.limits.maxFileBytes) throw new Error(`${this.label} history file is too large`);
  }

  /**
   * Checks, before any write, that appending `additions` in order after `existing` keeps the order readAllUnlocked
   * enforces between records: a contiguous sequence, a first-seen clock that never moves backwards, and no observation
   * dated after it was seen; and that the batch fits the size limits. A record that broke one of these would be written
   * and then make every later read of the log fail (BACKLOG 102-05), so a caller checks its whole batch here first and
   * writes nothing when any of it fails. `existing` must be the whole log as readAllUnlocked returned it, whose last
   * record holds the highest sequence and the latest stamp. Each record's own validity and the file's line framing are
   * not checked here.
   */
  async assertAppendableUnlocked(existing: T[], additions: T[]): Promise<void> {
    let previous = existing[existing.length - 1];
    for (const record of additions) {
      if (record.sequence !== (previous?.sequence ?? 0) + 1) {
        throw new Error(`${this.label} append would break the sequence at ${record.sequence}`);
      }
      if (previous !== undefined && record.first_seen_at < previous.first_seen_at) {
        throw new Error(`${this.label} first-seen clock moved backwards`);
      }
      if (record.observation_date > record.first_seen_at.slice(0, 10)) {
        throw new Error(`${this.label} observation_date is after first_seen_at`);
      }
      previous = record;
    }
    await this.assertAppendCapacityUnlocked(additions);
  }

  async appendUnlocked(record: T): Promise<void> {
    await this.ensureDirectory();
    const line = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    if (line.byteLength > this.limits.maxRecordBytes) throw new Error(`${this.label} history record is too large`);
    const handle = await open(
      this.filePath,
      constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | noFollowFlag(),
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`${this.label} history path must be a regular file`);
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error(`${this.label} history file must be owned by the current user`);
      }
      await assertAppendableJsonl(handle, stat.size, `${this.label} history`, this.filePath);
      await handle.chmod(0o600);
      if (stat.size + line.byteLength > this.limits.maxFileBytes) {
        throw new Error(`${this.label} history file is too large`);
      }
      const { bytesWritten } = await handle.write(line, 0, line.byteLength, null);
      if (bytesWritten !== line.byteLength) throw new Error(`short write to ${this.label} history file`);
      await handle.sync();
      await handle.chmod(0o600);
      if (stat.size === 0) {
        await syncDirectoryEntry(dirname(this.filePath));
      }
    } finally {
      await handle.close();
    }
  }

  /**
   * serialize with one budget for both waits: the in-process queue and the file lock. The forward period
   * declarations journal uses it, so a stale lock can never hold a caller for the process-wide 30 s
   * (docs/FORWARD_PERIOD_DESIGN.md, H1). On timeout the call rejects with HISTORY_LOCK_TIMEOUT, and its
   * operation never runs.
   *
   * The queue tail waits for both the predecessor and this call. So a caller that timed out never lets
   * later callers skip ahead of a predecessor that is still running. Mutual exclusion itself rests on the
   * exclusive-create file lock.
   */
  serializeWithin<R>(budgetMs: number, operation: () => Promise<R>): Promise<R> {
    const started = performance.now();
    const predecessor = pathQueues.get(this.queueKey) ?? Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queueTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(
        `timed out waiting for ${this.label} history queue after ${budgetMs}ms`), { code: "HISTORY_LOCK_TIMEOUT" })), budgetMs);
      // Not unref'd: the timer is cleared as soon as the race settles, and an unref'd one would let a process with
      // no other handles exit with this call still pending instead of timing out (F0).
    });
    const result = Promise.race([predecessor, queueTimeout]).then(async () => {
      clearTimeout(timer);
      const release = await this.acquireFileLock(Math.max(0, budgetMs - (performance.now() - started)));
      try {
        return await operation();
      } finally {
        await release();
      }
    }, (error: unknown) => {
      clearTimeout(timer);
      throw error;
    });
    const settled = result.then(() => undefined, () => undefined);
    const tail = Promise.all([predecessor, settled]).then(() => undefined);
    pathQueues.set(this.queueKey, tail);
    void tail.then(() => {
      if (pathQueues.get(this.queueKey) === tail) pathQueues.delete(this.queueKey);
    });
    return result;
  }

  serialize<R>(operation: () => Promise<R>): Promise<R> {
    const predecessor = pathQueues.get(this.queueKey) ?? Promise.resolve();
    const result = predecessor.then(async () => {
      const release = await this.acquireFileLock();
      try {
        return await operation();
      } finally {
        await release();
      }
    });
    const settled = result.then(() => undefined, () => undefined);
    pathQueues.set(this.queueKey, settled);
    void settled.then(() => {
      if (pathQueues.get(this.queueKey) === settled) pathQueues.delete(this.queueKey);
    });
    return result;
  }
}
