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
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const effects = [], restores = [], blocked = [];
const replace = (o, k, f) => {
  const d = Object.getOwnPropertyDescriptor(o, k), accessor = d && !("value" in d);
  if (accessor) Object.defineProperty(o, k, { value: f, configurable: true, writable: true, enumerable: d.enumerable }); else o[k] = f;
  restores.push(() => { if (accessor) Object.defineProperty(o, k, d); else if (d) o[k] = d.value; else delete o[k]; });
};
const block = (o, keys) => keys.filter((k) => typeof o[k] === "function").forEach((k) => {
  blocked.push([o, k]); replace(o, k, function () { effects.push(k); throw Error("cc4b3a_forbidden_effect"); });
});
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]);
block(workers, ["Worker"]);
block(crypto, ["sign", "verify", "createSign", "createVerify", "createPrivateKey", "createPublicKey", "createSecretKey", "generateKey", "generateKeySync",
  "generateKeyPair", "generateKeyPairSync", "privateEncrypt", "privateDecrypt", "publicEncrypt", "publicDecrypt", "diffieHellman", "createDiffieHellman", "createECDH"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "deriveKey", "deriveBits", "encrypt", "decrypt", "wrapKey", "unwrapKey"]);
block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"]);
block(net, ["connect", "createConnection", "createServer"]); block(net.Socket.prototype, ["connect"]);
block(http, ["request", "get", "createServer"]); block(https, ["request", "get", "createServer"]);
block(http2, ["connect", "createServer", "createSecureServer"]); block(dgram, ["createSocket"]); block(tls, ["connect", "createServer"]);
block(globalThis, ["fetch", "WebSocket", "EventSource", "setTimeout", "setInterval", "setImmediate", "queueMicrotask"]);
block(Date, ["now"]); block(process.hrtime, ["bigint"]);
for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter((k) => /^(lookup|resolve|reverse)/.test(k)));
block(inspector, ["open", "Session"]);
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "ftruncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename",
  "chmod", "fchmod", "lchmod", "chown", "fchown", "lchown", "symlink", "link", "utimes", "futimes", "lutimes"];
const streams = ["ReadStream", "FileReadStream", "WriteStream", "FileWriteStream", "Utf8Stream"], scans = ["glob", "statfs", "watch", "mkdtempDisposable"];
block(fs, [...mutations, ...mutations.map((k) => k + "Sync"), "createWriteStream", ...streams, ...scans, ...scans.map((k) => k + "Sync"), "openAsBlob", "watchFile"]);
block(fsp, [...mutations, ...scans]);
const roots = ["../helpers/", "../../node_modules/"].map((s) => fileURLToPath(new URL(s, import.meta.url)));
roots.push(...roots.map((s) => fs.realpathSync(s) + sep));
const metadata = ["stat", "lstat", "readdir", "opendir", "access", "readlink", "realpath"];
const readers = [[fs, "open", (a) => a[0]], [fs, "openSync", (a) => a[0]], [fs, "readFile", (a) => a[0]?.flag], [fs, "readFileSync", (a) => a[0]?.flag],
  [fs, "createReadStream", (a) => a[0]?.flags], [fs, "exists", () => undefined], [fs, "existsSync", () => undefined],
  ...metadata.flatMap((k) => [[fs, k, () => undefined], [fs, k + "Sync", () => undefined], [fsp, k, () => undefined]]),
  [fsp, "open", (a) => a[0]], [fsp, "readFile", (a) => a[0]?.flag]];
for (const [o, k, flag] of readers) {
  if (typeof o[k] !== "function") continue;
  const original = o[k]; replace(o, k, (p, ...a) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(a);
    if ((f === undefined || f === "r" || f === 0) && roots.some((r) => full.startsWith(r))) return original.call(o, p, ...a);
    effects.push(k); throw Error("cc4b3a_forbidden_read");
  });
}
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach((f) => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });

const { describeUnsignedQualificationProfile, describeUnsignedQualificationCapacity, createUnsignedQualificationModel } = await import("../helpers/unsignedCohortQualificationContracts.mjs");
const { canonical, digest, sha } = await import("../helpers/unsignedControllerData.mjs");
const runtime = await import("../helpers/unsignedCohortRuntime.mjs");

