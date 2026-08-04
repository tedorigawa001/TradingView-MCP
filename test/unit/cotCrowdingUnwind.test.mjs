import assert from "node:assert/strict";
import test from "node:test";
import { computeCotCrowdingUnwindContext } from "../../build/cotCrowdingUnwind.js";

const tuesday = (index) => new Date(Date.UTC(2026, 6, 7 - index * 7)).toISOString();
const observations = Array.from({ length: 160 }, (_, index) => ({
  symbol: "OANDA:EURUSD", report_date: tuesday(index), available_at: "2026-08-01T00:00:00.000Z", open_interest: 100,
  positions: [{ group: "lev_money", long: index === 0 ? 100 : 10, short: 0, net: index === 0 ? 100 : 10 }], target_direction_multiplier: 1,
}));
const bars = Array.from({ length: 21 }, (_, index) => ({
  time: Date.UTC(2026, 6, 1 + index) / 1_000, timeIso: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
  open: 1.1, high: 1.11, low: 1.09, close: index === 20 ? 1.08 : 1.1,
}));

test("COT crowding context only calls a price break an unwind proxy, never an observed stop", () => {
  const result = computeCotCrowdingUnwindContext({ symbol: "OANDA:EURUSD", timeframe: "1D", bars, observations });
  assert.equal(result.status, "complete");
  assert.equal(result.crowding.condition, "crowded_long_downside_unwind_proxy");
  assert.equal(result.priceStructure.downsideBreak, true);
  assert.deepEqual(result.currencyBias.directFutures, {
    currency: "EUR",
    netOpenInterestRatio: 1,
    percentile3y: 100,
    interpretation: "direct EUR futures leveraged-money positioning",
  });
  assert.equal(result.currencyBias.pairRelative.baseCurrency, "EUR");
  assert.equal(result.currencyBias.usdIndependentObservation, false);
  assert.equal(result.researchContract.candidateEligible, false);
  assert.match(result.limitations.join(" "), /not a realtime order or stop-loss feed/);
});

test("COT crowding context keeps direct JPY futures bias separate from USDJPY pair-relative orientation", () => {
  const yenObservations = observations.map((observation) => ({
    ...observation,
    symbol: "OANDA:USDJPY",
    target_direction_multiplier: -1,
  }));
  const result = computeCotCrowdingUnwindContext({ symbol: "OANDA:USDJPY", timeframe: "1D", bars, observations: yenObservations });
  assert.equal(result.currencyBias.directFutures.currency, "JPY");
  assert.equal(result.currencyBias.directFutures.netOpenInterestRatio, 1);
  assert.equal(result.currencyBias.directFutures.percentile3y, 100);
  assert.equal(result.currencyBias.pairRelative.baseCurrency, "USD");
  assert.equal(result.currencyBias.pairRelative.quoteCurrency, "JPY");
});

test("COT crowding context rejects an intraday timeframe", () => {
  assert.throws(() => computeCotCrowdingUnwindContext({ symbol: "OANDA:EURUSD", timeframe: "60", bars, observations }), /requires a 1D timeframe/);
});

test("a single-leg currency proxy is marked, not presented as a reading of the pair", () => {
  // GBPJPY reads British Pound futures, which are quoted against the dollar. Neither leg of the pair
  // is that dollar, so the contract says less here than it does for EURUSD, and the output has to
  // say so rather than wear the same shape.
  const crossObservations = observations.map((observation) => ({ ...observation, symbol: "OANDA:GBPJPY" }));
  const result = computeCotCrowdingUnwindContext({
    symbol: "OANDA:GBPJPY", timeframe: "1D", bars, observations: crossObservations,
  });
  assert.equal(result.currencyBias.proxyScope, "base_currency_single_leg");
  assert.equal(result.currencyBias.futuresMarket, "BRITISH POUND");
  assert.equal(result.currencyBias.directFutures.currency, "GBP");
  assert.match(result.currencyBias.pairRelative.interpretation, /single-leg proxy and not a reading of the pair/);
  assert.ok(result.qualityIssues.includes("cot_positioning_is_a_single_leg_currency_proxy_for_this_pair"));
  assert.equal(result.status, "partial");

  // A direct reading carries the same field set with the scope that distinguishes it.
  const direct = computeCotCrowdingUnwindContext({ symbol: "OANDA:EURUSD", timeframe: "1D", bars, observations });
  assert.equal(direct.currencyBias.proxyScope, "direct_base_asset");
  assert.ok(!direct.qualityIssues.some((issue) => issue.includes("single_leg")));
});

test("the underlying comes from the COT symbol table rather than a second list beside it", () => {
  // The hand-kept map this replaced listed two weak cross proxies and omitted gold, so its selection
  // had drifted from the scope field meant to decide it. Deriving it removes the second list, and
  // what a symbol is used for is then decided by declared properties rather than by that omission.
  assert.throws(() => computeCotCrowdingUnwindContext({
    symbol: "OANDA:AUDNZD", timeframe: "1D", bars,
    observations: observations.map((observation) => ({ ...observation, symbol: "OANDA:AUDNZD" })),
  }), /unavailable for OANDA:AUDNZD/);
});

test("gold is refused here even though the COT table carries it as a direct reading", () => {
  // Every field of this context is framed as currency bias, and the bound tool declares a daily FX
  // chart. Supporting gold in the pure function alone would put a capability where no caller can
  // reach it - the same divergence between entrance and implementation this project keeps closing.
  assert.throws(() => computeCotCrowdingUnwindContext({
    symbol: "OANDA:XAUUSD", timeframe: "1D", bars,
    observations: observations.map((observation) => ({ ...observation, symbol: "OANDA:XAUUSD" })),
  }), /currency futures only, and OANDA:XAUUSD trades on GOLD/);
});

test("the break bar is reported so it can be placed against the COT availability time", () => {
  const result = computeCotCrowdingUnwindContext({ symbol: "OANDA:EURUSD", timeframe: "1D", bars, observations });
  assert.equal(result.priceStructure.latestBarAt, bars.at(-1).timeIso);
  // The reference window ends one bar earlier, so without the break bar there was nothing in the
  // output to compare availableAt against.
  assert.equal(result.priceStructure.referenceEnd, bars.at(-2).timeIso);
  assert.ok(Date.parse(result.priceStructure.latestBarAt) > Date.parse(result.priceStructure.referenceEnd));
  assert.equal(typeof result.cotContract.availableAt, "string");
});
