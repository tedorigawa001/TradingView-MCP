import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tarballPath } from './npm-registry-judgments.mjs';

// Release-agnostic pieces for npm publication runners after 0.1.46. The 0.1.46
// modules fix their version, routes and artifact; these take the target as an
// argument, so a later release adds only its own runner. Nothing here names a
// version, reads credentials or opens a connection by itself.
const KiB = 1024;
export const ENTITY_LIMIT = 2048 * KiB;
const VERSION = /^(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,213}$/;
const ACCOUNT = /^[a-zA-Z0-9_.-]{1,128}$/;

const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function parseJson(bytes, reason) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error(reason); }
}

// Unscoped name, plain x.y.z version, dist-tag and the publishing account.
export function checkTarget(target) {
  check(isObject(target) && typeof target.name === 'string' && NAME.test(target.name) && typeof target.version === 'string' &&
    VERSION.test(target.version) && typeof target.tag === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(target.tag) &&
    typeof target.account === 'string' && ACCOUNT.test(target.account), 'release_target');
  return target;
}

// -1, 0 or 1 for two plain x.y.z versions.
export function compareVersions(a, b) {
  check(typeof a === 'string' && VERSION.test(a) && typeof b === 'string' && VERSION.test(b), 'version_shape');
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// The four preflight GETs, the publish PUT and the four readback GETs. The
// packument GET shares the publish path but is a GET with the install media type.
export function releaseRoutes(target) {
  const { name, version } = checkTarget(target);
  return Object.freeze({
    preflight: Object.freeze({ account: '/-/whoami', rights: '/-/package/' + name + '/collaborators',
      version: '/' + name + '/' + version, tag: '/-/package/' + name + '/dist-tags' }),
    publish: '/' + name,
    readback: Object.freeze({ version: '/' + name + '/' + version, tag: '/-/package/' + name + '/dist-tags',
      tarball: tarballPath(name, version), packument: '/' + name }),
  });
}

// One preflight reply. The account is compared, never recorded; the version must
// be absent and the current dist-tag strictly below the candidate.
export function summarizePreflight(slot, status, bytes, target) {
  const { account, version, tag } = checkTarget(target);
  check(Buffer.isBuffer(bytes), 'response_shape');
  const value = parseJson(bytes, 'response_json');
  check(isObject(value) || (slot === 'version' && typeof value === 'string'), 'response_shape');
  switch (slot) {
    case 'account':
      check(status === 200 && typeof value.username === 'string' && ACCOUNT.test(value.username), 'account_unconfirmed');
      check(value.username === account, 'session_account_mismatch');
      return { account_matches: true };
    case 'rights':
      // The registry reports raw collaborator permissions ("write"/"read").
      check(status === 200 && Object.hasOwn(value, account) && value[account] === 'write', 'rights_unconfirmed');
      return { account_matches: true, collaborator_permission: 'write', token_publish_permission: 'unconfirmed' };
    case 'version': {
      const message = typeof value === 'string' ? value : value.error;
      const escaped = version.replace(/\./g, '\\.');
      check(status === 404 && typeof message === 'string' &&
        (new RegExp('^version not found:\\s*' + escaped + '\\s*$', 'i').test(message) ||
         new RegExp('^no match found for version ' + escaped + '\\s*$', 'i').test(message)), 'version_availability_unconfirmed');
      return { version, exists: false };
    }
    case 'tag': {
      check(status === 200 && typeof value[tag] === 'string' && VERSION.test(value[tag]), 'latest_unconfirmed');
      check(compareVersions(value[tag], version) < 0, 'latest_at_or_above_candidate');
      return { [tag]: value[tag] };
    }
    default: throw Error('unknown_slot');
  }
}

// Exact bytes of the verified artifact, with the digests npm publishes.
export function verifyArtifactBytes(bytes, expected) {
  check(Buffer.isBuffer(bytes) && isObject(expected) && bytes.length === expected.bytes && sha(bytes) === expected.sha256,
    'artifact_identity');
  return { bytes: bytes.length, sha256: sha(bytes), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    shasum: createHash('sha1').update(bytes).digest('hex') };
}

// The PUT body must carry exactly one version, one attachment equal to the
// artifact, the artifact's digests and the manifest fields npm copies.
export function verifyPublishEntity(body, artifact, manifest, expected, target) {
  const { name, version, tag } = checkTarget(target);
  const digests = verifyArtifactBytes(artifact, expected);
  check(Buffer.isBuffer(body) && body.length <= ENTITY_LIMIT, 'entity_limit');
  const m = parseJson(body, 'entity_json');
  check(isObject(m), 'entity_json');
  const v = m.versions?.[version], names = Object.keys(m._attachments ?? {}), file = name + '-' + version + '.tgz';
  check(m.name === name && m._id === name && m.access === 'public' && m['dist-tags']?.[tag] === version &&
    Object.keys(m['dist-tags']).length === 1, 'entity_target');
  check(Object.keys(m.versions ?? {}).length === 1 && v?.name === name && v.version === version, 'entity_version');
  check(names.length === 1 && names[0] === file, 'entity_attachments');
  const a = m._attachments[file];
  check(a.content_type === 'application/octet-stream' && a.length === artifact.length && typeof a.data === 'string', 'attachment_shape');
  const decoded = Buffer.from(a.data, 'base64');
  check(decoded.toString('base64') === a.data && decoded.equals(artifact), 'attachment_identity');
  check(v.dist?.integrity === digests.integrity && v.dist?.shasum === digests.shasum, 'attachment_integrity');
  for (const key of ['files', 'main', 'bin', 'scripts', 'dependencies', 'engines']) check(same(v[key], manifest[key]), 'entity_manifest');
  return { bytes: body.length, sha256: sha(body), integrity: digests.integrity, shasum: digests.shasum };
}

export const npmRoot = (execPath = process.execPath) => path.resolve(path.dirname(execPath), '../lib/node_modules/npm');

// npm's own publisher builds the PUT body offline: its fetch module is replaced
// before load, so no request, retry, cache or lifecycle code runs. Every module
// it loads must be in the B input manifest's npm group, with the same bytes.
export async function buildPublishEntity(artifact, manifest, { expected, target, npmGroup, npmVersion }) {
  checkTarget(target);
  verifyArtifactBytes(artifact, expected);
  check(isObject(manifest) && manifest.name === target.name && manifest.version === target.version && !manifest.private &&
    !Object.hasOwn(manifest, 'tag'), 'manifest_target');
  const root = npmRoot();
  check(isObject(npmGroup) && npmGroup.name === 'npm' && path.resolve(npmGroup.root) === root && Array.isArray(npmGroup.files),
    'publisher_npm_root');
  const allowed = new Map(npmGroup.files.map(([p, n, h]) => [path.resolve(root, p), { bytes: n, hash: h }]));
  const bound = file => {
    const want = allowed.get(file);
    check(want, 'publisher_loaded_input_outside_manifest');
    const bytes = fs.readFileSync(file);
    check(bytes.length === want.bytes && createHash('sha256').update(bytes).digest('base64') === want.hash, 'publisher_loaded_input_changed');
    return bytes;
  };
  const npmPackage = JSON.parse(bound(path.join(root, 'package.json')));
  check(npmPackage.name === 'npm' && npmPackage.version === npmVersion, 'publisher_npm_version');
  const require = createRequire(path.join(root, 'package.json'));
  const publishPath = require.resolve('libnpmpublish/lib/publish.js'), fetchPath = require.resolve('npm-registry-fetch');
  const savedPublish = require.cache[publishPath], savedFetch = require.cache[fetchPath];
  let captured = null, calls = 0;
  const intercept = async (route, opts) => {
    calls++;
    check(calls === 1 && route === target.name && opts.method === 'PUT' && opts.provenance === false && opts.stage === false &&
      opts.retry?.retries === 0 && opts.fetchRetries === 0 && opts.redirect === 'manual', 'builder_transport');
    captured = Buffer.from(JSON.stringify(opts.body));
    return { status: 200 };
  };
  intercept.pickRegistry = () => 'https://registry.npmjs.org/';
  try {
    require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: intercept };
    delete require.cache[publishPath];
    const publish = require(publishPath);
    await publish(structuredClone(manifest), Buffer.from(artifact), {
      registry: 'https://registry.npmjs.org/', access: 'public', defaultTag: target.tag, npmVersion,
      provenance: false, provenanceFile: undefined, stage: false, retry: { retries: 0 }, fetchRetries: 0,
      redirect: 'manual', timeout: 60000, ignoreScripts: true, cache: false,
    });
    check(calls === 1 && captured, 'builder_call_count');
    // Every module in the process's CommonJS cache, not only the new ones.
    const loaded = Object.keys(require.cache).sort()
      .map(file => { const bytes = bound(file); return { path: file, bytes: bytes.length, sha256: sha(bytes) }; });
    check(loaded.length > 0, 'publisher_modules_unconfirmed');
    const proof = verifyPublishEntity(captured, artifact, manifest, expected, target);
    return { body: captured, proof, loaded_modules: { count: loaded.length, sha256: sha(JSON.stringify(loaded)), all_bound_to_B_inventory: true } };
  } finally {
    if (savedFetch) require.cache[fetchPath] = savedFetch; else delete require.cache[fetchPath];
    if (savedPublish) require.cache[publishPath] = savedPublish; else delete require.cache[publishPath];
  }
}

