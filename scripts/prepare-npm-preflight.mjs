import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureApprovedInputs, readRegular } from './package-approval.mjs';

const KiB = 1024;
const host = 'registry.npmjs.org';
const name = 'bushido-tradingview-mcp';
const version = '0.1.46';
const head = '8d97bbaaf2360fe83b2ff6dd36ebef4887c0acc9';
const artifact = '241353c28201dfaffee179763c8500036aa2f7f821d9cfdf0090c6cb2ab573aa';
const previous = 'package-2026-11-18-reverify-r02';
const diag = 'package-2026-11-19-network-diagnostic-01';
export const ID = 'package-2026-11-19-publish-0.1.46-prep02';
export const LIMITS = Object.freeze({ dnsMs: 5000, getMs: 30000, stageMs: 180000, headerBytes: 16 * KiB, bodyBytes: 64 * KiB });
export const ROUTES = Object.freeze({
  account: '/-/whoami',
  rights: '/-/package/' + name + '/collaborators',
  version: '/' + name + '/' + version,
  tag: '/-/package/' + name + '/dist-tags',
});
const safeCodes = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET',
  'ENETUNREACH', 'EHOSTUNREACH', 'HPE_HEADER_OVERFLOW', 'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const fail = reason => { throw Error(reason); };
const requireThat = (condition, reason) => { if (!condition) fail(reason); };
const sha = value => createHash('sha256').update(value).digest('hex');
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value));
const encode = value => Buffer.from(JSON.stringify(value) + '\n');

const anchors = Object.freeze({
  'approval-setup.json': [8 * KiB, '879f62d432e3658f877b420653ccc8b47ece48ddc38d9b4b35153a9bb8e4acb9'],
  [previous + '-prep02/input-manifest.json']: [448 * KiB, '7fded8faed96e298357803aae6f76d4fa9b09eb03b321077818391a2d846dcb5'],
  [previous + '/report/result.json']: [64 * KiB, '9007f4826b10467c8ce8cbf3f6900c6dadc119dcd11a4bf9587ee0b9d66c5fdd'],
  [previous + '/artifact/verified-0.1.46.tgz']: [1024 * KiB, artifact],
  'package-2026-11-18-publish-0.1.46-prep01/status.json': [64 * KiB, '33bbe4115de97e615fbf5f32889dcde4d877ad410d3d1ab82246c1b388aafa63'],
  'package-2026-11-19-artifact-reuse-0.1.46-01/approval-reuse.json': [3 * KiB, '267d9a0d20c1bc41e1eb6b2508d9b37294903e6e28674c7b3d210267a4fd7327'],
  'package-2026-11-19-artifact-reuse-0.1.46-01/readback.json': [KiB, '6005c5457bd1b536286c549e15156ba15d345c455c0eefb82e9c5ac78fa6d53a'],
  [diag + '/status-b.json']: [4 * KiB, 'd18712e7f547250a9c0165806fdb420bb5afe26db4d06410ebe3cdf5e3052b2f'],
  [diag + '/readback-b.json']: [4 * KiB, '60e5285fe69a0e819361d64830173436be0b6df16668d09d44c93642a4f218e3'],
});
const reusePath = 'package-2026-11-19-artifact-reuse-0.1.46-01/approval-reuse.json';
const toolPaths = [
  'scripts/prepare-npm-preflight.mjs',
  'scripts/publish-verified-tarball.mjs',
  'test/release/packagePublish.test.mjs',
  'test/release/prepare-npm-preflight.test.mjs',
];

