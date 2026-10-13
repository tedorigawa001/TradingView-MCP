import { createHash } from "node:crypto";
import { normalizeBarSeries, type BarSeries } from "./barSeries.js";
import { FxHistoricalArchive, resolveFxHistoricalArchivePath } from "./fxHistoricalArchive.js";
import { assertFxHistoryManifestBase, canonicalOandaSymbol, createFxBarAccumulator, FxHistoricalCheckpointStore, FxHistoricalManifestStore, fxHistoryCollectionKey,
  fxHistoryEnvironmentOf, isOandaFxInstrument, OANDA_FX_INSTRUMENTS, oandaPageRanges, parseOandaCandlePage, type FxHistoricalManifest, type FxM15Bar,
  type OandaEnvironment, type OandaFxInstrument } from "./oandaHistoricalFx.js";

/** At most this many bars in one export (a five-year M15 collection of one instrument has about 125,000). */
export const FX_HISTORY_EXPORT_MAX_BARS = 1_000_000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
/** A collection reads its pages within this long before it is recorded (BACKLOG 103-6, see rebuildFxHistoryCollection). */
const RUN_SPAN_MS = 60 * 60 * 1000;

type ManifestReader = { readonly instrument: OandaFxInstrument; readonly path?: string; records(): Promise<FxHistoricalManifest[]> };
type CheckpointReader = { readonly instrument: OandaFxInstrument; completed(collectionKey: string): Promise<{ requested_from: string; requested_to: string; raw_sha256: string }[]> };
type RawReader = Pick<FxHistoricalArchive, "read">;
/**
 * The manifest, its page checkpoints and the raw archive to read. By default the instrument's own files
 * (TRADINGVIEW_MCP_FX_HISTORY_* paths); a manifest given without its checkpoints, or the other way round, is refused.
 */
export type FxHistoryExportSources = { store?: ManifestReader; checkpoints?: CheckpointReader; archive?: RawReader };
const RECORD_FIELDS = ["sequence", "requested_from", "requested_to", "retrieved_at", "source_url_template", "raw_sha256", "normalized_sha256", "bar_count",
  "first_bar_at", "last_bar_at", "duplicate_timestamps_removed", "non_contiguous_weekday_intervals"] as const;
export type FxHistoryExportCollection = Pick<FxHistoricalManifest, (typeof RECORD_FIELDS)[number]> & { environment: OandaEnvironment; range_checkpointed: boolean; bars: FxM15Bar[] };
export type FxHistoryExport = {
  schema_version: "1.0"; series: "fx_historical_m15_export"; source_id: "oanda_v20"; evidence_tier: "official_revised_history"; instrument: OandaFxInstrument;
  canonical_symbol: string; granularity: "M15"; price: "M"; collections: FxHistoryExportCollection[];
};

const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The bars of one recorded collection, rebuilt from its raw pages (BACKLOG 103-6). The record's requested range gives the
 * pages, one raw response each, in order; each is read from the archive, checked against its hash, and parsed and
 * accumulated as the collector did. The rebuilt normalized hash, bar count, first and last bar, duplicates removed and
 * irregular weekday gaps must all equal the record's, or nothing is returned.
 *
 * The raw responses do not carry the range they answered: any range with the same page count, under which each page's
 * bars still fall in its page, would rebuild the same bars. The range is bound by the page checkpoints instead, which are
 * kept under a key of the environment, instrument and exact range: rangeCheckpointed says whether a checkpoint under the
 * record's key holds one of its pages with its raw hash. A page with no forming candle that ended more than 15 minutes
 * and an hour before the record was made (a collection reads its pages within an hour) was final when read, and every
 * collector version checkpoints such a page; a record with one and no matching checkpoint is refused. A record whose
 * pages could all still have been forming (a range ending near the time it was collected) may have none, and is
 * returned with rangeCheckpointed false.
 */
