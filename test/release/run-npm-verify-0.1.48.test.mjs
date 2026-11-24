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
import { ACCOUNT } from '../../scripts/npm-session-release.mjs';
import { verifyArtifactBytes } from '../../scripts/npm-release-kit.mjs';
import { ALLOCATION as RELEASE_ALLOCATION, LOGIN_ID, PLAN_TARGET, PUB_ID, ROUTES, readbackJudges } from '../../scripts/run-npm-release-0.1.48.mjs';
import { ALLOCATION, ENTITY_SHA256, HISTORY, PUBLICATION_APPROVAL, RECORDS, SLOTS, SUCCESS_BODY, TESTS, VERIFY_ID, approvalRecord,
  checkAllocation, executeVerify, getOptions, planFor, safeReason, verifyHistory } from '../../scripts/run-npm-verify-0.1.48.mjs';

const ip = '192.0.2.48';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value) + '\n');
const artifact = Buffer.from('synthetic 0.1.48 tarball bytes for the verify runner tests');
const expected = { bytes: artifact.length, sha256: sha(artifact) };
const digests = verifyArtifactBytes(artifact, expected);
const manifest = { name: PLAN_TARGET.name, version: PLAN_TARGET.version, main: 'build/index.js', bin: { [PLAN_TARGET.name]: 'build/index.js' },
  files: ['build/**/*.js'], scripts: { build: 'tsc' }, dependencies: { zod: '^4.0.0' }, engines: { node: '>=20' } };
const dist = { integrity: digests.integrity, shasum: digests.shasum,
  tarball: 'https://registry.npmjs.org/bushido-tradingview-mcp/-/bushido-tradingview-mcp-0.1.48.tgz' };
const { files: _files, ...withoutFiles } = manifest;
const live = [[200, { ...withoutFiles, dist }], [200, { latest: '0.1.48' }], [200, artifact],
  [200, { name: PLAN_TARGET.name, 'dist-tags': { latest: '0.1.48' }, versions: { '0.1.48': { name: PLAN_TARGET.name, version: '0.1.48', dist } } }]];
const UTC0 = 1795300000000;

function fixture(t, responses) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-verify-047-test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true }));
  const root = path.join(workspace, VERIFY_ID);
  fs.mkdirSync(root);
  const plan = planFor({ id: VERIFY_ID, root, target: PLAN_TARGET, slots: SLOTS, history: HISTORY,
    publication: { publication_readback_sha256: HISTORY[PUB_ID][1], login_readback_sha256: HISTORY[LOGIN_ID][1],
      recorded_outcome: 'accepted_readback_unconfirmed', put_reply: 'accepted',
      send_2: { http_status: 202, response_bytes: SUCCESS_BODY.length, response_sha256: sha(SUCCESS_BODY) } },
    artifact: { file: 'artifact.tgz', ...digests }, manifest_sha256: 'e'.repeat(64), record_limits: RECORDS },
  { reservation_sha256: 'a'.repeat(64), inputs_sha256: 'b'.repeat(64), tests_sha256: 'c'.repeat(64), preparation_readback_sha256: 'd'.repeat(64) });
  const approvedHash = planHash(plan);
  const events = { lookups: 0, requests: [], time: 0, recheck: approvedHash, hooks: {}, lookupError: null };
  const adapter = {
    lookup(host, opts, done) { events.lookups++; queueMicrotask(() => done(events.lookupError, ip, 4)); },
    request(opts, receive) {
      const index = events.requests.push({ method: opts.method, path: opts.path, headers: opts.headers, opts }) - 1;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => queueMicrotask(() => {
        events.hooks.request?.(index, opts);
        const socket = new EventEmitter();
        Object.assign(socket, { authorized: true, remoteAddress: ip });
        req.emit('socket', socket);
        socket.emit('secureConnect');
        const entry = responses[index];
        if (entry === 'reset' || entry === undefined) return req.emit('error', Object.assign(Error('reset'), { code: 'ECONNRESET' }));
        const [statusCode, data] = entry;
        const res = new IncomingMessage(new Socket());
        Object.assign(res, { statusCode, statusMessage: 'fixture', complete: true, rawHeaders: [] });
        Object.defineProperty(res, 'headers', { value: {} });
        res.destroy = () => { res.destroyed = true; };
        receive(res);
        if (!res.destroyed) res.emit('data', Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data)));
        if (!res.destroyed) res.emit('end');
      });
      return req;
    },
  };
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const run = more => executeVerify({ root, plan, approvedHash, adapter, recheck: () => events.recheck, now: () => events.time,
    wall: () => UTC0, judges: readbackJudges({ artifact, manifest, digests }, expected), ...more });
  return { root, plan, approvedHash, events, read, run };
}

