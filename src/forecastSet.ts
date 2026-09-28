import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, link, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openExclusiveFile, posixModeEnforced, syncDirectoryEntry } from "./fsDurability.js";
import { readBacktestLedgerFile } from "./backtestLedger.js";

/**
 * Forecast evaluation sets for compare_forecast_losses (docs/FORECAST_LOSS_COMPARISON_DESIGN.md,
 * section "Input"). One normalization and one hash serve both the stored artifact and the inline
 * path, so the same content always gets the same artifact_id.
 */
export const FORECAST_SET_MAX_DATES = 5_000;
export const FORECAST_SET_INLINE_MAX_DATES = 2_000;
export const FORECAST_SET_MAX_BYTES = 24 * 1024 * 1024;
export const FORECAST_SET_MAX_DIMENSION = 8;
export const FORECAST_SET_MAX_LABELS = 50;
export const RESERVED_SERIES_PREFIXES = ["ledger-source:", "forecast-set-source:"] as const;

const idSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s, "invalid canonical UTC timestamp");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => Number.isFinite(Date.parse(`${s}T00:00:00.000Z`))
    && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s, "invalid calendar date");
const finite = z.number().finite();
/** A day's value: a scalar, a full matrix, or null (a missing forecast or proxy is data, not an error). */
const valueSchema = z.union([finite, z.array(z.array(finite).min(1).max(FORECAST_SET_MAX_DIMENSION))
  .min(1).max(FORECAST_SET_MAX_DIMENSION), z.null()]);
const labelSchema = z.string().min(1).max(64);

export const forecastSetInputSchema = z.object({
  schema_version: z.literal("1.0"),
  source_id: idSchema,
  source_sha256: hashSchema,
  evidence_tier: z.enum(["historical_exploration", "prospective", "synthetic_test"]),
  horizon: z.literal(1),
  n: z.number().int().min(1).max(FORECAST_SET_MAX_DIMENSION),
  underlying_series_ids: z.array(idSchema).min(1).max(FORECAST_SET_MAX_DIMENSION),
  dates: z.array(dateSchema).min(1).max(FORECAST_SET_MAX_DATES),
  windows: z.array(z.object({ from: timeSchema, to: timeSchema }).strict()).min(1).max(FORECAST_SET_MAX_DATES),
  a: z.array(valueSchema).min(1).max(FORECAST_SET_MAX_DATES),
  b: z.array(valueSchema).min(1).max(FORECAST_SET_MAX_DATES),
  primary: z.array(valueSchema).min(1).max(FORECAST_SET_MAX_DATES),
  secondary: z.array(valueSchema).min(1).max(FORECAST_SET_MAX_DATES).optional(),
  labels: z.array(labelSchema).min(1).max(FORECAST_SET_MAX_DATES).optional(),
}).strict();

export type ForecastValue = number | number[][] | null;
export interface ForecastSet {
  schema_version: "1.0";
  source_id: string;
  source_sha256: string;
  evidence_tier: "historical_exploration" | "prospective" | "synthetic_test";
  horizon: 1;
  n: number;
  underlying_series_ids: string[];
  dates: string[];
  windows: { from: string; to: string }[];
  a: ForecastValue[];
  b: ForecastValue[];
  primary: ForecastValue[];
  secondary: ForecastValue[] | null;
  labels: string[] | null;
}

const digest = (body: string | Buffer) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
const previousDay = (date: string) => new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);

function fail(message: string): never {
  throw new Error(`invalid forecast set: ${message}`);
}

/** n = 1 values become scalars; otherwise every non-null value must be a full n x n matrix. */
function canonicalValue(value: z.infer<typeof valueSchema>, n: number, where: string): ForecastValue {
  if (value === null) return null;
  if (typeof value === "number") {
    if (n !== 1) fail(`${where} is a scalar but n = ${n}`);
    return value;
  }
  if (value.length !== n || value.some((row) => row.length !== n)) fail(`${where} is not a ${n} x ${n} matrix`);
  return n === 1 ? value[0][0] : value.map((row) => [...row]);
}

const zeroValue = (value: number | number[][]) => typeof value === "number" ? value === 0 : value.every((row) => row.every((x) => x === 0));
// Math.hypot scales internally, so norms of very small or very large matrices neither underflow nor
// overflow; squaring raw entries let a rescaled set evade both copy rules (code review R-L3).
const frobenius = (value: number | number[][]) => typeof value === "number" ? Math.abs(value) : Math.hypot(...value.flat());
const scaledDifference = (p2: number | number[][], p: number | number[][], lambda: number) => typeof p2 === "number"
  ? Math.abs(p2 - lambda * (p as number))
  : Math.hypot(...p2.flatMap((row, i) => row.map((x, j) => x - lambda * (p as number[][])[i][j])));

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Design N2/M3/P1: a secondary proxy identical to the primary, or a single-λ scaled copy of it, is
 * rejected as input. λ is the median of ‖P₂‖/‖P‖ over days where both are present and nonzero; a
 * scaled copy needs at least 2 such days, all within 1e-12 relative. Other days do not enter.
 */
