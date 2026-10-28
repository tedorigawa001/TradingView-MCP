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
const block = (o, keys) => keys.forEach((k) => replace(o, k, () => { effects.push(k); throw Error("cc4a_forbidden_effect"); }));
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]); block(workers, ["Worker"]);
block(crypto, ["sign", "createSign", "createPrivateKey", "createPublicKey", "generateKeyPair", "generateKeyPairSync"]); block(process, ["dlopen"]);
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename", "chmod", "symlink", "link", "utimes"];
block(fs, [...mutations, ...mutations.map((k) => k + "Sync"), "createWriteStream"]); block(fsp, mutations);
const roots = ["../helpers/", "../../node_modules/"].map((s) => fileURLToPath(new URL(s, import.meta.url)));
roots.push(...roots.map((s) => fs.realpathSync(s) + sep));
for (const [o, k, flag] of [[fs, "openSync", (a) => a[0]], [fs, "open", (a) => a[0]], [fsp, "open", (a) => a[0]],
  [fs, "readFileSync", (a) => a[0]?.flag], [fsp, "readFile", (a) => a[0]?.flag]]) {
  const original = o[k]; replace(o, k, (p, ...a) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(a);
    if ((f === undefined || f === "r" || f === 0) && roots.some((r) => full.startsWith(r))) return original.call(o, p, ...a);
    effects.push(k); throw Error("cc4a_forbidden_read");
  });
}
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach((f) => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });
const { describeUnsignedControllerCapacity, createUnsignedControllerWindowModel, createUnsignedControllerProtocolModel } = await import("../helpers/unsignedControllerContracts.mjs");
const { createUnsignedControllerEvidenceModel, inspectUnsignedControllerEvidence, describeUnsignedControllerSerializationCapacity,
  createUnsignedControllerCohortModel } = await import("../helpers/unsignedControllerEvidence.mjs");
