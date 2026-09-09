import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, chmod, stat, mkdir, readdir, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BacktestSliceJournalStore, normalizeBacktestSliceConditions, backtestSliceResearchIdSchema } from '../../build/backtestSliceJournal.js';
import { BACKTEST_LEDGER_MAX_BYTES, backtestLedgerSchema, summarizeBacktestLedger } from '../../build/backtestLedger.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/backtest-ledger.json', import.meta.url), 'utf8'));
const artifactId = (ledger) => 'sha256:' + createHash('sha256').update(JSON.stringify(backtestLedgerSchema.parse(ledger))).digest('hex');
const summary = (filters = {}, ledger = fixture) => summarizeBacktestLedger(ledger, {
  artifact_id: artifactId(ledger), round_trip_cost_bps: 2, ...filters,
});
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'slice-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'journal.jsonl');
  return { directory, path, store: new BacktestSliceJournalStore(path) };
}
const records = async (path) => (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);

test('oversized journal fails closed without appending or resetting it', async (t) => {
  const {path, store} = await setup(t);
  await store.recordSummary('size-limit', summary());
  await truncate(path, BACKTEST_LEDGER_MAX_BYTES + 1);
  const before = await stat(path);
  await assert.rejects(store.recordSummary('size-limit', summary()), /size/);
  const after = await stat(path);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('normalization deduplicates and sorts sets; repeated calls append across reopen', async (t) => {
  const { path, store } = await setup(t);
  const a = summary({ include_symbols: ['USDJPY', 'EURUSD', 'EURUSD'], exclude_symbols: ['XAUUSD', 'XAUUSD'] });
  const b = summary({ include_symbols: ['EURUSD', 'USDJPY'], exclude_symbols: ['XAUUSD'] });
  const first = await store.recordSummary('research:98', a);
  const second = await new BacktestSliceJournalStore(path).recordSummary('research:98', b);
  assert.equal(first.status, 'tracked');
  assert.equal(first.call_count, 1);
  assert.equal(second.call_count, 2);
  assert.equal(second.sequence, 2);
  assert.equal(second.distinct_conditions, 1);
  assert.equal(first.condition_hash, second.condition_hash);
  assert.equal(first.recording_started_at, second.recording_started_at);
  const saved = await records(path);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].source_sha256, a.source_sha256);
  assert.equal(saved[0].ledger_records, a.ledger_records);
  assert.equal(saved[0].selected_records, a.overall.records);
  assert.equal(saved[0].selected_fraction, a.selected_fraction);
  assert.equal(saved[0].comparison_contract, 'same_ledger_filter_partition_v1');
  assert.deepEqual(saved[0].conditions.include_symbols, ['EURUSD', 'USDJPY']);
  assert.equal(first.condition_hash, 'sha256:' + createHash('sha256').update(JSON.stringify(saved[0].conditions)).digest('hex'));
});

test('legacy exposure records remain readable without claiming comparison was displayed', async (t) => {
  const {path,store}=await setup(t);
  const {comparison,...legacy}=summary();
  const before=await store.recordSummary('legacy',legacy);
  const after=await store.recordSummary('legacy',summary());
  assert.equal(after.call_count,2);
  assert.equal(after.distinct_conditions,1);
  assert.equal(after.condition_hash,before.condition_hash);
  const saved=await records(path);
  assert.equal(saved[0].comparison_contract,undefined);
  assert.equal(saved[1].comparison_contract,'same_ledger_filter_partition_v1');
});

test('absent defaults and negative zero are canonical; every condition dimension affects the hash', async (t) => {
  const { store } = await setup(t);
  const filters = { artifact_id: artifactId(fixture), round_trip_cost_bps: 0 };
  assert.deepEqual(normalizeBacktestSliceConditions(filters), normalizeBacktestSliceConditions({
    ...filters, round_trip_cost_bps: -0, group_by: 'none', direction: undefined, from: undefined,
  }));
  assert.deepEqual(normalizeBacktestSliceConditions(filters), {
    include_symbols: [], exclude_symbols: [], direction: null, from: null, to: null,
    group_by: 'none', round_trip_cost_bps: 0,
  });
  const variants = [{}, { include_symbols: ['EURUSD'] }, { exclude_symbols: ['XAUUSD'] },
    { direction: 'long' }, { direction: 'short' }, { from: '2024-02-01T00:00:00.000Z' },
    { to: '2024-02-01T00:00:00.000Z' }, { round_trip_cost_bps: 0 },
    { group_by: 'symbol' }, { group_by: 'year' }, { group_by: 'month' }];
  for (const [index, variant] of variants.entries()) {
    const result = await store.recordSummary('r', summary(variant));
    assert.equal(result.distinct_conditions, index + 1);
    assert.equal(result.call_count, index + 1);
  }
});

