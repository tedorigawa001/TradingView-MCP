import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFirstSeenLog, isCanonicalTimestamp } from "./firstSeenStore.js";
import { assertExpectedResponseHost, readLimitedResponseBytes, type BoundedResponse } from "./boundedResponse.js";
import { FxHistoricalArchive, resolveFxHistoricalArchivePath } from "./fxHistoricalArchive.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const MAX_PAGE_BARS = 4_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_RECORD_BYTES = 32 * 1024;
const PAGE_ATTEMPTS = 3;
const OANDA_HOSTS = { practice: "api-fxpractice.oanda.com", live: "api-fxtrade.oanda.com" } as const;

type OandaEnvironment = keyof typeof OANDA_HOSTS;
/**
 * The OANDA instruments the collector reads (BACKLOG 103-1): the majors against USD, AUD/NZD and gold. EUR_USD is the
 * default and keeps its files as before.
 */
export const OANDA_FX_INSTRUMENTS = ["EUR_USD", "USD_JPY", "GBP_USD", "AUD_USD", "NZD_USD", "USD_CAD", "USD_CHF", "AUD_NZD", "XAU_USD"] as const;
export type OandaFxInstrument = (typeof OANDA_FX_INSTRUMENTS)[number];
export const isOandaFxInstrument = (value: unknown): value is OandaFxInstrument =>
  typeof value === "string" && (OANDA_FX_INSTRUMENTS as readonly string[]).includes(value);
/** The repository's symbol for an instrument: OANDA:EURUSD for EUR_USD. */
export const canonicalOandaSymbol = (instrument: OandaFxInstrument) => `OANDA:${instrument.replace("_", "")}`;
export type FxM15Bar = { time: string; open: number; high: number; low: number; close: number; volume: number };
export type FxHistoricalManifest = {
  schema_version: "1.0"; sequence: number; series: "fx_historical_m15"; evidence_tier: "official_revised_history";
  source_id: "oanda_v20"; source_url_template: string; canonical_symbol: string; instrument: OandaFxInstrument; granularity: "M15"; price: "M";
  requested_from: string; requested_to: string; retrieved_at: string; first_seen_at: string; observation_date: string; raw_sha256: string[]; normalized_sha256: string;
  bar_count: number; first_bar_at: string; last_bar_at: string; duplicate_timestamps_removed: number; non_contiguous_weekday_intervals: number;
};
export type OandaHistoricalFetch = (url: string, init: RequestInit) => Promise<BoundedResponse & { ok: boolean; status: number }>;
type FxHistoricalCheckpointPort = { readonly instrument?: OandaFxInstrument; completed(collectionKey: string): Promise<FxHistoricalPageCheckpoint[]>; append(row: Omit<FxHistoricalPageCheckpoint, "schema_version" | "sequence" | "series" | "observation_date" | "first_seen_at">, now: string): Promise<{ recorded: boolean; sequence: number | null }> };
type FxHistoricalManifestPort = Pick<FxHistoricalManifestStore, "append"> & { readonly instrument?: OandaFxInstrument };
export type OandaHistoricalRequest = { accountId: string; token: string; from: string; to: string; instrument?: OandaFxInstrument; environment?: OandaEnvironment; fetch?: OandaHistoricalFetch; now?: () => Date; sleep?: (milliseconds: number) => Promise<void>; archive?: FxHistoricalArchive; store?: FxHistoricalManifestPort; checkpoints?: FxHistoricalCheckpointPort };

export const resolveFxHistoricalManifestPath = (configuredPath = process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH): string =>
  configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "fx-history-m15-manifest.jsonl");

/**
 * Each instrument keeps its own manifest, and checkpoints beside it (BACKLOG 103-1). EUR_USD keeps the path it always had,
 * so its files, and the versions that read only them, are unchanged; another instrument's name goes before the suffix:
 * fx-history-m15-manifest.USD_JPY.jsonl.
 */
