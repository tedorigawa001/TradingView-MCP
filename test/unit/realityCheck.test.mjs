// BACKLOG 103-8: White's Reality Check and Hansen's SPA test by the stationary bootstrap. Reference values come from an
// independent Python standard-library implementation that sums every bootstrap mean directly over the resampled
// indices (no prefix sums) and computes ω̂² from Hansen's non-circular autocovariances with κ(n, i), in O(n²).
import test from "node:test";
import assert from "node:assert/strict";
import { computeRealityCheck, stationaryBootstrapVariance } from "../../build/realityCheck.js";

const close = (actual, expected, relative = 1e-12, label = "") =>
  assert.ok(Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);

// Returns from an integer LCG, so Python and JavaScript see the same numbers.
const series = (count, length, drift = () => 0, seed = 1) => {
  let state = seed;
  return Array.from({ length: count }, (_, j) => ({
    id: `c${j}`,
    returns: Array.from({ length }, () => { state = (state * 48271) % 2147483647; return ((state % 2001) - 1000) / 100000 + drift(j); }),
  }));
};

const checkAgainst = (result, ref, label) => {
  assert.equal(result.status, "evaluated", label);
  close(result.reality_check.statistic, ref.V, 1e-12, `${label} V`);
  close(result.spa.statistic, ref.T, 1e-12, `${label} T`);
  close(result.spa.threshold, ref.threshold, 1e-15, `${label} threshold`);
  assert.equal(result.best.id, ref.best, `${label} best`);
  assert.equal(result.reality_check.best.id, ref.best_mean, `${label} best mean`);
  close(result.best.t, ref.t, 1e-12, `${label} t`);
  close(result.best.mean_difference, ref.mean, 1e-12, `${label} mean`);
  close(result.best.standard_error, ref.se, 1e-12, `${label} se`);
  assert.equal(result.spa.recentred_configurations, ref.recentred, `${label} recentred`);
  assert.equal(result.positive_mean_configurations, ref.positive, `${label} positive`);
  assert.deepEqual(
    [result.reality_check.p_value, result.spa.p_values.lower, result.spa.p_values.consistent, result.spa.p_values.upper, result.best.nominal_p_value],
    [ref.p.rc, ref.p.lower, ref.p.consistent, ref.p.upper, ref.p.nominal], `${label} p-values`);
  assert.deepEqual(result.top_by_t.map((item) => item.id), ref.top.map((item) => item[0]), `${label} top ids`);
  result.top_by_t.forEach((item, index) => { close(item.mean_difference, ref.top[index][1], 1e-12, `${label} top mean`); close(item.t, ref.top[index][2], 1e-12, `${label} top t`); });
};

