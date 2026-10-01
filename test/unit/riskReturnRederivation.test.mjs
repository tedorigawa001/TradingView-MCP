import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRealizedCovariance } from '../../build/realizedCovariance.js';
import { canonicalizeRules } from '../../build/realizedCovarianceRules.js';
import { normalizeBarSeries } from '../../build/barSeries.js';
import { normalizeProxySet } from '../../build/proxySet.js';
import { rederiveReturns, checkRederivation, proxyRunOf } from '../../build/riskReturnRederivation.js';
import { RiskBacktestError } from '../../build/riskForecastBacktest.js';
import { createRandom } from '../../build/seededRandom.js';
import { intlZoneResolver } from '../../build/zonedTime.js';

// docs/RISK_FORECAST_BACKTEST_PLAN.md, step 4: the returns are recomputed from the proxy set's bars over the run and
// used only if every recomputed value equals the stored proxy set (design R1, F8).
const RAW = JSON.parse(readFileSync(new URL('../fixtures/realized-covariance/reference.json', import.meta.url), 'utf8'));
const artifact = (i) => `sha256:${String(i).padStart(64, '0')}`;
const barsOf = (spec, interval) => normalizeBarSeries({ schema_version: '1.0', source_id: 'reference', source_sha256: 'sha256:' + 'a'.repeat(64),
  evidence_tier: 'synthetic_test', series_id: spec.series_id, interval_minutes: interval, open_time: spec.open_time, close: spec.close }).series;
