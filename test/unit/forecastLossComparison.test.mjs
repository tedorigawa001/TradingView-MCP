import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compareForecastLosses, evaluateLoss, neweyWest, blockBounds, trimFavourable, breakdownCount, stationaryBootstrap,
  FORECAST_LOSS_CONTRACT, BOOTSTRAP_SEED, NEAR_COPY_SHARE,
} from '../../build/forecastLossComparison.js';
import { normalizeForecastSet } from '../../build/forecastSet.js';
import { normalCdf, spearman } from '../../build/numerics.js';
import { createRandom } from '../../build/seededRandom.js';

const REF = JSON.parse(readFileSync(new URL('../fixtures/forecast-loss/hac-reference.json', import.meta.url), 'utf8'));
const close = (got, want, relative, label) =>
  assert.ok(Math.abs(got - want) <= relative * Math.abs(want), `${label}: ${got} vs ${want}`);
const day = (i) => new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const tracked = { loss: 'mse', tracked: true };

function scalarSet({ a, b, primary, secondary, labels }) {
  const idx = primary.map((_, i) => i);
  return normalizeForecastSet({
    schema_version: '1.0', source_id: 'test', source_sha256: 'sha256:' + 'a'.repeat(64), evidence_tier: 'synthetic_test',
    horizon: 1, n: 1, underlying_series_ids: ['s'], dates: idx.map(day),
    windows: idx.map((i) => ({ from: `${day(i)}T00:00:00.000Z`, to: `${day(i)}T23:00:00.000Z` })),
    a, b, primary, ...(secondary ? { secondary } : {}), ...(labels ? { labels } : {}),
  }).set;
}
const proxyP = (T) => Array.from({ length: T }, (_, i) => 1 + ((i * 7919) % 13) / 10);
const proxyQ = (T) => Array.from({ length: T }, (_, i) => 0.8 + ((i * 104729) % 17) / 12);
/** MSE scalar set with a chosen daily d: b = p + c, a = p + e, d = e² − c². */
function setFromD(d, { nullA = [], secondary, labels, proxy } = {}) {
  const p = proxy ?? proxyP(d.length);
  const e = d.map((x) => (x >= -1 ? Math.sqrt(1 + x) : 0)), c = d.map((x) => (x >= -1 ? 1 : Math.sqrt(-x)));
  return scalarSet({ a: p.map((x, i) => (nullA.includes(i) ? null : x + e[i])), b: p.map((x, i) => x + c[i]), primary: p,
    secondary: secondary?.(p, e, c), labels });
}
const fewDay = () => Array.from({ length: 2000 }, (_, i) => (i % 100 === 50 ? -10 : 0.02 + 0.03 * Math.sin(i * 1.7)));
const uniform = (T = 400) => Array.from({ length: T }, (_, i) => -0.05 + 0.02 * Math.sin(i * 1.3));
const independentSecondary = (p) => proxyQ(p.length);

test('HAC, DM and p match the statsmodels and scipy references', () => {
  for (const c of REF.hac) {
    const hac = neweyWest(c.d);
    assert.equal(hac.L, c.L, `${c.name} L`);
    assert.equal(hac.T, c.T);
    close(hac.dbar, c.dbar, 1e-10, `${c.name} dbar`);
    close(hac.S, c.S, 1e-10, `${c.name} S`);
    const dm = hac.dbar / Math.sqrt(hac.S / hac.T);
    close(dm, c.DM, 1e-10, `${c.name} DM`);
    close(normalCdf(dm), c.p_a, 1e-12, `${c.name} p_a`);
    close(normalCdf(-dm), c.p_b, 1e-12, `${c.name} p_b`);
  }
});

test('HAC by hand at small T, including the lag cap', () => {
  const two = neweyWest([1, 3]);
  assert.deepEqual([two.L, two.dbar], [1, 2]);
  close(two.S, 0.5, 1e-15, 'T=2');
  const five = neweyWest([1, 2, 3, 4, 10]);
  assert.equal(five.L, 2);
  close(five.S, 10 + 2 * (2 / 3) * 1.6 + 2 * (1 / 3) * -0.6, 1e-14, 'T=5');
  assert.equal(neweyWest([7]).L, 0, 'the cap min(T − 1, …) binds at T = 1');
  // Time reversal leaves the HAC variance unchanged.
  const d = REF.hac[0].d;
  close(neweyWest([...d].reverse()).S, neweyWest(d).S, 1e-12, 'reversed');
});

test('losses match numpy for n = 1, 2, 3, 8 and rank-one, full and zero proxies', () => {
  for (const c of REF.losses) {
    const wrap = (m) => (c.n === 1 ? m[0][0] : m);
    for (const [side, want] of [['a', c.qlike_a], ['b', c.qlike_b]]) close(evaluateLoss(wrap(c[side]), wrap(c.p), 'qlike'), want, 1e-11, `qlike n=${c.n} ${c.proxy}`);
    for (const [side, want] of [['a', c.mse_a], ['b', c.mse_b]]) close(evaluateLoss(wrap(c[side]), wrap(c.p), 'mse'), want, 1e-11, `mse n=${c.n} ${c.proxy}`);
  }
  assert.equal(evaluateLoss(2, 1, 'qlike'), Math.log(2) + 0.5);
  assert.equal(evaluateLoss(2, 0, 'mse'), 4);
});

