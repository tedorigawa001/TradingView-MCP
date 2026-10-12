import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile, rm, stat, symlink, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  // Windows has no POSIX modes; the shared log enforces owner-only files where they exist.
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
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
    [trial('x', { from: ts(20), to: ts(20) })], [trial('x', { tried_at: ts(1) })], [trial('x', { tried_at: '2023-12-31T00:00:00.000Z' })], [trial('x', { from: '2024-01-01T00:00:00Z' })], [trial('x', { tried_at: '2024-02-30T00:00:00.000Z' })],
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

test('reuses name where configurations were first evaluated: earlier, on a shared series, tried no later', async (t) => {
  const { store, path } = await setup(t);
  await store.recordBatch([trial('a', { configuration_count: 5 })]);
  await assert.rejects(store.recordBatch([trial('b', { reuses: [{ trial_set_id: 'a', configuration_count: 6 }] })]),
    /takes more configurations from a than it evaluated first/);
  // A reuse cannot point forward in the same call.
  await assert.rejects(store.recordBatch([trial('c', { reuses: [{ trial_set_id: 'd', configuration_count: 1 }] }), trial('d')]),
    /reuses names d, which is not recorded before this trial set/);
  await assert.rejects(store.recordBatch([trial('x', { series_ids: ['fx:USDJPY'], reuses: [{ trial_set_id: 'a', configuration_count: 1 }] })]),
    /reuses names a, which shares no series with this trial set/);
  await assert.rejects(store.recordBatch([trial('y', { tried_at: '2024-12-31T00:00:00.000Z', reuses: [{ trial_set_id: 'a', configuration_count: 1 }] })]),
    /reuses names a, which was tried after this trial set/);
  assert.equal((await saved(path)).length, 1);
  // b evaluates 3 of a's again and 2 first: a later set may take a's 5 and b's 2, not 3 from b.
  await store.recordBatch([trial('b', { configuration_count: 5, reuses: [{ trial_set_id: 'a', configuration_count: 3 }] })]);
  await assert.rejects(store.recordBatch([trial('c', { reuses: [{ trial_set_id: 'b', configuration_count: 3 }] })]),
    /takes more configurations from b than it evaluated first/);
  const ok = await store.recordBatch([trial('d', { configuration_count: 3 }), trial('e', { configuration_count: 10,
    reuses: [{ trial_set_id: 'd', configuration_count: 3 }, { trial_set_id: 'a', configuration_count: 5 }, { trial_set_id: 'b', configuration_count: 2 }] })]);
  assert.deepEqual(ok.map((r) => r.sequence), [3, 4]);
  assert.deepEqual(ok[1].reuses.map((r) => r.trial_set_id), ['a', 'b', 'd'], 'stored sorted');
  assert.equal(ok[1].prior_trials.configurations_reported, 13);
  assert.equal(ok[1].prior_trials.configurations_net, 10);   // a 5, b 2 and d 3, each evaluated first there
});

test('series_ids and reuses are sets: stored sorted, and a retry in another order is the same input', async (t) => {
  const { store, path } = await setup(t);
  const [a, b] = await store.recordBatch([trial('a', { series_ids: ['fx:USDJPY', 'fx:EURUSD'] }), trial('z', { series_ids: ['fx:EURUSD'] }),
    trial('b', { series_ids: ['fx:USDJPY', 'fx:EURUSD'], reuses: [{ trial_set_id: 'z', configuration_count: 1 }, { trial_set_id: 'a', configuration_count: 1 }] })])
    .then((r) => [r[0], r[2]]);
  assert.deepEqual(a.series_ids, ['fx:EURUSD', 'fx:USDJPY']);
  assert.deepEqual(b.reuses.map((r) => r.trial_set_id), ['a', 'z']);
  const before = await readFile(path, 'utf8');
  const retry = await store.recordBatch([trial('b', { series_ids: ['fx:EURUSD', 'fx:USDJPY'],
    reuses: [{ trial_set_id: 'a', configuration_count: 1 }, { trial_set_id: 'z', configuration_count: 1 }] })]);
  assert.equal(retry[0].idempotent, true);
  assert.equal(await readFile(path, 'utf8'), before);
});

