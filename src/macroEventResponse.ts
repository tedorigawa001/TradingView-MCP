import { canonicalDefinitionHash } from "./canonicalDefinition.js";
import { assertAdmissibleAggregate } from "./fxCsvFeatureScanCli.js";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import { computeOfficialMacroEventCoverage } from "./officialMacroEventSources.js";
import type { OfficialMacroEventArtifact, OfficialMacroEventKind } from "./officialMacroEventSources.js";

/**
 * BACKLOG #73. The population definition was frozen in prose and committed before any measurement;
 * this module is that prose made executable, so a later run cannot drift from it unnoticed.
 *
 * The grid is M15 because it is the only one on which all three release kinds have an exact anchor:
 * every release lands on a 15-minute boundary, and the CPI and NFP releases never land on an hour
 * boundary. The pre-existing M60 aftershock study in macroEvent60mStudy.ts anchors on the first hour
 * bar starting at or after the release, which leaves a 0-to-60 minute delay it reports rather than
 * equalizes. That delay is exactly what this grid removes.
 *
 * The response measure is a magnitude. No consensus series is collected, so the sign of the surprise
 * is unknown and a signed return has no predictable direction. A magnitude is not a tradable edge:
 * it says how far price moved, never which way.
 */
export type MacroEventResponseContract = {
  contract_id: string;
  timeframe: "15";
  event_anchor: string;
  horizons: readonly number[];
  primary_horizon: number;
  auxiliary_horizon_use: string;
  response_measure: string;
  baseline: string;
  baseline_observations: number;
  event_guard_bars: number;
  usd_direct_symbols: readonly string[];
  non_usd_cross_symbols: readonly string[];
  independent_symbols: readonly string[];
  within_group_statistic: "median";
  across_event_statistic: "median";
  guard_event_kinds: readonly OfficialMacroEventKind[];
  guard_coverage_scope: string;
  window_continuity: string;
  panel_policy: string;
  null_policy: string;
  placebo_draws: number;
  null_quantile: number;
  minimum_events: number;
  pooling_policy: string;
};

export const MACRO_EVENT_RESPONSE_CONTRACT = {
  contract_id: "us_macro_release_response_m15_v1",
  timeframe: "15",
  event_anchor: "bar_starting_exactly_at_release_instant",
  // Stored as a response curve. Only the primary horizon may decide anything: t+1 and t+2 confirm
  // propagation, t+8 and t+16 diagnose persistence, reversal and session transition. Reading a
  // verdict off any of them after the fact is the horizon selection this contract exists to forbid.
  horizons: [1, 2, 4, 8, 16],
  primary_horizon: 4,
  auxiliary_horizon_use: "reported_only_never_candidate_selection",
  response_measure: "absolute_log_return_bps_over_causal_same_slot_baseline",
  baseline: "median_absolute_return_over_strictly_prior_same_utc_clock_slot_non_event_bars",
  baseline_observations: 52,
  event_guard_bars: 16,
  usd_direct_symbols: ["EURUSD", "USDJPY", "GBPUSD"],
  // Not zero-response controls. US data propagates to crosses through risk sentiment, rate
  // expectations and relative central-bank outlooks, so these are expected to respond, only less
  // than the USD-legged pairs. The pre-fixed comparison is that difference, not presence absence.
  non_usd_cross_symbols: ["EURGBP", "AUDNZD"],
  // Gold is not a control either. It is an independent response series sensitive to US nominal and
  // real rates, so it is measured beside the comparison rather than inside it.
  independent_symbols: ["XAUUSD"],
  within_group_statistic: "median",
  across_event_statistic: "median",
  // The guard is defined over every release, not the kind being measured. Deriving it from all
  // three official artifacts rather than a caller-supplied list is what makes that enforceable: a
  // run that forgot to pass the other two would otherwise leave their releases sitting in the
  // baseline, which is precisely the contamination the guard exists to remove.
  guard_event_kinds: ["us_cpi", "us_nfp", "fomc_statement"],
  // Proving each artifact complete over its own requested years proves nothing about the bars. A
  // guard artifact starting in 2024 beside price history reaching back to 2016 is complete on its
  // own terms and leaves eight years of releases sitting in the baseline unguarded. Every artifact
  // must therefore request the same years, and those years must span the price history in use.
  guard_coverage_scope: "every_artifact_requests_one_identical_year_range_spanning_the_price_history",
  // A horizon is a fixed span of wall-clock time, so a window that steps over a missing bar is not
  // the horizon it claims to be. Requiring the endpoints to sit exactly h buckets apart rejects it.
  window_continuity: "window_endpoints_must_be_exactly_horizon_buckets_apart",
  panel_policy: "balanced_fx_panel_drop_event_from_all_pairs_if_any_pair_lacks_it",
  // Running the frozen procedure on non-event bars showed the response ratio does not center on
  // 1.0, and splitting it out put the fault in the within-group aggregation: right-skewed ratios
  // folded by a median over three symbols and by an effective mean over two differ by group size
  // alone. The statistic is left exactly as frozen and the reference distribution absorbs it.
  null_policy: "placebo_anchors_on_non_event_bars_with_matched_clock_slot_composition",
  placebo_draws: 5000,
  null_quantile: 0.95,
  minimum_events: 80,
  pooling_policy: "one_event_kind_per_study_never_pooled_across_kinds",
} as const satisfies MacroEventResponseContract;

