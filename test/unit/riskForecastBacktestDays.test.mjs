import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backtestRiskForecast, normalizeWeights, quadraticForm, regimeGroups, RiskBacktestError, MIN_RETURN_DATES, VAR_LEVELS,
} from '../../build/riskForecastBacktest.js';
import { createRandom } from '../../build/seededRandom.js';

// docs/RISK_FORECAST_BACKTEST_PLAN.md, step 3: days, budgets and volatility targeting. Simulated paths use pure
// arithmetic only (an Irwin–Hall normal and a GARCH(1,1) variance), so they are the same on every CPU (plan Q5).
const normal = (random) => { let s = 0; for (let i = 0; i < 12; i++) s += random(); return s - 6; };
function simulate(T, seed, { a = 0.08, b = 0.9, M = 24 } = {}) {
  const random = createRandom(seed);
  let v = 1;
  const truth = [], returns = [], rc = [];
  for (let t = 0; t < T; t++) {
    truth.push(v);
    const s = Math.sqrt(v / M);
    let r = 0, q = 0;
    for (let k = 0; k < M; k++) { const e = s * normal(random); r += e; q += e * e; }
    returns.push([r]);
    rc.push(q);
    v = 1 - a - b + a * r * r + b * v;
  }
  return { truth, returns, rc };
}
const datesOf = (T) => Array.from({ length: T }, (_, t) => new Date(Date.UTC(2000, 0, 3) + t * 86_400_000).toISOString().slice(0, 10));
const run = ({ returns, rc, a, b, weights = [1], targetValue = 10, draws = 99, dropCause }) => {
  const dates = datesOf(returns.length);
  return backtestRiskForecast({ dates, dropCause: dropCause ?? dates.map((_, d) => (returns[d] === null ? 'no_endpoint' : null)),
    returns, rc, forecasts: [a, b], weights, targetValue, returnUnit: 'log_percent', weekdays: 5, draws });
};
/**
 * A flat synthetic run: unit variance, a constant forecast, and small alternating returns that drift up (+0.5%, −0.4%),
 * so wealth keeps making new peaks instead of hovering at its start within rounding.
 */
const flat = (T, value = 1) => ({
  returns: Array.from({ length: T }, (_, t) => [t % 2 ? -0.4 : 0.5]),
  rc: Array.from({ length: T }, () => 1),
  a: Array.from({ length: T }, () => value),
  b: Array.from({ length: T }, () => value),
});

test('the regime view: a perfect forecast is near target and α in every ex-ante group; a lagged EWMA is not (F3)', () => {
  const T = 6000, { truth, returns, rc } = simulate(T, 1);
  const ewma = [];
  let f = 1;
  for (let t = 0; t < T; t++) { ewma.push(f); f = 0.94 * f + 0.06 * rc[t]; }
  const out = run({ returns, rc, a: truth, b: ewma });
  assert.equal(out.days.outcome, 'evaluated');
  const perfect = out.forecasts.a.vol_target, lagged = out.forecasts.b.vol_target;
  assert.equal(perfect.regime_view.excluded_dates, 60, 'the first 60 return dates have no 60-date history');
  for (const [name, group] of Object.entries(perfect.regime_view.groups)) {
    assert.ok(Math.abs(group.realized_to_target.intraday_proxy - 1) < 0.05, `${name} intraday ${group.realized_to_target.intraday_proxy}`);
    assert.ok(Math.abs(group.realized_to_target.daily_returns - 1) < 0.07, `${name} daily ${group.realized_to_target.daily_returns}`);
    assert.ok(group.hit_rates[1].rate > 0.035 && group.hit_rates[1].rate < 0.065, `${name} 5% hit rate ${group.hit_rates[1].rate}`);
    assert.equal(group.dates, 1980);
  }
  assert.ok(lagged.regime_view.groups.rising.realized_to_target.intraday_proxy > 1.05);
  assert.ok(lagged.regime_view.groups.falling.realized_to_target.intraday_proxy < 0.95);
  assert.ok(lagged.regime_view.groups.rising.hit_rates[1].rate > 0.055);
  // Leverage per group is no signature: the perfect forecast too carries the most leverage on calm (falling) days.
  assert.ok(perfect.regime_view.groups.falling.mean_leverage > perfect.regime_view.groups.rising.mean_leverage);
  // The worst days: 0.5 is the reference for a forecast whose leverage is unrelated to the losses.
  assert.ok(Math.abs(perfect.worst_days.mean_leverage_percentile - 0.5) < 0.25, String(perfect.worst_days.mean_leverage_percentile));
  assert.equal(perfect.worst_days.days.length, 10);
  for (let i = 1; i < 10; i++) assert.ok(perfect.worst_days.days[i - 1].position_return <= perfect.worst_days.days[i].position_return);
  for (const forecast of [perfect, lagged]) assert.ok(Math.abs(forecast.realized_to_target.intraday_proxy.ratio - 1) < 0.03);
  assert.equal(perfect.sub_periods.length, 4);
  assert.deepEqual(perfect.sub_periods.map((p) => p.dates), [1500, 1500, 1500, 1500]);
});

