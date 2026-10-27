import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../src/", import.meta.url), name = "nativeBarAdmissionJointReadContracts.ts";
const text = readFileSync(new URL(name, root), "utf8");
const ast = (s) => ts.createSourceFile("joint-contracts.ts", s, ts.ScriptTarget.Latest, true);
const expected = {
  "node:crypto": ["createHash"], "zod": ["z"],
  "./nativeBarEvidence.js": ["canonical", "evidenceHash", "nativeBarHash", "nativeBarId"],
  "./nativeBarAdmissionReadContracts.js": ["nativeBarAdmissionReadRegistrationSchema", "validateSyntheticAdmissionReadRegistration",
    "validateSyntheticAdmissionReadLimits", "calculateSyntheticAdmissionReadBudget", "classifySyntheticAdmissionReadEntry"],
  "./nativeBarAdmissionQueryProtocol.js": ["calculateSyntheticAdmissionQueryProtocolBudget"],
};
function imports(file) {
  const out = []; function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic_import"); ts.forEachChild(n, visit);
  } visit(file); return out;
}
function exact(file) {
  const entries = file.statements.filter(ts.isImportDeclaration);
  return JSON.stringify(imports(file)) === JSON.stringify(Object.keys(expected)) && entries.every((n) => {
    const clause = n.importClause, bindings = clause?.namedBindings;
    return clause && !clause.name && bindings && ts.isNamedImports(bindings)
      && JSON.stringify(bindings.elements.map((e) => e.propertyName?.text ?? e.name.text).sort()) === JSON.stringify([...expected[n.moduleSpecifier.text]].sort());
  });
}
const banned = new Set(["process", "require", "createRequire", "eval", "Function", "global", "globalThis", "fetch", "WebSocket", "performance", "Date", "hrtime",
  "Intl", "Event", "EventTarget", "AbortSignal", "setTimeout", "setInterval", "setImmediate", "crypto", "webcrypto", "getRandomValues",
  "randomUUID", "randomBytes", "randomInt", "randomFill", "randomFillSync", "sign", "createSign", "verify", "createPrivateKey", "createPublicKey", "KeyObject",
  "generateKeyPair", "generateKeyPairSync", "WeakMap", "WeakRef", "FinalizationRegistry", "claimSyntheticAdmissionNativeRead", "createSyntheticAdmissionReadRegistry",
  "createSyntheticAdmissionReadBootstrap", "enrollSyntheticCheckpointProbe", "claimSyntheticCheckpointProbe", "createSyntheticAdmissionQueryProtocolModel"]);
function violations(file) {
  const out = []; function visit(n) {
    if (ts.isIdentifier(n) && banned.has(n.text)) out.push(n.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || n.expression.getText() === "Math.random")) out.push("dynamic_or_random");
    ts.forEachChild(n, visit);
  } visit(file); return out;
}
test("C-A imports exactly pure validators/calculators/classification and raw hashing, never capability factories", () => {
  assert.equal(exact(ast(text)), true); assert.deepEqual(violations(ast(text)), []);
});
test("C-A exposes no native/provider/clock/issuer entry or re-export", () => {
  const file = ast(text); assert.equal(file.statements.filter(ts.isExportDeclaration).length, 0);
  const names = file.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).flatMap((n) =>
    ts.isFunctionDeclaration(n) ? [n.name.text] : n.declarationList.declarations.map((d) => d.name.getText()));
  assert.deepEqual(names.sort(), ["validateSyntheticAdmissionJointBinding", "checkSyntheticAdmissionJointBindingMatch", "validateSyntheticAdmissionJointWorkEnvelope",
    "planSyntheticAdmissionJointWork", "selectSyntheticAdmissionJointWitnesses", "matchSyntheticAdmissionJointRecordBytes", "matchSyntheticAdmissionJointContentBytes",
    "checkSyntheticAdmissionJointWorkUsage", "nativeBarAdmissionJointModelResultSchema", "validateSyntheticAdmissionJointModelResult"].sort());
});
test("C-A has no incoming runtime, startup, MCP, history or market consumer", () => {
  for (const file of readdirSync(root).filter((f) => f.endsWith(".ts") && f !== name))
    assert.ok(!imports(ast(readFileSync(new URL(file, root), "utf8"))).some((s) => s.includes("nativeBarAdmissionJointReadContracts")), file);
});
test("C-A boundary assertions detect widened imports, ambient sources, signers and token issuance", () => {
  for (const s of ["Date.now()", "const d=Date", "new Intl.DateTimeFormat().format()", "new Event('x').timeStamp", "Math.random()", "globalThis['process']",
    "createPrivateKey(x)", "sign(null,b,k)", "randomUUID()", "setImmediate(f)", "new WeakMap()", "claimSyntheticAdmissionNativeRead(r,t,c)", "import('./native.js')"])
    assert.ok(violations(ast(s)).length, s);
  for (const modified of [text.replace('import { z }', 'import everything, { z }'),
    text.replace("classifySyntheticAdmissionReadEntry }", "classifySyntheticAdmissionReadEntry, claimSyntheticAdmissionNativeRead }"),
    text.replace("calculateSyntheticAdmissionQueryProtocolBudget }", "calculateSyntheticAdmissionQueryProtocolBudget, createSyntheticAdmissionQueryProtocolModel }")]) {
    assert.notEqual(modified, text); assert.equal(exact(ast(modified)), false);
  }
});
