import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { executeLogin04, LOGIN04_ID } from '../../scripts/run-npm-login04.mjs';

const ip = '192.0.2.63';
const urls = { loginUrl: 'https://www.npmjs.com/login/cli/mock-login04', doneUrl: 'https://registry.npmjs.org/-/v1/done/mock-login04' };
const token = 'npm_SyntheticLogin04TokenOnly';
const ready = [[200, urls], [200, { token }]];
const secretError = 'fixture exception must stay private';

function fixture(t, responses = ready) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-login04-test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true }));
  const root = path.join(workspace, 'records'), session = path.join(workspace, 'auth');
  fs.mkdirSync(root);
  const plan = { id: LOGIN04_ID, fixture: true }, approvedHash = planHash(plan);
  const events = { lookups: [], requests: [], bodyReaders: [], browser: [], proof: [], delays: [], hooks: {}, time: 0 };
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const config = path.join(session, 'user.npmrc');
  const adapter = {
    lookup(host, opts, done) {
      events.lookups.push([host, opts]);
      queueMicrotask(() => { events.hooks.dns?.(); done(null, ip, 4); });
    },
    request(opts, receive) {
      const entry = { opts, body: undefined };
      const index = events.requests.push(entry) - 1;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = body => {
        entry.body = body;
        queueMicrotask(() => {
          if (events.hooks.request?.(req, opts)) return;
          const socket = new EventEmitter();
          Object.assign(socket, { authorized: true, remoteAddress: ip });
          req.emit('socket', socket);
          socket.emit('secureConnect');
          const [statusCode, data, headers = []] = responses[index];
          const res = new IncomingMessage(new Socket());
          res._addHeaderLines(headers, headers.length);
          Object.assign(res, { statusCode, statusMessage: 'fixture', complete: true });
          res.destroy = () => { res.destroyed = true; };
          events.hooks.response?.(index);
          receive(res);
          events.bodyReaders.push(res.listenerCount('data'));
          if (!res.destroyed) res.emit('data', Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data)));
          if (!res.destroyed) res.emit('end');
        });
      };
      return req;
    },
  };
  const options = { root, session, plan, approvedHash, adapter, recheck: () => approvedHash, now: () => events.time,
    beginBrowser(url) { events.browser.push(url); events.hooks.browser?.(); },
    presentProof(proof) { assert.equal(read('login-readback.json').verified, true); events.proof.push(proof); },
    sleep(ms) { events.delays.push(ms); events.time += ms; events.hooks.sleep?.(); },
  };
  return { root, session, config, events, options, read, run: extra => executeLogin04({ ...options, ...extra }) };
}

test('a 202 string only waits, and the validated 200 alone supplies the saved token', async t => {
  const pending = 'npm_SyntheticPendingMustNotBeUsed';
  const f = fixture(t, [[201, urls], [202, pending], [202, '', ['Retry-After', '0']],
    [202, {}, ['Retry-After', '5']], [200, { token }]]);
  const result = await f.run();
  assert.equal(result.status, 'login_confirmed');
  assert.deepEqual(f.events.delays, [2000, 1000, 5000]);
  assert.deepEqual(result.counts, { dns_calls: 1, post_attempts: 1, get_attempts: 4, put_attempts: 0, secondary_lookup_attempts: 0 });
  assert.deepEqual(f.events.browser, [urls.loginUrl]);
  assert.equal(fs.readFileSync(f.config, 'utf8'), `//registry.npmjs.org/:_authToken=${token}\n`);
  assert.equal(fs.statSync(f.config).mode & 0o777, 0o600);
  assert.equal(f.read('login-readback.json').completion_proof_sha256, createHash('sha256').update(f.events.proof[0]).digest('hex'));
  const records = JSON.stringify([result, ...fs.readdirSync(f.root).map(file => f.read(file))]);
  for (const value of [token, pending, f.events.proof[0], urls.loginUrl, urls.doneUrl]) assert.equal(records.includes(value), false);
});

test('login04 keeps login03 DNS and POST/GET request options and TLS identity', async t => {
  const f = fixture(t), baseline = fixture(t);
  const plan = { id: LOGIN03_ID, fixture: true }, approvedHash = planHash(plan);
  const old = await executeLogin03({ ...baseline.options, plan, approvedHash, recheck: () => approvedHash });
  assert.equal(old.status, 'login_confirmed');
  assert.equal((await f.run()).status, 'login_confirmed');
  assert.deepEqual(f.events.lookups, baseline.events.lookups);
  assert.equal(f.events.requests.length, 2);
  for (const [index, entry] of f.events.requests.entries()) {
    const { lookup, checkServerIdentity, ...opts } = entry.opts;
    const { lookup: oldLookup, checkServerIdentity: oldCheck, ...oldOpts } = baseline.events.requests[index].opts;
    assert.equal(typeof lookup, typeof oldLookup);
    for (const host of ['registry.npmjs.org', 'example.invalid']) {
      const cert = { subjectaltname: 'DNS:' + host };
      assert.equal(checkServerIdentity(ip, cert)?.code, oldCheck(ip, cert)?.code);
    }
    assert.deepEqual(opts, oldOpts);
    assert.equal(entry.body, baseline.events.requests[index].body);
  }
});

