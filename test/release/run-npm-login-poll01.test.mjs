import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LIMITS } from '../../scripts/prepare-npm-preflight.mjs';
import { planHash } from '../../scripts/run-npm-session-release.mjs';
import { executeLogin03, LOGIN03_ID } from '../../scripts/run-npm-login03.mjs';
import { CAPS, executePollDiagnostic, POLL_ID } from '../../scripts/run-npm-login-poll01.mjs';

const ip = '192.0.2.74';
const secret = 'synthetic-value-never-retained';
const start = { loginUrl: 'https://www.npmjs.com/login/cli/mock-browser',
  doneUrl: 'https://registry.npmjs.org/-/v1/done?sessionId=mock%2Dpoll' };
const token = 'npm_PollDiagnosticFixtureOnly';

function fixture(t, replies) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-poll01-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const plan = { id: POLL_ID, fixture: true }, approvedHash = planHash(plan);
  const events = { dns: [], requests: [], bodyReaders: [], time: 0, hooks: {} };
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const adapter = {
    lookup(host, options, callback) {
      events.dns.push([host, options]);
      queueMicrotask(() => {
        events.hooks.dns?.();
        callback(null, ip, 4);
      });
    },
    request(options, respond) {
      const entry = { options, body: undefined };
      const index = events.requests.push(entry) - 1;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = body => {
        entry.body = body;
        queueMicrotask(() => {
          if (events.hooks.request?.(req, options)) return;
          const socket = Object.assign(new EventEmitter(), { authorized: true, remoteAddress: ip });
          req.emit('socket', socket);
          socket.emit('secureConnect');
          const [statusCode, data, fields = [], complete = true] = replies[index];
          const res = new IncomingMessage(new Socket());
          res._addHeaderLines(fields, fields.length);
          Object.assign(res, { statusCode, statusMessage: secret, complete });
          res.destroy = () => { res.destroyed = true; };
          events.hooks.response?.(index);
          respond(res);
          events.bodyReaders.push(res.listenerCount('data'));
          if (!res.destroyed) res.emit('data', Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data)));
          if (!res.destroyed) res.emit(complete ? 'end' : 'aborted');
        });
      };
      return req;
    },
  };
  const options = { root, plan, approvedHash, adapter, recheck: () => approvedHash, now: () => events.time };
  return { root, events, read, options, adapter, run: extra => executePollDiagnostic({ ...options, ...extra }) };
}

test('poll01 sends the same initial POST and normalized GET as login03 and keeps only safe response fields', async t => {
  const headers = ['Set-Cookie', secret];
  const rows = [[201, start], [200, { token, details: secret }, headers]];
  const f = fixture(t, rows), baseline = fixture(t, rows);
  const plan = { id: LOGIN03_ID, fixture: true }, approvedHash = planHash(plan);
  const login = await executeLogin03({ root: baseline.root, session: path.join(baseline.root, 'auth'), plan, approvedHash,
    recheck: () => approvedHash, adapter: baseline.adapter, beginBrowser() {}, presentProof() {}, now: () => 0 });
  const result = await f.run();
  assert.equal(login.status, 'login_confirmed');
  assert.equal(result.status, 'diagnostic_complete');
  assert.deepEqual(result.counts, { dns_calls: 1, post_attempts: 1, get_attempts: 1, put_attempts: 0, refused_additional_lookups: 0 });
  assert.deepEqual(result.poll, { http_status: 200, body_shape: 'object', token_key: 'present', retry_after: 'unclassified' });
  assert.deepEqual(f.events.dns, baseline.events.dns);
  assert.equal(f.events.requests.length, 2);
  for (const [index, entry] of f.events.requests.entries()) {
    const { checkServerIdentity, lookup, ...opts } = entry.options;
    const { checkServerIdentity: checkBaseline, lookup: lookupBaseline, ...old } = baseline.events.requests[index].options;
    assert.equal(typeof lookup, typeof lookupBaseline);
    for (const host of ['registry.npmjs.org', 'example.invalid']) {
      const cert = { subjectaltname: 'DNS:' + host };
      assert.equal(checkServerIdentity(ip, cert)?.code, checkBaseline(ip, cert)?.code);
    }
    assert.deepEqual(opts, old);
    assert.equal(entry.body, baseline.events.requests[index].body);
  }
  assert.equal(f.events.requests[1].options.path, '/-/v1/done?sessionId=mock-poll');
  const output = JSON.stringify([result, ...fs.readdirSync(f.root).map(file => f.read(file))]);
  for (const privateValue of [token, secret, ...Object.values(start), 'mock-poll']) assert.equal(output.includes(privateValue), false);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['communication-approval.json', 'communication-readback.json', 'communication-status.json']);
});

