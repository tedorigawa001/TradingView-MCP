import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../src/", import.meta.url), name = "nativeBarAdmissionVerification.ts";
function parse(file) { return ts.createSourceFile(file, readFileSync(new URL(file, root), "utf8"), ts.ScriptTarget.Latest, true); }
const snippet = (text) => ts.createSourceFile("snippet.ts", text, ts.ScriptTarget.Latest, true);
// Static declarations plus dynamic import() calls; a non-literal dynamic import is reported as such.
function imports(file) {
  const out = [];
  function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)
      out.push(ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : "dynamic_import");
    ts.forEachChild(n, visit);
  }
  visit(file); return out;
}
// A default or namespace import would reach the whole module (for example crypto.createSign or crypto.randomInt).
function namedOnly(file) {
  return file.statements.filter((n) => ts.isImportDeclaration(n)).every((n) => !n.importClause
    || !n.importClause.name && (!n.importClause.namedBindings || ts.isNamedImports(n.importClause.namedBindings)));
}
// Global-object, constructor and clock aliases are refused by name, so string-built property names cannot reach them.
const forbidden = new Set(["process", "require", "eval", "fetch", "WebSocket", "createPrivateKey", "createPublicKey", "sign", "createSign",
  "generateKeyPair", "generateKeyPairSync", "randomUUID", "randomBytes", "randomInt", "getRandomValues", "webcrypto", "crypto",
  "setTimeout", "setInterval", "globalThis", "global", "Function", "performance",
  // Ambient time also leaks through Intl formatting, event timestamps, timer signals and setImmediate.
  "Intl", "Event", "EventTarget", "AbortSignal", "setImmediate"]);
function violations(file) {
  const out = [];
  function visit(n) {
    if (ts.isIdentifier(n) && forbidden.has(n.text)) out.push(n.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic_import");
    // Only Date.parse is a pure conversion; any other Date reference (parenthesized, aliased, constructed) may read the clock.
    if (ts.isIdentifier(n) && n.text === "Date"
      && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.name.text === "parse")) out.push("Date");
    if (ts.isCallExpression(n) && n.expression.getText() === "Math.random") out.push("Math.random");
    ts.forEachChild(n, visit);
  }
  visit(file); return out;
}
test("B-1 runtime imports only public-key verification/hash APIs and the existing pure contracts", () => {
  const file = parse(name);
  assert.deepEqual(imports(file), ["node:crypto", "zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js"]);
  const crypto = file.statements.find((n) => ts.isImportDeclaration(n) && n.moduleSpecifier.text === "node:crypto");
  assert.deepEqual(crypto.importClause.namedBindings.elements.map((n) => n.propertyName?.text ?? n.name.text).sort(), ["KeyObject", "createHash", "verify"].sort());
});
test("B-1 has no signer, native loader, file/network/process access, ambient clock or challenge generator", () => {
  assert.deepEqual(violations(parse(name)), []); assert.ok(namedOnly(parse(name)), "named imports only");
});
test("B-1 source checks catch aliased clocks, global lookups, constructors and dynamic imports", () => {
  for (const text of ["Date()", "globalThis.Date.now()", "new globalThis.Date()", "const now = Date.now; now()", "performance.now.call(performance)",
    "globalThis.crypto.getRandomValues(new Uint8Array(1))", "globalThis['proc' + 'ess']", "Function('return this')()",
    "Reflect.get(globalThis, 'fet' + 'ch')", "new Date()", "export const f = () => import('./x.js')",
    "(Date).now()", "new (Date)()", "Reflect.construct(Date, [])", "const D = Date",
    "new Intl.DateTimeFormat().format()", "new Event('x').timeStamp", "AbortSignal.timeout(1)", "setImmediate(f)"])
    assert.ok(violations(snippet(text)).length, text);
  assert.deepEqual(violations(snippet("Date.parse('2026-10-25T00:00:00.000Z')")), []);
  for (const text of ['import nc, { verify } from "node:crypto"; nc.createSign("sha256")', 'import * as nc from "node:crypto"; nc.randomInt(1)'])
    assert.equal(namedOnly(snippet(text)), false, text);
  assert.deepEqual(imports(snippet('export const f = () => import("./nativeBarAdmissionVerification.js");')), ["./nativeBarAdmissionVerification.js"]);
});
test("B-1 is used only by the approved memory-only B-2a contracts, not startup or MCP", () => {
  for (const file of readdirSync(root).filter((s) => s.endsWith(".ts") && s !== name)) {
    if (file === "nativeBarAdmissionOracleRegistry.ts") {
      assert.deepEqual(imports(parse(file)), ["node:crypto", "node:process", "zod", "./nativeBarAdmissionVerification.js", "./nativeBarAdmissionCheckpointContracts.js", "./nativeBarAdmissionJointReadContracts.js"]); continue;
    }
    if (file === "nativeBarAdmissionReadContracts.ts") {
      assert.deepEqual(imports(parse(file)), ["node:crypto", "node:process", "zod", "./nativeBarEvidence.js", "./nativeBarAdmission.js", "./nativeBarAdmissionVerification.js"]);
      continue;
    }
    assert.ok(!imports(parse(file)).some((s) => s.includes("nativeBarAdmissionVerification")), file);
  }
});
