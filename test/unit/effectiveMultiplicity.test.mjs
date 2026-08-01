import assert from "node:assert/strict";
import test from "node:test";
import {
  PRE_REGISTERED_EFFECTIVE_MULTIPLICITY_ESTIMATOR,
  estimateEffectiveMultiplicity,
  symmetricEigenvalues,
} from "../../build/effectiveMultiplicity.js";

const random = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

/** Box-Muller, so the null statistics really are standard normal rather than merely spread out. */
const normals = (next) => {
  const u = Math.max(next(), 1e-12);
  const v = next();
  const radius = Math.sqrt(-2 * Math.log(u));
  return [radius * Math.cos(2 * Math.PI * v), radius * Math.sin(2 * Math.PI * v)];
};

/** replications x tests, each column standard normal, all columns sharing correlation rho. */
const equicorrelated = (replications, tests, rho, seed) => {
  const next = random(seed);
  const rows = [];
  for (let index = 0; index < replications; index += 1) {
    const [common] = normals(next);
    const row = [];
    for (let test = 0; test < tests; test += 1) {
      const [own] = normals(next);
      row.push(Math.sqrt(rho) * common + Math.sqrt(1 - rho) * own);
    }
    rows.push(row);
  }
  return rows;
};

test("a family cannot behave like more independent tests than it holds", () => {
  // Reading the family maximum against a standard normal did exactly this. A Fisher-z on serially
  // correlated returns is far wider than a standard normal, so its tail inverted through the normal
  // claimed tens of thousands of independent tests in a family of twenty-five. Scoring each test
  // against its own null column removes the assumption that produced it.
  const next = random(20260801);
  const heavy = Array.from({ length: 4_000 }, () => {
    const scale = 40 + 20 * next();
    const [common] = normals(next);
    return Array.from({ length: 25 }, () => {
      const [own] = normals(next);
      return scale * (Math.sqrt(0.7) * common + Math.sqrt(0.3) * own);
    });
  });
  const result = estimateEffectiveMultiplicity({ nullStatistics: heavy, nominalTests: 25, nominalAlpha: 0.05 });
  assert.ok(result.effectiveTests > 0.5, String(result.effectiveTests));
  assert.ok(result.effectiveTests <= 25, `${result.effectiveTests} exceeds the family it came from`);
  // Rescaling every statistic changes nothing: only the dependence between tests can move this.
  const rescaled = heavy.map((row) => row.map((value) => value * 1000));
  assert.ok(Math.abs(estimateEffectiveMultiplicity({
    nullStatistics: rescaled, nominalTests: 25, nominalAlpha: 0.05,
  }).effectiveTests - result.effectiveTests) < 1e-9);
});

test("eigenvalues come back for the two structures whose answers are known by hand", () => {
  const identity = [[1, 0], [0, 1]];
  assert.deepEqual(symmetricEigenvalues(identity), [1, 1]);
  // An all-ones correlation matrix of size n has eigenvalues n, 0, ..., 0.
  const ones = Array.from({ length: 4 }, () => new Array(4).fill(1));
  const eigenvalues = symmetricEigenvalues(ones);
  assert.ok(Math.abs(eigenvalues[0] - 4) < 1e-9);
  for (const value of eigenvalues.slice(1)) assert.ok(Math.abs(value) < 1e-9);
});

test("independent tests come back at their nominal count", () => {
  const result = estimateEffectiveMultiplicity({
    nullStatistics: equicorrelated(20_000, 8, 0, 12345), nominalTests: 8, nominalAlpha: 0.05,
  });
  assert.equal(result.status, "available");
  assert.equal(result.preRegisteredEstimator, PRE_REGISTERED_EFFECTIVE_MULTIPLICITY_ESTIMATOR);
  assert.equal(result.effectiveTests, result.estimates.empirical_null_minimum_p_value);
  // Sampling noise in a quantile of 20,000 draws leaves a little slack around the true eight.
  assert.ok(result.effectiveTests > 6.5 && result.effectiveTests < 9.5, String(result.effectiveTests));
  assert.ok(result.estimates.li_ji_2005 > 7.5, String(result.estimates.li_ji_2005));
});