/** A stored proxy set and an in-memory bar store, as the tool sees them. */
function fixture(rulesInput, specs, from_date, to_date, resolver) {
  const { rules, rules_sha256 } = canonicalizeRules(rulesInput);
  const series = specs.map((s, i) => ({ artifact_id: artifact(i), bars: barsOf(s, rules.interval_minutes) }));
  const computed = computeRealizedCovariance({ rules, rules_sha256, from_date, to_date, series, resolver });
  const { set: proxySet } = normalizeProxySet(computed.proxy);
  const store = new Map(series.map((s) => [s.artifact_id, s.bars]));
  const barSeries = { get: async (id) => {
    if (!store.has(id)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return store.get(id);
  } };
  return { proxySet, barSeries, store, computed };
}
const scenario = (name) => {
  const s = RAW.scenarios.find((x) => x.name === name);
  return fixture(s.rules, RAW.bar_sets[s.bars], s.from_date, s.to_date);
};
const runOf = (proxySet, from, to) => ({ dates: proxySet.dates.slice(from, to) });
const code = (c, detail) => (error) => error instanceof RiskBacktestError && error.code === c && (detail === undefined || error.message.endsWith(detail));

test('a sub-run under both first-interval modes equals the stored proxy set, and returns its returns and span', async () => {
  for (const name of ['A_100_shaped', 'B_within_day_log', 'D_tokyo_0700', 'F_eight_series']) {
    const { proxySet, barSeries, computed } = scenario(name);
    const set = runOf(proxySet, 2, proxySet.dates.length - 1);
    const { returns, span } = await rederiveReturns({ set, proxySet, barSeries });
    assert.equal(returns.length, set.dates.length, name);
    const run = proxyRunOf(proxySet, set);
    returns.forEach((r, d) => {
      if (run.drop_cause[d] !== null) return assert.equal(r, null);
      const outer = r.length === 1 ? r[0] * r[0] : r.map((x) => r.map((y) => x * y));
      assert.equal(JSON.stringify(outer), JSON.stringify(run.daily_outer[d]), `${name} ${run.dates[d]}`);
    });
    // The span read: from the bar before the first date's previous endpoint, or from its window start.
    const sub = computeRealizedCovariance({ rules: proxySet.rules, rules_sha256: proxySet.rules_sha256, from_date: set.dates[0],
      to_date: set.dates[set.dates.length - 1], series: computed.proxy.bar_series.map((id, i) => ({ artifact_id: id,
        bars: barsOf(RAW.bar_sets[RAW.scenarios.find((x) => x.name === name).bars][i], proxySet.rules.interval_minutes) })) });
    assert.deepEqual(span, sub.envelope, name);
  }
});

test('a run whose first date is dropped still re-derives: the previous endpoint is read before from_date', async () => {
  const { proxySet, barSeries } = scenario('A_100_shaped');
  const first = proxySet.drop_cause.indexOf('no_previous_endpoint');
  assert.ok(first > 0);
  const set = runOf(proxySet, first, proxySet.dates.length);
  const { returns } = await rederiveReturns({ set, proxySet, barSeries });
  assert.equal(returns[0], null);
  assert.ok(returns.slice(1).some((r) => r !== null));
});

test('a week across the New York DST change re-derives exactly', async () => {
  // Synthetic M15 bars over 2026-02-26 to 03-14 for two series, so the first date's previous endpoint (Friday 02-27) is
  // covered; DST starts on Sunday 2026-03-08.
  const start = Date.parse('2026-02-26T00:00:00.000Z') / 1000, end = Date.parse('2026-03-14T00:00:00.000Z') / 1000;
  const random = createRandom(7);
  const specs = [0, 1].map((i) => {
    const open_time = [], close = [];
    let level = 1.1 + i;
    for (let t = start; t < end; t += 900) { level += 0.0005 * (random() - 0.5); open_time.push(t); close.push(level); }
    return { series_id: `dst:${i}`, open_time, close };
  });
  const { proxySet, barSeries } = fixture({ interval_minutes: 15, time_zone: 'America/New_York', day_end_local: '16:45',
    // Every weekday produces a day, so Sunday 03-08, the switch, is a produced day with 92 slots.
    day_weekdays: [1, 2, 3, 4, 5, 6, 7], max_missing_slots: 6, first_interval: 'from_previous_endpoint', return_unit: 'log_percent' }, specs,
    '2026-03-02', '2026-03-13');
  assert.equal(proxySet.expected_slots[proxySet.dates.indexOf('2026-03-08')], 92, 'the DST day has 23 hours');
  const set = runOf(proxySet, 3, proxySet.dates.length);
  const { returns } = await rederiveReturns({ set, proxySet, barSeries });
  assert.equal(returns.filter((r) => r !== null).length, set.dates.length);
});

test('mismatches: an edited bar, a missing bar series, and a recomputation error, each named', async () => {
  const { proxySet, barSeries, store } = scenario('A_100_shaped');
  const set = runOf(proxySet, 0, proxySet.dates.length);
  // An edited close inside the run changes the recomputed proxies.
  const [id] = proxySet.bar_series;
  const original = store.get(id);
  const editAt = original.open_time.findIndex((t) => t >= Date.parse('2026-01-20T15:00:00.000Z') / 1000);
  const edited = { ...original, close: original.close.map((c, i) => (i === editAt ? c * 1.001 : c)) };
  store.set(id, edited);
  await assert.rejects(rederiveReturns({ set, proxySet, barSeries }), code('returns_rederivation_mismatch', '2026-01-20 rc'));
  // A missing bar series.
  store.delete(id);
  await assert.rejects(rederiveReturns({ set, proxySet, barSeries }), code('bar_series_not_found', id));
  // Bars that no longer cover the run: the computation's coverage error becomes a mismatch with its cause.
  store.set(id, { ...original, open_time: original.open_time.slice(0, 200), close: original.close.slice(0, 200) });
  await assert.rejects(rederiveReturns({ set, proxySet, barSeries }),
    (error) => code('returns_rederivation_mismatch')(error) && error.message.includes('range_outside_series_coverage'));
  // Other errors pass through.
  const broken = { get: async () => { throw new Error('disk on fire'); } };
  await assert.rejects(rederiveReturns({ set, proxySet, barSeries: broken }), /disk on fire/);
});

test('the checker: −0 equals 0, a permuted return vector is caught, and fields are named in order', () => {
  const run = { dates: ['2026-01-05', '2026-01-06'], windows: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    rc: [[[1, 0.5], [0.5, 2]], null], daily_outer: [[[4, 0], [0, 0]], null], common_slots: [90, 0], expected_slots: [96, 96],
    drop_cause: [null, 'no_endpoint'] };
  const good = { ...run, returns: [[2, 0], null] };
  assert.doesNotThrow(() => checkRederivation(run, good));
  assert.doesNotThrow(() => checkRederivation(run, { ...good, returns: [[2, -0], null], daily_outer: [[[4, -0], [-0, 0]], null] }),
    'a recomputed −0 equals a stored 0');
  assert.throws(() => checkRederivation(run, { ...good, returns: [[0, 2], null] }), code('returns_rederivation_mismatch', '2026-01-05 returns'));
  assert.throws(() => checkRederivation(run, { ...good, returns: [[2, 0], [0, 0]] }), code('returns_rederivation_mismatch', '2026-01-06 returns'));
  assert.throws(() => checkRederivation(run, { ...good, windows: [run.windows[0], { from: 'x', to: 'c' }] }),
    code('returns_rederivation_mismatch', '2026-01-06 window'));
  assert.throws(() => checkRederivation(run, { ...good, rc: [[[1, 0.5], [0.5, 2.5]], null], common_slots: [91, 0] }),
    code('returns_rederivation_mismatch', '2026-01-05 rc'), 'the first field in order');
  assert.throws(() => checkRederivation(run, { ...good, windows: [{ from: 'z', to: 'b' }, run.windows[1]], rc: [[[1, 0.5], [0.5, 2.5]], null] }),
    code('returns_rederivation_mismatch', '2026-01-05 window'), 'the window comes before rc');
  assert.throws(() => checkRederivation(run, { ...good, dates: run.dates.slice(0, 1) }), code('returns_rederivation_mismatch', '2026-01-05 date'));
  for (const [field, value] of [['common_slots', [91, 0]], ['expected_slots', [96, 92]], ['drop_cause', [null, 'no_previous_endpoint']]]) {
    assert.throws(() => checkRederivation(run, { ...good, [field]: value }), (e) => e.code === 'returns_rederivation_mismatch' && e.message.endsWith(field));
  }
});

test('the recomputation uses the resolver the verification used', async () => {
  // A resolver whose wall clock runs an hour ahead moves every boundary. A proxy set computed under it re-derives
  // under it, and not under the default resolver.
  const shifted = { tzdata: 'test-shifted', formatAt: (zone, ms) => intlZoneResolver.formatAt(zone, ms + 3_600_000) };
  const s = RAW.scenarios.find((x) => x.name === 'B_within_day_log');
  const { proxySet, barSeries } = fixture(s.rules, RAW.bar_sets[s.bars], s.from_date, s.to_date, shifted);
  const set = runOf(proxySet, 1, proxySet.dates.length);
  const { returns } = await rederiveReturns({ set, proxySet, barSeries, resolver: shifted });
  assert.equal(returns.length, set.dates.length);
  await assert.rejects(rederiveReturns({ set, proxySet, barSeries }), code('returns_rederivation_mismatch'));
});

test('the run must be a contiguous run of the proxy set', () => {
  const { proxySet } = scenario('A_100_shaped');
  assert.deepEqual(proxyRunOf(proxySet, runOf(proxySet, 1, 4)).dates, proxySet.dates.slice(1, 4));
  assert.throws(() => proxyRunOf(proxySet, { dates: ['1999-01-01'] }), code('returns_rederivation_mismatch', '1999-01-01 date'));
  assert.throws(() => proxyRunOf(proxySet, { dates: [proxySet.dates[1], proxySet.dates[3]] }), code('returns_rederivation_mismatch'));
});
