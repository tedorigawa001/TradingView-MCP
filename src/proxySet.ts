import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, link, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openExclusiveFile, posixModeEnforced, syncDirectoryEntry } from "./fsDurability.js";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { ENTRY_RESERVED_SERIES_PREFIXES, PROXY_SET_SOURCE_PREFIX, forecastSetInputSchema, type ForecastSet } from "./forecastSet.js";
import { DROP_CAUSES, REALIZED_COVARIANCE_ALGORITHM, type ProxyValue } from "./realizedCovariance.js";
import {
  RealizedCovarianceError, canonicalRulesForm, hashRules, planCalendar, producedLabels, realizedCovarianceRulesSchema,
  REALIZED_COVARIANCE_MAX_DATES,
} from "./realizedCovarianceRules.js";
import type { RealizedCovarianceJournalStore } from "./realizedCovarianceJournal.js";
import { intlZoneResolver, type ZoneResolver } from "./zonedTime.js";

/**
 * Proxy sets (docs/REALIZED_COVARIANCE_DESIGN.md, "Proxy set artifact" and "Verifying a proxy set"; plan
 * section 7, "Verification order"). Content-addressed; the tzdata version is not part of the content (F17).
 */
export const PROXY_SET_MAX_BYTES = 32 * 1024 * 1024;

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const finite = z.number().finite();
const value = z.union([finite, z.array(z.array(finite).min(1).max(8)).min(1).max(8), z.null()]);

export const proxySetSchema = z.object({
  schema_version: z.literal("1.0"),
  algorithm_version: z.literal(REALIZED_COVARIANCE_ALGORITHM),
  bar_series: z.array(hash).min(1).max(8),
  underlying_series_ids: z.array(identifier).min(1).max(8),
  evidence_tiers: z.array(z.enum(["historical_exploration", "prospective", "synthetic_test"])).min(1).max(8),
  rules: realizedCovarianceRulesSchema,
  rules_sha256: hash,
  from_date: calendarDate,
  to_date: calendarDate,
  dates: z.array(calendarDate).min(1).max(REALIZED_COVARIANCE_MAX_DATES),
  windows: z.array(z.object({ from: timestamp, to: timestamp }).strict()).min(1).max(REALIZED_COVARIANCE_MAX_DATES),
  rc: z.array(value).min(1).max(REALIZED_COVARIANCE_MAX_DATES),
  daily_outer: z.array(value).min(1).max(REALIZED_COVARIANCE_MAX_DATES),
  common_slots: z.array(z.number().int().min(0)).min(1).max(REALIZED_COVARIANCE_MAX_DATES),
  expected_slots: z.array(z.number().int().min(1)).min(1).max(REALIZED_COVARIANCE_MAX_DATES),
  drop_cause: z.array(z.enum(DROP_CAUSES).nullable()).min(1).max(REALIZED_COVARIANCE_MAX_DATES),
  identical_close_pairs: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(28),
}).strict();
export type ProxySet = z.infer<typeof proxySetSchema>;

const digest = (body: string | Buffer) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
function fail(message: string): never {
  throw new Error(`invalid proxy set: ${message}`);
}

/**
 * Validate the structure and normalize to the canonical key order. Rule consistency (rules_sha256,
 * dates, windows) is the verification's job, not normalization's, so a stored set always reads back.
 */
