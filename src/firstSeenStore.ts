import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { assertNotSymbolicLink, syncDirectoryEntry, noFollowFlag, openExclusiveFile, posixModeEnforced } from "./fsDurability.js";

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
    const timeout = () => Object.assign(new Error(
      `timed out acquiring ${this.label} history lock after ${Math.round(budgetMs)}ms: ${lockPath}; ` +
      "another process may still hold it; do not remove a live owner's lock",
    ), { code: "HISTORY_LOCK_TIMEOUT" });
    let attempted = false;
    while (true) {
      if (attempted && performance.now() >= deadline) throw timeout();
      attempted = true;
      try {
        const handle = await openExclusiveFile(lockPath, `${this.label} lock`);
        try {
          await handle.writeFile(`${token} ${process.pid}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        return async () => {
          let handle;
          try {
            handle = await open(lockPath, constants.O_RDONLY | noFollowFlag());
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
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new Error(`unable to acquire ${this.label} history lock`, { cause: err });
        }
        let stat;
        try {
          stat = await lstat(lockPath);
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw statError;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${this.label} history lock path is unsafe`);
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw timeout();
        // Jitter reduces synchronized polling by collectors in different processes.
        await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 25 + Math.random() * 50)));
      }
    }
  }

  async readAllUnlocked(): Promise<T[]> {
    let handle;
    await assertNotSymbolicLink(this.filePath, `${this.label} history`);
    try {
      handle = await open(this.filePath, constants.O_RDONLY | noFollowFlag());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
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
      const records = text.trim().split("\n").filter(Boolean).map((line, index) => {
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
      return records;
    } finally {
      await handle.close();
    }
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
   * Checks, before any write, that appending `additions` in order after `existing` (the log as read) keeps every
   * invariant readAllUnlocked enforces: a contiguous sequence, a first-seen clock that never moves backwards, and no
   * observation dated after it was seen; and that the batch fits the size limits. A record that broke one of these would
   * be written and then make every later read of the log fail (BACKLOG 102-05), so a caller checks its whole batch here
   * first and writes nothing when any of it fails.
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
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | noFollowFlag(),
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`${this.label} history path must be a regular file`);
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error(`${this.label} history file must be owned by the current user`);
      }
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
