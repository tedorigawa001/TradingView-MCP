import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const model = read("../helpers/jointUnsignedAcceptanceContracts.mjs"), harness = read("../helpers/jointUnsignedHarness.mjs");
const ast = (s) => ts.createSourceFile("input.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const walk = (n, f) => { f(n); ts.forEachChild(n, (c) => walk(c, f)); };
const imports = (s) => ast(s).statements.filter(ts.isImportDeclaration).map((n) => [n.moduleSpecifier.text,
  n.importClause?.name?.text, n.importClause?.namedBindings?.elements?.map((e) => [e.propertyName?.text, e.name.text])]);
const exports = (s) => ast(s).statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((n) => n.name?.text);
function pureGuard(s) {
  assert.deepEqual(imports(s), [["node:crypto", undefined, [[undefined, "createHash"]]], ["zod", undefined, [[undefined, "z"]]]]);
  assert.deepEqual(exports(s), ["describeUnsignedAcceptanceRun", "describeUnsignedFixture", "createUnsignedOwnershipModel", "assessUnsignedNegativeModel", "describeUnsignedHarnessArguments"]);
  const banned = new Set(["process", "globalThis", "global", "Date", "performance", "hrtime", "require", "createRequire", "dlopen", "eval", "Function", "fetch",
    "createPrivateKey", "createPublicKey", "sign", "spawn", "Worker", "writeFileSync", "mkdirSync", "unlinkSync", "rmdirSync", "rmSync", "openSync", "readFileSync", "setTimeout"]);
  walk(ast(s), (n) => {
    if (ts.isIdentifier(n)) assert.equal(banned.has(n.text), false, n.text);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
  });
}
function sealedHarness(s) {
  const tree = ast(s), execute = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "executeUnsignedHarness");
  assert.deepEqual(imports(s), [["./jointUnsignedAcceptanceContracts.mjs", undefined,
    [[undefined, "describeUnsignedAcceptanceRun"], [undefined, "describeUnsignedHarnessArguments"]]]]);
  assert.deepEqual(exports(s), ["inspectUnsignedHarness", "executeUnsignedHarness"]);
  assert.equal(execute.body.statements.length, 1);
  assert.equal(execute.body.statements[0].getText(), 'throw Error("cc1a_execution_not_approved");');
  const dynamic = [], connections = [];
  function visit(n, inside = false) {
    inside ||= ts.isFunctionDeclaration(n) && n.name?.text === "connectOriginalUnsignedCase";
    if (ts.isIdentifier(n) && n.text === "connectOriginalUnsignedCase") connections.push(n);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) { assert.ok(inside); dynamic.push(n.arguments[0].getText()); }
    if (ts.isIdentifier(n)) assert.equal(new Set(["require", "createRequire", "dlopen", "createPrivateKey", "sign", "writeFileSync", "openSync", "rmSync", "spawn"]).has(n.text), false, n.text);
    ts.forEachChild(n, (child) => visit(child, inside));
  }
  visit(tree);
  assert.equal(connections.length, 1); // Only the private declaration, not a caller or exported alias.
  assert.deepEqual(dynamic, ['new URL(`${base}nativeBarAdmissionJointReader.js`, import.meta.url)', '"node:crypto"',
    '"./fixedMemoryCheckpointOracle.mjs"', '"./unsignedCheckpointOracle.mjs"']);
  assert.ok(s.includes('"../../build/b3cc-validation/normal/" : "../../build/b3cc-validation/ubsan/"'));
}
test("C-C1a's model is pure and the deferred native connection has no exported caller", () => { pureGuard(model); sealedHarness(harness); });
test("C-C1a guards catch unlocked execution, extra dependencies and a native connection alias", () => {
  for (const change of [model + "\nprocess.cwd();", model + "\nimport('./native.js');", model + "\nwriteFileSync(p,b);", model.replace('"node:crypto"', '"node:fs"')])
    assert.throws(() => pureGuard(change));
  for (const change of [harness.replace('throw Error("cc1a_execution_not_approved");', "return connectOriginalUnsignedCase();"),
    harness + "\nconst exposed = connectOriginalUnsignedCase;", harness + "\nimport('./native.js');"])
    assert.throws(() => sealedHarness(change));
});
function routeSource(name) {
  const tree = ast(read(`../helpers/${name}`)), selected = [];
  for (const n of tree.statements) {
    if (ts.isImportDeclaration(n)) continue;
    if (ts.isVariableStatement(n) && n.declarationList.declarations.every((d) => ts.isIdentifier(d.name) && ["cc1Mode", "base"].includes(d.name.text))) selected.push(n.getText());
    else if (ts.isIfStatement(n) && selected.length === 1) selected.push(n.getText());
    else break;
  }
  assert.equal(selected.length, 3);
  return `${selected.join("\n")}\nbase;`;
}
test("C-C1a oracle routing has no common fallback for invalid/mixed modes; no oracle/key/reader executes", () => {
  for (const name of ["fixedMemoryCheckpointOracle.mjs", "unsignedCheckpointOracle.mjs"]) {
    // Only the three pure environment/path statements are evaluated, never a helper import, key call or fake backend.
    const code = routeSource(name), route = (env) => vm.runInNewContext(code, { process: { env } });
    assert.equal(route({}), "../../build/");
    for (const mode of ["normal", "ubsan"]) assert.equal(route({ NATIVE_BAR_B3CC_MODE: mode }), `../../build/b3cc-validation/${mode}/`);
    for (const mode of ["", "../common", "NORMAL", "1"]) assert.throws(() => route({ NATIVE_BAR_B3CC_MODE: mode }), /b3cc_test_mode_refused/);
    for (const flag of ["NATIVE_BAR_B2B_ISOLATED_TEST", "NATIVE_BAR_B3BA_ISOLATED_TEST", "NATIVE_BAR_B3BB_ISOLATED_TEST", "NATIVE_BAR_B3BC_ISOLATED_TEST", "NATIVE_BAR_B3CA_ISOLATED_TEST"])
      assert.throws(() => route({ NATIVE_BAR_B3CC_MODE: "normal", [flag]: "1" }), /b3cc_test_mode_refused/);
    assert.equal(route({ NATIVE_BAR_B3BC_ISOLATED_TEST: "1" }), "../../build/b3bc-validation/");
    assert.equal(route({ NATIVE_BAR_B3BB_ISOLATED_TEST: "1" }), "../../build/b3bb-validation/");
  }
});
test("C-C1a is disconnected from application/MCP/scripts and contains no filesystem executor", () => {
  for (const f of readdirSync(new URL("../../src/", import.meta.url)).filter((s) => s.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${f}`), /jointUnsigned|test_joint_admission|NATIVE_BAR_B3CC_MODE/, f);
  assert.doesNotMatch(JSON.stringify(JSON.parse(read("../../package.json")).scripts), /jointUnsigned|test_joint_admission|b3cc-validation/);
  const entry = read("../../native/native_bar_fs/test_joint_admission.mjs");
  assert.deepEqual(exports(entry), ["inspectJointAdmissionArguments"]);
  assert.doesNotMatch(entry, /executeUnsignedHarness|connectOriginalUnsignedCase|\.node|spawn|mkdir|unlink|createPrivateKey/);
  assert.doesNotMatch(model + harness, /\b(?:unlinkSync|rmdirSync|writeFileSync|mkdtempSync|spawnSync)\s*\(/);
  const tests = read("./nativeBarAdmissionUnsignedAcceptance.test.mjs");
  assert.match(tests, /process\.dlopen =/); assert.match(tests, /assert\.deepEqual\(effects, \[\]\)/);
});
function failureFormatter() {
  let initializer;
  walk(ast(harness), (n) => { if (ts.isVariableDeclaration(n) && n.name.getText() === "code") initializer = n.initializer.getText(); });
  assert.ok(initializer);
  // Only the pure error-code expression is evaluated, never the private connection, reader, owner or signer.
  return vm.runInNewContext(`(${initializer})`, { Error });
}
test("C-C1a preserves known pre-begin contract failures as the primary code", () => {
  const code = failureFormatter();
  for (const value of ["b2a_public_key_refused", "b2b_release_unconfirmed", "b3ca_invalid_registration", "b3ba_oracle_unavailable",
    "b3bb_public_test_key_required", "b3cb_native_refused", "cc1a_mode_binding"])
    assert.equal(code(new Error(value)), value);
});
test("C-C1a's primary-code formatter redacts unknown or oversized failures", () => {
  const code = failureFormatter();
  for (const value of [new Error("private/path/should/not/appear"), new Error(`b3cb_${"a".repeat(1000)}`), new Error("unknown_code"), {}])
    assert.equal(code(value), "cc1a_unexpected_error");
});