test("4-B3-A profile declares finite separate reservations without runtime authority", () => {
  const p = describeUnsignedQualificationProfile();
  assert.equal(p.manifest_rows, 4096); assert.equal(p.page_rows, 128);
  assert.equal(p.hash_work_bytes, "2147483648"); assert.equal(p.helper_commands, 131072);
  assert.equal(p.execution_available, false); assert.equal(p.runtime_qualified, false);
  assert.equal(p.native_status, "NOT_RUN"); assert.equal(p.evidence_saved, false);
  assert.ok(Object.isFrozen(p));
});

const capacityInput = (extra = {}) => ({ rows: 4096, input_bytes: "268435456", artifact_bytes: "0", manifest_bytes: 2097152,
  record_fixed_bytes: 2097152, namespace_nodes: 32, discovery_commands: 128, ...extra });
test("4-B3-A capacity charges eight input passes, four output passes and both metadata commands", () => {
  const c = describeUnsignedQualificationCapacity(capacityInput());
  assert.equal(c.hash_work_bytes, "2147483648"); assert.equal(c.helper_commands, 65920);
  assert.equal(c.build_record_bytes, 4194304); assert.equal(c.includes_evidence_writer_work, false);
  assert.equal(c.native_budget_changed, false); assert.equal(c.runtime_qualified, false);
  const outputs = describeUnsignedQualificationCapacity(capacityInput({ input_bytes: "3", artifact_bytes: "5" }));
  assert.equal(outputs.hash_work_bytes, "44");
});
for (const [name, patch] of Object.entries({ row: { rows: 4097 }, bytes: { input_bytes: "268435457" },
  sum: { artifact_bytes: "1" }, manifest: { manifest_bytes: 2097153 }, record: { record_fixed_bytes: 2097153 },
  depth: { namespace_nodes: 33 }, discovery: { discovery_commands: 129 }, negative: { input_bytes: "-1" },
  numeric: { input_bytes: 1 }, supplied_cap: { helper_commands: 999999 } })) {
  test(`4-B3-A capacity refuses ${name} without a larger fallback`, () => assert.throws(() => describeUnsignedQualificationCapacity(capacityInput(patch))));
}

const h = "a".repeat(64);
const proof = (n, mode = "33152", uid = "501") => ({ device: "1", inode: String(n), uid, gid: "20", mode, nlink: "1", size: "5", ctime_ns: "1", mtime_ns: "1" });
const row = (path, roles, n) => ({ path, roles, identity: proof(n), sha256: h, acl: "none", profile: "plain" });
const inputs = () => [
  row("/host/compiler", ["compiler"], 1), row("/host/header", ["header"], 2), row("/host/linker", ["linker"], 3),
  row("/host/node", ["node"], 4), row("/host/sdk", ["sdk_settings"], 5), row("/host/tool", ["tool"], 6), row("/host/ubsan", ["ubsan"], 7),
  row("native/native_bar_fs/native_bar_fs.cc", ["source"], 8), row("node_modules/typescript/lib/_tsc.js", ["typescript"], 9),
  row("node_modules/zod/index.js", ["runtime"], 10), row("src/contract.ts", ["source"], 12), row("test/helpers/unsignedCohortRuntime.mjs", ["runtime"], 11),
].sort((a, b) => a.path < b.path ? -1 : 1);
const outputs = () => ["normal", "ubsan"].flatMap((mode, m) => [
  { ...row(`build/b3cc-validation/${mode}/contract.js`, [`${mode}_js`], 20 + m * 3) },
  { ...row(`build/b3cc-validation/${mode}/native-bar-fs/native_bar_fs.node`, [`${mode}_addon`], 21 + m * 3), profile: "linker_adhoc" },
  { ...row(`build/b3cc-validation/${mode}/admission-unsigned-observer`, [`${mode}_observer`], 22 + m * 3), identity: proof(22 + m * 3, "33216"), profile: "linker_adhoc" },
]).sort((a, b) => a.path < b.path ? -1 : 1);
const header = () => ({ run_id: "invented-run", signature_profile: "linker_adhoc", source_commit: "b".repeat(40), source_clean: false,
  source_status_sha256: h, uid: "501", node_version: "24.0.0", node_abi: "137", architecture: "arm64",
  clock: { clock_domain: "parent-clock", started_ns: "0", total_limit_ms: "30000000" } });
