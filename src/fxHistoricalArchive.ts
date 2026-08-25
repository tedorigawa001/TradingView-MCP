import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { noFollowFlag } from "./fsDurability.js";

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

export const resolveFxHistoricalArchivePath = (configuredPath = process.env.TRADINGVIEW_MCP_FX_HISTORY_RAW_ARCHIVE_PATH): string =>
  configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "fx-history-raw");

/** Immutable, owner-only content-addressed storage for upstream candle responses. */
export class FxHistoricalArchive {
  constructor(private readonly directory: string) {
    if (!directory) throw new Error("FX historical raw archive path is required");
  }

  async store(rawSha256: string, raw: Buffer): Promise<{ stored: boolean; bytes: number }> {
    if (!/^sha256:[a-f0-9]{64}$/.test(rawSha256)) throw new Error("FX historical raw archive requires a SHA-256 key");
    if (raw.byteLength < 1 || raw.byteLength > MAX_ARCHIVE_BYTES) throw new Error("FX historical raw archive payload size is unsafe");
    if (`sha256:${createHash("sha256").update(raw).digest("hex")}` !== rawSha256) throw new Error("FX historical raw archive hash does not match payload");
    await this.ensureDirectory();
    const path = join(this.directory, `${rawSha256.slice(7)}.raw`);
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
      try { const written = await handle.write(raw); if (written.bytesWritten !== raw.byteLength) throw new Error("short write to FX historical raw archive"); await handle.sync(); } finally { await handle.close(); }
      return { stored: true, bytes: raw.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("unable to write FX historical raw archive", { cause: error });
      const existing = await open(path, constants.O_RDONLY | noFollowFlag());
      try {
        const stat = await existing.stat();
        if (!stat.isFile() || stat.size !== raw.byteLength || (stat.mode & 0o077) !== 0) throw new Error("FX historical raw archive existing payload is unsafe");
        const body = await existing.readFile();
        if (`sha256:${createHash("sha256").update(body).digest("hex")}` !== rawSha256) throw new Error("FX historical raw archive existing payload hash does not match");
      } finally { await existing.close(); }
      return { stored: false, bytes: raw.byteLength };
    }
  }

  async read(rawSha256: string): Promise<Buffer> {
    if (!/^sha256:[a-f0-9]{64}$/.test(rawSha256)) throw new Error("FX historical raw archive requires a SHA-256 key");
    await this.ensureDirectory();
    const path = join(this.directory, `${rawSha256.slice(7)}.raw`);
    const handle = await open(path, constants.O_RDONLY | noFollowFlag());
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_ARCHIVE_BYTES || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("FX historical raw archive payload is unsafe");
      const body = await handle.readFile();
      if (`sha256:${createHash("sha256").update(body).digest("hex")}` !== rawSha256) throw new Error("FX historical raw archive payload hash does not match");
      return body;
    } finally { await handle.close(); }
  }

  private async ensureDirectory() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("FX historical raw archive directory is unsafe");
  }
}
