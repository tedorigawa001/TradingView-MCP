import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ACCOUNT, MAX_POLLS, readPrivateSession, runSessionPreflight, runWebLogin, writePrivateSession } from '../../scripts/npm-session-release.mjs';
import { checkBudget } from '../../scripts/prepare-npm-session-release.mjs';
import { LIMITS, ROUTES } from '../../scripts/prepare-npm-preflight.mjs';

const ip = '192.0.2.4';
const token = 'npm_SyntheticTokenForTestingOnly';
const loginUrl = 'https://www.npmjs.com/login?next=%2Flogin%2Fcli%2Fsynthetic';
const doneUrl = 'https://registry.npmjs.org/-/v1/done?sessionId=synthetic';
const start = [200, { loginUrl, doneUrl }];
const waiting = [202, {}, { 'retry-after': '2' }];
const success = [200, { token }];

function fixture(responses, { lookup, incoming = () => {}, socket: props = {} } = {}) {
  const trace = { dns: [], requests: [], local: [], waits: [] };
  let time = 0;
  const options = {
    lookup(host, opts, cb) {
      trace.dns.push([host, opts]);
      if (lookup) return lookup(cb);
      cb(null, ip, 4);
    },
    request(opts, cb) {
      const req = new EventEmitter();
      req.destroy = () => { req.destroyed = true; };
      req.end = body => queueMicrotask(() => {
        const index = trace.requests.push({ ...opts, body }) - 1;
        const [status, value, headers = {}] = responses[index];
        const res = new EventEmitter(), socket = new EventEmitter();
        Object.assign(socket, { remoteAddress: ip, authorized: true }, props);
        Object.assign(res, { statusCode: status, statusMessage: 'synthetic', headers, rawHeaders: [], complete: true });
        res.destroy = () => { res.destroyed = true; };
        if (incoming({ index, opts, req, res })) return;
        req.emit('socket', socket);
        socket.emit('secureConnect');
        cb(res);
        if (!res.destroyed) res.emit('data', Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)));
        if (!res.destroyed) res.emit('end');
      });
      return req;
    },
    beginBrowser(url) { trace.local.push(['browser', url]); },
    writeSession(secret) { trace.local.push(['save', secret]); },
    sleep(ms) { trace.waits.push(ms); time += ms; },
    now: () => time,
  };
  return { options, trace };
}

test('one DNS call, one unauthenticated login POST and bounded pinned GETs before local secret storage', async () => {
  const { options, trace } = fixture([start, waiting, success]);
  const result = await runWebLogin(options);
  assert.deepEqual(result, { dns_calls: 1, login_post_attempts: 1, poll_get_attempts: 2, session_saved: true });
  assert.deepEqual(trace.dns, [['registry.npmjs.org', { family: 4, all: false }]]);
  assert.deepEqual(trace.requests.map(({ method, path }) => [method, path]), [
    ['POST', '/-/v1/login'], ['GET', '/-/v1/done?sessionId=synthetic'], ['GET', '/-/v1/done?sessionId=synthetic'],
  ]);
  for (const request of trace.requests) {
    assert.equal(request.hostname, ip);
    assert.equal(request.servername, 'registry.npmjs.org');
    assert.equal(request.agent, false);
    assert.equal(request.autoSelectFamily, false);
    assert.equal(request.rejectUnauthorized, true);
    assert.equal(request.maxHeaderSize, LIMITS.headerBytes);
    assert.equal(request.headers.authorization, undefined);
  }
  assert.equal(trace.requests[0].body, '{}');
  assert.deepEqual(trace.waits, [2000]);
  assert.deepEqual(trace.local, [['browser', loginUrl], ['save', token]]);
  assert.ok(!JSON.stringify(result).includes(token));
});

test('the twelfth pending response stops even if the server would keep polling', async () => {
  const { options, trace } = fixture([start, ...Array(MAX_POLLS).fill(waiting)]);
  await assert.rejects(runWebLogin(options), /login_poll_limit/);
  assert.equal(trace.requests.length, 1 + MAX_POLLS);
  assert.equal(trace.waits.length, MAX_POLLS - 1);
  assert.deepEqual(trace.local, [['browser', loginUrl]]);
});

test('DNS, HTTPS peer and secondary DNS anomalies prevent continuation', async () => {
  const dns = fixture([], { lookup(cb) { cb(Error('fake secret')); } });
  await assert.rejects(runWebLogin(dns.options), /login_dns_unconfirmed/);
  assert.equal(dns.trace.requests.length, 0);
  const peer = fixture([start], { socket: { remoteAddress: '192.0.2.7' } });
  await assert.rejects(runWebLogin(peer.options), /login_peer_unconfirmed/);
  const second = fixture([start], { incoming({ opts }) { opts.lookup('unused', {}, e => assert.ok(e)); return true; } });
  await assert.rejects(runWebLogin(second.options), /login_second_dns/);
  for (const { trace } of [peer, second]) {
    assert.equal(trace.requests.length, 1);
    assert.deepEqual(trace.local, []);
  }
});

test('error status and redirects never cause fallback or retry', async () => {
  for (const status of [302, 401, 404, 429, 500]) {
    const init = fixture([[status, {}, { location: doneUrl }]]);
    await assert.rejects(runWebLogin(init.options), /login_http_status/);
    assert.equal(init.trace.requests.length, 1);
    assert.deepEqual(init.trace.local, []);
    const poll = fixture([start, [status, {}, { location: doneUrl }]]);
    await assert.rejects(runWebLogin(poll.options), /login_http_status/);
    assert.equal(poll.trace.requests.length, 2);
    assert.deepEqual(poll.trace.local, [['browser', loginUrl]]);
  }
});