test("the Reality Check and SPA p-values match the reference, and adjust the best configuration's nominal p-value for the search (103-8)", () => {
  // One configuration with a drift among eight; benchmark zero.
  const r1 = computeRealityCheck({ configurations: series(8, 120, (j) => (j === 5 ? 0.0015 : 0)), mean_block: 4, draws: 500, seed: 11 });
  checkAgainst(r1, {
    V: 0.020586152323831666, T: 3.1841078791185424, threshold: 1.769749490611602, best: "c5", best_mean: "c5", t: 3.1841078791185424, mean: 0.0018792499999999998,
    se: 0.0005901967117145016, recentred: 0, positive: 6,
    p: { rc: 0.005988023952095809, lower: 0.007984031936127744, consistent: 0.00998003992015968, upper: 0.00998003992015968, nominal: 0.001996007984031936 },
    top: [["c5", 0.0018792499999999998, 3.1841078791185424], ["c3", 0.0009957499999999999, 1.7553205558243068], ["c4", 0.0005774166666666666, 0.9932044580271687],
      ["c1", 0.00035991666666666664, 0.8046634860503485], ["c6", 0.00033716666666666666, 0.6249373055893072], ["c0", 0.00017233333333333337, 0.29682871748378414],
      ["c7", -0.000388, -0.8186255175377304], ["c2", -0.0007051666666666667, -1.5874105629068482]],
  }, "r1");
  assert.deepEqual(r1.bootstrap, { method: "stationary", draws: 500, mean_block: 4, mean_block_source: "given", seed: 11 });
  assert.equal(r1.benchmark, "zero");

  // Against a benchmark, with three configurations far below it: the consistent p-value recentres them, and lies
  // between the lower and upper ones. A fractional mean block is allowed.
  const bench = Array.from({ length: 150 }, (_, k) => (((k * 37) % 23) - 11) / 20000);
  const offsets = [-0.004, 0.0004, -0.003, 0, 0.0002, -0.005];
  const r2Configurations = series(6, 150, (j) => offsets[j], 5).map((c) => ({ id: c.id, returns: c.returns.map((v, t) => v + bench[t]) }));
  const r2 = computeRealityCheck({ configurations: r2Configurations, benchmark: bench, mean_block: 2.5, draws: 400, seed: 3 });
  checkAgainst(r2, {
    V: 0.011283982748421175, T: 1.7943599918531383, threshold: 1.7953064987720095, best: "c4", best_mean: "c4", t: 1.7943599918531383, mean: 0.0009213333333333335,
    se: 0.0005134606976952377, recentred: 3, positive: 1,
    p: { rc: 0.11970074812967581, lower: 0.05486284289276808, consistent: 0.08977556109725686, upper: 0.18204488778054864, nominal: 0.0399002493765586 },
    top: [["c4", 0.0009213333333333335, 1.7943599918531383], ["c1", -4.380000000000003e-05, -0.09830454656903415], ["c3", -0.0004834666666666667, -0.9982312091469987],
      ["c2", -0.0027134666666666666, -6.013642574360548], ["c0", -0.0031136000000000002, -7.184089472475368], ["c5", -0.0050628, -9.942851847458039]],
  }, "r2");
  assert.equal(r2.benchmark, "given");
  // Each Monte Carlo error belongs to its own p-value: the Reality Check's, and SPA's consistent one.
  close(r2.reality_check.monte_carlo_error, Math.sqrt(r2.reality_check.p_value * (1 - r2.reality_check.p_value) / 400), 1e-15, "RC Monte Carlo error");
  close(r2.spa.monte_carlo_error, Math.sqrt(r2.spa.p_values.consistent * (1 - r2.spa.p_values.consistent) / 400), 1e-15, "SPA Monte Carlo error");

  // Thirty configurations with no skill, an i.i.d. bootstrap (mean block 1) and the default seed: the best looks
  // significant alone (nominal p 0.003), not after the search is accounted for (0.086 and 0.103).
  const r3 = computeRealityCheck({ configurations: series(30, 60, () => 0, 9), mean_block: 1, draws: 300 });
  checkAgainst(r3, {
    V: 0.01586632177496305, T: 2.763338036886196, threshold: 1.6790513073929292, best: "c3", best_mean: "c3", t: 2.763338036886196, mean: 0.0020483333333333334,
    se: 0.0007412532618128221, recentred: 1, positive: 19,
    p: { rc: 0.10299003322259136, lower: 0.06312292358803986, consistent: 0.08637873754152824, upper: 0.08970099667774087, nominal: 0.0033222591362126247 },
    top: [["c3", 0.0020483333333333334, 2.763338036886196], ["c9", 0.0010123333333333332, 1.5758499307458582], ["c0", 0.001013, 1.2969428839121475],
      ["c18", 0.0009013333333333333, 1.2272180752496311], ["c2", 0.000832, 1.1846419792889953], ["c25", 0.0007936666666666667, 1.0053471179567843],
      ["c5", 0.0006135, 0.8313094273082766], ["c27", 0.0004971666666666667, 0.6528913337547286], ["c23", 0.00045899999999999994, 0.6344409409211023],
      ["c26", 0.0004748333333333333, 0.6143788362494892]],
  }, "r3");
  assert.equal(r3.bootstrap.seed, 20261011);

  // A mean block of half the periods: runs wrap around the end often.
  const r4 = computeRealityCheck({ configurations: series(3, 40, (j) => 0.001 * j, 17), mean_block: 20, draws: 300, seed: 5 });
  checkAgainst(r4, {
    V: 0.012840428439113705, T: 3.0454171491774176, threshold: 1.6157492014314825, best: "c2", best_mean: "c2", t: 3.0454171491774176, mean: 0.00203025,
    se: 0.0006666574398677635, recentred: 1, positive: 2,
    p: { rc: 0.006644518272425249, lower: 0.0033222591362126247, consistent: 0.0033222591362126247, upper: 0.006644518272425249, nominal: 0.0033222591362126247 },
    top: [["c2", 0.00203025, 3.0454171491774176], ["c1", 0.0015799999999999998, 2.2204830666923403], ["c0", -0.0010525, -1.646515257412362]],
  }, "r4");
  assert.deepEqual(r4.warnings, ["short_sample", "few_draws", "long_mean_block"]);

  // Every configuration below a zero benchmark, none identical: V < 0, SPA's T is 0 (p = 1), and the Reality Check's
  // p-value is below 1, because no identical configuration puts a 0 in its maximum.
  const r5 = computeRealityCheck({ configurations: series(3, 80, (j) => -0.001 * (j + 1), 21), mean_block: 3, draws: 500, seed: 2 });
  checkAgainst(r5, {
    V: -0.003821440173547141, T: 0, threshold: 1.7190179285598743, best: "c0", best_mean: "c0", t: -0.6812163173817851, mean: -0.00042725,
    se: 0.000627186972916489, recentred: 2, positive: 0,
    p: { rc: 0.9900199600798403, lower: 1, consistent: 1, upper: 1, nominal: 0.7604790419161677 },
    top: [["c0", -0.00042725, -0.6812163173817851], ["c1", -0.0020647499999999997, -3.5750364672362838], ["c2", -0.002906125, -4.619407190923537]],
  }, "r5");

  // One configuration with t > 0: the search is trivial, so all five p-values coincide.
  const r6 = computeRealityCheck({ configurations: series(1, 200, () => 0.0006, 4), mean_block: 4, draws: 500, seed: 9 });
  checkAgainst(r6, {
    V: 0.009726960882002146, T: 1.9833802163933663, threshold: 1.8261376137309364, best: "c0", best_mean: "c0", t: 1.9833802163933663, mean: 0.0006877999999999999,
    se: 0.00034678171856060685, recentred: 0, positive: 1,
    p: { rc: 0.041916167664670656, lower: 0.041916167664670656, consistent: 0.041916167664670656, upper: 0.041916167664670656, nominal: 0.041916167664670656 },
    top: [["c0", 0.0006877999999999999, 1.9833802163933663]],
  }, "r6");
});

