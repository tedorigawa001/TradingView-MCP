export function labelFutureReturn(input: { entry_price: number; exit_price: number; threshold_bps: number }) {
  const { entry_price, exit_price, threshold_bps } = input;
  if (![entry_price, exit_price, threshold_bps].every(Number.isFinite) || entry_price <= 0 || exit_price <= 0 || threshold_bps < 0) {
    throw new Error("prices must be positive and threshold_bps must be non-negative finite values");
  }
  const returnBps = ((exit_price / entry_price) - 1) * 10_000;
  return { return_bps: returnBps, label: returnBps >= threshold_bps ? "up" : returnBps <= -threshold_bps ? "down" : "flat" };
}
