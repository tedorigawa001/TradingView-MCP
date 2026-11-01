import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import child from "node:child_process";
import workers from "node:worker_threads";
import net from "node:net";
import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import tls from "node:tls";
import dns from "node:dns";
import timers from "node:timers";
import timerPromises from "node:timers/promises";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const effects = [], restores = [], blocked = [], listener = net.Server.prototype, connectionPrototype = net.Socket.prototype, datagram = dgram.Socket.prototype;
const replace = (o, k, f) => { const d = Object.getOwnPropertyDescriptor(o, k); Object.defineProperty(o, k, { value: f, configurable: true, writable: true });
  restores.push(() => d ? Object.defineProperty(o, k, d) : delete o[k]); };
const block = (o, keys) => keys.filter(k => typeof o[k] === "function").forEach(k => {
  blocked.push([o, k]); replace(o, k, function () { effects.push(k); throw Error("c2b_forbidden_effect"); });
});
let escapedLowLevelReads = 0;
replace(fs, "readSync", () => { escapedLowLevelReads++; throw Error("c2b_read_sentinel"); });
block(fs, ["read", "readSync", "readv", "readvSync", "createReadStream"]);
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]);
block(workers, ["Worker", "MessageChannel", "BroadcastChannel"]);
block(crypto, ["sign", "verify", "createSign", "createVerify", "createPrivateKey", "createPublicKey", "createSecretKey", "generateKey", "generateKeySync", "generateKeyPair", "generateKeyPairSync", "randomUUID", "randomBytes"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "deriveKey", "deriveBits", "encrypt", "decrypt", "wrapKey", "unwrapKey"]);
block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"]);
block(listener, ["listen"]); block(datagram, ["bind"]);
block(net, ["connect", "createConnection", "createServer", "Server", "Socket"]); block(connectionPrototype, ["connect"]);
block(dgram, ["createSocket", "Socket"]); block(tls, ["connect", "createServer"]);
for (const o of [http, https]) block(o, ["request", "get", "createServer"]);
block(http2, ["connect", "createServer", "createSecureServer"]);
for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter(k => /^(lookup|resolve|reverse)/.test(k)));
block(globalThis, ["fetch", "WebSocket", "EventSource", "MessageChannel", "BroadcastChannel", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask"]);
block(AbortSignal, ["timeout"]);
block(timers, ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate"]);
block(timerPromises, ["setTimeout", "setInterval", "setImmediate"]); block(timerPromises.scheduler, ["wait", "yield"]);
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "ftruncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename", "chmod", "fchmod", "lchmod", "chown", "fchown", "lchown", "symlink", "link", "utimes", "futimes", "lutimes"];
block(fs, [...mutations, ...mutations.map(k => k + "Sync"), "createWriteStream", "ReadStream", "FileReadStream", "WriteStream", "FileWriteStream", "Utf8Stream", "watch", "watchFile", "openAsBlob"]);
block(fsp, mutations);
const targetURL = new URL("../../native/native_bar_fs/test_unsigned_cohort_worker.mjs", import.meta.url);
const targetPath = fileURLToPath(targetURL);
const roots = ["../helpers/", "../../node_modules/"].map(p => fileURLToPath(new URL(p, import.meta.url)));
roots.push(...roots.map(p => fs.realpathSync(p) + sep));
for (const [o, k, flag] of [[fs, "open", a => a[0]], [fs, "openSync", a => a[0]], [fsp, "open", a => a[0]],
  [fs, "readFile", a => a[0]?.flag], [fs, "readFileSync", a => a[0]?.flag], [fsp, "readFile", a => a[0]?.flag],
  ...["stat", "lstat", "readdir", "opendir", "realpath", "readlink", "access"].flatMap(k => [[fs, k, () => undefined], [fs, k + "Sync", () => undefined], [fsp, k, () => undefined]])]) {
  if (typeof o[k] !== "function") continue; const original = o[k]; replace(o, k, (p, ...a) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(a);
    if ((f === undefined || f === 0 || f === "r") && (full === targetPath || roots.some(r => full.startsWith(r)))) {
      // The loader requests buffers; its UTF-8 source read must not reopen the raw readSync capability.
      if (o === fs && k === "readFileSync") {
        const encoding = typeof a[0] === "string" ? a[0] : a[0]?.encoding;
        if (encoding === undefined || encoding === null || encoding === "utf8" || encoding === "utf-8") {
          const text = original.call(o, p, { encoding: "utf8", flag: f ?? "r" });
          return encoding ? text : Buffer.from(text, "utf8");
        }
      } else return original.call(o, p, ...a);
    }
    effects.push(k); throw Error("c2b_forbidden_read");
  });
}
for (const [o, k, statics] of [[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]) {
  const deny = n => function () { effects.push(n); throw Error("c2b_forbidden_effect"); };
  const f = Object.assign(deny(k), Object.fromEntries(statics.map(n => [n, deny(n)]))); replace(o, k, f); blocked.push([o, k], ...statics.map(n => [f, n]));
}
block(performance, ["now"]); block(process, ["uptime", "cpuUsage", "resourceUsage"]);
if (typeof Temporal === "object") block(Temporal.Now, Object.getOwnPropertyNames(Temporal.Now));
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach(f => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });

const data = await import("../helpers/unsignedControllerData.mjs");
const wire = await import("../helpers/unsignedControllerWireContracts.mjs");
const startup = await import("../helpers/unsignedWorkerStartupContracts.mjs");
const support = await import("../helpers/unsignedAdapterSupport.mjs");
const parent = await import("../helpers/unsignedControllerContracts.mjs");
const { createUnsignedIsolatedTypeScript } = await import("../helpers/unsignedIsolatedTypeScript.mjs");
const ts = createUnsignedIsolatedTypeScript(fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), "utf8"));
const source = fs.readFileSync(targetURL, "utf8").replace(/\r\n/g, "\n");
const parse = s => ts.createSourceFile("worker.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const tree = parse(source), root = tree.statements.find(n => n.name?.text === "prepareOriginalWorkerStartup");
const declarations = Array.from(root.body.statements.filter(n => ts.isFunctionDeclaration(n)));
const names = declarations.map(n => n.name.text);
const { canonical, digest, flags, freeze } = data, clone = v => JSON.parse(JSON.stringify(v)), h = "a".repeat(64);
const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
function allocation(mode = "normal") { return { fixture: { request: { schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run", source_commit: "a".repeat(40), patch_sha256: h },
  case_id: "u1-unsigned", mode, ids: Object.fromEntries(["fixture", "store", "epoch", "authority", "key", "reference", "extra"].map((k, i) => [k, uuid(i + 1)])) },
  exchange_id: "exchange-1", launch_nonce: "nonce-1", source_tree_sha256: h, signature_profile: "linker_adhoc", artifacts: Object.fromEntries(Object.keys(wire.artifactSchema.shape).map(k => [k, h])) }; }
function memory(options = {}) {
  let now = 0n, pointOverride = null, worker = null; const handles = [], sockets = [], pairs = [], callbacks = [], charges = [];
  const sessions = new WeakMap(), retained = new Set(), startupProofs = new WeakMap(), fakeProcess = {};
  const clock = { binding: { clock_domain: "worker-clock", started_ns: "0" }, end_ns: "900000000000",
    point() { return pointOverride === null ? { clock_domain: "worker-clock", monotonic_ns: String(now) } : pointOverride(); } };
  class Port extends EventEmitter {
    constructor() { super(); this.referenced = false; this.refCalls = 0; this.closeCalls = 0; }
    hasRef() { return this.referenced; }
    ref() { this.referenced = true; this.refCalls++; }
    close() { this.closeCalls++; if (options.closeThrows) throw Error("invented_close"); if (options.pairCloseEvents !== false) for (const p of pairs[0]) p.emit("close"); }
  }
  class Channel { constructor() { this.port1 = new Port(); this.port2 = new Port(); pairs.push([this.port1, this.port2]); if (options.channelThrows) throw Error("invented_channel"); } }
  class Pipe extends EventEmitter {
    // Like net.Socket with allowHalfOpen false, an inbound end replaces write before any listener the worker installs.
    constructor(opts) { super(); super.on("end", () => { this.write = function writeAfterFIN() { return false; }; }); assert.deepEqual(opts, sockets.length === 0
      ? { fd: 3, readable: true, writable: false, allowHalfOpen: false }
      : { fd: 4, readable: true, writable: true, allowHalfOpen: false });
      this.options = opts; this.lines = []; this.endCalls = 0; sockets.push(this); options.onSocket?.(api, opts); if (options.socketThrow === opts.fd) throw Error("invented_socket"); }
    on(event, callback) { const value = super.on(event, callback); options.onListen?.(this, event, api); return value; }
    write(line, encoding, cb) { assert.equal(this.options.fd, 4); assert.equal(encoding, "utf8"); this.lines.push(line); callbacks.push(cb);
      options.onWrite?.(api, cb); if (options.callbackFirst) cb(null); if (options.writeThrows) throw Error("invented_write");
      return Object.hasOwn(options, "writeReturn") ? options.writeReturn : true; }
    end() { this.endCalls++; if (options.endThrows) throw Error("invented_end"); if (options.endEvents !== false) { this.emit("finish"); this.emit("close"); } return this; }
  }
  const setTimer = (cb, ms) => {
    if (options.timerThrows) throw Error("invented_timer"); const t = { cb, ms, referenced: true, clears: 0, hasRef() { return this.referenced; } };
    handles.push(t); options.onTimer?.(api, t); if (options.timerSynchronous) cb(); return t;
  };
  const clearTimer = t => { t.clears++; if (options.clearThrows) throw Error("invented_clear"); options.onClear?.(api, t); };
  let hashLeft = 2147483648, helperLeft = 131072;
  const reserveWork = (s, bytes, count) => { if (options.workUnavailable || options.hashUnavailable && bytes > 0 || bytes > hashLeft || count > helperLeft) throw Error("invented_work");
    charges.push({ bytes, count }); hashLeft -= bytes; helperLeft -= count; };
  let deferred = null;
  const qualify = async ref => {
    const s = sessions.get(ref);
    if (options.deferStartup) await new Promise(resolve => { deferred = resolve; });
    if (options.startupThrows) throw Error("invented_startup_unknown");
    const proof = Object.freeze(Object.create(null)), record = { owner: s, binding: s.binding, consumed: false, mode: s.mode, addon_protocol: 6, native_mode: "synthetic_only" };
    options.mutateProof?.(record); startupProofs.set(proof, record);
    return options.foreignProof ? Object.freeze({}) : proof;
  };
  const excluded = new Set(["reserveOriginalWorkerWork", ...(options.refuseStartup ? [] : ["qualifyOriginalWorkerStartup"]), ...(options.realDisposition ? [] : ["disposeOriginalWorkerStartup"])]);
  const injected = { reserveOriginalWorkerWork: reserveWork, ...(options.refuseStartup ? {} : { qualifyOriginalWorkerStartup: qualify }),
    ...(options.realDisposition ? {} : { disposeOriginalWorkerStartup(s) { s.startup.proof = null; s.startup.disposition = "retired"; } }) };
  const env = { policy: { mode: options.mode ?? "normal" }, clock, sessions, retained, startupProofs, workerAllocated: false, Socket: Pipe, MessageChannel: Channel,
    setTimeout: setTimer, clearTimeout: clearTimer, process: fakeProcess,
    createUnsignedProtocolDecoder: support.createUnsignedProtocolDecoder, readUnsignedControllerFrame: options.readFrame ?? wire.readUnsignedControllerFrame,
    validateUnsignedWireBinding: wire.validateUnsignedWireBinding, validateUnsignedWorkerStartupEnvelope: startup.validateUnsignedWorkerStartupEnvelope,
    canonical, flags, freeze, ...injected };
  const candidateDeclarations = options.source ? Array.from(parse(options.source).statements.find(n => n.name?.text === "prepareOriginalWorkerStartup").body.statements.filter(n => ts.isFunctionDeclaration(n))) : declarations;
  const body = candidateDeclarations.filter(n => !excluded.has(n.name.text)).map(n => n.getText()).join("\n");
  const connection = vm.compileFunction('"use strict";\n' + body + '\nreturn {' + names.map(n => n + ':' + n).join(',') + '};', Object.keys(env))(...Object.values(env));
  const api = { connection, sessions, retained, clock, handles, sockets, pairs, callbacks, charges, fakeProcess,
    setTime(n) { now = BigInt(n); }, setPoint(f) { pointOverride = f; }, resolveStartup() { deferred(); },
    view() { return connection.describeOriginalWorker(worker); },
    send(kind = "LAUNCH", mutate = null) {
      const binding = parent.createUnsignedControllerProtocolModel(allocation(options.mode)).describe().binding;
      const f = { binding: clone(binding), direction: "parent", ordinal: kind === "LAUNCH" ? 1 : 2, kind, payload: {} };
      if (kind === "PREPARE") { f.binding = { ...binding, setup: { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h } };
        f.payload = { launch_nonce: binding.launch_nonce, configuration: { invented: true } }; }
      mutate?.(f); sockets[0].emit("data", Buffer.from(canonical(f) + "\n")); return f;
    },
    statusFrames() { return sockets[1]?.lines.map(l => JSON.parse(l)) ?? []; },
    callback(error = null, index = callbacks.length - 1) { callbacks[index](error); },
    closePeer() { sockets[0].emit("end"); sockets[0].emit("close"); },
    initialize() { worker = connection.allocateOriginalWorker(); api.state = worker;
      try { connection.acquireOriginalWorkerPair(worker); connection.armOriginalWorkerTimer(worker, "phase", worker.phaseEnd); connection.checkpointOriginalWorker(worker);
        worker.helpers = true; worker.decoder = support.createUnsignedProtocolDecoder();
        options.beforePipes?.(api);
        connection.bindOriginalWorkerPipes(worker); connection.checkpointOriginalWorker(worker); return api;
      } catch (error) { connection.stopOriginalWorker(worker, "initialization_failed"); throw error; } } };
  return api;
}
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const healthy = async options => { const e = memory(options).initialize(); e.send(); await tick(); return e; };

test("C2b module, exported entry and private operational policy refuse before capability reads", async () => {
  let accesses = 0; const deniedProcess = new Proxy({}, { get() { accesses++; throw Error("forbidden_capability"); } });
  const body = Array.from(tree.statements).map(n => n.getText().replace(/^export\s+/, "")).join("\n");
  assert.throws(() => vm.compileFunction(body, ["process"])(deniedProcess), /execution_not_approved/);
  const functions = Array.from(tree.statements.filter(n => ts.isFunctionDeclaration(n))).map(n => n.getText().replace(/^export\s+/, "")).join("\n");
  const entries = vm.compileFunction(functions + '\nreturn {runUnsignedCohortWorker,prepareOriginalWorkerStartup};', ["process"])(deniedProcess);
  assert.throws(() => entries.runUnsignedCohortWorker(), /execution_not_approved/); await assert.rejects(entries.prepareOriginalWorkerStartup(), /operational_profile_unavailable/);
  assert.equal(accesses, 0);
});
for (const mode of ["normal", "ubsan"]) test(`C2b original private connections send one READY after fake qualification ${mode}`, async () => {
  const e = await healthy({ mode }); assert.equal(e.statusFrames().length, 1); assert.equal(e.statusFrames()[0].kind, "READY"); assert.equal(e.view().frames, 2);
  assert.equal(e.view().ready_complete, false); e.callback(); assert.equal(e.view().ready_complete, true);
  assert.deepEqual(e.pairs[0].map(p => p.refCalls), [1, 1]); assert.equal(e.view().execution_available, false);
  const p = parent.createUnsignedControllerProtocolModel(allocation(mode)); const binding = p.describe().binding;
  p.acceptFrame(canonical({ binding, direction: "parent", ordinal: 1, kind: "LAUNCH", payload: {} }) + "\n"); p.noteWrite({ ordinal: 1, outcome: "started" });
  assert.equal(p.acceptFrame(e.sockets[1].lines[0]).state, "READY");
});
test("C2b unavailable C2c producer refuses and reports bounded FAILED without inventing READY", async () => {
  const direct = memory({ refuseStartup: true }).initialize();
  await assert.rejects(direct.connection.qualifyOriginalWorkerStartup(direct.state.reference), { message: "cc2c_startup_producer_unavailable" });
  const e = await healthy({ refuseStartup: true }); assert.deepEqual(e.statusFrames().map(f => [f.kind, f.ordinal]), [["FAILED", 1]]);
  e.callback(); e.closePeer(); assert.equal(e.view().retained, false); assert.equal(e.fakeProcess.exitCode, 1);
});
test("C2b early PREPARE waits for READY callback, then closed C3 withholds ambiguous FAILED", async () => {
  const e = await healthy(); e.send("PREPARE"); assert.equal(e.view().stopped, null); assert.ok(e.view().pending_prepare);
  e.callback(); assert.equal(e.view().stopped, "prepare_unavailable"); assert.equal(e.statusFrames().length, 1); assert.equal(e.view().failure_decision, "withheld");
});
test("C2b withheld READY consumes no worker ordinal before FAILED", async () => {
  const e = memory().initialize(), s = e.state; const b = parent.createUnsignedControllerProtocolModel(allocation()).describe().binding;
  s.binding = b; s.bindingHash = digest(b); s.frames = 1; s.next.parent = 2; s.startup.disposition = "acquired";
  const r = e.connection.planOriginalWorkerStatus(s, "READY"); e.connection.stopOriginalWorker(s, "ordinary_stop");
  assert.equal(r.decision, "withheld"); assert.deepEqual(e.statusFrames().map(f => [f.kind, f.ordinal]), [["FAILED", 1]]);
});
for (const options of [{ callbackFirst: true }, { callbackFirst: true, writeReturn: false }, { writeReturn: false }])
  test(`C2b callback/boolean return completion including backpressure ${JSON.stringify(options)}`, async () => {
    const e = await healthy(options); if (!options.callbackFirst) { assert.equal(e.view().ready_complete, false); e.callback(); }
    assert.equal(e.view().ready_complete, true); assert.equal(e.sockets[1].lines.length, 1); assert.equal(e.view().statuses[0].write_return, options.writeReturn ?? true);
  });
for (const options of [{ writeReturn: undefined }, { callbackFirst: true, writeReturn: undefined }, { writeThrows: true }])
  test(`C2b unknown return retains original write after callback ${JSON.stringify(options)}`, async () => {
    const e = await healthy(options); e.callback(); e.closePeer(); assert.equal(e.view().retained, true); assert.equal(e.view().statuses[0].decision, "uncertain");
    assert.equal(e.view().statuses[0].return_seen, false); assert.equal(e.pairs[0][0].closeCalls, 0);
  });
for (const event of ["error", "close", "data"]) test(`C2b stream-level ${event} before any status forbids FAILED`, () => {
  const e = memory().initialize(); e.sockets[1].emit(event, Buffer.from("reverse"));
  assert.equal(e.view().statuses.length, 0); assert.equal(e.view().failure_decision, "withheld"); assert.ok(e.view().stopped);
});
test("C2b stream error changes only current pending write and never a completed READY", async () => {
  const e = await healthy(); e.callback(); e.sockets[0].emit("end");
  assert.equal(e.view().statuses[0].decision, "completed"); assert.equal(e.statusFrames()[1].kind, "FAILED");
  e.sockets[1].emit("error", Error("invented")); e.callback(); assert.equal(e.view().statuses[0].decision, "completed"); assert.equal(e.view().statuses[1].decision, "uncertain");
});
async function statusFactWithholdsFailed(options, event) {
  const e = await healthy(options); e.callback(); e.sockets[1].emit(event, Buffer.from("reverse"));
  assert.ok(e.view().stopped); assert.deepEqual(e.statusFrames().map(f => f.kind), ["READY"]); assert.equal(e.view().failure_decision, "withheld");
}
for (const event of ["error", "close", "data"]) test(`C2b stream-level status ${event} after a completed READY forbids FAILED`, () => statusFactWithholdsFailed({}, event));
async function statusEndWithholdsFailed(options) {
  const e = await healthy(options); e.callback(); e.sockets[1].emit("end"); const v = e.view();
  assert.equal(v.stopped, "status_end"); assert.deepEqual(e.statusFrames().map(f => f.kind), ["READY"]); assert.equal(v.failure_decision, "attempted");
  assert.deepEqual(v.statuses.map(r => [r.kind, r.decision]), [["READY", "completed"], ["FAILED", "withheld"]]); assert.equal(v.next_ordinals.worker, 2);
}
test("C2b a status end replaces write before FAILED, so the dispatch identity check withholds it", () => statusEndWithholdsFailed({}));
async function callbackErrorStops(options, order = "after_return") {
  const e = await healthy({ ...options, ...(order === "before_return" ? { onWrite(api, callback) { callback(Error("invented")); } } : {}) });
  if (order === "after_return") e.callback(Error("invented")); const v = e.view();
  assert.equal(v.statuses[0].callback_okay, false); assert.equal(v.statuses[0].decision, "uncertain"); assert.equal(v.stopped, "status_callback_failed");
  assert.equal(v.ready_complete, false); assert.deepEqual(e.statusFrames().map(f => f.kind), ["READY"]); assert.equal(v.failure_decision, "withheld");
}
for (const order of ["after_return", "before_return"]) test(`C2b write callback error leaves READY uncertain and stops ${order}`, () => callbackErrorStops({}, order));
async function knownFailedCompletes(options) {
  const e = await healthy({ ...options, refuseStartup: true }); e.callback(); assert.equal(e.view().statuses[0].decision, "completed");
  const bad = await healthy({ ...options, refuseStartup: true }); bad.callback(Error("invented"));
  assert.equal(bad.view().statuses[0].decision, "uncertain"); assert.equal(bad.view().statuses[0].callback_okay, false); assert.equal(bad.view().stopped, "startup_failed");
}
test("C2b a known FAILED write completes, while its callback error is uncertain", () => knownFailedCompletes({}));
async function commandCloseKeepsFailed(options, order = "close_first") {
  const e = await healthy(options); e.callback(); e.sockets[0].emit("end"); assert.equal(e.view().statuses[1].decision, "started");
  if (order === "close_first") { e.sockets[0].emit("close"); e.callback(); } else { e.callback(); e.sockets[0].emit("close"); }
  assert.equal(e.view().statuses[1].decision, "completed"); assert.equal(e.view().retained, false);
}
// Only close_first reaches the FAILED while it is in flight; callback_first is the settled-first control.
for (const order of ["close_first", "callback_first"]) test(`C2b a later command close leaves a known FAILED completed ${order}`, async () => {
  await commandCloseKeepsFailed({}, order);
  const ready = await healthy(); ready.sockets[0].emit("close"); assert.equal(ready.view().statuses[0].decision, "uncertain");
});
async function statusFactUncertainFailed(options, event) {
  const e = await healthy({ ...options, refuseStartup: true }); assert.equal(e.view().statuses[0].decision, "started");
  e.sockets[1].emit(event, Buffer.from("reverse")); assert.equal(e.view().statuses[0].decision, "uncertain");
  e.callback(); assert.equal(e.view().statuses[0].callback_okay, true); assert.equal(e.view().statuses[0].decision, "uncertain");
}
for (const event of ["error", "close", "data", "end"]) test(`C2b status-stream ${event} makes an in-flight FAILED uncertain before and after its callback`, () => statusFactUncertainFailed({}, event));
test("C2b unknown acquisition and late acquisition retain original proof until known disposition", async () => {
  const e = memory({ deferStartup: true, realDisposition: true }).initialize(); e.send(); await tick(); e.connection.stopOriginalWorker(e.state, "ordinary_stop");
  assert.equal(e.view().startup.pending, true); e.resolveStartup(); await tick(); e.closePeer();
  assert.equal(e.view().startup.resource_retained, true); assert.equal(e.view().startup.close_attempted, true); assert.equal(e.pairs[0][0].closeCalls, 0);
});
for (const option of [{ startupThrows: true }, { foreignProof: true }]) test(`C2b unknown startup never releases its lifetime ${JSON.stringify(option)}`, async () => {
  const e = await healthy(option); e.closePeer(); assert.equal(e.view().startup.pending, true); assert.equal(e.view().retained, true); assert.equal(e.pairs[0][0].closeCalls, 0);
});
const invalidProofs = [
  ["owner", "owned.owner !== s", r => { r.owner = {}; }],
  ["binding identity", "owned.binding !== s.binding", r => { r.binding = clone(r.binding); }],
  ["consumed", "owned.consumed\n", r => { r.consumed = true; }],
  ["mode", "owned.mode !== s.mode", r => { r.mode = "ubsan"; }],
  ["addon protocol", "owned.addon_protocol !== 6", r => { r.addon_protocol = 5; }],
  ["native mode", 'owned.native_mode !== "synthetic_only"', r => { r.native_mode = "live"; }],
];
async function refusesRegisteredProof(options, mutateProof) {
  const e = await healthy({ ...options, mutateProof }); e.closePeer();
  assert.equal(e.statusFrames().some(f => f.kind === "READY"), false);
  assert.equal(e.view().startup.pending, true); assert.equal(e.view().retained, true); assert.equal(e.pairs[0][0].closeCalls, 0);
}
for (const [name, , mutate] of invalidProofs) test(`C2b registered proof mismatch retains unknown startup: ${name}`, () => refusesRegisteredProof({}, mutate));
for (const point of [null, { clock_domain: "foreign", monotonic_ns: "1" }, { clock_domain: "worker-clock", monotonic_ns: "-1" }])
  test(`C2b invalid callback clock is sticky ${JSON.stringify(point)}`, async () => {
    const e = await healthy(); e.setPoint(() => point); e.callback(); assert.equal(e.view().clock_invalid, true); assert.equal(e.view().statuses[0].decision, "uncertain");
    e.setPoint(() => ({ clock_domain: "worker-clock", monotonic_ns: "1" })); assert.throws(() => e.connection.checkpointOriginalWorker(e.state));
  });
function rollbackIsSticky(options) {
  const e = memory(options).initialize(); e.setTime(5000000000n); e.connection.checkpointOriginalWorker(e.state); e.setTime(1000000000n);
  assert.throws(() => e.connection.checkpointOriginalWorker(e.state)); assert.equal(e.view().clock_invalid, true); assert.equal(e.view().stopped, "clock_invalid");
}
test("C2b a monotonic rollback is a sticky clock fault", () => rollbackIsSticky({}));
test("C2b status deadline equality is late and preserves the first failure", async () => {
  const e = await healthy(); e.setTime(10000000000n); e.callback(); assert.equal(e.view().statuses[0].decision, "uncertain"); assert.equal(e.view().stopped, "status_deadline");
  e.sockets[1].emit("error", Error("later")); assert.equal(e.view().stopped, "status_deadline");
});
test("C2b early timer rearm keeps the deadline and ignores its stale segment", () => {
  const e = memory().initialize(), old = e.handles[0], deadline = e.view().timers.phase.deadline_ns;
  e.setTime(1000000n); old.cb(); assert.equal(e.handles.length, 2); assert.equal(old.clears, 1); assert.equal(e.view().timers.phase.deadline_ns, deadline);
  old.cb(); assert.equal(e.handles.length, 2); e.connection.stopOriginalWorker(e.state, "ordinary_stop"); assert.equal(e.handles[1].clears, 1);
});
test("C2b rearm samples time after the original synchronous clear returns", () => {
  const e = memory({ onClear(api) { api.setTime(50001000000n); } }).initialize(); e.setTime(1000000n); e.handles[0].cb();
  assert.equal(e.handles[1].ms, 69999); assert.equal(e.view().timers.phase.deadline_ns, "120000000000");
});
test("C2b a clear crossing the deadline cannot register another timer", () => {
  const e = memory({ onClear(api) { api.setTime(120000000000n); } }).initialize(); e.setTime(1000000n); e.handles[0].cb();
  assert.equal(e.handles.length, 1); assert.equal(e.view().stopped, "preparation_deadline");
});
test("C2b a returned FD3 crossing the deadline prevents FD4 acquisition", () => {
  const e = memory({ onSocket(api, opts) { if (opts.fd === 3) api.setTime(120000000000n); } });
  assert.throws(() => e.initialize()); assert.deepEqual(e.sockets.map(p => p.options.fd), [3]); assert.equal(e.view().retained, true);
});
for (const change of [api => api.setTime(120000000000n), api => { api.pairs[0][0].referenced = false; },
  api => api.connection.stopOriginalWorker(api.state, "invented_stop")])
  test(`C2b qualification lost before pipe acquisition creates no FD3: ${change}`, () => {
    const e = memory({ beforePipes: change }); assert.throws(() => e.initialize()); assert.deepEqual(e.sockets, []);
  });
test("C2b stop during an early clear retires the known-cleared slot without another physical clear", () => {
  const e = memory({ onClear(api) { api.closePeer(); } }).initialize(); e.setTime(1000000n); e.handles[0].cb();
  assert.equal(e.state.timers.phase, null); assert.equal(e.handles[0].clears, 1); assert.equal(e.handles.length, 1);
  assert.equal(e.view().retained, false); assert.equal(e.pairs[0][0].closeCalls, 1);
});
function firedTimerUnreferenced(options) {
  const e = memory(options).initialize(), old = e.handles[0]; e.setTime(1000000n); old.referenced = false; old.cb();
  assert.equal(e.view().stopped, "timer_unreferenced"); assert.equal(e.handles.length, 1);
}
test("C2b a fired timer that is no longer referenced stops without rearming", () => firedTimerUnreferenced({}));
function earlyClearUnknown(options) {
  const e = memory({ ...options, clearThrows: true }).initialize(), old = e.handles[0]; e.setTime(1000000n); old.cb();
  assert.equal(e.view().stopped, "timer_clear_unknown"); assert.equal(e.view().timers.phase.clear_unknown, true);
  e.closePeer(); assert.equal(old.clears, 1); assert.equal(e.handles.length, 1); assert.equal(e.view().retained, true); assert.equal(e.pairs[0][0].closeCalls, 0);
}
test("C2b an early wake-up whose clear is unknown retains the slot without a retry", () => earlyClearUnknown({}));
function unexpectedLifetimeStops(options, event, reason) {
  const e = memory(options).initialize(); e.pairs[0][1].emit(event); e.closePeer();
  assert.equal(e.view().stopped, reason);
  if (event === "close") { assert.equal(e.view().ports[1].closed, true); assert.equal(e.pairs[0][0].closeCalls, 0); assert.equal(e.view().retained, true); }
}
for (const [event, reason] of [["message", "lifetime_message"], ["messageerror", "lifetime_message_error"], ["close", "lifetime_closed"]])
  test(`C2b unexpected lifetime ${event} stops before any status`, () => unexpectedLifetimeStops({}, event, reason));
test("C2b unknown clear retains its original timer slot, without a retry", () => {
  const e = memory({ clearThrows: true }).initialize(); e.connection.stopOriginalWorker(e.state, "ordinary_stop");
  e.closePeer(); assert.equal(e.handles[0].clears, 1); assert.equal(e.view().timers.phase.clear_unknown, true); assert.equal(e.view().retained, true);
});
test("C2b synchronous timer callback is refused without replacement", () => {
  const e = memory({ timerSynchronous: true }); assert.throws(() => e.initialize()); assert.equal(e.view().stopped, "timer_reentrant"); assert.equal(e.handles.length, 1); assert.equal(e.sockets.length, 0);
});
test("C2b loss of timer or lifetime reference stops before another write", async () => {
  const e = await healthy(); e.pairs[0][0].referenced = false; assert.throws(() => e.connection.checkpointOriginalWorker(e.state)); assert.equal(e.view().stopped, "lifetime_unreferenced");
  const t = memory().initialize(); t.handles[0].referenced = false; assert.throws(() => t.connection.checkpointOriginalWorker(t.state)); assert.equal(t.view().stopped, "timer_unqualified");
});
test("C2b only original status/callback/session references can advance", async () => {
  const e = await healthy(), r = e.state.pending; assert.throws(() => e.connection.writeOriginalWorkerStatus(e.state, { ...r }));
  assert.throws(() => e.connection.currentOriginalWorker(Object.freeze({}))); e.connection.terminalOriginalWorker(e.state, {}, "status", "close");
  assert.equal(e.view().status_closed, false); e.callback(); e.callback(); assert.equal(e.view().statuses[0].decision, "completed");
});
test("C2b one entangled close waits for two independent original close events", async () => {
  const e = await healthy({ refuseStartup: true, pairCloseEvents: false }); e.callback(); e.closePeer();
  assert.equal(e.pairs[0][0].closeCalls, 1); assert.equal(e.view().retained, true); e.pairs[0][0].emit("close"); assert.equal(e.view().retained, true);
  e.pairs[0][1].emit("close"); assert.equal(e.view().retained, false); e.pairs[0][0].emit("close"); assert.equal(e.pairs[0][0].closeCalls, 1);
});
test("C2b shared frame exhaustion refuses before decoding or charging", () => {
  const e = memory().initialize(); e.state.frames = 32; let calls = 0; e.state.decoder = { push() { calls++; throw Error("decoded"); } };
  const charges = e.charges.length; e.send(); assert.equal(calls, 0); assert.equal(e.charges.length, charges);
});
function wrapDecoder(e, before) { const d = e.state.decoder; e.state.decoder = { push(bytes) { before(); return d.push(bytes); }, end() { return d.end(); } }; }
function lateInputNotDecoded(options) {
  const e = memory(options).initialize(); let pushes = 0; wrapDecoder(e, () => { pushes++; });
  e.setTime(120000000000n); e.send(); assert.equal(pushes, 0); assert.equal(e.view().frames, 0); assert.equal(e.view().stopped, "preparation_deadline");
}
test("C2b input arriving after the deadline is not decoded", () => lateInputNotDecoded({}));
function splitCrossingNotCharged(options) {
  const e = memory(options).initialize(); wrapDecoder(e, () => e.setTime(120000000000n)); const charges = e.charges.length;
  e.send(); assert.equal(e.charges.length, charges); assert.equal(e.view().frames, 0);
}
test("C2b a deadline crossed while splitting lines precedes any work reservation", () => splitCrossingNotCharged({}));
function validationRechecked(options, change) {
  const e = memory({ ...options, readFrame: (...a) => { const f = wire.readUnsignedControllerFrame(...a); change(e); return f; } }).initialize();
  e.send(); assert.equal(e.view().frames, 0); assert.equal(e.view().binding_sha256, null);
}
for (const change of [api => api.setTime(120000000000n), api => { api.pairs[0][0].referenced = false; }])
  test(`C2b LAUNCH is rechecked after hashing and validation: ${change}`, () => validationRechecked({}, change));
test("C2b invalid suffix is not silently lost, and stopped traffic is bounded without parsing", () => {
  const e = memory().initialize(); e.sockets[0].emit("data", Buffer.from("{}\n{}\n")); const first = e.view().stopped;
  e.sockets[0].emit("data", Buffer.alloc(2097153)); assert.equal(e.view().stopped, first); assert.equal(e.view().discarded_bytes, 2097152); assert.equal(e.view().discard_unknown, true);
});
test("C2b diagnostics contain no raw line/configuration/handle and fit the existing diagnostic budget", async t => {
  const e = await healthy(); e.callback(); e.sockets[0].emit("end"); const v = e.view(), encoded = canonical(v);
  assert.ok(Buffer.byteLength(encoded) < 16384); assert.doesNotMatch(encoded, /"line"|"configuration"|"port"|"handle"/);
  assert.equal(v.execution_available, false); assert.equal(v.runtime_qualified, false); t.diagnostic("connection_view_bytes=" + Buffer.byteLength(encoded));
});
test("C2b original clock and UTC/JST conversion use only explicit synthetic primitives here", () => {
  const reject = declarations.find(n => n.name.text === "rejectOriginalWorker").getText(), original = declarations.find(n => n.name.text === "originalWorkerClock").getText();
  let n = 0n, ms = 1000;
  class SyntheticDate { constructor(value) { this.value = value; } static now() { return ms; }
    toISOString() { return this.value === 1000 ? "1970-01-01T00:00:01.000Z" : "1970-01-01T09:00:01.000Z"; } }
  const make = vm.compileFunction(reject + original + '\nreturn originalWorkerClock();', ["process", "Date"]);
  const c = make({ hrtime: { bigint: () => n++ } }, SyntheticDate), stamp = c.stamp();
  assert.equal(c.binding.started_ns, "0"); assert.equal(stamp.before_ns, "1"); assert.equal(stamp.after_ns, "2"); assert.equal(stamp.validation_end_ns, "3");
  assert.equal(stamp.wall_utc, "1970-01-01T00:00:01.000Z"); assert.equal(stamp.wall_jst, "1970-01-01T09:00:01.000+09:00");
  ms = 999; assert.equal(c.stamp().wall_adjustment_possible, true);
  n = 0n; assert.throws(() => c.point(), /clock_invalid/); n = 100n; assert.throws(() => c.point(), /clock_unavailable/);
});
test("C2b a supplied preparation deadline is not mislabelled a clock fault", () => {
  const e = memory().initialize(); e.setTime(120000000000n); e.handles[0].cb();
  assert.equal(e.view().stopped, "preparation_deadline"); assert.equal(e.view().clock_invalid, false);
});
test("C2b reference inspection time is included before status dispatch", async () => {
  const e = memory().initialize(), s = e.state, binding = parent.createUnsignedControllerProtocolModel(allocation()).describe().binding;
  s.binding = binding; s.bindingHash = digest(binding); s.frames = 1; s.startup.disposition = "acquired";
  const r = e.connection.planOriginalWorkerStatus(s, "READY"), old = e.pairs[0][0].hasRef;
  e.pairs[0][0].hasRef = function () { e.setTime(10000000000n); return old.call(this); }; s.pair[0].hasRef = e.pairs[0][0].hasRef;
  e.connection.writeOriginalWorkerStatus(s, r); assert.deepEqual(e.statusFrames().map(f => f.kind), ["FAILED"]); assert.equal(r.started, false);
});
test("C2b frame budget is checked again at dispatch and before new status hashing", () => {
  const e = memory().initialize(), s = e.state, binding = parent.createUnsignedControllerProtocolModel(allocation()).describe().binding;
  s.binding = binding; s.bindingHash = digest(binding); s.frames = 1; s.startup.disposition = "acquired";
  const r = e.connection.planOriginalWorkerStatus(s, "READY"); s.frames = 32;
  e.connection.writeOriginalWorkerStatus(s, r); assert.equal(r.started, false); assert.equal(e.statusFrames().length, 0); assert.equal(s.next.worker, 1);
  const chargeCount = e.charges.length; assert.throws(() => e.connection.planOriginalWorkerStatus(s, "FAILED")); assert.equal(e.charges.length, chargeCount);
});
test("C2b work refusal precedes incoming JSON/schema/hash processing", () => {
  let calls = 0; const e = memory({ hashUnavailable: true, readFrame: (...args) => { calls++; return wire.readUnsignedControllerFrame(...args); } }).initialize();
  e.send(); assert.equal(calls, 0); assert.equal(e.view().frames, 0); assert.equal(e.statusFrames().length, 0);
});
test("C2b C3 cannot be reached before READY is actually started", () => {
  const e = memory().initialize(), s = e.state, binding = parent.createUnsignedControllerProtocolModel(allocation()).describe().binding;
  s.binding = binding; s.bindingHash = digest(binding); s.frames = 1; s.next.parent = 2; s.startup.disposition = "acquired";
  e.connection.planOriginalWorkerStatus(s, "READY"); e.send("PREPARE"); assert.equal(e.view().pending_prepare, null); assert.equal(e.view().ready_complete, false);
});
test("C2b valid prefix plus an invalid suffix stops the pending startup", async () => {
  const e = memory({ deferStartup: true }).initialize(), binding = parent.createUnsignedControllerProtocolModel(allocation()).describe().binding;
  e.sockets[0].emit("data", Buffer.from(canonical({ binding, direction: "parent", ordinal: 1, kind: "LAUNCH", payload: {} }) + "\n{}\n"));
  assert.equal(e.view().frames, 1); assert.equal(e.view().startup.pending, true); e.resolveStartup(); await tick(); assert.equal(e.statusFrames().length, 0);
});
test("C2b mode changes never switch the selected worker", async () => {
  const e = memory().initialize(); e.send("LAUNCH", f => f.binding.mode = "ubsan"); await tick();
  assert.equal(e.view().frames, 0); assert.equal(e.state.mode, "normal"); assert.equal(e.statusFrames().length, 0);
});
for (const fault of [{ timerThrows: true }, { socketThrow: 4 }, { channelThrows: true }]) test(`C2b partial acquisition remains unknown without a replacement ${JSON.stringify(fault)}`, () => {
  const e = memory(fault); assert.throws(() => e.initialize()); assert.equal(e.view().retained, true);
  assert.throws(() => e.connection.allocateOriginalWorker(), /invocation_once/); assert.equal(e.pairs.length, 1);
});
test("C2b known pre-dispatch work refusal releases only the already-owned pair", () => {
  const e = memory({ workUnavailable: true }); assert.throws(() => e.initialize()); assert.equal(e.handles.length, 0); assert.equal(e.sockets.length, 0);
  assert.equal(e.pairs[0][0].closeCalls, 1); assert.equal(e.view().retained, false); assert.throws(() => e.connection.allocateOriginalWorker(), /invocation_once/);
});
test("C2b status-end failure retains original streams and the anchor without retry", async () => {
  const e = await healthy({ refuseStartup: true, endThrows: true }); e.callback(); e.closePeer();
  assert.equal(e.sockets[1].endCalls, 1); assert.equal(e.view().end_unknown, true); assert.equal(e.view().retained, true); assert.equal(e.pairs[0][0].closeCalls, 0);
});
test("C2b callback-first stream error never qualifies known boolean return as READY", async () => {
  const e = await healthy({ callbackFirst: true, onWrite(api) { api.sockets[1].emit("error", Error("invented")); } });
  assert.equal(e.view().statuses[0].decision, "uncertain"); assert.equal(e.view().ready_complete, false); assert.equal(e.statusFrames().length, 1);
});
test("C2b completion rechecks lifetime references changed during the original write", async () => {
  const e = await healthy({ callbackFirst: true, onWrite(api) { api.pairs[0][0].referenced = false; } });
  assert.equal(e.view().ready_complete, false); assert.equal(e.view().statuses[0].decision, "uncertain"); assert.equal(e.view().stopped, "lifetime_unreferenced");
});
for (const order of ["timer_first", "callback_first"]) test(`C2b timer/callback order at the same deadline is equivalent ${order}`, async () => {
  const e = await healthy(), timer = e.state.timers.operation.handle; e.setTime(10000000000n);
  if (order === "timer_first") { timer.cb(); e.callback(); } else { e.callback(); timer.cb(); }
  assert.equal(e.view().stopped, "status_deadline"); assert.equal(e.view().statuses[0].decision, "uncertain"); assert.equal(e.statusFrames().length, 1);
});
test("C2b callback before return cannot repair a late synchronous return", async () => {
  const e = await healthy({ onWrite(api, callback) { callback(null); api.setTime(10000000000n); } });
  assert.equal(e.view().ready_complete, false); assert.equal(e.view().statuses[0].decision, "uncertain"); assert.equal(e.view().statuses[0].return_seen, true);
});
test("C2b listener-time stop cannot install further stream handlers", () => {
  const installed = [], e = memory({ onListen(pipe, event) { installed.push([pipe.options.fd, event]); if (pipe.options.fd === 4 && event === "close") pipe.emit("close"); } });
  assert.throws(() => e.initialize()); assert.deepEqual(installed, [[4, "error"], [4, "close"]]); assert.equal(e.view().stopped, "status_close");
  assert.equal(e.view().pipes_bound, false); assert.equal(e.view().retained, true);
});
test("C2b retired callbacks and input cannot resurrect the original invocation", async () => {
  const e = await healthy({ refuseStartup: true }); e.callback(); e.closePeer(); const before = canonical(e.view());
  e.callback(); e.sockets[0].emit("data", Buffer.from("{}\n")); e.handles[0].cb(); assert.equal(canonical(e.view()), before);
  assert.throws(() => e.connection.allocateOriginalWorker(), /invocation_once/);
});
test("C2b original stream slots are immutable and a replaced end method is never called", async () => {
  let calls = 0; const e = await healthy({ refuseStartup: true });
  assert.ok(Object.isFrozen(e.state.pipes)); assert.throws(() => { e.state.pipes.status = {}; }, TypeError);
  e.sockets[1].end = () => { calls++; }; e.callback(); e.closePeer();
  assert.equal(calls, 0); assert.equal(e.view().end_unknown, true); assert.equal(e.view().retained, true);
});
test("C2b maximal supplied diagnostics and C2a projections fit the diagnostic envelope only", async t => {
  const e = await healthy(), s = e.state, u = "9".repeat(30), c = "c".repeat(96);
  e.callback(); e.sockets[0].emit("end"); s.errors = Array(8).fill(c); s.stopped = c; s.discardedBytes = 2097152;
  for (const r of s.statuses) r.deadline = BigInt(u);
  for (const timer of Object.values(s.timers).filter(Boolean)) { timer.deadline = BigInt(u); timer.generation = Number.MAX_SAFE_INTEGER; timer.segment = Number.MAX_SAFE_INTEGER; }
  s.pendingPrepare = { bytes: 65536, sha256: h, line: "not_exposed" }; const bytes = Buffer.byteLength(canonical(e.view()));
  assert.ok(bytes < 16384); assert.doesNotMatch(canonical(e.view()), /not_exposed/); t.diagnostic("maximal_supplied_connection_bytes=" + bytes);
});
test("C2b an independent maximum reserves every connection view field and coexists with C2a diagnostics", async t => {
  const e = await healthy(), h = "f".repeat(64), u = "9".repeat(30), c = "c".repeat(96);
  e.callback(); e.sockets[0].emit("end");
  const timer = { generation: Number.MAX_SAFE_INTEGER, segment: Number.MAX_SAFE_INTEGER, deadline_ns: u, active: false, clear_attempted: false, clear_unknown: false, arm_unknown: false };
  const status = { kind: "FAILED", ordinal: 32, bytes: 65536, sha256: h, deadline_ns: u, started: false, return_seen: false, write_return: false, callback_seen: false, callback_okay: false, decision: "uncertain" };
  const maximum = { ...flags(), scope: "unsigned_worker_sealed_connection", runtime_completion_proven: false, retained: false, stopped: c, clock_invalid: false,
    frames: 32, next_ordinals: { parent: 33, worker: 33 }, binding_sha256: h,
    startup: { attempted: false, pending: false, disposition: "not_started", resource_retained: false, close_attempted: false },
    ports: [{ listeners: false, closed: false }, { listeners: false, closed: false }], pair_close_attempted: false, pair_close_returned: false,
    pair_unknown: false, pair_attempted: false, pipes_bound: false, pipe_unknown: false, status_closed: false, status_error: c, command_closed: false,
    end_attempted: false, end_returned: false, end_unknown: false, ready_complete: false, pending_prepare: { bytes: 65536, sha256: h },
    failure_decision: "attempted", discarded_bytes: 2097152, discard_unknown: false, errors: Array(8).fill(c), timers: { phase: timer, operation: timer }, statuses: [status, status] };
  function covers(value, bound) {
    assert.ok(Buffer.byteLength(canonical(value)) <= Buffer.byteLength(canonical(bound)));
    if (Array.isArray(value)) { assert.ok(value.length <= bound.length); value.forEach((v, i) => covers(v, bound[i])); }
    else if (value && typeof value === "object") { assert.deepEqual(Object.keys(value).sort(), Object.keys(bound).sort()); for (const k of Object.keys(value)) covers(value[k], bound[k]); }
  }
  covers(e.view(), maximum); covers(memory().initialize().view(), maximum);
  const binding = parent.createUnsignedControllerProtocolModel(allocation()).describe().binding;
  const capacity = startup.describeUnsignedWorkerStartupCapacity({ binding, expected: { mode: "normal", binding_sha256: digest(binding), closed_set_sha256: h, module_set_sha256: h, build_record_sha256: binding.build_record_sha256 },
    clock: { clock_domain: "worker-clock", started_ns: "0", local_end_ns: "900000000000" },
    components: Object.fromEntries(["record_reader", "closed_set", "module_initialization", "metadata_host_profile", "native_profile", "work_plan"].map(k => [k, "unavailable"])),
    manifest: { rows: 1, pages: 1, page_rows: 1, page_bytes: 4096, manifest_bytes: 4096, record_bytes: 8192, file_bytes: "8192" },
    work: { case_count: 24, modes: ["normal", "ubsan"].map(mode => ({ mode, startups: 12, record_bytes: "8192", module_bytes: null, pin_bytes: null, metadata_hash_bytes: null, helper_commands: null })), other_hash_bytes: null, other_helper_commands: null }, handoff: null });
  const bytes = Buffer.byteLength(canonical({ plan: capacity.maximal_plan, envelope: capacity.maximal_envelope, connection: maximum }));
  assert.ok(bytes <= 16384); assert.equal(capacity.parent_wrapper_calculated, false); t.diagnostic(JSON.stringify({ connection_reservation_bytes: Buffer.byteLength(canonical(maximum)), combined_diagnostic_bytes: bytes }));
});
test("C2b controlled behavioral mutations fail after a successful unmodified setup", async () => {
  const trials = [
    ['if (t.cancelRequested || !t.active) { clearOriginalWorkerTimer(s, slot); progressOriginalWorkerStop(s); return; }', '', async options => {
      const e = memory({ ...options, onClear(api) { api.closePeer(); } }).initialize(); e.setTime(1000000n); e.handles[0].cb();
      assert.equal(e.state.timers.phase, null); assert.equal(e.handles[0].clears, 1); assert.equal(e.view().retained, false);
    }],
    ['checkpointOriginalWorker(s); s.pipeAttempted = true;', 's.pipeAttempted = true;', async options => {
      const e = memory({ ...options, beforePipes(api) { api.setTime(120000000000n); } });
      assert.throws(() => e.initialize()); assert.deepEqual(e.sockets, []);
    }],
    ['const at = sampleOriginalWorker(s);\n      if (at === null', 'const at = s.last;\n      if (at === null', async options => {
      const e = memory({ ...options, onClear(api) { api.setTime(50001000000n); } }).initialize(); e.setTime(1000000n); e.handles[0].cb(); assert.equal(e.handles[1].ms, 69999);
    }],
    ['s.pipes.command = command;\n    checkpointOriginalWorker(s);', 's.pipes.command = command;', async options => {
      const e = memory({ ...options, onSocket(api, opts) { if (opts.fd === 3) api.setTime(120000000000n); } });
      assert.throws(() => e.initialize()); assert.deepEqual(e.sockets.map(p => p.options.fd), [3]);
    }],
    ['{ fd: 3, readable: true, writable: false, allowHalfOpen: false }', '{ fd: 5, readable: true, writable: false, allowHalfOpen: false }', async options => { memory(options).initialize(); }],
    ['{ fd: 4, readable: true, writable: true, allowHalfOpen: false }', '{ fd: 5, readable: true, writable: true, allowHalfOpen: false }', async options => { memory(options).initialize(); }],
    ['{ fd: 3, readable: true, writable: false, allowHalfOpen: false }', '{ fd: 3, readable: true, writable: true, allowHalfOpen: false }', async options => { memory(options).initialize(); }],
    ['{ fd: 4, readable: true, writable: true, allowHalfOpen: false }', '{ fd: 4, readable: false, writable: true, allowHalfOpen: false }', async options => { memory(options).initialize(); }],
    ...invalidProofs.map(([, predicate, mutate]) => [predicate, 'false', options => refusesRegisteredProof(options, mutate)]),
    ['!r.returnSeen || !r.callbackSeen', '!r.callbackSeen', async options => {
      const e = await healthy({ ...options, writeReturn: undefined }); e.callback(); e.closePeer(); assert.equal(e.view().retained, true);
    }],
    ['s.statuses.push(r); s.pending = r;', 's.statuses.push(r); s.pending = r; s.next.worker++;', async options => {
      const e = memory(options).initialize(), s = e.state, binding = parent.createUnsignedControllerProtocolModel(allocation()).describe().binding;
      s.binding = binding; s.bindingHash = digest(binding); s.frames = 1; s.startup.disposition = "acquired";
      e.connection.planOriginalWorkerStatus(s, "READY"); e.connection.stopOriginalWorker(s, "ordinary_stop"); assert.equal(e.statusFrames()[0]?.ordinal, 1);
    }],
    ['segment !== t.segment', 'false', async options => {
      const e = memory(options).initialize(), old = e.handles[0]; e.setTime(1000000n); old.cb(); old.cb(); assert.equal(e.handles.length, 2);
    }],
    ['s.pair.every(p => p.closed)', 's.pair.some(p => p.closed)', async options => {
      const e = await healthy({ ...options, refuseStartup: true, pairCloseEvents: false }); e.callback(); e.closePeer(); e.pairs[0][0].emit("close"); assert.equal(e.view().retained, true);
    }],
    ['reserveOriginalWorkerWork(s, 524288, 0);\n        const f', 'const f', async options => {
      let calls = 0; const e = memory({ ...options, hashUnavailable: true, readFrame: (...a) => { calls++; return wire.readUnsignedControllerFrame(...a); } }).initialize(); e.send(); assert.equal(calls, 0);
    }],
    ['s.frames >= 32 || s.statusClosed', 's.statusClosed', async options => {
      const e = memory(options).initialize(), s = e.state, binding = parent.createUnsignedControllerProtocolModel(allocation()).describe().binding;
      s.binding = binding; s.bindingHash = digest(binding); s.frames = 1; s.startup.disposition = "acquired"; const r = e.connection.planOriginalWorkerStatus(s, "READY");
      s.frames = 32; e.connection.writeOriginalWorkerStatus(s, r); assert.equal(r.started, false);
    }],
    ['try { n = checkpointOriginalWorker(s, r.kind === "FAILED"); }', 'try { n = sampleOriginalWorker(s); }', async options => {
      const e = await healthy({ ...options, callbackFirst: true, onWrite(api) { api.pairs[0][0].referenced = false; } }); assert.equal(e.view().ready_complete, false);
    }],
    ['|| BigInt(p.monotonic_ns) < s.last) throw Error("clock_invalid");', ') throw Error("clock_invalid");', async options => rollbackIsSticky(options)],
    ['if (sampleOriginalWorker(s) === null || error != null) {', 'if (sampleOriginalWorker(s) === null) {', options => callbackErrorStops(options)],
    ['r.callbackOkay = error == null;', 'r.callbackOkay = true;', options => callbackErrorStops(options, "before_return")],
    ['(!s.stopped || r.kind === "FAILED")', '!s.stopped', options => knownFailedCompletes(options)],
    ['r.started && r.kind !== "FAILED"', 'r.started', options => commandCloseKeepsFailed(options)],
    ['|| r.pipe.write !== s.statusWrite', '', options => statusEndWithholdsFailed(options)],
    ['if (r.decision !== "uncertain" && r.callbackOkay', 'if (r.callbackOkay', options => statusFactUncertainFailed(options, "end")],
    ['if (s.pending?.started) s.pending.decision = "uncertain"; stopOriginalWorker(s, "status_" + event);', 'stopOriginalWorker(s, "status_" + event);', options => statusFactUncertainFailed(options, "error")],
    ['if (!referenced) { stopOriginalWorker(s, "timer_unreferenced"); return; }', '', async options => firedTimerUnreferenced(options)],
    ['catch { t.clearUnknown = true; t.clearAttempted = true; t.active = false; stopOriginalWorker(s, "timer_clear_unknown"); return; }', 'catch { return; }', async options => earlyClearUnknown(options)],
    ['() => { if (liveOriginalWorker(s)) stopOriginalWorker(s, "lifetime_message"); }', '() => {}', async options => unexpectedLifetimeStops(options, "message", "lifetime_message")],
    ['() => { if (liveOriginalWorker(s)) stopOriginalWorker(s, "lifetime_message_error"); }', '() => {}', async options => unexpectedLifetimeStops(options, "messageerror", "lifetime_message_error")],
    ['if (!s.pairCloseAttempted) stopOriginalWorker(s, "lifetime_closed");', '', async options => unexpectedLifetimeStops(options, "close", "lifetime_closed")],
    ['checkpointOriginalWorker(s); if (s.frames >= 32) rejectOriginalWorker("frame_capacity");\n      const lines', 'if (s.frames >= 32) rejectOriginalWorker("frame_capacity");\n      const lines', async options => lateInputNotDecoded(options)],
    ['checkpointOriginalWorker(s); if (s.frames >= 32) rejectOriginalWorker("frame_capacity");\n        reserve', 'if (s.frames >= 32) rejectOriginalWorker("frame_capacity");\n        reserve', async options => splitCrossingNotCharged(options)],
    ['reserved_hash_bytes: "524288" });\n        checkpointOriginalWorker(s);\n', 'reserved_hash_bytes: "524288" });\n', async options => validationRechecked(options, api => api.setTime(120000000000n))],
    // Status-stream facts gate FAILED in three layers (stop progression, planning, dispatch); only removing every layer writes FAILED.
    [[['!s.statusError && !s.pendingPrepare', '!s.pendingPrepare'], ['|| s.statusError || s.endAttempted || s.pendingPrepare', '|| s.endAttempted || s.pendingPrepare'],
      ['|| s.statusError || s.endAttempted || r.pipe', '|| s.endAttempted || r.pipe']], null, options => statusFactWithholdsFailed(options, "error")],
    [[['!s.statusClosed && !s.statusError && !s.pendingPrepare', '!s.statusError && !s.pendingPrepare'], ['|| s.statusClosed || s.statusError || s.endAttempted || s.pendingPrepare', '|| s.statusError || s.endAttempted || s.pendingPrepare'],
      ['s.frames >= 32 || s.statusClosed', 's.frames >= 32']], null, options => statusFactWithholdsFailed(options, "close")],
  ];
  for (const [from, to, assertion] of trials) {
    let changed = source;
    for (const [a, b] of Array.isArray(from) ? from : [[from, to]]) { assert.equal(changed.split(a).length, 2, a); changed = changed.replace(a, b); }
    await assertion({}); assert.equal(parse(changed).parseDiagnostics.length, 0);
    await assert.rejects(assertion({ source: changed }), e => e.code === "ERR_ASSERTION", String(from));
  }
});
test("C2b independent required sinks are guarded, without probing a real capability", () => {
  const required = [[net, "Server"], [net, "Socket"], [connectionPrototype, "connect"], [dgram, "Socket"], [listener, "listen"], [datagram, "bind"], [workers, "MessageChannel"], [workers, "Worker"],
    [child, "spawn"], [crypto, "sign"], [crypto, "createPrivateKey"], [process, "getBuiltinModule"], [globalThis, "Date"], [Date, "now"],
    [process, "hrtime"], [process.hrtime, "bigint"], [timers, "setTimeout"], [fs, "rmSync"],
    [fs, "read"], [fs, "readSync"], [fs, "readv"], [fs, "readvSync"], [fs, "createReadStream"]];
  for (const [o, k] of required) assert.ok(blocked.some(([x, y]) => x === o && y === k), k);
  const before = effects.length; for (const [o, k] of blocked) assert.throws(() => o[k](), /c2b_forbidden_effect/);
  assert.equal(effects.length, before + blocked.length); effects.length = before;
  assert.equal(escapedLowLevelReads, 0);
});
test("C2b no denied effect was swallowed", () => assert.deepEqual(effects, []));
