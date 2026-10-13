import { createHash } from "node:crypto";
import { normalizeBarSeries, type BarSeries } from "./barSeries.js";
import { FxHistoricalArchive, resolveFxHistoricalArchivePath } from "./fxHistoricalArchive.js";
import { canonicalOandaSymbol, createFxBarAccumulator, FxHistoricalManifestStore, isOandaFxInstrument, OANDA_FX_INSTRUMENTS, oandaPageRanges,
  parseOandaCandlePage, type FxHistoricalManifest, type FxM15Bar, type OandaFxInstrument } from "./oandaHistoricalFx.js";

/** At most this many bars in one export (a five-year M15 collection of one instrument has about 125,000). */
export const FX_HISTORY_EXPORT_MAX_BARS = 1_000_000;

type ManifestReader = { readonly instrument: OandaFxInstrument; records(): Promise<FxHistoricalManifest[]> };
type RawReader = Pick<FxHistoricalArchive, "read">;
/** The manifest and raw archive to read; by default the instrument's own files (TRADINGVIEW_MCP_FX_HISTORY_* paths). */
export type FxHistoryExportSources = { store?: ManifestReader; archive?: RawReader };
const RECORD_FIELDS = ["sequence", "requested_from", "requested_to", "retrieved_at", "raw_sha256", "normalized_sha256", "bar_count", "first_bar_at",
  "last_bar_at", "duplicate_timestamps_removed", "non_contiguous_weekday_intervals"] as const;
export type FxHistoryExportCollection = Pick<FxHistoricalManifest, (typeof RECORD_FIELDS)[number]> & { bars: FxM15Bar[] };
export type FxHistoryExport = {
  schema_version: "1.0"; series: "fx_historical_m15_export"; source_id: "oanda_v20"; instrument: OandaFxInstrument; canonical_symbol: string;
  collections: FxHistoryExportCollection[];
};

const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * The bars of one recorded collection, rebuilt from its raw pages (BACKLOG 103-6). The record's requested range gives the
 * pages, one raw response each, in order; each is read from the archive, checked against its hash, and parsed and
 * accumulated as the collector did. The rebuilt normalized hash, bar count, first and last bar, duplicates removed and
 * irregular weekday gaps must all equal the record's, or nothing is returned. The raw responses do not carry the range
 * they answered, so the record's range is checked only as far as its page count and each bar falling in its page: a
 * last page's end moved outward, with no bar beyond the true end, would pass. The manifest is written by the collector only.
 */
export async function rebuildFxHistoryCollection(record: FxHistoricalManifest, archive: RawReader): Promise<FxM15Bar[]> {
  const ranges = oandaPageRanges(record.requested_from, record.requested_to);
  if (ranges.length !== record.raw_sha256.length) throw new Error(`FX history collection ${record.sequence} records ${record.raw_sha256.length} raw pages for a range of ${ranges.length}`);
  const accumulator = createFxBarAccumulator();
  for (const [index, range] of ranges.entries()) {
    const hash = record.raw_sha256[index];
    const body = await archive.read(hash);
    if (digest(body) !== hash) throw new Error(`FX history collection ${record.sequence}: raw page ${index + 1} does not match its hash`);
    accumulator.append(parseOandaCandlePage(body, record.instrument).bars, range.start, range.end);
  }
  const rebuilt = accumulator.finish();
  const found: Record<string, string | number | null> = {
    normalized_sha256: rebuilt.normalizedSha256, bar_count: rebuilt.bars.length, first_bar_at: rebuilt.bars[0]?.time ?? null,
    last_bar_at: rebuilt.bars.at(-1)?.time ?? null, duplicate_timestamps_removed: rebuilt.duplicates, non_contiguous_weekday_intervals: rebuilt.irregular,
  };
  for (const [field, value] of Object.entries(found)) {
    if (record[field as keyof FxHistoricalManifest] !== value) throw new Error(`FX history collection ${record.sequence}: the rebuilt ${field} does not match the record`);
  }
  return rebuilt.bars;
}