test('the regime groups: 5 and 60 earlier return dates, a zero 60-date mean excluded, an index split by (g, date)', () => {
  const realized = [...Array.from({ length: 60 }, () => 0), ...Array.from({ length: 70 }, (_, k) => 1 + (k % 7))];
  const { excluded, groups } = regimeGroups(realized);
  // k = 60 has a zero 60-date mean and is excluded with the first 60.
  assert.equal(excluded, 61);
  assert.equal(groups.falling.length + groups.steady.length + groups.rising.length, 69);
  assert.deepEqual([groups.falling.length, groups.steady.length, groups.rising.length], [23, 23, 23]);
  const g = (k) => (realized.slice(k - 5, k).reduce((s, x) => s + x, 0) / 5) / (realized.slice(k - 60, k).reduce((s, x) => s + x, 0) / 60);
  const maxFalling = Math.max(...groups.falling.map(g)), minRising = Math.min(...groups.rising.map(g));
  assert.ok(maxFalling <= Math.min(...groups.steady.map(g)) && Math.max(...groups.steady.map(g)) <= minRising);
  // A count that is not a multiple of 3: [⌊kT'/3⌋, ⌊(k + 1)T'/3⌋) gives 23, 23 and 24.
  const seventy = regimeGroups([...realized, 3]).groups;
  assert.deepEqual([seventy.falling.length, seventy.steady.length, seventy.rising.length], [23, 23, 24]);
});

test('budgets: missing returns up to 10% of run dates, at least 250 return dates, at most ⌈T/100⌉ own nulls (F4)', () => {
  const withMissing = (runDates, missingCount) => {
    const base = flat(runDates);
    for (let d = 1; d <= missingCount; d++) { base.returns[d * 3] = null; base.rc[d * 3] = null; }
    return run(base);
  };
  assert.equal(withMissing(1000, 100).days.outcome, 'evaluated', '10·100 = 1,000 is not more than 1,000');
  const over = withMissing(1000, 101);
  assert.deepEqual([over.days.outcome, over.days.reason, over.forecasts, over.tests_reported],
    ['not_evaluable', 'more_than_10_percent_of_returns_missing', null, 0]);
  assert.deepEqual(over.days.missing_returns, { total: 101, by_cause: { no_endpoint: 101 } });
  assert.ok(over.scale_check.a, 'a not-evaluable response still carries the scale check');
  assert.equal(withMissing(259, 9).days.outcome, 'evaluated', `T = 250 = ${MIN_RETURN_DATES}`);
  assert.equal(withMissing(259, 10).days.reason, 'fewer_than_250_return_days');
  // Own nulls: ⌈300/100⌉ = 3 is allowed, 4 blocks that forecast only.
  for (const [m, status] of [[3, 'evaluated'], [4, 'blocked_by_forecast_nulls']]) {
    const base = flat(300);
    for (let k = 0; k < m; k++) base.a[50 + k * 40] = null;
    const out = run(base);
    assert.equal(out.forecasts.a.status, status, `m = ${m}`);
    assert.equal(out.forecasts.b.status, 'evaluated');
    assert.equal(out.tests_reported, status === 'evaluated' ? 12 : 6);
  }
  const blocked = (() => { const base = flat(300); for (let k = 0; k < 4; k++) base.a[50 + k * 40] = null; return run(base).forecasts.a; })();
  assert.deepEqual(blocked, { status: 'blocked_by_forecast_nulls', own_nulls: 4, cap: 3 });
});

