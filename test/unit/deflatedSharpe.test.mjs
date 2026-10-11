// BACKLOG 103-2: the deflated Sharpe ratio and the minimum backtest length. Reference values come from an independent
// implementation using only Python's standard library (statistics.NormalDist, plain loops).
import test from "node:test";
import assert from "node:assert/strict";
import { computeDeflatedSharpe, expectedMaxStandardNormal } from "../../build/deflatedSharpe.js";
import { normalQuantile } from "../../build/numerics.js";

const close = (actual, expected, relative = 1e-12, label = "") =>
  assert.ok(Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);

// 500 returns built from integers, so Python and JavaScript see the same numbers; every 50th day carries a jump.
const returnsA = Array.from({ length: 500 }, (_, t) => ((t * 7919) % 1000 - 480) / 100000 + (t % 50 === 0 ? 0.02 : 0));
const trialsA = Array.from({ length: 20 }, (_, k) => ((k * 37) % 17 - 6) / 400);

test("the normal quantile matches Python's statistics.NormalDist.inv_cdf (AS241)", () => {
  const reference = [[1e-300, -37.0470962993612], [1e-100, -21.27345356096532], [1e-20, -9.262340089798405], [1e-10, -6.361340902404056],
    [1e-5, -4.2648907939228256], [0.001, -3.090232306167813], [0.02425, -1.9729610513118845], [0.025, -1.9599639845400538],
    [0.1, -1.2815515655446008], [0.3, -0.5244005127080407], [0.425, -0.1891184262727925], [0.5, 0], [0.575, 0.18911842627279238],
    [0.6, 0.2533471031357998], [0.9, 1.2815515655446008], [0.975, 1.9599639845400536], [0.97575, 1.9729610513118847],
    [0.999, 3.090232306167813], [0.99999, 4.26489079392384], [0.9999999999, 6.361340889697421]];
  for (const [p, z] of reference) close(normalQuantile(p), z, 1e-14, `p=${p}`);
  assert.deepEqual([normalQuantile(0), normalQuantile(1)], [-Infinity, Infinity]);
  for (const p of [-0.1, 1.1, NaN]) assert.ok(Number.isNaN(normalQuantile(p)), String(p));
});

test("the deflated Sharpe ratio matches the reference from every trial's Sharpe ratio (103-2)", () => {
  const result = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: trialsA, periods_per_year: 252 });
  assert.equal(result.status, "evaluated");
  close(result.sharpe, 0.14409016554761872, 1e-12, "sharpe");
  close(result.skewness, 2.5996558555876894, 1e-12, "skewness");
  close(result.kurtosis, 14.859714261163639, 1e-12, "kurtosis");
  close(result.sharpe_standard_error, 0.03738318935820081, 1e-12, "se");
  close(result.psr_zero, 0.9999419956450937, 1e-12, "psr0");
  close(result.expected_max_sharpe, 0.02412491667565348, 1e-12, "sr0");
  close(result.deflated_sharpe, 0.999334173263047, 1e-12, "dsr");
  close(result.annualized_sharpe, 2.287360466454757, 1e-12, "annualized");
  close(result.trials.sharpe_variance, 0.00016110197368421052, 1e-12, "variance");
  assert.deepEqual([result.trials.count, result.trials.source, result.trials.max_sharpe], [20, "trial_sharpes", 0.025]);
  close(result.min_backtest_length.years, 3.612690715683428, 1e-12, "minbtl");
  close(result.min_backtest_length.upper_bound_years, 5.991464547107982, 1e-12, "upper bound");
  close(result.min_backtest_length.periods, 910.3980603522239, 1e-12, "periods");
  close(result.trials.mean_sharpe, 0.003125, 1e-12, "mean sharpe");
  close(result.trials.variance_to_sampling_variance, 0.11527845834245236, 1e-12, "variance ratio");
  assert.deepEqual([result.trials.listed, result.trials.duplicate_values, result.trials.nearest_trial_sharpe], [20, 3, 0.025]);
  // The selected Sharpe ratio is not among the trials here and is above their maximum; the trials vary far less than one
  // Sharpe ratio's sampling error, and 500 days are shorter than the minimum backtest length.
  assert.deepEqual([result.trials.selected_matches_a_trial, result.warnings],
    [false, ["trial_variance_far_below_sampling", "backtest_shorter_than_min_length", "selected_not_among_trials", "duplicate_trial_sharpes"]]);
  assert.equal(result.limitations.length, 5);
});

