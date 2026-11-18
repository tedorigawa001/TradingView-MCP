/** Pure, explicitly invoked calculation only. No chart, filesystem, journal or network adapters. */
import { createHash } from "node:crypto";
import type { MeasurementHypothesis } from "./strategyResearchJournal.js";
export const SMA_CROSS_V2_ID = "sma-cross-adj-30m60m-1y-20261114-v2";
export const SMA_CROSS_V2_HASH = "sha256:8dc5c2d46af53161f69fe8427403510b8bfb247e486fcccab152b27c6a5b3573";
export const SMA_PERIOD_START = Date.parse("2025-11-14T04:57:31Z");
export const SMA_PERIOD_END = Date.parse("2026-11-14T04:57:31Z");

export const SMA_MEASUREMENT_GROUPS = Object.freeze(
  ["OANDA:EURUSD", "OANDA:XAUUSD"].flatMap(symbol => ["30", "60"].flatMap(timeframe =>
    [[10, 40], [40, 60], [60, 90], [90, 120]].map(([fast, slow]) => Object.freeze({
      id: `${symbol}|${timeframe}|${fast}/${slow}`, symbol, timeframe, fast: fast!, slow: slow!,
    })))),
);
export type HolmInput = { groupId: string; pValue: number | null; eligible: boolean };
export type HolmResult = {
  groupId: string; rawP: number | null; effectiveP: number; adjustedP: number;
  decision: "held" | "rejected" | "not_rejected";
};

/** Fixed family and alpha. No dropping unavailable tests or splitting by direction. */
export function holm16(input: readonly HolmInput[]): HolmResult[] {
  if (input.length !== 16) throw new Error("invalid_family");
  const map = new Map<string, HolmInput>();
  for (const row of input) {
    if (!row || typeof row.eligible !== "boolean" || map.has(row.groupId) ||
        !SMA_MEASUREMENT_GROUPS.some(g => g.id === row.groupId)) throw new Error("invalid_family");
    if (row.pValue !== null && (!Number.isFinite(row.pValue) || row.pValue < 0 || row.pValue > 1)) throw new Error("invalid_p_value");
    map.set(row.groupId, row);
  }
  const ordered = SMA_MEASUREMENT_GROUPS.map(g => map.get(g.id)!);
  const ranked = ordered.map((row, index) => ({ row, index, p: row.eligible && row.pValue !== null ? row.pValue : 1 }))
    .sort((a, b) => a.p - b.p || a.index - b.index);
  const results: HolmResult[] = new Array(16);
  let adjusted = 0;
  ranked.forEach(({ row, index, p }, rank) => {
    adjusted = Math.max(adjusted, Math.min(1, p * (16 - rank)));
    results[index] = { groupId: row.groupId, rawP: row.pValue, effectiveP: p, adjustedP: adjusted,
      decision: !row.eligible || row.pValue === null ? "held" : adjusted <= 0.05 ? "rejected" : "not_rejected" };
  });
  return results;
}

function logGamma(z: number): number {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7];
  let x = 0.9999999999998099;
  const shifted = z - 1;
  for (let i = 0; i < coefficients.length; i++) x += coefficients[i]! / (shifted + i + 1);
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaFraction(a: number, b: number, x: number): number {
  const nonzero = (v: number) => Math.abs(v) < 1e-300 ? (v < 0 ? -1e-300 : 1e-300) : v;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 / nonzero(1 - qab * x / qap), h = d;
  for (let m = 1; m <= 256; m++) {
    const twice = 2 * m;
    let aa = m * (b - m) * x / ((qam + twice) * (a + twice));
    d = 1 / nonzero(1 + aa * d);
    c = nonzero(1 + aa / c);
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + twice) * (qap + twice));
    d = 1 / nonzero(1 + aa * d);
    c = nonzero(1 + aa / c);
    const delta = d * c;
    h *= delta;
    if (!Number.isFinite(h)) throw new Error("student_t_numeric_failure");
    if (Math.abs(delta - 1) <= 8 * Number.EPSILON) return h;
  }
  throw new Error("student_t_convergence_limit");
}

