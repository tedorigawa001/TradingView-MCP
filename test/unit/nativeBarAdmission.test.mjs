import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const base = process.env.NATIVE_BAR_B3BB_ISOLATED_TEST === "1" ? "../../build/b3bb-validation/" : process.env.NATIVE_BAR_B3BA_ISOLATED_TEST === "1" ? "../../build/b3ba-validation/" : process.env.NATIVE_BAR_B3A_ISOLATED_TEST === "1" ? "../../build/b3a-validation/" : process.env.NATIVE_BAR_B2B_ISOLATED_TEST === "1" ? "../../build/b2b-validation/" : process.env.NATIVE_BAR_EA_ISOLATED_TEST === "1" ? "../../build/ea-validation/" : "../../build/";
const api = await import(new URL(`${base}nativeBarAdmission.js`, import.meta.url));
const { canonical, evidenceHash } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = (n) => new Date(Date.parse("2026-10-25T00:00:00.000Z") + n * 1000).toISOString();
const ns = (n) => String(BigInt(Date.parse(time(n))) * 1000000n);
const directory = (inode) => ({ device: "1", inode, uid: "501", gid: "20", mode: "16832", flags: "0", acl: "none", acl_hash: evidenceHash("ACL"), birthtime_ns: ns(0) });
// The next record time: one second after the latest record.
const clock = (b) => b.records.length ? (Date.parse(b.records.at(-1).body.at) - Date.parse(time(0))) / 1000 + 1 : 1;
function add(b, type, data, at = clock(b)) {
  const body = { schema: "native-bar-admission-body-v6", store_id: id(1), epoch_id: id(2), sequence: String(b.records.length + 1),
    previous_hash: b.records.length ? evidenceHash(b.records.at(-1)) : null, at: time(at), type, data };
  const r = { body, signature: { schema: "native-bar-supplied-signature-v1", algorithm: "unqualified-fixture-v1", key_id: id(3),
    body_digest: evidenceHash({ domain: "native-bar-admission-body-v6", body }), signature_hex: "ab".repeat(64) } };
  b.records.push(r); b.supplied_trust.signature_checks.push({ record_hash: evidenceHash(r), outcome: "valid" });
  b.as_of = time(at + 1); b.supplied_trust.checkpoint = { store_id: id(1), epoch_id: id(2), authority_id: id(4), key_id: id(3),
    challenge: id(5), sequence: body.sequence, tip_hash: evidenceHash(r), observed_at: b.as_of, signature_status: "valid" };
  return evidenceHash(r);
}
function fixture() {
  const b = { schema: "native-bar-admission-bundle-v6", as_of: time(2), records: [], supplied_trust: {
    store_id: id(1), epoch_id: id(2), authority_id: id(4), key_id: id(3), challenge: id(5), enrollment_hash: null,
    signature_checks: [], checkpoint: null } };
  b.supplied_trust.enrollment_hash = add(b, "enrollment", { authority_id: id(4), policy_hash: evidenceHash({ schema: "native-bar-synthetic-admission-profile-v6" }),
    capabilities_hash: evidenceHash("supplied capabilities"), store_root: directory("10"), witness_root: directory("11"),
    store_ancestors_hash: evidenceHash("store parents"), witness_ancestors_hash: evidenceHash("witness parents") });
  return b;
}
const rawHash = (v) => createHash("sha256").update(v).digest("hex");
const fileProof = (inode, size, sha256, birth, at) => ({ device: "1", inode, uid: "501", gid: "20", mode: "33152", nlink: "1",
  acl: "none", flags: "0", acl_hash: evidenceHash("ACL"), size: String(size), sha256,
  birthtime_ns: ns(birth), mtime_ns: ns(at), ctime_ns: ns(at) });
