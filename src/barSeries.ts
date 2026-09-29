import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, link, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openExclusiveFile, posixModeEnforced, syncDirectoryEntry } from "./fsDurability.js";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { ENTRY_RESERVED_SERIES_PREFIXES } from "./forecastSet.js";

/**
 * Fixed-interval close series for compute_realized_covariance (docs/REALIZED_COVARIANCE_DESIGN.md,
 * section "Bar series artifact"). One content-addressed artifact per series; the store follows the
 * forecast-set store.
 */
export const BAR_SERIES_MAX_BARS = 600_000;
export const BAR_SERIES_MAX_BYTES = 32 * 1024 * 1024;
/** 2100-01-01T00:00:00Z in Unix seconds (plan section 7). */
export const BAR_SERIES_MAX_OPEN_TIME = 4_102_444_800;

const idSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const barSeriesInputSchema = z.object({
  schema_version: z.literal("1.0"),
  source_id: idSchema,
  source_sha256: hashSchema,
  evidence_tier: z.enum(["historical_exploration", "prospective", "synthetic_test"]),
  series_id: idSchema,
  interval_minutes: z.number().int().min(1).max(1440),
  open_time: z.array(z.number().int().min(0).max(BAR_SERIES_MAX_OPEN_TIME)).min(1).max(BAR_SERIES_MAX_BARS),
  close: z.array(z.number().finite().nullable()).min(1).max(BAR_SERIES_MAX_BARS),
}).strict();

export interface BarSeries {
  schema_version: "1.0";
  source_id: string;
  source_sha256: string;
  evidence_tier: "historical_exploration" | "prospective" | "synthetic_test";
  series_id: string;
  interval_minutes: number;
  /** Unix seconds of each bar's open, strictly increasing and on the interval grid. */
  open_time: number[];
  /** As imported. Null or non-positive closes count as missing when computing. */
  close: (number | null)[];
}

const digest = (body: string | Buffer) => `sha256:${createHash("sha256").update(body).digest("hex")}`;

function fail(message: string): never {
  throw new Error(`invalid bar series: ${message}`);
}

/** Validate and normalize to the canonical form, with a fixed key order. */
export function normalizeBarSeries(input: unknown, options: { maxBytes?: number } = {}): { series: BarSeries; artifact_id: string; bytes: number } {
  const raw = barSeriesInputSchema.parse(input);
  if (1440 % raw.interval_minutes !== 0) fail("interval_minutes must divide 1440");
  if (ENTRY_RESERVED_SERIES_PREFIXES.some((prefix) => raw.series_id.startsWith(prefix))) fail("series_id uses a reserved prefix");
  if (raw.close.length !== raw.open_time.length) fail(`close has ${raw.close.length} entries for ${raw.open_time.length} bars`);
  const step = raw.interval_minutes * 60;
  for (let i = 0; i < raw.open_time.length; i++) {
    if (raw.open_time[i] % step !== 0) fail(`open_time[${i}] is not on the ${raw.interval_minutes}-minute grid`);
    // Duplicate or non-increasing times are integrity findings, rejected at import as in #100.
    if (i > 0 && !(raw.open_time[i - 1] < raw.open_time[i])) fail("open_time must be strictly increasing");
  }
  const series: BarSeries = {
    schema_version: raw.schema_version,
    source_id: raw.source_id,
    source_sha256: raw.source_sha256,
    evidence_tier: raw.evidence_tier,
    series_id: raw.series_id,
    interval_minutes: raw.interval_minutes,
    open_time: [...raw.open_time],
    close: [...raw.close],
  };
  const body = JSON.stringify(series);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > (options.maxBytes ?? BAR_SERIES_MAX_BYTES)) fail("normalized series exceeds the size limit");
  return { series, artifact_id: digest(body), bytes };
}

export const resolveBarSeriesDirectory = () => process.env.TRADINGVIEW_MCP_BAR_SERIES_DIR?.trim()
  || join(homedir(), ".tradingview-mcp", "bar-series");

function ownerOnly(stat: Awaited<ReturnType<typeof lstat>>): void {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("bar series store must belong to current user");
  if (posixModeEnforced() && (Number(stat.mode) & 0o077)) throw new Error("bar series store must be owner-only");
}

export class BarSeriesStore {
  constructor(private readonly directory = resolveBarSeriesDirectory()) {}

  private async checkDirectory(): Promise<void> {
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("bar series directory must be a regular directory");
    ownerOnly(stat);
  }

  async get(artifactId: string): Promise<BarSeries> {
    hashSchema.parse(artifactId);
    await this.checkDirectory();
    const body = await readBacktestLedgerFile(join(this.directory, `${artifactId.slice(7)}.json`), true);
    // Hash the bytes as stored, before any decoding.
    if (digest(body) !== artifactId) throw new Error("bar series artifact hash mismatch");
    const { series, artifact_id } = normalizeBarSeries(JSON.parse(body.toString("utf8")));
    if (artifact_id !== artifactId) throw new Error("bar series is not in normalized form");
    return series;
  }

  async register(input: unknown): Promise<{ artifact_id: string; series_id: string; bars: number; interval_minutes: number }> {
    const { series, artifact_id } = normalizeBarSeries(input);
    const body = Buffer.from(JSON.stringify(series));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.checkDirectory();
    const temporary = join(this.directory, `.pending-${randomUUID()}`);
    const destination = join(this.directory, `${artifact_id.slice(7)}.json`);
    const handle = await openExclusiveFile(temporary, "bar series");
    try {
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
      // Publish a fully synced immutable file; never expose a partially written artifact.
      try { await link(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await this.get(artifact_id);
      await syncDirectoryEntry(this.directory);
    } finally { await unlink(temporary); }
    return { artifact_id, series_id: series.series_id, bars: series.open_time.length, interval_minutes: series.interval_minutes };
  }
}
