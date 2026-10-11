/**
 * Probability of backtest overfitting by combinatorially symmetric cross-validation (BACKLOG 103-3; contract in
 * docs/BACKTEST_OVERFITTING.md; Bailey, Borwein, Lopez de Prado and Zhu 2017). A pure computation over the numbers it
 * is given.
 */
const MAX_CONFIGURATIONS = 1_000;
const MAX_CELLS = 500_000;
const MAX_ABS_RETURN = 1e300;
const DEFAULT_BLOCKS = 16;

export type BacktestOverfittingInput = {
  configurations: Array<{ id: string; returns: number[] }>;
  blocks?: number;
};

// A per-period Sharpe ratio above this in magnitude is implausible for real returns and is warned about.
const EXTREME_SHARPE = 10;
// A set whose standard deviation is below this share of its largest magnitude is treated as constant (a rounding guard).
const CONSTANT_RELATIVE_SD = 1e-12;

const LIMITATIONS = [
  "The configurations must be every one tried, discarded ones included, over the same aligned periods; PBO describes the selection among the configurations given.",
  "Performance is the per-period Sharpe ratio (mean / standard deviation with n - 1, no risk-free rate), with no costs beyond those already in the returns. A set whose returns are all zero (no exposure) has a Sharpe ratio of 0. Sharpe ratios are compared after rounding to 12 decimal places, so ties and zeros are not decided by rounding noise.",
  "PBO counts a split whose selection lands exactly at the median as half; with no skill it is about 0.5 for any number of configurations. pbo_inclusive counts it as overfit, as the paper's integral does. The degradation slope is negative even with no skill, because each split's training and testing sets are complements.",
  "Contiguous blocks keep serial dependence inside a block, but adjacent blocks share boundaries, and training and testing sets are interleaved in time, not ordered.",
  "PBO is not a p-value. A low PBO says the in-sample ranking tends to persist out of sample among these configurations; it does not say the best one is profitable.",
  "Few blocks or few configurations give a coarse estimate.",
];

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Throws if any number in a result is not finite: a guard, since the input ranges keep every result finite. */
function assertAllFinite(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`compute_backtest_overfitting produced a non-finite value at ${path}`);
  } else if (Array.isArray(value)) value.forEach((item, index) => assertAllFinite(item, `${path}[${index}]`));
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) assertAllFinite(item, `${path}.${key}`);
}

