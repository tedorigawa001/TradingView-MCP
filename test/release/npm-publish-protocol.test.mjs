import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { CONFIRM_PHRASE, PUBLISH_LIMITS, classifyOtpPoll, classifyPut, confirmed, exchange, otpEndpoints,
  requestOptions, validateTotp } from '../../scripts/npm-publish-protocol.mjs';

const ip = '192.0.2.81';
const token = 'npm_SyntheticProtocolTokenOnly';
const authUrl = 'https://www.npmjs.com/auth/cli/mock-otp-session';
const doneUrl = 'https://registry.npmjs.org/-/v1/done?authId=mock-otp-session';
const refuse = (_host, _options, callback) => callback(Error('additional_lookup_refused'));
const json = value => Buffer.from(JSON.stringify(value));

test('request options pin the address, carry the session token and add publish headers only to the PUT', () => {
  const get = requestOptions({ method: 'GET', path: '/-/whoami', address: ip, token, refuseLookup: refuse });
  assert.equal(get.hostname, ip);
  assert.equal(get.servername, 'registry.npmjs.org');
  assert.deepEqual([get.port, get.family, get.agent, get.autoSelectFamily, get.rejectUnauthorized, get.maxHeaderSize],
    [443, 4, false, false, true, PUBLISH_LIMITS.headerBytes]);
  assert.equal(get.lookup, refuse);
  assert.deepEqual(get.headers, { host: 'registry.npmjs.org', accept: 'application/json', 'accept-encoding': 'identity',
    connection: 'close', authorization: 'Bearer ' + token });
  const body = Buffer.from('{"name":"x"}');
  const put = requestOptions({ method: 'PUT', path: '/x', address: ip, token, body, otp: '123456', refuseLookup: refuse });
  assert.equal(put.headers['content-type'], 'application/json');
  assert.equal(put.headers['content-length'], String(body.length));
  assert.equal(put.headers['npm-auth-type'], 'web');
  assert.equal(put.headers['npm-command'], 'publish');
  assert.equal(put.headers['npm-otp'], '123456');
  assert.equal(Object.hasOwn(requestOptions({ method: 'PUT', path: '/x', address: ip, token, body }).headers, 'npm-otp'), false);
  assert.ok(put.checkServerIdentity(ip, { subject: { CN: 'example.com' }, subjectaltname: 'DNS:example.com' }) instanceof Error);
  assert.equal(put.checkServerIdentity(ip, { subject: {}, subjectaltname: 'DNS:registry.npmjs.org' }), undefined);
});

test('request options refuse other methods, OTP on GET, malformed OTP values and oversized or missing bodies', () => {
  const base = { path: '/x', address: ip, token, refuseLookup: refuse };
  for (const method of ['POST', 'DELETE', 'get']) assert.throws(() => requestOptions({ ...base, method }), /publish_request_shape/);
  assert.throws(() => requestOptions({ ...base, method: 'GET', otp: '123456' }), /publish_otp_shape/);
  assert.throws(() => requestOptions({ ...base, method: 'GET', body: Buffer.from('x') }), /publish_request_shape/);
  for (const otp of ['', '12 34', 'x\r\ny', '\u00e9', 7]) {
    assert.throws(() => requestOptions({ ...base, method: 'PUT', body: Buffer.from('{}'), otp }), /publish_otp_shape/);
  }
  assert.throws(() => requestOptions({ ...base, method: 'PUT' }), /publish_entity_limit/);
  assert.throws(() => requestOptions({ ...base, method: 'PUT', body: Buffer.alloc(0) }), /publish_entity_limit/);
  assert.throws(() => requestOptions({ ...base, method: 'PUT', body: Buffer.alloc(PUBLISH_LIMITS.entityBytes + 1) }), /publish_entity_limit/);
  assert.throws(() => requestOptions({ ...base, method: 'PUT', body: '{}' }), /publish_entity_limit/);
});

