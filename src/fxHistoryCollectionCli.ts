import { collectOandaEurUsdM15History } from "./oandaHistoricalFx.js";

export function parseFxHistoryCollectionCliArguments(argv: string[]) {
  let from: string | undefined; let to: string | undefined; let confirmed = false; let environment: "practice" | "live" = "practice";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") from = argv[++index];
    else if (arg === "--to") to = argv[++index];
    else if (arg === "--environment") { const value = argv[++index]; if (value !== "practice" && value !== "live") throw new Error("environment must be practice or live"); environment = value; }
    else if (arg === "--confirm-external-fetch") confirmed = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!confirmed) throw new Error("FX history import requires --confirm-external-fetch");
  if (!from || !to) throw new Error("FX history import requires --from and --to");
  return { from, to, environment };
}

async function main() {
  const args = parseFxHistoryCollectionCliArguments(process.argv.slice(2));
  const accountId = process.env.OANDA_FX_HISTORY_ACCOUNT_ID;
  const token = process.env.OANDA_FX_HISTORY_ACCESS_TOKEN;
  if (!accountId || !token) throw new Error("set OANDA_FX_HISTORY_ACCOUNT_ID and OANDA_FX_HISTORY_ACCESS_TOKEN before collecting FX history");
  const result = await collectOandaEurUsdM15History({ ...args, accountId, token });
  const { bars, ...summary } = result;
  process.stdout.write(`${JSON.stringify({ ...summary, bars_collected: bars.length })}\n`);
}

if (process.argv[1]?.endsWith("fxHistoryCollectionCli.js")) main().catch((error) => { process.stderr.write(`FX history collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
