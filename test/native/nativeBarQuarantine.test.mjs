import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { NativeBarHistory } from "../../build/nativeBarHistory.js";
import { canonical } from "../../build/nativeBarEvidence.js";
import { openSyntheticNativeBarQuarantineIo } from "../../build/nativeBarFs.js";
import { coordinationOwnerDead, takeNativeWriterLockWithIo } from "../../build/nativeBarAccess.js";
import { createSyntheticNativeBarQuarantineRegistry, inspectSyntheticNativeBarQuarantine } from "../../build/nativeBarQuarantine.js";

const native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node");
const id = "01234567-89ab-4cde-8fab-0123456789ab";
const invented = "invented capture, never market data";
function fixture(t) {
  const base = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "native-bar-fs-synthetic-")); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(join(base, ".native-bar-fs-synthetic"), "synthetic-fixture-v1\n", { mode: 0o600 });
  const root = join(base, "store"); fs.mkdirSync(root, { mode: 0o700 });
  fs.writeFileSync(join(root, "policy.json"), '{"schema":"native-bar-synthetic-quarantine-profile-v4"}', { mode: 0o600 });
  fs.mkdirSync(join(root, "captures", "2026-10-24"), { recursive: true, mode: 0o700 });
  const source = `captures/2026-10-24/${id}.json`;
  fs.writeFileSync(join(root, source), "invented capture, never market data", { mode: 0o600 });
  return { root, base, source };
}
test("approved synthetic quarantine publishes an immutable replayable journal without deleting data", async (t) => {
  const f = fixture(t), before = native.info().live_fds;
  const r = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => r.close());
  const p = r.prepare([2]);
  assert.equal(p.execution_available, false); assert.equal(p.host_approval_available, false);
  assert.equal(fs.existsSync(join(f.root, "maintenance")), false);
  const approval = r.approveForSyntheticTest(p.plan_id, p.plan_hash);
  const result = await r.execute(p.plan_id, p.plan_hash, approval);
  assert.equal(result.status, "complete"); assert.equal(result.coordination_released, true);
  assert.equal(result.execution_available, false); assert.equal(fs.existsSync(join(f.root, f.source)), false);
  assert.ok(result.publication_acknowledged_at >= result.logical_completed_at);
  assert.equal(fs.readFileSync(join(f.root, p.targets[0].quarantine_path), "utf8"), "invented capture, never market data");
  const status = inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id);
  assert.equal(status.status, "complete"); assert.equal(status.original_acknowledgement, "not_proven");
  assert.equal(status.replay.status, "complete"); assert.equal(native.info().live_fds, before);
});
function dataLocations(root) {
  const out = [];
  function visit(path) { for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.isFile() && fs.readFileSync(full, "utf8") === invented) out.push(full.slice(root.length + 1));
  } }
  visit(root); return out;
}
async function prepared(t) { const f = fixture(t), r = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => r.close());
  const p = r.prepare([2]); return { f, r, p, a: r.approveForSyntheticTest(p.plan_id, p.plan_hash) }; }
