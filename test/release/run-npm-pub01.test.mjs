import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planHash } from '../../scripts/run-npm-session-release.mjs';
import { A_RECORDS } from '../../scripts/prepare-npm-session-release.mjs';
import { ACCOUNT } from '../../scripts/npm-session-release.mjs';
import { LIMITS, ROUTES as PREFLIGHT } from '../../scripts/prepare-npm-preflight.mjs';
import { ROUTES } from '../../scripts/publish-verified-tarball.mjs';
import { PUBLISH_LIMITS } from '../../scripts/npm-publish-protocol.mjs';
import { ALLOCATION, CONFIRM_MS, HISTORY, READBACK_DELAY_MS, LOGIN07_ID, PUB01_ID, PUB_RECORDS, SESSION_MS, approvalRecord, checkAllocationArithmetic,
  checkAllocationChain, executePub01Run, planFor, publicationOutcome, readAnswer, registryTransport, safeReason } from '../../scripts/run-npm-pub01.mjs';

const ip = '192.0.2.72';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const urls = { loginUrl: 'https://www.npmjs.com/login/cli/mock-pub01', doneUrl: 'https://registry.npmjs.org/-/v1/done/mock-pub01' };
const token = 'npm_SyntheticPub01TokenOnly';
const otpUrls = { authUrl: 'https://www.npmjs.com/auth/cli/mock-otp-pub01', doneUrl: 'https://registry.npmjs.org/-/v1/done?authId=mockotppub01' };
const webOtp = 'web-otp-SyntheticValue';
const login = [[200, urls], [200, { token }]];
const queries = [[200, { username: ACCOUNT }], [200, { [ACCOUNT]: 'write' }], [404, 'version not found: 0.1.46'], [200, { latest: '0.1.45' }]];
const tarball = Buffer.from('synthetic tarball bytes for pub01 tests');
const readback = [[200, { name: 'bushido-tradingview-mcp', version: '0.1.46' }], [200, { latest: '0.1.46' }], [200, tarball]];
const otpChallenge = [401, otpUrls, { 'www-authenticate': 'OTP' }];
const classicChallenge = [401, { error: 'You must provide a one-time pass.' }, { 'www-authenticate': 'otp' }];
const body = Buffer.from(JSON.stringify({ _id: 'bushido-tradingview-mcp', synthetic: true }));
const entitySummary = { body_bytes: body.length, body_sha256: sha(body), integrity: 'sha512-synthetic',
  loaded_modules: { count: 309, sha256: 'b'.repeat(64), all_bound_to_B_inventory: true } };
const UTC0 = 1795000000000;

