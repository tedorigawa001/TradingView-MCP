import { createHash } from "node:crypto";
import { z } from "zod";

export const NATIVE_BAR_SYMBOLS = ["PEPPERSTONE:MXNJPY", "OANDA:XAUUSD"] as const;
export const nativeBarTimestamp = z.string().refine((s) => {
  const n = Date.parse(s);
  return /^[0-9]{4}-/.test(s) && Number.isFinite(n) && n >= 0 && new Date(n).toISOString() === s;
}, "canonical nonnegative four-digit-year UTC timestamp required");
export const nativeBarId = z.uuid();
export const nativeBarHash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(4096);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function evidenceHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export const nativeSeriesContextSchema = z.strictObject({
  symbol: z.enum(NATIVE_BAR_SYMBOLS), full_name: text, exchange: text, type: text, currency: text,
  timezone: text, session: text, subsession_id: text,
  pricescale: z.number().positive().finite(), minmov: z.number().positive().finite(),
  minmove2: z.number().nonnegative().finite(), fractional: z.boolean(),
  chart_style: z.enum(["bars", "candles", "hollow_candles"]),
  adjustment: z.union([z.literal("not_applicable"), z.strictObject({
    dividends: z.boolean(), back_adjustment: z.boolean(), extended_hours: z.boolean(),
  })]),
  capture_contract: z.literal("native-bar-v1:successor-confirmed"),
}).refine((c) => c.symbol === c.full_name, "exact full-name binding required");
export const nativeBarSchema = z.strictObject({
  bar_open_at: nativeBarTimestamp, confirmed_by_next_bar_at: nativeBarTimestamp,
  open: z.number().finite(), high: z.number().finite(), low: z.number().finite(), close: z.number().finite(),
  volume: z.number().nonnegative().finite().nullable(),
}).refine((b) => b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close)
  && b.low <= b.high && b.bar_open_at < b.confirmed_by_next_bar_at, "invalid OHLC or successor");
export const nativeBarSeriesSchema = z.strictObject({
  symbol: z.enum(NATIVE_BAR_SYMBOLS), timeframe: z.enum(["15", "60"]),
  context: nativeSeriesContextSchema, series_context_id: nativeBarHash,
  source: z.literal("tradingview_native_ohlcv"), price_basis: z.literal("unknown"),
  observed_at: nativeBarTimestamp, history_shortage: z.boolean(),
  provenance: z.strictObject({ session_holidays: z.string().max(65536).nullable(), corrections: z.string().max(65536).nullable() }),
  bars: z.array(nativeBarSchema).min(1).max(40),
}).superRefine((s, ctx) => {
  if (s.context.symbol !== s.symbol || evidenceHash(s.context) !== s.series_context_id) {
    ctx.addIssue({ code: "custom", message: "series context mismatch" });
  }
  if (s.bars.some((b, i) => b.confirmed_by_next_bar_at > s.observed_at
    || (i > 0 && s.bars[i - 1].bar_open_at >= b.bar_open_at))) {
    ctx.addIssue({ code: "custom", message: "unordered or unobserved successor" });
  }
});
export const nativeBarCaptureSchema = z.strictObject({
  capture_as_of: nativeBarTimestamp, restoration_verified: z.literal(true),
  restoration_hash: nativeBarHash, series: z.array(nativeBarSeriesSchema).length(4),
}).superRefine((c, ctx) => {
  const keys = c.series.map((s) => `${s.symbol}/${s.timeframe}`);
  if (new Set(keys).size !== 4 || c.series.some((s) => s.observed_at < c.capture_as_of
    || s.bars.some((b) => b.confirmed_by_next_bar_at > c.capture_as_of))) {
    ctx.addIssue({ code: "custom", message: "incomplete scope or invalid capture cutoff" });
  }
});
export type NativeBarCapture = z.infer<typeof nativeBarCaptureSchema>;
export type NativeBarSeriesContext = z.infer<typeof nativeSeriesContextSchema>;
export const nativeBarTargetsSchema = z.array(z.strictObject({
  chart_index: z.number().int().nonnegative(), symbol: z.enum(NATIVE_BAR_SYMBOLS),
  expected_timeframe: z.string().regex(/^(15|60|240|1D|D)$/),
})).length(2).refine((ts) => new Set(ts.map((t) => t.symbol)).size === 2
  && new Set(ts.map((t) => t.chart_index)).size === 2, "two distinct displayed targets required");
