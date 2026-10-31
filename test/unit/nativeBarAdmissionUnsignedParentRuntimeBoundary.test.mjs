import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = f => readFileSync(new URL(f, import.meta.url), "utf8");
const source = read("../helpers/unsignedCohortRuntime.mjs");
const ast = s => ts.createSourceFile("runtime.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const walk = (n, f) => { f(n); ts.forEachChild(n, child => walk(child, f)); };
const names = ["originalParentScope", "originalParentInvocation", "originalParentAllocation", "originalParentCaseReceipt", "originalParentWorkPlan",
  "originalParentWorkerQualification", "createOriginalParentOwner", "reserveOriginalParentSession", "currentOriginalParentSession", "syncOriginalParent",
  "describeOriginalParent", "pointOriginalParent", "checkpointOriginalParent", "stopOriginalParentSupervision", "clearOriginalParentTimer",
  "pointOriginalParentSupervision", "inspectOriginalParentSupervision", "checkOriginalParentSupervision", "armOriginalParentTimer", "selectOriginalParentPhase",
  "armOriginalParentOperation", "qualifyOriginalParentDispatch", "originalParentHelperPlan", "checkOriginalParentHelper", "releaseOriginalParentHelper", "runOriginalParentHelper",
  "faultOriginalParent", "discardOriginalParent", "dropOriginalParentPending", "discardOriginalParentBytes", "receiveOriginalParent",
  "endOriginalParent", "recordOriginalParentTerminal", "prepareOriginalParentCommand"];
const dependencies = {
  "./unsignedCohortAssemblyModel.mjs": ["createUnsignedCohortAssemblyModel"],
  "./unsignedAdapterSupport.mjs": ["createUnsignedProtocolDecoder"],
  "./unsignedParentConnectionContracts.mjs": ["planUnsignedParentCheckpoint", "validateUnsignedParentTerminalFacts", "summarizeUnsignedParentDiscard", "describeUnsignedParentConnectionCapacity", "planUnsignedParentReservation"],
};
function guard(text) {
  const tree = ast(text); assert.equal(tree.parseDiagnostics.length, 0); assert.equal(tree.statements.length, 5);
  const [imports, inspect, execute, retained, root] = tree.statements;
  assert.equal(imports.getText(), 'import { flags, freeze } from "./unsignedControllerData.mjs";');
  assert.equal(inspect.name.text, "inspectUnsignedCohortAssembly"); assert.equal(execute.name.text, "executeUnsignedCohortAssembly");
  assert.equal(execute.parameters.length, 0); assert.equal(execute.body.statements.length, 1);
  assert.equal(execute.body.statements[0].getText(), 'throw Error("cc4b2_execution_not_approved");');
  assert.equal(retained.getText(), "const retainedQualificationScopes = new Set();");
  assert.equal(root.name.text, "prepareOriginalQualification"); assert.equal(root.parameters.length, 0);
  assert.equal(root.body.statements[0].getText(), "const policy = originalQualificationPolicy(), clock = originalQualificationClock();");
  const funcs = root.body.statements.filter(ts.isFunctionDeclaration), selected = funcs.filter(n => /[Oo]riginalParent/.test(n.name.text));
  assert.deepEqual(selected.map(n => n.name.text), names);
  assert.ok(root.body.statements.some(n => n.getText() === "const parentOwners = new WeakMap(), parentSessions = new WeakMap();"));
  assert.ok(root.body.statements.some(n => n.getText() === "const parentHelperPlans = new WeakMap();"));
  const imported = {};
  for (const n of root.body.statements) if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) {
    const init = d.initializer;
    if (!ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression) || init.expression.expression.kind !== ts.SyntaxKind.ImportKeyword) continue;
    const module = init.expression.arguments[0].text;
    if (Object.hasOwn(dependencies,module)) imported[module] = d.name.elements.map(e=>e.name.text);
  }
  assert.deepEqual(imported,dependencies);
  const gates = { originalParentInvocation: "parent_invocation", originalParentAllocation: "original_allocation",
    originalParentCaseReceipt: "original_case_receipt", originalParentWorkPlan: "runtime_work_plan", originalParentWorkerQualification: "qualified_worker_closure",
    originalParentHelperPlan: "original_helper_plan" };
  for (const [name, reason] of Object.entries(gates)) {
    const f = selected.find(n=>n.name.text===name); assert.equal(f.parameters.length,0); assert.equal(f.body.statements.length,1);
    assert.equal(f.body.statements[0].getText(), `throw Error("cc4b3b_${reason}_unavailable");`);
  }
  const members = new Set(["write", "on", "once", "emit", "destroy", "kill", "unref", "spawn", "open", "read", "sign"]);
  const forbidden = new Set(["fs","crypto","process","Date","setInterval","performance","require","eval","Function","Proxy","Reflect"]);
  const timerCalls = [];
  for (const f of selected) walk(f,n=>{
    if (ts.isIdentifier(n)) assert.equal(forbidden.has(n.text),false,n.text);
    if (ts.isIdentifier(n) && n.text === "path") {
      assert.equal(f.name.text,"runOriginalParentHelper"); assert.equal(n.parent.getText(),"path.isAbsolute");
      assert.equal(n.parent.parent.getText(),"path.isAbsolute(plan.args[1])");
    }
    if (ts.isIdentifier(n) && ["setTimeout","clearTimeout"].includes(n.text)) {
      assert.ok(ts.isCallExpression(n.parent) && n.parent.expression === n);
      timerCalls.push(f.name.text+":"+n.text);
    }
    if (ts.isAwaitExpression(n) || n.kind === ts.SyntaxKind.AsyncKeyword) assert.equal(f.name.text,"runOriginalParentHelper");
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n),false);
    assert.equal(ts.isNewExpression(n),false);
    if (ts.isCallExpression(n)) {
      assert.notEqual(n.expression.kind,ts.SyntaxKind.ImportKeyword);
      if (ts.isPropertyAccessExpression(n.expression) || ts.isElementAccessExpression(n.expression)) {
        const receiver = n.expression.expression, name = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression.argumentExpression;
        if (ts.isElementAccessExpression(n.expression)) assert.ok(ts.isStringLiteralLike(name));
        assert.equal(members.has(name.text),false,name.text);
        if (name.text === "applyModelEvent") assert.ok(["pointOriginalParent","receiveOriginalParent"].includes(f.name.text));
        if (receiver.getText() === "clock" && name.text === "point") assert.ok(["reserveOriginalParentSession","pointOriginalParent","pointOriginalParentSupervision"].includes(f.name.text));
      }
      if (n.expression.getText() === "createUnsignedCohortAssemblyModel") assert.equal(f.name.text,"createOriginalParentOwner");
      if (n.expression.getText() === "createUnsignedProtocolDecoder") assert.equal(f.name.text,"reserveOriginalParentSession");
    }
  });
  assert.deepEqual(timerCalls,["clearOriginalParentTimer:clearTimeout","armOriginalParentTimer:setTimeout","armOriginalParentTimer:clearTimeout"]);
  assert.doesNotMatch(text,/createUnsignedWorkerTransportModel|createUnsignedControllerProtocolModel|createUnsignedControllerWindowModel/);
  return selected;
}
test("B4-B2 parent declarations and dependencies stay private behind the unchanged seals",()=>guard(source));
test("B4-B2 guards reject public reachability, producer bypass and new effect callsites",()=>{
  for (const mutation of [source+'\nprepareOriginalQualification();', source+'\nexport { prepareOriginalQualification };',
    source.replace('throw Error("cc4b2_execution_not_approved");','return prepareOriginalQualification();'),
    source.replace('throw Error("cc4b3b_original_allocation_unavailable");','return {};'),
    source.replace('const c = parentSessions.get(ref);','process.hrtime.bigint(); const c = parentSessions.get(ref);'),
    source.replace('c.decoder = createUnsignedProtocolDecoder();','c.pipes.status.on("data", run); c.decoder = createUnsignedProtocolDecoder();'),
    source.replace('const { createUnsignedProtocolDecoder } = await import("./unsignedAdapterSupport.mjs");','const { other } = await import("./unsignedAdapterSupport.mjs");')])
    assert.throws(()=>guard(mutation));
});
test("B4-B2 literal element calls obey the same effect and owner checks as dot calls",()=>{
  const anchor = 'c.decoder = createUnsignedProtocolDecoder();';
  for (const call of ['c.pipes.status["on"]("data", run);','c.pipes.status["o" + "n"]("data", run);',
    'c.pipes.command["write"]("bytes");','c.child["kill"]();'])
    assert.throws(()=>guard(source.replace(anchor,call+anchor)));
  const gate = 'const c = currentOriginalParentSession(ref);';
  assert.throws(()=>guard(source.replace(gate,gate+' c.owner.coordinator["applyModelEvent"](null, {});')));
  guard(source.replace('c.decoder.push(chunk)','c.decoder["push"](chunk)'));
});
test("B4-B2 command gates never commit bytes, allocate reservations or dispatch",()=>{
  const f = guard(source).find(n=>n.name.text==="prepareOriginalParentCommand").getText();
  for (const reason of ["qualified_worker_closure","original_sealed_setup","original_go_readback_proofs","original_shutdown_authority","original_cancellation_decision","original_teardown_proofs"])
    assert.ok(f.includes(reason+"_unavailable"));
  assert.doesNotMatch(f,/clock\.|applyModelEvent|\.write\(|planUnsignedParentReservation|spawn|await/);
});
test("B4-B2 owner-stop and worker-only relay stay narrow and before normal timing",()=>{
  const selected = guard(source), sync = selected.find(n=>n.name.text==="syncOriginalParent").getText();
  assert.ok(sync.includes('c.owner.coordinator.noteOwnerStop(c.caseRef)')); assert.doesNotMatch(sync,/clock\.|lastNs\s*=/);
  assert.ok(selected.find(n=>n.name.text==="receiveOriginalParent").getText().includes('kind: "worker_frame"'));
  const model = ast(read("../helpers/unsignedCohortAssemblyModel.mjs")); let entry;
  walk(model,n=>{if(ts.isMethodDeclaration(n)&&n.name.text==="noteOwnerStop")entry=n;});
  const pin = text=>{
    assert.ok(text.indexOf('current(token)')>=0 && text.indexOf('current(token)')<text.indexOf('return guard('));
    assert.ok(text.includes('latch("original_owner_stopped", true)'));
    assert.doesNotMatch(text,/clockInvalid\s*=|timedInput|\bpoint\(|\.window\.|\.evidence\./);
  };
  assert.equal(entry.parameters.length,1); pin(entry.getText());
  for (const [from,to] of [['current(token);',''],['latch("original_owner_stopped", true)','latch("original_owner_stopped")']])
    assert.throws(()=>pin(entry.getText().replace(from,to)));
});
test("B4-B2 runtime extraction is test-local and all real-effect guards precede imports",()=>{
  const s = read("./nativeBarAdmissionUnsignedParentRuntime.test.mjs");
  const first = s.indexOf('await import("../helpers/unsignedCohortRuntime.mjs")');
  for (const fragment of ['syncBuiltinESMExports();','block(workers, ["Worker", "MessageChannel", "BroadcastChannel"])',
    'block(Date, ["now"])','block(process.hrtime, ["bigint"])','block(performance, ["now"])','block(fsp, [...mutations, ...scans])',
    'block(timerPromises, ["setTimeout", "setInterval", "setImmediate"])']) assert.ok(s.indexOf(fragment)>=0 && s.indexOf(fragment)<first);
  assert.ok(s.includes('vm.compileFunction')); assert.doesNotMatch(s,/process\.env\s*[.[]|build\/b3|fixedMemoryCheckpointOracle/);
  assert.equal(s.lastIndexOf('\ntest('),s.indexOf('\ntest("B4-B2 no denied effect was swallowed", () => assert.deepEqual(effects, []));'));
});
