import { assertExpectedResponseHost, readLimitedResponseText, type BoundedResponse } from "./boundedResponse.js";
import { assertOfficialMacroActualSource, persistMacroSurpriseObservation, type MacroSurpriseEvidenceStore, type MacroSurpriseRawArchive } from "./macroSurpriseEvidence.js";
import type { OfficialMacroEvent } from "./officialMacroEventSources.js";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const CAPTURE_WINDOW_MS = 15 * 60_000;

export type OfficialMacroActualFetch = (url: string, init?: RequestInit) => Promise<BoundedResponse & { ok: boolean; status: number }>;

const readableText = (raw: string) => raw
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(nbsp|#160);/gi, " ")
  .replace(/&(?:ndash|#8211);/gi, "-")
  .replace(/\s+/g, " ");

function parseUnsignedNumber(value: string, label: string): number {
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) throw new Error(`official ${label} actual is invalid`);
  return parsed;
}

/** CPI-U all-items, twelve-month change, not the monthly or core figure. */
export function parseOfficialCpiAllItemsYoyActual(raw: string): number {
  const text = readableText(raw);
  const leading = /(?:over|for) the (?:last )?12 months,? the all items index (?:increased|rose)\s+([0-9]+(?:\.[0-9]+)?)\s+percent/i.exec(text);
  const trailing = /all items index (?:increased|rose)\s+([0-9]+(?:\.[0-9]+)?)\s+percent\s+(?:for|over) the (?:last )?12 months/i.exec(text);
  const match = leading ?? trailing;
  if (!match) throw new Error("official CPI release did not contain the fixed all-items year-over-year actual");
  return parseUnsignedNumber(match[1], "CPI");
}

/** Establishment-survey headline payroll change.  Only an explicit "unchanged" is zero. */
export function parseOfficialNfpTotalNonfarmChangeActual(raw: string): number {
  const text = readableText(raw);
  const match = /Total nonfarm payroll employment\s+(increased|rose|edged up|decreased|declined|edged down)\s+by\s+([0-9][0-9,]*)/i.exec(text);
  if (match) {
    const magnitude = parseUnsignedNumber(match[2], "NFP");
    // The contract fixes NFP to thousands, matching the consensus provider's K unit.  BLS prose
    // spells the headline in persons (e.g. 172,000), so convert at this source boundary.
    return ( /decreased|declined|edged down/i.test(match[1]) ? -magnitude : magnitude ) / 1_000;
  }
  if (/Total nonfarm payroll employment\s+was unchanged/i.test(text)) return 0;
  throw new Error("official NFP release did not contain the fixed total nonfarm payroll actual");
}

function parseRateEndpoint(value: string): number {
  const normalized = value.replace(/\s+/g, "");
  const mixed = /^(\d+)-(\d+)\/(\d+)$/.exec(normalized);
  const fraction = /^(\d+)\/(\d+)$/.exec(normalized);
  const integer = /^\d+(?:\.\d+)?$/.exec(normalized);
  let parsed: number;
  if (mixed) parsed = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  else if (fraction) parsed = Number(fraction[1]) / Number(fraction[2]);
  else if (integer) parsed = Number(normalized);
  else throw new Error("official FOMC target range endpoint is invalid");
  if (!Number.isFinite(parsed) || parsed < -5 || parsed > 30) throw new Error("official FOMC target range endpoint is invalid");
  return parsed;
}

/** FOMC's fixed signal is the midpoint of its stated target range, never a text sentiment score. */
export function parseOfficialFomcTargetRateMidpointActual(raw: string): number {
  const text = readableText(raw);
  const match = /target range for the federal funds rate at\s+([0-9][0-9\-/\s.]*)\s+to\s+([0-9][0-9\-/\s.]*)\s+percent/i.exec(text);
  if (!match) throw new Error("official FOMC statement did not contain a target range");
  const lower = parseRateEndpoint(match[1]); const upper = parseRateEndpoint(match[2]);
  if (lower > upper) throw new Error("official FOMC target range was inverted");
  return (lower + upper) / 2;
}

export function parseOfficialMacroActual(event: OfficialMacroEvent, raw: string): { metric_id: "us_cpi_all_items_yoy_percent" | "us_nfp_total_nonfarm_change_thousands" | "fomc_target_rate_midpoint_percent"; value: number; source_id: "bls_official" | "federal_reserve_official" } {
  if (event.event_kind === "us_cpi") return { metric_id: "us_cpi_all_items_yoy_percent", value: parseOfficialCpiAllItemsYoyActual(raw), source_id: "bls_official" };
  if (event.event_kind === "us_nfp") return { metric_id: "us_nfp_total_nonfarm_change_thousands", value: parseOfficialNfpTotalNonfarmChangeActual(raw), source_id: "bls_official" };
  return { metric_id: "fomc_target_rate_midpoint_percent", value: parseOfficialFomcTargetRateMidpointActual(raw), source_id: "federal_reserve_official" };
}

export async function collectOfficialMacroActuals(input: {
  events: readonly OfficialMacroEvent[];
  store: Pick<MacroSurpriseEvidenceStore, "observe">;
  archive: Pick<MacroSurpriseRawArchive, "store">;
  fetch?: OfficialMacroActualFetch;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("official macro actual collection time is invalid");
  const eligible = input.events.filter((event) => {
    const release = Date.parse(event.occurred_at);
    return release <= now.getTime() && now.getTime() <= release + CAPTURE_WINDOW_MS;
  });
  const fetcher = input.fetch ?? ((url, init) => fetch(url, init) as Promise<BoundedResponse & { ok: boolean; status: number }>);
  const result = { eligible_events: eligible.length, recorded: 0, unchanged: 0, revisions: 0 };
  for (const event of eligible) {
    assertOfficialMacroActualSource({ ...event, source_id: event.event_kind === "fomc_statement" ? "federal_reserve_official" : "bls_official" });
    const response = await fetcher(event.source_url, { redirect: "manual" });
    if (!response.ok) throw new Error(`official macro actual source returned HTTP ${response.status}`);
    assertExpectedResponseHost(response, event.source_url, "official macro actual source");
    const raw = await readLimitedResponseText(response, MAX_SOURCE_BYTES, "official macro actual source");
    const parsed = parseOfficialMacroActual(event, raw);
    const saved = await persistMacroSurpriseObservation({ archive: input.archive, store: input.store, raw, observation: {
      event_id: event.event_id, event_kind: event.event_kind, occurred_at: event.occurred_at, metric_id: parsed.metric_id,
      role: "actual", value: parsed.value, source_id: parsed.source_id, source_url: event.source_url,
    } });
    if (saved.first_seen.recorded) result.recorded += 1;
    else if (saved.first_seen.unchanged) result.unchanged += 1;
    else if (saved.first_seen.revision) result.revisions += 1;
  }
  return result;
}