export const MACRO_EVENT_RESPONSE_CONTRACT_HASH = canonicalDefinitionHash(MACRO_EVENT_RESPONSE_CONTRACT);

const BUCKET_MINUTES = 15;
const MS_PER_BUCKET = BUCKET_MINUTES * 60_000;

export type MacroEventResponseSeries = {
  manifest: FxCsvM1AggregationManifest;
  bars: AggregatedBar[];
};

export type MacroEventGroupCurvePoint = {
  horizon: number;
  usd_direct: number;
  non_usd_cross: number;
  difference: number;
  /**
   * Signed counterparts, stored as the frozen definition requires and never used to judge. The
   * _bps fields are the signed log return itself; the _ratio fields divide it by the same baseline
   * the magnitudes use, so they sit on one scale with them and |ratio| never exceeds the magnitude.
   */
  usd_direct_signed_bps: number;
  non_usd_cross_signed_bps: number;
  usd_direct_signed_ratio: number;
  non_usd_cross_signed_ratio: number;
};

export type MacroEventEntryCondition = {
  condition: string;
  observed: number;
  reference: number;
  p_value: number | null;
  met: boolean;
};

export type MacroEventResponseStudy = {
  schema_version: "1.0";
  series: "official_macro_event_response_m15";
  evidence_tier: "official_revised_history";
  contract: MacroEventResponseContract;
  contract_hash: string;
  event_kind: OfficialMacroEventKind;
  source: {
    event_artifact_retrieved_at: string;
    aggregate_normalized_sha256: Record<string, string>;
    event_count: number;
    valid_events: number;
    excluded_missing_anchor: string[];
    excluded_short_baseline: string[];
    excluded_discontinuous_window: string[];
    /** Non-event bars kept out of the baseline lanes because their own windows crossed a gap. */
    discontinuous_baseline_windows: Record<string, number>;
    /** Coverage was rechecked from each artifact's own events; this reports what it had stored. */
    coverage_recheck: Record<string, { coverage_issues_as_stored: string[]; stored_block_is_stale: boolean }>;
  };
  response_curve: MacroEventGroupCurvePoint[];
  per_symbol_primary: Record<string, number>;
  independent_series: Record<string, { events: number; primary_ratio: number }>;
  empirical_null: {
    draws: number;
    seed: number;
    placebo_pool: Record<string, number>;
    level: { observed: number; null_median: number; null_quantile: number; p_value: number };
    difference: { observed: number; null_median: number; null_quantile: number; p_value: number };
  };
  entry_conditions: MacroEventEntryCondition[];
  status: "advance" | "discontinue";
};

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty sample is undefined");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * A release that does not start a bar has no exact anchor, and rounding one out of it is the very
 * delay this grid exists to remove. Refusing is the only honest option.
 */
