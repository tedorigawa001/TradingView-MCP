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
  // The selected Sharpe ratio is not among the trials here, and it is above their maximum.
  assert.deepEqual([result.trials.selected_matches_a_trial, result.warnings], [false, ["selected_not_among_trials"]]);
  assert.equal(result.limitations.length, 4);
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
  const matched = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...trialsA, 0.14409016554761872] });
  assert.deepEqual([matched.trials.selected_matches_a_trial, matched.warnings], [true, []]);
  const below = computeDeflatedSharpe({ returns: returnsA, trial_sharpes: [...trialsA, 0.14409016554761872, 0.3] });
  assert.deepEqual(below.warnings, ["selected_below_trial_max"]);
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
  ];
  for (const [input, pattern] of cases) assert.throws(() => computeDeflatedSharpe(input), pattern, JSON.stringify(Object.keys(input)));
  assert.throws(() => expectedMaxStandardNormal(1), /at least 2/);
});
