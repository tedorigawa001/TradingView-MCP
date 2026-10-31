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
const runtime = await import("../helpers/unsignedCohortRuntime.mjs");
const data = await import("../helpers/unsignedControllerData.mjs");
const parent = await import("../helpers/unsignedParentConnectionContracts.mjs");
const { createUnsignedCohortAssemblyModel } = await import("../helpers/unsignedCohortAssemblyModel.mjs");
const { createUnsignedProtocolDecoder } = await import("../helpers/unsignedAdapterSupport.mjs");
const source = fs.readFileSync(new URL("../helpers/unsignedCohortRuntime.mjs", import.meta.url), "utf8");
const tree = ts.createSourceFile("runtime.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const root = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "prepareOriginalQualification");
const declarations = root.body.statements.filter(n => ts.isFunctionDeclaration(n) && /[Oo]riginalParent/.test(n.name.text));
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
  const s = { phase: "NAMESPACE_BOUND", stopped: null, evidenceTainted: false, recordClosed: true, recordIdentity: {},
    qualificationTimer: null, helper: null, children: new Set() }, buildRef = {}, namespaceRef = {};
  const context = { ...data, ...parent, Buffer, retainedQualificationScopes: new Set([s]), buildReferences: new WeakMap([[buildRef,s]]),
    namespaceReferences: new WeakMap([[namespaceRef,{owner:s,buildRef}]]), parentOwners: new WeakMap(), parentSessions: new WeakMap(),
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
  } : {};
  if (omit) delete replacements[omit];
  Object.assign(context, { request, allocation });
  const api = vm.compileFunction('"use strict";\n' + declarations.map(n=>replacements[n.name.text] ?? n.getText()).join("\n")
    + "\nreturn {" + declarations.map(n=>n.name.text).join(",") + "};", Object.keys(context))(...Object.values(context));
  Object.assign(e,{s,buildRef,namespaceRef,context,api});
  e.owner = () => api.createOriginalParentOwner(s,buildRef,namespaceRef);
  e.session = () => { const owner = e.ownerRef ??= e.owner(); return api.reserveOriginalParentSession(owner); };
  return e;
}
test("B4-B2 public runtime remains sealed without reading a supplied backend", () => {
  assert.throws(()=>runtime.executeUnsignedCohortAssembly(new Proxy({}, {get(){throw Error("caller");}})), /execution_not_approved/);
  assert.deepEqual(Object.keys(runtime).sort(), ["executeUnsignedCohortAssembly","inspectUnsignedCohortAssembly"]);
});
test("B4-B2 original qualification references precede missing invocation producers", () => {
  const e = memory();
  assert.equal(typeof e.api.createOriginalParentOwner, "function");
  assert.throws(()=>e.api.createOriginalParentOwner(e.s,{},e.namespaceRef), /parent_scope/); assert.equal(e.reads,0);
  assert.throws(e.owner,/parent_invocation_unavailable/); assert.equal(e.models,0);
  assert.throws(e.owner,/parent_owner_once/); assert.equal(e.models,0);
});
test("B4-B2 one original owner creates the sole coordinator and one retained session", () => {
  const e = memory({producers:true}), owner = e.owner(); e.ownerRef = owner;
  const ref = e.session(), c = e.context.parentSessions.get(ref);
  assert.equal(e.models,1); assert.equal(e.decoders,1); assert.equal(c.owner.coordinator.describe().active.protocol_state,"NEW");
  assert.equal(c.facts.launch.reserved,true); assert.equal(c.facts.launch.attempted,false);
  assert.throws(e.session,/parent_session_once/); assert.equal(e.models,1); assert.equal(e.decoders,1);
  assert.throws(()=>e.api.currentOriginalParentSession({...ref}),/parent_session_reference/);
  assert.throws(()=>e.api.currentOriginalParentSession(memory({producers:true}).session()),/parent_session_reference/);
});
for (const omit of ["originalParentAllocation","originalParentCaseReceipt","originalParentWorkerQualification"])
  test("B4-B2 a missing case producer consumes the sole reservation without beginning or decoding: "+omit, () => {
    const e = memory({producers:true,omit}); e.ownerRef = e.owner(); const reads = e.reads;
    assert.throws(e.session,/unavailable/); assert.equal(e.decoders,0); assert.equal(e.reads,reads);
    assert.equal(e.context.parentOwners.get(e.ownerRef).coordinator.describe().active,null);
    assert.throws(e.session,/parent_session_once/); assert.equal(e.decoders,0);
  });
