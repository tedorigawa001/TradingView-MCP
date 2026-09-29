import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, appendFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealizedCovarianceJournalStore, REALIZED_COVARIANCE_JOURNAL_MAX_BYTES } from '../../build/realizedCovarianceJournal.js';
import { canonicalizeRules } from '../../build/realizedCovarianceRules.js';
import { BACKTEST_LEDGER_MAX_BYTES } from '../../build/backtestLedger.js';

const RULES = canonicalizeRules({ interval_minutes: 15, time_zone: 'America/New_York', day_end_local: '16:45', day_weekdays: [1, 2, 3, 4, 5],
  max_missing_slots: 6, first_interval: 'from_previous_endpoint', return_unit: 'log_percent' });
const id = (c) => 'sha256:' + c.repeat(64);
const exposure = (patch = {}) => ({
  rules: RULES.rules, rules_sha256: RULES.rules_sha256, bar_series: [id('a'), id('b')], underlying_series_ids: ['fx:EURUSD', 'fx:USDJPY'],
  from_date: '2026-01-06', to_date: '2026-01-30', proxy_set_id: id('c'), research_id: 'research:1', tzdata: '2026b',
  kept_days: 16, dropped_days: 3, envelope: { from: '2026-01-05T21:30:00.000Z', to: '2026-01-30T21:45:00.000Z' }, ...patch,
});
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rc-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'journal.jsonl');
  return { path, journal: new RealizedCovarianceJournalStore(path) };
}
const lines = async (path) => (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);

test('one owner-only record per call, with the design fields, written without a research_id too', async (t) => {
  const { path, journal } = await setup(t);
  const first = await journal.record(exposure());
  await journal.record(exposure({ research_id: null }));
  const [record] = await lines(path);
  assert.deepEqual(Object.keys(record), ['schema_version', 'namespace', 'sequence', 'observation_date', 'first_seen_at', 'algorithm_version',
    'rules', 'rules_sha256', 'bar_series', 'underlying_series_ids', 'from_date', 'to_date', 'proxy_set_id', 'research_id', 'tzdata',
    'kept_days', 'dropped_days', 'envelope']);
  assert.equal(record.namespace, 'realized_covariance_computation');
  assert.equal(record.algorithm_version, 'realized_covariance_v1');
  assert.equal((await lines(path))[1].research_id, null);
  assert.deepEqual(first.search, { calls: 1, distinct_rules: 1, distinct_bar_series_versions: 1 });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(REALIZED_COVARIANCE_JOURNAL_MAX_BYTES, BACKTEST_LEDGER_MAX_BYTES);
});

test('the same proxy set may recur under another research_id or tzdata, but not with other content (H2, H6)', async (t) => {
  const { path, journal } = await setup(t);
  await journal.record(exposure());
  await assert.doesNotReject(journal.record(exposure({ research_id: 'research:other', tzdata: '2027a' })));
  for (const patch of [{ kept_days: 15 }, { dropped_days: 4 }, { from_date: '2026-01-07' }, { bar_series: [id('a'), id('d')] },
    { envelope: { from: '2026-01-05T21:30:00.000Z', to: '2026-01-29T21:45:00.000Z' } }]) {
    const before = await readFile(path, 'utf8');
    await assert.rejects(journal.record(exposure(patch)), /metadata mismatch/, JSON.stringify(patch));
    assert.equal(await readFile(path, 'utf8'), before, 'nothing appended');
  }
  const other = canonicalizeRules({ ...RULES.rules, max_missing_slots: 5 });
  await assert.rejects(journal.record(exposure({ rules: other.rules, rules_sha256: other.rules_sha256 })), /metadata mismatch/);
  assert.deepEqual((await journal.findByProxySetId(id('c'))).map((r) => r.tzdata), ['2026b', '2027a']);
  assert.deepEqual(await journal.findByProxySetId(id('e')), []);
});

test('search counts rule variants and bar versions over shared series with overlapping envelopes (F8, G8)', async (t) => {
  const { journal } = await setup(t);
  const variant = (max) => canonicalizeRules({ ...RULES.rules, max_missing_slots: max });
  await journal.record(exposure());
  await journal.record(exposure({ ...variant(5), proxy_set_id: id('1') }));
  await journal.record(exposure({ ...variant(4), proxy_set_id: id('2'), bar_series: [id('f'), id('b')] }));   // a re-imported EURUSD
  // Outside the overlap set: another series, and the same series on a later, non-touching range.
  await journal.record(exposure({ ...variant(3), proxy_set_id: id('3'), underlying_series_ids: ['fx:GBPUSD', 'fx:AUDUSD'] }));
  const later = await journal.record(exposure({ ...variant(2), proxy_set_id: id('4'), from_date: '2026-03-02', to_date: '2026-03-06',
    envelope: { from: '2026-02-27T21:30:00.000Z', to: '2026-03-06T21:45:00.000Z' } }));
  assert.deepEqual(later.search, { calls: 1, distinct_rules: 1, distinct_bar_series_versions: 1 });
  assert.deepEqual(await journal.search(['fx:EURUSD'], { from: '2026-01-10T00:00:00.000Z', to: '2026-01-11T00:00:00.000Z' }),
    { calls: 3, distinct_rules: 3, distinct_bar_series_versions: 2 });
  // Half-open: an envelope that ends exactly where another starts does not overlap.
  assert.equal((await journal.search(['fx:EURUSD'], { from: '2026-01-30T21:45:00.000Z', to: '2026-02-27T21:30:00.000Z' })).calls, 0);
});

test('records are validated: rules hash, series lengths, dates; a torn journal fails closed', async (t) => {
  const { path, journal } = await setup(t);
  await assert.rejects(journal.record(exposure({ rules_sha256: id('9') })), /rules hash mismatch/);
  await assert.rejects(journal.record(exposure({ underlying_series_ids: ['fx:EURUSD'] })), /lengths differ/);
  await assert.rejects(journal.record(exposure({ from_date: '2026-02-01', to_date: '2026-01-01' })), /envelope or dates/);
  await journal.record(exposure());
  await appendFile(path, '{"schema_version":"1.0"');
  await assert.rejects(journal.record(exposure({ proxy_set_id: id('5') })), /framing/);
  await assert.rejects(journal.findByProxySetId(id('c')), /framing/);
});
