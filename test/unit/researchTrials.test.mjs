import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResearchTrialStore, researchTrialsBatchSchema, researchTrialsCheckSchema, summarizeTrialsAssessment,
  resolveResearchTrialsPath, RESEARCH_TRIALS_BATCH_MAX, RESEARCH_TRIALS_LIMITATIONS } from '../../build/researchTrials.js';

const ts = (day) => `2024-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const version = (char) => 'sha256:' + char.repeat(64);
const NOW = '2025-06-01T00:00:00.000Z';
const trial = (id, patch = {}) => ({ trial_set_id: id, research_id: 'study-a', series_ids: ['fx:EURUSD'],
  data_version: version('a'), from: ts(1), to: ts(20), tried_at: '2025-01-01T00:00:00.000Z',
  configuration_count: 10, count_basis: 'enumerated', outcome_seen: 'pnl', ...patch });
const query = (patch = {}) => ({ series_ids: ['fx:EURUSD'], from: ts(1), to: ts(20), ...patch });
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'research-trials-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'trials.jsonl');
  let now = options.now ?? NOW;
  const store = new ResearchTrialStore(path, options.limits, { now: () => new Date(now) });
  return { directory, path, store, setNow: (value) => { now = value; } };
}
const saved = async (path) => (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);

test('records trial sets with defaults, and a retry with the same input is idempotent with the same prior counts', async (t) => {
  const { store, path } = await setup(t);
  const first = await store.recordBatch([trial('a'), trial('b', { research_id: 'study-b', configuration_count: 4 })]);
  assert.deepEqual(first.map((r) => [r.sequence, r.idempotent]), [[1, false], [2, false]]);
  assert.equal(first[0].configuration_list_sha256, null);
  assert.deepEqual(first[0].reuses, []);
  assert.equal(first[0].note, '');
  assert.equal(first[0].recorded_at, NOW);
  assert.equal(first[0].first_seen_at, NOW);
  assert.equal(first[0].observation_date, '2025-06-01');
  assert.equal(first[0].namespace, 'research_trials');
  // Earlier records of the same call are prior trials.
  assert.equal(first[0].prior_trials.matching_sets, 0);
  assert.equal(first[1].prior_trials.configurations_reported, 10);
  assert.deepEqual(first[1].prior_trials.research_ids, [{ research_id: 'study-a', sets: 1, configurations_reported: 10 }]);
  assert.equal('matches' in first[1].prior_trials, false);
  const before = await readFile(path, 'utf8');
  const retry = await store.recordBatch([trial('a'), trial('b', { research_id: 'study-b', configuration_count: 4 })]);
  assert.deepEqual(retry.map((r) => [r.sequence, r.idempotent]), [[1, true], [2, true]]);
  assert.deepEqual(retry.map((r) => r.prior_trials), first.map((r) => r.prior_trials));
  assert.equal(await readFile(path, 'utf8'), before);
  // Defaults given explicitly are the same input.
  const explicit = await store.recordBatch([trial('a', { configuration_list_sha256: null, reuses: [], note: '' })]);
  assert.equal(explicit[0].idempotent, true);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('a retry that changes any one field of its input is refused, and nothing is written', async (t) => {
  const { store, path } = await setup(t);
  await store.recordBatch([trial('base'), trial('a', { reuses: [{ trial_set_id: 'base', configuration_count: 2 }], note: 'n',
    configuration_list_sha256: version('c') })]);
  const before = await readFile(path, 'utf8');
  const original = trial('a', { reuses: [{ trial_set_id: 'base', configuration_count: 2 }], note: 'n', configuration_list_sha256: version('c') });
  const changes = { research_id: 'other', series_ids: ['fx:EURUSD', 'fx:USDJPY'], data_version: version('b'), from: ts(2), to: ts(19),
    tried_at: '2025-01-02T00:00:00.000Z', configuration_count: 11, count_basis: 'inferred', outcome_seen: 'none',
    configuration_list_sha256: version('d'), reuses: [{ trial_set_id: 'base', configuration_count: 1 }], note: 'm' };
  // Every input field but the identifier itself is covered.
  assert.deepEqual(Object.keys(changes).sort(), Object.keys(original).filter((key) => key !== 'trial_set_id').sort());
  for (const [key, value] of Object.entries(changes)) {
    await assert.rejects(store.recordBatch([{ ...original, [key]: value }]), /conflicts with its original input/, key);
  }
  assert.equal(await readFile(path, 'utf8'), before);
});

test('a call is all or nothing: one bad record writes nothing, and the input is checked strictly', async (t) => {
  const { store, path } = await setup(t);
  await assert.rejects(store.recordBatch([trial('ok'), trial('bad', { reuses: [{ trial_set_id: 'missing', configuration_count: 1 }] })]),
    /reuses names missing, which is not recorded before this trial set/);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  const bad = [
    [trial('x', { extra: 1 })], [trial('x', { reuses: [{ trial_set_id: 'y', configuration_count: 1, extra: 1 }] })],
    [trial('x', { configuration_count: 0 })], [trial('x', { configuration_count: 1.5 })], [trial('x', { configuration_count: 1_000_001 })],
    [trial('x', { configuration_count: '10' })], [trial('x', { series_ids: [] })], [trial('x', { series_ids: ['fx:A', 'fx:A'] })],
    [trial('x', { series_ids: Array.from({ length: 21 }, (_, i) => `fx:${i}`) })],
    [trial('x', { from: ts(20), to: ts(20) })], [trial('x', { from: '2024-01-01T00:00:00Z' })], [trial('x', { tried_at: '2024-02-30T00:00:00.000Z' })],
    [trial('x', { count_basis: 'guessed' })], [trial('x', { outcome_seen: 'pnl_and_more' })], [trial('x', { note: 'n'.repeat(501) })],
    [trial('x', { data_version: 'sha256:abc' })], [trial('x', { trial_set_id: 'has space' })],
    [trial('x', { reuses: [{ trial_set_id: 'x', configuration_count: 1 }] })],
    [trial('x', { reuses: [{ trial_set_id: 'y', configuration_count: 1 }, { trial_set_id: 'y', configuration_count: 1 }] })],
    [trial('x', { configuration_count: 3, reuses: [{ trial_set_id: 'y', configuration_count: 2 }, { trial_set_id: 'z', configuration_count: 2 }] })],
    [trial('x'), trial('x')], [], Array.from({ length: RESEARCH_TRIALS_BATCH_MAX + 1 }, (_, i) => trial(`b${i}`)),
  ];
  for (const records of bad) {
    assert.equal(researchTrialsBatchSchema.safeParse(records).success, false, JSON.stringify(records).slice(0, 120));
    await assert.rejects(store.recordBatch(records));
  }
  assert.equal(researchTrialsBatchSchema.safeParse(Array.from({ length: RESEARCH_TRIALS_BATCH_MAX }, (_, i) => trial(`b${i}`))).success, true);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('reuses name earlier trial sets, in the journal or earlier in the call, and take no more than they hold', async (t) => {
  const { store, path } = await setup(t);
  await store.recordBatch([trial('a', { configuration_count: 5 })]);
  await assert.rejects(store.recordBatch([trial('b', { reuses: [{ trial_set_id: 'a', configuration_count: 6 }] })]),
    /takes more configurations from a than it holds/);
  // A reuse cannot point forward in the same call.
  await assert.rejects(store.recordBatch([trial('c', { reuses: [{ trial_set_id: 'd', configuration_count: 1 }] }), trial('d')]),
    /reuses names d, which is not recorded before this trial set/);
  assert.equal((await saved(path)).length, 1);
  const ok = await store.recordBatch([trial('d', { configuration_count: 3 }),
    trial('e', { configuration_count: 8, reuses: [{ trial_set_id: 'a', configuration_count: 5 }, { trial_set_id: 'd', configuration_count: 3 }] })]);
  assert.deepEqual(ok.map((r) => r.sequence), [2, 3]);
  assert.equal(ok[1].prior_trials.configurations_reported, 8);
});

test('check counts overlapping trial sets on shared series, subtracting reuses only within the matches', async (t) => {
  const { store } = await setup(t);
  await store.recordBatch([
    trial('a', { configuration_count: 10, count_basis: 'enumerated', outcome_seen: 'pnl' }),
    trial('b', { research_id: 'study-b', series_ids: ['fx:USDJPY', 'fx:EURUSD'], configuration_count: 6, count_basis: 'inferred',
      outcome_seen: 'forecast_only', data_version: version('b'), reuses: [{ trial_set_id: 'a', configuration_count: 4 }] }),
    trial('c', { configuration_count: 4, count_basis: 'lower_bound', outcome_seen: 'none', reuses: [{ trial_set_id: 'b', configuration_count: 4 }] }),
    // Adjacent interval and another series: never matched.
    trial('adjacent', { from: ts(20), to: ts(25), configuration_count: 100 }),
    trial('other-series', { series_ids: ['fx:GBPUSD'], configuration_count: 100 }),
    // Reuses a set the query does not match: nothing is subtracted for it.
    trial('d', { series_ids: ['fx:USDJPY'], configuration_count: 7 }),
    trial('e', { research_id: 'study-b', configuration_count: 3, reuses: [{ trial_set_id: 'd', configuration_count: 3 }] }),
  ]);
  const r = await store.check(query());
  assert.equal(r.status, 'recorded_trials');
  assert.equal(r.scope, 'recorded_trial_reports');
  assert.deepEqual(r.matches.map((m) => m.trial_set_id), ['a', 'b', 'c', 'e']);
  assert.equal(r.matching_sets, 4);
  assert.equal(r.configurations_reported, 23);
  assert.equal(r.configurations_reused_within, 8);   // b reuses 4 of a, c reuses 4 of b; e's reuse of d is outside
  assert.equal(r.configurations_net, 15);
  assert.deepEqual(r.by_count_basis, { enumerated: 13, inferred: 6, lower_bound: 4 });
  assert.deepEqual(r.by_outcome_seen, { pnl: 13, forecast_only: 6, none: 4 });
  assert.equal(r.distinct_data_versions, 2);
  assert.deepEqual(r.research_ids, [{ research_id: 'study-a', sets: 2, configurations_reported: 14 },
    { research_id: 'study-b', sets: 2, configurations_reported: 9 }]);
  assert.equal(r.research_ids_truncated, false);
  assert.equal(r.truncated, false);
  assert.equal(r.total_is_lower_bound, true);
  assert.deepEqual(r.limitations, [...RESEARCH_TRIALS_LIMITATIONS]);
  // The query's series and interval decide the matches: d joins when USDJPY is asked for, and its reuse by e is subtracted.
  const both = await store.check(query({ series_ids: ['fx:USDJPY', 'fx:EURUSD'] }));
  assert.equal(both.configurations_reported, 30);
  assert.equal(both.configurations_reused_within, 11);
  assert.equal((await store.check(query({ from: ts(19), to: ts(21) }))).matching_sets, 5);   // a, b, c, e and the adjacent set
  assert.equal((await store.check(query({ from: ts(20), to: ts(25) }))).matching_sets, 1);
  const none = await store.check(query({ series_ids: ['fx:AUDNZD'] }));
  assert.equal(none.status, 'no_recorded_trials');
  assert.equal(none.configurations_net, 0);
  assert.deepEqual(none.limitations, [...RESEARCH_TRIALS_LIMITATIONS, 'no_recorded_trials_is_not_proof_of_no_search']);
  const brief = summarizeTrialsAssessment(r);
  assert.equal('matches' in brief, false);
  assert.equal('truncated' in brief, false);
  assert.equal(brief.matches_omitted, 4);
  assert.equal(brief.configurations_net, 15);
  assert.equal(brief.limitations.at(-1), 'summary_omits_matching_records_use_full_check_for_detail');
  for (const bad of [query({ extra: 1 }), query({ from: ts(20), to: ts(1) }), query({ series_ids: [] }), { series_ids: ['fx:EURUSD'], from: ts(1) }]) {
    assert.equal(researchTrialsCheckSchema.safeParse(bad).success, false);
    await assert.rejects(store.check(bad));
  }
});

test('check lists at most 100 records and research IDs but counts them all', async (t) => {
  const { store } = await setup(t);
  for (let call = 0; call < 6; call += 1) {
    await store.recordBatch(Array.from({ length: 17 }, (_, i) => trial(`t${call}-${i}`, { research_id: `r${String(call * 17 + i).padStart(3, '0')}`,
      configuration_count: 1 })));
  }
  const r = await store.check(query());
  assert.equal(r.matching_sets, 102);
  assert.equal(r.configurations_reported, 102);
  assert.equal(r.matches.length, 100);
  assert.equal(r.truncated, true);
  assert.equal(r.research_ids.length, 100);
  assert.equal(r.research_ids_truncated, true);
  assert.equal(r.research_ids[0].research_id, 'r000');
});

test('the journal clock and the tried_at check use the store clock, and a future tried_at writes nothing', async (t) => {
  const { store, path, setNow } = await setup(t);
  await assert.rejects(store.recordBatch([trial('a'), trial('future', { tried_at: '2025-06-01T00:00:00.001Z' })]),
    /tried_at must not be in the future/);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  await store.recordBatch([trial('a', { tried_at: NOW })]);
  setNow('2025-05-31T23:59:59.999Z');
  await assert.rejects(store.recordBatch([trial('b')]), /clock moved backwards/);
  await assert.rejects(store.check(query()), /clock moved backwards/);
  setNow('2025-06-02T00:00:00.000Z');
  assert.equal((await store.recordBatch([trial('b')]))[0].sequence, 2);
});

test('a journal that breaks its rules fails closed on read', async (t) => {
  const cases = [
    ['missing final newline', (lines) => lines.join('\n')],
    ['blank line', (lines) => `${lines[0]}\n\n${lines[1]}\n`],
    ['duplicate trial_set_id', (lines) => `${lines[0]}\n${JSON.stringify({ ...JSON.parse(lines[1]), trial_set_id: 'a' })}\n`],
    ['reuse of a later set', (lines) => `${JSON.stringify({ ...JSON.parse(lines[0]), reuses: [{ trial_set_id: 'b', configuration_count: 1 }] })}\n${lines[1]}\n`],
    ['reuse beyond the set', (lines) => `${lines[0]}\n${JSON.stringify({ ...JSON.parse(lines[1]), reuses: [{ trial_set_id: 'a', configuration_count: 11 }] })}\n`],
    ['tried_at after recording', (lines) => `${JSON.stringify({ ...JSON.parse(lines[0]), tried_at: '2025-06-01T00:00:00.001Z' })}\n${lines[1]}\n`],
    // Later the same day, so only the recorded_at check (not the first-seen order or the observation date) refuses it.
    ['first_seen_at differs', (lines) => `${lines[0]}\n${JSON.stringify({ ...JSON.parse(lines[1]), first_seen_at: '2025-06-01T00:00:00.001Z' })}\n`],
    ['unknown field', (lines) => `${JSON.stringify({ ...JSON.parse(lines[0]), metric: 1.5 })}\n${lines[1]}\n`],
    ['sequence gap', (lines) => `${lines[0]}\n${JSON.stringify({ ...JSON.parse(lines[1]), sequence: 3 })}\n`],
  ];
  for (const [name, rewrite] of cases) {
    const { store, path } = await setup(t);
    await store.recordBatch([trial('a'), trial('b')]);
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    await writeFile(path, rewrite(lines), { mode: 0o600 });
    await assert.rejects(store.check(query()), undefined, name);
    await assert.rejects(store.recordBatch([trial('c')]), undefined, name);
  }
});

test('a call that would pass the size limits writes nothing', async (t) => {
  const { store, path } = await setup(t, { limits: { maxFileBytes: 32 * 1024 * 1024, maxRecordBytes: 900 } });
  await assert.rejects(store.recordBatch([trial('a'), trial('b', { note: 'n'.repeat(500) })]), /too large/);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  const small = await setup(t, { limits: { maxFileBytes: 800, maxRecordBytes: 16 * 1024 } });
  await assert.rejects(small.store.recordBatch([trial('a'), trial('b')]), /too large/);
  await assert.rejects(readFile(small.path), { code: 'ENOENT' });
});

test('a retry after a partial append completes the call', async (t) => {
  const { store, path } = await setup(t);
  await store.recordBatch([trial('a')]);
  // As if the append had stopped after its first complete line.
  const r = await store.recordBatch([trial('a'), trial('b')]);
  assert.deepEqual(r.map((x) => [x.trial_set_id, x.idempotent, x.sequence]), [['a', true, 1], ['b', false, 2]]);
  assert.deepEqual((await saved(path)).map((x) => x.trial_set_id), ['a', 'b']);
  await appendFile(path, '{"partial":');
  await assert.rejects(store.recordBatch([trial('a'), trial('b')]), /framing/);
});

test('the journal path comes from the environment variable or the home default', (t) => {
  const saved = process.env.TRADINGVIEW_MCP_RESEARCH_TRIALS_PATH;
  delete process.env.TRADINGVIEW_MCP_RESEARCH_TRIALS_PATH;
  t.after(() => { if (saved !== undefined) process.env.TRADINGVIEW_MCP_RESEARCH_TRIALS_PATH = saved; });
  assert.equal(resolveResearchTrialsPath('  /tmp/x/trials.jsonl  '), '/tmp/x/trials.jsonl');
  assert.match(resolveResearchTrialsPath(''), /\.tradingview-mcp[\\/]research-trials\.jsonl$/);
  assert.match(resolveResearchTrialsPath(undefined), /\.tradingview-mcp[\\/]research-trials\.jsonl$/);
});