export function compareFrozenInputs(old, current, comparison) {
  const allowed = new Map(comparison.repo_input_delta);
  const { groups: before, ...priorPolicy } = old;
  const { groups: after, ...currentPolicy } = current;
  requireThat(JSON.stringify(priorPolicy) === JSON.stringify(currentPolicy), 'input_policy_changed');
  requireThat(before.length === after.length, 'input_groups_changed');
  const changed = [];
  const repoFiles = [];
  for (const [i, prior] of before.entries()) {
    const next = after[i];
    requireThat(prior.name === next.name && prior.root === next.root && prior.files.length === next.files.length, 'input_group_changed');
    for (const [j, oldFile] of prior.files.entries()) {
      const [file, n, digest] = next.files[j];
      requireThat(oldFile[0] === file, 'input_path_changed');
      const hex = Buffer.from(digest, 'base64').toString('hex');
      if (prior.name === 'repo') repoFiles.push([file, n, hex]);
      if (oldFile[1] === n && oldFile[2] === digest) continue;
      requireThat(prior.name === 'repo' && allowed.get(file) === hex, 'unapproved_input_delta');
      changed.push(file);
    }
  }
  requireThat(changed.length === allowed.size, 'approved_input_delta_missing');
  const repoHash = sha(JSON.stringify(repoFiles.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  requireThat(repoHash === comparison.current_repo_only_sha256, 'repo_fingerprint_changed');
  return { changed, repoHash };
}

function summarize(slot, status, bytes, username) {
  let value;
  try { value = parse(bytes); }
  catch { fail('response_json'); }
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  requireThat(isObject || (slot === 'version' && typeof value === 'string'), 'response_shape');
  switch (slot) {
    case 'account':
      requireThat(status === 200 && typeof value.username === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value.username), 'account_unconfirmed');
      return { username: value.username };
    case 'rights':
      requireThat(status === 200 && Object.hasOwn(value, username) && value[username] === 'read-write', 'rights_unconfirmed');
      return { username, collaborator_permission: 'read-write', token_publish_permission: 'unconfirmed' };
    case 'version': {
      const message = typeof value === 'string' ? value : value.error;
      requireThat(status === 404 && typeof message === 'string' &&
        (/^version not found:\s*0\.1\.46\s*$/i.test(message) ||
         /^no match found for version 0\.1\.46\s*$/i.test(message)), 'version_availability_unconfirmed');
      return { version, exists: false };
    }
    case 'tag': {
      requireThat(status === 200 && typeof value.latest === 'string' && /^(0|[1-9][0-9]{0,8})(\.(0|[1-9][0-9]{0,8})){2}$/.test(value.latest), 'latest_unconfirmed');
      const current = value.latest.split('.').map(Number);
      const comparison = current.findIndex((part, i) => part !== [0, 1, 46][i]);
      requireThat(comparison >= 0 && current[comparison] < [0, 1, 46][comparison], 'latest_at_or_above_candidate');
      return { latest: value.latest };
    }
    default: fail('unknown_slot');
  }
}

function bounded(fn, limit, now, timeoutReason, onTimeout = () => {}) {
  return new Promise((resolve, reject) => {
    let ended = false;
    const start = now();
    const finish = (e, v) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (e) reject(e);
      else resolve(v);
    };
    const expire = () => {
      onTimeout();
      finish(Error(timeoutReason));
    };
    const timer = setTimeout(expire, limit);
    try {
      fn((e, v) => {
        if (ended) return;
        if (now() - start >= limit) return expire();
        finish(e, v);
      });
    } catch { finish(Error('transport_setup_error')); }
  });
}

