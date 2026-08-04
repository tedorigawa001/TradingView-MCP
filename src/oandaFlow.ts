import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertExpectedResponseHost, readLimitedResponseText, type BoundedResponse } from "./boundedResponse.js";

export const OANDA_FLOW_INSTRUMENTS = ["EUR_USD", "USD_JPY"] as const;
export type OandaFlowInstrument = typeof OANDA_FLOW_INSTRUMENTS[number];

const BASE_URL = "https://api-fxpractice.oanda.com";
const ENVIRONMENT = "practice" as const;
/**
 * Each of the four percentage series is a share across price buckets, so each should total about a
 * hundred. The band is deliberately wide: the invariant is read from what the endpoint reports, not
 * verified against a live response, and rounding across many buckets moves the total a little. It is
 * wide enough that only a truncated or partial body trips it, which is the failure worth catching.
 */
const PERCENT_SHARE_TOTAL_TOLERANCE = 10;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RAW_BYTES = 8 * 1024 * 1024;

export type OandaPricePoint = { price: number; shortOrdersPercent: number; longOrdersPercent: number; shortPositionsPercent: number; longPositionsPercent: number };
/**
 * `collectedAt` is when this run fetched the response, not when the snapshot was first observed.
 * The endpoints return history, so re-collecting the same provider snapshot stamps a later time on
 * every run. Calling it a first-seen time would promise the append-only, monotonic guarantee that
 * firstSeenStore provides and this collector does not use.
 */
export type OandaOrderBookSnapshot = { providerTimestamp: string; rate: number; pricePoints: OandaPricePoint[]; rawSha256: string; collectedAt: string };
export type OandaPositionRatioSnapshot = { providerTimestamp: string; longPositionPercent: number; rate: number; rawSha256: string; collectedAt: string };

export type OandaFlowCollection = {
  schemaVersion: "1.0";
  series: "oanda_retail_order_and_position_flow";
  evidenceTier: "broker_retail_sentiment_history";
  instrument: OandaFlowInstrument;
  environment: "practice";
  collectedAt: string;
  orderBook: { requestedPeriodSeconds: 3600; rawSha256: string; rawBytes: number; snapshots: OandaOrderBookSnapshot[] };
  positionRatios: { requestedPeriodSeconds: 86400; rawSha256: string; rawBytes: number; snapshots: OandaPositionRatioSnapshot[] };
  limitations: string[];
};

export const resolveOandaFlowRawArchivePath = (configured = process.env.TRADINGVIEW_MCP_OANDA_FLOW_RAW_ARCHIVE_PATH) =>
  configured?.trim() || join(homedir(), ".tradingview-mcp", "oanda-flow-raw");

export const oandaFlowTokenConfigured = (env = process.env) => typeof env.OANDA_FX_PRACTICE_TOKEN === "string" && env.OANDA_FX_PRACTICE_TOKEN.trim().length > 0;

type OandaFetchResponse = BoundedResponse & { ok: boolean; status: number };
export type OandaFlowFetch = (url: string, init?: RequestInit) => Promise<OandaFetchResponse>;

function canonicalTimestamp(seconds: unknown, label: string): string {
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 0) throw new Error(`OANDA ${label} timestamp is invalid`);
  return new Date(seconds * 1_000).toISOString();
}

function finitePercent(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`OANDA ${label} percent is invalid`);
  return value;
}

function finiteRate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`OANDA ${label} rate is invalid`);
  return value;
}

