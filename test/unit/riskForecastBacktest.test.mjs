import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VAR_LEVELS, MONTE_CARLO_DRAWS, SEED_BASE, coverageSeed, independenceSeed, transitionCounts, kupiecStatistic,
  independenceStatistic, chiSquareSurvival, monteCarloP, coverageNull, independenceNull, evaluateLevel, testsReported,
} from '../../build/riskForecastBacktest.js';
import { createRandom } from '../../build/seededRandom.js';

// docs/RISK_FORECAST_BACKTEST_PLAN.md, step 2. Hit sequences are built directly as integer arrays, never from simulated
// returns, so every count and result here is the same on every CPU (plan Q5).
const REFERENCE = JSON.parse(readFileSync(new URL('../fixtures/risk-backtest/reference.json', import.meta.url), 'utf8'));
/** A small statistic is formed from large terms, so its double-precision error is absolute (plan Q1). */
const within = (got, exact, size, label) => {
  const tolerance = 1e-12 * Math.abs(exact) + 1e-14 * size;
  assert.ok(Math.abs(got - exact) <= tolerance, `${label}: ${got} vs ${exact} (tolerance ${tolerance})`);
};
const sequence = (T, positions) => { const s = new Uint8Array(T); for (const t of positions) s[t] = 1; return s; };
const spread = (T, count, offset = 0) => Array.from({ length: count }, (_, k) => (offset + Math.floor(((k + 0.5) * T) / count)) % T);
const nullsCache = new Map();
/** Coverage nulls at production N, computed once per configuration. */
const coverage = (level, T, segments = [T]) => {
  const key = `${level}:${segments.join(',')}`;
  if (!nullsCache.has(key)) nullsCache.set(key, coverageNull(level, T, segments));
  return nullsCache.get(key);
};

test('the statistics match the independent 60-digit reference (P1, Q1)', () => {
  for (const { x, T, alpha, statistic } of REFERENCE.kupiec) within(kupiecStatistic(x, T, alpha), Number(statistic), T, `LR_uc x=${x} T=${T} α=${alpha}`);
  for (const { table, statistic } of REFERENCE.independence) {
    const [n00, n01, n10, n11] = table;
    within(independenceStatistic({ n00, n01, n10, n11 }), Number(statistic), n00 + n01 + n10 + n11, `LR_ind ${table}`);
  }
  for (const { x, T, alpha, table, statistic } of REFERENCE.conditional) {
    const [n00, n01, n10, n11] = table;
    within(kupiecStatistic(x, T, alpha) + independenceStatistic({ n00, n01, n10, n11 }), Number(statistic), T + n00 + n01 + n10 + n11, `LR_cc ${x}/${T} ${table}`);
  }
  for (const { statistic, df, p } of REFERENCE.chi_square) {
    const exact = Number(p);
    if (exact < 1e-300) continue;   // erfc returns 0 from about 26.5 (plan Q1)
    const got = chiSquareSurvival(Number(statistic), df);
    assert.ok(Math.abs(got - exact) <= 1e-9 * exact, `χ²(${df}) at ${statistic}: ${got} vs ${exact}`);
  }
  assert.ok(REFERENCE.kupiec.length > 90 && REFERENCE.independence.length >= 60 && REFERENCE.chi_square.length === 28);
});

test('hand cases: zero counts, no hits, all hits, a hit at the end, chain breaks, and tables that are exactly 0 (F7)', () => {
  assert.equal(kupiecStatistic(19, 1900, 0.01), 0, 'x = αT exactly');
  assert.ok(kupiecStatistic(0, 1900, 0.01) > 0 && kupiecStatistic(1900, 1900, 0.01) > 0);
  assert.equal(independenceStatistic({ n00: 0, n01: 0, n10: 0, n11: 0 }), 0, 'no transitions');
  assert.equal(independenceStatistic(transitionCounts(new Uint8Array(100), [100])), 0, 'no hits');
  assert.equal(independenceStatistic(transitionCounts(new Uint8Array(100).fill(1), [100])), 0, 'all hits');
  for (const table of [[1805, 95, 95, 5], [3610, 190, 190, 10]]) {
    const [n00, n01, n10, n11] = table;
    assert.ok(Object.is(independenceStatistic({ n00, n01, n10, n11 }), 0), `${table} is exactly 0`);
  }
  // A hit at the end starts no transition; a chain break drops the pair across it.
  assert.deepEqual(transitionCounts(sequence(5, [4]), [5]), { n00: 3, n01: 1, n10: 0, n11: 0 });
  assert.deepEqual(transitionCounts(sequence(4, [0, 1, 3]), [2, 2]), { n00: 0, n01: 1, n10: 0, n11: 1 });
  assert.deepEqual(transitionCounts(sequence(4, [0, 1, 3]), [4]), { n00: 0, n01: 1, n10: 1, n11: 1 });
});

