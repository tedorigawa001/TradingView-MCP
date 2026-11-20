import { otpEndpoints } from './npm-publish-protocol.mjs';

// Judgments about npm registry replies, corrected after the 0.1.46 release.
// - pub02's second PUT got HTTP 202 with {"success":true}. npm 11 treats every
//   status below 400 as success (npm-registry-fetch check-response), but
//   classifyPut in npm-publish-protocol.mjs accepted only 200 and 201 and
//   recorded a refusal.
// - verify01 rejected the version document because verifyReadbackMetadata in
//   publish-verified-tarball.mjs required `files` and package.json's object key
//   order. The registry omits `files` from version documents and does not keep
//   object key order.
// The executed runners keep their original logic as bound in their records;
// later runners import these judgments instead. Nothing here is release-specific:
// the package target is passed in.
const KiB = 1024;
export const REGISTRY_HOST = 'registry.npmjs.org';
export const VERSION_DOCUMENT_LIMIT = 64 * KiB;
export const MANIFEST_FIELDS = Object.freeze(['main', 'bin', 'scripts', 'dependencies', 'engines']);
export const FIELD_VERDICTS = Object.freeze(['same_ignoring_key_order', 'absent', 'different']);

const check = (value, reason) => { if (!value) throw Error(reason); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return undefined; }
}

function parseObject(bytes, reason) {
  check(Buffer.isBuffer(bytes), reason);
  const value = parseJson(bytes);
  check(isObject(value), reason);
  return value;
}

const authTokens = value => typeof value === 'string' ? value.split(/,\s*/).map(part => part.trim().toLowerCase()) : [];

// A publish PUT reply. Every 2xx is accepted, as npm accepts it. This tooling
// never follows redirects, and a 1xx, 3xx or 5xx may come after the registry
// processed the PUT, so those stay unknown until read-only readback decides.
// Only a 4xx is a definitive refusal; a 401 may instead ask for a one-time
// password, exactly as npm 11 detects it.
export function classifyPublishReply(response) {
  const { status, headers = {}, bytes = Buffer.alloc(0) } = response ?? {};
  check(Number.isInteger(status) && status >= 100 && status <= 599, 'publish_response_shape');
  if (status >= 200 && status <= 299) return { kind: 'accepted', status };
  if (status < 400 || status >= 500) return { kind: 'unknown', status, reason: 'publish_http_status_' + status };
  if (status === 401) {
    const auth = authTokens(headers['www-authenticate']);
    if (auth.includes('ipaddress')) return { kind: 'refused', status, reason: 'publish_auth_ip_address' };
    const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : '';
    if (auth.includes('otp') || (!headers['www-authenticate'] && /one-time pass/.test(text))) {
      const body = Buffer.isBuffer(bytes) ? parseJson(bytes) : undefined;
      if (isObject(body) && typeof body.authUrl === 'string' && typeof body.doneUrl === 'string') {
        return { kind: 'otp_web', status, ...otpEndpoints(body.authUrl, body.doneUrl) };
      }
      return { kind: 'otp_classic', status };
    }
  }
  return { kind: 'refused', status, reason: 'publish_http_status_' + status };
}

// JSON with object keys sorted at every depth; array order is kept.
export function canonicalJson(value) {
  const sort = v => Array.isArray(v) ? v.map(sort)
    : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, sort(v[key])])) : v;
  return JSON.stringify(sort(value));
}

// Per-field verdicts for a registry document against package.json. `files` may
// be absent because the registry drops it; any other field must be present
// exactly when package.json has it.
export function compareManifestFields(doc, manifest) {
  check(isObject(doc) && isObject(manifest), 'readback_manifest');
  const fields = {};
  for (const key of MANIFEST_FIELDS) {
    fields[key] = canonicalJson(doc[key]) === canonicalJson(manifest[key]) ? 'same_ignoring_key_order' : 'different';
  }
  fields.files = !Object.hasOwn(doc, 'files') ? 'absent'
    : canonicalJson(doc.files) === canonicalJson(manifest.files) ? 'same_ignoring_key_order' : 'different';
  return fields;
}

// Only the fixed per-field vocabulary may reach a record.
export function judgmentDetail(detail) {
  const fields = detail?.manifest_fields;
  const names = [...MANIFEST_FIELDS, 'files'];
  if (!isObject(fields) || Object.keys(fields).length !== names.length || !names.every(name => FIELD_VERDICTS.includes(fields[name]))) return {};
  return { manifest_fields: Object.fromEntries(names.map(name => [name, fields[name]])) };
}

export function tarballPath(name, version) {
  check(typeof name === 'string' && /^(?:@[a-z0-9][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/.test(name) &&
    typeof version === 'string' && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]{1,64})?$/.test(version),
  'package_target');
  return '/' + name + '/-/' + name.split('/').pop() + '-' + version + '.tgz';
}

function checkTarget(target) {
  check(isObject(target) && typeof target.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(target.integrity) &&
    typeof target.shasum === 'string' && /^[0-9a-f]{40}$/.test(target.shasum), 'package_target');
  return tarballPath(target.name, target.version);
}

function tarballUrl(value, path, reason) {
  let url;
  try { url = new URL(value); } catch { throw Error(reason); }
  check(['https:', 'http:'].includes(url.protocol) && url.hostname === REGISTRY_HOST && !url.port && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname === path, reason);
}

// GET /<name>/<version>: name, version, the five manifest fields, dist.integrity,
// dist.shasum and the tarball URL. Throws a fixed code; readback_manifest carries
// the per-field verdicts in `detail`.
export function verifyVersionDocument(bytes, target, manifest) {
  const path = checkTarget(target);
  check(isObject(manifest) && manifest.name === target.name && manifest.version === target.version, 'manifest_target');
  check(Buffer.isBuffer(bytes) && bytes.length <= VERSION_DOCUMENT_LIMIT, 'metadata_limit');
  const doc = parseObject(bytes, 'readback_version');
  check(doc.name === target.name && doc.version === target.version, 'readback_version');
  const fields = compareManifestFields(doc, manifest);
  if (Object.values(fields).includes('different')) throw Object.assign(Error('readback_manifest'), { detail: { manifest_fields: fields } });
  check(doc.dist?.integrity === target.integrity && doc.dist?.shasum === target.shasum, 'readback_integrity');
  tarballUrl(doc.dist.tarball, path, 'readback_tarball_url');
  return { version: doc.version, integrity: doc.dist.integrity, shasum: doc.dist.shasum, manifest_fields: fields };
}

// GET /-/package/<name>/dist-tags
export function verifyDistTags(bytes, target, tag = 'latest') {
  checkTarget(target);
  const tags = parseObject(bytes, 'readback_tag');
  check(typeof tag === 'string' && tags[tag] === target.version, 'readback_tag');
  return { [tag]: tags[tag] };
}

// GET /<name> with the abbreviated install media type: what `npm install` reads.
export function verifyInstallPackument(bytes, target, tag = 'latest') {
  const path = checkTarget(target);
  const doc = parseObject(bytes, 'readback_packument');
  const entry = doc.versions?.[target.version];
  check(doc.name === target.name && doc['dist-tags']?.[tag] === target.version && isObject(entry) && entry.version === target.version &&
    entry.dist?.integrity === target.integrity && entry.dist?.shasum === target.shasum, 'readback_packument');
  tarballUrl(entry.dist.tarball, path, 'readback_packument');
  return { [tag]: doc['dist-tags'][tag], version_listed: true };
}
