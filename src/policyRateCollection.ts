import { nextUtcBusinessDayStart, POLICY_RATE_SYMBOLS, type PolicyRateCurrency, type PolicyRateObservationVersion } from "./policyRateHistory.js";

export type PolicyRateBar = { timeIso: string; close: number; forming?: boolean };

/** Finds the latest genuine rate change rather than treating a monthly carry-forward bar as a decision. */
export function latestPolicyRateDecision(currency: PolicyRateCurrency, bars: PolicyRateBar[], observedAt: Date): PolicyRateObservationVersion {
  const closed = bars.filter((bar) => bar.forming !== true);
  if (closed.length < 2) throw new Error(`policy-rate ${currency} needs at least two closed bars`);
  for (let index = closed.length - 1; index > 0; index -= 1) {
    const current = closed[index];
    const previous = closed[index - 1];
    if (!Number.isFinite(current.close) || !Number.isFinite(previous.close)) throw new Error(`policy-rate ${currency} contains a non-finite value`);
    if (current.close !== previous.close) {
      return {
        currency, source_symbol: POLICY_RATE_SYMBOLS[currency], observation_date: current.timeIso.slice(0, 10), value: current.close,
        source_observed_at: current.timeIso, available_at: nextUtcBusinessDayStart(current.timeIso.slice(0, 10)), available_at_basis: "next_utc_business_day_start", observed_at: observedAt.toISOString(),
      };
    }
  }
  throw new Error(`policy-rate ${currency} has no observable decision in loaded history`);
}
