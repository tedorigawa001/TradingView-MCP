import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProxySetStore, verifyForecastSetAgainstProxySet } from '../../build/proxySet.js';
import { importForecastSet } from '../../build/forecastSetCli.js';
import { ForecastSetStore, normalizeForecastSet } from '../../build/forecastSet.js';
import { RealizedCovarianceJournalStore } from '../../build/realizedCovarianceJournal.js';
import { computeRealizedCovariance } from '../../build/realizedCovariance.js';
import { addDays, canonicalizeRules } from '../../build/realizedCovarianceRules.js';
import { normalizeBarSeries } from '../../build/barSeries.js';
import { intlZoneResolver } from '../../build/zonedTime.js';

// The --proxy-set join and the compare-side check (docs/REALIZED_COVARIANCE_PLAN.md, step 7). Proxy sets are
// computed from the reference fixture's synthetic bars.
const RAW = JSON.parse(await readFile(new URL('../fixtures/realized-covariance/reference.json', import.meta.url), 'utf8'));
const artifact = (i) => `sha256:${String(i).padStart(64, '0')}`;
function compute(name) {
  const scenario = RAW.scenarios.find((s) => s.name === name);
  const { rules, rules_sha256 } = canonicalizeRules(scenario.rules);
  const series = RAW.bar_sets[scenario.bars].map((s, i) => ({ artifact_id: artifact(i), bars: normalizeBarSeries({ schema_version: '1.0',
    source_id: 'reference', source_sha256: 'sha256:' + 'a'.repeat(64), evidence_tier: 'synthetic_test', series_id: s.series_id,
    interval_minutes: scenario.rules.interval_minutes, open_time: s.open_time, close: s.close }).series }));
  return computeRealizedCovariance({ rules, rules_sha256, from_date: scenario.from_date, to_date: scenario.to_date, series });
}
let inputs = 0;
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'proxy-set-join-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stores = { directory, sets: join(directory, 'sets'), store: new ForecastSetStore(join(directory, 'sets')),
    proxySets: new ProxySetStore(join(directory, 'proxy')), journal: new RealizedCovarianceJournalStore(join(directory, 'journal.jsonl')) };
  /** Stores the proxy set and, unless told not to, journals it as compute_realized_covariance would. */
  stores.proxy = async (name, { journaled = true } = {}) => {
    const result = compute(name);
    const { artifact_id: id } = await stores.proxySets.register(result.proxy);
    if (journaled) {
      await stores.journal.record({ rules: result.proxy.rules, rules_sha256: result.proxy.rules_sha256, bar_series: result.proxy.bar_series,
        underlying_series_ids: result.proxy.underlying_series_ids, from_date: result.proxy.from_date, to_date: result.proxy.to_date,
        proxy_set_id: id, research_id: null, tzdata: result.tzdata, kept_days: result.summary.kept_days,
        dropped_days: result.summary.produced_days - result.summary.kept_days, envelope: result.envelope });
    }
    return { id, proxy: result.proxy };
  };
  stores.join = async (id, input, args = ['--confirm-local-import'], resolver) => {
    const path = join(directory, `input-${inputs++}.json`);
    await writeFile(path, JSON.stringify(input));
    return importForecastSet(['--proxy-set', id, '--input', path, ...args],
      { store: stores.store, proxySets: stores.proxySets, journal: stores.journal, resolver });
  };
  return stores;
}
const diagonal = (n, x) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? x * (i + 1) : 0)));
function forecasts(proxy, start, end, patch = {}) {
  const n = proxy.bar_series.length, count = end - start + 1;
  return { schema_version: '1.0', evidence_tier: 'historical_exploration', from_date: proxy.dates[start], to_date: proxy.dates[end],
    a: Array.from({ length: count }, (_, i) => (i === 3 ? null : diagonal(n, 1e-3 * (i + 1)))),
    b: Array.from({ length: count }, (_, i) => (i === 5 ? null : diagonal(n, 2e-3 * (i + 1)))), ...patch };
}
const code = (c) => (error) => error.code === c;

