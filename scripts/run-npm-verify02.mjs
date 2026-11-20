import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRegular } from './package-approval.mjs';
import { LIMITS } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { CAPACITY } from './prepare-npm-session-release.mjs';
import { NPM_REGISTRY_HOST } from './npm-session-release.mjs';
import { planHash, readRecord, writer } from './run-npm-session-release.mjs';
import { HISTORY as VERIFY01_HISTORY } from './run-npm-verify01.mjs';
import { PLAN as TARBALL, ROUTES, verifyArtifact } from './publish-verified-tarball.mjs';
import { exchange } from './npm-publish-protocol.mjs';

// One approved run of four anonymous, read-only GETs records that 0.1.46 is public
// and byte-identical to the verified artifact. It also records a correction of
// pub02's outcome: pub02 classified the registry's HTTP 202 {"success":true} reply
// to its second PUT as a refusal, although npm treats every status below 400 as
// success. No token, no login, no PUT. verify02 differs from verify01 only in the
// version-metadata judge: the registry omits `files` and does not preserve object
// key order, so manifest objects are compared with their keys sorted.
const KiB = 1024;
export const VERIFY02_ID = 'package-2026-11-20-publish-0.1.46-verify02';
const LOGIN08_ID = 'package-2026-11-20-publish-0.1.46-login08';
const PUB02_ID = 'package-2026-11-20-publish-0.1.46-pub02';
const VERIFY01_ID = 'package-2026-11-20-publish-0.1.46-verify01';
const LOGIN08_CUMULATIVE = 50826226;
const ARTIFACT = '.release-work/package-2026-11-18-reverify-r02/artifact/verified-0.1.46.tgz';
export const SUCCESS_BODY = '{"success":true}';
const preparation = ['reservation.json', 'preparation-inputs.json', 'preparation-tests.json', 'preparation-readback.json'];
export const RECORDS = Object.freeze({ 'reservation.json': 4 * KiB, 'preparation-inputs.json': 16 * KiB,
  'preparation-tests.json': 4 * KiB, 'preparation-readback.json': 4 * KiB, 'approval.json': 8 * KiB, 'version.json': 4 * KiB,
  'tag.json': 4 * KiB, 'tarball.json': 4 * KiB, 'packument.json': 4 * KiB, 'correction.json': 4 * KiB,
  'verification-status.json': 4 * KiB, 'verification-readback.json': 4 * KiB });
export const ALLOCATION = Object.freeze({ prior_cumulative: 50891762, reservation: 64 * KiB, cumulative: 50957298,
  remaining_pool: 30153545, campaign_cap: CAPACITY.cap, records: 64 * KiB, private_session: 0, protected_765_bytes_used: 0 });
// Fixed order; every GET carries the same cache buster so a CDN copy of an
// earlier 404 cannot answer for the current registry state.
export const SLOTS = Object.freeze([
  Object.freeze({ slot: 'version', route: ROUTES.version, accept: 'application/json', limit: 64 * KiB }),
  Object.freeze({ slot: 'tag', route: ROUTES.tag, accept: 'application/json', limit: 4 * KiB }),
  Object.freeze({ slot: 'tarball', route: ROUTES.tarball, accept: 'application/octet-stream', limit: 1024 * KiB }),
  Object.freeze({ slot: 'packument', route: '/' + TARBALL.name, accept: 'application/vnd.npm.install-v1+json', limit: 4096 * KiB }),
]);
export const TESTS = Object.freeze(['test/release/run-npm-verify02.test.mjs', 'test/release/run-npm-verify01.test.mjs', 'test/release/npm-publish-protocol.test.mjs',
  'test/release/packagePublish.test.mjs']);
const sources = ['scripts/run-npm-verify02.mjs', 'scripts/run-npm-verify01.mjs', 'scripts/run-npm-pub02.mjs', 'scripts/run-npm-pub01.mjs', 'scripts/run-npm-prep04.mjs',
  'scripts/npm-publish-protocol.mjs', 'scripts/publish-verified-tarball.mjs', 'scripts/run-npm-session-release.mjs',
  'scripts/prepare-npm-session-release.mjs', 'scripts/prepare-npm-preflight.mjs', 'scripts/run-npm-preflight.mjs',
  'scripts/npm-session-release.mjs', 'scripts/package-approval.mjs', 'scripts/package-verifier-core.mjs', ...TESTS];