const closure = { runtime_closed: true, compiler_inputs_closed: true, host_profile: "controlled_local_os" };
const point = (ns = "1") => ({ clock_domain: "parent-clock", monotonic_ns: ns });
function prepared(customInputs = inputs(), customOutputs = outputs()) {
  const m = createUnsignedQualificationModel(header()); let ns = 1n;
  m.appendManifestPage({ ordinal: 1, rows: customInputs });
  const token = m.sealInputs({ manifest_sha256: digest(customInputs), closure });
  const observe = (kind, payload, at = point(String(ns++))) => m.observe(token, { kind, payload, at });
  for (const kind of ["build_before_normal", "build_after_normal", "build_before_ubsan", "build_after_ubsan"]) observe(kind, { pins_sha256: digest(customInputs) });
  m.appendManifestPage({ ordinal: 2, rows: customOutputs });
  m.sealManifest(token, { manifest_sha256: digest([...customInputs, ...customOutputs]), record_fixed_bytes: 4096 });
  return { m, token, observe, customInputs, customOutputs, hash: digest([...customInputs, ...customOutputs]) };
}
function namespace() {
  const roles = ["checkout", "build", "output", "reports", "run"];
  return { directory: "build/b3cc-validation/reports/invented-run", build_record_sha256: h,
    ancestors: [{ ...proof(80, "16877", "0"), flags: "0", acl: "none", metadata_complete: true }],
    nodes: roles.map((role, n) => ({ role, created: n >= 2, before: proof(100 + n, n >= 2 ? "16832" : "16877"),
      after: proof(100 + n, n >= 2 ? "16832" : "16877"), fd: { device: "1", inode: String(100 + n) }, flags: "0", acl: "none", metadata_complete: true })) };
}
function ready(s = prepared()) {
  s.observe("build_qualified", { pins_sha256: s.hash });
  s.observe("record_closed", { manifest_sha256: s.hash, record_sha256: h, readback_sha256: h,
    record_bytes: s.m.describe().capacity.build_record_bytes, fsync: "confirmed", close: "confirmed" });
  s.namespaceToken = s.observe("namespace_qualified", namespace()); return s;
}
test("4-B3-A orders input sealing, both build checks, output sealing and original record before namespace", () => {
  const s = ready();
  assert.deepEqual(Object.keys(s.token), []); assert.deepEqual(Object.keys(s.namespaceToken), []);
  assert.equal(s.m.describe().state, "NAMESPACE_FIXED");
  assert.equal(s.m.inspectIndexBinding(s.token, s.namespaceToken).supplied_owner_consistent, true);
  for (const mode of ["normal", "ubsan"]) s.observe(`${mode}_first`, { pins_sha256: s.hash });
  s.observe("final", { pins_sha256: s.hash });
  assert.equal(s.m.describe().state, "FINAL_CHECKED"); assert.equal(s.m.describe().supplied_sequence_consistent, true);
  assert.equal(s.m.describe().runtime_qualified, false); assert.equal(s.m.describe().evidence_saved, false);
  assert.throws(() => runtime.executeUnsignedCohortAssembly(s.token), /execution_not_approved/);
});