for (const change of [s=>{s.stopped="prior";},s=>{s.evidenceTainted=true;},s=>{s.phase="BUILD_BOUND";},s=>{s.recordClosed=false;},
  s=>{s.recordIdentity=null;},s=>{s.qualificationTimer={};},s=>{s.helper={};},s=>{s.children.add({});}])
  test("B4-B2 stale qualification state is refused before a clock, model or producer", () => {
    const e = memory({producers:true}); change(e.s); assert.throws(e.owner,/parent_scope/);
    assert.equal(e.reads,0); assert.equal(e.models,0); assert.equal(e.decoders,0);
  });
test("B4-B2 the diagnostic wrapper is charged inside the unchanged coordinator limit", () => {
  const e = memory({producers:true}), ownerRef = e.owner(), owner = e.context.parentOwners.get(ownerRef);
  const base = parent.describeUnsignedParentConnectionCapacity({}), wrapper = Buffer.byteLength(data.canonical({admission:null,terminal:null}))-8;
  assert.equal(owner.capacity,base.coordinator_ceiling_bytes+wrapper); assert.ok(owner.capacity<=65536);
  assert.equal(base.sidecar_ceiling_bytes,7654); assert.equal(base.retained_buffer_bytes,2375680); assert.equal(base.transient_buffer_bytes,4259840);
});
function live({completeLaunch = true, launch = true} = {}) {
  const e = memory({producers:true}), ref = e.session(), c = e.context.parentSessions.get(ref), model = c.owner.coordinator;
  e.ref = ref; e.c = c; e.model = model; c.pipes.status = {}; c.facts.pipes.status.present = true;
  e.event = (kind,payload) => { const at = point(++e.now); c.owner.lastNs = at.monotonic_ns; return model.applyModelEvent(c.caseRef,{kind,payload,at}); };
  const stamp = point(++e.now);
  const receipt = model.applyModelEvent(c.caseRef,{kind:"receipt",payload:{kind:"case_allocated",payload:{},stamp:{...stamp,
    wall_utc:"2026-10-31T00:00:00.000Z",wall_jst:"2026-10-31T09:00:00.000+09:00"}},at:stamp});
  e.event("receipt_readback",{line:receipt.line}); e.event("resource",{resource:"worker",action:"attach"});
  const binding = model.describe().active.binding;
  e.launchLine = data.canonical({binding,direction:"parent",ordinal:1,kind:"LAUNCH",payload:{}})+"\n";
  e.launchAt = point(e.now+1n);
  if (launch) {
    e.event("frame",{line:e.launchLine});
    e.event("write",{ordinal:1,outcome:"started"}); if (completeLaunch) e.event("write",{ordinal:1,outcome:"completed"});
  }
  e.line = (kind,payload) => data.canonical({binding:model.describe().active.binding,direction:"worker",
    ordinal:model.describe().active.next_ordinals.worker,kind,payload})+"\n";
  e.ready = () => e.line("READY",{addon_protocol:6,mode:"synthetic_only",worker_clock_domain:"worker-clock",pins_sha256:data.digest(binding)});
  e.receive = line => { e.now++; return e.api.receiveOriginalParent(e.ref,c.pipes.status,Buffer.from(line)); };
  return e;
}
test("B4-B2 READY bytes use the original decoder and the sole B2 admission ledger once", () => {
  const e = live(), before = e.model.describe(), view = e.receive(e.ready());
  assert.equal(view.admission.active.protocol_state,"READY"); assert.equal(view.admission.active.frames,before.active.frames+1);
  assert.equal(view.admission.active.late_count,0); assert.equal(e.models,1); assert.equal(e.decoders,1);
  assert.equal(view.terminal.execution_available,false); assert.equal(view.terminal.semantic_verified,false);
  assert.equal(Object.isFrozen(view.admission),true); assert.equal("caseRef" in view,false);
});
test("B4-B2 FD4 never admits a parent command into the sole B2 ledger", () => {
  const e = live({launch:false}), before = e.model.describe(), view = e.receive(e.launchLine);
  assert.equal(view.admission.stopped,true); assert.equal(view.admission.clock_invalid,false);
  assert.equal(view.admission.active.late_capture,"frozen"); assert.equal(view.admission.active.frames,before.active.frames);
  assert.deepEqual(view.admission.active.next_ordinals,before.active.next_ordinals); assert.equal(view.admission.active.late_count,0);
  assert.equal(view.admission.stop_reason,"receive_direction");
});
test("B4-B2 stopped receive records only late diagnostics without another clock sample", () => {
  const e = live(); e.model.stop({reason:"primary",at:point(++e.now)}); const reads = e.reads;
  const view = e.receive(e.ready()); assert.equal(e.reads,reads); assert.equal(view.admission.active.late_count,1);
  assert.equal(view.admission.active.protocol_state,"STOPPED"); assert.equal(view.admission.active.worker_clock_domain,null);
  assert.equal(view.admission.stop_reason,"primary");
});
test("B4-B2 an original qualification stop blocks normal admission without reading a clock or inventing grace", () => {
  const e = live(), reads = e.reads; e.s.stopped = "cc4b3b_operation_failed"; e.s.phase = "STOPPED";
  const view = e.receive(e.ready()); assert.equal(view.admission.stopped,true); assert.equal(view.admission.clock_invalid,false);
  assert.equal(view.admission.first_stop_ns,null); assert.equal(view.terminal.facts.first_stop.at,null);
  assert.equal(view.admission.active.protocol_state,"STOPPED"); assert.equal(view.admission.active.late_count,1);
  assert.equal(view.admission.active.window.starts.settlement,undefined); assert.equal(e.reads,reads);
  e.api.recordOriginalParentTerminal(e.ref,e.c.pipes.status,"status","close"); assert.equal(e.reads,reads);
});
test("B4-B2 a failing decoder batch never replays its favorable complete prefix", () => {
  const e = live(), before = e.model.describe().active.frames;
  const view = e.api.receiveOriginalParent(e.ref,e.c.pipes.status,Buffer.concat([Buffer.from(e.ready()),Buffer.from([255,10])]));
  assert.equal(view.admission.active.frames,before); assert.equal(view.admission.stopped,true); assert.equal(view.admission.active.late_capture,"refused");
});
test("B4-B2 clock failure before READY uses the untimed original stop and late route", () => {
  const e = live(); e.clockFailure = {clock_invalid:true,failure:"invented_read",stop_ns:null};
  const view = e.receive(e.ready()); assert.equal(view.admission.clock_invalid,true); assert.equal(view.admission.first_stop_ns,null);
  assert.equal(view.admission.active.late_count,1); assert.equal(view.terminal.facts.first_stop.at,null);
  const reads = e.reads; e.receive("x"); assert.equal(e.reads,reads);
});
test("B4-B2 copied status, retired generation and foreign sessions are inert before chunk access", () => {
  const e = live(), before = e.model.describe(), reads = e.reads;
  const hostile = new Proxy({}, {get(){throw Error("chunk_read");}});
  assert.throws(()=>e.api.receiveOriginalParent(e.ref,{},hostile),/parent_status_reference/);
  e.c.owner.generation++; assert.throws(()=>e.api.receiveOriginalParent(e.ref,e.c.pipes.status,hostile),/parent_session_reference/);
  assert.deepEqual(e.model.describe(),before); assert.equal(e.reads,reads);
});
test("B4-B2 terminal facts keep original exit separate from close, without releasing B2", () => {
  const e = live(), childRef = {}; e.c.child = childRef;
  e.model.stop({reason:"primary",at:point(++e.now)}); const reads = e.reads;
  const view = e.api.recordOriginalParentTerminal(e.ref,childRef,"child","exit",{exit_code:0,signal:null});
  assert.deepEqual(view.terminal.facts.child.exit,{exit_code:0,signal:null}); assert.equal(view.terminal.facts.child.close,null);
  assert.equal(view.admission.active.slots.worker,"live"); assert.equal(view.admission.stop_reason,"primary"); assert.equal(e.reads,reads);
  e.api.recordOriginalParentTerminal(e.ref,childRef,"child","exit",{exit_code:1,signal:null});
  assert.equal(e.c.facts.child.exit.exit_code,0); assert.equal(e.reads,reads);
  assert.throws(()=>e.api.recordOriginalParentTerminal(e.ref,{},"child","close",{exit_code:0,signal:null}),/parent_terminal_reference/);
});
test("B4-B2 partial EOF refuses capture but EOF after a terminal late frame preserves ended", () => {
  const e = live(); e.receive(e.ready().slice(0,-1));
  assert.equal(e.api.endOriginalParent(e.ref,e.c.pipes.status).admission.active.late_capture,"refused");
});
for (const state of ["FINALIZING","DONE"]) for (const partial of [false,true])
  test(`B4-B2 normal terminal EOF state=${state}, partial=${partial}`, () => {
    const e = live(); if (partial) e.receive("x");
    // This fixture isolates EOF routing with a supplied terminal view, not a full lifecycle proof.
    const original = e.model;
    e.c.owner.coordinator = {...original,describe() {const d=original.describe();return {...d,active:{...d.active,protocol_state:state}};}};
    const view = e.api.recordOriginalParentTerminal(e.ref,e.c.pipes.status,"status","end");
    assert.equal(original.describe().stopped,partial); assert.equal(view.terminal.facts.pipes.status.end_seen,true);
    if (partial) assert.equal(view.admission.active.late_capture,"refused");
    else { assert.equal(view.admission.stop_reason,null); assert.equal(view.terminal.facts.first_stop,null); }
    const decoder = e.c.decoder.describe();
    e.api.recordOriginalParentTerminal(e.ref,e.c.pipes.status,"status","close");
    assert.deepEqual(e.c.decoder.describe(),decoder);
  });
