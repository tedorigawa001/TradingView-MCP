import { assertExpectedResponseHost, readLimitedResponseText, type BoundedResponse } from "./boundedResponse.js";
import { persistMacroSurpriseObservation, type MacroSurpriseEvidenceStore, type MacroSurpriseEventKind, type MacroSurpriseMetricId, type MacroSurpriseRawArchive } from "./macroSurpriseEvidence.js";
import type { OfficialMacroEvent } from "./officialMacroEventSources.js";

const API_ORIGIN = "https://api.tradingeconomics.com";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type TradingEconomicsMacroConsensusMapping = {
  event_kind: MacroSurpriseEventKind;
  calendar_id: string;
  metric_id: MacroSurpriseMetricId;
  unit: "percent" | "thousands";
};

export type TradingEconomicsMacroConsensusFetch = (url: string, init?: RequestInit) => Promise<BoundedResponse & { ok: boolean; status: number }>;

const metricForKind: Record<MacroSurpriseEventKind, MacroSurpriseMetricId> = {
  us_cpi: "us_cpi_all_items_yoy_percent",
  us_nfp: "us_nfp_total_nonfarm_change_thousands",
  fomc_statement: "fomc_target_rate_midpoint_percent",
};

const validCalendarId = (value: unknown): value is string => typeof value === "string" && /^\d{1,20}$/.test(value);

function canonicalProviderUtc(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 48) throw new Error("Trading Economics calendar timestamp is invalid");
  // Their calendar schema specifies UTC but examples omit Z.  Interpret only that exact form as
  // UTC; locale-shaped timestamps are intentionally not guessed.
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value) ? `${value}Z` : value;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Trading Economics calendar timestamp is invalid");
  return parsed.toISOString();
}

function parseForecast(value: unknown, unit: unknown, expected: "percent" | "thousands"): number {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Trading Economics calendar forecast is absent");
  const text = String(value).trim();
  const unitText = String(unit ?? "").trim().toLowerCase();
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%|k)?$/i.exec(text);
  if (!match) throw new Error("Trading Economics calendar forecast has an unsupported unit");
  if (expected === "percent" && !(unitText === "%" || unitText === "percent" || match[2] === "%")) throw new Error("Trading Economics calendar forecast unit did not match percent");
  if (expected === "thousands" && !(unitText === "k" || unitText === "thousand" || unitText === "thousands" || match[2]?.toLowerCase() === "k")) throw new Error("Trading Economics calendar forecast unit did not match thousands");
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1_000_000) throw new Error("Trading Economics calendar forecast is invalid");
  return parsed;
}

function configuredMapping(mappings: readonly TradingEconomicsMacroConsensusMapping[], kind: MacroSurpriseEventKind): TradingEconomicsMacroConsensusMapping {
  const mapping = mappings.filter((item) => item.event_kind === kind);
  if (mapping.length !== 1 || !validCalendarId(mapping[0]?.calendar_id) || mapping[0].metric_id !== metricForKind[kind]) throw new Error(`Trading Economics mapping for ${kind} is invalid or ambiguous`);
  return mapping[0];
}

export function validateTradingEconomicsMacroConsensusMappings(mappings: readonly TradingEconomicsMacroConsensusMapping[]): void {
  if (mappings.length !== 3) throw new Error("Trading Economics macro-consensus mapping must name exactly CPI, NFP, and FOMC");
  const ids = new Set<string>();
  for (const kind of ["us_cpi", "us_nfp", "fomc_statement"] as const) {
    const mapping = configuredMapping(mappings, kind);
    if (ids.has(mapping.calendar_id)) throw new Error("Trading Economics macro-consensus calendar IDs must be distinct");
    ids.add(mapping.calendar_id);
  }
}

type CalendarRow = { CalendarId?: unknown; Date?: unknown; Forecast?: unknown; Actual?: unknown; Unit?: unknown };

