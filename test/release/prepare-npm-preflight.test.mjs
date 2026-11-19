import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { compareFrozenInputs, LIMITS, ROUTES, runPreflight } from '../../scripts/prepare-npm-preflight.mjs';

const IP = '192.0.2.42';
const host = 'registry.npmjs.org';
const token = 'synthetic-credential-never-record';
const rows = [
  [200, { username: 'fixture-user' }],
  [200, { 'fixture-user': 'read-write' }],
  [404, { error: 'version not found: 0.1.46' }],
  [200, { latest: '0.1.45' }],
];
function scenario({ responses = rows, dns = null, onRequest, responseOptions = {}, onRecord } = {}) {
  const dnsCalls = [];
  const gets = [];
  const recorded = [];
  const config = {
    token,
    lookup(hostname, options, cb) {
      dnsCalls.push({ hostname, options });
      if (dns) return dns(cb);
      cb(null, IP, 4);
    },
    request(options, cb) {
      const index = gets.push(options) - 1;
      const [code, value] = responses[index];
      const req = new EventEmitter();
      const socket = new EventEmitter();
      const res = new EventEmitter();
      req.destroy = () => { req.destroyed = true; };
      res.destroy = () => { res.destroyed = true; };
      Object.assign(socket, { remoteAddress: IP, authorized: true }, responseOptions.socket);
      Object.assign(res, { statusCode: code, statusMessage: 'stub', rawHeaders: [], headers: {}, complete: true }, responseOptions.response);
      req.end = () => queueMicrotask(() => {
        if (onRequest?.(req, index, socket)) return;
        req.emit('socket', socket);
        socket.emit('secureConnect');
        cb(res);
        if (res.destroyed) return;
        res.emit('data', Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)));
        if (!res.destroyed) res.emit('end');
      });
      return req;
    },
    record(slot, evidence) {
      onRecord?.(slot);
      recorded.push({ slot, evidence });
    },
  };
  return { config, calls: dnsCalls, gets, recorded };
}

test('one IPv4 resolution pins four exact GETs and authenticates the hostname', async () => {
  const s = scenario();
  const out = await runPreflight(s.config);
  assert.deepEqual(s.calls, [{ hostname: host, options: { family: 4, all: false } }]);
  assert.deepEqual(s.gets.map(g => g.path), Object.values(ROUTES));
  for (const get of s.gets) {
    assert.equal(get.hostname, IP);
    assert.equal(get.servername, host);
    assert.equal(get.headers.host, host);
    assert.equal(get.method, 'GET');
    assert.equal(get.autoSelectFamily, false);
    assert.equal(get.agent, false);
    assert.equal(get.rejectUnauthorized, true);
    assert.equal(get.maxHeaderSize, LIMITS.headerBytes);
    get.lookup('unused', {}, e => assert.match(e.message, /additional_lookup_refused/));
    assert.ok(get.checkServerIdentity(IP, { subjectaltname: 'DNS:other.invalid' }));
    assert.equal(get.checkServerIdentity(IP, { subjectaltname: 'DNS:' + host }), undefined);
  }
  assert.equal(out.rights.token_publish_permission, 'unconfirmed');
  assert.equal(out.tag.latest, '0.1.45');
  assert.ok(!JSON.stringify(s.recorded).includes(token));
  assert.equal(new Set(s.recorded.map(x => x.evidence.address_sha256)).size, 1);
});

test('lookup error stops after one lookup and zero requests without exposing errors', async () => {
  const s = scenario({ dns: cb => cb(Object.assign(Error(token), { code: 'ENOTFOUND' })) });
  await assert.rejects(runPreflight(s.config), { message: 'dns_error_ENOTFOUND' });
  assert.equal(s.calls.length, 1);
  assert.equal(s.gets.length, 0);
});

test('IPv6 and late DNS results cannot initiate a request', async () => {
  const invalid = scenario({ dns: cb => cb(null, '2001:db8::1', 6) });
  await assert.rejects(runPreflight(invalid.config), /dns_result_shape/);
  assert.equal(invalid.gets.length, 0);
  let time = 0;
  const late = scenario({ dns: cb => { time = LIMITS.dnsMs; cb(null, IP, 4); } });
  await assert.rejects(runPreflight({ ...late.config, now: () => time }), /dns_timeout/);
  assert.equal(late.gets.length, 0);
});

test('redirects and auth failures stop without following a URL or resending', async () => {
  for (const status of [301, 302, 401, 403, 429, 500]) {
    const s = scenario({ responses: [[status, {}]], responseOptions: { response: { headers: { location: 'https://other.invalid/' } } } });
    await assert.rejects(runPreflight(s.config), new RegExp('http_status_' + status));
    assert.equal(s.gets.length, 1);
    assert.equal(s.recorded.length, 0);
  }
});

test('a different peer or an unauthenticated TLS socket stops the sequence', async () => {
  for (const socket of [{ remoteAddress: '192.0.2.99' }, { authorized: false }]) {
    const s = scenario({ responseOptions: { socket } });
    await assert.rejects(runPreflight(s.config), /tls_or_address_unconfirmed/);
    assert.equal(s.gets.length, 1);
  }
});

