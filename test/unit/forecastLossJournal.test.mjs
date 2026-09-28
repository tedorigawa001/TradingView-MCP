import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile, rm, stat, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ForecastLossJournalStore, forecastSetEnvelope, summarizePriorOverlap, PRIOR_OVERLAP_RESEARCH_ID_CAP,
  FORECAST_LOSS_JOURNAL_MAX_BYTES } from '../../build/forecastLossJournal.js';
import { BACKTEST_LEDGER_MAX_BYTES } from '../../build/backtestLedger.js';
import { normalizeForecastSet } from '../../build/forecastSet.js';
import { ResearchPeriodUsageStore } from '../../build/researchPeriodUsage.js';

const sha = (text) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const day = (i) => new Date(Date.UTC(2021, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

/** A small synthetic scalar set; each option changes exactly the component it names. */
function makeSet({ series = ['fx:EURUSD'], start = 0, days = 30, aScale = 1.1, bScale = 0.9, primaryScale = 1,
  secondary = false, labels = false, source = 'synthetic-source' } = {}) {
  const idx = Array.from({ length: days }, (_, i) => start + i);
  const p = idx.map((i) => 1 + (i % 7) / 10);
  const normalized = normalizeForecastSet({
    schema_version: '1.0', source_id: source, source_sha256: sha(source), evidence_tier: 'synthetic_test',
    horizon: 1, n: 1, underlying_series_ids: series, dates: idx.map(day),
    windows: idx.map((i) => ({ from: `${day(i - 1)}T22:00:00.000Z`, to: `${day(i)}T22:00:00.000Z` })),
    a: p.map((x) => x * aScale), b: p.map((x) => x * bScale), primary: p.map((x) => x * primaryScale),
    ...(secondary ? { secondary: p.map((x, i) => x * (1 + (i % 3))) } : {}),
    ...(labels ? { labels: idx.map((i) => (i % 2 ? 'odd' : 'even')) } : {}),
  });
  return normalized;
}
const exposure = (research_id, options = {}, extra = {}) => {
  const { set, artifact_id } = makeSet(options);
  return { research_id, artifact_id, set, loss: 'qlike', battery_outcome: 'conflicts_found', ...extra };
};
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forecast-loss-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'journal.jsonl');
  return { directory, path, store: new ForecastLossJournalStore(path) };
}
const saved = async (path) => (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);

test('one record per call with the design fields (M2), owner-only', async (t) => {
  const { path, store } = await setup(t);
  const call = exposure('research:1', { series: ['fx:USDJPY', 'fx:EURUSD'].slice(0, 1), labels: true });
  const result = await store.record(call);
  const [record] = await saved(path);
  assert.deepEqual(Object.keys(record), ['schema_version', 'namespace', 'sequence', 'observation_date', 'first_seen_at',
    'contract', 'loss', 'research_id', 'artifact_id', 'component_hashes', 'source_hash', 'underlying_series_ids',
    'envelope', 'battery_outcome']);
  assert.equal(record.namespace, 'forecast_loss_comparison_exploration');
  assert.equal(record.contract, 'forecast_loss_comparison_v1');
  assert.equal(record.artifact_id, call.artifact_id);
  // The raw source_id digest, the same one the period record's forecast-set-source: series uses (L5).
  assert.equal(record.source_hash, sha('synthetic-source'));
  assert.equal(record.component_hashes.a, sha(JSON.stringify(call.set.a)));
  assert.equal(record.component_hashes.secondary, 'absent');
  assert.equal(record.component_hashes.labels, sha(JSON.stringify(call.set.labels)));
  assert.deepEqual(record.envelope, { from: '2020-12-31T22:00:00.000Z', to: '2021-01-30T22:00:00.000Z' });
  assert.deepEqual(record.envelope, forecastSetEnvelope(call.set));
  assert.equal(record.battery_outcome, 'conflicts_found');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(result.this_research_id, { calls: 1, distinct_a_for_same_b_primary_dates: 1, distinct_label_sets: 1,
    distinct_secondaries: 1, distinct_losses: 1, earlier_no_listed_conflict: 0 });
  assert.equal(result.overlapping_data.calls, 1);
  assert.equal(result.sequence, 1);
});

