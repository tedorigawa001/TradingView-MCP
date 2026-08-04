import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { collectOandaFlow, OANDA_FLOW_INSTRUMENTS, oandaFlowTokenConfigured, type OandaFlowInstrument } from "./oandaFlow.js";

export type OandaFlowCollectionCliArguments = { instrument: OandaFlowInstrument | null; outputPath: string | null; confirmExternalFetch: boolean; readiness: boolean };

export function parseOandaFlowCollectionCliArguments(argv: string[]): OandaFlowCollectionCliArguments {
  let instrument: OandaFlowInstrument | null = null; let outputPath: string | null = null; let confirmExternalFetch = false; let readiness = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--instrument") {
      const value = argv[++index];
      if (!value || !OANDA_FLOW_INSTRUMENTS.includes(value as OandaFlowInstrument)) throw new Error("--instrument must be EUR_USD or USD_JPY");
      instrument = value as OandaFlowInstrument;
    } else if (arg === "--out") outputPath = argv[++index] ?? "";
    else if (arg === "--confirm-external-fetch") confirmExternalFetch = true;
    else if (arg === "--readiness") readiness = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (readiness) {
    if (instrument !== null || outputPath !== null || confirmExternalFetch) throw new Error("--readiness cannot be combined with collection arguments");
    return { instrument, outputPath, confirmExternalFetch, readiness };
  }
  if (!instrument || !confirmExternalFetch) throw new Error("OANDA flow collection requires --instrument and --confirm-external-fetch");
  if (outputPath === "") throw new Error("--out requires a path");
  return { instrument, outputPath, confirmExternalFetch, readiness };
}

async function main() {
  const args = parseOandaFlowCollectionCliArguments(process.argv.slice(2));
  if (args.readiness) {
    process.stdout.write(`${JSON.stringify({ status: oandaFlowTokenConfigured() ? "ready" : "blocked", token_configured: oandaFlowTokenConfigured(), supported_instruments: OANDA_FLOW_INSTRUMENTS, evidence_tier: "broker_retail_sentiment_history", environment: "practice", history_policy: "returned_history_exploratory_only_until_observed_first_seen" })}\n`);
    return;
  }
  const token = process.env.OANDA_FX_PRACTICE_TOKEN;
  if (!token?.trim()) throw new Error("OANDA_FX_PRACTICE_TOKEN is not configured");
  const result = await collectOandaFlow({ instrument: args.instrument!, token });
  const outputPath = args.outputPath ?? join(homedir(), ".tradingview-mcp", "oanda-flow-snapshots", `${args.instrument}_${result.collectedAt.replace(/[:.]/g, "-")}.json`);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ instrument: result.instrument, collected_at: result.collectedAt, order_book_snapshots: result.orderBook.snapshots.length, position_ratio_snapshots: result.positionRatios.snapshots.length, output_path: outputPath, evidence_tier: result.evidenceTier })}\n`);
}

if (process.argv[1]?.endsWith("oandaFlowCollectionCli.js")) {
  main().catch((error) => { process.stderr.write(`OANDA flow collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
