import { computeCotPositioningFeatures, cotSymbolContract, type CotObservation } from "./cot.js";
import type { OhlcvBar } from "./tradingview.js";

const LOOKBACK_BARS = 20;

const pairCurrencies = (symbol: string) => {
  const pair = symbol.toUpperCase().split(":").at(-1) ?? "";
  if (!/^[A-Z]{6}$/.test(pair)) throw new Error(`COT currency-bias context requires a six-letter FX pair, got ${symbol}`);
  return { baseCurrency: pair.slice(0, 3), quoteCurrency: pair.slice(3) };
};

/**
 * Describes a potential crowded-position unwind. COT does not contain resting orders, stop prices,
 * execution flow, or individual trader information; the price break is only a transparent proxy
 * for a level where a crowded position could be forced to reduce risk.
 */
export function computeCotCrowdingUnwindContext(input: { symbol: string; timeframe: string; bars: OhlcvBar[]; observations: CotObservation[] }) {
  if (input.timeframe.toUpperCase() !== "1D") throw new Error("COT crowding-unwind context requires a 1D timeframe");
  const closed = input.bars.filter((bar) => bar.forming !== true).sort((left, right) => left.time - right.time);
  if (closed.length < LOOKBACK_BARS + 1) throw new Error(`COT crowding-unwind context requires at least ${LOOKBACK_BARS + 1} closed daily bars`);
  const features = computeCotPositioningFeatures(input.observations);
  const leveragedMoney = features.groups.find((group) => group.group === "lev_money");
  const latestObservation = input.observations[0];
  if (!latestObservation || !leveragedMoney) throw new Error("COT leveraged-money positioning is unavailable for this symbol");

  const latest = closed.at(-1)!;
  const reference = closed.slice(-(LOOKBACK_BARS + 1), -1);
  const support = Math.min(...reference.map((bar) => bar.low));
  const resistance = Math.max(...reference.map((bar) => bar.high));
  const percentile = leveragedMoney.percentile_3y;
  const crowdedLong = percentile !== null && percentile >= 90;
  const crowdedShort = percentile !== null && percentile <= 10;
  const downsideBreak = latest.close < support;
  const upsideBreak = latest.close > resistance;
  const condition = crowdedLong && downsideBreak
    ? "crowded_long_downside_unwind_proxy"
    : crowdedShort && upsideBreak
      ? "crowded_short_upside_unwind_proxy"
      : crowdedLong
        ? "crowded_long_waiting_for_downside_break"
        : crowdedShort
          ? "crowded_short_waiting_for_upside_break"
          : "no_extreme_crowding";
  const availableAt = latestObservation.available_at;
  // Taken from the COT symbol table rather than restated here. A second list would drift, and the
  // field that decides how far a reading can be taken - proxyScope - is the one that would drift.
  const contract = cotSymbolContract(input.symbol);
  if (contract === null) throw new Error(`COT currency-bias context is unavailable for ${input.symbol}`);
  // Gold is a direct COT reading, but every field below is framed as currency bias and the bound
  // tool declares a daily FX chart. Accepting it here only in the pure function would put the
  // capability somewhere no caller can reach, which is the divergence this contract exists to avoid.
  if (contract.futuresUnderlyingKind !== "currency") {
    throw new Error(`COT currency-bias context covers currency futures only, and ${input.symbol} trades on ${contract.market}`);
  }
  const directCurrency = contract.futuresUnderlying;
  const { baseCurrency, quoteCurrency } = pairCurrencies(input.symbol);
  // A single-leg proxy reads one currency futures contract for a pair neither of whose legs is the
  // dollar the contract is quoted against. It cannot carry the same weight as a direct reading, and
  // presenting the two identically is what this marker exists to prevent.
  const singleLegProxy = contract.proxyScope === "base_currency_single_leg";
  const directPercentile = percentile === null
    ? null
    : leveragedMoney.target_direction_multiplier === -1
      ? 100 - percentile
      : percentile;
  const qualityIssues = [
    ...(features.point_in_time_status !== "observed_first_seen" ? ["cot_available_at_not_observed"] : []),
    ...(percentile === null ? ["three_year_cot_percentile_unavailable"] : []),
    ...(singleLegProxy ? ["cot_positioning_is_a_single_leg_currency_proxy_for_this_pair"] : []),
  ];
  return {
    schemaVersion: "1.0" as const,
    methodologyVersion: "cot_crowding_unwind_context_v1" as const,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    symbol: input.symbol,
    timeframe: input.timeframe,
    cotContract: {
      group: "lev_money",
      crowdingMeasure: "target_oriented_net_open_interest_ratio_percentile_3y",
      crowdedLongThresholdPercentile: 90,
      crowdedShortThresholdPercentile: 10,
      reportDate: latestObservation.report_date,
      availableAt,
      pointInTimeStatus: features.point_in_time_status,
      pointInTimeReason: "point_in_time_reason" in features ? features.point_in_time_reason : null,
    },
    priceStructure: {
      lookbackClosedDailyBars: LOOKBACK_BARS,
      referenceStart: reference[0].timeIso,
      referenceEnd: reference.at(-1)!.timeIso,
      support,
      resistance,
      // The bar that produced the break, so a reader can place it against availableAt. Without it
      // there is no way to tell from this output whether the positioning was knowable at the break.
      latestBarAt: latest.timeIso,
      latestClose: latest.close,
      downsideBreak,
      upsideBreak,
    },
    crowding: {
      targetOrientedNetOpenInterestRatio: leveragedMoney.target_oriented_net_open_interest_ratio,
      percentile3y: percentile,
      netOiRatioChangeFromPreviousReport: leveragedMoney.target_oriented_ratio_change_from_previous_report,
      previousReportStatus: leveragedMoney.previous_report_status,
      condition,
    },
    currencyBias: {
      proxyScope: contract.proxyScope,
      futuresMarket: contract.market,
      directFutures: {
        currency: directCurrency,
        netOpenInterestRatio: leveragedMoney.net_open_interest_ratio,
        percentile3y: directPercentile,
        interpretation: `direct ${directCurrency} futures leveraged-money positioning`,
      },
      pairRelative: {
        baseCurrency,
        quoteCurrency,
        targetOrientedNetOpenInterestRatio: leveragedMoney.target_oriented_net_open_interest_ratio,
        percentile3y: percentile,
        interpretation: singleLegProxy
          ? `${baseCurrency} relative to ${quoteCurrency} inferred from ${directCurrency} futures alone; neither leg of this pair is the dollar those futures are quoted against, so this is a single-leg proxy and not a reading of the pair`
          : `${baseCurrency} relative to ${quoteCurrency}; not an independent ${baseCurrency} COT observation when the underlying futures contract is ${directCurrency}`,
      },
      usdIndependentObservation: false,
    },
    researchContract: {
      interpretation: "crowded-position unwind proxy, not observed stop-loss or pending-order flow",
      prospectiveOnly: true,
      candidateEligible: false,
      requiredBeforeEvaluation: ["forward first-seen COT availability", "pre-registered forward-return horizon", "same-regime unconditional baseline", "empirical-null and OOS evidence"],
    },
    qualityIssues,
    limitations: [
      "COT is a delayed weekly futures positioning report, not a realtime order or stop-loss feed.",
      "Currency bias distinguishes direct currency-futures positioning from pair-relative orientation; it does not infer an independent USD position.",
      "The support/resistance break is a price-structure proxy; it does not locate client stops or establish forced liquidation.",
      "Historical COT rows first observed after their report dates are excluded from prospective performance claims.",
      "A percentile stated for the direct futures currency is the mid-rank percentile of the negated ratio, which the mid-rank definition makes exactly one hundred minus the target-oriented percentile.",
    ],
  };
}
