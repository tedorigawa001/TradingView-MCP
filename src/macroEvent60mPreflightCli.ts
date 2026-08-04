import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { MACRO_EVENT_60M_CONTRACTS, type MacroEvent60mContractId } from "./macroEvent60mStudy.js";
import { preflightMacroEvent60mContract } from "./macroEvent60mPreflight.js";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import type { OfficialMacroEventArtifact } from "./officialMacroEventSources.js";

type Args = { aggregate: string; events: string; out: string; contractId: MacroEvent60mContractId; confirm: boolean };

export function parseMacroEvent60mPreflightCliArguments(argv: string[]): Args {
  let aggregate = ""; let events = ""; let out = ""; let confirm = false; let contractId: MacroEvent60mContractId = "macro_aftershock_v1";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--aggregate") aggregate = argv[++index] ?? "";
    else if (arg === "--events") events = argv[++index] ?? "";
    else if (arg === "--out") out = argv[++index] ?? "";
    else if (arg === "--contract") { const value = argv[++index]; if (!value || !(value in MACRO_EVENT_60M_CONTRACTS)) throw new Error("--contract must name a supported macro event contract"); contractId = value as MacroEvent60mContractId; }
    else if (arg === "--confirm-local-import") confirm = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!confirm || !aggregate || !events) throw new Error("macro event M60 preflight requires --aggregate, --events, and --confirm-local-import");
  return { aggregate, events, out: out || join(homedir(), ".tradingview-mcp", "macro-event-studies", `${basename(events, ".json")}_${contractId}_${basename(aggregate, ".json")}_preflight.json`), contractId, confirm };
}

async function main() {
  const args = parseMacroEvent60mPreflightCliArguments(process.argv.slice(2));
  const aggregate = JSON.parse(await readFile(args.aggregate, "utf8")) as { manifest: FxCsvM1AggregationManifest; bars: AggregatedBar[] };
  const artifact = JSON.parse(await readFile(args.events, "utf8")) as OfficialMacroEventArtifact;
  const result = preflightMacroEvent60mContract({ manifest: aggregate.manifest, bars: aggregate.bars, artifact, contractId: args.contractId });
  await mkdir(dirname(args.out), { recursive: true, mode: 0o700 });
  await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ contract_id: result.contract_id, event_kind: result.event_kind, potentially_evaluable_events: result.potentially_evaluable_events, output_path: args.out })}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`macro event M60 preflight failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
