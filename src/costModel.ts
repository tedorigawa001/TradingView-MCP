import { getInstrumentMetadata } from "./instrumentMetadata.js";

export function computeRoundTripCost(input: { symbol: string; bid: number; ask: number; quantity: number; commission_per_unit?: number; slippage_pips_per_side?: number }) {
  if (![input.bid, input.ask, input.quantity].every(Number.isFinite) || input.bid <= 0 || input.ask < input.bid || input.quantity <= 0) {
    throw new Error("bid, ask, and quantity must be positive finite values with ask >= bid");
  }
  const meta = getInstrumentMetadata(input.symbol);
  if (meta.pip_size === null) throw new Error(`pip_size is unavailable for ${input.symbol}`);
  const spread = input.ask - input.bid;
  const slippagePips = input.slippage_pips_per_side ?? 0;
  if (!Number.isFinite(slippagePips) || slippagePips < 0) throw new Error("slippage_pips_per_side must be a non-negative finite number");
  const commission = input.commission_per_unit ?? 0;
  if (!Number.isFinite(commission) || commission < 0) throw new Error("commission_per_unit must be a non-negative finite number");
  const slippage = slippagePips * meta.pip_size * 2;
  const totalPrice = spread + slippage + commission * 2;
  return { symbol: input.symbol, quantity: input.quantity, spread_price: spread, spread_pips: spread / meta.pip_size, slippage_pips_round_trip: slippagePips * 2, total_price_per_unit: totalPrice, total_quote_currency: totalPrice * input.quantity, quote_currency: meta.quote_currency, assumptions: "spread once plus slippage and commission on both entry and exit" };
}
