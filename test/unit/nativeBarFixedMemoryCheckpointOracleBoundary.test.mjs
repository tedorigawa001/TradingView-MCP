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
const keyExports = (tree) => names(tree, (n) => ts.isCallExpression(n) && (
  ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "export"
  || ts.isElementAccessExpression(n.expression) && ts.isStringLiteral(n.expression.argumentExpression) && n.expression.argumentExpression.text === "export"));
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
test("B3-Bb helper cannot access storage, network, subprocesses, random key generation or caller signing callbacks", () => {
  const bad = new Set(["writeFile", "writeFileSync", "readFileSync", "openSync", "mkdir", "unlink", "rename", "fetch", "WebSocket", "spawn", "exec", "generateKeyPair", "generateKeyPairSync", "randomBytes", "createSign", "eval", "Function"]);
  assert.deepEqual(names(parse, (n) => ts.isIdentifier(n) && bad.has(n.text)).map((n) => n.text), []);
  const dynamic = names(parse, (n) => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword).map((n) => n.arguments[0].getText());
  assert.deepEqual(dynamic, ['new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url)', 'new URL(`${base}nativeBarAdmissionCheckpointContracts.js`, import.meta.url)', 'new URL(`${base}nativeBarEvidence.js`, import.meta.url)']);
  assert.equal(keyExports(parse).length, 0);
});
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
  for (const source of ["privateKey.export({format:'pem'})", 'privateKey["export"]({format:"der"})']) assert.equal(keyExports(ast(source)).length, 1);
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
  assert.equal(gate.thenStatement.statements[0].declarationList.declarations[0].initializer.getText(), 'c0Attempted || packet.request.phase !== "c0"');
  assert.equal(gate.thenStatement.statements[1].getText(), "c0Attempted = true;");
  const reject = gate.thenStatement.statements[2]; assert.equal(reject.expression.getText(), "refused");
  assert.equal(reject.thenStatement.getText(), '{ channel.reject(packet.token, "oracle_rejected"); close(); return; }');
  const signCalls = names(tree, (n) => ts.isCallExpression(n) && n.expression.getText() === "sign"); assert.equal(signCalls.length, 1);
  const keyCalls = names(tree, (n) => ts.isCallExpression(n) && n.expression.getText() === "createPrivateKey"); assert.equal(keyCalls.length, 1);
  assert.ok(gate.end < signCalls[0].getStart());
  const initialState = names(factory, (n) => ts.isIfStatement(n) && n.expression.getText() === 'c0Only && state.sequence !== "1"');
  assert.equal(initialState.length, 1); assert.ok(initialState[0].end < keyCalls[0].getStart());
  const last = factory.body.statements.at(-1); assert.equal(last.getText(), "return c0Only ? Object.freeze({ close, loseState: close, describe: owner.describe }) : owner;");
  return deliver.getText();
}
test("4-B1 fixed wrappers share one original-owner/key/sign site and reject before signing", () => c0Boundary(text));
test("4-B1 boundary detects public policy overrides, phase/attempt guard removal and key/sign duplication", () => {
  for (const source of [
    text.replace("inventedState, {}, true)", "inventedState, {}, false)"),
    text.replace('c0Attempted || packet.request.phase !== "c0"', "c0Attempted"),
    text.replace('c0Attempted || packet.request.phase !== "c0"', 'packet.request.phase !== "c0"'),
    text.replace("c0Attempted = true;", "c0Attempted = false;"),
    text.replace('channel.reject(packet.token, "oracle_rejected"); close(); return;', 'channel.reject(packet.token, "oracle_rejected"); close();'),
    text.replace("options, false);", "options, true);"),
    text.replace('if (c0Only && state.sequence !== "1") throw Error("b3bb_c0_initial_state");', ""),
    text + "\nexport function alternate() {}", text + "\nsign(null, bytes, key);", text + "\ncreatePrivateKey(key);",
    text + "\nclaimFixedMemoryCheckpointOracleOwner(grant);",
    text + "\nexport { enrollFixedMemoryOwner };", text + "\nexport default enrollFixedMemoryOwner;",
    text + '\nprivateKey["export"]({ type: "pkcs8", format: "der" });',
  ]) assert.throws(() => c0Boundary(source));
});
function deliveryModel(source) {
  const tree = ast(source), deliver = names(tree, (n) => ts.isFunctionDeclaration(n) && n.name?.text === "deliver")[0].getText();
  const counts = { signs: 0, rejected: [], responded: 0, closed: 0 };
  const context = { c0Only: true, c0Attempted: false, known: true, closed: false, mode: "normal", signed: 0n,
    state: { sequence: "1", tip_hash: "a".repeat(64) }, privateKey: {}, replay: undefined, Buffer, HostDate: Date,
    wallNow: () => 1793232000000, iso: Date.prototype.toISOString, canonical: JSON.stringify,
    close: () => { counts.closed++; context.closed = true; },
    sign: () => { counts.signs++; return Buffer.alloc(64); },
    channel: { fixed: { pins: {} }, cancelled: () => false, reject: (_token, code) => counts.rejected.push(code), respond: () => { counts.responded++; } },
  };
  vm.createContext(context); vm.runInContext(deliver, context);
  return { counts, run(phase) { context.packet = { token: {}, request: { phase, challenge: "invented" } }; vm.runInContext("deliver(packet)", context); } };
}
test("4-B1 extracted delivery model refuses C1-first and a repeated C0 before the sign stub", () => {
  const first = deliveryModel(text); first.run("c1"); assert.equal(first.counts.signs, 0); assert.deepEqual(first.counts.rejected, ["oracle_rejected"]);
  const second = deliveryModel(text); second.run("c0"); second.run("c0");
  assert.equal(second.counts.signs, 1); assert.equal(second.counts.responded, 1); assert.deepEqual(second.counts.rejected, ["oracle_rejected"]);
});
test("4-B1 extracted behavioral checks detect removal of either phase or spent-attempt gate", () => {
  const noPhase = deliveryModel(text.replace('c0Attempted || packet.request.phase !== "c0"', "c0Attempted")); noPhase.run("c1");
  assert.equal(noPhase.counts.signs, 1);
  const noSpent = deliveryModel(text.replace('c0Attempted || packet.request.phase !== "c0"', 'packet.request.phase !== "c0"')); noSpent.run("c0"); noSpent.run("c0");
  assert.equal(noSpent.counts.signs, 2);
});
test("4-B1 remains absent from runtime, worker entry and package execution scripts", () => {
  const entry = "enrollFixedMemoryCheckpointOracleC0Only";
  for (const name of readdirSync(new URL("../../src/", import.meta.url)).filter((s) => s.endsWith(".ts")))
    assert.equal(readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8").includes(entry), false, name);
  for (const path of ["../../native/native_bar_fs/test_unsigned_worker.mjs", "../helpers/unsignedInertAdapters.mjs", "../../package.json"])
    assert.equal(readFileSync(new URL(path, import.meta.url), "utf8").includes(entry), false, path);
});

test("4-B1 memory test uses standard build unless an isolated mode is explicit", () => {
  const memory = ast(readFileSync(new URL("./nativeBarFixedMemoryCheckpointOracleC0Only.test.mjs", import.meta.url), "utf8"));
  const declarations = memory.statements.filter(ts.isVariableStatement).filter((s) => s.declarationList.declarations.some((d) => d.name.getText() === "mode" || d.name.getText() === "base"));
  function route(env) { return vm.runInNewContext(declarations.map((s) => s.getText()).join("\n") + "; base;", { process: { env } }); }
  assert.equal(route({}), "../../build/");
  assert.equal(route({ NATIVE_BAR_B3CC_MODE: "normal" }), "../../build/b3cc-validation/normal/");
  assert.equal(route({ NATIVE_BAR_B3CC_MODE: "ubsan" }), "../../build/b3cc-validation/ubsan/");
  assert.equal(route({ NATIVE_BAR_B3BB_ISOLATED_TEST: "1" }), "../../build/b3bb-validation/");
  assert.equal(route({ NATIVE_BAR_B3BC_ISOLATED_TEST: "1" }), "../../build/b3bc-validation/");
  const imports = names(memory, (n) => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword).map((n) => n.arguments[0].getText());
  assert.ok(imports.includes('new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url)'));
  assert.ok(imports.includes('new URL(`${base}nativeBarAdmissionCheckpointProbe.js`, import.meta.url)'));
  const built = names(memory, (n) => ts.isVariableDeclaration(n) && n.name.getText() === "built")[0];
  assert.equal(built.initializer.getText(), "fileURLToPath(new URL(base, import.meta.url))");
  assert.equal(names(memory, (n) => ts.isBinaryExpression(n) && n.left.getText() === "process.env.NATIVE_BAR_B3CC_MODE").length, 0);
});