export function secondaryCopyReason(primary: ForecastValue[], secondary: ForecastValue[]): "identical" | "scaled_copy" | null {
  if (JSON.stringify(primary) === JSON.stringify(secondary)) return "identical";
  const pairs: [number | number[][], number | number[][]][] = [];
  for (let i = 0; i < primary.length; i++) {
    const p = primary[i], p2 = secondary[i];
    if (p === null || p2 === null || zeroValue(p) || zeroValue(p2)) continue;
    pairs.push([p, p2]);
  }
  if (pairs.length < 2) return null;
  const lambda = median(pairs.map(([p, p2]) => frobenius(p2) / frobenius(p)));
  if (!(lambda > 0) || !Number.isFinite(lambda)) return null;
  return pairs.every(([p, p2]) => scaledDifference(p2, p, lambda) <= 1e-12 * frobenius(p2)) ? "scaled_copy" : null;
}

/**
 * Relative tolerance of the near-copy measure: 0.1%. A copy that went through a common export format
 * still counts: printf/awk %g keeps 6 significant digits (relative error up to 5e-6), and fixed
 * decimals such as %.8f on variances near 1e-4 err by up to about 1e-4 (code review R-M1, R2-M1).
 * Genuinely different proxies measured in the review stay below the majority line at this
 * tolerance (below about 0.45 of days across seeds, for proxies with five or more price changes a day).
 */
export const NEAR_COPY_TOLERANCE = 1e-3;

/**
 * Near-copy measure (code review M2). Over days where both proxies are present and nonzero, the
 * largest group of days on which P₂ = λP for one common λ: each day's P₂ is within the tolerance of
 * r·P with r = ‖P₂‖/‖P‖, and the group's ratios agree within the tolerance. A copy of the primary
 * altered on a few days, which the all-days rule above does not reject, still forms a large group.
 */
export function largestCommonScaleGroup(primary: ForecastValue[], secondary: ForecastValue[]): { jointly_nonzero: number; largest_group: number } {
  const ratios: number[] = [];
  let jointlyNonzero = 0;
  for (let i = 0; i < primary.length; i++) {
    const p = primary[i], p2 = secondary[i];
    if (p === null || p2 === null || zeroValue(p) || zeroValue(p2)) continue;
    jointlyNonzero++;
    const ratio = frobenius(p2) / frobenius(p);
    if (ratio > 0 && Number.isFinite(ratio) && scaledDifference(p2, p, ratio) <= NEAR_COPY_TOLERANCE * frobenius(p2)) ratios.push(ratio);
  }
  ratios.sort((x, y) => x - y);
  let largest = 0;
  for (let low = 0, high = 0; high < ratios.length; high++) {
    while (ratios[high] - ratios[low] > NEAR_COPY_TOLERANCE * ratios[high]) low++;
    largest = Math.max(largest, high - low + 1);
  }
  return { jointly_nonzero: jointlyNonzero, largest_group: largest };
}

/** Validate and normalize to the canonical form. Key order is fixed here, not left to the parser. */
export function normalizeForecastSet(input: unknown, options: { maxBytes?: number } = {}): { set: ForecastSet; artifact_id: string; bytes: number } {
  const raw = forecastSetInputSchema.parse(input);
  const count = raw.dates.length;
  const series: [string, unknown[] | undefined][] = [["windows", raw.windows], ["a", raw.a], ["b", raw.b],
    ["primary", raw.primary], ["secondary", raw.secondary], ["labels", raw.labels]];
  for (const [name, values] of series) {
    if (values && values.length !== count) fail(`${name} has ${values.length} entries for ${count} dates`);
  }
  for (let i = 1; i < count; i++) {
    if (!(raw.dates[i - 1] < raw.dates[i])) fail("dates must be strictly increasing and unique");
  }
  for (let i = 0; i < count; i++) {
    const { from, to } = raw.windows[i];
    if (!(from < to)) fail(`window ${i} must have from before to`);
    if (i > 0 && !(raw.windows[i - 1].to <= from)) fail(`windows ${i - 1} and ${i} overlap or are out of order`);
    const day = from.slice(0, 10);
    if (day !== raw.dates[i] && day !== previousDay(raw.dates[i])) fail(`window ${i} must start on its date or the day before`);
  }
  const ids = raw.underlying_series_ids;
  if (ids.length > raw.n) fail("more underlying series than dimensions");
  if (new Set(ids).size !== ids.length) fail("underlying series IDs must be unique");
  if (ids.some((id) => RESERVED_SERIES_PREFIXES.some((prefix) => id.startsWith(prefix)))) fail("underlying series ID uses a reserved prefix");
  if (raw.labels && new Set(raw.labels).size > FORECAST_SET_MAX_LABELS) fail(`at most ${FORECAST_SET_MAX_LABELS} distinct labels`);
  const canonical = (name: string, values: z.infer<typeof valueSchema>[]) => values.map((v, i) => canonicalValue(v, raw.n, `${name}[${i}]`));
  const set: ForecastSet = {
    schema_version: raw.schema_version,
    source_id: raw.source_id,
    source_sha256: raw.source_sha256,
    evidence_tier: raw.evidence_tier,
    horizon: raw.horizon,
    n: raw.n,
    underlying_series_ids: [...ids],
    dates: [...raw.dates],
    windows: raw.windows.map((w) => ({ from: w.from, to: w.to })),
    a: canonical("a", raw.a),
    b: canonical("b", raw.b),
    primary: canonical("primary", raw.primary),
    secondary: raw.secondary ? canonical("secondary", raw.secondary) : null,
    labels: raw.labels ? [...raw.labels] : null,
  };
  if (set.secondary) {
    const reason = secondaryCopyReason(set.primary, set.secondary);
    if (reason) fail(`secondary proxy is ${reason === "identical" ? "identical to" : "a scaled copy of"} the primary`);
  }
  const body = JSON.stringify(set);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > (options.maxBytes ?? FORECAST_SET_MAX_BYTES)) fail("normalized set exceeds the size limit");
  return { set, artifact_id: digest(body), bytes };
}

