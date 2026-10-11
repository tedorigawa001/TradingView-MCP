// BACKLOG 103-3: the probability of backtest overfitting by combinatorially symmetric cross-validation. Reference values
// come from an independent Python standard-library implementation that computes every Sharpe ratio directly on the
// concatenated periods, without combining blocks.
import test from "node:test";
import assert from "node:assert/strict";
import { computeBacktestOverfitting } from "../../build/backtestOverfitting.js";

const close = (actual, expected, relative = 1e-12, label = "") =>
  assert.ok(Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);

// Returns built from integers, so Python and JavaScript see the same numbers.
const series = (n, t, drift = () => 0) => Array.from({ length: n }, (_, j) => ({
  id: `c${j}`,
  returns: Array.from({ length: t }, (_, k) => ((k * (7919 + 13 * j) + 31 * j * j) % 1000 - 500) / 100000 + drift(j)),
}));

const checkAgainst = (result, ref, label) => {
  assert.equal(result.status, "evaluated", label);
  assert.equal(result.splits, ref.splits, `${label} splits`);
  close(result.pbo, ref.pbo, 0, `${label} pbo`);
  for (const [key, value] of [["mean", ref.logit_mean], ["q05", ref.q05], ["q25", ref.q25], ["median", ref.median], ["q75", ref.q75], ["q95", ref.q95], ["min", ref.lmin], ["max", ref.lmax]]) {
    close(result.logit[key], value, 1e-12, `${label} logit ${key}`);
  }
  close(result.oos_relative_rank_mean, ref.omega_mean, 1e-12, `${label} omega`);
  close(result.selected.training_sharpe_mean, ref.tr_mean, 1e-12, `${label} training mean`);
  close(result.selected.training_sharpe_median, ref.tr_med, 1e-12, `${label} training median`);
  close(result.selected.testing_sharpe_mean, ref.te_mean, 1e-12, `${label} testing mean`);
  close(result.selected.testing_sharpe_median, ref.te_med, 1e-12, `${label} testing median`);
  close(result.selected.probability_oos_loss, ref.ploss, 0, `${label} loss`);
  close(result.degradation.slope, ref.slope, 1e-10, `${label} slope`);
  close(result.degradation.intercept, ref.intercept, 1e-10, `${label} intercept`);
  close(result.degradation.r_squared, ref.r2, 1e-10, `${label} r2`);
  assert.deepEqual(result.selection_frequency.map((item) => [Number(item.id.slice(1)), item.count]), ref.freq, `${label} frequency`);
  assert.deepEqual([result.block_size.min, result.block_size.max], ref.block_sizes, `${label} block sizes`);
};

test("PBO, logits, ranks and degradation match the reference on 4 and 8 blocks (103-3)", () => {
  checkAgainst(computeBacktestOverfitting({ configurations: series(5, 80), blocks: 4 }), {
    splits: 6, pbo: 0.8333333333333334, logit_mean: -1.0729586082894003, q05: -1.6094379124341005, q25: -1.6094379124341005, median: -1.6094379124341005,
    q75: -0.9222198635284842, q95: 0.3465735902799725, lmin: -1.6094379124341005, lmax: 0.6931471805599452, omega_mean: 0.27777777777777773,
    tr_mean: 0.17319515164504815, tr_med: 0.17208809987606574, te_mean: -0.15728673015418268, te_med: -0.09115623168432846, ploss: 0.8333333333333334,
    slope: -1.097702953240366, intercept: 0.0328300992934997, r2: 0.35183645181258655, freq: [[1, 2], [4, 2], [0, 1], [2, 1]], block_sizes: [20, 20],
  }, "v1");
  // 203 periods in 8 blocks: the first three hold 26, the rest 25.
  checkAgainst(computeBacktestOverfitting({ configurations: series(12, 203, (j) => j * 2e-5), blocks: 8 }), {
    splits: 70, pbo: 0.4857142857142857, logit_mean: -0.06753058182524016, q05: -2.4849066497880004, q25: -2.4849066497880004, median: 0.15415067982725816,
    q75: 1.7047480922384253, q95: 2.4849066497880012, lmin: -2.4849066497880004, lmax: 2.4849066497880012, omega_mean: 0.49670329670329677,
    tr_mean: 0.8456046548108973, tr_med: 0.6303292736298898, te_mean: 0.049068726569753356, te_med: 0.04867443569916137, ploss: 0.4,
    slope: -0.07176614194929912, intercept: 0.1097545102599003, r2: 0.016349401102861365, freq: [[6, 42], [7, 16], [5, 8], [11, 3], [10, 1]], block_sizes: [25, 26],
  }, "v2");
  // Eight blocks are not few, and twelve configurations are not few; one selected in 42 of 70 splits dominates.
  assert.deepEqual(computeBacktestOverfitting({ configurations: series(12, 203, (j) => j * 2e-5), blocks: 8 }).warnings, ["dominant_selection"]);
  // Ten configurations are not few either.
  assert.equal(computeBacktestOverfitting({ configurations: series(10, 80), blocks: 4 }).warnings.includes("few_configurations"), false);
  assert.equal(computeBacktestOverfitting({ configurations: series(9, 80), blocks: 4 }).warnings.includes("few_configurations"), true);
});

