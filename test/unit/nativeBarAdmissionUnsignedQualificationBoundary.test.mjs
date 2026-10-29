import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../helpers/unsignedCohortQualificationContracts.mjs");
const ast = (s) => ts.createSourceFile("qualification.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const forbidden = new Set(["process", "globalThis", "global", "Date", "performance", "Intl", "SharedArrayBuffer", "Atomics", "WebAssembly", "require", "createRequire",
  "eval", "Function", "Proxy", "Reflect", "fetch", "Worker", "createPrivateKey", "createPublicKey", "sign", "spawn", "exec", "fork", "dlopen",
  "openSync", "readFileSync", "writeFileSync", "mkdir", "unlink", "rename", "setTimeout", "setImmediate", "setInterval", "queueMicrotask", "AbortSignal", "WebSocket", "EventSource"]);
function guard(s) {
  const tree = ast(s); assert.equal(tree.parseDiagnostics.length, 0);
  const imports = tree.statements.filter(ts.isImportDeclaration).map((n) => {
    assert.equal(n.importClause?.name, undefined); assert.ok(ts.isNamedImports(n.importClause?.namedBindings));
    return n.moduleSpecifier.text + ":" + n.importClause.namedBindings.elements.map((e) => e.name.text).join(",");
  });
  assert.deepEqual(imports, ["zod:z", "./unsignedControllerData.mjs:uint,label,digestSchema,parse,canonical,digest,byteLength,freeze,flags,LIMITS"]);
  assert.deepEqual(tree.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((n) => n.name?.text),
    ["describeUnsignedQualificationProfile", "describeUnsignedQualificationCapacity", "createUnsignedQualificationModel"]);
  function visit(n) {
    if (ts.isIdentifier(n)) assert.equal(forbidden.has(n.text), false, n.text);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.notEqual(n.argumentExpression.text, "constructor");
    if (ts.isStringLiteralLike(n) && n.text === "constructor") assert.equal(ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent), false);
    ts.forEachChild(n, visit);
  }
  visit(tree);
}
test("4-B3-A has only three pure exports and fixed reviewed imports", () => guard(source));
test("4-B3-A source guard refuses effects, real clocks, authority exports and reflection", () => {
  for (const suffix of ['\nimport("node:fs");', '\nprocess.cwd();', '\nnew Date();', '\nspawn("child");', '\ncreatePrivateKey(k);',
    '\nwriteFileSync(p, x);', '\nx["constructor"]("return 1")();', '\nsetTimeout(f, 1);', '\nqueueMicrotask(f);',
    '\nexport { hidden };', '\nexport default hidden;', '\nReflect.get(x, k);',
    '\nObject.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor").value("return 1")();',
    '\nimport { open } from "node:fs";']) assert.throws(() => guard(source + suffix));
});
test("4-B3-A cannot be wired into production, builders, workers or sealed runtime", () => {
  for (const path of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter((p) => p.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${path}`), /unsignedCohortQualificationContracts/, path);
  for (const path of ["../../package.json", "../../native/native_bar_fs/build_unsigned.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs",
    "../helpers/unsignedInertAdapters.mjs", "../helpers/unsignedCohortRuntime.mjs"])
    assert.doesNotMatch(read(path), /unsignedCohortQualificationContracts/, path);
  const runtime = ast(read("../helpers/unsignedCohortRuntime.mjs"));
  const entry = runtime.statements.find((n) => ts.isFunctionDeclaration(n) && n.name.text === "executeUnsignedCohortAssembly");
  assert.equal(entry.parameters.length, 0); assert.equal(entry.body.statements.length, 1);
  assert.equal(entry.body.statements[0].getText(), 'throw Error("cc4b2_execution_not_approved");');
});
test("4-B3-A memory tests install guards before pure imports with no build or signature route", () => {
  const s = read("./nativeBarAdmissionUnsignedQualification.test.mjs"), tree = ast(s), firstTest = s.indexOf('test("4-B3-A profile');
  for (const statement of tree.statements) if (statement.getText().includes("await import(")) assert.ok(statement.getStart() < firstTest);
  assert.doesNotMatch(s, /process\.env\s*[.[]|fixedMemoryCheckpointOracle|npm run/);
  assert.ok(s.indexOf("syncBuiltinESMExports();") < s.indexOf('await import("../helpers/unsignedCohortQualification'));
  assert.match(s, /block\(Date, \["now"\]\)/); assert.match(s, /block\(process\.hrtime, \["bigint"\]\)/);
});