test('own nulls: invalid, non-positive and missing forecasts all count, and A never depends on B', () => {
  const base = flat(400);
  base.a[10] = null;
  base.a[20] = -1;            // not positive-definite
  base.a[30] = Number.NaN;    // not finite
  base.a[40] = 0;             // σ̂² not positive
  const withB = run(base);
  assert.equal(withB.forecasts.a.own_nulls, 4);
  // A matrix forecast is checked by the validity rule, not by its quadratic form: an indefinite or asymmetric matrix
  // is an own null even where w'Σ̂w > 0.
  const pair = { returns: Array.from({ length: 400 }, () => [0.5, 0.5]), rc: Array.from({ length: 400 }, () => [[1, 0], [0, 1]]) };
  const valid = Array.from({ length: 400 }, () => [[1, 0], [0, 1]]);
  const invalid = valid.slice();
  invalid[100] = [[1, 2], [2, 1]];   // w'Sw = 1.5 with w = [½, ½], but not positive-definite
  invalid[200] = [[1, 0.5], [0, 1]];   // asymmetric
  assert.equal(run({ ...pair, a: invalid, b: valid, weights: [1, 1] }).forecasts.a.own_nulls, 2);
  const withoutB = run({ ...base, b: base.b.map(() => null) });
  assert.equal(withoutB.forecasts.b.status, 'blocked_by_forecast_nulls');
  assert.deepEqual(withoutB.forecasts.a, withB.forecasts.a, 'B being null, valid or absent never changes A');
  assert.equal(withoutB.tests_reported, 6);
  // Descriptive hit rates in the regime groups and sub-periods use valid-forecast dates only.
  const later = flat(400);
  later.a[150] = null; later.a[250] = null; later.a[350] = null;
  const vt = run(later).forecasts.a.vol_target;
  for (const group of [...Object.values(vt.regime_view.groups), ...vt.sub_periods]) {
    for (const rate of group.hit_rates) assert.equal(rate.valid_dates, group.dates - group.own_null_dates);
  }
  assert.equal(Object.values(vt.regime_view.groups).reduce((sum, g) => sum + g.own_null_dates, 0), 3);
});

test('carried leverage: the most recent valid forecast, across missing returns; flat before the first valid one', () => {
  const T = 300, base = flat(T);
  base.a[0] = base.a[1] = null;                         // before the first valid forecast: flat
  base.returns[0] = [-40]; base.returns[1] = [-40];     // big losses that a flat position does not take
  base.a[98] = 4;                                       // σ̂ = 2 on the last valid date before the gap
  base.returns[99] = null; base.rc[99] = null;          // a missing return
  base.a[100] = null;                                   // an own null after it: carries 98's leverage
  base.returns[100] = [-30];
  const out = run({ ...base, targetValue: Math.sqrt(260) });   // daily target 1, so L = 1/σ̂
  const a = out.forecasts.a;
  assert.equal(a.own_nulls, 3);
  assert.equal(a.own_null_dates_with_carried_leverage, 1);
  const worst = a.vol_target.worst_days.days[0];
  assert.equal(worst.date, datesOf(T)[100]);
  assert.equal(worst.leverage, 0.5, 'carried from date 98 across the missing return');
  assert.ok(a.vol_target.worst_days.days.every((d) => d.date !== datesOf(T)[0] && d.date !== datesOf(T)[1]), 'flat days lose nothing');
  assert.equal(a.vol_target.worst_days.own_null_dates, 1);
});

test('ruin: 1 + R_t ≤ 0 ruins the position for good, with the drawdown fields (F11)', () => {
  const T = 300, base = flat(T);
  base.a[50] = 1e-6;                    // σ̂ = 0.001: leverage 1,000 at a daily target of 1
  base.returns[50] = [-1];              // a 1% loss at 1,000× is ruin
  const out = run({ ...base, targetValue: Math.sqrt(260) });
  const drawdown = out.forecasts.a.vol_target.drawdown;
  assert.equal(drawdown.ruined_on, datesOf(T)[50]);
  assert.equal(drawdown.max, 1);
  assert.equal(drawdown.trough_date, datesOf(T)[50]);
  assert.equal(drawdown.underwater_at_end, true);
  assert.ok(drawdown.longest_underwater_dates >= T - 50, 'the final stretch runs to the last date');
  assert.equal(out.forecasts.b.vol_target.drawdown.ruined_on, null);
  // Without ruin: a peak, a trough, and the own nulls inside that stretch.
  const dip = flat(T);
  dip.returns[199] = [3];                        // a clear peak, on an own-null date with carried leverage
  dip.returns[200] = [-3]; dip.returns[201] = [-3]; dip.returns[202] = [0.5];   // 202 would otherwise lose 0.5% more
  dip.a[199] = null; dip.a[201] = null;
  const d = run({ ...dip, targetValue: Math.sqrt(260) }).forecasts.a.vol_target.drawdown;
  assert.equal(d.peak_date, datesOf(T)[199]);
  assert.equal(d.trough_date, datesOf(T)[201]);
  assert.equal(d.own_null_dates_in_peak_to_trough, 1, 'after the peak, up to the trough');
  assert.ok(d.longest_underwater_dates < 150, `${d.longest_underwater_dates}: the recovery after the dip, not the whole run`);
  // Compounded, not linear: one −50% log return at leverage 1 loses 1 − e^−0.5 ≈ 39.3%, not 50%.
  const crash = flat(T);
  crash.returns[149] = [0.5];   // the peak is the day before the crash
  crash.returns[150] = [-50];
  crash.returns[151] = [0.5];
  const c = run({ ...crash, targetValue: Math.sqrt(260) }).forecasts.a.vol_target.drawdown;
  assert.ok(Math.abs(c.max - (1 - Math.exp(-0.5))) < 1e-3, String(c.max));
});

