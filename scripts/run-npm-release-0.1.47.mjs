import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { isatty } from 'node:tty';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { REVERIFY_CAMPAIGN, campaignHash, captureApprovedInputs, readRegular } from './package-approval.mjs';
import { LIMITS } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { ACCOUNT, NPM_REGISTRY_HOST, LOGIN_START_PATH, MAX_POLLS, SESSION_BYTES,
  writePrivateSession, inspectPrivateSession, privateSessionIdentity } from './npm-session-release.mjs';
import { planHash, readRecord, writer } from './run-npm-session-release.mjs';
import { runLogin04Protocol, login04HttpFailure } from './npm-login04-protocol.mjs';
import { PUBLISH_LIMITS, requestOptions, exchange, classifyOtpPoll, validateTotp } from './npm-publish-protocol.mjs';
import { classifyPublishReply, judgmentDetail, verifyDistTags, verifyInstallPackument, verifyVersionDocument } from './npm-registry-judgments.mjs';
import { ENTITY_LIMIT, buildPublishEntity, confirmedPhrase, drainTypeAhead, publicationOutcome, readAnswer, registryTransport,
  releaseRoutes, summarizePreflight, verifyArtifactBytes } from './npm-release-kit.mjs';

// One approved run publishes the B-verified 0.1.47 tarball: a fresh npm web login,
// the four read-only preflight GETs, the operator's typed confirmation, at most two
// PUTs (the second only after a one-time-password challenge) and four read-only
// readback GETs. Nothing is resent automatically. The run is bound to the B
// records, the artifact, the B input manifest (repository inputs, workspace, npm
// and node) and the CI candidate. Publish replies and readback use the corrected
// registry judgments: every 2xx is accepted, and the version document is compared
// without `files` and with object keys sorted.
const KiB = 1024;
export const TARGET = Object.freeze({ name: 'bushido-tradingview-mcp', version: '0.1.47', tag: 'latest', account: ACCOUNT });
// Plans and records name the package only. The account is compared at preflight and
// bound through the tool hashes (it is a constant of npm-session-release.mjs).
export const PLAN_TARGET = Object.freeze({ name: TARGET.name, version: TARGET.version, tag: TARGET.tag });
export const ROUTES = releaseRoutes(TARGET);
export const LOGIN_ID = 'package-2026-11-21-publish-0.1.47-login01';
export const PUB_ID = 'package-2026-11-21-publish-0.1.47-pub01';
export const SESSION_ROOT = '/private/tmp/TradingView-MCP-npm-0.1.47-login01';
export const CONFIRM_PHRASE = 'publish ' + TARGET.version;
export const NPM_VERSION = '11.16.0';
export const SESSION_MS = 2 * 60 * 60 * 1000;
export const CONFIRM_MS = 120000;
export const CONFIRM_ATTEMPTS = 3;
export const PUBLISH_STAGE_MS = 300000;
export const READBACK_DELAY_MS = 30000;
export const PACKUMENT_LIMIT = 4096 * KiB;
const configFile = 'user.npmrc';

const prep = REVERIFY_CAMPAIGN.preparation, run = REVERIFY_CAMPAIGN.run;
export const EVIDENCE = Object.freeze({
  campaign_sha256: 'ed8144dcf623cade195407693c78cfa176850a5e4722a3b8ccb8a8545db2089e',
  preparation: prep, run,
  records: Object.freeze({
    status: Object.freeze([prep + '/status.json', 3487, 'fcc5c5dbb2ee767abd567a49520756c50412495f2aa8246b6fd3635c1b964e86']),
    inputs: Object.freeze([prep + '/input-manifest.json', 414108, '8f79ae5ec9467aabaa5a60defa104c2e8ca70162632c3796b7d6bcfa637f8fe2']),
    approval_b: Object.freeze([prep + '/approval-b.json', 1131, '56f351f5cb119eab6931187cc376364e293836f2bfb1e02bcfc32c3a4f01d20d']),
    result: Object.freeze([run + '/report/result.json', 8311, 'b1e70f16ff110ae50dfdc0c8e8c2e0a458bec798d56b6c4740eb5f71f6e1a728']),
  }),
  artifact: Object.freeze({ file: run + '/artifact/verified-0.1.47.tgz', bytes: 851982,
    sha256: '625fbbae18924987691f23e3cbbc7d2efa58e859826a5dcc0b3d9734d239c1aa' }),
  // CI is not re-read here: the run binds the local candidate ref, and the plan
  // carries the CI result the operator reviewed before approving it.
  candidate: Object.freeze({ ref: 'refs/heads/codex/ci-0.1.47', commit: 'c698ba20bd78685937e18fa0ac48eadec51950f9',
    ci_run_id: 44913069796, ci_conclusion: 'success', ci_jobs: 5 }),
});

export const LOGIN_RECORDS = Object.freeze({ 'reservation.json': 4 * KiB, 'preparation-inputs.json': 32 * KiB,
  'preparation-tests.json': 4 * KiB, 'preparation-readback.json': 4 * KiB, 'login-approval.json': 48 * KiB,
  'login-status.json': 4 * KiB, 'login-readback.json': 4 * KiB });
