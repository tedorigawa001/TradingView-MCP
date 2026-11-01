import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createUnsignedIsolatedTypeScript } from "../helpers/unsignedIsolatedTypeScript.mjs";

const read = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ts = createUnsignedIsolatedTypeScript(read("../../node_modules/typescript/lib/typescript.js"));
const source = read("../helpers/unsignedWorkerStartupContracts.mjs"), wire = read("../helpers/unsignedControllerWireContracts.mjs");
const ast = s => ts.createSourceFile("memory.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function pure(input, shared = false) {
  const s = input.replace(/\r\n/g, "\n"), tree = ast(s); assert.equal(tree.parseDiagnostics.length, 0);
  assert.deepEqual(Array.from(tree.statements.filter(n => n.importClause), n => n.moduleSpecifier.text), shared ? ["zod", "./unsignedControllerData.mjs"]
    : ["zod", "./unsignedControllerData.mjs", "./unsignedControllerWireContracts.mjs", "./jointUnsignedAcceptanceContracts.mjs", "./unsignedCohortQualificationContracts.mjs"]);
  const exports = Array.from(tree.statements.filter(n => /^export\s/.test(n.getText()))).flatMap(n => n.name ? [n.name.text] : Array.from(n.declarationList.declarations, d => d.name.text));
  assert.deepEqual(exports, shared ? ["artifactSchema", "setupSchema", "readySchema", "failureSchema", "readUnsignedControllerFrame", "validateUnsignedWireBinding"]
    : ["planUnsignedWorkerStartup", "validateUnsignedWorkerStartupEnvelope", "describeUnsignedWorkerStartupCapacity"]);
  const denied = new Set(["process", "globalThis", "global", "Date", "performance", "Temporal", "Intl", "require", "createRequire", "Worker", "MessageChannel", "BroadcastChannel",
    "WeakRef", "FinalizationRegistry", "setTimeout", "clearTimeout", "setInterval", "setImmediate", "queueMicrotask", "fetch", "eval", "Function", "createPrivateKey", "createPublicKey", "sign", "verify", "spawn", "readFileSync", "writeFileSync"]);
  const visit = n => {
    if (ts.isIdentifier(n)) assert.equal(denied.has(n.text), false, n.text);
    if (ts.isCallExpression(n)) {
      assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword);
      assert.ok(!/^(?:Reflect\.|Object\.(?:defineProperty|setPrototypeOf))/.test(n.expression.getText()));
    }
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.ok(!denied.has(n.argumentExpression.text) && n.argumentExpression.text !== "constructor");
    if (ts.isStringLiteralLike(n) && n.text === "constructor") assert.ok(!ts.isCallExpression(n.parent) && !ts.isNewExpression(n.parent));
    if (n.kind === ts.SyntaxKind.PropertyAssignment && ["runtime_completion_proven", "record_reader_available", "parent_wrapper_calculated", "native_budget_changed"].includes(n.name?.text))
      assert.equal(n.initializer.getText(), "false");
    if (n.kind === ts.SyntaxKind.PropertyAssignment && n.name?.text === "runtime_producers") assert.equal(n.initializer.getText(), '"unavailable"');
    ts.forEachChild(n, visit);
  }; visit(tree);
  if (shared) {
    assert.ok(s.indexOf('!raw.isWellFormed()') < s.indexOf('decode(raw,'));
    for (const pin of ['binding: z.unknown()', 'setup: setupSchema.nullable()', 'return freeze(parse(bindingSchema, input));']) assert.ok(s.includes(pin));
  } else {
    for (const pin of ['scope: "unsigned_worker_startup_memory_only", runtime_completion_proven: false',
      'runtime_producers: "unavailable"', 'record_reader_available: false', 'parent_wrapper_calculated: false',
      'template_preimage: "deferred_to_c3"', 'expected.frames_spent >= LIMITS.frames', 'hashBytes > BigInt(profile.hash_work_bytes)',
      'helpers > profile.helper_commands', 'metadata > 16384', 'sum(retained) > 2375680', 'sum(transient) > 4259840',
      'error.startup_work = freeze({ charged_hash_bytes: String(wireCharge), refunded: false })', 'const d = subject(input), p = plan(d)',
      'configurationBytes > LIMITS.configuration_bytes', 'h.callback !== "completed" || h.write_return === null']) assert.ok(s.includes(pin), pin);
    assert.ok(s.indexOf('if (BigInt(d.reserved_hash_bytes)') < s.indexOf('f = readUnsignedControllerFrame(d.line)'));
    assert.ok(s.indexOf('  work(d);') >= 0 && s.indexOf('  work(d);') < s.indexOf('digest(b) !== d.expected.binding_sha256'));
    assert.doesNotMatch(s, /createUnsignedControllerProtocolModel|createUnsignedWorkerPreparationModel|validateUnsignedWorkerConfiguration|JSON\.parse|input\.binding/);
  }
}
test("C2a exact pure exports/dependencies and seals under LF/CRLF", () => {
  for (const text of [source, source.replace(/\r?\n/g, "\r\n")]) pure(text);
  for (const text of [wire, wire.replace(/\r?\n/g, "\r\n")]) pure(text, true);
});
test("C2a boundary mutations reject effects, widened authority and missing capacity checks", () => {
  for (const mutation of ['\nprocess.hrtime.bigint();', '\nnew Date();', '\nimport("node:fs");', '\nnew MessageChannel();', '\nx["constructor"]("return 1")();',
    '\nObject.getOwnPropertyDescriptor(Object.getPrototypeOf(f), "constructor").value("return 1")();', '\nexport function run() {}']) assert.throws(() => pure(source + mutation), undefined, mutation);
  for (const [from, to] of [['runtime_producers: "unavailable"', 'runtime_producers: "ready"'], ['record_reader_available: false', 'record_reader_available: true'],
    ['parent_wrapper_calculated: false', 'parent_wrapper_calculated: true'], ['metadata > 16384', 'false'], ['sum(retained) > 2375680', 'false'],
    ['sum(transient) > 4259840', 'false'], ['expected.frames_spent >= LIMITS.frames', 'false'], ['helpers > profile.helper_commands', 'false']]) {
    assert.ok(source.split(from).length >= 2); assert.throws(() => pure(source.replace(from, to)), undefined, from);
  }
});
function harnessGuard(input) {
  const s = input.replace(/\r\n/g, "\n"), first = s.indexOf('await import("../helpers/');
  for (const pin of ['block(child, ["spawn"', 'block(workers, ["Worker", "MessageChannel"', 'block(crypto, ["sign", "verify"',
    'block(crypto.webcrypto.subtle, ["sign"', 'block(fsp, [...mutations, ...scans])', 'block(listenerPrototype, ["listen"])',
    'block(datagramPrototype, ["bind"])', '[globalThis, "Date", ["now"]]', '[process, "hrtime", ["bigint"]]',
    'block(timerPromises, ["setTimeout"', 'block(process, ["dlopen"',
    'block(net, ["connect", "createConnection", "createServer", "Server"])', 'block(dgram, ["createSocket", "Socket"])'])
    assert.ok(s.indexOf(pin) >= 0 && s.indexOf(pin) < first, pin);
  for (const pin of ['[net, "Server"]', '[dgram, "Socket"]', 'for (const [o, k] of requiredSinks) assert.ok(blocked.some(([target, name]) => target === o && name === k)'])
    assert.ok(s.includes(pin), pin);
  assert.ok(s.indexOf('for (const [o, k] of requiredSinks)') < s.indexOf('for (const [o, k] of blocked)'));
  assert.ok(s.indexOf('syncBuiltinESMExports();') < first);
  assert.doesNotMatch(s, /from ["']typescript["']|\.skip\(|\.todo\(/);
  assert.equal(s.lastIndexOf('\ntest("C2a no denied effect was swallowed"'), s.lastIndexOf('\ntest('));
}
test("C2a memory tripwires precede imports and forbid direct listener and clock paths", () => {
  const s = read("./nativeBarAdmissionUnsignedWorkerStartup.test.mjs"); harnessGuard(s); harnessGuard(s.replace(/\r?\n/g, "\r\n"));
});
test("C2a independent constructor inventory detects guard or inventory removal without probing a real sink", () => {
  const s = read("./nativeBarAdmissionUnsignedWorkerStartup.test.mjs").replace(/\r\n/g, "\n"); harnessGuard(s);
  for (const [from, to] of [['block(net, ["connect", "createConnection", "createServer", "Server"])', 'block(net, ["connect", "createConnection", "createServer"])'],
    ['block(dgram, ["createSocket", "Socket"])', 'block(dgram, ["createSocket"])'], ['[net, "Server"], ', ''], ['[dgram, "Socket"], ', '']]) {
    assert.equal(s.split(from).length, 2, from); const changed = s.replace(from, to); assert.equal(ast(changed).parseDiagnostics.length, 0);
    assert.throws(() => harnessGuard(changed), { code: "ERR_ASSERTION" }, from);
  }
});
test("C2a has no worker/product/operational registration or effectful dependency", () => {
  for (const f of ["../helpers/unsignedCohortRuntime.mjs", "../helpers/unsignedInertAdapters.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs", "../../package.json"])
    assert.doesNotMatch(read(f), /unsignedWorkerStartup|UnsignedWorkerStartup|unsignedControllerWire/);
  for (const f of fs.readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(n => n.endsWith(".ts")))
    assert.doesNotMatch(read("../../src/" + f), /unsignedWorkerStartup|UnsignedWorkerStartup|unsignedControllerWire/);
  assert.equal(fs.existsSync(new URL("../../native/native_bar_fs/test_unsigned_cohort_worker.mjs", import.meta.url)), false);
});
