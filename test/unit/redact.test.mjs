import test from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, MAX_REDACTED_CHARS, WITHHELD_MESSAGE } from "../../build/redact.js";

test("redaction still removes userinfo, query strings and bearer tokens", () => {
  assert.equal(redactSecrets("connect http://user:hunter2@10.11.12.13:9222 failed"),
    "connect http://***@10.11.12.13:9222 failed");
  assert.equal(redactSecrets("at run (https://cdn.example/bundle.js?session=tok123:1:2)"),
    "at run (https://cdn.example/bundle.js?***)",
    "the query string and everything after it goes, the surrounding text stays");
  assert.equal(redactSecrets("sent authorization: abc.def-123"), "sent authorization: ***");
  assert.equal(redactSecrets("study st1 not found"), "study st1 not found",
    "ordinary text must be left alone");
});

test("an Authorization value goes whole, scheme and credentials, also quoted, folded or redacted twice (BACKLOG 102-02)", () => {
  // Masking only the first word left the credential: "Authorization: *** sk-live-123".
  const cases = [
    ["Authorization: Bearer sk-live-123", "Authorization: ***"],
    ["authorization=Bearer sk-live-123", "authorization=***"],
    ["Authorization Bearer sk-live-123", "Authorization ***"],
    ["Authorization\tBearer sk-live-123", "Authorization\t***"],
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: ***"],
    ["Proxy-Authorization: Basic dXNlcjpwYXNz", "Proxy-Authorization: ***"],
    ['{"Authorization":"Basic dXNlcjpwYXNz","Host":"x"}', '{"Authorization":"***","Host":"x"}'],
    ['"Authorization" : "Basic dXNlcjpwYXNz"', '"Authorization" : "***"'],
    ["{'Authorization': 'Bearer sk-live-123'}", "{'Authorization': '***'}"],
    ["{ authorization: 'Bearer sk-live-123', host: 'x' }", "{ authorization: '***', host: 'x' }"],
    ['{\\"Authorization\\":\\"Basic dXNlcjpwYXNz\\"}', '{\\"Authorization\\":\\"***\\"}'],
    ["['Authorization', 'Basic dXNlcjpwYXNz']", "['Authorization', '***']"],
    ['{"name":"Authorization","value":"Basic dXNlcjpwYXNz"}', '{"name":"Authorization","value":"***"}'],
    ["'authorization' => 'Basic dXNlcjpwYXNz'", "'authorization' => '***'"],
    // Multi-part values go to the end of the line: everything after the first ", " used to stay.
    ['Authorization: Digest username="u", response="abc123"', "Authorization: ***"],
    ["Authorization: AWS4-HMAC-SHA256 Credential=k-9/20261003/s3, SignedHeaders=host, Signature=abc123", "Authorization: ***"],
    // Folds: onto an indented line, before the scheme or after it alone.
    ["Authorization:\n  Bearer sk-live-123", "Authorization:\n  ***"],
    ["Authorization: Bearer \n  sk-live-123", "Authorization: ***"],
    ["Authorization: Bearer abc\nthe next line stays", "Authorization: ***\nthe next line stays"],
    ["Authorization: abc123\nthe next line stays", "Authorization: ***\nthe next line stays"],
    ['{"token":"abc123","api_key": "k-9"}', '{"token":"***","api_key": "***"}'],
    ['{\\"token\\":\\"abc123\\"}', '{\\"token\\":\\"***\\"}'],
    ["Bearer sk-live-123", "Bearer ***"],
    ["Authorization: Bearer sk-live-123\nProxy-Authorization: Basic dXNlcjpwYXNz", "Authorization: ***\nProxy-Authorization: ***"],
    ["Authorization:\r\n  Basic dXNlcjpwYXNz", "Authorization:\r\n  ***"],
    // A value that merely starts with a literal, as from `${scheme} ${token}` with no scheme, is masked.
    ["Authorization: undefined sk-live-123", "Authorization: ***"],
    ["Authorization: null sk-live-123", "Authorization: ***"],
    // A quoted value runs to its own closing quote, past escaped quotes and other escapes inside it.
    ['{"Authorization":"Digest username=\\"abc123\\", response=\\"k-9\\""}', '{"Authorization":"***"}'],
    ["{'Authorization': 'Digest username=\"abc123\", response=\"k-9\"'}", "{'Authorization': '***'}"],
    ['{"Authorization":"Basic dXNl\\/dXNlcjpwYXNz=="}', '{"Authorization":"***"}'],
    ['[\\"Authorization\\", \\"Basic dXNlcjpwYXNz\\"]', '[\\"Authorization\\", \\"***\\"]'],
    ["['Authorization' , 'Basic dXNlcjpwYXNz']", "['Authorization' , '***']"],
    // Bearer, token and API-key values folded onto an indented next line.
    ["Bearer\n  sk-live-123", "Bearer\n  ***"],
    ["token:\n  abc123", "token:\n  ***"],
    ["x-api-key:\r\n k-9", "x-api-key:\r\n ***"],
    ['"token":\n  "abc123"', '"token":\n  "***"'],
    ["'api_key' => 'k-9'", "'api_key' => '***'"],
    // An escaped JSON string runs to its real closing \" (one backslash, then the end of a JSON value): a ', an inner
    // \\\" (a quote escaped twice) or \\/ inside it does not end it.
    [String.raw`{\"Authorization\":\"Digest realm='r', response=\"abc123\"\"}`, String.raw`{\"Authorization\":\"***\"}`],
    [String.raw`{\"Authorization\":\"Digest username=\\\"u\\\", qop='auth', response=\\\"abc123\\\"\",\"Host\":\"x\"}`,
      String.raw`{\"Authorization\":\"***\",\"Host\":\"x\"}`],
    [String.raw`{\"Authorization\":\"Digest qop='auth', response='abc123'\"}`, String.raw`{\"Authorization\":\"***\"}`],
    [String.raw`{\"Authorization\":\"Basic dXNl\\/dXNlcjpwYXNz==\"}`, String.raw`{\"Authorization\":\"***\"}`],
    [String.raw`{\'Authorization\': \'Digest qop="auth", response="abc123"\'}`, String.raw`{\'Authorization\': \'***\'}`],
    // The closing \" may follow 4k + 1 backslashes (a value ending in an escaped backslash), and precede an escaped \n of
    // pretty-printed JSON, blanks or a real line end; with none on its line the value runs to the end of the line.
    [String.raw`{\"Authorization\":\"Basic dXNlcjpwYXNz\\\\\",\"Host\":\"keep-host\"}`, String.raw`{\"Authorization\":\"***\\\\\",\"Host\":\"keep-host\"}`],
    [String.raw`{\n  \"Authorization\": \"Basic dXNlcjpwYXNz\"\n}, keep`, String.raw`{\n  \"Authorization\": \"***\"\n}, keep`],
    [String.raw`{\"Authorization\":\"Basic dXNlcjpwYXNz\"  }`, String.raw`{\"Authorization\":\"***\"  }`],
    [String.raw`{\"Authorization\":\"Basic dXNlcjpwYXNz\"` + "\nnext line", String.raw`{\"Authorization\":\"***\"` + "\nnext line"],
    [String.raw`{\"Authorization\":\"Basic dXNlcjpwYXNz` + "\n" + String.raw`\"}`, String.raw`{\"Authorization\":\"***` + "\n" + String.raw`\"}`],
    ["{'Authorization': 'Digest u=\"a\", x=\\'k-9\\''}", "{'Authorization': '***'}"],
    ["Bearer  \n  sk-live-123", "Bearer  \n  ***"],
    // Before the query rule, so a header inside a query string cannot leave its credential behind the "?***".
    ["GET https://api.example/v1?x=1,Authorization:Bearer sk-live-123", "GET https://api.example/v1?***"],
  ];
  // Every known scheme after a bare space, and alone before a folded value.
  for (const scheme of ["Bearer", "Basic", "Digest", "Negotiate", "NTLM", "AWS4-HMAC-SHA256", "OAuth"]) {
    cases.push([`Authorization ${scheme} sk-live-123`, "Authorization ***"], [`Authorization: ${scheme}\n  sk-live-123`, "Authorization: ***"]);
  }
  for (const [input, expected] of cases) {
    const once = redactSecrets(input);
    assert.equal(once, expected, JSON.stringify(input));
    assert.equal(redactSecrets(once), once, `redacting twice changes nothing: ${JSON.stringify(input)}`);
    for (const secret of ["sk-live-123", "dXNlcjpwYXNz", "abc123", "k-9"]) assert.ok(!once.includes(secret), `${secret} in ${once}`);
  }
});

