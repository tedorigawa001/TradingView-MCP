import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read=f=>readFileSync(new URL(f,import.meta.url),"utf8");
const source=read("../helpers/unsignedCohortRuntime.mjs");
const parse=s=>ts.createSourceFile("runtime.mjs",s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const walk=(n,f)=>{f(n);ts.forEachChild(n,child=>walk(child,f));};
function registryMember(n) {
  if (!ts.isPropertyAccessExpression(n) && !ts.isElementAccessExpression(n)) return null;
  const target=n.expression.getText();if(!["parentCommandPlans","parentWrites"].includes(target))return null;
  if(ts.isElementAccessExpression(n))assert.ok(ts.isStringLiteralLike(n.argumentExpression),"computed registry access");
  return target+"."+(ts.isPropertyAccessExpression(n)?n.name.text:n.argumentExpression.text);
}
function guard(s) {
  const tree=parse(s);assert.equal(tree.parseDiagnostics.length,0);assert.equal(tree.statements.length,5);
  const root=tree.statements[4],functions=root.body.statements.filter(ts.isFunctionDeclaration);
  const get=name=>functions.find(n=>n.name.text===name),text=name=>get(name).getText();
  assert.equal(tree.statements[2].getText(),'export function executeUnsignedCohortAssembly() { throw Error("cc4b2_execution_not_approved"); }');
  assert.equal(text("originalQualificationPolicy"),'function originalQualificationPolicy() { throw Error("cc4b3b_operational_profile_unavailable"); }');
  const producer=text("prepareOriginalParentCommand");
  for(const pin of ['refuse("qualified_worker_closure_unavailable")','refuse("original_sealed_setup_unavailable")',
    'refuse("original_go_readback_proofs_unavailable")','"original_shutdown_authority_unavailable"','"original_cancellation_decision_unavailable"',
    'refuse("original_teardown_proofs_unavailable")'])assert.ok(producer.includes(pin),pin);
  assert.doesNotMatch(producer,/\breturn\b/);
  const effects=[],constructors=[],mapAccess=[];
  for(const fn of functions)walk(fn,n=>{
    if(ts.isCallExpression(n)){
      if(ts.isPropertyAccessExpression(n.expression)&&["write","end"].includes(n.expression.name.text))effects.push([fn.name.text,n.getText()]);
      if(["createUnsignedCohortAssemblyModel","createUnsignedProtocolDecoder"].includes(n.expression.getText()))constructors.push([fn.name.text,n.expression.getText()]);
    }
    const member=registryMember(n);if(member)mapAccess.push([fn.name.text,member]);
  });
  assert.deepEqual(effects,[['endOriginalParent','c.decoder.end()'],['writeOriginalParentCommand','write.pipe.write(write.line, "utf8", error => completeOriginalParentWrite(c, write, error))'],['endOriginalParentCommand','pipe.end()']]);
  assert.deepEqual(constructors,[['createOriginalParentOwner','createUnsignedCohortAssemblyModel'],['reserveOriginalParentSession','createUnsignedProtocolDecoder']]);
  assert.deepEqual(mapAccess,[['consumeOriginalParentCommandProof','parentCommandPlans.get'],['retainOriginalParentWrite','parentWrites.set'],['writeOriginalParentCommand','parentWrites.get']]);
  walk(root,n=>{const member=registryMember(n);if(member?.startsWith("parentCommandPlans."))assert.equal(member,"parentCommandPlans.get");});
  const pins={
    consumeOriginalParentCommandProof:['proof.owner !== c','proof.kind !== kind','proof.child !== c.child','proof.pipe !== c.pipes.command','proof.consumed','proof.consumed = true'],
    retainOriginalParentWrite:['generation > 5','c.pendingWrite','c.facts.commands.some(r => r.kind === frame.kind)','Object.freeze(Object.create(null))','started: false','committed: false, attempted: false'],
    planOriginalParentCommand:['c.commandBusy = true','consumeOriginalParentCommandProof(c, kind)','const line = encodeUnsignedTransportFrame(',
      'chargeHash(c.owner.s, Buffer.byteLength(line))','kind: "frame", payload: { line }','write.committed = true','armOriginalParentOperation(ref)'],
    sampleOriginalParentCompletion:['c.owner.active !== c','c.owner.generation !== c.generation','const d = syncOriginalParent(c); if (!currentOriginalParentHandler(c, c.child) || d.clock_invalid) return null',
      'const stopped = syncOriginalParent(c).stopped; if (!currentOriginalParentHandler(c, c.child)) return null',
      'if (!currentOriginalParentHandler(c, c.child)) return null','pending.decision === "started"','c.owner.coordinator.stop(q.stop_first)',
      'return currentOriginalParentHandler(c, c.child) ? at : null'],
    completeOriginalParentWrite:['!currentOriginalParentHandler(c, write.child, write.pipe, "command") || r.callback_seen || write.callbackClaimed || !write.attempted',
      'write.callbackClaimed = true',
      'assessUnsignedParentCallback(','r.observed_outcome = q.observed_outcome','r.observation_point = q.observation_point','r.decision = q.decision',
      'if (c.pendingWrite === write)','write.line = null','c.operationTimer.fact.command_generation === r.generation'],
    writeOriginalParentCommand:['write.owner !== c','write !== c.pendingWrite','!write.committed','write.attempted || r.started','r.decision !== "planned"',
      'qualifyOriginalParentPipe(c, write.child, write.pipe)','c.helperLease || c.owner.s.helper','c.operationTimer.fact.deadline_ns !== r.reservation.deadline_ns',
      'r.started = true; r.decision = "started"; relayOriginalParentWrite(c, r, "started", at)','const dispatch = checkOriginalParentSupervision(ref)',
      'write.attempted = true','r.backpressure = !returned','typeof returned !== "boolean"','if (r.callback_seen) failOriginalParentEvent(c, "write_failed")'],
    planOriginalParentShutdown:['c.shutdownConsidered','pending.record.decision === "started" && at','consumeOriginalParentCommandProof(c, "CANCEL")',
      'if (c.helperLease || c.owner.s.helper) refuse("parent_command_busy")',
      'c.phaseKey === w.phase + ":" + w.phase_deadline_ns && !c.phaseTimer?.active',
      'BigInt(pending.record.reservation.deadline_ns) - BigInt(at.monotonic_ns) < 1000000n',
      'BigInt(pending.record.reservation.deadline_ns) - BigInt(planned.monotonic_ns) < 1000000n',
      'c.shutdownDecision = "CLOSE_ONLY"','error?.message !== "cc4b3b_parent_command_pipe" || !currentOriginalParentHandler(c, c.child)',
      'd.clock_invalid','planned_ns: planned.monotonic_ns','chargeHash(c.owner.s, 65536)',
      'kind: "shutdown_plan", payload: {}','result.frame !== pending.line','pending.record.shutdown = true','armOriginalParentOperation(ref)'],
    relayOriginalParentEnd:['c.endRelayed','!pipe.close_seen','c.endRelayed = true','sampleOriginalParentCompletion(c)',
      'end.outcome === "returned" && pipe.finish_seen && !pipe.error','kind: "command_close"'],
    endOriginalParentCommand:['c.facts.command_end.decision !== "not_requested"','!c.shutdownConsidered','pending?.started && pending.decision === "started"',
      '"FINALIZE"','c.facts.command_end.decision = "withheld"','{ decision: "attempted", outcome: "unknown" }','c.facts.command_end.outcome = "returned"'],
  };
  for(const [name,values]of Object.entries(pins))for(const pin of values)assert.ok(text(name).includes(pin),name+": "+pin);
  const plan=text("planOriginalParentCommand"),write=text("writeOriginalParentCommand"),shutdown=text("planOriginalParentShutdown");
  assert.ok(plan.indexOf('c.commandBusy = true')<plan.indexOf('consumeOriginalParentCommandProof'));
  assert.ok(plan.indexOf('chargeHash')<plan.indexOf('retainOriginalParentWrite'));
  assert.ok(plan.indexOf('retainOriginalParentWrite')<plan.indexOf('applyModelEvent'));
  assert.ok(write.indexOf('const dispatch = checkOriginalParentSupervision')<write.indexOf('write.pipe.write'));
  assert.ok(write.indexOf('write.attempted = true')<write.indexOf('write.pipe.write'));
  assert.ok(shutdown.indexOf('chargeHash')<shutdown.indexOf('applyModelEvent'));
  assert.ok(text('completeOriginalParentWrite').indexOf('write.callbackClaimed = true')<text('completeOriginalParentWrite').indexOf('at = sampleOriginalParentCompletion(c)'));
  const checkpoints=get('sampleOriginalParentCompletion').body.statements;
  const stopIndex=checkpoints.findIndex(n=>ts.isIfStatement(n)&&n.expression.getText()==='q.stop_first');
  assert.equal(checkpoints[stopIndex+1].getText(),'if (!currentOriginalParentHandler(c, c.child)) return null;');
  const added=Object.keys(pins).map(text).join("\n");
  assert.doesNotMatch(added,/\bawait\b|setTimeout|clearTimeout|\.unref\(|\.destroy\(|\.kill\(|\.delete\(|\bDate\b|process\.|"drain"|createUnsignedWorkerTransportModel/);
  assert.match(s,/const \{ encodeUnsignedTransportFrame \} = await import\("\.\/unsignedWorkerTransportContracts\.mjs"\);/);
}
test("B4-B5 one-shot effects remain original, privately gated and single-ledger",()=>{
  guard(source);guard(source.replace(/\r?\n/g,"\r\n"));
});
test("B4-B5 mutation probes reject renewal, duplicated dispatch and missing ownership",()=>{
  const s=source.replace(/\r\n/g,"\n");
  for(const [from,to]of [
    ['refuse("original_go_readback_proofs_unavailable")','return {}'],
    ['const parentCommandPlans = new WeakMap(), parentWrites = new WeakMap();','const parentCommandPlans = new WeakMap(), parentWrites = new WeakMap(); parentCommandPlans.set({}, {});'],
    ['const parentCommandPlans = new WeakMap(), parentWrites = new WeakMap();','const parentCommandPlans = new WeakMap(), parentWrites = new WeakMap(); parentCommandPlans["set"]({}, {});'],
    ['const parentCommandPlans = new WeakMap(), parentWrites = new WeakMap();','const parentCommandPlans = new WeakMap(), parentWrites = new WeakMap(); parentCommandPlans["s"+"et"]({}, {});'],
    ['proof.owner !== c','false'],['proof.pipe !== c.pipes.command','false'],['generation > 5','generation > 6'],
    ['committed: false, attempted: false','committed: true, attempted: false'],
    ['chargeHash(c.owner.s, Buffer.byteLength(line))','void 0'],['write !== c.pendingWrite','false'],['write.attempted || r.started','false || r.started'],
    ['c.operationTimer.fact.deadline_ns !== r.reservation.deadline_ns','false'],
    ['const dispatch = checkOriginalParentSupervision(ref)','const dispatch = at'],['r.backpressure = !returned','r.backpressure = false'],
    ['if (r.callback_seen) failOriginalParentEvent(c, "write_failed");',''],
    ['write.callbackClaimed = true;',''],
    ['const d = syncOriginalParent(c); if (!currentOriginalParentHandler(c, c.child) || d.clock_invalid) return null;','const d = syncOriginalParent(c); if (d.clock_invalid) return null;'],
    ['if (c.helperLease || c.owner.s.helper) refuse("parent_command_busy");',''],
    ['c.phaseKey === w.phase + ":" + w.phase_deadline_ns && !c.phaseTimer?.active','false'],
    ['BigInt(pending.record.reservation.deadline_ns) - BigInt(at.monotonic_ns) < 1000000n','BigInt(pending.record.reservation.deadline_ns) - BigInt(at.monotonic_ns) <= 0n'],
    ['BigInt(pending.record.reservation.deadline_ns) - BigInt(planned.monotonic_ns) < 1000000n','BigInt(pending.record.reservation.deadline_ns) - BigInt(planned.monotonic_ns) <= 0n'],
    ['r.observation_point = q.observation_point','r.observation_point = null'],['r.decision = q.decision','r.decision = q.observed_outcome'],
    ['planned_ns: planned.monotonic_ns','planned_ns: at.monotonic_ns'],['result.frame !== pending.line','false'],
    ['error?.message !== "cc4b3b_parent_command_pipe" || !currentOriginalParentHandler(c, c.child)','false'],
    ['chargeHash(c.owner.s, 65536)','void 0'],['!pipe.close_seen','false'],
    ['end.outcome === "returned" && pipe.finish_seen && !pipe.error','end.outcome === "returned"'],
    ['pipe.end();','pipe.end(); pipe.end();'],
    ['write.pipe.write(write.line, "utf8", error => completeOriginalParentWrite(c, write, error))','write.pipe.write(write.line, "utf8", () => {})'],
  ]){assert.ok(s.includes(from),from);assert.throws(()=>guard(s.replace(from,to)),undefined,from);}
  const root=parse(s).statements[4],sample=root.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='sampleOriginalParentCompletion');
  const checkpoints=sample.body.statements,stopIndex=checkpoints.findIndex(n=>ts.isIfStatement(n)&&n.expression.getText()==='q.stop_first');
  const gate=checkpoints[stopIndex+1];assert.throws(()=>guard(s.slice(0,gate.getStart())+s.slice(gate.end)));
});
test("B4-B5 memory harness denies effects before importing connection helpers",()=>{
  const s=read("./nativeBarAdmissionUnsignedParentWrite.test.mjs"),first=s.indexOf('await import("../helpers/');
  for(const pin of ['syncBuiltinESMExports();','block(child, ["spawn", "spawnSync"','block(workers, ["Worker", "MessageChannel", "BroadcastChannel"])',
    'block(timerPromises, ["setTimeout", "setInterval", "setImmediate"])','block(fsp, [...mutations, ...scans])',
    '[globalThis, "Date", ["now"]]','[process, "hrtime", ["bigint"]]','block(crypto, ["sign", "verify"'])
    assert.ok(s.indexOf(pin)>=0&&s.indexOf(pin)<first,pin);
  assert.ok(s.includes('vm.compileFunction'));assert.ok(s.includes('parentCommandPlans.set(ref,p)'));
  assert.ok(s.lastIndexOf('syncBuiltinESMExports();',first)>s.indexOf('if (typeof Temporal === "object")'));
  assert.doesNotMatch(s,/process\.env\s*[.[]|build_unsigned\.mjs|fixedMemoryCheckpointOracle/);
  assert.equal(s.lastIndexOf('\ntest('),s.indexOf('\ntest("B4-B5 no denied effect was swallowed"'));
  const transport=read('../helpers/unsignedWorkerTransportContracts.mjs');
  assert.ok(transport.includes('export function encodeUnsignedTransportFrame(value) { return boundedFrame(value); }'));
});
