import { canonicalDefinitionHash } from "./canonicalDefinition.js";
import { runEventAftershockRetestStudy } from "./eventAftershockRetestStudy.js";
import { assertAdmissibleAggregate } from "./fxCsvFeatureScanCli.js";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import type { OfficialMacroEvent, OfficialMacroEventArtifact, OfficialMacroEventKind } from "./officialMacroEventSources.js";

export type MacroEvent60mContract = {
  contract_id: string;
  eligible_event_kind: OfficialMacroEventKind | null;
  timeframe: "60";
  initial_range_bars: number;
  breakout_within_bars: number;
  retest_within_bars: number;
  require_retest_close_outside: boolean;
  minimum_initial_range_coverage: number;
  horizons: readonly number[];
  target_return_bps: number;
  minimum_events: number;
  minimum_events_per_branch: number;
  confidence_level: 0.9 | 0.95 | 0.99;
  configuration_trials: number;
  event_anchor: string;
  release_to_anchor_delay_minutes: string;
  session_boundary_policy: string;
};

export const MACRO_EVENT_60M_CONTRACT = {
  contract_id: "us_macro_aftershock_m60_v1",
  eligible_event_kind: null,
  timeframe: "60",
  initial_range_bars: 1,
  breakout_within_bars: 4,
  retest_within_bars: 8,
  require_retest_close_outside: true,
  minimum_initial_range_coverage: 1,
  horizons: [1, 2, 4, 8],
  target_return_bps: 10,
  minimum_events: 20,
  minimum_events_per_branch: 10,
  confidence_level: 0.95,
  configuration_trials: 1,
  event_anchor: "first_utc_hour_bar_starting_at_or_after_release",
  release_to_anchor_delay_minutes: "reported_per_study_not_equalized_across_event_kinds",
  session_boundary_policy: "all_windows_require_contiguous_observed_bars",
} as const satisfies MacroEvent60mContract;

/**
 * NFP is released on Friday.  This exploratory contract is deliberately short enough to finish
 * in a normal Friday FX session; it does not relax the contiguous-bar requirement at a weekend.
 */
export const NFP_SHORT_FRIDAY_60M_CONTRACT = {
  contract_id: "us_nfp_short_friday_aftershock_m60_v2",
  eligible_event_kind: "us_nfp",
  timeframe: "60",
  initial_range_bars: 1,
  breakout_within_bars: 2,
  retest_within_bars: 3,
  require_retest_close_outside: true,
  minimum_initial_range_coverage: 1,
  horizons: [1],
  target_return_bps: 10,
  minimum_events: 20,
  minimum_events_per_branch: 10,
  confidence_level: 0.95,
  configuration_trials: 2,
  event_anchor: "first_utc_hour_bar_starting_at_or_after_release",
  release_to_anchor_delay_minutes: "reported_per_study_not_equalized_across_event_kinds",
  session_boundary_policy: "short_window_must_complete_before_unobserved_session_boundary",
} as const satisfies MacroEvent60mContract;

export const MACRO_EVENT_60M_CONTRACTS = {
  macro_aftershock_v1: MACRO_EVENT_60M_CONTRACT,
  nfp_short_friday_v2: NFP_SHORT_FRIDAY_60M_CONTRACT,
} as const;

export type MacroEvent60mContractId = keyof typeof MACRO_EVENT_60M_CONTRACTS;

export function firstFullM60BarAfterRelease(occurredAt: string): string {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== occurredAt) throw new Error("official macro event timestamp must be canonical ISO UTC");
  return new Date(Math.ceil(timestamp / 3_600_000) * 3_600_000).toISOString();
}

