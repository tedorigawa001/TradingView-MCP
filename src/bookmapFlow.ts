import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { OhlcvBar } from "./tradingview.js";

const SESSION_FILE = /^bookmap-flow-[A-Za-z0-9._-]+\.jsonl$/;
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 256 * 1024;
const SUPPORTED_SCHEMA_VERSIONS = new Set(["1.0", "1.1"]);
const EVENT_TYPES = new Set(["instrument", "depth", "bbo", "trade", "snapshot_end", "collector_stop"]);

type JsonRecord = Record<string, unknown>;

export type BookmapFlowEvent = JsonRecord & {
  schema_version: "1.0" | "1.1";
  source: "bookmap";
  event_type: "instrument" | "depth" | "bbo" | "trade" | "snapshot_end" | "collector_stop";
  instrument_alias: string;
  received_at: string;
};

export type BookmapFlowSession = {
  file_name: string;
  bytes: number;
  schema_versions: Array<"1.0" | "1.1">;
  instrument: {
    alias: string;
    symbol: string | null;
    exchange: string | null;
    instrument_type: string | null;
    is_full_depth: boolean | null;
    depth_listener_representation: string | null;
    mbo_captured: boolean | null;
    is_crypto: boolean | null;
    data_delay_raw: number | null;
  };
  events: BookmapFlowEvent[];
  first_received_at: string;
  last_received_at: string;
  event_counts: Record<string, number>;
  snapshot_complete: boolean;
  quality_issues: string[];
};

export type BookmapFlowInterval = {
  start: string;
  end: string;
  depth_updates: number;
  bbo_updates: number;
  trades: number;
  unknown_aggressor_trades: number;
  buy_size: number | null;
  sell_size: number | null;
  trade_delta: number | null;
};

function normalizeReceiptIso(value: unknown, field: string): { value: string; normalized: boolean } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    throw new Error(`${field} must be an ISO UTC timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be an ISO UTC timestamp`);
  }
  const normalized = new Date(parsed).toISOString();
  return { value: normalized, normalized: normalized !== value };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assertSafeFileName(fileName: string): void {
  if (basename(fileName) !== fileName || !SESSION_FILE.test(fileName)) {
    throw new Error("bookmap session_file must be a collector JSONL basename");
  }
}

export function resolveBookmapFlowDirectory(configured = process.env.TRADINGVIEW_MCP_BOOKMAP_FLOW_DIRECTORY): string {
  return resolve(configured ?? "/Volumes/HD/bookmap_data");
}

export async function listBookmapFlowSessions(directory: string): Promise<string[]> {
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("bookmap flow directory must be a real directory");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink() && SESSION_FILE.test(entry.name))
    .map((entry) => entry.name).sort();
}

export async function readBookmapFlowSession(directory: string, fileName: string): Promise<BookmapFlowSession> {
  assertSafeFileName(fileName);
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("bookmap flow directory must be a real directory");
  const path = join(directory, fileName);
  const fileStat = await lstat(path);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error("bookmap session file must be a real regular file");
  if (fileStat.size > MAX_SESSION_BYTES) throw new Error(`bookmap session exceeds ${MAX_SESSION_BYTES} byte limit`);
  return parseBookmapFlowSession(await readFile(path, "utf8"), fileName, fileStat.size);
}

