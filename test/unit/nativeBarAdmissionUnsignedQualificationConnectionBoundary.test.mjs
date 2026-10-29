import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const source = read("../helpers/unsignedCohortRuntime.mjs");
const parse = s => ts.createSourceFile("runtime.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const privateNames = ["originalQualificationPolicy", "originalQualificationClock", "armOriginalQualificationTimer", "verifyOriginalHostClosure", "verifyOriginalNativeProfile",
  "refuse", "code", "stop", "checkpoint", "newQualificationState", "ownHandle", "closeOriginal", "closeRemaining", "identity", "sameIdentity", "safeStat", "fixedChain",
  "metadataText", "parseMetadataListing", "qualifyMetadata", "qualifyChain", "createOriginalDirectory", "allowedTool", "runOriginalTool", "hash", "chargeHash", "readPinnedFile",
  "dependencyPaths", "typescriptPaths", "recheckTypeScriptInputs", "contained", "byteLengthRows", "directoryNames", "sourceFiles", "runtimeClosure", "discoverOriginalInputs", "snapshotInputs", "compilePlans",
  "buildOriginalMode", "snapshotArtifacts", "saveOriginalBuildRecord", "qualifyOriginalNamespace", "buildAndQualify"];
function guard(s) {
  const tree = parse(s); assert.equal(tree.parseDiagnostics.length, 0);
  assert.equal(tree.statements.length, 5);
  const [imports, inspect, execute, retained, root] = tree.statements;
  assert.equal(imports.getText(), 'import { flags, freeze } from "./unsignedControllerData.mjs";');
  assert.equal(inspect.name.text, "inspectUnsignedCohortAssembly"); assert.equal(execute.name.text, "executeUnsignedCohortAssembly");
  assert.deepEqual([inspect, execute].map(n => n.parameters.length), [0, 0]);
  assert.equal(execute.body.statements.length, 1); assert.equal(execute.body.statements[0].getText(), 'throw Error("cc4b2_execution_not_approved");');
  assert.equal(retained.getText(), "const retainedQualificationScopes = new Set();");
  assert.equal(root.name.text, "prepareOriginalQualification"); assert.equal(root.parameters.length, 0);
  assert.equal(root.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword), false);
  assert.equal(root.body.statements[0].getText(), "const policy = originalQualificationPolicy(), clock = originalQualificationClock();");
  const declarations = root.body.statements.filter(ts.isFunctionDeclaration);
  assert.deepEqual(declarations.map(n => n.name.text), privateNames);
  const gateCodes = ["operational_profile", "clock_connection", "timer_connection", "host_closure_qualification", "signature_qualification"];
  for (const [i, name] of privateNames.slice(0, 5).entries()) {
    const fn = declarations.find(n => n.name.text === name); assert.equal(fn.parameters.length, 0); assert.equal(fn.body.statements.length, 1);
    assert.equal(fn.body.statements[0].getText(), `throw Error("cc4b3b_${gateCodes[i]}_unavailable");`);
  }
  const dynamic = [], references = [], forbidden = new Set(["require", "createRequire", "eval", "Function", "Proxy", "Reflect", "Worker", "fetch", "WebSocket",
    "createUnsignedQualificationModel", "createPrivateKey", "createPublicKey", "sign", "verify", "generateKeyPair", "dlopen", "kill", "exit", "unlinkSync", "rmdirSync", "rmSync", "renameSync", "setTimeout", "setInterval", "setImmediate"]);
  function walk(n) {
    if (ts.isIdentifier(n)) { assert.equal(forbidden.has(n.text), false, n.text); if (n.text === "prepareOriginalQualification") references.push(n); }
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.notEqual(n.argumentExpression.text, "constructor");
    if (ts.isStringLiteralLike(n) && n.text === "constructor") assert.equal(ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent), false);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.equal(n.arguments.length, 1); assert.ok(ts.isStringLiteral(n.arguments[0])); dynamic.push(n.arguments[0].text);
    }
    ts.forEachChild(n, walk);
  }
  walk(tree); assert.equal(references.length, 1);
  assert.deepEqual(dynamic, ["node:fs", "node:path", "node:url", "node:crypto", "typescript", "node:module", "./unsignedControllerData.mjs",
    "./unsignedCohortQualificationContracts.mjs", "./unsignedBuildPlan.mjs", "node:child_process"]);
  assert.doesNotMatch(inspect.getText(), /process|import\(|prepareOriginal|retainedQualificationScopes/);
}
test("4-B3-B has a private composition root behind unchanged public and prerequisite seals", () => guard(source));
test("4-B3-B boundary detects exports, invocation, gate bypass, arbitrary modules and forbidden effects", () => {
  for (const variant of [source + "\nprepareOriginalQualification();", source.replace("async function prepareOriginalQualification", "export async function prepareOriginalQualification"),
    source.replace('throw Error("cc4b3b_clock_connection_unavailable");', "return {};"), source.replace('import("node:fs")', 'import(chosen)'),
    source.replace('import("node:fs")', 'import("node:net")'), source.replace("return buildAndQualify();", "process.kill(1); return buildAndQualify();"),
    source + "\nexport { retainedQualificationScopes };", source.replace("return buildAndQualify();", "eval(text); return buildAndQualify();"),
    source.replace("return buildAndQualify();", "fs.rmSync(root); return buildAndQualify();")]) assert.throws(() => guard(variant));
});
test("4-B3-B connection and token producers remain absent from production and launch entries", () => {
  for (const file of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(p => p.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${file}`), /prepareOriginalQualification|retainedQualificationScopes/);
  for (const file of ["../../package.json", "../../native/native_bar_fs/build_unsigned.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs", "../helpers/unsignedInertAdapters.mjs"])
    assert.doesNotMatch(read(file), /prepareOriginalQualification|retainedQualificationScopes/);
});
test("4-B3-B tool transport has one fixed supervised spawn and no automatic signal or retry", () => {
  const root = parse(source).statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "prepareOriginalQualification");
  const tool = root.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "runOriginalTool").getText();
  assert.equal((tool.match(/\bspawn\(/g) ?? []).length, 1);
  assert.ok(tool.indexOf("allowedTool(s,") < tool.indexOf('import("node:child_process")'));
  assert.ok(tool.indexOf("armOriginalQualificationTimer(") < tool.indexOf("child = spawn("));
  assert.doesNotMatch(tool, /\.kill\(|\.unref\(|\.destroy\(|execFile|spawnSync|maxBuffer|\btimeout:/);
  assert.match(tool, /stdio: \["ignore", "pipe", "pipe"\], shell: false, detached: true/);
});
test("4-B3-B tests substitute only extracted private declarations and never import an execution entry", () => {
  const testSource = read("./nativeBarAdmissionUnsignedQualificationConnection.test.mjs");
  assert.match(testSource, /vm\.runInNewContext/); assert.match(testSource, /filter\(ts\.isFunctionDeclaration\)/);
  assert.match(testSource, /await Promise\.resolve\(memoryChild\)/);
  assert.doesNotMatch(testSource, /process\.env\s*[.[]|npm run|await runtime\.prepare|build_unsigned\.mjs/);
  assert.ok(testSource.indexOf("syncBuiltinESMExports();") < testSource.indexOf('await import("../helpers/unsignedCohortRuntime'));
});
