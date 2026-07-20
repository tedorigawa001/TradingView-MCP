import { normalizeResolution, type AnalysisBias } from "./analysisOverlay.js";
import type { JournalAnalysisRecord } from "./dueAnalyses.js";

export type PerformanceGroupBy = "overall" | "symbol" | "bias" | "timeframe" | "strategy_version";

type CostAssumption = { symbol: string; totalPricePerUnit: number };

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const mean = (values: number[]) => values.length === 0
  ? null
  : values.reduce((sum, value) => sum + value, 0) / values.length;

function performancePayload(result: Record<string, unknown>) {
  const value = result.performance;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const performance = value as Record<string, unknown>;
  if (performance.methodologyVersion !== "1.0") return null;
  const timing = performance.timing && typeof performance.timing === "object" && !Array.isArray(performance.timing)
    ? performance.timing as Record<string, unknown>
    : {};
  const excursion = performance.excursion && typeof performance.excursion === "object" && !Array.isArray(performance.excursion)
    ? performance.excursion as Record<string, unknown>
    : null;
  return {
    structuralRiskPrice: finite(performance.structuralRiskPrice) && performance.structuralRiskPrice > 0
      ? performance.structuralRiskPrice
      : null,
    grossRealizedR: finite(performance.grossRealizedR) ? performance.grossRealizedR : null,
    mfeR: excursion !== null && finite(excursion.mfeR) && excursion.mfeR >= 0 ? excursion.mfeR : null,
    maeR: excursion !== null && finite(excursion.maeR) && excursion.maeR >= 0 ? excursion.maeR : null,
    analyzedToEntryMs: finite(timing.analyzedToEntryMs) && timing.analyzedToEntryMs >= 0
      ? timing.analyzedToEntryMs
      : null,
    entryToConfirmationMs: finite(timing.entryToConfirmationMs) && timing.entryToConfirmationMs >= 0
      ? timing.entryToConfirmationMs
      : null,
    activationToTerminalMs: finite(timing.activationToTerminalMs) && timing.activationToTerminalMs >= 0
      ? timing.activationToTerminalMs
      : null,
  };
}

