import fs from 'node:fs';
import path from 'node:path';
import { lookup } from 'node:dns';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureApprovedInputs, readRegular } from './package-approval.mjs';
import { ID, LIMITS, ROUTES, runPreflight } from './prepare-npm-preflight.mjs';
import { readExistingToken } from './publish-verified-tarball.mjs';

const KiB = 1024;
const host = 'registry.npmjs.org';
const slots = Object.keys(ROUTES);
const approvalFile = 'approval-preflight.json';
const statusFile = 'preflight-status.json';
const readbackFile = 'preflight-readback.json';
const outputLimits = Object.freeze({
  [approvalFile]: 8 * KiB, 'account.json': 8 * KiB, 'rights.json': 8 * KiB, 'version.json': 8 * KiB,
  'tag.json': 8 * KiB, [statusFile]: 12 * KiB, [readbackFile]: 8 * KiB,
});
const setup = Object.freeze({
  'approval-setup.json': [8 * KiB, '879f62d432e3658f877b420653ccc8b47ece48ddc38d9b4b35153a9bb8e4acb9'],
  'inputs.json': [24 * KiB, '76d8e0f7f67c140143696cfbe1d1e226ebe680eea4cb390d14f2e7d1c2ceea6b'],
  'tests.json': [24 * KiB, 'fc6b9b76edf2db5a159a817710e39bc4d9a1a4ddb1b54fbdb2868bb4ac6433db'],
  'setup-status.json': [8 * KiB, '0e0e699c9d77986859f3e36363c696d4637316b843405fcd0c5ca7cdedc7e2eb'],
  'setup-readback.json': [4 * KiB, '4fade872701729067f79dffeb6de7c86cb4571d5ad96ec4a33ce01238102dcc0'],
});
const runnerFiles = ['scripts/run-npm-preflight.mjs', 'test/release/run-npm-preflight.test.mjs'];
const anchorLimit = 1024 * KiB;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const check = (condition, reason) => { if (!condition) throw Error(reason); };
const total = counts => Object.values(counts).reduce((sum, n) => sum + n, 0);
const scopes = Object.freeze({ dns_calls: 1, https_gets: 4, https_puts: 0, retry: false });

export function planHash(plan) { return sha(encode(plan)); }

export function checkTransportEnvironment(env = process.env) {
  // The verified route uses Node's direct transport and default TLS trust.
  const override = /^(?:https?_proxy|all_proxy|node_options|node_use_env_proxy|node_extra_ca_certs|node_use_system_ca|node_tls_reject_unauthorized|node_compile_cache|ssl_cert_file|ssl_cert_dir|sslkeylogfile)$/i;
  check(!Object.keys(env).some(key => override.test(key) && env[key]), 'transport_environment_override');
}

function regularRecord(file, limit, expected) {
  const bytes = readRegular(file, limit);
  check(sha(bytes) === expected, 'prepared_evidence_changed');
  return JSON.parse(bytes);
}

function directory(location) {
  const stat = fs.lstatSync(location);
  check(stat.isDirectory(), 'preflight_directory_shape');
  return stat;
}

function rootFor(repo) { return path.join(repo, '.release-work', ID); }

