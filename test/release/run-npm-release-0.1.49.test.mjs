import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REVERIFY_CAMPAIGN, campaignHash } from '../../scripts/package-approval.mjs';
import { planHash } from '../../scripts/run-npm-session-release.mjs';
import { ACCOUNT, SESSION_BYTES } from '../../scripts/npm-session-release.mjs';
import { ALLOCATION, CONFIRM_ATTEMPTS, CONFIRM_PHRASE, EVIDENCE, LOGIN_ID, LOGIN_RECORDS, PLAN_TARGET, PUB_ID, PUB_RECORDS,
  READBACK_DELAY_MS, ROUTES, SESSION_MS, SESSION_ROOT, TARGET, TESTS, approvalRecord, checkAllocation, checkRuntime, executeRelease, planFor,
  readbackJudges, releaseFiles, safeReason } from '../../scripts/run-npm-release-0.1.49.mjs';
import { verifyArtifactBytes } from '../../scripts/npm-release-kit.mjs';

const ip = '192.0.2.47';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const urls = { loginUrl: 'https://www.npmjs.com/login/cli/mock-release047', doneUrl: 'https://registry.npmjs.org/-/v1/done/mock-release047' };
const token = 'npm_SyntheticRelease047Token';
const otpUrls = { authUrl: 'https://www.npmjs.com/auth/cli/mock-otp-release047', doneUrl: 'https://registry.npmjs.org/-/v1/done?authId=mockotprelease047' };
const webOtp = 'web-otp-SyntheticRelease047';
const login = [[200, urls], [200, { token }]];
const queries = [[200, { username: ACCOUNT }], [200, { [ACCOUNT]: 'write' }], [404, 'version not found: 0.1.49'], [200, { latest: '0.1.48' }]];

const artifact = Buffer.from('synthetic 0.1.49 tarball bytes for the release runner tests');
const expected = { bytes: artifact.length, sha256: sha(artifact) };
const digests = verifyArtifactBytes(artifact, expected);
const manifest = { name: TARGET.name, version: TARGET.version, main: 'build/index.js', bin: { [TARGET.name]: 'build/index.js' },
  files: ['build/**/*.js'], scripts: { build: 'tsc' }, dependencies: { zod: '^4.0.0' }, engines: { node: '>=20' } };
const tarballUrl = 'https://registry.npmjs.org/bushido-tradingview-mcp/-/bushido-tradingview-mcp-0.1.49.tgz';
const dist = { integrity: digests.integrity, shasum: digests.shasum, tarball: tarballUrl };
const { files: _files, ...withoutFiles } = manifest;
const versionDoc = { ...withoutFiles, dependencies: { zod: '^4.0.0' }, dist };
const readback = [[200, versionDoc], [200, { latest: '0.1.49' }], [200, artifact],
  [200, { name: TARGET.name, 'dist-tags': { latest: '0.1.49' }, versions: { '0.1.49': { name: TARGET.name, version: '0.1.49', dist } } }]];
const otpChallenge = [401, otpUrls, { 'www-authenticate': 'OTP' }];
const classicChallenge = [401, { error: 'You must provide a one-time pass.' }, { 'www-authenticate': 'otp' }];
const body = Buffer.from(JSON.stringify({ _id: TARGET.name, synthetic: true }));
const entitySummary = { body_bytes: body.length, body_sha256: sha(body), integrity: digests.integrity, shasum: digests.shasum,
  loaded_modules: { count: 300, sha256: 'b'.repeat(64), all_bound_to_B_inventory: true } };
const UTC0 = 1795200000000;

