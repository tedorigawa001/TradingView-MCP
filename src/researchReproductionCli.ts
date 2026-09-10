#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { lstat, mkdtemp, link, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { openExclusiveFile, syncDirectoryEntry } from "./fsDurability.js";
import { reproduceResearch } from "./researchReproduction.js";

export async function runResearchReproductionCli(args: string[]) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    input: { type: "string" }, output: { type: "string" }, "confirm-local-read": { type: "boolean" },
  } });
  if (!values.input || !values["confirm-local-read"] || !values.output || !isAbsolute(values.output)) {
    throw new Error("explicit input, output and local read confirmation required");
  }
  const parent = await lstat(dirname(values.output));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("invalid output directory");
  const report = await reproduceResearch(JSON.parse((await readBacktestLedgerFile(values.input)).toString("utf8")));
  const temporary = await mkdtemp(join(dirname(values.output), ".reproduction-"));
  try {
    const staged = join(temporary, "report.json");
    const handle = await openExclusiveFile(staged, "reproduction report");
    try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    // Publish only complete bytes; link fails if the final name already exists.
    await link(staged, values.output);
    await syncDirectoryEntry(dirname(values.output));
  } finally { await rm(temporary, {recursive: true, force: true}); }
  return { written: true, status: report.status, actual_result_sha256: report.actual_result_sha256 };
}

function entrypoint() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (entrypoint()) {
  runResearchReproductionCli(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify(result));
    if (result.status === "mismatch") process.exitCode = 2;
  }).catch(() => {
    console.error("research reproduction failed; input or output could not be verified (details withheld)");
    process.exitCode = 1;
  });
}