export function normalizeProxySet(input: unknown, options: { maxBytes?: number } = {}): { set: ProxySet; artifact_id: string; bytes: number } {
  const raw = proxySetSchema.parse(input);
  const n = raw.bar_series.length;
  if (raw.underlying_series_ids.length !== n || raw.evidence_tiers.length !== n) fail("series lists differ in length");
  const count = raw.dates.length;
  for (const [name, list] of [["windows", raw.windows], ["rc", raw.rc], ["daily_outer", raw.daily_outer], ["common_slots", raw.common_slots],
    ["expected_slots", raw.expected_slots], ["drop_cause", raw.drop_cause]] as const) {
    if (list.length !== count) fail(`${name} has ${list.length} entries for ${count} dates`);
  }
  const shaped = (v: ProxyValue) => (n === 1 ? typeof v === "number" : Array.isArray(v) && v.length === n && v.every((row) => row.length === n));
  for (let i = 0; i < count; i++) {
    if (i > 0 && !(raw.dates[i - 1] < raw.dates[i])) fail("dates must be strictly increasing");
    if (!(raw.windows[i].from < raw.windows[i].to)) fail(`window ${i} must have from before to`);
    if (raw.common_slots[i] > raw.expected_slots[i]) fail(`common_slots exceed expected_slots on ${raw.dates[i]}`);
    const kept = raw.drop_cause[i] === null;
    for (const v of [raw.rc[i], raw.daily_outer[i]]) {
      if (kept ? !shaped(v) : v !== null) fail(`proxy values on ${raw.dates[i]} do not match its drop cause and n = ${n}`);
    }
  }
  const pairs = raw.identical_close_pairs;
  if (pairs.some(([i, j]) => !(i < j && j < n)) || JSON.stringify(pairs) !== JSON.stringify([...pairs].sort((x, y) => x[0] - y[0] || x[1] - y[1]))
    || new Set(pairs.map((p) => p.join())).size !== pairs.length) {
    fail("identical_close_pairs must be sorted unique pairs i < j < n");
  }
  const set: ProxySet = {
    schema_version: raw.schema_version,
    algorithm_version: raw.algorithm_version,
    bar_series: [...raw.bar_series],
    underlying_series_ids: [...raw.underlying_series_ids],
    evidence_tiers: [...raw.evidence_tiers],
    rules: canonicalRulesForm(raw.rules),
    rules_sha256: raw.rules_sha256,
    from_date: raw.from_date,
    to_date: raw.to_date,
    dates: [...raw.dates],
    windows: raw.windows.map((w) => ({ from: w.from, to: w.to })),
    rc: raw.rc,
    daily_outer: raw.daily_outer,
    common_slots: [...raw.common_slots],
    expected_slots: [...raw.expected_slots],
    drop_cause: [...raw.drop_cause],
    identical_close_pairs: pairs.map(([i, j]) => [i, j] as [number, number]),
  };
  const body = JSON.stringify(set);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > (options.maxBytes ?? PROXY_SET_MAX_BYTES)) fail("normalized proxy set exceeds the size limit");
  return { set, artifact_id: digest(body), bytes };
}

export const resolveProxySetDirectory = () => process.env.TRADINGVIEW_MCP_PROXY_SET_DIR?.trim()
  || join(homedir(), ".tradingview-mcp", "proxy-sets");

function ownerOnly(stat: Awaited<ReturnType<typeof lstat>>): void {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("proxy set store must belong to current user");
  if (posixModeEnforced() && (Number(stat.mode) & 0o077)) throw new Error("proxy set store must be owner-only");
}

export class ProxySetStore {
  constructor(private readonly directory = resolveProxySetDirectory()) {}

  private async checkDirectory(): Promise<void> {
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("proxy set directory must be a regular directory");
    ownerOnly(stat);
  }

  async get(artifactId: string): Promise<ProxySet> {
    hash.parse(artifactId);
    await this.checkDirectory();
    const body = await readBacktestLedgerFile(join(this.directory, `${artifactId.slice(7)}.json`), true);
    if (digest(body) !== artifactId) throw new Error("proxy set artifact hash mismatch");
    const { set, artifact_id } = normalizeProxySet(JSON.parse(body.toString("utf8")));
    if (artifact_id !== artifactId) throw new Error("proxy set is not in normalized form");
    return set;
  }

