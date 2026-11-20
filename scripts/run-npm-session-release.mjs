import fs from 'node:fs';
import path from 'node:path';
import { isatty } from 'node:tty';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRegular } from './package-approval.mjs';
import { LIMITS, ROUTES } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { LOGIN_ID, PREFLIGHT_ID, SESSION_ROOT, MAX_POLLS, privateSessionIdentity, inspectPrivateSession,
  writePrivateSession, runWebLogin, runWebLogin02, runSessionPreflight, loginHttpFailure } from './npm-session-release.mjs';
import { A_RECORDS, B_RECORDS, CAPACITY, snapshot, snapshotForPreflightRebind } from './prepare-npm-session-release.mjs';

const KiB = 1024;
const registry = 'registry.npmjs.org';
const sessionMs = 2 * 60 * 60 * 1000;
const sourceFiles = ['scripts/run-npm-session-release.mjs', 'test/release/run-npm-session-release.test.mjs'];
const originals = {
  'reservation.json': 'ca5f41c8c6ceb710921f1c65d4cecd85cd564efd2cd356d19f54fab5a90329ae',
  'preparation-inputs.json': '7f56a90fc62657b38ce656769ba6071bc6a9ebcf3db234ba118d275f6681633b',
  'preparation-tests.json': 'e7d411f3d617a4d0f6d7c7021623306193a0b7cc8655bc5f3789b7b1063f2a76',
  'preparation-readback.json': 'c5984226aec7c9881f9723e67ef86f94c62dabc17ece9fe41934d0a1dfef39b1',
};
const priorRuntime = {
  'runtime-inputs.json': '123aa469796fded50621ebdde8d8ae91733caa4e9e610db17d4f56251ef83df8',
  'runtime-tests.json': 'a779a0f72767fd4682d37b22237989206d90a441c73b1ba077baf498b8c844d5',
  'runtime-readback.json': 'aa99c7403c9a87ff15cb6203191512762412ea0dace0e144fabcc6caf6670538',
};
const updateInputs = 'runtime-update-inputs.json';
const updateTests = 'runtime-update-tests.json';
const updateReadback = 'runtime-update-readback.json';
export const runtimeLimits = Object.freeze({ ...A_RECORDS, 'preparation-inputs.json': 4 * KiB,
  'preparation-tests.json': 2 * KiB, 'preparation-readback.json': KiB,
  'runtime-inputs.json': 6 * KiB, 'runtime-tests.json': 6 * KiB, 'runtime-readback.json': 2 * KiB,
  [updateInputs]: 5 * KiB, [updateTests]: KiB, [updateReadback]: KiB });
const priorNames = [...Object.keys(originals), ...Object.keys(priorRuntime)];
const runtimeNames = [...priorNames, updateInputs, updateTests, updateReadback];
const timeContract = Object.freeze({ limit_ms: LIMITS.stageMs, clock: 'monotonic from CLI main entry',
  dispatch: 'Refuse a new DNS or HTTPS attempt when its full timeout would exceed the deadline.',
  confirmation: 'Issue the completion proof only if final record readback finishes before the deadline.',
  process_exit: 'Synchronous local I/O and an operating-system DNS lookup already in progress may finish later. No process termination deadline is enforced.' });
export const LOGIN02 = Object.freeze({
  id: 'package-2026-11-19-publish-0.1.46-login02',
  sessionRoot: '/private/tmp/TradingView-MCP-npm-0.1.46-login02',
  caps: A_RECORDS,
  cumulativeReserved: CAPACITY.cumulative + 64 * KiB,
  syncParent: true,
  runProtocol: runWebLogin02,
});
const login01 = Object.freeze({ id: LOGIN_ID, caps: runtimeLimits, cumulativeReserved: CAPACITY.cumulative,
  syncParent: false, runProtocol: runWebLogin });
