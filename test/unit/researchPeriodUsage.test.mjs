import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, appendFile, rm, stat, truncate, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ResearchPeriodUsageStore, researchPeriodUsageRecordSchema, researchPeriodUsageCheckSchema, summarizeAssessment,
  RESEARCH_PERIOD_USAGE_BATCH_MAX } from '../../build/researchPeriodUsage.js';

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

test('OOS preflight has no approval path, even with an unused declaration',async t=>{
  const {store,path}=await setup(t);
  for(const prior_usage_declaration of ['unknown','declared_unused']) {
    const r=await store.preflightOos(query({prior_usage_declaration}));
    assert.equal(r.status,'review_required');
    // The reason is the sentence a reader acts on, and this is the one that decides whether
    // the review case reads as caution or as clearance. Only the blocked reason was pinned:
    // rewriting this one to period_is_unused broke nothing.
    assert.equal(r.reason,'absence_of_usage_records_is_not_unused_evidence');
    assert.equal(r.contract,'recorded_usage_oos_preflight_v1');
    assert.deepEqual(r.limitations,[
      'read_only_snapshot_not_a_reservation_or_execution_token',
      'existing_backtest_tools_are_not_intercepted','concurrent_or_later_access_may_change_readiness',
      'all_research_ids_versions_and_purposes_are_considered_for_exact_series_id',
      'no_automatic_approval_path_in_v1']);
    assert.equal(r.execution_allowed,false);
    assert.equal(r.unused_proven,false);
    assert.equal(r.candidateEligible,false);
    assert.equal(r.usage.overlapping_records,0);
    assert.equal(new Date(r.checked_at).toISOString(),r.checked_at);
  }
  await assert.rejects(readFile(path),{code:'ENOENT'});
});
test('OOS preflight blocks both purposes and versions without changing the journal',async t=>{
  const {store,path}=await setup(t);
  await store.record(input({purpose:'validation',research_id:'other',data_version:version('b')}));
  const before=await readFile(path,'utf8');
  const r=await store.preflightOos(query({prior_usage_declaration:'declared_unused'}));
  assert.equal(r.status,'blocked');
  assert.equal(r.reason,'evaluation_period_has_recorded_usage');
  assert.equal(r.usage.validation_records,1);
  assert.equal(r.execution_allowed,false);
  assert.equal(await readFile(path,'utf8'),before);
  assert.equal((await store.preflightOos(query({from:ts(20),to:ts(21)}))).status,'review_required');
  assert.equal((await store.preflightOos(query({series_id:'different'}))).status,'review_required');
  await store.record(input({access_id:'another',purpose:'exploration'}));
  assert.equal((await store.preflightOos(query())).usage.exploration_records,1);
});
test('OOS preflight fails closed on corrupt storage and invalid intervals',async t=>{
  const {store,path}=await setup(t);
  await assert.rejects(store.preflightOos(query({to:ts(10)})));
  await store.record(input());
  await writeFile(path,'broken\n');
  await assert.rejects(store.preflightOos(query()));
});
const toolInput = (patch = {}) => {
  const { accessed_at, ...request } = input();
  return { ...request, request_sha256: version('c'), ...patch };
};