test("the bootstrap variance's O(n) recursion equals Hansen's ω̂² and, with a mean block of 1, the population variance (103-8)", () => {
  // Hansen (2005): γ̂_0 + 2 Σ κ(n, i) γ̂_i, with non-circular γ̂_i (divisor n), directly in O(n²).
  const hansen = (c, block) => {
    const n = c.length; const rho = 1 - 1 / block; let total = 0;
    for (let i = 0; i < n; i += 1) {
      let gamma = 0;
      for (let j = 0; j + i < n; j += 1) gamma += c[j] * c[j + i];
      gamma /= n;
      total += i === 0 ? gamma : 2 * (((n - i) / n) * rho ** i + (i / n) * rho ** (n - i)) * gamma;
    }
    return total;
  };
  for (const [n, block] of [[2, 1], [3, 1.5], [5, 2], [12, 3], [50, 7.5], [200, 20], [301, 150.5]]) {
    const raw = Array.from({ length: n }, (_, t) => Math.sin(t * 1.7) + 0.3 * Math.cos(t / 3));
    const mean = raw.reduce((sum, v) => sum + v, 0) / n; const c = raw.map((v) => v - mean);
    close(stationaryBootstrapVariance(c, block), hansen(c, block), 1e-13, `n ${n} block ${block}`);
  }
  const c = [1, -2, 0.5, 0.5];
  close(stationaryBootstrapVariance(c, 1), c.reduce((sum, v) => sum + v * v, 0) / 4, 1e-15, "i.i.d.");
});

test("proportional inputs give the same tests at any finite scale (103-8)", () => {
  const base = series(5, 80, (j) => (j === 2 ? 0.002 : 0), 4);
  const bench = Array.from({ length: 80 }, (_, k) => ((k % 7) - 3) / 10000);
  const reference = computeRealityCheck({ configurations: base, benchmark: bench, mean_block: 3, draws: 200, seed: 1 });
  for (const scale of [1e-300, 1e-100, 1e100, 1e299]) {
    const scaled = computeRealityCheck({ configurations: base.map((c) => ({ id: c.id, returns: c.returns.map((v) => v * scale) })), benchmark: bench.map((v) => v * scale), mean_block: 3, draws: 200, seed: 1 });
    assert.deepEqual(scaled.spa.p_values, reference.spa.p_values, `SPA at ${scale}`);
    assert.equal(scaled.reality_check.p_value, reference.reality_check.p_value, `RC at ${scale}`);
    close(scaled.best.t, reference.best.t, 1e-12, `t at ${scale}`);
    close(scaled.best.mean_difference / scale, reference.best.mean_difference, 1e-12, `mean at ${scale}`);
  }
});

