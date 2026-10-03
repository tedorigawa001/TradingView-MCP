#!/usr/bin/env node
import { CotClient } from "./cot.js";
import { CmeDailyBulletinClient } from "./cmeDailyBulletin.js";
import { CotFirstSeenStore, resolveCotFirstSeenHistoryPath } from "./cotFirstSeenHistory.js";
import { collectFirstSeenSources, getUnifiedFirstSeenCoverage } from "./firstSeenCollection.js";
import { FuturesOpenInterestFirstSeenStore, resolveFuturesOpenInterestHistoryPath } from "./futuresOpenInterestHistory.js";
import { TreasuryRealYieldClient } from "./realYield.js";
import { RealYieldFirstSeenStore, resolveRealYieldHistoryPath } from "./realYieldHistory.js";
import { PolicyRateFirstSeenStore, resolvePolicyRateHistoryPath } from "./policyRateHistory.js";
import { PolicyRateCollectionHeartbeatStore, resolvePolicyRateCollectionHeartbeatPath } from "./policyRateCollectionHeartbeat.js";
import { FirstSeenCollectionHeartbeatStore, resolveFirstSeenCollectionHeartbeatPath } from "./firstSeenCollectionHeartbeat.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";

const DEFAULT_COT_SYMBOLS = ["OANDA:EURUSD", "OANDA:XAUUSD"];
const MAX_COT_COLLECTION_WEEKS = 52;

export type CollectionCliArguments = { command: "collect" | "coverage"; cotSymbols: string[]; cotWeeks: number };

export function parseCollectionCliArguments(argv: string[], env = process.env): CollectionCliArguments {
  let command: "collect" | "coverage" = "collect";
  let cotWeeks = MAX_COT_COLLECTION_WEEKS;
  const cotSymbols: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "collect" || value === "coverage") {
      if (index !== 0) throw new Error("command must be the first argument");
      command = value;
    } else if (value === "--cot-symbol") {
      const symbol = argv[++index];
      if (!symbol) throw new Error("--cot-symbol requires a value");
      cotSymbols.push(symbol);
    } else if (value === "--cot-weeks") {
      const weeks = Number(argv[++index]);
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_COT_COLLECTION_WEEKS) {
        throw new Error(`--cot-weeks must be an integer from 1 to ${MAX_COT_COLLECTION_WEEKS}`);
      }
      cotWeeks = weeks;
    } else if (value !== undefined) {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  const configured = env.TRADINGVIEW_MCP_COLLECTION_COT_SYMBOLS?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const selected = cotSymbols.length > 0 ? cotSymbols : configured.length > 0 ? configured : DEFAULT_COT_SYMBOLS;
  if (new Set(selected).size !== selected.length) throw new Error("COT symbols must not contain duplicates");
  return { command, cotSymbols: selected, cotWeeks };
}

/** What a collection run records as its heartbeat: a partial run, such as one whose evidence was not saved, stays partial. */
export function firstSeenHeartbeatRun(
  result: Awaited<ReturnType<typeof collectFirstSeenSources>>,
  cotSymbols: string[],
): Parameters<FirstSeenCollectionHeartbeatStore["recordRun"]>[0] {
  return {
    observed_at: result.observed_at,
    status: result.status,
    cot_symbols: cotSymbols,
    cot_complete: result.cot.filter((item) => item.status === "complete").length,
    real_yield_status: result.real_yield.status,
    cme_gold_open_interest_status: result.cme_gold_open_interest.status,
    coverage_status: result.coverage.status,
  };
}

async function main(): Promise<void> {
  const args = parseCollectionCliArguments(process.argv.slice(2));
  const cotStore = new CotFirstSeenStore(resolveCotFirstSeenHistoryPath());
  const realYieldStore = new RealYieldFirstSeenStore(resolveRealYieldHistoryPath());
  const futuresOiStore = new FuturesOpenInterestFirstSeenStore(resolveFuturesOpenInterestHistoryPath());
  const policyRateStore = new PolicyRateFirstSeenStore(resolvePolicyRateHistoryPath());
  const policyRateHeartbeats = new PolicyRateCollectionHeartbeatStore(resolvePolicyRateCollectionHeartbeatPath());
  const firstSeenHeartbeats = new FirstSeenCollectionHeartbeatStore(resolveFirstSeenCollectionHeartbeatPath());
  const coverage = () => getUnifiedFirstSeenCoverage({ cot: cotStore, realYield: realYieldStore, futuresOpenInterest: futuresOiStore, policyRates: policyRateStore, policyRateHeartbeats });
  if (args.command === "coverage") {
    process.stdout.write(`${JSON.stringify({ ...(await coverage()), first_seen_collection_heartbeat: await firstSeenHeartbeats.coverage() })}\n`);
    return;
  }
  const result = await collectFirstSeenSources({
      cot: new CotClient(undefined, undefined, cotStore),
      realYield: new TreasuryRealYieldClient(undefined, undefined, realYieldStore),
      cmeGoldOpenInterest: new CmeDailyBulletinClient(),
      futuresOpenInterest: futuresOiStore,
      cotSymbols: args.cotSymbols,
      cotWeeks: args.cotWeeks,
      coverage,
    });
  let heartbeat;
  try {
    heartbeat = await firstSeenHeartbeats.recordRun(firstSeenHeartbeatRun(result, args.cotSymbols));
  } catch (error) {
    // Keep the run's per-source results in the log; otherwise they are lost with the heartbeat (102-07 review).
    process.stdout.write(`${JSON.stringify({ ...result, heartbeat: null })}\n`);
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ ...result, heartbeat: { sequence: heartbeat.sequence, recorded_at: heartbeat.first_seen_at } })}\n`);
  if (result.status === "partial") process.exitCode = 1;
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`first-seen collection failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
