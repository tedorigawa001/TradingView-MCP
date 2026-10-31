import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const source = read("../helpers/unsignedCohortRuntime.mjs");
const parse = s => ts.createSourceFile("runtime.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const privateNames = ["originalQualificationPolicy", "originalQualificationClock", "armOriginalQualificationTimer", "originalCohortTiming",
  "originalParentScope", "originalParentInvocation", "originalParentAllocation", "originalParentCaseReceipt", "originalParentWorkPlan", "originalParentWorkerQualification",
  "createOriginalParentOwner", "reserveOriginalParentSession", "currentOriginalParentSession", "syncOriginalParent", "describeOriginalParent", "pointOriginalParent", "checkpointOriginalParent",
  "stopOriginalParentSupervision", "clearOriginalParentTimer", "pointOriginalParentSupervision", "inspectOriginalParentSupervision", "checkOriginalParentSupervision",
  "armOriginalParentTimer", "selectOriginalParentPhase", "armOriginalParentOperation", "qualifyOriginalParentDispatch", "originalParentHelperPlan",
  "checkOriginalParentHelper", "releaseOriginalParentHelper", "runOriginalParentHelper",
  "faultOriginalParent", "discardOriginalParent", "discardOriginalParentBytes", "receiveOriginalParent", "endOriginalParent", "recordOriginalParentTerminal", "prepareOriginalParentCommand",
  "verifyOriginalHostClosure", "verifyOriginalNativeProfile",
  "refuse", "code", "stop", "checkpoint", "afterSync", "newQualificationState", "ownHandle", "closeOriginal", "closeRemaining", "identity", "sameIdentity", "safeStat", "fixedChain",
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
  const gates = { originalQualificationPolicy: "operational_profile", verifyOriginalHostClosure: "host_closure_qualification", verifyOriginalNativeProfile: "signature_qualification" };
  for (const [name, code] of Object.entries(gates)) {
    const fn = declarations.find(n => n.name.text === name); assert.equal(fn.parameters.length, 0); assert.equal(fn.body.statements.length, 1);
    assert.equal(fn.body.statements[0].getText(), `throw Error("cc4b3b_${code}_unavailable");`);
  }
  const dynamic = [], references = [], forbidden = new Set(["require", "createRequire", "eval", "Function", "Proxy", "Reflect", "Worker", "fetch", "WebSocket",
    "createUnsignedQualificationModel", "createPrivateKey", "createPublicKey", "sign", "verify", "generateKeyPair", "dlopen", "kill", "exit", "unlinkSync", "rmdirSync", "rmSync", "renameSync", "setInterval", "setImmediate",
    "globalThis", "global", "performance", "Intl", "Temporal", "AbortSignal", "Atomics"]);
  const ownerOf = n => { let owner = n; while (owner && !declarations.includes(owner)) owner = owner.parent; return owner?.name.text; };
  // Property names and object keys are labels; every other identifier occurrence reads the binding.
  const reads = n => !((ts.isPropertyAccessExpression(n.parent) || ts.isPropertyAssignment(n.parent)) && n.parent.name === n)
    && !(ts.isBindingElement(n.parent) && n.parent.propertyName === n) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n);
  const processFields = ["platform", "arch", "execArgv", "env", "umask", "getuid", "execPath", "version", "versions", "hrtime"];
  function walk(n) {
    // Wall time comes only from the clock's Date.now() and one-argument label formatting; no implicit current-time constructor.
    if (ts.isIdentifier(n) && reads(n) && n.text === "Date") {
      assert.equal(ownerOf(n), "originalQualificationClock"); const p = n.parent;
      assert.ok(ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === "now" && ts.isCallExpression(p.parent) && p.parent.expression === p && p.parent.arguments.length === 0
        || ts.isNewExpression(p) && p.expression === n && p.arguments?.length === 1, "Date use");
    }
    if (ts.isIdentifier(n) && reads(n) && n.text === "process") {
      const p = n.parent; assert.ok(ts.isPropertyAccessExpression(p) && p.expression === n && processFields.includes(p.name.text), "process use");
      if (p.name.text === "hrtime") {
        assert.equal(ownerOf(n), "originalQualificationClock");
        assert.ok(ts.isPropertyAccessExpression(p.parent) && p.parent.name.text === "bigint" && ts.isCallExpression(p.parent.parent) && p.parent.parent.arguments.length === 0, "hrtime use");
      }
    }
    // The fixed limit is the only policy input; an origin or deadline cannot come from it.
    if (ts.isIdentifier(n) && reads(n) && n.text === "policy") {
      assert.equal(ownerOf(n), "originalQualificationClock"); assert.ok(ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === "total_limit_ms", "policy use");
    }
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression))
      assert.equal(["Date", "now", "hrtime", "bigint", "uptime", "setTimeout", "clearTimeout"].includes(n.argumentExpression.text), false);
    if (ts.isIdentifier(n)) {
      const exitFact = n.text === "exit" && ownerOf(n) === "reserveOriginalParentSession" && ts.isPropertyAssignment(n.parent)
        && n.parent.name === n && n.parent.initializer.kind === ts.SyntaxKind.NullKeyword;
      assert.equal(forbidden.has(n.text) && !exitFact, false, n.text); if (n.text === "prepareOriginalQualification") references.push(n);
    }
    if (ts.isIdentifier(n) && ["setTimeout", "clearTimeout"].includes(n.text)) {
      let owner = n; while (owner && !declarations.includes(owner)) owner = owner.parent;
      assert.ok((n.text === "setTimeout" ? ["armOriginalQualificationTimer","armOriginalParentTimer"]
        : ["armOriginalQualificationTimer","armOriginalParentTimer","clearOriginalParentTimer"]).includes(owner?.name.text));
      assert.ok(ts.isCallExpression(n.parent) && n.parent.expression === n);
    }
    if (ts.isPropertyAccessExpression(n) && ["now", "bigint"].includes(n.name.text)) {
      let owner = n; while (owner && !declarations.includes(owner)) owner = owner.parent;
      assert.equal(owner?.name.text, "originalQualificationClock");
      assert.ok(["Date.now", "process.hrtime.bigint"].includes(n.getText()));
    }
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.notEqual(n.argumentExpression.text, "constructor");
    if (ts.isStringLiteralLike(n) && n.text === "constructor") assert.equal(ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent), false);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.equal(n.arguments.length, 1); assert.ok(ts.isStringLiteral(n.arguments[0])); dynamic.push(n.arguments[0].text);
    }
    if (ts.isCallExpression(n) && /[Oo]riginalParent/.test(ownerOf(n) ?? "")
      && (ts.isPropertyAccessExpression(n.expression) || ts.isElementAccessExpression(n.expression))) {
      const name = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression.argumentExpression;
      if (ts.isElementAccessExpression(n.expression)) assert.ok(ts.isStringLiteralLike(name));
      assert.equal(["write","on","once","emit","destroy","kill","unref","spawn","open","read","sign"].includes(name.text),false,name.text);
    }
    ts.forEachChild(n, walk);
  }
  walk(tree); assert.equal(references.length, 1);
  assert.deepEqual(dynamic, ["node:fs", "node:path", "node:url", "node:crypto", "typescript", "node:module", "./unsignedControllerData.mjs",
    "./unsignedCohortQualificationContracts.mjs", "./unsignedBuildPlan.mjs", "./unsignedCohortAssemblyModel.mjs", "./unsignedAdapterSupport.mjs",
    "./unsignedParentConnectionContracts.mjs", "node:child_process"]);
  assert.doesNotMatch(inspect.getText(), /process|import\(|prepareOriginal|retainedQualificationScopes/);
}
test("4-B3-B has a private composition root behind unchanged public and prerequisite seals", () => guard(source));
test("4-B3-B boundary detects exports, invocation, gate bypass, arbitrary modules and forbidden effects", () => {
  for (const variant of [source + "\nprepareOriginalQualification();", source.replace("async function prepareOriginalQualification", "export async function prepareOriginalQualification"),
    source.replace('throw Error("cc4b3b_operational_profile_unavailable");', "return {};"), source.replace('import("node:fs")', 'import(chosen)'),
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
test("B4-B2 parent effect-call guard also rejects literal-element listener and write forms", () => {
  const anchor = "c.decoder = createUnsignedProtocolDecoder();";
  for (const added of ['c.pipes.status.on("data", run);','c.pipes.status["on"]("data", run);','c.pipes.command["write"]("x");'])
    assert.throws(()=>guard(source.replace(anchor,added+anchor)));
});
test("4-B3-B tool transport has one fixed supervised spawn and no automatic signal or retry", () => {
  const root = parse(source).statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "prepareOriginalQualification");
  const tool = root.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "runOriginalTool").getText();
  assert.equal((tool.match(/\bspawn\(/g) ?? []).length, 1);
  assert.ok(tool.indexOf("allowedTool(s,") < tool.indexOf('import("node:child_process")'));
  // A regex keeps the repository-wide bare-command spawn scan from reading this assertion as a spawn call.
  assert.ok(tool.indexOf("armOriginalQualificationTimer(") < tool.search(/child = spawn\(/));
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
test("4-B3-C clocks and referenced timers have only the private fixed source callsites", () => {
  const root = parse(source).statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "prepareOriginalQualification");
  const functions = root.body.statements.filter(ts.isFunctionDeclaration), get = name => functions.find(n => n.name.text === name);
  assert.equal(get("originalQualificationClock").parameters.length, 0);
  const clock = get("originalQualificationClock").getText(), timer = get("armOriginalQualificationTimer").getText();
  assert.equal((clock.match(/process\.hrtime\.bigint\(\)/g) ?? []).length, 1);
  assert.equal((clock.match(/Date\.now\(\)/g) ?? []).length, 1);
  assert.equal((timer.match(/\bsetTimeout\(/g) ?? []).length, 1); assert.equal((timer.match(/\bclearTimeout\(/g) ?? []).length, 1);
  assert.doesNotMatch(timer, /\.unref\(|setInterval|Date|process\.|\.kill\(/);
  assert.match(get("buildAndQualify").getText(), /originalCohortTiming\(s, buildRef, namespaceRef\)/);
  for (const variant of [source.replace("return buildAndQualify();", "Date.now(); return buildAndQualify();"),
    source.replace("return buildAndQualify();", "setTimeout(() => {}, 1); return buildAndQualify();")]) assert.throws(() => guard(variant));
});
test("4-B3-C clock-source guard refuses implicit, aliased or policy-supplied time", () => {
  const timing = "const timing = originalCohortTiming(s, buildRef, namespaceRef);";
  for (const [from, to] of [["try { ms = Date.now(); }", "try { ms = new Date().getTime(); }"], [timing, "void new Date(0); " + timing],
    ["n = process.hrtime.bigint();", "n = BigInt(process.hrtime()[1]);"], [timing, "process.uptime(); " + timing], [timing, "const { now } = Date; now(); " + timing],
    [timing, "const { hrtime } = process; hrtime.bigint(); " + timing], [timing, 'globalThis["setTimeout"](() => {}, 1); ' + timing], [timing, 'queue["setTimeout"](() => {}, 1); ' + timing],
    ["const start = sample(), end", "const start = BigInt(policy.origin_ns ?? sample()), end"], [timing, "performance.now(); " + timing],
    [timing, "Intl.DateTimeFormat().format(); " + timing], [timing, "Temporal.Now.instant(); " + timing], [timing, "AbortSignal.timeout(1); " + timing]]) {
    assert.equal(source.split(from).length, 2, from); assert.throws(() => guard(source.replace(from, to)), to);
  }
});
test("4-B3-C every synchronous OS return is clock-checked before the next one", () => {
  // Lexical complement to the memory sweeps: close and umask restoration stay the cleanup lane, every other return checks the clock first.
  const root = parse(source).statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "prepareOriginalQualification").getText();
  const calls = [...root.matchAll(/\b(?:fs|stream|h\.fd|process)\.(\w+Sync|umask)\(/g)]; assert.ok(calls.length > 40);
  calls.forEach((m, i) => {
    if (m[1] === "closeSync" || root.startsWith("process.umask(previousMask)", m.index) || root.slice(m.index - 13, m.index) === "afterSync(s, ") return;
    assert.match(root.slice(m.index + m[0].length, calls[i + 1]?.index ?? root.length), /checkpoint\(s\)/, root.slice(m.index, m.index + 60));
  });
});
test("4-B3-C memory suites install every tripwire before importing the sealed runtime", () => {
  for (const [file, required] of [["./nativeBarAdmissionUnsignedQualificationClockConnection.test.mjs", ['[globalThis, "Date", ["now"]]', '[process, "hrtime", ["bigint"]]',
    'block(process, ["uptime"', 'block(performance, ["now"])', "Temporal.Now", 'block(process.hrtime, ["bigint"])', 'block(globalThis, ["fetch"']],
  ["./nativeBarAdmissionUnsignedQualificationConnection.test.mjs", ['blocked.push([{ Date: vmDate }, "Date"]', 'block(process.hrtime, ["bigint"])', 'block(globalThis, ["fetch"']]]) {
    const statements = parse(read(file)).statements, first = statements.findIndex(n => n.getText().includes('await import("../helpers/'));
    assert.ok(first > 0); const before = statements.slice(0, first).map(n => n.getText()).join("\n");
    assert.equal(statements.some(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text.startsWith("../helpers/")), false);
    assert.ok(before.includes("syncBuiltinESMExports();")); for (const text of required) assert.ok(before.includes(text), text);
    for (const n of statements.slice(first)) assert.doesNotMatch(n.getText(), /^(?:block|replace)\(|^blocked\.push/);
  }
});
