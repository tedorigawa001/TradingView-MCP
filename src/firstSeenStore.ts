import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { assertNotSymbolicLink, syncDirectoryEntry, noFollowFlag, openExclusiveFile, posixModeEnforced } from "./fsDurability.js";

const LOCK_WAIT_MS = 2_000;

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
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly label: string,
    private readonly validateRecord: (value: unknown, line?: number) => T,
    private readonly limits: { maxFileBytes: number; maxRecordBytes: number },
  ) {
    if (!filePath) throw new Error(`${label} history path is required`);
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

  async acquireFileLock(): Promise<() => Promise<void>> {
    await this.ensureDirectory();
    const lockPath = `${this.filePath}.lock`;
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
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
        if (Date.now() >= deadline) throw new Error(`timed out acquiring ${this.label} history lock`);
        await new Promise((resolve) => setTimeout(resolve, 25));
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

  serialize<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.queue.then(async () => {
      const release = await this.acquireFileLock();
      try {
        return await operation();
      } finally {
        await release();
      }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
