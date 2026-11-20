import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { isatty } from 'node:tty';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRegular } from './package-approval.mjs';
import { LIMITS, ROUTES as PREFLIGHT_ROUTES } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { A_RECORDS, CAPACITY } from './prepare-npm-session-release.mjs';
import { ACCOUNT, NPM_REGISTRY_HOST, LOGIN_START_PATH, MAX_POLLS, SESSION_BYTES,
  writePrivateSession, inspectPrivateSession, privateSessionIdentity, runSessionPreflight } from './npm-session-release.mjs';
import { planHash, readRecord, writer } from './run-npm-session-release.mjs';
import { runLogin04Protocol, login04HttpFailure } from './npm-login04-protocol.mjs';
import { verifyRebind02 } from './run-npm-prep04.mjs';
import { HISTORY as PUB01_HISTORY } from './run-npm-pub01.mjs';
import { PLAN as TARBALL, ROUTES as PUBLISH_ROUTES, buildPublishEntity, verifyArtifact, verifyReadbackMetadata } from './publish-verified-tarball.mjs';
import { PUBLISH_LIMITS, CONFIRM_PHRASE, requestOptions, exchange, classifyPut, classifyOtpPoll, validateTotp } from './npm-publish-protocol.mjs';

// One approved run: login08 obtains a fresh npm session, the four read-only
// preflight GETs are repeated, the operator types the confirmation phrase, and
// the verified 0.1.46 tarball is published with at most two PUTs (the second
// only after the registry asks for a one-time password). Readback is read-only.
// Nothing is ever resent automatically. pub02 differs from pub01 only in the
// local prompts: surrounding whitespace is ignored and up to three entries are
// allowed, because pub01 stopped on a confirmation typed with a leading space.
const KiB = 1024;
export const LOGIN08_ID = 'package-2026-11-20-publish-0.1.46-login08';
export const PUB02_ID = 'package-2026-11-20-publish-0.1.46-pub02';
export const SESSION08_ROOT = '/private/tmp/TradingView-MCP-npm-0.1.46-login08';
export const SESSION_MS = 2 * 60 * 60 * 1000;
export const CONFIRM_MS = 120000;
export const CONFIRM_ATTEMPTS = 3;
export const PUBLISH_STAGE_MS = 300000;
export const READBACK_DELAY_MS = 5000;
const ARTIFACT = '.release-work/package-2026-11-18-reverify-r02/artifact/verified-0.1.46.tgz';
const configFile = 'user.npmrc';
const preparation = ['reservation.json', 'preparation-inputs.json', 'preparation-tests.json', 'preparation-readback.json'];
const execution = ['login-approval.json', 'login-status.json', 'login-readback.json'];
export const PUB_RECORDS = Object.freeze({ 'approval-publication.json': 8 * KiB, 'login-binding.json': 4 * KiB,
  'account.json': 8 * KiB, 'rights.json': 8 * KiB, 'version.json': 8 * KiB, 'tag.json': 8 * KiB, 'preflight-status.json': 8 * KiB,
  'confirmation.json': 4 * KiB, 'send-1.json': 8 * KiB, 'otp.json': 4 * KiB, 'send-2.json': 8 * KiB,
  'readback-version.json': 8 * KiB, 'readback-tag.json': 8 * KiB, 'readback-tarball.json': 8 * KiB,
  'publication-status.json': 20 * KiB, 'publication-readback.json': 8 * KiB });
export const TESTS = Object.freeze(['test/release/prepare-npm-preflight.test.mjs', 'test/release/run-npm-preflight.test.mjs',
  'test/release/npm-session-release.test.mjs', 'test/release/run-npm-session-release.test.mjs',
  'test/release/run-npm-login04.test.mjs', 'test/release/run-npm-prep04.test.mjs', 'test/release/packagePublish.test.mjs',
  'test/release/npm-publish-protocol.test.mjs', 'test/release/run-npm-pub01.test.mjs',
  'test/release/run-npm-pub02.test.mjs']);
const sources = ['scripts/run-npm-pub02.mjs', 'scripts/run-npm-pub01.mjs', 'scripts/npm-publish-protocol.mjs', 'scripts/run-npm-prep04.mjs',
  'scripts/publish-verified-tarball.mjs', 'scripts/npm-login04-protocol.mjs', 'scripts/npm-session-release.mjs',
  'scripts/run-npm-session-release.mjs', 'scripts/prepare-npm-session-release.mjs', 'scripts/prepare-npm-preflight.mjs',
  'scripts/run-npm-preflight.mjs', 'scripts/package-approval.mjs', 'scripts/package-verifier-core.mjs', ...TESTS];

// Immutable prior runs: pub01's history plus login07 and pub01 themselves.
const LOGIN07_ID = 'package-2026-11-20-publish-0.1.46-login07';
const PUB01_ID = 'package-2026-11-20-publish-0.1.46-pub01';
export const HISTORY = Object.freeze({ ...PUB01_HISTORY,
  [LOGIN07_ID]: ['login-readback.json', '4039f39be82c8b423590f92cf04fb0eeb3d9835c1183941d769d7dbd389dae08'],
  [PUB01_ID]: ['publication-readback.json', '0ef0aa3db7b4bcc05fbbbdb33f8b8f836d28efe93e1721d0a7b93dbafa070cba'] });
