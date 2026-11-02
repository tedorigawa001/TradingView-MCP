import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createUnsignedIsolatedTypeScript } from "../helpers/unsignedIsolatedTypeScript.mjs";

const read = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ts = createUnsignedIsolatedTypeScript(read("../../node_modules/typescript/lib/typescript.js"));
const source = read("../helpers/unsignedMetadataAcquisitionContracts.mjs").replace(/\r\n/g, "\n");
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
    ["uint", "digestSchema as hash", "label", "count", "parse", "canonical", "digest", "byteLength", "freeze", "flags"]]]);
  const exports = Array.from(tree.statements.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)), n => n.name?.text);
  assert.deepEqual(exports, ["planUnsignedMetadataAcquisition", "describeUnsignedMetadataAcquisitionCapacity"]);
  const denied = new Set(["process", "globalThis", "global", "Date", "performance", "Temporal", "Intl", "JSON", "require", "createRequire",
    "Worker", "MessageChannel", "BroadcastChannel", "WeakRef", "FinalizationRegistry", "setTimeout", "clearTimeout", "setInterval", "setImmediate",
    "queueMicrotask", "fetch", "eval", "Function", "createPrivateKey", "createPublicKey", "sign", "verify", "spawn", "readFileSync", "writeFileSync",
    "constructor", "prototype", "__proto__", "TextDecoder"]);
  const falseFlags = ["metadata_parser_executed", "actual_metadata_verified", "producer_available", "network_available",
    "metadata_parser_available", "tls_qualified", "pin_frozen", "tarball_bytes_verified", "signature_verified",
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
  for (const pin of ['destination: z.literal("memory_only")', 'runtime_producers: "unavailable"',
    'source: z.literal("synthetic_summary")', 'source: z.literal("synthetic_current_attempt")',
    'attempts: 22, urls: 16, tags_per_package: 4, body_each: 524288, body_total: 8388608',
    'headers_each: 16384, header_pairs: 64, deliveries_each: 1024, json_depth: 32, json_nodes: 16384, json_keys: 256',
    'scalar_bytes: 65536, numeric_bytes: 128, report_bytes: 1048576, root_ms: 240000, request_ms: 15000, phase_ms: 5000, settle_ms: 10000, timers: 3',
    'name: "stream-json", version: "3.8.0"', 'name: "stream-chain", version: "4.4.1"',
    'byteLength(canonical(out)) > 16384', 'scope: "unsigned_metadata_acquisition_memory_only"'])
    assert.ok(s.includes(pin), pin);
  assert.doesNotMatch(s, /unsignedCohortRuntime|unsignedInertAdapters|CheckpointOracle|\.node["']/);
}
test("M1 pure surface, immutable ceilings and false authority under LF and CRLF", () => {
  boundary(source); boundary(source.replace(/\n/g, "\r\n"));
});
for (const extra of ['\nJSON["parse"]("{}");', '\nJSON[`parse`]("{}");', '\nconst x = JSON; x.parse("{}");',
  '\nconst {parse: x} = JSON; x("{}");', '\nJ\\u0053ON["p\\u0061rse"]("{}");', '\nprocess.hrtime.bigint();',
  '\nnew Date();', '\nimport("stream-json/core/parser.js");', '\nimport {jsonParser} from "stream-json/core/parser.js";',
  '\nexport function execute() {}', '\nexport * from "node:fs";']) test("M1 static effect mutation " + extra, () => {
  boundary(source + '\nconst textOnly = "JSON";');
  const s = source + extra; assert.equal(syntax(s).parseDiagnostics.length, 0); assert.throws(() => boundary(s), { code: "ERR_ASSERTION" });
});
test("M1 false authority and budget literal erasure are detected", () => {
  for (const [from, to] of [['metadata_parser_executed: false', 'metadata_parser_executed: true'], ['network_available: false', 'network_available: true'],
    ['runtime_producers: "unavailable"', 'runtime_producers: "ready"'], ['byteLength(canonical(out)) > 16384', 'false'],
    ['body_total: 8388608', 'body_total: 8388609'], ['attempts: 22', 'attempts: 23']]) {
    assert.equal(source.split(from).length, 2); const s = source.replace(from, to);
    assert.equal(syntax(s).parseDiagnostics.length, 0); assert.throws(() => boundary(s), { code: "ERR_ASSERTION" });
  }
});
function harness(s) {
  const first = s.indexOf('await import("../helpers/'); assert.ok(first > 0);
  // Tests registered before a top-level await can finish before it resolves, letting the root after hook lift the guards early.
  const K = ts.SyntaxKind, scoped = new Set([K.FunctionDeclaration, K.FunctionExpression, K.ArrowFunction, K.MethodDeclaration, K.GetAccessor, K.SetAccessor, K.Constructor]);
  const registers = n => ts.isCallExpression(n) && n.expression.getText() === "test" || !scoped.has(n.kind) && ts.forEachChild(n, registers);
  const awaits = n => n.kind === K.AwaitExpression || n.kind === K.ForOfStatement && n.awaitModifier !== undefined
    || n.kind === K.VariableDeclarationList && (n.flags & 6) === 6 || !scoped.has(n.kind) && ts.forEachChild(n, awaits);
  let registered = false;
  for (const n of syntax(s).statements) { const r = Boolean(registers(n));
    assert.equal((registered || r) && Boolean(awaits(n)), false, "top-level await after test registration"); registered ||= r; }
  for (const pin of ['block(fs, ["read", "readSync", "readv", "readvSync", "createReadStream"', 'block(child, ["spawn"', 'block(workers, ["Worker", "MessageChannel"',
    'block(crypto, ["sign", "verify"', 'block(process, ["dlopen", "getBuiltinModule"', 'block(net, ["Socket", "Server"',
    '[globalThis, "Date", ["now"]]', '[process, "hrtime", ["bigint"]]', 'block(timerPromises, ["setTimeout"', 'syncBuiltinESMExports();',
    'block(fs, ["open"]); block(fsp, ["open"]);', '"lchmod", "chown", "fchown", "lchown"', 'block(JSON, ["parse"]);']) assert.ok(s.indexOf(pin) >= 0 && s.indexOf(pin) < first, pin);
  for (const pin of ['[fs, "readSync"]', '[fs, "readvSync"]', '[net, "Socket"]', '[process, "getBuiltinModule"]', '[timers, "setTimeout"]',
    '[fs, "open"], [fsp, "open"]', '["lchmod", "lchown"].flatMap', '[JSON, "parse"]', 'assert.equal(escapedParse, 0)']) assert.ok(s.includes(pin), pin);
  assert.ok(s.indexOf('for (const [o, k] of required)') < s.indexOf('for (const [o, k] of blocked)'));
  assert.doesNotMatch(s.slice(s.indexOf('for (const [o, k, flag]'), first), /\[fsp, "open"|\[fs, "open"/);
  assert.doesNotMatch(s, /from ["']typescript["']|(?:await )?import\(["']stream-(?:json|chain)|\.skip\(|\.todo\(/);
  assert.equal(s.lastIndexOf('\ntest("M1 no denied effect was swallowed"'), s.lastIndexOf('\ntest('));
}
test("M1 guards precede imports and guard deletion controls fail", () => {
  const s = read("./nativeBarAdmissionUnsignedMetadataAcquisition.test.mjs").replace(/\r\n/g, "\n");
  harness(s); harness(s.replace(/\n/g, "\r\n"));
  for (const [from, to] of [['[fs, "readSync"]', ''], ['[net, "Socket"]', ''], ['[process, "getBuiltinModule"]', ''],
    ['block(fs, ["open"]); block(fsp, ["open"]);', ''], ['"lchmod", "chown", "fchown", "lchown"', '"chown", "fchown"'],
    ['[fs, "open"], [fsp, "open"]', '[fs, "__missing"]'], ['["lchmod", "lchown"].flatMap', '["__missing"].flatMap'],
    ['block(JSON, ["parse"]);', ''], ['[JSON, "parse"]', '[JSON, "__missing"]']]) {
    assert.equal(s.split(from).length, 2); const changed = s.replace(from, to);
    assert.equal(syntax(changed).parseDiagnostics.length, 0); assert.throws(() => harness(changed), { code: "ERR_ASSERTION" });
  }
  const last = 'test("M1 no denied effect was swallowed"', firstName = 'test("M1 empty plan never grants runtime authority"';
  for (const [late, at] of [['const late = await import("zod");', last], ['{ let late = (await import("zod")).z; }', last], ['for await (const late of []) {}', last],
    ['{ await using late = null; }', last], ['for (const late of []) { test(late); await late; }', firstName]]) {
    const changed = s.replace(at, late + '\n' + at);
    assert.equal(syntax(changed).parseDiagnostics.length, 0);
    for (const text of [changed, changed.replace(/\n/g, "\r\n")]) assert.throws(() => harness(text), { message: /^top-level await after test registration/ });
  }
});
test("M1 is not registered, imported by operational code or adopted as a dependency", () => {
  for (const f of ["../../package.json", "../../package-lock.json", "../../native/native_bar_fs/test_unsigned_cohort_worker.mjs",
    "../helpers/unsignedCohortRuntime.mjs", "../helpers/unsignedInertAdapters.mjs", "../helpers/fixedMemoryCheckpointOracle.mjs", "../helpers/unsignedCheckpointOracle.mjs"])
    assert.doesNotMatch(read(f), /unsignedMetadataAcquisition|UnsignedMetadataAcquisition/);
  for (const f of ["../../package.json", "../../package-lock.json"]) assert.doesNotMatch(read(f), /"(?:stream-json|stream-chain)"/);
  for (const f of fs.readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(f => f.endsWith(".ts")))
    assert.doesNotMatch(read("../../src/" + f), /unsignedMetadataAcquisition|UnsignedMetadataAcquisition/);
  assert.match(read("../../native/native_bar_fs/test_unsigned_cohort_worker.mjs"), /export function runUnsignedCohortWorker\(\) \{ throw Error\("cc2b_execution_not_approved"\); \}/);
});
