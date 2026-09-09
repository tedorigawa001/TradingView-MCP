import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm, stat, truncate, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ResearchPeriodUsageStore, researchPeriodUsageRecordSchema, researchPeriodUsageCheckSchema } from '../../build/researchPeriodUsage.js';

const ts = (day) => `2024-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const version = (char) => 'sha256:' + char.repeat(64);
const query = (patch = {}) => ({ series_id: 'EURUSD', data_version: version('a'), from: ts(10), to: ts(20), ...patch });
const input = (patch = {}) => ({ access_id: 'access:1', research_id: 'research:1', ...query(),
  accessed_at: ts(25), purpose: 'exploration', ...patch });
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'period-usage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'usage.jsonl');
  return { directory, path, store: new ResearchPeriodUsageStore(path) };
}
const saved = async (path) => (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);

test('absent history and declarations never prove unused or authorize eligibility', async (t) => {
  const { store, path } = await setup(t);
  for (const declaration of [undefined, 'unknown', 'declared_unused']) {
    const result = await store.check(query({ prior_usage_declaration: declaration }));
    assert.equal(result.status, 'no_recorded_overlap');
    assert.equal(result.scope, 'prior_recorded_access_reports');
    assert.equal(result.prior_usage_declaration, declaration ?? 'unknown');
    assert.equal(result.prior_usage_declaration_source, 'importer_supplied');
    assert.equal(result.unused_proven, false);
    assert.equal(result.candidateEligible, false);
    assert.equal(result.overlapping_records, 0);
    assert.equal(result.exploration_records, 0);
    assert.equal(result.validation_records, 0);
    assert.deepEqual(result.matches, []);
    assert.equal(result.truncated, false);
  }
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('same-series overlap spans versions, research IDs and purposes; intervals are half-open', async (t) => {
  const { store } = await setup(t);
  const periods = [
    { from: ts(1), to: ts(11) }, // partial left
    { from: ts(19), to: ts(22), data_version: version('b'), research_id: 'other', purpose: 'validation' },
    { from: ts(11), to: ts(12) }, // contained
    { from: ts(1), to: ts(30) }, // contains
    {}, // exact
    { from: ts(1), to: ts(10) }, // touching left
    { from: ts(20), to: ts(30) }, // touching right
    { series_id: 'GBPUSD' },
  ];
  for (const [i, patch] of periods.entries()) await store.record(input({ access_id: `a:${i}`, ...patch }));
  const result = await store.check(query({ prior_usage_declaration: 'declared_unused' }));
  assert.equal(result.status, 'recorded_overlap');
  assert.equal(result.overlapping_records, 5);
  assert.equal(result.exploration_records, 4);
  assert.equal(result.validation_records, 1);
  assert.deepEqual(result.matches.map((m) => m.access_id), ['a:0', 'a:1', 'a:2', 'a:3', 'a:4']);
  assert.deepEqual(result.matches.map((m) => m.version_relation), ['same', 'different', 'same', 'same', 'same']);
  assert.equal(result.unused_proven, false);
  assert.equal(result.candidateEligible, false);
});

test('record durably binds the complete input and retry excludes itself without appending', async (t) => {
  const { path, store } = await setup(t);
  const first = await store.record(input());
  assert.equal(first.sequence, 1);
  assert.equal(first.idempotent, false);
  assert.equal(first.prior_overlap.overlapping_records, 0);
  assert.equal(first.source, 'user_reported');
  assert.equal(first.recorded_at, first.first_seen_at);
  const [persisted] = await saved(path);
  for (const [key, value] of Object.entries(input())) assert.equal(persisted[key], value);
  assert.equal(persisted.prior_overlap, undefined);
  const before = await readFile(path, 'utf8');
  const retry = await new ResearchPeriodUsageStore(path).record(input());
  assert.deepEqual(retry, { ...first, idempotent: true });
  assert.equal(await readFile(path, 'utf8'), before);
  const second = await store.record(input({ access_id: 'second', research_id: 'different' }));
  assert.equal(second.prior_overlap.overlapping_records, 1);
  const laterRetry = await store.record(input());
  assert.equal(laterRetry.sequence, 1);
  assert.deepEqual(laterRetry, { ...first, idempotent: true });
  assert.deepEqual((await store.record(input({ access_id: 'second', research_id: 'different' }))).prior_overlap,
    second.prior_overlap);
  assert.equal((await saved(path)).length, 2);
});

test('prior assessment follows append order, not the reported accessed_at timestamp', async (t) => {
  const { store } = await setup(t);
  await store.record(input({ accessed_at: ts(27) }));
  const lateReport = await store.record(input({ access_id: 'late-report', accessed_at: ts(25) }));
  assert.equal(lateReport.prior_overlap.overlapping_records, 1);
  assert.equal(lateReport.prior_overlap.matches[0].accessed_at, ts(27));
  assert.equal(lateReport.prior_overlap.scope, 'prior_recorded_access_reports');
});

test('global access ID rejects changes to every bound field', async (t) => {
  const { store, path } = await setup(t);
  await store.record(input());
  const before = await readFile(path, 'utf8');
  for (const patch of [{ research_id: 'new' }, { series_id: 'new' }, { data_version: version('b') },
    { from: ts(9) }, { to: ts(21) }, { accessed_at: ts(26) }, { purpose: 'validation' }]) {
    await assert.rejects(store.record(input(patch)), /conflicts/);
    assert.equal(await readFile(path, 'utf8'), before);
  }
});

test('strict schemas expose shape without injecting source, origin or confirm into input', async (t) => {
  const { store } = await setup(t);
  assert.deepEqual(researchPeriodUsageRecordSchema.parse(input()), input());
  assert.ok(researchPeriodUsageRecordSchema.shape.access_id);
  assert.ok(researchPeriodUsageCheckSchema.shape.prior_usage_declaration);
  assert.equal(researchPeriodUsageCheckSchema.parse(query()).prior_usage_declaration, 'unknown');
  for (const field of ['access_id', 'research_id', 'series_id']) {
    assert.ok(researchPeriodUsageRecordSchema.safeParse(input({ [field]: 'a'.repeat(120) })).success);
    for (const value of ['', '../path', 'space here', 'a'.repeat(121)]) {
      await assert.rejects(store.record(input({ [field]: value })));
    }
  }
  for (const patch of [{ from: ts(20) }, { to: ts(1) }, { from: '2024-01-10T00:00:00Z' },
    { to: '2024-02-30T00:00:00.000Z' }, { from: '+010000-01-01T00:00:00.000Z' },
    { data_version: 'a'.repeat(64) }, { data_version: version('A') }, { purpose: 'other' },
    { accessed_at: '9999-01-01T00:00:00.000Z' }, { origin: 'tool_reported' }, { source: 'user_reported' },
    { confirm: true }, { path: '/tmp/elsewhere' }]) await assert.rejects(store.record(input(patch)));
  for (const patch of [{ prior_usage_declaration: 'unused' }, { path: '/tmp/x' },
    { research_id: 'filter' }, { from: ts(20) }, { data_version: 'bad' }]) await assert.rejects(store.check(query(patch)));
});

test('matched output is bounded to 100 while totals cover the complete history', async (t) => {
  const { store } = await setup(t);
  for (let i = 0; i < 103; i++) await store.record(input({ access_id: `a:${i}`, purpose: i % 2 ? 'validation' : 'exploration' }));
  const result = await store.check(query());
  assert.equal(result.overlapping_records, 103);
  assert.equal(result.exploration_records, 52);
  assert.equal(result.validation_records, 51);
  assert.equal(result.matches.length, 100);
  assert.equal(result.truncated, true);
});

test('corrupt framing, metadata, dates, IDs and sequences fail closed on reads and writes', async (t) => {
  const { store, path } = await setup(t);
  await store.record(input());
  const [original] = await saved(path);
  const line = JSON.stringify(original);
  const corruptions = ['', '\n', '{broken\n', '{}\n', line, '\n' + line + '\n', line + '\n\n',
    line + ' '.repeat(16 * 1024) + '\n'];
  for (const patch of [{ schema_version: '2.0' }, { namespace: 'other' }, { source: 'tool_reported' },
    { origin: 'user_reported' }, { sequence: 2 }, { sequence: 1.5 }, { observation_date: '2024-02-30' },
    { observation_date: '2020-01-01' }, { first_seen_at: ts(25) }, { data_version: 'bad' },
    { accessed_at: '9999-01-01T00:00:00.000Z' }, { from: ts(21) }, { research_id: '../bad' }]) {
    corruptions.push(JSON.stringify({ ...original, ...patch }) + '\n');
  }
  corruptions.push(line + '\n' + JSON.stringify({ ...original, sequence: 2 }) + '\n');
  corruptions.push(line + '\n' + JSON.stringify({ ...original, access_id: 'second', sequence: 2,
    recorded_at: ts(26), first_seen_at: ts(26), observation_date: ts(26).slice(0, 10) }) + '\n');
  for (const text of corruptions) {
    await writeFile(path, text);
    await assert.rejects(store.check(query()));
    await assert.rejects(store.record(input({ access_id: 'new' })));
    assert.equal(await readFile(path, 'utf8'), text);
  }
});

test('clock rollback rejects checks, retries and fresh records', async (t) => {
  const { store, path } = await setup(t);
  await store.record(input());
  const [original] = await saved(path);
  const future = '9999-01-01T00:00:00.000Z';
  const text = JSON.stringify({ ...original, recorded_at: future, first_seen_at: future, observation_date: future.slice(0, 10) }) + '\n';
  await writeFile(path, text);
  await assert.rejects(store.check(query()), /clock moved backwards/);
  await assert.rejects(store.record(input()), /clock moved backwards/);
  await assert.rejects(store.record(input({ access_id: 'new' })), /clock moved backwards/);
  assert.equal(await readFile(path, 'utf8'), text);
});

test('file size cap refuses reads and writes without modifying history', async (t) => {
  const { store, path } = await setup(t);
  await store.record(input());
  await truncate(path, 32 * 1024 * 1024 + 1);
  const before = await stat(path);
  await assert.rejects(store.check(query()), /size/);
  await assert.rejects(store.record(input({ access_id: 'new' })), /size/);
  const after = await stat(path);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('concurrent instances serialize prior assessments and global idempotency', async (t) => {
  const { directory, path } = await setup(t);
  const stores = [new ResearchPeriodUsageStore(path), new ResearchPeriodUsageStore(directory + '/./usage.jsonl')];
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => stores[i % 2].record(input({ access_id: `a:${i}` }))));
  for (const result of results) assert.equal(result.prior_overlap.overlapping_records, result.sequence - 1);
  const retries = await Promise.all(stores.map((store) => store.record(input({ access_id: 'same' }))));
  assert.deepEqual(retries.map((r) => r.idempotent).sort(), [false, true]);
  assert.equal((await saved(path)).length, 21);
  const conflicts = await Promise.allSettled(stores.map((store, i) => store.record(input({ access_id: 'conflict', research_id: `r:${i}` }))));
  assert.equal(conflicts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(conflicts.filter((r) => r.status === 'rejected').length, 1);
});

test('independent processes share durable locking, including retries', async (t) => {
  const { path, store } = await setup(t);
  const moduleUrl = new URL('../../build/researchPeriodUsage.js', import.meta.url).href;
  const script = `import { ResearchPeriodUsageStore } from ${JSON.stringify(moduleUrl)};
    const store = new ResearchPeriodUsageStore(process.argv[1]);
    const input = JSON.parse(process.argv[2]);
    for (let i = 0; i < 6; i++) {
      const result = await store.record({...input, access_id: process.argv[3] + ':' + i});
      if (result.prior_overlap.overlapping_records !== result.sequence - 1) throw new Error('non-atomic assessment');
      await store.record({...input, access_id: 'shared'});
    }`;
  await Promise.all(Array.from({ length: 3 }, (_, i) => promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', script, path, JSON.stringify(input()), String(i)], { timeout: 15000 })));
  assert.equal((await store.check(query())).overlapping_records, 19);
  assert.deepEqual((await saved(path)).map((r) => r.sequence), Array.from({ length: 19 }, (_, i) => i + 1));
});

test('caller input is snapshotted before waiting for lock', async (t) => {
  const { store } = await setup(t);
  const request = input();
  const pending = store.record(request);
  request.research_id = 'mutated';
  assert.equal((await pending).research_id, 'research:1');
});

for (const failure of ['file', 'directory']) {
  test(`identical retry must recover ${failure} sync failure before acknowledging durability`, async (t) => {
    if (failure === 'directory' && process.platform === 'win32') {
      t.skip('Windows does not expose directory fsync');
      return;
    }
    const { path, directory } = await setup(t);
    const moduleUrl = new URL('../../build/researchPeriodUsage.js', import.meta.url).href;
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
      const { ResearchPeriodUsageStore } = await import(${JSON.stringify(moduleUrl)});
      const request = JSON.parse(rawInput);
      const store = new ResearchPeriodUsageStore(path);
      const error = new RegExp('injected ' + failure + ' sync failure');
      await assert.rejects(store.record(request), error);
      const before = await fs.readFile(path, 'utf8');
      const original = JSON.parse(before.trim());
      assert.equal(original.sequence, 1);
      // The bytes exist, but a new instance must still refuse success while fsync fails.
      await assert.rejects(new ResearchPeriodUsageStore(path).record(request), error);
      assert.equal(await fs.readFile(path, 'utf8'), before);
      fail = false;
      syncs.length = 0;
      const retry = await new ResearchPeriodUsageStore(path).record(request);
      assert.equal(retry.idempotent, true);
      assert.equal(retry.sequence, original.sequence);
      assert.equal(retry.recorded_at, original.recorded_at);
      assert.equal(retry.prior_overlap.overlapping_records, 0);
      assert.deepEqual(syncs, process.platform === 'win32' ? ['file'] : ['file', 'directory']);
      assert.equal(await fs.readFile(path, 'utf8'), before);
      await assert.rejects(fs.stat(path + '.lock'), { code: 'ENOENT' });
    `;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script,
      path, directory, failure, JSON.stringify(input())], { timeout: 10000 });
  });
}

