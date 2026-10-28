import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import child from "node:child_process";
import workers from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";

const effects = [], restores = [];
const replace = (o, k, f) => { const old = o[k]; o[k] = f; restores.push(() => { o[k] = old; }); };
const block = (o, keys) => keys.forEach((k) => replace(o, k, () => { effects.push(k); throw Error("cc1b2_forbidden_effect"); }));
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]); block(workers, ["Worker"]);
block(crypto, ["sign", "createSign", "createPrivateKey", "createPublicKey", "generateKeyPair", "generateKeyPairSync"]); block(process, ["dlopen"]);
const mutators = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename", "chmod", "symlink", "link", "utimes"];
block(fs, [...mutators, ...mutators.map((s) => s + "Sync"), "createWriteStream"]); block(fsp, mutators);
// build/ holds the compiled pure C-A contracts used as the configuration parity oracle; dlopen stays blocked.
const roots = ["../helpers/", "../../node_modules/", "../../build/"].map((s) => fileURLToPath(new URL(s, import.meta.url)));
roots.push(...roots.map((s) => fs.realpathSync(s) + sep));
for (const [o, k, flag] of [[fs, "openSync", (a) => a[0]], [fs, "open", (a) => a[0]], [fsp, "open", (a) => a[0]],
  [fs, "readFileSync", (a) => a[0]?.flag], [fsp, "readFile", (a) => a[0]?.flag]]) {
  const original = o[k]; replace(o, k, (p, ...a) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(a);
    if ((f === undefined || f === "r" || f === 0) && roots.some((r) => full.startsWith(r))) return original.call(o, p, ...a);
    effects.push(k); throw Error("cc1b2_forbidden_read");
  });
}
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach((f) => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });
const api = await import("../helpers/unsignedAdapterSupport.mjs");
const configApi = await import("../helpers/unsignedWorkerConfiguration.mjs");
const adapters = await import("../helpers/unsignedInertAdapters.mjs");
const contracts = await import("../helpers/unsignedExecutionContracts.mjs");
const recipes = await import("../helpers/jointUnsignedAcceptanceContracts.mjs");
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

