import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { MACRO_EVENT_RESPONSE_CONTRACT, runMacroEventResponseStudy } from "./macroEventResponse.js";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import type { OfficialMacroEventArtifact, OfficialMacroEventKind } from "./officialMacroEventSources.js";

type AggregateFile = { manifest: FxCsvM1AggregationManifest; bars: AggregatedBar[] };
export type MacroEventResponseCliArguments = {
  aggregatePaths: string[];
  eventPaths: string[];
  eventKind: OfficialMacroEventKind;
  outputPath: string;
};

const EVENT_KINDS = new Set<OfficialMacroEventKind>(["us_cpi", "us_nfp", "fomc_statement"]);

export function parseMacroEventResponseCliArguments(argv: string[]): MacroEventResponseCliArguments {
  const aggregatePaths: string[] = [];
  const eventPaths: string[] = [];
  let eventKind: OfficialMacroEventKind | undefined;
  let outputPath: string | undefined;
  let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--aggregate") aggregatePaths.push(argv[++index] ?? "");
    else if (argument === "--events") eventPaths.push(argv[++index] ?? "");
    else if (argument === "--event-kind") {
      const value = argv[++index];
      if (!value || !EVENT_KINDS.has(value as OfficialMacroEventKind)) {
        throw new Error("--event-kind must be us_cpi, us_nfp, or fomc_statement");
      }
      eventKind = value as OfficialMacroEventKind;
    } else if (argument === "--out") outputPath = argv[++index];
    else if (argument === "--confirm-local-import") confirmed = true;
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!confirmed) throw new Error("macro event M15 response study requires --confirm-local-import");
  if (aggregatePaths.some((path) => path.length === 0) || eventPaths.some((path) => path.length === 0)) {
    throw new Error("--aggregate and --events require a path");
  }
  const requiredAggregates = MACRO_EVENT_RESPONSE_CONTRACT.usd_direct_symbols.length +
    MACRO_EVENT_RESPONSE_CONTRACT.non_usd_cross_symbols.length + MACRO_EVENT_RESPONSE_CONTRACT.independent_symbols.length;
  if (aggregatePaths.length !== requiredAggregates) {
    throw new Error(`macro event M15 response study requires exactly ${requiredAggregates} --aggregate files`);
  }
  if (eventPaths.length !== MACRO_EVENT_RESPONSE_CONTRACT.guard_event_kinds.length) {
    throw new Error(`macro event M15 response study requires exactly ${MACRO_EVENT_RESPONSE_CONTRACT.guard_event_kinds.length} --events files`);
  }
  if (!eventKind) throw new Error("macro event M15 response study requires --event-kind");
  return {
    aggregatePaths,
    eventPaths,
    eventKind,
    outputPath: outputPath ?? join(homedir(), ".tradingview-mcp", "macro-event-studies", `${eventKind}_m15_response.json`),
  };
}

async function main(): Promise<void> {
  const args = parseMacroEventResponseCliArguments(process.argv.slice(2));
  const [series, artifacts] = await Promise.all([
    Promise.all(args.aggregatePaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as AggregateFile)),
    Promise.all(args.eventPaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as OfficialMacroEventArtifact)),
  ]);
  const result = runMacroEventResponseStudy({ series, artifacts, eventKind: args.eventKind });
  await mkdir(dirname(args.outputPath), { recursive: true, mode: 0o700 });
  await writeFile(args.outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ contract_id: result.contract.contract_id, contract_hash: result.contract_hash, event_kind: result.event_kind, status: result.status, events: result.source.valid_events, output_path: args.outputPath })}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`macro event M15 response study failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
