export type CostAdjustedRiskRewardInput = {
  symbol: string;
  direction: "long" | "short";
  price_basis: "bid" | "ask" | "mid" | "executable";
  price_unit: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  bid: number;
  ask: number;
  entry_slippage_price: number;
  stop_slippage_price: number;
  target_slippage_price: number;
  round_trip_fee_price: number;
};

function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function nonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be an explicit non-negative finite number`);
  }
}

/** Conditional price-unit arithmetic only; no quote acquisition or execution readiness. */
export function computeCostAdjustedRiskReward(input: CostAdjustedRiskRewardInput) {
  if (typeof input.symbol !== "string" || !/^[\w!.:&-]{1,48}(?:\/[\w!.:&-]{1,48})?$/.test(input.symbol)) {
    throw new Error("symbol must be a bounded instrument identifier");
  }
  if (!["long", "short"].includes(input.direction)) throw new Error("direction must be long or short");
  if (!["bid", "ask", "mid", "executable"].includes(input.price_basis)) {
    throw new Error("price_basis must be bid, ask, mid, or executable");
  }
  if (typeof input.price_unit !== "string" || input.price_unit.trim().length < 1 || input.price_unit.length > 80
    || /[\x00-\x1f\x7f]/.test(input.price_unit)) {
    throw new Error("price_unit must be a non-empty label of at most 80 characters without control characters");
  }
  for (const key of ["entry_price", "stop_price", "target_price", "bid", "ask"] as const) {
    positive(input[key], key);
  }
  for (const key of ["entry_slippage_price", "stop_slippage_price", "target_slippage_price", "round_trip_fee_price"] as const) {
    nonnegative(input[key], key);
  }
  if (input.ask < input.bid) throw new Error("ask must be greater than or equal to bid");

  const direction = input.direction === "long" ? 1 : -1;
  const grossRisk = direction * (input.entry_price - input.stop_price);
  const grossReward = direction * (input.target_price - input.entry_price);
  if (grossRisk <= 0 || grossReward <= 0) {
    throw new Error("stop and target must strictly bracket entry in the declared trade direction");
  }
  const spread = input.ask - input.bid;
  const appliedSpread = input.price_basis === "executable" ? 0 : spread;
  const bidOffset = input.price_basis === "ask" ? -spread : input.price_basis === "mid" ? -spread / 2 : 0;
  const askOffset = input.price_basis === "bid" ? spread : input.price_basis === "mid" ? spread / 2 : 0;

  const fill = (referencePrice: number, side: "buy" | "sell", slippage: number) => {
    const spreadAdjustment = side === "buy" ? askOffset : bidOffset;
    const slippageAdjustment = side === "buy" ? slippage : -slippage;
    const modeledPrice = referencePrice + spreadAdjustment + slippageAdjustment;
    positive(modeledPrice, "modeled fill price");
    return {
      side,
      quote_side: side === "buy" ? "ask" : "bid",
      reference_price: referencePrice,
      spread_adjustment_price: spreadAdjustment,
      slippage_adjustment_price: slippageAdjustment,
      modeled_price: modeledPrice,
    };
  };
  const entrySide = input.direction === "long" ? "buy" : "sell";
  const exitSide = input.direction === "long" ? "sell" : "buy";
  const fills = {
    entry: fill(input.entry_price, entrySide, input.entry_slippage_price),
    stop: fill(input.stop_price, exitSide, input.stop_slippage_price),
    target: fill(input.target_price, exitSide, input.target_slippage_price),
  };
  const stopCost = appliedSpread + input.entry_slippage_price + input.stop_slippage_price + input.round_trip_fee_price;
  const targetCost = appliedSpread + input.entry_slippage_price + input.target_slippage_price + input.round_trip_fee_price;
  const loss = grossRisk + stopCost;
  const profit = grossReward - targetCost;
  const grossRatio = grossReward / grossRisk;
  const netRatio = profit / loss;
  const mid = input.bid + spread / 2;
  if (![grossRisk, grossReward, stopCost, targetCost, loss, profit, grossRatio, netRatio, mid].every(Number.isFinite)) {
    throw new Error("cost-adjusted risk/reward arithmetic exceeds the finite numeric range");
  }

  return {
    schema_version: "1.0",
    rule_version: "cost_adjusted_risk_reward_v1",
    status: "computed",
    candidateEligible: false,
    data_use: "conditional_scenario_arithmetic_not_execution_readiness",
    symbol: input.symbol,
    direction: input.direction,
    price_unit: input.price_unit.trim(),
    unit_basis: "caller_declared_not_verified",
    price_basis: input.price_basis,
    reference_prices: { entry: input.entry_price, stop: input.stop_price, target: input.target_price },
    quote: {
      source: "caller_supplied",
      bid: input.bid,
      ask: input.ask,
      mid,
      spread_price: spread,
      observed_at: null,
      freshness_verified: false,
      used_for_spread_adjustment: input.price_basis !== "executable",
    },
    fills,
    gross: { risk_price: grossRisk, reward_price: grossReward, reward_to_risk: grossRatio },
    costs: {
      applied_spread_price: appliedSpread,
      entry_slippage_price: input.entry_slippage_price,
      stop_slippage_price: input.stop_slippage_price,
      target_slippage_price: input.target_slippage_price,
      round_trip_fee_price: input.round_trip_fee_price,
      stop_round_trip_price: stopCost,
      target_round_trip_price: targetCost,
    },
    net: {
      loss_at_stop_price: loss,
      profit_at_target_price: profit,
      reward_to_risk: netRatio,
      target_profitable_after_costs: profit > 0,
    },
    assumptions: [
      "Every level and cost uses the same caller-declared native price unit, not pips, ticks, lots or account-currency money. Linear price PnL only; no quantity or contract multiplier is inferred.",
      "For bid/ask/mid basis all three input levels share that reference side. The supplied spread is assumed constant at entry, stop and target, and is applied once per round trip.",
      "Executable basis means entry is already on the entry-side quote and stop/target are already on the opposite-side exit quote, before slippage and fees. No extra spread is added; the supplied quote is informational only.",
      "Slippage is an explicit adverse price amount per leg. The round-trip fee is already converted into the same price unit and is charged once in each alternative exit scenario; it must not be embedded in input levels.",
      "Stop and target are separate hypothetical outcomes, not simultaneous charges. A negative target profit or ratio is retained, not clamped to zero.",
    ],
    limitations: [
      "Caller quotes and unit labels are not independently verified. Computed does not mean a fresh, tradable or broker-executable quote, an approved trade, or a risk limit.",
      "Levels are reference scenarios, not broker order prices or stop/limit trigger rules. Fills, liquidity, gaps and spread widening are not guaranteed; losses can exceed the modeled stop scenario.",
      "Financing, swap, taxes, market impact and other fees are excluded unless represented by the explicit fee/slippage inputs. No tick rounding, contract validation or currency conversion is performed.",
      "The ratio is conditional target profit divided by conditional stop loss, not expected return, profit factor, win probability or evidence of an edge. No account, order, alert, chart, external feed or journal access occurs.",
    ],
  };
}
