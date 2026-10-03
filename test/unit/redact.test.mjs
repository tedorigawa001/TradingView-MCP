import test from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, MAX_REDACTED_CHARS } from "../../build/redact.js";

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
    // Before the query rule, so a header inside a query string cannot leave its credential behind the "?***".
    ["GET https://api.example/v1?x=1,Authorization:Bearer sk-live-123", "GET https://api.example/v1?***"],
  ];
  for (const [input, expected] of cases) {
    const once = redactSecrets(input);
    assert.equal(once, expected, JSON.stringify(input));
    assert.equal(redactSecrets(once), once, `redacting twice changes nothing: ${JSON.stringify(input)}`);
    for (const secret of ["sk-live-123", "dXNlcjpwYXNz", "abc123", "k-9"]) assert.ok(!once.includes(secret), `${secret} in ${once}`);
  }
});

test("redaction keeps ordinary text: an empty value, a stack frame, a JSON literal and prose stay as they are", () => {
  for (const text of [
    "study st1 not found", "authorization failed", "Unexpected token '<'", "(reading 'authorization')",
    "Authorization:\nnext line text here", "no Authorization:\n    at foo (x.js:1:2)", '{"Authorization":null,"Host":"x"}',
    "Authorization: true\n    at foo (x.js:1:2)", "token\nnext line here",
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
    "'authorization', ".repeat(12_000), `"token"${" ".repeat(200_000)}`]) {
    const started = process.hrtime.bigint();
    redactSecrets(adversarial);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 2_000,
      `redacting ${JSON.stringify(adversarial.slice(0, 20))}… (${adversarial.length} chars) took ${elapsedMs.toFixed(0)} ms`);
  }
});

test("the result is capped so a huge message cannot be relayed verbatim", () => {
  const result = redactSecrets("x".repeat(50_000));
  assert.ok(result.length < 50_000, "an oversized message must not pass through whole");
  assert.ok(result.length <= MAX_REDACTED_CHARS + 16, `capped result was ${result.length} chars`);
  assert.match(result, /\[truncated\]$/, "truncation must be visible to the reader");
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
