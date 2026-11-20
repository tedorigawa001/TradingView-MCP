import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ACCOUNT, LOGIN_ID, PREFLIGHT_ID, MAX_POLLS, loginEndpoints, readPrivateSession } from '../../scripts/npm-session-release.mjs';
import { LIMITS, ROUTES } from '../../scripts/prepare-npm-preflight.mjs';
import { executeLogin, executePreflight, loadLoginBinding, planHash, runtimeLimits } from '../../scripts/run-npm-session-release.mjs';
import { CAPACITY, snapshotForPreflightRebind, verifyReboundPreflightTools } from '../../scripts/prepare-npm-session-release.mjs';

const address = '192.0.2.16';
const secret = 'npm_SyntheticRuntimeTokenForTest';
const browserUrl = 'https://www.npmjs.com/login?next=%2Flogin%2Fcli%2Fsimulated-browser-id';
const pollUrl = 'https://registry.npmjs.org/-/v1/done?sessionId=simulated-poll-id';
const init = [200, { loginUrl: browserUrl, doneUrl: pollUrl }];
const waiting = [202, {}, { 'retry-after': '1' }];
const loggedIn = [200, { token: secret }];
const checks = [[200, { username: ACCOUNT }], [200, { [ACCOUNT]: 'write' }],
  [404, { error: 'version not found: 0.1.46' }], [200, { latest: '0.1.45' }]];

test('the rebound preparation accepts only the approved old-to-new tool bindings', () => {
  const row = bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  const specs = [
    ['scripts/preflight.mjs', 'old parser', 'new parser'],
    ['test/preflight.test.mjs', 'old test', 'new test'],
    ['scripts/other.mjs', 'unchanged', 'unchanged'],
  ];
  const old = specs.map(([file, before]) => ({ file, ...row(Buffer.from(before)) }));
  const content = new Map(specs.map(([file, , after]) => [file, Buffer.from(after)]));
  const approved = {
    approved_input_changes: specs.slice(0, 2).map(([file, before, after]) => ({
      file, before: row(Buffer.from(before)), after: row(Buffer.from(after)),
    })),
    unchanged_legacy_tools: [old[2]],
  };
  const read = (file, limit) => {
    assert.equal(limit, 64 * 1024);
    const bytes = content.get(path.relative('/repo', file).split(path.sep).join('/'));
    assert.ok(bytes);
    return bytes;
  };
  const verify = (baseline = old, approval = approved) => verifyReboundPreflightTools('/repo', baseline, approval, read);
  assert.deepEqual(verify(), specs.map(([file]) => ({ file, ...row(content.get(file)) })));
  assert.throws(() => verify([{ ...old[0], bytes: old[0].bytes + 1 }, ...old.slice(1)]), /preflight_rebind_legacy_tool_changed/);
  assert.throws(() => verify(old.slice(0, 2)), /preflight_rebind_tool_scope/);
  assert.throws(() => verify(old, { ...approved, unchanged_legacy_tools: [old[0]] }), /preflight_rebind_tool_scope/);
  content.set(specs[0][0], Buffer.from('old parser'));
  assert.throws(() => verify(), /preflight_rebind_current_tool_changed/);
  content.set(specs[0][0], Buffer.from('new parser'));
  content.set(specs[2][0], Buffer.from('altered diagnostics'));
  assert.throws(() => verify(), /preflight_rebind_current_tool_changed/);
});

test('the offline rebind checks the approval hash before reading preparation evidence', t => {
  const { dirs } = fixture(t);
  const root = path.dirname(dirs.loginRoot);
  fs.mkdirSync(path.join(root, 'packaging'));
  const file = path.join(root, 'packaging', 'npm-preflight-input-rebind-0.1.46.json');
  const approved = fs.readFileSync(new URL('../../packaging/npm-preflight-input-rebind-0.1.46.json', import.meta.url));
  fs.writeFileSync(file, Buffer.concat([approved, Buffer.from('\n')]));
  assert.throws(() => snapshotForPreflightRebind(root), /preflight_rebind_approval_changed/);
  assert.ok(!fs.existsSync(path.join(root, '.release-work')));
});