function fixture(t, responses) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-release-047-test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true }));
  const base = path.join(workspace, 'release-work');
  const loginRoot = path.join(base, LOGIN_ID), pubRoot = path.join(base, PUB_ID), session = path.join(workspace, 'auth');
  fs.mkdirSync(loginRoot, { recursive: true });
  // A plan shaped like the real one, so record sizes and account absence are meaningful.
  const plan = planFor({ id: LOGIN_ID, publication_id: PUB_ID, login_root: loginRoot, publication_root: pubRoot,
    session_file: path.join(session, 'user.npmrc'), target: PLAN_TARGET, evidence: EVIDENCE,
    artifact: { file: EVIDENCE.artifact.file, ...digests }, record_limits: { login: LOGIN_RECORDS, publication: PUB_RECORDS } },
  entitySummary, { reservation_sha256: 'a'.repeat(64), inputs_sha256: 'b'.repeat(64), tests_sha256: 'c'.repeat(64),
    preparation_readback_sha256: 'd'.repeat(64) });
  const approvedHash = planHash(plan);
  const events = { lookups: [], requests: [], browser: [], prompts: [], time: 0, utc: UTC0, utcs: [], hooks: {}, recheck: approvedHash };
  const adapter = {
    lookup(host, opts, done) {
      events.lookups.push([host, opts]);
      queueMicrotask(() => done(null, ip, 4));
    },
    request(opts, receive) {
      const index = events.requests.push({ method: opts.method, path: opts.path, auth: Object.hasOwn(opts.headers, 'authorization'),
        otp: opts.headers['npm-otp'], accept: opts.headers.accept, time: events.time }) - 1;
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
    prompt: { confirm(attempt) { events.prompts.push('confirm'); return events.hooks.confirm?.(attempt) ?? 'publish 0.1.49\n'; },
      otp(entry) { events.prompts.push('otp'); return events.hooks.otp?.(entry) ?? ' 123456\n'; } },
    entity: async () => ({ body, summary: entitySummary }),
    judges: readbackJudges({ artifact, manifest, digests }, expected) };
  return { loginRoot, pubRoot, session, events, read, plan, approvedHash, run: more => executeRelease({ ...options, ...more }) };
}

const allText = root => fs.existsSync(root) ? fs.readdirSync(root).map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') : '';
const calls = f => f.events.requests.map(r => [r.method, r.path]);
const pre = [['POST', '/-/v1/login'], ['GET', '/-/v1/done/mock-release047'], ...Object.values(ROUTES.preflight).map(route => ['GET', route])];
const back = Object.values(ROUTES.readback).map(route => ['GET', route]);
const put = ['PUT', ROUTES.publish];
function secretsAbsent(f, more = []) {
  for (const root of [f.loginRoot, f.pubRoot]) {
    const text = allText(root);
    for (const secret of [token, webOtp, '123456', otpUrls.authUrl, 'mockotprelease047', urls.loginUrl, ACCOUNT, ...more]) {
      assert.ok(!text.includes(secret), secret);
    }
  }
}

// The live campaign moves on after this release; these checks then skip instead of failing.
const current = REVERIFY_CAMPAIGN.releaseVersion === TARGET.version;
const live = { skip: !current && 'the live campaign moved past ' + TARGET.version };

test('the 0.1.49 run is fixed to its target, IDs, evidence and release-stage allocation', live, () => {
  assert.deepEqual(TARGET, { name: 'bushido-tradingview-mcp', version: '0.1.49', tag: 'latest', account: ACCOUNT });
  assert.equal(CONFIRM_PHRASE, 'publish 0.1.49');
  assert.equal(LOGIN_ID, 'package-2026-11-27-publish-0.1.49-login01');
  assert.equal(PUB_ID, 'package-2026-11-27-publish-0.1.49-pub01');
  assert.equal(SESSION_ROOT, '/private/tmp/TradingView-MCP-npm-0.1.49-login01');
  assert.equal(ROUTES.preflight.version, '/bushido-tradingview-mcp/0.1.49');
  assert.equal(ROUTES.readback.tarball, '/bushido-tradingview-mcp/-/bushido-tradingview-mcp-0.1.49.tgz');
  assert.equal(EVIDENCE.campaign_sha256, campaignHash());
  assert.equal(EVIDENCE.preparation, REVERIFY_CAMPAIGN.preparation);
  assert.equal(EVIDENCE.run, REVERIFY_CAMPAIGN.run);
  assert.equal(EVIDENCE.artifact.file, REVERIFY_CAMPAIGN.run + '/artifact/verified-0.1.49.tgz');
  assert.equal(EVIDENCE.candidate.commit.length, 40);
  checkAllocation();
  assert.equal(ALLOCATION.release_stages_reserved, REVERIFY_CAMPAIGN.releaseStagesReserved);
  assert.equal(ALLOCATION.reservation, Object.values(LOGIN_RECORDS).reduce((a, b) => a + b, 0) +
    Object.values(PUB_RECORDS).reduce((a, b) => a + b, 0) + SESSION_BYTES);
  assert.equal(ALLOCATION.release_stage_cumulative + ALLOCATION.release_stage_remaining, 2 * 1024 * 1024);
  for (const file of TESTS) assert.ok(fs.statSync(new URL('../../' + file, import.meta.url)).isFile(), file);
  assert.ok(Object.isFrozen(EVIDENCE) && Object.isFrozen(EVIDENCE.records) && Object.isFrozen(ALLOCATION));
});

