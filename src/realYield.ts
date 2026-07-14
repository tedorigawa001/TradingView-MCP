import { XMLParser } from "fast-xml-parser";
import type { RealYieldFirstSeenStore } from "./realYieldHistory.js";

const MAX_XML_BYTES = 2_000_000;
const CACHE_TTL_MS = 15 * 60_000;
const SERIES = "US_TREASURY_PAR_REAL_CMT_10Y";
const SOURCE_URL = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/";
const MIN_REAL_YIELD_PERCENT = -25;
const MAX_REAL_YIELD_PERCENT = 25;

type TreasuryObservation = {
  observationDate: string;
  value: number | null;
  valueStatus: "valid" | "missing" | "invalid" | "out_of_range";
};

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const nodeText = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    return typeof text === "string" || typeof text === "number" ? String(text) : null;
  }
  return null;
};

const calendarDateMs = (value: string): number | null => {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z?)?$/,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (match[4] !== undefined && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)) {
    return null;
  }
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? timestamp
    : null;
};

const weekdaysElapsed = (fromDate: string, now: Date): number | null => {
  const from = calendarDateMs(fromDate);
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (from === null || from > to) return null;
  let count = 0;
  for (let cursor = from + 86_400_000; cursor <= to; cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
};

const freshnessMetadata = (observationDate: string, now: Date) => {
  const freshnessWeekdays = weekdaysElapsed(observationDate, now);
  const qualityIssues: string[] = [];
  if (freshnessWeekdays === null) qualityIssues.push("future_observation_date");
  else if (freshnessWeekdays > 2) qualityIssues.push("stale_observation");
  return {
    freshnessWeekdays,
    freshnessStatus: freshnessWeekdays !== null && freshnessWeekdays <= 2 ? "fresh" as const : "stale" as const,
    qualityIssues,
  };
};

export function parseTreasuryRealYieldXml(xml: string): {
  observations: TreasuryObservation[];
  sourceUpdatedAtRaw: string | null;
} {
  let parsed: any;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(xml);
  } catch (err) {
    throw new Error(`invalid Treasury XML: ${err instanceof Error ? err.message : String(err)}`);
  }
  const feed = parsed?.feed;
  if (!feed || typeof feed !== "object") throw new Error("unexpected Treasury XML: feed is missing");
  const observations: TreasuryObservation[] = [];
  const seenDates = new Set<string>();
  for (const entry of asArray<any>(feed.entry)) {
    const properties = entry?.content?.properties;
    if (!properties || typeof properties !== "object") continue;
    const rawDate = nodeText(properties.NEW_DATE);
    const rawValue = nodeText(properties.TC_10YEAR);
    if (rawDate === null) continue;
    const timestamp = calendarDateMs(rawDate);
    if (timestamp === null) continue;
    const observationDate = new Date(timestamp).toISOString().slice(0, 10);
    if (seenDates.has(observationDate)) {
      throw new Error(`duplicate Treasury real-yield observation date ${observationDate}`);
    }
    seenDates.add(observationDate);
    const trimmedValue = rawValue?.trim() ?? "";
    const hasNumericSyntax = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmedValue);
    const parsedValue = hasNumericSyntax ? Number(trimmedValue) : null;
    const isValid = parsedValue !== null && Number.isFinite(parsedValue);
    const isInRange = isValid && parsedValue >= MIN_REAL_YIELD_PERCENT && parsedValue <= MAX_REAL_YIELD_PERCENT;
    observations.push({
      observationDate,
      value: isInRange ? parsedValue : null,
      valueStatus:
        rawValue === null || trimmedValue === ""
          ? "missing"
          : !isValid
            ? "invalid"
            : isInRange
              ? "valid"
              : "out_of_range",
    });
  }
  observations.sort((a, b) => calendarDateMs(b.observationDate)! - calendarDateMs(a.observationDate)!);
  return {
    observations,
    sourceUpdatedAtRaw: nodeText(feed.updated),
  };
}

export class TreasuryRealYieldClient {
  private cache: { expiresAt: number; value: Awaited<ReturnType<TreasuryRealYieldClient["loadLatest"]>> } | null = null;

  constructor(
    private readonly baseUrl = "https://home.treasury.gov",
    private readonly timeoutMs = 15_000,
    private readonly firstSeenStore?: Pick<RealYieldFirstSeenStore, "observeMany" | "getAsOf">,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async readLimitedXml(response: Response): Promise<string> {
    const rawContentLength = response.headers.get("content-length");
    if (rawContentLength !== null) {
      const contentLength = Number(rawContentLength);
      if (Number.isFinite(contentLength) && contentLength > MAX_XML_BYTES) {
        throw new Error("Treasury XML response is too large");
      }
    }
    if (!response.body) throw new Error("Treasury XML response has no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let byteLength = 0;
    let xml = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_XML_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Treasury XML response is too large");
      }
      xml += decoder.decode(value, { stream: true });
    }
    return xml + decoder.decode();
  }

