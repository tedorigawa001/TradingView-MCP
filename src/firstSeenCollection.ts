import type { CotClient } from "./cot.js";
import type { CmeDailyBulletinClient } from "./cmeDailyBulletin.js";
import type { CotFirstSeenStore } from "./cotFirstSeenHistory.js";
import type { FuturesOpenInterestFirstSeenStore } from "./futuresOpenInterestHistory.js";
import type { TreasuryRealYieldClient } from "./realYield.js";
import type { RealYieldFirstSeenStore } from "./realYieldHistory.js";
import type { PolicyRateFirstSeenStore } from "./policyRateHistory.js";
import type { PolicyRateCollectionHeartbeatStore } from "./policyRateCollectionHeartbeat.js";

type CotCollector = Pick<CotClient, "getHistory">;

/** The real-yield quality issues that mean a fetched value was not recorded, each with what to say about it. */
const REAL_YIELD_PERSISTENCE_ISSUES = new Map<string, (date: string) => string>([
  ["first_seen_persistence_failed", (date) => `real-yield ${date} was fetched but its first-seen record failed to save`],
  ["first_seen_auxiliary_persistence_failed", () => "real-yield previous-year revision rows were fetched but failed to save"],
  ["first_seen_persistence_disabled", () => "real-yield first-seen store is disabled"],
]);
type RealYieldCollector = Pick<TreasuryRealYieldClient, "getLatest">;
type CmeGoldOpenInterestCollector = Pick<CmeDailyBulletinClient, "getLatestGoldOpenInterest">;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export type UnifiedFirstSeenCoverage = {
  observed_at: string;
  status: "complete" | "partial";
  cot: Awaited<ReturnType<CotFirstSeenStore["coverage"]>> | { error: string };
  real_yield: Awaited<ReturnType<RealYieldFirstSeenStore["coverage"]>> | { error: string };
  futures_open_interest: Awaited<ReturnType<FuturesOpenInterestFirstSeenStore["coverage"]>> | { error: string };
  policy_rates: Awaited<ReturnType<PolicyRateFirstSeenStore["coverage"]>> | { error: string };
  policy_rate_collection_heartbeats: Awaited<ReturnType<PolicyRateCollectionHeartbeatStore["coverage"]>> | { error: string };
};

export async function getUnifiedFirstSeenCoverage(input: {
  cot: Pick<CotFirstSeenStore, "coverage">;
  realYield: Pick<RealYieldFirstSeenStore, "coverage">;
  futuresOpenInterest: Pick<FuturesOpenInterestFirstSeenStore, "coverage">;
  policyRates: Pick<PolicyRateFirstSeenStore, "coverage">;
  policyRateHeartbeats: Pick<PolicyRateCollectionHeartbeatStore, "coverage">;
  now?: Date;
}): Promise<UnifiedFirstSeenCoverage> {
  const [cot, realYield, futuresOpenInterest, policyRates, policyRateHeartbeats] = await Promise.all([
    input.cot.coverage().catch((error) => ({ error: errorMessage(error) })),
    input.realYield.coverage().catch((error) => ({ error: errorMessage(error) })),
    input.futuresOpenInterest.coverage().catch((error) => ({ error: errorMessage(error) })),
    input.policyRates.coverage().catch((error) => ({ error: errorMessage(error) })),
    input.policyRateHeartbeats.coverage().catch((error) => ({ error: errorMessage(error) })),
  ]);
  return {
    observed_at: (input.now ?? new Date()).toISOString(),
    status: "error" in cot || "error" in realYield || "error" in futuresOpenInterest || "error" in policyRates || "error" in policyRateHeartbeats ? "partial" : "complete",
    cot,
    real_yield: realYield,
    futures_open_interest: futuresOpenInterest,
    policy_rates: policyRates,
    policy_rate_collection_heartbeats: policyRateHeartbeats,
  };
}

