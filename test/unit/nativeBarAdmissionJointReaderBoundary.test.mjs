import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { assertJointReaderImports } from "./helpers/jointReaderBoundary.mjs";
const root = new URL("../../src/", import.meta.url), name = "nativeBarAdmissionJointReader.ts";
const text = readFileSync(new URL(name, root), "utf8");
const ast = (s) => ts.createSourceFile("joint.ts", s, ts.ScriptTarget.Latest, true);
const banned = new Set(["require", "createRequire", "process", "eval", "Function", "globalThis", "global", "fetch", "WebSocket", "sign", "createSign",
  "createPrivateKey", "createPublicKey", "generateKeyPair", "generateKeyPairSync", "crypto", "webcrypto", "getRandomValues", "setInterval",
  "Intl", "Event", "CustomEvent", "EventTarget", "AbortSignal", "PerformanceMark", "PerformanceMeasure", "performance",
  "random", "randomBytes", "randomInt", "randomFill", "randomFillSync", "setImmediate",
  "claimSyntheticCheckpointProbe", "enrollSyntheticCheckpointProbe", ["claimFixedMemory", "CheckpointOracleOwner"].join("")]);
function violations(file) {
  const found = []; function visit(n) {
    if (ts.isIdentifier(n) && banned.has(n.text)) found.push(n.text);
    if (ts.isPropertyAccessExpression(n) && n.name.text === "constructor") found.push("constructor");
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)
      && (banned.has(n.argumentExpression.text) || n.argumentExpression.text === "constructor")) found.push(n.argumentExpression.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) found.push("dynamic_import"); ts.forEachChild(n, visit);
  } visit(file); return found;
}
test("C-B exposes only original joint bootstrap/enrollment and exact fixed dependencies, without signer or provider injection", () => {
  const file = ast(text); assertJointReaderImports(file); assert.deepEqual(violations(file), []);
  assert.equal(file.statements.filter((n) => ts.isExportAssignment(n) || ts.isExportDeclaration(n)).length, 0);
  assert.deepEqual(file.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((n) => n.name?.text),
    ["createSyntheticAdmissionJointBootstrap", "enrollSyntheticAdmissionJointReader"]);
});
test("C-B remains disconnected from startup, MCP, history and every other runtime consumer", () => {
  for (const f of readdirSync(root).filter((f) => f.endsWith(".ts") && f !== name))
    assert.equal(readFileSync(new URL(f, root), "utf8").includes("nativeBarAdmissionJointReader"), false, f);
});
test("C-B source preserves one snapshot, all captures before V0, private C1 after V0 and full transcript before cleanup/publication", () => {
  assert.equal((text.match(/\.beginRead\(/g) ?? []).length, 1); assert.equal((text.match(/\.openPair\(/g) ?? []).length, 1);
  assert.equal((text.match(/\.inventory\(/g) ?? []).length, 1); assert.equal((text.match(/q\.snapshot\.verify\(/g) ?? []).length, 2);
  const run = text.slice(text.indexOf("async run(t: object)"));
  const positions = ['request(q, "c0")', "pair.inventory()", "take(e)", "claim.bindRecordIds", "q.snapshot.verify()", 'request(q, "c1", c0)',
    'q.state = "v1_verified"', "claim.verifier.verifyTranscript", 'q.state = "releasing"', "q.lease.check(); observe(q)", "return result"].map((s) => run.indexOf(s));
  assert.ok(positions.every((p, i) => p >= 0 && (!i || p > positions[i - 1])));
  assert.doesNotMatch(run.slice(run.indexOf('q.state = "v0_verified"')), /nativeCapture\(|take\(/);
});
test("C-B duplicate-run refusal cannot clear another continuation's running ownership", async () => {
  const methods = []; function visit(n) {
    if (ts.isMethodDeclaration(n) && n.name.getText() === "run") methods.push(n); ts.forEachChild(n, visit);
  } visit(ast(text)); assert.equal(methods.length, 1);
  // Isolated preflight guard only: supplied pending state, no context, native backend, authenticated response or positive report.
  const js = ts.transpileModule(methods[0].getText().replace(/^async run/, "async function run"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const q = { running: true, failure: null, state: "c0_outstanding" }; let cleanupCalls = 0, requests = 0;
  const run = vm.runInNewContext(`${js}; run`, { lookup: () => q, work() {},
    refuse(c) { throw Error(`b3cb_${c}`); }, coded: (e) => e.message,
    fail(owned, reason) { owned.failure ??= reason; }, cleanup() { cleanupCalls++; }, request() { requests++; throw Error("request_must_not_run"); } });
  await assert.rejects(run({}), /phase_order/);
  assert.equal(q.running, true); assert.equal(cleanupCalls, 0); assert.equal(requests, 0);
});
test("C-B boundary rejects owner/probe imports, dynamic loaders and signing additions", () => {
  for (const altered of [text.replace("claimSyntheticJointCheckpointReader }", "claimSyntheticJointCheckpointReader, claimSyntheticCheckpointProbe }"),
    text.replace('import { z }', 'import all, { z }'), `${text}\nimport('./other.js');`])
    assert.throws(() => assertJointReaderImports(ast(altered)));
  for (const s of [["claimFixedMemory", "CheckpointOracleOwner(x)"].join(""), "createRequire(x)", "sign(null,b,k)", "globalThis.process", "fetch(url)",
    "new CustomEvent('x').timeStamp", "new PerformanceMark('x').startTime", "Math.random()", "Math['random']()", "const {random}=Math; random()",
    "Buffer.constructor('return 1')()", "Buffer['constructor']('return 1')()"])
    assert.ok(violations(ast(s)).length);
  const worker = readFileSync(new URL("./helpers/jointReaderRefusal.mjs", import.meta.url), "utf8");
  assert.match(worker, /process\.dlopen =/); assert.match(worker, /assert\.equal\(loads, 0\)/);
  assert.doesNotMatch(worker, /createPrivateKey|\bsign\(|writeFile|mkdir|unlink|\.node["']/);
});
