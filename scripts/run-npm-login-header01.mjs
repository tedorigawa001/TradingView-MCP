import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readRegular } from './package-approval.mjs';
import { LIMITS } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { CAPACITY, snapshot } from './prepare-npm-session-release.mjs';
import { LOGIN_ID, PREFLIGHT_ID, LOGIN_POST_BODY, LOGIN_START_PATH, NPM_REGISTRY_HOST,
  loginRequestOptions, loginHeaderBytes } from './npm-session-release.mjs';
import { LOGIN02, approvalRecord, planHash, readRecord, writer } from './run-npm-session-release.mjs';

const KiB = 1024;
export const DIAGNOSTIC_ID = 'package-2026-11-19-publish-0.1.46-login-header01';
const priorPreparation = {
  'reservation.json': { bytes: 568, sha256: '6c2218006eadfb908c6c73c9e6d14cae0d99e6e3c2d399272d25f87afd82dfb5' },
  'inputs.json': { bytes: 2700, sha256: '63d89213f461fd37ec0ce3056567261e546052af249f79a74808c74e2c7a7553' },
  'preparation-tests.json': { bytes: 285, sha256: '7f932772f683bbfd2776bb829507375ac2688399463fb4aa1b7c12d59bdc0681' },
  'preparation-readback.json': { bytes: 515, sha256: 'c22cf36c22f70047ba84746e4b849ede14c92c08e83c07fc0aec82a9ca5aa1cd' },
};
const revisedInputs = 'post-recheck-inputs.json';
const revisedTests = 'post-recheck-tests.json';
const revisedReadback = 'post-recheck-readback.json';
// The original preparation files are now fixed at their verified sizes.
export const CAPS = Object.freeze({
  ...Object.fromEntries(Object.entries(priorPreparation).map(([file, { bytes }]) => [file, bytes])),
  [revisedInputs]: 3200, [revisedTests]: 384, [revisedReadback]: 540,
  'communication-approval.json': 4 * KiB, 'communication-status.json': 2 * KiB, 'communication-readback.json': 2 * KiB });
const preparation = [...Object.keys(priorPreparation), revisedInputs, revisedTests, revisedReadback];
const tests = ['test/release/prepare-npm-preflight.test.mjs', 'test/release/run-npm-preflight.test.mjs',
  'test/release/npm-session-release.test.mjs', 'test/release/run-npm-session-release.test.mjs',
  'test/release/run-npm-login02.test.mjs', 'test/release/run-npm-login-header01.test.mjs'];
const sources = ['scripts/run-npm-login-header01.mjs', 'scripts/npm-session-release.mjs', 'scripts/run-npm-session-release.mjs',
  'scripts/prepare-npm-session-release.mjs', 'scripts/prepare-npm-preflight.mjs', 'scripts/run-npm-preflight.mjs',
  'scripts/package-approval.mjs', 'scripts/package-verifier-core.mjs', ...tests];
const oldStops = {
  [LOGIN_ID]: '78c87158d57bce30b36b75f0c99a9a540150aac7ef9feb942fcb0414f21798e1',
  [LOGIN02.id]: '13ae3217c85db33bdef3aa4bb655c74d14b3b10bb645081680719c86d6bb72ae',
};
const oldReservation = 'c57d106704b92cf85eb6c22f4c0b664dd7425fd19c7b35bd5740851fec4b3719';
const allocation = Object.freeze({ old_cumulative: 50072562, reservation: 16 * KiB, cumulative: 50088946,
  remaining_pool: 31021897, campaign_cap: CAPACITY.cap, preparation: 8 * KiB, communication: 8 * KiB,
  protected_765_bytes_used: 0 });
const scope = Object.freeze({ baseline: LOGIN02.id, added_header: ['npm-auth-type', 'web'], target: NPM_REGISTRY_HOST,
  port: 443, path: LOGIN_START_PATH, method: 'POST', body: LOGIN_POST_BODY, dns_calls: 1, post_attempts: 1,
  recheck_approval_after_dns_before_post: true,
  get_attempts: 0, put_attempts: 0, ipv4_pinned: true, tls_hostname_verified: true, response_fields: ['phase', 'http_status'],
  stop_after_final_headers: true, response_body_processing: false, opens_browser: false, auth_config_read: false,
  may_create_pending_npm_session: true, retry: false, redirects: false });
