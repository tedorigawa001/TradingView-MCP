import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { LIMITS } from './prepare-npm-preflight.mjs';
import { LOGIN_POST_BODY, LOGIN_START_PATH, LOGIN02_POST_STATUSES, MAX_POLLS, NPM_REGISTRY_HOST,
  loginEndpoints, loginHeaderBytes, loginRequestOptions } from './npm-session-release.mjs';

const tokenPattern = /^npm_[A-Za-z0-9]{12,4092}(?![\s\S])/;
const check = (condition, reason) => { if (!condition) throw Error(reason); };

// The retained login03 script is hash-bound. Use its strict decoding rules here
// without changing the old executable or widening its POST and GET 200 paths.
function parseJson(bytes) {
  let text, value;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch { throw Error('login_response_json'); }
  const lexeme = /[\t\n\r ]+|"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]:,]|[^"{}\[\]:,\s]+/y;
  const colon = /[\t\n\r ]*:/y;
  const containers = [];
  while (lexeme.lastIndex < text.length) {
    const match = lexeme.exec(text);
    check(match, 'login_response_json');
    const item = match[0];
    if (item === '{') containers.push(new Set());
    else if (item === '[') containers.push(null);
    else if (item === '}' || item === ']') containers.pop();
    else if (item.startsWith('"') && containers.at(-1)) {
      colon.lastIndex = lexeme.lastIndex;
      if (!colon.test(text)) continue;
      const key = JSON.parse(item), keys = containers.at(-1);
      check(!keys.has(key), 'login_duplicate_json_key');
      keys.add(key);
    }
  }
  return value;
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

class LoginHttpError extends Error {
  constructor(phase, status) {
    super('login_http_status');
    this.phase = phase;
    this.status = status;
  }
}

export function login04HttpFailure(error) {
  if (error instanceof LoginHttpError) return { phase: error.phase, http_status: error.status };
}

function bounded(now, deadline, duration, timeout, start) {
  const current = now();
  check(Number.isFinite(current) && current < deadline && current + duration <= deadline, 'stage_deadline');
  const expires = current + duration;
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
    try { start(done, () => settled || now() >= expires); }
    catch { done(Error('login_transport_error')); }
  });
}

function exchange({ now, deadline, request, address, route, onAdditionalLookup }) {
  const post = route === undefined;
  let req, res;
  return bounded(now, deadline, LIMITS.getMs, 'login_request_timeout', (done, expired) => {
    const stop = reason => done(Error(reason));
    let sockets = 0, secure = false;
    const options = loginRequestOptions(post ? 'POST' : 'GET', post ? LOGIN_START_PATH : route, address, (_host, _opts, cb) => {
      onAdditionalLookup();
      stop('login_second_dns');
      cb(Error('login_second_dns'));
    });
    if (post) options.headers['npm-auth-type'] = 'web';
    req = request(options, incoming => {
      incoming.on('error', () => stop('login_response_incomplete'));
      if (expired()) { incoming.destroy(); return; }
      res = incoming;
      if (!secure || sockets !== 1) return stop('login_peer_unconfirmed');
      const status = res.statusCode;
      if (!Number.isInteger(status) || status < 200 || status > 599) return stop('login_response_shape');
      if (loginHeaderBytes(status, res.statusMessage, res.rawHeaders) > LIMITS.headerBytes) return stop('login_header_limit');
      if (post ? !LOGIN02_POST_STATUSES.includes(status) : status !== 200 && status !== 202) {
        return done(new LoginHttpError(post ? 'login_post' : 'poll_get', status));
      }
      let retryAfter;
      if (!post && status === 202) {
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          if (res.rawHeaders[i].toLowerCase() !== 'retry-after') continue;
          if (retryAfter !== undefined || typeof res.rawHeaders[i + 1] !== 'string') return stop('login_poll_interval_unconfirmed');
          retryAfter = res.rawHeaders[i + 1];
        }
      }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') return stop('login_response_encoding');
      const length = res.headers['content-length'];
      if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > LIMITS.bodyBytes)) return stop('login_body_limit');
      const chunks = [];
      let received = 0;
      res.on('data', chunk => {
        if (expired()) return;
        if (received + chunk.length > LIMITS.bodyBytes) return stop('login_body_limit');
        received += chunk.length;
        chunks.push(chunk);
      });
      res.once('aborted', () => stop('login_response_incomplete'));
      res.once('close', () => { if (!res.complete) stop('login_response_incomplete'); });
      res.once('end', () => {
        if (expired()) return;
        if (!res.complete || (length !== undefined && received !== Number(length))) return stop('login_response_incomplete');
        done(null, { status, bytes: Buffer.concat(chunks, received), retryAfter });
      });
    });
    req.on('socket', socket => {
      if (++sockets !== 1) { stop('login_multiple_sockets'); req.destroy(); return; }
      socket.once('secureConnect', () => { secure = socket.authorized === true && socket.remoteAddress === address; });
    });
    req.once('upgrade', (_response, socket) => { socket.destroy(); stop('login_transport_error'); });
    req.once('error', error => stop(error?.code === 'HPE_HEADER_OVERFLOW' ? 'login_header_limit' : 'login_transport_error'));
    req.once('close', () => stop('login_response_incomplete'));
    req.end(post ? LOGIN_POST_BODY : undefined);
  }).finally(() => { res?.destroy(); req?.destroy(); });
}

export async function runLogin04Protocol({ now, deadline, lookup, request, beginBrowser, writeSession,
  sleep = delay, beforeDispatch, onAdditionalLookup }) {
  beforeDispatch('dns');
  const address = await bounded(now, deadline, LIMITS.dnsMs, 'login_dns_timeout', done => {
    lookup(NPM_REGISTRY_HOST, { family: 4, all: false }, (error, ip, family) => {
      if (error || family !== 4 || !net.isIPv4(ip)) return done(Error('login_dns_unconfirmed'));
      done(null, ip);
    });
  });
  const send = route => {
    beforeDispatch(route === undefined ? 'post' : 'get');
    return exchange({ now, deadline, request, address, route, onAdditionalLookup });
  };
  const initial = parseJson((await send()).bytes);
  check(isObject(initial) && Object.hasOwn(initial, 'loginUrl') && Object.hasOwn(initial, 'doneUrl'), 'login_response_shape');
  const { browser, poll } = loginEndpoints(initial.loginUrl, initial.doneUrl);
  check(now() < deadline, 'stage_deadline');
  try { await beginBrowser(browser); } catch { throw Error('login_browser_handoff_failed'); }
  for (let count = 1; count <= MAX_POLLS; count++) {
    const response = await send(poll);
    const body = parseJson(response.bytes);
    if (response.status === 200) {
      check(isObject(body), 'login_response_shape');
      check(Object.hasOwn(body, 'token') && typeof body.token === 'string' && tokenPattern.test(body.token), 'login_session_unconfirmed');
      writeSession(body.token);
      return;
    }
    check(typeof body === 'string' || (isObject(body) && !Object.hasOwn(body, 'token')), 'login_response_shape');
    check(count < MAX_POLLS, 'login_poll_limit');
    const after = response.retryAfter ?? '2';
    check(/^(?:0|[1-9][0-9]{0,3})$/.test(after), 'login_poll_interval_unconfirmed');
    const wait = Math.max(1000, Number(after) * 1000);
    check(now() + wait + LIMITS.getMs <= deadline, 'login_stage_timeout');
    try { await sleep(wait); } catch { throw Error('login_poll_wait_failed'); }
  }
}
