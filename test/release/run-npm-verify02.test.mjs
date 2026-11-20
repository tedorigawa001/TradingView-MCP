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
import { LIMITS } from '../../scripts/prepare-npm-preflight.mjs';
import { ROUTES } from '../../scripts/publish-verified-tarball.mjs';
import { ALLOCATION, HISTORY, MANIFEST_KEYS, RECORDS, SLOTS, SUCCESS_BODY, VERIFY02_ID, approvalRecord, canonical, checkAllocationArithmetic,
  checkAllocationChain, executeVerify02Run, getOptions, judges, planFor, safeReason } from '../../scripts/run-npm-verify02.mjs';

const ip = '192.0.2.73';
const UTC0 = 1795171000000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tarball = Buffer.from('synthetic tarball for verify02');
const good = [[200, { name: 'bushido-tradingview-mcp', version: '0.1.46' }], [200, { latest: '0.1.46' }], [200, tarball],
  [200, { name: 'bushido-tradingview-mcp', 'dist-tags': { latest: '0.1.46' }, versions: { '0.1.46': { version: '0.1.46' } } }]];
const plan = { id: VERIFY02_ID, fixture: true,
  pub02: { send_2: { http_status: 202, response_bytes: 16, response_sha256: sha(SUCCESS_BODY), recorded_kind: 'refused' }, recorded_outcome: 'refused' } };
const fakeVerify = {
  version(bytes) {
    const m = JSON.parse(bytes);
    if (m.detail) throw Object.assign(Error('readback_manifest'), { detail: m.detail });
    if (m.version !== '0.1.46') throw Error('readback_version');
    return { version: '0.1.46', integrity: 'sha512-x', shasum: 'y', manifest_keys: { main: 'same_ignoring_key_order', files: 'absent' } };
  },
  tag(bytes) { if (JSON.parse(bytes).latest !== '0.1.46') throw Error('readback_tag'); return { latest: '0.1.46' }; },
  tarball(bytes) { if (!bytes.equals(tarball)) throw Error('artifact_identity'); return { bytes: bytes.length, sha256: sha(bytes) }; },
  packument(bytes) { if (!JSON.parse(bytes).versions?.['0.1.46']) throw Error('readback_packument'); return { latest: '0.1.46', version_listed: true }; },
};

function fixture(t, responses = good) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-verify02-test-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const approvedHash = planHash(plan);
  const events = { lookups: [], requests: [], time: 0, hooks: {}, recheck: approvedHash };
  const adapter = {
    lookup(host, opts, done) { events.lookups.push([host, opts]); queueMicrotask(() => done(null, ip, 4)); },
    request(opts, receive) {
      const index = events.requests.push({ method: opts.method, path: opts.path, headers: opts.headers, hostname: opts.hostname }) - 1;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => {
        queueMicrotask(() => {
          events.hooks.request?.(index, opts);
          const socket = new EventEmitter();
          Object.assign(socket, { authorized: true, remoteAddress: ip });
          req.emit('socket', socket);
          socket.emit('secureConnect');
          const entry = responses[index];
          if (entry === 'reset' || entry === undefined) return req.emit('error', Error('reset'));
          const [statusCode, data] = entry;
          const res = new IncomingMessage(new Socket());
          Object.assign(res, { statusCode, statusMessage: 'fixture', complete: true, rawHeaders: [] });
          Object.defineProperty(res, 'headers', { value: {} });
          res.destroy = () => { res.destroyed = true; };
          receive(res);
          if (!res.destroyed) res.emit('data', Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data)));
          if (!res.destroyed) res.emit('end');
        });
      };
      return req;
    },
  };
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const run = more => executeVerify02Run({ root, plan, approvedHash, adapter, verify: fakeVerify, recheck: () => events.recheck,
    now: () => events.time, wall: () => UTC0, ...more });
  return { root, events, read, approvedHash, run };
}