function fixture(t, responses, extra = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-pub01-test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true }));
  const base = path.join(workspace, 'release-work');
  const loginRoot = path.join(base, LOGIN07_ID), pubRoot = path.join(base, PUB01_ID), session = path.join(workspace, 'auth');
  fs.mkdirSync(loginRoot, { recursive: true });
  const plan = { id: LOGIN07_ID, entity: entitySummary, fixture: true }, approvedHash = planHash(plan);
  const events = { lookups: [], requests: [], browser: [], prompts: [], time: 0, utc: UTC0, utcs: [], hooks: {}, recheck: approvedHash };
  const adapter = {
    lookup(host, opts, done) {
      events.lookups.push([host, opts]);
      queueMicrotask(() => done(null, ip, 4));
    },
    request(opts, receive) {
      const index = events.requests.push({ method: opts.method, path: opts.path, auth: Object.hasOwn(opts.headers, 'authorization'),
        otp: opts.headers['npm-otp'], time: events.time }) - 1;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = sent => {
        events.requests[index].body = sent;
        queueMicrotask(() => {
          events.hooks.request?.(index, opts);
          const socket = new EventEmitter();
          Object.assign(socket, { authorized: true, remoteAddress: ip });
          req.emit('socket', socket);
          socket.emit('secureConnect');
          const entry = responses[index];
          if (entry === 'reset' || entry === undefined) return req.emit('error', Object.assign(Error('reset'), { code: 'ECONNRESET' }));
          const [statusCode, data, headers = {}] = entry;
          const res = new IncomingMessage(new Socket());
          Object.assign(res, { statusCode, statusMessage: 'fixture', complete: true, rawHeaders: Object.entries(headers).flat() });
          Object.defineProperty(res, 'headers', { value: headers });
          res.destroy = () => { res.destroyed = true; };
          receive(res);
          if (!res.destroyed) res.emit('data', Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data)));
          if (!res.destroyed) res.emit('end');
        });
      };
      return req;
    },
  };
  const read = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const options = { loginRoot, pubRoot, session, plan, approvedHash, adapter,
    recheck: () => events.recheck, now: () => events.time, wall: () => events.utcs.length ? events.utcs.shift() : events.utc,
    beginBrowser(url) { events.browser.push(url); events.hooks.browser?.(url); },
    sleep(ms) { events.time += ms; },
    prompt: { confirm() { events.prompts.push('confirm'); return events.hooks.confirm?.() ?? 'publish 0.1.46\n'; },
      otp() { events.prompts.push('otp'); return events.hooks.otp?.() ?? ' 123456\n'; } },
    entity: async () => ({ body, summary: entitySummary }),
    verify: { metadata: bytes => JSON.parse(bytes).version === '0.1.46', tarball: bytes => bytes.equals(tarball) }, ...extra };
  return { loginRoot, pubRoot, session, events, read, plan, approvedHash, run: more => executePub01Run({ ...options, ...more }) };
}

const allText = root => fs.existsSync(root) ? fs.readdirSync(root).map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') : '';
const calls = f => f.events.requests.map(r => [r.method, r.path]);
const pre = [['POST', '/-/v1/login'], ['GET', '/-/v1/done/mock-pub01'], ...Object.values(PREFLIGHT).map(route => ['GET', route])];
const back = [['GET', ROUTES.version], ['GET', ROUTES.tag], ['GET', ROUTES.tarball]];
const put = ['PUT', ROUTES.publish];
function secretsAbsent(f, more = []) {
  for (const root of [f.loginRoot, f.pubRoot]) {
    const text = allText(root);
    for (const secret of [token, webOtp, '123456', otpUrls.authUrl, 'mockotppub01', urls.loginUrl, ...more]) assert.ok(!text.includes(secret), secret);
  }
}

test('one approval runs login07, the four preflight GETs, one accepted PUT and a confirmed readback', async t => {
  const f = fixture(t, [...login, ...queries, [201, { ok: true }], ...readback]);
  const result = await f.run();
  assert.equal(result.status, 'session_verified');
  assert.equal(result.publication.status, 'published');
  assert.equal(result.publication.outcome, 'accepted_readback_confirmed');
  assert.equal(result.publication.reason, null);
  assert.deepEqual(calls(f), [...pre, put, ...back]);
  assert.deepEqual(result.publication.counts, { dns_calls: 1, get_attempts: 7, put_attempts: 1, otp_poll_attempts: 0,
    readback_attempts: 3, secondary_lookup_attempts: 0 });
  assert.equal(f.events.lookups.length, 2);
  assert.deepEqual(f.events.prompts, ['confirm']);
  assert.ok(f.events.requests[6].body.equals(body));
  assert.equal(f.events.requests[6].otp, undefined);
  assert.ok(f.events.requests.slice(2).every(r => r.auth) && !f.events.requests[0].auth && !f.events.requests[1].auth);
  assert.deepEqual(fs.readdirSync(f.pubRoot).sort(), ['account.json', 'approval-publication.json', 'confirmation.json',
    'login-binding.json', 'preflight-status.json', 'publication-readback.json', 'publication-status.json', 'readback-tag.json',
    'readback-tarball.json', 'readback-version.json', 'rights.json', 'send-1.json', 'tag.json', 'version.json']);
  const send = f.read(f.pubRoot, 'send-1.json');
  assert.deepEqual([send.http_status, send.kind, send.otp_header, send.entity_sha256], [201, 'accepted', false, entitySummary.body_sha256]);
  assert.deepEqual(f.read(f.pubRoot, 'confirmation.json').confirmed, true);
  for (const file of ['readback-version.json', 'readback-tag.json', 'readback-tarball.json']) assert.equal(f.read(f.pubRoot, file).verdict, 'confirmed');
  const approval = f.read(f.loginRoot, 'login-approval.json');
  assert.equal(approval.publication_approved, true);
  assert.equal(approval.approved_hash, f.approvedHash);
  assert.deepEqual(f.read(f.pubRoot, 'approval-publication.json'), { ...approval, id: PUB01_ID, run_id: LOGIN07_ID });
  assert.equal(f.read(f.pubRoot, 'publication-readback.json').verified, true);
  assert.equal(f.read(f.loginRoot, 'login-status.json').session_deadline_utc_ms, UTC0 + SESSION_MS);
  assert.deepEqual(f.events.requests.slice(6).map(r => r.time - f.events.requests[6].time), [0, READBACK_DELAY_MS, READBACK_DELAY_MS, READBACK_DELAY_MS]);
  secretsAbsent(f);
});

