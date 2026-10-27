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
    // Record a literal dynamic-import specifier by name, so a consumer written as import("./x.js") is still seen.
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push(ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : "dynamic_import");
    ts.forEachChild(n, visit);
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
  "generateKeyPair", "generateKeyPairSync", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "CustomEvent", "PerformanceMark", "PerformanceMeasure",
  "PerformanceObserver", "PerformanceEntry", "Math", "claimSyntheticAdmissionNativeRead", "createSyntheticAdmissionReadRegistry",
  "createSyntheticAdmissionReadBootstrap", "enrollSyntheticCheckpointProbe", "claimSyntheticCheckpointProbe", "createSyntheticAdmissionQueryProtocolModel"]);
function violations(file) {
  const out = []; function visit(n) {
    if (ts.isIdentifier(n) && banned.has(n.text)) out.push(n.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || n.expression.getText() === "Math.random")) out.push("dynamic_or_random");
    // .constructor reaches Function from any value; a literal element access must not spell a banned name either. A computed
    // key held in a variable is out of reach of this static scan, as in the sibling boundary tests.
    if (ts.isPropertyAccessExpression(n) && n.name.text === "constructor") out.push("constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)
      && (banned.has(n.argumentExpression.text) || ["constructor", "random"].includes(n.argumentExpression.text))) out.push(n.argumentExpression.text);
    ts.forEachChild(n, visit);
  } visit(file); return out;
}
test("C-A imports exactly pure validators/calculators/classification and raw hashing, never capability factories", () => {
  assert.equal(exact(ast(text)), true); assert.deepEqual(violations(ast(text)), []);
});
// A default export (export default x) carries no export modifier, so it is reported separately instead of slipping past the name list.
function exported(file) {
  const defaults = file.statements.filter((n) => ts.isExportAssignment(n) || n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)).length;
  const names = file.statements.filter((n) => !ts.isExportAssignment(n) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).flatMap((n) =>
    ts.isFunctionDeclaration(n) ? [n.name?.text ?? "default"] : ts.isVariableStatement(n) ? n.declarationList.declarations.map((d) => d.name.getText()) : ["unexpected"]);
  return { reexports: file.statements.filter(ts.isExportDeclaration).length, defaults, names: names.sort() };
}
// Any spelling of the module name counts, so createRequire(...)("./nativeBarAdmissionJointReadContracts.js") is caught as well as imports.
const consumes = (source) => source.includes("nativeBarAdmissionJointReadContracts") || imports(ast(source)).some((s) => s.includes("nativeBarAdmissionJointReadContracts"));
test("C-A exposes no native/provider/clock/issuer entry or re-export", () => {
  const { reexports, defaults, names } = exported(ast(text)); assert.equal(reexports, 0); assert.equal(defaults, 0);
  assert.deepEqual(names, ["validateSyntheticAdmissionJointBinding", "checkSyntheticAdmissionJointBindingMatch", "validateSyntheticAdmissionJointWorkEnvelope",
    "planSyntheticAdmissionJointWork", "selectSyntheticAdmissionJointWitnesses", "matchSyntheticAdmissionJointRecordBytes", "matchSyntheticAdmissionJointContentBytes",
    "checkSyntheticAdmissionJointWorkUsage", "nativeBarAdmissionJointModelResultSchema", "validateSyntheticAdmissionJointModelResult"].sort());
});
test("C-A has no incoming runtime, startup, MCP, history or market consumer", () => {
  for (const file of readdirSync(root).filter((f) => f.endsWith(".ts") && f !== name)) assert.ok(!consumes(readFileSync(new URL(file, root), "utf8")), file);
});
test("C-A boundary assertions detect widened imports, ambient sources, signers and token issuance", () => {
  for (const s of ["Date.now()", "const d=Date", "new Intl.DateTimeFormat().format()", "new Event('x').timeStamp", "Math.random()", "globalThis['process']",
    "createPrivateKey(x)", "sign(null,b,k)", "randomUUID()", "setImmediate(f)", "new WeakMap()", "claimSyntheticAdmissionNativeRead(r,t,c)", "import('./native.js')",
    "new CustomEvent('x').timeStamp", "new PerformanceMark('x').startTime", "const { random } = Math; random()", "Math['random']()", "new WeakSet()",
    "Buffer.constructor('return 1')()", "Buffer['constructor']('return 1')()", "x['globalThis']"])
    assert.ok(violations(ast(s)).length, s);
  assert.equal(exported(ast(`${text}\nexport default { validateSyntheticAdmissionJointBinding };`)).defaults, 1);
  assert.equal(exported(ast(`${text}\nexport default function () {}`)).defaults, 1);
  for (const consumer of ['export const load = () => import("./nativeBarAdmissionJointReadContracts.js");',
    'import { createRequire } from "node:module"; export const load = () => createRequire(import.meta.url)("./nativeBarAdmissionJointReadContracts.js");'])
    assert.equal(consumes(consumer), true, consumer);
  assert.equal(consumes('import { z } from "zod"; export const load = () => import("./nativeBarAdmissionReadContracts.js");'), false);
  for (const modified of [text.replace('import { z }', 'import everything, { z }'),
    text.replace("classifySyntheticAdmissionReadEntry }", "classifySyntheticAdmissionReadEntry, claimSyntheticAdmissionNativeRead }"),
    text.replace("calculateSyntheticAdmissionQueryProtocolBudget }", "calculateSyntheticAdmissionQueryProtocolBudget, createSyntheticAdmissionQueryProtocolModel }")]) {
    assert.notEqual(modified, text); assert.equal(exact(ast(modified)), false);
  }
});