/** The inline path: the same schema and hash, restricted to scalar sets of at most 2,000 dates. */
export function normalizeInlineForecastSet(input: unknown) {
  const normalized = normalizeForecastSet(input);
  if (normalized.set.n !== 1) fail("inline sets must be scalar (n = 1); register matrices with the import CLI");
  if (normalized.set.dates.length > FORECAST_SET_INLINE_MAX_DATES) fail(`inline sets hold at most ${FORECAST_SET_INLINE_MAX_DATES} dates`);
  return normalized;
}

/**
 * sha256 of the UTF-8 source_id itself (design M2). The period record's `forecast-set-source:` series
 * and the journal's source_hash both use it, so the two records join on it.
 */
export const forecastSetSourceDigest = (sourceId: string) => digest(sourceId);

/**
 * Per-component hashes for the exploration journal: sha256 of JSON.stringify of each normalized
 * component, and the source digest above. They persist in the journal, so this serialization is a
 * cross-version contract.
 */
export function forecastSetComponentHashes(set: ForecastSet) {
  const hash = (value: unknown) => digest(JSON.stringify(value));
  return {
    dates: hash(set.dates),
    a: hash(set.a),
    b: hash(set.b),
    primary: hash(set.primary),
    secondary: set.secondary ? hash(set.secondary) : "absent",
    labels: set.labels ? hash(set.labels) : "absent",
    source: forecastSetSourceDigest(set.source_id),
  };
}

export const resolveForecastSetDirectory = () => process.env.TRADINGVIEW_MCP_FORECAST_SET_DIR?.trim()
  || join(homedir(), ".tradingview-mcp", "forecast-sets");

function ownerOnly(stat: Awaited<ReturnType<typeof lstat>>): void {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("forecast set store must belong to current user");
  if (posixModeEnforced() && (Number(stat.mode) & 0o077)) throw new Error("forecast set store must be owner-only");
}

export class ForecastSetStore {
  constructor(private readonly directory = resolveForecastSetDirectory()) {}

  private async checkDirectory(): Promise<void> {
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("forecast set directory must be a regular directory");
    ownerOnly(stat);
  }

  async get(artifactId: string): Promise<ForecastSet> {
    hashSchema.parse(artifactId);
    await this.checkDirectory();
    const body = await readBacktestLedgerFile(join(this.directory, `${artifactId.slice(7)}.json`), true);
    // Hash the bytes as stored: decoding first maps invalid UTF-8 to U+FFFD, which could hide corruption.
    if (digest(body) !== artifactId) throw new Error("forecast set artifact hash mismatch");
    const stored = JSON.parse(body.toString("utf8"));
    // The stored form writes an absent secondary or labels as null; the input schema takes them as absent.
    for (const key of ["secondary", "labels"]) if (stored?.[key] === null) delete stored[key];
    const { set, artifact_id } = normalizeForecastSet(stored);
    if (artifact_id !== artifactId) throw new Error("forecast set is not in normalized form");
    return set;
  }

  async register(input: unknown): Promise<{ artifact_id: string; dates: number; n: number }> {
    const { set, artifact_id } = normalizeForecastSet(input);
    const body = Buffer.from(JSON.stringify(set));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.checkDirectory();
    const temporary = join(this.directory, `.pending-${randomUUID()}`);
    const destination = join(this.directory, `${artifact_id.slice(7)}.json`);
    const handle = await openExclusiveFile(temporary, "forecast set");
    try {
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
      // Publish a fully synced immutable file; never expose a partially written artifact.
      try { await link(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await this.get(artifact_id);
      await syncDirectoryEntry(this.directory);
    } finally { await unlink(temporary); }
    return { artifact_id, dates: set.dates.length, n: set.n };
  }
}
