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

import vm from "node:vm";
import ts from "typescript";
import { EventEmitter } from "node:events";
import { posix } from "node:path";
const runtime = await import("../helpers/unsignedCohortRuntime.mjs");
const data = await import("../helpers/unsignedControllerData.mjs");
const parent = await import("../helpers/unsignedParentConnectionContracts.mjs");
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
    namespaceReferences: new WeakMap([[namespaceRef,{owner:s,buildRef}]]), parentOwners: new WeakMap(), parentSessions: new WeakMap(), parentHelperPlans:new WeakMap(),
    path:posix,root:"/invented",crypto:{createHash:crypto.createHash},
    limits:{helper_commands:131072,hash_work_bytes:"2147483648",pass_bytes:"268435456",acl_bytes:65536,tool_capture_bytes:1048576},
    code(error){return /^cc4b3[bc]_[a-z_]+$/.test(error.message)?error.message:"cc4b3b_operation_failed";},
    checkpoint(state){if(state.stopped)throw Error(state.stopped);context.clock.point();},
    stop(state,error){state.stopped??=error.message;state.phase="STOPPED";return error;},
    armOriginalQualificationTimer(){e.qualificationUses++;throw Error("builder_timer_forbidden");},
    memoryHelperPlan(){if(!e.planRef)throw Error("cc4b3b_original_helper_plan_unavailable");return e.planRef;},
    memoryChildImport(){e.imports++;return e.importWait??Promise.resolve({spawn(program,args,options){
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
      child.stdout.pause=child.stderr.pause=()=>{};e.spawned.push({child,program,args,options});e.onSpawn?.(child);return child;
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
  } : {};
  if (omit) delete replacements[omit];
  Object.assign(context, { request, allocation });

  e.timers = []; e.clears = []; e.armThrows = false; e.clearThrows = false; e.imports=0;e.spawned=[];e.qualificationUses=0;
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
test("B4-B3 phase supervision uses only its original phase and referenced invented handle", () => {
  const e = session(), before = e.view();
  assert.equal(typeof e.api.selectOriginalParentPhase, "function");
  e.api.selectOriginalParentPhase(e.ref);
  const after = e.view();
  assert.equal(e.timers.length,1); assert.equal(after.terminal.facts.timers.phase.owner,"phase");
  assert.equal(after.terminal.facts.timers.phase.deadline_ns,before.admission.active.window.phase_deadline_ns);
  assert.equal(after.terminal.facts.timers.phase.referenced,true); assert.equal(after.terminal.facts.timers.operation,null);
  assert.equal(after.admission.stopped,false);
});
test("B4-B3 exact deadline stops at its original instant before clear and stale callbacks are inert", () => {
  const e = session(); e.api.selectOriginalParentPhase(e.ref); const deadline=e.view().terminal.facts.timers.phase.deadline_ns;
  e.onClear=()=>assert.equal(e.c.owner.coordinator.describe().stopped,true); e.now=BigInt(deadline); e.fire(0);
  const view=e.view(); assert.equal(view.admission.first_stop_ns,deadline); assert.equal(view.admission.clock_invalid,false);
  assert.equal(view.terminal.facts.timers.phase.active,false); assert.equal(e.clears.length,1);
  const reads=e.reads; e.fire(0); assert.equal(e.reads,reads);
});
test("B4-B3 early firing rearms only the remaining original interval under one generation", () => {
  const e=session(); e.api.selectOriginalParentPhase(e.ref); const first=e.view().terminal.facts.timers.phase;
  e.now+=100000000n; e.fire(0); const next=e.view().terminal.facts.timers.phase;
  assert.equal(e.timers.length,2); assert.equal(next.deadline_ns,first.deadline_ns); assert.equal(next.generation,first.generation);
  assert.equal(next.segment,2); assert.ok(e.timers[1].delay<e.timers[0].delay); const reads=e.reads; e.fire(0); assert.equal(e.reads,reads);
});
test("B4-B3 an early clear failure retains the inactive original slot and installs no replacement", () => {
  const e=session(); e.api.selectOriginalParentPhase(e.ref); e.clearThrows=true; e.now+=1n; e.fire(0);
  const view=e.view(); assert.equal(view.admission.stopped,true); assert.equal(view.terminal.facts.timers.phase.clear_unknown,true);
  assert.equal(view.terminal.facts.timers.phase.active,false); assert.ok(e.c.phaseTimer); assert.equal(e.timers.length,1);
  const clears=e.clears.length; assert.throws(()=>e.api.selectOriginalParentPhase(e.ref)); assert.equal(e.clears.length,clears);
});
for(const loss of ["false","throw"]) test("B4-B3 lost reference is a non-deadline stop: "+loss,()=>{
  const e=session(); e.api.selectOriginalParentPhase(e.ref); if(loss==="false")e.timers[0].referenced=false;else e.refThrows=true;
  assert.throws(()=>e.api.checkOriginalParentSupervision(e.ref)); assert.equal(e.view().admission.stop_reason,"timer_unreferenced");
});
test("B4-B3 a delayed timer creation return detects the original deadline without dispatch",()=>{
  const e=session(), deadline=e.view().admission.active.window.phase_deadline_ns;
  e.onArm=()=>{e.now=BigInt(deadline)+500n;}; assert.throws(()=>e.api.selectOriginalParentPhase(e.ref));
  assert.equal(e.view().admission.first_stop_ns,deadline); assert.equal(e.timers.length,1); assert.equal(e.clears.length,1);
});
test("B4-B3 synchronous fake firing cannot create recursive timer replacements",()=>{
  const e=session(); e.onArm=h=>h.callback(); assert.throws(()=>e.api.selectOriginalParentPhase(e.ref));
  assert.equal(e.timers.length,1); assert.equal(e.view().admission.stopped,true);
});
test("B4-B3 unknown timer creation is retained and cannot be retried",()=>{
  const e=session(); e.armThrows=true; assert.throws(()=>e.api.selectOriginalParentPhase(e.ref));
  assert.ok(e.c.phaseTimer); assert.equal(e.view().terminal.facts.timers.phase.clear_unknown,true);
  assert.throws(()=>e.api.selectOriginalParentPhase(e.ref)); assert.equal(e.timers.length,0);
});
test("B4-B3 low-level timer binding cannot substitute an enlarged phase deadline",()=>{
  const e=session(), w=e.view().admission.active.window;
  assert.throws(()=>e.api.armOriginalParentTimer(e.c,"phase","phase",String(BigInt(w.phase_deadline_ns)+1n),null,w.phase+":"+w.phase_deadline_ns),/binding/);
  assert.equal(e.timers.length,0);
});
test("B4-B3 known settlement supervision preserves its one original grace and clock faults latch",()=>{
  const e=session(); e.api.selectOriginalParentPhase(e.ref); e.now=BigInt(e.view().admission.active.window.phase_deadline_ns); e.fire(0);
  const before=e.view().admission, deadline=before.active.window.phase_deadline_ns;
  e.api.selectOriginalParentPhase(e.ref); assert.equal(e.view().terminal.facts.timers.phase.deadline_ns,deadline);
  e.clockFailure={clock_invalid:true,failure:"invented",stop_ns:null}; assert.throws(()=>e.api.checkOriginalParentSupervision(e.ref));
  assert.equal(e.view().admission.clock_invalid,true); const reads=e.reads;
  assert.throws(()=>e.api.selectOriginalParentPhase(e.ref)); assert.equal(e.reads,reads); assert.equal(e.view().admission.first_stop_ns,before.first_stop_ns);
});
test("B4-B3 phase helper uses the original global slot/counters and known child close",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.plan();const r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  assert.equal(e.spawned.length,1);assert.equal(e.s.commands,1);assert.ok(e.s.hashBytes>65536n);assert.equal(e.qualificationUses,0);
  assert.equal(e.view().terminal.facts.helper.active,true);assert.equal(e.timers.length,2);
  assert.throws(()=>e.api.qualifyOriginalParentDispatch(e.ref),/busy/);
  e.spawned[0].child.stdout.emit("data",Buffer.from("invented\n"));e.spawned[0].child.emit("close",0,null);await flush();
  assert.equal(r.state,"resolved");assert.equal(r.value.toString(),"invented\n");assert.equal(e.s.helper,null);
  assert.equal(e.view().terminal.facts.helper.active,false);assert.equal(e.c.operationTimer,null);assert.equal(e.c.phaseTimer.active,true);
});
function pending(e, started=false) {
  const w=e.view().admission.active.window;
  const reservation=parent.planUnsignedParentReservation({clock_domain:"parent-clock",planned_ns:String(e.now),phase_deadline_ns:w.phase_deadline_ns,
    cohort_deadline_ns:e.view().admission.cohort_deadline_ns}).reservation;
  const command={kind:"LAUNCH",ordinal:1,generation:1,reservation,sha256:h,bytes:100,started,write_return_seen:false,backpressure:null,
    callback_seen:false,observed_outcome:null,callback_at:null,observation_point:null,decision:started?"started":"planned",shutdown:false};
  e.c.facts.commands=[command];e.c.facts.pending_generation=1;return command;
}
test("B4-B3 a pre-write helper borrows the original command operation timer without renewal",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);const command=pending(e);e.api.armOriginalParentOperation(e.ref);e.plan();
  const before=e.view().terminal.facts.timers.operation,r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  assert.equal(e.timers.length,2);assert.equal(e.view().terminal.facts.helper.under_command_generation,1);
  const child=e.spawned[0].child;child.emit("close",0,null);await flush();assert.equal(r.state,"resolved");
  const after=e.view().terminal.facts.timers.operation;assert.equal(after.active,true);assert.equal(after.generation,before.generation);
  assert.equal(after.deadline_ns,command.reservation.deadline_ns);assert.equal(after.deadline_ns,before.deadline_ns);
  assert.equal(e.view().terminal.facts.helper.active,false);
});
test("B4-B3 a started original command cannot overlap any helper or spend its plan",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);pending(e,true);const plan=e.plan();
  const r=track(e.api.runOriginalParentHelper(e.ref));await flush();assert.equal(r.state,"rejected");assert.match(r.error.message,/overlap/);
  assert.equal(plan.consumed,false);assert.equal(e.imports,0);assert.equal(e.spawned.length,0);assert.equal(e.timers.length,1);
});
test("B4-B3 case helper reservation excludes a concurrent helper and the builder path before await",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.plan();let release;
  e.importWait=new Promise(resolve=>{release=resolve;});const r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  const count=e.s.commands,budget=e.s.hashBytes;
  const second=track(e.api.runOriginalParentHelper(e.ref));await flush();assert.equal(second.state,"rejected");
  const builder=track(e.api.runOriginalTool(e.s,"/bin/ls",["-lde","/invented/pin"],"metadata"));await flush();assert.equal(builder.state,"rejected");
  assert.equal(e.s.commands,count);assert.equal(e.s.hashBytes,budget);assert.equal(e.imports,1);
  e.now=BigInt(e.view().terminal.facts.timers.operation.deadline_ns);e.fire(1);
  release({spawn(){throw Error("must_not_spawn");}});await flush();assert.equal(r.state,"rejected");assert.equal(e.spawned.length,0);
  assert.equal(e.view().admission.stop_reason,"helper_deadline");assert.equal(e.s.helper,null);assert.equal(e.s.commands,count);assert.equal(e.s.hashBytes,budget);
});
test("B4-B3 helper deadline retains the original child until its known close and late close reads no clock",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.plan();const r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  const child=e.spawned[0].child,deadline=e.view().terminal.facts.timers.operation.deadline_ns;
  e.now=BigInt(deadline)+500n;e.fire(1);await flush();assert.equal(r.state,"rejected");
  assert.equal(e.view().admission.first_stop_ns,deadline);assert.equal(e.s.helper,child);assert.equal(e.view().terminal.facts.helper.active,true);
  const reads=e.reads;child.emit("exit",0,null);assert.equal(e.s.helper,child);child.emit("close",0,null);await flush();
  assert.equal(e.reads,reads);assert.equal(e.s.helper,null);assert.equal(e.view().terminal.facts.helper.active,false);
  assert.equal(e.s.helperDisposition.late,true);
});
test("B4-B3 delayed synchronous helper spawn return stops before a next action and retains the child",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.plan();
  e.onSpawn=()=>{e.now=BigInt(e.c.helperLease.deadline)+1n;};const r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  assert.equal(r.state,"rejected");assert.equal(e.spawned.length,1);assert.equal(e.s.helper,e.spawned[0].child);
  assert.equal(e.view().admission.stop_reason,"helper_deadline");
  e.spawned[0].child.emit("close",0,null);await flush();assert.equal(e.s.helper,null);
});
test("B4-B3 missing and foreign helper plans remain unavailable without import or timer dispatch",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);let r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  assert.equal(r.state,"rejected");assert.match(r.error.message,/unavailable/);assert.equal(e.imports,0);
  const plan=e.plan();plan.owner={};r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  assert.equal(r.state,"rejected");assert.equal(e.imports,0);assert.equal(e.s.commands,0);assert.equal(e.timers.length,1);
});
for(const cap of ["hash","command"])test("B4-B3 existing shared work cap refuses before helper dispatch: "+cap,async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.plan();if(cap==="hash")e.s.hashBytes=2147483648n;else e.s.commands=131072;
  const r=track(e.api.runOriginalParentHelper(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.spawned.length,0);
  assert.equal(e.view().admission.stopped,true);assert.equal(e.s.helper,null);
});
test("B4-B3 case metadata output uses the existing ACL bound without a larger capture reservation",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.plan();const r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  e.spawned[0].child.stdout.emit("data",Buffer.alloc(65537));await flush();assert.equal(r.state,"rejected");
  assert.equal(e.view().admission.stopped,true);assert.equal(e.s.helper,e.spawned[0].child);
  e.spawned[0].child.emit("close",0,null);await flush();assert.equal(e.s.helper,null);
});
function phaseView(e,phase,deadline) {
  const original=e.c.owner.coordinator;
  e.c.owner.coordinator={...original,describe(){const d=original.describe();return {...d,active:{...d.active,window:{...d.active.window,phase,
    phase_deadline_ns:String(deadline),starts:{...d.active.window.starts,[phase]:String(e.now)}}}};}};
}
test("B4-B3 repeated phase selection cannot renew a timer and stale phase callbacks are inert",()=>{
  const e=session();const first=e.api.selectOriginalParentPhase(e.ref),old=e.timers[0];
  assert.equal(e.api.selectOriginalParentPhase(e.ref),first);assert.equal(e.timers.length,1);
  phaseView(e,"query",700000000000n);e.api.selectOriginalParentPhase(e.ref);
  assert.equal(e.timers.length,2);assert.equal(e.view().terminal.facts.timers.phase.generation,2);
  const reads=e.reads;old.callback();assert.equal(e.reads,reads);
});
test("B4-B3 a supplied normal release phase during pre-write qualification keeps the original command timer",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);const command=pending(e);e.api.armOriginalParentOperation(e.ref);e.plan();
  const r=track(e.api.runOriginalParentHelper(e.ref));await flush();phaseView(e,"settlement",60000000001n);e.api.selectOriginalParentPhase(e.ref);
  const view=e.view();assert.equal(view.terminal.facts.timers.operation.deadline_ns,command.reservation.deadline_ns);
  assert.equal(view.terminal.facts.timers.operation.generation,1);assert.equal(e.timers.length,3);
  e.spawned[0].child.emit("close",0,null);await flush();assert.equal(r.state,"resolved");assert.equal(e.view().admission.stopped,false);
  assert.equal(e.api.qualifyOriginalParentDispatch(e.ref).clock_domain,"parent-clock");
});
test("B4-B3 a phase-owned helper cannot carry its qualification into a different supplied phase",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.plan();const r=track(e.api.runOriginalParentHelper(e.ref));await flush();
  phaseView(e,"query",700000000000n);assert.throws(()=>e.api.selectOriginalParentPhase(e.ref));await flush();
  assert.equal(r.state,"rejected");assert.equal(e.view().admission.stop_reason,"helper_phase_changed");
  assert.equal(e.s.helper,e.spawned[0].child);e.spawned[0].child.emit("close",0,null);await flush();assert.equal(e.s.helper,null);
});
test("B4-B3 unknown clear after helper close retains timer slots without a false successful helper result",async()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.plan();const r=track(e.api.runOriginalParentHelper(e.ref));await flush();e.clearThrows=true;
  e.spawned[0].child.emit("close",0,null);await flush();assert.equal(r.state,"rejected");assert.equal(e.s.helper,null);
  assert.equal(e.view().terminal.facts.timers.operation.clear_unknown,true);assert.equal(e.view().terminal.facts.helper.active,false);
  const timers=e.timers.length,clears=e.clears.length;assert.throws(()=>e.api.selectOriginalParentPhase(e.ref));
  assert.equal(e.timers.length,timers);assert.equal(e.clears.length,clears);
});
test("B4-B3 builder timer occupancy and generation overflow stop before a new case timer",()=>{
  for(const mutate of [e=>{e.s.qualificationTimer={};},e=>{e.c.phaseGeneration=Number.MAX_SAFE_INTEGER;}]) {
    const e=session();mutate(e);assert.throws(()=>e.api.selectOriginalParentPhase(e.ref));assert.equal(e.timers.length,0);assert.equal(e.view().admission.stopped,true);
  }
});
test("B4-B3 a late hasRef return cannot qualify work beyond the original phase deadline",()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);const deadline=e.view().terminal.facts.timers.phase.deadline_ns;
  e.onRef=()=>{e.now=BigInt(deadline)+1n;};assert.throws(()=>e.api.checkOriginalParentSupervision(e.ref));
  assert.equal(e.view().admission.first_stop_ns,deadline);assert.equal(e.view().admission.clock_invalid,false);
});
test("B4-B3 late early-clear failure preserves the original deadline and never rearms",()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);const deadline=e.view().terminal.facts.timers.phase.deadline_ns;
  e.onClear=()=>{e.now=BigInt(deadline)+1n;};e.clearThrows=true;e.now+=1n;e.fire(0);
  assert.equal(e.view().admission.first_stop_ns,deadline);assert.equal(e.view().terminal.facts.timers.phase.clear_unknown,true);
  assert.equal(e.timers.length,1);const clears=e.clears.length;e.fire(0);assert.equal(e.clears.length,clears);
});
test("B4-B3 settlement expiry cannot renew its deadline or change its first stop",()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.now=BigInt(e.view().admission.active.window.phase_deadline_ns);e.fire(0);
  const first=e.view().admission.first_stop_ns;e.api.selectOriginalParentPhase(e.ref);const deadline=e.view().terminal.facts.timers.phase.deadline_ns;
  e.now=BigInt(deadline);e.fire(1);const count=e.timers.length;
  assert.throws(()=>e.api.selectOriginalParentPhase(e.ref));assert.equal(e.timers.length,count);
  assert.equal(e.view().admission.first_stop_ns,first);assert.equal(e.view().terminal.facts.timers.phase.active,false);
});
test("B4-B3 encoded helper capture and concat fit the unchanged conservative retained envelope",()=>{
  const capacity=parent.describeUnsignedParentConnectionCapacity({}),frame=data.LIMITS.frame_bytes;
  const oldLines=data.LIMITS.frames*frame,actualLines=5*frame,helperPeak=2*65536;
  assert.equal(capacity.retained_buffer_bytes,2375680);assert.equal(capacity.transient_buffer_bytes,4259840);
  assert.ok(actualLines+helperPeak<=oldLines);
  assert.ok(capacity.retained_buffer_bytes-oldLines+actualLines+helperPeak<=2375680);
  assert.equal(capacity.coordinator_ceiling_bytes+26,54767);
});
test("B4-B3 a known cohort-end clock refusal after stop is not a clock fault",()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.now=BigInt(e.view().admission.active.window.phase_deadline_ns);e.fire(0);
  const first=e.view().admission.first_stop_ns;e.api.selectOriginalParentPhase(e.ref);
  e.clockFailure={clock_invalid:false,failure:"cc4b3c_entry_deadline",stop_ns:e.context.clock.end_ns};
  e.now=BigInt(e.context.clock.end_ns);assert.throws(()=>e.api.checkOriginalParentSupervision(e.ref));
  assert.equal(e.view().admission.clock_invalid,false);assert.equal(e.view().admission.first_stop_ns,first);
  assert.equal(e.view().terminal.facts.timers.phase.active,false);
});
test("B4-B3 known early clear followed by expiry leaves no unknown timer slot",()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);const deadline=e.view().terminal.facts.timers.phase.deadline_ns;
  e.onClear=()=>{e.now=BigInt(deadline)+1n;};e.now+=1n;e.fire(0);
  assert.equal(e.view().admission.first_stop_ns,deadline);assert.equal(e.view().terminal.facts.timers.phase.clear_unknown,false);
  assert.equal(e.c.phaseTimer,null);assert.equal(e.clears.length,1);assert.equal(e.timers.length,1);
});
test("B4-B3 reentrant early callback cannot install an untracked replacement timer",()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);const old=e.timers[0];e.now+=1n;
  e.onClear=()=>{e.onClear=null;old.callback();};old.callback();
  assert.equal(e.view().admission.stopped,false);assert.equal(e.timers.length,2);assert.equal(e.clears.length,1);
  assert.equal(e.c.phaseTimer.handle,e.timers[1]);const reads=e.reads;old.callback();assert.equal(e.reads,reads);
});
for(const failure of [false,true])test("B4-B3 readiness reentry during early clear stops without a second clear: "+failure,()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.now+=1n;e.clearThrows=failure;
  e.onClear=()=>{e.onClear=null;assert.throws(()=>e.api.checkOriginalParentSupervision(e.ref));};e.fire(0);
  assert.equal(e.view().admission.stopped,true);assert.equal(e.clears.length,1);assert.equal(e.timers.length,1);
  assert.equal(e.view().terminal.facts.timers.phase.active,false);assert.equal(e.view().terminal.facts.timers.phase.clear_unknown,failure);
  if(failure)assert.equal(e.c.phaseTimer.handle,e.timers[0]);else assert.equal(e.c.phaseTimer,null);
});
test("B4-B3 failed rearm is unknown even after the preceding segment was known cleared",()=>{
  const e=session();e.api.selectOriginalParentPhase(e.ref);e.now+=1n;e.onClear=()=>{e.armThrows=true;};e.fire(0);
  assert.equal(e.view().admission.stopped,true);assert.equal(e.clears.length,1);assert.equal(e.timers.length,1);
  assert.equal(e.view().terminal.facts.timers.phase.clear_unknown,true);assert.ok(e.c.phaseTimer);
});
test("B4-B3 installed effect tripwires fail both calls and constructors",()=>{
  for(const [o,k] of blocked)for(const construct of [false,true]) {
    const before=effects.length;
    assert.throws(()=>construct?new o[k]():o[k](),/forbidden/);
    assert.equal(effects.length,before+1,k);effects.pop();
  }
});
test("B4-B3 no denied effect was swallowed", () => assert.deepEqual(effects, []));
