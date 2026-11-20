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
import { A_RECORDS, CAPACITY, snapshot } from './prepare-npm-session-release.mjs';
import { LOGIN_ID, PREFLIGHT_ID, LOGIN_POST_BODY, LOGIN_START_PATH, LOGIN02_POST_STATUSES, NPM_REGISTRY_HOST,
  loginRequestOptions, loginHeaderBytes, loginEndpoints } from './npm-session-release.mjs';
import { LOGIN02, approvalRecord, planHash, readRecord, writer } from './run-npm-session-release.mjs';
import { LOGIN03_ID } from './run-npm-login03.mjs';
import { DIAGNOSTIC_ID as HEADER_ID, CAPS as HEADER_CAPS } from './run-npm-login-header01.mjs';

const KiB = 1024;
export const POLL_ID = 'package-2026-11-19-publish-0.1.46-login-poll01';
export const CAPS = Object.freeze({ 'reservation.json': 2 * KiB, 'inputs.json': 3 * KiB,
  'preparation-tests.json': 2 * KiB, 'preparation-readback.json': KiB,
  'communication-approval.json': 4 * KiB, 'communication-status.json': 2 * KiB, 'communication-readback.json': 2 * KiB });
const preparation = ['reservation.json', 'inputs.json', 'preparation-tests.json', 'preparation-readback.json'];
const testFiles = ['test/release/prepare-npm-preflight.test.mjs', 'test/release/run-npm-preflight.test.mjs',
  'test/release/npm-session-release.test.mjs', 'test/release/run-npm-session-release.test.mjs', 'test/release/run-npm-login02.test.mjs',
  'test/release/run-npm-login-header01.test.mjs', 'test/release/run-npm-login03.test.mjs', 'test/release/run-npm-login-poll01.test.mjs'];
const sources = ['scripts/run-npm-login-poll01.mjs', 'scripts/run-npm-login03.mjs', 'scripts/run-npm-login-header01.mjs',
  'scripts/run-npm-session-release.mjs', 'scripts/npm-session-release.mjs', 'scripts/prepare-npm-session-release.mjs',
  'scripts/prepare-npm-preflight.mjs', 'scripts/run-npm-preflight.mjs', 'scripts/publish-verified-tarball.mjs',
  'scripts/package-approval.mjs', 'scripts/package-verifier-core.mjs', ...testFiles];
const history = Object.freeze({
  [LOGIN_ID]: '78c87158d57bce30b36b75f0c99a9a540150aac7ef9feb942fcb0414f21798e1',
  [LOGIN02.id]: '13ae3217c85db33bdef3aa4bb655c74d14b3b10bb645081680719c86d6bb72ae',
  [HEADER_ID]: 'cc58678cb25a2d6366500fa91ffd6155f3571c28b2a7678b5150e7132b7d084c',
  [LOGIN03_ID]: 'fd0d8aa12e2eab385f6e1c24992d37603a426159da7462894d38d291f1ea83df',
});
const reservationAnchor = 'c2abbf7150d3fe5526470fe2a823e9914534a01ac5df0ac77acac21cbc5c1df7';
const allocation = Object.freeze({ old_cumulative: 50154482, reservation: 16 * KiB, cumulative: 50170866,
  remaining_pool: 30939977, campaign_cap: CAPACITY.cap, preparation: 8 * KiB, communication: 8 * KiB,
  protected_765_bytes_used: 0 });
const scope = Object.freeze({ baseline: LOGIN03_ID, host: NPM_REGISTRY_HOST, port: 443, family: 4, dns_calls: 1,
  post: { attempts: 1, path: LOGIN_START_PATH, body: LOGIN_POST_BODY, header: ['npm-auth-type', 'web'], statuses: LOGIN02_POST_STATUSES },
  get: { attempts: 1, route: 'validated and normalized POST doneUrl', body_statuses: [200, 202] },
  put_attempts: 0, retry: false, redirects: false, browser: false, credential_file: false,
  ip_and_tls_hostname_pinned: true, before_each_dispatch_recheck: true, full_request_windows: true, hard_process_deadline: false,
  retained_response_fields: ['http_status', 'body_shape', 'token_key', 'retry_after', 'reason'],
  retry_after_order: ['raw duplicate before body', 'single syntax after object without token'], terminal_after_first_get: true });