export function buildMacroEvent60mStudy(input: { manifest: FxCsvM1AggregationManifest; bars: AggregatedBar[]; artifact: OfficialMacroEventArtifact; folds: Array<{ foldId: string; from: string; to: string }>; eventLimit?: number; contractId?: MacroEvent60mContractId }) {
  if (input.manifest.bucket_minutes !== 60) throw new Error("macro event study requires a 60-minute aggregate");
  if (input.artifact.event_kind !== "us_cpi" && input.artifact.event_kind !== "us_nfp" && input.artifact.event_kind !== "fomc_statement") throw new Error("macro event artifact kind is invalid");
  const contract = MACRO_EVENT_60M_CONTRACTS[input.contractId ?? "macro_aftershock_v1"];
  if (contract.eligible_event_kind !== null && input.artifact.event_kind !== contract.eligible_event_kind) {
    throw new Error(`${contract.contract_id} only supports ${contract.eligible_event_kind}`);
  }
  assertAdmissibleAggregate(input.manifest, input.bars);
  if (!input.artifact.coverage || input.artifact.coverage.coverage_issues.length > 0) throw new Error("macro event artifact does not prove the requested release-history coverage");
  const selected: OfficialMacroEvent[] = input.artifact.events.filter((event) => event.event_kind === input.artifact.event_kind);
  if (selected.length !== input.artifact.events.length) throw new Error("macro event artifact must contain exactly one event kind");
  const bars = input.bars.map((bar) => ({ time: Math.floor(Date.parse(bar.timeIso) / 1000), timeIso: bar.timeIso, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.tickVolume }));
  const anchoredEvents = selected.map((event) => ({ event, anchor_at: firstFullM60BarAfterRelease(event.occurred_at) }));
  const releaseToAnchorDelays = anchoredEvents.map(({ event, anchor_at }) => (Date.parse(anchor_at) - Date.parse(event.occurred_at)) / 60_000);
  const result = runEventAftershockRetestStudy({
    bars, symbol: input.manifest.symbol, timeframe: "60",
    events: anchoredEvents.map(({ event, anchor_at }) => ({ eventId: event.event_id, occurredAt: anchor_at })),
    initialRangeBars: contract.initial_range_bars, breakoutWithinBars: contract.breakout_within_bars, retestWithinBars: contract.retest_within_bars,
    overlapPolicy: "exclude_later_event", requireRetestCloseOutside: contract.require_retest_close_outside, minimumInitialRangeCoverage: contract.minimum_initial_range_coverage,
    horizons: [...contract.horizons], targetReturnBps: contract.target_return_bps, minimumEvents: contract.minimum_events,
    folds: input.folds, eventLimit: input.eventLimit ?? 200, confidenceLevel: contract.confidence_level, configurationTrials: contract.configuration_trials, regime: null,
  });
  const branchCounts = Object.fromEntries(Object.entries(result.byBranch).map(([branch, summary]) => [branch, summary.events]));
  const underpopulatedBranches = Object.entries(branchCounts).filter(([, count]) => count < contract.minimum_events_per_branch).map(([branch]) => branch);
  return {
    schema_version: "1.0" as const, series: "official_macro_event_aftershock_m60" as const, evidence_tier: "official_revised_history" as const,
    contract, contract_hash: canonicalDefinitionHash(contract), event_kind: input.artifact.event_kind,
    source: { event_artifact_retrieved_at: input.artifact.retrieved_at, event_count: selected.length, event_raw_sha256: [...new Set(selected.map((event) => event.raw_sha256))], aggregate_normalized_sha256: input.manifest.normalized_sha256, release_coverage: input.artifact.coverage },
    event_anchoring: { policy: contract.event_anchor, release_to_anchor_delay_minutes: { minimum: Math.min(...releaseToAnchorDelays), maximum: Math.max(...releaseToAnchorDelays), distinct: [...new Set(releaseToAnchorDelays)].sort((left, right) => left - right) }, note: "Delay is intentionally reported rather than equalized; studies with different delays measure different post-release windows." },
    evaluation: {
      minimum_events_per_branch: contract.minimum_events_per_branch,
      branch_counts: branchCounts,
      status: result.status === "complete" && underpopulatedBranches.length === 0 ? "evaluable" as const : "not_evaluable" as const,
      blockers: [
        ...(result.status === "complete" ? [] : result.qualityIssues),
        ...underpopulatedBranches.map((branch) => `minimum_branch_event_count_not_met:${branch}`),
      ],
    },
    result,
  };
}