test("the default 16 blocks give 12,870 splits that match the reference (103-3)", () => {
  const started = Date.now();
  const result = computeBacktestOverfitting({ configurations: series(20, 640, (j) => (j % 5) * 1e-5) });
  checkAgainst(result, {
    splits: 12870, pbo: 0.8958041958041958, logit_mean: -2.2675603279525562, q05: -2.995732273553991, q25: -2.995732273553991, median: -2.995732273553991,
    q75: -2.2512917986064953, q95: 1.1631508098056806, lmin: -2.995732273553991, lmax: 2.99573227355399, omega_mean: 0.15034965034965034,
    tr_mean: 0.22332951241050591, tr_med: 0.1827231091445375, te_mean: -0.11552670046512153, te_med: -0.07997137480812627, ploss: 0.8617715617715618,
    slope: -0.7809245146794191, intercept: 0.058876790627644116, r2: 0.7952111285142771,
    freq: [[6, 4853], [7, 4685], [5, 1712], [9, 544], [19, 463], [3, 155], [17, 128], [11, 122], [1, 103], [2, 80]], block_sizes: [40, 40],
  }, "v4");
  assert.deepEqual(result.warnings, []);
  assert.ok(Date.now() - started < 10_000, "12,870 splits should take seconds, not minutes");
});

test("a configuration that dominates everywhere has a PBO of zero and is flagged as the dominant selection (103-3)", () => {
  const result = computeBacktestOverfitting({ configurations: series(6, 120, (j) => (j === 0 ? 0.02 : 0)), blocks: 6 });
  checkAgainst(result, {
    splits: 20, pbo: 0, logit_mean: 1.7917594692280545, q05: 1.7917594692280545, q25: 1.7917594692280545, median: 1.7917594692280545,
    q75: 1.7917594692280545, q95: 1.7917594692280545, lmin: 1.7917594692280545, lmax: 1.7917594692280545, omega_mean: 0.8571428571428571,
    tr_mean: 6.906961826231537, tr_med: 6.890089009716727, te_mean: 6.906961826231537, te_med: 6.890089009716727, ploss: 0,
    slope: -0.9895153515370555, intercept: 13.741506585768061, r2: 0.9791406309275026, freq: [[0, 20]], block_sizes: [20, 20],
  }, "v3");
  assert.deepEqual(result.warnings, ["few_configurations", "few_splits", "dominant_selection"]);
  assert.equal(result.limitations.length, 5);
});

test("proportional configurations give the same result at any finite scale, subnormal included (103-3)", () => {
  const reference = computeBacktestOverfitting({ configurations: series(5, 80), blocks: 4 });
  for (const scale of [1e-300, 1e-100, 1e100, 1e298]) {
    const scaled = computeBacktestOverfitting({ configurations: series(5, 80).map((c) => ({ id: c.id, returns: c.returns.map((v) => v * scale) })), blocks: 4 });
    for (const key of ["pbo", "oos_relative_rank_mean"]) close(scaled[key], reference[key], 1e-12, `${key} at ${scale}`);
    close(scaled.selected.testing_sharpe_mean, reference.selected.testing_sharpe_mean, 1e-12, `testing at ${scale}`);
  }
  // Integers and their subnormal multiples.
  const integers = [[1, 3, 2, 5, 4, 6, 8, 7], [2, 1, 4, 3, 6, 5, 7, 9]];
  const plain = computeBacktestOverfitting({ configurations: integers.map((r, j) => ({ id: `i${j}`, returns: r })), blocks: 2 });
  const tiny = computeBacktestOverfitting({ configurations: integers.map((r, j) => ({ id: `i${j}`, returns: r.map((v) => v * 5e-324) })), blocks: 2 });
  close(tiny.selected.training_sharpe_mean, plain.selected.training_sharpe_mean, 1e-12, "subnormal training");
  close(tiny.pbo, plain.pbo, 0, "subnormal pbo");
});

test("a configuration with no variation on a set is not evaluable, and names it (103-3)", () => {
  const configurations = [...series(3, 40), { id: "flat", returns: Array(40).fill(0.001) }];
  const result = computeBacktestOverfitting({ configurations, blocks: 4 });
  assert.equal(result.status, "not_evaluable");
  assert.match(result.reason, /configuration "flat" has zero standard deviation on the training set of split 0/);
  assert.equal("pbo" in result, false);
  // Constant within one block only is fine: a set always holds several blocks.
  const piecewise = [...series(3, 40), { id: "steps", returns: Array.from({ length: 40 }, (_, t) => (t < 10 ? 0.001 : (t % 3) / 1000)) }];
  assert.equal(computeBacktestOverfitting({ configurations: piecewise, blocks: 4 }).status, "evaluated");
});