test("from a trial count and variance, and the paper's example: seven trials need about two years for a Sharpe of one", () => {
  const seven = computeDeflatedSharpe({ returns: returnsA, trial_count: 7, trial_sharpe_variance: 0.0004, periods_per_year: 252 });
  close(seven.expected_max_sharpe, 0.027735489227083205, 1e-12, "sr0");
  close(seven.deflated_sharpe, 0.9990724078531392, 1e-12, "dsr");
  close(seven.min_backtest_length.years, 1.923143406664121, 1e-12, "minbtl");
  close(seven.min_backtest_length.periods, 484.6321384793585, 1e-12, "periods");
  close(seven.min_backtest_length.upper_bound_years, 3.8918202981106265, 1e-12, "upper bound");
  assert.deepEqual([seven.trials.source, seven.warnings], ["summary", ["trial_count_from_summary"]]);
  close(expectedMaxStandardNormal(7) ** 2, 1.923143406664121, 1e-12, "max z");
  // Many trials with dispersed Sharpe ratios deflate the same result below one half.
  const many = computeDeflatedSharpe({ returns: returnsA, trial_count: 1000, trial_sharpe_variance: 0.0025, target_annual_sharpe: 0.5 });
  close(many.expected_max_sharpe, 0.16275607568263617, 1e-12, "sr0");
  close(many.deflated_sharpe, 0.3087794707344251, 1e-12, "dsr");
  close(many.min_backtest_length.years, 42.383264274579176, 1e-12, "minbtl");
  close(many.min_backtest_length.upper_bound_years, 55.262042231857095, 1e-12, "upper bound");
  assert.equal("periods" in many.min_backtest_length, false);
  assert.equal("annualized_sharpe" in many, false);
});

test("a selected Sharpe ratio among the trials is matched, short samples are flagged, and constant returns are not evaluable", () => {
  const distinct = [-0.02, -0.01, 0.0, 0.01, 0.02];
  const matched = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...distinct, 0.14409016554761872] });
  assert.equal(matched.trials.selected_matches_a_trial, true);
  assert.equal(matched.warnings.some((w) => w.startsWith("selected_")), false);
  // Rounded to eight decimals, or computed with the population standard deviation, the trial still matches (review L1).
  for (const near of [0.14409017, 0.1442344722092716]) {
    const rounded = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...distinct, near] });
    assert.deepEqual([rounded.trials.selected_matches_a_trial, rounded.warnings.filter((w) => w.startsWith("selected_"))], [true, []], String(near));
  }
  // Half a standard error away is another trial.
  const apart = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...distinct, 0.14409016554761872 + 0.0187] });
  assert.deepEqual([apart.trials.selected_matches_a_trial, apart.warnings.filter((w) => w.startsWith("selected_"))], [false, ["selected_not_among_trials", "selected_below_trial_max"]]);
  close(apart.trials.nearest_trial_distance, 0.0187, 1e-9, "distance");
  const below = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...distinct, 0.14409016554761872, 0.3] });
  assert.deepEqual(below.warnings.filter((w) => w.startsWith("selected_")), ["selected_below_trial_max"]);
  // A maximum below zero is found too.
  assert.equal(computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [-0.3, -0.2, -0.1] }).trials.max_sharpe, -0.1);
  const short = computeDeflatedSharpe({ returns: returnsA.slice(0, 29), trial_count: 5, trial_sharpe_variance: 0.01 });
  assert.ok(short.warnings.includes("short_sample"));
  assert.equal(computeDeflatedSharpe({ returns: returnsA.slice(0, 30), trial_count: 5, trial_sharpe_variance: 0.01 }).warnings.includes("short_sample"), false);
  const flat = computeDeflatedSharpe({ returns: [0.001, 0.001, 0.001], trial_count: 3, trial_sharpe_variance: 0.01 });
  assert.deepEqual([flat.status, flat.reason, "deflated_sharpe" in flat], ["not_evaluable", "returns have zero standard deviation", false]);
  // A hundred thousand trials, the limit, do not exhaust the call stack.
  const wide = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: Array.from({ length: 100_000 }, (_, k) => (k % 101 - 50) / 1000) });
  assert.deepEqual([wide.status, wide.trials.count, wide.trials.max_sharpe], ["evaluated", 100_000, 0.05]);
});

