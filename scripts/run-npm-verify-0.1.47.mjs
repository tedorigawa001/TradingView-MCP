import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { readRegular } from './package-approval.mjs';
import { LIMITS } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { NPM_REGISTRY_HOST } from './npm-session-release.mjs';
import { planHash, readRecord, writer } from './run-npm-session-release.mjs';
import { exchange } from './npm-publish-protocol.mjs';
import { judgmentDetail } from './npm-registry-judgments.mjs';
import { ALLOCATION as RELEASE_ALLOCATION, EVIDENCE, LOGIN_ID, PLAN_TARGET, PUB_ID, ROUTES, checkRuntime, readbackJudges,
  releaseFiles } from './run-npm-release-0.1.47.mjs';

// One approved run of four anonymous, read-only GETs records that 0.1.47 is public
// and byte-identical to the verified artifact. pub01 published it (HTTP 202
// {"success":true} to the second PUT) but read back 30 seconds later, before the
// registry served the new version, so its outcome is accepted_readback_unconfirmed.
// No token, no login, no PUT. Every GET carries the same cache buster so a CDN copy
// of pub01's early 404 cannot answer for the current registry state.
const KiB = 1024;
export const VERIFY_ID = 'package-2026-11-22-publish-0.1.47-verify01';
export const SUCCESS_BODY = '{"success":true}';
export const PUBLICATION_APPROVAL = '01278a0fd226bf2419c73d78e1c43dc846f2d6c462d6abb1bf71342439010bbf';
export const ENTITY_SHA256 = 'f94f38ff33c7e34afc684aa0a9bf784c9f1a82f296868f48692f52f271f4dd41';
// The completed login and publication runs, anchored by their readback records.
export const HISTORY = Object.freeze({
  [LOGIN_ID]: Object.freeze(['login-readback.json', '3c7b7ad046ae3d8c233cf2e45cad372baa4226611081e5a94891bb439efe21d0']),
  [PUB_ID]: Object.freeze(['publication-readback.json', '1a980beccd9a8de41ed6873d7860df413945935a8534fe290bd86abf244a774f']),
});
export const RECORDS = Object.freeze({ 'reservation.json': 4 * KiB, 'preparation-inputs.json': 16 * KiB,
  'preparation-tests.json': 4 * KiB, 'preparation-readback.json': 4 * KiB, 'approval.json': 16 * KiB, 'version.json': 4 * KiB,
  'tag.json': 4 * KiB, 'tarball.json': 4 * KiB, 'packument.json': 4 * KiB, 'verification-status.json': 4 * KiB,
  'verification-readback.json': 4 * KiB });
// The second use of the campaign's release-stage share, after login01 and pub01.
export const ALLOCATION = Object.freeze({ release_stages_reserved: RELEASE_ALLOCATION.release_stages_reserved,
  prior_release_stage_use: RELEASE_ALLOCATION.release_stage_cumulative, reservation: 68 * KiB,
  release_stage_cumulative: RELEASE_ALLOCATION.release_stage_cumulative + 68 * KiB,
  release_stage_remaining: RELEASE_ALLOCATION.release_stages_reserved - RELEASE_ALLOCATION.release_stage_cumulative - 68 * KiB,
  campaign_cap: RELEASE_ALLOCATION.campaign_cap, campaign_sha256: RELEASE_ALLOCATION.campaign_sha256, private_session: 0,
  protected_765_bytes_used: 0 });
export const SLOTS = Object.freeze([
  Object.freeze({ slot: 'version', route: ROUTES.readback.version, accept: 'application/json', limit: 64 * KiB }),
  Object.freeze({ slot: 'tag', route: ROUTES.readback.tag, accept: 'application/json', limit: 4 * KiB }),
  Object.freeze({ slot: 'tarball', route: ROUTES.readback.tarball, accept: 'application/octet-stream', limit: 1024 * KiB }),
  Object.freeze({ slot: 'packument', route: ROUTES.readback.packument, accept: 'application/vnd.npm.install-v1+json', limit: 4096 * KiB }),
]);
export const TESTS = Object.freeze(['test/release/run-npm-verify-0.1.47.test.mjs', 'test/release/run-npm-release-0.1.47.test.mjs',
  'test/release/npm-release-kit.test.mjs', 'test/release/npm-registry-judgments.test.mjs', 'test/release/npm-publish-protocol.test.mjs']);