const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
export const planHash = value => sha(encode(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function fileEvidence(file, bytes) { return { file, bytes: bytes.length, sha256: sha(bytes) }; }

export function readRecord(root, file, caps, anchor) {
  check(Object.hasOwn(caps, file), 'record_scope');
  const bytes = readRegular(path.join(root, file), caps[file]);
  const evidence = fileEvidence(file, bytes);
  check(!anchor || same(evidence, anchor), 'record_changed');
  return { data: JSON.parse(bytes), evidence };
}

function stateOf(root) {
  const stat = fs.lstatSync(root, { bigint: true });
  check(stat.isDirectory(), 'record_directory_unconfirmed');
  return [stat.dev, stat.ino];
}

export function writer(root, caps) {
  const parent = path.dirname(root);
  const rootId = stateOf(root), parentId = stateOf(parent);
  function pinned() {
    const a = stateOf(root), b = stateOf(parent);
    check(a[0] === rootId[0] && a[1] === rootId[1] && b[0] === parentId[0] && b[1] === parentId[1], 'record_directory_changed');
  }
  function syncDirectory(location, identity) {
    const dir = fs.openSync(location, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(dir, { bigint: true });
      check(stat.dev === identity[0] && stat.ino === identity[1], 'record_directory_changed');
      fs.fsyncSync(dir);
    } finally { fs.closeSync(dir); }
  }
  return {
    write(file, data) {
      const bytes = encode(data);
      check(Object.hasOwn(caps, file) && bytes.length <= caps[file], 'record_limit');
      pinned();
      const fd = fs.openSync(path.join(root, file), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      syncDirectory(root, rootId);
      const evidence = fileEvidence(file, bytes);
      pinned();
      return readRecord(root, file, caps, evidence).evidence;
    },
    syncParent() { pinned(); syncDirectory(parent, parentId); pinned(); },
    verify(rows) { pinned(); for (const row of rows) readRecord(root, row.file, caps, row); },
  };
}

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw Error('scope_already_consumed');
}

function exactFiles(root, expected) {
  const names = fs.readdirSync(root);
  check(names.length === expected.length && names.every(name => expected.includes(name)), 'scope_already_consumed_or_changed');
}

function verifyAllocation() {
  const sum = caps => Object.values(caps).reduce((a, b) => a + b, 0);
  check(sum(runtimeLimits) + CAPACITY.credential === CAPACITY.phase_a &&
    sum(B_RECORDS) === CAPACITY.phase_b && CAPACITY.protected_765_bytes_used === 0, 'runtime_capacity_changed');
}

function runtimeSnapshot(repo, root) {
  verifyAllocation();
  const historical = Object.fromEntries(Object.entries({ ...originals, ...priorRuntime }).map(([file, anchor]) => {
    const record = readRecord(root, file, runtimeLimits);
    check(record.evidence.sha256 === anchor, 'offline_evidence_changed');
    return [file, record];
  }));
  const { tools: oldTools, ...old } = historical['preparation-inputs.json'].data;
  const { tools, ...current } = snapshot(repo);
  check(same(old, current) && tools.length === oldTools.length && tools.every((tool, i) => tool.file === oldTools[i].file &&
    (tool.file === 'scripts/npm-session-release.mjs' || same(tool, oldTools[i]))), 'original_preparation_inputs_changed');
  const oldRunner = 'scripts/run-npm-preflight.mjs';
  const runnerBytes = readRegular(path.join(repo, oldRunner), 64 * KiB);
  check(sha(runnerBytes) === '0c4f23a5d89c69dd94015a64d997f21dfac0c5a17d6361693ec0d8ad3ca6bbab', 'transport_guard_changed');
  for (const file of sourceFiles) tools.push(fileEvidence(file, readRegular(path.join(repo, file), 64 * KiB)));
  tools.push(fileEvidence(oldRunner, runnerBytes));
  const previousTools = historical['runtime-inputs.json'].data.tools;
  check(tools.length === previousTools.length && tools.every((tool, i) => tool.file === previousTools[i].file &&
    (sourceFiles.includes(tool.file) || same(tool, previousTools[i]))), 'runtime_tools_changed_outside_update');
  return { ...current, schema: 'npm-session-runtime-inputs-v2', tools, originals, prior_runtime: priorRuntime,
    runtime_limits: runtimeLimits, spare_a_bytes: 0,
    handoff: 'validated URL to local operator terminal only; operator completes browser authentication',
    preflight_session: 'successful login receipt, final completion proof and private config identity',
    session_max_ms: sessionMs, time_contract: timeContract, preflight_parent_sync_required: true };
}

function roots(repo) {
  const base = path.join(repo, '.release-work');
  return { loginRoot: path.join(base, LOGIN_ID), preflightRoot: path.join(base, PREFLIGHT_ID), sessionRoot: SESSION_ROOT };
}

function prepareRuntimeUpdate(repo, { loginRoot, preflightRoot, sessionRoot }) {
  exactFiles(loginRoot, priorNames);
  for (const location of [preflightRoot, sessionRoot]) absent(location);
  const first = runtimeSnapshot(repo, loginRoot);
  const disk = writer(loginRoot, runtimeLimits);
  const rows = [disk.write(updateInputs, first)];
  let pass = 0, after = null, status = 'stopped';
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap',
      'test/release/npm-session-release.test.mjs', 'test/release/run-npm-session-release.test.mjs'],
    { cwd: repo, encoding: 'utf8', timeout: 20000, maxBuffer: 16 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    pass = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(pass) && pass > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'runtime_tests_unconfirmed');
    after = planHash(runtimeSnapshot(repo, loginRoot));
    check(after === rows[0].sha256, 'runtime_inputs_changed');
    for (const location of [preflightRoot, sessionRoot, path.join(loginRoot, 'login-approval.json')]) absent(location);
    status = 'runtime_prepared';
  } catch { /* Preserve the consumed preparation record on any failure. */ }
  rows.push(disk.write(updateTests, { pass, status, input_before_sha256: rows[0].sha256, input_after_sha256: after, network_calls: 0 }));
  disk.verify(rows);
  const readback = disk.write(updateReadback, { status, verified: true, rows, login_approval_consumed: false, preflight_approval_consumed: false });
  return { status, pass, rows, readback, cumulative_reserved: CAPACITY.cumulative };
}