test('seeds and streams are the contract constants (section 6)', () => {
  assert.equal(SEED_BASE, 20_261_001);
  assert.deepEqual([coverageSeed(0), coverageSeed(1)], [20_261_002, 20_261_003]);
  const independence = [0, 1].flatMap((f) => [0, 1].flatMap((l) => [0, 1].map((c) => independenceSeed(f, l, c) - SEED_BASE)));
  assert.deepEqual(independence, [11, 12, 13, 14, 21, 22, 23, 24]);
  assert.equal(MONTE_CARLO_DRAWS, 9_999);
  assert.deepEqual(VAR_LEVELS, [{ level: 0.01, z: -2.326347874040841 }, { level: 0.05, z: -1.6448536269514726 }]);
  assert.equal(testsReported(2), 12);
  assert.equal(testsReported(1), 6);
});

test('Monte Carlo: p = (1 + #≥)/(N + 1), rejection decided in integers, ties count, and draws are deterministic', () => {
  const draws = Float64Array.from({ length: 19 }, (_, i) => i + 1);   // N + 1 = 20: reject iff no draw is ≥ observed
  assert.deepEqual(monteCarloP(100, draws), { p: 1 / 20, rejects: true });
  assert.deepEqual(monteCarloP(19, draws), { p: 2 / 20, rejects: false }, 'a tie counts as ≥');
  assert.deepEqual(monteCarloP(0, draws), { p: 1, rejects: false });
  const nine999 = new Float64Array(9_999);
  nine999.fill(1, 9_999 - 499);   // 499 draws ≥ 1: p = 500/10000 = 0.05, which rejects
  assert.equal(monteCarloP(1, nine999).rejects, true);
  nine999.fill(1, 9_999 - 500);
  assert.equal(monteCarloP(1, nine999).rejects, false);
  const a = coverageNull(0, 300, [120, 180], 499), b = coverageNull(0, 300, [120, 180], 499);
  assert.deepEqual([...a.kupiec], [...b.kupiec]);
  assert.deepEqual([...a.conditional], [...b.conditional]);
  assert.deepEqual([...independenceNull(300, [300], 9, 77, 499)], [...independenceNull(300, [300], 9, 77, 499)]);
  for (const nullDraws of [a.kupiec, a.conditional]) for (let i = 1; i < nullDraws.length; i++) assert.ok(nullDraws[i - 1] <= nullDraws[i]);
  // LR_cc = LR_uc + LR_ind with LR_ind ≥ 0, so each order statistic of the conditional null is at least the Kupiec one.
  assert.ok(a.kupiec.every((value, i) => a.conditional[i] >= value));
  assert.ok(a.kupiec.some((value, i) => a.conditional[i] > value));
  // Hits are drawn at α: the mean simulated hit count matches αT through the Kupiec statistics' minimum near αT.
  assert.equal(a.kupiec[0], 0, 'some draw has exactly αT = 3 hits');
  // The segments shape the transitions, and so the conditional null, but not the Kupiec one.
  const whole = coverageNull(0, 300, [300], 499);
  assert.deepEqual([...whole.kupiec], [...a.kupiec]);
  assert.notDeepEqual([...whole.conditional], [...a.conditional]);
});

test('the permutation null equals a naive one that rebuilds the index array before every draw', () => {
  const T = 50, x = 7, draws = 300, seed = 4242, segments = [20, 30];
  const random = createRandom(seed);
  const naive = [];
  for (let d = 0; d < draws; d++) {
    const index = Array.from({ length: T }, (_, t) => t);
    for (let i = 0; i < x; i++) { const j = i + Math.floor(random() * (T - i)); [index[i], index[j]] = [index[j], index[i]]; }
    naive.push(independenceStatistic(transitionCounts(sequence(T, index.slice(0, x)), segments)));
  }
  assert.deepEqual([...independenceNull(T, segments, x, seed, draws)], naive.sort((p, q) => p - q));
});

