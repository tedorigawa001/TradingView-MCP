import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { canonical, evidenceHash } from "../../build/nativeBarEvidence.js";
import { createSyntheticNativeBarRecoveryController, inspectSyntheticNativeBarRecovery } from "../../build/nativeBarRecoveryController.js";
import { createSyntheticNativeBarRecoveryExecution } from "../../build/nativeBarRecoveryExecution.js";

function fixture(t, count = 1, size) {
  const base = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "native-bar-fs-synthetic-")); fs.chmodSync(base, 0o700);
  fs.writeFileSync(join(base, ".native-bar-fs-synthetic"), "synthetic-fixture-v1\n", { mode: 0o600 });
  const root = join(base, "store"); fs.mkdirSync(root, { mode: 0o700 });
  fs.writeFileSync(join(root, "policy.json"), '{"schema":"native-bar-synthetic-quarantine-recovery-profile-v5"}', { mode: 0o600 });
  fs.mkdirSync(join(root, "captures/2026-10-24"), { recursive: true, mode: 0o700 });
  const inputs = Array.from({ length: count }, (_, i) => ({ source_path: `captures/2026-10-24/00000000-0000-4000-8000-${String(201 + i).padStart(12, "0")}.json`,
    bytes: size ? Buffer.alloc(size, String(i)) : Buffer.from(`invented independent input ${i}\n`) }));
  for (const input of inputs) fs.writeFileSync(join(root, input.source_path), input.bytes, { mode: 0o600 });
  const controller = createSyntheticNativeBarRecoveryController(), engines = [];
  t.after(() => { try { for (const e of engines) e.close(); } finally { controller.close(); fs.rmSync(base, { recursive: true, force: true }); } });
  const admission = controller.admit(root, inputs), helper = join(base, "reserve-setup");
  const compiled = spawnSync("/usr/bin/xcrun", ["clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror", fileURLToPath(new URL("./recoveryReserveFixture.cc", import.meta.url)), "-o", helper], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(spawnSync(helper, [root, admission.plan.layout.reserve_path, admission.capacity.peak_bytes]).status, 0);
  for (const path of admission.plan.layout.directories) fs.mkdirSync(join(root, path), { recursive: true, mode: 0o700 });
  const original = controller.prepareOriginal(admission.admission), layout = original.plan.layout;
  fs.writeFileSync(join(root, `maintenance/${layout.maintenance_id}.manifest/${layout.chunk_id}.json`), canonical(original.manifest), { mode: 0o600 });
  fs.writeFileSync(join(root, `maintenance/${layout.maintenance_id}.json`), canonical(original), { mode: 0o600 });
  controller.sealOriginal(admission.admission);
  return { base, root, inputs, original, controller, admission,
    open() { const e = createSyntheticNativeBarRecoveryExecution(controller.connectExecutionForSyntheticTest(admission.admission)); engines.push(e); return e; },
    inspect: () => inspectSyntheticNativeBarRecovery(controller.connect(admission.admission)) };
}
async function begin(x, options) {
  const e = x.open(), p = e.prepare(), a = p.attempt_plan;
  const approval = e.approveForSyntheticTest(a.plan_id, a.plan_hash); await e.begin(a.plan_id, a.plan_hash, approval, options); return { e, p };
}
function finish(e) { let r; for (let i = 0; i < 30; ++i) { r = e.step(); if (r.state.finished) return r; } assert.fail("finite step list did not finish"); }
test("R-C native fixed steps complete one invented target with observed marker publication in completion", async (t) => {
  const x = fixture(t), before = fs.readdirSync(x.root), e = x.open(), p = e.prepare(), a = p.attempt_plan;
  assert.deepEqual(fs.readdirSync(x.root), before); assert.equal(p.execution_available, false);
  const approval = e.approveForSyntheticTest(a.plan_id, a.plan_hash); await e.begin(a.plan_id, a.plan_hash, approval);
  let result; for (let i = 0; i < 20; ++i) { result = e.step(); if (result.state.finished) break; }
  assert.equal(result.state.finished, true); assert.equal(result.cleanup.coordination_released, true);
  const observed = x.inspect(); assert.equal(observed.result.status, "complete_read_only");
  const target = x.original.manifest.targets[0], final = join(x.root, `quarantine/abandoned/${x.original.intent.maintenance_id}/${target.target_id}`);
  assert.deepEqual(fs.readFileSync(final), x.inputs[0].bytes); assert.equal(fs.existsSync(join(x.root, target.source_path)), false);
  assert.equal(observed.bundle.markers[0].record.publication, undefined);
  assert.ok(observed.bundle.completion.marker.publication.after.utc_at >= observed.bundle.markers[0].record.verified_at);
  assert.equal(observed.original_acknowledgement, "not_proven");
});
test("R-C late target flag changes cannot become a verified move", async (t) => {
  const x = fixture(t); let changed = false;
  const { e } = await begin(x, { hook(phase) { if (phase === "before_rename" && !changed) {
    changed = true; assert.equal(spawnSync("/usr/bin/chflags", ["hidden", join(x.root, x.inputs[0].source_path)]).status, 0);
  } } });
  e.step(); e.step(); assert.throws(() => e.step(), /recovery_target_flags/); assert.equal(changed, true);
});
test("R-C two-target display edits cannot change the native fixed scope or schedule", async (t) => {
  const x = fixture(t, 2), e = x.open(), p = e.prepare(), a = p.attempt_plan;
  p.native.steps.length = 0; p.attempt_plan.actions.length = 0;
  await e.begin(a.plan_id, a.plan_hash, e.approveForSyntheticTest(a.plan_id, a.plan_hash)); finish(e);
  const observed = x.inspect(); assert.equal(observed.result.status, "complete_read_only"); assert.equal(observed.bundle.completion.targets.length, 2);
  for (const target of x.original.manifest.targets) assert.equal(fs.existsSync(join(x.root, target.source_path)), false);
});
test("R-C approvals are issuer-bound, opaque and single-use before any writer wait", async (t) => {
  const x = fixture(t), first = x.open(), second = x.open(), p = first.prepare(), q = second.prepare(), a = p.attempt_plan, b = q.attempt_plan;
  const approval = first.approveForSyntheticTest(a.plan_id, a.plan_hash);
  await assert.rejects(first.begin(a.plan_id, a.plan_hash, structuredClone(approval)), /approval_required/);
  await assert.rejects(second.begin(b.plan_id, b.plan_hash, approval), /approval_required/);
  assert.throws(() => first.approveForSyntheticTest(a.plan_id, "0".repeat(64)), /binding/);
  await first.begin(a.plan_id, a.plan_hash, approval); first.close();
  await assert.rejects(first.begin(a.plan_id, a.plan_hash, approval), /closed/);
  const next = x.open().prepare(); assert.equal(next.attempt_plan.ordinal, 3);
});
for (const stop of [0, 1, 2, 3, 4, 5, 6, 7, 8]) test(`R-C reopens the native remaining plan after acknowledged prefix step ${stop}`, async (t) => {
  const x = fixture(t), { e } = await begin(x); for (let i = 0; i < stop; ++i) e.step(); e.close();
  const old = x.inspect(), preserved = old.bundle.markers.map((m) => canonical(m));
  const { e: next, p } = await begin(x); assert.equal(p.attempt_plan.ordinal, 3); const moves = p.native.steps.filter((s) => s.kind === "stage" || s.kind === "quarantine").length;
  assert.equal(moves, stop >= 6 ? 0 : stop >= 3 ? 1 : 2);
  finish(next); const observed = x.inspect(); assert.equal(observed.result.status, "complete_read_only");
  assert.equal(observed.bundle.attempts.at(-1).ordinal, 3);
  for (let i = 0; i < preserved.length; ++i) assert.equal(canonical(observed.bundle.markers[i]), preserved[i]);
  assert.equal(observed.bundle.markers.at(-1).record.attempt_id, x.original.plan.layout.attempt_ids[2]);
  if (stop >= 2) assert.equal(observed.bundle.events.find((e) => e.attempt_id === x.original.plan.layout.attempt_ids[2]).type, "recovered_verified");
});
test("R-C an interrupted metadata temporary is preserved and another ordinal uses a different slot", async (t) => {
  const x = fixture(t); let injected = false;
  const { e } = await begin(x, { hook(phase) { if (phase === "after_write_metadata" && !injected) { injected = true; throw new Error("synthetic_publication_failure"); } } });
  assert.throws(() => e.step(), /synthetic_publication_failure/);
  const temps = fs.readdirSync(x.root).filter((p) => p.startsWith(".publication-")); assert.equal(temps.length, 1);
  const bytes = fs.readFileSync(join(x.root, temps[0])); assert.ok(bytes.length > 0);
  const { e: next } = await begin(x); finish(next); assert.deepEqual(fs.readFileSync(join(x.root, temps[0])), bytes);
  assert.equal(x.inspect().result.status, "complete_read_only");
});
test("R-C post-move interruption preserves pending evidence; the next attempt reconciles it once", async (t) => {
  const x = fixture(t); let injected = false;
  const { e } = await begin(x, { hook(phase) { if (phase === "after_move" && !injected) { injected = true; throw new Error("synthetic_after_move"); } } });
  e.step(); e.step(); assert.throws(() => e.step(), /synthetic_after_move/);
  assert.equal(fs.existsSync(join(x.root, x.inputs[0].source_path)), false);
  const { e: next, p } = await begin(x); assert.equal(p.remaining[0].location, "holding");
  finish(next); const observed = x.inspect(); assert.equal(observed.result.status, "complete_read_only");
  assert.equal(observed.bundle.events.filter((e) => e.type === "recovered_verified").length, 1);
});
test("R-C a contending writer after approval consumes the ordinal without changing data", async (t) => {
  const x = fixture(t), e = x.open(), p = e.prepare(), a = p.attempt_plan, approval = e.approveForSyntheticTest(a.plan_id, a.plan_hash);
  const body = canonical({ pid: process.pid, token: "00000000-0000-4000-8000-000000000999" });
  fs.writeFileSync(join(x.root, ".writer.lock"), body, { mode: 0o600 });
  await assert.rejects(e.begin(a.plan_id, a.plan_hash, approval, { waitMs: 20 }), /baseline|changed|busy/);
  assert.equal(fs.readFileSync(join(x.root, ".writer.lock"), "utf8"), body); fs.unlinkSync(join(x.root, ".writer.lock"));
  assert.deepEqual(fs.readFileSync(join(x.root, x.inputs[0].source_path)), x.inputs[0].bytes);
  const next = x.open().prepare(); assert.equal(next.attempt_plan.ordinal, 3);
});
for (const change of ["controller", "deadline", "reference", "reserve", "second-target"]) test(`R-C stops before another step on ${change} loss/drift`, async (t) => {
  const x = fixture(t, change === "second-target" ? 2 : 1), { e } = await begin(x); const before = fs.readdirSync(join(x.root, "maintenance"));
  const now = Date.now;
  try {
    if (change === "controller") x.controller.close();
    if (change === "deadline") Date.now = () => now() + 600001;
    if (change === "reference") fs.writeFileSync(join(x.root, "unknown"), "preserve", { mode: 0o600 });
    if (change === "reserve") fs.truncateSync(join(x.root, x.original.plan.layout.reserve_path), 1);
    if (change === "second-target") fs.appendFileSync(join(x.root, x.inputs[1].source_path), "changed");
    assert.throws(() => e.step(), /controller|expired|changed|allocation|clock/);
    assert.equal(fs.existsSync(join(x.root, ".writer.lock")), false);
  } finally { Date.now = now; e.close(); }
  assert.deepEqual(fs.readdirSync(join(x.root, "maintenance")), before);
  assert.deepEqual(fs.readFileSync(join(x.root, x.inputs[0].source_path)), x.inputs[0].bytes);
});
test("R-C exhausted ordinals never get another execution opportunity", async (t) => {
  const x = fixture(t); const { e } = await begin(x); e.close(); const { e: second } = await begin(x); second.close();
  assert.throws(() => x.open().prepare(), /exhausted/); assert.deepEqual(fs.readFileSync(join(x.root, x.inputs[0].source_path)), x.inputs[0].bytes);
});
test("R-C mixed two-target recovery verifies the already-final target and retains the untouched target", async (t) => {
  const x = fixture(t, 2), { e } = await begin(x); for (let i = 0; i < 7; ++i) e.step(); e.close();
  const { e: next, p } = await begin(x); assert.deepEqual(p.remaining.map((v) => v.location), ["quarantine", "source"]);
  assert.equal(p.native.steps.filter((s) => s.kind === "stage" || s.kind === "quarantine").length, 2);
  finish(next); assert.equal(x.inspect().result.status, "complete_read_only");
});
test("R-C a new collision is preserved without an attempted overwrite", async (t) => {
  const x = fixture(t), { e } = await begin(x), path = `maintenance/${x.original.intent.maintenance_id}.attempts/${x.original.plan.layout.attempt_ids[1]}.json`;
  fs.writeFileSync(join(x.root, path), "preserve collision", { mode: 0o600 }); assert.throws(() => e.step(), /quarantine_parent_changed/);
  assert.equal(fs.readFileSync(join(x.root, path), "utf8"), "preserve collision");
});
test("R-C excess inventory aborts the consumed invocation without publishing owned coordination", async (t) => {
  const x = fixture(t), e = x.open(), p = e.prepare(), a = p.attempt_plan, approval = e.approveForSyntheticTest(a.plan_id, a.plan_hash);
  for (let i = 0; i < 520; ++i) fs.writeFileSync(join(x.root, `side-${i}`), "preserve", { mode: 0o600 });
  await assert.rejects(e.begin(a.plan_id, a.plan_hash, approval), /inventory_entry_limit/);
  assert.equal(fs.readdirSync(x.root).some((p) => p.startsWith(".writer")), false);
});
test("R-C step accepts no caller path, phase counter or metadata payload", async (t) => {
  const x = fixture(t), { e } = await begin(x), before = fs.readdirSync(join(x.root, "maintenance"));
  assert.throws(() => e.step("quarantine", 99, { path: "outside" }), /no_caller_paths_phases_or_payload/);
  assert.deepEqual(fs.readdirSync(join(x.root, "maintenance")), before); e.close();
});
test("R-C native program mismatch refuses rather than accepting supplied action counters", async (t) => {
  const x = fixture(t), e = x.open(), prepared = e.prepare(), audit = structuredClone(prepared.attempt_plan); e.close();
  const { openSyntheticNativeBarRecoveryIo } = await import("../../build/nativeBarFs.js"); const io = openSyntheticNativeBarRecoveryIo(x.root);
  try {
    const window = io.window(); audit.opened_at = window.opened_at; audit.expires_at = window.expires_at; audit.issued_at = new Date().toISOString();
    const snapshot = x.inspect(); audit.observed_at = snapshot.view.observed_at; audit.actions = [];
    const fields = { ...audit }; delete fields.plan_hash; audit.plan_hash = evidenceHash(fields);
    assert.throws(() => io.prepare(Buffer.from(canonical(x.original)), Buffer.from(canonical(snapshot.bundle)), Buffer.from(canonical(audit))), /native_action_scope/);
  } finally { io.close(); }
});
test("R-C maximum-size two-target hashing fits the retained read and physical budgets", async (t) => {
  const x = fixture(t, 2, 1048576), { e } = await begin(x); finish(e);
  const r = x.inspect(); assert.equal(r.result.status, "complete_read_only");
  assert.equal(r.view.reserve.allocated_bytes, x.original.scope.allocation.allocated_bytes);
});
test("R-C a lost completion response cannot cause another attempt or another move", async (t) => {
  const x = fixture(t), { e } = await begin(x, { hook(phase, path) { if (phase === "before_response" && path === "completion") throw new Error("synthetic_response_loss"); } });
  assert.throws(() => finish(e), /synthetic_response_loss/);
  assert.equal(x.inspect().result.status, "complete_read_only"); const before = fs.readdirSync(x.root);
  assert.throws(() => x.open().prepare(), /prepare_blocked/); assert.deepEqual(fs.readdirSync(x.root), before);
});
test("R-C native root modes and reader handles cannot be promoted to recovery execution", async (t) => {
  const x = fixture(t), { createRequire } = await import("node:module"), native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node");
  const reader = native.openRecoveryReadRoot(x.root, 600000), legacy = native.openCoordination(x.root, 600000);
  try {
    assert.throws(() => native.prepareRecovery(reader, Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)), /recovery_coordination_required/);
    assert.throws(() => native.prepareRecovery(legacy, Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)), /recovery_coordination_required/);
  } finally { native.closeRoot(reader); native.coordinationCall(legacy, "close", undefined, undefined); }
});
test("R-C explicit close releases native descriptors without creating a journal or approval effects", async (t) => {
  const { createRequire } = await import("node:module"), native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node");
  const before = native.info().live_fds, x = fixture(t), names = fs.readdirSync(x.root), e = x.open(); e.prepare();
  assert.ok(native.info().live_fds > before); assert.equal(e.close().coordination_released, true);
  assert.equal(native.info().live_fds, before); assert.deepEqual(fs.readdirSync(x.root), names);
});
