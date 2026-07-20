import { randomUUID } from "node:crypto";
import type { ScanResult, Scanner } from "./scanner.js";
import { getInstrumentMetadata } from "./instrumentMetadata.js";
import type { ExecutionQuote, TradingView } from "./tradingview.js";

const EXECUTION_COLUMNS = [
  "bid",
  "ask",
  "update_mode",
  "pricescale",
  "minmov",
  "minmove2",
  "fractional",
  "type",
  "subtype",
  "market",
  "currency",
  "exchange",
  "timezone",
];

export type ExecutionSnapshotOptions = {
  symbols: string[];
  waitForUpdateMs: number;
  sampleIntervalMs: number;
  maxQuoteAgeMs: number;
  snapshotId?: string;
};

type ExecutionIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
};

type QuoteObservation = {
  values: Record<string, unknown>;
  receivedAt: string;
};

type ObservationState = {
  initial: QuoteObservation;
  latest: QuoteObservation;
  updateObservedAt: string | null;
  samples: number;
};

type Runtime = {
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validPair(values: Record<string, unknown>): { bid: number; ask: number } | null {
  const bid = finiteNumber(values.bid);
  const ask = finiteNumber(values.ask);
  return bid !== null && ask !== null && bid > 0 && ask >= bid ? { bid, ask } : null;
}

function pairChanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const first = validPair(before);
  const second = validPair(after);
  return first !== null && second !== null && (first.bid !== second.bid || first.ask !== second.ask);
}

function rowsBySymbol(result: ScanResult, requested: string[]): Map<string, Record<string, unknown>> {
  const counts = new Map<string, number>();
  for (const row of result.rows) counts.set(row.symbol, (counts.get(row.symbol) ?? 0) + 1);
  const duplicate = requested.find((symbol) => (counts.get(symbol) ?? 0) > 1);
  if (duplicate) throw new Error(`execution quote source returned duplicate rows for ${duplicate}`);
  return new Map(result.rows.map((row) => [row.symbol, row.values]));
}

function dataMode(raw: string | null) {
  if (raw === "streaming") return { status: "streaming" as const, delay_seconds: 0 };
  const delayed = raw?.match(/^delayed_streaming(?:_(\d+))?$/);
  if (delayed) {
    return {
      status: "delayed" as const,
      delay_seconds: delayed[1] === undefined ? null : Number(delayed[1]),
    };
  }
  if (raw === "endofday" || raw === "eod") {
    return { status: "end_of_day" as const, delay_seconds: null };
  }
  return { status: "unknown" as const, delay_seconds: null };
}