function runtimePlan(repo, loginRoot) {
  const result = readRecord(loginRoot, updateReadback, runtimeLimits);
  const readback = result.data;
  check(readback.status === 'runtime_prepared' && readback.verified === true && readback.rows.length === 2 &&
    readback.login_approval_consumed === false && readback.preflight_approval_consumed === false, 'runtime_not_prepared');
  const inputs = readRecord(loginRoot, updateInputs, runtimeLimits, readback.rows[0]);
  const tests = readRecord(loginRoot, updateTests, runtimeLimits, readback.rows[1]).data;
  check(tests.status === 'runtime_prepared' && tests.network_calls === 0 && tests.pass > 0 &&
    tests.input_before_sha256 === inputs.evidence.sha256 && tests.input_after_sha256 === inputs.evidence.sha256 &&
    planHash(runtimeSnapshot(repo, loginRoot)) === inputs.evidence.sha256, 'runtime_binding_changed');
  return { id: LOGIN_ID, phase: 'login_only', inputs_sha256: inputs.evidence.sha256,
    runtime_readback_sha256: result.evidence.sha256, candidate: inputs.data.candidate, artifact_sha256: inputs.data.artifact_sha256,
    session_file: inputs.data.local_session_path, account: inputs.data.account, limits: LIMITS, time_contract: timeContract, scope: inputs.data.login,
    cumulative_reserved: CAPACITY.cumulative, protected_765_bytes_used: 0, publication_approved: false, STOP_preserved: true };
}

