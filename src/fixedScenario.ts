import { z } from "zod";
import { canonicalDefinitionHash } from "./canonicalDefinition.js";

export const FIXED_SCENARIO_CONTRACT = "fixed-close-band-scenario-v1";
const timestamp = z.string().refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s,
  "canonical UTC ISO timestamp required");
const label = z.string().min(1).max(200);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timeframe = z.enum(["15", "60"]);
const basis = z.enum(["unknown", "bid", "ask", "mid"]);
const ruleSchema = z.object({
  band: z.object({ lower: z.number().finite().positive(), upper: z.number().finite().positive() }).strict()
    .refine((b) => b.lower < b.upper, "band lower must be less than upper"),
  direction: z.enum(["above", "below"]),
  any_of: z.array(z.object({ timeframe, consecutive_closes: z.number().int().min(1).max(100) }).strict()).min(1).max(2)
    .refine((xs) => new Set(xs.map((x) => x.timeframe)).size === xs.length, "duplicate rule timeframe"),
}).strict();
export const fixedScenarioDefinitionSchema = z.object({
  id: label,
  version: label,
  known_at: timestamp.nullable(),
  symbol: z.string().regex(/^[\w]+:[\w.!/-]+$/),
  source: label,
  price_basis: basis,
  main_scenario: z.string().max(4000).nullable(),
  opposing_scenario: z.string().max(4000).nullable(),
  activation: ruleSchema.nullable(),
  invalidation: ruleSchema.nullable(),
  valid_until: timestamp.nullable(),
}).strict();
const barSchema = z.object({
  bar_open_at: timestamp, confirmed_at: timestamp,
  open: z.number().finite().positive(), high: z.number().finite().positive(),
  low: z.number().finite().positive(), close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative().optional(), forming: z.boolean().optional(),
}).strict();
export const fixedScenarioInputSchema = z.object({
  definition: fixedScenarioDefinitionSchema,
  expected_conditions_sha256: hash.nullable(),
  previous: z.object({
    analysis_id: label, as_of: timestamp, conditions_sha256: hash.nullable(),
    activation_confirmed_at: timestamp.nullable(),
  }).strict().nullable(),
  evidence: z.object({
    snapshot_id: label, symbol: label, source: label, price_basis: basis, as_of: timestamp,
    restoration_verified: z.boolean(),
    series: z.array(z.object({
      timeframe, observed_at: timestamp, bars: z.array(barSchema).max(100),
    }).strict()).max(2).refine((xs) => new Set(xs.map((x) => x.timeframe)).size === xs.length, "duplicate evidence timeframe"),
  }).strict(),
}).strict();

type Definition = z.infer<typeof fixedScenarioDefinitionSchema>;
type Input = z.infer<typeof fixedScenarioInputSchema>;
type Rule = NonNullable<Definition["activation"]>;
type Bar = z.infer<typeof barSchema>;
type Position = "below" | "lower_boundary" | "inside" | "upper_boundary" | "above";

export function fixedScenarioConditionsHash(input: unknown) {
  return canonicalDefinitionHash({ contract: FIXED_SCENARIO_CONTRACT, definition: fixedScenarioDefinitionSchema.parse(input) });
}

function position(close: number, band: Rule["band"]): Position {
  if (close < band.lower) return "below";
  if (close === band.lower) return "lower_boundary";
  if (close > band.upper) return "above";
  if (close === band.upper) return "upper_boundary";
  return "inside";
}

