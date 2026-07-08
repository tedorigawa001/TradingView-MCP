import { z } from "zod";

/**
 * Client for TradingView's public economic calendar API
 * (economic-calendar.tradingview.com). Unauthenticated, read-only GET; the
 * endpoint only requires a tradingview.com Origin header. No cookies or
 * session data are ever sent.
 */

const responseSchema = z.object({
  status: z.string().optional(),
  result: z.array(z.record(z.string(), z.unknown())),
});

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

export const DEFAULT_COUNTRIES = ["US", "EU", "JP", "GB"];

export const IMPORTANCE_LEVELS = ["low", "medium", "high"] as const;
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

// The API encodes importance as -1 (low), 0 (medium), 1 (high).
const IMPORTANCE_VALUE: Record<ImportanceLevel, number> = { low: -1, medium: 0, high: 1 };
const importanceName = (n: number): ImportanceLevel =>
  n >= 1 ? "high" : n >= 0 ? "medium" : "low";

const MAX_RANGE_MS = 92 * 86_400_000;

export interface EconomicEvent {
  id: string | null;
  /** Scheduled release time, ISO 8601 UTC. */
  date: string;
  country: string;
  currency: string | null;
  title: string;
  indicator: string | null;
  importance: ImportanceLevel;
  period: string | null;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  unit: string | null;
}

export interface EconomicEventsResult {
  from: string;
  to: string;
  countries: string[];
  minImportance: ImportanceLevel;
  /** Events in the range/countries before the importance filter. */
  totalInRange: number;
  returned: number;
  /** Sorted by date, earliest first. */
  events: EconomicEvent[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function toEvent(raw: Record<string, unknown>): (EconomicEvent & { importanceValue: number }) | null {
  const date = str(raw.date);
  const title = str(raw.title) ?? str(raw.indicator);
  if (!date || !title) return null;
  const importanceValue = typeof raw.importance === "number" ? raw.importance : -1;
  return {
    id: raw.id === undefined || raw.id === null ? null : String(raw.id),
    date,
    country: str(raw.country) ?? "",
    currency: str(raw.currency),
    title,
    indicator: str(raw.indicator),
    importance: importanceName(importanceValue),
    importanceValue,
    period: str(raw.period),
    actual: num(raw.actual),
    forecast: num(raw.forecast),
    previous: num(raw.previous),
    unit: str(raw.unit),
  };
}

function parseWhen(label: string, value: string | undefined, defaultMs: number): number {
  if (value === undefined) return defaultMs;
  const t = Date.parse(value);
  if (Number.isNaN(t)) {
    throw new Error(`${label} must be an ISO 8601 date/time, got ${JSON.stringify(value)}`);
  }
  return t;
}

export class EconomicCalendar {
  constructor(
    private readonly baseUrl: string = "https://economic-calendar.tradingview.com",
    private readonly timeoutMs: number = 15_000,
  ) {}

  /**
   * Upcoming (or past) economic calendar events, filtered by country,
   * importance and time range. Defaults: the next 7 days, medium+ importance,
   * major countries (US, EU, JP, GB).
   */
  async getEvents(
    options: {
      countries?: string[];
      from?: string;
      to?: string;
      minImportance?: ImportanceLevel;
      limit?: number;
    } = {},
  ): Promise<EconomicEventsResult> {
    const { countries = DEFAULT_COUNTRIES, minImportance = "medium", limit = 50 } = options;
    if (!Array.isArray(countries) || countries.length === 0 || countries.length > 30) {
      throw new Error("countries must be a non-empty array of at most 30 ISO codes");
    }
    const upper = countries.map((c) => {
      const u = typeof c === "string" ? c.toUpperCase() : "";
      if (!COUNTRY_PATTERN.test(u)) {
        throw new Error(`invalid country code: ${JSON.stringify(c)} — use 2-letter codes like "US", "JP", "EU"`);
      }
      return u;
    });
    if (!IMPORTANCE_LEVELS.includes(minImportance)) {
      throw new Error(
        `invalid minImportance: ${JSON.stringify(minImportance)} (allowed: ${IMPORTANCE_LEVELS.join(", ")})`,
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error(`limit must be an integer between 1 and 200, got ${limit}`);
    }
    const now = Date.now();
    const fromMs = parseWhen("from", options.from, now);
    const toMs = parseWhen("to", options.to, fromMs + 7 * 86_400_000);
    if (toMs <= fromMs) throw new Error("to must be after from");
    if (toMs - fromMs > MAX_RANGE_MS) throw new Error("date range must be 92 days or less");

    const from = new Date(fromMs).toISOString();
    const to = new Date(toMs).toISOString();
    const params = new URLSearchParams({ from, to, countries: upper.join(",") });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/events?${params}`, {
        headers: { origin: "https://www.tradingview.com" },
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `calendar request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new Error(`calendar returned HTTP ${res.status}: ${text}`);
    }
    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`unexpected calendar response shape: ${parsed.error.message.slice(0, 200)}`);
    }

    const minValue = IMPORTANCE_VALUE[minImportance];
    const all = parsed.data.result
      .map(toEvent)
      .filter((e): e is NonNullable<typeof e> => e !== null);
    const events = all
      .filter((e) => e.importanceValue >= minValue)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .slice(0, limit)
      .map(({ importanceValue: _ignored, ...event }) => event);

    return {
      from,
      to,
      countries: upper,
      minImportance,
      totalInRange: all.length,
      returned: events.length,
      events,
    };
  }
}
