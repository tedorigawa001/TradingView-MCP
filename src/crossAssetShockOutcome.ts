import type { OhlcvBar } from "./tradingview.js";
import { marketRegimeResolutionMilliseconds } from "./marketRegimes.js";
import { outcomeForEvent, summarizeOutcomes } from "./sessionAuctionStudy.js";

export const CROSS_ASSET_SHOCK_OUTCOME_V1 = {
  contract_id: "cross_asset_shock_outcome_v1",
  state_contract_id: "cross_asset_shock_state_v1",
  horizons: [1, 2, 4, 8],
  overlap_policy: "exclude_later_state_within_maximum_horizon",
  future_evidence: "exact_time_common_target_ohlc_contiguous_bars_only",
  reference: "state_bar_close_event_study_only_not_an_assumed_fill",
  inference: "descriptive_only_no_candidate_or_adoption_decision",
} as const;

type State = "cross_asset_confirmed" | "partial_confirmation" | "target_only" | "cross_asset_conflict";
type StateRow = { time: number; state: State; target_return_bps: number };
const STATES: readonly State[] = ["cross_asset_confirmed", "partial_confirmation", "target_only", "cross_asset_conflict"];

export function evaluateCrossAssetShockOutcomes(input: {
  timeframe: string;
  targetSymbol: string;
  bars: readonly OhlcvBar[];
  states: readonly StateRow[];
  minimumEventsPerState: number;
  eventLimit: number;
}) {
  const resolutionMs = marketRegimeResolutionMilliseconds(input.timeframe);
  if (resolutionMs === null || !["5", "15"].includes(input.timeframe)) throw new Error("cross-asset shock outcomes only support 5 or 15 minute timeframes");
  if (!Number.isInteger(input.minimumEventsPerState) || input.minimumEventsPerState < 1 || input.minimumEventsPerState > 500) throw new Error("minimum events per state must be an integer from 1 to 500");
  if (!Number.isInteger(input.eventLimit) || input.eventLimit < 1 || input.eventLimit > 500) throw new Error("event limit must be an integer from 1 to 500");
  const bars = [...input.bars].sort((left, right) => left.time - right.time);
  if (bars.length < 2 || bars.some((bar, index) => !Number.isFinite(bar.close) || bar.close <= 0 || (index > 0 && bar.time <= bars[index - 1].time))) throw new Error("cross-asset shock outcome bars must be strictly ordered valid OHLC");
  const byTime = new Map(bars.map((bar, index) => [bar.time, index]));
  const maxHorizon = Math.max(...CROSS_ASSET_SHOCK_OUTCOME_V1.horizons);
  const selected: Array<StateRow & { signalIndex: number; direction: 1 | -1 }> = [];
  let unalignedStatesExcluded = 0;
  let overlappingStatesExcluded = 0;
  for (const state of [...input.states].sort((left, right) => left.time - right.time)) {
    const signalIndex = byTime.get(state.time);
    if (signalIndex === undefined) { unalignedStatesExcluded += 1; continue; }
    const previous = selected.at(-1);
    if (previous && state.time - previous.time < maxHorizon * resolutionMs / 1_000) { overlappingStatesExcluded += 1; continue; }
    selected.push({ ...state, signalIndex, direction: state.target_return_bps > 0 ? 1 : -1 });
  }
  const events = selected.map((state) => outcomeForEvent(state, bars, [...CROSS_ASSET_SHOCK_OUTCOME_V1.horizons], resolutionMs, 20));
  const byState = Object.fromEntries(STATES.map((state) => {
    const subset = events.filter((event) => event.state === state);
    return [state, { events: subset.length, horizons: summarizeOutcomes(subset, [...CROSS_ASSET_SHOCK_OUTCOME_V1.horizons], 0.95, "global") }];
  }));
  const qualityIssues = [
    ...(STATES.filter((state) => (byState[state].events as number) < input.minimumEventsPerState).map((state) => `minimum_events_not_met:${state}`)),
    ...(unalignedStatesExcluded > 0 ? ["one_or_more_states_not_aligned_to_common_target_bars"] : []),
  ];
  return {
    schema_version: "1.0" as const,
    series: "cross_asset_shock_outcome" as const,
    contract: CROSS_ASSET_SHOCK_OUTCOME_V1,
    status: qualityIssues.length === 0 ? "complete" as const : "partial" as const,
    target_symbol: input.targetSymbol,
    timeframe: input.timeframe,
    sample: { supplied_states: input.states.length, selected_states: selected.length, minimum_events_per_state: input.minimumEventsPerState },
    quality: { unaligned_states_excluded: unalignedStatesExcluded, overlapping_states_excluded: overlappingStatesExcluded },
    quality_issues: qualityIssues,
    by_state: byState,
    events: events.slice(0, input.eventLimit).map((event) => ({ time: event.time, state: event.state, signal_time: event.signalTime, signal_price: event.signalPrice, outcomes: event.outcomes })),
    limitations: ["directional_return_is_measured_in_the_observed_shock_direction", "outcomes_are_descriptive_and_not_a_candidate_decision", "confidence_intervals_do_not_adjust_for_event_dependence_or_multiple_testing"],
  };
}