// Leaks found in the 102-02 review and the 2026-10-04 follow-up (BACKLOG 102-27).
const LEAKS_102_27 = [
  // A secret key inside a longer name: snake_case, camelCase, kebab-case, a prefix ending in "_".
  ["access_token=abc123", "access_token=***"],
  ["refresh_token: abc123", "refresh_token: ***"],
  ['{"accessToken":"abc123","expires_in":3600}', '{"accessToken":"***","expires_in":3600}'],
  ["x-auth-token: abc123", "x-auth-token: ***"],
  ["csrftoken=abc123", "csrftoken=***"],
  ["HTTP_AUTHORIZATION: Bearer abc123", "HTTP_AUTHORIZATION: ***"],
  ['authorizationHeader: "Bearer abc123"', 'authorizationHeader: "***"'],
  ["{ proxyAuthorization: 'Basic dXNlcjpwYXNz' }", "{ proxyAuthorization: '***' }"],
  // Keys that had no rule at all.
  ["client_secret=abc123", "client_secret=***"],
  ['{"clientSecret":"abc123"}', '{"clientSecret":"***"}'],
  ["password: hunter2", "password: ***"],
  ['{"password":"hunter2","user":"bob"}', '{"password":"***","user":"bob"}'],
  ["passwd=hunter2", "passwd=***"],
  ["passphrase: hunter2", "passphrase: ***"],
  ["access_key=abc123", "access_key=***"],
  ["{ auth: 'bob:hunter2' }", "{ auth: '***' }"],
  ['{"private_key":"abc123"}', '{"private_key":"***"}'],
  ["credentials=abc123", "credentials=***"],
  ['{"jwt":"abc123"}', '{"jwt":"***"}'],
  ["sessionid=abc123", "sessionid=***"],
  ["session_id: abc123", "session_id: ***"],
  ['{"sessionId":"abc123"}', '{"sessionId":"***"}'],
  ["sessionid_sign=abc123", "sessionid_sign=***"],
  // A cookie header goes whole, as an Authorization value does.
  ["Cookie: sessionid=abc123; csrftoken=k-9", "Cookie: ***"],
  ["Set-Cookie: sessionid=abc123; Path=/; HttpOnly", "Set-Cookie: ***"],
  ['{"cookie":"sessionid=abc123; csrftoken=k-9"}', '{"cookie":"***"}'],
  // A value no longer stops at "%", ":" or a "," that something other than a blank follows.
  ["token=abc123%2Fk-9", "token=***"],
  ["api_key=abc123:k-9", "api_key=***"],
  ["access_token=abc123,k-9", "access_token=***"],
  // A URL fragment goes as a query does.
  ["redirect to https://app.example/cb#access_token=abc123&state=k-9", "redirect to https://app.example/cb#***"],
  ["https://app.example/cb?x=1#id_token=abc123", "https://app.example/cb?***"],
  // URL- or form-encoded separators and quotes.
  ["Authorization%3A%20Bearer%20abc123", "Authorization%3A%20***"],
  ["access_token%3Dabc123%26state%3Dk-9", "access_token%3D***"],
  ["%22token%22%3A%22abc123%22", "%22token%22%3A***"],
  // A password holding "@": the userinfo runs to the last "@" before the host.
  ["connect http://user:p@ss-hunter2@10.0.0.1:9222/x failed", "connect http://***@10.0.0.1:9222/x failed"],
  // An "@" in the query is not userinfo: the host stays and the query goes.
  ["GET https://h.example?mail=ops@k-9.example", "GET https://h.example?***"],
  // JSON escaped twice, util.inspect of an escaped JSON string (backslashes doubled, quotes not escaped), JSON escaped
  // three times, and inner quotes escaped only once.
  [String.raw`{\\\"token\\\":\\\"abc123\\\"}`, String.raw`{\\\"token\\\":\\\"***\\\"}`],
  [String.raw`{\\\"Authorization\\\":\\\"Basic dXNlcjpwYXNz\\\",\\\"Host\\\":\\\"x\\\"}`, String.raw`{\\\"Authorization\\\":\\\"***\\\",\\\"Host\\\":\\\"x\\\"}`],
  [String.raw`'{\\"Authorization\\":\\"Basic dXNlcjpwYXNz\\"}'`, String.raw`'{\\"Authorization\\":\\"***\\"}'`],
  [String.raw`{\\\\\\\"token\\\\\\\":\\\\\\\"abc123\\\\\\\"}`, String.raw`{\\\\\\\"token\\\\\\\":\\\\\\\"***\\\\\\\"}`],
  [String.raw`{\\\"Authorization\\\":\\\"Digest username=\"u\", response=\"abc123\"\\\"}`, String.raw`{\\\"Authorization\\\":\\\"***\\\"}`],
  // A quote escaped one level deeper inside does not close the value, even followed by ",".
  [String.raw`{\\\"Authorization\\\":\\\"Digest a=\\\\\\\"u\\\\\\\", response=\\\\\\\"abc123\\\\\\\"\\\"}`, String.raw`{\\\"Authorization\\\":\\\"***\\\"}`],
  // HAR entries for any secret name, and with the value before the name.
  ['{"name":"Cookie","value":"sessionid=abc123"}', '{"name":"Cookie","value":"***"}'],
  ['{"name":"access_token","value":"abc123"}', '{"name":"access_token","value":"***"}'],
  ['{"value":"Basic dXNlcjpwYXNz","name":"Authorization"}', '{"value":"***","name":"Authorization"}'],
  ['{"value":"abc123", "name":"sessionid"}', '{"value":"***", "name":"sessionid"}'],
  ['{"value":"sessionid=abc123","name":"Set-Cookie"}', '{"value":"***","name":"Set-Cookie"}'],
  // A private key spans lines; one cut before its end goes to the end of the text.
  ["key: -----BEGIN PRIVATE KEY-----\nMIIabc123\nk-9\n-----END PRIVATE KEY-----\nnext line",
    "key: -----BEGIN PRIVATE KEY-----\n***\n-----END PRIVATE KEY-----\nnext line"],
  ["-----BEGIN RSA PRIVATE KEY-----\nabc123\nk-9", "-----BEGIN RSA PRIVATE KEY-----\n***"],
];