export const PUB_RECORDS = Object.freeze({ 'approval-publication.json': 48 * KiB, 'login-binding.json': 4 * KiB,
  'account.json': 4 * KiB, 'rights.json': 4 * KiB, 'version.json': 4 * KiB, 'tag.json': 4 * KiB, 'preflight-status.json': 4 * KiB,
  'confirmation.json': 4 * KiB, 'send-1.json': 4 * KiB, 'otp.json': 4 * KiB, 'send-2.json': 4 * KiB,
  'readback-version.json': 4 * KiB, 'readback-tag.json': 4 * KiB, 'readback-tarball.json': 4 * KiB,
  'readback-packument.json': 4 * KiB, 'publication-status.json': 8 * KiB, 'publication-readback.json': 8 * KiB });
// The 0.1.47 campaign holds 2 MiB for release stages; this is their first use.
export const ALLOCATION = Object.freeze({ release_stages_reserved: 2 * 1024 * KiB, prior_release_stage_use: 0,
  login_records: 100 * KiB, publication_records: 120 * KiB, private_session: SESSION_BYTES, reservation: 236 * KiB,
  release_stage_cumulative: 236 * KiB, release_stage_remaining: 2 * 1024 * KiB - 236 * KiB,
  campaign_cap: REVERIFY_CAMPAIGN.campaignCap, campaign_sha256: EVIDENCE.campaign_sha256, protected_765_bytes_used: 0 });
export const PUBLICATION = Object.freeze({ name: TARGET.name, version: TARGET.version, tag: TARGET.tag, access: 'public',
  route: ROUTES.publish, max_put_attempts: 2, second_put: 'only after a registry one-time-password challenge',
  otp: 'web flow in the operator browser, or an authenticator code typed hidden on the terminal; never recorded',
  otp_code_entries_max: CONFIRM_ATTEMPTS, confirmation_phrase: CONFIRM_PHRASE,
  confirmation_match: 'exact phrase; surrounding whitespace ignored', confirmation_attempts_max: CONFIRM_ATTEMPTS,
  reply_judgment: 'npm-registry-judgments classifyPublishReply: 2xx accepted, 4xx refused, other statuses unknown',
  readback: ['version', 'tag', 'tarball', 'packument'], readback_attempts_each: 1,
  resend: 'never; an unanswered PUT is classified only by read-only readback' });
const scope = Object.freeze({
  login: { host: NPM_REGISTRY_HOST, dns_calls: 1, post_attempts: 1, post_path: LOGIN_START_PATH, max_poll_gets: MAX_POLLS,
    protocol: 'npm-login04-protocol', browser: 'validated npm URL on the local terminal; operator completes 2FA' },
  registry: { host: NPM_REGISTRY_HOST, dns_calls: 1, preflight_gets: 4, put_attempts_max: 2,
    otp_poll_gets_max: PUBLISH_LIMITS.maxOtpPolls, readback_gets_max: 4, pinned_address: true, account_compared: true,
    admission: 'login records, session identity and UTC deadline verified before DNS' },
  redirects: false, automatic_retry: false });
const timeContract = Object.freeze({ login_stage_ms: LIMITS.stageMs, preflight_stage_ms: LIMITS.stageMs,
  confirmation_ms: CONFIRM_MS, publish_stage_ms: PUBLISH_STAGE_MS, put_timeout_ms: PUBLISH_LIMITS.putMs,
  readback_delay_ms: READBACK_DELAY_MS, readback_stage_ms: LIMITS.stageMs,
  clock: 'monotonic stage windows from CLI entry, login completion, preflight completion, confirmation and readback start',
  utc: 'Date.now on the operator host', session_deadline: 'UTC login start + 2 hours' });
export const TESTS = Object.freeze(['test/release/npm-release-kit.test.mjs', 'test/release/run-npm-release-0.1.47.test.mjs',
  'test/release/npm-registry-judgments.test.mjs', 'test/release/npm-publish-protocol.test.mjs',
  'test/release/run-npm-login04.test.mjs', 'test/release/npm-session-release.test.mjs']);
const sources = ['scripts/run-npm-release-0.1.47.mjs', 'scripts/npm-release-kit.mjs', 'scripts/npm-registry-judgments.mjs',
  'scripts/npm-publish-protocol.mjs', 'scripts/npm-login04-protocol.mjs', 'scripts/npm-session-release.mjs',
  'scripts/run-npm-session-release.mjs', 'scripts/prepare-npm-session-release.mjs', 'scripts/run-npm-preflight.mjs',
  'scripts/prepare-npm-preflight.mjs', 'scripts/publish-verified-tarball.mjs', 'scripts/package-approval.mjs',
  'scripts/package-verifier-core.mjs', ...TESTS];
const preparation = ['reservation.json', 'preparation-inputs.json', 'preparation-tests.json', 'preparation-readback.json'];

const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const size = value => Buffer.byteLength(JSON.stringify(value) + '\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const total = caps => Object.values(caps).reduce((sum, n) => sum + n, 0);

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw Error('release_scope_exists');
}

function exactFiles(root, expected) {
  const names = fs.readdirSync(root);
  check(names.length === expected.length && names.every(name => expected.includes(name)), 'release_scope_consumed_or_changed');
}

