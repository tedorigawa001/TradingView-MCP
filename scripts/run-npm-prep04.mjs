import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { isatty } from 'node:tty';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureApprovedInputs, readRegular } from './package-approval.mjs';
import { LIMITS, ROUTES } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { A_RECORDS, B_RECORDS, CAPACITY, verifyReboundPreflightTools } from './prepare-npm-session-release.mjs';
import { ACCOUNT, NPM_REGISTRY_HOST, LOGIN_START_PATH, MAX_POLLS, SESSION_BYTES,
  writePrivateSession, inspectPrivateSession, privateSessionIdentity, runSessionPreflight } from './npm-session-release.mjs';
import { approvalRecord, planHash, readRecord, writer } from './run-npm-session-release.mjs';
import { runLogin04Protocol, login04HttpFailure } from './npm-login04-protocol.mjs';

// One approved run: login06 obtains a fresh npm session, then the prep04
// preflight performs the four read-only GETs with it. No PUT, no retry.
// prep04 differs from prep03 only by the rebind02 collaborator-permission fix.
const KiB = 1024;
export const LOGIN06_ID = 'package-2026-11-20-publish-0.1.46-login06';
export const PREP04_ID = 'package-2026-11-20-publish-0.1.46-prep04';
export const SESSION06_ROOT = '/private/tmp/TradingView-MCP-npm-0.1.46-login06';
export const SESSION_MS = 2 * 60 * 60 * 1000;
const configFile = 'user.npmrc';
const preparation = ['reservation.json', 'preparation-inputs.json', 'preparation-tests.json', 'preparation-readback.json'];
const execution = ['login-approval.json', 'login-status.json', 'login-readback.json'];
export const TESTS = Object.freeze(['test/release/prepare-npm-preflight.test.mjs', 'test/release/run-npm-preflight.test.mjs',
  'test/release/npm-session-release.test.mjs', 'test/release/run-npm-session-release.test.mjs',
  'test/release/run-npm-login04.test.mjs', 'test/release/run-npm-prep03.test.mjs', 'test/release/run-npm-prep04.test.mjs']);
const sources = ['scripts/run-npm-prep04.mjs', 'scripts/npm-login04-protocol.mjs', 'scripts/npm-session-release.mjs',
  'scripts/run-npm-session-release.mjs', 'scripts/prepare-npm-session-release.mjs', 'scripts/prepare-npm-preflight.mjs',
  'scripts/run-npm-preflight.mjs', 'scripts/package-approval.mjs', 'scripts/package-verifier-core.mjs', ...TESTS];

// rebind02 approves the two fixed files and supersedes rebind01.
export const REBIND02 = Object.freeze({ file: 'packaging/npm-preflight-input-rebind02-0.1.46.json',
  id: 'package-2026-11-20-publish-0.1.46-prep04-input-rebind02',
  sha256: '717488d959f355bab8d56c12964ca85736d09649347fa629d78444dc7d7842cd' });
const REBIND01 = Object.freeze({ file: 'packaging/npm-preflight-input-rebind-0.1.46.json',
  id: 'package-2026-11-20-publish-0.1.46-prep03-input-rebind01',
  sha256: '3d63f51e42599d238d5af92cd959e962cd028601aafc66c5789aa2cb2d306cf2' });
const PREP02 = Object.freeze({ id: 'package-2026-11-19-publish-0.1.46-prep02',
  inputs: '76d8e0f7f67c140143696cfbe1d1e226ebe680eea4cb390d14f2e7d1c2ceea6b',
  status: 'ec8646734f38c414667b85aaa097fb38bd29aba40da5f8dc2c6e176d064827fe',
  readback: '8114d9e0df7826685a84164aff541e5dd0dcf99725cb6ed0c8875b82dc8a1b7a' });
const CANDIDATE = '8d97bbaaf2360fe83b2ff6dd36ebef4887c0acc9';

