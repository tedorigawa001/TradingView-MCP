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
  close(result.pbo_inclusive, ref.pbo_inclusive ?? ref.pbo, 0, `${label} pbo_inclusive`);
  assert.equal(result.splits_at_median, ref.at_median ?? 0, `${label} splits at the median`);
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
  assert.equal(result.limitations.length, 6);
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

test("a configuration constant at a nonzero value on a set is not evaluable, naming every one with the split's blocks (103-3)", () => {
  const configurations = [...series(3, 40), { id: "flat", returns: Array(40).fill(0.001) }];
  const result = computeBacktestOverfitting({ configurations, blocks: 4 });
  assert.equal(result.status, "not_evaluable");
  assert.match(result.reason, /^On split 0, these configurations are constant at a nonzero value .*: "flat" \(training\), "flat" \(testing\)$/);
  assert.deepEqual(result.constant_configurations, [{ id: "flat", set: "training" }, { id: "flat", set: "testing" }]);
  assert.deepEqual(result.split, {
    index: 0,
    training_blocks: [{ block: 0, first_period: 0, last_period: 9 }, { block: 1, first_period: 10, last_period: 19 }],
    testing_blocks: [{ block: 2, first_period: 20, last_period: 29 }, { block: 3, first_period: 30, last_period: 39 }],
  });
  assert.equal("pbo" in result, false);
  // Constant within one block only is fine: a set always holds several blocks.
  const piecewise = [...series(3, 40), { id: "steps", returns: Array.from({ length: 40 }, (_, t) => (t < 10 ? 0.001 : (t % 3) / 1000)) }];
  assert.equal(computeBacktestOverfitting({ configurations: piecewise, blocks: 4 }).status, "evaluated");
  // Constant on blocks 1 and 3 only: the splits run in lexicographic order ([0,1], [0,2], ...), so the first one where
  // a set is constant is split 1, on its testing set. Every constant configuration is named, in input order.
  const alternate = (t) => (Math.floor(t / 10) % 2 === 1 ? 0.002 : ((t % 4) - 1.5) / 1000);
  const odd = [...series(3, 40), { id: "odd", returns: Array.from({ length: 40 }, (_, t) => alternate(t)) }, { id: "odd2", returns: Array.from({ length: 40 }, (_, t) => 2 * alternate(t)) }];
  const second = computeBacktestOverfitting({ configurations: odd, blocks: 4 });
  assert.equal(second.status, "not_evaluable");
  assert.deepEqual(second.constant_configurations, [{ id: "odd", set: "testing" }, { id: "odd2", set: "testing" }]);
  assert.deepEqual([second.split.index, second.split.training_blocks.map((b) => b.block), second.split.testing_blocks.map((b) => b.block)], [1, [0, 2], [1, 3]]);
  assert.match(second.reason, /split 1/);
  // A value with no exact binary form, repeated: its normalised mean need not equal it, so the centred sum of squares
  // can be a rounding residue. The raw minimum and maximum still see a constant set.
  const third = [...series(3, 40), { id: "third", returns: Array.from({ length: 40 }, (_, t) => (t < 20 ? 0.001 : t % 2 === 0 ? 0.003 : -0.001)) }];
  const thirdResult = computeBacktestOverfitting({ configurations: third, blocks: 2 });
  assert.equal(thirdResult.status, "not_evaluable");
  assert.deepEqual(thirdResult.constant_configurations, [{ id: "third", set: "training" }]);
  // The same over 16 blocks: half the history flat at 0.0001 is constant on the first split's training set.
  const halfFlat = [...series(19, 640), { id: "half", returns: Array.from({ length: 640 }, (_, t) => (t < 320 ? 0.0001 : ((t % 5) - 2) / 1000)) }];
  const sixteen = computeBacktestOverfitting({ configurations: halfFlat });
  assert.equal(sixteen.status, "not_evaluable");
  assert.deepEqual(sixteen.constant_configurations, [{ id: "half", set: "training" }]);
  assert.equal(sixteen.split.testing_blocks[0].first_period, 320);
  // Values that differ only in the last bit vary at rounding level, and count as constant.
  const ulp = [...series(3, 40), { id: "ulp", returns: Array.from({ length: 40 }, (_, t) => (t % 2 === 0 ? 0.1 + 0.2 : 0.3)) }];
  assert.deepEqual(computeBacktestOverfitting({ configurations: ulp, blocks: 2 }).constant_configurations, [{ id: "ulp", set: "training" }, { id: "ulp", set: "testing" }]);
  // The rounding-level test is relative to the set's largest magnitude, so it holds at any scale.
  const tiny = 3e-11; const nextTiny = tiny * (1 + Number.EPSILON);
  const ulpTiny = [...series(3, 40), { id: "ulp", returns: Array.from({ length: 40 }, (_, t) => (t % 2 === 0 ? tiny : nextTiny)) }];
  assert.deepEqual(computeBacktestOverfitting({ configurations: ulpTiny, blocks: 2 }).constant_configurations, [{ id: "ulp", set: "training" }, { id: "ulp", set: "testing" }]);
});

