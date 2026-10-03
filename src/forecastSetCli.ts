#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { ForecastSetStore, assertPlainForecastSetInput } from "./forecastSet.js";
import { ProxySetStore, buildProxySetForecastSet } from "./proxySet.js";
import { RealizedCovarianceJournalStore } from "./realizedCovarianceJournal.js";
import type { ZoneResolver } from "./zonedTime.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";

export interface ImportForecastSetDeps {
  store?: Pick<ForecastSetStore, "register">;
  /** The --proxy-set join only. The journal and store paths must match the MCP process's (design H5). */
  proxySets?: Pick<ProxySetStore, "get">;
  journal?: Pick<RealizedCovarianceJournalStore, "findByProxySetId">;
  resolver?: ZoneResolver;
}

/**
 * Plain mode registers a caller-built set. The --proxy-set mode joins the caller's forecasts to a verified
 * proxy set (docs/REALIZED_COVARIANCE_DESIGN.md, "Export and join") and is the only way to write a
 * `proxy-set:` source.
 */
export async function importForecastSet(args: string[], deps: ImportForecastSetDeps = {}) {
  const { values } = parseArgs({ args, options: {
    input: { type: "string" }, "confirm-local-import": { type: "boolean" }, "proxy-set": { type: "string" },
  }, strict: true, allowPositionals: false });
  if (!values.input || !values["confirm-local-import"]) throw new Error("--input and --confirm-local-import are required");
  const body = await readBacktestLedgerFile(values.input);
  let text: string;
  // Strict decoding: invalid UTF-8 is an error, not silently replaced by U+FFFD (external review nit).
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch { throw new Error("input is not valid UTF-8"); }
  const store = deps.store ?? new ForecastSetStore();
  if (values["proxy-set"] === undefined) return store.register(JSON.parse(text), { admit: assertPlainForecastSetInput });
  const joined = await buildProxySetForecastSet(values["proxy-set"], JSON.parse(text), {
    proxySets: deps.proxySets ?? new ProxySetStore(),
    journal: deps.journal ?? new RealizedCovarianceJournalStore(),
    resolver: deps.resolver,
  });
  return store.register(joined);
}

if (isCliEntrypoint(import.meta.url)) {
  importForecastSet(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