const sources = ['scripts/run-npm-verify-0.1.47.mjs', 'scripts/run-npm-release-0.1.47.mjs', 'scripts/npm-release-kit.mjs',
  'scripts/npm-registry-judgments.mjs', 'scripts/npm-publish-protocol.mjs', 'scripts/npm-login04-protocol.mjs',
  'scripts/npm-session-release.mjs', 'scripts/run-npm-session-release.mjs', 'scripts/prepare-npm-session-release.mjs',
  'scripts/run-npm-preflight.mjs', 'scripts/prepare-npm-preflight.mjs', 'scripts/publish-verified-tarball.mjs',
  'scripts/package-approval.mjs', 'scripts/package-verifier-core.mjs', ...TESTS];
const preparation = ['reservation.json', 'preparation-inputs.json', 'preparation-tests.json', 'preparation-readback.json'];
const scope = Object.freeze({ host: NPM_REGISTRY_HOST, dns_calls: 1, get_attempts: SLOTS.length, routes: SLOTS.map(s => s.route),
  authorization: 'none', put_attempts: 0, pinned_address: true, redirects: false, automatic_retry: false,
  cache_buster: 'query t=<UTC ms at run start>, identical for every GET' });
const timeContract = Object.freeze({ stage_ms: LIMITS.stageMs, dns_ms: LIMITS.dnsMs, get_ms: LIMITS.getMs,
  clock: 'monotonic window from CLI entry', utc: 'Date.now on the operator host' });

const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const size = value => Buffer.byteLength(JSON.stringify(value) + '\n');
const total = caps => Object.values(caps).reduce((sum, n) => sum + n, 0);

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw Error('verify_scope_exists');
}

function exactFiles(root, expected) {
  const names = fs.readdirSync(root);
  check(names.length === expected.length && names.every(name => expected.includes(name)), 'verify_scope_consumed_or_changed');
}

export function checkAllocation() {
  const a = ALLOCATION;
  check(total(RECORDS) === a.reservation && a.prior_release_stage_use + a.reservation === a.release_stage_cumulative &&
    a.release_stage_cumulative + a.release_stage_remaining === a.release_stages_reserved && a.release_stage_remaining > 0 &&
    a.prior_release_stage_use === RELEASE_ALLOCATION.release_stage_cumulative && a.protected_765_bytes_used === 0, 'verify_allocation_changed');
}

// The login and publication records exactly as pub01 left them: published, with
// the second PUT accepted by HTTP 202 {"success":true}, and readback unconfirmed.
export function verifyHistory(base, { history = HISTORY, approval = PUBLICATION_APPROVAL, entity = ENTITY_SHA256 } = {}) {
  const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  for (const [id, [file, anchor]] of Object.entries(history)) {
    const root = path.join(base, id);
    const bytes = readRegular(path.join(root, file), 16 * KiB);
    check(sha(bytes) === anchor, 'historical_readback_changed');
    const readback = parse(bytes);
    check(readback.verified === true && Array.isArray(readback.rows) && readback.rows.length >= 2, 'historical_readback_changed');
    for (const row of readback.rows) {
      const data = readRegular(path.join(root, row.file), 64 * KiB);
      check(data.length === row.bytes && sha(data) === row.sha256, 'historical_record_changed');
    }
  }
  const [loginId, pubId] = Object.keys(history);
  const read = (id, file) => parse(readRegular(path.join(base, id, file), 16 * KiB));
  const login = read(loginId, 'login-status.json'), status = read(pubId, 'publication-status.json');
  const send2 = read(pubId, 'send-2.json'), send1 = read(pubId, 'send-1.json');
  check(login.status === 'session_verified' && login.approval_sha256 === approval && login.reason === null &&
    status.status === 'published' && status.outcome === 'accepted_readback_unconfirmed' && status.put_reply === 'accepted' &&
    status.approval_sha256 === approval && status.reason === null && status.record_gap === false && status.readback_confirmed === false &&
    status.counts?.put_attempts === 2 && send1.kind === 'otp_web' && send1.http_status === 401 && send1.entity_sha256 === entity &&
    send2.kind === 'accepted' && send2.http_status === 202 && send2.otp_header === true && send2.entity_sha256 === entity &&
    send2.response_bytes === SUCCESS_BODY.length && send2.response_sha256 === sha(SUCCESS_BODY), 'prior_run_unconfirmed');
  return { publication_readback_sha256: history[pubId][1], login_readback_sha256: history[loginId][1],
    recorded_outcome: status.outcome, put_reply: status.put_reply,
    send_2: { http_status: send2.http_status, response_bytes: send2.response_bytes, response_sha256: send2.response_sha256 } };
}