test("the inputs are checked (103-2)", () => {
  const cases = [
    [{ returns: returnsA }, /either trial_sharpes, or trial_count/],
    [{ returns: returnsA, trial_sharpes: trialsA, trial_count: 3, trial_sharpe_variance: 0.1 }, /either trial_sharpes, or trial_count/],
    [{ returns: returnsA, trial_count: 3 }, /must be given together/],
    [{ returns: returnsA, trial_sharpe_variance: 0.1 }, /must be given together/],
    [{ returns: returnsA, trial_count: 1, trial_sharpe_variance: 0.1 }, /trial_count must be an integer/],
    [{ returns: returnsA, trial_count: 2.5, trial_sharpe_variance: 0.1 }, /trial_count must be an integer/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: -0.1 }, /trial_sharpe_variance must be a non-negative/],
    [{ returns: [0.01], trial_count: 3, trial_sharpe_variance: 0.1 }, /returns must hold 2 to 100000 finite numbers/],
    [{ returns: [0.01, NaN], trial_count: 3, trial_sharpe_variance: 0.1 }, /returns must hold/],
    [{ returns: returnsA, trial_sharpes: [0.1] }, /trial_sharpes must hold 2 to/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: 0.1, periods_per_year: 0 }, /periods_per_year must be a positive/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: 0.1, target_annual_sharpe: -1 }, /target_annual_sharpe must be a positive/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: 0.1, target_annual_sharpe: 0 }, /target_annual_sharpe must be a positive/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: 0.1, target_annual_sharpe: NaN }, /target_annual_sharpe must be a positive/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: 0.1, target_annual_sharpe: Infinity }, /target_annual_sharpe must be a positive/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: 0.1, periods_per_year: Infinity }, /periods_per_year must be a positive/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: Infinity }, /trial_sharpe_variance must be a non-negative/],
    [{ returns: returnsA, trial_count: 1_000_000_001, trial_sharpe_variance: 0.1 }, /trial_count must be an integer from 2 to 1,000,000,000/],
    [{ returns: Array.from({ length: 100_001 }, (_, i) => i % 7), trial_count: 3, trial_sharpe_variance: 0.1 }, /returns must hold 2 to 100000/],
    [{ returns: returnsA, trial_sharpes: Array.from({ length: 100_001 }, (_, i) => i % 7) }, /trial_sharpes must hold 2 to 100000/],
    [{ returns: returnsA, trial_sharpes: trialsA, effective_trial_count: 1 }, /effective_trial_count must be an integer/],
    [{ returns: returnsA, trial_count: 3, trial_sharpe_variance: 0.1, effective_trial_count: 2 }, /effective_trial_count goes with trial_sharpes/],
  ];
  for (const [input, pattern] of cases) assert.throws(() => computeDeflatedSharpe(input), pattern, JSON.stringify(Object.keys(input)));
  assert.throws(() => expectedMaxStandardNormal(1), /at least 2/);
});

test("duplicated or correlated trials are flagged, and an effective count replaces the listed one (103-2 review)", () => {
  // The selected trial, a trial at 0 and 198 copies of a trial at 0.06: duplication shrinks the variance.
  const crowded = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [0.14409016554761872, 0, ...Array(198).fill(0.06)] });
  assert.ok(crowded.warnings.includes("duplicate_trial_sharpes"));
  assert.ok(crowded.warnings.includes("trial_variance_far_below_sampling"));
  assert.equal(crowded.trials.duplicate_values, 197);
  // Three effectively independent ideas: the effective count replaces the listed 200 in SR0.
  const effective = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [0.14409016554761872, 0, ...Array(198).fill(0.06)], effective_trial_count: 3 });
  assert.deepEqual([effective.trials.count, effective.trials.listed, effective.trials.count_source], [3, 200, "effective_trial_count"]);
  close(effective.expected_max_sharpe, Math.sqrt(effective.trials.sharpe_variance) * expectedMaxStandardNormal(3), 1e-12, "sr0");
  // A variance of zero switches deflation off, and says so.
  const zero = computeDeflatedSharpe({ returns: returnsA, trial_count: 1_000_000_000, trial_sharpe_variance: 0 });
  assert.deepEqual([zero.expected_max_sharpe, zero.deflated_sharpe === zero.psr_zero], [0, true]);
  assert.ok(zero.warnings.includes("zero_trial_variance"));
  assert.equal(zero.warnings.includes("trial_variance_far_below_sampling"), false);
});