const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const size = value => Buffer.byteLength(JSON.stringify(value) + '\n');

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('scope_already_exists');
}

function exactFiles(root, expected) {
  const files = fs.readdirSync(root);
  check(files.length === expected.length && files.every(file => expected.includes(file)), 'scope_consumed_or_changed');
}

function inputsFor(repo, root) {
  const base = path.dirname(root);
  absent(path.join(base, PREFLIGHT_ID));
  for (const [id, anchor] of Object.entries(history)) {
    const current = path.join(base, id);
    const header = id === HEADER_ID, prefix = header ? 'communication' : 'login', caps = header ? HEADER_CAPS : A_RECORDS;
    const receipt = readRecord(current, `${prefix}-readback.json`, caps);
    const doc = receipt.data;
    check(receipt.evidence.sha256 === anchor && doc.verified && doc.rows.length === 2, 'prior_record_changed');
    const [approval, status] = ['approval', 'status'].map((part, i) => readRecord(current, `${prefix}-${part}.json`, caps, doc.rows[i]).data);
    check(approval.id === id && approval.consumed && planHash(approval.plan) === approval.approved_hash &&
      approval.approved_hash === status.approval_sha256 && status.approval_consumed && status.STOP_preserved &&
      status.no_retry && status.protected_765_bytes_used === 0 && !status.publication_approved, 'prior_record_unconfirmed');
    if (header) {
      check(status.status === 'response_observed' && status.http_status === 200, 'header_diagnostic_unconfirmed');
    } else {
      check(doc.status === 'stopped' && status.status === 'stopped' && doc.completion_proof_sha256 === null, 'prior_stop_unconfirmed');
      if (id === LOGIN03_ID) check(status.reason === 'login_response_shape' && status.phase === 'poll_get' &&
        status.counts.dns_calls === 1 && status.counts.post_attempts === 1 && status.counts.get_attempts === 1 &&
        status.counts.put_attempts === 0 && status.session_file_state === 'absent' && !status.preflight_approved, 'baseline_stop_unconfirmed');
    }
  }
  const prior = readRecord(path.join(base, LOGIN03_ID), 'reservation.json', A_RECORDS);
  const a = prior.data.allocation;
  const total = files => files.reduce((sum, file) => sum + CAPS[file], 0);
  check(prior.evidence.sha256 === reservationAnchor && a.cumulative === allocation.old_cumulative &&
    a.remaining_pool - allocation.reservation === allocation.remaining_pool && a.protected_765_bytes_used === 0 &&
    a.cumulative + allocation.reservation === allocation.cumulative && total(preparation) === allocation.preparation &&
    total(Object.keys(CAPS)) === allocation.reservation && allocation.preparation + allocation.communication === allocation.reservation &&
    allocation.cumulative + allocation.remaining_pool + CAPACITY.fixed_margin + CAPACITY.unallocated === allocation.campaign_cap, 'capacity_changed');
  const current = snapshot(repo);
  const tools = sources.map(file => [file, sha(readRegular(path.join(repo, file), 64 * KiB))]);
  return { id: POLL_ID, record_root: root, candidate: current.candidate, artifact_sha256: current.artifact_sha256,
    inventory_sha256: current.inventory_sha256, npm_version: current.npm_version, history,
    prior_reservation_sha256: reservationAnchor, tool_fingerprints_sha256: planHash(tools), scope, limits: LIMITS,
    allocation, record_limits: CAPS, STOP_preserved: true, preflight_approved: false, publication_approved: false };
}

