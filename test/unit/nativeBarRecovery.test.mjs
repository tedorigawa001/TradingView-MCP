import test from "node:test";
import assert from "node:assert/strict";
import { calculateNativeBarRecoveryCapacity, createNativeBarRecoveryLayout, validateNativeBarRecoveryBundle, planNativeBarRecovery,
  decodeNativeBarRecoveryBundle } from "../../build/nativeBarRecovery.js";
import { canonical, evidenceHash } from "../../build/nativeBarEvidence.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function layoutInput(target_count = 2) { return { maintenance_id: id(1), chunk_id: id(2), reserve_id: id(3),
  attempt_ids: [id(10), id(11), id(12)], target_count,
  temporary_ids: Array.from({ length: 3 * (9 + 14 * target_count) }, (_, i) => id(1000 + i)) }; }
const at = "2026-10-24T00:00:00.000Z";
const time = (seconds) => new Date(Date.parse(at) + seconds * 1000).toISOString();
const clock = (seconds) => ({ utc_at: time(seconds), elapsed: null });
const ns = (seconds) => String(BigInt(Date.parse(time(seconds))) * 1000000n);
const hash = (value) => evidenceHash(value);
const rehash = (object, field = "plan_hash") => { const copy = { ...object }; delete copy[field]; object[field] = hash(copy); return object; };
function proof(inode = "100", seconds = 0) { return { device: "1", inode, uid: "501", gid: "20", mode: "33152", nlink: "1", acl: "none",
  size: "8", sha256: hash("invented bytes"), birthtime_ns: ns(0), mtime_ns: ns(0), ctime_ns: ns(seconds) }; }
function directory(inode) { return { device: "1", inode, uid: "501", gid: "20", mode: "16832", birthtime_ns: ns(0), flags: "0", acl: "none", acl_hash: hash("no ACL") }; }
function fixture(n = 1) {
  const layout = createNativeBarRecoveryLayout(layoutInput(n));
  const targets = Array.from({ length: n }, (_, i) => ({ target_id: id(100 + i), origin: { kind: "capture", recording_id: id(200 + i) },
    source_path: `captures/2026-10-24/${id(200 + i)}.json`, proof: proof(String(100 + i)),
    parents: ["captures", "captures/2026-10-24"].map((path, j) => ({ path, device: "1", inode: String(20 + j), uid: "501", mode: "16832", acl: "none" })) }));
  const native_binding = { root: directory("2"), ancestor_digest: hash("invented ancestors"),
    targets: targets.map((t) => ({ target_id: t.target_id, flags: "0", acl_hash: hash("no ACL"),
      parents: t.parents.map((p) => ({ path: p.path, proof: directory(p.inode) })) })) };
  const binding = { profile: "native-bar-transaction-profile-v2", policy_hash: hash({ schema: "native-bar-synthetic-quarantine-recovery-profile-v5" }),
    root: { device: "1", inode: "2", uid: "501", mode: "16832", acl: "none" }, backend_protocol: 2, capabilities_hash: hash("fixture read2 recovery5") };
  const baseline = { inventory_hash: hash("initial inventory"), reference_hash: hash("fixed references") };
  const plan = rehash({ schema: "native-bar-quarantine-plan-v5", plan_id: id(4), opened_at: time(1), expires_at: time(601),
    binding, baseline, native_binding, targets, layout, plan_hash: "" });
  const manifest = { schema: "native-bar-maintenance-manifest-v2", maintenance_id: id(1), chunk_id: id(2), targets };
  const scope = { schema: "native-bar-recovery-scope-v5", fixture_id: id(5), initial_plan_hash: plan.plan_hash,
    native_binding_hash: hash(native_binding), manifest_hash: hash(manifest), inputs_digest: hash("independently invented fixture"),
    layout_directories: layout.directories.map((path, i) => ({ path, proof: directory(String(30 + i)) })),
    allocation: { path: layout.reserve_path, proof: { ...proof("999", 2), birthtime_ns: ns(2), mtime_ns: ns(2), size: "0", flags: "0", acl_hash: hash("no ACL") },
      allocated_bytes: n === 1 ? "9175040" : "12845056", acknowledged: clock(2) } };
  const intent = { schema: "native-bar-maintenance-intent-v2", maintenance_id: id(1), kind: "quarantine_abandoned", binding,
    created: clock(1), approval_plan_hash: plan.plan_hash, baseline, manifests: [{ chunk_id: id(2), hash: hash(manifest) }], target_count: n, quarantine_refs: [] };
  return { schema: "native-bar-recovery-bundle-v5", original: { schema: "native-bar-quarantine-intent-v5", plan, scope, scope_digest: hash(scope), intent, manifest },
    attempts: [], events: [], markers: [], completion: null };
}
function addAttempt(b, ord = 1, opened = 1, observations, actions) {
  const o = b.original, targets = o.manifest.targets;
  observations ??= targets.map((t) => ({ target_id: t.target_id, source: t.proof, holding: null, quarantine: null }));
  actions ??= targets.flatMap((t) => ["stage", "quarantine"].map((action) => ({ target_id: t.target_id, action })));
  const prefix = b.events.length ? hash(b.events.at(-1)) : null;
  const plan = rehash({ schema: "native-bar-recovery-attempt-plan-v5", plan_id: id(400 + ord), maintenance_id: id(1), ordinal: ord,
    scope_digest: o.scope_digest, original_envelope_hash: hash(o), intent_hash: hash(o.intent), prefix_hash: prefix, prefix_count: b.events.length,
    opened_at: time(opened), issued_at: time(opened + 1), observed_at: time(opened + 2), expires_at: time(opened + 600),
    inventory_hash: hash(`inventory at ${opened}`), reference_hash: o.intent.baseline.reference_hash, native_binding_hash: hash(o.plan.native_binding),
    current_reference_hash: hash({ inventory_hash: hash(`inventory at ${opened}`), original_reference_hash: o.intent.baseline.reference_hash,
      native_binding_hash: hash(o.plan.native_binding) }),
    observations, actions, plan_hash: "" });
  const attempt = { schema: "native-bar-maintenance-attempt-v2", attempt_id: o.plan.layout.attempt_ids[ord - 1], maintenance_id: id(1),
    intent_hash: hash(o.intent), binding_hash: hash(o.intent.binding), approval_plan_hash: ord === 1 ? o.plan.plan_hash : plan.plan_hash,
    issued: clock(opened), expires_at: plan.expires_at, resume_after_event_hash: prefix, reference_hash: o.intent.baseline.reference_hash, actions, observations };
  const e = { schema: "native-bar-recovery-attempt-v5", ordinal: ord, previous_envelope_hash: b.attempts.length ? hash(b.attempts.at(-1)) : null, attempt, plan };
  b.attempts.push(e); return e;
}
function event(b, type, seconds, fields = {}, target = 0) {
  const a = b.attempts.at(-1).attempt;
  const e = { schema: "native-bar-maintenance-event-v2", maintenance_id: id(1), intent_hash: hash(b.original.intent), attempt_id: a.attempt_id,
    attempt_hash: hash(a), sequence: b.events.length + 1, previous_event_hash: b.events.length ? hash(b.events.at(-1)) : null,
    target_id: b.original.manifest.targets[target].target_id, clock: clock(seconds), type, ...fields };
  b.events.push(e); return e;
}
function heldPending() { const b = fixture(); addAttempt(b); const original = b.original.manifest.targets[0].proof;
  const pending = event(b, "move_pending", 4, { proof: original }); return { b, pending, held: { ...original, ctime_ns: ns(5) } }; }
