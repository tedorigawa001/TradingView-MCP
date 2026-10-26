import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const sourceRoot = new URL("../../src/", import.meta.url);
function ast(name) {
  return ts.createSourceFile(name, readFileSync(new URL(name, sourceRoot), "utf8"), ts.ScriptTarget.Latest, true);
}
const snippet = (text) => ts.createSourceFile("snippet.ts", text, ts.ScriptTarget.Latest, true);
// Static declarations plus dynamic import() calls; a non-literal dynamic import is reported as such.
function imports(file) {
  const out = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      out.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      out.push(ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : "dynamic_import");
    ts.forEachChild(node, visit);
  }
  visit(file); return out;
}
// A default or namespace import would reach the whole module (for example process.env or crypto.createSign).
function namedOnly(file) {
  return file.statements.filter((n) => ts.isImportDeclaration(n)).every((n) => !n.importClause
    || !n.importClause.name && (!n.importClause.namedBindings || ts.isNamedImports(n.importClause.namedBindings)));
}
// Global-object, constructor and clock aliases are refused by name, so string-built property names cannot reach them.
const forbidden = new Set(["process", "require", "eval", "fetch", "WebSocket", "WeakMap", "WeakSet", "setTimeout", "setInterval",
  "globalThis", "global", "Function", "performance", "crypto", "randomUUID", "randomBytes", "getRandomValues"]);
function violations(file) {
  const out = [];
  function visit(node) {
    if (ts.isIdentifier(node) && forbidden.has(node.text)) out.push(node.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic_import");
    // Only Date.parse is a pure conversion; any other Date reference (parenthesized, aliased, constructed) may read the clock.
    if (ts.isIdentifier(node) && node.text === "Date"
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && node.parent.name.text === "parse")) out.push("Date");
    if (ts.isCallExpression(node) && /^(Math\.random|.*\.(sign|spawn|open|writeFile|unlink))$/.test(node.expression.getText())) out.push(node.expression.getText());
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
  assert.deepEqual(violations(ast("nativeBarAdmission.ts")), []); assert.ok(namedOnly(ast("nativeBarAdmission.ts")), "named imports only");
});
test("E-A source checks catch aliased clocks, global lookups, constructors and dynamic imports", () => {
  for (const text of ["Date()", "globalThis.Date.now()", "new globalThis.Date()", "const now = Date.now; now()", "performance.now.call(performance)",
    "globalThis.crypto.getRandomValues(new Uint8Array(1))", "globalThis['proc' + 'ess']", "Function('return this')()",
    "Reflect.get(globalThis, 'fet' + 'ch')", "new Date()", "export const f = () => import('./x.js')",
    "(Date).now()", "new (Date)()", "Reflect.construct(Date, [])", "const D = Date"])
    assert.ok(violations(snippet(text)).length, text);
  assert.deepEqual(violations(snippet("Date.parse('2026-10-25T00:00:00.000Z')")), []);
  for (const text of ['import proc from "node:process"; proc.env', 'import * as z from "zod"']) assert.equal(namedOnly(snippet(text)), false, text);
  assert.deepEqual(imports(snippet('export const f = () => import("./nativeBarAdmission.js");')), ["./nativeBarAdmission.js"]);
});
test("E-A is referenced only by approved B-1/B-2a memory contracts, not startup or tools", () => {
  for (const name of readdirSync(sourceRoot).filter((name) => name.endsWith(".ts") && name !== "nativeBarAdmission.ts")) {
    const dependencies = imports(ast(name));
    if (name === "nativeBarAdmissionQueryProtocol.ts") {
      assert.deepEqual(dependencies, ["zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js", "./nativeBarAdmissionReadContracts.js"]); continue;
    }
    if (name === "nativeBarAdmissionReader.ts") {
      assert.deepEqual(dependencies, ["node:module", "node:perf_hooks", "node:process", "./nativeBarEvidence.js", "./nativeBarAdmissionReadContracts.js"]); continue;
    }
    if (name === "nativeBarAdmissionVerification.ts") {
      assert.deepEqual(dependencies, ["node:crypto", "zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js"]);
      continue;
    }
    if (name === "nativeBarAdmissionReadContracts.ts") {
      assert.deepEqual(dependencies, ["node:crypto", "node:process", "zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js", "./nativeBarAdmissionVerification.js"]);
      continue;
    }
    assert.ok(!dependencies.some((v) => v.includes("nativeBarAdmission")), name);
  }
});
