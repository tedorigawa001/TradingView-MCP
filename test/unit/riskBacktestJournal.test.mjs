import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RiskBacktestJournalStore, weightsHash, RISK_BACKTEST_SEARCH_LIMITATIONS } from '../../build/riskBacktestJournal.js';
import { ResearchPeriodUsageStore } from '../../build/researchPeriodUsage.js';
import { summarizePriorOverlap } from '../../build/forecastLossJournal.js';

// docs/RISK_FORECAST_BACKTEST_PLAN.md, step 5: the search journal, its counts, and the period-usage tool name.
const hash = (c) => 'sha256:' + c.repeat(64);
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'risk-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'risk-backtest-journal.jsonl');
  return { directory, path, journal: new RiskBacktestJournalStore(path) };
}
const levels = (results) => [0.01, 0.05].map((level, l) => ({ level, x: 3, T: 300,
  results: { kupiec: results[l], independence: 'not_rejected', conditional_coverage: 'not_rejected' } }));
const evaluated = (r1 = 'not_rejected', r5 = 'not_rejected') => ({ status: 'evaluated', own_nulls: 0, levels: levels([r1, r5]) });
const exposure = (patch = {}) => ({
  research_id: 'r1', forecast_set_id: hash('f'), proxy_set_id: hash('4'), rules_sha256: hash('9'),
  bar_series: [hash('1'), hash('2')], underlying_series_ids: ['fx:EURUSD', 'fx:USDJPY'],
  run: { from_date: '2026-01-05', to_date: '2026-03-31' },
  span: { from: '2026-01-02T21:30:00.000Z', to: '2026-03-31T20:45:00.000Z' },
  a_sha256: hash('a'), b_sha256: hash('b'), weights: [0.5, 0.5], target: { value: 10, unit: 'log_percent' },
  forecasts: { a: evaluated(), b: evaluated() }, outcome: 'evaluated', ...patch,
});
const lines = async (path) => (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);

test('one record per call with the design fields; the weights hash binds the normalized weights', async (t) => {
  const { path, journal } = await setup(t);
  const { sequence, search } = await journal.record(exposure());
  assert.equal(sequence, 1);
  const [record] = await lines(path);
  assert.deepEqual(Object.keys(record), ['schema_version', 'namespace', 'sequence', 'observation_date', 'first_seen_at', 'contract', 'research_id',
    'forecast_set_id', 'proxy_set_id', 'rules_sha256', 'bar_series', 'underlying_series_ids', 'run', 'span', 'a_sha256', 'b_sha256', 'weights',
    'weights_sha256', 'target', 'forecasts', 'outcome']);
  assert.equal(record.namespace, 'risk_forecast_backtest_search');
  assert.equal(record.contract, 'risk_forecast_backtest_v1');
  assert.equal(record.weights_sha256, weightsHash([0.5, 0.5]));
  assert.deepEqual(search.limitations, [...RISK_BACKTEST_SEARCH_LIMITATIONS]);
  assert.deepEqual(search.this_research_id, { calls: 1, distinct_weight_vectors: 1, distinct_a: 1, distinct_b: 1,
    earlier_no_rejection: [{ level: 0.01, calls: 0 }, { level: 0.05, calls: 0 }] });
});

test('search: both scopes on overlapping data, half-open spans, distinct hashes, and the untracked form', async (t) => {
  const { journal } = await setup(t);
  await journal.record(exposure());
  await journal.record(exposure({ weights: [1, 0] }));
  await journal.record(exposure({ research_id: 'r2', a_sha256: hash('c') }));
  await journal.record(exposure({ research_id: null, b_sha256: hash('d') }));
  // Not overlapping: another series, and a span that only touches this one's end.
  await journal.record(exposure({ underlying_series_ids: ['fx:GBPUSD', 'fx:AUDUSD'] }));
  await journal.record(exposure({ span: { from: '2026-03-31T20:45:00.000Z', to: '2026-04-30T20:45:00.000Z' } }));
  const { search } = await journal.record(exposure({ target: { value: 20, unit: 'log_percent' } }));
  assert.deepEqual(search.this_research_id, { calls: 3, distinct_weight_vectors: 2, distinct_a: 1, distinct_b: 1,
    earlier_no_rejection: [{ level: 0.01, calls: 2 }, { level: 0.05, calls: 2 }] }, 'the target is recorded but not counted');
  assert.deepEqual(search.overlapping_data, { calls: 5, untracked_calls: 1, distinct_research_ids: 2, distinct_weight_vectors: 2,
    distinct_forecast_hashes: 4, earlier_no_rejection: [{ level: 0.01, calls: 4 }, { level: 0.05, calls: 4 }] });
  const untracked = await journal.record(exposure({ research_id: null }));
  assert.deepEqual(untracked.search.this_research_id, { status: 'untracked' });
  assert.equal(untracked.search.overlapping_data.untracked_calls, 2);
});