test("a configuration identical to the benchmark contributes 0, a constant difference is not evaluable (103-8)", () => {
  const bench = series(1, 60, () => 0, 8)[0].returns;
  const poor = series(2, 60, () => -0.003, 6);
  // Every other configuration is below the benchmark: the Reality Check's best is the identical one (mean 0); SPA's
  // best is the best of those that differ, and its statistic is the maximum with 0.
  const withTwin = computeRealityCheck({ configurations: [...poor, { id: "twin", returns: [...bench] }], benchmark: bench, mean_block: 2, draws: 200 });
  assert.equal(withTwin.status, "evaluated");
  assert.equal(withTwin.identical_to_benchmark, 1);
  assert.ok(withTwin.warnings.includes("identical_to_benchmark"));
  assert.equal(withTwin.reality_check.best.id, "twin");
  assert.deepEqual([withTwin.reality_check.statistic, withTwin.spa.statistic], [0, 0]);
  assert.notEqual(withTwin.best.id, "twin");
  assert.ok(withTwin.best.t < 0);
  assert.equal(withTwin.top_by_t.some((item) => item.id === "twin"), false);
  // With a statistic of 0 every draw reaches it: p = 1.
  assert.deepEqual(withTwin.spa.p_values, { lower: 1, consistent: 1, upper: 1 });
  assert.equal(withTwin.reality_check.p_value, 1);
  // Differences at rounding level are identical too.
  const rounding = computeRealityCheck({ configurations: [...poor, { id: "near", returns: bench.map((v) => v * (1 + 2 ** -50)) }], benchmark: bench, mean_block: 2, draws: 200 });
  assert.equal(rounding.identical_to_benchmark, 1);
  // A configuration that never trades is identical to a zero benchmark.
  assert.equal(computeRealityCheck({ configurations: [...poor, { id: "idle", returns: Array(60).fill(0) }], mean_block: 2, draws: 200 }).identical_to_benchmark, 1);
  // A constant difference has no standard error. A benchmark plus a small constant varies by the benchmark's rounding,
  // which is large beside the constant (about 1e-12 of 1e-6 here), so the variation is judged against the returns'
  // magnitude too; judged against the difference alone, the configuration below had a t of about 1e13.
  const carry = computeRealityCheck({ configurations: [...poor, { id: "carry", returns: bench.map((v) => v + 0.001) }, { id: "carry2", returns: bench.map((v) => v - 0.002) }, { id: "tiny", returns: bench.map((v) => v + 1e-6) }, { id: "tiny2", returns: bench.map((v) => v - 1e-6) }], benchmark: bench, mean_block: 2, draws: 200 });
  assert.equal(carry.status, "not_evaluable");
  assert.deepEqual(carry.constant_configurations, ["carry", "carry2", "tiny", "tiny2"]);
  assert.match(carry.reason, /differ from the benchmark by a constant .*"carry", "carry2", "tiny", "tiny2"/);
  assert.equal("spa" in carry, false);
  assert.equal(carry.benchmark, "given");
  // A configuration whose mean difference is exactly 0 differs from the benchmark but is not counted as positive.
  const flat = computeRealityCheck({ configurations: [...poor, { id: "flat", returns: Array.from({ length: 60 }, (_, t) => (t % 2 === 0 ? 0.01 : -0.01)) }], mean_block: 2, draws: 200 });
  assert.deepEqual([flat.best.id, flat.best.mean_difference, flat.positive_mean_configurations, flat.identical_to_benchmark], ["flat", 0, 0, 0]);
  // The rounding share is 1e-9 of the configuration's largest return. Proportional differences of 5e-10 are identical
  // to the benchmark; of 2e-9 they are real but nearly constant, and named.
  const share = (relative) => bench.map((v) => v * (1 + relative));
  const sharing = computeRealityCheck({ configurations: [...poor, { id: "half", returns: share(5e-10) }, { id: "double", returns: share(2e-9) }], benchmark: bench, mean_block: 2, draws: 200 });
  assert.equal(sharing.identical_to_benchmark, 1);
  assert.deepEqual(sharing.nearly_constant_configurations, ["double"]);
  assert.ok(sharing.warnings.includes("nearly_constant_difference"));
  // A constant plus variation of about 4.5e-10 of the returns is constant; 4.5e-9 is nearly constant; 4.5e-7 is still
  // nearly constant; 4.5e-6 is not.
  const wobble = (step) => bench.map((v, t) => v + 0.001 + (t % 2 === 0 ? step : 0));
  assert.deepEqual(computeRealityCheck({ configurations: [...poor, { id: "w", returns: wobble(5e-12) }], benchmark: bench, mean_block: 2, draws: 200 }).constant_configurations, ["w"]);
  const wobbles = computeRealityCheck({ configurations: [...poor, { id: "w1", returns: wobble(5e-11) }, { id: "w2", returns: wobble(5e-9) }, { id: "w3", returns: wobble(5e-8) }], benchmark: bench, mean_block: 2, draws: 200 });
  assert.equal(wobbles.status, "evaluated");
  assert.deepEqual(wobbles.nearly_constant_configurations, ["w1", "w2"]);
  assert.deepEqual(computeRealityCheck({ configurations: poor, benchmark: bench, mean_block: 2, draws: 200 }).nearly_constant_configurations, []);
  assert.equal(computeRealityCheck({ configurations: poor, benchmark: bench, mean_block: 2, draws: 200 }).warnings.includes("nearly_constant_difference"), false);
  // The same strategy's returns computed by two formulas from 5-decimal prices differ by rounding of about 1e-16 of the
  // price ratio: about 1e-11 of returns of 1e-5. They are identical, and the poorer configuration is the best.
  let state = 13; const uniform = () => { state = (state * 48271) % 2147483647; return state / 2147483647 * 2 - 1; };
  const prices = [1.1];
  for (let t = 1; t <= 5000; t += 1) prices.push(Math.round(prices[t - 1] * (1 + 2e-5 * uniform()) * 1e5) / 1e5);
  const simple = prices.slice(1).map((p, t) => (p - prices[t]) / prices[t]);
  const ratio = prices.slice(1).map((p, t) => p / prices[t] - 1);
  const ratioScale = Math.max(...ratio.map(Math.abs)); const gap = Math.max(...ratio.map((v, t) => Math.abs(v - simple[t])));
  assert.ok(gap > 1e-12 * ratioScale && gap < 1e-9 * ratioScale, `the formulas differ by ${gap / ratioScale} of the returns`);
  const formulas = computeRealityCheck({ configurations: [{ id: "poorer", returns: simple.map((v, t) => v - 5e-6 + (t % 3) * 4e-6) }, { id: "same", returns: ratio }], benchmark: simple, mean_block: 5, draws: 200 });
  assert.deepEqual([formulas.identical_to_benchmark, formulas.best.id], [1, "poorer"]);
  // Duplicated configurations tie: the earliest is the best, and the top list keeps input order.
  const strong = series(1, 60, () => 0.004, 2)[0].returns;
  const duplicated = computeRealityCheck({ configurations: [{ id: "first", returns: strong }, ...poor, { id: "second", returns: [...strong] }, { id: "twin", returns: [...bench] }, { id: "twin2", returns: [...bench] }], benchmark: bench, mean_block: 2, draws: 200 });
  assert.deepEqual([duplicated.best.id, duplicated.reality_check.best.id], ["first", "first"]);
  assert.deepEqual(duplicated.top_by_t.slice(0, 2).map((item) => item.id), ["first", "second"]);
  assert.equal(duplicated.identical_to_benchmark, 2);
  // Among identical configurations alone at the top, the earliest is the Reality Check's best.
  assert.equal(computeRealityCheck({ configurations: [...poor, { id: "twin", returns: [...bench] }, { id: "twin2", returns: [...bench] }], benchmark: bench, mean_block: 2, draws: 200 }).reality_check.best.id, "twin");
  const allTwins = computeRealityCheck({ configurations: [{ id: "a", returns: [...bench] }, { id: "b", returns: [...bench] }], benchmark: bench });
  assert.equal(allTwins.status, "not_evaluable");
  assert.match(allTwins.reason, /every configuration is identical to the benchmark/);
});