test('series IDs are stored sorted, so the key does not depend on artifact order', async (t) => {
  const { path, store } = await setup(t);
  const { set, artifact_id } = normalizeForecastSet({
    schema_version: '1.0', source_id: 'm', source_sha256: sha('m'), evidence_tier: 'synthetic_test', horizon: 1, n: 2,
    underlying_series_ids: ['fx:USDJPY', 'fx:EURUSD'], dates: [day(0), day(1)],
    windows: [0, 1].map((i) => ({ from: `${day(i)}T00:00:00.000Z`, to: `${day(i)}T23:00:00.000Z` })),
    a: [[[2, 0], [0, 2]], [[2, 0], [0, 2]]], b: [[[1, 0], [0, 1]], [[1, 0], [0, 1]]], primary: [[[1, 0], [0, 1]], [[1, 0], [0, 1]]],
  });
  await store.record({ research_id: 'r', artifact_id, set, loss: 'mse', battery_outcome: 'not_evaluable' });
  assert.deepEqual((await saved(path))[0].underlying_series_ids, ['fx:EURUSD', 'fx:USDJPY']);
});

test('this research_id: calls across artifacts, A variants on the same base, labels, secondaries, losses', async (t) => {
  const { store } = await setup(t);
  await store.record(exposure('r1', {}, { battery_outcome: 'no_listed_conflict' }));
  await store.record(exposure('r1', { aScale: 1.2 }));                                // another A, same base
  await store.record(exposure('r1', { aScale: 1.3, bScale: 0.8 }));                   // another base: not counted
  await store.record(exposure('r1', { secondary: true }, { loss: 'mse' }));
  // Seven days later the values repeat (they depend on the day index mod 7), so B and primary hash the
  // same while the dates do not: another base.
  await store.record(exposure('r1', { start: 7, aScale: 1.6 }));
  await store.record(exposure('other', { aScale: 1.4 }, { battery_outcome: 'no_listed_conflict' }));
  const last = await store.record(exposure('r1', { aScale: 1.5, labels: true }, { battery_outcome: 'no_listed_conflict' }));
  assert.deepEqual(last.this_research_id, {
    calls: 6,
    // A = 1.1 (twice), 1.2 and 1.5 on B 0.9 with the same primary and dates; 1.3 has another B and
    // 1.6 other dates.
    distinct_a_for_same_b_primary_dates: 3,
    distinct_label_sets: 2,
    distinct_secondaries: 2,         // absent counts as one
    distinct_losses: 2,
    earlier_no_listed_conflict: 1,   // this call's own outcome and the other research ID are not counted
  });
  assert.equal(last.overlapping_data.calls, 7, 'the overlap set includes the same research ID');
  assert.equal(last.overlapping_data.distinct_research_ids, 2);
});

test('the overlap set is keyed by series and envelope, not hashes, across research IDs', async (t) => {
  const { store } = await setup(t);
  // A fresh research_id per variant, and variants that change every hash, still land in the set.
  await store.record(exposure('v1', {}, { battery_outcome: 'no_listed_conflict' }));
  await store.record(exposure('v2', { start: 1, days: 29 }));                   // one date dropped
  await store.record(exposure('v3', { primaryScale: 2 }));                      // proxy rescaled
  await store.record(exposure('v4', { aScale: 0.9, bScale: 1.1 }));             // A and B swapped
  await store.record(exposure('v5', { source: 'another-source' }));             // another source, same data
  // Outside the set: another series on the same dates, and the same series on disjoint dates.
  await store.record(exposure('x1', { series: ['fx:GBPUSD'] }, { battery_outcome: 'no_listed_conflict' }));
  await store.record(exposure('x2', { start: 30 }, { battery_outcome: 'no_listed_conflict' }));
  const result = await store.record(exposure('v6', { start: 29, days: 30 }, { battery_outcome: 'no_listed_conflict' }));
  assert.deepEqual(result.overlapping_data, {
    key: 'shared_underlying_series_id_and_envelope_overlap',
    calls: 7,                        // v1–v5, x2 (it overlaps v6's range) and this call
    distinct_research_ids: 7,
    earlier_no_listed_conflict: 2,   // v1 and x2, not this call
    // v1, v3, v4 and v5 share one {A, B} pair (v4 is the swap); v2, x2 and v6 each cover other dates.
    distinct_unordered_ab_pairs: 4,
    distinct_b: 5,                   // v1 (with v3, v5), v4, v2, x2, v6
    distinct_dates: 4,               // v1 (with v3, v4, v5), v2, x2, v6
    distinct_primary: 5,             // v1 (with v4, v5), v3, v2, x2, v6
  });
});