export function checkAllocation() {
  const a = ALLOCATION;
  check(total(LOGIN_RECORDS) === a.login_records && total(PUB_RECORDS) === a.publication_records &&
    a.login_records + a.publication_records + a.private_session === a.reservation &&
    a.prior_release_stage_use + a.reservation === a.release_stage_cumulative &&
    a.release_stage_cumulative + a.release_stage_remaining === a.release_stages_reserved &&
    a.release_stages_reserved === REVERIFY_CAMPAIGN.releaseStagesReserved && a.campaign_sha256 === campaignHash() &&
    a.protected_765_bytes_used === 0, 'release_allocation_changed');
}

function candidateCommit(repo, ref) {
  return execFileSync('/usr/bin/git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'rev-parse', '--verify', ref + '^{commit}'],
    { cwd: repo, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function evidenceRecord(repo, [file, bytes, digest]) {
  const data = readRegular(path.join(repo, '.release-work', file), 512 * KiB);
  check(data.length === bytes && sha(data) === digest, 'release_evidence_changed');
  return data;
}

// Node flags and OpenSSL settings can log TLS keys or load code; the run needs none.
export function checkRuntime(execArgv = process.execArgv, env = process.env) {
  check(Array.isArray(execArgv) && execArgv.length === 0 &&
    !Object.keys(env).some(key => /^(?:openssl_conf|openssl_modules|openssl_engines)$/i.test(key) && env[key]), 'transport_environment_override');
}

// Deterministic, offline and read-only: the B records, the artifact, the B input
// manifest and the CI candidate ref. Re-evaluated before every network dispatch.
// The options exist for tests; the runner always uses the defaults.
export function releaseFiles(repo, { evidence = EVIDENCE, capture = captureApprovedInputs, candidate = candidateCommit } = {}) {
  check(REVERIFY_CAMPAIGN.releaseVersion === TARGET.version && campaignHash() === evidence.campaign_sha256, 'release_campaign_changed');
  const records = Object.fromEntries(Object.entries(evidence.records).map(([key, row]) => [key, evidenceRecord(repo, row)]));
  const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const status = parse(records.status), result = parse(records.result), inputs = parse(records.inputs);
  const r = evidence.records;
  check(status.schema === 'package-preparation-status-v2' && status.status === 'ready_for_review' && status.version === TARGET.version &&
    status.preparation === evidence.preparation && status.run === evidence.run && status.input_manifest_sha256 === r.inputs[2] &&
    status.campaign_sha256 === evidence.campaign_sha256, 'release_evidence_changed');
  check(result.schema === 'npm-package-verification-v1' && result.status === 'passed' && result.phase === 'complete' &&
    result.version === TARGET.version && result.run === evidence.run && result.approval_b?.approval_b_sha256 === r.approval_b[2] &&
    result.approval_b.input_manifest_sha256 === r.inputs[2] && result.approval_b.preparation_status_sha256 === r.status[2] &&
    result.artifact?.path === 'artifact/verified-' + TARGET.version + '.tgz' && result.artifact.bytes === evidence.artifact.bytes &&
    result.artifact.sha256 === evidence.artifact.sha256 && result.checks?.same_artifact === true &&
    result.checks.unmanaged_write_attempts === 0 && result.checks.approved_inputs_end_verified === true, 'release_evidence_changed');
  const npmGroup = inputs.groups?.find(group => group.name === 'npm');
  check(inputs.schema === 'package-input-manifest-v1' && inputs.preparation === evidence.preparation && inputs.run === evidence.run &&
    npmGroup, 'release_evidence_changed');
  const artifact = readRegular(path.join(repo, '.release-work', evidence.artifact.file), PUBLISH_LIMITS.tarballBytes);
  const digests = verifyArtifactBytes(artifact, evidence.artifact);
  // Repository inputs, workspace, npm and node exactly as B verified them.
  let captured;
  try { captured = capture(repo); } catch { throw Error('release_inputs_changed'); }
  check(captured?.sha256 === r.inputs[2], 'release_inputs_changed');
  const manifestBytes = readRegular(path.join(repo, 'package.json'), 64 * KiB);
  const manifest = JSON.parse(manifestBytes);
  check(manifest.name === TARGET.name && manifest.version === TARGET.version && !manifest.private, 'manifest_target');
  let ref;
  try { ref = candidate(repo, evidence.candidate.ref); } catch { throw Error('release_candidate_changed'); }
  check(ref === evidence.candidate.commit, 'release_candidate_changed');
  return { artifact, digests, manifest, manifestSha: sha(manifestBytes), npmGroup };
}

export function inputsFor(repo) {
  const base = path.join(repo, '.release-work');
  const { digests, manifestSha } = releaseFiles(repo);
  return { schema: 'npm-release-run-inputs-v1', target: PLAN_TARGET, id: LOGIN_ID, publication_id: PUB_ID,
    login_root: path.join(base, LOGIN_ID), publication_root: path.join(base, PUB_ID),
    session_file: path.join(SESSION_ROOT, configFile), evidence: EVIDENCE,
    artifact: { file: EVIDENCE.artifact.file, ...digests }, manifest_sha256: manifestSha, npm_version: NPM_VERSION,
    routes: ROUTES, publication: PUBLICATION, allocation: ALLOCATION, record_limits: { login: LOGIN_RECORDS, publication: PUB_RECORDS },
    scope, limits: LIMITS, publish_limits: PUBLISH_LIMITS, entity_limit: ENTITY_LIMIT, packument_limit: PACKUMENT_LIMIT,
    time_contract: timeContract, session_ms: SESSION_MS,
    tools: sources.map(file => [file, sha(readRegular(path.join(repo, file), 128 * KiB))]), STOP_preserved: true };
}

// The exact PUT body npm 11.16.0 builds, made offline with its transport intercepted.
export async function entityFor(repo) {
  const { artifact, manifest, npmGroup } = releaseFiles(repo);
  const built = await buildPublishEntity(artifact, manifest, { expected: EVIDENCE.artifact, target: TARGET, npmGroup, npmVersion: NPM_VERSION });
  return { body: built.body, summary: { body_bytes: built.body.length, body_sha256: sha(built.body),
    integrity: built.proof.integrity, shasum: built.proof.shasum, loaded_modules: built.loaded_modules } };
}

export function planFor(inputs, entity, records) {
  const { id, publication_id, login_root, publication_root, session_file, target, evidence, artifact } = inputs;
  return { id, publication_id, login_root, publication_root, session_file, target, evidence, artifact, entity,
    publication: PUBLICATION, allocation: ALLOCATION, routes: ROUTES, scope, time_contract: timeContract, session_ms: SESSION_MS,
    record_limits_sha256: planHash(inputs.record_limits), ...records, STOP_preserved: true, publication_approved: true };
}

export function approvalRecord(plan, approvedHash) {
  check(plan?.id === LOGIN_ID && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && planHash(plan) === approvedHash, 'approval_mismatch');
  return { id: LOGIN_ID, publication_id: PUB_ID, approved_hash: approvedHash, plan, consumed: true, publication_approved: true };
}

export function verifyPreparation(repo, root) {
  const receipt = readRecord(root, 'preparation-readback.json', LOGIN_RECORDS);
  const meta = receipt.data;
  check(meta.id === LOGIN_ID && meta.verified && meta.status === 'prepared' && meta.execution_approval_consumed === false &&
    meta.STOP_preserved === true && meta.rows.length === 3, 'preparation_unconfirmed');
  const [reservation, inputs, tests] = preparation.slice(0, 3).map((file, i) => readRecord(root, file, LOGIN_RECORDS, meta.rows[i]));
  const r = reservation.data, t = tests.data, recorded = inputs.data.entity;
  check(r.id === LOGIN_ID && r.publication_id === PUB_ID && r.preparation_approved && r.execution_approved === false && r.STOP_preserved &&
    planHash(r.allocation) === planHash(ALLOCATION) && planHash(r.record_limits) === planHash(inputs.data.record_limits) &&
    t.id === LOGIN_ID && t.status === 'prepared' && t.network_calls === 0 && Number.isSafeInteger(t.passed) && t.passed > 0 &&
    t.input_before_sha256 === inputs.evidence.sha256 && t.input_after_sha256 === inputs.evidence.sha256 && recorded &&
    planHash({ ...inputsFor(repo), entity: recorded }) === inputs.evidence.sha256 && inputs.data.login_root === root, 'preparation_binding_changed');
  const plan = planFor(inputs.data, recorded, { reservation_sha256: reservation.evidence.sha256, inputs_sha256: inputs.evidence.sha256,
    tests_sha256: tests.evidence.sha256, preparation_readback_sha256: receipt.evidence.sha256 });
  check(size(approvalRecord(plan, planHash(plan))) <= LOGIN_RECORDS['login-approval.json'] &&
    size({ ...approvalRecord(plan, planHash(plan)), id: PUB_ID, run_id: LOGIN_ID }) <= PUB_RECORDS['approval-publication.json'],
  'release_approval_record_limit');
  return plan;
}

// Rebuilds the entity and compares it with the prepared summary (loads npm's publisher).
export async function verifyEntity(repo, plan) {
  const built = await entityFor(repo);
  check(same(built.summary, plan.entity), 'release_entity_changed');
  return built;
}

async function prepare(repo) {
  checkAllocation();
  const base = path.join(repo, '.release-work'), root = path.join(base, LOGIN_ID);
  absent(root);
  absent(SESSION_ROOT);
  absent(path.join(base, PUB_ID));
  const inputs = { ...inputsFor(repo), entity: (await entityFor(repo)).summary };
  check(size(inputs) <= LOGIN_RECORDS['preparation-inputs.json'], 'release_preparation_input_limit');
  fs.mkdirSync(root, { mode: 0o700 });
  const disk = writer(root, LOGIN_RECORDS);
  const rows = [disk.write('reservation.json', { id: LOGIN_ID, publication_id: PUB_ID, allocation: ALLOCATION,
    record_limits: inputs.record_limits, preparation_approved: true, execution_approved: false, STOP_preserved: true })];
  disk.syncParent();
  rows.push(disk.write('preparation-inputs.json', inputs));
  let status = 'stopped', passed = 0, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...TESTS],
      { cwd: repo, encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * KiB, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', TMPDIR: os.tmpdir(), NODE_DISABLE_COMPILE_CACHE: '1' } });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash({ ...inputsFor(repo), entity: (await entityFor(repo)).summary });
    check(after === rows[1].sha256, 'preparation_inputs_changed');
    absent(SESSION_ROOT);
    absent(path.join(base, PUB_ID));
    exactFiles(root, preparation.slice(0, 2));
    status = 'prepared';
  } catch { /* Preserve the bounded preparation records for a stopped run. */ }
  rows.push(disk.write('preparation-tests.json', { id: LOGIN_ID, status, passed, network_calls: 0,
    input_before_sha256: rows[1].sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write('preparation-readback.json', { id: LOGIN_ID, status, verified: true, rows,
    execution_approval_consumed: false, STOP_preserved: true });
  if (status === 'prepared') verifyPreparation(repo, root);
  return { id: LOGIN_ID, status, passed, readback, release_stage_cumulative: ALLOCATION.release_stage_cumulative, network_calls: 0 };
}

function sessionPresence(root) {
  try {
    if (!fs.lstatSync(root).isDirectory()) return 'unconfirmed';
    fs.lstatSync(path.join(root, configFile));
    return 'present';
  } catch (error) { return error?.code === 'ENOENT' ? 'absent' : 'unconfirmed'; }
}

const loginFailure = /^login_(?:url_rejected|dns_unconfirmed|dns_timeout|peer_unconfirmed|second_dns|header_limit|http_status|response_encoding|body_limit|response_incomplete|multiple_sockets|transport_error|request_timeout|response_json|response_shape|duplicate_json_key|stage_timeout|browser_handoff_failed|session_unconfirmed|session_save_failed|poll_limit|poll_interval_unconfirmed|poll_wait_failed|parent_sync_unconfirmed)$/;
const preflightFailure = /^(?:dns_unconfirmed|dns_timeout|response_json|response_shape|account_unconfirmed|rights_unconfirmed|version_availability_unconfirmed|latest_unconfirmed|latest_at_or_above_candidate|session_account_mismatch|unknown_slot)$/;
const exchangeFailure = /^(?:peer_unconfirmed|response_shape|header_limit|response_encoding|body_limit|response_incomplete|request_timeout|multiple_sockets|transport_error)$/;
const publishFailure = /^publish_(?:http_status_[1-5][0-9]{2}|auth_ip_address|otp_url_rejected|otp_unconfirmed|otp_response_shape|otp_interval_unconfirmed|otp_http_status_[1-5][0-9]{2}|otp_code_format|otp_poll_limit|otp_prompt_failed|request_shape|entity_limit|otp_shape|not_confirmed|confirmation_failed|unconfirmed|response_shape)$/;
const readbackFailure = /^(?:readback_(?:version|manifest|integrity|tarball_url|tag|packument)|metadata_limit|manifest_target|package_target|artifact_identity)$/;
const localFailure = ['execution_inputs_changed', 'stage_deadline', 'release_scope_exists', 'release_dns_scope', 'release_transport_scope',
  'release_session_changed', 'release_entity_changed', 'session_deadline', 'utc_clock_unconfirmed', 'preflight_parent_sync_unconfirmed',
  'login_record_unconfirmed', 'record_limit'];
export function safeReason(code) {
  return typeof code === 'string' && (loginFailure.test(code) || preflightFailure.test(code) || exchangeFailure.test(code) ||
    publishFailure.test(code) || readbackFailure.test(code) || localFailure.includes(code)) ? code : 'execution_stopped';
}

function baseStatus(id, approvedHash, extra) {
  return { id, run_id: LOGIN_ID, approval_sha256: approvedHash, ...extra, approval_consumed: true, no_retry: true,
    release_stage_cumulative: ALLOCATION.release_stage_cumulative, protected_765_bytes_used: 0, STOP_preserved: true,
    publication_approved: true };
}

// The readback judges for one target: what `npm view` and `npm install` read.
export function readbackJudges({ artifact, manifest, digests }, expected = EVIDENCE.artifact) {
  const target = { name: TARGET.name, version: TARGET.version, integrity: digests.integrity, shasum: digests.shasum };
  return Object.freeze({
    version: bytes => verifyVersionDocument(bytes, target, manifest),
    tag: bytes => verifyDistTags(bytes, target, TARGET.tag),
    tarball: bytes => { check(bytes.equals(artifact), 'artifact_identity'); return verifyArtifactBytes(bytes, expected); },
    packument: bytes => verifyInstallPackument(bytes, target, TARGET.tag),
  });
}

export async function executeRelease({ loginRoot, pubRoot, session, plan, approvedHash, recheck, adapter, beginBrowser, prompt,
  entity, judges, sleep, now = () => performance.now(), wall = Date.now, startedAt = now() }) {
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

  // Login stage. Nothing is dispatched before the approval record is durable.
  const loginDeadline = startedAt + LIMITS.stageMs;
  const counts = { dns_calls: 0, post_attempts: 0, get_attempts: 0, put_attempts: 0, secondary_lookup_attempts: 0 };
  let phase = 'before_dispatch', ip, poll, explicit, identity, reason = null, httpFailure;
  confirm();
  window(startedAt, loginDeadline, LIMITS.dnsMs + LIMITS.getMs);
  absent(session);
  absent(pubRoot);
  const startedUtc = utc();
  const disk = writer(loginRoot, LOGIN_RECORDS);
  const rows = [disk.write('login-approval.json', approval)];
  const gate = work => { try { return work(); } catch (error) { explicit = error.message; throw error; } };
  let confirmedUtc = null;
  try {
    try { disk.syncParent(); } catch { throw Error('login_parent_sync_unconfirmed'); }
    await runLogin04Protocol({ now, deadline: loginDeadline, sleep, beginBrowser,
      beforeDispatch(operation) { phase = operation === 'dns' ? 'dns' : operation === 'post' ? 'before_post' : 'before_get'; confirm(); },
      onAdditionalLookup() { counts.secondary_lookup_attempts++; },
      lookup(host, options, callback) {
        gate(() => check(counts.dns_calls === 0 && host === NPM_REGISTRY_HOST && options.family === 4 && options.all === false, 'release_dns_scope'));
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
            (post ? options.headers['npm-auth-type'] === 'web' : !Object.hasOwn(options.headers, 'npm-auth-type')), 'release_transport_scope');
          if (post) check(counts.post_attempts === 0 && options.path === LOGIN_START_PATH, 'release_transport_scope');
          else check(options.method === 'GET' && counts.post_attempts === 1 && counts.get_attempts < MAX_POLLS &&
            /^\/-\/v1\/done[/?]/.test(options.path) && (poll === undefined || poll === options.path), 'release_transport_scope');
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
        check(observed.token === token, 'release_session_changed');
        identity = observed.identity;
      },
    });
    phase = 'final_verification';
    confirm();
    check(counts.dns_calls === 1 && counts.post_attempts === 1 && counts.get_attempts > 0 && counts.secondary_lookup_attempts === 0, 'release_transport_scope');
    check(identity && same(privateSessionIdentity(session), identity), 'release_session_changed');
    window(startedAt, loginDeadline);
    confirmedUtc = utc();
    check(confirmedUtc >= startedUtc && confirmedUtc - startedUtc <= LIMITS.stageMs, 'utc_clock_unconfirmed');
  } catch (error) {
    httpFailure = login04HttpFailure(error);
    reason = safeReason(explicit ?? error?.message);
  }
  const deadlineUtc = startedUtc + SESSION_MS;
  const login = baseStatus(LOGIN_ID, approvedHash, { status: reason ? 'stopped' : 'session_verified', phase, reason,
    counts, session_file_state: sessionPresence(session), elapsed_ms_at_status: Math.ceil(now() - startedAt),
    started_at_utc_ms: startedUtc, confirmed_at_utc_ms: reason ? null : confirmedUtc, session_deadline_utc_ms: deadlineUtc,
    ...(httpFailure && { http_failure: httpFailure }) });
  let loginReadback;
  try {
    rows.push(disk.write('login-status.json', { ...login, session_identity: reason ? null : identity }));
    disk.verify(rows);
    loginReadback = disk.write('login-readback.json', { id: LOGIN_ID, status: login.status, approval_sha256: approvedHash,
      verified: true, rows, publication_follows: !reason });
  } catch {
    return { stage: 'login', ...login, status: 'stopped', reason: 'login_record_unconfirmed', publication: null };
  }
  if (reason) return { stage: 'login', ...login, readback: loginReadback, publication: null };

  // Admission: qualify the login records, session identity and UTC deadline before any registry DNS.
  explicit = undefined;
  const preflightStart = now();
  let stageStart = preflightStart, stageDeadline = preflightStart + LIMITS.stageMs;
  const unchanged = () => {
    check(utc() < deadlineUtc, 'session_deadline');
    check(same(privateSessionIdentity(session), identity), 'release_session_changed');
  };
  const transport = registryTransport({ adapter, gate, routes: ROUTES, host: NPM_REGISTRY_HOST, maxOtpPolls: PUBLISH_LIMITS.maxOtpPolls,
    limits: { dnsMs: LIMITS.dnsMs, getMs: LIMITS.getMs, putMs: PUBLISH_LIMITS.putMs, headerBytes: LIMITS.headerBytes },
    before(ms) { confirm(); unchanged(); window(stageStart, stageDeadline, ms); } });
  let credentials;
  try {
    confirm();
    window(stageStart, stageDeadline, LIMITS.dnsMs + LIMITS.getMs);
    try { disk.verify([...rows, loginReadback]); } catch { throw Error('login_record_unconfirmed'); }
    credentials = inspectPrivateSession(session);
    check(same(credentials.identity, identity), 'release_session_changed');
    check(utc() < deadlineUtc, 'session_deadline');
    absent(pubRoot);
  } catch (error) {
    return { stage: 'admission', ...login, readback: loginReadback,
      publication: { status: 'stopped', outcome: 'not_sent', reason: safeReason(error?.message), counts: transport.counts, records: 'not_created' } };
  }
  fs.mkdirSync(pubRoot, { mode: 0o700 });
  const pdisk = writer(pubRoot, PUB_RECORDS);
  const prows = [pdisk.write('approval-publication.json', { ...approval, id: PUB_ID, run_id: LOGIN_ID })];
  const pubUtc = utc();
  const state = { dispatched: 0, accepted: false, unanswered: false, readbackConfirmed: false, otp: 'not_requested', reply: null,
    recordGap: false };
  let preason = null, stage = 'preflight';
  const send = (file, data) => { prows.push(pdisk.write(file, { id: PUB_ID, ...data })); };
  // After a PUT is dispatched, a failed record write must not change its outcome or skip readback.
  const note = (file, data) => { try { send(file, data); } catch { state.recordGap = true; } };
  const at = () => { try { return utc(); } catch { return null; } };
  const fetchOnce = ({ method, route, body, otp, limit, accept, timeoutMs }) => {
    explicit = undefined;
    const options = requestOptions({ method, path: route, address: transport.address, token: credentials.token, otp, body, accept,
      refuseLookup: (_host, _options, callback) => callback(Error('additional_lookup_refused')) });
    return exchange({ request: transport.request, options, body, limit, timeoutMs, now });
  };
  // The DNS clock starts after the synchronous input recheck inside transport.lookup.
  const resolveAddress = () => new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    try {
      transport.lookup(NPM_REGISTRY_HOST, { family: 4, all: false }, (error, value, family) =>
        finish(error || family !== 4 || !net.isIPv4(value) ? Error('dns_unconfirmed') : null, value));
    } catch (error) { finish(error); return; }
    if (!settled) timer = setTimeout(() => finish(Error('dns_timeout')), LIMITS.dnsMs);
  });
  try {
    send('login-binding.json', { login_id: LOGIN_ID, account_compared: true, login_approval_sha256: approvedHash,
      login_readback_sha256: loginReadback.sha256, login_status_sha256: rows[1].sha256, session_identity: identity,
      started_at_utc_ms: startedUtc, confirmed_at_utc_ms: confirmedUtc, session_deadline_utc_ms: deadlineUtc, publication_started_at_utc_ms: pubUtc });
    try { pdisk.syncParent(); } catch { throw Error('preflight_parent_sync_unconfirmed'); }

    // Preflight: four read-only GETs with the new session; the account is compared, not recorded.
    await resolveAddress();
    for (const [slot, route] of Object.entries(ROUTES.preflight)) {
      const response = await fetchOnce({ method: 'GET', route, limit: LIMITS.bodyBytes, timeoutMs: LIMITS.getMs });
      const summary = summarizePreflight(slot, response.status, response.bytes, TARGET);
      gate(() => { window(stageStart, stageDeadline); check(transport.counts.secondary_lookup_attempts === 0, 'release_transport_scope'); });
      // The account and rights bodies name the account, so even their digests stay out of the records.
      const named = slot === 'account' || slot === 'rights';
      send(slot + '.json', { slot, ...summary, http_status: response.status, body_bytes: response.bytes.length,
        header_bytes: response.headerBytes, body_sha256: named ? null : sha(response.bytes) });
    }
    gate(() => { confirm(); transport.preflightComplete(); unchanged(); window(stageStart, stageDeadline); });
    send('preflight-status.json', { status: 'queries_confirmed', counts: { ...transport.counts } });

    // Confirmation: the operator types the phrase within its window, with up to three local entries.
    stage = 'confirmation';
    const confirmStart = now();
    let ok = false, timely = true, attempts = 0;
    while (!ok && timely && attempts < CONFIRM_ATTEMPTS) {
      attempts++;
      let typed;
      try { typed = await prompt.confirm(attempts); } catch { throw Error('publish_confirmation_failed'); }
      ok = confirmedPhrase(typed, CONFIRM_PHRASE);
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
      same(built.summary, plan.entity), 'release_entity_changed');
    transport.enter('publish');
    const put = async (attempt, otp) => {
      const file = 'send-' + attempt + '.json';
      const common = { attempt, entity_sha256: plan.entity.body_sha256, otp_header: otp !== undefined };
      let response;
      try {
        response = await fetchOnce({ method: 'PUT', route: ROUTES.publish, body: built.body, otp,
          limit: PUBLISH_LIMITS.bodyBytes, timeoutMs: PUBLISH_LIMITS.putMs });
      } catch (error) {
        if (!error?.dispatched) throw error;
        state.dispatched++;
        state.unanswered = true;
        state.reply = 'unknown';
        const why = safeReason(error.message);
        note(file, { ...common, http_status: null, kind: 'unknown', reason: why, at_utc_ms: at() });
        return { kind: 'unknown', reason: why };
      }
      state.dispatched++;
      let kind;
      // A reply that cannot be classified (for example a 401 with rejected OTP URLs) is a definitive 4xx refusal.
      try { kind = classifyPublishReply(response); } catch (error) { kind = { kind: 'refused', reason: safeReason(error?.message) }; }
      state.reply = kind.kind;
      if (kind.kind === 'accepted') state.accepted = true;
      if (kind.kind === 'unknown') state.unanswered = true;
      note(file, { ...common, http_status: response.status, kind: kind.kind, reason: kind.reason ?? null,
        header_bytes: response.headerBytes, response_bytes: response.bytes.length, response_sha256: sha(response.bytes), at_utc_ms: at() });
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
          transport.enter('otp', { classic: true });
          // A malformed code may be re-entered locally; a well-formed wrong code still ends after PUT 2.
          while (otp === undefined) {
            entries++;
            let code;
            try { code = await prompt.otp(entries); } catch { throw Error('publish_otp_prompt_failed'); }
            try { otp = validateTotp(typeof code === 'string' ? code.trim() : code); }
            catch (error) { if (entries >= CONFIRM_ATTEMPTS) throw error; }
          }
          transport.enter('publish');
        }
        send('otp.json', { kind: state.otp, polls, entries, result: 'received' });
      } catch (error) {
        note('otp.json', { kind: state.otp, polls, entries, result: 'stopped', reason: safeReason(explicit ?? error?.message) });
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

    // Readback (accepted or unknown): one read-only GET per route in its own window.
    stage = 'readback';
    transport.enter('readback');
    stageStart = now();
    stageDeadline = stageStart + LIMITS.stageMs;
    await sleep(READBACK_DELAY_MS);
    const readback = async (slot, limit, accept) => {
      const file = 'readback-' + slot + '.json';
      let response;
      try {
        response = await fetchOnce({ method: 'GET', route: ROUTES.readback[slot], limit, accept, timeoutMs: LIMITS.getMs });
      } catch (error) {
        note(file, { slot, http_status: null, verdict: 'unavailable', reason: safeReason(explicit ?? error?.message) });
        return false;
      }
      let verdict = response.status === 404 ? 'absent' : 'mismatch', why = null, detail = {};
      if (response.status === 200) {
        try { judges[slot](response.bytes); verdict = 'confirmed'; }
        catch (error) { why = safeReason(error?.message); detail = judgmentDetail(error?.detail); }
      }
      note(file, { slot, http_status: response.status, verdict, reason: why, ...detail, response_bytes: response.bytes.length,
        response_sha256: sha(response.bytes) });
      return verdict === 'confirmed';
    };
    const verdicts = [await readback('version', PUBLISH_LIMITS.bodyBytes, 'application/json'),
      await readback('tag', PUBLISH_LIMITS.bodyBytes, 'application/json'),
      await readback('tarball', PUBLISH_LIMITS.tarballBytes, 'application/octet-stream'),
      await readback('packument', PACKUMENT_LIMIT, 'application/vnd.npm.install-v1+json')];
    state.readbackConfirmed = verdicts.every(Boolean);
    if (!state.accepted && !state.readbackConfirmed) preason = reply.reason ?? 'publish_unconfirmed';
  } catch (error) {
    preason = safeReason(explicit ?? error?.message);
  }
  const outcome = publicationOutcome(state);
  const published = outcome === 'accepted_readback_confirmed' || outcome === 'accepted_readback_unconfirmed' ||
    outcome === 'unanswered_readback_confirmed';
  const status = baseStatus(PUB_ID, approvedHash, { status: published ? 'published' : 'stopped', stage,
    reason: published ? null : preason ?? 'publish_unconfirmed', outcome, otp: state.otp, put_reply: state.reply,
    readback_confirmed: state.readbackConfirmed, record_gap: state.recordGap, counts: { ...transport.counts },
    started_at_utc_ms: pubUtc, finished_at_utc_ms: at(),
    elapsed_ms_at_status: Math.ceil(now() - preflightStart) });
  try {
    prows.push(pdisk.write('publication-status.json', status));
    pdisk.verify(prows);
    const readback = pdisk.write('publication-readback.json', { id: PUB_ID, run_id: LOGIN_ID, status: status.status,
      outcome, rows: prows, verified: true });
    return { stage, ...login, readback: loginReadback, publication: { ...status, readback } };
  } catch {
    return { stage, ...login, readback: loginReadback, publication: { ...status, record: 'publication_record_unconfirmed' } };
  }
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), base = path.join(repo, '.release-work');
  const loginRoot = path.join(base, LOGIN_ID), pubRoot = path.join(base, PUB_ID);
  checkTransportEnvironment();
  checkRuntime();
  if (mode === '--prepare' && approvedHash === undefined && extra.length === 0) return prepare(repo);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--run' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'release_unsupported_mode');
  checkAllocation();
  absent(SESSION_ROOT);
  absent(pubRoot);
  exactFiles(loginRoot, preparation);
  const plan = verifyPreparation(repo, loginRoot);
  await verifyEntity(repo, plan);
  if (mode === '--check') return { status: 'awaiting_approval', plan, plan_sha256: planHash(plan), network_calls: 0 };
  check(isatty(0) && isatty(1) && planHash(plan) === approvedHash, 'release_local_terminal_or_approval_unconfirmed');
  const files = releaseFiles(repo);
  const tty = fs.openSync('/dev/tty', fs.constants.O_RDWR | fs.constants.O_NOCTTY);
  // Authentication URLs and prompts stay on the terminal only, never in stdout or records.
  const show = message => {
    const bytes = Buffer.from(message);
    check(fs.writeSync(tty, bytes) === bytes.length, 'release_terminal_write_unconfirmed');
  };
  try {
    return await executeRelease({ loginRoot, pubRoot, session: SESSION_ROOT, plan, approvedHash, startedAt,
      adapter: { lookup, request }, recheck: () => planHash(verifyPreparation(repo, loginRoot)),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      beginBrowser(url) { show('\nOpen this npm authentication URL and complete 2FA:\n' + url + '\n'); },
      prompt: {
        confirm(attempt) {
          drainTypeAhead();
          show(attempt === 1
            ? `\nPreflight confirmed. To publish ${TARGET.name}@${TARGET.version} ` +
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
      judges: readbackJudges(files),
    });
  } finally { fs.closeSync(tty); }
}

// Fixed, secret-free stop codes for local preconditions; anything else stays generic.
const localStop = /^(?:release_[a-z_]+|transport_environment_override|preparation_unconfirmed|preparation_binding_changed|record_changed|record_scope|approval_mismatch|artifact_identity|manifest_target|entity_[a-z_]+|attachment_[a-z_]+|publisher_[a-z_]+|builder_[a-z_]+)$/;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped' || result.publication?.status === 'stopped') process.exitCode = 1;
  } catch (error) {
    const reason = localStop.test(error?.message ?? '') ? error.message : 'release_local_preconditions_unconfirmed';
    console.log(JSON.stringify({ status: 'stopped', reason }));
    process.exitCode = 1;
  }
}