const timing = Object.freeze({ monotonic_from: 'CLI entry', check_before_dispatch_and_after_readback: true,
  force_os_dns_or_sync_io_to_end: false });
const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sum = values => values.reduce((a, b) => a + b, 0);

function absent(location) {
  try { fs.lstatSync(location); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('diagnostic_scope_already_exists');
}

function checkPreparationFiles(root, expected) {
  const names = fs.readdirSync(root);
  check(names.length === expected.length && names.every(file => expected.includes(file)), 'diagnostic_scope_consumed_or_changed');
}

function inputSnapshot(repo, root) {
  const base = path.dirname(root);
  check(sum(preparation.map(file => CAPS[file])) === allocation.preparation &&
    sum(Object.values(CAPS)) === allocation.reservation && allocation.preparation + allocation.communication === allocation.reservation &&
    allocation.old_cumulative + allocation.reservation === allocation.cumulative &&
    allocation.cumulative + allocation.remaining_pool + CAPACITY.fixed_margin + CAPACITY.unallocated === allocation.campaign_cap, 'capacity_changed');
  for (const [file, expected] of Object.entries(priorPreparation)) {
    readRecord(root, file, CAPS, { file, ...expected });
  }
  const oldCaps = { 'reservation.json': 4 * KiB, 'login-approval.json': 4 * KiB, 'login-status.json': 8 * KiB,
    'login-readback.json': 4 * KiB };
  for (const [id, expected] of Object.entries(oldStops)) {
    const old = path.join(base, id), receipt = readRecord(old, 'login-readback.json', oldCaps);
    check(receipt.evidence.sha256 === expected && receipt.data.status === 'stopped' && receipt.data.verified &&
      receipt.data.completion_proof_sha256 === null && receipt.data.rows.length === 2, 'old_stop_changed');
    const status = readRecord(old, 'login-status.json', oldCaps, receipt.data.rows[1]).data;
    readRecord(old, 'login-approval.json', oldCaps, receipt.data.rows[0]);
    check(status.approval_consumed && status.STOP_preserved && status.protected_765_bytes_used === 0, 'old_stop_unconfirmed');
    if (id === LOGIN02.id) check(status.http_failure?.phase === 'login_post' && status.http_failure.http_status === 401, 'baseline_changed');
  }
  const budget = readRecord(path.join(base, LOGIN02.id), 'reservation.json', oldCaps);
  check(budget.evidence.sha256 === oldReservation && budget.data.allocation.cumulative === allocation.old_cumulative &&
    budget.data.allocation.remaining_pool - allocation.reservation === allocation.remaining_pool, 'prior_capacity_changed');
  const current = snapshot(repo);
  const fingerprints = sources.map(file => [file, sha(readRegular(path.join(repo, file), 64 * KiB))]);
  return { id: DIAGNOSTIC_ID, record_root: root, candidate: current.candidate, artifact_sha256: current.artifact_sha256,
    npm_version: current.npm_version, inventory_sha256: current.inventory_sha256, old_stops: oldStops,
    baseline_reservation_sha256: oldReservation, prior_preparation_readback_sha256: priorPreparation['preparation-readback.json'].sha256,
    tool_paths: sources, tool_fingerprints_sha256: planHash(fingerprints),
    scope, limits: LIMITS, time_contract: timing, allocation, record_limits: CAPS, STOP_preserved: true,
    preflight_approved: false, publication_approved: false };
}

function prepareRevision(repo, root) {
  checkPreparationFiles(root, Object.keys(priorPreparation));
  const first = inputSnapshot(repo, root);
  const disk = writer(root, CAPS);
  const inputs = disk.write(revisedInputs, first);
  const rows = [inputs];
  let passed = 0, after = null, status = 'stopped';
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...tests],
      { cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash(inputSnapshot(repo, root));
    check(after === inputs.sha256, 'preparation_inputs_changed');
    checkPreparationFiles(root, [...Object.keys(priorPreparation), revisedInputs]);
    status = 'prepared';
  } catch { /* Preserve the original preparation and bounded revision records on failure. */ }
  rows.push(disk.write(revisedTests, { id: DIAGNOSTIC_ID, passed, status, network_calls: 0,
    input_before_sha256: inputs.sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write(revisedReadback, { id: DIAGNOSTIC_ID, status, verified: true, rows,
    communication_approval_consumed: false, STOP_preserved: true });
  return { id: DIAGNOSTIC_ID, status, passed, rows, readback, cumulative_reserved: allocation.cumulative };
}

function verifyPreparation(repo, root) {
  const readback = readRecord(root, revisedReadback, CAPS);
  const receipt = readback.data;
  check(receipt.id === DIAGNOSTIC_ID && receipt.status === 'prepared' && receipt.verified &&
    receipt.communication_approval_consumed === false && receipt.STOP_preserved === true && receipt.rows.length === 2, 'preparation_unconfirmed');
  const [inputs, result] = [revisedInputs, revisedTests].map((file, i) => readRecord(root, file, CAPS, receipt.rows[i]));
  check(result.data.id === DIAGNOSTIC_ID &&
    result.data.status === 'prepared' && result.data.passed > 0 && result.data.network_calls === 0 &&
    result.data.input_before_sha256 === inputs.evidence.sha256 && result.data.input_after_sha256 === inputs.evidence.sha256 &&
    planHash(inputSnapshot(repo, root)) === inputs.evidence.sha256, 'preparation_binding_changed');
  const { id, record_root, candidate, artifact_sha256, old_stops, STOP_preserved, prior_preparation_readback_sha256 } = inputs.data;
  const plan = { id, record_root, candidate, artifact_sha256, old_stops, STOP_preserved, scope, limits: LIMITS,
    time_contract: timing, allocation, record_limits: CAPS, preflight_approved: false, publication_approved: false,
    prior_preparation_readback_sha256, inputs_sha256: inputs.evidence.sha256, preparation_tests_sha256: result.evidence.sha256,
    preparation_readback_sha256: readback.evidence.sha256 };
  const doc = approvalRecord(DIAGNOSTIC_ID, plan, planHash(plan));
  check(Buffer.byteLength(JSON.stringify(doc) + '\n') <= CAPS['communication-approval.json'], 'communication_approval_limit');
  return plan;
}

function limited({ now, deadline, ms, timeout, start }) {
  check(now() + ms <= deadline, 'stage_deadline');
  return new Promise((resolve, reject) => {
    const end = Math.min(deadline, now() + ms);
    let settled = false;
    function done(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (now() >= end) reject(Error(timeout));
      else if (error) reject(error);
      else resolve(value);
    }
    const timer = setTimeout(() => done(Error(timeout)), ms);
    try { start(done); } catch { done(Error('transport_error')); }
  });
}

function observePost({ adapter, now, deadline, address, counts }) {
  let req, res, closed = false;
  return limited({ now, deadline, ms: LIMITS.getMs, timeout: 'http_timeout', start(done) {
    let sockets = 0, secure = false;
    const stop = reason => done(Error(reason));
    const options = loginRequestOptions('POST', LOGIN_START_PATH, address, (_host, _options, cb) => {
      counts.refused_additional_lookups++;
      stop('additional_lookup_refused');
      cb(Error('additional_lookup_refused'));
    });
    options.headers['npm-auth-type'] = 'web';
    counts.post_attempts++;
    req = adapter.request(options, incoming => {
      incoming.on('error', () => stop('response_unconfirmed'));
      if (closed) { incoming.destroy(); return; }
      res = incoming;
      if (!secure || sockets !== 1) return stop('tls_peer_unconfirmed');
      const status = res.statusCode;
      if (!Number.isInteger(status) || status < 200 || status > 599) return stop('invalid_final_status');
      if (loginHeaderBytes(status, res.statusMessage, res.rawHeaders) > LIMITS.headerBytes) return stop('response_header_limit');
      const length = res.headers['content-length'];
      const overLimit = length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > LIMITS.bodyBytes);
      // Header-only observation. Do not attach a body reader or parse a response payload.
      done(null, { http_status: status, reason: overLimit ? 'response_body_limit' : null });
      res.destroy();
    });
    req.on('socket', socket => {
      if (++sockets !== 1) { stop('additional_socket_refused'); req.destroy(); return; }
      socket.once('secureConnect', () => { secure = socket.authorized === true && socket.remoteAddress === address; });
    });
    req.once('upgrade', (_response, socket) => { socket.destroy(); stop('http_upgrade_refused'); });
    req.once('error', error => stop(error?.code === 'HPE_HEADER_OVERFLOW' ? 'response_header_limit' : 'transport_error'));
    req.once('close', () => stop('response_unconfirmed'));
    req.end(LOGIN_POST_BODY);
  } }).finally(() => { closed = true; res?.destroy(); req?.destroy(); });
}

const safeReasons = new Set(['stage_deadline', 'dns_timeout', 'dns_unconfirmed', 'http_timeout', 'additional_lookup_refused',
  'additional_socket_refused', 'transport_error', 'tls_peer_unconfirmed', 'invalid_final_status', 'response_header_limit',
  'response_unconfirmed', 'http_upgrade_refused', 'approval_sync_unconfirmed', 'execution_inputs_changed']);

export async function executeDiagnostic({ root, plan, approvedHash, recheck, adapter,
  now = () => performance.now(), startedAt = now() }) {
  const deadline = startedAt + LIMITS.stageMs;
  const approved = approvalRecord(DIAGNOSTIC_ID, plan, approvedHash);
  function confirmInputs() {
    try { check(recheck() === approvedHash, 'execution_inputs_changed'); }
    catch { throw Error('execution_inputs_changed'); }
  }
  confirmInputs();
  check(now() + LIMITS.dnsMs + LIMITS.getMs <= deadline, 'stage_deadline');
  const disk = writer(root, CAPS);
  const rows = [disk.write('communication-approval.json', approved)];
  const counts = { dns_calls: 0, post_attempts: 0, get_attempts: 0, put_attempts: 0, refused_additional_lookups: 0 };
  let phase = 'before_dispatch', httpStatus = null, reason = null;
  try {
    try { disk.syncParent(); } catch { throw Error('approval_sync_unconfirmed'); }
    phase = 'dns';
    const address = await limited({ now, deadline, ms: LIMITS.dnsMs, timeout: 'dns_timeout', start(done) {
      counts.dns_calls++;
      adapter.lookup(NPM_REGISTRY_HOST, { family: 4, all: false }, (error, ip, family) => {
        if (error || family !== 4 || !net.isIPv4(ip)) return done(Error('dns_unconfirmed'));
        done(null, ip);
      });
    } });
    phase = 'before_post';
    confirmInputs();
    phase = 'login_post';
    const result = await observePost({ adapter, now, deadline, address, counts });
    httpStatus = result.http_status;
    reason = result.reason;
    confirmInputs();
    check(now() < deadline, 'stage_deadline');
  } catch (error) { reason = safeReasons.has(error?.message) ? error.message : 'execution_stopped'; }
  const observation = { id: DIAGNOSTIC_ID, approval_sha256: approvedHash, phase, http_status: httpStatus,
    status: reason === null ? 'response_observed' : 'stopped', reason, counts, elapsed_ms_at_status: Math.ceil(now() - startedAt),
    approval_consumed: true, no_retry: true, cumulative_reserved: allocation.cumulative, protected_765_bytes_used: 0,
    STOP_preserved: true, preflight_approved: false, publication_approved: false };
  try {
    rows.push(disk.write('communication-status.json', observation));
    disk.verify(rows);
    const readback = disk.write('communication-readback.json', { id: DIAGNOSTIC_ID, observation_status: observation.status,
      verified: true, rows, approval_consumed: true });
    if (reason === null && now() >= deadline) return { ...observation, status: 'stopped', reason: 'readback_deadline', readback };
    return { ...observation, status: reason === null ? 'diagnostic_complete' : 'stopped', readback };
  } catch { return { ...observation, status: 'stopped', reason: 'record_readback_unconfirmed' }; }
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), base = path.join(repo, '.release-work'), root = path.join(base, DIAGNOSTIC_ID);
  checkTransportEnvironment();
  absent(path.join(base, PREFLIGHT_ID));
  if (mode === '--prepare-post-recheck' && approvedHash === undefined) return prepareRevision(repo, root);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--probe' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'unsupported_mode');
  checkPreparationFiles(root, preparation);
  const plan = verifyPreparation(repo, root);
  if (mode === '--check') return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  return executeDiagnostic({ root, plan, approvedHash, startedAt, recheck: () => planHash(verifyPreparation(repo, root)), adapter: { lookup, request } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped') process.exitCode = 1;
  } catch { console.log(JSON.stringify({ status: 'stopped', reason: 'diagnostic_local_preconditions_unconfirmed' })); process.exitCode = 1; }
}