test("secrets under longer or other names, in fragments, encoded, escaped deeper, in HAR or a private key go too (BACKLOG 102-27)", () => {
  for (const [input, expected] of LEAKS_102_27) {
    const once = redactSecrets(input);
    assert.equal(once, expected, JSON.stringify(input));
    assert.equal(redactSecrets(once), once, `redacting twice changes nothing: ${JSON.stringify(input)}`);
    for (const secret of ["sk-live-123", "dXNlcjpwYXNz", "abc123", "k-9", "hunter2", "p@ss"]) {
      assert.ok(!once.includes(secret), `${secret} in ${once}`);
    }
  }
});

test("the wider rules keep ordinary text: a trading session, prose about secrets, plain URLs and public keys stay", () => {
  for (const text of [
    '{"session":"asia","timezone":"UTC"}', "session: london", "invalid local session date: 2026-01-01", 'quote.session = "regular"',
    "password reset required", "cookie banner dismissed", "Unexpected token '<' in JSON", "authorization failed",
    "see https://docs.example/page for details", "at run (https://cdn.example/bundle.js:1:2)", "mail ops@example.com",
    "http://host.example/path@v2", "-----BEGIN PUBLIC KEY-----\nMIIBIj\n-----END PUBLIC KEY-----", "-----BEGIN CERTIFICATE-----\nMIIB",
    '{"token":null,"x":1}', "allowed headers: ['authorization', 'cookie']", "author: Ada", "OAuth: enabled",
  ]) assert.equal(redactSecrets(text), text, JSON.stringify(text));
});