// Immutable prior runs: verify01's history (through pub02) plus verify01 itself.
export const HISTORY = Object.freeze({ ...VERIFY01_HISTORY,
  [VERIFY01_ID]: ['verification-readback.json', 'bf4176626d5ca1e667f9de9495aaa105fb8f287bc1a5c8adc0a1611fee48ba69'] });
const verify01Reservation = 'a5cfbd7c0127716b8d787a0d2d5db01417e16c97e5d9ec571d7839f6dea59987';
// verify01 received this exact version document and rejected it only for `files`
// and object key order; a run of this command showed the values themselves match.
const VERIFY01_VERSION_SHA256 = 'a77775aec12d389570ba059a9984ce816348829be680bf667627ca095a6c02fb';
const scope = Object.freeze({ host: NPM_REGISTRY_HOST, dns_calls: 1, get_attempts: SLOTS.length, routes: SLOTS.map(s => s.route),
  authorization: 'none', put_attempts: 0, pinned_address: true, redirects: false, automatic_retry: false,
  cache_buster: 'query t=<UTC ms at run start>, identical for every GET' });
const timeContract = Object.freeze({ stage_ms: LIMITS.stageMs, dns_ms: LIMITS.dnsMs, get_ms: LIMITS.getMs,
  clock: 'monotonic window from CLI entry', utc: 'Date.now on the operator host' });

const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const size = value => Buffer.byteLength(JSON.stringify(value) + '\n');
const total = caps => Object.values(caps).reduce((sum, cap) => sum + cap, 0);
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw Error('verify02_scope_exists');
}

function exactFiles(root, expected) {
  const names = fs.readdirSync(root);
  check(names.length === expected.length && names.every(name => expected.includes(name)), 'verify02_scope_consumed_or_changed');
}

export function checkAllocationArithmetic() {
  const a = ALLOCATION;
  check(total(RECORDS) === a.records && a.records + a.private_session === a.reservation && a.prior_cumulative + a.reservation === a.cumulative &&
    a.cumulative + a.remaining_pool + CAPACITY.fixed_margin + CAPACITY.unallocated === a.campaign_cap && a.protected_765_bytes_used === 0,
  'verify02_allocation_changed');
}

// The new reservation must extend exactly the latest recorded allocation (verify01).
export function checkAllocationChain(previous) {
  checkAllocationArithmetic();
  check(previous && previous.cumulative === ALLOCATION.prior_cumulative && previous.remaining_pool - ALLOCATION.reservation === ALLOCATION.remaining_pool &&
    previous.campaign_cap === ALLOCATION.campaign_cap && previous.protected_765_bytes_used === 0, 'verify02_allocation_changed');
}

function releaseFiles(repo) {
  const artifactBytes = readRegular(path.join(repo, ARTIFACT), 1024 * KiB);
  const checked = verifyArtifact(artifactBytes);
  const manifestBytes = readRegular(path.join(repo, 'package.json'), 64 * KiB);
  const manifest = JSON.parse(manifestBytes);
  check(manifest.name === TARBALL.name && manifest.version === TARBALL.version && !manifest.private, 'verify02_manifest_changed');
  const artifact = { bytes: checked.bytes, sha256: checked.sha256, sha1: createHash('sha1').update(artifactBytes).digest('hex'),
    integrity: checked.integrity };
  return { artifactBytes, artifact, manifest, manifestSha: sha(manifestBytes) };
}

const record = (base, id, file) => JSON.parse(readRegular(path.join(base, id, file), 16 * KiB));