// The registry transport after login: one DNS lookup, then only the dispatches the
// current phase allows, all on the pinned address. Every dispatch first runs `before`.
// A second PUT needs one passage through `otp`: web (with its poll path) or classic.
const transitions = Object.freeze({ preflight: ['publish'], publish: ['otp', 'readback'], otp: ['publish'], readback: [] });
export function registryTransport({ adapter, before, gate = work => work(), routes, host, limits, maxOtpPolls, maxPuts = 2 }) {
  const scope = 'release_transport_scope';
  const counts = { dns_calls: 0, get_attempts: 0, put_attempts: 0, otp_poll_attempts: 0, readback_attempts: 0, secondary_lookup_attempts: 0 };
  const preflightRoutes = Object.values(routes.preflight), readbackRoutes = Object.values(routes.readback);
  const readbackUsed = new Set();
  let address, phase = 'preflight', preflightIndex = 0, otpPath = null, challenged = false;
  return { counts,
    get address() { return address; },
    get phase() { return phase; },
    enter(next, extra = {}) {
      check(transitions[phase].includes(next), scope);
      if (next === 'otp') {
        check(!challenged && counts.put_attempts === 1, scope);
        if (extra.classic === true) check(extra.poll === undefined, scope);
        else {
          check(typeof extra.poll === 'string' && /^\/-\/v1\/done(?:[/?]|$)/.test(extra.poll), scope);
          otpPath = extra.poll;
        }
        challenged = true;
      }
      if (next === 'publish' && phase === 'preflight') check(preflightIndex === preflightRoutes.length, scope);
      phase = next;
    },
    lookup(name, options, callback) {
      gate(() => {
        before(limits.dnsMs);
        check(phase === 'preflight' && counts.dns_calls === 0 && name === host && options?.family === 4 && options.all === false, scope);
      });
      counts.dns_calls++;
      return adapter.lookup(name, options, (error, value, family) => {
        if (!error && family === 4 && net.isIPv4(value)) address = value;
        callback(error, value, family);
      });
    },
    request(options, callback) {
      const put = options?.method === 'PUT';
      gate(() => {
        before(put ? limits.putMs : limits.getMs);
        check(counts.dns_calls === 1 && counts.secondary_lookup_attempts === 0 && address && options.hostname === address &&
          options.servername === host && options.port === 443 && options.family === 4 && options.agent === false &&
          options.autoSelectFamily === false && options.rejectUnauthorized === true && options.maxHeaderSize === limits.headerBytes &&
          typeof options.headers?.authorization === 'string' && typeof options.lookup === 'function' &&
          typeof options.checkServerIdentity === 'function', scope);
        if (phase === 'publish') {
          check(put && counts.put_attempts < maxPuts && (counts.put_attempts === 0 || challenged) && options.path === routes.publish, scope);
        }
        else {
          check(!put && options.method === 'GET', scope);
          if (phase === 'preflight') check(preflightIndex < preflightRoutes.length && options.path === preflightRoutes[preflightIndex], scope);
          else if (phase === 'otp') check(counts.otp_poll_attempts < maxOtpPolls && options.path === otpPath, scope);
          else check(readbackRoutes.includes(options.path) && !readbackUsed.has(options.path), scope);
        }
      });
      if (put) counts.put_attempts++;
      else {
        counts.get_attempts++;
        if (phase === 'preflight') preflightIndex++;
        else if (phase === 'otp') counts.otp_poll_attempts++;
        else { readbackUsed.add(options.path); counts.readback_attempts++; }
      }
      const refuse = options.lookup;
      return adapter.request({ ...options, lookup: (...args) => { counts.secondary_lookup_attempts++; return refuse(...args); } }, callback);
    },
    preflightComplete() {
      check(phase === 'preflight' && counts.dns_calls === 1 && preflightIndex === preflightRoutes.length && counts.put_attempts === 0 &&
        counts.secondary_lookup_attempts === 0, scope);
    },
  };
}

