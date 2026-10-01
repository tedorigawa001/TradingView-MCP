#!/usr/bin/env node
// Performance check for backtest_risk_forecast (docs/RISK_FORECAST_BACKTEST_PLAN.md, step 7). Kept out of the unit
// suite so the suite never depends on timing. Run after `npm run build`:
//   node scripts/benchmark-risk-backtest.mjs
// 8 series of 24-hour M15 bars over about 4,000 Mon-Fri days, a proxy set, a joined forecast set of 8x8 matrices, then
// the tool's stages timed one by one: the set read and its verification against the proxy set, the re-derivation of the
// returns from the bars, the evaluation (Monte Carlo included) and the journal write. Both forecasts have 30 own nulls,
// within the cap of 40, so all ten Monte Carlo streams are drawn: the worst case. Synthetic data in mkdtemp only.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRandom } from '../build/seededRandom.js';
import { BarSeriesStore } from '../build/barSeries.js';
import { ProxySetStore, buildProxySetForecastSet, normalizeProxySet, verifyForecastSetAgainstProxySet } from '../build/proxySet.js';
import { ForecastSetStore, forecastSetComponentHashes } from '../build/forecastSet.js';
import { RealizedCovarianceJournalStore } from '../build/realizedCovarianceJournal.js';
import { computeRealizedCovariance } from '../build/realizedCovariance.js';
import { canonicalizeRules } from '../build/realizedCovarianceRules.js';
import { backtestRiskForecast, normalizeWeights } from '../build/riskForecastBacktest.js';
import { rederiveReturns, proxyRunOf } from '../build/riskReturnRederivation.js';
import { RiskBacktestJournalStore } from '../build/riskBacktestJournal.js';

const N = 8;
const { rules, rules_sha256 } = canonicalizeRules({ interval_minutes: 15, time_zone: 'America/New_York', day_end_local: '16:45',
  day_weekdays: [1, 2, 3, 4, 5], max_missing_slots: 6, first_interval: 'from_previous_endpoint', return_unit: 'log_percent' });
const FROM = '2010-11-02', TO = '2026-03-02';
const random = createRandom(1);
const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

// 24-hour M15 bars without the weekend, as in the realized-covariance benchmark.
const start = Date.UTC(2010, 9, 28, 0, 0) / 1000, end = Date.UTC(2026, 2, 3, 0, 0) / 1000;
const open_time = [];
for (let t = start; t < end; t += 900) {
  const local = new Date((t - 5 * 3600) * 1000);
  const day = local.getUTCDay(), minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const weekend = (day === 5 && minute >= 16 * 60 + 45) || day === 6 || (day === 0 && minute < 17 * 60);
  if (!weekend) open_time.push(t);
}
const seriesInput = (i) => {
  let log = Math.log(1 + i * 0.1);
  const close = open_time.map(() => (log += 5e-4 * normal(), Number(Math.exp(log).toPrecision(6))));
  return { schema_version: '1.0', source_id: `benchmark-${i}`, source_sha256: 'sha256:' + '0'.repeat(64),
    evidence_tier: 'synthetic_test', series_id: `bench:${i}`, interval_minutes: 15, open_time, close };
};

