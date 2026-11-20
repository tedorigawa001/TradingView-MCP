import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { approvalRecord, planHash } from '../../scripts/run-npm-session-release.mjs';
import { A_RECORDS, B_RECORDS } from '../../scripts/prepare-npm-session-release.mjs';
import { ACCOUNT, PREFLIGHT_ID } from '../../scripts/npm-session-release.mjs';
import { ALLOCATION, LOGIN05_ID, SESSION_MS, checkAllocationArithmetic, checkAllocationChain, executePrep03Run,
  planFor, preflightTransport, safeReason } from '../../scripts/run-npm-prep03.mjs';
import { LIMITS, ROUTES } from '../../scripts/prepare-npm-preflight.mjs';

const ip = '192.0.2.71';
const urls = { loginUrl: 'https://www.npmjs.com/login/cli/mock-prep03', doneUrl: 'https://registry.npmjs.org/-/v1/done/mock-prep03' };
const token = 'npm_SyntheticPrep03TokenOnly';
const login = [[200, urls], [200, { token }]];
const queries = [[200, { username: ACCOUNT }], [200, { [ACCOUNT]: 'read-write' }], [404, 'version not found: 0.1.46'], [200, { latest: '0.1.45' }]];
const UTC0 = 1795000000000;

function fixture(t, responses = [...login, ...queries], extra = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-prep03-test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true }));
  const base = path.join(workspace, 'release-work');
  const loginRoot = path.join(base, LOGIN05_ID), preflightRoot = path.join(base, PREFLIGHT_ID), session = path.join(workspace, 'auth');
  fs.mkdirSync(loginRoot, { recursive: true });
  const plan = { id: LOGIN05_ID, fixture: true }, approvedHash = planHash(plan);
  const events = { lookups: [], requests: [], browser: [], time: 0, utc: UTC0, utcs: [], hooks: {}, recheck: approvedHash };
  const adapter = {
    lookup(host, opts, done) {
      events.lookups.push([host, opts]);
      queueMicrotask(() => done(null, ip, 4));
    },
    request(opts, receive) {
      const index = events.requests.push({ method: opts.method, path: opts.path, auth: Object.hasOwn(opts.headers, 'authorization') }) - 1;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => {
        queueMicrotask(() => {
          events.hooks.request?.(index, opts);
          const socket = new EventEmitter();
          Object.assign(socket, { authorized: true, remoteAddress: ip });
          req.emit('socket', socket);
          socket.emit('secureConnect');
          const [statusCode, data] = responses[index];
          const res = new IncomingMessage(new Socket());
          Object.assign(res, { statusCode, statusMessage: 'fixture', complete: true });
          res.destroy = () => { res.destroyed = true; };
          receive(res);
          if (!res.destroyed) res.emit('data', Buffer.from(JSON.stringify(data)));
          if (!res.destroyed) res.emit('end');
        });
      };
      return req;
    },
  };
  const read = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const options = { loginRoot, preflightRoot, session, plan, approvedHash, adapter,
    recheck: () => events.recheck, now: () => events.time, wall: () => events.utcs.length ? events.utcs.shift() : events.utc,
    beginBrowser(url) { events.browser.push(url); events.hooks.browser?.(); },
    sleep(ms) { events.time += ms; }, ...extra };
  return { loginRoot, preflightRoot, session, events, read, plan, approvedHash, run: more => executePrep03Run({ ...options, ...more }) };
}

function allText(root) {
  return fs.existsSync(root) ? fs.readdirSync(root).map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') : '';
}