function normalizedQuote(symbol: string, state: ObservationState, completedAt: string, maxQuoteAgeMs: number) {
  const values = state.latest.values;
  const bid = finiteNumber(values.bid);
  const ask = finiteNumber(values.ask);
  const pair = validPair(values);
  const issues: ExecutionIssue[] = [];
  const rawUpdateMode = textValue(values.update_mode);
  const mode = dataMode(rawUpdateMode);
  const livenessObserved = state.updateObservedAt !== null;
  const ageMs = state.updateObservedAt === null
    ? null
    : Math.max(0, Date.parse(completedAt) - Date.parse(state.updateObservedAt));
  const fresh = ageMs !== null && ageMs <= maxQuoteAgeMs;

  if (bid !== null && ask !== null && ask < bid) {
    issues.push({ code: "bid_ask_inverted", severity: "error", message: "Ask is below bid." });
  } else if (pair === null) {
    issues.push({ code: "bid_ask_unavailable", severity: "warning", message: "A valid positive bid/ask pair is unavailable." });
  }
  if (mode.status === "delayed" || mode.status === "end_of_day") {
    issues.push({ code: "non_realtime_data_mode", severity: "warning", message: "The quote source reports delayed or end-of-day data." });
  } else if (mode.status === "unknown") {
    issues.push({ code: "data_mode_unknown", severity: "warning", message: "The quote source data mode is unavailable or unsupported." });
  }
  if (pair !== null && !livenessObserved) {
    issues.push({
      code: "live_update_not_observed",
      severity: "warning",
      message: "Bid/ask did not change after the request, so live market activity and quote freshness remain unverified.",
    });
  } else if (livenessObserved && !fresh) {
    issues.push({ code: "observed_update_stale", severity: "warning", message: "The locally observed quote update is older than max_quote_age_ms." });
  }

  const metadata = getInstrumentMetadata(symbol);
  const pricescale = finiteNumber(values.pricescale);
  const minmov = finiteNumber(values.minmov);
  const scannerTickSize = pricescale !== null && pricescale > 0 && minmov !== null && minmov > 0
    ? minmov / pricescale
    : null;
  const ready = pair !== null
    && mode.status === "streaming"
    && livenessObserved
    && fresh
    && !issues.some((issue) => issue.severity === "error");
  const blocked = issues.some((issue) => issue.severity === "error");

  return {
    symbol,
    source: "tradingview_scanner" as const,
    status: blocked ? "blocked" as const : ready ? "ready" as const : pair === null ? "unavailable" as const : "wait" as const,
    bid,
    ask,
    mid: pair === null ? null : (pair.bid + pair.ask) / 2,
    spread_price: pair === null ? null : pair.ask - pair.bid,
    spread_pips: pair === null || metadata.pip_size === null ? null : (pair.ask - pair.bid) / metadata.pip_size,
    pip_size: metadata.pip_size,
    tick_size: scannerTickSize ?? metadata.tick_size,
    tick_size_basis: scannerTickSize === null ? "instrument_metadata" : "tradingview_scanner_pricescale",
    observed_at: state.latest.receivedAt,
    source_at: null,
    freshness: {
      status: ready ? "verified_live_update" as const : pair === null ? "unavailable" as const : "unverified" as const,
      basis: livenessObserved ? "post_request_bid_ask_change" as const : "mcp_receipt_time_only" as const,
      observed_update_at: state.updateObservedAt,
      age_ms: ageMs,
      max_age_ms: maxQuoteAgeMs,
    },
    liveness: {
      status: livenessObserved ? "update_observed" as const : "not_observed" as const,
      samples: state.samples,
      initial_observed_at: state.initial.receivedAt,
      latest_observed_at: state.latest.receivedAt,
    },
    data_mode: {
      ...mode,
      raw: rawUpdateMode,
    },
    market_state: livenessObserved && mode.status === "streaming" ? "active" as const : "unknown" as const,
    instrument: {
      type: textValue(values.type),
      subtype: textValue(values.subtype),
      market: textValue(values.market),
      currency: textValue(values.currency),
      exchange: textValue(values.exchange),
      timezone: textValue(values.timezone),
      pricescale,
      minmov,
      minmove2: finiteNumber(values.minmove2),
      fractional: values.fractional ?? null,
    },
    issues,
  };
}

