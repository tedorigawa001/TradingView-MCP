import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runWebLogin02 } from '../../scripts/npm-session-release.mjs';
import { LIMITS } from '../../scripts/prepare-npm-preflight.mjs';
import { planHash } from '../../scripts/run-npm-session-release.mjs';
import { CAPS, DIAGNOSTIC_ID, executeDiagnostic } from '../../scripts/run-npm-login-header01.mjs';

const address = '192.0.2.61';
const sensitive = 'fixture-string-must-not-be-persisted';

function fixture(t, { status = 401, rawHeaders = [], headers = {}, peer = address, resolve, beforeResponse = () => false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-login-header-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const plan = { id: DIAGNOSTIC_ID, fixture: true }, approvedHash = planHash(plan);
  const events = { dns: [], requests: [], bodies: [], destroyed: 0 };
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const options = { root, plan, approvedHash, recheck: () => approvedHash, now: () => 0, adapter: {
    lookup(host, dnsOptions, callback) {
      events.dns.push([host, dnsOptions]);
      assert.equal(read('communication-approval.json').consumed, true);
      if (resolve) return resolve(callback);
      callback(null, address, 4);
    },
    request(opts, receive) {
      events.requests.push(opts);
      const req = new EventEmitter();
      req.destroy = () => { req.destroyed = true; };
      req.end = body => {
        events.bodies.push(body);
        queueMicrotask(() => {
          if (beforeResponse({ req, opts })) return;
          const socket = new EventEmitter();
          Object.assign(socket, { authorized: true, remoteAddress: peer });
          req.emit('socket', socket);
          socket.emit('secureConnect');
          const res = new EventEmitter();
          Object.assign(res, { statusCode: status, statusMessage: sensitive, rawHeaders, headers,
            destroy() { events.destroyed++; } });
          receive(res);
          assert.equal(res.listenerCount('data'), 0);
          assert.equal(res.listenerCount('end'), 0);
        });
      };
      return req;
    },
  } };
  return { root, events, read, options, run: extra => executeDiagnostic({ ...options, ...extra }) };
}

test('diagnostic POST differs from login02 only by npm-auth-type and destroys the first response unread', async t => {
  let baseline, baselineBody;
  await assert.rejects(runWebLogin02({ lookup(_host, _options, cb) { cb(null, address, 4); },
    request(opts) {
      baseline = opts;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = body => { baselineBody = body; req.emit('error', Error('fixture capture')); };
      return req;
    }, beginBrowser() { assert.fail('unexpected browser'); }, writeSession() { assert.fail('unexpected saved authentication'); },
  }), /login_transport_error/);
  const f = fixture(t, { rawHeaders: ['Location', 'https://example.invalid/' + sensitive, 'Set-Cookie', sensitive] });
  const result = await f.run();
  assert.equal(result.status, 'diagnostic_complete');
  assert.equal(result.http_status, 401);
  assert.equal(result.phase, 'login_post');
  assert.equal(result.approval_consumed, true);
  assert.deepEqual(f.events.dns, [['registry.npmjs.org', { family: 4, all: false }]]);
  assert.deepEqual(f.events.bodies, [baselineBody]);
  const { lookup: baselineLookup, checkServerIdentity: baselineCheck, ...original } = baseline;
  const { lookup: variantLookup, checkServerIdentity: variantCheck, ...variant } = f.events.requests[0];
  assert.equal(typeof baselineLookup, 'function');
  assert.equal(typeof variantLookup, 'function');
  assert.deepEqual(variant, { ...original, headers: { ...original.headers, 'npm-auth-type': 'web' } });
  for (const certificate of ['DNS:registry.npmjs.org', 'DNS:example.invalid']) {
    const cert = { subjectaltname: certificate };
    assert.equal(variantCheck(address, cert)?.code, baselineCheck(address, cert)?.code);
  }
  assert.equal(f.events.requests.length, 1);
  assert.ok(f.events.destroyed > 0);
  assert.equal(result.counts.get_attempts + result.counts.put_attempts, 0);
  assert.equal(f.read('communication-readback.json').verified, true);
  assert.equal(f.read('communication-status.json').status, 'response_observed');
  assert.ok(!JSON.stringify([result, f.read('communication-status.json')]).includes(sensitive));
});

test('after 2xx and redirects, the probe records the status and makes no further requests', async t => {
  for (const status of [200, 201, 202, 302]) {
    const f = fixture(t, { status, headers: { location: 'https://example.invalid/' + sensitive } });
    const result = await f.run();
    assert.equal(result.status, 'diagnostic_complete');
    assert.equal(result.http_status, status);
    assert.equal(f.events.requests.length, 1);
    assert.equal(result.counts.get_attempts + result.counts.put_attempts, 0);
  }
});

test('approval mismatch writes nothing and the consumed claim prevents another execution', async t => {
  const f = fixture(t);
  await assert.rejects(f.run({ approvedHash: '0'.repeat(64) }), /approval_mismatch/);
  await assert.rejects(f.run({ recheck: () => '0'.repeat(64) }), /execution_inputs_changed/);
  assert.deepEqual(fs.readdirSync(f.root), []);
  const result = await f.run();
  assert.equal(result.status, 'diagnostic_complete');
  await assert.rejects(f.run(), { code: 'EEXIST' });
  assert.equal(f.events.dns.length, 1);
});

test('inputs changed while DNS was pending stop the diagnostic before any POST', async t => {
  for (const onChange of [() => '0'.repeat(64), () => { throw Error(sensitive); }]) {
    let changed = false;
    const f = fixture(t, { resolve(callback) {
      queueMicrotask(() => {
        changed = true;
        callback(null, address, 4);
      });
    } });
    const result = await f.run({ recheck: () => changed ? onChange() : f.options.approvedHash });
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, 'execution_inputs_changed');
    assert.equal(result.phase, 'before_post');
    assert.equal(result.counts.dns_calls, 1);
    assert.equal(result.counts.post_attempts, 0);
    assert.equal(f.events.requests.length, 0);
    assert.equal(result.http_status, null);
    assert.equal(f.read('communication-status.json').counts.post_attempts, 0);
    assert.equal(f.read('communication-readback.json').verified, true);
  }
});

