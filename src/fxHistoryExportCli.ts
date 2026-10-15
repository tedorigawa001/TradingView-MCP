#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { BAR_SERIES_MAX_BARS } from "./barSeries.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { ENTRY_RESERVED_SERIES_PREFIXES } from "./forecastSet.js";
import { publishImmutableFile, publishImmutableFiles } from "./fsDurability.js";
import { exportFxHistory, fxHistoryBarSeries, listFxHistoryCollections, splitFxHistoryExport, type FxHistoryExportSources, type FxHistoryExportSplit } from "./fxHistoryExport.js";
import { isOandaFxInstrument, OANDA_FX_INSTRUMENTS } from "./oandaHistoricalFx.js";

const TIERS = ["historical_exploration", "prospective", "synthetic_test"] as const;
const digest = (body: string) => `sha256:${createHash("sha256").update(body).digest("hex")}`;

/**
 * The files of a whole export in parts (BACKLOG 103-10): `<output without .json>.part01.json`, `.part02.json`, …, in
 * two digits, or as many as the number of parts needs.
 */
export function fxHistoryExportPartPaths(output: string, count: number): string[] {
  const stem = output.endsWith(".json") ? output.slice(0, -".json".length) : output;
  const width = Math.max(2, String(count).length);
  return Array.from({ length: count }, (_, index) => `${stem}.part${String(index + 1).padStart(width, "0")}.json`);
}

/** One part's bytes and what its collections are, built from its raw pages; the part's bars are dropped on return. */
async function partBody(split: FxHistoryExportSplit, index: number) {
  const document = await split.build(index);
  return { body: `${JSON.stringify(document)}\n`, collections: document.collections.map((collection) => ({ sequence: collection.sequence, bar_count: collection.bar_count,
    normalized_sha256: collection.normalized_sha256, range_checkpointed: collection.range_checkpointed, part: index })) };
}

/**
 * Writes a whole export in parts (BACKLOG 103-10) to fxHistoryExportPartPaths(output), all of them or none
 * (publishImmutableFiles). A directory or a symbolic link at a part's path refuses the export before any raw page is
 * read. Each part is then built in turn, so only one part's bars are held at once: a part whose file already exists is
 * compared with it, any other is written to a synced staging file beside it. A part that fails to build, or a file with
 * other bytes, removes the staging files and writes nothing. Only when every part is staged or found identical are the
 * staged parts linked into place: each part is created, or identical when its file already held it.
 */
export async function writeFxHistoryExportParts(split: FxHistoryExportSplit, output: string) {
  const paths = fxHistoryExportPartPaths(output, split.parts.length);
  for (const path of paths) {
    const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (entry?.isDirectory()) throw new Error(`a part of the export would replace a directory: ${path}; nothing was written`);
    if (entry?.isSymbolicLink()) throw new Error(`a part of the export would replace a symbolic link: ${path}; nothing was written`);
  }
  const digests: string[] = [], collections: Awaited<ReturnType<typeof partBody>>["collections"][] = [];
  const published = await publishImmutableFiles(paths, async (index) => {
    const built = await partBody(split, index + 1);
    digests[index] = digest(built.body);
    collections[index] = built.collections;
    return built.body;
  }, "FX history export");
  if (!published.published) throw new Error(`a different file already exists at ${published.different.join(", ")}; nothing was written`);
  return {
    parts: split.parts.map((part, index) => ({ index: part.index, output: paths[index], result: published.results[index], sha256: digests[index],
      collections: part.sequences.length, runs: part.runs, bars: part.bars })),
    collections: collections.flat(),
  };
}

/**
 * tradingview-mcp-export-fx-history (BACKLOG 103-6): writes recorded OANDA M15 collections, rebuilt from their raw pages
 * and verified against their manifest records, to a new file. `--list` prints the records instead. With `--all
 * --split`, a whole export goes into as many parts of at most 1,000,000 bars as it needs (BACKLOG 103-10). Every argument
 * is checked before any raw page is read. The output is never overwritten: the same bytes again is reported as
 * identical, other bytes there are refused.
 */
