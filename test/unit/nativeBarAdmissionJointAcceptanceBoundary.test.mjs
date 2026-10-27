import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const file = new URL("../helpers/jointAcceptanceContracts.mjs", import.meta.url), source = readFileSync(file, "utf8");
const ast = (s) => ts.createSourceFile("jointAcceptanceContracts.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function guard(text) {
  const root = ast(text), imports = [], exports = [], denied = [];
  const forbidden = new Set(["require", "createRequire", "dlopen", "process", "globalThis", "global", "fetch", "WebSocket", "XMLHttpRequest",
    "Worker", "SharedWorker", "eval", "Function", "createPrivateKey", "sign", "writeFileSync", "mkdirSync", "unlinkSync", "rmSync",
    "readFileSync", "readdirSync", "setTimeout", "setInterval", "performance", "hrtime", "randomUUID", "randomBytes"]);
  function visit(n) {
    if (ts.isImportDeclaration(n)) {
      const clause = n.importClause;
      assert.ok(clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings));
      imports.push([n.moduleSpecifier.text, clause.namedBindings.elements.map((e) => {
        assert.equal(e.propertyName, undefined); return e.name.text;
      })]);
    }
    if (ts.isExportAssignment(n) || ts.isExportDeclaration(n)) denied.push("reexport");
    if (n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      assert.ok(ts.isFunctionDeclaration(n)); exports.push(n.name?.text);
    }
    if (ts.isIdentifier(n) && forbidden.has(n.text)) denied.push(n.text);
    if (ts.isIdentifier(n) && n.text === "Date"
      && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.name.text === "parse")) denied.push("clock");
    if (ts.isIdentifier(n) && n.text === "Math") denied.push("Math");
    if (ts.isPropertyAccessExpression(n) && n.name.text === "constructor") denied.push("constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)
      && (forbidden.has(n.argumentExpression.text) || n.argumentExpression.text === "constructor")) denied.push(n.argumentExpression.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) denied.push("dynamic_import");
    ts.forEachChild(n, visit);
  }
  visit(root);
  assert.deepEqual(imports, [["node:crypto", ["createHash"]], ["zod", ["z"]]]);
  assert.deepEqual(exports, ["describeJointAcceptancePlan", "createJointAcceptanceMemoryLedger"]);
  assert.deepEqual(denied, []);
}
test("C-C0 has only hash/schema imports and non-executing plan/ledger exports", () => guard(source));
test("C-C0 boundary guard catches execution, IO, signer and loader regressions", () => {
  for (const added of ["import fs from 'node:fs';", "export { x } from './reader.js';", "export function run() {}",
    "import('./native.js');", "require('./addon.node');", "process.dlopen(m, p);", "globalThis.fetch(url);",
    "createPrivateKey(k);", "sign(null, b, k);", "writeFileSync(p,b);", "new Worker(f);", "Date.now();", "new Date();",
    "Math.random();", "const {now}=Date;", "Buffer.constructor('return 1')();", "Buffer['constructor']('return 1')();"])
    assert.throws(() => guard(`${source}\n${added}`), undefined, added);
  assert.throws(() => guard(source.replace("{ createHash }", "{ createHash, createPrivateKey }")));
  assert.throws(() => guard(source.replace("{ createHash }", "{ createHash as hash }")));
});
test("C-C0 stays disconnected from runtime, MCP, common startup and lifecycle commands", () => {
  const root = new URL("../../src/", import.meta.url);
  function scan(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      if (e.isDirectory()) scan(f);
      else if (e.name.endsWith(".ts")) assert.doesNotMatch(readFileSync(f, "utf8"), /jointAcceptanceContracts|test_joint_admission|b3cc-validation/, e.name);
    }
  }
  scan(root);
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /jointAcceptanceContracts|test_joint_admission|b3cc-validation/);
  const tests = readFileSync(new URL("./nativeBarAdmissionJointAcceptance.test.mjs", import.meta.url), "utf8");
  assert.match(tests, /process\.dlopen =/); assert.match(tests, /module\.createRequire =/); assert.match(tests, /assert\.deepEqual\(nativeLoads, \[\]\)/);
});