test("every exposed operation boundary stops on injected failure, retains bytes, and consumes its approval", async (t) => {
  const trace = [], x = await prepared(t);
  await x.r.execute(x.p.plan_id, x.p.plan_hash, x.a, { hook(phase) { trace.push(phase); } });
  assert.ok(trace.length > 100);
  for (let stop = 1; stop <= trace.length; ++stop) await t.test(`${stop}: ${trace[stop - 1]}`, async (t) => {
    const before = native.info().live_fds, { f, r, p, a } = await prepared(t); let step = 0;
    await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook() { if (++step === stop) throw new Error("synthetic_stop"); } }),
      (e) => e.message === "synthetic_stop" && e.execution_available === false && e.coordination_released === true);
    assert.equal(dataLocations(f.root).length, 1); assert.equal(native.info().live_fds, before);
    await assert.rejects(r.execute(p.plan_id, p.plan_hash, a), /closed|consumed/);
    const state = inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id);
    assert.equal(state.execution_available, false); assert.equal(state.original_acknowledgement, "not_proven");
  });
});
test("native deny-only source ACL is retained in the journal and fresh inspection", async (t) => {
  const f = fixture(t); assert.equal(spawnSync("/bin/chmod", ["+a", "everyone deny write", join(f.root, f.source)]).status, 0);
  const r = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => r.close()); const p = r.prepare([2]);
  assert.equal(p.targets[0].proof.acl, "deny_only");
  await r.execute(p.plan_id, p.plan_hash, r.approveForSyntheticTest(p.plan_id, p.plan_hash));
  assert.equal(inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id).status, "complete");
});
test("all publication temporary names are declared before consent and detached edits cannot redirect writes", async (t) => {
  const f = fixture(t), r = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => r.close());
  const p = r.prepare([2]); assert.equal(p.temporary_paths.length, p.publications.length);
  assert.equal(new Set(p.temporary_paths).size, p.publications.length);
  p.publications[0] = "../../outside"; p.temporary_paths[0] = "../../outside"; p.targets[0].quarantine_path = "../../outside";
  await r.execute(p.plan_id, p.plan_hash, r.approveForSyntheticTest(p.plan_id, p.plan_hash));
  assert.equal(inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id).status, "complete");
});
test("incomplete inspection separates recorded pending state from the currently observed holding object", async (t) => {
  const { f, r, p, a } = await prepared(t);
  await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook(phase) { if (phase === "after_move") throw Error("stopped_after_move"); } }), /stopped_after_move/);
  const status = inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id);
  assert.equal(status.replay.targets[0].state, "move_pending");
  assert.equal(status.current_locations[0].source, null); assert.ok(status.current_locations[0].holding);
  assert.equal(status.current_locations[0].quarantine, null); assert.equal(status.original_acknowledgement, "not_proven");
});
test("fixture approval is issuer-bound, exact-hash-bound and not serialized consent", async (t) => {
  const x = await prepared(t), other = await prepared(t);
  await assert.rejects(x.r.execute(x.p.plan_id, x.p.plan_hash, { quarantine_fixture_only: true }), /approval_required/);
  await assert.rejects(x.r.execute(x.p.plan_id, x.p.plan_hash, other.a), /approval_required/);
  await assert.rejects(x.r.execute(x.p.plan_id, "0".repeat(64), x.a), /plan_binding/);
  assert.equal(fs.existsSync(join(x.f.root, "maintenance")), false);
  await x.r.execute(x.p.plan_id, x.p.plan_hash, x.a);
});
test("the immutable intent retains the exact original plan and refuses an edited layout on inspection", async (t) => {
  const { f, r, p, a } = await prepared(t); await r.execute(p.plan_id, p.plan_hash, a);
  const path = join(f.root, `maintenance/${p.maintenance_id}.json`), intent = JSON.parse(fs.readFileSync(path, "utf8"));
  assert.equal(intent.schema, "native-bar-quarantine-intent-v4"); assert.equal(intent.plan.plan_hash, p.plan_hash);
  assert.deepEqual(intent.plan.temporary_paths, p.temporary_paths);
  intent.plan.publications[0] = "../../outside";
  fs.writeFileSync(path, canonical(intent)); assert.throws(() => inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id), /plan|Invalid|invalid/);
});
for (const change of ["unknown", "receipt", "content"]) test(`a ${change} change after issuance refuses before data movement`, async (t) => {
  const { f, r, p, a } = await prepared(t);
  if (change === "unknown") fs.writeFileSync(join(f.root, ".DS_Store"), "preserve", { mode: 0o600 });
  if (change === "receipt") { fs.mkdirSync(join(f.root, "receipts", "2026-10-24"), { recursive: true, mode: 0o700 }); fs.writeFileSync(join(f.root, "receipts", "2026-10-24", id + ".json"), "{}", { mode: 0o600 }); }
  if (change === "content") fs.appendFileSync(join(f.root, f.source), " changed");
  await assert.rejects(r.execute(p.plan_id, p.plan_hash, a), /changed/);
  assert.equal(fs.existsSync(join(f.root, f.source)), true); assert.equal(fs.existsSync(join(f.root, "maintenance")), false);
});
for (const window of ["after_source_check", "before_rename"]) test(`a source symlink at ${window} is preserved and its external victim is untouched`, async (t) => {
  const { f, r, p, a } = await prepared(t), victim = join(f.base, "victim"); fs.writeFileSync(victim, "outside", { mode: 0o600 });
  let changed = false;
  await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook(phase) {
    if (phase === window && !changed) { changed = true; fs.renameSync(join(f.root, f.source), join(f.base, "original")); fs.symlinkSync(victim, join(f.root, f.source)); }
  } }), /open_failed|nonregular|changed/);
  assert.equal(fs.readFileSync(victim, "utf8"), "outside"); assert.equal(fs.readFileSync(join(f.base, "original"), "utf8"), invented);
  assert.equal([f.source, p.targets[0].holding_path].filter((path) => {
    try { return fs.lstatSync(join(f.root, path)).isSymbolicLink(); } catch { return false; }
  }).length, 1);
});
test("a substituted root cannot redirect mutations into a sibling victim", async (t) => {
  const { f, r, p, a } = await prepared(t), victim = join(f.base, "victim"); fs.mkdirSync(victim, { mode: 0o700 });
  fs.writeFileSync(join(victim, "outside"), "preserve", { mode: 0o600 }); let changed = false;
  try {
    await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook(phase) {
      if (phase === "before_move" && !changed) { changed = true; fs.renameSync(f.root, f.root + ".original"); fs.symlinkSync(victim, f.root); }
    } }), (e) => /namespace_changed/.test(e.message) && e.coordination_released === false);
    assert.deepEqual(fs.readdirSync(victim), ["outside"]); assert.equal(fs.readFileSync(join(victim, "outside"), "utf8"), "preserve");
  } finally { if (changed) { fs.unlinkSync(f.root); fs.renameSync(f.root + ".original", f.root); } }
});
test("a generated destination collision never overwrites another object", async (t) => {
  const { f, r, p, a } = await prepared(t); let changed = false;
  await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook(phase) {
    if (phase === "after_source_check" && !changed) { changed = true; fs.writeFileSync(join(f.root, p.targets[0].holding_path), "collision", { mode: 0o600 }); }
  } }), /exclusive_move_failed|parent_changed/);
  assert.equal(fs.readFileSync(join(f.root, p.targets[0].holding_path), "utf8"), "collision"); assert.equal(fs.readFileSync(join(f.root, f.source), "utf8"), invented);
});
test("the original deadline cannot be renewed by waiting or publishing", async (t) => {
  const { f, r, p, a } = await prepared(t), now = Date.now;
  try {
    await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook(phase) { if (phase === "before_move") Date.now = () => now() + 600001; } }), /expired|rollback/);
  } finally { Date.now = now; }
  assert.equal(dataLocations(f.root).length, 1); assert.equal(fs.existsSync(join(f.root, p.publications.at(-1))), false);
});
test("old history readers reject the fresh fixture profile before capture interpretation", async (t) => {
  const f = fixture(t), history = new NativeBarHistory({ directory: f.root, testOnly: { allowTemporaryRoot: true } });
  await assert.rejects(history.status(id), /policy/); assert.equal(fs.readFileSync(join(f.root, f.source), "utf8"), invented);
});
for (const indices of [[], [2, 2], [-1], [1], [999], Array(17).fill(2)]) test(`invalid or oversized target selection ${JSON.stringify(indices)} creates no transaction`, (t) => {
  const f = fixture(t), before = native.info().live_fds, r = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => r.close());
  assert.throws(() => r.prepare(indices), /target_limit|duplicate|index|fixture_required/);
  assert.equal(native.info().live_fds, before); assert.equal(fs.existsSync(join(f.root, "maintenance")), false);
});
for (const final of [false, true]) test(`a last-window regular replacement in ${final ? "quarantine" : "holding"} is moved only as preserved conflict`, async (t) => {
  const { f, r, p, a } = await prepared(t); let changed = false;
  await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook(phase, path) {
    if (phase === "before_rename" && path.startsWith(final ? "quarantine/" : "maintenance-hold/") && !changed) {
      changed = true; const source = join(f.root, final ? p.targets[0].holding_path : f.source);
      fs.renameSync(source, join(f.base, "original")); fs.writeFileSync(source, "replacement", { mode: 0o600 });
    }
  } }), /target_changed/);
  assert.equal(fs.readFileSync(join(f.base, "original"), "utf8"), invented);
  assert.equal(fs.readFileSync(join(f.root, final ? p.targets[0].quarantine_path : p.targets[0].holding_path), "utf8"), "replacement");
  assert.equal(fs.existsSync(join(f.root, p.publications.at(-1))), false);
});
const moduleUrl = new URL("../../build/nativeBarQuarantine.js", import.meta.url).href;
for (const point of ["before_reserve", "after_create_metadata", "after_write_metadata", "after_publish_metadata", "after_move", "marker", "completion", "before_response"]) {
  test(`actual process death at ${point} preserves evidence and restart inspection never resumes`, (t) => {
    const f = fixture(t);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import {createSyntheticNativeBarQuarantineRegistry} from ${JSON.stringify(moduleUrl)};
      const r=createSyntheticNativeBarQuarantineRegistry(${JSON.stringify(f.root)}),p=r.prepare([2]);
      process.stdout.write(JSON.stringify(p)+'\\n');
      await r.execute(p.plan_id,p.plan_hash,r.approveForSyntheticTest(p.plan_id,p.plan_hash),{hook(phase,path){
        const point=${JSON.stringify(point)};
        if(point===phase || phase==='after_publish_metadata' && (point==='marker' && path.endsWith('/timestamp.json') || point==='completion' && path.endsWith('.done.json'))) process.kill(process.pid,'SIGKILL');
      }});
    `], { encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 });
    assert.equal(child.signal, "SIGKILL", child.stderr); const p = JSON.parse(child.stdout.split("\n")[0]);
    assert.equal(dataLocations(f.root).length, 1);
    const names = fs.readdirSync(f.root); assert.ok(names.includes(".writer.lock"));
    const status = inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id);
    assert.equal(status.execution_available, false); assert.equal(status.original_acknowledgement, "not_proven");
    assert.deepEqual(fs.readdirSync(f.root), names); assert.equal(dataLocations(f.root).length, 1);
    if (["completion", "before_response"].includes(point)) assert.equal(status.status, "complete");
    if (point !== "before_reserve") {
      const restarted = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => restarted.close());
      assert.throws(() => restarted.prepare([2]), /existing_transactions_blocked|unqualified|readable|fixture_required/);
    }
  });
}
test("an exact multi-target batch finishes with one complete marker set", async (t) => {
  const f = fixture(t), second = "11234567-89ab-4cde-8fab-0123456789ab";
  fs.writeFileSync(join(f.root, "captures", "2026-10-24", second + ".json"), "second invented capture", { mode: 0o600 });
  const r = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => r.close()); const p = r.prepare([2, 3]);
  await r.execute(p.plan_id, p.plan_hash, r.approveForSyntheticTest(p.plan_id, p.plan_hash));
  const status = inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id); assert.equal(status.status, "complete");
  assert.equal(status.replay.targets.length, 2); assert.ok(status.current_locations.every((t) => t.quarantine && !t.holding && !t.source));
});
test("metadata modified in the write-to-proof window cannot become a durable pending grant", async (t) => {
  const { f, r, p, a } = await prepared(t); let changed = false;
  await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook(phase, path) {
    if (phase === "after_write_before_proof" && path === p.publications[3]) {
      changed = true; fs.appendFileSync(join(f.root, p.temporary_paths[3]), "corruption");
    }
  } }), /publication_bytes_changed|changed/);
  assert.equal(changed, true); assert.equal(fs.readFileSync(join(f.root, f.source), "utf8"), invented);
  assert.equal(fs.existsSync(join(f.root, p.publications[3])), false);
});
for (const damage of ["none", "null", "schema", "intent", "event", "targets", "time", "premature"]) test(`incomplete timestamp inspection validates ${damage} without repair`, async (t) => {
  const { f, r, p, a } = await prepared(t);
  await assert.rejects(r.execute(p.plan_id, p.plan_hash, a, { hook(phase, path) {
    if (phase === "before_create_metadata" && path.endsWith(".done.json")) throw Error("stop_before_completion");
  } }), /stop_before_completion/);
  const markerPath = join(f.root, `quarantine/abandoned/${p.maintenance_id}/timestamp.json`);
  let marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  if (damage === "null") marker = null;
  if (damage === "schema") marker.schema = "unknown";
  if (damage === "intent") marker.intent_hash = "0".repeat(64);
  if (damage === "event") marker.last_event_hash = "0".repeat(64);
  if (damage === "targets") marker.targets = [];
  if (damage === "time") marker.quarantined_at = "2000-01-01T00:00:00.000Z";
  if (damage === "premature") fs.renameSync(join(f.root, `maintenance/${p.maintenance_id}.events/4.json`), join(f.base, "preserved-last-event"));
  if (!["none", "premature"].includes(damage)) fs.writeFileSync(markerPath, canonical(marker));
  const before = fs.readFileSync(markerPath);
  if (damage === "none") {
    const status = inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id);
    assert.equal(status.status, "quarantine_incomplete"); assert.equal(status.original_acknowledgement, "not_proven");
  } else assert.throws(() => inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id));
  assert.deepEqual(fs.readFileSync(markerPath), before);
  assert.equal(fs.existsSync(join(f.root, p.publications.at(-1))), false);
  assert.equal(fs.readFileSync(join(f.root, p.targets[0].quarantine_path), "utf8"), invented);
});
for (const damage of ["duplicate_key", "invalid_utf8", "event_gap", "foreign_event_name", "target_changed", "null_intent"]) test(`restart inspection refuses ${damage} without repair`, async (t) => {
  const { f, r, p, a } = await prepared(t); await r.execute(p.plan_id, p.plan_hash, a);
  const event = join(f.root, `maintenance/${p.maintenance_id}.events/1.json`);
  if (damage === "duplicate_key") fs.writeFileSync(event, '{"schema":"x","schema":"y"}');
  if (damage === "invalid_utf8") fs.writeFileSync(event, Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
  if (damage === "event_gap") fs.renameSync(event, join(f.base, "preserved-event"));
  if (damage === "foreign_event_name") fs.renameSync(event, event.replace("/1.json", "/12.json"));
  if (damage === "target_changed") fs.appendFileSync(join(f.root, p.targets[0].quarantine_path), " changed");
  if (damage === "null_intent") fs.writeFileSync(join(f.root, `maintenance/${p.maintenance_id}.json`), "null");
  assert.throws(() => inspectSyntheticNativeBarQuarantine(f.root, p.maintenance_id));
  assert.equal(fs.existsSync(event), !["event_gap", "foreign_event_name"].includes(damage));
});
test("native expiry at the first write boundary refuses without renewing the original lease", async (t) => {
  const f = fixture(t), before = native.info().live_fds;
  const io = openSyntheticNativeBarQuarantineIo(f.root, 400, { ownerDead: coordinationOwnerDead }); t.after(() => io.close()); io.prepare([2]);
  const lock = await takeNativeWriterLockWithIo(io.coordination, 1000);
  assert.throws(() => io.begin((phase) => { if (phase === "before_reserve") { const start = performance.now(); while (performance.now() - start < 450) {} } }), /expired/);
  assert.equal(fs.existsSync(join(f.root, "maintenance")), false); assert.equal(fs.readFileSync(join(f.root, f.source), "utf8"), invented);
  assert.equal(lock.release(), true); assert.equal(io.close().coordination_released, true); assert.equal(native.info().live_fds, before);
});
test("reentrant close during native plan serialization cannot close or strand the registry", async (t) => {
  const f = fixture(t), before = native.info().live_fds, r = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => r.close());
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, "maintenance_id"); let invoked = false;
  try {
    Object.defineProperty(Object.prototype, "maintenance_id", { configurable: true, set(value) {
      Object.defineProperty(this, "maintenance_id", { value, writable: true, configurable: true, enumerable: true });
      if (!invoked) { invoked = true; assert.throws(() => r.close(), /busy/); }
    } });
    const p = r.prepare([2]); assert.ok(p.plan_hash); assert.equal(invoked, true);
  } finally { if (prior) Object.defineProperty(Object.prototype, "maintenance_id", prior); else delete Object.prototype.maintenance_id; r.close(); }
  assert.equal(native.info().live_fds, before); assert.equal(fs.existsSync(join(f.root, "maintenance")), false);
});
test("an unqualified profile and an overlarge fixture inventory create no layout or coordination", (t) => {
  for (const kind of ["policy", "inventory"]) {
    const f = fixture(t), before = native.info().live_fds;
    if (kind === "policy") fs.writeFileSync(join(f.root, "policy.json"), "{}");
    else for (let i = 0; i < 129; ++i) fs.writeFileSync(join(f.root, `unknown-${i}`), "", { mode: 0o600 });
    const r = createSyntheticNativeBarQuarantineRegistry(f.root); t.after(() => r.close());
    assert.throws(() => r.prepare([2]), /profile_required|inventory_limit/);
    assert.equal(fs.existsSync(join(f.root, "maintenance")), false); assert.equal(native.info().live_fds, before);
    assert.equal(fs.existsSync(join(f.root, ".writer.lock")), false);
  }
});