function digest(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

/** Order-book levels are OANDA-client percentages, not executable market depth or aggressor-side flow. */
export function parseOandaOrderBook(raw: string, collectedAt: string): Omit<OandaOrderBookSnapshot, "rawSha256">[] {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OANDA order-book response must be an object");
  const snapshots: Omit<OandaOrderBookSnapshot, "rawSha256">[] = [];
  for (const [timestamp, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^\d+$/.test(timestamp) || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("OANDA order-book snapshot is invalid");
    const snapshot = value as { rate?: unknown; price_points?: unknown };
    if (!snapshot.price_points || typeof snapshot.price_points !== "object" || Array.isArray(snapshot.price_points)) throw new Error("OANDA order-book price points are invalid");
    const pricePoints = Object.entries(snapshot.price_points as Record<string, unknown>).map(([price, point]) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) throw new Error("OANDA order-book price point is invalid");
      const values = point as { os?: unknown; ol?: unknown; ps?: unknown; pl?: unknown };
      return { price: finiteRate(Number(price), "price point"), shortOrdersPercent: finitePercent(values.os, "short orders"), longOrdersPercent: finitePercent(values.ol, "long orders"), shortPositionsPercent: finitePercent(values.ps, "short positions"), longPositionsPercent: finitePercent(values.pl, "long positions") };
    });
    if (pricePoints.length === 0 || pricePoints.length > 10_000) throw new Error("OANDA order-book price point count is invalid");
    const totals = {
      shortOrders: pricePoints.reduce((sum, point) => sum + point.shortOrdersPercent, 0),
      longOrders: pricePoints.reduce((sum, point) => sum + point.longOrdersPercent, 0),
      shortPositions: pricePoints.reduce((sum, point) => sum + point.shortPositionsPercent, 0),
      longPositions: pricePoints.reduce((sum, point) => sum + point.longPositionsPercent, 0),
    };
    for (const [label, total] of Object.entries(totals)) {
      if (Math.abs(total - 100) > PERCENT_SHARE_TOTAL_TOLERANCE) {
        throw new Error(`OANDA order-book ${label} shares total ${total.toFixed(2)} percent across price points, so the body is incomplete`);
      }
    }
    snapshots.push({ providerTimestamp: canonicalTimestamp(Number(timestamp), "order-book"), rate: finiteRate(snapshot.rate, "order-book"), pricePoints: pricePoints.sort((left, right) => left.price - right.price), collectedAt });
  }
  if (snapshots.length === 0) throw new Error("OANDA order-book response has no snapshots");
  return snapshots.sort((left, right) => left.providerTimestamp.localeCompare(right.providerTimestamp));
}

export function parseOandaPositionRatios(raw: string, instrument: OandaFlowInstrument, collectedAt: string): Omit<OandaPositionRatioSnapshot, "rawSha256">[] {
  const parsed: unknown = JSON.parse(raw);
  const rows = (parsed as { data?: Record<string, { data?: unknown }> })?.data?.[instrument]?.data;
  if (!Array.isArray(rows)) throw new Error("OANDA position-ratio response is invalid");
  const snapshots = rows.map((row) => {
    if (!Array.isArray(row) || row.length !== 3) throw new Error("OANDA position-ratio row is invalid");
    return { providerTimestamp: canonicalTimestamp(row[0], "position-ratio"), longPositionPercent: finitePercent(row[1], "long position ratio"), rate: finiteRate(row[2], "position-ratio"), collectedAt };
  });
  if (snapshots.length === 0) throw new Error("OANDA position-ratio response has no snapshots");
  return snapshots.sort((left, right) => left.providerTimestamp.localeCompare(right.providerTimestamp));
}

export class OandaFlowRawArchive {
  constructor(private readonly directory: string) {}

  async store(rawSha256: string, raw: string): Promise<{ stored: boolean; bytes: number }> {
    if (!/^sha256:[a-f0-9]{64}$/.test(rawSha256)) throw new Error("OANDA flow raw archive requires a SHA-256 key");
    const body = Buffer.from(raw, "utf8");
    if (body.byteLength < 1 || body.byteLength > MAX_RAW_BYTES) throw new Error("OANDA flow raw archive payload size is unsafe");
    if (digest(raw) !== rawSha256) throw new Error("OANDA flow raw archive hash does not match payload");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) throw new Error("OANDA flow raw archive directory is unsafe");
    const path = join(this.directory, `${rawSha256.slice(7)}.raw`);
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(body); await handle.sync(); await handle.chmod(0o600); } finally { await handle.close(); }
      return { stored: true, bytes: body.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("unable to write OANDA flow raw archive", { cause: error });
      const existing = await readFile(path);
      if (existing.byteLength !== body.byteLength || digest(existing.toString("utf8")) !== rawSha256) throw new Error("OANDA flow raw archive existing payload does not match");
      return { stored: false, bytes: body.byteLength };
    }
  }
}