function mock(rows, intercept = () => {}) {
  const calls = { dns: 0, http: [] };
  return { calls, adapter: {
    lookup(host, opts, cb) {
      assert.equal(host, 'registry.npmjs.org');
      assert.deepEqual(opts, { family: 4, all: false });
      calls.dns++;
      cb(null, address, 4);
    },
    request(options, deliver) {
      const index = calls.http.push([options.method, options.path]) - 1;
      const req = new EventEmitter(); req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        if (intercept({ index, options, req })) return;
        const socket = new EventEmitter();
        Object.assign(socket, { authorized: true, remoteAddress: address });
        req.emit('socket', socket);
        socket.emit('secureConnect');
        const [statusCode, data, headers = {}] = rows[index];
        const res = new EventEmitter();
        Object.assign(res, { statusCode, statusMessage: 'synthetic', headers, rawHeaders: [], complete: true });
        res.destroy = () => { res.destroyed = true; };
        deliver(res);
        if (!res.destroyed) res.emit('data', Buffer.from(JSON.stringify(data)));
        if (!res.destroyed) res.emit('end');
      });
      return req;
    },
  } };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-session-execution-test-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const dirs = { loginRoot: path.join(root, 'login'), preflightRoot: path.join(root, 'preflight'), sessionRoot: path.join(root, 'private') };
  fs.mkdirSync(dirs.loginRoot, { mode: 0o700 });
  const aPlan = { id: LOGIN_ID, phase: 'login_only' };
  const aHash = planHash(aPlan);
  const a = { ...dirs, plan: aPlan, approvedHash: aHash, recheck: () => aHash, startedAt: 0, now: () => 0,
    wall: () => 1000, sleep() {}, beginBrowser() {} };
  function binding(proof, extra = {}) { return loadLoginBinding({ ...dirs, proof, loginPlanHash: aHash, wall: () => 1100, ...extra }); }
  function b(proof) {
    const plan = { id: PREFLIGHT_ID, phase: 'preflight_only', binding: binding(proof) };
    const hash = planHash(plan);
    return { ...dirs, plan, approvedHash: hash, recheck: () => hash, proof, startedAt: 0, now: () => 0, wall: () => 1100 };
  }
  const read = (phase, file) => JSON.parse(fs.readFileSync(path.join(dirs[phase + 'Root'], file), 'utf8'));
  return { dirs, b, binding, read, login: (extra = {}) => executeLogin({ ...a, adapter: mock([init, loggedIn]).adapter, ...extra }) };
}

test('browser handoff rejects foreign, ambiguous, double-encoded or noncanonical next destinations', () => {
  for (const value of [
    'https://www.npmjs.com/login?next=https%3A%2F%2Fexample.invalid',
    'https://www.npmjs.com/login?next=%2F%2Fexample.invalid',
    'https://www.npmjs.com/login?next=%252Flogin%252Fcli%252Fid',
    browserUrl + '&next=%2Flogin%2Fcli%2Fsecond',
    browserUrl + '&other=value',
    'https://www.npmjs.com/extra/../login?next=%2Flogin%2Fcli%2Fid',
    'https://www.npmjs.com/login/cli/id?next=%2Flogin%2Fcli%2Fsecond',
  ]) assert.throws(() => loginEndpoints(value, pollUrl), /login_url_rejected/);
  for (const value of [pollUrl + '&sessionId=second', pollUrl + '&other=value', 'https://registry.npmjs.org/-/v1/done']) {
    assert.throws(() => loginEndpoints(browserUrl, value), /login_url_rejected/);
  }
  assert.deepEqual(loginEndpoints(browserUrl, pollUrl), { browser: browserUrl, poll: '/-/v1/done?sessionId=simulated-poll-id' });
  assert.deepEqual(loginEndpoints('https://www.npmjs.com/login/cli/id', 'https://registry.npmjs.org/-/v1/done/poll'),
    { browser: 'https://www.npmjs.com/login/cli/id', poll: '/-/v1/done/poll' });
});