// Immutable prior runs. Each anchor is the SHA-256 of the run's final readback,
// whose rows in turn bind the earlier records byte for byte.
const LOGIN05_ID = 'package-2026-11-20-publish-0.1.46-login05';
const PREP03_ID = 'package-2026-11-19-publish-0.1.46-prep03';
export const HISTORY = Object.freeze({
  'package-2026-11-19-publish-0.1.46-login01': ['login-readback.json', '78c87158d57bce30b36b75f0c99a9a540150aac7ef9feb942fcb0414f21798e1'],
  'package-2026-11-19-publish-0.1.46-login02': ['login-readback.json', '13ae3217c85db33bdef3aa4bb655c74d14b3b10bb645081680719c86d6bb72ae'],
  'package-2026-11-19-publish-0.1.46-login-header01': ['communication-readback.json', 'cc58678cb25a2d6366500fa91ffd6155f3571c28b2a7678b5150e7132b7d084c'],
  'package-2026-11-19-publish-0.1.46-login03': ['login-readback.json', 'fd0d8aa12e2eab385f6e1c24992d37603a426159da7462894d38d291f1ea83df'],
  'package-2026-11-19-publish-0.1.46-login-poll01': ['communication-readback.json', 'be4bfd9dee9fe20aa50ffc3a2837a80f6e16491f9eab2358dcad7a6d124c80e0'],
  'package-2026-11-19-publish-0.1.46-login04': ['login-readback.json', 'd9c6a6fa9104f32b73772bcd431c3a2c4b4cbfb5138f402dc3c5586ec4eebe69'],
  [LOGIN05_ID]: ['login-readback.json', 'ef97e1bdab25891155b325f8e418664aada1260cd6bbc69300ad7965767d4f9b'],
  [PREP03_ID]: ['preflight-readback.json', 'ccd2f5a3d4a4d41deb9a888bb1d2e5845b961f881a677cd03f31325770a8a414'],
});
const login05Reservation = '3b212d7b7bdf2cff9c197d3bd7f79579b2596f1407776663f8cd0279da43ffc6';
export const ALLOCATION = Object.freeze({ prior_cumulative: 50301938, reservation: 128 * KiB, cumulative: 50433010,
  remaining_pool: 30677833, campaign_cap: CAPACITY.cap, preparation: 32 * KiB, execution: 16 * KiB,
  private_session: SESSION_BYTES, preflight_records: 64 * KiB, protected_765_bytes_used: 0 });
const scope = Object.freeze({
  login: { host: NPM_REGISTRY_HOST, dns_calls: 1, post_attempts: 1, post_path: LOGIN_START_PATH, max_poll_gets: MAX_POLLS,
    protocol: 'npm-login04-protocol', browser: 'validated npm URL on the local terminal; operator completes 2FA' },
  preflight: { host: NPM_REGISTRY_HOST, dns_calls: 1, get_attempts: 4, routes: ROUTES, put_attempts: 0,
    account: ACCOUNT, rights: 'registry collaborator permission write',
    admission: 'login06 readback, session identity and UTC deadline verified before DNS' },
  redirects: false, retry: false, publication: false });
const timeContract = Object.freeze({ login_stage_ms: LIMITS.stageMs, preflight_stage_ms: LIMITS.stageMs,
  clock: 'monotonic stage windows from CLI entry and from login completion', utc: 'Date.now on the operator host',
  session_deadline: 'UTC login start + 2 hours', terminates_os_dns_or_sync_io: false });

const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const size = value => Buffer.byteLength(JSON.stringify(value) + '\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const total = (caps, files = Object.keys(caps)) => files.reduce((sum, file) => sum + caps[file], 0);
const sameBytes = (a, b) => a?.bytes === b.bytes && a.sha256 === b.sha256;

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw Error('prep04_scope_exists');
}

function exactFiles(root, expected) {
  const names = fs.readdirSync(root);
  check(names.length === expected.length && names.every(name => expected.includes(name)), 'prep04_scope_consumed_or_changed');
}

export function checkAllocationArithmetic() {
  const a = ALLOCATION;
  check(total(A_RECORDS, preparation) === a.preparation && total(A_RECORDS, execution) === a.execution &&
    total(A_RECORDS) === a.preparation + a.execution && total(B_RECORDS) === a.preflight_records &&
    a.preparation + a.execution + a.private_session + a.preflight_records === a.reservation &&
    a.prior_cumulative + a.reservation === a.cumulative && a.cumulative + a.remaining_pool + CAPACITY.fixed_margin + CAPACITY.unallocated === a.campaign_cap &&
    a.protected_765_bytes_used === 0, 'prep04_allocation_changed');
}

// The new reservation must extend exactly the latest recorded allocation (login05).
export function checkAllocationChain(previous) {
  checkAllocationArithmetic();
  check(previous && previous.cumulative === ALLOCATION.prior_cumulative && previous.remaining_pool - ALLOCATION.reservation === ALLOCATION.remaining_pool &&
    previous.campaign_cap === ALLOCATION.campaign_cap && previous.protected_765_bytes_used === 0, 'prep04_allocation_changed');
}

