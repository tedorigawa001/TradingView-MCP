import { constants } from "node:fs";
import { mkdir, open, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { assertNotSymbolicLink, syncDirectoryEntry, noFollowFlag, posixModeEnforced } from "./fsDurability.js";

const MAX_RAW_BYTES = 32 * 1024 * 1024;

export const resolvePolicyRateOfficialRawArchivePath = (
  configuredPath = process.env.TRADINGVIEW_MCP_POLICY_RATE_OFFICIAL_RAW_ARCHIVE_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "policy-rate-official-raw");

export class OfficialPolicyRateRawArchive {
  constructor(private readonly directory: string) {
    if (!directory) throw new Error("official policy-rate raw archive path is required");
  }

  async store(rawSha256: string, raw: string | Buffer): Promise<{ stored: boolean; bytes: number }> {
    if (!/^sha256:[a-f0-9]{64}$/.test(rawSha256)) throw new Error("official policy-rate raw archive requires a SHA-256 key");
    const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const bytes = body.byteLength;
    if (bytes < 1 || bytes > MAX_RAW_BYTES) throw new Error("official policy-rate raw archive payload size is unsafe");
    if (`sha256:${createHash("sha256").update(body).digest("hex")}` !== rawSha256) throw new Error("official policy-rate raw archive hash does not match payload");
    await this.ensureDirectory();
    const path = join(this.directory, `${rawSha256.slice("sha256:".length)}.raw`);
    // O_EXCL catches an existing entry, but a dangling symlink is not one on
    // Windows: the open follows it and creates the target, so the archive would
    // write through the link rather than refuse it.
    await assertNotSymbolicLink(path, "official policy-rate raw archive");
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
      try {
        const written = await handle.write(body);
        if (written.bytesWritten !== bytes) throw new Error("short write to official policy-rate raw archive");
        await handle.sync();
        await handle.chmod(0o600);
      } finally {
        await handle.close();
      }
      await this.syncDirectory();
      return { stored: true, bytes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("unable to write official policy-rate raw archive", { cause: error });
      await this.assertExistingPayload(path, rawSha256, bytes);
      return { stored: false, bytes };
    }
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("official policy-rate raw archive must be a regular directory");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("official policy-rate raw archive must be owned by the current user");
    if ((posixModeEnforced() && (stat.mode & 0o077) !== 0)) throw new Error("official policy-rate raw archive permissions must not allow group or other access");
  }

  private async assertExistingPayload(path: string, expectedHash: string, expectedBytes: number): Promise<void> {
    const pathStat = await lstat(path);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error("official policy-rate raw archive existing path is unsafe");
    const handle = await open(path, constants.O_RDONLY | noFollowFlag());
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("official policy-rate raw archive path must be a regular file");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("official policy-rate raw archive file must be owned by the current user");
      if ((posixModeEnforced() && (stat.mode & 0o077) !== 0)) throw new Error("official policy-rate raw archive file permissions must be 0600 or stricter");
      if (stat.size !== expectedBytes || stat.size > MAX_RAW_BYTES) throw new Error("official policy-rate raw archive existing payload size does not match");
      const body = await handle.readFile();
      const actual = `sha256:${createHash("sha256").update(body).digest("hex")}`;
      if (actual !== expectedHash) throw new Error("official policy-rate raw archive existing payload hash does not match");
    } finally {
      await handle.close();
    }
  }

  private async syncDirectory(): Promise<void> {
    await syncDirectoryEntry(this.directory);
  }
}
