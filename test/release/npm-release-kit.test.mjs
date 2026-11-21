import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ENTITY_LIMIT, buildPublishEntity, checkTarget, compareVersions, confirmedPhrase, npmRoot, publicationOutcome, readAnswer,
  registryTransport, releaseRoutes, summarizePreflight, verifyArtifactBytes, verifyPublishEntity } from '../../scripts/npm-release-kit.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => createHash('sha256').update(bytes).digest('base64');
const target = Object.freeze({ name: 'bushido-tradingview-mcp', version: '0.1.47', tag: 'latest', account: 'release-operator' });
const json = value => Buffer.from(JSON.stringify(value));
const artifact = Buffer.from('synthetic artifact bytes for the release kit');
const expected = { bytes: artifact.length, sha256: sha(artifact) };
const manifest = Object.freeze({ name: target.name, version: target.version, description: 'synthetic', main: 'build/index.js',
  bin: { 'bushido-tradingview-mcp': 'build/index.js' }, files: ['build/**/*.js', 'README.md'], scripts: { build: 'tsc' },
  dependencies: { zod: '^4.0.0' }, engines: { node: '>=20' } });

test('targets, versions and routes are derived from the release target only', () => {
  assert.equal(checkTarget(target), target);
  for (const bad of [{ ...target, name: '@scope/pkg' }, { ...target, version: '0.1.47-rc.1' }, { ...target, version: '01.1.47' },
    { ...target, tag: 'Latest' }, { ...target, account: '' }, null]) assert.throws(() => checkTarget(bad), /release_target/);
  assert.equal(compareVersions('0.1.46', '0.1.47'), -1);
  assert.equal(compareVersions('0.1.47', '0.1.47'), 0);
  assert.equal(compareVersions('0.2.0', '0.1.47'), 1);
  assert.equal(compareVersions('0.1.100', '0.1.47'), 1);
  assert.throws(() => compareVersions('0.1', '0.1.47'), /version_shape/);
  const routes = releaseRoutes(target);
  assert.deepEqual(routes, {
    preflight: { account: '/-/whoami', rights: '/-/package/bushido-tradingview-mcp/collaborators',
      version: '/bushido-tradingview-mcp/0.1.47', tag: '/-/package/bushido-tradingview-mcp/dist-tags' },
    publish: '/bushido-tradingview-mcp',
    readback: { version: '/bushido-tradingview-mcp/0.1.47', tag: '/-/package/bushido-tradingview-mcp/dist-tags',
      tarball: '/bushido-tradingview-mcp/-/bushido-tradingview-mcp-0.1.47.tgz', packument: '/bushido-tradingview-mcp' } });
  assert.ok(Object.isFrozen(routes) && Object.isFrozen(routes.preflight) && Object.isFrozen(routes.readback));
});

test('preflight replies confirm the account, write rights, an absent version and a lower dist-tag', () => {
  assert.deepEqual(summarizePreflight('account', 200, json({ username: target.account }), target), { account_matches: true });
  assert.throws(() => summarizePreflight('account', 200, json({ username: 'someone-else' }), target), /session_account_mismatch/);
  assert.throws(() => summarizePreflight('account', 401, json({ username: target.account }), target), /account_unconfirmed/);
  assert.deepEqual(summarizePreflight('rights', 200, json({ [target.account]: 'write' }), target),
    { account_matches: true, collaborator_permission: 'write', token_publish_permission: 'unconfirmed' });
  assert.throws(() => summarizePreflight('rights', 200, json({ [target.account]: 'read' }), target), /rights_unconfirmed/);
  assert.throws(() => summarizePreflight('rights', 200, json({ other: 'write' }), target), /rights_unconfirmed/);
  for (const message of ['version not found: 0.1.47', 'Version not found:  0.1.47 ', 'no match found for version 0.1.47']) {
    assert.deepEqual(summarizePreflight('version', 404, json(message), target), { version: '0.1.47', exists: false });
    assert.deepEqual(summarizePreflight('version', 404, json({ error: message }), target), { version: '0.1.47', exists: false });
  }
  for (const [status, body] of [[200, { name: target.name, version: '0.1.47' }], [404, 'version not found: 0.1.46'],
    [404, 'version not found: 0.1.470'], [404, 'version not found: 0x1x47'], [404, 'Not Found']]) {
    assert.throws(() => summarizePreflight('version', status, json(body), target), /version_availability_unconfirmed/);
  }
  assert.deepEqual(summarizePreflight('tag', 200, json({ latest: '0.1.46', next: '9.9.9' }), target), { latest: '0.1.46' });
  for (const latest of ['0.1.47', '0.1.48', '1.0.0']) {
    assert.throws(() => summarizePreflight('tag', 200, json({ latest }), target), /latest_at_or_above_candidate/);
  }
  assert.throws(() => summarizePreflight('tag', 200, json({ latest: 'v0.1.46' }), target), /latest_unconfirmed/);
  assert.throws(() => summarizePreflight('tag', 200, json({}), target), /latest_unconfirmed/);
  assert.throws(() => summarizePreflight('account', 200, Buffer.from('{'), target), /response_json/);
  assert.throws(() => summarizePreflight('account', 200, json([target.account]), target), /response_shape/);
  assert.throws(() => summarizePreflight('other', 200, json({}), target), /unknown_slot/);
});

