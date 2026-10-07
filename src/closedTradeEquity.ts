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
 * happened. Trades closing at the same time realize together, so equity moves once per exit time and their order in
 * the ledger cannot change the result. Null when a trade lacks its exit time, since its place is unknown.
 */
export function closedTradeEquityDrawdown(trades: ReadonlyArray<{ profit: number; exitTime: number | null }>): number | null {
  const byExit = new Map<number, number>();
  for (const trade of trades) {
    if (trade.exitTime === null || !Number.isFinite(trade.exitTime)) return null;
    byExit.set(trade.exitTime, (byExit.get(trade.exitTime) ?? 0) + trade.profit);
  }
  return sequenceEquityDrawdown([...byExit].sort(([left], [right]) => left - right).map(([, profit]) => profit));
}
