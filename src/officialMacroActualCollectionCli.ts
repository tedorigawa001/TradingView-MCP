import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { MacroSurpriseEvidenceStore, MacroSurpriseRawArchive, resolveMacroSurpriseEvidencePath, resolveMacroSurpriseRawArchivePath } from "./macroSurpriseEvidence.js";
import { collectOfficialMacroActuals } from "./officialMacroActualSources.js";
import type { OfficialMacroEvent, OfficialMacroEventArtifact } from "./officialMacroEventSources.js";

export function parseOfficialMacroActualCollectionCliArguments(argv: string[]) {
  const eventPaths: string[] = []; let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--events") eventPaths.push(argv[++index] ?? "");
    else if (argv[index] === "--confirm-external-fetch") confirmed = true;
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (!confirmed || eventPaths.length !== 3 || eventPaths.some((path) => !path)) throw new Error("official macro actual collection requires exactly three --events files and --confirm-external-fetch");
  return { eventPaths, confirmed };
}

async function main() {
  const args = parseOfficialMacroActualCollectionCliArguments(process.argv.slice(2));
  const artifacts = await Promise.all(args.eventPaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as OfficialMacroEventArtifact));
  const kinds = new Set(artifacts.map((artifact) => artifact.event_kind));
  if (kinds.size !== 3) throw new Error("official macro actual collection requires one artifact for each event kind");
  const byId = new Map<string, OfficialMacroEvent>();
  for (const event of artifacts.flatMap((artifact) => [...artifact.events, ...artifact.scheduled_future_releases])) byId.set(event.event_id, event);
  const result = await collectOfficialMacroActuals({ events: [...byId.values()], store: new MacroSurpriseEvidenceStore(resolveMacroSurpriseEvidencePath()), archive: new MacroSurpriseRawArchive(resolveMacroSurpriseRawArchivePath()) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`official macro actual collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
