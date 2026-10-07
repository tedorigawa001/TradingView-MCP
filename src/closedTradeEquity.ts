/** Maximum drawdown of a running sum of profits, taken in the order given. */
export function sequenceEquityDrawdown(profits: readonly number[]): number {
  let equity = 0;
  let peak = 0;
  let maximum = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }
  return maximum;
}

/**
 * Maximum drawdown of closed-trade equity: realized profit summed in the order trades closed (BACKLOG 102-18). Entry
 * or ledger order is not when profit was realized, and with overlapping holds it can report a drawdown that never
 * happened.
 *
 * An exit time is a bar time, so trades closing at the same time are ordered by a fixed rule. Those closing at the same
 * price as well are one fill, realized together (a pyramided position closed at once). Fills at different prices in one
 * bar have no known order, so losses are taken before gains: the pessimistic intrabar convention, the deepest fall
 * those exits could cause at that moment (it is not a maximum over every order: gains first would raise the peak).
 * The ledger's own order therefore changes nothing, up to floating-point rounding. Null when a trade lacks its exit
 * time, since its place is unknown.
 */
export function closedTradeEquityDrawdown(trades: ReadonlyArray<{ profit: number; exitTime: number | null; exitPrice?: number | null }>): number | null {
  const byTime = new Map<number, Map<string, number>>();
  let unpriced = 0;
  for (const trade of trades) {
    if (trade.exitTime === null || !Number.isFinite(trade.exitTime)) return null;
    const fills = byTime.get(trade.exitTime) ?? new Map<string, number>();
    // An exit without a price cannot be shown to share a fill, so it stands alone.
    const fill = typeof trade.exitPrice === "number" && Number.isFinite(trade.exitPrice) ? `price:${trade.exitPrice}` : `unpriced:${unpriced++}`;
    fills.set(fill, (fills.get(fill) ?? 0) + trade.profit);
    byTime.set(trade.exitTime, fills);
  }
  return sequenceEquityDrawdown([...byTime].sort(([left], [right]) => left - right)
    .flatMap(([, fills]) => [...fills.values()].sort((left, right) => left - right)));
}