test('plans name the package only, and the runtime refuses Node flags and OpenSSL overrides', () => {
  assert.deepEqual(PLAN_TARGET, { name: TARGET.name, version: TARGET.version, tag: TARGET.tag });
  for (const value of [PLAN_TARGET, EVIDENCE, ALLOCATION, ROUTES]) assert.ok(!JSON.stringify(value).includes(ACCOUNT));
  checkRuntime([], { PATH: '/usr/bin' });
  for (const [argv, env] of [[['--tls-keylog=/tmp/keys'], {}], [['--use-system-ca'], {}], [['--import', 'x.mjs'], {}],
    [[], { OPENSSL_CONF: '/tmp/openssl.cnf' }], [[], { openssl_modules: '/tmp/m' }]]) {
    assert.throws(() => checkRuntime(argv, env), /transport_environment_override/);
  }
  checkRuntime([], { OPENSSL_CONF: '' });
});

test('approval records require the exact plan hash', () => {
  const plan = { id: LOGIN_ID, entity: entitySummary };
  const record = approvalRecord(plan, planHash(plan));
  assert.deepEqual([record.id, record.publication_id, record.consumed, record.publication_approved], [LOGIN_ID, PUB_ID, true, true]);
  assert.throws(() => approvalRecord(plan, 'a'.repeat(64)), /approval_mismatch/);
  assert.throws(() => approvalRecord({ ...plan, id: 'other' }, planHash({ ...plan, id: 'other' })), /approval_mismatch/);
});

test('stop reasons keep only fixed codes', () => {
  for (const code of ['login_poll_limit', 'dns_unconfirmed', 'latest_at_or_above_candidate', 'request_timeout', 'publish_http_status_403',
    'publish_otp_poll_limit', 'readback_manifest', 'artifact_identity', 'release_transport_scope', 'stage_deadline']) {
    assert.equal(safeReason(code), code);
  }
  for (const code of [token, 'publish_http_status_999', 'readback_' + webOtp, 'Error: ' + urls.loginUrl, undefined, 'release_other']) {
    assert.equal(safeReason(code), 'execution_stopped');
  }
});

test('one approval runs the login, four preflight GETs, one accepted PUT and a confirmed four-GET readback', async t => {
  const f = fixture(t, [...login, ...queries, [201, { ok: true }], ...readback]);
  const result = await f.run();
  assert.equal(result.status, 'session_verified');
  assert.equal(result.publication.status, 'published');
  assert.equal(result.publication.outcome, 'accepted_readback_confirmed');
  assert.equal(result.publication.reason, null);
  assert.deepEqual(calls(f), [...pre, put, ...back]);
  assert.deepEqual(result.publication.counts, { dns_calls: 1, get_attempts: 8, put_attempts: 1, otp_poll_attempts: 0,
    readback_attempts: 4, secondary_lookup_attempts: 0 });
  assert.equal(f.events.lookups.length, 2);
  assert.deepEqual(f.events.prompts, ['confirm']);
  assert.ok(f.events.requests[6].body.equals(body));
  assert.equal(f.events.requests[6].otp, undefined);
  assert.equal(f.events.requests[6].time - f.events.requests[5].time, 0);
  assert.equal(f.events.requests[7].time - f.events.requests[6].time, READBACK_DELAY_MS);
  assert.equal(f.events.requests.at(-1).accept, 'application/vnd.npm.install-v1+json');
  assert.equal(f.events.requests.at(-2).accept, 'application/octet-stream');
  assert.ok(f.events.requests.slice(2).every(r => r.auth) && !f.events.requests[0].auth && !f.events.requests[1].auth);
  assert.deepEqual(fs.readdirSync(f.pubRoot).sort(), ['account.json', 'approval-publication.json', 'confirmation.json',
    'login-binding.json', 'preflight-status.json', 'publication-readback.json', 'publication-status.json', 'readback-packument.json',
    'readback-tag.json', 'readback-tarball.json', 'readback-version.json', 'rights.json', 'send-1.json', 'tag.json', 'version.json']);
  assert.deepEqual(fs.readdirSync(f.loginRoot).sort(), ['login-approval.json', 'login-readback.json', 'login-status.json']);
  const send = f.read(f.pubRoot, 'send-1.json');
  assert.deepEqual([send.http_status, send.kind, send.otp_header, send.entity_sha256], [201, 'accepted', false, entitySummary.body_sha256]);
  assert.deepEqual(f.read(f.pubRoot, 'account.json').account_matches, true);
  assert.equal(f.read(f.pubRoot, 'tag.json').latest, '0.1.48');
  assert.equal(f.read(f.pubRoot, 'version.json').exists, false);
  for (const slot of ['version', 'tag', 'tarball', 'packument']) assert.equal(f.read(f.pubRoot, 'readback-' + slot + '.json').verdict, 'confirmed');
  const status = f.read(f.pubRoot, 'publication-status.json');
  assert.deepEqual([status.status, status.outcome, status.readback_confirmed, status.no_retry, status.approval_consumed],
    ['published', 'accepted_readback_confirmed', true, true, true]);
  assert.equal(f.read(f.pubRoot, 'publication-readback.json').rows.length, 14);
  assert.equal(f.read(f.pubRoot, 'confirmation.json').expected_phrase, 'publish 0.1.49');
  for (const [root, caps] of [[f.loginRoot, LOGIN_RECORDS], [f.pubRoot, PUB_RECORDS]]) {
    for (const file of fs.readdirSync(root)) assert.ok(fs.statSync(path.join(root, file)).size <= caps[file], file);
  }
  secretsAbsent(f);
});