function collecting(custom = inputs()) {
  const m = createUnsignedQualificationModel(header()); m.appendManifestPage({ ordinal: 1, rows: custom });
  return { m, custom, seal: (extra = {}) => m.sealInputs({ manifest_sha256: digest(custom), closure, ...extra }) };
}
const assertStopped = (m, action) => {
  assert.throws(action); assert.equal(m.describe().state, "STOPPED");
  assert.throws(() => m.inspectWindow(point("100")), /stopped/); assert.equal(m.describe().runtime_qualified, false);
};
for (const [name, mutate] of Object.entries({ duplicate: (a) => a.push(a[0]), alias: (a) => { a[1].identity.inode = a[0].identity.inode; },
  symlink: (a) => { a[0].identity.mode = "41471"; }, allow_acl: (a) => { a[0].acl = "allow"; }, unsafe_mode: (a) => { a[0].identity.mode = "33206"; },
  extra_link: (a) => { a[0].identity.nlink = "2"; }, unknown_owner: (a) => { a[0].identity.uid = "502"; },
  oversize: (a) => { a[0].identity.size = "67108865"; }, dot_alias: (a) => { a[0].path = "/host/../compiler"; },
  double_slash: (a) => { a[0].path = "/host//compiler"; }, unknown_role: (a) => { a[0].roles = ["future"]; },
  unsigned: (a) => { a[0].profile = "unsigned"; }, unknown_field: (a) => { a[0].verified = true; },
  phase: (a) => { a[0].roles = ["normal_js"]; }, reversed: (a) => a.reverse(),
  duplicate_role: (a) => { a[0].roles = ["compiler", "compiler"]; },
})) test(`4-B3-A rejects ${name} input page and never recovers`, () => {
  const a = inputs(); mutate(a); const m = createUnsignedQualificationModel(header());
  assertStopped(m, () => m.appendManifestPage({ ordinal: 1, rows: a }));
});
for (const role of ["source", "typescript", "runtime", "node", "compiler", "linker", "header", "sdk_settings", "ubsan", "tool"])
  test(`4-B3-A missing ${role} refuses closure`, () => {
    const s = collecting(inputs().filter((r) => !r.roles.includes(role))); assertStopped(s.m, () => s.seal());
  });
