import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { binding as oracleBinding, id } from "./helpers/checkpointProbeFixture.mjs";

const base = process.env.NATIVE_BAR_B3CA_ISOLATED_TEST === "1" ? "../../build/b3ca-validation/" : "../../build/";
const api = await import(new URL(`${base}nativeBarAdmissionJointReadContracts.js`, import.meta.url));
const { evidenceHash, canonical } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
function binding(n = 1000) {
  return { ...oracleBinding(n), schema: "native-bar-joint-read-binding-v1", scope: "synthetic_joint_read_model_only" };
}
test("C-A validates and detaches the complete binding without creating an enrollment", () => {
  const supplied = binding(), result = api.validateSyntheticAdmissionJointBinding(supplied);
  assert.deepEqual(result, supplied); supplied.registration.fixture_name = "native-bar-fs-synthetic-Zz123Z";
  assert.equal(result.registration.fixture_name, "native-bar-fs-synthetic-Ab123Z");
  assert.throws(() => api.validateSyntheticAdmissionJointBinding(supplied), /registration_binding/);
  assert.deepEqual(Object.keys(api).filter((k) => /enroll|begin|readEvidence|run|close|sign/i.test(k)), []);
});
function envelope() {
  return { schema: "native-bar-joint-read-work-envelope-v1", inventory: {
    data: { entries: "1", inventory_bytes: "64", metadata_bytes: "64" },
    witness: { entries: "1", inventory_bytes: "16384", metadata_bytes: "16384" },
    common: { entries: "8", inventory_bytes: "4096", metadata_bytes: "4096" } },
    objects: { witness_records: "1", producer_mirrors: "0", payloads: "0", receipts: "0", maintenance_metadata: "0" },
    selected_bytes: "16384", decoded_bytes: "102400", interpretation_bytes: "69632" };
}
test("C-A plans an immutable worst-case envelope, not observed work or native capability", () => {
  const e = envelope(), r = api.planSyntheticAdmissionJointWork({ binding: binding(), work_envelope: e, retained_state_bytes: "0",
    resources: { live_roots: "0", live_targets: "0", live_fds: "0" } });
  assert.equal(r.model_fits, true); assert.equal(r.work_envelope_hash, evidenceHash(e)); assert.equal(r.native_budget_enforced, false);
  assert.equal(r.schedule.native_inventory_passes, 6); assert.equal(r.schedule.content_passes, 5); assert.equal(r.schedule.checkpoint_requests, 2);
  assert.equal(r.charged_selected_bytes, "16384"); assert.equal(r.required_decoded_bytes, "102400");
  assert.ok(BigInt(r.native_allowance.read_bytes) < 268435456n);
  for (const [k, v] of Object.entries(r)) if (/_verified$|_available$|_qualified$|_authenticated$|_enforced$/.test(k)) assert.equal(v, false, k);
});
test("C-A selects the entire supplied witness prefix numerically without truncation or native claims", () => {
  const e = envelope(); e.inventory.witness.entries = "10"; e.inventory.witness.inventory_bytes = e.inventory.witness.metadata_bytes = "163840";
  e.objects.witness_records = "10"; e.selected_bytes = "163840";
  const entries = Array.from({ length: 10 }, (_, i) => ({ index: 20 + i, root_role: "witness", path: `${i + 1}.json`, kind: "file", size: "128", access: "supplied_safe" })).reverse();
  const q = { work_envelope: e, checkpoint_sequence: "10", entries };
  const r = api.selectSyntheticAdmissionJointWitnesses(q);
  assert.deepEqual(r.selected_indices, Array.from({ length: 10 }, (_, i) => 20 + i)); assert.equal(r.logical_prefix_verified, false);
  assert.throws(() => api.selectSyntheticAdmissionJointWitnesses({ ...q, checkpoint_sequence: "9" }), /witness_prefix/);
  assert.throws(() => api.selectSyntheticAdmissionJointWitnesses({ ...q, checkpoint_sequence: "999999999999999999999999999999" }), /witness_bound/);
});
const rawHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function capture(role, path, bytes = Buffer.from('{"invented":true}')) {
  return { bytes, location: { root_role: role, path, index: role === "witness" ? 1 : 2, size: String(bytes.byteLength) },
    native_sha256: rawHash(bytes), encoded_sha256: rawHash(bytes) };
}
test("C-A binds supplied witness and mirror bytes without confusing encoded and logical digests", () => {
  const producer = id(100001), witness = capture("witness", "1.json"), mirror = capture("data", `producer/${producer}/1.json`);
  const r = api.matchSyntheticAdmissionJointRecordBytes({ sequence: "1", producer_id: producer, witness, mirror });
  assert.equal(r.supplied_byte_hashes_match, true); assert.equal(r.native_bytes_verified, false); assert.equal(r.fixture_signature_verified, false);
  assert.equal(r.sha256, rawHash(witness.bytes)); assert.equal(JSON.stringify(r).includes("invented"), false);
  assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ sequence: "1", producer_id: producer, witness: { ...witness, encoded_sha256: evidenceHash("logical record") }, mirror }), /encoded_hash/);
});
test("C-A checks supplied usage against the same immutable envelope without qualifying its source", () => {
  const e = envelope(), q = { binding: binding(), work_envelope: e, usage: { inventory: e.inventory, objects: e.objects,
    selected_bytes: e.selected_bytes, decoded_bytes: e.decoded_bytes, interpretation_bytes: e.interpretation_bytes } };
  const r = api.checkSyntheticAdmissionJointWorkUsage(q); assert.equal(r.within_supplied_envelope, true); assert.equal(r.native_budget_enforced, false);
  q.usage.selected_bytes = "16385";
  const blocked = api.checkSyntheticAdmissionJointWorkUsage(q); assert.equal(blocked.within_supplied_envelope, false); assert.ok(blocked.blockers.includes("selected_bytes"));
});
test("C-A validates model-only result/order descriptions but cannot validate native-positive reports", () => {
  const r = api.planSyntheticAdmissionJointWork({ binding: binding(), work_envelope: envelope(), retained_state_bytes: "0", resources: { live_roots: "0", live_targets: "0", live_fds: "0" } });
  const flags = Object.fromEntries(Object.entries(r).filter(([k]) => /_verified$|_available$|_qualified$|_authenticated$|_enforced$/.test(k)));
  const input = { ...flags, schema: "native-bar-joint-read-model-result-v1", scope: r.scope, verification_scope: r.verification_scope,
    original_acknowledgement: "not_proven", storage_visibility_at_as_of: "not_proven", registration_hash: r.registration_hash, work_envelope_hash: r.work_envelope_hash,
    model_status: "consistent_supplied_model", model_order_consistent: true, model_blockers: [], primary_failure: null, cleanup: "not_performed",
    supplied_phases: ["native_context_started", "c0_authenticated", "inventoried", "bytes_bound", "v0_verified", "c1_authenticated", "v1_verified", "transcript_verified", "released"], selected_indices: [1] };
  assert.equal(api.validateSyntheticAdmissionJointModelResult(input).model_order_consistent, true);
  assert.throws(() => api.validateSyntheticAdmissionJointModelResult({ ...input, view_verified: true }), /invalid_input/);
  assert.throws(() => api.validateSyntheticAdmissionJointModelResult({ ...input, supplied_phases: input.supplied_phases.filter((p) => p !== "v0_verified") }), /invalid_input/);
});
test("C-A full binding comparison catches a different named fixture even with unchanged pins and a valid recomputed digest", () => {
  const expected = binding(), supplied = structuredClone(expected);
  assert.equal(api.checkSyntheticAdmissionJointBindingMatch({ expected, supplied }).supplied_full_binding_matches, true);
  supplied.registration.fixture_name = "native-bar-fs-synthetic-Zz123Z"; supplied.registration_hash = evidenceHash(supplied.registration);
  assert.throws(() => api.checkSyntheticAdmissionJointBindingMatch({ expected, supplied }), /full_binding/);
});
const plan = (e = envelope(), overrides = {}) => api.planSyntheticAdmissionJointWork({ binding: binding(), work_envelope: e,
  retained_state_bytes: "0", resources: { live_roots: "0", live_targets: "0", live_fds: "0" }, ...overrides });
