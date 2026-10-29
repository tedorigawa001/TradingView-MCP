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
import dgram from "node:dgram";
import tls from "node:tls";
import http2 from "node:http2";
import dns from "node:dns";
import inspector from "node:inspector";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const effects = [], restores = [], blocked = [];
// Accessor exports such as fs.ReadStream and fs.Utf8Stream are shadowed, not assigned, so a setter cannot redirect Node's own stream classes.
const replace = (o, k, f) => {
  const d = Object.getOwnPropertyDescriptor(o, k), accessor = d && !("value" in d);
  if (accessor) Object.defineProperty(o, k, { value: f, writable: true, configurable: true, enumerable: d.enumerable }); else o[k] = f;
  restores.push(() => { if (accessor) Object.defineProperty(o, k, d); else if (d) o[k] = d.value; else delete o[k]; });
};
// A constructible recorder: `new Worker()` must reach it instead of failing as a non-constructor before recording.
const block = (o, keys) => keys.filter((k) => typeof o[k] === "function").forEach((k) => {
  blocked.push([o, k]); replace(o, k, function () { effects.push(k); throw Error("cc4b2_forbidden_effect"); });
});
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]); block(workers, ["Worker"]);
block(crypto, ["sign", "verify", "createSign", "createVerify", "createPrivateKey", "createPublicKey", "createSecretKey", "generateKey", "generateKeySync",
  "generateKeyPair", "generateKeyPairSync", "privateEncrypt", "privateDecrypt", "publicEncrypt", "publicDecrypt", "diffieHellman", "createDiffieHellman", "createECDH"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "deriveKey", "deriveBits", "encrypt", "decrypt", "wrapKey", "unwrapKey"]);
block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"]);
block(net, ["connect", "createConnection", "createServer"]); block(net.Socket.prototype, ["connect"]);
block(http, ["request", "get", "createServer"]); block(https, ["request", "get", "createServer"]); block(http2, ["connect", "createServer", "createSecureServer"]);
block(dgram, ["createSocket"]); block(tls, ["connect", "createServer"]); block(globalThis, ["fetch", "WebSocket", "EventSource"]);
for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter((k) => /^(lookup|resolve|reverse)/.test(k)));
block(inspector, ["open", "Session"]);
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "ftruncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename",
  "chmod", "fchmod", "lchmod", "chown", "fchown", "lchown", "symlink", "link", "utimes", "futimes", "lutimes"];
const streams = ["ReadStream", "FileReadStream", "WriteStream", "FileWriteStream", "Utf8Stream"], scans = ["glob", "statfs", "watch", "mkdtempDisposable"];
block(fs, [...mutations, ...mutations.map((k) => k + "Sync"), "createWriteStream", ...streams, ...scans, ...scans.map((k) => k + "Sync"), "openAsBlob", "watchFile"]);
block(fsp, [...mutations, ...scans]);
const roots = ["../helpers/", "../../node_modules/"].map((s) => fileURLToPath(new URL(s, import.meta.url)));
roots.push(...roots.map((s) => fs.realpathSync(s) + sep));
// Contents, listings and metadata may be read only below the helper and dependency roots, and only read-only.
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
    effects.push(k); throw Error("cc4b2_forbidden_read");
  });
}
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach((f) => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });

const runtime = await import("../helpers/unsignedCohortRuntime.mjs");

const { createUnsignedCohortAssemblyModel } = await import("../helpers/unsignedCohortAssemblyModel.mjs");
const { describeUnsignedFixture, describeUnsignedAcceptanceRun } = await import("../helpers/jointUnsignedAcceptanceContracts.mjs");
const { uint, label, code, parse, canonical, digest, byteLength, sha, freeze, flags, LIMITS } = await import("../helpers/unsignedControllerData.mjs");
const { assessUnsignedControllerAssertions } = await import("../helpers/unsignedControllerObservation.mjs");
const { createUnsignedControllerProtocolModel, createUnsignedControllerWindowModel } = await import("../helpers/unsignedControllerContracts.mjs");
const { createUnsignedControllerEvidenceModel, createUnsignedControllerCohortModel, describeUnsignedControllerSerializationCapacity } = await import("../helpers/unsignedControllerEvidence.mjs");
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

const catalog = describeUnsignedAcceptanceRun(fixture().request).cases;
const point = (ns = "1") => ({ clock_domain: "parent-clock", monotonic_ns: ns });
const assembly = (limit = "30000000") => createUnsignedCohortAssemblyModel({ request: fixture().request,
  clock: { clock_domain: "parent-clock", started_ns: "0", cohort_limit_ms: limit } });
const alloc = (n = 0) => ({ ...allocation(catalog[n].case_id, catalog[n].mode), exchange_id: "exchange-" + n, launch_nonce: "nonce-" + n });
test("4-B2 runtime stays sealed without inspecting supplied capabilities", () => {
  const bad = new Proxy({}, { get() { throw Error("caller_getter"); }, ownKeys() { throw Error("caller_keys"); } });
  assert.throws(() => runtime.executeUnsignedCohortAssembly(bad), /cc4b2_execution_not_approved/);
  const d = runtime.inspectUnsignedCohortAssembly(); assert.equal(d.execution_available, false);
  assert.equal(d.native_status, "NOT_RUN"); assert.equal(d.runtime_qualified, false);
});
test("4-B2 begins the fixed first case without granting execution or exposing mutable models", () => {
  const m = assembly(), token = m.beginCase({ allocation: alloc(), at: point() });
  assert.deepEqual(Object.keys(token), []); assert.equal(Object.isFrozen(token), true);
  assert.equal(m.describe().active.case_id, catalog[0].case_id); assert.equal(m.describe().execution_available, false);
  assert.equal(m.describe().runtime_completion_proven, false); assert.equal(m.describe().active.protocol_state, "NEW");
  assert.throws(() => runtime.executeUnsignedCohortAssembly(token), /execution_not_approved/);
});
test("4-B2 malformed or out-of-order case permanently stops the assembly", () => {
  const m = assembly();
  assert.throws(() => m.beginCase({ allocation: alloc(1), at: point() }), /cc4b2_case_binding/);
  assert.equal(m.describe().stopped, true);
  assert.throws(() => m.beginCase({ allocation: alloc(), at: point() }), /cc4b2_stopped/);
  m.finishNotRun(); assert.equal(m.describe().rows.length, 24);
});
test("4-B2 whole-case time is derived rather than accepted from a caller", () => {
  const m = assembly("900000");
  assert.throws(() => m.beginCase({ allocation: alloc(), at: point("1000001") }), /cc4b2_cohort_window/);
  const q = assembly(); assert.throws(() => q.beginCase({ allocation: alloc(), at: point(), remaining_ms: "999999999" }), /invalid_input/);
  assert.equal(q.describe().stopped, true);
});

