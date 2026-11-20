import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runWebLogin02 } from '../../scripts/npm-session-release.mjs';
import { LOGIN02, executeLogin02, planHash } from '../../scripts/run-npm-session-release.mjs';

const address = '192.0.2.22';
const loginUrl = 'https://www.npmjs.com/login?next=%2Flogin%2Fcli%2Fmock-browser';
const doneUrl = 'https://registry.npmjs.org/-/v1/done?sessionId=mock-poll';
const token = 'npm_SyntheticLogin02ForTestsOnly';
const urls = { loginUrl, doneUrl };
const ready = [200, { token }];

function fixture(rows) {
  const events = { dns: 0, http: [], browser: [], saved: [], waits: [] };
  let time = 0;
  const options = {
    lookup(host, settings, callback) {
      assert.equal(host, 'registry.npmjs.org');
      assert.deepEqual(settings, { family: 4, all: false });
      events.dns++;
      callback(null, address, 4);
    },
    request(request, respond) {
      const index = events.http.push([request.method, request.path]) - 1;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        const socket = new EventEmitter();
        Object.assign(socket, { remoteAddress: address, authorized: true });
        req.emit('socket', socket);
        socket.emit('secureConnect');
        const [statusCode, body, headers = {}] = rows[index];
        const fields = Array.isArray(headers) ? headers : Object.entries(headers).flat();
        const res = new IncomingMessage(new Socket());
        res._addHeaderLines(fields, fields.length);
        Object.assign(res, { statusCode, statusMessage: 'fixture', complete: true });
        res.destroy = () => { res.destroyed = true; };
        respond(res);
        if (!res.destroyed) res.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
        if (!res.destroyed) res.emit('end');
      });
      return req;
    },
    beginBrowser(url) { events.browser.push(url); },
    writeSession(value) { events.saved.push(value); },
    sleep(ms) { events.waits.push(ms); time += ms; },
    now: () => time,
  };
  return { events, options };
}

for (const status of [200, 201, 202]) {
  test(`login02 POST ${status} requires the same validated URL pair`, async () => {
    const headers = status === 201 ? { location: 'https://example.invalid/ignored-location' } : {};
    const { options, events } = fixture([[status, urls, headers], ready]);
    const result = await runWebLogin02(options);
    assert.equal(result.session_saved, true);
    assert.equal(events.dns, 1);
    assert.deepEqual(events.http, [['POST', '/-/v1/login'], ['GET', '/-/v1/done?sessionId=mock-poll']]);
    assert.deepEqual(events.browser, [loginUrl]);
    assert.deepEqual(events.saved, [token]);
  });
}

test('login02 rejects ordinary and escape-equivalent duplicate keys before using even a valid last value', async () => {
  const login = JSON.stringify(loginUrl), done = JSON.stringify(doneUrl);
  const cases = [
    Buffer.from(`{"loginUrl":${login},"loginUrl":${login},"doneUrl":${done}}`),
    Buffer.from(String.raw`{"loginUrl":${login},"login\u0055rl":${login},"doneUrl":${done}}`),
    Buffer.from(String.raw`{"loginUrl":${login},"doneUrl":${done},"done\u0055rl":${done}}`),
    Buffer.from(String.raw`{"loginUrl":${login},"doneUrl":${done},"nested":[{"x":1,"\u0078":2}]}`),
  ];
  for (const body of cases) {
    const { options, events } = fixture([[201, body]]);
    await assert.rejects(runWebLogin02(options), /login_duplicate_json_key/);
    assert.deepEqual(events.http, [['POST', '/-/v1/login']]);
    assert.deepEqual(events.browser, []);
    assert.deepEqual(events.saved, []);
  }
  const distinct = fixture([[201, { ...urls, nested: [{ x: 1 }, { x: 2 }], label: '{"x":1,"x":2}' }], ready]);
  assert.equal((await runWebLogin02(distinct.options)).session_saved, true);
});

test('a missing or invalid URL after a POST 202 stops with no handoff, poll or saved token', async () => {
  for (const record of [{ loginUrl }, { ...urls, doneUrl: 'https://example.invalid/-/v1/done' }]) {
    const { options, events } = fixture([[202, record]]);
    await assert.rejects(runWebLogin02(options), /login_response_shape|login_url_rejected/);
    assert.equal(events.http.length, 1);
    assert.equal(events.browser.length + events.saved.length, 0);
  }
});

test('poll 202 token presence, duplicate keys, and poll 201 each stop with no follow-up', async () => {
  for (const [response, reason] of [
    [[202, { token: null }], /login_response_shape/], [[202, { token: '' }], /login_response_shape/],
    [[202, Buffer.from(String.raw`{"x":1,"\u0078":2}`)], /login_duplicate_json_key/],
    [[201, { token }], /login_http_status/],
  ]) {
    const { options, events } = fixture([[200, urls], response]);
    await assert.rejects(runWebLogin02(options), reason);
    assert.equal(events.http.length, 2);
    assert.equal(events.saved.length + events.waits.length, 0);
  }
});

