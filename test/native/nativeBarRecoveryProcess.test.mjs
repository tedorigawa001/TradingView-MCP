import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { fixture } from "./recoveryProcessFixture.mjs";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createSyntheticNativeBarRecoveryProcess, prepareSyntheticNativeBarWorkerRetirement } from "../../build/nativeBarRecoveryProcess.js";
import { canonical } from "../../build/nativeBarEvidence.js";
async function begin(x, options, initial = false) {
  const p = await x.open(options, initial), display = await p.prepare(), a = display.attempt_plan;
  await p.begin(a.plan_id, a.plan_hash, await p.approveForSyntheticTest(a.plan_id, a.plan_hash)); return { p, display };
}
async function finish(p) { for (let i = 0; i < 30; ++i) { const r = await p.step(); if (r.state.finished) return r; } assert.fail("finite worker steps did not finish"); }
async function retire(x, p) {
  const r = await prepareSyntheticNativeBarWorkerRetirement(x.controller.connectExecutionForSyntheticTest(x.admission.admission), p.workerPid);
  try { return await r.execute(r.plan.plan_id, r.plan.plan_hash, r.approveForSyntheticTest(r.plan.plan_id, r.plan.plan_hash)); } finally { r.close(); }
}
function positions(x) {
  return x.original.manifest.targets.map((t, i) => {
    const paths = [t.source_path, `maintenance-hold/${x.original.intent.maintenance_id}/${t.target_id}`, `quarantine/abandoned/${x.original.intent.maintenance_id}/${t.target_id}`];
    const present = paths.map((path, place) => fs.existsSync(join(x.root, path)) ? { path, place } : null).filter(Boolean);
    assert.equal(present.length, 1); const { path, place } = present[0], stat = fs.lstatSync(join(x.root, path), { bigint: true });
    assert.equal(String(stat.ino), t.proof.inode); assert.equal(String(stat.dev), t.proof.device);
    assert.deepEqual(fs.readFileSync(join(x.root, path)), x.inputs[i].bytes); return place;
  });
}