// not_sent (no PUT dispatched), refused (every dispatched PUT got a definitive
// 4xx), unknown (a PUT went unanswered or got a non-definitive reply and readback
// did not confirm it), unanswered_readback_confirmed, accepted_readback_confirmed,
// accepted_readback_unconfirmed.
export function publicationOutcome({ dispatched, accepted, unanswered, readbackConfirmed }) {
  if (dispatched === 0) return 'not_sent';
  if (accepted) return readbackConfirmed ? 'accepted_readback_confirmed' : 'accepted_readback_unconfirmed';
  if (unanswered) return readbackConfirmed ? 'unanswered_readback_confirmed' : 'unknown';
  return 'refused';
}

// Surrounding whitespace (including a full-width IME space) is ignored; the phrase itself is exact.
export function confirmedPhrase(text, phrase) {
  return typeof text === 'string' && typeof phrase === 'string' && phrase.length > 0 && text.trim() === phrase;
}

function readLine(fd, limit) {
  const bytes = [];
  const one = Buffer.alloc(1);
  while (bytes.length < limit) {
    if (fs.readSync(fd, one, 0, 1, null) !== 1) break;
    if (one[0] === 0x0a) break;
    bytes.push(one[0]);
  }
  return Buffer.from(bytes).toString('utf8').replace(/\r$/, '');
}

// The first non-blank line, at most `limit` bytes; blank lines (stray Enter) are skipped.
export function readAnswer(fd, limit) {
  for (let i = 0; i < 8; i++) {
    const line = readLine(fd, limit);
    if (line.trim() !== '') return line;
  }
  return '';
}

// Discard complete lines typed ahead (for example Enter pressed during the browser
// login) so they cannot answer a later prompt.
export function drainTypeAhead() {
  let fd;
  try { fd = fs.openSync('/dev/tty', fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOCTTY); } catch { return; }
  try {
    const sink = Buffer.alloc(4096);
    for (let i = 0; i < 16 && fs.readSync(fd, sink, 0, sink.length, null) > 0; i++);
  } catch { /* EAGAIN: nothing pending. */ } finally { fs.closeSync(fd); }
}
