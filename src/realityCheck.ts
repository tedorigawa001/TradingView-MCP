/**
 * White's Reality Check (2000) and Hansen's test for superior predictive ability (2005) by the stationary bootstrap
 * (BACKLOG 103-8; contract in docs/REALITY_CHECK.md). A pure computation over the numbers it is given.
 */
import { createRandom } from "./seededRandom.js";

const MAX_CONFIGURATIONS = 1_000;
const MAX_CELLS = 500_000;
const MIN_PERIODS = 10;
const MAX_PERIODS = 100_000;
const MAX_ABS_RETURN = 1e300;
const MIN_DRAWS = 100;
const MAX_DRAWS = 10_000;
const DEFAULT_DRAWS = 2_000;
const DEFAULT_SEED = 20_261_011;
// Bootstrap work, draws × expected runs × (20 + configurations) with expected runs = periods / mean block, is at most
// this: a few seconds. Drawing a run costs about twenty times summing one configuration over it.
const MAX_WORK = 2e9;
// A configuration whose differences from the benchmark are at most this share of its returns' largest magnitude differs
// only by rounding: it is identical to the benchmark. (Its returns' magnitude is then the benchmark's too.)
const IDENTICAL_RELATIVE = 1e-12;
// Differences whose range is at most this share of their largest magnitude are constant.
const CONSTANT_RELATIVE_RANGE = 1e-12;

export type RealityCheckInput = {
  configurations: Array<{ id: string; returns: number[] }>;
  benchmark?: number[];
  mean_block?: number;
  draws?: number;
  seed?: number;
};

const LIMITATIONS = [
  "The configurations must be every one tried, discarded ones included, over the same aligned periods; the tests describe the best among the configurations given.",
  "Performance is the mean per-period return in excess of the benchmark (zero when none is given): not risk-adjusted, with no costs beyond those already in the returns.",
  "The stationary bootstrap assumes the differences are stationary and weakly dependent; the mean block length should cover their serial dependence, and the p-values depend on it.",
  "The tests ask only whether the best configuration beats the benchmark. They do not say which others do, nor how large the edge is after costs.",
  "The Reality Check is conservative when many configurations are poor; Hansen's consistent p-value is the recommended one. P-values carry Monte Carlo error from the finite number of draws.",
];

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Throws if any number in a result is not finite: a guard, since the input ranges keep every result finite. */
function assertAllFinite(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`compute_reality_check produced a non-finite value at ${path}`);
  } else if (Array.isArray(value)) value.forEach((item, index) => assertAllFinite(item, `${path}[${index}]`));
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) assertAllFinite(item, `${path}.${key}`);
}

