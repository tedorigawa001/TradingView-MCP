import { randomUUID } from "node:crypto";
import {
  DEFAULT_MTF_FIELDS,
  DEFAULT_MTF_TIMEFRAMES,
  MAX_MTF_SYMBOLS,
  type MtfTimeframe,
  type Scanner,
} from "./scanner.js";
import type { EconomicCalendar, ImportanceLevel } from "./calendar.js";
import { getInstrumentMetadata } from "./instrumentMetadata.js";

export type MarketSnapshotOptions = {
  symbols: string[];
  auxiliarySymbols?: string[];
  timeframes?: MtfTimeframe[];
  fields?: string[];
  quoteFields?: string[];
  requiredQuoteFields?: string[];
  includeEvents?: boolean;
  countries?: string[];
  minImportance?: ImportanceLevel;
};

export type SnapshotQualityIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  symbols?: string[];
};

type SnapshotSource<T> = {
  name: string;
  status: "ok" | "error";
  requested_at: string;
  received_at: string;
  latency_ms: number;
  timestamp_basis: "mcp_receipt_time" | "scheduled_event_time";
  value: T | null;
};

type NormalizedQuote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread_price: number | null;
  spread_pips: number | null;
  pip_size: number | null;
  tick_size: number | null;
  spread_status: "derived_from_bid_ask" | "bid_ask_incomplete" | "unavailable";
};

function addIssue(
  issues: SnapshotQualityIssue[],
  code: string,
  severity: SnapshotQualityIssue["severity"],
  message: string,
  symbols?: string[],
): void {
  issues.push({ code, severity, message, ...(symbols && symbols.length > 0 ? { symbols } : {}) });
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeQuote(row: { symbol: string; values: Record<string, unknown> }): NormalizedQuote {
  const metadata = getInstrumentMetadata(row.symbol);
  const bid = finiteNumber(row.values.bid);
  const ask = finiteNumber(row.values.ask);
  if (bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid) {
    return {
      symbol: row.symbol,
      bid,
      ask,
      mid: (bid + ask) / 2,
      spread_price: ask - bid,
      spread_pips: metadata.pip_size === null ? null : (ask - bid) / metadata.pip_size,
      pip_size: metadata.pip_size,
      tick_size: metadata.tick_size,
      spread_status: "derived_from_bid_ask",
    };
  }
  return {
    symbol: row.symbol,
    bid,
    ask,
    mid: null,
    spread_price: null,
    spread_pips: null,
    pip_size: metadata.pip_size,
    tick_size: metadata.tick_size,
    spread_status: bid !== null || ask !== null ? "bid_ask_incomplete" : "unavailable",
  };
}

function snapshotStatus(issues: SnapshotQualityIssue[]): "ok" | "partial" | "blocked" {
  if (issues.some((issue) => issue.severity === "error")) return "blocked";
  if (issues.length > 0) return "partial";
  return "ok";
}

async function captureSnapshotSource<T>(
  name: string,
  timestampBasis: SnapshotSource<T>["timestamp_basis"],
  load: () => Promise<T>,
): Promise<SnapshotSource<T>> {
  const requestedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const value = await load();
    return {
      name,
      status: "ok",
      requested_at: requestedAt,
      received_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      timestamp_basis: timestampBasis,
      value,
    };
  } catch {
    return {
      name,
      status: "error",
      requested_at: requestedAt,
      received_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      timestamp_basis: timestampBasis,
      value: null,
    };
  }
}

