import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PRICE_ACTION_TRAP_REPRODUCTION_V1, runPriceActionTrapReproduction } from "./priceActionTrapReproduction.js";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { publishImmutableFile } from "./fsDurability.js";

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

/**
 * Runs the reproduction and publishes it as immutable evidence (BACKLOG 102-25): the file at the output path is never
 * replaced, and never left half-written. The study is deterministic, so a re-run on the same inputs produces the same
 * bytes and finds them already there (`written: false`); a run whose result differs is refused and the earlier file
 * kept. A reproduction of changed inputs goes to a new path with --out, or to the default once the earlier file has
 * been moved away. The study reads its inputs in the order given, which orders its ledger and the placebo pools its
 * seeded draws index into, so the aggregates are put in the contract's symbol order first: the same eight files give
 * the same bytes whatever order --aggregate names them in.
 */
export async function runPriceActionTrapReproductionCli(argv: string[]) {
  const args = parsePriceActionTrapReproductionCliArguments(argv);
  const inputs = await Promise.all(args.aggregatePaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as AggregateFile));
  // A file that names no contract symbol sorts first, and the study rejects it.
  const rank = (input: AggregateFile) => (PRICE_ACTION_TRAP_REPRODUCTION_V1.symbols as readonly string[]).indexOf(input?.manifest?.symbol);
  inputs.sort((left, right) => rank(left) - rank(right));
  const result = runPriceActionTrapReproduction(inputs);
  await mkdir(dirname(args.outputPath), { recursive: true, mode: 0o700 });
  const publication = await publishImmutableFile(args.outputPath, `${JSON.stringify(result, null, 2)}\n`, "price-action trap reproduction");
  if (publication === "different") {
    throw new Error(`${args.outputPath} already holds a different file, and reproduction evidence is never overwritten; this run's artifact_hash is ${result.artifact_hash}. Pass --out with a new path, or move the existing file away first`);
  }
  return {
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
    written: publication === "created",
  };
}

if (isCliEntrypoint(import.meta.url)) {
  runPriceActionTrapReproductionCli(process.argv.slice(2)).then((summary) => {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }).catch((error) => {
    process.stderr.write(`price-action trap reproduction failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