const login07Reservation = 'b7b8ab85516698c7a736d6125fea836e9fd9ae4c92f4e0dfdd16ea4d60ae59e8';
export const ALLOCATION = Object.freeze({ prior_cumulative: 50629618, reservation: 192 * KiB, cumulative: 50826226,
  remaining_pool: 30284617, campaign_cap: CAPACITY.cap, preparation: 32 * KiB, execution: 16 * KiB,
  private_session: SESSION_BYTES, publication_records: 128 * KiB, protected_765_bytes_used: 0 });
export const PUBLICATION = Object.freeze({ name: TARBALL.name, version: TARBALL.version, tag: TARBALL.tag, access: 'public',
  route: PUBLISH_ROUTES.publish, max_put_attempts: 2, second_put: 'only after a registry one-time-password challenge',
  otp: 'web flow in the operator browser, or an authenticator code typed hidden on the terminal; never recorded',
  otp_code_entries_max: CONFIRM_ATTEMPTS, confirmation_phrase: CONFIRM_PHRASE,
  confirmation_match: 'exact phrase; surrounding whitespace ignored', confirmation_attempts_max: CONFIRM_ATTEMPTS, readback: ['version', 'tag', 'tarball'], readback_attempts_each: 1,
  resend: 'never; an unanswered PUT is classified only by read-only readback' });
const scope = Object.freeze({
  login: { host: NPM_REGISTRY_HOST, dns_calls: 1, post_attempts: 1, post_path: LOGIN_START_PATH, max_poll_gets: MAX_POLLS,
    protocol: 'npm-login04-protocol', browser: 'validated npm URL on the local terminal; operator completes 2FA' },
  registry: { host: NPM_REGISTRY_HOST, dns_calls: 1, preflight_gets: 4, put_attempts_max: 2,
    otp_poll_gets_max: PUBLISH_LIMITS.maxOtpPolls, readback_gets_max: 3, pinned_address: true, account: ACCOUNT,
    admission: 'login08 readback, session identity and UTC deadline verified before DNS' },
  redirects: false, automatic_retry: false });
const timeContract = Object.freeze({ login_stage_ms: LIMITS.stageMs, preflight_stage_ms: LIMITS.stageMs,
  confirmation_ms: CONFIRM_MS, publish_stage_ms: PUBLISH_STAGE_MS, put_timeout_ms: PUBLISH_LIMITS.putMs,
  readback_delay_ms: READBACK_DELAY_MS, readback_stage_ms: LIMITS.stageMs,
  clock: 'monotonic stage windows from CLI entry, login completion, preflight completion, confirmation and readback start',
  utc: 'Date.now on the operator host', session_deadline: 'UTC login start + 2 hours' });

const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const size = value => Buffer.byteLength(JSON.stringify(value) + '\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const total = (caps, files = Object.keys(caps)) => files.reduce((sum, file) => sum + caps[file], 0);

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw Error('pub02_scope_exists');
}

function exactFiles(root, expected) {
  const names = fs.readdirSync(root);
  check(names.length === expected.length && names.every(name => expected.includes(name)), 'pub02_scope_consumed_or_changed');
}

export function checkAllocationArithmetic() {
  const a = ALLOCATION;
  check(total(A_RECORDS, preparation) === a.preparation && total(A_RECORDS, execution) === a.execution &&
    total(A_RECORDS) === a.preparation + a.execution && total(PUB_RECORDS) === a.publication_records &&
    a.preparation + a.execution + a.private_session + a.publication_records === a.reservation &&
    a.prior_cumulative + a.reservation === a.cumulative && a.cumulative + a.remaining_pool + CAPACITY.fixed_margin + CAPACITY.unallocated === a.campaign_cap &&
    a.protected_765_bytes_used === 0, 'pub02_allocation_changed');
}

// The new reservation must extend exactly the latest recorded allocation (login07).
export function checkAllocationChain(previous) {
  checkAllocationArithmetic();
  check(previous && previous.cumulative === ALLOCATION.prior_cumulative && previous.remaining_pool - ALLOCATION.reservation === ALLOCATION.remaining_pool &&
    previous.campaign_cap === ALLOCATION.campaign_cap && previous.protected_765_bytes_used === 0, 'pub02_allocation_changed');
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
  // login07 succeeded; pub01 confirmed the preflight and stopped at the confirmation prompt, with no PUT.
  const status07 = JSON.parse(readRegular(path.join(base, LOGIN07_ID, 'login-status.json'), 16 * KiB));
  const status01 = JSON.parse(readRegular(path.join(base, PUB01_ID, 'publication-status.json'), 16 * KiB));
  const confirmation01 = JSON.parse(readRegular(path.join(base, PUB01_ID, 'confirmation.json'), 4 * KiB));
  check(status07.status === 'session_verified' && status07.approval_consumed && status07.no_retry &&
    status07.publication_approved === true && status07.cumulative_reserved === ALLOCATION.prior_cumulative &&
    status01.status === 'stopped' && status01.stage === 'confirmation' && status01.reason === 'publish_not_confirmed' &&
    status01.outcome === 'not_sent' && status01.counts.get_attempts === 4 && status01.counts.put_attempts === 0 &&
    status01.no_retry && status01.cumulative_reserved === ALLOCATION.prior_cumulative &&
    confirmation01.confirmed === false && confirmation01.within_window === true, 'prior_run_unconfirmed');
  const reservation = readRegular(path.join(base, LOGIN07_ID, 'reservation.json'), 8 * KiB);
  check(sha(reservation) === login07Reservation, 'allocation_history_changed');
  checkAllocationChain(JSON.parse(reservation).allocation);
}