test('validity: forecasts must be finite, symmetric and positive-definite; proxies PSD', () => {
  assert.equal(evaluateLoss([[1, 0.2], [0.3, 1]], [[1, 0], [0, 1]], 'qlike'), null, 'asymmetric forecast');
  assert.equal(evaluateLoss([[1, 2], [2, 1]], [[1, 0], [0, 1]], 'qlike'), null, 'indefinite forecast');
  assert.equal(evaluateLoss(0, 1, 'qlike'), null, 'zero variance forecast');
  assert.equal(evaluateLoss(-1, 1, 'mse'), null, 'negative variance forecast');
  assert.equal(evaluateLoss(null, 1, 'mse'), null);
  assert.notEqual(evaluateLoss([[1, 0.2], [0.2 + 1e-14, 1]], [[1, 0], [0, 1]], 'qlike'), null, 'symmetric within 1e-12');
  assert.notEqual(evaluateLoss([[2, 0], [0, 2]], [[1, -1], [-1, 1]], 'qlike'), null, 'rank-one proxy');
  assert.equal(evaluateLoss([[2, 0], [0, 2]], [[1, 2], [2, 1]], 'qlike'), null, 'indefinite proxy');
  assert.equal(evaluateLoss(2, -0.5, 'mse'), null, 'negative scalar proxy');
  assert.notEqual(evaluateLoss(2, 0, 'qlike'), null, 'zero proxy');
});

test('the block split, trims and k* behave as specified', () => {
  assert.deepEqual(blockBounds(10), [[0, 3], [3, 6], [6, 8], [8, 10]]);
  assert.deepEqual(blockBounds(100), [[0, 25], [25, 50], [50, 75], [75, 100]]);
  assert.equal(trimFavourable([-3, -3, 1, 2], 1, 'A'), 0, 'ties: the same mean whichever tied value goes');
  assert.equal(trimFavourable([-3, 5, 5, 1], 1, 'B'), 1);
  assert.equal(breakdownCount([-10, 1, 1, 1], 'A'), 1);
  assert.equal(breakdownCount([-1, -1, -1], 'A'), null, 'no crossing');
  assert.equal(breakdownCount([1, -0.2], 'A'), 0, 'the mean already crosses');
  assert.equal(breakdownCount([10, -1, -1, -1], 'B'), 1);
  // Consistency (M1): on the same sample and k, a trim reversal occurs exactly when k* ≤ k.
  const random = createRandom(7);
  for (let trial = 0; trial < 300; trial++) {
    const sample = Array.from({ length: 30 + Math.floor(random() * 50) }, () => (random() - 0.55) * (random() < 0.1 ? 20 : 1));
    for (const side of ['A', 'B']) {
      const kStar = breakdownCount(sample, side);
      for (const k of [0, 1, 2, 5]) {
        const trimmed = trimFavourable(sample, k, side);
        const reversal = side === 'A' ? trimmed >= 0 : trimmed <= 0;
        assert.equal(reversal, kStar !== null && kStar <= k, `trial ${trial} ${side} k=${k}`);
      }
    }
  }
});

test('the bootstrap is fixed-seed, centred, and differs from a percentile p on skewed d', () => {
  const d = fewDay();
  const first = stationaryBootstrap(d, 1, 300), second = stationaryBootstrap(d, 1, 300);
  assert.deepEqual(first, second);
  assert.equal(first.seed, BOOTSTRAP_SEED);
  close(first.mc_se, Math.sqrt(first.p * (1 - first.p) / 300), 1e-15, 'mc_se');
  // One large day makes the resampled mean right-skewed. The percentile reading #{mean* ≥ 0}/R, with
  // the same draws computed independently here, then differs from the centred p (block 1 keeps it sharp).
  const skewed = Array.from({ length: 100 }, (_, i) => (i === 37 ? 8 : -0.1 + 0.01 * Math.sin(i)));
  const random = createRandom(BOOTSTRAP_SEED);
  let atLeastZero = 0, centredCount = 0;
  const skewedMean = skewed.reduce((sum, x) => sum + x, 0) / skewed.length;
  for (let r = 0; r < 300; r++) {
    let index = Math.floor(random() * skewed.length), sum = skewed[index];
    for (let t = 1; t < skewed.length; t++) { index = random() < 1 ? Math.floor(random() * skewed.length) : (index + 1) % skewed.length; sum += skewed[index]; }
    if (sum / skewed.length >= 0) atLeastZero++;
    if (sum / skewed.length - skewedMean <= skewedMean) centredCount++;
  }
  const centred = stationaryBootstrap(skewed, 1, 300, 1).p, percentile = (1 + atLeastZero) / 301;
  assert.equal(centred, (1 + centredCount) / 301, 'the stream and the centred direction match the plan');
  assert.ok(Math.abs(centred - percentile) > 0.05, `centred ${centred} vs percentile ${percentile}`);
  // An iid mean-zero d gives p roughly uniform across independent series.
  const ps = [];
  for (let seed = 1; seed <= 60; seed++) {
    const random2 = createRandom(seed * 7919);
    const series = Array.from({ length: 200 }, () => random2() - 0.5);
    ps.push(stationaryBootstrap(series, 1, 199).p);
  }
  const meanP = ps.reduce((s, x) => s + x, 0) / ps.length;
  assert.ok(meanP > 0.38 && meanP < 0.62, `mean p ${meanP}`);
  assert.ok(ps.filter((p) => p < 0.1).length <= 15);
});