test('GET 200 still rejects a bare token string, missing token, invalid token and duplicate keys', async t => {
  for (const [body, reason] of [
    [token, 'login_response_shape'], [{}, 'login_session_unconfirmed'], [{ token: 'npm_short' }, 'login_session_unconfirmed'],
    [{ token: 'npm_' + 'A'.repeat(4093) }, 'login_session_unconfirmed'],
    [Buffer.from(`{"token":${JSON.stringify(token)},"tok\\u0065n":${JSON.stringify(token)}}`), 'login_duplicate_json_key'],
  ]) {
    const f = fixture(t, [[200, urls], [200, body]]), result = await f.run();
    assert.equal(result.reason, reason);
    assert.equal(result.session_file_state, 'absent');
    assert.equal(result.proof_issued, false);
    assert.equal(result.counts.get_attempts, 1);
  }
});

test('GET 202 still rejects all other top-level shapes, token-bearing objects and malformed JSON', async t => {
  for (const [body, reason] of [
    ...[null, [], 10, true, { token: null }, { token }].map(body => [body, 'login_response_shape']),
    [Buffer.from([0xff]), 'login_response_json'], [Buffer.from('"unterminated'), 'login_response_json'],
    [Buffer.from(String.raw`{"nested":[{"x":0,"\u0078":1}]}`), 'login_duplicate_json_key'],
  ]) {
    const f = fixture(t, [[200, urls], [202, body]]), result = await f.run();
    assert.equal(result.reason, reason);
    assert.equal(result.session_file_state, 'absent');
    assert.equal(result.proof_issued, false);
    assert.equal(f.events.delays.length, 0);
    assert.equal(result.counts.get_attempts, 1);
  }
});

test('202 Retry-After duplicates precede body reads and a single invalid value follows body classification', async t => {
  for (const [body, headers, readers, reason] of [
    ['waiting', ['Retry-After', '0', 'rEtRy-AfTeR', '1'], 0, 'login_poll_interval_unconfirmed'],
    [null, ['Retry-After', '01'], 1, 'login_response_shape'],
    [{ token: null }, ['Retry-After', '01'], 1, 'login_response_shape'],
    ['waiting', ['Retry-After', '01'], 1, 'login_poll_interval_unconfirmed'],
  ]) {
    const f = fixture(t, [[200, urls], [202, body, headers]]), result = await f.run();
    assert.equal(result.reason, reason);
    assert.deepEqual(f.events.bodyReaders, [1, readers]);
    assert.equal(result.counts.get_attempts, 1);
    assert.equal(f.events.delays.length, 0);
  }
});

test('the twelfth pending response stops before another wait or GET', async t => {
  const pending = Array.from({ length: 12 }, (_, i) => [202, 'waiting', ['Retry-After', i === 11 ? 'invalid' : '0']]);
  const f = fixture(t, [[200, urls], ...pending]), result = await f.run();
  assert.equal(result.reason, 'login_poll_limit');
  assert.equal(result.counts.get_attempts, 12);
  assert.equal(f.events.delays.length, 11);
  assert.equal(f.events.requests.length, 13);
  assert.equal(result.proof_issued, false);
});

test('the wait must leave the full following 30-second window within the 180-second clock', async t => {
  for (const spare of [0, -1]) {
    const f = fixture(t, [[200, urls], [202, 'waiting', ['Retry-After', '0']], [200, { token }]]);
    f.events.hooks.browser = () => { f.events.time = LIMITS.stageMs - LIMITS.getMs - 1000 - spare; };
    const result = await f.run();
    if (spare === 0) {
      assert.equal(result.status, 'login_confirmed');
      assert.deepEqual(f.events.delays, [1000]);
      assert.equal(result.counts.get_attempts, 2);
    } else {
      assert.equal(result.reason, 'login_stage_timeout');
      assert.equal(f.events.delays.length, 0);
      assert.equal(result.counts.get_attempts, 1);
    }
  }
});

test('pre-dispatch verification counts against the stage without expiring an unsent request', async t => {
  const f = fixture(t);
  let checked = false;
  const result = await f.run({ recheck() {
    if (!checked && f.events.lookups.length === 1 && f.events.requests.length === 0) {
      f.events.time += LIMITS.getMs;
      checked = true;
    }
    return f.options.approvedHash;
  } });
  assert.equal(checked, true);
  assert.equal(result.status, 'login_confirmed');
  assert.equal(result.counts.post_attempts, 1);
  assert.equal(result.counts.get_attempts, 1);
});

