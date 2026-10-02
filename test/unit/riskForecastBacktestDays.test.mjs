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

test('drawdown: wealth held relative to its peak survives an overflowing run of gains, and ruin after it is 1', () => {
  const T = 300, dates = datesOf(T);
  const overflowing = () => {
    const base = flat(T);
    for (let t = 10; t < 20; t++) { base.a[t] = 1e-300; base.returns[t] = [1]; }   // L = 1e150: +1% a day overflows absolute wealth
    return base;
  };
  // Ruin at the same leverage: absolute wealth gave (∞ − 0)/∞ = NaN and kept the maximum at a 0.4% dip.
  const ruin = overflowing();
  ruin.a[30] = 1e-300; ruin.returns[30] = [-1];
  const r = run({ ...ruin, targetValue: Math.sqrt(260) }).forecasts.a.vol_target.drawdown;
  assert.deepEqual({ max: r.max, peak: r.peak_date, trough: r.trough_date, ruined: r.ruined_on },
    { max: 1, peak: dates[28], trough: dates[30], ruined: dates[30] }, 'the running peak before the ruin, as on any path');
  // A loss after the overflow is still measured: ∞·0.6 = ∞ would have hidden it.
  const crash = overflowing();
  crash.returns[29] = [0.5]; crash.returns[30] = [-50]; crash.returns[31] = [0.5];   // a peak the day before, at leverage 1
  const c = run({ ...crash, targetValue: Math.sqrt(260) }).forecasts.a.vol_target.drawdown;
  assert.ok(Math.abs(c.max - (1 - Math.exp(-0.5))) < 1e-12, String(c.max));
  assert.deepEqual([c.peak_date, c.trough_date, c.ruined_on], [dates[29], dates[30], null]);
  assert.deepEqual([c.underwater_at_end, c.longest_underwater_dates], [true, T - 30], 'never recovered: underwater from the crash to the end');
});

test('drawdown edges: a flat date ignores its return, ruin is always the trough, and wealth that underflowed stays at 0', () => {
  const T = 300, dates = datesOf(T), plain = Math.sqrt(260);   // L = 1 at σ̂ = 1
  // Flat before the first valid forecast (u = 0): a return beyond e^709.78 makes exp ∞, and 0·∞ was NaN for the rest of the run.
  const flatStart = (r) => {
    const base = flat(T);
    base.a[0] = null; base.a[1] = null; base.a[2] = null;
    base.returns[1] = [r];
    return base;
  };
  // Also at the smallest target, where every R rounds to 0 and only u·S = 0 keeps the flat date out of the worst days.
  for (const targetValue of [10, 5e-324]) {
    assert.deepEqual(run({ ...flatStart(80000), targetValue }).forecasts.a.vol_target, run({ ...flatStart(-0.4), targetValue }).forecasts.a.vol_target,
      `R = 0 and u·S = 0 either way, at ${targetValue}`);
  }
  // Two days at 1 + R = e^−25 round the drawdown to 1. After a recovery, a ruin on day 200 is still the trough, from the
  // running peak on day 198 (design F11), not the earlier dip with the same rounded value.
  const deep = () => {
    const base = flat(T);
    base.returns[50] = [-2500]; base.returns[51] = [-2500];
    for (const t of [52, 53, 54]) base.returns[t] = [2500];
    return base;
  };
  const dip = run({ ...deep(), targetValue: plain }).forecasts.a.vol_target.drawdown;
  assert.deepEqual([dip.max, dip.peak_date, dip.trough_date, dip.ruined_on], [1, dates[48], dates[51], null]);
  const ruin = deep();
  ruin.a[200] = 1e-6; ruin.returns[200] = [-1];
  const r = run({ ...ruin, targetValue: plain }).forecasts.a.vol_target.drawdown;
  assert.deepEqual([r.max, r.peak_date, r.trough_date, r.ruined_on], [1, dates[198], dates[200], dates[200]]);
  // 35 days at e^−25 underflow wealth to 0 without ruin; a later day beyond e^709.78 (R = ∞) leaves it there, not NaN.
  const under = flat(T);
  for (let t = 50; t < 85; t++) under.returns[t] = [-2500];
  under.returns[100] = [80000];
  const u = run({ ...under, targetValue: plain }).forecasts.a.vol_target.drawdown;
  assert.deepEqual([u.max, u.ruined_on, u.underwater_at_end, u.longest_underwater_dates], [1, null, true, T - 49]);
  // Wealth at 2e-174 of its peak, then a day where (u/√P)·S overflows but R = L·S ≈ 4e168 does not: still underwater, where
  // value·∞ would have made a new peak. The target is 1e-140, and σ̂² = value²/P gives L = 1 on the other dates.
  const value = 1e-140, fallback = flat(T, value * value / 260);
  for (let t = 50; t < 66; t++) fallback.returns[t] = [-2500];
  fallback.a[100] = 1e-300; fallback.returns[100] = [36800];
  assert.equal((1 / Math.sqrt(1e-300) / Math.sqrt(260)) * (Math.exp(368) - 1), Infinity);
  const f = run({ ...fallback, targetValue: value }).forecasts.a.vol_target.drawdown;
  assert.deepEqual([f.max, f.ruined_on, f.underwater_at_end, f.longest_underwater_dates], [1, null, true, T - 49]);
});

