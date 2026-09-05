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

test("a long message cannot stall the thread that redacts it", () => {
  // The unbounded scheme run made this quadratic: 40 KB took 2.9 s and 80 KB 11.7 s, so
  // 200 KB was over a minute of frozen event loop. redactSecrets runs on every tool error
  // and on every page exception, and a page chooses its own exception text.
  const adversarial = `http://${"a".repeat(200_000)}`;
  const started = process.hrtime.bigint();
  redactSecrets(adversarial);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 2_000,
    `redacting a 200 KB message took ${elapsedMs.toFixed(0)} ms; the scheme run is unbounded again`);
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