test("redaction keeps ordinary text: an empty value, a stack frame, a JSON literal and prose stay as they are", () => {
  for (const text of [
    "study st1 not found", "authorization failed", "Unexpected token '<'", "(reading 'authorization')",
    "Authorization:\nnext line text here", "no Authorization:\n    at foo (x.js:1:2)", '{"Authorization":null,"Host":"x"}',
    "Authorization: true\n    at foo (x.js:1:2)", "token\nnext line here", "Bearer\n    at foo (x.js:1:2)",
    "Authorization: false, next: 1", "allowed headers: ['authorization', 'content-type']", "[ 'accept', 'authorization', 'host' ]",
  ]) assert.equal(redactSecrets(text), text, JSON.stringify(text));
  assert.equal(redactSecrets("Authorization: Bearer\n    at foo (x.js:1:2)"), "Authorization: ***\n    at foo (x.js:1:2)",
    "a scheme alone takes no stack frame as its folded value");
  assert.equal(redactSecrets("Error: request failed\nAuthorization: Bearer sk-live-123\n    at send (x.js:1:2)"),
    "Error: request failed\nAuthorization: ***\n    at send (x.js:1:2)", "the stack frame after the header stays");
});

test("a long message cannot stall the thread that redacts it", () => {
  // The unbounded scheme run made this quadratic: 40 KB took 2.9 s and 80 KB 11.7 s, so
  // 200 KB was over a minute of frozen event loop. redactSecrets runs on every tool error
  // and on every page exception, and a page chooses its own exception text.
  // The query rule rescanned the rest of the message from every later "x://": 200 KB of them took 5 s (102-02 review).
  for (const adversarial of [`http://${"a".repeat(200_000)}`, "x://".repeat(50_000), "x://y".repeat(40_000), "authorization: ".repeat(15_000),
    `Authorization: Bearer ${"a".repeat(200_000)}`, `authorization${" ".repeat(200_000)}`, '"authorization"'.repeat(14_000),
    "'authorization', ".repeat(12_000), `"token"${" ".repeat(200_000)}`,
    // The rules of 102-27: secret names, cookies, encoded separators, deep escapes, HAR, private keys and userinfo.
    "access_token=".repeat(15_000), `access_token${"_".repeat(200_000)}`, `Cookie: ${"a".repeat(200_000)}`,
    "authorization%3A".repeat(12_000), "sessionid".repeat(20_000), String.raw`token:\\\"`.repeat(20_000),
    String.raw`{\"token\":\"` + "a".repeat(200_000), `"value":"${"a".repeat(200_000)}`, '"value":"a",'.repeat(15_000),
    "-----BEGIN PRIVATE KEY-----".repeat(7_000), `http://${"@".repeat(200_000)}`, `${"a".repeat(64)}://${"b@".repeat(1_000)}`.repeat(90),
    `token=${",a".repeat(100_000)}`]) {
    const started = process.hrtime.bigint();
    redactSecrets(adversarial);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 2_000,
      `redacting ${JSON.stringify(adversarial.slice(0, 20))}… (${adversarial.length} chars) took ${elapsedMs.toFixed(0)} ms`);
  }
});

