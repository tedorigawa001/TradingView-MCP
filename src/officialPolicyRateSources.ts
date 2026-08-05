import { createHash } from "node:crypto";
import { assertExpectedResponseHost, readLimitedResponseBytes, readLimitedResponseText, type BoundedResponse } from "./boundedResponse.js";
import type { OfficialPolicyRateObservation, OfficialPolicyRateHistoryStore } from "./policyRateOfficialHistory.js";
import type { PolicyRateCurrency } from "./policyRateHistory.js";
import { OfficialPolicyRateRawArchive, resolvePolicyRateOfficialRawArchivePath } from "./policyRateOfficialRawArchive.js";
import { parseRbaHistoricalF1Xls } from "./rbaHistoricalF1Xls.js";

type ParsedOfficialPolicyRateSeries = { changes: Array<{ observation_date: string; value: number }>; source_observation_count: number; source_first_observation_date: string; source_last_observation_date: string };

type OfficialSource = {
  id: "ecb_deposit_facility" | "boc_target_overnight_rate" | "fred_fed_target_range_midpoint" | "rba_cash_rate_target" | "snb_policy_rate_or_libor_target_midpoint" | "boe_bank_rate";
  currency: PolicyRateCurrency;
  sourceSymbol: string;
  sourceUrl: string;
  parse: (raw: string) => ParsedOfficialPolicyRateSeries;
};

const ECB_DEPOSIT_FACILITY_URL = "https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?format=csvdata";
const BOC_TARGET_OVERNIGHT_RATE_URL = "https://www.bankofcanada.ca/valet/observations/V39079/json";
const FRED_FED_TARGET_SINGLE_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTAR";
const FRED_FED_TARGET_RANGE_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL,DFEDTARU";
const FRED_FED_TARGET_HISTORY_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTAR,DFEDTARL,DFEDTARU";
const RBA_CASH_RATE_TARGET_URL = "https://www.rba.gov.au/statistics/tables/csv/f1-data.csv";
const RBA_CASH_RATE_TARGET_HISTORICAL_URL = "https://www.rba.gov.au/statistics/tables/xls-hist/f01dhist.xls";
const SNB_OFFICIAL_INTEREST_RATES_URL = "https://data.snb.ch/api/cube/snboffzisa/data/csv/en";
// Bank Rate from the Bank of England Interactive Database. IUDBEDR is the daily official Bank Rate
// series; the export carries it forward across every calendar day, so only the changes are kept.
// This is the target of the 302 the documented /boeapps/iadb/ path issues. Following a redirect is
// refused here by design, so the destination is pinned; both return a byte-identical body.
const BOE_BANK_RATE_URL = "https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes&Datefrom=01/Jan/1975&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N";
const BOE_MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export const OFFICIAL_POLICY_RATE_SOURCES: Record<OfficialSource["id"], OfficialSource> = {
  ecb_deposit_facility: {
    id: "ecb_deposit_facility",
    currency: "EUR",
    sourceSymbol: "ECONOMICS:EUINTR",
    sourceUrl: ECB_DEPOSIT_FACILITY_URL,
    parse: parseEcbDepositFacilityCsv,
  },
  boc_target_overnight_rate: {
    id: "boc_target_overnight_rate",
    currency: "CAD",
    sourceSymbol: "ECONOMICS:CAINTR",
    sourceUrl: BOC_TARGET_OVERNIGHT_RATE_URL,
    parse: parseBocTargetOvernightRateJson,
  },
  fred_fed_target_range_midpoint: {
    id: "fred_fed_target_range_midpoint",
    currency: "USD",
    sourceSymbol: "ECONOMICS:USINTR",
    sourceUrl: FRED_FED_TARGET_RANGE_URL,
    parse: parseFredFedTargetRangeCsv,
  },
  rba_cash_rate_target: {
    id: "rba_cash_rate_target",
    currency: "AUD",
    sourceSymbol: "ECONOMICS:AUINTR",
    sourceUrl: RBA_CASH_RATE_TARGET_URL,
    parse: parseRbaCashRateTargetCsv,
  },
  boe_bank_rate: {
    id: "boe_bank_rate",
    currency: "GBP",
    sourceSymbol: "ECONOMICS:GBINTR",
    sourceUrl: BOE_BANK_RATE_URL,
    parse: parseBoeBankRateCsv,
  },
  snb_policy_rate_or_libor_target_midpoint: {
    id: "snb_policy_rate_or_libor_target_midpoint",
    currency: "CHF",
    sourceSymbol: "ECONOMICS:CHINTR",
    sourceUrl: SNB_OFFICIAL_INTEREST_RATES_URL,
    parse: parseSnbOfficialInterestRatesCsv,
  },
};