function finishInitial(b = fixture()) {
  addAttempt(b);
  for (const [i, t] of b.original.manifest.targets.entries()) {
    const start = 4 + i * 4, held = { ...t.proof, ctime_ns: ns(start + 1) }, q = { ...t.proof, ctime_ns: ns(start + 3) };
    event(b, "move_pending", start, { proof: t.proof }, i); event(b, "held_verified", start + 1, { proof: held }, i);
    event(b, "quarantine_move_pending", start + 2, { proof: held }, i); event(b, "quarantined_verified", start + 3, { proof: q }, i);
  } return b;
}
function mark(b, seconds) {
  const a = b.attempts.at(-1).attempt;
  const targets = b.original.manifest.targets.map((t) => ({ target_id: t.target_id, proof: [...b.events].reverse().find((e) => e.target_id === t.target_id).proof }));
  const record = { schema: "native-bar-recovery-timestamp-v5", maintenance_id: id(1), attempt_id: a.attempt_id,
    intent_hash: hash(b.original.intent), last_event_hash: hash(b.events.at(-1)), targets, publication: { before: clock(seconds), after: clock(seconds + 1) } };
  const p = { ...proof(String(2000 + b.attempts.at(-1).ordinal), seconds), birthtime_ns: ns(seconds), mtime_ns: ns(seconds),
    size: String(Buffer.byteLength(canonical(record))), sha256: hash(record), flags: "0", acl_hash: hash("no ACL") };
  const evidence = { record, proof: p }; b.markers.push(evidence); return evidence;
}
function complete(b, seconds) {
  const m = b.markers.at(-1), used = [...new Set(b.events.map((e) => e.attempt_id))];
  b.completion = { schema: "native-bar-recovery-completion-v5", maintenance_id: id(1), intent_hash: hash(b.original.intent),
    last_event_hash: hash(b.events.at(-1)), published_attempt_hashes: b.attempts.map(hash),
    used_attempt_hashes: used.map((id) => hash(b.attempts.find((a) => a.attempt.attempt_id === id).attempt)),
    final_attempt_id: m.record.attempt_id, clock: clock(seconds), marker: { path: `quarantine/abandoned/${id(1)}/${m.record.attempt_id}.timestamp.json`,
      hash: hash(m.record), proof: m.proof }, targets: m.record.targets }; return b;
}
function inputFor(b, overrides) {
  const o = b.original, layout = o.plan.layout, replay = validateNativeBarRecoveryBundle(b);
  const locations = overrides ?? replay.targets.map((s) => ({ target_id: s.target_id,
    source: ["source", "move_pending"].includes(s.state) ? s.proof : null,
    holding: ["holding", "quarantine_move_pending"].includes(s.state) ? s.proof : null,
    quarantine: s.state === "quarantined" ? s.proof : null }));
  const full = locations.map((t) => ({ ...t, ...Object.fromEntries(["source", "holding", "quarantine"].map((p) => [p,
    t[p] ? { ...t[p], flags: "0", acl_hash: hash("no ACL") } : null])) }));
  const entries = new Map();
  let inode = 5000;
  const add = (path, kind, size = "0", sha256 = null, allocated_bytes = "0", native = null) => entries.set(path, { path, kind, size, sha256, allocated_bytes,
    proof: native ?? (kind === "file" ? { ...proof(String(inode++)), size, sha256, flags: "0", acl_hash: hash("no ACL") } : null),
    directory_proof: kind === "directory" ? structuredClone([...o.scope.layout_directories, ...o.plan.native_binding.targets.flatMap((t) => t.parents)].find((d) => d.path === path).proof) : null });
  for (const path of [...layout.directories, ...o.manifest.targets.flatMap((t) => t.parents.map((p) => p.path))]) add(path, "directory");
  const records = [["policy.json", { schema: "native-bar-synthetic-quarantine-recovery-profile-v5" }],
    [`maintenance/${id(1)}.manifest/${id(2)}.json`, o.manifest], [`maintenance/${id(1)}.json`, o],
    ...b.attempts.map((a) => [`maintenance/${id(1)}.attempts/${a.attempt.attempt_id}.json`, a]),
    ...b.events.map((e) => [`maintenance/${id(1)}.events/${e.sequence}.json`, e]),
    ...b.markers.map((m) => [`quarantine/abandoned/${id(1)}/${m.record.attempt_id}.timestamp.json`, m.record]),
    ...(b.completion ? [[`maintenance/${id(1)}.done.json`, b.completion]] : [])];
  for (const [path, record] of records) add(path, "file", String(Buffer.byteLength(canonical(record))), hash(record), "4096");
  for (const m of b.markers) entries.get(`quarantine/abandoned/${id(1)}/${m.record.attempt_id}.timestamp.json`).proof = m.proof;
  for (const loc of full) for (const place of ["source", "holding", "quarantine"]) if (loc[place]) {
    const t = o.manifest.targets.find((t) => t.target_id === loc.target_id), path = place === "source" ? t.source_path
      : place === "holding" ? `maintenance-hold/${id(1)}/${t.target_id}` : `quarantine/abandoned/${id(1)}/${t.target_id}`;
    add(path, "file", loc[place].size, loc[place].sha256, "4096", loc[place]);
  }
  add(layout.reserve_path, "file", "0", o.scope.allocation.proof.sha256, o.scope.allocation.allocated_bytes, o.scope.allocation.proof);
  const list = [...entries.values()];
  return { schema: "native-bar-recovery-query-v5", bundle: b,
    view: { schema: "native-bar-recovery-view-v5", observed_at: time(703), inventory_complete: true, references_complete: true, allocation_complete: true,
      inventory_hash: hash(list), reference_hash: o.intent.baseline.reference_hash, native_binding: structuredClone(o.plan.native_binding), entries: list, locations: full,
      current_reference_hash: hash({ inventory_hash: hash(list), original_reference_hash: o.intent.baseline.reference_hash, native_binding_hash: hash(o.plan.native_binding) }),
      reserve: { proof: structuredClone(o.scope.allocation.proof), allocated_bytes: o.scope.allocation.allocated_bytes },
      accounting: { occupied_inventory_bytes: String(list.reduce((n, e) => n + BigInt(e.size), 0n)),
        occupied_metadata_bytes: String(records.reduce((n, [, r]) => n + Buffer.byteLength(canonical(r)), 0)),
        occupied_allocated_bytes: String(list.reduce((n, e) => n + BigInt(e.allocated_bytes), 0n)),
        available_bytes: "100000000", read_bytes: "100000", response_bytes: "100000", roots: 1, descriptors: 8, additional_descriptors: 48 } },
    controller: { original_envelope_hash: hash(o), scope_digest: o.scope_digest,
      consumed_ordinals: Array.from({ length: Math.max(1, ...b.attempts.map((a) => a.ordinal)) }, (_, i) => i + 1), known_publications: [] },
    request: { plan_id: id(500), ordinal: 2, opened_at: time(700), issued_at: time(701), expires_at: time(1300),
      checked_at: time(704), checked_elapsed_ns: "4000000000" } };
}