test("a message that cannot be redacted is withheld whole instead of thrown or passed on", (t) => {
  // A quoted value of some 8 million characters overflows the regexp stack; any such failure must fail closed.
  t.mock.method(String.prototype, "replace", () => { throw new RangeError("Maximum call stack size exceeded"); });
  assert.equal(redactSecrets("Authorization: Bearer sk-live-123"), WITHHELD_MESSAGE);
  t.mock.restoreAll();
  // The real input, 9 million characters in one quoted value: whichever way the engine goes, it neither throws nor
  // passes the value on.
  const result = redactSecrets(`{"Authorization":"Basic ${"a".repeat(9_000_000)}`);
  assert.ok(result === WITHHELD_MESSAGE || result === '{"Authorization":"***', result.slice(0, 60));
});

test("the result is capped so a huge message cannot be relayed verbatim", () => {
  const result = redactSecrets("x".repeat(50_000));
  assert.ok(result.length < 50_000, "an oversized message must not pass through whole");
  assert.ok(result.length <= MAX_REDACTED_CHARS + 16, `capped result was ${result.length} chars`);
  assert.match(result, /\[truncated\]$/, "truncation must be visible to the reader");
});

test("the truncation marker survives a second redaction, even right after a masked value", () => {
  // Cut just after `"***`: a quoted value run went on through "… [truncated]" and dropped it under the cap.
  const head = '{"Authorization":"***';
  const once = redactSecrets(`${"x".repeat(MAX_REDACTED_CHARS - head.length)}{"Authorization":"Basic dXNlcjpwYXNz"} and more text`);
  assert.ok(once.endsWith(`${head}\n… [truncated]`), once.slice(-40));
  assert.equal(redactSecrets(once), once);
});