function normalizedChartQuote(quote: ExecutionQuote, observedAt: string, completedAt: string, maxQuoteAgeMs: number) {
  const values = { bid: quote.bid, ask: quote.ask };
  const pair = validPair(values);
  const issues: ExecutionIssue[] = [];
  const mode = dataMode(quote.updateMode);
  const sourceMs = quote.lpTime === null ? null : quote.lpTime * (quote.lpTime > 1_000_000_000_000 ? 1 : 1_000);
  const sourceDate = sourceMs === null || !Number.isFinite(sourceMs) ? null : new Date(sourceMs);
  const sourceAt = sourceDate !== null && Number.isFinite(sourceDate.getTime()) ? sourceDate.toISOString() : null;
  const ageMs = sourceMs === null ? null : Date.parse(completedAt) - sourceMs;
  const fresh = ageMs !== null && ageMs >= -5_000 && ageMs <= maxQuoteAgeMs;
  const realtimeLoaded = quote.hubRealtimeLoaded === true && quote.tradeLoaded !== false;
  const activeSession = quote.currentSession === "market";

  if (quote.bid !== null && quote.ask !== null && quote.ask < quote.bid) {
    issues.push({ code: "bid_ask_inverted", severity: "error", message: "Ask is below bid." });
  } else if (pair === null) {
    issues.push({ code: "bid_ask_unavailable", severity: "warning", message: "A valid positive bid/ask pair is unavailable." });
  }
  if (sourceAt === null) {
    issues.push({ code: "quote_timestamp_unavailable", severity: "warning", message: "The chart quote snapshot has no lp_time." });
  } else if (!fresh) {
    issues.push({ code: "quote_timestamp_stale", severity: "warning", message: "The chart quote lp_time is outside max_quote_age_ms." });
  }
  if (mode.status !== "streaming") {
    issues.push({ code: "non_realtime_data_mode", severity: "warning", message: "The chart quote does not report streaming data." });
  }
  if (!activeSession) {
    issues.push({ code: "market_session_inactive", severity: "warning", message: "The chart quote does not report the regular market session as active." });
  }
  if (!realtimeLoaded) {
    issues.push({ code: "realtime_feed_not_loaded", severity: "warning", message: "The chart has not confirmed that its realtime quote feed is loaded." });
  }

  const scannerTickSize = quote.pricescale !== null && quote.pricescale > 0 && quote.minmov !== null && quote.minmov > 0
    ? quote.minmov / quote.pricescale
    : null;
  const metadata = getInstrumentMetadata(quote.symbol);
  const ready = pair !== null
    && fresh
    && mode.status === "streaming"
    && activeSession
    && realtimeLoaded
    && !issues.some((issue) => issue.severity === "error");
  const blocked = issues.some((issue) => issue.severity === "error");

  return {
    symbol: quote.symbol,
    source: "tradingview_chart_quotes" as const,
    chart_index: quote.chartIndex,
    status: blocked ? "blocked" as const : ready ? "ready" as const : pair === null ? "unavailable" as const : "wait" as const,
    bid: quote.bid,
    ask: quote.ask,
    mid: pair === null ? null : (pair.bid + pair.ask) / 2,
    spread_price: pair === null ? null : pair.ask - pair.bid,
    spread_pips: pair === null || metadata.pip_size === null ? null : (pair.ask - pair.bid) / metadata.pip_size,
    pip_size: metadata.pip_size,
    tick_size: scannerTickSize ?? metadata.tick_size,
    tick_size_basis: scannerTickSize === null ? "instrument_metadata" as const : "tradingview_chart_pricescale" as const,
    observed_at: observedAt,
    source_at: sourceAt,
    freshness: {
      status: ready ? "verified_source_timestamp" as const : pair === null ? "unavailable" as const : "unverified" as const,
      basis: "tradingview_chart_quote_lp_time" as const,
      observed_update_at: sourceAt,
      age_ms: ageMs,
      max_age_ms: maxQuoteAgeMs,
    },
    liveness: {
      status: fresh && realtimeLoaded ? "source_timestamp_verified" as const : "not_observed" as const,
      samples: 1,
      initial_observed_at: observedAt,
      latest_observed_at: observedAt,
    },
    data_mode: { ...mode, raw: quote.updateMode },
    market_state: activeSession && realtimeLoaded ? "active" as const : quote.currentSession === null ? "unknown" as const : "inactive" as const,
    instrument: {
      type: quote.type,
      subtype: null,
      market: null,
      currency: quote.currency,
      exchange: quote.exchange,
      timezone: quote.timezone,
      session: quote.session,
      current_session: quote.currentSession,
      pricescale: quote.pricescale,
      minmov: quote.minmov,
      minmove2: quote.minmove2,
      fractional: quote.fractional,
      last_price: quote.lastPrice,
      hub_realtime_loaded: quote.hubRealtimeLoaded,
      trade_loaded: quote.tradeLoaded,
    },
    issues,
  };
}