  private async fetchYear(year: number): Promise<ReturnType<typeof parseTreasuryRealYieldXml>> {
    const url = new URL("/resource-center/data-chart-center/interest-rates/pages/xml", this.baseUrl);
    url.searchParams.set("data", "daily_treasury_real_yield_curve");
    url.searchParams.set("field_tdr_date_value", String(year));
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let shouldRetry = false;
      try {
        const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/xml" } });
        if (response.status >= 500) {
          lastError = new Error(`Treasury returned HTTP ${response.status}`);
          shouldRetry = attempt < 2;
          if (!shouldRetry) throw lastError;
        } else {
          if (!response.ok) throw new Error(`Treasury returned HTTP ${response.status}`);
          const xml = await this.readLimitedXml(response);
          return parseTreasuryRealYieldXml(xml);
        }
      } catch (err) {
        if (shouldRetry) {
          // The 5xx branch already classified this attempt as retryable.
        } else if ((controller.signal.aborted || err instanceof TypeError) && attempt < 2) {
          lastError = err;
          shouldRetry = true;
        } else {
          throw err;
        }
      } finally {
        clearTimeout(timer);
      }
      if (shouldRetry) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
    throw lastError ?? new Error("Treasury request failed");
  }

  private async loadLatest(now: Date) {
    const currentYear = now.getUTCFullYear();
    const current = await this.fetchYear(currentYear);
    const feeds = [{ year: currentYear, ...current }];
    let observations = current.observations;
    let sourceUpdatedAtRaw = current.sourceUpdatedAtRaw;
    let observedFeedYear = currentYear;
    let previousYearRevisionScanFailed = false;
    if (observations.length === 0) {
      const previous = await this.fetchYear(currentYear - 1);
      feeds.push({ year: currentYear - 1, ...previous });
      observations = previous.observations;
      sourceUpdatedAtRaw = previous.sourceUpdatedAtRaw;
      observedFeedYear = currentYear - 1;
    } else if (now.getUTCMonth() === 0) {
      try {
        const previous = await this.fetchYear(currentYear - 1);
        feeds.push({ year: currentYear - 1, ...previous });
      } catch {
        previousYearRevisionScanFailed = true;
      }
    }
    const receiptTime = this.clock();
    if (!Number.isFinite(receiptTime.getTime())) throw new Error("clock returned an invalid date");
    const receiptIso = receiptTime.toISOString();
    const latest = observations[0];
    if (!latest) throw new Error("Treasury real-yield feed contains no dated 10-year observations");
    const freshness = freshnessMetadata(latest.observationDate, now);
    const qualityIssues = ["publication_time_unavailable", ...freshness.qualityIssues];
    if (previousYearRevisionScanFailed) qualityIssues.push("previous_year_revision_scan_failed");
    if (latest.valueStatus !== "valid") qualityIssues.push(`latest_value_${latest.valueStatus}`);
    const isFuture = freshness.freshnessWeekdays === null;
    let firstSeenAt: string | null = null;
    let pointInTimeStatus: "blocked" | "observed_first_seen" = "blocked";
    let revisionStatus: "unknown" | "first_seen_tracked" = "unknown";
    const persistable = observations.filter((observation) =>
      observation.valueStatus === "valid" && weekdaysElapsed(observation.observationDate, receiptTime) !== null);
    if (this.firstSeenStore) {
      if (persistable.length > 0) {
        try {
          const records = await this.firstSeenStore.observeMany(persistable.map((observation) => ({
            series: SERIES,
            observation_date: observation.observationDate,
            value: observation.value!,
            observed_at: receiptIso,
            source_updated_at_raw: sourceUpdatedAtRaw,
            observed_feed_year: observedFeedYear,
          })));
          if (latest.valueStatus === "valid" && !isFuture) {
            const record = records.find((candidate) =>
              candidate.observation_date === latest.observationDate && candidate.value === latest.value);
            if (!record) throw new Error("latest real-yield version was not persisted");
            firstSeenAt = record.first_seen_at;
            pointInTimeStatus = "observed_first_seen";
            revisionStatus = "first_seen_tracked";
          }
        } catch {
          qualityIssues.push("first_seen_persistence_failed");
        }
      }
      for (const feed of feeds.filter((candidate) => candidate.year !== observedFeedYear)) {
        const auxiliary = feed.observations.filter((observation) =>
          observation.valueStatus === "valid" && weekdaysElapsed(observation.observationDate, receiptTime) !== null);
        if (auxiliary.length === 0) continue;
        try {
          await this.firstSeenStore.observeMany(auxiliary.map((observation) => ({
            series: SERIES,
            observation_date: observation.observationDate,
            value: observation.value!,
            observed_at: receiptIso,
            source_updated_at_raw: feed.sourceUpdatedAtRaw,
            observed_feed_year: feed.year,
          })));
        } catch {
          qualityIssues.push("first_seen_auxiliary_persistence_failed");
        }
      }
    } else if (latest.valueStatus === "valid" && !isFuture) {
      qualityIssues.push("first_seen_persistence_disabled");
    }
    return {
      schema_version: "1.1",
      status: latest.valueStatus === "valid" && !isFuture ? "partial" as const : "unavailable" as const,
      series: SERIES,
      observation_date: latest.observationDate,
      value: isFuture ? null : latest.value,
      value_status: isFuture ? "future_date" as const : latest.valueStatus,
      unit: "percent_per_annum_bond_equivalent",
      source: "us_treasury",
      source_url: SOURCE_URL,
      observed_at: receiptIso,
      source_at: null,
      available_at: firstSeenAt,
      available_at_basis: firstSeenAt === null ? "unavailable" : "local_first_seen",
      first_seen_at: firstSeenAt,
      source_updated_at_raw: sourceUpdatedAtRaw,
      latency_class: "end_of_day",
      revision_status: revisionStatus,
      freshness_weekdays: freshness.freshnessWeekdays,
      freshness_status: freshness.freshnessStatus,
      point_in_time_status: pointInTimeStatus,
      as_of: null,
      source_error: null,
      quality_issues: qualityIssues,
    };
  }

