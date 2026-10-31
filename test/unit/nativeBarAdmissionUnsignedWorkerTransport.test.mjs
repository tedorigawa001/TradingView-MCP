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


const { createUnsignedWorkerTransportModel, createUnsignedWorkerLifetimeModel, describeUnsignedWorkerTransportCapacity } = await import("../helpers/unsignedWorkerTransportContracts.mjs");
const { createUnsignedControllerProtocolModel } = await import("../helpers/unsignedControllerContracts.mjs");
const { createUnsignedCohortAssemblyModel } = await import("../helpers/unsignedCohortAssemblyModel.mjs");
const { describeUnsignedFixture } = await import("../helpers/jointUnsignedAcceptanceContracts.mjs");
const { createUnsignedProtocolDecoder } = await import("../helpers/unsignedAdapterSupport.mjs");
const { canonical, digest, sha, flags } = await import("../helpers/unsignedControllerData.mjs");
const { planUnsignedParentReservation, planUnsignedParentCheckpoint, assessUnsignedParentCallback } = await import("../helpers/unsignedParentConnectionContracts.mjs");
const runtime = await import("../helpers/unsignedCohortRuntime.mjs");
const h = "a".repeat(64), resources = { fds: "4", roots: "0", workspace: "0", retained: "0" }, baselineValue = { resources, clock_domain: "worker-clock" };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = (case_id = "u1-unsigned", mode = "normal") => ({ request: {
  schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run", source_commit: "a".repeat(40), patch_sha256: "b".repeat(64) },
  case_id, mode, fixture_name: "native-bar-fs-synthetic-Ab123Z",
  ids: Object.fromEntries(["fixture", "store", "epoch", "authority", "key", "reference", "extra"].map((s, n) => [s, id(n + 1)])) });
const allocation = (case_id, mode) => ({ fixture: (({ fixture_name, ...f }) => f)(fixture(case_id, mode)), exchange_id: "exchange-1", launch_nonce: "nonce-1",
  source_tree_sha256: h, signature_profile: "linker_adhoc", artifacts: Object.fromEntries(["js_set_sha256", "addon_sha256", "observer_sha256", "controller_sha256", "worker_sha256",
    "runtime_closure_sha256", "node_binary_sha256", "build_record_sha256", "reader_source_sha256", "reader_js_sha256"].map((k) => [k, h])) });
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
const nondata = (f) => { const { data: _data, ...rest } = configuration(f).binding.registration.bindings; return rest; };
const suppliedFor = (f) => { const s = configuration(f).binding.registration; s.bindings.data.inode = "999"; return s; };

const point = n => ({ clock_domain: "parent-clock", monotonic_ns: String(n) });
const clock = { clock_domain: "parent-clock", started_ns: "0", cohort_limit_ms: "2000000" };
const model = (options = {}) => createUnsignedWorkerTransportModel({ allocation: allocation(), clock, allocated_at: point(1), ...options });
function driver() {
  const m = model(); let ns = 2n;
  const tick = () => point(ns++), at = n => { ns = BigInt(n) + 1n; return point(n); };
  const plan = (kind, payload = {}, binding) => m.planCommand({ kind, payload, ...(binding ? { binding } : {}), at: tick() });
  const write = op => { m.startWrite(op.reference, { at: tick() }); m.noteBackpressure(op.reference, { backpressure: false });
    m.completeWrite(op.reference, { outcome: "completed", at: tick() }); return op; };
  const receive = (kind, payload, binding = m.describe().binding) => m.receive({ at: tick(),
    line: canonical({ binding, direction: "worker", ordinal: m.describe().next_ordinals.worker, kind, payload }) + "\n" });
  return { m, tick, at, plan, write, receive };
}
function ready(s = driver()) {
  s.write(s.plan("LAUNCH")); s.receive("READY", { addon_protocol: 6, mode: "synthetic_only",
    pins_sha256: digest(s.m.describe().binding), worker_clock_domain: "worker-clock" }); return s;
}
function baselined(s = ready()) {
  s.write(s.plan("PREPARE", { configuration: configuration(fixture()), launch_nonce: "nonce-1" }, { ...s.m.describe().binding, setup: setup() }));
  s.receive("BASELINED", baselineValue); return s;
}
const goPayload = s => ({ baseline_sha256: s.m.describe().baseline_sha256, baseline_readback: true, go_intent_readback: true });
const active = () => { const s = baselined(); s.write(s.plan("GO", goPayload(s))); return s; };
const release = s => ({ baseline_sha256: s.m.describe().baseline_sha256, resources, query: "settled", native: "settled",
  original_operation_retired: true, query_released: true, close_errors: [], diagnostic_sha256: h, observation_sha256: null,
  trace_chunks: s.m.describe().trace_chunks, trace_events: s.m.describe().trace_events, trace_sha256: s.m.describe().trace_sha256,
  primary_code: "oracle_unsigned", requests_dispatched: 1, authenticated_requests: 0, c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null });
test("B4-A effect guards intercept constructors and calls without real clocks/ports/workers", async () => {
  for (const [o,k] of blocked) { const n = effects.length; assert.throws(() => new o[k](), /forbidden_effect/); assert.equal(effects.length, n + 1); effects.pop(); }
  if (resolution) { const n = effects.length; await assert.rejects(import("node:sqlite"), /forbidden_effect/); assert.deepEqual(effects.splice(n), ["node:sqlite"]); }
});
test("B4-A imported runtime stays sealed and all authority flags stay false", () => {
  const m = model(), l = createUnsignedWorkerLifetimeModel({ session_id: "invented" });
  for (const value of [m.describe(), l.describe(), m.capacity()]) for (const [k,v] of Object.entries(flags()))
    if (typeof v === "boolean") assert.equal(value[k], false, k);
  let touched = false; assert.throws(() => runtime.executeUnsignedCohortAssembly({ get approval() { touched = true; } }), /execution_not_approved/);
  assert.equal(touched, false);
});
test("B4-A exact capacity reserves wire buffers separately without changing any native bound", () => {
  const c = describeUnsignedWorkerTransportCapacity(allocation());
  assert.ok(c.diagnostic_ceiling_bytes <= 16384); assert.equal(c.command_slots, 1); assert.equal(c.command_records, 5);
  assert.equal(c.lifetime_work_records, 37); assert.equal(c.lifetime_pairs, 1); assert.equal(c.lifetime_ports, 2);
  assert.equal(c.retained_buffer_bytes, Object.values(c.retained_buffers).reduce((a,b) => a+b,0));
  assert.equal(c.transient_buffer_bytes, 2 * 32 * 65536 + 65536);
  assert.ok(c.serialization.frame_kind_ceilings.READY < 65536); assert.ok(c.serialization.frame_kind_ceilings.FAILED < 65536);
  assert.equal(c.serialization.index_reserved_bytes, 4096 + 24 * 5290); assert.equal(c.native_budget_changed, false);
  // The documented figures, so a dropped buffer or field cannot pass as a smaller self-consistent total.
  assert.equal(c.retained_buffer_bytes, 2375680); assert.equal(c.transient_buffer_bytes, 4259840); assert.equal(c.diagnostic_ceiling_bytes, 9274);
  assert.equal(c.serialization.frame_kind_ceilings.READY, 2214);
  const a = allocation("u0-unavailable"), b2 = createUnsignedCohortAssemblyModel({ request: a.fixture.request, clock }); b2.beginCase({ allocation: a, at: point(1) });
  assert.equal(b2.describe().capacity.diagnostic_ceiling_bytes, 16161); assert.equal(b2.describe().capacity.coordinator_json_ceiling_bytes, 47087);
});
for (const [name, scalar, count] of [["escaped scalar", "\0".repeat(262144), 4], ["escaped aggregate", "\0".repeat(10000), 4],
  ["plain aggregate", "x".repeat(9000), 8], ["lone surrogate aggregate", "\ud800".repeat(10000), 4]])
  test("B4-A encoded preflight rejects " + name + " before scalar serialization", () => {
    const s = driver(), original = JSON.stringify; let serialized = 0, failure = null;
    JSON.stringify = function(value, ...args) { if (value === scalar) { serialized++; throw Error("scalar_serialized_before_bound"); } return original(value, ...args); };
    try { s.m.planCommand({ kind: "LAUNCH", payload: Array(count).fill(scalar), at: s.tick() }); }
    catch (error) { failure = error; } finally { JSON.stringify = original; }
    assert.match(failure?.message ?? "no refusal", /cc4b4a_frame_bound/); assert.equal(serialized, 0);
    assert.equal(s.m.describe().frames, 0); assert.equal(s.m.describe().writes.length, 0);
  });
for (const bad of [{ clock: { ...clock, cohort_limit_ms: "0" } }, { clock: { ...clock, cohort_limit_ms: "9".repeat(30) } },
  { allocated_at: point(1100000000001n) }, { allocated_at: { ...point(1), clock_domain: "foreign" } }, { allocated_at: point(-1) },
  { allocation: { ...allocation(), extra: true } }, { clock: { ...clock, backend: {} } }])
  test("B4-A malformed or insufficient invocation bounds refuse: " + JSON.stringify(bad).slice(0,90), () => assert.throws(() => model(bad)));
test("B4-A preparation includes earlier build time and preserves original total end", () => {
  const m = model({ allocated_at: point(100000000000n) });
  assert.equal(m.describe().cohort_deadline_ns, "2000000000000"); assert.equal(m.describe().phase_deadline_ns, "220000000000");
});
test("B4-A command planning retains one fixed canonical line, hash and original reservation", () => {
  const s = driver(), op = s.plan("LAUNCH"); assert.ok(Object.isFrozen(op.reference));
  const row = s.m.describe().writes[0]; assert.equal(row.sha256, sha(op.line)); assert.equal(row.bytes, Buffer.byteLength(op.line));
  assert.equal(op.line, canonical(JSON.parse(op.line)) + "\n"); assert.equal(s.m.describe().go_submitted, false);
  assert.throws(() => s.plan("LAUNCH"), /command_busy/); assert.ok(s.m.describe().stopped);
});
test("B4-A copied and foreign command references cannot start a write", () => {
  for (const ref of [{}, driver().plan("LAUNCH").reference]) { const s = driver(); s.plan("LAUNCH"); assert.throws(() => s.m.startWrite(ref, { at: s.tick() }), /reference/); }
});
test("B4-A frame arriving after write start but before callback does not complete that write", () => {
  const s = driver(), op = s.plan("LAUNCH"); s.m.startWrite(op.reference, { at: s.tick() });
  s.receive("READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(s.m.describe().binding), worker_clock_domain: "worker-clock" });
  assert.equal(s.m.describe().writes[0].callback, null); assert.equal(s.m.describe().protocol_state, "READY");
  s.m.completeWrite(op.reference, { outcome: "completed", at: s.tick() }); assert.equal(s.m.describe().writes[0].callback, "completed");
});
test("B4-A backpressure is one return fact, not a resend or completed callback", () => {
  const s = driver(), op = s.plan("LAUNCH"); s.m.startWrite(op.reference, { at: s.tick() });
  s.m.noteBackpressure(op.reference, { backpressure: true }); assert.equal(s.m.describe().frames, 1);
  assert.equal(s.m.describe().writes[0].callback, null); s.m.completeWrite(op.reference, { outcome: "completed", at: s.tick() });
  assert.equal(s.m.describe().writes.length, 1);
});
for (const action of ["start", "return", "callback"]) test("B4-A original write " + action + " is one-attempt", () => {
  const s = driver(), op = s.plan("LAUNCH"); s.write(op);
  const again = action === "start" ? () => s.m.startWrite(op.reference, { at: s.tick() })
    : action === "return" ? () => s.m.noteBackpressure(op.reference, { backpressure: false })
    : () => s.m.completeWrite(op.reference, { outcome: "completed", at: s.tick() });
  assert.throws(again); assert.ok(s.m.describe().stopped);
});
test("B4-A original reservation cannot renew after time spent before write-start", () => {
  const s = driver(), op = s.plan("LAUNCH");
  assert.throws(() => s.m.startWrite(op.reference, { at: s.at(op.deadline_ns) }), /write_deadline/);
  assert.equal(s.m.describe().writes[0].started, false); assert.equal(s.m.describe().writes[0].deadline_ns, op.deadline_ns);
});
test("B4-A unstarted reservation expiry stays the first stop even when observed later", () => {
  const s = active(), op = s.plan("CANCEL");
  s.m.stop({ reason: "later_stop", at: s.at(BigInt(op.deadline_ns) + 1000000000n) });
  assert.equal(s.m.describe().settlement_start_ns, op.deadline_ns);
  assert.equal(s.m.describe().writes.at(-1).started, false); assert.equal(s.m.describe().stopped, "write_deadline");
});
test("B4-A a delayed callback latches the original write deadline and records completion only as late fact", () => {
  const s = driver(), op = s.plan("LAUNCH"); s.m.startWrite(op.reference, { at: s.tick() });
  s.m.completeWrite(op.reference, { outcome: "completed", at: s.at(BigInt(op.deadline_ns) + 10000000000n) });
  const d = s.m.describe(); assert.equal(d.stopped, "write_deadline"); assert.equal(d.settlement_start_ns, op.deadline_ns);
  assert.equal(d.writes[0].decision, "uncertain"); assert.equal(d.writes[0].callback, "completed"); assert.equal(d.writes[0].callback_at, null);
});
test("B4-A GO planning does not start the original query window; original write-start does", () => {
  const s = baselined(), op = s.plan("GO", goPayload(s)); assert.equal(s.m.describe().phase, "preparation"); assert.equal(s.m.describe().go_submitted, false);
  const at = s.tick(); s.m.startWrite(op.reference, { at }); assert.equal(s.m.describe().phase, "query");
  assert.equal(s.m.describe().phase_deadline_ns, String(BigInt(at.monotonic_ns) + 600000000000n));
});
for (const bad of [null, "", "worker domain", "x".repeat(49)]) test("B4-A READY refuses invalid domain: " + String(bad), () => {
  const s = driver(); s.write(s.plan("LAUNCH"));
  assert.throws(() => s.receive("READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(s.m.describe().binding), worker_clock_domain: bad }));
});
test("B4-A READY old shape or parent domain never silently downgrades", () => {
  for (const domain of [undefined, "parent-clock"]) {
    const s = driver(); s.write(s.plan("LAUNCH")); const p = { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(s.m.describe().binding) };
    if (domain !== undefined) p.worker_clock_domain = domain; assert.throws(() => s.receive("READY", p));
    assert.ok(s.m.describe().stopped);
  }
});
test("B4-A BASELINED is bound to READY domain, not the first later trace", () => {
  const s = ready(); s.write(s.plan("PREPARE", { configuration: configuration(fixture()), launch_nonce: "nonce-1" }, { ...s.m.describe().binding, setup: setup() }));
  assert.throws(() => s.receive("BASELINED", { resources, clock_domain: "other-worker" }), /baseline_clock_domain/);
});
for (const issue of ["foreign", "rollback"]) test("B4-A TRACE_CHUNK preserves READY domain and worker-local order: " + issue, () => {
  const s = active(), event = (ordinal,ns,domain="worker-clock") => ({ ordinal,api:"begin",edge:"begin",clock_domain:domain,monotonic_ns:ns,code:null,byte_count:"0",sha256:null });
  s.receive("TRACE_CHUNK", { chunk_index:0, events:[event(1,"10")] });
  assert.throws(() => s.receive("TRACE_CHUNK", { chunk_index:1, events:[event(2,issue==="rollback"?"9":"11",issue==="foreign"?"foreign":"worker-clock")] }), /trace_order/);
  assert.ok(s.m.describe().stopped);
});
test("B4-A explicit null binding is not silently replaced by the current binding", () => {
  const s=driver(); assert.throws(()=>s.m.planCommand({kind:"LAUNCH",payload:{},binding:null,at:s.tick()}),/binding_changed/);
  assert.equal(s.m.describe().frames,0);
});
test("B4-A repeated READY and wrong bindings/ordinals stop instead of a new session", () => {
  for (const kind of ["repeat", "binding", "ordinal"]) {
    const s = ready(), p = { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(s.m.describe().binding), worker_clock_domain: "worker-clock" };
    if (kind === "repeat") assert.throws(() => s.receive("READY", p));
    else { const f = { binding: s.m.describe().binding, direction: "worker", ordinal: s.m.describe().next_ordinals.worker, kind: "BASELINED", payload: baselineValue };
      if (kind === "binding") f.binding = { ...f.binding, launch_nonce: "other" }; else f.ordinal++;
      assert.throws(() => s.m.receive({ line: canonical(f) + "\n", at: s.tick() })); }
    assert.ok(s.m.describe().stopped);
  }
});
test("B4-A uncertain GO delivery spends submission and permits only original channel close", () => {
  const s = baselined(), op = s.plan("GO", goPayload(s)); s.m.startWrite(op.reference, { at: s.tick() });
  s.m.completeWrite(op.reference, { outcome: "uncertain", at: s.tick() });
  const decision = s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true });
  assert.equal(decision.decision, "CLOSE_ONLY"); assert.equal(s.m.describe().go_submitted, true);
  s.m.closeCommand({ outcome: "confirmed" }); assert.throws(() => s.m.closeCommand({ outcome: "confirmed" }), /close_order/);
});
test("B4-A original uncertainty arriving after stop still prevents shutdown CANCEL", () => {
  for (const kind of ["GO", "CANCEL"]) {
    const s = kind === "GO" ? baselined() : active(), op = s.plan(kind, kind === "GO" ? goPayload(s) : {});
    s.m.startWrite(op.reference, { at: s.tick() }); const stoppedAt = s.tick();
    s.m.stop({ reason: "original_stop", at: stoppedAt }); const deadline = s.m.describe().phase_deadline_ns;
    s.m.completeWrite(op.reference, { outcome: "uncertain", at: null });
    assert.equal(s.m.describe().writes.at(-1).decision, "uncertain");
    assert.equal(s.m.describe().stopped, "original_stop"); assert.equal(s.m.describe().phase_deadline_ns, deadline);
    assert.equal(s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }).decision, "CLOSE_ONLY");
  }
});
test("B4-A a qualified parent point survives protocol validation failure for original cancellation", () => {
  const s = active(), at = s.tick();
  assert.throws(() => s.m.receive({ at, line: canonical({ binding: s.m.describe().binding, direction: "worker", ordinal: s.m.describe().next_ordinals.worker,
    kind: "TRACE_CHUNK", payload: { chunk_index: 0, events: [{ ordinal: 1, api: "begin", edge: "begin", clock_domain: "foreign-worker",
      monotonic_ns: "1", code: null, byte_count: "0", sha256: null }] } }) + "\n" }), /trace_order/);
  assert.equal(s.m.describe().clock_invalid, false); assert.equal(s.m.describe().settlement_start_ns, at.monotonic_ns);
  assert.equal(s.m.describe().phase_deadline_ns, String(BigInt(at.monotonic_ns) + 60000000000n));
  // A normal rejection freezes late intake only; it is not invalid late traffic.
  assert.equal(s.m.describe().late_capture.capture, "frozen");
  assert.equal(s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }).decision, "CANCEL_THEN_CLOSE");
});
test("B4-P2 a transport-level normal receive rejection also freezes intake without closing the CANCEL lane", () => {
  const s = active(), p = s.m.describe();
  assert.throws(() => s.m.receive({ at: s.tick(), line: canonical({ binding: p.binding, direction: "parent", ordinal: p.next_ordinals.parent, kind: "CANCEL", payload: {} }) + "\n" }),
    /receive_direction/);
  assert.equal(s.m.describe().late_capture.capture, "frozen"); assert.equal(s.m.describe().frames, p.frames);
  assert.equal(s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }).decision, "CANCEL_THEN_CLOSE");
});
test("B4-P2 a refused parent command and later unexamined traffic keep the original CANCEL lane", () => {
  const s = active(); assert.throws(() => s.plan("LAUNCH"), /protocol_order/); const p = s.m.describe();
  assert.equal(p.late_capture.capture, "frozen"); assert.ok(p.settlement_start_ns);
  const line = canonical({ binding: p.binding, direction: "worker", ordinal: p.next_ordinals.worker, kind: "TRACE_CHUNK",
    payload: { chunk_index: 0, events: [{ ordinal: 1, api: "begin", edge: "begin", clock_domain: "worker-clock", monotonic_ns: "1", code: null, byte_count: "0", sha256: null }] } }) + "\n";
  assert.throws(() => s.m.receive({ line }), /late_closed/); s.m.refuseReceive({ reason: "decoder_failure" });
  assert.equal(s.m.describe().late_capture.capture, "frozen"); assert.equal(s.m.describe().late_frames.length, 0);
  const op = s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }); assert.equal(op.decision, "CANCEL_THEN_CLOSE");
  s.m.startWrite(op.reference, { at: s.tick() }); assert.equal(s.m.describe().writes.at(-1).started, true);
});
test("B4-A stopped known GO has at most one original shutdown CANCEL on the same ledger", () => {
  const s = active(); s.m.stop({ reason: "invented_stop", at: s.tick() });
  const op = s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true });
  assert.equal(op.decision, "CANCEL_THEN_CLOSE"); s.write(op); s.m.closeCommand({ outcome: "confirmed" });
  assert.equal(s.m.describe().writes.filter(w => w.kind === "CANCEL").length, 1); assert.equal(s.m.describe().protocol_state, "STOPPED");
});
test("B4-A a planned but unstarted CANCEL reuses its reference and ordinal after stop", () => {
  const s = active(), op = s.plan("CANCEL"); s.m.stop({ reason: "invented_stop", at: s.tick() });
  const next = s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true });
  assert.equal(next.reference, op.reference); assert.equal(next.line, op.line); assert.equal(s.m.describe().writes.length, 4);
});
test("B4-A a close-only shutdown plan cannot be retried later into CANCEL permission", () => {
  const s = active(); s.m.stop({ reason: "invented_stop", at: s.tick() });
  assert.equal(s.m.planShutdown({ at: null, worker_live: true, pipe_qualified: true }).decision, "CLOSE_ONLY");
  assert.throws(() => s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }), /shutdown_once/);
  assert.equal(s.m.describe().writes.filter(w => w.kind === "CANCEL").length, 0);
});
for (const issue of ["no_go", "unqualified_pipe", "worker_gone", "clock_missing", "expired_grace"])
  test("B4-A shutdown is close-only without original timed permission: " + issue, () => {
    const s = issue === "no_go" ? ready() : active(); s.m.stop({ reason: "invented_stop", at: issue === "clock_missing" ? null : s.tick() });
    const at = issue === "expired_grace" ? s.at(BigInt(s.m.describe().phase_deadline_ns) + 1n) : issue === "clock_missing" ? null : s.tick();
    assert.equal(s.m.planShutdown({ at, worker_live: issue !== "worker_gone", pipe_qualified: issue !== "unqualified_pipe" }).decision, "CLOSE_ONLY");
  });