test('login and preflight separately consume approvals before dispatch and verify durable summaries', async t => {
  const f = fixture(t);
  const a = mock([init, waiting, loggedIn], ({ index }) => {
    assert.equal(f.read('login', 'login-approval.json').consumed, true);
    if (index === 0) assert.ok(!fs.existsSync(f.dirs.sessionRoot));
  });
  const result = await f.login({ adapter: a.adapter, beginBrowser(url) { assert.equal(url, browserUrl); } });
  assert.equal(result.status, 'login_confirmed');
  assert.equal(result.counts.post_attempts, 1);
  assert.equal(result.counts.get_attempts, 2);
  assert.equal(a.calls.dns, 1);
  assert.equal(readPrivateSession(f.dirs.sessionRoot), secret);
  assert.ok(!fs.existsSync(f.dirs.preflightRoot));
  assert.match(result.completion_proof, /^[a-f0-9]{64}$/);
  const b = mock(checks, () => assert.equal(f.read('preflight', 'approval-preflight.json').consumed, true));
  const query = await executePreflight({ ...f.b(result.completion_proof), adapter: b.adapter });
  assert.equal(query.status, 'queries_confirmed');
  assert.equal(b.calls.dns, 1);
  assert.deepEqual(b.calls.http, Object.values(ROUTES).map(route => ['GET', route]));
  assert.equal(f.read('preflight', 'preflight-readback.json').rows.length, 7);
  for (const dir of [f.dirs.loginRoot, f.dirs.preflightRoot]) {
    for (const file of fs.readdirSync(dir)) {
      const contents = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const hidden of [secret, browserUrl, pollUrl, result.completion_proof, query.completion_proof]) assert.ok(!contents.includes(hidden));
    }
  }
  assert.equal(query.publication_approved, false);
  assert.equal(query.protected_765_bytes_used, 0);
});

test('wrong approval or a changed plan causes no login receipt or network activity', async t => {
  const f = fixture(t), m = mock([]);
  await assert.rejects(f.login({ adapter: m.adapter, approvedHash: '0'.repeat(64) }), /approval_mismatch/);
  await assert.rejects(f.login({ adapter: m.adapter, recheck: () => '0'.repeat(64) }), /approval_mismatch/);
  assert.deepEqual(m.calls, { dns: 0, http: [] });
  assert.deepEqual(fs.readdirSync(f.dirs.loginRoot), []);
});

test('one-use login and preflight claims block concurrent duplicate execution', async t => {
  const f = fixture(t), a = mock([init, loggedIn]);
  const [first, duplicate] = await Promise.allSettled([f.login({ adapter: a.adapter }), f.login({ adapter: a.adapter })]);
  assert.equal(first.value.status, 'login_confirmed');
  assert.match(duplicate.reason.message, /scope_already_consumed/);
  assert.equal(a.calls.dns, 1);
  const b = mock(checks);
  const spec = { ...f.b(first.value.completion_proof), adapter: b.adapter };
  const [queries, secondQueries] = await Promise.allSettled([executePreflight(spec), executePreflight(spec)]);
  assert.equal(queries.value.status, 'queries_confirmed');
  assert.equal(secondQueries.reason.code, 'EEXIST');
  assert.equal(b.calls.dns, 1);
});

test('preflight syncs the parent directory after saving the claim and before the first DNS call', async t => {
  const f = fixture(t), login = await f.login(), m = mock(checks);
  const parent = fs.lstatSync(path.dirname(f.dirs.preflightRoot), { bigint: true });
  const native = fs.fsyncSync;
  const observed = [];
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd, { bigint: true });
    const result = native(fd);
    if (stat.dev === parent.dev && stat.ino === parent.ino) {
      assert.equal(f.read('preflight', 'approval-preflight.json').consumed, true);
      observed.push('parent_sync');
    }
    return result;
  });
  const result = await executePreflight({ ...f.b(login.completion_proof), adapter: { ...m.adapter, lookup(...args) {
    observed.push('dns');
    return m.adapter.lookup(...args);
  } } });
  assert.equal(result.status, 'queries_confirmed');
  assert.equal(result.parent_directory_synced, true);
  assert.deepEqual(observed, ['parent_sync', 'dns']);
});