/** Two-sided tail I_(df/(df+t²))(df/2, 1/2), with a bounded continued fraction. */
export function studentTTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isInteger(df) || df < 1 ||
      df >= SMA_MEASUREMENT_LIMITS.intervalsPerGroup) throw new Error("invalid_student_t_input");
  if (t === 0) return 1;
  const ratio = Math.abs(t) / Math.sqrt(df);
  const inverseSquare = ratio > 1 ? (1 / ratio) ** 2 : null;
  const x = inverseSquare === null ? 1 / (1 + ratio * ratio) : inverseSquare / (1 + inverseSquare);
  if (x === 0) return 0; // Underflowed tail for a finite, extreme statistic.
  if (x === 1) return 1;
  const a = df / 2, b = 0.5;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  const p = x < (a + 1) / (a + b + 2) ? front * betaFraction(a, b, x) / a :
    1 - front * betaFraction(b, a, 1 - x) / b;
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error("student_t_numeric_failure");
  return p;
}

export type SmaInferenceEvidence = { independentObservations?: boolean; evidenceRef?: string };
export type SmaStatistic = {
  n: number; mean: number | null; sd: number | null; t: number | null; pValue: number | null;
  eligible: boolean; reason: string | null;
};

/** A caller assertion is a prerequisite, never an independent proof of independence. */
export function calculateSmaStatistic(values: readonly number[], evidence: SmaInferenceEvidence = {}): SmaStatistic {
  const n = values.length;
  if (n >= SMA_MEASUREMENT_LIMITS.intervalsPerGroup) throw new SmaMeasurementStop("group_interval_limit");
  const result: SmaStatistic = { n, mean: null, sd: null, t: null, pValue: null, eligible: false, reason: null };
  for (let i = 0; i < n; i++) {
    if (!Object.hasOwn(values, i) || !Number.isFinite(values[i])) return { ...result, reason: "invalid_statistic_value" };
  }
  if (n < 30) return { ...result, reason: "insufficient_observations" };
  const sum = (items: Iterable<number>) => {
    let total = 0, correction = 0;
    for (const value of items) {
      const adjusted = value - correction, next = total + adjusted;
      correction = (next - total) - adjusted;
      total = next;
    }
    return total;
  };
  result.mean = sum(values) / n;
  result.sd = Math.sqrt(sum(values.map(v => (v - result.mean!) ** 2)) / (n - 1));
  if (!Number.isFinite(result.mean) || !Number.isFinite(result.sd)) return { ...result, mean: null, sd: null, reason: "nonfinite_statistics" };
  if (result.sd === 0) return { ...result, reason: "zero_variance" };
  result.t = result.mean / (result.sd / Math.sqrt(n));
  if (!Number.isFinite(result.t)) return { ...result, t: null, reason: "nonfinite_statistics" };
  if (!evidence || evidence.independentObservations !== true || typeof evidence.evidenceRef !== "string" ||
      evidence.evidenceRef.trim().length === 0 || evidence.evidenceRef.length > 256) return { ...result, reason: "inference_prerequisites_unverified" };
  try { result.pValue = studentTTwoSidedP(result.t, n - 1); }
  catch { return { ...result, reason: "student_t_numeric_failure" }; }
  return { ...result, eligible: true };
}

/** These are exclusive stopping thresholds, not configurable quotas. */
export const SMA_MEASUREMENT_LIMITS = Object.freeze({
  barsPerSeries: 65_536, barsTotal: 262_144, initialSearch: 8_192,
  intervalsPerGroup: 8_192, intervalsTotal: 65_536,
  workSteps: 4_194_304, outputBytes: 8_388_608,
});

export class SmaMeasurementStop extends Error {
  partialIntervals: SmaCrossInterval[] = [];
  constructor(readonly reason: string) { super(reason); this.name = "SmaMeasurementStop"; }
}