for (const bad of [point(0), { clock_domain: "foreign", monotonic_ns: "2" }, { clock_domain: "parent-clock", monotonic_ns: "bad" }])
  test("B4-A bad clock irreversibly stops and untimed original completion remains recordable: " + JSON.stringify(bad), () => {
    const s = driver(), op = s.plan("LAUNCH"); s.m.startWrite(op.reference, { at: s.tick() });
    assert.throws(() => s.m.receive({ line: "{}\n", at: bad }));
    s.m.completeWrite(op.reference, { outcome: "completed", at: null }); assert.equal(s.m.describe().writes[0].callback_at, null);
    assert.throws(() => s.plan("PREPARE", {})); assert.ok(s.m.describe().clock_invalid);
  });
for (const bad of [point(0), { clock_domain: "foreign", monotonic_ns: "999999999999" }])
  test("B4-A a bad callback clock stops before progress, so FINALIZE cannot reach DONE: " + bad.clock_domain, () => {
    const s = active(); s.receive("RELEASED", release(s)); s.m.noteTeardown({ action: "started", at: s.tick() });
    s.m.noteTeardown({ action: "confirmed", at: s.tick(), proof: { receipt_readback: true, anchor_same: true, root_removed: true, absent: true, worker_live: true } });
    const op = s.plan("FINALIZE"); s.m.startWrite(op.reference, { at: s.tick() }); s.m.completeWrite(op.reference, { outcome: "completed", at: bad });
    const d = s.m.describe(), w = d.writes.at(-1); assert.equal(d.stopped, "cc4b4a_clock_order"); assert.equal(d.clock_invalid, true);
    assert.deepEqual([w.decision, w.callback, w.callback_at], ["started", "completed", null]);
    s.m.closeCommand({ outcome: "confirmed" }); s.m.workerExit({ exit_code: 0, signal: null }); assert.equal(s.m.describe().protocol_state, "STOPPED");
  });