function driver(m = assembly(), n = 0, start = 1n) {
  let ns = start; const tick = () => point(String(ns++));
  const token = m.beginCase({ allocation: alloc(n), at: tick() });
  const event = (kind, payload = {}, at = tick()) => m.applyModelEvent(token, { kind, payload, at });
  function frame(kind, payload = {}, binding = m.describe().active.binding, write = true) {
    const p = m.describe().active, direction = ["LAUNCH", "PREPARE", "GO", "CANCEL", "FINALIZE"].includes(kind) ? "parent" : "worker";
    const ordinal = p.next_ordinals[direction], line = canonical({ binding, direction, ordinal, kind, payload }) + "\n";
    event("frame", { line });
    if (direction === "parent" && write) { event("write", { ordinal, outcome: "started" }); event("write", { ordinal, outcome: "completed" }); }
    return line;
  }
  function record(kind, payload = {}) {
    const at = tick(), encoded = event("receipt", { kind, payload, stamp: { ...at, wall_utc: "2026-10-29T00:00:00.000Z", wall_jst: "2026-10-29T09:00:00.000+09:00" } }, at);
    if (suspend?.kind === kind) m.stop({ reason: "primary", at: tick() });
    event("receipt_readback", { line: encoded.line }); return encoded;
  }
  let suspend = null;
  return { m, token, tick, event, frame, record, n, stopBeforeReadback(kind) { suspend = { kind }; } };
}
function readyDriver(s = driver()) {
  s.record("case_allocated"); s.event("resource", { resource: "worker", action: "attach" }); s.frame("LAUNCH");
  s.readyLine = s.frame("READY", { addon_protocol: 6, mode: "synthetic_only", worker_clock_domain: "worker-clock", pins_sha256: digest(s.m.describe().active.binding) }); return s;
}
test("4-B2 connects LAUNCH and READY only to the original modeled worker slot", () => {
  const s = readyDriver(); assert.equal(s.m.describe().active.protocol_state, "READY");
  assert.equal(s.m.describe().active.slots.worker, "live");
  assert.equal(s.m.describe().active.window.phase, "preparation");
});

function prepare(s = readyDriver(), recordedBaseline = baselineValue) {
  const f = fixture(catalog[s.n].case_id, catalog[s.n].mode), recipe = describeUnsignedFixture(f);
  s.proofs = recipe.entries.map((e, i) => ({ kind: e.kind, device: "1", inode: String(100 + i), uid: "501", gid: "20", mode: e.mode,
    flags: "0", birthtime_ns: "1", mtime_ns: "1", ctime_ns: "1", nlink: e.kind === "file" ? "1" : "2", size: e.size ?? "0",
    allocated_bytes: "0", acl: "none", acl_hash: h, sha256: e.sha256 ?? null }));
  for (const [i, proof] of s.proofs.entries()) {
    s.record("create_intent", { entry_index: i, ...(i === 0 ? { ready_sha256: sha(s.readyLine) } : {}) });
    s.record("create_result", { entry_index: i, proof, ...(i === 0 ? { fixture_name: f.fixture_name } : {}) });
  }
  s.record("setup_sealed", { inventory_sha256: h, setup: setup(f) });
  s.frame("PREPARE", { configuration: configuration(f), launch_nonce: alloc(s.n).launch_nonce }, { ...s.m.describe().active.binding, setup: setup(f) });
  s.frame("BASELINED", baselineValue); s.record("worker_prepared"); s.record("baseline_bound", recordedBaseline); return s;
}
const goPayload = (s) => ({ baseline_sha256: s.m.describe().active.baseline_sha256, baseline_readback: true, go_intent_readback: true });
test("4-B2 GO requires the same confirmed baseline and intent, not its own booleans", () => {
  const s = prepare(); assert.throws(() => s.frame("GO", goPayload(s)), /cc4b2_go_readback/);
  assert.equal(s.m.describe().active.window.starts.query, undefined); assert.equal(s.m.describe().stopped, true);
});
test("4-B2 accepted GO starts no query window until its original write starts", () => {
  const s = prepare(); s.record("go_intent", { baseline_sha256: s.m.describe().active.baseline_sha256, bound_objects_sha256: null });
  s.frame("GO", goPayload(s), undefined, false);
  assert.equal(s.m.describe().active.window.phase, "preparation"); assert.equal(s.m.describe().active.go_submitted, false);
  s.event("write", { ordinal: 3, outcome: "started" });
  assert.equal(s.m.describe().active.window.phase, "query"); assert.equal(s.m.describe().active.go_submitted, true);
});

