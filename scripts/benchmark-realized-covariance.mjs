#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRandom } from '../build/seededRandom.js';
import { BarSeriesStore } from '../build/barSeries.js';
import { ProxySetStore, buildProxySetForecastSet, normalizeProxySet, verifyProxySet } from '../build/proxySet.js';
import { ForecastSetStore, FORECAST_SET_MAX_BYTES, normalizeForecastSet } from '../build/forecastSet.js';
import { RealizedCovarianceJournalStore, REALIZED_COVARIANCE_JOURNAL_MAX_BYTES } from '../build/realizedCovarianceJournal.js';
import { computeRealizedCovariance } from '../build/realizedCovariance.js';
import { canonicalizeRules, planCalendar } from '../build/realizedCovarianceRules.js';

// docs/REALIZED_COVARIANCE_PLAN.md section 4: compute at 8 series x 5,000 Mon-Fri days of M15, the join at
// 4,000 dates, and the verification against a journal near its 32 MiB cap. Synthetic data in mkdtemp only.
const N = 8, JOIN_DATES = 4000;
const { rules, rules_sha256 } = canonicalizeRules({ interval_minutes: 15, time_zone: 'America/New_York', day_end_local: '16:45',
  day_weekdays: [1, 2, 3, 4, 5], max_missing_slots: 6, first_interval: 'from_previous_endpoint', return_unit: 'log_percent' });
const FROM = '2007-01-02', TO = '2026-03-02';   // 5,000 weekdays
const random = createRandom(1);
const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

// 24-hour M15 bars without the weekend. The generator skips Friday 16:45 to Sunday 17:00 at a fixed UTC-5,
// so in summer the first Sunday hour is also absent: 4 missing slots on Mondays, within max_missing_slots.
const start = Date.UTC(2006, 11, 29, 0, 0) / 1000, end = Date.UTC(2026, 2, 3, 0, 0) / 1000;
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

const directory = await mkdtemp(join(tmpdir(), 'realized-covariance-benchmark-'));
const rows = [];
const time = async (label, run) => {
  const started = performance.now();
  const value = await run();
  rows.push([label, performance.now() - started]);
  return value;
};
try {
  const bars = new BarSeriesStore(join(directory, 'bars'));
  const proxySets = new ProxySetStore(join(directory, 'proxy'));
  const journal = new RealizedCovarianceJournalStore(join(directory, 'journal.jsonl'));
  const inputs = Array.from({ length: N }, (_, i) => seriesInput(i));
  const ids = await time(`import ${N} series of ${open_time.length} bars`, async () => {
    const out = [];
    for (const input of inputs) out.push((await bars.register(input)).artifact_id);
    return out;
  });
  const series = await time('read and verify the bar series', async () => {
    const out = [];
    for (const artifact_id of ids) out.push({ artifact_id, bars: await bars.get(artifact_id) });
    return out;
  });
  const result = await time('compute', () => computeRealizedCovariance({ rules, rules_sha256, from_date: FROM, to_date: TO, series }));
  const { set, artifact_id: proxySetId, bytes } = await time('normalize the proxy set', () => normalizeProxySet(result.proxy));
  await time('store the proxy set', () => proxySets.register(set));

  // A journal filled to about 30 MiB of other records, then this computation's record through the store.
  const exposure = { rules, rules_sha256, bar_series: ids, underlying_series_ids: set.underlying_series_ids, from_date: FROM, to_date: TO,
    research_id: null, tzdata: result.tzdata, kept_days: result.summary.kept_days,
    dropped_days: result.summary.produced_days - result.summary.kept_days, envelope: result.envelope };
  const now = new Date().toISOString();
  const line = (i) => JSON.stringify({ schema_version: '1.0', namespace: 'realized_covariance_computation', sequence: i + 1,
    observation_date: now.slice(0, 10), first_seen_at: now, algorithm_version: 'realized_covariance_v1', ...exposure,
    proxy_set_id: `sha256:${i.toString(16).padStart(64, '0')}` });
  const perLine = Buffer.byteLength(line(0)) + 1;
  const filler = Math.floor(30 * 2 ** 20 / perLine);
  await writeFile(join(directory, 'journal.jsonl'), Array.from({ length: filler }, (_, i) => line(i)).join('\n') + '\n', { mode: 0o600 });
  await time(`journal the computation (after ${filler} records)`, () => journal.record({ ...exposure, proxy_set_id: proxySetId }));

  const deps = { proxySets, journal };
  await time(`re-derive ${result.proxy.dates.length} days alone (target 500 ms)`, () => planCalendar(rules, FROM, TO));
  await time('verify the proxy set end to end (target 1 s)', () => verifyProxySet(proxySetId, deps));
  const forecasts = (count) => ({ schema_version: '1.0', evidence_tier: 'synthetic_test', from_date: set.dates[0], to_date: set.dates[count - 1],
    a: set.dates.slice(0, count).map(() => set.rc.find((v) => v !== null)), b: set.dates.slice(0, count).map(() => set.rc.find((v) => v !== null)) });
  const joined = await time(`build the join of ${JOIN_DATES} dates`, () => buildProxySetForecastSet(proxySetId, forecasts(JOIN_DATES), deps));
  const store = new ForecastSetStore(join(directory, 'sets'));
  const registered = await time(`register the joined set`, () => store.register(joined));
  const joinedBytes = Buffer.byteLength(JSON.stringify(await store.get(registered.artifact_id)));
  const full = normalizeForecastSet(await buildProxySetForecastSet(proxySetId, forecasts(set.dates.length), deps), { maxBytes: Infinity });

  const mib = (x) => (x / 2 ** 20).toFixed(1);
  console.log(`bars: ${N} series x ${open_time.length} = ${N * open_time.length} closes`);
  console.log(`days: ${result.summary.produced_days} produced, ${result.summary.kept_days} kept, dropped ${JSON.stringify(result.summary.dropped)}`);
  console.log(`proxy set: ${mib(bytes)} MiB; journal: ${mib(filler * perLine)} MiB of ${mib(REALIZED_COVARIANCE_JOURNAL_MAX_BYTES)} MiB`);
  console.log(`joined set: ${JOIN_DATES} dates ${mib(joinedBytes)} MiB; all ${set.dates.length} dates would be ${mib(full.bytes)} MiB; limit ${mib(FORECAST_SET_MAX_BYTES)} MiB`);
  for (const [label, ms] of rows) console.log(`${label}: ${ms.toFixed(0)} ms`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