for (const late of ["timely", "late", "untimed"]) test("B4-A a GO callback after an unrelated stop keeps its original deadline: " + late, () => {
  const s = baselined(), op = s.plan("GO", goPayload(s)); s.m.startWrite(op.reference, { at: s.tick() }); s.m.stop({ reason: "invented_stop", at: s.tick() });
  const at = late === "timely" ? s.tick() : late === "late" ? s.at(BigInt(op.deadline_ns) + 5000000000n) : null;
  s.m.completeWrite(op.reference, { outcome: "completed", at });
  const d = s.m.describe(), w = d.writes.at(-1); assert.equal(d.stopped, "invented_stop"); assert.equal(d.pending_generation, null);
  assert.deepEqual([w.decision, w.callback_at?.monotonic_ns ?? null, d.clock_invalid],
    late === "timely" ? ["started", at.monotonic_ns, false] : late === "late" ? ["uncertain", null, false] : ["started", null, true]);
  assert.equal(s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }).decision, late === "timely" ? "CANCEL_THEN_CLOSE" : "CLOSE_ONLY");
  assert.equal(s.m.describe().frames, late === "timely" ? 6 : 5);
});
test("B4-A shutdown planning waits for an outstanding original callback without spending a plan, frame or ordinal", () => {
  const s = baselined(), op = s.plan("GO", goPayload(s)); s.m.startWrite(op.reference, { at: s.tick() }); s.m.stop({ reason: "invented_stop", at: s.tick() });
  const before = s.m.describe(), shutdown = () => s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true });
  assert.throws(shutdown, /command_busy/); const after = s.m.describe();
  assert.deepEqual([after.frames, after.next_ordinals, after.shutdown_attempted, after.stopped], [before.frames, before.next_ordinals, false, "invented_stop"]);
  s.m.completeWrite(op.reference, { outcome: "completed", at: s.tick() });
  const plan = shutdown(); assert.equal(plan.decision, "CANCEL_THEN_CLOSE"); s.write(plan);
  assert.equal(s.m.describe().writes.filter(w => w.kind === "CANCEL").length, 1); assert.throws(shutdown, /shutdown_once/);
});
test("B4-A an original callback that never arrives cannot hold shutdown past its deadline", () => {
  const s = baselined(), op = s.plan("GO", goPayload(s)); s.m.startWrite(op.reference, { at: s.tick() }); s.m.stop({ reason: "invented_stop", at: s.tick() });
  assert.equal(s.m.planShutdown({ at: s.at(op.deadline_ns), worker_live: true, pipe_qualified: true }).decision, "CLOSE_ONLY");
  assert.equal(s.m.describe().writes.at(-1).decision, "uncertain"); assert.equal(s.m.describe().frames, 5);
});
for (const left of [0n, 500000n]) test("B4-A a reusable CANCEL that could no longer start is not offered to the shutdown lane: " + left, () => {
  const s = active(), op = s.plan("CANCEL"); s.m.stop({ reason: "invented_stop", at: s.tick() });
  const plan = s.m.planShutdown({ at: s.at(BigInt(op.deadline_ns) - left), worker_live: true, pipe_qualified: true });
  assert.deepEqual([plan.decision, plan.reference], ["CLOSE_ONLY", null]); assert.equal(s.m.describe().writes.at(-1).started, false);
});
test("B4-A a sub-millisecond write-start refusal anchors settlement at its observation, not the future deadline", () => {
  const s = active(), op = s.plan("CANCEL"), seen = BigInt(op.deadline_ns) - 500000n;
  assert.throws(() => s.m.startWrite(op.reference, { at: s.at(seen) }), /write_deadline/);
  const d = s.m.describe(); assert.equal(d.stopped, "write_deadline"); assert.equal(d.settlement_start_ns, String(seen));
  assert.equal(d.phase_deadline_ns, String(seen + 60000000000n));
});
for (const late of [false, true]) test("B4-A the shutdown CANCEL's own callback settles only that write: " + (late ? "late" : "timely"), () => {
  const s = active(); s.m.stop({ reason: "invented_stop", at: s.tick() });
  const op = s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }); s.m.startWrite(op.reference, { at: s.tick() });
  s.m.completeWrite(op.reference, { outcome: "completed", at: late ? s.at(op.deadline_ns) : s.tick() });
  const w = s.m.describe().writes.at(-1); assert.equal(w.shutdown, true); assert.equal(w.decision, late ? "uncertain" : "completed");
  assert.equal(w.callback_at === null, late); assert.equal(s.m.describe().stopped, "invented_stop");
});
test("B4-A an explicit stop observed after the phase deadline records that deadline first", () => {
  const s = active(), deadline = BigInt(s.m.describe().phase_deadline_ns);
  s.m.stop({ reason: "later_stop", at: s.at(deadline + 5000000000n) });
  assert.equal(s.m.describe().stopped, "phase_deadline"); assert.equal(s.m.describe().settlement_start_ns, String(deadline));
});
test("B4-A receive refuses lone surrogates before decode re-canonicalizes them", () => {
  const s = ready(), original = JSON.stringify; let serialized = 0, failure = null;
  JSON.stringify = function(value, ...args) { if (typeof value === "string" && !value.isWellFormed()) { serialized++; throw Error("lone_surrogate_serialized"); } return original(value, ...args); };
  try { s.m.receive({ line: '{"note":"' + "\ud800".repeat(21000) + '"}\n', at: s.tick() }); }
  catch (error) { failure = error; } finally { JSON.stringify = original; }
  assert.match(failure?.message ?? "no refusal", /cc4b4a_encoding/); assert.equal(serialized, 0); assert.equal(s.m.describe().frames, 2);
});
test("B4-A normal release/finalize uses existing teardown model without granting actual cleanup", () => {
  const s = active(); s.receive("RELEASED", release(s)); s.m.noteTeardown({ action: "started", at: s.tick() });
  s.m.noteTeardown({ action: "confirmed", at: s.tick(), proof: { receipt_readback: true, anchor_same: true, root_removed: true, absent: true, worker_live: true } });
  s.write(s.plan("FINALIZE")); s.m.closeCommand({ outcome: "confirmed" }); s.m.workerExit({ exit_code: 0, signal: null });
  assert.equal(s.m.describe().protocol_state, "DONE"); assert.equal(s.m.describe().cleanup_execution_available, false);
});
test("B4-P1 normal RELEASED drains only the original reserved CANCEL without a new ordinal or deadline", () => {
  const s = active(), op = s.plan("CANCEL"), planned = s.m.describe(), original = planned.writes.at(-1);
  s.receive("RELEASED", release(s)); const released = s.m.describe();
  assert.equal(released.protocol_state, "RELEASED"); assert.equal(released.pending_generation, original.generation);
  assert.equal(released.writes.at(-1).started, false); assert.equal(released.writes.at(-1).callback, null);
  s.write(op); const drained = s.m.describe();
  assert.equal(drained.protocol_state, "RELEASED"); assert.equal(drained.stopped, null);
  assert.equal(drained.frames, released.frames); assert.deepEqual(drained.next_ordinals, released.next_ordinals);
  assert.deepEqual(drained.writes.at(-1), { ...original, started: true, decision: "completed", callback: "completed", callback_at: drained.writes.at(-1).callback_at, backpressure: false });
  assert.equal(drained.writes.at(-1).sha256, sha(op.line)); assert.equal(drained.writes.at(-1).deadline_ns, op.deadline_ns);
  assert.equal(drained.settlement_start_ns, released.settlement_start_ns); assert.equal(drained.phase_deadline_ns, released.phase_deadline_ns);
  s.m.noteTeardown({ action: "started", at: s.tick() });
  s.m.noteTeardown({ action: "confirmed", at: s.tick(), proof: { receipt_readback: true, anchor_same: true, root_removed: true, absent: true, worker_live: true } });
  const final = s.plan("FINALIZE"); assert.equal(JSON.parse(final.line).ordinal, JSON.parse(op.line).ordinal + 1);
  s.write(final); s.m.closeCommand({ outcome: "confirmed" }); s.m.workerExit({ exit_code: 0, signal: null });
  assert.equal(s.m.describe().protocol_state, "DONE"); assert.equal(s.m.describe().writes.length, 5);
  for (const [k, v] of Object.entries(flags())) if (typeof v === "boolean") assert.equal(s.m.describe()[k], false, k);
});
for (const started of [false, true]) test("B4-P1 cleanup cannot precede the original CANCEL callback: " + started, () => {
  const s = active(), op = s.plan("CANCEL"); s.receive("RELEASED", release(s));
  if (started) s.m.startWrite(op.reference, { at: s.tick() });
  const before = s.m.describe();
  assert.throws(() => s.m.noteTeardown({ action: "started", at: s.tick() }), /cancel_unsettled/);
  const after = s.m.describe(); assert.equal(after.phase, "settlement");
  assert.equal(after.phase_deadline_ns, before.phase_deadline_ns); assert.equal(after.writes.at(-1).callback, null);
  assert.equal(after.pending_generation, before.pending_generation);
});
test("B4-P1 the last full millisecond of the original CANCEL reservation can drain without renewal", () => {
  const s = active(), op = s.plan("CANCEL"), end = BigInt(op.deadline_ns);
  s.m.receive({ line: canonical({ binding: s.m.describe().binding, direction: "worker", ordinal: s.m.describe().next_ordinals.worker,
    kind: "RELEASED", payload: release(s) }) + "\n", at: s.at(end - 2000000n) });
  const before = s.m.describe(); s.m.startWrite(op.reference, { at: s.at(end - 1000000n) });
  s.m.completeWrite(op.reference, { outcome: "completed", at: s.at(end - 1n) }); const d = s.m.describe();
  assert.equal(d.stopped, null); assert.equal(d.writes.at(-1).deadline_ns, op.deadline_ns);
  assert.equal(d.phase_deadline_ns, before.phase_deadline_ns); assert.equal(d.settlement_start_ns, before.settlement_start_ns);
});
test("B4-P1 a CANCEL started before release still waits for its own original callback", () => {
  const s = active(), op = s.plan("CANCEL"); s.m.startWrite(op.reference, { at: s.tick() });
  s.receive("RELEASED", release(s)); const before = s.m.describe();
  assert.equal(before.pending_generation, before.writes.at(-1).generation); assert.equal(before.writes.at(-1).callback, null);
  s.m.completeWrite(op.reference, { outcome: "completed", at: s.tick() }); const d = s.m.describe();
  assert.equal(d.pending_generation, null); assert.equal(d.stopped, null); assert.equal(d.protocol_state, "RELEASED");
  assert.equal(d.phase_deadline_ns, before.phase_deadline_ns); assert.equal(d.writes.at(-1).deadline_ns, op.deadline_ns);
  s.m.noteTeardown({ action: "started", at: s.tick() }); assert.equal(s.m.describe().phase, "teardown");
});
test("B4-P1 backpressure after release never allocates a second CANCEL or a completed callback", () => {
  const s = active(), op = s.plan("CANCEL"); s.receive("RELEASED", release(s)); s.m.startWrite(op.reference, { at: s.tick() });
  s.m.noteBackpressure(op.reference, { backpressure: true }); const before = s.m.describe();
  assert.equal(before.writes.at(-1).callback, null); assert.equal(before.writes.at(-1).decision, "started");
  s.m.completeWrite(op.reference, { outcome: "completed", at: s.tick() }); const d = s.m.describe();
  assert.equal(d.writes.at(-1).backpressure, true); assert.equal(d.frames, before.frames); assert.deepEqual(d.next_ordinals, before.next_ordinals);
  assert.equal(d.writes.length, 4); assert.equal(d.stopped, null);
});
for (const left of [999999n, 0n, -1n]) test("B4-P1 release cannot extend the original CANCEL write-start reservation: " + left, () => {
  const s = active(), op = s.plan("CANCEL"), end = BigInt(op.deadline_ns); s.receive("RELEASED", release(s));
  const before = s.m.describe(); assert.throws(() => s.m.startWrite(op.reference, { at: s.at(end - left) }), /write_deadline/);
  const d = s.m.describe(); assert.equal(d.writes.at(-1).started, false); assert.equal(d.writes.at(-1).deadline_ns, op.deadline_ns);
  assert.equal(d.frames, before.frames); assert.equal(d.settlement_start_ns, before.settlement_start_ns);
  assert.equal(s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }).decision, "CLOSE_ONLY");
});
test("B4-P1 release first observed after the reserved CANCEL deadline never opens the exception", () => {
  const s = active(), op = s.plan("CANCEL"), before = s.m.describe();
  s.m.receive({ at: s.at(BigInt(op.deadline_ns) + 1n), line: canonical({ binding: before.binding, direction: "worker",
    ordinal: before.next_ordinals.worker, kind: "RELEASED", payload: release(s) }) + "\n" });
  const d = s.m.describe(); assert.equal(d.protocol_state, "STOPPED"); assert.equal(d.frames, before.frames + 1);
  assert.deepEqual(d.next_ordinals, { ...before.next_ordinals, worker: before.next_ordinals.worker + 1 }); assert.equal(d.settlement_start_ns, op.deadline_ns);
  assert.equal(d.stopped, "write_deadline"); assert.equal(d.late_capture.diagnostic_only, true);
  assert.equal(d.writes.at(-1).callback, null); assert.equal(d.writes.at(-1).started, false);
});
for (const fault of ["rollback", "foreign", "unavailable", "stop"]) test("B4-P1 post-release CANCEL is not a clock/stop bypass: " + fault, () => {
  const s = active(), op = s.plan("CANCEL"); s.receive("RELEASED", release(s)); const before = s.m.describe();
  if (fault === "stop") s.m.stop({ reason: "original_stop", at: s.tick() });
  const at = fault === "rollback" ? point(0) : fault === "foreign" ? { ...s.tick(), clock_domain: "foreign-clock" } : fault === "unavailable" ? null : s.tick();
  assert.throws(() => s.m.startWrite(op.reference, { at })); const d = s.m.describe();
  assert.ok(d.stopped); assert.equal(d.writes.at(-1).started, false); assert.equal(d.writes.at(-1).deadline_ns, op.deadline_ns);
  assert.deepEqual(d.next_ordinals, before.next_ordinals); assert.equal(d.frames, before.frames);
  assert.throws(() => s.m.startWrite(op.reference, { at: s.tick() }));
});
for (const outcome of ["uncertain", "late_completed"]) test("B4-P1 drained CANCEL callback never converts uncertain delivery into cleanup: " + outcome, () => {
  const s = active(), op = s.plan("CANCEL"); s.receive("RELEASED", release(s)); s.m.startWrite(op.reference, { at: s.tick() });
  s.m.completeWrite(op.reference, { outcome: outcome === "uncertain" ? "uncertain" : "completed",
    at: outcome === "uncertain" ? s.tick() : s.at(op.deadline_ns) });
  const d = s.m.describe(); assert.equal(d.writes.at(-1).decision, "uncertain"); assert.ok(d.stopped);
  assert.equal(s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }).decision, "CLOSE_ONLY");
  assert.throws(() => s.m.noteTeardown({ action: "started", at: s.tick() }));
  assert.equal(s.m.describe().writes.length, 4); assert.equal(s.m.describe().cleanup_execution_available, false);
});
for (const mutate of [p => ({ ...p, baseline_sha256: "b".repeat(64) }), p => ({ ...p, resources: { ...p.resources, fds: "5" } }),
  p => ({ ...p, close_errors: ["close_refused"] }), p => ({ ...p, query_released: false }), p => ({ ...p, observation_sha256: "b".repeat(64) })])
  test("B4-P1 an invalid release cannot qualify the original CANCEL", () => {
    const s = active(), op = s.plan("CANCEL"), before = s.m.describe(); assert.throws(() => s.receive("RELEASED", mutate(release(s))));
    assert.throws(() => s.m.startWrite(op.reference, { at: s.tick() }));
    assert.equal(s.m.describe().writes.at(-1).started, false); assert.equal(s.m.describe().frames, before.frames);
  });