test('check counts overlapping trial sets on shared series, each configuration once when reuses are declared', async (t) => {
  const { store } = await setup(t);
  await store.recordBatch([
    trial('a', { configuration_count: 10, count_basis: 'enumerated', outcome_seen: 'pnl' }),
    trial('b', { research_id: 'study-b', series_ids: ['fx:USDJPY', 'fx:EURUSD'], configuration_count: 6, count_basis: 'inferred',
      outcome_seen: 'forecast_only', data_version: version('b'), reuses: [{ trial_set_id: 'a', configuration_count: 4 }] }),
    trial('c', { configuration_count: 4, count_basis: 'lower_bound', outcome_seen: 'none', reuses: [{ trial_set_id: 'a', configuration_count: 4 }] }),
    // Adjacent interval and another series: never matched.
    trial('adjacent', { from: ts(20), to: ts(25), configuration_count: 100 }),
    trial('other-series', { series_ids: ['fx:GBPUSD'], configuration_count: 100 }),
    // An earlier interval, reused by e: outside the default query, it counts through its largest reuse.
    trial('d', { from: '2023-06-01T00:00:00.000Z', to: '2023-12-01T00:00:00.000Z', tried_at: '2024-12-01T00:00:00.000Z', configuration_count: 7 }),
    trial('e', { research_id: 'study-b', configuration_count: 3, reuses: [{ trial_set_id: 'd', configuration_count: 3 }] }),
  ]);
  const r = await store.check(query());
  assert.equal(r.status, 'recorded_trials');
  assert.equal(r.scope, 'recorded_trial_reports');
  assert.deepEqual([r.series_ids, r.from, r.to], [['fx:EURUSD'], ts(1), ts(20)]);
  assert.deepEqual(r.matches.map((m) => m.trial_set_id), ['a', 'b', 'c', 'e']);
  assert.equal(r.matching_sets, 4);
  assert.equal(r.configurations_reported, 23);
  assert.equal(r.configurations_new_within, 12);           // a 10, b 2, c 0, e 0
  assert.equal(r.configurations_reused_from_outside, 3);   // d, through e
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
  // Widened to d's interval, d counts in full and its reuse by e no longer adds.
  const wide = await store.check(query({ from: '2023-06-01T00:00:00.000Z' }));
  assert.deepEqual([wide.configurations_reported, wide.configurations_new_within, wide.configurations_reused_from_outside, wide.configurations_net],
    [30, 19, 0, 19]);
  // A matching set counts in full, also for a query naming only one of its series.
  const usdjpy = await store.check(query({ series_ids: ['fx:USDJPY'] }));
  assert.deepEqual([usdjpy.configurations_reported, usdjpy.configurations_new_within, usdjpy.configurations_reused_from_outside], [6, 2, 4]);
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

test('the net count takes configurations reused by several sets once, and never falls when the query widens', async (t) => {
  const { store } = await setup(t);
  // A walk-forward: S first evaluates 10 configurations, B and C (two studies) evaluate the same 10 on the next interval.
  await store.recordBatch([
    trial('S', { from: ts(1), to: ts(10), series_ids: ['fx:X'] }),
    trial('B', { from: ts(10), to: ts(20), series_ids: ['fx:X', 'fx:Y'], reuses: [{ trial_set_id: 'S', configuration_count: 10 }] }),
    trial('C', { research_id: 'study-c', from: ts(10), to: ts(20), series_ids: ['fx:X', 'fx:Y'], reuses: [{ trial_set_id: 'S', configuration_count: 10 }] }),
    trial('D', { from: ts(10), to: ts(20), series_ids: ['fx:Y'], configuration_count: 4 }),
    // A smaller reuse of S: the largest reuse of an outside set counts, not the smallest or their sum.
    trial('E', { research_id: 'study-e', from: ts(10), to: ts(20), series_ids: ['fx:X'], configuration_count: 4,
      reuses: [{ trial_set_id: 'S', configuration_count: 4 }] }),
  ]);
  const net = async (patch) => (await store.check(query(patch))).configurations_net;
  assert.equal(await net({ series_ids: ['fx:X'], from: ts(10), to: ts(20) }), 10);
  assert.equal(await net({ series_ids: ['fx:Y'], from: ts(10), to: ts(20) }), 14);
  assert.equal(await net({ series_ids: ['fx:X', 'fx:Y'], from: ts(10), to: ts(20) }), 14);
  assert.equal(await net({ series_ids: ['fx:X', 'fx:Y'], from: ts(1), to: ts(20) }), 14);
  assert.equal(await net({ series_ids: ['fx:X'], from: ts(1), to: ts(10) }), 10);
  // Widening never lowers the net, and it never exceeds what was reported.
  const queries = [[['fx:X'], ts(12), ts(13)], [['fx:X'], ts(5), ts(13)], [['fx:X', 'fx:Y'], ts(5), ts(13)], [['fx:X', 'fx:Y'], ts(1), ts(25)]];
  let previous = 0;
  for (const [series_ids, from, to] of queries) {
    const r = await store.check({ series_ids, from, to });
    assert.ok(r.configurations_net >= previous && r.configurations_net <= r.configurations_reported, JSON.stringify([series_ids, from, to]));
    previous = r.configurations_net;
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
    ['reuse across series', (lines) => `${lines[0]}\n${JSON.stringify({ ...JSON.parse(lines[1]), series_ids: ['fx:GBPUSD'], reuses: [{ trial_set_id: 'a', configuration_count: 1 }] })}\n`],
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

test('an empty journal file, as a first append that failed after creating it leaves, reads as an empty journal', async (t) => {
  const { store, path } = await setup(t);
  await writeFile(path, '', { mode: 0o600 });
  assert.equal((await store.check(query())).status, 'no_recorded_trials');
  assert.equal((await store.recordBatch([trial('a')]))[0].sequence, 1);
  assert.equal((await saved(path)).length, 1);
});

test('a journal path that is not a regular owner-only file is refused without waiting, empty or not', { skip: process.platform === 'win32' }, async (t) => {
  for (const [name, make] of [
    // A FIFO reports size zero too; opening it to read would wait for a writer forever.
    ['fifo', (path) => promisify(execFile)('mkfifo', ['-m', '600', path])],
    ['symbolic link to an empty file', async (path, directory) => { await writeFile(join(directory, 'target'), '', { mode: 0o600 }); await symlink(join(directory, 'target'), path); }],
    ['directory', (path) => mkdir(path, { mode: 0o700 })],
    ['empty file others can read', (path) => writeFile(path, '', { mode: 0o644 })],
  ]) {
    const { store, path, directory } = await setup(t);
    await make(path, directory);
    if (name === 'empty file others can read') await chmod(path, 0o644);
    const started = Date.now();
    await assert.rejects(store.check(query()), undefined, name);
    await assert.rejects(store.recordBatch([trial('a')]), undefined, name);
    assert.ok(Date.now() - started < 5000, name);
  }
});

for (const failure of ['file', 'directory']) {
  test(`an identical retry must recover a ${failure} sync failure before acknowledging durability`, async (t) => {
    if (failure === 'directory' && process.platform === 'win32') {
      t.skip('Windows does not expose directory fsync');
      return;
    }
    const { path, directory } = await setup(t);
    const moduleUrl = new URL('../../build/researchTrials.js', import.meta.url).href;
    const script = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import assert from 'node:assert/strict';
      const [path, directory, failure, rawInput] = process.argv.slice(1);
      const originalOpen = fs.open;
      let fail = true;
      const syncs = [];
      fs.open = async function(p, ...args) {
        const handle = await originalOpen(p, ...args);
        const kind = p === path ? 'file' : p === directory ? 'directory' : 'lock';
        const originalSync = handle.sync.bind(handle);
        handle.sync = async function() {
          if (kind !== 'lock') syncs.push(kind);
          if (kind === failure && fail) throw new Error('injected ' + failure + ' sync failure');
          return originalSync();
        };
        return handle;
      };
      syncBuiltinESMExports();
      const { ResearchTrialStore } = await import(${JSON.stringify(moduleUrl)});
      const records = JSON.parse(rawInput);
      const error = new RegExp('injected ' + failure + ' sync failure');
      await assert.rejects(new ResearchTrialStore(path).recordBatch(records), error);
      const before = await fs.readFile(path, 'utf8');
      assert.equal(JSON.parse(before.trim()).sequence, 1);
      // The bytes exist, but a new instance must still refuse success while fsync fails.
      await assert.rejects(new ResearchTrialStore(path).recordBatch(records), error);
      assert.equal(await fs.readFile(path, 'utf8'), before);
      fail = false;
      syncs.length = 0;
      const retry = await new ResearchTrialStore(path).recordBatch(records);
      assert.equal(retry[0].idempotent, true);
      assert.equal(retry[0].sequence, 1);
      assert.deepEqual(syncs, process.platform === 'win32' ? ['file'] : ['file', 'directory']);
      assert.equal(await fs.readFile(path, 'utf8'), before);
      await assert.rejects(fs.stat(path + '.lock'), { code: 'ENOENT' });
    `;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, path, directory, failure,
      JSON.stringify([trial('a', { tried_at: '2020-01-02T00:00:00.000Z', from: '2020-01-01T00:00:00.000Z', to: '2020-01-02T00:00:00.000Z' })])],
      { timeout: 10000 });
  });
}