test('one approval sends one DNS lookup and four anonymous GETs, then records the pub02 correction', async t => {
  const f = fixture(t);
  const result = await f.run();
  assert.equal(result.status, 'verified');
  assert.equal(result.reason, null);
  assert.deepEqual(result.verdicts, { version: 'confirmed', tag: 'confirmed', tarball: 'confirmed', packument: 'confirmed' });
  assert.deepEqual(result.counts, { dns_calls: 1, get_attempts: 4, put_attempts: 0, secondary_lookup_attempts: 0 });
  assert.equal(f.events.lookups.length, 1);
  assert.deepEqual(f.events.requests.map(r => [r.method, r.path]), SLOTS.map(s => ['GET', s.route + '?t=' + UTC0]));
  assert.deepEqual(f.events.requests.map(r => r.path.split('?')[0]),
    [ROUTES.version, ROUTES.tag, ROUTES.tarball, '/bushido-tradingview-mcp']);
  for (const [i, r] of f.events.requests.entries()) {
    assert.equal(r.hostname, ip);
    assert.equal(Object.hasOwn(r.headers, 'authorization'), false);
    assert.deepEqual(r.headers, { host: 'registry.npmjs.org', accept: SLOTS[i].accept, 'accept-encoding': 'identity',
      'cache-control': 'no-cache', connection: 'close' });
  }
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['approval.json', 'correction.json', 'packument.json', 'tag.json', 'tarball.json',
    'verification-readback.json', 'verification-status.json', 'version.json']);
  const correction = f.read('correction.json');
  assert.equal(correction.corrects, 'package-2026-11-20-publish-0.1.46-pub02');
  assert.deepEqual([correction.recorded_outcome, correction.corrected_outcome], ['refused', 'accepted_readback_confirmed']);
  assert.deepEqual(correction.pub02_send_2, { http_status: 202, response_bytes: 16, response_sha256: sha(SUCCESS_BODY), recorded_kind: 'refused',
    response_body: '{"success":true}' });
  assert.equal(correction.pub02_publication_readback_sha256, HISTORY['package-2026-11-20-publish-0.1.46-pub02'][1]);
  assert.equal(correction.published.tarball_sha256, sha(tarball));
  assert.deepEqual(correction.supersedes_unverified, { id: 'package-2026-11-20-publish-0.1.46-verify01',
    readback_sha256: HISTORY['package-2026-11-20-publish-0.1.46-verify01'][1],
    cause: 'its version judge required files and object key order, which the registry does not preserve' });
  assert.deepEqual(correction.version_manifest_keys, { main: 'same_ignoring_key_order', files: 'absent' });
  const approval = f.read('approval.json');
  assert.deepEqual([approval.approved_hash, approval.publication_approved, approval.network], [f.approvedHash, false, 'anonymous read-only GETs']);
  assert.equal(f.read('verification-readback.json').verified, true);
  assert.equal(f.read('tag.json').latest, '0.1.46');
});

test('a lagging, mismatched or unavailable slot leaves the run unverified without a correction or a retry', async t => {
  const cases = [
    [[[404, 'version not found'], good[1], good[2], good[3]], { version: 'absent' }],
    [[good[0], [200, { latest: '0.1.45' }], good[2], good[3]], { tag: 'mismatch' }],
    [[good[0], good[1], [200, Buffer.from('other bytes')], good[3]], { tarball: 'mismatch' }],
    [[good[0], good[1], good[2], [200, { name: 'bushido-tradingview-mcp', 'dist-tags': { latest: '0.1.45' }, versions: {} }]], { packument: 'mismatch' }],
    [[good[0], 'reset', good[2], good[3]], { tag: 'unavailable' }],
    [[[500, {}], good[1], good[2], good[3]], { version: 'mismatch' }],
    [[[206, good[0][1]], good[1], good[2], good[3]], { version: 'mismatch' }],
    [[[200, Buffer.from('not json')], good[1], good[2], good[3]], { version: 'mismatch' }],
  ];
  for (const [responses, changed] of cases) {
    const f = fixture(t, responses);
    const result = await f.run();
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, 'publication_unconfirmed');
    assert.deepEqual(result.verdicts, { version: 'confirmed', tag: 'confirmed', tarball: 'confirmed', packument: 'confirmed', ...changed });
    assert.equal(result.counts.get_attempts, 4);
    assert.equal(f.events.requests.length, 4);
    assert.equal(fs.existsSync(path.join(f.root, 'correction.json')), false);
    assert.equal(Object.hasOwn(result, 'record'), false);
    assert.equal(result.readback.file, 'verification-readback.json');
    assert.equal(f.read('verification-status.json').status, 'stopped');
  }
  const leak = fixture(t, [[200, Buffer.from('not json')], good[1], good[2], good[3]]);
  await leak.run();
  assert.deepEqual([leak.read('version.json').verdict, leak.read('version.json').reason], ['mismatch', 'response_unconfirmed']);
  const f = fixture(t, [good[0], good[1], [200, Buffer.from('other bytes')], good[3]]);
  await f.run();
  assert.deepEqual([f.read('tarball.json').verdict, f.read('tarball.json').reason], ['mismatch', 'artifact_identity']);
  const u = fixture(t, [good[0], 'reset', good[2], good[3]]);
  await u.run();
  assert.deepEqual([u.read('tag.json').verdict, u.read('tag.json').reason, u.read('tag.json').http_status], ['unavailable', 'transport_error', null]);
});

