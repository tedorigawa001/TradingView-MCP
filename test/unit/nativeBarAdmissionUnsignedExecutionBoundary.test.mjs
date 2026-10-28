import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = (s) => readFileSync(new URL(s, import.meta.url), "utf8");
const source = read("../helpers/unsignedExecutionContracts.mjs");
const ast = (s) => ts.createSourceFile("input.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const walk = (n, f) => { f(n); ts.forEachChild(n, (child) => walk(child, f)); };
function guard(s) {
  const tree = ast(s);
  const imports = tree.statements.filter(ts.isImportDeclaration).map((n) => [n.moduleSpecifier.text, n.importClause?.name?.text,
    n.importClause?.namedBindings?.elements?.map((e) => [e.propertyName?.text, e.name.text])]);
  assert.deepEqual(imports, [["node:crypto", undefined, [[undefined, "createHash"]]], ["zod", undefined, [[undefined, "z"]]],
    ["./jointUnsignedAcceptanceContracts.mjs", undefined, [[undefined, "describeUnsignedAcceptanceRun"], [undefined, "describeUnsignedFixture"]]]]);
  const exports = tree.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((n) => n.name?.text);
  assert.deepEqual(exports, ["describeUnsignedExecutionCapacity", "describeUnsignedExecutionWindow", "createUnsignedExecutionProtocolModel",
    "createUnsignedExecutionEvidenceModel", "inspectUnsignedExecutionEvidence"]);
  // Global crypto reaches keys, signing and randomness without an import.
  const banned = new Set(["process", "globalThis", "global", "crypto", "Date", "performance", "Intl", "Event", "EventTarget", "AbortSignal",
    "SharedArrayBuffer", "Atomics", "WebAssembly", "require", "createRequire", "dlopen", "eval", "Function", "fetch", "Worker",
    "createPrivateKey", "createPublicKey", "sign", "spawn", "spawnSync", "exec", "execSync", "fork", "openSync", "readFileSync",
    "writeFileSync", "mkdirSync", "mkdtempSync", "unlinkSync", "rmdirSync", "rmSync", "renameSync", "setTimeout", "setImmediate", "setInterval"]);
  walk(tree, (n) => {
    if (ts.isIdentifier(n)) assert.equal(banned.has(n.text), false, n.text);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression))
      assert.equal(banned.has(n.argumentExpression.text) || n.argumentExpression.text === "constructor", false, n.argumentExpression.text);
  });
}
test("C-C1b-1 exports pure supplied-data contracts only, with exact pure dependencies", () => guard(source));
test("C-C1b-1 boundary guards detect executable imports, native/key/process/time access and exported adapters", () => {
  for (const s of [source + '\nimport("node:fs");', source + "\nprocess.cwd();", source + "\nspawn('worker');", source + "\nnew Date();",
    source + "\ncreatePrivateKey(key);", source + "\nexport function execute() {}", source.replace('"node:crypto"', '"node:fs"'),
    source.replace("{ createHash }", "{ createPrivateKey as createHash }"), source + "\ncrypto.getRandomValues(b);",
    source + "\ncrypto.subtle.importKey(f, k, a, false, []);", source + '\nx["constructor"]("return 1")();', source + '\nx["process"];'])
    assert.throws(() => guard(s));
});
test("C-C1b-1 stays unreachable from runtime/MCP, native entry and package scripts", () => {
  for (const s of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter((s) => s.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${s}`), /unsignedExecutionContracts|createUnsignedExecution|inspectUnsignedExecutionEvidence/, s);
  assert.doesNotMatch(JSON.stringify(JSON.parse(read("../../package.json")).scripts), /unsignedExecutionContracts|nativeBarAdmissionUnsignedExecution/);
  const entry = read("../../native/native_bar_fs/test_joint_admission.mjs"), harness = read("../helpers/jointUnsignedHarness.mjs");
  assert.doesNotMatch(entry + harness, /unsignedExecutionContracts|createUnsignedExecution/);
  const execute = ast(harness).statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "executeUnsignedHarness");
  assert.equal(execute.body.statements.length, 1);
  assert.equal(execute.body.statements[0].getText(), 'throw Error("cc1a_execution_not_approved");');
});
test("C-C1b-1's synthetic suite blocks native loads, signing, child/worker launch and fixture I/O", () => {
  const s = read("./nativeBarAdmissionUnsignedExecution.test.mjs");
  for (const fragment of ['forbid(child, ["spawn"', 'forbid(workers, ["Worker"])', 'forbid(crypto, ["sign", "createSign"', 'forbid(process, ["dlopen"])',
    'forbid(fs, [...mutating.map((name) => `${name}Sync`), ...mutating, "createWriteStream"])', "forbid(fsp, mutating)",
    "roots.push(...roots.map((root) => fs.realpathSync(root) + sep))", 'assert.deepEqual(effects, [])']) assert.ok(s.includes(fragment), fragment);
  assert.doesNotMatch(s, /createUnsignedHarness|executeUnsignedHarness|fixedMemoryCheckpointOracle|import\([^)]*build\//);
});