test('earlier_no_rejection: per level, never counting this call, a not-evaluable call or one with both forecasts blocked', async (t) => {
  const { journal } = await setup(t);
  const blocked = { status: 'blocked', own_nulls: 9 };
  await journal.record(exposure({ forecasts: null, outcome: 'not_evaluable' }));
  await journal.record(exposure({ forecasts: { a: blocked, b: blocked } }));
  await journal.record(exposure({ forecasts: { a: evaluated('rejected', 'not_rejected'), b: blocked } }));
  await journal.record(exposure({ forecasts: { a: evaluated('indeterminate_due_to_own_nulls', 'not_rejected_underpowered'), b: evaluated() } }));
  await journal.record(exposure({ forecasts: { a: evaluated(), b: evaluated('not_rejected', 'rejected') } }));
  const { search } = await journal.record(exposure());
  assert.deepEqual(search.this_research_id.earlier_no_rejection, [{ level: 0.01, calls: 2 }, { level: 0.05, calls: 2 }]);
  assert.equal(search.this_research_id.calls, 6, 'every call counts as a call');
});

test('reads fail closed: framing, a hand-edited weights hash, outcome and forecasts disagreeing, series lengths', async (t) => {
  const { path, journal } = await setup(t);
  await journal.record(exposure());
  const good = await readFile(path, 'utf8');
  const [record] = JSON.parse(`[${good.trim()}]`);
  for (const bad of [good.slice(0, -1), good + '\n', JSON.stringify({ ...record, weights: [0.6, 0.4] }) + '\n',
    JSON.stringify({ ...record, forecasts: null }) + '\n', JSON.stringify({ ...record, weights: [1], weights_sha256: weightsHash([1]) }) + '\n']) {
    await writeFile(path, bad);
    await assert.rejects(journal.record(exposure()));
  }
  await writeFile(path, good);
  await appendFile(path, '{"torn":');
  await assert.rejects(journal.record(exposure()), /framing/);
  // Input validation before anything is written.
  await writeFile(path, good);
  await assert.rejects(journal.record(exposure({ weights: [1, 2, 3] })), /lengths differ/);
  await assert.rejects(journal.record(exposure({ outcome: 'not_evaluable' })), /disagree/);
  assert.equal(await readFile(path, 'utf8'), good);
});

test('period usage: the new tool name and scope, its limitation block, and active declarations in the summary', async (t) => {
  const { directory } = await setup(t);
  const clock = { now: '2026-10-01T00:00:00.000Z' };
  const store = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'), undefined, { now: () => new Date(clock.now) });
  await store.declareForwardPeriod({ declaration_id: 'd1', research_id: 'other', series_ids: ['fx:EURUSD'], from: '2027-01-01T00:00:00.000Z',
    to: '2027-04-01T00:00:00.000Z', protocol_sha256: hash('e') });
  const records = await store.recordToolAccessBatch('backtest_risk_forecast', ['forecast-set-source:' + '7'.repeat(64), 'fx:EURUSD', 'fx:USDJPY']
    .map((series_id, i) => ({ access_id: `risk:${i}`, research_id: 'r1', series_id, data_version: hash(String(i + 1)),
      from: '2027-01-30T21:30:00.000Z', to: '2027-02-27T21:45:00.000Z', purpose: 'exploration', request_sha256: hash('8') })));
  assert.deepEqual(records.map((r) => [r.tool_name, r.scope]), Array.from({ length: 3 }, () => ['backtest_risk_forecast', 'risk_backtest_bar_window_only']));
  const summary = summarizePriorOverlap(records);
  assert.deepEqual(summary.per_series.map((row) => row.active_forward_period_declarations),
    [{ declared_by_this_research: 0, declared_by_other_research: 0 }, { declared_by_this_research: 0, declared_by_other_research: 1 },
      { declared_by_this_research: 0, declared_by_other_research: 0 }]);
  assert.ok(summary.limitations.includes('access_overlaps_a_declared_forward_period'));
  const check = await store.check({ series_id: 'fx:EURUSD', data_version: hash('2'), from: '2027-02-01T00:00:00.000Z', to: '2027-02-02T00:00:00.000Z' });
  for (const l of ['tool_observed_usage_is_risk_backtest_bar_window_only', 'series_id_and_data_version_are_importer_supplied_metadata']) {
    assert.ok(check.limitations.includes(l), l);
  }
  const plain = new ResearchPeriodUsageStore(join(directory, 'plain.jsonl'));
  assert.ok(!(await plain.check({ series_id: 'x', data_version: hash('2'), from: '2027-02-01T00:00:00.000Z', to: '2027-02-02T00:00:00.000Z' }))
    .limitations.includes('tool_observed_usage_is_risk_backtest_bar_window_only'), 'only when the ledger holds such records');
});