test('HTTP 202 to the PUT is accepted, as npm accepts every 2xx', async t => {
  const f = fixture(t, [...login, ...queries, [202, { success: true }], ...readback]);
  const result = await f.run();
  assert.equal(result.publication.outcome, 'accepted_readback_confirmed');
  assert.deepEqual([f.read(f.pubRoot, 'send-1.json').http_status, f.read(f.pubRoot, 'send-1.json').kind], [202, 'accepted']);
});

test('a web OTP challenge polls once, sends the second PUT with the OTP and records no secret', async t => {
  const f = fixture(t, [...login, ...queries, otpChallenge, [202, ''], [200, { token: webOtp }], [201, {}], ...readback]);
  const result = await f.run();
  assert.equal(result.publication.outcome, 'accepted_readback_confirmed');
  assert.equal(result.publication.otp, 'web');
  assert.deepEqual(calls(f), [...pre, put, ['GET', '/-/v1/done?authId=mockotprelease047'], ['GET', '/-/v1/done?authId=mockotprelease047'], put, ...back]);
  assert.deepEqual(f.events.browser, [urls.loginUrl, otpUrls.authUrl]);
  assert.equal(f.events.requests[9].otp, webOtp);
  assert.deepEqual(f.read(f.pubRoot, 'otp.json'), { id: PUB_ID, kind: 'web', polls: 2, entries: 0, result: 'received' });
  secretsAbsent(f);
});

test('a classic OTP challenge accepts a re-entered code and sends it once', async t => {
  const f = fixture(t, [...login, ...queries, classicChallenge, [201, {}], ...readback]);
  f.events.hooks.otp = entry => entry === 1 ? '12ab' : '654321';
  const result = await f.run();
  assert.equal(result.publication.outcome, 'accepted_readback_confirmed');
  assert.deepEqual(f.events.prompts, ['confirm', 'otp', 'otp']);
  assert.equal(f.events.requests[7].otp, '654321');
  assert.deepEqual(f.read(f.pubRoot, 'otp.json'), { id: PUB_ID, kind: 'classic', polls: 0, entries: 2, result: 'received' });
  secretsAbsent(f, ['654321', '12ab']);
});

test('a second one-time-password challenge is a refusal: no third PUT and no readback', async t => {
  const f = fixture(t, [...login, ...queries, classicChallenge, classicChallenge]);
  const result = await f.run();
  assert.equal(result.publication.status, 'stopped');
  assert.equal(result.publication.outcome, 'refused');
  assert.equal(result.publication.reason, 'publish_http_status_401');
  assert.deepEqual(calls(f), [...pre, put, put]);
  secretsAbsent(f);
});

