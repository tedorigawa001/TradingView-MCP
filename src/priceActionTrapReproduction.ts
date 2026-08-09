import { createHash } from "node:crypto";
import type { AggregatedBar } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import { canonicalDefinitionHash } from "./canonicalDefinition.js";

export const PRICE_ACTION_TRAP_REPRODUCTION_V1 = {
  contract_id: "price_action_four_bar_trap_v1",
  methodology_version: "price_action_four_bar_trap_reproduction_v1",
  timeframe_minutes: 15,
  symbols: ["EURUSD", "USDJPY", "GBPUSD", "EURGBP", "AUDNZD", "XAUUSD", "EURJPY", "GBPJPY"],
  horizons: [1, 2, 4, 8, 16],
  primary_horizon: 4,
  minimum_events: 2000,
  placebo_draws: 5000,
  placebo_seed: 20260807,
  minimum_placebo_anchors_per_cell: 52,
  placebo_matching_keys: ["utc_clock_slot", "utc_weekday"],
  ambiguous_false_break_policy: "upper_break_first_short",
  structural_sequence: "adjacent_bar_rows",
  forward_window_continuity: "exact_timestamp_spacing_from_signal_close",
  exclude_placebo_patterns: ["pin", "engulfing", "sweep", "four_bar_trap"],
  confidence_interval: "iid_normal_approximation_descriptive_only",
} as const;

export const PRICE_ACTION_TRAP_REPRODUCTION_HASH = canonicalDefinitionHash(PRICE_ACTION_TRAP_REPRODUCTION_V1);

type TrapEvent = {
  symbol: string;
  signal_at: string;
  direction: 1 | -1;
  branch: "lower_break_long" | "upper_break_short";
  cell: string;
  entry_close: number;
  forward_returns_bps: Record<string, number>;
};

type AggregateInput = { manifest: FxCsvM1AggregationManifest; bars: AggregatedBar[] };

const BPS = 10_000;
const INTERVAL_SECONDS = 15 * 60;
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values: readonly number[]) => {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!;
};
const quantile95 = (values: readonly number[]) => values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]!;
const slotCell = (timeIso: string) => `${timeIso.slice(11, 16)}|${new Date(timeIso).getUTCDay()}`;

function interval(values: readonly number[]) {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  const half = 1.96 * Math.sqrt(variance / values.length);
  return { mean_bps: average, lower_bps: average - half, upper_bps: average + half };
}

function assertAggregate(input: AggregateInput) {
  const { manifest, bars } = input;
  if (manifest.bucket_minutes !== PRICE_ACTION_TRAP_REPRODUCTION_V1.timeframe_minutes) {
    throw new Error(`${manifest.symbol} must be a 15-minute aggregate`);
  }
  if (bars.length !== manifest.bar_count || bars.length === 0) throw new Error(`${manifest.symbol} aggregate bar count does not match its manifest`);
  const digest = `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`;
  if (digest !== manifest.normalized_sha256) throw new Error(`${manifest.symbol} aggregate does not match normalized_sha256`);
  let prior = -Infinity;
  for (const bar of bars) {
    const at = Date.parse(bar.timeIso);
    if (!Number.isFinite(at) || at <= prior || at % (INTERVAL_SECONDS * 1000) !== 0) throw new Error(`${manifest.symbol} bars are not strictly increasing M15 timestamps`);
    if (!(bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) && bar.low > 0)) throw new Error(`${manifest.symbol} has an invalid candle at ${bar.timeIso}`);
    prior = at;
  }
}

function isPriceActionPattern(bars: readonly AggregatedBar[], index: number) {
  if (index < 20) return false;
  const bar = bars[index]!;
  const prior = bars[index - 1]!;
  const range = bar.high - bar.low;
  if (!(range > 0)) return false;
  const bodyHigh = Math.max(bar.open, bar.close);
  const bodyLow = Math.min(bar.open, bar.close);
  const pin = (bodyLow - bar.low) / range >= 0.6 && (bodyHigh - bodyLow) / range <= 0.4 && (bar.high - bodyHigh) / range <= 0.4 ||
    (bar.high - bodyHigh) / range >= 0.6 && (bodyHigh - bodyLow) / range <= 0.4 && (bodyLow - bar.low) / range <= 0.4;
  const priorHigh = Math.max(prior.open, prior.close);
  const priorLow = Math.min(prior.open, prior.close);
  const engulfing = (bodyHigh >= priorHigh && bodyLow <= priorLow) &&
    ((bar.close > bar.open && prior.close < prior.open) || (bar.close < bar.open && prior.close > prior.open));
  let high = -Infinity;
  let low = Infinity;
  for (let offset = index - 20; offset < index; offset += 1) {
    high = Math.max(high, bars[offset]!.high);
    low = Math.min(low, bars[offset]!.low);
  }
  const sweep = (bar.low < low && bar.close > low) || (bar.high > high && bar.close < high);
  return pin || engulfing || sweep;
}