function verifyHistory(base) {
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
  // login05 succeeded with UTC evidence; prep03 then stopped at the rights check.
  const status05 = JSON.parse(readRegular(path.join(base, LOGIN05_ID, 'login-status.json'), 16 * KiB));
  const status03 = JSON.parse(readRegular(path.join(base, PREP03_ID, 'preflight-status.json'), 16 * KiB));
  check(status05.status === 'session_verified' && Number.isSafeInteger(status05.started_at_utc_ms) && status05.approval_consumed &&
    status05.no_retry && status05.publication_approved === false && status05.cumulative_reserved === ALLOCATION.prior_cumulative &&
    status03.status === 'stopped' && status03.reason === 'rights_unconfirmed' && status03.counts.get_attempts === 2 &&
    status03.counts.put_attempts === 0 && status03.no_retry && status03.publication_approved === false, 'prior_run_unconfirmed');
  const reservation = readRegular(path.join(base, LOGIN05_ID, 'reservation.json'), 8 * KiB);
  check(sha(reservation) === login05Reservation, 'allocation_history_changed');
  checkAllocationChain(JSON.parse(reservation).allocation);
}

function bound(repo, file, limit, hash, observed) {
  const bytes = readRegular(path.join(repo, file), limit);
  check(sha(bytes) === hash, 'evidence_changed');
  observed?.set(file, { bytes: bytes.length, sha256: hash });
  return bytes;
}

// rebind02 replaces the two preflight files recorded by prep02. Everything else
// that prep02 bound (inputs, artifact, candidate, inventory) must be unchanged.
export function verifyRebind02(repo) {
  const bytes = bound(repo, REBIND02.file, 8 * KiB, REBIND02.sha256);
  const approval = JSON.parse(bytes);
  check(approval.schema === 'npm-preflight-input-rebind-approval-v1' && approval.id === REBIND02.id && approval.decision === 'approved' &&
    approval.supersedes?.id === REBIND01.id && approval.supersedes.file === REBIND01.file && approval.supersedes.sha256 === REBIND01.sha256 &&
    approval.observed_failure?.run === PREP03_ID && approval.observed_failure.preflight_readback_sha256 === HISTORY[PREP03_ID][1] &&
    approval.STOP_preserved === true && approval.protected_765_bytes_used === 0 && approval.new_release_work_reservation_bytes === 0 &&
    approval.login_execution_approved === false && approval.preflight_execution_approved === false &&
    approval.publication_approved === false && approval.preflight_execution_plan_sha256 === null, 'rebind02_scope');
  bound(repo, REBIND01.file, 8 * KiB, REBIND01.sha256);
  const observed = new Map(), prev = '.release-work/' + PREP02.id;
  const stopped = JSON.parse(bound(repo, prev + '/preflight-status.json', 12 * KiB, PREP02.status, observed));
  const readback = JSON.parse(bound(repo, prev + '/preflight-readback.json', 8 * KiB, PREP02.readback, observed));
  check(stopped.id === PREP02.id && stopped.status === 'stopped' && stopped.reason === 'http_status_401' && stopped.approval_consumed &&
    stopped.no_retry && stopped.STOP_preserved && !stopped.publication_approved && stopped.cumulative_reserved === CAPACITY.prior &&
    readback.verified && readback.status === 'stopped', 'prep02_stop_binding');
  const inputs = JSON.parse(bound(repo, prev + '/inputs.json', 24 * KiB, PREP02.inputs, observed));
  for (const [name, digest] of inputs.historical_evidence) {
    bound(repo, (name === 'approval-setup.json' ? prev : '.release-work') + '/' + name, 1024 * KiB, digest, observed);
  }
  const release = approval.release;
  check(approval.legacy_preparation.id === PREP02.id && inputs.id === PREP02.id && release.version === '0.1.46' &&
    release.ci_candidate === CANDIDATE && inputs.head === CANDIDATE && release.artifact_sha256 === inputs.artifact &&
    release.artifact_bytes === inputs.artifact_bytes, 'rebind02_release_changed');
  for (const expected of [...approval.legacy_preparation.evidence, release.reuse_approval]) {
    check(sameBytes(observed.get(expected.file), expected), 'rebind02_history_changed');
  }
  const reboundTools = verifyReboundPreflightTools(repo, inputs.tools, approval);
  const ci = execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'rev-parse', 'refs/heads/codex/ci-0.1.46'],
    { cwd: repo, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const current = captureApprovedInputs(repo);
  check(ci === CANDIDATE && current.sha256 === inputs.current_full_inventory_sha256, 'candidate_changed');
  const npmRoot = current.manifest.groups.find(group => group.name === 'npm').root;
  check(JSON.parse(readRegular(path.join(npmRoot, 'package.json'), 64 * KiB)).version === '11.16.0', 'npm_version_changed');
  return { approval: { file: REBIND02.file, bytes: bytes.length, sha256: REBIND02.sha256 }, candidate: ci,
    artifact_sha256: inputs.artifact, artifact_bytes: inputs.artifact_bytes, inventory_sha256: current.sha256, rebound_tools: reboundTools };
}