const failure = () => ({phase:"launch",primary_code:"invented_failure",close_errors:[],diagnostic_sha256:null,
  resources:null,query_created:false,instrumentation_overflow:false});
test("B4-B2 EOF preserves ended but further original bytes refuse without restarting the decoder", () => {
  const e = live(); e.model.stop({reason:"primary",at:point(++e.now)});
  assert.equal(e.receive(e.line("FAILED",failure())).admission.active.late_capture,"ended");
  const reads = e.reads, decoded = e.c.decoder.describe();
  assert.equal(e.api.endOriginalParent(e.ref,e.c.pipes.status).admission.active.late_capture,"ended");
  assert.equal(e.receive("{}\n").admission.active.late_capture,"refused");
  assert.deepEqual(e.c.decoder.describe(),decoded); assert.equal(e.reads,reads);
});
for (const suffix of ["x", "{}\n", "{}\nx"]) test("B4-B2 terminal suffix refusal is independent of chunk boundaries: "+JSON.stringify(suffix), () => {
  const e = live(); e.model.stop({reason:"primary",at:point(++e.now)}); const reads = e.reads;
  const view = e.receive(e.line("FAILED",failure())+suffix);
  assert.equal(view.admission.active.late_capture,"refused"); assert.equal(view.admission.active.late_count,1);
  assert.equal(view.admission.stop_reason,"primary"); assert.equal(e.reads,reads);
  if (suffix.endsWith("x")) {
    assert.equal(view.terminal.facts.discarded_input.saturated,true); assert.ok(view.terminal.facts.discarded_input.bytes>=1);
  }
  const decoder = e.c.decoder.describe();
  assert.equal(e.api.endOriginalParent(e.ref,e.c.pipes.status).admission.active.late_capture,"refused");
  assert.deepEqual(e.c.decoder.describe(),decoder);
});
test("B4-B2 the existing sub-ms phase rule stops at the observation before late admission", () => {
  const e = live(), end = BigInt(e.model.describe().active.window.phase_deadline_ns);
  e.now = end-900001n;
  const view = e.receive(e.ready()); assert.equal(view.admission.first_stop_ns,String(e.now));
  assert.equal(view.admission.active.late_count,1); assert.equal(view.admission.clock_invalid,false);
  assert.equal(view.admission.active.window.starts.settlement,String(e.now));
});
test("B4-B2 an original pending deadline is relayed at D before a producer observation at D+500", () => {
  const e = live({completeLaunch:false}), active = e.model.describe().active;
  const reservation = parent.planUnsignedParentReservation({clock_domain:"parent-clock",planned_ns:e.launchAt.monotonic_ns,
    phase_deadline_ns:active.window.phase_deadline_ns,cohort_deadline_ns:e.model.describe().cohort_deadline_ns}).reservation;
  e.c.facts.pending_generation = 1;
  e.c.facts.commands = [{kind:"LAUNCH",ordinal:1,generation:1,reservation,sha256:data.sha(e.launchLine),bytes:Buffer.byteLength(e.launchLine),
    started:true,write_return_seen:false,backpressure:null,callback_seen:false,observed_outcome:null,callback_at:null,
    observation_point:null,decision:"started",shutdown:false}];
  e.now = BigInt(reservation.deadline_ns)+499n;
  const view = e.receive(e.ready()); assert.equal(view.admission.first_stop_ns,reservation.deadline_ns);
  assert.equal(view.admission.active.window.starts.settlement,reservation.deadline_ns); assert.equal(view.admission.clock_invalid,false);
  assert.equal(view.terminal.facts.commands[0].decision,"uncertain"); assert.equal(view.terminal.facts.pending_generation,1);
  assert.equal(view.admission.active.late_count,1);
});
test("B4-B2 normal rejection freezes intake with no late fallback or following-frame replay", () => {
  const e = live(), good = e.ready(), before = e.model.describe().active.frames;
  const view = e.receive(good+"{}\n"+good);
  assert.equal(view.admission.active.frames,before+1); assert.equal(view.admission.active.late_count,0);
  assert.equal(view.admission.active.late_capture,"frozen"); assert.equal(view.terminal.facts.discarded_input.frames,1);
  const state = e.c.decoder.describe(), reads = e.reads;
  e.api.receiveOriginalParent(e.ref,e.c.pipes.status,new Proxy({}, {get(){throw Error("not_read");}}));
  assert.deepEqual(e.c.decoder.describe(),state); assert.equal(e.reads,reads);
});
for (const [at,reason] of [[{},"clock_malformed"],[{...point(100),clock_domain:"foreign"},"clock_domain"],[point(0),"clock_rollback"]])
  test("B4-B2 unqualified original point stops without a fabricated timestamp: "+reason, () => {
    const e = live(); e.context.clock.point = () => {e.reads++; return at;};
    const view = e.receive(e.ready()); assert.equal(view.admission.stop_reason,reason); assert.equal(view.admission.first_stop_ns,null);
    assert.equal(view.admission.active.late_count,1); assert.equal(view.admission.clock_invalid,true);
  });
