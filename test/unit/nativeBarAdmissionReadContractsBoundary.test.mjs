import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../src/", import.meta.url), name = "nativeBarAdmissionReadContracts.ts";
const parse = (n) => ts.createSourceFile(n, readFileSync(new URL(n, root), "utf8"), ts.ScriptTarget.Latest, true);
const snippet = (text) => ts.createSourceFile("snippet.ts", text, ts.ScriptTarget.Latest, true);
function imports(file) {
  const result = []; function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) result.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) result.push(ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : "dynamic_import");
    ts.forEachChild(n, visit);
  } visit(file); return result;
}
// A default or namespace import would reach the whole module (for example process.env or crypto.createSign).
function namedOnly(file) {
  return file.statements.filter((n) => ts.isImportDeclaration(n)).every((n) => !n.importClause
    || !n.importClause.name && (!n.importClause.namedBindings || ts.isNamedImports(n.importClause.namedBindings)));
}
const bad = new Set(["process", "require", "eval", "fetch", "WebSocket", "globalThis", "global", "Function", "performance", "crypto",
  "createPrivateKey", "createPublicKey", "sign", "createSign", "generateKeyPair", "generateKeyPairSync", "randomUUID", "randomBytes",
  "randomInt", "randomFill", "randomFillSync", "getRandomValues", "webcrypto", "setTimeout", "setInterval",
  // Ambient time also leaks through Intl formatting, event timestamps, timer signals and setImmediate.
  "Intl", "Event", "EventTarget", "AbortSignal", "setImmediate"]);
function violations(file) {
  const out = []; function visit(n) {
    if (ts.isIdentifier(n) && bad.has(n.text)) out.push(n.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic_import");
    // Only Date.parse is a pure conversion; any other Date reference (parenthesized, aliased, constructed) may read the clock.
    if (ts.isIdentifier(n) && n.text === "Date" && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.name.text === "parse"))
      out.push("Date");
    if (ts.isCallExpression(n) && n.expression.getText() === "Math.random") out.push("Math.random");
    ts.forEachChild(n, visit);
  } visit(file); return out;
}
test("B-2a imports only existing pure contracts, public hashing/key types and the process ID", () => {
  const file = parse(name);
  assert.deepEqual(imports(file), ["node:crypto", "node:process", "zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js", "./nativeBarAdmissionVerification.js"]);
  assert.ok(namedOnly(file), "named imports only");
  for (const [module, names] of [["node:crypto", ["KeyObject", "createHash"]], ["node:process", ["pid"]]]) {
    const node = file.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === module);
    assert.deepEqual(node.importClause.namedBindings.elements.map((n) => n.propertyName?.text ?? n.name.text).sort(), names);
  }
});
test("B-2a cannot load native code, sign, access storage/network/settings or read ambient time", () => {
  assert.deepEqual(violations(parse(name)), []);
});
test("B-2a source checks catch default imports, aliased clocks, global lookups and dynamic imports", () => {
  for (const text of ['import proc, { pid } from "node:process"; proc.env', 'import * as nc from "node:crypto"; nc.randomInt(1)'])
    assert.equal(namedOnly(snippet(text)), false, text);
  for (const text of ["(Date).now()", "new (Date)()", "Reflect.construct(Date, [])", "const D = Date", "Date()", "globalThis.Date.now()",
    "performance.now.call(performance)", "globalThis.crypto.getRandomValues(new Uint8Array(1))", "globalThis['proc' + 'ess']",
    "Function('return this')()", "Reflect.get(globalThis, 'fet' + 'ch')", "createSign('sha256')", "export const f = () => import('./x.js')",
    "new Intl.DateTimeFormat().format()", "new Event('x').timeStamp", "AbortSignal.timeout(1)", "setImmediate(f)"])
    assert.ok(violations(snippet(text)).length, text);
  assert.deepEqual(violations(snippet("Date.parse('2026-10-25T00:00:00.000Z')")), []);
});
test("B-2a has no incoming runtime or startup/MCP dependency", () => {
  for (const file of readdirSync(root).filter((s) => s.endsWith(".ts") && s !== name)) {
    if (file === "nativeBarAdmissionJointReadContracts.ts") {
      const source = parse(file); assert.deepEqual(imports(source), ["node:crypto", "zod", "./nativeBarEvidence.js", "./nativeBarAdmissionReadContracts.js", "./nativeBarAdmissionQueryProtocol.js"]);
      const dependency = source.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "./nativeBarAdmissionReadContracts.js");
      assert.ok(namedOnly(source));
      assert.deepEqual(dependency.importClause.namedBindings.elements.map((e) => e.propertyName?.text ?? e.name.text),
        ["nativeBarAdmissionReadRegistrationSchema", "validateSyntheticAdmissionReadRegistration", "validateSyntheticAdmissionReadLimits", "calculateSyntheticAdmissionReadBudget", "classifySyntheticAdmissionReadEntry"]); continue;
    }
    if (file === "nativeBarAdmissionCheckpointContracts.ts") {
      assert.deepEqual(imports(parse(file)), ["zod", "./nativeBarEvidence.js", "./nativeBarAdmissionReadContracts.js", "./nativeBarAdmissionQueryProtocol.js"]); continue;
    }
    if (file === "nativeBarAdmissionQueryProtocol.ts") {
      assert.deepEqual(imports(parse(file)), ["zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js", "./nativeBarAdmissionReadContracts.js"]); continue;
    }
    if (file === "nativeBarAdmissionReader.ts") {
      assert.deepEqual(imports(parse(file)), ["node:module", "node:perf_hooks", "node:process", "./nativeBarEvidence.js", "./nativeBarAdmissionReadContracts.js"]); continue;
    }
    assert.ok(!imports(parse(file)).some((v) => v.includes("nativeBarAdmissionReadContracts")), file);
  }
});