function errorCode(error) {
  let value;
  try { value = Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch {}
  return safeCodes.has(value) ? value : 'OTHER';
}

function get({ request, ip, route, token, now, limit }) {
  let req, res;
  return bounded(done => {
    let sockets = 0;
    let connected = false;
    req = request({
      hostname: ip, servername: host, family: 4, autoSelectFamily: false, port: 443, path: route,
      method: 'GET', agent: false, rejectUnauthorized: true, maxHeaderSize: LIMITS.headerBytes,
      checkServerIdentity: (_unused, cert) => tls.checkServerIdentity(host, cert),
      lookup: (_unused, _options, cb) => cb(Error('additional_lookup_refused')),
      headers: { host, authorization: 'Bearer ' + token, accept: 'application/json', 'accept-encoding': 'identity', connection: 'close' },
    }, incoming => {
      let size = 0;
      const chunks = [];
      res = incoming;
      const stop = reason => { res.destroy(); req?.destroy(); done(Error(reason)); };
      if (!connected || sockets !== 1) return stop('tls_or_address_unconfirmed');
      if (!Number.isInteger(res.statusCode) || res.statusCode < 100 || res.statusCode > 599) return stop('http_status_shape');
      const headerBytes = Buffer.byteLength('HTTP/1.1 ' + res.statusCode + ' ' + res.statusMessage + '\r\n\r\n') +
        res.rawHeaders.reduce((sum, value) => sum + Buffer.byteLength(value) + 2, 0);
      if (headerBytes > LIMITS.headerBytes) return stop('header_limit');
      if (res.statusCode !== 200 && res.statusCode !== 404) return stop('http_status_' + res.statusCode);
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') return stop('response_encoding');
      const declared = res.headers['content-length'];
      if (declared !== undefined && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > LIMITS.bodyBytes)) return stop('body_limit');
      res.on('data', bytes => {
        if (size + bytes.length > LIMITS.bodyBytes) return stop('body_limit');
        size += bytes.length;
        chunks.push(bytes);
      });
      res.once('aborted', () => stop('response_aborted'));
      res.once('error', e => stop('response_error_' + errorCode(e)));
      res.once('close', () => { if (!res.complete) stop('response_incomplete'); });
      res.once('end', () => {
        if (!res.complete || (declared !== undefined && size !== Number(declared))) return stop('response_incomplete');
        done(null, { status: res.statusCode, bytes: Buffer.concat(chunks), headerBytes });
      });
    });
    req.on('socket', socket => {
      sockets++;
      if (sockets > 1) { req.destroy(); return done(Error('multiple_sockets')); }
      socket.once('secureConnect', () => { connected = socket.authorized === true && socket.remoteAddress === ip; });
    });
    req.once('error', e => done(Error('request_error_' + errorCode(e))));
    req.end();
  }, limit, now, 'get_timeout', () => { res?.destroy(); req?.destroy(); });
}

// A testable protocol only. The offline entry point below never supplies a
// network adapter or credentials. A later approved controller must do so.
export async function runPreflight({ lookup, request, token, record, now = () => performance.now() }) {
  requireThat(typeof token === 'string' && /^[\x21-\x7e]{16,4096}$/.test(token), 'invalid_token');
  const start = now();
  const ip = await bounded(done => {
    lookup(host, { family: 4, all: false }, (error, address, family) => {
      if (error) return done(Error('dns_error_' + errorCode(error)));
      if (family !== 4 || net.isIPv4(address) === false) return done(Error('dns_result_shape'));
      done(null, address);
    });
  }, LIMITS.dnsMs, now, 'dns_timeout');
  const result = {};
  for (const [slot, route] of Object.entries(ROUTES)) {
    const remaining = LIMITS.stageMs - (now() - start);
    requireThat(remaining > 0, 'stage_timeout');
    requireThat(remaining >= LIMITS.getMs, 'stage_window_insufficient');
    const response = await get({ request, ip, route, token, now, limit: LIMITS.getMs });
    const detail = summarize(slot, response.status, response.bytes, result.account?.username);
    await record(slot, { ...detail, http_status: response.status, body_bytes: response.bytes.length,
      header_bytes: response.headerBytes, body_sha256: sha(response.bytes), address_sha256: sha(ip) });
    requireThat(now() - start < LIMITS.stageMs, 'stage_timeout');
    result[slot] = detail;
  }
  return result;
}

function git(repo, ...args) {
  return execFileSync('bdo', ['proxy','git','--no-optional-locks','-c','core.fsmonitor=false',...args],
    { cwd: repo, encoding: 'utf8', timeout: 10000, stdio: ['ignore','pipe','ignore'] }).trim();
}

