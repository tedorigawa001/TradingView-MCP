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
import { runWebLogin02 } from '../../scripts/npm-session-release.mjs';
import { planHash } from '../../scripts/run-npm-session-release.mjs';
import { executeLogin03, LOGIN03_ID } from '../../scripts/run-npm-login03.mjs';

const ip = '192.0.2.63';
const urls = { loginUrl: 'https://www.npmjs.com/login/cli/mock-login03', doneUrl: 'https://registry.npmjs.org/-/v1/done/mock-login03' };
const token = 'npm_SyntheticLogin03TokenOnly';
const ready = [[200, urls], [200, { token }]];
const secretError = 'fixture exception must stay private';

function fixture(t, responses = ready) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-login03-test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true }));
  const root = path.join(workspace, 'records'), session = path.join(workspace, 'auth');
  fs.mkdirSync(root);
  const plan = { id: LOGIN03_ID, fixture: true }, approvedHash = planHash(plan);
  const events = { lookups: [], requests: [], browser: [], proof: [], delays: [], hooks: {}, time: 0 };
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
  return { root, session, config, events, options, read, run: extra => executeLogin03({ ...options, ...extra }) };
}

test('login03 adds only npm-auth-type to the first POST and issues proof after durable readback', async t => {
  const original = fixture(t), f = fixture(t);
  await runWebLogin02({ ...original.options.adapter, beginBrowser() {}, writeSession() {} });
  const result = await f.run();
  assert.equal(result.status, 'login_confirmed');
  assert.equal(result.proof_issued, true);
  assert.equal(result.session_file_state, 'present');
  assert.equal(f.events.proof.length, 1);
  assert.deepEqual(f.events.lookups, original.events.lookups);
  assert.equal(f.events.requests.length, 2);
  for (const [i, request] of f.events.requests.entries()) {
    const { lookup, checkServerIdentity, ...current } = request.opts;
    const { lookup: beforeLookup, checkServerIdentity: beforeCheck, ...before } = original.events.requests[i].opts;
    assert.equal(typeof lookup, typeof beforeLookup);
    for (const host of ['registry.npmjs.org', 'example.invalid']) {
      const cert = { subjectaltname: 'DNS:' + host };
      assert.equal(checkServerIdentity(ip, cert)?.code, beforeCheck(ip, cert)?.code);
    }
    if (i === 0) before.headers['npm-auth-type'] = 'web';
    assert.deepEqual(current, before);
    assert.equal(request.body, original.events.requests[i].body);
  }
  assert.equal(fs.statSync(f.session).mode & 0o777, 0o700);
  assert.equal(fs.statSync(f.config).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(f.config, 'utf8'), `//registry.npmjs.org/:_authToken=${token}\n`);
  assert.equal(f.read('login-readback.json').completion_proof_sha256, createHash('sha256').update(f.events.proof[0]).digest('hex'));
  const persisted = JSON.stringify([result, f.read('login-status.json'), f.read('login-readback.json')]);
  for (const secret of [token, ...Object.values(urls), f.events.proof[0]]) assert.equal(persisted.includes(secret), false);
});

for (const [step, phase, requests] of [['dns', 'before_post', 0], ['browser', 'before_get', 1], ['sleep', 'before_get', 2],
  ['response', 'before_session_create', 3]]) {
  test(`login03 stops before ${phase} when approved inputs change during ${step}`, async t => {
    for (const fail of [() => '0'.repeat(64), () => { throw Error(secretError); }]) {
      const f = fixture(t, [[200, urls], [202, {}], [200, { token }]]);
      let changed = false;
      f.events.hooks[step] = index => { if (step !== 'response' || index === 2) changed = true; };
      const result = await f.run({ recheck: () => changed ? fail() : f.options.approvedHash });
      assert.equal(result.status, 'stopped');
      assert.equal(result.reason, 'execution_inputs_changed');
      assert.equal(result.phase, phase);
      assert.equal(result.counts.dns_calls, 1);
      assert.equal(result.counts.post_attempts, Math.min(1, requests));
      assert.equal(result.counts.get_attempts, Math.max(0, requests - 1));
      assert.equal(f.events.requests.length, requests);
      assert.equal(fs.existsSync(f.session), false);
      assert.equal(result.session_file_state, 'absent');
      assert.equal(result.proof_issued, false);
      assert.equal(f.read('login-readback.json').completion_proof_sha256, null);
      assert.equal(JSON.stringify(result).includes(secretError), false);
    }
  });
}

