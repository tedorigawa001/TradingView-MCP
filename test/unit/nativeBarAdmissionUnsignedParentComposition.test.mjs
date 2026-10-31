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
const {createUnsignedIsolatedTypeScript}=await import("../helpers/unsignedIsolatedTypeScript.mjs");
const compilerSource=fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js",import.meta.url),"utf8");
const ts=createUnsignedIsolatedTypeScript(compilerSource);
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
function memory({ producers = false, omit = null, mutate = null } = {}) {
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
  const altered = mutate ? ts.createSourceFile("runtime.mjs", mutate(source), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) : null;
  const definitions = altered ? altered.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="prepareOriginalQualification").body.statements
    .filter(n=>ts.isFunctionDeclaration(n)&&declarations.some(d=>d.name.text===n.name.text)) : declarations;
  const api = vm.compileFunction('"use strict";\n' + definitions.map(n=>replacements[n.name.text] ?? n.getText().replace('const { spawn } = await import("node:child_process");','const { spawn } = await memoryChildImport();')).join("\n")
    + "\nreturn {" + definitions.map(n=>n.name.text).join(",") + "};", Object.keys(context))(...Object.values(context));
  Object.assign(e,{s,buildRef,namespaceRef,context,api});
  e.owner = () => api.createOriginalParentOwner(s,buildRef,namespaceRef);
  e.session = () => { const owner = e.ownerRef ??= e.owner(); return api.reserveOriginalParentSession(owner); };
  return e;
}

function session(options = {}) {
  const e = memory({producers:true, ...options}); e.ref = e.session(); e.c = e.context.parentSessions.get(e.ref);
  e.fire = index => e.timers[index].callback();
  e.view = () => e.api.describeOriginalParent(e.ref);
  e.plan=()=>{const ref=Object.freeze({}),plan={owner:e.c,program:"/bin/ls",args:Object.freeze(["-lde","/invented/pin"]),consumed:false};e.context.parentHelperPlans.set(ref,plan);e.planRef=ref;return plan;};
  return e;
}

const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const track=promise=>{const r={state:"pending"};promise.then(value=>Object.assign(r,{state:"resolved",value}),error=>Object.assign(r,{state:"rejected",error}));return r;};
function launchSession(options = {}) {
  const e=session(options);e.s.sourceIdentity={node:"/invented/node"};e.s.recordHash=h;
  const node={path:"/invented/node",roles:["node"],sha256:h};
  const worker={path:"/invented/native/native_bar_fs/test_unsigned_cohort_worker.mjs",roles:["runtime"],sha256:h};
  e.s.inputs={rows:[node,worker]};
  const ref=Object.freeze({});e.launchPlan={owner:e.c,buildRef:e.buildRef,namespaceRef:e.namespaceRef,allocation:e.c.allocation,node,worker,consumed:false};
  e.context.parentLaunchPlans.set(ref,e.launchPlan);e.launchPlanRef=ref;return e;
}