export type OfficialPolicyRateFetch = (url: string, init?: RequestInit) => Promise<BoundedResponse & { ok: boolean; status: number }>;

const MAX_OFFICIAL_POLICY_RATE_BYTES = 32 * 1024 * 1024;

/** Download current official history as exploratory evidence; never use this output for an as-of claim. */
export async function collectOfficialPolicyRateHistory(input: {
  sourceId: keyof typeof OFFICIAL_POLICY_RATE_SOURCES;
  store: Pick<OfficialPolicyRateHistoryStore, "observeMany" | "observeRawSnapshot">;
  archive?: Pick<OfficialPolicyRateRawArchive, "store">;
  fetch?: OfficialPolicyRateFetch;
  historicalRbaParser?: typeof parseRbaHistoricalF1Xls;
  now?: Date;
}) {
  const source = OFFICIAL_POLICY_RATE_SOURCES[input.sourceId];
  const fetcher = input.fetch ?? fetch;
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("official policy-rate retrieval time must be valid");
  if (source.id === "fred_fed_target_range_midpoint") return collectFredFedTargetHistory({ ...input, source, fetcher, retrievedNow: now });
  if (source.id === "rba_cash_rate_target") return collectRbaCashRateTargetHistory({ ...input, source, fetcher, retrievedNow: now });
  const response = await fetcher(source.sourceUrl, { redirect: "manual" });
  if (!response.ok) throw new Error(`official policy-rate source ${source.id} returned HTTP ${response.status}`);
  assertExpectedResponseHost(response, source.sourceUrl, `official policy-rate source ${source.id}`);
  const raw = await readLimitedResponseText(response, MAX_OFFICIAL_POLICY_RATE_BYTES, `official policy-rate source ${source.id}`);
  if (raw.length < 32) throw new Error(`official policy-rate source ${source.id} returned an unsafe payload size`);
  const parsed = source.parse(raw);
  if (parsed.changes.length < 1) throw new Error(`official policy-rate source ${source.id} returned no observations`);
  const retrievedAt = now.toISOString();
  const rawSha256 = `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
  const archive = await (input.archive ?? new OfficialPolicyRateRawArchive(resolvePolicyRateOfficialRawArchivePath())).store(rawSha256, raw);
  const rawSnapshot = await input.store.observeRawSnapshot({ source_id: source.id, source_url: source.sourceUrl, raw_sha256: rawSha256, source_observation_count: parsed.source_observation_count, source_first_observation_date: parsed.source_first_observation_date, source_last_observation_date: parsed.source_last_observation_date, raw_bytes: Buffer.byteLength(raw, "utf8"), retrieved_at: retrievedAt });
  const sourceVintageAt = response.headers.get("last-modified");
  const observations: OfficialPolicyRateObservation[] = parsed.changes.map((row) => ({
    currency: source.currency,
    source_symbol: source.sourceSymbol,
    observation_date: row.observation_date,
    value: row.value,
    source_url: source.sourceUrl,
    source_vintage_at: toCanonicalTimestamp(sourceVintageAt),
    raw_sha256: rawSha256,
    retrieved_at: retrievedAt,
  }));
  const persisted = await input.store.observeMany(observations);
  return { source_id: source.id, currency: source.currency as PolicyRateCurrency, source_url: source.sourceUrl, raw_sha256: rawSha256, raw_archive: archive, raw_snapshot: rawSnapshot, retrieved_at: retrievedAt, observations: observations.length, source_coverage: { source_observation_count: parsed.source_observation_count, source_first_observation_date: parsed.source_first_observation_date, source_last_observation_date: parsed.source_last_observation_date }, first_seen: { recorded: persisted.recorded.length, unchanged: persisted.unchanged, revisions: persisted.revisions } };
}

async function collectRbaCashRateTargetHistory(input: {
  sourceId: keyof typeof OFFICIAL_POLICY_RATE_SOURCES;
  store: Pick<OfficialPolicyRateHistoryStore, "observeMany" | "observeRawSnapshot">;
  archive?: Pick<OfficialPolicyRateRawArchive, "store">;
  fetch?: OfficialPolicyRateFetch;
  historicalRbaParser?: typeof parseRbaHistoricalF1Xls;
  now?: Date;
  source: OfficialSource;
  fetcher: OfficialPolicyRateFetch;
  retrievedNow: Date;
}) {
  const historicalResponse = await input.fetcher(RBA_CASH_RATE_TARGET_HISTORICAL_URL, { redirect: "manual" });
  if (!historicalResponse.ok) throw new Error(`official policy-rate source ${input.source.id} historical F1 returned HTTP ${historicalResponse.status}`);
  assertExpectedResponseHost(historicalResponse, RBA_CASH_RATE_TARGET_HISTORICAL_URL, "official policy-rate source rba_cash_rate_target historical F1");
  const historicalRaw = Buffer.from(await readLimitedResponseBytes(historicalResponse, MAX_OFFICIAL_POLICY_RATE_BYTES, "official policy-rate source rba_cash_rate_target historical F1"));
  if (historicalRaw.length < 4_096) throw new Error("official policy-rate source rba_cash_rate_target historical F1 returned an unsafe payload size");
  const historical = (input.historicalRbaParser ?? parseRbaHistoricalF1Xls)(historicalRaw);
  const currentResponse = await input.fetcher(input.source.sourceUrl, { redirect: "manual" });
  if (!currentResponse.ok) throw new Error(`official policy-rate source ${input.source.id} returned HTTP ${currentResponse.status}`);
  assertExpectedResponseHost(currentResponse, input.source.sourceUrl, `official policy-rate source ${input.source.id}`);
  const currentRaw = await readLimitedResponseText(currentResponse, MAX_OFFICIAL_POLICY_RATE_BYTES, `official policy-rate source ${input.source.id}`);
  if (currentRaw.length < 32) throw new Error(`official policy-rate source ${input.source.id} returned an unsafe payload size`);
  const current = parseRbaCashRateTargetCsv(currentRaw);
  if (historical.source_last_observation_date !== "2010-12-31" || current.source_first_observation_date !== "2011-01-04") throw new Error("RBA F1 historical and current coverage no longer meet the reviewed handoff boundary");
  const retrievedAt = input.retrievedNow.toISOString();
  const archiveStore = input.archive ?? new OfficialPolicyRateRawArchive(resolvePolicyRateOfficialRawArchivePath());
  const historicalSha256 = `sha256:${createHash("sha256").update(historicalRaw).digest("hex")}`;
  const currentSha256 = `sha256:${createHash("sha256").update(currentRaw, "utf8").digest("hex")}`;
  const historicalArchive = await archiveStore.store(historicalSha256, historicalRaw);
  const currentArchive = await archiveStore.store(currentSha256, currentRaw);
  const historicalSnapshot = await input.store.observeRawSnapshot({ source_id: "rba_cash_rate_target_historical_f1", source_url: RBA_CASH_RATE_TARGET_HISTORICAL_URL, raw_sha256: historicalSha256, source_observation_count: historical.source_observation_count, source_first_observation_date: historical.source_first_observation_date, source_last_observation_date: historical.source_last_observation_date, raw_bytes: historicalRaw.length, retrieved_at: retrievedAt });
  const currentSnapshot = await input.store.observeRawSnapshot({ source_id: input.source.id, source_url: input.source.sourceUrl, raw_sha256: currentSha256, source_observation_count: current.source_observation_count, source_first_observation_date: current.source_first_observation_date, source_last_observation_date: current.source_last_observation_date, raw_bytes: Buffer.byteLength(currentRaw, "utf8"), retrieved_at: retrievedAt });
  const merged = compactRbaChanges([
    ...historical.changes.map((row) => ({ ...row, source_url: RBA_CASH_RATE_TARGET_HISTORICAL_URL, raw_sha256: historicalSha256, source_vintage_at: toCanonicalTimestamp(historicalResponse.headers.get("last-modified")) })),
    ...current.changes.map((row) => ({ ...row, source_url: input.source.sourceUrl, raw_sha256: currentSha256, source_vintage_at: toCanonicalTimestamp(currentResponse.headers.get("last-modified")) })),
  ]);
  const observations: OfficialPolicyRateObservation[] = merged.map((row) => ({ currency: input.source.currency, source_symbol: input.source.sourceSymbol, observation_date: row.observation_date, value: row.value, source_url: row.source_url, source_vintage_at: row.source_vintage_at, raw_sha256: row.raw_sha256, retrieved_at: retrievedAt }));
  const persisted = await input.store.observeMany(observations);
  return { source_id: input.source.id, currency: input.source.currency as PolicyRateCurrency, source_url: input.source.sourceUrl, retrieved_at: retrievedAt, observations: observations.length, source_coverage: { source_observation_count: historical.source_observation_count + current.source_observation_count, source_first_observation_date: historical.source_first_observation_date, source_last_observation_date: current.source_last_observation_date }, raw_archives: { historical: historicalArchive, current: currentArchive }, raw_snapshots: { historical: historicalSnapshot, current: currentSnapshot }, first_seen: { recorded: persisted.recorded.length, unchanged: persisted.unchanged, revisions: persisted.revisions } };
}

function compactRbaChanges<T extends { observation_date: string; value: number }>(rows: T[]): T[] {
  const output: T[] = [];
  let priorDate: string | null = null;
  let priorValue: number | null = null;
  for (const row of rows) {
    if (priorDate !== null && row.observation_date <= priorDate) throw new Error("RBA F1 historical and current observations overlap or are unordered");
    priorDate = row.observation_date;
    if (priorValue === row.value) continue;
    output.push(row);
    priorValue = row.value;
  }
  return output;
}

type FredFedTargetHistoryRow = { observation_date: string; value: number; source_url: string };

/**
 * FRED publishes the pre-2008 single target and the post-2008 range as separate
 * series.  Retain their individual URLs on observations so adding the old series
 * does not rewrite the provenance of the already-collected range history.
 */
async function collectFredFedTargetHistory(input: {
  sourceId: keyof typeof OFFICIAL_POLICY_RATE_SOURCES;
  store: Pick<OfficialPolicyRateHistoryStore, "observeMany" | "observeRawSnapshot">;
  archive?: Pick<OfficialPolicyRateRawArchive, "store">;
  fetch?: OfficialPolicyRateFetch;
  now?: Date;
  source: OfficialSource;
  fetcher: OfficialPolicyRateFetch;
  retrievedNow: Date;
}) {
  const response = await input.fetcher(FRED_FED_TARGET_HISTORY_URL, { redirect: "manual" });
  if (!response.ok) throw new Error(`official policy-rate source ${input.source.id} returned HTTP ${response.status}`);
  assertExpectedResponseHost(response, FRED_FED_TARGET_HISTORY_URL, `official policy-rate source ${input.source.id}`);
  const raw = await readLimitedResponseText(response, MAX_OFFICIAL_POLICY_RATE_BYTES, `official policy-rate source ${input.source.id}`);
  if (raw.length < 32) throw new Error(`official policy-rate source ${input.source.id} returned an unsafe payload size`);
  const parsed = parseFredFedTargetHistoryCsv(raw);
  const retrievedAt = input.retrievedNow.toISOString();
  const rawSha256 = `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
  const archive = await (input.archive ?? new OfficialPolicyRateRawArchive(resolvePolicyRateOfficialRawArchivePath())).store(rawSha256, raw);
  const rawSnapshot = await input.store.observeRawSnapshot({ source_id: input.source.id, source_url: FRED_FED_TARGET_HISTORY_URL, raw_sha256: rawSha256, source_observation_count: parsed.source_observation_count, source_first_observation_date: parsed.source_first_observation_date, source_last_observation_date: parsed.source_last_observation_date, raw_bytes: Buffer.byteLength(raw, "utf8"), retrieved_at: retrievedAt });
  const sourceVintageAt = toCanonicalTimestamp(response.headers.get("last-modified"));
  const observations: OfficialPolicyRateObservation[] = parsed.changes.map((row) => ({
    currency: input.source.currency,
    source_symbol: input.source.sourceSymbol,
    observation_date: row.observation_date,
    value: row.value,
    source_url: row.source_url,
    source_vintage_at: sourceVintageAt,
    raw_sha256: rawSha256,
    retrieved_at: retrievedAt,
  }));
  const persisted = await input.store.observeMany(observations);
  return { source_id: input.source.id, currency: input.source.currency as PolicyRateCurrency, source_url: FRED_FED_TARGET_HISTORY_URL, raw_sha256: rawSha256, raw_archive: archive, raw_snapshot: rawSnapshot, retrieved_at: retrievedAt, observations: observations.length, source_coverage: { source_observation_count: parsed.source_observation_count, source_first_observation_date: parsed.source_first_observation_date, source_last_observation_date: parsed.source_last_observation_date }, first_seen: { recorded: persisted.recorded.length, unchanged: persisted.unchanged, revisions: persisted.revisions } };
}

