import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { noFollowFlag, posixModeEnforced } from "./fsDurability.js";

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

  private async reclaimStaleLock(observed: Awaited<ReturnType<typeof lstat>>): Promise<boolean> {
    if (Date.now() - Number(observed.mtimeMs) <= STALE_LOCK_MS) return false;
    if (typeof process.getuid === "function" && observed.uid !== process.getuid()) {
      throw new Error(`chart operation lock must be owned by the current user: ${this.filePath}`);
    }
    const handle = await open(this.filePath, constants.O_RDONLY | noFollowFlag());
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== observed.ino) return true;
      const contents = await handle.readFile("utf8");
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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    } finally { await handle.close(); }
  }

  async acquire(): Promise<() => Promise<void>> {
    await this.ensureDirectory();
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      try {
        const handle = await open(this.filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
        try { await handle.writeFile(`${token} ${process.pid}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
        return async () => {
          const owner = await open(this.filePath, constants.O_RDONLY | noFollowFlag());
          try {
            const before = await owner.stat();
            const contents = await owner.readFile("utf8");
            const current = await lstat(this.filePath);
            if (!before.isFile() || current.ino !== before.ino || !contents.startsWith(`${token} `)) {
              throw new Error("chart operation lock ownership was lost");
            }
            await unlink(this.filePath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          } finally { await owner.close(); }
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let stat;
        try { stat = await lstat(this.filePath); } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw statError;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("chart operation lock path is unsafe");
        if (await this.reclaimStaleLock(stat)) continue;
        if (Date.now() >= deadline) throw new Error(`timed out acquiring chart operation lock at ${this.filePath}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
}
