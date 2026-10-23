import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonical, evidenceHash } from "../../build/nativeBarEvidence.js";
import { replayNativeBarTransaction, assessNativeBarQuarantineAge, calculateNativeBarTransactionCapacity,
  NATIVE_BAR_TRANSACTION_LIMITS as limits } from "../../build/nativeBarTransactions.js";

const at = "2026-10-23T00:00:00.000Z";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ns = (s) => String(BigInt(Date.parse(s)) * 1000000n);
const clock = (utc_at = at, reading = "1000000000", boot = id(90)) => ({ utc_at,
  elapsed: { boot_id: boot, source_id: "synthetic-boot-clock", reading_ns: reading, qualified: true } });
const binding = { profile: "native-bar-transaction-profile-v2", policy_hash: evidenceHash("fixture-policy"),
  root: { device: "1", inode: "2", uid: "501", mode: "16832", acl: "none" }, backend_protocol: 2, capabilities_hash: evidenceHash("fixture-only") };
function proof(inode = "3", time = at) { return { device: "1", inode, uid: "501", gid: "20", mode: "33152", nlink: "1",
  acl: "none", size: "8", sha256: evidenceHash("invented bytes"), birthtime_ns: ns(at), mtime_ns: ns(at), ctime_ns: ns(time) }; }
