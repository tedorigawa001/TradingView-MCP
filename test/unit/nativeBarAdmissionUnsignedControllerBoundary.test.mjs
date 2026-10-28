import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ast = (s) => ts.createSourceFile("memory.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const walk = (n, f) => { f(n); ts.forEachChild(n, (child) => walk(child, f)); };
const specifications = {
  Data: { imports: ["node:crypto:createHash", "zod:z"], exports: ["uint", "digestSchema", "label", "code", "count", "canonical", "sha", "digest", "byteLength", "freeze", "refuse", "flags", "copyData", "parse", "decode", "descriptor", "resourcesSchema", "traceSchema", "LIMITS"] },
  Observation: { imports: ["zod:z", "./jointUnsignedAcceptanceContracts.mjs:describeUnsignedAcceptanceRun,describeUnsignedFixture",
    "./unsignedControllerData.mjs:uint,digestSchema as hash,code,label,count,parse,canonical,digest,byteLength,freeze,flags,refuse,LIMITS"],
    exports: ["observationSchema", "validateUnsignedControllerObservation", "describeUnsignedControllerLimitations", "assessUnsignedControllerAssertions"] },
  Contracts: { imports: ["zod:z", "./jointUnsignedAcceptanceContracts.mjs:describeUnsignedFixture", "./unsignedWorkerConfiguration.mjs:validateUnsignedWorkerConfiguration",
    "./unsignedControllerObservation.mjs:validateUnsignedControllerObservation",
    "./unsignedControllerData.mjs:uint,label,code,digestSchema as hash,count,parse,copyData,canonical,digest,byteLength,decode,resourcesSchema,traceSchema,freeze,flags,refuse,LIMITS"],
    exports: ["createUnsignedControllerProtocolModel", "describeUnsignedControllerCapacity", "createUnsignedControllerWindowModel"] },
  Evidence: { imports: ["zod:z", "./jointUnsignedAcceptanceContracts.mjs:describeUnsignedFixture,describeUnsignedAcceptanceRun", "./unsignedControllerContracts.mjs:createUnsignedControllerProtocolModel",
    "./unsignedControllerObservation.mjs:observationSchema,validateUnsignedControllerObservation,assessUnsignedControllerAssertions",
    "./unsignedControllerData.mjs:uint,code,label,digestSchema as hash,count,parse,canonical,digest,sha,byteLength,descriptor,decode,resourcesSchema,traceSchema,freeze,flags,refuse,LIMITS"],
    exports: ["createUnsignedControllerEvidenceModel", "createUnsignedControllerCohortModel", "inspectUnsignedControllerEvidence", "describeUnsignedControllerSerializationCapacity"] },
};
const forbidden = new Set(["process", "globalThis", "global", "crypto", "Date", "performance", "Intl", "SharedArrayBuffer", "Atomics", "WebAssembly", "require", "createRequire",
  "dlopen", "eval", "Function", "fetch", "Worker", "createPrivateKey", "createPublicKey", "sign", "spawn", "spawnSync", "exec", "execSync", "fork",
  "openSync", "readFileSync", "writeFileSync", "mkdirSync", "mkdtempSync", "unlinkSync", "rmdirSync", "rmSync", "renameSync", "setTimeout", "setImmediate", "setInterval"]);
function guard(s, expected) {
  const tree = ast(s);
  const imports = tree.statements.filter(ts.isImportDeclaration).map((n) => {
    assert.equal(n.importClause?.name, undefined); assert.ok(ts.isNamedImports(n.importClause?.namedBindings));
    return n.moduleSpecifier.text + ":" + n.importClause.namedBindings.elements.map((e) => e.propertyName ? `${e.propertyName.text} as ${e.name.text}` : e.name.text).join(",");
  });
  assert.deepEqual(imports, expected.imports);
  const exports = tree.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap((n) => ts.isVariableStatement(n) ? n.declarationList.declarations.map((d) => d.name.text) : [n.name?.text]);
  assert.deepEqual(exports, expected.exports);
  walk(tree, (n) => {
    if (ts.isIdentifier(n)) assert.equal(forbidden.has(n.text), false, n.text);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression))
      assert.equal(forbidden.has(n.argumentExpression.text) || n.argumentExpression.text === "constructor", false);
  });
}
for (const [name, spec] of Object.entries(specifications)) {
  const source = read(`../helpers/unsignedController${name}.mjs`);
  test(`4-A ${name} exports only pure contracts with exact dependencies`, () => guard(source, spec));
  test(`4-A ${name} guard catches executable/time/key/filesystem mutations`, () => {
    for (const mutation of ['\nimport("node:fs");', '\nprocess.cwd();', '\nnew Date();', '\nspawn("worker");',
      '\ncreatePrivateKey(k);', '\ncrypto.subtle.sign(a, k, b);', '\nwriteFileSync(p, b);', '\nx["constructor"]("return 1")();',
      '\nexport function execute() {}', '\nsetTimeout(f, 1);']) assert.throws(() => guard(source + mutation, spec));
  });
}
test("4-A cannot be reached from product, MCP, build script or operational entry", () => {
  for (const path of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter((p) => p.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${path}`), /unsignedController(?:Data|Contracts|Observation|Evidence)/, path);
  assert.doesNotMatch(JSON.stringify(JSON.parse(read("../../package.json")).scripts), /unsignedController|UnsignedController/);
  for (const path of ["../../native/native_bar_fs/build_unsigned.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs", "../helpers/unsignedInertAdapters.mjs"])
    assert.doesNotMatch(read(path), /unsignedController(?:Data|Contracts|Observation|Evidence)/);
  const inert = ast(read("../helpers/unsignedInertAdapters.mjs"));
  const execute = inert.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "executeUnsignedAdapters");
  assert.equal(execute.body.statements.length, 1); assert.match(execute.body.statements[0].getText(), /throw Error\("cc1b2_execution_not_approved"\)/);
});
test("4-A memory suite installs effect tripwires before loading the new modules", () => {
  const s = read("./nativeBarAdmissionUnsignedController.test.mjs");
  for (const fragment of ['block(child, ["spawn"', 'block(workers, ["Worker"])', 'block(crypto, ["sign", "createSign"', 'block(process, ["dlopen"])',
    'block(fsp, mutations)', 'assert.deepEqual(effects, [])', 'roots.push(...roots.map((s) => fs.realpathSync(s) + sep))']) assert.ok(s.includes(fragment), fragment);
  assert.ok(s.indexOf("syncBuiltinESMExports();") < s.indexOf('await import("../helpers/unsignedController'));
  assert.doesNotMatch(s, /fixedMemoryCheckpointOracle|executeUnsignedAdapters|import\([^)]*build\//);
});