export function assertReleaseOnAnchorGrid(occurredAt: string): void {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== occurredAt) {
    throw new Error("official macro event timestamp must be canonical ISO UTC");
  }
  if (timestamp % MS_PER_BUCKET !== 0) {
    throw new Error(`release ${occurredAt} does not start a ${BUCKET_MINUTES}-minute bar`);
  }
}

type Lane = { indexes: number[]; returns: Map<number, number[]> };

type SymbolState = {
  bars: readonly AggregatedBar[];
  index: Map<string, number>;
  times: number[];
  guarded: Set<number>;
  lanes: Map<string, Lane>;
  discontinuousBaselineWindows: number;
};

const slotOf = (timeIso: string) => timeIso.slice(11, 16);

/**
 * A horizon is a span of wall-clock time, not a count of rows. FX aggregates skip weekends and
 * holidays, so `position + horizon` can land an hour of bars and two days of calendar away, and a
 * window like that is a different measurement wearing the same name. Because the aggregate is
 * already strictly increasing and bucket-aligned, endpoints exactly `horizon` buckets apart are
 * enough to prove no bar in between is missing.
 */
function signedReturnBps(state: SymbolState, position: number, horizon: number): number | null {
  const forward = state.bars[position + horizon];
  if (forward === undefined) return null;
  if (state.times[position + horizon] - state.times[position] !== horizon * MS_PER_BUCKET) return null;
  return Math.log(forward.close / state.bars[position].close) * 1e4;
}

function buildSymbolState(bars: readonly AggregatedBar[], guardEventTimes: readonly string[], horizons: readonly number[]): SymbolState {
  const index = new Map(bars.map((bar, position) => [bar.timeIso, position]));
  const times = bars.map((bar) => Date.parse(bar.timeIso));
  const guarded = new Set<number>();
  for (const occurredAt of guardEventTimes) {
    const anchor = index.get(occurredAt);
    if (anchor === undefined) continue;
    for (let offset = -MACRO_EVENT_RESPONSE_CONTRACT.event_guard_bars; offset <= MACRO_EVENT_RESPONSE_CONTRACT.event_guard_bars; offset += 1) {
      guarded.add(anchor + offset);
    }
  }
  const state: SymbolState = { bars, index, times, guarded, lanes: new Map(), discontinuousBaselineWindows: 0 };
  // One lane per UTC clock slot, holding only the non-event bars whose every horizon window is both
  // available and contiguous. The baseline for any anchor is then the median over the lane entries
  // strictly before it, which makes the event path and the placebo path the same code rather than
  // two that could drift.
  for (let position = 0; position < bars.length; position += 1) {
    if (guarded.has(position)) continue;
    const returns: Array<[number, number]> = [];
    let truncated = false;
    let discontinuous = false;
    for (const horizon of horizons) {
      if (bars[position + horizon] === undefined) { truncated = true; break; }
      const value = signedReturnBps(state, position, horizon);
      if (value === null) { discontinuous = true; break; }
      returns.push([horizon, Math.abs(value)]);
    }
    if (discontinuous) state.discontinuousBaselineWindows += 1;
    if (truncated || discontinuous) continue;
    const slot = slotOf(bars[position].timeIso);
    let lane = state.lanes.get(slot);
    if (lane === undefined) { lane = { indexes: [], returns: new Map(horizons.map((h) => [h, []])) }; state.lanes.set(slot, lane); }
    lane.indexes.push(position);
    for (const [horizon, value] of returns) lane.returns.get(horizon)!.push(value);
  }
  return state;
}

/** Lane entries strictly before `position`; identical for an event anchor and a placebo anchor. */
function laneOffsetBefore(lane: Lane, position: number): number {
  let low = 0;
  let high = lane.indexes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lane.indexes[middle] < position) low = middle + 1; else high = middle;
  }
  return low;
}

export type MacroEventAnchorRejection = "short_baseline" | "discontinuous_window";