test('PUT replies are classified like npm: accepted, web OTP, classic OTP, refused and unanswered', () => {
  const otpHeader = { 'www-authenticate': 'OTP' };
  assert.deepEqual(classifyPut({ status: 200 }), { kind: 'accepted', status: 200 });
  assert.deepEqual(classifyPut({ status: 201 }), { kind: 'accepted', status: 201 });
  const web = classifyPut({ status: 401, headers: otpHeader, bytes: json({ authUrl, doneUrl }) });
  assert.equal(web.kind, 'otp_web');
  assert.equal(web.browser, authUrl);
  assert.equal(web.poll, '/-/v1/done?authId=mock-otp-session');
  assert.equal(classifyPut({ status: 401, headers: { 'www-authenticate': 'Basic, otp' }, bytes: json({ error: 'otp' }) }).kind, 'otp_classic');
  assert.equal(classifyPut({ status: 401, headers: {}, bytes: Buffer.from('{"error":"You must provide a one-time pass."}') }).kind, 'otp_classic');
  assert.deepEqual(classifyPut({ status: 401, headers: { 'www-authenticate': 'IPADDRESS' }, bytes: json({}) }),
    { kind: 'refused', status: 401, reason: 'publish_auth_ip_address' });
  assert.deepEqual(classifyPut({ status: 401, headers: { 'www-authenticate': 'Bearer' }, bytes: Buffer.from('one-time pass') }),
    { kind: 'refused', status: 401, reason: 'publish_http_status_401' });
  assert.deepEqual(classifyPut({ status: 403, bytes: json({ error: 'cannot publish over existing version' }) }),
    { kind: 'refused', status: 403, reason: 'publish_http_status_403' });
  assert.deepEqual(classifyPut({ status: 302 }), { kind: 'refused', status: 302, reason: 'publish_http_status_302' });
  for (const status of [500, 502, 503]) assert.deepEqual(classifyPut({ status }), { kind: 'unknown', status, reason: 'publish_http_status_' + status });
  assert.throws(() => classifyPut({ status: 401, headers: otpHeader, bytes: json({ authUrl: 'https://evil.example/x', doneUrl }) }),
    /publish_otp_url_rejected/);
});

test('web OTP URLs must be the npm website and the registry done endpoint, without extras', () => {
  assert.deepEqual(otpEndpoints(authUrl, doneUrl), { browser: authUrl, poll: '/-/v1/done?authId=mock-otp-session' });
  assert.equal(otpEndpoints(authUrl, 'https://registry.npmjs.org/-/v1/done/abc_123').poll, '/-/v1/done/abc_123');
  for (const bad of ['http://www.npmjs.com/auth/x', 'https://www.npmjs.com:444/auth/x', 'https://user@www.npmjs.com/auth/x',
    'https://www.npmjs.com/auth/x#frag', 'https://www.npmjs.com/auth/../x', 'https://www.npmjs.com/auth/%2e%2e/x',
    'https://www.npmjs.com/auth/x?a=1&b=2', 'https://www.npmjs.com.evil.example/auth/x', 'https://www.npmjs.com\\@evil/x',
    'https://www.npmjs.com/auth/x?a=b c', ' https://www.npmjs.com/auth/x', 'https://www.npmjs.com/' + 'a'.repeat(300), 42]) {
    assert.throws(() => otpEndpoints(bad, doneUrl), /publish_otp_url_rejected/, String(bad));
  }
  for (const bad of ['https://registry.npmjs.org/-/v1/login', 'https://registry.npmjs.org/-/v1/done/a/b',
    'https://registry.npmjs.org/-/v1/done?a=1&b=2', 'https://registry.npmjs.org/-/v1/done?x=a.b', 'https://www.npmjs.com/-/v1/done',
    'http://registry.npmjs.org/-/v1/done', 'https://registry.npmjs.org:8443/-/v1/done', 'https://registry.npmjs.org/-/v1/done#x',
    'https://registry.npmjs.org/-/v1/donex']) {
    assert.throws(() => otpEndpoints(authUrl, bad), /publish_otp_url_rejected/, bad);
  }
});