function releaseFiles(repo) {
  const artifact = readRegular(path.join(repo, ARTIFACT), PUBLISH_LIMITS.tarballBytes);
  verifyArtifact(artifact);
  const manifestBytes = readRegular(path.join(repo, 'package.json'), 64 * KiB);
  const manifest = JSON.parse(manifestBytes);
  check(manifest.name === TARBALL.name && manifest.version === TARBALL.version && !manifest.private, 'pub02_manifest_changed');
  return { artifact, manifest, manifestSha: sha(manifestBytes) };
}

// Deterministic, offline and read-only: re-evaluated before every network dispatch.
// Scope absence is checked by the callers, because the run creates its own records.
export function inputsFor(repo) {
  const base = path.join(repo, '.release-work');
  verifyHistory(base);
  const rebind = verifyRebind02(repo);
  const { artifact, manifestSha } = releaseFiles(repo);
  check(rebind.artifact_sha256 === sha(artifact) && rebind.artifact_bytes === artifact.length, 'pub02_artifact_changed');
  return { schema: 'npm-pub02-run-inputs-v1', id: LOGIN08_ID, publication_id: PUB02_ID,
    login_root: path.join(base, LOGIN08_ID), publication_root: path.join(base, PUB02_ID),
    session_file: path.join(SESSION08_ROOT, configFile), account: ACCOUNT,
    candidate: rebind.candidate, inventory_sha256: rebind.inventory_sha256, rebind_approval_sha256: rebind.approval.sha256,
    artifact: { file: ARTIFACT, bytes: artifact.length, sha256: sha(artifact) }, manifest_sha256: manifestSha,
    publication: PUBLICATION, history: HISTORY, login07_reservation_sha256: login07Reservation,
    allocation: ALLOCATION, record_limits: { login: A_RECORDS, publication: PUB_RECORDS }, scope, limits: LIMITS,
    publish_limits: PUBLISH_LIMITS, time_contract: timeContract, session_ms: SESSION_MS,
    tools: sources.map(file => [file, sha(readRegular(path.join(repo, file), 64 * KiB))]),
    STOP_preserved: true };
}

// The exact PUT body npm 11.16.0 builds, made offline with its transport intercepted.
export async function entityFor(repo) {
  const { artifact, manifest } = releaseFiles(repo);
  const built = await buildPublishEntity(artifact, manifest);
  return { body: built.body, summary: { body_bytes: built.body.length, body_sha256: sha(built.body),
    integrity: built.proof.attachment.integrity, loaded_modules: built.loaded_modules } };
}

export function planFor(inputs, entity, records) {
  const { id, publication_id, login_root, publication_root, session_file, account, candidate, artifact } = inputs;
  return { id, publication_id, login_root, publication_root, session_file, account, candidate, artifact, entity,
    rebind_approval_sha256: inputs.rebind_approval_sha256, publication: PUBLICATION, allocation: ALLOCATION,
    scope, time_contract: timeContract, session_ms: SESSION_MS, record_limits_sha256: planHash(inputs.record_limits),
    ...records, STOP_preserved: true, publication_approved: true };
}

// Surrounding whitespace (including a full-width IME space) is ignored; the phrase itself is exact.
export function confirmedPhrase(text) {
  return typeof text === 'string' && text.trim() === CONFIRM_PHRASE;
}

// Unlike the earlier login runs, this approval also covers publication.
export function approvalRecord(plan, approvedHash) {
  check(plan?.id === LOGIN08_ID && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && planHash(plan) === approvedHash, 'approval_mismatch');
  return { id: LOGIN08_ID, publication_id: PUB02_ID, approved_hash: approvedHash, plan, consumed: true, publication_approved: true };
}

export function verifyPreparation(repo, root) {
  const receipt = readRecord(root, 'preparation-readback.json', A_RECORDS);
  const meta = receipt.data;
  check(meta.id === LOGIN08_ID && meta.verified && meta.status === 'prepared' && meta.execution_approval_consumed === false &&
    meta.STOP_preserved === true && meta.rows.length === 3, 'preparation_unconfirmed');
  const [reservation, inputs, tests] = preparation.slice(0, 3).map((file, i) => readRecord(root, file, A_RECORDS, meta.rows[i]));
  const r = reservation.data, t = tests.data, recorded = inputs.data.entity;
  check(r.id === LOGIN08_ID && r.publication_id === PUB02_ID && r.preparation_approved && r.execution_approved === false && r.STOP_preserved &&
    planHash(r.allocation) === planHash(ALLOCATION) && planHash(r.record_limits) === planHash(inputs.data.record_limits) &&
    t.id === LOGIN08_ID && t.status === 'prepared' && t.network_calls === 0 && Number.isSafeInteger(t.passed) && t.passed > 0 &&
    t.input_before_sha256 === inputs.evidence.sha256 && t.input_after_sha256 === inputs.evidence.sha256 && recorded &&
    planHash({ ...inputsFor(repo), entity: recorded }) === inputs.evidence.sha256 && inputs.data.login_root === root, 'preparation_binding_changed');
  const plan = planFor(inputs.data, recorded, { reservation_sha256: reservation.evidence.sha256, inputs_sha256: inputs.evidence.sha256,
    tests_sha256: tests.evidence.sha256, preparation_readback_sha256: receipt.evidence.sha256 });
  check(size(approvalRecord(plan, planHash(plan))) <= A_RECORDS['login-approval.json'] &&
    size({ ...approvalRecord(plan, planHash(plan)), id: PUB02_ID, run_id: LOGIN08_ID }) <= PUB_RECORDS['approval-publication.json'], 'pub02_approval_record_limit');
  return plan;
}