test('a few-day advantage is a decisive-trim conflict (the #100 pattern)', () => {
  const r = compareForecastLosses(setFromD(fewDay(), { secondary: independentSecondary }), tracked);
  assert.equal(r.contract, FORECAST_LOSS_CONTRACT);
  assert.equal(r.mean_favours, 'A');
  assert.ok(r.dm.p_a < 0.05);
  assert.ok(r.trimmed.decisive.mean >= 0);
  assert.ok(r.breakdown.k_star <= r.trimmed.k);
  assert.equal(r.battery_outcome, 'conflicts_found');
  assert.ok(r.robustness_conflicts.includes('trimmed_mean_reverses'));
  assert.equal(r.candidateEligible, false);
});

test('a uniform advantage passes the battery only with a distinct secondary and tracking', () => {
  const full = compareForecastLosses(setFromD(uniform(), { secondary: independentSecondary }), tracked);
  assert.equal(full.mean_favours, 'A');
  assert.deepEqual(full.robustness_conflicts, []);
  assert.equal(full.secondary.status, 'evaluable');
  assert.equal(full.secondary.distinct, true);
  assert.equal(full.battery_outcome, 'no_listed_conflict');
  assert.ok(full.bootstrap.p < 0.05, 'the bootstrap tests the favoured side');
  assert.deepEqual(full.withheld_reasons, []);
  assert.ok(full.limitations.includes('no_listed_conflict_is_not_evidence_of_superiority'));
  const absent = compareForecastLosses(setFromD(uniform()), tracked);
  assert.equal(absent.battery_outcome, 'not_assessed_secondary_proxy_absent');
  const untracked = compareForecastLosses(setFromD(uniform(), { secondary: independentSecondary }), { loss: 'mse', tracked: false });
  assert.equal(untracked.battery_outcome, 'no_listed_conflict_untracked');
  assert.deepEqual(untracked.withheld_reasons, ['no_listed_conflict_untracked']);
});

test('a secondary proxy with the opposite ranking is a conflict', () => {
  // Scoring against B itself makes B perfect under the secondary, so d is positive there.
  const r = compareForecastLosses(setFromD(uniform(), { secondary: (p, e, c) => p.map((x, i) => x + c[i]) }), tracked);
  assert.ok(r.secondary.mean > 0);
  assert.ok(r.robustness_conflicts.includes('secondary_proxy_reverses'));
  assert.equal(r.battery_outcome, 'conflicts_found');
});

test('secondary proxy status: the 0.99 line, an undefined ρ, and more than 5% of used days invalid', () => {
  const inBand = compareForecastLosses(setFromD(uniform(), { secondary: (p) => p.map((x, i) => x * (1 + 0.2 * Math.sin(i * 2.9))) }), tracked);
  assert.ok(inBand.secondary.spearman_rho > 0.9 && inBand.secondary.spearman_rho <= 0.99);
  assert.equal(inBand.secondary.distinct, true);
  const zero = compareForecastLosses(setFromD(uniform(), { secondary: (p) => p.map(() => 0) }), tracked);
  assert.equal(zero.secondary.spearman_rho, null);
  assert.equal(zero.secondary.distinct, false, 'an undefined ρ is not distinct');
  assert.equal(zero.battery_outcome, 'not_assessed_secondary_proxy_not_distinct');
  // Scoring against B with every tenth day invalid: 10% dropped, so not evaluable; its reversal is non-decisive.
  const sparse = compareForecastLosses(setFromD(uniform(), { secondary: (p, e, c) => p.map((x, i) => (i % 10 === 3 ? -1 : x + c[i])) }), tracked);
  assert.deepEqual([sparse.secondary.status, sparse.secondary.dropped, sparse.secondary.used], ['not_evaluable', 40, 360]);
  assert.ok(sparse.secondary.mean > 0);
  assert.deepEqual(sparse.robustness_conflicts, []);
  assert.ok(sparse.non_decisive_disagreements.includes('non_evaluable_secondary_mean_reverses'));
  assert.equal(sparse.battery_outcome, 'not_assessed_secondary_proxy_absent');
});