function evaluateRule(rule: Rule | null, input: Input, from: number, to: number) {
  const branches = (rule?.any_of ?? []).map((branch) => {
    const series = input.evidence.series.find((s) => s.timeframe === branch.timeframe);
    const step = Number(branch.timeframe) * 60_000;
    const rows = (series?.bars ?? []).filter((b) => Date.parse(b.confirmed_at) > from && Date.parse(b.confirmed_at) <= to);
    const counts: Record<Position, number> = { below: 0, lower_boundary: 0, inside: 0, upper_boundary: 0, above: 0 };
    const issues: string[] = [];
    let streak: Bar[] = [], firstMatch: Bar[] | null = null, latestMatch: Bar[] | null = null;
    let previous: Bar | null = null, gaps = 0, unverifiedIntervals = 0, forming = 0, matches = 0;
    const usable: Bar[] = [];
    for (const bar of rows) {
      if (bar.forming === true) { forming++; streak = []; previous = null; continue; }
      if (Date.parse(bar.confirmed_at) - Date.parse(bar.bar_open_at) !== step
        || Date.parse(bar.bar_open_at) % step !== 0 || Date.parse(bar.confirmed_at) % step !== 0) {
        unverifiedIntervals++; streak = []; previous = null; continue;
      }
      if (previous && previous.confirmed_at !== bar.bar_open_at) { gaps++; streak = []; }
      previous = bar; usable.push(bar);
      const place = position(bar.close, rule!.band); counts[place]++;
      if (place === rule!.direction) streak.push(bar);
      else streak = [];
      if (streak.length === branch.consecutive_closes) {
        matches++; firstMatch ??= streak.slice();
      }
      if (streak.length >= branch.consecutive_closes) latestMatch = streak.slice(-branch.consecutive_closes);
    }
    if (!series) issues.push("missing_timeframe");
    if (!usable.length) issues.push("no_new_usable_confirmed_bars");
    if (usable.length && Date.parse(usable[0].bar_open_at) > from) issues.push("comparison_head_not_covered");
    if (usable.length && Date.parse(usable.at(-1)!.confirmed_at) < Math.floor(to / step) * step) issues.push("comparison_tail_not_covered");
    if (gaps || unverifiedIntervals) issues.push("native_gap_or_unverified_session_interval");
    if (forming) issues.push("forming_rows_excluded");
    const proof = (bars: Bar[] | null) => bars === null ? null : ({
      timeframe: branch.timeframe, confirmed_at: bars.at(-1)!.confirmed_at,
      bars: bars.map(({ bar_open_at, confirmed_at, open, high, low, close }) => ({ bar_open_at, confirmed_at, open, high, low, close })),
    });
    return {
      ...branch, status: firstMatch ? "matched" as const : issues.length ? "not_evaluable" as const : "not_matched" as const,
      first_match: proof(firstMatch), latest_match: proof(latestMatch), matching_segments: matches,
      latest_observation: proof(usable.length ? usable.slice(-1) : null)?.bars[0] ?? null,
      latest_position: usable.length ? position(usable.at(-1)!.close, rule!.band) : null,
      position_counts: counts, new_confirmed_bars: usable.length, trailing_qualifying_closes: streak.length,
      latest_run_state: streak.length >= branch.consecutive_closes ? "confirmed_run" : streak.length === 0 ? "not_qualifying"
        : streak.length === 1 ? "single_crossing" : "awaiting_more_confirmations",
      maintained_at_window_end: usable.length > 0 && issues.length === 0 && streak.length >= branch.consecutive_closes,
      excluded: {
        already_confirmed: (series?.bars ?? []).filter((b) => Date.parse(b.confirmed_at) <= from).length,
        after_cutoff: (series?.bars ?? []).filter((b) => Date.parse(b.confirmed_at) > to).length,
        forming, unverified_interval: unverifiedIntervals,
      },
      coverage_discontinuities: gaps, issues,
    };
  });
  const status = rule === null ? "unspecified" as const : branches.some((b) => b.status === "matched") ? "matched" as const
    : branches.some((b) => b.status === "not_evaluable") ? "not_evaluable" as const : "not_matched" as const;
  const matches = branches.flatMap((b) => b.first_match ? [b.first_match] : [])
    .sort((a, b) => Date.parse(a.confirmed_at) - Date.parse(b.confirmed_at) || Number(a.timeframe) - Number(b.timeframe));
  return { status, branches, first_match: matches[0] ?? null,
    maintained_at_window_end: branches.some((b) => b.maintained_at_window_end) };
}