test('a contiguous run with explicit nulls joins to a verified proxy-set source (D3, F2)', async (t) => {
  const stores = await setup(t);
  const { id, proxy } = await stores.proxy('A_100_shaped');
  const input = forecasts(proxy, 2, 12, { labels: Array.from({ length: 11 }, (_, i) => (i % 2 ? 'odd' : 'even')) });
  const result = await stores.join(id, input);
  assert.deepEqual([result.dates, result.n], [11, 2]);
  const set = await stores.store.get(result.artifact_id);
  const run = (list) => list.slice(2, 13);
  assert.deepEqual([set.source_id, set.source_sha256, set.evidence_tier, set.horizon, set.n],
    [`proxy-set:${id.slice(7)}`, id, 'historical_exploration', 1, 2]);
  assert.deepEqual(set.underlying_series_ids, proxy.underlying_series_ids);
  assert.deepEqual(set.dates, run(proxy.dates));
  assert.deepEqual(set.windows, run(proxy.windows));
  assert.deepEqual(set.primary, run(proxy.rc));
  assert.deepEqual(set.secondary, run(proxy.daily_outer));
  assert.deepEqual([set.a, set.b, set.labels], [input.a, input.b, input.labels]);
  // Dropped days in the run stay as null proxies; the caller's nulls stay as given.
  assert.deepEqual(set.primary.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0), [4, 5, 10]);
  assert.deepEqual([set.a[3], set.b[5]], [null, null]);
  // Monday's realized window starts at Friday's endpoint, three days back: only the relaxed rule admits it.
  assert.ok(set.windows.some((w, i) => w.from.slice(0, 10) === addDays(set.dates[i], -3)));
  assert.deepEqual(await verifyForecastSetAgainstProxySet(set, stores), proxy);
  // Without labels the set has none; the whole range joins too.
  const whole = await stores.store.get((await stores.join(id, forecasts(proxy, 0, proxy.dates.length - 1))).artifact_id);
  assert.deepEqual([whole.labels, whole.dates], [null, proxy.dates]);
});

test('Tokyo 07:00 windows start on UTC date D − 2 or earlier and join under the relaxed rule (Q6)', async (t) => {
  const stores = await setup(t);
  const { id, proxy } = await stores.proxy('D_tokyo_0700');
  assert.ok(proxy.windows.every((w, i) => w.from.slice(0, 10) <= addDays(proxy.dates[i], -2)));
  assert.ok(proxy.windows.some((w, i) => w.from.slice(0, 10) === addDays(proxy.dates[i], -4)), 'Monday starts at Thursday 22:00Z');
  const set = await stores.store.get((await stores.join(id, forecasts(proxy, 0, proxy.dates.length - 1))).artifact_id);
  assert.equal(set.n, 3);
  assert.deepEqual(set.windows, proxy.windows);
});

test('join errors: the range, the lengths, identical series and the verification; nothing is stored (Q12, H1)', async (t) => {
  const stores = await setup(t);
  const { id, proxy } = await stores.proxy('A_100_shaped');
  const last = proxy.dates.length - 1;
  const cases = [
    [forecasts(proxy, 0, 4, { from_date: '2026-01-10' }), code('join_range_not_contiguous')],   // a Saturday: not a produced date
    [forecasts(proxy, 0, 4, { from_date: proxy.dates[5] }), code('join_range_not_contiguous')],   // after to_date
    [forecasts(proxy, 0, 4, { to_date: '2026-02-02' }), code('join_range_not_contiguous')],   // beyond the proxy set
    [{ ...forecasts(proxy, 0, 4), a: forecasts(proxy, 0, 3).a }, /join_length_mismatch: a has 4 entries for the 5 dates/],
    [{ ...forecasts(proxy, 0, 4), b: forecasts(proxy, 0, 5).b }, /join_length_mismatch: b has 6 entries for the 5 dates/],
    [forecasts(proxy, 0, 4, { labels: ['x', 'y'] }), /join_length_mismatch: labels has 2 entries/],
    [forecasts(proxy, 0, 1, { a: [1, 2] }), /is a scalar but n = 2/],
    // Proxy dates 6 and 7 are both dropped (a holiday and the day after it), and so is 6 alone.
    [forecasts(proxy, 6, 7, { a: [null, null], b: [null, null] }), /join_run_has_no_kept_day: every date from 2026-01-14 to 2026-01-15/],
    [forecasts(proxy, 6, 6, { a: [null], b: [null] }), code('join_run_has_no_kept_day')],
    [{ ...forecasts(proxy, 0, 1), source_id: 'x' }, /unrecognized|source_id/i],
  ];
  for (const [input, expected] of cases) await assert.rejects(stores.join(id, input), expected, JSON.stringify(input).slice(0, 120));
  await assert.rejects(stores.join('sha256:' + 'f'.repeat(64), forecasts(proxy, 0, 1)), code('proxy_set_not_found'));
  const unjournaled = await stores.proxy('E_tuesday_to_friday', { journaled: false });
  await assert.rejects(stores.join(unjournaled.id, forecasts(unjournaled.proxy, 0, 1)), code('proxy_set_not_journaled'));
  const identical = await stores.proxy('G_identical_pair');
  await assert.rejects(stores.join(identical.id, forecasts(identical.proxy, 0, 1)),
    (error) => error.code === 'proxy_set_has_identical_series' && /fx:S0 and fx:S0copy/.test(error.message));
  // A proxy set whose series uses an entry-reserved prefix can only come from the store API, and is refused too.
  const reserved = compute('A_100_shaped');
  reserved.proxy.underlying_series_ids = ['proxy-set-source:x', 'fx:USDJPY'];
  const { artifact_id: reservedId } = await stores.proxySets.register(reserved.proxy);
  await stores.journal.record({ rules: reserved.proxy.rules, rules_sha256: reserved.proxy.rules_sha256, bar_series: reserved.proxy.bar_series,
    underlying_series_ids: reserved.proxy.underlying_series_ids, from_date: reserved.proxy.from_date, to_date: reserved.proxy.to_date,
    proxy_set_id: reservedId, research_id: null, tzdata: reserved.tzdata, kept_days: reserved.summary.kept_days,
    dropped_days: reserved.summary.produced_days - reserved.summary.kept_days, envelope: reserved.envelope });
  await assert.rejects(stores.join(reservedId, forecasts(reserved.proxy, 0, 1)), /reserved prefix/);
  await assert.rejects(stores.join(id, forecasts(proxy, 0, last), []), /--confirm-local-import are required/);
  // The injected resolver reaches the verification: tzdata drift that moves the boundaries fails closed (H4, H6).
  const shifted = { tzdata: 'test-2099z', formatAt: (zone, ms) => intlZoneResolver.formatAt(zone, ms + 3_600_000) };
  await assert.rejects(stores.join(id, forecasts(proxy, 0, 1), undefined, shifted), code('proxy_set_windows_changed_under_current_tzdata'));
  await assert.rejects(readdir(stores.sets), { code: 'ENOENT' }, 'no forecast set was stored');
});

