import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../src/", import.meta.url), name = "nativeBarAdmissionVerification.ts";
function parse(file) { return ts.createSourceFile(file, readFileSync(new URL(file, root), "utf8"), ts.ScriptTarget.Latest, true); }
function imports(file) {
  return file.statements.filter((n) => ts.isImportDeclaration(n) || ts.isExportDeclaration(n)).filter((n) => n.moduleSpecifier).map((n) => n.moduleSpecifier.text);
}
test("B-1 runtime imports only public-key verification/hash APIs and the existing pure contracts", () => {
  const file = parse(name);
  assert.deepEqual(imports(file), ["node:crypto", "zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js"]);
  const crypto = file.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "node:crypto");
  assert.deepEqual(crypto.importClause.namedBindings.elements.map((n) => n.propertyName?.text ?? n.name.text).sort(), ["KeyObject", "createHash", "verify"].sort());
});
test("B-1 has no signer, native loader, file/network/process access, ambient clock or challenge generator", () => {
  const forbidden = new Set(["process", "require", "eval", "fetch", "WebSocket", "createPrivateKey", "createPublicKey", "sign", "createSign",
    "generateKeyPair", "generateKeyPairSync", "randomUUID", "randomBytes", "setTimeout", "setInterval"]);
  function visit(n) {
    if (ts.isIdentifier(n)) assert.ok(!forbidden.has(n.text), n.text);
    if (ts.isCallExpression(n)) { assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword); assert.ok(!["Date.now", "performance.now", "Math.random"].includes(n.expression.getText())); }
    if (ts.isNewExpression(n) && n.expression.getText() === "Date") assert.ok(n.arguments?.length);
    ts.forEachChild(n, visit);
  }
  visit(parse(name));
});
test("B-1 is disconnected from startup, MCP registration and all other runtime modules", () => {
  for (const file of readdirSync(root).filter((s) => s.endsWith(".ts") && s !== name))
    assert.ok(!imports(parse(file)).some((s) => s.includes("nativeBarAdmissionVerification")), file);
});