test('a web OTP challenge opens the browser URL, polls the done endpoint and sends exactly one more PUT', async t => {
  const f = fixture(t, [...login, ...queries, otpChallenge, [202, {}, { 'retry-after': '3' }], [200, { token: webOtp }], [200, {}], ...readback]);
  const result = await f.run();
  assert.equal(result.publication.status, 'published');
  assert.equal(result.publication.otp, 'web');
  assert.deepEqual(calls(f), [...pre, put, ['GET', '/-/v1/done?authId=mockotppub01'], ['GET', '/-/v1/done?authId=mockotppub01'], put, ...back]);
  assert.deepEqual([f.events.browser.length, f.events.browser[1]], [2, otpUrls.authUrl]);
  assert.equal(f.events.requests[6].otp, undefined);
  assert.equal(f.events.requests[9].otp, webOtp);
  assert.ok(f.events.requests[9].body.equals(body));
  assert.equal(result.publication.counts.otp_poll_attempts, 2);
  assert.equal(result.publication.counts.put_attempts, 2);
  assert.deepEqual(f.read(f.pubRoot, 'otp.json'), { id: PUB01_ID, kind: 'web', polls: 2, result: 'received' });
  assert.equal(f.read(f.pubRoot, 'send-1.json').kind, 'otp_web');
  assert.equal(f.read(f.pubRoot, 'send-2.json').otp_header, true);
  secretsAbsent(f);
});

test('a classic OTP challenge asks for the authenticator code on the terminal and never records it', async t => {
  const f = fixture(t, [...login, ...queries, classicChallenge, [200, {}], ...readback]);
  const result = await f.run();
  assert.equal(result.publication.outcome, 'accepted_readback_confirmed');
  assert.equal(result.publication.otp, 'classic');
  assert.deepEqual(f.events.prompts, ['confirm', 'otp']);
  assert.deepEqual(calls(f), [...pre, put, put, ...back]);
  assert.equal(f.events.requests[7].otp, '123456');
  assert.equal(f.events.browser.length, 1);
  secretsAbsent(f);
});

