import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../src/", import.meta.url);
const specs = {
  "nativeBarAdmissionCheckpointContracts.ts": ["zod", "./nativeBarEvidence.js", "./nativeBarAdmissionReadContracts.js", "./nativeBarAdmissionQueryProtocol.js"],
  "nativeBarAdmissionOracleRegistry.ts": ["node:crypto", "node:process", "zod", "./nativeBarAdmissionVerification.js", "./nativeBarAdmissionCheckpointContracts.js"],
  "nativeBarAdmissionCheckpointProbe.ts": ["node:crypto", "node:process", "node:timers", "./nativeBarAdmissionOracleRegistry.js", "./nativeBarAdmissionCheckpointContracts.js"],
};
// Exact named bindings for every import, local modules included: the probe may take only its reader claim from the
// registry, never the fixed oracle's original-owner mailbox.
const named = {
  "nativeBarAdmissionCheckpointContracts.ts": { "zod": ["z"], "./nativeBarEvidence.js": ["canonical", "evidenceHash", "nativeBarHash", "nativeBarId", "nativeBarTimestamp"],
    "./nativeBarAdmissionReadContracts.js": ["nativeBarAdmissionReadRegistrationSchema", "validateSyntheticAdmissionReadLimits", "validateSyntheticAdmissionReadRegistration"],
    "./nativeBarAdmissionQueryProtocol.js": ["calculateSyntheticAdmissionQueryProtocolBudget"] },
  "nativeBarAdmissionOracleRegistry.ts": { "node:crypto": ["KeyObject"], "node:process": ["pid"], "zod": ["z"],
    "./nativeBarAdmissionVerification.js": ["createSyntheticNativeBarAdmissionVerifier"],
    "./nativeBarAdmissionCheckpointContracts.js": ["checkpointProbeBytes", "checkpointProbeId", "checkpointProbeNoAuthority", "checkpointProbeParse",
      "checkpointProbeRefuse", "checkpointProbeRequestSchema", "validateCheckpointOracleBinding"] },
  "nativeBarAdmissionCheckpointProbe.ts": { "node:crypto": ["randomUUID"], "node:process": ["hrtime"], "node:timers": ["clearTimeout", "setTimeout"],
    "./nativeBarAdmissionOracleRegistry.js": ["claimSyntheticCheckpointProbe"],
    "./nativeBarAdmissionCheckpointContracts.js": ["checkpointProbeDiagnosticSchema", "checkpointProbeNoAuthority", "checkpointProbeOptionsSchema",
      "checkpointProbeParse", "checkpointProbeRefuse", "planCheckpointProbeBudget"] },
};
function namedImportsExact(name, file) {
  return file.statements.filter(ts.isImportDeclaration).every((n) => {
    const expected = named[name][n.moduleSpecifier.text], clause = n.importClause;
    if (!expected || !clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
    const names = clause.namedBindings.elements.map((e) => e.propertyName?.text ?? e.name.text).sort();
    return JSON.stringify(names) === JSON.stringify([...expected].sort());
  });
}
const parse = (text) => ts.createSourceFile("boundary.ts", text, ts.ScriptTarget.Latest, true);
const ast = (name) => parse(readFileSync(new URL(name, root), "utf8"));
function imports(file) {
  const out = []; function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push(ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : "dynamic_import");
    ts.forEachChild(n, visit);
  } visit(file); return out;
}
const forbidden = new Set(["process", "require", "createRequire", "fetch", "WebSocket", "eval", "global", "globalThis", "Function", "sign", "createSign",
  "createPrivateKey", "createPublicKey", "generateKeyPair", "generateKeyPairSync", "randomBytes", "randomInt", "crypto", "webcrypto", "getRandomValues",
  "Intl", "Event", "EventTarget", "AbortSignal", "setImmediate", "setInterval"]);