test('a near-copy secondary is not distinct; a squared-return-like one is, even with strong level differences', () => {
  const nearCopy = compareForecastLosses(setFromD(uniform(), { secondary: (p) => p.map((x, i) => x * (1 + 1e-6 * Math.sin(i))) }), tracked);
  assert.equal(nearCopy.secondary.distinct, false);
  assert.ok(nearCopy.secondary.spearman_rho > 0.99);
  assert.equal(nearCopy.battery_outcome, 'not_assessed_secondary_proxy_not_distinct');
  assert.deepEqual(nearCopy.withheld_reasons, ['not_assessed_secondary_proxy_not_distinct']);
  // Row 6 comes before row 7, and both stay listed.
  const untrackedCopy = compareForecastLosses(setFromD(uniform(), { secondary: (p) => p.map((x, i) => x * (1 + 1e-6 * Math.sin(i))) }),
    { loss: 'mse', tracked: false });
  assert.equal(untrackedCopy.battery_outcome, 'not_assessed_secondary_proxy_not_distinct');
  assert.deepEqual(untrackedCopy.withheld_reasons, ['not_assessed_secondary_proxy_not_distinct', 'no_listed_conflict_untracked']);
  // QLIKE with A's log level swinging over [0, 100]: c_t = log a_t dominates d, so d and d2 correlate
  // above 0.99, but the proxy-dependent parts do not.
  const T = 400, random = createRandom(11);
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const p = proxyP(T), z = Array.from({ length: T }, normal);
  const a = Array.from({ length: T }, (_, i) => Math.exp(100 * (0.5 + 0.5 * Math.sin(i * 0.37))));
  const set = scalarSet({ a, b: p.map(() => 1), primary: p, secondary: p.map((x, i) => x * z[i] * z[i]) });
  const r = compareForecastLosses(set, { loss: 'qlike', tracked: true });
  const dPrimary = p.map((x, i) => evaluateLoss(a[i], x, 'qlike') - evaluateLoss(1, x, 'qlike'));
  const dSecondary = p.map((x, i) => evaluateLoss(a[i], x * z[i] * z[i], 'qlike') - evaluateLoss(1, x * z[i] * z[i], 'qlike'));
  assert.ok(spearman(dPrimary, dSecondary) > 0.99, 'measuring on d would have flagged it');
  assert.equal(r.secondary.distinct, true);
  assert.ok(r.secondary.spearman_rho <= 0.99);
});

test('an exactly zero mean counts as a reversal; both-tail trim and k* on exact values', () => {
  // A zero proxy with integer forecasts keeps every d exact: d = a² − b². Three −99 days (a 1, b 10);
  // the rest alternate +3 (a 2, b 1) and −3 (a 1, b 2), with day 299 at 0 so they sum to exactly zero.
  const a = [], b = [];
  for (let i = 0; i < 300; i++) {
    if ([10, 85, 160].includes(i)) { a.push(1); b.push(10); }
    else if (i === 299) { a.push(1); b.push(1); }
    else if (i % 2 === 0) { a.push(2); b.push(1); } else { a.push(1); b.push(2); }
  }
  const r = compareForecastLosses(scalarSet({ a, b, primary: a.map(() => 0) }), tracked);
  assert.equal(r.mean_favours, 'A');
  assert.equal(r.trimmed.k, 3);
  assert.equal(r.trimmed.decisive.mean, 0);
  assert.equal(r.sub_periods[3].mean, 0);
  assert.deepEqual(r.robustness_conflicts, ['sub_period_4_reverses', 'trimmed_mean_reverses']);
  assert.equal(r.breakdown.k_star, 3, 'removing the three −99 days reaches exactly zero');
  // Sorted: 3 × −99, 148 × −3, 0, 148 × +3; dropping 3 from each end leaves 148 × −3, 0, 145 × +3.
  assert.equal(r.trimmed.both_tails, -9 / 294);
});

