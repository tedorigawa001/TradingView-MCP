#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { BAR_SERIES_MAX_BARS } from "./barSeries.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { ENTRY_RESERVED_SERIES_PREFIXES } from "./forecastSet.js";
import { publishImmutableFile } from "./fsDurability.js";
import { exportFxHistory, fxHistoryBarSeries, listFxHistoryCollections, type FxHistoryExportSources } from "./fxHistoryExport.js";
import { isOandaFxInstrument, OANDA_FX_INSTRUMENTS } from "./oandaHistoricalFx.js";

const TIERS = ["historical_exploration", "prospective", "synthetic_test"] as const;

/**
 * tradingview-mcp-export-fx-history (BACKLOG 103-6): writes recorded OANDA M15 collections, rebuilt from their raw pages
 * and verified against their manifest records, to a new file. `--list` prints the records instead. Every argument is
 * checked before any raw page is read. The output is never overwritten: the same bytes again is reported as identical,
 * other bytes there are refused.
 */
export async function runFxHistoryExport(args: string[], deps: FxHistoryExportSources = {}) {
  const { values } = parseArgs({ args, options: {
    instrument: { type: "string" }, sequence: { type: "string", multiple: true }, all: { type: "boolean" }, list: { type: "boolean" },
    format: { type: "string" }, "series-id": { type: "string" }, "evidence-tier": { type: "string" }, output: { type: "string" },
  }, strict: true, allowPositionals: false });
  const instrument = values.instrument;
  if (!isOandaFxInstrument(instrument)) throw new Error(`--instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  if (values.list) {
    if (values.sequence || values.all || values.format || values["series-id"] || values["evidence-tier"] || values.output) throw new Error("--list takes only --instrument");
    return { instrument, ...await listFxHistoryCollections({ instrument, ...deps }) };
  }
  const format = values.format ?? "collections";
  if (format !== "collections" && format !== "bar-series") throw new Error("--format must be collections or bar-series");
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
  const exported = await exportFxHistory({ instrument, sequences, all: values.all === true, ...(format === "bar-series" ? { maxBars: BAR_SERIES_MAX_BARS } : {}), ...deps });
  const body = format === "bar-series"
    ? `${JSON.stringify(fxHistoryBarSeries(exported.collections[0], { seriesId: seriesId!, evidenceTier: tier as (typeof TIERS)[number] }))}\n`
    : `${JSON.stringify(exported)}\n`;
  const result = await publishImmutableFile(values.output, body, "FX history export");
  if (result === "different") throw new Error(`a different file already exists at ${values.output}; nothing was written`);
  return {
    output: values.output, result, format, instrument, sha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    collections: exported.collections.map((collection) => ({ sequence: collection.sequence, bar_count: collection.bar_count, normalized_sha256: collection.normalized_sha256,
      range_checkpointed: collection.range_checkpointed })),
  };
}

if (isCliEntrypoint(import.meta.url)) {
  runFxHistoryExport(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => { process.stderr.write(`FX history export failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
