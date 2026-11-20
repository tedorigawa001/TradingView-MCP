import fs from 'node:fs';
import path from 'node:path';
import { isatty } from 'node:tty';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRegular } from './package-approval.mjs';
import { LIMITS } from './prepare-npm-preflight.mjs';
import { checkTransportEnvironment } from './run-npm-preflight.mjs';
import { ACCOUNT, LOGIN_ID, LOGIN02_POST_STATUSES, MAX_POLLS, PREFLIGHT_ID, SESSION_BYTES } from './npm-session-release.mjs';
import { CAPACITY, snapshot } from './prepare-npm-session-release.mjs';
import { LOGIN02, approvalRecord, executeLogin02, planHash, readRecord, writer } from './run-npm-session-release.mjs';

const KiB = 1024;
const priorPreparation = {
  'reservation.json': 'c57d106704b92cf85eb6c22f4c0b664dd7425fd19c7b35bd5740851fec4b3719',
  'preparation-inputs.json': 'd30cf35e988c2776466e826520f710f13a7507b3832a18bcbdf475d78fa0db3b',
  'preparation-tests.json': '61a3061fc801e25ee8a0a573f5f55b1194057ab588a6d7c612d9735aeb3b6389',
  'preparation-readback.json': 'afcf7146fd1ab6758348567d9cb73a738eb56967115f287f511953dcb644f1ea',
  'preparation-revised-inputs.json': '92fec78471c210b113533dda83ca465e6e36764500b6c4a854c112d91c8a9571',
  'preparation-revised-tests.json': '7a61f0025434c733c8928ab18c2ec3ba33960b40795b25e0097c7ff85e4a43af',
  'preparation-revised-readback.json': '4b842533602c44e7759f7d0aa559ed265dc37ff4680680d82ea144bc45e85fbd',
};
const revisedInputs = 'preparation-retry-after-inputs.json';
const revisedTests = 'preparation-retry-after-tests.json';
const revisedReadback = 'preparation-retry-after-readback.json';
const preparations = [...Object.keys(priorPreparation), revisedInputs, revisedTests, revisedReadback];
const recordCaps = Object.freeze({ ...LOGIN02.caps, 'preparation-inputs.json': 5 * KiB, 'preparation-tests.json': 2 * KiB,
  'preparation-readback.json': KiB, 'preparation-revised-inputs.json': 6 * KiB, 'preparation-revised-tests.json': KiB,
  'preparation-revised-readback.json': KiB, [revisedInputs]: 6 * KiB, [revisedTests]: KiB, [revisedReadback]: KiB });
const preparationSpare = 4 * KiB;
const tests = ['test/release/prepare-npm-preflight.test.mjs', 'test/release/run-npm-preflight.test.mjs',
  'test/release/npm-session-release.test.mjs', 'test/release/run-npm-session-release.test.mjs', 'test/release/run-npm-login02.test.mjs'];
const sources = ['scripts/run-npm-login02.mjs', 'scripts/run-npm-session-release.mjs', 'scripts/npm-session-release.mjs',
  'scripts/prepare-npm-session-release.mjs', 'scripts/prepare-npm-preflight.mjs', 'scripts/run-npm-preflight.mjs',
  'scripts/package-approval.mjs', 'scripts/package-verifier-core.mjs', ...tests];
const history = {
  'reservation.json': 'ca5f41c8c6ceb710921f1c65d4cecd85cd564efd2cd356d19f54fab5a90329ae',
  'login-readback.json': '78c87158d57bce30b36b75f0c99a9a540150aac7ef9feb942fcb0414f21798e1',
  'login-http-diagnostics-readback.json': '6744649d8714a7cb16f8983d96c94b713d9536dc6f80f3ec6b3d5358f9758d0d',
};
const check = (value, reason) => { if (!value) throw Error(reason); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sum = values => values.reduce((a, b) => a + b, 0);
const allocation = Object.freeze({ old_cumulative: CAPACITY.cumulative, reservation: 64 * KiB,
  cumulative: LOGIN02.cumulativeReserved, remaining_pool: CAPACITY.remaining_pool - 64 * KiB,
  preparation: 32 * KiB, execution: 16 * KiB, private_session: SESSION_BYTES,
  campaign_cap: CAPACITY.cap, protected_765_bytes_used: 0 });
const protocol = Object.freeze({ post: { path: '/-/v1/login', allowed_statuses: LOGIN02_POST_STATUSES, attempts: 1,
  body: 'UTF-8 JSON object with one loginUrl and one doneUrl, both passing the original URL checks', follow_location: false },
  get: { allowed_statuses: [200, 202], attempts: MAX_POLLS,
    pending: { reject_top_level_token: true, retry_after_source: 'case-insensitive raw header name', max_retry_after_fields: 1,
      retry_after_min_seconds: 0, retry_after_max_seconds: 9999,
      minimum_wait_seconds: 1, absent_wait_seconds: 2, require_full_next_request_window: true } },
  reject_duplicate_decoded_json_keys_per_object: true, dns: { calls: 1, family: 4 },
  host: 'registry.npmjs.org', pinned_ip_and_tls_hostname: true, retry: false, follow_redirects: false, legacy_fallback: false,
  browser_origin: 'https://www.npmjs.com', browser_handoff: 'local operator terminal only; user completes 2FA' });
const timing = Object.freeze({ limit_ms: LIMITS.stageMs, clock: 'monotonic from CLI main entry',
  enforce_at: ['before DNS and HTTPS dispatch', 'after final record readback before issuing proof'],
  termination_deadline_for_os_dns_and_sync_io: false });

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('login02_target_exists');
}