test('parent directory sync occurs after saving approval and before dispatch, and a failure prevents traffic', async t => {
  const f = fixture(t), parent = fs.lstatSync(path.dirname(f.root), { bigint: true }), native = fs.fsyncSync;
  let attempts = 0;
  t.mock.method(fs, 'fsyncSync', fd => {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (stat.dev === parent.dev && stat.ino === parent.ino) {
      attempts++;
      assert.equal(f.read('communication-approval.json').consumed, true);
      assert.equal(f.events.dns.length + f.events.requests.length, 0);
      throw Error('fixture sync failure');
    }
    return native(fd);
  });
  const result = await f.run();
  assert.equal(attempts, 1);
  assert.equal(result.reason, 'approval_sync_unconfirmed');
  assert.equal(result.http_status, null);
  assert.equal(result.counts.dns_calls + result.counts.post_attempts, 0);
  assert.equal(f.read('communication-readback.json').verified, true);
});

test('an invalid DNS result or a mismatched TLS peer cannot become a final observation', async t => {
  const dns = fixture(t, { resolve(cb) { cb(null, '2001:db8::1', 6); } });
  assert.equal((await dns.run()).reason, 'dns_unconfirmed');
  assert.equal(dns.events.requests.length, 0);
  const https = fixture(t, { peer: '192.0.2.62' });
  const result = await https.run();
  assert.equal(result.reason, 'tls_peer_unconfirmed');
  assert.equal(result.http_status, null);
  assert.equal(https.events.requests.length, 1);
});

test('an extra DNS lookup is refused without another resolver call, and transport failure is not retried', async t => {
  const extra = fixture(t, { beforeResponse({ opts }) {
    opts.lookup('ignored', {}, error => assert.match(error.message, /additional_lookup_refused/));
    return true;
  } });
  const refused = await extra.run();
  assert.equal(refused.reason, 'additional_lookup_refused');
  assert.equal(refused.counts.refused_additional_lookups, 1);
  assert.equal(extra.events.dns.length, 1);
  const reset = fixture(t, { beforeResponse({ req }) { req.emit('error', Error(sensitive)); return true; } });
  const result = await reset.run();
  assert.equal(result.reason, 'transport_error');
  assert.equal(result.http_status, null);
  assert.equal(reset.events.requests.length, 1);
  assert.ok(!JSON.stringify(result).includes(sensitive));
});

test('header size, declared body size and informational statuses stop at the first response', async t => {
  const oversize = fixture(t, { rawHeaders: ['x-large', 'x'.repeat(LIMITS.headerBytes)] });
  const header = await oversize.run();
  assert.equal(header.reason, 'response_header_limit');
  assert.equal(header.http_status, null);
  const longBody = fixture(t, { status: 202, headers: { 'content-length': String(LIMITS.bodyBytes + 1) } });
  const body = await longBody.run();
  assert.equal(body.reason, 'response_body_limit');
  assert.equal(body.http_status, 202);
  assert.equal(longBody.events.requests.length, 1);
  const interim = fixture(t, { status: 101 });
  assert.equal((await interim.run()).reason, 'invalid_final_status');
});

test('deadline before dispatch, late header, and late readback each stop without a retry', async t => {
  const early = fixture(t);
  await assert.rejects(early.run({ startedAt: 0, now: () => LIMITS.stageMs }), /stage_deadline/);
  assert.deepEqual(fs.readdirSync(early.root), []);
  let current = 0;
  const slow = fixture(t, { beforeResponse() { current = LIMITS.getMs; } });
  const late = await slow.run({ now: () => current });
  assert.equal(late.reason, 'http_timeout');
  assert.equal(late.http_status, null);
  assert.equal(slow.events.requests.length, 1);
  const readback = fixture(t);
  const finish = await readback.run({ now: () => fs.existsSync(path.join(readback.root, 'communication-readback.json')) ? LIMITS.stageMs : 0 });
  assert.equal(finish.status, 'stopped');
  assert.equal(finish.reason, 'readback_deadline');
  assert.equal(finish.http_status, 401);
  assert.equal(readback.events.requests.length, 1);
});

test('fixed preparation and communication file caps fit within the single 16 KiB reservation', () => {
  const sum = values => values.reduce((a, b) => a + b, 0);
  assert.equal(sum(Object.values(CAPS)), 16 * 1024);
  assert.equal(sum(Object.entries(CAPS).filter(([file]) => file.startsWith('communication-')).map(([, bytes]) => bytes)), 8 * 1024);
});