function capacity(target_count = 2) {
  return { schema: "native-bar-recovery-capacity-v5", target_count, phase: "initial",
    occupied_inventory_bytes: "0", occupied_metadata_bytes: "0", occupied_allocated_bytes: "0", occupied_entries: "0",
    remaining_publications: 37, remaining_temporaries: 111, available_bytes: "38535168", reserve_allocated_bytes: null,
    read_bytes: "0", response_bytes: "0", roots: 1, descriptors: 1, additional_descriptors: 48 };
}
test("v5 capacity reserves finite attempts and temporaries without granting execution", () => {
  const input = capacity(), before = structuredClone(input), result = calculateNativeBarRecoveryCapacity(input);
  assert.equal(result.publications, 37); assert.equal(result.temporaries, 111);
  assert.equal(result.peak_bytes, "12845056"); assert.equal(result.required_available_bytes, "38535168");
  assert.equal(result.fits, true); assert.equal(result.execution_available, false);
  assert.equal(result.capacity_reservation, "not_reserved"); assert.deepEqual(input, before);
});
test("the v5 layout predeclares every final and ordinal-specific temporary without creating files", () => {
  const layout = createNativeBarRecoveryLayout(layoutInput());
  assert.equal(layout.publications.length, 37);
  assert.equal(new Set(layout.publications.flatMap((p) => p.temporaries.map((t) => t.path))).size, 111);
  assert.equal(layout.publications.filter((p) => p.role === "event").length, 28);
  assert.equal(layout.publications.filter((p) => p.role === "marker")[1].path, `quarantine/abandoned/${id(1)}/${id(11)}.timestamp.json`);
  assert.equal(layout.execution_available, false);
  assert.throws(() => createNativeBarRecoveryLayout(layoutInput(3)));
  const bad = layoutInput(); bad.temporary_ids[1] = bad.temporary_ids[0];
  assert.throws(() => createNativeBarRecoveryLayout(bad), /identifier/);
});
test("a sealed-shape v5 original validates supplied records only and keeps its acyclic scope binding", () => {
  const bundle = fixture(2), before = canonical(bundle), result = validateNativeBarRecoveryBundle(bundle);
  assert.equal(result.status, "not_started_or_unconfirmed"); assert.equal(result.execution_available, false);
  assert.equal(result.verification_scope, "supplied_records_only"); assert.equal(canonical(bundle), before);
  bundle.original.scope.manifest_hash = hash("forged manifest");
  assert.throws(() => validateNativeBarRecoveryBundle(bundle), /scope_binding/);
});
test("v5 replay results never label their versioned completion as an old v2 replay", () => {
  const b = finishInitial(); mark(b, 8); complete(b, 10);
  assert.equal(validateNativeBarRecoveryBundle(b).schema, "native-bar-recovery-replay-v5");
  b.original = null;
  assert.equal(validateNativeBarRecoveryBundle(b).schema, "native-bar-recovery-replay-v5");
});
for (const acknowledged of [6, 500]) test(`data events cannot precede the original allocation acknowledgement at ${acknowledged}`, () => {
  const b = fixture(); b.original.scope.allocation.acknowledged = clock(acknowledged); resealOriginal(b);
  finishInitial(b); mark(b, 8); complete(b, 10);
  assert.throws(() => validateNativeBarRecoveryBundle(b), /recovery_event_scope/);
});
test("late original allocation without any data event remains a recoverable supplied prefix", () => {
  const b = fixture(); b.original.scope.allocation.acknowledged = clock(500); resealOriginal(b);
  assert.equal(planNativeBarRecovery(inputFor(b)).status, "planned_only");
});
test("recovery keeps the v2 nanosecond precision boundary at lease opening", () => {
  for (const delta of [999999n, 1000000n]) {
    const { b, held } = heldPending(); held.ctime_ns = String(BigInt(ns(700)) + delta);
    const q = inputFor(b, [{ target_id: id(100), source: null, holding: held, quarantine: null }]);
    assert.equal(planNativeBarRecovery(q).status, delta === 999999n ? "planned_only" : "blocked");
  }
});
test("controller acknowledgements bind current object identity as well as canonical bytes", () => {
  const q = inputFor(fixture()), path = `maintenance/${id(1)}.json`, entry = q.view.entries.find((e) => e.path === path);
  q.controller.known_publications = [{ path, hash: entry.sha256, proof: structuredClone(entry.proof) }];
  assert.equal(planNativeBarRecovery(q).status, "planned_only");
  entry.proof.inode = "8900"; refreshInventory(q);
  const r = planNativeBarRecovery(q);
  assert.equal(r.status, "blocked"); assert.ok(r.blocking_reasons.includes("acknowledged_record_missing_or_changed"));
  assert.deepEqual(r.remaining, []);
});
test("an unpublished consumed ordinal is not fabricated in the published envelope chain", () => {
  const b = finishInitial(); mark(b, 8); const q = b.events.at(-1).proof;
  addAttempt(b, 3, 1400, [{ target_id: id(100), source: null, holding: null, quarantine: q }], [{ target_id: id(100), action: "verify" }]);
  event(b, "recovered_verified", 1403, { location: "quarantine", proof: q, from_pending_event_hash: null }); mark(b, 1404); complete(b, 1406);
  assert.equal(validateNativeBarRecoveryBundle(b).status, "complete");
  assert.deepEqual(b.attempts.map((e) => e.ordinal), [1, 3]);
  assert.equal(b.completion.published_attempt_hashes.length, 2);
});
test("a new attempt reconciles a surviving held object without completing the old pending grant", () => {
  const { b, pending, held } = heldPending();
  addAttempt(b, 2, 700, [{ target_id: id(100), source: null, holding: held, quarantine: null }],
    [{ target_id: id(100), action: "verify" }, { target_id: id(100), action: "quarantine" }]);
  event(b, "recovered_verified", 703, { location: "holding", proof: held, from_pending_event_hash: hash(pending) });
  const result = validateNativeBarRecoveryBundle(b);
  assert.equal(result.targets[0].state, "holding"); assert.equal(result.recovery_execution_available, false);
  b.events.at(-1).type = "held_verified"; delete b.events.at(-1).location; delete b.events.at(-1).from_pending_event_hash;
  assert.throws(() => validateNativeBarRecoveryBundle(b), /pending_attempt|action_not_approved|verification_required/);
});
test("completion after metadata-only recovery binds a new marker and preserves the older prefix marker", () => {
  const b = finishInitial(); mark(b, 8); const old = canonical(b.markers[0]);
  const q = b.events.at(-1).proof;
  addAttempt(b, 2, 700, [{ target_id: id(100), source: null, holding: null, quarantine: q }], [{ target_id: id(100), action: "verify" }]);
  event(b, "recovered_verified", 703, { location: "quarantine", proof: q, from_pending_event_hash: null });
  mark(b, 704); complete(b, 706);
  assert.equal(validateNativeBarRecoveryBundle(b).status, "complete"); assert.equal(canonical(b.markers[0]), old);
  b.completion.marker = { path: `quarantine/abandoned/${id(1)}/${id(10)}.timestamp.json`, hash: hash(b.markers[0].record), proof: b.markers[0].proof };
  assert.throws(() => validateNativeBarRecoveryBundle(b), /completion_binding/);
});
test("remaining work for a pending held object is validation-only and controller loss blocks the whole plan", () => {
  const { b, held } = heldPending(), input = inputFor(b, [{ target_id: id(100), source: null, holding: held, quarantine: null }]);
  const before = canonical(input), r = planNativeBarRecovery(input);
  assert.equal(r.status, "planned_only"); assert.deepEqual(r.remaining[0].operations,
    ["recovered_holding", "quarantine_move_pending", "quarantine", "quarantined_verified"]);
  assert.equal(r.execution_available, false); assert.equal(r.approval_authenticated, false); assert.equal(canonical(input), before);
  input.controller = null; const blocked = planNativeBarRecovery(input);
  assert.equal(blocked.status, "blocked"); assert.deepEqual(blocked.remaining, []); assert.ok(blocked.blocking_reasons.includes("controller_unavailable"));
});
test("a pending object's native time after lease opening cannot produce an unreplayable attempt plan", () => {
  const { b, held } = heldPending(); held.ctime_ns = ns(702);
  const q = inputFor(b, [{ target_id: id(100), source: null, holding: held, quarantine: null }]);
  const r = planNativeBarRecovery(q);
  assert.equal(r.status, "blocked"); assert.ok(r.blocking_reasons.includes("location_conflict")); assert.equal(r.attempt_plan, null);
});
test("the pure decoder refuses duplicate keys, invalid UTF-8 and noncanonical bytes", () => {
  const b = fixture(), bytes = Buffer.from(canonical(b));
  assert.deepEqual(decodeNativeBarRecoveryBundle(bytes), b);
  for (const raw of [Buffer.from('{"schema":"x","schema":"y"}'), Buffer.from([123,34,120,34,58,34,255,34,125]),
    Buffer.from(canonical(b) + "\n"), Buffer.concat([Buffer.from([239,187,191]), bytes])]) assert.throws(() => decodeNativeBarRecoveryBundle(raw));
});

