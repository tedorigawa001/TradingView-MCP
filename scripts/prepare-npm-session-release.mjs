import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureApprovedInputs, readRegular } from './package-approval.mjs';
import { LIMITS, ROUTES } from './prepare-npm-preflight.mjs';
import { ACCOUNT, LOGIN_ID, MAX_POLLS, PREFLIGHT_ID, SESSION_ROOT } from './npm-session-release.mjs';

const KiB = 1024;
const previous = 'package-2026-11-19-publish-0.1.46-prep02';
const head = '8d97bbaaf2360fe83b2ff6dd36ebef4887c0acc9';
const rebindFile = 'packaging/npm-preflight-input-rebind-0.1.46.json';
const rebindSha256 = '3d63f51e42599d238d5af92cd959e962cd028601aafc66c5789aa2cb2d306cf2';
const rebindId = 'package-2026-11-20-publish-0.1.46-prep03-input-rebind01';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = data => Buffer.from(JSON.stringify(data) + '\n');
const check = (value, reason) => { if (!value) throw Error(reason); };
const sum = limits => Object.values(limits).reduce((a, b) => a + b, 0);
const fileEvidence = (file, bytes) => ({ file, bytes: bytes.length, sha256: sha(bytes) });
const sameBytes = (a, b) => a?.bytes === b.bytes && a.sha256 === b.sha256;

export const A_RECORDS = Object.freeze({ 'reservation.json': 4 * KiB, 'preparation-inputs.json': 12 * KiB,
  'preparation-tests.json': 12 * KiB, 'preparation-readback.json': 4 * KiB, 'login-approval.json': 4 * KiB,
  'login-status.json': 8 * KiB, 'login-readback.json': 4 * KiB });
export const B_RECORDS = Object.freeze({ 'login-binding.json': 4 * KiB, 'approval-preflight.json': 8 * KiB,
  'account.json': 8 * KiB, 'rights.json': 8 * KiB, 'version.json': 8 * KiB, 'tag.json': 8 * KiB,
  'preflight-status.json': 12 * KiB, 'preflight-readback.json': 8 * KiB });
export const CAPACITY = Object.freeze({ prior: 49875954, reserved: 128 * KiB, cumulative: 50007026, prior_pool: 31234889,
  remaining_pool: 31103817, cap: 84 * 1024 * KiB, fixed_margin: 6291456, unallocated: 678085,
  phase_a: 64 * KiB, phase_b: 64 * KiB, credential: 16 * KiB, protected_765_bytes_used: 0 });

export function checkBudget() {
  const c = CAPACITY;
  check(sum(A_RECORDS) + c.credential === c.phase_a && sum(B_RECORDS) === c.phase_b &&
    c.phase_a + c.phase_b === c.reserved && c.prior + c.reserved === c.cumulative &&
    c.prior_pool - c.reserved === c.remaining_pool && c.cumulative + c.remaining_pool + c.fixed_margin + c.unallocated === c.cap &&
    c.protected_765_bytes_used === 0, 'budget_mismatch');
}

function bound(file, limit, hash) {
  const bytes = readRegular(file, limit);
  check(sha(bytes) === hash, 'evidence_changed');
  return bytes;
}

export function verifyReboundPreflightTools(repo, legacyTools, approval, read = readRegular) {
  const changes = approval.approved_input_changes;
  const expected = new Map(approval.unchanged_legacy_tools.map(tool => [tool.file, { before: tool, after: tool }]));
  check(changes.length === 2, 'preflight_rebind_tool_scope');
  for (const change of changes) {
    check(!expected.has(change.file), 'preflight_rebind_tool_scope');
    expected.set(change.file, change);
  }
  check(expected.size === legacyTools.length &&
    expected.size === approval.unchanged_legacy_tools.length + changes.length &&
    new Set(legacyTools.map(tool => tool.file)).size === legacyTools.length, 'preflight_rebind_tool_scope');
  return legacyTools.map(tool => {
    const entry = expected.get(tool.file);
    check(entry, 'preflight_rebind_tool_scope');
    check(sameBytes(tool, entry.before), 'preflight_rebind_legacy_tool_changed');
    const current = fileEvidence(tool.file, read(path.join(repo, tool.file), 64 * KiB));
    check(sameBytes(current, entry.after), 'preflight_rebind_current_tool_changed');
    return current;
  });
}