const directory = await mkdtemp(join(tmpdir(), 'risk-backtest-benchmark-'));
const rows = [];
const time = async (label, run) => {
  const started = performance.now();
  const value = await run();
  rows.push([label, performance.now() - started]);
  return value;
};
try {
  const barSeries = new BarSeriesStore(join(directory, 'bars'));
  const proxySets = new ProxySetStore(join(directory, 'proxy'));
  const rcJournal = new RealizedCovarianceJournalStore(join(directory, 'rc.jsonl'));
  const ids = [];
  for (let i = 0; i < N; i++) ids.push((await barSeries.register(seriesInput(i))).artifact_id);
  const series = [];
  for (const artifact_id of ids) series.push({ artifact_id, bars: await barSeries.get(artifact_id) });
  const computed = computeRealizedCovariance({ rules, rules_sha256, from_date: FROM, to_date: TO, series });
  const { set: proxy, artifact_id: proxySetId } = normalizeProxySet(computed.proxy);
  await proxySets.register(proxy);
  await rcJournal.record({ rules, rules_sha256, bar_series: ids, underlying_series_ids: proxy.underlying_series_ids, from_date: FROM, to_date: TO,
    proxy_set_id: proxySetId, research_id: null, tzdata: computed.tzdata, kept_days: computed.summary.kept_days,
    dropped_days: computed.summary.produced_days - computed.summary.kept_days, envelope: computed.envelope });
  // A: yesterday's realized covariance plus a ridge; B: a constant matrix. Both positive-definite.
  const ridge = (m) => m.map((row, i) => row.map((x, j) => (i === j ? x + 1e-4 : x)));
  const fallback = proxy.rc.find((v) => v !== null);
  const constant = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0.02 : 0.002)));
  const deps = { proxySets, journal: rcJournal };
  const joined = await buildProxySetForecastSet(proxySetId, { schema_version: '1.0', evidence_tier: 'synthetic_test',
    from_date: proxy.dates[0], to_date: proxy.dates[proxy.dates.length - 1],
    a: proxy.rc.map((_, d) => (d % 131 === 7 ? null : ridge(proxy.rc[d - 1] ?? fallback))),
    b: proxy.rc.map((_, d) => (d % 131 === 60 ? null : constant)) }, deps);
  const sets = new ForecastSetStore(join(directory, 'sets'));
  const { artifact_id } = await sets.register(joined);

  const set = await time('read the forecast set and verify it against the proxy set', async () => {
    const loaded = await sets.get(artifact_id);
    await verifyForecastSetAgainstProxySet(loaded, deps);
    return loaded;
  });
  const { returns, span } = await time('re-derive the returns from the bars (target 3 s)', () => rederiveReturns({ set, proxySet: proxy, barSeries }));
  const weights = normalizeWeights(Array.from({ length: N }, () => 1), N);
  const result = await time('evaluate, Monte Carlo included (target 4 s)', () => backtestRiskForecast({ dates: set.dates,
    dropCause: proxyRunOf(proxy, set).drop_cause, returns, rc: set.primary, forecasts: [set.a, set.b], weights, targetValue: 10,
    returnUnit: 'log_percent', weekdays: 5 }));
  const journal = new RiskBacktestJournalStore(join(directory, 'risk.jsonl'));
  const hashes = forecastSetComponentHashes(set);
  await time('journal the call', () => journal.record({ research_id: null, forecast_set_id: artifact_id, proxy_set_id: proxySetId,
    rules_sha256, bar_series: ids, underlying_series_ids: set.underlying_series_ids, run: { from_date: set.dates[0], to_date: set.dates[set.dates.length - 1] },
    span, a_sha256: hashes.a, b_sha256: hashes.b, weights, target: { value: 10, unit: 'log_percent' }, forecasts: null, outcome: 'not_evaluable' }));
  const total = rows.reduce((sum, [, ms]) => sum + ms, 0);
  console.log(`bars: ${N} series x ${open_time.length}; run: ${set.dates.length} dates, ${result.days.return_dates} with a return, ` +
    `outcome ${result.days.outcome}; forecasts ${result.forecasts?.a.status}/${result.forecasts?.b.status}, ` +
    `own nulls ${result.forecasts?.a.own_nulls}/${result.forecasts?.b.own_nulls}`);
  for (const [label, ms] of rows) console.log(`${label}: ${ms.toFixed(0)} ms`);
  console.log(`the whole call (target 8 s): ${total.toFixed(0)} ms`);
  const misses = [['re-derive', 3000], ['evaluate', 4000]].filter(([prefix, limit]) => rows.find(([label]) => label.startsWith(prefix))[1] >= limit);
  if (total >= 8000) misses.push(['whole call', 8000]);
  console.log(misses.length ? `MISSED: ${misses.map(([name, limit]) => `${name} >= ${limit} ms`).join('; ')}` : 'all targets met');
} finally {
  await rm(directory, { recursive: true, force: true });
}
