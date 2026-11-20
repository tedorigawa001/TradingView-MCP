import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readRegular } from './package-approval.mjs';
import { LIMITS, runPreflight } from './prepare-npm-preflight.mjs';

export const LOGIN_ID = 'package-2026-11-19-publish-0.1.46-login01';
export const PREFLIGHT_ID = 'package-2026-11-19-publish-0.1.46-prep03';
export const ACCOUNT = 'tedorigawa001';
export const SESSION_ROOT = '/private/tmp/TradingView-MCP-npm-0.1.46-login01';
const registry = 'registry.npmjs.org';
const startPath = '/-/v1/login';
const loginPostBody = '{}';
export { registry as NPM_REGISTRY_HOST, startPath as LOGIN_START_PATH, loginPostBody as LOGIN_POST_BODY };
export const MAX_POLLS = 12;
export const SESSION_BYTES = 16 * 1024;
export const LOGIN02_POST_STATUSES = Object.freeze([200, 201, 202]);
const authKey = '//registry.npmjs.org/:_authToken=';
const sessionPattern = /^npm_[A-Za-z0-9]{12,4092}(?![\s\S])/;
const check = (value, reason) => { if (!value) throw Error(reason); };

function bounded(work, ms, now, reason, cancel = () => {}) {
  return new Promise((resolve, reject) => {
    const deadline = now() + ms;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const expire = () => { if (!settled) { finish(Error(reason)); cancel(); } };
    const timer = setTimeout(expire, ms);
    try { work((error, value) => now() >= deadline ? expire() : finish(error, value)); }
    catch { finish(Error('login_transport_error')); cancel(); }
  });
}

function endpoint(value, origin, validPath) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
    /^https:\/\/[\x21-\x7e]+$/.test(value) && !/[\s\\#]/.test(value), 'login_url_rejected');
  let url;
  try { url = new URL(value); } catch { throw Error('login_url_rejected'); }
  check(url.origin === origin && !url.username && !url.password && value.split('?', 1)[0] === origin + url.pathname &&
    validPath.test(url.pathname), 'login_url_rejected');
  return url;
}

const cliPath = /^\/login\/cli\/[A-Za-z0-9_-]{1,128}$/;
function exactParameter(url, key, validValue) {
  const params = [...url.searchParams];
  check(params.length === 1 && params[0][0] === key && validValue.test(params[0][1]), 'login_url_rejected');
  return params[0][1];
}

export function loginEndpoints(loginUrl, doneUrl) {
  const browser = endpoint(loginUrl, 'https://www.npmjs.com', /^\/login(?:\/cli\/[A-Za-z0-9_-]{1,128})?$/);
  if (browser.pathname === '/login') {
    const next = exactParameter(browser, 'next', cliPath);
    browser.search = new URLSearchParams({ next }).toString();
  } else {
    check(cliPath.test(browser.pathname) && !browser.search, 'login_url_rejected');
  }
  const done = endpoint(doneUrl, 'https://' + registry, /^\/-\/v1\/done(?:\/[A-Za-z0-9_-]{1,128})?$/);
  if (done.pathname === '/-/v1/done') {
    const sessionId = exactParameter(done, 'sessionId', /^[A-Za-z0-9_-]{1,128}$/);
    done.search = new URLSearchParams({ sessionId }).toString();
  } else {
    check(!done.search, 'login_url_rejected');
  }
  return { browser: browser.href, poll: done.pathname + done.search };
}

function checkUniqueKeys(text) {
  // Scan the lexical structure before JSON.parse can discard repeated keys.
  // The native parser below still checks the complete JSON grammar.
  const token = /[\t\n\r ]+|"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]:,]|[^"{}\[\]:,\s]+/y;
  const colon = /[\t\n\r ]*:/y;
  const containers = [];
  while (token.lastIndex < text.length) {
    const match = token.exec(text);
    check(match !== null, 'login_response_json');
    const value = match[0];
    if (value === '{') containers.push(new Set());
    else if (value === '[') containers.push(null);
    else if (value === '}' || value === ']') containers.pop();
    else if (value.startsWith('"') && containers.at(-1)) {
      colon.lastIndex = token.lastIndex;
      if (!colon.test(text)) continue;
      const key = JSON.parse(value);
      const keys = containers.at(-1);
      check(!keys.has(key), 'login_duplicate_json_key');
      keys.add(key);
    }
  }
}

function json(bytes, uniqueKeys) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw Error('login_response_json'); }
  if (uniqueKeys) checkUniqueKeys(text);
  let value;
  try { value = JSON.parse(text); }
  catch { throw Error('login_response_json'); }
  check(value && typeof value === 'object' && !Array.isArray(value), 'login_response_shape');
  return value;
}