test('tool access persists internal metadata and replays its timestamp and original prefix later', async (t) => {
  const { store, path } = await setup(t);
  const before = new Date().toISOString();
  const first = await store.recordToolAccess(toolInput());
  assert.equal(first.source, 'tool_observed');
  assert.equal(first.tool_name, 'summarize_backtest_ledger');
  assert.equal(first.scope, 'ledger_trade_envelope_only');
  assert.equal(first.request_sha256, version('c'));
  assert.equal(first.accessed_at, first.recorded_at);
  assert.ok(first.accessed_at >= before && first.accessed_at <= new Date().toISOString());
  const { idempotent, prior_overlap, ...row } = first;
  assert.equal(idempotent, false);
  assert.deepEqual(await saved(path), [row]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const later = await store.recordToolAccess(toolInput({ access_id: 'later' }));
  assert.ok(later.accessed_at > first.accessed_at);
  assert.equal(later.prior_overlap.overlapping_records, 1);
  const bytes = await readFile(path, 'utf8');
  assert.deepEqual(await new ResearchPeriodUsageStore(path).recordToolAccess(toolInput()),
    { ...first, idempotent: true });
  assert.equal(await readFile(path, 'utf8'), bytes);
  for (const result of [later.prior_overlap, await store.check(query())]) {
    assert.ok(!result.limitations.includes('user_reported_local_usage_only'));
    assert.ok(result.limitations.some((s) => s.includes('importer_supplied_metadata')));
    assert.ok(result.limitations.some((s) => s.includes('untracked_external')));
    assert.ok(result.limitations.some((s) => s.includes('lookbacks')));
  }
  await store.record(input({ access_id: 'manual' }));
  const mixed = await store.check(query());
  assert.equal(mixed.overlapping_records, 3);
  assert.ok(!mixed.limitations.includes('user_reported_local_usage_only'));
  assert.ok(mixed.limitations.includes('manual_usage_is_user_reported'));
});

test('tool retries bind every input field and manual/tool ID collisions reject both ways', async (t) => {
  const { store, path } = await setup(t);
  const first = await store.recordToolAccess(toolInput());
  const bytes = await readFile(path, 'utf8');
  for (const patch of [{ request_sha256: version('d') }, { research_id: 'other' },
    { series_id: 'other' }, { data_version: version('b') }, { from: ts(9) },
    { to: ts(21) }, { purpose: 'validation' }]) {
    await assert.rejects(store.recordToolAccess(toolInput(patch)), /conflicts/);
    assert.equal(await readFile(path, 'utf8'), bytes);
  }
  await assert.rejects(store.record(input({ accessed_at: first.accessed_at })), /conflicts/);
  await store.record(input({ access_id: 'manual' }));
  await assert.rejects(store.recordToolAccess(toolInput({ access_id: 'manual' })), /conflicts/);
  assert.equal((await saved(path)).length, 2);
});

test('manual and tool inputs reject spoofed metadata and tool access timestamps', async (t) => {
  const { store, path } = await setup(t);
  for (const patch of [{ source: 'tool_observed' }, { source: 'user_reported' },
    { tool_name: 'summarize_backtest_ledger' }, { scope: 'ledger_trade_envelope_only' },
    { request_sha256: version('c') }]) await assert.rejects(store.record(input(patch)));
  for (const patch of [{ source: 'tool_observed' }, { tool_name: 'summarize_backtest_ledger' },
    { scope: 'ledger_trade_envelope_only' }, { accessed_at: ts(25) },
    { request_sha256: undefined }, { request_sha256: 'bad' }, { request_sha256: version('A') },
    { from: ts(20) }]) await assert.rejects(store.recordToolAccess(toolInput(patch)));
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('corrupt source-specific metadata and tool timestamp semantics fail closed', async (t) => {
  const { store, path } = await setup(t);
  await store.recordToolAccess(toolInput());
  const [original] = await saved(path);
  for (const patch of [{ source: 'unknown' }, { source: 'user_reported' }, { source: undefined },
    { tool_name: undefined }, { tool_name: 'other' }, { scope: undefined }, { scope: 'all_data' },
    { request_sha256: undefined }, { request_sha256: 'bad' }, { accessed_at: ts(25) }]) {
    const bytes = JSON.stringify({ ...original, ...patch }) + '\n';
    await writeFile(path, bytes);
    await assert.rejects(store.check(query()));
    await assert.rejects(store.record(input({ access_id: 'new' })));
    await assert.rejects(store.recordToolAccess(toolInput()));
    assert.equal(await readFile(path, 'utf8'), bytes);
  }
  const { tool_name, scope, request_sha256, ...manual } = original;
  manual.source = 'user_reported';
  for (const patch of [{ tool_name }, { scope }, { request_sha256 }, { source: 'tool_observed' }]) {
    await writeFile(path, JSON.stringify({ ...manual, ...patch }) + '\n');
    await assert.rejects(store.check(query()));
  }
});

test('concurrent tool accesses snapshot input and share global idempotency', async (t) => {
  const { store, path } = await setup(t);
  const request = toolInput();
  const pending = store.recordToolAccess(request);
  request.request_sha256 = version('d');
  const results = await Promise.all([pending, new ResearchPeriodUsageStore(path).recordToolAccess(toolInput())]);
  assert.deepEqual(results.map((r) => r.idempotent).sort(), [false, true]);
  assert.equal(results[0].accessed_at, results[1].accessed_at);
  assert.equal(results[0].request_sha256, version('c'));
  assert.equal((await saved(path)).length, 1);
});

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
  const preflight=await store.preflightOos(query());
  assert.equal(preflight.status,'blocked');
  assert.equal(preflight.usage.overlapping_records,103);
  assert.equal(preflight.usage.matches.length,100);
  assert.equal(preflight.usage.truncated,true);
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

for (const method of ['record', 'recordToolAccess']) for (const failure of ['file', 'directory']) {
  test(`${method} identical retry must recover ${failure} sync failure before acknowledging durability`, async (t) => {
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
      await assert.rejects(store[${JSON.stringify(method)}](request), error);
      const before = await fs.readFile(path, 'utf8');
      const original = JSON.parse(before.trim());
      assert.equal(original.sequence, 1);
      // The bytes exist, but a new instance must still refuse success while fsync fails.
      await assert.rejects(new ResearchPeriodUsageStore(path)[${JSON.stringify(method)}](request), error);
      assert.equal(await fs.readFile(path, 'utf8'), before);
      fail = false;
      syncs.length = 0;
      const retry = await new ResearchPeriodUsageStore(path)[${JSON.stringify(method)}](request);
      assert.equal(retry.idempotent, true);
      assert.equal(retry.sequence, original.sequence);
      assert.equal(retry.recorded_at, original.recorded_at);
      assert.equal(retry.prior_overlap.overlapping_records, 0);
      assert.deepEqual(syncs, process.platform === 'win32' ? ['file'] : ['file', 'directory']);
      assert.equal(await fs.readFile(path, 'utf8'), before);
      await assert.rejects(fs.stat(path + '.lock'), { code: 'ENOENT' });
    `;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script,
      path, directory, failure, JSON.stringify(method === 'record' ? input() : toolInput())], { timeout: 10000 });
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

test('a batch is validated in full before any write, and a retry completes a partial append', async (t) => {
  const { path, store } = await setup(t);
  const a = input({ access_id: 'batch:a' });
  const b = input({ access_id: 'batch:b', series_id: 'USDJPY' });
  const c = input({ access_id: 'batch:c', research_id: 'research:2' });
  // A conflict in the last request rejects the whole batch: nothing is written.
  await store.record(a);
  const before = await readFile(path, 'utf8');
  await assert.rejects(store.recordBatch([b, c, { ...a, purpose: 'validation' }]), /conflicts with its original input/);
  assert.equal(await readFile(path, 'utf8'), before);
  // Too many, too few, duplicated, or a future timestamp: rejected before the lock.
  await assert.rejects(store.recordBatch([]));
  await assert.rejects(store.recordBatch(Array.from({ length: RESEARCH_PERIOD_USAGE_BATCH_MAX + 1 },
    (_, i) => input({ access_id: `many:${i}` }))));
  await assert.rejects(store.recordBatch([b, { ...b }]), /unique within a batch/);
  await assert.rejects(store.recordBatch([b, input({ access_id: 'future', accessed_at: '2999-01-01T00:00:00.000Z' })]));
  assert.equal(await readFile(path, 'utf8'), before);
  // A batch that repeats an existing record appends only the new ones, in order.
  const results = await store.recordBatch([a, b, c]);
  assert.deepEqual(results.map((r) => [r.access_id, r.idempotent, r.sequence]),
    [['batch:a', true, 1], ['batch:b', false, 2], ['batch:c', false, 3]]);
  assert.equal(results[0].prior_overlap.overlapping_records, 0);
  assert.equal(results[2].prior_overlap.overlapping_records, 1, 'a later record sees an earlier one of its batch');
  assert.deepEqual((await saved(path)).map((r) => r.access_id), ['batch:a', 'batch:b', 'batch:c']);
  const again = await store.recordBatch([a, b, c]);
  assert.ok(again.every((r) => r.idempotent));
  assert.deepEqual(again.map((r) => r.prior_overlap.overlapping_records), [0, 0, 1]);
  assert.equal((await saved(path)).length, 3);
});

test('summarizeAssessment keeps counts, flags and limitations but drops the records', async (t) => {
  const { store } = await setup(t);
  await store.recordBatch([input({ access_id: 'x1', research_id: 'r-b' }), input({ access_id: 'x2', research_id: 'r-a' }),
    input({ access_id: 'x3', research_id: 'r-b', purpose: 'validation' })]);
  const full = await store.check(query());
  const brief = summarizeAssessment(full);
  assert.equal('matches' in brief, false);
  assert.equal('truncated' in brief, false);
  assert.deepEqual([brief.overlapping_records, brief.exploration_records, brief.validation_records, brief.matches_omitted],
    [3, 2, 1, 3]);
  assert.deepEqual(brief.overlapping_research_ids, ['r-a', 'r-b']);
  assert.equal(brief.overlapping_research_ids_truncated, false);
  assert.equal(brief.unused_proven, false);
  assert.equal(brief.candidateEligible, false);
  for (const limitation of full.limitations) assert.ok(brief.limitations.includes(limitation), limitation);
  assert.ok(brief.limitations.includes('summary_omits_matching_records_use_full_check_for_detail'));
});

test('batch capacity is checked for the whole batch before any write', async (t) => {
  const { path } = await setup(t);
  const a = input({ access_id: 'cap:a' });
  const b = input({ access_id: 'cap:b', series_id: 'USDJPY' });
  const c = input({ access_id: 'cap:c', series_id: 'GBPUSD' });
  await new ResearchPeriodUsageStore(path).record(a);
  const line = (await stat(path)).size;
  // Room for one more record of this size, not two.
  const limited = new ResearchPeriodUsageStore(path, { maxFileBytes: line * 2 + Math.floor(line / 2), maxRecordBytes: 16 * 1024 });
  const before = await readFile(path, 'utf8');
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(limited.recordBatch([b, c]), /too large/);
    assert.equal(await readFile(path, 'utf8'), before, 'an oversized batch writes nothing, and so does its retry');
  }
  const [only] = await limited.recordBatch([b]);
  assert.deepEqual([only.access_id, only.idempotent, only.sequence], ['cap:b', false, 2]);
});

test('an oversized record later in a batch rejects the batch before the earlier ones are written', async (t) => {
  const { directory } = await setup(t);
  const short = input({ access_id: 's' });
  const long = input({ access_id: 'l'.repeat(120), research_id: 'r'.repeat(120) });
  const size = async (name, record) => {
    const path = join(directory, name);
    await new ResearchPeriodUsageStore(path).record(record);
    return (await stat(path)).size;
  };
  const shortBytes = await size('short.jsonl', short);
  const longBytes = await size('long.jsonl', long);
  assert.ok(longBytes > shortBytes);
  const path = join(directory, 'limited.jsonl');
  const limited = new ResearchPeriodUsageStore(path,
    { maxFileBytes: 32 * 1024 * 1024, maxRecordBytes: shortBytes + Math.floor((longBytes - shortBytes) / 2) });
  await assert.rejects(limited.recordBatch([short, long]), /too large/);
  await assert.rejects(stat(path), { code: 'ENOENT' });
});

function injectAppendFailure(store, failAt, onFail) {
  const log = store.log;
  const real = log.appendUnlocked.bind(log);
  let calls = 0;
  log.appendUnlocked = async (record) => {
    calls += 1;
    if (calls === failAt) { await onFail(record); throw new Error('injected append failure'); }
    return real(record);
  };
  return () => { log.appendUnlocked = real; };
}

test('an identical retry resumes a batch stopped after complete lines', async (t) => {
  const { path, store } = await setup(t);
  const batch = [input({ access_id: 'res:a' }), input({ access_id: 'res:b', series_id: 'USDJPY' }),
    input({ access_id: 'res:c', research_id: 'research:2' })];
  const restore = injectAppendFailure(store, 2, async () => {});
  await assert.rejects(store.recordBatch(batch), /injected append failure/);
  restore();
  assert.deepEqual((await saved(path)).map((r) => r.access_id), ['res:a']);
  const results = await store.recordBatch(batch);
  assert.deepEqual(results.map((r) => [r.access_id, r.idempotent, r.sequence]),
    [['res:a', true, 1], ['res:b', false, 2], ['res:c', false, 3]]);
  assert.equal(results[2].prior_overlap.overlapping_records, 1);
  assert.equal((await saved(path)).length, 3);
});

test('a torn partial line fails closed and is not resumed', async (t) => {
  const { path, store } = await setup(t);
  const batch = [input({ access_id: 'torn:a' }), input({ access_id: 'torn:b', series_id: 'USDJPY' })];
  const restore = injectAppendFailure(store, 2, async (record) => {
    await appendFile(path, JSON.stringify(record).slice(0, 40));   // a short write, no newline
  });
  await assert.rejects(store.recordBatch(batch), /injected append failure/);
  restore();
  const torn = await readFile(path, 'utf8');
  await assert.rejects(store.recordBatch(batch), /framing/);
  await assert.rejects(store.check(query()), /framing/);
  assert.equal(await readFile(path, 'utf8'), torn, 'the retry did not append past a torn line');
});

const FIXTURE = new URL('../fixtures/period-usage/format-0.1.13.jsonl', import.meta.url);
async function fixtureStore(t, transform = (lines) => lines) {
  const { directory, path } = await setup(t);
  const lines = (await readFile(FIXTURE, 'utf8')).trim().split('\n');
  await writeFile(path, transform(lines).join('\n') + '\n', { mode: 0o600 });
  return { directory, path, store: new ResearchPeriodUsageStore(path) };
}
const fixtureQuery = { series_id: 'fixture-series', data_version: 'sha256:' + 'a'.repeat(64),
  from: '2024-01-10T00:00:00.000Z', to: '2024-01-20T00:00:00.000Z' };

test('records written in the 0.1.13 format still read, check and extend', async (t) => {
  const { path, store } = await fixtureStore(t);
  const usage = await store.check(fixtureQuery);
  assert.equal(usage.overlapping_records, 2);
  assert.deepEqual(usage.matches.map((m) => [m.access_id, m.source, m.tool_name ?? null, m.scope ?? null]),
    [['fixture:manual', 'user_reported', null, null],
      ['fixture:ledger', 'tool_observed', 'summarize_backtest_ledger', 'ledger_trade_envelope_only']]);
  assert.deepEqual(usage.limitations.slice(0, 3), ['tool_observed_usage_is_ledger_trade_envelope_only',
    'series_id_and_data_version_are_importer_supplied_metadata', 'ledger_trade_envelope_does_not_include_indicator_lookbacks']);
  assert.ok(!usage.limitations.includes('forecast_estimation_history_not_covered'));
  const [added] = await store.recordToolAccessBatch('compare_forecast_losses',
    [{ ...fixtureQuery, access_id: 'fixture:forecast:0', research_id: 'r', purpose: 'exploration', request_sha256: 'sha256:' + 'c'.repeat(64) }]);
  assert.equal(added.sequence, 3);
  assert.equal(added.prior_overlap.overlapping_records, 2);
  assert.equal((await saved(path)).length, 3);
});

test('a stored record whose tool and scope do not belong together is refused', async (t) => {
  for (const [tool, scope] of [['compare_forecast_losses', 'ledger_trade_envelope_only'],
    ['summarize_backtest_ledger', 'forecast_evaluation_window_only'],
    ['compute_realized_covariance', 'forecast_evaluation_window_only'],
    ['compare_forecast_losses', 'realized_covariance_bar_window_only']]) {
    const { store } = await fixtureStore(t, (lines) => lines.map((line) => {
      const record = JSON.parse(line);
      return JSON.stringify(record.source === 'tool_observed' ? { ...record, tool_name: tool, scope } : record);
    }));
    await assert.rejects(store.check(fixtureQuery), /tool_name and scope do not match/, `${tool} with ${scope}`);
  }
});

test('recordToolAccessBatch binds the server-chosen tool to its scope and keeps inputs strict', async (t) => {
  const { path, store } = await setup(t);
  const access = (i, patch = {}) => ({ ...query({ series_id: `S${i}` }), access_id: `batch-tool:${i}`,
    research_id: 'research:1', purpose: 'exploration', request_sha256: version('d'), ...patch });
  await assert.rejects(store.recordToolAccessBatch('manual', [access(0)]));
  await assert.rejects(store.recordToolAccessBatch('record_research_period_usage', [access(0)]));
  await assert.rejects(store.recordToolAccessBatch('compare_forecast_losses', [access(0, { tool_name: 'compare_forecast_losses' })]));
  await assert.rejects(store.recordToolAccessBatch('compare_forecast_losses', [access(0, { scope: 'forecast_evaluation_window_only' })]));
  await assert.rejects(store.recordToolAccessBatch('compare_forecast_losses', [access(0, { accessed_at: ts(1) })]));
  await assert.rejects(store.recordToolAccessBatch('compare_forecast_losses', []));
  await assert.rejects(store.recordToolAccessBatch('compare_forecast_losses',
    Array.from({ length: RESEARCH_PERIOD_USAGE_BATCH_MAX + 1 }, (_, i) => access(i))));
  await assert.rejects(store.recordToolAccessBatch('compare_forecast_losses', [access(0), access(0)]), /unique within a batch/);
  await assert.rejects(stat(path), { code: 'ENOENT' }, 'nothing was written');
  const results = await store.recordToolAccessBatch('compare_forecast_losses', [access(0), access(1), access(2)]);
  const stored = await saved(path);
  assert.deepEqual(stored.map((r) => [r.access_id, r.source, r.tool_name, r.scope]),
    [0, 1, 2].map((i) => [`batch-tool:${i}`, 'tool_observed', 'compare_forecast_losses', 'forecast_evaluation_window_only']));
  assert.ok(stored.every((r) => r.accessed_at === r.recorded_at), 'the server clock sets accessed_at');
  assert.ok(results.every((r) => !r.idempotent));
  const retry = await store.recordToolAccessBatch('compare_forecast_losses', [access(0), access(1), access(2)]);
  assert.ok(retry.every((r) => r.idempotent));
  // A conflict anywhere in the batch writes nothing, including against another tool's record.
  const before = await readFile(path, 'utf8');
  await assert.rejects(store.recordToolAccessBatch('summarize_backtest_ledger', [access(3), access(0)]), /conflicts/);
  await assert.rejects(store.recordToolAccessBatch('compare_forecast_losses', [access(3), access(1, { request_sha256: version('e') })]), /conflicts/);
  assert.equal(await readFile(path, 'utf8'), before);
  const usage = await store.check(query({ series_id: 'S0' }));
  assert.ok(usage.limitations.includes('tool_observed_usage_is_forecast_evaluation_window_only'));
  assert.ok(usage.limitations.includes('forecast_estimation_history_not_covered'));
  assert.ok(!usage.limitations.includes('ledger_trade_envelope_does_not_include_indicator_lookbacks'));
  assert.equal(usage.limitations.filter((l) => l === 'series_id_and_data_version_are_importer_supplied_metadata').length, 1);
  // The single-record ledger path is unchanged and still ledger-bound.
  const ledger = await store.recordToolAccess(access(9, { series_id: 'S0' }));
  assert.deepEqual([ledger.tool_name, ledger.scope], ['summarize_backtest_ledger', 'ledger_trade_envelope_only']);
  const both = await store.check(query({ series_id: 'S0' }));
  for (const l of ['ledger_trade_envelope_does_not_include_indicator_lookbacks', 'forecast_estimation_history_not_covered']) {
    assert.ok(both.limitations.includes(l), l);
  }
  assert.equal(both.limitations.filter((l) => l === 'series_id_and_data_version_are_importer_supplied_metadata').length, 1);
});

test('compute_realized_covariance records its own scope, and check adds its limitations only when present', async (t) => {
  const { path, store } = await setup(t);
  const access = (i, patch = {}) => ({ ...query({ series_id: `S${i}` }), access_id: `rc-tool:${i}`,
    research_id: 'research:rc', purpose: 'exploration', request_sha256: version('d'), ...patch });
  await store.recordToolAccessBatch('compute_realized_covariance', [access(0), access(1, { series_id: 'S0' })]);
  assert.deepEqual((await saved(path)).map((r) => [r.tool_name, r.scope]),
    [0, 1].map(() => ['compute_realized_covariance', 'realized_covariance_bar_window_only']));
  const own = ['tool_observed_usage_is_realized_covariance_bar_window_only', 'proxy_rules_are_caller_research_choices'];
  const usage = await store.check(query({ series_id: 'S0' }));
  for (const l of own) assert.ok(usage.limitations.includes(l), l);
  assert.ok(!usage.limitations.includes('forecast_estimation_history_not_covered'));
  assert.ok(!usage.limitations.includes('ledger_trade_envelope_does_not_include_indicator_lookbacks'));
  // The limitations follow the tools present in the ledger, and the shared one appears once.
  await store.recordToolAccessBatch('compare_forecast_losses', [access(2)]);
  const mixed = await store.check(query({ series_id: 'S0' }));
  for (const l of [...own, 'forecast_estimation_history_not_covered']) assert.ok(mixed.limitations.includes(l), l);
  assert.equal(mixed.limitations.filter((l) => l === 'series_id_and_data_version_are_importer_supplied_metadata').length, 1);
  const { store: other } = await setup(t);
  await other.recordToolAccessBatch('compare_forecast_losses', [access(0)]);
  const without = await other.check(query({ series_id: 'S0' }));
  for (const l of own) assert.ok(!without.limitations.includes(l), l);
});

// docs/FORWARD_PERIOD_PLAN.md, step 1: a 0.1.15 golden written by make-format-0.1.15.mjs with the released build.
const FIXTURE_015 = new URL('../fixtures/period-usage/format-0.1.15.jsonl', import.meta.url);
test('records written in the 0.1.15 format, by every observing tool, still read, check and extend', async (t) => {
  const { path } = await setup(t);
  await writeFile(path, await readFile(FIXTURE_015, 'utf8'), { mode: 0o600 });
  const store = new ResearchPeriodUsageStore(path);
  const query015 = { series_id: 'fixture-series', data_version: 'sha256:' + 'a'.repeat(64),
    from: '2024-01-10T00:00:00.000Z', to: '2024-01-20T00:00:00.000Z' };
  const usage = await store.check(query015);
  assert.deepEqual(usage.matches.map((m) => [m.access_id, m.source, m.tool_name ?? null, m.scope ?? null]), [
    ['fixture15:manual', 'user_reported', null, null],
    ['fixture15:forecast:1', 'tool_observed', 'compare_forecast_losses', 'forecast_evaluation_window_only'],
    ['fixture15:rc:1', 'tool_observed', 'compute_realized_covariance', 'realized_covariance_bar_window_only'],
  ]);
  for (const l of ['tool_observed_usage_is_ledger_trade_envelope_only', 'tool_observed_usage_is_forecast_evaluation_window_only',
    'tool_observed_usage_is_realized_covariance_bar_window_only']) assert.ok(usage.limitations.includes(l), l);
  const [added] = await store.recordToolAccessBatch('compute_realized_covariance',
    [{ ...query015, access_id: 'fixture15:rc:2', research_id: 'r', purpose: 'exploration', request_sha256: 'sha256:' + '6'.repeat(64) }]);
  assert.deepEqual([added.sequence, added.prior_overlap.overlapping_records], [9, 3]);
  const manual = await store.record({ ...query015, access_id: 'fixture15:manual:2', research_id: 'r', purpose: 'validation',
    accessed_at: '2025-03-01T00:00:00.000Z' });
  assert.equal(manual.sequence, 10);
  assert.equal((await saved(path)).length, 10);
});

test('an injected clock drives recorded_at, the accessed_at check, the clock check and checked_at (plan P-Q1)', async (t) => {
  const { path } = await setup(t);
  const at = (iso) => () => new Date(iso);
  // A clock ahead of real time: accesses that are future by the real clock are past by the store's.
  const store = new ResearchPeriodUsageStore(path, undefined, { now: at('2030-01-01T00:00:00.000Z') });
  const manual = await store.record(input({ access_id: 'clock:1', accessed_at: '2029-12-31T00:00:00.000Z' }));
  assert.deepEqual([manual.recorded_at, manual.first_seen_at, manual.observation_date],
    ['2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z', '2030-01-01']);
  await assert.rejects(store.record(input({ access_id: 'clock:2', accessed_at: '2030-01-01T00:00:00.001Z' })), /accessed_at must not be in the future/);
  const exact = await store.record(input({ access_id: 'clock:2b', accessed_at: '2030-01-01T00:00:00.000Z' }));
  assert.equal(exact.accessed_at, exact.recorded_at, 'an access at exactly the store time is not in the future');
  await assert.rejects(store.recordBatch([input({ access_id: 'clock:3', accessed_at: '2030-01-02T00:00:00.000Z' })]), /in the future/);
  const tool = await store.recordToolAccess({ ...query(), access_id: 'clock:4', research_id: 'r', purpose: 'exploration',
    request_sha256: version('d') });
  assert.deepEqual([tool.accessed_at, tool.recorded_at], ['2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z']);
  assert.equal((await store.preflightOos(query({ series_id: 'other' }))).checked_at, '2030-01-01T00:00:00.000Z');
  // The same ledger read by a clock behind its last record fails closed on every path.
  const behind = new ResearchPeriodUsageStore(path, undefined, { now: at('2029-06-01T00:00:00.000Z') });
  await assert.rejects(behind.check(query()), /clock moved backwards/);
  await assert.rejects(behind.preflightOos(query()), /clock moved backwards/);
  await assert.rejects(behind.record(input({ access_id: 'clock:5', accessed_at: '2029-01-01T00:00:00.000Z' })), /clock moved backwards/);
  // The exported schema keeps the real clock.
  assert.equal(researchPeriodUsageRecordSchema.safeParse(input({ accessed_at: '2029-12-31T00:00:00.000Z' })).success, false);
});
