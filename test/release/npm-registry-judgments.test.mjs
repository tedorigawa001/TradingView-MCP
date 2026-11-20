import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPut } from '../../scripts/npm-publish-protocol.mjs';
import { ROUTES } from '../../scripts/publish-verified-tarball.mjs';
import { FIELD_VERDICTS, MANIFEST_FIELDS, VERSION_DOCUMENT_LIMIT, canonicalJson, classifyPublishReply, compareManifestFields,
  judgmentDetail, tarballPath, verifyDistTags, verifyInstallPackument, verifyVersionDocument } from '../../scripts/npm-registry-judgments.mjs';

const json = value => Buffer.from(JSON.stringify(value));
const otpUrls = { authUrl: 'https://www.npmjs.com/auth/cli/mock-judgments', doneUrl: 'https://registry.npmjs.org/-/v1/done?authId=mockjudgments' };

test('the pub02 reply, HTTP 202 with {"success":true}, is an accepted publication', () => {
  assert.deepEqual(classifyPublishReply({ status: 202, headers: {}, bytes: Buffer.from('{"success":true}') }), { kind: 'accepted', status: 202 });
  for (const status of [200, 201, 203, 204, 299]) assert.equal(classifyPublishReply({ status }).kind, 'accepted', String(status));
});

test('1xx, 3xx and 5xx replies stay unknown for readback; 4xx replies are refusals', () => {
  for (const status of [100, 199, 300, 301, 302, 304, 307, 308, 399, 500, 502, 503, 599]) {
    assert.deepEqual(classifyPublishReply({ status }), { kind: 'unknown', status, reason: 'publish_http_status_' + status });
  }
  for (const status of [400, 402, 403, 404, 409, 422, 429, 499]) {
    assert.deepEqual(classifyPublishReply({ status, bytes: json({ error: 'x' }) }), { kind: 'refused', status, reason: 'publish_http_status_' + status });
  }
  for (const bad of [{ status: 99 }, { status: 600 }, { status: '200' }, { status: 200.5 }, {}, null, undefined]) {
    assert.throws(() => classifyPublishReply(bad), /publish_response_shape/);
  }
});

test('a 401 is classified exactly as npm 11 does: web OTP, classic OTP, IP address or refusal', () => {
  const web = classifyPublishReply({ status: 401, headers: { 'www-authenticate': 'OTP' }, bytes: json(otpUrls) });
  assert.deepEqual([web.kind, web.browser, web.poll], ['otp_web', otpUrls.authUrl, '/-/v1/done?authId=mockjudgments']);
  assert.equal(classifyPublishReply({ status: 401, headers: { 'www-authenticate': 'Basic, otp' } }).kind, 'otp_classic');
  assert.equal(classifyPublishReply({ status: 401, bytes: Buffer.from('You must provide a one-time pass.') }).kind, 'otp_classic');
  assert.deepEqual(classifyPublishReply({ status: 401, headers: { 'www-authenticate': 'ipaddress' } }),
    { kind: 'refused', status: 401, reason: 'publish_auth_ip_address' });
  assert.deepEqual(classifyPublishReply({ status: 401, headers: { 'www-authenticate': 'Bearer' }, bytes: Buffer.from('one-time pass') }),
    { kind: 'refused', status: 401, reason: 'publish_http_status_401' });
  assert.throws(() => classifyPublishReply({ status: 401, headers: { 'www-authenticate': 'otp' },
    bytes: json({ authUrl: 'https://evil.example/x', doneUrl: otpUrls.doneUrl }) }), /publish_otp_url_rejected/);
});

test('against the pub01/pub02 classifier, only 1xx, 3xx and 202-299 change', () => {
  const variants = [{}, { headers: { 'www-authenticate': 'OTP' }, bytes: json(otpUrls) }, { headers: { 'www-authenticate': 'otp' } },
    { headers: { 'www-authenticate': 'ipaddress' } }, { bytes: Buffer.from('one-time pass') }, { bytes: json({ success: true }) }];
  const outcome = (fn, response) => { try { const r = fn(response); return [r.kind, r.reason ?? null]; } catch (error) { return ['throws', error.message]; } };
  const changed = new Set();
  for (let status = 100; status <= 599; status++) {
    for (const variant of variants) {
      const response = { status, headers: {}, bytes: Buffer.alloc(0), ...variant };
      const before = outcome(classifyPut, response), after = outcome(classifyPublishReply, response);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changed.add(status);
      if (status >= 202 && status <= 299) assert.deepEqual([before[0], after[0]], ['refused', 'accepted'], String(status));
      else assert.deepEqual([before[0], after[0]], ['refused', 'unknown'], String(status));
    }
  }
  const expected = [];
  for (let status = 100; status <= 399; status++) if (status < 200 || status > 201) expected.push(status);
  assert.deepEqual([...changed].sort((a, b) => a - b), expected);
});

