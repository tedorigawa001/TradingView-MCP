import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { attemptLockFile, lockBeingReleased, noFollowFlag, posixModeEnforced } from "./fsDurability.js";

const LOCK_WAIT_MS = 30_000;
const STALE_LOCK_MS = 10 * 60_000;

export const resolveChartOperationLockPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_CHART_OPERATION_LOCK_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "chart-operation.lock");

/** Serializes all TradingView chart access across the MCP server and batch CLIs. */
export class ChartOperationLock {
  constructor(private readonly filePath = resolveChartOperationLockPath()) {}

  private async ensureDirectory() {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (posixModeEnforced() && (stat.mode & 0o077) !== 0)) {
      throw new Error("chart operation lock directory is unsafe");
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error("chart operation lock directory must be owned by the current user");
    }
  }

  /** true: look again at once; false: wait; a Windows refusal: wait, and name it if the deadline passes (BACKLOG 102-39). */
  private async reclaimStaleLock(observed: Awaited<ReturnType<typeof lstat>>): Promise<boolean | NodeJS.ErrnoException> {
    if (Date.now() - Number(observed.mtimeMs) <= STALE_LOCK_MS) return false;
    if (typeof process.getuid === "function" && observed.uid !== process.getuid()) {
      throw new Error(`chart operation lock must be owned by the current user: ${this.filePath}`);
    }
    let handle;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | noFollowFlag());
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== observed.ino) return true;
      const contents = await handle.readFile("utf8");
      // Closed before the unlink: on Windows an open handle keeps a deleted name taken.
      await handle.close();
      handle = undefined;
      const ownerPid = contents.match(/^[0-9a-f-]{36}\s+(\d+)\n$/i)?.[1];
      if (ownerPid) {
        try { process.kill(Number(ownerPid), 0); return false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
      }
      const current = await lstat(this.filePath);
      if (current.ino !== opened.ino || current.mtimeMs !== opened.mtimeMs) return true;
      await unlink(this.filePath);
      return true;
    } catch (error) {
      // Gone since it was found: look again at once. Being deleted on Windows: wait for it, within the deadline.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      if (lockBeingReleased(error)) return error as NodeJS.ErrnoException;
      throw error;
    } finally { await handle?.close(); }
  }

  async acquire(): Promise<() => Promise<void>> {
    await this.ensureDirectory();
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    const timedOut = (cause: NodeJS.ErrnoException | null) => new Error(
      `timed out acquiring chart operation lock at ${this.filePath}`,
      { cause: cause ?? undefined },
    );
    // The deadline is checked before every attempt but the first, an immediate retry included, and no two retries in a
    // row skip the sleep: a lock that kept vanishing or being recreated would otherwise be retried for good (BACKLOG
    // 102-39).
    let refusal: NodeJS.ErrnoException | null = null;
    let retriedAtOnce = false;
    for (let attempted = false; ; attempted = true) {
      if (attempted && Date.now() >= deadline) throw timedOut(refusal);
      const attempt = await attemptLockFile(this.filePath, "chart operation lock", `${token} ${process.pid}\n`);
      if (attempt.taken) {
        return async () => {
          // The read handle is closed before the unlink: on Windows an open handle keeps a deleted name taken, which
          // makes the next owner wait (BACKLOG 102-39).
          let owner;
          try {
            owner = await open(this.filePath, constants.O_RDONLY | noFollowFlag());
            const before = await owner.stat();
            const contents = await owner.readFile("utf8");
            await owner.close();
            owner = undefined;
            const current = await lstat(this.filePath);
            if (!before.isFile() || current.ino !== before.ino || !contents.startsWith(`${token} `)) {
              throw new Error("chart operation lock ownership was lost");
            }
            await unlink(this.filePath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          } finally { await owner?.close(); }
        };
      }
      // Held by another process, or being deleted on Windows: waited for alike (BACKLOG 102-39).
      refusal = attempt.refusal;
      let again = false;
      if (attempt.held) {
        if (!attempt.held.isFile() || attempt.held.isSymbolicLink()) throw new Error("chart operation lock path is unsafe");
        const reclaimed = await this.reclaimStaleLock(attempt.held);
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
}

/**
 * Runs chart operations one at a time in this process, each under the lock shared with the batch CLIs. The lock is held
 * until the operation settles, so an operation must end on its own: nothing here cuts it short, since releasing the lock
 * while it still drove the chart would let another process act on the same chart. A failed operation releases the lock
 * and lets the next one run.
 */
export class SerialOperationQueue {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly lock: Pick<ChartOperationLock, "acquire">) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const release = await this.lock.acquire();
      try { return await operation(); } finally { await release(); }
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
