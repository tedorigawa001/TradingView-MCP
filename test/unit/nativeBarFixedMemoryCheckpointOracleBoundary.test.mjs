import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const helper = new URL("../helpers/fixedMemoryCheckpointOracle.mjs", import.meta.url);
const text = readFileSync(helper, "utf8");
const ast = (s) => ts.createSourceFile("signed-helper.mjs", s, ts.ScriptTarget.Latest, true);
const parse = ast(text);
function names(file, predicate) { const out = []; function visit(n) { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); } visit(file); return out; }
// Any reference to a key exporter counts, not only a direct call: `k.export.call(...)`, `(k.export)(...)` and `k["export"]` included.
const keyExports = (tree) => names(tree, (n) => ts.isPropertyAccessExpression(n) && /^export/.test(n.name.text)
  || ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && /^export/.test(n.argumentExpression.text)
  || ts.isIdentifier(n) && n.text === "exportJwk" && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n));
const written = (n) => ts.isBinaryExpression(n.parent) && n.parent.left === n
  && n.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  || ts.isDeleteExpression(n.parent) || (ts.isPrefixUnaryExpression(n.parent) || ts.isPostfixUnaryExpression(n.parent))
    && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.parent.operator);
// The build route runs from the first C-C selector statement through the `base` declaration.
function routeOf(tree) {
  const s = tree.statements, first = s.findIndex((n) => n.getText().includes("NATIVE_BAR_B3CC_MODE"));
  const last = s.findIndex((n) => ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText() === "base"));
  return first >= 0 && last >= first ? s.slice(first, last + 1) : [];
}
// The environment is only read, only inside the route, and only as `process.env.NATIVE_BAR_*` or `process.env[key]`.
function envViolations(tree) {
  const route = routeOf(tree), inRoute = (n) => route.some((s) => s.pos <= n.pos && n.end <= s.end), out = [];
  for (const n of names(tree, (n) => ts.isPropertyAccessExpression(n) && n.name.text === "env")) {
    const use = n.parent, read = ts.isPropertyAccessExpression(use) && use.expression === n && /^NATIVE_BAR_/.test(use.name.text)
      || ts.isElementAccessExpression(use) && use.expression === n && ts.isIdentifier(use.argumentExpression);
    if (n.expression.getText() !== "process" || !inRoute(n) || !read || written(use)) out.push(use.getText());
  }
  for (const n of names(tree, (n) => ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === "env"
    || (ts.isBindingElement(n) || ts.isShorthandPropertyAssignment(n)) && (n.propertyName ?? n.name).getText() === "env")) out.push(n.getText());
  return out;
}
test("B3-Bb signing is confined to the fixed public-vector helper and canonical checkpoint domain", () => {
  const imports = parse.statements.filter(ts.isImportDeclaration);
  assert.deepEqual(imports.map((n) => n.moduleSpecifier.text), ["node:crypto", "zod"]);
  assert.deepEqual(imports[0].importClause.namedBindings.elements.map((e) => e.name.text), ["createHash", "createPrivateKey", "sign"]);
  const keyCalls = names(parse, (n) => ts.isCallExpression(n) && n.expression.getText() === "createPrivateKey");
  assert.equal(keyCalls.length, 1);
  assert.match(keyCalls[0].getText(), /302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60/);
  assert.ok(text.indexOf("claimFixedMemoryCheckpointOracleOwner(originalOwnerGrant)") < keyCalls[0].getStart());
  assert.ok(text.indexOf("public_test_key_required") < keyCalls[0].getStart());
  const signCalls = names(parse, (n) => ts.isCallExpression(n) && n.expression.getText() === "sign");
  assert.equal(signCalls.length, 1); assert.match(signCalls[0].getText(), /domain: "native-bar-eb-read-checkpoint-v1", envelope/);
  assert.equal(signCalls[0].arguments[2].getText(), "privateKey");
});
const bad = new Set(["writeFile", "writeFileSync", "readFile", "readFileSync", "openSync", "mkdir", "unlink", "rename", "fetch", "WebSocket", "spawn", "exec",
  "generateKeyPair", "generateKeyPairSync", "randomBytes", "createSign", "eval", "Function", "createReadStream", "createWriteStream", "ReadStream", "WriteStream",
  "Utf8Stream", "openAsBlob", "glob", "globSync", "statfs", "statfsSync", "readdir", "readdirSync", "opendir", "stat", "statSync", "lstat", "access", "existsSync",
  "watch", "watchFile", "mkdtemp", "mkdtempDisposable", "mkdtempDisposableSync", "getBuiltinModule", "binding", "_linkedBinding", "dlopen", "execve",
  "loadEnvFile", "kill", "Worker", "fork", "execFile", "require", "createRequire", "globalThis", "Reflect", "Proxy", "getOwnPropertySymbols", "exportJwk",
  "webcrypto", "subtle"]);