function releaseInputs(repo, approval) {
  checkBudget();
  const root = path.join(repo, '.release-work');
  check(fs.lstatSync(repo).isDirectory() && fs.lstatSync(root).isDirectory(), 'release_root_shape');
  const old = path.join(root, previous);
  check(fs.lstatSync(old).isDirectory(), 'old_record_root_shape');
  const observed = new Map();
  const historical = (file, limit, digest) => {
    const bytes = bound(path.join(repo, file), limit, digest);
    if (approval) observed.set(file, { bytes: bytes.length, sha256: digest });
    return bytes;
  };
  const oldRelative = '.release-work/' + previous;
  const stoppedBytes = historical(oldRelative + '/preflight-status.json', 12 * KiB, 'ec8646734f38c414667b85aaa097fb38bd29aba40da5f8dc2c6e176d064827fe');
  const oldReadback = historical(oldRelative + '/preflight-readback.json', 8 * KiB, '8114d9e0df7826685a84164aff541e5dd0dcf99725cb6ed0c8875b82dc8a1b7a');
  const stopped = JSON.parse(stoppedBytes), readback = JSON.parse(oldReadback);
  check(stopped.id === previous && stopped.status === 'stopped' && stopped.reason === 'http_status_401' &&
    stopped.approval_consumed && stopped.no_retry && stopped.STOP_preserved && !stopped.publication_approved &&
    stopped.cumulative_reserved === CAPACITY.prior && readback.verified && readback.status === 'stopped', 'old_stop_binding');
  const inputs = JSON.parse(historical(oldRelative + '/inputs.json', 24 * KiB, '76d8e0f7f67c140143696cfbe1d1e226ebe680eea4cb390d14f2e7d1c2ceea6b'));
  for (const [name, digest] of inputs.historical_evidence) {
    historical((name === 'approval-setup.json' ? oldRelative : '.release-work') + '/' + name, 1024 * KiB, digest);
  }
  let reboundTools;
  if (approval) {
    const release = approval.release;
    check(approval.legacy_preparation.id === previous && inputs.id === previous &&
      release.version === '0.1.46' && release.ci_candidate === inputs.head && release.artifact_sha256 === inputs.artifact &&
      release.artifact_bytes === inputs.artifact_bytes, 'preflight_rebind_release_changed');
    for (const expected of [...approval.legacy_preparation.evidence, release.reuse_approval]) {
      check(sameBytes(observed.get(expected.file), expected), 'preflight_rebind_history_changed');
    }
    reboundTools = verifyReboundPreflightTools(repo, inputs.tools, approval);
  } else {
    for (const tool of inputs.tools) bound(path.join(repo, tool.file), 64 * KiB, tool.sha256);
  }
  const ci = execFileSync('bdo', ['proxy', 'git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
    'rev-parse', 'refs/heads/codex/ci-0.1.46'], { cwd: repo, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const current = captureApprovedInputs(repo);
  check(ci === head && ci === inputs.head && current.sha256 === inputs.current_full_inventory_sha256, 'candidate_changed');
  const npmRoot = current.manifest.groups.find(group => group.name === 'npm').root;
  check(JSON.parse(readRegular(path.join(npmRoot, 'package.json'), 64 * KiB)).version === '11.16.0', 'npm_version_changed');
  return { inputs, ci, inventory: current.sha256, stoppedBytes, oldReadback, reboundTools };
}

export function snapshot(repo) {
  const { inputs, ci, inventory, stoppedBytes, oldReadback } = releaseInputs(repo);
  const tools = ['scripts/npm-session-release.mjs', 'scripts/prepare-npm-session-release.mjs', 'test/release/npm-session-release.test.mjs'].map(file => {
    const bytes = readRegular(path.join(repo, file), 64 * KiB);
    return { file, bytes: bytes.length, sha256: sha(bytes) };
  });
  return { schema: 'npm-session-release-preparation-v1', login_id: LOGIN_ID, preflight_id: PREFLIGHT_ID, account: ACCOUNT,
    version: '0.1.46', candidate: ci, artifact_sha256: inputs.artifact, artifact_bytes: inputs.artifact_bytes,
    inventory_sha256: inventory, old_stop_sha256: sha(stoppedBytes), old_readback_sha256: sha(oldReadback),
    local_session_path: path.join(SESSION_ROOT, 'user.npmrc'), npm_version: '11.16.0', tools, limits: LIMITS,
    login: { realm: 'registry.npmjs.org', dns_calls: 1, method: 'POST', path: '/-/v1/login', poll_gets: MAX_POLLS,
      browser_origin: 'https://www.npmjs.com', interactive_browser_outside_cli_budget: true },
    preflight: { routes: ROUTES, dns_calls: 1, gets: 4 }, a_records: A_RECORDS, b_records: B_RECORDS,
    capacity: CAPACITY, no_retry: true, old_login_fallback: false, publication_approved: false };
}

export function snapshotForPreflightRebind(repo) {
  const bytes = readRegular(path.join(repo, rebindFile), 4 * KiB);
  const evidence = fileEvidence(rebindFile, bytes);
  check(evidence.sha256 === rebindSha256, 'preflight_rebind_approval_changed');
  const approval = JSON.parse(bytes);
  check(approval.schema === 'npm-preflight-input-rebind-approval-v1' && approval.id === rebindId &&
    approval.decision === 'approved' && approval.STOP_preserved === true && approval.protected_765_bytes_used === 0 &&
    approval.login_execution_approved === false && approval.preflight_execution_approved === false &&
    approval.publication_approved === false && approval.preflight_execution_plan_sha256 === null, 'preflight_rebind_scope');
  const { inputs, ci, inventory, reboundTools } = releaseInputs(repo, approval);
  const preparationTools = ['scripts/prepare-npm-session-release.mjs', 'scripts/run-npm-session-release.mjs',
    'test/release/run-npm-session-release.test.mjs'].map(file => fileEvidence(file, readRegular(path.join(repo, file), 64 * KiB)));
  return { schema: 'npm-preflight-rebound-inputs-v1', id: rebindId, status: 'inputs_verified_offline',
    approval: evidence, legacy_preparation: approval.legacy_preparation, candidate: ci, artifact_sha256: inputs.artifact,
    artifact_bytes: inputs.artifact_bytes, inventory_sha256: inventory, rebound_tools: reboundTools,
    preparation_tools: preparationTools, dns_calls: 0, http_requests: 0, STOP_preserved: true, protected_765_bytes_used: 0,
    login_execution_approved: false, preflight_execution_approved: false, preflight_execution_plan_sha256: null,
    publication_approved: false };
}

function store(root, file, data) {
  const bytes = encode(data);
  check(Object.hasOwn(A_RECORDS, file) && bytes.length <= A_RECORDS[file], 'preparation_output_limit');
  const target = path.join(root, file);
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  check(readRegular(target, A_RECORDS[file]).equals(bytes), 'preparation_readback_changed');
  return { file, bytes: bytes.length, sha256: sha(bytes) };
}

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('target_already_exists');
}

function prepare(repo) {
  const root = path.join(repo, '.release-work', LOGIN_ID);
  const next = path.join(repo, '.release-work', PREFLIGHT_ID);
  for (const location of [root, next, SESSION_ROOT]) absent(location);
  const first = snapshot(repo);
  fs.mkdirSync(root, { mode: 0o700 });
  const rows = [store(root, 'reservation.json', { login_id: LOGIN_ID, preflight_id: PREFLIGHT_ID, capacity: CAPACITY,
    basis: 'approved offline preparation and release-work pool reservation; fixed slot ceilings',
    a_records: A_RECORDS, b_records: B_RECORDS, login_approved: false, preflight_approved: false, publication_approved: false, STOP_preserved: true })];
  rows.push(store(root, 'preparation-inputs.json', first));
  let pass = 0, stop = null, after = null;
  try {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'test/release/npm-session-release.test.mjs'],
      { cwd: repo, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * KiB, stdio: ['ignore', 'pipe', 'pipe'] });
    pass = Number(output.match(/^# pass (\d+)$/m)?.[1]);
    check(Number.isSafeInteger(pass) && pass > 0 && /^# fail 0$/m.test(output) && /^# skipped 0$/m.test(output), 'test_result_unconfirmed');
    after = sha(encode(snapshot(repo)));
    check(rows[1].sha256 === after, 'preparation_inputs_changed');
    for (const location of [next, SESSION_ROOT, path.join(root, 'login-approval.json')]) absent(location);
  } catch { stop = 'offline_check_failed'; }
  rows.push(store(root, 'preparation-tests.json', { pass, reason: stop, input_before_sha256: rows[1].sha256, input_after_sha256: after, network_calls: 0 }));
  for (const row of rows) bound(path.join(root, row.file), A_RECORDS[row.file], row.sha256);
  const status = stop ? 'stopped' : 'offline_prepared';
  const readback = store(root, 'preparation-readback.json', { login_id: LOGIN_ID, preflight_id: PREFLIGHT_ID, status,
    verified: true, records: rows, login_approval_consumed: false, preflight_approval_consumed: false, publication_approved: false });
  console.log(JSON.stringify({ status, pass, rows, readback, capacity: CAPACITY }));
  if (stop) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { check(process.argv.length === 3 && process.argv[2] === '--prepare', 'offline_preparation_only'); prepare(process.cwd()); }
  catch { console.log(JSON.stringify({ status: 'stopped', reason: 'offline_preparation_precondition_or_io' })); process.exitCode = 1; }
}