test('duplicate Retry-After stops before any GET body listener is installed', async t => {
  const f = fixture(t, [[200, start], [202, null, ['Retry-After', '1', 'rEtRy-aFtEr', '2']]]);
  const result = await f.run();
  assert.equal(result.reason, 'login_poll_interval_unconfirmed');
  assert.deepEqual(result.poll, { http_status: 202, body_shape: 'unclassified', token_key: 'unclassified', retry_after: 'duplicate' });
  assert.deepEqual(f.events.bodyReaders, [1, 0]);
  assert.equal(f.events.requests.length, 2);
});

test('single Retry-After syntax is evaluated only after classifying a token-free object', async t => {
  const cases = [
    [null, 'null', 'unclassified', 'unclassified', 'login_response_shape'],
    [[], 'array', 'unclassified', 'unclassified', 'login_response_shape'],
    [{ token: null }, 'object', 'present', 'unclassified', 'login_response_shape'],
    [{}, 'object', 'absent', 'invalid', 'login_poll_interval_unconfirmed'],
  ];
  for (const [body, shape, key, retry, reason] of cases) {
    const f = fixture(t, [[200, start], [202, body, ['Retry-After', secret]]]);
    const result = await f.run();
    assert.equal(result.reason, reason);
    assert.deepEqual(result.poll, { http_status: 202, body_shape: shape, token_key: key, retry_after: retry });
    assert.deepEqual(f.events.bodyReaders, [1, 1]);
    assert.equal(result.counts.get_attempts, 1);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('valid and missing Retry-After are classified without waiting or sending a second GET', async t => {
  for (const [fields, retry] of [[['Retry-After', '9999'], 'valid'], [[], 'missing']]) {
    const f = fixture(t, [[202, start], [202, {}, fields]]);
    const result = await f.run();
    assert.equal(result.status, 'diagnostic_complete');
    assert.deepEqual(result.poll, { http_status: 202, body_shape: 'object', token_key: 'absent', retry_after: retry });
    assert.equal(f.events.requests.length, 2);
  }
});

test('incomplete, oversized and malformed GET bodies leave shape and token key unclassified', async t => {
  const cases = [
    [[202, {}, ['Retry-After', '1'], false], 'response_incomplete'],
    [[202, Buffer.alloc(LIMITS.bodyBytes + 1)], 'response_body_limit'],
    [[202, Buffer.from([0xff])], 'invalid_utf8'],
    [[202, Buffer.from('{')], 'invalid_json'],
    [[202, Buffer.from(String.raw`{"nested":[{"x":1,"\u0078":2}]}`)], 'duplicate_json_key'],
  ];
  for (const [reply, reason] of cases) {
    const f = fixture(t, [[200, start], reply]), result = await f.run();
    assert.equal(result.reason, reason);
    assert.equal(result.poll.http_status, 202);
    assert.equal(result.poll.body_shape, 'unclassified');
    assert.equal(result.poll.token_key, 'unclassified');
    assert.equal(result.counts.get_attempts, 1);
  }
});

test('unexpected GET status skips the body and rejected headers do not confirm a status', async t => {
  for (const [reply, status, reason] of [
    [[302, { secret }, ['Location', 'https://example.invalid/' + secret]], 302, 'http_status'],
    [[200, {}, ['x-large', 'x'.repeat(LIMITS.headerBytes)]], null, 'response_header_limit'],
    [[101, {}], null, 'invalid_final_status'],
  ]) {
    const f = fixture(t, [[200, start], reply]), result = await f.run();
    assert.equal(result.reason, reason);
    assert.deepEqual(result.poll, { http_status: status, body_shape: 'unclassified', token_key: 'unclassified', retry_after: 'unclassified' });
    assert.deepEqual(f.events.bodyReaders, [1, 0]);
    assert.equal(result.counts.get_attempts, 1);
  }
});

test('POST rejection or invalid completion URL never sends a GET', async t => {
  for (const [response, reason] of [
    [[401, {}], 'http_status'], [[200, { loginUrl: start.loginUrl }], 'login_response_shape'],
    [[200, { ...start, loginUrl: 'https://example.invalid/login/cli/mock' }], 'login_url_rejected'],
    [[200, { ...start, doneUrl: 'https://example.invalid/-/v1/done/mock' }], 'login_url_rejected'],
  ]) {
    const f = fixture(t, [response]), result = await f.run();
    assert.equal(result.reason, reason);
    assert.equal(result.counts.get_attempts, 0);
    assert.equal(result.poll.http_status, null);
    assert.equal(f.events.requests.length, 1);
  }
});

test('input drift after DNS or POST stops before the next request', async t => {
  for (const [at, phase, requests] of [['dns', 'before_post', 0], ['response', 'before_get', 1]]) {
    for (const fail of [() => '0'.repeat(64), () => { throw Error(secret); }]) {
      const f = fixture(t, [[200, start]]);
      let drifted = false;
      f.events.hooks[at] = () => { drifted = true; };
      const result = await f.run({ recheck: () => drifted ? fail() : f.options.approvedHash });
      assert.equal(result.phase, phase);
      assert.equal(result.reason, 'execution_inputs_changed');
      assert.equal(f.events.requests.length, requests);
      assert.equal(result.counts.get_attempts, 0);
      assert.equal(JSON.stringify(result).includes(secret), false);
    }
  }
});

test('parent sync failure prevents all communication and a claim cannot be reused', async t => {
  const f = fixture(t, []), native = fs.fsyncSync, parent = fs.statSync(path.dirname(f.root));
  await assert.rejects(f.run({ approvedHash: '0'.repeat(64) }), /approval_mismatch/);
  assert.deepEqual(fs.readdirSync(f.root), []);
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd);
    if (stat.dev === parent.dev && stat.ino === parent.ino) throw Error(secret);
    return native(fd);
  });
  assert.equal((await f.run()).reason, 'approval_sync_unconfirmed');
  await assert.rejects(f.run(), { code: 'EEXIST' });
  assert.equal(f.events.dns.length + f.events.requests.length, 0);
});