export function parseEcbDepositFacilityCsv(raw: string): ParsedOfficialPolicyRateSeries {
  const lines = raw.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("ECB deposit facility CSV has no data rows");
  const headers = parseCsvLine(lines[0]);
  const dateIndex = headers.indexOf("TIME_PERIOD");
  const valueIndex = headers.indexOf("OBS_VALUE");
  const seriesIndex = headers.indexOf("KEY");
  if (dateIndex < 0 || valueIndex < 0 || seriesIndex < 0) throw new Error("ECB deposit facility CSV is missing required columns");
  const observations: Array<{ observation_date: string; value: number }> = [];
  let sourceCount = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let prior: number | null = null;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells[seriesIndex] !== "FM.D.U2.EUR.4F.KR.DFR.LEV") throw new Error("ECB deposit facility CSV returned an unexpected series");
    const date = cells[dateIndex];
    const value = Number(cells[valueIndex]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) throw new Error("ECB deposit facility CSV contains an invalid observation");
    if (lastDate !== null && date <= lastDate) throw new Error("ECB deposit facility CSV observations are not strictly ordered");
    sourceCount += 1;
    firstDate ??= date;
    lastDate = date;
    if (prior === value) continue;
    observations.push({ observation_date: date, value });
    prior = value;
  }
  if (firstDate === null || lastDate === null) throw new Error("ECB deposit facility CSV has no valid observations");
  return { changes: observations, source_observation_count: sourceCount, source_first_observation_date: firstDate, source_last_observation_date: lastDate };
}