function fixture() {
  const target = { target_id: id(2), origin: { kind: "capture", recording_id: id(3) },
    source_path: `captures/2026-10-23/${id(3)}.json`, proof: proof(),
    parents: ["captures", "captures/2026-10-23"].map((path, i) => ({ path, device: "1", inode: String(10 + i), uid: "501", mode: "16832", acl: "none" })) };
  const manifest = { schema: "native-bar-maintenance-manifest-v2", maintenance_id: id(1), chunk_id: id(4), targets: [target] };
  const intent = { schema: "native-bar-maintenance-intent-v2", maintenance_id: id(1), kind: "quarantine_abandoned", binding: structuredClone(binding),
    created: clock(), approval_plan_hash: evidenceHash("audit only, not authority"),
    baseline: { inventory_hash: evidenceHash("inventory"), reference_hash: evidenceHash("references") },
    manifests: [{ chunk_id: id(4), hash: evidenceHash(manifest) }], target_count: 1, quarantine_refs: [] };
  return { schema: "native-bar-transaction-bundle-v2", intent, manifests: [manifest], quarantines: [], attempts: [], events: [], completion: null };
}
test("a bound manifest describes an unstarted transaction without authorizing any operation", () => {
  const f = fixture(), before = canonical(f), r = replayNativeBarTransaction(f);
  assert.equal(r.status, "not_started_or_unconfirmed"); assert.equal(r.execution_available, false);
  assert.equal(r.verification_scope, "supplied_records_only"); assert.equal(r.original_acknowledgement, "not_proven");
  assert.equal(r.targets[0].state, "source"); assert.equal(canonical(f), before);
  f.manifests[0].targets[0].proof.inode = "99";
  assert.throws(() => replayNativeBarTransaction(f), /manifest_binding/);
});
const time = (seconds) => new Date(Date.parse(at) + seconds * 1000).toISOString();
const tick = (seconds) => clock(time(seconds), String(1000000000n + BigInt(seconds) * 1000000000n));
function attempt(f, actions = ["stage", "quarantine"]) {
  return { schema: "native-bar-maintenance-attempt-v2", attempt_id: id(20), maintenance_id: f.intent.maintenance_id,
    intent_hash: evidenceHash(f.intent), binding_hash: evidenceHash(f.intent.binding), approval_plan_hash: evidenceHash("new approval audit"),
    issued: tick(1), expires_at: time(601), resume_after_event_hash: null,
    reference_hash: f.intent.baseline.reference_hash,
    actions: actions.map((action) => ({ target_id: id(2), action })),
    observations: [{ target_id: id(2), source: f.manifests[0].targets[0].proof, holding: null, quarantine: null }] };
}
function event(f, type, seconds, fields = {}) {
  const a = f.attempts.at(-1), e = { schema: "native-bar-maintenance-event-v2", maintenance_id: f.intent.maintenance_id,
    intent_hash: evidenceHash(f.intent), attempt_id: a.attempt_id, attempt_hash: evidenceHash(a), sequence: f.events.length + 1,
    previous_event_hash: f.events.length ? evidenceHash(f.events.at(-1)) : null,
    target_id: id(2), clock: tick(seconds), type, ...fields };
  f.events.push(e); return e;
}
test("quarantine replay requires pending and verified moves in order, then a bound marker completion", () => {
  const f = fixture(), original = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f));
  event(f, "move_pending", 2, { proof: original });
  assert.equal(replayNativeBarTransaction(f).targets[0].state, "move_pending");
  const held = { ...original, ctime_ns: ns(time(3)) };
  event(f, "held_verified", 3, { proof: held });
  assert.equal(replayNativeBarTransaction(f).targets[0].state, "holding");
  event(f, "quarantine_move_pending", 4, { proof: held });
  const final = { ...original, ctime_ns: ns(time(5)) };
  event(f, "quarantined_verified", 5, { proof: final });
  assert.equal(replayNativeBarTransaction(f).status, "quarantine_incomplete");
  const marker = { ...proof("60", time(6)), birthtime_ns: ns(time(6)), mtime_ns: ns(time(6)) };
  f.completion = { schema: "native-bar-maintenance-completion-v2", maintenance_id: id(1), intent_hash: evidenceHash(f.intent),
    last_event_hash: evidenceHash(f.events.at(-1)), attempt_hashes: [evidenceHash(f.attempts[0])], clock: tick(7),
    outcome: "complete", targets: [{ target_id: id(2), state: "quarantined", proof: final }],
    marker: { path: `quarantine/abandoned/${id(1)}/timestamp.json`, proof: marker } };
  const r = replayNativeBarTransaction(f);
  assert.equal(r.status, "complete"); assert.equal(r.execution_available, false);
  assert.deepEqual(r.spent_markers, []);
});
test("purge age requires strictly more than 90 days in wall and same-boot qualified elapsed evidence", () => {
  const days = 90n * 86400n * 1000000000n;
  const input = { quarantined_at: at, completed: clock(), observed: clock(time(90 * 86400), String(1000000000n + days)), native_times_ns: [ns(at)] };
  assert.equal(assessNativeBarQuarantineAge(input).eligible, false);
  input.observed = clock(time(90 * 86400 + 1), String(2000000000n + days));
  assert.equal(assessNativeBarQuarantineAge(input).eligible, true);
  input.observed.elapsed.boot_id = id(91);
  assert.equal(assessNativeBarQuarantineAge(input).eligible, false);
  assert.ok(assessNativeBarQuarantineAge(input).reasons.includes("elapsed_clock_unverified"));
  input.observed = clock(time(91 * 86400), "2");
  assert.equal(assessNativeBarQuarantineAge(input).eligible, false);
  input.observed.elapsed = null;
  assert.equal(assessNativeBarQuarantineAge(input).eligible, false);
});
const later = 91 * 86400;
function purgeFixture() {
  const f = fixture(), t = f.manifests[0].targets[0];
  const original = { ...t.proof, ctime_ns: ns(time(5)) };
  f.quarantines = [{ schema: "native-bar-quarantine-evidence-v2", quarantine_id: id(50), binding: structuredClone(binding),
    quarantined_at: time(5), completed: tick(7), marker_proof: { ...proof("60", time(6)), birthtime_ns: ns(time(6)), mtime_ns: ns(time(6)) },
    targets: [{ quarantine_target_id: id(51), origin: t.origin, proof: original }] }];
  t.source_path = `quarantine/abandoned/${id(50)}/${id(51)}`; t.proof = original;
  t.parents = ["quarantine", "quarantine/abandoned", `quarantine/abandoned/${id(50)}`]
    .map((path, i) => ({ path, device: "1", inode: String(10 + i), uid: "501", mode: "16832", acl: "none" }));
  Object.assign(f.intent, { kind: "purge_abandoned", created: tick(later),
    manifests: [{ chunk_id: id(4), hash: evidenceHash(f.manifests[0]) }],
    quarantine_refs: [{ quarantine_id: id(50), hash: evidenceHash(f.quarantines[0]) }] });
  const a = attempt(f, ["stage", "unlink"]); a.issued = tick(later + 1); a.expires_at = time(later + 601); f.attempts.push(a);
  return f;
}
function heldPurge() {
  const f = purgeFixture(); event(f, "move_pending", later + 2, { proof: f.manifests[0].targets[0].proof });
  event(f, "held_verified", later + 3, { proof: { ...f.manifests[0].targets[0].proof, ctime_ns: ns(time(later + 3)) } });
  return f;
}
function completion(f, state = "purged", outcome = "complete") {
  return { schema: "native-bar-maintenance-completion-v2", maintenance_id: id(1), intent_hash: evidenceHash(f.intent),
    last_event_hash: evidenceHash(f.events.at(-1)), attempt_hashes: f.attempts.map(evidenceHash), clock: tick(later + 9),
    outcome, targets: [{ target_id: id(2), state, proof: null }], marker: null };
}
test("purge requires a complete certificate set, verified holding and age before unlink; completion alone spends the marker", () => {
  const f = heldPurge(), p = f.events.at(-1).proof;
  event(f, "unlink_pending", later + 4, { proof: p, reference_hash: f.intent.baseline.reference_hash });
  assert.equal(replayNativeBarTransaction(f).status, "durability_unknown");
  event(f, "unlinked", later + 5, { proof: p, observed_absent: true, remaining_links: "0", synced: true });
  assert.deepEqual(replayNativeBarTransaction(f).spent_markers, []);
  f.completion = completion(f);
  assert.deepEqual(replayNativeBarTransaction(f).spent_markers, [id(50)]);
  f.quarantines[0].targets.push({ ...f.quarantines[0].targets[0], quarantine_target_id: id(52), proof: proof("99") });
  f.intent.quarantine_refs[0].hash = evidenceHash(f.quarantines[0]);
  assert.throws(() => replayNativeBarTransaction(f), /quarantine_set/);
});
function resume(f, issued, observations, actions) {
  const a = attempt(f, actions); a.attempt_id = id(21); a.issued = tick(issued); a.expires_at = time(issued + 600);
  a.resume_after_event_hash = evidenceHash(f.events.at(-1)); a.observations = observations; f.attempts.push(a); return a;
}
test("recovery of an unacknowledged move requires a new bound attempt and exact surviving object", () => {
  const f = fixture(), p = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f));
  const pending = event(f, "move_pending", 2, { proof: p });
  const held = { ...p, ctime_ns: ns(time(3)) };
  resume(f, 5, [{ target_id: id(2), source: null, holding: held, quarantine: null }], ["verify", "quarantine"]);
  event(f, "recovered_verified", 6, { location: "holding", proof: held, from_pending_event_hash: evidenceHash(pending) });
  assert.equal(replayNativeBarTransaction(f).targets[0].state, "holding");
  f.attempts[1].observations[0].source = p;
  f.events.at(-1).attempt_hash = evidenceHash(f.attempts[1]);
  assert.throws(() => replayNativeBarTransaction(f), /observation_conflict/);
});
test("absence after unlink_pending stays uncertain after reconciliation and cannot spend a marker", () => {
  const f = heldPurge(), p = f.events.at(-1).proof;
  const pending = event(f, "unlink_pending", later + 4, { proof: p, reference_hash: f.intent.baseline.reference_hash });
  assert.equal(replayNativeBarTransaction(f).status, "durability_unknown");
  resume(f, later + 6, [{ target_id: id(2), source: null, holding: null, quarantine: null }], ["reconcile_absence"]);
  event(f, "reconciled_absence", later + 7, { from_pending_event_hash: evidenceHash(pending) });
  f.completion = completion(f, "absent_unconfirmed", "resolved_with_uncertainty");
  const r = replayNativeBarTransaction(f);
  assert.equal(r.status, "resolved_with_uncertainty"); assert.deepEqual(r.spent_markers, []);
  f.completion.outcome = "complete";
  assert.throws(() => replayNativeBarTransaction(f), /completion_binding/);
});
function budget() {
  return { schema: "native-bar-transaction-capacity-v2",
    existing: { inventory_bytes: "1000", metadata_bytes: "200", entries: "10", available_bytes: "100000" },
    publications: [{ role: "event", bytes: "100", count: "2" }, { role: "publication_temporary", bytes: "100", count: "1" },
      { role: "directory", bytes: "0", count: "1" }],
    recovery_reserve: { bytes: "1000", entries: "10" }, reads: [{ bytes: "100", count: "2" }], response_bytes: "100",
    handles: { existing_roots: 1, additional_roots: 1, existing_descriptors: 5, additional_descriptors: 20, peak_targets_per_session: 2 } };
}
test("capacity includes transient publications, coordination and recovery without deletion credit or actual reservation", () => {
  const b = budget(), before = canonical(b), r = calculateNativeBarTransactionCapacity(b);
  assert.equal(r.fits, true); assert.deepEqual(r.reasons, []);
  assert.equal(r.peak_inventory_bytes, "2300"); assert.equal(r.peak_metadata_bytes, "1500");
  assert.equal(r.peak_entries, "24"); assert.equal(r.required_available_bytes, "1300"); assert.equal(r.read_bytes, "200");
  assert.equal(r.capacity_reservation, "not_reserved"); assert.equal(r.execution_available, false);
  assert.equal(canonical(b), before);
  b.existing.available_bytes = null;
  assert.ok(calculateNativeBarTransactionCapacity(b).reasons.includes("available_space_unverified"));
  b.deletion_credit = "1000000";
  assert.throws(() => calculateNativeBarTransactionCapacity(b));
});
test("a fresh attempt cannot convert an old pending unlink into historical acknowledged success", () => {
  const f = heldPurge(), p = f.events.at(-1).proof;
  event(f, "unlink_pending", later + 4, { proof: p, reference_hash: f.intent.baseline.reference_hash });
  resume(f, later + 6, [{ target_id: id(2), source: null, holding: null, quarantine: null }], ["unlink"]);
  event(f, "unlinked", later + 7, { proof: p, observed_absent: true, remaining_links: "0", synced: true });
  assert.throws(() => replayNativeBarTransaction(f), /pending_attempt/);
});
test("an unchanged surviving holding object can be reverified under a new approval before a new unlink", () => {
  const f = heldPurge(), p = f.events.at(-1).proof;
  const pending = event(f, "unlink_pending", later + 4, { proof: p, reference_hash: f.intent.baseline.reference_hash });
  resume(f, later + 6, [{ target_id: id(2), source: null, holding: p, quarantine: null }], ["verify", "unlink"]);
  event(f, "recovered_verified", later + 7, { location: "holding", proof: p, from_pending_event_hash: evidenceHash(pending) });
  assert.equal(replayNativeBarTransaction(f).targets[0].state, "holding");
  event(f, "unlink_pending", later + 8, { proof: p, reference_hash: f.intent.baseline.reference_hash });
  assert.equal(replayNativeBarTransaction(f).status, "durability_unknown");
});
function addTarget(f) {
  const t = structuredClone(f.manifests[0].targets[0]); t.target_id = id(5); t.proof.inode = "4";
  t.origin.recording_id = id(6); t.source_path = `captures/2026-10-23/${id(6)}.json`;
  f.manifests[0].targets.push(t); f.intent.target_count = 2;
  f.intent.manifests[0].hash = evidenceHash(f.manifests[0]); return t;
}
test("a conflict stops new data transitions for every target, not only the failed target", () => {
  const f = fixture(), second = addTarget(f), a = attempt(f); f.attempts.push(a);
  a.actions.push({ target_id: second.target_id, action: "stage" });
  a.observations.push({ target_id: second.target_id, source: second.proof, holding: null, quarantine: null });
  event(f, "failure", 2, { outcome: "conflict", reason: "namespace_changed" });
  event(f, "move_pending", 3, { target_id: second.target_id, proof: second.proof });
  assert.throws(() => replayNativeBarTransaction(f), /transaction_blocked/);
});
test("new attempts observe a verified quarantine using the quarantine location, not an invented fourth path", () => {
  const f = fixture(), p = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f));
  event(f, "move_pending", 2, { proof: p });
  const held = { ...p, ctime_ns: ns(time(3)) }; event(f, "held_verified", 3, { proof: held });
  event(f, "quarantine_move_pending", 4, { proof: held });
  const final = { ...p, ctime_ns: ns(time(5)) }; event(f, "quarantined_verified", 5, { proof: final });
  event(f, "failure", 6, { outcome: "durability_unknown", reason: "publication_failed" });
  resume(f, 8, [{ target_id: id(2), source: null, holding: null, quarantine: final }], ["verify"]);
  event(f, "recovered_verified", 9, { location: "quarantine", proof: final, from_pending_event_hash: null });
  assert.equal(replayNativeBarTransaction(f).status, "quarantine_incomplete");
});
function rebind(f) {
  for (const ref of f.intent.manifests) ref.hash = evidenceHash(f.manifests.find((m) => m.chunk_id === ref.chunk_id));
  for (const ref of f.intent.quarantine_refs) ref.hash = evidenceHash(f.quarantines.find((q) => q.quarantine_id === ref.quarantine_id));
  for (const a of f.attempts) { a.intent_hash = evidenceHash(f.intent); a.binding_hash = evidenceHash(f.intent.binding); }
  const seen = new Set(); let previous = null;
  for (const e of f.events) {
    const a = f.attempts.find((v) => v.attempt_id === e.attempt_id);
    if (!seen.has(a.attempt_id)) { a.resume_after_event_hash = previous; seen.add(a.attempt_id); }
    e.intent_hash = evidenceHash(f.intent); e.attempt_hash = evidenceHash(a); e.previous_event_hash = previous;
    previous = evidenceHash(e);
  }
}
for (const [label, mutate] of [
  ["unknown bundle field", (f) => { f.raw_ohlc = []; }],
  ["unknown intent field", (f) => { f.intent.account = "not allowed"; }],
  ["schema version confusion", (f) => { f.intent.schema = "native-bar-maintenance-intent-v1"; }],
  ["backend protocol confusion", (f) => { f.intent.binding.backend_protocol = 1; }],
  ["noncanonical size", (f) => { f.manifests[0].targets[0].proof.size = "08"; }],
  ["hard link", (f) => { f.manifests[0].targets[0].proof.nlink = "2"; }],
  ["public file mode", (f) => { f.manifests[0].targets[0].proof.mode = "33188"; }],
  ["write ACL on file", (f) => { f.manifests[0].targets[0].proof.acl = "allow_write"; }],
  ["write ACL on root", (f) => { f.intent.binding.root.acl = "allow_write"; }],
  ["write ACL on parent", (f) => { f.manifests[0].targets[0].parents[0].acl = "allow_write"; }],
  ["path traversal", (f) => { f.manifests[0].targets[0].source_path = "captures/../victim"; }],
  ["absolute path", (f) => { f.manifests[0].targets[0].source_path = "/victim"; }],
  ["false calendar date", (f) => { f.intent.created.utc_at = "2026-02-30T00:00:00.000Z"; }],
]) test(`strict transaction records reject ${label}`, () => {
  const f = fixture(); mutate(f); assert.throws(() => replayNativeBarTransaction(f));
});
for (const [label, mutate, error] of [
  ["wrong recording ID", (f) => { f.manifests[0].targets[0].origin.recording_id = id(99); }, /source_role/],
  ["live writer lock", (f) => { const t = f.manifests[0].targets[0]; t.origin = { kind: "coordination", owner_hash: evidenceHash("x") }; t.source_path = ".writer.lock"; t.parents = []; }, /source_role/],
  ["missing parent", (f) => { f.manifests[0].targets[0].parents.pop(); }, /target_binding/],
  ["wrong device", (f) => { f.manifests[0].targets[0].proof.device = "2"; }, /target_binding/],
  ["wrong owner", (f) => { f.manifests[0].targets[0].proof.uid = "502"; }, /target_binding/],
  ["future inode time", (f) => { f.manifests[0].targets[0].proof.ctime_ns = ns(time(1)); }, /proof_clock/],
  ["duplicate manifest", (f) => { f.manifests.push(structuredClone(f.manifests[0])); }, /manifest_binding/],
  ["partial target count", (f) => { f.intent.target_count = 2; }, /duplicate_or_missing/],
  ["aliased inode", (f) => { const t = addTarget(f); t.proof.inode = "3"; }, /duplicate_or_missing/],
  ["parent aliases target", (f) => { f.manifests[0].targets[0].parents[0].inode = "3"; }, /object_role/],
  ["changed shared parent", (f) => { const t = addTarget(f); t.parents[0].inode = "99"; }, /parent_binding/],
]) test(`semantic bindings reject ${label} even with recomputed hashes`, () => {
  const f = fixture(); mutate(f); rebind(f); assert.throws(() => replayNativeBarTransaction(f), error);
});
for (const [label, mutate, error] of [
  ["sequence gap", (f) => { f.events[0].sequence = 2; }, /event_binding/],
  ["wrong event prefix", (f) => { f.events[0].previous_event_hash = evidenceHash("x"); }, /event_binding/],
  ["wrong attempt hash", (f) => { f.events[0].attempt_hash = evidenceHash("x"); }, /event_binding/],
  ["wrong intent hash", (f) => { f.events[0].intent_hash = evidenceHash("x"); }, /event_binding/],
  ["wrong target", (f) => { f.events[0].target_id = id(99); }, /event_binding/],
  ["expired wall deadline", (f) => { f.events[0].clock = tick(601); }, /attempt_expired/],
  ["expired elapsed deadline", (f) => { f.events[0].clock.elapsed.reading_ns = tick(601).elapsed.reading_ns; }, /attempt_expired/],
  ["UTC rollback", (f) => { f.events[0].clock = tick(0); }, /clock_rollback/],
  ["elapsed rollback", (f) => { f.events[0].clock.elapsed.reading_ns = "0"; }, /elapsed_rollback/],
  ["boot changed mid-attempt", (f) => { f.events[0].clock.elapsed.boot_id = id(91); }, /clock_source_changed/],
  ["wrong reference snapshot", (f) => { f.attempts[0].reference_hash = evidenceHash("changed"); rebind(f); }, /attempt_binding/],
  ["extended approval", (f) => { f.attempts[0].expires_at = time(602); rebind(f); }, /attempt_binding/],
  ["unapproved action", (f) => { f.attempts[0].actions = [{ target_id: id(2), action: "verify" }]; rebind(f); }, /action_not_approved/],
]) test(`event validation refuses ${label}`, () => {
  const f = fixture(); f.attempts.push(attempt(f)); event(f, "move_pending", 2, { proof: f.manifests[0].targets[0].proof });
  mutate(f); assert.throws(() => replayNativeBarTransaction(f), error);
});
const ordinaryTypes = ["move_pending", "held_verified", "quarantine_move_pending", "quarantined_verified", "unlink_pending", "unlinked"];
for (const phase of ["source", "move_pending", "holding", "quarantine_move_pending", "quarantined"]) {
  for (const type of ordinaryTypes) test(`quarantine transition matrix: ${phase} -> ${type}`, () => {
    const f = fixture(), p = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f));
    const held = { ...p, ctime_ns: ns(time(3)) }, final = { ...p, ctime_ns: ns(time(5)) };
    if (phase !== "source") event(f, "move_pending", 2, { proof: p });
    if (["holding", "quarantine_move_pending", "quarantined"].includes(phase)) event(f, "held_verified", 3, { proof: held });
    if (["quarantine_move_pending", "quarantined"].includes(phase)) event(f, "quarantine_move_pending", 4, { proof: held });
    if (phase === "quarantined") event(f, "quarantined_verified", 5, { proof: final });
    const current = ["holding", "quarantine_move_pending"].includes(phase) ? held : phase === "quarantined" ? final : p;
    const fields = { proof: type.endsWith("verified") ? { ...current, ctime_ns: ns(time(10)) } : current };
    if (type === "unlink_pending") fields.reference_hash = f.intent.baseline.reference_hash;
    if (type === "unlinked") Object.assign(fields, { observed_absent: true, remaining_links: "0", synced: true });
    event(f, type, 10, fields);
    const legal = { source: "move_pending", move_pending: "held_verified", holding: "quarantine_move_pending", quarantine_move_pending: "quarantined_verified" }[phase] === type;
    if (legal) assert.doesNotThrow(() => replayNativeBarTransaction(f));
    else assert.throws(() => replayNativeBarTransaction(f));
  });
}
for (const [key, exact, over, expected] of [
  ["inventory", (b) => { b.existing.inventory_bytes = String(limits.inventory_bytes - 1300); }, (b) => { b.existing.inventory_bytes = String(limits.inventory_bytes - 1299); }, "inventory_limit"],
  ["metadata", (b) => { b.existing.inventory_bytes = b.existing.metadata_bytes = String(limits.metadata_bytes - 1300); }, (b) => { b.existing.inventory_bytes = b.existing.metadata_bytes = String(limits.metadata_bytes - 1299); }, "metadata_limit"],
  ["entries", (b) => { b.existing.entries = String(limits.entries - 14); }, (b) => { b.existing.entries = String(limits.entries - 13); }, "entry_limit"],
  ["read", (b) => { b.reads = [{ bytes: String(limits.read_bytes), count: "1" }]; }, (b) => { b.reads[0].bytes = String(limits.read_bytes + 1); }, "read_limit"],
  ["response", (b) => { b.response_bytes = String(limits.response_bytes); }, (b) => { b.response_bytes = String(limits.response_bytes + 1); }, "response_limit"],
  ["artifact", (b) => { b.publications = [{ role: "manifest", bytes: String(limits.artifact_bytes), count: "1" }]; b.existing.available_bytes = "2000000"; }, (b) => { b.publications[0].bytes = String(limits.artifact_bytes + 1); }, "artifact_limit"],
  ["roots", (b) => { b.handles.additional_roots = limits.root_sessions - 1; }, (b) => { b.handles.additional_roots++; }, "root_session_limit"],
  ["descriptors", (b) => { b.handles.additional_descriptors = limits.descriptors - 5; }, (b) => { b.handles.additional_descriptors++; }, "descriptor_limit"],
  ["live targets", (b) => { b.handles.peak_targets_per_session = limits.live_targets; }, (b) => { b.handles.peak_targets_per_session++; }, "live_target_limit"],
  ["physical estimate", (b) => { b.existing.available_bytes = "1300"; }, (b) => { b.existing.available_bytes = "1299"; }, "insufficient_available_space"],
]) test(`capacity accepts exact ${key} boundary and refuses one unit beyond without shrinking the batch`, () => {
  const b = budget(); exact(b); assert.equal(calculateNativeBarTransactionCapacity(b).fits, true);
  over(b); assert.ok(calculateNativeBarTransactionCapacity(b).reasons.includes(expected));
});
test("capacity uses exact integers above Number precision and refuses malformed or contradictory budgets", () => {
  const b = budget(); b.publications[0].count = "9007199254740993";
  const r = calculateNativeBarTransactionCapacity(b);
  assert.equal(r.required_available_bytes, "900719925474100400"); assert.equal(r.fits, false);
  for (const value of ["-1", "01", "1.1", "1e9", 100]) {
    const v = budget(); v.recovery_reserve.bytes = value; assert.throws(() => calculateNativeBarTransactionCapacity(v));
  }
  const v = budget(); v.recovery_reserve.entries = "0"; assert.throws(() => calculateNativeBarTransactionCapacity(v));
  v.recovery_reserve.entries = "1"; v.existing.metadata_bytes = "1001";
  assert.ok(calculateNativeBarTransactionCapacity(v).reasons.includes("inconsistent_existing_bytes"));
});
for (const [label, mutate] of [
  ["new marker before final quarantine", (q) => { q.marker_proof.birthtime_ns = ns(time(4)); }],
  ["target changes after marker creation", (q) => { q.targets[0].proof.ctime_ns = ns(time(7)); }],
  ["marker aliases target", (q) => { q.marker_proof.inode = q.targets[0].proof.inode; }],
  ["changed policy", (q) => { q.binding.policy_hash = evidenceHash("other policy"); }],
]) test(`purge certificates reject ${label}`, () => {
  const f = purgeFixture(); mutate(f.quarantines[0]); f.manifests[0].targets[0].proof = structuredClone(f.quarantines[0].targets[0].proof);
  rebind(f); assert.throws(() => replayNativeBarTransaction(f), /quarantine_set|object_role/);
});
for (const [label, mutate] of [
  ["reboot", (f) => { for (const c of [f.intent.created, f.attempts[0].issued, ...f.events.map((e) => e.clock)]) c.elapsed.boot_id = id(91); }],
  ["unqualified source", (f) => { for (const c of [f.intent.created, f.attempts[0].issued, ...f.events.map((e) => e.clock)]) c.elapsed.qualified = false; }],
  ["missing elapsed source", (f) => { for (const c of [f.intent.created, f.attempts[0].issued, ...f.events.map((e) => e.clock)]) c.elapsed = null; }],
]) test(`purge remains held when elapsed time is unproven: ${label}`, () => {
  const f = heldPurge(); event(f, "unlink_pending", later + 4, { proof: f.events.at(-1).proof, reference_hash: f.intent.baseline.reference_hash });
  mutate(f); rebind(f); assert.throws(() => replayNativeBarTransaction(f), /purge_age_unverified/);
});
test("native times can only delay eligibility, and negative or future clock evidence cannot force it", () => {
  const v = { quarantined_at: at, completed: clock(), observed: tick(later), native_times_ns: [ns(time(2 * 86400))] };
  assert.equal(assessNativeBarQuarantineAge(v).eligible, false);
  v.native_times_ns = [ns(at)]; v.observed = tick(-1); assert.equal(assessNativeBarQuarantineAge(v).eligible, false);
});
test("content, birthtime, mtime and inode cannot change during a move; ctime must stay within its bracket", () => {
  for (const [key, value] of [["sha256", evidenceHash("replacement")], ["birthtime_ns", "0"], ["mtime_ns", "0"], ["inode", "99"], ["ctime_ns", ns(time(1))], ["ctime_ns", ns(time(4))]]) {
    const f = fixture(), p = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f)); event(f, "move_pending", 2, { proof: p });
    event(f, "held_verified", 3, { proof: { ...p, ctime_ns: ns(time(3)), [key]: value } });
    assert.throws(() => replayNativeBarTransaction(f), /moved_proof/);
  }
});
test("recovery does not revive an old approval or accept a stale chain prefix", () => {
  const f = fixture(), p = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f, ["stage", "verify"])); const pending = event(f, "move_pending", 2, { proof: p });
  event(f, "recovered_verified", 3, { location: "source", proof: p, from_pending_event_hash: evidenceHash(pending) });
  assert.throws(() => replayNativeBarTransaction(f), /recovery_binding/);
  f.events.pop(); const a = resume(f, 5, [{ target_id: id(2), source: p, holding: null, quarantine: null }], ["verify"]);
  a.resume_after_event_hash = evidenceHash("stale"); event(f, "recovered_verified", 6, { location: "source", proof: p, from_pending_event_hash: evidenceHash(pending) });
  assert.throws(() => replayNativeBarTransaction(f), /attempt_prefix/);
});
test("a terminal quarantine lacking completion can be verified after restart without a fabricated failure", () => {
  const f = fixture(), p = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f));
  event(f, "move_pending", 2, { proof: p }); const held = { ...p, ctime_ns: ns(time(3)) };
  event(f, "held_verified", 3, { proof: held }); event(f, "quarantine_move_pending", 4, { proof: held });
  const final = { ...p, ctime_ns: ns(time(5)) }; event(f, "quarantined_verified", 5, { proof: final });
  resume(f, 8, [{ target_id: id(2), source: null, holding: null, quarantine: final }], ["verify"]);
  event(f, "recovered_verified", 9, { location: "quarantine", proof: final, from_pending_event_hash: null });
  assert.equal(replayNativeBarTransaction(f).status, "quarantine_incomplete");
});
test("failure severity cannot be downgraded without fresh recovery", () => {
  const f = fixture(); f.attempts.push(attempt(f)); event(f, "failure", 2, { outcome: "conflict", reason: "object_changed" });
  event(f, "failure", 3, { outcome: "durability_unknown", reason: "interrupted" });
  assert.equal(replayNativeBarTransaction(f).status, "conflict");
});
test("completion cannot claim a logical clock beyond its approval deadline", () => {
  const f = heldPurge(), p = f.events.at(-1).proof;
  event(f, "unlink_pending", later + 4, { proof: p, reference_hash: f.intent.baseline.reference_hash });
  event(f, "unlinked", later + 5, { proof: p, observed_absent: true, remaining_links: "0", synced: true });
  f.completion = completion(f); f.completion.clock = tick(later + 601);
  assert.throws(() => replayNativeBarTransaction(f), /attempt_expired/);
});
function twoPurgeTargets() {
  const f = purgeFixture(), t = structuredClone(f.manifests[0].targets[0]);
  t.target_id = id(5); t.proof.inode = "4"; t.origin.recording_id = id(6);
  t.source_path = `quarantine/abandoned/${id(50)}/${id(52)}`;
  f.manifests[0].targets.push(t); f.intent.target_count = 2;
  f.quarantines[0].targets.push({ quarantine_target_id: id(52), origin: t.origin, proof: t.proof });
  const a = f.attempts[0]; a.actions.push(...["stage", "unlink"].map((action) => ({ target_id: id(5), action })));
  a.observations.push({ target_id: id(5), source: t.proof, holding: null, quarantine: null }); rebind(f); return f;
}
test("a whole marker set must be held before its first unlink", () => {
  const f = twoPurgeTargets(), p = f.manifests[0].targets[0].proof;
  event(f, "move_pending", later + 2, { proof: p }); const held = { ...p, ctime_ns: ns(time(later + 3)) };
  event(f, "held_verified", later + 3, { proof: held });
  event(f, "unlink_pending", later + 4, { proof: held, reference_hash: f.intent.baseline.reference_hash });
  assert.throws(() => replayNativeBarTransaction(f), /illegal_unlink/);
});
test("remaining exact targets can finish after reconciliation, retaining uncertainty for the whole completion", () => {
  const f = twoPurgeTargets(), [p, p2] = f.manifests[0].targets.map((t) => t.proof);
  event(f, "move_pending", later + 2, { proof: p }); const held = { ...p, ctime_ns: ns(time(later + 3)) };
  event(f, "held_verified", later + 3, { proof: held });
  event(f, "move_pending", later + 4, { target_id: id(5), proof: p2 }); const held2 = { ...p2, ctime_ns: ns(time(later + 5)) };
  event(f, "held_verified", later + 5, { target_id: id(5), proof: held2 });
  const pending = event(f, "unlink_pending", later + 6, { proof: held, reference_hash: f.intent.baseline.reference_hash });
  const a = resume(f, later + 8, [{ target_id: id(2), source: null, holding: null, quarantine: null },
    { target_id: id(5), source: null, holding: held2, quarantine: null }], ["reconcile_absence"]);
  a.actions.push({ target_id: id(5), action: "unlink" });
  event(f, "reconciled_absence", later + 9, { from_pending_event_hash: evidenceHash(pending) });
  event(f, "unlink_pending", later + 10, { target_id: id(5), proof: held2, reference_hash: f.intent.baseline.reference_hash });
  event(f, "unlinked", later + 11, { target_id: id(5), proof: held2, observed_absent: true, remaining_links: "0", synced: true });
  f.completion = completion(f, "absent_unconfirmed", "resolved_with_uncertainty"); f.completion.clock = tick(later + 12);
  f.completion.targets.push({ target_id: id(5), state: "purged", proof: null });
  const r = replayNativeBarTransaction(f); assert.equal(r.status, "resolved_with_uncertainty"); assert.deepEqual(r.spent_markers, []);
});
test("only the pure transaction module and pure evidence helper are imported, with no runtime integration", () => {
  const source = readFileSync(new URL("../../src/nativeBarTransactions.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["zod", "./nativeBarEvidence.js"]);
  assert.doesNotMatch(source, /\b(?:process|fetch|setTimeout|Date\.now|performance\.now|require|writeFile|unlink|rename|spawn)\s*[.(]/);
  for (const file of ["server.ts", "index.ts", "nativeBarHistory.ts", "nativeBarMaintenance.ts", "nativeBarFs.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8"), /nativeBarTransactions/);
  }
});
test("record replay enforces the artifact, metadata and entry ceilings before trusting event contents", () => {
  const oversized = fixture(), t = oversized.manifests[0].targets[0];
  t.parents = Array.from({ length: 16 }, (_, i) => ({ ...t.parents[0], path: `${i}/${"p".repeat(450)}` }));
  oversized.manifests[0].targets = Array.from({ length: limits.targets }, () => structuredClone(t));
  assert.ok(Buffer.byteLength(canonical(oversized.manifests[0])) > limits.artifact_bytes);
  assert.throws(() => replayNativeBarTransaction(oversized), /artifact_limit/);
  const f = fixture(); f.attempts.push(attempt(f)); const e = event(f, "failure", 2, { outcome: "durability_unknown", reason: "interrupted" });
  const bytes = Buffer.byteLength(canonical(e));
  f.events = Array.from({ length: Math.floor(limits.metadata_bytes / bytes) + 1 }, () => e);
  assert.ok(f.events.length + 3 <= limits.entries);
  assert.throws(() => replayNativeBarTransaction(f), /metadata_limit/);
  f.events = Array.from({ length: limits.entries - 2 }, () => e);
  assert.throws(() => replayNativeBarTransaction(f), /entry_limit/);
});
test("duplicate events, attempts, altered marker sets and incomplete completions cannot project spent markers", () => {
  const f = heldPurge(), p = f.events.at(-1).proof;
  event(f, "unlink_pending", later + 4, { proof: p, reference_hash: f.intent.baseline.reference_hash });
  event(f, "unlinked", later + 5, { proof: p, observed_absent: true, remaining_links: "0", synced: true });
  f.completion = completion(f);
  for (const mutate of [
    (v) => { v.events.push(structuredClone(v.events.at(-1))); },
    (v) => { v.attempts.push(structuredClone(v.attempts[0])); },
    (v) => { v.completion.targets = []; },
    (v) => { v.completion.targets[0].state = "quarantined"; },
    (v) => { v.completion.last_event_hash = evidenceHash("different prefix"); },
    (v) => { v.completion.attempt_hashes = [evidenceHash("different attempt")]; },
    (v) => { v.completion.marker = { path: "unapproved-extra-action", proof: proof("99") }; },
    (v) => { v.quarantines[0].marker_proof.sha256 = evidenceHash("replacement"); },
    (v) => { v.events.pop(); v.completion.last_event_hash = evidenceHash(v.events.at(-1)); },
  ]) { const v = structuredClone(f); mutate(v); assert.throws(() => replayNativeBarTransaction(v)); }
});
test("fresh recovery observations may change boot source, but cannot make the old operation acknowledged", () => {
  const f = fixture(), p = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f));
  const pending = event(f, "move_pending", 2, { proof: p }); const held = { ...p, ctime_ns: ns(time(3)) };
  const a = resume(f, 5, [{ target_id: id(2), source: null, holding: held, quarantine: null }], ["verify"]);
  a.issued.elapsed.boot_id = id(91); a.issued.elapsed.reading_ns = "1000000000";
  const e = event(f, "recovered_verified", 6, { location: "holding", proof: held, from_pending_event_hash: evidenceHash(pending) });
  e.clock.elapsed.boot_id = id(91); e.clock.elapsed.reading_ns = "2000000000";
  const r = replayNativeBarTransaction(f); assert.equal(r.targets[0].state, "holding"); assert.equal(r.original_acknowledgement, "not_proven");
});
function terminalPurge(uncertain = false) {
  const f = heldPurge(), p = f.events.at(-1).proof;
  const pending = event(f, "unlink_pending", later + 4, { proof: p, reference_hash: f.intent.baseline.reference_hash });
  if (uncertain) {
    resume(f, later + 6, [{ target_id: id(2), source: null, holding: null, quarantine: null }], ["reconcile_absence"]);
    event(f, "reconciled_absence", later + 7, { from_pending_event_hash: evidenceHash(pending) });
  } else event(f, "unlinked", later + 5, { proof: p, observed_absent: true, remaining_links: "0", synced: true });
  return f;
}
for (const uncertain of [false, true]) test(`fresh terminal absence verification permits completion without promoting uncertainty: ${uncertain}`, () => {
  const f = terminalPurge(uncertain), terminal = evidenceHash(f.events.at(-1)), before = structuredClone(f.events);
  const a = resume(f, later + 700, [{ target_id: id(2), source: null, holding: null, quarantine: null }], ["verify"]);
  a.attempt_id = id(22);
  event(f, "terminal_absence_verified", later + 701, { from_terminal_event_hash: terminal });
  f.completion = completion(f, uncertain ? "absent_unconfirmed" : "purged", uncertain ? "resolved_with_uncertainty" : "complete");
  f.completion.clock = tick(later + 702);
  const r = replayNativeBarTransaction(f);
  assert.equal(r.status, uncertain ? "resolved_with_uncertainty" : "complete");
  assert.deepEqual(r.spent_markers, uncertain ? [] : [id(50)]);
  assert.equal(r.original_acknowledgement, "not_proven"); assert.equal(r.execution_available, false);
  assert.deepEqual(f.events.slice(0, before.length), before);
});
for (const [label, mutate] of [
  ["pending unlink without terminal evidence", (f) => { f.events.pop(); }],
  ["wrong terminal event hash", (_f, e) => { e.from_terminal_event_hash = evidenceHash("different terminal"); }],
  ["same old attempt", (f, e) => { const a = f.attempts[0]; a.actions.push({ target_id: id(2), action: "verify" });
    f.attempts.pop(); e.attempt_id = a.attempt_id; rebind(f); }],
  ["an object still present", (f) => { f.attempts.at(-1).observations[0].holding = f.manifests[0].targets[0].proof; rebind(f); }],
  ["missing verification approval", (f) => { f.attempts.at(-1).actions = [{ target_id: id(2), action: "unlink" }]; rebind(f); }],
]) test(`terminal absence verification rejects ${label}`, () => {
  const f = terminalPurge(), terminal = evidenceHash(f.events.at(-1));
  if (label.startsWith("pending")) mutate(f);
  resume(f, later + 8, [{ target_id: id(2), source: null, holding: null, quarantine: null }], ["verify"]);
  const e = event(f, "terminal_absence_verified", later + 9, { from_terminal_event_hash: terminal });
  if (!label.startsWith("pending")) mutate(f, e);
  assert.throws(() => replayNativeBarTransaction(f));
});
test("native signed counters reject noncanonical negative zero", () => {
  const f = fixture(); f.manifests[0].targets[0].proof.mtime_ns = "-0"; rebind(f);
  assert.throws(() => replayNativeBarTransaction(f));
  f.manifests[0].targets[0].proof.mtime_ns = "-1"; rebind(f);
  assert.doesNotThrow(() => replayNativeBarTransaction(f));
});
test("capacity rejects nonempty logical inventory with zero counted entries", () => {
  const b = budget(); b.existing.entries = "0";
  assert.equal(calculateNativeBarTransactionCapacity(b).fits, false);
  b.existing.inventory_bytes = b.existing.metadata_bytes = "0";
  assert.equal(calculateNativeBarTransactionCapacity(b).fits, true);
});