test("C-C1b-2 incrementally frames UTF-8 without parsing, launching or accepting incomplete EOF", () => {
  const d = api.createUnsignedProtocolDecoder(), raw = Buffer.from('{"invented":"日本語"}\n');
  assert.deepEqual(d.push(raw.subarray(0, 17)), []);
  assert.deepEqual(d.push(raw.subarray(17)), [raw.toString()]);
  assert.equal(d.end().frames, 1); assert.equal(d.describe().execution_available, false);
  const p = api.createUnsignedProtocolDecoder(); p.push(Buffer.from("{"));
  assert.throws(() => p.end(), /cc1b2_truncated_frame/);
  assert.throws(() => p.push(Buffer.from("}\n")), /cc1b2_decoder_stopped/);
});
test("C-C1b-2 keeps short writes and readback entirely as supplied memory observations", () => {
  const w = api.createUnsignedWriteCursor({ text: "invented\n", cap_bytes: 16384 });
  assert.equal(w.advance(2).offset, 2); assert.equal(w.advance(7).remaining, 0);
  assert.equal(w.confirmReadback(Buffer.from("invented\n")).model_consistent, true);
  assert.equal(w.describe().evidence_saved, false);
  const p = api.createUnsignedWriteCursor({ text: "x", cap_bytes: 5290 });
  assert.throws(() => p.advance(0), /cc1b2_write_progress/);
  assert.throws(() => p.advance(1), /cc1b2_writer_stopped/);
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = (case_id = "u1-unsigned", mode = "normal") => ({ request: {
  schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run", source_commit: "a".repeat(40), patch_sha256: "b".repeat(64) },
  case_id, mode, fixture_name: "native-bar-fs-synthetic-Ab123Z",
  ids: Object.fromEntries(["fixture", "store", "epoch", "authority", "key", "reference", "extra"].map((s, n) => [s, id(n + 1)])) });
test("C-C1b-2 observer selectors cannot become a general path browser or adopt another fixture", () => {
  const p = api.describeUnsignedObserverRequest({ fixture: fixture(), operation: "entry", entry_index: 0 });
  assert.deepEqual(p.argv, ["--observer-v1", "entry", "u1-unsigned", "native-bar-fs-synthetic-Ab123Z", id(7), "0"]);
  assert.equal(p.relative_program, "build/b3cc-validation/normal/admission-unsigned-observer");
  assert.equal(p.maximum_response_bytes, 65536); assert.equal(p.execution_available, false);
  const { fixture_name, ...initial } = fixture();
  assert.equal(api.describeUnsignedObserverRequest({ fixture: initial, operation: "anchor", entry_index: null }).argv[3], "-");
  assert.throws(() => api.describeUnsignedObserverRequest({ fixture: { ...fixture(), fixture_name: "../other" }, operation: "inventory", entry_index: null }), /cc1/);
  assert.throws(() => api.describeUnsignedObserverRequest({ fixture: fixture(), operation: "inventory", entry_index: 0 }), /cc1b2_selector/);
});
const proof = (n) => ({ kind: "directory", device: "1", inode: String(n), uid: "0", gid: "0", mode: "16877", flags: "0", birthtime_ns: "1",
  mtime_ns: "2", ctime_ns: "3", nlink: "2", size: "96", allocated_bytes: "4096", acl: "none", acl_hash: "a".repeat(64), sha256: null });
const anchor = () => ({ schema: "native-bar-unsigned-observer-v1", case_id: "u1-unsigned", operation: "anchor", fixture_name: null, extra: id(7),
  recipe_sha256: api.describeUnsignedObserverRequest({ fixture: (({ fixture_name, ...u }) => u)(fixture()), operation: "anchor", entry_index: null }).recipe_sha256,
  ancestors: ["/", "/private", "/private/tmp"].map((path, n) => ({ path, proof: proof(n + 1) })), entries: [], missing: [], absent: false,
  volume: { filesystem: "apfs", local: true, ownership_enforced: true, case_preserving: true, case_sensitive: false, read_only_mount: false },
  nodes: "3", content_bytes: "0", work_bytes: "65536" });
test("C-C1b-2 inspects supplied observer bytes without claiming an OS observation", () => {
  const request = { fixture: fixture(), operation: "anchor", entry_index: null }, line = JSON.stringify(anchor()) + "\n";
  const observed = api.inspectUnsignedObserverResponse(request, line);
  assert.equal(observed.native_status, "NOT_RUN"); assert.equal(observed.ownership_verified, false);
  assert.equal(observed.supplied_observation.nodes, "3");
  assert.throws(() => api.inspectUnsignedObserverResponse(request, line.replace('"nodes":"3"', '"nodes":"4","nodes":"3"')), /cc1b2_observer_response/);
  assert.throws(() => api.inspectUnsignedObserverResponse(request, " ".repeat(65537)), /cc1b2_observer_response_bound/);
});
test("C-C1b-2 refuses inconsistent observer counters and impossible ownership proofs", () => {
  const request = { fixture: fixture(), operation: "anchor", entry_index: null };
  for (const change of [(d) => { d.nodes = "0"; }, (d) => { d.work_bytes = "0"; }, (d) => { d.content_bytes = "1"; },
    (d) => { d.ancestors[0].proof.kind = "file"; }]) {
    const d = anchor(); change(d); assert.throws(() => api.inspectUnsignedObserverResponse(request, JSON.stringify(d) + "\n"), /cc1b2_observer_response/);
  }
});
function workerConfiguration(f = fixture()) {
  const recipe = recipes.describeUnsignedFixture(f), base = (inode, mode = "16832", uid = "501", gid = "20") => ({
    device: "1", inode: String(inode), uid, gid, mode, flags: "0", birthtime_ns: "1", acl: "none", acl_hash: "a".repeat(64) });
  const marker = (path, inode) => { const e = recipe.entries.find((e) => e.path === path); return { ...base(inode, "33152"), nlink: "1", size: e.size, sha256: e.sha256 }; };
  const registration = { schema: "native-bar-admission-read-registration-v1", scope: "synthetic_fixture_only", temp_anchor: "/private/tmp",
    fixture_name: f.fixture_name, policy_hash: recipe.entries.find((e) => e.path === "store/policy.json").sha256, authority_reference: f.ids.reference,
    pins: { fixture_id: f.ids.fixture, store_id: f.ids.store, epoch_id: f.ids.epoch, authority_id: f.ids.authority, key_id: f.ids.key,
      enrollment_hash: "2".repeat(64), public_key_spki_sha256: sha(Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex")) },
    bindings: { ancestors: ["/", "/private", "/private/tmp"].map((path, n) => ({ path, proof: base(n + 1, n === 2 ? "17407" : "16877", "0", "0") })),
      fixture_parent: base(100), data: base(101), witness: base(102), markers: { base: marker(".native-bar-fs-synthetic", 103), admission: marker(".native-bar-admission-synthetic", 104) } },
    volume: { filesystem: "apfs", local: true, ownership_enforced: true, case_preserving: true, case_sensitive: false, read_only_mount: false } };
  const inventory = { entries: "16", inventory_bytes: "1048576", metadata_bytes: "1048576" };
  const work_envelope = { schema: "native-bar-joint-read-work-envelope-v1", inventory: { data: { ...inventory }, witness: { ...inventory }, common: { ...inventory } },
    objects: { witness_records: String(recipe.witness_slots), producer_mirrors: "0", payloads: "0", receipts: "0", maintenance_metadata: String(recipe.maintenance_slots) },
    selected_bytes: String(16384 * recipe.witness_slots + 65536 * recipe.maintenance_slots), decoded_bytes: "1048576", interpretation_bytes: "1048576" };
  return { schema: "native-bar-unsigned-worker-configuration-v1", binding: { schema: "native-bar-joint-read-binding-v1", scope: "synthetic_joint_read_model_only",
    registration, registration_hash: sha(canonical(registration)) }, work_envelope };
}
test("C-C1b-2 PREPARE transports only strict bound registration/envelope metadata, without key or native work", () => {
  const f = fixture(), configuration = workerConfiguration(f), declaration = { fixture: f, exchange_id: "exchange-1", provenance: {
    js_sha256: "a".repeat(64), addon_sha256: "b".repeat(64), observer_sha256: "c".repeat(64),
    registration_sha256: sha(canonical(configuration.binding.registration)), envelope_sha256: sha(canonical(configuration.work_envelope)) } };
  const validated = configApi.validateUnsignedWorkerConfiguration({ fixture: f, registration_sha256: declaration.provenance.registration_sha256,
    envelope_sha256: declaration.provenance.envelope_sha256, configuration });
  assert.equal(validated.native_status, "NOT_RUN"); assert.equal(validated.signing_available, false);
  const m = contracts.createUnsignedExecutionProtocolModel(declaration);
  declaration.fixture.fixture_name = "native-bar-fs-synthetic-Other1"; // The model already captured the original declaration.
  m.acceptFrame(canonical({ binding: m.describe().binding, direction: "parent", ordinal: 1, kind: "PREPARE", payload: { configuration } }) + "\n");
  assert.equal(m.describe().state, "PREPARING"); assert.equal(m.describe().native_status, "NOT_RUN");
});
const allocation = () => { const { fixture_name, ...f } = fixture(); return { fixture: f, supervisor_id: "supervisor-1", worker_id: "worker-1", exchange_id: "exchange-1",
  provenance: { js_sha256: "a".repeat(64), addon_sha256: "b".repeat(64), observer_sha256: "c".repeat(64) } }; };
test("C-C1b-2 public entry stays closed for every approval-shaped value and reads no argument getters", async () => {
  const p = adapters.inspectUnsignedAdapters(allocation()); assert.equal(p.native_status, "NOT_RUN"); assert.equal(p.execution_available, false);
  assert.equal(p.cleanup_execution_available, false); assert.equal(p.evidence_saved, false); assert.ok(p.blockers.includes("worker_entry_sealed"));
  let calls = 0; const getter = Object.defineProperty({}, "approved", { enumerable: true, get() { calls++; return true; } });
  for (const value of [undefined, null, allocation(), { approved: true, execute: true }, getter, p])
    await assert.rejects(adapters.executeUnsignedAdapters(value), /cc1b2_execution_not_approved/);
  assert.equal(calls, 0);
});
test("C-C1b-2 decoder enforces exact byte/count caps before any JSON parser", () => {
  const d = api.createUnsignedProtocolDecoder(), exact = Buffer.from("x".repeat(65535) + "\n");
  assert.equal(d.push(exact)[0].length, 65536); assert.equal(d.end().frames, 1);
  const p = api.createUnsignedProtocolDecoder(), saved = JSON.parse; let calls = 0;
  try { JSON.parse = () => { calls++; throw Error("must_not_parse"); };
    assert.throws(() => p.push(Buffer.from("x".repeat(65536) + "\n")), /cc1b2_frame_bound/); assert.equal(calls, 0);
  } finally { JSON.parse = saved; }
  const q = api.createUnsignedProtocolDecoder(); assert.equal(q.push(Buffer.from("{}\n".repeat(32))).length, 32);
  assert.throws(() => q.push(Buffer.from("{}\n")), /cc1b2_frame_count/);
  assert.throws(() => q.end(), /cc1b2_decoder_stopped/);
});
test("C-C1b-2 decoder rejects malformed UTF-8 atomically and never invokes a byte-view getter", () => {
  const d = api.createUnsignedProtocolDecoder();
  assert.throws(() => d.push(Buffer.from([123, 125, 10, 0xc3, 0x28, 10])), /cc1b2_frame_encoding/);
  assert.equal(d.describe().frames, 0);
  const b = Buffer.from("{}\n"); let called = 0;
  Object.defineProperty(b, "byteLength", { get() { called++; throw Error("not_intrinsic"); } });
  assert.equal(api.createUnsignedProtocolDecoder().push(b)[0], "{}\n"); assert.equal(called, 0);
});
for (const n of [0, -1, 4, 0.5, NaN, Infinity]) test(`C-C1b-2 partial-write progress refuses ${String(n)} without a later retry`, () => {
  const w = api.createUnsignedWriteCursor({ text: "abc", cap_bytes: 16384 });
  assert.throws(() => w.advance(n), /cc1b2_write_progress/); assert.equal(w.describe().stopped, true);
  assert.throws(() => w.advance(1), /cc1b2_writer_stopped/);
});
test("C-C1b-2 write/readback mismatches cannot turn into evidence-save claims", () => {
  for (const bad of [Buffer.from("ab"), Buffer.from("abd"), Buffer.alloc(16385)]) {
    const w = api.createUnsignedWriteCursor({ text: "abc", cap_bytes: 16384 }); w.advance(3);
    assert.throws(() => w.confirmReadback(bad), /cc1b2_readback_mismatch/); assert.equal(w.describe().evidence_saved, false);
  }
  const incomplete = api.createUnsignedWriteCursor({ text: "abc", cap_bytes: 16384 }); incomplete.advance(1);
  assert.throws(() => incomplete.confirmReadback(Buffer.from("abc")), /cc1b2_readback_mismatch/);
  assert.throws(() => api.createUnsignedWriteCursor({ text: "x".repeat(16385), cap_bytes: 16384 }), /cc1b2_write_bound/);
  assert.throws(() => api.createUnsignedWriteCursor({ text: "", cap_bytes: 16384 }), /cc1b2_write_bound/);
});
for (const c of recipes.describeUnsignedAcceptanceRun(fixture().request).cases) test(`C-C1b-2 bounds selectors/configuration for ${c.mode}/${c.case_id} in memory only`, () => {
  const f = fixture(c.case_id, c.mode), r = recipes.describeUnsignedFixture(f), config = workerConfiguration(f);
  for (let index = 0; index < r.entries.length; index++) {
    const p = api.describeUnsignedObserverRequest({ fixture: f, operation: "entry", entry_index: index });
    assert.equal(p.argv[5], String(index)); assert.equal(p.recipe_paths[index], r.entries[index].path); assert.equal(p.execution_available, false);
  }
  assert.throws(() => api.describeUnsignedObserverRequest({ fixture: f, operation: "entry", entry_index: r.entries.length }), /cc1b2_selector/);
  const d = configApi.validateUnsignedWorkerConfiguration({ fixture: f, configuration: config,
    registration_sha256: sha(canonical(config.binding.registration)), envelope_sha256: sha(canonical(config.work_envelope)) });
  assert.equal(d.supplied_binding_consistent, true); assert.equal(d.ownership_verified, false);
  assert.equal(d.native_status, "NOT_RUN"); assert.equal(Object.isFrozen(d.configuration.binding.registration), true);
});
for (const [name, change] of [
  ["signature", (c) => { c.signature = "not_allowed"; }], ["checkpoint", (c) => { c.binding.checkpoint = "not_allowed"; }],
  ["native handle", (c) => { c.binding.native_handle = {}; }], ["other anchor", (c) => { c.binding.registration.temp_anchor = "/tmp"; }],
  ["wrong fixture ID", (c) => { c.binding.registration.pins.fixture_id = id(9); }],
  ["marker bytes", (c) => { c.binding.registration.bindings.markers.base.sha256 = "f".repeat(64); }],
  ["allow ACL", (c) => { c.binding.registration.bindings.data.acl = "allow"; }],
  ["owner mismatch", (c) => { c.binding.registration.bindings.data.uid = "999"; }],
  ["object alias", (c) => { c.binding.registration.bindings.data.inode = c.binding.registration.bindings.witness.inode; }],
  ["extra witness slot", (c) => { c.work_envelope.objects.witness_records = "2"; }],
  ["positive-case data slot", (c) => { c.work_envelope.objects.payloads = "1"; }],
  ["enlarged budget", (c) => { c.work_envelope.inventory.common.entries = "513"; }],
  ["read-only mount", (c) => { c.binding.registration.volume.read_only_mount = true; }],
]) test(`C-C1b-2 configuration rejects ${name} even when its content hash is recomputed`, () => {
  const f = fixture(), c = workerConfiguration(f); change(c); c.binding.registration_hash = sha(canonical(c.binding.registration));
  assert.throws(() => configApi.validateUnsignedWorkerConfiguration({ fixture: f, configuration: c,
    registration_sha256: c.binding.registration_hash, envelope_sha256: sha(canonical(c.work_envelope)) }), /cc1b2_worker_configuration/);
});
test("C-C1b-2 configuration and PREPARE reject stale hashes and remain stopped after refusal", () => {
  const f = fixture(), c = workerConfiguration(f), registration_sha256 = sha(canonical(c.binding.registration)), envelope_sha256 = sha(canonical(c.work_envelope));
  const m = contracts.createUnsignedExecutionProtocolModel({ fixture: f, exchange_id: "exchange-1", provenance: {
    js_sha256: "a".repeat(64), addon_sha256: "b".repeat(64), observer_sha256: "c".repeat(64), registration_sha256, envelope_sha256 } });
  c.work_envelope.decoded_bytes = "2";
  const frame = canonical({ binding: m.describe().binding, direction: "parent", ordinal: 1, kind: "PREPARE", payload: { configuration: c } }) + "\n";
  assert.throws(() => m.acceptFrame(frame), /cc1b_worker_configuration/); assert.equal(m.describe().retain, true);
  assert.throws(() => m.acceptFrame(frame), /cc1b_stopped/);
});
test("C-C1b-2 strict inputs reject accessors without evaluating them", () => {
  let calls = 0; const input = Object.defineProperty({}, "fixture", { enumerable: true, get() { calls++; return fixture(); } });
  assert.throws(() => api.describeUnsignedObserverRequest(input), /cc1b2_/);
  assert.throws(() => configApi.validateUnsignedWorkerConfiguration(input), /cc1b2_worker_configuration/);
  assert.equal(calls, 0);
});
test("C-C1b-2 unexpected output summaries retain only 8 KiB and never publish raw output", () => {
  const p = api.createUnsignedOutputSummary(); p.push(Buffer.from("invented"));
  assert.equal(p.describe().complete_sha256, sha("invented"));
  const s = p.push(Buffer.alloc(10000, 120)); assert.equal(s.prefix_bytes, 8192); assert.equal(s.observed_bytes, "10008");
  assert.equal(s.overflow, true); assert.equal(s.complete_sha256, null); assert.equal(s.execution_available, false);
  assert.deepEqual(Object.keys(s).filter((k) => /raw|content|buffer|text/.test(k)), []);
});
test("C-C1b-2 output prefix copies bypass byte-view constructor/species and property getters", () => {
  for (const bytes of [Buffer.from("invented"), new Uint8Array([1, 2, 3])]) {
    const expected = sha(Buffer.from(bytes)); let calls = 0;
    for (const key of ["constructor", "buffer", "byteOffset", "byteLength", "subarray"])
      Object.defineProperty(bytes, key, { get() { calls++; throw Error("caller_property"); } });
    const result = api.createUnsignedOutputSummary().push(bytes);
    assert.equal(result.complete_sha256, expected); assert.equal(calls, 0);
  }
});
test("C-C1b-2 configuration refuses exactly the envelopes the worker's own C-A planner refuses", async () => {
  const joint = await import("../../build/nativeBarAdmissionJointReadContracts.js");
  const f = fixture(), base = workerConfiguration(f);
  const theirs = (c) => { try { joint.planSyntheticAdmissionJointWork({ binding: c.binding, work_envelope: c.work_envelope, retained_state_bytes: "0",
    resources: { live_roots: "0", live_targets: "0", live_fds: "0" } }); return "accepted"; } catch (e) { return e.message; } };
  const ours = (c) => { try { configApi.validateUnsignedWorkerConfiguration({ fixture: f, configuration: c,
    registration_sha256: sha(canonical(c.binding.registration)), envelope_sha256: sha(canonical(c.work_envelope)) }); return "accepted"; } catch { return "refused"; } };
  assert.equal(theirs(base), "accepted"); assert.equal(ours(base), "accepted");
  for (const change of [(e) => { e.inventory.witness.entries = "0"; }, (e) => { e.inventory.common.entries = "0"; }, (e) => { e.inventory.common.entries = "7"; },
    (e) => { e.inventory.common.entries = "8"; }, (e) => { e.inventory.data.entries = "0"; }, (e) => { e.selected_bytes = "16777216"; },
    (e) => { e.selected_bytes = "16385"; }, (e) => { e.inventory.data.inventory_bytes = "1"; e.inventory.data.metadata_bytes = "1"; },
    (e) => { e.inventory.common.metadata_bytes = "10"; }]) {
    const c = structuredClone(base); change(c.work_envelope); const there = theirs(c);
    assert.equal(ours(c) === "accepted", there === "accepted", `${there} for ${canonical(c.work_envelope)}`);
  }
});
// A response exactly as the C++ walk emits it: entry operations open the selected path's chain, and a missing parent hides its children.
const parentPath = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
function observerResponse(f, operation, index = null, gone = new Set()) {
  const r = recipes.describeUnsignedFixture(f).entries, at = (path) => r.findIndex((e) => e.path === path);
  const { fixture_name, ...unnamed } = f, plan = api.describeUnsignedObserverRequest({ fixture: operation === "anchor" ? unnamed : f, operation, entry_index: index });
  const present = (i) => !gone.has(i) && (i === 0 || present(at(parentPath(r[i].path))));
  let shown = [], missing = [];
  if (operation === "inventory") { shown = r.map((_, i) => i).filter(present); missing = r.map((_, i) => i).filter((i) => !present(i)); }
  if (operation === "entry") {
    const chain = []; for (let i = index; ; i = at(parentPath(r[i].path))) { chain.unshift(i); if (i === 0) break; }
    shown = chain.filter(present); missing = present(index) ? [] : [index];
  }
  const entries = shown.map((i) => ({ index: i, proof: r[i].kind === "directory"
    ? { ...proof(100 + i), uid: "501", mode: "16832" }
    : { ...proof(100 + i), kind: "file", uid: "501", mode: "33152", nlink: "1", size: r[i].size, sha256: r[i].sha256 },
  children: r[i].kind === "directory" ? r.map((e, j) => [e.path, j]).filter(([p, j]) => p !== "" && parentPath(p) === r[i].path && present(j)).map(([p]) => p.slice(p.lastIndexOf("/") + 1)).sort() : null }));
  const content = entries.filter((e) => e.proof.kind === "file").reduce((n, e) => n + 2n * BigInt(e.proof.size), 0n);
  return { schema: "native-bar-unsigned-observer-v1", case_id: f.case_id, operation, fixture_name: operation === "anchor" ? null : f.fixture_name, extra: f.ids.extra,
    recipe_sha256: plan.recipe_sha256, ancestors: anchor().ancestors, entries, missing, absent: operation === "absence", volume: anchor().volume,
    nodes: String(entries.length + 3), content_bytes: String(content), work_bytes: String(content + 65536n + 1024n) };
}
const inspect = (f, operation, index, response) => api.inspectUnsignedObserverResponse({ fixture: operation === "anchor" ? (({ fixture_name, ...u }) => u)(f) : f,
  operation, entry_index: index }, JSON.stringify(response) + "\n");
for (const c of recipes.describeUnsignedAcceptanceRun(fixture().request).cases) test(`C-C1b-2 accepts every observer response the walk can emit for ${c.mode}/${c.case_id}`, () => {
  const f = fixture(c.case_id, c.mode), n = recipes.describeUnsignedFixture(f).entries.length;
  for (const operation of ["anchor", "absence", "inventory"]) inspect(f, operation, null, observerResponse(f, operation));
  inspect(f, "inventory", null, observerResponse(f, "inventory", null, new Set([n - 1])));
  for (let i = 0; i < n; i++) { inspect(f, "entry", i, observerResponse(f, "entry", i)); if (i) inspect(f, "entry", i, observerResponse(f, "entry", i, new Set([i]))); }
});
const nested = fixture("u3-maintenance"), slot = (r, path) => r.entries.findIndex((e) => e.index === recipes.describeUnsignedFixture(nested).entries.findIndex((v) => v.path === path));
for (const [name, operation, index, gone, change] of [
  ["a directory reported as a file", "inventory", null, new Set(), (r) => { Object.assign(r.entries[0].proof, { kind: "file", mode: "33152", nlink: "1", sha256: "b".repeat(64) }); r.entries[0].children = null; r.content_bytes = String(BigInt(r.content_bytes) + 2n * BigInt(r.entries[0].proof.size)); r.work_bytes = String(BigInt(r.work_bytes) + 2n * BigInt(r.entries[0].proof.size)); }],
  ["a file with two links", "inventory", null, new Set(), (r) => { r.entries[slot(r, "store/policy.json")].proof.nlink = "2"; }],
  ["a file without a hash", "inventory", null, new Set(), (r) => { r.entries[slot(r, "store/policy.json")].proof.sha256 = null; }],
  ["a directory with a hash", "inventory", null, new Set(), (r) => { r.entries[0].proof.sha256 = "c".repeat(64); }],
  ["an unexpected child name", "inventory", null, new Set(), (r) => { r.entries[0].children.push(".DS_Store"); }],
  ["a duplicated child", "inventory", null, new Set(), (r) => { r.entries[0].children.push(r.entries[0].children[0]); }],
  ["a listing that omits a present child", "inventory", null, new Set(), (r) => { r.entries[0].children.pop(); }],
  ["a listing that names a missing child", "inventory", null, new Set([6]), (r) => { r.entries[slot(r, "admission-witness")].children.push("1.json"); }],
  ["a coverage gap", "inventory", null, new Set(), (r) => { r.entries.pop(); r.nodes = String(r.entries.length + 3); r.content_bytes = String(r.entries.filter((e) => e.proof.kind === "file").reduce((n, e) => n + 2n * BigInt(e.proof.size), 0n)); }],
  ["a present child under a missing parent", "inventory", null, new Set([7]), (r) => { const child = observerResponse(nested, "inventory").entries.find((e) => e.index === 8);
    r.entries.push(child); r.missing = r.missing.filter((i) => i !== 8); r.nodes = String(r.entries.length + 3);
    r.content_bytes = String(BigInt(r.content_bytes) + 2n * BigInt(child.proof.size)); r.work_bytes = String(BigInt(r.work_bytes) + 2n * BigInt(child.proof.size)); }],
  ["miscounted content", "inventory", null, new Set(), (r) => { r.content_bytes = String(BigInt(r.content_bytes) + 2n); }],
  ["a duplicate object identity", "inventory", null, new Set(), (r) => { r.entries[1].proof.inode = r.entries[0].proof.inode; }],
  ["an absent flag on an inventory", "inventory", null, new Set(), (r) => { r.absent = true; }],
  ["another recipe digest", "inventory", null, new Set(), (r) => { r.recipe_sha256 = "d".repeat(64); }],
  ["a missing index past the recipe", "inventory", null, new Set(), (r) => { r.missing.push(15); }],
  ["an unrelated entry beside the selected chain", "entry", 2, new Set(), (r) => { const sibling = observerResponse(nested, "inventory").entries.find((e) => e.index === 1);
    r.entries.push(sibling); r.nodes = String(r.entries.length + 3); }],
  ["a missing index other than the selected one", "entry", 2, new Set(), (r) => { r.missing.push(5); }],
  ["entries on an absence check", "absence", null, new Set(), (r) => { r.entries = observerResponse(nested, "inventory").entries.slice(0, 1); r.nodes = "4"; }],
  ["a present fixture on an absence check", "absence", null, new Set(), (r) => { r.absent = false; }],
]) test(`C-C1b-2 refuses an observer response with ${name}`, () => {
  const r = observerResponse(nested, operation, index, gone); inspect(nested, operation, index, observerResponse(nested, operation, index, gone)); change(r);
  assert.throws(() => inspect(nested, operation, index, r), /cc1b2_observer_response|cc1b2_invalid_input/);
});
test("C-C1b-2 keeps the observer's own bounded refusal code and nothing else", () => {
  const classify = (exit_code, signal, stdout_bytes, stderr) => api.classifyUnsignedObserverExit({ exit_code, signal, stdout_bytes, stderr });
  assert.equal(classify(0, null, 900, "").decision, "response");
  assert.equal(classify(1, null, 0, "observer_volume_caps\n").code, "cc1b2_observer_volume_caps");
  assert.equal(classify(1, null, 0, "observer_final_path_changed\n").code, "cc1b2_observer_final_path_changed");
  for (const [exit, signal, out, err, code] of [[1, null, 10, "observer_volume\n", "cc1b2_child_stderr"], [1, null, 0, "observer volume\n", "cc1b2_child_stderr"],
    [1, null, 0, "observer_volume", "cc1b2_child_stderr"], [1, null, 0, "", "cc1b2_child_exit"], [0, null, 0, "observer_volume\n", "cc1b2_child_stderr"],
    [null, "SIGKILL", 0, "", "cc1b2_child_exit"], [2, null, 0, "observer_volume\n", "cc1b2_child_stderr"]])
    assert.equal(classify(exit, signal, out, err).code, code, `${exit}/${signal}/${err}`);
  assert.throws(() => classify(1, null, 0, `observer_${"a".repeat(60)}\n`), /cc1b2_invalid_input/);
  assert.equal(classify(1, null, 0, "observer_volume\n").execution_available, false);
});
