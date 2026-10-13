#!/usr/bin/env node
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { publishImmutableFile } from "./fsDurability.js";
import { exportFxHistory, fxHistoryBarSeries, listFxHistoryCollections, type FxHistoryExportSources } from "./fxHistoryExport.js";
import { isOandaFxInstrument, OANDA_FX_INSTRUMENTS } from "./oandaHistoricalFx.js";

const TIERS = ["historical_exploration", "prospective", "synthetic_test"] as const;

/**
 * tradingview-mcp-export-fx-history (BACKLOG 103-6): writes recorded OANDA M15 collections, rebuilt from their raw pages
 * and verified against their manifest records, to a new file. `--list` prints the records instead. The output is never
 * overwritten: the same bytes again is reported as identical, other bytes there are refused.
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
    return { instrument, collections: await listFxHistoryCollections({ instrument, ...deps }) };
  }
  const format = values.format ?? "collections";
  if (format !== "collections" && format !== "bar-series") throw new Error("--format must be collections or bar-series");
  if (!values.output) throw new Error("--output is required");
  const sequences = (values.sequence ?? []).map((value) => { if (!/^[1-9][0-9]{0,15}$/.test(value)) throw new Error("--sequence must be a positive integer"); return Number(value); });
  let body: string;
  const exported = await exportFxHistory({ instrument, sequences, all: values.all === true, ...deps });
  if (format === "bar-series") {
    if (exported.collections.length !== 1) throw new Error("--format bar-series exports exactly one collection");
    const tier = values["evidence-tier"];
    if (!values["series-id"] || !TIERS.includes(tier as (typeof TIERS)[number])) throw new Error(`--format bar-series requires --series-id and --evidence-tier (${TIERS.join(", ")})`);
    body = `${JSON.stringify(fxHistoryBarSeries(exported.collections[0], { seriesId: values["series-id"], evidenceTier: tier as (typeof TIERS)[number] }))}\n`;
  } else {
    if (values["series-id"] || values["evidence-tier"]) throw new Error("--series-id and --evidence-tier belong to --format bar-series");
    body = `${JSON.stringify(exported)}\n`;
  }
  const result = await publishImmutableFile(values.output, body, "FX history export");
  if (result === "different") throw new Error(`a different file already exists at ${values.output}; nothing was written`);
  return {
    output: values.output, result, format, instrument, sha256: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    collections: exported.collections.map((collection) => ({ sequence: collection.sequence, bar_count: collection.bar_count, normalized_sha256: collection.normalized_sha256 })),
  };
}

if (isCliEntrypoint(import.meta.url)) {
  runFxHistoryExport(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => { process.stderr.write(`FX history export failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