test('a PSD proxy whose w\'RC w rounds below 0 counts as 0: the intraday ratio is 0, not null, and no regime date is grouped', () => {
  // Two series moving together (the second c times the first): Σ rr' is PSD with rank 1 and w = (c, −1)/(1 + c) hedges it,
  // so w'RC w is 0 exactly; summed in floating point it lands below 0 here.
  const random = createRandom(7);
  let proxy, w;
  do {
    const c = 0.5 + random();
    w = normalizeWeights([c, -1], 2);
    proxy = [[0, 0], [0, 0]];
    for (let k = 0; k < 24; k++) {
      const r = [random() - 0.5, 0];
      r[1] = c * r[0];
      for (const i of [0, 1]) for (const j of [0, 1]) proxy[i][j] += r[i] * r[j];
    }
  } while (!(quadraticForm(w, proxy) < 0));
  const T = 300, identity = Array.from({ length: T }, () => [[1, 0], [0, 1]]);
  const out = run({ returns: Array.from({ length: T }, (_, t) => [0.5, t % 2 ? 0.1 : 0.3]), rc: Array.from({ length: T }, () => proxy),
    a: identity, b: identity, weights: w });
  const vt = out.forecasts.a.vol_target;
  assert.deepEqual(vt.realized_to_target.intraday_proxy, { annualized: 0, ratio: 0 });
  assert.ok(vt.realized_to_target.daily_returns.ratio > 0);
  assert.deepEqual(vt.sub_periods.map((s) => s.realized_to_target.intraday_proxy), [0, 0, 0, 0]);
  assert.equal(vt.regime_view.excluded_dates, T, 'every 60-date mean is 0');
  assert.equal(vt.regime_view.groups.steady.dates, 0);
  assert.ok(Number.isNaN(vt.regime_view.groups.steady.realized_to_target.intraday_proxy), 'an empty group has no ratio, as before');
  assert.equal(out.scale_check.a, null, 'no date with w\'RC w > 0, with or without the clamp');
});

test('extreme finite targets: the ratios are the same bits for every target, and nothing overflows into ∞·0', () => {
  const T = 300, dates = datesOf(T), base = flat(T, 0.01);   // σ̂ = 0.1: L = 10σ*, 0.62 of the largest double there
  base.b = Array.from({ length: T }, () => 1e-4);   // σ̂ = 0.01: L = σ*·100 overflows at the largest target
  base.b[5] = 1e-6;                                 // the largest leverage, also beyond the largest double there
  base.returns[1] = [0];                            // a flat day at that leverage
  const ratios = (vt) => [vt.realized_to_target.daily_returns.ratio, vt.realized_to_target.intraday_proxy.ratio,
    ...Object.values(vt.regime_view.groups).concat(vt.sub_periods).flatMap((g) => [g.realized_to_target.daily_returns, g.realized_to_target.intraday_proxy])];
  const worst = (vt) => vt.worst_days.days.map((d) => [d.date, d.leverage_percentile]);
  const targets = [5e-324, 1e-300, Math.sqrt(260), 1e300, Number.MAX_VALUE];
  const outs = targets.map((targetValue) => run({ ...base, targetValue }).forecasts);
  const [, small, plain, , largestTarget] = outs;
  for (const f of ['a', 'b']) {
    const reference = ratios(plain[f].vol_target);
    // √(P·mean(L²r²))/value at a plain target: the RMS of r/σ̂.
    const z = base.returns.map((r, t) => r[0] / Math.sqrt(base[f][t]));
    assert.ok(Math.abs(reference[0] / Math.sqrt(z.reduce((sum, x) => sum + x * x, 0) / T) - 1) < 1e-14, `${f} ${reference[0]}`);
    outs.forEach((out, i) => {
      const vt = out[f].vol_target;
      assert.deepEqual(ratios(vt), reference, `${f} at ${targets[i]}`);
      assert.deepEqual(worst(vt), worst(plain[f].vol_target), `${f} at ${targets[i]}: ordered by u·S and ranked by 1/σ̂, never tied by L = ∞ or R = 0`);
      assert.equal(vt.realized_to_target.daily_returns.annualized, vt.realized_to_target.daily_returns.ratio * targets[i]);
    });
  }
  // At the smallest target wealth does not move in double precision: equal to its peak is not underwater.
  const tiny = small.a.vol_target.drawdown;
  assert.deepEqual([tiny.max, tiny.longest_underwater_dates, tiny.underwater_at_end], [0, 0, false]);
  assert.equal(largestTarget.b.vol_target.leverage.max_date, dates[5], 'the largest 1/σ̂, not the first of the leverages that overflow');
  // L = MAX·(10/√260) on A: the mean and the median come from those of 1/σ̂, not from sums of values near the largest double.
  const largest = Number.MAX_VALUE * (10 / Math.sqrt(260));
  assert.ok(Number.isFinite(largest) && !Number.isFinite(largest + largest));
  assert.deepEqual(largestTarget.a.vol_target.leverage, { mean: largest, median: largest, p95: largest, max: largest, max_date: dates[0] });
  // L = ∞ on b: the flat day 1 gives R = σ*·(u·0) = 0, a new peak, before the ruin on day 3 (∞·0 = NaN lost day 1's peak).
  const b = largestTarget.b.vol_target.drawdown;
  assert.deepEqual([b.max, b.peak_date, b.trough_date, b.ruined_on], [1, dates[2], dates[3], dates[3]]);
  assert.equal(largestTarget.b.vol_target.leverage.max, Infinity, 'a leverage beyond the largest double, given as null in JSON');
});