function loadInputs(repo) {
  const root = path.join(repo, '.release-work', ID);
  const evidence = new Map(Object.entries(anchors).map(([key, [cap, expected]]) => {
    const file = key === 'approval-setup.json' ? path.join(root, key) : path.join(repo, '.release-work', key);
    const data = readRegular(file, cap);
    requireThat(sha(data) === expected, 'historical_evidence_changed');
    return [key, data];
  }));
  const approval = parse(evidence.get('approval-setup.json'));
  const reuse = parse(evidence.get(reusePath));
  const diagnostic = parse(evidence.get(diag + '/status-b.json'));
  requireThat(git(repo, 'rev-parse', 'refs/heads/codex/ci-0.1.46') === head, 'ci_candidate_changed');
  requireThat(reuse.candidate.sha === head && reuse.ci.run_id === 44429005157 && reuse.ci.conclusion === 'success' &&
    reuse.artifact.sha256 === artifact && reuse.artifact.bytes === 846950, 'reuse_binding');
  requireThat(diagnostic.status === 'passed' && diagnostic.dns_calls === 1 && diagnostic.http_requests === 1 &&
    diagnostic.secondary_lookup_calls === 0 && diagnostic.cumulative === approval.prior_cumulative, 'route_evidence_binding');
  const current = captureApprovedInputs(repo);
  const comparison = compareFrozenInputs(parse(evidence.get(previous + '-prep02/input-manifest.json')), current.manifest, reuse.comparison);
  const tools = toolPaths.map(file => {
    const bytes = readRegular(path.join(repo, file), 64 * KiB);
    return { file, bytes: bytes.length, sha256: sha(bytes) };
  });
  requireThat(tools[1].sha256 === 'c0e2d690604e90523ea177dbda95b1e3a0b2f5e91ea46a7cdc6f0b9b97aeeb20' &&
    tools[2].sha256 === 'abb3791014bcf209d8c22a18aec068312be8c6fe58f2148e18847a7d04c126e5', 'diagnostic_tools_changed');
  return { root, approval, snapshot: {
    id: ID, head, ci_run: reuse.ci.run_id, artifact, artifact_bytes: evidence.get(previous + '/artifact/verified-0.1.46.tgz').length,
    current_full_inventory_sha256: current.sha256, repo_inventory_sha256: comparison.repoHash,
    allowed_deltas: comparison.changed, group_counts: current.manifest.groups.map(g => [g.name, g.files.length]),
    historical_evidence: Object.entries(anchors).map(([file,[,digest]]) => [file,digest]), tools, routes: ROUTES, limits: LIMITS,
  } };
}

function prepare(repo) {
  const before = loadInputs(repo);
  const rows = [];
  function save(name, value) {
    const bytes = encode(value);
    requireThat(Object.hasOwn(before.approval.setup_limits, name) && bytes.length <= before.approval.setup_limits[name], 'setup_output_limit');
    const location = path.join(before.root, name);
    const fd = fs.openSync(location, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const h = sha(bytes);
    requireThat(readRegular(location, before.approval.setup_limits[name]).equals(bytes), 'setup_readback_changed');
    rows.push({ name, bytes: bytes.length, sha256: h });
  }
  save('inputs.json', before.snapshot);
  let tests = '';
  let reason = null;
  let after;
  try {
    tests = execFileSync(process.execPath, ['--test','--test-reporter=tap','test/release/prepare-npm-preflight.test.mjs'],
      { cwd: repo, encoding: 'utf-8', timeout: 20000, maxBuffer: 16 * KiB, stdio: ['ignore','pipe','pipe'] });
    after = loadInputs(repo).snapshot;
    requireThat(encode(before.snapshot).equals(encode(after)), 'offline_inputs_changed');
  } catch (error) {
    reason = error?.message === 'offline_inputs_changed' ? 'offline_inputs_changed' : 'offline_verification_failed';
  }
  const pass = Number(tests.match(/^# pass (\d+)$/m)?.[1] ?? 0);
  requireThat(reason || (pass > 0 && /^# fail 0$/m.test(tests) && /^# skipped 0$/m.test(tests)), 'test_summary_unconfirmed');
  save('tests.json', { id: ID, pass, reason, input_before_sha256: sha(encode(before.snapshot)),
    input_after_sha256: after ? sha(encode(after)) : null, network_calls: 0, output: tests });
  save('setup-status.json', { id: ID, status: reason ? 'stopped' : 'ready_for_preflight_review',
    reason, pass, preflight_approved: false, preflight_consumed: false, publication_approved: false,
    cumulative_reserved: before.approval.cumulative, STOP_preserved: true, evidence: rows.slice() });
  save('setup-readback.json', { id: ID, verified: true, setup_approval_sha256: anchors['approval-setup.json'][1], records: rows.slice() });
  return { id: ID, status: reason ? 'stopped' : 'ready_for_preflight_review', pass, saved: rows,
    cumulative: before.approval.cumulative, network_calls: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireThat(process.argv.length === 3 && process.argv[2] === '--prepare', 'offline_preparation_only');
  const result = prepare(process.cwd());
  console.log(JSON.stringify(result));
  if (result.status === 'stopped') process.exitCode = 1;
}
