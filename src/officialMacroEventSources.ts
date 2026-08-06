import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assertExpectedResponseHost, readLimitedResponseText, type BoundedResponse } from "./boundedResponse.js";

export type OfficialMacroEventKind = "us_cpi" | "us_nfp" | "fomc_statement";

export type OfficialMacroEvent = {
  event_id: string;
  event_kind: OfficialMacroEventKind;
  occurred_at: string;
  source_url: string;
  raw_sha256: string;
};

export type OfficialMacroNonPublication = {
  event_kind: "us_cpi" | "us_nfp";
  reference_month: string;
  reason: "not_published_due_to_lapse_in_appropriations";
  source_url: string;
  raw_sha256: string;
};

export type OfficialMacroEventArtifact = {
  schema_version: "1.0";
  series: "official_us_macro_release_events";
  evidence_tier: "official_revised_history";
  retrieved_at: string;
  event_kind: OfficialMacroEventKind;
  events: OfficialMacroEvent[];
  non_publications: OfficialMacroNonPublication[];
  /**
   * Releases the source lists that had not happened when it was read. BLS publishes the employment
   * situation schedule a year ahead, archive URL and all, and a link is a link to a parser. A
   * release that has not occurred has no occurrence time to record: the schedule says when it is
   * meant to happen, and a delay would leave that time wrong with nothing to reveal it. Kept
   * separately because the schedule is worth having, just not as evidence that something happened.
   */
  scheduled_future_releases: OfficialMacroEvent[];
  source_count: number;
  coverage: {
    requested_from_year: number;
    requested_to_year: number;
    events_by_year: Record<string, number>;
    excused_non_publications_by_year: Record<string, number>;
    /** Release months with neither an event nor a recorded official non-publication. */
    missing_release_months: string[];
    coverage_issues: string[];
  };
};

export const BLS_ARCHIVE_URLS = {
  us_cpi: "https://www.bls.gov/bls/news-release/cpi.htm",
  us_nfp: "https://www.bls.gov/bls/news-release/empsit.htm",
} as const;

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const macroArchivePath = (configured = process.env.TRADINGVIEW_MCP_MACRO_EVENT_RAW_ARCHIVE_PATH) =>
  configured?.trim() || join(homedir(), ".tradingview-mcp", "official-macro-event-raw");

export type OfficialMacroFetch = (url: string, init?: RequestInit) => Promise<BoundedResponse & { ok: boolean; status: number }>;

function canonicalDate(value: string): string {
  const match = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  if (!match) throw new Error("official macro event source contains an invalid release date");
  const [, month, day, year] = match;
  const iso = `${year}-${month}-${day}`;
  if (new Date(`${iso}T12:00:00.000Z`).toISOString().slice(0, 10) !== iso) throw new Error("official macro event source contains an invalid calendar date");
  return iso;
}

function newYorkTimestamp(date: string, hour: number, minute: number): string {
  // Release times are ordinary daytime New York civil times, never at a DST transition.  Ask ICU for
  // the offset on that civil date instead of assuming a fixed EST/EDT offset.
  const probe = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(probe).find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zone ?? "");
  if (!match) throw new Error("America/New_York offset was unavailable");
  const offsetMinutes = (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "+" ? 1 : -1);
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour, minute) - offsetMinutes * 60_000).toISOString();
}