test("the inputs are checked, and the defaults are stated (103-8)", () => {
  const ok = series(3, 40);
  const holey = (values, index) => { const copy = [...values]; delete copy[index]; return copy; };
  const cases = [
    [{ configurations: [] }, /configurations must hold 1 to 1000/],
    [{ configurations: "x" }, /configurations must hold 1 to 1000/],
    [{ configurations: Array.from({ length: 1001 }, (_, j) => ({ id: `x${j}`, returns: ok[0].returns })) }, /configurations must hold 1 to 1000/],
    [{ configurations: [...ok, { id: "c0", returns: ok[0].returns }] }, /id "c0" is not unique/],
    [{ configurations: [...ok, { id: "", returns: ok[0].returns }] }, /needs an id of 1 to 80 characters/],
    [{ configurations: [...ok, { id: 5, returns: ok[0].returns }] }, /configuration 3 needs an id/],
    [{ configurations: [...ok, { id: "x".repeat(81), returns: ok[0].returns }] }, /configuration 3 needs an id of 1 to 80 characters/],
    [{ configurations: [...ok, null] }, /configuration 3 must be an object/],
    [{ configurations: [ok[0], , ok[1]] }, /configuration 1 must be an object/],
    [{ configurations: [...ok, { id: "short", returns: ok[0].returns.slice(1) }] }, /has 39 returns; every configuration must have 40/],
    [{ configurations: [...ok, { id: "nan", returns: [...ok[0].returns.slice(1), NaN] }] }, /"nan" returns must be finite numbers .*\(period 39\)/],
    [{ configurations: [...ok, { id: "big", returns: [...ok[0].returns.slice(1), 1e301] }] }, /magnitude at most 1e\+300/],
    [{ configurations: [...ok, { id: "str", returns: [...ok[0].returns.slice(1), "0.1"] }] }, /"str" returns must be finite numbers/],
    [{ configurations: [...ok, { id: "holey", returns: holey(ok[0].returns, 4) }] }, /"holey" returns must be finite numbers .*\(period 4\)/],
    [{ configurations: [...ok, { id: "text", returns: "0.1" }] }, /"text" returns must be an array/],
    [{ configurations: series(2, 9) }, /must hold 10 to 100000 returns; got 9/],
    [{ configurations: series(1, 100_001) }, /must hold 10 to 100000 returns; got 100001/],
    [{ configurations: series(6, 100_000) }, /hold 600000 returns; at most 500000/],
    // The sizes are checked before any value is read.
    [{ configurations: [...series(5, 100_000), { id: "late", returns: [NaN, ...series(1, 99_999)[0].returns] }] }, /hold 600000 returns; at most 500000/],
    [{ configurations: ok, benchmark: [NaN] }, /benchmark has 1 returns; it must have 40/],
    [{ configurations: ok, benchmark: ok[0].returns.slice(1) }, /benchmark has 39 returns; it must have 40/],
    [{ configurations: ok, benchmark: holey(ok[0].returns, 0) }, /benchmark must be finite numbers .*\(period 0\)/],
    [{ configurations: ok, benchmark: "x" }, /benchmark must be an array/],
    [{ configurations: ok, mean_block: 0.99 }, /mean_block must be a number from 1 to half the periods \(20\)/],
    [{ configurations: ok, mean_block: 20.01 }, /mean_block must be a number from 1 to half the periods/],
    [{ configurations: ok, mean_block: "4" }, /mean_block must be a number/],
    [{ configurations: ok, mean_block: null }, /mean_block must be a number/],
    [{ configurations: ok, draws: 99 }, /draws must be an integer from 100 to 10000/],
    [{ configurations: ok, draws: 10_001 }, /draws must be an integer from 100 to 10000/],
    [{ configurations: ok, draws: 150.5 }, /draws must be an integer/],
    [{ configurations: ok, draws: "200" }, /draws must be an integer/],
    [{ configurations: ok, seed: -1 }, /seed must be an integer from 0 to 4294967295/],
    [{ configurations: ok, seed: 2 ** 32 }, /seed must be an integer/],
    [{ configurations: ok, seed: 1.5 }, /seed must be an integer/],
    [{ configurations: ok, seed: null }, /seed must be an integer/],
    // 1,001 draws × (80,000 periods / 1) × (20 + 5) = 2.002e9.
    [{ configurations: series(5, 80_000), mean_block: 1, draws: 1_001 }, /draws × \(periods \/ mean_block\) × \(20 \+ configurations\) is 2\.002e\+9; at most 2e\+9/],
  ];
  for (const [input, pattern] of cases) assert.throws(() => computeRealityCheck(input), pattern, JSON.stringify(Object.keys(input)));
  // Defaults: mean block round(n^(1/3)), 2,000 draws, a fixed seed. Bounds are accepted.
  const defaults = computeRealityCheck({ configurations: series(2, 1000) });
  assert.deepEqual(defaults.bootstrap, { method: "stationary", draws: 2000, mean_block: 10, mean_block_source: "default", seed: 20261011 });
  assert.equal(computeRealityCheck({ configurations: series(2, 10) }).bootstrap.mean_block, 2);
  // cbrt(20) = 2.71 rounds to 3.
  assert.equal(computeRealityCheck({ configurations: series(2, 20) }).bootstrap.mean_block, 3);
  // Magnitudes of exactly 1e300 are accepted.
  assert.equal(computeRealityCheck({ configurations: [...ok, { id: "edge", returns: [...ok[0].returns.slice(2), 1e300, -1e300] }], mean_block: 2, draws: 100 }).status, "evaluated");
  assert.equal(computeRealityCheck({ configurations: ok, benchmark: [...ok[0].returns.slice(1), 1e300], mean_block: 2, draws: 100 }).status, "evaluated");
  for (const extra of [{ mean_block: 1 }, { mean_block: 20 }, { draws: 100 }, { draws: 10_000, mean_block: 20 }, { seed: 0 }, { seed: 2 ** 32 - 1 }]) {
    assert.equal(computeRealityCheck({ configurations: ok, ...extra }).status, "evaluated", JSON.stringify(extra));
  }
  assert.equal(computeRealityCheck({ configurations: series(1, 40) }).configurations, 1);
  // Exactly 500,000 returns are accepted.
  assert.equal(computeRealityCheck({ configurations: series(5, 100_000), mean_block: 50, draws: 100 }).observations, 100_000);
  // Exactly the cap, 1,000 × 80,000 × 25 = 2e9, is accepted.
  assert.equal(computeRealityCheck({ configurations: series(5, 80_000), mean_block: 1, draws: 1_000 }).status, "evaluated");
});