function resealOriginal(b) {
  const o = b.original; rehash(o.plan); o.intent.approval_plan_hash = o.plan.plan_hash;
  o.scope.initial_plan_hash = o.plan.plan_hash; o.scope.manifest_hash = hash(o.manifest);
  o.scope.native_binding_hash = hash(o.plan.native_binding); o.scope_digest = hash(o.scope);
  o.intent.manifests[0].hash = hash(o.manifest);
}
test("role IDs cannot reuse a publication temporary ID even in a rehashed original", () => {
  const b = fixture(); b.original.plan.plan_id = id(1000); resealOriginal(b);
  assert.throws(() => validateNativeBarRecoveryBundle(b), /identifier/);
});
test("shared native parent paths cannot carry conflicting full access evidence", () => {
  const b = fixture(2); b.original.plan.native_binding.targets[1].parents[0].proof.acl_hash = hash("different ACL"); resealOriginal(b);
  assert.throws(() => validateNativeBarRecoveryBundle(b), /native_binding/);
});
test("native directory birthtimes cannot be newer than original admission", () => {
  const b = fixture(); b.original.plan.native_binding.root.birthtime_ns = ns(2); resealOriginal(b);
  assert.throws(() => validateNativeBarRecoveryBundle(b), /native_binding/);
});
test("reserve cannot alias a root or parent directory", () => {
  for (const inode of ["2", "20"]) {
    const b = fixture(); b.original.scope.allocation.proof.inode = inode; resealOriginal(b);
    assert.throws(() => validateNativeBarRecoveryBundle(b), /scope_binding/);
  }
});
test("a timestamp cannot alias a root or parent directory", () => {
  for (const inode of ["2", "20"]) {
    const b = finishInitial(); mark(b, 8); b.markers[0].proof.inode = inode; complete(b, 10);
    assert.throws(() => validateNativeBarRecoveryBundle(b), /marker_alias/);
  }
});
test("fresh inventory rejects two single-link files claiming the same native object", () => {
  const q = inputFor(fixture()), files = q.view.entries.filter((e) => e.kind === "file");
  files[1].proof.inode = files[0].proof.inode; refreshInventory(q);
  const r = planNativeBarRecovery(q);
  assert.equal(r.status, "blocked"); assert.ok(r.blocking_reasons.includes("entry_object_alias"));
});
test("nonzero occupied bytes require an occupied inventory entry", () => {
  assert.throws(() => calculateNativeBarRecoveryCapacity({ ...capacity(), occupied_inventory_bytes: "1" }), /capacity_binding/);
});