test("B4-P1 a foreign RELEASED binding cannot qualify the reserved original CANCEL", () => {
  const s = active(), op = s.plan("CANCEL"), before = s.m.describe();
  assert.throws(() => s.receive("RELEASED", release(s), { ...before.binding, exchange_id: "foreign-exchange" }), /binding_changed/);
  assert.throws(() => s.m.startWrite(op.reference, { at: s.tick() }));
  assert.equal(s.m.describe().writes.at(-1).started, false); assert.equal(s.m.describe().frames, before.frames);
  assert.deepEqual(s.m.describe().next_ordinals, before.next_ordinals);
});
test("B4-P2 stopped receive records one untimed validated diagnostic without recovering the clock", () => {
  const s = active(); s.m.stop({ reason: "original_stop", at: null }); const before = s.m.describe();
  const line = canonical({ binding: before.binding, direction: "worker", ordinal: before.next_ordinals.worker,
    kind: "RELEASED", payload: release(s) }) + "\n";
  const d = s.m.receive({ line, at: null });
  assert.equal(d.stopped, "original_stop"); assert.equal(d.clock_invalid, true); assert.equal(d.frames, before.frames + 1);
  assert.equal(d.next_ordinals.worker, before.next_ordinals.worker + 1); assert.deepEqual(d.late_frames, [{ sha256: sha(line), bytes: Buffer.byteLength(line) }]);
  assert.equal(d.late_capture.receive_at, null); assert.equal(d.late_capture.semantic_verified, false); assert.equal(d.protocol_state, "STOPPED");
  assert.equal(d.phase_deadline_ns, before.phase_deadline_ns); assert.equal(d.settlement_start_ns, before.settlement_start_ns);
  assert.equal(s.m.planShutdown({ at: null, worker_live: true, pipe_qualified: true }).decision, "CLOSE_ONLY");
});
for (const issue of ["unavailable", "foreign", "rollback", "phase_deadline"]) test("B4-P2 a receive-time clock/deadline refusal captures the same complete frame only once: " + issue, () => {
  const s = active(), before = s.m.describe();
  const at = issue === "unavailable" ? null : issue === "foreign" ? { ...s.tick(), clock_domain: "foreign-clock" }
    : issue === "rollback" ? point(0) : s.at(before.phase_deadline_ns);
  const line = canonical({ binding: before.binding, direction: "worker", ordinal: before.next_ordinals.worker, kind: "RELEASED", payload: release(s) }) + "\n";
  const d = s.m.receive({ line, at }); assert.ok(d.stopped); assert.equal(d.protocol_state, "STOPPED");
  assert.equal(d.frames, before.frames + 1); assert.equal(d.next_ordinals.worker, before.next_ordinals.worker + 1);
  assert.equal(d.late_frames.length, 1); assert.equal(d.late_frames[0].sha256, sha(line)); assert.equal(d.late_capture.receive_at, null);
  assert.equal(d.baseline_sha256, before.baseline_sha256); assert.equal(d.trace_sha256, before.trace_sha256);
  assert.throws(() => s.m.receive({ line, at: null }), /late_closed/); assert.equal(s.m.describe().frames, d.frames);
});
test("B4-P2 a stopped receive ignores supplied time rather than sampling or validating it as a new point", () => {
  const s = active(); s.m.stop({ reason: "first", at: s.tick() }); const before = s.m.describe();
  const d = s.m.receive({ line: canonical({ binding: before.binding, direction: "worker", ordinal: before.next_ordinals.worker,
    kind: "RELEASED", payload: release(s) }) + "\n", at: { clock_domain: "foreign", monotonic_ns: "0" } });
  assert.equal(d.clock_invalid, false); assert.equal(d.stopped, "first"); assert.equal(d.phase_deadline_ns, before.phase_deadline_ns);
  assert.equal(d.late_capture.receive_at, null);
});
test("B4-P2 healthy worker traffic still uses the original normal lane, never a duplicate late row", () => {
  const s = active(), before = s.m.describe(); s.receive("RELEASED", release(s)); const d = s.m.describe();
  assert.equal(d.protocol_state, "RELEASED"); assert.equal(d.stopped, null); assert.equal(d.frames, before.frames + 1);
  assert.equal(d.late_frames.length, 0); assert.equal(d.late_capture, null);
});
for (const reason of ["decoder_failure", "truncated_frame", "stream_closed"]) test("B4-P2 transport receive fault stops capture without losing original callback/close facts: " + reason, () => {
  const s = baselined(), op = s.plan("GO", goPayload(s)); s.m.startWrite(op.reference, { at: s.tick() });
  s.m.refuseReceive({ reason }); const before = s.m.describe();
  assert.throws(() => s.receive("RELEASED", release(s)), /late_closed/); assert.equal(s.m.describe().frames, before.frames);
  s.m.completeWrite(op.reference, { outcome: "completed", at: null }); s.m.closeCommand({ outcome: "confirmed" }); s.m.workerExit({ exit_code: 1, signal: null });
  const d = s.m.describe(); assert.equal(d.stopped, reason); assert.equal(d.writes.at(-1).callback, "completed");
  assert.equal(d.command_close, "confirmed"); assert.equal(d.worker_exit.exit_code, 1); assert.equal(d.protocol_state, "STOPPED");
});
test("B4-P2 closed capture refuses without parsing a later frame or resynchronizing the decoder", () => {
  const s = active(); s.m.refuseReceive({ reason: "decoder_failure" }); const p = s.m.describe();
  const line = canonical({ binding: p.binding, direction: "worker", ordinal: p.next_ordinals.worker, kind: "RELEASED", payload: release(s) }) + "\n";
  const original = JSON.parse; let parsed = 0;
  try { JSON.parse = function (text, ...args) { if (text === line) { parsed++; throw Error("late_parse_after_freeze"); } return original.call(this, text, ...args); };
    assert.throws(() => s.m.receive({ line, at: null }), /late_closed/);
  } finally { JSON.parse = original; }
  assert.equal(parsed, 0); assert.equal(s.m.describe().late_capture.reason, "decoder_failure");
});
test("B4-P2 fifth late frame is refused before parsing, hashing or reserving another row", () => {
  const s = active(); s.m.stop({ reason: "first", at: s.tick() });
  const frame = i => canonical({ binding: s.m.describe().binding, direction: "worker", ordinal: s.m.describe().next_ordinals.worker, kind: "TRACE_CHUNK",
    payload: { chunk_index: i, events: [{ ordinal: i + 1, api: "info", edge: "end", clock_domain: "worker-clock", monotonic_ns: String(i + 1), code: null, byte_count: "0", sha256: null }] } }) + "\n";
  for (let i = 0; i < 4; i++) s.m.receive({ line: frame(i) }); const before = s.m.describe(), line = frame(4), original = JSON.parse; let parsed = 0;
  try { JSON.parse = function (text, ...args) { if (text === line) { parsed++; throw Error("late_parse_after_capacity"); } return original.call(this, text, ...args); };
    assert.throws(() => s.m.receive({ line }), /late_capacity/);
  } finally { JSON.parse = original; }
  assert.equal(parsed, 0); assert.equal(s.m.describe().late_frames.length, 4); assert.equal(s.m.describe().frames, before.frames);
  assert.equal(s.m.describe().late_capture.reason, "late_capacity"); assert.equal(s.m.describe().stopped, "first");
});
for (const planned of [false, true]) test("B4-P2 late capacity exhaustion keeps an eligible shutdown CANCEL: " + (planned ? "planned first" : "planned after"), () => {
  const s = active(); s.m.stop({ reason: "first", at: s.tick() });
  const frame = i => canonical({ binding: s.m.describe().binding, direction: "worker", ordinal: s.m.describe().next_ordinals.worker, kind: "TRACE_CHUNK",
    payload: { chunk_index: i, events: [{ ordinal: i + 1, api: "info", edge: "end", clock_domain: "worker-clock", monotonic_ns: String(i + 1), code: null, byte_count: "0", sha256: null }] } }) + "\n";
  const shutdown = () => s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }), op = planned ? shutdown() : null;
  for (let i = 0; i < 4; i++) s.m.receive({ line: frame(i) }); assert.throws(() => s.m.receive({ line: frame(4) }), /late_capacity/);
  assert.equal(s.m.describe().late_capture.capture, "frozen");
  const plan = op ?? shutdown(); assert.equal(plan.decision, "CANCEL_THEN_CLOSE");
  s.m.startWrite(plan.reference, { at: s.tick() }); assert.equal(s.m.describe().writes.at(-1).started, true);
});
test("B4-P2 malformed receive input is a receive fault that closes late intake", () => {
  const s = active(); assert.throws(() => s.m.receive({ line: "x".repeat(65537), at: s.tick() }));
  assert.deepEqual([s.m.describe().late_capture.capture, s.m.describe().late_capture.reason], ["refused", "receive_shape"]);
  const p = s.m.describe(), line = canonical({ binding: p.binding, direction: "worker", ordinal: p.next_ordinals.worker, kind: "TRACE_CHUNK",
    payload: { chunk_index: 0, events: [{ ordinal: 1, api: "info", edge: "end", clock_domain: "worker-clock", monotonic_ns: "1", code: null, byte_count: "0", sha256: null }] } }) + "\n";
  assert.throws(() => s.m.receive({ line }), /late_closed/); assert.equal(s.m.describe().late_frames.length, 0);
});
test("B4-P2 an EOF after a terminal late frame keeps the shutdown CANCEL startable", () => {
  const s = active(); s.m.stop({ reason: "first", at: s.tick() }); const op = s.m.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true });
  s.m.receive({ line: canonical({ binding: s.m.describe().binding, direction: "worker", ordinal: s.m.describe().next_ordinals.worker, kind: "FAILED",
    payload: { phase: "settlement", primary_code: "invented_failure", close_errors: [], diagnostic_sha256: null, resources: null, query_created: true, instrumentation_overflow: false } }) + "\n" });
  s.m.refuseReceive({ reason: "stream_closed" }); assert.deepEqual([s.m.describe().late_capture.capture, s.m.describe().late_capture.reason], ["ended", "terminal"]);
  s.m.startWrite(op.reference, { at: s.tick() }); assert.equal(s.m.describe().writes.at(-1).started, true);
});
test("B4-P2 a failed decoder batch never becomes a reconstructed favorable prefix", () => {
  const s = active(), before = s.m.describe(), decoder = createUnsignedProtocolDecoder();
  const line = canonical({ binding: before.binding, direction: "worker", ordinal: before.next_ordinals.worker, kind: "RELEASED", payload: release(s) }) + "\n";
  assert.throws(() => decoder.push(Buffer.concat([Buffer.from(line), Buffer.from([255, 10])])));
  s.m.refuseReceive({ reason: "decoder_failure" });
  assert.throws(() => decoder.push(Buffer.from(line)), /decoder_stopped/);
  assert.throws(() => s.m.receive({ line }), /late_closed/); const d = s.m.describe();
  assert.equal(d.frames, before.frames); assert.equal(d.late_frames.length, 0); assert.equal(d.stopped, "decoder_failure");
});
test("B4-P2 a stopped original READY cannot borrow the parent clock domain", () => {
  const s = driver(); s.write(s.plan("LAUNCH")); s.m.stop({ reason: "first", at: s.tick() }); const p = s.m.describe();
  const line = canonical({ binding: p.binding, direction: "worker", ordinal: p.next_ordinals.worker, kind: "READY",
    payload: { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(p.binding), worker_clock_domain: "parent-clock" } }) + "\n";
  assert.throws(() => s.m.receive({ line }), /worker_clock_domain/);
  assert.equal(s.m.describe().late_frames.length, 0); assert.equal(s.m.describe().late_capture.capture, "refused");
});
test("B4-P2 one returned decoder batch can cross into stopped capture without reordering", () => {
  const s = active(), p = s.m.describe(), decoder = createUnsignedProtocolDecoder();
  const frame = (ordinal, kind, payload) => canonical({ binding: p.binding, direction: "worker", ordinal, kind, payload }) + "\n";
  const trace = { chunk_index: 0, events: [{ ordinal: 1, api: "info", edge: "end", clock_domain: "worker-clock", monotonic_ns: "1", code: null, byte_count: "0", sha256: null }] };
  const first = frame(p.next_ordinals.worker, "TRACE_CHUNK", trace), second = frame(p.next_ordinals.worker + 1, "RELEASED", { ...release(s), trace_chunks: 1, trace_events: 1 });
  const lines = decoder.push(Buffer.from(first + second)); s.m.stop({ reason: "first", at: s.tick() });
  for (const line of lines) s.m.receive({ line });
  const d = s.m.describe(); assert.equal(d.late_frames.length, 2); assert.equal(d.frames, p.frames + 2);
  assert.deepEqual(d.late_frames.map(r => r.sha256), lines.map(sha)); assert.equal(d.trace_events, 0); assert.equal(d.late_capture.trace_events, 1);
  decoder.end();
});
test("B4-P2 a returned batch changes from normal to late exactly at pre-admission deadline detection", () => {
  const s = active(), before = s.m.describe(), decoder = createUnsignedProtocolDecoder();
  const event = { ordinal: 1, api: "info", edge: "end", clock_domain: "worker-clock", monotonic_ns: "1", code: null, byte_count: "0", sha256: null };
  const frame = (ordinal, kind, payload) => canonical({ binding: before.binding, direction: "worker", ordinal, kind, payload }) + "\n";
  const first = frame(before.next_ordinals.worker, "TRACE_CHUNK", { chunk_index: 0, events: [event] });
  const second = frame(before.next_ordinals.worker + 1, "RELEASED", { ...release(s), trace_chunks: 1, trace_events: 1, trace_sha256: digest([event]) });
  const lines = decoder.push(Buffer.from(first + second));
  s.m.receive({ line: lines[0], at: s.tick() }); const admitted = s.m.describe();
  assert.equal(admitted.stopped, null); assert.equal(admitted.trace_events, 1); assert.equal(admitted.late_frames.length, 0);
  s.m.receive({ line: lines[1], at: s.at(admitted.phase_deadline_ns) }); const after = s.m.describe();
  assert.equal(after.stopped, "phase_deadline"); assert.equal(after.frames, before.frames + 2);
  assert.equal(after.next_ordinals.worker, before.next_ordinals.worker + 2); assert.equal(after.protocol_state, "STOPPED");
  assert.deepEqual(after.late_frames, [{ sha256: sha(second), bytes: Buffer.byteLength(second) }]);
  assert.equal(after.trace_sha256, admitted.trace_sha256); assert.equal(after.trace_events, 1);
  assert.equal(after.late_capture.semantic_verified, false); assert.equal(after.late_capture.receive_at, null);
  assert.throws(() => s.m.receive({ line: lines[1] }), /late_closed/); assert.equal(s.m.describe().frames, after.frames);
  decoder.end();
});
test("B4-P1 a drained original CANCEL cannot be restarted, replaced or planned anew after release", () => {
  for (const action of ["restart", "replace_token", "new_cancel", "duplicate_release"]) {
    const s = active(), op = s.plan("CANCEL"); s.receive("RELEASED", release(s)); s.write(op); const before = s.m.describe();
    assert.throws(() => action === "restart" ? s.m.startWrite(op.reference, { at: s.tick() })
      : action === "replace_token" ? s.m.startWrite({}, { at: s.tick() })
      : action === "new_cancel" ? s.plan("CANCEL") : s.receive("RELEASED", release(s)));
    assert.equal(s.m.describe().frames, before.frames); assert.deepEqual(s.m.describe().next_ordinals, before.next_ordinals);
    assert.equal(s.m.describe().writes.length, 4);
  }
});
test("B4-A independently reachable five-command and 37-work diagnostics fit their reservation", () => {
  const s = active(); s.write(s.plan("CANCEL")); s.receive("RELEASED", release(s));
  s.m.noteTeardown({ action: "started", at: s.tick() });
  s.m.noteTeardown({ action: "confirmed", at: s.tick(), proof: { receipt_readback: true, anchor_same: true, root_removed: true, absent: true, worker_live: true } });
  s.write(s.plan("FINALIZE")); s.m.closeCommand({ outcome: "confirmed" }); s.m.workerExit({ exit_code: 0, signal: null });
  const l = lifetime(), p = pair(l);
  for (let ordinal = 1; ordinal <= 32; ordinal++) l.beginWork(p, { kind: "status_write", ordinal, references: references() });
  for (const kind of ["bootstrap", "owner", "reader", "query", "release"]) l.beginWork(p, { kind, ordinal: 1, references: references() });
  assert.equal(s.m.describe().writes.length, 5); assert.equal(l.describe().works.length, 37);
  assert.ok(Buffer.byteLength(canonical({ transport: s.m.describe(), lifetime: l.describe() })) <= s.m.capacity().diagnostic_ceiling_bytes);
});
test("B4-A complete frame size/canonical/direction reject malformed input before progress", () => {
  for (const line of ["{}\n", " ".repeat(65537), '{"direction":"parent"}\n', '{"direction":"worker"} \n']) {
    const s = ready(); assert.throws(() => s.m.receive({ line, at: s.tick() })); assert.ok(s.m.describe().stopped);
  }
});
test("B4-A reused pure decoder handles split UTF-8 and LF without any stream or fallback", () => {
  const decoder = createUnsignedProtocolDecoder(), text = canonical({ note: "\u3042", value: 1 }) + "\n", bytes = Buffer.from(text), split = bytes.indexOf(0xe3) + 1;
  assert.deepEqual(decoder.push(bytes.subarray(0,split)), []); assert.deepEqual(decoder.push(bytes.subarray(split)), [text]);
  decoder.end(); assert.throws(() => decoder.push(Buffer.alloc(0)), /stopped/);
});
test("B4-A reused decoder preserves frame/count/EOF bounds", () => {
  for (const [bytes,end] of [[Buffer.from("incomplete"), true], [Buffer.alloc(65537,65), false], [Buffer.from("{}\n".repeat(33)), false], [Buffer.from([255,10]), false]]) {
    const d = createUnsignedProtocolDecoder(); assert.throws(() => { d.push(bytes); if(end)d.end(); });
  }
});
test("B4-A decoder accepts the exact 65536-byte frame and refuses one byte more", () => {
  const overhead=Buffer.byteLength(canonical({note:""})+"\n"), line=canonical({note:"x".repeat(65536-overhead)})+"\n";
  assert.equal(Buffer.byteLength(line),65536); const d=createUnsignedProtocolDecoder();assert.deepEqual(d.push(Buffer.from(line)),[line]);d.end();
  const e=createUnsignedProtocolDecoder();assert.throws(()=>e.push(Buffer.from(line.slice(0,-1)+"x\n")),/frame_bound/);
});
test("B4-A B2 rejects a READY using the parent clock before any setup receipt", () => {
  const a = allocation("u0-unavailable"), m = createUnsignedCohortAssemblyModel({ request: a.fixture.request, clock });
  const token = m.beginCase({ allocation: a, at: point(1) });
  const receipt = m.applyModelEvent(token, { kind: "receipt", at: point(2), payload: { kind: "case_allocated", payload: {},
    stamp: { ...point(2), wall_utc: "2026-10-29T00:00:00.000Z", wall_jst: "2026-10-29T09:00:00.000+09:00" } } });
  m.applyModelEvent(token, { kind: "receipt_readback", at: point(3), payload: { line: receipt.line } });
  m.applyModelEvent(token, { kind: "resource", at: point(4), payload: { resource: "worker", action: "attach" } });
  const binding = m.describe().active.binding, frame = (direction,ordinal,kind,payload) => canonical({ binding,direction,ordinal,kind,payload })+"\n";
  m.applyModelEvent(token,{kind:"frame",at:point(5),payload:{line:frame("parent",1,"LAUNCH",{})}});
  m.applyModelEvent(token,{kind:"write",at:point(6),payload:{ordinal:1,outcome:"started"}});
  assert.throws(()=>m.applyModelEvent(token,{kind:"frame",at:point(7),payload:{line:frame("worker",1,"READY",{
    addon_protocol:6,mode:"synthetic_only",pins_sha256:digest(binding),worker_clock_domain:"parent-clock"})}}),/worker_clock_domain/);
});
const lifetime = () => createUnsignedWorkerLifetimeModel({ session_id: "invented-session" });
const references = () => ["referenced", "referenced"];
const pair = m => {
  const p = m.allocate({ ports: ["unreferenced", "unreferenced"] });
  for (const index of [0, 1]) {
    m.noteListeners(p, { index, event: "installed" });
    m.referencePort(p, { index, outcome: "returned", has_ref: true });
  }
  return p;
};
test("B4-A lifetime references are model-local and allocated only once", () => {
  const m = lifetime(), p = pair(m); assert.ok(Object.isFrozen(p)); assert.deepEqual(Object.keys(p),[]);
  assert.throws(()=>m.allocate({ports:["unreferenced","unreferenced"]}),/pair_once/);
  for (const ref of [{},pair(lifetime())]) { const l=lifetime();pair(l);assert.throws(()=>l.beginWork(ref,{kind:"query",ordinal:1,references:references()}),/reference/); }
});
for (const status of ["referenced","unknown","absent"]) test("B4-A non-default/unqualified allocation blocks all new query work: "+status,()=>{
  const m=lifetime(),p=m.allocate({ports:["unreferenced",status]});assert.ok(m.describe().stopped);
  assert.throws(()=>m.beginWork(p,{kind:"query",ordinal:1,references:references()}),/stopped/);assert.equal(m.describe().works.length,0);
});
test("B4-A expired settlement/EOF cannot close lifetime ports while original query is pending",()=>{
  const m=lifetime(),p=pair(m),q=m.beginWork(p,{kind:"query",ordinal:1,references:references()});m.stop({reason:"settlement_expired"});
  assert.throws(()=>m.closePort(p,{index:0,outcome:"returned"}),/close_once/);
  assert.throws(()=>m.beginWork(p,{kind:"query",ordinal:1,references:references()}),/stopped/);m.settleWork(q,{outcome:"confirmed"});
  m.closePort(p,{index:0,outcome:"returned"});m.observeClose(p,{index:0});m.observeClose(p,{index:1});assert.deepEqual(m.describe().ports,["closed","closed"]);
});
test("B4-A unknown original work disposition is retained, not retried into release",()=>{
  const m=lifetime(),p=pair(m),q=m.beginWork(p,{kind:"release",ordinal:1,references:references()});m.settleWork(q,{outcome:"unknown"});
  assert.throws(()=>m.settleWork(q,{outcome:"confirmed"}),/settle_once/);assert.throws(()=>m.closePort(p,{index:0,outcome:"returned"}),/close_once/);
  assert.equal(m.describe().works[0].outcome,"unknown");
});
test("B4-A all original operations settle independently after stop without new grace",()=>{
  const m=lifetime(),p=pair(m),kinds=["bootstrap","owner","reader","query","release","status_write"],tokens=kinds.map(kind=>m.beginWork(p,{kind,ordinal:1,references:references()}));
  m.stop({reason:"clock_unavailable"});tokens.forEach(t=>m.settleWork(t,{outcome:"confirmed"}));
  m.closePort(p,{index:0,outcome:"unknown"});m.observeClose(p,{index:1});
  assert.equal(m.describe().stopped,"clock_unavailable");assert.deepEqual(m.describe().ports,["unknown","closed"]);
  assert.throws(()=>m.closePort(p,{index:0,outcome:"returned"}),/close_once/);
});
test("B4-A exact maximum retained lifetime work is 32 status writes plus five original roles",()=>{
  const m=lifetime(),p=pair(m);
  for(let n=1;n<=32;n++)m.beginWork(p,{kind:"status_write",ordinal:n,references:references()});
  for(const kind of ["bootstrap","owner","reader","query","release"])m.beginWork(p,{kind,ordinal:1,references:references()});
  assert.equal(m.describe().works.length,37);assert.ok(Buffer.byteLength(canonical(m.describe()))<16384);
  assert.throws(()=>m.beginWork(p,{kind:"status_write",ordinal:33,references:references()}));assert.equal(m.describe().works.length,37);
});
test("B4-A lifetime cannot recreate ports or repeat original non-status operations",()=>{
  for(const kind of ["bootstrap","owner","reader","query","release"]){const m=lifetime(),p=pair(m);m.beginWork(p,{kind,ordinal:1,references:references()});
    assert.throws(()=>m.beginWork(p,{kind,ordinal:2,references:references()}),/work_once/);assert.equal(m.describe().works.length,1);}
});
test("B4-A new pair starts unreferenced and listener attachment alone never qualifies it", () => {
  const m = lifetime(), p = m.allocate({ ports: ["unreferenced", "unreferenced"] });
  assert.equal(m.describe().stopped, null); assert.deepEqual(m.describe().ports, ["unreferenced", "unreferenced"]);
  for (const index of [0, 1]) m.noteListeners(p, { index, event: "installed" });
  assert.deepEqual(m.describe().ports, references());
  assert.throws(() => m.beginWork(p, { kind: "query", ordinal: 1, references: references() }), /unqualified/);
  assert.equal(m.describe().works.length, 0);
});
for (const index of [0, 1]) for (const status of ["unreferenced", "unknown", "absent"])
  test(`B4-A every new work checks current port ${index} reference: ${status}`, () => {
    const m = lifetime(), p = pair(m), first = m.beginWork(p, { kind: "query", ordinal: 1, references: references() });
    const states = references(); states[index] = status;
    assert.throws(() => m.beginWork(p, { kind: "release", ordinal: 1, references: states }), /reference_lost/);
    assert.equal(m.describe().stopped, "pair_reference_lost"); assert.equal(m.describe().ports[index], status);
    assert.equal(m.describe().reference_confirmed[index], false);
    assert.equal(m.describe().works.length, 1); m.settleWork(first, { outcome: "confirmed" });
    assert.throws(() => m.beginWork(p, { kind: "release", ordinal: 1, references: references() }), /stopped/);
  });
