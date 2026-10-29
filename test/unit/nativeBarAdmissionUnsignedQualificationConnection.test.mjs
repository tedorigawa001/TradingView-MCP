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
block(globalThis, ["fetch", "WebSocket", "EventSource", "setTimeout", "setInterval", "setImmediate", "queueMicrotask"]);
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
// The VM realm's own Date would read real wall time, so extracted declarations see recorders instead.
const vmRecord = name => function () { effects.push(name); throw Error("cc4b3b_forbidden_effect"); };
const vmDate = Object.assign(vmRecord("vm_Date"), { now: vmRecord("vm_now") });
blocked.push([{ Date: vmDate }, "Date"], [vmDate, "now"]);
const runtime = await import("../helpers/unsignedCohortRuntime.mjs");
const { describeUnsignedQualificationProfile, describeUnsignedQualificationCapacity } = await import("../helpers/unsignedCohortQualificationContracts.mjs");
const { canonical, digest } = await import("../helpers/unsignedControllerData.mjs");
const { describeUnsignedIsolatedBuild } = await import("../helpers/unsignedBuildPlan.mjs");
const source = fs.readFileSync(new URL("../helpers/unsignedCohortRuntime.mjs", import.meta.url), "utf8");
const tree = ts.createSourceFile("runtime.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const rootFunction = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "prepareOriginalQualification");
const declarations = rootFunction.body.statements.filter(ts.isFunctionDeclaration);
const names = declarations.map(n => n.name.text);
function functions(context, overrides = {}) {
  const text = declarations.filter(n => !Object.hasOwn(overrides, n.name.text)).map(n => n.getText()
    .replace('const { spawn } = await import("node:child_process");', 'const { spawn } = await Promise.resolve(memoryChild);')).join("\n");
  return vm.runInNewContext(`"use strict";\n${text}\n({${names.join(",")}})`, { ...context, ...overrides });
}
function memoryFs() {
  let next = 1; const nodes = new Map(), fds = new Map(), calls = [];
  const make = (file, directory = true, bytes = Buffer.alloc(0)) => {
    const node = { dev: 1n, ino: BigInt(next++), uid: 501n, gid: 20n, mode: directory ? 0o40700n : 0o100600n,
      nlink: 1n, ctimeNs: 1n, mtimeNs: 1n, content: Buffer.from(bytes), directory };
    nodes.set(file, node); return node;
  };
  const stat = n => { if (!n) throw Object.assign(Error("missing"), { code: "ENOENT" }); return { ...n, size: BigInt(n.content.length),
    isSymbolicLink: () => n.link === true, isDirectory: () => n.directory, isFile: () => !n.directory && !n.link }; };
  for (const p of ["/", "/virtual", "/virtual/repo", "/virtual/repo/build"]) make(p);
  const api = { constants: { O_RDONLY: 0, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_NOFOLLOW: 256, O_NONBLOCK: 512, O_DIRECTORY: 1024 },
    lstatSync: p => stat(nodes.get(p)), fstatSync: fd => stat(fds.get(fd)?.node),
    mkdirSync(p) { calls.push(["mkdir", p]); if (nodes.has(p)) throw Object.assign(Error("exists"), { code: "EEXIST" }); make(p); },
    openSync(p, flags) {
      calls.push(["open", p]); if (flags & 64) { if (nodes.has(p)) throw Object.assign(Error("exists"), { code: "EEXIST" }); make(p, false); }
      stat(nodes.get(p)); const fd = next++; fds.set(fd, { node: nodes.get(p) }); return fd;
    },
    closeSync(fd) { calls.push(["close", fd]); if (!fds.delete(fd)) throw Error("closed"); },
    readSync(fd, b, off, size, at) { const data = fds.get(fd).node.content, n = Math.min(size, Math.max(0, data.length - at)); data.copy(b, off, at, at + n); return n; },
    writeSync(fd, b, off, size, at) { const node = fds.get(fd).node, data = Buffer.alloc(at + size); node.content.copy(data); b.copy(data, at, off, off + size); node.content = data; node.ctimeNs++; node.mtimeNs++; return size; },
    fsyncSync(fd) { calls.push(["fsync", fd]); }, fchmodSync(fd, mode) { fds.get(fd).node.mode = 0o100000n | BigInt(mode); },
    readdirSync(p) { return [...nodes.keys()].filter(file => posix.dirname(file) === p && file !== p).map(file => posix.basename(file)); },
    opendirSync(p) { const names = api.readdirSync(p); let n = 0, closed = false; return {
      readSync() { if (closed) throw Error("closed"); return n < names.length ? { name: names[n++] } : null; },
      closeSync() { if (closed) throw Error("closed"); closed = true; calls.push(["directory_close", p]); },
    }; },
    realpathSync(p) { stat(nodes.get(p)); return p; },
  };
  return { api, make, nodes, fds, calls };
}
function environment(overrides = {}, real = []) {
  const disk = memoryFs(), states = [], masks = [], buildReferences = new WeakMap(), namespaceReferences = new WeakMap();
  const context = { Date: vmDate, fs: disk.api, path: posix, crypto: { createHash: crypto.createHash, randomBytes: () => Buffer.alloc(16, 1) },
    Buffer, TextDecoder, ts, builtinModules, canonical, digest, describeUnsignedQualificationCapacity: data => describeUnsignedQualificationCapacity(JSON.parse(JSON.stringify(data))), describeUnsignedIsolatedBuild,
    limits: describeUnsignedQualificationProfile(), root: "/virtual/repo", buildReferences, namespaceReferences, retainedQualificationScopes: new Set(),
    policy: {}, clock: { check() {}, binding: Object.freeze({ clock_domain: "invented-parent", started_ns: "0", cohort_limit_ms: "2000000" }),
      point() { return { clock_domain: "invented-parent", monotonic_ns: "100" }; } }, process: { platform: "darwin", arch: "arm64", execArgv: [], env: {}, getuid: () => 501,
      umask: n => { masks.push(n); return 0o027; }, execPath: "/host/node", version: "v24.0.0", versions: { modules: "137" } } };
  let api;
  const fakes = {
    qualifyMetadata: async (_s, file) => ({ identity: api.identity(disk.api.lstatSync(file)), aclHash: "a".repeat(64) }),
    discoverOriginalInputs: async s => { states.push(s); return { sources: [], files: [] }; },
    buildOriginalMode: async (s, mode) => { disk.calls.push(["build", mode]); s.inputs = { rows: [{ path: "src/invented.ts", bytes: "1" }], sha256: "a".repeat(64) }; },
    snapshotInputs: async s => s.inputs,
    snapshotArtifacts: async () => ({ rows: [{ path: "invented.js", bytes: "1" }], sha256: "b".repeat(64) }),
    verifyOriginalHostClosure: async () => {},
    ...overrides,
  };
  for (const name of real) delete fakes[name];
  api = functions(context, fakes); return { ...context, disk, api, states, masks };
}
test("4-B3-B public and private opening gates refuse before effects or caller access", () => {
  let accessed = false; const supplied = { get approved() { accessed = true; return true; } };
  assert.throws(() => runtime.executeUnsignedCohortAssembly(supplied), /execution_not_approved/); assert.equal(accessed, false);
  const e = environment();
  for (const name of ["originalQualificationPolicy", "verifyOriginalHostClosure", "verifyOriginalNativeProfile"])
    if (name === "verifyOriginalHostClosure") assert.throws(() => functions(e)[name](), /unavailable/);
    else assert.throws(() => e.api[name](), /unavailable/);
  assert.deepEqual(e.disk.calls, []); assert.equal(runtime.inspectUnsignedCohortAssembly().runtime_qualified, false);
});
test("4-B3-B isolated lifecycle obtains model-local references only after readback and confirmed close", async () => {
  const e = environment(), refs = await e.api.buildAndQualify();
  const s = e.buildReferences.get(refs.buildRef);
  assert.equal(s.recordClosed, true); assert.equal(s.phase, "NAMESPACE_BOUND");
  assert.equal(e.namespaceReferences.get(refs.namespaceRef).owner, s); assert.equal(e.namespaceReferences.get(refs.namespaceRef).buildRef, refs.buildRef);
  assert.ok(e.disk.calls.findIndex(c => c[0] === "fsync") < e.disk.calls.findIndex(c => c[0] === "mkdir" && c[1].endsWith("/reports")));
  assert.equal(s.record.execution_available, false); assert.equal(s.record.runtime_qualified, false);
  assert.throws(() => runtime.executeUnsignedCohortAssembly(refs), /execution_not_approved/);
});
test("4-B3-C builder returns the original cohort binding and one post-namespace point without re-granting build time", async () => {
  const e = environment(); let points = 0;
  e.clock.point = () => Object.freeze({ clock_domain: "invented-parent", monotonic_ns: String(100 + ++points) });
  const refs = await e.api.buildAndQualify();
  assert.deepEqual(Object.keys(refs).sort(), ["buildRef", "namespaceRef", "timing"]);
  assert.equal(Object.isFrozen(refs.timing), true); assert.deepEqual(Object.keys(refs.timing).sort(), ["at", "binding"]);
  assert.equal(refs.timing.binding, e.clock.binding); assert.equal(points, 1); assert.equal(refs.timing.at.monotonic_ns, "101");
});
for (const phase of ["discoverOriginalInputs", "buildOriginalMode", "snapshotInputs", "snapshotArtifacts"]) {
  test(`4-B3-B ${phase} failure cannot issue a build or namespace reference`, async () => {
    const e = environment({ [phase]: async () => { throw Error("injected_failure"); } });
    await assert.rejects(e.api.buildAndQualify(), /injected_failure/);
    assert.equal(e.disk.calls.some(c => c[0] === "mkdir" && c[1].endsWith("/reports")), false);
    assert.equal(e.disk.fds.size, 0); assert.deepEqual(e.masks, [0o077, 0o027]);
  });
}
test("4-B3-B existing output is neither adopted, repaired nor relocated", async () => {
  const e = environment(); e.disk.make("/virtual/repo/build/b3cc-validation");
  await assert.rejects(e.api.buildAndQualify(), /output_exists/); assert.deepEqual(e.disk.calls, []); assert.deepEqual(e.masks, []);
});
for (const field of ["execArgv", "platform", "env"]) test(`4-B3-B unsafe ${field} refuses before allocation`, async () => {
  const e = environment(); e.process[field] = field === "execArgv" ? ["--inspect"] : field === "env" ? { NODE_OPTIONS: "" } : "linux";
  await assert.rejects(e.api.buildAndQualify(), /startup_policy/); assert.deepEqual(e.disk.calls, []);
});
test("4-B3-B fsync failure and unknown close keep the primary error and original handle without retry", async () => {
  const e = environment(); let closes = 0; const originalClose = e.disk.api.closeSync;
  e.disk.api.fsyncSync = () => { throw Error("fsync_primary"); };
  e.disk.api.closeSync = fd => {
    if (e.disk.fds.get(fd)?.node === e.disk.nodes.get("/virtual/repo/build/b3cc-validation/build-record.json")) { closes++; throw Error("close_secondary"); }
    originalClose(fd);
  };
  await assert.rejects(e.api.buildAndQualify(), /fsync_primary/); assert.equal(closes, 1);
  const s = e.states[0]; assert.equal(s.recordClosed, false); assert.equal(s.handles.size, 1);
  assert.ok(s.failures.includes("close_unknown")); assert.equal(e.retainedQualificationScopes.size, 1);
  const before = e.disk.calls.length; await assert.rejects(e.api.buildAndQualify(), /invocation_retained/); assert.equal(e.disk.calls.length, before);
});
test("4-B3-B a successful readback with failed close still cannot qualify", async () => {
  const e = environment(), close = e.disk.api.closeSync;
  e.disk.api.closeSync = fd => {
    if (e.disk.fds.get(fd)?.node === e.disk.nodes.get("/virtual/repo/build/b3cc-validation/build-record.json")) throw Error("record_close"); close(fd);
  };
  await assert.rejects(e.api.buildAndQualify(), /record_close/); assert.equal(e.states[0].recordClosed, false);
  assert.equal(e.disk.calls.some(c => c[0] === "mkdir" && c[1].endsWith("/reports")), false);
});
test("4-B3-B byte readback mismatch and path substitution refuse the original record", async () => {
  for (const kind of ["bytes", "path"]) {
    const e = environment(), read = e.disk.api.readSync, sync = e.disk.api.fsyncSync;
    if (kind === "bytes") e.disk.api.readSync = (fd, b, offset, count, at) => { const n = read(fd, b, offset, count, at); if (n) b[offset] ^= 1; return n; };
    else e.disk.api.fsyncSync = fd => { sync(fd); e.disk.make("/virtual/repo/build/b3cc-validation/build-record.json", false); };
    await assert.rejects(e.api.buildAndQualify(), /record_(readback|identity)/); assert.equal(e.states[0].recordClosed, false);
    assert.equal(e.disk.fds.size, 0);
  }
});
test("4-B3-B umask restoration failure issues no reference and keeps its disposition", async () => {
  const e = environment(); e.process.umask = n => { if (n === 0o027) throw Error("mask_restore"); return 0o027; };
  await assert.rejects(e.api.buildAndQualify(), /mask_restore/);
  assert.ok(e.states[0].failures.includes("umask_restore_unknown")); assert.equal(e.retainedQualificationScopes.size, 1);
  assert.equal(e.states[0].phase, "STOPPED"); assert.equal(e.disk.fds.size, 0);
});
test("4-B3-B namespace collision is retained and never retried with another name", async () => {
  const e = environment({ snapshotArtifacts: async () => { e.disk.make("/virtual/repo/build/b3cc-validation/reports"); return { rows: [{ bytes: "1" }], sha256: "b".repeat(64) }; } });
  await assert.rejects(e.api.buildAndQualify(), /exists/); assert.equal(e.states[0].evidenceTainted, true);
  assert.equal(e.disk.calls.filter(c => c[0] === "mkdir" && c[1].endsWith("/reports")).length, 1);
});
test("4-B3-B saved JSON, copied references and unclosed records cannot allocate a namespace", async () => {
  const e = environment(), s = e.api.newQualificationState();
  await assert.rejects(e.api.qualifyOriginalNamespace(s, {}), /original_build_required/); assert.deepEqual(e.disk.calls, []);
});
test("4-B3-B a directory whose open fails retains known allocation without deletion", async () => {
  const e = environment(), s = e.api.newQualificationState(); e.disk.api.openSync = () => { throw Error("open_failure"); };
  await assert.rejects(e.api.createOriginalDirectory(s, s.output), /open_failure/);
  assert.equal(s.rootOwned, true); assert.equal(s.directories.has(s.output), true); assert.equal(s.directories.get(s.output).reference, null);
  assert.equal(e.disk.nodes.has(s.output), true);
});
test("4-B3-B close-only disposition works after stop without opening a replacement", () => {
  const e = environment(), s = e.api.newQualificationState(), fd = e.disk.api.openSync("/virtual/repo", 0), ref = e.api.ownHandle(s, fd, "/virtual/repo", "directory");
  s.stopped = "unknown_clock"; e.api.closeOriginal(s, ref); assert.equal(e.disk.fds.size, 0);
  assert.throws(() => e.api.closeOriginal(s, ref), /close_once/);
});
test("4-B3-B streaming reads bind FD/path, hash bytes and close exactly once", () => {
  const e = environment(), s = e.api.newQualificationState(); e.disk.make("/virtual/repo/bytes.js", false, Buffer.from("invented"));
  const r = e.api.readPinnedFile(s, "/virtual/repo/bytes.js", null, true);
  assert.equal(r.sha256, crypto.createHash("sha256").update("invented").digest("hex")); assert.equal(r.content.toString(), "invented");
  assert.equal(e.disk.fds.size, 0); assert.equal(s.hashBytes, 8n);
  assert.throws(() => e.api.readPinnedFile(s, "/virtual/repo/bytes.js", { ...r.identity, ino: "999" }), /input_changed/);
});
test("4-B3-B file/pass/total hash limits refuse before oversized reads", () => {
  const e = environment(), s = e.api.newQualificationState();
  s.hashBytes = BigInt(e.limits.hash_work_bytes); assert.throws(() => e.api.chargeHash(s, 1), /hash_work_bound/);
  const q = environment(), t = q.api.newQualificationState(); t.passBytes = BigInt(q.limits.pass_bytes);
  assert.throws(() => q.api.chargeHash(t, 1), /hash_work_bound/);
});
test("4-B3-B dependency parser accepts only the fixed bounded make target and paths", () => {
  const e = environment(); assert.equal(e.api.dependencyPaths(Buffer.from("qualification: src/a.cc \\\n /sdk/a.h\n")).length, 2);
  for (const text of ["other: src/a.cc", "qualification: ../outside", "qualification: /sdk/a\\ b.h", "qualification: $ENV", "qualification: /sdk/a.h\0"])
    assert.throws(() => e.api.dependencyPaths(Buffer.from(text)), /dependency_format/);
});
const listing = (file, flagged = false, acl = "") => Buffer.from(`drwx------ 1 user group${flagged ? " -" : ""} 0 Oct 29 10:00 ${file}\n${acl}`);
test("4-B3-B ACL/flags parser accepts deny-only and rejects allow, flags and malformed output", () => {
  const e = environment(), file = "/virtual/repo";
  assert.equal(e.api.parseMetadataListing(listing(file), file, false), e.api.parseMetadataListing(listing(file, true), file, true));
  assert.doesNotThrow(() => e.api.parseMetadataListing(listing(file, false, " 0: group:everyone inherited deny delete\n"), file, false));
  for (const bytes of [listing(file, false, " 0: group:everyone inherited allow write\n"), Buffer.from(listing(file, true).toString().replace(" - ", " uchg ")),
    Buffer.from("malformed\n"), Buffer.from([0xff, 0x0a])]) assert.throws(() => e.api.parseMetadataListing(bytes, file, true));
});
test("4-B3-B metadata identity is checked again after asynchronous listings", async () => {
  let count = 0;
  const e = environment({ runOriginalTool: async (_s, _program, args) => {
    if (++count === 2) e.disk.nodes.get(args[1]).ino++;
    return listing(args[1], args[0] === "-ldeO");
  } }, ["qualifyMetadata"]);
  await assert.rejects(e.api.qualifyMetadata(e.api.newQualificationState(), "/virtual/repo", true, 0o700n), /metadata_changed/);
});
test("4-B3-B private runtime closure is source-parsed and refuses unknown dynamic resolution", () => {
  const e = environment(), s = e.api.newQualificationState();
  e.disk.make("/virtual/repo/a.mjs", false, Buffer.from('import "./b.mjs"; export { x } from "./b.mjs";'));
  e.disk.make("/virtual/repo/b.mjs", false, Buffer.from('export const x = 1;'));
  assert.equal(e.api.runtimeClosure(s, ["/virtual/repo/a.mjs"]).length, 2);
  assert.equal(s.closureReads.size, 2);
  const q = environment(), t = q.api.newQualificationState(); q.disk.make("/virtual/repo/a.mjs", false, Buffer.from("import(computed);"));
  assert.throws(() => q.api.runtimeClosure(t, ["/virtual/repo/a.mjs"]), /runtime_resolution/);
});
test("4-B3-B native plans are fixed, private and leave the old unsigned plan unchanged", () => {
  const e = environment(), s = e.api.newQualificationState(); s.tools = { node: "/host/node", compiler: "/host/clang", sdk: "/host/sdk", headers: "/host/headers" };
  const plans = e.api.compilePlans(s, "normal"); assert.equal(plans.length, 3);
  assert.equal(plans[1].args.includes("-Wl,-no_adhoc_codesign"), false); assert.ok(plans[1].args.includes("-MD"));
  assert.ok(describeUnsignedIsolatedBuild("normal").addon.includes("-Wl,-no_adhoc_codesign"));
});
function toolEnvironment(options = {}) {
  const instance = new EventEmitter(); instance.stdout = new EventEmitter(); instance.stderr = new EventEmitter();
  for (const stream of [instance.stdout, instance.stderr]) stream.pause = () => { stream.paused = true; };
  let cancelled = 0, spawned = 0;
  const e = environment({ armOriginalQualificationTimer: () => ({ cancel: () => { cancelled++; }, hasRef: () => true, check() {} }) });
  const context = { ...e, memoryChild: { spawn: () => { spawned++; return instance; } } };
  const api = functions(context, { armOriginalQualificationTimer: () => ({ cancel: () => { cancelled++; }, hasRef: () => true, check() {} }), ...options });
  return { ...e, api, instance, cancelled: () => cancelled, spawned: () => spawned };
}
// Invented children settle synchronously, so bounded microtask turns replace waits that could hang on a lost settlement.
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function track(promise) {
  const r = { state: "pending" };
  promise.then(value => Object.assign(r, { state: "fulfilled", value }), error => Object.assign(r, { state: "rejected", error }));
  return async () => { await flush(); return r; };
}
async function rejected(settle, pattern) { const r = await settle(); assert.equal(r.state, "rejected"); assert.match(r.error.message, pattern); }
test("4-B3-B bounded tool transport settles only from its original child", async () => {
  const e = toolEnvironment(), s = e.api.newQualificationState(), result = track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata"));
  await flush();
  e.instance.stdout.emit("data", Buffer.from("invented")); e.instance.emit("close", 0, null);
  const r = await result(); assert.equal(r.state, "fulfilled"); assert.equal(r.value.toString(), "invented"); assert.equal(s.helper, null); assert.equal(e.cancelled(), 1);
});
test("4-B3-B overflow pauses and retains the child without signal, retry or forgetting it", async () => {
  const e = toolEnvironment(), s = e.api.newQualificationState(), result = track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata"));
  await flush();
  e.instance.stdout.emit("data", Buffer.alloc(1048577)); await rejected(result, /tool_output_bound/);
  assert.equal(s.children.size, 1); assert.equal(s.helper, e.instance); assert.equal(e.instance.stdout.paused, true);
  await rejected(track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata")), /stopped/); assert.equal(e.spawned(), 1);
  e.instance.emit("close", 1, null); assert.equal(s.children.size, 0); assert.notEqual(s.stopped, null);
});
test("4-B3-B tripwires intercept calls and constructors without actual effects", () => {
  for (const [o, k] of blocked) for (const invoke of [() => o[k](), () => new o[k]()]) {
    const n = effects.length; assert.throws(invoke, /forbidden_effect/); assert.equal(effects.length, n + 1); effects.pop();
  }
});
function discoveryEnvironment(onMetadata = null, realMetadata = false) {
  const e = environment({ ...realMetadata ? {} : { qualifyMetadata: async (s, file) => {
    onMetadata?.(s, file, e);
    return { identity: e.api.identity(e.disk.api.lstatSync(file)), aclHash: "a".repeat(64) };
  } }, runOriginalTool: async (s, program, args, kind) => {
    // The real transport starts with this same checkpoint; real metadata qualification lists through it.
    if (realMetadata) { e.api.checkpoint(s); if (program === "/bin/ls") return listing(args[1], args[0] === "-ldeO"); }
    s.commands++; if (kind === "discovery") s.discoveryCommands++;
    if (program === "/usr/bin/xcrun") return Buffer.from(args.includes("--find") ? "/host/bin/clang\n" : "/host/sdk\n");
    if (program === "/usr/bin/git") return Buffer.from(args.includes("rev-parse") ? "a".repeat(40) + "\n" : "?? invented\0");
    if (args[0] === "-print-prog-name=ld") return Buffer.from("/host/bin/ld\n");
    if (args[0] === "-print-file-name=libclang_rt.ubsan_osx_dynamic.dylib") return Buffer.from("/host/lib/ubsan\n");
    if (args[0] === "-print-resource-dir") return Buffer.from("/host/resource\n");
    if (args.includes("--listFilesOnly")) { e.typedListCalls++; return Buffer.from(e.typedPaths.join("\n") + "\n"); }
    if (args.includes("-M")) return Buffer.from(`qualification: ${args.at(-1)} /host/include/node/node_api.h /host/sdk/used.h\n`);
    throw Error("unexpected_tool");
  } }, ["discoverOriginalInputs", "snapshotInputs", ...realMetadata ? ["qualifyMetadata"] : []]);
  for (const p of ["/bin", "/usr", "/usr/bin", "/host", "/host/bin", "/host/lib", "/host/sdk", "/host/resource", "/host/include", "/host/include/node",
    "/virtual/repo/src", "/virtual/repo/native", "/virtual/repo/native/native_bar_fs", "/virtual/repo/test", "/virtual/repo/test/helpers",
    "/virtual/repo/node_modules", "/virtual/repo/node_modules/typescript", "/virtual/repo/node_modules/typescript/lib", "/virtual/repo/node_modules/typescript/bin", "/virtual/repo/node_modules/zod"]) e.disk.make(p);
  for (const p of ["/bin/ls", "/usr/bin/xcrun", "/usr/bin/git", "/host/bin/node", "/host/bin/clang", "/host/bin/ld", "/host/lib/ubsan", "/host/sdk/SDKSettings.json", "/host/sdk/used.h", "/host/include/node/node_api.h",
    "/virtual/repo/src/a.ts", "/virtual/repo/native/native_bar_fs/native_bar_fs.cc", "/virtual/repo/native/native_bar_fs/admission_unsigned_observer.cc",
    "/virtual/repo/node_modules/typescript/lib/typescript.js", "/virtual/repo/node_modules/typescript/lib/tsc.js", "/virtual/repo/node_modules/typescript/lib/_tsc.js",
    "/virtual/repo/node_modules/typescript/bin/tsc", "/virtual/repo/node_modules/zod/package.json", "/virtual/repo/node_modules/typescript/package.json",
    "/virtual/repo/tsconfig.json", "/virtual/repo/package.json", "/virtual/repo/package-lock.json"]) e.disk.make(p, false, Buffer.from("invented"));
  e.disk.make("/virtual/repo/test/helpers/unsignedCohortRuntime.mjs", false, Buffer.from('import "zod";'));
  e.disk.make("/virtual/repo/native/native_bar_fs/test_unsigned_cohort_worker.mjs", false, Buffer.from("export const x = 1;"));
  e.disk.make("/virtual/repo/node_modules/zod/index.js", false, Buffer.from("export const z = 1;"));
  e.typedPaths = ["/virtual/repo/src/a.ts"]; e.typedListCalls = 0; e.process.execPath = "/host/bin/node"; return e;
}
test("4-B3-B discovery keeps complete declared file/role sets and non-null tool identities", async () => {
  const e = discoveryEnvironment(), s = e.api.newQualificationState(), input = await e.api.discoverOriginalInputs(s);
  assert.equal(s.tools.linker, "/host/bin/ld"); assert.equal(s.sourceIdentity.dirty, true);
  assert.ok(input.files.includes("/host/sdk/used.h")); assert.ok(input.files.includes("/virtual/repo/node_modules/zod/index.js"));
  assert.ok(input.roleMap.get("/host/bin/node").has("node"));
  assert.ok(input.roleMap.get("/bin/ls").has("tool")); assert.ok(input.roleMap.get("/usr/bin/git").has("tool"));
  s.inputs = await e.api.snapshotInputs(s, input); assert.equal(s.inputs.rows.length, input.files.length);
  assert.ok(s.inputs.rows.every(r => r.sha256.length === 64 && r.roles.length > 0));
});
test("4-B3-B a changed module cannot slip between AST discovery and its first full snapshot", async () => {
  const e = discoveryEnvironment(), s = e.api.newQualificationState(), input = await e.api.discoverOriginalInputs(s);
  e.disk.nodes.get("/virtual/repo/node_modules/zod/index.js").content = Buffer.from("export const z = 2;");
  await assert.rejects(e.api.snapshotInputs(s, input), /runtime_closure_changed/);
});
test("4-B3-B later source additions are not adopted into the sealed input set", async () => {
  const e = discoveryEnvironment(), s = e.api.newQualificationState(), input = await e.api.discoverOriginalInputs(s);
  s.inputs = await e.api.snapshotInputs(s, input); e.disk.make("/virtual/repo/src/new.ts", false, Buffer.from("new"));
  await assert.rejects(e.api.snapshotInputs(s, input), /source_set_changed/);
});
test("4-B3-B unknown metadata cannot qualify a private file by POSIX mode alone", async () => {
  const e = environment({ runOriginalTool: async () => Buffer.from("unknown\n") }, ["qualifyMetadata"]);
  await assert.rejects(e.api.qualifyMetadata(e.api.newQualificationState(), "/virtual/repo", true, 0o700n), /metadata_listing/);
});
test("4-B3-B unreferenced timer prevents the first spawn", async () => {
  const e = toolEnvironment({ armOriginalQualificationTimer: () => ({ cancel() {}, hasRef: () => false, check() {} }) }), s = e.api.newQualificationState();
  await rejected(track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata")), /timer_unreferenced/); assert.equal(e.spawned(), 0);
});
test("4-B3-C an unreferenced tool timer is stopped before cancellation can replace its cause", async () => {
  const e = toolEnvironment({ armOriginalQualificationTimer: s => ({ cancel() { s.stopped ??= "cc4b3c_timer_cancel_unknown"; }, hasRef: () => false, check() {} }) });
  const s = e.api.newQualificationState();
  await rejected(track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata")), /timer_unreferenced/);
  assert.equal(s.stopped, "cc4b3b_timer_unreferenced"); assert.equal(e.spawned(), 0);
});
test("4-B3-B an original helper timeout retains its child and records later exit only", async () => {
  let timeout;
  const e = toolEnvironment({ armOriginalQualificationTimer: (_s, _kind, expired) => { timeout = expired; return { cancel() {}, hasRef: () => true, check() {} }; } });
  const s = e.api.newQualificationState(), result = track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata"));
  await flush();
  timeout("cc4b3c_timer_deadline"); await rejected(result, /tool_deadline/); assert.equal(s.helper, e.instance);
  e.instance.emit("close", 0, null); assert.equal(s.children.size, 0); assert.equal(s.phase, "STOPPED");
});
test("4-B3-B a missing pipe still keeps error/close handlers on the original child", async () => {
  const e = toolEnvironment(), s = e.api.newQualificationState(); e.instance.stdout = null;
  const result = track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata"));
  await rejected(result, /tool_pipe/); assert.equal(s.children.size, 1);
  e.instance.emit("error", Error("late")); e.instance.emit("close", 1, null); assert.equal(s.children.size, 0);
});
test("4-B3-B a record that gains another link never qualifies even with matching bytes", async () => {
  const e = environment(), sync = e.disk.api.fsyncSync;
  e.disk.api.fsyncSync = fd => { sync(fd); e.disk.fds.get(fd).node.nlink = 2n; };
  await assert.rejects(e.api.buildAndQualify(), /unsafe_metadata/); assert.equal(e.states[0].recordClosed, false);
});
test("4-B3-B failed invocations stay one-attempt even when all handles closed", async () => {
  const e = environment({ discoverOriginalInputs: async () => { throw Error("first_failure"); } });
  await assert.rejects(e.api.buildAndQualify(), /first_failure/); assert.equal(e.disk.fds.size, 0);
  const count = e.disk.calls.length; await assert.rejects(e.api.buildAndQualify(), /invocation_retained/); assert.equal(e.disk.calls.length, count);
});
function artifactEnvironment(extra = {}, real = []) {
  const e = environment({ verifyOriginalNativeProfile: async () => {}, ...extra }, ["snapshotArtifacts", ...real]), s = e.api.newQualificationState();
  s.rootOwned = true; s.inputs = { rows: [] }; e.disk.make(s.output);
  for (const mode of ["normal", "ubsan"]) {
    const base = `${s.output}/${mode}`; e.disk.make(base); e.disk.make(`${base}/native-bar-fs`);
    e.disk.make(`${base}/a.js`, false, Buffer.from("invented")); e.disk.make(`${base}/a.test.js`, false, Buffer.from("invented"));
    e.disk.make(`${base}/native-bar-fs/native_bar_fs.node`, false, Buffer.from("model-native-bytes"));
    const observer = e.disk.make(`${base}/admission-unsigned-observer`, false, Buffer.from("model-native-bytes")); observer.mode = 0o100700n;
  }
  return { e, s, input: { sources: ["/virtual/repo/src/a.test.ts", "/virtual/repo/src/a.ts"] } };
}
test("4-B3-B exact artifact set and cross-mode JS hashes use mapped output order", async () => {
  const { e, s, input } = artifactEnvironment(), result = await e.api.snapshotArtifacts(s, input);
  assert.equal(result.rows.length, 8); assert.equal(e.disk.fds.size, 0);
});
test("4-B3-B extra, missing and different mode output bytes refuse without a fallback", async () => {
  for (const change of [({ e, s }) => e.disk.make(`${s.output}/normal/stale.js`, false),
    ({ e, s }) => e.disk.nodes.delete(`${s.output}/ubsan/a.js`),
    ({ e, s }) => { e.disk.nodes.get(`${s.output}/ubsan/a.js`).content = Buffer.from("changed"); }]) {
    const x = artifactEnvironment(); change(x); await assert.rejects(x.e.api.snapshotArtifacts(x.s, x.input), /artifact_set|javascript_parity/);
  }
});
test("4-B3-B native profile proof cannot be replaced by a matching hash or saved descriptor", async () => {
  const { e, s, input } = artifactEnvironment();
  const api = functions(e, { qualifyMetadata: async (_s, file) => ({ identity: e.api.identity(e.disk.api.lstatSync(file)) }) });
  await assert.rejects(api.snapshotArtifacts(s, input), /signature_qualification_unavailable/);
});
test("4-B3-B post-readback metadata awaits cannot admit changed record bytes or size", async () => {
  for (const append of [true, false]) {
    let recordChecks = 0;
    const e = environment({ qualifyMetadata: async (_s, file) => {
      if (file.endsWith("/build-record.json") && ++recordChecks === 2) {
        const n = e.disk.nodes.get(file);
        if (append) n.content = Buffer.concat([n.content, Buffer.from("extra")]); else n.content[0] ^= 1;
        n.ctimeNs++; n.mtimeNs++;
      }
      return { identity: e.api.identity(e.disk.api.lstatSync(file)), aclHash: "a".repeat(64) };
    } });
    await assert.rejects(e.api.buildAndQualify(), /record_identity/);
    assert.equal(e.disk.calls.some(c => c[0] === "mkdir" && c[1].endsWith("/reports")), false);
  }
});
test("4-B3-B namespace construction rechecks the closed original record before binding", async () => {
  const e = environment({ qualifyMetadata: async (_s, file) => {
    if (file.endsWith("/reports")) { const n = e.disk.nodes.get("/virtual/repo/build/b3cc-validation/build-record.json"); n.content[0] ^= 1; n.ctimeNs++; }
    return { identity: e.api.identity(e.disk.api.lstatSync(file)), aclHash: "a".repeat(64) };
  } });
  await assert.rejects(e.api.buildAndQualify(), /record_changed/); assert.equal(e.states[0].evidenceTainted, true);
});
test("4-B3-B late helper close preserves its original outcome once without resuming", async () => {
  let timeout;
  const e = toolEnvironment({ armOriginalQualificationTimer: (_s, _kind, expired) => { timeout = expired; return { cancel() {}, hasRef: () => true, check() {} }; } });
  const s = e.api.newQualificationState(), result = track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata"));
  await flush();
  timeout("cc4b3c_timer_deadline"); await rejected(result, /tool_deadline/); const stopped = s.stopped;
  e.instance.emit("close", 23, null);
  assert.equal(s.helperDisposition?.exit_code, 23); assert.equal(s.helperDisposition?.late, true);
  assert.equal(s.helperDisposition?.command_ordinal, 1); assert.equal(s.stopped, stopped);
  e.instance.emit("close", 99, "SIGTERM"); assert.equal(s.helperDisposition.exit_code, 23);
});
test("4-B3-B addon permission failure keeps its primary error when close is also unknown", async () => {
  const { e, s, input } = artifactEnvironment(), node = e.disk.nodes.get(`${s.output}/normal/native-bar-fs/native_bar_fs.node`);
  node.mode = 0o100700n; e.disk.api.fchmodSync = () => { throw Error("chmod_primary"); };
  const close = e.disk.api.closeSync; let closes = 0;
  e.disk.api.closeSync = fd => { if (e.disk.fds.get(fd)?.node === node) { closes++; throw Error("close_secondary"); } close(fd); };
  await assert.rejects(e.api.snapshotArtifacts(s, input), /chmod_primary/);
  e.api.closeRemaining(s); assert.equal(closes, 1); assert.ok(s.failures.includes("close_unknown"));
});
test("4-B3-B TypeScript input-set changes refuse both before first pinning and after sealing", async () => {
  for (const sealed of [false, true]) {
    const e = discoveryEnvironment(), s = e.api.newQualificationState(), input = await e.api.discoverOriginalInputs(s);
    if (sealed) s.inputs = await e.api.snapshotInputs(s, input);
    e.disk.nodes.get("/virtual/repo/tsconfig.json").content = Buffer.from('{"compilerOptions":{"lib":["es2026"]}}');
    e.typedPaths.push("/virtual/repo/node_modules/typescript/lib/lib.es2026.d.ts");
    await assert.rejects(e.api.snapshotInputs(s, input), /typescript_closure_changed/);
  }
});
test("4-B3-B artifact capacity checks include the enriched row before retaining it", async () => {
  const first = artifactEnvironment(), projected = await first.e.api.snapshotArtifacts(first.s, first.input);
  const x = artifactEnvironment();
  // A synthetic prefix reaches the exact canonical-byte boundary without any filesystem allocation.
  const overhead = Buffer.byteLength(canonical([{ padding: "" }, ...projected.rows]));
  x.s.inputs.rows = [{ padding: "x".repeat(x.e.limits.manifest_bytes - overhead + 1) }];
  assert.equal(Buffer.byteLength(canonical([...x.s.inputs.rows, ...projected.rows])), x.e.limits.manifest_bytes + 1);
  await assert.rejects(x.e.api.snapshotArtifacts(x.s, x.input), /manifest_bound/);
});
test("4-B3-B concurrent import continuations cannot acquire a second helper slot", async () => {
  const e = toolEnvironment(), s = e.api.newQualificationState();
  const first = track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata"));
  const second = track(e.api.runOriginalTool(s, "/bin/ls", ["-lde", "/virtual/repo"], "metadata"));
  await Promise.resolve(); const spawned = e.spawned();
  e.instance.stdout.emit("data", Buffer.from("invented")); e.instance.emit("close", 0, null);
  assert.equal((await first()).state, "fulfilled");
  assert.equal(spawned, 1); await rejected(second, /tool_busy/);
  assert.equal(s.helperDisposition.command_ordinal, 1);
});
test("4-B3-B the second TypeScript recheck detects a change during snapshot collection", async () => {
  let changed = false;
  const e = discoveryEnvironment((_s, file, env) => {
    if (!changed && file.endsWith("/tsconfig.json")) {
      changed = true; env.disk.nodes.get(file).content = Buffer.from('{"compilerOptions":{"lib":["es2026"]}}');
      env.typedPaths.push("/virtual/repo/node_modules/typescript/lib/lib.es2026.d.ts");
    }
  });
  const s = e.api.newQualificationState(), input = await e.api.discoverOriginalInputs(s);
  await assert.rejects(e.api.snapshotInputs(s, input), /typescript_closure_changed/); assert.equal(changed, true);
  assert.equal(e.typedListCalls, 3);
});
// Timers cannot interrupt a blocked synchronous call: the deadline is placed right after each OS return in turn,
// and only close or umask-restore cleanup may run before the next clock check refuses.
const osReturns = ["lstatSync", "fstatSync", "mkdirSync", "openSync", "closeSync", "readSync", "writeSync", "fsyncSync", "fchmodSync", "realpathSync", "opendirSync"];
function lateAfterReturn(e, at) {
  const after = []; let returns = 0, late = false;
  const count = (name, f) => (...a) => { if (late) after.push(name); try { return f(...a); } finally { if (++returns === at) late = true; } };
  for (const k of osReturns) e.disk.api[k] = count(k, e.disk.api[k]);
  const opendir = e.disk.api.opendirSync;
  e.disk.api.opendirSync = (...a) => { const d = opendir(...a); return { readSync: count("streamReadSync", () => d.readSync()), closeSync: count("streamCloseSync", () => d.closeSync()) }; };
  const umask = e.process.umask; e.process.umask = m => count(m === 0o077 ? "umask_set" : "umask_restore", umask)(m);
  e.clock.check = () => { if (late) throw Error("cc4b3c_entry_deadline"); };
  return { after: () => after.filter(k => !["closeSync", "streamCloseSync", "umask_restore"].includes(k)), returns: () => returns };
}
async function everyLateReturn(make, run) {
  const dry = make(), counted = lateAfterReturn(dry, 0); await run(dry);
  for (let at = 1; at <= counted.returns(); at++) {
    const e = make(), probe = lateAfterReturn(e, at);
    await assert.rejects(run(e), /cc4b3c_entry_deadline/, `OS return ${at}`); assert.deepEqual(probe.after(), [], `OS return ${at}`);
  }
  return counted.returns();
}
const listedTool = e => async (s, _program, args) => { e.api.checkpoint(s); return listing(args[1], args[0] === "-ldeO"); };
test("4-B3-C every late OS return in build, record and namespace allocation stops before its next action", async () => {
  const make = () => { const e = environment({ runOriginalTool: (...a) => listedTool(e)(...a) }, ["qualifyMetadata"]); return e; };
  assert.ok(await everyLateReturn(make, e => e.api.buildAndQualify()) > 50);
});
test("4-B3-C every late OS return in input discovery and snapshots stops before its next action", async () => {
  const run = async e => { const s = e.api.newQualificationState(), input = await e.api.discoverOriginalInputs(s); s.inputs = await e.api.snapshotInputs(s, input); };
  // An empty input skips the chunk loop, so its end-of-file read follows the descriptor check directly.
  const make = () => { const e = discoveryEnvironment(null, true); e.disk.nodes.get("/virtual/repo/package-lock.json").content = Buffer.alloc(0); return e; };
  assert.ok(await everyLateReturn(make, run) > 100);
});
test("4-B3-C every late OS return in artifact snapshots, including permission repair, stops before its next action", async () => {
  const make = () => {
    const x = artifactEnvironment({ runOriginalTool: (...a) => listedTool(x.e)(...a) }, ["qualifyMetadata"]);
    x.e.disk.nodes.get(`${x.s.output}/normal/native-bar-fs/native_bar_fs.node`).mode = 0o100700n; x.e.s = x.s; x.e.input = x.input; return x.e;
  };
  assert.ok(await everyLateReturn(make, e => e.api.snapshotArtifacts(e.s, e.input)) > 50);
});