export function parseBocTargetOvernightRateJson(raw: string): ParsedOfficialPolicyRateSeries {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("BoC target overnight rate response is not JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("BoC target overnight rate response is not an object");
  const observations = (parsed as { observations?: unknown }).observations;
  if (!Array.isArray(observations) || observations.length < 1) throw new Error("BoC target overnight rate response has no observations");
  const changes: Array<{ observation_date: string; value: number }> = [];
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let prior: number | null = null;
  for (const item of observations) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("BoC target overnight rate response contains an invalid observation");
    const row = item as { d?: unknown; V39079?: { v?: unknown } };
    const date = row.d;
    const value = typeof row.V39079?.v === "string" ? Number(row.V39079.v) : NaN;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) throw new Error("BoC target overnight rate response contains an invalid value");
    if (lastDate !== null && date <= lastDate) throw new Error("BoC target overnight rate observations are not strictly ordered");
    firstDate ??= date;
    lastDate = date;
    if (prior === value) continue;
    changes.push({ observation_date: date, value });
    prior = value;
  }
  if (firstDate === null || lastDate === null) throw new Error("BoC target overnight rate response has no valid observations");
  return { changes, source_observation_count: observations.length, source_first_observation_date: firstDate, source_last_observation_date: lastDate };
}

/**
 * Bank of England Bank Rate, `DATE,IUDBEDR` with dates as `02 Jan 1975`. The export is a daily
 * carry-forward series, so the change points are what an as-of join needs; the raw row count is
 * kept separately so a shortened export is visible as reduced coverage rather than fewer changes.
 */