function recordStatus({ id, approvedHash, status, reason, counts, elapsed, cumulativeReserved = CAPACITY.cumulative }) {
  return { id, approval_sha256: approvedHash, status, reason, counts, elapsed_ms_at_status: Math.ceil(elapsed),
    approval_consumed: true, no_retry: true, cumulative_reserved: cumulativeReserved,
    STOP_preserved: true, protected_765_bytes_used: 0, publication_approved: false };
}

function guardedTransport(phase, adapter, now, deadline) {
  const counts = { dns_calls: 0, post_attempts: 0, get_attempts: 0, put_attempts: 0, secondary_lookup_attempts: 0 };
  const routes = Object.values(ROUTES);
  let address, loginPoll;
  function available(ms) { check(now() + ms <= deadline, 'stage_deadline'); }
  return { counts,
    lookup(host, options, cb) {
      available(LIMITS.dnsMs);
      check(counts.dns_calls === 0 && host === registry && options.family === 4 && !options.all, 'dns_scope');
      counts.dns_calls++;
      return adapter.lookup(host, options, (err, ip, family) => { if (!err) address = ip; cb(err, ip, family); });
    },
    request(options, cb) {
      available(LIMITS.getMs);
      check(counts.dns_calls === 1 && counts.secondary_lookup_attempts === 0 && options.hostname === address &&
        options.servername === registry && options.port === 443 && options.agent === false && options.family === 4 &&
        options.autoSelectFamily === false && options.rejectUnauthorized && options.maxHeaderSize === LIMITS.headerBytes, 'transport_scope');
      if (options.method === 'POST') {
        check(phase === 'login' && counts.post_attempts === 0 && options.path === '/-/v1/login' && !options.headers.authorization, 'post_scope');
        counts.post_attempts++;
      } else {
        check(options.method === 'GET', 'method_scope');
        if (phase === 'login') {
          loginPoll ??= options.path;
          check(counts.post_attempts === 1 && counts.get_attempts < MAX_POLLS && options.path === loginPoll &&
            /^\/-\/v1\/done[/?]/.test(loginPoll) && !options.headers.authorization, 'poll_scope');
        } else {
          check(counts.get_attempts < routes.length && options.path === routes[counts.get_attempts], 'preflight_scope');
        }
        counts.get_attempts++;
      }
      const rejectLookup = options.lookup;
      return adapter.request({ ...options, lookup: (...args) => { counts.secondary_lookup_attempts++; return rejectLookup(...args); } }, cb);
    }
  };
}

const safeReason = /^(?:login_(?:url_rejected|dns_unconfirmed|dns_timeout|peer_unconfirmed|second_dns|header_limit|http_status|response_encoding|body_limit|response_incomplete|multiple_sockets|transport_error|request_timeout|response_json|response_shape|duplicate_json_key|parent_sync_unconfirmed|stage_timeout|browser_handoff_failed|session_unconfirmed|session_save_failed|poll_limit|poll_interval_unconfirmed|poll_wait_failed)|http_status_[1-5][0-9]{2}|session_account_mismatch|session_path_changed|stage_deadline|execution_inputs_changed)$/;
function reasonOf(error) {
  const reason = error?.message;
  return reason === 'preflight_parent_sync_unconfirmed' || safeReason.test(reason) ? reason : 'execution_stopped';
}
function clock(now, startedAt) {
  const deadline = startedAt + LIMITS.stageMs;
  return { deadline, elapsed: () => now() - startedAt,
    active() { check(Number.isFinite(now()) && now() >= startedAt && now() < deadline, 'stage_deadline'); } };
}

export function approvalRecord(id, plan, approvedHash) {
  check(plan.id === id && hex(approvedHash) && planHash(plan) === approvedHash, 'approval_mismatch');
  return { id, approved_hash: approvedHash, plan, consumed: true, publication_approved: false };
}