/** Refuses anything but an array of finite numbers of the given length range, holes included (an index loop). */
function finiteReturns(values: unknown, label: string): number[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array of finite numbers`);
  for (let t = 0; t < values.length; t += 1) {
    const value: unknown = values[t];
    if (!isFiniteNumber(value) || Math.abs(value) > MAX_ABS_RETURN) throw new Error(`${label} must be finite numbers of magnitude at most ${MAX_ABS_RETURN} (period ${t})`);
  }
  return values as number[];
}

function validate(input: RealityCheckInput) {
  const configurations = input?.configurations;
  if (!Array.isArray(configurations) || configurations.length < 1 || configurations.length > MAX_CONFIGURATIONS) {
    throw new Error(`configurations must hold 1 to ${MAX_CONFIGURATIONS} configurations`);
  }
  const ids = new Set<string>();
  let length: number | null = null;
  for (let index = 0; index < configurations.length; index += 1) {
    const configuration = configurations[index];
    if (configuration === null || typeof configuration !== "object") throw new Error(`configuration ${index} must be an object with id and returns`);
    const { id, returns } = configuration;
    if (typeof id !== "string" || id.length < 1 || id.length > 80) throw new Error(`configuration ${index} needs an id of 1 to 80 characters`);
    if (ids.has(id)) throw new Error(`configuration id "${id}" is not unique`);
    ids.add(id);
    finiteReturns(returns, `configuration "${id}" returns`);
    if (length === null) length = returns.length;
    else if (returns.length !== length) throw new Error(`configuration "${id}" has ${returns.length} returns; every configuration must have ${length}`);
  }
  const periods = length!;
  if (periods < MIN_PERIODS || periods > MAX_PERIODS) throw new Error(`each configuration must hold ${MIN_PERIODS} to ${MAX_PERIODS} returns; got ${periods}`);
  if (periods * configurations.length > MAX_CELLS) throw new Error(`configurations hold ${periods * configurations.length} returns; at most ${MAX_CELLS}`);
  const benchmark = input.benchmark === undefined ? null : finiteReturns(input.benchmark, "benchmark");
  if (benchmark !== null && benchmark.length !== periods) throw new Error(`benchmark has ${benchmark.length} returns; it must have ${periods}, like the configurations`);
  const meanBlock = input.mean_block === undefined ? Math.max(1, Math.round(Math.cbrt(periods))) : input.mean_block;
  if (!(isFiniteNumber(meanBlock) && meanBlock >= 1 && meanBlock <= periods / 2)) throw new Error(`mean_block must be a number from 1 to half the periods (${periods / 2})`);
  const draws = input.draws === undefined ? DEFAULT_DRAWS : input.draws;
  if (!(isFiniteNumber(draws) && Number.isInteger(draws) && draws >= MIN_DRAWS && draws <= MAX_DRAWS)) throw new Error(`draws must be an integer from ${MIN_DRAWS} to ${MAX_DRAWS}`);
  const seed = input.seed === undefined ? DEFAULT_SEED : input.seed;
  if (!(isFiniteNumber(seed) && Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff)) throw new Error("seed must be an integer from 0 to 4294967295");
  const work = draws * (periods / meanBlock) * (20 + configurations.length);
  if (work > MAX_WORK) {
    throw new Error(`draws × (periods / mean_block) × (20 + configurations) is ${work.toExponential(3)}; at most ${MAX_WORK.toExponential(0)}. Use fewer draws, a longer mean block, or fewer configurations`);
  }
  return { configurations, benchmark, periods, meanBlock, meanBlockSource: input.mean_block === undefined ? "default" as const : "given" as const, draws, seed };
}

/**
 * The variance of √n times the stationary-bootstrap mean of centred values c, exactly (Politis and Romano 1994,
 * Lemma 1; Hansen 2005's ω̂²): C₀ + 2 Σ_{h=1}^{n−1} (1 − h/n) ρ^h C_h with circular autocovariances C_h and ρ = 1 − 1/block.
 * Hansen's form, with non-circular autocovariances and κ(n, i) = (1 − i/n) ρ^i + (i/n) ρ^{n−i}, is the same sum. O(n), by
 * backward recursions for A_t = Σ_i ρ^i c_{t+i} and B_t = Σ_i i ρ^i c_{t+i} (circular, i = 1..n−1).
 */
export function stationaryBootstrapVariance(c: ArrayLike<number>, meanBlock: number): number {
  const n = c.length; const rho = 1 - 1 / meanBlock; const rhoN = Math.pow(rho, n);
  let a = 0; let b = 0; let power = 1;
  for (let i = 1; i < n; i += 1) { power *= rho; a += power * c[i - 1]; b += i * power * c[i - 1]; }
  let c0 = 0;
  for (let t = 0; t < n; t += 1) c0 += c[t] * c[t];
  let s = c[n - 1] * (a - b / n);
  for (let t = n - 2; t >= 0; t -= 1) {
    a = rho * (c[t + 1] + a) - rhoN * c[t];
    b = rho * b + a + (1 - n) * rhoN * c[t];
    s += c[t] * (a - b / n);
  }
  return c0 / n + (2 * s) / n;
}

type Model = {
  id: string;
  identical: boolean;
  scale: number;          // largest magnitude of the differences
  meanDifference: number; // in the input's unit
  omega: number;          // ω̂, in the input's unit
  t: number;              // √n · mean / ω̂
  prefix: Float64Array;   // prefix sums of the centred, normalised differences
};

export function computeRealityCheck(input: RealityCheckInput) {
  const { configurations, benchmark, periods: n, meanBlock, meanBlockSource, draws, seed } = validate(input);
  const rootN = Math.sqrt(n);

  const models: Model[] = []; const constant: string[] = [];
  for (const { id, returns } of configurations) {
    const differences = benchmark === null ? returns : returns.map((value, t) => value - benchmark[t]);
    let scale = 0; let min = Infinity; let max = -Infinity; let returnsScale = 0;
    for (let t = 0; t < n; t += 1) {
      const value = differences[t];
      scale = Math.max(scale, Math.abs(value)); min = Math.min(min, value); max = Math.max(max, value);
      returnsScale = Math.max(returnsScale, Math.abs(returns[t]));
    }
    if (scale <= IDENTICAL_RELATIVE * returnsScale) {
      models.push({ id, identical: true, scale: 0, meanDifference: 0, omega: 0, t: 0, prefix: new Float64Array(0) });
      continue;
    }
    if ((max - min) / scale <= CONSTANT_RELATIVE_RANGE) { constant.push(id); continue; }
    // Normalised by the largest magnitude, so proportional inputs give the same statistics at any finite scale.
    let sum = 0;
    for (let t = 0; t < n; t += 1) sum += differences[t] / scale;
    const mean = sum / n;
    const centred = new Float64Array(n);
    for (let t = 0; t < n; t += 1) centred[t] = differences[t] / scale - mean;
    const omega = Math.sqrt(stationaryBootstrapVariance(centred, meanBlock));
    // A non-constant series has a positive bootstrap variance (at least C₀(1 − ρ)/(1 + ρ)); a guard.
    if (!(omega > 0)) throw new Error(`compute_reality_check lost the variance of configuration "${id}" to the numerical range`);
    const prefix = new Float64Array(n + 1);
    for (let t = 0; t < n; t += 1) prefix[t + 1] = prefix[t] + centred[t];
    models.push({ id, identical: false, scale, meanDifference: mean * scale, omega: omega * scale, t: (rootN * mean) / omega, prefix });
  }
  const identicalCount = models.filter((model) => model.identical).length;
  if (constant.length > 0) {
    return notEvaluable(`${constant.length} configuration(s) differ from the benchmark by a constant (at rounding level), so their standard error is 0 and the studentized statistic is undefined: ${constant.map((id) => `"${id}"`).join(", ")}`, { constant_configurations: constant });
  }
  if (identicalCount === models.length) return notEvaluable("every configuration is identical to the benchmark (to rounding), so there is nothing to test", {});

  // Statistics. Ties go to the earliest configuration. The Reality Check's best is over every configuration (an identical
  // one has a mean difference of 0); SPA's is over those that differ, since an identical one has no t, and the maximum
  // with 0 stands for it.
  const active = models.filter((model) => !model.identical);
  let bestMean = 0;
  for (let k = 1; k < models.length; k += 1) if (models[k].meanDifference > models[bestMean].meanDifference) bestMean = k;
  let best = 0;
  for (let k = 1; k < active.length; k += 1) if (active[k].t > active[best].t) best = k;
  const realityStatistic = rootN * models[bestMean].meanDifference;
  const spaStatistic = Math.max(active[best].t, 0);
  const threshold = Math.sqrt(2 * Math.log(Math.log(n)));
  // Recentring (Hansen 2005): the bootstrap t of configuration k is z_k/ω̂_k + shift_k. Upper: 0 (every configuration at
  // the boundary of the null). Consistent: t_k when t_k < −√(2 log log n), else 0. Lower: min(t_k, 0).
  const shifts = active.map((model) => ({ lower: Math.min(model.t, 0), consistent: model.t < -threshold ? model.t : 0 }));
  const recentred = shifts.filter((shift) => shift.consistent !== 0).length;

  // Stationary bootstrap (Politis and Romano 1994), one createRandom(seed) stream across the draws, the same time indices
  // for every configuration. Each run starts at floor(u·n) and continues at (previous + 1) mod n; its length is
  // geometric with mean mean_block, 1 + floor(ln(1 − u′) / ln(1 − 1/mean_block)), which is the same as starting a new
  // run at each position with probability 1/mean_block. The last run is cut at n periods. Each run's sum comes from the
  // prefix sums.
  const random = createRandom(seed);
  const logContinue = Math.log1p(-1 / meanBlock);
  const runStart = new Int32Array(n); const runLength = new Int32Array(n);
  let realityCount = 0; let lowerCount = 0; let consistentCount = 0; let upperCount = 0; let nominalCount = 0;
  for (let draw = 0; draw < draws; draw += 1) {
    let runs = 0;
    for (let filled = 0; filled < n; runs += 1) {
      runStart[runs] = Math.floor(random() * n);
      // With a mean block of 1 every run has length 1, and no second draw is made.
      const length = meanBlock === 1 ? 1 : 1 + Math.floor(Math.log(1 - random()) / logContinue);
      runLength[runs] = Math.min(length, n - filled);
      filled += runLength[runs];
    }
    // Identical configurations contribute 0 to the Reality Check's maximum; to SPA's, the maximum with 0 covers them.
    let realityMax = identicalCount > 0 ? 0 : -Infinity; let lowerMax = 0; let consistentMax = 0; let upperMax = 0;
    for (let k = 0; k < active.length; k += 1) {
      const { prefix, scale, omega } = active[k];
      let sum = 0;
      for (let r = 0; r < runs; r += 1) {
        const from = runStart[r]; const to = from + runLength[r];
        sum += to <= n ? prefix[to] - prefix[from] : prefix[n] - prefix[from] + prefix[to - n];
      }
      // √n (d̄* − d̄) in the input's unit, and studentized.
      const z = (sum / n) * rootN * scale;
      const studentized = z / omega;
      realityMax = Math.max(realityMax, z);
      upperMax = Math.max(upperMax, studentized);
      consistentMax = Math.max(consistentMax, studentized + shifts[k].consistent);
      lowerMax = Math.max(lowerMax, studentized + shifts[k].lower);
      if (k === best && studentized >= active[best].t) nominalCount += 1;
    }
    if (realityMax >= realityStatistic) realityCount += 1;
    if (lowerMax >= spaStatistic) lowerCount += 1;
    if (consistentMax >= spaStatistic) consistentCount += 1;
    if (upperMax >= spaStatistic) upperCount += 1;
  }
  const pValue = (count: number) => (1 + count) / (1 + draws);
  const monteCarloError = (p: number) => Math.sqrt((p * (1 - p)) / draws);

  const top = models.map((model, index) => ({ model, index }))
    .filter(({ model }) => !model.identical)
    .sort((a, b) => b.model.t - a.model.t || a.index - b.index)
    .slice(0, 10)
    .map(({ model }) => ({ id: model.id, mean_difference: model.meanDifference, t: model.t }));
  const warnings: string[] = [];
  if (n < 100) warnings.push("short_sample");
  if (draws < 1_000) warnings.push("few_draws");
  if (meanBlock > n / 10) warnings.push("long_mean_block");
  if (identicalCount > 0) warnings.push("identical_to_benchmark");

  const consistentP = pValue(consistentCount); const realityP = pValue(realityCount);
  const result = {
    status: "evaluated" as const,
    configurations: models.length,
    observations: n,
    benchmark: benchmark === null ? "zero" as const : "given" as const,
    bootstrap: { method: "stationary", draws, mean_block: meanBlock, mean_block_source: meanBlockSource, seed },
    reality_check: {
      statistic: realityStatistic, p_value: realityP, monte_carlo_error: monteCarloError(realityP),
      best: { id: models[bestMean].id, mean_difference: models[bestMean].meanDifference },
    },
    spa: {
      statistic: spaStatistic,
      p_values: { lower: pValue(lowerCount), consistent: consistentP, upper: pValue(upperCount) },
      monte_carlo_error: monteCarloError(consistentP),
      threshold, recentred_configurations: recentred,
    },
    best: {
      id: active[best].id, mean_difference: active[best].meanDifference, standard_error: active[best].omega / rootN,
      t: active[best].t, nominal_p_value: pValue(nominalCount),
    },
    positive_mean_configurations: active.filter((model) => model.meanDifference > 0).length,
    identical_to_benchmark: identicalCount,
    top_by_t: top,
    warnings,
    limitations: LIMITATIONS,
  };
  assertAllFinite(result, "result");
  return result;

  function notEvaluable(reason: string, detail: Record<string, unknown>) {
    const out = {
      status: "not_evaluable" as const, reason, ...detail,
      configurations: configurations.length, observations: n, benchmark: benchmark === null ? "zero" as const : "given" as const, limitations: LIMITATIONS,
    };
    assertAllFinite(out, "result");
    return out;
  }
}