class LoginHttpStatusError extends Error {
  constructor(phase, status) {
    super('login_http_status');
    this.phase = phase;
    this.httpStatus = status;
  }
}

export function loginHttpFailure(error) {
  if (error instanceof LoginHttpStatusError) return { phase: error.phase, http_status: error.httpStatus };
}

export function loginRequestOptions(method, route, address, refuseLookup) {
  const headers = { host: registry, accept: 'application/json', 'accept-encoding': 'identity', connection: 'close' };
  if (method === 'POST') Object.assign(headers, { 'content-type': 'application/json', 'content-length': '2' });
  return { hostname: address, servername: registry, port: 443, path: route, method, family: 4,
    autoSelectFamily: false, agent: false, rejectUnauthorized: true, maxHeaderSize: LIMITS.headerBytes,
    checkServerIdentity: (_name, cert) => tls.checkServerIdentity(registry, cert), lookup: refuseLookup, headers };
}

export function loginHeaderBytes(status, statusMessage, rawHeaders) {
  return Buffer.byteLength('HTTP/1.1 ' + status + ' ' + statusMessage + '\r\n\r\n') +
    rawHeaders.reduce((sum, value) => sum + Buffer.byteLength(value) + 2, 0);
}

function exchange({ method, route, request, address, timeout, now, postStatuses, login02 }) {
  let req, res;
  return bounded(done => {
    let sockets = 0;
    let secure = false;
    const stop = reason => { done(typeof reason === 'string' ? Error(reason) : reason); res?.destroy(); req?.destroy(); };
    const options = loginRequestOptions(method, route, address, (_name, _options, cb) => {
      cb(Error('login_second_dns')); stop('login_second_dns');
    });
    req = request(options, incoming => {
      res = incoming;
      if (!secure || sockets !== 1) return stop('login_peer_unconfirmed');
      const status = res.statusCode;
      if (!Number.isInteger(status) || status < 100 || status > 599) return stop('login_response_shape');
      const headerBytes = loginHeaderBytes(status, res.statusMessage, res.rawHeaders);
      if (headerBytes > LIMITS.headerBytes) return stop('login_header_limit');
      const loginPost = method === 'POST';
      if (loginPost ? !postStatuses.includes(status) : status !== 200 && status !== 202) {
        return stop(new LoginHttpStatusError(loginPost ? 'login_post' : 'poll_get', status));
      }
      let retryAfter;
      if (!loginPost && status === 202) {
        if (login02) {
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            if (res.rawHeaders[i].toLowerCase() !== 'retry-after') continue;
            if (retryAfter !== undefined || typeof res.rawHeaders[i + 1] !== 'string') return stop('login_poll_interval_unconfirmed');
            retryAfter = res.rawHeaders[i + 1];
          }
        } else {
          retryAfter = res.headers['retry-after'];
        }
      }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') return stop('login_response_encoding');
      const length = res.headers['content-length'];
      if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > LIMITS.bodyBytes)) return stop('login_body_limit');
      let size = 0;
      const chunks = [];
      res.on('data', chunk => {
        if (size + chunk.length > LIMITS.bodyBytes) return stop('login_body_limit');
        size += chunk.length;
        chunks.push(chunk);
      });
      res.once('aborted', () => stop('login_response_incomplete'));
      res.once('error', () => stop('login_response_incomplete'));
      res.once('close', () => { if (!res.complete) stop('login_response_incomplete'); });
      res.once('end', () => {
        if (!res.complete || (length !== undefined && size !== Number(length))) return stop('login_response_incomplete');
        done(null, { status, bytes: Buffer.concat(chunks, size), retryAfter });
      });
    });
    req.on('socket', socket => {
      if (++sockets !== 1) return stop('login_multiple_sockets');
      socket.once('secureConnect', () => { secure = socket.authorized === true && socket.remoteAddress === address; });
    });
    req.once('error', () => stop('login_transport_error'));
    req.end(method === 'POST' ? loginPostBody : undefined);
  }, timeout, now, 'login_request_timeout', () => { res?.destroy(); req?.destroy(); });
}

