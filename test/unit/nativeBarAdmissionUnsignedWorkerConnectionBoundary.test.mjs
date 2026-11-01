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
  const initialization = root.body.statements.find(n => n.kind === ts.SyntaxKind.TryStatement).tryBlock.statements;
  const awaited = Array.from(initialization).filter(n => n.getText().includes("await import("));
  assert.equal(awaited.length, 4);
  for (const statement of awaited) {
    assert.ok(statement.kind === ts.SyntaxKind.ExpressionStatement && statement.expression.kind === ts.SyntaxKind.ParenthesizedExpression);
    const assignment = statement.expression.expression;
    assert.ok(ts.isBinaryExpression(assignment) && assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && assignment.right.kind === ts.SyntaxKind.AwaitExpression);
    assert.equal(assignment.right.expression.expression.kind, ts.SyntaxKind.ImportKeyword);
    assert.equal(initialization[initialization.indexOf(statement) + 1].getText(), 'checkpointOriginalWorker(s);');
  }
  const imports = [], builtins = [], constructors = new Set();
  const walk = n => {
    assert.equal(ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isCallExpression(n)) {
      const target = n.expression.getText();
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) { assert.equal(n.arguments.length, 1); assert.ok(ts.isStringLiteralLike(n.arguments[0])); imports.push(n.arguments[0].text); }
      if (target === "process.getBuiltinModule") { assert.equal(n.arguments.length, 1); builtins.push(n.arguments[0].text); }
      assert.doesNotMatch(target, /(?:\.unref|\.postMessage|\.destroy|\.transfer|process\.(?:exit|kill|binding|dlopen)|createRequire|enroll|createPrivateKey|\beval\b|\bFunction\b)$/);
    }
    if (ts.isPropertyAccessExpression(n) && n.expression.getText() === "process") assert.ok(["getBuiltinModule", "hrtime", "exitCode"].includes(n.name.text), n.getText());
    if (ts.isNewExpression(n)) constructors.add(n.expression.getText());
    ts.forEachChild(n, walk);
  }; walk(tree);
  assert.deepEqual(imports, ["../../test/helpers/unsignedAdapterSupport.mjs", "../../test/helpers/unsignedControllerWireContracts.mjs", "../../test/helpers/unsignedWorkerStartupContracts.mjs", "../../test/helpers/unsignedControllerData.mjs"]);
  assert.deepEqual(builtins, ["node:worker_threads", "node:net", "node:timers"]);
  assert.deepEqual([...constructors].sort(), ["Date", "MessageChannel", "Set", "Socket", "WeakMap"]);
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
  for (const [from, to] of [['throw Error("cc2b_execution_not_approved");', 'return;'], ['throw Error("cc2b_operational_profile_unavailable");', 'return {};'],
    ['throw Error("cc2c_work_producer_unavailable");', 'return;'], ['throw Error("cc3_prepare_connection_unavailable");', 'return {};'],
    ['throw Error("cc2c_startup_producer_unavailable");', 'return null; throw Error("cc2c_startup_producer_unavailable");'],
    ['runUnsignedCohortWorker();\n', ''], ['s.pair.every(p => p.closed)', 's.pair.some(p => p.closed)'],
    ['!r.returnSeen || !r.callbackSeen', '!r.callbackSeen']]) {
    assert.equal(source.split(from).length, 2, from); const changed = source.replace(from, to); assert.equal(parse(changed).parseDiagnostics.length, 0);
    assert.throws(() => boundary(changed), { code: "ERR_ASSERTION" }, from);
  }
  for (const extra of ['\nexport function run() {}', '\nprocess.exit(1);', '\nimport fs from "node:fs";']) assert.throws(() => boundary(source + extra));
  const imports = source.split("\n").filter(line => line.includes(" = await import(")); assert.equal(imports.length, 4);
  for (const line of imports) {
    const changed = source.replace(line, line.replace(' checkpointOriginalWorker(s);', ''));
    assert.notEqual(changed, source); assert.equal(parse(changed).parseDiagnostics.length, 0);
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