test('own nulls: imputed worst case in the decisive trim, blocked above k (M1, N5)', () => {
  const d = Array.from({ length: 400 }, (_, i) => (i === 200 ? 2.0 : i % 50 === 25 ? 0.3 : -0.03 + 0.004 * Math.sin(i)));
  const secondary = independentSecondary;
  const plain = compareForecastLosses(setFromD(d, { secondary }), tracked);
  assert.equal(plain.mean_favours, 'A');
  assert.ok(plain.trimmed.decisive.mean < 0);
  const atK = compareForecastLosses(setFromD(d, { nullA: [1, 2, 3, 4], secondary }), tracked);
  assert.equal(atK.trimmed.k, 4);
  assert.equal(atK.trimmed.decisive.own_nulls_imputed_worst_case, 4);
  assert.ok(atK.trimmed.decisive.mean >= 0, 'the borderline pass becomes a conflict at m = k');
  assert.ok(atK.robustness_conflicts.includes('trimmed_mean_reverses'));
  assert.ok(atK.breakdown.k_star <= atK.trimmed.k);
  close(atK.breakdown.fraction, atK.breakdown.k_star / (396 + 4), 1e-15, 'fraction over T + m');
  assert.ok(!atK.withheld_reasons.includes('blocked_by_dropped_days'), 'm = k is allowed');
  const aboveK = compareForecastLosses(setFromD(d, { nullA: [1, 2, 3, 4, 5], secondary }), tracked);
  assert.equal(aboveK.battery_outcome, 'conflicts_found', 'a conflict still wins row 3');
  assert.ok(aboveK.withheld_reasons.includes('blocked_by_dropped_days'), 'and the block is not hidden');
  // Without a conflict, m > k blocks and m = k does not.
  const mixed = uniform().map((x, i) => (i % 10 === 7 ? 0.2 : x));
  const blocked = compareForecastLosses(setFromD(mixed, { nullA: [10, 20, 30, 40, 50], secondary }), tracked);
  assert.equal(blocked.battery_outcome, 'blocked_by_dropped_days');
  assert.equal(blocked.drops.a_only_null, 5);
  assert.ok(blocked.breakdown.k_star > 0);
  close(blocked.breakdown.fraction, blocked.breakdown.k_star / (395 + 5), 1e-15, 'fraction over T + m');
  const equal = compareForecastLosses(setFromD(mixed, { nullA: [10, 20, 30, 40], secondary }), tracked);
  assert.equal(equal.trimmed.k, 4);
  assert.equal(equal.battery_outcome, 'no_listed_conflict');
});

test('swapping A and B mirrors every output (F3)', () => {
  const base = setFromD(fewDay(), { secondary: independentSecondary });
  const swapped = { ...base, a: base.b, b: base.a };
  const r = compareForecastLosses(base, tracked), s = compareForecastLosses(swapped, tracked);
  assert.equal(s.mean_favours, 'B');
  close(s.dm.DM, -r.dm.DM, 1e-12, 'DM');
  close(s.dm.p_b, r.dm.p_a, 1e-12, 'p');
  close(s.trimmed.decisive.mean, -r.trimmed.decisive.mean, 1e-12, 'decisive trim');
  assert.equal(s.breakdown.k_star, r.breakdown.k_star);
  assert.deepEqual(s.robustness_conflicts, r.robustness_conflicts);
  assert.equal(s.battery_outcome, r.battery_outcome);
  assert.equal(s.bootstrap.p, r.bootstrap.p);
  const nulls = setFromD(uniform(), { nullA: [10, 20, 30, 40, 50], secondary: independentSecondary });
  const mirrored = compareForecastLosses({ ...nulls, a: nulls.b, b: nulls.a }, tracked);
  assert.equal(mirrored.drops.b_only_null, 5);
  assert.equal(mirrored.battery_outcome, 'blocked_by_dropped_days');
});

test('QLIKE d is unchanged when forecasts and proxies are scaled together', () => {
  const T = 300, p = proxyP(T);
  const a = p.map((x, i) => x * (0.8 + 0.1 * Math.sin(i))), b = p.map((x, i) => x * (1.1 + 0.05 * Math.cos(i)));
  const base = compareForecastLosses(scalarSet({ a, b, primary: p }), { loss: 'qlike', tracked: true });
  const scaled = compareForecastLosses(scalarSet({ a: a.map((x) => x * 1e6), b: b.map((x) => x * 1e6), primary: p.map((x) => x * 1e6) }),
    { loss: 'qlike', tracked: true });
  close(scaled.dm.dbar, base.dm.dbar, 1e-9, 'dbar');
  close(scaled.dm.DM, base.dm.DM, 1e-9, 'DM');
});

test('evaluability, drop causes and hard-day diagnostics', () => {
  const T = 200, p = proxyP(T);
  const a = p.map((x) => x + 0.9), b = p.map((x) => x + 1);
  // Day 0: invalid proxy and both null → proxy_invalid (the proxy is checked first). Day 1: both null. Day 2: A only.
  const set = scalarSet({ a: [null, null, null, ...a.slice(3)], b: [null, null, b[2], ...b.slice(3)], primary: [-1, ...p.slice(1)] });
  const r = compareForecastLosses(set, tracked);
  assert.deepEqual(r.drops, { N: 200, used: 197, proxy_invalid: 1, both_null: 1, a_only_null: 1, b_only_null: 0 });
  close(r.hard_days.b_loss_on_a_only_null_days, 1, 1e-12, 'B on the A-only-null day');
  assert.equal(r.hard_days.a_loss_on_b_only_null_days, null);
  const tooMany = compareForecastLosses(scalarSet({ a: a.map((x, i) => (i < 11 ? null : x)), b, primary: p }), tracked);
  assert.deepEqual([tooMany.status, tooMany.battery_outcome], [{ evaluable: false, reason: 'more_than_5_percent_of_dates_dropped' }, 'not_evaluable']);
  const short = compareForecastLosses(scalarSet({ a: a.slice(0, 99), b: b.slice(0, 99), primary: p.slice(0, 99) }), tracked);
  assert.equal(short.status.reason, 'fewer_than_100_used_days');
  const constant = compareForecastLosses(scalarSet({ a, b, primary: p }), tracked);
  assert.equal(constant.status.reason, 'hac_variance_not_positive', 'a constant d has no variance');
  assert.equal(constant.withheld_reasons_scope, 'side_independent_only');
  assert.deepEqual(constant.withheld_reasons, ['not_assessed_secondary_proxy_absent']);
  assert.equal(constant.dm.DM, null);
});

