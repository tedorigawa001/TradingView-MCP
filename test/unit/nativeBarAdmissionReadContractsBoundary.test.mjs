import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../src/", import.meta.url), name = "nativeBarAdmissionReadContracts.ts";
const parse = (n) => ts.createSourceFile(n, readFileSync(new URL(n, root), "utf8"), ts.ScriptTarget.Latest, true);
function imports(file) {
  const result = []; function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) result.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) result.push(ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : "dynamic_import");
    ts.forEachChild(n, visit);
  } visit(file); return result;
}
test("B-2a imports only existing pure contracts, public hashing/key types and the process ID", () => {
  const file = parse(name);
  assert.deepEqual(imports(file), ["node:crypto", "node:process", "zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js", "./nativeBarAdmissionVerification.js"]);
  for (const [module, names] of [["node:crypto", ["KeyObject", "createHash"]], ["node:process", ["pid"]]]) {
    const node = file.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === module);
    assert.deepEqual(node.importClause.namedBindings.elements.map((n) => n.propertyName?.text ?? n.name.text).sort(), names);
  }
});
test("B-2a cannot load native code, sign, access storage/network/settings or read ambient time", () => {
  const bad = new Set(["process", "require", "eval", "fetch", "WebSocket", "globalThis", "global", "Function", "performance", "crypto",
    "createPrivateKey", "createPublicKey", "sign", "generateKeyPair", "generateKeyPairSync", "randomUUID", "randomBytes", "setTimeout", "setInterval"]);
  function visit(n) {
    if (ts.isIdentifier(n)) assert.ok(!bad.has(n.text), n.text);
    if (ts.isCallExpression(n)) { assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword); assert.ok(!["Date", "Math.random"].includes(n.expression.getText())); }
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.expression.getText() + "." + n.name.text, "Date.now");
    if (ts.isNewExpression(n) && n.expression.getText() === "Date") assert.ok(n.arguments?.length);
    ts.forEachChild(n, visit);
  } visit(parse(name));
});
test("B-2a has no incoming runtime or startup/MCP dependency", () => {
  for (const file of readdirSync(root).filter((s) => s.endsWith(".ts") && s !== name))
    assert.ok(!imports(parse(file)).some((v) => v.includes("nativeBarAdmissionReadContracts")), file);
});