export function parseBoeBankRateCsv(raw: string): ParsedOfficialPolicyRateSeries {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("BoE Bank Rate response has no observations");
  const header = lines[0].split(",").map((cell) => cell.trim());
  if (header[0] !== "DATE" || header[1] !== "IUDBEDR" || header.length !== 2) {
    throw new Error("BoE Bank Rate response does not carry the expected DATE and IUDBEDR columns");
  }
  const changes: Array<{ observation_date: string; value: number }> = [];
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let prior: number | null = null;
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== 2) throw new Error("BoE Bank Rate response contains a malformed row");
    const match = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(cells[0]);
    const month = match === null ? undefined : BOE_MONTHS[match[2]];
    if (match === null || month === undefined) throw new Error(`BoE Bank Rate response contains an unreadable date ${cells[0]}`);
    const date = `${match[3]}-${month}-${match[1]}`;
    if (new Date(`${date}T12:00:00.000Z`).toISOString().slice(0, 10) !== date) {
      throw new Error(`BoE Bank Rate response contains a date the calendar does not have: ${cells[0]}`);
    }
    const value = Number(cells[1]);
    if (cells[1] === "" || !Number.isFinite(value)) throw new Error("BoE Bank Rate response contains a non-finite rate");
    if (lastDate !== null && date <= lastDate) throw new Error("BoE Bank Rate observations are not strictly ordered");
    firstDate ??= date;
    lastDate = date;
    if (prior === value) continue;
    changes.push({ observation_date: date, value });
    prior = value;
  }
  if (firstDate === null || lastDate === null) throw new Error("BoE Bank Rate response has no valid observations");
  return { changes, source_observation_count: lines.length - 1, source_first_observation_date: firstDate, source_last_observation_date: lastDate };
}