const { assessUnsignedControllerAssertions, describeUnsignedControllerLimitations, validateUnsignedControllerObservation } = await import("../helpers/unsignedControllerObservation.mjs");
const { describeUnsignedFixture, describeUnsignedAcceptanceRun } = await import("../helpers/jointUnsignedAcceptanceContracts.mjs");
const { canonical, digest, byteLength } = await import("../helpers/unsignedControllerData.mjs");
const h = "a".repeat(64), resources = { fds: "4", roots: "0", workspace: "0", retained: "0" };
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
function wire(m, kind, payload = {}, binding = m.describe().binding) {
  const direction = ["LAUNCH", "PREPARE", "GO", "CANCEL", "FINALIZE"].includes(kind) ? "parent" : "worker";
  return canonical({ binding, direction, ordinal: m.describe().next_ordinals[direction], kind, payload }) + "\n";
}
function send(m, kind, payload = {}, binding) {
  const line = wire(m, kind, payload, binding), f = JSON.parse(line); m.acceptFrame(line);
  if (f.direction === "parent") { m.noteWrite({ ordinal: f.ordinal, outcome: "started" }); m.noteWrite({ ordinal: f.ordinal, outcome: "completed" }); }
  return line;
}
function active(case_id = "u1-unsigned", mode = "normal", go = true) {
  const m = createUnsignedControllerProtocolModel(allocation(case_id, mode)), f = fixture(case_id, mode);
  send(m, "LAUNCH"); send(m, "READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(m.describe().binding) });
  send(m, "PREPARE", { configuration: configuration(f), launch_nonce: "nonce-1" }, { ...m.describe().binding, setup: setup(f) });
  send(m, "BASELINED", { resources, clock_domain: "worker-clock" });
  if (go) send(m, "GO", { baseline_sha256: m.describe().baseline_sha256, baseline_readback: true, go_intent_readback: true });
  return m;
}
const blankObservation = (case_id = "u1-unsigned") => ({ primary_code: describeUnsignedAcceptanceRun(fixture().request).cases.find((c) => c.case_id === case_id).expected_code,
  available: { diagnostic: false, inventory: false, capture: false, usage: false, bound_objects: false }, diagnostic: null, inventory: null, capture: null, usage: null, bound_objects: null,
  native_throws: [], instrumentation_overflow: false, c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null });
function release(m) {
  const p = m.describe(); return { baseline_sha256: p.baseline_sha256, resources, query: "settled", native: "settled", original_operation_retired: true, query_released: true,
    close_errors: [], diagnostic_sha256: h, observation_sha256: p.observation_sha256, trace_chunks: p.trace_chunks, trace_events: p.trace_events, trace_sha256: p.trace_sha256,
    primary_code: "b3cb_record_refused", requests_dispatched: 1, authenticated_requests: 1, c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null };
}
const teardown = { receipt_readback: true, anchor_same: true, root_removed: true, absent: true, worker_live: true };

test("4-A reserves the unchanged receipt/index ceilings and the full launch/ready frame schedule", () => {
  const p = describeUnsignedControllerCapacity({ owned_entries: 9, depth: 3, content_bytes: 131072 });
  assert.equal(p.receipt_reserved_records, 52); assert.equal(p.maximum_functional_frames, 17);
  assert.equal(p.run_index_reserved_bytes, 131056); assert.equal(p.maximum_case_ms, 900000);
  assert.equal(p.native_status, "NOT_RUN"); assert.equal(p.execution_available, false);
  assert.equal(p.native_budget_changed, false);
  assert.equal(describeUnsignedControllerCapacity({ owned_entries: 12, depth: 3, content_bytes: 0 }).receipt_reserved_records, 64);
  assert.throws(() => describeUnsignedControllerCapacity({ owned_entries: 13, depth: 3, content_bytes: 0 }), /cc4a_receipt_capacity/);
});

for (const c of describeUnsignedAcceptanceRun(fixture().request).cases) test(`4-A models ${c.mode}/${c.case_id} without execution authority`, () => {
  const m = active(c.case_id, c.mode); assert.equal(m.describe().go_submitted, true);
  assert.equal(m.describe().binding.setup.fixture_name, fixture().fixture_name);
  send(m, "OBSERVED", blankObservation(c.case_id)); send(m, "RELEASED", { ...release(m), primary_code: c.expected_code });
  m.finishTeardown(teardown); send(m, "FINALIZE"); const p = m.workerExit({ exit_code: 0, signal: null });
  assert.equal(p.state, "DONE"); assert.equal(p.native_status, "NOT_RUN"); assert.equal(p.native_release_verified, false);
  assert.equal(p.execution_available, false); assert.equal(p.runtime_qualified, false);
});
test("4-A LAUNCH binds no future fixture metadata and READY requires original write submission", () => {
  const m = createUnsignedControllerProtocolModel(allocation()); assert.equal(m.describe().binding.setup, null);
  m.acceptFrame(wire(m, "LAUNCH"));
  assert.throws(() => send(m, "READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(m.describe().binding) }), /write_not_submitted/);
  assert.equal(m.describe().state, "STOPPED");
  const q = createUnsignedControllerProtocolModel(allocation()); send(q, "LAUNCH");
  assert.throws(() => send(q, "READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: "b".repeat(64) }), /ready_pins/);
});
test("4-A GO intent does not mean submitted until original write starts", () => {
  const m = active(undefined, undefined, false);
  m.acceptFrame(wire(m, "GO", { baseline_sha256: m.describe().baseline_sha256, baseline_readback: true, go_intent_readback: true }));
  assert.equal(m.describe().go_submitted, false); m.noteWrite({ ordinal: 3, outcome: "started" });
  assert.equal(m.describe().go_submitted, true); m.noteWrite({ ordinal: 3, outcome: "uncertain" });
  assert.equal(m.describe().stop_reason, "pipe_uncertain");
  const p = m.planShutdown({ binding_known: true, worker_live: true, pipe_qualified: false, settlement_remaining_ms: 100 });
  assert.equal(p.decision, "CLOSE_ONLY"); assert.equal(p.command_close_required, true);
  assert.throws(() => send(m, "GO"), /stopped/);
});
test("4-A shutdown CANCEL is once only, shares ordinals and never resumes progress", () => {
  const m = active(); const before = m.describe().frames; m.observeFailure({ reason: "observer_timeout" });
  const p = m.planShutdown({ binding_known: true, worker_live: true, pipe_qualified: true, settlement_remaining_ms: 1 });
  assert.equal(p.decision, "CANCEL_THEN_CLOSE"); assert.equal(JSON.parse(p.frame).ordinal, 4);
  assert.equal(m.describe().frames, before + 1);
  m.noteShutdownWrite({ outcome: "started" }); m.noteShutdownWrite({ outcome: "completed" });
  assert.equal(m.planShutdown({ binding_known: true, worker_live: true, pipe_qualified: true, settlement_remaining_ms: 60000 }).decision, "CLOSE_ONLY");
  m.observeLateFrame("ignored\n"); assert.equal(m.describe().state, "STOPPED");
  m.noteCommandClose({ outcome: "confirmed" }); assert.throws(() => m.noteCommandClose({ outcome: "confirmed" }), /close_order/);
  assert.throws(() => send(m, "RELEASED", release(m)), /stopped/);
});
for (const change of [{ binding_known: false }, { worker_live: false }, { pipe_qualified: false }, { settlement_remaining_ms: 0 }])
  test(`4-A shutdown closes only when ${Object.keys(change)[0]} disqualifies cancellation`, () => {
    const m = active(); m.observeFailure({ reason: "stopped" });
    assert.equal(m.planShutdown({ binding_known: true, worker_live: true, pipe_qualified: true, settlement_remaining_ms: 10, ...change }).decision, "CLOSE_ONLY");
    assert.equal(m.noteCommandClose({ outcome: "unconfirmed" }).command_close, "unconfirmed");
  });
test("4-A stop before GO still requires command EOF and never creates CANCEL", () => {
  const m = active(undefined, undefined, false); m.observeFailure({ reason: "prepare_failure" });
  assert.equal(m.planShutdown({ binding_known: true, worker_live: true, pipe_qualified: true, settlement_remaining_ms: 100 }).decision, "CLOSE_ONLY");
  assert.equal(m.noteCommandClose({ outcome: "confirmed" }).state, "STOPPED");
});
test("4-A missing projection is BLOCKED evidence, not a reason to withhold original release", () => {
  const m = active(); send(m, "RELEASED", release(m)); assert.equal(m.describe().state, "RELEASED");
  assert.throws(() => send(m, "FINALIZE"), /teardown_unconfirmed/);
  const q = active(); send(q, "FAILED", { phase: "go", primary_code: "invented_failure", close_errors: [], diagnostic_sha256: null,
    resources: null, query_created: true, instrumentation_overflow: false });
  assert.equal(q.describe().release, null); assert.throws(() => q.finishTeardown(teardown), /stopped/);
});
for (const change of [(p) => { p.resources = { ...resources, fds: "5" }; }, (p) => { p.close_errors = ["close_failed"]; },
  (p) => { p.baseline_sha256 = "b".repeat(64); }, (p) => { p.trace_events = 1; }, (p) => { p.observation_sha256 = h; }])
  test("4-A refuses unconfirmed release/resource/trace bindings", () => {
    const m = active(), p = release(m); change(p); assert.throws(() => send(m, "RELEASED", p), /cc4a_/); assert.equal(m.describe().state, "STOPPED");
  });
test("4-A trace is bounded, ordered, clock-bound and independent from private C0 timestamps", () => {
  const m = active(), e = { ordinal: 1, api: "capture", edge: "end", clock_domain: "worker-clock", monotonic_ns: "5", code: null, byte_count: "10", sha256: h };
  send(m, "TRACE_CHUNK", { chunk_index: 0, events: [e] });
  assert.equal(m.describe().trace_events, 1); send(m, "RELEASED", release(m));
  const q = active(); assert.throws(() => send(q, "TRACE_CHUNK", { chunk_index: 0, events: [{ ...e, clock_domain: "other-clock" }] }), /trace_order/);
  assert.equal(q.describe().trace_events, 0);
});
test("4-A refuses noncanonical frames, old versions, unknown fields, wrong ordinal and byte overflow", () => {
  for (const mutate of [(f) => { f.extra = 1; }, (f) => { f.binding.protocol = "native-bar-unsigned-execution-v1"; },
    (f) => { f.ordinal = 2; }, (f) => { f.direction = "worker"; }, (f) => { f.payload = { approval: true }; }]) {
    const m = createUnsignedControllerProtocolModel(allocation()), f = JSON.parse(wire(m, "LAUNCH")); mutate(f);
    assert.throws(() => m.acceptFrame(canonical(f) + "\n"), /cc4a_/); assert.equal(m.describe().state, "STOPPED");
  }
  for (const line of ["{}", " {}\n", "x".repeat(65537), '{"a":1,"a":2}\n']) {
    const m = createUnsignedControllerProtocolModel(allocation()); assert.throws(() => m.acceptFrame(line), /cc4a_/);
  }
});
const point = (ms) => ({ clock_domain: "controller-clock", monotonic_ns: String(BigInt(ms) * 1000000n) });
const windows = (ms = "2000000") => createUnsignedControllerWindowModel({ clock_domain: "controller-clock", started_ns: "0", cohort_limit_ms: ms });
test("4-A separates preparation/query/settlement/teardown and gives reporting only cohort remainder", () => {
  const m = windows(); assert.equal(m.canStartCase(point(1100000)).fits_supplied_cohort_window, true);
  const q = windows(); q.startPreparation(point(0)); q.submitGo(point(119999)); q.startSettlement(point(719998));
  assert.equal(q.inspect(point(720000), "helper").operation_window_ms, "10000");
  q.startTeardown(point(779997)); assert.equal(q.inspect(point(779999)).remaining_ms, "119998");
  q.startReporting(point(899996)); assert.equal(q.inspect(point(899998)).remaining_ms, "1100002");
  assert.equal(q.describe().renewal_available, false);
});
test("4-A clocks never renew phase deadlines or accept rollback/domain changes/submillisecond work", () => {
  for (const bad of [point(120000), { clock_domain: "other-clock", monotonic_ns: "2" }, { clock_domain: "controller-clock", monotonic_ns: "119999000001" }]) {
    const m = windows(); m.startPreparation(point(0)); assert.throws(() => m.inspect(bad), /cc4a_/);
    assert.throws(() => m.submitGo(point(120001)), /stopped/);
  }
  const m = windows(); m.startPreparation(point(10)); assert.throws(() => m.inspect(point(9)), /rollback/);
  const q = windows(); q.startPreparation(point(0)); assert.throws(() => q.startPreparation(point(1)), /window_order/);
});
test("4-A original timeout settlement is once only and cannot repair a corrupt clock", () => {
  const m = windows(); m.startPreparation(point(0)); m.submitGo(point(1)); m.startSettlement(point(600001));
  assert.equal(m.inspectShutdown(point(600002)).remaining_ms, "59999"); assert.throws(() => m.startSettlement(point(600003)), /window_order/);
  const q = windows(); q.startPreparation(point(10)); assert.throws(() => q.inspect(point(9)), /rollback/);
  assert.throws(() => q.startSettlement(point(11)), /stopped/);
});
test("4-A entering settlement after the query deadline latches stop even without a prior timer observation", () => {
  const m = windows(); m.startPreparation(point(0)); m.submitGo(point(1)); m.startSettlement(point(600002));
  assert.equal(m.describe().stopped, "deadline"); assert.throws(() => m.startTeardown(point(600003)), /stopped/);
});
test("4-A deadline latch permits only original shutdown grace, not renewed progress or teardown", () => {
  const m = windows(); m.startPreparation(point(0)); m.submitGo(point(1));
  assert.throws(() => m.inspect(point(600001)), /deadline/); m.startSettlement(point(600001));
  assert.equal(m.inspectShutdown(point(600002)).operation_window_ms, "10000");
  assert.equal(m.describe().stopped, "deadline"); assert.throws(() => m.inspect(point(600003)), /stopped/);
  assert.throws(() => m.startTeardown(point(600004)), /stopped/);
});

function observed(case_id) {
  const o = blankObservation(case_id), c = describeUnsignedAcceptanceRun(fixture().request).cases.find((c) => c.case_id === case_id);
  o.available.diagnostic = true; o.diagnostic = { origin: "original_diagnostic", sha256: h, state: "released", cleanup: "confirmed", requests_dispatched: 1, authenticated_requests: c.owner === "fixed_memory" ? 1 : 0 };
  if (c.owner === "fixed_memory" && c.row !== "U4") {
    o.available.inventory = true; o.inventory = { origin: "original_inventory", sha256: h, complete: true, sampled: false, entry_count: 12,
      totals: Object.fromEntries(["data", "witness", "common"].map((k) => [k, { entries: 4, inventory_bytes: "1024", metadata_bytes: "512" }])),
      objects: { witness_records: "1", producer_mirrors: "0", payloads: "0", receipts: "0", maintenance_metadata: case_id === "u3-maintenance-bound" ? "1" : "0" },
      markers: ["base", "admission"].map((marker) => ({ marker, raw_byte_limit: "0", readable_evidence: false })) };
  }
  if (c.row === "U1") { const known = describeUnsignedFixture(fixture(case_id)).entries.find((e) => e.path === "admission-witness/1.json");
    o.available.capture = true; o.capture = { origin: "native_capture", path: known.path, sha256: known.sha256, bytes: known.size }; }
  if (case_id === "u3-maintenance-bound") { o.available.usage = true; o.usage = { origin: "source_pinned_rederivation", reader_source_sha256: h,
    reader_js_sha256: h, inventory_sha256: h, totals_sha256: digest({ totals: o.inventory.totals, objects: o.inventory.objects }), blockers: ["maintenance_metadata"] }; }
  if (c.row === "U4") { o.available.bound_objects = true; o.bound_objects = { origin: "independent_proofs_and_source_order", pre_go_sha256: h,
    post_release_sha256: h, comparison_complete: true, nondata_unchanged: true, reader_source_sha256: h }; o.native_throws = ["admission_expected_binding:22"]; }
  return o;
}
function assertionInput(case_id = "u1-unsigned") {
  const correct = configuration(fixture(case_id)).binding.registration, supplied = structuredClone(correct); supplied.bindings.data.inode = "999";
  const work_envelope = configuration(fixture(case_id)).work_envelope;
  const o = observed(case_id);
  return { request: fixture().request, fixture: fixture(case_id), case_id, observation: o, reader_source_sha256: h, reader_js_sha256: h, registration_sha256: digest(correct),
    envelope_sha256: digest(work_envelope), work_envelope,
    witness: case_id === "u1-unsigned" ? { sha256: o.capture.sha256, bytes: o.capture.bytes } : null,
    registration_comparison: case_id === "u4-expected-inode" ? { correct, supplied } : null };
}
for (const c of describeUnsignedAcceptanceRun(fixture().request).cases.slice(0, 12))
  test(`4-A ${c.case_id} assertions compare supplied facts but never qualify native acceptance`, () => {
    const p = assessUnsignedControllerAssertions(assertionInput(c.case_id)); assert.equal(p.model_outcome, "CONSISTENT_SUPPLIED_ASSERTIONS");
    assert.equal(p.native_status, "NOT_RUN"); assert.equal(p.native_release_verified, false);
    assert.deepEqual(p.direct_assertions.map((v) => v.status), ["BLOCKED", "BLOCKED", "BLOCKED"]);
  });
test("4-A unknown observations remain unavailable and unknown timestamps cannot be invented", () => {
  const d = assertionInput(); d.observation = blankObservation(); assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "BLOCKED");
  assert.equal(describeUnsignedControllerLimitations().substitute_expected_values, false);
  const o = blankObservation(); o.c0_authenticated_at = "10"; assert.throws(() => validateUnsignedControllerObservation(o), /invalid_input/);
  o.c0_authenticated_at = null; o.available.capture = true; assert.throws(() => validateUnsignedControllerObservation(o), /availability/);
});
test("4-A U1 checks original capture hashes/counts and marker non-evidence encoding", () => {
  for (const mutate of [(d) => { d.observation.capture.bytes = "31"; }, (d) => { d.observation.capture.sha256 = "b".repeat(64); },
    (d) => { d.observation.inventory.markers[0].raw_byte_limit = "1"; }, (d) => { d.observation.diagnostic.requests_dispatched = 2; }]) {
    const d = assertionInput(); mutate(d); assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "FAIL");
  }
  const d = assertionInput(); d.observation.inventory.sampled = true; assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "BLOCKED");
});
test("4-A U1 cannot replace both observed and independently supplied bytes with a non-recipe hash", () => {
  const d = assertionInput(); d.observation.capture.sha256 = "f".repeat(64); d.witness.sha256 = "f".repeat(64);
  assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "FAIL");
});
test("4-A U3 does not accept a claimed maintenance blocker without matching whole-inventory usage", () => {
  const d = assertionInput("u3-maintenance-bound"); d.observation.inventory.objects.maintenance_metadata = "0";
  d.observation.usage.totals_sha256 = digest({ totals: d.observation.inventory.totals, objects: d.observation.inventory.objects });
  assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "FAIL");
});
test("4-A U3 cause binds complete role totals and both original source hashes", () => {
  for (const mutate of [(d) => { d.observation.usage.totals_sha256 = "b".repeat(64); }, (d) => { d.reader_js_sha256 = "b".repeat(64); },
    (d) => { d.observation.usage.blockers.push("witness_records"); }, (d) => { d.observation.inventory.entry_count = 11; }]) {
    const d = assertionInput("u3-maintenance-bound"); mutate(d); assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "FAIL");
  }
  const d = assertionInput("u3-maintenance-bound"); d.observation.inventory.sampled = true; assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "BLOCKED");
});
test("4-A U4 requires actual inode-only delta and independent non-data stability proofs", () => {
  const d = assertionInput("u4-expected-inode"); d.observation.bound_objects.comparison_complete = false;
  assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "BLOCKED");
  d.observation.bound_objects.comparison_complete = true; d.registration_comparison.supplied.bindings.witness.inode = "9999";
  assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "FAIL");
  const p = assertionInput("u4-expected-inode"); p.observation.bound_objects.nondata_unchanged = false;
  assert.equal(assessUnsignedControllerAssertions(p).model_outcome, "FAIL");
});
const proofFor = (e, n) => ({ kind: e.kind, device: "1", inode: String(n + 100), uid: "501", gid: "20", mode: e.kind === "file" ? "33152" : "16832",
  flags: "0", birthtime_ns: "1", mtime_ns: "2", ctime_ns: "3", nlink: e.kind === "file" ? "1" : "2", size: e.size ?? "96", allocated_bytes: "4096", acl: "none", acl_hash: h, sha256: e.sha256 ?? null });
