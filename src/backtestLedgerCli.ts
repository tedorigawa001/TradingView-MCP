#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { BacktestLedgerStore, readBacktestLedgerFile } from "./backtestLedger.js";

export async function importBacktestLedger(args: string[]) {
  const { values } = parseArgs({ args, options: {
    input: { type: "string" }, "confirm-local-import": { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (!values.input || !values["confirm-local-import"]) throw new Error("--input and --confirm-local-import are required");
  const body = await readBacktestLedgerFile(values.input);
  return new BacktestLedgerStore().register(JSON.parse(body.toString("utf8")));
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isEntrypoint()) {
  importBacktestLedger(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