// Deterministic and read-only. Scope absence is checked by the callers, because
// the run re-evaluates these inputs after it has created its own records.
export function inputsFor(repo) {
  const base = path.join(repo, '.release-work');
  verifyHistory(base);
  const rebind = verifyRebind02(repo);
  return { schema: 'npm-prep04-run-inputs-v1', id: LOGIN06_ID, preflight_id: PREP04_ID,
    login_root: path.join(base, LOGIN06_ID), preflight_root: path.join(base, PREP04_ID),
    session_file: path.join(SESSION06_ROOT, configFile), account: ACCOUNT,
    candidate: rebind.candidate, artifact_sha256: rebind.artifact_sha256, artifact_bytes: rebind.artifact_bytes,
    inventory_sha256: rebind.inventory_sha256, rebind: { approval: rebind.approval, rebound_tools: rebind.rebound_tools },
    history: HISTORY, login05_reservation_sha256: login05Reservation,
    allocation: ALLOCATION, record_limits: { login: A_RECORDS, preflight: B_RECORDS }, scope, limits: LIMITS,
    time_contract: timeContract, session_ms: SESSION_MS,
    tools: sources.map(file => [file, sha(readRegular(path.join(repo, file), 64 * KiB))]),
    STOP_preserved: true, preflight_approved: false, publication_approved: false };
}

export function planFor(inputs, records) {
  const { id, preflight_id, login_root, preflight_root, session_file, account, candidate, artifact_sha256 } = inputs;
  return { id, preflight_id, login_root, preflight_root, session_file, account, candidate, artifact_sha256,
    rebind_approval_sha256: inputs.rebind.approval.sha256, allocation: ALLOCATION, scope, time_contract: timeContract,
    session_ms: SESSION_MS, record_limits_sha256: planHash(inputs.record_limits), ...records,
    STOP_preserved: true, publication_approved: false };
}

function verifyPreparation(repo, root) {
  const receipt = readRecord(root, 'preparation-readback.json', A_RECORDS);
  const meta = receipt.data;
  check(meta.id === LOGIN06_ID && meta.verified && meta.status === 'prepared' && meta.execution_approval_consumed === false &&
    meta.STOP_preserved === true && meta.rows.length === 3, 'preparation_unconfirmed');
  const [reservation, inputs, tests] = preparation.slice(0, 3).map((file, i) => readRecord(root, file, A_RECORDS, meta.rows[i]));
  const r = reservation.data, t = tests.data;
  check(r.id === LOGIN06_ID && r.preparation_approved && r.execution_approved === false && r.STOP_preserved &&
    planHash(r.allocation) === planHash(ALLOCATION) && planHash(r.record_limits) === planHash(inputs.data.record_limits) &&
    t.id === LOGIN06_ID && t.status === 'prepared' && t.network_calls === 0 && Number.isSafeInteger(t.passed) && t.passed > 0 &&
    t.input_before_sha256 === inputs.evidence.sha256 && t.input_after_sha256 === inputs.evidence.sha256 &&
    planHash(inputsFor(repo)) === inputs.evidence.sha256 && inputs.data.login_root === root, 'preparation_binding_changed');
  const plan = planFor(inputs.data, { reservation_sha256: reservation.evidence.sha256, inputs_sha256: inputs.evidence.sha256,
    tests_sha256: tests.evidence.sha256, preparation_readback_sha256: receipt.evidence.sha256 });
  check(size(approvalRecord(LOGIN06_ID, plan, planHash(plan))) <= A_RECORDS['login-approval.json'], 'prep04_approval_record_limit');
  return plan;
}

