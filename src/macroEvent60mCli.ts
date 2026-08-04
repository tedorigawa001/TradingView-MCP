import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { buildMacroEvent60mStudy, MACRO_EVENT_60M_CONTRACTS, type MacroEvent60mContractId } from "./macroEvent60mStudy.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { OfficialMacroEventArtifact } from "./officialMacroEventSources.js";

type Args = { aggregate: string; events: string; out: string; confirm: boolean; contractId: MacroEvent60mContractId };
const parse = (argv: string[]): Args => { let aggregate = ""; let events = ""; let out = ""; let confirm = false; let contractId: MacroEvent60mContractId = "macro_aftershock_v1"; for (let i = 0; i < argv.length; i += 1) { const arg = argv[i]; if (arg === "--aggregate") aggregate = argv[++i] ?? ""; else if (arg === "--events") events = argv[++i] ?? ""; else if (arg === "--out") out = argv[++i] ?? ""; else if (arg === "--contract") { const value = argv[++i]; if (!value || !(value in MACRO_EVENT_60M_CONTRACTS)) throw new Error("--contract must name a supported macro event contract"); contractId = value as MacroEvent60mContractId; } else if (arg === "--confirm-local-import") confirm = true; else throw new Error(`unknown argument ${arg}`); } if (!confirm || !aggregate || !events) throw new Error("macro event M60 study requires --aggregate, --events, and --confirm-local-import"); return { aggregate, events, out: out || join(homedir(), ".tradingview-mcp", "macro-event-studies", `${basename(events, ".json")}_${contractId}_${basename(aggregate, ".json")}.json`), confirm, contractId }; };

async function main() {
  const args = parse(process.argv.slice(2));
  const aggregate = JSON.parse(await readFile(args.aggregate, "utf8")) as { manifest: FxCsvM1AggregationManifest; bars: AggregatedBar[] };
  const artifact = JSON.parse(await readFile(args.events, "utf8")) as OfficialMacroEventArtifact;
  const finalBarEnd = aggregate.manifest.last_bar_at === null ? null : new Date(Date.parse(aggregate.manifest.last_bar_at) + 3_600_000).toISOString();
  if (finalBarEnd === null) throw new Error("macro event M60 aggregate has no final bar");
  const result = buildMacroEvent60mStudy({ manifest: aggregate.manifest, bars: aggregate.bars, artifact, folds: [
    { foldId: "is_2016_2020", from: "2016-01-01T00:00:00.000Z", to: "2021-01-01T00:00:00.000Z" },
    { foldId: "is_2021_to_loaded_end", from: "2021-01-01T00:00:00.000Z", to: finalBarEnd },
  ], contractId: args.contractId });
  await mkdir(dirname(args.out), { recursive: true, mode: 0o700 }); await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ contract_id: result.contract.contract_id, event_kind: result.event_kind, status: result.evaluation.status, events: result.result.sample.events, output_path: args.out })}\n`);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`macro event M60 study failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
