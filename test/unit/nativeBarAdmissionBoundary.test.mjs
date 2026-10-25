import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const sourceRoot = new URL("../../src/", import.meta.url);
function ast(name) {
  return ts.createSourceFile(name, readFileSync(new URL(name, sourceRoot), "utf8"), ts.ScriptTarget.Latest, true);
}
function imports(file) {
  const out = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      out.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic_import");
    ts.forEachChild(node, visit);
  }
  visit(file); return out;
}
test("E-A has only the existing pure schema/hash dependencies and no IO-capable transitive imports", () => {
  assert.deepEqual(imports(ast("nativeBarAdmission.ts")), ["zod", "./nativeBarEvidence.js", "./nativeBarTransactions.js", "./nativeBarArtifacts.js"]);
  for (const name of ["nativeBarEvidence.ts", "nativeBarTransactions.ts", "nativeBarArtifacts.ts"])
    for (const dependency of imports(ast(name))) assert.ok(["node:crypto", "zod", "./nativeBarEvidence.js"].includes(dependency), dependency);
});
test("E-A cannot read ambient clocks/settings, sign, mint handles, or load native helpers", () => {
  const forbidden = new Set(["process", "require", "eval", "fetch", "WebSocket", "WeakMap", "WeakSet", "setTimeout", "setInterval"]);
  const calls = [];
  function visit(node) {
    if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), node.text);
    if (ts.isCallExpression(node)) calls.push(node.expression.getText());
    if (ts.isNewExpression(node) && node.expression.getText() === "Date") assert.ok(node.arguments?.length, "ambient clock");
    ts.forEachChild(node, visit);
  }
  visit(ast("nativeBarAdmission.ts"));
  assert.ok(!calls.some((c) => /^(Date\.now|Math\.random|.*\.(sign|randomUUID|spawn|open|writeFile|unlink))$/.test(c)));
});
test("E-A is not imported or exported by production startup, tools, or another runtime module", () => {
  for (const name of readdirSync(sourceRoot).filter((name) => name.endsWith(".ts") && name !== "nativeBarAdmission.ts"))
    assert.ok(!imports(ast(name)).some((v) => v.includes("nativeBarAdmission")), name);
});