export function parseBookmapFlowSession(content: string, fileName = "bookmap-flow-test.jsonl", bytes = Buffer.byteLength(content)): BookmapFlowSession {
  assertSafeFileName(fileName);
  const events: BookmapFlowEvent[] = [];
  const eventCounts: Record<string, number> = {};
  const versions = new Set<"1.0" | "1.1">();
  let alias: string | null = null;
  let instrumentRecord: JsonRecord | null = null;
  let receiptTimestampNormalized = false;

  for (const [index, line] of content.split(/\n/).entries()) {
    if (line === "") continue;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error(`bookmap JSONL line ${index + 1} exceeds byte limit`);
    let record: unknown;
    try { record = JSON.parse(line); } catch { throw new Error(`bookmap JSONL line ${index + 1} is not valid JSON`); }
    if (record === null || Array.isArray(record) || typeof record !== "object") throw new Error(`bookmap JSONL line ${index + 1} must be an object`);
    const event = record as JsonRecord;
    if (event.source !== "bookmap" || typeof event.schema_version !== "string" || !SUPPORTED_SCHEMA_VERSIONS.has(event.schema_version)) {
      throw new Error(`bookmap JSONL line ${index + 1} has unsupported provenance`);
    }
    if (typeof event.event_type !== "string" || !EVENT_TYPES.has(event.event_type)) throw new Error(`bookmap JSONL line ${index + 1} has unsupported event_type`);
    if (typeof event.instrument_alias !== "string" || event.instrument_alias.length === 0) throw new Error(`bookmap JSONL line ${index + 1} lacks instrument_alias`);
    const receivedAt = normalizeReceiptIso(event.received_at, `bookmap JSONL line ${index + 1} received_at`);
    if (alias !== null && alias !== event.instrument_alias) throw new Error("bookmap session mixes instrument aliases");
    alias = event.instrument_alias;
    versions.add(event.schema_version as "1.0" | "1.1");
    const normalizedEvent = { ...event, received_at: receivedAt.value } as BookmapFlowEvent;
    receiptTimestampNormalized ||= receivedAt.normalized;
    if (event.event_type === "instrument") {
      if (instrumentRecord !== null) throw new Error("bookmap session has multiple instrument records");
      instrumentRecord = normalizedEvent;
    }
    events.push(normalizedEvent);
    eventCounts[event.event_type] = (eventCounts[event.event_type] ?? 0) + 1;
  }

  if (events.length === 0 || alias === null || instrumentRecord === null) throw new Error("bookmap session requires an instrument record and at least one event");
  const ordered = [...events].sort((left, right) => left.received_at.localeCompare(right.received_at));
  const qualityIssues: string[] = [];
  if (versions.has("1.0")) qualityIssues.push("legacy_bookmap_time_precision_unverifiable");
  if (receiptTimestampNormalized) qualityIssues.push("legacy_receipt_timestamp_normalized_to_milliseconds");
  if (!events.some((event) => event.event_type === "snapshot_end")) qualityIssues.push("snapshot_completion_marker_missing");
  if ((eventCounts.trade ?? 0) === 0) qualityIssues.push("no_trade_events_captured");
  if (instrumentRecord.is_crypto === true) qualityIssues.push("crypto_feed_not_eligible_for_fx_proxy");
  if (instrumentRecord.is_full_depth !== true) qualityIssues.push("full_depth_not_confirmed");
  return {
    file_name: fileName, bytes, schema_versions: [...versions].sort(),
    instrument: {
      alias, symbol: optionalString(instrumentRecord.symbol), exchange: optionalString(instrumentRecord.exchange),
      instrument_type: optionalString(instrumentRecord.instrument_type), is_full_depth: optionalBoolean(instrumentRecord.is_full_depth),
      depth_listener_representation: optionalString(instrumentRecord.depth_listener_representation), mbo_captured: optionalBoolean(instrumentRecord.mbo_captured),
      is_crypto: optionalBoolean(instrumentRecord.is_crypto), data_delay_raw: optionalFiniteNumber(instrumentRecord.data_delay_raw),
    },
    events: ordered, first_received_at: ordered[0].received_at, last_received_at: ordered.at(-1)!.received_at,
    event_counts: eventCounts, snapshot_complete: events.some((event) => event.event_type === "snapshot_end"), quality_issues: qualityIssues,
  };
}

