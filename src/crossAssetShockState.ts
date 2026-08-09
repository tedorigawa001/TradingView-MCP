import { marketRegimeResolutionMilliseconds } from "./marketRegimes.js";

export const CROSS_ASSET_SHOCK_STATE_V1 = {
  contract_id: "cross_asset_shock_state_v1",
  target_symbols: ["OANDA:EURUSD", "OANDA:USDJPY"],
  timeframes: ["5", "15"],
  return_standardization: "prior_12_same_utc_weekday_and_time_slot_return_rms",
  minimum_prior_same_slot_returns: 12,
  shock_threshold_rms: 2.5,
  alignment: "exact_utc_closed_bar_no_forward_fill",
  target_context_polarity: {
    "OANDA:EURUSD": { dxy: -1, us_yield: -1, xauusd: 1 },
    "OANDA:USDJPY": { dxy: 1, us_yield: 1, xauusd: -1 },
  },
  states: ["cross_asset_confirmed", "partial_confirmation", "target_only", "cross_asset_conflict"],
  purpose: "descriptive_observed_shock_state_only_not_a_forward_outcome_or_trade_signal",
} as const;

type ContextRole = "dxy" | "us_yield" | "xauusd";
type ShockState = (typeof CROSS_ASSET_SHOCK_STATE_V1.states)[number] | "not_target_shock" | "insufficient_baseline";
type Observation = { time: number; timeIso: string; target_fx: number; dxy: number; us_yield: number; xauusd: number };
type ReturnObservation = Observation & { returnsBps: Record<"target_fx" | ContextRole, number> };

const ROLES: readonly ("target_fx" | ContextRole)[] = ["target_fx", "dxy", "us_yield", "xauusd"];

function validate(input: { timeframe: string; targetSymbol: string; observations: readonly Observation[] }) {
  if (!CROSS_ASSET_SHOCK_STATE_V1.timeframes.includes(input.timeframe as "5" | "15")) {
    throw new Error("cross-asset shock state only supports 5 or 15 minute timeframes");
  }
  if (!(CROSS_ASSET_SHOCK_STATE_V1.target_symbols as readonly string[]).includes(input.targetSymbol.toUpperCase())) {
    throw new Error("cross-asset shock state target symbol is unsupported");
  }
  if (input.observations.length < 2 || input.observations.length > 20_000) {
    throw new Error("cross-asset shock state requires two to 20000 aligned observations");
  }
  let previous = -Infinity;
  for (const row of input.observations) {
    if (!Number.isFinite(row.time) || row.time <= previous) throw new Error("cross-asset shock state timestamps must be strictly increasing");
    for (const role of ROLES) {
      if (!Number.isFinite(row[role]) || row[role] <= 0) throw new Error(`cross-asset shock state ${role} price must be finite and positive`);
    }
    previous = row.time;
  }
}

function slotKey(timeSeconds: number) {
  const date = new Date(timeSeconds * 1_000);
  return `${date.getUTCDay()}:${date.getUTCHours()}:${date.getUTCMinutes()}`;
}

function rms(values: readonly number[]) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

/**
 * Classifies only information observable at a shock bar. Forward returns deliberately belong to a
 * later study, so a state cannot be promoted by its own subsequent outcome.
 */
