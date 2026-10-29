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
import { syncBuiltinESMExports } from "node:module";
import { resolve, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { EventEmitter } from "node:events";
import { builtinModules } from "node:module";

const ExplicitDate = Date;
const effects = [], restores = [], blocked = [];
const replace = (o, k, f) => {
  const d = Object.getOwnPropertyDescriptor(o, k), accessor = d && !("value" in d);
  if (accessor) Object.defineProperty(o, k, { value: f, configurable: true, writable: true, enumerable: d.enumerable }); else o[k] = f;
  restores.push(() => { if (accessor) Object.defineProperty(o, k, d); else if (d) o[k] = d.value; else delete o[k]; });
};
const block = (o, keys) => keys.filter(k => typeof o[k] === "function").forEach(k => {
  blocked.push([o, k]); replace(o, k, function () { effects.push(k); throw Error("cc4b3b_forbidden_effect"); });
});
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]); block(workers, ["Worker"]);
block(crypto, ["sign", "verify", "createSign", "createVerify", "createPrivateKey", "createPublicKey", "createSecretKey", "generateKey", "generateKeySync",
  "generateKeyPair", "generateKeyPairSync", "privateEncrypt", "privateDecrypt", "publicEncrypt", "publicDecrypt", "diffieHellman", "createDiffieHellman", "createECDH", "randomBytes"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "deriveKey", "deriveBits", "encrypt", "decrypt", "wrapKey", "unwrapKey"]);
