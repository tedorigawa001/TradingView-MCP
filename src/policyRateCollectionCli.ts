import { CdpClient } from "./cdp.js";
import { ChartOperationLock } from "./chartOperationLock.js";
import { assertChartState, withTemporaryChartState } from "./chartTransaction.js";
import { latestPolicyRateDecision } from "./policyRateCollection.js";
import { POLICY_RATE_SYMBOLS, PolicyRateFirstSeenStore, resolvePolicyRateHistoryPath, type PolicyRateCurrency } from "./policyRateHistory.js";
import { PolicyRateCollectionHeartbeatStore, resolvePolicyRateCollectionHeartbeatPath } from "./policyRateCollectionHeartbeat.js";
import { TradingView } from "./tradingview.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";

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

/**
 * A run whose first-seen values were written but whose heartbeat was refused (one stamped before the latest, BACKLOG
 * 102-36): `result` is the run's result with heartbeat null, which the CLI still prints before it fails with the
 * heartbeat's error, as the first-seen collection does (102-07 review). The message is the heartbeat's own.
 */
export class PolicyRateHeartbeatError extends Error {
  constructor(readonly result: Omit<Awaited<ReturnType<typeof collectPolicyRates>>, "heartbeat"> & { heartbeat: null }, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "PolicyRateHeartbeatError";
  }
}

export async function collectPolicyRates(
  tv: Pick<TradingView, "getOhlcv" | "setSymbol" | "setResolution" | "getChartContext">,
  store: Pick<PolicyRateFirstSeenStore, "observeMany">,
  heartbeat: Pick<PolicyRateCollectionHeartbeatStore, "recordRun">,
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
    const result = { observed_at: now.toISOString(), status: "complete" as const, observations: observations.map(({ currency, bars, observation }) => ({ currency, source_symbol: observation.source_symbol, observation_date: observation.observation_date, value: observation.value, available_at: observation.available_at, bars })), first_seen: { recorded: persisted.recorded.length, unchanged: persisted.unchanged, revisions: persisted.revisions } };
    let heartbeatRecord;
    try {
      heartbeatRecord = await heartbeat.recordRun({
        observed_at: now.toISOString(),
        chart_index: chartIndex,
        currencies: observations.map(({ currency, bars, observation }) => ({ currency, source_symbol: observation.source_symbol, decision_observation_date: observation.observation_date, bars })),
      });
    } catch (error) {
      throw new PolicyRateHeartbeatError({ ...result, heartbeat: null }, error);
    }
    return { ...result, heartbeat: { sequence: heartbeatRecord.sequence, recorded_at: heartbeatRecord.first_seen_at } };
  } finally {
    await release();
  }
}

/**
 * Prints a run's result. A run whose heartbeat was refused still prints its result, with heartbeat null, since its values
 * are already written, and then fails with the heartbeat's error, which the CLI writes to stderr with exit status 1.
 */
export async function printPolicyRateCollection(
  collect: () => ReturnType<typeof collectPolicyRates>,
  write: (line: string) => void = (line) => { process.stdout.write(line); },
): Promise<void> {
  try {
    write(`${JSON.stringify(await collect())}\n`);
  } catch (error) {
    if (error instanceof PolicyRateHeartbeatError) write(`${JSON.stringify(error.result)}\n`);
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parsePolicyRateCollectionCliArguments(process.argv.slice(2));
  const cdp = new CdpClient();
  try {
    await printPolicyRateCollection(() => collectPolicyRates(new TradingView(cdp), new PolicyRateFirstSeenStore(resolvePolicyRateHistoryPath()),
      new PolicyRateCollectionHeartbeatStore(resolvePolicyRateCollectionHeartbeatPath()), args.chartIndex));
  } finally {
    cdp.close();
  }
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`policy-rate collection failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