function enroll(disk, file, id, plan, approvedHash) { return disk.write(file, approvalRecord(id, plan, approvedHash)); }

async function executeScopedLogin({ loginRoot, sessionRoot, plan, approvedHash, recheck, adapter, beginBrowser, sleep,
  now = () => performance.now(), startedAt = now(), wall = Date.now }, scope) {
  const { id, caps, cumulativeReserved } = scope;
  const time = clock(now, startedAt);
  const wallStart = wall();
  check(plan.id === id && approvedHash === planHash(plan) && recheck() === approvedHash, 'approval_mismatch');
  for (const file of ['login-approval.json', 'login-status.json', 'login-readback.json']) absent(path.join(loginRoot, file));
  absent(sessionRoot);
  time.active();
  const disk = writer(loginRoot, caps);
  const rows = [enroll(disk, 'login-approval.json', id, plan, approvedHash)];
  const route = guardedTransport('login', adapter, now, time.deadline);
  let status = 'stopped', reason = null, config = null, wallEnd = null, httpFailure;
  try {
    if (scope.syncParent) {
      try { disk.syncParent(); }
      catch { throw Error('login_parent_sync_unconfirmed'); }
    }
    await scope.runProtocol({ ...route, beginBrowser, sleep, now, deadline: time.deadline, writeSession(token) {
      time.active();
      writePrivateSession(sessionRoot, token);
      const observed = inspectPrivateSession(sessionRoot);
      check(observed.token === token, 'session_path_changed');
      config = observed.identity;
    } });
    check(config && same(config, privateSessionIdentity(sessionRoot)), 'session_path_changed');
    check(recheck() === approvedHash && route.counts.secondary_lookup_attempts === 0 && route.counts.post_attempts === 1 &&
      route.counts.get_attempts > 0 && route.counts.get_attempts <= MAX_POLLS, 'execution_inputs_changed');
    time.active();
    wallEnd = wall();
    check(Number.isSafeInteger(wallStart) && Number.isSafeInteger(wallEnd) && wallEnd >= wallStart && wallEnd - wallStart < LIMITS.stageMs, 'stage_deadline');
    status = 'login_confirmed';
  } catch (error) {
    reason = reasonOf(error);
    httpFailure = loginHttpFailure(error);
  }
  const summary = recordStatus({ id, approvedHash, status, reason, counts: route.counts, elapsed: time.elapsed(), cumulativeReserved });
  if (httpFailure) summary.http_failure = httpFailure;
  const proof = status === 'login_confirmed' ? randomBytes(32).toString('hex') : null;
  try {
    rows.push(disk.write('login-status.json', { ...summary, session_identity: status === 'login_confirmed' ? config : null,
      started_at_ms: wallStart, confirmed_at_ms: wallEnd, local_deadline_ms: wallStart + sessionMs }));
    disk.verify(rows);
    if (proof) time.active();
    const readback = disk.write('login-readback.json', { id, status, approval_sha256: approvedHash, rows, verified: true,
      completion_proof_sha256: proof ? sha(proof) : null, publication_approved: false });
    if (proof) time.active();
    return { ...summary, readback, completion_proof: proof };
  } catch { return { ...summary, status: 'stopped', reason: 'login_completion_unconfirmed', completion_proof: null }; }
}

export function executeLogin(options) { return executeScopedLogin(options, login01); }
export function executeLogin02(options) { return executeScopedLogin(options, LOGIN02); }