export function computeCrossAssetShockStates(input: {
  timeframe: string;
  targetSymbol: string;
  observations: readonly Observation[];
}) {
  validate(input);
  const intervalMilliseconds = marketRegimeResolutionMilliseconds(input.timeframe);
  if (intervalMilliseconds === null) throw new Error("cross-asset shock state timeframe resolution is invalid");
  const intervalSeconds = intervalMilliseconds / 1_000;
  if (input.observations.some((row) => row.time % intervalSeconds !== 0)) {
    throw new Error("cross-asset shock state timestamps must be aligned to the requested timeframe grid");
  }
  const returns: ReturnObservation[] = [];
  let nonContiguousInputIntervals = 0;
  for (let index = 1; index < input.observations.length; index += 1) {
    const previous = input.observations[index - 1];
    const current = input.observations[index];
    if (current.time - previous.time !== intervalSeconds) {
      nonContiguousInputIntervals += 1;
      continue;
    }
    returns.push({
      ...current,
      returnsBps: Object.fromEntries(ROLES.map((role) => [role, ((current[role] / previous[role]) - 1) * 10_000])) as ReturnObservation["returnsBps"],
    });
  }
  const priorBySlot = new Map<string, ReturnObservation[]>();
  const polarity = CROSS_ASSET_SHOCK_STATE_V1.target_context_polarity[input.targetSymbol.toUpperCase() as "OANDA:EURUSD" | "OANDA:USDJPY"];
  let insufficientBaselineReturns = 0;
  const stateCounts: Record<ShockState, number> = {
    cross_asset_confirmed: 0, partial_confirmation: 0, target_only: 0, cross_asset_conflict: 0,
    not_target_shock: 0, insufficient_baseline: 0,
  };
  const states = returns.map((current) => {
    const slot = slotKey(current.time);
    const prior = priorBySlot.get(slot) ?? [];
    const base = {
      time: current.time,
      time_iso: current.timeIso,
      target_return_bps: current.returnsBps.target_fx,
      state: "insufficient_baseline" as ShockState,
      context: Object.fromEntries((["dxy", "us_yield", "xauusd"] as const).map((role) => [role, {
        return_bps: current.returnsBps[role], score: null, direction: "not_evaluable" as const,
      }])),
    };
    const baselinePrior = prior.slice(-CROSS_ASSET_SHOCK_STATE_V1.minimum_prior_same_slot_returns);
    if (baselinePrior.length < CROSS_ASSET_SHOCK_STATE_V1.minimum_prior_same_slot_returns) {
      insufficientBaselineReturns += 1;
      stateCounts.insufficient_baseline += 1;
      priorBySlot.set(slot, [...prior, current].slice(-CROSS_ASSET_SHOCK_STATE_V1.minimum_prior_same_slot_returns));
      return base;
    }
    const baselines = Object.fromEntries(ROLES.map((role) => [role, rms(baselinePrior.map((row) => row.returnsBps[role]))])) as Record<"target_fx" | ContextRole, number>;
    if (ROLES.some((role) => baselines[role] === 0)) {
      insufficientBaselineReturns += 1;
      stateCounts.insufficient_baseline += 1;
      priorBySlot.set(slot, [...prior, current].slice(-CROSS_ASSET_SHOCK_STATE_V1.minimum_prior_same_slot_returns));
      return base;
    }
    const scores = Object.fromEntries(ROLES.map((role) => [role, current.returnsBps[role] / baselines[role]])) as Record<"target_fx" | ContextRole, number>;
    const direction = Math.sign(scores.target_fx);
    const context = Object.fromEntries((["dxy", "us_yield", "xauusd"] as const).map((role) => {
      const contextScore = scores[role];
      const contextIsShock = Math.abs(contextScore) >= CROSS_ASSET_SHOCK_STATE_V1.shock_threshold_rms;
      const expectedDirection = direction * polarity[role];
      return [role, {
        return_bps: current.returnsBps[role], score: contextScore,
        direction: !contextIsShock ? "not_shocked" as const : Math.sign(contextScore) === expectedDirection ? "confirming" as const : "conflicting" as const,
      }];
    })) as Record<ContextRole, { return_bps: number; score: number; direction: "not_shocked" | "confirming" | "conflicting" }>;
    let state: ShockState = "not_target_shock";
    if (Math.abs(scores.target_fx) >= CROSS_ASSET_SHOCK_STATE_V1.shock_threshold_rms) {
      const confirming = Object.values(context).filter((item) => item.direction === "confirming").length;
      const conflicting = Object.values(context).filter((item) => item.direction === "conflicting").length;
      state = conflicting > 0 ? "cross_asset_conflict"
        : confirming >= 2 ? "cross_asset_confirmed"
          : confirming === 1 ? "partial_confirmation" : "target_only";
    }
    stateCounts[state] += 1;
    priorBySlot.set(slot, [...prior, current].slice(-CROSS_ASSET_SHOCK_STATE_V1.minimum_prior_same_slot_returns));
    return { ...base, target_score: scores.target_fx, state, context };
  });
  return {
    schema_version: "1.0" as const,
    series: "cross_asset_shock_state" as const,
    contract: CROSS_ASSET_SHOCK_STATE_V1,
    status: "complete" as const,
    target_symbol: input.targetSymbol.toUpperCase(),
    timeframe: input.timeframe,
    quality: {
      aligned_observations: input.observations.length,
      contiguous_return_observations: returns.length,
      non_contiguous_input_intervals: nonContiguousInputIntervals,
      insufficient_baseline_returns: insufficientBaselineReturns,
    },
    state_counts: stateCounts,
    states,
    limitations: [
      "state_is_observed_at_the_closed_bar_and_does_not_measure_forward_continuation",
      "dxy_us_yield_and_xauusd_directional_polarities_are_frozen_proxies_not_a_complete_causal_model",
      "missing_intervals_are_excluded_and_never_forward_filled",
    ],
  };
}