test('the artifact must match its recorded bytes and digest', () => {
  const digests = verifyArtifactBytes(artifact, expected);
  assert.equal(digests.sha256, expected.sha256);
  assert.equal(digests.integrity, 'sha512-' + createHash('sha512').update(artifact).digest('base64'));
  assert.equal(digests.shasum, createHash('sha1').update(artifact).digest('hex'));
  assert.throws(() => verifyArtifactBytes(Buffer.concat([artifact, Buffer.from('x')]), expected), /artifact_identity/);
  assert.throws(() => verifyArtifactBytes(Buffer.from(artifact).fill(0x41, 0, 1), expected), /artifact_identity/);
  assert.throws(() => verifyArtifactBytes(artifact.toString(), expected), /artifact_identity/);
});

function entity(change = m => m) {
  const digests = verifyArtifactBytes(artifact, expected), file = target.name + '-' + target.version + '.tgz';
  const m = { _id: target.name, name: target.name, description: 'synthetic', 'dist-tags': { latest: target.version }, access: 'public',
    versions: { [target.version]: { ...manifest, _id: target.name + '@' + target.version,
      dist: { integrity: digests.integrity, shasum: digests.shasum, tarball: 'http://registry.npmjs.org/' + target.name + '/-/' + file } } },
    _attachments: { [file]: { content_type: 'application/octet-stream', data: artifact.toString('base64'), length: artifact.length } } };
  return json(change(m));
}

test('the PUT entity carries exactly the artifact, its digests and the manifest fields', () => {
  const proof = verifyPublishEntity(entity(), artifact, manifest, expected, target);
  assert.equal(proof.sha256, sha(entity()));
  const v = m => m.versions[target.version], a = m => m._attachments[target.name + '-0.1.47.tgz'];
  const mutations = [
    [m => ({ ...m, name: 'other' }), /entity_target/], [m => ({ ...m, access: 'restricted' }), /entity_target/],
    [m => ({ ...m, 'dist-tags': { latest: '0.1.46' } }), /entity_target/],
    [m => ({ ...m, 'dist-tags': { latest: '0.1.47', next: '0.1.47' } }), /entity_target/],
    [m => ({ ...m, versions: { ...m.versions, '0.1.46': v(m) } }), /entity_version/],
    [m => { m._attachments.extra = a(m); return m; }, /entity_attachments/],
    [m => { a(m).length++; return m; }, /attachment_shape/],
    [m => { a(m).data = Buffer.from('other bytes').toString('base64'); return m; }, /attachment_identity/],
    [m => { v(m).dist.shasum = '0'.repeat(40); return m; }, /attachment_integrity/],
    [m => { v(m).files = ['build']; return m; }, /entity_manifest/],
    [m => { v(m).scripts = { postinstall: 'node x' }; return m; }, /entity_manifest/],
    [m => { delete v(m).engines; return m; }, /entity_manifest/],
  ];
  for (const [change, reason] of mutations) assert.throws(() => verifyPublishEntity(entity(change), artifact, manifest, expected, target), reason);
  assert.throws(() => verifyPublishEntity(Buffer.alloc(ENTITY_LIMIT + 1), artifact, manifest, expected, target), /entity_limit/);
  assert.throws(() => verifyPublishEntity(Buffer.from('['), artifact, manifest, expected, target), /entity_json/);
});

