import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ID, LIMITS, ROUTES } from '../../scripts/prepare-npm-preflight.mjs';
import { checkTransportEnvironment, executePreflight, planHash } from '../../scripts/run-npm-preflight.mjs';

const preparation = ['approval-setup.json', 'inputs.json', 'tests.json', 'setup-status.json', 'setup-readback.json'];
const secret = 'mock-token-not-for-logs';
const account = 'private-test-account';
const address = '192.0.2.42';
const responses = [
  [200, { username: account }], [200, { [account]: 'read-write' }],
  [404, { error: 'version not found: 0.1.46' }], [200, { latest: '0.1.45' }],
];

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-preflight-test-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  for (const file of preparation) fs.writeFileSync(path.join(root, file), 'preserved\n');
  const plan = { id: ID, cumulative_reserved: 49875954 };
  const approvedHash = planHash(plan);
  const trace = { credentials: 0, dns: 0, routes: [] };
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const options = {
    root, plan, approvedHash, recheck: () => approvedHash,
    credentials() {
      trace.credentials++;
      assert.equal(JSON.parse(read('approval-preflight.json')).consumed, true);
      return secret;
    },
    lookup(host, options, cb) {
      trace.dns++;
      assert.equal(host, 'registry.npmjs.org');
      assert.deepEqual(options, { family: 4, all: false });
      cb(null, address, 4);
    },
    request(options, receive) {
      const idx = trace.routes.push(options.path) - 1;
      assert.equal(options.method, 'GET');
      assert.equal(options.hostname, address);
      assert.equal(options.headers.authorization, 'Bearer ' + secret);
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        if (overrides.beforeResponse?.({ root, req, idx, options })) return;
        const socket = new EventEmitter();
        Object.assign(socket, { authorized: true, remoteAddress: address });
        req.emit('socket', socket);
        socket.emit('secureConnect');
        const [statusCode, body] = (overrides.responses ?? responses)[idx];
        const res = new EventEmitter();
        Object.assign(res, { statusCode, statusMessage: 'synthetic', headers: {}, rawHeaders: [], complete: true });
        res.destroy = () => { res.destroyed = true; };
        receive(res);
        if (res.destroyed) return;
        res.emit('data', Buffer.from(JSON.stringify(body)));
        res.emit('end');
      });
      return req;
    },
  };
  return { root, trace, options, read, run: extra => executePreflight({ ...options, ...extra }) };
}

test('bound approval is durable before credentials and only four GET summaries are saved and read back', async t => {
  const f = fixture(t);
  const result = await f.run();
  assert.equal(result.status, 'queries_confirmed');
  assert.equal(result.readback_verified, true);
  assert.deepEqual(f.trace, { credentials: 1, dns: 1, routes: Object.values(ROUTES) });
  assert.deepEqual(result.counts, { dns_calls: 1, https_get_attempts: 4, secondary_lookup_attempts: 0, https_puts: 0 });
  const readback = JSON.parse(f.read('preflight-readback.json'));
  assert.equal(readback.records.length, 6);
  assert.equal(readback.bytes_before_readback + Buffer.byteLength(f.read('preflight-readback.json')), result.bytes_written_and_verified);
  for (const entry of readback.records) {
    const bytes = f.read(entry.file);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(entry.bytes, Buffer.byteLength(bytes));
    for (const undisclosed of [secret, account, address]) assert.ok(!bytes.includes(undisclosed));
  }
  for (const file of preparation) assert.equal(f.read(file), 'preserved\n');
  assert.equal(JSON.parse(f.read('rights.json')).token_publish_permission, 'unconfirmed');
  assert.equal(result.publication_approved, false);
  assert.equal(result.protected_765_bytes_used, 0);
});

test('approval hash and a fresh matching input are required before any write or credential lookup', async t => {
  const f = fixture(t);
  await assert.rejects(f.run({ approvedHash: '0'.repeat(64) }), /preflight_approval_mismatch/);
  await assert.rejects(f.run({ recheck: () => '0'.repeat(64) }), /execution_inputs_changed/);
  assert.deepEqual(fs.readdirSync(f.root).sort(), preparation.slice().sort());
  assert.deepEqual(f.trace, { credentials: 0, dns: 0, routes: [] });
});

test('two contenders cannot use the same approval', async t => {
  const f = fixture(t);
  const outcomes = await Promise.allSettled([f.run(), f.run()]);
  assert.equal(outcomes[0].value.status, 'queries_confirmed');
  assert.match(outcomes[1].reason.message, /preflight_id_consumed/);
  assert.equal(f.trace.credentials, 1);
  assert.equal(f.trace.dns, 1);
  assert.equal(f.trace.routes.length, 4);
});