test('verify01 is fixed to its ID, routes, history and the second release-stage reservation', () => {
  assert.equal(VERIFY_ID, 'package-2026-11-24-publish-0.1.48-verify01');
  assert.deepEqual(SLOTS.map(s => s.route), Object.values(ROUTES.readback));
  assert.deepEqual(Object.keys(HISTORY), [LOGIN_ID, PUB_ID]);
  assert.equal(PUBLICATION_APPROVAL.length, 64);
  checkAllocation();
  assert.equal(ALLOCATION.prior_release_stage_use, RELEASE_ALLOCATION.release_stage_cumulative);
  assert.equal(ALLOCATION.reservation, Object.values(RECORDS).reduce((a, b) => a + b, 0));
  assert.equal(ALLOCATION.release_stage_cumulative, 241664 + 69632);
  assert.equal(ALLOCATION.release_stage_cumulative + ALLOCATION.release_stage_remaining, 2 * 1024 * 1024);
  for (const file of TESTS) assert.ok(fs.statSync(new URL('../../' + file, import.meta.url)).isFile(), file);
  assert.equal(sha(SUCCESS_BODY), 'c955e57777ec0d73639dca6748560d00aa5eb8e12f13ebb2ed9656add3908f97');
});

test('readback GETs are anonymous, pinned, certificate-checked and carry the cache buster', () => {
  let lookups = 0;
  const options = getOptions(ip, SLOTS[2], '?t=123', () => { lookups++; });
  assert.equal(options.path, ROUTES.readback.tarball + '?t=123');
  assert.equal(Object.hasOwn(options.headers, 'authorization'), false);
  assert.deepEqual([options.hostname, options.servername, options.port, options.family, options.agent, options.autoSelectFamily,
    options.rejectUnauthorized, options.headers['cache-control'], options.headers.accept],
  [ip, 'registry.npmjs.org', 443, 4, false, false, true, 'no-cache', 'application/octet-stream']);
  assert.equal(typeof options.checkServerIdentity, 'function');
  options.lookup('registry.npmjs.org', {}, error => assert.match(error.message, /additional_lookup_refused/));
  assert.equal(lookups, 1);
});

function historyFixture(t, change = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-verify-047-history-'));
  t.after(() => fs.rmSync(base, { recursive: true }));
  const write = (id, file, value) => {
    fs.mkdirSync(path.join(base, id), { recursive: true });
    const bytes = json(value);
    fs.writeFileSync(path.join(base, id, file), bytes);
    return { file, bytes: bytes.length, sha256: sha(bytes) };
  };
  const login = [write(LOGIN_ID, 'login-approval.json', { id: LOGIN_ID }),
    write(LOGIN_ID, 'login-status.json', { status: 'session_verified', approval_sha256: PUBLICATION_APPROVAL, reason: null, ...change.login })];
  const pub = [write(PUB_ID, 'send-1.json', { kind: 'otp_web', http_status: 401, entity_sha256: ENTITY_SHA256 }),
    write(PUB_ID, 'send-2.json', { kind: 'accepted', http_status: 202, otp_header: true, entity_sha256: ENTITY_SHA256,
      response_bytes: 16, response_sha256: sha(SUCCESS_BODY), ...change.send2 }),
    write(PUB_ID, 'publication-status.json', { status: 'published', outcome: 'accepted_readback_unconfirmed', put_reply: 'accepted',
      approval_sha256: PUBLICATION_APPROVAL, reason: null, record_gap: false, readback_confirmed: false, counts: { put_attempts: 2 }, ...change.status })];
  const loginReadback = write(LOGIN_ID, 'login-readback.json', { verified: true, rows: login });
  const pubReadback = write(PUB_ID, 'publication-readback.json', { verified: true, rows: pub });
  const history = { [LOGIN_ID]: ['login-readback.json', loginReadback.sha256], [PUB_ID]: ['publication-readback.json', pubReadback.sha256] };
  return { base, history };
}

test('the login and publication records are bound by their readback anchors and pub01 facts', t => {
  const good = historyFixture(t);
  const summary = verifyHistory(good.base, { history: good.history });
  assert.deepEqual(summary.send_2, { http_status: 202, response_bytes: 16, response_sha256: sha(SUCCESS_BODY) });
  assert.equal(summary.recorded_outcome, 'accepted_readback_unconfirmed');
  assert.throws(() => verifyHistory(good.base, { history: { ...good.history, [PUB_ID]: ['publication-readback.json', 'f'.repeat(64)] } }),
    /historical_readback_changed/);
  fs.appendFileSync(path.join(good.base, PUB_ID, 'send-2.json'), ' ');
  assert.throws(() => verifyHistory(good.base, { history: good.history }), /historical_record_changed/);
  for (const change of [{ status: { status: 'stopped' } }, { status: { outcome: 'refused' } }, { status: { record_gap: true } },
    { status: { approval_sha256: 'f'.repeat(64) } }, { send2: { http_status: 500 } }, { send2: { response_sha256: 'f'.repeat(64) } },
    { send2: { entity_sha256: 'f'.repeat(64) } }, { login: { status: 'stopped' } }]) {
    const f = historyFixture(t, change);
    assert.throws(() => verifyHistory(f.base, { history: f.history }), /prior_run_unconfirmed/, JSON.stringify(change));
  }
});