export async function rebuildFxHistoryCollection(record: FxHistoricalManifest, archive: RawReader, checkpoints: CheckpointReader): Promise<{ bars: FxM15Bar[]; rangeCheckpointed: boolean }> {
  const ranges = oandaPageRanges(record.requested_from, record.requested_to);
  if (ranges.length !== record.raw_sha256.length) throw new Error(`FX history collection ${record.sequence} records ${record.raw_sha256.length} raw pages for a range of ${ranges.length}`);
  const accumulator = createFxBarAccumulator(), recordedAt = Date.parse(record.retrieved_at);
  let mustBeCheckpointed = false;
  for (const [index, range] of ranges.entries()) {
    const hash = record.raw_sha256[index];
    let body: Buffer;
    try { body = await archive.read(hash); } catch (error) { throw new Error(`FX history collection ${record.sequence}, raw page ${index + 1}: ${message(error)}`, { cause: error }); }
    if (digest(body) !== hash) throw new Error(`FX history collection ${record.sequence}: raw page ${index + 1} does not match its hash`);
    const page = parseOandaCandlePage(body, record.instrument);
    accumulator.append(page.bars, range.start, range.end);
    if (page.incomplete === 0 && range.end + FIFTEEN_MINUTES + RUN_SPAN_MS <= recordedAt) mustBeCheckpointed = true;
  }
  const rebuilt = accumulator.finish();
  const found: Record<string, string | number | null> = {
    normalized_sha256: rebuilt.normalizedSha256, bar_count: rebuilt.bars.length, first_bar_at: rebuilt.bars[0]?.time ?? null,
    last_bar_at: rebuilt.bars.at(-1)?.time ?? null, duplicate_timestamps_removed: rebuilt.duplicates, non_contiguous_weekday_intervals: rebuilt.irregular,
  };
  for (const [field, value] of Object.entries(found)) {
    if (record[field as keyof FxHistoricalManifest] !== value) throw new Error(`FX history collection ${record.sequence}: the rebuilt ${field} does not match the record`);
  }
  const key = fxHistoryCollectionKey(fxHistoryEnvironmentOf(record.source_url_template), record.instrument, record.requested_from, record.requested_to);
  const rows = await checkpoints.completed(key);
  const rangeCheckpointed = rows.some((row) => ranges.some((range, index) =>
    row.requested_from === range.requestFrom && row.requested_to === range.requestTo && row.raw_sha256 === record.raw_sha256[index]));
  if (mustBeCheckpointed && !rangeCheckpointed) throw new Error(`FX history collection ${record.sequence}: no page checkpoint binds its requested range [${record.requested_from}, ${record.requested_to}]`);
  return { bars: rebuilt.bars, rangeCheckpointed };
}

/** The recorded collections of an instrument without their bars, for choosing what to export, and the manifest read. */
export async function listFxHistoryCollections(input: { instrument: OandaFxInstrument } & FxHistoryExportSources) {
  const { store } = await readers(input);
  return {
    manifest_path: store.path ?? null,
    collections: (await store.records()).map((record) => ({
      sequence: record.sequence, requested_from: record.requested_from, requested_to: record.requested_to, retrieved_at: record.retrieved_at,
      environment: fxHistoryEnvironmentOf(record.source_url_template), pages: record.raw_sha256.length, bar_count: record.bar_count,
      first_bar_at: record.first_bar_at, last_bar_at: record.last_bar_at, normalized_sha256: record.normalized_sha256,
    })),
  };
}

/**
 * Exports recorded collections of one instrument with their bars (BACKLOG 103-6): the ones named by sequence, or all.
 * Each is rebuilt and verified first (rebuildFxHistoryCollection); the export holds the record's fields, its environment,
 * whether a checkpoint binds its range, and its bars, in manifest order, and nothing that varies between runs, so the
 * same records give the same bytes. maxBars (default 1,000,000) is checked before any raw page is read.
 */