test('empty slices count; grouped cells accumulate repeated exposures without independent-trial claims', async (t) => {
  const { path, store } = await setup(t);
  const empty = summary({ from: '2025-01-01T00:00:00.000Z', group_by: 'symbol' });
  await store.recordSummary('r', empty);
  const twice = await store.recordSummary('r', empty);
  assert.equal(twice.call_count, 2);
  assert.equal(twice.distinct_conditions, 1);
  assert.equal(twice.grouped_cell_count, 0);
  assert.deepEqual(twice.group_keys, []);
  const grouped = summary({ group_by: 'symbol' });
  const keys = grouped.groups.map((g) => g.key).sort();
  const once = await store.recordSummary('r', grouped);
  const again = await store.recordSummary('r', { ...grouped, groups: [...grouped.groups].reverse() });
  assert.deepEqual(once.group_keys, keys);
  assert.equal(again.grouped_cell_count, keys.length * 2);
  assert.equal(again.call_count, 4);
  assert.equal(again.distinct_conditions, 2);
  assert.deepEqual((await records(path)).map((r) => r.group_keys), [[], [], keys, keys]);
  assert.ok(again.limitations.includes('grouped_cells_are_not_independent_trials'));
  assert.ok(again.limitations.includes('prior_and_external_exploration_is_not_tracked'));
  assert.ok(again.limitations.includes('research_id_is_an_exploration_namespace_not_a_preregistered_hypothesis'));
});

test('counters are scoped by research ID and artifact; sequence is global', async (t) => {
  const { store } = await setup(t);
  const changed = { ...fixture, source_sha256: 'sha256:' + 'b'.repeat(64) };
  await store.recordSummary('a', summary());
  const otherResearch = await store.recordSummary('b', summary());
  const otherArtifact = await store.recordSummary('a', summary({}, changed));
  assert.equal(otherResearch.call_count, 1);
  assert.equal(otherArtifact.call_count, 1);
  assert.equal(otherArtifact.distinct_conditions, 1);
  assert.equal(otherArtifact.sequence, 3);
  const original = await store.recordSummary('a', summary());
  assert.equal(original.call_count, 2);
  assert.equal(original.sequence, 4);
});

test('IDs match the 120-character contract; invalid summaries never append', async (t) => {
  const { directory, path, store } = await setup(t);
  assert.equal(backtestSliceResearchIdSchema.parse('a'.repeat(120)).length, 120);
  for (const id of ['', '../r', 'with space', 'a/b', 'x'.repeat(121), null]) {
    await assert.rejects(store.recordSummary(id, summary()));
  }
  assert.deepEqual(await readdir(directory), []);
  const base = summary();
  for (const patch of [{ artifact_id: '../bad' }, { source_sha256: 'bad' }, { ledger_records: 0 },
    { selected_fraction: NaN }, { selected_fraction: 0 }, { overall: { records: -1 } },
    { groups: [{ key: 'unexpected' }] }, { filters: { ...base.filters, round_trip_cost_bps: -1 } }]) {
    await assert.rejects(store.recordSummary('r', { ...base, ...patch }));
  }
  await store.recordSummary('a'.repeat(120), base);
  await assert.rejects(store.recordSummary('r', { ...base, source_sha256: 'sha256:' + 'c'.repeat(64) }), /metadata mismatch/);
  assert.equal((await records(path)).length, 1);
});

test('corrupt JSON and invalid persisted semantics fail closed without changing bytes', async (t) => {
  const { path, store } = await setup(t);
  await store.recordSummary('r', summary({ group_by: 'symbol' }));
  const [original] = await records(path);
  const corruptions = ['{broken\n', '{}\n', '', '\n', JSON.stringify(original), '\n' + JSON.stringify(original) + '\n'];
  for (const mutate of [
    (r) => { r.condition_hash = 'sha256:' + '0'.repeat(64); },
    (r) => { r.conditions.include_symbols = ['USDJPY', 'EURUSD', 'EURUSD']; },
    (r) => { r.conditions.extra = true; },
    (r) => { r.selected_fraction = 0; },
    (r) => { r.sequence = 2; },
    (r) => { r.first_seen_at = 'yesterday'; },
    (r) => { r.observation_date = '2020-01-01'; },
    (r) => { r.research_id = '../bad'; },
    (r) => { r.namespace = 'preregistered'; },
    (r) => { r.group_keys = ['EURUSD', 'EURUSD']; },
    (r) => { r.group_keys = []; },
  ]) {
    const value = structuredClone(original); mutate(value);
    corruptions.push(JSON.stringify(value) + '\n');
  }
  for (const text of corruptions) {
    await writeFile(path, text, { mode: 0o600 });
    await assert.rejects(new BacktestSliceJournalStore(path).recordSummary('unrelated', summary()));
    assert.equal(await readFile(path, 'utf8'), text);
  }
  await writeFile(path, JSON.stringify(original) + '\n');
  assert.equal((await store.recordSummary('r', summary())).call_count, 2);
});

