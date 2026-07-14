import { z } from "zod";

const rowsSchema = z.array(z.record(z.string(), z.unknown()));
type CotSpec = {
  dataset: "tff" | "disaggregated";
  market: string;
  contractCode: string;
  targetDirectionMultiplier: 1 | -1;
  proxyScope: "direct_base_asset" | "base_currency_single_leg";
};
type CotRow = Record<string, unknown>;
export type CotPosition = { group: string; long: number | null; short: number | null; net: number | null };
export type CotObservation = {
  symbol: string;
  report_type: string;
  market: unknown;
  report_date: string | null;
  available_at: null;
  open_interest: number | null;
  positions: CotPosition[];
  target_direction_multiplier?: 1 | -1;
  proxy_scope?: CotSpec["proxyScope"];
};

const COT_HISTORY_OUTPUT_MAX = 52;
const COT_FETCH_LIMIT = 250;
const COT_PERCENTILE_MIN_REFERENCES = 150;

const GROUP_FIELDS: Record<CotSpec["dataset"], Array<{ group: string; long: string; short: string }>> = {
  tff: [
    { group: "dealer", long: "dealer_positions_long_all", short: "dealer_positions_short_all" },
    { group: "asset_mgr", long: "asset_mgr_positions_long", short: "asset_mgr_positions_short" },
    { group: "lev_money", long: "lev_money_positions_long", short: "lev_money_positions_short" },
    { group: "other_rept", long: "other_rept_positions_long", short: "other_rept_positions_short" },
  ],
  disaggregated: [
    { group: "prod_merc", long: "prod_merc_positions_long", short: "prod_merc_positions_short" },
    { group: "swap", long: "swap_positions_long_all", short: "swap__positions_short_all" },
    { group: "m_money", long: "m_money_positions_long_all", short: "m_money_positions_short_all" },
    { group: "other_rept", long: "other_rept_positions_long", short: "other_rept_positions_short" },
  ],
};

const SYMBOLS: Record<string, CotSpec> = {
  "OANDA:EURUSD": { dataset: "tff", market: "EURO FX", contractCode: "099741", targetDirectionMultiplier: 1, proxyScope: "direct_base_asset" },
  "OANDA:USDJPY": { dataset: "tff", market: "JAPANESE YEN", contractCode: "097741", targetDirectionMultiplier: -1, proxyScope: "direct_base_asset" },
  "OANDA:GBPJPY": { dataset: "tff", market: "BRITISH POUND", contractCode: "096742", targetDirectionMultiplier: 1, proxyScope: "base_currency_single_leg" },
  "OANDA:GBPAUD": { dataset: "tff", market: "BRITISH POUND", contractCode: "096742", targetDirectionMultiplier: 1, proxyScope: "base_currency_single_leg" },
  "OANDA:XAUUSD": { dataset: "disaggregated", market: "GOLD", contractCode: "088691", targetDirectionMultiplier: 1, proxyScope: "direct_base_asset" },
};

const n = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const netOpenInterestRatio = (net: number | null, openInterest: number | null): number | null =>
  net !== null && openInterest !== null && openInterest > 0 ? net / openInterest : null;

const reportDateMs = (value: string | null): number | null => {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? timestamp
    : null;
};

const subtractUtcYearsClamped = (timestamp: number, years: number): number => {
  const date = new Date(timestamp);
  const targetYear = date.getUTCFullYear() - years;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  return Date.UTC(targetYear, month, Math.min(date.getUTCDate(), lastDay));
};

