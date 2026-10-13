#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { dailyFxHistoryRange, FxHistoricalRunLog } from "./fxHistoryRunLog.js";
import { collectOandaM15History, isOandaFxInstrument, OANDA_FX_INSTRUMENTS, type OandaFxInstrument, type OandaHistoricalRequest } from "./oandaHistoricalFx.js";

const DEFAULT_LOOKBACK_WEEKDAYS = 10;

export function parseFxHistoryDailyArguments(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: {
    instrument: { type: "string", multiple: true }, "lookback-weekdays": { type: "string" }, environment: { type: "string" }, "confirm-external-fetch": { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (!values["confirm-external-fetch"]) throw new Error("the daily FX history collection requires --confirm-external-fetch");
  const instruments = values.instrument ?? [];
  if (!instruments.length) throw new Error("name at least one --instrument");
  for (const instrument of instruments) if (!isOandaFxInstrument(instrument)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  if (new Set(instruments).size !== instruments.length) throw new Error("each --instrument may be named once");
  const lookback = values["lookback-weekdays"] ?? String(DEFAULT_LOOKBACK_WEEKDAYS);
  if (!/^[1-9][0-9]?$/.test(lookback) || Number(lookback) > 20) throw new Error("--lookback-weekdays must be an integer from 1 to 20");
  const environment = values.environment ?? "practice";
  if (environment !== "practice" && environment !== "live") throw new Error("environment must be practice or live");
  return { instruments: instruments as OandaFxInstrument[], lookbackWeekdays: Number(lookback), environment: environment as "practice" | "live" };
}

/**
 * One daily run (BACKLOG 103-5): the range from the start of the session `--lookback-weekdays` weekdays back (10 by
 * default) to the open of the last candle closed at least a minute ago (dailyFxHistoryRange), collected for each
 * instrument in turn and recorded in its run log with trigger "daily". An instrument that fails does not stop the others; the run then reports ok: false.
 */
export async function runFxHistoryDaily(argv: string[], env: Record<string, string | undefined> = process.env,
  deps: Pick<OandaHistoricalRequest, "fetch" | "now" | "sleep"> = {}) {
  const args = parseFxHistoryDailyArguments(argv);
  const accountId = env.OANDA_FX_HISTORY_ACCOUNT_ID;
  const token = env.OANDA_FX_HISTORY_ACCESS_TOKEN;
  if (!accountId || !token) throw new Error("set OANDA_FX_HISTORY_ACCOUNT_ID and OANDA_FX_HISTORY_ACCESS_TOKEN before collecting FX history");
  const range = dailyFxHistoryRange((deps.now ?? (() => new Date()))(), args.lookbackWeekdays);
  const results = [];
  for (const instrument of args.instruments) {
    try {
      const result = await collectOandaM15History({ ...deps, accountId, token, instrument, environment: args.environment, from: range.from, to: range.to,
        runs: new FxHistoricalRunLog(undefined, instrument), runTrigger: "daily" });
      results.push({ instrument, status: "collected" as const, bars: result.bars.length, normalized_sha256: result.normalized_sha256,
        manifest_recorded: result.manifest.recorded, run_sequence: result.run?.sequence ?? null, unfinished_pages: result.unfinished_pages });
    } catch (error) {
      results.push({ instrument, status: "failed" as const, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { requested_from: range.from, requested_to: range.to, sessions_covered: range.sessions_covered, lookback_weekdays: args.lookbackWeekdays,
    environment: args.environment, ok: results.every((result) => result.status === "collected"), results };
}

if (isCliEntrypoint(import.meta.url)) {
  runFxHistoryDaily(process.argv.slice(2)).then((summary) => { process.stdout.write(`${JSON.stringify(summary)}\n`); if (!summary.ok) process.exitCode = 1; })
    .catch((error: unknown) => { process.stderr.write(`daily FX history collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