const target = { name: 'example-pkg', version: '1.2.3', integrity: 'sha512-' + 'A'.repeat(86) + '==', shasum: 'a'.repeat(40) };
const manifest = { name: 'example-pkg', version: '1.2.3', main: 'build/index.js', files: ['build/**/*.js', 'README.md'],
  bin: { 'example-a': 'build/a.js', 'example-b': 'build/b.js', 'example-c': 'build/c.js' },
  scripts: { build: 'tsc', test: 'node --test', prepack: 'npm run build' }, dependencies: { alpha: '^1.0.0', beta: '^2.0.0' },
  engines: { node: '>=20' }, devDependencies: { typescript: '^5.0.0' } };
const reverse = value => Object.fromEntries(Object.entries(value).reverse());
const url = 'https://registry.npmjs.org/example-pkg/-/example-pkg-1.2.3.tgz';
// What the registry serves: no `files`, other key order, extra registry fields.
const served = { _id: 'example-pkg@1.2.3', name: 'example-pkg', version: '1.2.3', main: manifest.main, bin: reverse(manifest.bin),
  scripts: reverse(manifest.scripts), dependencies: reverse(manifest.dependencies), engines: manifest.engines, _npmUser: { name: 'x' },
  dist: { integrity: target.integrity, shasum: target.shasum, tarball: url, fileCount: 3, signatures: [{ keyid: 'k', sig: 's' }] } };
const allSame = Object.fromEntries(MANIFEST_FIELDS.map(field => [field, 'same_ignoring_key_order']));

test('the version document the registry serves (no files, other key order) is accepted', () => {
  assert.notEqual(JSON.stringify(served.bin), JSON.stringify(manifest.bin));
  assert.deepEqual(verifyVersionDocument(json(served), target, manifest),
    { version: '1.2.3', integrity: target.integrity, shasum: target.shasum, manifest_fields: { ...allSame, files: 'absent' } });
  assert.deepEqual(verifyVersionDocument(json({ ...served, files: manifest.files }), target, manifest).manifest_fields,
    { ...allSame, files: 'same_ignoring_key_order' });
  assert.equal(verifyVersionDocument(json({ ...served, dist: { ...served.dist, tarball: url.replace('https:', 'http:') } }), target, manifest).version, '1.2.3');
});

test('any changed manifest value, a changed files list or a missing field is rejected with its verdict', () => {
  const firstBin = Object.keys(manifest.bin)[0];
  const cases = [
    [{ ...served, bin: { ...served.bin, [firstBin]: 'build/other.js' } }, 'bin'],
    [{ ...served, bin: { ...served.bin, extra: 'build/x.js' } }, 'bin'],
    [{ ...served, scripts: { ...served.scripts, postinstall: 'node x.js' } }, 'scripts'],
    [{ ...served, dependencies: { alpha: '^1.0.1', beta: '^2.0.0' } }, 'dependencies'],
    [{ ...served, engines: { node: '>=18' } }, 'engines'],
    [{ ...served, main: 'index.js' }, 'main'],
    [{ ...served, main: undefined }, 'main'],
    [{ ...served, files: ['build/'] }, 'files'],
    [{ ...served, files: [...manifest.files].reverse() }, 'files'],
  ];
  for (const [doc, field] of cases) {
    assert.throws(() => verifyVersionDocument(json(doc), target, manifest), error => {
      assert.equal(error.message, 'readback_manifest');
      assert.equal(error.detail.manifest_fields[field], 'different', field);
      assert.equal(Object.values(error.detail.manifest_fields).filter(v => v === 'different').length, 1, field);
      return true;
    });
  }
});

test('the version document must name the target and carry its integrity, shasum and tarball URL', () => {
  const bad = [
    [{ ...served, name: 'other' }, 'readback_version'], [{ ...served, version: '1.2.4' }, 'readback_version'],
    [{ ...served, dist: { ...served.dist, integrity: 'sha512-' + 'B'.repeat(86) + '==' } }, 'readback_integrity'],
    [{ ...served, dist: { ...served.dist, shasum: 'b'.repeat(40) } }, 'readback_integrity'], [{ ...served, dist: undefined }, 'readback_integrity'],
    [{ ...served, dist: { ...served.dist, tarball: 'https://evil.example/example-pkg/-/example-pkg-1.2.3.tgz' } }, 'readback_tarball_url'],
    [{ ...served, dist: { ...served.dist, tarball: url + '?x=1' } }, 'readback_tarball_url'],
    [{ ...served, dist: { ...served.dist, tarball: 'https://registry.npmjs.org:444/example-pkg/-/example-pkg-1.2.3.tgz' } }, 'readback_tarball_url'],
    [{ ...served, dist: { ...served.dist, tarball: 'https://registry.npmjs.org/example-pkg/-/example-pkg-1.2.2.tgz' } }, 'readback_tarball_url'],
    [{ ...served, dist: { ...served.dist, tarball: 'not a url' } }, 'readback_tarball_url'],
  ];
  for (const [doc, reason] of bad) assert.throws(() => verifyVersionDocument(json(doc), target, manifest), new RegExp(reason), reason);
  for (const bytes of [Buffer.from('[1]'), Buffer.from('null'), Buffer.from('{'), Buffer.from([0xff, 0xfe])]) {
    assert.throws(() => verifyVersionDocument(bytes, target, manifest), /readback_version/);
  }
  assert.throws(() => verifyVersionDocument(Buffer.alloc(VERSION_DOCUMENT_LIMIT + 1, 32), target, manifest), /metadata_limit/);
  assert.throws(() => verifyVersionDocument('{}', target, manifest), /metadata_limit/);
  assert.throws(() => verifyVersionDocument(json(served), target, { ...manifest, version: '1.2.4' }), /manifest_target/);
  for (const t of [{ ...target, integrity: 'sha1-x' }, { ...target, shasum: 'A'.repeat(40) }, { ...target, name: 'Bad Name' },
    { ...target, version: '1.2' }, null]) {
    assert.throws(() => verifyVersionDocument(json(served), t, manifest), /package_target/);
  }
});