export function parseFredFedTargetRangeCsv(raw: string): ParsedOfficialPolicyRateSeries {
  const lines = raw.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("FRED Fed target range CSV has no data rows");
  const headers = parseCsvLine(lines[0]);
  const dateIndex = headers.indexOf("observation_date");
  const lowerIndex = headers.indexOf("DFEDTARL");
  const upperIndex = headers.indexOf("DFEDTARU");
  if (dateIndex < 0 || lowerIndex < 0 || upperIndex < 0) throw new Error("FRED Fed target range CSV is missing required columns");
  const changes: Array<{ observation_date: string; value: number }> = [];
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let prior: number | null = null;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const date = cells[dateIndex];
    const lower = Number(cells[lowerIndex]);
    const upper = Number(cells[upperIndex]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper || lower < -10 || upper > 100) throw new Error("FRED Fed target range CSV contains an invalid observation");
    if (lastDate !== null && date <= lastDate) throw new Error("FRED Fed target range CSV observations are not strictly ordered");
    firstDate ??= date;
    lastDate = date;
    const midpoint = (lower + upper) / 2;
    if (prior === midpoint) continue;
    changes.push({ observation_date: date, value: midpoint });
    prior = midpoint;
  }
  if (firstDate === null || lastDate === null) throw new Error("FRED Fed target range CSV has no valid observations");
  return { changes, source_observation_count: lines.length - 1, source_first_observation_date: firstDate, source_last_observation_date: lastDate };
}