function verifyHistory(base, artifact, manifestSha) {
  for (const [id, [file, anchor]] of Object.entries(HISTORY)) {
    const root = path.join(base, id);
    const bytes = readRegular(path.join(root, file), 16 * KiB);
    check(sha(bytes) === anchor, 'historical_readback_changed');
    const readback = JSON.parse(bytes);
    check(readback.verified === true && Array.isArray(readback.rows) && readback.rows.length >= 2, 'historical_readback_changed');
    for (const row of readback.rows) {
      const data = readRegular(path.join(root, row.file), 16 * KiB);
      check(data.length === row.bytes && sha(data) === row.sha256, 'historical_record_changed');
    }
  }
  // pub02 sent two PUTs; the second, with the web OTP, got HTTP 202 and exactly
  // {"success":true}, which pub02 recorded as refused without any readback.
  const login08 = record(base, LOGIN08_ID, 'login-status.json'), approval = record(base, LOGIN08_ID, 'login-approval.json');
  const status = record(base, PUB02_ID, 'publication-status.json'), confirmation = record(base, PUB02_ID, 'confirmation.json');
  const otp = record(base, PUB02_ID, 'otp.json'), send1 = record(base, PUB02_ID, 'send-1.json'), send2 = record(base, PUB02_ID, 'send-2.json');
  const plan = approval.plan;
  check(login08.status === 'session_verified' && login08.publication_approved === true &&
    login08.cumulative_reserved === LOGIN08_CUMULATIVE && login08.approval_sha256 === approval.approved_hash &&
    planHash(plan) === approval.approved_hash && plan.publication_id === PUB02_ID && status.approval_sha256 === approval.approved_hash &&
    status.status === 'stopped' && status.stage === 'publish' && status.reason === 'publish_http_status_202' &&
    status.outcome === 'refused' && status.otp === 'web' && status.counts.put_attempts === 2 && status.counts.readback_attempts === 0 &&
    confirmation.confirmed === true && otp.result === 'received' &&
    send1.http_status === 401 && send1.kind === 'otp_web' && send1.otp_header === false &&
    send2.http_status === 202 && send2.kind === 'refused' && send2.otp_header === true &&
    send2.response_bytes === Buffer.byteLength(SUCCESS_BODY) && send2.response_sha256 === sha(SUCCESS_BODY) &&
    send1.entity_sha256 === plan.entity.body_sha256 && send2.entity_sha256 === plan.entity.body_sha256, 'prior_run_unconfirmed');
  // The bytes checked below are the ones pub02's approved plan bound.
  const inputs = readRegular(path.join(base, LOGIN08_ID, 'preparation-inputs.json'), 16 * KiB);
  check(sha(inputs) === plan.inputs_sha256 && JSON.parse(inputs).manifest_sha256 === manifestSha &&
    plan.artifact.sha256 === artifact.sha256 && plan.artifact.bytes === artifact.bytes && plan.entity.integrity === artifact.integrity,
  'pub02_binding_changed');
  // verify01 got all four replies, confirmed three and rejected the version document
  // only by its manifest comparison; it wrote no correction.
  const v1 = record(base, VERIFY01_ID, 'verification-status.json'), v1version = record(base, VERIFY01_ID, 'version.json');
  check(v1.status === 'stopped' && v1.reason === 'publication_unconfirmed' && v1.counts.get_attempts === 4 && v1.counts.put_attempts === 0 &&
    v1.verdicts.version === 'mismatch' && v1.verdicts.tag === 'confirmed' && v1.verdicts.tarball === 'confirmed' &&
    v1.verdicts.packument === 'confirmed' && v1.cumulative_reserved === ALLOCATION.prior_cumulative &&
    v1version.http_status === 200 && v1version.reason === 'readback_manifest' && v1version.response_sha256 === VERIFY01_VERSION_SHA256,
  'prior_run_unconfirmed');
  let correction01 = true;
  try { fs.lstatSync(path.join(base, VERIFY01_ID, 'correction.json')); } catch (error) { if (error?.code === 'ENOENT') correction01 = false; }
  check(!correction01, 'prior_run_unconfirmed');
  const reservation = readRegular(path.join(base, VERIFY01_ID, 'reservation.json'), 8 * KiB);
  check(sha(reservation) === verify01Reservation, 'allocation_history_changed');
  checkAllocationChain(JSON.parse(reservation).allocation);
  return { approved_plan_sha256: approval.approved_hash, entity_sha256: plan.entity.body_sha256,
    send_2: { http_status: send2.http_status, response_bytes: send2.response_bytes, response_sha256: send2.response_sha256,
      recorded_kind: send2.kind }, recorded_outcome: status.outcome,
    verify01: { status: v1.status, version_reason: v1version.reason, version_response_sha256: v1version.response_sha256 } };
}

