import { z } from "zod";

/**
 * Client for TradingView's public scanner API (scanner.tradingview.com).
 * Unauthenticated, read-only. Used for quotes, technical ratings and screening.
 */

const scanResponseSchema = z.object({
  totalCount: z.number().optional(),
  data: z.array(z.object({ s: z.string(), d: z.array(z.unknown()) })),
});

const MARKET_PATTERN = /^[a-z]{2,24}$/;
const FIELD_PATTERN = /^[\w.|]{1,64}$/;
const TICKER_PATTERN = /^[\w!.:&-]{1,48}$/;

export const SCAN_OPERATIONS = [
  "greater",
  "less",
  "egreater",
  "eless",
  "equal",
  "nequal",
  "in_range",
  "not_in_range",
  "match",
  "nempty",
] as const;
export type ScanOperation = (typeof SCAN_OPERATIONS)[number];

export interface ScanFilter {
  field: string;
  operation: ScanOperation;
  value?: number | string | boolean | Array<number | string>;
}

export interface ScanRow {
  symbol: string;
  values: Record<string, unknown>;
}

export interface ScanResult {
  totalCount: number | null;
  returned: number;
  rows: ScanRow[];
}

/** Timeframes the scanner accepts as column suffixes (daily is the default, unsuffixed). */
export const MTF_TIMEFRAMES = ["1", "5", "15", "30", "60", "120", "240", "1D", "1W", "1M"] as const;
export type MtfTimeframe = (typeof MTF_TIMEFRAMES)[number];

export const DEFAULT_MTF_TIMEFRAMES: MtfTimeframe[] = ["15", "60", "240", "1D"];

export const DEFAULT_MTF_FIELDS = [
  "close",
  "RSI",
  "ADX",
  "ATR",
  "EMA20",
  "SMA50",
  "SMA200",
  "Recommend.All",
  "Recommend.MA",
  "Recommend.Other",
];

export interface MtfOverview {
  symbol: string;
  /** timeframe -> field -> value; "Recommend.All" is the technical rating in [-1, 1] */
  timeframes: Record<string, Record<string, unknown>>;
}

/** Max symbols per getMtfOverview call — columns are shared across symbols, so this only bounds the row count. */
export const MAX_MTF_SYMBOLS = 20;

export const DEFAULT_QUOTE_COLUMNS = [
  "description",
  "close",
  "change",
  "change_abs",
  "high",
  "low",
  "volume",
  "RSI",
  "Recommend.All",
];

function assertColumns(columns: string[]): void {
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > 50) {
    throw new Error("columns must be a non-empty array of at most 50 fields");
  }
  for (const c of columns) {
    if (typeof c !== "string" || !FIELD_PATTERN.test(c)) {
      throw new Error(`invalid column name: ${JSON.stringify(c)}`);
    }
  }
}

function assertFilterValue(value: ScanFilter["value"]): void {
  if (value === undefined) return;
  const ok = (v: unknown) =>
    (typeof v === "number" && Number.isFinite(v)) ||
    typeof v === "boolean" ||
    (typeof v === "string" && v.length <= 100);
  if (Array.isArray(value)) {
    if (value.length > 2 || !value.every(ok)) {
      throw new Error("filter value array must hold at most 2 numbers/strings");
    }
    return;
  }
  if (!ok(value)) throw new Error("filter value must be a number, boolean or short string");
}

export class Scanner {
  constructor(
    private readonly baseUrl: string = "https://scanner.tradingview.com",
    private readonly timeoutMs: number = 15_000,
  ) {}