export type NativeBarTargets = z.infer<typeof nativeBarTargetsSchema>;
export type AcceptedNativeCapture = {
  recording_id: string; sequence: number; recorded_at: string; payload_hash: string; capture: NativeBarCapture;
};

/** Derive occurrences only from accepted observations; absent windows never imply deletion. */
export function projectNativeBarHistory(captures: AcceptedNativeCapture[], input: {
  symbol: typeof NATIVE_BAR_SYMBOLS[number]; timeframe: "15" | "60"; as_of?: string; limit?: number;
}, truncated: boolean) {
  z.strictObject({ symbol: z.enum(NATIVE_BAR_SYMBOLS), timeframe: z.enum(["15", "60"]),
    as_of: nativeBarTimestamp.optional(), limit: z.number().int().min(1).max(100).optional() }).parse(input);
  const asOf = input.as_of ? nativeBarTimestamp.parse(input.as_of) : null;
  const identities = new Map<string, any>();
  for (const batch of [...captures].sort((a, b) => a.sequence - b.sequence)) {
    if (asOf && batch.recorded_at > asOf) continue;
    for (const series of batch.capture.series) {
      if (series.symbol !== input.symbol || series.timeframe !== input.timeframe || (asOf && series.observed_at > asOf)) continue;
      for (const bar of series.bars) {
        const key = canonical([series.source, series.symbol, series.timeframe, bar.bar_open_at, series.price_basis, series.series_context_id]);
        let row = identities.get(key);
        if (!row) {
          row = { symbol: series.symbol, timeframe: series.timeframe, source: series.source, price_basis: series.price_basis,
            series_context_id: series.series_context_id, context: series.context, bar_open_at: bar.bar_open_at,
            first_seen_at: series.observed_at, first_seen_scope: truncated ? "earliest_retained" : "local_observations_only", versions: [] };
          identities.set(key, row);
        }
        const fields = ["open", "high", "low", "close", "volume"] as const;
        const values = Object.fromEntries(fields.map((k) => [k, bar[k]]));
        const hash = evidenceHash(values), previous = row.versions.at(-1);
        if (!previous || previous.value_hash !== hash) {
          const changed = previous ? fields.filter((k) => previous.values[k] !== bar[k]) : [];
          row.versions.push({ occurrence: truncated ? null : row.versions.length + 1,
            retained_occurrence: row.versions.length + 1, value_hash: hash, values,
            changed_fields: changed, change_kind: !previous ? truncated ? "retained_origin_unknown" : "initial"
              : changed.every((k) => k === "volume") ? "volume_only" : "price_or_mixed",
            version_first_seen_at: series.observed_at, last_observed_at: series.observed_at,
            confirmed_by_next_bar_at: bar.confirmed_by_next_bar_at, recorded_at: batch.recorded_at,
            recording_id: batch.recording_id, payload_hash: batch.payload_hash });
        } else {
          previous.last_observed_at = series.observed_at;
          previous.recorded_at = batch.recorded_at; previous.recording_id = batch.recording_id;
          previous.payload_hash = batch.payload_hash;
          previous.confirmed_by_next_bar_at = bar.confirmed_by_next_bar_at;
        }
      }
    }
  }
  const rows = [...identities.values()].sort((a, b) => b.bar_open_at.localeCompare(a.bar_open_at)
    || a.series_context_id.localeCompare(b.series_context_id));
  const selected = rows.slice(0, input.limit ?? 40).map((row) => ({ ...row,
    omitted_earlier_occurrences: Math.max(0, row.versions.length - 100), versions: row.versions.slice(-100) }));
  return { storage_visibility_at_as_of: "not_proven", history_truncated: truncated,
    continuity: "only_observed_values; context epochs are separate; no carry-forward proof",
    total_identities: rows.length, bars: selected };
}