test('poll waits honor zero, omission and valid seconds and reject malformed or unaffordable waits', async () => {
  for (const [headers, ms] of [[{}, 2000], [{ 'retry-after': '0' }, 1000], [{ 'retry-after': '3' }, 3000]]) {
    const { options, events } = fixture([[200, urls], [202, {}, headers], ready]);
    await runWebLogin02(options);
    assert.deepEqual(events.waits, [ms]);
  }
  for (const [after, reason] of [['00', /login_poll_interval_unconfirmed/], ['0, 2', /login_poll_interval_unconfirmed/],
    ['Fri, 20 Nov 2026 00:00:00 GMT', /login_poll_interval_unconfirmed/], ['10000', /login_poll_interval_unconfirmed/],
    ['151', /login_stage_timeout/], ['9999', /login_stage_timeout/]]) {
    const { options, events } = fixture([[200, urls], [202, {}, { 'retry-after': after }]]);
    await assert.rejects(runWebLogin02(options), reason);
    assert.equal(events.http.length, 2);
    assert.deepEqual(events.waits, []);
  }
});

test('poll 202 rejects duplicate raw Retry-After headers before waiting or dispatching another GET', async () => {
  for (const repeated of ['0', '120']) {
    const fields = ['Retry-After', '0', 'rEtRy-AfTeR', repeated];
    const { options, events } = fixture([[200, urls], [202, {}, fields], ready]);
    await assert.rejects(runWebLogin02(options), /login_poll_interval_unconfirmed/);
    assert.deepEqual(events.http, [['POST', '/-/v1/login'], ['GET', '/-/v1/done?sessionId=mock-poll']]);
    assert.equal(events.dns, 1);
    assert.deepEqual(events.waits, []);
    assert.deepEqual(events.saved, []);
  }
});

test('login02 reaches its twelve-poll ceiling without another dispatch', async () => {
  const { options, events } = fixture([[200, urls], ...Array(12).fill([202, {}, {}])]);
  await assert.rejects(runWebLogin02(options), /login_poll_limit/);
  assert.equal(events.http.length, 13);
  assert.equal(events.waits.length, 11);
});

function paths(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-login02-test-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const loginRoot = path.join(root, 'record'), sessionRoot = path.join(root, 'session');
  fs.mkdirSync(loginRoot, { mode: 0o700 });
  return { root, loginRoot, sessionRoot };
}

test('login02 binds its approval before DNS and prevents reuse after successful readback', async t => {
  const dirs = paths(t), { options, events } = fixture([[201, urls], ready]);
  const plan = { id: LOGIN02.id, allowed_status: [200, 201, 202] }, approvedHash = planHash(plan);
  const run = { ...dirs, plan, approvedHash, recheck: () => approvedHash, adapter: { ...options,
    lookup(...args) {
      const row = JSON.parse(fs.readFileSync(path.join(dirs.loginRoot, 'login-approval.json'), 'utf8'));
      assert.equal(row.approved_hash, approvedHash);
      return options.lookup(...args);
    },
  }, beginBrowser: options.beginBrowser, now: options.now };
  await assert.rejects(executeLogin02({ ...run, approvedHash: '0'.repeat(64) }), /approval_mismatch/);
  assert.equal(events.dns, 0);
  const result = await executeLogin02(run);
  assert.equal(result.id, LOGIN02.id);
  assert.equal(result.status, 'login_confirmed');
  assert.equal(result.cumulative_reserved, 50072562);
  assert.equal(result.publication_approved, false);
  assert.match(result.completion_proof, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(result).includes(token));
  await assert.rejects(executeLogin02(run), /scope_already_consumed/);
  assert.equal(events.dns, 1);
});

test('login02 stops with zero requests on parent fsync failure and retains the consumed approval', async t => {
  const dirs = paths(t), { options, events } = fixture([[200, urls], ready]);
  const parent = fs.lstatSync(dirs.root, { bigint: true }), native = fs.fsyncSync;
  let attempts = 0;
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (stat.dev === parent.dev && stat.ino === parent.ino) {
      attempts++;
      assert.ok(fs.existsSync(path.join(dirs.loginRoot, 'login-approval.json')));
      throw Error('synthetic parent fsync failure');
    }
    return native(fd);
  });
  const plan = { id: LOGIN02.id }, approvedHash = planHash(plan);
  const run = { ...dirs, plan, approvedHash, recheck: () => approvedHash, adapter: options, now: options.now };
  const status = await executeLogin02(run);
  assert.equal(attempts, 1);
  assert.equal(status.status, 'stopped');
  assert.equal(status.reason, 'login_parent_sync_unconfirmed');
  assert.equal(status.approval_consumed, true);
  assert.equal(status.completion_proof, null);
  assert.equal(events.dns + events.http.length, 0);
  assert.ok(!fs.existsSync(dirs.sessionRoot));
  await assert.rejects(executeLogin02(run), /scope_already_consumed/);
});