test("capacity boundaries are exact and never credit planned deletion or reserve reuse", () => {
  const initial = capacity(), full = calculateNativeBarRecoveryCapacity(initial);
  const one = { ...capacity(1), remaining_publications: 23, remaining_temporaries: 69, available_bytes: "27525120" };
  assert.equal(calculateNativeBarRecoveryCapacity(one).peak_bytes, "9175040");
  assert.equal(calculateNativeBarRecoveryCapacity(one).fits, true);
  assert.equal(calculateNativeBarRecoveryCapacity({ ...initial, available_bytes: String(BigInt(full.required_available_bytes) - 1n) }).fits, false);
  for (const patch of [{ target_count: 3 }, { remaining_temporaries: 110 }, { reserve_allocated_bytes: "1" },
    { deletion_credit_bytes: "1000000000" }, { occupied_inventory_bytes: "01" }, { occupied_metadata_bytes: "1" }])
    assert.throws(() => calculateNativeBarRecoveryCapacity({ ...initial, ...patch }));
  const r = { ...initial, phase: "recovery", occupied_entries: "1", occupied_allocated_bytes: full.peak_bytes,
    reserve_allocated_bytes: full.peak_bytes, remaining_publications: 0, remaining_temporaries: 0, available_bytes: "6291456" };
  const result = calculateNativeBarRecoveryCapacity(r);
  assert.equal(result.remaining_peak_bytes, "3145728"); assert.equal(result.required_available_bytes, "6291456");
  assert.equal(result.peak_allocated_bytes, "15990784"); assert.equal(result.fits, true);
  for (const [field, limit, reason] of [["occupied_inventory_bytes", 1024 ** 3 - 3145728, "inventory_capacity"],
    ["occupied_metadata_bytes", 16 * 1024 ** 2 - 3145728, "metadata_capacity"],
    ["occupied_allocated_bytes", 1024 ** 3 - 3145728, "physical_capacity"],
    ["read_bytes", 256 * 1024 ** 2, "read_capacity"], ["response_bytes", 8 * 1024 ** 2, "response_capacity"]]) {
    const c = { ...r, occupied_inventory_bytes: String(1024 ** 3 - 3145728), [field]: String(limit) };
    assert.ok(!calculateNativeBarRecoveryCapacity(c).reasons.includes(reason), field);
    assert.ok(calculateNativeBarRecoveryCapacity({ ...c, [field]: String(limit + 1) }).reasons.includes(reason), field);
  }
  for (const patch of [{ available_bytes: null }, { available_bytes: "6291455" }, { reserve_allocated_bytes: null },
    { reserve_allocated_bytes: "12845055" }, { occupied_entries: "481" }, { descriptors: 465 }, { read_bytes: "268435457" }])
    assert.equal(calculateNativeBarRecoveryCapacity({ ...r, ...patch }).fits, false);
  assert.equal(calculateNativeBarRecoveryCapacity({ ...r, occupied_entries: "480", descriptors: 464 }).fits, true);
});