test('the Kupiec region is an interval of counts that do not reject, and the cases agree with it without own nulls', () => {
  const null1900 = coverage(0, 1900);
  const [low, high] = null1900.region;
  assert.ok(low <= 19 && 19 <= high, `${low}..${high}`);
  for (let k = 0; k <= 60; k++) {
    const rejects = monteCarloP(kupiecStatistic(k, 1900, 0.01), null1900.kupiec).rejects;
    assert.equal(!rejects, k >= low && k <= high, `k = ${k}`);
  }
  // m = 0: both cases coincide, the region decides as the case p-values do, and nothing is indeterminate.
  for (const x of [low - 1, low, 19, high, high + 1]) {
    const entry = evaluateLevel({ forecast: 0, level: 0, T: 1900, segments: [1900], hits: sequence(1900, spread(1900, x)),
      ownNull: new Uint8Array(1900), coverage: null1900 });
    assert.deepEqual(entry.kupiec.as_hits, entry.kupiec.as_non_hits);
    assert.equal(entry.kupiec.result, x < low || x > high ? 'rejected' : 'not_rejected', `x = ${x}`);
    for (const name of ['independence', 'conditional_coverage']) assert.notEqual(entry[name].result, 'indeterminate_due_to_own_nulls');
  }
});

test('own nulls both ways: neither attack gets a coverage test to not_rejected (N1, R1)', () => {
  const T = 1900, null1900 = coverage(0, T);
  // Too few hits: no hits, plus 19 spread-out own nulls (the cap), which would make x = αT if counted as hits.
  const tooFew = evaluateLevel({ forecast: 0, level: 0, T, segments: [T], hits: new Uint8Array(T),
    ownNull: sequence(T, spread(T, 19)), coverage: null1900 });
  assert.deepEqual(tooFew.hits, { without_own_nulls: 0, with_own_nulls: 19 });
  // Too many hits: 40 spread-out hits, 19 of them nulled.
  const all = spread(T, 40, 7);
  const tooMany = evaluateLevel({ forecast: 0, level: 0, T, segments: [T], hits: sequence(T, all.slice(19)),
    ownNull: sequence(T, all.slice(0, 19)), coverage: null1900 });
  for (const entry of [tooFew, tooMany]) {
    for (const name of ['kupiec', 'conditional_coverage']) {
      assert.ok(['indeterminate_due_to_own_nulls', 'rejected'].includes(entry[name].result), `${name}: ${entry[name].result}`);
    }
  }
  assert.equal(tooFew.kupiec.result, 'indeterminate_due_to_own_nulls');
  // LR_cc: the as-hits case does not reject and the as-non-hits case does, with directions that are not opposite
  // (as_expected against too_few), so the split alone makes it indeterminate.
  assert.deepEqual(tooFew.direction, { as_hits: 'as_expected', as_non_hits: 'too_few' });
  assert.equal(tooFew.conditional_coverage.result, 'indeterminate_due_to_own_nulls');
  assert.equal(tooFew.kupiec.as_non_hits.p_monte_carlo, 1 / (MONTE_CARLO_DRAWS + 1), 'x = 0 is far outside');
  // LR_ind can rightly not reject there: with x = 0 every permutation ties.
  assert.equal(tooFew.independence.as_non_hits.statistic, 0);
  // For independence the attack is nulls on the hits of a clustered sequence: 10 adjacent pairs, the second of each
  // pair nulled. Counted as hits they cluster; as non-hits they do not.
  const firsts = spread(T, 10, 3);
  const clustered = evaluateLevel({ forecast: 1, level: 0, T, segments: [T], hits: sequence(T, firsts),
    ownNull: sequence(T, firsts.map((t) => t + 1)), coverage: null1900 });
  assert.equal(clustered.independence.as_hits.p_monte_carlo, 1 / (MONTE_CARLO_DRAWS + 1));
  assert.ok(['indeterminate_due_to_own_nulls', 'rejected'].includes(clustered.independence.result), clustered.independence.result);
  assert.equal(clustered.independence.result, 'indeterminate_due_to_own_nulls', 'only the as-hits case rejects');
  // Each case uses its own permutation stream, conditional on its own hit count.
  for (const [entry, forecast] of [[clustered, 1], [tooMany, 0]]) {
    const xNon = entry.hits.without_own_nulls;
    const own = independenceNull(T, [T], xNon, independenceSeed(forecast, 0, 1));
    assert.equal(entry.independence.as_non_hits.p_monte_carlo, monteCarloP(entry.independence.as_non_hits.statistic, own).p);
    const asHits = independenceNull(T, [T], entry.hits.with_own_nulls, independenceSeed(forecast, 0, 0));
    assert.equal(entry.independence.as_hits.p_monte_carlo, monteCarloP(entry.independence.as_hits.statistic, asHits).p);
  }
});