function sourceHash(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

/** Extracts release dates from BLS's official archive index; individual documents remain linked as provenance. */
export function parseBlsArchiveEvents(kind: "us_cpi" | "us_nfp", raw: string, sourceUrl: string, rawSha256 = sourceHash(raw)): OfficialMacroEvent[] {
  const prefix = kind === "us_cpi" ? "cpi" : "empsit";
  const seen = new Map<string, OfficialMacroEvent>();
  const pattern = new RegExp(`href=["']([^"']*${prefix}_(\\d{8})\\.(htm|pdf|txt))[^"']*["']`, "gi");
  for (const match of raw.matchAll(pattern)) {
    const date = canonicalDate(match[2]);
    const documentUrl = new URL(match[1], sourceUrl).toString();
    const event = { event_id: `${kind}:${date}`, event_kind: kind, occurred_at: newYorkTimestamp(date, 8, 30), source_url: documentUrl, raw_sha256: rawSha256 } as const;
    const prior = seen.get(event.event_id);
    // BLS currently exposes a PDF and HTML rendition for some releases. They share the archive's
    // release date and raw-index hash, so select the inspectable HTML deterministically rather than
    // mistaking two renditions for two economic events.
    if (!prior || (match[3].toLowerCase() === "htm" && !prior.source_url.endsWith(".htm"))) seen.set(event.event_id, event);
  }
  if (seen.size < 12) throw new Error(`official ${kind} archive did not expose a usable release history`);
  return [...seen.values()].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
}

/** Preserve a documented non-release as evidence of absence, rather than manufacturing an event time. */
export function parseBlsArchiveNonPublications(kind: "us_cpi" | "us_nfp", raw: string, sourceUrl: string, rawSha256 = sourceHash(raw)): OfficialMacroNonPublication[] {
  const title = kind === "us_cpi" ? "Consumer Price Index" : "Employment Situation";
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const text = raw.replace(/<[^>]*>/g, " ").replace(/&(nbsp|#160);/gi, " ").replace(/&(ndash|#8211);/gi, "-").replace(/\s+/g, " ");
  const output: OfficialMacroNonPublication[] = [];
  for (const match of text.matchAll(new RegExp(`(${monthNames.join("|")})\\s+(\\d{4})\\s+${title}\\s*[-–]\\s*Not published because of (?:the )?2025 lapse in federal government appropriations`, "gi"))) {
    const month = monthNames.findIndex((name) => name.toLowerCase() === match[1].toLowerCase()) + 1;
    output.push({ event_kind: kind, reference_month: `${match[2]}-${String(month).padStart(2, "0")}`, reason: "not_published_due_to_lapse_in_appropriations", source_url: sourceUrl, raw_sha256: rawSha256 });
  }
  return output;
}

/** FOMC historical pages link the same dated monetary statement in HTML and PDF form. */
export function parseFomcHistoricalPage(raw: string, sourceUrl: string, rawSha256 = sourceHash(raw)): OfficialMacroEvent[] {
  const seen = new Map<string, OfficialMacroEvent>();
  for (const match of raw.matchAll(/href=["']([^"']*monetary(\d{8})a\.htm)[^"']*["']/gi)) {
    const compact = match[2];
    const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
    if (new Date(`${date}T12:00:00.000Z`).toISOString().slice(0, 10) !== date) throw new Error("official FOMC history contains an invalid statement date");
    const event = { event_id: `fomc_statement:${date}`, event_kind: "fomc_statement" as const, occurred_at: newYorkTimestamp(date, 14, 0), source_url: new URL(match[1], sourceUrl).toString(), raw_sha256: rawSha256 };
    seen.set(event.event_id, event);
  }
  if (seen.size < 1) throw new Error("official FOMC historical page did not expose a statement");
  return [...seen.values()].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
}

export async function archiveOfficialMacroRaw(directory: string, sha256: string, raw: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("official macro raw archive directory is unsafe");
  const path = join(directory, `${sha256.slice(7)}.raw`);
  try {
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(raw, "utf8"); await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (sourceHash(existing) !== sha256) throw new Error("official macro raw archive existing payload hash does not match");
  }
}

async function fetchOfficialPage(url: string, fetcher: OfficialMacroFetch, allowNotFound = false): Promise<string | null> {
  const response = await fetcher(url, { redirect: "manual" });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`official macro event source returned HTTP ${response.status}`);
  assertExpectedResponseHost(response, url, "official macro event source");
  return readLimitedResponseText(response, MAX_SOURCE_BYTES, "official macro event source");
}

/** Exported so a stored artifact's coverage can be recomputed from its own events, without refetching. */
export function computeOfficialMacroEventCoverage(kind: OfficialMacroEventKind, fromYear: number, toYear: number, events: OfficialMacroEvent[], nonPublications: OfficialMacroNonPublication[], now: Date) {
  const eventsByYear: Record<string, number> = {};
  for (const event of events) { const year = event.occurred_at.slice(0, 4); eventsByYear[year] = (eventsByYear[year] ?? 0) + 1; }
  const currentYear = now.getUTCFullYear();
  const completeYears = Array.from({ length: toYear - fromYear + 1 }, (_, index) => fromYear + index).filter((year) => year < currentYear);
  const minimumEvents = kind === "fomc_statement" ? 8 : 12;
  // A non-publication names the month of the data, not of the release. Both series publish month M
  // in month M+1, so December data is a January release - counting the excused month as it stands
  // would credit the wrong year outright, and the wrong month every time.
  const excusedReleaseMonths = new Set(nonPublications.map((item) => {
    const year = Number(item.reference_month.slice(0, 4));
    const month = Number(item.reference_month.slice(5, 7));
    return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  }));
  const excusedByYear: Record<string, number> = {};
  for (const releaseMonth of excusedReleaseMonths) {
    const year = releaseMonth.slice(0, 4);
    excusedByYear[year] = (excusedByYear[year] ?? 0) + 1;
  }
  const shortYears = completeYears.filter((year) =>
    (eventsByYear[String(year)] ?? 0) + (excusedByYear[String(year)] ?? 0) < minimumEvents);
  const coverageIssues = shortYears
    .map((year) => `insufficient_official_event_coverage:${year}:${eventsByYear[String(year)] ?? 0}_plus_${excusedByYear[String(year)] ?? 0}_excused_of_at_least_${minimumEvents}`);
  // A count cannot see a gap that something else fills. CPI and the employment situation publish
  // once a month, so twelve releases spread over eleven months is a hole with a duplicate beside it,
  // which is what a reissue under a second date looks like. Years the count already refused are left
  // to that issue rather than enumerated a second time.
  //
  // Which release an excused month removes cannot be read off the reference month alone. The M+1
  // rule assumes a release is never delayed past a month boundary, and a lapse in appropriations is
  // the very thing that delays it, so the assumption fails exactly where it is being leaned on. The
  // 2025 lapse showed both outcomes from one excused reference month each: CPI published late but
  // still within October and lost its November release, while the employment situation slipped out
  // of October altogether and lost that one. An excusal therefore accounts for a gap at its own
  // reference month or the month after it, whichever is actually empty, and covers at most one.
  const excusals = nonPublications.map((item) => {
    const year = Number(item.reference_month.slice(0, 4));
    const month = Number(item.reference_month.slice(5, 7));
    const following = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
    return { months: new Set([item.reference_month, following]), spent: false };
  });
  const missingReleaseMonths: string[] = [];
  if (kind !== "fomc_statement") {
    for (const year of completeYears) for (let month = 1; month <= 12; month += 1) {
      const prefix = `${year}-${String(month).padStart(2, "0")}`;
      if (events.some((event) => event.occurred_at.startsWith(prefix))) continue;
      const excusal = excusals.find((candidate) => !candidate.spent && candidate.months.has(prefix));
      if (excusal !== undefined) { excusal.spent = true; continue; }
      missingReleaseMonths.push(prefix);
    }
  }
  const shortYearPrefixes = new Set(shortYears.map((year) => String(year)));
  coverageIssues.push(...missingReleaseMonths
    .filter((month) => !shortYearPrefixes.has(month.slice(0, 4)))
    .map((month) => `missing_official_monthly_release:${month}`));
  return { requested_from_year: fromYear, requested_to_year: toYear, events_by_year: eventsByYear, excused_non_publications_by_year: excusedByYear, missing_release_months: missingReleaseMonths, coverage_issues: coverageIssues };
}

export async function collectOfficialMacroEvents(input: { kind: OfficialMacroEventKind; fromYear: number; toYear: number; fetch?: OfficialMacroFetch; now?: Date; rawArchivePath?: string }): Promise<OfficialMacroEventArtifact> {
  if (!Number.isInteger(input.fromYear) || !Number.isInteger(input.toYear) || input.fromYear < 1994 || input.toYear > 2100 || input.fromYear > input.toYear) throw new Error("official macro event years are invalid");
  if (input.kind === "fomc_statement" && input.fromYear < 2013) throw new Error("FOMC statement release times before 2013 are not supported by the fixed 14:00 ET contract");
  const fetcher = input.fetch ?? ((url, init) => fetch(url, init) as Promise<BoundedResponse & { ok: boolean; status: number }>);
  const archivePath = input.rawArchivePath ?? macroArchivePath();
  const sourcePages: Array<{ url: string; events: OfficialMacroEvent[] }> = [];
  let nonPublications: OfficialMacroNonPublication[] = [];
  if (input.kind === "us_cpi" || input.kind === "us_nfp") {
    const url = BLS_ARCHIVE_URLS[input.kind]; const raw = await fetchOfficialPage(url, fetcher); if (raw === null) throw new Error("official BLS archive was unexpectedly absent"); const sha = sourceHash(raw); await archiveOfficialMacroRaw(archivePath, sha, raw);
    sourcePages.push({ url, events: parseBlsArchiveEvents(input.kind, raw, url, sha) });
    nonPublications = parseBlsArchiveNonPublications(input.kind, raw, url, sha);
  } else {
    // The Fed migrates years between the annual history pages and the rolling calendar.  Query both
    // sources where available and collapse the identical statement IDs after parsing.
    for (let year = input.fromYear; year <= input.toYear; year += 1) {
      const url = `https://www.federalreserve.gov/monetarypolicy/fomchistorical${year}.htm`;
      const raw = await fetchOfficialPage(url, fetcher, true); if (raw === null) continue; const sha = sourceHash(raw); await archiveOfficialMacroRaw(archivePath, sha, raw);
      sourcePages.push({ url, events: parseFomcHistoricalPage(raw, url, sha) });
    }
    const url = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
    const raw = await fetchOfficialPage(url, fetcher); if (raw === null) throw new Error("official FOMC calendar was unexpectedly absent"); const sha = sourceHash(raw); await archiveOfficialMacroRaw(archivePath, sha, raw);
    sourcePages.push({ url, events: parseFomcHistoricalPage(raw, url, sha) });
  }
  const start = `${input.fromYear}-01-01T00:00:00.000Z`; const end = `${input.toYear + 1}-01-01T00:00:00.000Z`;
  const deduplicated = new Map<string, OfficialMacroEvent>();
  for (const event of sourcePages.flatMap((page) => page.events).filter((event) => event.occurred_at >= start && event.occurred_at < end)) deduplicated.set(event.event_id, event);
  const collected = [...deduplicated.values()].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
  const retrievedAtIso = (input.now ?? new Date()).toISOString();
  const events = collected.filter((event) => event.occurred_at <= retrievedAtIso);
  const scheduledFutureReleases = collected.filter((event) => event.occurred_at > retrievedAtIso);
  if (events.length < 1) throw new Error("official macro event collection is empty");
  const retrievedAt = input.now ?? new Date(); const eventCoverage = computeOfficialMacroEventCoverage(input.kind, input.fromYear, input.toYear, events, nonPublications, retrievedAt);
  return { schema_version: "1.0", series: "official_us_macro_release_events", evidence_tier: "official_revised_history", retrieved_at: retrievedAt.toISOString(), event_kind: input.kind, events, non_publications: nonPublications, scheduled_future_releases: scheduledFutureReleases, source_count: sourcePages.length, coverage: eventCoverage };
}

export async function writeOfficialMacroEventArtifact(path: string, artifact: OfficialMacroEventArtifact): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
}