test('a version judge failure records only the fixed per-key verdicts', async t => {
  const keys = { main: 'same_ignoring_key_order', bin: 'different', scripts: 'same_ignoring_key_order', dependencies: 'same_ignoring_key_order',
    engines: 'same_ignoring_key_order', files: 'absent' };
  const f = fixture(t, [[200, { detail: { manifest_keys: keys } }], good[1], good[2], good[3]]);
  const result = await f.run();
  assert.equal(result.reason, 'publication_unconfirmed');
  assert.deepEqual([f.read('version.json').reason, f.read('version.json').manifest_keys], ['readback_manifest', keys]);
  for (const detail of [{ manifest_keys: { ...keys, bin: 'npm_SecretLeak' } }, { manifest_keys: { main: 'different' } },
    { manifest_keys: { ...keys, extra: 'absent' } }, { other: 'x' }, 'text']) {
    const g = fixture(t, [[200, { detail }], good[1], good[2], good[3]]);
    await g.run();
    assert.equal(Object.hasOwn(g.read('version.json'), 'manifest_keys'), false, JSON.stringify(detail));
    assert.ok(!fs.readFileSync(path.join(g.root, 'version.json'), 'utf8').includes('Secret'));
  }
});

test('canonical JSON ignores object key order but keeps array order and values', () => {
  assert.equal(canonical({ b: 1, a: { d: [2, 1], c: null } }), canonical({ a: { c: null, d: [2, 1] }, b: 1 }));
  assert.notEqual(canonical({ a: [1, 2] }), canonical({ a: [2, 1] }));
  assert.notEqual(canonical({ a: '1' }), canonical({ a: 1 }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 1, b: undefined, c: 2 }));
  assert.equal(canonical(undefined), undefined);
  assert.notEqual(canonical(undefined), canonical('build/index.js'));
  assert.deepEqual(MANIFEST_KEYS, ['main', 'bin', 'scripts', 'dependencies', 'engines']);
});

test('approved inputs and the stage window are rechecked before every dispatch', async t => {
  const drift = fixture(t);
  drift.events.hooks.request = index => { if (index === 1) drift.events.recheck = 'd'.repeat(64); };
  const changed = await drift.run();
  assert.equal(changed.reason, 'execution_inputs_changed');
  assert.equal(changed.counts.get_attempts, 2);
  assert.equal(fs.existsSync(path.join(drift.root, 'correction.json')), false);
  const slow = fixture(t);
  slow.events.hooks.request = index => { if (index === 1) slow.events.time = LIMITS.stageMs - LIMITS.getMs + 1; };
  const late = await slow.run();
  assert.equal(late.reason, 'stage_deadline');
  assert.equal(late.counts.get_attempts, 2);
  const early = fixture(t);
  await assert.rejects(early.run({ startedAt: 0, now: () => LIMITS.stageMs - LIMITS.getMs }), /stage_deadline/);
  assert.deepEqual([early.events.lookups.length, fs.readdirSync(early.root).length], [0, 0]);
});

test('an additional DNS lookup is counted and stops before the next GET', async t => {
  const f = fixture(t);
  f.events.hooks.request = (index, opts) => { if (index === 0) opts.lookup('elsewhere.example', {}, () => {}); };
  const result = await f.run();
  assert.equal(result.reason, 'verify02_transport_scope');
  assert.equal(result.counts.secondary_lookup_attempts, 1);
  assert.equal(result.counts.get_attempts, 1);
});

test('the approval must match, and an existing approval record refuses a second run before any network', async t => {
  const f = fixture(t);
  await assert.rejects(f.run({ approvedHash: 'a'.repeat(64) }), /approval_mismatch/);
  assert.equal(f.events.lookups.length, 0);
  await f.run();
  const lookups = f.events.lookups.length;
  await assert.rejects(f.run(), /verify02_scope_exists/);
  assert.equal(f.events.lookups.length, lookups);
});

test('request options are anonymous, pinned and cache-busted', () => {
  let lookups = 0;
  const options = getOptions(ip, SLOTS[3], '?t=' + UTC0, () => { lookups++; });
  assert.equal(options.path, '/bushido-tradingview-mcp?t=' + UTC0);
  assert.deepEqual([options.hostname, options.servername, options.port, options.family, options.agent, options.rejectUnauthorized],
    [ip, 'registry.npmjs.org', 443, 4, false, true]);
  assert.equal(options.headers.accept, 'application/vnd.npm.install-v1+json');
  assert.equal(Object.hasOwn(options.headers, 'authorization'), false);
  options.lookup('x', {}, error => assert.match(error.message, /additional_lookup_refused/));
  assert.equal(lookups, 1);
  assert.ok(options.checkServerIdentity(ip, { subject: {}, subjectaltname: 'DNS:example.com' }) instanceof Error);
});