test('a readback tarball that differs from the artifact is not confirmed', async t => {
  const f = fixture(t, [...login, ...queries, [201, {}], readback[0], readback[1], [200, Buffer.from('other tarball bytes')], readback[3]]);
  const result = await f.run();
  assert.equal(result.publication.outcome, 'accepted_readback_unconfirmed');
  const record = f.read(f.pubRoot, 'readback-tarball.json');
  assert.deepEqual([record.verdict, record.reason], ['mismatch', 'artifact_identity']);
});

test('a refused PUT stops without readback', async t => {
  const f = fixture(t, [...login, ...queries, [403, { error: 'forbidden' }]]);
  const result = await f.run();
  assert.equal(result.publication.status, 'stopped');
  assert.equal(result.publication.outcome, 'refused');
  assert.equal(result.publication.reason, 'publish_http_status_403');
  assert.deepEqual(calls(f), [...pre, put]);
});

test('an unanswered PUT is decided only by readback, never resent', async t => {
  const f = fixture(t, [...login, ...queries, 'reset', ...readback]);
  const result = await f.run();
  assert.equal(result.publication.outcome, 'unanswered_readback_confirmed');
  assert.equal(result.publication.status, 'published');
  assert.deepEqual(calls(f), [...pre, put, ...back]);
  assert.equal(f.read(f.pubRoot, 'send-1.json').kind, 'unknown');

  const g = fixture(t, [...login, ...queries, [503, {}], [404, 'version not found: 0.1.49'], [200, { latest: '0.1.48' }], [404, ''], [200, {}]]);
  const second = await g.run();
  assert.equal(second.publication.outcome, 'unknown');
  assert.equal(second.publication.status, 'stopped');
  assert.equal(second.publication.reason, 'publish_http_status_503');
  assert.deepEqual(calls(g), [...pre, put, ...back]);
  assert.deepEqual(['version', 'tag', 'tarball', 'packument'].map(s => g.read(g.pubRoot, 'readback-' + s + '.json').verdict),
    ['absent', 'mismatch', 'absent', 'mismatch']);
});

test('an accepted PUT with a lagging readback is published but unconfirmed', async t => {
  const f = fixture(t, [...login, ...queries, [201, {}], [200, versionDoc], [200, { latest: '0.1.48' }], [200, artifact], [200, { name: TARGET.name, 'dist-tags': { latest: '0.1.48' }, versions: {} }]]);
  const result = await f.run();
  assert.equal(result.publication.status, 'published');
  assert.equal(result.publication.outcome, 'accepted_readback_unconfirmed');
  assert.equal(f.read(f.pubRoot, 'readback-tag.json').reason, 'readback_tag');
  assert.equal(f.read(f.pubRoot, 'readback-packument.json').reason, 'readback_packument');
});

test('a version document that differs records per-field verdicts', async t => {
  const changed = { ...versionDoc, scripts: { postinstall: 'node x' } };
  const f = fixture(t, [...login, ...queries, [201, {}], [200, changed], ...readback.slice(1)]);
  const result = await f.run();
  assert.equal(result.publication.outcome, 'accepted_readback_unconfirmed');
  const record = f.read(f.pubRoot, 'readback-version.json');
  assert.equal(record.reason, 'readback_manifest');
  assert.equal(record.manifest_fields.scripts, 'different');
  assert.equal(record.manifest_fields.files, 'absent');
});

test('a mistyped confirmation stops before any PUT', async t => {
  const f = fixture(t, [...login, ...queries]);
  f.events.hooks.confirm = () => 'publish 0.1.48';
  const result = await f.run();
  assert.equal(result.publication.outcome, 'not_sent');
  assert.equal(result.publication.reason, 'publish_not_confirmed');
  assert.deepEqual(f.events.prompts, Array(CONFIRM_ATTEMPTS).fill('confirm'));
  assert.deepEqual(calls(f), pre);
  assert.equal(f.read(f.pubRoot, 'confirmation.json').confirmed, false);
});

test('a confirmation typed after its window stops before any PUT', async t => {
  const f = fixture(t, [...login, ...queries]);
  f.events.hooks.confirm = () => { f.events.time += 120001; return 'publish 0.1.49'; };
  const result = await f.run();
  assert.equal(result.publication.outcome, 'not_sent');
  assert.equal(result.publication.reason, 'stage_deadline');
  assert.deepEqual(calls(f), pre);
  assert.deepEqual(f.read(f.pubRoot, 'confirmation.json').within_window, false);
});

