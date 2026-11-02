import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createUnsignedIsolatedTypeScript } from "../helpers/unsignedIsolatedTypeScript.mjs";

const read = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ts = createUnsignedIsolatedTypeScript(read("../../node_modules/typescript/lib/typescript.js"));
const source = read("../helpers/unsignedParserDependencyAuditContracts.mjs").replace(/\r\n/g, "\n");
const syntax = s => ts.createSourceFile("contract.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function boundary(input) {
  const s = input.replace(/\r\n/g, "\n"), tree = syntax(s);
  assert.equal(tree.parseDiagnostics.length, 0);
  const imports = Array.from(tree.statements.filter(ts.isImportDeclaration), n => {
    assert.equal(n.importClause?.name, undefined);
    assert.ok(n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings));
    return [n.moduleSpecifier.text, Array.from(n.importClause.namedBindings.elements, e => e.getText())];
  });
  assert.deepEqual(imports, [["zod", ["z"]], ["./unsignedControllerData.mjs",
    ["uint", "digestSchema as hash", "count", "parse", "canonical", "digest", "byteLength", "freeze", "flags"]]]);
  const exports = Array.from(tree.statements.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)), n => n.name?.text);
  assert.deepEqual(exports, ["planUnsignedParserDependencyAudit", "describeUnsignedParserDependencyAuditCapacity"]);
  const denied = new Set(["process", "globalThis", "global", "Date", "performance", "Temporal", "Intl", "JSON", "require", "createRequire",
    "Worker", "MessageChannel", "BroadcastChannel", "WeakRef", "FinalizationRegistry", "setTimeout", "clearTimeout", "setInterval", "setImmediate",
    "queueMicrotask", "fetch", "eval", "Function", "createPrivateKey", "createPublicKey", "sign", "verify", "spawn", "readFileSync", "writeFileSync",
    "constructor", "prototype", "__proto__", "TextDecoder"]);
  const falseFlags = ["actual_package_bytes_verified", "parser_executed", "parser_available", "runtime_completion_proven", "startup_proof_issued",
    "transport_available", "inspector_available", "dependency_added", "publisher_authenticated", "declaration_observed", "layout_observed",
    "heap_runtime_qualified", "elapsed_time_qualified", "synchronous_preemption_proven", "refunded"];
  function visit(n) {
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isIdentifier(n)) assert.equal(denied.has(n.text), false, n.text);
    if (ts.isCallExpression(n)) {
      assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword);
      assert.doesNotMatch(n.expression.getText(), /^(?:Reflect\.|Object\.(?:defineProperty|setPrototypeOf))/);
    }
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) assert.equal(denied.has(n.argumentExpression.text), false);
    if (n.kind === ts.SyntaxKind.PropertyAssignment && falseFlags.includes(n.name?.text)) assert.equal(n.initializer.getText(), "false");
    ts.forEachChild(n, visit);
  }
  visit(tree);
  for (const pin of ['destination: z.literal("memory_only")', 'runtime_producers: "unavailable"', 'unsigned_dependency_audit_supplied_summary_only',
    'retained_bytes: 2375680, transient_bytes: 4259840, record_bytes: 4194304', 'byteLength(canonical(out)) > 16384',
    'receipt_bytes: 1048576', 'persisted_bytes: 51380224', 'persisted_files: 530', 'scope: "unsigned_dependency_audit_supplied_summary_only"'])
    assert.ok(s.includes(pin), pin);
  assert.doesNotMatch(s, /unsignedCohortRuntime|unsignedInertAdapters|CheckpointOracle|\.node["']/);
}
test("B2-A pure surface, immutable ceilings and false authority under LF and CRLF", () => {
  boundary(source); boundary(source.replace(/\n/g, "\r\n"));
});
for (const extra of ['\nJSON["parse"]("{}");', '\nJSON[`parse`]("{}");', '\nconst x = JSON; x.parse("{}");',
  '\nconst {parse: x} = JSON; x("{}");', '\nJ\\u0053ON["p\\u0061rse"]("{}");', '\nprocess.hrtime.bigint();',
  '\nnew Date();', '\nimport("stream-json/core/parser.js");', '\nimport {jsonParser} from "stream-json/core/parser.js";',
  '\nexport function execute() {}', '\nexport * from "node:fs";']) test("B2-A static effect mutation " + extra, () => {
  boundary(source + '\nconst textOnly = "JSON";');
  const s = source + extra; assert.equal(syntax(s).parseDiagnostics.length, 0); assert.throws(() => boundary(s), { code: "ERR_ASSERTION" });
});
test("B2-A false authority and budget literal erasure are detected", () => {
  for (const [from, to] of [['parser_executed: false', 'parser_executed: true'], ['dependency_added: false', 'dependency_added: true'],
    ['runtime_producers: "unavailable"', 'runtime_producers: "ready"'], ['byteLength(canonical(out)) > 16384', 'false'],
    ['retained_bytes: 2375680', 'retained_bytes: 2375681'], ['transient_bytes: 4259840', 'transient_bytes: 4259841']]) {
    assert.equal(source.split(from).length, 2); const s = source.replace(from, to);
    assert.equal(syntax(s).parseDiagnostics.length, 0); assert.throws(() => boundary(s), { code: "ERR_ASSERTION" });
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
  assert.equal(s.lastIndexOf('\ntest("B2-A no denied effect was swallowed"'), s.lastIndexOf('\ntest('));
}
test("B2-A guards precede imports and guard deletion controls fail", () => {
  const s = read("./nativeBarAdmissionUnsignedParserDependencyAudit.test.mjs").replace(/\r\n/g, "\n");
  harness(s); harness(s.replace(/\n/g, "\r\n"));
  for (const [from, to] of [['[fs, "readSync"]', ''], ['[net, "Socket"]', ''], ['[process, "getBuiltinModule"]', ''],
    ['block(fs, ["open"]); block(fsp, ["open"]);', ''], ['"lchmod", "chown", "fchown", "lchown"', '"chown", "fchown"'],
    ['[fs, "open"], [fsp, "open"]', '[fs, "__missing"]'], ['["lchmod", "lchown"].flatMap', '["__missing"].flatMap'],
    ['block(JSON, ["parse"]);', ''], ['[JSON, "parse"]', '[JSON, "__missing"]']]) {
    assert.equal(s.split(from).length, 2); const changed = s.replace(from, to);
    assert.equal(syntax(changed).parseDiagnostics.length, 0); assert.throws(() => harness(changed), { code: "ERR_ASSERTION" });
  }
});
test("B2-A is not registered, imported by operational code or adopted as a dependency", () => {
  for (const f of ["../../package.json", "../../package-lock.json", "../../native/native_bar_fs/test_unsigned_cohort_worker.mjs",
    "../helpers/unsignedCohortRuntime.mjs", "../helpers/unsignedInertAdapters.mjs", "../helpers/fixedMemoryCheckpointOracle.mjs", "../helpers/unsignedCheckpointOracle.mjs"])
    assert.doesNotMatch(read(f), /unsignedParserDependencyAudit|UnsignedParserDependencyAudit/);
  for (const f of ["../../package.json", "../../package-lock.json"]) assert.doesNotMatch(read(f), /"(?:stream-json|stream-chain)"/);
  for (const f of fs.readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(f => f.endsWith(".ts")))
    assert.doesNotMatch(read("../../src/" + f), /unsignedParserDependencyAudit|UnsignedParserDependencyAudit/);
  assert.match(read("../../native/native_bar_fs/test_unsigned_cohort_worker.mjs"), /export function runUnsignedCohortWorker\(\) \{ throw Error\("cc2b_execution_not_approved"\); \}/);
});