export function aggregateBookmapFlowByReceiptInterval(session: BookmapFlowSession, intervalSeconds: 60 | 300): BookmapFlowInterval[] {
  const intervalMs = intervalSeconds * 1_000;
  const buckets = new Map<number, BookmapFlowInterval>();
  for (const event of session.events) {
    if (!["depth", "bbo", "trade"].includes(event.event_type)) continue;
    const startMs = Math.floor(Date.parse(event.received_at) / intervalMs) * intervalMs;
    let bucket = buckets.get(startMs);
    if (!bucket) {
      bucket = { start: new Date(startMs).toISOString(), end: new Date(startMs + intervalMs).toISOString(), depth_updates: 0, bbo_updates: 0, trades: 0, unknown_aggressor_trades: 0, buy_size: 0, sell_size: 0, trade_delta: 0 };
      buckets.set(startMs, bucket);
    }
    if (event.event_type === "depth") bucket.depth_updates += 1;
    if (event.event_type === "bbo") bucket.bbo_updates += 1;
    if (event.event_type === "trade") {
      bucket.trades += 1;
      const size = optionalFiniteNumber(event.size);
      if (event.aggressor === "buy" && size !== null) bucket.buy_size = (bucket.buy_size ?? 0) + size;
      else if (event.aggressor === "sell" && size !== null) bucket.sell_size = (bucket.sell_size ?? 0) + size;
      else bucket.unknown_aggressor_trades += 1;
    }
  }
  return [...buckets.values()].sort((left, right) => left.start.localeCompare(right.start)).map((bucket) => ({
    ...bucket,
    buy_size: bucket.trades === 0 || bucket.unknown_aggressor_trades > 0 ? null : bucket.buy_size,
    sell_size: bucket.trades === 0 || bucket.unknown_aggressor_trades > 0 ? null : bucket.sell_size,
    trade_delta: bucket.trades === 0 || bucket.unknown_aggressor_trades > 0 ? null : (bucket.buy_size ?? 0) - (bucket.sell_size ?? 0),
  }));
}

export function preflightBookmapFlowPriceJoin(input: { session: BookmapFlowSession; intervals: BookmapFlowInterval[]; targetBars: OhlcvBar[]; expectedTimeframe: "1" | "5"; minimumIntervals: number }) {
  const closed = input.targetBars.filter((bar) => !bar.forming);
  const targetTimes = new Set(closed.map((bar) => bar.timeIso));
  const exactIntervals = input.intervals.filter((interval) => targetTimes.has(interval.end));
  const qualityIssues = [...input.session.quality_issues];
  if (input.intervals.length < input.minimumIntervals) qualityIssues.push("minimum_bookmap_intervals_not_met");
  if (exactIntervals.length !== input.intervals.length) qualityIssues.push("non_exact_target_bar_joins_excluded");
  if (input.intervals.some((interval) => interval.trades > 0 && interval.trade_delta === null)) qualityIssues.push("unknown_aggressor_trade_intervals_not_eligible_for_delta");
  return {
    contract: {
      source_proxy: "single_venue_cme_currency_futures_not_spot_fx_flow",
      source_clock: "collector_received_at", interval_seconds: input.expectedTimeframe === "1" ? 60 : 300,
      feature_available_at: "receipt_interval_end", minimum_target_lag_bars: 1,
      target_join: "exact_utc_interval_end_only_no_forward_fill",
      depth_balance: input.session.snapshot_complete ? "not_implemented" : "blocked_until_snapshot_end",
    },
    source: {
      file_name: input.session.file_name, schema_versions: input.session.schema_versions, instrument: input.session.instrument,
      first_received_at: input.session.first_received_at, last_received_at: input.session.last_received_at,
      event_counts: input.session.event_counts, snapshot_complete: input.session.snapshot_complete,
    },
    coverage: {
      receipt_intervals: input.intervals.length, exact_target_bar_intervals: exactIntervals.length,
      unmatched_intervals: input.intervals.length - exactIntervals.length, target_closed_bars: closed.length,
      minimum_intervals: input.minimumIntervals,
    },
    status: qualityIssues.length === 0 ? "complete" : "partial",
    quality_issues: qualityIssues,
  };
}
