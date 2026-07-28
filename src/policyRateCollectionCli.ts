import { pathToFileURL } from "node:url";
import { CdpClient } from "./cdp.js";
import { ChartOperationLock } from "./chartOperationLock.js";
import { assertChartState, withTemporaryChartState } from "./chartTransaction.js";
import { latestPolicyRateDecision } from "./policyRateCollection.js";
import { POLICY_RATE_SYMBOLS, PolicyRateFirstSeenStore, resolvePolicyRateHistoryPath, type PolicyRateCurrency } from "./policyRateHistory.js";
import { TradingView } from "./tradingview.js";

const CURRENCIES = Object.keys(POLICY_RATE_SYMBOLS) as PolicyRateCurrency[];

export type PolicyRateCollectionCliArguments = { chartIndex: number; confirmChartSwitch: boolean };

export function parsePolicyRateCollectionCliArguments(argv: string[], env = process.env): PolicyRateCollectionCliArguments {
  let chartIndex = 0;
  let confirmChartSwitch = env.TRADINGVIEW_MCP_POLICY_RATE_COLLECTION_CONFIRM_CHART_SWITCH === "1";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--confirm-chart-switch") confirmChartSwitch = true;
    else if (argv[index] === "--chart-index") {
      chartIndex = Number(argv[++index]);
      if (!Number.isInteger(chartIndex) || chartIndex < 0) throw new Error("--chart-index must be a non-negative integer");
    } else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!confirmChartSwitch) throw new Error("chart switching is disabled; pass --confirm-chart-switch or set TRADINGVIEW_MCP_POLICY_RATE_COLLECTION_CONFIRM_CHART_SWITCH=1");
  return { chartIndex, confirmChartSwitch };
}

export async function collectPolicyRates(
  tv: Pick<TradingView, "getOhlcv" | "setSymbol" | "setResolution" | "getChartContext">,
  store: Pick<PolicyRateFirstSeenStore, "observeMany">,
  chartIndex: number,
  now = new Date(),
  chartLock: Pick<ChartOperationLock, "acquire"> = new ChartOperationLock(),
) {
  const release = await chartLock.acquire();
  try {
    const observations = [];
    for (const currency of CURRENCIES) {
      const transaction = await withTemporaryChartState(tv, chartIndex, { symbol: POLICY_RATE_SYMBOLS[currency], resolution: "1D" }, async () => {
        await assertChartState(tv, chartIndex, { symbol: POLICY_RATE_SYMBOLS[currency], resolution: "1D" });
        const history = await tv.getOhlcv(5_000, chartIndex);
        if (history.symbol !== POLICY_RATE_SYMBOLS[currency] || history.resolution !== "1D") throw new Error(`policy-rate chart binding failed for ${currency}`);
        return { observation: latestPolicyRateDecision(currency, history.bars, now), bars: history.bars.length };
      }, { resolutionFirst: true });
      if (!transaction.restored) throw new Error(`policy-rate collection failed to restore chart after ${currency}`);
      if (transaction.operationError !== null || transaction.value === null) throw transaction.operationError ?? new Error(`policy-rate collection returned no value for ${currency}`);
      observations.push({ currency, bars: transaction.value.bars, observation: transaction.value.observation });
    }
    const persisted = await store.observeMany(observations.map((item) => item.observation));
    return { observed_at: now.toISOString(), status: "complete" as const, observations: observations.map(({ currency, bars, observation }) => ({ currency, source_symbol: observation.source_symbol, observation_date: observation.observation_date, value: observation.value, available_at: observation.available_at, bars })), first_seen: { recorded: persisted.recorded.length, unchanged: persisted.unchanged, revisions: persisted.revisions } };
  } finally {
    await release();
  }
}

async function main(): Promise<void> {
  const args = parsePolicyRateCollectionCliArguments(process.argv.slice(2));
  const cdp = new CdpClient();
  try {
    const result = await collectPolicyRates(new TradingView(cdp), new PolicyRateFirstSeenStore(resolvePolicyRateHistoryPath()), args.chartIndex);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    cdp.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`policy-rate collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
