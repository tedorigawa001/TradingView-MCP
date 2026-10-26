import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const helper = new URL("../helpers/fixedMemoryCheckpointOracle.mjs", import.meta.url);
const text = readFileSync(helper, "utf8");
const ast = (s) => ts.createSourceFile("signed-helper.mjs", s, ts.ScriptTarget.Latest, true);
const parse = ast(text);
function names(file, predicate) { const out = []; function visit(n) { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); } visit(file); return out; }
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
  assert.equal(names(parse, (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "export").length, 0);
});
test("B3-Bb no runtime source imports the signer; the original-owner mailbox has exactly one fixed helper consumer", () => {
  for (const name of readdirSync(new URL("../../src/", import.meta.url)).filter((s) => s.endsWith(".ts"))) {
    const source = readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fixedMemoryCheckpointOracle|createPrivateKey|generateKeyPair|from ["'].*test\/helpers/);
  }
  for (const name of readdirSync(new URL("../helpers/", import.meta.url)).filter((s) => s.endsWith(".mjs") && s !== "fixedMemoryCheckpointOracle.mjs"))
    assert.doesNotMatch(readFileSync(new URL(`../helpers/${name}`, import.meta.url), "utf8"), /claimFixedMemoryCheckpointOracleOwner/);
});
test("B3-Bb source boundary assertions detect an added key exporter, generator and storage call", () => {
  for (const source of ["generateKeyPairSync('ed25519')", "writeFileSync(path,key)", "fetch(url)"])
    assert.ok(names(ast(source), (n) => ts.isIdentifier(n) && ["generateKeyPairSync", "writeFileSync", "fetch"].includes(n.text)).length);
  assert.ok(names(ast("privateKey.export({format:'pem'})"), (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "export").length);
});