test("B4-A work without current reference observations refuses before enrollment", () => {
  const m = lifetime(), p = pair(m); assert.throws(() => m.beginWork(p, { kind: "query", ordinal: 1 }));
  assert.ok(m.describe().stopped); assert.equal(m.describe().works.length, 0);
});
for (const kind of ["bootstrap", "owner", "reader", "query", "release", "status_write"])
  test("B4-A current-reference checks also gate each tracked role: " + kind, () => {
    const m = lifetime(), p = pair(m); m.beginWork(p, { kind: "status_write", ordinal: 1, references: references() });
    assert.throws(() => m.beginWork(p, { kind, ordinal: kind === "status_write" ? 2 : 1, references: ["referenced", "unreferenced"] }), /reference_lost/);
    assert.equal(m.describe().works.length, 1); assert.equal(m.describe().stopped, "pair_reference_lost");
  });
for (const index of [0, 1]) test(`B4-A removing fixed listeners silently unreferences port ${index} and latches stop`, () => {
  const m = lifetime(), p = pair(m), q = m.beginWork(p, { kind: "query", ordinal: 1, references: references() });
  m.noteListeners(p, { index, event: "removed" });
  assert.equal(m.describe().ports[index], "unreferenced"); assert.equal(m.describe().listeners[index], false);
  assert.equal(m.describe().stopped, "pair_listener_removed");
  assert.throws(() => m.beginWork(p, { kind: "release", ordinal: 1, references: references() }), /stopped/);
  m.settleWork(q, { outcome: "confirmed" });
  assert.throws(() => m.noteListeners(p, { index, event: "installed" }), /listeners_once/);
  assert.throws(() => m.referencePort(p, { index, outcome: "returned", has_ref: true }), /reference_once/);
});
for (const event of ["message", "messageerror"]) test("B4-A unexpected lifetime event stops without authorizing any work: " + event, () => {
  const m = lifetime(), p = pair(m); m.noteListeners(p, { index: 0, event });
  assert.equal(m.describe().stopped, "unexpected_port_event");
  assert.throws(() => m.beginWork(p, { kind: "query", ordinal: 1, references: references() }), /stopped/);
});
for (const outcome of ["threw", "unknown"]) test("B4-A reference qualification failure is terminal and not retried: " + outcome, () => {
  const m = lifetime(), p = m.allocate({ ports: ["unreferenced", "unreferenced"] });
  m.noteListeners(p, { index: 0, event: "installed" });
  m.referencePort(p, { index: 0, outcome, has_ref: null }); assert.equal(m.describe().stopped, "pair_unqualified");
  assert.throws(() => m.referencePort(p, { index: 0, outcome: "returned", has_ref: true }), /reference_once/);
  assert.throws(() => m.beginWork(p, { kind: "query", ordinal: 1, references: references() }), /stopped/);
});
for (const has_ref of [false, null]) test("B4-A returned ref is not proof of hasRef: " + has_ref, () => {
  const m = lifetime(), p = m.allocate({ ports: ["unreferenced", "unreferenced"] }); m.noteListeners(p, { index: 0, event: "installed" });
  m.referencePort(p, { index: 0, outcome: "returned", has_ref }); assert.equal(m.describe().stopped, "pair_unqualified");
  assert.equal(m.describe().reference_confirmed[0], false);
});
for (const index of [0, 1]) test(`B4-A one entangled close via port ${index} awaits both original close events`, () => {
  const m = lifetime(), p = pair(m); m.closePort(p, { index, outcome: "returned" });
  assert.deepEqual(m.describe().ports, ["closing", "closing"]); assert.deepEqual(m.describe().close_events, [false, false]);
  assert.equal(m.describe().close_outcome, "returned"); assert.equal(m.describe().close_confirmed, false);
  assert.deepEqual(m.describe().reference_confirmed, [false, false]);
  m.observeClose(p, { index }); assert.equal(m.describe().ports[1 - index], "closing"); assert.equal(m.describe().close_confirmed, false);
  m.observeClose(p, { index: 1 - index }); assert.equal(m.describe().close_confirmed, true); assert.deepEqual(m.describe().ports, ["closed", "closed"]);
  for (const i of [0, 1]) assert.throws(() => m.closePort(p, { index: i, outcome: "returned" }), /close_once/);
  assert.throws(() => m.observeClose(p, { index }), /close_event_once/);
});
for (const outcome of ["threw", "unknown"]) test("B4-A failed entangled close is never retried or falsely confirmed: " + outcome, () => {
  const m = lifetime(), p = pair(m); m.closePort(p, { index: 1, outcome });
  assert.equal(m.describe().stopped, "port_close_unknown"); assert.deepEqual(m.describe().ports, ["unknown", "unknown"]);
  assert.deepEqual(m.describe().references_at_close, references()); assert.equal(m.describe().close_confirmed, false);
  m.observeClose(p, { index: 0 }); assert.equal(m.describe().close_confirmed, false);
  assert.throws(() => m.closePort(p, { index: 0, outcome: "returned" }), /close_once/);
  m.observeClose(p, { index: 1 }); assert.equal(m.describe().close_confirmed, true); assert.equal(m.describe().close_outcome, outcome);
});
test("B4-A spontaneous close records fact and stops without claiming a close attempt or peer close", () => {
  const m = lifetime(), p = pair(m), q = m.beginWork(p, { kind: "query", ordinal: 1, references: references() });
  m.observeClose(p, { index: 0 }); assert.equal(m.describe().stopped, "unexpected_port_close");
  assert.equal(m.describe().close_attempted, false); assert.deepEqual(m.describe().ports, ["closed", "referenced"]);
  assert.throws(() => m.closePort(p, { index: 1, outcome: "returned" }), /close_once/);
  m.settleWork(q, { outcome: "confirmed" }); m.closePort(p, { index: 1, outcome: "returned" });
  m.observeClose(p, { index: 1 }); assert.equal(m.describe().close_confirmed, true);
});
for (const index of [0, 1]) test(`B4-A lost reference to original port ${index} cannot discard its late close notification`, () => {
  const m = lifetime(), p = pair(m), work = m.beginWork(p, { kind: "query", ordinal: 1, references: references() });
  const states = references(); states[index] = "absent";
  assert.throws(() => m.beginWork(p, { kind: "release", ordinal: 1, references: states }), /reference_lost/);
  m.settleWork(work, { outcome: "confirmed" }); m.closePort(p, { index: 1 - index, outcome: "returned" });
  m.observeClose(p, { index: 1 - index }); assert.equal(m.describe().close_confirmed, false);
  m.observeClose(p, { index }); assert.equal(m.describe().close_confirmed, true);
  assert.deepEqual(m.describe().close_events, [true, true]); assert.deepEqual(m.describe().ports, ["closed", "closed"]);
  assert.equal(m.describe().stopped, "pair_reference_lost"); assert.deepEqual(m.describe().references_at_close, states);
});
test("B4-A original port existence survives both lost observations without inventing a close call", () => {
  const m = lifetime(), p = pair(m);
  assert.throws(() => m.beginWork(p, { kind: "query", ordinal: 1, references: ["absent", "absent"] }), /reference_lost/);
  m.observeClose(p, { index: 0 }); m.observeClose(p, { index: 1 });
  assert.deepEqual(m.describe().close_events, [true, true]); assert.deepEqual(m.describe().original_ports, [true, true]);
  assert.equal(m.describe().close_attempted, false); assert.equal(m.describe().close_confirmed, false);
  assert.equal(m.describe().stopped, "pair_reference_lost");
});
test("B4-A absent or unknown allocation has no identified original port to confirm later", () => {
  for (const status of ["absent", "unknown"]) {
    const m = lifetime(), p = m.allocate({ ports: ["unreferenced", status] });
    assert.deepEqual(m.describe().original_ports, [true, false]);
    assert.throws(() => m.closePort(p, { index: 1, outcome: "returned" }), /close_once/);
    assert.throws(() => m.observeClose(p, { index: 1 }), /close_event_once/);
    m.observeClose(p, { index: 0 }); assert.deepEqual(m.describe().close_events, [true, false]);
    assert.equal(m.describe().close_confirmed, false); assert.equal(m.describe().stopped, "pair_unqualified");
  }
});
for (const status of ["absent", "unknown"]) for (const outcome of ["returned", "threw"])
  test(`B4-A a close through the identified end leaves an unidentified ${status} end as allocated: ${outcome}`, () => {
    const m = lifetime(), p = m.allocate({ ports: ["unreferenced", status] }); m.closePort(p, { index: 0, outcome });
    assert.deepEqual(m.describe().ports, [outcome === "returned" ? "closing" : "unknown", status]);
    assert.deepEqual(m.describe().references_at_close, ["unreferenced", status]);
  });