test('dist-tags and the install packument are checked against the same target', () => {
  assert.deepEqual(verifyDistTags(json({ latest: '1.2.3', beta: '1.3.0-beta.1' }), target), { latest: '1.2.3' });
  assert.deepEqual(verifyDistTags(json({ latest: '1.2.2', next: '1.2.3' }), target, 'next'), { next: '1.2.3' });
  for (const bytes of [json({ latest: '1.2.2' }), json([]), json(null), Buffer.from('x')]) assert.throws(() => verifyDistTags(bytes, target), /readback_tag/);
  const entry = { name: 'example-pkg', version: '1.2.3', bin: manifest.bin, dist: { integrity: target.integrity, shasum: target.shasum, tarball: url } };
  const packument = { name: 'example-pkg', modified: 'x', 'dist-tags': { latest: '1.2.3' }, versions: { '1.2.2': { version: '1.2.2' }, '1.2.3': entry } };
  assert.deepEqual(verifyInstallPackument(json(packument), target), { latest: '1.2.3', version_listed: true });
  for (const doc of [{ ...packument, name: 'other' }, { ...packument, 'dist-tags': { latest: '1.2.2' } }, { ...packument, versions: { '1.2.2': {} } },
    { ...packument, versions: { '1.2.3': { ...entry, version: '1.2.2' } } },
    { ...packument, versions: { '1.2.3': { ...entry, dist: { ...entry.dist, integrity: 'sha512-' + 'B'.repeat(86) + '==' } } } },
    { ...packument, versions: { '1.2.3': { ...entry, dist: { ...entry.dist, shasum: 'b'.repeat(40) } } } },
    { ...packument, versions: { '1.2.3': { ...entry, dist: { ...entry.dist, tarball: url + '#x' } } } }]) {
    assert.throws(() => verifyInstallPackument(json(doc), target), /readback_packument/);
  }
  assert.throws(() => verifyInstallPackument(Buffer.from('{'), target), /readback_packument/);
});

test('tarball paths follow the registry layout, including the 0.1.46 route and scoped names', () => {
  assert.equal(tarballPath('bushido-tradingview-mcp', '0.1.46'), ROUTES.tarball);
  assert.equal(tarballPath('@scope/pkg', '2.0.0-rc.1'), '/@scope/pkg/-/pkg-2.0.0-rc.1.tgz');
  for (const [name, version] of [['Upper', '1.0.0'], ['a b', '1.0.0'], ['../x', '1.0.0'], ['@scope/', '1.0.0'], ['x', '01.0.0'], ['x', '1.0'], ['x', 'v1.0.0']]) {
    assert.throws(() => tarballPath(name, version), /package_target/, name + '@' + version);
  }
});

test('canonical JSON ignores object key order at every depth but keeps arrays and values', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } }), canonicalJson({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }));
  assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  assert.notEqual(canonicalJson({ a: '1' }), canonicalJson({ a: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 1, c: 2 }));
  assert.equal(canonicalJson(undefined), undefined);
  assert.deepEqual(compareManifestFields({}, {}), { ...allSame, files: 'absent' });
  assert.throws(() => compareManifestFields([], manifest), /readback_manifest/);
});

test('only the fixed per-field vocabulary passes into records', () => {
  const fields = { ...allSame, bin: 'different', files: 'absent' };
  assert.deepEqual(judgmentDetail({ manifest_fields: fields }), { manifest_fields: { ...allSame, bin: 'different', files: 'absent' } });
  assert.deepEqual(FIELD_VERDICTS, ['same_ignoring_key_order', 'absent', 'different']);
  for (const detail of [{ manifest_fields: { ...fields, bin: 'npm_SecretLeak' } }, { manifest_fields: { bin: 'different' } },
    { manifest_fields: { ...fields, extra: 'absent' } }, { other: 1 }, 'text', null, undefined]) {
    assert.deepEqual(judgmentDetail(detail), {}, JSON.stringify(detail));
  }
});