test('envelopes are half-open: touching end to start is not an overlap; one shared series is enough', async (t) => {
  const { store } = await setup(t);
  await store.record(exposure('a', { series: ['fx:EURUSD'], start: 0, days: 10 }));
  // Its first window starts at day 9 22:00, exactly where the previous envelope ends.
  const touching = await store.record(exposure('b', { series: ['fx:EURUSD'], start: 10, days: 10 }));
  assert.equal(touching.overlapping_data.calls, 1);
  const { set, artifact_id } = normalizeForecastSet({
    schema_version: '1.0', source_id: 'pair', source_sha256: sha('pair'), evidence_tier: 'synthetic_test', horizon: 1, n: 2,
    underlying_series_ids: ['fx:GBPUSD', 'fx:EURUSD'], dates: [day(5)],
    windows: [{ from: `${day(5)}T00:00:00.000Z`, to: `${day(5)}T23:00:00.000Z` }],
    a: [[[2, 0], [0, 2]]], b: [[[1, 0], [0, 1]]], primary: [[[1, 0], [0, 1]]],
  });
  const shared = await store.record({ research_id: 'c', artifact_id, set, loss: 'qlike', battery_outcome: 'not_evaluable' });
  assert.equal(shared.overlapping_data.calls, 2);
  // And the reverse: a one-series call overlaps the earlier two-series record through the shared ID.
  const single = await store.record(exposure('d', { series: ['fx:GBPUSD'], start: 5, days: 1 }));
  assert.equal(single.overlapping_data.calls, 2);
});

test('an artifact ID recorded with different content fails closed without appending', async (t) => {
  const { path, store } = await setup(t);
  const first = exposure('r');
  await store.record(first);
  const before = await readFile(path, 'utf8');
  const forged = { ...first, set: makeSet({ aScale: 1.7 }).set };
  await assert.rejects(store.record(forged), /artifact metadata mismatch/);
  assert.equal(await readFile(path, 'utf8'), before);
});

test('a torn or edited journal fails closed', async (t) => {
  const { path, store } = await setup(t);
  await store.record(exposure('r'));
  await appendFile(path, '{"schema_version":"1.0"');
  await assert.rejects(store.record(exposure('r')), /framing/);
  const lines = (await readFile(path, 'utf8')).split('\n');
  const record = JSON.parse(lines[0]);
  await writeFile(path, JSON.stringify({ ...record, underlying_series_ids: ['z', 'a'] }) + '\n');
  await assert.rejects(store.record(exposure('r')), /sorted and unique/);
  await writeFile(path, JSON.stringify({ ...record, battery_outcome: 'passed' }) + '\n');
  await assert.rejects(store.record(exposure('r')));
});

