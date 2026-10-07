import assert from "node:assert/strict";
import test from "node:test";
import { auditPineSource } from "../../build/pineAudit.js";

const codes = (source) => auditPineSource(source).findings.map((finding) => finding.code);
const security = 'h = request.security(syminfo.tickerid, "D", close)';

// BACKLOG 102-19: strings and comments are told apart in one pass, so neither hides code from the audit.
test("a URL in a string is no comment, and the code after it is still audited", () => {
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\nlabel = "see https://example.com"\n${security}`), ["request_security"]);
  assert.deepEqual(codes(`//@version=6\nstrategy('x')\nlabel = 'see https://example.com'\n${security}`), ["request_security"]);
  // On one line, after the string.
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\nlabel = "https://a"; ${security}`), ["request_security"]);
});

test("escaped quotes and backslashes stay inside their string", () => {
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\ns = "say \\"//not a comment\\" now"\n${security}`), ["request_security"]);
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\np = "C:\\\\"\n${security}`), ["request_security"]);
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\ns = 'it\\'s //fine'\n${security}`), ["request_security"]);
});

test("comments hide what they contain, and only that", () => {
  // A quote inside a line comment opens no string.
  assert.deepEqual(codes("//@version=6\nstrategy('x')\n// it's a note\nvarip float x = na"), ["varip"]);
  // A construct inside a comment is no use of it.
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\n// ${security}\n/* t = timenow */\nplot(close)`), []);
  // A "/*" inside a string opens no block comment.
  assert.deepEqual(codes('//@version=6\nstrategy("x")\ns = "/* not a comment"\nv = ta.pivothigh(2, 2)\nt = "*/"'), ["pivots"]);
  // A block comment that never ends hides nothing: what follows is read as code.
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\n/* unfinished\n${security}`), ["request_security"]);
});

test("a construct inside a string is no use of it, and an unterminated string ends with its line", () => {
  assert.deepEqual(codes('//@version=6\nstrategy("x")\nnote = "request.security( and timenow and varip"\nplot(close)'), []);
  assert.deepEqual(codes("//@version=6\nstrategy('x')\nnote = 'request.security( and timenow'\nplot(close)"), []);
  // An escaped quote does not close the string, so what follows it is still inside.
  assert.deepEqual(codes('//@version=6\nstrategy("x")\nnote = "a \\" timenow \\" b"\nplot(close)'), []);
  // A backslash at the end of the line escapes no newline: the string still ends there.
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\nopen_string = "ends with a backslash\\\n${security}`), ["request_security"]);
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\nopen_string = "never closed\n${security}`), ["request_security"]);
});

test("every dangerous construct after a URL is found", () => {
  const source = [
    "//@version=6",
    'strategy("x", calc_on_every_tick = true)',
    'docs = "https://www.tradingview.com/pine-script-docs/"',
    security,
    "p = ta.pivotlow(3, 3)",
    "varip int ticks = 0",
    "elapsed = timenow - time",
    "live = barstate.isrealtime",
  ].join("\n");
  assert.deepEqual(codes(source), ["request_security", "pivots", "varip", "timenow", "calc_on_every_tick", "barstate_isrealtime"]);
});