test('preflight failures stop before the confirmation prompt', async t => {
  for (const [index, response, reason] of [[2, [200, { username: 'someone-else' }], 'session_account_mismatch'],
    [3, [200, { [ACCOUNT]: 'read' }], 'rights_unconfirmed'], [4, [200, { name: TARGET.name, version: '0.1.49' }], 'version_availability_unconfirmed'],
    [5, [200, { latest: '0.1.49' }], 'latest_at_or_above_candidate']]) {
    const responses = [...login, ...queries];
    responses[index] = response;
    const f = fixture(t, responses);
    const result = await f.run();
    assert.equal(result.publication.outcome, 'not_sent');
    assert.equal(result.publication.reason, reason);
    assert.deepEqual(f.events.prompts, []);
    assert.equal(calls(f).length, index + 1);
    secretsAbsent(f, ['someone-else']);
  }
});

test('changed inputs stop the run before the next dispatch', async t => {
  const f = fixture(t, [...login, ...queries, [201, {}], ...readback]);
  f.events.hooks.request = index => { if (index === 3) f.events.recheck = 'c'.repeat(64); };
  const result = await f.run();
  assert.equal(result.publication.outcome, 'not_sent');
  assert.equal(result.publication.reason, 'execution_inputs_changed');
  assert.equal(calls(f).length, 4);
});

test('a login failure stops before any registry query and leaves no publication records', async t => {
  const f = fixture(t, [[200, urls], [403, { error: 'denied' }]]);
  const result = await f.run();
  assert.equal(result.status, 'stopped');
  assert.equal(result.publication, null);
  assert.equal(fs.existsSync(f.pubRoot), false);
  assert.deepEqual(result.http_failure, { phase: 'poll_get', http_status: 403 });
  secretsAbsent(f);
});

test('an existing session directory or publication root refuses the run before dispatch', async t => {
  const f = fixture(t, [...login]);
  fs.mkdirSync(f.session);
  await assert.rejects(f.run(), /release_scope_exists/);
  assert.equal(f.events.requests.length, 0);
  const g = fixture(t, [...login]);
  fs.mkdirSync(g.pubRoot, { recursive: true });
  await assert.rejects(g.run(), /release_scope_exists/);
  assert.equal(g.events.requests.length, 0);
  await assert.rejects(f.run({ approvedHash: 'd'.repeat(64) }), /approval_mismatch/);
});

test('the account and rights bodies are not even recorded as digests', async t => {
  const f = fixture(t, [...login, ...queries, [201, {}], ...readback]);
  await f.run();
  assert.deepEqual([f.read(f.pubRoot, 'account.json').body_sha256, f.read(f.pubRoot, 'rights.json').body_sha256], [null, null]);
  assert.match(f.read(f.pubRoot, 'version.json').body_sha256, /^[0-9a-f]{64}$/);
  assert.ok(f.read(f.loginRoot, 'login-approval.json').plan.evidence.records.result[2] === EVIDENCE.records.result[2]);
});

test('a 401 OTP challenge with rejected URLs is a refusal without readback', async t => {
  const bad = [401, { authUrl: 'https://www.npmjs.example/auth/cli/x', doneUrl: otpUrls.doneUrl }, { 'www-authenticate': 'OTP' }];
  const f = fixture(t, [...login, ...queries, bad]);
  const result = await f.run();
  assert.equal(result.publication.outcome, 'refused');
  assert.equal(result.publication.reason, 'publish_otp_url_rejected');
  assert.deepEqual(calls(f), [...pre, put]);
  assert.deepEqual(f.events.browser, [urls.loginUrl]);
});

test('a failed record write after an accepted PUT keeps the outcome and still reads back', async t => {
  const f = fixture(t, [...login, ...queries, [202, { success: true }], ...readback]);
  f.events.hooks.request = (index, opts) => { if (opts.method === 'PUT') fs.writeFileSync(path.join(f.pubRoot, 'send-1.json'), 'occupied'); };
  const result = await f.run();
  assert.equal(result.publication.outcome, 'accepted_readback_confirmed');
  assert.equal(result.publication.record_gap, true);
  assert.deepEqual(calls(f), [...pre, put, ...back]);
  assert.equal(f.read(f.pubRoot, 'publication-status.json').record_gap, true);
});