test("B4-B2 the known entry end preserves the earlier phase trigger, not a clock fault", () => {
  const e = live(), end = e.model.describe().active.window.phase_deadline_ns;
  e.clockFailure = {clock_invalid:false,failure:"entry_deadline",stop_ns:e.context.clock.end_ns};
  const view = e.receive(e.ready()); assert.equal(view.admission.first_stop_ns,end); assert.equal(view.admission.clock_invalid,false);
});
test("B4-B2 terminal errors stay bounded and end/finish/close are independent original facts", () => {
  const e = live(), original = e.c.pipes.status;
  e.model.stop({reason:"primary",at:point(++e.now)});
  for (const event of ["end","finish","close","error"]) e.api.recordOriginalParentTerminal(e.ref,original,"status",event);
  const view = e.api.describeOriginalParent(e.ref);
  assert.equal(view.terminal.facts.pipes.status.end_seen,true); assert.equal(view.terminal.facts.pipes.status.finish_seen,true);
  assert.equal(view.terminal.facts.pipes.status.close_seen,true); assert.equal(view.admission.active.command_close,null);
  const before = data.canonical(view); for (let i=0;i<40;i++) e.api.recordOriginalParentTerminal(e.ref,original,"status","error");
  assert.equal(data.canonical(e.api.describeOriginalParent(e.ref)),before);
});
test("B4-B2 an original status error refuses open capture and never overwrites a primary stop", () => {
  const e = live();
  const view = e.api.recordOriginalParentTerminal(e.ref,e.c.pipes.status,"status","error");
  assert.equal(view.admission.stopped,true); assert.equal(view.admission.active.late_capture,"refused");
  assert.equal(view.terminal.facts.pipes.status.error,"parent_terminal_error");
});
test("B4-B2 an original status fault after terminal late input preserves ended without a clock", () => {
  const e = live(); e.model.stop({reason:"primary",at:point(++e.now)});
  e.receive(e.line("FAILED",failure())); const reads = e.reads;
  const view = e.api.recordOriginalParentTerminal(e.ref,e.c.pipes.status,"status","error");
  assert.equal(view.admission.active.late_capture,"ended"); assert.equal(view.admission.stop_reason,"primary"); assert.equal(e.reads,reads);
});
for (const kind of ["LAUNCH","PREPARE","GO","CANCEL","FINALIZE"])
  test("B4-B2 missing original command producers refuse before any dispatch: "+kind, () => {
    const e = live(), before = e.model.describe(), reads = e.reads;
    assert.throws(()=>e.api.prepareOriginalParentCommand(e.ref,kind,{approved:true}),/unavailable/);
    assert.equal(e.reads,reads); assert.deepEqual(e.model.describe(),before);
  });