test('the 64 KiB body bound applies to 202 strings before JSON is used', async t => {
  for (const extra of [0, 1]) {
    const waiting = 'x'.repeat(LIMITS.bodyBytes - 2 + extra);
    const f = fixture(t, [[200, urls], [202, waiting], [200, { token }]]);
    const result = await f.run();
    assert.equal(result.status, extra ? 'stopped' : 'login_confirmed');
    assert.equal(result.counts.get_attempts, extra ? 1 : 2);
    if (extra) {
      assert.equal(result.reason, 'login_body_limit');
      assert.equal(result.session_file_state, 'absent');
      assert.equal(result.proof_issued, false);
    }
  }
});

test('POST statuses and both URLs must pass before any browser handoff or GET', async t => {
  for (const [reply, reason] of [
    [[204, urls], 'login_http_status'], [[202, 'waiting'], 'login_response_shape'], [[200, { loginUrl: urls.loginUrl }], 'login_response_shape'],
    [[201, { ...urls, loginUrl: 'https://example.invalid/login/cli/mock' }], 'login_url_rejected'],
    [[202, { ...urls, doneUrl: 'https://example.invalid/-/v1/done/mock' }], 'login_url_rejected'],
  ]) {
    const f = fixture(t, [reply]), result = await f.run();
    assert.equal(result.reason, reason);
    assert.equal(result.counts.get_attempts, 0);
    assert.equal(f.events.browser.length, 0);
    assert.equal(result.session_file_state, 'absent');
    if (reply[0] === 204) assert.deepEqual(result.http_failure, { phase: 'login_post', http_status: 204 });
  }
});

test('approval changes after DNS, waiting or final GET prevent the next request or file create', async t => {
  for (const [trigger, phase, gets] of [['dns', 'before_post', 0], ['sleep', 'before_get', 1], ['response', 'before_session_create', 2]]) {
    const f = fixture(t, [[200, urls], [202, 'waiting'], [200, { token }]]);
    let changed = false;
    f.events.hooks[trigger] = index => { if (trigger !== 'response' || index === 2) changed = true; };
    const result = await f.run({ recheck: () => changed ? '0'.repeat(64) : f.options.approvedHash });
    assert.equal(result.reason, 'execution_inputs_changed');
    assert.equal(result.phase, phase);
    assert.equal(result.counts.get_attempts, gets);
    assert.equal(result.session_file_state, 'absent');
    assert.equal(result.proof_issued, false);
  }
});

test('incomplete closure and an additional lookup are terminal without retry', async t => {
  for (const [event, reason] of [['close', 'login_response_incomplete'], ['lookup', 'login_second_dns']]) {
    const f = fixture(t, []);
    f.events.hooks.request = (req, opts) => {
      if (event === 'lookup') opts.lookup('ignored', {}, err => assert.equal(err.message, reason));
      else req.emit('close');
      return true;
    };
    const result = await f.run();
    assert.equal(result.reason, reason);
    assert.equal(result.counts.dns_calls, 1);
    assert.equal(result.counts.post_attempts, 1);
    assert.equal(result.counts.get_attempts, 0);
  }
});

test('the saved session cannot produce proof after final record drift or the stage deadline', async t => {
  for (const item of ['login-approval.json', 'login-status.json', 'login-readback.json', 'clock']) {
    const f = fixture(t);
    let intervened = false;
    const result = await f.run({ recheck() {
      if (!intervened && fs.existsSync(path.join(f.root, 'login-readback.json'))) {
        if (item === 'clock') f.events.time = LIMITS.stageMs;
        else fs.writeFileSync(path.join(f.root, item), JSON.stringify({ ...f.read(item), modified: true }) + '\n');
        intervened = true;
      }
      return f.options.approvedHash;
    } });
    assert.equal(intervened, true);
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, item === 'clock' ? 'stage_deadline' : 'record_readback_unconfirmed');
    assert.equal(result.session_file_state, 'present');
    assert.equal(result.proof_issued, false);
    assert.deepEqual(f.events.proof, []);
  }
});

test('failure of parent-directory sync leaves a one-use claim and sends no DNS or HTTP', async t => {
  const f = fixture(t), sync = fs.fsyncSync, parent = fs.statSync(path.dirname(f.root));
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd);
    if (stat.ino === parent.ino && stat.dev === parent.dev) throw Error(secretError);
    return sync(fd);
  });
  const result = await f.run();
  assert.equal(result.reason, 'login_parent_sync_unconfirmed');
  assert.equal(f.events.lookups.length + f.events.requests.length, 0);
  await assert.rejects(f.run(), { code: 'EEXIST' });
});

