#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { BarSeriesStore } from "./barSeries.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";

export async function importBarSeries(args: string[], store = new BarSeriesStore()) {
  const { values } = parseArgs({ args, options: {
    input: { type: "string" }, "confirm-local-import": { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (!values.input || !values["confirm-local-import"]) throw new Error("--input and --confirm-local-import are required");
  const body = await readBacktestLedgerFile(values.input);
  let text: string;
  // Strict decoding: invalid UTF-8 is an error, not silently replaced by U+FFFD.
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch { throw new Error("input is not valid UTF-8"); }
  return store.register(JSON.parse(text));
}

if (isCliEntrypoint(import.meta.url)) {
  importBarSeries(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