function producer(b = fixture(), n = 10, sequence = 1, opened = clock(b)) {
  const producer_id = id(n), recording_id = id(n + 1), payload_hash = rawHash("invented payload");
  const artifacts = ["payload_stage", "payload_final", "receipt_stage", "receipt_final"].map((role, i) => ({ role, artifact_id: id(n + 2 + i),
    path: i % 2 === 0 ? `.producer-${id(n + 2 + i)}.tmp` : `${i === 1 ? "captures" : "receipts"}/2026-10-25/${recording_id}.json`,
    from_artifact_id: i % 2 ? id(n + 1 + i) : null }));
  const reservation = add(b, "producer_reserved", { producer_id, recording_id, owner_incarnation_hash: evidenceHash("invented incarnation"),
    window: { opened_at: time(opened), expires_at: time(opened + 600) }, partition_at: time(opened),
    payload_hash, payload_bytes: "16", restoration_hash: evidenceHash("restored"), artifacts, reverify_attempt_ids: [id(n + 6), id(n + 7)] }, opened);
  function publish(stage, final, contentHash, contentBytes) {
    const birth = clock(b), inode = String(n * 100 + stage);
    const created = add(b, "artifact_created", { producer_id, artifact_id: artifacts[stage].artifact_id, reservation_hash: reservation,
      proof: fileProof(inode, 0, rawHash(""), birth, birth) });
    const written = clock(b);
    const content = add(b, "content_verified", { producer_id, artifact_id: artifacts[stage].artifact_id, created_hash: created,
      proof: fileProof(inode, contentBytes, contentHash, birth, written) });
    const before = clock(b);
    const pending = add(b, "publication_pending", { producer_id, from_artifact_id: artifacts[stage].artifact_id,
      artifact_id: artifacts[final].artifact_id, content_hash: content });
    const after = clock(b);
    return add(b, "publication_observed", { producer_id, artifact_id: artifacts[final].artifact_id, pending_hash: pending,
      proof: { ...fileProof(inode, contentBytes, contentHash, birth, after), mtime_ns: ns(written) }, publication: { before: time(before), after: time(after) } });
  }
  const payloadPublication = publish(0, 1, payload_hash, 16);
  // Each recording consumes its own approval; a plan digest is never reused by another operation.
  const receipt = { schema: "native-bar-receipt-v1", recording_id, plan_hash: evidenceHash(`recording approval ${n}`),
    policy_hash: b.records[0].body.data.policy_hash, payload_hash, sequence, day: "2026-10-25",
    recorded_at: time(clock(b)), partition_at: time(opened) };
  const prepared = add(b, "receipt_prepared", { producer_id, payload_publication_hash: payloadPublication, receipt });
  const receiptPublication = publish(2, 3, evidenceHash(receipt), Buffer.byteLength(canonical(receipt)));
  add(b, "receipt_linked", { producer_id, receipt_preparation_hash: prepared, receipt_publication_hash: receiptPublication,
    verification_attempt_hash: null });
  return { b, producer_id, recording_id, artifacts, payloadPublication, reservation, receipt, receiptPublication };
}
function checkpointFor(b) {
  const r = b.records.at(-1); b.as_of = time((Date.parse(r.body.at) - Date.parse(time(0))) / 1000 + 1);
  b.supplied_trust.signature_checks = b.records.map((r) => ({ record_hash: evidenceHash(r), outcome: "valid" }));
  b.supplied_trust.checkpoint = { store_id: id(1), epoch_id: id(2), authority_id: id(4), key_id: id(3), challenge: id(5),
    sequence: String(b.records.length), tip_hash: evidenceHash(r), observed_at: b.as_of, signature_status: "valid" }; return b;
}
function rewrite(b, change, repin = false) {
  const old = new Map(b.records.map((r) => [r, evidenceHash(r)])), refs = new Map(); change(b);
  const replace = (v) => typeof v === "string" ? refs.get(v) ?? v : Array.isArray(v) ? v.map(replace)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)])) : v;
  for (const [i, r] of b.records.entries()) {
    r.body.data = replace(r.body.data); r.body.sequence = String(i + 1); r.body.previous_hash = i ? evidenceHash(b.records[i - 1]) : null;
    if (r.body.type === "maintenance_admitted") {
      const oldScope = r.body.data.scope_digest;
      r.body.data.scope_digest = evidenceHash({ domain: "native-bar-maintenance-admission-scope-v6", scope: r.body.data.scope }); refs.set(oldScope, r.body.data.scope_digest);
    }
    r.signature.body_digest = evidenceHash({ domain: "native-bar-admission-body-v6", body: r.body }); refs.set(old.get(r), evidenceHash(r));
  }
  if (repin) b.supplied_trust.enrollment_hash = evidenceHash(b.records[0]);
  return checkpointFor(b);
}
function maintenance(withOtherProducer = false, { admitAt, windowLead = 0, originalBorn } = {}) {
  const p = producer(), b = p.b; b.records = b.records.slice(0, 6); checkpointFor(b);
  // A second writer starts only after the orphan producer's original window (2..602) has expired.
  const other = withOtherProducer ? producer(b, 100, 2, 610) : null;
  if (other) { b.records = b.records.slice(0, -6); checkpointFor(b); }
  const admittedAt = admitAt ?? (other ? 1220 : 610), windowOpened = admittedAt - windowLead;
  const maintenance_id = id(30), scope_id = id(31), attempt_ids = [id(32), id(33), id(34)], target_id = id(35);
  const layout = api.createNativeBarAdmissionLayout({ maintenance_id, scope_id, attempt_ids, target_ids: [target_id] });
  const scope = { schema: "native-bar-maintenance-admission-scope-v6", maintenance_id, scope_id, attempt_ids,
    enrollment_hash: b.supplied_trust.enrollment_hash, layout_digest: evidenceHash(layout),
    reference_hash: evidenceHash("independent reference check"), inventory_hash: evidenceHash("complete native inventory"),
    allocation_digest: evidenceHash("verified native allocation input"), capacity_digest: evidenceHash("derived capacity audit"),
    original_plan_hash: evidenceHash("original approval audit"), window: { opened_at: time(windowOpened), expires_at: time(windowOpened + 600) },
    targets: [{ target_id, producer_id: p.producer_id, artifact_id: p.artifacts[1].artifact_id, source_path: p.artifacts[1].path,
      publication_hash: p.payloadPublication, proof: structuredClone(b.records[5].body.data.proof), receipt_state: "absent", producer_liveness: "dead" }] };
  const admitted = add(b, "maintenance_admitted", { scope, scope_digest: api.nativeBarAdmissionScopeDigest(scope) }, admittedAt);
  const manifest = { schema: "native-bar-admission-manifest-v6", maintenance_id, targets: scope.targets };
  const original = { schema: "native-bar-admission-original-v6", maintenance_id, admission_hash: admitted,
    scope_digest: api.nativeBarAdmissionScopeDigest(scope), manifest_digest: evidenceHash(manifest), layout_digest: scope.layout_digest };
  const at = clock(b), born = originalBorn ?? at;
  const seal = add(b, "original_sealed", { maintenance_id, admission_hash: admitted, original,
    original_proof: fileProof("5000", Buffer.byteLength(canonical(original)), evidenceHash(original), born, at),
    manifest_proof: fileProof("5001", Buffer.byteLength(canonical(manifest)), evidenceHash(manifest), born, at) });
  function consume(ordinal, overrides = {}) {
    const opened = ordinal === 1 ? windowOpened : clock(b);
    return add(b, "maintenance_attempt_consumed", { maintenance_id, ordinal, attempt_id: attempt_ids[ordinal - 1], original_seal_hash: seal,
      plan_hash: ordinal === 1 ? scope.original_plan_hash : evidenceHash(`fresh approval ${ordinal}`), window: { opened_at: time(opened), expires_at: time(opened + 600) },
      prefix_hash: evidenceHash(b.records.at(-1)), event_prefix_hash: null, current_reference_hash: evidenceHash(`fresh reference ${ordinal}`), ...overrides });
  }
  consume(1); return { b, scope, admitted, seal, consume, layout, other };
}

test("E-A a structurally consistent enrollment is descriptive, never authentication or execution", () => {
  const b = fixture(), before = canonical(b), r = api.replayNativeBarAdmission(b);
  assert.equal(r.model_status, "consistent_supplied_model");
  assert.equal(r.signature_verified, false); assert.equal(r.admission_verified, false);
  assert.equal(r.execution_available, false); assert.equal(r.recovery_execution_available, false);
  assert.equal(r.verification_scope, "supplied_records_only"); assert.equal(canonical(b), before);
});

test("E-A producer replay binds empty creation, payload publication and the exact receipt without persisting bars", () => {
  const { b, recording_id, receipt } = producer(), before = canonical(b), r = api.replayNativeBarAdmission(b);
  assert.equal(r.producers[0].state, "receipt_linked_model_only");
  assert.equal(r.producers[0].recording_id, recording_id); assert.equal(r.producers[0].receipt_hash, evidenceHash(receipt));
  assert.equal(r.committed_history_available, false); assert.equal(canonical(b), before);
});
test("E-A an independently bound maintenance seal survives as evidence but never revives ordinal one", () => {
  const { b, scope } = maintenance(), r = api.replayNativeBarAdmission(b);
  assert.equal(r.maintenance[0].state, "sealed_model_only"); assert.deepEqual(r.maintenance[0].consumed_ordinals, [1]);
  const q = api.assessNativeBarAdmissionRestart({ bundle: b, maintenance_id: scope.maintenance_id, now: b.as_of,
    coordination: "clear", current_reference_hash: evidenceHash("fresh reference 1") });
  assert.equal(q.original_invocation_invalid, true); assert.equal(q.next_ordinal, 2);
  assert.equal(q.decision, "requires_fresh_admission"); assert.equal(q.recovery_execution_available, false);
});
function accounting(overrides = {}) {
  const root = () => ({ entries: "1", inventory_bytes: "128", metadata_bytes: "128", allocated_bytes: "4096" });
  return { schema: "native-bar-admission-capacity-v6", producer_operations: 1, maintenance_targets: 0,
    data: root(), witness: root(), authority: root(), free_space: { store_volume: "1073741824", authority: "1073741824" },
    read_bytes: "1000", response_bytes: "1000", roots: 3, live_targets: 2, descriptors: 20, ...overrides };
}
test("E-A capacity derives both roots, authority checkpoints and both reverification attempts without reservation credit", () => {
  const input = accounting(), before = canonical(input), r = api.calculateNativeBarAdmissionCapacity(input);
  assert.equal(r.fits, true); assert.equal(r.capacity_reservation, "not_reserved"); assert.equal(r.execution_available, false);
  assert.equal(r.schedule.find((v) => v.root === "witness" && v.role === "producer_reverify_consumed").count, 2);
  assert.ok(BigInt(r.future.authority.allocated_bytes) > 0n); assert.equal(r.reserve_credit_bytes, "0");
  const sum = Object.values(r.future).reduce((n, v) => n + BigInt(v.entries), 0n);
  assert.equal(BigInt(r.peak.entries), sum + 3n); assert.equal(canonical(input), before);
});