function npmInventory() {
  const root = npmRoot(), files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { const bytes = fs.readFileSync(full); files.push([path.relative(root, full), bytes.length, b64(bytes)]); }
    }
  };
  walk(root);
  return { name: 'npm', root, files };
}

test('npm builds the PUT body offline from modules bound to the npm inventory', async t => {
  const version = JSON.parse(fs.readFileSync(path.join(npmRoot(), 'package.json'), 'utf8')).version;
  if (version !== '11.16.0') t.diagnostic('npm ' + version);
  const npmGroup = npmInventory();
  const built = await buildPublishEntity(artifact, manifest, { expected, target, npmGroup, npmVersion: version });
  assert.equal(built.proof.sha256, sha(built.body));
  assert.equal(built.loaded_modules.all_bound_to_B_inventory, true);
  assert.ok(built.loaded_modules.count > 10);
  const body = JSON.parse(built.body);
  assert.equal(body.versions['0.1.47']._npmVersion, version);
  assert.equal(body.versions['0.1.47'].dist.tarball, 'http://registry.npmjs.org/bushido-tradingview-mcp/-/bushido-tradingview-mcp-0.1.47.tgz');
  const again = await buildPublishEntity(artifact, manifest, { expected, target, npmGroup, npmVersion: version });
  assert.ok(again.body.equals(built.body));
  assert.deepEqual(again.loaded_modules, built.loaded_modules);

  const publish = path.join(npmGroup.root, 'node_modules/libnpmpublish/lib/publish.js');
  const changed = { ...npmGroup, files: npmGroup.files.map(row => path.resolve(npmGroup.root, row[0]) === publish ? [row[0], row[1], 'x' + row[2].slice(1)] : row) };
  await assert.rejects(buildPublishEntity(artifact, manifest, { expected, target, npmGroup: changed, npmVersion: version }), /publisher_loaded_input_changed/);
  const missing = { ...npmGroup, files: npmGroup.files.filter(row => path.resolve(npmGroup.root, row[0]) !== publish) };
  await assert.rejects(buildPublishEntity(artifact, manifest, { expected, target, npmGroup: missing, npmVersion: version }), /publisher_loaded_input_outside_manifest/);
  await assert.rejects(buildPublishEntity(artifact, manifest, { expected, target, npmGroup, npmVersion: '0.0.0' }), /publisher_npm_version/);
  await assert.rejects(buildPublishEntity(artifact, manifest, { expected, target, npmGroup: { ...npmGroup, root: '/elsewhere' }, npmVersion: version }), /publisher_npm_root/);
  await assert.rejects(buildPublishEntity(artifact, { ...manifest, version: '0.1.46' }, { expected, target, npmGroup, npmVersion: version }), /manifest_target/);
  await assert.rejects(buildPublishEntity(artifact, { ...manifest, private: true }, { expected, target, npmGroup, npmVersion: version }), /manifest_target/);
  await assert.rejects(buildPublishEntity(artifact, { ...manifest, tag: 'next' }, { expected, target, npmGroup, npmVersion: version }), /manifest_target/);
  await assert.rejects(buildPublishEntity(Buffer.from('other'), manifest, { expected, target, npmGroup, npmVersion: version }), /artifact_identity/);
});

const host = 'registry.npmjs.org', ip = '192.0.2.47';
const limits = { dnsMs: 5000, getMs: 30000, putMs: 60000, headerBytes: 16384 };
function transportFixture() {
  const events = { before: [], lookups: 0, requests: [] };
  const adapter = { lookup(name, options, done) { events.lookups++; done(null, ip, 4); }, request(options) { events.requests.push([options.method, options.path]); return {}; } };
  const transport = registryTransport({ adapter, before: ms => events.before.push(ms), routes: releaseRoutes(target), host, limits, maxOtpPolls: 2 });
  const options = (method, route) => ({ method, path: route, hostname: ip, servername: host, port: 443, family: 4, agent: false,
    autoSelectFamily: false, rejectUnauthorized: true, maxHeaderSize: limits.headerBytes, headers: { authorization: 'Bearer synthetic' },
    lookup: (_h, _o, cb) => cb(Error('refused')), checkServerIdentity: () => undefined });
  return { events, transport, options, routes: releaseRoutes(target) };
}

