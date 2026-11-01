import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createUnsignedIsolatedTypeScript } from "../helpers/unsignedIsolatedTypeScript.mjs";

const read = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ts = createUnsignedIsolatedTypeScript(read("../../node_modules/typescript/lib/typescript.js"));
const source = read("../../native/native_bar_fs/test_unsigned_cohort_worker.mjs");
const parse = s => ts.createSourceFile("worker.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function boundary(input) {
  const s = input.replace(/\r\n/g, "\n"), tree = parse(s); assert.equal(tree.parseDiagnostics.length, 0); assert.equal(tree.statements.length, 3);
  const [entry, root, invocation] = tree.statements; assert.equal(entry.name.text, "runUnsignedCohortWorker"); assert.equal(entry.parameters.length, 0);
  assert.equal(entry.body.statements.length, 1); assert.equal(entry.body.statements[0].getText(), 'throw Error("cc2b_execution_not_approved");');
  assert.equal(root.name.text, "prepareOriginalWorkerStartup"); assert.equal(root.parameters.length, 0);
  assert.equal(root.body.statements[0].getText(), 'const policy = originalWorkerOperationalPolicy();');
  assert.equal(invocation.getText(), "runUnsignedCohortWorker();");
  const exports = Array.from(tree.statements.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)), n => n.name?.text);
  assert.deepEqual(exports, ["runUnsignedCohortWorker"]);
  const funcs = new Map(Array.from(root.body.statements.filter(n => ts.isFunctionDeclaration(n)), n => [n.name.text, n]));
  for (const [name, reason] of [["originalWorkerOperationalPolicy", "cc2b_operational_profile_unavailable"], ["reserveOriginalWorkerWork", "cc2c_work_producer_unavailable"],
    ["disposeOriginalWorkerStartup", "cc2c_startup_disposition_unavailable"], ["consumeOriginalWorkerPrepare", "cc3_prepare_connection_unavailable"]]) {
    assert.equal(funcs.get(name).body.statements.length, 1); assert.equal(funcs.get(name).body.statements[0].getText(), `throw Error("${reason}");`);
  }
  assert.deepEqual(Array.from(funcs.get("qualifyOriginalWorkerStartup").body.statements, n => n.getText()), [
    'const s = currentOriginalWorker(ref);', 's.startup.pending = false;', 's.startup.disposition = "refused";',
    'throw Error("cc2c_startup_producer_unavailable");',
  ]);
  const attempt = root.body.statements.find(n => n.kind === ts.SyntaxKind.TryStatement);
  assert.deepEqual(Array.from(root.body.statements.filter(n => !ts.isFunctionDeclaration(n)), n => n === attempt ? "try" : n.getText()), [
    'const policy = originalWorkerOperationalPolicy();', 'const clock = originalWorkerClock();',
    'const { MessageChannel } = process.getBuiltinModule("node:worker_threads");', 'const { Socket } = process.getBuiltinModule("node:net");',
    'const { setTimeout, clearTimeout } = process.getBuiltinModule("node:timers");', 'const sessions = new WeakMap(), retained = new Set(), startupProofs = new WeakMap();',
    'let workerAllocated = false;', 'let createUnsignedProtocolDecoder, readUnsignedControllerFrame, validateUnsignedWireBinding, validateUnsignedWorkerStartupEnvelope, canonical, flags, freeze;',
    'const s = allocateOriginalWorker();', "try", "return s.reference;"]);
  const initialization = attempt.tryBlock.statements;
  assert.deepEqual(Array.from(initialization, n => n.getText().includes("await import(") ? "import" : n.getText()), ["acquireOriginalWorkerPair(s);",
    'armOriginalWorkerTimer(s, "phase", s.phaseEnd);', "checkpointOriginalWorker(s);", ...Array(4).fill(["import", "checkpointOriginalWorker(s);"]).flat(),
    "s.decoder = createUnsignedProtocolDecoder();", "s.helpers = true;", "bindOriginalWorkerPipes(s);", "checkpointOriginalWorker(s);"]);
  assert.equal(attempt.catchClause.variableDeclaration, undefined); assert.equal(attempt.finallyBlock, undefined);
  assert.deepEqual(Array.from(attempt.catchClause.block.statements, n => n.getText()), ['stopOriginalWorker(s, "initialization_failed");']);
  const awaited = Array.from(initialization).filter(n => n.getText().includes("await import("));
  assert.equal(awaited.length, 4);
  for (const statement of awaited) {
    assert.ok(statement.kind === ts.SyntaxKind.ExpressionStatement && statement.expression.kind === ts.SyntaxKind.ParenthesizedExpression);
    const assignment = statement.expression.expression;
    assert.ok(ts.isBinaryExpression(assignment) && assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && assignment.right.kind === ts.SyntaxKind.AwaitExpression);
    assert.equal(assignment.right.expression.expression.kind, ts.SyntaxKind.ImportKeyword);
    assert.equal(initialization[initialization.indexOf(statement) + 1].getText(), 'checkpointOriginalWorker(s);');
  }
  const imports = [], builtins = [], constructors = [], callsites = [];
  const walk = n => {
    assert.equal(ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isCallExpression(n)) {
      const target = n.expression.getText();
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) { assert.equal(n.arguments.length, 1); assert.ok(ts.isStringLiteralLike(n.arguments[0])); imports.push(n.arguments[0].text); }
      assert.doesNotMatch(target, /(?:\.unref|\.postMessage|\.destroy|\.transfer|process\.(?:exit|kill|binding|dlopen)|createRequire|enroll|createPrivateKey|\beval\b|\bFunction\b)$/);
    }
    if (ts.isPropertyAccessExpression(n) && n.expression.getText() === "process") assert.ok(["getBuiltinModule", "hrtime", "exitCode"].includes(n.name.text), n.getText());
    // process, global objects, code/network entry points and capability bindings never travel as values. The loader is recorded only from
    // its direct, non-optional calls, so every builtin, constructor and timer callsite is counted from syntax rather than call text.
    if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      assert.ok(!["globalThis", "global", "eval", "Function", "fetch", "require", "WebAssembly", "WebSocket", "EventSource", "XMLHttpRequest", "setInterval", "clearInterval",
        "setImmediate", "clearImmediate", "queueMicrotask", "BroadcastChannel", "Worker", "crypto", "performance"].includes(n.text), n.parent.getText());
      if (n.text === "process") assert.ok(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n, n.parent.getText());
      if (["setTimeout", "clearTimeout", "Socket", "MessageChannel"].includes(n.text)) {
        const callee = (ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent)) && n.parent.expression === n;
        assert.ok(callee || n.parent.kind === ts.SyntaxKind.BindingElement && n.parent.name === n && !n.parent.propertyName, n.parent.getText()); if (callee) callsites.push(n.text);
      }
    }
    // These names are refused wherever they occur, as identifiers, property names or string keys. This is a denylist plus counted inventory, not a
    // free-identifier allowlist; computed keys built at run time stay outside a static check.
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && ["constructor", "__proto__", "prototype", "unref", "postMessage", "destroy", "transfer"].includes(n.text))
      assert.ok(false, n.parent.getText());
    if (ts.isIdentifier(n) && n.text === "getBuiltinModule") {
      const access = n.parent, call = access.parent;
      assert.ok(ts.isPropertyAccessExpression(access) && access.name === n && ts.isIdentifier(access.expression) && access.expression.text === "process" && !access.questionDotToken
        && ts.isCallExpression(call) && call.expression === access && !call.questionDotToken && call.arguments.length === 1 && ts.isStringLiteralLike(call.arguments[0]), call.getText());
      builtins.push(call.arguments[0].text);
    }
    if (ts.isNewExpression(n)) constructors.push(n.expression.getText());
    ts.forEachChild(n, walk);
  }; walk(tree);
  assert.deepEqual(imports, ["../../test/helpers/unsignedAdapterSupport.mjs", "../../test/helpers/unsignedControllerWireContracts.mjs", "../../test/helpers/unsignedWorkerStartupContracts.mjs", "../../test/helpers/unsignedControllerData.mjs"]);
  assert.deepEqual(builtins, ["node:worker_threads", "node:net", "node:timers"]);
  assert.deepEqual(constructors.sort(), ["Date", "Date", "MessageChannel", "Set", "Socket", "Socket", "WeakMap", "WeakMap"]);
  assert.deepEqual(callsites.sort(), ["MessageChannel", "Socket", "Socket", "clearTimeout", "clearTimeout", "setTimeout"]);
  assert.doesNotMatch(s, /createUnsignedWorkerPreparationModel|createUnsignedControllerProtocolModel|createUnsignedWorkerLifetimeModel|startupProofs\.set/);
  for (const pin of ['acquireOriginalWorkerPair(s); armOriginalWorkerTimer(s, "phase", s.phaseEnd); checkpointOriginalWorker(s);',
    's.pending !== r || !r.started || !r.returnSeen || !r.callbackSeen', 'owned.binding !== s.binding || owned.consumed',
    'r.started = true; r.decision = "started"; s.frames++; s.next.worker++;', 's.pair.every(p => p.closed)',
    'segment !== t.segment', 's.statusError ??=', 's.frames >= 32', 'Buffer.byteLength(canonical(view)) > 16384', 'workerAllocated = true']) {
    assert.ok(s.includes(pin), pin);
  }
  assert.doesNotMatch(funcs.get("planOriginalWorkerStatus").getText(), /s\.next\.worker\+\+/);
  assert.ok(funcs.get("receiveOriginalWorker").getText().indexOf('s.frames >= 32') < funcs.get("receiveOriginalWorker").getText().indexOf('s.decoder.push(bytes)'));
}
test("C2b facade, unavailable producers and fixed capability inventory remain sealed under LF/CRLF", () => { boundary(source); boundary(source.replace(/\r?\n/g, "\r\n")); });
test("C2b source boundaries detect individually opened entries/producers/effects and weakened original work", () => {
  const lf = source.replace(/\r\n/g, "\n");
  for (const [from, to] of [['throw Error("cc2b_execution_not_approved");', 'return;'], ['throw Error("cc2b_operational_profile_unavailable");', 'return {};'],
    ['throw Error("cc2c_work_producer_unavailable");', 'return;'], ['throw Error("cc3_prepare_connection_unavailable");', 'return {};'],
    ['throw Error("cc2c_startup_producer_unavailable");', 'return null; throw Error("cc2c_startup_producer_unavailable");'],
    ['runUnsignedCohortWorker();\n', ''], ['s.pair.every(p => p.closed)', 's.pair.some(p => p.closed)'],
    ['!r.returnSeen || !r.callbackSeen', '!r.callbackSeen'], ['catch { stopOriginalWorker(s, "initialization_failed"); }', 'catch { }'],
    ['bindOriginalWorkerPipes(s); checkpointOriginalWorker(s);\n  } catch', 'bindOriginalWorkerPipes(s);\n  } catch'],
    ['s.decoder = createUnsignedProtocolDecoder(); s.helpers = true;', 's.helpers = true; s.decoder = createUnsignedProtocolDecoder();'],
    ['const s = allocateOriginalWorker();\n', 'const s = allocateOriginalWorker();\n  setTimeout(() => {}, 1000000000);\n'],
    ['let workerAllocated = false;\n', 'let workerAllocated = false;\n  new Socket({ fd: 5, readable: true, writable: true, allowHalfOpen: false }).end("x");\n'],
    ['const clock = originalWorkerClock();\n  const { MessageChannel }', 'const { MessageChannel }'], ['return s.reference;', 'return null;']]) {
    assert.equal(lf.split(from).length, 2, from); const changed = lf.replace(from, to); assert.equal(parse(changed).parseDiagnostics.length, 0);
    assert.throws(() => boundary(changed), { code: "ERR_ASSERTION" }, from);
  }
  for (const extra of ['\nexport function run() {}', '\nprocess.exit(1);', '\nimport fs from "node:fs";']) assert.throws(() => boundary(lf + extra));
  // Capability probes go into an added private declaration, outside the pinned root statements, so only the syntax inventory can refuse them.
  const anchor = '  function rejectOriginalWorker(reason) { throw Error("cc2b_" + reason); }\n';
  for (const extra of ['const { spawn } = Reflect.apply(process.getBuiltinModule, process, ["node:child_process"]);', 'const { readFileSync } = globalThis.process.getBuiltinModule("node:fs");',
    'const { readFileSync } = process["getBuiltinModule"]("node:fs");', 'const host = process;', 'const { getBuiltinModule } = process;', 'const host = global.process;',
    'return process?.getBuiltinModule("node:child_process");', 'return process\n      .getBuiltinModule("node:fs");', 'setTimeout(() => {}, 1000000000);',
    'new Socket({ fd: 5, readable: true, writable: true, allowHalfOpen: false }).end("x");', 'Reflect.apply(eval, null, ["1"]);', 'Buffer.constructor("return 1")();',
    'fetch("https://example.invalid/");', 'const later = setTimeout;', 'Reflect.get(Buffer, "constructor")("return 1")();', 'const { constructor: make } = Buffer;',
    'setInterval(() => {}, 1);', 'queueMicrotask(() => {});', 'Reflect.apply(port.unref, port, []);']) {
    assert.equal(lf.split(anchor).length, 2); const changed = lf.replace(anchor, anchor + "  function extraOriginalWorker() { " + extra + " }\n");
    assert.equal(parse(changed).parseDiagnostics.length, 0); assert.throws(() => boundary(changed), { code: "ERR_ASSERTION" }, extra);
  }
  boundary(lf.replace(anchor, anchor + "  function extraOriginalWorker() { return 1; }\n"));
  const imports = lf.split("\n").filter(line => line.includes(" = await import(")); assert.equal(imports.length, 4);
  for (const line of imports) {
    const changed = lf.replace(line, line.replace(' checkpointOriginalWorker(s);', ''));
    assert.notEqual(changed, lf); assert.equal(parse(changed).parseDiagnostics.length, 0);
    assert.throws(() => boundary(changed), { code: "ERR_ASSERTION" });
  }
});
function harnessGuard(s) {
  const first = s.indexOf('await import("../helpers/');
  for (const pin of ['block(net, ["connect", "createConnection", "createServer", "Server", "Socket"])', 'block(dgram, ["createSocket", "Socket"])',
    'block(listener, ["listen"])', 'block(datagram, ["bind"])', 'block(workers, ["Worker", "MessageChannel"', 'block(child, ["spawn"',
    '[globalThis, "Date", ["now"]]', '[process, "hrtime", ["bigint"]]', 'block(crypto, ["sign", "verify"', 'block(fsp, mutations)',
    'block(fs, ["read", "readSync", "readv", "readvSync", "createReadStream"]);', 'syncBuiltinESMExports();'])
    assert.ok(s.indexOf(pin) >= 0 && s.indexOf(pin) < first, pin);
  for (const pin of ['[net, "Socket"]', '[connectionPrototype, "connect"]', '[net, "Server"]']) assert.ok(s.includes(pin));
  for (const pin of ['[fs, "read"]', '[fs, "readSync"]', '[fs, "readv"]', '[fs, "readvSync"]', '[fs, "createReadStream"]']) assert.ok(s.includes(pin));
  assert.ok(s.indexOf('for (const [o, k] of required)') < s.indexOf('for (const [o, k] of blocked)'));
  assert.doesNotMatch(s, /from ["']typescript["']|\.skip\(|\.todo\(/);
  assert.equal(s.lastIndexOf('\ntest("C2b no denied effect was swallowed"'), s.lastIndexOf('\ntest('));
}
test("C2b memory harness guards capabilities before any target dependency, including constructor bypasses", () => {
  const s = read("./nativeBarAdmissionUnsignedWorkerConnection.test.mjs"); harnessGuard(s);
  for (const pin of ['block(fs, ["read", "readSync", "readv", "readvSync", "createReadStream"]);',
    '[fs, "read"]', '[fs, "readSync"]', '[fs, "readv"]', '[fs, "readvSync"]', '[fs, "createReadStream"]']) {
    const changed = s.replace(pin, ''); assert.notEqual(changed, s); assert.equal(parse(changed).parseDiagnostics.length, 0);
    assert.throws(() => harnessGuard(changed), { code: "ERR_ASSERTION" });
  }
});
test("C2b is not registered in product, package, legacy worker or live adapters", () => {
  for (const p of ["../../package.json", "../../native/native_bar_fs/test_unsigned_worker.mjs", "../helpers/unsignedInertAdapters.mjs"])
    assert.doesNotMatch(read(p), /test_unsigned_cohort_worker|runUnsignedCohortWorker/);
  for (const p of fs.readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(p => p.endsWith(".ts")))
    assert.doesNotMatch(read("../../src/" + p), /test_unsigned_cohort_worker|runUnsignedCohortWorker/);
});