for (const [name, change] of [
  ["unknown field", (b) => { b.records[0].body.data.raw_ohlc = []; }],
  ["old profile", (b) => { b.records[0].body.data.policy_hash = evidenceHash({ schema: "native-bar-policy-v1" }); }],
  ["duplicate roots", (b) => { b.records[0].body.data.witness_root.inode = "10"; }],
  ["cross-device roots", (b) => { b.records[0].body.data.witness_root.device = "2"; }],
  ["unsafe ACL", (b) => { b.records[0].body.data.store_root.acl = "allow"; }],
  ["signature body digest", (b) => { b.records[0].signature.body_digest = "0".repeat(64); }],
  ["sequence gap", (b) => { b.records[0].body.sequence = "2"; }],
  ["invented predecessor", (b) => { b.records[0].body.previous_hash = "0".repeat(64); }],
]) test(`E-A rejects ${name} without authority`, () => { const b = fixture(); change(b); assert.throws(() => api.replayNativeBarAdmission(b)); });

for (const [name, change, reason] of [
  ["absent authority", (b) => { b.supplied_trust.checkpoint = null; }, "checkpoint_unavailable"],
  ["old tip", (b) => { b.supplied_trust.checkpoint.tip_hash = "0".repeat(64); }, "checkpoint_mismatch_or_unverified"],
  ["replayed challenge", (b) => { b.supplied_trust.checkpoint.challenge = id(999); }, "checkpoint_mismatch_or_unverified"],
  ["wrong key", (b) => { b.supplied_trust.key_id = id(999); }, "store_epoch_key_mismatch"],
  ["unknown signature", (b) => { b.supplied_trust.signature_checks[0].outcome = "unverified"; }, "signature_claim_unavailable"],
  ["wrong authority", (b) => { b.supplied_trust.authority_id = id(999); }, "authority_mismatch"],
]) test(`E-A supplied ${name} blocks the model and cannot fall back`, () => {
  const b = fixture(); change(b); const r = api.replayNativeBarAdmission(b);
  assert.equal(r.model_status, "blocked_supplied_model"); assert.ok(r.model_blockers.includes(reason)); assert.equal(r.execution_available, false);
});

for (const [name, change] of [
  ["reservation role alias", (b) => { b.records[1].body.data.artifacts[1].artifact_id = b.records[1].body.data.artifacts[0].artifact_id; }],
  ["foreign final path", (b) => { b.records[1].body.data.artifacts[1].path = "captures/2026-10-25/other.json"; }],
  ["nonempty created object", (b) => { b.records[2].body.data.proof.size = "1"; }],
  ["created object replacement", (b) => { b.records[3].body.data.proof.inode = "9999"; }],
  ["changed content flags", (b) => { b.records[3].body.data.proof.flags = "1"; }],
  ["different verified hash", (b) => { b.records[3].body.data.proof.sha256 = "0".repeat(64); }],
  ["wrong pending role", (b) => { b.records[4].body.data.artifact_id = b.records[1].body.data.artifacts[3].artifact_id; }],
  ["changed publication mtime", (b) => { b.records[5].body.data.proof.mtime_ns = ns(6); }],
  ["future publication bracket", (b) => { b.records[5].body.data.publication.after = time(20); }],
  ["different receipt payload", (b) => { b.records[6].body.data.receipt.payload_hash = "0".repeat(64); }],
  ["partition restamp", (b) => { b.records[6].body.data.receipt.partition_at = time(3); }],
  ["copied receipt linkage", (b) => { b.records.at(-1).body.data.receipt_preparation_hash = "0".repeat(64); }],
]) test(`E-A refuses ${name} even with a rehashed claimed ledger`, () => {
  const { b } = producer(); rewrite(b, change); assert.throws(() => api.replayNativeBarAdmission(b));
});

test("E-A all ordinary producer prefixes remain uncommitted, including a complete payload without a receipt", () => {
  const { b } = producer();
  for (let n = 2; n < b.records.length; ++n) {
    const prefix = checkpointFor({ ...structuredClone(b), records: structuredClone(b.records.slice(0, n)) });
    const r = api.replayNativeBarAdmission(prefix); assert.equal(r.producers[0].linked, false); assert.equal(r.committed_history_available, false);
    if (n === 6) assert.equal(r.producers[0].state, "payload_pending");
  }
});
test("E-A receipt linkage can be reverified under a fresh finite window without changing its original logical clock", () => {
  const p = producer(), b = p.b; b.records.pop(); checkpointFor(b);
  const originalTime = p.receipt.recorded_at, opened = 1000;
  const attempt = add(b, "producer_reverify_consumed", { producer_id: p.producer_id, ordinal: 1, attempt_id: id(16), plan_hash: evidenceHash("new verification"),
    window: { opened_at: time(opened), expires_at: time(opened + 600) }, prefix_hash: evidenceHash(b.records.at(-1)), purpose: "verify_existing_pair" }, opened);
  add(b, "receipt_linked", { producer_id: p.producer_id, receipt_preparation_hash: evidenceHash(b.records[6]), receipt_publication_hash: p.receiptPublication,
    verification_attempt_hash: attempt }, opened + 1);
  const r = api.replayNativeBarAdmission(b); assert.equal(r.producers[0].linked, true); assert.equal(r.producers[0].consumed_reverifications, 1);
  assert.equal(b.records[6].body.data.receipt.recorded_at, originalTime); assert.equal(r.original_acknowledgement, "not_proven");
});
test("E-A failed producer verifications remain spent and cannot discover a third attempt", () => {
  const p = producer(), b = p.b; b.records.pop(); checkpointFor(b);
  for (let ordinal = 1; ordinal <= 2; ++ordinal) add(b, "producer_reverify_consumed", { producer_id: p.producer_id, ordinal, attempt_id: id(15 + ordinal),
    plan_hash: evidenceHash(ordinal), window: { opened_at: time(1000 + ordinal), expires_at: time(1600 + ordinal) },
    prefix_hash: evidenceHash(b.records.at(-1)), purpose: "verify_existing_pair" }, 1000 + ordinal);
  assert.equal(api.replayNativeBarAdmission(b).producers[0].consumed_reverifications, 2);
  add(b, "producer_reverify_consumed", { producer_id: p.producer_id, ordinal: 3, attempt_id: id(93), plan_hash: evidenceHash(3),
    window: { opened_at: time(1003), expires_at: time(1603) }, prefix_hash: evidenceHash(b.records.at(-1)), purpose: "verify_existing_pair" }, 1003);
  assert.throws(() => api.replayNativeBarAdmission(b));
});
test("E-A recording sequences cannot run backward across producer operations", () => {
  const b = producer(fixture(), 10, 2).b; producer(b, 100, 1);
  assert.throws(() => api.replayNativeBarAdmission(b), /sequence/);
});

