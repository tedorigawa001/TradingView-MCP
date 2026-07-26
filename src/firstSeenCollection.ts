import type { CotClient } from "./cot.js";
import type { CotFirstSeenStore } from "./cotFirstSeenHistory.js";
import type { FuturesOpenInterestFirstSeenStore } from "./futuresOpenInterestHistory.js";
import type { TreasuryRealYieldClient } from "./realYield.js";
import type { RealYieldFirstSeenStore } from "./realYieldHistory.js";

type CotCollector = Pick<CotClient, "getHistory">;
type RealYieldCollector = Pick<TreasuryRealYieldClient, "getLatest">;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export type UnifiedFirstSeenCoverage = {
  observed_at: string;
  status: "complete" | "partial";
  cot: Awaited<ReturnType<CotFirstSeenStore["coverage"]>> | { error: string };
  real_yield: Awaited<ReturnType<RealYieldFirstSeenStore["coverage"]>> | { error: string };
  futures_open_interest: Awaited<ReturnType<FuturesOpenInterestFirstSeenStore["coverage"]>> | { error: string };
};

export async function getUnifiedFirstSeenCoverage(input: {
  cot: Pick<CotFirstSeenStore, "coverage">;
  realYield: Pick<RealYieldFirstSeenStore, "coverage">;
  futuresOpenInterest: Pick<FuturesOpenInterestFirstSeenStore, "coverage">;
  now?: Date;
}): Promise<UnifiedFirstSeenCoverage> {
  const [cot, realYield, futuresOpenInterest] = await Promise.all([
    input.cot.coverage().catch((error) => ({ error: errorMessage(error) })),
    input.realYield.coverage().catch((error) => ({ error: errorMessage(error) })),
    input.futuresOpenInterest.coverage().catch((error) => ({ error: errorMessage(error) })),
  ]);
  return {
    observed_at: (input.now ?? new Date()).toISOString(),
    status: "error" in cot || "error" in realYield || "error" in futuresOpenInterest ? "partial" : "complete",
    cot,
    real_yield: realYield,
    futures_open_interest: futuresOpenInterest,
  };
}

export async function collectFirstSeenSources(input: {
  cot: CotCollector;
  realYield: RealYieldCollector;
  cotSymbols: string[];
  cotWeeks: number;
  coverage: () => Promise<UnifiedFirstSeenCoverage>;
}): Promise<{
  observed_at: string;
  status: "complete" | "partial";
  cot: Array<{ symbol: string; status: "complete" | "error"; observations?: number; error?: string }>;
  real_yield: { status: "complete" | "error"; observation_date?: string; available_at?: string | null; error?: string };
  coverage: UnifiedFirstSeenCoverage;
}> {
  const cot = await Promise.all(input.cotSymbols.map(async (symbol) => {
    try {
      const history = await input.cot.getHistory(symbol, input.cotWeeks);
      return { symbol, status: "complete" as const, observations: history.observations.length };
    } catch (error) {
      return { symbol, status: "error" as const, error: errorMessage(error) };
    }
  }));
  let realYield: { status: "complete" | "error"; observation_date?: string; available_at?: string | null; error?: string };
  try {
    const latest = await input.realYield.getLatest();
    realYield = {
      status: "complete",
      observation_date: latest.observation_date,
      available_at: latest.available_at,
    };
  } catch (error) {
    realYield = { status: "error", error: errorMessage(error) };
  }
  const coverage = await input.coverage();
  return {
    observed_at: new Date().toISOString(),
    status: cot.some((item) => item.status === "error") || realYield.status === "error" || coverage.status === "partial"
      ? "partial" : "complete",
    cot,
    real_yield: realYield,
    coverage,
  };
}
