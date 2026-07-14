#!/usr/bin/env node
import { AppendOnlyEvaluationLog } from "./evaluationLog.js";
import { buildWalkForwardReport } from "./walkForwardReport.js";

export async function runWalkForward(logPath: string) {
  const records = await new AppendOnlyEvaluationLog(logPath).readAll();
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const record of records.filter((record) => record.kind === "outcome")) {
    const id = typeof record.payload.fold_id === "string" ? record.payload.fold_id : "unassigned";
    groups.set(id, [...(groups.get(id) ?? []), record.payload]);
  }
  const folds = [...groups.entries()].map(([id, outcomes]) => {
    const labels = outcomes.filter((value) => typeof value.predicted === "string" && typeof value.actual === "string").map((value) => ({ predicted: value.predicted as string, actual: value.actual as string }));
    const probabilities = outcomes.filter((value) => typeof value.probability === "number" && typeof value.outcome === "boolean").map((value) => ({ probability: value.probability as number, outcome: value.outcome as boolean }));
    return { id, labels, ...(probabilities.length ? { probabilities } : {}) };
  }).filter((fold) => fold.labels.length > 0);
  if (folds.length === 0) throw new Error("no outcome payloads with predicted and actual labels found");
  return buildWalkForwardReport(folds);
}

if (process.argv[1]?.endsWith("walkForwardCli.js")) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: walkForwardCli LOG_PATH");
  runWalkForward(path).then((report) => console.log(JSON.stringify(report, null, 2))).catch((err) => { console.error(`walk-forward CLI error: ${err.message}`); process.exitCode = 1; });
}