for (const [label, change] of [
  ["unknown field", (e) => { e.provider_work_bytes = "0"; }], ["zero witness", (e) => { e.objects.witness_records = "0"; }],
  ["leading zero", (e) => { e.objects.witness_records = "01"; }], ["number count", (e) => { e.objects.witness_records = 1; }],
  ["too many entries", (e) => { e.inventory.witness.entries = "513"; }], ["metadata above inventory", (e) => { e.inventory.data.metadata_bytes = "65"; }],
  ["object count above entries", (e) => { e.objects.witness_records = "2"; }], ["mirror count above witness", (e) => { e.inventory.data.entries = "5"; e.objects.producer_mirrors = "2"; }],
  ["zero selected bytes", (e) => { e.selected_bytes = "0"; }], ["selected above role caps", (e) => { e.selected_bytes = "16385"; }],
  ["missing decoded cap", (e) => { delete e.decoded_bytes; }], ["zero interpretation cap", (e) => { e.interpretation_bytes = "0"; }],
]) test(`C-A refuses an unsafe work envelope: ${label}`, () => { const e = envelope(); change(e); assert.throws(() => api.validateSyntheticAdmissionJointWorkEnvelope(e), /b3ca_/); });
test("C-A rejects understated mandatory controls instead of increasing the approved bounds silently", () => {
  const e = envelope(); e.inventory.common.entries = "7"; assert.throws(() => plan(e), /control_bound/);
  const small = envelope(); small.inventory.data.metadata_bytes = "0"; assert.throws(() => plan(small), /control_bound/);
});
test("C-A a smaller aggregate byte cap cannot reduce worst-case role, decode, ACL or provider charges", () => {
  const e = envelope(), first = plan(e); e.selected_bytes = "1"; const limited = plan(e);
  const framingDelta = BigInt(Buffer.byteLength(canonical(envelope())) - Buffer.byteLength(canonical(e)));
  assert.equal(BigInt(first.used.metadata_bytes) - BigInt(limited.used.metadata_bytes), framingDelta);
  for (const k of ["entries", "inventory_bytes", "read_bytes", "response_bytes"]) assert.equal(limited.used[k], first.used[k]);
  assert.equal(limited.selected_byte_bound, "1"); assert.equal(limited.charged_selected_bytes, "16384");
  assert.ok(BigInt(limited.additional_acl_work_bytes) > 0n);
});
test("C-A decode and interpretation caps cannot understate mandatory work", () => {
  const e = envelope(); e.decoded_bytes = "1"; e.interpretation_bytes = "1"; const r = plan(e);
  assert.equal(r.model_fits, false); assert.ok(r.blockers.includes("decoded_work_bound")); assert.ok(r.blockers.includes("interpretation_work_bound"));
  assert.ok(BigInt(r.required_decoded_bytes) > 1n);
  assert.equal(BigInt(plan().used.metadata_bytes) - BigInt(r.used.metadata_bytes), BigInt(Buffer.byteLength(canonical(envelope())) - Buffer.byteLength(canonical(e))));
});
for (const key of ["entries", "inventory_bytes", "metadata_bytes", "read_bytes", "response_bytes"])
  test(`C-A exact and one-less ${key} boundary preserves ceilings and V1 allowance`, () => {
    const r = plan(), exact = Number(r.used[key]), at = plan(envelope(), { lower_limits: { [key]: exact } });
    assert.equal(at.model_fits, true); assert.equal(plan(envelope(), { lower_limits: { [key]: exact - 1 } }).model_fits, false);
    assert.equal(at.schedule.final_rehashes, 2); assert.equal(at.schedule.native_inventory_passes, 6);
    assert.ok(BigInt(at.native_allowance[key]) <= BigInt(exact));
  });
