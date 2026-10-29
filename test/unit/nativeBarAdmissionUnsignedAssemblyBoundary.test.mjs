import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const ast = (s) => ts.createSourceFile("assembly.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const specs = {
  Model: { path: "unsignedCohortAssemblyModel", exports: ["createUnsignedCohortAssemblyModel"], imports: [
    "zod:z", "./jointUnsignedAcceptanceContracts.mjs:describeUnsignedAcceptanceRun,describeUnsignedFixture",
    "./unsignedControllerContracts.mjs:createUnsignedControllerProtocolModel,createUnsignedControllerWindowModel",
    "./unsignedControllerEvidence.mjs:createUnsignedControllerEvidenceModel,createUnsignedControllerCohortModel,describeUnsignedControllerSerializationCapacity",
    "./unsignedControllerData.mjs:uint,label,code,parse,canonical,digest,sha,byteLength,freeze,flags,LIMITS"] },
  Runtime: { path: "unsignedCohortRuntime", exports: ["inspectUnsignedCohortAssembly", "executeUnsignedCohortAssembly"], imports: ["./unsignedControllerData.mjs:flags,freeze"] },
};
const forbidden = new Set(["process", "globalThis", "global", "Date", "performance", "Intl", "SharedArrayBuffer", "Atomics", "WebAssembly", "require", "createRequire",
  "eval", "Function", "Proxy", "Reflect", "fetch", "Worker", "createPrivateKey", "createPublicKey", "sign", "spawn", "exec", "fork", "dlopen",
  "openSync", "readFileSync", "writeFileSync", "mkdir", "unlink", "rename", "setTimeout", "setImmediate", "setInterval", "queueMicrotask", "AbortSignal", "WebSocket", "EventSource"]);
function guard(source, spec) {
  const tree = ast(source); assert.equal(tree.parseDiagnostics.length, 0);
  const imports = tree.statements.filter(ts.isImportDeclaration).map((n) => {
    assert.equal(n.importClause?.name, undefined); assert.ok(ts.isNamedImports(n.importClause?.namedBindings));
    return n.moduleSpecifier.text + ":" + n.importClause.namedBindings.elements.map((e) => e.name.text).join(",");
  });
  assert.deepEqual(imports, spec.imports);
  assert.deepEqual(tree.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((n) => n.name?.text), spec.exports);
  function visit(n) {
    if (spec === specs.Runtime && ts.isFunctionDeclaration(n) && n.name?.text === "prepareOriginalQualification") {
      assert.equal(n.parameters.length, 0); assert.equal(n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false, false);
      return; // The 4-B3-B boundary test validates this private, unreachable connection body.
    }
    if (ts.isIdentifier(n)) assert.equal(forbidden.has(n.text), false, n.text);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.notEqual(n.argumentExpression.text, "constructor");
    if (ts.isStringLiteralLike(n) && n.text === "constructor") assert.equal(ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent), false);
    ts.forEachChild(n, visit);
  }
  visit(tree);
  if (spec === specs.Runtime) {
    const execute = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name.text === "executeUnsignedCohortAssembly");
    assert.equal(execute.body.statements.length, 1); assert.equal(execute.parameters.length, 0);
    assert.equal(execute.body.statements[0].getText(), 'throw Error("cc4b2_execution_not_approved");');
  }
}
for (const [name, spec] of Object.entries(specs)) {
  const source = read(`../helpers/${spec.path}.mjs`);
  test(`4-B2 ${name} has fixed pure imports and no effect or authority entry`, () => guard(source, spec));
  test(`4-B2 ${name} guard detects effect imports, exports, clocks, keys and reflection`, () => {
    for (const mutation of ['\nimport("node:fs");', '\nprocess.cwd();', '\nnew Date();', '\nspawn("child");', '\ncreatePrivateKey(k);',
      '\nwriteFileSync(p, x);', '\nx["constructor"]("return 1")();', '\nsetTimeout(f, 1);', '\nqueueMicrotask(f);',
      '\nexport { hidden };', '\nexport default hidden;', '\nReflect.get(x, k);',
      '\nObject.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor").value("return 1")();']) assert.throws(() => guard(source + mutation, spec));
  });
}
test("4-B2 runtime cannot be opened by a pre-throw operation or option", () => {
  const s = read("../helpers/unsignedCohortRuntime.mjs");
  for (const mutation of [s.replace('throw Error("cc4b2_execution_not_approved");', 'return true;'),
    s.replace("executeUnsignedCohortAssembly()", "executeUnsignedCohortAssembly(options)"),
    s.replace('throw Error("cc4b2_execution_not_approved");', 'run(); throw Error("cc4b2_execution_not_approved");')]) assert.throws(() => guard(mutation, specs.Runtime));
});
test("4-B2 remains absent from production, scripts, builders and existing sealed entries", () => {
  for (const p of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter((p) => p.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${p}`), /unsignedCohort(?:AssemblyModel|Runtime)/, p);
  for (const p of ["../../package.json", "../../native/native_bar_fs/build_unsigned.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs", "../helpers/unsignedInertAdapters.mjs"])
    assert.doesNotMatch(read(p), /unsignedCohort(?:AssemblyModel|Runtime)/, p);
  assert.match(read("../helpers/unsignedInertAdapters.mjs"), /export async function executeUnsignedAdapters\(\) \{ throw Error\("cc1b2_execution_not_approved"\); \}/);
});
test("4-B2 memory test loads every dependency before registering tests and has no build route", () => {
  const s = read("./nativeBarAdmissionUnsignedAssembly.test.mjs"), tree = ast(s);
  const firstTest = s.indexOf('test("4-B2 runtime');
  for (const statement of tree.statements) if (statement.getText().includes("await import(")) assert.ok(statement.getStart() < firstTest);
  assert.doesNotMatch(s, /process\.env\s*[.[]|build\/b3|npm run|fixedMemoryCheckpointOracle/);
  assert.ok(s.indexOf("syncBuiltinESMExports();") < s.indexOf('await import("../helpers/unsignedCohort'));
});