type MeasuredAnchor = { signedBps: Map<number, number>; signedRatio: Map<number, number>; magnitude: Map<number, number> };

function ratiosAt(state: SymbolState, position: number, horizons: readonly number[]):
  { ok: true; value: MeasuredAnchor } | { ok: false; reason: MacroEventAnchorRejection } {
  const bar = state.bars[position];
  const lane = bar === undefined ? undefined : state.lanes.get(slotOf(bar.timeIso));
  if (lane === undefined) return { ok: false, reason: "short_baseline" };
  const offset = laneOffsetBefore(lane, position);
  const window = MACRO_EVENT_RESPONSE_CONTRACT.baseline_observations;
  if (offset < window) return { ok: false, reason: "short_baseline" };
  const signedBps = new Map<number, number>();
  const signedRatio = new Map<number, number>();
  const magnitude = new Map<number, number>();
  for (const horizon of horizons) {
    const value = signedReturnBps(state, position, horizon);
    if (value === null) return { ok: false, reason: "discontinuous_window" };
    const baseline = median(lane.returns.get(horizon)!.slice(offset - window, offset));
    if (!(baseline > 0)) return { ok: false, reason: "short_baseline" };
    signedBps.set(horizon, value);
    signedRatio.set(horizon, value / baseline);
    magnitude.set(horizon, Math.abs(value) / baseline);
  }
  return { ok: true, value: { signedBps, signedRatio, magnitude } };
}

const groupValue = (row: Map<string, MeasuredAnchor>, group: readonly string[], horizon: number) =>
  median(group.map((symbol) => row.get(symbol)!.magnitude.get(horizon)!));

/**
 * Kept beside the magnitudes and never judged. With no consensus series there is no sign to
 * predict, so this is a diagnostic that should sit near zero, not a second result.
 */
const groupSigned = (row: Map<string, MeasuredAnchor>, group: readonly string[], horizon: number, field: "signedBps" | "signedRatio") =>
  median(group.map((symbol) => row.get(symbol)![field].get(horizon)!));