test('a failed parent directory sync consumes the preflight claim and stops with zero communication', async t => {
  const f = fixture(t), login = await f.login(), m = mock(checks);
  const parent = fs.lstatSync(path.dirname(f.dirs.preflightRoot), { bigint: true });
  const native = fs.fsyncSync;
  let parentAttempts = 0;
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (stat.dev === parent.dev && stat.ino === parent.ino) {
      parentAttempts++;
      throw Object.assign(Error('synthetic sync failure'), { code: 'EIO' });
    }
    return native(fd);
  });
  const options = { ...f.b(login.completion_proof), adapter: m.adapter };
  const result = await executePreflight(options);
  assert.equal(parentAttempts, 1);
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'preflight_parent_sync_unconfirmed');
  assert.equal(result.parent_directory_synced, false);
  assert.equal(result.completion_proof, null);
  assert.deepEqual(m.calls, { dns: 0, http: [] });
  assert.deepEqual(result.counts, { dns_calls: 0, post_attempts: 0, get_attempts: 0, put_attempts: 0, secondary_lookup_attempts: 0 });
  assert.equal(f.read('preflight', 'approval-preflight.json').consumed, true);
  assert.equal(f.read('preflight', 'preflight-status.json').reason, result.reason);
  assert.equal(f.read('preflight', 'preflight-readback.json').status, 'stopped');
  await assert.rejects(executePreflight(options), { code: 'EEXIST' });
});

test('poll cap and transport failure retain a consumed approval with exact attempt counts', async t => {
  const f = fixture(t), m = mock([init, ...Array(MAX_POLLS).fill(waiting)]);
  const stopped = await f.login({ adapter: m.adapter });
  assert.equal(stopped.reason, 'login_poll_limit');
  assert.equal(stopped.counts.get_attempts, MAX_POLLS);
  assert.equal(stopped.counts.post_attempts, 1);
  assert.equal(stopped.completion_proof, null);
  await assert.rejects(f.login(), /scope_already_consumed/);
  const g = fixture(t), error = mock([init, loggedIn], ({ index, req }) => {
    if (index === 1) { req.emit('error', Error(secret)); return true; }
  });
  const failed = await g.login({ adapter: error.adapter });
  assert.equal(failed.reason, 'login_transport_error');
  assert.equal(error.calls.http.length, 2);
  assert.ok(!JSON.stringify(failed).includes(secret));
});

test('login HTTP stops persist only the phase and numeric status for POST and poll responses', async t => {
  const privateHeader = 'synthetic-private-header';
  const headers = { 'x-private': privateHeader, location: browserUrl };
  const cases = [
    { rows: [[201, { ...init[1], token: secret }, headers]], phase: 'login_post', status: 201, gets: 0 },
    { rows: [init, [429, { message: secret, url: pollUrl }, headers]], phase: 'poll_get', status: 429, gets: 1 },
  ];
  for (const { rows, phase, status, gets } of cases) {
    const f = fixture(t), m = mock(rows);
    const result = await f.login({ adapter: m.adapter });
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, 'login_http_status');
    assert.equal(result.counts.post_attempts, 1);
    assert.equal(result.counts.get_attempts, gets);
    assert.equal(m.calls.http.length, 1 + gets);
    assert.equal(result.completion_proof, null);
    const expected = { phase, http_status: status };
    assert.deepEqual(result.http_failure, expected);
    const saved = f.read('login', 'login-status.json');
    assert.deepEqual(saved.http_failure, expected);
    assert.equal(f.read('login', 'login-readback.json').verified, true);
    assert.ok(!fs.existsSync(f.dirs.sessionRoot));
    for (const hidden of [secret, privateHeader, browserUrl, pollUrl]) {
      assert.ok(!JSON.stringify([result, saved]).includes(hidden));
    }
  }
});

test('invalid statuses are not copied into diagnostic records', async t => {
  const f = fixture(t), m = mock([[secret, { error: secret }]]);
  const stopped = await f.login({ adapter: m.adapter });
  assert.equal(stopped.reason, 'login_response_shape');
  assert.equal(stopped.http_failure, undefined);
  assert.ok(!JSON.stringify(f.read('login', 'login-status.json')).includes(secret));
});

