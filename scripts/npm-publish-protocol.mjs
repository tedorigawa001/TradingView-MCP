import tls from 'node:tls';
import { LIMITS } from './prepare-npm-preflight.mjs';

// Wire rules for one npm publication over an already pinned registry address.
// Mirrors npm 11.16.0: libnpmpublish PUT, npm-registry-fetch EOTP detection
// (check-response.js) and npm-profile's web OTP polling (webAuthCheckLogin).
const HOST = 'registry.npmjs.org';
const KiB = 1024;
export const PUBLISH_LIMITS = Object.freeze({ putMs: 60000, getMs: LIMITS.getMs, headerBytes: LIMITS.headerBytes,
  bodyBytes: 64 * KiB, tarballBytes: 1024 * KiB, entityBytes: 2048 * KiB, maxOtpPolls: 100, minWaitMs: 2000, maxWaitSeconds: 60 });
export const CONFIRM_PHRASE = 'publish 0.1.46';

const check = (value, reason) => { if (!value) throw Error(reason); };

export function requestOptions({ method, path, address, token, otp, body, accept = 'application/json', refuseLookup }) {
  check(['GET', 'PUT'].includes(method) && typeof path === 'string' && path.startsWith('/') && typeof token === 'string', 'publish_request_shape');
  const headers = { host: HOST, accept, 'accept-encoding': 'identity', connection: 'close', authorization: 'Bearer ' + token };
  if (method === 'PUT') {
    check(Buffer.isBuffer(body) && body.length > 0 && body.length <= PUBLISH_LIMITS.entityBytes, 'publish_entity_limit');
    Object.assign(headers, { 'content-type': 'application/json', 'content-length': String(body.length),
      'npm-auth-type': 'web', 'npm-command': 'publish' });
  } else check(body === undefined, 'publish_request_shape');
  if (otp !== undefined) {
    check(method === 'PUT' && typeof otp === 'string' && /^[\x21-\x7e]{1,512}$/.test(otp), 'publish_otp_shape');
    headers['npm-otp'] = otp;
  }
  return { hostname: address, servername: HOST, port: 443, path, method, family: 4, autoSelectFamily: false, agent: false,
    rejectUnauthorized: true, maxHeaderSize: PUBLISH_LIMITS.headerBytes, lookup: refuseLookup, headers,
    checkServerIdentity: (_name, cert) => tls.checkServerIdentity(HOST, cert) };
}

// One bounded HTTPS exchange on a single verified TLS socket to the pinned address.
// `dispatched` on a failure means the request may have reached the registry.
export function exchange({ request, options, body, limit, timeoutMs, now }) {
  let req, res, dispatched = false;
  return new Promise((resolve, reject) => {
    const started = now();
    let settled = false, sockets = 0, secure = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        const failure = Error(error);
        failure.dispatched = dispatched;
        res?.destroy(); req?.destroy();
        reject(failure);
      } else resolve(value);
    };
    const timer = setTimeout(() => finish('request_timeout'), timeoutMs);
    try {
      req = request(options, incoming => {
        res = incoming;
        incoming.on('error', () => finish('response_incomplete'));
        if (settled) { incoming.destroy(); return; }
        if (!secure || sockets !== 1) return finish('peer_unconfirmed');
        const status = incoming.statusCode;
        if (!Number.isInteger(status) || status < 100 || status > 599) return finish('response_shape');
        const raw = incoming.rawHeaders ?? [];
        const headerBytes = Buffer.byteLength('HTTP/1.1 ' + status + ' ' + (incoming.statusMessage ?? '') + '\r\n\r\n') +
          raw.reduce((sum, value) => sum + Buffer.byteLength(String(value)) + 2, 0);
        if (headerBytes > PUBLISH_LIMITS.headerBytes) return finish('header_limit');
        const headers = incoming.headers ?? {};
        if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') return finish('response_encoding');
        const length = headers['content-length'];
        if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > limit)) return finish('body_limit');
        const chunks = [];
        let size = 0;
        incoming.on('data', chunk => {
          if (settled) return;
          if (size + chunk.length > limit) return finish('body_limit');
          size += chunk.length;
          chunks.push(chunk);
        });
        incoming.once('aborted', () => finish('response_incomplete'));
        incoming.once('close', () => { if (!incoming.complete) finish('response_incomplete'); });
        incoming.once('end', () => {
          if (!incoming.complete || (length !== undefined && size !== Number(length))) return finish('response_incomplete');
          if (now() - started >= timeoutMs) return finish('request_timeout');
          finish(null, { status, headers, headerBytes, bytes: Buffer.concat(chunks, size) });
        });
      });
      req.on('socket', socket => {
        if (++sockets !== 1) { finish('multiple_sockets'); return; }
        socket.once('secureConnect', () => { secure = socket.authorized === true && socket.remoteAddress === options.hostname; });
      });
      req.once('upgrade', (_response, socket) => { socket.destroy(); finish('transport_error'); });
      req.once('error', () => finish('transport_error'));
      dispatched = true;
      req.end(body);
    } catch { finish('transport_error'); }
  });
}