for (const [key, value] of [["live_roots", "7"], ["live_targets", "33"], ["live_fds", "465"]])
  test(`C-A supplied ${key} pressure blocks without claiming real reservation`, () => {
    const r = plan(envelope(), { resources: { live_roots: "0", live_targets: "0", live_fds: "0", [key]: value } });
    assert.equal(r.model_fits, false); assert.equal(r.native_read_available, false);
  });
test("C-A exhausted retained state and simultaneous global maxima fail closed without count-sized work", () => {
  assert.throws(() => plan(envelope(), { retained_state_bytes: "999999999999999999999999999999" }), /state_budget/);
  const e = envelope(); e.inventory.witness = { entries: "512", inventory_bytes: "8388608", metadata_bytes: "8388608" };
  e.objects.witness_records = "512"; e.selected_bytes = "8388608"; e.decoded_bytes = "16777216"; e.interpretation_bytes = "8388608";
  const r = plan(e); assert.equal(r.model_fits, false); assert.ok(r.blockers.includes("entries_limit")); assert.ok(r.blockers.includes("read_bytes_limit"));
});
test("C-A invalid limits, invented zero work and absent counters are not implicit defaults", () => {
  for (const overrides of [{ lower_limits: { read_bytes: 268435457 } }, { provider_work_bytes: "0" }, { resources: undefined }, { retained_state_bytes: 0 }])
    assert.throws(() => plan(envelope(), overrides), /b3ca_/);
  const e = envelope(), v = api.validateSyntheticAdmissionJointWorkEnvelope(e); e.inventory.data.entries = "8";
  assert.equal(v.inventory.data.entries, "1");
});
for (const [label, change] of [
  ["missing", (x) => { x.pop(); }], ["duplicate path", (x) => { x[1].path = "1.json"; }], ["duplicate global index", (x) => { x[1].index = 0; }],
  ["leading zero", (x) => { x[0].path = "01.json"; }], ["alias", (x) => { x[0].path = "1.JSON"; }], ["link", (x) => { x[0].kind = "symlink"; }],
  ["unsafe", (x) => { x[0].access = "unsafe"; }], ["oversize", (x) => { x[0].size = "16385"; }], ["empty", (x) => { x[0].size = "0"; }],
]) test(`C-A refuses supplied witness prefix ${label}`, () => {
  const e = envelope(); e.inventory.witness.entries = e.objects.witness_records = "2";
  const entries = [1, 2].map((n) => ({ index: n - 1, root_role: "witness", path: `${n}.json`, kind: "file", size: "128", access: "supplied_safe" })); change(entries);
  assert.throws(() => api.selectSyntheticAdmissionJointWitnesses({ work_envelope: e, checkpoint_sequence: "2", entries }), /b3ca_/);
});
test("C-A supplied witness byte totals cannot exceed the aggregate admission cap", () => {
  const e = envelope(); e.selected_bytes = "1";
  assert.throws(() => api.selectSyntheticAdmissionJointWitnesses({ work_envelope: e, checkpoint_sequence: "1",
    entries: [{ index: 0, root_role: "witness", path: "1.json", kind: "file", size: "2", access: "supplied_safe" }] }), /selected_byte_bound/);
});
for (const [label, change] of [
  ["native hash", (x) => { x.native_sha256 = evidenceHash("wrong"); }], ["encoded hash", (x) => { x.encoded_sha256 = evidenceHash("wrong"); }],
  ["size", (x) => { x.location.size = "1"; }], ["wrong sequence", (x) => { x.location.path = "2.json"; }],
  ["decorated view", (x) => { x.bytes.extra = true; }], ["shared buffer", (x) => { x.bytes = new Uint8Array(new SharedArrayBuffer(1)); x.location.size = "1"; }],
  ["subclass", (x) => { x.bytes = new (class extends Uint8Array {})(x.bytes); }],
  ["detached", (x) => { x.bytes = new Uint8Array(new ArrayBuffer(1)); structuredClone(x.bytes.buffer, { transfer: [x.bytes.buffer] }); }],
  ["symbol field", (x) => { x[Symbol("extra")] = true; }],
]) test(`C-A rejects supplied record capture ${label}`, () => {
  const witness = capture("witness", "1.json"); change(witness); assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ sequence: "1", witness }), /b3ca_/);
});
test("C-A intrinsic copies isolate typed-array offsets and never invoke a decorated getter", () => {
  const all = new Uint8Array([99, 1, 2, 88]), bytes = all.subarray(1, 3), witness = capture("witness", "1.json", bytes);
  const r = api.matchSyntheticAdmissionJointRecordBytes({ sequence: "1", witness }); bytes[0] = 9; assert.equal(r.sha256, rawHash(new Uint8Array([1, 2])));
  let called = 0; const bad = capture("witness", "1.json"); Object.defineProperty(bad.bytes, "toJSON", { get() { called++; return () => ({}); } });
  assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ sequence: "1", witness: bad }), /capture_bytes/); assert.equal(called, 0);
});
test("C-A mirrors require their declared placement, same physical bytes and distinct index", () => {
  const producer = id(100002), witness = capture("witness", "1.json"), mirror = capture("data", `producer/${producer}/1.json`), q = { sequence: "1", producer_id: producer, witness, mirror };
  assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ ...q, mirror: capture("data", `producer/${producer}/1.json`, Buffer.from("different")) }), /mirror_bytes/);
  assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ ...q, mirror: { ...mirror, location: { ...mirror.location, index: 1 } } }), /mirror_location/);
  assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ ...q, producer_id: id(100003) }), /mirror_location/);
  assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ sequence: "1", producer_id: producer, witness }), /mirror_required/);
  assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ sequence: "1", witness, mirror }), /unexpected_mirror/);
});
for (const [role, path, cap] of [["payload", `captures/2026-10-27/${id(100004)}.json`, 1048576], ["receipt", `receipts/2026-10-27/${id(100005)}.json`, 16384],
  ["maintenance_metadata", `maintenance/${id(100006)}.json`, 65536]])
  test(`C-A ${role} compares whole encoded bytes at its existing role cap`, () => {
    const c = capture("data", path, Buffer.alloc(cap, 1)), q = { role, capture: c, expected_sha256: c.encoded_sha256 };
    const r = api.matchSyntheticAdmissionJointContentBytes(q); assert.equal(r.supplied_byte_hashes_match, true); assert.equal(r.native_bytes_verified, false);
    assert.throws(() => api.matchSyntheticAdmissionJointContentBytes({ ...q, expected_sha256: evidenceHash("logical body") }), /expected_hash/);
    assert.throws(() => api.matchSyntheticAdmissionJointContentBytes({ ...q, capture: capture("data", path, Buffer.alloc(cap + 1)) }), /capture_role/);
  });