test('only the official browser and registry paths from the single login response are admitted', async () => {
  for (const data of [
    { loginUrl: 'https://www.npmjs.com.evil.invalid/login', doneUrl },
    { loginUrl: 'https://name@www.npmjs.com/login', doneUrl },
    { loginUrl, doneUrl: 'https://registry.npmjs.org/-/whoami' },
    { loginUrl, doneUrl: 'http://registry.npmjs.org/-/v1/done' },
    { loginUrl, doneUrl: 'https://registry.npmjs.org/-/v1/done#code' },
  ]) {
    const { options, trace } = fixture([[200, data]]);
    await assert.rejects(runWebLogin(options), /login_url_rejected/);
    assert.equal(trace.requests.length, 1);
    assert.deepEqual(trace.local, []);
  }
});

test('header, body, encoding and framing bounds stop the request sequence', async () => {
  const cases = [
    [start, res => { res.rawHeaders = ['header', 'z'.repeat(LIMITS.headerBytes)]; }, /login_header_limit/],
    [[200, Buffer.alloc(LIMITS.bodyBytes + 1)], () => {}, /login_body_limit/],
    [[200, start[1], { 'content-length': String(LIMITS.bodyBytes + 1) }], () => {}, /login_body_limit/],
    [[200, start[1], { 'content-encoding': 'gzip' }], () => {}, /login_response_encoding/],
    [start, res => { res.complete = false; }, /login_response_incomplete/],
  ];
  for (const [row, change, reason] of cases) {
    const { options, trace } = fixture([row], { incoming({ res }) { change(res); } });
    await assert.rejects(runWebLogin(options), reason);
    assert.equal(trace.requests.length, 1);
  }
});

test('late replies, excessive Retry-After and local handoff failure stop before another request', async () => {
  let clock = 0;
  const expired = fixture([start], { incoming() { clock = LIMITS.getMs; } });
  await assert.rejects(runWebLogin({ ...expired.options, now: () => clock }), /login_request_timeout/);
  assert.deepEqual(expired.trace.local, []);
  const pending = fixture([start, [202, {}, { 'retry-after': '181' }]]);
  await assert.rejects(runWebLogin(pending.options), /login_stage_timeout/);
  assert.equal(pending.trace.requests.length, 2);
  const handoff = fixture([start]);
  await assert.rejects(runWebLogin({ ...handoff.options, beginBrowser() { throw Error(token); } }), { message: 'login_browser_handoff_failed' });
  assert.equal(handoff.trace.requests.length, 1);
});

test('a token in a pending response, malformed session, and failed storage cannot become login success', async () => {
  for (const [response, message] of [[[202, { token }], 'login_response_shape'], [[200, { token: token + '\n' }], 'login_session_unconfirmed']]) {
    const { options, trace } = fixture([start, response]);
    await assert.rejects(runWebLogin(options), { message });
    assert.deepEqual(trace.local, [['browser', loginUrl]]);
  }
  const { options } = fixture([start, success]);
  await assert.rejects(runWebLogin({ ...options, writeSession() { throw Error(token); } }), { message: 'login_session_save_failed' });
});

test('session config is private and exclusive, and refuses broadened modes and symlinks', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-session-release-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true }));
  const root = path.join(tmp, 'session');
  const written = writePrivateSession(root, token);
  assert.deepEqual(written, { config_saved: true, bytes: Buffer.byteLength('//registry.npmjs.org/:_authToken=' + token + '\n') });
  assert.equal(readPrivateSession(root), token);
  assert.throws(() => writePrivateSession(root, token), { code: 'EEXIST' });
  fs.chmodSync(path.join(root, 'user.npmrc'), 0o644);
  assert.throws(() => readPrivateSession(root), /session_path_unconfirmed/);
  const link = path.join(tmp, 'link');
  fs.symlinkSync(root, link);
  assert.throws(() => readPrivateSession(link), /session_path_unconfirmed/);
});

test('a new session must match the approved account before sending later GETs', async () => {
  const { options, trace } = fixture([[200, { username: 'other-fixture-account' }]]);
  await assert.rejects(runSessionPreflight({ ...options, token, record() { assert.fail('wrong account recorded'); } }), /session_account_mismatch/);
  assert.deepEqual(trace.requests.map(req => req.path), [ROUTES.account]);
});

test('the four preflight summaries retain no account value or token and never authorize publish', async () => {
  const rows = [[200, { username: ACCOUNT }], [200, { [ACCOUNT]: 'write' }],
    [404, { error: 'version not found: 0.1.46' }], [200, { latest: '0.1.45' }]];
  const { options, trace } = fixture(rows);
  const saved = [];
  await runSessionPreflight({ ...options, token, record(slot, evidence) { saved.push({ slot, evidence }); } });
  assert.deepEqual(trace.requests.map(req => [req.method, req.path]), Object.values(ROUTES).map(p => ['GET', p]));
  assert.equal(saved[1].evidence.token_publish_permission, 'unconfirmed');
  assert.equal(saved[1].evidence.account_matches, true);
  assert.ok(!JSON.stringify(saved).includes(ACCOUNT) && !JSON.stringify(saved).includes(token));
});

test('the two independent budgets sum to the approved reservation and campaign cap', () => checkBudget());