export function inputsFor(repo) {
  const base = path.join(repo, '.release-work');
  const publication = verifyHistory(base);
  const { digests, manifestSha } = releaseFiles(repo);
  return { schema: 'npm-release-verify-inputs-v1', id: VERIFY_ID, root: path.join(base, VERIFY_ID), target: PLAN_TARGET,
    slots: SLOTS, history: HISTORY, publication, artifact: { file: EVIDENCE.artifact.file, ...digests },
    manifest_sha256: manifestSha, allocation: ALLOCATION, record_limits: RECORDS, scope, time_contract: timeContract,
    tools: sources.map(file => [file, sha(readRegular(path.join(repo, file), 128 * KiB))]), STOP_preserved: true };
}

export function planFor(inputs, records) {
  const { id, root, target, slots, history, publication, artifact, manifest_sha256 } = inputs;
  return { id, root, target, slots, history, publication, artifact, manifest_sha256, allocation: ALLOCATION, scope,
    time_contract: timeContract, record_limits_sha256: planHash(inputs.record_limits), ...records, STOP_preserved: true,
    publication_performed: false };
}

export function approvalRecord(plan, approvedHash) {
  check(plan?.id === VERIFY_ID && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && planHash(plan) === approvedHash, 'approval_mismatch');
  return { id: VERIFY_ID, approved_hash: approvedHash, plan, consumed: true };
}

export function verifyPreparation(repo, root) {
  const receipt = readRecord(root, 'preparation-readback.json', RECORDS);
  const meta = receipt.data;
  check(meta.id === VERIFY_ID && meta.verified && meta.status === 'prepared' && meta.execution_approval_consumed === false &&
    meta.STOP_preserved === true && meta.rows.length === 3, 'preparation_unconfirmed');
  const [reservation, inputs, tests] = preparation.slice(0, 3).map((file, i) => readRecord(root, file, RECORDS, meta.rows[i]));
  const r = reservation.data, t = tests.data;
  check(r.id === VERIFY_ID && r.preparation_approved && r.execution_approved === false && r.STOP_preserved &&
    planHash(r.allocation) === planHash(ALLOCATION) && planHash(r.record_limits) === planHash(RECORDS) &&
    t.id === VERIFY_ID && t.status === 'prepared' && t.network_calls === 0 && Number.isSafeInteger(t.passed) && t.passed > 0 &&
    t.input_before_sha256 === inputs.evidence.sha256 && t.input_after_sha256 === inputs.evidence.sha256 &&
    planHash(inputsFor(repo)) === inputs.evidence.sha256 && inputs.data.root === root, 'preparation_binding_changed');
  const plan = planFor(inputs.data, { reservation_sha256: reservation.evidence.sha256, inputs_sha256: inputs.evidence.sha256,
    tests_sha256: tests.evidence.sha256, preparation_readback_sha256: receipt.evidence.sha256 });
  check(size(approvalRecord(plan, planHash(plan))) <= RECORDS['approval.json'], 'verify_approval_record_limit');
  return plan;
}