test("completion is inspectable after controller loss but never produces a new plan", () => {
  const b = finishInitial(fixture(2)); mark(b, 12); complete(b, 14); const input = inputFor(b); input.controller = null;
  const r = planNativeBarRecovery(input);
  assert.equal(r.status, "complete_read_only"); assert.equal(r.original_acknowledgement, "not_proven");
  assert.equal(r.approval_authenticated, false); assert.equal(r.recovery_execution_available, false);
  assert.equal(r.attempt_plan, null); assert.deepEqual(r.remaining, []);
  input.view.locations[1].quarantine.ctime_ns = ns(15);
  assert.equal(planNativeBarRecovery(input).status, "blocked");
});
test("the last recovery ordinal includes unused published attempts and cannot grant a fourth attempt", () => {
  const b = finishInitial(); mark(b, 8); const q = b.events.at(-1).proof;
  const obs = [{ target_id: id(100), source: null, holding: null, quarantine: q }], actions = [{ target_id: id(100), action: "verify" }];
  addAttempt(b, 2, 700, obs, actions); addAttempt(b, 3, 1400, obs, actions);
  event(b, "recovered_verified", 1403, { location: "quarantine", proof: q, from_pending_event_hash: null }); mark(b, 1404); complete(b, 1406);
  assert.equal(validateNativeBarRecoveryBundle(b).status, "complete");
  assert.equal(b.completion.published_attempt_hashes.length, 3); assert.equal(b.completion.used_attempt_hashes.length, 2);
  b.completion.published_attempt_hashes.splice(1, 1);
  assert.throws(() => validateNativeBarRecoveryBundle(b), /completion_binding/);
});
function refreshInventory(input) {
  const v = input.view; v.inventory_hash = hash(v.entries);
  v.current_reference_hash = hash({ inventory_hash: v.inventory_hash, original_reference_hash: v.reference_hash, native_binding_hash: hash(v.native_binding) });
  v.accounting.occupied_inventory_bytes = String(v.entries.reduce((n, e) => n + BigInt(e.size), 0n));
  v.accounting.occupied_allocated_bytes = String(v.entries.reduce((n, e) => n + BigInt(e.allocated_bytes ?? "0"), 0n));
}
test("review: recovery plans bind a fresh reference generation without replacing the original v2 audit hash", () => {
  const q = inputFor(fixture()), r = planNativeBarRecovery(q);
  assert.equal(r.status, "planned_only");
  assert.equal(r.attempt_plan.reference_hash, q.bundle.original.intent.baseline.reference_hash);
  assert.match(r.attempt_plan.current_reference_hash, /^[a-f0-9]{64}$/);
  assert.equal(r.attempt_plan.current_reference_hash, hash({ inventory_hash: q.view.inventory_hash,
    original_reference_hash: q.view.reference_hash, native_binding_hash: hash(q.view.native_binding) }));
  assert.notEqual(r.attempt_plan.current_reference_hash, r.attempt_plan.reference_hash);
});
test("review: tampered current reference generations refuse even when their enclosing plan is rehashed", () => {
  const b = fixture(); addAttempt(b); b.attempts[0].plan.current_reference_hash = hash("another generation"); rehash(b.attempts[0].plan);
  assert.throws(() => validateNativeBarRecoveryBundle(b), /attempt_binding/);
  const q = inputFor(fixture()); q.view.current_reference_hash = hash("another generation");
  const r = planNativeBarRecovery(q); assert.equal(r.status, "blocked"); assert.ok(r.blocking_reasons.includes("current_reference_generation_changed"));
});
test("review: owned publication deltas refresh only the current generation, not the original audit hash", () => {
  const q = inputFor(fixture()), before = planNativeBarRecovery(q).attempt_plan;
  const path = q.bundle.original.plan.layout.publications[0].temporaries[0].path, p = { ...proof("8200"), size: "1", flags: "0", acl_hash: hash("no ACL") };
  q.view.entries.push({ path, kind: "file", size: p.size, sha256: p.sha256, allocated_bytes: "4096", proof: p, directory_proof: null });
  refreshInventory(q); q.view.accounting.occupied_metadata_bytes = String(BigInt(q.view.accounting.occupied_metadata_bytes) + 1n);
  const r = planNativeBarRecovery(q); assert.equal(r.status, "planned_only");
  assert.equal(r.attempt_plan.reference_hash, before.reference_hash); assert.notEqual(r.attempt_plan.current_reference_hash, before.current_reference_hash);
});
test("review: transaction directories retain exact identity and access facts in fresh views", () => {
  for (const field of ["inode", "gid", "birthtime_ns", "flags", "acl_hash"]) {
    const q = inputFor(fixture()), e = q.view.entries.find((e) => e.path === q.bundle.original.plan.layout.directories[2]);
    e.directory_proof[field] = field === "acl_hash" ? hash("another ACL") : String(BigInt(e.directory_proof[field]) + 1n); refreshInventory(q);
    const r = planNativeBarRecovery(q); assert.equal(r.status, "blocked", field); assert.ok(r.blocking_reasons.includes("directory_missing_or_changed"), field);
  }
});
test("review: original layout evidence cannot omit, reorder, alias or postdate its prepared directory set", () => {
  for (const mutate of [(s) => s.layout_directories.pop(), (s) => s.layout_directories.reverse(),
    (s) => { s.layout_directories[0].proof = directory("2"); }, (s) => { s.layout_directories[0].proof.birthtime_ns = ns(3); }]) {
    const b = fixture(); mutate(b.original.scope); b.original.scope_digest = hash(b.original.scope);
    assert.throws(() => validateNativeBarRecoveryBundle(b));
  }
});
test("review: completed records do not skip current reserve evidence or qualify a substituted allocation", () => {
  for (const change of [(q) => { q.view.allocation_complete = false; }, (q) => { q.view.reserve = null; },
    (q) => { q.view.reserve.proof.inode = "9200"; }, (q) => { q.view.reserve.allocated_bytes = "0"; },
    (q) => { q.view.entries = q.view.entries.filter((e) => e.path !== q.bundle.original.plan.layout.reserve_path); refreshInventory(q); }]) {
    const b = finishInitial(); mark(b, 20); complete(b, 22); const q = inputFor(b); change(q);
    const r = planNativeBarRecovery(q); assert.equal(r.recorded_status, "complete"); assert.equal(r.status, "blocked");
    assert.ok(r.blocking_reasons.includes("original_allocation_unverified")); assert.deepEqual(r.remaining, []);
  }
});
test("recovery accepts the same reserve with at least its original observed allocation and charges the actual occupancy", () => {
  const q = inputFor(fixture()); q.view.reserve.allocated_bytes = String(BigInt(q.view.reserve.allocated_bytes) + 4096n);
  q.view.entries.find((e) => e.path === q.bundle.original.plan.layout.reserve_path).allocated_bytes = q.view.reserve.allocated_bytes;
  refreshInventory(q); assert.equal(planNativeBarRecovery(q).status, "planned_only");
});
test("retained temporary bytes must be charged as metadata without adoption or cleanup", () => {
  const q = inputFor(fixture()), path = q.bundle.original.plan.layout.publications[0].temporaries[0].path;
  const p = { ...proof("8100"), size: "123", flags: "0", acl_hash: hash("no ACL") };
  q.view.entries.push({ path, kind: "file", size: p.size, sha256: p.sha256, allocated_bytes: "4096", proof: p, directory_proof: null }); refreshInventory(q);
  const blocked = planNativeBarRecovery(q);
  assert.equal(blocked.status, "blocked"); assert.ok(blocked.blocking_reasons.includes("accounting_underreported"));
  q.view.accounting.occupied_metadata_bytes = String(BigInt(q.view.accounting.occupied_metadata_bytes) + 123n);
  const before = canonical(q), r = planNativeBarRecovery(q);
  assert.equal(r.status, "planned_only"); assert.equal(canonical(q), before);
  assert.ok(r.remaining.every((t) => t.operations.every((s) => !/delete|purge|adopt|cleanup/.test(s))));
});
test("consumed-before-publication ordinal stays spent while the final allowed invocation can be planned", () => {
  const q = inputFor(fixture()); q.controller.consumed_ordinals = [1, 2]; q.request.ordinal = 3;
  assert.equal(planNativeBarRecovery(q).attempt_plan.ordinal, 3);
  q.controller.consumed_ordinals = [1, 2, 3];
  assert.equal(planNativeBarRecovery(q).status, "blocked");
});
test("missing original or view remains diagnostics-only", () => {
  const q = inputFor(fixture()); q.view = null;
  assert.equal(planNativeBarRecovery(q).status, "blocked");
  q.bundle.original = null;
  assert.equal(validateNativeBarRecoveryBundle(q.bundle).status, "preparation_incomplete");
  assert.equal(planNativeBarRecovery(q).attempt_plan, null);
});
for (const [name, mutate] of [
  ["unknown field", (b) => { b.authorized = true; }],
  ["v4 profile", (b) => { b.original.plan.binding.policy_hash = hash({ schema: "native-bar-synthetic-quarantine-profile-v4" }); resealOriginal(b); }],
  ["missing attempt", (b) => { b.attempts = []; }],
  ["gapped events", (b) => { b.events.splice(1, 1); }],
  ["extra event", (b) => { b.events.push(structuredClone(b.events.at(-1))); }],
  ["altered old marker", (b) => { b.markers[0].record.targets[0].proof.sha256 = hash("other"); }],
  ["marker preceding verification", (b) => { b.markers[0].record.publication.before = clock(6); }],
  ["future marker ctime", (b) => { b.markers[0].proof.ctime_ns = ns(10); }],
  ["wrong marker role", (b) => { b.completion.marker.path = `quarantine/abandoned/${id(1)}/timestamp.json`; }],
  ["completion expiry", (b) => { b.completion.clock = clock(601); }],
  ["wrong consumed attempt list", (b) => { b.completion.used_attempt_hashes = [hash("wrong")]; }],
  ["attempt plan role collision", (b) => { b.attempts[0].plan.plan_id = id(3); rehash(b.attempts[0].plan); }],
]) test(`v5 records reject ${name}`, () => {
  const b = finishInitial(); mark(b, 8); complete(b, 10); mutate(b);
  assert.throws(() => validateNativeBarRecoveryBundle(b));
});
for (const [name, pathFor] of [
  ["undeclared final", () => `quarantine/abandoned/${id(1)}/unexpected`],
  ["undeclared holding", () => `maintenance-hold/${id(1)}/unexpected`],
  ["another transaction", () => `maintenance/${id(999)}.json`],
  ["another reserve", () => `.quarantine-reserve-${id(999)}.tmp`],
  ["another temporary", () => `.publication-${id(999)}.tmp`],
  ["target receipt", () => `receipts/2026-10-24/${id(200)}.json`],
  ["future ordinal temporary", (q) => q.bundle.original.plan.layout.publications[0].temporaries[2].path],
]) test(`remaining planning refuses ${name} without removing it`, () => {
  const q = inputFor(fixture()), p = { ...proof("8100"), flags: "0", acl_hash: hash("no ACL") };
  q.view.entries.push({ path: pathFor(q), kind: "file", size: p.size, sha256: p.sha256, allocated_bytes: "4096", proof: p, directory_proof: null });
  refreshInventory(q); const before = canonical(q), r = planNativeBarRecovery(q);
  assert.equal(r.status, "blocked"); assert.equal(canonical(q), before); assert.equal(r.attempt_plan, null); assert.deepEqual(r.remaining, []);
});