test("a set of all-zero returns has a Sharpe ratio of 0, so a configuration trading in some blocks only is evaluated (103-3 review)", () => {
  // Configuration 3 trades only in blocks 0 and 3 of 4, and is zero elsewhere. Reference: Python, with 0 for an
  // all-zero set.
  const sparse = series(4, 80).map((c, j) => (j === 3 ? { id: c.id, returns: c.returns.map((v, k) => (k < 20 || k >= 60 ? v : 0)) } : c));
  const result = computeBacktestOverfitting({ configurations: sparse, blocks: 4 });
  checkAgainst(result, {
    splits: 6, pbo: 0.8333333333333334, logit_mean: -0.9241962407465937, q05: -1.3862943611198906, q25: -1.3862943611198906, median: -1.3862943611198906,
    q75: -0.6506724213610958, q95: 0.2027325540540822, lmin: -1.3862943611198906, lmax: 0.4054651081081642, omega_mean: 0.3,
    tr_mean: 0.15018307644753753, tr_med: 0.1392037534363785, te_mean: -0.07686238859944054, te_med: -0.07791577481603684, ploss: 0.6666666666666666,
    slope: 0.010346789321803402, intercept: -0.0784163012511435, r2: 6.604432973705245e-05, freq: [[1, 3], [2, 2], [3, 1]], block_sizes: [20, 20],
  }, "v6");
  assert.deepEqual(result.warnings, ["few_configurations", "few_splits", "zero_return_sets"]);
  // A configuration that never trades has a Sharpe ratio of 0 everywhere, and is evaluated too.
  const idle = computeBacktestOverfitting({ configurations: [...series(3, 40), { id: "idle", returns: Array(40).fill(0) }], blocks: 2 });
  assert.equal(idle.status, "evaluated");
  assert.ok(idle.warnings.includes("zero_return_sets"));
  assert.equal(computeBacktestOverfitting({ configurations: series(3, 40), blocks: 2 }).warnings.includes("zero_return_sets"), false);
});

