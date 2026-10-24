import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonical, evidenceHash as hash } from "../../build/nativeBarEvidence.js";
import { nativeBarTransactionProofSchema } from "../../build/nativeBarTransactions.js";
import { validateNativeBarRecoveryBundle } from "../../build/nativeBarRecovery.js";
import { NativeBarHistory } from "../../build/nativeBarHistory.js";
import { createSyntheticNativeBarQuarantineRegistry } from "../../build/nativeBarQuarantine.js";
import * as api from "../../build/nativeBarFs.js";

const policy = '{"schema":"native-bar-synthetic-quarantine-recovery-profile-v5"}';
function fixture(t) {
  const base = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "native-bar-fs-synthetic-")); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(join(base, ".native-bar-fs-synthetic"), "synthetic-fixture-v1\n", { mode: 0o600 });
  const root = join(base, "store"); fs.mkdirSync(root, { mode: 0o700 }); fs.writeFileSync(join(root, "policy.json"), policy, { mode: 0o600 });
  return { base, root };
}
function selectedFixture(t) {
  const f = fixture(t), path = "captures/2026-10-24/00000000-0000-4000-8000-000000000201.json", bytes = Buffer.from("invented independent input\n");
  fs.mkdirSync(join(f.root, "captures", "2026-10-24"), { recursive: true, mode: 0o700 }); fs.writeFileSync(join(f.root, path), bytes, { mode: 0o600 });
  return { ...f, inputs: [{ source_path: path, bytes }] };
}
function prepareFixture(f, a) {
  const helper = join(f.base, "reserve-setup");
  const compiled = spawnSync("/usr/bin/xcrun", ["clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
    fileURLToPath(new URL("./recoveryReserveFixture.cc", import.meta.url)), "-o", helper], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
  const reserve = spawnSync(helper, [f.root, a.plan.layout.reserve_path, a.capacity.peak_bytes], { encoding: "utf8" });
  assert.equal(reserve.status, 0, reserve.stderr);
  for (const dir of a.plan.layout.directories) fs.mkdirSync(join(f.root, dir), { recursive: true, mode: 0o700 });
}
function publishOriginal(root, original) {
  const { layout } = original.plan;
  fs.writeFileSync(join(root, `maintenance/${layout.maintenance_id}.manifest/${layout.chunk_id}.json`), canonical(original.manifest), { mode: 0o600 });
  fs.writeFileSync(join(root, `maintenance/${layout.maintenance_id}.json`), canonical(original), { mode: 0o600 });
}
async function sealed(t) {
  const f = selectedFixture(t), mod = await import("../../build/nativeBarRecoveryController.js");
  const c = mod.createSyntheticNativeBarRecoveryController(); t.after(() => c.close()); const a = c.admit(f.root, f.inputs);
  prepareFixture(f, a); const original = c.prepareOriginal(a.admission); publishOriginal(f.root, original); c.sealOriginal(a.admission);
  return { ...f, mod, c, a, original, ticket: c.connect(a.admission) };
}
function nativeProof(root, path) {
  const reader = api.openSyntheticNativeBarRecoveryReader(root);
  try { const snapshot = reader.inventory(); try {
    return snapshot.readEvidence(snapshot.report.entries.findIndex((e) => e.path === path)).proof;
  } finally { snapshot.close(); } } finally { reader.close(); }
}
function baseProof(p) { return nativeBarTransactionProofSchema.parse(Object.fromEntries(Object.keys(nativeBarTransactionProofSchema.shape).map((k) => [k, p[k]]))); }
function seedAttempt(x) {
  const o = x.original, layout = o.plan.layout;
  const fields = { schema: "native-bar-recovery-attempt-plan-v5", plan_id: randomUUID(), maintenance_id: layout.maintenance_id,
    ordinal: 1, scope_digest: o.scope_digest, original_envelope_hash: hash(o), intent_hash: hash(o.intent), prefix_hash: null, prefix_count: 0,
    opened_at: o.plan.opened_at, issued_at: new Date(Date.parse(o.plan.opened_at) + 1).toISOString(), observed_at: o.scope.allocation.acknowledged.utc_at,
    expires_at: o.plan.expires_at, inventory_hash: o.plan.baseline.inventory_hash, reference_hash: o.plan.baseline.reference_hash,
    native_binding_hash: hash(o.plan.native_binding), observations: o.plan.targets.map((t) => ({ target_id: t.target_id, source: t.proof, holding: null, quarantine: null })),
    actions: o.plan.targets.flatMap((t) => ["stage", "quarantine"].map((action) => ({ target_id: t.target_id, action }))) };
  fields.current_reference_hash = hash({ inventory_hash: fields.inventory_hash, original_reference_hash: fields.reference_hash,
    native_binding_hash: fields.native_binding_hash });
  const plan = { ...fields, plan_hash: hash(fields) }, attempt = { schema: "native-bar-maintenance-attempt-v2", attempt_id: layout.attempt_ids[0],
    maintenance_id: layout.maintenance_id, intent_hash: hash(o.intent), binding_hash: hash(o.intent.binding), approval_plan_hash: o.plan.plan_hash,
    issued: { utc_at: o.plan.opened_at, elapsed: null }, expires_at: o.plan.expires_at, resume_after_event_hash: null,
    reference_hash: o.plan.baseline.reference_hash, actions: fields.actions, observations: fields.observations };
  const env = { schema: "native-bar-recovery-attempt-v5", ordinal: 1, previous_envelope_hash: null, attempt, plan };
  const path = `maintenance/${layout.maintenance_id}.attempts/${attempt.attempt_id}.json`;
  fs.writeFileSync(join(x.root, path), canonical(env), { mode: 0o600 }); x.c.rememberPublication(x.a.admission, path, env);
  return { attempt, events: [] };
}
function seedEvent(x, state, type, proof) {
  const o = x.original, event = { schema: "native-bar-maintenance-event-v2", maintenance_id: o.intent.maintenance_id,
    intent_hash: hash(o.intent), attempt_id: state.attempt.attempt_id, attempt_hash: hash(state.attempt), sequence: state.events.length + 1,
    previous_event_hash: state.events.length ? hash(state.events.at(-1)) : null, target_id: o.plan.targets[0].target_id,
    clock: { utc_at: new Date().toISOString(), elapsed: null }, type, proof };
  state.events.push(event); const path = `maintenance/${o.intent.maintenance_id}.events/${event.sequence}.json`;
  fs.writeFileSync(join(x.root, path), canonical(event), { mode: 0o600 }); x.c.rememberPublication(x.a.admission, path, event); return event;
}
test("v5 read mode reports descriptor ACL/allocation/ancestor facts and creates no files", (t) => {
  const { root } = fixture(t), before = fs.readdirSync(root);
  const reader = api.openSyntheticNativeBarRecoveryReader(root); t.after(() => reader.close());
  const snapshot = reader.inventory();
  assert.equal(snapshot.report.schema, "native-bar-native-recovery-inventory-v5");
  assert.equal(snapshot.report.execution_available, false); assert.match(snapshot.report.root.acl_hash, /^[a-f0-9]{64}$/);
  assert.ok(snapshot.report.ancestors.length > 0); assert.ok(BigInt(snapshot.report.available_bytes) > 0n);
  const index = snapshot.report.entries.findIndex((e) => e.path === "policy.json"), r = snapshot.readEvidence(index);
  assert.equal(r.proof.sha256, createHash("sha256").update(policy).digest("hex")); assert.ok(BigInt(r.proof.allocated_bytes) > 0n);
  assert.equal(r.proof.acl_hash, snapshot.report.entries[index].proof.acl_hash);
  const checked = snapshot.verify(); assert.equal(checked.matches, true);
  assert.ok(BigInt(checked.report.lease_read_bytes) >= BigInt(r.lease_read_bytes));
  snapshot.close(); reader.close(); assert.deepEqual(fs.readdirSync(root), before);
});
test("controller admission selects independently supplied invented bytes without writing metadata", async (t) => {
  const { root } = fixture(t), day = "2026-10-24", id = "00000000-0000-4000-8000-000000000201";
  fs.mkdirSync(join(root, "captures", day), { recursive: true, mode: 0o700 });
  const path = `captures/${day}/${id}.json`, bytes = Buffer.from("independently invented input\n");
  fs.writeFileSync(join(root, path), bytes, { mode: 0o600 });
  const { createSyntheticNativeBarRecoveryController } = await import("../../build/nativeBarRecoveryController.js");
  const c = createSyntheticNativeBarRecoveryController(); t.after(() => c.close());
  assert.throws(() => c.admit(root, [{ source_path: path, bytes: Buffer.from("different") }]), /independent_input/);
  const a = c.admit(root, [{ source_path: path, bytes }]);
  assert.equal(a.plan.targets.length, 1); assert.equal(a.plan.targets[0].source_path, path);
  assert.equal(a.plan.targets[0].proof.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(a.execution_available, false); assert.deepEqual(fs.readdirSync(root).sort(), ["captures", "policy.json"]);
  assert.throws(() => c.connect(structuredClone(a.admission)), /admission/);
  assert.throws(() => c.connect(a.admission), /not_sealed/);
});
test("controller admission refuses an impossible capture partition date before retaining a scope", async (t) => {
  const f = fixture(t), path = "captures/2026-02-30/00000000-0000-4000-8000-000000000201.json", bytes = Buffer.from("invented");
  fs.mkdirSync(join(f.root, "captures/2026-02-30"), { recursive: true, mode: 0o700 }); fs.writeFileSync(join(f.root, path), bytes, { mode: 0o600 });
  const mod = await import("../../build/nativeBarRecoveryController.js"), c = mod.createSyntheticNativeBarRecoveryController(); t.after(() => c.close());
  assert.throws(() => c.admit(f.root, [{ source_path: path, bytes }]), /UTC timestamp/);
});
test("original sealing reads actual preparation and controller survives reader reconnection without granting execution", async (t) => {
  const f = selectedFixture(t), mod = await import("../../build/nativeBarRecoveryController.js");
  const c = mod.createSyntheticNativeBarRecoveryController(); t.after(() => c.close()); const a = c.admit(f.root, f.inputs);
  prepareFixture(f, a); const original = c.prepareOriginal(a.admission);
  publishOriginal(f.root, original); c.sealOriginal(a.admission);
  const ticket = c.connect(a.admission), r = mod.inspectSyntheticNativeBarRecovery(ticket);
  assert.equal(r.result.status, "planned_only"); assert.equal(r.controller_scope_verified, true);
  assert.equal(r.execution_available, false); assert.equal(r.approval_authenticated, false);
  assert.equal(r.bundle.original.scope_digest, original.scope_digest);
  c.disconnect(ticket); assert.throws(() => mod.inspectSyntheticNativeBarRecovery(ticket), /connection_closed/);
  const next = c.connect(a.admission); assert.equal(mod.inspectSyntheticNativeBarRecovery(next).result.status, "planned_only");
  assert.throws(() => mod.inspectSyntheticNativeBarRecovery(structuredClone(next)), /connection/);
  c.close(); assert.throws(() => mod.inspectSyntheticNativeBarRecovery(next), /controller_unavailable/);
});
for (let slot = 0; slot < 9; ++slot) test(`review: replacing transaction directory ${slot} invalidates the admitted scope`, async (t) => {
  const x = await sealed(t), path = x.original.plan.layout.directories[slot], preserved = join(x.base, "preserved-directory");
  fs.renameSync(join(x.root, path), preserved);
  fs.mkdirSync(join(x.root, path), { mode: 0o700 });
  for (const name of fs.readdirSync(preserved)) fs.renameSync(join(preserved, name), join(x.root, path, name));
  assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket), /layout_directory_changed/);
  for (const name of fs.readdirSync(join(x.root, path))) fs.renameSync(join(x.root, path, name), join(preserved, name));
  fs.rmdirSync(join(x.root, path)); fs.renameSync(preserved, join(x.root, path));
  assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket), /admission_scope_invalid/);
  assert.deepEqual(fs.readFileSync(join(x.root, x.inputs[0].source_path)), x.inputs[0].bytes);
});
test("review: transaction directory substitution between preparation and sealing refuses the original", async (t) => {
  const f = selectedFixture(t), mod = await import("../../build/nativeBarRecoveryController.js"), c = mod.createSyntheticNativeBarRecoveryController();
  t.after(() => c.close()); const a = c.admit(f.root, f.inputs); prepareFixture(f, a); const o = c.prepareOriginal(a.admission);
  const path = o.plan.layout.directories[2]; fs.renameSync(join(f.root, path), join(f.base, "preserved-directory"));
  fs.mkdirSync(join(f.root, path), { mode: 0o700 }); publishOriginal(f.root, o);
  assert.throws(() => c.sealOriginal(a.admission), /layout_directory_changed/);
  assert.deepEqual(fs.readFileSync(join(f.root, f.inputs[0].source_path)), f.inputs[0].bytes);
});
test("review: deeply nested native records refuse before recursive canonical comparison", async (t) => {
  const x = await sealed(t), layout = x.original.plan.layout;
  fs.writeFileSync(join(x.root, `maintenance/${layout.maintenance_id}.attempts/${layout.attempt_ids[0]}.json`),
    "[".repeat(10000) + "0" + "]".repeat(10000), { mode: 0o600 });
  assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket),
    (error) => !(error instanceof RangeError) && /recovery_record_depth/.test(error.message));
});
for (const place of ["source", "holding", "quarantine"]) test(`fresh native recovery view reconciles the invented ${place} location without performing its moves`, async (t) => {
  const x = await sealed(t), state = seedAttempt(x), target = x.original.plan.targets[0];
  const held = `maintenance-hold/${x.original.intent.maintenance_id}/${target.target_id}`;
  const final = `quarantine/abandoned/${x.original.intent.maintenance_id}/${target.target_id}`;
  seedEvent(x, state, "move_pending", target.proof);
  if (place !== "source") fs.renameSync(join(x.root, target.source_path), join(x.root, held));
  if (place === "quarantine") {
    const proof = baseProof(nativeProof(x.root, held)); seedEvent(x, state, "held_verified", proof); seedEvent(x, state, "quarantine_move_pending", proof);
    fs.renameSync(join(x.root, held), join(x.root, final)); seedEvent(x, state, "quarantined_verified", baseProof(nativeProof(x.root, final)));
  }
  const before = fs.readFileSync(join(x.root, place === "source" ? target.source_path : place === "holding" ? held : final));
  const r = x.mod.inspectSyntheticNativeBarRecovery(x.ticket);
  assert.equal(r.result.status, "planned_only", JSON.stringify(r.result.blocking_reasons));
  assert.equal(r.result.remaining[0].location, place); assert.equal(r.result.remaining[0].operations[0], `recovered_${place}`);
  assert.deepEqual(fs.readFileSync(join(x.root, place === "source" ? target.source_path : place === "holding" ? held : final)), before);
  assert.equal(r.approval_authenticated, false); assert.equal(r.recovery_execution_available, false);
});
test("a self-consistent forged original cannot substitute another good capture for the independently admitted input", async (t) => {
  const f = selectedFixture(t), otherPath = f.inputs[0].source_path.replace("201.json", "202.json"), other = Buffer.from("another good invented capture");
  fs.writeFileSync(join(f.root, otherPath), other, { mode: 0o600 });
  const mod = await import("../../build/nativeBarRecoveryController.js"), c = mod.createSyntheticNativeBarRecoveryController(); t.after(() => c.close());
  const a = c.admit(f.root, f.inputs); prepareFixture(f, a); const o = c.prepareOriginal(a.admission), p = o.plan;
  const changed = { ...p.targets[0], source_path: otherPath, origin: { kind: "capture", recording_id: otherPath.split("/").at(-1).slice(0, -5) }, proof: baseProof(nativeProof(f.root, otherPath)) };
  p.targets = [changed]; o.manifest.targets = [changed]; const { plan_hash, ...fields } = p; void plan_hash; p.plan_hash = hash(fields);
  o.intent.approval_plan_hash = p.plan_hash; o.intent.manifests[0].hash = hash(o.manifest);
  o.scope.initial_plan_hash = p.plan_hash; o.scope.manifest_hash = hash(o.manifest); o.scope.inputs_digest = hash([{ source_path: otherPath, sha256: rawHash(other) }]);
  o.scope_digest = hash(o.scope);
  assert.doesNotThrow(() => validateNativeBarRecoveryBundle({ schema: "native-bar-recovery-bundle-v5", original: o, attempts: [], events: [], markers: [], completion: null }));
  publishOriginal(f.root, o); assert.throws(() => c.sealOriginal(a.admission), /not_admitted/);
  assert.deepEqual(fs.readFileSync(join(f.root, otherPath)), other); assert.deepEqual(fs.readFileSync(join(f.root, f.inputs[0].source_path)), f.inputs[0].bytes);
});
test("controller issuer, original seal and consumed ordinals cannot be reconstructed from JSON or reader tickets", async (t) => {
  const x = await sealed(t), other = x.mod.createSyntheticNativeBarRecoveryController(); t.after(() => other.close());
  assert.throws(() => other.connect(x.a.admission), /admission/); assert.throws(() => other.disconnect(x.ticket), /connection/);
  assert.throws(() => x.c.consumeAttempt(x.ticket, 2), /admission/);
  assert.throws(() => x.c.consumeAttempt(x.a.admission, 3), /ordinal/);
  x.c.consumeAttempt(x.a.admission, 2);
  assert.throws(() => x.c.consumeAttempt(x.a.admission, 2), /ordinal/);
  assert.equal(x.mod.inspectSyntheticNativeBarRecovery(x.ticket).result.attempt_plan.ordinal, 3);
  x.c.consumeAttempt(x.a.admission, 3); const exhausted = x.mod.inspectSyntheticNativeBarRecovery(x.ticket);
  assert.equal(exhausted.result.status, "blocked"); assert.ok(exhausted.result.blocking_reasons.includes("recovery_exhausted"));
  x.c.close(); assert.throws(() => other.admit(x.root, x.inputs), /fresh_fixture|already_admitted/);
});
test("retained partial temporaries are hashed and accounted without parsing, adopting or cleaning them", async (t) => {
  const x = await sealed(t), path = x.original.plan.layout.publications[0].temporaries[0].path, bytes = Buffer.from('{"unfinished":');
  fs.writeFileSync(join(x.root, path), bytes, { mode: 0o600 });
  const r = x.mod.inspectSyntheticNativeBarRecovery(x.ticket); assert.equal(r.result.status, "planned_only");
  assert.equal(r.view.entries.find((e) => e.path === path).sha256, rawHash(bytes));
  assert.deepEqual(fs.readFileSync(join(x.root, path)), bytes);
});
for (const kind of ["receipt", "writer", "private-entry", "original-bytes", "target-bytes", "reserve-substitution", "reserve-allocation-loss"]) {
  test(`read-only recovery refuses ${kind} and preserves the encountered files`, async (t) => {
    const x = await sealed(t), target = x.original.plan.targets[0], reserve = join(x.root, x.original.plan.layout.reserve_path);
    if (kind === "receipt") {
      fs.mkdirSync(join(x.root, "receipts", "2026-10-24"), { recursive: true, mode: 0o700 });
      fs.writeFileSync(join(x.root, "receipts", "2026-10-24", `${target.origin.recording_id}.json`), "{}", { mode: 0o600 });
    }
    if (kind === "writer") fs.writeFileSync(join(x.root, ".writer.lock"), "unknown live writer", { mode: 0o600 });
    if (kind === "private-entry") fs.writeFileSync(join(x.root, `maintenance-hold/${x.original.intent.maintenance_id}/unexpected`), "preserve", { mode: 0o600 });
    if (kind === "original-bytes") fs.appendFileSync(join(x.root, `maintenance/${x.original.intent.maintenance_id}.json`), " ");
    if (kind === "target-bytes") fs.writeFileSync(join(x.root, target.source_path), "different target", { mode: 0o600 });
    if (kind === "reserve-substitution") { fs.renameSync(reserve, join(x.base, "original-reserve")); fs.writeFileSync(reserve, "", { mode: 0o600 }); }
    if (kind === "reserve-allocation-loss") { fs.truncateSync(reserve, 1); fs.truncateSync(reserve, 0); }
    const before = fs.readFileSync(join(x.root, target.source_path));
    if (["target-bytes", "reserve-substitution", "reserve-allocation-loss"].includes(kind)) {
      const r = x.mod.inspectSyntheticNativeBarRecovery(x.ticket);
      assert.equal(r.result.status, "blocked"); assert.ok(r.result.blocking_reasons.includes(kind === "target-bytes" ? "location_conflict" : "original_allocation_unverified"));
    } else {
      const expected = { receipt: /recovery_references_changed/, writer: /recovery_coordination_prerequisite/,
        "private-entry": /recovery_unqualified_namespace/, "original-bytes": /recovery_acknowledged_record_changed/ };
      assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket), expected[kind]);
    }
    assert.deepEqual(fs.readFileSync(join(x.root, target.source_path)), before); assert.equal(fs.existsSync(reserve), true);
  });
}
test("controller closure during native collection cannot return a successful authenticated view", async (t) => {
  const x = await sealed(t);
  assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket, { hook(phase) { if (phase === "verify_before_scan") x.c.close(); } }), /controller_unavailable/);
});
test("a controller cannot forget a later observed wall time when a new reader lease opens", async (t) => {
  const x = await sealed(t), originalNow = Date.now;
  try {
    Date.now = () => Date.parse(x.original.plan.opened_at);
    assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket), /controller_clock_rollback/);
  } finally { Date.now = originalNow; }
});
test("response construction cannot return a qualified view after its original read lease expires", async (t) => {
  const x = await sealed(t), original = Buffer.byteLength; let delayed = false;
  Buffer.byteLength = function(value, ...args) {
    if (typeof value === "string" && value.includes('"controller_scope_verified"')) {
      delayed = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2100);
    } return original(value, ...args);
  };
  try { assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket, { ttlMs: 2000 }), /read_expired/); }
  finally { Buffer.byteLength = original; }
  assert.equal(delayed, true);
});
test("controller loss during final response construction is checked again before returning", async (t) => {
  const x = await sealed(t), original = Buffer.byteLength; let closed = false;
  Buffer.byteLength = function(value, ...args) {
    if (typeof value === "string" && value.includes('"controller_scope_verified"')) { closed = true; x.c.close(); }
    return original(value, ...args);
  };
  try { assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket), /controller_unavailable/); }
  finally { Buffer.byteLength = original; }
  assert.equal(closed, true);
});
function rawHash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
test("read-only v5 sessions cannot use legacy native target/coordination primitives", (t) => {
  const f = fixture(t), native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node");
  const count = native.info().live_fds, handle = native.openRecoveryReadRoot(f.root, 600000);
  assert.throws(() => native.inspect(handle, "captures", "2026-10-24", "00000000-0000-4000-8000-000000000201.json"), /read_only_session/);
  assert.throws(() => native.prepareQuarantine(handle, []), /coordination_handle/);
  assert.throws(() => native.coordinationCall(handle, "publish", ".writer.lock", "x"), /coordination_handle/);
  native.closeRoot(handle); assert.equal(native.info().live_fds, count);
});
test("two independently admitted targets stay one complete scope and three targets refuse", async (t) => {
  const f = selectedFixture(t), second = f.inputs[0].source_path.replace("201.json", "202.json"), bytes = Buffer.from("second invented input");
  fs.writeFileSync(join(f.root, second), bytes, { mode: 0o600 }); f.inputs.push({ source_path: second, bytes });
  const mod = await import("../../build/nativeBarRecoveryController.js"), c = mod.createSyntheticNativeBarRecoveryController(); t.after(() => c.close());
  assert.throws(() => c.admit(f.root, [...f.inputs, { source_path: "third", bytes }]), /input_scope/);
  const a = c.admit(f.root, f.inputs); prepareFixture(f, a); const original = c.prepareOriginal(a.admission); publishOriginal(f.root, original); c.sealOriginal(a.admission);
  const r = mod.inspectSyntheticNativeBarRecovery(c.connect(a.admission));
  assert.equal(r.result.status, "planned_only"); assert.equal(r.result.remaining.length, 2); assert.equal(r.bundle.original.manifest.targets.length, 2);
  assert.equal(r.bundle.original.scope.allocation.allocated_bytes, r.view.reserve.allocated_bytes);
});
test("v5 read entry limits cannot be raised beyond the fixed 512-entry ceiling", (t) => {
  const f = fixture(t), reader = api.openSyntheticNativeBarRecoveryReader(f.root); t.after(() => reader.close());
  assert.throws(() => reader.inventory({ limits: { entries: 513 } }), /invalid_read_limits/);
});
test("review: native response limits charge every pinned ancestor instead of fixed root headroom", (t) => {
  const f = fixture(t), deep = join(f.base, ...Array.from({ length: 64 }, (_, i) => `p${i}`));
  fs.mkdirSync(deep, { recursive: true, mode: 0o700 });
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict'; import * as fs from 'node:fs'; import {join} from 'node:path';
    import {openSyntheticNativeBarRecoveryReader} from ${JSON.stringify(new URL("../../build/nativeBarFs.js", import.meta.url).href)};
    const base=fs.mkdtempSync(join(process.env.TMPDIR,'native-bar-fs-synthetic-')); fs.chmodSync(base,0o700);
    fs.writeFileSync(join(base,'.native-bar-fs-synthetic'),'synthetic-fixture-v1\\n',{mode:0o600});
    const root=join(base,'store'); fs.mkdirSync(root,{mode:0o700}); fs.writeFileSync(join(root,'policy.json'),${JSON.stringify(policy)},{mode:0o600});
    const reader=openSyntheticNativeBarRecoveryReader(root);
    try { const snapshot=reader.inventory(); assert.ok(Buffer.byteLength(JSON.stringify(snapshot.report))>20000); snapshot.close();
      assert.throws(()=>reader.inventory({limits:{response_bytes:20000}}),/inventory_response_limit/);
    } finally { reader.close(); }
  `], { env: { ...process.env, TMPDIR: deep }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
test("the v5 inventory is complete at 512 entries and refuses the next entry without truncation", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 511; ++i) fs.writeFileSync(join(f.root, `side-${i}`), "x", { mode: 0o600 });
  const reader = api.openSyntheticNativeBarRecoveryReader(f.root); t.after(() => reader.close());
  const snapshot = reader.inventory(); assert.equal(snapshot.report.entries.length, 512); snapshot.close();
  fs.writeFileSync(join(f.root, "one-more"), "x", { mode: 0o600 }); assert.throws(() => reader.inventory(), /inventory_entry_limit/);
  assert.equal(fs.readdirSync(f.root).length, 513);
});
test("native read budgets include the profile read and cannot reset with another snapshot", (t) => {
  const f = fixture(t), reader = api.openSyntheticNativeBarRecoveryReader(f.root); t.after(() => reader.close());
  const snapshot = reader.inventory({ limits: { read_bytes: 2 * Buffer.byteLength(policy) } });
  const index = snapshot.report.entries.findIndex((e) => e.path === "policy.json");
  snapshot.readEvidence(index); assert.throws(() => snapshot.readEvidence(index), /read_budget/); snapshot.close();
  const next = reader.inventory({ limits: { read_bytes: 2 * Buffer.byteLength(policy) } });
  assert.throws(() => next.readEvidence(index), /read_budget/); next.close();
});
for (const where of ["root", "parent", "target", "layout"]) test(`full native ACL binding refuses a ${where} deny-only ACL change`, async (t) => {
  const x = await sealed(t), path = where === "root" ? x.root : where === "parent" ? join(x.root, "captures/2026-10-24")
    : where === "layout" ? join(x.root, x.original.plan.layout.directories[2]) : join(x.root, x.inputs[0].source_path);
  assert.equal(spawnSync("/bin/chmod", ["+a", "everyone deny write", path]).status, 0);
  assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket), /native_binding_changed|layout_directory_changed/);
  assert.deepEqual(fs.readFileSync(join(x.root, x.inputs[0].source_path)), x.inputs[0].bytes);
});
for (const phase of ["inventory_between_passes", "read_after_bytes", "verify_before_scan"]) test(`v5 descriptor view rejects concurrent file changes at ${phase}`, (t) => {
  const f = selectedFixture(t), reader = api.openSyntheticNativeBarRecoveryReader(f.root); t.after(() => reader.close());
  const change = (at, path) => { if (at === phase && (phase !== "read_after_bytes" || path === f.inputs[0].source_path)) fs.appendFileSync(join(f.root, f.inputs[0].source_path), "changed"); };
  if (phase === "inventory_between_passes") assert.throws(() => reader.inventory({ hook: change }), /inventory_changed/);
  else {
    const snapshot = reader.inventory();
    if (phase === "read_after_bytes") assert.throws(() => snapshot.readEvidence(snapshot.report.entries.findIndex((e) => e.path === f.inputs[0].source_path), change), /read_changed/);
    else assert.throws(() => snapshot.verify(change), /inventory_changed/);
    snapshot.close();
  }
  assert.ok(fs.readFileSync(join(f.root, f.inputs[0].source_path), "utf8").endsWith("changed"));
});
for (const kind of ["symlink", "hardlink"]) test(`unqualified ${kind} files never become recovery evidence or change their victim`, async (t) => {
  const x = await sealed(t), victim = join(x.base, "victim"), path = join(x.root, "untrusted-side-file");
  fs.writeFileSync(victim, "outside store", { mode: 0o600 }); if (kind === "symlink") fs.symlinkSync(victim, path); else fs.linkSync(victim, path);
  assert.throws(() => x.mod.inspectSyntheticNativeBarRecovery(x.ticket), /unqualified_entry/);
  assert.equal(fs.readFileSync(victim, "utf8"), "outside store"); assert.equal(fs.existsSync(path), true);
});
test("old v1 and v4 high-level writers refuse v5 before data actions", async (t) => {
  const f = selectedFixture(t), h = new NativeBarHistory({ directory: f.root, testOnly: { allowTemporaryRoot: true } });
  await assert.rejects(h.status("00000000-0000-4000-8000-000000000201"), /policy/);
  const old = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => old.close());
  assert.throws(() => old.prepare([2]), /synthetic_profile_required/);
  assert.deepEqual(fs.readFileSync(join(f.root, f.inputs[0].source_path)), f.inputs[0].bytes);
  assert.equal(fs.existsSync(join(f.root, "maintenance")), false);
});
test("an already waiting v4 invocation cannot continue after the fixture policy becomes v5", async (t) => {
  const f = selectedFixture(t), source = f.inputs[0].source_path;
  fs.writeFileSync(join(f.root, "policy.json"), '{"schema":"native-bar-synthetic-quarantine-profile-v4"}');
  fs.writeFileSync(join(f.root, ".writer.lock"), canonical({ pid: process.pid, token: randomUUID() }), { mode: 0o600 });
  const old = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => old.close());
  const plan = old.prepare([3]), approval = old.approveForSyntheticTest(plan.plan_id, plan.plan_hash);
  const pending = old.execute(plan.plan_id, plan.plan_hash, approval, { waitMs: 1000 }).then(() => null, (e) => e);
  let queued = false;
  for (let i = 0; i < 400 && !queued; ++i) { queued = fs.readdirSync(f.root).some((p) => p.startsWith(".writer-ticket-")); if (!queued) await new Promise((r) => setTimeout(r, 5)); }
  assert.equal(queued, true); fs.writeFileSync(join(f.root, "policy.json"), policy);
  const error = await pending; assert.ok(error instanceof Error); assert.match(error.message, /changed|busy|baseline/);
  assert.deepEqual(fs.readFileSync(join(f.root, source)), f.inputs[0].bytes); assert.equal(fs.existsSync(join(f.root, "maintenance")), false);
});
test("a surviving v5 completion binds its native attempt-specific marker and remains read-only", async (t) => {
  const x = await sealed(t), state = seedAttempt(x), o = x.original, target = o.plan.targets[0];
  const held = `maintenance-hold/${o.intent.maintenance_id}/${target.target_id}`, final = `quarantine/abandoned/${o.intent.maintenance_id}/${target.target_id}`;
  seedEvent(x, state, "move_pending", target.proof); fs.renameSync(join(x.root, target.source_path), join(x.root, held));
  const heldProof = baseProof(nativeProof(x.root, held)); seedEvent(x, state, "held_verified", heldProof); seedEvent(x, state, "quarantine_move_pending", heldProof);
  fs.renameSync(join(x.root, held), join(x.root, final)); const finalProof = baseProof(nativeProof(x.root, final)); seedEvent(x, state, "quarantined_verified", finalProof);
  const before = Date.now(), targets = [{ target_id: target.target_id, proof: finalProof }];
  const marker = { schema: "native-bar-recovery-timestamp-v5", maintenance_id: o.intent.maintenance_id, attempt_id: state.attempt.attempt_id,
    intent_hash: hash(o.intent), last_event_hash: hash(state.events.at(-1)), targets,
    verified_at: new Date(before).toISOString() };
  const path = `quarantine/abandoned/${o.intent.maintenance_id}/${state.attempt.attempt_id}.timestamp.json`;
  fs.writeFileSync(join(x.root, path), canonical(marker), { mode: 0o600 });
  const { allocated_bytes, ...proof } = nativeProof(x.root, path); void allocated_bytes; const after = Date.now();
  assert.ok(BigInt(proof.ctime_ns) <= BigInt(after) * 1000000n + 999999n);
  await new Promise((r) => setTimeout(r, Math.max(0, after - Date.now() + 1)));
  const attempt = JSON.parse(fs.readFileSync(join(x.root, `maintenance/${o.intent.maintenance_id}.attempts/${state.attempt.attempt_id}.json`), "utf8"));
  const completion = { schema: "native-bar-recovery-completion-v5", maintenance_id: o.intent.maintenance_id, intent_hash: hash(o.intent),
    last_event_hash: hash(state.events.at(-1)), published_attempt_hashes: [hash(attempt)], used_attempt_hashes: [hash(state.attempt)],
    final_attempt_id: state.attempt.attempt_id, clock: { utc_at: new Date().toISOString(), elapsed: null }, marker: { path, hash: hash(marker), proof,
      publication: { before: { utc_at: new Date(before).toISOString(), elapsed: null }, after: { utc_at: new Date(after).toISOString(), elapsed: null } } }, targets };
  fs.writeFileSync(join(x.root, `maintenance/${o.intent.maintenance_id}.done.json`), canonical(completion), { mode: 0o600 });
  const r = x.mod.inspectSyntheticNativeBarRecovery(x.ticket);
  assert.equal(r.result.status, "complete_read_only"); assert.equal(r.result.recorded_status, "complete");
  assert.equal(r.original_acknowledgement, "not_proven"); assert.equal(r.recovery_execution_available, false); assert.deepEqual(r.result.remaining, []);
  fs.truncateSync(join(x.root, o.plan.layout.reserve_path), 1);
  const changed = x.mod.inspectSyntheticNativeBarRecovery(x.ticket);
  assert.equal(changed.result.recorded_status, "complete"); assert.equal(changed.result.status, "blocked");
  assert.equal(changed.controller_scope_verified, false); assert.ok(changed.result.blocking_reasons.includes("original_allocation_unverified"));
});
