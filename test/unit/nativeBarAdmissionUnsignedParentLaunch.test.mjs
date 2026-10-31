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
    namespaceReferences: new WeakMap([[namespaceRef,{owner:s,buildRef}]]), parentOwners: new WeakMap(), parentSessions: new WeakMap(), parentHelperPlans:new WeakMap(),parentLaunchPlans:new WeakMap(),
    path:posix,root:"/invented",crypto:{createHash:crypto.createHash},
    limits:{helper_commands:131072,hash_work_bytes:"2147483648",pass_bytes:"268435456",acl_bytes:65536,tool_capture_bytes:1048576},
    code(error){return /^cc4b3[bc]_[a-z_]+$/.test(error.message)?error.message:"cc4b3b_operation_failed";},
    checkpoint(state){if(state.stopped)throw Error(state.stopped);context.clock.point();},
    stop(state,error){state.stopped??=error.message;state.phase="STOPPED";return error;},
    armOriginalQualificationTimer(){e.qualificationUses++;throw Error("builder_timer_forbidden");},
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
test("B4-B4 fixed launch captures the original child and four pipes without sending a command",async()=>{
  const e=launchSession();assert.equal(typeof e.api.launchOriginalParent,"function");
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"resolved");
  const {child,program,args,options}=e.spawned[0];
  assert.equal(program,"/invented/node");assert.deepEqual(plain(args),["/invented/native/native_bar_fs/test_unsigned_cohort_worker.mjs"]);
  assert.deepEqual(plain(options.stdio),["ignore","pipe","pipe","pipe","pipe"]);assert.equal(options.shell,false);assert.equal(options.detached,true);
  assert.equal(e.c.child,child);assert.equal(e.c.pipes.command,child.stdio[3]);assert.equal(e.c.pipes.status,child.stdio[4]);
  assert.equal(e.refCalls,1);assert.equal(e.view().admission.active.frames,0);
  assert.deepEqual(plain(e.view().terminal.facts.launch),{reserved:true,attempted:true,returned:true});
});
test("B4-B4 partial stdio lookup preserves and supervises the already returned pipe",async()=>{
  const e=launchSession();let stdout;
  e.onSpawn=child=>{stdout=child.stdout;Object.defineProperty(child,"stderr",{get(){throw Error("partial_stdio");}});};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");
  assert.equal(e.c.pipes.stdout,stdout);assert.equal(stdout.listenerCount("error"),1);
  assert.doesNotThrow(()=>stdout.emit("error",Error("late")));assert.equal(e.s.children.has(e.c.child),true);
  assert.equal(e.view().terminal.facts.launch.attempted,true);assert.equal(e.view().terminal.facts.launch.returned,true);
});
test("B4-B4 a changed allocation mode cannot override the original admission binding",async()=>{
  const e=launchSession();e.c.allocation.fixture.mode="ubsan";const r=track(e.api.launchOriginalParent(e.ref));await flush();
  assert.equal(r.state,"rejected");assert.equal(e.spawned.length,0);
});
test("B4-B4 fixed environment and referenced supervision precede launch",async()=>{
  const e=launchSession();e.s.environment={PATH:"/usr/bin:/bin:/usr/sbin:/sbin",LANG:"C",LC_ALL:"C",TZ:"Asia/Tokyo",XCRUN_CACHE_DISABLED:"1"};
  e.onSpawn=()=>{assert.equal(e.c.phaseTimer.active,true);assert.equal(e.view().terminal.facts.launch.attempted,true);};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"resolved");
  const env=e.spawned[0].options.env;assert.equal(env.NATIVE_BAR_B3CC_MODE,"normal");
  assert.equal(env.UBSAN_OPTIONS,"halt_on_error=1:abort_on_error=0:exitcode=86:print_stacktrace=0");
  assert.equal(env.LANG,"C");assert.equal(e.timers.length,1);assert.equal(e.s.commands,0);
});
test("B4-B4 the missing original plan blocks before import and consumes no spawn attempt",async()=>{
  const e=launchSession();e.launchPlanRef=null;const r=track(e.api.launchOriginalParent(e.ref));await flush();
  assert.equal(r.state,"rejected");assert.match(r.error.message,/unavailable/);assert.equal(e.imports,0);
  assert.equal(e.spawned.length,0);assert.equal(e.view().terminal.facts.launch.attempted,false);
});
for(const variant of ["owner","build","namespace","allocation","node_copy","old_worker","worker_hash","build_hash","consumed"])test("B4-B4 rejects substituted launch qualification: "+variant,async()=>{
  const e=launchSession(),p=e.launchPlan;
  if(variant==="owner")p.owner={};if(variant==="build")p.buildRef={};if(variant==="namespace")p.namespaceRef={};if(variant==="allocation")p.allocation=plain(e.c.allocation);
  if(variant==="node_copy")p.node={...p.node};if(variant==="old_worker")p.worker.path="/invented/native/native_bar_fs/test_unsigned_worker.mjs";
  if(variant==="worker_hash")p.worker.sha256="b".repeat(64);if(variant==="build_hash")e.s.recordHash="b".repeat(64);if(variant==="consumed")p.consumed=true;
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.imports,0);assert.equal(e.spawned.length,0);
});
test("B4-B4 launch reservation excludes concurrent and subsequent launches",async()=>{
  const e=launchSession();let release;e.importWait=new Promise(resolve=>{release=resolve;});
  const r=track(e.api.launchOriginalParent(e.ref));await flush();const second=track(e.api.launchOriginalParent(e.ref));await flush();
  assert.equal(second.state,"rejected");assert.equal(e.imports,1);assert.equal(e.spawned.length,0);
  release({spawn(){throw Error("invented_spawn_unknown");}});await flush();assert.equal(r.state,"rejected");
  assert.equal(e.view().terminal.facts.launch.attempted,true);assert.equal(e.view().terminal.facts.launch.returned,false);
  const third=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(third.state,"rejected");assert.equal(e.imports,1);
});
test("B4-B4 import continuation rechecks the original phase before spawn",async()=>{
  const e=launchSession();let release;e.importWait=new Promise(resolve=>{release=resolve;});const r=track(e.api.launchOriginalParent(e.ref));await flush();
  const deadline=e.view().terminal.facts.timers.phase.deadline_ns;e.now=BigInt(deadline);e.fire(0);
  release({spawn(){throw Error("must_not_spawn");}});await flush();assert.equal(r.state,"rejected");
  assert.equal(e.view().admission.first_stop_ns,deadline);assert.equal(e.view().terminal.facts.launch.attempted,false);
});
test("B4-B4 a late spawn return retains all terminal handlers before refusing progress",async()=>{
  const e=launchSession();e.onSpawn=()=>{e.now=BigInt(e.view().terminal.facts.timers.phase.deadline_ns)+1n;};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.c.handlersBound,true);assert.equal(e.refCalls,0);
  const child=e.c.child,reads=e.reads;child.emit("error",Error("late"));child.emit("exit",1,null);child.emit("close",1,null);
  for(const stream of Object.values(e.c.pipes))stream.emit("close");assert.equal(e.reads,reads);
  assert.equal(e.view().terminal.facts.child.close.exit_code,1);assert.equal(e.s.children.has(child),true);
});
for(const variant of ["missing","alias","listener_throw","ref_throw"])test("B4-B4 partial binding/ref failure keeps original resources: "+variant,async()=>{
  const e=launchSession();
  e.onSpawn=child=>{if(variant==="missing")child.stdio[4]=null;if(variant==="alias")child.stdio[4]=child.stdio[3];if(variant==="ref_throw")child.ref=()=>{throw Error("invented_ref");};};
  if(variant==="listener_throw")e.onListen=(name,event)=>{if(name==="stdout"&&event==="data")throw Error("invented_listener");};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.view().admission.stopped,true);
  assert.equal(e.s.children.has(e.c.child),true);assert.throws(()=>e.api.bindOriginalParentChild(e.ref),/once/);
  for(const stream of e.c.returnedStreams)assert.doesNotThrow(()=>stream.emit("error",Error("retained")));
});
test("B4-B4 synchronous data during listener attachment still leaves all terminal listeners",async()=>{
  const e=launchSession();e.onListen=(name,event,stream,listener)=>{if(name==="stdout"&&event==="data")listener(Buffer.from("unexpected"));};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.c.handlersBound,true);
  assert.equal(e.view().admission.stopped,true);for(const stream of e.c.returnedStreams)assert.equal(stream.listenerCount("error"),1);
});
for(const slot of ["stdout","stderr","command"])test("B4-B4 unexpected data stops and keeps bounded observations: "+slot,async()=>{
  const e=launchSession();const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"resolved");
  const stream=e.c.pipes[slot];stream.emit("data",Buffer.alloc(0));assert.equal(e.view().admission.stopped,false);
  stream.emit("data",Buffer.alloc(9000,65));assert.equal(e.view().admission.stopped,true);const reads=e.reads;
  const row=slot==="command"?e.c.reverse:e.c.output[slot],prefix=row.prefix;
  if(slot!=="command")assert.equal(prefix.length,8192);assert.equal(row.bytes,9000);assert.equal(row.incomplete,slot!=="command");
  for(let i=0;i<5;i++)stream.emit("data",Buffer.alloc(65536,66));
  assert.equal(e.reads,reads);assert.equal(row.prefix,prefix);if(slot==="command")assert.equal(row.bytes,65537);
});
test("B4-B4 invalid output never reads hostile byte properties",async()=>{
  const e=launchSession();track(e.api.launchOriginalParent(e.ref));await flush();let reads=0;
  e.c.pipes.stdout.emit("data",{get byteLength(){reads++;throw Error("hostile");}});
  assert.equal(reads,0);assert.equal(e.view().admission.stopped,true);assert.equal(e.c.output.stdout.prefix,null);
});
test("B4-B4 status uses the original decoder and EOF retains incomplete bytes",async()=>{
  const e=launchSession();track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(e.decoders,1);assert.equal(e.models,1);
  e.c.pipes.status.emit("data",Buffer.from("abc"));assert.equal(e.c.decoder.describe().pending_bytes,3);
  e.c.pipes.status.emit("end");const v=e.view();assert.equal(v.admission.stopped,true);assert.equal(v.terminal.facts.pipes.status.end_seen,true);
  assert.equal(v.terminal.facts.discarded_input.bytes,3);assert.equal(v.terminal.facts.discarded_input.saturated,true);
});
test("B4-B4 old generation and replaced-pipe events are inert",async()=>{
  const e=launchSession();track(e.api.launchOriginalParent(e.ref));await flush();const child=e.c.child,old=e.c.pipes.stdout;
  e.c.pipes.stdout=new EventEmitter();const reads=e.reads;old.emit("data",Buffer.from("ignored"));old.emit("error",Error("ignored"));
  assert.equal(e.reads,reads);assert.equal(e.view().admission.stopped,false);
  e.c.owner.generation++;child.emit("close",0,null);child.emit("error",Error("ignored"));assert.equal(e.reads,reads);assert.equal(e.c.facts.child.close,null);
});
test("B4-B4 exit is not close or slot retirement and duplicate terminal facts stay fixed",async()=>{
  const e=launchSession();track(e.api.launchOriginalParent(e.ref));await flush();const child=e.c.child;
  child.emit("exit",86,null);const first=plain(e.view().terminal.facts);assert.equal(first.child.close,null);assert.equal(e.s.children.has(child),true);
  const reads=e.reads;child.emit("exit",0,null);child.emit("close",86,null);child.emit("close",0,null);
  assert.equal(e.reads,reads);assert.equal(e.view().terminal.facts.child.exit.exit_code,86);assert.equal(e.view().terminal.facts.child.close.exit_code,86);
  assert.equal(e.s.children.has(child),true);assert.equal(e.c.owner.active,e.c);
});
test("B4-B4 invalid terminal payload stays unavailable rather than claiming clean exit",async()=>{
  const e=launchSession();track(e.api.launchOriginalParent(e.ref));await flush();e.c.child.emit("close",-2,null);
  assert.deepEqual(plain(e.view().terminal.facts.child.close),{exit_code:null,signal:null});assert.equal(e.view().admission.stopped,true);
  assert.ok(e.view().terminal.facts.secondary_errors.includes("worker_terminal_unknown"));
});
test("B4-B4 a retired import continuation cannot stop or sample another generation",async()=>{
  const e=launchSession();let release;e.importWait=new Promise(resolve=>{release=resolve;});const r=track(e.api.launchOriginalParent(e.ref));await flush();
  e.c.owner.generation++;const reads=e.reads;release({spawn(){throw Error("must_not_spawn");}});await flush();
  assert.equal(r.state,"rejected");assert.equal(e.reads,reads);assert.equal(e.c.owner.coordinator.describe().stopped,false);assert.equal(e.s.stopped,null);
});
test("B4-B4 a late child-reference return detects the original deadline",async()=>{
  const e=launchSession();e.onChildRef=()=>{e.now=BigInt(e.view().terminal.facts.timers.phase.deadline_ns)+1n;};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.refCalls,1);
  assert.equal(e.c.handlersBound,true);assert.equal(e.s.children.has(e.c.child),true);assert.equal(e.view().admission.clock_invalid,false);
});
test("B4-B4 continuation rechecks the original row references after import",async()=>{
  const e=launchSession();let release;e.importWait=new Promise(resolve=>{release=resolve;});const r=track(e.api.launchOriginalParent(e.ref));await flush();
  e.s.inputs.rows=e.s.inputs.rows.map(row=>({...row}));release({spawn(){throw Error("must_not_spawn");}});await flush();
  assert.equal(r.state,"rejected");assert.equal(e.view().terminal.facts.launch.attempted,false);
});
test("B4-B4 aliased stdout property retains both returned objects without enabling intake",async()=>{
  const e=launchSession();let extra;e.onSpawn=child=>{extra=new EventEmitter();child.stdout=extra;};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.c.returnedStreams.length,5);
  assert.doesNotThrow(()=>extra.emit("error",Error("extra")));assert.doesNotThrow(()=>e.c.child.stdio[1].emit("error",Error("original")));
  assert.equal(e.c.bindingsValid,false);
});
test("B4-B4 effect tripwires reject calls and constructors",()=>{
  for(const [o,k]of blocked)for(const construct of [false,true]){const before=effects.length;
    assert.throws(()=>construct?new o[k]():o[k](),/forbidden/);assert.equal(effects.length,before+1,k);effects.pop();}
});
test("B4-B4 row qualification rereads its source after a synchronous reference check",async()=>{
  const e=launchSession();e.onChildRef=()=>{e.onRef=()=>{e.onRef=null;e.s.inputs.rows=e.s.inputs.rows.map(row=>({...row}));};};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");
  assert.equal(e.view().admission.stopped,true);assert.equal(e.s.children.has(e.c.child),true);
});
for(const [exitCode,signal,expected]of [[86,"bad",{exit_code:86,signal:null}],[-2,"SIGTERM",{exit_code:null,signal:"SIGTERM"}]])
  test("B4-B4 terminal projection preserves each independently known field: "+exitCode+"/"+signal,async()=>{
    const e=launchSession();track(e.api.launchOriginalParent(e.ref));await flush();e.c.child.emit("close",exitCode,signal);
    assert.deepEqual(plain(e.view().terminal.facts.child.close),expected);assert.equal(e.view().admission.stopped,true);
    assert.ok(e.view().terminal.facts.secondary_errors.includes("worker_terminal_unknown"));
  });