test('the registry transport allows only the phase-ordered dispatches on the pinned address', () => {
  const { events, transport, options, routes } = transportFixture();
  assert.throws(() => transport.request(options('GET', routes.preflight.account)), /release_transport_scope/);
  assert.throws(() => transport.lookup('example.com', { family: 4, all: false }, () => {}), /release_transport_scope/);
  transport.lookup(host, { family: 4, all: false }, () => {});
  assert.equal(transport.address, ip);
  assert.throws(() => transport.lookup(host, { family: 4, all: false }, () => {}), /release_transport_scope/);
  assert.throws(() => transport.request(options('GET', routes.preflight.rights)), /release_transport_scope/);
  assert.throws(() => transport.enter('publish'), /release_transport_scope/);
  for (const route of Object.values(routes.preflight)) transport.request(options('GET', route));
  transport.preflightComplete();
  assert.throws(() => transport.request(options('GET', routes.preflight.tag)), /release_transport_scope/);
  assert.throws(() => transport.enter('readback'), /release_transport_scope/);
  transport.enter('publish');
  assert.throws(() => transport.request(options('GET', routes.publish)), /release_transport_scope/);
  assert.throws(() => transport.request(options('PUT', '/other')), /release_transport_scope/);
  transport.request(options('PUT', routes.publish));
  assert.throws(() => transport.enter('otp', { poll: 'https://registry.npmjs.org/-/v1/done' }), /release_transport_scope/);
  transport.enter('otp', { poll: '/-/v1/done?authId=synthetic' });
  assert.throws(() => transport.request(options('GET', '/-/v1/done?authId=other')), /release_transport_scope/);
  transport.request(options('GET', '/-/v1/done?authId=synthetic'));
  transport.request(options('GET', '/-/v1/done?authId=synthetic'));
  assert.throws(() => transport.request(options('GET', '/-/v1/done?authId=synthetic')), /release_transport_scope/);
  transport.enter('publish');
  transport.request(options('PUT', routes.publish));
  assert.throws(() => transport.request(options('PUT', routes.publish)), /release_transport_scope/);
  transport.enter('readback');
  for (const route of Object.values(routes.readback)) transport.request(options('GET', route));
  assert.throws(() => transport.request(options('GET', routes.readback.version)), /release_transport_scope/);
  assert.throws(() => transport.enter('publish'), /release_transport_scope/);
  assert.deepEqual(transport.counts, { dns_calls: 1, get_attempts: 10, put_attempts: 2, otp_poll_attempts: 2, readback_attempts: 4,
    secondary_lookup_attempts: 0 });
  assert.equal(events.lookups, 1);
  assert.equal(events.requests.length, 12);
});

test('the transport refuses unpinned or weakened request options and counts a second lookup', () => {
  const { transport, options, routes } = transportFixture();
  transport.lookup(host, { family: 4, all: false }, () => {});
  for (const change of [{ hostname: '198.51.100.1' }, { servername: 'example.com' }, { port: 8443 }, { family: 6 }, { agent: undefined },
    { autoSelectFamily: true }, { rejectUnauthorized: false }, { maxHeaderSize: 1 << 20 }, { headers: {} }, { lookup: undefined },
    { checkServerIdentity: undefined }]) {
    assert.throws(() => transport.request({ ...options('GET', routes.preflight.account), ...change }), /release_transport_scope/);
  }
  let captured;
  const adapter = { lookup(_n, _o, done) { done(null, ip, 4); }, request(opts) { captured = opts; return {}; } };
  const second = registryTransport({ adapter, before() {}, routes, host, limits, maxOtpPolls: 1 });
  second.lookup(host, { family: 4, all: false }, () => {});
  second.request(options('GET', routes.preflight.account));
  captured.lookup(host, {}, () => {});
  assert.equal(second.counts.secondary_lookup_attempts, 1);
  assert.throws(() => second.request(options('GET', routes.preflight.rights)), /release_transport_scope/);
});