export function computeCotPositioningFeatures(observations: CotObservation[]) {
  const latest = observations[0];
  const previous = observations[1];
  const latestMs = latest ? reportDateMs(latest.report_date) : null;
  const previousMs = previous ? reportDateMs(previous.report_date) : null;
  if (!latest || latestMs === null) {
    return {
      as_of: null,
      lookback: "3_calendar_years_excluding_current",
      observations_available: observations.length,
      point_in_time_status: "blocked",
      groups: [],
    };
  }
  const cutoffMs = subtractUtcYearsClamped(latestMs, 3);
  const reportGapDays = previousMs === null ? null : (latestMs - previousMs) / 86_400_000;
  const targetDirectionMultiplier = latest.target_direction_multiplier ?? 1;

  const groups = latest.positions.map((position) => {
    const currentRatio = netOpenInterestRatio(position.net, latest.open_interest);
    const currentTargetRatio = currentRatio === null ? null : currentRatio * targetDirectionMultiplier;
    const previousPosition = previous?.positions.find((candidate) => candidate.group === position.group);
    const previousRatio = previousPosition
      ? netOpenInterestRatio(previousPosition.net, previous.open_interest)
      : null;
    const previousTargetRatio = previousRatio === null ? null : previousRatio * targetDirectionMultiplier;
    const references = observations
      .slice(1)
      .map((observation) => {
        const dateMs = reportDateMs(observation.report_date);
        const candidate = observation.positions.find((item) => item.group === position.group);
        return {
          report_date: observation.report_date,
          dateMs,
          ratio: (() => {
            const ratio = netOpenInterestRatio(candidate?.net ?? null, observation.open_interest);
            return ratio === null ? null : ratio * (observation.target_direction_multiplier ?? targetDirectionMultiplier);
          })(),
        };
      })
      .filter(
        (item): item is { report_date: string; dateMs: number; ratio: number } =>
          item.report_date !== null &&
          item.dateMs !== null &&
          item.dateMs >= cutoffMs &&
          item.dateMs < latestMs &&
          item.ratio !== null,
      );
    const coversWindowStart = references.some((item) => item.dateMs <= cutoffMs + 14 * 86_400_000);
    let percentile3y: number | null = null;
    if (currentTargetRatio !== null && references.length >= COT_PERCENTILE_MIN_REFERENCES && coversWindowStart) {
      const less = references.filter((item) => item.ratio < currentTargetRatio).length;
      const equal = references.filter((item) => item.ratio === currentTargetRatio).length;
      percentile3y = ((less + equal / 2) / references.length) * 100;
    }
    return {
      group: position.group,
      net_open_interest_ratio: currentRatio,
      target_direction_multiplier: targetDirectionMultiplier,
      target_oriented_net_open_interest_ratio: currentTargetRatio,
      previous_report_date: previous?.report_date ?? null,
      report_gap_days: reportGapDays,
      net_change_from_previous_report:
        position.net !== null && previousPosition?.net != null ? position.net - previousPosition.net : null,
      net_oi_ratio_change_from_previous_report:
        currentRatio !== null && previousRatio !== null ? currentRatio - previousRatio : null,
      target_oriented_ratio_change_from_previous_report:
        currentTargetRatio !== null && previousTargetRatio !== null ? currentTargetRatio - previousTargetRatio : null,
      previous_report_status:
        previous === undefined ? "unavailable" : reportGapDays !== null && reportGapDays >= 6 && reportGapDays <= 8 ? "regular" : "irregular_gap",
      percentile_3y: percentile3y,
      percentile_basis: "target_oriented_net_open_interest_ratio",
      percentile_status:
        currentRatio === null
          ? "unavailable_current_ratio"
          : percentile3y === null
            ? "insufficient_history"
            : "available",
      reference_count: references.length,
      reference_start: references.at(-1)?.report_date ?? null,
      reference_end: references[0]?.report_date ?? null,
    };
  });
  return {
    as_of: latest.report_date,
    lookback: "3_calendar_years_excluding_current",
    observations_available: observations.length,
    point_in_time_status: "blocked",
    point_in_time_reason: "available_at is unavailable; historical backtests must not infer publication time from report_date",
    groups,
  };
}

export class CotClient {
  private lastRequestAt = 0;
  private readonly cache = new Map<string, { expiresAt: number; rows: CotRow[] }>();
  constructor(private readonly baseUrl = "https://publicreporting.cftc.gov", private readonly timeoutMs = 15_000) {}