function storageBoundary(source) {
  const tree = ast(source); assert.equal(tree.parseDiagnostics.length, 0);
  assert.deepEqual(names(tree, (n) => ts.isIdentifier(n) && bad.has(n.text)).map((n) => n.text), []);
  const dynamic = names(tree, (n) => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword).map((n) => n.arguments[0].getText());
  assert.deepEqual(dynamic, ['new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url)', 'new URL(`${base}nativeBarAdmissionCheckpointContracts.js`, import.meta.url)', 'new URL(`${base}nativeBarEvidence.js`, import.meta.url)']);
  assert.equal(keyExports(tree).length, 0);
  // `process` is only the route's environment read, so no `process.getBuiltinModule`, `process.binding` or alias can reach another module.
  for (const n of names(tree, (n) => ts.isIdentifier(n) && n.text === "process"))
    assert.ok(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.name.text === "env", n.parent.getText());
  assert.deepEqual(envViolations(tree), []);
  assert.deepEqual(names(tree, (n) => ts.isElementAccessExpression(n) && !ts.isNumericLiteral(n.argumentExpression) && n.expression.getText() !== "process.env")
    .map((n) => n.getText()), []);
}
test("B3-Bb helper cannot access storage, network, subprocesses, random key generation or caller signing callbacks", () => storageBoundary(text));
test("B3-Bb no runtime source imports the signer; the original-owner mailbox has exactly one fixed helper consumer", () => {
  for (const name of readdirSync(new URL("../../src/", import.meta.url)).filter((s) => s.endsWith(".ts"))) {
    const source = readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fixedMemoryCheckpointOracle|createPrivateKey|generateKeyPair|from ["'].*test\/helpers/);
  }
  for (const name of readdirSync(new URL("../helpers/", import.meta.url)).filter((s) => s.endsWith(".mjs") && s !== "fixedMemoryCheckpointOracle.mjs"))
    assert.doesNotMatch(readFileSync(new URL(`../helpers/${name}`, import.meta.url), "utf8"), /claimFixedMemoryCheckpointOracleOwner/);
  // Runtime sources and other tests cannot reach the mailbox either: only the registry defines it.
  for (const name of readdirSync(new URL("../../src/", import.meta.url)).filter((s) => s.endsWith(".ts") && s !== "nativeBarAdmissionOracleRegistry.ts"))
    assert.doesNotMatch(readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8"), /claimFixedMemoryCheckpointOracleOwner/, name);
  for (const dir of ["./", "./helpers/"]) for (const name of readdirSync(new URL(dir, import.meta.url)).filter((s) => s.endsWith(".mjs") && s !== "nativeBarFixedMemoryCheckpointOracleBoundary.test.mjs"))
    assert.doesNotMatch(readFileSync(new URL(`${dir}${name}`, import.meta.url), "utf8"), /claimFixedMemoryCheckpointOracleOwner/, `${dir}${name}`);
});
test("B3-Bb source boundary assertions detect an added key exporter, generator and storage call", () => {
  for (const source of ["generateKeyPairSync('ed25519')", "writeFileSync(path,key)", "fetch(url)"])
    assert.ok(names(ast(source), (n) => ts.isIdentifier(n) && ["generateKeyPairSync", "writeFileSync", "fetch"].includes(n.text)).length);
  for (const source of ["privateKey.export({format:'pem'})", 'privateKey["export"]({format:"der"})', "privateKey.export.call(privateKey, {})",
    "(privateKey.export)({})", "privateKey[`export`]({})", "handle.exportJwk({}, false)"]) assert.equal(keyExports(ast(source)).length, 1, source);
  for (const source of [
    text + '\nprocess.getBuiltinModule("node:fs").globSync("*");', text + '\nprocess["getBuiltinModule"]("node:fs");', text + "\nconst host = process;",
    text + '\nglobalThis.process.env.NATIVE_BAR_B3CC_MODE = "normal";', text + "\nnew Worker(url);", text + '\nfs.openAsBlob("package.json");',
    text + '\nfs.statfsSync(".");', text + "\nprivateKey.export.call(privateKey, {});", text + "\nconst { env } = process;",
    text.replace("const base =", 'process.env["NATIVE_BAR_B3CC_MODE"] ??= "normal";\nconst base ='),
    text.replace("const base =", 'process.env.NATIVE_BAR_B3CC_MODE ??= "normal";\nconst base ='),
    text + "\nconst late = process.env.NATIVE_BAR_B3CC_MODE;", text + '\nconst key = state["tip_hash"];',
  ]) assert.throws(() => storageBoundary(source), undefined, source.slice(text.length - 40));
});

function c0Boundary(source) {
  const tree = ast(source); assert.equal(tree.parseDiagnostics.length, 0);
  assert.equal(keyExports(tree).length, 0);
  assert.equal(names(tree, (n) => ts.isExportDeclaration(n) || ts.isExportAssignment(n)).length, 0);
  const exported = tree.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
  assert.deepEqual(exported.map((n) => n.name?.text), ["enrollFixedMemoryCheckpointOracle", "enrollFixedMemoryCheckpointOracleC0Only"]);
  const legacy = exported[0], single = exported[1]; assert.equal(legacy.parameters.length, 3); assert.equal(single.parameters.length, 2);
  assert.equal(legacy.body.statements.length, 1); assert.equal(single.body.statements.length, 2);
  assert.equal(legacy.body.statements[0].getText(), "return enrollFixedMemoryOwner(originalOwnerGrant, inventedState, options, false);");
  assert.equal(single.body.statements[0].getText(), 'if (arguments.length !== 2) throw Error("b3bb_c0_only_arguments");');
  assert.equal(single.body.statements[1].getText(), "return enrollFixedMemoryOwner(originalOwnerGrant, inventedState, {}, true);");
  const enrollments = names(tree, (n) => ts.isCallExpression(n) && n.expression.getText() === "enrollFixedMemoryOwner");
  assert.equal(enrollments.length, 2);
  assert.equal(names(tree, (n) => ts.isCallExpression(n) && n.expression.getText() === "claimFixedMemoryCheckpointOracleOwner").length, 1);
  const factory = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "enrollFixedMemoryOwner");
  const deliver = names(factory, (n) => ts.isFunctionDeclaration(n) && n.name?.text === "deliver")[0];
  const gate = deliver.body.statements[0]; assert.ok(ts.isIfStatement(gate)); assert.equal(gate.expression.getText(), "c0Only");
  // Phase first, then the spent attempt, then registry liveness: all before the cancellation check, the clock and the sign site.
  assert.deepEqual(gate.thenStatement.statements.map((n) => n.getText()), [
    'const refusal = packet.request.phase !== "c0" ? "phase" : c0Attempted ? "repeat" : null;', "c0Attempted = true;",
    'if (refusal) { refuseC0(packet, refusal, "oracle_rejected"); return; }',
    'try { channel.check(); } catch { refuseC0(packet, "unavailable", "oracle_unavailable"); return; }']);
  assert.equal(deliver.body.statements[1].getText(),
    'if (channel.cancelled(packet.token)) { if (c0Only) refuseC0(packet, "cancelled", "oracle_cancelled"); else channel.reject(packet.token, "oracle_cancelled"); return; }');
  const refuse = factory.body.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === "refuseC0");
  assert.equal(refuse.length, 1); assert.equal(refuse[0].body.getText(), "{ c0Refusal = reason; channel.reject(packet.token, failure); close(); }");
  assert.equal(names(tree, (n) => ts.isCallExpression(n) && n.expression.getText() === "refuseC0").length, 3);
  const signCalls = names(tree, (n) => ts.isCallExpression(n) && n.expression.getText() === "sign"); assert.equal(signCalls.length, 1);
  const keyCalls = names(tree, (n) => ts.isCallExpression(n) && n.expression.getText() === "createPrivateKey"); assert.equal(keyCalls.length, 1);
  assert.ok(gate.end < signCalls[0].getStart());
  const signAt = deliver.body.statements.findIndex((n) => n.pos <= signCalls[0].pos && signCalls[0].end <= n.end);
  assert.equal(deliver.body.statements[signAt + 1]?.getText(), "if (c0Only) privateKey = undefined;");
  assert.equal(names(factory, (n) => ts.isExpressionStatement(n) && n.getText() === 'c0Refusal ??= "delivery_failed";').length, 1);
  const initialState = names(factory, (n) => ts.isIfStatement(n) && n.expression.getText() === 'c0Only && state.sequence !== "1"');
  assert.equal(initialState.length, 1); assert.ok(initialState[0].end < keyCalls[0].getStart());
  const last = factory.body.statements.at(-1); assert.equal(last.getText(), "return c0Only ? Object.freeze({ close, loseState: close, describe: owner.describe }) : owner;");
  return deliver.getText();
}
const phaseGate = 'packet.request.phase !== "c0" ? "phase" : c0Attempted ? "repeat" : null';
const liveness = 'try { channel.check(); } catch { refuseC0(packet, "unavailable", "oracle_unavailable"); return; }';
test("4-B1 fixed wrappers share one original-owner/key/sign site and reject before signing", () => c0Boundary(text));
test("4-B1 boundary detects public policy overrides, phase/attempt/liveness guard removal and key/sign duplication", () => {
  for (const source of [
    text.replace("inventedState, {}, true)", "inventedState, {}, false)"),
    text.replace(phaseGate, 'c0Attempted ? "repeat" : null'),
    text.replace(phaseGate, 'packet.request.phase !== "c0" ? "phase" : null'),
    text.replace("c0Attempted = true;", "c0Attempted = false;"),
    text.replace('refuseC0(packet, refusal, "oracle_rejected"); return;', 'refuseC0(packet, refusal, "oracle_rejected");'),
    text.replace("c0Refusal = reason; channel.reject(packet.token, failure); close();", "c0Refusal = reason; channel.reject(packet.token, failure);"),
    text.replace(liveness, ""),
    text.replace("if (c0Only) privateKey = undefined;", ""),
    text.replace('if (c0Only) refuseC0(packet, "cancelled", "oracle_cancelled"); else ', ""),
    text.replace("options, false);", "options, true);"),
    text.replace('if (c0Only && state.sequence !== "1") throw Error("b3bb_c0_initial_state");', ""),
    text + "\nexport function alternate() {}", text + "\nsign(null, bytes, key);", text + "\ncreatePrivateKey(key);",
    text + "\nclaimFixedMemoryCheckpointOracleOwner(grant);",
    text + "\nexport { enrollFixedMemoryOwner };", text + "\nexport default enrollFixedMemoryOwner;",
    text + '\nprivateKey["export"]({ type: "pkcs8", format: "der" });', text + "\nprivateKey.export.call(privateKey, {});",
  ]) assert.throws(() => c0Boundary(source));
});
function deliveryModel(source, live = true) {
  const tree = ast(source), pick = (name) => names(tree, (n) => ts.isFunctionDeclaration(n) && n.name?.text === name)[0]?.getText() ?? "";
  const counts = { signs: 0, rejected: [], responded: 0, closed: 0 };
  const context = { c0Only: true, c0Attempted: false, c0Refusal: null, known: true, closed: false, mode: "normal", signed: 0n,
    state: { sequence: "1", tip_hash: "a".repeat(64) }, privateKey: {}, replay: undefined, Buffer, HostDate: Date,
    wallNow: () => 1793232000000, iso: Date.prototype.toISOString, canonical: JSON.stringify,
    close: () => { counts.closed++; context.closed = true; },
    sign: () => { counts.signs++; return Buffer.alloc(64); },
    channel: { fixed: { pins: {} }, check: () => { if (!live) throw Error("b3ba_oracle_unavailable"); }, cancelled: () => false,
      reject: (_token, code) => counts.rejected.push(code), respond: () => { counts.responded++; } },
  };
  vm.createContext(context); vm.runInContext(`${pick("refuseC0")}\n${pick("deliver")}`, context);
  return { counts, context, run(phase) { context.packet = { token: {}, request: { phase, challenge: "invented" } }; vm.runInContext("deliver(packet)", context); } };
}
test("4-B1 extracted delivery model refuses C1-first, a repeated C0 and a revoked registry before the sign stub", () => {
  const first = deliveryModel(text); first.run("c1"); assert.equal(first.counts.signs, 0); assert.deepEqual(first.counts.rejected, ["oracle_rejected"]);
  assert.equal(first.context.c0Refusal, "phase"); assert.equal(first.counts.closed, 1);
  const second = deliveryModel(text); second.run("c0"); assert.equal(second.context.privateKey, undefined); second.run("c0");
  assert.equal(second.counts.signs, 1); assert.equal(second.counts.responded, 1); assert.deepEqual(second.counts.rejected, ["oracle_rejected"]);
  assert.equal(second.context.c0Refusal, "repeat");
  const revoked = deliveryModel(text, false); revoked.run("c0");
  assert.equal(revoked.counts.signs, 0); assert.deepEqual(revoked.counts.rejected, ["oracle_unavailable"]); assert.equal(revoked.context.c0Refusal, "unavailable");
  assert.equal(revoked.context.c0Attempted, true); assert.equal(revoked.counts.closed, 1);
});
test("4-B1 extracted behavioral checks detect removal of the phase, spent-attempt, liveness or key-release step", () => {
  const noPhase = deliveryModel(text.replace(phaseGate, 'c0Attempted ? "repeat" : null')); noPhase.run("c1");
  assert.equal(noPhase.counts.signs, 1);
  const noSpent = deliveryModel(text.replace(phaseGate, 'packet.request.phase !== "c0" ? "phase" : null')); noSpent.run("c0"); noSpent.run("c0");
  assert.equal(noSpent.counts.signs, 2);
  const noLiveness = deliveryModel(text.replace(liveness, ""), false); noLiveness.run("c0");
  assert.equal(noLiveness.counts.signs, 1);
  const kept = deliveryModel(text.replace("if (c0Only) privateKey = undefined;", "")); kept.run("c0");
  assert.notEqual(kept.context.privateKey, undefined);
});
test("4-B1 remains absent from runtime, worker entry and package execution scripts", () => {
  const entry = "enrollFixedMemoryCheckpointOracleC0Only";
  for (const name of readdirSync(new URL("../../src/", import.meta.url)).filter((s) => s.endsWith(".ts")))
    assert.equal(readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8").includes(entry), false, name);
  for (const path of ["../../native/native_bar_fs/test_unsigned_worker.mjs", "../helpers/unsignedInertAdapters.mjs", "../../package.json"])
    assert.equal(readFileSync(new URL(path, import.meta.url), "utf8").includes(entry), false, path);
});

const routeFiles = [["../helpers/fixedMemoryCheckpointOracle.mjs", "../../"], ["./helpers/checkpointProbeFixture.mjs", "../../../"],
  ["./nativeBarFixedMemoryCheckpointOracleC0Only.test.mjs", "../../"], ["./nativeBarFixedMemoryCheckpointOracle.test.mjs", "../../"]];
function routeCheck(source, up) {
  const tree = ast(source), route = routeOf(tree); assert.ok(route.length >= 2);
  const at = (env) => vm.runInNewContext(`${route.map((n) => n.getText()).join("\n")}\n;base;`, { process: { env }, assert });
  assert.equal(at({}), `${up}build/`);
  for (const mode of ["normal", "ubsan"]) assert.equal(at({ NATIVE_BAR_B3CC_MODE: mode }), `${up}build/b3cc-validation/${mode}/`);
  assert.equal(at({ NATIVE_BAR_B3BB_ISOLATED_TEST: "1" }), `${up}build/b3bb-validation/`);
  assert.equal(at({ NATIVE_BAR_B3BC_ISOLATED_TEST: "1" }), `${up}build/b3bc-validation/`);
  for (const env of [{ NATIVE_BAR_B3CC_MODE: "" }, { NATIVE_BAR_B3CC_MODE: "../normal" }, { NATIVE_BAR_B3CC_MODE: "asan" },
    ...["B2B", "B3BA", "B3BB", "B3BC", "B3CA"].map((k) => ({ NATIVE_BAR_B3CC_MODE: "normal", [`NATIVE_BAR_${k}_ISOLATED_TEST`]: "1" }))])
    assert.throws(() => at(env), /b3cc_test_mode_refused/, JSON.stringify(env));
  assert.deepEqual(envViolations(tree), []);
}
test("4-B1 every importer selects the same build route and refuses invalid or conflicting C-C modes", () => {
  for (const [path, up] of routeFiles) routeCheck(readFileSync(new URL(path, import.meta.url), "utf8"), up);
  const memory = ast(readFileSync(new URL("./nativeBarFixedMemoryCheckpointOracleC0Only.test.mjs", import.meta.url), "utf8"));
  const imports = names(memory, (n) => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword).map((n) => n.arguments[0].getText());
  assert.ok(imports.includes('new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url)'));
  assert.ok(imports.includes('new URL(`${base}nativeBarAdmissionCheckpointProbe.js`, import.meta.url)'));
  const built = names(memory, (n) => ts.isVariableDeclaration(n) && n.name.getText() === "built")[0];
  assert.equal(built.initializer.getText(), "fileURLToPath(new URL(base, import.meta.url))");
});
test("4-B1 route guard detects a silent fallback, a dropped refusal and an environment write", () => {
  const fixture = readFileSync(new URL("./helpers/checkpointProbeFixture.mjs", import.meta.url), "utf8");
  const legacy = readFileSync(new URL("./nativeBarFixedMemoryCheckpointOracle.test.mjs", import.meta.url), "utf8");
  const memory = readFileSync(new URL("./nativeBarFixedMemoryCheckpointOracleC0Only.test.mjs", import.meta.url), "utf8");
  for (const [source, up] of [
    [fixture.replace('throw Error("b3cc_test_mode_refused")', "void 0"), "../../../"],
    [fixture.replace("cc1Mode !== undefined ? `../../../build/b3cc-validation/${cc1Mode}/`", 'cc1Mode !== undefined ? "../../../build/"'), "../../../"],
    [legacy.replace('"b3cc_test_mode_refused"', '"refused"').replace("&& ![", "&& true || !["), "../../"],
    [memory.replace("const mode =", 'process.env["NATIVE_BAR_B3CC_MODE"] ??= "normal";\nconst mode ='), "../../"],
    [memory.replace("const mode =", 'process.env.NATIVE_BAR_B3CC_MODE ??= "normal";\nconst mode ='), "../../"],
    [`${memory}\ndelete process.env.NATIVE_BAR_B3CC_MODE;`, "../../"],
  ]) assert.throws(() => routeCheck(source, up));
});
