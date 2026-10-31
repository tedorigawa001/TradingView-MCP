import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read=file=>readFileSync(new URL(file,import.meta.url),"utf8");
const source=read("../helpers/unsignedCohortRuntime.mjs");
const parse=s=>ts.createSourceFile("runtime.mjs",s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const walk=(n,f)=>{f(n);ts.forEachChild(n,child=>walk(child,f));};
function guard(s) {
  const tree=parse(s);assert.equal(tree.parseDiagnostics.length,0);assert.equal(tree.statements.length,5);
  const root=tree.statements[4],functions=root.body.statements.filter(ts.isFunctionDeclaration);
  const get=name=>functions.find(n=>n.name.text===name),text=name=>get(name).getText();
  assert.equal(tree.statements[2].body.statements[0].getText(),'throw Error("cc4b2_execution_not_approved");');
  assert.equal(text("originalParentHelperPlan"),'function originalParentHelperPlan() { throw Error("cc4b3b_original_helper_plan_unavailable"); }');
  const calls=[];walk(root,n=>{
    if(ts.isCallExpression(n)&&["setTimeout","clearTimeout"].includes(n.expression.getText())) {
      let owner=n;while(owner&&!functions.includes(owner))owner=owner.parent;calls.push(owner?.name.text+":"+n.expression.getText());
    }
    if(ts.isPropertyAccessExpression(n)&&n.expression.getText()==="parentHelperPlans")assert.equal(n.name.text,"get");
  });
  assert.deepEqual(calls,["armOriginalQualificationTimer:clearTimeout","armOriginalQualificationTimer:setTimeout",
    "clearOriginalParentTimer:clearTimeout","armOriginalParentTimer:setTimeout","armOriginalParentTimer:clearTimeout"]);
  assert.deepEqual(get("runOriginalParentHelper").parameters.map(n=>n.getText()),["ref"]);
  const waits=[];walk(get("runOriginalParentHelper"),n=>{if(ts.isAwaitExpression(n))waits.push(n.expression.getText());});
  assert.deepEqual(waits,['runOriginalTool(s, plan.program, plan.args, "metadata", ref)']);
  const helper=text("runOriginalParentHelper");
  for(const pin of ['s.helper = lease.reference','plan.consumed = true','pending?.started','chargeHash(s, hashReservation)',
    'limits.acl_bytes + Buffer.byteLength','c.operationTimer.control : armOriginalParentOperation(ref)',
    'return lease.borrowed ? false : operation.cancel()','if (!lease.spawnAttempted) lease.closed = true'])assert.ok(helper.includes(pin),pin);
  assert.ok(helper.indexOf("s.helper = lease.reference")<helper.indexOf("await runOriginalTool"));
  const timer=text("armOriginalParentTimer"),clear=text("clearOriginalParentTimer");
  for(const pin of ['deadline !== phaseEnd','deadline !== pending.reservation.deadline_ns','deadline !== c.helperLease.deadline',
    'if (c[key]) refuse("parent_timer_busy")','Number.isSafeInteger(generation)','segment !== fact.segment',
    't.installing','t.clearing','t.knownCleared = false','if (next && current() && segment === fact.segment) schedule(next)'])assert.ok(timer.includes(pin),pin);
  assert.ok(clear.indexOf("t.clearAttempted = true")<clear.indexOf("clearTimeout(t.handle)"));
  assert.ok(clear.includes("t.fact.clear_unknown = true"));
  const tool=text("runOriginalTool");assert.equal((tool.match(/\bspawn\(/g)??[]).length,1);
  for(const pin of ['parentRef = null','lease.plan.args !== args','const timer = parent ? lease.timer : armOriginalQualificationTimer',
    'if (parent) lease.spawnAttempted = true','if (parent) lease.child = child','if (parent) lease.closed = true',
    'parent ? limits.acl_bytes : limits.tool_capture_bytes'])assert.ok(tool.includes(pin),pin);
  assert.doesNotMatch(helper+timer+clear,/\.unref\(|\.kill\(|\.destroy\(|qualificationTimer\s*=/);
}
test("B4-B3 timer/helper routes remain private, source-bound and use the one existing helper transport",()=>guard(source));
test("B4-B3 static mutation probes refuse new plan issuers, renewed deadlines and bypassed helper ownership",()=>{
  for(const [from,to]of [
    ['throw Error("cc4b3b_original_helper_plan_unavailable");','return {};'],
    ['plan.consumed = true','plan.consumed = false'],
    ['s.helper = lease.reference','s.helper = null'],
    ['deadline !== phaseEnd','false'],
    ['deadline !== pending.reservation.deadline_ns','false'],
    ['if (c[key]) refuse("parent_timer_busy")','if (false) refuse("parent_timer_busy")'],
    ['return lease.borrowed ? false : operation.cancel()','return operation.cancel()'],
    ['await runOriginalTool(s, plan.program, plan.args, "metadata", ref)','await alternative(ref)'],
    ['const parentHelperPlans = new WeakMap();','const parentHelperPlans = new WeakMap(); parentHelperPlans.set({}, {});'],
  ]) {assert.ok(source.includes(from));assert.throws(()=>guard(source.replace(from,to)));}
});
test("B4-B3 memory harness installs all effect and clock guards before helper imports",()=>{
  const s=read("./nativeBarAdmissionUnsignedParentSupervision.test.mjs"),first=s.indexOf('await import("../helpers/');
  for(const pin of ['syncBuiltinESMExports();','block(workers, ["Worker", "MessageChannel", "BroadcastChannel"])',
    'block(timerPromises, ["setTimeout", "setInterval", "setImmediate"])','block(fsp, [...mutations, ...scans])',
    '[globalThis, "Date", ["now"]]','[process, "hrtime", ["bigint"]]','block(performance, ["now"])',
    'block(crypto, ["sign", "verify"'])assert.ok(s.indexOf(pin)>=0&&s.indexOf(pin)<first,pin);
  assert.ok(s.includes("vm.compileFunction"));assert.ok(s.includes("memoryChildImport()"));
  assert.doesNotMatch(s,/process\.env\s*[.[]|build_unsigned\.mjs|fixedMemoryCheckpointOracle/);
  assert.equal(s.lastIndexOf('\ntest('),s.indexOf('\ntest("B4-B3 no denied effect was swallowed"'));
});