function evidencePrefix(case_id = "u1-unsigned", mode = "normal") {
  const m = createUnsignedControllerEvidenceModel(allocation(case_id, mode)), lines = [], f = fixture(case_id, mode), recipe = describeUnsignedFixture(f);
  let ns = 0; const append = (kind, payload = {}) => { const p = m.append({ kind, payload, stamp: { clock_domain: "controller-clock", monotonic_ns: String(++ns) } });
    lines.push(p.line); m.confirmReceipt(p.line); return p; };
  append("case_allocated"); recipe.entries.forEach((e, n) => {
    append("create_intent", { entry_index: n, ...(n === 0 ? { ready_sha256: h } : {}) });
    append("create_result", { entry_index: n, proof: proofFor(e, n), ...(n === 0 ? { fixture_name: f.fixture_name } : {}) });
  });
  append("setup_sealed", { inventory_sha256: h, setup: setup(f) }); append("worker_prepared");
  append("baseline_bound", { baseline_sha256: h, resources }); append("go_intent", { baseline_sha256: h });
  return { m, lines, append, recipe, f };
}
function completeEvidence(case_id = "u1-unsigned", mode = "normal", closes = { receipt: "confirmed", report: "confirmed", errors: [] }, candidate = "BLOCKED", changeObservation = () => {}) {
  const p = evidencePrefix(case_id, mode), o = observed(case_id), { m, append, recipe } = p;
  changeObservation(o);
  append("run_outcome", { primary_code: o.primary_code, requests_dispatched: 1, authenticated_requests: o.diagnostic.authenticated_requests,
    diagnostic_sha256: h, observation_sha256: digest(o), observation_bytes: byteLength(canonical(o)), trace_sha256: digest([]), trace_events: 0 });
  append("release_checked", { baseline_sha256: h, resources, query_released: true, original_operation_retired: true, close_errors: [] });
  append("cleanup_precheck", { inventory_sha256: h });
  const depth = (s) => s ? s.split("/").length : 0;
  const order = recipe.entries.map((e, n) => ({ ...e, n })).sort((a, b) => depth(b.path) - depth(a.path) || (a.kind === b.kind ? 0 : a.kind === "file" ? -1 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  order.forEach((e) => { append("delete_intent", { entry_index: e.n, proof: proofFor(e, e.n) }); append("delete_result", { entry_index: e.n, outcome: "removed" }); });
  append("absence_checked", { anchor_same: true, root_removed: true, absent: true }); append("worker_finalized", { exit_code: 0, signal: null });
  const a = { ...assertionInput(case_id), observation: o }, comparison = candidate === "MODEL_CONSISTENT" ? { witness: a.witness, registration_comparison: a.registration_comparison, work_envelope: a.work_envelope } : null;
  append("ready_to_report", { candidate_outcome: candidate, assessment_sha256: comparison ? digest(assessUnsignedControllerAssertions(a)) : null });
  const report = m.createReport({ observation: o, trace: [], comparison, limitations: ["direct_c0_timestamps_unavailable"] }); m.confirmReport(report.line);
  append("terminal", { report_sha256: report.sha256 }); m.noteCaseCloses(closes);
  const index = m.createIndexRow(); m.confirmIndexRow(index.line); return { ...p, report, index };
}
for (const c of describeUnsignedAcceptanceRun(fixture().request).cases) test(`4-A replay of ${c.mode}/${c.case_id} never proves runtime completion`, () => {
  const p = completeEvidence(c.case_id, c.mode), r = inspectUnsignedControllerEvidence({ allocation: allocation(c.case_id, c.mode), receipt_lines: p.lines,
    report_line: p.report.line, index_line: p.index.line });
  assert.equal(r.model_status, "consistent_supplied_evidence"); assert.equal(r.final_model_verdict, "BLOCKED");
  assert.equal(r.replayed_runtime_completion, "NOT_PROVEN"); assert.equal(r.evidence_saved, false); assert.equal(r.finalization, "pending_index_close");
  assert.ok(p.lines.length <= 4 * p.recipe.entries.length + 16);
});
test("4-A report/receipt/index tampering cannot be replayed or treated as a final runtime verdict", () => {
  const p = completeEvidence(), input = { allocation: allocation(), receipt_lines: p.lines, report_line: p.report.line, index_line: p.index.line };
  for (const field of ["report_line", "index_line"]) {
    const d = structuredClone(input), value = JSON.parse(d[field]); value.finalization = "complete"; d[field] = canonical(value) + "\n";
    assert.throws(() => inspectUnsignedControllerEvidence(d), /cc4a_/);
  }
  const d = structuredClone(input), value = JSON.parse(d.receipt_lines[3]); value.previous_sha256 = "b".repeat(64); d.receipt_lines[3] = canonical(value) + "\n";
  assert.throws(() => inspectUnsignedControllerEvidence(d), /receipt_binding/);
  const q = completeEvidence(undefined, undefined, { receipt: "confirmed", report: "unconfirmed", errors: ["close_failed"] });
  assert.equal(JSON.parse(q.report.line).candidate_outcome, "BLOCKED"); assert.equal(JSON.parse(q.index.line).model_verdict, "FAIL");
});
test("4-A receipt progress requires exact readback and cannot silently repair a partial record", () => {
  const m = createUnsignedControllerEvidenceModel(allocation()); const p = m.append({ kind: "case_allocated", payload: {}, stamp: { clock_domain: "controller-clock", monotonic_ns: "1" } });
  assert.equal(m.describe().confirmed_records, 0); assert.equal(m.describe().pending_readback, "receipt");
  assert.throws(() => m.confirmReceipt(p.line + " "), /readback_mismatch/); assert.throws(() => m.confirmReceipt(p.line), /evidence_stopped/);
});
test("4-A receipt trace bytes are bound to the original outcome digest/count", () => {
  const p = completeEvidence(), r = JSON.parse(p.report.line); r.trace = [{ ordinal: 1, api: "info", edge: "begin", clock_domain: "worker-clock", monotonic_ns: "1", code: null, byte_count: "0", sha256: null }];
  assert.throws(() => inspectUnsignedControllerEvidence({ allocation: allocation(), receipt_lines: p.lines, report_line: canonical(r) + "\n", index_line: p.index.line }), /trace_binding/);
});
test("4-A canonical worst-size serialization stays within every unchanged envelope", () => {
  const p = describeUnsignedControllerSerializationCapacity(allocation());
  assert.ok(p.stop_summary_bytes <= 16384); assert.equal(p.worst_stop_summary.bytes, byteLength(p.worst_stop_summary.line));
  assert.ok(p.prepare_frame_ceiling <= 65536); assert.ok(p.trace_frame_ceiling <= 65536); assert.ok(p.report_ceiling <= 262144);
  assert.ok(p.index_row_bytes <= 5290); assert.equal(p.receipt_maximum_bytes, 1048576); assert.equal(p.index_reserved_bytes, 131056);
});
test("4-A clean FAIL/BLOCKED continues the fixed cohort; retention stops all later modes", () => {
  const m = createUnsignedControllerCohortModel({ request: fixture().request }), catalog = describeUnsignedAcceptanceRun(fixture().request).cases;
  catalog.forEach((c, n) => { m.beginCase({ case_id: c.case_id, mode: c.mode, remaining_ms: "900000" }); m.finishCase({ case_id: c.case_id, mode: c.mode,
    model_verdict: n % 2 ? "FAIL" : "BLOCKED", cleanly_settled: true, index_readback: true, index_bytes: 5290 }); });
  assert.equal(m.describe().model_status, "incomplete_supplied_cohort");
  assert.equal(m.closeIndex({ outcome: "confirmed" }).model_status, "consistent_supplied_cohort"); assert.equal(m.describe().runtime_completion_proven, false);
  const q = createUnsignedControllerCohortModel({ request: fixture().request }), c = catalog[0]; q.beginCase({ case_id: c.case_id, mode: c.mode, remaining_ms: "900000" });
  q.finishCase({ case_id: c.case_id, mode: c.mode, model_verdict: "FAIL", cleanly_settled: false, index_readback: true, index_bytes: 1 });
  assert.throws(() => q.beginCase({ case_id: catalog[1].case_id, mode: "normal", remaining_ms: "900000" }), /cohort_order/);
  const r = q.finishNotRun(); assert.equal(r.rows[0].model_verdict, "FAIL"); assert.equal(r.rows[1].model_verdict, "NOT_RUN"); assert.equal(r.rows.length, 24);
  assert.equal(q.closeIndex({ outcome: "unconfirmed" }).model_status, "incomplete_supplied_cohort");
});
test("4-A caller getters and executable objects are never read as approvals", () => {
  let calls = 0; const v = Object.defineProperty({}, "fixture", { enumerable: true, get() { calls++; throw Error("getter"); } });
  assert.throws(() => createUnsignedControllerProtocolModel(v), /invalid_input/); assert.equal(calls, 0);
  assert.throws(() => createUnsignedControllerProtocolModel({ ...allocation(), approved: true }), /invalid_input/);
});
test("4-A computed assertion verdict stays in the candidate report and binds its receipt hash", () => {
  for (const case_id of ["u1-unsigned", "u3-maintenance-bound", "u4-expected-inode"]) {
    const p = completeEvidence(case_id, "normal", undefined, "MODEL_CONSISTENT"), report = JSON.parse(p.report.line);
    assert.equal(report.assessment.model_outcome, "CONSISTENT_SUPPLIED_ASSERTIONS");
    assert.equal(report.assessment_sha256, digest(report.assessment)); assert.equal(report.assessment.runtime_qualified, false);
    assert.equal(inspectUnsignedControllerEvidence({ allocation: allocation(case_id), receipt_lines: p.lines, report_line: p.report.line, index_line: p.index.line }).evidence_saved, false);
  }
});
test("4-A missing/replaced comparison cannot forge a MODEL_CONSISTENT report", () => {
  const p = completeEvidence("u1-unsigned", "normal", undefined, "MODEL_CONSISTENT"), r = JSON.parse(p.report.line);
  r.comparison.witness.sha256 = "b".repeat(64);
  assert.throws(() => inspectUnsignedControllerEvidence({ allocation: allocation(), receipt_lines: p.lines, report_line: canonical(r) + "\n", index_line: p.index.line }), /assessment_binding/);
});
test("4-A invalid receipt schema permanently stops the original evidence model", () => {
  const p = evidencePrefix(); assert.throws(() => p.append("run_outcome", { primary_code: "bad" }), /invalid_input/);
  assert.throws(() => p.append("stop_summary", { reason: "bad_input", details: [] }), /evidence_stopped/);
});
test("4-A root intent requires READY and failed root proof keeps only a stopped locator", () => {
  const m = createUnsignedControllerEvidenceModel(allocation()), at = { clock_domain: "controller-clock", monotonic_ns: "1" };
  let p = m.append({ kind: "case_allocated", payload: {}, stamp: at }); m.confirmReceipt(p.line);
  assert.throws(() => m.append({ kind: "create_intent", payload: { entry_index: 0 }, stamp: at }), /ready_required/);
  const q = createUnsignedControllerEvidenceModel(allocation());
  const append = (kind, payload) => { const d = q.append({ kind, payload, stamp: at }); q.confirmReceipt(d.line); return d; };
  append("case_allocated", {}); append("create_intent", { entry_index: 0, ready_sha256: h });
  append("stop_summary", { reason: "root_proof_failed", fixture_name: fixture().fixture_name, details: [{ kind: "worker", disposition: "retained", exit_code: null, signal: null }] });
  append("ready_to_report", { candidate_outcome: "NOT_RUN", assessment_sha256: null });
  const report = q.createReport({ observation: null, trace: [], limitations: [] });
  assert.equal(JSON.parse(report.line).failure_summaries[0].fixture_name, fixture().fixture_name);
  assert.equal(q.describe().removed_entries, 0); assert.equal(q.describe().cleanup_execution_available, false);
});
test("4-A every post-GO failure phase retains STOPPED and never creates a second attempt", () => {
  for (const phase of ["launch", "prepare", "go", "settlement"]) {
    const m = active(); send(m, "FAILED", { phase, primary_code: "invented_failure", close_errors: ["close_failed"], diagnostic_sha256: null,
      resources: null, query_created: true, instrumentation_overflow: true });
    assert.equal(m.describe().state, "STOPPED"); assert.equal(m.describe().release, null);
    assert.throws(() => m.finishTeardown(teardown), /stopped/);
  }
  const p = evidencePrefix(); p.append("stop_summary", { reason: "post_go_failure", details: [] });
  assert.throws(() => p.append("ready_to_report", { candidate_outcome: "NOT_RUN", assessment_sha256: null }), /false_outcome/);
});
test("4-A stop summaries have four slots and no more than six bounded details", () => {
  const p = evidencePrefix();
  for (let i = 0; i < 4; i++) p.append("stop_summary", { reason: "stopped", details: [] });
  assert.throws(() => p.append("stop_summary", { reason: "stopped", details: [] }), /stop_order/);
  const q = evidencePrefix(); assert.throws(() => q.append("stop_summary", { reason: "stopped", details: Array(7).fill({ kind: "failed", sha256: h }) }), /invalid_input/);
});
test("4-A a later clock failure also poisons the narrow shutdown clock lane", () => {
  const m = windows(); m.startPreparation(point(0)); m.submitGo(point(1)); assert.throws(() => m.inspect(point(600001)), /deadline/);
  m.startSettlement(point(600001)); assert.throws(() => m.inspectShutdown({ ...point(600002), clock_domain: "wrong-clock" }), /clock_domain/);
  assert.throws(() => m.inspectShutdown(point(600003)), /shutdown_window/);
});
test("4-A receipt geometry and owner reservation cannot imply extra teardown time/native budget", () => {
  const p = describeUnsignedControllerCapacity({ owned_entries: 12, depth: 3, content_bytes: 0 });
  assert.equal(p.teardown_observer_ms, 140000); assert.equal(p.teardown_worst_case_fits, false);
  assert.equal(p.fixed_owner_reservation_bytes, 65536); assert.equal(p.u0_owner_reservation_bytes, 0);
  assert.equal(p.limits.teardown_ms, 120000); assert.equal(p.limits.native_work_bytes, 268435456);
});
test("4-A maximum normal transcript has 17 frames and 128 original trace slots", () => {
  const m = active(); send(m, "CANCEL");
  for (let chunk_index = 0; chunk_index < 8; chunk_index++) send(m, "TRACE_CHUNK", { chunk_index, events: Array.from({ length: 16 }, (_, i) => ({
    ordinal: chunk_index * 16 + i + 1, api: "info", edge: "end", clock_domain: "worker-clock", monotonic_ns: String(chunk_index * 16 + i + 1), code: null, byte_count: "0", sha256: null })) });
  send(m, "OBSERVED", blankObservation()); send(m, "RELEASED", release(m)); m.finishTeardown(teardown); send(m, "FINALIZE"); m.workerExit({ exit_code: 0, signal: null });
  assert.equal(m.describe().frames, 17); assert.equal(m.describe().trace_events, 128); assert.equal(m.describe().state, "DONE");
  const q = active(); q.observeFailure({ reason: "stopped" }); for (let i = 0; i < 4; i++) q.observeLateFrame("diagnostic\n");
  assert.throws(() => q.observeLateFrame("more\n"), /late_capacity/);
});
test("4-A PREPARE seals actual configuration once and refuses changed artifact/name/envelope bindings", () => {
  for (const mutate of [(b) => { b.reader_source_sha256 = "b".repeat(64); }, (b) => { b.setup.fixture_name = "native-bar-fs-synthetic-Other1"; },
    (b) => { b.setup.envelope_sha256 = "b".repeat(64); }]) {
    const m = createUnsignedControllerProtocolModel(allocation()); send(m, "LAUNCH"); send(m, "READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(m.describe().binding) });
    const b = { ...m.describe().binding, setup: setup() }; mutate(b);
    assert.throws(() => send(m, "PREPARE", { configuration: configuration(fixture()), launch_nonce: "nonce-1" }, b)); assert.equal(m.describe().state, "STOPPED");
  }
});
test("4-A cohort refuses mode/order substitutions and reserves a whole case before beginning", () => {
  const m = createUnsignedControllerCohortModel({ request: fixture().request });
  assert.throws(() => m.beginCase({ case_id: "u0-unavailable", mode: "ubsan", remaining_ms: "900000" }), /case_binding/);
  assert.equal(m.describe().stopped, true);
  assert.throws(() => m.beginCase({ case_id: "u0-unavailable", mode: "normal", remaining_ms: "900000" }), /cohort_order/);
  assert.equal(m.finishNotRun().rows.every((r) => r.model_verdict === "NOT_RUN"), true);
  const q = createUnsignedControllerCohortModel({ request: fixture().request });
  assert.equal(q.beginCase({ case_id: "u0-unavailable", mode: "normal", remaining_ms: "899999" }).stopped, true);
  assert.equal(q.finishNotRun().rows.every((r) => r.model_verdict === "NOT_RUN"), true);
});
test("4-A stopped evidence cannot replace a candidate outcome after its report was formed", () => {
  const p = evidencePrefix(); p.append("stop_summary", { reason: "stopped", details: [] });
  p.append("ready_to_report", { candidate_outcome: "FAIL", assessment_sha256: null });
  p.m.createReport({ observation: null, trace: [], limitations: [] });
  assert.throws(() => p.append("ready_to_report", { candidate_outcome: "BLOCKED", assessment_sha256: null }), /report_order/);
});
test("4-A a retained cohort case cannot be retried into clean settlement", () => {
  const m = createUnsignedControllerCohortModel({ request: fixture().request }), c = { case_id: "u0-unavailable", mode: "normal" };
  m.beginCase({ ...c, remaining_ms: "900000" }); m.finishCase({ ...c, model_verdict: "FAIL", cleanly_settled: false, index_readback: false, index_bytes: 1 });
  assert.throws(() => m.finishCase({ ...c, model_verdict: "BLOCKED", cleanly_settled: true, index_readback: true, index_bytes: 1 }), /cohort_order/);
});
test("4-A evidence hashes commit exact canonical LF bytes, not a JSON array of strings", () => {
  const p = completeEvidence(), hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
  assert.equal(p.m.describe().receipt_sha256, hash(p.lines.join("")));
  assert.equal(JSON.parse(p.lines[1]).previous_sha256, hash(p.lines[0]));
  assert.equal(JSON.parse(p.index.line).terminal_receipt_sha256, hash(p.lines.at(-1)));
  assert.equal(JSON.parse(p.report.line).receipt_prefix_sha256, hash(p.lines.slice(0, -1).join("")));
});
test("4-A MODEL_CONSISTENT cannot join a projection to a different original diagnostic", () => {
  assert.throws(() => completeEvidence("u1-unsigned", "normal", undefined, "MODEL_CONSISTENT", (o) => { o.diagnostic.sha256 = "b".repeat(64); }), /diagnostic_binding/);
});
test("4-A impossible whole-inventory object counts cannot establish a source-constrained cause", () => {
  const d = assertionInput("u3-maintenance-bound"); d.observation.inventory.objects.maintenance_metadata = "999";
  d.observation.usage.totals_sha256 = digest({ totals: d.observation.inventory.totals, objects: d.observation.inventory.objects });
  assert.equal(assessUnsignedControllerAssertions(d).model_outcome, "FAIL");
});
test("4-A malformed clock points permanently stop progress without renewing the deadline", () => {
  for (const invalid of [{ ...point(1), monotonic_ns: "broken" }, { clock_domain: "controller-clock" }, { ...point(1), extra: true }]) {
    const m = windows(); m.startPreparation(point(0)); const deadline = m.describe().phase_deadline_ns;
    assert.throws(() => m.inspect(invalid), /invalid_input/);
    assert.equal(m.describe().phase_deadline_ns, deadline);
    assert.throws(() => m.submitGo(point(1)), /stopped/);
    assert.throws(() => m.startSettlement(point(2)), /stopped/);
  }
});
test("4-A malformed clock points poison shutdown inspection even after a deadline stop", () => {
  const m = windows(); m.startPreparation(point(0)); m.submitGo(point(1));
  assert.throws(() => m.inspect(point(600001)), /deadline/); m.startSettlement(point(600001));
  const deadline = m.describe().phase_deadline_ns;
  assert.throws(() => m.inspectShutdown({ ...point(600002), monotonic_ns: "broken" }), /invalid_input/);
  assert.throws(() => m.inspectShutdown(point(600003)), /shutdown_window/);
  assert.equal(m.describe().phase_deadline_ns, deadline); assert.equal(m.describe().stopped, "deadline");
});
test("4-A malformed write notifications permanently stop before any replacement notification", () => {
  for (const bad of [{ ordinal: 1, outcome: "bad" }, { ordinal: 1, outcome: "started", extra: true }, { outcome: "started" }]) {
    const m = createUnsignedControllerProtocolModel(allocation()); m.acceptFrame(wire(m, "LAUNCH"));
    assert.throws(() => m.noteWrite(bad), /invalid_input/);
    assert.equal(m.describe().state, "STOPPED"); assert.equal(m.describe().writes[0].outcome, "planned");
    assert.throws(() => m.noteWrite({ ordinal: 1, outcome: "started" }), /write_order/);
    assert.throws(() => send(m, "READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(m.describe().binding) }), /stopped/);
  }
});
test("4-A already-started ordinary write completion remains recordable after stop", () => {
  const m = createUnsignedControllerProtocolModel(allocation()); m.acceptFrame(wire(m, "LAUNCH")); m.noteWrite({ ordinal: 1, outcome: "started" });
  m.observeFailure({ reason: "stopped" }); m.noteWrite({ ordinal: 1, outcome: "completed" });
  assert.equal(m.describe().state, "STOPPED"); assert.equal(m.describe().writes[0].outcome, "completed");
});
test("4-A original commands cannot skip an unstarted ordinal or start in a later lifecycle state", () => {
  for (const next of ["CANCEL", "FINALIZE"]) {
    const m = active(); m.acceptFrame(wire(m, "CANCEL")); send(m, "RELEASED", release(m));
    if (next === "FINALIZE") { m.finishTeardown(teardown); m.acceptFrame(wire(m, "FINALIZE")); }
    assert.throws(() => m.noteWrite({ ordinal: next === "CANCEL" ? 4 : 5, outcome: "started" }), /write_order/);
    assert.equal(m.describe().state, "STOPPED"); assert.equal(m.describe().writes.find((w) => w.kind === "CANCEL").outcome, "planned");
  }
});
test("4-A in-order original write starts do not require earlier completion callbacks", () => {
  const m = createUnsignedControllerProtocolModel(allocation());
  m.acceptFrame(wire(m, "LAUNCH")); m.noteWrite({ ordinal: 1, outcome: "started" });
  send(m, "READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(m.describe().binding) });
  m.acceptFrame(wire(m, "PREPARE", { configuration: configuration(fixture()), launch_nonce: "nonce-1" }, { ...m.describe().binding, setup: setup() }));
  m.noteWrite({ ordinal: 2, outcome: "started" }); send(m, "BASELINED", { resources, clock_domain: "worker-clock" });
  m.acceptFrame(wire(m, "GO", { baseline_sha256: m.describe().baseline_sha256, baseline_readback: true, go_intent_readback: true }));
  m.noteWrite({ ordinal: 3, outcome: "started" });
  for (const ordinal of [2, 1, 3]) m.noteWrite({ ordinal, outcome: "completed" });
  assert.equal(m.describe().state, "ACTIVE"); assert.equal(m.describe().go_submitted, true);
});
test("4-A shutdown write results arriving after command close remain recordable exactly once", () => {
  for (const close of ["confirmed", "unconfirmed"]) for (const outcome of ["completed", "uncertain"]) {
    const m = active(); m.observeFailure({ reason: "original_failure" });
    m.planShutdown({ binding_known: true, worker_live: true, pipe_qualified: true, settlement_remaining_ms: 100 });
    m.noteShutdownWrite({ outcome: "started" }); m.noteCommandClose({ outcome: close }); m.workerExit({ exit_code: 1, signal: null });
    m.noteShutdownWrite({ outcome });
    assert.equal(m.describe().writes.at(-1).outcome, outcome); assert.equal(m.describe().state, "STOPPED");
    assert.equal(m.describe().stop_reason, "original_failure"); assert.equal(m.describe().command_close, close);
    assert.throws(() => m.noteShutdownWrite({ outcome }), /shutdown_write_order/);
    assert.throws(() => m.noteShutdownWrite({ outcome: "started" }), /shutdown_write_order/);
  }
});
test("4-A unstarted shutdown writes cannot begin or complete after command close or worker exit", () => {
  for (const ended of ["close", "exit"]) {
    const m = active(); m.observeFailure({ reason: "stopped" });
    m.planShutdown({ binding_known: true, worker_live: true, pipe_qualified: true, settlement_remaining_ms: 100 });
    if (ended === "close") m.noteCommandClose({ outcome: "confirmed" }); else m.workerExit({ exit_code: 1, signal: null });
    assert.throws(() => m.noteShutdownWrite({ outcome: "started" }), /shutdown_write_order/);
    assert.throws(() => m.noteShutdownWrite({ outcome: "completed" }), /shutdown_write_order/);
    assert.equal(m.describe().writes.at(-1).outcome, "planned");
  }
});
test("4-A shutdown planning cannot override known ordinal gaps, uncertain writes or original worker exit", () => {
  const uncertain = active(undefined, undefined, false);
  uncertain.acceptFrame(wire(uncertain, "GO", { baseline_sha256: uncertain.describe().baseline_sha256, baseline_readback: true, go_intent_readback: true }));
  uncertain.noteWrite({ ordinal: 3, outcome: "started" }); uncertain.noteWrite({ ordinal: 3, outcome: "uncertain" });
  const gap = active(); send(gap, "RELEASED", release(gap)); gap.finishTeardown(teardown); gap.acceptFrame(wire(gap, "FINALIZE")); gap.observeFailure({ reason: "stopped" });
  const exited = active(); exited.workerExit({ exit_code: 1, signal: null });
  for (const m of [uncertain, gap, exited]) {
    const before = m.describe();
    assert.equal(m.planShutdown({ binding_known: true, worker_live: true, pipe_qualified: true, settlement_remaining_ms: 100 }).decision, "CLOSE_ONLY");
    assert.equal(m.describe().frames, before.frames); assert.equal(m.describe().cancel_spent, false);
    assert.equal(m.noteCommandClose({ outcome: "confirmed" }).state, "STOPPED");
  }
});
test("4-A serialization ceilings cover repeated largest detail variants actually accepted by the schema", () => {
  const p = evidencePrefix(), capacity = describeUnsignedControllerSerializationCapacity(allocation());
  const details = Array(6).fill({ kind: "close", errors: Array(8).fill("c".repeat(96)) });
  const recorded = p.append("stop_summary", { reason: "c".repeat(96), details, fixture_name: fixture().fixture_name });
  assert.ok(recorded.bytes <= capacity.maximum_receipt_record_bytes, `${recorded.bytes} exceeds ${capacity.maximum_receipt_record_bytes}`);
  const worst = JSON.parse(capacity.worst_stop_summary.line);
  assert.deepEqual(worst.payload.details, details);
  assert.equal(capacity.maximum_receipt_record_bytes, capacity.worst_stop_summary.bytes);
  assert.ok(capacity.maximum_receipt_record_bytes <= 16384); assert.ok(capacity.report_ceiling <= 262144);
});
test("4-A malformed exit and failure notifications cannot be replaced with normal completion", () => {
  for (const notify of [(m) => m.workerExit({ exit_code: "unknown", signal: null }), (m) => m.observeFailure({ reason: 42 })]) {
    const m = active(); assert.throws(() => notify(m), /invalid_input/);
    assert.equal(m.describe().state, "STOPPED"); assert.equal(m.describe().worker_exit, null);
    assert.throws(() => send(m, "RELEASED", release(m)), /stopped/);
    assert.throws(() => m.finishTeardown(teardown), /stopped/);
  }
});
test("4-A invalid cohort completion preserves the attempted case as unknown and stops later cases", () => {
  for (const change of [(v) => { delete v.cleanly_settled; }, (v) => { v.case_id = "u0-unsigned"; }]) {
    const m = createUnsignedControllerCohortModel({ request: fixture().request }), c = { case_id: "u0-unavailable", mode: "normal" };
    m.beginCase({ ...c, remaining_ms: "900000" });
    const completion = { ...c, model_verdict: "BLOCKED", cleanly_settled: true, index_readback: true, index_bytes: 1 }, bad = { ...completion }; change(bad);
    assert.throws(() => m.finishCase(bad), /cc4a_/); assert.equal(m.describe().stopped, true);
    assert.throws(() => m.finishCase(completion), /cohort_order/);
    assert.throws(() => m.beginCase({ case_id: "u0-unsigned", mode: "normal", remaining_ms: "900000" }), /cohort_order/);
    const rows = m.finishNotRun().rows; assert.equal(rows[0].model_verdict, "FAIL"); assert.equal(rows[0].index_readback, false);
    assert.equal(rows[1].model_verdict, "NOT_RUN");
  }
});
test("4-A delayed settlement entry cannot renew grace from the first deadline stop", () => {
  for (const observedStop of [true, false]) {
    const m = windows(); m.startPreparation(point(0)); m.submitGo(point(1));
    if (observedStop) assert.throws(() => m.inspect(point(600001)), /deadline/);
    assert.throws(() => m.startSettlement(point(1000000)), /deadline/);
    assert.equal(m.describe().first_stop_ns, point(600001).monotonic_ns);
    assert.equal(m.describe().phase_deadline_ns, point(660001).monotonic_ns);
    assert.throws(() => m.inspectShutdown(point(1000001)), /deadline/);
  }
});
test("4-A settlement entered within original grace preserves the first trigger and only its remainder", () => {
  const m = windows(); m.startPreparation(point(0)); m.submitGo(point(1));
  assert.throws(() => m.inspect(point(600001)), /deadline/); m.startSettlement(point(630001));
  assert.equal(m.describe().starts.settlement, point(600001).monotonic_ns);
  assert.equal(m.inspectShutdown(point(630002)).remaining_ms, "29999");
  assert.throws(() => m.inspectShutdown(point(660001)), /deadline/);
  assert.equal(m.describe().phase_deadline_ns, point(660001).monotonic_ns);
});
test("4-A all late phase transitions record the earlier known deadline rather than observation time", () => {
  const m = windows("650000"); m.startPreparation(point(0)); m.submitGo(point(1));
  assert.throws(() => m.startSettlement(point(700000)), /deadline/);
  assert.equal(m.describe().first_stop_ns, point(600001).monotonic_ns);
  const q = windows(); q.startPreparation(point(0)); q.submitGo(point(1)); q.startSettlement(point(2)); q.startTeardown(point(3));
  assert.throws(() => q.startReporting(point(200000)), /deadline/);
  assert.equal(q.describe().first_stop_ns, point(120003).monotonic_ns);
});