test('unsafe file and lock paths fail closed; owner-only permissions are enforced', async (t) => {
  const { store, path, directory } = await setup(t);
  const target = join(directory, 'target');
  await writeFile(target, 'unchanged', { mode: 0o600 });
  await symlink(target, path);
  await assert.rejects(store.record(input()), /symbolic|symlink/);
  await assert.rejects(store.check(query()), /symbolic|symlink/);
  await rm(path);
  await symlink(target, path + '.lock');
  await assert.rejects(store.check(query()), /lock/);
  await rm(path + '.lock');
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
  await store.record(input());
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await chmod(path, 0o644);
    await assert.rejects(store.check(query()), /permissions|owner-only/);
    await assert.rejects(store.record(input()), /permissions|owner-only/);
    await chmod(path, 0o600);
  }
});

test('no source spawns a developer-machine wrapper instead of node itself', async () => {
  // These tests spawn real subprocesses, and the command was written as `bdo proxy <node>` -
  // a token-saving CLI that exists only on the author's machine. Every test passed locally
  // for exactly that reason, and every CI runner failed with spawn bdo ENOENT. A subprocess
  // must be started by process.execPath or an absolute path resolved at run time, never by a
  // bare name that happens to be installed here. This catches a literal bare name only; a
  // command built into a variable first still escapes it.
  // The calls here go through promisify, so the spawn name is followed by a closing paren
  // before the argument list. A pattern requiring an open paren immediately after the name
  // matched nothing at all - including the defect it was written for. Keep this comment free
  // of a literal example: the scan reads comments too.
  const spawnCall = /\b(execFile|execFileSync|spawn|spawnSync)\s*\)?\s*\(\s*['"`]([^'"`]*)['"`]/g;
  // Adding a name here asserts every CI runner that reaches the call has it. mkfifo is POSIX
  // and its caller is already skipped where it is absent.
  const PORTABLE = new Set(['mkfifo']);
  const roots = [new URL('../../src/', import.meta.url), new URL('./', import.meta.url)];
  const offenders = [];
  for (const root of roots) {
    for (const name of await readdir(root)) {
      if (!/\.(ts|mjs)$/.test(name)) continue;
      const source = await readFile(new URL(name, root), 'utf8');
      for (const [, call, command] of source.matchAll(spawnCall)) {
        if (!command.startsWith('/') && !PORTABLE.has(command)) {
          offenders.push(`${name}: ${call}(${JSON.stringify(command)})`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `spawned by a bare name CI may not have: ${offenders.join(', ')}`);
});