export async function exportFxHistory(input: { instrument: OandaFxInstrument; sequences?: number[]; all?: boolean; maxBars?: number } & FxHistoryExportSources): Promise<FxHistoryExport> {
  const { instrument, store, checkpoints, archive } = await readers(input);
  const sequences = input.sequences ?? [];
  if (input.all ? sequences.length > 0 : sequences.length === 0) throw new Error("name the collections to export by sequence, or export all of them");
  if (sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence < 1)) throw new Error("a collection sequence must be a positive integer");
  const records = await store.records();
  const where = store.path ? ` in ${store.path}` : "";
  const known = new Set(records.map((record) => record.sequence));
  const missing = sequences.filter((sequence) => !known.has(sequence));
  if (missing.length) throw new Error(`no ${instrument} FX history collection${where} has sequence ${missing.join(", ")}`);
  const chosen = input.all ? records : records.filter((record) => sequences.includes(record.sequence));
  if (!chosen.length) throw new Error(`no ${instrument} FX history collection is recorded${where}`);
  const maxBars = input.maxBars ?? FX_HISTORY_EXPORT_MAX_BARS;
  const total = chosen.reduce((sum, record) => sum + record.bar_count, 0);
  if (total > maxBars) throw new Error(`the export would hold ${total} bars, more than ${maxBars}; export fewer collections at a time`);
  const collections: FxHistoryExportCollection[] = [];
  for (const record of chosen) {
    const { bars, rangeCheckpointed } = await rebuildFxHistoryCollection(record, archive, checkpoints);
    const fields = Object.fromEntries(RECORD_FIELDS.map((field) => [field, record[field]])) as Pick<FxHistoricalManifest, (typeof RECORD_FIELDS)[number]>;
    collections.push({ ...fields, environment: fxHistoryEnvironmentOf(record.source_url_template), range_checkpointed: rangeCheckpointed, bars });
  }
  return { schema_version: "1.0", series: "fx_historical_m15_export", source_id: "oanda_v20", evidence_tier: "official_revised_history", instrument,
    canonical_symbol: canonicalOandaSymbol(instrument), granularity: "M15", price: "M", collections };
}

/**
 * One exported collection as the input of tradingview-mcp-import-bar-series: open times in Unix seconds and closes, the
 * collection's normalized hash as the source hash. The series id and evidence tier are the caller's claim and are
 * required. The result is checked to be importable.
 */
export function fxHistoryBarSeries(collection: Pick<FxHistoryExportCollection, "normalized_sha256" | "bars">, options: { seriesId: string; evidenceTier: BarSeries["evidence_tier"] }): BarSeries {
  const input = {
    schema_version: "1.0" as const, source_id: "oanda_v20", source_sha256: collection.normalized_sha256, evidence_tier: options.evidenceTier,
    series_id: options.seriesId, interval_minutes: 15, open_time: collection.bars.map((bar) => new Date(bar.time).getTime() / 1000), close: collection.bars.map((bar) => bar.close),
  };
  return normalizeBarSeries(input).series;
}

async function readers(input: { instrument: OandaFxInstrument } & FxHistoryExportSources) {
  const { instrument } = input;
  if (!isOandaFxInstrument(instrument)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  if ((input.store === undefined) !== (input.checkpoints === undefined)) throw new Error("pass the FX history manifest store and its checkpoint store together");
  for (const [label, port] of [["manifest store", input.store], ["checkpoint store", input.checkpoints]] as const) {
    if (port && port.instrument !== instrument) throw new Error(`the FX history ${label} is for ${port.instrument}, not ${instrument}`);
  }
  if (input.store === undefined) await assertFxHistoryManifestBase();
  return { instrument, store: input.store ?? new FxHistoricalManifestStore(undefined, instrument), checkpoints: input.checkpoints ?? new FxHistoricalCheckpointStore(undefined, instrument),
    archive: input.archive ?? new FxHistoricalArchive(resolveFxHistoricalArchivePath()) };
}