test("the inputs are checked (103-3)", () => {
  const ok = series(3, 40);
  const cases = [
    [{ configurations: ok.slice(0, 1) }, /configurations must hold 2 to 1000/],
    [{ configurations: "x" }, /configurations must hold 2 to 1000/],
    [{ configurations: [...ok, { id: "c0", returns: ok[0].returns }] }, /id "c0" is not unique/],
    [{ configurations: [...ok, { id: "", returns: ok[0].returns }] }, /needs an id of 1 to 80 characters/],
    [{ configurations: [...ok, { id: "x".repeat(81), returns: ok[0].returns }] }, /needs an id of 1 to 80 characters/],
    [{ configurations: [...ok, { id: "short", returns: ok[0].returns.slice(1) }] }, /has 39 returns; every configuration must have 40/],
    [{ configurations: [...ok, { id: "nan", returns: [...ok[0].returns.slice(1), NaN] }] }, /returns must be finite numbers/],
    [{ configurations: [...ok, { id: "big", returns: [...ok[0].returns.slice(1), 1e301] }] }, /magnitude at most 1e\+300/],
    [{ configurations: [...ok, { id: "str", returns: [...ok[0].returns.slice(1), "0.1"] }] }, /returns must be finite numbers/],
    [{ configurations: [...ok, null] }, /configuration 3 must be an object/],
    [{ configurations: ok, blocks: 3 }, /blocks must be an even integer from 2 to 16/],
    [{ configurations: ok, blocks: 18 }, /blocks must be an even integer from 2 to 16/],
    [{ configurations: ok, blocks: "4" }, /blocks must be an even integer from 2 to 16/],
    [{ configurations: ok, blocks: null }, /blocks must be an even integer from 2 to 16/],
    [{ configurations: series(3, 30), blocks: 16 }, /30 periods give blocks of fewer than 2 periods with 16 blocks/],
    [{ configurations: series(2, 250_001) }, /hold 500002 returns; at most 500000/],
  ];
  for (const [input, pattern] of cases) assert.throws(() => computeBacktestOverfitting(input), pattern, JSON.stringify(Object.keys(input)));
  // Blocks default to 16.
  assert.equal(computeBacktestOverfitting({ configurations: series(3, 64) }).splits, 12870);
});

test("ties choose the earliest configuration, ranks average ties, and a median rank counts towards PBO (103-3)", () => {
  // Two identical configurations tie everywhere: the earlier one is always selected, and its testing rank averages
  // the tie.
  const base = series(3, 40);
  const twins = [base[0], { id: "twin", returns: base[0].returns }, base[1], base[2]];
  const result = computeBacktestOverfitting({ configurations: twins, blocks: 4 });
  assert.equal(result.selection_frequency.some((item) => item.id === "twin"), false);
  // Reference: the tie is ranked by its average (Python, same data).
  close(result.oos_relative_rank_mean, 0.45, 1e-12, "average-ranked tie");
  close(result.pbo, 0.6666666666666666, 0, "twins pbo");
  close(result.logit.mean, -0.23104906018664836, 1e-12, "twins logit mean");
  // With three configurations, one that is always second out of sample has rank 2 of 3, a relative rank of 0.5 and a
  // logit of 0, which counts towards PBO.
  const t = 40;
  const lead = Array.from({ length: t }, (_, k) => (k % 2 === 0 ? 0.03 : -0.01));
  const middle = Array.from({ length: t }, (_, k) => (k % 2 === 0 ? 0.02 : -0.01));
  const low = Array.from({ length: t }, (_, k) => (k % 2 === 0 ? 0.01 : -0.01));
  // The middle configuration leads on training sets by construction: it is shifted up on the first half of the periods.
  const middleBoosted = middle.map((v, k) => (k < t / 2 ? v + 0.05 : v));
  const leadDamped = lead.map((v, k) => (k < t / 2 ? v - 0.02 : v));
  const median = computeBacktestOverfitting({ configurations: [{ id: "lead", returns: leadDamped }, { id: "middle", returns: middleBoosted }, { id: "low", returns: low }], blocks: 2 });
  assert.equal(median.splits, 2);
  assert.equal(median.status, "evaluated");
  // On the split training on the first half, "middle" is selected and ranks second of three out of sample: logit 0.
  assert.ok(median.logit.max >= 0 && median.logit.min <= 0);
  assert.equal(median.pbo, 1, "a logit of exactly 0 counts as at or below the median");
  close(median.logit.max, 0, 0, "the median rank's logit");
  // Selected in exactly half the splits is not dominant.
  assert.deepEqual(median.warnings, ["few_configurations", "few_splits"]);
});