test('leverage statistics: ties keep the first maximum date, and constant leverage sits at percentile 0.5', () => {
  const out = run({ ...flat(300), targetValue: Math.sqrt(260) });
  const vt = out.forecasts.a.vol_target;
  assert.deepEqual(vt.leverage, { mean: 1, median: 1, p95: 1, max: 1, max_date: datesOf(300)[0] });
  assert.equal(vt.worst_days.mean_leverage_percentile, 0.5, '(r − 0.5)/T with every rank tied at (T + 1)/2');
});

test('a return exactly at the VaR threshold is not a hit', () => {
  const T = 300, base = flat(T);
  base.returns[120] = [VAR_LEVELS[0].z * Math.sqrt(1)];   // exactly z₀.₀₁·σ̂
  const out = run(base);
  assert.deepEqual(out.forecasts.a.var.map((entry) => entry.hits.without_own_nulls), [0, 1], 'strict at 1%, below z₀.₀₅·σ̂ at 5%');
});

test('weights: normalized by max then sum, invalid ones refused; portfolio returns use them in series order', () => {
  assert.deepEqual(normalizeWeights([1e308, 1e308], 2), [0.5, 0.5]);
  assert.deepEqual(normalizeWeights([5e-324], 1), [1]);
  assert.deepEqual(normalizeWeights([2, -1, 1], 3), [0.5, -0.25, 0.25]);
  for (const bad of [[1], [1, Number.NaN], [0, 0], [1, Infinity]]) {
    assert.throws(() => normalizeWeights(bad, 2), (e) => e instanceof RiskBacktestError && e.code === 'weights_invalid', JSON.stringify(bad));
  }
  assert.equal(quadraticForm([0.5, -0.5], [[4, 1], [1, 2]]), 1);
  assert.equal(quadraticForm([-1], 9), 9);
  // A long-short portfolio: the hit decision uses w'r against z·√(w'Σ̂w).
  const T = 300, returns = Array.from({ length: T }, () => [0.5, 0.5]);
  returns[100] = [-2, 2];   // w'r = −2 with w = [0.5, −0.5]; the first series alone would give −1, no hit
  const sigma = Array.from({ length: T }, () => [[1, 0], [0, 1]]);
  const out = run({ returns, rc: sigma, a: sigma, b: sigma, weights: [0.5, -0.5] });
  assert.deepEqual(out.forecasts.a.var.map((entry) => entry.hits.without_own_nulls), [1, 1]);
});

test('the scale check flags a median ratio below 0.1 or above 10, exclusive, and skips zero realized variance', () => {
  const scaled = (value) => run({ ...flat(300), rc: Array.from({ length: 300 }, (_, t) => (t === 7 ? 0 : 10)),
    a: Array.from({ length: 300 }, () => value), b: Array.from({ length: 300 }, () => 10) });
  const at = scaled(1);   // 1/10 = 0.1 exactly
  assert.deepEqual(at.scale_check.a, { median_ratio: 0.1, dates: 299 });
  assert.deepEqual(at.scale_check.flags, []);
  assert.deepEqual(scaled(0.99).scale_check.flags, [{ forecast: 'a', flag: 'forecast_scale_differs_from_proxy_by_over_10x' }]);
  assert.deepEqual(scaled(100).scale_check.flags, []);
  assert.deepEqual(scaled(100.5).scale_check.flags, [{ forecast: 'a', flag: 'forecast_scale_differs_from_proxy_by_over_10x' }]);
});

test('days: segments, chain breaks and the evaluated shape', () => {
  const base = flat(300);
  base.returns[100] = null; base.rc[100] = null;
  base.returns[200] = null; base.rc[200] = null;
  const out = run({ ...base, dropCause: datesOf(300).map((_, d) => (d === 100 ? 'too_many_missing_slots' : d === 200 ? 'no_endpoint' : null)) });
  assert.deepEqual(out.days, { run_dates: 300, missing_returns: { total: 2, by_cause: { too_many_missing_slots: 1, no_endpoint: 1 } },
    return_dates: 298, chain_breaks: 2, outcome: 'evaluated' });
  assert.deepEqual(Object.keys(out), ['days', 'scale_check', 'forecasts', 'tests_reported']);
  assert.deepEqual(Object.keys(out.forecasts.a), ['status', 'own_nulls', 'own_null_dates_with_carried_leverage', 'var', 'vol_target']);
  assert.deepEqual(Object.keys(out.forecasts.a.vol_target), ['realized_to_target', 'drawdown', 'leverage', 'regime_view', 'worst_days', 'sub_periods']);
  assert.deepEqual(out.forecasts.a.var.map((entry) => entry.level), [0.01, 0.05]);
  assert.equal(out.forecasts.a.var[0].T, 298);
});