for (const event of ["message", "messageerror", "removed"])
  test("B4-A a port event after the close call keeps its own stop reason and close progress: " + event, () => {
    const m = lifetime(), p = pair(m); m.closePort(p, { index: 0, outcome: "returned" });
    m.noteListeners(p, { index: 1, event });
    assert.equal(m.describe().stopped, event === "removed" ? "pair_listener_removed" : "unexpected_port_event");
    assert.deepEqual(m.describe().ports, ["closing", "closing"]); assert.throws(() => m.noteListeners(p, { index: 1, event: "installed" }));
    m.observeClose(p, { index: 0 }); m.observeClose(p, { index: 1 }); assert.equal(m.describe().close_confirmed, true);
    assert.throws(() => m.noteListeners(p, { index: 1, event }), /listeners_unavailable/);
  });
test("B4-A an unused pair closed before any listener cannot gain listeners or a reference afterwards", () => {
  const m = lifetime(), p = m.allocate({ ports: ["unreferenced", "unreferenced"] }); m.closePort(p, { index: 0, outcome: "returned" });
  assert.throws(() => m.noteListeners(p, { index: 1, event: "installed" }), /listeners_unavailable/);
  assert.deepEqual(m.describe().ports, ["closing", "closing"]); assert.deepEqual(m.describe().listeners, [false, false]);
});
test("B4-A close starts no new work even when supplied references claim to remain valid", () => {
  const m = lifetime(), p = pair(m); m.closePort(p, { index: 0, outcome: "returned" });
  assert.throws(() => m.beginWork(p, { kind: "query", ordinal: 1, references: references() }), /closing/);
  assert.deepEqual(m.describe().ports, ["closing", "closing"]); assert.equal(m.describe().works.length, 0);
});
test("B4-A an already stopped session cannot allocate even its first pair", () => {
  const m = lifetime(); m.stop({ reason: "clock_unavailable" });
  assert.throws(() => m.allocate({ ports: ["unreferenced", "unreferenced"] }), /stopped/);
  assert.deepEqual(m.describe().ports, ["absent", "absent"]); assert.equal(m.describe().stopped, "clock_unavailable");
  assert.throws(() => m.allocate({ ports: ["unreferenced", "unreferenced"] }), /pair_once/);
});
test("B4-A explicit reference qualification requires original fixed listeners", () => {
  const m = lifetime(), p = m.allocate({ ports: ["unreferenced", "unreferenced"] });
  assert.throws(() => m.referencePort(p, { index: 0, outcome: "returned", has_ref: true }), /unqualified/);
  assert.equal(m.describe().reference_confirmed[0], false); assert.equal(m.describe().works.length, 0);
});
for (const operation of ["noteListeners", "referencePort", "closePort", "observeClose"])
  test("B4-A lifetime observations cannot use copied/foreign pair references: " + operation, () => {
    for (const ref of [{}, pair(lifetime())]) {
      const m = lifetime(); pair(m);
      const raw = operation === "noteListeners" ? { index: 0, event: "removed" }
        : operation === "referencePort" ? { index: 0, outcome: "returned", has_ref: true }
        : operation === "closePort" ? { index: 0, outcome: "returned" } : { index: 0 };
      assert.throws(() => m[operation](ref, raw), /reference/);
      assert.deepEqual(m.describe().ports, references()); assert.equal(m.describe().close_attempted, false);
    }
  });
test("B4-A malformed listener/reference/close events refuse without enrollment or fake completion", () => {
  for (const [operation, raw] of [["noteListeners", { index: 2, event: "removed" }], ["noteListeners", { index: 0, event: "installed", once: true }],
    ["referencePort", { index: 0, outcome: "returned" }], ["closePort", { index: 0, outcome: "confirmed" }],
    ["observeClose", { index: 0, outcome: "confirmed" }], ["observeClose", { index: -1 }]]) {
    const m = lifetime(), p = pair(m); assert.throws(() => m[operation](p, raw));
    assert.equal(m.describe().works.length, 0); assert.equal(m.describe().close_attempted, false);
    assert.deepEqual(m.describe().ports, references()); assert.deepEqual(m.describe().close_events, [false, false]);
  }
});
test("B4-A lifetime diagnostic remains immutable across later close notifications", () => {
  const m = lifetime(), p = pair(m); m.closePort(p, { index: 0, outcome: "returned" }); const prior = m.describe();
  assert.ok(Object.isFrozen(prior)); assert.ok(Object.isFrozen(prior.references_at_close));
  m.observeClose(p, { index: 0 }); assert.deepEqual(prior.ports, ["closing", "closing"]); assert.deepEqual(prior.close_events, [false, false]);
});
test("B4-A all 37 original work dispositions must settle before the sole close call", () => {
  const m = lifetime(), p = pair(m), tokens = [];
  for (let ordinal = 1; ordinal <= 32; ordinal++) tokens.push(m.beginWork(p, { kind: "status_write", ordinal, references: references() }));
  for (const kind of ["bootstrap", "owner", "reader", "query", "release"]) tokens.push(m.beginWork(p, { kind, ordinal: 1, references: references() }));
  m.stop({ reason: "eof" });
  for (const token of tokens) {
    assert.throws(() => m.closePort(p, { index: 0, outcome: "returned" }), /close_once/);
    assert.equal(m.describe().close_attempted, false); m.settleWork(token, { outcome: "confirmed" });
  }
  m.closePort(p, { index: 1, outcome: "returned" }); m.observeClose(p, { index: 1 }); m.observeClose(p, { index: 0 });
  assert.equal(m.describe().close_confirmed, true); assert.equal(m.describe().stopped, "eof");
  const s = model(); assert.ok(Buffer.byteLength(canonical({ transport: s.describe(), lifetime: m.describe() })) <= s.capacity().diagnostic_ceiling_bytes);
  for (const [k, v] of Object.entries(flags())) if (typeof v === "boolean") assert.equal(m.describe()[k], false, k);
});
test("B4-A maximal lifetime strings and all 37 records fit before and after entangled close", () => {
  const m = createUnsignedWorkerLifetimeModel({ session_id: "l".repeat(48) }), p = pair(m), tokens = [], snapshots = [m.describe()];
  for (let ordinal = 1; ordinal <= 32; ordinal++) tokens.push(m.beginWork(p, { kind: "status_write", ordinal, references: references() }));
  for (const kind of ["bootstrap", "owner", "reader", "query", "release"]) tokens.push(m.beginWork(p, { kind, ordinal: 1, references: references() }));
  m.stop({ reason: "c".repeat(96) }); tokens.forEach(t => m.settleWork(t, { outcome: "confirmed" })); snapshots.push(m.describe());
  m.closePort(p, { index: 0, outcome: "unknown" }); snapshots.push(m.describe());
  m.observeClose(p, { index: 1 }); snapshots.push(m.describe()); m.observeClose(p, { index: 0 }); snapshots.push(m.describe());
  const s = model(), capacity = s.capacity();
  for (const state of snapshots) {
    assert.equal(state.schema, "native-bar-worker-lifetime-model-v2");
    assert.ok(Buffer.byteLength(canonical({ transport: s.describe(), lifetime: state })) <= capacity.diagnostic_ceiling_bytes);
    for (const [k, v] of Object.entries(flags())) if (typeof v === "boolean") assert.equal(state[k], false, k);
  }
  assert.equal(capacity.diagnostic_limit_bytes, 16384); assert.equal(capacity.coordinator_metadata_limit_bytes, 65536);
  assert.equal(capacity.lifetime_work_records, 37); assert.equal(capacity.native_budget_changed, false);
});
// Independent model replays of one invented schedule, not a runtime joining two protocol ledgers.
function p3Replay() {
  const a = allocation("u0-unavailable"), f = fixture("u0-unavailable"), recipe = describeUnsignedFixture(f);
  let ns = 1n; const tick = () => point(ns++), at = n => { ns = BigInt(n) + 1n; return point(n); };
  const initial = tick(), transport = model({ allocation: a, allocated_at: initial });
  const cohort = createUnsignedCohortAssemblyModel({ request: f.request, clock }), token = cohort.beginCase({ allocation: a, at: initial });
  const decoder = createUnsignedProtocolDecoder();
  const event = (kind, payload = {}, when = tick()) => cohort.applyModelEvent(token, { kind, payload, at: when });
  const record = (kind, payload = {}) => {
    const when = tick(), result = event("receipt", { kind, payload, stamp: { ...when,
      wall_utc: "2026-10-31T00:00:00.000Z", wall_jst: "2026-10-31T09:00:00.000+09:00" } }, when);
    event("receipt_readback", { line: result.line }); return result;
  };
  const compare = () => {
    const t = transport.describe(), b = cohort.describe().active;
    for (const k of ["binding", "frames", "next_ordinals", "protocol_state", "go_submitted", "baseline_sha256", "trace_chunks", "trace_events", "trace_sha256"])
      assert.deepEqual(t[k], b[k], k);
    assert.deepEqual(t.late_frames, cohort.describeLateFrames(token).late_frames);
    assert.deepEqual(t.late_capture, cohort.describeLateFrames(token).late_capture);
    assert.ok(Buffer.byteLength(canonical(cohort.describe())) <= cohort.describe().capacity.diagnostic_ceiling_bytes);
    for (const view of [t, cohort.describe()]) for (const [k, v] of Object.entries(flags())) if (typeof v === "boolean") assert.equal(view[k], false, k);
    return t;
  };
  const command = (kind, payload = {}, binding) => {
    const when = tick(), op = transport.planCommand({ kind, payload, ...(binding ? { binding } : {}), at: when });
    event("frame", { line: op.line }, when); compare(); return op;
  };
  const start = (op, when = tick()) => { transport.startWrite(op.reference, { at: when });
    event(JSON.parse(op.line).kind === "CANCEL" && transport.describe().stopped ? "shutdown_write" : "write",
      transport.describe().stopped ? { outcome: "started" } : { ordinal: JSON.parse(op.line).ordinal, outcome: "started" }, when); compare(); };
  const complete = (op, outcome = "completed", when = tick()) => { transport.completeWrite(op.reference, { outcome, at: when });
    const shutdown = transport.describe().writes.find(w => w.ordinal === JSON.parse(op.line).ordinal).shutdown;
    event(shutdown ? "shutdown_write" : "write", shutdown ? { outcome } : { ordinal: JSON.parse(op.line).ordinal, outcome }, when); compare(); };
  const write = op => { start(op); complete(op); return op; };
  const line = (kind, payload, ordinal = transport.describe().next_ordinals.worker) => canonical({
    binding: transport.describe().binding, direction: "worker", ordinal, kind, payload }) + "\n";
  const normal = raw => { const when = tick(); transport.receive({ line: raw, at: when }); event("frame", { line: raw }, when); compare(); };
  const late = raw => { transport.receive({ line: raw }); cohort.observeLateFrame(token, { line: raw }); compare(); };
  const stop = reason => { const when = tick(); transport.stop({ reason, at: when }); cohort.stop({ reason, at: when }); compare(); };
  const shutdown = (when = tick()) => { const t = transport.planShutdown({ at: when, worker_live: true, pipe_qualified: true }), b = event("shutdown_plan", {}, when);
    assert.equal(t.decision, b.decision); assert.equal(t.line, b.frame); compare(); return t; };
  record("case_allocated"); event("resource", { resource: "worker", action: "attach" }); write(command("LAUNCH"));
  const readyLine = line("READY", { addon_protocol: 6, mode: "synthetic_only", worker_clock_domain: "worker-clock", pins_sha256: digest(transport.describe().binding) });
  normal(readyLine);
  for (const [i, e] of recipe.entries.entries()) {
    const proof = { kind: e.kind, device: "1", inode: String(100 + i), uid: "501", gid: "20", mode: e.mode,
      flags: "0", birthtime_ns: "1", mtime_ns: "1", ctime_ns: "1", nlink: e.kind === "file" ? "1" : "2", size: e.size ?? "0",
      allocated_bytes: "0", acl: "none", acl_hash: h, sha256: e.sha256 ?? null };
    record("create_intent", { entry_index: i, ...(i === 0 ? { ready_sha256: sha(readyLine) } : {}) });
    record("create_result", { entry_index: i, proof, ...(i === 0 ? { fixture_name: f.fixture_name } : {}) });
  }
  record("setup_sealed", { inventory_sha256: h, setup: setup(f) });
  write(command("PREPARE", { configuration: configuration(f), launch_nonce: a.launch_nonce }, { ...transport.describe().binding, setup: setup(f) }));
  normal(line("BASELINED", baselineValue)); record("worker_prepared"); record("baseline_bound", baselineValue);
  record("go_intent", { baseline_sha256: transport.describe().baseline_sha256, bound_objects_sha256: null });
  write(command("GO", { baseline_sha256: transport.describe().baseline_sha256, baseline_readback: true, go_intent_readback: true }));
  const released = () => ({ ...release({ m: transport }), primary_code: "oracle_unavailable" });
  return { transport, cohort, token, decoder, tick, at, event, record, compare, command, start, complete, write, line, normal, late, stop, shutdown, released };
}
test("B4-P3 the same reserved-CANCEL schedule replays independently through transport and B2", () => {
  const s = p3Replay(), op = s.command("CANCEL"), before = s.compare();
  const lines = s.decoder.push(Buffer.from(s.line("RELEASED", s.released()))); assert.equal(lines.length, 1);
  s.normal(lines[0]); const released = s.compare(); s.write(op); const drained = s.compare();
  assert.equal(drained.frames, before.frames + 1); assert.deepEqual(drained.next_ordinals, released.next_ordinals);
  assert.equal(drained.writes.at(-1).sha256, sha(op.line)); assert.equal(drained.writes.at(-1).deadline_ns, op.deadline_ns);
  assert.equal(drained.protocol_state, "RELEASED"); assert.equal(drained.late_frames.length, 0);
  assert.equal(s.cohort.describe().active.window.starts.settlement, released.settlement_start_ns); s.decoder.end();
});
const p3Trace = (s, index) => s.line("TRACE_CHUNK", { chunk_index: index, events: [{ ordinal: index + 1, api: "info", edge: "end",
  clock_domain: "worker-clock", monotonic_ns: String(index + 1), code: null, byte_count: "0", sha256: null }] });