test("perfectly redundant tests come back as one", () => {
  const base = equicorrelated(5_000, 1, 0, 777);
  const duplicated = base.map((row) => [row[0], row[0], row[0], row[0], row[0], row[0]]);
  const result = estimateEffectiveMultiplicity({
    nullStatistics: duplicated, nominalTests: 6, nominalAlpha: 0.05,
  });
  assert.equal(result.effectiveTests, 1);
  assert.ok(Math.abs(result.estimates.li_ji_2005 - 1) < 0.05, String(result.estimates.li_ji_2005));
  assert.ok(Math.abs(result.estimates.galwey_2009 - 1) < 0.05, String(result.estimates.galwey_2009));
});

test("effective multiplicity falls as the family becomes more dependent", () => {
  const counts = [0, 0.5, 0.9].map((rho) => estimateEffectiveMultiplicity({
    nullStatistics: equicorrelated(20_000, 12, rho, 4242), nominalTests: 12, nominalAlpha: 0.05,
  }).effectiveTests);
  assert.ok(counts[0] > counts[1], `${counts[0]} should exceed ${counts[1]}`);
  assert.ok(counts[1] > counts[2], `${counts[1]} should exceed ${counts[2]}`);
  // Twelve equicorrelated tests are never more than twelve independent ones, and never fewer than one.
  for (const count of counts) assert.ok(count >= 0.8 && count <= 13, String(count));
});

test("the estimate is reported beside the nominal count and never as a replacement for it", () => {
  const result = estimateEffectiveMultiplicity({
    nullStatistics: equicorrelated(2_000, 10, 0.8, 99), nominalTests: 10, nominalAlpha: 0.05,
  });
  assert.equal(result.nominalTests, 10);
  assert.equal(result.usage, "reported_only_never_used_in_any_eligibility_decision");
  assert.ok(result.effectiveTests < 10, "a dependent family should measure below its nominal count");
  assert.ok(result.limitations.some((item) => item.includes("not on its own a reason to relax")));
});

test("the estimate carries the replication noise it is subject to", () => {
  // At a thousand replications the point estimate for twenty-one independent tests lands anywhere
  // from roughly seventeen to thirty. Reporting it bare would read as a precision it does not have.
  const independent = (replications, seed) => {
    const next = random(seed);
    return Array.from({ length: replications }, () => Array.from({ length: 21 }, () => normals(next)[0]));
  };
  const scarce = estimateEffectiveMultiplicity({
    nullStatistics: independent(1_000, 42), nominalTests: 21, nominalAlpha: 0.05,
  });
  const plentiful = estimateEffectiveMultiplicity({
    nullStatistics: independent(20_000, 42), nominalTests: 21, nominalAlpha: 0.05,
  });
  for (const result of [scarce, plentiful]) {
    assert.equal(result.effectiveTestsInterval.confidenceLevel, 0.95);
    assert.ok(result.effectiveTestsInterval.lower <= result.effectiveTests);
    assert.ok(result.effectiveTestsInterval.upper >= result.effectiveTests);
    // The truth is twenty-one, and an interval that does not reach it would be worse than none.
    assert.ok(result.effectiveTestsInterval.lower <= 21 && result.effectiveTestsInterval.upper >= 21,
      `interval [${result.effectiveTestsInterval.lower}, ${result.effectiveTestsInterval.upper}] misses 21`);
  }
  const width = (result) => result.effectiveTestsInterval.upper - result.effectiveTestsInterval.lower;
  assert.ok(width(scarce) > width(plentiful) * 2, "twenty times the replications should narrow it markedly");
});

test("an estimate outside one to family size is held at the bound and says that it was", () => {
  // An empirical quantile of a p-value grid escapes the range the quantity lives in, most visibly
  // at few replications: four perfectly dependent tests over a hundred draws read 0.836.
  const next = random(1);
  const dependent = (replications) =>
    Array.from({ length: replications }, () => { const [value] = normals(next); return [value, value, value, value]; });
  for (const replications of [100, 1_000, 20_000]) {
    const result = estimateEffectiveMultiplicity({
      nullStatistics: dependent(replications), nominalTests: 4, nominalAlpha: 0.05,
    });
    assert.equal(result.effectiveTests, 1, `${replications} replications`);
    // The raw value is kept, because a held estimate and a genuine one are otherwise the same number.
    assert.ok(result.rawEffectiveTests < 1 && result.rawEffectiveTests > 0.5, String(result.rawEffectiveTests));
    assert.ok(result.limitations.some((item) => item.includes("held_at_the_bound")));
    assert.ok(result.effectiveTestsInterval.lower >= 1);
    assert.ok(result.effectiveTestsInterval.upper <= 4);
  }
  // The upper bound binds too: twenty-one independent tests over a thousand draws reach past 25.
  const wide = estimateEffectiveMultiplicity({
    nullStatistics: Array.from({ length: 1_000 }, () => Array.from({ length: 21 }, () => normals(next)[0])),
    nominalTests: 21, nominalAlpha: 0.05,
  });
  assert.ok(wide.effectiveTestsInterval.upper <= 21);
  // An estimate that never left the range is reported untouched and says nothing about a bound.
  const inRange = estimateEffectiveMultiplicity({
    nullStatistics: equicorrelated(20_000, 12, 0.5, 4242), nominalTests: 12, nominalAlpha: 0.05,
  });
  assert.equal(inRange.effectiveTests, inRange.rawEffectiveTests);
  assert.ok(!inRange.limitations.some((item) => item.includes("held_at_the_bound")));
});