export const resolveFxHistoricalManifestPathFor = (instrument: OandaFxInstrument, configuredPath = process.env.TRADINGVIEW_MCP_FX_HISTORY_MANIFEST_PATH): string => {
  if (!isOandaFxInstrument(instrument)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  const path = resolveFxHistoricalManifestPath(configuredPath);
  // A path ending in a separator names a directory, where another instrument's file would become a hidden one.
  if (/[\\/]$/.test(path)) throw new Error(`FX history manifest path must name a file, not a directory: ${path}`);
  if (instrument === "EUR_USD") return path;
  return /\.jsonl$/i.test(path) ? path.replace(/(\.jsonl)$/i, `.${instrument}$1`) : `${path}.${instrument}`;
};

const canonical = (value: string, label: string) => {
  if (!isCanonicalTimestamp(value)) throw new Error(`${label} must be a canonical ISO timestamp`);
  return value;
};
const canonicalOandaTime = (value: unknown) => {
  if (typeof value !== "string") throw new Error("invalid OANDA candle time");
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error("invalid OANDA candle time");
  return new Date(milliseconds).toISOString();
};
const digest = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const number = (value: unknown, label: string) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) throw new Error(`invalid OANDA ${label}`);
  return parsed;
};
const sameBar = (left: FxM15Bar, right: FxM15Bar) => left.open === right.open && left.high === right.high && left.low === right.low && left.close === right.close && left.volume === right.volume;
const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function fetchOandaPage(url: string, token: string, fetcher: OandaHistoricalFetch, sleep: (milliseconds: number) => Promise<void>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt += 1) {
    let response: Awaited<ReturnType<OandaHistoricalFetch>>;
    try {
      response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" });
    } catch (error) {
      lastError = error;
      if (attempt < PAGE_ATTEMPTS) await sleep(250 * attempt);
      continue;
    }
    assertExpectedResponseHost(response, url, "OANDA candle");
    if (response.ok) return response;
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable) throw new Error(`OANDA candle request failed with HTTP ${response.status}`);
    lastError = new Error(`OANDA candle request failed with HTTP ${response.status}`);
    if (attempt < PAGE_ATTEMPTS) await sleep(250 * attempt);
  }
  throw new Error(`OANDA candle page failed after ${PAGE_ATTEMPTS} attempts`, { cause: lastError });
}

/** The complete candles of a page, and how many it returned that were not complete yet. */
function parsePage(body: Uint8Array, instrument: OandaFxInstrument): { bars: FxM15Bar[]; incomplete: number } {
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(body)); } catch { throw new Error("OANDA candle response was not JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid OANDA candle response");
  // OANDA names the instrument and granularity of a candle response; a page of another one is refused (BACKLOG 103-1).
  const named = data as { instrument?: unknown; granularity?: unknown };
  if (named.instrument !== undefined && named.instrument !== instrument) throw new Error(`OANDA candle response named ${String(named.instrument)}, not ${instrument}`);
  if (named.granularity !== undefined && named.granularity !== "M15") throw new Error(`OANDA candle response named granularity ${String(named.granularity)}, not M15`);
  const candles = (data as { candles?: unknown }).candles;
  if (!Array.isArray(candles)) throw new Error("OANDA candle response did not include candles");
  let incomplete = 0;
  const bars = candles.filter((candle): candle is Record<string, unknown> => !!candle && typeof candle === "object" && !Array.isArray(candle)).flatMap((candle) => {
    if (candle.complete !== true) { incomplete += 1; return []; }
    const mid = candle.mid;
    if (!mid || typeof mid !== "object" || Array.isArray(mid)) throw new Error("OANDA complete candle did not include mid prices");
    // OANDA commonly returns RFC3339 timestamps with nine fractional digits; normalize that
    // upstream representation to the repository's canonical millisecond UTC contract.
    const time = canonicalOandaTime(candle.time);
    const open = number((mid as Record<string, unknown>).o, "mid open");
    const high = number((mid as Record<string, unknown>).h, "mid high");
    const low = number((mid as Record<string, unknown>).l, "mid low");
    const close = number((mid as Record<string, unknown>).c, "mid close");
    const volume = number(candle.volume, "volume");
    if (low > Math.min(open, close) || high < Math.max(open, close) || high < low || volume < 0) throw new Error("OANDA candle OHLC was invalid");
    return [{ time, open, high, low, close, volume }];
  });
  return { bars, incomplete };
}