function prepare(repo) {
  checkAllocationArithmetic();
  const base = path.join(repo, '.release-work'), root = path.join(base, LOGIN06_ID);
  absent(root);
  absent(SESSION06_ROOT);
  absent(path.join(base, PREP04_ID));
  const inputs = inputsFor(repo);
  check(size(inputs) <= A_RECORDS['preparation-inputs.json'], 'prep04_preparation_input_limit');
  fs.mkdirSync(root, { mode: 0o700 });
  const disk = writer(root, A_RECORDS);
  const rows = [disk.write('reservation.json', { id: LOGIN06_ID, preflight_id: PREP04_ID, allocation: ALLOCATION,
    record_limits: inputs.record_limits, preparation_approved: true, execution_approved: false, STOP_preserved: true })];
  disk.syncParent();
  rows.push(disk.write('preparation-inputs.json', inputs));
  let status = 'stopped', passed = 0, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...TESTS],
      { cwd: repo, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash(inputsFor(repo));
    check(after === rows[1].sha256, 'preparation_inputs_changed');
    absent(SESSION06_ROOT);
    absent(path.join(base, PREP04_ID));
    exactFiles(root, preparation.slice(0, 2));
    status = 'prepared';
  } catch { /* Preserve the bounded preparation records for a stopped run. */ }
  rows.push(disk.write('preparation-tests.json', { id: LOGIN06_ID, status, passed, network_calls: 0,
    input_before_sha256: rows[1].sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write('preparation-readback.json', { id: LOGIN06_ID, status, verified: true, rows,
    execution_approval_consumed: false, STOP_preserved: true });
  if (status === 'prepared') verifyPreparation(repo, root);
  return { id: LOGIN06_ID, status, passed, readback, cumulative_reserved: ALLOCATION.cumulative, network_calls: 0 };
}

function sessionPresence(root) {
  try {
    if (!fs.lstatSync(root).isDirectory()) return 'unconfirmed';
    fs.lstatSync(path.join(root, configFile));
    return 'present';
  } catch (error) { return error?.code === 'ENOENT' ? 'absent' : 'unconfirmed'; }
}

const loginFailure = /^login_(?:url_rejected|dns_unconfirmed|dns_timeout|peer_unconfirmed|second_dns|header_limit|http_status|response_encoding|body_limit|response_incomplete|multiple_sockets|transport_error|request_timeout|response_json|response_shape|duplicate_json_key|stage_timeout|browser_handoff_failed|session_unconfirmed|session_save_failed|poll_limit|poll_interval_unconfirmed|poll_wait_failed|parent_sync_unconfirmed)$/;
const preflightFailure = /^(?:dns_error_[A-Z_]{1,40}|request_error_[A-Z_]{1,40}|response_error_[A-Z_]{1,40}|http_status_[1-5][0-9]{2}|dns_result_shape|dns_timeout|stage_timeout|stage_window_insufficient|transport_setup_error|get_timeout|tls_or_address_unconfirmed|http_status_shape|header_limit|response_encoding|body_limit|response_aborted|response_incomplete|multiple_sockets|response_json|response_shape|account_unconfirmed|rights_unconfirmed|version_availability_unconfirmed|latest_unconfirmed|latest_at_or_above_candidate|session_account_mismatch|invalid_token)$/;
const localFailure = ['execution_inputs_changed', 'stage_deadline', 'prep04_scope_exists', 'prep04_dns_scope', 'prep04_transport_scope',
  'prep04_session_changed', 'session_deadline', 'utc_clock_unconfirmed', 'preflight_parent_sync_unconfirmed', 'login_record_unconfirmed'];
export function safeReason(code) {
  return typeof code === 'string' && (loginFailure.test(code) || preflightFailure.test(code) || localFailure.includes(code))
    ? code : 'execution_stopped';
}

// Read-only preflight transport: one DNS lookup, then the four fixed routes in
// order on the pinned address. Every dispatch first runs `before`.
export function preflightTransport({ adapter, before, gate = work => work() }) {
  const counts = { dns_calls: 0, get_attempts: 0, put_attempts: 0, secondary_lookup_attempts: 0 };
  const routes = Object.values(ROUTES);
  let address;
  return { counts,
    lookup(host, options, callback) {
      gate(() => {
        before(LIMITS.dnsMs);
        check(counts.dns_calls === 0 && host === NPM_REGISTRY_HOST && options?.family === 4 && options.all === false, 'prep04_dns_scope');
      });
      counts.dns_calls++;
      return adapter.lookup(host, options, (error, value, family) => {
        if (!error && family === 4 && net.isIPv4(value)) address = value;
        callback(error, value, family);
      });
    },
    request(options, callback) {
      gate(() => {
        before(LIMITS.getMs);
        check(counts.dns_calls === 1 && counts.secondary_lookup_attempts === 0 && address && options.hostname === address &&
          options.servername === NPM_REGISTRY_HOST && options.port === 443 && options.family === 4 && options.agent === false &&
          options.autoSelectFamily === false && options.rejectUnauthorized === true && options.maxHeaderSize === LIMITS.headerBytes &&
          options.method === 'GET' && counts.get_attempts < routes.length && options.path === routes[counts.get_attempts], 'prep04_transport_scope');
      });
      counts.get_attempts++;
      const refuse = options.lookup;
      return adapter.request({ ...options, lookup: (...args) => { counts.secondary_lookup_attempts++; return refuse(...args); } }, callback);
    },
    complete() {
      check(counts.dns_calls === 1 && counts.get_attempts === routes.length && counts.put_attempts === 0 &&
        counts.secondary_lookup_attempts === 0, 'prep04_transport_scope');
    },
  };
}

function baseStatus(id, approvedHash, extra) {
  return { id, run_id: LOGIN06_ID, approval_sha256: approvedHash, ...extra, approval_consumed: true, no_retry: true,
    cumulative_reserved: ALLOCATION.cumulative, protected_765_bytes_used: 0, STOP_preserved: true, publication_approved: false };
}

export async function executePrep04Run({ loginRoot, preflightRoot, session, plan, approvedHash, recheck, adapter, beginBrowser,
  sleep, now = () => performance.now(), wall = Date.now, startedAt = now() }) {
  const approval = approvalRecord(LOGIN06_ID, plan, approvedHash);
  const confirm = () => {
    try { check(recheck() === approvedHash, 'execution_inputs_changed'); }
    catch { throw Error('execution_inputs_changed'); }
  };
  const window = (start, deadline, ms = 0) => {
    const current = now();
    check(Number.isFinite(current) && current >= start && current < deadline && current + ms <= deadline, 'stage_deadline');
  };
  const utc = () => {
    const value = wall();
    check(Number.isSafeInteger(value) && value > 0, 'utc_clock_unconfirmed');
    return value;
  };

  // Login stage. Nothing is dispatched before the approval record is durable.
  const loginDeadline = startedAt + LIMITS.stageMs;
  const counts = { dns_calls: 0, post_attempts: 0, get_attempts: 0, put_attempts: 0, secondary_lookup_attempts: 0 };
  let phase = 'before_dispatch', ip, poll, explicit, identity, reason = null, httpFailure;
  confirm();
  window(startedAt, loginDeadline, LIMITS.dnsMs + LIMITS.getMs);
  absent(session);
  absent(preflightRoot);
  const startedUtc = utc();
  const disk = writer(loginRoot, A_RECORDS);
  const rows = [disk.write('login-approval.json', approval)];
  const gate = work => { try { return work(); } catch (error) { explicit = error.message; throw error; } };
  let confirmedUtc = null;
  try {
    try { disk.syncParent(); } catch { throw Error('login_parent_sync_unconfirmed'); }
    await runLogin04Protocol({ now, deadline: loginDeadline, sleep, beginBrowser,
      beforeDispatch(operation) { phase = operation === 'dns' ? 'dns' : operation === 'post' ? 'before_post' : 'before_get'; confirm(); },
      onAdditionalLookup() { counts.secondary_lookup_attempts++; },
      lookup(host, options, callback) {
        gate(() => check(counts.dns_calls === 0 && host === NPM_REGISTRY_HOST && options.family === 4 && options.all === false, 'prep04_dns_scope'));
        counts.dns_calls++;
        return adapter.lookup(host, options, (error, address, family) => {
          if (!error && family === 4 && net.isIPv4(address)) ip = address;
          callback(error, address, family);
        });
      },
      request(options, callback) {
        const post = options.method === 'POST';
        gate(() => {
          check(counts.dns_calls === 1 && counts.secondary_lookup_attempts === 0 && ip && options.hostname === ip &&
            options.servername === NPM_REGISTRY_HOST && options.port === 443 && options.family === 4 && options.agent === false &&
            options.autoSelectFamily === false && options.rejectUnauthorized === true && options.maxHeaderSize === LIMITS.headerBytes &&
            !Object.hasOwn(options.headers, 'authorization') &&
            (post ? options.headers['npm-auth-type'] === 'web' : !Object.hasOwn(options.headers, 'npm-auth-type')), 'prep04_transport_scope');
          if (post) check(counts.post_attempts === 0 && options.path === LOGIN_START_PATH, 'prep04_transport_scope');
          else check(options.method === 'GET' && counts.post_attempts === 1 && counts.get_attempts < MAX_POLLS &&
            /^\/-\/v1\/done[/?]/.test(options.path) && (poll === undefined || poll === options.path), 'prep04_transport_scope');
        });
        if (post) counts.post_attempts++;
        else { poll = options.path; counts.get_attempts++; }
        phase = post ? 'login_post' : 'poll_get';
        return adapter.request(options, callback);
      },
      writeSession(token) {
        phase = 'before_session_create';
        gate(() => { confirm(); window(startedAt, loginDeadline); absent(session); });
        phase = 'session_save';
        let observed;
        try {
          writePrivateSession(session, token);
          writer(session, {}).syncParent();
          observed = inspectPrivateSession(session);
        } catch { throw Error('login_session_save_failed'); }
        check(observed.token === token, 'prep04_session_changed');
        identity = observed.identity;
      },
    });
    phase = 'final_verification';
    confirm();
    check(counts.dns_calls === 1 && counts.post_attempts === 1 && counts.get_attempts > 0 && counts.secondary_lookup_attempts === 0, 'prep04_transport_scope');
    check(identity && same(privateSessionIdentity(session), identity), 'prep04_session_changed');
    window(startedAt, loginDeadline);
    confirmedUtc = utc();
    check(confirmedUtc >= startedUtc && confirmedUtc - startedUtc <= LIMITS.stageMs, 'utc_clock_unconfirmed');
  } catch (error) {
    httpFailure = login04HttpFailure(error);
    reason = safeReason(explicit ?? error?.message);
  }
  const deadlineUtc = startedUtc + SESSION_MS;
  const login = baseStatus(LOGIN06_ID, approvedHash, { status: reason ? 'stopped' : 'session_verified', phase, reason,
    counts, session_file_state: sessionPresence(session), elapsed_ms_at_status: Math.ceil(now() - startedAt),
    started_at_utc_ms: startedUtc, confirmed_at_utc_ms: reason ? null : confirmedUtc, session_deadline_utc_ms: deadlineUtc,
    ...(httpFailure && { http_failure: httpFailure }) });
  let loginReadback;
  try {
    rows.push(disk.write('login-status.json', { ...login, session_identity: reason ? null : identity }));
    disk.verify(rows);
    loginReadback = disk.write('login-readback.json', { id: LOGIN06_ID, status: login.status, approval_sha256: approvedHash,
      verified: true, rows, preflight_follows: !reason, publication_approved: false });
  } catch {
    return { stage: 'login', ...login, status: 'stopped', reason: 'login_record_unconfirmed', preflight: null };
  }
  if (reason) return { stage: 'login', ...login, readback: loginReadback, preflight: null };

  // Preflight admission: qualify the login06 records, session identity and UTC deadline before any DNS.
  const preflightStart = now(), preflightDeadline = preflightStart + LIMITS.stageMs;
  const unchanged = () => {
    check(utc() < deadlineUtc, 'session_deadline');
    check(same(privateSessionIdentity(session), identity), 'prep04_session_changed');
  };
  const transport = preflightTransport({ adapter, gate,
    before(ms) { confirm(); unchanged(); window(preflightStart, preflightDeadline, ms); } });
  const pcounts = transport.counts;
  let session06;
  try {
    confirm();
    window(preflightStart, preflightDeadline, LIMITS.dnsMs + LIMITS.getMs);
    try { disk.verify([...rows, loginReadback]); } catch { throw Error('login_record_unconfirmed'); }
    session06 = inspectPrivateSession(session);
    check(same(session06.identity, identity), 'prep04_session_changed');
    check(utc() < deadlineUtc, 'session_deadline');
    absent(preflightRoot);
  } catch (error) {
    return { stage: 'preflight_admission', ...login, readback: loginReadback,
      preflight: { status: 'stopped', reason: safeReason(error?.message), counts: pcounts, records: 'not_created' } };
  }
  fs.mkdirSync(preflightRoot, { mode: 0o700 });
  const pdisk = writer(preflightRoot, B_RECORDS);
  const prows = [pdisk.write('approval-preflight.json', { id: PREP04_ID, run_id: LOGIN06_ID, approved_hash: approvedHash,
    plan, consumed: true, publication_approved: false })];
  let preason = null;
  const preflightUtc = utc();
  try {
    prows.push(pdisk.write('login-binding.json', { id: PREP04_ID, login_id: LOGIN06_ID, account: ACCOUNT,
      login_approval_sha256: approvedHash, login_readback_sha256: loginReadback.sha256, login_status_sha256: rows[1].sha256,
      session_identity: identity, started_at_utc_ms: startedUtc, confirmed_at_utc_ms: confirmedUtc,
      session_deadline_utc_ms: deadlineUtc, preflight_started_at_utc_ms: preflightUtc }));
    try { pdisk.syncParent(); } catch { throw Error('preflight_parent_sync_unconfirmed'); }
    await runSessionPreflight({ now, token: session06.token, lookup: transport.lookup, request: transport.request,
      record(slot, summary) {
        gate(() => { window(preflightStart, preflightDeadline); check(pcounts.secondary_lookup_attempts === 0, 'prep04_transport_scope'); });
        prows.push(pdisk.write(slot + '.json', { id: PREP04_ID, slot, ...summary }));
      },
    });
    gate(() => { confirm(); transport.complete(); unchanged(); window(preflightStart, preflightDeadline); });
  } catch (error) { preason = safeReason(explicit ?? error?.message); }
  const preflight = baseStatus(PREP04_ID, approvedHash, { status: preason ? 'stopped' : 'queries_confirmed', reason: preason,
    counts: pcounts, elapsed_ms_at_status: Math.ceil(now() - preflightStart), started_at_utc_ms: preflightUtc,
    finished_at_utc_ms: wall() });
  try {
    prows.push(pdisk.write('preflight-status.json', preflight));
    pdisk.verify(prows);
    const readback = pdisk.write('preflight-readback.json', { id: PREP04_ID, run_id: LOGIN06_ID, status: preflight.status,
      rows: prows, verified: true, publication_approved: false });
    return { stage: 'preflight', ...login, readback: loginReadback, preflight: { ...preflight, readback } };
  } catch {
    return { stage: 'preflight', ...login, readback: loginReadback,
      preflight: { ...preflight, status: 'stopped', reason: 'preflight_record_unconfirmed' } };
  }
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), base = path.join(repo, '.release-work');
  const loginRoot = path.join(base, LOGIN06_ID), preflightRoot = path.join(base, PREP04_ID);
  checkTransportEnvironment();
  if (mode === '--prepare' && approvedHash === undefined && extra.length === 0) return prepare(repo);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--run' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'prep04_unsupported_mode');
  absent(SESSION06_ROOT);
  absent(preflightRoot);
  exactFiles(loginRoot, preparation);
  const plan = verifyPreparation(repo, loginRoot);
  if (mode === '--check') return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  check(isatty(0) && isatty(1) && planHash(plan) === approvedHash, 'prep04_local_terminal_or_approval_unconfirmed');
  const tty = fs.openSync('/dev/tty', fs.constants.O_WRONLY | fs.constants.O_NOCTTY);
  try {
    return await executePrep04Run({ loginRoot, preflightRoot, session: SESSION06_ROOT, plan, approvedHash, startedAt,
      adapter: { lookup, request }, recheck: () => planHash(verifyPreparation(repo, loginRoot)),
      beginBrowser(url) {
        // Keep the authentication URL off stdout and out of all saved evidence.
        const bytes = Buffer.from('\nOpen this npm authentication URL and complete 2FA:\n' + url + '\n');
        check(fs.writeSync(tty, bytes) === bytes.length, 'prep04_terminal_write_unconfirmed');
      } });
  } finally { fs.closeSync(tty); }
}

// Fixed, secret-free stop codes for local preconditions; anything else stays generic.
const localStop = /^(?:prep04_[a-z_]+|transport_environment_override|historical_readback_changed|historical_record_changed|prior_run_unconfirmed|allocation_history_changed|evidence_changed|rebind02_[a-z_]+|prep02_stop_binding|preflight_rebind_[a-z_]+|candidate_changed|npm_version_changed|preparation_unconfirmed|preparation_binding_changed|record_changed|record_scope)$/;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped' || result.preflight?.status === 'stopped') process.exitCode = 1;
  } catch (error) {
    const reason = localStop.test(error?.message ?? '') ? error.message : 'prep04_local_preconditions_unconfirmed';
    console.log(JSON.stringify({ status: 'stopped', reason }));
    process.exitCode = 1;
  }
}
