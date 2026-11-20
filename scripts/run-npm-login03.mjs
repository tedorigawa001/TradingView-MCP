import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { isatty } from 'node:tty';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRegular } from './package-approval.mjs';
import { LIMITS } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { A_RECORDS, CAPACITY, snapshot } from './prepare-npm-session-release.mjs';
import { LOGIN_ID, PREFLIGHT_ID, NPM_REGISTRY_HOST, LOGIN_START_PATH, LOGIN_POST_BODY, LOGIN02_POST_STATUSES,
  MAX_POLLS, SESSION_BYTES, runWebLogin02, writePrivateSession, inspectPrivateSession, loginHttpFailure } from './npm-session-release.mjs';
import { LOGIN02, approvalRecord, planHash, readRecord, writer } from './run-npm-session-release.mjs';
import { DIAGNOSTIC_ID, CAPS as DIAGNOSTIC_CAPS } from './run-npm-login-header01.mjs';

const KiB = 1024;
export const LOGIN03_ID = 'package-2026-11-19-publish-0.1.46-login03';
const sessionRoot = '/private/tmp/TradingView-MCP-npm-0.1.46-login03';
const configFile = 'user.npmrc';
const priorPreparation = {
  'reservation.json': { bytes: 571, sha256: 'c2abbf7150d3fe5526470fe2a823e9914534a01ac5df0ac77acac21cbc5c1df7' },
  'preparation-inputs.json': { bytes: 4337, sha256: '331eef03c83b4febb9a2178f3d0db1e25f97836f2a53191795c8c75a6c0fb5b6' },
  'preparation-tests.json': { bytes: 278, sha256: 'a3c174ea16225612b532f1a132622b1ee482bab943e0922d810318605721f308' },
  'preparation-readback.json': { bytes: 516, sha256: '303240c25b21d1b35f14f7588499da13aa58d70f8dfa8d1a5aef24d113d47fc2' },
};
const revisedInputs = 'proof-recheck-inputs.json';
const revisedTests = 'proof-recheck-tests.json';
const revisedReadback = 'proof-recheck-readback.json';
const preparation = [...Object.keys(priorPreparation), revisedInputs, revisedTests, revisedReadback];
// Preserve the initial preparation at its verified size and use the balance of its 32 KiB for the revision.
const recordCaps = Object.freeze({ ...A_RECORDS,
  ...Object.fromEntries(Object.entries(priorPreparation).map(([file, { bytes }]) => [file, bytes])),
  [revisedInputs]: 12 * KiB, [revisedTests]: 12 * KiB, [revisedReadback]: 2490 });
const tests = ['test/release/prepare-npm-preflight.test.mjs', 'test/release/run-npm-preflight.test.mjs',
  'test/release/npm-session-release.test.mjs', 'test/release/run-npm-session-release.test.mjs',
  'test/release/run-npm-login02.test.mjs', 'test/release/run-npm-login-header01.test.mjs', 'test/release/run-npm-login03.test.mjs'];
const sources = ['scripts/run-npm-login03.mjs', 'scripts/run-npm-login-header01.mjs', 'scripts/npm-session-release.mjs',
  'scripts/run-npm-session-release.mjs', 'scripts/prepare-npm-session-release.mjs', 'scripts/prepare-npm-preflight.mjs',
  'scripts/run-npm-preflight.mjs', 'scripts/publish-verified-tarball.mjs', 'scripts/package-approval.mjs',
  'scripts/package-verifier-core.mjs', ...tests];
const history = Object.freeze({
  [LOGIN_ID]: '78c87158d57bce30b36b75f0c99a9a540150aac7ef9feb942fcb0414f21798e1',
  [LOGIN02.id]: '13ae3217c85db33bdef3aa4bb655c74d14b3b10bb645081680719c86d6bb72ae',
  [DIAGNOSTIC_ID]: 'cc58678cb25a2d6366500fa91ffd6155f3571c28b2a7678b5150e7132b7d084c',
});
const reservationAnchor = '6c2218006eadfb908c6c73c9e6d14cae0d99e6e3c2d399272d25f87afd82dfb5';
const allocation = Object.freeze({ prior_cumulative: 50088946, reservation: 64 * KiB, cumulative: 50154482,
  remaining_pool: 30956361, campaign_cap: CAPACITY.cap, preparation: 32 * KiB, execution: 16 * KiB,
  private_session: SESSION_BYTES, protected_765_bytes_used: 0 });