test("4-B3-A incomplete closure or wrong hash cannot be repaired by a later declaration", () => {
  const s = collecting(); assertStopped(s.m, () => s.seal({ closure: { ...closure, runtime_closed: false } }));
  const q = collecting(); assertStopped(q.m, () => q.seal({ manifest_sha256: "b".repeat(64) }));
});
test("4-B3-A getters are not evaluated and a page cannot add authority options", () => {
  const m = createUnsignedQualificationModel(header()); let called = false;
  const bad = { ordinal: 1, get rows() { called = true; return inputs(); } };
  assertStopped(m, () => m.appendManifestPage(bad)); assert.equal(called, false);
  assert.throws(() => createUnsignedQualificationModel({ ...header(), approved: true }));
});
test("4-B3-A page ordinals are original and pages have independent byte and row bounds", () => {
  const m = createUnsignedQualificationModel(header()); assertStopped(m, () => m.appendManifestPage({ ordinal: 2, rows: inputs() }));
  const a = Array.from({ length: 129 }, (_, n) => row(`src/${String(n).padStart(4, "0")}.ts`, ["source"], n + 1));
  const q = createUnsignedQualificationModel(header()); assertStopped(q, () => q.appendManifestPage({ ordinal: 1, rows: a }));
  const wide = a.slice(0, 128).map((r, n) => ({ ...r, path: `src/${String(n).padStart(4, "0")}${"x".repeat(470)}.ts` }));
  assert.ok(Buffer.byteLength(canonical({ ordinal: 1, rows: wide })) > 65536);
  const z = createUnsignedQualificationModel(header()); assertStopped(z, () => z.appendManifestPage({ ordinal: 1, rows: wide }));
});
test("4-B3-A a shared source/runtime file has one physical row with sorted roles", () => {
  const a = inputs(); a.find((r) => r.path === "test/helpers/unsignedCohortRuntime.mjs").roles = ["runtime", "source"];
  const s = prepared(a); assert.equal(s.m.describe().state, "ARTIFACTS_FIXED");
});
test("4-B3-A JavaScript parity, artifact permissions and native profile are mandatory", () => {
  for (const mutate of [a => { a.find(r => r.roles[0] === "ubsan_js").sha256 = "b".repeat(64); },
    a => { a.find(r => r.roles[0] === "normal_addon").profile = "plain"; },
    a => { a.find(r => r.roles[0] === "normal_observer").identity.mode = "33152"; },
    a => { a.splice(a.findIndex(r => r.roles[0] === "ubsan_addon"), 1); }]) {
    const a = outputs(); mutate(a); assert.throws(() => prepared(inputs(), a));
  }
});
test("4-B3-A matching stale JavaScript in both modes still refuses the exact emitted set", () => {
  const a = outputs();
  for (const mode of ["normal", "ubsan"]) a.push(row(`build/b3cc-validation/${mode}/stale.js`, [`${mode}_js`], mode === "normal" ? 500 : 501));
  a.sort((x, y) => x.path < y.path ? -1 : 1); assert.throws(() => prepared(inputs(), a), /artifact_set/);
});
test("4-B3-A extension replacement compares emitted names in output order", () => {
  const a = inputs().filter(r => r.path !== "src/contract.ts");
  a.push(row("src/a.test.ts", ["source"], 300), row("src/a.ts", ["source"], 301));
  a.sort((x, y) => x.path < y.path ? -1 : 1);
  const b = outputs().filter(r => !r.roles[0].endsWith("_js"));
  for (const [n, mode] of ["normal", "ubsan"].entries())
    b.push(row(`build/b3cc-validation/${mode}/a.js`, [`${mode}_js`], 302 + n * 2),
      row(`build/b3cc-validation/${mode}/a.test.js`, [`${mode}_js`], 303 + n * 2));
  b.sort((x, y) => x.path < y.path ? -1 : 1);
  assert.equal(prepared(a, b).m.describe().state, "ARTIFACTS_FIXED");
});
test("4-B3-A input checkpoints cannot be skipped or fed output pins", () => {
  const s = collecting(), token = s.seal();
  assertStopped(s.m, () => s.m.observe(token, { kind: "build_after_normal", payload: { pins_sha256: digest(inputs()) }, at: point() }));
});
test("4-B3-A build readback and close must both succeed before namespace", () => {
  const s = prepared(); assertStopped(s.m, () => s.observe("namespace_qualified", namespace()));
  for (const patch of [{ close: "unknown" }, { fsync: "unknown" }, { readback_sha256: "b".repeat(64) }, { record_bytes: 0 }]) {
    const q = prepared(); q.observe("build_qualified", { pins_sha256: q.hash });
    assertStopped(q.m, () => q.observe("record_closed", { manifest_sha256: q.hash, record_sha256: h, readback_sha256: h,
      record_bytes: q.m.describe().capacity.build_record_bytes, fsync: "confirmed", close: "confirmed", ...patch }));
  }
});
function recordReady() {
  const s = prepared(); s.observe("build_qualified", { pins_sha256: s.hash });
  s.observe("record_closed", { manifest_sha256: s.hash, record_sha256: h, readback_sha256: h,
    record_bytes: s.m.describe().capacity.build_record_bytes, fsync: "confirmed", close: "confirmed" }); return s;
}
for (const [name, mutate] of Object.entries({ allow_acl: n => { n.nodes[4].acl = "allow"; }, inherited_acl: n => { n.ancestors[0].acl = "allow"; },
  unknown_metadata: n => { n.nodes[4].metadata_complete = false; }, flags: n => { n.nodes[4].flags = "1"; },
  owner: n => { n.nodes[4].before.uid = "502"; n.nodes[4].after.uid = "502"; },
  replacement: n => { n.nodes[4].after.inode = "999"; }, alias: n => { n.nodes[4].after.mode = "41471"; },
  fd_path: n => { n.nodes[4].fd.inode = "999"; }, reused: n => { n.nodes[4].created = false; },
  alternate: n => { n.directory = "/private/tmp/alternate"; }, wrong_record: n => { n.build_record_sha256 = "b".repeat(64); },
  wrong_order: n => { n.nodes.reverse(); }, missing: n => { n.nodes.pop(); },
})) test(`4-B3-A ${name} namespace taints and stops without replacement`, () => {
  const s = recordReady(), n = namespace(); mutate(n);
  assertStopped(s.m, () => s.observe("namespace_qualified", n)); assert.equal(s.m.describe().evidence_tainted, true);
});
test("4-B3-A directory child changes do not masquerade as a file-pin change", () => {
  const s = recordReady(), n = namespace(); n.nodes[4].after.size = "9"; n.nodes[4].after.ctime_ns = "2";
  const t = s.observe("namespace_qualified", n); assert.equal(s.m.inspectIndexBinding(s.token, t).owner_scope, "cohort_model_only");
});
test("4-B3-A copied, foreign or expired model references cannot own the shared index", () => {
  const s = ready(); assertStopped(s.m, () => s.m.inspectIndexBinding(s.token, {}));
  const a = ready(), b = ready(); assertStopped(a.m, () => a.m.inspectIndexBinding(b.token, b.namespaceToken));
  const z = ready(); z.m.stop(); assert.throws(() => z.m.inspectIndexBinding(z.token, z.namespaceToken), /stopped/);
});
test("4-B3-A original build time consumes the same cohort deadline", () => {
  const d = header(); d.clock.total_limit_ms = "1"; const m = createUnsignedQualificationModel(d);
  assert.equal(m.inspectWindow(point("0")).remaining_ms, "1");
  assertStopped(m, () => m.inspectWindow(point("1"))); assert.equal(m.describe().cohort_deadline_ns, "1000000");
});
for (const [name, p] of Object.entries({ rollback: point("0"), domain: { ...point("9"), clock_domain: "other" },
  malformed: { ...point("9"), monotonic_ns: "01" }, extra: { ...point("9"), reset: true } })) {
  test(`4-B3-A ${name} clock permanently disables progress`, () => {
    const s = ready(); assertStopped(s.m, () => s.m.inspectWindow(p)); assert.equal(s.m.describe().clock_invalid, true);
    assert.throws(() => s.observe("normal_first", { pins_sha256: s.hash }, point("999")), /stopped/);
  });
}
test("4-B3-A unknown timed envelopes cannot be corrected into resumed dispatch", () => {
  const s = ready(); assertStopped(s.m, () => s.m.observe(s.token, { kind: "unknown", payload: {}, at: point("100") }));
  assert.equal(s.m.describe().clock_invalid, true);
});
const wallSample = (before, after, utc, jst, ms) => ({ before: point(before), after: point(after), wall_ms: ms, wall_utc: utc, wall_jst: jst });
test("4-B3-A UTC/JST date rollover is descriptive and never renews the original deadline", () => {
  const s = ready(), end = s.m.describe().cohort_deadline_ns;
  const a = s.m.observeStamp(s.token, wallSample("100", "101", "1970-01-01T23:59:59.999Z", "1970-01-02T08:59:59.999+09:00", "86399999"));
  assert.equal(a.stamp.monotonic_ns, "101");
  s.m.observeStamp(s.token, wallSample("1000100", "1000101", "1970-01-02T00:00:00.000Z", "1970-01-02T09:00:00.000+09:00", "86400000"));
  assert.equal(s.m.describe().cohort_deadline_ns, end); assert.equal(s.m.describe().wall_uncertain, false);
});
test("4-B3-A backward wall labels stay factual and do not poison monotonic time", () => {
  const s = ready(); s.m.observeStamp(s.token, wallSample("100", "101", "1970-01-02T00:00:00.000Z", "1970-01-02T09:00:00.000+09:00", "86400000"));
  const a = s.m.observeStamp(s.token, wallSample("102", "103", "1970-01-01T00:00:00.000Z", "1970-01-01T09:00:00.000+09:00", "0"));
  assert.equal(a.wall_uncertain, true); assert.equal(a.stamp.wall_utc, "1970-01-01T00:00:00.000Z");
  assert.equal(s.m.describe().clock_invalid, false); assert.equal(s.m.describe().runtime_qualified, false);
});
test("4-B3-A forward wall jumps are uncertain without extending elapsed-time permission", () => {
  const s = ready(); s.m.observeStamp(s.token, wallSample("100", "101", "1970-01-01T00:00:00.000Z", "1970-01-01T09:00:00.000+09:00", "0"));
  const a = s.m.observeStamp(s.token, wallSample("102", "103", "1970-01-02T00:00:00.000Z", "1970-01-02T09:00:00.000+09:00", "86400000"));
  assert.equal(a.wall_uncertain, true);
});
test("4-B3-A invalid calendar values or mismatched UTC/JST cannot manufacture a stamp", () => {
  for (const [utc, jst, ms] of [["1970-02-30T00:00:00.000Z", "1970-03-02T09:00:00.000+09:00", "5184000000"],
    ["1970-01-01T00:00:00.000Z", "1970-01-01T08:00:00.000+09:00", "0"]]) {
    const s = ready(); assertStopped(s.m, () => s.m.observeStamp(s.token, wallSample("100", "101", utc, jst, ms)));
  }
});
test("4-B3-A effect tripwires intercept both calls and constructor syntax", () => {
  for (const [o, k] of blocked) {
    for (const invoke of [() => o[k](), () => new o[k]()]) {
      const n = effects.length; assert.throws(invoke, /forbidden_effect/); assert.equal(effects.length, n + 1); effects.pop();
    }
  }
  assert.throws(() => fs.readFileSync("/outside/forbidden"), /forbidden_read/); effects.pop();
});

