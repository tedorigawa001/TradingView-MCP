import { collectOandaM15History, isOandaFxInstrument, OANDA_FX_INSTRUMENTS, type OandaFxInstrument, type OandaHistoricalRequest } from "./oandaHistoricalFx.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";

export function parseFxHistoryCollectionCliArguments(argv: string[]) {
  let from: string | undefined; let to: string | undefined; let confirmed = false; let environment: "practice" | "live" = "practice";
  let instrument: OandaFxInstrument = "EUR_USD";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") from = argv[++index];
    else if (arg === "--to") to = argv[++index];
    else if (arg === "--environment") { const value = argv[++index]; if (value !== "practice" && value !== "live") throw new Error("environment must be practice or live"); environment = value; }
    else if (arg === "--instrument") { const value = argv[++index]; if (!isOandaFxInstrument(value)) throw new Error(`instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`); instrument = value; }
    else if (arg === "--confirm-external-fetch") confirmed = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!confirmed) throw new Error("FX history import requires --confirm-external-fetch");
  if (!from || !to) throw new Error("FX history import requires --from and --to");
  return { from, to, environment, instrument };
}

/** One collection as the CLI runs it: the arguments, the credentials from the environment, and the summary it prints. */
export async function runFxHistoryCollection(argv: string[], env: Record<string, string | undefined> = process.env,
  deps: Pick<OandaHistoricalRequest, "fetch" | "now" | "sleep"> = {}) {
  const args = parseFxHistoryCollectionCliArguments(argv);
  const accountId = env.OANDA_FX_HISTORY_ACCOUNT_ID;
  const token = env.OANDA_FX_HISTORY_ACCESS_TOKEN;
  if (!accountId || !token) throw new Error("set OANDA_FX_HISTORY_ACCOUNT_ID and OANDA_FX_HISTORY_ACCESS_TOKEN before collecting FX history");
  const result = await collectOandaM15History({ ...args, ...deps, accountId, token });
  const { bars, ...summary } = result;
  return { ...summary, bars_collected: bars.length };
}

async function main() {
  process.stdout.write(`${JSON.stringify(await runFxHistoryCollection(process.argv.slice(2)))}\n`);
}

if (isCliEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(`FX history collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
