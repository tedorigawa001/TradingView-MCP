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

test("a triple-quoted string spans lines, and the code after its close is audited", () => {
  for (const quote of ['"""', "'''"]) {
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${quote}first\nsecond${quote}\n${security}`), ["request_security"], quote);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${quote}first\nsecond${quote} + str.tostring(request.security(syminfo.tickerid, "D", close))`), ["request_security"], quote);
    // What it contains, on any of its lines, is text.
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${quote}first\ntimenow and varip in the text\nend${quote}\nplot(close)`), [], quote);
    // One whose text begins with a quote closes at the triple quote after its opener, not one overlapping it.
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${quote}${quote[0]}timenow${quote[0]} is quoted${quote}\nplot(close)`), [], quote);
  }
});

test("a string wrapped onto an indented line continues there; a block-indented line is code", () => {
  // Pine wraps a long line onto one indented by spaces that are not a multiple of four.
  assert.deepEqual(codes('//@version=6\nstrategy("x")\nnote = "first part\n  second part" + str.tostring(request.security(syminfo.tickerid, "D", close))'), ["request_security"]);
  assert.deepEqual(codes('//@version=6\nstrategy("x")\nnote = "first part\n  timenow in the text"\nplot(close)'), []);
  // Four spaces indent a block body, which no string runs into.
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\nif close > open\n    note = "never closed\n    ${security}`), ["request_security"]);
});

test("unclosed block comment markers keep the pass linear", () => {
  // Each "/*" used to search the rest of the source again: some 400,000 characters of them took seconds.
  const source = `//@version=6\n${"x = 1 /* \n".repeat(40_000)}${security}\n`;
  const started = performance.now();
  const found = codes(source);
  const elapsed = performance.now() - started;
  assert.ok(found.includes("request_security"));
  assert.ok(elapsed < 1_000, `took ${Math.round(elapsed)} ms`);
});