const variants = ["source", "pending_source", "pending_held", "held", "q_pending_held", "q_pending_final", "final"];
function mixedFixture(kinds) {
  const b = fixture(kinds.length); addAttempt(b); const locations = []; let tick = 4;
  for (const [i, kind] of kinds.entries()) {
    const t = b.original.manifest.targets[i], held = { ...t.proof, ctime_ns: ns(tick + 1) }, q = { ...t.proof, ctime_ns: ns(tick + 3) };
    if (kind !== "source") event(b, "move_pending", tick, { proof: t.proof }, i);
    if (["held", "q_pending_held", "q_pending_final", "final"].includes(kind)) event(b, "held_verified", tick + 1, { proof: held }, i);
    if (["q_pending_held", "q_pending_final", "final"].includes(kind)) event(b, "quarantine_move_pending", tick + 2, { proof: held }, i);
    if (kind === "final") event(b, "quarantined_verified", tick + 3, { proof: q }, i);
    const place = ["source", "pending_source"].includes(kind) ? "source" : ["pending_held", "held", "q_pending_held"].includes(kind) ? "holding" : "quarantine";
    locations.push({ target_id: t.target_id, source: place === "source" ? t.proof : null,
      holding: place === "holding" ? held : null, quarantine: place === "quarantine" ? q : null }); tick += 4;
  } return { b, locations };
}
test("every one/two-target decision combination has the exact residual steps and replays to a v5 completion", async (t) => {
  const combinations = [...variants.map((v) => [v]), ...variants.flatMap((a) => variants.map((b) => [a, b]))];
  for (const kinds of combinations) await t.test(kinds.join(" + "), () => {
    const { b, locations } = mixedFixture(kinds), input = inputFor(b, locations), result = planNativeBarRecovery(input);
    assert.equal(result.status, "planned_only", JSON.stringify(result.blocking_reasons));
    for (const [i, loc] of locations.entries()) {
      const expected = loc.source ? [...(b.events.length ? ["recovered_source"] : []), "move_pending", "stage", "held_verified", "quarantine_move_pending", "quarantine", "quarantined_verified"]
        : loc.holding ? ["recovered_holding", "quarantine_move_pending", "quarantine", "quarantined_verified"] : ["recovered_quarantine"];
      assert.deepEqual(result.remaining[i].operations, expected);
    }
    const p = result.attempt_plan;
    const attempt = { schema: "native-bar-maintenance-attempt-v2", attempt_id: id(11), maintenance_id: id(1), intent_hash: hash(b.original.intent),
      binding_hash: hash(b.original.intent.binding), approval_plan_hash: p.plan_hash, issued: clock(700), expires_at: p.expires_at,
      resume_after_event_hash: p.prefix_hash, reference_hash: b.original.intent.baseline.reference_hash, actions: p.actions, observations: p.observations };
    b.attempts.push({ schema: "native-bar-recovery-attempt-v5", ordinal: 2, previous_envelope_hash: hash(b.attempts.at(-1)), attempt, plan: p });
    let tick = 704;
    for (const [i, remaining] of result.remaining.entries()) {
      const loc = locations[i]; let current = loc.source ?? loc.holding ?? loc.quarantine;
      const prior = [...b.events].reverse().find((e) => e.target_id === loc.target_id);
      const from = prior && ["move_pending", "quarantine_move_pending"].includes(prior.type) ? hash(prior) : null;
      for (const step of remaining.operations) {
        if (step === "stage" || step === "quarantine") current = { ...current, ctime_ns: ns(tick) };
        else if (step.startsWith("recovered_")) event(b, "recovered_verified", tick, { location: step.slice(10), proof: current, from_pending_event_hash: from }, i);
        else event(b, step, tick, { proof: current }, i);
        tick++;
      }
    }
    mark(b, tick); complete(b, tick + 2); assert.equal(validateNativeBarRecoveryBundle(b).status, "complete");
  });
});