function checkAllocation() {
  check(sum(preparations.map(file => recordCaps[file])) + preparationSpare === allocation.preparation &&
    sum(Object.keys(recordCaps).filter(file => !preparations.includes(file)).map(file => recordCaps[file])) === allocation.execution &&
    allocation.preparation + allocation.execution + allocation.private_session === allocation.reservation &&
    allocation.old_cumulative + allocation.reservation === allocation.cumulative &&
    allocation.cumulative + allocation.remaining_pool + CAPACITY.fixed_margin + CAPACITY.unallocated === allocation.campaign_cap,
  'login02_allocation_mismatch');
}

function inputSnapshot(repo, dirs) {
  checkAllocation();
  for (const [file, expected] of Object.entries(priorPreparation)) {
    check(readRecord(dirs.loginRoot, file, recordCaps).evidence.sha256 === expected, 'prior_preparation_changed');
  }
  const old = Object.fromEntries(Object.entries(history).map(([file, expected]) => {
    const row = readRecord(dirs.old, file, { [file]: 8 * KiB });
    check(row.evidence.sha256 === expected, 'login01_history_changed');
    return [file, row.data];
  }));
  const stopped = old['login-readback.json'];
  check(stopped.id === LOGIN_ID && stopped.status === 'stopped' && stopped.verified && stopped.completion_proof_sha256 === null,
    'login01_stop_unconfirmed');
  const diagnostics = old['login-http-diagnostics-readback.json'];
  check(diagnostics.verified && diagnostics.existing_stop_preserved && diagnostics.network_calls === 0, 'login01_diagnostics_unconfirmed');
  const oldCaps = { ...LOGIN02.caps, 'login-http-diagnostics-inputs.json': 2 * KiB, 'login-http-diagnostics-result.json': 2 * KiB };
  for (const row of [...stopped.rows, ...diagnostics.rows]) readRecord(dirs.old, row.file, oldCaps, row);
  check(old['reservation.json'].capacity.cumulative === allocation.old_cumulative &&
    old['reservation.json'].capacity.remaining_pool - allocation.reservation === allocation.remaining_pool, 'login02_prior_capacity_changed');
  const prior = snapshot(repo);
  return { id: LOGIN02.id, account: ACCOUNT, record_root: dirs.loginRoot, session_file: path.join(LOGIN02.sessionRoot, 'user.npmrc'),
    candidate: prior.candidate, version: prior.version, artifact_sha256: prior.artifact_sha256, artifact_bytes: prior.artifact_bytes,
    npm_version: prior.npm_version, inventory_sha256: prior.inventory_sha256, old_login01_anchors: history, old_prep02_stop: prior.old_stop_sha256,
    protocol, limits: LIMITS, time_contract: timing, allocation, record_limits: recordCaps,
    preparation_spare_bytes: preparationSpare, prior_preparation_sha256: priorPreparation,
    tools: sources.map(file => [file, sha(readRegular(path.join(repo, file), 64 * KiB))]),
    STOP_preserved: true, publication_approved: false, preflight_approved: false };
}

function prepareRevision(repo, dirs) {
  const existing = fs.readdirSync(dirs.loginRoot);
  check(existing.length === Object.keys(priorPreparation).length && existing.every(file => Object.hasOwn(priorPreparation, file)),
    'login02_preparation_revision_consumed_or_changed');
  const first = inputSnapshot(repo, dirs);
  const disk = writer(dirs.loginRoot, recordCaps);
  const inputs = disk.write(revisedInputs, first);
  const rows = [inputs];
  let status = 'stopped', passed = 0, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', ...tests],
      { cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(passed) && passed > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'tests_unconfirmed');
    after = planHash(inputSnapshot(repo, dirs));
    check(after === inputs.sha256, 'preparation_inputs_changed');
    absent(LOGIN02.sessionRoot);
    absent(dirs.preflightRoot);
    absent(path.join(dirs.loginRoot, 'login-approval.json'));
    status = 'prepared';
  } catch { /* Keep the existing reservation and partial records if preparation stops. */ }
  rows.push(disk.write(revisedTests, { id: LOGIN02.id, status, passed, network_calls: 0,
    input_before_sha256: inputs.sha256, input_after_sha256: after }));
  disk.verify(rows);
  const readback = disk.write(revisedReadback, { id: LOGIN02.id, status, verified: true, rows,
    login_approval_consumed: false, preflight_approved: false, publication_approved: false });
  return { id: LOGIN02.id, status, passed, rows, readback, cumulative_reserved: allocation.cumulative };
}