test("B4-B4 a foreign-generation spawn return still binds the original resources inertly",async()=>{
  const e=launchSession();let reads;e.onSpawn=()=>{e.c.owner.generation++;reads=e.reads;};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.reads,reads);
  assert.equal(e.c.returnedStreams.length,4);assert.equal(e.c.child.listenerCount("error"),1);
  assert.doesNotThrow(()=>e.c.child.emit("error",Error("retired")));
  for(const stream of e.c.returnedStreams){assert.equal(stream.listenerCount("error"),1);assert.doesNotThrow(()=>stream.emit("error",Error("retired")));}
  assert.equal(e.s.stopped,null);assert.equal(e.c.owner.coordinator.describe().stopped,false);assert.equal(e.s.children.has(e.c.child),true);
});
test("B4-B4 each stdio alias is captured once and validated without a second getter",async()=>{
  const e=launchSession();let reads=0,first;e.onSpawn=child=>{first=child.stdout;const other=new EventEmitter();
    Object.defineProperty(child.stdio,1,{get(){reads++;return reads===1?first:other;}});};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(reads,1);assert.equal(r.state,"resolved");
  assert.equal(e.c.pipes.stdout,first);assert.equal(first.listenerCount("error"),1);
});
test("B4-B4 every stream terminal listener precedes the first data registration",async()=>{
  const e=launchSession();e.onListen=(name,event)=>{if(name==="stdout"&&event==="data")e.c.pipes.stderr.emit("error",Error("reentrant_stderr"));};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");
  assert.equal(e.c.facts.pipes.stderr.error,"parent_terminal_error");assert.equal(e.view().admission.stopped,true);
});
test("B4-B4 a changed generation during post-import reference qualification prevents spawn",async()=>{
  const e=launchSession();let reads;e.onRef=()=>{if(e.imports>0){e.onRef=null;e.c.owner.generation++;reads=e.reads;}};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();assert.equal(r.state,"rejected");assert.equal(e.spawned.length,0);
  assert.equal(e.reads,reads);assert.equal(e.c.facts.launch.attempted,false);assert.equal(e.s.stopped,null);
});
for(const variant of ["output","listener_failure"])test("B4-B4 failure checkpoint retirement cannot stop the replacement generation: "+variant,async()=>{
  const e=launchSession();let reads;
  const retire=()=>{e.onRef=()=>{e.onRef=null;e.c.owner.generation++;reads=e.reads;};};
  if(variant==="listener_failure")e.onListen=(name,event)=>{if(name==="stdout"&&event==="data"){retire();throw Error("listener_failure");}};
  const r=track(e.api.launchOriginalParent(e.ref));await flush();
  if(variant==="output"){assert.equal(r.state,"resolved");retire();e.c.pipes.stdout.emit("data",Buffer.from("unexpected"));}
  else assert.equal(r.state,"rejected");
  assert.equal(e.reads,reads);assert.equal(e.c.owner.coordinator.describe().stopped,false);assert.equal(e.s.stopped,null);
  assert.equal(e.s.children.has(e.c.child),true);
});
test("B4-B4 no denied effect was swallowed",()=>assert.deepEqual(effects,[]));