test('without the exact confirmation phrase, in time, nothing is published', async t => {
  for (const [hook, reason, ok, timely] of [
    [() => 'publish 0.1.45', 'publish_not_confirmed', false, true],
    [() => 'yes', 'publish_not_confirmed', false, true],
    [() => { throw Error('tty closed'); }, 'publish_confirmation_failed', null, null],
  ]) {
    const f = fixture(t, [...login, ...queries]);
    f.events.hooks.confirm = hook;
    const result = await f.run();
    assert.equal(result.publication.status, 'stopped');
    assert.equal(result.publication.outcome, 'not_sent');
    assert.equal(result.publication.reason, reason);
    assert.equal(result.publication.counts.put_attempts, 0);
    assert.deepEqual(calls(f), pre);
    if (ok !== null) assert.deepEqual([f.read(f.pubRoot, 'confirmation.json').confirmed, f.read(f.pubRoot, 'confirmation.json').within_window], [ok, timely]);
  }
  const late = fixture(t, [...login, ...queries]);
  late.events.hooks.confirm = () => { late.events.time += CONFIRM_MS; return 'publish 0.1.46'; };
  const result = await late.run();
  assert.equal(result.publication.reason, 'stage_deadline');
  assert.equal(result.publication.outcome, 'not_sent');
  assert.equal(late.read(late.pubRoot, 'confirmation.json').within_window, false);
  assert.deepEqual(calls(late), pre);
});

test('a rebuilt entity that differs from the approved plan stops before the PUT', async t => {
  const sameLength = Buffer.from(body.toString().replace('true', 'TRUE'));
  assert.equal(sameLength.length, body.length);
  for (const entity of [async () => ({ body: Buffer.from('{}'), summary: entitySummary }), async () => ({ body: sameLength, summary: entitySummary }),
    async () => ({ body, summary: { ...entitySummary, integrity: 'sha512-other' } }), async () => { throw Error('pub01_entity_changed'); }]) {
    const f = fixture(t, [...login, ...queries]);
    const result = await f.run({ entity });
    assert.equal(result.publication.reason, 'pub01_entity_changed');
    assert.equal(result.publication.outcome, 'not_sent');
    assert.deepEqual(calls(f), pre);
  }
});

test('a definitive refusal ends the run with no second PUT and no readback', async t => {
  for (const [reply, reason] of [[[403, { error: 'forbidden' }], 'publish_http_status_403'],
    [[401, {}, { 'www-authenticate': 'Bearer' }], 'publish_http_status_401'], [[401, {}, { 'www-authenticate': 'ipaddress' }], 'publish_auth_ip_address'],
    [[401, { authUrl: 'https://evil.example/x', doneUrl: otpUrls.doneUrl }, { 'www-authenticate': 'otp' }], 'publish_otp_url_rejected'],
    [[302, {}], 'publish_http_status_302']]) {
    const f = fixture(t, [...login, ...queries, reply]);
    const result = await f.run();
    assert.equal(result.publication.status, 'stopped');
    assert.equal(result.publication.outcome, 'refused');
    assert.equal(result.publication.reason, reason);
    assert.deepEqual(calls(f), [...pre, put]);
    assert.equal(f.events.browser.length, 1);
  }
});

test('a second OTP challenge or refusal after the OTP stops without a third PUT', async t => {
  for (const [second, reason] of [[classicChallenge, 'publish_http_status_401'], [[403, {}], 'publish_http_status_403']]) {
    const f = fixture(t, [...login, ...queries, classicChallenge, second]);
    const result = await f.run();
    assert.equal(result.publication.outcome, 'refused');
    assert.equal(result.publication.reason, reason);
    assert.deepEqual(calls(f), [...pre, put, put]);
  }
});