function verifyPreparation(repo, dirs) {
  const record = readRecord(dirs.loginRoot, revisedReadback, recordCaps);
  const receipt = record.data;
  check(receipt.id === LOGIN02.id && receipt.status === 'prepared' && receipt.verified === true &&
    receipt.login_approval_consumed === false && receipt.preflight_approved === false && receipt.publication_approved === false &&
    receipt.rows.length === 2, 'preparation_unconfirmed');
  const reservation = readRecord(dirs.loginRoot, 'reservation.json', recordCaps);
  const [inputs, result] = [revisedInputs, revisedTests].map((file, i) => readRecord(dirs.loginRoot, file, recordCaps, receipt.rows[i]));
  check(reservation.data.id === LOGIN02.id && reservation.data.preparation_approved && !reservation.data.login_approved &&
    reservation.data.STOP_preserved && result.data.status === 'prepared' && result.data.passed > 0 && result.data.network_calls === 0 &&
    result.data.input_before_sha256 === inputs.evidence.sha256 && result.data.input_after_sha256 === inputs.evidence.sha256 &&
    planHash(inputSnapshot(repo, dirs)) === inputs.evidence.sha256, 'preparation_binding_changed');
  const { id, account, record_root, session_file, candidate, version, artifact_sha256, artifact_bytes, npm_version,
    protocol, limits, time_contract, allocation, record_limits, STOP_preserved, preflight_approved, publication_approved } = inputs.data;
  const plan = { id, account, record_root, session_file, candidate, version, artifact_sha256, artifact_bytes, npm_version,
    protocol, limits, time_contract, allocation, record_limits, STOP_preserved, preflight_approved, publication_approved,
    preparation_inputs_sha256: inputs.evidence.sha256, preparation_tests_sha256: result.evidence.sha256,
    preparation_readback_sha256: record.evidence.sha256 };
  const doc = approvalRecord(id, plan, planHash(plan));
  check(Buffer.byteLength(JSON.stringify(doc) + '\n') <= recordCaps['login-approval.json'], 'approval_record_limit');
  return plan;
}

async function main() {
  const startedAt = performance.now();
  const [mode, approvedHash, ...extra] = process.argv.slice(2);
  const repo = process.cwd(), base = path.join(repo, '.release-work');
  const dirs = { loginRoot: path.join(base, LOGIN02.id), old: path.join(base, LOGIN_ID), preflightRoot: path.join(base, PREFLIGHT_ID) };
  checkTransportEnvironment();
  absent(LOGIN02.sessionRoot);
  absent(dirs.preflightRoot);
  if (mode === '--prepare-retry-after' && approvedHash === undefined) return prepareRevision(repo, dirs);
  check((mode === '--check' && approvedHash === undefined) ||
    (mode === '--login' && /^[0-9a-f]{64}$/.test(approvedHash ?? '') && extra.length === 0), 'unsupported_mode');
  const names = fs.readdirSync(dirs.loginRoot);
  check(names.length === preparations.length && names.every(file => preparations.includes(file)), 'login02_scope_consumed_or_changed');
  const plan = verifyPreparation(repo, dirs);
  if (mode === '--check') return { status: 'awaiting_approval', plan_sha256: planHash(plan), plan, network_calls: 0 };
  check(approvedHash === planHash(plan) && isatty(0) && isatty(1), 'approval_or_operator_terminal_unconfirmed');
  const terminal = fs.openSync('/dev/tty', fs.constants.O_WRONLY | fs.constants.O_NOCTTY);
  try {
    return await executeLogin02({ loginRoot: dirs.loginRoot, sessionRoot: LOGIN02.sessionRoot, plan, approvedHash, startedAt,
      recheck: () => planHash(verifyPreparation(repo, dirs)), adapter: { lookup, request }, beginBrowser(url) {
        fs.writeSync(terminal, '\nOpen this npm authentication URL and complete 2FA:\n' + url + '\n');
      } });
  } finally { fs.closeSync(terminal); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(JSON.stringify(result));
    if (result.status === 'stopped') process.exitCode = 1;
  } catch { console.log(JSON.stringify({ status: 'stopped', reason: 'login02_local_preconditions_unconfirmed' })); process.exitCode = 1; }
}