const p3Failure = () => ({ phase: "finalize", primary_code: "invented_finalize_failure", close_errors: [], diagnostic_sha256: h,
  resources, query_created: true, instrumentation_overflow: false });
for (const cut of ["before_release", "after_release", "after_start", "after_callback"])
  test("B4-P3 stop cuts the reserved CANCEL/release/callback schedule without promoting late facts: " + cut, () => {
    const s = p3Replay(), op = s.command("CANCEL");
    if (cut !== "before_release") s.normal(s.line("RELEASED", s.released()));
    if (["after_start", "after_callback"].includes(cut)) s.start(op);
    if (cut === "after_callback") s.complete(op);
    s.stop("primary"); const before = s.compare(), evidence = s.cohort.describe().active.evidence;
    const raw = cut === "before_release" ? s.line("RELEASED", s.released()) : s.line("FAILED", p3Failure());
    for (const line of s.decoder.push(Buffer.from(raw))) s.late(line);
    const after = s.compare();
    assert.equal(after.stopped, "primary"); assert.equal(after.frames, before.frames + 1); assert.equal(after.next_ordinals.worker, before.next_ordinals.worker + 1);
    assert.deepEqual(after.writes, before.writes); assert.equal(after.trace_sha256, before.trace_sha256);
    assert.equal(after.phase_deadline_ns, before.phase_deadline_ns); assert.equal(after.settlement_start_ns, before.settlement_start_ns);
    assert.deepEqual(s.cohort.describe().active.evidence, evidence); assert.equal(after.late_capture.capture, "ended");
    if (cut === "after_start") s.complete(op);
    const plan = s.shutdown(); assert.equal(plan.decision, cut === "before_release" ? "CANCEL_THEN_CLOSE" : "CLOSE_ONLY");
    if (plan.reference) { assert.equal(plan.reference, op.reference); assert.equal(plan.line, op.line); s.write(plan); }
    const when = s.tick(); s.transport.closeCommand({ outcome: "confirmed" }); s.event("command_close", { outcome: "confirmed" }, when);
    s.transport.workerExit({ exit_code: 1, signal: null }); s.event("worker_exit", { exit_code: 1, signal: null }); s.compare();
    assert.equal(s.transport.describe().writes.filter(w => w.kind === "CANCEL").length, 1);
    assert.equal(s.cohort.describe().active.window.starts.teardown, undefined); s.decoder.end();
  });
for (const planned of [false, true]) for (const disposition of ["capacity", "malformed", "duplicate"])
  test(`B4-P3 ${disposition} intake with shutdown already planned=${planned} retains exactly its original authority`, () => {
    const s = p3Replay(), original = s.command("CANCEL"); s.stop("primary"); const plan = planned ? s.shutdown() : null;
    let invalid;
    if (disposition === "capacity") { for (let i = 0; i < 4; i++) s.late(p3Trace(s, i)); invalid = p3Trace(s, 4); }
    else if (disposition === "duplicate") { invalid = p3Trace(s, 0); s.late(invalid); }
    else invalid = "{}\n";
    const before = s.compare();
    assert.throws(() => s.transport.receive({ line: invalid }), disposition === "capacity" ? /late_capacity/ : disposition === "duplicate" ? /protocol_ordinal/ : /invalid_input/);
    assert.throws(() => s.cohort.observeLateFrame(s.token, { line: invalid }), disposition === "capacity" ? /late_capacity/ : disposition === "duplicate" ? /protocol_ordinal/ : /invalid_input/);
    const after = s.compare(); assert.equal(after.frames, before.frames); assert.deepEqual(after.next_ordinals, before.next_ordinals);
    assert.equal(after.late_capture.capture, disposition === "capacity" ? "frozen" : "refused"); assert.equal(after.stopped, "primary");
    const allowed = disposition === "capacity", shutdown = plan ?? s.shutdown();
    if (planned && !allowed) {
      const when = s.tick(); assert.throws(() => s.transport.startWrite(shutdown.reference, { at: when }), /shutdown_write_order/);
      assert.throws(() => s.event("shutdown_write", { outcome: "started" }, when), /shutdown_write_order/);
    } else if (allowed) {
      assert.equal(shutdown.decision, "CANCEL_THEN_CLOSE"); assert.equal(shutdown.reference, original.reference); assert.equal(shutdown.line, original.line); s.write(shutdown);
    } else assert.equal(shutdown.decision, "CLOSE_ONLY");
    const final = s.compare(); assert.equal(final.writes.length, 4); assert.equal(final.writes.at(-1).deadline_ns, original.deadline_ns);
    assert.equal(final.writes.at(-1).started, allowed); assert.equal(final.settlement_start_ns, before.settlement_start_ns);
    assert.throws(() => s.transport.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }), /shutdown_once/);
  });
for (const stage of ["before_report", "pending_report", "confirmed_report", "pending_index", "retained_case", "closed_index"])
  test("B4-P3 reserved CANCEL and late RELEASED do not backfill frozen evidence at " + stage, () => {
    const s = p3Replay(), op = s.command("CANCEL"); s.stop("primary");
    const raw = s.line("RELEASED", s.released()); let captures = 0;
    const arrive = current => {
      if (current !== stage) return;
      const before = s.cohort.describe(), t = s.transport.describe(); s.late(raw); captures++;
      const after = s.cohort.describe(); assert.deepEqual(after.active.evidence, before.active.evidence); assert.deepEqual(after.rows, before.rows);
      assert.equal(after.first_stop_ns, before.first_stop_ns); assert.deepEqual(after.active.window, before.active.window);
      assert.deepEqual(s.transport.describe().writes, t.writes); assert.equal(after.active.protocol_state, "STOPPED");
    };
    s.record("stop_summary", { reason: "primary", details: [] }); s.record("ready_to_report", { candidate_outcome: "FAIL", assessment_sha256: null });
    arrive("before_report"); const when = s.tick(), report = s.event("report", { observation: null, trace: [], comparison: null, limitations: [],
      save_stamp: { ...when, wall_utc: "2026-10-31T00:00:00.000Z", wall_jst: "2026-10-31T09:00:00.000+09:00" } }, when);
    const reportBytes = report.line; arrive("pending_report"); s.event("report_readback", { line: report.line }); arrive("confirmed_report");
    s.record("terminal", { report_sha256: report.sha256 }); s.event("case_closes", { receipt: "confirmed", report: "confirmed", errors: [] });
    const row = s.event("index_row"), rowBytes = row.line; arrive("pending_index"); s.event("index_readback", { line: row.line });
    s.cohort.finishCase(s.token, { at: s.tick() }); s.cohort.finishNotRun(); arrive("retained_case");
    s.cohort.closeIndex({ outcome: "confirmed", at: s.tick() }); arrive("closed_index");
    const b = s.cohort.describe(), t = s.compare(); assert.equal(captures, 1); assert.equal(report.line, reportBytes); assert.equal(row.line, rowBytes);
    assert.equal(b.active.evidence.report_sha256, sha(reportBytes)); assert.equal(b.active.evidence.index_sha256, sha(rowBytes));
    assert.equal(b.rows.length, 24); assert.equal(b.rows[0].model_verdict, "FAIL"); assert.equal(b.rows.filter(r => r.model_verdict === "NOT_RUN").length, 23);
    assert.equal(b.closed, true); assert.equal(b.active.evidence.evidence_saved, false); assert.equal(t.writes.at(-1).started, false);
    assert.equal(t.writes.at(-1).sha256, sha(op.line)); assert.equal(b.active.slots.fixture, "live"); assert.equal(b.active.slots.worker, "live");
    assert.equal(t.cleanup_execution_available, false); assert.equal(t.late_capture.semantic_verified, false);
  });
for (const first of [0, 1]) for (const traffic of ["release", "malformed", "capacity"])
  test(`B4-P3 late ${traffic} cannot settle original lifetime work before close event order ${first}`, () => {
    const s = p3Replay(), l = lifetime(), ports = pair(l), work = ["query", "release", "status_write"].map(kind =>
      l.beginWork(ports, { kind, ordinal: 1, references: references() }));
    s.command("CANCEL"); s.stop("primary"); l.stop({ reason: "primary" }); const before = l.describe();
    if (traffic === "release") s.late(s.line("RELEASED", s.released()));
    else if (traffic === "malformed") {
      assert.throws(() => s.transport.receive({ line: "{}\n" }), /invalid_input/);
      assert.throws(() => s.cohort.observeLateFrame(s.token, { line: "{}\n" }), /invalid_input/);
    } else {
      for (let i = 0; i < 4; i++) s.late(p3Trace(s, i)); const overflow = p3Trace(s, 4);
      assert.throws(() => s.transport.receive({ line: overflow }), /late_capacity/);
      assert.throws(() => s.cohort.observeLateFrame(s.token, { line: overflow }), /late_capacity/);
    }
    s.compare(); assert.deepEqual(l.describe(), before);
    for (const token of work) {
      assert.throws(() => l.closePort(ports, { index: first, outcome: "returned" }), /close_once/);
      assert.deepEqual(l.describe().ports, references()); assert.equal(l.describe().close_attempted, false);
      l.settleWork(token, { outcome: "confirmed" });
    }
    l.closePort(ports, { index: first, outcome: "returned" }); l.observeClose(ports, { index: first });
    assert.equal(l.describe().close_confirmed, false); l.observeClose(ports, { index: 1 - first }); assert.equal(l.describe().close_confirmed, true);
    assert.throws(() => l.closePort(ports, { index: 1 - first, outcome: "returned" }), /close_once/);
    assert.equal(l.describe().stopped, "primary"); assert.equal(s.transport.describe().stopped, "primary");
    assert.ok(Buffer.byteLength(canonical({ transport: s.transport.describe(), lifetime: l.describe() })) <= s.transport.capacity().diagnostic_ceiling_bytes);
  });
for (const fault of ["unavailable", "foreign", "rollback"])
  test("B4-P3 receive-time clock fault retains the reserved CANCEL and only untimed original-case diagnostics: " + fault, () => {
    const s = p3Replay(), op = s.command("CANCEL"), before = s.compare();
    const bad = fault === "unavailable" ? null : fault === "foreign" ? { ...s.tick(), clock_domain: "foreign" } : point(0);
    const raw = s.line("RELEASED", s.released()), frames = s.decoder.push(Buffer.from(raw)); assert.equal(frames.length, 1);
    s.transport.receive({ line: frames[0], at: bad });
    assert.throws(() => s.event("frame", { line: frames[0] }, bad), /invalid_input|clock_order/);
    s.cohort.observeLateFrame(s.token, { line: frames[0] }); const after = s.compare(), b = s.cohort.describe();
    assert.equal(after.clock_invalid, true); assert.equal(b.clock_invalid, true); assert.equal(b.first_stop_ns, null);
    assert.equal(after.frames, before.frames + 1); assert.deepEqual(after.writes, before.writes);
    assert.equal(after.late_capture.receive_at, null); assert.equal(after.writes.at(-1).deadline_ns, op.deadline_ns);
    assert.equal(after.phase_deadline_ns, before.phase_deadline_ns); assert.equal(after.settlement_start_ns, before.settlement_start_ns);
    assert.equal(s.transport.planShutdown({ at: null, worker_live: true, pipe_qualified: true }).decision, "CLOSE_ONLY");
    assert.throws(() => s.event("late_frame", { line: frames[0] }), /late_requires_untimed/);
    assert.equal(s.cohort.describe().active.late_count, 1); s.decoder.end();
  });
for (const offset of [-2000000n, -500000n, 0n, 1n])
  test("B4-P3 the original transport deadline dominates B2 phase-only facts at CANCEL offset " + offset, () => {
    const s = p3Replay(), op = s.command("CANCEL"), end = BigInt(op.deadline_ns), receiveAt = end + offset;
    const raw = s.line("RELEASED", s.released()), when = s.at(receiveAt);
    if (offset < 0n) {
      s.transport.receive({ line: raw, at: when }); s.event("frame", { line: raw }, when); s.compare();
      if (offset === -2000000n) {
        s.start(op, s.at(end - 1000000n)); s.complete(op, "completed", s.at(end - 1n));
        assert.equal(s.transport.describe().stopped, null); assert.equal(s.transport.describe().late_frames.length, 0);
      } else {
        assert.throws(() => s.transport.startWrite(op.reference, { at: when }), /write_deadline/);
        // B2 has no per-write reservation. Relay the transport's detected stop, never a write it refused.
        s.cohort.stop({ reason: "write_deadline", at: when }); s.compare();
        assert.equal(s.transport.describe().settlement_start_ns, String(receiveAt));
      }
    } else {
      s.transport.receive({ line: raw, at: when });
      // The known triggering deadline is supplied as a fact, not the later observation relabeled as that deadline.
      s.cohort.stop({ reason: "write_deadline", at: point(end) }); s.cohort.observeLateFrame(s.token, { line: raw }); s.compare();
      assert.equal(s.cohort.describe().first_stop_ns, String(end)); assert.equal(s.transport.describe().settlement_start_ns, String(end));
      assert.equal(s.transport.describe().late_frames.length, 1); assert.equal(s.transport.describe().protocol_state, "STOPPED");
    }
    const t = s.transport.describe(); assert.equal(t.writes.at(-1).deadline_ns, op.deadline_ns); assert.equal(t.writes.at(-1).sha256, sha(op.line));
    assert.equal(t.writes.at(-1).started, offset === -2000000n); assert.equal(t.writes.length, 4);
    if (offset !== -2000000n) {
      assert.equal(s.transport.planShutdown({ at: s.tick(), worker_live: true, pipe_qualified: true }).decision, "CLOSE_ONLY");
      assert.equal(s.transport.describe().cleanup_execution_available, false);
    }
  });