test('a session file with no deadline-qualified login does not authorize preflight', async t => {
  const f = fixture(t);
  const stamp = path.join(f.dirs.loginRoot, 'login-readback.json');
  const late = await f.login({ now: () => fs.existsSync(stamp) ? LIMITS.stageMs : 0 });
  assert.equal(late.status, 'stopped');
  assert.equal(late.completion_proof, null);
  assert.equal(readPrivateSession(f.dirs.sessionRoot), secret);
  assert.equal(f.read('login', 'login-readback.json').status, 'login_confirmed');
  assert.throws(() => f.binding('0'.repeat(64)), /login_completion_unconfirmed/);
  assert.ok(!fs.existsSync(f.dirs.preflightRoot));
});

test('missing proof, expiry or replaced credentials block preflight before DNS', async t => {
  const f = fixture(t);
  const a = await f.login();
  const b = mock([]), spec = { ...f.b(a.completion_proof), adapter: b.adapter };
  assert.throws(() => f.binding(undefined), /login_completion_unconfirmed/);
  assert.throws(() => f.binding(a.completion_proof, { wall: () => 1000 + 2 * 60 * 60 * 1000 }), /session_time_unconfirmed/);
  const file = path.join(f.dirs.sessionRoot, 'user.npmrc');
  fs.renameSync(file, file + '.retired');
  fs.writeFileSync(file, '//registry.npmjs.org/:_authToken=' + secret + '\n', { mode: 0o600 });
  await assert.rejects(executePreflight(spec), /session_path_changed/);
  assert.deepEqual(b.calls, { dns: 0, http: [] });
  assert.ok(!fs.existsSync(f.dirs.preflightRoot));
});

test('credential replacement after the initial GET prevents a second GET', async t => {
  const f = fixture(t), a = await f.login();
  const m = mock(checks, ({ index }) => {
    if (index === 0) fs.chmodSync(path.join(f.dirs.sessionRoot, 'user.npmrc'), 0o644);
  });
  const b = await executePreflight({ ...f.b(a.completion_proof), adapter: m.adapter });
  assert.equal(b.status, 'stopped');
  assert.deepEqual(m.calls.http, [['GET', ROUTES.account]]);
  assert.equal(b.completion_proof, null);
});

test('a secondary resolver call is refused and cannot lead to another dispatch', async t => {
  const f = fixture(t), a = await f.login();
  const m = mock(checks, ({ options }) => { options.lookup('unused', {}, error => assert.ok(error)); });
  const b = await executePreflight({ ...f.b(a.completion_proof), adapter: m.adapter });
  assert.equal(b.status, 'stopped');
  assert.equal(b.counts.secondary_lookup_attempts, 1);
  assert.equal(b.counts.get_attempts, 1);
});

test('a partial receipt and time spent before dispatch cannot enable a new attempt', async t => {
  const f = fixture(t), m = mock([]);
  await assert.rejects(f.login({ adapter: m.adapter, now: () => LIMITS.stageMs }), /stage_deadline/);
  fs.writeFileSync(path.join(f.dirs.loginRoot, 'login-approval.json'), 'partial');
  await assert.rejects(f.login({ adapter: m.adapter }), /scope_already_consumed/);
  assert.equal(m.calls.dns, 0);
  assert.equal(fs.readFileSync(path.join(f.dirs.loginRoot, 'login-approval.json'), 'utf8'), 'partial');
});

test('a preflight readback completing after deadline has no usable completion proof', async t => {
  const f = fixture(t), a = await f.login();
  const m = mock(checks);
  const stop = await executePreflight({ ...f.b(a.completion_proof), adapter: m.adapter,
    now: () => fs.existsSync(path.join(f.dirs.preflightRoot, 'preflight-readback.json')) ? LIMITS.stageMs : 0 });
  assert.equal(stop.status, 'stopped');
  assert.equal(stop.reason, 'preflight_completion_unconfirmed');
  assert.equal(stop.completion_proof, undefined);
  assert.equal(stop.counts.get_attempts, 4);
});

test('the supplemented preparation fits in A with fixed future execution slots and no new reservation', () => {
  const allotted = Object.values(runtimeLimits).reduce((sum, bytes) => sum + bytes, 0);
  assert.equal(allotted + CAPACITY.credential, CAPACITY.phase_a);
  assert.equal(CAPACITY.protected_765_bytes_used, 0);
});