test('additional lookup and transport failure are terminal with no follow-up', async t => {
  const a = fixture(t, []);
  a.events.hooks.request = (_req, opts) => {
    opts.lookup('ignored', {}, error => assert.equal(error.message, 'additional_lookup_refused'));
    return true;
  };
  const rejected = await a.run();
  assert.equal(rejected.reason, 'additional_lookup_refused');
  assert.equal(rejected.counts.refused_additional_lookups, 1);
  assert.equal(a.events.dns.length, 1);
  const b = fixture(t, []);
  b.events.hooks.request = req => { req.emit('error', Error(secret)); return true; };
  const failed = await b.run();
  assert.equal(failed.reason, 'transport_error');
  assert.equal(b.events.requests.length, 1);
  assert.equal(JSON.stringify(failed).includes(secret), false);
});

test('the next request is refused if the approved time window no longer fits', async t => {
  const f = fixture(t, [[200, start]]);
  const result = await f.run({ recheck() {
    if (f.events.requests.length) f.events.time = LIMITS.stageMs - LIMITS.getMs + 1;
    return f.options.approvedHash;
  } });
  assert.equal(result.reason, 'stage_deadline');
  assert.equal(result.counts.post_attempts, 1);
  assert.equal(result.counts.get_attempts, 0);
  assert.equal(f.events.requests.length, 1);
});

test('file limits charge exactly 8 KiB for preparation and 8 KiB for communication', () => {
  const sum = rows => rows.reduce((n, [, bytes]) => n + bytes, 0);
  assert.equal(sum(Object.entries(CAPS)), 16 * 1024);
  assert.equal(sum(Object.entries(CAPS).filter(([file]) => file.startsWith('communication-'))), 8 * 1024);
});
