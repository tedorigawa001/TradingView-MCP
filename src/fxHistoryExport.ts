import { createHash } from "node:crypto";
import { normalizeBarSeries, type BarSeries } from "./barSeries.js";
import { FxHistoricalArchive, resolveFxHistoricalArchivePath } from "./fxHistoricalArchive.js";
import { FxHistoricalRunLog, type FxHistoricalRun } from "./fxHistoryRunLog.js";
import { assertFxHistoryManifestBase, canonicalOandaSymbol, createFxBarAccumulator, FxHistoricalCheckpointStore, FxHistoricalManifestStore, fxHistoryCollectionKey,
  fxHistoryEnvironmentOf, isOandaFxInstrument, OANDA_FX_INSTRUMENTS, oandaPageRanges, parseOandaCandlePage, type FxHistoricalManifest, type FxM15Bar,
  type OandaEnvironment, type OandaFxInstrument } from "./oandaHistoricalFx.js";

/** At most this many bars in one export, or one part of a split one (a five-year M15 collection of one instrument has about 125,000). */
export const FX_HISTORY_EXPORT_MAX_BARS = 1_000_000;
/** At most this many bars in all the parts of a whole export split into parts (BACKLOG 103-10). */
export const FX_HISTORY_EXPORT_SPLIT_MAX_BARS = 20_000_000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
/** A collection reads its pages within this long before it is recorded (BACKLOG 103-6, see rebuildFxHistoryCollection). */
const RUN_SPAN_MS = 6 * 60 * 60 * 1000;
/** How many times the logs are read before an export gives up on reading them at one moment. */
const SNAPSHOT_ATTEMPTS = 5;

type ManifestReader = { readonly instrument: OandaFxInstrument; readonly path?: string; records(): Promise<FxHistoricalManifest[]> };
type CheckpointRow = { requested_from: string; requested_to: string; raw_sha256: string };
/**
 * The page checkpoints of a collection key, in log order. A reader with records() is read once, whole, and grouped by
 * key (BACKLOG 103-10 review); one without is asked key by key.
 */
type CheckpointReader = {
  readonly instrument: OandaFxInstrument; completed(collectionKey: string): Promise<CheckpointRow[]>;
  records?(): Promise<(CheckpointRow & { collection_key: string })[]>;
};
type RawReader = Pick<FxHistoricalArchive, "read">;
type RunReader = { readonly instrument: OandaFxInstrument; records(): Promise<FxHistoricalRun[]> };
/**
 * The manifest, its page checkpoints, its run log (BACKLOG 103-5) and the raw archive to read. By default the instrument's
 * own files (TRADINGVIEW_MCP_FX_HISTORY_* paths); the manifest, checkpoints and run log are given all together or not at all.
 */
export type FxHistoryExportSources = { store?: ManifestReader; checkpoints?: CheckpointReader; runs?: RunReader; archive?: RawReader };
const RECORD_FIELDS = ["sequence", "requested_from", "requested_to", "retrieved_at", "source_url_template", "raw_sha256", "normalized_sha256", "bar_count",
  "first_bar_at", "last_bar_at", "duplicate_timestamps_removed", "non_contiguous_weekday_intervals"] as const;
export type FxHistoryExportCollection = Pick<FxHistoricalManifest, (typeof RECORD_FIELDS)[number]> & { environment: OandaEnvironment; range_checkpointed: boolean; bars: FxM15Bar[] };
const RUN_FIELDS = ["sequence", "trigger", "environment", "requested_from", "requested_to", "started_at", "retrieved_at", "raw_sha256", "normalized_sha256",
  "bar_count", "resumed_pages", "unfinished_pages", "manifest_recorded"] as const;
export type FxHistoryExportRun = Pick<FxHistoricalRun, (typeof RUN_FIELDS)[number]>;
/**
 * schema_version 1.1 (0.1.43) adds manifest_records and run_records to 1.0 (0.1.42), which had neither (BACKLOG 103-9),
 * and `part` in each part of a whole export split into parts (BACKLOG 103-10).
 */