  private async fetchRows(spec: CotSpec): Promise<{ rows: CotRow[]; cacheStatus: "hit" | "miss" }> {
    const datasetId = spec.dataset === "tff" ? "gpe5-46if" : "72hh-3qpy";
    const cacheKey = `cot:rows:v4:${datasetId}:contract=${spec.contractCode}:limit=${COT_FETCH_LIMIT}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { rows: cached.rows, cacheStatus: "hit" };

    const waitMs = Math.max(0, 250 - (Date.now() - this.lastRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastRequestAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL(`/resource/${datasetId}.json`, this.baseUrl);
      url.searchParams.set("$limit", String(COT_FETCH_LIMIT));
      url.searchParams.set("$where", `cftc_contract_market_code='${spec.contractCode}'`);
      url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
      let response: Response | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await fetch(url, { signal: controller.signal });
          if (response.status < 500 || attempt === 2) break;
        } catch (err) {
          lastError = err;
          if (attempt === 2) throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
      if (!response) throw lastError ?? new Error("CFTC request failed");
      if (!response.ok) throw new Error(`CFTC returned HTTP ${response.status}`);
      const parsed = rowsSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("unexpected CFTC response shape");
      this.cache.set(cacheKey, { rows: parsed.data, expiresAt: Date.now() + 15 * 60_000 });
      return { rows: parsed.data, cacheStatus: "miss" };
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeRow(symbol: string, spec: CotSpec, row: CotRow): CotObservation {
    const positions = GROUP_FIELDS[spec.dataset].map((fields) => {
      const long = n(row[fields.long]);
      const short = n(row[fields.short]);
      return { group: fields.group, long, short, net: long !== null && short !== null ? long - short : null };
    });
    return {
      symbol,
      report_type: spec.dataset === "tff" ? "TFF futures only" : "Disaggregated futures only",
      market: row.market_and_exchange_names ?? null,
      report_date: typeof row.report_date_as_yyyy_mm_dd === "string" ? row.report_date_as_yyyy_mm_dd : null,
      available_at: null,
      open_interest: n(row.open_interest_all),
      positions,
      target_direction_multiplier: spec.targetDirectionMultiplier,
      proxy_scope: spec.proxyScope,
    };
  }

  async getHistory(symbol: string, weeks: number) {
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > COT_HISTORY_OUTPUT_MAX) {
      throw new Error(`COT history weeks must be an integer from 1 to ${COT_HISTORY_OUTPUT_MAX}`);
    }
    const spec = SYMBOLS[symbol];
    if (!spec) throw new Error(`COT mapping is unavailable for ${JSON.stringify(symbol)}`);

    const { rows, cacheStatus } = await this.fetchRows(spec);
    const matching = rows
      .filter((row) => row.cftc_contract_market_code === spec.contractCode)
      .filter(
        (row) =>
          typeof row.report_date_as_yyyy_mm_dd === "string" &&
          reportDateMs(row.report_date_as_yyyy_mm_dd) !== null,
      )
      .sort(
        (a, b) =>
          reportDateMs(String(b.report_date_as_yyyy_mm_dd))! -
          reportDateMs(String(a.report_date_as_yyyy_mm_dd))!,
      );
    const seenDates = new Set<number>();
    for (const row of matching) {
      const reportDate = String(row.report_date_as_yyyy_mm_dd);
      const reportDateKey = reportDateMs(reportDate)!;
      if (seenDates.has(reportDateKey)) {
        throw new Error(`duplicate COT report date ${reportDate} for ${spec.market}`);
      }
      seenDates.add(reportDateKey);
    }
    if (matching.length < weeks) {
      throw new Error(`requested ${weeks} COT weeks for ${spec.market}, but only ${matching.length} are available`);
    }
    const observations = matching.map((row) => this.normalizeRow(symbol, spec, row));
    return {
      symbol,
      requested_weeks: weeks,
      observations: observations.slice(0, weeks),
      positioning_features: computeCotPositioningFeatures(observations),
      cache_status: cacheStatus,
    };
  }

  async getLatest(symbol: string) {
    const history = await this.getHistory(symbol, 1);
    return {
      ...history.observations[0],
      positioning_features: history.positioning_features,
      cache_status: history.cache_status,
    };
  }
}

export function cotFreshness(reportDate: string | null, now = new Date(), maxAgeDays = 10) {
  const reportTimestamp = reportDateMs(reportDate);
  if (reportTimestamp === null) return { status: "unavailable", age_days: null };
  const ageDays = (now.getTime() - reportTimestamp) / 86_400_000;
  if (ageDays < 0) return { status: "unavailable", age_days: ageDays };
  return { status: ageDays <= maxAgeDays ? "fresh" : "stale", age_days: ageDays };
}