test('the favoured side needs p below 0.05, and the upper tail keeps its precision', () => {
  // Centred uniform noise shifted by a constant: DM is linear in the shift, since S depends on the noise only.
  const random = createRandom(5);
  const noise = Array.from({ length: 300 }, () => (random() - 0.5) * 0.4);
  const centre = noise.reduce((sum, x) => sum + x, 0) / noise.length;
  const shifted = (c) => noise.map((x) => x - centre + c);
  const between = compareForecastLosses(setFromD(shifted(-0.008), { secondary: independentSecondary }), tracked);
  assert.ok(between.dm.p_a > 0.05 && between.dm.p_a < 0.1, `p_a ${between.dm.p_a}`);
  assert.equal(between.mean_favours, 'neither', 'a two-sided 10% test, not a one-sided 10% one');
  assert.equal(between.battery_outcome, 'not_applicable');
  // DM near +10: p_B = Φ(−DM) is about 1e-23, while 1 − Φ(DM) would round to exactly 0.
  const far = compareForecastLosses(setFromD(shifted(0.053), { secondary: independentSecondary }), tracked);
  assert.equal(far.mean_favours, 'B');
  assert.ok(far.dm.DM > 9 && far.dm.DM < 11, `DM ${far.dm.DM}`);
  assert.ok(far.dm.p_b > 0);
  close(far.dm.p_b, normalCdf(-far.dm.DM), 1e-12, 'p_b');
});

test('neither side favoured: not applicable, both one-sided trims labelled by forecast, no k*', () => {
  const d = Array.from({ length: 300 }, (_, i) => Math.sin(i * 2.1) * 0.3);
  const r = compareForecastLosses(setFromD(d), { loss: 'mse', tracked: false });
  assert.equal(r.mean_favours, 'neither');
  assert.equal(r.battery_outcome, 'not_applicable');
  assert.equal(r.withheld_reasons_scope, 'side_independent_only');
  assert.deepEqual(r.withheld_reasons, ['not_assessed_secondary_proxy_absent', 'no_listed_conflict_untracked']);
  assert.equal(r.trimmed.decisive, null);
  assert.ok(r.trimmed.a_tail_removed > r.trimmed.b_tail_removed);
  assert.equal(r.breakdown, null);
  assert.ok(r.bootstrap.p > 0 && r.bootstrap.p <= 1);
});

test('non-decisive disagreements: both-tail trim, bootstrap, caller labels', () => {
  const labels = Array.from({ length: 2000 }, (_, i) => (i < 1000 ? 'first' : 'second'));
  const r = compareForecastLosses(setFromD(fewDay(), { secondary: independentSecondary, labels }), tracked);
  assert.ok(r.non_decisive_disagreements.includes('both_tail_trimmed_mean_reverses'));
  assert.deepEqual(r.caller_label_means.map((l) => l.label), ['first', 'second']);
  assert.ok(r.caller_label_means.every((l) => l.days === 1000));
  // Caller labels never raise a conflict, however they fall.
  assert.ok(!r.robustness_conflicts.some((c) => c.startsWith('caller_label')));
});

// Code review fixes (M1, M2, L1, L2).

test('an overflowing loss fails closed: a secondary day is dropped, a primary day makes the result not evaluable (M1)', () => {
  // Scoring against B makes the secondary a conflict; one day with a proxy of 1e155 overflows both MSE losses.
  const overflow = compareForecastLosses(setFromD(uniform(), { secondary: (p, e, c) => p.map((x, i) => (i === 123 ? 1e155 : x + c[i])) }), tracked);
  assert.equal(overflow.secondary.status, 'evaluable');
  assert.equal(overflow.secondary.dropped, 1);
  assert.ok(Number.isFinite(overflow.secondary.mean) && overflow.secondary.mean > 0);
  assert.ok(overflow.robustness_conflicts.includes('secondary_proxy_reverses'));
  assert.equal(overflow.battery_outcome, 'conflicts_found');
  const primary = setFromD(uniform(), { secondary: independentSecondary });
  const broken = { ...primary, primary: primary.primary.map((x, i) => (i === 50 ? 1e155 : x)) };
  const r = compareForecastLosses(broken, tracked);
  assert.deepEqual(r.status, { evaluable: false, reason: 'non_finite_loss' });
  assert.equal(r.dm, null);
  // QLIKE overflows through tr(S⁻¹P) when a forecast is tiny and the proxy large.
  const q = compareForecastLosses({ ...primary, a: primary.a.map((x, i) => (i === 7 ? 1e-300 : x)),
    primary: primary.primary.map((x, i) => (i === 7 ? 1e10 : x)) }, { loss: 'qlike', tracked: true });
  assert.equal(q.status.reason, 'non_finite_loss');
});