test("C-A input guards reject accessors, hidden fields, cycles and sparse collections without evaluating getters", () => {
  let calls = 0; const b = binding(); Object.defineProperty(b, "registration", { enumerable: true, get() { calls++; return {}; } });
  assert.throws(() => api.validateSyntheticAdmissionJointBinding(b), /non_json/); assert.equal(calls, 0);
  const cycle = {}; cycle.self = cycle; assert.throws(() => api.validateSyntheticAdmissionJointWorkEnvelope(cycle), /non_json/);
  const hidden = envelope(); Object.defineProperty(hidden, "secret", { value: true }); assert.throws(() => api.validateSyntheticAdmissionJointWorkEnvelope(hidden), /non_json/);
  assert.throws(() => api.selectSyntheticAdmissionJointWitnesses({ work_envelope: envelope(), checkpoint_sequence: "1", entries: new Array(1) }), /non_json/);
  const c = {}; Object.defineProperty(c, "bytes", { enumerable: true, get() { calls++; } });
  assert.throws(() => api.matchSyntheticAdmissionJointRecordBytes({ sequence: "1", witness: c }), /invalid_input/); assert.equal(calls, 0);
});
test("C-A native limits are bounded by the envelope as well as the remaining native allowance", () => {
  const e = envelope(), r = plan(e);
  assert.equal(r.native_limits.entries, "10"); assert.equal(r.native_limits.inventory_bytes, "20544");
  for (const k of Object.keys(r.native_limits)) assert.ok(BigInt(r.native_limits[k]) <= BigInt(r.native_allowance[k]), k);
  assert.equal(BigInt(r.native_limits.read_bytes) + BigInt(r.outer_read_bytes), BigInt(r.used.read_bytes));
  assert.ok(BigInt(r.native_limits.metadata_bytes) < BigInt(r.native_allowance.metadata_bytes));
});
for (const [label, change] of [["root proof", (b) => { b.registration.bindings.data.birthtime_ns = "2"; }],
  ["volume", (b) => { b.registration.volume.case_sensitive = true; }], ["public fingerprint", (b) => { b.registration.pins.public_key_spki_sha256 = evidenceHash("different public key"); }]])
  test(`C-A full comparison pins the complete ${label}, not just logical IDs`, () => {
    const expected = binding(), supplied = structuredClone(expected); change(supplied); supplied.registration_hash = evidenceHash(supplied.registration);
    assert.throws(() => api.checkSyntheticAdmissionJointBindingMatch({ expected, supplied }), /full_binding/);
  });