/** Shared by all groups. Once stopped it cannot be reused or reset. No I/O. */
export class SmaMeasurementBudget {
  #steps = 0;
  #intervals = 0;
  #outputEstimate = 32_768; // Fixed report/group metadata, independent of caller strings.
  #perGroup = new Map<string, number>();
  #stopped: string | null = null;
  get steps() { return this.#steps; }
  get intervals() { return this.#intervals; }
  get outputEstimate() { return this.#outputEstimate; }
  get stopReason() { return this.#stopped; }
  #fail(reason: string): never {
    this.#stopped ??= reason;
    throw new SmaMeasurementStop(this.#stopped);
  }
  #active() { if (this.#stopped) this.#fail(this.#stopped); }
  stop(reason: string): never { return this.#fail(reason); }
  checkInputCounts(counts: readonly number[]): void {
    this.#active();
    if (counts.length > 4 || counts.some(n => !Number.isSafeInteger(n) || n < 0)) this.#fail("invalid_series_counts");
    for (let i = 0; i < counts.length; i++) if (!Object.hasOwn(counts, i)) this.#fail("invalid_series_counts");
    if (counts.reduce((a, b) => a + b, 0) >= SMA_MEASUREMENT_LIMITS.barsTotal) this.#fail("total_bar_limit");
    if (counts.some(n => n >= SMA_MEASUREMENT_LIMITS.barsPerSeries)) this.#fail("series_bar_limit");
  }
  step(amount = 1): void {
    this.#active();
    if (!Number.isSafeInteger(amount) || amount < 1) this.#fail("invalid_work_count");
    if (this.#steps + amount >= SMA_MEASUREMENT_LIMITS.workSteps) this.#fail("work_step_limit");
    this.#steps += amount;
  }
  checkOutputBytes(bytes: number): void {
    this.#active();
    if (!Number.isSafeInteger(bytes) || bytes < 0) this.#fail("invalid_output_count");
    if (bytes + 1_024 >= SMA_MEASUREMENT_LIMITS.outputBytes) this.#fail("output_size_limit");
  }
  addInterval(group: string, serializedBytes: number): void {
    this.#active();
    if (!Number.isSafeInteger(serializedBytes) || serializedBytes < 0) this.#fail("invalid_output_count");
    const count = (this.#perGroup.get(group) ?? 0) + 1;
    if (count >= SMA_MEASUREMENT_LIMITS.intervalsPerGroup) this.#fail("group_interval_limit");
    if (this.#intervals + 1 >= SMA_MEASUREMENT_LIMITS.intervalsTotal) this.#fail("total_interval_limit");
    this.checkOutputBytes(this.#outputEstimate + serializedBytes);
    this.#perGroup.set(group, count);
    this.#intervals++;
    this.#outputEstimate += serializedBytes;
  }
}

export type SmaCrossPoint = { at: number; close: number; fast: number; slow: number };
type SmaSignedPoint = { at: number; close: number; differenceSign: -1 | 0 | 1 };
type SmaStatePoint = SmaCrossPoint | SmaSignedPoint;
export type SmaCrossInterval = {
  ordinal: number;
  direction: 1 | -1;
  startAt: number | null;
  startClose: number | null;
  endAt: number | null;
  endClose: number | null;
  leftCensored: boolean;
  rightCensored: boolean;
  directionalLogChange: number | null;
};
export type SmaSegments = {
  status: "complete" | "held";
  reason: string | null;
  intervals: SmaCrossInterval[];
};

function logChange(from: number, to: number): number {
  const difference = to - from;
  if (difference === 0) return 0;
  return Math.abs(difference) < from / 2 ? Math.log1p(difference / from) : Math.log(to) - Math.log(from);
}

function differenceSign(point: SmaStatePoint): -1 | 0 | 1 {
  return "differenceSign" in point ? point.differenceSign : point.fast > point.slow ? 1 : point.fast < point.slow ? -1 : 0;
}

export function segmentSmaCrossV2(points: readonly SmaStatePoint[],
  budget = new SmaMeasurementBudget(), group = "standalone"): SmaSegments {
  budget.checkInputCounts([points.length]);
  const intervals: SmaCrossInterval[] = [];
  try {
    for (let i = 0; i < points.length; i++) {
      budget.step();
      if (!Object.hasOwn(points, i)) throw new Error("sparse_points");
      const point = points[i]!;
      if (!point || !Number.isSafeInteger(point.at)) throw new Error("bar_time");
      if (i > 0 && point.at <= points[i - 1]!.at) throw new Error("bar_order");
      if (!Number.isFinite(point.close) || point.close <= 0) throw new Error("invalid_price");
      if ("differenceSign" in point) {
        if ("fast" in point || "slow" in point || ![-1, 0, 1].includes(point.differenceSign)) throw new Error("invalid_sma_difference");
      } else if (![point.fast, point.slow].every(x => Number.isFinite(x) && x > 0)) throw new Error("invalid_price");
    }
    let first = 0;
    while (first < points.length && points[first]!.at < SMA_PERIOD_START) first++;
    if (first === points.length || points[first]!.at >= SMA_PERIOD_END) {
      return { status: "held", reason: "period_data_missing", intervals: [] };
    }
    let direction: 1 | -1 | null = null;
    let searched = 0;
    for (let i = first - 1; i >= 0; i--) {
      if (++searched >= SMA_MEASUREMENT_LIMITS.initialSearch) budget.stop("initial_search_limit");
      budget.step();
      const difference = differenceSign(points[i]!);
      if (difference !== 0) { direction = difference > 0 ? 1 : -1; break; }
    }
    if (direction === null) return { status: "held", reason: "initial_direction_unknown", intervals: [] };
    const append = (interval: SmaCrossInterval) => {
      budget.addInterval(group, Buffer.byteLength(JSON.stringify(interval), "utf8") + 1);
      intervals.push(interval);
    };
    let startAt: number | null = null;
    let startClose: number | null = null;
    let previous = differenceSign(points[first - 1]!);
    for (let i = first; i < points.length; i++) {
      const point = points[i]!;
      if (point.at >= SMA_PERIOD_END) break;
      budget.step();
      const difference = differenceSign(point);
      const candidate = difference > 0 && previous <= 0 ? 1 : difference < 0 && previous >= 0 ? -1 : null;
      if (candidate !== null && candidate !== direction) {
        append({
          ordinal: intervals.length, direction, startAt, startClose, endAt: point.at, endClose: point.close,
          leftCensored: startAt === null, rightCensored: false,
          directionalLogChange: startClose === null ? null : direction * logChange(startClose, point.close),
        });
        direction = candidate;
        startAt = point.at;
        startClose = point.close;
      }
      previous = difference;
    }
    append({ ordinal: intervals.length, direction, startAt, startClose, endAt: null, endClose: null,
      leftCensored: startAt === null, rightCensored: true, directionalLogChange: null });
    return { status: "complete", reason: null, intervals };
  } catch (error) {
    if (error instanceof SmaMeasurementStop) error.partialIntervals = intervals;
    throw error;
  }
}

export type NativeSmaBar = {
  openAt: number; endAt: number; close: number | null; confirmed: boolean;
  confirmationObservedAt: number | null; confirmationEvidence: string | null;
  continuity: "start" | "continuous" | "scheduled_closure" | "unknown";
  continuityEvidence: string | null;
};
export type NativeSmaSeries = {
  symbol: string; timeframe: "30" | "60";
  timeBasis: "confirmed_bar_end_utc_ms"; nativeEvidence: string;
  coverage: { from: number; through: number; tail: "continuous" | "scheduled_closure"; evidenceRef: string };
  bars: readonly NativeSmaBar[];
};
export type SmaMeasurementInput = {
  definition: MeasurementHypothesis; definitionHash: string;
  series: readonly NativeSmaSeries[];
  inference?: Readonly<Record<string, SmaInferenceEvidence>>;
};
export type SmaGroupResult = {
  id: string; symbol: string; timeframe: string; fast: number; slow: number;
  status: "pending" | "held" | "evaluated"; reason: string | null;
  observationsKnown: boolean; intervals: SmaCrossInterval[];
  qualityFlagCounts: Record<string, number>;
  withheldIntervalCount: number | null;
  intervalCounts: { complete: number; left: number; right: number; both: number; uniqueCensored: number } | null;
  statistics: SmaStatistic; holm: HolmResult | null;
};
export type SmaMeasurementReport = {
  schema: "sma_cross_measurement_v2";
  definitionId: string; definitionHash: string;
  period: { start: number; endExclusive: number; timeBasis: "confirmed_bar_end_utc_ms" };
  status: "complete" | "aborted"; stopReason: string | null;
  executionAllowed: false; adoptionAllowed: false;
  inferenceEvidenceIsCallerSupplied: true;
  sourceEvidenceIsCallerSupplied: true;
  familyEvaluated: boolean;
  groups: SmaGroupResult[];
  progress: { validatedBars: number; processedGroups: number; remainingGroups: number; remainingBars: number | null; workSteps: number; intervalCount: number };
};

function sameKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}

function boundDefinition(value: unknown, hash: unknown): boolean {
  if (hash !== SMA_CROSS_V2_HASH || !sameKeys(value,
    ["definitionSchema", "hypothesisId", "title", "thesis", "evaluationContract"])) return false;
  const c = value.evaluationContract;
  if (!sameKeys(c, ["population", "primaryMetric", "minimumObservations", "observationUnit",
    "familyDefinition", "decisionRule", "symbols", "timeframes"])) return false;
  const texts: [unknown, number][] = [[value.definitionSchema, 64], [value.hypothesisId, 80],
    [value.title, 120], [value.thesis, 2000], [c.population, 32], [c.primaryMetric, 32],
    [c.observationUnit, 500], [c.familyDefinition, 2000], [c.decisionRule, 2000]];
  if (!texts.every(([v, max]) => typeof v === "string" && v.length > 0 && v.length <= max) ||
      !Number.isInteger(c.minimumObservations)) return false;
  for (const list of [c.symbols, c.timeframes]) {
    if (!Array.isArray(list) || list.length !== 2) return false;
    for (let i = 0; i < list.length; i++) if (!Object.hasOwn(list, i) || typeof list[i] !== "string" || list[i].length > 48) return false;
  }
  const payload = { definitionSchema: value.definitionSchema, hypothesisId: value.hypothesisId,
    title: value.title, thesis: value.thesis, evaluationContract: {
      population: c.population, primaryMetric: c.primaryMetric, minimumObservations: c.minimumObservations,
      observationUnit: c.observationUnit, familyDefinition: c.familyDefinition, decisionRule: c.decisionRule,
      symbols: [...new Set((c.symbols as string[]).map(v => v.toUpperCase()))].sort(),
      timeframes: [...new Set((c.timeframes as string[]).map(v => v.toUpperCase()))].sort(),
    } };
  return `sha256:${createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex")}` === SMA_CROSS_V2_HASH;
}

const reference = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 256;
type PreparedSeries = { bars: NativeSmaBar[]; differences: Map<string, (SmaSignedPoint["differenceSign"] | null)[]>;
  reason: string | null; qualityFlagCounts: Record<string, number> };

/** Positive finite binary64 x is exactly units(x) * 2^-1074, including subnormals. */
function binary64Units(value: number, view: DataView): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new SmaMeasurementStop("invalid_price");
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const exponent = (bits >> 52n) & 0x7ffn;
  const fraction = bits & ((1n << 52n) - 1n);
  return exponent === 0n ? fraction : ((1n << 52n) | fraction) << (exponent - 1n);
}

function prepareSeries(series: NativeSmaSeries, budget: SmaMeasurementBudget,
  progress: SmaMeasurementReport["progress"]): PreparedSeries {
  let reason: string | null = null;
  const qualityFlagCounts: Record<string, number> = {};
  const hold = (why: string) => { reason ??= why; qualityFlagCounts[why] = (qualityFlagCounts[why] ?? 0) + 1; };
  if (series.timeBasis !== "confirmed_bar_end_utc_ms") hold("time_contract_unverified");
  if (!reference(series.nativeEvidence)) hold("native_source_unverified");
  const coverage = series.coverage;
  if (!coverage || !Number.isSafeInteger(coverage.from) || !Number.isSafeInteger(coverage.through) ||
      coverage.from > SMA_PERIOD_START || coverage.through < SMA_PERIOD_END || !reference(coverage.evidenceRef) ||
      !["continuous", "scheduled_closure"].includes(coverage.tail)) hold("coverage_unverified");
  const bars: NativeSmaBar[] = [];
  const duration = Number(series.timeframe) * 60_000;
  for (let i = 0; i < series.bars.length; i++) {
    budget.step();
    if (!Object.hasOwn(series.bars, i)) budget.stop("sparse_bars");
    const bar = series.bars[i]!;
    if (!bar || !Number.isSafeInteger(bar.openAt) || !Number.isSafeInteger(bar.endAt) || bar.openAt >= bar.endAt) budget.stop("bar_time");
    const previous = series.bars[i - 1];
    if (previous && bar.endAt <= previous.endAt) budget.stop("bar_order");
    if (previous && bar.openAt < previous.endAt) budget.stop("bar_overlap");
    // Later closes and confirmation flags cannot affect a measurement ending at the frozen cutoff.
    if (bar.endAt >= SMA_PERIOD_END) { progress.validatedBars++; continue; }
    if (bar.close === null) hold("close_missing");
    else if (typeof bar.close !== "number" || !Number.isFinite(bar.close) || bar.close <= 0) budget.stop("invalid_price");
    if (typeof bar.confirmed !== "boolean") budget.stop("invalid_confirmation_flag");
    if (!bar.confirmed || !reference(bar.confirmationEvidence) || !Number.isSafeInteger(bar.confirmationObservedAt) ||
        bar.confirmationObservedAt! < bar.endAt) hold("confirmation_unverified");
    if (bar.endAt - bar.openAt > duration) hold("native_duration_unverified");
    if (previous) {
      if (bar.continuity === "continuous") {
        if (bar.openAt !== previous.endAt || !reference(bar.continuityEvidence)) hold("continuity_unverified");
      } else if (bar.continuity === "scheduled_closure") {
        if (bar.openAt <= previous.endAt || !reference(bar.continuityEvidence)) hold("closure_unverified");
      } else hold("continuity_unverified");
    } else if (bar.continuity !== "start") hold("continuity_unverified");
    bars.push(bar);
    progress.validatedBars++;
  }
  const last = bars.at(-1);
  if (!last) hold("period_data_missing");
  if (coverage?.tail === "continuous" && last && last.endAt + duration < SMA_PERIOD_END) hold("tail_coverage_unverified");
  const differences: PreparedSeries["differences"] = new Map();
  if (!reason) {
    const periods = [10, 40, 60, 90, 120];
    const pairs = [[10, 40], [40, 60], [60, 90], [90, 120]] as const;
    const sums = new Map(periods.map(n => [n, 0n]));
    const ring: bigint[] = new Array(120).fill(0n);
    const view = new DataView(new ArrayBuffer(8));
    for (const [fast, slow] of pairs) differences.set(`${fast}/${slow}`, []);
    for (let i = 0; i < bars.length; i++) {
      const current = binary64Units(bars[i]!.close!, view);
      for (const n of periods) {
        budget.step();
        const sum = sums.get(n)! - (i >= n ? ring[(i - n) % 120]! : 0n) + current;
        sums.set(n, sum);
      }
      // Read every departing value, including n=120, before overwriting its ring slot.
      ring[i % 120] = current;
      for (const [fast, slow] of pairs) {
        const values = differences.get(`${fast}/${slow}`)!;
        if (i + 1 < slow) { values.push(null); continue; }
        // Compare sum_fast/fast with sum_slow/slow without rounding either mean.
        const difference = sums.get(fast)! * BigInt(slow) - sums.get(slow)! * BigInt(fast);
        values.push(difference > 0n ? 1 : difference < 0n ? -1 : 0);
      }
    }
  }
  return { bars, differences, reason, qualityFlagCounts };
}

export function measureSmaCrossV2(input: SmaMeasurementInput): SmaMeasurementReport {
  const budget = new SmaMeasurementBudget();
  const groups: SmaGroupResult[] = SMA_MEASUREMENT_GROUPS.map(g => ({ ...g,
    status: "pending", reason: "not_processed", observationsKnown: false, intervals: [],
    qualityFlagCounts: {}, withheldIntervalCount: null, intervalCounts: null,
    statistics: calculateSmaStatistic([]), holm: null }));
  const report: SmaMeasurementReport = {
    schema: "sma_cross_measurement_v2", definitionId: SMA_CROSS_V2_ID, definitionHash: SMA_CROSS_V2_HASH,
    period: { start: SMA_PERIOD_START, endExclusive: SMA_PERIOD_END, timeBasis: "confirmed_bar_end_utc_ms" },
    status: "complete", stopReason: null, executionAllowed: false, adoptionAllowed: false,
    inferenceEvidenceIsCallerSupplied: true, sourceEvidenceIsCallerSupplied: true, familyEvaluated: false, groups,
    progress: { validatedBars: 0, processedGroups: 0, remainingGroups: 16, remainingBars: null, workSteps: 0, intervalCount: 0 },
  };
  let activeGroup: SmaGroupResult | null = null;
  try {
    if (!input || !boundDefinition(input.definition, input.definitionHash)) budget.stop("definition_mismatch");
    if (!Array.isArray(input.series) || input.series.length > 4) budget.stop("invalid_series");
    budget.checkInputCounts(input.series.map(s => Array.isArray(s?.bars) ? s.bars.length : NaN));
    const sources = new Map<string, NativeSmaSeries>();
    for (let i = 0; i < input.series.length; i++) {
      if (!Object.hasOwn(input.series, i)) budget.stop("sparse_series");
      const source = input.series[i]!;
      if (!source || !Array.isArray(source.bars) ||
          !SMA_MEASUREMENT_GROUPS.some(g => g.symbol === source.symbol && g.timeframe === source.timeframe)) budget.stop("invalid_series");
      const key = `${source.symbol}|${source.timeframe}`;
      if (sources.has(key)) budget.stop("duplicate_series");
      sources.set(key, source);
    }
    if (input.inference && (typeof input.inference !== "object" || Array.isArray(input.inference) ||
      Object.keys(input.inference).some(id => !SMA_MEASUREMENT_GROUPS.some(g => g.id === id)))) budget.stop("invalid_inference_group");
    const totalBars = input.series.reduce((n, s) => n + s.bars.length, 0);
    report.progress.remainingBars = totalBars;
    const prepared = new Map<string, PreparedSeries>();
    for (const group of groups) {
      activeGroup = group;
      const key = `${group.symbol}|${group.timeframe}`, source = sources.get(key);
      if (!source) { group.status = "held"; group.reason = "series_missing"; }
      else {
        let data = prepared.get(key);
        if (!data) { data = prepareSeries(source, budget, report.progress); prepared.set(key, data); }
        group.qualityFlagCounts = { ...data.qualityFlagCounts };
        if (data.reason) { group.status = "held"; group.reason = data.reason; }
        else {
          const signs = data.differences.get(`${group.fast}/${group.slow}`)!;
          const points: SmaSignedPoint[] = [];
          for (let i = 0; i < data.bars.length; i++) {
            if (signs[i] !== null) points.push({ at: data.bars[i]!.endAt,
              close: data.bars[i]!.close!, differenceSign: signs[i]! });
          }
          let segmented: SmaSegments;
          try { segmented = segmentSmaCrossV2(points, budget, group.id); }
          catch (error) {
            if (error instanceof SmaMeasurementStop) group.intervals = error.partialIntervals;
            throw error;
          }
          group.intervals = segmented.intervals;
          group.observationsKnown = segmented.status === "complete";
          if (segmented.status === "held") { group.status = "held"; group.reason = segmented.reason; }
          else {
            const values: number[] = [];
            const counts = { complete: 0, left: 0, right: 0, both: 0, uniqueCensored: 0 };
            for (const interval of group.intervals) {
              budget.step();
              if (interval.leftCensored) counts.left++;
              if (interval.rightCensored) counts.right++;
              if (interval.leftCensored && interval.rightCensored) counts.both++;
              if (interval.leftCensored || interval.rightCensored) counts.uniqueCensored++;
              if (!interval.leftCensored && !interval.rightCensored) {
                counts.complete++;
                if (interval.directionalLogChange === null || !Number.isFinite(interval.directionalLogChange)) budget.stop("interval_numeric_failure");
                values.push(interval.directionalLogChange!);
              }
            }
            group.intervalCounts = counts;
            group.withheldIntervalCount = 0;
            group.statistics = calculateSmaStatistic(values, input.inference?.[group.id]);
            group.reason = group.statistics.reason;
            group.status = group.statistics.eligible ? "evaluated" : "held";
          }
        }
      }
      report.progress.processedGroups++;
      activeGroup = null;
    }
    budget.step(16 * 16); // Conservatively charge the fixed-family ranking work.
    const holm = holm16(groups.map(g => ({ groupId: g.id, pValue: g.statistics.pValue, eligible: g.statistics.eligible })));
    groups.forEach((g, i) => { g.holm = holm[i]!; });
    report.familyEvaluated = true;
  } catch (error) {
    report.status = "aborted";
    report.stopReason = error instanceof Error ? error.message : "calculation_failure";
    if (activeGroup) { activeGroup.status = "held"; activeGroup.reason = report.stopReason; activeGroup.observationsKnown = false; }
  }
  report.progress.remainingGroups = 16 - report.progress.processedGroups;
  report.progress.workSteps = budget.steps;
  report.progress.intervalCount = budget.intervals;
  if (report.progress.remainingBars !== null) report.progress.remainingBars -= report.progress.validatedBars;
  try { budget.checkOutputBytes(Buffer.byteLength(JSON.stringify(report), "utf8") + 1); }
  catch (error) {
    report.status = "aborted";
    report.stopReason ??= error instanceof Error ? error.message : "calculation_failure";
  }
  if (report.status === "aborted") {
    report.familyEvaluated = false;
    groups.forEach(g => { g.holm = null; });
  }
  return report;
}