export function runMacroEventResponseStudy(input: {
  series: readonly MacroEventResponseSeries[];
  /**
   * Every official artifact named by the contract, one per kind. The guard is derived from all of
   * them here rather than accepted as a list, so a run cannot leave another kind's releases in the
   * baseline by forgetting to pass them.
   */
  artifacts: readonly OfficialMacroEventArtifact[];
  /** Which of those kinds this study measures. The others contribute only their guard. */
  eventKind: OfficialMacroEventKind;
  placeboSeed?: number;
}): MacroEventResponseStudy {
  const contract = MACRO_EVENT_RESPONSE_CONTRACT;
  const horizons = contract.horizons;
  const fxSymbols = [...contract.usd_direct_symbols, ...contract.non_usd_cross_symbols];

  const bySymbol = new Map<string, MacroEventResponseSeries>();
  for (const entry of input.series) {
    if (entry.manifest.bucket_minutes !== BUCKET_MINUTES) {
      throw new Error(`macro event response study requires ${BUCKET_MINUTES}-minute aggregates`);
    }
    assertAdmissibleAggregate(entry.manifest, entry.bars);
    if (bySymbol.has(entry.manifest.symbol)) throw new Error(`duplicate aggregate for ${entry.manifest.symbol}`);
    bySymbol.set(entry.manifest.symbol, entry);
  }
  for (const symbol of fxSymbols) {
    if (!bySymbol.has(symbol)) throw new Error(`macro event response study requires an aggregate for ${symbol}`);
  }

  // The years the guard has to reach, taken from the bars this study will actually read.
  const barYears = [...bySymbol.values()].flatMap((entry) => [entry.manifest.first_bar_at, entry.manifest.last_bar_at])
    .filter((value): value is string => typeof value === "string")
    .map((value) => Number(value.slice(0, 4)));
  if (barYears.length === 0) throw new Error("aggregates declare no bar range to guard");
  const earliestBarYear = Math.min(...barYears);
  const latestBarYear = Math.max(...barYears);
  let declaredRange: { from: number; to: number } | null = null;

  const recheckedCoverage = new Map<OfficialMacroEventKind, { coverage_issues_as_stored: string[]; stored_block_is_stale: boolean }>();
  const byKind = new Map<OfficialMacroEventKind, OfficialMacroEventArtifact>();
  for (const artifact of input.artifacts) {
    if (artifact.events.some((event) => event.event_kind !== artifact.event_kind)) {
      throw new Error("macro event artifact must contain exactly one event kind");
    }
    // Recomputed from the events this study will actually use, rather than read off the artifact.
    // A stored coverage block is a record of what some earlier run concluded; it is not evidence
    // about the events sitting beside it, and it goes stale the moment the coverage rule is
    // corrected. Same reason assertAdmissibleAggregate rehashes the bars instead of believing the
    // manifest. The stored value is kept for comparison, never for the decision.
    if (!artifact.coverage) throw new Error(`${artifact.event_kind} artifact carries no coverage block to recheck`);
    const requested = { from: artifact.coverage.requested_from_year, to: artifact.coverage.requested_to_year };
    if (requested.from > earliestBarYear || requested.to < latestBarYear) {
      throw new Error(
        `${artifact.event_kind} artifact covers ${requested.from}-${requested.to}, which does not span the ` +
        `${earliestBarYear}-${latestBarYear} price history it must guard`,
      );
    }
    if (declaredRange === null) declaredRange = requested;
    else if (declaredRange.from !== requested.from || declaredRange.to !== requested.to) {
      throw new Error(
        `${artifact.event_kind} artifact requests ${requested.from}-${requested.to} but another requests ` +
        `${declaredRange.from}-${declaredRange.to}; every kind must be proven over the same years`,
      );
    }
    const recomputed = computeOfficialMacroEventCoverage(
      artifact.event_kind,
      artifact.coverage.requested_from_year,
      artifact.coverage.requested_to_year,
      artifact.events,
      artifact.non_publications,
      new Date(artifact.retrieved_at),
    );
    if (recomputed.coverage_issues.length > 0) {
      throw new Error(`${artifact.event_kind} artifact does not prove the requested release-history coverage: ${recomputed.coverage_issues.join(", ")}`);
    }
    recheckedCoverage.set(artifact.event_kind, {
      coverage_issues_as_stored: artifact.coverage.coverage_issues,
      stored_block_is_stale: artifact.coverage.coverage_issues.length > 0,
    });
    if (byKind.has(artifact.event_kind)) throw new Error(`duplicate artifact for ${artifact.event_kind}`);
    byKind.set(artifact.event_kind, artifact);
  }
  // Every guarded kind must be present, measured or not. A missing one is a silently wider baseline.
  for (const kind of contract.guard_event_kinds) {
    if (!byKind.has(kind)) throw new Error(`macro event response study requires the ${kind} artifact to build its guard`);
  }
  const artifact = byKind.get(input.eventKind);
  if (artifact === undefined) throw new Error(`no artifact supplied for the measured kind ${input.eventKind}`);

  const guardEventTimes: string[] = [];
  for (const kind of contract.guard_event_kinds) {
    for (const event of byKind.get(kind)!.events) {
      assertReleaseOnAnchorGrid(event.occurred_at);
      guardEventTimes.push(event.occurred_at);
    }
  }
  const events = artifact.events;

  const states = new Map<string, SymbolState>();
  for (const [symbol, entry] of bySymbol) states.set(symbol, buildSymbolState(entry.bars, guardEventTimes, horizons));

  const rows: Array<{ occurredAt: string; slot: string; ratios: Map<string, MeasuredAnchor> }> = [];
  const excludedMissingAnchor: string[] = [];
  const excludedShortBaseline: string[] = [];
  const excludedDiscontinuousWindow: string[] = [];
  for (const event of events) {
    const ratios = new Map<string, MeasuredAnchor>();
    let rejection: "missing_anchor" | MacroEventAnchorRejection | null = null;
    for (const symbol of fxSymbols) {
      const state = states.get(symbol)!;
      const position = state.index.get(event.occurred_at);
      if (position === undefined) { rejection = "missing_anchor"; break; }
      const measured = ratiosAt(state, position, horizons);
      if (!measured.ok) { rejection = measured.reason; break; }
      ratios.set(symbol, measured.value);
    }
    // The comparison is a difference inside one event, so the panel has to be balanced: a pair that
    // cannot be measured takes the event away from all five rather than from itself.
    if (rejection !== null) {
      const bucket = rejection === "missing_anchor" ? excludedMissingAnchor
        : rejection === "short_baseline" ? excludedShortBaseline : excludedDiscontinuousWindow;
      bucket.push(event.occurred_at);
      continue;
    }
    rows.push({ occurredAt: event.occurred_at, slot: slotOf(event.occurred_at), ratios });
  }
  if (rows.length === 0) throw new Error("no event retained a measurable balanced panel");

  const responseCurve = horizons.map((horizon) => {
    const usd = rows.map((row) => groupValue(row.ratios, contract.usd_direct_symbols, horizon));
    const cross = rows.map((row) => groupValue(row.ratios, contract.non_usd_cross_symbols, horizon));
    return {
      horizon,
      usd_direct: median(usd),
      non_usd_cross: median(cross),
      difference: median(usd.map((value, position) => value - cross[position])),
      usd_direct_signed_bps: median(rows.map((row) => groupSigned(row.ratios, contract.usd_direct_symbols, horizon, "signedBps"))),
      non_usd_cross_signed_bps: median(rows.map((row) => groupSigned(row.ratios, contract.non_usd_cross_symbols, horizon, "signedBps"))),
      usd_direct_signed_ratio: median(rows.map((row) => groupSigned(row.ratios, contract.usd_direct_symbols, horizon, "signedRatio"))),
      non_usd_cross_signed_ratio: median(rows.map((row) => groupSigned(row.ratios, contract.non_usd_cross_symbols, horizon, "signedRatio"))),
    };
  });

  const primary = contract.primary_horizon;
  const observedUsd = rows.map((row) => groupValue(row.ratios, contract.usd_direct_symbols, primary));
  const observedCross = rows.map((row) => groupValue(row.ratios, contract.non_usd_cross_symbols, primary));
  const observedLevel = median(observedUsd);
  const observedDifference = median(observedUsd.map((value, position) => value - observedCross[position]));

  // Placebo pool: non-event bars where all five pairs are measurable, kept per clock slot so a draw
  // can match each event slot for slot.
  const pool = new Map<string, Array<Map<string, MeasuredAnchor>>>();
  const reference = states.get(fxSymbols[0])!;
  for (const [slot, lane] of reference.lanes) {
    const bucket: Array<Map<string, MeasuredAnchor>> = [];
    for (const position of lane.indexes) {
      const timeIso = reference.bars[position].timeIso;
      const ratios = new Map<string, MeasuredAnchor>();
      let usable = true;
      for (const symbol of fxSymbols) {
        const state = states.get(symbol)!;
        const at = state.index.get(timeIso);
        if (at === undefined || state.guarded.has(at)) { usable = false; break; }
        const measured = ratiosAt(state, at, horizons);
        if (!measured.ok) { usable = false; break; }
        ratios.set(symbol, measured.value);
      }
      if (usable) bucket.push(ratios);
    }
    pool.set(slot, bucket);
  }
  for (const row of rows) {
    const bucket = pool.get(row.slot);
    if (bucket === undefined || bucket.length === 0) throw new Error(`no placebo anchors available at clock slot ${row.slot}`);
  }

  const seed = input.placeboSeed ?? 20260806;
  let rngState = seed >>> 0;
  const nextRandom = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };
  const nullLevel: number[] = [];
  const nullDifference: number[] = [];
  for (let draw = 0; draw < contract.placebo_draws; draw += 1) {
    const levels: number[] = [];
    const differences: number[] = [];
    for (const row of rows) {
      const bucket = pool.get(row.slot)!;
      const sampled = bucket[Math.min(bucket.length - 1, Math.floor(nextRandom() * bucket.length))];
      const usd = groupValue(sampled, contract.usd_direct_symbols, primary);
      levels.push(usd);
      differences.push(usd - groupValue(sampled, contract.non_usd_cross_symbols, primary));
    }
    nullLevel.push(median(levels));
    nullDifference.push(median(differences));
  }
  nullLevel.sort((left, right) => left - right);
  nullDifference.sort((left, right) => left - right);
  const quantile = (sample: number[]) => sample[Math.min(sample.length - 1, Math.floor(contract.null_quantile * sample.length))];
  const pValue = (sample: number[], observed: number) => (sample.filter((value) => value >= observed).length + 1) / (sample.length + 1);

  const levelReference = quantile(nullLevel);
  const differenceReference = quantile(nullDifference);
  const entryConditions: MacroEventEntryCondition[] = [
    {
      condition: "usd_direct_primary_ratio_above_placebo_null_quantile",
      observed: observedLevel,
      reference: levelReference,
      p_value: pValue(nullLevel, observedLevel),
      met: observedLevel > levelReference,
    },
    {
      condition: "usd_direct_minus_non_usd_cross_above_placebo_null_quantile",
      observed: observedDifference,
      reference: differenceReference,
      p_value: pValue(nullDifference, observedDifference),
      met: observedDifference > differenceReference,
    },
    {
      condition: "minimum_valid_events",
      observed: rows.length,
      reference: contract.minimum_events,
      p_value: null,
      met: rows.length >= contract.minimum_events,
    },
  ];

  const independent: Record<string, { events: number; primary_ratio: number }> = {};
  for (const symbol of contract.independent_symbols) {
    const state = states.get(symbol);
    if (state === undefined) continue;
    const measured: number[] = [];
    for (const event of events) {
      const position = state.index.get(event.occurred_at);
      if (position === undefined) continue;
      const ratios = ratiosAt(state, position, horizons);
      if (!ratios.ok) continue;
      measured.push(ratios.value.magnitude.get(primary)!);
    }
    if (measured.length > 0) independent[symbol] = { events: measured.length, primary_ratio: median(measured) };
  }

  return {
    schema_version: "1.0",
    series: "official_macro_event_response_m15",
    evidence_tier: "official_revised_history",
    contract,
    contract_hash: MACRO_EVENT_RESPONSE_CONTRACT_HASH,
    event_kind: artifact.event_kind,
    source: {
      event_artifact_retrieved_at: artifact.retrieved_at,
      aggregate_normalized_sha256: Object.fromEntries([...bySymbol].map(([symbol, entry]) => [symbol, entry.manifest.normalized_sha256])),
      event_count: events.length,
      valid_events: rows.length,
      excluded_missing_anchor: excludedMissingAnchor,
      excluded_short_baseline: excludedShortBaseline,
      excluded_discontinuous_window: excludedDiscontinuousWindow,
      discontinuous_baseline_windows: Object.fromEntries([...states].map(([symbol, state]) => [symbol, state.discontinuousBaselineWindows])),
      coverage_recheck: Object.fromEntries(recheckedCoverage),
    },
    response_curve: responseCurve,
    per_symbol_primary: Object.fromEntries(fxSymbols.map((symbol) => [symbol, median(rows.map((row) => row.ratios.get(symbol)!.magnitude.get(primary)!))])),
    independent_series: independent,
    empirical_null: {
      draws: contract.placebo_draws,
      seed,
      placebo_pool: Object.fromEntries([...pool].map(([slot, bucket]) => [slot, bucket.length])),
      level: { observed: observedLevel, null_median: median(nullLevel), null_quantile: levelReference, p_value: pValue(nullLevel, observedLevel) },
      difference: { observed: observedDifference, null_median: median(nullDifference), null_quantile: differenceReference, p_value: pValue(nullDifference, observedDifference) },
    },
    entry_conditions: entryConditions,
    status: entryConditions.every((condition) => condition.met) ? "advance" : "discontinue",
  };
}