test('a second PUT needs exactly one OTP passage, web or classic', () => {
  const ready = () => {
    const f = transportFixture();
    f.transport.lookup(host, { family: 4, all: false }, () => {});
    for (const route of Object.values(f.routes.preflight)) f.transport.request(f.options('GET', route));
    f.transport.enter('publish');
    return f;
  };
  const direct = ready();
  assert.throws(() => direct.transport.enter('otp', { classic: true }), /release_transport_scope/);
  direct.transport.request(direct.options('PUT', direct.routes.publish));
  assert.throws(() => direct.transport.request(direct.options('PUT', direct.routes.publish)), /release_transport_scope/);
  assert.equal(direct.transport.counts.put_attempts, 1);

  const classic = ready();
  classic.transport.request(classic.options('PUT', classic.routes.publish));
  assert.throws(() => classic.transport.enter('otp', { classic: true, poll: '/-/v1/done' }), /release_transport_scope/);
  classic.transport.enter('otp', { classic: true });
  assert.throws(() => classic.transport.request(classic.options('GET', '/-/v1/done')), /release_transport_scope/);
  classic.transport.enter('publish');
  assert.throws(() => classic.transport.enter('otp', { classic: true }), /release_transport_scope/);
  classic.transport.request(classic.options('PUT', classic.routes.publish));
  assert.deepEqual([classic.transport.counts.put_attempts, classic.transport.counts.otp_poll_attempts], [2, 0]);
});

test('readAnswer skips blank lines, strips a carriage return and stops at its byte limit', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-release-kit-answer-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'answers');
  fs.writeFileSync(file, '\n  \r\n publish 0.1.47 \r\nnext\n' + 'x'.repeat(40) + '\n');
  const fd = fs.openSync(file, 'r');
  try {
    assert.equal(readAnswer(fd, 64), ' publish 0.1.47 ');
    assert.equal(readAnswer(fd, 64), 'next');
    assert.equal(readAnswer(fd, 16), 'x'.repeat(16));
    assert.equal(readAnswer(fd, 64), 'x'.repeat(24));
    assert.equal(readAnswer(fd, 64), '');
  } finally { fs.closeSync(fd); }
});

test('the transport runs the before hook ahead of every dispatch and stops when it throws', () => {
  const { events, transport, options, routes } = transportFixture();
  transport.lookup(host, { family: 4, all: false }, () => {});
  transport.request(options('GET', routes.preflight.account));
  assert.deepEqual(events.before, [limits.dnsMs, limits.getMs]);
  const blocked = registryTransport({ adapter: { lookup() { throw Error('dispatched'); } }, before() { throw Error('stage_deadline'); },
    routes, host, limits, maxOtpPolls: 1 });
  assert.throws(() => blocked.lookup(host, { family: 4, all: false }, () => {}), /stage_deadline/);
  assert.equal(blocked.counts.dns_calls, 0);
});

test('publication outcomes and the confirmation phrase', () => {
  assert.equal(publicationOutcome({ dispatched: 0 }), 'not_sent');
  assert.equal(publicationOutcome({ dispatched: 1, accepted: true, readbackConfirmed: true }), 'accepted_readback_confirmed');
  assert.equal(publicationOutcome({ dispatched: 2, accepted: true, readbackConfirmed: false }), 'accepted_readback_unconfirmed');
  assert.equal(publicationOutcome({ dispatched: 1, unanswered: true, readbackConfirmed: true }), 'unanswered_readback_confirmed');
  assert.equal(publicationOutcome({ dispatched: 1, unanswered: true, readbackConfirmed: false }), 'unknown');
  assert.equal(publicationOutcome({ dispatched: 2, accepted: false, unanswered: false }), 'refused');
  for (const typed of ['publish 0.1.47', ' publish 0.1.47\n', '\u3000publish 0.1.47\r']) assert.equal(confirmedPhrase(typed, 'publish 0.1.47'), true);
  for (const typed of ['publish 0.1.46', 'publish  0.1.47', 'Publish 0.1.47', 'publish 0.1.47 now', '', undefined]) {
    assert.equal(confirmedPhrase(typed, 'publish 0.1.47'), false);
  }
  assert.equal(confirmedPhrase('', ''), false);
});