test('approval mismatch and parent sync failure dispatch zero requests, with a durable one-use approval claim', async t => {
  const f = fixture(t);
  await assert.rejects(f.run({ approvedHash: '0'.repeat(64) }), /approval_mismatch/);
  assert.deepEqual(fs.readdirSync(f.root), []);
  const parent = fs.statSync(path.dirname(f.root)), native = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd);
    if (stat.dev === parent.dev && stat.ino === parent.ino) {
      assert.equal(f.read('login-approval.json').consumed, true);
      throw Error(secretError);
    }
    return native(fd);
  });
  const result = await f.run();
  assert.equal(result.reason, 'login_parent_sync_unconfirmed');
  await assert.rejects(f.run(), { code: 'EEXIST' });
  assert.equal(f.events.lookups.length + f.events.requests.length, 0);
});

test('session sync failure preserves the file and never presents proof', async t => {
  const f = fixture(t), native = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', fd => {
    if (fs.existsSync(f.config) && fs.fstatSync(fd).ino === fs.statSync(f.config).ino) throw Error(secretError);
    return native(fd);
  });
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'login_session_save_failed');
  assert.equal(result.session_file_state, 'present');
  assert.equal(result.proof_issued, false);
  assert.equal(f.events.proof.length, 0);
  assert.equal(f.read('login-status.json').session_file_state, 'present');
  assert.equal(f.read('login-readback.json').completion_proof_sha256, null);
  assert.ok(fs.existsSync(f.config));
});

test('execution readback creation failure preserves the session without proof', async t => {
  const f = fixture(t), native = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...rest) => {
    if (file === path.join(f.root, 'login-readback.json')) throw Error(secretError);
    return native(file, ...rest);
  });
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'record_readback_unconfirmed');
  assert.equal(result.readback, null);
  assert.equal(result.session_file_state, 'present');
  assert.equal(result.proof_issued, false);
  assert.deepEqual(f.events.proof, []);
});

test('read failure after successful readback save and sync preserves the session without proof', async t => {
  const f = fixture(t), open = fs.openSync, sync = fs.fsyncSync;
  const file = path.join(f.root, 'login-readback.json');
  const rootStat = fs.statSync(f.root);
  let fileSynced = false, directorySynced = false, failedRead = false;
  t.mock.method(fs, 'fsyncSync', fd => {
    sync(fd);
    const stat = fs.fstatSync(fd);
    if (fs.existsSync(file) && stat.ino === fs.statSync(file).ino) fileSynced = true;
    if (fileSynced && stat.ino === rootStat.ino && stat.dev === rootStat.dev) directorySynced = true;
  });
  t.mock.method(fs, 'openSync', (target, flags, ...rest) => {
    if (target === file && !(flags & fs.constants.O_WRONLY) && !failedRead) {
      assert.equal(fileSynced && directorySynced, true);
      assert.ok(fs.statSync(file).size > 0);
      failedRead = true;
      throw Error(secretError);
    }
    return open(target, flags, ...rest);
  });
  const result = await f.run();
  assert.equal(failedRead, true);
  assert.equal(f.read('login-readback.json').status, 'session_verified');
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'record_readback_unconfirmed');
  assert.equal(result.readback, null);
  assert.equal(result.session_file_state, 'present');
  assert.equal(result.proof_issued, false);
  assert.deepEqual(f.events.proof, []);
});