test("warnings mark short samples, few draws, long blocks, and the same seed reproduces the result (103-8)", () => {
  const long = series(4, 400, () => 0, 3);
  const quiet = computeRealityCheck({ configurations: long, mean_block: 40, draws: 1000 });
  assert.deepEqual(quiet.warnings, []);
  assert.deepEqual(computeRealityCheck({ configurations: long, mean_block: 40.5, draws: 999 }).warnings, ["few_draws", "long_mean_block"]);
  assert.deepEqual(computeRealityCheck({ configurations: series(4, 99, () => 0, 3), mean_block: 2, draws: 1000 }).warnings, ["short_sample"]);
  assert.deepEqual(computeRealityCheck({ configurations: series(4, 100, () => 0, 3), mean_block: 2, draws: 1000 }).warnings, []);
  assert.deepEqual(computeRealityCheck({ configurations: long, mean_block: 40, draws: 1000 }), quiet);
  assert.notDeepEqual(computeRealityCheck({ configurations: long, mean_block: 40, draws: 1000, seed: 7 }).spa.p_values, quiet.spa.p_values);
  assert.equal(quiet.limitations.length, 6);
  close(quiet.spa.monte_carlo_error, Math.sqrt(quiet.spa.p_values.consistent * (1 - quiet.spa.p_values.consistent) / 1000), 1e-15, "Monte Carlo error");
});

test("mathematically tied configurations are ranked by input order, not by rounding (103-8 review)", () => {
  // A series and its reverse have the same mean and, with a mean block of 1, the same ω̂ (the population variance), but
  // their computed values can differ in the last bit. Rounded, they tie, and the earlier is the best in both tests.
  for (let seed = 1; seed <= 30; seed += 1) {
    const forward = series(1, 50, () => 0.0005, seed)[0].returns;
    const result = computeRealityCheck({ configurations: [{ id: "forward", returns: forward }, { id: "reverse", returns: [...forward].reverse() }], mean_block: 1, draws: 100 });
    assert.deepEqual([result.best.id, result.reality_check.best.id, result.top_by_t[0].id], ["forward", "forward", "forward"], `seed ${seed}`);
  }
});
