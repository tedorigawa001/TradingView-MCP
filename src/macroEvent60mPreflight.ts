import { assertAdmissibleAggregate } from "./fxCsvFeatureScanCli.js";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import { firstFullM60BarAfterRelease, MACRO_EVENT_60M_CONTRACTS, type MacroEvent60mContractId } from "./macroEvent60mStudy.js";
import type { OfficialMacroEventArtifact } from "./officialMacroEventSources.js";

const HOUR = 60 * 60 * 1000;

type Availability = "window_available" | "missing_anchor_bar" | "incomplete_initial_range" | "non_contiguous_initial_range" | "incomplete_maximum_window" | "non_contiguous_maximum_window";

function firstGap(bars: AggregatedBar[]) {
  for (let index = 1; index < bars.length; index += 1) {
    const prior = Date.parse(bars[index - 1].timeIso);
    const current = Date.parse(bars[index].timeIso);
    if (current - prior > HOUR * 1.5) return { after_bar_at: bars[index - 1].timeIso, before_bar_at: bars[index].timeIso, gap_hours: (current - prior) / HOUR };
  }
  return null;
}

/**
 * Reports whether an event contract can be observed from the supplied bars without looking at
 * breakout direction, returns, or any resulting candidate.  It is therefore safe to use before
 * selecting a new event-study specification.
 */
export function preflightMacroEvent60mContract(input: {
  manifest: FxCsvM1AggregationManifest;
  bars: AggregatedBar[];
  artifact: OfficialMacroEventArtifact;
  contractId?: MacroEvent60mContractId;
}) {
  if (input.manifest.bucket_minutes !== 60) throw new Error("macro event preflight requires a 60-minute aggregate");
  const contractId = input.contractId ?? "macro_aftershock_v1";
  const contract = MACRO_EVENT_60M_CONTRACTS[contractId];
  if (!contract) throw new Error("macro event preflight contract is unsupported");
  if (contract.eligible_event_kind !== null && input.artifact.event_kind !== contract.eligible_event_kind) {
    throw new Error(`${contract.contract_id} only supports ${contract.eligible_event_kind}`);
  }
  if (!input.artifact.coverage || input.artifact.coverage.coverage_issues.length > 0) throw new Error("macro event artifact does not prove the requested release-history coverage");
  assertAdmissibleAggregate(input.manifest, input.bars);

  const selected = input.artifact.events.filter((event) => event.event_kind === input.artifact.event_kind);
  if (selected.length !== input.artifact.events.length) throw new Error("macro event artifact must contain exactly one event kind");
  const orderedBars = [...input.bars].sort((left, right) => left.timeIso.localeCompare(right.timeIso));
  const byTime = new Map(orderedBars.map((bar, index) => [bar.timeIso, index]));
  const maximumWindowBars = contract.initial_range_bars + contract.breakout_within_bars + contract.retest_within_bars + Math.max(...contract.horizons);
  const availability: Record<Availability, number> = {
    window_available: 0, missing_anchor_bar: 0, incomplete_initial_range: 0, non_contiguous_initial_range: 0, incomplete_maximum_window: 0, non_contiguous_maximum_window: 0,
  };
  const byAnchorWeekday: Record<string, Record<Availability, number>> = {};
  const byAnchorMonth: Record<string, Record<Availability, number>> = {};
  const gapExamples: Array<{ event_id: string; anchor_at: string; availability: Availability; after_bar_at: string; before_bar_at: string; gap_hours: number }> = [];

  for (const event of selected) {
    const anchorAt = firstFullM60BarAfterRelease(event.occurred_at);
    const anchorMs = Date.parse(anchorAt);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(new Date(anchorMs));
    const month = anchorAt.slice(0, 7);
    const index = byTime.get(anchorAt);
    let state: Availability;
    let gap: ReturnType<typeof firstGap> = null;
    if (index === undefined) state = "missing_anchor_bar";
    else {
      const initial = orderedBars.slice(index, index + contract.initial_range_bars);
      if (initial.length < contract.initial_range_bars) state = "incomplete_initial_range";
      else if ((gap = firstGap(initial)) !== null) state = "non_contiguous_initial_range";
      else {
        const maximum = orderedBars.slice(index, index + maximumWindowBars);
        if (maximum.length < maximumWindowBars) state = "incomplete_maximum_window";
        else if ((gap = firstGap(maximum)) !== null) state = "non_contiguous_maximum_window";
        else state = "window_available";
      }
    }
    availability[state] += 1;
    const weekdayBucket = byAnchorWeekday[weekday] ?? (byAnchorWeekday[weekday] = { window_available: 0, missing_anchor_bar: 0, incomplete_initial_range: 0, non_contiguous_initial_range: 0, incomplete_maximum_window: 0, non_contiguous_maximum_window: 0 });
    weekdayBucket[state] += 1;
    const monthBucket = byAnchorMonth[month] ?? (byAnchorMonth[month] = { window_available: 0, missing_anchor_bar: 0, incomplete_initial_range: 0, non_contiguous_initial_range: 0, incomplete_maximum_window: 0, non_contiguous_maximum_window: 0 });
    monthBucket[state] += 1;
    if (gap !== null && gapExamples.length < 20) gapExamples.push({ event_id: event.event_id, anchor_at: anchorAt, availability: state, ...gap });
  }

  return {
    schema_version: "1.0" as const,
    series: "official_macro_event_m60_contract_preflight" as const,
    evidence_tier: "official_revised_history" as const,
    contract_id: contract.contract_id,
    event_kind: input.artifact.event_kind,
    contract_window: {
      initial_range_bars: contract.initial_range_bars,
      breakout_within_bars: contract.breakout_within_bars,
      retest_within_bars: contract.retest_within_bars,
      maximum_horizon_bars: Math.max(...contract.horizons),
      maximum_observed_window_bars: maximumWindowBars,
      policy: "requires_contiguous_observed_m60_bars_without_price_condition_screening",
    },
    source: { aggregate_normalized_sha256: input.manifest.normalized_sha256, event_count: selected.length, release_coverage: input.artifact.coverage },
    availability,
    potentially_evaluable_events: availability.window_available,
    by_anchor_weekday: byAnchorWeekday,
    by_anchor_month: byAnchorMonth,
    non_contiguous_window_examples: gapExamples,
  };
}