test('a secondary that is one scaling of the primary on most days is not distinct (M2)', () => {
  // Equal to the primary on 399 of 400 days; the day with the largest proxy-dependent part is scaled by 0.3.
  const d = uniform();
  const p = Array.from({ length: 400 }, (_, i) => 1 + ((i * 7919) % 13) / 10);
  const part = d.map((x, i) => Math.abs((Math.sqrt(1 + x) - 1) * p[i]));
  const largest = part.indexOf(Math.max(...part));
  const r = compareForecastLosses(setFromD(d, { secondary: (q) => q.map((x, i) => (i === largest ? 0.3 * x : x)) }), tracked);
  assert.ok(r.secondary.spearman_rho < 0.99, `ρ ${r.secondary.spearman_rho}: the ρ rule alone would pass it`);
  close(r.secondary.near_copy_share, 399 / 400, 1e-15, 'share');
  assert.equal(r.secondary.distinct, false);
  assert.equal(r.battery_outcome, 'not_assessed_secondary_proxy_not_distinct');
  // The line: copies (2P) on exactly half of the jointly nonzero days pass, one day more does not.
  const q = (i) => 0.8 + ((i * 104729) % 17) / 12;
  const copies = (days) => compareForecastLosses(setFromD(uniform(), { secondary: (pp) => pp.map((x, i) => (i < days ? 2 * x : q(i))) }), tracked);
  const atLine = copies(200), overLine = copies(201);
  assert.equal(NEAR_COPY_SHARE, 0.5);
  assert.equal(atLine.secondary.near_copy_share, 200 / 400);
  assert.ok(atLine.secondary.spearman_rho <= 0.99);
  assert.equal(atLine.secondary.distinct, true);
  assert.equal(overLine.secondary.near_copy_share, 201 / 400);
  assert.equal(overLine.secondary.distinct, false);
  // With fewer than 2 jointly nonzero days the share is undefined, and ρ alone decides.
  const single = compareForecastLosses(setFromD(uniform(), { secondary: (pp) => pp.map((x, i) => (i === 5 ? x : 0)) }), tracked);
  assert.equal(single.secondary.near_copy_share, null);
  assert.equal(single.secondary.distinct, single.secondary.spearman_rho !== null && single.secondary.spearman_rho <= 0.99);
  assert.equal(single.secondary.distinct, true);
  // Genuinely different proxies stay distinct.
  const independent = compareForecastLosses(setFromD(uniform(), { secondary: independentSecondary }), tracked);
  assert.ok(independent.secondary.near_copy_share < NEAR_COPY_SHARE);
  assert.equal(independent.secondary.distinct, true);
});

test('distinctness is judged whenever a secondary is present, so both reasons are listed (L2)', () => {
  const r = compareForecastLosses(setFromD(uniform(), {
    secondary: (p) => p.map((x, i) => (i % 10 === 3 ? -1 : x * (1 + 1e-6 * Math.sin(i)))) }), tracked);
  assert.equal(r.secondary.status, 'not_evaluable');
  assert.equal(r.secondary.distinct, false);
  assert.equal(r.battery_outcome, 'not_assessed_secondary_proxy_absent');
  assert.deepEqual(r.withheld_reasons, ['not_assessed_secondary_proxy_absent', 'not_assessed_secondary_proxy_not_distinct']);
});

test('k* and the decisive trim agree exactly, even when the trimmed mean is zero at rounding level (L1)', () => {
  // Ten spread days of −999,999 and 990 centred uniform values whose sum is zero up to rounding.
  for (let seed = 1; seed <= 40; seed++) {
    const random = createRandom(seed);
    const u = Array.from({ length: 990 }, () => random());
    const centre = u.reduce((sum, x) => sum + x, 0) / u.length;
    const rest = u.map((x) => x - centre);
    const sample = rest.flatMap((x, i) => (i % 99 === 49 ? [-999_999, x] : [x]));
    const kStar = breakdownCount(sample, 'A');
    assert.equal(trimFavourable(sample, 10, 'A') >= 0, kStar !== null && kStar <= 10, `seed ${seed}`);
    const r = compareForecastLosses(setFromD(sample.map((x) => x), { secondary: independentSecondary }), tracked);
    assert.equal(r.mean_favours, 'A');
    assert.equal(r.robustness_conflicts.includes('trimmed_mean_reverses'), r.breakdown.k_star !== null && r.breakdown.k_star <= r.trimmed.k,
      `seed ${seed}: k* ${r.breakdown.k_star}, k ${r.trimmed.k}, decisive ${r.trimmed.decisive.mean}`);
  }
});

