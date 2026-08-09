import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runPriceActionTrapReproduction } from "./priceActionTrapReproduction.js";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";

type AggregateFile = { manifest: FxCsvM1AggregationManifest; bars: AggregatedBar[] };

export type PriceActionTrapReproductionCliArguments = { aggregatePaths: string[]; outputPath: string };

export function parsePriceActionTrapReproductionCliArguments(argv: string[]): PriceActionTrapReproductionCliArguments {
  const aggregatePaths: string[] = [];
  let outputPath: string | undefined;
  let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--aggregate") aggregatePaths.push(argv[++index] ?? "");
    else if (argument === "--out") outputPath = argv[++index];
    else if (argument === "--confirm-local-import") confirmed = true;
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!confirmed) throw new Error("price-action trap reproduction requires --confirm-local-import");
  if (aggregatePaths.length !== 8 || aggregatePaths.some((path) => path.length === 0)) {
    throw new Error("price-action trap reproduction requires exactly eight --aggregate files");
  }
  return {
    aggregatePaths,
    outputPath: outputPath ?? join(homedir(), ".tradingview-mcp", "price-action-reproductions", "four-bar-trap-v1.json"),
  };
}

async function main(): Promise<void> {
  const args = parsePriceActionTrapReproductionCliArguments(process.argv.slice(2));
  const inputs = await Promise.all(args.aggregatePaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as AggregateFile));
  const result = runPriceActionTrapReproduction(inputs);
  await mkdir(dirname(args.outputPath), { recursive: true, mode: 0o700 });
  await writeFile(args.outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    contract_hash: result.contract_hash,
    artifact_hash: result.artifact_hash,
    events: result.event_ledger.length,
    primary: {
      draws: result.empirical_null.draws,
      observed_bps: result.empirical_null.observed_bps,
      null_median_bps: result.empirical_null.null_median_bps,
      null_95th_percentile_bps: result.empirical_null.null_95th_percentile_bps,
      p_value: result.empirical_null.p_value,
    },
    output_path: args.outputPath,
  })}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`price-action trap reproduction failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