function prepare(repo, root) {
  absent(root);
  const before = inputsFor(repo, root);
  check(size(before) <= CAPS['inputs.json'], 'input_record_limit');
  fs.mkdirSync(root, { mode: 0o700 });
  const disk = writer(root, CAPS);
  const rows = [disk.write('reservation.json', { id: POLL_ID, allocation, record_limits: CAPS,
    preparation_approved: true, communication_approved: false, STOP_preserved: true })];
  disk.syncParent();
  const inputs = disk.write('inputs.json', before);
  rows.push(inputs);
  let status = 'stopped', passed = 0, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles],
      { cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash(inputsFor(repo, root));
    check(after === inputs.sha256, 'preparation_inputs_changed');
    exactFiles(root, preparation.slice(0, 2));
    status = 'prepared';
  } catch { /* Persist the stopped preparation without diagnostics or a network attempt. */ }
  rows.push(disk.write('preparation-tests.json', { id: POLL_ID, status, passed, network_calls: 0,
    input_before_sha256: inputs.sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write('preparation-readback.json', { id: POLL_ID, status, verified: true, rows,
    communication_approval_consumed: false, STOP_preserved: true });
  if (status === 'prepared') verifyPreparation(repo, root);
  return { id: POLL_ID, status, passed, readback, cumulative_reserved: allocation.cumulative };
}

function verifyPreparation(repo, root) {
  const receipt = readRecord(root, 'preparation-readback.json', CAPS);
  const r = receipt.data;
  check(r.id === POLL_ID && r.verified && r.status === 'prepared' && r.STOP_preserved &&
    r.communication_approval_consumed === false && r.rows.length === 3, 'preparation_unconfirmed');
  const [reservation, inputs, tests] = preparation.slice(0, 3).map((file, i) => readRecord(root, file, CAPS, r.rows[i]));
  const t = tests.data;
  check(reservation.data.id === POLL_ID && reservation.data.preparation_approved && reservation.data.communication_approved === false &&
    planHash(reservation.data.allocation) === planHash(allocation) && planHash(reservation.data.record_limits) === planHash(CAPS) &&
    t.id === POLL_ID && t.status === 'prepared' && t.network_calls === 0 && Number.isSafeInteger(t.passed) && t.passed > 0 &&
    t.input_before_sha256 === inputs.evidence.sha256 && t.input_after_sha256 === inputs.evidence.sha256 &&
    inputs.evidence.sha256 === planHash(inputsFor(repo, root)), 'preparation_binding_changed');
  const plan = { id: POLL_ID, record_root: root, candidate: inputs.data.candidate, artifact_sha256: inputs.data.artifact_sha256,
    history, scope, limits: LIMITS, allocation, record_limits: CAPS, STOP_preserved: true, preflight_approved: false,
    publication_approved: false, reservation_sha256: reservation.evidence.sha256, inputs_sha256: inputs.evidence.sha256,
    tests_sha256: tests.evidence.sha256, preparation_readback_sha256: receipt.evidence.sha256 };
  check(size(approvalRecord(POLL_ID, plan, planHash(plan))) <= CAPS['communication-approval.json'], 'communication_approval_limit');
  return plan;
}

// Match the login03 lexer without changing its already-anchored source file.
function parseJson(bytes) {
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw Error('invalid_utf8'); }
  try { value = JSON.parse(text); }
  catch { throw Error('invalid_json'); }
  const lexeme = /[\t\n\r ]+|"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]:,]|[^"{}\[\]:,\s]+/y;
  const colon = /[\t\n\r ]*:/y;
  const containers = [];
  while (lexeme.lastIndex < text.length) {
    const match = lexeme.exec(text);
    check(match, 'invalid_json');
    const item = match[0];
    if (item === '{') containers.push(new Set());
    else if (item === '[') containers.push(null);
    else if (item === '}' || item === ']') containers.pop();
    else if (item.startsWith('"') && containers.at(-1)) {
      colon.lastIndex = lexeme.lastIndex;
      if (!colon.test(text)) continue;
      const key = JSON.parse(item), keys = containers.at(-1);
      check(!keys.has(key), 'duplicate_json_key');
      keys.add(key);
    }
  }
  return value;
}

function shapeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function classifyPoll(bytes, observation, retryAfter) {
  const value = parseJson(bytes);
  observation.body_shape = shapeOf(value);
  check(observation.body_shape === 'object', 'login_response_shape');
  observation.token_key = Object.hasOwn(value, 'token') ? 'present' : 'absent';
  if (observation.http_status === 202) {
    check(observation.token_key === 'absent', 'login_response_shape');
    if (retryAfter !== undefined) {
      observation.retry_after = /^(?:0|[1-9][0-9]{0,3})$/.test(retryAfter) ? 'valid' : 'invalid';
      check(observation.retry_after === 'valid', 'login_poll_interval_unconfirmed');
    }
  }
}

function remaining(now, deadline, duration = 0) {
  const current = now();
  check(Number.isFinite(current) && current < deadline && current + duration <= deadline, 'stage_deadline');
  return current;
}

