#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { ForecastSetStore } from "./forecastSet.js";

export async function importForecastSet(args: string[], store = new ForecastSetStore()) {
  const { values } = parseArgs({ args, options: {
    input: { type: "string" }, "confirm-local-import": { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (!values.input || !values["confirm-local-import"]) throw new Error("--input and --confirm-local-import are required");
  const body = await readBacktestLedgerFile(values.input);
  let text: string;
  // Strict decoding: invalid UTF-8 is an error, not silently replaced by U+FFFD (external review nit).
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch { throw new Error("input is not valid UTF-8"); }
  return store.register(JSON.parse(text));
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isEntrypoint()) {
  importForecastSet(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