test('one approval runs login05 and then exactly four read-only preflight GETs', async t => {
  const f = fixture(t);
  const result = await f.run();
  assert.equal(result.status, 'session_verified');
  assert.equal(result.preflight.status, 'queries_confirmed');
  assert.deepEqual(result.counts, { dns_calls: 1, post_attempts: 1, get_attempts: 1, put_attempts: 0, secondary_lookup_attempts: 0 });
  assert.deepEqual(result.preflight.counts, { dns_calls: 1, get_attempts: 4, put_attempts: 0, secondary_lookup_attempts: 0 });
  assert.deepEqual(f.events.requests.map(r => [r.method, r.path, r.auth]), [
    ['POST', '/-/v1/login', false], ['GET', '/-/v1/done/mock-prep03', false],
    ['GET', '/-/whoami', true], ['GET', '/-/package/bushido-tradingview-mcp/collaborators', true],
    ['GET', '/bushido-tradingview-mcp/0.1.46', true], ['GET', '/-/package/bushido-tradingview-mcp/dist-tags', true]]);
  assert.equal(f.events.lookups.length, 2);
  assert.deepEqual(fs.readdirSync(f.loginRoot).sort(), ['login-approval.json', 'login-readback.json', 'login-status.json']);
  assert.deepEqual(fs.readdirSync(f.preflightRoot).sort(), ['account.json', 'approval-preflight.json', 'login-binding.json',
    'preflight-readback.json', 'preflight-status.json', 'rights.json', 'tag.json', 'version.json']);
  const status = f.read(f.loginRoot, 'login-status.json');
  assert.equal(status.started_at_utc_ms, UTC0);
  assert.equal(status.confirmed_at_utc_ms, UTC0);
  assert.equal(status.session_deadline_utc_ms, UTC0 + SESSION_MS);
  assert.equal(status.publication_approved, false);
  const binding = f.read(f.preflightRoot, 'login-binding.json');
  assert.equal(binding.login_id, LOGIN05_ID);
  assert.equal(binding.account, ACCOUNT);
  assert.deepEqual(binding.session_identity, status.session_identity);
  assert.equal(f.read(f.preflightRoot, 'version.json').exists, false);
  assert.equal(f.read(f.preflightRoot, 'account.json').account_matches, true);
  assert.equal(Object.hasOwn(f.read(f.preflightRoot, 'account.json'), 'username'), false);
  assert.equal(f.read(f.preflightRoot, 'preflight-readback.json').verified, true);
  assert.ok(!allText(f.loginRoot).includes(token) && !allText(f.preflightRoot).includes(token));
  assert.equal(fs.readFileSync(path.join(f.session, 'user.npmrc'), 'utf8'), `//registry.npmjs.org/:_authToken=${token}\n`);
});

test('a failed login never creates preflight records or performs preflight DNS', async t => {
  const f = fixture(t, [[401, { error: 'denied' }]]);
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'login_http_status');
  assert.deepEqual(result.http_failure, { phase: 'login_post', http_status: 401 });
  assert.equal(result.preflight, null);
  assert.equal(fs.existsSync(f.preflightRoot), false);
  assert.equal(f.events.lookups.length, 1);
  assert.equal(f.read(f.loginRoot, 'login-status.json').confirmed_at_utc_ms, null);
});

test('a preflight HTTP failure is recorded once, with no retry and no further request', async t => {
  const f = fixture(t, [...login, [401, { error: 'unauthorized' }]]);
  const result = await f.run();
  assert.equal(result.status, 'session_verified');
  assert.equal(result.preflight.status, 'stopped');
  assert.equal(result.preflight.reason, 'http_status_401');
  assert.equal(result.preflight.counts.get_attempts, 1);
  assert.equal(f.events.requests.length, 3);
  assert.equal(f.read(f.preflightRoot, 'preflight-status.json').no_retry, true);
  assert.equal(fs.existsSync(path.join(f.preflightRoot, 'account.json')), false);
});

test('preflight admission stops before DNS when the UTC session deadline has passed', async t => {
  const f = fixture(t);
  // UTC reads: login start, login confirmation, preflight admission.
  f.events.utcs.push(UTC0, UTC0 + 1000, UTC0 + SESSION_MS);
  const result = await f.run();
  assert.equal(result.status, 'session_verified');
  assert.equal(result.stage, 'preflight_admission');
  assert.equal(result.preflight.reason, 'session_deadline');
  assert.equal(fs.existsSync(f.preflightRoot), false);
  assert.equal(f.events.lookups.length, 1);
});