export function parseTradingEconomicsConsensusSnapshot(raw: string, event: OfficialMacroEvent, mapping: TradingEconomicsMacroConsensusMapping) {
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { throw new Error("Trading Economics calendar response was not JSON"); }
  if (!Array.isArray(rows) || rows.length > 100_000) throw new Error("Trading Economics calendar response shape is unsafe");
  const matches = rows.filter((value): value is CalendarRow => !!value && typeof value === "object" && !Array.isArray(value))
    // A wide country/day response can include unrelated rows. Their malformed timestamps must not
    // make the configured event ambiguous; only the explicitly configured CalendarID is parsed.
    .filter((row) => String(row.CalendarId ?? "") === mapping.calendar_id)
    .filter((row) => canonicalProviderUtc(row.Date) === event.occurred_at);
  if (matches.length > 1) throw new Error(`Trading Economics calendar returned duplicate rows for ${event.event_id}`);
  if (matches.length === 0) return { status: "missing" as const, reason: "calendar_id_or_release_time_not_present" as const };
  const row = matches[0];
  if (row.Actual !== null && row.Actual !== undefined && String(row.Actual).trim() !== "") return { status: "late" as const, reason: "actual_was_already_present" as const };
  return { status: "ready" as const, value: parseForecast(row.Forecast, row.Unit, mapping.unit) };
}

const canonicalSourceUrl = (date: string) => `${API_ORIGIN}/calendar/country/united%20states/${date}/${date}`;

export async function collectTradingEconomicsMacroConsensus(input: {
  apiKey: string;
  mappings: readonly TradingEconomicsMacroConsensusMapping[];
  events: readonly OfficialMacroEvent[];
  store: Pick<MacroSurpriseEvidenceStore, "observe">;
  archive: Pick<MacroSurpriseRawArchive, "store">;
  fetch?: TradingEconomicsMacroConsensusFetch;
  now?: Date;
}) {
  if (!input.apiKey.trim()) throw new Error("Trading Economics macro-consensus API key is not configured");
  validateTradingEconomicsMacroConsensusMappings(input.mappings);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Trading Economics macro-consensus collection time is invalid");
  const scheduled = input.events.filter((event) => event.occurred_at > now.toISOString());
  const fetcher = input.fetch ?? ((url, init) => fetch(url, init) as Promise<BoundedResponse & { ok: boolean; status: number }>);
  const result = { scheduled_events: scheduled.length, recorded: 0, unchanged: 0, revisions: 0, missing: [] as string[], late: [] as string[] };
  for (const date of [...new Set(scheduled.map((event) => event.occurred_at.slice(0, 10)))]) {
    const sourceUrl = canonicalSourceUrl(date);
    const requestUrl = new URL(sourceUrl); requestUrl.searchParams.set("c", input.apiKey);
    const response = await fetcher(requestUrl.toString(), { redirect: "manual" });
    if (!response.ok) throw new Error(`Trading Economics macro-consensus source returned HTTP ${response.status}`);
    assertExpectedResponseHost(response, sourceUrl, "Trading Economics macro-consensus source");
    const raw = await readLimitedResponseText(response, MAX_RESPONSE_BYTES, "Trading Economics macro-consensus source");
    for (const event of scheduled.filter((candidate) => candidate.occurred_at.startsWith(date))) {
      const mapping = configuredMapping(input.mappings, event.event_kind);
      const parsed = parseTradingEconomicsConsensusSnapshot(raw, event, mapping);
      if (parsed.status === "missing") { result.missing.push(event.event_id); continue; }
      if (parsed.status === "late") { result.late.push(event.event_id); continue; }
      const saved = await persistMacroSurpriseObservation({ archive: input.archive, store: input.store, raw, observation: {
        event_id: event.event_id, event_kind: event.event_kind, occurred_at: event.occurred_at, metric_id: mapping.metric_id,
        role: "consensus", value: parsed.value, source_id: "trading_economics_calendar", source_url: sourceUrl,
      } });
      if (saved.first_seen.recorded) result.recorded += 1;
      else if (saved.first_seen.unchanged) result.unchanged += 1;
      else if (saved.first_seen.revision) result.revisions += 1;
    }
  }
  return result;
}