export function loadLoginBinding({ loginRoot, sessionRoot, proof, loginPlanHash, wall = Date.now }) {
  const final = readRecord(loginRoot, 'login-readback.json', runtimeLimits);
  const readback = final.data;
  check(hex(proof) && readback.id === LOGIN_ID && readback.status === 'login_confirmed' && readback.verified === true &&
    readback.completion_proof_sha256 === sha(proof) && readback.approval_sha256 === loginPlanHash &&
    readback.publication_approved === false && readback.rows.length === 2, 'login_completion_unconfirmed');
  const approval = readRecord(loginRoot, 'login-approval.json', runtimeLimits, readback.rows[0]).data;
  const status = readRecord(loginRoot, 'login-status.json', runtimeLimits, readback.rows[1]).data;
  check(approval.id === LOGIN_ID && approval.consumed && approval.approved_hash === loginPlanHash &&
    planHash(approval.plan) === loginPlanHash && status.id === LOGIN_ID && status.approval_sha256 === loginPlanHash &&
    status.status === 'login_confirmed' && status.STOP_preserved && !status.publication_approved &&
    Number.isSafeInteger(status.elapsed_ms_at_status) && status.elapsed_ms_at_status >= 0 && status.elapsed_ms_at_status <= LIMITS.stageMs &&
    Number.isSafeInteger(status.started_at_ms) && Number.isSafeInteger(status.confirmed_at_ms) &&
    status.local_deadline_ms === status.started_at_ms + sessionMs, 'login_record_binding');
  const now = wall();
  check(status.started_at_ms <= status.confirmed_at_ms && status.confirmed_at_ms <= now && now < status.local_deadline_ms,
    'session_time_unconfirmed');
  check(same(status.session_identity, privateSessionIdentity(sessionRoot)), 'session_path_changed');
  return { login_id: LOGIN_ID, login_approval_sha256: loginPlanHash, login_readback_sha256: final.evidence.sha256,
    session_identity: status.session_identity, expires_local_ms: status.local_deadline_ms };
}

export async function executePreflight({ loginRoot, preflightRoot, sessionRoot, plan, approvedHash, proof, recheck, adapter,
  now = () => performance.now(), startedAt = now(), wall = Date.now }) {
  const time = clock(now, startedAt);
  check(plan.id === PREFLIGHT_ID && planHash(plan) === approvedHash && recheck() === approvedHash, 'approval_mismatch');
  const loginPlanHash = plan.binding.login_approval_sha256;
  const bindingNow = () => loadLoginBinding({ loginRoot, sessionRoot, proof, loginPlanHash, wall });
  check(same(bindingNow(), plan.binding), 'login_binding_changed');
  time.active();
  fs.mkdirSync(preflightRoot, { mode: 0o700 });
  const disk = writer(preflightRoot, B_RECORDS);
  const rows = [enroll(disk, 'approval-preflight.json', PREFLIGHT_ID, plan, approvedHash)];
  const route = guardedTransport('preflight', adapter, now, time.deadline);
  let status = 'stopped', reason = null, parentSynced = false;
  try {
    rows.push(disk.write('login-binding.json', plan.binding));
    try { disk.syncParent(); }
    catch { throw Error('preflight_parent_sync_unconfirmed'); }
    parentSynced = true;
    const current = inspectPrivateSession(sessionRoot);
    check(same(current.identity, plan.binding.session_identity), 'session_path_changed');
    function sessionUnchanged() {
      check(wall() < plan.binding.expires_local_ms && same(current.identity, privateSessionIdentity(sessionRoot)), 'session_path_changed');
    }
    await runSessionPreflight({ ...route, now, token: current.token, lookup(...args) {
      sessionUnchanged();
      return route.lookup(...args);
    }, request(...args) {
      sessionUnchanged();
      return route.request(...args);
    }, record(slot, summary) {
      time.active();
      check(route.counts.secondary_lookup_attempts === 0, 'execution_inputs_changed');
      rows.push(disk.write(slot + '.json', { id: PREFLIGHT_ID, slot, ...summary }));
    } });
    check(route.counts.dns_calls === 1 && route.counts.get_attempts === 4 && route.counts.secondary_lookup_attempts === 0 &&
      same(bindingNow(), plan.binding) && recheck() === approvedHash, 'execution_inputs_changed');
    time.active();
    status = 'queries_confirmed';
  } catch (error) { reason = reasonOf(error); }
  const summary = { ...recordStatus({ id: PREFLIGHT_ID, approvedHash, status, reason, counts: route.counts, elapsed: time.elapsed() }),
    parent_directory_synced: parentSynced };
  const completionProof = status === 'queries_confirmed' ? randomBytes(32).toString('hex') : null;
  try {
    rows.push(disk.write('preflight-status.json', summary));
    disk.verify(rows);
    if (status === 'queries_confirmed') time.active();
    const readback = disk.write('preflight-readback.json', { id: PREFLIGHT_ID, status, rows, verified: true,
      completion_proof_sha256: completionProof ? sha(completionProof) : null, publication_approved: false });
    if (status === 'queries_confirmed') time.active();
    return { ...summary, readback, completion_proof: completionProof };
  } catch { return { ...summary, status: 'stopped', reason: 'preflight_completion_unconfirmed' }; }
}