test("annualized trial Sharpe ratios are recognised (103-2 review)", () => {
  const annualized = trialsA.map((value) => value * Math.sqrt(252));
  const result = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...annualized, 0.14409016554761872 * Math.sqrt(252)], periods_per_year: 252 });
  assert.ok(result.warnings.includes("trial_sharpes_look_annualized"));
  assert.ok(result.warnings.includes("trial_variance_far_above_sampling"));
  // Per-period trials that include the selected one raise neither.
  const perPeriod = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...trialsA, 0.14409016554761872], periods_per_year: 252 });
  assert.equal(perPeriod.warnings.includes("trial_sharpes_look_annualized"), false);
  assert.equal(computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...annualized, 0.14409016554761872 * Math.sqrt(252)] }).warnings.includes("trial_sharpes_look_annualized"), false, "needs periods_per_year");
});

test("returns at any finite scale give the same statistics, and the far quantiles are exact (103-2 review)", () => {
  const reference = computeDeflatedSharpe({ returns: returnsA, trial_count: 7, trial_sharpe_variance: 0.0004 });
  for (const scale of [1e-300, 1e-90, 1e-78, 1e100, 1e300]) {
    const scaled = computeDeflatedSharpe({ returns: returnsA.map((value) => value * scale), trial_count: 7, trial_sharpe_variance: 0.0004 });
    assert.equal(scaled.status, "evaluated", String(scale));
    for (const key of ["sharpe", "skewness", "kurtosis", "deflated_sharpe"]) close(scaled[key], reference[key], 1e-12, `${key} at ${scale}`);
    assert.ok(Number.isFinite(scaled.standard_deviation), `sd at ${scale}`);
  }
  // Large values of one sign near the input limit.
  const shifted = computeDeflatedSharpe({ returns: returnsA.map((value) => value + 0.9), trial_count: 7, trial_sharpe_variance: 0.0004 });
  const huge = computeDeflatedSharpe({ returns: returnsA.map((value) => (value + 0.9) * 1e300), trial_count: 7, trial_sharpe_variance: 0.0004 });
  assert.equal(huge.status, "evaluated");
  for (const key of ["sharpe", "skewness", "kurtosis"]) close(huge[key], shifted[key], 1e-12, `${key} near the input limit`);
  // Proportional subnormal inputs give exactly the statistics of the integers they are multiples of (review 2): the
  // mean is formed in normalised units, not in the input's unit.
  const tiny = 5e-324;
  for (const integers of [[1, 2], [3, 5, 7], [1, 4, 2, 8, 5]]) {
    const plain = computeDeflatedSharpe({ returns: integers, trial_count: 7, trial_sharpe_variance: 0.0004 });
    const subnormal = computeDeflatedSharpe({ returns: integers.map((value) => value * tiny), trial_count: 7, trial_sharpe_variance: 0.0004 });
    for (const key of ["sharpe", "deflated_sharpe", "psr_zero"]) close(subnormal[key], plain[key], 1e-12, `${key} for ${integers}`);
  }
  // E[max] of a billion trials, computed from the lower tail so 1 - 1/N is never rounded (Python reference).
  close(expectedMaxStandardNormal(1_000_000_000), 6.0903889964134565, 1e-14, "1e9");
  // AS241's region boundaries: |q| = 0.425 (p = 0.075, 0.925) and r = 5 (p = exp(-25)).
  const boundary = [[0.075, -1.4395314709384557], [0.925, 1.439531470938456], [0.0749999999, -1.4395314716448926], [0.0750000001, -1.4395314702320186],
    [Math.exp(-25) * (1 - 1e-9), -6.65790464364812], [Math.exp(-25) * (1 + 1e-9), -6.657904643354088], [1 - Math.exp(-25) * (1 + 1e-6), 6.657904029578415],
    // Points each region's own formula covers, away from the boundaries.
    [0.08, -1.4050715603096322], [0.09, -1.3407550336902165], [0.0999, -1.2821215797087744], [0.92, 1.4050715603096327],
    [5e-10, -6.1094102048693975], [3e-11, -6.543737689677802], [1e-12, -7.034483825301132], [1e-13, -7.3487961028006765],
    [8e-14, -7.378568887831625], [0.999999999999, 7.0344869100478356]];
  for (const [p, z] of boundary) close(normalQuantile(p), z, 1e-15, `p=${p}`);
});

