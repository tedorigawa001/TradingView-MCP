import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { canonical } from "../../build/nativeBarEvidence.js";
import { openSyntheticNativeBarCoordination } from "../../build/nativeBarFs.js";
import { coordinationOwnerDead, takeNativeWriterLockWithIo } from "../../build/nativeBarAccess.js";
import { createSyntheticNativeBarExecutionRegistry } from "../../build/nativeBarMaintenanceExecution.js";

const native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node");
const id = "01234567-89ab-4cde-8fab-0123456789ab";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fixture(t) {
  const base = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "native-bar-fs-synthetic-")); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(join(base, ".native-bar-fs-synthetic"), "synthetic-fixture-v1\n", { mode: 0o600 });
  const root = join(base, "store"); fs.mkdirSync(root, { mode: 0o700 }); return { base, root };
}
function owner(pid = process.pid, extra = {}) { return canonical({ pid, token: id, ...extra }); }
function put(f, name, bytes) { fs.writeFileSync(join(f.root, name), bytes, { mode: 0o600 }); }
function registry(f, ttl) {
  const r = createSyntheticNativeBarExecutionRegistry(f.root, ttl), p = r.prepare("quarantine_abandoned");
  const a = r.approveForSyntheticTest(p.plan_id, p.plan_hash); return { r, p, a, run: (opts) => r.probe(p.plan_id, p.plan_hash, a, opts) };
}
test("synthetic registry binds its native baseline, excludes only owned deltas and returns no execution grant", async (t) => {
  const f = fixture(t); put(f, ".DS_Store", "preserve"); const before = native.info().live_fds;
  const x = registry(f); t.after(() => x.r.close());
  x.p.generation = "0".repeat(64); x.p.targets.push({ path: "../../victim" });
  const result = await x.run();
  assert.equal(result.execution_available, false); assert.equal(result.coordination_released, true);
  assert.equal(result.coordination_delta.entries.length, 3); assert.ok(result.coordination_delta.entries.every((v) => !v.present));
  assert.deepEqual(fs.readdirSync(f.root), [".DS_Store"]); assert.equal(native.info().live_fds, before);
  await assert.rejects(x.run(), /registry_closed|consumed/);
});
test("fixture consent is issuer-bound, not a JSON boolean, and a failed wait consumes the plan", async (t) => {
  const f = fixture(t); put(f, ".writer.lock", owner()); const x = registry(f); t.after(() => x.r.close());
  await assert.rejects(x.r.probe(x.p.plan_id, x.p.plan_hash, { fixture_only: true }), /fixture_approval_required/);
  const other = registry(f); t.after(() => other.r.close());
  await assert.rejects(x.r.probe(x.p.plan_id, x.p.plan_hash, other.a), /fixture_approval_required/);
  await assert.rejects(x.run({ waitMs: 30 }), /store_lock_busy/);
  await assert.rejects(x.run(), /closed|consumed/); assert.equal(fs.readFileSync(join(f.root, ".writer.lock"), "utf8"), owner());
  assert.deepEqual(fs.readdirSync(f.root), [".writer.lock"]);
});
for (const kind of ["unknown", "claim", "file", "acl"]) test(`a concurrent ${kind} change is never hidden by self-delta normalization`, async (t) => {
  const f = fixture(t); put(f, "policy.json", "{}"); const x = registry(f); t.after(() => x.r.close());
  await assert.rejects(x.run({ onLocked() {
    if (kind === "unknown") put(f, "unknown", "preserve");
    if (kind === "claim") put(f, `.writer-claim-${id}.json`, owner());
    if (kind === "file") put(f, "policy.json", "{\"changed\":true}");
    if (kind === "acl") assert.equal(spawnSync("/bin/chmod", ["+a", "everyone allow write", f.root]).status, 0);
  } }), /inventory_changed|writer_baseline_changed|unsafe_acl|coordination_release/);
  if (kind === "acl") spawnSync("/bin/chmod", ["-N", f.root]);
  if (kind === "unknown") assert.equal(fs.readFileSync(join(f.root, "unknown"), "utf8"), "preserve");
});
test("queue expiry uses the original lease and releases only its own publications after timeout", async (t) => {
  const f = fixture(t); put(f, `.writer-claim-${id}.json`, owner());
  const x = registry(f, 150); t.after(() => x.r.close()); const start = performance.now();
  await assert.rejects(x.run({ waitMs: 1000 }), /session_expired|registry_expired/);
  assert.ok(performance.now() - start < 700);
  assert.deepEqual(fs.readdirSync(f.root), [`.writer-claim-${id}.json`]);
});
test("an expired plan is refused before coordination and later preparation cannot renew the root lease", async (t) => {
  const f = fixture(t), r = createSyntheticNativeBarExecutionRegistry(f.root, 70); t.after(() => r.close());
  await sleep(90); assert.throws(() => r.prepare("purge_abandoned"), /expired/); assert.deepEqual(fs.readdirSync(f.root), []);
});
for (const mode of ["malformed", "legacy", "unknown"]) test(`a ${mode} lock owner is never reclaimed by age`, async (t) => {
  const f = fixture(t); const body = mode === "malformed" ? "{" : mode === "legacy" ? owner() : owner(process.pid, { boot: null, start: null });
  put(f, ".writer.lock", body); const x = registry(f); t.after(() => x.r.close());
  await assert.rejects(x.run({ waitMs: 20 }), /store_lock_busy/); assert.equal(fs.readFileSync(join(f.root, ".writer.lock"), "utf8"), body);
});
for (const reason of ["gone", "pid-reused", "boot-changed"]) test(`a ${reason} lock is preserved by retirement and requires a new preview`, async (t) => {
  const f = fixture(t);
  const pid = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout);
  const body = reason === "gone" ? owner(pid) : owner(process.pid, { boot: reason === "boot-changed" ? "000000000000" : null,
    start: reason === "pid-reused" ? "000000000000" : null }); put(f, ".writer.lock", body);
  const x = registry(f); t.after(() => x.r.close()); await assert.rejects(x.run(), /fresh_preview_required/);
  const retired = fs.readdirSync(f.root); assert.equal(retired.length, 1); assert.match(retired[0], /^\.writer-retired-/);
  assert.equal(fs.readFileSync(join(f.root, retired[0]), "utf8"), body);
  const next = registry(f); t.after(() => next.r.close()); assert.equal((await next.run()).status, "synthetic_coordination_verified");
});
test("read leases and serialized/native legacy handles cannot enter coordination actions", (t) => {
  const f = fixture(t), read = native.openReadRoot(f.root, 1000); t.after(() => native.closeRoot(read));
  for (const handle of [read, {}, { fixture_only: true }]) assert.throws(() => native.coordinationCall(handle, "publish", ".writer.lock", owner()), /invalid_coordination_handle/);
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("coordination refuses caller data paths and preserves a replacement instead of releasing it", async (t) => {
  const f = fixture(t), io = openSyntheticNativeBarCoordination(f.root); t.after(() => io.close());
  await assert.rejects(io.publish(`captures/2026-10-24/${id}.json`, "{}"), /invalid_coordination/);
  const lock = await takeNativeWriterLockWithIo(io, 100); put(f, ".writer.lock", "replacement");
  assert.equal(lock.release(), false); assert.equal(io.close().coordination_released, false);
  assert.equal(io.close().coordination_released, false);
  assert.equal(fs.readFileSync(join(f.root, ".writer.lock"), "utf8"), "replacement");
});
test("registry cannot release exclusion during active work or treat a falsy thrown value as success", async (t) => {
  const f = fixture(t), x = registry(f); t.after(() => x.r.close());
  await assert.rejects(x.run({ onLocked() {
    assert.throws(() => x.r.close(), /registry_busy/); assert.ok(fs.existsSync(join(f.root, ".writer.lock"))); throw undefined;
  } }), /coordination_probe_failed/);
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("expiry while excluded never renews the grant and still cleans exact owned coordination", async (t) => {
  const f = fixture(t), x = registry(f, 150); t.after(() => x.r.close());
  await assert.rejects(x.run({ onLocked: () => sleep(180) }), /expired/); assert.deepEqual(fs.readdirSync(f.root), []);
});
for (const level of ["root", "ancestor"]) test(`a ${level} substitution cannot redirect release into a victim`, async (t) => {
  const f = fixture(t), io = openSyntheticNativeBarCoordination(f.root); t.after(() => io.close());
  const lock = await takeNativeWriterLockWithIo(io, 1000), victim = join(f.base, "victim");
  fs.mkdirSync(victim, { mode: 0o700 }); put({ root: victim }, ".writer.lock", "outside");
  if (level === "root") { fs.renameSync(f.root, f.root + ".original"); fs.symlinkSync(victim, f.root); }
  else {
    fs.renameSync(f.base, f.base + ".original"); fs.symlinkSync(f.base + ".original", f.base);
  }
  try {
    assert.equal(lock.release(), false); assert.equal(io.close().coordination_released, false);
    assert.equal(fs.readFileSync(join(victim, ".writer.lock"), "utf8"), "outside");
  } finally { if (level === "ancestor") { fs.unlinkSync(f.base); fs.renameSync(f.base + ".original", f.base); } }
});
test("missing roots, aliases, ACL grants and an absent backend never initialize a coordination store", (t) => {
  const f = fixture(t); fs.rmdirSync(f.root); assert.throws(() => openSyntheticNativeBarCoordination(f.root), /open_failed/);
  assert.equal(fs.existsSync(f.root), false); fs.mkdirSync(f.root, { mode: 0o700 });
  assert.throws(() => openSyntheticNativeBarCoordination(f.root + "/../store"), /synthetic_root_required/);
  assert.equal(spawnSync("/bin/chmod", ["+a", "everyone allow write", f.root]).status, 0);
  assert.throws(() => openSyntheticNativeBarCoordination(f.root), /unsafe_acl/); spawnSync("/bin/chmod", ["-N", f.root]);
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("native coordination sessions share the eight-lease limit and close returns all descriptors", (t) => {
  const f = fixture(t), before = native.info().live_fds, all = [];
  try { for (let i = 0; i < 8; ++i) all.push(openSyntheticNativeBarCoordination(f.root));
    assert.throws(() => openSyntheticNativeBarCoordination(f.root), /native_session_limit/);
  } finally { all.forEach((io) => io.close()); }
  assert.equal(native.info().live_fds, before); assert.deepEqual(fs.readdirSync(f.root), []);
});
test("registry initialization failure releases its native lease immediately without waiting for GC", (t) => {
  const f = fixture(t), before = native.info(), clone = globalThis.structuredClone;
  const failure = new Error("synthetic_baseline_clone_failure");
  try {
    globalThis.structuredClone = () => { throw failure; };
    for (let i = 0; i < 10; ++i) {
      assert.throws(() => createSyntheticNativeBarExecutionRegistry(f.root), (e) => e === failure);
      assert.equal(native.info().live_fds, before.live_fds);
      assert.equal(native.info().live_sessions, before.live_sessions);
    }
  } finally { globalThis.structuredClone = clone; }
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("plans disclose effects, enforce exact scope, and never turn purge coordination into age proof", async (t) => {
  const f = fixture(t), x = createSyntheticNativeBarExecutionRegistry(f.root); t.after(() => x.close());
  assert.throws(() => x.prepare("record"), /unsupported_execution_kind/);
  assert.throws(() => x.prepare("quarantine_abandoned", [0, 0]), /invalid_execution_targets/);
  assert.throws(() => x.prepare("quarantine_abandoned", [-1]), /unverified_execution_target/);
  const p = x.prepare("purge_abandoned"); assert.equal(p.execution_available, false); assert.equal(p.host_approval_available, false);
  assert.ok(p.effects.includes("publish_private_writer_claim_ticket_lock"));
  assert.throws(() => x.prepare("purge_abandoned"), /already_issued/);
  assert.throws(() => x.approveForSyntheticTest(p.plan_id, "0".repeat(64)), /plan_binding/);
  const a = x.approveForSyntheticTest(p.plan_id, p.plan_hash);
  assert.equal((await x.probe(p.plan_id, p.plan_hash, a)).execution_available, false);
});
test("target selections retain native proofs even when a caller mutates the displayed scope", async (t) => {
  const f = fixture(t), dir = join(f.root, "captures", "2026-10-24"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(join(dir, `${id}.json`), "invented-not-a-recorded-capture", { mode: 0o600 });
  const r = createSyntheticNativeBarExecutionRegistry(f.root); t.after(() => r.close()); const p = r.prepare("quarantine_abandoned", [2]);
  assert.equal(p.targets[0].path, `captures/2026-10-24/${id}.json`); p.targets[0].proof.inode = "0"; p.targets[0].path = "../../victim";
  const a = r.approveForSyntheticTest(p.plan_id, p.plan_hash); assert.equal((await r.probe(p.plan_id, p.plan_hash, a)).execution_available, false);
  assert.equal(fs.readFileSync(join(dir, `${id}.json`), "utf8"), "invented-not-a-recorded-capture");
});
test("native coordination publication count is bounded without growing the store", async (t) => {
  const f = fixture(t), io = openSyntheticNativeBarCoordination(f.root); t.after(() => io.close());
  for (let i = 0; i < 64; ++i) { assert.equal(await io.publish(".writer.lock", owner()), "created"); assert.equal(io.removeOwn(".writer.lock", owner()), true); }
  await assert.rejects(io.publish(".writer.lock", owner()), /publication_limit/); assert.deepEqual(fs.readdirSync(f.root), []);
});
test("coordination headroom is reserved logically before any coordination publication", (t) => {
  const f = fixture(t), before = native.info(); put(f, "sparse-unknown", ""); fs.truncateSync(join(f.root, "sparse-unknown"), 1024 ** 3 - 8192);
  for (let i = 0; i < 10; ++i) {
    assert.throws(() => openSyntheticNativeBarCoordination(f.root), /headroom_required/);
    assert.equal(native.info().live_fds, before.live_fds); assert.equal(native.info().live_sessions, before.live_sessions);
  }
  assert.deepEqual(fs.readdirSync(f.root), ["sparse-unknown"]);
});
test("a deny-only ACL change cannot hide inside the root's coordination churn", async (t) => {
  const f = fixture(t), x = registry(f); t.after(() => x.r.close());
  try {
    await assert.rejects(x.run({ onLocked() { assert.equal(spawnSync("/bin/chmod", ["+a", "everyone deny write", f.root]).status, 0); } }),
      (e) => /coordination_acl_changed/.test(e.message) && e.coordination_released === false);
  } finally { spawnSync("/bin/chmod", ["-N", f.root]); }
});
for (const observation of ["names", "read"]) test(`${observation}: observed foreign queue churn requires a fresh preview even after that writer has left`, async (t) => {
  const f = fixture(t), io = openSyntheticNativeBarCoordination(f.root); t.after(() => io.close());
  assert.equal(await io.publish(".writer.lock", owner()), "created");
  const claim = `.writer-claim-${id}.json`; put(f, claim, owner());
  if (observation === "names") await io.names(); else await io.read(claim);
  fs.unlinkSync(join(f.root, claim));
  assert.throws(() => io.verifyBaseline(), /fresh_preview_required/);
});
for (const level of ["root", "ancestor"]) test(`a ${level} substitution observed during a read stays stale even after restoration and retry`, async (t) => {
  const f = fixture(t), io = openSyntheticNativeBarCoordination(f.root); t.after(() => io.close());
  assert.equal(await io.publish(".writer.lock", owner()), "created");
  const path = level === "root" ? f.root : f.base;
  fs.renameSync(path, path + ".original"); fs.mkdirSync(path, { mode: 0o700 });
  const read = io.read(".writer.lock");
  fs.rmdirSync(path); fs.renameSync(path + ".original", path);
  assert.equal((await read).toString(), owner());
  assert.throws(() => io.verifyBaseline(), /fresh_preview_required/);
  assert.equal(io.close().coordination_released, true); assert.deepEqual(fs.readdirSync(f.root), []);
});

const accessUrl = new URL("../../build/nativeBarAccess.js", import.meta.url).href;
const fsUrl = new URL("../../build/nativeBarFs.js", import.meta.url).href;
function worker(f, tag, ms = 40, legacy = false) {
  return spawn(process.execPath, ["--input-type=module", "-e", `
    import {openSyntheticNativeBarCoordination} from ${JSON.stringify(fsUrl)};
    import {takeNativeWriterLockWithIo,takeNativeWriterLock} from ${JSON.stringify(accessUrl)};
    // Opening refuses while peers change the namespace (two inventory passes must match); callers retry briefly.
    const open=async()=>{for(let i=0;;i++){try{return openSyntheticNativeBarCoordination(${JSON.stringify(f.root)})}
      catch(e){if(i>=50||!/^(?:inventory_changed|open_failed:2)/.test(e.message))throw e;await new Promise(r=>setTimeout(r,10))}}};
    const io=${legacy ? "null" : "await open()"};
    try { const lock=io?await takeNativeWriterLockWithIo(io,5000):await takeNativeWriterLock(${JSON.stringify(f.root)},async()=>{},5000);
      try { process.stdout.write(${JSON.stringify(tag + ":start\n")}); await new Promise(r=>setTimeout(r,${ms})); process.stdout.write(${JSON.stringify(tag + ":end\n")}); }
      finally { if(!lock.release()) throw Error('release_failed'); }
    } finally { io?.close(); }
  `], { stdio: ["ignore", "pipe", "pipe"] });
}
test("native and existing pathname writers share the same process ordering without overlap", async (t) => {
  const f = fixture(t), events = [], jobs = [worker(f, "a"), worker(f, "b", 40, true), worker(f, "c")];
  const results = await Promise.all(jobs.map(async (p) => { let error = ""; p.stdout.on("data", (b) => events.push(...b.toString().trim().split("\n")));
    p.stderr.on("data", (b) => error += b); const [code] = await once(p, "exit"); return { code, error }; }));
  results.forEach(({ code, error }) => assert.equal(code, 0, error));
  assert.equal(events.length, 6);
  for (let i = 0; i < events.length; i += 2) { assert.match(events[i], /:start$/); assert.equal(events[i + 1], events[i].replace(":start", ":end")); }
  assert.deepEqual(fs.readdirSync(f.root), []);
});
test("a suspended owner stays blocking, and process death leaves evidence for retirement only", async (t) => {
  const f = fixture(t), child = worker(f, "owner", 10000);
  t.after(() => { try { child.kill("SIGCONT"); child.kill("SIGKILL"); } catch {} });
  await once(child.stdout, "data"); child.kill("SIGSTOP");
  const x = registry(f); t.after(() => x.r.close()); await assert.rejects(x.run({ waitMs: 40 }), /store_lock_busy/);
  child.kill("SIGKILL"); await once(child, "exit");
  assert.ok(fs.readdirSync(f.root).includes(".writer.lock")); const next = registry(f); t.after(() => next.r.close());
  await assert.rejects(next.run(), /fresh_preview_required/);
  assert.ok(fs.readdirSync(f.root).some((n) => n.startsWith(".writer-retired-")));
});

test("the exported adapter retires only on a liveness verdict reached in the same call", async (t) => {
  const f = fixture(t), plain = openSyntheticNativeBarCoordination(f.root); t.after(() => plain.close());
  put(f, ".writer.lock", owner());
  assert.equal((await plain.read(".writer.lock")).toString(), owner());
  await assert.rejects(plain.retireDead(".writer.lock"), /retirement_requires_liveness_judge/);
  const judged = openSyntheticNativeBarCoordination(f.root, 600000, { ownerDead: coordinationOwnerDead }); t.after(() => judged.close());
  await assert.rejects(judged.retireDead(".writer.lock"), /retirement_owner_not_proven_dead/);
  assert.equal(fs.readFileSync(join(f.root, ".writer.lock"), "utf8"), owner());
  assert.ok(!fs.readdirSync(f.root).some((n) => n.startsWith(".writer-retired-")));
});
test("an owned queue entry removed by someone else is accepted only with absentOk and leaves release unconfirmed", async (t) => {
  const f = fixture(t), claim = `.writer-claim-${id}.json`;
  for (const absentOk of [false, true]) {
    const io = openSyntheticNativeBarCoordination(f.root);
    assert.equal(await io.publish(claim, owner()), "created"); fs.unlinkSync(join(f.root, claim));
    assert.equal(io.removeOwn(claim, owner(), absentOk), absentOk);
    assert.equal(io.close().coordination_released, false);
  }
});
