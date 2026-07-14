import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 2_048;
const LOCK_WAIT_MS = 2_000;
const SERIES = "US_TREASURY_PAR_REAL_CMT_10Y";
const UNIT = "percent_per_annum_bond_equivalent";
const SOURCE = "us_treasury";

export const resolveRealYieldHistoryPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_REAL_YIELD_HISTORY_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "real-yield-first-seen.jsonl");

export type RealYieldFirstSeenRecord = {
  schema_version: "1.1";
  sequence: number;
  series: typeof SERIES;
  observation_date: string;
  value: number;
  unit: typeof UNIT;
  source: typeof SOURCE;
  first_seen_at: string;
  source_updated_at_raw: string | null;
  observed_feed_year: number;
};

export type RealYieldObservationVersion = Pick<
  RealYieldFirstSeenRecord,
  "series" | "observation_date" | "value" | "source_updated_at_raw"
> & { observed_at: string; observed_feed_year: number };

const isCalendarDate = (value: string): boolean => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
};

const isCanonicalTimestamp = (value: string): boolean => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const validateRecord = (value: unknown, line?: number): RealYieldFirstSeenRecord => {
  const suffix = line === undefined ? "" : ` at line ${line}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid real-yield history record${suffix}`);
  }
  const record = value as Partial<RealYieldFirstSeenRecord>;
  if (record.schema_version !== "1.1" || record.series !== SERIES || record.unit !== UNIT || record.source !== SOURCE) {
    throw new Error(`unsupported real-yield history schema${suffix}`);
  }
  if (!Number.isSafeInteger(record.sequence) || (record.sequence ?? 0) < 1) {
    throw new Error(`invalid real-yield sequence${suffix}`);
  }
  if (typeof record.observation_date !== "string" || !isCalendarDate(record.observation_date)) {
    throw new Error(`invalid real-yield observation_date${suffix}`);
  }
  if (typeof record.value !== "number" || !Number.isFinite(record.value) || record.value < -25 || record.value > 25) {
    throw new Error(`invalid real-yield value${suffix}`);
  }
  if (typeof record.first_seen_at !== "string" || !isCanonicalTimestamp(record.first_seen_at)) {
    throw new Error(`invalid real-yield first_seen_at${suffix}`);
  }
  if (record.observation_date > record.first_seen_at.slice(0, 10)) {
    throw new Error(`real-yield observation_date is after first_seen_at${suffix}`);
  }
  if (record.source_updated_at_raw !== null && typeof record.source_updated_at_raw !== "string") {
    throw new Error(`invalid real-yield source_updated_at_raw${suffix}`);
  }
  if (typeof record.source_updated_at_raw === "string" && record.source_updated_at_raw.length > 256) {
    throw new Error(`real-yield source_updated_at_raw is too long${suffix}`);
  }
  if (typeof record.observed_feed_year !== "number" || !Number.isInteger(record.observed_feed_year) ||
      record.observed_feed_year < 1990 || record.observed_feed_year > 2200) {
    throw new Error(`invalid real-yield observed_feed_year${suffix}`);
  }
  return record as RealYieldFirstSeenRecord;
};