async function fetchOandaJson(url: string, token: string, fetcher: OandaFlowFetch): Promise<string> {
  const response = await fetcher(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "manual" });
  if (!response.ok) throw new Error(`OANDA flow source returned HTTP ${response.status}`);
  assertExpectedResponseHost(response, url, "OANDA flow source");
  return readLimitedResponseText(response, MAX_RESPONSE_BYTES, "OANDA flow source");
}

export async function collectOandaFlow(input: { instrument: OandaFlowInstrument; token: string; now?: Date; fetch?: OandaFlowFetch; rawArchivePath?: string }): Promise<OandaFlowCollection> {
  if (!OANDA_FLOW_INSTRUMENTS.includes(input.instrument)) throw new Error("unsupported OANDA flow instrument");
  if (!input.token.trim()) throw new Error("OANDA FX practice token is required");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("collection clock is invalid");
  const collectedAt = now.toISOString();
  const fetcher = input.fetch ?? ((url, init) => fetch(url, init) as Promise<OandaFetchResponse>);
  const orderBookUrl = new URL("/labs/v1/orderbook_data", BASE_URL); orderBookUrl.searchParams.set("instrument", input.instrument); orderBookUrl.searchParams.set("period", "3600");
  const ratiosUrl = new URL("/labs/v1/historical_position_ratios", BASE_URL); ratiosUrl.searchParams.set("instrument", input.instrument); ratiosUrl.searchParams.set("period", "86400");
  const [orderBookRaw, ratiosRaw] = await Promise.all([fetchOandaJson(orderBookUrl.toString(), input.token, fetcher), fetchOandaJson(ratiosUrl.toString(), input.token, fetcher)]);
  const orderBookHash = digest(orderBookRaw); const ratiosHash = digest(ratiosRaw);
  const archive = new OandaFlowRawArchive(input.rawArchivePath ?? resolveOandaFlowRawArchivePath());
  const [orderBookArchive, ratiosArchive] = await Promise.all([archive.store(orderBookHash, orderBookRaw), archive.store(ratiosHash, ratiosRaw)]);
  return {
    schemaVersion: "1.0", series: "oanda_retail_order_and_position_flow", evidenceTier: "broker_retail_sentiment_history", instrument: input.instrument, environment: ENVIRONMENT, collectedAt,
    orderBook: { requestedPeriodSeconds: 3600, rawSha256: orderBookHash, rawBytes: orderBookArchive.bytes, snapshots: parseOandaOrderBook(orderBookRaw, collectedAt).map((snapshot) => ({ ...snapshot, rawSha256: orderBookHash })) },
    positionRatios: { requestedPeriodSeconds: 86400, rawSha256: ratiosHash, rawBytes: ratiosArchive.bytes, snapshots: parseOandaPositionRatios(ratiosRaw, input.instrument, collectedAt).map((snapshot) => ({ ...snapshot, rawSha256: ratiosHash })) },
    limitations: [
      "OANDA-client percentage distributions, not market-wide order-book depth or trade flow.",
      "Collected from the OANDA practice environment, whose client population need not match the live one.",
      "collectedAt is this run fetch time, not a first-seen record; re-collecting the same provider snapshot stamps a later time, so these responses stay exploratory until a first-seen ledger records them.",
      "No order placement, execution, or trading action is performed.",
    ],
  };
}