test("R-D an inherited private channel connects native worker steps to the surviving controller", async (t) => {
  const x = fixture(t), { p } = await begin(x); assert.notEqual(p.workerPid, process.pid);
  const result = await finish(p); assert.equal(result.state.finished, true); await p.close();
  assert.equal(x.inspect().result.status, "complete_read_only");
  assert.equal(result.execution_available, false); assert.equal(result.original_acknowledgement, "not_proven");
});
test("R-D SIGKILL after a move preserves pending evidence and a fresh approved process performs only remaining work", async (t) => {
  const x = fixture(t); let killed = false;
  const { p } = await begin(x, { hook(phase, _path, pid) { if (phase === "after_move" && !killed) { killed = true; process.kill(pid, "SIGKILL"); } } });
  await assert.rejects(finish(p), /worker_exited/); await p.close();
  assert.equal(fs.existsSync(join(x.root, x.inputs[0].source_path)), false);
  const { prepareSyntheticNativeBarWorkerRetirement } = await import("../../build/nativeBarRecoveryProcess.js");
  const r = await prepareSyntheticNativeBarWorkerRetirement(x.controller.connectExecutionForSyntheticTest(x.admission.admission), p.workerPid);
  const approval = r.approveForSyntheticTest(r.plan.plan_id, r.plan.plan_hash); await r.execute(r.plan.plan_id, r.plan.plan_hash, approval);
  const { p: next, display } = await begin(x); assert.equal(display.attempt_plan.ordinal, 3);
  assert.equal(display.remaining[0].location, "holding"); await finish(next); await next.close();
  const observed = x.inspect(); assert.equal(observed.result.status, "complete_read_only");
  assert.equal(observed.bundle.events.filter((e) => e.type === "recovered_verified").length, 1);
});
test("R-D the original worker spends ordinal one within the sealed original window", async (t) => {
  const x = fixture(t, 2), { createSyntheticNativeBarInitialProcess } = await import("../../build/nativeBarRecoveryProcess.js");
  const p = await createSyntheticNativeBarInitialProcess(x.controller.connectExecutionForSyntheticTest(x.admission.admission)); x.processes.push(p);
  const display = await p.prepare(), a = display.attempt_plan;
  assert.equal(a.ordinal, 1); assert.equal(a.opened_at, x.original.plan.opened_at); assert.equal(a.expires_at, x.original.plan.expires_at);
  await p.begin(a.plan_id, a.plan_hash, await p.approveForSyntheticTest(a.plan_id, a.plan_hash)); await finish(p); await p.close();
  const observed = x.inspect(); assert.equal(observed.result.status, "complete_read_only");
  assert.equal(observed.bundle.attempts[0].attempt.approval_plan_hash, x.original.plan.plan_hash);
  assert.equal(observed.bundle.events.length, 8);
});
test("R-D the original controller monotonic deadline cannot restart when a worker starts later", async (t) => {
  const x = fixture(t), now = performance.now.bind(performance); let elapsed = 480000;
  const clock = t.mock.method(performance, "now", () => now() + elapsed);
  let p;
  try {
    ({ p } = await begin(x, undefined, true));
    elapsed = 660001;
    await assert.rejects(p.step(), /original_window_expired/);
    assert.deepEqual(positions(x), [0]);
  } finally { clock.mock.restore(); await p?.close(); }
});
test("R-D the original controller deadline is checked again after a native gate callback", async (t) => {
  const x = fixture(t), now = performance.now.bind(performance); let elapsed = 480000, expired = false;
  const clock = t.mock.method(performance, "now", () => now() + elapsed);
  let p;
  try {
    ({ p } = await begin(x, { hook(phase) { if (phase === "before_move") { elapsed = 660001; expired = true; } } }, true));
    await p.step(); await p.step();
    await assert.rejects(p.step(), /original_window_expired/);
    assert.equal(expired, true); assert.deepEqual(positions(x), [0]);
  } finally { clock.mock.restore(); await p?.close(); }
});
test("R-D recovery has its own window after the original controller monotonic deadline", async (t) => {
  const x = fixture(t), now = performance.now.bind(performance);
  const clock = t.mock.method(performance, "now", () => now() + 660001);
  let p;
  try {
    let display; ({ p, display } = await begin(x)); assert.equal(display.attempt_plan.ordinal, 2);
    await finish(p); assert.deepEqual(positions(x), [2]);
  } finally { clock.mock.restore(); await p?.close(); }
});
test("R-D repeated close preserves the actual cleanup result and leaves no worker running", async (t) => {
  const x = fixture(t), { p } = await begin(x); const first = await p.close(), second = await p.close();
  assert.equal(first.coordination_released, true); assert.deepEqual(second, first);
  assert.throws(() => process.kill(p.workerPid, 0), { code: "ESRCH" });
});
test("R-D close has a bounded cleanup grace after the transport execution deadline", async (t) => {
  const x = fixture(t), { p } = await begin(x), now = performance.now.bind(performance);
  const clock = t.mock.method(performance, "now", () => now() + 600001);
  try { assert.equal((await p.close()).coordination_released, true); }
  finally { clock.mock.restore(); await p.close().catch(() => {}); }
  assert.equal(fs.readdirSync(x.root).some((name) => name.startsWith(".writer")), false);
});
for (const mode of ["read", "write"]) test(`R-D an unanswered inherited socket reaches its own monotonic deadline during ${mode}`, { timeout: 10000 }, async (t) => {
  const child = fork(new URL("./recoveryChannelDeadline.mjs", import.meta.url), [], { execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc", "pipe"] });
  const exited = once(child, "exit"), result = once(child, "message");
  t.after(async () => { child.kill("SIGKILL"); await exited; });
  const request = mode === "read" ? once(child.stdio[4], "data") : undefined;
  child.send({ nonce: "00000000-0000-4000-8000-000000000999", parent: process.pid, mode });
  await request;
  let timer;
  try {
    const response = await Promise.race([result, new Promise((resolve) => { timer = setTimeout(() => resolve([{ error: "still_waiting" }]), 1000); })]);
    assert.match(response[0].error, /channel_lost_or_expired/);
  } finally { clearTimeout(timer); }
});
test("R-D rejects a second simultaneous worker before forking and releases its admission slot on exit", async (t) => {
  const x = fixture(t), first = await x.open();
  await assert.rejects(x.open(), /worker_limit/); await first.close();
  const next = await x.open(); assert.notEqual(next.workerPid, first.workerPid); await next.close();
});
test("R-D retirement binds the approved native proof even if a same-body replacement appears after preview", async (t) => {
  const x = fixture(t), { p } = await begin(x); process.kill(p.workerPid, "SIGKILL"); await p.waitForExit(); await p.close();
  const { syntheticNativeBarRecoveryExecutionOwner } = await import("../../build/nativeBarRecoveryController.js"), { openSyntheticNativeBarRecoveryRetirementIo } = await import("../../build/nativeBarFs.js");
  const owner = syntheticNativeBarRecoveryExecutionOwner(x.controller.connectExecutionForSyntheticTest(x.admission.admission)), entry = owner.workerCoordination(p.workerPid).find((e) => e.path === ".writer.lock");
  const io = openSyntheticNativeBarRecoveryRetirementIo(x.root);
  try {
    fs.renameSync(join(x.root, entry.path), join(x.base, "preserved-original-coordination"));
    fs.writeFileSync(join(x.root, entry.path), entry.body, { mode: 0o600 });
    await assert.rejects(io.retire(entry.path, entry.body, Buffer.from(canonical(entry.proof))), /recovery_retirement_(?:proof|changed)/);
    assert.equal(fs.readFileSync(join(x.root, entry.path), "utf8"), entry.body);
  } finally { io.close(); }
});
for (const kind of ["roots", "descriptors"]) test(`R-D the broker counts parent and worker ${kind} before a data publication`, async (t) => {
  const x = fixture(t), { createRequire } = await import("node:module"), native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node"), roots = [], targets = [];
  let injected = false;
  const { p } = await begin(x, { hook(phase) {
    if (phase !== "before_create_metadata" || injected) return; injected = true;
    if (kind === "roots") { for (let i = 0; i < 8; ++i) roots.push(native.openRecoveryReadRoot(x.root, 600000)); }
    else {
      let limited = false;
      for (let i = 0; i < 7 && !limited; ++i) {
        const root = native.openRoot(x.root, 600000); roots.push(root);
        for (let j = 0; j < 32; ++j) {
          try { targets.push(native.inspect(root, "captures", "2026-10-25", x.inputs[0].source_path.split("/").at(-1))); }
          catch (error) { assert.match(error.message, /native_fd_limit/); limited = true; break; }
        }
      }
      assert.equal(limited, true); assert.ok(native.info().live_sessions < 8);
    }
  } });
  try { await assert.rejects(p.step(), /resource_headroom/); await p.close(); assert.equal(injected, true); assert.deepEqual(positions(x), [0]); }
  finally { for (const root of roots) native.closeRoot(root); void targets; }
});
test("R-D two actual interruptions consume original and recovery ordinals, then the final process does not rename a final target again", async (t) => {
  const x = fixture(t, 2);
  for (const initial of [true, false]) {
    let killed = false;
    const { p } = await begin(x, { hook(phase, path, pid) {
      if (phase === "after_move" && (!initial || path.startsWith("maintenance-hold/")) && !killed) { killed = true; process.kill(pid, "SIGKILL"); }
    } }, initial);
    await assert.rejects(finish(p), /worker_exited/); await p.close(); await retire(x, p);
  }
  const before = positions(x); assert.equal(before[0], 2); let renames = 0;
  const { p, display } = await begin(x, { hook(phase) { if (phase === "before_rename") renames++; } });
  assert.equal(display.attempt_plan.ordinal, 3); const expected = before.reduce((n, place) => n + 2 - place, 0);
  await finish(p); await p.close(); assert.equal(renames, expected); assert.deepEqual(positions(x), [2, 2]);
  assert.deepEqual(x.inspect().bundle.attempts.map((a) => a.ordinal), [1, 2, 3]);
});
for (const at of ["before_response", "before_final_fullsync", "after_final_fullsync"]) test(`R-D surviving completion at ${at} is read-only despite lost response/flush acknowledgement`, async (t) => {
  const x = fixture(t); let killed = false;
  const { p } = await begin(x, { hook(phase, path, pid) {
    if (phase === at && (at !== "before_response" || path === "completion") && !killed) { killed = true; process.kill(pid, "SIGKILL"); }
  } });
  await assert.rejects(finish(p), /worker_exited/); await p.close(); await retire(x, p);
  const before = positions(x); assert.equal(x.inspect().result.status, "complete_read_only");
  const next = await x.open(); await assert.rejects(next.prepare(), /prepare_blocked/); await next.close(); assert.deepEqual(positions(x), before);
});
test("R-D a published older marker is preserved after another process verifies and publishes its own", async (t) => {
  const x = fixture(t); let killed = false;
  const { p } = await begin(x, { hook(phase, path, pid) { if (phase === "after_publish_metadata" && path.endsWith(".timestamp.json") && !killed) { killed = true; process.kill(pid, "SIGKILL"); } } });
  await assert.rejects(finish(p), /worker_exited/); await p.close(); await retire(x, p);
  const old = x.inspect().bundle.markers[0], oldPath = join(x.root, `quarantine/abandoned/${x.original.intent.maintenance_id}/${old.record.attempt_id}.timestamp.json`), bytes = fs.readFileSync(oldPath);
  const { p: next } = await begin(x); await finish(next); await next.close(); assert.deepEqual(fs.readFileSync(oldPath), bytes);
  assert.equal(x.inspect().bundle.markers.length, 2);
});
test("R-D controller closure during a native gate stops movement and copying disk JSON cannot restore authority", async (t) => {
  const x = fixture(t); let closed = false;
  const { p } = await begin(x, { hook(phase) { if (phase === "before_move" && !closed) { closed = true; x.controller.close(); } } });
  await assert.rejects(finish(p), /controller_unavailable/); await p.close(); assert.deepEqual(positions(x), [0]);
  await assert.rejects(createSyntheticNativeBarRecoveryProcess({ root: x.root, original: x.original }), /execution_owner_required/);
});
test("R-D live and suspended workers never qualify for coordination retirement", async (t) => {
  const x = fixture(t), { p } = await begin(x), cap = x.controller.connectExecutionForSyntheticTest(x.admission.admission);
  await assert.rejects(prepareSyntheticNativeBarWorkerRetirement(cap, p.workerPid), /not_proven_dead/);
  process.kill(p.workerPid, "SIGSTOP");
  try { await assert.rejects(prepareSyntheticNativeBarWorkerRetirement(cap, p.workerPid), /not_proven_dead/); assert.deepEqual(positions(x), [0]); }
  finally { process.kill(p.workerPid, "SIGCONT"); await p.close(); }
});
for (const kind of ["body", "reference", "final-record"]) test(`R-D ${kind} drift blocks retirement/recovery without deleting the encountered evidence`, async (t) => {
  const x = fixture(t); let killed = false;
  const { p } = await begin(x, { hook(phase, _path, pid) { if (phase === "after_move" && !killed) { killed = true; process.kill(pid, "SIGKILL"); } } });
  await assert.rejects(finish(p), /worker_exited/); await p.close();
  const path = kind === "body" ? ".writer.lock" : kind === "reference" ? "new-reference" : `maintenance/${x.original.intent.maintenance_id}.events/1.json`;
  fs.writeFileSync(join(x.root, path), "preserve unexpected bytes", { mode: 0o600 });
  await assert.rejects(retire(x, p), /changed|JSON|canonical/); assert.equal(fs.readFileSync(join(x.root, path), "utf8"), "preserve unexpected bytes");
});
test("R-D process and retirement approvals cannot be copied, transferred or reused", async (t) => {
  const x = fixture(t), first = await x.open(), a = (await first.prepare()).attempt_plan;
  const approval = await first.approveForSyntheticTest(a.plan_id, a.plan_hash);
  await first.close(); const second = await x.open(), b = (await second.prepare()).attempt_plan, secondApproval = await second.approveForSyntheticTest(b.plan_id, b.plan_hash);
  await assert.rejects(second.begin(b.plan_id, b.plan_hash, approval), /approval_required/);
  await assert.rejects(second.begin(b.plan_id, b.plan_hash, structuredClone(secondApproval)), /approval_required/);
  await second.begin(b.plan_id, b.plan_hash, secondApproval); process.kill(second.workerPid, "SIGKILL"); await second.waitForExit(); await second.close();
  const r = await prepareSyntheticNativeBarWorkerRetirement(x.controller.connectExecutionForSyntheticTest(x.admission.admission), second.workerPid), token = r.approveForSyntheticTest(r.plan.plan_id, r.plan.plan_hash);
  await assert.rejects(r.execute(r.plan.plan_id, r.plan.plan_hash, structuredClone(token)), /approval_required/);
  await r.execute(r.plan.plan_id, r.plan.plan_hash, token); await assert.rejects(r.execute(r.plan.plan_id, r.plan.plan_hash, token), /closed|consumed/);
});
test("R-D original and two recovery invocations remain spent even when every attempt dies before publication", async (t) => {
  const x = fixture(t);
  for (const ordinal of [1, 2, 3]) {
    let killed = false; const { p, display } = await begin(x, { hook(phase, _path, pid) { if (phase === "before_create_metadata" && !killed) { killed = true; process.kill(pid, "SIGKILL"); } } }, ordinal === 1);
    assert.equal(display.attempt_plan.ordinal, ordinal); await assert.rejects(p.step(), /worker_exited/); await p.close(); await retire(x, p);
  }
  const next = await x.open(); await assert.rejects(next.prepare(), /exhausted/); await next.close(); assert.deepEqual(positions(x), [0]);
});
test("R-D original invocation is single-use and a consumed original approval cannot restart its ordinal", async (t) => {
  const x = fixture(t), { p } = await begin(x, undefined, true); await p.close();
  const next = await x.open(undefined, true), a = (await next.prepare()).attempt_plan;
  await assert.rejects(next.begin(a.plan_id, a.plan_hash, await next.approveForSyntheticTest(a.plan_id, a.plan_hash)), /original_invocation_consumed/); await next.close();
  const { p: recovery, display } = await begin(x); assert.equal(display.attempt_plan.ordinal, 2); await finish(recovery); await recovery.close();
});

test("R-D whole controller process death closes the synchronous gate before the worker can move data", { timeout: 30000 }, async (t) => {
  const controller = fork(new URL("./recoveryControllerDeath.mjs", import.meta.url), [], { execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc", "pipe"] });
  let info; const exited = once(controller, "exit");
  t.after(async () => { controller.kill("SIGKILL"); await exited; if (info) fs.rmSync(info.base, { recursive: true, force: true }); });
  const lines = createInterface({ input: controller.stdio[4] });
  try { info = JSON.parse((await once(lines, "line"))[0]); } finally { lines.close(); }
  assert.match(info.base, /\/native-bar-fs-synthetic-[A-Za-z0-9]{6}$/);
  controller.kill("SIGKILL"); await exited;
  let stopped = false;
  for (let i = 0; i < 100; ++i) {
    const status = spawnSync("/bin/ps", ["-o", "stat=", "-p", String(info.workerPid)], { encoding: "utf8" });
    if (!status.stdout.trim() || status.stdout.trim().startsWith("Z")) { stopped = true; break; }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(stopped, true); assert.equal(fs.existsSync(join(info.root, info.source)), true);
  const events = fs.readdirSync(join(info.root, "maintenance")).find((p) => p.endsWith(".events"));
  const files = fs.readdirSync(join(info.root, "maintenance", events)); assert.deepEqual(files, ["1.json"]);
  assert.equal(JSON.parse(fs.readFileSync(join(info.root, "maintenance", events, files[0]), "utf8")).type, "move_pending");
  await assert.rejects(createSyntheticNativeBarRecoveryProcess({ root: info.root, original_sealed: true }), /execution_owner_required/);
});
test("R-D original C window refuses renewal, future and out-of-range timestamps before publication", async (t) => {
  const x = fixture(t), { createRequire } = await import("node:module"), native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node");
  const c = native.openRecoveryCoordination(x.root, 600000);
  try {
    assert.throws(() => native.bindRecoveryOriginalWindow(c, "9999-01-01T00:00:00.000Z", "9999-01-01T00:10:00.000Z"), /original_window/);
    assert.throws(() => native.bindRecoveryOriginalWindow(c, new Date(Date.now() + 1000).toISOString(), new Date(Date.now() + 601000).toISOString()), /original_window/);
    native.bindRecoveryOriginalWindow(c, x.original.plan.opened_at, x.original.plan.expires_at);
    assert.throws(() => native.bindRecoveryOriginalWindow(c, x.original.plan.opened_at, x.original.plan.expires_at), /original_window/);
    assert.deepEqual(native.recoveryWindow(c), { opened_at: x.original.plan.opened_at, expires_at: x.original.plan.expires_at });
  } finally { native.coordinationCall(c, "close", undefined, undefined); }
});
test("R-D SIGKILL sweep covers every exposed original and pending-recovery publication/move/sync/response gate", async (t) => {
  const probe = fixture(t), helper = probe.setupHelper;
  for (const mode of ["original", "recovery"]) {
    const seed = mode === "original" ? probe : fixture(t, 1, helper), points = [];
    if (mode === "recovery") { const { p } = await begin(seed, undefined, true); for (let i = 0; i < 3; ++i) await p.step(); await p.close(); }
    const { p } = await begin(seed, { hook(phase, path) { points.push({ phase, path }); } }, mode === "original"); await finish(p); await p.close();
    assert.ok(points.length > 100); assert.ok(points.some((p) => p.phase === "before_final_fullsync"));
    for (const [index, point] of points.entries()) {
      let failure;
      await t.test(`${mode} gate ${index + 1}/${points.length} ${point.phase}`, async (s) => {
      try {
      const x = fixture(s, 1, helper);
      if (mode === "recovery") { const { p } = await begin(x, undefined, true); for (let i = 0; i < 3; ++i) await p.step(); await p.close(); }
      let seen = 0, killed = false;
      const { p } = await begin(x, { hook(phase, _path, pid) {
        if (seen++ === index) { assert.equal(phase, point.phase); killed = true; process.kill(pid, "SIGKILL"); }
      } }, mode === "original");
      await assert.rejects(finish(p), /worker_exited/); assert.equal(killed, true); await p.close(); const before = positions(x);
      await retire(x, p); const observed = x.inspect();
      if (observed.result.status === "complete_read_only") {
        const next = await x.open(); await assert.rejects(next.prepare(), /prepare_blocked/); await next.close(); assert.deepEqual(positions(x), before);
      } else {
        let renamed = 0; const { p: next, display } = await begin(x, { hook(phase) { if (phase === "before_rename") renamed++; } });
        assert.equal(display.native.steps.filter((v) => ["stage", "quarantine"].includes(v.kind)).length, 2 - before[0]);
        await finish(next); await next.close(); assert.equal(renamed, 2 - before[0]); assert.deepEqual(positions(x), [2]);
      }
      } catch (error) { failure = error; throw error; }
      });
      if (failure) throw failure;
    }
  }
});
test("R-D a failed step closes its worker at once, releasing the single worker slot", async (t) => {
  const x = fixture(t); let fired = false;
  const { p } = await begin(x, { hook(phase) { if (phase === "before_rename" && !fired) { fired = true; throw new Error("synthetic_parent_refusal"); } } });
  await assert.rejects(finish(p), /synthetic_parent_refusal/);
  await p.waitForExit();
  const next = await x.open(); await next.close();
});