test("E-A exclusive creation cannot predate its reservation even inside the invocation window", () => {
  const { b } = producer(); rewrite(b, (v) => {
    v.records[1].body.data.window = { opened_at: time(0), expires_at: time(600) };
    v.records[2].body.data.proof.birthtime_ns = ns(1);
  });
  assert.throws(() => api.replayNativeBarAdmission(b), /created_binding/);
});
test("E-A future-born roots and aliased enrollment roles are inconsistent even after repinning", () => {
  for (const change of [
    (b) => { b.records[0].body.data.store_root.birthtime_ns = ns(99); },
    (b) => { b.supplied_trust.epoch_id = b.supplied_trust.store_id; b.records[0].body.epoch_id = b.supplied_trust.store_id; },
  ]) {
    const b = fixture(); rewrite(b, change, true); assert.throws(() => api.replayNativeBarAdmission(b));
  }
});
test("E-A an unresolved maintenance blocks unrelated producer writes", () => {
  const { b } = maintenance(); producer(b, 100, 2);
  assert.throws(() => api.replayNativeBarAdmission(b), /maintenance.*producer/);
});
test("E-A capacity retains all three native coordination objects for all three maintenance invocations", () => {
  const r = api.calculateNativeBarAdmissionCapacity(accounting({ producer_operations: 0, maintenance_targets: 1 }));
  const slot = r.schedule.find((s) => s.root === "data" && s.role === "maintenance_coordination");
  assert.equal(slot?.count, 9); assert.equal(slot.temporary_slots, 0);
});
test("E-A a producer cannot invent an undeclared verification ID after a failure", () => {
  const p = producer(), b = p.b; b.records.pop(); checkpointFor(b);
  add(b, "producer_reverify_consumed", { producer_id: p.producer_id, ordinal: 1, attempt_id: id(99), plan_hash: evidenceHash("fresh"),
    window: { opened_at: time(1000), expires_at: time(1600) }, prefix_hash: evidenceHash(b.records.at(-1)), purpose: "verify_existing_pair" }, 1000);
  assert.throws(() => api.replayNativeBarAdmission(b), /reverification_binding/);
});

for (const [name, change] of [
  ["duplicate target", (b) => { const s = b.records[6].body.data.scope; s.targets.push(structuredClone(s.targets[0])); }],
  ["live producer", (b) => { b.records[6].body.data.scope.targets[0].producer_liveness = "live"; }],
  ["changed target identity", (b) => { b.records[6].body.data.scope.targets[0].proof.inode = "999"; }],
  ["different source slot", (b) => { b.records[6].body.data.scope.targets[0].source_path = "captures/other.json"; }],
  ["different publication", (b) => { b.records[6].body.data.scope.targets[0].publication_hash = "0".repeat(64); }],
  ["role ID reuse", (b) => { b.records[6].body.data.scope.attempt_ids[1] = id(16); }],
  ["unsealed original", (b) => { b.records.splice(7, 1); }],
  ["manifest substitution", (b) => { b.records[7].body.data.manifest_proof.sha256 = "0".repeat(64); }],
  ["original inode alias", (b) => { b.records[7].body.data.original_proof.inode = "1000"; }],
  ["skipped ordinal", (b) => { b.records[8].body.data.ordinal = 2; }],
  ["invented consumed predecessor", (b) => { b.records[8].body.data.prefix_hash = "0".repeat(64); }],
  ["unknown event prefix", (b) => { b.records[8].body.data.event_prefix_hash = "0".repeat(64); }],
  ["renewed original window", (b) => { b.records[8].body.data.window = { opened_at: time(8), expires_at: time(608) }; }],
]) test(`E-A maintenance refuses ${name}`, () => {
  const { b } = maintenance(); rewrite(b, change); assert.throws(() => api.replayNativeBarAdmission(b));
});
for (const state of ["live", "suspended", "unknown", "known_dead", "unwitnessed"]) test(`E-A restart with ${state} coordination is diagnostic only`, () => {
  const { b, scope } = maintenance();
  const r = api.assessNativeBarAdmissionRestart({ bundle: b, maintenance_id: scope.maintenance_id, now: b.as_of,
    coordination: state, current_reference_hash: evidenceHash("fresh reference 1") });
  assert.equal(r.decision, "diagnostics_only"); assert.equal(r.restored_grant, false);
});
test("E-A recovery consumption is retained across JSON replay and never provides a fourth ordinal", () => {
  const { b, scope, consume } = maintenance(); consume(2); consume(3);
  const reopened = api.decodeNativeBarAdmission(Buffer.from(canonical(b)));
  const r = api.assessNativeBarAdmissionRestart({ bundle: reopened, maintenance_id: scope.maintenance_id, now: b.as_of,
    coordination: "clear", current_reference_hash: evidenceHash("fresh reference 3") });
  assert.deepEqual(api.replayNativeBarAdmission(reopened).maintenance[0].consumed_ordinals, [1, 2, 3]);
  assert.equal(r.next_ordinal, null); assert.ok(r.model_blockers.includes("attempts_exhausted")); assert.equal(r.recovery_execution_available, false);
});
test("E-A restart rejects stale views and changed current references without mutating the original baseline", () => {
  const { b, scope } = maintenance(), before = canonical(b);
  for (const now of [time(0), time(610)]) {
    const r = api.assessNativeBarAdmissionRestart({ bundle: b, maintenance_id: scope.maintenance_id, now,
      coordination: "clear", current_reference_hash: evidenceHash("different references") });
    assert.equal(r.decision, "diagnostics_only"); assert.ok(r.model_blockers.includes("fresh_view_required"));
    assert.ok(r.model_blockers.includes("current_references_changed"));
  }
  assert.equal(api.replayNativeBarAdmission(b).maintenance[0].original_reference_hash, scope.reference_hash); assert.equal(canonical(b), before);
});
test("E-A a sealed but never invoked original cannot bypass the reference comparison", () => {
  const { b, scope } = maintenance(); b.records.pop(); checkpointFor(b);
  const restart = (current_reference_hash) => api.assessNativeBarAdmissionRestart({ bundle: b, maintenance_id: scope.maintenance_id, now: b.as_of,
    coordination: "clear", current_reference_hash });
  const changed = restart(evidenceHash("changed after original seal"));
  assert.ok(changed.model_blockers.includes("current_references_changed")); assert.equal(changed.next_ordinal, null);
  const unchanged = restart(scope.reference_hash);
  assert.equal(unchanged.decision, "requires_fresh_admission"); assert.equal(unchanged.next_ordinal, 2);
});