const artifactFile = new URL('../../.release-work/package-2026-11-18-reverify-r02/artifact/verified-0.1.46.tgz', import.meta.url);
test('the real judges accept only registry documents that match the verified artifact and manifest', { skip: !fs.existsSync(artifactFile) }, () => {
  const artifact = fs.readFileSync(artifactFile);
  const manifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const integrity = 'sha512-' + createHash('sha512').update(artifact).digest('base64');
  const shasum = createHash('sha1').update(artifact).digest('hex');
  const url = 'https://registry.npmjs.org' + ROUTES.tarball;
  const pick = Object.fromEntries(['files', 'main', 'bin', 'scripts', 'dependencies', 'engines'].map(k => [k, manifest[k]]));
  const versionDoc = { name: manifest.name, version: '0.1.46', ...pick, dist: { integrity, shasum, tarball: url, fileCount: 1 }, _npmUser: { name: 'x' } };
  // What the registry actually serves: no `files`, object keys in another order.
  const reverse = value => Object.fromEntries(Object.entries(value).reverse());
  const { files: _omitted, ...withoutFiles } = versionDoc;
  const served = { ...withoutFiles, bin: reverse(manifest.bin), scripts: reverse(manifest.scripts), dependencies: reverse(manifest.dependencies) };
  assert.notEqual(JSON.stringify(served.bin), JSON.stringify(manifest.bin));
  const packument = { name: manifest.name, 'dist-tags': { latest: '0.1.46' }, modified: 'x',
    versions: { '0.1.45': { version: '0.1.45' }, '0.1.46': { name: manifest.name, version: '0.1.46', dist: { integrity, shasum, tarball: url } } } };
  const j = judges(artifact, manifest);
  const bytes = value => Buffer.from(JSON.stringify(value));
  const allSame = { main: 'same_ignoring_key_order', bin: 'same_ignoring_key_order', scripts: 'same_ignoring_key_order',
    dependencies: 'same_ignoring_key_order', engines: 'same_ignoring_key_order' };
  assert.deepEqual(j.version(bytes(served)), { version: '0.1.46', integrity, shasum, manifest_keys: { ...allSame, files: 'absent' } });
  assert.deepEqual(j.version(bytes(versionDoc)).manifest_keys, { ...allSame, files: 'same_ignoring_key_order' });
  const firstBin = Object.keys(manifest.bin)[0];
  for (const [doc, key] of [[{ ...served, bin: { ...manifest.bin, [firstBin]: 'build/other.js' } }, 'bin'],
    [{ ...served, files: ['build/'] }, 'files'], [{ ...withoutFiles, main: undefined }, 'main'],
    [{ ...served, dependencies: { ...manifest.dependencies, extra: '1.0.0' } }, 'dependencies'],
    [{ ...served, scripts: { ...manifest.scripts, postinstall: 'x' } }, 'scripts'], [{ ...served, engines: { node: '>=1' } }, 'engines']]) {
    assert.throws(() => j.version(bytes(doc)), error => error.message === 'readback_manifest' && error.detail.manifest_keys[key] === 'different', key);
  }
  assert.throws(() => j.version(bytes({ ...served, dist: { ...served.dist, tarball: 'https://evil.example' + ROUTES.tarball } })), /readback_tarball_url/);
  assert.throws(() => j.version(bytes({ ...served, dist: { ...served.dist, integrity: 'sha512-AAAA' } })), /readback_integrity/);
  assert.throws(() => j.version(Buffer.alloc(64 * 1024 + 1, 32)), /metadata_limit/);
  assert.throws(() => j.version(Buffer.from('[1]')), /readback_version/);
  assert.deepEqual(j.tag(bytes({ latest: '0.1.46', beta: '0.1.40' })), { latest: '0.1.46' });
  assert.deepEqual(j.tarball(artifact), { bytes: artifact.length, sha256: sha(artifact) });
  assert.deepEqual(j.packument(bytes(packument)), { latest: '0.1.46', version_listed: true });
  const versionCases = [{ ...versionDoc, dist: { ...versionDoc.dist, integrity: 'sha512-AAAA' } }, { ...versionDoc, dist: { ...versionDoc.dist, shasum: '0'.repeat(40) } },
    { ...versionDoc, version: '0.1.45' }, { ...versionDoc, dist: { ...versionDoc.dist, tarball: 'https://evil.example' + ROUTES.tarball } },
    { ...versionDoc, bin: {} }, { ...versionDoc, name: 'other' }, { ...versionDoc, dist: undefined }];
  for (const doc of versionCases) assert.throws(() => j.version(bytes(doc)));
  for (const tags of [{ latest: '0.1.45' }, [], null, 'x']) assert.throws(() => j.tag(bytes(tags)), /readback_tag/);
  assert.throws(() => j.tag(Buffer.from('not json')), /readback_tag/);
  assert.throws(() => j.tarball(artifact.subarray(1)), /artifact_identity/);
  const entry = packument.versions['0.1.46'];
  for (const doc of [{ ...packument, 'dist-tags': { latest: '0.1.45' } }, { ...packument, name: 'other' },
    { ...packument, versions: { '0.1.46': { ...entry, dist: { ...entry.dist, integrity: 'sha512-AAAA' } } } },
    { ...packument, versions: { '0.1.45': {} } }, { ...packument, versions: { '0.1.46': { ...entry, dist: { ...entry.dist, shasum: 'x' } } } },
    { ...packument, versions: { '0.1.46': { ...entry, dist: { ...entry.dist, tarball: url + '?x=1' } } } },
    { ...packument, versions: { '0.1.46': { ...entry, dist: { ...entry.dist, tarball: 'not a url' } } } }]) {
    assert.throws(() => j.packument(bytes(doc)), /readback_packument/);
  }
  assert.throws(() => j.packument(Buffer.from('{')), /readback_packument/);
});