test('a malformed or failed OTP step never reaches the second PUT', async t => {
  const cases = [
    [[otpChallenge, [200, { token: '' }]], {}, 'publish_otp_unconfirmed', 1],
    [[otpChallenge, [500, {}]], {}, 'publish_otp_http_status_500', 1],
    [[otpChallenge, [202, {}, { 'retry-after': '61' }]], {}, 'publish_otp_interval_unconfirmed', 1],
    [[otpChallenge], { browser: url => { if (url === otpUrls.authUrl) throw Error('no terminal'); } }, 'publish_otp_prompt_failed', 0],
    [[classicChallenge], { otp: () => '12ab56' }, 'publish_otp_code_format', 0],
    [[classicChallenge], { otp: () => { throw Error('tty'); } }, 'publish_otp_prompt_failed', 0],
  ];
  for (const [replies, hooks, reason, polls] of cases) {
    const f = fixture(t, [...login, ...queries, ...replies]);
    Object.assign(f.events.hooks, hooks);
    const result = await f.run();
    assert.equal(result.publication.outcome, 'refused', reason);
    assert.equal(result.publication.reason, reason);
    assert.equal(result.publication.counts.put_attempts, 1);
    assert.equal(result.publication.counts.otp_poll_attempts, polls);
    assert.equal(f.read(f.pubRoot, 'otp.json').result, 'stopped');
    assert.equal(f.read(f.pubRoot, 'otp.json').reason, reason);
  }
});

test('OTP polling is bounded by the poll limit and by the publish window', async t => {
  const waiting = (n, after) => Array.from({ length: n }, () => [202, {}, { 'retry-after': after }]);
  const many = fixture(t, [...login, ...queries, otpChallenge, ...waiting(PUBLISH_LIMITS.maxOtpPolls + 5, '0')]);
  const limited = await many.run();
  assert.equal(limited.publication.reason, 'publish_otp_poll_limit');
  assert.equal(limited.publication.counts.otp_poll_attempts, PUBLISH_LIMITS.maxOtpPolls);
  assert.equal(limited.publication.counts.put_attempts, 1);
  const slow = fixture(t, [...login, ...queries, otpChallenge, ...waiting(40, '10')]);
  const timed = await slow.run();
  assert.equal(timed.publication.reason, 'stage_deadline');
  assert.equal(timed.publication.counts.put_attempts, 1);
  assert.ok(timed.publication.counts.otp_poll_attempts < 25);
});

test('an unanswered PUT is never resent and is classified only by read-only readback', async t => {
  const cases = [
    ['reset', [[404, 'version not found'], [200, { latest: '0.1.45' }], [404, 'not found']], 'unknown', 'stopped', 'transport_error'],
    ['reset', readback, 'unanswered_readback_confirmed', 'published', null],
    [[502, { error: 'bad gateway' }], [[404, 'version not found'], [200, { latest: '0.1.45' }], [404, 'not found']], 'unknown', 'stopped', 'publish_http_status_502'],
  ];
  for (const [reply, after, outcome, status, reason] of cases) {
    const f = fixture(t, [...login, ...queries, reply, ...after]);
    const result = await f.run();
    assert.equal(result.publication.outcome, outcome);
    assert.equal(result.publication.status, status);
    assert.equal(result.publication.reason, reason);
    assert.deepEqual(calls(f), [...pre, put, ...back]);
    assert.equal(f.read(f.pubRoot, 'send-1.json').kind, 'unknown');
  }
  const absent = fixture(t, [...login, ...queries, 'reset', [404, 'version not found'], [200, { latest: '0.1.45' }], [404, 'x']]);
  await absent.run();
  assert.equal(absent.read(absent.pubRoot, 'readback-version.json').verdict, 'absent');
});

test('an accepted PUT whose readback lags is reported as published but unconfirmed', async t => {
  const f = fixture(t, [...login, ...queries, [200, {}], [404, 'version not found'], [200, { latest: '0.1.45' }], 'reset']);
  const result = await f.run();
  assert.equal(result.publication.status, 'published');
  assert.equal(result.publication.outcome, 'accepted_readback_unconfirmed');
  assert.deepEqual(['readback-version.json', 'readback-tag.json', 'readback-tarball.json'].map(file => f.read(f.pubRoot, file).verdict),
    ['absent', 'mismatch', 'unavailable']);
});