export function buildAnalysisPerformance(
  analyses: JournalAnalysisRecord[],
  options: {
    symbol?: string;
    bias?: AnalysisBias;
    timeframe?: string;
    strategyVersion?: string;
    groupBy?: PerformanceGroupBy;
    costs?: CostAssumption[];
  } = {},
) {
  const groupBy = options.groupBy ?? "overall";
  const costMap = new Map<string, number>();
  for (const cost of options.costs ?? []) {
    const symbol = cost.symbol.toUpperCase();
    if (!/^[\w!.:&-]{1,48}$/.test(cost.symbol) ||
        !Number.isFinite(cost.totalPricePerUnit) || cost.totalPricePerUnit < 0) {
      throw new Error("invalid analysis performance cost assumption");
    }
    if (costMap.has(symbol)) throw new Error(`duplicate cost assumption for ${symbol}`);
    costMap.set(symbol, cost.totalPricePerUnit);
  }
  const filtered = analyses.filter((item) => {
    const definition = item.definition.payload;
    return (!options.symbol || definition.symbol.toUpperCase() === options.symbol.toUpperCase()) &&
      (!options.bias || definition.bias === options.bias) &&
      (!options.timeframe || normalizeResolution(definition.timeframe) === normalizeResolution(options.timeframe)) &&
      (!options.strategyVersion || definition.strategyVersion === options.strategyVersion);
  });
  const keyFor = (item: JournalAnalysisRecord) => {
    const definition = item.definition.payload;
    if (groupBy === "symbol") return definition.symbol.toUpperCase();
    if (groupBy === "bias") return definition.bias;
    if (groupBy === "timeframe") return normalizeResolution(definition.timeframe);
    if (groupBy === "strategy_version") return definition.strategyVersion ?? "unversioned";
    return "overall";
  };
  const buckets = new Map<string, JournalAnalysisRecord[]>();
  for (const item of filtered) {
    const key = keyFor(item);
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }

  const groups = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, items]) => {
    const outcomes: Record<string, number> = {};
    const excluded: Record<string, number> = {};
    const gross: number[] = [];
    const net: number[] = [];
    const mfe: number[] = [];
    const mae: number[] = [];
    const analyzedToEntry: number[] = [];
    const entryToConfirmation: number[] = [];
    const activationToTerminal: number[] = [];
    let latestEvaluations = 0;
    let wins = 0;
    let losses = 0;

    for (const item of items) {
      const latest = item.latestOutcome?.payload ?? null;
      if (latest === null) {
        excluded.no_latest_evaluation = (excluded.no_latest_evaluation ?? 0) + 1;
        continue;
      }
      latestEvaluations += 1;
      outcomes[latest.outcome] = (outcomes[latest.outcome] ?? 0) + 1;
      if (latest.outcome === "target_before_stop") wins += 1;
      else if (latest.outcome === "stop_before_target") losses += 1;
      else excluded.non_binary_outcome = (excluded.non_binary_outcome ?? 0) + 1;

      const performance = performancePayload(latest.result);
      if (performance === null) {
        excluded.path_metrics_unavailable = (excluded.path_metrics_unavailable ?? 0) + 1;
        continue;
      }
      if (performance.mfeR !== null && performance.maeR !== null) {
        mfe.push(performance.mfeR);
        mae.push(performance.maeR);
      } else {
        excluded.excursion_unavailable = (excluded.excursion_unavailable ?? 0) + 1;
      }
      if (performance.analyzedToEntryMs !== null) analyzedToEntry.push(performance.analyzedToEntryMs);
      if (performance.entryToConfirmationMs !== null) entryToConfirmation.push(performance.entryToConfirmationMs);
      if (performance.activationToTerminalMs !== null) activationToTerminal.push(performance.activationToTerminalMs);
      if (performance.grossRealizedR !== null) {
        gross.push(performance.grossRealizedR);
        const cost = costMap.get(item.definition.payload.symbol.toUpperCase());
        if (cost !== undefined && performance.structuralRiskPrice !== null) {
          net.push(performance.grossRealizedR - cost / performance.structuralRiskPrice);
        } else {
          excluded.net_cost_unavailable = (excluded.net_cost_unavailable ?? 0) + 1;
        }
      }
    }
    const binaryIncluded = wins + losses;
    return {
      key,
      analyses: items.length,
      latestEvaluations,
      outcomes,
      binary: {
        included: binaryIncluded,
        wins,
        losses,
        winRate: binaryIncluded === 0 ? null : wins / binaryIncluded,
      },
      rMultiples: {
        grossIncluded: gross.length,
        meanGrossRealizedR: mean(gross),
        netIncluded: net.length,
        meanNetRealizedR: mean(net),
      },
      excursions: {
        included: mfe.length,
        meanMfeR: mean(mfe),
        meanMaeR: mean(mae),
      },
      timing: {
        analyzedToEntryIncluded: analyzedToEntry.length,
        meanAnalyzedToEntryMs: mean(analyzedToEntry),
        entryToConfirmationIncluded: entryToConfirmation.length,
        meanEntryToConfirmationMs: mean(entryToConfirmation),
        activationToTerminalIncluded: activationToTerminal.length,
        meanActivationToTerminalMs: mean(activationToTerminal),
      },
      excluded,
    };
  });
  return {
    population: analyses.length,
    filtered: filtered.length,
    groupBy,
    groups,
    costAssumptions: [...costMap].map(([symbol, totalPricePerUnit]) => ({ symbol, totalPricePerUnit })),
    definitions: {
      binaryPositive: "target_before_stop",
      binaryNegative: "stop_before_target",
      grossR: "terminal level versus entry-band midpoint, divided by midpoint-to-stop distance",
      netR: "gross R minus explicit round-trip price cost divided by structural risk price",
      excursion:
        "closed bars strictly after activation and before terminal; terminal level is added as a point; activation/terminal bar OHLC is excluded",
      sourcePopulation: "live analysis journal only; backtests are not included",
      methodologyVersion: "1.0",
    },
  };
}