test('a target small enough for σ* = value/√P to underflow: the leverage and the positions still come out', () => {
  // σ̂ = 1e-150 at the smallest positive target: L = 5e-324·(1e150/√260) ≈ 3.06e-175, a normal double; σ* itself is 0.
  const vt = run({ ...flat(300, 1e-300), targetValue: 5e-324 }).forecasts.a.vol_target;
  const expected = 5e-324 * ((1 / Math.sqrt(1e-300)) / Math.sqrt(260));
  assert.ok(expected > 1e-176 && 5e-324 / Math.sqrt(260) === 0);
  assert.deepEqual([vt.leverage.median, vt.leverage.p95, vt.leverage.max], [expected, expected, expected]);
  assert.ok(Math.abs(vt.leverage.mean / expected - 1) < 1e-14, String(vt.leverage.mean));
  assert.ok(vt.sub_periods.every((s) => s.mean_leverage > 0));
  assert.ok(vt.worst_days.days.every((d) => d.position_return < 0), 'R = value·((u/√P)·S) is a normal double here');
});

test('worst days: where u·S ties at −∞, the more negative R comes first', () => {
  // Short one series at σ̂ = 1e-150 (u = 1e150): rises of 1e159- and 2e159-fold give u·S = −∞ on both dates, while
  // R = value·((u/√P)·S) is finite at a target of 1e-150: about −6.2e157 and −1.24e158.
  const T = 300, dates = datesOf(T), base = flat(T, 1e-300);
  base.returns[50] = [100 * Math.log(1e159)];
  base.returns[60] = [100 * Math.log(2e159)];
  const days = run({ ...base, weights: [-1], targetValue: 1e-150 }).forecasts.a.vol_target.worst_days.days;
  assert.deepEqual(days.slice(0, 2).map((d) => d.date), [dates[60], dates[50]], 'by R where u·S ties, not by date');
  assert.ok(days.every((d, i) => i === 0 || d.position_return >= days[i - 1].position_return), 'non-decreasing in R');
});