test("purge staging is age-gated like unlink, so a young set is never moved into holding", () => {
  const f = purgeFixture(); f.intent.created = tick(86400);
  Object.assign(f.attempts[0], { issued: tick(86400 + 1), expires_at: time(86400 + 601) }); rebind(f);
  assert.throws(() => replayNativeBarTransaction(f), /purge_age_unverified/);
});
test("after a reboot a staged purge set can be re-verified in holding, but unlink stays refused", () => {
  const f = heldPurge(), held = f.events.at(-1).proof, after = later + 100;
  const verify = resume(f, after, [{ target_id: id(2), source: null, holding: held, quarantine: null }], ["verify"]);
  Object.assign(verify.issued.elapsed, { boot_id: id(91), reading_ns: "1000000000" });
  const e = event(f, "recovered_verified", after + 1, { location: "holding", proof: held, from_pending_event_hash: null });
  Object.assign(e.clock.elapsed, { boot_id: id(91), reading_ns: "2000000000" });
  assert.equal(replayNativeBarTransaction(f).targets[0].state, "holding");
  const unlink = structuredClone(f); unlink.attempts.at(-1).actions = [{ target_id: id(2), action: "unlink" }]; rebind(unlink);
  assert.throws(() => replayNativeBarTransaction(unlink), /purge_age_unverified/);
});
test("a recorded conflict is never cleared by ordinary recovery and never spends a marker", () => {
  const f = fixture(), p = f.manifests[0].targets[0].proof; f.attempts.push(attempt(f));
  event(f, "move_pending", 2, { proof: p });
  event(f, "failure", 3, { outcome: "conflict", reason: "namespace_changed" });
  const held = { ...p, ctime_ns: ns(time(3)) };
  resume(f, 5, [{ target_id: id(2), source: null, holding: held, quarantine: null }], ["verify"]);
  event(f, "recovered_verified", 6, { location: "holding", proof: held, from_pending_event_hash: evidenceHash(f.events[0]) });
  assert.throws(() => replayNativeBarTransaction(f), /conflict_requires_resolution/);
  const g = terminalPurge(), unlinked = g.events.at(-1);
  event(g, "failure", later + 6, { outcome: "conflict", reason: "object_changed" });
  resume(g, later + 8, [{ target_id: id(2), source: null, holding: null, quarantine: null }], ["verify"]);
  event(g, "terminal_absence_verified", later + 9, { from_terminal_event_hash: evidenceHash(unlinked) });
  assert.throws(() => replayNativeBarTransaction(g), /conflict_requires_resolution/);
  g.events.pop(); g.attempts.pop();
  const r = replayNativeBarTransaction(g); assert.equal(r.status, "conflict"); assert.deepEqual(r.spent_markers, []);
});
test("non-numeric strings in refined numeric fields refuse as validation errors, not runtime exceptions", () => {
  for (const value of ["abc", "1.5", "1n"]) {
    const f = fixture(); f.manifests[0].targets[0].proof.size = value;
    assert.throws(() => replayNativeBarTransaction(f), (e) => !(e instanceof SyntaxError));
    const b = budget(); b.recovery_reserve.bytes = value;
    assert.throws(() => calculateNativeBarTransactionCapacity(b), (e) => !(e instanceof SyntaxError));
  }
});