function coordination(m, { attempt = 1, born, incarnation = evidenceHash(`worker incarnation ${attempt}`) } = {}) {
  const at = clock(m.b), owner_token = id(59 + attempt), entries = ["lock", "claim", "ticket"].map((role, i) => {
    const body_hash = evidenceHash({ role });
    return { role, path: role === "lock" ? ".writer.lock" : `.writer-${role}-${owner_token}.json`, body_hash,
      proof: fileProof(String(6000 + 10 * attempt + i), 100, body_hash, born ?? at, at) };
  });
  const d = { maintenance_id: m.scope.maintenance_id, attempt_id: m.scope.attempt_ids[attempt - 1], owner_token,
    owner_incarnation_hash: incarnation, entries };
  const own_delta_hash = evidenceHash({ domain: "native-bar-admission-coordination-v6", coordination: d });
  add(m.b, "coordination_witness", { ...d, own_delta_hash }); return { ...d, own_delta_hash };
}
function publication(m, role, inode = "7000") {
  const slot = m.layout.slots.find((s) => s.role === role), at = clock(m.b), content_hash = evidenceHash({ role });
  return add(m.b, "publication_witness", { maintenance_id: m.scope.maintenance_id, attempt_id: m.scope.attempt_ids[0], role,
    path: slot.path, content_hash, proof: fileProof(inode, 100, content_hash, at, at), publication: { before: time(at), after: time(at) } });
}
test("E-A coordination own-delta binds every role and its native proof, not just the supplied digest label", () => {
  const m = maintenance(), d = coordination(m); assert.equal(api.nativeBarAdmissionCoordinationDigest(Object.fromEntries(Object.entries(d).filter(([k]) => k !== "own_delta_hash"))), d.own_delta_hash);
  assert.equal(api.replayNativeBarAdmission(m.b).model_status, "consistent_supplied_model");
  rewrite(m.b, (b) => { b.records.at(-1).body.data.own_delta_hash = "0".repeat(64); });
  assert.throws(() => api.replayNativeBarAdmission(m.b), /coordination/);
});
test("E-A publication evidence requires witnessed coordination and the declared attempt publication", () => {
  const m = maintenance(); publication(m, "event"); assert.throws(() => api.replayNativeBarAdmission(m.b), /publication.*order/);
  const n = maintenance(); coordination(n); publication(n, "attempt"); publication(n, "event", "7001");
  assert.equal(api.replayNativeBarAdmission(n.b).maintenance[0].witnessed_publications, 2);
});
test("E-A terminal publication evidence never implies a verified transaction or spent targets", () => {
  const m = maintenance(); coordination(m); publication(m, "attempt"); publication(m, "completion", "7001");
  const r = api.replayNativeBarAdmission(m.b); assert.equal(r.maintenance[0].terminal_witness_present, true);
  assert.equal(r.maintenance[0].journal_replay_verified, false); assert.equal(r.committed_history_available, false);
  const q = api.assessNativeBarAdmissionRestart({ bundle: m.b, maintenance_id: m.scope.maintenance_id, now: m.b.as_of,
    coordination: "clear", current_reference_hash: evidenceHash("fresh reference 1") });
  assert.equal(q.decision, "diagnostics_only"); assert.ok(q.model_blockers.includes("terminal_journal_requires_verification"));
});

test("E-A raw metadata must be canonical fatal UTF-8 without duplicate keys or trailing bytes", () => {
  const b = fixture(), raw = canonical(b); assert.deepEqual(api.decodeNativeBarAdmission(Buffer.from(raw)), b);
  for (const value of [Buffer.from([0xff]), Buffer.from(raw + "\n"), Buffer.from(" " + raw),
    Buffer.from(raw.replace('"as_of":', '"as_of":"2020-01-01T00:00:00.000Z","as_of":'))]) assert.throws(() => api.decodeNativeBarAdmission(value));
});
test("E-A bounds recursive structured input before schema work without invoking getters", () => {
  let called = false; const getter = fixture(); Object.defineProperty(getter, "unexpected", { enumerable: true, get() { called = true; return 1; } });
  assert.throws(() => api.replayNativeBarAdmission(getter), /non_json/); assert.equal(called, false);
  const cyclic = fixture(); cyclic.self = cyclic; assert.throws(() => api.replayNativeBarAdmission(cyclic), /non_json/);
  let deep = {}; for (let i = 0; i < 70; i++) deep = { child: deep };
  assert.throws(() => api.replayNativeBarAdmission(deep), /depth/);
  assert.throws(() => api.decodeNativeBarAdmission(new Uint8Array(api.NATIVE_BAR_ADMISSION_LIMITS.metadata_bytes + 1)), /bytes/);
  const huge = fixture(); huge.extra = "x".repeat(api.NATIVE_BAR_ADMISSION_LIMITS.metadata_bytes); assert.throws(() => api.replayNativeBarAdmission(huge), /bytes/);
});
test("E-A digests are acyclic and include the domain and canonical body, not signature or future acknowledgements", () => {
  const b = fixture(), r = b.records[0]; assert.equal(api.nativeBarAdmissionBodyDigest(r.body), r.signature.body_digest);
  const before = api.nativeBarAdmissionBodyDigest(r.body); r.signature.signature_hex = "ff";
  assert.equal(api.nativeBarAdmissionBodyDigest(r.body), before); assert.notEqual(evidenceHash(r.body), before);
  assert.throws(() => api.nativeBarAdmissionBodyDigest({ ...r.body, persisted_at: b.as_of }));
});

