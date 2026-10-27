import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../src/", import.meta.url), name = "nativeBarAdmissionQueryProtocol.ts";
const snippet = (s) => ts.createSourceFile("model.ts", s, ts.ScriptTarget.Latest, true);
const ast = (file) => snippet(readFileSync(new URL(file, root), "utf8"));
const allowed = new Map([
  ["zod", ["z"]],
  ["./nativeBarEvidence.js", ["canonical", "evidenceHash", "nativeBarHash", "nativeBarId", "nativeBarTimestamp"]],
  ["./nativeBarAdmission.js", ["NATIVE_BAR_ADMISSION_LIMITS"]],
  ["./nativeBarAdmissionReadContracts.js", ["nativeBarAdmissionReadRegistrationSchema", "validateSyntheticAdmissionReadRegistration",
    "validateSyntheticAdmissionReadLimits", "calculateSyntheticAdmissionReadBudget"]],
]);
function imports(file) {
  const out = []; function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) out.push(n.moduleSpecifier.text);
    // A literal dynamic import is recorded by name, so an incoming import("./nativeBarAdmissionQueryProtocol.js") is caught.
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)
      out.push(ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : "dynamic_import");
    ts.forEachChild(n, visit);
  } visit(file); return out;
}
function strictImports(file) {
  const entries = file.statements.filter(ts.isImportDeclaration);
  return entries.length === allowed.size && entries.every((n) => {
    const clause = n.importClause, expected = allowed.get(n.moduleSpecifier.text);
    return expected && clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
      && canonicalNames(clause.namedBindings.elements.map((e) => e.propertyName?.text ?? e.name.text)) === canonicalNames(expected);
  }) && new Set(entries.map((n) => n.moduleSpecifier.text)).size === allowed.size;
}
const canonicalNames = (names) => JSON.stringify([...names].sort());
const banned = new Set(["process", "require", "eval", "fetch", "WebSocket", "globalThis", "global", "Function", "performance", "crypto",
  "createRequire", "createPrivateKey", "createPublicKey", "sign", "createSign", "generateKeyPair", "generateKeyPairSync", "randomUUID",
  "randomBytes", "randomInt", "randomFill", "randomFillSync", "getRandomValues", "webcrypto", "setTimeout", "setInterval",
  "claimSyntheticAdmissionNativeRead", "createSyntheticAdmissionReadRegistry", "createSyntheticAdmissionReadBootstrap",
  // Ambient time also leaks through Intl formatting, event timestamps, timer signals and setImmediate.
  "Intl", "Event", "EventTarget", "AbortSignal", "setImmediate"]);
function violations(file) {
  const out = []; function visit(n) {
    if (ts.isIdentifier(n) && banned.has(n.text)) out.push(n.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic_import");
    if (ts.isIdentifier(n) && n.text === "Date" && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.name.text === "parse")) out.push("Date");
    if (ts.isCallExpression(n) && n.expression.getText() === "Math.random") out.push("Math.random");
    ts.forEachChild(n, visit);
  } visit(file); return out;
}
test("B3-A imports exactly the approved pure named helpers, never native capability bridges", () => {
  assert.deepEqual(imports(ast(name)), [...allowed.keys()]); assert.equal(strictImports(ast(name)), true);
});
test("B3-A has no ambient clock, random source, signer, provider, storage or native loader", () => {
  assert.deepEqual(violations(ast(name)), []);
});
test("B3-A boundary tests catch clock aliases, globals, signers, capability bridges and import widening", () => {
  for (const source of ["const clock = Date; clock.now()", "new Date()", "performance.now()", "Math.random()", "globalThis['crypto']",
    "sign(null, body, key)", "createPrivateKey(x)", "randomBytes(16)", "claimSyntheticAdmissionNativeRead(r,t,c)", "import('./native.js')",
    "new Intl.DateTimeFormat().format()", "new Event('x').timeStamp", "AbortSignal.timeout(1)", "setImmediate(f)"])
    assert.ok(violations(snippet(source)).length, source);
  assert.deepEqual(violations(snippet("Date.parse('2026-10-26T00:00:00.000Z')")), []);
  assert.deepEqual(imports(snippet('export const load = () => import("./nativeBarAdmissionQueryProtocol.js")')), ["./nativeBarAdmissionQueryProtocol.js"]);
  const text = readFileSync(new URL(name, root), "utf8");
  for (const mutation of [text.replace('import { z }', 'import all, { z }'), text.replace('import { z }', 'import * as z'),
    text.replace("calculateSyntheticAdmissionReadBudget }", "calculateSyntheticAdmissionReadBudget, claimSyntheticAdmissionNativeRead }")])
    assert.equal(strictImports(snippet(mutation)), false);
});
test("B3-A is disconnected from all runtime/startup/MCP/history consumers", () => {
  for (const file of readdirSync(root).filter((s) => s.endsWith(".ts") && s !== name)) {
    if (file === "nativeBarAdmissionJointReadContracts.ts") {
      const source = ast(file); assert.deepEqual(imports(source), ["node:crypto", "zod", "./nativeBarEvidence.js", "./nativeBarAdmissionReadContracts.js", "./nativeBarAdmissionQueryProtocol.js"]);
      const dependency = source.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "./nativeBarAdmissionQueryProtocol.js");
      assert.ok(dependency.importClause && !dependency.importClause.name && ts.isNamedImports(dependency.importClause.namedBindings));
      assert.deepEqual(dependency.importClause.namedBindings.elements.map((e) => e.propertyName?.text ?? e.name.text), ["calculateSyntheticAdmissionQueryProtocolBudget"]); continue;
    }
    if (file === "nativeBarAdmissionCheckpointContracts.ts") {
      const source = ast(file); assert.deepEqual(imports(source), ["zod", "./nativeBarEvidence.js", "./nativeBarAdmissionReadContracts.js", "./nativeBarAdmissionQueryProtocol.js"]);
      const dependency = source.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "./nativeBarAdmissionQueryProtocol.js");
      assert.deepEqual(dependency.importClause.namedBindings.elements.map((e) => e.propertyName?.text ?? e.name.text), ["calculateSyntheticAdmissionQueryProtocolBudget"]); continue;
    }
    assert.ok(!imports(ast(file)).some((s) => s.includes("nativeBarAdmissionQueryProtocol")), file);
  }
});