const protocol = Object.freeze({ host: NPM_REGISTRY_HOST, port: 443, dns_calls: 1, family: 4, ip_and_tls_hostname_pinned: true,
  post: { attempts: 1, path: LOGIN_START_PATH, body: LOGIN_POST_BODY, added_header: ['npm-auth-type', 'web'], statuses: LOGIN02_POST_STATUSES },
  get: { attempts: MAX_POLLS, statuses: [200, 202], raw_retry_after: { max_fields: 1, minimum_seconds: 1, default_seconds: 2 },
    pending_token_forbidden: true }, put_attempts: 0, redirects: false, retry: false, strict_utf8_json_and_unique_keys: true,
  browser: 'validated npm URL, local terminal, operator authentication',
  recheck: ['before DNS', 'after DNS before POST', 'before every GET', 'before creating the session file', 'before presenting proof'],
  incomplete_session: 'preserve and do not use',
  proof: 'present locally only after qualifying readback and a final check of approval, status and readback bytes' });
const timeContract = Object.freeze({ from: 'CLI main entry, monotonic', complete_window_before_dispatch: true,
  includes_browser_and_readback: true, terminates_os_dns_or_sync_io: false });
const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const size = value => Buffer.byteLength(JSON.stringify(value) + '\n');

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('login03_scope_exists');
}

function total(files) { return files.reduce((sum, file) => sum + recordCaps[file], 0); }

function checkPreparationFiles(root, expected) {
  const names = fs.readdirSync(root);
  check(names.length === expected.length && names.every(file => expected.includes(file)), 'login03_scope_consumed_or_changed');
}

function verifyHistory(base) {
  for (const [id, anchor] of Object.entries(history)) {
    const root = path.join(base, id), diagnostic = id === DIAGNOSTIC_ID;
    const prefix = diagnostic ? 'communication' : 'login', caps = diagnostic ? DIAGNOSTIC_CAPS : A_RECORDS;
    const receipt = readRecord(root, `${prefix}-readback.json`, caps);
    const proof = receipt.data;
    check(receipt.evidence.sha256 === anchor && proof.verified && proof.rows.length === 2, 'historical_readback_changed');
    const files = [`${prefix}-approval.json`, `${prefix}-status.json`];
    const [approval, status] = files.map((file, i) => readRecord(root, file, caps, proof.rows[i]).data);
    check(approval.id === id && approval.consumed && approval.approved_hash === status.approval_sha256 &&
      planHash(approval.plan) === status.approval_sha256 && status.approval_consumed && status.no_retry && status.STOP_preserved &&
      status.protected_765_bytes_used === 0 && status.publication_approved === false, 'historical_record_changed');
    if (diagnostic) {
      check(proof.approval_consumed && proof.observation_status === 'response_observed' && status.status === 'response_observed' &&
        status.phase === 'login_post' && status.http_status === 200 && status.counts.dns_calls === 1 && status.counts.post_attempts === 1 &&
        status.counts.get_attempts === 0 && status.counts.put_attempts === 0 && status.counts.refused_additional_lookups === 0 &&
        status.preflight_approved === false && approval.plan.scope.added_header.join(':') === 'npm-auth-type:web', 'diagnostic_unconfirmed');
    } else {
      check(proof.status === 'stopped' && status.status === 'stopped' && proof.completion_proof_sha256 === null, 'prior_stop_unconfirmed');
      if (id === LOGIN02.id) check(status.http_failure?.phase === 'login_post' && status.http_failure.http_status === 401, 'prior_stop_unconfirmed');
    }
  }
  const previous = readRecord(path.join(base, DIAGNOSTIC_ID), 'reservation.json', DIAGNOSTIC_CAPS);
  const a = previous.data.allocation;
  check(previous.evidence.sha256 === reservationAnchor && total(preparation) === allocation.preparation &&
    total(Object.keys(recordCaps)) === allocation.preparation + allocation.execution &&
    allocation.preparation + allocation.execution + allocation.private_session === allocation.reservation &&
    a.cumulative === allocation.prior_cumulative && a.cumulative + allocation.reservation === allocation.cumulative &&
    a.remaining_pool - allocation.reservation === allocation.remaining_pool &&
    allocation.cumulative + allocation.remaining_pool + CAPACITY.fixed_margin + CAPACITY.unallocated === allocation.campaign_cap &&
    a.protected_765_bytes_used === allocation.protected_765_bytes_used, 'allocation_changed');
}

