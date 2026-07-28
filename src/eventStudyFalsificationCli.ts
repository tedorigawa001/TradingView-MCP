import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  runStandardEventStudyFalsificationAudit,
  type StandardEventStudyFalsificationAuditInput,
} from "./eventStudyFalsificationAudit.js";
import type { SyntheticNullModel } from "./syntheticNullSeries.js";

const MODELS = new Set<SyntheticNullModel>(["white_noise", "regime_switching_volatility", "bid_ask_bounce"]);

export type EventStudyFalsificationCliArguments = {
  configPath: string;
  models: SyntheticNullModel[] | null;
  replications: number | null;
  bars: number | null;
};

function positiveInteger(value: string | undefined, name: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

export function parseEventStudyFalsificationCliArguments(argv: string[]): EventStudyFalsificationCliArguments {
  let configPath: string | null = null;
  const models: SyntheticNullModel[] = [];
  let replications: number | null = null;
  let bars: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--config") {
      configPath = argv[++index] ?? "";
      if (!configPath) throw new Error("--config requires a JSON file path");
    } else if (value === "--model") {
      const model = argv[++index] as SyntheticNullModel | undefined;
      if (model === undefined || !MODELS.has(model)) throw new Error("--model must be white_noise, regime_switching_volatility, or bid_ask_bounce");
      models.push(model);
    } else if (value === "--replications") {
      replications = positiveInteger(argv[++index], "--replications", 2000);
    } else if (value === "--bars") {
      bars = positiveInteger(argv[++index], "--bars", 50_000);
    } else throw new Error(`unknown argument: ${value}`);
  }
  if (configPath === null) throw new Error("--config is required");
  if (new Set(models).size !== models.length) throw new Error("--model must not be repeated");
  return { configPath, models: models.length === 0 ? null : models, replications, bars };
}

function parseConfig(value: string): StandardEventStudyFalsificationAuditInput {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("falsification audit config must be valid JSON"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("falsification audit config must be a JSON object");
  }
  return parsed as StandardEventStudyFalsificationAuditInput;
}

async function main(): Promise<void> {
  const args = parseEventStudyFalsificationCliArguments(process.argv.slice(2));
  const config = parseConfig(await readFile(args.configPath, "utf8"));
  const result = runStandardEventStudyFalsificationAudit({
    ...config,
    ...(args.models === null ? {} : { models: args.models }),
    ...(args.replications === null ? {} : { replications: args.replications }),
    ...(args.bars === null ? {} : { bars: args.bars }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.runs.some((run) => run.audit.status !== "complete")) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`event-study falsification audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