test("4-B3-A 4096 physical rows fit in bounded pages without an unbounded array parser", () => {
  const a = inputs().filter(r => r.path !== "src/contract.ts");
  for (let i = 0; i < 62; i++) a.push(row(`src/file${String(i).padStart(4, "0")}.ts`, ["source"], 1000 + i));
  while (a.length < 3968) {
    const n = a.length; a.push(row(`test/helpers/invented-${String(n).padStart(4, "0")}.mjs`, ["runtime"], 10000 + n));
  }
  a.sort((x, y) => x.path < y.path ? -1 : 1);
  const b = outputs().filter(r => !r.roles[0].endsWith("_js"));
  for (const [m, mode] of ["normal", "ubsan"].entries()) for (let i = 0; i < 62; i++)
    b.push(row(`build/b3cc-validation/${mode}/file${String(i).padStart(4, "0")}.js`, [`${mode}_js`], 20000 + m * 100 + i));
  b.sort((x, y) => x.path < y.path ? -1 : 1);
  const m = createUnsignedQualificationModel(header()); let ordinal = 0;
  for (let i = 0; i < a.length; i += 128) m.appendManifestPage({ ordinal: ++ordinal, rows: a.slice(i, i + 128) });
  const token = m.sealInputs({ manifest_sha256: digest(a), closure });
  for (const [n, kind] of ["build_before_normal", "build_after_normal", "build_before_ubsan", "build_after_ubsan"].entries())
    m.observe(token, { kind, payload: { pins_sha256: digest(a) }, at: point(String(n + 1)) });
  m.appendManifestPage({ ordinal: ++ordinal, rows: b });
  m.sealManifest(token, { manifest_sha256: digest([...a, ...b]), record_fixed_bytes: 4096 });
  assert.equal(m.describe().manifest_rows, 4096); assert.ok(m.describe().manifest_bytes < 2097152);
  assert.equal(m.describe().pages, 32); assert.equal(m.describe().runtime_qualified, false);
});
test("4-B3-A exact file/pass/hash ceilings can complete only as an unqualified model", () => {
  const a = inputs(); a.forEach((r, i) => { r.identity.size = i < 4 ? "67108864" : "0"; });
  const b = outputs(); b.forEach(r => { r.identity.size = "0"; });
  const s = ready(prepared(a, b));
  for (const kind of ["normal_first", "ubsan_first", "final"]) s.observe(kind, { pins_sha256: s.hash });
  assert.equal(s.m.describe().modeled_hash_bytes, "2147483648");
  assert.ok(s.m.describe().modeled_helper_commands <= s.m.describe().capacity.helper_commands);
  assert.equal(s.m.describe().runtime_qualified, false);
});
test("4-B3-A pages cannot smuggle future output rows before the original input checks", () => {
  const s = collecting(), token = s.seal();
  assertStopped(s.m, () => s.m.appendManifestPage({ ordinal: 2, rows: outputs() }));
  assert.throws(() => runtime.executeUnsignedCohortAssembly(token), /execution_not_approved/);
});
test("4-B3-A exact deadline is a stop anchored to the original end, not the late sample", () => {
  for (const ns of ["1000000", "2000000"]) {
    const d = header(); d.clock.total_limit_ms = "1"; const m = createUnsignedQualificationModel(d);
    assertStopped(m, () => m.inspectWindow(point(ns)));
    assert.equal(m.describe().first_stop_ns, "1000000"); assert.equal(m.describe().clock_invalid, false);
  }
});
test("4-B3-A leap-day UTC and JST wall labels are computed without reading a clock", () => {
  const s = ready();
  const value = s.m.observeStamp(s.token, wallSample("100", "101", "2000-02-29T15:00:00.000Z", "2000-03-01T00:00:00.000+09:00", "951836400000"));
  assert.equal(value.stamp.wall_jst, "2000-03-01T00:00:00.000+09:00");
});