test('approved inputs, the session and its UTC deadline are rechecked before the PUT', async t => {
  const drift = fixture(t, [...login, ...queries]);
  drift.events.hooks.confirm = () => { drift.events.recheck = 'd'.repeat(64); return 'publish 0.1.46'; };
  const changed = await drift.run();
  assert.equal(changed.publication.reason, 'execution_inputs_changed');
  assert.equal(changed.publication.outcome, 'not_sent');
  assert.deepEqual(calls(drift), pre);
  const late = fixture(t, [...login, ...queries]);
  late.events.hooks.confirm = () => { late.events.utc = UTC0 + SESSION_MS; return 'publish 0.1.46'; };
  const expired = await late.run();
  assert.equal(expired.publication.reason, 'session_deadline');
  assert.deepEqual(calls(late), pre);
  const swapped = fixture(t, [...login, ...queries]);
  swapped.events.hooks.confirm = () => {
    const file = path.join(swapped.session, 'user.npmrc');
    fs.chmodSync(file, 0o644);
    fs.chmodSync(file, 0o600);
    return 'publish 0.1.46';
  };
  const moved = await swapped.run();
  assert.equal(moved.publication.reason, 'pub01_session_changed');
  assert.deepEqual(calls(swapped), pre);
});

test('a failed login or preflight never reaches the confirmation or a PUT', async t => {
  const failed = fixture(t, [[401, { error: 'denied' }]]);
  const result = await failed.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.publication, null);
  assert.equal(fs.existsSync(failed.pubRoot), false);
  for (const [responses, reason] of [[[...login, [401, {}]], 'http_status_401'],
    [[...login, queries[0], queries[1], [200, { version: '0.1.46' }]], 'version_availability_unconfirmed'],
    [[...login, queries[0], [200, { [ACCOUNT]: 'read' }]], 'rights_unconfirmed']]) {
    const f = fixture(t, responses);
    const stopped = await f.run();
    assert.equal(stopped.publication.reason, reason);
    assert.equal(stopped.publication.outcome, 'not_sent');
    assert.equal(stopped.publication.stage, 'preflight');
    assert.deepEqual(f.events.prompts, []);
    assert.ok(f.events.requests.every(r => r.method !== 'PUT'));
  }
});

test('a publication scope created during login stops at admission, before registry DNS', async t => {
  const f = fixture(t, [...login, ...queries]);
  f.events.hooks.request = index => { if (index === 1) fs.mkdirSync(f.pubRoot); };
  const result = await f.run();
  assert.equal(result.status, 'session_verified');
  assert.equal(result.stage, 'admission');
  assert.deepEqual([result.publication.reason, result.publication.outcome, result.publication.records], ['pub01_scope_exists', 'not_sent', 'not_created']);
  assert.deepEqual(fs.readdirSync(f.pubRoot), []);
  assert.equal(f.events.lookups.length, 1);
});

test('an existing publication scope or session refuses before any network or record', async t => {
  for (const which of ['pubRoot', 'session']) {
    const f = fixture(t, []);
    fs.mkdirSync(f[which]);
    await assert.rejects(f.run(), /pub01_scope_exists/);
    assert.equal(f.events.lookups.length, 0);
    assert.deepEqual(fs.readdirSync(f.loginRoot), []);
  }
  const f = fixture(t, []);
  await assert.rejects(f.run({ approvedHash: 'a'.repeat(64) }), /approval_mismatch/);
  assert.equal(f.events.lookups.length, 0);
});