function modelResult() {
  const r = plan(), flags = Object.fromEntries(Object.entries(r).filter(([k]) => /_verified$|_available$|_qualified$|_authenticated$|_enforced$/.test(k)));
  return { ...flags, schema: "native-bar-joint-read-model-result-v1", scope: r.scope, verification_scope: r.verification_scope,
    original_acknowledgement: "not_proven", storage_visibility_at_as_of: "not_proven", registration_hash: r.registration_hash, work_envelope_hash: r.work_envelope_hash,
    model_status: "consistent_supplied_model", model_order_consistent: true, model_blockers: [], primary_failure: null, cleanup: "not_performed",
    supplied_phases: ["native_context_started", "c0_authenticated", "inventoried", "bytes_bound", "v0_verified", "c1_authenticated", "v1_verified", "transcript_verified", "released"], selected_indices: [1] };
}
test("C-A model results refuse every real qualification flag and detached data cannot alter the model input", () => {
  const r = modelResult(), parsed = api.validateSyntheticAdmissionJointModelResult(r); parsed.selected_indices[0] = 10; assert.equal(r.selected_indices[0], 1);
  for (const [k, v] of Object.entries(r)) if (v === false) assert.throws(() => api.validateSyntheticAdmissionJointModelResult({ ...r, [k]: true }), /invalid_input/, k);
  for (const change of [{ cleanup: "confirmed" }, { original_acknowledgement: "confirmed" }, { signature_hex: "private details" }, { selected_indices: [1, 1] },
    { supplied_phases: ["c0_authenticated", "native_context_started"] }, { primary_failure: "private path /secret" }])
    assert.throws(() => api.validateSyntheticAdmissionJointModelResult({ ...r, ...change }), /invalid_input/);
});
test("C-A a blocked partial model describes no cleanup or actual phase evidence", () => {
  const r = modelResult(); r.model_status = "blocked_supplied_model"; r.model_order_consistent = false; r.model_blockers = ["transaction_mapping_pending"];
  r.supplied_phases = r.supplied_phases.slice(0, 2);
  assert.equal(api.validateSyntheticAdmissionJointModelResult(r).transaction_replay_verified, false);
  assert.throws(() => api.validateSyntheticAdmissionJointModelResult({ ...r, model_blockers: [] }), /invalid_input/);
  assert.throws(() => api.validateSyntheticAdmissionJointModelResult({ ...r, model_blockers: ["integrity", "integrity"] }), /invalid_input/);
});
for (const [role, key] of [["data", "entries"], ["data", "inventory_bytes"], ["data", "metadata_bytes"], ["witness", "entries"], ["witness", "inventory_bytes"],
  ["witness", "metadata_bytes"], ["common", "entries"], ["common", "inventory_bytes"], ["common", "metadata_bytes"]])
  test(`C-A supplied usage above ${role} ${key} cannot move the original envelope`, () => {
    const e = envelope(), usage = { inventory: structuredClone(e.inventory), objects: e.objects, selected_bytes: e.selected_bytes, decoded_bytes: e.decoded_bytes, interpretation_bytes: e.interpretation_bytes };
    usage.inventory[role][key] = String(BigInt(usage.inventory[role][key]) + 1n);
    const r = api.checkSyntheticAdmissionJointWorkUsage({ binding: binding(), work_envelope: e, usage });
    assert.equal(r.within_supplied_envelope, false); assert.ok(r.blockers.includes(`${role}_${key}`)); assert.equal(r.work_envelope_hash, evidenceHash(e));
  });
test("C-A selecting a payload or receipt requires the right encoded role, not a logical digest alias", () => {
  const c = capture("data", `captures/2026-10-27/${id(100007)}.json`);
  assert.throws(() => api.matchSyntheticAdmissionJointContentBytes({ role: "receipt", capture: c, expected_sha256: c.encoded_sha256 }), /capture_role/);
  assert.throws(() => api.matchSyntheticAdmissionJointContentBytes({ role: "payload", capture: c, expected_sha256: c.encoded_sha256, receipt_body_hash: c.encoded_sha256 }), /invalid_input/);
});