for (const [name,reason] of [["originalParentInvocation","parent_invocation"],["originalParentAllocation","original_allocation"],
  ["originalParentCaseReceipt","original_case_receipt"],["originalParentWorkPlan","runtime_work_plan"],
  ["originalParentWorkerQualification","qualified_worker_closure"]])
  test("B4-B2 original producer refuser ignores supplied approval/data: "+name, () => {
    const e = memory(); assert.throws(()=>e.api[name]({approved:true,allocation:allocation()}),new RegExp(reason+"_unavailable"));
    assert.equal(e.reads,0); assert.equal(e.models,0); assert.equal(e.decoders,0);
  });
test("B4-B2 stopped CANCEL keeps the distinct unavailable shutdown producer", () => {
  const e = live(); e.model.stop({reason:"primary",at:point(++e.now)}); const reads = e.reads;
  assert.throws(()=>e.api.prepareOriginalParentCommand(e.ref,"CANCEL"),/original_shutdown_authority_unavailable/);
  assert.equal(e.reads,reads);
});
test("B4-B2 an internal checkpoint ordering fault cannot leave a healthy session", () => {
  const e = live(); e.c.owner.lastNs = e.model.describe().active.window.phase_deadline_ns;
  e.receive(e.ready()); assert.equal(e.model.describe().stopped,true); assert.equal(e.model.describe().clock_invalid,true);
});
test("B4-B2 original reference validation precedes terminal payload and slot coercion", () => {
  const e = live(), before = data.canonical(e.api.describeOriginalParent(e.ref));
  const hostile = new Proxy({}, {get(){throw Error("coercion");}});
  assert.throws(()=>e.api.recordOriginalParentTerminal(e.ref,{},hostile,"close",hostile),/parent_terminal_reference/);
  assert.equal(data.canonical(e.api.describeOriginalParent(e.ref)),before);
});
test("B4-B2 source-extracted receive rejects reentrant bytes and EOF before decoder work", () => {
  const e = live(), decoder = e.c.decoder.describe(); e.c.receiveBusy = true;
  assert.throws(()=>e.api.receiveOriginalParent(e.ref,e.c.pipes.status,Buffer.from(e.ready())),/parent_receive_reentrant/);
  assert.throws(()=>e.api.endOriginalParent(e.ref,e.c.pipes.status),/parent_receive_reentrant/);
  assert.deepEqual(e.c.decoder.describe(),decoder);
});
test("B4-B2 no denied effect was swallowed", () => assert.deepEqual(effects, []));