type Moments = { n: number; mean: number; m2: number; min: number; max: number };
/** Chan, Golub and LeVeque's pairwise combination of counts, means and centred sums of squares. */
const combine = (a: Moments, b: Moments): Moments => {
  if (a.n === 0) return b;
  if (b.n === 0) return a;
  const n = a.n + b.n;
  const delta = b.mean - a.mean;
  return { n, mean: a.mean + (delta * b.n) / n, m2: a.m2 + b.m2 + (delta * delta * a.n * b.n) / n, min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
};
/**
 * Rounds a Sharpe ratio to 12 decimal places, so a tie or a zero that rounding has split by a few ulps compares as one.
 * A Sharpe ratio is unitless, so the grid is the same for every scale of returns.
 */
const roundSharpe = (value: number) => Math.round(value * 1e12) / 1e12;

/** The combinations of k indices out of 0..s−1, in lexicographic order. */
function combinations(s: number, k: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const walk = (start: number) => {
    if (pick.length === k) { out.push([...pick]); return; }
    for (let i = start; i <= s - (k - pick.length); i += 1) { pick.push(i); walk(i + 1); pick.pop(); }
  };
  walk(0);
  return out;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const quantile = (sorted: number[], q: number) => {
  const position = q * (sorted.length - 1);
  const low = Math.floor(position); const high = Math.ceil(position);
  return sorted[low] + (position - low) * (sorted[high] - sorted[low]);
};
const meanOf = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function validate(input: BacktestOverfittingInput) {
  const configurations = input?.configurations;
  if (!Array.isArray(configurations) || configurations.length < 2 || configurations.length > MAX_CONFIGURATIONS) {
    throw new Error(`configurations must hold 2 to ${MAX_CONFIGURATIONS} configurations`);
  }
  const ids = new Set<string>();
  let length: number | null = null;
  // Index loops, so a hole in a sparse array is read as undefined and refused, not skipped.
  for (let index = 0; index < configurations.length; index += 1) {
    const configuration = configurations[index];
    if (configuration === null || typeof configuration !== "object") throw new Error(`configuration ${index} must be an object with id and returns`);
    const { id, returns } = configuration;
    if (typeof id !== "string" || id.length < 1 || id.length > 80) throw new Error(`configuration ${index} needs an id of 1 to 80 characters`);
    if (ids.has(id)) throw new Error(`configuration id "${id}" is not unique`);
    ids.add(id);
    if (!Array.isArray(returns)) throw new Error(`configuration "${id}" returns must be an array of finite numbers`);
    for (let t = 0; t < returns.length; t += 1) {
      const value = returns[t];
      if (!isFiniteNumber(value) || Math.abs(value) > MAX_ABS_RETURN) {
        throw new Error(`configuration "${id}" returns must be finite numbers of magnitude at most ${MAX_ABS_RETURN} (period ${t})`);
      }
    }
    if (length === null) length = returns.length;
    else if (returns.length !== length) throw new Error(`configuration "${id}" has ${returns.length} returns; every configuration must have ${length}`);
  }
  const periods = length!;
  if (periods * configurations.length > MAX_CELLS) throw new Error(`configurations hold ${periods * configurations.length} returns; at most ${MAX_CELLS}`);
  const blocks = input.blocks === undefined ? DEFAULT_BLOCKS : input.blocks;
  if (!(isFiniteNumber(blocks) && Number.isInteger(blocks) && blocks >= 2 && blocks <= 16 && blocks % 2 === 0)) {
    throw new Error("blocks must be an even integer from 2 to 16");
  }
  if (Math.floor(periods / blocks) < 2) throw new Error(`${periods} periods give blocks of fewer than 2 periods with ${blocks} blocks; use at least ${2 * blocks} periods or fewer blocks`);
  return { configurations, periods, blocks };
}

export function computeBacktestOverfitting(input: BacktestOverfittingInput) {
  const { configurations, periods, blocks } = validate(input);
  const n = configurations.length;

  // Blocks: contiguous, sizes differing by at most one (the first T mod S hold one more).
  const base = Math.floor(periods / blocks); const extra = periods % blocks;
  const bounds: Array<[number, number]> = [];
  for (let b = 0, start = 0; b < blocks; b += 1) { const size = base + (b < extra ? 1 : 0); bounds.push([start, start + size]); start += size; }

  // Per block and configuration: count, mean and centred sum of squares, in units of the configuration's largest
  // magnitude so proportional inputs give the same result.
  const blockMoments: Moments[][] = bounds.map(() => []);
  // The raw minimum and maximum tell a constant set exactly, which the normalised moments cannot after rounding.
  const scales: number[] = [];
  configurations.forEach(({ returns }) => {
    const scale = returns.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    scales.push(scale);
    bounds.forEach(([start, end], b) => {
      let sum = 0; let min = Infinity; let max = -Infinity;
      for (let t = start; t < end; t += 1) { sum += scale > 0 ? returns[t] / scale : 0; min = Math.min(min, returns[t]); max = Math.max(max, returns[t]); }
      const mean = sum / (end - start);
      let m2 = 0;
      for (let t = start; t < end; t += 1) { const c = (scale > 0 ? returns[t] / scale : 0) - mean; m2 += c * c; }
      blockMoments[b].push({ n: end - start, mean, m2, min, max });
    });
  });

  const splits = combinations(blocks, blocks / 2);
  const empty: Moments = { n: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity };
  let extremeSharpe = false; let zeroSets = false;
  /**
   * Each configuration's Sharpe ratio on a set of blocks. A set whose returns are all zero has a Sharpe ratio of 0 (no
   * exposure, no performance). A set that is constant at another value, or varies only at rounding level, has no
   * defined Sharpe ratio; such configurations are returned as constant.
   */
  const sharpes = (indices: number[]) => {
    const values: number[] = []; const constant: number[] = [];
    for (let j = 0; j < n; j += 1) {
      let moments = empty;
      for (const b of indices) moments = combine(moments, blockMoments[b][j]);
      if (moments.min === 0 && moments.max === 0) { zeroSets = true; values.push(0); continue; }
      const largest = Math.max(Math.abs(moments.min), Math.abs(moments.max)) / scales[j];
      const sd = Math.sqrt(moments.m2 / (moments.n - 1));
      if (moments.min === moments.max || !(sd > CONSTANT_RELATIVE_SD * largest)) { constant.push(j); values.push(0); continue; }
      const sharpe = moments.mean / sd;
      if (Math.abs(sharpe) > EXTREME_SHARPE) extremeSharpe = true;
      values.push(sharpe);
    }
    return { values, constant };
  };

  const logits: number[] = []; const omegas: number[] = [];
  const trainingSelected: number[] = []; const testingSelected: number[] = [];
  const selectedCount = new Array<number>(n).fill(0);
  let belowMedian = 0; let atMedian = 0; let losses = 0;
  for (let s = 0; s < splits.length; s += 1) {
    const training = splits[s];
    const testing = bounds.map((_, b) => b).filter((b) => !training.includes(b));
    const trainingSharpe = sharpes(training);
    const testingSharpe = sharpes(testing);
    if (trainingSharpe.constant.length > 0 || testingSharpe.constant.length > 0) {
      return notEvaluable(s, training, testing, [
        ...trainingSharpe.constant.map((j) => ({ id: configurations[j].id, set: "training" as const })),
        ...testingSharpe.constant.map((j) => ({ id: configurations[j].id, set: "testing" as const })),
      ]);
    }
    // Selection, ranks and signs compare the Sharpe ratios rounded to 12 decimal places.
    const trainRounded = trainingSharpe.values.map(roundSharpe); const testRounded = testingSharpe.values.map(roundSharpe);
    let best = 0;
    for (let j = 1; j < n; j += 1) if (trainRounded[j] > trainRounded[best]) best = j;
    const x = testRounded[best];
    let below = 0; let equal = 0;
    for (const value of testRounded) { if (value < x) below += 1; else if (value === x) equal += 1; }
    // Twice the rank, an integer: below the median when 2·rank < N + 1, at the median when equal.
    const twiceRank = 2 * below + equal + 1;
    if (twiceRank < n + 1) belowMedian += 1; else if (twiceRank === n + 1) atMedian += 1;
    if (x < 0) losses += 1;
    const omega = twiceRank / (2 * (n + 1));
    omegas.push(omega);
    logits.push(Math.log(omega / (1 - omega)));
    trainingSelected.push(trainingSharpe.values[best]);
    testingSelected.push(testingSharpe.values[best]);
    selectedCount[best] += 1;
  }

  const total = splits.length;
  const sortedLogits = [...logits].sort((a, b) => a - b);
  const meanX = meanOf(trainingSelected); const meanY = meanOf(testingSelected);
  let sxx = 0; let sxy = 0; let syy = 0;
  for (let i = 0; i < total; i += 1) { const dx = trainingSelected[i] - meanX; const dy = testingSelected[i] - meanY; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const degradation = sxx > 0
    ? { slope: sxy / sxx, intercept: meanY - (sxy / sxx) * meanX, r_squared: syy > 0 ? (sxy * sxy) / (sxx * syy) : null,
      ...(syy > 0 ? {} : { r_squared_reason: "the selections' testing Sharpe ratios do not vary" }) }
    : { slope: null, intercept: null, r_squared: null, reason: "the selections' training Sharpe ratios do not vary" };
  const frequency = selectedCount.map((count, index) => ({ index, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, 10)
    .map(({ index, count }) => ({ id: configurations[index].id, count, share: count / total }));
  const blockSizes = bounds.map(([start, end]) => end - start);
  const warnings: string[] = [];
  if (Math.min(...blockSizes) < 20) warnings.push("short_blocks");
  if (n < 10) warnings.push("few_configurations");
  if (blocks < 8) warnings.push("few_splits");
  if (frequency.length > 0 && frequency[0].count > total / 2) warnings.push("dominant_selection");
  if (extremeSharpe) warnings.push("extreme_sharpe");
  if (zeroSets) warnings.push("zero_return_sets");

  const result = {
    status: "evaluated" as const,
    configurations: n,
    observations: periods,
    blocks,
    block_size: { min: Math.min(...blockSizes), max: Math.max(...blockSizes) },
    splits: total,
    pbo: (belowMedian + atMedian / 2) / total,
    pbo_inclusive: (belowMedian + atMedian) / total,
    splits_at_median: atMedian,
    logit: {
      mean: meanOf(logits),
      min: sortedLogits[0], q05: quantile(sortedLogits, 0.05), q25: quantile(sortedLogits, 0.25), median: quantile(sortedLogits, 0.5),
      q75: quantile(sortedLogits, 0.75), q95: quantile(sortedLogits, 0.95), max: sortedLogits[total - 1],
    },
    oos_relative_rank_mean: meanOf(omegas),
    selected: {
      training_sharpe_mean: meanX, training_sharpe_median: median(trainingSelected),
      testing_sharpe_mean: meanY, testing_sharpe_median: median(testingSelected),
      probability_oos_loss: losses / total,
    },
    degradation,
    selection_frequency: frequency,
    warnings,
    limitations: LIMITATIONS,
  };
  assertAllFinite(result, "result");
  return result;

  /** Names every configuration that is constant on a set of the first split where one is, with that split's blocks. */
  function notEvaluable(split: number, training: number[], testing: number[], constant: Array<{ id: string; set: "training" | "testing" }>) {
    const periodsOf = (indices: number[]) => indices.map((b) => ({ block: b, first_period: bounds[b][0], last_period: bounds[b][1] - 1 }));
    const out = {
      status: "not_evaluable" as const,
      reason: `On split ${split}, these configurations are constant at a nonzero value (or vary only at rounding level) on the set named, so their Sharpe ratio there is undefined: ${constant.map((item) => `"${item.id}" (${item.set})`).join(", ")}`,
      constant_configurations: constant,
      split: { index: split, training_blocks: periodsOf(training), testing_blocks: periodsOf(testing) },
      configurations: n, observations: periods, blocks, splits: splits.length, limitations: LIMITATIONS,
    };
    assertAllFinite(out, "result");
    return out;
  }
}