// Deterministic, offline and read-only: re-evaluated before every network dispatch.
export function inputsFor(repo) {
  const base = path.join(repo, '.release-work');
  const { artifact, manifestSha } = releaseFiles(repo);
  const pub02 = verifyHistory(base, artifact, manifestSha);
  return { schema: 'npm-verify02-run-inputs-v1', id: VERIFY02_ID, root: path.join(base, VERIFY02_ID), history: HISTORY,
    verify01_reservation_sha256: verify01Reservation, pub02, artifact: { file: ARTIFACT, ...artifact }, manifest_sha256: manifestSha,
    slots: SLOTS, scope, time_contract: timeContract, allocation: ALLOCATION, record_limits: RECORDS,
    tools: sources.map(file => [file, sha(readRegular(path.join(repo, file), 64 * KiB))]), STOP_preserved: true, publication: false };
}

export function planFor(inputs, records) {
  const { id, root, artifact, pub02 } = inputs;
  return { id, root, artifact, pub02, slots: SLOTS, scope, time_contract: timeContract, allocation: ALLOCATION,
    record_limits_sha256: planHash(RECORDS), ...records, STOP_preserved: true, publication: false };
}

export function approvalRecord(plan, approvedHash) {
  check(plan?.id === VERIFY02_ID && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && planHash(plan) === approvedHash, 'approval_mismatch');
  return { id: VERIFY02_ID, approved_hash: approvedHash, plan, consumed: true, publication_approved: false,
    network: 'anonymous read-only GETs' };
}

export function verifyPreparation(repo, root) {
  const receipt = readRecord(root, 'preparation-readback.json', RECORDS);
  const meta = receipt.data;
  check(meta.id === VERIFY02_ID && meta.verified && meta.status === 'prepared' && meta.execution_approval_consumed === false &&
    meta.STOP_preserved === true && meta.rows.length === 3, 'preparation_unconfirmed');
  const [reservation, inputs, tests] = preparation.slice(0, 3).map((file, i) => readRecord(root, file, RECORDS, meta.rows[i]));
  const r = reservation.data, t = tests.data;
  check(r.id === VERIFY02_ID && r.preparation_approved && r.execution_approved === false && r.STOP_preserved &&
    planHash(r.allocation) === planHash(ALLOCATION) && planHash(r.record_limits) === planHash(RECORDS) &&
    t.id === VERIFY02_ID && t.status === 'prepared' && t.network_calls === 0 && Number.isSafeInteger(t.passed) && t.passed > 0 &&
    t.input_before_sha256 === inputs.evidence.sha256 && t.input_after_sha256 === inputs.evidence.sha256 &&
    planHash(inputsFor(repo)) === inputs.evidence.sha256 && inputs.data.root === root, 'preparation_binding_changed');
  const plan = planFor(inputs.data, { reservation_sha256: reservation.evidence.sha256, inputs_sha256: inputs.evidence.sha256,
    tests_sha256: tests.evidence.sha256, preparation_readback_sha256: receipt.evidence.sha256 });
  check(size(approvalRecord(plan, planHash(plan))) <= RECORDS['approval.json'], 'verify02_approval_record_limit');
  return plan;
}