test("4-B3-A aggregate manifest bytes stop even when every individual page fits", () => {
  const m = createUnsignedQualificationModel(header()); let error;
  for (let p = 0; p < 64; p++) {
    const rows = Array.from({ length: 64 }, (_, i) => {
      const n = p * 64 + i; return row(`src/${String(n).padStart(4, "0")}${"x".repeat(440)}.ts`, ["source"], n + 1);
    });
    assert.ok(Buffer.byteLength(canonical({ ordinal: p + 1, rows })) <= 65536);
    try { m.appendManifestPage({ ordinal: p + 1, rows }); } catch (e) { error = e; break; }
  }
  assert.match(error?.message ?? "", /cc4b3a_manifest_bound/); assert.equal(m.describe().state, "STOPPED");
  assert.ok(m.describe().manifest_bytes <= 2097152);
});
test("4-B3-A rejects the 4097th short row without retaining it", () => {
  const m = createUnsignedQualificationModel(header());
  for (let page = 0; page < 32; page++) m.appendManifestPage({ ordinal: page + 1,
    rows: Array.from({ length: 128 }, (_, i) => { const n = page * 128 + i; return row(`src/${String(n).padStart(4, "0")}.ts`, ["source"], n + 1); }) });
  assert.equal(m.describe().manifest_rows, 4096);
  assertStopped(m, () => m.appendManifestPage({ ordinal: 33, rows: [row("src/4096.ts", ["source"], 4097)] }));
  assert.equal(m.describe().manifest_rows, 4096);
});
test("4-B3-A rejects the 65th single-row page without retaining it", () => {
  const m = createUnsignedQualificationModel(header());
  for (let i = 0; i < 64; i++) m.appendManifestPage({ ordinal: i + 1, rows: [row(`src/${String(i).padStart(4, "0")}.ts`, ["source"], i + 1)] });
  assert.equal(m.describe().pages, 64);
  assertStopped(m, () => m.appendManifestPage({ ordinal: 65, rows: [row("src/0064.ts", ["source"], 65)] }));
  assert.equal(m.describe().pages, 64); assert.equal(m.describe().manifest_rows, 64);
});
test("4-B3-A invalid final row cannot partially retain an otherwise valid page", () => {
  const s = collecting(), before = s.m.describe();
  const rows = [row("test/helpers/zz-a.mjs", ["runtime"], 400), row("test/helpers/zz-b.mjs", ["runtime"], 401)];
  rows[1].identity.nlink = "2";
  assertStopped(s.m, () => s.m.appendManifestPage({ ordinal: 2, rows }));
  assert.equal(s.m.describe().manifest_rows, before.manifest_rows); assert.equal(s.m.describe().manifest_bytes, before.manifest_bytes);
  assert.equal(s.m.describe().pages, before.pages);
});
test("4-B3-A deny-only ACL summaries fit the conservative namespace contract", () => {
  const s = recordReady(), n = namespace(); n.ancestors[0].acl = "deny_only"; n.nodes.forEach(p => { p.acl = "deny_only"; });
  const t = s.observe("namespace_qualified", n); assert.equal(s.m.inspectIndexBinding(s.token, t).supplied_owner_consistent, true);
});
test("4-B3-A unknown/unsafe ancestors and excessive depth refuse before namespace binding", () => {
  for (const mutate of [n => { n.ancestors[0].mode = "16895"; }, n => { n.ancestors[0].metadata_complete = false; },
    n => { n.ancestors = Array.from({ length: 28 }, (_, i) => ({ ...n.ancestors[0], inode: String(i + 1000) })); },
    n => { n.nodes[4].fd.inode = n.nodes[3].fd.inode; }]) {
    const s = recordReady(), n = namespace(); mutate(n); assertStopped(s.m, () => s.observe("namespace_qualified", n));
  }
});
test("4-B3-A copied namespace references never become runtime capabilities or saved evidence", () => {
  const s = ready();
  for (const v of [describeUnsignedQualificationProfile(), s.m.describe(), s.m.inspectIndexBinding(s.token, s.namespaceToken)])
    for (const k of ["execution_available", "cleanup_execution_available", "approval_authenticated", "ownership_verified", "evidence_saved",
      "native_release_verified", "timestamps_verified", "history_verified", "signing_available", "runtime_qualified", "runtime_completion_proven"])
      assert.equal(v[k], false, k);
  let accessed = false; const bad = { get grant() { accessed = true; return s.namespaceToken; } };
  assert.throws(() => runtime.executeUnsignedCohortAssembly(bad), /execution_not_approved/); assert.equal(accessed, false);
});