for (const [label, mutate, reason] of [
  ["missing source", (q) => { q.view.locations[0].source = null; }, "location"],
  ["duplicate locations", (q) => { q.view.locations[0].holding = structuredClone(q.view.locations[0].source); }, "location"],
  ["changed bytes", (q) => { q.view.locations[0].source.sha256 = hash("different"); }, "location"],
  ["changed flags", (q) => { q.view.locations[0].source.flags = "1"; }, "location"],
  ["changed ACL digest", (q) => { q.view.locations[0].source.acl_hash = hash("different ACL"); }, "location"],
  ["root replacement", (q) => { q.view.native_binding.root.inode = "888"; }, "native_binding"],
  ["reference change", (q) => { q.view.reference_hash = hash("new reference"); }, "references"],
  ["incomplete inventory", (q) => { q.view.inventory_complete = false; }, "inventory"],
  ["unverified references", (q) => { q.view.references_complete = false; }, "references"],
  ["lost allocation", (q) => { q.view.reserve = null; }, "allocation"],
  ["unverified allocation", (q) => { q.view.allocation_complete = false; }, "allocation"],
  ["underreported metadata", (q) => { q.view.accounting.occupied_metadata_bytes = "0"; }, "accounting"],
  ["stale observation", (q) => { q.view.observed_at = q.request.issued_at; }, "clock"],
  ["wall expiry", (q) => { q.request.checked_at = q.request.expires_at; }, "clock"],
  ["monotonic expiry", (q) => { q.request.checked_elapsed_ns = "600000000000"; }, "clock"],
  ["renewed lease", (q) => { q.request.expires_at = time(1301); }, "clock"],
  ["reused ordinal", (q) => { q.request.ordinal = 1; }, "ordinal"],
  ["exhausted attempts", (q) => { q.controller.consumed_ordinals = [1, 2, 3]; q.request.ordinal = 3; }, "exhausted"],
  ["lost controller", (q) => { q.controller = null; }, "controller"],
  ["forged controller seal", (q) => { q.controller.original_envelope_hash = hash("forged"); }, "controller"],
  ["counter rewind gap", (q) => { q.controller.consumed_ordinals = [1, 3]; }, "controller"],
  ["insufficient space", (q) => { q.view.accounting.available_bytes = "1"; }, "available_space"],
  ["FD pressure", (q) => { q.view.accounting.descriptors = 500; }, "descriptor"],
  ["read budget", (q) => { q.view.accounting.read_bytes = String(256 * 1024 ** 2 + 1); }, "read_capacity"],
]) test(`all-target planning blocks ${label} without returning partial actions`, () => {
  const q = inputFor(fixture(2)); mutate(q); const r = planNativeBarRecovery(q);
  assert.equal(r.status, "blocked"); assert.deepEqual(r.remaining, []); assert.equal(r.attempt_plan, null);
  assert.ok(r.blocking_reasons.some((s) => s.includes(reason)), JSON.stringify(r.blocking_reasons));
});

test("a recovery attempt must open each planned verification before any other step", () => {
  const build = (verify) => {
    const b = fixture(); addAttempt(b); const t = b.original.manifest.targets[0], held = { ...t.proof, ctime_ns: ns(5) };
    event(b, "move_pending", 4, { proof: t.proof }); event(b, "held_verified", 5, { proof: held });
    addAttempt(b, 2, 700, [{ target_id: id(100), source: null, holding: held, quarantine: null }],
      [{ target_id: id(100), action: "verify" }, { target_id: id(100), action: "quarantine" }]);
    if (verify) event(b, "recovered_verified", 703, { location: "holding", proof: held, from_pending_event_hash: null });
    event(b, "quarantine_move_pending", 704, { proof: held }); event(b, "quarantined_verified", 705, { proof: { ...held, ctime_ns: ns(705) } });
    return b;
  };
  assert.throws(() => validateNativeBarRecoveryBundle(build(false)), /recovery_verification_required/);
  const result = validateNativeBarRecoveryBundle(build(true));
  assert.equal(result.targets[0].state, "quarantined"); assert.equal(result.elapsed_clock_qualified, false);
});
test("the decoder refuses deeply nested input cleanly before any recursive comparison", () => {
  const deep = Buffer.from(`{"attempts":${"[".repeat(20000)}${"]".repeat(20000)}}`);
  assert.throws(() => decodeNativeBarRecoveryBundle(deep), /recovery_input_depth/);
});