function prepare(repo) {
  checkAllocationArithmetic();
  const root = path.join(repo, '.release-work', VERIFY02_ID);
  absent(root);
  const inputs = inputsFor(repo);
  check(size(inputs) <= RECORDS['preparation-inputs.json'], 'verify02_preparation_input_limit');
  fs.mkdirSync(root, { mode: 0o700 });
  const disk = writer(root, RECORDS);
  const rows = [disk.write('reservation.json', { id: VERIFY02_ID, allocation: ALLOCATION, record_limits: RECORDS,
    preparation_approved: true, execution_approved: false, STOP_preserved: true })];
  disk.syncParent();
  rows.push(disk.write('preparation-inputs.json', inputs));
  let status = 'stopped', passed = 0, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...TESTS],
      { cwd: repo, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash(inputsFor(repo));
    check(after === rows[1].sha256, 'preparation_inputs_changed');
    exactFiles(root, preparation.slice(0, 2));
    status = 'prepared';
  } catch { /* Preserve the bounded preparation records for a stopped run. */ }
  rows.push(disk.write('preparation-tests.json', { id: VERIFY02_ID, status, passed, network_calls: 0,
    input_before_sha256: rows[1].sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write('preparation-readback.json', { id: VERIFY02_ID, status, verified: true, rows,
    execution_approval_consumed: false, STOP_preserved: true });
  if (status === 'prepared') verifyPreparation(repo, root);
  return { id: VERIFY02_ID, status, passed, readback, cumulative_reserved: ALLOCATION.cumulative, network_calls: 0 };
}

// JSON object key order carries no meaning and the registry does not preserve it;
// array order is kept.
export function canonical(value) {
  const sort = v => Array.isArray(v) ? v.map(sort)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}
export const MANIFEST_KEYS = Object.freeze(['main', 'bin', 'scripts', 'dependencies', 'engines']);
const keyVerdicts = ['same_ignoring_key_order', 'absent', 'different'];

// Each judge returns a small summary or throws a fixed reason code.
export function judges(artifactBytes, manifest) {
  const artifact = verifyArtifact(artifactBytes);
  const sha1 = createHash('sha1').update(artifactBytes).digest('hex');
  const tarballUrl = (value, reason) => {
    let url;
    try { url = new URL(value); } catch { throw Error(reason); }
    check(['https:', 'http:'].includes(url.protocol) && url.hostname === NPM_REGISTRY_HOST && !url.port && !url.username &&
      !url.password && !url.search && !url.hash && url.pathname === ROUTES.tarball, reason);
  };
  return {
    version(bytes) {
      check(Buffer.isBuffer(bytes) && bytes.length <= 64 * KiB, 'metadata_limit');
      let doc;
      try { doc = parse(bytes); } catch { throw Error('readback_version'); }
      check(doc !== null && typeof doc === 'object' && !Array.isArray(doc) && doc.name === TARBALL.name && doc.version === TARBALL.version,
        'readback_version');
      // The registry omits `files`; when present it must still match.
      const keys = {};
      for (const key of MANIFEST_KEYS) keys[key] = canonical(doc[key]) === canonical(manifest[key]) ? 'same_ignoring_key_order' : 'different';
      keys.files = !Object.hasOwn(doc, 'files') ? 'absent' : canonical(doc.files) === canonical(manifest.files) ? 'same_ignoring_key_order' : 'different';
      if (Object.values(keys).includes('different')) throw Object.assign(Error('readback_manifest'), { detail: { manifest_keys: keys } });
      check(doc.dist?.integrity === artifact.integrity && doc.dist?.shasum === sha1, 'readback_integrity');
      tarballUrl(doc.dist.tarball, 'readback_tarball_url');
      return { version: doc.version, integrity: doc.dist.integrity, shasum: sha1, manifest_keys: keys };
    },
    tag(bytes) {
      let tags;
      try { tags = parse(bytes); } catch { throw Error('readback_tag'); }
      check(tags !== null && typeof tags === 'object' && tags.latest === TARBALL.version, 'readback_tag');
      return { latest: tags.latest };
    },
    tarball(bytes) {
      const checked = verifyArtifact(bytes);
      return { bytes: checked.bytes, sha256: checked.sha256 };
    },
    packument(bytes) {
      let doc;
      try { doc = parse(bytes); } catch { throw Error('readback_packument'); }
      const entry = doc?.versions?.[TARBALL.version];
      check(doc?.name === TARBALL.name && doc['dist-tags']?.latest === TARBALL.version && entry?.version === TARBALL.version &&
        entry.dist?.integrity === artifact.integrity && entry.dist?.shasum === sha1, 'readback_packument');
      tarballUrl(entry.dist.tarball, 'readback_packument');
      return { latest: doc['dist-tags'].latest, version_listed: true };
    },
  };
}

const transportCodes = ['request_timeout', 'peer_unconfirmed', 'response_shape', 'header_limit', 'response_encoding', 'body_limit',
  'response_incomplete', 'multiple_sockets', 'transport_error'];
const judgeCodes = ['artifact_identity', 'metadata_limit', 'readback_version', 'readback_manifest', 'readback_integrity',
  'readback_tarball_url', 'readback_tag', 'readback_packument'];
const localCodes = ['execution_inputs_changed', 'stage_deadline', 'verify02_transport_scope', 'utc_clock_unconfirmed', 'dns_timeout',
  'dns_error', 'dns_result_shape', 'record_limit', 'publication_unconfirmed', 'verify02_record_unconfirmed'];
export function safeReason(code) {
  return typeof code === 'string' && (transportCodes.includes(code) || judgeCodes.includes(code) || localCodes.includes(code))
    ? code : 'execution_stopped';
}
const judgeReason = code => judgeCodes.includes(code) ? code : 'response_unconfirmed';
// Only the fixed per-key vocabulary from the version judge may reach a record.
function judgeDetail(detail) {
  const keys = detail?.manifest_keys;
  if (!keys || typeof keys !== 'object') return {};
  const names = [...MANIFEST_KEYS, 'files'];
  return Object.keys(keys).length === names.length && names.every(name => keyVerdicts.includes(keys[name]))
    ? { manifest_keys: Object.fromEntries(names.map(name => [name, keys[name]])) } : {};
}

export function getOptions(address, slot, buster, onLookup) {
  return { hostname: address, servername: NPM_REGISTRY_HOST, port: 443, path: slot.route + buster, method: 'GET', family: 4,
    autoSelectFamily: false, agent: false, rejectUnauthorized: true, maxHeaderSize: LIMITS.headerBytes,
    lookup: (_host, _options, callback) => { onLookup(); callback(Error('additional_lookup_refused')); },
    checkServerIdentity: (_name, cert) => tls.checkServerIdentity(NPM_REGISTRY_HOST, cert),
    headers: { host: NPM_REGISTRY_HOST, accept: slot.accept, 'accept-encoding': 'identity', 'cache-control': 'no-cache', connection: 'close' } };
}

function resolveOnce(adapter) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(Error(error)); else resolve(value);
    };
    const timer = setTimeout(() => finish('dns_timeout'), LIMITS.dnsMs);
    try {
      adapter.lookup(NPM_REGISTRY_HOST, { family: 4, all: false }, (error, address, family) => {
        if (error) return finish('dns_error');
        if (family !== 4 || !net.isIPv4(address)) return finish('dns_result_shape');
        finish(null, address);
      });
    } catch { finish('dns_error'); }
  });
}