test('the registry transport admits one DNS lookup and only each phase\'s routes', () => {
  const ip4 = '192.0.2.99';
  const make = () => {
    const seen = [];
    const adapter = { lookup: (h, o, cb) => { seen.push('dns'); cb(null, ip4, 4); }, request: o => { seen.push(o.method + ' ' + o.path); return {}; } };
    const transport = registryTransport({ adapter, before: ms => seen.push(ms) });
    transport.lookup('registry.npmjs.org', { family: 4, all: false }, () => {});
    return { transport, seen };
  };
  const options = (method, route) => ({ hostname: ip4, servername: 'registry.npmjs.org', port: 443, family: 4, agent: false,
    autoSelectFamily: false, rejectUnauthorized: true, maxHeaderSize: LIMITS.headerBytes, method, path: route, lookup: () => {},
    headers: { authorization: 'Bearer x' } });
  const ok = make();
  assert.throws(() => ok.transport.enter('publish'), /pub01_transport_scope/);
  assert.throws(() => ok.transport.request(options('PUT', ROUTES.publish)), /pub01_transport_scope/);
  for (const route of Object.values(PREFLIGHT)) ok.transport.request(options('GET', route));
  ok.transport.preflightComplete();
  assert.throws(() => ok.transport.lookup('registry.npmjs.org', { family: 4, all: false }, () => {}), /pub01_dns_scope/);
  ok.transport.enter('publish');
  assert.throws(() => ok.transport.request(options('GET', ROUTES.version)), /pub01_transport_scope/);
  assert.throws(() => ok.transport.request(options('PUT', '/other')), /pub01_transport_scope/);
  ok.transport.request(options('PUT', ROUTES.publish));
  assert.throws(() => ok.transport.enter('otp', { poll: '/-/v1/login' }), /pub01_transport_scope/);
  ok.transport.enter('otp', { poll: '/-/v1/done?authId=x' });
  assert.throws(() => ok.transport.request(options('GET', '/-/v1/done?authId=y')), /pub01_transport_scope/);
  ok.transport.request(options('GET', '/-/v1/done?authId=x'));
  assert.throws(() => ok.transport.enter('readback'), /pub01_transport_scope/);
  ok.transport.enter('publish');
  ok.transport.request(options('PUT', ROUTES.publish));
  assert.throws(() => ok.transport.request(options('PUT', ROUTES.publish)), /pub01_transport_scope/);
  assert.throws(() => ok.transport.enter('otp', { poll: '/-/v1/done?authId=x' }), /pub01_transport_scope/);
  ok.transport.enter('readback');
  ok.transport.request(options('GET', ROUTES.tarball));
  ok.transport.request(options('GET', ROUTES.version));
  assert.throws(() => ok.transport.request(options('GET', ROUTES.version)), /pub01_transport_scope/);
  assert.throws(() => ok.transport.request(options('PUT', ROUTES.publish)), /pub01_transport_scope/);
  ok.transport.request(options('GET', ROUTES.tag));
  assert.deepEqual(ok.transport.counts, { dns_calls: 1, get_attempts: 8, put_attempts: 2, otp_poll_attempts: 1, readback_attempts: 3,
    secondary_lookup_attempts: 0 });
  assert.ok(ok.seen.includes(PUBLISH_LIMITS.putMs) && ok.seen.includes(LIMITS.getMs) && ok.seen.includes(LIMITS.dnsMs));
  for (const change of [{ hostname: '192.0.2.1' }, { port: 80 }, { rejectUnauthorized: false }, { agent: undefined }, { headers: {} },
    { servername: 'registry.npmjs.org.evil' }, { lookup: undefined }]) {
    const m = make();
    assert.throws(() => m.transport.request({ ...options('GET', PREFLIGHT.account), ...change }), /pub01_transport_scope/);
  }
});

test('terminal answers skip stray blank lines and stop at the byte limit', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-pub01-answer-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const answer = (text, limit = 64) => {
    const file = path.join(dir, 'input-' + Math.random().toString(16).slice(2));
    fs.writeFileSync(file, text);
    const fd = fs.openSync(file, 'r');
    try { return readAnswer(fd, limit); } finally { fs.closeSync(fd); }
  };
  assert.equal(answer('\n \n\r\npublish 0.1.46\r\nlater\n'), 'publish 0.1.46');
  assert.equal(answer('publish 0.1.46'), 'publish 0.1.46');
  assert.equal(answer('\n'.repeat(8) + 'publish 0.1.46\n'), '');
  assert.equal(answer(''), '');
  assert.equal(answer('123456789012345678\n', 16), '1234567890123456');
});