function contiguous(bars: readonly AggregatedBar[], from: number, to: number) {
  return to < bars.length && Date.parse(bars[to]!.timeIso) - Date.parse(bars[from]!.timeIso) === (to - from) * INTERVAL_SECONDS * 1000;
}

export function detectPriceActionTrap(bars: readonly AggregatedBar[], start: number): { direction: 1 | -1; branch: TrapEvent["branch"] } | null {
  const one = bars[start], two = bars[start + 1], three = bars[start + 2], four = bars[start + 3];
  if (!one || !two || !three || !four) return null;
  if (!(two.high <= one.high && two.low >= one.low)) return null;
  const upper = three.high > two.high && three.close < two.high;
  const lower = three.low < two.low && three.close > two.low;
  // This is deliberately the historical tie-break. A later contract must not silently pick another branch.
  const direction = upper ? -1 : lower ? 1 : 0;
  if (direction === 0) return null;
  const threeBodyHigh = Math.max(three.open, three.close);
  const threeBodyLow = Math.min(three.open, three.close);
  const covers = Math.max(four.open, four.close) >= threeBodyHigh && Math.min(four.open, four.close) <= threeBodyLow;
  if (!covers || (direction === -1 ? four.close >= four.open : four.close <= four.open)) return null;
  return direction === -1 ? { direction, branch: "upper_break_short" } : { direction, branch: "lower_break_long" };
}

type Candidate = { symbol: string; index: number; cell: string; primaryReturnBps: number };

