import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import child from "node:child_process";
import workers from "node:worker_threads";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";
import tls from "node:tls";
import dns from "node:dns";
import timers from "node:timers";
import timerPromises from "node:timers/promises";
import inspector from "node:inspector";
import inspectorPromises from "node:inspector/promises";
import v8 from "node:v8";
import nodeModule, { syncBuiltinESMExports } from "node:module";
import * as cachedProcess from "node:process";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const sqlite = await import("node:sqlite").then(m => m.default, () => null);
const listenerPrototype=net.Server.prototype,datagramPrototype=dgram.Socket.prototype;
const effects = [], restores = [], blocked = [];
const replace = (o,k,f) => {
  const d=Object.getOwnPropertyDescriptor(o,k), accessor=d && !("value" in d);
  if(accessor)Object.defineProperty(o,k,{value:f,configurable:true,writable:true,enumerable:d.enumerable});else o[k]=f;
  restores.push(()=>{if(accessor)Object.defineProperty(o,k,d);else if(d)o[k]=d.value;else delete o[k];});
};
const block=(o,keys)=>keys.filter(k=>typeof o[k]==="function").forEach(k=>{
  blocked.push([o,k]);replace(o,k,function(){effects.push(k);throw Error("c1_forbidden_effect");});
});
block(child,["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork","ChildProcess"]);
block(workers,["Worker","MessageChannel","BroadcastChannel"]);
block(crypto,["sign","verify","createSign","createVerify","createPrivateKey","createPublicKey","createSecretKey","generateKey","generateKeySync",
  "generateKeyPair","generateKeyPairSync","randomBytes","randomUUID","privateEncrypt","privateDecrypt","publicEncrypt","publicDecrypt",
  "diffieHellman","createDiffieHellman","createECDH","Sign","Verify","DiffieHellman","DiffieHellmanGroup","ECDH","getDiffieHellman","createDiffieHellmanGroup"]);
block(crypto.webcrypto.subtle,["sign","verify","generateKey","importKey","exportKey","deriveKey","deriveBits","encrypt","decrypt","wrapKey","unwrapKey"]);
block(process,["dlopen","kill","chdir","execve","binding","_linkedBinding","getBuiltinModule","loadEnvFile"]);
block(listenerPrototype,["listen"]);block(datagramPrototype,["bind"]);
block(net,["connect","createConnection","createServer","Server"]);block(net.Socket.prototype,["connect"]);
block(http,["request","get","createServer"]);block(https,["request","get","createServer"]);block(http2,["connect","createServer","createSecureServer"]);
block(dgram,["createSocket","Socket"]);block(tls,["connect","createServer"]);
for(const o of [dns,dns.promises])block(o,Object.keys(o).filter(k=>/^(lookup|resolve|reverse)/.test(k)));
block(inspector,["open","Session"]);block(inspectorPromises,["open","Session"]);block(v8,["writeHeapSnapshot"]);block(process.report,["writeReport"]);
block(globalThis,["fetch","WebSocket","EventSource","MessageChannel","BroadcastChannel","setTimeout","clearTimeout","setInterval","clearInterval","setImmediate","clearImmediate","queueMicrotask"]);
block(AbortSignal,["timeout"]);if(sqlite)block(sqlite,["Database","DatabaseSync","backup"]);
const resolution=sqlite&&typeof nodeModule.registerHooks==="function"?nodeModule.registerHooks({resolve(s,c,next){
  if(s==="node:sqlite"){effects.push(s);throw Error("c1_forbidden_effect");}return next(s,c);}}):null;
if(resolution)restores.push(()=>resolution.deregister());
block(timers,["setTimeout","setInterval","setImmediate","clearTimeout","clearInterval","clearImmediate"]);
block(timerPromises,["setTimeout","setInterval","setImmediate"]);block(timerPromises.scheduler,["wait","yield"]);
const mutations=["writeFile","appendFile","copyFile","cp","truncate","ftruncate","mkdir","mkdtemp","unlink","rmdir","rm","rename",
  "chmod","fchmod","lchmod","chown","fchown","lchown","symlink","link","utimes","futimes","lutimes"];
const scans=["glob","statfs","watch","mkdtempDisposable"];
block(fs,[...mutations,...mutations.map(k=>k+"Sync"),...scans,...scans.map(k=>k+"Sync"),"createWriteStream","ReadStream","FileReadStream","WriteStream","FileWriteStream","Utf8Stream","openAsBlob","watchFile"]);
block(fsp,[...mutations,...scans]);
const roots=["../helpers/","../../node_modules/"].map(s=>fileURLToPath(new URL(s,import.meta.url)));
roots.push(...roots.map(s=>fs.realpathSync(s)+sep));
const metadata=["stat","lstat","readdir","opendir","access","readlink","realpath"];
const readers=[[fs,"open",a=>a[0]],[fs,"openSync",a=>a[0]],[fs,"readFile",a=>a[0]?.flag],[fs,"readFileSync",a=>a[0]?.flag],
  [fs,"createReadStream",a=>a[0]?.flags],[fs,"exists",()=>undefined],[fs,"existsSync",()=>undefined],
  ...metadata.flatMap(k=>[[fs,k,()=>undefined],[fs,k+"Sync",()=>undefined],[fsp,k,()=>undefined]]),[fsp,"open",a=>a[0]],[fsp,"readFile",a=>a[0]?.flag]];
for(const [o,k,flag]of readers){if(typeof o[k]!=="function")continue;const original=o[k];replace(o,k,(p,...a)=>{
  const full=resolve(p instanceof URL?fileURLToPath(p):String(p)),f=flag(a);
  if((f===undefined||f==="r"||f===0)&&roots.some(r=>full.startsWith(r)))return original.call(o,p,...a);
  effects.push(k);throw Error("c1_forbidden_read");});}
for(const [o,k,statics]of [[globalThis,"Date",["now"]],[process,"hrtime",["bigint"]]]){
  const deny=name=>function(){effects.push(name);throw Error("c1_forbidden_effect");};const f=Object.assign(deny(k),Object.fromEntries(statics.map(n=>[n,deny(n)])));
  replace(o,k,f);blocked.push([o,k],...statics.map(n=>[f,n]));
}
block(process,["uptime","cpuUsage","resourceUsage"]);block(performance,["now"]);
if(typeof Temporal==="object")block(Temporal.Now,Object.getOwnPropertyNames(Temporal.Now));
syncBuiltinESMExports();
test.after(()=>{restores.reverse().forEach(f=>f());syncBuiltinESMExports();assert.deepEqual(effects,[]);});

