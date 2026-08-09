import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { MacroSurpriseEvidenceStore, MacroSurpriseRawArchive, resolveMacroSurpriseEvidencePath, resolveMacroSurpriseRawArchivePath } from "./macroSurpriseEvidence.js";
import { collectTradingEconomicsMacroConsensus, validateTradingEconomicsMacroConsensusMappings, type TradingEconomicsMacroConsensusMapping } from "./tradingEconomicsMacroConsensus.js";
import type { OfficialMacroEventArtifact } from "./officialMacroEventSources.js";

type Config = { schema_version: "1.0"; provider: "trading_economics_calendar"; mappings: TradingEconomicsMacroConsensusMapping[] };

export function parseTradingEconomicsMacroConsensusCliArguments(argv: string[]) {
  const eventPaths: string[] = []; let mappingPath: string | undefined; let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--events") eventPaths.push(argv[++index] ?? "");
    else if (arg === "--mapping") mappingPath = argv[++index];
    else if (arg === "--confirm-external-fetch") confirmed = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!confirmed || !mappingPath || eventPaths.length !== 3 || eventPaths.some((value) => !value)) {
    throw new Error("Trading Economics macro-consensus collection requires exactly three --events files, --mapping, and --confirm-external-fetch");
  }
  return { eventPaths, mappingPath, confirmed };
}

function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Trading Economics macro-consensus mapping config is invalid");
  const config = value as Partial<Config>;
  if (config.schema_version !== "1.0" || config.provider !== "trading_economics_calendar" || !Array.isArray(config.mappings)) throw new Error("Trading Economics macro-consensus mapping config is invalid");
  validateTradingEconomicsMacroConsensusMappings(config.mappings);
  return config as Config;
}

async function main() {
  const args = parseTradingEconomicsMacroConsensusCliArguments(process.argv.slice(2));
  const apiKey = process.env.TRADINGVIEW_MCP_TRADING_ECONOMICS_API_KEY;
  if (!apiKey?.trim()) throw new Error("TRADINGVIEW_MCP_TRADING_ECONOMICS_API_KEY is not configured");
  const [configRaw, ...artifactRaw] = await Promise.all([readFile(args.mappingPath, "utf8"), ...args.eventPaths.map((path) => readFile(path, "utf8"))]);
  const config = parseConfig(JSON.parse(configRaw));
  const artifacts = artifactRaw.map((raw) => JSON.parse(raw) as OfficialMacroEventArtifact);
  const eventKinds = new Set(artifacts.map((artifact) => artifact.event_kind));
  if (eventKinds.size !== 3 || artifacts.some((artifact) => !Array.isArray(artifact.scheduled_future_releases))) throw new Error("macro-consensus collection requires one official event artifact for each event kind");
  const result = await collectTradingEconomicsMacroConsensus({ apiKey, mappings: config.mappings, events: artifacts.flatMap((artifact) => artifact.scheduled_future_releases), store: new MacroSurpriseEvidenceStore(resolveMacroSurpriseEvidencePath()), archive: new MacroSurpriseRawArchive(resolveMacroSurpriseRawArchivePath()) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`Trading Economics macro-consensus collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