export async function buildExecutionSnapshot(
  dependencies: {
    scanner: Pick<Scanner, "getQuotes">;
    tv?: Pick<TradingView, "getExecutionQuotes">;
  },
  options: ExecutionSnapshotOptions,
  runtime: Runtime = {
    now: () => new Date(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
) {
  if (new Set(options.symbols).size !== options.symbols.length) {
    throw new Error("symbols must not contain duplicates");
  }
  if (options.sampleIntervalMs > options.waitForUpdateMs && options.waitForUpdateMs > 0) {
    throw new Error("sample_interval_ms must not exceed wait_for_update_ms");
  }

  const requestedAt = runtime.now().toISOString();
  const deadline = Date.parse(requestedAt) + options.waitForUpdateMs;
  let chartQuotes: ExecutionQuote[] = [];
  let chartObservedAt = requestedAt;
  if (dependencies.tv) {
    try {
      chartQuotes = await dependencies.tv.getExecutionQuotes();
      chartObservedAt = runtime.now().toISOString();
    } catch {
      chartQuotes = [];
    }
  }
  let chartBySymbol = new Map(chartQuotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
  const scannerSymbols = options.symbols.filter((symbol) => !chartBySymbol.has(symbol.toUpperCase()));
  const states = new Map<string, ObservationState>();
  if (scannerSymbols.length > 0) {
    const initialResult = await dependencies.scanner.getQuotes(scannerSymbols, EXECUTION_COLUMNS);
    const initialReceivedAt = runtime.now().toISOString();
    const initialRows = rowsBySymbol(initialResult, scannerSymbols);
    for (const symbol of scannerSymbols) {
      const values = initialRows.get(symbol);
      if (values) {
        const observation = { values, receivedAt: initialReceivedAt };
        states.set(symbol, { initial: observation, latest: observation, updateObservedAt: null, samples: 1 });
      }
    }
  }

  while (
    options.waitForUpdateMs > 0
    && runtime.now().getTime() < deadline
    && [...states.values()].some((state) => state.updateObservedAt === null)
  ) {
    const remaining = deadline - runtime.now().getTime();
    await runtime.sleep(Math.min(options.sampleIntervalMs, Math.max(0, remaining)));
    const sampleResult = await dependencies.scanner.getQuotes(scannerSymbols, EXECUTION_COLUMNS);
    const receivedAt = runtime.now().toISOString();
    const rows = rowsBySymbol(sampleResult, scannerSymbols);
    for (const symbol of scannerSymbols) {
      const values = rows.get(symbol);
      const state = states.get(symbol);
      if (!values || !state) continue;
      state.samples += 1;
      if (state.updateObservedAt === null && pairChanged(state.initial.values, values)) {
        state.updateObservedAt = receivedAt;
      }
      state.latest = { values, receivedAt };
    }
  }

  if (dependencies.tv) {
    try {
      chartQuotes = await dependencies.tv.getExecutionQuotes();
      chartObservedAt = runtime.now().toISOString();
      chartBySymbol = new Map(chartQuotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
    } catch {
      // Preserve the initial chart observations if the final refresh fails.
    }
  }

  const completedAt = runtime.now().toISOString();
  const quotes = options.symbols.map((symbol) => {
    const chartQuote = chartBySymbol.get(symbol.toUpperCase());
    if (chartQuote) return normalizedChartQuote(chartQuote, chartObservedAt, completedAt, options.maxQuoteAgeMs);
    const state = states.get(symbol);
    if (state) return normalizedQuote(symbol, state, completedAt, options.maxQuoteAgeMs);
    return {
      symbol,
      source: "tradingview_scanner" as const,
      status: "unavailable" as const,
      bid: null,
      ask: null,
      mid: null,
      spread_price: null,
      spread_pips: null,
      pip_size: getInstrumentMetadata(symbol).pip_size,
      tick_size: getInstrumentMetadata(symbol).tick_size,
      tick_size_basis: "instrument_metadata" as const,
      observed_at: null,
      source_at: null,
      freshness: { status: "unavailable" as const, basis: "unavailable" as const, observed_update_at: null, age_ms: null, max_age_ms: options.maxQuoteAgeMs },
      liveness: { status: "not_observed" as const, samples: 0, initial_observed_at: null, latest_observed_at: null },
      data_mode: { status: "unknown" as const, delay_seconds: null, raw: null },
      market_state: "unknown" as const,
      instrument: null,
      issues: [{ code: "symbol_missing", severity: "warning" as const, message: "The quote source did not return the requested symbol." }],
    };
  });
  const status = quotes.some((quote) => quote.status === "blocked")
    ? "blocked" as const
    : quotes.every((quote) => quote.status === "ready")
      ? "ready" as const
      : "wait" as const;

  return {
    schema_version: "1.0",
    snapshot_id: options.snapshotId ?? randomUUID(),
    status,
    requested_at: requestedAt,
    completed_at: completedAt,
    wait_for_update_ms: options.waitForUpdateMs,
    sample_interval_ms: options.sampleIntervalMs,
    max_quote_age_ms: options.maxQuoteAgeMs,
    source: "tradingview_chart_quotes_with_scanner_fallback",
    source_timestamp_available: quotes.every((quote) => quote.source_at !== null),
    quotes,
    limitations: [
      "Open-chart quote state is preferred because it includes lp_time, session state, and realtime-load flags; scanner is a conservative fallback.",
      "Chart lp_time timestamps the last price in the quote snapshot; it is not an independent bid/ask exchange timestamp.",
      "TradingView scanner fallback does not provide a bid/ask source timestamp or session calendar in this response.",
      "Chart-backed ready requires fresh lp_time, an active session, streaming mode, and loaded realtime state; scanner fallback requires a post-request bid/ask change.",
      "A source timestamp or locally observed update does not prove exchange sequencing, executable liquidity, or fill quality.",
      "No chart, alert, order, account, or journal state is read or changed.",
    ],
  };
}