for (const [field, reason, limit] of [["read_bytes", "read_capacity", 256 * 1024 ** 2], ["response_bytes", "response_capacity", 8 * 1024 ** 2],
  ["roots", "root_capacity", 5], ["live_targets", "target_capacity", 30], ["descriptors", "descriptor_capacity", 464]]) {
  test(`E-A exact ${field} boundary fits and one over refuses`, () => {
    const numeric = ["roots", "live_targets", "descriptors"].includes(field);
    assert.equal(api.calculateNativeBarAdmissionCapacity(accounting({ [field]: numeric ? limit : String(limit) })).fits, true);
    const r = api.calculateNativeBarAdmissionCapacity(accounting({ [field]: numeric ? limit + 1 : String(limit + 1) })); assert.ok(r.reasons.includes(reason));
  });
}
for (const [field, limit] of [["entries", 512], ["inventory_bytes", 1024 ** 3], ["metadata_bytes", 16 * 1024 ** 2], ["allocated_bytes", 1024 ** 3]]) {
  test(`E-A retained ${field} across all roots is counted at the boundary and one over`, () => {
    const input = accounting(), initial = api.calculateNativeBarAdmissionCapacity(input), delta = BigInt(limit) - BigInt(initial.peak[field]);
    input.data[field] = String(BigInt(input.data[field]) + delta);
    if (field === "metadata_bytes") input.data.inventory_bytes = input.data.metadata_bytes;
    assert.equal(api.calculateNativeBarAdmissionCapacity(input).fits, true);
    input.authority[field] = String(BigInt(input.authority[field]) + 1n);
    assert.ok(api.calculateNativeBarAdmissionCapacity(input).reasons.includes(`${field}_capacity`));
  });
}
for (const [name, overrides] of [["producer", {}], ["maintenance", { producer_operations: 0, maintenance_targets: 1 }]])
  test(`E-A ${name} data and witness roots share one store-volume free space under the reserve-plus-twice rule`, () => {
    const input = accounting(overrides), r = api.calculateNativeBarAdmissionCapacity(input), f = r.future, reserve = BigInt(r.retained_reserve_bytes);
    const data = BigInt(f.data.allocated_bytes), witness = BigInt(f.witness.allocated_bytes), need = reserve + 2n * (data - reserve + witness);
    assert.equal(r.required_available_bytes.store_volume, String(need));
    input.free_space.store_volume = String(need); assert.equal(api.calculateNativeBarAdmissionCapacity(input).fits, true);
    // One volume is not counted once per root: free space that covers each root alone no longer fits.
    for (const short of [need - 1n, data > witness ? data : witness, data + witness]) {
      input.free_space.store_volume = String(short); assert.ok(api.calculateNativeBarAdmissionCapacity(input).reasons.includes("store_volume_space_insufficient"));
    }
    input.free_space.store_volume = null; assert.ok(api.calculateNativeBarAdmissionCapacity(input).reasons.includes("store_volume_space_unknown"));
  });