/** Stateless comparison only. No data acquisition, mutation, delivery, journal or rule fitting. */
export function evaluateFixedScenario(value: unknown) {
  const input = fixedScenarioInputSchema.parse(value);
  const { definition, previous, evidence } = input;
  const conditionsHash = fixedScenarioConditionsHash(definition);
  const issues: string[] = [];
  const cutoff = Date.parse(evidence.as_of);
  const from = previous ? Date.parse(previous.as_of) : NaN;
  const to = definition.valid_until ? Math.min(cutoff, Date.parse(definition.valid_until)) : cutoff;
  if (definition.known_at && definition.valid_until && Date.parse(definition.valid_until) <= Date.parse(definition.known_at)) {
    throw new Error("scenario expiry must follow definition known_at");
  }
  for (const series of evidence.series) {
    let prior: Bar | null = null;
    for (const bar of series.bars) {
      if (Date.parse(bar.confirmed_at) <= Date.parse(bar.bar_open_at)
        || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)
        || Date.parse(bar.confirmed_at) > Date.parse(series.observed_at)
        || (prior && (Date.parse(bar.bar_open_at) <= Date.parse(prior.bar_open_at)
          || Date.parse(bar.bar_open_at) < Date.parse(prior.confirmed_at)))) {
        throw new Error("invalid, overlapping, unordered or not-yet-observed native bars");
      }
      prior = bar;
    }
  }
  if (input.expected_conditions_sha256 !== null && input.expected_conditions_sha256 !== conditionsHash) issues.push("conditions_hash_mismatch");
  if (!previous) issues.push("previous_analysis_unspecified");
  if (previous?.conditions_sha256 !== null && previous?.conditions_sha256 !== undefined
    && previous.conditions_sha256 !== conditionsHash) issues.push("previous_conditions_hash_mismatch");
  if (!definition.known_at || (previous && Date.parse(definition.known_at) > from)) issues.push("definition_not_known_at_previous_cutoff");
  if (previous && from >= to) issues.push("empty_or_reversed_comparison_window");
  if (previous?.activation_confirmed_at && (previous.conditions_sha256 !== conditionsHash
    || Date.parse(previous.activation_confirmed_at) > from
    || !definition.known_at || Date.parse(previous.activation_confirmed_at) < Date.parse(definition.known_at))) {
    issues.push("unbound_or_invalid_previous_activation");
  }
  if (definition.symbol !== evidence.symbol || definition.source !== evidence.source
    || definition.source !== "tradingview_native_ohlcv" || definition.price_basis !== evidence.price_basis) issues.push("evidence_binding_mismatch");
  if (!evidence.restoration_verified) issues.push("restoration_not_verified");
  const activation = issues.length ? null : evaluateRule(definition.activation, input, from, to);
  const invalidation = issues.length ? null : evaluateRule(definition.invalidation, input, from, to);
  let classification = "not_evaluable";
  if (activation && invalidation) {
    if (activation.status === "matched" && invalidation.status === "matched") issues.push("both_conditions_matched_no_lifecycle_precedence");
    else if (invalidation.status === "matched") classification = "invalidated";
    else if (activation.status === "unspecified" || activation.status === "not_evaluable" || invalidation.status === "not_evaluable") {
      issues.push("required_condition_unspecified_or_incomplete");
    } else if (previous?.activation_confirmed_at) classification = "continuation_pending";
    else if (activation.status === "matched") classification = "triggered";
    else classification = "not_triggered";
  }
  const labels: Record<string, string> = { not_evaluable: "評価不能", invalidated: "明示した否定条件が成立",
    continuation_pending: "条件に対する継続確認中", triggered: "条件発火", not_triggered: "条件未発火" };
  return {
    schema_version: "1.0", contract: FIXED_SCENARIO_CONTRACT, classification, classification_ja: labels[classification],
    conditions_sha256: conditionsHash, definition, previous,
    definition_pin_verified: input.expected_conditions_sha256 === conditionsHash,
    evidence_ref: { snapshot_id: evidence.snapshot_id, as_of: evidence.as_of, symbol: evidence.symbol,
      source: evidence.source, price_basis: evidence.price_basis,
      series: evidence.series.map((s) => ({ timeframe: s.timeframe, observed_at: s.observed_at, supplied_bars: s.bars.length })) },
    comparison: { after: previous?.as_of ?? null, through: new Date(to).toISOString(),
      valid_until: definition.valid_until, prior_activation_is_caller_supplied: previous?.activation_confirmed_at !== null && previous !== null },
    activation, invalidation, issues, candidateEligible: false,
    limitations: [
      "Caller-supplied native evidence and historical conditions are not authenticated; hashes pin content, not prior existence or truth.",
      "Only confirmations after the previous cutoff and through the comparison cutoff count; no prior-bar streak is carried in.",
      "Strict close < lower or > upper only. Boundary equality and band interior never qualify. Branches are OR, never pooled across timeframes.",
      "Only UTC-grid-aligned native 15/60-minute intervals are supported; gaps, off-grid or non-nominal intervals reset streaks. No session calendar or interpolation.",
      "A match proves an observed condition in this window, not a new state transition, continued validity, prediction accuracy, trade outcome or notification eligibility.",
      "Both activation and invalidation matches are reported without choosing lifecycle precedence or intrabar event order.",
      "observed_at is a read timestamp, not a persisted first-seen vintage; successor time is not exchange publication time.",
      "Unknown OHLC price basis remains unknown; no comparison to bid/ask, quote freshness, executable breakout or fill guarantee.",
      "No thresholds inferred or optimized; no chart, quote, automation, order, alert, journal or delivery access.",
    ],
  };
}