function inspectPlan(repo, dirs, phase, proof) {
  const current = runtimePlan(repo, dirs.loginRoot);
  if (phase === 'login') return current;
  exactFiles(dirs.loginRoot, [...runtimeNames, 'login-approval.json', 'login-status.json', 'login-readback.json']);
  return { id: PREFLIGHT_ID, phase: 'preflight_only', binding: loadLoginBinding({ ...dirs, proof, loginPlanHash: planHash(current) }),
    routes: ROUTES, limits: LIMITS, time_contract: timeContract,
    scope: { dns_calls: 1, get_attempts: 4, put_attempts: 0, parent_sync_before_network: true },
    cumulative_reserved: CAPACITY.cumulative, protected_765_bytes_used: 0, STOP_preserved: true, publication_approved: false };
}

async function main() {
  const startedAt = performance.now();
  const [mode, first, second, ...extra] = process.argv.slice(2);
  const repo = process.cwd();
  if (mode === '--check-preflight-rebind') {
    check(first === undefined, 'unsupported_mode');
    return snapshotForPreflightRebind(repo);
  }
  const dirs = roots(repo);
  checkTransportEnvironment();
  if (mode === '--prepare-runtime-update' && first === undefined) return prepareRuntimeUpdate(repo, dirs);
  const phase = mode === '--check-login' || mode === '--login' ? 'login' : 'preflight';
  const inspect = mode === '--check-login' || mode === '--check-preflight';
  check((mode === '--check-login' && first === undefined) || (mode === '--login' && hex(first) && second === undefined) ||
    (mode === '--check-preflight' && hex(first) && second === undefined) || (mode === '--preflight' && hex(first) && hex(second) && extra.length === 0), 'unsupported_mode');
  const proof = phase === 'preflight' ? (inspect ? first : second) : undefined;
  if (phase === 'login') {
    exactFiles(dirs.loginRoot, runtimeNames);
    absent(dirs.sessionRoot);
  }
  absent(dirs.preflightRoot);
  const plan = inspectPlan(repo, dirs, phase, proof);
  if (inspect) return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  const options = { ...dirs, plan, approvedHash: first, proof, startedAt, adapter: { lookup, request },
    recheck: () => planHash(inspectPlan(repo, dirs, phase, proof)) };
  if (phase === 'preflight') return executePreflight(options);
  check(isatty(0) && isatty(1), 'operator_terminal_required');
  const terminal = fs.openSync('/dev/tty', fs.constants.O_WRONLY | fs.constants.O_NOCTTY);
  try {
    return await executeLogin({ ...options, beginBrowser(url) {
      // Keep the authentication URL off stdout and out of all saved evidence.
      fs.writeSync(terminal, '\nOpen this npm authentication URL in your browser and complete 2FA:\n' + url + '\n');
    } });
  } finally { fs.closeSync(terminal); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped') process.exitCode = 1;
  } catch { console.log(JSON.stringify({ status: 'stopped', reason: 'approval_or_local_preconditions_unconfirmed' })); process.exitCode = 1; }
}
