import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const source = read("../helpers/unsignedWorkerTransportContracts.mjs");
const exports = ["describeUnsignedWorkerTransportCapacity", "createUnsignedWorkerTransportModel", "createUnsignedWorkerLifetimeModel"];
const forbidden = new Set(["process", "globalThis", "global", "Date", "performance", "Intl", "Temporal", "require", "createRequire", "eval", "Function", "Proxy", "Reflect",
  "Worker", "MessageChannel", "MessagePort", "postMessage", "SharedArrayBuffer", "Atomics", "WebAssembly", "fetch", "WebSocket", "AbortSignal",
  "createPrivateKey", "createPublicKey", "sign", "verify", "spawn", "spawnSync", "exec", "fork", "dlopen", "openSync", "readFileSync", "writeFileSync",
  "mkdir", "unlink", "rename", "setTimeout", "setInterval", "setImmediate", "queueMicrotask"]);
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
    if (ts.isStringLiteralLike(n) && n.text === "constructor") assert.equal(ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent), false);
    ts.forEachChild(n, walk);
  }
  walk(tree);
}
test("B4-A exports only pure models/capacity with exact reviewed dependencies", () => guard(source));
test("B4-A source boundary rejects clocks/ports/keys/processes and alternate effect paths", () => {
  for (const change of ['\nDate.now();', '\nnew MessageChannel();', '\nnew Worker();', '\nprocess.hrtime.bigint();', '\nimport("node:fs");',
    '\nsetTimeout(f,1);', '\ncreatePrivateKey(k);', '\nspawn("worker");', '\nx["constructor"]("return 1")();', '\nexport { hidden };',
    '\nReflect.get(x,k);', '\nObject.getOwnPropertyDescriptor(Object.getPrototypeOf(f),"constructor").value("return 1")();']) assert.throws(() => guard(source + change));
});
test("B4-A has no runtime/production/MCP/build/worker connection or authority issuer", () => {
  for (const f of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(f => f.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${f}`), /unsignedWorkerTransportContracts/);
  for (const f of ["../../package.json", "../../native/native_bar_fs/build_unsigned.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs",
    "../helpers/unsignedInertAdapters.mjs", "../helpers/unsignedCohortRuntime.mjs"]) assert.doesNotMatch(read(f), /unsignedWorkerTransportContracts/);
  assert.doesNotMatch(source, /preparedRuns|buildReferences|namespaceReferences|originalCohortTiming|createUnsignedQualificationModel/);
});
test("B4-A memory tests install real clock/timer/port/key/IO tripwires before imports", () => {
  const s = read("./nativeBarAdmissionUnsignedWorkerTransport.test.mjs");
  for (const fragment of ['block(workers, ["Worker", "MessageChannel"])', '"EventSource", "MessageChannel", "setTimeout"',
    'block(process.hrtime, ["bigint"])', 'block(Date, ["now"])', 'block(performance, ["now"])', 'block(crypto, ["sign", "verify"',
    'block(fsp, [...mutations, ...scans])', 'assert.deepEqual(effects, [])', 'block(process, ["dlopen", "kill"',
    'block(net.Socket.prototype, ["connect"])']) assert.ok(s.includes(fragment), fragment);
  assert.ok(s.indexOf("syncBuiltinESMExports();") < s.indexOf('await import("../helpers/unsignedWorkerTransportContracts'));
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
    const value = { z: sample.slice(start), a: [null, true, false, -0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] };
    assert.equal(encode(value), canonical(value) + "\n");
  }
  const overhead = Buffer.byteLength(canonical({ text: "" }) + "\n"), exact = { text: "x".repeat(65536 - overhead) };
  assert.equal(Buffer.byteLength(encode(exact)), 65536); serializations = 0;
  assert.throws(() => encode({ text: exact.text + "x" }), /frame_bound/); assert.equal(serializations, 0);
  for (const value of [Array(4).fill("\0".repeat(262144)), Array(8).fill("\ud800".repeat(10000))]) {
    assert.throws(() => encode(value), /frame_bound/); assert.equal(serializations, 0);
  }
});