function bounded(now, deadline, duration, timeout, start) {
  const expires = remaining(now, deadline, duration) + duration;
  return new Promise((resolve, reject) => {
    let settled = false;
    function done(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (now() >= expires) reject(Error(timeout));
      else if (error) reject(error);
      else resolve(value);
    }
    const timer = setTimeout(() => done(Error(timeout)), duration);
    try { start(done, () => settled || now() >= expires); } catch { done(Error('transport_error')); }
  });
}

function exchange({ adapter, now, deadline, address, counts, route, observation }) {
  const post = route === undefined;
  let req, res, closed = false;
  return bounded(now, deadline, LIMITS.getMs, 'http_timeout', (done, expired) => {
    let sockets = 0, secure = false;
    const stop = reason => done(Error(reason));
    const options = loginRequestOptions(post ? 'POST' : 'GET', post ? LOGIN_START_PATH : route, address, (_host, _opts, cb) => {
      counts.refused_additional_lookups++;
      stop('additional_lookup_refused');
      cb(Error('additional_lookup_refused'));
    });
    if (post) options.headers['npm-auth-type'] = 'web';
    counts[post ? 'post_attempts' : 'get_attempts']++;
    req = adapter.request(options, incoming => {
      incoming.on('error', () => stop('response_unconfirmed'));
      if (closed || expired()) { incoming.destroy(); return; }
      res = incoming;
      if (!secure || sockets !== 1) return stop('tls_peer_unconfirmed');
      const status = res.statusCode;
      if (!Number.isInteger(status) || status < 200 || status > 599) return stop('invalid_final_status');
      if (loginHeaderBytes(status, res.statusMessage, res.rawHeaders) > LIMITS.headerBytes) return stop('response_header_limit');
      observation.http_status = status;
      if (post ? !LOGIN02_POST_STATUSES.includes(status) : status !== 200 && status !== 202) return stop('http_status');
      let retryAfter;
      if (!post && status === 202) {
        const fields = res.rawHeaders;
        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i].toLowerCase() !== 'retry-after') continue;
          if (retryAfter !== undefined) {
            observation.retry_after = 'duplicate';
            return stop('login_poll_interval_unconfirmed');
          }
          if (typeof fields[i + 1] !== 'string') return stop('response_unconfirmed');
          retryAfter = fields[i + 1];
        }
        if (retryAfter === undefined) observation.retry_after = 'missing';
      }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') return stop('response_encoding');
      const length = res.headers['content-length'];
      if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > LIMITS.bodyBytes)) return stop('response_body_limit');
      const chunks = [];
      let received = 0;
      res.on('data', chunk => {
        if (expired()) return;
        if (received + chunk.length > LIMITS.bodyBytes) return stop('response_body_limit');
        received += chunk.length;
        chunks.push(chunk);
      });
      res.once('aborted', () => stop('response_incomplete'));
      res.once('close', () => { if (!res.complete) stop('response_incomplete'); });
      res.once('end', () => {
        if (expired()) return;
        if (!res.complete || (length !== undefined && received !== Number(length))) return stop('response_incomplete');
        try {
          const bytes = Buffer.concat(chunks, received);
          if (post) {
            const value = parseJson(bytes);
            check(shapeOf(value) === 'object' && Object.hasOwn(value, 'loginUrl') && Object.hasOwn(value, 'doneUrl'), 'login_response_shape');
            const { poll } = loginEndpoints(value.loginUrl, value.doneUrl);
            return done(null, poll);
          }
          classifyPoll(bytes, observation, retryAfter);
          done(null);
        } catch (error) { done(error); }
      });
    });
    req.on('socket', socket => {
      if (++sockets !== 1) { stop('additional_socket_refused'); req.destroy(); return; }
      socket.once('secureConnect', () => { secure = socket.authorized === true && socket.remoteAddress === address; });
    });
    req.once('upgrade', (_response, socket) => { socket.destroy(); stop('http_upgrade_refused'); });
    req.once('error', error => stop(error?.code === 'HPE_HEADER_OVERFLOW' ? 'response_header_limit' : 'transport_error'));
    req.once('close', () => stop('response_unconfirmed'));
    req.end(post ? LOGIN_POST_BODY : undefined);
  }).finally(() => { closed = true; res?.destroy(); req?.destroy(); });
}

