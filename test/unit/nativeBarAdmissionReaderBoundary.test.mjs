import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
const base = process.env.NATIVE_BAR_B2B_ISOLATED_TEST === "1" ? "../../build/b2b-validation/" : "../../build/";
test("B-2b exposes a separate disconnected registry without opening or creating a fixture", async () => {
  const api = await import(new URL(`${base}nativeBarAdmissionReader.js`, import.meta.url));
  assert.equal(typeof api.createSyntheticAdmissionNativeReadRegistry, "function");
  assert.throws(() => api.createSyntheticAdmissionNativeReadRegistry({}), /bootstrap/);
});
const root = new URL("../../src/", import.meta.url), name = "nativeBarAdmissionReader.ts";
function ast(file) { return ts.createSourceFile(file, readFileSync(new URL(file, root), "utf8"), ts.ScriptTarget.Latest, true); }
function imports(file) {
  const out = []; function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic_import");
    ts.forEachChild(n, visit);
  } visit(file); return out;
}
test("B-2b has one fixed optional loader and no storage/network/signer/settings imports", () => {
  const file = ast(name);
  assert.deepEqual(imports(file), ["node:module", "node:perf_hooks", "node:process", "./nativeBarEvidence.js", "./nativeBarAdmissionReadContracts.js"]);
  const loaders = [];
  function visit(n) {
    if (ts.isIdentifier(n)) assert.ok(!["process", "require", "eval", "fetch", "WebSocket", "Function", "global", "globalThis", "sign", "createPrivateKey", "generateKeyPairSync", "randomUUID", "randomBytes"].includes(n.text), n.text);
    if (ts.isCallExpression(n) && n.expression.getText() === "createRequire(import.meta.url)") loaders.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  } visit(file); assert.deepEqual(loaders, ["./native-bar-fs/native_bar_fs.node"]);
  for (const [module, only] of [["node:module", "createRequire"], ["node:perf_hooks", "performance"], ["node:process", "platform"]]) {
    const node = file.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === module);
    assert.deepEqual(node.importClause.namedBindings.elements.map((n) => n.propertyName?.text ?? n.name.text), [only]);
  }
});
test("B-2b remains disconnected from every startup/MCP/history/market module", () => {
  for (const file of readdirSync(root).filter((s) => s.endsWith(".ts") && s !== name))
    assert.ok(!imports(ast(file)).some((s) => s.includes("nativeBarAdmissionReader")), file);
});
test("B-2b native implementation has no mutation path or legacy handle conversion", () => {
  const source = readFileSync(new URL("../../native/native_bar_fs/native_bar_admission.inc", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:unlinkat|renameatx_np|mkdirat|fsync|fchmod|fchown|ftruncate|write|pwrite|session_arg|target_arg|coordination_arg)\s*\(/);
  assert.doesNotMatch(source, /\b(?:O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND)\b/);
  assert.doesNotMatch(source, /\bprop\s*\(/);
  assert.match(source, /napi_define_properties\(/);
  const helper = readFileSync(new URL("../../native/native_bar_fs/admission_fixture_expectations.cc", import.meta.url), "utf8");
  assert.match(helper, /getattrlist\(/); assert.match(helper, /acl_get_link_np\(/);
  assert.doesNotMatch(helper, /#include\s+"|\b(?:fstat|acl_get_fd_np|fgetattrlist)\(/);
});