test('an entity that differs from the plan at publish time stops before the PUT', async t => {
  const f = fixture(t, [...login, ...queries]);
  const result = await f.run({ entity: async () => ({ body: Buffer.from('other entity'), summary: entitySummary }) });
  assert.equal(result.publication.outcome, 'not_sent');
  assert.equal(result.publication.reason, 'release_entity_changed');
  assert.deepEqual(calls(f), pre);
});

test('the session deadline and session identity are rechecked before registry dispatches', async t => {
  const f = fixture(t, [...login, ...queries]);
  f.events.utcs = [UTC0, UTC0 + 1000];
  f.events.utc = UTC0 + SESSION_MS;
  const late = await f.run();
  assert.equal(late.stage, 'admission');
  assert.equal(late.publication.reason, 'session_deadline');
  assert.equal(fs.existsSync(f.pubRoot), false);
  assert.equal(calls(f).length, 2);

  const g = fixture(t, [...login, ...queries]);
  g.events.hooks.request = index => {
    if (index === 2) fs.utimesSync(path.join(g.session, 'user.npmrc'), new Date(UTC0), new Date(UTC0 + 7000));
  };
  const changed = await g.run();
  assert.equal(changed.publication.outcome, 'not_sent');
  assert.equal(changed.publication.reason, 'release_session_changed');
  assert.equal(calls(g).length, 3);
});

test('a publication root created during login stops admission without records', async t => {
  const f = fixture(t, [...login, ...queries]);
  f.events.hooks.browser = () => fs.mkdirSync(f.pubRoot);
  const result = await f.run();
  assert.equal(result.stage, 'admission');
  assert.deepEqual([result.publication.outcome, result.publication.reason, result.publication.records],
    ['not_sent', 'release_scope_exists', 'not_created']);
  assert.deepEqual(fs.readdirSync(f.pubRoot), []);
});

test('web OTP polling stops at its poll limit or at the publish window', async t => {
  const waits = Array(100).fill([202, '']);
  const f = fixture(t, [...login, ...queries, otpChallenge, ...waits]);
  const limited = await f.run();
  assert.equal(limited.publication.outcome, 'refused');
  assert.equal(limited.publication.reason, 'publish_otp_poll_limit');
  assert.equal(limited.publication.counts.otp_poll_attempts, 100);
  assert.equal(f.read(f.pubRoot, 'otp.json').result, 'stopped');

  const slow = Array(10).fill([202, '', { 'retry-after': '60' }]);
  const g = fixture(t, [...login, ...queries, otpChallenge, ...slow]);
  const windowed = await g.run();
  assert.equal(windowed.publication.reason, 'stage_deadline');
  assert.equal(windowed.publication.counts.put_attempts, 1);
  assert.ok(windowed.publication.counts.otp_poll_attempts < 10);
});

function evidenceFixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-release-047-evidence-'));
  t.after(() => fs.rmSync(repo, { recursive: true }));
  const prep = REVERIFY_CAMPAIGN.preparation, run = REVERIFY_CAMPAIGN.run;
  for (const dir of [prep, run + '/report', run + '/artifact']) fs.mkdirSync(path.join(repo, '.release-work', dir), { recursive: true });
  const write = (rel, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value) + '\n');
    fs.writeFileSync(path.join(repo, '.release-work', rel), bytes);
    return Object.freeze([rel, bytes.length, sha(bytes)]);
  };
  const inputs = write(prep + '/input-manifest.json', { schema: 'package-input-manifest-v1', preparation: prep, run,
    groups: [{ name: 'repo', root: repo, files: [] }, { name: 'npm', root: '/npm', files: [] }] });
  const approvalB = write(prep + '/approval-b.json', { schema: 'package-approval-v1', phase: 'B' });
  const status = write(prep + '/status.json', { schema: 'package-preparation-status-v2', status: 'ready_for_review', version: '0.1.49',
    preparation: prep, run, input_manifest_sha256: inputs[2], campaign_sha256: campaignHash() });
  const resultValue = { schema: 'npm-package-verification-v1', status: 'passed', phase: 'complete', version: '0.1.49', run,
    approval_b: { approval_b_sha256: approvalB[2], input_manifest_sha256: inputs[2], preparation_status_sha256: status[2] },
    artifact: { path: 'artifact/verified-0.1.49.tgz', bytes: artifact.length, sha256: expected.sha256 },
    checks: { same_artifact: true, unmanaged_write_attempts: 0, approved_inputs_end_verified: true } };
  const result = write(run + '/report/result.json', resultValue);
  write(run + '/artifact/verified-0.1.49.tgz', artifact);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify(manifest));
  const evidence = { campaign_sha256: campaignHash(), preparation: prep, run, records: { status, inputs, approval_b: approvalB, result },
    artifact: { file: run + '/artifact/verified-0.1.49.tgz', ...expected }, candidate: { ref: 'refs/heads/codex/ci-0.1.49', commit: 'e'.repeat(40) } };
  const options = { evidence, capture: () => ({ sha256: inputs[2] }),
    candidate: (_repo, ref) => ref === evidence.candidate.ref ? evidence.candidate.commit : 'f'.repeat(40) };
  const withResult = change => ({ ...options, evidence: { ...evidence,
    records: { ...evidence.records, result: write(run + '/report/result.json', change(structuredClone(resultValue))) } } });
  return { repo, evidence, options, withResult };
}