const preparation=await import("../helpers/unsignedWorkerPreparationContracts.mjs");
const data=await import("../helpers/unsignedControllerData.mjs");
const protocol=await import("../helpers/unsignedControllerContracts.mjs");
const recipes=await import("../helpers/jointUnsignedAcceptanceContracts.mjs");
const {createUnsignedIsolatedTypeScript}=await import("../helpers/unsignedIsolatedTypeScript.mjs");
const ts=createUnsignedIsolatedTypeScript(fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js",import.meta.url),"utf8"));
const {planUnsignedWorkerPreparation:plan,createUnsignedWorkerPreparationModel:create,describeUnsignedWorkerPreparationCapacity:capacity}=preparation;
const {digest,canonical,byteLength}=data,h="a".repeat(64),clone=v=>JSON.parse(JSON.stringify(v));
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
function allocation(case_id="u1-unsigned",mode="normal") {return {fixture:{request:{schema:"native-bar-unsigned-acceptance-request-v1",stage:"C-C1a",run_id:"invented-run",
  source_commit:"a".repeat(40),patch_sha256:"b".repeat(64)},case_id,mode,ids:Object.fromEntries(["fixture","store","epoch","authority","key","reference","extra"].map((k,i)=>[k,uuid(i+1)]))},
  exchange_id:"exchange-1",launch_nonce:"nonce-1",source_tree_sha256:h,signature_profile:"linker_adhoc",artifacts:Object.fromEntries(["js_set_sha256","addon_sha256","observer_sha256","controller_sha256","worker_sha256","runtime_closure_sha256","node_binary_sha256","build_record_sha256","reader_source_sha256","reader_js_sha256"].map(k=>[k,h]))};}
function subject(case_id,mode) {const a=allocation(case_id,mode);return {allocation:a,launch_binding_sha256:digest(protocol.createUnsignedControllerProtocolModel(a).describe().binding),
  closed_set_sha256:h,module_set_sha256:h,clock:{parent_domain:"parent-clock",worker_domain:"worker-clock",started_ns:"0",local_end_ns:"900000000000"},
  components:Object.fromEntries(["closed_set","build_record","module_set","host_profile","native_profile","work_plan"].map(k=>[k,"matched_supplied"])),
  manifest:{rows:8,pages:1,page_rows:8,page_bytes:4096,manifest_bytes:4096,record_bytes:8192,file_bytes:"65536"},
  work:{case_count:24,modes:["normal","ubsan"].map(mode=>({mode,startups:12,record_bytes:"8192",module_bytes:"65536",pin_bytes:"65536",metadata_hash_bytes:"4096",helper_commands:8})),
    wire_hash_bytes_per_start:"1048576",other_hash_bytes:"1000",other_helper_commands:4}};}
const at=n=>({clock_domain:"worker-clock",monotonic_ns:String(n)});
function configuration(f) {
  const recipe=recipes.describeUnsignedFixture(f),proof=(inode,mode="16832",uid="501",gid="20")=>({device:"1",inode:String(inode),uid,gid,mode,flags:"0",birthtime_ns:"1",acl:"none",acl_hash:h});
  const marker=(path,inode)=>{const e=recipe.entries.find(e=>e.path===path);return {...proof(inode,"33152"),nlink:"1",size:e.size,sha256:e.sha256};};
  const registration={schema:"native-bar-admission-read-registration-v1",scope:"synthetic_fixture_only",temp_anchor:"/private/tmp",fixture_name:f.fixture_name,
    policy_hash:recipe.entries.find(e=>e.path==="store/policy.json").sha256,authority_reference:f.ids.reference,
    pins:{fixture_id:f.ids.fixture,store_id:f.ids.store,epoch_id:f.ids.epoch,authority_id:f.ids.authority,key_id:f.ids.key,enrollment_hash:"2".repeat(64),
      public_key_spki_sha256:crypto.createHash("sha256").update(Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a","hex")).digest("hex")},
    bindings:{ancestors:["/","/private","/private/tmp"].map((path,i)=>({path,proof:proof(i+1,i===2?"17407":"16877","0","0")})),fixture_parent:proof(100),data:proof(101),witness:proof(102),
      markers:{base:marker(".native-bar-fs-synthetic",103),admission:marker(".native-bar-admission-synthetic",104)}},
    volume:{filesystem:"apfs",local:true,ownership_enforced:true,case_preserving:true,case_sensitive:false,read_only_mount:false}};
  const inventory={entries:"16",inventory_bytes:"1048576",metadata_bytes:"1048576"};
  return {schema:"native-bar-unsigned-worker-configuration-v1",binding:{schema:"native-bar-joint-read-binding-v1",scope:"synthetic_joint_read_model_only",registration,registration_hash:digest(registration)},
    work_envelope:{schema:"native-bar-joint-read-work-envelope-v1",inventory:Object.fromEntries(["data","witness","common"].map(k=>[k,{...inventory}])),
      objects:{witness_records:String(recipe.witness_slots),producer_mirrors:"0",payloads:"0",receipts:"0",maintenance_metadata:String(recipe.maintenance_slots)},
      selected_bytes:String(16384*recipe.witness_slots+65536*recipe.maintenance_slots),decoded_bytes:"1048576",interpretation_bytes:"1048576"}};
}
function environment(s=subject(),factory=create) {
  const m=factory(s);let now=1n;
  const r=f=>m.record({...f,at:f.at===undefined?at(now++):f.at});
  const launch=r({type:"launch",kind:"LAUNCH",direction:"parent",ordinal:1,binding_sha256:s.launch_binding_sha256,setup:null});
  const session=launch.session_ref;
  const record=f=>r({session,...f});
  const pair=record({type:"pair_allocate",ports:["unreferenced","unreferenced"]}).pair_ref;
  for(const index of [0,1]){record({type:"pair_listeners",pair,index,event:"installed"});record({type:"pair_reference",pair,index,outcome:"returned",has_ref:true});}
  const startup=record({type:"startup_begin"}).action_ref;
  record({type:"startup_result",action:startup,outcome:"returned",components:s.components,
    pins:{closed_set_sha256:s.closed_set_sha256,module_set_sha256:s.module_set_sha256,build_record_sha256:s.allocation.artifacts.build_record_sha256},addon:{mode:"synthetic_only",protocol:6}});
  const status=kind=>record({type:"status_plan",kind,references:["referenced","referenced"]}).action_ref;
  const start=action=>record({type:"status_start",action,references:["referenced","referenced"]});
  const returned=(action,value=true)=>record({type:"status_return",action,value});
  const callback=(action,outcome="completed",extra={})=>record({type:"status_callback",action,outcome,...extra});
  const prepare=(extra={})=>{const f={...s.allocation.fixture,fixture_name:"native-bar-fs-synthetic-Ab123Z"},c=configuration(f);
    return record({type:"prepare",kind:"PREPARE",direction:"parent",ordinal:2,binding_sha256:s.launch_binding_sha256,launch_nonce:s.allocation.launch_nonce,
      setup:{fixture_name:f.fixture_name,recipe_sha256:recipes.describeUnsignedFixture(f).recipe_sha256,registration_sha256:digest(c.binding.registration),envelope_sha256:digest(c.work_envelope)},configuration:c,...extra});};
  const bootstrap=()=>record({type:"bootstrap_begin",references:["referenced","referenced"]}).action_ref;
  return {s,m,record,pair,status,start,returned,callback,prepare,bootstrap,setNow:n=>{now=BigInt(n);}};
}
function ready(s,factory) {const e=environment(s,factory),w=e.status("READY");e.start(w);e.returned(w);e.callback(w);return e;}
function prepared(s,factory) {const e=ready(s,factory);e.prepare();const b=e.bootstrap();e.record({type:"bootstrap_result",action:b,outcome:"returned"});
  e.record({type:"baseline",action:b,clock_domain:"worker-clock",native_info:{live_fds:"7",live_sessions:"2"},bootstrap_info:{active_workspace_bytes:"123",retained_state_bytes:"456"}});
  const w=e.status("BASELINED");e.start(w);e.returned(w);e.callback(w);return {...e,b};}

test("C1-14 planning includes all 24 startup reads and keeps unknown qualification blocked",()=>{
  const s=subject(),p=plan(s);assert.equal(p.modeled_hash_bytes,String(24*(8192+65536+65536+4096+1048576)+1000));assert.equal(p.modeled_helper_commands,196);
  assert.equal(p.supplied_plan_complete,true);assert.equal(p.execution_available,false);assert.equal(p.runtime_qualified,false);
  s.components.host_profile="unavailable";const missing=plan(s);assert.equal(missing.supplied_plan_complete,false);assert.ok(missing.blockers.includes("host_profile_unavailable"));
});

for(const mode of ["normal","ubsan"])test(`C1-01 ${mode} preparation preserves actual supplied counters without runtime authority`,()=>{
  const e=prepared(subject("u1-unsigned",mode)),v=e.m.describe();assert.equal(v.state,"PREPARED");
  assert.deepEqual(v.baseline,{resources:{fds:"7",roots:"2",workspace:"123",retained:"456"},clock_domain:"worker-clock"});
  assert.equal(v.bootstrap.outcome,"returned");assert.equal(v.lifetime.works.find(w=>w.kind==="bootstrap").outcome,"pending");
  for(const key of Object.keys(data.flags()).filter(k=>typeof data.flags()[k]==="boolean"))assert.equal(v[key],false,key);
  assert.equal(v.native_status,"NOT_RUN");assert.equal(v.statuses.length,2);assert.equal(v.pending_status,null);
  assert.ok(Object.isFrozen(v));assert.deepEqual(Object.keys(e.m).sort(),["describe","record"]);
});

test("C1-04 one PREPARE may overtake READY callback but bootstrap must wait",()=>{
  const e=environment(),w=e.status("READY");e.start(w);e.returned(w);e.prepare();
  assert.equal(e.m.describe().prepare_seen,true);assert.equal(e.m.describe().bootstrap.attempted,false);
  const other=environment(),q=other.status("READY");other.start(q);other.prepare();assert.throws(()=>other.bootstrap(),/bootstrap_order/);
  e.callback(w);const b=e.bootstrap();assert.ok(b);assert.equal(e.m.describe().state,"BOOTSTRAP_PENDING");
});
test("C1-08 callback before write return cannot qualify READY until that return is known",()=>{
  const e=environment(),w=e.status("READY");e.start(w);e.callback(w);assert.equal(e.m.describe().state,"READY_PENDING");
  e.prepare();assert.equal(e.m.describe().bootstrap.attempted,false);e.returned(w,false);assert.equal(e.m.describe().state,"PREPARE_ACCEPTED");e.bootstrap();
});
test("C1-07 stopped bootstrap acquisition is retained for its once-only original close",()=>{
  const e=ready();e.prepare();const b=e.bootstrap();e.record({type:"stop",reason:"invented_eof"});e.record({type:"bootstrap_result",action:b,outcome:"returned",at:null});
  assert.equal(e.m.describe().first_stop,"invented_eof");assert.equal(e.m.describe().bootstrap.outcome,"returned");
  assert.throws(()=>e.record({type:"pair_close",pair:e.pair,index:0,outcome:"returned",at:null}),/port_close_once/);
  e.record({type:"bootstrap_close_begin",action:b,at:null});e.record({type:"bootstrap_close_result",action:b,outcome:"confirmed",at:null});
  e.record({type:"pair_close",pair:e.pair,index:0,outcome:"returned",at:null});e.record({type:"pair_closed",pair:e.pair,index:1,at:null});
  assert.equal(e.m.describe().lifetime.close_confirmed,false);e.record({type:"pair_closed",pair:e.pair,index:0,at:null});
  assert.equal(e.m.describe().lifetime.close_confirmed,true);assert.equal(e.m.describe().native_release_verified,false);
  assert.throws(()=>e.record({type:"bootstrap_close_begin",action:b,at:null}),/bootstrap_close_once/);
});
test("C1-11 valid launch allows one bounded attributed FAILED after an ordinary stop",()=>{
  const e=environment();e.record({type:"stop",reason:"invented_eof"});const w=e.status("FAILED");e.start(w);e.returned(w);e.callback(w);
  const v=e.m.describe();assert.equal(v.state,"STOPPED");assert.equal(v.first_stop,"invented_eof");
  assert.equal(v.statuses[0].payload.phase,"launch");assert.equal(v.statuses[0].payload.query_created,false);
  assert.equal(v.pending_status,null);assert.throws(()=>e.status("FAILED"),/status_once_or_unknown/);
});
for(const kind of ["READY","BASELINED"])for(const order of ["callback_first","return_first"])test(`C1-08 ${kind} unknown return remains uncertain after ${order}`,()=>{
  let e=kind==="READY"?environment():ready();if(kind==="BASELINED"){e.prepare();const b=e.bootstrap();e.record({type:"bootstrap_result",action:b,outcome:"returned"});
    e.record({type:"baseline",action:b,clock_domain:"worker-clock",native_info:{live_fds:"7",live_sessions:"2"},bootstrap_info:{active_workspace_bytes:"123",retained_state_bytes:"456"}});}
  const w=e.status(kind);e.start(w);if(order==="callback_first"){e.callback(w);e.returned(w,null);}else{e.returned(w,null);e.callback(w);}
  const v=e.m.describe();assert.equal(v.state,"STOPPED");assert.equal(v.statuses.at(-1).decision,"uncertain");assert.equal(v.pending_status,null);
  assert.throws(()=>e.status("FAILED"),/status_once_or_unknown/);
});
for(const scenario of ["callback_deadline","start_sub_ms","clock_rollback","clock_foreign","clock_missing"])test(`C1-09 immutable original reservation: ${scenario}`,()=>{
  const e=environment(),w=e.status("READY"),D=BigInt(e.m.describe().statuses[0].deadline_ns);
  if(scenario==="start_sub_ms"){e.setNow(D-1n);assert.throws(()=>e.start(w),/status_deadline/);}
  else {e.start(w);e.returned(w);const atValue=scenario==="callback_deadline"?at(D):scenario==="clock_rollback"?at(0):scenario==="clock_foreign"?{clock_domain:"parent-clock",monotonic_ns:"999"}:null;
    e.callback(w,"completed",{at:atValue});assert.equal(e.m.describe().statuses[0].decision,"uncertain");}
  assert.equal(e.m.describe().state,"STOPPED");assert.equal(e.m.describe().statuses[0].deadline_ns,String(D));
});
for(const mutation of [s=>{s.clock.worker_domain=s.clock.parent_domain;},s=>{s.work.modes[1].mode="normal";},s=>{s.manifest.rows=4097;},
  s=>{s.manifest.file_bytes="67108865";},s=>{s.work.other_hash_bytes="2147483649";},s=>{s.work.other_helper_commands=131072;},s=>{s.backend=()=>{};}])test(`C1-02/13 rejects invalid subject ${mutation.toString()}`,()=>{
  const s=subject();mutation(s);assert.throws(()=>plan(s),/cc4/);
});
for(const field of ["kind","direction","ordinal","binding_sha256","launch_nonce"])test(`C1-05 PREPARE refuses changed ${field}`,()=>{
  const e=ready();assert.throws(()=>e.prepare({[field]:field==="ordinal"?3:field==="binding_sha256"?"b".repeat(64):"wrong"}),/cc/);
  assert.equal(e.m.describe().state,"STOPPED");assert.equal(e.m.describe().bootstrap.attempted,false);
});
for(const mode of ["normal","ubsan"])test(`C1-05 U4 preserves original setup and derives only data inode/${mode}`,()=>{
  const e=ready(subject("u4-expected-inode",mode));e.prepare();const v=e.m.describe();assert.equal(v.bootstrap.supplied_data_inode,"105");
  assert.equal(v.setup.registration_sha256,v.bootstrap.registration_sha256);assert.notEqual(v.bootstrap.supplied_registration_sha256,v.bootstrap.registration_sha256);
});
for(const kind of ["GO","CANCEL","FINALIZE"])test(`C1-12 ${kind} has no preparation execution path`,()=>{
  const e=environment();assert.throws(()=>e.record({type:"command",kind}),/command_outside_preparation/);assert.equal(e.m.describe().state,"STOPPED");
});
test("C1-13 capacity has a maximal encoded view and unchanged envelopes",t=>{
  const c=capacity(subject());assert.equal(c.diagnostic_ceiling_bytes,byteLength(canonical(c.maximal_view)));
  assert.ok(c.diagnostic_ceiling_bytes<=16384);assert.ok(c.retained_buffer_bytes<=2375680);assert.ok(c.transient_buffer_bytes<=4259840);
  assert.equal(c.lifetime_work_records,37);assert.equal(c.shared_frame_limit,32);assert.equal(c.hash_work_limit_bytes,"2147483648");
  assert.ok(c.maximal_view.statuses.every(s=>s.observed_outcome==="uncertain"&&s.write_return===false));
  t.diagnostic(JSON.stringify({diagnostic_bytes:c.diagnostic_ceiling_bytes,retained_bytes:c.retained_buffer_bytes,transient_bytes:c.transient_buffer_bytes,frames:c.frame_kind_ceilings}));
});
test("C1-09 callback before deadline cannot repair a synchronous write return after its deadline",()=>{
  const e=environment(),w=e.status("READY");e.start(w);e.callback(w);e.setNow(e.m.describe().statuses[0].deadline_ns);e.returned(w);
  assert.equal(e.m.describe().state,"STOPPED");assert.equal(e.m.describe().statuses[0].decision,"uncertain");
});
test("C1-09 another preparation input cannot overtake the original pending status deadline",()=>{
  const e=environment(),w=e.status("READY");e.start(w);e.returned(w);e.setNow(e.m.describe().statuses[0].deadline_ns);
  assert.throws(()=>e.prepare(),/stopped/);assert.equal(e.m.describe().prepare_seen,false);assert.equal(e.m.describe().first_stop,"status_deadline");
});
test("C1-08 status pipe close after a callback cannot be undone by the later return",()=>{
  const e=environment(),w=e.status("READY");e.start(w);e.callback(w);e.record({type:"status_close",action:w,at:null});e.returned(w);
  assert.equal(e.m.describe().state,"STOPPED");assert.throws(()=>e.status("FAILED"),/status_closed/);
});
test("C1-10 FAILED start rechecks the original lifetime references",()=>{
  const e=environment();e.record({type:"stop",reason:"invented_eof"});const w=e.status("FAILED");
  assert.throws(()=>e.record({type:"status_start",action:w,references:["unreferenced","referenced"]}),/lifetime_reference/);
  assert.equal(e.m.describe().statuses[0].started,false);
});
for(const c of recipes.describeUnsignedAcceptanceRun(allocation().fixture.request).cases)test(`C1-01/14 fixed catalog ${c.mode}/${c.case_id} prepares with no owner/query`,()=>{
  const e=prepared(subject(c.case_id,c.mode)),v=e.m.describe();assert.equal(v.state,"PREPARED");
  assert.deepEqual(v.lifetime.works.map(w=>w.kind),["status_write","bootstrap","status_write"]);
  assert.ok(byteLength(canonical(v))<=capacity(e.s).diagnostic_ceiling_bytes);
});
for(const action of ["session","status","bootstrap","pair"])test(`C1-03 refuses copied or foreign ${action} reference without changing the foreign model`,()=>{
  const e=ready(),f=ready(),before=canonical(f.m.describe());
  if(action==="session")assert.throws(()=>e.m.record({type:"stop",session:{},reason:"foreign",at:at(99)}),/original_reference/);
  if(action==="status")assert.throws(()=>e.record({type:"status_callback",action:{},outcome:"completed"}),/action_reference/);
  if(action==="bootstrap"){e.prepare();f.prepare();e.bootstrap();const foreign=f.bootstrap();const v=canonical(f.m.describe());
    assert.throws(()=>e.record({type:"bootstrap_result",action:foreign,outcome:"returned"}),/action_reference/);assert.equal(canonical(f.m.describe()),v);return;}
  if(action==="pair")assert.throws(()=>e.record({type:"pair_closed",pair:f.pair,index:0,at:null}),/original_reference/);
  assert.equal(canonical(f.m.describe()),before);
});
test("C1-03 status callbacks accept only their own original action object",()=>{
  const e=environment(),w=e.status("READY");e.start(w);const f=environment(),q=f.status("READY");f.start(q);const before=canonical(f.m.describe());
  assert.throws(()=>e.record({type:"status_callback",action:q,outcome:"completed"}),/action_reference/);assert.equal(canonical(f.m.describe()),before);
});
for(const change of [c=>{c.work_envelope.selected_bytes="0";},c=>{c.binding.registration_hash="b".repeat(64);},c=>{c.binding.registration.pins.store_id=uuid(100);},
  c=>{c.extra="unknown";}])test(`C1-05 strict original configuration refuses ${change.toString()}`,()=>{
  const e=ready(),f={...e.s.allocation.fixture,fixture_name:"native-bar-fs-synthetic-Ab123Z"},c=configuration(f);change(c);
  assert.throws(()=>e.prepare({configuration:c}),/cc/);assert.equal(e.m.describe().bootstrap.attempted,false);
});
for(const value of [null,7,"-1","01","NaN"])test(`C1-06 missing or invalid native counter ${JSON.stringify(value)} is never zero-filled`,()=>{
  const e=ready();e.prepare();const b=e.bootstrap();e.record({type:"bootstrap_result",action:b,outcome:"returned"});
  assert.throws(()=>e.record({type:"baseline",action:b,clock_domain:"worker-clock",native_info:{live_fds:value,live_sessions:"0"},bootstrap_info:{active_workspace_bytes:"0",retained_state_bytes:"0"}}),/cc/);
  assert.equal(e.m.describe().baseline,null);
});
test("C1-06 baseline refuses a changed READY domain and cannot be resupplied",()=>{
  const e=ready();e.prepare();const b=e.bootstrap();e.record({type:"bootstrap_result",action:b,outcome:"returned"});
  assert.throws(()=>e.record({type:"baseline",action:b,clock_domain:"another-clock",native_info:{live_fds:"0",live_sessions:"0"},bootstrap_info:{active_workspace_bytes:"0",retained_state_bytes:"0"}}),/baseline_binding/);
  assert.throws(()=>e.record({type:"baseline",action:b,clock_domain:"worker-clock",native_info:{live_fds:"0",live_sessions:"0"},bootstrap_info:{active_workspace_bytes:"0",retained_state_bytes:"0"}}),/stopped/);
});
for(const cut of ["ready_planned","ready_started","ready_complete","prepare","bootstrap_reserved","bootstrap_returned","baseline_planned","prepared"])test(`C1-07 irreversible stop at ${cut}`,()=>{
  const e=environment(),w=e.status("READY");if(cut!=="ready_planned")e.start(w);
  if(!["ready_planned","ready_started"].includes(cut)){e.returned(w);e.callback(w);}
  let b=null;if(["prepare","bootstrap_reserved","bootstrap_returned","baseline_planned","prepared"].includes(cut))e.prepare();
  if(["bootstrap_reserved","bootstrap_returned","baseline_planned","prepared"].includes(cut))b=e.bootstrap();
  if(["bootstrap_returned","baseline_planned","prepared"].includes(cut))e.record({type:"bootstrap_result",action:b,outcome:"returned"});
  if(["baseline_planned","prepared"].includes(cut)){
    e.record({type:"baseline",action:b,clock_domain:"worker-clock",native_info:{live_fds:"7",live_sessions:"2"},bootstrap_info:{active_workspace_bytes:"123",retained_state_bytes:"456"}});
    const q=e.status("BASELINED");if(cut==="prepared"){e.start(q);e.returned(q);e.callback(q);}}
  e.record({type:"stop",reason:"invented_eof"});assert.equal(e.m.describe().state,"STOPPED");
  assert.throws(()=>e.status("READY"),/stopped/);assert.equal(e.m.describe().first_stop,"invented_eof");
  assert.equal(e.m.describe().bootstrap.attempted,b!==null);
});
for(const kind of ["READY","BASELINED","FAILED"])test(`C1-08 ${kind} backpressure completes only on its original callback`,()=>{
  let e=kind==="BASELINED"?ready():environment();
  if(kind==="BASELINED"){e.prepare();const b=e.bootstrap();e.record({type:"bootstrap_result",action:b,outcome:"returned"});e.record({type:"baseline",action:b,clock_domain:"worker-clock",native_info:{live_fds:"1",live_sessions:"2"},bootstrap_info:{active_workspace_bytes:"3",retained_state_bytes:"4"}});}
  if(kind==="FAILED")e.record({type:"stop",reason:"invented_eof"});const w=e.status(kind);e.start(w);e.returned(w,false);
  assert.notEqual(e.m.describe().pending_status,null);e.callback(w);assert.equal(e.m.describe().pending_status,null);assert.equal(e.m.describe().statuses.at(-1).decision,"completed");
  assert.throws(()=>e.callback(w),/status_callback_once/);
});
for(const outcome of ["refused","unknown"])test(`C1-11 bootstrap ${outcome} does not fabricate acquisition or release`,()=>{
  const e=ready();e.prepare();const b=e.bootstrap();e.record({type:"bootstrap_result",action:b,outcome});const v=e.m.describe();
  assert.equal(v.state,"STOPPED");assert.equal(v.bootstrap.outcome,outcome);assert.equal(v.baseline,null);
  assert.throws(()=>e.record({type:"bootstrap_close_begin",action:b,at:null}),/bootstrap_close_once/);
  if(outcome==="refused"){e.record({type:"pair_close",pair:e.pair,index:0,outcome:"returned",at:null});}
  else assert.throws(()=>e.record({type:"pair_close",pair:e.pair,index:0,outcome:"returned",at:null}),/port_close_once/);
});
for(const outcome of ["threw","unknown"])test(`C1-11 ${outcome} bootstrap close is not retried or treated as confirmed`,()=>{
  const e=prepared();e.record({type:"stop",reason:"invented_eof"});e.record({type:"bootstrap_close_begin",action:e.b,at:null});
  e.record({type:"bootstrap_close_result",action:e.b,outcome,at:null});assert.equal(e.m.describe().lifetime.works.find(w=>w.kind==="bootstrap").outcome,"pending");
  assert.throws(()=>e.record({type:"bootstrap_close_begin",action:e.b,at:null}),/bootstrap_close_once/);
});
test("C1-10 lost reference stops new work and cannot be restored through another ref attempt",()=>{
  const e=ready();e.record({type:"pair_listeners",pair:e.pair,index:0,event:"removed"});assert.equal(e.m.describe().state,"STOPPED");
  assert.throws(()=>e.record({type:"pair_reference",pair:e.pair,index:0,outcome:"returned",has_ref:true}),/stopped/);
  assert.throws(()=>e.status("FAILED"),/lifetime_stopped/);
});
test("C1-11 first error and secondary error storage are bounded",()=>{
  const e=environment();e.record({type:"stop",reason:"original_failure"});for(let i=0;i<20;i++)e.record({type:"stop",reason:"secondary_"+"a".repeat(i+1)});
  assert.equal(e.m.describe().first_stop,"original_failure");assert.equal(e.m.describe().secondary_errors.length,8);
});
test("C1-13 qualification exact limits are accepted and adjacent overspend is refused",()=>{
  const s=subject();s.manifest={rows:4096,pages:64,page_rows:128,page_bytes:65536,manifest_bytes:2097152,record_bytes:4194304,file_bytes:"67108864"};
  for(const m of s.work.modes)m.record_bytes="4194304";
  const partial=plan(s);s.work.other_hash_bytes=String(2147483648n-BigInt(partial.modeled_hash_bytes)+BigInt(s.work.other_hash_bytes));
  s.work.other_helper_commands=131072-192;assert.equal(plan(s).modeled_hash_bytes,"2147483648");assert.equal(plan(s).modeled_helper_commands,131072);
  s.work.other_hash_bytes=String(BigInt(s.work.other_hash_bytes)+1n);assert.throws(()=>plan(s),/work_bound/);
});
test("C1-13 authoritative input/plan mutations cannot alter captured model data",()=>{
  const s=subject(),e=environment(s);s.clock.worker_domain="changed";s.components.host_profile="refused";s.allocation.launch_nonce="changed";
  const w=e.status("READY");assert.equal(e.m.describe().statuses[0].payload.worker_clock_domain,"worker-clock");
  assert.throws(()=>{e.m.describe().statuses[0].payload.mode="changed";},TypeError);e.start(w);e.returned(w);e.callback(w);
});
test("C1-15 independent parent protocol accepts the original READY and BASELINED candidates",()=>{
  const e=prepared(),p=protocol.createUnsignedControllerProtocolModel(e.s.allocation),f={...e.s.allocation.fixture,fixture_name:"native-bar-fs-synthetic-Ab123Z"};
  const send=(kind,payload,binding=p.describe().binding)=>{const direction=["LAUNCH","PREPARE"].includes(kind)?"parent":"worker",ordinal=p.describe().next_ordinals[direction];
    p.acceptFrame(canonical({binding,direction,ordinal,kind,payload})+"\n");if(direction==="parent")p.noteWrite({ordinal,outcome:"started"});};
  send("LAUNCH",{});send("READY",e.m.describe().statuses[0].payload);send("PREPARE",{configuration:configuration(f),launch_nonce:e.s.allocation.launch_nonce},{...p.describe().binding,setup:e.m.describe().setup});
  send("BASELINED",e.m.describe().statuses[1].payload);assert.equal(p.describe().state,"BASELINED");assert.equal(p.describe().baseline_sha256,e.m.describe().baseline_sha256);
});
test("C1 effect tripwires deny cached clocks, ports, timers, signing, processes and mutations",()=>{
  const before=effects.length;
  for(const [o,k]of blocked){assert.throws(()=>o[k](),/c1_forbidden_effect/);assert.throws(()=>new o[k](),/c1_forbidden_effect/);}
  assert.throws(()=>cachedProcess.hrtime(),/c1_forbidden_effect/);assert.throws(()=>cachedProcess.hrtime.bigint(),/c1_forbidden_effect/);
  assert.equal(effects.length,before+2*blocked.length+2);effects.length=before;
});
const helperSource=fs.readFileSync(new URL("../helpers/unsignedWorkerPreparationContracts.mjs",import.meta.url),"utf8").replace(/\r\n/g,"\n");
const dependencies={...(await import("zod")),...data,...recipes,...(await import("../helpers/unsignedWorkerConfiguration.mjs")),
  ...(await import("../helpers/unsignedCohortQualificationContracts.mjs")),...(await import("../helpers/unsignedWorkerTransportContracts.mjs"))};
function compile(source,counters=null) {
  const tree=ts.createSourceFile("candidate.mjs",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(tree.parseDiagnostics.length,0,"mutation syntax");
  const names=Array.from(tree.statements.filter(n=>n.importClause)).flatMap(n=>Array.from(n.importClause.namedBindings.elements,e=>e.name.text));
  const body=tree.statements.filter(n=>!n.importClause).map(n=>n.getText().replace(/^export\s+/,"")).join("\n");
  const imports=names.map(n=>{
    const original=dependencies[n];if(counters&&["describeUnsignedFixture","validateUnsignedWorkerConfiguration"].includes(n))return (...args)=>{counters[n]++;return original(...args);};return original;
  });
  return vm.compileFunction('"use strict";\n'+body+'\nreturn {planUnsignedWorkerPreparation,createUnsignedWorkerPreparationModel,describeUnsignedWorkerPreparationCapacity};',names)(...imports);
}
function mutation(from,to) {
  assert.equal(helperSource.split(from).length,2,"unique mutation anchor");const source=helperSource.replace(from,to);assert.notEqual(source,helperSource,"changed mutation");
  return compile(source);
}
const probes=[
  ["repeated startup cost","BigInt(v.startups) * (BigInt(v.record_bytes)","1n * (BigInt(v.record_bytes)",api=>assert.equal(api.planUnsignedWorkerPreparation(subject()).modeled_hash_bytes,"28607464")],
  ["unknown work qualification",'blockers = names.filter(n => d.components[n] !== "matched_supplied")','blockers = names.filter(n => false)',api=>{const s=subject();s.components.host_profile="unavailable";assert.equal(api.planUnsignedWorkerPreparation(s).supplied_plan_complete,false);}],
  ["work budget",'if (hash > BigInt(profile.hash_work_bytes) || commands > profile.helper_commands) refuse("work_bound");','if (false) refuse("work_bound");',api=>{const s=subject();s.work.other_hash_bytes="2147483649";assert.throws(()=>api.planUnsignedWorkerPreparation(s),/work_bound/);}],
  ["original action identity",'if (!op || op.kind !== kind) refuse("action_reference");','if (!op) return {kind};',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel);assert.throws(()=>e.record({type:"status_callback",action:{},outcome:"completed"}),/action_reference/);}],
  ["stop latch",'function forward(at) { if (stopped) refuse("stopped"); const q = point(at); if (stopped) refuse("stopped"); return q; }','function forward(at) { return point(at); }',api=>{const e=ready(subject(),api.createUnsignedWorkerPreparationModel);e.record({type:"stop",reason:"invented_eof"});assert.throws(()=>e.prepare(),/stopped/);}],
  ["callback return ordering",'if (!op.fact.callback_seen || !op.fact.return_seen) return;','if (!op.fact.callback_seen) return;',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel),w=e.status("READY");e.start(w);e.callback(w);assert.equal(e.m.describe().state,"READY_PENDING");}],
  ["callback once",'if (!op.fact.started || op.fact.callback_seen) refuse("status_callback_once");','if (!op.fact.started) refuse("status_callback_once");',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel),w=e.status("READY");e.start(w);e.returned(w);e.callback(w);assert.throws(()=>e.callback(w),/status_callback_once/);}],
  ["baseline domain",' || q.clock_domain !== d.clock.worker_domain) refuse("baseline_binding");',') refuse("baseline_binding");',api=>{const e=ready(subject(),api.createUnsignedWorkerPreparationModel);e.prepare();const b=e.bootstrap();e.record({type:"bootstrap_result",action:b,outcome:"returned"});assert.throws(()=>e.record({type:"baseline",action:b,clock_domain:"foreign",native_info:{live_fds:"1",live_sessions:"2"},bootstrap_info:{active_workspace_bytes:"3",retained_state_bytes:"4"}}),/baseline_binding/);}],
  ["startup bootstrap retention",'if (q.outcome === "refused") { settle(op); stop("bootstrap_refused"); }','if (q.outcome === "returned") settle(op); if (q.outcome === "refused") { settle(op); stop("bootstrap_refused"); }',api=>{const e=prepared(subject(),api.createUnsignedWorkerPreparationModel);e.record({type:"stop",reason:"invented_eof"});assert.throws(()=>e.record({type:"pair_close",pair:e.pair,index:0,outcome:"returned",at:null}),/port_close_once/);}],
  ["pending original deadline",'if (pending && last >= BigInt(pending.fact.deadline_ns)) {','if (false) {',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel),w=e.status("READY");e.start(w);e.returned(w);e.setNow(e.m.describe().statuses[0].deadline_ns);assert.throws(()=>e.prepare(),/stopped/);}],
  ["start reference recheck",'if (statusClosed) refuse("status_closed"); liveReferences(q.references);','if (statusClosed) refuse("status_closed");',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel);e.record({type:"stop",reason:"invented_eof"});const w=e.status("FAILED");assert.throws(()=>e.record({type:"status_start",action:w,references:["unknown","referenced"]}),/lifetime_reference/);}],
  ["status pipe close",'op.fact.close_seen = true; statusClosed = true; stop("status_closed");','op.fact.close_seen = true;',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel),w=e.status("READY");e.start(w);e.callback(w);e.record({type:"status_close",action:w,at:null});e.returned(w);assert.equal(e.m.describe().state,"STOPPED");}],
  ["premature status disposition",'const at = point(q.at, true); op.fact.callback_seen = true;','if (q.outcome === "completed") settle(op); const at = point(q.at, true); op.fact.callback_seen = true;',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel),w=e.status("READY");e.start(w);e.callback(w);assert.equal(e.m.describe().lifetime.works[0].outcome,"pending");}],
  ["sticky status error",'statusError ??= q.reason;','void 0;',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel),w=e.status("READY");e.record({type:"status_error",action:w,reason:"invented_pipe_error"});assert.throws(()=>e.status("FAILED"),/status_pipe_failed/);}],
  ["invalid return time",'if (at === null) op.fact.decision = "uncertain";','void 0;',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel);e.record({type:"stop",reason:"invented_eof"});const w=e.status("FAILED");e.start(w);e.callback(w);e.record({type:"status_return",action:w,value:true,at:null});assert.equal(e.m.describe().statuses[0].decision,"uncertain");}],
  ["validation precharge",'wireCharge(2 * byteLength(canonical(q.configuration)) + recipeBytes);','void 0;',api=>{const e=ready(subject(),api.createUnsignedWorkerPreparationModel),f={...e.s.allocation.fixture,fixture_name:"native-bar-fs-synthetic-Ab123Z"},c=configuration(f),before=BigInt(e.m.describe().modeled_wire_hash_bytes);
    assert.throws(()=>e.prepare({setup:{fixture_name:f.fixture_name,recipe_sha256:recipes.describeUnsignedFixture(f).recipe_sha256,registration_sha256:"b".repeat(64),envelope_sha256:digest(c.work_envelope)}}),/worker_configuration/);assert.ok(BigInt(e.m.describe().modeled_wire_hash_bytes)>before);}],
  ["unknown-return lifetime retention",'if (op.fact.observed_outcome === "completed" && op.fact.write_return !== null) settle(op);','if (op.fact.observed_outcome === "completed") settle(op);',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel),w=e.status("READY");e.start(w);e.callback(w);e.returned(w,null);assert.equal(e.m.describe().lifetime.works[0].outcome,"pending");}],
  ["unknown startup retention",'if (!stopped || startup !== null && !["returned", "refused"].includes(startupResult)) refuse("anchor_retained");','if (!stopped || startupResult === null && startup !== null) refuse("anchor_retained");',api=>{
    const s=subject(),m=api.createUnsignedWorkerPreparationModel(s);let n=1;
    const session=m.record({type:"launch",kind:"LAUNCH",direction:"parent",ordinal:1,binding_sha256:s.launch_binding_sha256,setup:null,at:at(n++)}).session_ref;
    const r=f=>m.record({session,at:at(n++),...f}),pair=r({type:"pair_allocate",ports:["unreferenced","unreferenced"]}).pair_ref;
    for(const index of [0,1]){r({type:"pair_listeners",pair,index,event:"installed"});r({type:"pair_reference",pair,index,outcome:"returned",has_ref:true});}
    const action=r({type:"startup_begin"}).action_ref;r({type:"startup_result",action,outcome:"unknown",components:null,pins:null,addon:null});
    assert.throws(()=>r({type:"pair_close",pair,index:0,outcome:"returned",at:null}),/anchor_retained/);}],
  ["stream-level status close",'ref === null ? null : take(ref, "status")','take(ref, "status")',api=>{const e=environment(subject(),api.createUnsignedWorkerPreparationModel);
    assert.doesNotThrow(()=>e.record({type:"status_close",action:null}));assert.throws(()=>e.status("FAILED"),/status_closed/);}],
  ["status error keeps known decisions",'if (pending?.fact.started) pending.fact.decision = "uncertain";','if (refs.action !== null) take(refs.action, "status").fact.decision = "uncertain";',api=>{
    const e=environment(subject(),api.createUnsignedWorkerPreparationModel),w=e.status("READY");e.start(w);e.returned(w);e.callback(w);
    e.record({type:"status_error",action:w,reason:"invented_pipe_error"});assert.equal(e.m.describe().statuses[0].decision,"completed");}],
  ["status error leaves an in-flight write unknown",'if (pending?.fact.started) pending.fact.decision = "uncertain";','void 0;',api=>{
    const e=environment(subject(),api.createUnsignedWorkerPreparationModel);e.record({type:"stop",reason:"invented_eof"});const w=e.status("FAILED");e.start(w);
    e.record({type:"status_error",action:null,reason:"invented_pipe_error"});e.returned(w);e.callback(w);assert.equal(e.m.describe().statuses[0].decision,"uncertain");}],
];
test("C1-16 unmodified extracted declarations pass every behavioral mutation probe",()=>{
  const api=compile(helperSource);for(const [, , ,probe]of probes)probe(api);
});
for(const [name,from,to,probe]of probes)test(`C1-16 controlled behavioral mutation: ${name}`,()=>{
  const api=mutation(from,to);assert.throws(()=>probe(api),e=>e.code==="ERR_ASSERTION","the named behavioral assertion must fail, not setup");
});
test("C1-14 refused startup consumes its reserved modeled cost but records known no-dispatch",()=>{
  const s=subject();s.components.work_plan="unavailable";const m=create(s);
  const session=m.record({type:"launch",kind:"LAUNCH",direction:"parent",ordinal:1,binding_sha256:s.launch_binding_sha256,setup:null,at:at(1)}).session_ref;
  assert.throws(()=>m.record({type:"startup_begin",session,at:at(2)}),/qualification_unavailable/);
  assert.equal(m.describe().startup.attempted,true);assert.equal(m.describe().startup.outcome,"refused");assert.equal(m.describe().modeled_startup_hash_bytes,"143360");
});
test("C1-13 exhausted status precharge cannot leave an unowned pending lifetime work record",()=>{
  const s=subject();s.work.wire_hash_bytes_per_start="1";const e=environment(s);assert.throws(()=>e.status("READY"),/wire_work_bound/);
  assert.equal(e.m.describe().statuses.length,0);assert.equal(e.m.describe().lifetime.works.length,0);
});
for(const fault of ["default_reference","missing_listeners","missing_explicit_ref","lost_start_ref"])test(`C1-10 lifetime qualification refuses ${fault}`,()=>{
  const s=subject(),m=create(s);let n=1;
  const session=m.record({type:"launch",kind:"LAUNCH",direction:"parent",ordinal:1,binding_sha256:s.launch_binding_sha256,setup:null,at:at(n++)}).session_ref;
  const r=f=>m.record({session,at:at(n++),...f}),pair=r({type:"pair_allocate",ports:fault==="default_reference"?["referenced","unreferenced"]:["unreferenced","unreferenced"]}).pair_ref;
  if(fault==="default_reference"){assert.equal(m.describe().state,"STOPPED");assert.throws(()=>r({type:"startup_begin"}),/stopped/);return;}
  if(fault!=="default_reference")for(const index of [0,1]){
    if(fault==="missing_listeners")continue;r({type:"pair_listeners",pair,index,event:"installed"});
    if(fault!=="missing_explicit_ref")r({type:"pair_reference",pair,index,outcome:"returned",has_ref:true});}
  const action=r({type:"startup_begin"}).action_ref;r({type:"startup_result",action,outcome:"returned",components:s.components,
    pins:{closed_set_sha256:h,module_set_sha256:h,build_record_sha256:h},addon:{mode:"synthetic_only",protocol:6}});
  if(fault==="lost_start_ref"){const w=r({type:"status_plan",kind:"READY",references:["referenced","referenced"]}).action_ref;
    assert.throws(()=>r({type:"status_start",action:w,references:["referenced","absent"]}),/lifetime_reference/);}
  else assert.throws(()=>r({type:"status_plan",kind:"READY",references:["referenced","referenced"]}),/lifetime|stopped/);
});
for(const bad of ["pins","domain","order"])test(`C1-15 independent parent rejects ${bad} candidate rather than treating it as receipt`,()=>{
  const e=prepared(),p=protocol.createUnsignedControllerProtocolModel(e.s.allocation),binding=p.describe().binding;
  p.acceptFrame(canonical({binding,direction:"parent",ordinal:1,kind:"LAUNCH",payload:{}})+"\n");p.noteWrite({ordinal:1,outcome:"started"});
  const payload=clone(e.m.describe().statuses[0].payload);if(bad==="pins")payload.pins_sha256="f".repeat(64);if(bad==="domain")delete payload.worker_clock_domain;
  const kind=bad==="order"?"BASELINED":"READY",value=bad==="order"?e.m.describe().baseline:payload;
  assert.throws(()=>p.acceptFrame(canonical({binding,direction:"worker",ordinal:1,kind,payload:value})+"\n"),/ready_pins|invalid_input|protocol_order/);
});
test("C1-13 separate parent and preparation schema reservations fit a model-only comparison wrapper",async t=>{
  const {describeUnsignedParentConnectionCapacity}=await import("../helpers/unsignedParentConnectionContracts.mjs");
  const parent=describeUnsignedParentConnectionCapacity({}).coordinator_ceiling_bytes+byteLength(canonical({admission:null,terminal:null}))-8;
  const combined=parent+capacity(subject()).diagnostic_ceiling_bytes+byteLength(canonical({parent:null,worker_preparation:null}))-8;
  assert.equal(parent,54767);assert.equal(combined,64513);assert.ok(combined<=65536);t.diagnostic("model-only-comparison-reservation="+combined);
});
test("C1 review: callback-first stop retains lifetime until the original boolean return",()=>{
  const e=environment(),w=e.status("READY");e.start(w);e.callback(w);e.record({type:"stop",reason:"invented_eof"});
  assert.equal(e.m.describe().lifetime.works[0].outcome,"pending");
  assert.throws(()=>e.record({type:"pair_close",pair:e.pair,index:0,outcome:"returned",at:null}),/port_close_once/);
  assert.equal(e.m.describe().lifetime.close_attempted,false);e.returned(w);
  assert.equal(e.m.describe().pending_status,null);assert.equal(e.m.describe().lifetime.works[0].outcome,"confirmed");
  e.record({type:"pair_close",pair:e.pair,index:0,outcome:"returned",at:null});e.record({type:"pair_closed",pair:e.pair,index:0,at:null});e.record({type:"pair_closed",pair:e.pair,index:1,at:null});
  assert.equal(e.m.describe().lifetime.close_confirmed,true);assert.equal(e.m.describe().state,"STOPPED");
});
test("C1 review: pre-start pipe failure forbids FAILED without inventing a close",()=>{
  const e=environment(),w=e.status("READY");e.record({type:"status_error",action:w,reason:"invented_pipe_error"});
  assert.equal(e.m.describe().status_closed,false);assert.equal(e.m.describe().status_error,"invented_pipe_error");
  assert.equal(e.m.describe().statuses[0].decision,"withheld");assert.throws(()=>e.status("FAILED"),/status_pipe_failed/);
});
for(const atValue of [null,at(0),{clock_domain:"foreign-clock",monotonic_ns:"999"}])test(`C1 review: FAILED callback cannot qualify an invalid-time return ${JSON.stringify(atValue)}`,()=>{
  const e=environment();e.record({type:"stop",reason:"invented_eof"});const w=e.status("FAILED");e.start(w);e.callback(w);
  e.record({type:"status_return",action:w,value:true,at:atValue});const v=e.m.describe();
  assert.equal(v.clock_invalid,true);assert.equal(v.statuses[0].decision,"uncertain");assert.equal(v.first_stop,"invented_eof");
  assert.equal(v.statuses[0].return_seen,true);assert.equal(v.statuses[0].write_return,true);assert.equal(v.state,"STOPPED");
});
test("C1 review: exhausted PREPARE work is refused before recipe/configuration hashing",()=>{
  const s=subject();s.work.wire_hash_bytes_per_start="2214";s.work.other_hash_bytes="2143989872";assert.equal(plan(s).modeled_hash_bytes,"2147483648");
  const counters={describeUnsignedFixture:0,validateUnsignedWorkerConfiguration:0},api=compile(helperSource,counters),e=ready(s,api.createUnsignedWorkerPreparationModel);
  counters.describeUnsignedFixture=0;counters.validateUnsignedWorkerConfiguration=0;
  assert.throws(()=>e.prepare(),/wire_work_bound/);assert.equal(counters.describeUnsignedFixture,0);assert.equal(counters.validateUnsignedWorkerConfiguration,0);
  assert.equal(e.m.describe().modeled_wire_hash_bytes,"2214");
});
test("C1 review: invalid registration validation keeps its precharged modeled work",()=>{
  const e=ready(),f={...e.s.allocation.fixture,fixture_name:"native-bar-fs-synthetic-Ab123Z"},c=configuration(f),before=BigInt(e.m.describe().modeled_wire_hash_bytes);
  assert.throws(()=>e.prepare({setup:{fixture_name:f.fixture_name,recipe_sha256:recipes.describeUnsignedFixture(f).recipe_sha256,
    registration_sha256:"b".repeat(64),envelope_sha256:digest(c.work_envelope)}}),/worker_configuration/);
  assert.ok(BigInt(e.m.describe().modeled_wire_hash_bytes)>before);
});
test("C1 review: direct network listener constructors/prototypes are independently denied",()=>{
  for(const [o,k]of [[net,"Server"],[listenerPrototype,"listen"],[dgram,"Socket"],[datagramPrototype,"bind"]])
    assert.ok(blocked.some(([x,y])=>x===o&&y===k),"independent network sink "+k);
  const before=effects.length;
  for(const probe of [()=>net.Server(),()=>new net.Server(),()=>listenerPrototype.listen.call(Object.create(null)),
    ()=>dgram.Socket(),()=>new dgram.Socket(),()=>datagramPrototype.bind.call(Object.create(null))])assert.throws(probe,/c1_forbidden_effect/);
  assert.equal(effects.length,before+6);effects.length=before;
});
for(const outcome of ["unknown","refused"])test(`C1 review: startup ${outcome} retains or settles only its known disposition`,()=>{
  const s=subject(),m=create(s);let n=1;
  const session=m.record({type:"launch",kind:"LAUNCH",direction:"parent",ordinal:1,binding_sha256:s.launch_binding_sha256,setup:null,at:at(n++)}).session_ref;
  const r=f=>m.record({session,at:at(n++),...f}),pair=r({type:"pair_allocate",ports:["unreferenced","unreferenced"]}).pair_ref;
  for(const index of [0,1]){r({type:"pair_listeners",pair,index,event:"installed"});r({type:"pair_reference",pair,index,outcome:"returned",has_ref:true});}
  const action=r({type:"startup_begin"}).action_ref;r({type:"startup_result",action,outcome,components:null,pins:null,addon:null});
  if(outcome==="unknown"){assert.throws(()=>r({type:"pair_close",pair,index:0,outcome:"returned",at:null}),/anchor_retained/);assert.equal(m.describe().lifetime.close_attempted,false);}
  else{r({type:"pair_close",pair,index:0,outcome:"returned",at:null});r({type:"pair_closed",pair,index:0,at:null});r({type:"pair_closed",pair,index:1,at:null});assert.equal(m.describe().lifetime.close_confirmed,true);}
  assert.equal(m.describe().first_stop,"startup_"+outcome);
});
for(const kind of ["READY","BASELINED","FAILED"])for(const order of ["callback_first","return_first"])test(`C1 review: unknown ${kind} return keeps lifetime pending/${order}`,()=>{
  const e=kind==="BASELINED"?ready():environment();let b=null;
  if(kind==="BASELINED"){e.prepare();b=e.bootstrap();e.record({type:"bootstrap_result",action:b,outcome:"returned"});e.record({type:"baseline",action:b,
    clock_domain:"worker-clock",native_info:{live_fds:"1",live_sessions:"2"},bootstrap_info:{active_workspace_bytes:"3",retained_state_bytes:"4"}});}
  if(kind==="FAILED")e.record({type:"stop",reason:"invented_eof"});const w=e.status(kind);e.start(w);
  if(order==="callback_first"){e.callback(w);e.returned(w,null);}else{e.returned(w,null);e.callback(w);}
  if(b){e.record({type:"bootstrap_close_begin",action:b,at:null});e.record({type:"bootstrap_close_result",action:b,outcome:"confirmed",at:null});}
  assert.equal(e.m.describe().lifetime.works.filter(w=>w.kind==="status_write").at(-1).outcome,"pending");
  assert.throws(()=>e.record({type:"pair_close",pair:e.pair,index:0,outcome:"returned",at:null}),/port_close_once/);
});
// Commit review: a status stream close/error is stream-level. Before any status write there is no action to name, yet it still
// forbids FAILED; and an error changes only a started write still awaiting its outcome, never a known decision.
for(const kind of ["close","error"])test(`C1 commit review: a stream ${kind} before any status write is sticky and forbids FAILED`,()=>{
  const e=environment();e.record(kind==="close"?{type:"status_close",action:null}:{type:"status_error",action:null,reason:"invented_pipe_error"});
  const v=e.m.describe();assert.equal(v.state,"STOPPED");assert.equal(v.first_stop,kind==="close"?"status_closed":"invented_pipe_error");
  assert.equal(v.statuses.length,0);assert.equal(v.lifetime.works.length,0);
  assert.equal(v.status_closed,kind==="close");assert.equal(v.status_error,kind==="error"?"invented_pipe_error":null);
  assert.throws(()=>e.status("FAILED"),kind==="close"?/status_closed/:/status_pipe_failed/);assert.equal(e.m.describe().statuses.length,0);
});
for(const order of ["stream_first","write_first"])test(`C1 commit review: one stream close is recorded once (${order})`,()=>{
  const e=environment(),w=e.status("READY");e.start(w);const [first,second]=order==="stream_first"?[null,w]:[w,null];
  e.record({type:"status_close",action:first});assert.throws(()=>e.record({type:"status_close",action:second}),/status_close_once/);
  assert.equal(e.m.describe().statuses[0].close_seen,order==="write_first","a second, op-level close cannot attribute an earlier stream close to a write");
});
test("C1 commit review: stream-level facts still require the original session and a named action must be an original status write",()=>{
  const g=environment();assert.throws(()=>g.record({type:"status_close",action:null,session:{}}),/original_reference/);assert.equal(g.m.describe().status_closed,false);
  for(const f of [{type:"status_close",action:{}},{type:"status_error",action:{},reason:"invented_pipe_error"}]){
    const e=environment();assert.throws(()=>e.record(f),/action_reference/);assert.equal(e.m.describe().status_closed,false);assert.equal(e.m.describe().status_error,null);}
});
for(const prior of ["completed","withheld"])test(`C1 commit review: a status error keeps the known ${prior} decision of the write it names`,()=>{
  const e=environment(),w=e.status("READY");if(prior==="completed"){e.start(w);e.returned(w);e.callback(w);}else e.record({type:"stop",reason:"invented_eof"});
  e.record({type:"status_error",action:w,reason:"invented_pipe_error"});const v=e.m.describe();
  assert.equal(v.statuses[0].decision,prior);assert.equal(v.statuses[0].started,prior==="completed");assert.equal(v.status_error,"invented_pipe_error");
  assert.throws(()=>e.status("FAILED"),/status_pipe_failed/);
});
for(const named of ["stream","write"])test(`C1 commit review: a ${named} error during the READY write leaves it uncertain despite a completed callback`,()=>{
  const e=environment(),w=e.status("READY");e.start(w);e.record({type:"status_error",action:named==="stream"?null:w,reason:"invented_pipe_error"});
  e.returned(w);e.callback(w);const v=e.m.describe();
  assert.equal(v.statuses[0].decision,"uncertain");assert.equal(v.state,"STOPPED");assert.equal(v.pending_status,null);
});
for(const named of ["stream","completed READY"])test(`C1 commit review: an error naming the ${named} leaves the started FAILED write uncertain despite a completed callback`,()=>{
  const e=environment(),q=e.status("READY");e.start(q);e.returned(q);e.callback(q);e.record({type:"stop",reason:"invented_eof"});
  const w=e.status("FAILED");e.start(w);e.record({type:"status_error",action:named==="stream"?null:q,reason:"invented_pipe_error"});
  e.returned(w);e.callback(w);const v=e.m.describe();
  assert.equal(v.statuses[0].decision,"completed");assert.equal(v.statuses[1].decision,"uncertain");assert.equal(v.pending_status,null);
  assert.equal(v.lifetime.works[1].outcome,"confirmed","the completed callback and known return still settle its original work");
});
test("C1 no denied effect was swallowed",()=>assert.deepEqual(effects,[]));