block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"]);
block(net, ["connect", "createConnection", "createServer"]); block(net.Socket.prototype, ["connect"]);
block(http, ["request", "get", "createServer"]); block(https, ["request", "get", "createServer"]); block(http2, ["connect", "createServer", "createSecureServer"]);
block(dgram, ["createSocket"]); block(tls, ["connect", "createServer"]);
block(globalThis, ["fetch", "WebSocket", "EventSource", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask"]);
block(Date, ["now"]); block(process.hrtime, ["bigint"]);
for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter(k => /^(lookup|resolve|reverse)/.test(k)));
block(inspector, ["open", "Session"]);
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

const runtime = await import("../helpers/unsignedCohortRuntime.mjs");
const { createUnsignedCohortAssemblyModel } = await import("../helpers/unsignedCohortAssemblyModel.mjs");
const { createUnsignedControllerWindowModel } = await import("../helpers/unsignedControllerContracts.mjs");
const { canonical, digest } = await import("../helpers/unsignedControllerData.mjs");
const source = fs.readFileSync(new URL("../helpers/unsignedCohortRuntime.mjs", import.meta.url), "utf8");
const rootFunction = ts.createSourceFile("runtime.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  .statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "prepareOriginalQualification");
const selected = ["originalQualificationClock", "armOriginalQualificationTimer", "originalCohortTiming", "refuse", "code", "stop", "checkpoint", "closeOriginal", "closeRemaining", "allowedTool", "runOriginalTool", "hash"];
const declarations = rootFunction.body.statements.filter(n => ts.isFunctionDeclaration(n) && selected.includes(n.name.text));
const plain = x => JSON.parse(JSON.stringify(x));
const ms = n => BigInt(n) * 1000000n;
// Invented timers and children settle synchronously, so bounded microtask turns replace waits that could hang on a lost settlement.
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function track(promise) {
  const r = { state: "pending" };
  promise.then(value => Object.assign(r, { state: "fulfilled", value }), error => Object.assign(r, { state: "rejected", error }));
  return async () => { await flush(); return r; };
}
async function rejected(settle, pattern) { const r = await settle(); assert.equal(r.state, "rejected"); assert.match(r.error.message, pattern); }
const request = { schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run",
  source_commit: "a".repeat(40), patch_sha256: "b".repeat(64) };
function memory(options = {}) {
  const e = { now: options.start ?? 100n, wall: 1792584000000, reads: 0, walls: 0, monoQueue: [], wallQueue: [], timers: [], clears: [],
    expiries: 0, armFailure: false, clearFailure: false, unreferenced: false, refThrows: false };
  const context = { policy: options.policy ?? { total_limit_ms: "2000000" }, retainedQualificationScopes: new Set(),
    buildReferences: new WeakMap(), namespaceReferences: new WeakMap(), process: { hrtime: { bigint() {
      e.reads++; const n = e.monoQueue.length ? e.monoQueue.shift() : e.now; if (n instanceof Error) throw n; return n;
    } } }, Date: class extends ExplicitDate {
      constructor(value) { if (arguments.length !== 1) throw Error("implicit_wall_forbidden"); super(value); }
      static now() { e.walls++; const n = e.wallQueue.length ? e.wallQueue.shift() : e.wall; if (n instanceof Error) throw n; return n; }
    },
    setTimeout(callback, delay) {
      if (e.armFailure) throw Error("invented_arm_failure");
      const h = { callback, delay, ref: !e.unreferenced, hasRef() { if (e.refThrows) throw Error("invented_ref_failure"); return this.ref; } };
      e.timers.push(h); e.onTimer?.(h); return h;
    }, clearTimeout(h) { e.clears.push(h); if (e.clearFailure) throw Error("invented_clear_failure"); },
    fs: { closeSync(fd) { e.closedFd = fd; } }, path: posix, root: "/invented", Buffer, canonical, digest, crypto: { createHash: crypto.createHash },
    limits: { helper_commands: 131072, discovery_commands: 128, tool_capture_bytes: 1048576 } };
  const api = vm.runInNewContext('"use strict";\n' + declarations.map(n => n.getText()
    .replace('const { spawn } = await import("node:child_process");', 'const { spawn } = await Promise.resolve(memoryChild);'))
    .join("\n") + '\n({' + selected.join(",") + '})', context);
  e.start = () => context.clock = e.clock = api.originalQualificationClock();
  e.context = context; e.api = api;
  e.state = { phase: "NAMESPACE_BOUND", stopped: null, evidenceTainted: false, failures: [], handles: new Map(), children: new Set(),
    helper: null, commands: 0, discoveryCommands: 0, environment: {}, commandDigest: "a".repeat(64),
    recordClosed: true, recordIdentity: { ino: "1" } }; context.retainedQualificationScopes.add(e.state);
  e.arm = (kind = "metadata") => api.armOriginalQualificationTimer(e.state, kind, () => e.expiries++);
  e.refs = () => {
    const build = Object.freeze({}), namespace = Object.freeze({});
    context.buildReferences.set(build, e.state); context.namespaceReferences.set(namespace, { owner: e.state, buildRef: build });
    return { build, namespace };
  };
  e.fire = n => e.timers[n].callback();
  e.spawned = [];
  context.memoryChild = { spawn() { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    c.stdout.pause = c.stderr.pause = () => {}; e.spawned.push(c); return c; } };
  e.tool = () => api.runOriginalTool(e.state, "/bin/ls", ["-lde", "/invented"], "metadata");
  return e;
}
test("4-B3-C sealed public import and hostile caller never reach a clock or effect", () => {
  let read = 0;
  assert.throws(() => runtime.executeUnsignedCohortAssembly({ get clock() { read++; throw Error("caller"); } }), /execution_not_approved/);
  assert.equal(read, 0); assert.equal(runtime.inspectUnsignedCohortAssembly().runtime_qualified, false);
  assert.deepEqual(Object.keys(runtime).sort(), ["executeUnsignedCohortAssembly", "inspectUnsignedCohortAssembly"]);
});
test("4-B3-C constructible effect guards record attempts without performing them", () => {
  for (const [o, k] of blocked) {
    const n = effects.length; assert.throws(() => new o[k](), /forbidden_effect/); assert.equal(effects.length, n + 1); effects.pop();
  }
});
for (const value of [undefined, null, 0, "0", "-1", "01", "1.5", "9".repeat(31)]) test("4-B3-C missing/invalid fixed entry limit refuses before sampling: " + String(value), () => {
  const e = memory({ policy: { total_limit_ms: value } }); assert.throws(e.start, /entry_limit/); assert.equal(e.reads, 0); assert.equal(e.timers.length, 0);
});
test("4-B3-C origin is read once and end arithmetic is bounded", () => {
  const e = memory(); e.start(); assert.equal(e.reads, 1);
  assert.equal(e.clock.binding.started_ns, "100"); assert.equal(e.clock.end_ns, String(100n + ms(2000000)));
  assert.equal(Object.isFrozen(e.clock.binding), true);
  const max = memory({ start: 999999999999999999999999999999n }); assert.throws(max.start, /entry_limit/);
});
for (const bad of [1, "100", -1n, 1000000000000000000000000000000n, Error("invented_clock")])
  test("4-B3-C malformed/throwing monotonic point irreversibly refuses: " + String(bad), () => {
    const e = memory(); e.start(); e.monoQueue.push(bad); assert.throws(() => e.clock.check(), /monotonic/);
    const n = e.reads; e.now = 200n; assert.throws(() => e.clock.check(), /monotonic/); assert.equal(e.reads, n);
    assert.equal(e.clock.describe().clock_invalid, true);
  });
test("4-B3-C rollback remains invalid after later good samples and close-only still works", () => {
  const e = memory(); e.start(); e.now = 99n; assert.throws(() => e.clock.check(), /rollback/);
  e.now = 1000n; assert.throws(() => e.clock.stamp(), /rollback/);
  const ref = {}; e.state.handles.set(ref, { fd: 7, kind: "file", closeAttempted: false });
  e.api.closeOriginal(e.state, ref); assert.equal(e.closedFd, 7); assert.throws(() => e.api.closeOriginal(e.state, ref), /close_once/);
});
test("4-B3-C exact end latches original deadline and never samples a recovery", () => {
  const e = memory({ policy: { total_limit_ms: "1" } }); e.start(); e.now += ms(1);
  assert.throws(() => e.clock.check(), /entry_deadline/); assert.equal(e.clock.describe().stop_ns, e.clock.end_ns);
  const n = e.reads; e.now = 100n; assert.throws(() => e.clock.point(), /entry_deadline/); assert.equal(e.reads, n);
  assert.equal(e.clock.describe().clock_invalid, false);
});
test("4-B3-C every synchronous checkpoint spends the original entry deadline", () => {
  const e = memory({ policy: { total_limit_ms: "1" } }); e.start(); e.api.checkpoint(e.state); e.api.checkpoint(e.state, true);
  e.now += ms(1); assert.throws(() => e.api.checkpoint(e.state), /entry_deadline/);
  assert.throws(() => e.api.checkpoint(e.state, true), /entry_deadline/); assert.equal(e.clock.describe().stop_ns, e.clock.end_ns);
});
test("4-B3-C one millisecond permitted, sub-millisecond reservation refused without renewal", () => {
  const e = memory({ policy: { total_limit_ms: "1" } }); e.start(); assert.equal(e.clock.remaining(), 1n);
  e.now++; assert.throws(() => e.clock.remaining(), /remaining_sub_ms/); assert.equal(e.clock.end_ns, "1000100");
  assert.throws(e.arm, /remaining_sub_ms/); assert.equal(e.timers.length, 0);
});
test("4-B3-C foreign or enlarged deadline permanently invalidates dispatch", () => {
  for (const end of [0n, "100", 100n + ms(2000000) + 1n]) {
    const e = memory(); e.start(); assert.throws(() => e.clock.remaining(end), /deadline_binding/);
    assert.throws(() => e.clock.check(), /deadline_binding/);
  }
});
for (const [wall, utc, jst] of [
  [ExplicitDate.UTC(2026, 9, 20, 23, 59, 59, 999), "2026-10-20T23:59:59.999Z", "2026-10-21T08:59:59.999+09:00"],
  [ExplicitDate.UTC(2026, 9, 21), "2026-10-21T00:00:00.000Z", "2026-10-21T09:00:00.000+09:00"],
  [ExplicitDate.UTC(2028, 1, 29, 15), "2028-02-29T15:00:00.000Z", "2028-03-01T00:00:00.000+09:00"],
]) test("4-B3-C UTC/JST same wall sample with explicit monotonic bracket: " + utc, () => {
  const e = memory(); e.start(); e.wall = wall; e.monoQueue.push(200n, 300n);
  const d = e.clock.stamp(); assert.equal(e.walls, 1);
  assert.deepEqual(plain(d.stamp), { clock_domain: e.clock.binding.clock_domain, monotonic_ns: "300", wall_utc: utc, wall_jst: jst });
  assert.deepEqual(plain(d.sampling), { before_ns: "200", after_ns: "300", wall_ms: String(wall) }); assert.equal(d.wall_adjustment_possible, false);
});
test("4-B3-C wall jumps retain actual labels/uncertainty without changing elapsed allowance", () => {
  const e = memory(); e.start(); e.clock.stamp(); const end = e.clock.end_ns;
  e.now += ms(2); e.wall -= 60000;
  assert.equal(e.clock.stamp().wall_adjustment_possible, true);
  e.now += ms(2); e.wall += 120000;
  const next = e.clock.stamp(); assert.equal(next.wall_adjustment_possible, true); assert.equal(next.sampling.wall_ms, String(e.wall));
  assert.equal(e.clock.end_ns, end); assert.equal(e.clock.remaining(), 1999996n);
});
test("4-B3-C ordinary wall quantization is not treated as a proven adjustment", () => {
  const e = memory(); e.start(); e.clock.stamp(); e.now += ms(2); e.wall += 2;
  assert.equal(e.clock.stamp().wall_adjustment_possible, false);
});
// The reviewed 4-B3-A model flags elapsed wall time outside [before - previous after, after - previous before] widened by 999999 ns.
for (const [elapsed, wall, adjusted] of [[1999999n, 1, false], [2000000n, 1, true], [2000001n, 3, false], [2000000n, 3, true], [2000000n, 2, false]])
  test(`4-B3-C wall adjustment uses the 4-B3-A sub-ms slack exactly: ${elapsed} ns elapsed, ${wall} ms wall`, () => {
    const e = memory(); e.start(); e.wall = 0; e.monoQueue.push(1000n, 1000n); e.clock.stamp();
    e.monoQueue.push(1000n + elapsed, 1000n + elapsed); e.wall = wall;
    assert.equal(e.clock.stamp().wall_adjustment_possible, adjusted);
  });
for (const bad of [NaN, Infinity, 1.5, -1, "1", 253402268400000, Error("invented_wall")])
  test("4-B3-C invalid wall sample blocks new work: " + String(bad), () => {
    const e = memory(); e.start(); e.wallQueue.push(bad); assert.throws(() => e.clock.stamp(), /wall/);
    const n = e.reads; assert.throws(() => e.clock.check(), /wall/); assert.equal(e.reads, n); assert.equal(e.timers.length, 0);
  });
test("4-B3-C sampling bracket crossing original entry end cannot emit a stamp", () => {
  const e = memory({ policy: { total_limit_ms: "1" } }); e.start(); e.monoQueue.push(200n, 1000100n);
  assert.throws(() => e.clock.stamp(), /entry_deadline/); assert.equal(e.clock.describe().stop_ns, "1000100");
});
test("4-B3-C metadata/discovery cap remains 10000ms, compiler consumes original remainder", () => {
  for (const kind of ["metadata", "discovery", "compiler"]) {
    const e = memory(); e.start(); e.now += ms(1000); const t = e.arm(kind);
    assert.equal(t.hasRef(), true); assert.equal(e.timers[0].delay, kind === "compiler" ? 1999000 : 10000);
    assert.equal(t.cancel(), true); assert.equal(t.cancel(), false); assert.equal(e.clears.length, 1);
  }
  const e = memory({ policy: { total_limit_ms: "5" } }); e.start(); e.arm(); assert.equal(e.timers[0].delay, 5);
});
test("4-B3-C compiler timer segments use original end, never Node overflow or renewed duration", () => {
  const e = memory({ policy: { total_limit_ms: "2147483650" } }); e.start(); e.arm("compiler");
  assert.equal(e.timers[0].delay, 2147483647); e.now += ms(2147483647); e.fire(0);
  assert.equal(e.timers[1].delay, 3); assert.equal(e.expiries, 0);
  e.now += ms(3); e.fire(1); assert.equal(e.expiries, 1); assert.equal(e.state.timerDisposition.deadline_ns, e.clock.end_ns);
});
test("4-B3-C early callbacks rearm remaining original duration, stale segments are inert", () => {
  const e = memory(); e.start(); e.arm(); e.now += ms(4000); e.fire(0);
  assert.equal(e.timers[1].delay, 6000); e.fire(0); assert.equal(e.timers.length, 2);
  e.now += ms(5999) + 500000n; e.fire(1); assert.equal(e.timers[2].delay, 1);
  e.now += 500000n; e.fire(2); assert.equal(e.expiries, 1);
  assert.equal(e.state.timerDisposition.deadline_ns, String(100n + ms(10000)));
  assert.equal(e.clears.length, 3); e.fire(2); assert.equal(e.expiries, 1);
});
test("4-B3-C delayed callback records known deadline not observation time", () => {
  const e = memory(); e.start(); const t = e.arm(); e.now += ms(15000); e.fire(0);
  assert.equal(e.expiries, 1); assert.equal(e.state.timerDisposition.deadline_ns, String(100n + ms(10000)));
  assert.throws(() => t.check(), /inactive/); assert.equal(e.state.stopped, "cc4b3c_timer_deadline");
});
test("4-B3-C failed early rearm never clears the already-cleared original handle twice", () => {
  const e = memory(); e.start(); e.arm(); e.now += ms(4000); e.armFailure = true; e.fire(0);
  assert.equal(e.expiries, 1); assert.ok(e.state.stopped); assert.equal(e.timers.length, 1);
  assert.equal(e.clears.length, 1); assert.equal(e.clears[0], e.timers[0]);
  assert.notEqual(e.state.timerCancelUnknown, true); assert.equal(e.state.qualificationTimer, null);
  e.fire(0); assert.equal(e.expiries, 1); assert.equal(e.clears.length, 1);
});
test("4-B3-C cancellation releases once and old generation cannot affect its successor", () => {
  const e = memory(); e.start(); const a = e.arm(); a.cancel(); const b = e.arm(); e.fire(0);
  assert.equal(e.expiries, 0); assert.equal(b.hasRef(), true); assert.equal(e.state.timerGeneration, 2);
  b.cancel(); assert.equal(e.clears.length, 2); assert.equal(e.state.qualificationTimer, null);
});
test("4-B3-C concurrent timer, foreign owner and unknown helper kind refuse without scheduling", () => {
  const e = memory(); e.start(); e.arm(); assert.throws(e.arm, /timer_binding/); assert.equal(e.timers.length, 1);
  const f = memory(); f.start(); assert.throws(() => f.api.armOriginalQualificationTimer({}, "metadata", () => {}), /timer_binding/);
  assert.throws(() => f.arm("worker"), /timer_binding/); assert.equal(f.timers.length, 0);
});
for (const field of ["unreferenced", "refThrows", "armFailure"]) test("4-B3-C timer creation failure stops without dispatch: " + field, () => {
  const e = memory(); e.start(); e[field] = true; assert.throws(e.arm); assert.ok(e.state.stopped);
  assert.equal(e.state.qualificationTimer, null); assert.throws(e.arm, /stopped/); assert.equal(e.expiries, 0);
});
for (const field of ["unreferenced", "refThrows"]) test("4-B3-C arm-time unreferenced stop stays primary over unknown cancellation: " + field, () => {
  const e = memory(); e.start(); e[field] = true; e.clearFailure = true;
  assert.throws(e.arm, /timer_unreferenced/); assert.equal(e.state.stopped, "cc4b3c_timer_unreferenced");
  assert.equal(e.state.timerCancelUnknown, true); assert.equal(e.clears.length, 1); assert.notEqual(e.state.qualificationTimer, null);
});
test("4-B3-C an early callback whose handle lost its ref expires instead of rearming", () => {
  const e = memory(); e.start(); e.arm(); e.timers[0].ref = false; e.now += ms(4000); e.fire(0);
  assert.equal(e.expiries, 1); assert.equal(e.timers.length, 1); assert.equal(e.state.stopped, "cc4b3c_timer_unreferenced");
});
test("4-B3-C an early callback whose clear is unknown expires instead of rearming", () => {
  const e = memory(); e.start(); e.arm(); e.now += ms(4000); e.clearFailure = true; e.fire(0);
  assert.equal(e.expiries, 1); assert.equal(e.timers.length, 1); assert.equal(e.clears.length, 1);
  assert.equal(e.state.stopped, "cc4b3c_timer_cancel_unknown"); assert.equal(e.state.timerCancelUnknown, true); assert.notEqual(e.state.qualificationTimer, null);
});
test("4-B3-C original timer losing its ref cannot authorize work", () => {
  const e = memory(); e.start(); const t = e.arm(); e.timers[0].ref = false;
  assert.throws(() => t.check(), /unreferenced/); e.fire(0); assert.equal(e.expiries, 1); assert.equal(e.timers.length, 1);
});
test("4-B3-C actual dispatch recheck refuses after an intervening await used the reservation", async () => {
  const e = memory(); e.start(); const t = e.arm(); assert.equal(t.check(), 100n);
  await Promise.resolve(); e.now += ms(10000); assert.throws(() => t.check(), /timer_deadline/);
  assert.equal(e.timers.length, 1); assert.equal(e.state.stopped, "cc4b3c_timer_deadline");
});
test("4-B3-C monotonic failure expires once, does not reschedule or recover", () => {
  const e = memory(); e.start(); e.arm(); e.now = 99n; e.fire(0); assert.equal(e.expiries, 1);
  assert.equal(e.state.stopped, "cc4b3c_monotonic_rollback"); e.now += ms(20); e.fire(0);
  assert.equal(e.expiries, 1); assert.equal(e.timers.length, 1); assert.throws(() => e.clock.point(), /rollback/);
});
test("4-B3-C stopped pending helper gets one failure callback without renewed work", () => {
  const e = memory(); e.start(); e.arm(); e.state.stopped = "cc4b3b_original_stop"; e.fire(0);
  assert.equal(e.expiries, 1); assert.equal(e.state.stopped, "cc4b3b_original_stop"); assert.equal(e.timers.length, 1);
});
test("4-B3-C unknown timer cancellation retains stop without retrying clear", () => {
  const e = memory(); e.start(); const t = e.arm(); e.clearFailure = true;
  assert.equal(t.cancel(), true); assert.equal(t.cancel(), false); assert.equal(e.clears.length, 1);
  assert.equal(e.state.stopped, "cc4b3c_timer_cancel_unknown"); assert.throws(e.arm, /stopped/);
  assert.equal(e.state.qualificationTimer, t); assert.equal(e.state.timerCancelUnknown, true);
});
test("4-B3-C repeated cohort timing reads preserve original refs and origin", () => {
  const e = memory(); e.start(); const r = e.refs(); e.now += ms(100000);
  const timing = e.api.originalCohortTiming(e.state, r.build, r.namespace);
  assert.equal(timing.binding.started_ns, "100"); assert.equal(timing.at.monotonic_ns, String(e.now));
  const model = createUnsignedCohortAssemblyModel({ request, clock: plain(timing.binding) });
  assert.equal(model.describe().cohort_deadline_ns, e.clock.end_ns);
  e.now += ms(1000); assert.equal(e.api.originalCohortTiming(e.state, r.build, r.namespace).binding, timing.binding);
});
for (const change of ["copied_build", "copied_build_bound", "copied_namespace", "foreign_state", "unretained", "namespace_owner", "namespace_build", "record_close", "record_identity", "taint", "stopped", "phase"])
  test("4-B3-C cohort index timing rejects invalid original ownership: " + change, () => {
    const e = memory(); e.start(); const r = e.refs(); let state = e.state;
    if (change === "copied_build") r.build = {};
    // Each isolated change below leaves every other ownership check satisfied.
    if (change === "copied_build_bound") { r.build = Object.freeze({}); e.context.namespaceReferences.get(r.namespace).buildRef = r.build; }
    if (change === "unretained") e.context.retainedQualificationScopes.delete(state);
    if (change === "copied_namespace") r.namespace = {};
    if (change === "foreign_state") state = { ...e.state };
    if (change === "namespace_owner") e.context.namespaceReferences.get(r.namespace).owner = {};
    if (change === "namespace_build") e.context.namespaceReferences.get(r.namespace).buildRef = {};
    if (change === "record_close") state.recordClosed = false;
    if (change === "record_identity") state.recordIdentity = null;
    if (change === "taint") state.evidenceTainted = true;
    if (change === "stopped") state.stopped = "cc4b3b_original_stop";
    if (change === "phase") state.phase = "BUILD_BOUND";
    assert.throws(() => e.api.originalCohortTiming(state, r.build, r.namespace), /binding|stopped/); assert.equal(e.timers.length, 0);
  });
test("4-B3-C diagnostic payload and retained samples are bounded, not clock history", () => {
  const e = memory(); e.start();
  for (let i = 0; i < 1000; i++) { e.now += ms(1); e.wall++; const d = e.clock.stamp(); assert.ok(Buffer.byteLength(JSON.stringify(d)) < 512); }
  assert.deepEqual(Object.keys(e.clock.describe()).sort(), ["clock_invalid", "failure", "stop_ns"]);
  assert.equal(e.timers.length, 0);
});
test("4-B3-C connected tool closes within its original reservation and clears once", async () => {
  const e = memory(); e.start(); const result = track(e.tool()); await flush();
  assert.equal(e.spawned.length, 1); assert.equal(e.state.qualificationTimer.hasRef(), true);
  e.spawned[0].stdout.emit("data", Buffer.from("invented\n")); e.now += ms(1); e.spawned[0].emit("close", 0, null);
  const r = await result(); assert.equal(r.state, "fulfilled"); assert.equal(r.value.toString(), "invented\n"); assert.equal(e.clears.length, 1);
  assert.equal(e.state.children.size, 0); e.fire(0); assert.equal(e.state.stopped, null);
});
test("4-B3-C import wait spends original entry budget before any tool timer or spawn", async () => {
  const e = memory({ policy: { total_limit_ms: "1" } }); e.start(); const result = track(e.tool());
  e.now += ms(1); await rejected(result, /entry_deadline/);
  assert.equal(e.spawned.length, 0); assert.equal(e.timers.length, 0);
});
for (const [label, at, cause] of [["entry end", e => BigInt(e.clock.end_ns), "cc4b3c_entry_deadline"], ["sub-ms reservation", () => 100n + ms(10000) - 1n, "cc4b3c_remaining_sub_ms"]])
  test("4-B3-C spawn-start recheck keeps its primary clock refusal: " + label, async () => {
    const e = memory(); e.start(); e.onTimer = () => { e.now = at(e); }; const result = track(e.tool());
    await rejected(result, /tool_start/); assert.equal(e.state.stopped, cause);
    assert.equal(e.spawned.length, 0); assert.equal(e.clears.length, 1); assert.equal(e.state.qualificationTimer, null);
  });
test("4-B3-C connected timer timeout retains original child and accepts late close only", async () => {
  const e = memory(); e.start(); const result = track(e.tool()); await flush();
  e.now += ms(10001); e.fire(0); await rejected(result, /tool_deadline/);
  assert.equal(e.state.stopped, "cc4b3c_timer_deadline"); assert.equal(e.state.children.size, 1);
  const n = e.reads; e.spawned[0].emit("close", 23, null); e.spawned[0].emit("close", 0, null);
  assert.equal(e.reads, n); assert.equal(e.state.children.size, 0);
  assert.equal(e.state.helperDisposition.exit_code, 23); assert.equal(e.state.helperDisposition.late, true);
  await rejected(track(e.tool()), /stopped/); assert.equal(e.spawned.length, 1);
});
test("4-B3-C a tool timer capped by the original entry end reports that end as its deadline", async () => {
  const e = memory({ policy: { total_limit_ms: "5" } }); e.start(); const result = track(e.tool()); await flush();
  assert.equal(e.timers[0].delay, 5); e.now += ms(5); e.fire(0); await rejected(result, /tool_deadline/);
  assert.equal(e.state.stopped, "cc4b3c_entry_deadline"); assert.equal(e.state.timerDisposition.deadline_ns, e.clock.end_ns);
});
const timerStops = { rollback: "cc4b3c_monotonic_rollback", clock_throw: "cc4b3c_monotonic_read", unreferenced: "cc4b3c_timer_unreferenced",
  early_clear_unknown: "cc4b3c_timer_cancel_unknown", stopped: "cc4b3b_original_stop" };
for (const [cause, expected] of Object.entries(timerStops))
  test("4-B3-C a timer stop other than the deadline is not reported as a tool deadline: " + cause, async () => {
    const e = memory(); e.start(); const result = track(e.tool()); await flush();
    if (cause === "rollback") e.now = 99n;
    if (cause === "clock_throw") e.monoQueue.push(Error("invented_clock"));
    if (cause === "unreferenced") e.timers[0].ref = false;
    if (cause === "early_clear_unknown") { e.now += ms(4000); e.clearFailure = true; }
    if (cause === "stopped") e.state.stopped = expected;
    e.fire(0); await rejected(result, /tool_timer_stop/);
    assert.equal(e.state.stopped, expected); assert.equal(e.state.timerDisposition.reason, expected);
    assert.equal(e.timers.length, 1); assert.equal(e.state.children.size, 1);
  });
test("4-B3-C connected chunk/close checks reject deadline even before callback runs", async () => {
  for (const event of ["chunk", "close"]) {
    const e = memory(); e.start(); const result = track(e.tool()); await flush(); e.now += ms(10000);
    if (event === "chunk") e.spawned[0].stdout.emit("data", Buffer.from("invented")); else e.spawned[0].emit("close", 0, null);
    await rejected(result, /tool_completion/); assert.equal(e.state.stopped, "cc4b3c_timer_deadline");
    assert.equal(e.clears.length, 1); assert.equal(e.state.children.size, event === "chunk" ? 1 : 0);
  }
});
test("4-B3-C a close after the deadline is late whether or not its expiry callback ran first", async () => {
  for (const order of ["close_first", "timer_first"]) {
    const e = memory(); e.start(); const result = track(e.tool()); await flush(); e.now += ms(10000);
    if (order === "timer_first") e.fire(0);
    e.spawned[0].emit("close", 0, null); await rejected(result, order === "timer_first" ? /tool_deadline/ : /tool_completion/);
    assert.equal(e.state.helperDisposition.late, true); assert.equal(e.state.helperDisposition.exit_code, 0);
    assert.equal(e.state.stopped, "cc4b3c_timer_deadline"); assert.equal(e.state.children.size, 0); assert.equal(e.clears.length, 1);
  }
});
test("4-B3-C connected clear failure cannot resolve a successful helper", async () => {
  const e = memory(); e.start(); const result = track(e.tool()); await flush(); e.clearFailure = true;
  e.spawned[0].emit("close", 0, null); await rejected(result, /timer_cancel_unknown/);
  assert.equal(e.clears.length, 1); assert.equal(e.state.stopped, "cc4b3c_timer_cancel_unknown");
});
test("4-B3-C a tool failure stays primary when its timer cancellation is also unknown", async () => {
  for (const event of ["exit", "overflow"]) {
    const e = memory(); e.start(); const result = track(e.tool()); await flush(); e.clearFailure = true;
    if (event === "exit") e.spawned[0].emit("close", 1, null); else e.spawned[0].stdout.emit("data", Buffer.alloc(1048577));
    await rejected(result, event === "exit" ? /tool_exit/ : /tool_output_bound/);
    assert.equal(e.state.stopped, event === "exit" ? "cc4b3b_tool_exit" : "cc4b3b_tool_output_bound");
    assert.equal(e.state.timerCancelUnknown, true); assert.equal(e.clears.length, 1);
  }
});
test("4-B3-C cancellation uncertainty cannot overwrite the original timeout or lose its timer", async () => {
  const e = memory(); e.start(); const result = track(e.tool()); await flush();
  const original = e.state.qualificationTimer; e.clearFailure = true; e.now += ms(10000); e.fire(0);
  await rejected(result, /tool_deadline/); assert.equal(e.state.stopped, "cc4b3c_timer_deadline");
  assert.equal(e.state.timerCancelUnknown, true); assert.equal(e.state.qualificationTimer, original);
  e.fire(0); assert.equal(e.clears.length, 1); assert.equal(e.state.children.size, 1);
});
test("4-B3-C original B2 windows consume build time and preserve each approved phase", () => {
  const e = memory(); e.start(); const r = e.refs(); e.now += ms(100000);
  const timing = e.api.originalCohortTiming(e.state, r.build, r.namespace);
  const w = createUnsignedControllerWindowModel(plain(timing.binding)), at = () => plain(e.clock.point());
  assert.equal(w.startPreparation(at()).phase_deadline_ns, String(e.now + ms(120000)));
  e.now += ms(1000); const planned = w.inspect(at(), "command"); assert.equal(planned.operation_window_ms, "10000");
  e.now += ms(1000); assert.equal(w.submitGo(at()).phase_deadline_ns, String(e.now + ms(600000)));
  e.now += ms(1000); assert.equal(w.startSettlement(at()).phase_deadline_ns, String(e.now + ms(60000)));
  e.now += ms(1000); assert.equal(w.startTeardown(at()).phase_deadline_ns, String(e.now + ms(120000)));
  e.now += ms(1000); assert.equal(w.startReporting(at()).phase_deadline_ns, e.clock.end_ns);
});
test("4-B3-C B2 case worst-case fit uses original end not qualification readiness", () => {
  const e = memory({ policy: { total_limit_ms: "1000000" } }); e.start();
  const w = createUnsignedControllerWindowModel(plain(e.clock.binding)); e.now += ms(100000);
  assert.equal(w.canStartCase(plain(e.clock.point())).fits_supplied_cohort_window, true); e.now++;
  assert.equal(w.canStartCase(plain(e.clock.point())).fits_supplied_cohort_window, false);
  assert.throws(() => w.startPreparation(plain(e.clock.point())), /cohort_window/);
});
test("4-B3-C B2 domain/envelope failure has no recovery or new settlement grace", () => {
  for (const bad of [{ clock_domain: "foreign-worker", monotonic_ns: "100" }, { clock_domain: "parent-2s", monotonic_ns: "bad" }]) {
    const e = memory(); e.start(); const w = createUnsignedControllerWindowModel(plain(e.clock.binding));
    w.startPreparation(plain(e.clock.point())); assert.throws(() => w.inspect(bad));
    assert.equal(w.describe().clock_invalid, true); assert.throws(() => w.startSettlement(plain(e.clock.point())), /stopped/);
    assert.throws(() => w.inspect(plain(e.clock.point())), /stopped/);
  }
});