test("a second redaction of a cut result changes nothing, wherever the cut falls in an escaped value", () => {
  // The marker is set aside before a second pass and a dangling backslash at the cut is dropped, so neither a value
  // shortened at the cut nor a lone backslash read as a value can move or drop the marker.
  for (const tail of [String.raw`{\"Authorization\":\"Basic dXNlcjpwYXNz\"}`, `{"Authorization":"Basic dXNlcjpwYXNz"}`,
    String.raw`{\"Authorization\":\"Digest username=\\\"u\\\", response=\\\"dXNlcjpwYXNz\\\"\"}`, String.raw`{\"token\":\"dXNlcjpwYXNz\"}`]) {
    for (let offset = MAX_REDACTED_CHARS - 80; offset <= MAX_REDACTED_CHARS + 20; offset++) {
      const once = redactSecrets(`${"x".repeat(offset)}${tail} and more`);
      assert.equal(redactSecrets(once), once, `${tail} at ${offset}`);
      assert.ok(!once.includes("dXNlcjpwYXNz"), `${tail} at ${offset}`);
      if (once.length > MAX_REDACTED_CHARS) assert.equal(once.split("[truncated]").length, 2, `one marker at ${offset}`);
    }
  }
});

test("truncation happens after redaction, so no secret survives by straddling the cut", () => {
  // Cutting first would leave "http://user:hun" — no "@", nothing for the userinfo
  // pattern to match, and the start of the credential in the client's error message.
  const secret = "http://user:hunter2@internal.corp/";
  const message = `${"x".repeat(MAX_REDACTED_CHARS - 15)}${secret}`;
  const result = redactSecrets(message);
  assert.ok(!result.includes("hunter2"), "the credential must not survive");
  assert.ok(!result.includes("hun"), `a credential prefix leaked: ${result.slice(-40)}`);
});
