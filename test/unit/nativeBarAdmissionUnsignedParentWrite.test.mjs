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
import inspector from "node:inspector";
import inspectorPromises from "node:inspector/promises";
import v8 from "node:v8";
import timers from "node:timers";
import timerPromises from "node:timers/promises";
import nodeModule, { syncBuiltinESMExports } from "node:module";
import * as cachedProcess from "node:process";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Node 20 has no node:sqlite; where present it is denied with the other builtins.
const sqlite = await import("node:sqlite").then(m => m.default, () => null);
const effects = [], restores = [], blocked = [];
const replace = (o, k, f) => {
  const d = Object.getOwnPropertyDescriptor(o, k), accessor = d && !("value" in d);
  if (accessor) Object.defineProperty(o, k, { value: f, configurable: true, writable: true, enumerable: d.enumerable }); else o[k] = f;
  restores.push(() => { if (accessor) Object.defineProperty(o, k, d); else if (d) o[k] = d.value; else delete o[k]; });
};
const block = (o, keys) => keys.filter(k => typeof o[k] === "function").forEach(k => {
  blocked.push([o, k]); replace(o, k, function () { effects.push(k); throw Error("cc4b3b_forbidden_effect"); });
});
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]); block(workers, ["Worker", "MessageChannel", "BroadcastChannel"]);
block(crypto, ["sign", "verify", "createSign", "createVerify", "createPrivateKey", "createPublicKey", "createSecretKey", "generateKey", "generateKeySync",
  "generateKeyPair", "generateKeyPairSync", "privateEncrypt", "privateDecrypt", "publicEncrypt", "publicDecrypt", "diffieHellman", "createDiffieHellman", "createECDH", "randomBytes",
  "Sign", "Verify", "DiffieHellman", "DiffieHellmanGroup", "ECDH", "getDiffieHellman", "createDiffieHellmanGroup"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "deriveKey", "deriveBits", "encrypt", "decrypt", "wrapKey", "unwrapKey"]);
block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"]);
block(net, ["connect", "createConnection", "createServer"]); block(net.Socket.prototype, ["connect"]);
block(http, ["request", "get", "createServer"]); block(https, ["request", "get", "createServer"]); block(http2, ["connect", "createServer", "createSecureServer"]);
block(dgram, ["createSocket"]); block(tls, ["connect", "createServer"]);
block(globalThis, ["fetch", "WebSocket", "EventSource", "MessageChannel", "BroadcastChannel", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask"]);
block(AbortSignal, ["timeout"]); block(process.report, ["writeReport"]); block(v8, ["writeHeapSnapshot"]);
if (sqlite) block(sqlite, ["Database", "DatabaseSync", "backup"]);
// syncBuiltinESMExports never reaches node:-only builtins, so their named imports are refused at resolution instead.
const resolution = sqlite && typeof nodeModule.registerHooks === "function" ? nodeModule.registerHooks({ resolve(specifier, context, next) {
  if (specifier === "node:sqlite") { effects.push(specifier); throw Error("cc4b3b_forbidden_effect"); } return next(specifier, context); } }) : null;
if (resolution) restores.push(() => resolution.deregister());
block(timers, ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate"]);
block(timerPromises, ["setTimeout", "setInterval", "setImmediate"]); block(timerPromises.scheduler, ["wait", "yield"]);
block(Date, ["now"]); block(process.hrtime, ["bigint"]);
for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter(k => /^(lookup|resolve|reverse)/.test(k)));
block(inspector, ["open", "Session"]); block(inspectorPromises, ["open", "Session"]);
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "ftruncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename",
  "chmod", "fchmod", "lchmod", "chown", "fchown", "lchown", "symlink", "link", "utimes", "futimes", "lutimes"];
const streams = ["ReadStream", "FileReadStream", "WriteStream", "FileWriteStream", "Utf8Stream"], scans = ["glob", "statfs", "watch", "mkdtempDisposable"];
block(fs, [...mutations, ...mutations.map(k => k + "Sync"), "createWriteStream", ...streams, ...scans, ...scans.map(k => k + "Sync"), "openAsBlob", "watchFile"]);
block(fsp, [...mutations, ...scans]);
const roots = ["../helpers/", "../../node_modules/"].map(s => fileURLToPath(new URL(s, import.meta.url)));
roots.push(...roots.map(s => fs.realpathSync(s) + sep));
const metadata = ["stat", "lstat", "readdir", "opendir", "access", "readlink", "realpath"];
const readers = [[fs, "open", a => a[0]], [fs, "openSync", a => a[0]], [fs, "readFile", a => a[0]?.flag], [fs, "readFileSync", a => a[0]?.flag],
  [fs, "createReadStream", a => a[0]?.flags], [fs, "exists", () => undefined], [fs, "existsSync", () => undefined],
  ...metadata.flatMap(k => [[fs, k, () => undefined], [fs, k + "Sync", () => undefined], [fsp, k, () => undefined]]),
  [fsp, "open", a => a[0]], [fsp, "readFile", a => a[0]?.flag]];
for (const [o, k, flag] of readers) {
  if (typeof o[k] !== "function") continue; const original = o[k]; replace(o, k, (p, ...a) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(a);
    if ((f === undefined || f === "r" || f === 0) && roots.some(r => full.startsWith(r))) return original.call(o, p, ...a);
    effects.push(k); throw Error("cc4b3b_forbidden_read");
  });
}
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach(f => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });

