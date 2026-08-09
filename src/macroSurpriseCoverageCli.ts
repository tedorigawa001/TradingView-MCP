import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { MacroSurpriseEvidenceStore, resolveMacroSurpriseEvidencePath } from "./macroSurpriseEvidence.js";
import { assessMacroSurpriseCoverage } from "./macroSurpriseCoverage.js";
import type { OfficialMacroEventArtifact } from "./officialMacroEventSources.js";

export function parseMacroSurpriseCoverageCliArguments(argv: string[]) {
  const eventPaths: string[] = []; let out = ""; let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--events") eventPaths.push(argv[++index] ?? "");
    else if (argv[index] === "--out") out = argv[++index] ?? "";
    else if (argv[index] === "--confirm-local-import") confirmed = true;
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (!confirmed || eventPaths.length !== 3 || eventPaths.some((path) => !path)) throw new Error("macro-surprise coverage requires exactly three --events files and --confirm-local-import");
  return { eventPaths, out: out || join(homedir(), ".tradingview-mcp", "macro-surprise-coverage.json"), confirmed };
}

async function main() {
  const args = parseMacroSurpriseCoverageCliArguments(process.argv.slice(2));
  const artifacts = await Promise.all(args.eventPaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as OfficialMacroEventArtifact));
  const store = new MacroSurpriseEvidenceStore(resolveMacroSurpriseEvidencePath());
  const result = assessMacroSurpriseCoverage({ artifacts, records: await store.list(), asOf: new Date() });
  await mkdir(dirname(args.out), { recursive: true, mode: 0o700 });
  await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ readiness: result.readiness, eligible_events: result.eligible_events, missing_forward_consensus: result.missing_forward_consensus, missing_forward_actual: result.missing_forward_actual, output_path: args.out })}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`macro-surprise coverage failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