export async function collectFirstSeenSources(input: {
  cot: CotCollector;
  realYield: RealYieldCollector;
  cmeGoldOpenInterest: CmeGoldOpenInterestCollector;
  futuresOpenInterest: Pick<FuturesOpenInterestFirstSeenStore, "observeMany">;
  cotSymbols: string[];
  cotWeeks: number;
  coverage: () => Promise<UnifiedFirstSeenCoverage>;
}): Promise<{
  observed_at: string;
  status: "complete" | "partial";
  cot: Array<{ symbol: string; status: "complete" | "error"; observations?: number; error?: string }>;
  real_yield: { status: "complete" | "error"; observation_date?: string; available_at?: string | null; error?: string };
  cme_gold_open_interest: {
    status: "complete" | "error";
    observation_date?: string;
    open_interest?: number;
    report_status?: string;
    first_seen?: { recorded: number; unchanged: number; revisions: number };
    error?: string;
  };
  coverage: UnifiedFirstSeenCoverage;
}> {
  // The clients keep a fetched value usable when their first-seen store fails, leaving available_at null (COT) or adding
  // a persistence quality issue (real yield). For a collection run that is the failure that matters: a fetch that was not
  // recorded is no evidence, so it is an error here, the run is partial, and the heartbeat says so (BACKLOG 102-07). A
  // latest real-yield value that is missing, invalid or future-dated is an error too, though nothing failed to write: no
  // first-seen record was made, and a renamed or reformatted Treasury field shows up only this way.
  const cot = await Promise.all(input.cotSymbols.map(async (symbol) => {
    try {
      const history = await input.cot.getHistory(symbol, input.cotWeeks);
      const unrecorded = history.observations.filter((observation) => typeof observation.available_at !== "string").length;
      if (unrecorded > 0) {
        // With the store's own error when it failed, so the log says why (BACKLOG 102-30).
        const cause = typeof history.first_seen_error === "string" ? `: ${history.first_seen_error}` : "";
        throw new Error(`${unrecorded} of ${history.observations.length} COT observations were fetched but not recorded as first seen${cause}`);
      }
      return { symbol, status: "complete" as const, observations: history.observations.length };
    } catch (error) {
      return { symbol, status: "error" as const, error: errorMessage(error) };
    }
  }));
  let realYield: { status: "complete" | "error"; observation_date?: string; available_at?: string | null; error?: string };
  try {
    const latest = await input.realYield.getLatest();
    const problems = [
      ...latest.quality_issues.flatMap((issue) => {
        const problem = REAL_YIELD_PERSISTENCE_ISSUES.get(issue)?.(latest.observation_date);
        if (problem === undefined) return [];
        // With the store's own error when it failed, so the log says why (BACKLOG 102-30).
        const cause = latest.quality_issue_details?.[issue];
        return [typeof cause === "string" ? `${problem}: ${cause}` : problem];
      }),
      ...(typeof latest.available_at !== "string" && !latest.quality_issues.some((issue) => REAL_YIELD_PERSISTENCE_ISSUES.has(issue))
        ? [`the latest Treasury 10-year value for ${latest.observation_date} is ${latest.value_status}, so no first-seen record was made; check the feed`]
        : []),
    ];
    if (problems.length > 0) throw new Error(problems.join("; "));
    realYield = {
      status: "complete",
      observation_date: latest.observation_date,
      available_at: latest.available_at,
    };
  } catch (error) {
    realYield = { status: "error", error: errorMessage(error) };
  }
  let cmeGoldOpenInterest: {
    status: "complete" | "error";
    observation_date?: string;
    open_interest?: number;
    report_status?: string;
    first_seen?: { recorded: number; unchanged: number; revisions: number };
    error?: string;
  };
  try {
    const latest = await input.cmeGoldOpenInterest.getLatestGoldOpenInterest();
    const firstSeen = await input.futuresOpenInterest.observeMany([{
      futures_symbol: "COMEX_DL:GC1!",
      scope: "all_months_aggregated",
      observation_date: latest.observation_date,
      open_interest: latest.open_interest,
      source: latest.source,
      source_detail: latest.source_detail,
      report_status: latest.report_status,
      observed_at: latest.observed_at,
    }]);
    cmeGoldOpenInterest = {
      status: "complete",
      observation_date: latest.observation_date,
      open_interest: latest.open_interest,
      report_status: latest.report_status,
      first_seen: { recorded: firstSeen.recorded.length, unchanged: firstSeen.unchanged, revisions: firstSeen.revisions },
    };
  } catch (error) {
    cmeGoldOpenInterest = { status: "error", error: errorMessage(error) };
  }
  const coverage = await input.coverage();
  return {
    observed_at: new Date().toISOString(),
    status: cot.some((item) => item.status === "error") || realYield.status === "error" || cmeGoldOpenInterest.status === "error" || coverage.status === "partial"
      ? "partial" : "complete",
    cot,
    real_yield: realYield,
    cme_gold_open_interest: cmeGoldOpenInterest,
    coverage,
  };
}