test('prior_overlap summary: per-series counts, source record as its own entry, research-ID union', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forecast-loss-period-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const usage = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'));
  const period = { data_version: sha('v'), from: '2021-01-01T00:00:00.000Z', to: '2021-02-01T00:00:00.000Z' };
  const accessed = '2021-03-01T00:00:00.000Z';
  await usage.record({ access_id: 'm1', research_id: 'manual-a', series_id: 'fx:EURUSD', ...period, accessed_at: accessed, purpose: 'exploration' });
  await usage.record({ access_id: 'm2', research_id: 'manual-b', series_id: 'fx:EURUSD', ...period, accessed_at: accessed, purpose: 'validation' });
  await usage.record({ access_id: 'm3', research_id: 'manual-b', series_id: 'fx:USDJPY', ...period, accessed_at: accessed, purpose: 'exploration' });
  const request_sha256 = sha('request');
  const inputs = ['forecast-set-source:abc', 'fx:EURUSD', 'fx:USDJPY'].map((series_id, i) => ({
    access_id: `forecast-access:x:${i}`, research_id: 'this', series_id, ...period, purpose: 'exploration', request_sha256 }));
  const recorded = await usage.recordToolAccessBatch('compare_forecast_losses', inputs);
  const summary = summarizePriorOverlap(recorded);
  assert.deepEqual(summary.per_series.map((s) => [s.series_id, s.overlapping_records, s.exploration_records, s.validation_records]), [
    ['forecast-set-source:abc', 0, 0, 0], ['fx:EURUSD', 2, 1, 1], ['fx:USDJPY', 1, 1, 0]]);
  assert.deepEqual(summary.overlapping_research_ids, ['manual-a', 'manual-b']);
  assert.equal(summary.overlapping_research_ids_seen, 2);
  assert.equal(summary.overlapping_research_ids_truncated, false);
  assert.ok(summary.limitations.includes('summary_omits_matching_records_use_full_check_for_detail'));
  assert.ok(!('matches' in summary.per_series[0]));
});

test('prior_overlap summary flags truncation from any record and from the union cap (P3)', () => {
  const assessment = (ids, truncated = false) => ({
    status: ids.length ? 'recorded_overlap' : 'no_recorded_overlap', overlapping_records: ids.length,
    exploration_records: ids.length, validation_records: 0, truncated, limitations: ['x'],
    matches: ids.map((research_id) => ({ research_id })),
  });
  const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);
  const fromOne = summarizePriorOverlap([{ series_id: 's', prior_overlap: assessment(['a'], true) }, { series_id: 't', prior_overlap: assessment([]) }]);
  assert.equal(fromOne.overlapping_research_ids_truncated, true, 'one record truncated is enough');
  const exact = summarizePriorOverlap([{ series_id: 's', prior_overlap: assessment(ids('a', 60)) },
    { series_id: 't', prior_overlap: assessment(ids('b', 40)) }]);
  assert.equal(exact.overlapping_research_ids.length, PRIOR_OVERLAP_RESEARCH_ID_CAP);
  assert.equal(exact.overlapping_research_ids_truncated, false, 'exactly 100 is not truncated');
  const over = summarizePriorOverlap([{ series_id: 's', prior_overlap: assessment(ids('a', 60)) },
    { series_id: 't', prior_overlap: assessment([...ids('b', 41), 'a000']) }]);
  assert.equal(over.overlapping_research_ids.length, 100);
  assert.equal(over.overlapping_research_ids_seen, 101, 'the shared ID counts once');
  assert.equal(over.overlapping_research_ids_truncated, true);
  assert.deepEqual(over.overlapping_research_ids, [...ids('a', 60), ...ids('b', 40)]);
});

test('the journal cap equals the framing reader cap, and an oversized journal fails closed without appending (L6)', async (t) => {
  // A larger log cap let one append cross the reader's limit, after which every call failed.
  assert.equal(FORECAST_LOSS_JOURNAL_MAX_BYTES, BACKTEST_LEDGER_MAX_BYTES);
  const { path, store } = await setup(t);
  await store.record(exposure('r'));
  await truncate(path, FORECAST_LOSS_JOURNAL_MAX_BYTES + 1);
  const before = await stat(path);
  await assert.rejects(store.record(exposure('r')), /size/);
  const after = await stat(path);
  assert.deepEqual([after.size, after.mtimeMs], [before.size, before.mtimeMs]);
});