  private async post(market: string, body: Record<string, unknown>): Promise<ScanResult> {
    if (!MARKET_PATTERN.test(market)) {
      throw new Error(`invalid market: ${JSON.stringify(market)} (e.g. "global", "america", "japan", "crypto", "forex")`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/${market}/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `scanner request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      throw new Error(`scanner returned HTTP ${res.status}: ${text}`);
    }
    const parsed = scanResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`unexpected scanner response shape: ${parsed.error.message.slice(0, 200)}`);
    }
    const columns = body.columns as string[];
    const rows = parsed.data.data.map((row) => {
      const values: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        values[col] = row.d[i] === undefined ? null : row.d[i];
      });
      return { symbol: row.s, values };
    });
    return {
      totalCount: parsed.data.totalCount ?? null,
      returned: rows.length,
      rows,
    };
  }

  /**
   * Quotes / technical data for specific symbols. "Recommend.All" is the
   * overall technical rating in [-1, 1] (sell → buy).
   */
  async getQuotes(tickers: string[], columns: string[] = DEFAULT_QUOTE_COLUMNS): Promise<ScanResult> {
    if (!Array.isArray(tickers) || tickers.length === 0 || tickers.length > 100) {
      throw new Error("tickers must be a non-empty array of at most 100 symbols");
    }
    for (const t of tickers) {
      if (typeof t !== "string" || !TICKER_PATTERN.test(t)) {
        throw new Error(`invalid ticker: ${JSON.stringify(t)} — use EXCHANGE:SYMBOL form`);
      }
    }
    assertColumns(columns);
    return this.post("global", { symbols: { tickers }, columns });
  }

  /**
   * Multi-timeframe snapshot for one or more symbols without touching any
   * chart: the same indicator fields across several timeframes in a single
   * call, using the scanner's "FIELD|TIMEFRAME" column suffixes. Columns are
   * shared across all symbols (one scanner request either way), so the 50
   * timeframe*field column cap applies per symbol, not to the batch as a whole.
   */
  async getMtfOverview(
    tickers: string[],
    timeframes: string[] = DEFAULT_MTF_TIMEFRAMES,
    fields: string[] = DEFAULT_MTF_FIELDS,
  ): Promise<MtfOverview[]> {
    if (!Array.isArray(tickers) || tickers.length === 0 || tickers.length > MAX_MTF_SYMBOLS) {
      throw new Error(`tickers must be a non-empty array of at most ${MAX_MTF_SYMBOLS} symbols`);
    }
    for (const t of tickers) {
      if (typeof t !== "string" || !TICKER_PATTERN.test(t)) {
        throw new Error(`invalid ticker: ${JSON.stringify(t)} — use EXCHANGE:SYMBOL form`);
      }
    }
    if (!Array.isArray(timeframes) || timeframes.length === 0) {
      throw new Error("timeframes must be a non-empty array");
    }
    for (const tf of timeframes) {
      if (!MTF_TIMEFRAMES.includes(tf as MtfTimeframe)) {
        throw new Error(
          `invalid timeframe: ${JSON.stringify(tf)} (allowed: ${MTF_TIMEFRAMES.join(", ")})`,
        );
      }
    }
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new Error("fields must be a non-empty array");
    }
    for (const f of fields) {
      if (typeof f !== "string" || !FIELD_PATTERN.test(f) || f.includes("|")) {
        throw new Error(`invalid field: ${JSON.stringify(f)} (timeframe suffixes are added automatically)`);
      }
    }
    if (timeframes.length * fields.length > 50) {
      throw new Error(
        `too many columns: ${timeframes.length} timeframes x ${fields.length} fields > 50 — reduce one of them`,
      );
    }

    // Daily values use the plain field name; other timeframes are suffixed.
    const columnOf = (field: string, tf: string) => (tf === "1D" ? field : `${field}|${tf}`);
    const columns = timeframes.flatMap((tf) => fields.map((f) => columnOf(f, tf)));
    const result = await this.post("global", { symbols: { tickers }, columns });

    const bySymbol = new Map(result.rows.map((r) => [r.symbol, r]));
    const missing = tickers.filter((t) => !bySymbol.has(t));
    if (missing.length > 0) {
      throw new Error(`no data for: ${missing.join(", ")} — are the tickers valid?`);
    }

    return tickers.map((t) => {
      const row = bySymbol.get(t)!;
      const out: MtfOverview = { symbol: row.symbol, timeframes: {} };
      for (const tf of timeframes) {
        const perTf: Record<string, unknown> = {};
        for (const f of fields) perTf[f] = row.values[columnOf(f, tf)] ?? null;
        out.timeframes[tf] = perTf;
      }
      return out;
    });
  }

  /** Screen a market with field filters, e.g. RSI < 30 sorted by volume. */
  async scanMarket(options: {
    market: string;
    filters?: ScanFilter[];
    columns?: string[];
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    limit?: number;
  }): Promise<ScanResult> {
    const {
      market,
      filters = [],
      columns = ["name", "description", "close", "change", "volume", "Recommend.All"],
      sortBy,
      sortOrder = "desc",
      limit = 20,
    } = options;
    assertColumns(columns);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("limit must be an integer between 1 and 100");
    }
    if (filters.length > 20) throw new Error("at most 20 filters are supported");
    const filter = filters.map((f) => {
      if (!FIELD_PATTERN.test(f.field)) {
        throw new Error(`invalid filter field: ${JSON.stringify(f.field)}`);
      }
      if (!SCAN_OPERATIONS.includes(f.operation)) {
        throw new Error(
          `invalid operation: ${JSON.stringify(f.operation)} (allowed: ${SCAN_OPERATIONS.join(", ")})`,
        );
      }
      assertFilterValue(f.value);
      return { left: f.field, operation: f.operation, right: f.value };
    });
    if (sortBy !== undefined && !FIELD_PATTERN.test(sortBy)) {
      throw new Error(`invalid sortBy field: ${JSON.stringify(sortBy)}`);
    }
    const body: Record<string, unknown> = { columns, range: [0, limit] };
    if (filter.length > 0) body.filter = filter;
    if (sortBy) body.sort = { sortBy, sortOrder: sortOrder === "asc" ? "asc" : "desc" };
    return this.post(market, body);
  }
}