test('OTP polls: 200 carries the code, 202 waits within bounds, anything else stops', () => {
  assert.deepEqual(classifyOtpPoll({ status: 200, bytes: json({ token: 'otp-value-1' }) }), { done: true, otp: 'otp-value-1' });
  for (const body of [{}, { token: '' }, { token: 7 }, { token: 'a b' }, null, []]) {
    assert.throws(() => classifyOtpPoll({ status: 200, bytes: json(body) }), /publish_otp_unconfirmed/);
  }
  assert.throws(() => classifyOtpPoll({ status: 200, bytes: Buffer.from('not json') }), /publish_otp_unconfirmed/);
  assert.deepEqual(classifyOtpPoll({ status: 202, bytes: Buffer.alloc(0) }), { done: false, waitMs: PUBLISH_LIMITS.minWaitMs });
  assert.deepEqual(classifyOtpPoll({ status: 202, headers: { 'retry-after': '0' } }), { done: false, waitMs: 2000 });
  assert.deepEqual(classifyOtpPoll({ status: 202, headers: { 'retry-after': '5' } }), { done: false, waitMs: 5000 });
  assert.deepEqual(classifyOtpPoll({ status: 202, headers: { 'retry-after': '60' } }), { done: false, waitMs: 60000 });
  for (const after of ['61', '-1', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT', '01', '']) {
    assert.throws(() => classifyOtpPoll({ status: 202, headers: { 'retry-after': after } }), /publish_otp_interval_unconfirmed/, after);
  }
  assert.throws(() => classifyOtpPoll({ status: 202, bytes: json({ token: 'early' }) }), /publish_otp_response_shape/);
  for (const status of [401, 404, 500]) assert.throws(() => classifyOtpPoll({ status }), new RegExp('publish_otp_http_status_' + status));
});

test('authenticator codes and the confirmation phrase are exact', () => {
  for (const code of ['123456', '1234567', '12345678']) assert.equal(validateTotp(code), code);
  for (const code of ['12345', '123456789', '12345a', ' 123456', 123456]) assert.throws(() => validateTotp(code), /publish_otp_code_format/);
  assert.equal(CONFIRM_PHRASE, 'publish 0.1.46');
  for (const text of ['publish 0.1.46', 'publish 0.1.46\n', 'publish 0.1.46\r\n']) assert.equal(confirmed(text), true);
  for (const text of ['Publish 0.1.46', 'publish 0.1.46 ', ' publish 0.1.46', 'publish 0.1.45', 'yes', '', undefined]) {
    assert.equal(confirmed(text), false, String(text));
  }
});

function fakeRequest(plan) {
  const seen = { bodies: [], options: [] };
  const request = (options, receive) => {
    if (plan.throwOnRequest) throw Error('refused before dispatch');
    seen.options.push(options);
    const req = new EventEmitter();
    req.destroy = () => { seen.destroyed = true; };
    req.end = body => {
      seen.bodies.push(body);
      queueMicrotask(() => {
        for (let i = 0; i < (plan.sockets ?? 1); i++) {
          const socket = new EventEmitter();
          Object.assign(socket, { authorized: plan.authorized ?? true, remoteAddress: plan.remote ?? ip });
          req.emit('socket', socket);
          socket.emit('secureConnect');
        }
        if (plan.error) return req.emit('error', Error('ECONNRESET'));
        const res = new EventEmitter();
        const headers = plan.headers ?? {};
        Object.assign(res, { statusCode: plan.status ?? 200, statusMessage: 'fixture', complete: plan.complete ?? true, headers,
          rawHeaders: Object.entries(headers).flat(), destroy() { res.destroyed = true; } });
        receive(res);
        for (const chunk of plan.chunks ?? [Buffer.from('{}')]) if (!res.destroyed) res.emit('data', chunk);
        if (!res.destroyed) res.emit('end');
      });
    };
    return req;
  };
  return { request, seen };
}

const options = { hostname: ip };
const run = (plan, extra = {}) => {
  const fake = fakeRequest(plan);
  return { fake, result: exchange({ request: fake.request, options, body: extra.body, limit: extra.limit ?? 1024, timeoutMs: 1000,
    now: extra.now ?? (() => 0) }) };
};

test('an exchange returns the bounded reply from one verified socket and sends the body once', async () => {
  const body = Buffer.from('{"put":true}');
  const { fake, result } = run({ status: 201, headers: { 'content-length': '11' }, chunks: [Buffer.from('{"ok":true}')] }, { body });
  const value = await result;
  assert.equal(value.status, 201);
  assert.equal(value.bytes.toString(), '{"ok":true}');
  assert.ok(value.headerBytes > 0);
  assert.deepEqual(fake.seen.bodies, [body]);
});

test('an exchange rejects unverified peers, extra sockets, encodings, oversized or truncated bodies', async () => {
  const cases = [
    [{ authorized: false }, 'peer_unconfirmed'], [{ remote: '192.0.2.1' }, 'peer_unconfirmed'], [{ sockets: 2 }, 'multiple_sockets'],
    [{ status: 99 }, 'response_shape'], [{ headers: { 'content-encoding': 'gzip' } }, 'response_encoding'],
    [{ headers: { 'content-length': '2048' } }, 'body_limit'], [{ headers: { 'content-length': '01' } }, 'body_limit'],
    [{ chunks: [Buffer.alloc(1025)] }, 'body_limit'], [{ headers: { 'content-length': '10' } }, 'response_incomplete'],
    [{ complete: false }, 'response_incomplete'], [{ headers: { 'x-big': 'a'.repeat(PUBLISH_LIMITS.headerBytes) } }, 'header_limit'],
  ];
  for (const [plan, reason] of cases) {
    const { result } = run(plan);
    await assert.rejects(result, error => error.message === reason && error.dispatched === true, JSON.stringify(plan).slice(0, 60));
  }
});

test('an exchange marks transport failures after dispatch, and refusals before dispatch, distinctly', async () => {
  await assert.rejects(run({ error: true }).result, error => error.message === 'transport_error' && error.dispatched === true);
  await assert.rejects(run({ throwOnRequest: true }).result, error => error.message === 'transport_error' && error.dispatched === false);
  const throwing = exchange({ request: () => Object.assign(new EventEmitter(), { end() { throw Error('write after partial send'); }, destroy() {} }),
    options, limit: 1024, timeoutMs: 1000, now: () => 0 });
  await assert.rejects(throwing, error => error.message === 'transport_error' && error.dispatched === true);
  let t = 0;
  const late = run({}, { now: () => (t += 1000) });
  await assert.rejects(late.result, error => error.message === 'request_timeout' && error.dispatched === true);
});