test('the compare-side check: a verified contiguous run passes; any difference is proxy_set_mismatch (F2, R2)', async (t) => {
  const stores = await setup(t);
  const { id, proxy } = await stores.proxy('A_100_shaped');
  const joined = (await stores.store.get((await stores.join(id, forecasts(proxy, 2, 12))).artifact_id));
  const variant = (patch) => normalizeForecastSet({ ...joined, labels: undefined, ...patch }).set;
  const check = (set) => verifyForecastSetAgainstProxySet(set, stores);
  // The caller's own forecasts and labels are free, and a later run of the same proxy set passes.
  await check(variant({ a: joined.a.map(() => diagonal(2, 5e-3)), labels: joined.dates.map(() => 'L') }));
  await check(variant(Object.fromEntries(['dates', 'windows', 'a', 'b', 'primary', 'secondary'].map((k) => [k, joined[k].slice(4)]))));
  const drop = (i) => Object.fromEntries(['dates', 'windows', 'a', 'b', 'primary', 'secondary'].map((k) => [k, joined[k].filter((_, j) => j !== i)]));
  const kept = joined.primary.findIndex((v) => v !== null);
  const edit = (list) => list.map((v, i) => (i === kept ? v.map((row) => row.map((x) => x * 1.001)) : v));
  const cases = [
    ['another proxy set in source_sha256', { source_sha256: 'sha256:' + 'e'.repeat(64) }, /different proxy sets/],
    ['a deleted date', drop(3), /not a contiguous run/],
    ['a shifted first date', { dates: joined.dates.map((d, i) => (i === 0 ? '2026-01-07' : d)) }, /not a contiguous run/],
    ['an edited primary', { primary: edit(joined.primary) }, /in primary$/],
    ['an edited secondary', { secondary: edit(joined.secondary) }, /in secondary$/],
    ['no secondary', { secondary: undefined }, /in secondary$/],
    ['a moved window', { windows: joined.windows.map((w, i) => (i === 1 ? { ...w, from: w.from.replace('21:45', '22:00') } : w)) }, /in windows$/],
    ['renamed series', { underlying_series_ids: ['fx:EURUSD', 'fx:GBPUSD'] }, /in underlying_series_ids$/],
  ];
  for (const [name, patch, pattern] of cases) {
    await assert.rejects(check(variant(patch)), (error) => error.code === 'proxy_set_mismatch' && pattern.test(error.message), name);
  }
  // A source whose hex is not a proxy set in the store fails at the verification, before any comparison.
  await assert.rejects(check(variant({ source_id: 'proxy-set:' + 'f'.repeat(64), source_sha256: 'sha256:' + 'f'.repeat(64) })),
    code('proxy_set_not_found'));
});