/**
 * A page is final once OANDA can add nothing to it (BACKLOG 102-12): every candle it returned is complete, and it was
 * read a whole candle after its end, so the candle starting at the end had closed. Only a final page is checkpointed;
 * a page read earlier, with a candle still forming or time still to come, is fetched again by a later run.
 */
const pageFinal = (page: { incomplete: number }, pageEnd: number, readAt: string) =>
  page.incomplete === 0 && new Date(readAt).getTime() >= pageEnd + FIFTEEN_MINUTES;

const validateManifest = (value: unknown, instrument: OandaFxInstrument): FxHistoricalManifest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid FX history manifest");
  const row = value as Partial<FxHistoricalManifest>;
  // A manifest holds one instrument's collections only (BACKLOG 103-1).
  if (row.schema_version !== "1.0" || row.series !== "fx_historical_m15" || row.evidence_tier !== "official_revised_history" || row.source_id !== "oanda_v20" || row.canonical_symbol !== canonicalOandaSymbol(instrument) || row.instrument !== instrument || row.granularity !== "M15" || row.price !== "M") throw new Error("unsupported FX history manifest");
  if (!Number.isSafeInteger(row.sequence) || (row.sequence ?? 0) < 1 || !Number.isSafeInteger(row.bar_count) || (row.bar_count ?? 0) < 1 || !Number.isSafeInteger(row.duplicate_timestamps_removed) || (row.duplicate_timestamps_removed ?? -1) < 0 || !Number.isSafeInteger(row.non_contiguous_weekday_intervals) || (row.non_contiguous_weekday_intervals ?? -1) < 0) throw new Error("invalid FX history manifest counters");
  for (const timestamp of [row.requested_from, row.requested_to, row.retrieved_at, row.first_seen_at, row.first_bar_at, row.last_bar_at]) if (typeof timestamp !== "string" || !isCanonicalTimestamp(timestamp)) throw new Error("invalid FX history manifest timestamp");
  if (row.requested_from! >= row.requested_to! || row.first_bar_at! > row.last_bar_at! || row.first_seen_at !== row.retrieved_at || row.observation_date !== row.retrieved_at!.slice(0, 10) || typeof row.source_url_template !== "string" || !row.source_url_template.startsWith("https://api-fx") || !Array.isArray(row.raw_sha256) || row.raw_sha256.length < 1 || row.raw_sha256.some((hash) => !/^sha256:[a-f0-9]{64}$/.test(hash)) || typeof row.normalized_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.normalized_sha256)) throw new Error("invalid FX history manifest fields");
  return row as FxHistoricalManifest;
};