  async register(input: unknown): Promise<{ artifact_id: string; dates: number }> {
    const { set, artifact_id } = normalizeProxySet(input);
    const body = Buffer.from(JSON.stringify(set));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.checkDirectory();
    const temporary = join(this.directory, `.pending-${randomUUID()}`);
    const destination = join(this.directory, `${artifact_id.slice(7)}.json`);
    const handle = await openExclusiveFile(temporary, "proxy set");
    try {
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
      try { await link(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await this.get(artifact_id);
      await syncDirectoryEntry(this.directory);
    } finally { await unlink(temporary); }
    return { artifact_id, dates: set.dates.length };
  }
}

const reject = (code: string, detail: string): never => { throw new RealizedCovarianceError(code, detail); };

/**
 * The light verification on every read by the join CLI and compare_forecast_losses (D12). The first
 * failing check gives the error (plan section 7; design rev 2.3):
 * 1. proxy_set_not_found;
 * 2. proxy_set_rules_mismatch if rules_sha256 or dates differ — neither can change with tzdata;
 * 3. proxy_set_not_journaled if no journal record names this ID with the same rules_sha256;
 * 4. windows and expected_slots re-derived under the current tzdata. If they differ, or re-derivation
 *    throws: proxy_set_windows_changed_under_current_tzdata when no journal record for this ID carries the
 *    current tzdata (unknown never counts), otherwise proxy_set_rules_mismatch.
 * The zone-name check is not re-run, so an ICU upgrade cannot fail a set that was valid (H3).
 */
export async function verifyProxySet(proxySetId: string, deps: {
  proxySets: Pick<ProxySetStore, "get">;
  journal: Pick<RealizedCovarianceJournalStore, "findByProxySetId">;
  resolver?: ZoneResolver;
}): Promise<ProxySet> {
  const resolver = deps.resolver ?? intlZoneResolver;
  const set = await deps.proxySets.get(proxySetId).catch((error: NodeJS.ErrnoException): never => {
    if (error?.code === "ENOENT") reject("proxy_set_not_found", proxySetId);
    throw error;
  });
  if (hashRules(set.rules) !== set.rules_sha256) reject("proxy_set_rules_mismatch", "rules_sha256 does not match the rules");
  if (JSON.stringify(producedLabels(set.rules, set.from_date, set.to_date)) !== JSON.stringify(set.dates)) {
    reject("proxy_set_rules_mismatch", "dates do not match the rules and range");
  }
  const records = await deps.journal.findByProxySetId(proxySetId);
  if (!records.some((r) => r.rules_sha256 === set.rules_sha256)) {
    reject("proxy_set_not_journaled", `no computation journal record names ${proxySetId}`);
  }
  let consistent: boolean;
  try {
    const { days } = planCalendar(set.rules, set.from_date, set.to_date, resolver);
    consistent = days.length === set.dates.length && days.every((d, i) => set.expected_slots[i] === d.expected_slots
      && set.windows[i].from === new Date(d.window_from).toISOString() && set.windows[i].to === new Date(d.end).toISOString());
  } catch { consistent = false; }
  if (!consistent) {
    const current = resolver.tzdata;
    const journaled = [...new Set(records.map((r) => r.tzdata))];
    if (current === "unknown" || !journaled.includes(current)) {
      reject("proxy_set_windows_changed_under_current_tzdata",
        `windows or expected slots differ under tzdata ${current}; the journal records tzdata ${journaled.join(", ")}`);
    }
    reject("proxy_set_rules_mismatch", "windows or expected slots do not match the rules under the tzdata the set was journaled with");
  }
  return set;
}

type VerificationDeps = Parameters<typeof verifyProxySet>[1];

/** The join's own input (design "Export and join", G9): the caller supplies forecasts for a contiguous run of dates. */
const joinInputSchema = z.object({
  schema_version: z.literal("1.0"),
  evidence_tier: forecastSetInputSchema.shape.evidence_tier,
  from_date: forecastSetInputSchema.shape.dates.element,
  to_date: forecastSetInputSchema.shape.dates.element,
  a: forecastSetInputSchema.shape.a,
  b: forecastSetInputSchema.shape.b,
  labels: forecastSetInputSchema.shape.labels,
}).strict();

/**
 * The `--proxy-set` join: verify the proxy set, then build a forecast-set input over [from_date, to_date], with
 * dates, windows, n and series from the proxy set, rc as the primary and daily_outer as the secondary proxy.
 * Dropped days stay as null proxies. The only path that writes a `proxy-set:` source (G3).
 */
export async function buildProxySetForecastSet(proxySetId: string, input: unknown, deps: VerificationDeps) {
  const request = joinInputSchema.parse(input);
  const proxy = await verifyProxySet(proxySetId, deps);
  // H1: identical closes give exactly singular proxies on every day, which forecasts can only match through rounding.
  if (proxy.identical_close_pairs.length) {
    reject("proxy_set_has_identical_series", proxy.identical_close_pairs
      .map(([i, j]) => `${proxy.underlying_series_ids[i]} and ${proxy.underlying_series_ids[j]}`).join("; "));
  }
  if (proxy.underlying_series_ids.some((id) => ENTRY_RESERVED_SERIES_PREFIXES.some((prefix) => id.startsWith(prefix)))) {
    fail("underlying series ID uses a reserved prefix");
  }
  const start = proxy.dates.indexOf(request.from_date), end = proxy.dates.indexOf(request.to_date);
  if (start < 0 || end < start) {
    reject("join_range_not_contiguous", `from_date and to_date must be dates of the proxy set, in order (${proxy.dates[0]} to ${proxy.dates[proxy.dates.length - 1]})`);
  }
  const count = end - start + 1;
  for (const [name, list] of [["a", request.a], ["b", request.b], ["labels", request.labels]] as const) {
    if (list && list.length !== count) {
      reject("join_length_mismatch", `${name} has ${list.length} entries for the ${count} dates from ${request.from_date} to ${request.to_date}`);
    }
  }
  const run = <T>(list: T[]) => list.slice(start, end + 1);
  return {
    schema_version: "1.0" as const,
    source_id: `${PROXY_SET_SOURCE_PREFIX}${proxySetId.slice(7)}`,
    source_sha256: proxySetId,
    evidence_tier: request.evidence_tier,
    horizon: 1 as const,
    n: proxy.bar_series.length,
    underlying_series_ids: proxy.underlying_series_ids,
    dates: run(proxy.dates),
    windows: run(proxy.windows),
    a: request.a,
    b: request.b,
    primary: run(proxy.rc),
    secondary: run(proxy.daily_outer),
    ...(request.labels ? { labels: request.labels } : {}),
  };
}

/**
 * compare_forecast_losses, for a `proxy-set:` source (design "Verification in compare_forecast_losses"): the
 * source names the proxy set, which verifies, and the forecast set is a contiguous run of it with equal n,
 * series, windows, primary (rc) and secondary (daily_outer). Runs before any record is written (G6).
 */
export async function verifyForecastSetAgainstProxySet(set: ForecastSet, deps: VerificationDeps): Promise<ProxySet> {
  const hex = set.source_id.slice(PROXY_SET_SOURCE_PREFIX.length);
  if (set.source_sha256 !== `sha256:${hex}`) reject("proxy_set_mismatch", "source_id and source_sha256 name different proxy sets");
  const proxy = await verifyProxySet(set.source_sha256, deps);
  const start = proxy.dates.indexOf(set.dates[0]);
  const run = <T>(list: T[]) => list.slice(start, start + set.dates.length);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (start < 0 || !same(run(proxy.dates), set.dates)) {
    reject("proxy_set_mismatch", "the forecast set's dates are not a contiguous run of the proxy set's dates");
  }
  // n alone cannot differ once primary matches: only an all-null run would allow it, and the forecast set's copy
  // rule already rejects a secondary equal to the primary. It stays because the design lists it.
  const differing = ([
    ["n", set.n === proxy.bar_series.length],
    ["underlying_series_ids", same(set.underlying_series_ids, proxy.underlying_series_ids)],
    ["windows", same(set.windows, run(proxy.windows))],
    ["primary", same(set.primary, run(proxy.rc))],
    ["secondary", same(set.secondary, run(proxy.daily_outer))],
  ] as const).filter(([, equal]) => !equal).map(([name]) => name);
  if (differing.length) reject("proxy_set_mismatch", `the forecast set differs from its proxy set in ${differing.join(", ")}`);
  return proxy;
}