function go(s = prepare()) {
  s.record("go_intent", { baseline_sha256: s.m.describe().active.baseline_sha256, bound_objects_sha256: null });
  s.frame("GO", goPayload(s)); return s;
}
function settle(s = go(), candidate = "BLOCKED", options = {}) {
  const p = s.m.describe().active, c = catalog[s.n];
  const observation = options.projection ? { primary_code: c.expected_code,
    available: { diagnostic: true, inventory: false, capture: false, usage: false },
    diagnostic: { origin: "original_diagnostic", sha256: h, state: "released", cleanup: "confirmed", requests_dispatched: 1, authenticated_requests: 0 },
    inventory: null, capture: null, usage: null, native_throws: [], instrumentation_overflow: false,
    c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null } : null;
  const f = fixture(c.case_id, c.mode), comparison = observation ? { witness: null, configuration: configuration(f), supplied_registration: null, bound_objects: null } : null;
  const assessment = observation ? assessUnsignedControllerAssertions({ request: f.request, fixture: f, case_id: c.case_id, observation,
    reader_source_sha256: h, reader_js_sha256: h, registration_sha256: setup(f).registration_sha256, envelope_sha256: setup(f).envelope_sha256,
    ...comparison, bound_object_receipts: { pre_sha256: null, post_sha256: null } }) : null;
  if (observation) s.frame("OBSERVED", observation);
  const released = { baseline_sha256: p.baseline_sha256, resources, query: "settled", native: "settled", original_operation_retired: true, query_released: true,
    close_errors: [], diagnostic_sha256: h, observation_sha256: observation ? digest(observation) : null, trace_chunks: 0, trace_events: 0, trace_sha256: p.trace_sha256,
    primary_code: c.expected_code, requests_dispatched: options.c1 ? 2 : 1, authenticated_requests: c.owner === "fixed_memory" ? 1 : 0,
    c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null };
  s.frame("RELEASED", released);
  s.record("run_outcome", { primary_code: released.primary_code, requests_dispatched: released.requests_dispatched, authenticated_requests: released.authenticated_requests,
    diagnostic_sha256: h, observation_sha256: released.observation_sha256, observation_bytes: observation ? byteLength(canonical(observation)) : 0,
    trace_sha256: p.trace_sha256, trace_events: 0, ...options.outcome_override });
  s.record("release_checked", { baseline_sha256: p.baseline_sha256, resources, query_released: true, original_operation_retired: true,
    close_errors: [], bound_objects_sha256: null });
  s.record("cleanup_precheck", { inventory_sha256: h });
  const recipe = describeUnsignedFixture(fixture(c.case_id, c.mode));
  const depth = (p) => p ? p.split("/").length : 0;
  const order = recipe.entries.map((e, i) => ({ ...e, i })).sort((a, b) => depth(b.path) - depth(a.path)
    || (a.kind === b.kind ? 0 : a.kind === "file" ? -1 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const e of order) { s.record("delete_intent", { entry_index: e.i, proof: s.proofs[e.i] }); s.record("delete_result", { entry_index: e.i, outcome: "removed" }); }
  s.record("absence_checked", { anchor_same: true, root_removed: true, absent: true });
  s.frame("FINALIZE"); s.event("command_close", { outcome: "confirmed" }); s.event("worker_exit", { exit_code: 0, signal: null });
  s.event("resource", { resource: "worker", action: "close", outcome: "confirmed" }); s.record("worker_finalized", { exit_code: 0, signal: null });
  if (options.stopAt === "before_candidate") s.m.stop({ reason: "primary", at: s.tick() });
  s.record("ready_to_report", { candidate_outcome: candidate, assessment_sha256: assessment ? digest(assessment) : null });
  if (options.stopAt === "after_candidate") s.m.stop({ reason: "primary", at: s.tick() });
  const at = s.tick(), report = s.event("report", { observation, trace: [], comparison, limitations: [],
    save_stamp: { ...at, wall_utc: "2026-10-29T00:00:00.000Z", wall_jst: "2026-10-29T09:00:00.000+09:00" } }, at);
  s.event("report_readback", { line: report.line }); s.record("terminal", { report_sha256: report.sha256 });
  s.event("case_closes", options.closes ?? { receipt: "confirmed", report: "confirmed", errors: [] });
  const row = s.event("index_row"); s.event("index_readback", { line: row.line }); return s;
}
test("4-B2 a complete model lifecycle derives clean settlement without execution authority", () => {
  const s = settle(); s.m.finishCase(s.token, { at: s.tick() });
  const d = s.m.describe(); assert.equal(d.rows.length, 1); assert.equal(d.rows[0].cleanly_settled, true);
  assert.equal(d.rows[0].model_verdict, "BLOCKED"); assert.equal(d.active, null); assert.equal(d.execution_available, false);
});
test("4-B2 all 24 fixed cases retain their outcomes and one shared index without extending the deadline", () => {
  const m = assembly(), end = m.describe().cohort_deadline_ns;
  for (let n = 0; n < 24; n++) {
    const s = driver(m, n, BigInt(n + 1) * 1000000n); readyDriver(s); prepare(s); go(s); settle(s, n === 2 ? "FAIL" : "BLOCKED");
    assert.ok(byteLength(canonical(m.describe())) <= m.describe().capacity.diagnostic_ceiling_bytes);
    m.finishCase(s.token, { at: s.tick() }); assert.equal(m.describe().cohort_deadline_ns, end);
    assert.equal(m.describe().stopped, false);
  }
  const d = m.closeIndex({ outcome: "confirmed", at: point("25000000") });
  assert.equal(d.rows.length, 24); assert.equal(d.rows[2].model_verdict, "FAIL"); assert.equal(d.index_close, "confirmed");
  assert.equal(d.runtime_completion_proven, false); assert.equal(d.closed, true);
  assert.throws(() => m.beginCase({ allocation: alloc(), at: point("26000000") }), /cc4b2_closed/);
});
test("4-B2 a consistent supplied scenario never becomes a native PASS or approval", () => {
  const s = settle(go(), "MODEL_CONSISTENT", { projection: true }); s.m.finishCase(s.token, { at: s.tick() });
  const d = s.m.describe(); assert.equal(d.rows[0].model_verdict, "MODEL_CONSISTENT");
  for (const [k, v] of Object.entries(d)) if (/_verified$|_available$|_authenticated$|_qualified$|_proven$|^evidence_saved$/.test(k)) assert.equal(v, false, k);
  assert.equal(d.native_status, "NOT_RUN"); assert.throws(() => runtime.executeUnsignedCohortAssembly(d), /execution_not_approved/);
});
test("4-B2 a modeled C1 violation retains its final FAIL row and stops the rest", () => {
  const s = settle(go(), "FAIL", { c1: true }); const d = s.m.finishCase(s.token, { at: s.tick() });
  assert.equal(d.stopped, true); assert.equal(d.rows[0].c1_violation, true); assert.equal(d.rows[0].model_verdict, "FAIL");
  s.m.finishNotRun(); assert.equal(s.m.describe().rows.filter((r) => r.model_verdict === "NOT_RUN").length, 23);
});

test("4-B2 observer attachments consume the unchanged 64-call allowance", () => {
  const s = driver();
  for (let i = 0; i < 64; i++) { s.event("resource", { resource: "observer", action: "attach" }); s.event("resource", { resource: "observer", action: "close", outcome: "confirmed" }); }
  assert.throws(() => s.event("resource", { resource: "observer", action: "attach" }), /observer_capacity/);
});
for (const fake of [() => ({}), (s) => structuredClone(s.token), (s) => s.m.describe(), () => driver().token])
  test("4-B2 fake, cloned, reported or foreign case tokens stop without granting access", () => {
    const s = driver(); assert.throws(() => s.m.applyModelEvent(fake(s), { kind: "resource", payload: { resource: "worker", action: "attach" }, at: s.tick() }), /case_reference/);
    assert.equal(s.m.describe().stopped, true);
  });
test("4-B2 an unconfirmed resource close is retained and cannot be upgraded", () => {
  const s = driver(); s.event("resource", { resource: "observer", action: "attach" });
  s.event("resource", { resource: "observer", action: "close", outcome: "unconfirmed" });
  assert.equal(s.m.describe().active.slots.observer, "retained"); const reason = s.m.describe().stop_reason;
  assert.throws(() => s.event("resource", { resource: "observer", action: "close", outcome: "confirmed" }), /resource_order/);
  assert.equal(s.m.describe().stop_reason, reason); s.m.finishNotRun(); assert.equal(s.m.describe().rows.length, 24);
});
test("4-B2 cleanly settled cannot be asserted to hide a live observer", () => {
  const s = settle(); s.event("resource", { resource: "observer", action: "attach" });
  const d = s.m.finishCase(s.token, { at: s.tick() }); assert.equal(d.stopped, true); assert.equal(d.rows[0].cleanly_settled, false);
  assert.equal(d.active.slots.observer, "live"); assert.throws(() => s.m.beginCase({ allocation: alloc(1), at: s.tick() }), /stopped/);
});
test("4-B2 finish rejects caller-supplied settlement or verdict overrides", () => {
  const s = settle(); assert.throws(() => s.m.finishCase(s.token, { at: s.tick(), cleanly_settled: true, model_verdict: "MODEL_CONSISTENT" }), /invalid_input/);
  assert.equal(s.m.describe().stopped, true); assert.equal(s.m.describe().rows.length, 0);
});
test("4-B2 stop before GO closes only and cannot mint a cancellation", () => {
  const s = readyDriver(); s.m.stop({ reason: "manual_stop", at: s.tick() });
  const p = s.event("shutdown_plan"); assert.equal(p.decision, "CLOSE_ONLY");
  s.event("command_close", { outcome: "confirmed" }); assert.throws(() => s.frame("PREPARE"), /stopped/);
});
test("4-B2 uncertain GO preserves partial progress and permits close only, never resend", () => {
  const s = prepare(); s.record("go_intent", { baseline_sha256: s.m.describe().active.baseline_sha256, bound_objects_sha256: null });
  s.frame("GO", goPayload(s), undefined, false); s.event("write", { ordinal: 3, outcome: "started" });
  s.event("write", { ordinal: 3, outcome: "uncertain" }); const d = s.m.describe();
  assert.equal(d.stopped, true); assert.equal(d.active.go_submitted, true); assert.equal(s.event("shutdown_plan").decision, "CLOSE_ONLY");
  assert.throws(() => s.event("write", { ordinal: 3, outcome: "completed" }), /write_order/);
  assert.throws(() => s.frame("GO", goPayload(s)), /stopped/);
});
test("4-B2 one shutdown CANCEL shares the original ordinal ledger and never renews grace", () => {
  const s = go(); s.m.stop({ reason: "original_failure", at: s.tick() }); const end = s.m.describe().active.window.phase_deadline_ns;
  const p = s.event("shutdown_plan"); assert.equal(p.decision, "CANCEL_THEN_CLOSE"); assert.equal(JSON.parse(p.frame).ordinal, 4);
  s.event("shutdown_write", { outcome: "started" }); s.event("shutdown_write", { outcome: "completed" });
  assert.equal(s.event("shutdown_plan").decision, "CLOSE_ONLY"); assert.equal(s.m.describe().active.window.phase_deadline_ns, end);
  s.event("command_close", { outcome: "confirmed" }); assert.throws(() => s.event("command_close", { outcome: "confirmed" }), /close_order/);
});
test("4-B2 late preparation timeout anchors grace to the original deadline", () => {
  const s = driver(), deadline = s.m.describe().active.window.phase_deadline_ns;
  assert.throws(() => s.event("resource", { resource: "helper", action: "attach" }, point(String(BigInt(deadline) + 2000000n))), /deadline/);
  const d = s.m.describe(); assert.equal(d.first_stop_ns, deadline);
  assert.equal(d.active.window.phase_deadline_ns, String(BigInt(deadline) + 60000000000n));
});
test("4-B2 a clock rollback blocks shutdown dispatch and cannot be repaired with a later stamp", () => {
  const s = go(); assert.throws(() => s.event("resource", { resource: "helper", action: "attach" }, point("0")), /clock_order/);
  assert.equal(s.m.describe().clock_invalid, true); assert.equal(s.event("shutdown_plan").decision, "CLOSE_ONLY");
  assert.throws(() => s.frame("FINALIZE"), /stopped/);
});
test("4-B2 metadata projections fit a declared bound separate from native memory", () => {
  const s = settle(), d = s.m.describe();
  assert.ok(d.capacity.diagnostic_ceiling_bytes <= 16384); assert.ok(byteLength(canonical(d)) <= d.capacity.diagnostic_ceiling_bytes);
  assert.ok(d.capacity.coordinator_json_ceiling_bytes <= 65536); assert.equal(d.capacity.native_budget_changed, false);
});

test("4-B2 effect recorders intercept calls and constructors before any real operation", () => {
  const before = effects.length;
  for (const [o, k] of blocked) { assert.throws(() => o[k](), /cc4b2_forbidden_effect/, k); assert.throws(() => new o[k](), /cc4b2_forbidden_effect/, k); }
  const outside = fileURLToPath(new URL("../../package.json", import.meta.url));
  for (const attempt of [() => fs.statSync(outside), () => fs.readFileSync(outside), () => fs.realpathSync(outside)]) assert.throws(attempt, /cc4b2_forbidden_read/);
  assert.equal(effects.length, before + blocked.length * 2 + 3); effects.length = before;
});

const newWith = (factory) => factory({ request: fixture().request, clock: { clock_domain: "parent-clock", started_ns: "0", cohort_limit_ms: "30000000" } });
const probes = {
  reference(factory) { const s = driver(newWith(factory)); assert.throws(() => s.m.applyModelEvent({}, { kind: "resource", payload: { resource: "helper", action: "attach" }, at: s.tick() }), /case_reference/); },
  go_readback(factory) { const s = prepare(readyDriver(driver(newWith(factory)))); assert.throws(() => s.frame("GO", goPayload(s)), /go_readback/); },
  query_start(factory) { const s = prepare(readyDriver(driver(newWith(factory)))); s.record("go_intent", { baseline_sha256: s.m.describe().active.baseline_sha256, bound_objects_sha256: null });
    s.frame("GO", goPayload(s), undefined, false); assert.equal(s.m.describe().active.window.phase, "preparation"); s.event("write", { ordinal: 3, outcome: "started" }); assert.equal(s.m.describe().active.window.phase, "query"); },
  first_failure(factory) { const s = driver(newWith(factory)); s.m.stop({ reason: "original_failure", at: s.tick() }); assert.throws(() => s.event("resource", { resource: "helper", action: "attach" })); assert.equal(s.m.describe().stop_reason, "original_failure"); },
  live_slot(factory) { const s = settle(go(prepare(readyDriver(driver(newWith(factory)))))); s.event("resource", { resource: "observer", action: "attach" }); assert.equal(s.m.finishCase(s.token, { at: s.tick() }).stopped, true); },
  cross_case_clock(factory) { const m = newWith(factory), s = settle(go(prepare(readyDriver(driver(m))))); m.finishCase(s.token, { at: s.tick() }); assert.throws(() => m.beginCase({ allocation: alloc(1), at: point("1") }), /clock_order/); },
  observer_limit(factory) { const s = driver(newWith(factory)); for (let i = 0; i < 64; i++) { s.event("resource", { resource: "observer", action: "attach" }); s.event("resource", { resource: "observer", action: "close", outcome: "confirmed" }); }
    assert.throws(() => s.event("resource", { resource: "observer", action: "attach" }), /observer_capacity/); },
  mode_binding(factory) { const m = newWith(factory), s = settle(go(prepare(readyDriver(driver(m))))); m.finishCase(s.token, { at: s.tick() }); const a = alloc(1); a.artifacts.addon_sha256 = "b".repeat(64); assert.throws(() => m.beginCase({ allocation: a, at: s.tick() }), /mode_binding/); },
  setup_readback(factory) { const s = readyDriver(driver(newWith(factory))), f = fixture(catalog[0].case_id); assert.throws(() => s.frame("PREPARE", { configuration: configuration(f), launch_nonce: alloc().launch_nonce }, { ...s.m.describe().active.binding, setup: setup(f) }), /setup_readback/); },
  baseline_binding(factory) { assert.throws(() => prepare(readyDriver(driver(newWith(factory))), { resources: { ...resources, fds: "5" }, clock_domain: "worker-clock" }), /baseline_binding/); },
  outcome_binding(factory) { assert.throws(() => settle(go(prepare(readyDriver(driver(newWith(factory))))), "BLOCKED", { outcome_override: { diagnostic_sha256: "b".repeat(64) } }), /outcome_binding/); },
  phase_window(factory) { const s = driver(newWith(factory)); assert.throws(() => s.event("resource", { resource: "helper", action: "attach" }, point("120000000002")), /deadline/); },
  c1_stop(factory) { const s = settle(go(prepare(readyDriver(driver(newWith(factory))))), "FAIL", { c1: true }); assert.equal(s.m.finishCase(s.token, { at: s.tick() }).stopped, true); },
};
for (const [name, probe] of Object.entries(probes)) test(`4-B2 cross-model gate: ${name}`, () => probe(createUnsignedCohortAssemblyModel));

const modelSource = fs.readFileSync(new URL("../helpers/unsignedCohortAssemblyModel.mjs", import.meta.url), "utf8");
function memoryFactory(source) {
  const tree = ts.createSourceFile("model.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); assert.equal(tree.parseDiagnostics.length, 0);
  const body = tree.statements.filter((n) => !ts.isImportDeclaration(n)).map((n) => n.getText().replace(/^export /, "")).join("\n");
  const dependencies = { z, describeUnsignedAcceptanceRun, describeUnsignedFixture, createUnsignedControllerProtocolModel, createUnsignedControllerWindowModel,
    createUnsignedControllerEvidenceModel, createUnsignedControllerCohortModel, describeUnsignedControllerSerializationCapacity, uint, label, code, parse, canonical, digest, sha, byteLength, freeze, flags, LIMITS };
  return vm.compileFunction(body + "\nreturn createUnsignedCohortAssemblyModel;", Object.keys(dependencies))(...Object.values(dependencies));
}
function replaceCall(source, reason) {
  const tree = ts.createSourceFile("model.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); let target;
  function visit(n) { if (ts.isCallExpression(n) && n.expression.getText() === "equal" && n.arguments[2]?.text === reason) target = n; ts.forEachChild(n, visit); } visit(tree);
  assert.ok(target); return source.slice(0, target.getStart()) + "void 0" + source.slice(target.end);
}
const behaviorMutations = {
  reference: (s) => s.replace("!active || token !== active.token", "!active"),
  go_readback: (s) => s.replace(" || !c.confirmed.go_intent", ""),
  query_start: (s) => s.replace("c.window.submitGo(q.at)", "void 0"),
  first_failure: (s) => s.replace("if (stopped) return;", ""),
  live_slot: (s) => s.replace(" && !live(c.slots)", ""),
  cross_case_clock: (s) => s.replace(" || BigInt(at.monotonic_ns) < last", ""),
  observer_limit: (s) => s.replace('if (c.observerCalls >= 64) refuse("observer_capacity");', ""),
  mode_binding: (s) => replaceCall(s, "mode_binding"),
  setup_readback: (s) => replaceCall(s, "setup_readback"),
  baseline_binding: (s) => replaceCall(s, "baseline_binding"),
  outcome_binding: (s) => replaceCall(s, "outcome_binding"),
  phase_window: (s) => s.replace("if (!stopped) c.window.inspect(q.at);", ""),
  c1_stop: (s) => s.replace("if (!clean || p.c1_violation) latch", "if (!clean) latch"),
};
test("4-B2 extracted unchanged assembly is behaviorally equivalent for every gate probe", () => {
  const factory = memoryFactory(modelSource); for (const probe of Object.values(probes)) probe(factory);
});
for (const [name, mutate] of Object.entries(behaviorMutations)) test(`4-B2 detects removed behavioral guard: ${name}`, () => {
  const changed = mutate(modelSource); assert.notEqual(changed, modelSource);
  assert.throws(() => probes[name](memoryFactory(changed)), assert.AssertionError);
});

for (const field of ["backend", "signer", "clock", "fd", "pid", "path"]) test(`4-B2 rejects injected ${field} without reading its getter`, () => {
  const s = driver(), input = { kind: "resource", payload: { resource: "helper", action: "attach" }, at: s.tick() }; let read = 0;
  Object.defineProperty(input, field, { enumerable: true, get() { read++; throw Error("getter"); } });
  assert.throws(() => s.m.applyModelEvent(s.token, input), /invalid_input/); assert.equal(read, 0); assert.equal(s.m.describe().stopped, true);
});
test("4-B2 receipt clocks and pending intent readback cannot be bypassed", () => {
  const s = prepare(), at = s.tick();
  const pending = s.event("receipt", { kind: "go_intent", payload: { baseline_sha256: s.m.describe().active.baseline_sha256, bound_objects_sha256: null },
    stamp: { ...at, wall_utc: "2026-10-29T00:00:00.000Z", wall_jst: "2026-10-29T09:00:00.000+09:00" } }, at);
  assert.ok(pending.line); assert.throws(() => s.frame("GO", goPayload(s)), /go_readback/);
  assert.equal(s.m.describe().active.go_submitted, false); assert.equal(s.m.describe().active.slots.fixture, "live");
  const q = driver(); assert.throws(() => q.event("receipt", { kind: "case_allocated", payload: {}, stamp: {
    clock_domain: "other", monotonic_ns: "1", wall_utc: "2026-10-29T00:00:00.000Z", wall_jst: "2026-10-29T09:00:00.000+09:00" } }), /receipt_clock/);
  assert.equal(q.m.describe().active.evidence.confirmed_records, 0);
});
test("4-B2 exact whole-case time fits while one nanosecond short refuses", () => {
  const a = assembly("900000"); a.beginCase({ allocation: alloc(), at: point("0") });
  const b = assembly("900000"); assert.throws(() => b.beginCase({ allocation: alloc(), at: point("1") }), /cohort_window/);
});
for (const source of ["source_tree_sha256", "node_binary_sha256", "runtime_closure_sha256"]) test(`4-B2 changed ${source} stops case turnover`, () => {
  const m = assembly();
  const own = settle(go(prepare(readyDriver(driver(m))))); m.finishCase(own.token, { at: own.tick() });
  const a = alloc(1); if (source === "source_tree_sha256") a[source] = "b".repeat(64); else a.artifacts[source] = "b".repeat(64);
  assert.throws(() => m.beginCase({ allocation: a, at: own.tick() }), /source_binding/); assert.equal(m.describe().stopped, true);
});
test("4-B2 a closed case reference and a reused launch label never enter the next case", () => {
  const s = settle(); s.m.finishCase(s.token, { at: s.tick() });
  assert.throws(() => s.event("resource", { resource: "helper", action: "attach" }), /case_reference/);
  const q = settle(); q.m.finishCase(q.token, { at: q.tick() }); const a = alloc(1); a.launch_nonce = alloc().launch_nonce;
  assert.throws(() => q.m.beginCase({ allocation: a, at: q.tick() }), /exchange_reused/);
});
test("4-B2 late diagnostics obey the exact byte bound and never clear the primary stop", () => {
  const s = driver(); s.m.stop({ reason: "primary", at: s.tick() });
  s.event("late_frame", { line: "x".repeat(65536) }); assert.equal(s.m.describe().active.frames, 1);
  assert.throws(() => s.event("late_frame", { line: "x".repeat(65537) }), /invalid_input/);
  assert.equal(s.m.describe().stop_reason, "primary"); assert.equal(s.m.describe().active.frames, 1);
});
test("4-B2 case-writer close failures yield FAIL and prevent all later cases", () => {
  const s = settle(go(), "BLOCKED", { closes: { receipt: "unconfirmed", report: "confirmed", errors: Array(8).fill("c".repeat(96)) } });
  assert.ok(byteLength(canonical(s.m.describe())) <= s.m.describe().capacity.diagnostic_ceiling_bytes);
  const d = s.m.finishCase(s.token, { at: s.tick() }); assert.equal(d.rows[0].model_verdict, "FAIL"); assert.equal(d.rows[0].cleanly_settled, false);
  assert.equal(d.stopped, true); s.m.finishNotRun(); assert.equal(s.m.describe().rows.length, 24);
  assert.equal(s.m.closeIndex({ outcome: "unconfirmed", at: s.tick() }).runtime_completion_proven, false);
});
test("4-B2 stopped-case evidence remains failure-only with no replacement or progress", () => {
  const s = driver(); s.record("case_allocated"); s.m.stop({ reason: "primary", at: s.tick() });
  s.record("stop_summary", { reason: "primary", details: [] }); s.record("ready_to_report", { candidate_outcome: "FAIL", assessment_sha256: null });
  const at = s.tick(), report = s.event("report", { observation: null, trace: [], comparison: null, limitations: [],
    save_stamp: { ...at, wall_utc: "2026-10-29T00:00:00.000Z", wall_jst: "2026-10-29T09:00:00.000+09:00" } }, at);
  assert.equal(JSON.parse(report.line).candidate_outcome, "FAIL"); assert.throws(() => s.record("create_intent", { entry_index: 0, ready_sha256: h }), /receipt_after_stop/);
});
test("4-B2 closing the index of a retained run does not discard later original close facts", () => {
  const s = driver(); s.event("resource", { resource: "helper", action: "attach" }); s.m.stop({ reason: "primary", at: s.tick() });
  s.m.finishNotRun(); s.m.closeIndex({ outcome: "confirmed", at: s.tick() });
  s.event("resource", { resource: "helper", action: "close", outcome: "confirmed" });
  assert.equal(s.m.describe().active.slots.helper, "closed"); assert.equal(s.m.describe().closed, true);
  assert.equal(s.m.describe().runtime_completion_proven, false); assert.equal(s.m.describe().stop_reason, "primary");
  assert.throws(() => s.event("resource", { resource: "observer", action: "attach" }), /terminal_event/);
});
for (const kind of ["worker_exit", "command_close"]) test(`4-B2 ${kind} cannot fabricate an original worker`, () => {
  const s = driver(); s.m.stop({ reason: "primary", at: s.tick() });
  assert.throws(() => s.event(kind, kind === "worker_exit" ? { exit_code: 0, signal: null } : { outcome: "confirmed" }), /worker_reference/);
});

for (const corrupt of ["late", "rollback"]) test(`4-B2 shutdown write-start rechecks its ${corrupt} clock qualification`, () => {
  const s = go(); s.m.stop({ reason: "primary", at: s.tick() }); assert.equal(s.event("shutdown_plan").decision, "CANCEL_THEN_CLOSE");
  let at;
  if (corrupt === "late") at = point(String(BigInt(s.m.describe().active.window.phase_deadline_ns) + 1n));
  else { assert.throws(() => s.event("resource", { resource: "helper", action: "close", outcome: "confirmed" }, point("0")), /clock_order/); at = s.tick(); }
  assert.throws(() => s.event("shutdown_write", { outcome: "started" }, at), /deadline|shutdown_clock/);
  assert.equal(s.m.describe().stop_reason, "primary");
});
for (const stopAt of ["before_candidate", "after_candidate"]) test(`4-B2 stop ${stopAt} cannot produce new consistent evidence`, () => {
  assert.throws(() => settle(go(), "MODEL_CONSISTENT", { projection: true, stopAt }), /stopped_evidence|evidence_frozen/);
});
for (const at of [{ clock_domain: "parent-clock", monotonic_ns: "bad" }, { clock_domain: "parent-clock" }, null])
  test("4-B2 malformed event clock permanently disables shutdown dispatch", () => {
    const s = go(); assert.throws(() => s.event("resource", { resource: "helper", action: "attach" }, at), /invalid_input/);
    assert.equal(s.m.describe().clock_invalid, true); assert.equal(s.event("shutdown_plan").decision, "CLOSE_ONLY");
  });
test("4-B2 an already-started GO uncertainty is recorded after stop before shutdown planning", () => {
  const s = prepare(); s.record("go_intent", { baseline_sha256: s.m.describe().active.baseline_sha256, bound_objects_sha256: null });
  s.frame("GO", goPayload(s), undefined, false); s.event("write", { ordinal: 3, outcome: "started" }); s.m.stop({ reason: "primary", at: s.tick() });
  s.event("write", { ordinal: 3, outcome: "uncertain" }); assert.equal(s.event("shutdown_plan").decision, "CLOSE_ONLY");
  assert.throws(() => s.event("write", { ordinal: 4, outcome: "started" }), /stopped_write_start|write_order/);
});
function stoppedIndexed(confirm = true) {
  const s = driver(); s.record("case_allocated"); s.m.stop({ reason: "primary", at: s.tick() });
  s.record("stop_summary", { reason: "primary", details: [] }); s.record("ready_to_report", { candidate_outcome: "FAIL", assessment_sha256: null });
  const at = s.tick(), report = s.event("report", { observation: null, trace: [], comparison: null, limitations: [],
    save_stamp: { ...at, wall_utc: "2026-10-29T00:00:00.000Z", wall_jst: "2026-10-29T09:00:00.000+09:00" } }, at);
  s.event("report_readback", { line: report.line }); s.record("terminal", { report_sha256: report.sha256 });
  s.event("case_closes", { receipt: "confirmed", report: "confirmed", errors: [] });
  const row = s.event("index_row"); s.pendingIndex = row.line;
  if (confirm) s.event("index_readback", { line: row.line }); return s;
}
for (const explicit of [true, false]) test(`4-B2 confirmed stopped index row is preserved with explicit finish=${explicit}`, () => {
  const s = stoppedIndexed(); if (explicit) s.m.finishCase(s.token, { at: s.tick() }); s.m.finishNotRun();
  const d = s.m.describe(); assert.equal(d.rows[0].index_readback, true); assert.equal(d.rows[0].model_verdict, "FAIL");
  assert.equal(d.rows[0].index_sha256, d.active.evidence.index_sha256); assert.equal(d.rows[0].unindexed, undefined);
  assert.equal(d.rows.filter((r) => r.model_verdict === "NOT_RUN").length, 23); assert.equal(d.stopped, true);
});
test("4-B2 pending original index readback cannot be finalized as an unindexed row", () => {
  const s = stoppedIndexed(false); assert.throws(() => s.m.finishNotRun(), /index_readback_pending/);
  assert.equal(s.m.describe().rows.length, 0); assert.equal(s.m.describe().active.evidence.pending_readback, "index");
  s.event("index_readback", { line: s.pendingIndex }); s.m.finishNotRun();
  assert.equal(s.m.describe().rows[0].index_readback, true); assert.equal(s.m.describe().rows[0].model_verdict, "FAIL");
});
test("4-B2 NOT_RUN finalization accepts a prior report readback but no new terminal or index", () => {
  const s = driver(); s.record("case_allocated"); s.m.stop({ reason: "primary", at: s.tick() });
  s.record("stop_summary", { reason: "primary", details: [] }); s.record("ready_to_report", { candidate_outcome: "FAIL", assessment_sha256: null });
  const at = s.tick(), report = s.event("report", { observation: null, trace: [], comparison: null, limitations: [],
    save_stamp: { ...at, wall_utc: "2026-10-29T00:00:00.000Z", wall_jst: "2026-10-29T09:00:00.000+09:00" } }, at);
  s.m.finishNotRun(); s.event("report_readback", { line: report.line });
  assert.equal(s.m.describe().active.evidence.pending_readback, null);
  assert.throws(() => s.record("terminal", { report_sha256: report.sha256 }), /not_run_evidence/);
  assert.throws(() => s.event("index_row"), /not_run_evidence/); assert.equal(s.m.describe().rows[0].index_readback, false);
});
test("4-B2 a late original GO completion is bookkeeping only after stop", () => {
  const s = prepare(); s.record("go_intent", { baseline_sha256: s.m.describe().active.baseline_sha256, bound_objects_sha256: null });
  s.frame("GO", goPayload(s), undefined, false); s.event("write", { ordinal: 3, outcome: "started" }); s.m.stop({ reason: "primary", at: s.tick() });
  s.event("write", { ordinal: 3, outcome: "completed" }); assert.equal(s.m.describe().stopped, true);
  assert.equal(s.event("shutdown_plan").decision, "CANCEL_THEN_CLOSE"); assert.equal(s.m.describe().active.protocol_state, "STOPPED");
});
test("4-B2 CANCEL start rechecks an original GO uncertainty received after planning", () => {
  const s = prepare(); s.record("go_intent", { baseline_sha256: s.m.describe().active.baseline_sha256, bound_objects_sha256: null });
  s.frame("GO", goPayload(s), undefined, false); s.event("write", { ordinal: 3, outcome: "started" }); s.m.stop({ reason: "primary", at: s.tick() });
  assert.equal(s.event("shutdown_plan").decision, "CANCEL_THEN_CLOSE"); s.event("write", { ordinal: 3, outcome: "uncertain" });
  assert.throws(() => s.event("shutdown_write", { outcome: "started" }), /shutdown_uncertain/);
});
test("4-B2 a pending candidate cannot be used to resume evidence after its stop", () => {
  const s = go(); s.stopBeforeReadback("ready_to_report");
  assert.throws(() => settle(s), /evidence_frozen/); assert.equal(s.m.describe().active.evidence_frozen, true);
  assert.equal(s.m.describe().active.evidence.candidate_outcome, "BLOCKED");
});
for (const kind of ["absence_checked", "worker_finalized"]) test(`4-B2 pending ${kind} readback records facts without normal progression`, () => {
  const s = go(); s.stopBeforeReadback(kind);
  assert.throws(() => settle(s), /stopped_evidence|stopped/);
  assert.equal(s.m.describe().active.slots.fixture, "closed");
  assert.notEqual(s.m.describe().active.window.phase, "reporting");
  if (kind === "worker_finalized") assert.equal(s.m.describe().active.slots.worker, "closed");
});
test("4-B2 explicit stop after deadline uses the same original trigger inside and outside", () => {
  const s = driver(), deadline = s.m.describe().active.window.phase_deadline_ns;
  s.m.stop({ reason: "late_stop", at: point(String(BigInt(deadline) + 1n)) });
  const d = s.m.describe(); assert.equal(d.first_stop_ns, deadline); assert.equal(d.active.window.first_stop_ns, deadline);
});
test("4-B2 final index-close observation after cohort expiry is recorded as timed out", () => {
  const m = assembly(); for (let n = 0; n < 24; n++) {
    const s = driver(m, n, BigInt(n + 1) * 1000000n); readyDriver(s); prepare(s); go(s); settle(s); m.finishCase(s.token, { at: s.tick() });
  }
  const end = m.describe().cohort_deadline_ns, d = m.closeIndex({ outcome: "confirmed", at: point(String(BigInt(end) + 1n)) });
  assert.equal(d.closed, true); assert.equal(d.index_close, "confirmed"); assert.equal(d.stopped, true); assert.equal(d.first_stop_ns, end);
});