test('opposite directions make LR_cc indeterminate even when both cases reject (P1)', () => {
  // T = 5,000 at 1%: 25 hits (too few) and 50 own nulls (the cap) put the cases far on either side of αT = 50.
  const T = 5000, null5000 = coverage(0, T);
  const positions = spread(T, 75, 5);
  const entry = evaluateLevel({ forecast: 0, level: 0, T, segments: [T], hits: sequence(T, positions.filter((_, k) => k % 3 === 0)),
    ownNull: sequence(T, positions.filter((_, k) => k % 3 !== 0)), coverage: null5000 });
  assert.deepEqual(entry.hits, { without_own_nulls: 25, with_own_nulls: 75 });
  assert.deepEqual(entry.direction, { as_hits: 'too_many', as_non_hits: 'too_few' });
  assert.ok(monteCarloP(entry.conditional_coverage.as_hits.statistic, null5000.conditional).rejects);
  assert.ok(monteCarloP(entry.conditional_coverage.as_non_hits.statistic, null5000.conditional).rejects);
  assert.equal(entry.conditional_coverage.result, 'indeterminate_due_to_own_nulls');
});

test('the underpowered boundary is αT < 10, and x = αT is as_expected', () => {
  const T = 1000, entry = evaluateLevel({ forecast: 0, level: 0, T, segments: [T], hits: sequence(T, spread(T, 10)),
    ownNull: new Uint8Array(T), coverage: coverage(0, T) });
  assert.equal(entry.expected, 10);
  assert.equal(entry.expected_hits_below_10, false);
  assert.equal(entry.kupiec.result, 'not_rejected');
  assert.deepEqual(entry.direction, { as_hits: 'as_expected', as_non_hits: 'as_expected' });
});

test('a null interval straddling the Kupiec region is indeterminate, derived from the reported region (P1, Q6)', () => {
  const T = 3000, null3000 = coverage(0, T);
  const [low, high] = null3000.region;
  const x0 = low - 1, m = high - low + 2;
  assert.ok(m <= Math.ceil(T / 100), `m = ${m} must stay within the cap`);
  const positions = spread(T, x0 + m, 11);
  const entry = evaluateLevel({ forecast: 0, level: 0, T, segments: [T], hits: sequence(T, positions.filter((_, k) => k % (x0 + m) < x0)),
    ownNull: sequence(T, positions.filter((_, k) => k % (x0 + m) >= x0)), coverage: null3000 });
  assert.deepEqual(entry.hits, { without_own_nulls: x0, with_own_nulls: high + 1 });
  // Both cases reject LR_uc, one with too few hits and one with too many; some placements would not.
  assert.ok(monteCarloP(entry.kupiec.as_hits.statistic, null3000.kupiec).rejects);
  assert.ok(monteCarloP(entry.kupiec.as_non_hits.statistic, null3000.kupiec).rejects);
  assert.deepEqual(entry.direction, { as_hits: 'too_many', as_non_hits: 'too_few' });
  assert.equal(entry.kupiec.result, 'indeterminate_due_to_own_nulls');
  assert.equal(entry.conditional_coverage.result, 'indeterminate_due_to_own_nulls');
});

test('underpowered non-rejections, the uninformative flag, and the entry shape (section 6)', () => {
  const T = 250, null250 = coverage(0, T);
  const entry = evaluateLevel({ forecast: 0, level: 0, T, segments: [T], hits: sequence(T, [40, 200]), ownNull: new Uint8Array(T), coverage: null250 });
  assert.equal(entry.expected_hits_below_10, true);
  assert.equal(entry.kupiec.result, 'not_rejected_underpowered');
  assert.deepEqual(entry.independence.independence_uninformative, { as_hits: false, as_non_hits: false });
  const single = evaluateLevel({ forecast: 0, level: 0, T, segments: [T], hits: sequence(T, [100]), ownNull: new Uint8Array(T), coverage: null250 });
  assert.deepEqual(single.independence.independence_uninformative, { as_hits: true, as_non_hits: true });
  assert.deepEqual(Object.keys(entry), ['level', 'T', 'hits', 'expected', 'expected_hits_below_10', 'direction', 'kupiec', 'independence',
    'conditional_coverage', 'kupiec_non_rejection_region']);
  assert.deepEqual(Object.keys(entry.kupiec), ['result', 'as_hits', 'as_non_hits']);
  assert.deepEqual(Object.keys(entry.kupiec.as_hits), ['statistic', 'p_asymptotic', 'p_monte_carlo']);
  assert.equal(entry.expected, 2.5);
});