test('releaseFiles binds the B records, the artifact, the captured inputs, the manifest and the candidate', live, t => {
  const f = evidenceFixture(t);
  const files = releaseFiles(f.repo, f.options);
  assert.ok(files.artifact.equals(artifact));
  assert.deepEqual([files.digests.sha256, files.manifest.version, files.npmGroup.name], [expected.sha256, '0.1.49', 'npm']);
  const o = f.options, e = f.evidence;
  assert.throws(() => releaseFiles(f.repo, { ...o, capture: () => ({ sha256: 'f'.repeat(64) }) }), /release_inputs_changed/);
  assert.throws(() => releaseFiles(f.repo, { ...o, capture: () => { throw Error('input_root_shape'); } }), /release_inputs_changed/);
  assert.throws(() => releaseFiles(f.repo, { ...o, candidate: () => 'f'.repeat(40) }), /release_candidate_changed/);
  assert.throws(() => releaseFiles(f.repo, { ...o, candidate: () => { throw Error('git'); } }), /release_candidate_changed/);
  assert.throws(() => releaseFiles(f.repo, { ...o, evidence: { ...e, campaign_sha256: 'f'.repeat(64) } }), /release_campaign_changed/);
  const artifactFile = path.join(f.repo, '.release-work', e.artifact.file);
  fs.writeFileSync(artifactFile, Buffer.from('other artifact bytes'));
  assert.throws(() => releaseFiles(f.repo, o), /artifact_identity/);
  fs.writeFileSync(artifactFile, artifact);
  assert.throws(() => releaseFiles(f.repo, { ...o, evidence: { ...e, records: { ...e.records, approval_b: [e.records.approval_b[0], 1, 'f'.repeat(64)] } } }),
    /release_evidence_changed/);
  for (const change of [r => { r.status = 'failed'; return r; }, r => { r.version = '0.1.48'; return r; },
    r => { r.approval_b.approval_b_sha256 = 'f'.repeat(64); return r; }, r => { r.approval_b.input_manifest_sha256 = 'f'.repeat(64); return r; },
    r => { r.artifact.sha256 = 'f'.repeat(64); return r; }, r => { r.checks.same_artifact = false; return r; },
    r => { r.checks.unmanaged_write_attempts = 1; return r; }, r => { r.checks.approved_inputs_end_verified = false; return r; }]) {
    assert.throws(() => releaseFiles(f.repo, f.withResult(change)), /release_evidence_changed/);
  }
  const good = f.withResult(r => r);
  fs.writeFileSync(path.join(f.repo, 'package.json'), JSON.stringify({ ...manifest, version: '0.1.48' }));
  assert.throws(() => releaseFiles(f.repo, good), /manifest_target/);
  fs.writeFileSync(path.join(f.repo, 'package.json'), JSON.stringify({ ...manifest, private: true }));
  assert.throws(() => releaseFiles(f.repo, good), /manifest_target/);
  fs.writeFileSync(path.join(f.repo, 'package.json'), JSON.stringify(manifest));
  assert.equal(releaseFiles(f.repo, good).manifest.version, '0.1.49');
});