// Replacing Date or hrtime would hide the earlier static guards, so each replacement carries its own recording statics.
for (const [o, k, statics] of [[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]) {
  const record = name => function () { effects.push(name); throw Error("cc4b3b_forbidden_effect"); };
  const f = Object.assign(record(k), Object.fromEntries(statics.map(name => [name, record(name)])));
  replace(o, k, f); blocked.push([o, k], ...statics.map(name => [f, name]));
}
block(process, ["uptime", "cpuUsage", "resourceUsage"]); block(performance, ["now"]);
if (typeof Temporal === "object") block(Temporal.Now, Object.getOwnPropertyNames(Temporal.Now));
syncBuiltinESMExports();

import vm from "node:vm";
import ts from "typescript";
import { EventEmitter } from "node:events";
import { posix } from "node:path";
const runtime = await import("../helpers/unsignedCohortRuntime.mjs");
const data = await import("../helpers/unsignedControllerData.mjs");
const parent = await import("../helpers/unsignedParentConnectionContracts.mjs");
const {encodeUnsignedTransportFrame}=await import("../helpers/unsignedWorkerTransportContracts.mjs");
const { createUnsignedCohortAssemblyModel } = await import("../helpers/unsignedCohortAssemblyModel.mjs");
const { createUnsignedProtocolDecoder } = await import("../helpers/unsignedAdapterSupport.mjs");
const source = fs.readFileSync(new URL("../helpers/unsignedCohortRuntime.mjs", import.meta.url), "utf8");
const tree = ts.createSourceFile("runtime.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const root = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "prepareOriginalQualification");
const declarations = root.body.statements.filter(n => ts.isFunctionDeclaration(n) && (/[Oo]riginalParent/.test(n.name.text) || ["runOriginalTool","allowedTool","hash","chargeHash"].includes(n.name.text)));
const plain = x => JSON.parse(JSON.stringify(x));
const h = "a".repeat(64);
const request = { schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run",
  source_commit: "a".repeat(40), patch_sha256: "b".repeat(64) };
const point = n => ({ clock_domain: "parent-clock", monotonic_ns: String(n) });
const allocation = () => ({ fixture: { request, case_id: "u0-unavailable", mode: "normal",
  ids: Object.fromEntries(["fixture","store","epoch","authority","key","reference","extra"].map((k,n)=>[k, "00000000-0000-4000-8000-" + String(n+1).padStart(12,"0")])) },
  exchange_id: "exchange-1", launch_nonce: "nonce-1", source_tree_sha256: h, signature_profile: "linker_adhoc",
  artifacts: Object.fromEntries(["js_set_sha256","addon_sha256","observer_sha256","controller_sha256","worker_sha256","runtime_closure_sha256",
    "node_binary_sha256","build_record_sha256","reader_source_sha256","reader_js_sha256"].map(k=>[k,h])) });
function memory({ producers = false, omit = null } = {}) {
  const e = { now: 1n, reads: 0, models: 0, decoders: 0, clockFailure: null };
  const s = { phase: "NAMESPACE_BOUND", stopped: null, evidenceTainted: false, recordClosed: true, recordIdentity: {}, commands:0,hashBytes:0n,passBytes:0n,commandDigest:h,environment:{},
    qualificationTimer: null, helper: null, children: new Set() }, buildRef = {}, namespaceRef = {};
  const context = { ...data, ...parent, Buffer, retainedQualificationScopes: new Set([s]), buildReferences: new WeakMap([[buildRef,s]]),
    namespaceReferences: new WeakMap([[namespaceRef,{owner:s,buildRef}]]), parentOwners: new WeakMap(), parentSessions: new WeakMap(), parentHelperPlans:new WeakMap(),parentLaunchPlans:new WeakMap(),parentCommandPlans:new WeakMap(),parentWrites:new WeakMap(),encodeUnsignedTransportFrame,
    path:posix,root:"/invented",crypto:{createHash:crypto.createHash},
    limits:{helper_commands:131072,hash_work_bytes:"2147483648",pass_bytes:"268435456",acl_bytes:65536,tool_capture_bytes:1048576},
    code(error){return /^cc4b3[bc]_[a-z_]+$/.test(error.message)?error.message:"cc4b3b_operation_failed";},
    checkpoint(state){if(state.stopped)throw Error(state.stopped);context.clock.point();},
    stop(state,error){state.stopped??=error.message;state.phase="STOPPED";return error;},
    armOriginalQualificationTimer(){e.qualificationUses++;throw Error("builder_timer_forbidden");},
    memoryCommandProof(ref,kind){if(!e.commandProofRef)throw Error("cc4b3b_command_proof_unavailable");return e.commandProofRef;},
    memoryLaunchPlan(){if(!e.launchPlanRef)throw Error("cc4b3b_original_launch_plan_unavailable");return e.launchPlanRef;},
    memoryHelperPlan(){if(!e.planRef)throw Error("cc4b3b_original_helper_plan_unavailable");return e.planRef;},
    memoryChildImport(){e.imports++;return e.importWait??Promise.resolve({spawn(program,args,options){
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
      child.stdio=[null,child.stdout,child.stderr,new EventEmitter(),new EventEmitter()];
      child.ref=()=>{e.refCalls++;e.onChildRef?.(child);return child;};
      for(const [name,stream]of [["child",child],["stdout",child.stdout],["stderr",child.stderr],["command",child.stdio[3]],["status",child.stdio[4]]]) {
        const on=stream.on;stream.on=function(event,listener){e.onListen?.(name,event,this,listener);return on.call(this,event,listener);};
        stream.pause=()=>{e.pauses++;};stream.write=()=>{throw Error("write_unavailable");};
      }
      e.spawned.push({child,program,args,options});e.onSpawn?.(child);return child;
    }});},
    clock: { binding: { clock_domain: "parent-clock", started_ns: "0", cohort_limit_ms: "30000000" }, end_ns: "30000000000000",
      point() { e.reads++; if (e.clockFailure) throw Error("invented_clock"); return point(e.now); },
      describe() { return e.clockFailure ?? { clock_invalid: false, failure: null, stop_ns: null }; } },
    originalCohortTiming(state,b,n) { assert.equal(state,s); assert.equal(b,buildRef); assert.equal(n,namespaceRef);
      return { binding: context.clock.binding, at: context.clock.point() }; },
    createUnsignedCohortAssemblyModel(input) { e.models++; return createUnsignedCohortAssemblyModel(input); },
    createUnsignedProtocolDecoder() { e.decoders++; return createUnsignedProtocolDecoder(); },
    refuse(reason) { throw Error("cc4b3b_" + reason); } };
  const replacements = producers ? {
    originalParentInvocation: 'function originalParentInvocation() { return request; }',
    originalParentAllocation: 'function originalParentAllocation() { return allocation(); }',
    originalParentCaseReceipt: 'function originalParentCaseReceipt() {}',
    originalParentWorkPlan: 'function originalParentWorkPlan() {}',
    originalParentWorkerQualification: 'function originalParentWorkerQualification() {}',
    originalParentHelperPlan:'function originalParentHelperPlan(){return memoryHelperPlan();}',
    originalParentLaunchPlan:'function originalParentLaunchPlan(){return memoryLaunchPlan();}',
    prepareOriginalParentCommand:'function prepareOriginalParentCommand(ref,kind){return memoryCommandProof(ref,kind);}',
  } : {};
  if (omit) delete replacements[omit];
  Object.assign(context, { request, allocation });

  e.timers = []; e.clears = []; e.armThrows = false; e.clearThrows = false; e.imports=0;e.spawned=[];e.qualificationUses=0;e.refCalls=0;e.pauses=0;
  Object.assign(context, {
    setTimeout(callback, delay) {
      if (e.armThrows) throw Error("invented_arm_failure");
      const handle = { callback, delay, referenced: true, hasRef() {
        e.onRef?.(handle); if (e.refThrows) throw Error("invented_ref_failure"); return handle.referenced;
      } };
      e.timers.push(handle); e.onArm?.(handle); return handle;
    },
    clearTimeout(handle) { e.clears.push(handle); e.onClear?.(handle); if (e.clearThrows) throw Error("invented_clear_failure"); },
  });
  const api = vm.compileFunction('"use strict";\n' + declarations.map(n=>replacements[n.name.text] ?? n.getText().replace('const { spawn } = await import("node:child_process");','const { spawn } = await memoryChildImport();')).join("\n")
    + "\nreturn {" + declarations.map(n=>n.name.text).join(",") + "};", Object.keys(context))(...Object.values(context));
  Object.assign(e,{s,buildRef,namespaceRef,context,api});
  e.owner = () => api.createOriginalParentOwner(s,buildRef,namespaceRef);
  e.session = () => { const owner = e.ownerRef ??= e.owner(); return api.reserveOriginalParentSession(owner); };
  return e;
}

function session() {
  const e = memory({producers:true}); e.ref = e.session(); e.c = e.context.parentSessions.get(e.ref);
  e.fire = index => e.timers[index].callback();
  e.view = () => e.api.describeOriginalParent(e.ref);
  e.plan=()=>{const ref=Object.freeze({}),plan={owner:e.c,program:"/bin/ls",args:Object.freeze(["-lde","/invented/pin"]),consumed:false};e.context.parentHelperPlans.set(ref,plan);e.planRef=ref;return plan;};
  return e;
}

const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const track=promise=>{const r={state:"pending"};promise.then(value=>Object.assign(r,{state:"resolved",value}),error=>Object.assign(r,{state:"rejected",error}));return r;};
function launchSession() {
  const e=session();e.s.sourceIdentity={node:"/invented/node"};e.s.recordHash=h;
  const node={path:"/invented/node",roles:["node"],sha256:h};
  const worker={path:"/invented/native/native_bar_fs/test_unsigned_cohort_worker.mjs",roles:["runtime"],sha256:h};
  e.s.inputs={rows:[node,worker]};
  const ref=Object.freeze({});e.launchPlan={owner:e.c,buildRef:e.buildRef,namespaceRef:e.namespaceRef,allocation:e.c.allocation,node,worker,consumed:false};
  e.context.parentLaunchPlans.set(ref,e.launchPlan);e.launchPlanRef=ref;return e;
}

async function writeSession() {
  const e=launchSession();const started=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(started.state,"resolved");
  e.event=(kind,payload)=>{const at=point(++e.now);e.c.owner.lastNs=at.monotonic_ns;return e.c.owner.coordinator.applyModelEvent(e.c.caseRef,{kind,payload,at});};
  const at=point(++e.now);e.c.owner.lastNs=at.monotonic_ns;
  const receipt=e.c.owner.coordinator.applyModelEvent(e.c.caseRef,{kind:"receipt",payload:{kind:"case_allocated",payload:{},stamp:{...at,
    wall_utc:"2026-10-31T00:00:00.000Z",wall_jst:"2026-10-31T09:00:00.000+09:00"}},at});
  e.event("receipt_readback",{line:receipt.line});e.event("resource",{resource:"worker",action:"attach"});
  e.writes=[];e.ends=0;e.writeReturn=true;
  e.c.pipes.command.write=(line,encoding,callback)=>{e.writes.push({line,encoding,callback});e.onWrite?.(line,callback);
    if(e.writeThrows)throw Error("invented_write");return e.writeReturn;};
  e.c.pipes.command.end=()=>{e.ends++;e.onEnd?.();if(e.endThrows)throw Error("invented_end");};
  e.proof=(kind,payload={},binding=null)=>{const ref=Object.freeze({}),p={owner:e.c,child:e.c.child,pipe:e.c.pipes.command,kind,payload,binding,consumed:false};
    e.context.parentCommandPlans.set(ref,p);e.commandProofRef=ref;return p;};
  e.worker=(kind,payload)=>{const d=e.view().admission.active;const line=data.canonical({binding:d.binding,direction:"worker",ordinal:d.next_ordinals.worker,kind,payload})+"\n";
    e.c.pipes.status.emit("data",Buffer.from(line));return line;};
  return e;
}
const {describeUnsignedFixture,describeUnsignedAcceptanceRun}=await import("../helpers/jointUnsignedAcceptanceContracts.mjs");
const digest=data.digest;
function configuration(f) {
  const recipe = describeUnsignedFixture(f), base = (inode, mode = "16832", uid = "501", gid = "20") => ({
    device: "1", inode: String(inode), uid, gid, mode, flags: "0", birthtime_ns: "1", acl: "none", acl_hash: h });
  const marker = (path, inode) => { const e = recipe.entries.find((e) => e.path === path); return { ...base(inode, "33152"), nlink: "1", size: e.size, sha256: e.sha256 }; };
  const registration = { schema: "native-bar-admission-read-registration-v1", scope: "synthetic_fixture_only", temp_anchor: "/private/tmp",
    fixture_name: f.fixture_name, policy_hash: recipe.entries.find((e) => e.path === "store/policy.json").sha256, authority_reference: f.ids.reference,
    pins: { fixture_id: f.ids.fixture, store_id: f.ids.store, epoch_id: f.ids.epoch, authority_id: f.ids.authority, key_id: f.ids.key,
      enrollment_hash: "2".repeat(64), public_key_spki_sha256: crypto.createHash("sha256").update(Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex")).digest("hex") },
    bindings: { ancestors: ["/", "/private", "/private/tmp"].map((path, n) => ({ path, proof: base(n + 1, n === 2 ? "17407" : "16877", "0", "0") })),
      fixture_parent: base(100), data: base(101), witness: base(102), markers: { base: marker(".native-bar-fs-synthetic", 103), admission: marker(".native-bar-admission-synthetic", 104) } },
    volume: { filesystem: "apfs", local: true, ownership_enforced: true, case_preserving: true, case_sensitive: false, read_only_mount: false } };
  const inventory = { entries: "16", inventory_bytes: "1048576", metadata_bytes: "1048576" };
  return { schema: "native-bar-unsigned-worker-configuration-v1", binding: { schema: "native-bar-joint-read-binding-v1", scope: "synthetic_joint_read_model_only",
    registration, registration_hash: digest(registration) }, work_envelope: { schema: "native-bar-joint-read-work-envelope-v1",
    inventory: { data: { ...inventory }, witness: { ...inventory }, common: { ...inventory } },
    objects: { witness_records: String(recipe.witness_slots), producer_mirrors: "0", payloads: "0", receipts: "0", maintenance_metadata: String(recipe.maintenance_slots) },
    selected_bytes: String(16384 * recipe.witness_slots + 65536 * recipe.maintenance_slots), decoded_bytes: "1048576", interpretation_bytes: "1048576" } };
}
function setup(f = fixture()) {
  const c = configuration(f); return { fixture_name: f.fixture_name, recipe_sha256: describeUnsignedFixture(f).recipe_sha256,
    registration_sha256: digest(c.binding.registration), envelope_sha256: digest(c.work_envelope) };
}

async function activeSession() {
  const e=await writeSession(),f={...e.c.allocation.fixture,fixture_name:"native-bar-fs-synthetic-Ab123Z"};
  // Invented B2 receipt events exercise later phases, not B5 IO or producer authority.
  e.record=(kind,payload={})=>{const at=point(++e.now);e.c.owner.lastNs=at.monotonic_ns;const encoded=e.c.owner.coordinator.applyModelEvent(e.c.caseRef,
    {kind:"receipt",payload:{kind,payload,stamp:{...at,wall_utc:"2026-10-31T00:00:00.000Z",wall_jst:"2026-10-31T09:00:00.000+09:00"}},at});
    e.event("receipt_readback",{line:encoded.line});const w=e.view().admission.active.window;
    if(e.c.phaseKey!==w.phase+":"+w.phase_deadline_ns)e.api.selectOriginalParentPhase(e.ref);return encoded;};
  e.send=(kind,payload={},binding=null)=>{e.proof(kind,payload,binding);const token=e.api.planOriginalParentCommand(e.ref,kind);
    e.api.writeOriginalParentCommand(e.ref,token);e.writes.at(-1).callback();return token;};
  e.send("LAUNCH");const binding=e.view().admission.active.binding;
  const ready=e.worker("READY",{addon_protocol:6,mode:"synthetic_only",worker_clock_domain:"worker-clock",pins_sha256:data.digest(binding)});
  const recipe=describeUnsignedFixture(f),resources={fds:"4",roots:"0",workspace:"0",retained:"0"};
  e.proofs=[];for(const [i,entry]of recipe.entries.entries()){
    e.record("create_intent",{entry_index:i,...(i===0?{ready_sha256:data.sha(ready)}:{})});
    const proof={kind:entry.kind,device:"1",inode:String(100+i),uid:"501",gid:"20",mode:entry.mode,flags:"0",birthtime_ns:"1",mtime_ns:"1",ctime_ns:"1",
      nlink:entry.kind==="file"?"1":"2",size:entry.size??"0",allocated_bytes:"0",acl:"none",acl_hash:h,sha256:entry.sha256??null};
    e.proofs.push(proof);e.record("create_result",{entry_index:i,proof,...(i===0?{fixture_name:f.fixture_name}:{})});
  }
  e.record("setup_sealed",{inventory_sha256:h,setup:setup(f)});
  e.send("PREPARE",{configuration:configuration(f),launch_nonce:e.c.allocation.launch_nonce},{...binding,setup:setup(f)});
  const baseline={resources,clock_domain:"worker-clock"};
  e.worker("BASELINED",baseline);e.record("worker_prepared");e.record("baseline_bound",baseline);
  e.record("go_intent",{baseline_sha256:e.view().admission.active.baseline_sha256,bound_objects_sha256:null});e.send("GO");
  e.release=()=>{const p=e.view().admission.active;return e.worker("RELEASED",{baseline_sha256:p.baseline_sha256,resources,query:"settled",native:"settled",
    original_operation_retired:true,query_released:true,close_errors:[],diagnostic_sha256:h,observation_sha256:null,trace_chunks:0,trace_events:0,
    trace_sha256:p.trace_sha256,primary_code:describeUnsignedAcceptanceRun(f.request).cases[0].expected_code,requests_dispatched:1,authenticated_requests:0,
    c0_dispatched_at:null,c0_authenticated_at:null,retired_at:null});};
  e.finalize=()=>{const p=e.view().admission.active,code=describeUnsignedAcceptanceRun(f.request).cases[0].expected_code;
    e.record("run_outcome",{primary_code:code,requests_dispatched:1,authenticated_requests:0,diagnostic_sha256:h,observation_sha256:null,observation_bytes:0,trace_sha256:p.trace_sha256,trace_events:0});
    e.record("release_checked",{baseline_sha256:p.baseline_sha256,resources,query_released:true,original_operation_retired:true,close_errors:[],bound_objects_sha256:null});
    e.record("cleanup_precheck",{inventory_sha256:h});const depth=p=>p?p.split("/").length:0;
    const order=recipe.entries.map((entry,i)=>({...entry,i})).sort((a,b)=>depth(b.path)-depth(a.path)||(a.kind===b.kind?0:a.kind==="file"?-1:1)||(a.path<b.path?-1:a.path>b.path?1:0));
    for(const entry of order){e.record("delete_intent",{entry_index:entry.i,proof:e.proofs[entry.i]});e.record("delete_result",{entry_index:entry.i,outcome:"removed"});}
    e.record("absence_checked",{anchor_same:true,root_removed:true,absent:true});e.send("FINALIZE");};
  return e;
}
test("B4-B5 GO enters query only at original write start on the single B2 owner",async()=>{
  const e=await activeSession();const v=e.view();assert.equal(v.admission.stopped,false);assert.equal(v.admission.active.window.phase,"query");
  assert.equal(v.admission.active.go_submitted,true);assert.equal(v.terminal.facts.commands.length,3);assert.equal(e.models,1);
});
test("B4-B5 plans one original frame without writing or creating a second ledger",async()=>{
  const e=await writeSession();e.proof("LAUNCH");assert.equal(typeof e.api.planOriginalParentCommand,"function");
  const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");assert.ok(Object.isFrozen(token));assert.equal(e.writes.length,0);
  const v=e.view();assert.equal(v.admission.active.protocol_state,"LAUNCHED");assert.equal(v.admission.active.frames,1);
  assert.equal(v.terminal.facts.commands.length,1);assert.equal(v.terminal.facts.commands[0].decision,"planned");
  assert.equal(e.models,1);assert.equal(e.decoders,1);
});
test("B4-B5 false write return is backpressure, and only its callback settles the original write",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.writeReturn=false;
  e.api.writeOriginalParentCommand(e.ref,token);assert.equal(e.writes.length,1);
  let r=e.view().terminal.facts.commands[0];assert.equal(r.started,true);assert.equal(r.backpressure,true);assert.equal(r.callback_seen,false);
  e.c.pipes.command.emit("drain");assert.equal(e.writes.length,1);assert.equal(e.view().terminal.facts.pending_generation,1);
  e.writes[0].callback();r=e.view().terminal.facts.commands[0];assert.equal(r.callback_seen,true);assert.equal(r.decision,"completed");
  assert.equal(e.view().terminal.facts.pending_generation,null);assert.equal(e.c.operationTimer,null);
});
test("B4-B5 close-only ends the original pipe once, but return alone is not confirmed close",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const t=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,t);e.writes[0].callback();
  e.api.failOriginalParentEvent(e.c,"invented_stop");e.proof("CANCEL");
  assert.equal(e.api.planOriginalParentShutdown(e.ref).decision,"CLOSE_ONLY");e.api.endOriginalParentCommand(e.ref);
  assert.equal(e.ends,1);assert.deepEqual(plain(e.view().terminal.facts.command_end),{decision:"attempted",outcome:"returned"});
  assert.equal(e.view().admission.active.command_close,null);e.c.pipes.command.emit("finish");assert.equal(e.view().admission.active.command_close,null);
  e.c.pipes.command.emit("close");assert.equal(e.view().admission.active.command_close,"confirmed");
  assert.throws(()=>e.api.endOriginalParentCommand(e.ref),/once/);assert.equal(e.ends,1);
});
test("B4-B5 synchronous callback retains the later return without reentrant planning",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");
  e.onWrite=(_line,callback)=>{callback();assert.throws(()=>e.api.planOriginalParentCommand(e.ref,"PREPARE"),/busy/);};
  e.api.writeOriginalParentCommand(e.ref,token);const r=e.view().terminal.facts.commands[0];
  assert.equal(r.decision,"completed");assert.equal(r.write_return_seen,true);assert.equal(r.backpressure,false);assert.equal(e.writes.length,1);
});
for(const variant of ["throw","invalid_return"])test("B4-B5 synchronous callback cannot hide a subsequent write failure: "+variant,async()=>{
  const e=await writeSession();e.proof("LAUNCH");const t=e.api.planOriginalParentCommand(e.ref,"LAUNCH");
  e.onWrite=(_line,callback)=>callback();if(variant==="throw")e.writeThrows=true;else e.writeReturn=undefined;
  assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,t));const v=e.view(),r=v.terminal.facts.commands[0];
  assert.equal(r.observed_outcome,"completed");assert.equal(r.callback_seen,true);assert.equal(r.write_return_seen,false);
  assert.equal(v.admission.stopped,true);assert.equal(e.writes.length,1);assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,t),/once/);
});
for(const variant of ["throw","invalid_return","pipe_error"])test("B4-B5 original delivery failure is retained without resend: "+variant,async()=>{
  const e=await writeSession();e.proof("LAUNCH");const t=e.api.planOriginalParentCommand(e.ref,"LAUNCH");
  if(variant==="throw")e.writeThrows=true;if(variant==="invalid_return")e.writeReturn=undefined;
  if(variant==="pipe_error")e.onWrite=()=>e.c.pipes.command.emit("error",Error("write_error"));
  if(variant==="pipe_error")e.api.writeOriginalParentCommand(e.ref,t);else assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,t));
  let r=e.view().terminal.facts.commands[0];assert.equal(r.decision,"uncertain");assert.equal(r.callback_seen,false);
  assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,t),/once/);assert.equal(e.writes.length,1);
  e.writes[0].callback();r=e.view().terminal.facts.commands[0];assert.equal(r.observed_outcome,"completed");assert.equal(r.decision,"uncertain");
});
test("B4-B5 callback after deadline keeps observation time separate from effective delivery",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const t=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,t);
  const deadline=e.view().terminal.facts.commands[0].reservation.deadline_ns;e.now=BigInt(deadline)+500n;e.writes[0].callback();
  const v=e.view(),r=v.terminal.facts.commands[0];assert.equal(v.admission.first_stop_ns,deadline);assert.equal(r.decision,"uncertain");
  assert.equal(r.callback_at,null);assert.equal(r.observation_point.monotonic_ns,String(e.now));assert.equal(v.admission.clock_invalid,false);
  const reads=e.reads;e.writes[0].callback(Error("duplicate"));assert.equal(e.reads,reads);
});
test("B4-B5 a clock fault retains callback observation without inventing a time",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const t=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,t);
  e.clockFailure={clock_invalid:true,failure:"invented",stop_ns:null};e.writes[0].callback();const v=e.view(),r=v.terminal.facts.commands[0];
  assert.equal(v.admission.clock_invalid,true);assert.equal(r.callback_seen,true);assert.equal(r.observation_point,null);assert.equal(r.callback_at,null);
  assert.equal(r.decision,"started");assert.equal(v.terminal.facts.pending_generation,null);
});
test("B4-B5 a late synchronous write return stops at the original bound",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const t=e.api.planOriginalParentCommand(e.ref,"LAUNCH");const deadline=e.view().terminal.facts.commands[0].reservation.deadline_ns;
  e.onWrite=()=>{e.now=BigInt(deadline)+1n;};e.api.writeOriginalParentCommand(e.ref,t);
  const r=e.view().terminal.facts.commands[0];assert.equal(r.write_return_seen,true);assert.equal(r.decision,"uncertain");assert.equal(e.view().admission.first_stop_ns,deadline);
});
test("B4-B5 copied, foreign and repeated command tokens never reach the pipe",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const t=e.api.planOriginalParentCommand(e.ref,"LAUNCH");
  assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,{...t}));assert.equal(e.writes.length,0);
  e.api.writeOriginalParentCommand(e.ref,t);assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,t));assert.equal(e.writes.length,1);
});
for(const variant of ["end_throw","sync_close","close_without_finish"])test("B4-B5 end return and terminal facts stay distinct: "+variant,async()=>{
  const e=await writeSession();e.proof("LAUNCH");const t=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,t);e.writes[0].callback();
  e.api.failOriginalParentEvent(e.c,"stop");e.proof("CANCEL");e.api.planOriginalParentShutdown(e.ref);
  if(variant==="end_throw")e.endThrows=true;
  if(variant==="sync_close")e.onEnd=()=>{e.c.pipes.command.emit("finish");e.c.pipes.command.emit("close");};
  if(variant==="end_throw")assert.throws(()=>e.api.endOriginalParentCommand(e.ref));else e.api.endOriginalParentCommand(e.ref);
  if(variant==="close_without_finish")e.c.pipes.command.emit("close");
  const v=e.view();assert.equal(e.ends,1);assert.equal(v.terminal.facts.command_end.outcome,variant==="end_throw"?"unknown":"returned");
  assert.equal(v.admission.active.command_close,variant==="sync_close"?"confirmed":variant==="close_without_finish"?"unconfirmed":null);
});
test("B4-B5 encoder exact/one-over bytes use the same bounded pure preflight",()=>{
  const value={x:"a".repeat(65527)};assert.equal(Buffer.byteLength(encodeUnsignedTransportFrame(value)),65536);
  assert.throws(()=>encodeUnsignedTransportFrame({x:"a".repeat(65528)}),/frame_bound/);
});
test("B4-B5 original planned CANCEL drains after normal RELEASED without a new deadline",async()=>{
  const e=await activeSession();e.proof("CANCEL");const t=e.api.planOriginalParentCommand(e.ref,"CANCEL");const before=e.view().terminal.facts.commands.at(-1);
  e.release();assert.equal(e.view().admission.active.protocol_state,"RELEASED");e.api.writeOriginalParentCommand(e.ref,t);e.writes.at(-1).callback();
  const after=e.view().terminal.facts.commands.at(-1);assert.equal(after.reservation.deadline_ns,before.reservation.deadline_ns);assert.equal(after.generation,before.generation);
  assert.equal(after.decision,"completed");assert.throws(()=>e.api.planOriginalParentCommand(e.ref,"CANCEL"),/busy/);
  e.finalize();e.api.endOriginalParentCommand(e.ref);e.c.pipes.command.emit("finish");e.c.pipes.command.emit("close");
  assert.equal(e.view().admission.active.command_close,"confirmed");assert.equal(e.view().admission.stopped,false);
  assert.deepEqual(e.view().terminal.facts.commands.map(r=>r.kind),["LAUNCH","PREPARE","GO","CANCEL","FINALIZE"]);
});
test("B4-B5 stopped ACTIVE allocates one original shutdown CANCEL and waits for its callback",async()=>{
  const e=await activeSession();e.api.failOriginalParentEvent(e.c,"stop");const first=e.view().admission.first_stop_ns;e.proof("CANCEL");
  const plan=e.api.planOriginalParentShutdown(e.ref);assert.equal(plan.decision,"CANCEL_THEN_CLOSE");assert.throws(()=>e.api.endOriginalParentCommand(e.ref),/pending/);
  e.api.writeOriginalParentCommand(e.ref,plan.reference);assert.throws(()=>e.api.endOriginalParentCommand(e.ref),/busy/);e.writes.at(-1).callback();
  assert.equal(e.view().terminal.facts.commands.at(-1).shutdown,true);assert.equal(e.view().terminal.facts.commands.at(-1).decision,"completed");
  e.api.endOriginalParentCommand(e.ref);assert.equal(e.ends,1);assert.equal(e.view().admission.first_stop_ns,first);assert.throws(()=>e.api.planOriginalParentShutdown(e.ref),/once/);
});
test("B4-B5 shutdown reuses the exact unstarted ordinary CANCEL and reservation",async()=>{
  const e=await activeSession();e.proof("CANCEL");const t=e.api.planOriginalParentCommand(e.ref,"CANCEL"),w=e.context.parentWrites.get(t),line=w.line;
  const deadline=w.record.reservation.deadline_ns,frames=e.view().admission.active.frames;e.api.failOriginalParentEvent(e.c,"stop");e.proof("CANCEL");
  const result=e.api.planOriginalParentShutdown(e.ref);assert.equal(result.reference,t);assert.equal(e.view().admission.active.frames,frames);
  assert.equal(w.line,line);assert.equal(w.record.reservation.deadline_ns,deadline);e.api.writeOriginalParentCommand(e.ref,t);e.writes.at(-1).callback();
  assert.equal(e.writes.at(-1).line,line);assert.equal(w.record.decision,"completed");
});
test("B4-B5 refused late capture makes shutdown close-only without another frame",async()=>{
  const e=await activeSession();e.api.failOriginalParentEvent(e.c,"stop");const frames=e.view().admission.active.frames;
  e.c.pipes.status.emit("data",Buffer.from("not-json\n"));e.proof("CANCEL");const result=e.api.planOriginalParentShutdown(e.ref);
  assert.equal(e.view().admission.active.late_capture,"refused");assert.equal(result.decision,"CLOSE_ONLY");assert.equal(e.view().admission.active.frames,frames);
});
test("B4-B5 an outstanding callback cannot spend shutdown authority or a new ordinal",async()=>{
  const e=await activeSession();e.proof("CANCEL");const token=e.api.planOriginalParentCommand(e.ref,"CANCEL");
  e.api.writeOriginalParentCommand(e.ref,token);e.api.failOriginalParentEvent(e.c,"stop");const proof=e.proof("CANCEL"),before=e.view();
  assert.throws(()=>e.api.planOriginalParentShutdown(e.ref),/busy/);assert.equal(proof.consumed,false);assert.equal(e.c.shutdownConsidered,false);
  assert.equal(e.view().admission.active.frames,before.admission.active.frames);assert.equal(e.writes.length,4);
  e.writes.at(-1).callback();const r=e.view().terminal.facts.commands.at(-1);
  assert.equal(r.callback_seen,true);assert.equal(r.observed_outcome,"completed");assert.equal(r.decision,"started");
  assert.equal(e.view().terminal.facts.pending_generation,null);assert.equal(e.view().admission.first_stop_ns,before.admission.first_stop_ns);
});
test("B4-B5 an expired unstarted CANCEL becomes close-only without renewed reservation",async()=>{
  const e=await activeSession();e.proof("CANCEL");const token=e.api.planOriginalParentCommand(e.ref,"CANCEL");
  const before=e.view(),deadline=before.terminal.facts.commands.at(-1).reservation.deadline_ns;
  e.now=BigInt(deadline)+1n;e.api.failOriginalParentEvent(e.c,"stop");e.proof("CANCEL");
  assert.equal(e.api.planOriginalParentShutdown(e.ref).decision,"CLOSE_ONLY");
  assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,token));assert.equal(e.writes.length,3);
  assert.equal(e.view().admission.active.frames,before.admission.active.frames);
  assert.equal(e.view().terminal.facts.commands.at(-1).reservation.deadline_ns,deadline);
  e.api.endOriginalParentCommand(e.ref);assert.equal(e.ends,1);
});
test("B4-B5 unknown-time shutdown retains only untimed close facts and never backfills",async()=>{
  const e=await activeSession();e.api.failOriginalParentEvent(e.c,"stop");e.clockFailure={clock_invalid:true,failure:"invented",stop_ns:null};e.proof("CANCEL");
  assert.equal(e.api.planOriginalParentShutdown(e.ref).decision,"CLOSE_ONLY");const writes=e.writes.length;
  e.api.endOriginalParentCommand(e.ref);e.c.pipes.command.emit("finish");e.c.pipes.command.emit("close");
  assert.equal(e.ends,1);assert.equal(e.writes.length,writes);assert.equal(e.view().terminal.facts.pipes.command.close_seen,true);
  assert.equal(e.view().admission.active.command_close,null);e.clockFailure=null;e.c.pipes.command.emit("close");
  assert.equal(e.view().admission.active.command_close,null);assert.equal(e.view().admission.clock_invalid,true);
});
for(const variant of ["copied","wrong_kind","wrong_owner","wrong_pipe"])test("B4-B5 proof rejects "+variant+" before frame admission",async()=>{
  const e=await writeSession(),p=e.proof("LAUNCH");
  if(variant==="copied")e.commandProofRef={...e.commandProofRef};if(variant==="wrong_kind")p.kind="GO";
  if(variant==="wrong_owner")p.owner={};if(variant==="wrong_pipe")p.pipe={};
  assert.throws(()=>e.api.planOriginalParentCommand(e.ref,"LAUNCH"),/proof/);assert.equal(p.consumed,false);
  assert.equal(e.writes.length,0);assert.equal(e.view().admission.active.frames,0);
});
for(const variant of ["helper","hash_budget","oversize"])test("B4-B5 bounded refusal before pipe dispatch: "+variant,async()=>{
  const e=await writeSession();e.proof("LAUNCH");
  if(variant==="hash_budget")e.s.hashBytes=2147483648n;
  if(variant==="oversize")e.proof("PREPARE",{configuration:{x:"x".repeat(65536)}},e.view().admission.active.binding);
  if(variant==="helper"){
    const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.s.helper={};assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,token),/binding/);
  }else assert.throws(()=>e.api.planOriginalParentCommand(e.ref,variant==="oversize"?"PREPARE":"LAUNCH"),/hash_work|frame_bound/);
  assert.equal(e.writes.length,0);assert.equal(e.view().admission.active.frames,variant==="helper"?1:0);
});
test("B4-B5 retired callbacks and pipe events are inert before sampling the clock",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,token);
  const before=plain(e.c.facts),reads=e.reads;e.c.owner.generation++;
  e.writes[0].callback(Error("retired"));e.c.pipes.command.emit("error",Error("retired"));e.c.pipes.command.emit("close");
  assert.equal(e.reads,reads);assert.deepEqual(plain(e.c.facts),before);
});
test("B4-B5 generation loss inside original write never samples or relays to another owner",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");let afterDispatch;
  e.onWrite=()=>{e.c.owner.generation++;afterDispatch=e.reads;};assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,token));
  assert.equal(e.reads,afterDispatch);assert.equal(e.writes.length,1);assert.equal(e.c.facts.commands[0].decision,"started");
  e.writes[0].callback();assert.equal(e.reads,afterDispatch);assert.equal(e.c.facts.commands[0].callback_seen,false);
});
test("B4-B5 callback error is uncertain once and cannot be repaired by a duplicate success",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,token);
  e.writes[0].callback(Error("invented_callback"));const r=e.view().terminal.facts.commands[0],reads=e.reads;
  assert.equal(r.decision,"uncertain");assert.equal(r.observed_outcome,"uncertain");assert.ok(r.callback_at);assert.equal(e.view().admission.stopped,true);
  e.writes[0].callback();assert.equal(e.reads,reads);assert.deepEqual(e.view().terminal.facts.commands[0],r);
});
test("B4-B5 cohort-end observation preserves the earlier write deadline and valid-clock classification",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,token);
  const deadline=e.view().terminal.facts.commands[0].reservation.deadline_ns;
  e.clockFailure={clock_invalid:false,failure:"entry_deadline",stop_ns:e.context.clock.end_ns};e.writes[0].callback();const v=e.view();
  assert.equal(v.admission.first_stop_ns,deadline);assert.equal(v.admission.clock_invalid,false);
  assert.equal(v.terminal.facts.commands[0].observation_point.monotonic_ns,e.context.clock.end_ns);assert.equal(v.terminal.facts.commands[0].callback_at,null);
});
test("B4-B5 a sub-ms dispatch remainder refuses before the original pipe call",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH"),before=e.view();
  e.now=BigInt(before.terminal.facts.commands[0].reservation.deadline_ns)-999999n;
  assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,token),/write_deadline/);assert.equal(e.writes.length,0);
  assert.equal(e.view().terminal.facts.commands[0].reservation.deadline_ns,before.terminal.facts.commands[0].reservation.deadline_ns);
  assert.equal(e.view().admission.stopped,true);
});
test("B4-B5 completion-time rollback preserves the observation as unknown instead of using an old stamp",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,token);
  e.now=0n;e.writes[0].callback();const v=e.view();assert.equal(v.admission.clock_invalid,true);
  assert.equal(v.terminal.facts.commands[0].observation_point,null);assert.equal(v.terminal.facts.commands[0].callback_at,null);
  assert.equal(v.terminal.facts.commands[0].observed_outcome,"completed");assert.equal(v.terminal.facts.commands[0].decision,"started");
});
for(const terminal of ["error","close"])test("B4-B5 unusable stopped command pipe still records a close-only withheld end decision: "+terminal,async()=>{
  const e=await activeSession();e.c.pipes.command.emit(terminal,Error("invented_pipe"));e.proof("CANCEL");
  assert.equal(e.api.planOriginalParentShutdown(e.ref).decision,"CLOSE_ONLY");e.api.endOriginalParentCommand(e.ref);
  assert.equal(e.ends,0);assert.equal(e.writes.length,3);assert.equal(e.view().terminal.facts.command_end.decision,"withheld");
});
test("B4-B5 stopped helper excludes shutdown planning before authority or frame consumption",async()=>{
  const e=await activeSession();e.plan();const helper=track(e.api.runOriginalParentHelper(e.ref));await flush();
  assert.equal(e.spawned.length,2);assert.equal(e.view().terminal.facts.helper.active,true);e.api.failOriginalParentEvent(e.c,"stop");
  const proof=e.proof("CANCEL"),frames=e.view().admission.active.frames;
  assert.throws(()=>e.api.planOriginalParentShutdown(e.ref),/busy/);assert.equal(proof.consumed,false);assert.equal(e.c.shutdownConsidered,false);
  assert.equal(e.view().admission.active.frames,frames);assert.equal(e.view().terminal.facts.helper.active,true);
  e.spawned[1].child.emit("close",0,null);await flush();assert.equal(helper.state,"rejected");assert.equal(e.s.helper,null);
  const stop=e.view().admission.first_stop_ns;assert.equal(e.api.planOriginalParentShutdown(e.ref).decision,"CANCEL_THEN_CLOSE");
  assert.equal(proof.consumed,true);assert.equal(e.view().admission.first_stop_ns,stop);
});
test("B4-B5 stop after normal RELEASED selects close-only without restarting settlement supervision",async()=>{
  const e=await activeSession();e.release();e.api.selectOriginalParentPhase(e.ref);e.api.failOriginalParentEvent(e.c,"stop");
  const before=e.view(),timers=e.timers.length;e.proof("CANCEL");assert.equal(e.api.planOriginalParentShutdown(e.ref).decision,"CLOSE_ONLY");
  assert.equal(e.timers.length,timers);assert.equal(e.view().admission.first_stop_ns,before.admission.first_stop_ns);
  assert.equal(e.view().admission.active.window.phase_deadline_ns,before.admission.active.window.phase_deadline_ns);
  e.api.endOriginalParentCommand(e.ref);assert.equal(e.ends,1);assert.equal(e.writes.length,3);
});
for(const sampling of ["initial","final"])test("B4-B5 shutdown refuses sub-ms original CANCEL reuse at "+sampling+" sampling",async()=>{
  const e=await activeSession();e.proof("CANCEL");const token=e.api.planOriginalParentCommand(e.ref,"CANCEL");
  const deadline=e.view().terminal.facts.commands.at(-1).reservation.deadline_ns;
  e.now=BigInt(deadline)-(sampling==="initial"?500000n:1500000n);e.api.failOriginalParentEvent(e.c,"stop");
  if(sampling==="final")e.onRef=()=>{e.now=BigInt(deadline)-500000n;};
  e.proof("CANCEL");const frames=e.view().admission.active.frames;
  assert.equal(e.api.planOriginalParentShutdown(e.ref).decision,"CLOSE_ONLY");assert.equal(e.view().admission.active.frames,frames);
  assert.equal(e.view().terminal.facts.commands.at(-1).reservation.deadline_ns,deadline);assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,token));
  e.api.endOriginalParentCommand(e.ref);assert.equal(e.ends,1);assert.equal(e.writes.length,3);
});
test("B4-B5 exactly one millisecond still permits original CANCEL reuse without renewal",async()=>{
  const e=await activeSession();e.proof("CANCEL");const token=e.api.planOriginalParentCommand(e.ref,"CANCEL");
  const before=e.view(),deadline=before.terminal.facts.commands.at(-1).reservation.deadline_ns;
  e.now=BigInt(deadline)-1000000n;e.api.failOriginalParentEvent(e.c,"stop");e.proof("CANCEL");
  const plan=e.api.planOriginalParentShutdown(e.ref);assert.equal(plan.decision,"CANCEL_THEN_CLOSE");assert.equal(plan.reference,token);
  assert.equal(e.view().admission.active.frames,before.admission.active.frames);assert.equal(e.view().terminal.facts.commands.at(-1).reservation.deadline_ns,deadline);
  e.api.writeOriginalParentCommand(e.ref,token);e.writes.at(-1).callback();assert.equal(e.view().terminal.facts.commands.at(-1).decision,"completed");
});
for(const stopping of ["owner_sync","deadline_sync"])test("B4-B5 completion rechecks ownership after stop-time timer clearing: "+stopping,async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,token);
  let retiredReads;if(stopping==="owner_sync")e.s.stopped="invented_stop";else e.now=BigInt(e.c.facts.commands[0].reservation.deadline_ns)+1n;
  e.onClear=()=>{e.onClear=null;e.c.owner.generation++;retiredReads=e.reads;};
  e.writes[0].callback();assert.notEqual(retiredReads,undefined);assert.equal(e.reads,retiredReads);assert.equal(e.c.facts.commands[0].callback_seen,false);
  assert.equal(e.c.facts.commands[0].decision,"started");
});
test("B4-B5 cached process clock exports are replaced without invoking them",()=>{
  for(const name of ["hrtime","uptime","cpuUsage","resourceUsage"])assert.equal(cachedProcess[name],process[name],name);
});
test("B4-B5 reentrant original callback cannot turn increasing time into clock rollback",async()=>{
  const e=await writeSession();e.proof("LAUNCH");const token=e.api.planOriginalParentCommand(e.ref,"LAUNCH");e.api.writeOriginalParentCommand(e.ref,token);
  const deadline=e.c.facts.commands[0].reservation.deadline_ns,observed=BigInt(deadline)+1n;e.now=observed;
  let beforeNested,afterNested;e.onClear=()=>{e.onClear=null;e.now=observed+1n;beforeNested=e.reads;e.writes[0].callback();afterNested=e.reads;};
  e.writes[0].callback();const v=e.view(),r=v.terminal.facts.commands[0];
  assert.notEqual(beforeNested,undefined);assert.equal(afterNested,beforeNested);
  assert.equal(v.admission.clock_invalid,false);assert.equal(v.admission.first_stop_ns,deadline);
  assert.equal(r.observation_point.monotonic_ns,String(observed));assert.equal(r.decision,"uncertain");assert.equal(r.callback_seen,true);
});
test("B4-B5 no denied effect was swallowed",()=>assert.deepEqual(effects,[]));