async function prepare(repo) {
  checkAllocation();
  const root = path.join(repo, '.release-work', VERIFY_ID);
  absent(root);
  const inputs = inputsFor(repo);
  check(size(inputs) <= RECORDS['preparation-inputs.json'], 'verify_preparation_input_limit');
  fs.mkdirSync(root, { mode: 0o700 });
  const disk = writer(root, RECORDS);
  const rows = [disk.write('reservation.json', { id: VERIFY_ID, allocation: ALLOCATION, record_limits: RECORDS,
    preparation_approved: true, execution_approved: false, STOP_preserved: true })];
  disk.syncParent();
  rows.push(disk.write('preparation-inputs.json', inputs));
  let status = 'stopped', passed = 0, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...TESTS],
      { cwd: repo, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * KiB, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', TMPDIR: os.tmpdir(), NODE_DISABLE_COMPILE_CACHE: '1' } });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash(inputsFor(repo));
    check(after === rows[1].sha256, 'preparation_inputs_changed');
    exactFiles(root, preparation.slice(0, 2));
    status = 'prepared';
  } catch { /* Preserve the bounded preparation records for a stopped run. */ }
  rows.push(disk.write('preparation-tests.json', { id: VERIFY_ID, status, passed, network_calls: 0,
    input_before_sha256: rows[1].sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write('preparation-readback.json', { id: VERIFY_ID, status, verified: true, rows,
    execution_approval_consumed: false, STOP_preserved: true });
  if (status === 'prepared') verifyPreparation(repo, root);
  return { id: VERIFY_ID, status, passed, readback, release_stage_cumulative: ALLOCATION.release_stage_cumulative, network_calls: 0 };
}

// Anonymous: no authorization header. The address is pinned and the certificate
// must name the registry host.
export function getOptions(address, slot, buster, onLookup) {
  return { hostname: address, servername: NPM_REGISTRY_HOST, port: 443, path: slot.route + buster, method: 'GET', family: 4,
    autoSelectFamily: false, agent: false, rejectUnauthorized: true, maxHeaderSize: LIMITS.headerBytes,
    lookup: (_host, _options, callback) => { onLookup(); callback(Error('additional_lookup_refused')); },
    checkServerIdentity: (_name, cert) => tls.checkServerIdentity(NPM_REGISTRY_HOST, cert),
    headers: { host: NPM_REGISTRY_HOST, accept: slot.accept, 'accept-encoding': 'identity', 'cache-control': 'no-cache', connection: 'close' } };
}

// The DNS clock starts after the lookup call returns, not before the caller's recheck.
function resolveOnce(adapter) {
  return new Promise((resolve, reject) => {
    let done = false, timer;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(Error(error)); else resolve(value);
    };
    try {
      adapter.lookup(NPM_REGISTRY_HOST, { family: 4, all: false }, (error, address, family) => {
        if (error) return finish('dns_error');
        if (family !== 4 || !net.isIPv4(address)) return finish('dns_result_shape');
        finish(null, address);
      });
    } catch { finish('dns_error'); return; }
    if (!done) timer = setTimeout(() => finish('dns_timeout'), LIMITS.dnsMs);
  });
}

const transportCodes = ['peer_unconfirmed', 'response_shape', 'header_limit', 'response_encoding', 'body_limit', 'response_incomplete',
  'request_timeout', 'multiple_sockets', 'transport_error'];
const judgeCodes = ['readback_version', 'readback_manifest', 'readback_integrity', 'readback_tarball_url', 'readback_tag',
  'readback_packument', 'metadata_limit', 'manifest_target', 'package_target', 'artifact_identity'];
const localCodes = ['execution_inputs_changed', 'stage_deadline', 'verify_transport_scope', 'utc_clock_unconfirmed', 'dns_timeout',
  'dns_error', 'dns_result_shape', 'record_limit', 'publication_unconfirmed', 'verify_record_unconfirmed'];
export function safeReason(code) {
  return typeof code === 'string' && (transportCodes.includes(code) || judgeCodes.includes(code) || localCodes.includes(code))
    ? code : 'execution_stopped';
}

export async function executeVerify({ root, plan, approvedHash, recheck, adapter, judges, now = () => performance.now(),
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
    try { disk.syncParent(); } catch { throw Error('verify_record_unconfirmed'); }
    confirm();
    window(LIMITS.dnsMs + LIMITS.getMs);
    counts.dns_calls++;
    const address = await resolveOnce(adapter);
    for (const slot of SLOTS) {
      confirm();
      window(LIMITS.getMs);
      check(counts.secondary_lookup_attempts === 0, 'verify_transport_scope');
      const options = getOptions(address, slot, buster, () => { counts.secondary_lookup_attempts++; });
      counts.get_attempts++;
      let response;
      try {
        response = await exchange({ request: adapter.request, options, limit: slot.limit, timeoutMs: LIMITS.getMs, now });
      } catch (error) {
        verdicts[slot.slot] = 'unavailable';
        rows.push(disk.write(slot.slot + '.json', { id: VERIFY_ID, slot: slot.slot, route: slot.route, http_status: null,
          verdict: 'unavailable', reason: safeReason(error?.message) }));
        continue;
      }
      let verdict = response.status === 404 ? 'absent' : 'mismatch', why = null, detail = {};
      if (response.status === 200) {
        try { published[slot.slot] = judges[slot.slot](response.bytes); verdict = 'confirmed'; }
        catch (error) { why = judgeCodes.includes(error?.message) ? error.message : 'response_unconfirmed'; detail = judgmentDetail(error?.detail); }
      }
      verdicts[slot.slot] = verdict;
      rows.push(disk.write(slot.slot + '.json', { id: VERIFY_ID, slot: slot.slot, route: slot.route, http_status: response.status,
        verdict, reason: why, ...detail, header_bytes: response.headerBytes, response_bytes: response.bytes.length,
        response_sha256: sha(response.bytes) }));
    }
    check(counts.secondary_lookup_attempts === 0, 'verify_transport_scope');
    confirm();
    check(SLOTS.every(slot => verdicts[slot.slot] === 'confirmed'), 'publication_unconfirmed');
  } catch (error) { reason = safeReason(error?.message); }
  const confirmed = reason === null;
  const status = { id: VERIFY_ID, approval_sha256: approvedHash, status: confirmed ? 'verified' : 'stopped', reason, verdicts, counts,
    cache_buster_utc_ms: startUtc, started_at_utc_ms: startUtc, finished_at_utc_ms: (() => { try { return utc(); } catch { return null; } })(),
    elapsed_ms_at_status: Math.ceil(now() - startedAt),
    ...(confirmed && { published: { name: PLAN_TARGET.name, version: PLAN_TARGET.version, [PLAN_TARGET.tag]: published.tag[PLAN_TARGET.tag],
      integrity: published.version.integrity, shasum: published.version.shasum, tarball_sha256: published.tarball.sha256,
      packument_lists_version: published.packument.version_listed, version_manifest_fields: published.version.manifest_fields },
    pub01_outcome: { recorded: plan.publication.recorded_outcome, confirmed_by_readback: 'accepted_readback_confirmed' } }),
    approval_consumed: true, no_retry: true, release_stage_cumulative: ALLOCATION.release_stage_cumulative,
    protected_765_bytes_used: 0, STOP_preserved: true, publication_performed: false };
  try {
    rows.push(disk.write('verification-status.json', status));
    disk.verify(rows);
    const readback = disk.write('verification-readback.json', { id: VERIFY_ID, status: status.status, rows, verified: true });
    return { ...status, readback };
  } catch {
    return { ...status, status: 'stopped', reason: status.reason ?? 'verify_record_unconfirmed', record: 'verify_record_unconfirmed' };
  }
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), root = path.join(repo, '.release-work', VERIFY_ID);
  checkTransportEnvironment();
  checkRuntime();
  if (mode === '--prepare' && approvedHash === undefined && extra.length === 0) return prepare(repo);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--run' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'verify_unsupported_mode');
  checkAllocation();
  exactFiles(root, preparation);
  const plan = verifyPreparation(repo, root);
  if (mode === '--check') return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  check(planHash(plan) === approvedHash, 'approval_mismatch');
  const files = releaseFiles(repo);
  return executeVerify({ root, plan, approvedHash, startedAt, adapter: { lookup, request },
    recheck: () => planHash(verifyPreparation(repo, root)), judges: readbackJudges(files) });
}

// Fixed, secret-free stop codes for local preconditions; anything else stays generic.
const localStop = /^(?:verify_[a-z_]+|release_[a-z_]+|transport_environment_override|historical_readback_changed|historical_record_changed|prior_run_unconfirmed|preparation_unconfirmed|preparation_binding_changed|record_changed|record_scope|approval_mismatch|artifact_identity|manifest_target)$/;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped') process.exitCode = 1;
  } catch (error) {
    const reason = localStop.test(error?.message ?? '') ? error.message : 'verify_local_preconditions_unconfirmed';
    console.log(JSON.stringify({ status: 'stopped', reason }));
    process.exitCode = 1;
  }
}