function inputsFor(repo, root) {
  const base = path.dirname(root);
  absent(path.join(base, PREFLIGHT_ID));
  verifyHistory(base);
  for (const [file, expected] of Object.entries(priorPreparation)) {
    readRecord(root, file, recordCaps, { file, ...expected });
  }
  const current = snapshot(repo);
  return { id: LOGIN03_ID, root, session_file: path.join(sessionRoot, configFile), candidate: current.candidate,
    artifact_sha256: current.artifact_sha256, inventory_sha256: current.inventory_sha256, npm_version: current.npm_version,
    history, prior_reservation_sha256: reservationAnchor, prior_preparation_readback_sha256: priorPreparation['preparation-readback.json'].sha256,
    protocol, limits: LIMITS, time_contract: timeContract,
    allocation, record_limits: recordCaps, tools: sources.map(file => [file, sha(readRegular(path.join(repo, file), 64 * KiB))]),
    STOP_preserved: true, preflight_approved: false, publication_approved: false };
}

function verifyPreparation(repo, root) {
  const receipt = readRecord(root, revisedReadback, recordCaps);
  const meta = receipt.data;
  check(meta.id === LOGIN03_ID && meta.verified && meta.status === 'prepared' && meta.execution_approval_consumed === false &&
    meta.STOP_preserved === true && meta.rows.length === 2, 'preparation_unconfirmed');
  const reservation = readRecord(root, 'reservation.json', recordCaps, { file: 'reservation.json', ...priorPreparation['reservation.json'] });
  const [inputs, tests] = [revisedInputs, revisedTests].map((file, i) => readRecord(root, file, recordCaps, meta.rows[i]));
  const r = reservation.data, t = tests.data;
  check(r.id === LOGIN03_ID && r.preparation_approved && r.execution_approved === false && r.STOP_preserved &&
    planHash(r.allocation) === planHash(allocation) && planHash(r.record_limits) === planHash(A_RECORDS) &&
    t.id === LOGIN03_ID && t.status === 'prepared' && t.network_calls === 0 && Number.isSafeInteger(t.passed) && t.passed > 0 &&
    t.input_before_sha256 === inputs.evidence.sha256 && t.input_after_sha256 === inputs.evidence.sha256 &&
    planHash(inputsFor(repo, root)) === inputs.evidence.sha256, 'preparation_binding_changed');
  const { id, session_file, candidate, artifact_sha256, STOP_preserved, prior_preparation_readback_sha256 } = inputs.data;
  const plan = { id, root, session_file, candidate, artifact_sha256, history, protocol, limits: LIMITS,
    time_contract: timeContract, allocation, record_limits: recordCaps, STOP_preserved, preflight_approved: false,
    publication_approved: false, reservation_sha256: reservation.evidence.sha256, prior_preparation_readback_sha256, inputs_sha256: inputs.evidence.sha256,
    tests_sha256: tests.evidence.sha256, preparation_readback_sha256: receipt.evidence.sha256 };
  check(size(approvalRecord(id, plan, planHash(plan))) <= recordCaps['login-approval.json'], 'login03_approval_record_limit');
  return plan;
}