export async function buildMarketSnapshot(
  dependencies: {
    scanner: Pick<Scanner, "getQuotes" | "getMtfOverview">;
    calendar: Pick<EconomicCalendar, "getEvents">;
  },
  options: MarketSnapshotOptions,
) {
  const requestedAt = new Date().toISOString();
  const symbols = options.symbols;
  const auxiliarySymbols = options.auxiliarySymbols ?? [];
  const requiredQuoteFields = options.requiredQuoteFields ?? ["close"];
  if (new Set(symbols).size !== symbols.length || new Set(auxiliarySymbols).size !== auxiliarySymbols.length) {
    throw new Error("symbols and auxiliary_symbols must not contain duplicates");
  }
  if (auxiliarySymbols.some((symbol) => symbols.includes(symbol))) {
    throw new Error("a symbol cannot be both required and auxiliary");
  }
  if (new Set(options.timeframes ?? []).size !== (options.timeframes ?? []).length || new Set(options.fields ?? []).size !== (options.fields ?? []).length) {
    throw new Error("timeframes and fields must not contain duplicates");
  }
  if (new Set(requiredQuoteFields).size !== requiredQuoteFields.length) {
    throw new Error("required_quote_fields must not contain duplicates");
  }
  if (new Set(options.quoteFields ?? []).size !== (options.quoteFields ?? []).length) {
    throw new Error("quote_fields must not contain duplicates");
  }
  const effectiveTimeframes = options.timeframes ?? DEFAULT_MTF_TIMEFRAMES;
  const effectiveFields = options.fields ?? DEFAULT_MTF_FIELDS;
  if (effectiveTimeframes.length * effectiveFields.length > 50) {
    throw new Error(`too many MTF columns: ${effectiveTimeframes.length} timeframes x ${effectiveFields.length} fields > 50`);
  }
  const requestedSymbols = [...new Set([...symbols, ...auxiliarySymbols])];
  if (requestedSymbols.length > MAX_MTF_SYMBOLS) {
    throw new Error(`symbols plus auxiliary_symbols must contain at most ${MAX_MTF_SYMBOLS} unique symbols`);
  }

  const quoteColumns = [...new Set(["description", ...requiredQuoteFields, ...(options.quoteFields ?? [])])];
  const sources = await Promise.all([
    captureSnapshotSource("tradingview_scanner_quotes", "mcp_receipt_time", () =>
      dependencies.scanner.getQuotes(requestedSymbols, quoteColumns),
    ),
    captureSnapshotSource("tradingview_scanner_mtf", "mcp_receipt_time", () =>
      dependencies.scanner.getMtfOverview(requestedSymbols, effectiveTimeframes, effectiveFields),
    ),
    ...(options.includeEvents
      ? [
          captureSnapshotSource("tradingview_economic_calendar", "scheduled_event_time", () =>
            dependencies.calendar.getEvents({ countries: options.countries, minImportance: options.minImportance }),
          ),
        ]
      : []),
  ]);
  const [quotes, overview, events] = sources;
  const receivedAt = new Date().toISOString();
  const sourceReceiptTimes = sources.map((source) => Date.parse(source.received_at));
  const maxReceiptSkewMs = sourceReceiptTimes.length < 2
    ? 0
    : Math.max(...sourceReceiptTimes) - Math.min(...sourceReceiptTimes);
  const qualityIssues: SnapshotQualityIssue[] = [];

  addIssue(
    qualityIssues,
    "source_timestamp_unavailable",
    "warning",
    "TradingView scanner responses do not include a common source timestamp; received_at is the MCP receipt time, not market-data time.",
  );

  let quoteRows: Array<{ symbol: string; values: Record<string, unknown> }> = [];
  if (quotes.status === "ok" && quotes.value !== null) {
    const rawQuoteRows = quotes.value.rows;
    const rowCounts = new Map<string, number>();
    for (const row of rawQuoteRows) rowCounts.set(row.symbol, (rowCounts.get(row.symbol) ?? 0) + 1);
    const duplicateRequired = symbols.filter((symbol) => (rowCounts.get(symbol) ?? 0) > 1);
    if (duplicateRequired.length > 0) {
      addIssue(qualityIssues, "duplicate_required_quote", "error", "The quote source returned duplicate rows for a required symbol.", duplicateRequired);
    }
    const duplicateAuxiliary = auxiliarySymbols.filter((symbol) => (rowCounts.get(symbol) ?? 0) > 1);
    if (duplicateAuxiliary.length > 0) {
      addIssue(qualityIssues, "duplicate_auxiliary_quote", "warning", "The quote source returned duplicate rows for an auxiliary symbol.", duplicateAuxiliary);
    }
    const unexpectedSymbols = rawQuoteRows
      .map((row) => row.symbol)
      .filter((symbol, index, all) => !requestedSymbols.includes(symbol) && all.indexOf(symbol) === index);
    if (unexpectedSymbols.length > 0) {
      addIssue(qualityIssues, "unexpected_quote_symbol", "warning", "The quote source returned symbols that were not requested.", unexpectedSymbols);
    }
    const quotedBySymbol = new Map(rawQuoteRows.map((row) => [row.symbol, row]));
    quoteRows = requestedSymbols.flatMap((symbol) => {
      const row = quotedBySymbol.get(symbol);
      return row ? [row] : [];
    });
    const missingTargets = symbols.filter((symbol) => !quotedBySymbol.has(symbol));
    if (missingTargets.length > 0) {
      addIssue(qualityIssues, "required_symbol_missing", "error", "No quote data was returned for a required symbol.", missingTargets);
    }
    const missingAuxiliary = auxiliarySymbols.filter((symbol) => !quotedBySymbol.has(symbol));
    if (missingAuxiliary.length > 0) {
      addIssue(qualityIssues, "auxiliary_symbol_missing", "warning", "No quote data was returned for an auxiliary symbol.", missingAuxiliary);
    }
    const invalidFields = symbols.filter((symbol) => {
      const row = quotedBySymbol.get(symbol);
      return row !== undefined && requiredQuoteFields.some((field) => {
        const value = row.values[field];
        return !isPresent(value) || !Number.isFinite(value) || ((field === "bid" || field === "ask") && (value as number) <= 0);
      });
    });
    if (invalidFields.length > 0) {
      addIssue(
        qualityIssues,
        "required_quote_field_invalid",
        "error",
        `A required symbol is missing or has a non-numeric required quote field: ${requiredQuoteFields.join(", ")}.`,
        invalidFields,
      );
    }
    const invertedQuotes = symbols.filter((symbol) => {
      const values = quotedBySymbol.get(symbol)?.values;
      return values !== undefined && Number.isFinite(values.bid) && Number.isFinite(values.ask) && (values.ask as number) < (values.bid as number);
    });
    if (invertedQuotes.length > 0) {
      addIssue(qualityIssues, "bid_ask_inverted", "error", "A required symbol has ask below bid.", invertedQuotes);
    }
  } else {
    addIssue(qualityIssues, "quotes_unavailable", "error", "Quote retrieval failed; the snapshot cannot support analysis.");
  }

  const mtf = overview?.status === "ok" ? overview.value : null;
  if (overview?.status === "error") {
    addIssue(qualityIssues, "mtf_overview_unavailable", "warning", "Multi-timeframe overview retrieval failed.");
  }
  const economicEvents = events?.status === "ok" ? events.value : null;
  if (events?.status === "error") {
    addIssue(qualityIssues, "economic_events_unavailable", "warning", "Economic calendar retrieval failed.");
  }

  return {
    schema_version: "1.0",
    snapshot_id: randomUUID(),
    status: snapshotStatus(qualityIssues),
    data_use: {
      mode: "display_only_analysis_assist",
      automated_trading_decision: "not_permitted",
    },
    requested_at: requestedAt,
    received_at: receivedAt,
    request_started_at: requestedAt,
    request_completed_at: receivedAt,
    latency_ms: Date.parse(receivedAt) - Date.parse(requestedAt),
    max_source_skew_ms: null,
    max_receipt_skew_ms: maxReceiptSkewMs,
    sources: sources.map(({ value: _value, ...source }) => source),
    requested_symbols: requestedSymbols,
    required_symbols: symbols,
    auxiliary_symbols: auxiliarySymbols,
    returned_symbols: quoteRows.map((row) => row.symbol),
    required_quote_fields: requiredQuoteFields,
    quotes: quoteRows,
    normalized_quotes: quoteRows.map(normalizeQuote),
    mtf_overview: mtf,
    economic_events: economicEvents,
    quality_issues: qualityIssues,
  };
}
