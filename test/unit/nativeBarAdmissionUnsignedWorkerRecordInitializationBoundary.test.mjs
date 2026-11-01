import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createUnsignedIsolatedTypeScript } from "../helpers/unsignedIsolatedTypeScript.mjs";

const read = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ts = createUnsignedIsolatedTypeScript(read("../../node_modules/typescript/lib/typescript.js"));
const source = read("../helpers/unsignedWorkerRecordInitializationContracts.mjs").replace(/\r\n/g, "\n");
const parse = s => ts.createSourceFile("contract.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function boundary(input) {
  const s = input.replace(/\r\n/g, "\n"), tree = parse(s); assert.equal(tree.parseDiagnostics.length, 0);
  const imports = Array.from(tree.statements.filter(ts.isImportDeclaration), n => {
    assert.equal(n.importClause?.name, undefined); assert.ok(n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)); return n.moduleSpecifier.text;
  });
  assert.deepEqual(imports, ["zod", "./unsignedControllerData.mjs", "./unsignedWorkerStartupContracts.mjs", "./unsignedCohortQualificationContracts.mjs"]);
  const exports = Array.from(tree.statements.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)), n => n.name?.text);
  assert.deepEqual(exports, ["planUnsignedWorkerRecordInitialization", "describeUnsignedWorkerRecordInitializationCapacity"]);
  const denied = new Set(["process", "globalThis", "global", "Date", "performance", "Temporal", "Intl", "require", "createRequire", "Worker", "MessageChannel", "BroadcastChannel", "WeakRef", "FinalizationRegistry", "setTimeout", "clearTimeout", "setInterval", "setImmediate", "queueMicrotask", "fetch", "eval", "Function", "createPrivateKey", "createPublicKey", "sign", "verify", "spawn", "readFileSync", "writeFileSync", "constructor", "prototype", "__proto__"]);
  const visit = n => {
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isIdentifier(n)) assert.equal(denied.has(n.text), false, n.text);
    if (ts.isCallExpression(n)) { assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword); assert.doesNotMatch(n.expression.getText(), /^(?:Reflect\.|Object\.(?:defineProperty|setPrototypeOf)|JSON\.parse)/); }
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.equal(denied.has(n.argumentExpression.text), false);
    if (n.kind === ts.SyntaxKind.PropertyAssignment && ["execution_available", "runtime_completion_proven", "record_reader_available", "startup_proof_issued", "cache_replacement_overwritten", "parent_wrapper_calculated", "native_budget_changed"].includes(n.name?.text)) assert.equal(n.initializer.getText(), "false");
    ts.forEachChild(n, visit);
  }; visit(tree);
  for (const pin of ['runtime_producers: "unavailable"', 'maximal_plan: maximum', 'r > 2375680n', 't > 4259840n', 'bytes > 16384',
    'helpers > BigInt(profile.helper_commands)', 'hashBytes > BigInt(profile.hash_work_bytes)', 'perStartRead > BigInt(profile.pass_bytes)',
    'refunded: false', 'template_preimage: "deferred_to_c3"', 'events: z.array(eventSchema).max(LIMITS.trace_events)',
    'projection_scope: "one_supplied_page_not_complete_record_provenance"']) assert.ok(s.includes(pin), pin);
  assert.doesNotMatch(s, /unsignedCohortRuntime|unsignedInertAdapters|fixedMemoryCheckpointOracle\.mjs|unsignedCheckpointOracle\.mjs|node:|JSON\.parse|\.node["']/);
}
test("C2c-A exact pure surface/dependencies/refusals under LF and CRLF", () => { boundary(source); boundary(source.replace(/\n/g, "\r\n")); });
test("C2c-A source mutations cannot add effects, authority, exports or erase capacity guards", () => {
  for (const extra of ['\nprocess.hrtime.bigint();', '\nnew Date();', '\nimport("node:fs");', '\nexport function run() {}',
    '\nexport{planUnsignedWorkerRecordInitialization as run};', '\nexport*from"node:fs";', '\nimport "./unsignedCohortRuntime.mjs";', '\nJSON.parse("{}");']) {
    assert.equal(parse(source + extra).parseDiagnostics.length, 0); assert.throws(() => boundary(source + extra), { code: "ERR_ASSERTION" });
  }
  for (const [from, to] of [['startup_proof_issued: false', 'startup_proof_issued: true'], ['record_reader_available: false', 'record_reader_available: true'],
    ['runtime_producers: "unavailable"', 'runtime_producers: "ready"'], ['r > 2375680n', 'false'], ['t > 4259840n', 'false'], ['bytes > 16384', 'false'],
    ['perStartRead > BigInt(profile.pass_bytes)', 'false'], ['hashBytes > BigInt(profile.hash_work_bytes)', 'false'], ['refunded: false', 'refunded: true']]) {
    assert.equal(source.split(from).length, 2); const changed = source.replace(from, to); assert.equal(parse(changed).parseDiagnostics.length, 0); assert.throws(() => boundary(changed), { code: "ERR_ASSERTION" });
  }
});
function harnessGuard(s) {
  const first = s.indexOf('await import("../helpers/');
  for (const pin of ['block(fs, ["read", "readSync", "readv", "readvSync", "createReadStream"', 'block(child, ["spawn"', 'block(workers, ["Worker", "MessageChannel"',
    'block(crypto, ["sign", "verify"', 'block(process, ["dlopen", "getBuiltinModule"', 'block(net, ["Socket", "Server"',
    '[globalThis, "Date", ["now"]]', '[process, "hrtime", ["bigint"]]', 'block(timerPromises, ["setTimeout"', 'syncBuiltinESMExports();']) assert.ok(s.indexOf(pin) >= 0 && s.indexOf(pin) < first, pin);
  for (const pin of ['block(fs, ["open"]); block(fsp, ["open"]);', '"lchmod", "chown", "fchown", "lchown"']) assert.ok(s.indexOf(pin) >= 0 && s.indexOf(pin) < first, pin);
  for (const pin of ['[fs, "readSync"]', '[fs, "readvSync"]', '[net, "Socket"]', '[process, "getBuiltinModule"]', '[timers, "setTimeout"]']) assert.ok(s.includes(pin), pin);
  assert.ok(s.indexOf('for (const [o, k] of required)') < s.indexOf('for (const [o, k] of blocked)'));
  for (const pin of ['[fs, "open"], [fsp, "open"]', '["lchmod", "lchown"].flatMap']) assert.ok(s.includes(pin), pin);
  assert.doesNotMatch(s.slice(s.indexOf('for (const [o, k, flag]'), first), /\[fsp, "open"|\[fs, "open"/);
  assert.doesNotMatch(s, /from ["']typescript["']|\.skip\(|\.todo\(/);
  assert.equal(s.lastIndexOf('\ntest("C2c-A no denied effect was swallowed"'), s.lastIndexOf('\ntest('));
}
test("C2c-A memory guards precede target dependencies and have independent negative controls", () => {
  const s = read("./nativeBarAdmissionUnsignedWorkerRecordInitialization.test.mjs").replace(/\r\n/g, "\n"); harnessGuard(s); harnessGuard(s.replace(/\n/g, "\r\n"));
  for (const pin of ['[fs, "readSync"]', '[fs, "readvSync"]', '[net, "Socket"]', '[process, "getBuiltinModule"]', '[timers, "setTimeout"]']) {
    const changed = s.replace(pin, ''); assert.notEqual(changed, s); assert.equal(parse(changed).parseDiagnostics.length, 0); assert.throws(() => harnessGuard(changed), { code: "ERR_ASSERTION" });
  }
  for (const [from, to] of [['block(fs, ["open"]); block(fsp, ["open"]);', ''], ['"lchmod", "chown", "fchown", "lchown"', '"chown", "fchown"'],
    ['[fs, "open"], [fsp, "open"]', '[fs, "__missing"]'], ['["lchmod", "lchown"].flatMap', '["__missing"].flatMap']]) {
    assert.equal(s.split(from).length, 2); const changed = s.replace(from, to); assert.equal(parse(changed).parseDiagnostics.length, 0); assert.throws(() => harnessGuard(changed), { code: "ERR_ASSERTION" });
  }
});
test("C2c-A has no operational worker/product/owner/runtime/package connection", () => {
  for (const f of ["../../package.json", "../../package-lock.json", "../../native/native_bar_fs/test_unsigned_cohort_worker.mjs", "../helpers/unsignedCohortRuntime.mjs", "../helpers/unsignedInertAdapters.mjs", "../helpers/fixedMemoryCheckpointOracle.mjs", "../helpers/unsignedCheckpointOracle.mjs"])
    assert.doesNotMatch(read(f), /unsignedWorkerRecordInitialization|UnsignedWorkerRecordInitialization/);
  for (const f of fs.readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(f => f.endsWith(".ts"))) assert.doesNotMatch(read("../../src/" + f), /unsignedWorkerRecordInitialization|UnsignedWorkerRecordInitialization/);
  const worker = read("../../native/native_bar_fs/test_unsigned_cohort_worker.mjs");
  assert.match(worker, /export function runUnsignedCohortWorker\(\) \{ throw Error\("cc2b_execution_not_approved"\); \}/);
  assert.match(worker, /function qualifyOriginalWorkerStartup\(ref\)[\s\S]*?throw Error\("cc2c_startup_producer_unavailable"\)/);
});