test('four anonymous GETs with one cache buster confirm the publication', async t => {
  const f = fixture(t, live);
  const result = await f.run();
  assert.equal(result.status, 'verified');
  assert.equal(result.reason, null);
  assert.deepEqual(result.verdicts, { version: 'confirmed', tag: 'confirmed', tarball: 'confirmed', packument: 'confirmed' });
  assert.deepEqual(result.counts, { dns_calls: 1, get_attempts: 4, put_attempts: 0, secondary_lookup_attempts: 0 });
  assert.deepEqual(f.events.requests.map(r => r.path), SLOTS.map(s => s.route + '?t=' + UTC0));
  assert.ok(f.events.requests.every(r => r.method === 'GET' && !Object.hasOwn(r.headers, 'authorization') &&
    r.headers['cache-control'] === 'no-cache' && r.opts.hostname === ip));
  assert.deepEqual(result.published, { name: PLAN_TARGET.name, version: '0.1.48', latest: '0.1.48', integrity: digests.integrity,
    shasum: digests.shasum, tarball_sha256: expected.sha256, packument_lists_version: true,
    version_manifest_fields: { main: 'same_ignoring_key_order', bin: 'same_ignoring_key_order', scripts: 'same_ignoring_key_order',
      dependencies: 'same_ignoring_key_order', engines: 'same_ignoring_key_order', files: 'absent' } });
  assert.deepEqual(result.pub01_outcome, { recorded: 'accepted_readback_unconfirmed', confirmed_by_readback: 'accepted_readback_confirmed' });
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['approval.json', 'packument.json', 'tag.json', 'tarball.json', 'verification-readback.json',
    'verification-status.json', 'version.json']);
  for (const file of fs.readdirSync(f.root)) {
    assert.ok(fs.statSync(path.join(f.root, file)).size <= RECORDS[file], file);
    assert.ok(!fs.readFileSync(path.join(f.root, file), 'utf8').includes(ACCOUNT), file);
  }
  assert.equal(f.read('verification-readback.json').rows.length, 6);
});

test('a version still absent stops as unconfirmed after all four GETs', async t => {
  const f = fixture(t, [[404, 'version not found: 0.1.48'], [200, { latest: '0.1.47' }], [404, ''], live[3]]);
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'publication_unconfirmed');
  assert.deepEqual(result.verdicts, { version: 'absent', tag: 'mismatch', tarball: 'absent', packument: 'confirmed' });
  assert.equal(f.events.requests.length, 4);
  assert.equal(f.read('tag.json').reason, 'readback_tag');
  assert.equal(result.published, undefined);
});

test('a transport failure on one GET is recorded and the remaining GETs still run once', async t => {
  const f = fixture(t, [live[0], 'reset', live[2], live[3]]);
  const result = await f.run();
  assert.equal(result.reason, 'publication_unconfirmed');
  assert.deepEqual(result.verdicts, { version: 'confirmed', tag: 'unavailable', tarball: 'confirmed', packument: 'confirmed' });
  assert.equal(f.read('tag.json').reason, 'transport_error');
  assert.equal(f.events.requests.length, 4);
});

test('a tarball that differs from the artifact is a mismatch', async t => {
  const f = fixture(t, [live[0], live[1], [200, Buffer.from('other bytes')], live[3]]);
  const result = await f.run();
  assert.equal(result.verdicts.tarball, 'mismatch');
  assert.equal(f.read('tarball.json').reason, 'artifact_identity');
});

test('changed inputs, DNS failure and a second lookup stop the run', async t => {
  const f = fixture(t, live);
  f.events.hooks.request = index => { if (index === 1) f.events.recheck = 'c'.repeat(64); };
  const changed = await f.run();
  assert.equal(changed.reason, 'execution_inputs_changed');
  assert.equal(f.events.requests.length, 2);

  const g = fixture(t, live);
  g.events.lookupError = Object.assign(Error('nx'), { code: 'ENOTFOUND' });
  const dns = await g.run();
  assert.equal(dns.reason, 'dns_error');
  assert.equal(g.events.requests.length, 0);

  const h = fixture(t, live);
  h.events.hooks.request = (index, opts) => { if (index === 0) opts.lookup('registry.npmjs.org', {}, () => {}); };
  const second = await h.run();
  assert.equal(second.reason, 'verify_transport_scope');
  assert.equal(h.events.requests.length, 1);
});

test('the run is one-shot and needs the exact plan hash', async t => {
  const f = fixture(t, live);
  await f.run();
  await assert.rejects(f.run(), /verify_scope_exists/);
  assert.equal(f.events.requests.length, 4);
  await assert.rejects(f.run({ approvedHash: 'd'.repeat(64) }), /approval_mismatch/);
  assert.throws(() => approvalRecord({ ...f.plan, id: 'other' }, planHash({ ...f.plan, id: 'other' })), /approval_mismatch/);
});

test('stop reasons keep only fixed codes', () => {
  for (const code of ['transport_error', 'readback_manifest', 'dns_error', 'publication_unconfirmed', 'execution_inputs_changed']) {
    assert.equal(safeReason(code), code);
  }
  for (const code of ['npm_SyntheticToken', 'Error: https://www.npmjs.com/login', undefined, 'verify_other']) {
    assert.equal(safeReason(code), 'execution_stopped');
  }
});