/** The recorded collections of an instrument without their bars, for choosing what to export. */
export async function listFxHistoryCollections(input: { instrument: OandaFxInstrument; store?: ManifestReader }) {
  const { store } = readers(input);
  return (await store.records()).map((record) => ({
    sequence: record.sequence, requested_from: record.requested_from, requested_to: record.requested_to, retrieved_at: record.retrieved_at,
    pages: record.raw_sha256.length, bar_count: record.bar_count, first_bar_at: record.first_bar_at, last_bar_at: record.last_bar_at,
    normalized_sha256: record.normalized_sha256,
  }));
}

/**
 * Exports recorded collections of one instrument with their bars (BACKLOG 103-6): the ones named by sequence, or all.
 * Each is rebuilt and verified first (rebuildFxHistoryCollection); the export holds the record's fields and its bars,
 * in manifest order, and nothing that varies between runs, so the same records give the same bytes.
 */
export async function exportFxHistory(input: { instrument: OandaFxInstrument; sequences?: number[]; all?: boolean; store?: ManifestReader; archive?: RawReader }): Promise<FxHistoryExport> {
  const { instrument, store, archive } = readers(input);
  const sequences = input.sequences ?? [];
  if (input.all ? sequences.length > 0 : sequences.length === 0) throw new Error("name the collections to export by sequence, or export all of them");
  if (sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence < 1)) throw new Error("a collection sequence must be a positive integer");
  const records = await store.records();
  const known = new Set(records.map((record) => record.sequence));
  const missing = sequences.filter((sequence) => !known.has(sequence));
  if (missing.length) throw new Error(`no ${instrument} FX history collection has sequence ${missing.join(", ")}`);
  const chosen = input.all ? records : records.filter((record) => sequences.includes(record.sequence));
  if (!chosen.length) throw new Error(`no ${instrument} FX history collection is recorded`);
  const total = chosen.reduce((sum, record) => sum + record.bar_count, 0);
  if (total > FX_HISTORY_EXPORT_MAX_BARS) throw new Error(`the export would hold ${total} bars, more than ${FX_HISTORY_EXPORT_MAX_BARS}; export fewer collections at a time`);
  const collections: FxHistoryExportCollection[] = [];
  for (const record of chosen) {
    const bars = await rebuildFxHistoryCollection(record, archive);
    collections.push({ ...Object.fromEntries(RECORD_FIELDS.map((field) => [field, record[field]])) as Pick<FxHistoricalManifest, (typeof RECORD_FIELDS)[number]>, bars });
  }
  return { schema_version: "1.0", series: "fx_historical_m15_export", source_id: "oanda_v20", instrument, canonical_symbol: canonicalOandaSymbol(instrument), collections };
}

/**
 * One exported collection as the input of tradingview-mcp-import-bar-series: open times in Unix seconds and closes, the
 * collection's normalized hash as the source hash. The series id and evidence tier are the caller's claim and are
 * required. The result is checked to be importable.
 */
export function fxHistoryBarSeries(collection: FxHistoryExportCollection, options: { seriesId: string; evidenceTier: BarSeries["evidence_tier"] }): BarSeries {
  const input = {
    schema_version: "1.0" as const, source_id: "oanda_v20", source_sha256: collection.normalized_sha256, evidence_tier: options.evidenceTier,
    series_id: options.seriesId, interval_minutes: 15, open_time: collection.bars.map((bar) => new Date(bar.time).getTime() / 1000), close: collection.bars.map((bar) => bar.close),
  };
  return normalizeBarSeries(input).series;
}

function readers(input: { instrument: OandaFxInstrument; store?: ManifestReader; archive?: RawReader }) {
  const { instrument } = input;
  if (!isOandaFxInstrument(instrument)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  if (input.store && input.store.instrument !== instrument) throw new Error(`the FX history manifest store is for ${input.store.instrument}, not ${instrument}`);
  return { instrument, store: input.store ?? new FxHistoricalManifestStore(undefined, instrument), archive: input.archive ?? new FxHistoricalArchive(resolveFxHistoricalArchivePath()) };
}
