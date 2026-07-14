import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const LOCK_WAIT_MS = 2_000;

export type EvaluationLogEntry = {
  schema_version: "1.0";
  snapshot_id: string;
  recorded_at: string;
  kind: "snapshot" | "features" | "outcome";
  payload: Record<string, unknown>;
};

/**
 * Local evaluation-pipeline storage. This is deliberately not an MCP tool:
 * callers choose the lifecycle, retention, and outcome-labelling policy.
 */
export class AppendOnlyEvaluationLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async acquireLock(): Promise<() => Promise<void>> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockPath = `${this.filePath}.lock`;
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      try {
        const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(`${token} ${process.pid}\n`, "utf8"); } finally { await handle.close(); }
        return async () => {
          let handle;
          try {
            handle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
            const stat = await handle.stat();
            const contents = await handle.readFile("utf8");
            await handle.close();
            handle = undefined;
            const current = await lstat(lockPath);
            if (current.ino !== stat.ino) throw new Error("evaluation log lock ownership was lost");
            if (!contents.startsWith(`${token} `)) throw new Error("evaluation log lock ownership was lost");
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
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("evaluation log lock path is unsafe");
        if (Date.now() >= deadline) throw new Error("timed out acquiring evaluation log lock");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
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

  private async readAllUnlocked(): Promise<EvaluationLogEntry[]> {
    let handle;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("evaluation log path must be a regular file", { cause: err });
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("evaluation log path must be a regular file");
      const text = await handle.readFile("utf8");
      return text.trim().split("\n").filter(Boolean).map((line, index) => {
        try { return JSON.parse(line) as EvaluationLogEntry; } catch { throw new Error(`invalid JSONL record at line ${index + 1}`); }
      });
    } finally {
      await handle.close();
    }
  }

  async append(entry: Omit<EvaluationLogEntry, "recorded_at"> & { recorded_at?: string }): Promise<EvaluationLogEntry> {
    if (!/^[0-9a-f-]{36}$/i.test(entry.snapshot_id)) {
      throw new Error("snapshot_id must be a UUID");
    }
    if (!entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) {
      throw new Error("payload must be an object");
    }
    const record: EvaluationLogEntry = {
      ...entry,
      recorded_at: entry.recorded_at ?? new Date().toISOString(),
    };
    if (Number.isNaN(Date.parse(record.recorded_at))) {
      throw new Error("recorded_at must be an ISO-8601 timestamp");
    }

    return this.serialize(async () => {
      const existing = await this.readAllUnlocked();
      if (record.kind === "snapshot" && existing.some((candidate) =>
        candidate.kind === "snapshot" && candidate.snapshot_id === record.snapshot_id)) {
        throw new Error(`snapshot ${record.snapshot_id} is already recorded`);
      }
      const handle = await open(
        this.filePath,
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error("evaluation log path must be a regular file");
        await handle.chmod(0o600);
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return record;
    });
  }

  async readBySnapshotId(snapshotId: string): Promise<EvaluationLogEntry[]> {
    if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) throw new Error("snapshot_id must be a UUID");
    let text: string;
    try { text = await readFile(this.filePath, "utf8"); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return text.trim().split("\n").filter(Boolean).map((line, index) => {
      try { return JSON.parse(line) as EvaluationLogEntry; } catch { throw new Error(`invalid JSONL record at line ${index + 1}`); }
    }).filter((record) => record.snapshot_id === snapshotId);
  }

  async readAll(): Promise<EvaluationLogEntry[]> {
    try {
      const text = await readFile(this.filePath, "utf8");
      return text.trim().split("\n").filter(Boolean).map((line, index) => {
        try { return JSON.parse(line) as EvaluationLogEntry; } catch { throw new Error(`invalid JSONL record at line ${index + 1}`); }
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
}
