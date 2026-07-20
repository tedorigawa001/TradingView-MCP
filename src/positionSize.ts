import { getInstrumentMetadata } from "./instrumentMetadata.js";

export type PositionSizeInput = {
  symbol: string;
  account_currency: string;
  account_equity: number;
  risk_percent?: number;
  risk_amount?: number;
  entry_price: number;
  stop_price: number;
  round_trip_cost_price_per_unit?: number;
  contract_multiplier?: number;
  quantity_step: number;
  minimum_quantity: number;
  maximum_quantity?: number;
  quote_to_account_rate?: number;
  conversion_symbol?: string;
  conversion_observed_at?: string;
  max_conversion_age_seconds?: number;
};

type PositionSizeIssue = {
  code: string;
  severity: "error";
  message: string;
};

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function positiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`);
}

function cleanNumber(value: number): number {
  return Number(value.toPrecision(10));
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) {
    const [coefficient, exponent] = text.split("e-");
    return Number(exponent) + (coefficient.split(".")[1]?.length ?? 0);
  }
  return text.split(".")[1]?.length ?? 0;
}

function floorToStep(value: number, step: number): number {
  const places = Math.min(12, decimalPlaces(step));
  const scale = 10 ** places;
  const stepUnits = Math.round(step * scale);
  if (stepUnits <= 0) throw new Error("quantity_step must be representable with at most 12 decimal places");
  if (value * scale > Number.MAX_SAFE_INTEGER) throw new Error("quantity exceeds the supported exact rounding range");
  const valueUnits = Math.floor(value * scale + Number.EPSILON);
  return Math.floor(valueUnits / stepUnits) * stepUnits / scale;
}

export function computePositionSize(input: PositionSizeInput, now = new Date()) {
  const accountCurrency = input.account_currency.toUpperCase();
  if (!CURRENCY_PATTERN.test(accountCurrency)) throw new Error("account_currency must be a three-letter ISO currency code");
  positiveFinite(input.account_equity, "account_equity");
  positiveFinite(input.entry_price, "entry_price");
  positiveFinite(input.stop_price, "stop_price");
  positiveFinite(input.quantity_step, "quantity_step");
  positiveFinite(input.minimum_quantity, "minimum_quantity");
  if (input.maximum_quantity !== undefined) positiveFinite(input.maximum_quantity, "maximum_quantity");
  if (input.maximum_quantity !== undefined && input.maximum_quantity < input.minimum_quantity) {
    throw new Error("maximum_quantity must be greater than or equal to minimum_quantity");
  }
  if (decimalPlaces(input.quantity_step) > 12) throw new Error("quantity_step must use at most 12 decimal places");
  if (input.entry_price === input.stop_price) throw new Error("entry_price and stop_price must define a non-zero stop distance");

  const hasRiskPercent = input.risk_percent !== undefined;
  const hasRiskAmount = input.risk_amount !== undefined;
  if (hasRiskPercent === hasRiskAmount) throw new Error("provide exactly one of risk_percent or risk_amount");
  if (hasRiskPercent) {
    positiveFinite(input.risk_percent!, "risk_percent");
    if (input.risk_percent! > 100) throw new Error("risk_percent must not exceed 100");
  }
  if (hasRiskAmount) {
    positiveFinite(input.risk_amount!, "risk_amount");
    if (input.risk_amount! > input.account_equity) throw new Error("risk_amount must not exceed account_equity");
  }

  const roundTripCost = input.round_trip_cost_price_per_unit ?? 0;
  if (!Number.isFinite(roundTripCost) || roundTripCost < 0) {
    throw new Error("round_trip_cost_price_per_unit must be a non-negative finite number");
  }
  const contractMultiplier = input.contract_multiplier ?? 1;
  positiveFinite(contractMultiplier, "contract_multiplier");
  const maxAgeSeconds = input.max_conversion_age_seconds ?? 60;
  positiveFinite(maxAgeSeconds, "max_conversion_age_seconds");

  const metadata = getInstrumentMetadata(input.symbol);
  const quoteCurrency = metadata.quote_currency;
  const riskBudget = hasRiskAmount
    ? input.risk_amount!
    : input.account_equity * input.risk_percent! / 100;
  const stopDistance = Math.abs(input.entry_price - input.stop_price);
  const issues: PositionSizeIssue[] = [];

  let conversionRate: number | null = null;
  let conversionAgeSeconds: number | null = null;
  let conversionBasis: "same_currency" | "quote_to_account" | "unavailable" = "unavailable";
  if (quoteCurrency === null) {
    issues.push({ code: "quote_currency_unavailable", severity: "error", message: `Quote currency metadata is unavailable for ${input.symbol}.` });
  } else if (quoteCurrency === accountCurrency) {
    conversionRate = 1;
    conversionBasis = "same_currency";
  } else if (
    input.quote_to_account_rate === undefined
    || input.conversion_symbol === undefined
    || input.conversion_observed_at === undefined
  ) {
    issues.push({
      code: "conversion_evidence_missing",
      severity: "error",
      message: `A quote-to-account conversion rate, symbol, and observation time are required for ${quoteCurrency}/${accountCurrency}.`,
    });
  } else {
    if (!Number.isFinite(input.quote_to_account_rate) || input.quote_to_account_rate <= 0) {
      throw new Error("quote_to_account_rate must be a positive finite number");
    }
    const observedAtMs = Date.parse(input.conversion_observed_at);
    if (!Number.isFinite(observedAtMs)) throw new Error("conversion_observed_at must be a valid ISO timestamp");
    conversionAgeSeconds = (now.getTime() - observedAtMs) / 1000;
    if (conversionAgeSeconds < 0) {
      issues.push({ code: "conversion_timestamp_in_future", severity: "error", message: "Conversion evidence is timestamped in the future." });
    } else if (conversionAgeSeconds > maxAgeSeconds) {
      issues.push({
        code: "conversion_evidence_stale",
        severity: "error",
        message: `Conversion evidence is ${conversionAgeSeconds.toFixed(3)} seconds old; maximum is ${maxAgeSeconds}.`,
      });
    } else {
      conversionRate = input.quote_to_account_rate;
      conversionBasis = "quote_to_account";
    }
  }

  const common = {
    schema_version: "1.0",
    status: issues.length > 0 ? "blocked" as const : "ready" as const,
    symbol: input.symbol,
    direction: input.stop_price < input.entry_price ? "long" as const : "short" as const,
    account_currency: accountCurrency,
    quote_currency: quoteCurrency,
    account_equity: input.account_equity,
    risk_budget: cleanNumber(riskBudget),
    risk_percent: cleanNumber(riskBudget / input.account_equity * 100),
    entry_price: input.entry_price,
    stop_price: input.stop_price,
    stop_distance_price: cleanNumber(stopDistance),
    round_trip_cost_price_per_unit: roundTripCost,
    contract_multiplier: contractMultiplier,
    quantity_step: input.quantity_step,
    minimum_quantity: input.minimum_quantity,
    maximum_quantity: input.maximum_quantity ?? null,
    conversion: {
      basis: conversionBasis,
      rate: conversionRate,
      meaning: quoteCurrency === null ? null : `${accountCurrency} per 1 ${quoteCurrency}`,
      symbol: input.conversion_symbol ?? null,
      observed_at: input.conversion_observed_at ?? null,
      age_seconds: conversionAgeSeconds === null ? null : cleanNumber(conversionAgeSeconds),
      max_age_seconds: maxAgeSeconds,
    },
    quality_issues: issues,
    assumptions: [
      "Quantity is an instrument unit count, not a broker-specific lot size.",
      "Estimated loss includes the full entry-to-stop price move plus the supplied round-trip cost.",
      "The result is a sizing calculation only and does not access an account or place an order.",
    ],
  };

  if (issues.length > 0 || conversionRate === null) {
    return { ...common, quantity: null, raw_quantity: null, estimated_loss_at_stop: null, unused_risk_budget: null };
  }

  const lossQuotePerQuantity = (stopDistance + roundTripCost) * contractMultiplier;
  const lossAccountPerQuantity = lossQuotePerQuantity * conversionRate;
  const uncappedRawQuantity = riskBudget / lossAccountPerQuantity;
  const cappedRawQuantity = Math.min(uncappedRawQuantity, input.maximum_quantity ?? Number.POSITIVE_INFINITY);
  let quantity = floorToStep(cappedRawQuantity, input.quantity_step);
  let estimatedLoss = quantity * lossAccountPerQuantity;
  while (quantity > 0 && estimatedLoss > riskBudget) {
    quantity = floorToStep(quantity - input.quantity_step, input.quantity_step);
    estimatedLoss = quantity * lossAccountPerQuantity;
  }

  if (quantity < input.minimum_quantity) {
    const minimumLoss = input.minimum_quantity * lossAccountPerQuantity;
    return {
      ...common,
      status: "blocked" as const,
      quantity: null,
      raw_quantity: cleanNumber(uncappedRawQuantity),
      estimated_loss_at_stop: null,
      unused_risk_budget: null,
      quality_issues: [{
        code: "below_minimum_quantity",
        severity: "error" as const,
        message: `The risk budget supports ${uncappedRawQuantity} units, below the minimum quantity ${input.minimum_quantity}; minimum estimated loss would be ${minimumLoss} ${accountCurrency}.`,
      }],
    };
  }

  const displayedEstimatedLoss = cleanNumber(estimatedLoss);
  return {
    ...common,
    quantity,
    raw_quantity: cleanNumber(uncappedRawQuantity),
    capped_by_maximum: input.maximum_quantity !== undefined && uncappedRawQuantity > input.maximum_quantity,
    loss_per_quantity: {
      stop_move_quote_currency: cleanNumber(stopDistance * contractMultiplier),
      round_trip_cost_quote_currency: cleanNumber(roundTripCost * contractMultiplier),
      total_quote_currency: cleanNumber(lossQuotePerQuantity),
      total_account_currency: cleanNumber(lossAccountPerQuantity),
    },
    estimated_loss_at_stop: displayedEstimatedLoss,
    effective_risk_percent: cleanNumber(displayedEstimatedLoss / input.account_equity * 100),
    unused_risk_budget: cleanNumber(cleanNumber(riskBudget) - displayedEstimatedLoss),
  };
}