export class FxHistoricalManifestStore {
  private readonly log: AppendOnlyFirstSeenLog<FxHistoricalManifest>;
  /** Bound to one instrument; without a path it uses that instrument's own manifest (BACKLOG 103-1). */
  constructor(path?: string, readonly instrument: OandaFxInstrument = "EUR_USD") {
    if (!isOandaFxInstrument(instrument)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
    this.log = new AppendOnlyFirstSeenLog(path ?? resolveFxHistoricalManifestPathFor(instrument), "FX history manifest", (value) => validateManifest(value, instrument), { maxFileBytes: MAX_MANIFEST_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }
  async append(manifest: Omit<FxHistoricalManifest, "schema_version" | "sequence" | "series" | "evidence_tier" | "first_seen_at" | "observation_date">) {
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const candidate = validateManifest({ ...manifest, schema_version: "1.0", sequence: records.length + 1, series: "fx_historical_m15", evidence_tier: "official_revised_history", first_seen_at: manifest.retrieved_at, observation_date: manifest.retrieved_at.slice(0, 10) }, this.instrument);
      if (records.some((record) => record.normalized_sha256 === candidate.normalized_sha256)) return { recorded: false, sequence: null };
      await this.log.appendUnlocked(candidate);
      return { recorded: true, sequence: candidate.sequence };
    });
  }
  async coverage() { return this.log.serialize(async () => {
    const rows = await this.log.readAllUnlocked();
    const latest = rows.at(-1);
    return { records: rows.length, latest_retrieved_at: latest?.retrieved_at ?? null, earliest_bar_at: rows.length ? rows.map((row) => row.first_bar_at).sort()[0] : null, latest_bar_at: rows.length ? rows.map((row) => row.last_bar_at).sort().at(-1)! : null };
  }); }
}

type FxHistoricalPageCheckpoint = {
  schema_version: "1.0"; sequence: number; series: "fx_historical_m15_page_checkpoint"; observation_date: string; first_seen_at: string;
  collection_key: string; requested_from: string; requested_to: string; raw_sha256: string; raw_bytes: number;
  /** The page's earlier checkpoint, written before the page was final, that this one replaces (BACKLOG 102-12). */
  supersedes_sequence?: number;
};

const validateCheckpoint = (value: unknown): FxHistoricalPageCheckpoint => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid FX history page checkpoint");
  const row = value as Partial<FxHistoricalPageCheckpoint>;
  if (row.schema_version !== "1.0" || row.series !== "fx_historical_m15_page_checkpoint" || !Number.isSafeInteger(row.sequence) || (row.sequence ?? 0) < 1 || typeof row.collection_key !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.collection_key) || typeof row.raw_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.raw_sha256) || !Number.isSafeInteger(row.raw_bytes) || (row.raw_bytes ?? 0) < 1 || (row.raw_bytes ?? 0) > MAX_RESPONSE_BYTES) throw new Error("invalid FX history page checkpoint fields");
  for (const timestamp of [row.requested_from, row.requested_to, row.first_seen_at]) if (typeof timestamp !== "string" || !isCanonicalTimestamp(timestamp)) throw new Error("invalid FX history page checkpoint timestamp");
  if (row.requested_from! >= row.requested_to! || row.observation_date !== row.first_seen_at!.slice(0, 10)) throw new Error("invalid FX history page checkpoint range");
  if (row.supersedes_sequence !== undefined && (!Number.isSafeInteger(row.supersedes_sequence) || row.supersedes_sequence < 1 || row.supersedes_sequence >= row.sequence!)) throw new Error("invalid FX history page checkpoint supersedes_sequence");
  return row as FxHistoricalPageCheckpoint;
};

