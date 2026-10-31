import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read=f=>readFileSync(new URL(f,import.meta.url),"utf8");
const source=read("../helpers/unsignedCohortRuntime.mjs");
const parse=s=>ts.createSourceFile("runtime.mjs",s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const walk=(n,f)=>{f(n);ts.forEachChild(n,child=>walk(child,f));};
function guard(s) {
  const tree=parse(s);assert.equal(tree.statements.length,5);assert.equal(tree.parseDiagnostics.length,0);
  const root=tree.statements[4],functions=root.body.statements.filter(ts.isFunctionDeclaration);
  const get=name=>functions.find(n=>n.name.text===name),text=name=>get(name).getText();
  assert.equal(tree.statements[2].getText(),'export function executeUnsignedCohortAssembly() { throw Error("cc4b2_execution_not_approved"); }');
  assert.equal(text("originalParentLaunchPlan"),'function originalParentLaunchPlan() { throw Error("cc4b3b_original_launch_plan_unavailable"); }');
  const launch=text("launchOriginalParent"),qualify=text("qualifyOriginalParentLaunch"),bind=text("bindOriginalParentChild"),output=text("observeOriginalParentOutput");
  assert.deepEqual(get("launchOriginalParent").parameters.map(p=>p.getText()),["ref"]);
  const waits=[],spawns=[],ons=[],refs=[];
  walk(root,n=>{
    if(ts.isPropertyAccessExpression(n)&&n.expression.getText()==="parentLaunchPlans")assert.equal(n.name.text,"get");
    if(ts.isCallExpression(n)&&n.expression.getText()==="spawn")spawns.push(n.getText());
    if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==="ref")refs.push(n.getText());
  });
  walk(get("launchOriginalParent"),n=>{if(ts.isAwaitExpression(n))waits.push(n.getText());});
  walk(get("bindOriginalParentChild"),n=>{if(ts.isCallExpression(n)&&n.expression.getText()==="emitter.on")ons.push(n.getText());});
  assert.deepEqual(waits,['await import("node:child_process")']);assert.deepEqual(ons,["emitter.on(event, listener)"]);assert.equal(spawns.length,2);
  assert.deepEqual(refs,["child.ref()"]);
  for(const pin of ['c.launchClaimed = true','plan.consumed = true','parentLaunchPlans.get(planRef) !== plan','qualifyOriginalParentLaunch(c, plan); c.facts.launch.attempted = true',
    'spawn(plan.node.path, [plan.worker.path]','stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"], shell: false, detached: true',
    'UBSAN_OPTIONS: "halt_on_error=1:abort_on_error=0:exitcode=86:print_stacktrace=0"','c.child = child; c.facts.launch.returned = true',
    'bindOriginalParentChild(ref)','child.ref(); qualifyOriginalParentLaunch(c, plan)'])assert.ok(launch.includes(pin),pin);
  assert.ok(launch.indexOf("c.launchClaimed = true")<launch.indexOf("await import"));
  assert.ok(launch.indexOf("bindOriginalParentChild(ref)")<launch.indexOf("child.ref()"));
  for(const pin of ['plan.owner !== c','plan.buildRef !== c.owner.buildRef','plan.namespaceRef !== c.owner.namespaceRef','plan.allocation !== c.allocation',
    'rows.includes(plan.node)','rows.includes(plan.worker)','native/native_bar_fs/test_unsigned_cohort_worker.mjs',
    'plan.worker.sha256 !== binding.worker_sha256','s.recordHash !== binding.build_record_sha256','c.allocation.fixture.mode !== binding.mode'])assert.ok(qualify.includes(pin),pin);
  const qualification=get("qualifyOriginalParentLaunch"),ready=qualification.body.statements.find(n=>n.getText()==="qualifyOriginalParentDispatch(c.reference);");
  const rows=qualification.body.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]).find(n=>n.name.getText()==="rows");
  assert.ok(rows.pos>ready.end);
  assert.equal(get("pointOriginalParentSupervision").body.statements[0].getText(),
    'if (parentSessions.get(c.reference) !== c || c.owner.active !== c || c.owner.generation !== c.generation) return null;');
  const failure=get("failOriginalParentEvent").body.statements;
  assert.equal(failure[0].getText(),failure[3].getText());assert.match(failure[3].getText(),/c\.owner\.generation !== c\.generation/);
  for(const pin of ['c.handlersAttempted = true','currentOriginalParentHandler(c, child, stream, slot)','slots.some(slot => alive(stream, slot))',
    'recordOriginalParentTerminal(ref, original, slot, event, payload)','receiveOriginalParent(ref, stream, bytes)',
    'observeOriginalParentOutput(ref, stream, slot, bytes)','c.handlersBound = !failed && c.bindingsValid',
    'const c = parentSessions.get(ref); if (!c || c.reference !== ref)',
    'aliases[0] === c.pipes.stdout && aliases[1] === c.pipes.stderr',
    'exit_code: knownCode ? exitCode : null, signal: knownSignal ? signal : null'])assert.ok(bind.includes(pin),pin);
  const passes=get("bindOriginalParentChild").body.statements.filter(n=>ts.isForOfStatement(n)&&n.expression.getText()==="bindings");
  assert.equal(passes.length,2);assert.doesNotMatch(passes[0].getText(),/"data"/);assert.match(passes[1].getText(),/add\(stream, "data"/);
  assert.ok(output.includes('Math.min(length, 8192)'));assert.ok(output.includes('old.prefix === null'));assert.ok(output.includes('!stopped'));
  assert.ok(output.includes('reverse ? 65537 : 2097153'));assert.doesNotMatch(output,/\bhash\(|\bdigest\(|TextDecoder|\.toString\(/);
  assert.doesNotMatch(launch+bind,/\.write\(|\.end\(|\.kill\(|\.unref\(|\.destroy\(|\.delete\(|process\.|setTimeout/);
}
test("B4-B4 launch effects stay private, fixed, source-bound and behind unavailable producers",()=>guard(source));
test("B4-B4 source mutation probes reject new issuers, alternate arguments and lost ownership gates",()=>{
  // Probe strings are written with LF; a CRLF checkout (Windows CI) is normalized first.
  const text=source.replace(/\r\n/g,"\n");
  for(const [from,to]of [
    ['throw Error("cc4b3b_original_launch_plan_unavailable");','return {};'],['c.launchClaimed = true','c.launchClaimed = false'],
    ['parentLaunchPlans.get(planRef) !== plan','false'],['plan.worker.sha256 !== binding.worker_sha256','false'],
    ['c.allocation.fixture.mode !== binding.mode','false'],['spawn(plan.node.path, [plan.worker.path]','spawn(plan.node.path, plan.args'],
    ['slots.some(slot => alive(stream, slot))','true'],['child.ref(); qualifyOriginalParentLaunch(c, plan)','child.ref();'],
    ['Math.min(length, 8192)','length'],['const parentLaunchPlans = new WeakMap();','const parentLaunchPlans = new WeakMap(); parentLaunchPlans.set({}, {});'],
    ['const s = c.owner.s;\n    qualifyOriginalParentDispatch(c.reference);\n    const rows = s.inputs?.rows, d = c.owner.coordinator.describe(), binding = d.active.binding;',
      'const s = c.owner.s, rows = s.inputs?.rows;\n    qualifyOriginalParentDispatch(c.reference);\n    const d = c.owner.coordinator.describe(), binding = d.active.binding;'],
    ['const c = parentSessions.get(ref); if (!c || c.reference !== ref)','const c = currentOriginalParentSession(ref); if (!c || c.reference !== ref)'],
    ['aliases[0] === c.pipes.stdout','stdio?.[1] === c.pipes.stdout'],
    ['signal: knownSignal ? signal : null','signal: knownCode ? signal : null'],
    ['if (parentSessions.get(c.reference) !== c || c.owner.active !== c || c.owner.generation !== c.generation) return null;',''],
  ]) {assert.ok(text.includes(from),from);assert.throws(()=>guard(text.replace(from,to)),undefined,from);}
  const tree=parse(text),root=tree.statements[4],bind=root.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==="bindOriginalParentChild");
  const passes=bind.body.statements.filter(n=>ts.isForOfStatement(n)&&n.expression.getText()==="bindings");
  const [a,b]=passes;const swapped=text.slice(0,a.getStart())+b.getText()+text.slice(a.end,b.getStart())+a.getText()+text.slice(b.end);
  assert.throws(()=>guard(swapped));
  const failure=root.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==="failOriginalParentEvent");
  const lateGuard=failure.body.statements[3];assert.throws(()=>guard(text.slice(0,lateGuard.getStart())+text.slice(lateGuard.end)));
});
test("B4-B4 memory harness substitutes imports only after real effects are denied",()=>{
  const s=read("./nativeBarAdmissionUnsignedParentLaunch.test.mjs"),first=s.indexOf('await import("../helpers/');
  for(const pin of ['syncBuiltinESMExports();','block(child, ["spawn", "spawnSync"','block(workers, ["Worker", "MessageChannel", "BroadcastChannel"])',
    'block(timerPromises, ["setTimeout", "setInterval", "setImmediate"])','block(fsp, [...mutations, ...scans])',
    '[globalThis, "Date", ["now"]]','[process, "hrtime", ["bigint"]]','block(crypto, ["sign", "verify"'])
    assert.ok(s.indexOf(pin)>=0&&s.indexOf(pin)<first,pin);
  assert.ok(s.includes("vm.compileFunction"));assert.ok(s.includes('await memoryChildImport()'));
  assert.doesNotMatch(s,/process\.env\s*[.[]|build_unsigned\.mjs|fixedMemoryCheckpointOracle/);
  assert.equal(s.lastIndexOf('\ntest('),s.indexOf('\ntest("B4-B4 no denied effect was swallowed"'));
});