async function writeSession(options = {}) {
  const e=launchSession(options);const started=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(started.state,"resolved");
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

async function activeSession(input = null) {
  const e=input ?? await writeSession(),f={...e.c.allocation.fixture,fixture_name:"native-bar-fs-synthetic-Ab123Z"};
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
const { createUnsignedWorkerTransportModel } = await import("../helpers/unsignedWorkerTransportContracts.mjs");

async function connected(options = {}) {
  const e=await writeSession(options),owner=e.c.owner,coordinator=owner.coordinator,decoder=e.c.decoder;
  // Capture only test inputs; replay the oracle after the actual bootstrap finishes.
  const bootstrap=[],originalWrite=e.c.pipes.command.write,originalWorker=e.worker;
  e.c.pipes.command.write=(line,encoding,callback)=>{
    bootstrap.push({action:"plan",line,at:point(e.now),deadline:e.c.pendingWrite.record.reservation.deadline_ns});
    bootstrap.push({action:"start",at:point(e.now)});
    const returned=originalWrite(line,encoding,error=>{bootstrap.push({action:"complete",outcome:error==null?"completed":"uncertain",at:point(e.now)});callback(error);});
    bootstrap.push({action:"return",backpressure:!returned});return returned;
  };
  e.worker=(kind,payload)=>{const at=point(e.now),line=originalWorker(kind,payload);bootstrap.push({action:"receive",line,at});return line;};
  try { await activeSession(e); }
  finally { e.c.pipes.command.write=originalWrite;e.worker=originalWorker; }
  assert.equal(bootstrap.length,14);
  const reference=createUnsignedWorkerTransportModel({allocation:e.c.allocation,clock:e.context.clock.binding,allocated_at:point(1n)});
  let original;
  for(const step of bootstrap){
    if(step.action==="plan"){const frame=JSON.parse(step.line);original=reference.planCommand({kind:frame.kind,payload:frame.payload,binding:frame.binding,at:step.at});
      assert.equal(original.line,step.line);assert.equal(original.deadline_ns,step.deadline);}
    else if(step.action==="start")reference.startWrite(original.reference,{at:step.at});
    else if(step.action==="return")reference.noteBackpressure(original.reference,{backpressure:step.backpressure});
    else if(step.action==="complete")reference.completeWrite(original.reference,{outcome:step.outcome,at:step.at});
    else reference.receive({line:step.line,at:step.at});
  }
  const compare=()=>{
    assert.equal(e.c.owner,owner);assert.equal(owner.coordinator,coordinator);assert.equal(e.c.decoder,decoder);
    assert.equal(e.models,1);assert.equal(e.decoders,1);assert.notEqual(reference,coordinator);
    const actual=e.view(),b=actual.admission.active,t=reference.describe(),late=coordinator.describeLateFrames(e.c.caseRef);
    for(const key of ["binding","frames","next_ordinals","protocol_state","go_submitted","baseline_sha256","trace_chunks","trace_events","trace_sha256"])
      assert.deepEqual(t[key],b[key],key);
    assert.equal(actual.admission.stopped,t.stopped!==null);assert.equal(actual.admission.clock_invalid,t.clock_invalid);
    assert.equal(b.window.phase,t.phase);assert.equal(b.window.phase_deadline_ns,t.phase_deadline_ns);
    assert.equal(b.window.starts.settlement??null,t.settlement_start_ns);
    assert.deepEqual(t.late_frames,late.late_frames);
    assert.equal(t.late_capture?.capture??"inactive",b.late_capture);
    assert.equal(actual.terminal.facts.commands.length,t.writes.length);
    assert.equal(actual.terminal.facts.pending_generation,t.pending_generation,"original pending generation");
    for(const [i,w]of t.writes.entries()){
      const r=actual.terminal.facts.commands[i];assert.equal(r.kind,w.kind);assert.equal(r.ordinal,w.ordinal);
      assert.equal(r.sha256,w.sha256);assert.equal(r.reservation.deadline_ns,w.deadline_ns);
      assert.equal(r.callback_seen,w.callback!==null,"original callback observation");assert.equal(r.observed_outcome,w.callback);
      assert.equal(r.write_return_seen,w.backpressure!==null);assert.equal(r.backpressure,w.backpressure);
      if(r.callback_seen)assert.equal(r.decision,w.decision,"effective callback disposition");
    }
    for(const [key,value]of Object.entries(data.flags()))if(typeof value==="boolean")assert.equal(actual.admission[key],false,key);
    return t;
  };
  const attempt=fn=>{try{return {value:fn(),error:null};}catch(error){return {value:null,error};}};
  const plan=(kind,payload={},binding)=>{
    const at=point(e.now),op=reference.planCommand({kind,payload,...(binding?{binding}:{}),at});e.proof(kind,payload,binding);
    const token=e.api.planOriginalParentCommand(e.ref,kind),r=e.context.parentWrites.get(token).record;
    assert.equal(e.context.parentWrites.get(token).line,op.line);assert.equal(r.reservation.deadline_ns,op.deadline_ns);
    compare();return {...op,token,kind,callback:null};
  };
  const start=op=>{
    const at=point(e.now),predicted=attempt(()=>reference.startWrite(op.reference,{at})),count=e.writes.length;
    const actual=attempt(()=>e.api.writeOriginalParentCommand(e.ref,op.token));assert.equal(actual.error===null,predicted.error===null,"start disposition");
    if(e.writes.length>count){assert.equal(e.writes.length,count+1);const write=e.writes.at(-1);assert.equal(write.line,op.line);op.callback=write.callback;
      reference.noteBackpressure(op.reference,{backpressure:!e.writeReturn});}
    compare();return actual;
  };
  const complete=(op,outcome="completed")=>{
    assert.equal(typeof op.callback,"function");reference.completeWrite(op.reference,{outcome,at:e.clockFailure?null:point(e.now)});
    op.callback(outcome==="completed"?undefined:Error("invented_callback"));return compare();
  };
  const line=(kind,payload,ordinal=reference.describe().next_ordinals.worker)=>data.canonical({binding:reference.describe().binding,direction:"worker",ordinal,kind,payload})+"\n";
  const release=()=>{const t=reference.describe();return {baseline_sha256:t.baseline_sha256,resources:{fds:"4",roots:"0",workspace:"0",retained:"0"},
    query:"settled",native:"settled",original_operation_retired:true,query_released:true,close_errors:[],diagnostic_sha256:h,observation_sha256:null,
    trace_chunks:t.trace_chunks,trace_events:t.trace_events,trace_sha256:t.trace_sha256,primary_code:"oracle_unavailable",requests_dispatched:1,authenticated_requests:0,
    c0_dispatched_at:null,c0_authenticated_at:null,retired_at:null};};
  const referenceDecoder=createUnsignedProtocolDecoder();
  const bytes=chunk=>{
    let lines;
    try{lines=referenceDecoder.push(chunk);}catch{reference.stop({reason:"decoder_failure",at:point(e.now)});attempt(()=>reference.receive({line:""}));}
    if(lines)for(const raw of lines){const result=attempt(()=>reference.receive({line:raw,...(reference.describe().stopped?{}:{at:e.clockFailure??point(e.now)})}));if(result.error)break;}
    e.c.pipes.status.emit("data",chunk);return compare();
  };
  const feed=raw=>bytes(Buffer.from(raw));
  const eof=()=>{let reason="stream_closed";try{referenceDecoder.end();}catch{reason="truncated_frame";}
    reference.refuseReceive({reason});e.c.pipes.status.emit("end");return compare();};
  const stop=(reason="primary")=>{reference.stop({reason,at:point(e.now)});e.api.failOriginalParentEvent(e.c,reason);return compare();};
  const shutdown=()=>{
    const predicted=reference.planShutdown({at:e.clockFailure?null:point(e.now),worker_live:true,pipe_qualified:true});e.proof("CANCEL");
    const actual=e.api.planOriginalParentShutdown(e.ref);assert.equal(actual.decision,predicted.decision);
    if(actual.reference){const write=e.context.parentWrites.get(actual.reference);assert.equal(write.line,predicted.line);
      assert.equal(write.record.reservation.deadline_ns,reference.describe().writes.find(w=>w.sha256===data.sha(predicted.line)).deadline_ns);}
    compare();return {...predicted,token:actual.reference,kind:"CANCEL",callback:null};
  };
  const suppliedPoint=()=>{
    e.now++;const at=e.api.sampleOriginalParentCompletion(e.c);if(!at)throw Error("memory_producer_time_unavailable");
    owner.lastNs=at.monotonic_ns;return at;
  };
  const supplied=(kind,payload={})=>{
    if(!["resource","receipt","receipt_readback","report","report_readback","case_closes","index_row","index_readback"].includes(kind))throw Error("memory_producer_kind");
    const at=suppliedPoint();return coordinator.applyModelEvent(e.c.caseRef,{kind,payload:typeof payload==="function"?payload(at):payload,at});
  };
  const receipt=(kind,payload={})=>{const record=supplied("receipt",at=>({kind,payload,stamp:{...at,
    wall_utc:"2026-10-31T00:00:00.000Z",wall_jst:"2026-10-31T09:00:00.000+09:00"}}));supplied("receipt_readback",{line:record.line});return record;};
  compare();return {e,reference,coordinator,compare,attempt,plan,start,complete,line,release,bytes,feed,eof,stop,shutdown,suppliedPoint,supplied,receipt};
}
function assertSuppliedCleanupGate(s){
  const released=s.release();s.receipt("run_outcome",{primary_code:released.primary_code,requests_dispatched:1,authenticated_requests:0,
    diagnostic_sha256:h,observation_sha256:null,observation_bytes:0,trace_sha256:released.trace_sha256,trace_events:released.trace_events});
  s.receipt("release_checked",{baseline_sha256:released.baseline_sha256,resources:released.resources,query_released:true,
    original_operation_retired:true,close_errors:[],bound_objects_sha256:null});
  s.receipt("cleanup_precheck",{inventory_sha256:h});s.e.api.selectOriginalParentPhase(s.e.ref);
  const at=point(s.e.view().admission.active.window.starts.teardown);s.reference.noteTeardown({action:"started",at});
  assert.equal(s.e.view().admission.active.window.phase,"teardown");s.compare();
}

test("B4-B6 startup uses one actual B2 owner and agrees with an isolated reference", async()=>{
  const s=await connected();const d=s.compare();assert.equal(d.protocol_state,"ACTIVE");
  assert.equal(s.e.models,1);assert.equal(s.e.decoders,1);
});
test("B4-B6 original CANCEL drains through the same connection after normal RELEASED",async()=>{
  const s=await connected(),op=s.plan("CANCEL"),before=s.compare();s.feed(s.line("RELEASED",s.release()));
  s.start(op);s.complete(op);const after=s.compare();assert.equal(after.protocol_state,"RELEASED");
  assert.equal(after.frames,before.frames+1);assert.equal(after.writes.at(-1).sha256,data.sha(op.line));
  assert.equal(after.writes.at(-1).deadline_ns,op.deadline_ns);assert.equal(after.writes.at(-1).decision,"completed");
  const actual=s.e.view().terminal.facts;assert.equal(actual.commands.at(-1).decision,"completed");assert.equal(actual.commands.at(-1).callback_seen,true);
  assert.equal(actual.pending_generation,null);assert.equal(s.e.c.pendingWrite,null);assert.equal(s.e.c.operationTimer,null);assertSuppliedCleanupGate(s);
});
const failure=()=>({phase:"finalize",primary_code:"invented_finalize_failure",close_errors:[],diagnostic_sha256:h,
  resources:{fds:"4",roots:"0",workspace:"0",retained:"0"},query_created:true,instrumentation_overflow:false});
const trace=(s,index)=>s.line("TRACE_CHUNK",{chunk_index:index,events:[{ordinal:index+1,api:"info",edge:"end",clock_domain:"worker-clock",
  monotonic_ns:String(index+1),code:null,byte_count:"0",sha256:null}]});
for(const cut of ["before_release","after_release","after_start","after_callback"])test("B4-B6 same-owner stop/release/CANCEL cut: "+cut,async()=>{
  const s=await connected(),op=s.plan("CANCEL");if(cut!=="before_release")s.feed(s.line("RELEASED",s.release()));
  if(["after_start","after_callback"].includes(cut))s.start(op);if(cut==="after_callback")s.complete(op);
  s.stop();const before=s.e.view(),reads=s.e.reads;s.feed(cut==="before_release"?s.line("RELEASED",s.release()):s.line("FAILED",failure()));
  const after=s.e.view();assert.equal(s.e.reads,reads);assert.equal(after.admission.active.frames,before.admission.active.frames+1);
  assert.deepEqual(after.admission.active.evidence,before.admission.active.evidence);assert.equal(after.admission.first_stop_ns,before.admission.first_stop_ns);
  if(cut==="after_start")s.complete(op);
  const shutdown=s.shutdown();assert.equal(shutdown.decision,cut==="before_release"?"CANCEL_THEN_CLOSE":"CLOSE_ONLY");
  if(shutdown.reference){assert.equal(shutdown.token,op.token);assert.equal(shutdown.line,op.line);s.start(shutdown);s.complete(shutdown);}
  assert.equal(s.e.view().admission.active.window.starts.teardown,undefined);assert.equal(s.compare().writes.filter(w=>w.kind==="CANCEL").length,1);
});
for(const planned of [false,true])for(const traffic of ["capacity","malformed","duplicate"])test(`B4-B6 ${traffic} traffic with planned shutdown=${planned}`,async()=>{
  const s=await connected(),original=s.plan("CANCEL");s.stop();const reserved=planned?s.shutdown():null;
  let invalid;if(traffic==="capacity"){for(let i=0;i<4;i++)s.feed(trace(s,i));invalid=trace(s,4);}
  else if(traffic==="duplicate"){invalid=trace(s,0);s.feed(invalid);}else invalid="{}\n";
  const before=s.compare();s.feed(invalid);const after=s.compare();assert.equal(after.frames,before.frames);
  assert.equal(after.late_capture.capture,traffic==="capacity"?"frozen":"refused");assert.equal(after.writes.at(-1).deadline_ns,original.deadline_ns);
  const shutdown=reserved??s.shutdown();if(traffic==="capacity"){assert.equal(shutdown.decision,"CANCEL_THEN_CLOSE");s.start(shutdown);s.complete(shutdown);}
  else if(planned){const count=s.e.writes.length;assert.ok(s.start(shutdown).error);assert.equal(s.e.writes.length,count);}
  else assert.equal(shutdown.decision,"CLOSE_ONLY");
  assert.equal(s.e.models,1);assert.equal(s.e.decoders,1);
});
for(const offset of [-2000000n,-500000n,0n,1n])test("B4-B6 original command deadline dominates release at offset "+offset,async()=>{
  const s=await connected(),op=s.plan("CANCEL"),deadline=op.deadline_ns;s.e.now=BigInt(deadline)+offset;
  s.feed(s.line("RELEASED",s.release()));const result=s.start(op),t=s.compare();assert.equal(result.error===null,offset===-2000000n);
  assert.equal(t.writes.at(-1).deadline_ns,deadline);assert.equal(t.writes.at(-1).sha256,data.sha(op.line));
  if(!result.error)s.complete(op);else assert.equal(s.e.writes.length,3);
  if(offset>=0n){assert.equal(s.e.view().admission.first_stop_ns,deadline);assert.equal(t.late_frames.length,1);}
});
for(const outcome of ["completed","uncertain","expired"])test("B4-B6 late RELEASED cannot repair the original callback: "+outcome,async()=>{
  const s=await connected(),op=s.plan("CANCEL");s.start(op);s.stop();s.feed(s.line("RELEASED",s.release()));const before=s.e.view();
  if(outcome==="expired")s.e.now=BigInt(op.deadline_ns)+1n;else s.e.now++;
  s.complete(op,outcome==="uncertain"?"uncertain":"completed");const after=s.e.view(),r=after.terminal.facts.commands.at(-1);
  assert.equal(after.admission.first_stop_ns,before.admission.first_stop_ns);assert.deepEqual(after.admission.active.evidence,before.admission.active.evidence);
  assert.equal(r.decision,outcome==="completed"?"started":"uncertain");assert.equal(s.shutdown().decision,"CLOSE_ONLY");
  if(outcome==="expired"){assert.equal(r.callback_at,null);assert.equal(r.observation_point.monotonic_ns,String(s.e.now));}
});
for(const bound of ["settlement","cohort"])test("B4-B6 late bytes cannot renew the original "+bound+" bound",async()=>{
  const s=await connected(),op=s.plan("CANCEL");s.stop();const before=s.e.view();
  s.e.now=BigInt(bound==="cohort"?s.e.context.clock.end_ns:before.admission.active.window.phase_deadline_ns)+1n;
  const reads=s.e.reads;s.feed(trace(s,0));assert.equal(s.e.reads,reads);assert.equal(s.shutdown().decision,"CLOSE_ONLY");
  assert.equal(s.e.view().admission.first_stop_ns,before.admission.first_stop_ns);assert.equal(s.compare().writes.at(-1).deadline_ns,op.deadline_ns);
});
test("B4-B6 RELEASED during a borrowed helper retains the one original pending reservation",async()=>{
  const s=await connected(),op=s.plan("CANCEL"),e=s.e;e.plan();const helper=track(e.api.runOriginalParentHelper(e.ref));await flush();
  const timer=e.c.operationTimer;assert.equal(e.view().terminal.facts.helper.under_command_generation,4);
  s.feed(s.line("RELEASED",s.release()));assert.equal(e.c.operationTimer,timer);assert.equal(timer.fact.deadline_ns,op.deadline_ns);
  const count=e.writes.length;assert.throws(()=>e.api.writeOriginalParentCommand(e.ref,op.token),/binding/);assert.equal(e.writes.length,count);
  e.spawned[1].child.emit("close",0,null);await flush();assert.equal(helper.state,"resolved");assert.equal(e.c.operationTimer,timer);
  assert.equal(e.c.helperLease,null);assert.equal(e.s.qualificationTimer,null);s.start(op);s.complete(op);assert.equal(e.models,1);
});
for(const stage of ["before_report","pending_report","confirmed_report","pending_index","retained_case","closed_index"])
test("B4-B6 late input cannot change supplied report/index evidence at "+stage,async()=>{
  const s=await connected(),op=s.plan("CANCEL");s.stop();let arrivals=0;
  const arrive=current=>{if(current!==stage)return;const before=s.e.view(),reads=s.e.reads;s.feed(s.line("RELEASED",s.release()));arrivals++;
    const after=s.e.view();assert.equal(s.e.reads,reads);assert.deepEqual(after.admission.active.evidence,before.admission.active.evidence);
    assert.deepEqual(after.admission.rows,before.admission.rows);assert.deepEqual(after.admission.active.window,before.admission.active.window);};
  s.receipt("stop_summary",{reason:"primary",details:[]});s.receipt("ready_to_report",{candidate_outcome:"FAIL",assessment_sha256:null});arrive("before_report");
  const report=s.supplied("report",at=>({observation:null,trace:[],comparison:null,limitations:[],save_stamp:{...at,
    wall_utc:"2026-10-31T00:00:00.000Z",wall_jst:"2026-10-31T09:00:00.000+09:00"}})),reportLine=report.line;
  arrive("pending_report");s.supplied("report_readback",{line:report.line});arrive("confirmed_report");
  s.receipt("terminal",{report_sha256:report.sha256});s.supplied("case_closes",{receipt:"confirmed",report:"confirmed",errors:[]});
  const row=s.supplied("index_row"),rowLine=row.line;arrive("pending_index");s.supplied("index_readback",{line:row.line});
  s.coordinator.finishCase(s.e.c.caseRef,{at:s.suppliedPoint()});s.coordinator.finishNotRun();arrive("retained_case");
  s.coordinator.closeIndex({outcome:"confirmed",at:s.suppliedPoint()});arrive("closed_index");const after=s.e.view().admission;
  assert.equal(arrivals,1);assert.equal(report.line,reportLine);assert.equal(row.line,rowLine);assert.equal(after.active.evidence.report_sha256,data.sha(reportLine));
  assert.equal(after.active.evidence.index_sha256,data.sha(rowLine));assert.equal(after.rows.length,24);assert.equal(after.rows[0].model_verdict,"FAIL");
  assert.equal(after.rows.filter(r=>r.model_verdict==="NOT_RUN").length,23);assert.equal(after.closed,true);assert.equal(after.active.evidence.evidence_saved,false);
  assert.equal(after.active.slots.worker,"live");assert.equal(after.active.slots.fixture,"live");assert.equal(s.compare().writes.at(-1).sha256,data.sha(op.line));
});
for(const fault of ["unavailable","foreign","rollback"])test("B4-B6 receive-time clock fault uses only untimed capture: "+fault,async()=>{
  const s=await connected();s.plan("CANCEL");
  if(fault==="unavailable")s.e.clockFailure={clock_invalid:true,failure:"invented",stop_ns:null};
  else{s.e.clockFailure=fault==="foreign"?{clock_domain:"foreign",monotonic_ns:String(s.e.now)}:point(0n);
    s.e.context.clock.point=()=>{s.e.reads++;return s.e.clockFailure;};}
  s.feed(s.line("RELEASED",s.release()));const after=s.e.view();assert.equal(after.admission.clock_invalid,true);assert.equal(after.admission.first_stop_ns,null);
  assert.equal(after.admission.active.late_count,1);assert.equal(after.admission.active.late_capture,"ended");
  assert.throws(()=>s.supplied("resource",{resource:"observer",action:"attach"}),/time_unavailable/);assert.equal(s.shutdown().decision,"CLOSE_ONLY");
});
for(const started of [false,true])test("B4-B6 a later supplied producer point relays the original deadline first, started="+started,async()=>{
  const s=await connected(),op=s.plan("CANCEL");if(started)s.start(op);s.e.now=BigInt(op.deadline_ns)+499n;
  s.receipt("stop_summary",{reason:"write_deadline",details:[]});const after=s.e.view();assert.equal(after.admission.first_stop_ns,op.deadline_ns);
  assert.equal(after.admission.clock_invalid,false);assert.equal(after.admission.active.window.starts.settlement,op.deadline_ns);
  s.feed(trace(s,0));if(started)s.complete(op);s.compare();
});
for(const input of ["partial_eof","failed_batch","terminal_release","terminal_failure"])test("B4-B6 decoder/EOF keeps single-owner capture at "+input,async()=>{
  const s=await connected();s.plan("CANCEL");s.stop();const shutdown=s.shutdown(),before=s.compare();
  if(input==="partial_eof"){const raw=s.line("RELEASED",s.release());s.bytes(Buffer.from(raw.slice(0,-1)));s.eof();}
  else if(input==="failed_batch")s.bytes(Buffer.concat([Buffer.from(s.line("RELEASED",s.release())),Buffer.from([255,10])]));
  else{s.feed(input==="terminal_release"?s.line("RELEASED",s.release()):s.line("FAILED",{...failure(),phase:"go"}));s.eof();}
  const terminal=input.startsWith("terminal"),after=s.compare();assert.equal(after.late_capture.capture,terminal?"ended":"refused");
  assert.equal(after.frames,before.frames+(terminal?1:0));const count=s.e.writes.length;
  if(terminal){s.start(shutdown);s.complete(shutdown);}else{assert.ok(s.start(shutdown).error);assert.equal(s.e.writes.length,count);}
});
test("B4-B6 one decoder batch crosses normal and late routing without duplicate admission",async()=>{
  const s=await connected(),op=s.plan("CANCEL"),initial=BigInt(op.deadline_ns)-2000000n,late=BigInt(op.deadline_ns)+1n;
  const first=trace(s,0),frames=s.e.view().admission.active.frames;s.reference.receive({line:first,at:point(initial)});
  const second=s.line("RELEASED",s.release());s.reference.receive({line:second,at:point(late)});
  s.e.context.clock.point=()=>{s.e.reads++;s.e.now=s.coordinator.describe().active.frames>frames?late:initial;return point(s.e.now);};
  s.e.c.pipes.status.emit("data",Buffer.from(first+second));const after=s.compare();
  assert.equal(after.frames,frames+2);assert.equal(after.trace_events,1);assert.equal(after.late_frames.length,1);
  assert.equal(s.e.view().admission.first_stop_ns,op.deadline_ns);assert.equal(s.e.decoders,1);
});
test("B4-B6 normal rejection is not retried as late and drops the rest of its batch",async()=>{
  const s=await connected(),first=trace(s,0),last=s.line("RELEASED",s.release(),s.reference.describe().next_ordinals.worker+1);
  s.bytes(Buffer.from(first+"{}\n"+last));const after=s.compare();assert.equal(after.trace_events,1);assert.equal(after.late_frames.length,0);
  assert.equal(s.e.view().terminal.facts.discarded_input.frames,1);assert.equal(after.late_capture.capture,"frozen");
});
test("B4-B6 FD4 refuses a parent-direction command before spending its ordinal",async()=>{
  const s=await connected(),before=s.compare(),raw=data.canonical({binding:before.binding,direction:"parent",ordinal:before.next_ordinals.parent,kind:"CANCEL",payload:{}})+"\n";
  s.feed(raw);const after=s.compare();assert.equal(after.frames,before.frames);assert.equal(after.next_ordinals.parent,before.next_ordinals.parent);
});
for(const event of ["exit","close"])test("B4-B6 child "+event+" facts alone cannot retire the original B2 slot",async()=>{
  const e=await activeSession(),owner=e.c.owner,decoder=e.c.decoder;e.c.child.emit(event,1,null);const after=e.view();
  assert.equal(after.admission.active.slots.worker,"live");assert.equal(after.admission.active.evidence.evidence_saved,false);
  assert.equal(e.c.owner,owner);assert.equal(e.c.decoder,decoder);assert.equal(e.s.children.has(e.c.child),true);
  assert.deepEqual(plain(after.terminal.facts.child[event]),{exit_code:1,signal:null});
});
test("B4-B6 unknown timer clear retains its original slots and prevents replacement",async()=>{
  const e=await activeSession();e.proof("CANCEL");e.api.planOriginalParentCommand(e.ref,"CANCEL");const phase=e.c.phaseTimer,operation=e.c.operationTimer,count=e.timers.length;
  e.clearThrows=true;e.api.failOriginalParentEvent(e.c,"primary");assert.equal(e.c.phaseTimer,phase);assert.equal(e.c.operationTimer,operation);
  assert.equal(e.view().terminal.facts.timers.operation.clear_unknown,true);assert.throws(()=>e.api.selectOriginalParentPhase(e.ref));
  assert.equal(e.timers.length,count);assert.equal(e.writes.length,3);assert.equal(e.models,1);
});
for(const [kind,reason]of [["LAUNCH","qualified_worker_closure_unavailable"],["PREPARE","original_sealed_setup_unavailable"],
  ["GO","original_go_readback_proofs_unavailable"],["CANCEL","original_cancellation_decision_unavailable"],["FINALIZE","original_teardown_proofs_unavailable"]])
test("B4-B6 real producer gate remains unavailable for "+kind,async()=>{
  const e=await writeSession({omit:"prepareOriginalParentCommand"});assert.throws(()=>e.api.planOriginalParentCommand(e.ref,kind),new RegExp(reason));
  assert.equal(e.writes.length,0);assert.equal(e.view().admission.active.frames,0);
});
test("B4-B6 real stop-time authority is not issued by model completion",async()=>{
  const e=await writeSession({omit:"prepareOriginalParentCommand"});e.api.failOriginalParentEvent(e.c,"primary");
  assert.throws(()=>e.api.planOriginalParentShutdown(e.ref),/original_shutdown_authority_unavailable/);assert.equal(e.writes.length,0);
  assert.equal(e.c.shutdownConsidered,false);assert.equal(e.view().admission.active.frames,0);
});
test("B4-B6 single-owner composition stays inside original capacity with unknown work qualification",async()=>{
  const s=await connected(),e=s.e,capacity=parent.describeUnsignedParentConnectionCapacity({work_plan:null});
  assert.equal(e.c.owner.capacity,54767);assert.equal(capacity.sidecar_ceiling_bytes,7654);assert.equal(capacity.retained_buffer_bytes,2375680);
  assert.equal(capacity.transient_buffer_bytes,4259840);assert.equal(capacity.runtime_work_qualified,false);
  assert.deepEqual(capacity.blockers,["runtime_work_plan_unavailable"]);assert.ok(Buffer.byteLength(data.canonical(e.view()))<=e.c.owner.capacity);
  const before=e.reads;assert.throws(()=>runtime.executeUnsignedCohortAssembly(),/execution_not_approved/);assert.equal(e.reads,before);
});
for(const completed of [false,true])test("B4-B6 known C1 evidence survives late failure, callback completed="+completed,async()=>{
  const s=await connected(),op=s.plan("CANCEL"),released={...s.release(),requests_dispatched:2};s.feed(s.line("RELEASED",released));
  s.start(op);if(completed)s.complete(op);s.receipt("run_outcome",{primary_code:released.primary_code,requests_dispatched:2,authenticated_requests:0,
    diagnostic_sha256:h,observation_sha256:null,observation_bytes:0,trace_sha256:released.trace_sha256,trace_events:0});
  s.stop();const before=s.e.view();assert.equal(before.admission.active.evidence.c1_violation,true);s.feed(s.line("FAILED",failure()));
  if(!completed)s.complete(op);const after=s.e.view();assert.deepEqual(after.admission.active.evidence,before.admission.active.evidence);
  assert.equal(after.admission.first_stop_ns,before.admission.first_stop_ns);assert.equal(s.shutdown().decision,"CLOSE_ONLY");
});
for(const order of ["callback_first","timer_first"])test("B4-B6 original timer/callback order at the deadline: "+order,async()=>{
  const s=await connected(),op=s.plan("CANCEL");s.start(op);const timer=s.e.c.operationTimer.handle;s.e.now=BigInt(op.deadline_ns);
  if(order==="timer_first")timer.callback();s.complete(op);const reads=s.e.reads;timer.callback();assert.equal(s.e.reads,reads);
  const after=s.e.view();assert.equal(after.admission.first_stop_ns,op.deadline_ns);assert.equal(after.admission.clock_invalid,false);
  assert.equal(after.terminal.facts.commands.at(-1).decision,"uncertain");assert.equal(after.terminal.facts.commands.at(-1).callback_at,null);
});
test("B4-B6 copied and foreign tokens cannot write through the one original connection",async()=>{
  const s=await connected(),other=await connected(),op=s.plan("CANCEL"),foreign=other.plan("CANCEL"),reads=s.e.reads,count=s.e.writes.length;
  assert.throws(()=>s.e.api.writeOriginalParentCommand(s.e.ref,{...op.token}));assert.throws(()=>s.e.api.writeOriginalParentCommand(s.e.ref,foreign.token));
  assert.throws(()=>s.e.api.planOriginalParentCommand({...s.e.ref},"CANCEL"));assert.equal(s.e.reads,reads);assert.equal(s.e.writes.length,count);s.compare();
});
test("B4-B6 retired child handlers and original callbacks cannot affect another generation",async()=>{
  const s=await connected(),op=s.plan("CANCEL");s.start(op);const e=s.e,before=plain(e.c.facts),reads=e.reads;e.c.owner.generation++;
  op.callback();e.c.pipes.status.emit("data",Buffer.from(s.line("RELEASED",s.release())));e.c.child.emit("exit",0,null);
  assert.equal(e.reads,reads);assert.deepEqual(plain(e.c.facts),before);assert.equal(e.c.owner.coordinator,s.coordinator);
});
function prepareMutation(original,from,to){
  const text=original.replace(/\r\n/g,"\n");assert.ok(from.length>0&&text.split(from).length===2,"mutation anchor must be unique");
  const changed=text.replace(from,to);assert.notEqual(changed,text,"mutation identity");
  assert.equal(ts.createSourceFile("mutation.mjs",changed,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0,"mutation syntax");
  return Object.freeze({source:changed,mutate:()=>changed});
}
const mutationScenarios={
  startup:async options=>{(await connected(options)).compare();},
  deadline:async options=>{const s=await connected(options),op=s.plan("CANCEL");s.e.now=BigInt(op.deadline_ns)+1n;s.feed(s.line("RELEASED",s.release()));},
  drain:async options=>{const s=await connected(options),op=s.plan("CANCEL");s.feed(s.line("RELEASED",s.release()));s.start(op);s.complete(op);},
  completion:async options=>{const s=await connected(options),op=s.plan("CANCEL");s.feed(s.line("RELEASED",s.release()));s.start(op);s.complete(op);assertSuppliedCleanupGate(s);},
  callback:async options=>{const s=await connected(options),op=s.plan("CANCEL");s.start(op);s.e.now=BigInt(op.deadline_ns)+1n;
    s.e.onClear=()=>{s.e.onClear=null;s.e.now++;op.callback();};s.complete(op);},
  retirement:async options=>{const s=await connected(options),op=s.plan("CANCEL");s.start(op);let retiredReads;s.e.s.stopped="invented_stop";
    s.e.onClear=()=>{s.e.onClear=null;s.e.c.owner.generation++;retiredReads=s.e.reads;};op.callback();
    assert.notEqual(retiredReads,undefined);assert.equal(s.e.reads,retiredReads);assert.equal(s.e.c.facts.commands.at(-1).callback_seen,false);},
  budget:async options=>{const s=await connected(options);s.e.s.hashBytes=2147483648n;s.e.proof("CANCEL");
    assert.throws(()=>s.e.api.planOriginalParentCommand(s.e.ref,"CANCEL"),/hash_work/);assert.equal(s.e.writes.length,3);},
  reference:async options=>{const s=await connected(options),op=s.plan("CANCEL");s.e.c.operationTimer.handle.referenced=false;
    assert.throws(()=>s.e.api.writeOriginalParentCommand(s.e.ref,op.token));assert.equal(s.e.writes.length,3);},
};
for(const [name,scenario,from,to]of [
  ["second B2 owner","startup",'const coordinator = createUnsignedCohortAssemblyModel({ request, clock: timing.binding });',
    'const coordinator = createUnsignedCohortAssemblyModel({ request, clock: timing.binding }); createUnsignedCohortAssemblyModel({ request, clock: timing.binding });'],
  ["second decoder","startup",'c.decoder = createUnsignedProtocolDecoder();','c.decoder = createUnsignedProtocolDecoder(); createUnsignedProtocolDecoder();'],
  ["duplicate normal admission","startup",'o.coordinator.applyModelEvent(c.caseRef, { kind: "worker_frame", payload: { line: lines[index] }, at });',
    'o.coordinator.applyModelEvent(c.caseRef, { kind: "worker_frame", payload: { line: lines[index] }, at }); o.coordinator.applyModelEvent(c.caseRef, { kind: "worker_frame", payload: { line: lines[index] }, at });'],
  ["ignored pending deadline","deadline",'pending: command ? { reservation: command.reservation, started: command.started } : null','pending: null'],
  ["renewed write reservation","drain",'const at = checkOriginalParentSupervision(ref); qualifyOriginalParentPipe(c, write.child, write.pipe);',
    'const at = checkOriginalParentSupervision(ref); r.reservation = { ...r.reservation, deadline_ns: String(BigInt(r.reservation.deadline_ns) + 1000000n) }; qualifyOriginalParentPipe(c, write.child, write.pipe);'],
  ["unclaimed callback","callback",'write.callbackClaimed = true;',''],
  ["retired completion sample","retirement",'const d = syncOriginalParent(c); if (!currentOriginalParentHandler(c, c.child) || d.clock_invalid) return null;',
    'const d = syncOriginalParent(c); if (d.clock_invalid) return null;'],
  ["unaccounted wire hash","budget",'chargeHash(c.owner.s, Buffer.byteLength(line));','void 0;'],
  ["unreferenced operation timer","reference",'if (!referenced) { stopOriginalParentSupervision(c, "timer_unreferenced", at); return null; }','if (false) { stopOriginalParentSupervision(c, "timer_unreferenced", at); return null; }'],
  ["missing released-CANCEL callback","completion",'const r = write.record;',
    'const r = write.record; if (r.kind === "CANCEL" && !r.shutdown && c.owner.coordinator.describe().active.protocol_state === "RELEASED") return;'],
  ["missing released-CANCEL B2 completion","completion",'function relayOriginalParentWrite(c, record, outcome, at) {',
    'function relayOriginalParentWrite(c, record, outcome, at) { if (record.kind === "CANCEL" && outcome === "completed" && !record.shutdown && c.owner.coordinator.describe().active.protocol_state === "RELEASED") return;'],
])test("B4-B6 controlled behavioral mutation is detected: "+name,async()=>{
  await mutationScenarios[scenario]({});
  const prepared=prepareMutation(source,from,to);
  const expectedFailure={"duplicate normal admission":"cc4b2_receipt_after_stop","renewed write reservation":"cc4b3b_parent_write_binding",
    "missing released-CANCEL B2 completion":"cc4b2_cancel_unsettled"}[name];
  await assert.rejects(()=>mutationScenarios[scenario]({mutate:prepared.mutate}),error=>
    error?.code==="ERR_ASSERTION"||typeof expectedFailure==="string"&&error?.message===expectedFailure);
});
test("B4-B6 invalid mutation setup fails before a behavioral rejection is evaluated",()=>{
  assert.throws(()=>prepareMutation("const n=1;","missing","changed"),/mutation anchor/);
  assert.throws(()=>prepareMutation("const n=1;const m=1;","=1","=2"),/mutation anchor/);
  assert.throws(()=>prepareMutation("const n=1;","=1","=1"),/mutation identity/);
  assert.throws(()=>prepareMutation("const n=1;","=1","="),/mutation syntax/);
  const prepared=prepareMutation("const n=1;","=1","=2");assert.equal(prepared.source,"const n=2;");assert.equal(prepared.mutate(),prepared.source);
});
test("B4-B6 isolated parser exposes no Node system or real clock, regardless of module cache",()=>{
  assert.equal("sys" in ts,false);assert.equal(ts.isolation.system_available,false);assert.equal(ts.isolation.clock_source,"synthetic_zero");
  assert.deepEqual(Array.from(ts.isolation.node_globals),Array(6).fill("undefined"));
  assert.deepEqual(Array.from(ts.isolation.clock_globals),["undefined","undefined"]);
  const other=createUnsignedIsolatedTypeScript(compilerSource);assert.notEqual(other,ts);assert.equal("sys" in other,false);
  assert.equal(other.createSourceFile("x.mjs","const n=1;",other.ScriptTarget.Latest,true,other.ScriptKind.JS).parseDiagnostics.length,0);
});
test("B4-B6 no denied effect was swallowed",()=>assert.deepEqual(effects,[]));