test('position returns: value·(u/√P)·S is grouped so that its partial product stays a normal double', () => {
  const T = 300, dates = datesOf(T), root = Math.sqrt(260);
  const growth = (r) => Math.exp(r / 100) - 1;
  // A tiny weight on the only series that moves, a huge σ̂² and target: (u/√P)·S underflows to −0, which gave R = 0 and no
  // drawdown; (value·(u/√P))·S is the true R ≈ −9.4e−17.
  const weights = normalizeWeights([2e-167, 1], 2);
  const huge = Array.from({ length: T }, () => [[1, 0], [0, 8e307]]);
  const tiny = run({ returns: Array.from({ length: T }, (_, t) => [t % 2 ? -0.4 : 0.5, 0]), rc: Array.from({ length: T }, () => [[1, 0], [0, 1]]),
    a: huge, b: huge, weights, targetValue: 1.7e308 }).forecasts.a.vol_target;
  const scale = 1 / Math.sqrt(quadraticForm(weights, huge[0])) / root, loss = weights[0] * growth(-0.4);
  assert.ok(Math.abs(scale * loss) < 2 ** -1022, 'the first grouping underflows');
  assert.equal(tiny.worst_days.days[0].position_return, (1.7e308 * scale) * loss);
  assert.ok(tiny.worst_days.days[0].position_return < -9e-17 && tiny.drawdown.max > 0 && tiny.drawdown.longest_underwater_dates === 1);
  // A weight of 2e−152: (u/√P)·S ≈ −5.5e−310 is subnormal, not 0, and would round R ≈ −0.094 to its fewer bits.
  const subnormalWeights = normalizeWeights([2e-152, 1], 2), subnormalLoss = subnormalWeights[0] * growth(-0.4);
  const coarse = run({ returns: Array.from({ length: T }, (_, t) => [t % 2 ? -0.4 : 0.5, 0]), rc: Array.from({ length: T }, () => [[1, 0], [0, 1]]),
    a: huge, b: huge, weights: subnormalWeights, targetValue: 1.7e308 }).forecasts.a.vol_target;
  assert.ok(scale * subnormalLoss !== 0 && Math.abs(scale * subnormalLoss) < 2 ** -1022);
  assert.equal(coarse.worst_days.days[0].position_return, (1.7e308 * scale) * subnormalLoss);
  // A subnormal target, u/√P = 1e6 and a short series rising e^705-fold: (u/√P)·S overflows and value·(u/√P) is
  // subnormal, so only (value·S)·(u/√P) is exact; the fallback value·((u/√P)·S) = −∞ would be a ruin.
  const variance = 1 / (1e12 * 260), short = flat(T, variance);
  short.returns[100] = [70500];
  const rise = run({ ...short, weights: [-1], targetValue: 1e-320 }).forecasts.a.vol_target;
  const unitScale = 1 / Math.sqrt(variance) / root, gain = -growth(70500);
  assert.ok(!Number.isFinite(unitScale * gain) && Math.abs(1e-320 * unitScale) < 2 ** -1022);
  assert.deepEqual([rise.drawdown.ruined_on, rise.worst_days.days[0].date, rise.worst_days.days[0].position_return],
    [null, dates[100], (1e-320 * gain) * unitScale]);
  // On ordinary inputs the first grouping is 0.1.18's, bit for bit: here (value·(u/√P))·S would differ in the last bit.
  const plainScale = 1 / Math.sqrt(0.5) / root, plainLoss = growth(-0.4);
  assert.notEqual(10 * (plainScale * plainLoss), (10 * plainScale) * plainLoss);
  assert.equal(run(flat(T, 0.5)).forecasts.a.vol_target.worst_days.days[0].position_return, 10 * (plainScale * plainLoss));
  // S = +∞ (design limit (b)) where L underflows to 0: R = +∞, a new peak, not 0·∞ = NaN for the rest of the run.
  const jump = flat(T);
  jump.returns[100] = [80000];
  const peak = run({ ...jump, targetValue: 5e-324 }).forecasts.a.vol_target.drawdown;
  assert.deepEqual([peak.max, peak.longest_underwater_dates, peak.underwater_at_end], [0, 0, false]);
});

test('the realized-to-target ratios are scaled so that no square overflows, for the smallest valid σ̂²', () => {
  const T = 300, base = flat(T);
  base.a[100] = 1e-320;   // σ̂ = 1e-160: u·r_p = 5e159, whose square overflows
  const vt = run({ ...base, targetValue: Math.sqrt(260) }).forecasts.a.vol_target.realized_to_target;
  const daily = 0.5 / Math.sqrt(1e-320) / Math.sqrt(T), intraday = 1 / Math.sqrt(1e-320) / Math.sqrt(T);   // the one large term dominates
  assert.ok(Math.abs(vt.daily_returns.ratio / daily - 1) < 1e-12, String(vt.daily_returns.ratio));
  assert.ok(Math.abs(vt.intraday_proxy.ratio / intraday - 1) < 1e-12, String(vt.intraday_proxy.ratio));
});

test('leverage statistics: ties keep the first maximum date, and constant leverage sits at percentile 0.5', () => {
  const out = run({ ...flat(300), targetValue: Math.sqrt(260) });
  const vt = out.forecasts.a.vol_target;
  assert.deepEqual(vt.leverage, { mean: 1, median: 1, p95: 1, max: 1, max_date: datesOf(300)[0] });
  assert.equal(vt.worst_days.mean_leverage_percentile, 0.5, '(r − 0.5)/T with every rank tied at (T + 1)/2');
  // Every −0.4% date ties on u·S and on R: the date decides, earliest first.
  assert.deepEqual(vt.worst_days.days.map((d) => d.date), datesOf(300).filter((_, t) => t % 2).slice(0, 10));
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
  // Dates with w'RC w ≤ 0 are skipped: a zero, and a negative value such as rounding can leave (code review C6).
  const scaled = (value) => run({ ...flat(300), rc: Array.from({ length: 300 }, (_, t) => (t === 7 ? 0 : t === 9 ? -1e-20 : 10)),
    a: Array.from({ length: 300 }, () => value), b: Array.from({ length: 300 }, () => 10) });
  const at = scaled(1);   // 1/10 = 0.1 exactly
  assert.deepEqual(at.scale_check.a, { median_ratio: 0.1, dates: 298 });
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
