import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { aggregateFxCsvM1, type AggregatedBar, type FxCsvM1AggregationResult } from "./fxCsvM1Aggregation.js";
import { canonicalDefinitionHash } from "./canonicalDefinition.js";

export type FxCsvM1AggregationCliArguments = {
  csvPath: string;
  symbol: string;
  bucketMinutes: number;
  startFromBrokerDate: string;
  minimumMinuteCoverage: number;
  outputPath: string;
};

export const resolveFxCsvAggregateDirectory = (configured = process.env.TRADINGVIEW_MCP_FX_CSV_AGGREGATE_DIR) =>
  configured?.trim() || join(homedir(), ".tradingview-mcp", "fx-csv-aggregates");

export function parseFxCsvM1AggregationCliArguments(argv: string[]): FxCsvM1AggregationCliArguments {
  let csvPath: string | undefined;
  let symbol: string | undefined;
  let bucketMinutes = 15;
  let startFromBrokerDate: string | undefined;
  let minimumMinuteCoverage = 1;
  let outputPath: string | undefined;
  let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--csv") csvPath = argv[++index];
    else if (arg === "--symbol") symbol = argv[++index];
    else if (arg === "--bucket-minutes") bucketMinutes = Number(argv[++index]);
    else if (arg === "--start-from-broker-date") startFromBrokerDate = argv[++index];
    else if (arg === "--minimum-minute-coverage") minimumMinuteCoverage = Number(argv[++index]);
    else if (arg === "--out") outputPath = argv[++index];
    else if (arg === "--confirm-local-import") confirmed = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!confirmed) throw new Error("FX CSV aggregation requires --confirm-local-import");
  if (!csvPath || !symbol) throw new Error("FX CSV aggregation requires --csv and --symbol");
  if (!/^[\w:.-]{1,48}$/.test(symbol)) throw new Error("symbol must be a short canonical identifier");
  // The supplied file changed its clock convention mid-history, so the boundary is never defaulted.
  if (!startFromBrokerDate) throw new Error("FX CSV aggregation requires --start-from-broker-date");
  return {
    csvPath, symbol, bucketMinutes, startFromBrokerDate, minimumMinuteCoverage,
    outputPath: outputPath ?? join(resolveFxCsvAggregateDirectory(), `${symbol.replace(/[^\w.-]/g, "_")}_M${bucketMinutes}.json`),
  };
}

export type FxCsvM1AggregationManifest = {
  schema_version: "1.0";
  series: "fx_csv_m1_aggregate";
  evidence_tier: "official_revised_history";
  symbol: string;
  bucket_minutes: number;
  start_from_broker_date: string;
  minimum_minute_coverage: number;
  broker_clock_rule: "new_york_wall_time_plus_seven_hours";
  source_file: string;
  source_bytes: number;
  /** Hash of the file as supplied, so a later edit to it cannot pass unnoticed. */
  source_sha256: string;
  normalized_sha256: string;
  definition_hash: string;
  aggregated_at: string;
  bar_count: number;
  first_bar_at: string | null;
  last_bar_at: string | null;
  quality: FxCsvM1AggregationResult["quality"];
  quality_issues: string[];
  limitations: string[];
};

export async function aggregateFxCsvFile(input: FxCsvM1AggregationCliArguments, now = () => new Date()) {
  const sourceHash = createHash("sha256");
  let sourceBytes = 0;
  const lines: string[] = [];
  const stream = createReadStream(input.csvPath);
  stream.on("data", (chunk) => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    sourceBytes += bytes.byteLength;
    sourceHash.update(bytes);
  });
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) lines.push(line);
  const result = aggregateFxCsvM1({
    lines,
    bucketMinutes: input.bucketMinutes,
    startFromBrokerDate: input.startFromBrokerDate,
    minimumMinuteCoverage: input.minimumMinuteCoverage,
  });
  const definition = {
    symbol: input.symbol,
    bucketMinutes: input.bucketMinutes,
    startFromBrokerDate: input.startFromBrokerDate,
    minimumMinuteCoverage: input.minimumMinuteCoverage,
    methodologyVersion: result.methodologyVersion,
    brokerClockRule: result.brokerClockRule,
    sourceSha256: `sha256:${sourceHash.copy().digest("hex")}`,
  };
  const manifest: FxCsvM1AggregationManifest = {
    schema_version: "1.0",
    series: "fx_csv_m1_aggregate",
    evidence_tier: "official_revised_history",
    symbol: input.symbol,
    bucket_minutes: input.bucketMinutes,
    start_from_broker_date: input.startFromBrokerDate,
    minimum_minute_coverage: input.minimumMinuteCoverage,
    broker_clock_rule: result.brokerClockRule,
    source_file: basename(input.csvPath),
    source_bytes: sourceBytes,
    source_sha256: `sha256:${sourceHash.digest("hex")}`,
    normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(result.bars), "utf8").digest("hex")}`,
    definition_hash: canonicalDefinitionHash(definition),
    aggregated_at: now().toISOString(),
    bar_count: result.bars.length,
    first_bar_at: result.bars[0]?.timeIso ?? null,
    last_bar_at: result.bars.at(-1)?.timeIso ?? null,
    quality: result.quality,
    quality_issues: result.qualityIssues,
    limitations: [
      "Third-party revised history. It cannot support prospective, out-of-sample, or primary-test evidence.",
      "The broker clock was verified as New York plus seven from this file's own Friday close times, and the aggregate was checked bar for bar against TradingView over an overlapping span.",
      "Rows before start_from_broker_date are refused because this file ran on a different clock earlier in its history.",
      "Volume is upstream tick count, not traded size.",
      "Bars stamped at the New York close carry the widest disagreement with other sources, where liquidity is thinnest.",
    ],
  };
  return { manifest, bars: result.bars };
}

async function writeOutputs(outputPath: string, manifest: FxCsvM1AggregationManifest, bars: AggregatedBar[]) {
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, JSON.stringify({ manifest, bars }), { mode: 0o600 });
  await writeFile(`${outputPath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const args = parseFxCsvM1AggregationCliArguments(process.argv.slice(2));
  const { manifest, bars } = await aggregateFxCsvFile(args);
  await writeOutputs(args.outputPath, manifest, bars);
  process.stdout.write(`${JSON.stringify({ ...manifest, output_path: args.outputPath })}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`FX CSV aggregation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
