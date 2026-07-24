import type { OhlcvBar } from "./tradingview.js";

export type FuturesFlowMapping = {
  targetSymbol: string;
  futuresSymbol: string;
  allowedFuturesSymbols: string[];
  venue: "CME" | "COMEX";
  instrument: string;
  targetDirectionMultiplier: 1 | -1;
  proxyScope: "direct_base_asset" | "base_currency_single_leg";
};

export type PriceOpenInterestQuadrant =
  | "long_build"
  | "short_build"
  | "long_unwinding"
  | "short_covering"
  | "neutral";

export interface OpenInterestPoint {
  time: string | number;
  openInterest: number;
}

export interface FuturesFlowContextInput {
  bars: OhlcvBar[];
  targetSymbol: string;
  futuresSymbol: string;
  timeframe: string;
  volumeLookback: number;
  elevatedVolumeZScore: number;
  minimumObservations: number;
  observationLimit: number;
  openInterestData?: OpenInterestPoint[];
  openInterestSource?: "tradingview_chart_indicator" | "caller_supplied_open_interest_data";
}

const MAPPINGS: Record<string, FuturesFlowMapping> = {
  "OANDA:EURUSD": { targetSymbol: "OANDA:EURUSD", futuresSymbol: "CME:6E1!", venue: "CME",
    allowedFuturesSymbols: ["CME:6E1!", "CME_DL:6E1!"],
    instrument: "Euro FX continuous futures", targetDirectionMultiplier: 1, proxyScope: "direct_base_asset" },
  "OANDA:USDJPY": { targetSymbol: "OANDA:USDJPY", futuresSymbol: "CME:6J1!", venue: "CME",
    allowedFuturesSymbols: ["CME:6J1!", "CME_DL:6J1!"],
    instrument: "Japanese Yen continuous futures", targetDirectionMultiplier: -1, proxyScope: "direct_base_asset" },
  "OANDA:GBPJPY": { targetSymbol: "OANDA:GBPJPY", futuresSymbol: "CME:6B1!", venue: "CME",
    allowedFuturesSymbols: ["CME:6B1!", "CME_DL:6B1!"],
    instrument: "British Pound continuous futures", targetDirectionMultiplier: 1, proxyScope: "base_currency_single_leg" },
  "OANDA:GBPAUD": { targetSymbol: "OANDA:GBPAUD", futuresSymbol: "CME:6B1!", venue: "CME",
    allowedFuturesSymbols: ["CME:6B1!", "CME_DL:6B1!"],
    instrument: "British Pound continuous futures", targetDirectionMultiplier: 1, proxyScope: "base_currency_single_leg" },
  "OANDA:XAUUSD": { targetSymbol: "OANDA:XAUUSD", futuresSymbol: "COMEX:GC1!", venue: "COMEX",
    allowedFuturesSymbols: ["COMEX:GC1!", "COMEX_DL:GC1!"],
    instrument: "Gold continuous futures", targetDirectionMultiplier: 1, proxyScope: "direct_base_asset" },
};

export function futuresFlowMapping(targetSymbol: string): FuturesFlowMapping | null {
  return MAPPINGS[targetSymbol.toUpperCase()] ?? null;
}

export function classifyFuturesQuadrant(
  futuresReturn: number,
  openInterestChange: number,
): PriceOpenInterestQuadrant {
  if (futuresReturn > 0 && openInterestChange > 0) return "long_build";
  if (futuresReturn < 0 && openInterestChange > 0) return "short_build";
  if (futuresReturn < 0 && openInterestChange < 0) return "long_unwinding";
  if (futuresReturn > 0 && openInterestChange < 0) return "short_covering";
  return "neutral";
}

export function mapTargetOrientedQuadrant(
  futuresQuadrant: PriceOpenInterestQuadrant,
  targetDirectionMultiplier: 1 | -1,
): PriceOpenInterestQuadrant {
  if (targetDirectionMultiplier === 1 || futuresQuadrant === "neutral") {
    return futuresQuadrant;
  }
  switch (futuresQuadrant) {
    case "long_build":
      return "short_build";
    case "short_build":
      return "long_build";
    case "long_unwinding":
      return "short_covering";
    case "short_covering":
      return "long_unwinding";
  }
}

