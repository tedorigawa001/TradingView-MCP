import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createUnsignedIsolatedTypeScript } from "../helpers/unsignedIsolatedTypeScript.mjs";

const ts=createUnsignedIsolatedTypeScript(readFileSync(new URL('../../node_modules/typescript/lib/typescript.js',import.meta.url),'utf8'));

const read=f=>readFileSync(new URL(f,import.meta.url),"utf8");
const parse=s=>ts.createSourceFile("checked.mjs",s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const walk=(node,fn)=>{fn(node);ts.forEachChild(node,n=>walk(n,fn));};
const runtime=read('../helpers/unsignedCohortRuntime.mjs'),harness=read('./nativeBarAdmissionUnsignedParentComposition.test.mjs'),parser=read('../helpers/unsignedIsolatedTypeScript.mjs');
function parserGuard(s){
  const tree=parse(s);assert.equal(tree.parseDiagnostics.length,0);
  assert.equal(tree.statements[0].getText(),'import vm from "node:vm";');
  for(const pin of ['vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}})',
    'globalThis.performance=Object.freeze({now:()=>0})','static now(){return 0;}','if(ts.sys!==undefined)throw Error("cc4b6_parser_system")',
    'Intl:{value:undefined,writable:false,configurable:false}','Temporal:{value:undefined,writable:false,configurable:false}',
    'node_globals:[typeof process,typeof require,typeof setTimeout,typeof clearTimeout,typeof fetch,typeof Buffer]'])assert.ok(s.includes(pin),pin);
  assert.doesNotMatch(s,/readFile|writeFile|child_process|import\(|setTimeout\s*\(|new Date\s*\(/);
}
function runtimeGuard(s){
  const tree=parse(s);assert.equal(tree.parseDiagnostics.length,0);assert.equal(tree.statements.length,5);
  assert.equal(tree.statements[2].getText(),'export function executeUnsignedCohortAssembly() { throw Error("cc4b2_execution_not_approved"); }');
  const root=tree.statements[4],functions=root.body.statements.filter(ts.isFunctionDeclaration),get=name=>functions.find(n=>n.name.text===name);
  assert.equal(get('originalQualificationPolicy').getText(),'function originalQualificationPolicy() { throw Error("cc4b3b_operational_profile_unavailable"); }');
  const calls=[];for(const f of functions)walk(f,n=>{if(ts.isCallExpression(n)&&['createUnsignedCohortAssemblyModel','createUnsignedProtocolDecoder'].includes(n.expression.getText()))calls.push([f.name.text,n.expression.getText()]);});
  assert.deepEqual(calls,[['createOriginalParentOwner','createUnsignedCohortAssemblyModel'],['reserveOriginalParentSession','createUnsignedProtocolDecoder']]);
  assert.doesNotMatch(s,/createUnsignedWorkerTransportModel|createUnsignedWorkerLifetimeModel/);
  const refs=[];walk(tree,n=>{if(ts.isIdentifier(n)&&n.text==='prepareOriginalQualification')refs.push(n);});assert.equal(refs.length,1);
  const blockers=get('prepareOriginalParentCommand').getText();assert.doesNotMatch(blockers,/\breturn\b/);
  for(const code of ['qualified_worker_closure_unavailable','original_sealed_setup_unavailable','original_go_readback_proofs_unavailable',
    'original_shutdown_authority_unavailable','original_cancellation_decision_unavailable','original_teardown_proofs_unavailable'])assert.ok(blockers.includes(code),code);
}
function harnessGuard(s){
  const tree=parse(s);assert.equal(tree.parseDiagnostics.length,0);const first=s.indexOf('await import("../helpers/');assert.ok(first>0);
  for(const pin of ['block(child, ["spawn", "spawnSync"','block(workers, ["Worker", "MessageChannel", "BroadcastChannel"])',
    'block(crypto, ["sign", "verify"','block(fsp, [...mutations, ...scans])','[globalThis, "Date", ["now"]]',
    '[process, "hrtime", ["bigint"]]','block(timerPromises, ["setTimeout", "setInterval", "setImmediate"])'])assert.ok(s.indexOf(pin)>=0&&s.indexOf(pin)<first,pin);
  assert.ok(s.lastIndexOf('syncBuiltinESMExports();',first)>s.indexOf('if (typeof Temporal === "object")'));
  assert.ok(s.includes('import * as cachedProcess from "node:process"'));
  assert.doesNotMatch(s,/\bimport\s+[^;\n]*\bfrom\s*["']typescript["']|\bimport\(["']typescript["']\)/);
  assert.ok(s.indexOf('const ts=createUnsignedIsolatedTypeScript(compilerSource)')>first);
  const functions=tree.statements.filter(ts.isFunctionDeclaration),memory=functions.find(n=>n.name.text==='memory'),connected=functions.find(n=>n.name.text==='connected');
  walk(memory,n=>{if(ts.isIdentifier(n))assert.notEqual(n.text,'reference','reference oracle leaked into VM context');});
  assert.doesNotMatch(memory.getText(),/createUnsignedWorkerTransportModel/);
  const text=connected.getText();assert.ok(text.indexOf('const reference=createUnsignedWorkerTransportModel')>text.indexOf('finally { e.c.pipes.command.write=originalWrite;e.worker=originalWorker; }'));
  assert.ok(text.includes('assert.equal(bootstrap.length,14)'));assert.ok(text.includes('assert.equal(e.models,1);assert.equal(e.decoders,1)'));
  assert.ok(text.includes('assert.equal(owner.coordinator,coordinator)'));assert.ok(text.includes('assert.equal(e.c.decoder,decoder)'));
  assert.ok(text.includes('assert.equal(actual.terminal.facts.pending_generation,t.pending_generation'));
  assert.ok(text.includes('assert.equal(r.callback_seen,w.callback!==null,"original callback observation")'));
  const prepare=functions.find(n=>n.name.text==='prepareMutation').getText();
  for(const pin of ['text.split(from).length===2','assert.notEqual(changed,text','parseDiagnostics.length,0'])assert.ok(prepare.includes(pin));
  const bodies=[];walk(tree,n=>{if(ts.isCallExpression(n)&&n.expression.getText()==='test')bodies.push(n);});
  const mutation=bodies.find(n=>n.arguments[0].getText().includes('controlled behavioral mutation is detected')).arguments[1].body.statements;
  const prepared=mutation.find(n=>ts.isVariableStatement(n)&&n.getText()==='const prepared=prepareMutation(source,from,to);');
  const rejected=mutation.find(n=>n.getText().startsWith('await assert.rejects('));assert.ok(prepared&&rejected&&prepared.end<rejected.pos);
  const drain=bodies.find(n=>n.arguments[0].getText().includes('original CANCEL drains')).arguments[1].body.getText();
  assert.ok(drain.includes('assertSuppliedCleanupGate(s)'));assert.ok(drain.includes('actual.pending_generation,null'));
  assert.ok(functions.find(n=>n.name.text==='assertSuppliedCleanupGate').getText().includes('s.receipt("cleanup_precheck",{inventory_sha256:h})'));
  assert.doesNotMatch(s,/process\.env\s*[.[]|build_unsigned\.mjs|fixedMemoryCheckpointOracle|\.skip\(|\.todo\(/);
  assert.equal(s.lastIndexOf('\ntest('),s.indexOf('\ntest("B4-B6 no denied effect was swallowed"'));
}
test('B4-B6 keeps one original admission owner and all public/producer seals',()=>{
  runtimeGuard(runtime);runtimeGuard(runtime.replace(/\r?\n/g,'\r\n'));harnessGuard(harness);harnessGuard(harness.replace(/\r?\n/g,'\r\n'));
  parserGuard(parser);parserGuard(parser.replace(/\r?\n/g,'\r\n'));
});
test('B4-B6 boundary mutations cannot open execution or feed the oracle into the connection',()=>{
  const r=runtime.replace(/\r\n/g,'\n'),h=harness.replace(/\r\n/g,'\n');
  for(const [from,to]of [
    ['throw Error("cc4b2_execution_not_approved");','return {};'],['throw Error("cc4b3b_operational_profile_unavailable");','return {};'],
    ['c.decoder = createUnsignedProtocolDecoder();','c.decoder = createUnsignedProtocolDecoder(); createUnsignedProtocolDecoder();'],
    ['const { encodeUnsignedTransportFrame }','const { createUnsignedWorkerTransportModel }'],
  ]){assert.ok(r.includes(from));assert.throws(()=>runtimeGuard(r.replace(from,to)));}
  assert.throws(()=>harnessGuard(h.replace('const context = { ...data','const context = { reference: {}, ...data')));
  const sync=h.lastIndexOf('syncBuiltinESMExports();',h.indexOf('await import("../helpers/'));
  assert.throws(()=>harnessGuard(h.slice(0,sync)+h.slice(sync+'syncBuiltinESMExports();'.length)));
  const tree=parse(h),connected=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='connected');
  const declaration=connected.body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText()==='reference'));
  const without=h.slice(0,declaration.getStart())+h.slice(declaration.end),insertion=without.indexOf('  try { await activeSession(e); }');
  assert.throws(()=>harnessGuard(without.slice(0,insertion)+declaration.getText()+'\n'+without.slice(insertion)));
  assert.throws(()=>harnessGuard(h.replace('const ts=createUnsignedIsolatedTypeScript(compilerSource);','const {default:ts}=await import("typescript");')));
  for(const [from,to]of [['now:()=>0','now:Date.now'],['strings:false,wasm:false','strings:true,wasm:false'],
    ['vm.createContext(Object.create(null)','vm.createContext({process}']]){assert.ok(parser.includes(from));assert.throws(()=>parserGuard(parser.replace(from,to)));}
  for(const from of ['Intl:{value:undefined,writable:false,configurable:false},','Temporal:{value:undefined,writable:false,configurable:false}'])
    assert.throws(()=>parserGuard(parser.replace(from,'')));
  for(const from of ['const prepared=prepareMutation(source,from,to);','assert.equal(r.callback_seen,w.callback!==null,"original callback observation");',
    'assertSuppliedCleanupGate(s);']){assert.ok(h.includes(from));assert.throws(()=>harnessGuard(h.replace(from,'')));}
});
test('B4-B6 adds no product registration or build/native connection',()=>{
  for(const name of readdirSync(new URL('../../src/',import.meta.url),{recursive:true}).filter(n=>n.endsWith('.ts')))
    assert.doesNotMatch(read('../../src/'+name),/ParentComposition|nativeBarAdmissionUnsignedParentComposition|unsignedIsolatedTypeScript|createUnsignedIsolatedTypeScript/);
  assert.doesNotMatch(read('../../package.json'),/ParentComposition|nativeBarAdmissionUnsignedParentComposition|unsignedIsolatedTypeScript|createUnsignedIsolatedTypeScript/);
});