test('a UTC jump inside the login stage stops the login instead of trusting the session time', async t => {
  const f = fixture(t);
  f.events.utcs.push(UTC0, UTC0 + SESSION_MS);
  const result = await f.run();
  assert.equal(result.stage, 'login');
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'utc_clock_unconfirmed');
  assert.equal(result.preflight, null);
  assert.equal(fs.existsSync(f.preflightRoot), false);
});

test('changed approved inputs after login stop the preflight before DNS', async t => {
  const f = fixture(t);
  f.events.hooks.request = index => { if (index === 1) f.events.recheck = 'f'.repeat(64); };
  const result = await f.run();
  assert.equal(result.stage, 'login');
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'execution_inputs_changed');
  assert.equal(fs.existsSync(f.preflightRoot), false);
});

test('approved inputs are rechecked at admission, before preflight DNS and after the last GET', async t => {
  const cases = [
    ['admission', f => fs.existsSync(path.join(f.loginRoot, 'login-readback.json')) && !fs.existsSync(f.preflightRoot), 'preflight_admission', 0],
    ['before_dns', f => fs.existsSync(path.join(f.preflightRoot, 'login-binding.json')) && f.events.lookups.length === 1, 'preflight', 0],
    ['after_last_get', f => fs.existsSync(path.join(f.preflightRoot, 'tag.json')), 'preflight', 4],
  ];
  for (const [name, drifted, stage, gets] of cases) {
    const f = fixture(t);
    const good = f.approvedHash;
    const result = await f.run({ recheck: () => drifted(f) ? 'd'.repeat(64) : good });
    assert.equal(result.status, 'session_verified', name);
    assert.equal(result.stage, stage, name);
    assert.equal(result.preflight.status, 'stopped', name);
    assert.equal(result.preflight.reason, 'execution_inputs_changed', name);
    assert.equal(result.preflight.counts.get_attempts, gets, name);
    if (name === 'admission') assert.equal(fs.existsSync(f.preflightRoot), false);
    else assert.equal(f.read(f.preflightRoot, 'preflight-status.json').status, 'stopped');
  }
});

test('the preflight transport admits only one DNS lookup and the four fixed GET routes in order', () => {
  const ip4 = '192.0.2.99', routes = Object.values(ROUTES);
  const make = () => {
    const calls = [];
    const adapter = { lookup: (h, o, cb) => { calls.push('dns'); cb(null, ip4, 4); }, request: o => { calls.push(o.path); return {}; } };
    const transport = preflightTransport({ adapter, before: () => calls.push('before') });
    transport.lookup('registry.npmjs.org', { family: 4, all: false }, () => {});
    return { transport, calls };
  };
  const options = path => ({ hostname: ip4, servername: 'registry.npmjs.org', port: 443, family: 4, agent: false, autoSelectFamily: false,
    rejectUnauthorized: true, maxHeaderSize: LIMITS.headerBytes, method: 'GET', path, lookup: () => {} });
  const ok = make();
  for (const route of routes) ok.transport.request(options(route));
  ok.transport.complete();
  assert.deepEqual(ok.calls, ['before', 'dns', ...routes.flatMap(r => ['before', r])]);
  assert.throws(() => ok.transport.request(options(routes[0])), /prep03_transport_scope/);
  for (const change of [{ path: routes[1] }, { method: 'PUT' }, { method: 'POST' }, { hostname: '192.0.2.1' }, { port: 80 },
    { rejectUnauthorized: false }, { agent: undefined }]) {
    const m = make();
    assert.throws(() => m.transport.request({ ...options(routes[0]), ...change }), /prep03_transport_scope/);
    assert.deepEqual(m.calls, ['before', 'dns', 'before']);
  }
  const twice = make();
  assert.throws(() => twice.transport.lookup('registry.npmjs.org', { family: 4, all: false }, () => {}), /prep03_dns_scope/);
  const partial = make();
  partial.transport.request(options(routes[0]));
  assert.throws(() => partial.transport.complete(), /prep03_transport_scope/);
});