export type FxHistoryExport = {
  schema_version: "1.1"; series: "fx_historical_m15_export"; source_id: "oanda_v20"; evidence_tier: "official_revised_history"; instrument: OandaFxInstrument;
  canonical_symbol: string; granularity: "M15"; price: "M";
  /**
   * How many records the manifest and the run log held when the export read them, at one moment (BACKLOG 103-9): a
   * reader compares them with collections.length and runs.length to tell a whole export from a partial one, a cut-off
   * tail included. They count the whole logs, so every export, a partial one too, changes when a record is added.
   */
  manifest_records: number; run_records: number;
  /** In a whole export split into parts only (BACKLOG 103-10): this document is part `index` of `of`. */
  part?: { index: number; of: number };
  collections: FxHistoryExportCollection[];
  /** The recorded runs (BACKLOG 103-5) whose content is one of the exported collections, in run-log order. */
  runs: FxHistoryExportRun[];
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
 * kept under a key of the environment, instrument and exact range. A page with no forming candle that ended more than 15
 * minutes and six hours before the record was made (a collection reads its pages within six hours) was final when read,
 * and every collector version checkpoints such a page: each such page must have a checkpoint under the record's key for
 * its own range and raw hash, or the record is refused. rangeCheckpointed says whether every page has one; a page that
 * could still have been forming (one with a forming candle, or ending just before the collection) may have none.
 */
export async function rebuildFxHistoryCollection(record: FxHistoricalManifest, archive: RawReader, checkpoints: CheckpointReader): Promise<{ bars: FxM15Bar[]; rangeCheckpointed: boolean }> {
  const ranges = oandaPageRanges(record.requested_from, record.requested_to);
  if (ranges.length !== record.raw_sha256.length) throw new Error(`FX history collection ${record.sequence} records ${record.raw_sha256.length} raw pages for a range of ${ranges.length}`);
  const accumulator = createFxBarAccumulator(), recordedAt = Date.parse(record.retrieved_at);
  const mustBeCheckpointed: boolean[] = [];
  for (const [index, range] of ranges.entries()) {
    const hash = record.raw_sha256[index];
    let body: Buffer;
    try { body = await archive.read(hash); } catch (error) { throw new Error(`FX history collection ${record.sequence}, raw page ${index + 1}: ${message(error)}`, { cause: error }); }
    if (digest(body) !== hash) throw new Error(`FX history collection ${record.sequence}: raw page ${index + 1} does not match its hash`);
    const page = parseOandaCandlePage(body, record.instrument);
    accumulator.append(page.bars, range.start, range.end);
    mustBeCheckpointed.push(page.incomplete === 0 && range.end + FIFTEEN_MINUTES + RUN_SPAN_MS <= recordedAt);
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
  const checkpointed = ranges.map((range, index) => rows.some((row) =>
    row.requested_from === range.requestFrom && row.requested_to === range.requestTo && row.raw_sha256 === record.raw_sha256[index]));
  const unbound = checkpointed.findIndex((found, index) => mustBeCheckpointed[index] && !found);
  if (unbound >= 0) throw new Error(`FX history collection ${record.sequence}: no page checkpoint binds page ${unbound + 1} of its requested range [${record.requested_from}, ${record.requested_to}]`);
  return { bars: rebuilt.bars, rangeCheckpointed: checkpointed.every(Boolean) };
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

/** The page checkpoints of the collections of `records`, by collection key: the whole log read once when it can be. */
async function readCheckpointRows(checkpoints: CheckpointReader, records: FxHistoricalManifest[]): Promise<Map<string, CheckpointRow[]>> {
  const grouped = new Map<string, CheckpointRow[]>();
  if (checkpoints.records) {
    for (const row of await checkpoints.records()) {
      const rows = grouped.get(row.collection_key);
      if (rows) rows.push(row); else grouped.set(row.collection_key, [row]);
    }
    return grouped;
  }
  for (const record of records) {
    let key: string;
    // A record whose key cannot be made is refused by its rebuild, naming it.
    try { key = fxHistoryCollectionKey(fxHistoryEnvironmentOf(record.source_url_template), record.instrument, record.requested_from, record.requested_to); } catch { continue; }
    if (!grouped.has(key)) grouped.set(key, await checkpoints.completed(key));
  }
  return grouped;
}

/**
 * The manifest, the run log and the page checkpoints of an instrument as they were at one moment (BACKLOG 103-9 review,
 * 103-10 review). The run log is read first, so every run read has its content recorded (a collection records its
 * content before its run); then the manifest, then the checkpoints, whole and once; then the manifest and the run log
 * again. Both only grow, so when each second read holds as many records as the first, neither changed meanwhile, and
 * all three describe the moment the checkpoints were read: a checkpoint written after that moment, by a later run of a
 * recorded range, is not in the snapshot. Otherwise all are read again, up to five times in all. The manifest holds
 * each content once; a manifest with a content twice is refused, as is a run whose content the manifest does not hold,
 * or whose bar count differs from that content's.
 */
async function readFxHistorySnapshot(instrument: OandaFxInstrument, store: ManifestReader, runs: RunReader, checkpoints: CheckpointReader) {
  const where = store.path ? ` in ${store.path}` : "";
  for (let attempt = 1; ; attempt += 1) {
    const runRecords = await runs.records();
    const records = await store.records();
    const checkpointRows = await readCheckpointRows(checkpoints, records);
    if ((await store.records()).length === records.length && (await runs.records()).length === runRecords.length) {
      const sequenceOf = new Map<string, number>();
      for (const record of records) {
        const earlier = sequenceOf.get(record.normalized_sha256);
        if (earlier !== undefined) throw new Error(`the ${instrument} FX history manifest${where} records content ${record.normalized_sha256} twice, as collections ${earlier} and ${record.sequence}`);
        sequenceOf.set(record.normalized_sha256, record.sequence);
      }
      const barsOf = new Map(records.map((record) => [record.normalized_sha256, record.bar_count]));
      for (const run of runRecords) {
        if (!barsOf.has(run.normalized_sha256)) throw new Error(`FX history run ${run.sequence} names content the ${instrument} manifest${where} does not hold`);
        if (barsOf.get(run.normalized_sha256) !== run.bar_count) throw new Error(`FX history run ${run.sequence} records ${run.bar_count} bars for content of ${barsOf.get(run.normalized_sha256)}`);
      }
      const snapshotCheckpoints: CheckpointReader = { instrument: checkpoints.instrument, completed: async (key) => checkpointRows.get(key) ?? [] };
      return { records, runRecords, checkpoints: snapshotCheckpoints, where };
    }
    if (attempt === SNAPSHOT_ATTEMPTS) {
      throw new Error(`the ${instrument} FX history manifest${where} or its run log grew each of the ${SNAPSHOT_ATTEMPTS} times they were read; export again when no collection is running`);
    }
  }
}

/**
 * Exports recorded collections of one instrument with their bars (BACKLOG 103-6): the ones named by sequence, or all.
 * Each is rebuilt and verified first (rebuildFxHistoryCollection); the export holds the record's fields, its environment,
 * whether a checkpoint binds its range, and its bars, in manifest order. maxBars (default 1,000,000) is checked before
 * any raw page is read.
 * It also holds the runs of the instrument's run log whose content is an exported collection (BACKLOG 103-5): how each
 * was started, when it started and finished, and what range it requested, which a point-in-time reading needs. The
 * manifest, the run log and the page checkpoints are read at one moment (readFxHistorySnapshot), and the totals of the
 * first two are in the export (BACKLOG 103-9). Nothing in it depends on when the export ran, so the same manifest, run
 * log and page checkpoints give the same bytes; a record added to the manifest or the run log changes them, a partial
 * export's too, since the totals count the whole logs, and a checkpoint added by a later run of an identical range can
 * turn a collection's range_checkpointed true while the totals stay the same.
 */
export async function exportFxHistory(input: { instrument: OandaFxInstrument; sequences?: number[]; all?: boolean; maxBars?: number } & FxHistoryExportSources): Promise<FxHistoryExport> {
  const { instrument, store, checkpoints: checkpointLog, runs, archive } = await readers(input);
  const sequences = input.sequences ?? [];
  if (input.all ? sequences.length > 0 : sequences.length === 0) throw new Error("name the collections to export by sequence, or export all of them");
  if (sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence < 1)) throw new Error("a collection sequence must be a positive integer");
  const { records, runRecords, checkpoints, where } = await readFxHistorySnapshot(instrument, store, runs, checkpointLog);
  const known = new Set(records.map((record) => record.sequence));
  const missing = sequences.filter((sequence) => !known.has(sequence));
  if (missing.length) throw new Error(`no ${instrument} FX history collection${where} has sequence ${missing.join(", ")}`);
  const chosen = input.all ? records : records.filter((record) => sequences.includes(record.sequence));
  if (!chosen.length) throw new Error(`no ${instrument} FX history collection is recorded${where}`);
  const maxBars = input.maxBars ?? FX_HISTORY_EXPORT_MAX_BARS;
  const total = chosen.reduce((sum, record) => sum + record.bar_count, 0);
  if (total > maxBars) {
    throw new Error(`the export would hold ${total} bars, more than ${maxBars}; ${input.all ? "write a whole export in parts with --split" : "export fewer collections at a time"}`);
  }
  assertKnownHosts(chosen, store.path);
  return exportDocument({ instrument, records, runRecords, manifestPath: store.path }, chosen, archive, checkpoints);
}

/**
 * Checks, before any raw page is read, that every collection's source URL names an OANDA host: its environment keys
 * its page checkpoints, and the rebuild would otherwise refuse it only after reading its pages (BACKLOG 103-10 review 2).
 */
function assertKnownHosts(records: FxHistoricalManifest[], manifestPath?: string): void {
  for (const record of records) {
    try { fxHistoryEnvironmentOf(record.source_url_template); }
    catch (error) { throw new Error(`FX history collection ${record.sequence}: ${message(error)}${manifestPath ? ` (manifest ${manifestPath})` : ""}`, { cause: error }); }
  }
}

/**
 * The export document of `chosen`, records of one snapshot in manifest order, each rebuilt from its raw pages and checked
 * (rebuildFxHistoryCollection), with the snapshot's runs whose content is one of them, in run-log order, and, for a part
 * of a split export, which part it is.
 */
async function exportDocument(snapshot: { instrument: OandaFxInstrument; records: FxHistoricalManifest[]; runRecords: FxHistoricalRun[]; manifestPath?: string },
  chosen: FxHistoricalManifest[], archive: RawReader, checkpoints: CheckpointReader, part?: FxHistoryExport["part"]): Promise<FxHistoryExport> {
  const { instrument, records, runRecords, manifestPath } = snapshot;
  const collections: FxHistoryExportCollection[] = [];
  for (const record of chosen) {
    let rebuilt: Awaited<ReturnType<typeof rebuildFxHistoryCollection>>;
    try { rebuilt = await rebuildFxHistoryCollection(record, archive, checkpoints); } catch (error) { throw new Error(`${message(error)}${manifestPath ? ` (manifest ${manifestPath})` : ""}`, { cause: error }); }
    const { bars, rangeCheckpointed } = rebuilt;
    const fields = Object.fromEntries(RECORD_FIELDS.map((field) => [field, record[field]])) as Pick<FxHistoricalManifest, (typeof RECORD_FIELDS)[number]>;
    collections.push({ ...fields, environment: fxHistoryEnvironmentOf(record.source_url_template), range_checkpointed: rangeCheckpointed, bars });
  }
  const exported = new Set(chosen.map((record) => record.normalized_sha256));
  const runRows = runRecords.filter((run) => exported.has(run.normalized_sha256))
    .map((run) => Object.fromEntries(RUN_FIELDS.map((field) => [field, run[field]])) as FxHistoryExportRun);
  return { schema_version: "1.1", series: "fx_historical_m15_export", source_id: "oanda_v20", evidence_tier: "official_revised_history", instrument,
    canonical_symbol: canonicalOandaSymbol(instrument), granularity: "M15", price: "M", manifest_records: records.length, run_records: runRecords.length,
    ...(part === undefined ? {} : { part }), collections, runs: runRows };
}

/** One part of a split export: its place, the sequences of its collections, its bars and how many runs it holds. */
export type FxHistoryExportPart = { index: number; of: number; sequences: number[]; bars: number; runs: number };
/** A whole export in parts, planned from one snapshot; build(index) makes one part's document. */
export type FxHistoryExportSplit = { instrument: OandaFxInstrument; manifest_records: number; run_records: number; parts: FxHistoryExportPart[]; build(index: number): Promise<FxHistoryExport> };

/**
 * A whole export (every collection and every run of the instrument) in parts of at most maxPartBars bars each (default
 * 1,000,000; BACKLOG 103-10). Only one snapshot of the manifest, the run log and the page checkpoints
 * (readFxHistorySnapshot) is read here: the collections go whole, in manifest order, into consecutive parts, a part
 * closing when the next collection would take it over the limit (a single collection over it is refused), and each run
 * goes into the part holding its content. The total, at most maxBars (default 20,000,000), and the parts are fixed
 * before any raw page is read. build(index) rebuilds one part's collections from their raw pages and returns its
 * document: the whole export's header, the same totals in every part, then `part: { index, of }` and the part's
 * collections and runs. Parts are built one at a time, so only one part's bars need be held at once. Every part is
 * built from the snapshot's checkpoints, and the archive is addressed by hash, so every part reflects the same moment
 * and a part built again is the same.
 */
export async function splitFxHistoryExport(input: { instrument: OandaFxInstrument; maxPartBars?: number; maxBars?: number } & FxHistoryExportSources): Promise<FxHistoryExportSplit> {
  const { instrument, store, checkpoints: checkpointLog, runs, archive } = await readers(input);
  const maxPartBars = input.maxPartBars ?? FX_HISTORY_EXPORT_MAX_BARS, maxBars = input.maxBars ?? FX_HISTORY_EXPORT_SPLIT_MAX_BARS;
  for (const limit of [maxPartBars, maxBars]) if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("an export's bar limits must be positive integers");
  const { records, runRecords, checkpoints, where } = await readFxHistorySnapshot(instrument, store, runs, checkpointLog);
  if (!records.length) throw new Error(`no ${instrument} FX history collection is recorded${where}`);
  assertKnownHosts(records, store.path);
  const total = records.reduce((sum, record) => sum + record.bar_count, 0);
  if (total > maxBars) throw new Error(`the whole export would hold ${total} bars, more than ${maxBars}, the most an export in parts holds`);
  const groups: FxHistoricalManifest[][] = [];
  let bars = 0;
  for (const record of records) {
    if (record.bar_count > maxPartBars) throw new Error(`FX history collection ${record.sequence}${where} holds ${record.bar_count} bars, more than ${maxPartBars}, the most one part holds`);
    if (!groups.length || bars + record.bar_count > maxPartBars) { groups.push([]); bars = 0; }
    groups.at(-1)!.push(record);
    bars += record.bar_count;
  }
  const partOf = new Map(groups.flatMap((group, index) => group.map((record) => [record.normalized_sha256, index + 1] as const)));
  const parts = groups.map((group, index) => ({ index: index + 1, of: groups.length, sequences: group.map((record) => record.sequence),
    bars: group.reduce((sum, record) => sum + record.bar_count, 0), runs: runRecords.filter((run) => partOf.get(run.normalized_sha256) === index + 1).length }));
  const snapshot = { instrument, records, runRecords, manifestPath: store.path };
  return { instrument, manifest_records: records.length, run_records: runRecords.length, parts, build: async (index) => {
    const group = groups[index - 1];
    if (!Number.isSafeInteger(index) || group === undefined) throw new Error(`the export has parts 1 to ${groups.length}, not ${index}`);
    return exportDocument(snapshot, group, archive, checkpoints, { index, of: groups.length });
  } };
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
  const given = [input.store, input.checkpoints, input.runs].filter((port) => port !== undefined).length;
  if (given !== 0 && given !== 3) throw new Error("pass the FX history manifest store, its checkpoint store and its run log together");
  for (const [label, port] of [["manifest store", input.store], ["checkpoint store", input.checkpoints], ["run log", input.runs]] as const) {
    if (port && port.instrument !== instrument) throw new Error(`the FX history ${label} is for ${port.instrument}, not ${instrument}`);
  }
  if (input.store === undefined) await assertFxHistoryManifestBase();
  return { instrument, store: input.store ?? new FxHistoricalManifestStore(undefined, instrument), checkpoints: input.checkpoints ?? new FxHistoricalCheckpointStore(undefined, instrument),
    runs: input.runs ?? new FxHistoricalRunLog(undefined, instrument), archive: input.archive ?? new FxHistoricalArchive(resolveFxHistoricalArchivePath()) };
}