const safeReasons = new Set(['approval_sync_unconfirmed', 'execution_inputs_changed', 'stage_deadline', 'dns_timeout', 'dns_unconfirmed',
  'http_timeout', 'http_status', 'additional_lookup_refused', 'additional_socket_refused', 'http_upgrade_refused', 'transport_error',
  'response_unconfirmed', 'tls_peer_unconfirmed', 'invalid_final_status', 'response_header_limit', 'response_body_limit',
  'response_encoding', 'response_incomplete', 'invalid_utf8', 'invalid_json', 'duplicate_json_key', 'login_url_rejected',
  'login_response_shape', 'login_poll_interval_unconfirmed']);

export async function executePollDiagnostic({ root, plan, approvedHash, recheck, adapter,
  now = () => performance.now(), startedAt = now() }) {
  const deadline = startedAt + LIMITS.stageMs;
  const approval = approvalRecord(POLL_ID, plan, approvedHash);
  function confirm() {
    try { check(recheck() === approvedHash, 'execution_inputs_changed'); }
    catch { throw Error('execution_inputs_changed'); }
  }
  confirm();
  remaining(now, deadline, LIMITS.dnsMs + 2 * LIMITS.getMs);
  const disk = writer(root, CAPS);
  const rows = [disk.write('communication-approval.json', approval)];
  const counts = { dns_calls: 0, post_attempts: 0, get_attempts: 0, put_attempts: 0, refused_additional_lookups: 0 };
  const post = { http_status: null };
  const poll = { http_status: null, body_shape: 'unclassified', token_key: 'unclassified', retry_after: 'unclassified' };
  let phase = 'before_dispatch', reason = null;
  try {
    try { disk.syncParent(); } catch { throw Error('approval_sync_unconfirmed'); }
    confirm();
    phase = 'dns';
    const address = await bounded(now, deadline, LIMITS.dnsMs, 'dns_timeout', done => {
      counts.dns_calls++;
      adapter.lookup(NPM_REGISTRY_HOST, { family: 4, all: false }, (error, ip, family) => {
        if (error || family !== 4 || !net.isIPv4(ip)) return done(Error('dns_unconfirmed'));
        done(null, ip);
      });
    });
    phase = 'before_post';
    confirm();
    phase = 'login_post';
    const route = await exchange({ adapter, now, deadline, address, counts, observation: post });
    phase = 'before_get';
    confirm();
    phase = 'poll_get';
    await exchange({ adapter, now, deadline, address, counts, route, observation: poll });
    confirm();
    remaining(now, deadline);
  } catch (error) { reason = safeReasons.has(error?.message) ? error.message : 'diagnostic_stopped'; }

  const result = { id: POLL_ID, approval_sha256: approvedHash, phase, status: reason ? 'stopped' : 'response_observed',
    reason, counts, post, poll, approval_consumed: true, no_retry: true, cumulative_reserved: allocation.cumulative,
    protected_765_bytes_used: 0, STOP_preserved: true, preflight_approved: false, publication_approved: false };
  try {
    rows.push(disk.write('communication-status.json', result));
    disk.verify(rows);
    const readback = disk.write('communication-readback.json', { id: POLL_ID, observation_status: result.status,
      verified: true, rows, approval_consumed: true });
    disk.verify([...rows, readback]);
    if (now() >= deadline && reason === null) return { ...result, status: 'stopped', reason: 'readback_deadline', readback };
    return { ...result, status: reason ? 'stopped' : 'diagnostic_complete', readback };
  } catch { return { ...result, status: 'stopped', reason: 'record_readback_unconfirmed' }; }
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), root = path.join(repo, '.release-work', POLL_ID);
  checkTransportEnvironment();
  if (mode === '--prepare' && approvedHash === undefined) return prepare(repo, root);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--probe' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'unsupported_mode');
  exactFiles(root, preparation);
  const plan = verifyPreparation(repo, root);
  if (mode === '--check') return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  return executePollDiagnostic({ root, plan, approvedHash, startedAt, adapter: { lookup, request },
    recheck: () => planHash(verifyPreparation(repo, root)) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped') process.exitCode = 1;
  } catch { console.log(JSON.stringify({ status: 'stopped', reason: 'diagnostic_local_preconditions_unconfirmed' })); process.exitCode = 1; }
}