// Re-review fixes (R-M1, R-L1, R-L2).

test('a copy that went through rounding or tiny noise is still a near copy (R-M1)', () => {
  // A continuous primary, like a realized variance. The day with the largest proxy-dependent part is
  // corrected to 1/1000, moving it from the top rank to the bottom, so that ρ alone would pass it.
  const random = createRandom(9);
  const proxy = Array.from({ length: 400 }, () => Math.exp(random() * 2 - 1));
  const d = uniform();
  const part = d.map((x, i) => Math.abs((Math.sqrt(1 + x) - 1) * proxy[i]));
  const largest = part.indexOf(Math.max(...part));
  const copy = (value) => compareForecastLosses(setFromD(d, { proxy, secondary: (p) => p.map((x, i) => (i === largest ? 1e-3 * x : value(x))) }), tracked);
  const rounded = copy((x) => Number(x.toPrecision(7)));          // a 7-significant-digit export
  assert.ok(rounded.secondary.spearman_rho < 0.99, `ρ ${rounded.secondary.spearman_rho}`);
  assert.ok(rounded.secondary.near_copy_share > 0.99);
  assert.equal(rounded.battery_outcome, 'not_assessed_secondary_proxy_not_distinct');
  const noisy = copy((x) => x * (1 + 1e-9 * (random() - 0.5)));
  assert.ok(noisy.secondary.near_copy_share > 0.99);
  assert.equal(noisy.secondary.distinct, false);
});

test('copies through common export formats are near copies: %g and fixed decimals (R2-M1)', () => {
  // Daily variances near 1e-4. %g keeps 6 significant digits; %.8f keeps 8 decimals, a relative error of
  // up to about 1e-4 here. Both missed the 1e-6 tolerance.
  const random = createRandom(21);
  const proxy = Array.from({ length: 400 }, () => 1e-4 * Math.exp(random() * 2 - 1));
  const d = uniform();
  const part = d.map((x, i) => Math.abs((Math.sqrt(1 + x) - 1) * proxy[i]));
  const largest = part.indexOf(Math.max(...part));
  for (const [format, value] of [['%g', (x) => Number(x.toPrecision(6))], ['%.8f', (x) => Number(x.toFixed(8))]]) {
    const r = compareForecastLosses(setFromD(d, { proxy, secondary: (p) => p.map((x, i) => (i === largest ? 1e-3 * x : value(x))) }), tracked);
    assert.ok(r.secondary.spearman_rho < 0.99, `${format}: ρ ${r.secondary.spearman_rho}`);
    assert.ok(r.secondary.near_copy_share > 0.99, `${format}: share ${r.secondary.near_copy_share}`);
    assert.equal(r.battery_outcome, 'not_assessed_secondary_proxy_not_distinct', format);
  }
});

test('a genuinely different coarse-tick secondary shares one scale on some days and stays distinct (R-L1)', () => {
  // Squared close-to-close move against the Parkinson range, 40 one-tick moves a day. On days that close
  // at one extreme having opened at the other, the two are the same number up to 1/(4 ln 2), exactly.
  const random = createRandom(3);
  const proxy = [], range = [];
  for (let t = 0; t < 400; t++) {
    let x = 0, high = 0, low = 0;
    for (let m = 0; m < 40; m++) { x += random() < 0.5 ? -1 : 1; high = Math.max(high, x); low = Math.min(low, x); }
    proxy.push(x * x);
    range.push((high - low) ** 2 / (4 * Math.log(2)));
  }
  const r = compareForecastLosses(setFromD(uniform(), { proxy, secondary: () => range }), tracked);
  assert.ok(r.secondary.near_copy_share > 0.05 && r.secondary.near_copy_share < NEAR_COPY_SHARE, `share ${r.secondary.near_copy_share}`);
  assert.ok(r.secondary.spearman_rho < 0.99);
  assert.equal(r.secondary.distinct, true);
});

test('a secondary mean that overflows makes the secondary not evaluable (R-L2)', () => {
  // QLIKE: on two days A forecasts 1e-10 and the secondary is 1e298, so each secondary d is about 1e308,
  // finite, while their sum is not.
  const base = setFromD(uniform(), { secondary: independentSecondary });
  const set = { ...base, a: base.a.map((x, i) => (i === 3 || i === 4 ? 1e-10 : x)),
    secondary: base.secondary.map((x, i) => (i === 3 || i === 4 ? 1e298 : x)) };
  const r = compareForecastLosses(set, { loss: 'qlike', tracked: true });
  assert.equal(r.secondary.dropped, 0, 'every day is finite on its own');
  assert.ok(!Number.isFinite(r.secondary.mean));
  assert.equal(r.secondary.status, 'not_evaluable');
  assert.ok(!r.robustness_conflicts.includes('secondary_proxy_reverses'));
  assert.ok(r.withheld_reasons.includes('not_assessed_secondary_proxy_absent'));
});