test('clock behind the latest record fails closed rather than clamping time', async (t) => {
  const { path, store } = await setup(t);
  await store.recordSummary('r', summary());
  const [original] = await records(path);
  original.first_seen_at = '9999-01-01T00:00:00.000Z';
  original.observation_date = '9999-01-01';
  const text = JSON.stringify(original) + '\n';
  await writeFile(path, text);
  await assert.rejects(store.recordSummary('r', summary()), /clock moved backwards/);
  assert.equal(await readFile(path, 'utf8'), text);
});

test('separate instances and equivalent paths serialize concurrent invocations', async (t) => {
  const { directory, path } = await setup(t);
  const stores = [new BacktestSliceJournalStore(path), new BacktestSliceJournalStore(directory + '/./journal.jsonl')];
  const results = await Promise.all(Array.from({ length: 24 }, (_, i) => stores[i % 2].recordSummary('r', summary())));
  assert.deepEqual(results.map((r) => r.call_count).sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i + 1));
  assert.ok(results.every((r) => r.distinct_conditions === 1));
  assert.equal(new Set(results.map((r) => r.recording_started_at)).size, 1);
  assert.equal((await records(path)).length, 24);
});

test('independent processes use the existing durable file lock', async (t) => {
  const { path } = await setup(t);
  const moduleUrl = new URL('../../build/backtestSliceJournal.js', import.meta.url).href;
  const script = `import { BacktestSliceJournalStore } from ${JSON.stringify(moduleUrl)};
    const store = new BacktestSliceJournalStore(process.argv[1]);
    for (let i = 0; i < 8; i++) await store.recordSummary('r', JSON.parse(process.argv[2]));`;
  await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', script, path, JSON.stringify(summary())], { timeout: 90_000 })));
  const result = await new BacktestSliceJournalStore(path).recordSummary('r', summary());
  assert.equal(result.call_count, 33);
  assert.equal(result.sequence, 33);
  assert.equal(result.distinct_conditions, 1);
  assert.deepEqual((await records(path)).map((r) => r.sequence), Array.from({ length: 33 }, (_, i) => i + 1));
});

test('unsafe files, directories and locks fail closed without modifying targets', async (t) => {
  const { directory, path, store } = await setup(t);
  const target = join(directory, 'target');
  await writeFile(target, 'unchanged', { mode: 0o600 });
  try { await symlink(target, path); } catch (error) {
    if (error.code === 'EPERM') { t.skip('symlinks unavailable'); return; } throw error;
  }
  await assert.rejects(store.recordSummary('r', summary()), /symbolic|symlink/);
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
  await rm(path);
  await symlink(join(directory, 'missing'), path);
  await assert.rejects(store.recordSummary('r', summary()), /symbolic|symlink/);
  await rm(path);
  await symlink(target, path + '.lock');
  await assert.rejects(store.recordSummary('r', summary()), /lock/);
  await rm(path + '.lock');
  await mkdir(path);
  await assert.rejects(store.recordSummary('r', summary()));
  await rm(path, { recursive: true });
  const alias = join(directory, 'alias');
  await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new BacktestSliceJournalStore(join(alias, 'journal.jsonl')).recordSummary('r', summary()), /directory/);
});

test('POSIX permissions are enforced and read failures never reset counters', async (t) => {
  if (process.platform === 'win32') { t.skip('POSIX permissions'); return; }
  const { directory, path, store } = await setup(t);
  await store.recordSummary('r', summary());
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await chmod(path, 0o644);
  await assert.rejects(store.recordSummary('r', summary()), /permissions|owner-only/);
  await chmod(path, 0o600);
  await chmod(directory, 0o755);
  await assert.rejects(store.recordSummary('r', summary()), /permissions/);
  await chmod(directory, 0o700);
  assert.equal((await store.recordSummary('r', summary())).call_count, 2);
});