/** Preserve the former single target before the range was introduced on 2008-12-16. */
export function parseFredFedTargetHistoryCsv(raw: string): { changes: FredFedTargetHistoryRow[]; source_observation_count: number; source_first_observation_date: string; source_last_observation_date: string } {
  const lines = raw.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("FRED Fed target history CSV has no data rows");
  const headers = parseCsvLine(lines[0]);
  const dateIndex = headers.indexOf("observation_date");
  const singleIndex = headers.indexOf("DFEDTAR");
  const lowerIndex = headers.indexOf("DFEDTARL");
  const upperIndex = headers.indexOf("DFEDTARU");
  if (dateIndex < 0 || singleIndex < 0 || lowerIndex < 0 || upperIndex < 0) throw new Error("FRED Fed target history CSV is missing required columns");
  const changes: FredFedTargetHistoryRow[] = [];
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let prior: number | null = null;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const date = cells[dateIndex];
    const single = cells[singleIndex]?.trim() ?? "";
    const lower = cells[lowerIndex]?.trim() ?? "";
    const upper = cells[upperIndex]?.trim() ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (single === "" && (lower === "" || upper === "")) || (single !== "" && (lower !== "" || upper !== ""))) throw new Error("FRED Fed target history CSV contains an ambiguous observation");
    const value = single === "" ? (Number(lower) + Number(upper)) / 2 : Number(single);
    if (!Number.isFinite(value) || value < -10 || value > 100 || (single === "" && Number(lower) > Number(upper))) throw new Error("FRED Fed target history CSV contains an invalid observation");
    if (lastDate !== null && date <= lastDate) throw new Error("FRED Fed target history CSV observations are not strictly ordered");
    firstDate ??= date;
    lastDate = date;
    if (prior === value) continue;
    changes.push({ observation_date: date, value, source_url: single === "" ? FRED_FED_TARGET_RANGE_URL : FRED_FED_TARGET_SINGLE_URL });
    prior = value;
  }
  if (firstDate === null || lastDate === null) throw new Error("FRED Fed target history CSV has no valid observations");
  return { changes, source_observation_count: lines.length - 1, source_first_observation_date: firstDate, source_last_observation_date: lastDate };
}

/** RBA F1 is a metadata-prefixed daily CSV; FIRMMCRTD is the target, not the realised cash rate. */
export function parseRbaCashRateTargetCsv(raw: string): ParsedOfficialPolicyRateSeries {
  const lines = raw.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => line.startsWith("Title,"));
  const seriesIndex = lines.findIndex((line) => line.startsWith("Series ID,"));
  if (titleIndex < 0 || seriesIndex < 0 || seriesIndex <= titleIndex || seriesIndex + 1 >= lines.length) throw new Error("RBA cash rate target CSV is missing required metadata");
  const titles = parseCsvLine(lines[titleIndex]);
  const seriesIds = parseCsvLine(lines[seriesIndex]);
  const targetIndex = seriesIds.indexOf("FIRMMCRTD");
  if (targetIndex < 1 || titles[targetIndex] !== "Cash Rate Target") throw new Error("RBA cash rate target CSV returned an unexpected series");
  const changes: Array<{ observation_date: string; value: number }> = [];
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let sourceCount = 0;
  let prior: number | null = null;
  for (const line of lines.slice(seriesIndex + 1)) {
    const cells = parseCsvLine(line);
    const rawDate = cells[0];
    const rawValue = cells[targetIndex]?.trim();
    // The live F1 file includes the current incomplete trading day with no target value.
    if (rawValue === "") continue;
    const value = Number(rawValue);
    if (!/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(rawDate) || !Number.isFinite(value) || value < -10 || value > 100) throw new Error("RBA cash rate target CSV contains an invalid observation");
    const date = parseRbaDate(rawDate);
    if (lastDate !== null && date <= lastDate) throw new Error("RBA cash rate target CSV observations are not strictly ordered");
    firstDate ??= date;
    lastDate = date;
    sourceCount += 1;
    if (prior === value) continue;
    changes.push({ observation_date: date, value });
    prior = value;
  }
  if (firstDate === null || lastDate === null) throw new Error("RBA cash rate target CSV has no valid observations");
  return { changes, source_observation_count: sourceCount, source_first_observation_date: firstDate, source_last_observation_date: lastDate };
}