export class FxHistoricalCheckpointStore {
  private readonly log: AppendOnlyFirstSeenLog<FxHistoricalPageCheckpoint>;
  /** Bound to one instrument; without a path it uses the checkpoints beside that instrument's manifest (BACKLOG 103-1). */
  constructor(path?: string, readonly instrument: OandaFxInstrument = "EUR_USD") {
    if (!isOandaFxInstrument(instrument)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
    this.log = new AppendOnlyFirstSeenLog(path ?? `${resolveFxHistoricalManifestPathFor(instrument)}.checkpoints`, "FX history page checkpoint", validateCheckpoint, { maxFileBytes: MAX_MANIFEST_BYTES, maxRecordBytes: MAX_RECORD_BYTES });
  }
  async completed(collectionKey: string) { return this.log.serialize(async () => (await this.log.readAllUnlocked()).filter((row) => row.collection_key === collectionKey)); }
  async append(row: Omit<FxHistoricalPageCheckpoint, "schema_version" | "sequence" | "series" | "observation_date" | "first_seen_at">, now: string) {
    return this.log.serialize(async () => {
      const records = await this.log.readAllUnlocked();
      const matching = records.filter((record) => record.collection_key === row.collection_key && record.requested_from === row.requested_from && record.requested_to === row.requested_to);
      // A page's checkpoints form a chain: each later one names the one before it, which it replaces (BACKLOG 102-12).
      if (matching.some((record, index) => record.supersedes_sequence !== (index === 0 ? undefined : matching[index - 1].sequence))) throw new Error("FX history page checkpoints do not form a chain");
      const latest = matching.at(-1);
      // The same raw response again is no new checkpoint, unless it replaces the latest one, read once the page was final.
      // Replacing the same earlier checkpoint as the latest does is a second run that already found the page final.
      if (latest && latest.raw_sha256 === row.raw_sha256 && latest.raw_bytes === row.raw_bytes
        && (row.supersedes_sequence === undefined || row.supersedes_sequence === latest.supersedes_sequence)) return { recorded: false, sequence: latest.sequence };
      // Otherwise a checkpoint must name the page's latest one as the one it replaces, or be the page's first.
      if (row.supersedes_sequence !== latest?.sequence) throw new Error("FX history page checkpoint conflicts with a prior raw response");
      const candidate = validateCheckpoint({ ...row, schema_version: "1.0", sequence: records.length + 1, series: "fx_historical_m15_page_checkpoint", first_seen_at: now, observation_date: now.slice(0, 10) });
      await this.log.appendUnlocked(candidate);
      return { recorded: true, sequence: candidate.sequence };
    });
  }
}

/** Collects one instrument's confirmed M15 midpoint candles (EUR_USD unless input.instrument names another). */
export async function collectOandaM15History(input: OandaHistoricalRequest) {
  const from = canonical(input.from, "from"); const to = canonical(input.to, "to");
  if (from >= to) throw new Error("from must precede to");
  const instrument = input.instrument === undefined ? "EUR_USD" : input.instrument;
  if (!isOandaFxInstrument(instrument)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  const canonicalSymbol = canonicalOandaSymbol(instrument);
  // A manifest or checkpoint store given for another instrument is refused before anything is fetched or written.
  for (const [label, port] of [["manifest store", input.store], ["checkpoint store", input.checkpoints]] as const) {
    if (port?.instrument !== undefined && port.instrument !== instrument) throw new Error(`the FX history ${label} is for ${port.instrument}, not ${instrument}`);
  }
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(input.accountId) || input.token.trim().length < 16) throw new Error("OANDA credentials are missing or malformed");
  const environment = input.environment ?? "practice";
  const host = OANDA_HOSTS[environment];
  const fetcher = input.fetch ?? ((url, init) => fetch(url, init) as Promise<BoundedResponse & { ok: boolean; status: number }>);
  const sleep = input.sleep ?? defaultSleep;
  const archive = input.archive ?? new FxHistoricalArchive(resolveFxHistoricalArchivePath());
  if (input.store === undefined || input.checkpoints === undefined) {
    // The configured manifest path is the base of every instrument's files: a directory there is refused for all of them.
    const base = resolveFxHistoricalManifestPath();
    const found = await lstat(base).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (found?.isDirectory()) throw new Error(`FX history manifest path must name a file, not a directory: ${base}`);
  }
  const store = input.store ?? new FxHistoricalManifestStore(undefined, instrument);
  const checkpoints = input.checkpoints ?? new FxHistoricalCheckpointStore(undefined, instrument);
  const rawSha256: string[] = []; const bars: FxM15Bar[] = []; let duplicates = 0;
  const normalizedHash = createHash("sha256"); normalizedHash.update("["); let firstNormalizedBar = true;
  // The key always named the instrument, so EUR_USD's checkpoints resume as before.
  const collectionKey = digest(`oanda_v20|${environment}|${instrument}|M15|M|${from}|${to}`);
  // The latest checkpoint of each page; a later one replaces an earlier one written before the page was final.
  const completed = new Map((await checkpoints.completed(collectionKey)).sort((left, right) => left.sequence - right.sequence)
    .map((row) => [`${row.requested_from}:${row.requested_to}`, row]));
  const now = () => (input.now ?? (() => new Date()))().toISOString();
  let resumedPages = 0;
  let unfinishedPages = 0;
  const appendBars = (pageBars: FxM15Bar[], cursor: number, pageEnd: number) => {
    for (const bar of pageBars) {
      const instant = new Date(bar.time).getTime();
      if (instant < cursor || instant > pageEnd) throw new Error("OANDA candle fell outside its requested page");
      const prior = bars.at(-1);
      if (prior && bar.time < prior.time) throw new Error("OANDA candle page was not time ordered");
      if (prior?.time === bar.time) {
        duplicates += 1;
        if (!sameBar(prior, bar)) throw new Error("OANDA returned conflicting values for the same candle timestamp");
        continue;
      }
      if (!firstNormalizedBar) normalizedHash.update(",");
      normalizedHash.update(JSON.stringify(bar)); firstNormalizedBar = false;
      bars.push(bar);
    }
  };
  let cursor = new Date(from).getTime(); const end = new Date(to).getTime();
  while (cursor < end) {
    const pageEnd = Math.min(end, cursor + MAX_PAGE_BARS * FIFTEEN_MINUTES);
    const requestFrom = new Date(cursor).toISOString(); const requestTo = new Date(pageEnd).toISOString();
    const priorCheckpoint = completed.get(`${requestFrom}:${requestTo}`);
    if (priorCheckpoint) {
      const body = await archive.read(priorCheckpoint.raw_sha256);
      if (body.byteLength !== priorCheckpoint.raw_bytes) throw new Error("FX history checkpoint raw payload size does not match");
      const page = parsePage(body, instrument);
      // Earlier versions checkpointed a page before it was final; such a page is fetched again below, and its
      // checkpoint and raw response are kept.
      if (pageFinal(page, pageEnd, priorCheckpoint.first_seen_at)) {
        rawSha256.push(priorCheckpoint.raw_sha256); appendBars(page.bars, cursor, pageEnd); resumedPages += 1; cursor = pageEnd; continue;
      }
    }
    const url = new URL(`https://${host}/v3/accounts/${encodeURIComponent(input.accountId)}/instruments/${instrument}/candles`);
    url.search = new URLSearchParams({ price: "M", granularity: "M15", from: requestFrom, to: requestTo, includeFirst: "true" }).toString();
    const readAt = now();
    const response = await fetchOandaPage(url.toString(), input.token, fetcher, sleep);
    const body = await readLimitedResponseBytes(response, MAX_RESPONSE_BYTES, "OANDA candle");
    const hash = digest(body); await archive.store(hash, Buffer.from(body)); rawSha256.push(hash);
    const page = parsePage(body, instrument);
    appendBars(page.bars, cursor, pageEnd);
    if (pageFinal(page, pageEnd, readAt)) {
      await checkpoints.append({ collection_key: collectionKey, requested_from: requestFrom, requested_to: requestTo, raw_sha256: hash, raw_bytes: body.byteLength,
        ...(priorCheckpoint ? { supersedes_sequence: priorCheckpoint.sequence } : {}) }, now());
    } else unfinishedPages += 1;
    cursor = pageEnd;
  }
  if (!bars.length) throw new Error("OANDA returned no complete M15 candles for the requested range");
  let irregular = 0;
  for (let i = 1; i < bars.length; i += 1) { const gap = new Date(bars[i].time).getTime() - new Date(bars[i - 1].time).getTime(); if (gap !== FIFTEEN_MINUTES && new Date(bars[i - 1].time).getUTCDay() !== 5) irregular += 1; }
  const retrievedAt = now();
  normalizedHash.update("]");
  const normalizedSha256 = `sha256:${normalizedHash.digest("hex")}`;
  const sourceUrlTemplate = `https://${host}/v3/accounts/{account}/instruments/${instrument}/candles`;
  const persisted = await store.append({ source_id: "oanda_v20", source_url_template: sourceUrlTemplate, canonical_symbol: canonicalSymbol, instrument, granularity: "M15", price: "M", requested_from: from, requested_to: to, retrieved_at: retrievedAt, raw_sha256: rawSha256, normalized_sha256: normalizedSha256, bar_count: bars.length, first_bar_at: bars[0].time, last_bar_at: bars.at(-1)!.time, duplicate_timestamps_removed: duplicates, non_contiguous_weekday_intervals: irregular });
  return { source: "oanda_v20", evidence_tier: "official_revised_history", canonical_symbol: canonicalSymbol, instrument, bars, raw_sha256: rawSha256, normalized_sha256: normalizedSha256, manifest: persisted, collection_key: collectionKey, resumed_pages: resumedPages, unfinished_pages: unfinishedPages, quality: { duplicate_timestamps_removed: duplicates, non_contiguous_weekday_intervals: irregular } };
}

/** The EUR_USD collection, as before BACKLOG 103-1. */
export const collectOandaEurUsdM15History = (input: Omit<OandaHistoricalRequest, "instrument">) =>
  collectOandaM15History({ ...input, instrument: "EUR_USD" });
