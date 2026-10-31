import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const source = read("../helpers/unsignedParentConnectionContracts.mjs");
const ast = s => ts.createSourceFile("parent.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
const exports = ["planUnsignedParentReservation", "validateUnsignedParentClockFailure", "planUnsignedParentCheckpoint", "assessUnsignedParentCallback",
  "validateUnsignedParentTerminalFacts", "describeUnsignedParentConnectionCapacity", "describeUnsignedParentConnectionProfile", "summarizeUnsignedParentDiscard"];
const forbidden = new Set(["process", "globalThis", "global", "Date", "performance", "Intl", "SharedArrayBuffer", "Atomics", "WebAssembly", "require", "createRequire",
  "eval", "Function", "constructor", "Proxy", "Reflect", "fetch", "Worker", "MessageChannel", "WeakMap", "WeakSet", "Promise", "createPrivateKey", "createPublicKey", "sign",
  "spawn", "exec", "fork", "dlopen", "openSync", "readFileSync", "writeFileSync", "mkdir", "unlink", "rename", "setTimeout", "setImmediate", "setInterval",
  "queueMicrotask", "AbortSignal", "WebSocket", "EventSource", "getPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "setPrototypeOf",
  "defineProperty", "defineProperties", "__proto__", "JSON", "create", "fromEntries", "groupBy", "groups",
  "RegExp", "match", "matchAll", "replace", "replaceAll", "Enum", "Values"]);
const authority = new Set(["execution_available", "cleanup_execution_available", "approval_authenticated", "ownership_verified", "evidence_saved",
  "native_release_verified", "timestamps_verified", "history_verified", "signing_available", "runtime_qualified", "runtime_completion_proven",
  "runtime_work_qualified", "original_reference_verified", "semantic_verified"]);
function guard(text) {
  const tree = ast(text); assert.equal(tree.parseDiagnostics.length, 0);
  assert.deepEqual(tree.statements.filter(ts.isImportDeclaration).map(n => {
    assert.equal(n.importClause?.name, undefined); assert.ok(ts.isNamedImports(n.importClause?.namedBindings));
    return n.moduleSpecifier.text + ":" + n.importClause.namedBindings.elements.map(e => e.name.text).join(",");
  }), ["zod:z", "./unsignedControllerData.mjs:uint,label,code,count,digestSchema,parse,canonical,byteLength,freeze,flags,LIMITS",
    "./unsignedCohortQualificationContracts.mjs:describeUnsignedQualificationProfile"]);
  assert.deepEqual(tree.statements.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)).map(n => n.name?.text), exports);
  walk(tree, n => {
    if (ts.isIdentifier(n)) assert.equal(forbidden.has(n.text), false, n.text);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n) || ts.isAwaitExpression(n) || n.kind === ts.SyntaxKind.AsyncKeyword, false);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
    // Regular-expression groups and zod enum maps would build keys from strings at run time.
    if (ts.isPropertyAccessExpression(n) && n.name.text === "enum") assert.ok(ts.isCallExpression(n.parent) && n.parent.expression === n);
    if (ts.isRegularExpressionLiteral(n)) assert.doesNotMatch(n.text, /\(\?<(?![=!])/);
    if (ts.isElementAccessExpression(n)) {
      assert.ok(ts.isNumericLiteral(n.argumentExpression) || ts.isStringLiteralLike(n.argumentExpression));
      if (ts.isStringLiteralLike(n.argumentExpression)) assert.equal(forbidden.has(n.argumentExpression.text), false, n.argumentExpression.text);
    }
    if (ts.isBindingElement(n) && n.propertyName) {
      assert.ok(ts.isIdentifier(n.propertyName) || ts.isStringLiteralLike(n.propertyName) || ts.isNumericLiteral(n.propertyName));
      assert.equal(forbidden.has(n.propertyName.text), false, n.propertyName.text);
    }
    if (ts.isComputedPropertyName(n)) assert.ok(ts.isStringLiteralLike(n.expression) || ts.isNumericLiteral(n.expression));
    if (ts.isPropertyAssignment(n)) {
      const name = ts.isComputedPropertyName(n.name) ? n.name.expression : n.name;
      assert.equal(forbidden.has(name.text), false, name.text);
    }
    assert.equal(ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isClassLike(n), false);
    // Decoded names, so escapes count: an authority name is only ever a literal false property key.
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && authority.has(n.text)) {
      const owner = ts.isComputedPropertyName(n.parent) ? n.parent.parent : n.parent;
      assert.ok(ts.isPropertyAssignment(owner) && owner.initializer.kind === ts.SyntaxKind.FalseKeyword, n.text);
    }
  });
  assert.doesNotMatch(text, /createUnsigned(?:ControllerProtocol|ControllerWindow|WorkerTransport|CohortAssembly)Model|next_ordinals|observeLateFrame/);
}
test("B4-B1 exports only bounded pure calculations, no protocol owner or effect/authority issuer", () => guard(source));
test("B4-B1 source guard rejects effect, alternate loader, original-reference and authority mutations", () => {
  for (const mutation of ['\nimport("node:fs");', '\nprocess.hrtime.bigint();', '\nnew Date();', '\nspawn("child");', '\nnew MessageChannel();',
    '\nsetTimeout(f, 1);', '\nnew WeakMap();', '\nnew Function("return 1")();', '\nx.constructor("return 1")();',
    '\nconst x = { execution_available: true };', '\nexport { privateRoot };']) assert.throws(() => guard(source + mutation));
});
test("B4-B1 source guard rejects computed reflection and asynchronous alternate paths", () => {
  for (const mutation of ["\nx['constructor']('return 1')();", "\nx['con' + 'structor']('return 1')();",
    "\nObject.getOwnPropertyDescriptor(x, 'constructor');", "\nasync function hidden() {}"])
    assert.throws(() => guard(source + mutation));
});
test("B4-B1 constructor extraction through binding and assignment patterns is refused without execution", () => {
  for (const mutation of [
    '\nfunction hidden() { const { constructor: C } = (() => {}); return C("return process")(); }',
    '\nfunction hidden() { const { "constructor": C } = (() => {}); return C("return process")(); }',
    '\nfunction hidden() { const { ["con" + "structor"]: C } = (() => {}); return C("return process")(); }',
    '\nfunction hidden() { let C; ({ constructor: C } = (() => {})); return C("return process")(); }',
    '\nfunction hidden() { let C; ({ ["constructor"]: C } = (() => {})); return C("return process")(); }',
  ]) assert.throws(() => guard(source + mutation));
});
test("B4-B1 computed authority fields cannot bypass false-only validation", () => {
  guard(source.replace('runtime_completion_proven: false', '["runtime_completion_proven"]: false'));
  for (const field of authority) {
    assert.throws(() => guard(source + `\nconst hidden = { ["${field}"]: true };`));
  }
  assert.throws(() => guard(source.replace('runtime_completion_proven: false', '["runtime_completion_proven"]: true')));
  assert.throws(() => guard(source + '\nconst hidden = { ["runtime_" + "completion_proven"]: true };'));
  assert.throws(() => guard(source + '\nconst key = "runtime_completion_proven", hidden = { [key]: true };'));
});
test("B4-B1 authority names appear only as literal false properties, however a write is spelled", () => {
  const at = "view.forward_at = at;", control = source.replace(at, at + ' const extra = { semantic_verified: false, "runtime_qualified": false };');
  assert.notEqual(control, source); guard(control);
  for (const added of [" view.execution_available = true;", ' view["runtime_completion_proven"] = true;', " view.semantic_verified ||= true;",
    " view.execution_available **= false;", " view.execution_available += false;", " [view.semantic_verified] = [true];", " (view.execution_available) = true;",
    " for (view.semantic_verified of [true]);", " view.execution_available++;", ' Object.defineProperty(view, "execution_available", { value: true });',
    ' Object.defineProperty(view, "execution_" + "available", { value: true });',
    ' Object["defineProperty"](view, "semantic_" + "verified", { value: true });', " Object.defineProperties(view, {});",
    ' const { "defineProperty": define } = Object; define(view, "semantic_" + "verified", { value: true });',
    " Object.assign(view, JSON.parse('{\"semantic_verified\":true}'));", ' Object.assign(view, { get ["semantic_" + "verified"]() { return true; } });',
    " Object.assign(view, { __proto__: at });", " Object.assign(view, JSON.parse('{\"semantic_' + 'verified\":true}'));", " view.forward_at = Object.create(at);",
    ' Object.assign(view, Object.fromEntries([["semantic_" + "verified", true]]));', ' Object.assign(view, Object.groupBy([true], () => "semantic_" + "verified"));',
    " view.execution\\u005Favailable = true;", " Object.assign(view, { execution\\u005Favailable: true });", ' Object.assign(view, { ["semantic_" + "verified"]() {} });',
    ' Object.assign(view, "x".match(new RegExp("(?<semantic_" + "verified>x)")).groups);', " Object.assign(view, { get hidden() { return true; } });",
    " Object.assign(view, new (class { hidden = true })());", " view.forward_at = view.groups;", " view.forward_at = /(?<hidden>x)/;",
    ' Object.assign(view, z.enum(["semantic_" + "verified"]).enum);', ' Object.assign(view, z.enum(["hidden"]).Enum);', ' Object.assign(view, z.enum(["hidden"]).Values);',
    ' "x".replace(/x/, (...a) => Object.assign(view, a.at(-1)));', ' "x".replaceAll("x", "y");', ' "x".match("(?<semantic_" + "verified>x)");',
    ' "x".matchAll(/x/g);', ' view.forward_at = new RegExp("x");'])
    assert.throws(() => guard(source.replace(at, at + added)), added);
  const reservation = 'return freeze({ ...base(), schema: "native-bar-parent-reservation-model-v1",';
  // Only the shorthand case also needs its declaration, so each literal form is refused on its own.
  for (const [declaration, literal] of [[", execution_available = true", "execution_available, "], ["", "get semantic_verified() { return true; }, "],
    ["", '"__proto__": d, ']]) {
    const mutated = source.replace("const unit = 1000000n;", `const unit = 1000000n${declaration};`).replace(reservation, reservation.replace("{ ", "{ " + literal));
    assert.notEqual(mutated, source); assert.throws(() => guard(mutated), literal);
  }
});
test("B4-B1 source guards preserve full-ms rounding, deadline-first order and unavailable-time semantics", () => {
  const pin = text => {
    for (const f of ['(end - BigInt(d.planned_ns)) / unit', 'if (!d.stopped && last >= bound) refuse("checkpoint_order")',
      'if (d.clock_invalid) return freeze(view)', 'view.route = "stop_before_input"', 'stop_first: d.stopped ? null',
      'expired ? null : observed.point', 'if (d.previous_decision === "started"', 'coordinator_ceiling_bytes: combined',
      'sidecar > 16384 || combined > 65536', 'hashes > BigInt(limits.hash_work_bytes) || helpers > limits.helper_commands']) assert.ok(text.includes(f), f);
  };
  pin(source);
  for (const f of ['if (!d.stopped && last >= bound) refuse("checkpoint_order");', 'if (d.clock_invalid) return freeze(view);',
    'if (d.previous_decision === "started"', 'sidecar > 16384 || combined > 65536']) {
    assert.throws(() => pin(source.replace(f, 'false')));
  }
});
test("B4-B1 the B2 clock-fault entry checks its original model case before any latch", () => {
  const s = read("../helpers/unsignedCohortAssemblyModel.mjs"); let entry;
  walk(ast(s), n => { if (ts.isMethodDeclaration(n) && n.name.text === "noteClockFailure") entry = n; });
  const contract = text => {
    const identity = text.indexOf('current(token)'), validation = text.indexOf('validateUnsignedParentClockFailure(raw)'), latch = text.indexOf('return guard(');
    assert.ok(identity >= 0 && validation > identity && latch > validation);
    assert.ok(text.includes('clockInvalid = true; latch(q.reason); return summary();'));
    assert.doesNotMatch(text, /timedInput|\bpoint\(|raw\.at|\.window\.|\.evidence\.|firstStop\s*=/);
  };
  contract(entry.getText());
  for (const [from, to] of [['current(token);', ''], ['validateUnsignedParentClockFailure(raw)', 'raw'], ['clockInvalid = true;', ''], ['latch(q.reason);', '']])
    assert.throws(() => contract(entry.getText().replace(from, to)));
});
test("B4-B1 memory guards precede all helper imports and include the final swallowed-effect test", () => {
  const s = read("./nativeBarAdmissionUnsignedParentConnection.test.mjs"), parent = s.indexOf('await import("../helpers/unsignedParentConnectionContracts.mjs")');
  for (const f of ['syncBuiltinESMExports();', 'block(Date, ["now"])', 'block(process.hrtime, ["bigint"])', 'block(performance, ["now"])',
    'block(workers, ["Worker", "MessageChannel", "BroadcastChannel"])', 'block(AbortSignal, ["timeout"])', 'block(inspectorPromises, ["open", "Session"])',
    'block(fsp, [...mutations, ...scans])', 'block(crypto.webcrypto.subtle, ["sign"', 'block(process, ["dlopen"']) {
    const at = s.indexOf(f); assert.ok(at >= 0 && parent > at, f);
  }
  assert.equal(s.lastIndexOf("\ntest("), s.indexOf('\ntest("B4-B1 no denied effect was swallowed", () => assert.deepEqual(effects, []));'));
  assert.doesNotMatch(s, /fixedMemoryCheckpointOracle|build\/b3|process\.env\s*[.[]/);
});
test("B4-B1 stays absent from product/package/build and is consumed only inside the sealed runtime root", () => {
  for (const p of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter(p => p.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${p}`), /unsignedParentConnectionContracts/, p);
  for (const p of ["../../package.json", "../../native/native_bar_fs/build_unsigned.mjs", "../../native/native_bar_fs/test_unsigned_worker.mjs",
    "../helpers/unsignedInertAdapters.mjs"]) assert.doesNotMatch(read(p), /unsignedParentConnectionContracts/);
  const runtime = ast(read("../helpers/unsignedCohortRuntime.mjs"));
  let uses = 0;
  walk(runtime,n=>{
    if (!ts.isStringLiteral(n) || n.text !== "./unsignedParentConnectionContracts.mjs") return;
    uses++; assert.ok(ts.isCallExpression(n.parent) && n.parent.expression.kind === ts.SyntaxKind.ImportKeyword);
    let owner = n; while (owner && !(ts.isFunctionDeclaration(owner) && owner.name?.text === "prepareOriginalQualification")) owner = owner.parent;
    assert.ok(owner);
  });
  assert.equal(uses,1);
  const execute = runtime.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === "executeUnsignedCohortAssembly");
  assert.equal(execute.parameters.length, 0); assert.equal(execute.body.statements.length, 1);
  assert.equal(execute.body.statements[0].getText(), 'throw Error("cc4b2_execution_not_approved");');
});