test('a second socket is refused within the same request', async () => {
  const s = scenario({ onRequest: (req, _, socket) => {
    req.emit('socket', socket);
    req.emit('socket', socket);
    assert.equal(req.destroyed, true);
    return true;
  }});
  await assert.rejects(runPreflight(s.config), /multiple_sockets/);
  assert.equal(s.gets.length, 1);
});

test('oversized and incompletely framed responses stop before recording', async () => {
  const failures = [
    [{ rawHeaders: ['x', 'a'.repeat(LIMITS.headerBytes)] }, rows[0][1], /header_limit/],
    [{ headers: { 'content-length': String(LIMITS.bodyBytes + 1) } }, rows[0][1], /body_limit/],
    [{}, Buffer.alloc(LIMITS.bodyBytes + 1), /body_limit/],
    [{ complete: false }, rows[0][1], /response_incomplete/],
    [{ headers: { 'content-encoding': 'gzip' } }, rows[0][1], /response_encoding/],
  ];
  for (const [response, value, pattern] of failures) {
    const s = scenario({ responses: [[200, value]], responseOptions: { response } });
    await assert.rejects(runPreflight(s.config), pattern);
    assert.equal(s.gets.length, 1);
    assert.equal(s.recorded.length, 0);
  }
});

test('the username returned by whoami must have read-write membership', async () => {
  const s = scenario({ responses: [rows[0], [200, { 'someone-else': 'read-write', 'fixture-user': 'read-only' }]] });
  await assert.rejects(runPreflight(s.config), /rights_unconfirmed/);
  assert.equal(s.gets.length, 2);
  assert.deepEqual(s.recorded.map(x => x.slot), ['account']);
});

test('existing versions and ambiguous 404 bodies prevent the tag GET', async () => {
  for (const response of [[200, { version: '0.1.46' }], [404, { error: 'Not Found' }], [404, { error: 'version not found: 0.1.45' }]]) {
    const s = scenario({ responses: [...rows.slice(0, 2), response] });
    await assert.rejects(runPreflight(s.config), /version_availability_unconfirmed/);
    assert.equal(s.gets.length, 3);
  }
});

test('equal, newer and missing latest tags all block readiness', async () => {
  for (const latest of ['0.1.46', '0.1.100', '1.0.0', undefined]) {
    const s = scenario({ responses: [...rows.slice(0, 3), [200, { latest }]] });
    await assert.rejects(runPreflight(s.config), /latest_(?:unconfirmed|at_or_above_candidate)/);
    assert.equal(s.gets.length, 4);
    assert.equal(s.recorded.length, 3);
  }
});

test('invalid JSON and request errors do not copy strings into an error or evidence', async () => {
  const json = scenario({ responses: [[200, Buffer.from(token)]] });
  await assert.rejects(runPreflight(json.config), { message: 'response_json' });
  const req = scenario({ onRequest: req => {
    req.emit('error', Object.assign(Error(token), { code: token }));
    return true;
  }});
  await assert.rejects(runPreflight(req.config), { message: 'request_error_OTHER' });
  assert.equal(req.gets.length, 1);
  assert.equal(json.recorded.length + req.recorded.length, 0);
});

test('a late GET and a stage deadline stop further requests', async () => {
  let time = 0;
  const late = scenario({ onRequest: () => { time = LIMITS.getMs; } });
  await assert.rejects(runPreflight({ ...late.config, now: () => time }), /get_timeout/);
  assert.equal(late.gets.length, 1);
  time = 0;
  const stage = scenario({ onRecord: () => { time = LIMITS.stageMs; } });
  await assert.rejects(runPreflight({ ...stage.config, now: () => time }), /stage_timeout/);
  assert.equal(stage.gets.length, 1);
});

test('only the exact approved repository deltas are accepted', () => {
  const oldHash = Buffer.alloc(32, 1).toString('base64');
  const newHex = '02'.repeat(32);
  const newHash = Buffer.from(newHex, 'hex').toString('base64');
  const old = { policy: 'fixture', groups: [
    { name: 'repo', root: '/r', files: [['src/a.ts', 1, oldHash], ['test/a.mjs', 1, oldHash]] },
    { name: 'workspace', root: '/n', files: [['lib.js', 1, oldHash]] },
  ] };
  const changed = structuredClone(old);
  changed.groups[0].files[1] = ['test/a.mjs', 2, newHash];
  const repoRows = [['src/a.ts', 1, '01'.repeat(32)], ['test/a.mjs', 2, newHex]];
  const comparison = { repo_input_delta: [['test/a.mjs', newHex]],
    current_repo_only_sha256: createHash('sha256').update(JSON.stringify(repoRows)).digest('hex') };
  assert.deepEqual(compareFrozenInputs(old, changed, comparison).changed, ['test/a.mjs']);
  assert.throws(() => compareFrozenInputs(old, old, comparison), /approved_input_delta_missing/);
  for (const update of [
    m => { m.groups[0].files[0][2] = newHash; },
    m => { m.groups[0].files[1][1] = 5; },
    m => { m.groups[1].files[0][2] = newHash; },
    m => { m.groups[1].root = '/other'; },
  ]) {
    const m = structuredClone(changed);
    update(m);
    assert.throws(() => compareFrozenInputs(old, m, comparison));
  }
});