test("each block keeps its own scale, so a block far smaller than the rest of its series is not lost to underflow (103-3 review 2)", () => {
  // Normalised by the whole series (largest 2), the first half's squared deviations are about 1e-401 and underflow to
  // 0; it would be judged constant. In its own units it is [0.5, 1], with a Sharpe ratio of 3/sqrt(2) like [1, 2].
  const tiny = computeBacktestOverfitting({ configurations: [{ id: "A", returns: [1e-200, 2e-200, 1, 2] }, { id: "B", returns: [1, 3, 2, 5] }], blocks: 2 });
  assert.equal(tiny.status, "evaluated");
  assert.equal(tiny.pbo, 0);
  close(tiny.selected.training_sharpe_mean, 3 / Math.SQRT2, 1e-15, "tiny training");
  close(tiny.selected.testing_sharpe_mean, 3 / Math.SQRT2, 1e-15, "tiny testing");
  // A constant block beside it is named alone: the varying tiny block is not mistaken for a constant one.
  const halfConstant = computeBacktestOverfitting({ configurations: [{ id: "A", returns: [1e-200, 2e-200, 1, 1] }, { id: "B", returns: [1, 3, 2, 5] }], blocks: 2 });
  assert.equal(halfConstant.status, "not_evaluable");
  assert.deepEqual(halfConstant.constant_configurations, [{ id: "A", set: "testing" }]);
  // Blocks 0 and 2 of configuration 3 are 1e-200 times the rest: sets of tiny blocks only and mixed sets both match
  // the reference, which divides each set by its own largest magnitude.
  const mixed = series(4, 80).map((c, j) => (j === 3 ? { id: c.id, returns: c.returns.map((v, k) => (k < 20 || (k >= 40 && k < 60) ? v * 1e-200 : v)) } : c));
  checkAgainst(computeBacktestOverfitting({ configurations: mixed, blocks: 4 }), {
    splits: 6, pbo: 0.8333333333333334, logit_mean: -0.7607246985779726, q05: -1.3862943611198906, q25: -1.3862943611198906, median: -0.8958797346140275,
    q75: -0.4054651081081643, q95: 0.2027325540540822, lmin: -1.3862943611198906, lmax: 0.4054651081081642, omega_mean: 0.3333333333333333,
    tr_mean: 0.1452687714181829, tr_med: 0.13920375343637853, te_mean: -0.04238262821458991, te_med: -0.05319027063321005, ploss: 0.6666666666666666,
    slope: -0.5114624654174847, intercept: 0.031916895763122954, r2: 0.5990543877064922, freq: [[1, 3], [2, 2], [0, 1]], block_sizes: [20, 20],
  }, "v7");
  // A always leads (B's Sharpe ratio is 0 on every set), and its sets mix tiny and ordinary blocks in every order. Its
  // Sharpe ratios match a direct computation on each set divided by its largest magnitude.
  const direct = (values) => {
    const top = Math.max(...values.map(Math.abs)); const x = values.map((v) => v / top);
    const mean = x.reduce((sum, v) => sum + v, 0) / x.length;
    return mean / Math.sqrt(x.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (x.length - 1));
  };
  const lead = [1e-200, 2e-200, 1, 2, 1e-200, 2e-200, 1, 2];
  const order = computeBacktestOverfitting({ configurations: [{ id: "A", returns: lead }, { id: "B", returns: [1, -1, 2, -2, 1, -1, 2, -2].map((v) => v / 100) }], blocks: 4 });
  const sets = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  const on = (blocks) => direct(blocks.flatMap((b) => lead.slice(2 * b, 2 * b + 2)));
  assert.deepEqual(order.selection_frequency.map((item) => [item.id, item.count]), [["A", 6]]);
  close(order.selected.training_sharpe_mean, sets.reduce((sum, set) => sum + on(set), 0) / 6, 1e-12, "mixed-order training");
  close(order.selected.testing_sharpe_mean, sets.reduce((sum, set) => sum + on([0, 1, 2, 3].filter((b) => !set.includes(b))), 0) / 6, 1e-12, "mixed-order testing");
  // Constancy is decided on the raw range alone: a range of 3e-12 of the largest magnitude varies (with an implausible
  // Sharpe ratio), while 5e-13 is rounding level.
  const varying = Array.from({ length: 20 }, (_, k) => ((k % 4) - 1.5) / 1000);
  const nearly = (relative) => [...Array.from({ length: 20 }, (_, k) => (k === 7 ? 0.01 * (1 + relative) : 0.01)), ...varying];
  const above = computeBacktestOverfitting({ configurations: [...series(3, 40), { id: "nearly", returns: nearly(3e-12) }], blocks: 2 });
  assert.equal(above.status, "evaluated");
  assert.ok(above.warnings.includes("extreme_sharpe"));
  const below = computeBacktestOverfitting({ configurations: [...series(3, 40), { id: "nearly", returns: nearly(5e-13) }], blocks: 2 });
  assert.deepEqual(below.constant_configurations, [{ id: "nearly", set: "training" }]);
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
    [{ configurations: [ok[0], , ok[1]] }, /configuration 1 must be an object/],
    [{ configurations: [...ok, { id: 5, returns: ok[0].returns }] }, /configuration 3 needs an id of 1 to 80 characters/],
    [{ configurations: [...ok, { id: "text", returns: "0.1,0.2" }] }, /configuration "text" returns must be an array of finite numbers/],
    [{ configurations: [...ok, { id: "holey", returns: (() => { const r = [...ok[0].returns]; delete r[5]; return r; })() }] }, /configuration "holey" returns must be finite numbers .*\(period 5\)/],
    [{ configurations: ok, blocks: 0 }, /blocks must be an even integer from 2 to 16/],
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
  // Exactly 500,000 returns are accepted.
  assert.equal(computeBacktestOverfitting({ configurations: series(2, 250_000), blocks: 2 }).status, "evaluated");
});

