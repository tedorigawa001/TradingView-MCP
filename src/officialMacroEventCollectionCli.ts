import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { collectOfficialMacroEvents, writeOfficialMacroEventArtifact, type OfficialMacroEventKind } from "./officialMacroEventSources.js";

function parse(argv: string[]) {
  let kind: OfficialMacroEventKind | undefined; let fromYear = 2016; let toYear = new Date().getUTCFullYear(); let out: string | undefined; let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) { const arg = argv[index]; if (arg === "--kind") kind = argv[++index] as OfficialMacroEventKind; else if (arg === "--from-year") fromYear = Number(argv[++index]); else if (arg === "--to-year") toYear = Number(argv[++index]); else if (arg === "--out") out = argv[++index]; else if (arg === "--confirm-external-fetch") confirmed = true; else throw new Error(`unknown argument ${arg}`); }
  if (!confirmed || !kind || !["us_cpi", "us_nfp", "fomc_statement"].includes(kind)) throw new Error("official macro collection requires --kind us_cpi|us_nfp|fomc_statement and --confirm-external-fetch");
  return { kind, fromYear, toYear, out: out ?? join(homedir(), ".tradingview-mcp", "official-macro-events", `${kind}_${fromYear}_${toYear}.json`) };
}

async function main() { const args = parse(process.argv.slice(2)); const artifact = await collectOfficialMacroEvents(args); await writeOfficialMacroEventArtifact(args.out, artifact); process.stdout.write(`${JSON.stringify({ event_kind: artifact.event_kind, events: artifact.events.length, output_path: args.out })}\n`); }
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`official macro event collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
