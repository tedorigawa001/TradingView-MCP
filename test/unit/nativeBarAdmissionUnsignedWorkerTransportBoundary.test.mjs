import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const source = read("../helpers/unsignedWorkerTransportContracts.mjs");
const exports = ["describeUnsignedWorkerTransportCapacity", "createUnsignedWorkerTransportModel", "createUnsignedWorkerLifetimeModel"];
const forbidden = new Set(["process", "globalThis", "global", "Date", "performance", "Intl", "Temporal", "require", "createRequire", "eval", "Function", "Proxy", "Reflect",
  "Worker", "MessageChannel", "MessagePort", "BroadcastChannel", "postMessage", "SharedArrayBuffer", "Atomics", "WebAssembly", "fetch", "WebSocket", "AbortSignal",
  "crypto", "createPrivateKey", "createPublicKey", "sign", "verify", "spawn", "spawnSync", "exec", "fork", "dlopen", "openSync", "readFileSync", "writeFileSync",
  "mkdir", "unlink", "rename", "setTimeout", "setInterval", "setImmediate", "queueMicrotask",
  "getPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "FinalizationRegistry", "WeakRef"]);
function guard(text) {
  const tree = ts.createSourceFile("transport.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  assert.deepEqual(tree.statements.filter(ts.isImportDeclaration).map(n => n.moduleSpecifier.text + ":" + n.importClause.namedBindings.elements.map(e => e.name.text).join(",")), [
    "zod:z", "./unsignedControllerContracts.mjs:createUnsignedControllerProtocolModel,createUnsignedControllerWindowModel",
    "./unsignedControllerEvidence.mjs:describeUnsignedControllerSerializationCapacity",
    "./unsignedControllerData.mjs:uint,label,code,parse,canonical,sha,byteLength,decode,freeze,flags,LIMITS"]);
  assert.deepEqual(tree.statements.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)).map(n => n.name?.text), exports);
  function walk(n) {
    if (ts.isIdentifier(n)) assert.equal(forbidden.has(n.text), false, n.text);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.equal(forbidden.has(n.argumentExpression.text) || n.argumentExpression.text === "constructor", false);
    // Computed keys stay names, property reads or numbers, so no assembled string can reach a forbidden member.
    if (ts.isElementAccessExpression(n)) assert.ok([ts.isIdentifier, ts.isPropertyAccessExpression, ts.isNumericLiteral].some(is => is(n.argumentExpression)), n.getText());
    if (ts.isStringLiteralLike(n) && n.text === "constructor") assert.equal(ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent), false);
    ts.forEachChild(n, walk);
  }
  walk(tree);
}
test("B4-A exports only pure models/capacity with exact reviewed dependencies", () => guard(source));
function lifetimeGuard(text) {
  const tree = ts.createSourceFile("transport.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "createUnsignedWorkerLifetimeModel");
  const body = declaration.getText();
  const returned = declaration.body.statements.find(ts.isReturnStatement).expression.arguments[0];
  assert.deepEqual(returned.properties.map(n => n.name.text), ["allocate", "noteListeners", "referencePort", "beginWork", "settleWork", "stop", "closePort", "observeClose", "describe"]);
  for (const name of ["closePort", "observeClose"]) assert.match(returned.properties.find(n => n.name.text === name).getText(), /!originalPorts\[q.index\]/);
  for (const fragment of ['schema: "native-bar-worker-lifetime-model-v2"', 'ports.some(p => p !== "unreferenced")',
    'referenceConfirmed.every(Boolean)', 'references: referencesSchema', 'ports = [...q.references]',
    'stop("pair_reference_lost")', 'ports[q.index] = "unreferenced"', 'referenceAttempted[q.index]',
    'closeAttempted = true', 'referencesAtClose = [...ports]', 'closeAttempted && closeEvents.every(Boolean)',
    'closeEvents[q.index] = true', '!originalPorts[q.index]', 'original_ports: [...originalPorts]',
    'stop("unexpected_port_close")', 'ports = ports.map(', '!originalPorts[i] ||', 'if (!closeAttempted) ports[q.index] = "unreferenced"']) assert.ok(body.includes(fragment), fragment);
  assert.doesNotMatch(body, /closeAttempted\s*\[|close_attempted:\s*\[/);
  assert.doesNotMatch(body, /unref\s*\(|postMessage\s*\(|once\s*\(/);
}
test("B4-A lifetime contract pins current-reference checks and one entangled close with two events", () => {
  lifetimeGuard(source);
  for (const [from, to] of [['ports = [...q.references]', 'ports = ports'], ['closeAttempted && closeEvents.every(Boolean)', 'closeAttempted'],
    ['closeAttempted = true', 'closeAttempted = false'], ['referenceConfirmed.every(Boolean)', 'true'],
    ['ports[q.index] = "unreferenced"', 'ports[q.index] = "referenced"'], ['ports = ports.map(', 'ports = [...ports].map('],
    ['!originalPorts[q.index]', 'ports[q.index] === "absent"'],
    ['closeEvents[q.index] || !originalPorts[q.index]', 'closeEvents[q.index] || ports[q.index] === "absent"']]) {
    assert.ok(source.includes(from)); assert.throws(() => lifetimeGuard(source.replace(from, to)));
  }
});
test("B4-A source boundary rejects clocks/ports/keys/processes and alternate effect paths", () => {
  for (const change of ['\nDate.now();', '\nnew MessageChannel();', '\nnew Worker();', '\nprocess.hrtime.bigint();', '\nimport("node:fs");',
    '\nsetTimeout(f,1);', '\ncreatePrivateKey(k);', '\nspawn("worker");', '\nx["constructor"]("return 1")();', '\nexport { hidden };',
    '\nReflect.get(x,k);', '\nObject.getOwnPropertyDescriptor(Object.getPrototypeOf(f),"constructor").value("return 1")();',
    '\nnew BroadcastChannel("x");', '\ncrypto.subtle.generateKey(a,b,c);', '\n(() => 0)["constr" + "uctor"]("return 1")();',
    '\nObject.getOwnPropertyDescriptors(Object.getPrototypeOf(() => 0));', '\nnew FinalizationRegistry(f);', '\nnew WeakRef(o);']) assert.throws(() => guard(source + change));
});
test("B4-A has no runtime/production/MCP/build/worker connection or authority issuer", () => {
  for (const f of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(f => f.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${f}`), /unsignedWorkerTransportContracts/);
  for (const f of ["../../package.json", "../../native/native_bar_fs/build_unsigned.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs",
    "../helpers/unsignedInertAdapters.mjs", "../helpers/unsignedCohortRuntime.mjs"]) assert.doesNotMatch(read(f), /unsignedWorkerTransportContracts/);
  assert.doesNotMatch(source, /preparedRuns|buildReferences|namespaceReferences|originalCohortTiming|createUnsignedQualificationModel/);
});
test("B4-P1 transport requires its original CANCEL callback before starting teardown", () => {
  const tree = ts.createSourceFile("transport.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); let method;
  const find = n => { if (ts.isMethodDeclaration(n) && n.name.text === "noteTeardown") method = n; ts.forEachChild(n, find); }; find(tree);
  const contract = text => {
    const gate = text.indexOf('if (pending?.kind === "CANCEL") refuse("cancel_unsettled");');
    assert.ok(gate > text.indexOf('inspect(q.at)'));
    assert.ok(gate < text.indexOf('window.startTeardown(v.at)'));
  };
  contract(method.getText()); assert.throws(() => contract(method.getText().replace('if (pending?.kind === "CANCEL") refuse("cancel_unsettled");', '')));
});
test("B4-P2 transport routes stopped and pre-admission faults only into the same bounded late ledger", () => {
  const tree = ts.createSourceFile("transport.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), methods = new Map(); let append;
  const find = n => { if (ts.isMethodDeclaration(n)) methods.set(n.name.text, n); if (ts.isFunctionDeclaration(n) && n.name.text === "appendLate") append = n; ts.forEachChild(n, find); }; find(tree);
  const receive = methods.get("receive").getText(), body = append.getText();
  const contract = text => {
    const route = text.indexOf('if (stopped) return appendLate(q.line)'), inspect = text.indexOf('v = inspect(q.at)');
    assert.ok(route >= 0 && inspect >= 0 && route < inspect);
    assert.ok(text.includes('stop(reasonOf(error), clockInvalid ? null : qualifiedAt); return appendLate(q.line)'));
    assert.ok(text.includes('protocol.closeLateCapture({ reason: "normal_rejected" }); throw error;'));
    assert.doesNotMatch(text, /window\.startSettlement\([^)]*last|protocol\.observeLateFrame/);
  };
  contract(receive);
  assert.throws(() => contract(receive.replace('if (stopped) return appendLate(q.line);', '')));
  assert.throws(() => contract(receive.replace('protocol.closeLateCapture({ reason: "normal_rejected" }); throw error;', 'return appendLate(q.line);')));
  const closedAt = body.indexOf('p.late_capture.capture !== "open"'), decodeAt = body.indexOf('decode(line,');
  assert.ok(closedAt >= 0 && decodeAt >= 0 && closedAt < decodeAt);
  assert.doesNotMatch(body, /\.push\(|next\.worker\+\+|frames\+\+/);
  assert.ok(source.includes('late_capture: protocol.describe().late_capture, late_frames: protocol.describe().late_frames'));
  assert.ok(source.includes('byteLength(canonical({ transport, lifetime })) + lateCapacity.retained_json_bytes - 1'));
});
test("B4-A memory tests install real clock/timer/port/key/IO tripwires before imports", () => {
  const s = read("./nativeBarAdmissionUnsignedWorkerTransport.test.mjs");
  for (const fragment of ['block(workers, ["Worker", "MessageChannel", "BroadcastChannel"])', '"EventSource", "MessageChannel", "BroadcastChannel", "setTimeout"',
    'block(process.hrtime, ["bigint"])', 'block(Date, ["now"])', 'block(performance, ["now"])', 'block(crypto, ["sign", "verify"',
    '"Sign", "Verify", "DiffieHellman", "DiffieHellmanGroup", "ECDH"', 'block(AbortSignal, ["timeout"])', 'block(process.report, ["writeReport"])',
    'block(v8, ["writeHeapSnapshot"])', 'block(inspectorPromises, ["open", "Session"])', 'if (sqlite) block(sqlite, ["Database", "DatabaseSync", "backup"])', 'if (specifier === "node:sqlite")',
    'block(fsp, [...mutations, ...scans])', 'assert.deepEqual(effects, [])', 'block(process, ["dlopen", "kill"',
    'block(net.Socket.prototype, ["connect"])']) assert.ok(s.includes(fragment), fragment);
  const helper = s.indexOf('await import("../helpers/unsignedWorkerTransportContracts');
  for (const fragment of ["syncBuiltinESMExports();", "nodeModule.registerHooks({", '[[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]', 'block(process, ["uptime", "cpuUsage", "resourceUsage"])',
    'block(performance, ["now"])', "block(Temporal.Now,"]) assert.ok(s.indexOf(fragment) > 0 && s.indexOf(fragment) < helper, fragment);
  // The swallowed-effect check must be the file's last test, not only an after hook.
  assert.equal(s.lastIndexOf("\ntest("), s.indexOf('\ntest("B4-A no denied effect was swallowed by an earlier test", () => assert.deepEqual(effects, []));'));
  assert.doesNotMatch(s, /process\.env\s*[.[]|fixedMemoryCheckpointOracle|build\/b3|npm run/);
});
test("B4-A keeps native/v1/operational seals and all original numeric limits", () => {
  assert.match(read("../../native/native_bar_fs/test_unsigned_worker.mjs"), /throw Error\("cc1b2_execution_not_approved"\)/);
  assert.match(read("../helpers/unsignedCohortRuntime.mjs"), /executeUnsignedCohortAssembly\(\) \{ throw Error\("cc4b2_execution_not_approved"\); \}/);
  const s = read("../helpers/unsignedControllerData.mjs");
  for (const fragment of ["frame_bytes: 65536, frames: 32", "configuration_bytes: 60000", "query_ms: 600000", "settlement_ms: 60000",
    "native_work_bytes: 268435456", "receipt_records: 64", "run_index_bytes: 131072"]) assert.ok(s.includes(fragment));
});
test("B4-A encoded-size preflight matches canonical UTF-8 at exact and one-over boundaries", () => {
  const tree = ts.createSourceFile("transport.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "boundedFrame");
  let serializations = 0;
  const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
    ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  const encode = vm.runInNewContext(`"use strict"; ${declaration.getText()}; boundedFrame`, {
    canonical: v => { serializations++; return canonical(v); }, byteLength: s => Buffer.byteLength(s), LIMITS: { frame_bytes: 65536 },
    refuse: reason => { throw Error(reason); } });
  const sample = String.fromCharCode(...Array.from({ length: 256 }, (_, n) => n)) + "\u07ff\u0800\ud7ff\ud800x\udc00\udbff\udfff\ue000\uffff\u2028\u2029";
  for (let start = 0; start < sample.length; start++) {
    const value = { z: sample.slice(start), [sample.slice(start, start + 40)]: 0, a: [null, true, false, -0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] };
    assert.equal(encode(value), canonical(value) + "\n");
  }
  const overhead = Buffer.byteLength(canonical({ text: "" }) + "\n"), exact = { text: "x".repeat(65536 - overhead) };
  assert.equal(Buffer.byteLength(encode(exact)), 65536); serializations = 0;
  assert.throws(() => encode({ text: exact.text + "x" }), /frame_bound/); assert.equal(serializations, 0);
  for (const value of [Array(4).fill("\0".repeat(262144)), Array(8).fill("\ud800".repeat(10000))]) {
    assert.throws(() => encode(value), /frame_bound/); assert.equal(serializations, 0);
  }
});