for (const input of ["partial_eof", "failed_batch", "terminal_release", "terminal_failure"])
  test("B4-P3 decoder end/failure preserves the original reserved shutdown at " + input, () => {
    const s = p3Replay(), op = s.command("CANCEL"); s.stop("primary"); const plan = s.shutdown(), before = s.compare();
    let reason;
    if (input === "partial_eof") {
      const raw = s.line("RELEASED", s.released()); assert.deepEqual(s.decoder.push(Buffer.from(raw.slice(0, -1))), []);
      assert.throws(() => s.decoder.end(), /partial|truncated/); reason = "truncated_frame";
    } else if (input === "failed_batch") {
      assert.throws(() => s.decoder.push(Buffer.concat([Buffer.from(s.line("RELEASED", s.released())), Buffer.from([255, 10])])));
      assert.throws(() => s.decoder.push(Buffer.from("{}\n")), /stopped/); reason = "decoder_failure";
    } else {
      const payload = input === "terminal_release" ? s.released() : { ...p3Failure(), phase: "go" };
      const raw = s.line(input === "terminal_release" ? "RELEASED" : "FAILED", payload);
      for (const line of s.decoder.push(Buffer.from(raw))) s.late(line); s.decoder.end(); reason = "stream_closed";
    }
    s.transport.refuseReceive({ reason }); s.cohort.endLateFrames(s.token, { reason }); const after = s.compare();
    const terminal = input.startsWith("terminal"); assert.equal(after.late_capture.capture, terminal ? "ended" : "refused");
    assert.equal(after.frames, before.frames + (terminal ? 1 : 0)); assert.equal(after.late_frames.length, terminal ? 1 : 0);
    assert.equal(after.stopped, "primary"); assert.equal(plan.reference, op.reference); assert.equal(plan.line, op.line);
    if (terminal) s.write(plan);
    else {
      const when = s.tick(); assert.throws(() => s.transport.startWrite(plan.reference, { at: when }), /shutdown_write_order/);
      assert.throws(() => s.event("shutdown_write", { outcome: "started" }, when), /shutdown_write_order/);
    }
    assert.equal(s.compare().writes.at(-1).started, terminal); assert.equal(s.transport.describe().phase_deadline_ns, before.phase_deadline_ns);
  });
for (const callback of ["completed", "uncertain", "late"])
  test("B4-P3 a stopped original CANCEL callback cannot use late release to repair delivery: " + callback, () => {
    const s = p3Replay(), op = s.command("CANCEL"); s.start(op); s.stop("primary"); s.late(s.line("RELEASED", s.released()));
    const when = callback === "late" ? s.at(op.deadline_ns) : s.tick(), before = s.compare();
    s.transport.completeWrite(op.reference, { outcome: callback === "uncertain" ? "uncertain" : "completed", at: when });
    // The phase-only coordinator records the delivery disposition derived by the original transport.
    s.event("write", { ordinal: 4, outcome: callback === "completed" ? "completed" : "uncertain" }, when); const after = s.compare();
    assert.equal(after.frames, before.frames); assert.deepEqual(after.late_frames, before.late_frames);
    assert.equal(after.writes.at(-1).decision, callback === "completed" ? "started" : "uncertain");
    assert.equal(after.writes.at(-1).callback_at === null, callback === "late");
    if (callback !== "late") assert.deepEqual(after.writes.at(-1).callback_at, when);
    assert.equal(after.stopped, "primary");
    assert.equal(after.settlement_start_ns, before.settlement_start_ns); assert.equal(s.shutdown().decision, "CLOSE_ONLY");
  });
for (const bound of ["settlement", "cohort"])
  test("B4-P3 diagnostic traffic past the original " + bound + " end never renews grace", () => {
    const s = p3Replay(); s.command("CANCEL"); s.stop("primary"); const before = s.compare(), first = s.cohort.describe().first_stop_ns;
    s.late(p3Trace(s, 0)); const end = bound === "settlement" ? before.phase_deadline_ns : before.cohort_deadline_ns;
    assert.equal(s.shutdown(s.at(BigInt(end) + 1n)).decision, "CLOSE_ONLY");
    s.late(s.line("RELEASED", { ...s.released(), trace_chunks: 1, trace_events: 1 })); const after = s.compare();
    assert.equal(after.frames, before.frames + 2); assert.equal(after.phase_deadline_ns, before.phase_deadline_ns);
    assert.equal(after.settlement_start_ns, before.settlement_start_ns); assert.equal(after.cohort_deadline_ns, before.cohort_deadline_ns);
    assert.equal(s.cohort.describe().first_stop_ns, first); assert.equal(after.late_capture.receive_at, null);
    assert.equal(after.writes.at(-1).started, false); assert.equal(after.protocol_state, "STOPPED");
  });
for (const completed of [false, true])
  test("B4-P3 a known C1 violation survives late failure and the original CANCEL callback, completed=" + completed, () => {
    const s = p3Replay(), op = s.command("CANCEL"), released = { ...s.released(), requests_dispatched: 2 };
    s.normal(s.line("RELEASED", released)); s.start(op); if (completed) s.complete(op);
    s.record("run_outcome", { primary_code: released.primary_code, requests_dispatched: 2, authenticated_requests: 0, diagnostic_sha256: h,
      observation_sha256: null, observation_bytes: 0, trace_sha256: released.trace_sha256, trace_events: 0 });
    s.stop("primary"); const before = s.cohort.describe().active.evidence; assert.equal(before.c1_violation, true);
    s.late(s.line("FAILED", p3Failure())); if (!completed) s.complete(op);
    assert.equal(s.cohort.describe().active.evidence.c1_violation, true); assert.deepEqual(s.cohort.describe().active.evidence, before);
    assert.equal(s.shutdown().decision, "CLOSE_ONLY"); assert.equal(s.transport.describe().protocol_state, "STOPPED");
    assert.equal(s.transport.describe().stopped, "primary"); assert.equal(s.transport.describe().cleanup_execution_available, false);
  });
for (const stopped of [false, true]) for (const outcome of ["completed", "uncertain"]) for (const timing of ["timely", "deadline", "unavailable", "foreign", "rollback"])
  test(`B4-B1 callback calculation matches the independent GO transport model: ${stopped}/${outcome}/${timing}`, () => {
    const s = baselined(), when = s.tick(), before = s.m.describe();
    const op = s.m.planCommand({ kind: "GO", payload: goPayload(s), at: when });
    const r = planUnsignedParentReservation({ clock_domain: when.clock_domain, planned_ns: when.monotonic_ns,
      phase_deadline_ns: before.phase_deadline_ns, cohort_deadline_ns: before.cohort_deadline_ns }).reservation;
    assert.equal(r.deadline_ns, op.deadline_ns); let last = s.tick(); s.m.startWrite(op.reference, { at: last });
    if (stopped) { last = s.tick(); s.m.stop({ reason: "primary", at: last }); }
    const at = timing === "deadline" ? s.at(op.deadline_ns) : timing === "unavailable" ? null : timing === "foreign" ? { ...s.tick(), clock_domain: "foreign" }
      : timing === "rollback" ? point(0) : s.tick();
    const expected = assessUnsignedParentCallback({ kind: "GO", reservation: r, last_ns: last.monotonic_ns, at, started: true, callback_seen: false,
      previous_decision: "started", observed_outcome: outcome, stopped, shutdown: false, clock_invalid: false });
    s.m.completeWrite(op.reference, { outcome, at }); const actual = s.m.describe(), w = actual.writes.at(-1);
    assert.equal(w.decision, expected.decision); assert.deepEqual(w.callback_at, expected.callback_at); assert.equal(w.callback, expected.observed_outcome);
    assert.equal(actual.clock_invalid, expected.clock_failure !== null); if (stopped) assert.equal(actual.stopped, "primary");
  });
for (const outcome of ["completed", "uncertain"]) for (const timing of ["timely", "deadline", "unavailable"])
  test(`B4-B1 callback calculation matches original shutdown CANCEL: ${outcome}/${timing}`, () => {
    const s = active(); s.m.stop({ reason: "primary", at: s.tick() }); const when = s.tick(), before = s.m.describe();
    const op = s.m.planShutdown({ at: when, worker_live: true, pipe_qualified: true }); assert.equal(op.decision, "CANCEL_THEN_CLOSE");
    const r = planUnsignedParentReservation({ clock_domain: when.clock_domain, planned_ns: when.monotonic_ns,
      phase_deadline_ns: before.phase_deadline_ns, cohort_deadline_ns: before.cohort_deadline_ns }).reservation;
    assert.equal(r.deadline_ns, op.deadline_ns); const last = s.tick(); s.m.startWrite(op.reference, { at: last });
    const at = timing === "deadline" ? s.at(op.deadline_ns) : timing === "unavailable" ? null : s.tick();
    const expected = assessUnsignedParentCallback({ kind: "CANCEL", reservation: r, last_ns: last.monotonic_ns, at, started: true, callback_seen: false,
      previous_decision: "started", observed_outcome: outcome, stopped: true, shutdown: true, clock_invalid: false });
    s.m.completeWrite(op.reference, { outcome, at }); const w = s.m.describe().writes.at(-1);
    assert.equal(w.decision, expected.decision); assert.deepEqual(w.callback_at, expected.callback_at); assert.equal(s.m.describe().stopped, "primary");
  });
for (const left of [999999n, 1000000n, 1000500123n, 10000500123n])
  test("B4-B1 full-ms reservation matches original transport at remaining ns " + left, () => {
    const s = ready(), before = s.m.describe(), when = s.at(BigInt(before.phase_deadline_ns) - left);
    const d = { clock_domain: when.clock_domain, planned_ns: when.monotonic_ns, phase_deadline_ns: before.phase_deadline_ns, cohort_deadline_ns: before.cohort_deadline_ns };
    const request = { kind: "PREPARE", payload: { configuration: configuration(fixture()), launch_nonce: "nonce-1" }, binding: { ...before.binding, setup: setup() }, at: when };
    if (left < 1000000n) {
      assert.throws(() => planUnsignedParentReservation(d), /reservation_remainder/); assert.throws(() => s.m.planCommand(request), /deadline/);
    } else assert.equal(planUnsignedParentReservation(d).reservation.deadline_ns, s.m.planCommand(request).deadline_ns);
  });
for (const outcome of ["completed", "uncertain"])
  test(`B4-B1 prior-uncertain late callback keeps the documented transport reference difference: ${outcome}`, () => {
    const s = baselined(), when = s.tick(), before = s.m.describe();
    const op = s.m.planCommand({ kind: "GO", payload: goPayload(s), at: when });
    const r = planUnsignedParentReservation({ clock_domain: when.clock_domain, planned_ns: when.monotonic_ns,
      phase_deadline_ns: before.phase_deadline_ns, cohort_deadline_ns: before.cohort_deadline_ns }).reservation;
    s.m.startWrite(op.reference, { at: s.tick() }); const expiry = s.at(BigInt(op.deadline_ns) + 5n); s.m.stop({ reason: "primary", at: expiry });
    assert.equal(s.m.describe().writes.at(-1).decision, "uncertain"); assert.equal(s.m.describe().stopped, "write_deadline");
    const late = s.at(BigInt(op.deadline_ns) + 10n);
    const expected = assessUnsignedParentCallback({ kind: "GO", reservation: r, last_ns: expiry.monotonic_ns, at: late, started: true, callback_seen: false,
      previous_decision: "uncertain", observed_outcome: outcome, stopped: true, shutdown: false, clock_invalid: false });
    s.m.completeWrite(op.reference, { outcome, at: late }); const w = s.m.describe().writes.at(-1);
    assert.equal(w.decision, "uncertain"); assert.equal(expected.decision, "uncertain"); assert.equal(expected.relay_outcome, null);
    // The unchanged reference transport keeps this post-deadline sample as callback_at; the parent contract keeps it only as an observation.
    assert.deepEqual(w.callback_at, late); assert.equal(expected.callback_at, null); assert.deepEqual(expected.observation_point, late);
  });
test("B4-B1 the pure checkpoint alone does not enforce the existing sub-ms phase window", () => {
  const s = ready(), before = s.m.describe(), end = BigInt(before.phase_deadline_ns), when = s.at(end - 5000000n);
  const op = s.m.planCommand({ kind: "PREPARE", payload: { configuration: configuration(fixture()), launch_nonce: "nonce-1" },
    binding: { ...before.binding, setup: setup() }, at: when });
  const r = planUnsignedParentReservation({ clock_domain: when.clock_domain, planned_ns: when.monotonic_ns,
    phase_deadline_ns: before.phase_deadline_ns, cohort_deadline_ns: before.cohort_deadline_ns }).reservation;
  assert.equal(r.deadline_ns, op.deadline_ns); assert.equal(r.deadline_ns, String(end));
  const started = s.tick(); s.m.startWrite(op.reference, { at: started }); const late = s.at(end - 900000n);
  const checkpoint = planUnsignedParentCheckpoint({ clock_domain: when.clock_domain, last_b2_ns: started.monotonic_ns, at: late,
    phase_deadline_ns: before.phase_deadline_ns, cohort_deadline_ns: before.cohort_deadline_ns, pending: { reservation: r, started: true }, stopped: false, clock_invalid: false });
  const assessed = assessUnsignedParentCallback({ kind: "PREPARE", reservation: r, last_ns: started.monotonic_ns, at: late, started: true, callback_seen: false,
    previous_decision: "started", observed_outcome: "completed", stopped: false, shutdown: false, clock_invalid: false });
  s.m.completeWrite(op.reference, { outcome: "completed", at: late }); const after = s.m.describe(), w = after.writes.at(-1);
  // The original window stops at an observation with under 1 ms of phase left; the pure checkpoint stops only at the bound itself.
  assert.equal(after.stopped, "phase_deadline"); assert.equal(w.decision, "started"); assert.equal(w.callback_at, null);
  assert.equal(checkpoint.route, "normal"); assert.equal(checkpoint.stop_first, null); assert.equal(assessed.decision, "completed");
});
// A failing after hook is not a failed test under --test-isolation=none or a direct run, so this last test carries the check.
test("B4-A no denied effect was swallowed by an earlier test", () => assert.deepEqual(effects, []));