// Rebuilds the entity and compares it with the prepared summary (not cheap: loads npm's publisher).
export async function verifyEntity(repo, plan) {
  const built = await entityFor(repo);
  check(same(built.summary, plan.entity), 'pub02_entity_changed');
  return built;
}

async function prepare(repo) {
  checkAllocationArithmetic();
  const base = path.join(repo, '.release-work'), root = path.join(base, LOGIN08_ID);
  absent(root);
  absent(SESSION08_ROOT);
  absent(path.join(base, PUB02_ID));
  const inputs = { ...inputsFor(repo), entity: (await entityFor(repo)).summary };
  check(size(inputs) <= A_RECORDS['preparation-inputs.json'], 'pub02_preparation_input_limit');
  fs.mkdirSync(root, { mode: 0o700 });
  const disk = writer(root, A_RECORDS);
  const rows = [disk.write('reservation.json', { id: LOGIN08_ID, publication_id: PUB02_ID, allocation: ALLOCATION,
    record_limits: inputs.record_limits, preparation_approved: true, execution_approved: false, STOP_preserved: true })];
  disk.syncParent();
  rows.push(disk.write('preparation-inputs.json', inputs));
  let status = 'stopped', passed = 0, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...TESTS],
      { cwd: repo, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash({ ...inputsFor(repo), entity: (await entityFor(repo)).summary });
    check(after === rows[1].sha256, 'preparation_inputs_changed');
    absent(SESSION08_ROOT);
    absent(path.join(base, PUB02_ID));
    exactFiles(root, preparation.slice(0, 2));
    status = 'prepared';
  } catch { /* Preserve the bounded preparation records for a stopped run. */ }
  rows.push(disk.write('preparation-tests.json', { id: LOGIN08_ID, status, passed, network_calls: 0,
    input_before_sha256: rows[1].sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write('preparation-readback.json', { id: LOGIN08_ID, status, verified: true, rows,
    execution_approval_consumed: false, STOP_preserved: true });
  if (status === 'prepared') verifyPreparation(repo, root);
  return { id: LOGIN08_ID, status, passed, readback, cumulative_reserved: ALLOCATION.cumulative, network_calls: 0 };
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
const publishFailure = /^(?:publish_(?:http_status_[1-5][0-9]{2}|auth_ip_address|otp_url_rejected|otp_unconfirmed|otp_response_shape|otp_interval_unconfirmed|otp_http_status_[1-5][0-9]{2}|otp_code_format|otp_poll_limit|otp_prompt_failed|request_shape|entity_limit|otp_shape|not_confirmed|confirmation_failed|unconfirmed)|peer_unconfirmed|transport_error|request_timeout)$/;
const localFailure = ['execution_inputs_changed', 'stage_deadline', 'pub02_scope_exists', 'pub02_dns_scope', 'pub02_transport_scope',
  'pub02_session_changed', 'pub02_entity_changed', 'session_deadline', 'utc_clock_unconfirmed', 'preflight_parent_sync_unconfirmed',
  'login_record_unconfirmed', 'record_limit'];
export function safeReason(code) {
  return typeof code === 'string' && (loginFailure.test(code) || preflightFailure.test(code) || publishFailure.test(code) ||
    localFailure.includes(code)) ? code : 'execution_stopped';
}

// The registry transport after login: one DNS lookup, then only the dispatches the
// current phase allows, all on the pinned address. Every dispatch first runs `before`.
const transitions = Object.freeze({ preflight: ['publish'], publish: ['otp', 'readback'], otp: ['publish'], readback: [] });
export function registryTransport({ adapter, before, gate = work => work() }) {
  const counts = { dns_calls: 0, get_attempts: 0, put_attempts: 0, otp_poll_attempts: 0, readback_attempts: 0, secondary_lookup_attempts: 0 };
  const preflightRoutes = Object.values(PREFLIGHT_ROUTES);
  const readbackRoutes = [PUBLISH_ROUTES.version, PUBLISH_ROUTES.tag, PUBLISH_ROUTES.tarball];
  const readbackUsed = new Set();
  let address, phase = 'preflight', preflightIndex = 0, otpPath = null;
  return { counts,
    get address() { return address; },
    get phase() { return phase; },
    enter(next, extra = {}) {
      check(transitions[phase].includes(next), 'pub02_transport_scope');
      if (next === 'otp') {
        check(typeof extra.poll === 'string' && /^\/-\/v1\/done(?:[/?]|$)/.test(extra.poll) && otpPath === null, 'pub02_transport_scope');
        otpPath = extra.poll;
      }
      if (next === 'publish' && phase === 'preflight') check(preflightIndex === preflightRoutes.length, 'pub02_transport_scope');
      phase = next;
    },
    lookup(host, options, callback) {
      gate(() => {
        before(LIMITS.dnsMs);
        check(phase === 'preflight' && counts.dns_calls === 0 && host === NPM_REGISTRY_HOST && options?.family === 4 && options.all === false, 'pub02_dns_scope');
      });
      counts.dns_calls++;
      return adapter.lookup(host, options, (error, value, family) => {
        if (!error && family === 4 && net.isIPv4(value)) address = value;
        callback(error, value, family);
      });
    },
    request(options, callback) {
      const put = options?.method === 'PUT';
      gate(() => {
        before(put ? PUBLISH_LIMITS.putMs : LIMITS.getMs);
        check(counts.dns_calls === 1 && counts.secondary_lookup_attempts === 0 && address && options.hostname === address &&
          options.servername === NPM_REGISTRY_HOST && options.port === 443 && options.family === 4 && options.agent === false &&
          options.autoSelectFamily === false && options.rejectUnauthorized === true && options.maxHeaderSize === LIMITS.headerBytes &&
          typeof options.headers?.authorization === 'string' && typeof options.lookup === 'function', 'pub02_transport_scope');
        if (phase === 'publish') check(put && counts.put_attempts < 2 && options.path === PUBLISH_ROUTES.publish, 'pub02_transport_scope');
        else {
          check(!put && options.method === 'GET', 'pub02_transport_scope');
          if (phase === 'preflight') check(preflightIndex < preflightRoutes.length && options.path === preflightRoutes[preflightIndex], 'pub02_transport_scope');
          else if (phase === 'otp') check(counts.otp_poll_attempts < PUBLISH_LIMITS.maxOtpPolls && options.path === otpPath, 'pub02_transport_scope');
          else check(readbackRoutes.includes(options.path) && !readbackUsed.has(options.path), 'pub02_transport_scope');
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
        counts.secondary_lookup_attempts === 0, 'pub02_transport_scope');
    },
  };
}

function baseStatus(id, approvedHash, extra) {
  return { id, run_id: LOGIN08_ID, approval_sha256: approvedHash, ...extra, approval_consumed: true, no_retry: true,
    cumulative_reserved: ALLOCATION.cumulative, protected_765_bytes_used: 0, STOP_preserved: true, publication_approved: true };
}

// Outcome: not_sent (no PUT dispatched), refused (every dispatched PUT got a definitive
// non-2xx reply), unknown (a PUT went unanswered and readback did not confirm it),
// unanswered_readback_confirmed, accepted_readback_confirmed, accepted_readback_unconfirmed.
export function publicationOutcome({ dispatched, accepted, unanswered, readbackConfirmed }) {
  if (dispatched === 0) return 'not_sent';
  if (accepted) return readbackConfirmed ? 'accepted_readback_confirmed' : 'accepted_readback_unconfirmed';
  if (unanswered) return readbackConfirmed ? 'unanswered_readback_confirmed' : 'unknown';
  return 'refused';
}

export async function executePub02Run({ loginRoot, pubRoot, session, plan, approvedHash, recheck, adapter, beginBrowser, prompt,
  entity, verify, sleep, now = () => performance.now(), wall = Date.now, startedAt = now() }) {
  const approval = approvalRecord(plan, approvedHash);
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

  // Login stage (login08). Nothing is dispatched before the approval record is durable.
  const loginDeadline = startedAt + LIMITS.stageMs;
  const counts = { dns_calls: 0, post_attempts: 0, get_attempts: 0, put_attempts: 0, secondary_lookup_attempts: 0 };
  let phase = 'before_dispatch', ip, poll, explicit, identity, reason = null, httpFailure;
  confirm();
  window(startedAt, loginDeadline, LIMITS.dnsMs + LIMITS.getMs);
  absent(session);
  absent(pubRoot);
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
        gate(() => check(counts.dns_calls === 0 && host === NPM_REGISTRY_HOST && options.family === 4 && options.all === false, 'pub02_dns_scope'));
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
            (post ? options.headers['npm-auth-type'] === 'web' : !Object.hasOwn(options.headers, 'npm-auth-type')), 'pub02_transport_scope');
          if (post) check(counts.post_attempts === 0 && options.path === LOGIN_START_PATH, 'pub02_transport_scope');
          else check(options.method === 'GET' && counts.post_attempts === 1 && counts.get_attempts < MAX_POLLS &&
            /^\/-\/v1\/done[/?]/.test(options.path) && (poll === undefined || poll === options.path), 'pub02_transport_scope');
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
        check(observed.token === token, 'pub02_session_changed');
        identity = observed.identity;
      },
    });
    phase = 'final_verification';
    confirm();
    check(counts.dns_calls === 1 && counts.post_attempts === 1 && counts.get_attempts > 0 && counts.secondary_lookup_attempts === 0, 'pub02_transport_scope');
    check(identity && same(privateSessionIdentity(session), identity), 'pub02_session_changed');
    window(startedAt, loginDeadline);
    confirmedUtc = utc();
    check(confirmedUtc >= startedUtc && confirmedUtc - startedUtc <= LIMITS.stageMs, 'utc_clock_unconfirmed');
  } catch (error) {
    httpFailure = login04HttpFailure(error);
    reason = safeReason(explicit ?? error?.message);
  }
  const deadlineUtc = startedUtc + SESSION_MS;
  const login = baseStatus(LOGIN08_ID, approvedHash, { status: reason ? 'stopped' : 'session_verified', phase, reason,
    counts, session_file_state: sessionPresence(session), elapsed_ms_at_status: Math.ceil(now() - startedAt),
    started_at_utc_ms: startedUtc, confirmed_at_utc_ms: reason ? null : confirmedUtc, session_deadline_utc_ms: deadlineUtc,
    ...(httpFailure && { http_failure: httpFailure }) });
  let loginReadback;
  try {
    rows.push(disk.write('login-status.json', { ...login, session_identity: reason ? null : identity }));
    disk.verify(rows);
    loginReadback = disk.write('login-readback.json', { id: LOGIN08_ID, status: login.status, approval_sha256: approvedHash,
      verified: true, rows, publication_follows: !reason });
  } catch {
    return { stage: 'login', ...login, status: 'stopped', reason: 'login_record_unconfirmed', publication: null };
  }
  if (reason) return { stage: 'login', ...login, readback: loginReadback, publication: null };

  // Admission: qualify the login08 records, session identity and UTC deadline before any registry DNS.
  explicit = undefined;
  const preflightStart = now();
  let stageStart = preflightStart, stageDeadline = preflightStart + LIMITS.stageMs;
  const unchanged = () => {
    check(utc() < deadlineUtc, 'session_deadline');
    check(same(privateSessionIdentity(session), identity), 'pub02_session_changed');
  };
  const transport = registryTransport({ adapter, gate,
    before(ms) { confirm(); unchanged(); window(stageStart, stageDeadline, ms); } });
  let session08;
  try {
    confirm();
    window(stageStart, stageDeadline, LIMITS.dnsMs + LIMITS.getMs);
    try { disk.verify([...rows, loginReadback]); } catch { throw Error('login_record_unconfirmed'); }
    session08 = inspectPrivateSession(session);
    check(same(session08.identity, identity), 'pub02_session_changed');
    check(utc() < deadlineUtc, 'session_deadline');
    absent(pubRoot);
  } catch (error) {
    return { stage: 'admission', ...login, readback: loginReadback,
      publication: { status: 'stopped', outcome: 'not_sent', reason: safeReason(error?.message), counts: transport.counts, records: 'not_created' } };
  }
  fs.mkdirSync(pubRoot, { mode: 0o700 });
  const pdisk = writer(pubRoot, PUB_RECORDS);
  const prows = [pdisk.write('approval-publication.json', { ...approval, id: PUB02_ID, run_id: LOGIN08_ID })];
  const pubUtc = utc();
  const state = { dispatched: 0, accepted: false, unanswered: false, readbackConfirmed: false, otp: 'not_requested', reply: null };
  let preason = null, stage = 'preflight';
  const send = (file, data) => { prows.push(pdisk.write(file, { id: PUB02_ID, ...data })); };
  const fetchOnce = ({ method, route, body, otp, limit, accept, timeoutMs }) => {
    const options = requestOptions({ method, path: route, address: transport.address, token: session08.token, otp, body, accept,
      refuseLookup: (_host, _options, callback) => callback(Error('additional_lookup_refused')) });
    return exchange({ request: transport.request, options, body, limit, timeoutMs, now });
  };
  try {
    send('login-binding.json', { login_id: LOGIN08_ID, account: ACCOUNT, login_approval_sha256: approvedHash,
      login_readback_sha256: loginReadback.sha256, login_status_sha256: rows[1].sha256, session_identity: identity,
      started_at_utc_ms: startedUtc, confirmed_at_utc_ms: confirmedUtc, session_deadline_utc_ms: deadlineUtc, publication_started_at_utc_ms: pubUtc });
    try { pdisk.syncParent(); } catch { throw Error('preflight_parent_sync_unconfirmed'); }

    // Preflight: the same four read-only GETs as prep04, with the login08 session.
    await runSessionPreflight({ now, token: session08.token, lookup: transport.lookup, request: transport.request,
      record(slot, summary) {
        gate(() => { window(stageStart, stageDeadline); check(transport.counts.secondary_lookup_attempts === 0, 'pub02_transport_scope'); });
        send(slot + '.json', { slot, ...summary });
      } });
    gate(() => { confirm(); transport.preflightComplete(); unchanged(); window(stageStart, stageDeadline); });
    send('preflight-status.json', { status: 'queries_confirmed', counts: { ...transport.counts } });

    // Confirmation: the operator types the phrase within its window, with up to three
    // local entries. No PUT otherwise.
    stage = 'confirmation';
    const confirmStart = now();
    let ok = false, timely = true, attempts = 0;
    while (!ok && timely && attempts < CONFIRM_ATTEMPTS) {
      attempts++;
      let typed;
      try { typed = await prompt.confirm(attempts); } catch { throw Error('publish_confirmation_failed'); }
      ok = confirmedPhrase(typed);
      try { window(confirmStart, confirmStart + CONFIRM_MS); } catch { timely = false; }
    }
    send('confirmation.json', { confirmed: ok, attempts, within_window: timely, expected_phrase: CONFIRM_PHRASE, at_utc_ms: utc() });
    check(ok, 'publish_not_confirmed');
    check(timely, 'stage_deadline');

    // Publish stage: the rebuilt entity must match the approved plan byte for byte.
    stage = 'publish';
    stageStart = now();
    stageDeadline = stageStart + PUBLISH_STAGE_MS;
    const built = await entity();
    check(Buffer.isBuffer(built?.body) && built.body.length === plan.entity.body_bytes && sha(built.body) === plan.entity.body_sha256 &&
      same(built.summary, plan.entity), 'pub02_entity_changed');
    transport.enter('publish');
    const put = async (attempt, otp) => {
      const file = 'send-' + attempt + '.json';
      const common = { attempt, entity_sha256: plan.entity.body_sha256, otp_header: otp !== undefined };
      let response;
      try {
        response = await fetchOnce({ method: 'PUT', route: PUBLISH_ROUTES.publish, body: built.body, otp,
          limit: PUBLISH_LIMITS.bodyBytes, timeoutMs: PUBLISH_LIMITS.putMs });
      } catch (error) {
        if (!error?.dispatched) throw error;
        state.dispatched++;
        state.unanswered = true;
        const why = safeReason(error.message);
        send(file, { ...common, http_status: null, kind: 'unknown', reason: why, at_utc_ms: utc() });
        return { kind: 'unknown', reason: why };
      }
      state.dispatched++;
      let kind;
      try { kind = classifyPut(response); } catch (error) { kind = { kind: 'refused', reason: safeReason(error?.message) }; }
      if (kind.kind === 'unknown') state.unanswered = true;
      send(file, { ...common, http_status: response.status, kind: kind.kind, reason: kind.reason ?? null,
        header_bytes: response.headerBytes, response_bytes: response.bytes.length, response_sha256: sha(response.bytes), at_utc_ms: utc() });
      return kind;
    };
    let reply = await put(1);
    if (reply.kind === 'otp_web' || reply.kind === 'otp_classic') {
      stage = 'otp';
      let otp, polls = 0, entries = 0;
      try {
        if (reply.kind === 'otp_web') {
          state.otp = 'web';
          try { await beginBrowser(reply.browser); } catch { throw Error('publish_otp_prompt_failed'); }
          transport.enter('otp', { poll: reply.poll });
          while (otp === undefined) {
            check(polls < PUBLISH_LIMITS.maxOtpPolls, 'publish_otp_poll_limit');
            polls++;
            const step = classifyOtpPoll(await fetchOnce({ method: 'GET', route: reply.poll, limit: PUBLISH_LIMITS.bodyBytes,
              timeoutMs: LIMITS.getMs }));
            if (step.done) otp = step.otp;
            else {
              window(stageStart, stageDeadline, step.waitMs + LIMITS.getMs + PUBLISH_LIMITS.putMs);
              await sleep(step.waitMs);
            }
          }
          transport.enter('publish');
        } else {
          state.otp = 'classic';
          // A malformed code may be re-entered locally; a well-formed wrong code still ends after PUT 2.
          while (otp === undefined) {
            entries++;
            let code;
            try { code = await prompt.otp(entries); } catch { throw Error('publish_otp_prompt_failed'); }
            try { otp = validateTotp(typeof code === 'string' ? code.trim() : code); }
            catch (error) { if (entries >= CONFIRM_ATTEMPTS) throw error; }
          }
        }
        send('otp.json', { kind: state.otp, polls, entries, result: 'received' });
      } catch (error) {
        send('otp.json', { kind: state.otp, polls, entries, result: 'stopped', reason: safeReason(explicit ?? error?.message) });
        throw error;
      }
      stage = 'publish';
      reply = await put(2, otp);
      otp = undefined;
      check(reply.kind !== 'otp_web' && reply.kind !== 'otp_classic', 'publish_http_status_401');
    }
    state.reply = reply.kind;
    if (reply.kind === 'refused') throw Error(reply.reason);
    state.accepted = reply.kind === 'accepted';

    // Readback (accepted or unanswered): one read-only GET per route in its own window.
    stage = 'readback';
    transport.enter('readback');
    stageStart = now();
    stageDeadline = stageStart + LIMITS.stageMs;
    await sleep(READBACK_DELAY_MS);
    const readback = async (file, route, limit, accept, judge) => {
      explicit = undefined;
      try {
        const response = await fetchOnce({ method: 'GET', route, limit, accept, timeoutMs: LIMITS.getMs });
        let verdict = response.status === 404 ? 'absent' : 'mismatch';
        try { if (response.status === 200 && judge(response.bytes)) verdict = 'confirmed'; } catch { verdict = 'mismatch'; }
        send(file, { http_status: response.status, verdict, response_bytes: response.bytes.length, response_sha256: sha(response.bytes) });
        return verdict === 'confirmed';
      } catch (error) {
        send(file, { http_status: null, verdict: 'unavailable', reason: safeReason(explicit ?? error?.message) });
        return false;
      }
    };
    const version = await readback('readback-version.json', PUBLISH_ROUTES.version, PUBLISH_LIMITS.bodyBytes, 'application/json', verify.metadata);
    const tag = await readback('readback-tag.json', PUBLISH_ROUTES.tag, PUBLISH_LIMITS.bodyBytes, 'application/json',
      bytes => JSON.parse(bytes).latest === TARBALL.version);
    const tarball = await readback('readback-tarball.json', PUBLISH_ROUTES.tarball, PUBLISH_LIMITS.tarballBytes,
      'application/octet-stream', verify.tarball);
    state.readbackConfirmed = version && tag && tarball;
    if (!state.accepted && !state.readbackConfirmed) preason = reply.reason ?? 'publish_unconfirmed';
  } catch (error) {
    preason = safeReason(explicit ?? error?.message);
  }
  const outcome = publicationOutcome(state);
  const published = outcome === 'accepted_readback_confirmed' || outcome === 'accepted_readback_unconfirmed' ||
    outcome === 'unanswered_readback_confirmed';
  const status = baseStatus(PUB02_ID, approvedHash, { status: published ? 'published' : 'stopped', stage,
    reason: published ? null : preason ?? 'publish_unconfirmed', outcome, otp: state.otp, put_reply: state.reply,
    counts: { ...transport.counts }, started_at_utc_ms: pubUtc, finished_at_utc_ms: wall(),
    elapsed_ms_at_status: Math.ceil(now() - preflightStart) });
  try {
    prows.push(pdisk.write('publication-status.json', status));
    pdisk.verify(prows);
    const readback = pdisk.write('publication-readback.json', { id: PUB02_ID, run_id: LOGIN08_ID, status: status.status,
      outcome, rows: prows, verified: true });
    return { stage, ...login, readback: loginReadback, publication: { ...status, readback } };
  } catch {
    return { stage, ...login, readback: loginReadback, publication: { ...status, record: 'publication_record_unconfirmed' } };
  }
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

// Discard complete lines typed ahead (for example Enter pressed during the browser
// login) so they cannot answer a later prompt. A separate non-blocking descriptor
// leaves the prompt's own descriptor blocking.
function drainTypeAhead() {
  let fd;
  try { fd = fs.openSync('/dev/tty', fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOCTTY); } catch { return; }
  try {
    const sink = Buffer.alloc(4096);
    for (let i = 0; i < 16 && fs.readSync(fd, sink, 0, sink.length, null) > 0; i++);
  } catch { /* EAGAIN: nothing pending. */ } finally { fs.closeSync(fd); }
}

// The first non-blank line, at most `limit` bytes; blank lines (stray Enter) are skipped.
export function readAnswer(fd, limit) {
  for (let i = 0; i < 8; i++) {
    const line = readLine(fd, limit);
    if (line.trim() !== '') return line;
  }
  return '';
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), base = path.join(repo, '.release-work');
  const loginRoot = path.join(base, LOGIN08_ID), pubRoot = path.join(base, PUB02_ID);
  checkTransportEnvironment();
  if (mode === '--prepare' && approvedHash === undefined && extra.length === 0) return prepare(repo);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--run' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'pub02_unsupported_mode');
  absent(SESSION08_ROOT);
  absent(pubRoot);
  exactFiles(loginRoot, preparation);
  const plan = verifyPreparation(repo, loginRoot);
  await verifyEntity(repo, plan);
  if (mode === '--check') return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  check(isatty(0) && isatty(1) && planHash(plan) === approvedHash, 'pub02_local_terminal_or_approval_unconfirmed');
  const { artifact, manifest } = releaseFiles(repo);
  const tty = fs.openSync('/dev/tty', fs.constants.O_RDWR | fs.constants.O_NOCTTY);
  // Authentication URLs and prompts stay on the terminal only, never in stdout or records.
  const show = message => {
    const bytes = Buffer.from(message);
    check(fs.writeSync(tty, bytes) === bytes.length, 'pub02_terminal_write_unconfirmed');
  };
  try {
    return await executePub02Run({ loginRoot, pubRoot, session: SESSION08_ROOT, plan, approvedHash, startedAt,
      adapter: { lookup, request }, recheck: () => planHash(verifyPreparation(repo, loginRoot)),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      beginBrowser(url) { show('\nOpen this npm authentication URL and complete 2FA:\n' + url + '\n'); },
      prompt: {
        confirm(attempt) {
          drainTypeAhead();
          show(attempt === 1
            ? `\nPreflight confirmed. To publish ${TARBALL.name}@${TARBALL.version} ` +
              `(sha256 ${plan.artifact.sha256.slice(0, 16)}...), type: ${CONFIRM_PHRASE}\n> `
            : `\nThat did not match. Entry ${attempt} of ${CONFIRM_ATTEMPTS}; type: ${CONFIRM_PHRASE}\n> `);
          return readAnswer(tty, 64);
        },
        otp(entry) {
          drainTypeAhead();
          show(entry === 1 ? '\nEnter the one-time password from your authenticator (input hidden): '
            : `\nThat was not a 6-8 digit code. Entry ${entry} of ${CONFIRM_ATTEMPTS} (input hidden): `);
          execFileSync('/bin/stty', ['-echo'], { stdio: [tty, 'ignore', 'ignore'] });
          try { return readAnswer(tty, 16); }
          finally { execFileSync('/bin/stty', ['echo'], { stdio: [tty, 'ignore', 'ignore'] }); show('\n'); }
        },
      },
      entity: () => verifyEntity(repo, plan),
      verify: { metadata: bytes => verifyReadbackMetadata(bytes, artifact, manifest), tarball: bytes => verifyArtifact(bytes) },
    });
  } finally { fs.closeSync(tty); }
}

// Fixed, secret-free stop codes for local preconditions; anything else stays generic.
const localStop = /^(?:pub02_[a-z_]+|transport_environment_override|historical_readback_changed|historical_record_changed|prior_run_unconfirmed|allocation_history_changed|evidence_changed|rebind02_[a-z_]+|prep02_stop_binding|preflight_rebind_[a-z_]+|candidate_changed|npm_version_changed|preparation_unconfirmed|preparation_binding_changed|record_changed|record_scope|approval_mismatch|artifact_identity|manifest_target|entity_[a-z_]+|attachment_[a-z_]+|publisher_[a-z_]+|builder_[a-z_]+)$/;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped' || result.publication?.status === 'stopped') process.exitCode = 1;
  } catch (error) {
    const reason = localStop.test(error?.message ?? '') ? error.message : 'pub02_local_preconditions_unconfirmed';
    console.log(JSON.stringify({ status: 'stopped', reason }));
    process.exitCode = 1;
  }
}