function json(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return undefined; }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function authTokens(value) {
  return typeof value === 'string' ? value.split(/,\s*/).map(part => part.trim().toLowerCase()) : [];
}

// Classify a PUT response exactly as npm 11.16.0 would, without trusting the body
// beyond the two optional web-OTP URLs.
export function classifyPut(response) {
  const { status, headers = {}, bytes = Buffer.alloc(0) } = response;
  if (status === 200 || status === 201) return { kind: 'accepted', status };
  const body = json(bytes);
  if (status === 401) {
    const auth = authTokens(headers['www-authenticate']);
    if (auth.includes('ipaddress')) return { kind: 'refused', status, reason: 'publish_auth_ip_address' };
    const otp = auth.includes('otp') || (!headers['www-authenticate'] && /one-time pass/.test(bytes.toString('utf8')));
    if (otp) {
      if (isObject(body) && typeof body.authUrl === 'string' && typeof body.doneUrl === 'string') {
        return { kind: 'otp_web', status, ...otpEndpoints(body.authUrl, body.doneUrl) };
      }
      return { kind: 'otp_classic', status };
    }
    return { kind: 'refused', status, reason: 'publish_http_status_401' };
  }
  // A 5xx may come from an intermediary after the origin processed the PUT.
  if (status >= 500) return { kind: 'unknown', status, reason: 'publish_http_status_' + status };
  return { kind: 'refused', status, reason: 'publish_http_status_' + status };
}

function strictUrl(value, origin) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 2048 && /^https:\/\/[\x21-\x7e]+$/.test(value) &&
    !/[\\#]/.test(value), 'publish_otp_url_rejected');
  let url;
  try { url = new URL(value); } catch { throw Error('publish_otp_url_rejected'); }
  check(url.origin === origin && !url.username && !url.password && !url.hash && value.split('?', 1)[0] === origin + url.pathname,
    'publish_otp_url_rejected');
  return url;
}

// The browser URL stays on the operator's terminal only. The poll target must be
// the registry's done endpoint with at most one simple parameter.
export function otpEndpoints(authUrl, doneUrl) {
  const browser = strictUrl(authUrl, 'https://www.npmjs.com');
  check(/^\/[A-Za-z0-9_/-]{1,256}$/.test(browser.pathname) && [...browser.searchParams].length <= 1 &&
    [...browser.searchParams].every(([k, v]) => /^[A-Za-z]{1,32}$/.test(k) && /^[A-Za-z0-9_/-]{1,256}$/.test(v)), 'publish_otp_url_rejected');
  const done = strictUrl(doneUrl, 'https://' + HOST);
  const params = [...done.searchParams];
  check(/^\/-\/v1\/done(?:\/[A-Za-z0-9_-]{1,128})?$/.test(done.pathname) && params.length <= 1 &&
    params.every(([k, v]) => /^[A-Za-z]{1,32}$/.test(k) && /^[A-Za-z0-9_-]{1,128}$/.test(v)), 'publish_otp_url_rejected');
  return { browser: browser.href, poll: done.pathname + done.search };
}

// One poll of the web OTP done endpoint: 200 carries the OTP, 202 asks to wait.
export function classifyOtpPoll(response) {
  const { status, headers = {}, bytes = Buffer.alloc(0) } = response;
  const body = json(bytes);
  if (status === 200) {
    check(isObject(body) && Object.hasOwn(body, 'token') && typeof body.token === 'string' && /^[\x21-\x7e]{1,512}$/.test(body.token),
      'publish_otp_unconfirmed');
    return { done: true, otp: body.token };
  }
  if (status === 202) {
    check(!(isObject(body) && Object.hasOwn(body, 'token')), 'publish_otp_response_shape');
    const after = headers['retry-after'] ?? '2';
    check(typeof after === 'string' && /^(?:0|[1-9][0-9]{0,3})$/.test(after) && Number(after) <= PUBLISH_LIMITS.maxWaitSeconds,
      'publish_otp_interval_unconfirmed');
    return { done: false, waitMs: Math.max(PUBLISH_LIMITS.minWaitMs, Number(after) * 1000) };
  }
  throw Error('publish_otp_http_status_' + status);
}

export function validateTotp(code) {
  check(typeof code === 'string' && /^[0-9]{6,8}$/.test(code), 'publish_otp_code_format');
  return code;
}

export function confirmed(text) {
  return typeof text === 'string' && text.replace(/\r?\n$/, '') === CONFIRM_PHRASE;
}