test("E-A authority free space is separate unless the authority declares the store volume", () => {
  const input = accounting(), r = api.calculateNativeBarAdmissionCapacity(input), authority = 2n * BigInt(r.future.authority.allocated_bytes);
  assert.equal(r.required_available_bytes.authority, String(authority));
  input.free_space.authority = String(authority); assert.equal(api.calculateNativeBarAdmissionCapacity(input).fits, true);
  input.free_space.authority = String(authority - 1n); assert.ok(api.calculateNativeBarAdmissionCapacity(input).reasons.includes("authority_space_insufficient"));
  input.free_space.authority = null; assert.ok(api.calculateNativeBarAdmissionCapacity(input).reasons.includes("authority_space_unknown"));
  input.free_space.authority = "store_volume"; const shared = api.calculateNativeBarAdmissionCapacity(input);
  assert.equal(shared.required_available_bytes.authority, "store_volume");
  assert.equal(BigInt(shared.required_available_bytes.store_volume), BigInt(r.required_available_bytes.store_volume) + authority);
});
test("E-A capacity schedules every declared native journal slot and keeps conservative refusals", () => {
  const m = maintenance();
  for (const count of [1, 2]) {
    const r = api.calculateNativeBarAdmissionCapacity(accounting({ producer_operations: 0, maintenance_targets: count }));
    const layout = api.createNativeBarAdmissionLayout({ maintenance_id: m.scope.maintenance_id, scope_id: m.scope.scope_id,
      attempt_ids: m.scope.attempt_ids, target_ids: [id(35), id(36)].slice(0, count) });
    const journals = r.schedule.filter((s) => s.root === "data" && s.role.startsWith("maintenance_") && s.role !== "maintenance_coordination");
    assert.equal(journals.reduce((n, s) => n + s.count, 0), layout.slots.length);
    assert.equal(layout.slots.length, count === 1 ? 23 : 37); assert.equal(new Set(layout.slots.flatMap((s) => s.temporaries)).size, layout.slots.length * 3);
    if (count === 2) { assert.equal(r.fits, false); assert.ok(r.reasons.includes("entries_capacity")); }
  }
  assert.throws(() => api.calculateNativeBarAdmissionCapacity(accounting({ publication_count: 0 })));
  assert.throws(() => api.calculateNativeBarAdmissionCapacity(accounting({ producer_operations: 0, maintenance_targets: 0 })));
  assert.throws(() => api.calculateNativeBarAdmissionCapacity(accounting({ maintenance_targets: 3 })));
});
test("E-A independent slot counts include finals, three metadata temporaries and retained coordination", () => {
  const producerBudget = api.calculateNativeBarAdmissionCapacity(accounting());
  // 15 producer records mirrored twice; 16 authority checkpoints; 2 payload/receipt objects; 6 directories.
  assert.equal(producerBudget.future.data.entries, "68"); assert.equal(producerBudget.future.witness.entries, "64");
  assert.equal(producerBudget.future.authority.entries, "64"); assert.equal(producerBudget.peak.entries, "199");
  const maintenanceBudget = api.calculateNativeBarAdmissionCapacity(accounting({ producer_operations: 0, maintenance_targets: 1 }));
  // 23 journal finals x 4 slots + 32 R-D headroom slots + 9 coordination objects + 1 retained reserve + 9 directories;
  // 30 witness/checkpoint finals x 4.
  assert.equal(maintenanceBudget.future.data.entries, "143"); assert.equal(maintenanceBudget.future.witness.entries, "120");
  assert.equal(maintenanceBudget.future.authority.entries, "120"); assert.equal(maintenanceBudget.peak.entries, "386");
  // Two producers may use two partition days: 30 records x 4 + 4 payload/receipt objects + captures, receipts and producer
  // directories plus, per operation, its captures day, receipts day and producer directory.
  assert.equal(api.calculateNativeBarAdmissionCapacity(accounting({ producer_operations: 2 })).future.data.entries, "133");
});
test("E-A maintenance capacity is at least R-D's bound for the same journal, including its retained reserve", () => {
  for (const targets of [1, 2]) {
    const r = api.calculateNativeBarAdmissionCapacity(accounting({ producer_operations: 0, maintenance_targets: targets }));
    const bound = BigInt((4 * (9 + 14 * targets) + 32) * 65536 + 1048576);
    assert.equal(r.retained_reserve_bytes, String(bound));
    assert.ok(BigInt(r.future.data.metadata_bytes) >= bound); assert.ok(BigInt(r.future.data.allocated_bytes) >= 2n * bound);
    // R-D requires the new reserve plus twice the remaining journal on its volume.
    assert.ok(BigInt(r.required_available_bytes.store_volume) >= 3n * bound);
  }
});
test("E-A read capacity charges derived mandatory rereads, not a lower supplied aggregate", () => {
  const input = accounting({ producer_operations: 0, maintenance_targets: 1, read_bytes: "0" }), r = api.calculateNativeBarAdmissionCapacity(input);
  assert.equal(r.mandatory_read_bytes, String(BigInt(r.peak.metadata_bytes) + 2n * 1048576n)); assert.equal(r.charged_read_bytes, r.mandatory_read_bytes);
  input.read_bytes = String(256 * 1024 ** 2); assert.equal(api.calculateNativeBarAdmissionCapacity(input).charged_read_bytes, input.read_bytes);
});
test("E-A receipt linkage exactly at the original expiry is refused without deadline extension", () => {
  const p = producer(); rewrite(p.b, (b) => { b.records.at(-1).body.at = time(602); });
  assert.throws(() => api.replayNativeBarAdmission(p.b), /window/);
});
test("E-A sparse array lengths are bounded before canonical serialization", () => {
  for (const length of [262145, 4294967295]) {
    const b = fixture(); b.extra = new Array(length);
    assert.throws(() => api.replayNativeBarAdmission(b), /admission_input_depth_or_nodes/);
  }
});
test("E-A array subclasses and extra array fields cannot hide data or invoke custom serialization", () => {
  const b = fixture(); let called = false;
  Object.setPrototypeOf(b.records, Object.assign(Object.create(Array.prototype), { map() { called = true; return []; } }));
  assert.throws(() => api.replayNativeBarAdmission(b), /admission_non_json/); assert.equal(called, false);
  const c = fixture(); c.records.unexpected = "not a JSON array element";
  assert.throws(() => api.replayNativeBarAdmission(c), /admission_non_json/);
});
for (const role of ["coordination", "publication"]) test(`E-A ${role} object bytes cannot exceed the capacity slot ceiling`, () => {
  for (const size of [65536, 65537]) {
    const m = maintenance(); coordination(m);
    if (role === "publication") publication(m, "attempt");
    rewrite(m.b, (b) => {
      const d = b.records.at(-1).body.data;
      if (role === "publication") d.proof.size = String(size);
      else {
        d.entries[0].proof.size = String(size);
        const { own_delta_hash, ...delta } = d;
        d.own_delta_hash = evidenceHash({ domain: "native-bar-admission-coordination-v6", coordination: delta });
      }
    });
    if (size === 65536) assert.equal(api.replayNativeBarAdmission(m.b).model_status, "consistent_supplied_model");
    else assert.throws(() => api.replayNativeBarAdmission(m.b), /admission_metadata_object_bytes/);
  }
});
test("E-A a second unresolved maintenance cannot overlap even on another orphan payload", () => {
  const m = maintenance(true), { b, other } = m, scope = structuredClone(m.scope);
  scope.maintenance_id = id(40); scope.scope_id = id(41); scope.attempt_ids = [id(42), id(43), id(44)];
  const pub = b.records.find((r) => r.body.type === "publication_observed" && r.body.data.artifact_id === other.artifacts[1].artifact_id);
  scope.targets = [{ target_id: id(45), producer_id: other.producer_id, artifact_id: other.artifacts[1].artifact_id,
    source_path: other.artifacts[1].path, publication_hash: other.payloadPublication, proof: structuredClone(pub.body.data.proof),
    receipt_state: "absent", producer_liveness: "dead" }];
  scope.layout_digest = evidenceHash(api.createNativeBarAdmissionLayout({ maintenance_id: scope.maintenance_id, scope_id: scope.scope_id,
    attempt_ids: scope.attempt_ids, target_ids: [id(45)] }));
  const at = clock(b); scope.window = { opened_at: time(at), expires_at: time(at + 600) };
  assert.equal(api.replayNativeBarAdmission(b).model_status, "consistent_supplied_model");
  add(b, "maintenance_admitted", { scope, scope_digest: api.nativeBarAdmissionScopeDigest(scope) });
  assert.throws(() => api.replayNativeBarAdmission(b), /admission_unresolved_maintenance/);
});
test("E-A UTC midnight preserves the pre-publication partition and the later logical receipt clock", () => {
  const { b } = producer(), oldReceiptHash = evidenceHash(b.records[6].body.data.receipt), offset = -6500;
  function shifted(value, key) {
    if (["birthtime_ns", "mtime_ns", "ctime_ns"].includes(key)) return String(BigInt(value) + BigInt(offset) * 1000000n);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(Date.parse(value) + offset).toISOString();
    if (Array.isArray(value)) return value.map((v) => shifted(v));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shifted(v, k)]));
    return value;
  }
  rewrite(b, (v) => {
    for (const r of v.records) r.body = shifted(r.body);
    const reservation = v.records[1].body.data, receipt = v.records[6].body.data.receipt, day = reservation.partition_at.slice(0, 10);
    for (const a of reservation.artifacts) if (a.role.endsWith("_final"))
      a.path = `${a.role.startsWith("payload") ? "captures" : "receipts"}/${day}/${reservation.recording_id}.json`;
    receipt.day = day;
    for (const r of v.records) if (r.body.data.proof?.sha256 === oldReceiptHash) {
      r.body.data.proof.sha256 = evidenceHash(receipt); r.body.data.proof.size = String(Buffer.byteLength(canonical(receipt)));
    }
  }, true);
  assert.equal(b.records[5].body.at, "2026-10-24T23:59:59.500Z");
  assert.equal(b.records[6].body.data.receipt.recorded_at, "2026-10-25T00:00:00.500Z");
  assert.equal(b.records[6].body.data.receipt.day, "2026-10-24");
  const before = canonical(b), r = api.replayNativeBarAdmission(b);
  assert.equal(r.model_status, "consistent_supplied_model"); assert.equal(r.producers[0].linked, true);
  assert.equal(r.storage_visibility_at_as_of, "not_proven"); assert.equal(canonical(b), before);
});
const restartOf = (b, maintenance_id, current_reference_hash, coordination = "clear") =>
  api.assessNativeBarAdmissionRestart({ bundle: b, maintenance_id, now: b.as_of, coordination, current_reference_hash });