export function runPriceActionTrapReproduction(inputs: readonly AggregateInput[]) {
  const expected = new Set<string>(PRICE_ACTION_TRAP_REPRODUCTION_V1.symbols);
  if (inputs.length !== expected.size) throw new Error(`requires exactly ${expected.size} aggregate inputs`);
  const seen = new Set<string>();
  for (const input of inputs) {
    assertAggregate(input);
    if (!expected.has(input.manifest.symbol) || seen.has(input.manifest.symbol)) throw new Error(`unexpected or duplicate symbol ${input.manifest.symbol}`);
    seen.add(input.manifest.symbol);
  }

  const events: TrapEvent[] = [];
  const candidates: Candidate[] = [];
  let incompleteOrDiscontinuousWindows = 0;
  for (const { manifest, bars } of inputs) {
    const trapSignals = new Set<number>();
    for (let start = 0; start + 3 < bars.length; start += 1) if (detectPriceActionTrap(bars, start) !== null) trapSignals.add(start + 3);
    for (let start = 0; start + 3 < bars.length; start += 1) {
      const trap = detectPriceActionTrap(bars, start);
      if (trap === null) continue;
      const signal = start + 3;
      const forward: Record<string, number> = {};
      for (const horizon of PRICE_ACTION_TRAP_REPRODUCTION_V1.horizons) {
        if (!contiguous(bars, signal, signal + horizon)) continue;
        forward[String(horizon)] = trap.direction * Math.log(bars[signal + horizon]!.close / bars[signal]!.close) * BPS;
      }
      if (forward[String(PRICE_ACTION_TRAP_REPRODUCTION_V1.primary_horizon)] === undefined) {
        incompleteOrDiscontinuousWindows += 1;
        continue;
      }
      events.push({ symbol: manifest.symbol, signal_at: bars[signal]!.timeIso, direction: trap.direction, branch: trap.branch, cell: slotCell(bars[signal]!.timeIso), entry_close: bars[signal]!.close, forward_returns_bps: forward });
    }
    for (let index = 20; index + PRICE_ACTION_TRAP_REPRODUCTION_V1.primary_horizon < bars.length; index += 1) {
      if (!contiguous(bars, index, index + PRICE_ACTION_TRAP_REPRODUCTION_V1.primary_horizon) || trapSignals.has(index) || isPriceActionPattern(bars, index)) continue;
      candidates.push({
        symbol: manifest.symbol,
        index,
        cell: slotCell(bars[index]!.timeIso),
        primaryReturnBps: Math.log(bars[index + PRICE_ACTION_TRAP_REPRODUCTION_V1.primary_horizon]!.close / bars[index]!.close) * BPS,
      });
    }
  }
  if (events.length < PRICE_ACTION_TRAP_REPRODUCTION_V1.minimum_events) throw new Error(`only ${events.length} complete trap events, need ${PRICE_ACTION_TRAP_REPRODUCTION_V1.minimum_events}`);

  const pools = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const bucket = pools.get(candidate.cell);
    if (bucket) bucket.push(candidate); else pools.set(candidate.cell, [candidate]);
  }
  const eligible = events.filter((event) => (pools.get(event.cell)?.length ?? 0) >= PRICE_ACTION_TRAP_REPRODUCTION_V1.minimum_placebo_anchors_per_cell);
  if (eligible.length < PRICE_ACTION_TRAP_REPRODUCTION_V1.minimum_events) throw new Error(`only ${eligible.length} events have a sufficiently deep matched placebo pool`);

  const primary = String(PRICE_ACTION_TRAP_REPRODUCTION_V1.primary_horizon);
  const observed = eligible.map((event) => event.forward_returns_bps[primary]!);
  // Precompute every non-random quantity. Five thousand replications over twelve thousand events
  // must allocate neither arrays nor logarithms in the inner loop, otherwise the artifact writer
  // itself becomes less reliable than the study it is preserving.
  const samplingRows = eligible.map((event) => ({ direction: event.direction, pool: pools.get(event.cell)! }));
  let state = PRICE_ACTION_TRAP_REPRODUCTION_V1.placebo_seed >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const nullDistribution: number[] = [];
  for (let draw = 0; draw < PRICE_ACTION_TRAP_REPRODUCTION_V1.placebo_draws; draw += 1) {
    let sum = 0;
    for (const row of samplingRows) {
      const candidate = row.pool[Math.floor(random() * row.pool.length)]!;
      sum += row.direction * candidate.primaryReturnBps;
    }
    nullDistribution.push(sum / samplingRows.length);
  }
  nullDistribution.sort((left, right) => left - right);
  const curve = Object.fromEntries(PRICE_ACTION_TRAP_REPRODUCTION_V1.horizons.map((horizon) => {
    const values = eligible.map((event) => event.forward_returns_bps[String(horizon)]).filter((value): value is number => value !== undefined);
    return [String(horizon), { events: values.length, ...interval(values) }];
  }));
  const observedPrimary = mean(observed);
  const result = {
    schema_version: "1.0" as const,
    series: "price_action_four_bar_trap_reproduction",
    contract: PRICE_ACTION_TRAP_REPRODUCTION_V1,
    contract_hash: PRICE_ACTION_TRAP_REPRODUCTION_HASH,
    sources: inputs.map(({ manifest }) => ({ symbol: manifest.symbol, normalized_sha256: manifest.normalized_sha256, source_sha256: manifest.source_sha256, definition_hash: manifest.definition_hash, bar_count: manifest.bar_count, first_bar_at: manifest.first_bar_at, last_bar_at: manifest.last_bar_at })),
    event_ledger: eligible,
    exclusions: { incomplete_or_discontinuous_windows: incompleteOrDiscontinuousWindows, thin_placebo_cell: events.length - eligible.length },
    response_curve: curve,
    empirical_null: { draws: nullDistribution.length, seed: PRICE_ACTION_TRAP_REPRODUCTION_V1.placebo_seed, primary_horizon: PRICE_ACTION_TRAP_REPRODUCTION_V1.primary_horizon, observed_bps: observedPrimary, null_median_bps: median(nullDistribution), null_95th_percentile_bps: quantile95(nullDistribution), p_value: (nullDistribution.filter((value) => value >= observedPrimary).length + 1) / (nullDistribution.length + 1), distribution_bps: nullDistribution, pool_sizes: Object.fromEntries([...pools].map(([cell, pool]) => [cell, pool.length])) },
      limitations: [
      "iid_normal_intervals_are_descriptive_only",
      "historical_result_is_not_confirmed_until_its_prior_input_hashes_match_this_artifact",
      // The pool is matched on clock slot and weekday but not on symbol, so a cell mixes all eight
      // series and gold moves about 2.4 times as far per bar as the quietest cross. Measured on the
      // 2016-2026 panel it does not bite: traps fire in proportion to bar count, and every symbol's
      // share of the events sits within one point of its share of the bars, so the drawn mixture and
      // the measured mixture agree. It would bite on a panel where they did not.
      "placebo_cells_match_clock_slot_and_weekday_but_not_symbol",
      // The pool excludes every pin, engulfing and sweep bar, so the comparison is a trap against an
      // unremarkable bar rather than against an engulfing that does not complete a trap. The trap's
      // fourth bar is an engulfing by construction, so this null cannot separate the structure from
      // the engulfing inside it - it can only be conservative about the pair together.
      "null_contrasts_the_trap_with_unpatterned_bars_not_with_a_bare_engulfing",
    ],
  };
  return { ...result, artifact_hash: canonicalDefinitionHash(result) };
}