function planFor(repo) {
  const root = rootFor(repo);
  for (const dir of [repo, path.dirname(root), root]) directory(dir);
  const records = Object.fromEntries(Object.entries(setup).map(([file, [limit, hash]]) =>
    [file, regularRecord(path.join(root, file), limit, hash)]));
  const inputs = records['inputs.json'];
  const approval = records['approval-setup.json'];
  const status = records['setup-status.json'];
  check(status.id === ID && status.status === 'ready_for_preflight_review' && status.STOP_preserved &&
    status.preflight_consumed === false && status.preflight_approved === false && status.publication_approved === false &&
    records['setup-readback.json'].verified === true && records['tests.json'].pass === 13, 'setup_status_binding');
  check(JSON.stringify(approval.preflight_limits) === JSON.stringify(outputLimits) && total(outputLimits) === 60 * KiB &&
    approval.cumulative === status.cumulative_reserved && approval.protected_765_used === 0 &&
    approval.cumulative + approval.remaining_pool + approval.margin + approval.unallocated === approval.campaign_cap, 'preflight_budget_binding');
  check(inputs.id === ID && inputs.head === approval.candidate &&
    JSON.stringify(inputs.routes) === JSON.stringify(ROUTES) && JSON.stringify(inputs.limits) === JSON.stringify(LIMITS), 'prepared_route_binding');
  const ciHead = execFileSync('bdo', ['proxy', 'git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
    'rev-parse', 'refs/heads/codex/ci-0.1.46'], { cwd: repo, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  check(ciHead === inputs.head && captureApprovedInputs(repo).sha256 === inputs.current_full_inventory_sha256, 'approved_inputs_changed');
  for (const [file, digest] of inputs.historical_evidence) {
    if (file === 'approval-setup.json') continue;
    const bytes = readRegular(path.join(repo, '.release-work', file), anchorLimit);
    check(sha(bytes) === digest, 'historical_evidence_changed');
  }
  for (const row of inputs.tools) {
    const bytes = readRegular(path.join(repo, row.file), 64 * KiB);
    check(sha(bytes) === row.sha256 && bytes.length === row.bytes, 'prepared_tool_changed');
  }
  return {
    schema: 'npm-preflight-execution-plan-v1', id: ID, candidate: inputs.head, artifact_sha256: inputs.artifact,
    artifact_bytes: inputs.artifact_bytes, setup_readback_sha256: setup['setup-readback.json'][1],
    inputs_sha256: setup['inputs.json'][1], inventory_sha256: inputs.current_full_inventory_sha256,
    tools: runnerFiles.map(file => {
      const bytes = readRegular(path.join(repo, file), 64 * KiB);
      return { file, bytes: bytes.length, sha256: sha(bytes) };
    }),
    host, routes: ROUTES, limits: LIMITS, scopes, output_limits: outputLimits, reservation_bytes: total(outputLimits),
    cumulative_reserved: approval.cumulative, protected_765_bytes_used: 0, publication_approved: false,
  };
}

function assertUnused(root) {
  const entries = fs.readdirSync(root);
  check(entries.length === Object.keys(setup).length && entries.every(file => Object.hasOwn(setup, file)), 'preflight_id_consumed_or_directory_changed');
}

function outputWriter(root) {
  const parent = path.dirname(root);
  const expectedParent = directory(parent);
  const expectedRoot = directory(root);
  const sameDirectory = (actual, expected) => actual.dev === expected.dev && actual.ino === expected.ino;
  function assertDirectories() {
    check(sameDirectory(directory(parent), expectedParent) && sameDirectory(directory(root), expectedRoot), 'output_directory_changed');
  }
  function readBack(row) {
    assertDirectories();
    const location = path.join(root, row.file);
    const bytes = readRegular(location, outputLimits[row.file]);
    check(bytes.length === row.bytes && sha(bytes) === row.sha256, 'preflight_readback_changed');
  }
  function write(file, value) {
    const bytes = encode(value);
    check(Object.hasOwn(outputLimits, file) && bytes.length <= outputLimits[file], 'preflight_output_limit');
    assertDirectories();
    const fd = fs.openSync(path.join(root, file), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const dir = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      check(sameDirectory(fs.fstatSync(dir), expectedRoot), 'output_directory_changed');
      fs.fsyncSync(dir);
    } finally { fs.closeSync(dir); }
    const row = { file, bytes: bytes.length, sha256: sha(bytes) };
    readBack(row);
    return row;
  }
  return { write, readBack };
}

const protocolReason = /^(?:invalid_token|dns_timeout|dns_result_shape|transport_setup_error|get_timeout|multiple_sockets|tls_or_address_unconfirmed|http_status_shape|http_status_[1-5][0-9]{2}|header_limit|body_limit|response_(?:encoding|aborted|incomplete|json|shape)|account_unconfirmed|rights_unconfirmed|version_availability_unconfirmed|latest_(?:unconfirmed|at_or_above_candidate)|stage_(?:timeout|window_insufficient)|(?:dns|request|response)_error_(?:ENOTFOUND|EAI_AGAIN|EACCES|EPERM|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|HPE_HEADER_OVERFLOW|CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID|UNABLE_TO_VERIFY_LEAF_SIGNATURE|OTHER))$/;

export async function executePreflight({ root, plan, approvedHash, recheck, credentials, lookup, request,
  now = () => performance.now(), startedAt = now() }) {
  const elapsed = () => now() - startedAt;
  const window = (ms = 0) => check(elapsed() + ms < LIMITS.stageMs, 'stage_timeout');
  check(plan.id === ID && approvedHash === planHash(plan), 'preflight_approval_mismatch');
  check(recheck() === approvedHash, 'execution_inputs_changed');
  assertUnused(root);
  const writer = outputWriter(root);
  window(LIMITS.dnsMs + slots.length * LIMITS.getMs);
  const saved = [writer.write(approvalFile, {
    schema: 'npm-preflight-execution-approval-v1', id: ID, approval_sha256: approvedHash, plan,
    consumed: true, publication_approved: false, STOP_preserved: true,
  })];

  let phase = 'credentials';
  let result = 'stopped';
  let reason = null;
  let dnsCalls = 0;
  let requests = 0;
  let secondaryLookups = 0;
  let writeFailed = false;
  try {
    const token = credentials();
    phase = 'queries';
    window(LIMITS.dnsMs + slots.length * LIMITS.getMs);
    await runPreflight({ token, now,
      lookup(name, options, cb) {
        window(LIMITS.dnsMs);
        check(dnsCalls === 0 && name === host && options.family === 4 && options.all === false, 'dns_scope_violation');
        dnsCalls++;
        return lookup(name, options, cb);
      },
      request(options, cb) {
        window(LIMITS.getMs);
        check(dnsCalls === 1 && secondaryLookups === 0 && requests < scopes.https_gets && options.method === 'GET' &&
          options.path === ROUTES[slots[requests]] && options.servername === host, 'request_scope_violation');
        requests++;
        const refuse = options.lookup;
        return request({ ...options, lookup: (...args) => { secondaryLookups++; return refuse(...args); } }, cb);
      },
      record(slot, row) {
        check(secondaryLookups === 0, 'secondary_lookup_refused');
        phase = 'response_record';
        window();
        const { username, ...summary } = row;
        if (slot === 'account') summary.account_confirmed = true;
        if (slot === 'rights') summary.account_matches = true;
        saved.push(writer.write(slot + '.json', { id: ID, slot, ...summary }));
        phase = 'queries';
      },
    });
    phase = 'final_input_check';
    check(recheck() === approvedHash, 'execution_inputs_changed');
    check(dnsCalls === 1 && requests === slots.length && secondaryLookups === 0 && saved.length === slots.length + 1, 'request_count_unconfirmed');
    window();
    result = 'queries_confirmed';
  } catch (error) {
    const message = error?.message;
    reason = phase === 'credentials' ? 'existing_credentials_unavailable' :
      message === 'stage_timeout' ? message :
      phase === 'queries' && protocolReason.test(message) ? message :
      phase === 'response_record' ? 'response_record_failed' :
      phase === 'final_input_check' ? 'final_input_or_count_unconfirmed' : 'queries_stopped';
    writeFailed = phase === 'response_record' && reason === 'response_record_failed';
  }

  const counts = { dns_calls: dnsCalls, https_get_attempts: requests, secondary_lookup_attempts: secondaryLookups, https_puts: 0 };
  const status = { id: ID, approval_sha256: approvedHash, status: result, phase, reason, counts, no_retry: true,
    approval_consumed: true, publication_approved: false, STOP_preserved: true, protected_765_bytes_used: 0,
    cumulative_reserved: plan.cumulative_reserved, reserved_here: total(outputLimits), elapsed_ms_before_status: Math.ceil(elapsed()),
    response_record_may_be_partial: writeFailed, records: saved.slice() };
  try {
    saved.push(writer.write(statusFile, status));
    for (const row of saved) writer.readBack(row);
    if (result === 'queries_confirmed') window();
    const readback = writer.write(readbackFile, { id: ID, verified: true, status: result, records: saved,
      bytes_before_readback: saved.reduce((sum, row) => sum + row.bytes, 0) });
    if (result === 'queries_confirmed') window();
    return { ...status, readback_verified: true, elapsed_ms: Math.ceil(elapsed()),
      bytes_written_and_verified: readback.bytes + saved.reduce((sum, row) => sum + row.bytes, 0) };
  } catch {
    return { ...status, status: 'stopped', reason: 'final_record_or_readback_unconfirmed', readback_verified: false };
  }
}

async function main() {
  const startedAt = performance.now();
  const [, , mode, approval, ...extra] = process.argv;
  check((mode === '--check' && approval === undefined) || (mode === '--execute' && /^[a-f0-9]{64}$/.test(approval ?? '') && extra.length === 0), 'preflight_usage');
  checkTransportEnvironment();
  const repo = process.cwd();
  const root = rootFor(repo);
  assertUnused(root);
  const plan = planFor(repo);
  if (mode === '--check') {
    console.log(JSON.stringify({ status: 'awaiting_approval', plan_sha256: planHash(plan), plan, network_calls: 0 }));
    return;
  }
  const result = await executePreflight({ root, plan, approvedHash: approval, recheck: () => planHash(planFor(repo)),
    credentials: () => readExistingToken(repo), lookup, request, startedAt });
  console.log(JSON.stringify(result));
  if (result.status !== 'queries_confirmed') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch { console.log(JSON.stringify({ status: 'stopped', reason: 'approval_or_local_preconditions_unconfirmed' })); process.exitCode = 1; }
}
