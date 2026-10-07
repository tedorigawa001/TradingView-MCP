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

test("a backslash escapes a quote inside a triple-quoted string", () => {
  for (const quote of ['"""', "'''"]) {
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${quote}say \\${quote} here${quote} + str.tostring(request.security(syminfo.tickerid, "D", close))`), ["request_security"], quote);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${quote}say \\${quote} timenow${quote}\nplot(close)`), [], quote);
    // An escaped backslash escapes nothing past itself, so the string closes before the next one opens.
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${quote}C:\\\\${quote} + str.tostring(request.security(syminfo.tickerid, "D", close)) + ${quote}x${quote}`), ["request_security"], quote);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${quote}C:\\\\${quote} + ${quote}timenow${quote}\nplot(close)`), [], quote);
    // An empty one closes right after its opener.
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nx = f(${quote}${quote}, close)\ny = "a"\n${security}`), ["request_security"], quote);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nx = f(${quote}${quote}, "timenow")\nplot(close)`), [], quote);
  }
  // One that never closes hides nothing, and leaves the other kind of triple-quoted string to close as before.
  for (const [open, other] of [['"""', "'''"], ["'''", '"""']]) {
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${open}never closed\n${security}`), ["request_security"], open);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = ${open}never closed\nquoted = ${other}say ${other[0]}timenow${other[0]} here${other}\nplot(close)`), [], open);
  }
});

test("a string wrapped onto an indented line continues there; an unindented line is a new statement", () => {
  // Pine wraps a string onto a line indented by one or more spaces, four and eight among them, or by a tab.
  for (const pad of ["  ", "    ", "        ", "\t"]) {
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = "first part\n${pad}second part" + str.tostring(request.security(syminfo.tickerid, "D", close))`), ["request_security"], pad);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = "first part\n${pad}timenow in the text"\nplot(close)`), [], pad);
  }
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\nnote = "never closed\n${security}`), ["request_security"]);
});

test("inside parentheses or brackets a string wraps at any indentation", () => {
  for (const pad of ["", "    ", "        "]) {
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nlabel.new(bar_index, 0, "first part\n${pad}second part" + str.tostring(request.security(syminfo.tickerid, "D", close)))`), ["request_security"], pad);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nlabel.new(bar_index, 0, "first part\n${pad}timenow in the text")\nplot(close)`), [], pad);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nf() => ["first part\n${pad}second part", request.security(syminfo.tickerid, "D", close)]`), ["request_security"], pad);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\nf() => ["first part\n${pad}timenow in the text", close]\nplot(close)`), [], pad);
  }
  // Inside nested parentheses, after an inner pair closes, and in parentheses opened on an earlier line.
  for (const call of ["label.new(bar_index, math.max(0, 1), ", "label.new(bar_index, 0,\n "]) {
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\n${call}"first part\nsecond part" + str.tostring(request.security(syminfo.tickerid, "D", close)))`), ["request_security"], call);
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\n${call}"first part\ntimenow in the text")\nplot(close)`), [], call);
  }
  // Once the parentheses and brackets close none are left open, and none in a string or comment counts: brackets left
  // open would have the source read again as one that cannot compile, taking the wrapped text below for code.
  for (const before of ['label.new(bar_index, 0, "a")', "x = close[1]", 's = "(["', "// (["]) {
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\n${before}\nnote = "first part\n  timenow in the text"\nplot(close)`), [], before);
  }
  // A stray closer does not stop the next parentheses from counting.
  assert.deepEqual(codes(`//@version=6\nstrategy("x")\nx = close)]\nlabel.new(bar_index, 0, "first part\nsecond part" + str.tostring(request.security(syminfo.tickerid, "D", close)))`), ["request_security"]);
});

test("a source that cannot compile is also read with every string ending at its line, so a stray quote hides nothing", () => {
  for (const source of [
    `if close > open\n    note = "never closed\n    ${security}`,
    `plot(close, title = "abc)\n${security}`,
    `plot(close, title = """abc)\n${security}`,
    `x = f(close\ny = "oops\n${security}`,
    // Here only the triple quote that never closes, or only the parenthesis left open, shows that it cannot compile.
    `note = """abc\n  ${security} + "x`,
    `x = f(close\ny = "oops\n${security} + "x`,
    // A string that never closes on its line does not run on into the next statement, even where a later stray quote
    // would close it.
    `note = "never closed\n${security} + "x`,
    // What the wrapping reading finds still counts.
    `note = "first part\n  second part" + str.tostring(request.security(syminfo.tickerid, "D", close))\nx = f(close`,
  ]) {
    assert.deepEqual(codes(`//@version=6\nstrategy("x")\n${source}`), ["request_security"], source);
  }
});

test("a carriage return ends a line, alone or before a line feed", () => {
  for (const end of ["\r", "\r\n"]) {
    assert.deepEqual(codes(["//@version=6", 'strategy("x")', "// a note", security, ""].join(end)), ["request_security"], JSON.stringify(end));
  }
});

test("unclosed block comments and triple quotes keep the pass linear", () => {
  // Each opener used to search the rest of the source again: some 400,000 characters of them took seconds. A triple
  // quote behind a backslash is read as an opener in code, but escaped by the search from an earlier one.
  for (const line of ["x = 1 /* \n", 'x = 1 \\""" \n', "x = 1 \\''' \n"]) {
    const source = `//@version=6\n${line.repeat(40_000)}${security}\n`;
    const started = performance.now();
    const found = codes(source);
    const elapsed = performance.now() - started;
    assert.ok(found.includes("request_security"), line);
    assert.ok(elapsed < 1_000, `${line.trim()} took ${Math.round(elapsed)} ms`);
  }
});