for (const [name, overrides, reason] of [
  ["the original plan and window", (m) => ({ plan_hash: m.scope.original_plan_hash, window: structuredClone(m.scope.window) }), /admission_window_reuse|admission_plan_reuse/],
  ["the original plan under a new window", (m) => ({ plan_hash: m.scope.original_plan_hash }), /admission_plan_reuse/],
  ["the original window under a new plan", (m) => ({ window: structuredClone(m.scope.window) }), /admission_window_reuse/],
  ["a window opened before ordinal one was consumed", (m) => {
    const opened = Date.parse(m.scope.window.opened_at) + 1000;
    return { window: { opened_at: new Date(opened).toISOString(), expires_at: new Date(opened + 600000).toISOString() } };
  }, /admission_window_reuse/],
]) test(`E-A recovery ordinal two cannot reuse ${name}`, () => {
  const m = maintenance(); m.consume(2, overrides(m));
  assert.throws(() => api.replayNativeBarAdmission(m.b), reason);
});
test("E-A recovery ordinal three cannot reuse ordinal two's plan or window", () => {
  for (const key of ["plan_hash", "window"]) {
    const m = maintenance(); m.consume(2); const previous = m.b.records.at(-1).body.data;
    m.consume(3, { [key]: structuredClone(previous[key]) });
    assert.throws(() => api.replayNativeBarAdmission(m.b), key === "window" ? /admission_window_reuse/ : /admission_plan_reuse/);
  }
});
test("E-A producer reverification needs its own plan digest and a window after the original", () => {
  function reverify(p, window, plan_hash, at) {
    p.b.records.pop(); checkpointFor(p.b);
    add(p.b, "producer_reverify_consumed", { producer_id: p.producer_id, ordinal: 1, attempt_id: id(16), plan_hash, window,
      prefix_hash: evidenceHash(p.b.records.at(-1)), purpose: "verify_existing_pair" }, at);
  }
  const original = producer(); reverify(original, structuredClone(original.b.records[1].body.data.window), evidenceHash("new verification"), 20);
  assert.throws(() => api.replayNativeBarAdmission(original.b), /admission_window_reuse/);
  const reused = producer(); reverify(reused, { opened_at: time(1000), expires_at: time(1600) }, reused.receipt.plan_hash, 1000);
  assert.throws(() => api.replayNativeBarAdmission(reused.b), /admission_plan_reuse/);
});
test("E-A restart freshness comes from the checkpoint observation, not a relabelled as_of", () => {
  const { b, scope } = maintenance(); b.as_of = new Date(Date.parse(b.supplied_trust.checkpoint.observed_at) + 30 * 86400000).toISOString();
  const r = restartOf(b, scope.maintenance_id, evidenceHash("fresh reference 1"));
  assert.equal(r.decision, "diagnostics_only"); assert.ok(r.model_blockers.includes("fresh_view_required")); assert.equal(r.next_ordinal, null);
});
test("E-A a second producer cannot start while another may still write", () => {
  const a = producer(); a.b.records = a.b.records.slice(0, 6); checkpointFor(a.b); producer(a.b, 100, 2);
  assert.throws(() => api.replayNativeBarAdmission(a.b), /admission_writer_overlap/);
  const c = producer(); c.b.records = c.b.records.slice(0, 6); checkpointFor(c.b); producer(c.b, 100, 2, 610);
  assert.equal(api.replayNativeBarAdmission(c.b).model_status, "consistent_supplied_model");
});
test("E-A maintenance cannot be admitted while its target or an unrelated producer may still write", () => {
  assert.throws(() => api.replayNativeBarAdmission(maintenance(false, { admitAt: 7 }).b), /admission_writer_overlap/);
  assert.throws(() => api.replayNativeBarAdmission(maintenance(true, { admitAt: 1000 }).b), /admission_writer_overlap/);
});
test("E-A a recovery attempt cannot adopt coordination born before its consumption or reuse a worker incarnation", () => {
  const early = maintenance(), firstWorker = clock(early.b) - 1; early.consume(2); coordination(early, { attempt: 2, born: firstWorker });
  assert.throws(() => api.replayNativeBarAdmission(early.b), /admission_coordination_binding/);
  const ancient = maintenance(); coordination(ancient, { born: 0 });
  assert.throws(() => api.replayNativeBarAdmission(ancient.b), /admission_coordination_binding/);
  const reused = maintenance(); coordination(reused); reused.consume(2); coordination(reused, { attempt: 2, incarnation: evidenceHash("worker incarnation 1") });
  assert.throws(() => api.replayNativeBarAdmission(reused.b), /admission_coordination_binding/);
  const fresh = maintenance(); coordination(fresh); fresh.consume(2); coordination(fresh, { attempt: 2 });
  assert.equal(api.replayNativeBarAdmission(fresh.b).model_status, "consistent_supplied_model");
});
test("E-A the original and manifest objects cannot predate the admission record they hash", () => {
  assert.equal(api.replayNativeBarAdmission(maintenance(false, { windowLead: 5 }).b).model_status, "consistent_supplied_model");
  assert.throws(() => api.replayNativeBarAdmission(maintenance(false, { windowLead: 5, originalBorn: 607 }).b), /admission_original_object_binding/);
});
test("E-A diagnostics never report a next ordinal, and ledger coordination overrides a supplied clear state", () => {
  const { b } = maintenance(), unknown = restartOf(b, id(999), evidenceHash("fresh reference 1"));
  assert.equal(unknown.decision, "diagnostics_only"); assert.equal(unknown.next_ordinal, null);
  const m = maintenance(); coordination(m); const q = restartOf(m.b, m.scope.maintenance_id, evidenceHash("fresh reference 1"));
  assert.equal(q.decision, "diagnostics_only"); assert.ok(q.model_blockers.includes("ledger_coordination_unretired")); assert.equal(q.next_ordinal, null);
  assert.deepEqual(api.replayNativeBarAdmission(m.b).maintenance[0].coordination_witnessed_ordinals, [1]);
});
test("E-A raw decoding bounds nesting and value count before JSON parsing", () => {
  for (const raw of ["[".repeat(100), "[" + "0,".repeat(300000)]) assert.throws(() => api.decodeNativeBarAdmission(Buffer.from(raw)), /admission_input_depth_or_nodes/);
  // Brackets, commas and escaped quotes inside strings are data, not structure.
  for (const raw of [JSON.stringify("[".repeat(100)), JSON.stringify('\\"' + "[,".repeat(300000))])
    assert.throws(() => api.decodeNativeBarAdmission(Buffer.from(raw)), (e) => !/depth_or_nodes/.test(e.message));
  assert.deepEqual(api.decodeNativeBarAdmission(Buffer.from(canonical(producer().b))).records.length, 12);
});
test("E-A the supplied challenge is a distinct role identifier", () => {
  assert.throws(() => api.replayNativeBarAdmission(producer(fixture(), 5).b), /admission_role_id_reuse/);
});
test("E-A malformed raw bytes refuse with coded errors, never parser text quoting the input", () => {
  assert.throws(() => api.decodeNativeBarAdmission(Buffer.from("secret-ish text")), (e) => e.message === "admission_malformed_json");
  assert.throws(() => api.decodeNativeBarAdmission(Buffer.from([0xff])), (e) => e.message === "admission_invalid_utf8");
});