function prepareRevision(repo, root) {
  checkPreparationFiles(root, Object.keys(priorPreparation));
  absent(sessionRoot);
  const inputs = inputsFor(repo, root);
  const disk = writer(root, recordCaps);
  const rows = [disk.write(revisedInputs, inputs)];
  let status = 'stopped', passed = 0, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...tests],
      { cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash(inputsFor(repo, root));
    check(after === rows[0].sha256, 'preparation_inputs_changed');
    absent(sessionRoot);
    checkPreparationFiles(root, [...Object.keys(priorPreparation), revisedInputs]);
    status = 'prepared';
  } catch { /* Preserve the bounded preparation records for a stopped run. */ }
  rows.push(disk.write(revisedTests, { id: LOGIN03_ID, status, passed, network_calls: 0,
    input_before_sha256: rows[0].sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write(revisedReadback, { id: LOGIN03_ID, status, verified: true, rows,
    execution_approval_consumed: false, STOP_preserved: true });
  if (status === 'prepared') verifyPreparation(repo, root);
  return { id: LOGIN03_ID, status, passed, readback, cumulative_reserved: allocation.cumulative };
}

function sessionPresence(root) {
  try {
    if (!fs.lstatSync(root).isDirectory()) return 'unconfirmed';
    fs.lstatSync(path.join(root, configFile));
    return 'present';
  } catch (error) { return error.code === 'ENOENT' ? 'absent' : 'unconfirmed'; }
}

const protocolFailure = /^login_(?:url_rejected|dns_unconfirmed|dns_timeout|peer_unconfirmed|second_dns|header_limit|http_status|response_encoding|body_limit|response_incomplete|multiple_sockets|transport_error|request_timeout|response_json|response_shape|duplicate_json_key|stage_timeout|browser_handoff_failed|session_unconfirmed|session_save_failed|poll_limit|poll_interval_unconfirmed|poll_wait_failed)$/;

export async function executeLogin03({ root, session, plan, approvedHash, recheck, adapter, beginBrowser, presentProof,
  sleep, now = () => performance.now(), startedAt = now() }) {
  const approval = approvalRecord(LOGIN03_ID, plan, approvedHash);
  const deadline = startedAt + LIMITS.stageMs;
  const counts = { dns_calls: 0, post_attempts: 0, get_attempts: 0, put_attempts: 0, secondary_lookup_attempts: 0 };
  let phase = 'before_dispatch', ip, poll, explicitFailure, identity, reason, httpFailure;
  function confirm() {
    try { check(recheck() === approvedHash, 'execution_inputs_changed'); }
    catch { throw Error('execution_inputs_changed'); }
  }
  function available(ms = 0) {
    const current = now();
    check(Number.isFinite(current) && current >= startedAt && current < deadline && current + ms <= deadline, 'stage_deadline');
  }
  // The shared protocol maps transport exceptions to a fixed error. Keep the local gate's reason separately.
  function gate(work) {
    try { return work(); } catch (error) { explicitFailure = error.message; throw error; }
  }
  confirm();
  available(LIMITS.dnsMs + LIMITS.getMs);
  absent(session);
  const disk = writer(root, recordCaps);
  const rows = [disk.write('login-approval.json', approval)];
  try {
    try { disk.syncParent(); } catch { throw Error('login_parent_sync_unconfirmed'); }
    await runWebLogin02({ now, deadline, sleep, beginBrowser,
      lookup(host, options, callback) {
        phase = 'dns';
        gate(() => {
          check(counts.dns_calls === 0 && host === NPM_REGISTRY_HOST && options.family === 4 && options.all === false, 'login03_dns_scope');
          confirm();
          available(LIMITS.dnsMs);
        });
        counts.dns_calls++;
        return adapter.lookup(host, options, (error, address, family) => {
          if (!error && family === 4 && net.isIPv4(address)) ip = address;
          callback(error, address, family);
        });
      },
      request(options, callback) {
        const post = options.method === 'POST';
        phase = post ? 'before_post' : 'before_get';
        gate(() => {
          confirm();
          available(LIMITS.getMs);
          check(counts.dns_calls === 1 && counts.secondary_lookup_attempts === 0 && ip && options.hostname === ip &&
            options.servername === NPM_REGISTRY_HOST && options.port === 443 && options.family === 4 && options.agent === false &&
            options.autoSelectFamily === false && options.rejectUnauthorized === true && options.maxHeaderSize === LIMITS.headerBytes &&
            !Object.hasOwn(options.headers, 'authorization') && !Object.hasOwn(options.headers, 'npm-auth-type'), 'login03_transport_scope');
          if (post) {
            check(counts.post_attempts === 0 && options.path === LOGIN_START_PATH, 'login03_transport_scope');
          } else {
            check(options.method === 'GET' && counts.post_attempts === 1 && counts.get_attempts < MAX_POLLS &&
              /^\/-\/v1\/done[/?]/.test(options.path) && (poll === undefined || poll === options.path), 'login03_transport_scope');
          }
        });
        if (post) {
          options.headers['npm-auth-type'] = 'web';
          counts.post_attempts++;
        } else {
          poll = options.path;
          counts.get_attempts++;
        }
        phase = post ? 'login_post' : 'poll_get';
        const refuseLookup = options.lookup;
        return adapter.request({ ...options, lookup: (...args) => { counts.secondary_lookup_attempts++; return refuseLookup(...args); } }, callback);
      },
      writeSession(token) {
        phase = 'before_session_create';
        gate(() => { confirm(); available(); absent(session); });
        phase = 'session_save';
        writePrivateSession(session, token);
        writer(session, {}).syncParent();
        const observed = inspectPrivateSession(session);
        check(observed.token === token, 'login03_session_changed');
        identity = observed.identity;
      },
    });
    phase = 'final_verification';
    confirm();
    check(counts.dns_calls === 1 && counts.post_attempts === 1 && counts.get_attempts > 0 && counts.secondary_lookup_attempts === 0, 'login03_transport_scope');
    check(identity && planHash(inspectPrivateSession(session).identity) === planHash(identity), 'login03_session_changed');
    available();
  } catch (error) {
    httpFailure = loginHttpFailure(error);
    reason = explicitFailure ?? (protocolFailure.test(error.message) || ['login_parent_sync_unconfirmed', 'login03_session_changed',
      'execution_inputs_changed', 'stage_deadline', 'login03_transport_scope'].includes(error.message) ? error.message : 'execution_stopped');
  }

  const summary = { id: LOGIN03_ID, approval_sha256: approvedHash, status: reason ? 'stopped' : 'session_verified',
    phase, reason: reason ?? null, counts, session_file_state: sessionPresence(session), elapsed_ms_at_status: Math.ceil(now() - startedAt),
    approval_consumed: true, no_retry: true, cumulative_reserved: allocation.cumulative, protected_765_bytes_used: 0,
    STOP_preserved: true, preflight_approved: false, publication_approved: false, ...(httpFailure && { http_failure: httpFailure }) };
  let readback = null, proof = null;
  try {
    if (!reason) proof = randomBytes(32).toString('hex');
    rows.push(disk.write('login-status.json', { ...summary, session_identity: proof ? identity : null }));
    disk.verify(rows);
    readback = disk.write('login-readback.json', { id: LOGIN03_ID, status: summary.status, approval_sha256: approvedHash,
      verified: true, rows, completion_proof_sha256: proof ? sha(proof) : null, publication_approved: false });
  } catch {
    return { ...summary, status: 'stopped', reason: 'record_readback_unconfirmed', session_file_state: sessionPresence(session),
      readback: null, proof_issued: false };
  }
  if (!proof) return { ...summary, readback, proof_issued: false };
  try {
    confirm();
    check(planHash(inspectPrivateSession(session).identity) === planHash(identity), 'login03_session_changed');
    try { disk.verify([...rows, readback]); }
    catch { throw Error('record_readback_unconfirmed'); }
    available();
  } catch (error) {
    const code = ['execution_inputs_changed', 'stage_deadline', 'record_readback_unconfirmed'].includes(error.message)
      ? error.message : 'login03_session_changed';
    return { ...summary, status: 'stopped', phase: 'proof_release', reason: code,
      session_file_state: sessionPresence(session), readback: code === 'record_readback_unconfirmed' ? null : readback, proof_issued: false };
  }
  try { presentProof(proof); }
  catch {
    return { ...summary, status: 'stopped', phase: 'proof_release', reason: 'local_proof_presentation_unconfirmed',
      session_file_state: sessionPresence(session), readback, proof_issued: false };
  }
  return { ...summary, status: 'login_confirmed', readback, proof_issued: true };
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), root = path.join(repo, '.release-work', LOGIN03_ID);
  checkTransportEnvironment();
  if (mode === '--prepare-proof-recheck' && approvedHash === undefined) return prepareRevision(repo, root);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--login' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'login03_unsupported_mode');
  absent(sessionRoot);
  checkPreparationFiles(root, preparation);
  const plan = verifyPreparation(repo, root);
  if (mode === '--check') return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  check(isatty(0) && isatty(1) && planHash(plan) === approvedHash, 'login03_local_terminal_or_approval_unconfirmed');
  const tty = fs.openSync('/dev/tty', fs.constants.O_WRONLY | fs.constants.O_NOCTTY);
  function show(message) {
    const bytes = Buffer.from(message);
    check(fs.writeSync(tty, bytes) === bytes.length, 'login03_terminal_write_unconfirmed');
  }
  try {
    return await executeLogin03({ root, session: sessionRoot, plan, approvedHash, startedAt, adapter: { lookup, request },
      recheck: () => planHash(verifyPreparation(repo, root)),
      beginBrowser(url) { show('\nOpen this npm authentication URL and complete 2FA:\n' + url + '\n'); },
      presentProof(proof) { show('\nLocal login completion proof:\n' + proof + '\n'); },
    });
  } finally { fs.closeSync(tty); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped') process.exitCode = 1;
  } catch { console.log(JSON.stringify({ status: 'stopped', reason: 'login03_local_preconditions_unconfirmed' })); process.exitCode = 1; }
}