test("a family that cannot support an estimate says so rather than returning a number", () => {
  const usable = equicorrelated(500, 4, 0.3, 5);
  const cases = [
    [{ nullStatistics: usable, nominalTests: 4, nominalAlpha: 0 }, "nominal_alpha_outside_the_open_unit_interval"],
    [{ nullStatistics: usable.map((row) => row.slice(0, 1)), nominalTests: 1, nominalAlpha: 0.05 },
      "a_family_of_fewer_than_two_tests_has_no_multiplicity_to_reduce"],
    [{ nullStatistics: usable.slice(0, 99), nominalTests: 4, nominalAlpha: 0.05 },
      "fewer_than_one_hundred_null_replications"],
    [{ nullStatistics: usable.map((row, index) => (index === 3 ? row.slice(0, 2) : row)), nominalTests: 4, nominalAlpha: 0.05 },
      "null_replications_are_ragged_or_hold_non_finite_statistics"],
    [{ nullStatistics: usable.map((row, index) => (index === 3 ? [NaN, ...row.slice(1)] : row)), nominalTests: 4, nominalAlpha: 0.05 },
      "null_replications_are_ragged_or_hold_non_finite_statistics"],
  ];
  for (const [input, reason] of cases) {
    const result = estimateEffectiveMultiplicity(input);
    assert.equal(result.status, "not_evaluable", reason);
    assert.equal(result.effectiveTests, null);
    assert.equal(result.rawEffectiveTests, null);
    assert.deepEqual(result.limitations, [reason]);
  }
});

test("a test that never moves under the null leaves the eigenvalue estimators undefined, not wrong", () => {
  const rows = equicorrelated(1_000, 3, 0.2, 31).map((row) => [...row, 0]);
  const result = estimateEffectiveMultiplicity({ nullStatistics: rows, nominalTests: 4, nominalAlpha: 0.05 });
  // The measured estimator still works: a constant column simply never wins the maximum.
  assert.equal(result.status, "available");
  assert.equal(result.estimates.li_ji_2005, null);
  assert.equal(result.estimates.galwey_2009, null);
  assert.ok(result.limitations.some((item) => item.includes("no_variation_under_the_null")));
});

test("the estimate names the neighbouring values the replication grid allows", () => {
  // A p-value from n draws lives on multiples of 1/n, so what this inverts to is discrete, and in
  // the range an eighteen-test family occupies there are only a handful of reachable values. Two
  // studies reporting the same number may simply have landed on the same grid point.
  const result = estimateEffectiveMultiplicity({
    nullStatistics: equicorrelated(1_000, 18, 0.3, 9), nominalTests: 18, nominalAlpha: 0.05,
  });
  const { below, above } = result.attainableNeighbours;
  assert.ok(below < result.effectiveTests, `${below} should sit below ${result.effectiveTests}`);
  assert.ok(above > result.effectiveTests, `${above} should sit above ${result.effectiveTests}`);
  // Coarse enough that the neighbours are far apart, which is the point of reporting them.
  assert.ok(above - below > 3, `${below} to ${above} is not the coarseness this warns about`);
  assert.ok(result.limitations.some((item) => item.includes("quantised by the replication count")));
  // Twenty times the replications makes the grid twenty times finer.
  const finer = estimateEffectiveMultiplicity({
    nullStatistics: equicorrelated(20_000, 18, 0.3, 9), nominalTests: 18, nominalAlpha: 0.05,
  });
  assert.ok(finer.attainableNeighbours.above - finer.attainableNeighbours.below <
    (above - below) / 5, "a finer grid should narrow the reachable neighbours markedly");
});