// npm Web login protocol with bounded dispatch. The caller supplies transport,
// local browser handoff and secret storage after separate approval.
async function runLoginProtocol({ lookup, request, beginBrowser, writeSession, sleep = delay,
  now = () => performance.now(), deadline = now() + LIMITS.stageMs }, login02) {
  function window(max) {
    const ms = Math.min(max, Math.floor(deadline - now()));
    check(ms > 0, 'login_stage_timeout');
    return ms;
  }
  function awaitStep(fn, reason) {
    return bounded(done => Promise.resolve().then(fn).then(value => done(null, value), () => done(Error(reason))),
      window(LIMITS.stageMs), now, 'login_stage_timeout');
  }
  const address = await bounded(done => lookup(registry, { family: 4, all: false }, (error, ip, family) => {
    if (error || family !== 4 || !net.isIPv4(ip)) return done(Error('login_dns_unconfirmed'));
    done(null, ip);
  }), window(LIMITS.dnsMs), now, 'login_dns_timeout');
  const postStatuses = login02 ? LOGIN02_POST_STATUSES : [200];
  const send = (method, route) => exchange({ method, route, request, address, timeout: window(LIMITS.getMs), now, postStatuses, login02 });
  const initial = json((await send('POST', startPath)).bytes, login02);
  if (login02) check(Object.hasOwn(initial, 'loginUrl') && Object.hasOwn(initial, 'doneUrl'), 'login_response_shape');
  const { loginUrl, doneUrl } = initial;
  const { browser, poll } = loginEndpoints(loginUrl, doneUrl);
  await awaitStep(() => { window(LIMITS.stageMs); return beginBrowser(browser); }, 'login_browser_handoff_failed');
  for (let polls = 1; polls <= MAX_POLLS; polls++) {
    const response = await send('GET', poll);
    const content = json(response.bytes, login02);
    if (response.status === 200) {
      check(typeof content.token === 'string' && sessionPattern.test(content.token), 'login_session_unconfirmed');
      await awaitStep(() => { window(LIMITS.stageMs); return writeSession(content.token); }, 'login_session_save_failed');
      window(LIMITS.stageMs);
      return { dns_calls: 1, login_post_attempts: 1, poll_get_attempts: polls, session_saved: true };
    }
    check(!Object.hasOwn(content, 'token'), 'login_response_shape');
    check(polls < MAX_POLLS, 'login_poll_limit');
    const after = response.retryAfter ?? '2';
    check(/^(?:0|[1-9][0-9]{0,3})$/.test(after), 'login_poll_interval_unconfirmed');
    const wait = Math.max(1000, Number(after) * 1000);
    const remaining = window(LIMITS.stageMs);
    check(wait < remaining && (!login02 || wait + LIMITS.getMs <= remaining), 'login_stage_timeout');
    await awaitStep(() => sleep(wait), 'login_poll_wait_failed');
  }
  throw Error('login_poll_limit');
}

export function runWebLogin(options) { return runLoginProtocol(options, false); }
export function runWebLogin02(options) { return runLoginProtocol(options, true); }

function privateSessionState(root) {
  const dir = fs.lstatSync(root, { bigint: true });
  const uid = process.getuid();
  check(dir.isDirectory() && dir.uid === BigInt(uid) && (dir.mode & 0o777n) === 0o700n, 'session_path_unconfirmed');
  const file = path.join(root, 'user.npmrc');
  const stat = fs.lstatSync(file, { bigint: true });
  check(stat.isFile() && stat.uid === BigInt(uid) && stat.nlink === 1n && (stat.mode & 0o777n) === 0o600n &&
    stat.size <= BigInt(SESSION_BYTES), 'session_path_unconfirmed');
  return { file, identity: [dir.dev, dir.ino, stat.dev, stat.ino, stat.uid, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String) };
}

export function privateSessionIdentity(root) { return privateSessionState(root).identity; }

export function inspectPrivateSession(root) {
  const { file, identity } = privateSessionState(root);
  const bytes = readRegular(file, SESSION_BYTES);
  const after = privateSessionIdentity(root);
  check(identity.every((value, i) => value === after[i]), 'session_path_changed');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  check(text.startsWith(authKey) && text.endsWith('\n'), 'session_record_unconfirmed');
  const token = text.slice(authKey.length, -1);
  check(sessionPattern.test(token), 'session_record_unconfirmed');
  return { token, identity };
}

export function readPrivateSession(root) { return inspectPrivateSession(root).token; }

export function writePrivateSession(root, token) {
  check(typeof token === 'string' && sessionPattern.test(token), 'session_record_unconfirmed');
  const bytes = Buffer.from(authKey + token + '\n');
  check(bytes.length <= SESSION_BYTES, 'session_record_limit');
  fs.mkdirSync(root, { mode: 0o700 });
  const file = path.join(root, 'user.npmrc');
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  check(readPrivateSession(root) === token, 'session_readback_unconfirmed');
  return { config_saved: true, bytes: bytes.length };
}

export async function runSessionPreflight({ record, ...options }) {
  await runPreflight({ ...options, record(slot, evidence) {
    const { username, ...summary } = evidence;
    if (slot === 'account' || slot === 'rights') {
      check(username === ACCOUNT, 'session_account_mismatch');
      summary.account_matches = true;
    }
    return record(slot, summary);
  } });
}