export async function runFxHistoryExport(args: string[], deps: FxHistoryExportSources = {}) {
  const { values } = parseArgs({ args, options: {
    instrument: { type: "string" }, sequence: { type: "string", multiple: true }, all: { type: "boolean" }, list: { type: "boolean" },
    format: { type: "string" }, "series-id": { type: "string" }, "evidence-tier": { type: "string" }, output: { type: "string" }, split: { type: "boolean" },
  }, strict: true, allowPositionals: false });
  const instrument = values.instrument;
  if (!isOandaFxInstrument(instrument)) throw new Error(`--instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  if (values.list) {
    if (values.sequence || values.all || values.format || values["series-id"] || values["evidence-tier"] || values.output || values.split) throw new Error("--list takes only --instrument");
    return { instrument, ...await listFxHistoryCollections({ instrument, ...deps }) };
  }
  const format = values.format ?? "collections";
  if (format !== "collections" && format !== "bar-series") throw new Error("--format must be collections or bar-series");
  if (values.split && (!values.all || values.sequence || format !== "collections")) throw new Error("--split goes only with --all and --format collections: it splits a whole export");
  if (!values.output) throw new Error("--output is required");
  const sequences = (values.sequence ?? []).map((value) => { if (!/^[1-9][0-9]{0,15}$/.test(value)) throw new Error("--sequence must be a positive integer"); return Number(value); });
  const seriesId = values["series-id"], tier = values["evidence-tier"];
  if (format === "bar-series") {
    if (values.all || sequences.length !== 1) throw new Error("--format bar-series exports exactly one collection: name it with one --sequence");
    if (!seriesId || !TIERS.includes(tier as (typeof TIERS)[number])) throw new Error(`--format bar-series requires --series-id and --evidence-tier (${TIERS.join(", ")})`);
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(seriesId) || ENTRY_RESERVED_SERIES_PREFIXES.some((prefix) => seriesId.startsWith(prefix))) throw new Error("--series-id must be 1-120 of A-Z a-z 0-9 _ . : - and must not use a reserved prefix");
  } else if (seriesId || tier) throw new Error("--series-id and --evidence-tier belong to --format bar-series");
  const parent = await lstat(dirname(values.output)).catch(() => null);
  if (!parent?.isDirectory()) throw new Error(`--output must be in an existing directory: ${values.output}`);
  if ((await lstat(values.output).catch(() => null))?.isDirectory()) throw new Error(`--output names a directory: ${values.output}`);
  if (values.split) {
    // One snapshot, its parts fixed and the 20,000,000-bar total checked before any raw page is read.
    const split = await splitFxHistoryExport({ instrument, ...deps });
    const { parts, collections } = await writeFxHistoryExportParts(split, values.output);
    return { format, split: true, instrument, manifest_records: split.manifest_records, run_records: split.run_records,
      runs: parts.reduce((sum, part) => sum + part.runs, 0), parts, collections };
  }
  const exported = await exportFxHistory({ instrument, sequences, all: values.all === true, ...(format === "bar-series" ? { maxBars: BAR_SERIES_MAX_BARS } : {}), ...deps });
  const body = format === "bar-series"
    ? `${JSON.stringify(fxHistoryBarSeries(exported.collections[0], { seriesId: seriesId!, evidenceTier: tier as (typeof TIERS)[number] }))}\n`
    : `${JSON.stringify(exported)}\n`;
  const result = await publishImmutableFile(values.output, body, "FX history export");
  if (result === "different") throw new Error(`a different file already exists at ${values.output}; nothing was written`);
  return {
    output: values.output, result, format, instrument, sha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    // The totals the export read (BACKLOG 103-9): a collections export is whole when it holds as many collections and runs.
    manifest_records: exported.manifest_records, run_records: exported.run_records, runs: exported.runs.length,
    collections: exported.collections.map((collection) => ({ sequence: collection.sequence, bar_count: collection.bar_count, normalized_sha256: collection.normalized_sha256,
      range_checkpointed: collection.range_checkpointed })),
  };
}

if (isCliEntrypoint(import.meta.url)) {
  runFxHistoryExport(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => { process.stderr.write(`FX history export failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