/** SNB publishes the policy rate from June 2019 and the 3-month Libor target range before then. */
export function parseSnbOfficialInterestRatesCsv(raw: string): ParsedOfficialPolicyRateSeries {
  const lines = raw.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines[0] !== '"CubeId";"snboffzisa"') throw new Error("SNB official interest rates CSV returned an unexpected cube");
  const headerIndex = lines.findIndex((line) => line === '"Date";"D0";"Value"');
  if (headerIndex < 0 || headerIndex + 1 >= lines.length) throw new Error("SNB official interest rates CSV is missing required columns");
  const months = new Map<string, { policy: number | null; lower: number | null; upper: number | null }>();
  for (const line of lines.slice(headerIndex + 1)) {
    const [month, code, rawValue] = parseDelimitedLine(line, ";", "SNB official interest rates CSV");
    if (!/^\d{4}-\d{2}$/.test(month) || !["LZ", "UG0", "OG0"].includes(code)) continue;
    const row = months.get(month) ?? { policy: null, lower: null, upper: null };
    const value = rawValue === "" ? null : Number(rawValue);
    if (value !== null && (!Number.isFinite(value) || value < -10 || value > 100)) throw new Error("SNB official interest rates CSV contains an invalid observation");
    if (code === "LZ") row.policy = value;
    else if (code === "UG0") row.lower = value;
    else row.upper = value;
    months.set(month, row);
  }
  const changes: Array<{ observation_date: string; value: number }> = [];
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let prior: number | null = null;
  for (const [month, row] of [...months.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const date = monthEndDate(month);
    if (lastDate !== null && date <= lastDate) throw new Error("SNB official interest rates CSV observations are not strictly ordered");
    let value: number;
    if (row.policy !== null) value = row.policy;
    else {
      if (row.lower === null || row.upper === null || row.lower > row.upper) throw new Error("SNB official interest rates CSV has an incomplete Libor target range");
      value = (row.lower + row.upper) / 2;
    }
    firstDate ??= date;
    lastDate = date;
    if (prior === value) continue;
    changes.push({ observation_date: date, value });
    prior = value;
  }
  if (firstDate === null || lastDate === null) throw new Error("SNB official interest rates CSV has no valid observations");
  return { changes, source_observation_count: months.size, source_first_observation_date: firstDate, source_last_observation_date: lastDate };
}

function parseRbaDate(value: string): string {
  const [day, monthName, year] = value.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(monthName);
  if (month < 0) throw new Error("RBA cash rate target CSV contains an invalid date");
  const date = new Date(Date.UTC(Number(year), month, Number(day)));
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== month || date.getUTCDate() !== Number(day)) throw new Error("RBA cash rate target CSV contains an invalid date");
  return date.toISOString().slice(0, 10);
}

function monthEndDate(value: string): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) throw new Error("SNB official interest rates CSV contains an invalid month");
  return date.toISOString().slice(0, 10);
}

function parseCsvLine(line: string): string[] {
  return parseDelimitedLine(line, ",", "ECB deposit facility CSV");
}

function parseDelimitedLine(line: string, delimiter: string, errorPrefix: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(cell); cell = ""; } else cell += char;
  }
  if (quoted) throw new Error(`${errorPrefix} contains an unterminated quoted field`);
  cells.push(cell);
  return cells;
}

function toCanonicalTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