test('a different npm account or an existing target version stops the preflight', async t => {
  for (const [responses, reason, gets] of [
    [[...login, [200, { username: 'someone-else' }]], 'session_account_mismatch', 1],
    [[...login, queries[0], queries[1], [200, { version: '0.1.46' }]], 'version_availability_unconfirmed', 3],
  ]) {
    const f = fixture(t, responses);
    const result = await f.run();
    assert.equal(result.preflight.status, 'stopped');
    assert.equal(result.preflight.reason, reason);
    assert.equal(result.preflight.counts.get_attempts, gets);
  }
});

test('an additional DNS lookup during preflight is counted and refused', async t => {
  const f = fixture(t);
  f.events.hooks.request = (index, opts) => { if (index === 2) opts.lookup('elsewhere.example', {}, () => {}); };
  const result = await f.run();
  assert.equal(result.preflight.status, 'stopped');
  assert.equal(result.preflight.counts.secondary_lookup_attempts, 1);
  assert.equal(result.preflight.reason, 'prep03_transport_scope');
});

test('an existing preflight scope or session refuses before any network or record', async t => {
  for (const which of ['preflightRoot', 'session']) {
    const f = fixture(t);
    fs.mkdirSync(f[which]);
    await assert.rejects(f.run(), /prep03_scope_exists/);
    assert.equal(f.events.lookups.length, 0);
    assert.deepEqual(fs.readdirSync(f.loginRoot), []);
  }
});

test('the approval must match the plan exactly', async t => {
  const f = fixture(t);
  await assert.rejects(f.run({ approvedHash: 'a'.repeat(64) }), /approval_mismatch/);
  assert.equal(f.events.lookups.length, 0);
});

test('only fixed reason codes reach records', () => {
  for (const code of ['http_status_401', 'dns_error_ENOTFOUND', 'session_deadline', 'login_poll_limit', 'version_availability_unconfirmed'])
    assert.equal(safeReason(code), code);
  for (const code of ['npm_SecretTokenLeak', 'dns_error_enotfound', 'http_status_999', undefined, {}])
    assert.equal(safeReason(code), 'execution_stopped');
});

test('the new reservation extends login04 exactly and the approval records fit their slots', () => {
  checkAllocationArithmetic();
  const login04 = { cumulative: 50236402, remaining_pool: 30874441, campaign_cap: 88080384, protected_765_bytes_used: 0 };
  checkAllocationChain(login04);
  for (const change of [{ cumulative: 50236403 }, { remaining_pool: 30874440 }, { campaign_cap: 1 }, { protected_765_bytes_used: 1 }])
    assert.throws(() => checkAllocationChain({ ...login04, ...change }), /prep03_allocation_changed/);
  assert.equal(ALLOCATION.cumulative, 50301938);
  const h = 'e'.repeat(64);
  const inputs = { id: LOGIN05_ID, preflight_id: PREFLIGHT_ID,
    login_root: '/Users/operator/Downloads/GitHub/TradingView-MCP/.release-work/' + LOGIN05_ID,
    preflight_root: '/Users/operator/Downloads/GitHub/TradingView-MCP/.release-work/' + PREFLIGHT_ID,
    session_file: '/private/tmp/TradingView-MCP-npm-0.1.46-login05/user.npmrc', account: ACCOUNT,
    candidate: '8d97bbaaf2360fe83b2ff6dd36ebef4887c0acc9', artifact_sha256: h, rebind: { approval: { sha256: h } },
    record_limits: { login: A_RECORDS, preflight: B_RECORDS } };
  const plan = planFor(inputs, { reservation_sha256: h, inputs_sha256: h, tests_sha256: h, preparation_readback_sha256: h });
  const record = approvalRecord(LOGIN05_ID, plan, planHash(plan));
  assert.ok(Buffer.byteLength(JSON.stringify(record) + '\n') <= A_RECORDS['login-approval.json']);
  const preflightApproval = { id: PREFLIGHT_ID, run_id: LOGIN05_ID, approved_hash: h, plan, consumed: true, publication_approved: false };
  assert.ok(Buffer.byteLength(JSON.stringify(preflightApproval) + '\n') <= B_RECORDS['approval-preflight.json']);
});