function violations(file, timed = false) {
  const out = []; function visit(n) {
    if (ts.isIdentifier(n) && (forbidden.has(n.text) || !timed && ["Date", "performance", "hrtime", "randomUUID", "setTimeout", "clearTimeout"].includes(n.text))) out.push(n.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || n.expression.getText() === "Math.random")) out.push("dynamic_or_random");
    ts.forEachChild(n, visit);
  } visit(file); return out;
}
test("B3-Ba exact dependency graph excludes signer, native, storage, network and startup", () => {
  for (const [name, dependencies] of Object.entries(specs)) {
    const file = ast(name); assert.deepEqual(imports(file), dependencies, name);
    assert.ok(namedImportsExact(name, file), `${name} imports exactly its allowlisted names`);
    for (const n of file.statements.filter(ts.isImportDeclaration)) {
      assert.ok(n.importClause && !n.importClause.name && ts.isNamedImports(n.importClause.namedBindings), name);
      const allowed = { "node:crypto": name.endsWith("OracleRegistry.ts") ? ["KeyObject"] : ["randomUUID"], "node:process": name.endsWith("OracleRegistry.ts") ? ["pid"] : ["hrtime"], "node:timers": ["setTimeout", "clearTimeout"] }[n.moduleSpecifier.text];
      if (allowed) assert.deepEqual(n.importClause.namedBindings.elements.map((e) => e.propertyName?.text ?? e.name.text), allowed);
    }
    assert.deepEqual(violations(file, name.endsWith("CheckpointProbe.ts")), [], name);
  }
});
test("B3-Ba helpers are unsigned and use only the single original-owner bridge", () => {
  const helper = readFileSync(new URL("../helpers/unsignedCheckpointOracle.mjs", import.meta.url), "utf8");
  assert.match(helper, /enrollUnsignedCheckpointOracleForHarness/);
  for (const path of ["../helpers/unsignedCheckpointOracle.mjs", "./helpers/checkpointProbeHostFault.mjs", "./helpers/checkpointProbeFixture.mjs"]) {
    const file = parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    function visit(n) { if (ts.isIdentifier(n)) assert.ok(!["sign", "createSign", "createPrivateKey", "generateKeyPair", "generateKeyPairSync"].includes(n.text), path); ts.forEachChild(n, visit); } visit(file);
  }
  for (const file of readdirSync(new URL("../helpers/", import.meta.url)).filter((s) => s.endsWith(".mjs") && s !== "unsignedCheckpointOracle.mjs"))
    assert.doesNotMatch(readFileSync(new URL(`../helpers/${file}`, import.meta.url), "utf8"), /enrollUnsignedCheckpointOracleForHarness/);
});
test("B3-Ba no outside runtime/MCP/history module imports the disconnected implementation", () => {
  for (const file of readdirSync(root).filter((s) => s.endsWith(".ts") && !Object.hasOwn(specs, s)))
    for (const name of Object.keys(specs)) assert.ok(!imports(ast(file)).some((v) => v.includes(name.slice(0, -3))), file);
});
test("B3-Ba boundary tests catch widened imports, clock aliases, signer and native loading", () => {
  for (const source of ["const D=Date; D.now()", "performance.now()", "randomUUID()", "setTimeout(f,1)", "new Event('x').timeStamp", "Math.random()",
    "import('./nativeBarFs.js')", "globalThis.crypto", "createPrivateKey(x)", "sign(null,b,k)"])
    assert.ok(violations(parse(source)).length, source);
  assert.deepEqual(imports(parse('import("./nativeBarAdmissionCheckpointProbe.js")')), ["./nativeBarAdmissionCheckpointProbe.js"]);
  const file = ast("nativeBarAdmissionCheckpointProbe.ts");
  assert.deepEqual(file.statements.filter(ts.isExportDeclaration).map((n) => n.getText()), []);
  // The probe taking the fixed oracle's owner mailbox by name, or one more contracts helper, must fail the exact allowlist.
  const text = readFileSync(new URL("nativeBarAdmissionCheckpointProbe.ts", root), "utf8");
  const mailbox = ["claimFixedMemory", "CheckpointOracleOwner"].join(""); // assembled, so only real consumers spell it out
  for (const mutation of [text.replace("import { claimSyntheticCheckpointProbe }", `import { claimSyntheticCheckpointProbe, ${mailbox} }`),
    text.replace("planCheckpointProbeBudget }", "planCheckpointProbeBudget, validateCheckpointOracleBinding }")]) {
    assert.notEqual(mutation, text); assert.equal(namedImportsExact("nativeBarAdmissionCheckpointProbe.ts", parse(mutation)), false);
  }
});
