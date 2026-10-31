import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ast = (s) => ts.createSourceFile("memory.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const walk = (n, f) => { f(n); ts.forEachChild(n, (child) => walk(child, f)); };
const specifications = {
  Data: { imports: ["node:crypto:createHash", "zod:z"], exports: ["uint", "digestSchema", "label", "code", "count", "canonical", "sha", "digest", "byteLength", "freeze", "refuse", "flags", "copyData", "parse", "decode", "descriptor", "resourcesSchema", "baselineSchema", "traceSchema", "LIMITS"] },
  Observation: { imports: ["zod:z", "./jointUnsignedAcceptanceContracts.mjs:describeUnsignedAcceptanceRun,describeUnsignedFixture",
    "./unsignedWorkerConfiguration.mjs:validateUnsignedWorkerConfiguration",
    "./unsignedControllerData.mjs:uint,digestSchema as hash,code,label,count,parse,canonical,digest,byteLength,freeze,flags,refuse,LIMITS"],
    exports: ["observationSchema", "validateUnsignedControllerObservation", "describeUnsignedControllerLimitations", "assessUnsignedControllerAssertions"] },
  Contracts: { imports: ["zod:z", "./jointUnsignedAcceptanceContracts.mjs:describeUnsignedFixture", "./unsignedWorkerConfiguration.mjs:validateUnsignedWorkerConfiguration",
    "./unsignedControllerObservation.mjs:validateUnsignedControllerObservation",
    "./unsignedControllerData.mjs:uint,label,code,digestSchema as hash,count,parse,copyData,canonical,sha,digest,byteLength,decode,resourcesSchema,baselineSchema,traceSchema,freeze,flags,refuse,LIMITS"],
    exports: ["createUnsignedControllerProtocolModel", "describeUnsignedControllerCapacity", "createUnsignedControllerWindowModel"] },
  Evidence: { imports: ["zod:z", "./jointUnsignedAcceptanceContracts.mjs:describeUnsignedFixture,describeUnsignedAcceptanceRun", "./unsignedControllerContracts.mjs:createUnsignedControllerProtocolModel",
    "./unsignedControllerObservation.mjs:observationSchema,validateUnsignedControllerObservation,assessUnsignedControllerAssertions",
    "./unsignedControllerData.mjs:uint,code,label,digestSchema as hash,count,parse,canonical,digest,sha,byteLength,descriptor,decode,resourcesSchema,baselineSchema,traceSchema,freeze,flags,refuse,LIMITS"],
    exports: ["createUnsignedControllerEvidenceModel", "createUnsignedControllerCohortModel", "inspectUnsignedControllerEvidence", "describeUnsignedControllerSerializationCapacity"] },
};
const forbidden = new Set(["process", "globalThis", "global", "crypto", "Date", "performance", "Intl", "SharedArrayBuffer", "Atomics", "WebAssembly", "require", "createRequire",
  "dlopen", "eval", "Function", "fetch", "Worker", "createPrivateKey", "createPublicKey", "sign", "spawn", "spawnSync", "exec", "execSync", "fork",
  "openSync", "readFileSync", "writeFileSync", "mkdirSync", "mkdtempSync", "unlinkSync", "rmdirSync", "rmSync", "renameSync", "setTimeout", "setImmediate", "setInterval",
  "queueMicrotask", "AbortSignal", "AbortController", "WebSocket", "EventSource", "XMLHttpRequest", "MessageChannel", "BroadcastChannel"]);
function guard(s, expected) {
  const tree = ast(s);
  const imports = tree.statements.filter(ts.isImportDeclaration).map((n) => {
    assert.equal(n.importClause?.name, undefined); assert.ok(ts.isNamedImports(n.importClause?.namedBindings));
    return n.moduleSpecifier.text + ":" + n.importClause.namedBindings.elements.map((e) => e.propertyName ? `${e.propertyName.text} as ${e.name.text}` : e.name.text).join(",");
  });
  assert.deepEqual(imports, expected.imports);
  const exports = tree.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap((n) => ts.isVariableStatement(n) ? n.declarationList.declarations.map((d) => d.name.text) : [n.name?.text]);
  assert.deepEqual(exports, expected.exports);
  walk(tree, (n) => {
    if (ts.isIdentifier(n)) assert.equal(forbidden.has(n.text), false, n.text);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression))
      assert.equal(forbidden.has(n.argumentExpression.text) || n.argumentExpression.text === "constructor", false);
    // Reflection may enumerate keys only; a "constructor" name handed to any call is a Function-constructor route.
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Reflect") assert.equal(n.name.text, "ownKeys");
    if (ts.isStringLiteralLike(n) && n.text === "constructor") assert.equal(ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent), false);
  });
}
for (const [name, spec] of Object.entries(specifications)) {
  const source = read(`../helpers/unsignedController${name}.mjs`);
  test(`4-A ${name} exports only pure contracts with exact dependencies`, () => guard(source, spec));
  test(`4-A ${name} guard catches executable/time/key/filesystem mutations`, () => {
    for (const mutation of ['\nimport("node:fs");', '\nprocess.cwd();', '\nnew Date();', '\nspawn("worker");',
      '\ncreatePrivateKey(k);', '\ncrypto.subtle.sign(a, k, b);', '\nwriteFileSync(p, b);', '\nx["constructor"]("return 1")();',
      '\nexport function execute() {}', '\nsetTimeout(f, 1);', '\nAbortSignal.timeout(1).addEventListener("abort", f);', '\nqueueMicrotask(f);',
      '\nnew WebSocket("ws://127.0.0.1");', '\nReflect.get(f, "constructor")("return 1")();',
      '\nObject.getOwnPropertyDescriptor(Object.getPrototypeOf(f), "constructor").value("return 1")();']) assert.throws(() => guard(source + mutation, spec), Error, mutation);
  });
}
test("4-A cannot be reached from product, MCP, build script or operational entry", () => {
  for (const path of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter((p) => p.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${path}`), /unsignedController(?:Data|Contracts|Observation|Evidence)/, path);
  assert.doesNotMatch(JSON.stringify(JSON.parse(read("../../package.json")).scripts), /unsignedController|UnsignedController/);
  for (const path of ["../../native/native_bar_fs/build_unsigned.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs", "../helpers/unsignedInertAdapters.mjs"])
    assert.doesNotMatch(read(path), /unsignedController(?:Data|Contracts|Observation|Evidence)/);
  const inert = ast(read("../helpers/unsignedInertAdapters.mjs"));
  const execute = inert.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "executeUnsignedAdapters");
  assert.equal(execute.body.statements.length, 1); assert.match(execute.body.statements[0].getText(), /throw Error\("cc1b2_execution_not_approved"\)/);
});
function cancelGuard(source) {
  const tree = ast(source), declarations = new Map(), methods = new Map();
  walk(tree, n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) declarations.set(n.name.text, n);
    if (ts.isMethodDeclaration(n)) methods.set(n.name.text, n);
  });
  const compact = n => n.getText().replace(/\s+/g, "");
  assert.equal(compact(declarations.get("releasedCancel").initializer), 'w.kind==="CANCEL"&&!w.shutdown&&state==="RELEASED"&&released!==null&&writes.every((v)=>v===w||v.outcome==="completed")');
  assert.equal(compact(declarations.get("cancelPending").initializer), '()=>writes.some((w)=>w.kind==="CANCEL"&&w.outcome!=="completed")');
  assert.ok(compact(methods.get("noteWrite")).includes('stopped||close!==null||exit!==null||state!==expectedState&&!releasedCancel||w.outcome!=="planned"||writes.find((v)=>!v.started)!==w'));
  assert.ok(compact(methods.get("finishTeardown")).includes('if(cancelPending())fail("cancel_unsettled");'));
  assert.ok(source.includes('case "FINALIZE": at("RELEASED"); parse(empty, p); if (cancelPending()) fail("cancel_unsettled");'));
}
test("B4-P1 parent-only released-CANCEL exception retains all prior write and cleanup gates", () => {
  const source = read("../helpers/unsignedControllerContracts.mjs"); cancelGuard(source);
  for (const [from, to] of [['!w.shutdown && state === "RELEASED"', 'state === "RELEASED"'],
    ['&& released !== null', ''], ['writes.every((v) => v === w || v.outcome === "completed")', 'true'],
    ['state !== expectedState && !releasedCancel', 'false'], ['w.outcome !== "planned"', 'false'],
    ['if (cancelPending()) fail("cancel_unsettled");', ''],
    ['w.kind === "CANCEL" && w.outcome !== "completed"', 'false']]) {
    assert.ok(source.includes(from), from); assert.throws(() => cancelGuard(source.replace(from, to)));
  }
  const tree = ast(source); let method;
  walk(tree, n => { if (ts.isMethodDeclaration(n) && n.name.text === "finishTeardown") method = n; });
  const changed = method.getText().replace('if (cancelPending()) fail("cancel_unsettled");', '');
  assert.throws(() => cancelGuard(source.slice(0, method.getStart()) + changed + source.slice(method.getEnd())));
  // This model is parent admission, not a worker implementation or a claim of native cancellation/release.
  assert.match(read("../../native/native_bar_fs/test_unsigned_worker.mjs"), /runUnsignedWorker\(\) \{ throw Error\("cc1b2_execution_not_approved"\); \}/);
});
test("4-A memory suite installs effect tripwires before loading the new modules", () => {
  const s = read("./nativeBarAdmissionUnsignedController.test.mjs");
  for (const fragment of ['block(child, ["spawn"', 'block(workers, ["Worker"])', 'block(crypto, ["sign", "verify", "createSign"', 'block(crypto.webcrypto.subtle, ["sign"',
    'block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"])', 'block(inspector, ["open", "Session"])',
    'replace(o, k, function () { effects.push(k);', 'block(net.Socket.prototype, ["connect"])', '"openAsBlob", "watchFile"', 'block(net, ["connect"', 'block(http, ["request"', 'block(globalThis, ["fetch"', '"chown", "fchown", "lchown"',
    'block(fsp, [...mutations, ...scans])', 'const metadata = ["stat", "lstat", "readdir", "opendir", "access", "readlink"]', '[fs, "readFile", (a) => a[0]?.flag]',
    'assert.deepEqual(effects, [])', 'roots.push(...roots.map((s) => fs.realpathSync(s) + sep))']) assert.ok(s.includes(fragment), fragment);
  assert.ok(s.indexOf("syncBuiltinESMExports();") < s.indexOf('await import("../helpers/unsignedController'));
  assert.doesNotMatch(s, /fixedMemoryCheckpointOracle|executeUnsignedAdapters|import\([^)]*build\//);
});
