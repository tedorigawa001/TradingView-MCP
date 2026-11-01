import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createUnsignedIsolatedTypeScript } from "../helpers/unsignedIsolatedTypeScript.mjs";

const read=name=>fs.readFileSync(new URL(name,import.meta.url),"utf8");
const ts=createUnsignedIsolatedTypeScript(read("../../node_modules/typescript/lib/typescript.js"));
const source=read("../helpers/unsignedWorkerPreparationContracts.mjs"),harness=read("./nativeBarAdmissionUnsignedWorkerPreparation.test.mjs");
const parse=s=>ts.createSourceFile("checked.mjs",s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function guard(input) {
  const s=input.replace(/\r\n/g,"\n"),tree=parse(s);assert.equal(tree.parseDiagnostics.length,0);
  assert.deepEqual(Array.from(tree.statements.filter(n=>n.importClause),n=>n.moduleSpecifier.text),["zod","./unsignedControllerData.mjs","./unsignedWorkerConfiguration.mjs",
    "./unsignedCohortQualificationContracts.mjs","./unsignedWorkerTransportContracts.mjs","./jointUnsignedAcceptanceContracts.mjs"]);
  assert.deepEqual(Array.from(tree.statements.filter(n=>/^export\s/.test(n.getText())),n=>n.name?.text),["planUnsignedWorkerPreparation","describeUnsignedWorkerPreparationCapacity","createUnsignedWorkerPreparationModel"]);
  const walk=n=>{if(ts.isIdentifier(n))assert.ok(!["process","global","globalThis","Date","performance","Temporal","Intl","require","Worker","MessageChannel","BroadcastChannel","setTimeout","setImmediate","fetch","eval","Function","WeakRef","FinalizationRegistry"].includes(n.text),n.text);
    if(ts.isCallExpression(n))assert.ok(!/^(?:import\(|Object\.(?:defineProperty|setPrototypeOf|assign)|Reflect\.)/.test(n.expression.getText()),n.expression.getText());ts.forEachChild(n,walk);};walk(tree);
  const pins=['scope: "unsigned_worker_preparation_memory_only", runtime_completion_proven: false','return Object.freeze({ record, describe: view });',
    'matching(refs.session, session)','encodeUnsignedTransportFrame(q);','if (pending && last >= BigInt(pending.fact.deadline_ns))',
    'if (!op.fact.callback_seen || !op.fact.return_seen) return;','if (ref !== expected || expected === null) refuse("original_reference");',
    'liveReferences(q.references);','q.clock_domain !== d.clock.worker_domain) refuse("baseline_binding");',
    'wireCharge(frames[q.kind]);','BigInt(v.startups) * (BigInt(v.record_bytes)',
    'hash > BigInt(profile.hash_work_bytes) || commands > profile.helper_commands',
    'diagnostic > 16384 || diagnostic > 65536','sum(retained) > transport.retained_buffer_bytes','sum(transient) > transport.transient_buffer_bytes',
    'case "command": refuse("command_outside_preparation");','if (q.outcome === "refused") { settle(op); stop("bootstrap_refused"); }',
    'if (op.fact.observed_outcome === "completed" && op.fact.write_return !== null) settle(op);','statusError ??= q.reason;',
    'if (at === null) op.fact.decision = "uncertain";','wireCharge(2 * byteLength(canonical(q.configuration)) + recipeBytes);',
    'if (!stopped || startup !== null && !["returned", "refused"].includes(startupResult)) refuse("anchor_retained");',
    'return ref === null ? null : take(ref, "status");','if (statusClosed) refuse("status_close_once");',
    'if (pending?.fact.started) pending.fact.decision = "uncertain";'];
  for(const pin of pins)assert.ok(s.includes(pin),pin);
  const prepare=s.slice(s.indexOf('case "prepare":'),s.indexOf('case "bootstrap_begin":'));
  assert.ok(prepare.indexOf('wireCharge(')<prepare.indexOf('describeUnsignedFixture('));
  assert.ok(prepare.indexOf('wireCharge(')<prepare.indexOf('validateUnsignedWorkerConfiguration('));
  assert.doesNotMatch(s,/createUnsignedWorkerTransportModel|createUnsignedControllerProtocolModel|\.unref\(|createPublicKey|enroll.*Oracle|dlopen|spawn|readFile|writeFile/);
}
test("C1-16 helper is pure, has only the three approved exports and keeps every required gate",()=>{guard(source);guard(source.replace(/\r?\n/g,"\r\n"));});
test("C1-16 boundary guard rejects individual effect/export/authority/capacity mutations",()=>{
  const s=source.replace(/\r\n/g,"\n");
  for(const [from,to]of [['"./unsignedWorkerConfiguration.mjs"','"./unsignedCohortRuntime.mjs"'],['scope: "unsigned_worker_preparation_memory_only", runtime_completion_proven: false','scope: "unsigned_worker_preparation_memory_only", runtime_completion_proven: true'],
    ['matching(refs.session, session)','void 0'],['encodeUnsignedTransportFrame(q);','void 0;'],['diagnostic > 16384 || diagnostic > 65536','false'],
    ['liveReferences(q.references);','void 0;'],['sum(retained) > transport.retained_buffer_bytes','false'],['sum(transient) > transport.transient_buffer_bytes','false'],
    ['case "command": refuse("command_outside_preparation");','case "command": break;'],
    ['if (op.fact.observed_outcome === "completed" && op.fact.write_return !== null) settle(op);','void 0;'],
    ['statusError ??= q.reason;','void 0;'],['if (at === null) op.fact.decision = "uncertain";','void 0;'],
    ['wireCharge(2 * byteLength(canonical(q.configuration)) + recipeBytes);','void 0;'],
    ['if (!stopped || startup !== null && !["returned", "refused"].includes(startupResult)) refuse("anchor_retained");','if (!stopped || startupResult === null && startup !== null) refuse("anchor_retained");'],
    ['return ref === null ? null : take(ref, "status");','return take(ref, "status");'],['if (statusClosed) refuse("status_close_once");','void 0;'],
    ['if (pending?.fact.started) pending.fact.decision = "uncertain";','void 0;']]){
    assert.equal(s.split(from).length,2);const changed=s.replace(from,to);assert.equal(parse(changed).parseDiagnostics.length,0);assert.throws(()=>guard(changed),e=>e.code==="ERR_ASSERTION");
  }
  assert.throws(()=>guard(s+'\nexport function execute() {}'),e=>e.code==="ERR_ASSERTION");
  assert.throws(()=>guard(s+'\nprocess.hrtime.bigint();'),e=>e.code==="ERR_ASSERTION");
});
function harnessGuard(input){
  const harness=input.replace(/\r\n/g,"\n"),first=harness.indexOf('await import("../helpers/');assert.ok(first>0);
  for(const pin of ['block(workers,["Worker","MessageChannel","BroadcastChannel"])','block(child,["spawn"','block(crypto,["sign","verify"',
    'block(fsp,[...mutations,...scans])','[globalThis,"Date",["now"]]','[process,"hrtime",["bigint"]]','block(timerPromises,["setTimeout"'])assert.ok(harness.indexOf(pin)>=0&&harness.indexOf(pin)<first,pin);
  assert.ok(harness.lastIndexOf('syncBuiltinESMExports();',first)>harness.indexOf('if(typeof Temporal'));
  for(const pin of ['block(listenerPrototype,["listen"])','block(datagramPrototype,["bind"])',
    'block(net,["connect","createConnection","createServer","Server"])','block(dgram,["createSocket","Socket"])'])assert.ok(harness.indexOf(pin)>=0&&harness.indexOf(pin)<first,pin);
  for(const pin of ['[net,"Server"],[listenerPrototype,"listen"],[dgram,"Socket"],[datagramPrototype,"bind"]',
    'listenerPrototype.listen.call(Object.create(null))','datagramPrototype.bind.call(Object.create(null))'])assert.ok(harness.includes(pin),pin);
  assert.doesNotMatch(harness,/from ["']typescript["']|import\(["']typescript["']\)|\.skip\(|\.todo\(/);
  assert.equal(harness.lastIndexOf('\ntest("C1 no denied effect was swallowed"'),harness.lastIndexOf('\ntest('));
}
test("C1-16 memory harness installs effect tripwires before helper imports and uses only the isolated parser",()=>{harnessGuard(harness);harnessGuard(harness.replace(/\r?\n/g,"\r\n"));});
test("C1 review: omitted direct listener tripwires fail statically without opening a port",()=>{
  const s=harness.replace(/\r\n/g,"\n");
  for(const from of ['block(listenerPrototype,["listen"]);','block(datagramPrototype,["bind"]);',
    'block(net,["connect","createConnection","createServer","Server"]);','block(dgram,["createSocket","Socket"]);']){
    assert.equal(s.split(from).length,2);const changed=s.replace(from,'');assert.equal(parse(changed).parseDiagnostics.length,0);assert.throws(()=>harnessGuard(changed),e=>e.code==="ERR_ASSERTION");}
});
test("C1-12 product/worker/package entries do not import the preparation model",()=>{
  for(const f of ["../helpers/unsignedCohortRuntime.mjs","../helpers/unsignedInertAdapters.mjs","../../native/native_bar_fs/test_unsigned_worker.mjs","../../package.json"])
    assert.doesNotMatch(read(f),/unsignedWorkerPreparation|UnsignedWorkerPreparation/);
  for(const f of fs.readdirSync(new URL("../../src/",import.meta.url),{recursive:true}).filter(n=>n.endsWith('.ts')))
    assert.doesNotMatch(read("../../src/"+f),/unsignedWorkerPreparation|UnsignedWorkerPreparation/);
  assert.equal(fs.existsSync(new URL("../../native/native_bar_fs/test_unsigned_cohort_worker.mjs",import.meta.url)),false);
});