test('publication outcomes distinguish unsent, refused, unanswered and accepted PUTs', () => {
  const o = (dispatched, accepted, unanswered, readbackConfirmed) => publicationOutcome({ dispatched, accepted, unanswered, readbackConfirmed });
  assert.equal(o(0, false, false, false), 'not_sent');
  assert.equal(o(1, false, false, false), 'refused');
  assert.equal(o(2, false, false, false), 'refused');
  assert.equal(o(1, false, true, false), 'unknown');
  assert.equal(o(1, false, true, true), 'unanswered_readback_confirmed');
  assert.equal(o(1, true, false, true), 'accepted_readback_confirmed');
  assert.equal(o(2, true, false, false), 'accepted_readback_unconfirmed');
});

test('only fixed reason codes reach records', () => {
  for (const code of ['publish_http_status_403', 'publish_otp_poll_limit', 'transport_error', 'stage_deadline', 'http_status_401',
    'pub01_entity_changed', 'publish_unconfirmed'])
    assert.equal(safeReason(code), code);
  for (const code of ['npm_SecretTokenLeak', 'publish_otp_' + webOtp, 'https://www.npmjs.com/auth/x', 'publish_http_status_999', undefined])
    assert.equal(safeReason(code), 'execution_stopped');
});

test('the reservation extends login06 exactly and a realistic approval fits both approval slots', () => {
  checkAllocationArithmetic();
  const login06 = { cumulative: 50433010, remaining_pool: 30677833, campaign_cap: 88080384, protected_765_bytes_used: 0 };
  checkAllocationChain(login06);
  for (const change of [{ cumulative: 50433011 }, { remaining_pool: 30677832 }, { campaign_cap: 1 }, { protected_765_bytes_used: 1 }])
    assert.throws(() => checkAllocationChain({ ...login06, ...change }), /pub01_allocation_changed/);
  assert.deepEqual([ALLOCATION.reservation, ALLOCATION.cumulative, ALLOCATION.remaining_pool], [196608, 50629618, 30481225]);
  assert.equal(Object.values(PUB_RECORDS).reduce((a, b) => a + b, 0), 128 * 1024);
  assert.equal(HISTORY['package-2026-11-20-publish-0.1.46-prep04'][1], 'da8aa743fff12b1820f257d015c796459eff273b068578775d1eb7f81446a13f');
  const h = 'e'.repeat(64), repo = '/Users/operator-with-a-long-name/Downloads/GitHub/TradingView-MCP/.release-work/';
  const inputs = { id: LOGIN07_ID, publication_id: PUB01_ID, login_root: repo + LOGIN07_ID, publication_root: repo + PUB01_ID,
    session_file: '/private/tmp/TradingView-MCP-npm-0.1.46-login07/user.npmrc', account: ACCOUNT,
    candidate: '8d97bbaaf2360fe83b2ff6dd36ebef4887c0acc9', rebind_approval_sha256: h,
    artifact: { file: '.release-work/package-2026-11-18-reverify-r02/artifact/verified-0.1.46.tgz', bytes: 846950, sha256: h },
    record_limits: { login: A_RECORDS, publication: PUB_RECORDS } };
  const entity = { body_bytes: 1141841, body_sha256: h, integrity: 'sha512-' + 'A'.repeat(86) + '==',
    loaded_modules: { count: 309, sha256: h, all_bound_to_B_inventory: true } };
  const plan = planFor(inputs, entity, { reservation_sha256: h, inputs_sha256: h, tests_sha256: h, preparation_readback_sha256: h });
  const record = approvalRecord(plan, planHash(plan));
  assert.ok(Buffer.byteLength(JSON.stringify(record) + '\n') <= A_RECORDS['login-approval.json']);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...record, id: PUB01_ID, run_id: LOGIN07_ID }) + '\n') <= PUB_RECORDS['approval-publication.json']);
  assert.throws(() => approvalRecord({ ...plan, id: 'other' }, planHash(plan)), /approval_mismatch/);
});
