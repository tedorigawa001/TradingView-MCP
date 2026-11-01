import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createUnsignedIsolatedTypeScript } from "../helpers/unsignedIsolatedTypeScript.mjs";

const read = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ts = createUnsignedIsolatedTypeScript(read("../../node_modules/typescript/lib/typescript.js"));
const source = read("../helpers/unsignedWorkerParserAcceptanceContracts.mjs").replace(/\r\n/g, "\n");
const syntax = s => ts.createSourceFile("contract.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function boundary(input) {
  const s = input.replace(/\r\n/g, "\n"), tree = syntax(s); assert.equal(tree.parseDiagnostics.length, 0);
  const imports = Array.from(tree.statements.filter(ts.isImportDeclaration), n => {
    assert.equal(n.importClause?.name, undefined); assert.ok(n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings));
    return [n.moduleSpecifier.text, Array.from(n.importClause.namedBindings.elements, e => e.getText())];
  });
  assert.deepEqual(imports, [["zod", ["z"]], ["./unsignedControllerData.mjs", ["uint", "digestSchema as hash", "count", "parse", "canonical", "byteLength", "freeze", "flags"]]]);
  const exports = Array.from(tree.statements.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)), n => n.name?.text);
  assert.deepEqual(exports, ["planUnsignedWorkerParserAcceptance", "describeUnsignedWorkerParserAcceptanceCapacity"]);
  const denied = new Set(["process", "globalThis", "global", "Date", "performance", "Temporal", "Intl", "require", "createRequire", "Worker", "MessageChannel", "BroadcastChannel", "WeakRef", "FinalizationRegistry", "setTimeout", "clearTimeout", "setInterval", "setImmediate", "queueMicrotask", "fetch", "eval", "Function", "createPrivateKey", "createPublicKey", "sign", "verify", "spawn", "readFileSync", "writeFileSync", "constructor", "prototype", "__proto__", "TextDecoder", "JSON"]);
  function visit(n) {
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isIdentifier(n)) assert.equal(denied.has(n.text), false, n.text);
    if (ts.isCallExpression(n)) { assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword); assert.doesNotMatch(n.expression.getText(), /^(?:Reflect\.|Object\.(?:defineProperty|setPrototypeOf)|JSON\.parse)/); }
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.equal(denied.has(n.argumentExpression.text), false);
    if (n.kind === ts.SyntaxKind.PropertyAssignment && ["parser_executed", "parser_available", "runtime_completion_proven", "startup_proof_issued", "actual_package_bytes_verified", "heap_runtime_qualified", "parent_wrapper_calculated", "elapsed_time_qualified", "synchronous_preemption_proven", "refunded"].includes(n.name?.text)) assert.equal(n.initializer.getText(), "false");
    ts.forEachChild(n, visit);
  } visit(tree);
  for (const pin of ['runtime_producers: "unavailable"', 'acceptance_scope: "supplied_case_summary_not_parser_test_results"',
    'r > 2375680n', 't > 4259840n', 'hashBytes > 2147483648n', 'helperCommands > 131072n', 'byteLength(canonical(out)) > 16384',
    'c2a_transient_reservation_bytes: "4259840"', 'blockers.push("transient_overlap_unproven")', 'input_record_bytes_held: 0',
    'fragment_bytes: 256', 'starts: 24', 'per_mode: 12']) assert.ok(s.includes(pin), pin);
  assert.doesNotMatch(s, /unsignedCohortRuntime|unsignedInertAdapters|CheckpointOracle|JSON\.parse|\.node["']/);
}
test("B1 pure named surface and fixed false authority under LF and CRLF", () => { boundary(source); boundary(source.replace(/\n/g, "\r\n")); });
for (const extra of ['\nJSON["parse"]("{}");', '\nJSON[`parse`]("{}");', '\nconst jsonAlias = JSON; jsonAlias.parse("{}");',
  '\nconst {parse: decodeRecord} = JSON; decodeRecord("{}");', '\nconst parseAlias = JSON["parse"]; parseAlias("{}");',
  '\nJ\\u0053ON["p\\u0061rse"]("{}");']) test("B1 rejects parse aliases as source text " + extra, () => {
  boundary(source + '\nconst textOnly = "JSON";');
  for (const s of [source + extra, (source + extra).replace(/\n/g, "\r\n")]) {
    assert.equal(syntax(s).parseDiagnostics.length, 0); assert.throws(() => boundary(s), { code: "ERR_ASSERTION" });
  }
});
test("B1 independent static mutations reject effects, imports, parser use and guard erasure", () => {
  for (const extra of ['\nprocess.hrtime.bigint();', '\nnew Date();', '\nimport("stream-json/core/parser.js");', '\nimport {jsonParser} from "stream-json/core/parser.js";',
    '\nJSON.parse("{}");', '\nnew TextDecoder();', '\nexport function execute() {}', '\nexport*from "node:fs";']) {
    const s = source + extra; assert.equal(syntax(s).parseDiagnostics.length, 0); assert.throws(() => boundary(s), { code: "ERR_ASSERTION" });
  }
  for (const [from, to] of [['parser_executed: false', 'parser_executed: true'], ['startup_proof_issued: false', 'startup_proof_issued: true'],
    ['runtime_producers: "unavailable"', 'runtime_producers: "ready"'], ['r > 2375680n', 'false'], ['t > 4259840n', 'false'],
    ['hashBytes > 2147483648n', 'false'], ['helperCommands > 131072n', 'false'], ['byteLength(canonical(out)) > 16384', 'false'],
    ['blockers.push("transient_overlap_unproven")', 'blockers.push("none")'], ['input_record_bytes_held: 0', 'input_record_bytes_held: 1']]) {
    assert.equal(source.split(from).length, 2); const s = source.replace(from, to); assert.equal(syntax(s).parseDiagnostics.length, 0);
    assert.throws(() => boundary(s), { code: "ERR_ASSERTION" });
  }
});
function harness(s) {
  const first = s.indexOf('await import("../helpers/'); assert.ok(first > 0);
  for (const pin of ['block(fs, ["read", "readSync", "readv", "readvSync", "createReadStream"', 'block(child, ["spawn"', 'block(workers, ["Worker", "MessageChannel"',
    'block(crypto, ["sign", "verify"', 'block(process, ["dlopen", "getBuiltinModule"', 'block(net, ["Socket", "Server"',
    '[globalThis, "Date", ["now"]]', '[process, "hrtime", ["bigint"]]', 'block(timerPromises, ["setTimeout"', 'syncBuiltinESMExports();',
    'block(fs, ["open"]); block(fsp, ["open"]);', '"lchmod", "chown", "fchown", "lchown"', 'block(JSON, ["parse"]);']) assert.ok(s.indexOf(pin) >= 0 && s.indexOf(pin) < first, pin);
  for (const pin of ['[fs, "readSync"]', '[fs, "readvSync"]', '[net, "Socket"]', '[process, "getBuiltinModule"]', '[timers, "setTimeout"]',
    '[fs, "open"], [fsp, "open"]', '["lchmod", "lchown"].flatMap', '[JSON, "parse"]', 'assert.equal(escapedParse, 0)']) assert.ok(s.includes(pin), pin);
  assert.ok(s.indexOf('for (const [o, k] of required)') < s.indexOf('for (const [o, k] of blocked)'));
  assert.doesNotMatch(s.slice(s.indexOf('for (const [o, k, flag]'), first), /\[fsp, "open"|\[fs, "open"/);
  assert.doesNotMatch(s, /from ["']typescript["']|(?:await )?import\(["']stream-(?:json|chain)|\.skip\(|\.todo\(/);
  assert.equal(s.lastIndexOf('\ntest("B1 no denied effect was swallowed"'), s.lastIndexOf('\ntest('));
}
test("B1 effect guards and independent sink controls precede helper evaluation", () => {
  const s = read("./nativeBarAdmissionUnsignedWorkerParserAcceptance.test.mjs").replace(/\r\n/g, "\n"); harness(s); harness(s.replace(/\n/g, "\r\n"));
  for (const [from, to] of [['[fs, "readSync"]', ''], ['[net, "Socket"]', ''], ['[process, "getBuiltinModule"]', ''],
    ['block(fs, ["open"]); block(fsp, ["open"]);', ''], ['"lchmod", "chown", "fchown", "lchown"', '"chown", "fchown"'],
    ['[fs, "open"], [fsp, "open"]', '[fs, "__missing"]'], ['["lchmod", "lchown"].flatMap', '["__missing"].flatMap'],
    ['block(JSON, ["parse"]);', ''], ['[JSON, "parse"]', '[JSON, "__missing"]']]) {
    assert.equal(s.split(from).length, 2); const changed = s.replace(from, to); assert.equal(syntax(changed).parseDiagnostics.length, 0);
    assert.throws(() => harness(changed), { code: "ERR_ASSERTION" });
  }
});
test("B1 has no dependency adoption, operational imports or opened worker entry", () => {
  for (const f of ["../../package.json", "../../package-lock.json", "../../native/native_bar_fs/test_unsigned_cohort_worker.mjs", "../helpers/unsignedCohortRuntime.mjs", "../helpers/unsignedInertAdapters.mjs", "../helpers/fixedMemoryCheckpointOracle.mjs", "../helpers/unsignedCheckpointOracle.mjs"])
    assert.doesNotMatch(read(f), /unsignedWorkerParserAcceptance|UnsignedWorkerParserAcceptance/);
  for (const f of ["../../package.json", "../../package-lock.json"]) assert.doesNotMatch(read(f), /"(?:stream-json|stream-chain)"/);
  for (const f of fs.readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(f => f.endsWith(".ts")))
    assert.doesNotMatch(read("../../src/" + f), /unsignedWorkerParserAcceptance|UnsignedWorkerParserAcceptance/);
  const worker = read("../../native/native_bar_fs/test_unsigned_cohort_worker.mjs");
  assert.match(worker, /export function runUnsignedCohortWorker\(\) \{ throw Error\("cc2b_execution_not_approved"\); \}/);
  assert.match(worker, /function qualifyOriginalWorkerStartup\(ref\)[\s\S]*?throw Error\("cc2c_startup_producer_unavailable"\)/);
});