export class RealYieldFirstSeenStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    if (!filePath) throw new Error("real-yield history path is required");
  }

  private async ensureDirectory(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("real-yield history directory must be a regular directory");
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error("real-yield history directory must be owned by the current user");
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error("real-yield history directory permissions must not allow group or other access");
    }
  }

  private async acquireFileLock(): Promise<() => Promise<void>> {
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
            if (!stat.isFile()) throw new Error("real-yield history lock path is unsafe");
            const contents = await handle.readFile("utf8");
            await handle.close();
            handle = undefined;
            const current = await lstat(lockPath);
            if (current.ino !== stat.ino || !contents.startsWith(`${token} `)) {
              throw new Error("real-yield history lock ownership was lost");
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
          throw new Error("unable to acquire real-yield history lock", { cause: err });
        }
        let stat;
        try {
          stat = await lstat(lockPath);
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw statError;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("real-yield history lock path is unsafe");
        if (Date.now() >= deadline) throw new Error("timed out acquiring real-yield history lock");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async readAllUnlocked(): Promise<RealYieldFirstSeenRecord[]> {
    let handle;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("unable to open real-yield history as a regular file", { cause: err });
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("real-yield history path must be a regular file");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error("real-yield history file must be owned by the current user");
      }
      if ((stat.mode & 0o077) !== 0) throw new Error("real-yield history file permissions must be 0600 or stricter");
      if (stat.size > MAX_HISTORY_BYTES) throw new Error("real-yield history file is too large");
      const text = await handle.readFile("utf8");
      const records = text.trim().split("\n").filter(Boolean).map((line, index) => {
        if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) {
          throw new Error(`real-yield history record is too large at line ${index + 1}`);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          throw new Error(`invalid real-yield history JSON at line ${index + 1}`);
        }
        return validateRecord(parsed, index + 1);
      });
      let previousFirstSeen = "";
      for (const [index, record] of records.entries()) {
        if (record.sequence !== index + 1) {
          throw new Error(`non-contiguous real-yield sequence at line ${index + 1}`);
        }
        if (record.first_seen_at < previousFirstSeen) {
          throw new Error(`real-yield first_seen_at moved backwards at line ${index + 1}`);
        }
        if (record.observation_date > record.first_seen_at.slice(0, 10)) {
          throw new Error(`real-yield observation_date is after first_seen_at at line ${index + 1}`);
        }
        previousFirstSeen = record.first_seen_at;
      }
      return records;
    } finally {
      await handle.close();
    }
  }

  private async appendUnlocked(record: RealYieldFirstSeenRecord): Promise<void> {
    await this.ensureDirectory();
    const line = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
    if (line.byteLength > MAX_RECORD_BYTES) throw new Error("real-yield history record is too large");
    const handle = await open(
      this.filePath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("real-yield history path must be a regular file");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error("real-yield history file must be owned by the current user");
      }
      await handle.chmod(0o600);
      if (stat.size + line.byteLength > MAX_HISTORY_BYTES) {
        throw new Error("real-yield history file is too large");
      }
      const { bytesWritten } = await handle.write(line, 0, line.byteLength, null);
      if (bytesWritten !== line.byteLength) throw new Error("short write to real-yield history file");
      await handle.sync();
      await handle.chmod(0o600);
      if (stat.size === 0) {
        const directoryHandle = await open(dirname(this.filePath), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } finally {
      await handle.close();
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
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

  async observe(version: RealYieldObservationVersion): Promise<RealYieldFirstSeenRecord> {
    return (await this.observeMany([version]))[0];
  }

  async observeMany(versions: RealYieldObservationVersion[]): Promise<RealYieldFirstSeenRecord[]> {
    if (versions.length === 0 || versions.length > 400) {
      throw new Error("real-yield observation batch must contain 1 to 400 versions");
    }
    return this.serialize(async () => {
      const seenDates = new Set<string>();
      const candidates = versions.map((version) => {
        if (seenDates.has(version.observation_date)) {
          throw new Error(`duplicate real-yield observation_date in batch ${version.observation_date}`);
        }
        seenDates.add(version.observation_date);
        return validateRecord({
        schema_version: "1.1",
        sequence: 1,
        series: version.series,
        observation_date: version.observation_date,
        value: version.value,
        unit: UNIT,
        source: SOURCE,
        first_seen_at: new Date(version.observed_at).toISOString(),
        source_updated_at_raw: version.source_updated_at_raw,
        observed_feed_year: version.observed_feed_year,
      });
      });
      const records = await this.readAllUnlocked();
      const latestFirstSeen = records.map((record) => record.first_seen_at).sort().at(-1);
      const latestForDate = (candidate: RealYieldFirstSeenRecord) => records
        .filter((record) => record.series === candidate.series && record.observation_date === candidate.observation_date)
        .sort((a, b) => b.sequence - a.sequence)[0];
      if (latestFirstSeen && candidates.some((candidate) =>
        latestForDate(candidate)?.value !== candidate.value && candidate.first_seen_at < latestFirstSeen)) {
        throw new Error("real-yield first-seen clock moved backwards");
      }
      const results: RealYieldFirstSeenRecord[] = [];
      let nextSequence = records.reduce((maximum, record) => Math.max(maximum, record.sequence), 0);
      for (const candidate of candidates) {
        const current = latestForDate(candidate);
        if (current?.value === candidate.value) {
          results.push(current);
          continue;
        }
        const version = { ...candidate, sequence: ++nextSequence };
        await this.appendUnlocked(version);
        records.push(version);
        results.push(version);
      }
      return results;
    });
  }

  async getAsOf(asOf: Date): Promise<RealYieldFirstSeenRecord | null> {
    if (!Number.isFinite(asOf.getTime())) throw new Error("as_of must be a valid timestamp");
    const asOfIso = asOf.toISOString();
    return this.serialize(async () => {
      const eligible = (await this.readAllUnlocked()).filter((record) => record.first_seen_at <= asOfIso);
      eligible.sort((a, b) =>
        b.observation_date.localeCompare(a.observation_date) ||
        b.first_seen_at.localeCompare(a.first_seen_at) ||
        b.sequence - a.sequence);
      return eligible[0] ?? null;
    });
  }
}
