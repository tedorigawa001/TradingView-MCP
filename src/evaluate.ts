#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { AppendOnlyEvaluationLog } from "./evaluationLog.js";
import { EvaluationPipeline } from "./evaluationPipeline.js";
import { TreasuryRealYieldClient } from "./realYield.js";
import { RealYieldFirstSeenStore, resolveRealYieldHistoryPath } from "./realYieldHistory.js";

const USAGE = "usage: evaluate --log PATH --snapshot PATH [--features PATH] [--outcome PATH] [--as-of ISO_TIMESTAMP] [--real-yield-history PATH]";

export function parseEvaluateArgs(args: string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(USAGE);
    const name = key.slice(2);
    if (!["log", "snapshot", "features", "outcome", "as-of", "real-yield-history"].includes(name)) {
      throw new Error(`unknown option --${name}; ${USAGE}`);
    }
    if (values[name] !== undefined) throw new Error(`duplicate option --${name}`);
    values[name] = value;
  }
  if (!values.log || !values.snapshot) throw new Error("--log and --snapshot are required");
  return values;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must contain a JSON object`);
  return value;
}

export async function runEvaluate(args: string[]): Promise<void> {
  const options = parseEvaluateArgs(args);
  const snapshot = await readJson(options.snapshot);
  if (typeof snapshot.snapshot_id !== "string") throw new Error("snapshot JSON must contain snapshot_id");
  const asOf = options["as-of"] === undefined ? undefined : new Date(options["as-of"]);
  if (asOf && (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== options["as-of"])) {
    throw new Error("--as-of must be a canonical ISO-8601 timestamp");
  }
  const history = new RealYieldFirstSeenStore(resolveRealYieldHistoryPath(options["real-yield-history"]));
  const pipeline = new EvaluationPipeline(new AppendOnlyEvaluationLog(options.log), {
    realYield: new TreasuryRealYieldClient(undefined, undefined, history),
    asOf,
  });
  await pipeline.recordSnapshot(snapshot as Record<string, unknown> & { snapshot_id: string });
  if (options.features) await pipeline.recordFeatures(snapshot.snapshot_id, await readJson(options.features));
  if (options.outcome) await pipeline.recordOutcome(snapshot.snapshot_id, await readJson(options.outcome));
}

if (process.argv[1]?.endsWith("evaluate.js")) {
  runEvaluate(process.argv.slice(2)).catch((err) => { console.error(`evaluation CLI error: ${err.message}`); process.exitCode = 1; });
}