test('only fixed reason codes reach records', () => {
  for (const code of ['transport_error', 'publication_unconfirmed', 'stage_deadline', 'readback_packument', 'dns_timeout'])
    assert.equal(safeReason(code), code);
  for (const code of ['Unexpected token', 'npm_secret', 'http_status_999', undefined]) assert.equal(safeReason(code), 'execution_stopped');
});

test('the 64 KiB reservation extends verify01 exactly and the approval fits its slot', () => {
  checkAllocationArithmetic();
  const verify01 = { cumulative: 50891762, remaining_pool: 30219081, campaign_cap: 88080384, protected_765_bytes_used: 0 };
  checkAllocationChain(verify01);
  for (const change of [{ cumulative: 50891763 }, { remaining_pool: 30219080 }, { campaign_cap: 1 }, { protected_765_bytes_used: 1 }])
    assert.throws(() => checkAllocationChain({ ...verify01, ...change }), /verify02_allocation_changed/);
  assert.deepEqual([ALLOCATION.reservation, ALLOCATION.cumulative, ALLOCATION.remaining_pool], [65536, 50957298, 30153545]);
  assert.equal(Object.values(RECORDS).reduce((a, b) => a + b, 0), 65536);
  assert.equal(Object.keys(HISTORY).length, 15);
  assert.equal(HISTORY['package-2026-11-20-publish-0.1.46-verify01'][1], 'bf4176626d5ca1e667f9de9495aaa105fb8f287bc1a5c8adc0a1611fee48ba69');
  assert.equal(HISTORY['package-2026-11-20-publish-0.1.46-login08'][1], 'd9c01bc81219075afe28fcbb4a799b1f5b8cceef4772d63e1a58226beaacb158');
  assert.equal(HISTORY['package-2026-11-20-publish-0.1.46-pub02'][1], '054e3bf15c1fd7d665bc288a312536ee8784e95d6c65c4a796ffc68e5ea5d98f');
  const h = 'e'.repeat(64);
  const inputs = { id: VERIFY02_ID, root: '/Users/operator-with-a-long-name/Downloads/GitHub/TradingView-MCP/.release-work/' + VERIFY02_ID,
    artifact: { file: '.release-work/package-2026-11-18-reverify-r02/artifact/verified-0.1.46.tgz', bytes: 846950, sha256: h,
      sha1: 'f'.repeat(40), integrity: 'sha512-' + 'A'.repeat(86) + '==' },
    pub02: { approved_plan_sha256: h, entity_sha256: h, send_2: { http_status: 202, response_bytes: 16, response_sha256: h, recorded_kind: 'refused' },
      recorded_outcome: 'refused', verify01: { status: 'stopped', version_reason: 'readback_manifest', version_response_sha256: h } } };
  const full = planFor(inputs, { reservation_sha256: h, inputs_sha256: h, tests_sha256: h, preparation_readback_sha256: h });
  assert.ok(Buffer.byteLength(JSON.stringify(approvalRecord(full, planHash(full))) + '\n') <= RECORDS['approval.json']);
  assert.equal(full.publication, false);
});