  async getLatest(now = new Date()) {
    if (!Number.isFinite(now.getTime())) throw new Error("now must be a valid date");
    if (this.cache && this.cache.expiresAt > Date.now()) {
      const freshness = freshnessMetadata(this.cache.value.observation_date, now);
      const qualityIssues = this.cache.value.quality_issues.filter(
        (issue) => issue !== "future_observation_date" && issue !== "stale_observation",
      );
      return {
        ...this.cache.value,
        freshness_weekdays: freshness.freshnessWeekdays,
        freshness_status: freshness.freshnessStatus,
        quality_issues: [...qualityIssues, ...freshness.qualityIssues],
        cache_status: "hit" as const,
      };
    }
    const value = await this.loadLatest(now);
    if (value.value_status !== "future_date" &&
        !value.quality_issues.some((issue) => issue === "first_seen_persistence_failed" ||
          issue === "first_seen_auxiliary_persistence_failed" || issue === "previous_year_revision_scan_failed")) {
      this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return { ...value, cache_status: "miss" as const };
  }

  async getAsOf(asOf: Date) {
    if (!Number.isFinite(asOf.getTime())) throw new Error("as_of must be a valid timestamp");
    const queriedAt = this.clock();
    if (!Number.isFinite(queriedAt.getTime())) throw new Error("clock returned an invalid date");
    if (asOf.getTime() > queriedAt.getTime()) throw new Error("as_of must not be in the future");
    const base = {
      schema_version: "1.1",
      series: SERIES,
      unit: "percent_per_annum_bond_equivalent",
      source: "us_treasury",
      source_url: SOURCE_URL,
      source_at: null,
      latency_class: "end_of_day",
      as_of: asOf.toISOString(),
      source_error: null,
      cache_status: "not_applicable" as const,
    };
    if (!this.firstSeenStore) {
      return {
        ...base,
        status: "unavailable" as const,
        observation_date: null,
        value: null,
        value_status: "unavailable" as const,
        observed_at: null,
        available_at: null,
        available_at_basis: "unavailable" as const,
        first_seen_at: null,
        history_sequence: null,
        source_updated_at_raw: null,
        revision_status: "unknown" as const,
        freshness_weekdays: null,
        freshness_status: "unavailable" as const,
        point_in_time_status: "blocked" as const,
        quality_issues: ["first_seen_persistence_disabled"],
      };
    }
    const record = await this.firstSeenStore.getAsOf(asOf);
    if (!record) {
      return {
        ...base,
        status: "unavailable" as const,
        observation_date: null,
        value: null,
        value_status: "unavailable" as const,
        observed_at: null,
        available_at: null,
        available_at_basis: "unavailable" as const,
        first_seen_at: null,
        history_sequence: null,
        source_updated_at_raw: null,
        revision_status: "first_seen_tracked" as const,
        freshness_weekdays: null,
        freshness_status: "unavailable" as const,
        point_in_time_status: "blocked" as const,
        quality_issues: ["no_first_seen_observation_as_of"],
      };
    }
    const freshness = freshnessMetadata(record.observation_date, asOf);
    return {
      ...base,
      status: "partial" as const,
      observation_date: record.observation_date,
      value: record.value,
      value_status: "valid" as const,
      observed_at: record.first_seen_at,
      available_at: record.first_seen_at,
      available_at_basis: "local_first_seen" as const,
      first_seen_at: record.first_seen_at,
      history_sequence: record.sequence,
      source_updated_at_raw: record.source_updated_at_raw,
      revision_status: "first_seen_tracked" as const,
      freshness_weekdays: freshness.freshnessWeekdays,
      freshness_status: freshness.freshnessStatus,
      point_in_time_status: "observed_first_seen" as const,
      quality_issues: ["publication_time_unavailable", ...freshness.qualityIssues],
    };
  }
}