test('a partial or preexisting approval also blocks credentials and network', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'approval-preflight.json'), 'partial');
  await assert.rejects(f.run(), /preflight_id_consumed/);
  assert.equal(f.read('approval-preflight.json'), 'partial');
  assert.deepEqual(f.trace, { credentials: 0, dns: 0, routes: [] });
});

test('missing existing credentials consumes the approval with zero DNS or GETs and no raw error', async t => {
  const f = fixture(t);
  const result = await f.run({ credentials() { throw Error(secret); } });
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'existing_credentials_unavailable');
  assert.equal(result.approval_consumed, true);
  assert.equal(result.readback_verified, true);
  assert.deepEqual(f.trace.routes, []);
  assert.equal(f.trace.dns, 0);
  assert.ok(!f.read('preflight-status.json').includes(secret));
  await assert.rejects(f.run(), /preflight_id_consumed/);
});

test('an unexpected response stops after two GET attempts and preserves the first summary', async t => {
  const f = fixture(t, { responses: [responses[0], [403, { arbitrary: secret }]] });
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'http_status_403');
  assert.equal(result.counts.https_get_attempts, 2);
  assert.equal(result.readback_verified, true);
  assert.ok(fs.existsSync(path.join(f.root, 'account.json')));
  assert.ok(!fs.existsSync(path.join(f.root, 'rights.json')));
  assert.ok(!f.read('preflight-status.json').includes(secret));
});

test('a secondary lookup is refused and stops even if the transport delivers a response', async t => {
  const f = fixture(t, { beforeResponse({ options }) { options.lookup('unused', {}, e => assert.ok(e)); } });
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.counts.dns_calls, 1);
  assert.equal(result.counts.secondary_lookup_attempts, 1);
  assert.equal(result.counts.https_get_attempts, 1);
  assert.ok(!fs.existsSync(path.join(f.root, 'account.json')));
});

test('a summary write collision stops further GETs and leaves the colliding file intact', async t => {
  const f = fixture(t, { beforeResponse({ root, idx }) {
    if (idx === 1) fs.writeFileSync(path.join(root, 'rights.json'), 'collision');
  } });
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'response_record_failed');
  assert.equal(result.response_record_may_be_partial, true);
  assert.equal(result.counts.https_get_attempts, 2);
  assert.equal(result.readback_verified, true);
  assert.equal(f.read('rights.json'), 'collision');
  assert.ok(!JSON.parse(f.read('preflight-readback.json')).records.some(row => row.file === 'rights.json'));
});

test('changes discovered by the final input check stop adoption and leave four recorded GETs', async t => {
  const f = fixture(t);
  let checks = 0;
  const result = await f.run({ recheck: () => checks++ === 0 ? f.options.approvedHash : '0'.repeat(64) });
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'final_input_or_count_unconfirmed');
  assert.equal(result.counts.https_get_attempts, 4);
  assert.equal(result.readback_verified, true);
});

test('a final readback file collision cannot be reported as confirmed or retried', async t => {
  const f = fixture(t, { beforeResponse({ root, idx }) {
    if (idx === 3) fs.writeFileSync(path.join(root, 'preflight-readback.json'), 'collision');
  } });
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'final_record_or_readback_unconfirmed');
  assert.equal(result.readback_verified, false);
  assert.equal(f.read('preflight-readback.json'), 'collision');
  await assert.rejects(f.run(), /preflight_id_consumed/);
});

test('an expired monotonic window stops the next request', async t => {
  let time = 0;
  const f = fixture(t, { beforeResponse() { time = LIMITS.stageMs - 1; } });
  const result = await f.run({ now: () => time });
  assert.equal(result.status, 'stopped');
  assert.equal(result.counts.https_get_attempts, 1);
});

test('time spent before execution counts against the first dispatch and approval consumption', async t => {
  const f = fixture(t);
  await assert.rejects(f.run({ startedAt: 0, now: () => LIMITS.stageMs - LIMITS.dnsMs }), /stage_timeout/);
  assert.deepEqual(fs.readdirSync(f.root).sort(), preparation.slice().sort());
  assert.deepEqual(f.trace, { credentials: 0, dns: 0, routes: [] });
});

test('proxy, TLS and runtime overrides fail closed without disclosing their values', () => {
  for (const key of ['https_proxy', 'ALL_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'SSLKEYLOGFILE']) {
    assert.throws(() => checkTransportEnvironment({ [key]: secret }), { message: 'transport_environment_override' });
  }
  assert.doesNotThrow(() => checkTransportEnvironment({ NO_PROXY: '*', NODE_AUTH_TOKEN: secret }));
});