test("ties choose the earliest configuration, ranks average ties, and a median rank counts half towards PBO (103-3)", () => {
  // Two identical configurations tie everywhere: the earlier one is always selected, and its testing rank averages
  // the tie. Reference: Python, same data; one split lands exactly at the median.
  const base = series(3, 40);
  const twins = [base[0], { id: "twin", returns: base[0].returns }, base[1], base[2]];
  const result = computeBacktestOverfitting({ configurations: twins, blocks: 4 });
  checkAgainst(result, {
    splits: 6, pbo: 0.5833333333333334, pbo_inclusive: 0.6666666666666666, at_median: 1, logit_mean: -0.23104906018664836, q05: -1.3862943611198906,
    q25: -1.3862943611198906, median: -0.6931471805599453, q75: 1.039720770839918, q95: 1.3862943611198908, lmin: -1.3862943611198906,
    lmax: 1.3862943611198908, omega_mean: 0.45, tr_mean: 0.2554081102667953, tr_med: 0.15923573656504017, te_mean: -0.17342007402677084,
    te_med: -0.059419797772955196, ploss: 0.6666666666666666, slope: -0.9747262524163112, intercept: 0.07553291613031449, r2: 0.4243383859493905,
    // Python's indices 2, 0 and 3 are c1, c0 and c2 here, after the twin.
    freq: [[1, 4], [0, 1], [2, 1]], block_sizes: [10, 10],
  }, "v5");
  assert.equal(result.selection_frequency.some((item) => item.id === "twin"), false);
  // With three configurations, one that is always second out of sample has rank 2 of 3, a relative rank of 0.5 and a
  // logit of 0: half towards PBO, and wholly towards pbo_inclusive.
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
  // Training on the first half selects "middle", second of three out of sample (logit 0); training on the second half
  // selects "lead", last out of sample.
  assert.deepEqual([median.pbo, median.pbo_inclusive, median.splits_at_median], [0.75, 1, 1]);
  close(median.logit.max, 0, 0, "the median rank's logit");
  assert.equal(median.selected.probability_oos_loss, 0.5);
  // Selected in exactly half the splits is not dominant.
  assert.deepEqual(median.warnings, ["few_configurations", "few_splits"]);
});