function normalizeTimestampKey(value: string | number): string {
  if (typeof value === "number") {
    const epochSec = value > 1e11 ? value / 1000 : value;
    return new Date(epochSec * 1000).toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function validateBars(input: OhlcvBar[]): OhlcvBar[] {
  if (input.length < 3) throw new Error("futures flow context requires at least three OHLCV bars");
  const bars = [...input].sort((left, right) => left.time - right.time);
  if (bars.some((bar, index) => index > 0 && bar.time === bars[index - 1].time)) {
    throw new Error("futures OHLCV contains duplicate timestamps");
  }
  if (bars.some((bar) => !Number.isFinite(bar.open) || !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) || !Number.isFinite(bar.close) || bar.close <= 0 ||
      bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
      bar.close < bar.low || bar.close > bar.high ||
      (bar.volume !== null && (!Number.isFinite(bar.volume) || bar.volume < 0)))) {
    throw new Error("futures OHLCV contains invalid values");
  }
  return bars;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationDeviation(values: number[], mean: number): number {
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function direction(value: number): "up" | "down" | "flat" {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

export function computeFuturesFlowContext(input: FuturesFlowContextInput) {
  if (!/^(?:1?D)$/i.test(input.timeframe)) throw new Error("futures flow context requires a daily timeframe");
  if (!Number.isInteger(input.volumeLookback) || input.volumeLookback < 5 || input.volumeLookback > 250) {
    throw new Error("volume lookback must be an integer from 5 to 250");
  }
  if (!(input.elevatedVolumeZScore > 0 && input.elevatedVolumeZScore <= 10)) {
    throw new Error("elevated volume z-score must be greater than zero and at most 10");
  }
  if (!Number.isInteger(input.minimumObservations) || input.minimumObservations < 1 || input.minimumObservations > 5_000) {
    throw new Error("minimum observations must be an integer from 1 to 5000");
  }
  if (!Number.isInteger(input.observationLimit) || input.observationLimit < 0 || input.observationLimit > 500) {
    throw new Error("observation limit must be an integer from 0 to 500");
  }
  const mapping = futuresFlowMapping(input.targetSymbol);
  if (!mapping) throw new Error(`futures flow mapping is unavailable for ${JSON.stringify(input.targetSymbol)}`);
  const futuresSymbol = input.futuresSymbol.toUpperCase();
  if (!mapping.allowedFuturesSymbols.includes(futuresSymbol)) {
    throw new Error(`expected one of ${mapping.allowedFuturesSymbols.join(", ")} for ${mapping.targetSymbol}`);
  }

  const oiMap = new Map<string, number>();
  if (input.openInterestData) {
    for (const point of input.openInterestData) {
      if (Number.isFinite(point.openInterest) && point.openInterest >= 0) {
        const key = normalizeTimestampKey(point.time);
        oiMap.set(key, point.openInterest);
        oiMap.set(String(point.time), point.openInterest);
      }
    }
  }

  const allBars = validateBars(input.bars);
  const formingBarsExcluded = allBars.filter((bar) => bar.forming === true).length;
  const bars = allBars.filter((bar) => bar.forming !== true);
  const missingVolumeBars = bars.filter((bar) => bar.volume === null).length;
  const calendarOrDataGaps = bars.slice(1).filter((bar, index) =>
    bar.time * 1_000 - bars[index].time * 1_000 > 36 * 3_600_000).length;
  const observations = [] as Array<{
    time: string;
    futuresClose: number;
    futuresReturn: number;
    targetOrientedReturn: number;
    targetOrientedDirection: "up" | "down" | "flat";
    volume: number;
    volumeZScore: number | null;
    volumeRatioToTrailingMean: number;
    participation: "elevated" | "normal" | "subdued" | "unavailable";
    hypothesis: string;
    openInterest: number | null;
    openInterestChange: number | null;
    openInterestChangeRatio: number | null;
    futuresQuadrant: PriceOpenInterestQuadrant | null;
    targetOrientedQuadrant: PriceOpenInterestQuadrant | null;
  }>;

  for (let index = input.volumeLookback; index < bars.length; index += 1) {
    const bar = bars[index];
    const previous = bars[index - 1];
    const baseline = bars.slice(index - input.volumeLookback, index).map((item) => item.volume);
    if (bar.volume === null || baseline.some((value) => value === null)) continue;
    const volumes = baseline as number[];
    const mean = average(volumes);
    if (mean <= 0) continue;
    const deviation = populationDeviation(volumes, mean);
    const volumeZScore = deviation === 0 ? null : (bar.volume - mean) / deviation;
    const futuresReturn = bar.close / previous.close - 1;
    const targetOrientedReturn = mapping.targetDirectionMultiplier * futuresReturn;
    const targetOrientedDirection = direction(targetOrientedReturn);
    const participation = volumeZScore === null ? "unavailable"
      : volumeZScore >= input.elevatedVolumeZScore ? "elevated"
        : volumeZScore <= -input.elevatedVolumeZScore ? "subdued" : "normal";
    const hypothesis = participation === "elevated"
      ? `target_${targetOrientedDirection}_with_elevated_futures_volume`
      : participation === "subdued"
        ? `target_${targetOrientedDirection}_with_subdued_futures_volume`
        : participation === "normal"
          ? `target_${targetOrientedDirection}_with_normal_futures_volume`
          : "participation_unavailable";

    const dateKey = bar.timeIso.slice(0, 10);
    const prevDateKey = previous.timeIso.slice(0, 10);
    const curOi = oiMap.get(dateKey) ?? oiMap.get(String(bar.time)) ?? null;
    const prevOi = oiMap.get(prevDateKey) ?? oiMap.get(String(previous.time)) ?? null;

    let openInterest: number | null = null;
    let openInterestChange: number | null = null;
    let openInterestChangeRatio: number | null = null;
    let futuresQuadrant: PriceOpenInterestQuadrant | null = null;
    let targetOrientedQuadrant: PriceOpenInterestQuadrant | null = null;

    if (curOi !== null && prevOi !== null && curOi >= 0 && prevOi >= 0) {
      openInterest = curOi;
      openInterestChange = curOi - prevOi;
      openInterestChangeRatio = prevOi > 0 ? openInterestChange / prevOi : 0;
      futuresQuadrant = classifyFuturesQuadrant(futuresReturn, openInterestChange);
      targetOrientedQuadrant = mapTargetOrientedQuadrant(futuresQuadrant, mapping.targetDirectionMultiplier);
    }

    observations.push({
      time: bar.timeIso,
      futuresClose: bar.close,
      futuresReturn,
      targetOrientedReturn,
      targetOrientedDirection,
      volume: bar.volume,
      volumeZScore,
      volumeRatioToTrailingMean: bar.volume / mean,
      participation,
      hypothesis,
      openInterest,
      openInterestChange,
      openInterestChangeRatio,
      futuresQuadrant,
      targetOrientedQuadrant,
    });
  }

  const validOiObs = observations.filter((item) => item.openInterest !== null);
  const openInterestStatus = validOiObs.length === 0
    ? "unavailable" as const
    : validOiObs.length === observations.length
      ? "available" as const
      : "partial" as const;

  const qualityIssues = [
    ...(observations.length < input.minimumObservations ? ["minimum_observation_count_not_met"] : []),
    ...(missingVolumeBars > 0 ? ["one_or_more_closed_bars_missing_volume"] : []),
    ...(calendarOrDataGaps > 0 ? ["calendar_or_data_gaps_not_forward_filled"] : []),
    ...(openInterestStatus === "partial" ? ["daily_open_interest_partially_missing"] : []),
  ];

  const latestOiObs = [...validOiObs].pop() ?? null;

  const openInterestSummary = openInterestStatus === "unavailable"
    ? {
        status: "unavailable" as const,
        value: null,
        changeFromPrevious: null,
        changeRatio: null,
        reason: "no_authenticated_or_first_seen_tracked_daily_open_interest_provider_configured" as const,
      }
    : {
        status: openInterestStatus,
        value: latestOiObs?.openInterest ?? null,
        changeFromPrevious: latestOiObs?.openInterestChange ?? null,
        changeRatio: latestOiObs?.openInterestChangeRatio ?? null,
        source: input.openInterestSource ?? "caller_supplied_open_interest_data" as const,
        reason: null,
      };

  const quadrantCounts: Record<PriceOpenInterestQuadrant, number> = {
    long_build: 0,
    short_build: 0,
    long_unwinding: 0,
    short_covering: 0,
    neutral: 0,
  };
  for (const item of validOiObs) {
    if (item.targetOrientedQuadrant) {
      quadrantCounts[item.targetOrientedQuadrant] += 1;
    }
  }

  const totalOiCount = validOiObs.length;
  const quadrantDistribution = Object.fromEntries(
    (Object.keys(quadrantCounts) as PriceOpenInterestQuadrant[]).map((key) => [
      key,
      {
        count: quadrantCounts[key],
        percentage: totalOiCount > 0 ? quadrantCounts[key] / totalOiCount : 0,
      },
    ]),
  );

  const priceOpenInterestQuadrantSummary = openInterestStatus === "unavailable"
    ? {
        status: "unavailable" as const,
        classification: null,
        futuresClassification: null,
        reason: "daily_open_interest_unavailable" as const,
      }
    : {
        status: openInterestStatus,
        classification: latestOiObs?.targetOrientedQuadrant ?? null,
        futuresClassification: latestOiObs?.futuresQuadrant ?? null,
        distribution: quadrantDistribution,
        reason: null,
      };

  const returned = input.observationLimit === 0 ? [] : observations.slice(-input.observationLimit);
  return {
    schemaVersion: "1.1" as const,
    methodologyVersion: "futures_flow_context_v2" as const,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    mapping: { ...mapping, futuresSymbol },
    timeframe: input.timeframe,
    volumeContract: {
      source: "tradingview_futures_chart" as const,
      kind: "unverified_exchange_or_vendor_aggregated_futures_volume" as const,
      trailingBaselineExcludesCurrentBar: true,
      lookback: input.volumeLookback,
      elevatedZScore: input.elevatedVolumeZScore,
      forwardFill: false,
    },
    openInterest: openInterestSummary,
    priceOpenInterestQuadrant: priceOpenInterestQuadrantSummary,
    sample: {
      barsReceived: input.bars.length,
      closedBars: bars.length,
      observations: observations.length,
      minimumObservations: input.minimumObservations,
    },
    quality: { formingBarsExcluded, missingVolumeBars, calendarOrDataGaps },
    qualityIssues,
    current: observations.at(-1) ?? null,
    observations: returned,
    observationsReturned: returned.length,
    observationsTruncated: observations.length > returned.length,
  };
}