// Every number in a result is finite, so the MCP response never carries a null (review 2).
const assertFinite = (value, path = "result") => {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} is ${value}`);
  else if (Array.isArray(value)) value.forEach((item, index) => assertFinite(item, `${path}[${index}]`));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) assertFinite(item, `${path}.${key}`);
};

test("inputs outside the ranges that keep results finite are refused, and results at the edges are finite (103-2 review 2)", () => {
  const base = { returns: returnsA, trial_count: 1_000_000_000, trial_sharpe_variance: 0.0004 };
  for (const [extra, pattern] of [
    [{ target_annual_sharpe: 1e-160 }, /target_annual_sharpe must be a positive number from 0.0001 to 10000/],
    [{ target_annual_sharpe: 1e5 }, /target_annual_sharpe must be a positive number from/],
    [{ periods_per_year: 1e308 }, /periods_per_year must be a positive number of at most 100000000/],
    [{ trial_sharpe_variance: 1e13 }, /trial_sharpe_variance must be a non-negative number of at most/],
    [{ returns: [...returnsA, 1e301] }, /returns must hold 2 to 100000 finite numbers of magnitude at most 1e\+300/],
  ]) assert.throws(() => computeDeflatedSharpe({ ...base, ...extra }), pattern, JSON.stringify(Object.keys(extra)));
  assert.throws(() => computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [0.1, 1e7] }), /trial_sharpes must hold 2 to 100000 finite numbers of magnitude at most 1000000/);
  // At the edges every returned number is finite.
  for (const extra of [{ target_annual_sharpe: 1e-4, periods_per_year: 1e8 }, { target_annual_sharpe: 1e4, periods_per_year: 1e-9 }, { trial_sharpe_variance: 1e12 }, { trial_sharpe_variance: 0 }]) {
    const result = computeDeflatedSharpe({ ...base, ...extra });
    assert.equal(result.status, "evaluated", JSON.stringify(extra));
    assertFinite(result);
  }
  assertFinite(computeDeflatedSharpe({ returns: returnsA.map((value) => (value + 0.9) * 1e300), trial_sharpes: [1e6, -1e6, 0.5] }));
  assertFinite(computeDeflatedSharpe({ returns: [5e-324, 1e-323], trial_count: 2, trial_sharpe_variance: 0 }));
  assertFinite(computeDeflatedSharpe({ returns: [0, 0, 0], trial_count: 2, trial_sharpe_variance: 1 }));
});

test("a trial computed with the population standard deviation matches only in long samples with modest Sharpe ratios (103-2 review 2)", () => {
  // Thirty alternating returns of -0.01 and +0.03: the sample Sharpe ratio is 0.5·sqrt(29/30), the population one 0.5.
  const alternating = Array.from({ length: 30 }, (_, t) => (t % 2 === 0 ? -0.01 : 0.03));
  const result = computeDeflatedSharpe({ returns: alternating, trial_sharpes: [0, 0.1, 0.5] });
  close(result.sharpe, 0.5 * Math.sqrt(29 / 30), 1e-12, "sample sharpe");
  assert.deepEqual([result.trials.selected_matches_a_trial, result.warnings.includes("selected_not_among_trials")], [false, true]);
});