test('changes to any execution record during final recheck block proof presentation', async t => {
  for (const changed of ['login-approval.json', 'login-status.json', 'login-readback.json']) {
    const f = fixture(t), file = path.join(f.root, changed);
    let replaced = false;
    const result = await f.run({ recheck() {
      if (!replaced && fs.existsSync(path.join(f.root, 'login-readback.json'))) {
        const before = f.read(changed);
        fs.writeFileSync(file, JSON.stringify({ ...before, altered: true }) + '\n');
        replaced = true;
      }
      return f.options.approvedHash;
    } });
    assert.equal(replaced, true);
    assert.equal(result.status, 'stopped', changed);
    assert.equal(result.phase, 'proof_release');
    assert.equal(result.reason, 'record_readback_unconfirmed');
    assert.equal(result.readback, null);
    assert.equal(result.session_file_state, 'present');
    assert.equal(result.proof_issued, false);
    assert.deepEqual(f.events.proof, []);
    assert.equal(f.read(changed).altered, true);
  }
});

test('readback finishing at the deadline keeps a conditional receipt and withholds proof', async t => {
  const f = fixture(t);
  const result = await f.run({ now: () => fs.existsSync(path.join(f.root, 'login-readback.json')) ? LIMITS.stageMs : 0 });
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'stage_deadline');
  assert.equal(result.session_file_state, 'present');
  assert.equal(result.proof_issued, false);
  assert.equal(f.read('login-readback.json').status, 'session_verified');
  assert.deepEqual(f.events.proof, []);
});

test('a late input mismatch or changed session after readback blocks proof presentation', async t => {
  for (const change of ['inputs', 'session']) {
    const f = fixture(t);
    const result = await f.run({ recheck() {
      if (fs.existsSync(path.join(f.root, 'login-readback.json'))) {
        if (change === 'inputs') return '0'.repeat(64);
        fs.unlinkSync(f.config);
      }
      return f.options.approvedHash;
    } });
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, change === 'inputs' ? 'execution_inputs_changed' : 'login03_session_changed');
    assert.equal(result.session_file_state, change === 'inputs' ? 'present' : 'absent');
    assert.equal(result.proof_issued, false);
    assert.deepEqual(f.events.proof, []);
  }
});

test('HTTP limits and pending responses cannot trigger a thirteenth GET or a repeat POST', async t => {
  const cases = [
    [[[403, {}]], 'login_http_status', 0],
    [[[200, Buffer.alloc(LIMITS.bodyBytes + 1)]], 'login_body_limit', 0],
    [[[200, urls, ['x-test', 'x'.repeat(LIMITS.headerBytes)]]], 'login_header_limit', 0],
    [[[200, urls], [202, {}, ['Retry-After', '0', 'retry-after', '1']]], 'login_poll_interval_unconfirmed', 1],
    [[[200, urls], ...Array.from({ length: 12 }, () => [202, {}])], 'login_poll_limit', 12],
  ];
  for (const [replies, reason, gets] of cases) {
    const f = fixture(t, replies);
    const result = await f.run();
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, reason);
    assert.equal(result.counts.get_attempts, gets);
    assert.equal(result.counts.post_attempts, 1);
    assert.equal(f.events.requests.length, 1 + gets);
    assert.equal(result.proof_issued, false);
  }
});

test('recheck that exhausts the next request window stops before sending that request', async t => {
  for (const [requests, time] of [[0, LIMITS.stageMs - LIMITS.getMs + 1], [1, LIMITS.stageMs - LIMITS.getMs + 1]]) {
    const f = fixture(t);
    const result = await f.run({ recheck() {
      if (f.events.lookups.length === 1 && f.events.requests.length === requests) f.events.time = time;
      return f.options.approvedHash;
    } });
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, 'stage_deadline');
    assert.equal(f.events.requests.length, requests);
    assert.equal(result.proof_issued, false);
  }
});