test("Sharpe ratios are compared after rounding, so a tie or a zero split by rounding is still one (103-3 review)", () => {
  // A and B hold the same values on the first half, in reverse order: their training Sharpe ratios are equal, but
  // B's computes larger in the last bit. Rounded, they tie and the earlier, A, is selected.
  const h = [-0.00422266, 0.00246329, -0.00137511, 0.00432011, 0.00045351, 0.00133043, 0.00533488, -0.00160486, -0.00313616, 0.00303854,
    0.00132097, -0.00361719, -0.00016021, 0.00385129, 0.00332069, 0.00179923, 0.00162866, -0.00154785, -0.00004796, 0.0045193];
  const tail = [-0.00302825, 0.00459465, 0.0046813, 0.00447527, 0.0010041, 0.00095961, -0.00402344, -0.00306195, 0.00276448, -0.00295922,
    0.0049194, 0.00156098, 0.00263359, 0.00361514, 0.00144884, 0.00489735, 0.00198177, 0.00207877, 0.00076193, -0.00124564];
  const c = [0.00401611, 0.00052104, 0.00118402, -0.00181918, 0.00405887, 0.0040689, -0.00344698, -0.00349319, -0.00103825, -0.00057044,
    -0.0047553, 0.00042636, 0.00128093, 0.00392733, 0.00389164, 0.00294319, 0.00397832, -0.00304332, 0.00158064, 0.00135282,
    -0.00077058, -0.00465217, 0.00220592, -0.00171226, -0.00066659, -0.00236477, 0.00006979, -0.00182108, -0.00283008, 0.00381715,
    -0.00401414, -0.0046368, 0.00177132, -0.00206824, -0.00036519, -0.00067973, 0.00178336, 0.00079759, -0.00310697, 0.0026933];
  const tie = computeBacktestOverfitting({ configurations: [{ id: "A", returns: [...h, ...tail] }, { id: "B", returns: [...[...h].reverse(), ...tail.map((v) => -v)] }, { id: "C", returns: c }], blocks: 2 });
  assert.deepEqual(tie.selection_frequency.map((item) => [item.id, item.count]), [["A", 2]]);
  // Z leads on the first half; its second half has a mean of exactly 0 that computes as about -4.7e-17. Rounded, it
  // is 0: not an out-of-sample loss.
  const zero = Array.from({ length: 20 }, (_, k) => (k < 18 ? [0.3, -0.1, -0.2][k % 3] : k === 18 ? 0.05 : -0.05));
  const strong = Array.from({ length: 20 }, (_, k) => (k % 2 === 0 ? 0.3 : -0.1));
  const weak = (step) => Array.from({ length: 40 }, (_, k) => (((k * step) % 7) - 3) / 10);
  const loss = computeBacktestOverfitting({ configurations: [{ id: "Z", returns: [...strong, ...zero] }, { id: "n1", returns: weak(3) }, { id: "n2", returns: weak(5) }], blocks: 2 });
  assert.deepEqual(loss.selection_frequency.map((item) => [item.id, item.count]), [["Z", 1], ["n1", 1]]);
  assert.equal(loss.selected.probability_oos_loss, 0.5, "only the split that selects n1 loses");
});

test("the degradation line reports why it is undefined, and implausible Sharpe ratios are flagged (103-3 review)", () => {
  // p leads on the first half, q on the second, and each scores the same out of sample: the selections' testing
  // Sharpe ratios do not vary, so R² is undefined. Powers of two keep the shared half exact under normalisation.
  const pair = (a, b) => Array.from({ length: 40 }, (_, k) => ((k < 20 ? a : b) * (k % 2 === 0 ? 1 : 0) + (k % 2 === 0 ? 0 : -0.25)));
  const flatY = computeBacktestOverfitting({ configurations: [{ id: "p", returns: pair(1, 0.5) }, { id: "q", returns: pair(0.5, 2) }], blocks: 2 });
  assert.equal(flatY.degradation.r_squared, null);
  assert.equal(flatY.degradation.r_squared_reason, "the selections' testing Sharpe ratios do not vary");
  assert.ok(Number.isFinite(flatY.degradation.slope));
  // r leads on both halves, which are identical: the training Sharpe ratios do not vary, so no line is fitted.
  const half = Array.from({ length: 20 }, (_, k) => (k % 2 === 0 ? 0.03 : -0.01));
  const flatX = computeBacktestOverfitting({ configurations: [{ id: "r", returns: [...half, ...half] }, ...series(2, 40)], blocks: 2 });
  assert.deepEqual(flatX.degradation, { slope: null, intercept: null, r_squared: null, reason: "the selections' training Sharpe ratios do not vary" });
  assert.equal("r_squared_reason" in computeBacktestOverfitting({ configurations: series(5, 80), blocks: 4 }).degradation, false);
  // Returns of 0.01 with a jitter of 1e-6 have a per-period Sharpe ratio in the thousands.
  const jitter = Array.from({ length: 40 }, (_, k) => 0.01 + (k % 2 === 0 ? 1e-6 : -1e-6) * ((k % 3) + 1));
  const extreme = computeBacktestOverfitting({ configurations: [...series(3, 40), { id: "jitter", returns: jitter }], blocks: 2 });
  assert.equal(extreme.status, "evaluated");
  assert.ok(extreme.warnings.includes("extreme_sharpe"));
  assert.equal(computeBacktestOverfitting({ configurations: series(3, 40), blocks: 2 }).warnings.includes("extreme_sharpe"), false);
});