export async function executeVerify02Run({ root, plan, approvedHash, recheck, adapter, verify, now = () => performance.now(),
  wall = Date.now, startedAt = now() }) {
  const approval = approvalRecord(plan, approvedHash);
  const deadline = startedAt + LIMITS.stageMs;
  const confirm = () => {
    try { check(recheck() === approvedHash, 'execution_inputs_changed'); }
    catch { throw Error('execution_inputs_changed'); }
  };
  const window = ms => {
    const current = now();
    check(Number.isFinite(current) && current >= startedAt && current + ms <= deadline, 'stage_deadline');
  };
  const utc = () => {
    const value = wall();
    check(Number.isSafeInteger(value) && value > 0, 'utc_clock_unconfirmed');
    return value;
  };
  confirm();
  window(LIMITS.dnsMs + LIMITS.getMs);
  absent(path.join(root, 'approval.json'));
  const startUtc = utc();
  const buster = '?t=' + startUtc;
  const disk = writer(root, RECORDS);
  const rows = [disk.write('approval.json', approval)];
  const counts = { dns_calls: 0, get_attempts: 0, put_attempts: 0, secondary_lookup_attempts: 0 };
  const verdicts = {}, published = {};
  let reason = null;
  try {
    try { disk.syncParent(); } catch { throw Error('verify02_record_unconfirmed'); }
    confirm();
    window(LIMITS.dnsMs + LIMITS.getMs);
    counts.dns_calls++;
    const address = await resolveOnce(adapter);
    for (const slot of SLOTS) {
      confirm();
      window(LIMITS.getMs);
      check(counts.secondary_lookup_attempts === 0, 'verify02_transport_scope');
      const options = getOptions(address, slot, buster, () => { counts.secondary_lookup_attempts++; });
      counts.get_attempts++;
      let response;
      try {
        response = await exchange({ request: adapter.request, options, limit: slot.limit, timeoutMs: LIMITS.getMs, now });
      } catch (error) {
        verdicts[slot.slot] = 'unavailable';
        rows.push(disk.write(slot.slot + '.json', { id: VERIFY02_ID, slot: slot.slot, route: slot.route, http_status: null,
          verdict: 'unavailable', reason: safeReason(error?.message) }));
        continue;
      }
      let verdict = response.status === 404 ? 'absent' : 'mismatch', why = null, detail = {};
      if (response.status === 200) {
        try { detail = verify[slot.slot](response.bytes); verdict = 'confirmed'; }
        catch (error) { why = judgeReason(error?.message); detail = judgeDetail(error?.detail); }
      }
      verdicts[slot.slot] = verdict;
      if (verdict === 'confirmed') published[slot.slot] = detail;
      rows.push(disk.write(slot.slot + '.json', { id: VERIFY02_ID, slot: slot.slot, route: slot.route, http_status: response.status,
        verdict, reason: why, header_bytes: response.headerBytes, response_bytes: response.bytes.length,
        response_sha256: sha(response.bytes), ...detail }));
    }
    check(counts.secondary_lookup_attempts === 0, 'verify02_transport_scope');
    confirm();
    check(SLOTS.every(slot => verdicts[slot.slot] === 'confirmed'), 'publication_unconfirmed');
  } catch (error) { reason = safeReason(error?.message); }
  const status = { id: VERIFY02_ID, approval_sha256: approvedHash, status: reason ? 'stopped' : 'verified', reason, verdicts, counts,
    cache_buster_utc_ms: startUtc, started_at_utc_ms: startUtc, finished_at_utc_ms: wall(), elapsed_ms_at_status: Math.ceil(now() - startedAt),
    approval_consumed: true, no_retry: true, cumulative_reserved: ALLOCATION.cumulative, protected_765_bytes_used: 0,
    STOP_preserved: true, publication: false };
  try {
    if (!reason) {
      rows.push(disk.write('correction.json', { id: VERIFY02_ID, corrects: PUB02_ID,
        pub02_publication_readback_sha256: HISTORY[PUB02_ID][1], pub02_send_2: { ...plan.pub02.send_2, response_body: SUCCESS_BODY },
        recorded_outcome: plan.pub02.recorded_outcome, corrected_outcome: 'accepted_readback_confirmed',
        supersedes_unverified: { id: VERIFY01_ID, readback_sha256: HISTORY[VERIFY01_ID][1],
          cause: 'its version judge required files and object key order, which the registry does not preserve' },
        version_manifest_keys: published.version.manifest_keys,
        published: { name: TARBALL.name, version: TARBALL.version, latest: published.tag.latest, integrity: published.version.integrity,
          shasum: published.version.shasum, tarball_sha256: published.tarball.sha256, packument_lists_version: published.packument.version_listed },
        basis: 'npm treats every HTTP status below 400 as success; this run confirmed the version metadata, latest tag, tarball bytes and install packument',
        pub02_records_unchanged: true }));
    }
    rows.push(disk.write('verification-status.json', status));
    disk.verify(rows);
    const readback = disk.write('verification-readback.json', { id: VERIFY02_ID, status: status.status, rows, verified: true });
    return { ...status, readback };
  } catch {
    return { ...status, status: 'stopped', reason: status.reason ?? 'verify02_record_unconfirmed', record: 'verify02_record_unconfirmed' };
  }
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), root = path.join(repo, '.release-work', VERIFY02_ID);
  checkTransportEnvironment();
  if (mode === '--prepare' && approvedHash === undefined && extra.length === 0) return prepare(repo);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--run' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'verify02_unsupported_mode');
  exactFiles(root, preparation);
  const plan = verifyPreparation(repo, root);
  if (mode === '--check') return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  check(planHash(plan) === approvedHash, 'verify02_approval_mismatch');
  const { artifactBytes, manifest } = releaseFiles(repo);
  return executeVerify02Run({ root, plan, approvedHash, startedAt, adapter: { lookup, request },
    recheck: () => planHash(verifyPreparation(repo, root)), verify: judges(artifactBytes, manifest) });
}

// Fixed, secret-free stop codes for local preconditions; anything else stays generic.
const localStop = /^(?:verify02_[a-z_]+|transport_environment_override|historical_readback_changed|historical_record_changed|prior_run_unconfirmed|pub02_binding_changed|allocation_history_changed|preparation_unconfirmed|preparation_binding_changed|record_changed|record_scope|approval_mismatch|artifact_identity)$/;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped') process.exitCode = 1;
  } catch (error) {
    const reason = localStop.test(error?.message ?? '') ? error.message : 'verify02_local_preconditions_unconfirmed';
    console.log(JSON.stringify({ status: 'stopped', reason }));
    process.exitCode = 1;
  }
}
