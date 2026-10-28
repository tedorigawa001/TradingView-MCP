import test from "node:test";
import assert from "node:assert/strict";
import module, { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";

const effects = [], saved = [], originalRequire = module.createRequire, originalDlopen = process.dlopen;
const sourceRoots = ["../helpers/", "../../node_modules/"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
// A symlinked node_modules loads modules by their real path, so that location is an allowed read root as well.
sourceRoots.push(...sourceRoots.map((root) => fs.realpathSync(root) + sep));
const runnerSource = fileURLToPath(new URL("../../native/native_bar_fs/test_joint_admission.mjs", import.meta.url));
const readOnly = (file, flags) => {
  const p = resolve(file instanceof URL ? fileURLToPath(file) : String(file));
  return (flags === undefined || flags === "r" || flags === 0) && (sourceRoots.some((root) => p.startsWith(root)) || p === runnerSource);
};
const refused = (name) => { effects.push(name); return Error("cc1a_io_forbidden"); };
function trap(target, name, wrap) { saved.push([target, name, target[name]]); target[name] = wrap(target[name]); }
const mutating = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename", "chmod", "symlink", "link", "utimes"];
for (const name of mutating) {
  trap(fs, `${name}Sync`, () => () => { throw refused(`${name}Sync`); });
  trap(fs, name, () => () => { throw refused(name); });
  trap(fs.promises, name, () => async () => { throw refused(`promises.${name}`); });
}
trap(fs, "createWriteStream", () => () => { throw refused("createWriteStream"); });
trap(fs, "openSync", (open) => (file, flags, ...rest) => { if (readOnly(file, flags)) return open(file, flags, ...rest); throw refused("openSync"); });
trap(fs, "open", (open) => (file, flags, ...rest) => {
  if (readOnly(file, typeof flags === "function" ? undefined : flags)) return open(file, flags, ...rest); throw refused("open");
});
trap(fs.promises, "open", (open) => async (file, flags, ...rest) => { if (readOnly(file, flags)) return open(file, flags, ...rest); throw refused("promises.open"); });
module.createRequire = (...args) => new Proxy(originalRequire(...args), { apply(target, self, args) {
  if (/\.node$/.test(String(args[0]))) { effects.push("native_require"); throw Error("cc1a_native_forbidden"); }
  return Reflect.apply(target, self, args);
} });
process.dlopen = () => { effects.push("dlopen"); throw Error("cc1a_native_forbidden"); };
syncBuiltinESMExports();
test.after(() => { for (const [target, name, f] of saved.reverse()) target[name] = f; module.createRequire = originalRequire; process.dlopen = originalDlopen;
  syncBuiltinESMExports(); assert.deepEqual(effects, []); });
const api = await import("../helpers/jointUnsignedAcceptanceContracts.mjs");
const request = () => ({ schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run",
  source_commit: "a".repeat(40), patch_sha256: "b".repeat(64) });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(case_id = "u1-unsigned", mode = "normal") {
  return { request: request(), case_id, mode, fixture_name: "native-bar-fs-synthetic-Ab123Z",
    ids: { fixture: id(1), store: id(2), epoch: id(3), authority: id(4), key: id(5), reference: id(6), extra: id(7) } };
}
test("C-C1a's tripwire refuses sync, callback, promise and stream filesystem mutation", async () => {
  const before = effects.length, probe = "/nonexistent-cc1a-probe/x";
  for (const name of mutating) {
    assert.throws(() => fs[`${name}Sync`](probe, probe), /cc1a_io_forbidden/, `${name}Sync`);
    assert.throws(() => fs[name](probe, probe, () => {}), /cc1a_io_forbidden/, name);
    await assert.rejects(fs.promises[name](probe, probe), /cc1a_io_forbidden/, `promises.${name}`);
  }
  assert.throws(() => fs.createWriteStream(probe), /cc1a_io_forbidden/);
  assert.throws(() => fs.openSync(probe, "w"), /cc1a_io_forbidden/);
  assert.throws(() => fs.open(probe, "w", () => {}), /cc1a_io_forbidden/);
  await assert.rejects(fs.promises.open(probe, "w"), /cc1a_io_forbidden/);
  effects.splice(before);
});
test("C-C1a freezes twelve cases in both modes without creating a fixture or an execution grant", () => {
  const input = request(), plan = api.describeUnsignedAcceptanceRun(input); input.run_id = "changed";
  assert.equal(plan.declaration.run_id, "invented-run");
  assert.equal(plan.cases.length, 24); assert.equal(new Set(plan.cases.map((c) => c.case_id)).size, 12);
  assert.deepEqual(plan.modes, ["normal", "ubsan"]); assert.equal(plan.anchor, "/private/tmp");
  assert.equal(plan.execution_available, false); assert.equal(plan.native_status, "NOT_RUN");
  assert.equal(plan.limits.maximum_live_fixtures, 1); assert.equal(plan.limits.ancestor_headroom_bytes, "196608");
  assert.ok(Object.isFrozen(plan.cases[0]));
});
test("C-C1a plan hash binds the declaration, catalog, bounds, modes, anchor and output layout", () => {
  const plan = api.describeUnsignedAcceptanceRun(request());
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  const digest = (v) => createHash("sha256").update(canonical(v)).digest("hex");
  const catalog = plan.cases.filter((c) => c.mode === "normal").map(({ mode, status, ...c }) => c), outputs = plan.outputs.map(({ state, ...o }) => o);
  assert.equal(plan.plan_sha256, digest({ declaration: plan.declaration, catalog, limits: plan.limits, modes: plan.modes, anchor: plan.anchor, outputs }));
  assert.notEqual(plan.plan_sha256, digest({ declaration: plan.declaration, catalog, limits: plan.limits }));
});
test("C-C1a prepares only the fixed small unsigned recipes and keeps U4's input change separate", () => {
  const plan = api.describeUnsignedAcceptanceRun(request());
  for (const c of plan.cases.filter((c) => c.mode === "normal")) {
    const r = api.describeUnsignedFixture(fixture(c.case_id));
    assert.ok(r.entries.length <= 16); assert.ok(r.content_bytes <= 131072);
    assert.deepEqual(r.entries.filter((e) => e.path && !e.path.includes("/")).map((e) => e.path).sort(),
      [".native-bar-admission-synthetic", ".native-bar-fs-synthetic", "admission-witness", "store"]);
    assert.deepEqual(r.entries.filter((e) => e.path.startsWith("admission-witness/")).map((e) => e.path.slice(18)), c.witnesses);
    assert.equal(r.binding_delta, c.row === "U4" ? "data_inode_only" : "none");
    for (const e of r.entries) if (e.kind === "file") {
      assert.equal(e.mode, "33152"); assert.equal(e.size, String(Buffer.byteLength(e.content))); assert.doesNotMatch(e.content, /signature|BEGIN .*KEY/);
    }
    assert.equal(r.ownership_verified, false); assert.ok(Object.isFrozen(r.entries));
  }
  const changed = fixture(); changed.ids.store = changed.ids.fixture;
  assert.throws(() => api.describeUnsignedFixture(changed), /identity_alias/);
});
const proofFor = (entry, n) => ({ path: entry.path, proof: { kind: entry.kind, device: "1", inode: String(n + 100), uid: "501", gid: "20",
  mode: entry.mode, birthtime_ns: "123", flags: "0", acl: "none", acl_hash: "c".repeat(64), nlink: entry.kind === "file" ? "1" : "2",
  size: entry.size ?? "96", sha256: entry.sha256 ?? null }, children: entry.kind === "directory" ? [] : null });
const created = (entry, n) => ({ ...proofFor(entry, n), receipt_write: "confirmed" });
const baselineResources = () => ({ fds: "0", roots: "0", workspace: "0" });
function ownership(case_id = "u1-unsigned", baseline = baselineResources(), mode = "normal") {
  const f = fixture(case_id, mode), r = api.describeUnsignedFixture(f);
  const model = api.createUnsignedOwnershipModel({ fixture: f, supervisor_id: "supervisor-1", worker_id: "worker-1", uid: "501", gid: "20", baseline_resources: baseline });
  const entries = r.entries.map(proofFor);
  r.entries.forEach((e, n) => model.recordCreation(created(e, n)));
  model.finishSetup();
  return { model, entries };
}
function partial(case_id = "u1-unsigned") {
  const f = fixture(case_id), r = api.describeUnsignedFixture(f);
  return { r, model: api.createUnsignedOwnershipModel({ fixture: f, supervisor_id: "s", worker_id: "w", uid: "501", gid: "20", baseline_resources: baselineResources() }) };
}
// The independent observer lists every remaining owned directory; here the listing is derived from the remaining owned set.
const parentOf = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const listed = (entries) => entries.map((e) => ({ ...structuredClone(e), children: e.proof.kind === "directory"
  ? entries.filter((v) => v.path !== "" && parentOf(v.path) === e.path).map((v) => v.path.slice(v.path.lastIndexOf("/") + 1)) : null }));
function cleanup(entries, changes = {}) {
  return { entries: listed(entries), supervisor: "live", worker: "live", ancestor_chain: "same", receipt: "complete", query: "settled",
    native: "settled", original_operation_retired: true, query_released: true,
    resources: { fds_before: "0", fds_after: "0", roots_before: "0", roots_after: "0", workspace_before: "0", workspace_after: "0" },
    fixture_absent: false, ...changes };
}
function torndown(case_id = "u1-unsigned", mode = "normal", confirm = true) {
  const { model, entries } = ownership(case_id, baselineResources(), mode); let remaining = entries;
  while (remaining.length) {
    const observation = cleanup(remaining), path = model.assessCleanup(observation).next_entry.path;
    model.recordRemoval({ observation, path, outcome: "removed", receipt_write: "confirmed" });
    remaining = remaining.filter((e) => e.path !== path);
  }
  if (confirm) assert.equal(model.assessCleanup(cleanup([], { fixture_absent: true })).decision, "supplied_complete");
  return model;
}
test("C-C1a models exact deepest-first removal with immutable ownership but grants no deletion authority", () => {
  const { model, entries } = ownership("u3-maintenance"); let remaining = structuredClone(entries); const removed = [];
  while (remaining.length) {
    const assessed = model.assessCleanup(cleanup(remaining));
    assert.equal(assessed.decision, "supplied_next_entry"); assert.equal(assessed.cleanup_execution_available, false);
    const path = assessed.next_entry.path;
    model.recordRemoval({ observation: cleanup(remaining), path, outcome: "removed", receipt_write: "confirmed" });
    remaining = remaining.filter((e) => e.path !== path); removed.push(path);
  }
  assert.equal(removed.at(-1), "");
  assert.ok(removed.indexOf("store/maintenance") > removed.findIndex((p) => p.endsWith(`${id(7)}.json`)));
  assert.equal(model.assessCleanup(cleanup([], { fixture_absent: true })).decision, "supplied_complete");
  assert.equal(model.describe().native_status, "NOT_RUN"); assert.deepEqual(model.describe().removed_paths, removed);
});
test("C-C1a records one absence confirmation and exposes only a bound, non-authoritative teardown summary", () => {
  const model = torndown("u3-maintenance"), s = model.summarizeTeardown();
  assert.equal(s.absence_confirmed, true); assert.equal(s.stopped, null); assert.equal(s.setup, "complete");
  assert.equal(s.removed_entries, s.recorded_entries); assert.equal(s.cleanup_execution_available, false); assert.ok(Object.isFrozen(s));
  model.assessCleanup(cleanup([], { fixture_absent: true }));
  assert.equal(model.describe().history.filter((h) => h.kind === "absence_confirmed").length, 1);
  assert.equal(torndown("u3-maintenance", "normal", false).summarizeTeardown().absence_confirmed, false);
});
// Literal expectations, independent of the model's derivation rules.
const inventoried = ["native_begin", "c0_dispatch", "c0_authenticated", "open_pair", "inventory"];
const phaseTable = { "u0-unavailable": ["native_begin", "c0_dispatch"], "u0-unsigned": ["native_begin", "c0_dispatch"],
  "u1-unsigned": [...inventoried, "witness_capture"], "u2-missing": inventoried, "u2-extra": inventoried, "u2-gap": inventoried,
  "u3-pending": inventoried, "u3-writer": inventoried, "u3-reserve": inventoried, "u3-maintenance": inventoried, "u3-maintenance-bound": inventoried,
  "u4-expected-inode": ["native_begin", "c0_dispatch", "c0_authenticated", "open_pair"] };
function negative(case_id = "u1-unsigned", mode = "normal") {
  const run = api.describeUnsignedAcceptanceRun(request()), c = run.cases.find((c) => c.case_id === case_id && c.mode === mode);
  return { fixture: fixture(case_id, mode), plan_sha256: run.plan_sha256, expected_layer: c.expected_layer, observed_code: c.expected_code,
    phases: [...phaseTable[case_id]], requests_dispatched: 1, authenticated_requests: case_id.startsWith("u0-") ? 0 : 1,
    capture_matches_setup: case_id === "u1-unsigned", markers_zero_unreadable: phaseTable[case_id].includes("inventory"),
    original_operation_retired: true, query_released: true, usage_blockers: case_id === "u3-maintenance-bound" ? ["maintenance_metadata"] : [],
    native_throws: case_id === "u4-expected-inode" ? ["admission_expected_binding"] : [],
    registration_delta: case_id === "u4-expected-inode" ? ["bindings.data.inode"] : [], ownership: torndown(case_id, mode).summarizeTeardown() };
}
test("C-C1a compares supplied negative traces with literal phases but cannot turn consistent data into a native PASS", () => {
  const plan = api.describeUnsignedAcceptanceRun(request());
  assert.deepEqual(Object.keys(phaseTable).sort(), [...new Set(plan.cases.map((c) => c.case_id))].sort());
  for (const c of plan.cases) {
    const r = api.assessUnsignedNegativeModel(negative(c.case_id, c.mode));
    assert.equal(r.model_status, "consistent_supplied_negative", c.case_id); assert.deepEqual(r.blockers, []); assert.equal(r.mode, c.mode);
    assert.equal(r.native_status, "NOT_RUN"); assert.equal(r.execution_available, false); assert.equal(r.view_verified, false);
  }
  const o = negative(); o.phases.push("v0");
  assert.deepEqual(api.assessUnsignedNegativeModel(o).blockers, ["phase_order"]);
});
const latched = () => { const { model, entries } = ownership(); model.assessCleanup(cleanup(entries, { receipt: "failed" })); return model.summarizeTeardown(); };
for (const [name, case_id, change, expected] of [
  ["a dropped openPair", "u4-expected-inode", (o) => { o.phases.pop(); }, ["phase_order"]],
  ["an inventory on U4", "u4-expected-inode", (o) => { o.phases.push("inventory"); }, ["phase_order"]],
  ["a wrong layer", "u1-unsigned", (o) => { o.expected_layer = "prefix"; }, ["outcome_binding"]],
  ["a wrong code", "u1-unsigned", (o) => { o.observed_code = "b3cb_record_binding"; }, ["outcome_binding"]],
  ["an unexpected joint success", "u1-unsigned", (o) => { o.observed_code = "cc1a_unexpected_joint_success"; }, ["outcome_binding"]],
  ["a pre-begin registration refusal", "u4-expected-inode", (o) => { o.observed_code = "b3ca_invalid_registration"; }, ["outcome_binding"]],
  ["no C0 dispatch", "u0-unsigned", (o) => { o.requests_dispatched = 0; }, ["request_count"]],
  ["an authenticated unsigned C0", "u0-unsigned", (o) => { o.authenticated_requests = 1; }, ["request_count"]],
  ["an unauthenticated fixed C0", "u3-writer", (o) => { o.authenticated_requests = 0; }, ["request_count"]],
  ["a missing U1 byte match", "u1-unsigned", (o) => { o.capture_matches_setup = false; }, ["byte_comparison"]],
  ["a claimed capture without one", "u2-gap", (o) => { o.capture_matches_setup = true; }, ["byte_comparison"]],
  ["a missing marker encoding", "u3-pending", (o) => { o.markers_zero_unreadable = false; }, ["marker_encoding"]],
  ["claimed markers before inventory", "u4-expected-inode", (o) => { o.markers_zero_unreadable = true; }, ["marker_encoding"]],
  ["an unretired operation", "u2-extra", (o) => { o.original_operation_retired = false; }, ["settlement_or_teardown"]],
  ["an unreleased query", "u2-extra", (o) => { o.query_released = false; }, ["settlement_or_teardown"]],
  ["an ancestor-size envelope excess", "u3-maintenance-bound", (o) => { o.usage_blockers = ["common_inventory_bytes"]; }, ["usage_cause"]],
  ["an extra usage blocker", "u3-maintenance-bound", (o) => { o.usage_blockers.push("common_inventory_bytes"); }, ["usage_cause"]],
  ["a missing usage cause", "u3-maintenance-bound", (o) => { o.usage_blockers = []; }, ["usage_cause"]],
  ["a usage excess elsewhere", "u3-writer", (o) => { o.usage_blockers = ["data_inventory_bytes"]; }, ["usage_cause"]],
  ["another openPair refusal", "u4-expected-inode", (o) => { o.native_throws = ["admission_marker_binding"]; }, ["native_cause"]],
  ["a missing raw cause", "u4-expected-inode", (o) => { o.native_throws = []; }, ["native_cause"]],
  ["a native throw outside U4", "u1-unsigned", (o) => { o.native_throws = ["admission_expected_binding"]; }, ["native_cause"]],
  ["a marker delta", "u4-expected-inode", (o) => { o.registration_delta.push("bindings.markers.admission.sha256"); }, ["registration_delta"]],
  ["a delta outside U4", "u3-reserve", (o) => { o.registration_delta = ["bindings.data.inode"]; }, ["registration_delta"]],
  ["another case's teardown", "u3-pending", (o) => { o.ownership = torndown("u3-writer").summarizeTeardown(); }, ["ownership_binding"]],
  ["another mode's teardown", "u1-unsigned", (o) => { o.ownership = torndown("u1-unsigned", "ubsan").summarizeTeardown(); }, ["ownership_binding"]],
  ["a latched teardown", "u1-unsigned", (o) => { o.ownership = latched(); }, ["settlement_or_teardown"]],
  ["an unconfirmed absence", "u1-unsigned", (o) => { o.ownership = torndown("u1-unsigned", "normal", false).summarizeTeardown(); }, ["settlement_or_teardown"]],
]) test(`C-C1a negative model reports only ${expected.join("/")} for ${name}`, () => {
  const o = negative(case_id); change(o); const r = api.assessUnsignedNegativeModel(o);
  assert.equal(r.model_status, "inconsistent_supplied_negative"); assert.deepEqual(r.blockers, expected);
});
test("C-C1a negative model refuses a teardown summary that claims authority", () => {
  const o = negative(); o.ownership = { ...o.ownership, cleanup_execution_available: true };
  assert.throws(() => api.assessUnsignedNegativeModel(o), { message: "cc1a_invalid_input" });
});
test("C-C1a's inert harness only inspects; no flag, token or direct execute call can unlock native work", async () => {
  const harness = await import("../helpers/jointUnsignedHarness.mjs");
  const args = ["--inspect", "--stage", "C-C1a", "--run-id", "invented-run", "--source-commit", "a".repeat(40), "--patch-sha256", "b".repeat(64)];
  assert.equal(harness.inspectUnsignedHarness(args).cases.length, 24);
  for (const bad of [[], [...args, "--execute"], args.map((s) => s === "C-C1a" ? "C-C1b" : s), ["--approved", ...args]])
    assert.throws(() => harness.inspectUnsignedHarness(bad), /cc1a_/);
  for (const raw of [undefined, request(), { approved: true, stage: "C-C1b" }, { token: {} }])
    await assert.rejects(harness.executeUnsignedHarness(raw), /cc1a_execution_not_approved/);
});
for (const [name, change] of [
  ["lost supervisor", (o) => { o.supervisor = "lost"; }], ["lost worker", (o) => { o.worker = "lost"; }],
  ["unknown chain", (o) => { o.ancestor_chain = "unknown"; }], ["changed chain", (o) => { o.ancestor_chain = "changed"; }],
  ["receipt failure", (o) => { o.receipt = "failed"; }], ["unconfirmed native", (o) => { o.native = "unconfirmed"; }],
  ["unconfirmed query", (o) => { o.query = "unconfirmed"; }], ["unretired operation", (o) => { o.original_operation_retired = false; }],
  ["zero counters without release", (o) => { o.query_released = false; }],
  ["remaining native FD", (o) => { o.resources.fds_after = "1"; }], ["remaining root", (o) => { o.resources.roots_after = "2"; }],
  ["remaining workspace", (o) => { o.resources.workspace_after = "4096"; }],
  ["missing entry", (o) => { o.entries.pop(); }], ["extra entry", (o) => { o.entries.push({ ...o.entries[0], path: "unowned" }); }],
  ["duplicate entry", (o) => { o.entries[1] = o.entries[0]; }], ["changed root", (o) => { o.entries[0].proof.inode = "999"; }],
  ["changed owner", (o) => { o.entries[1].proof.uid = "502"; }], ["changed device", (o) => { o.entries[1].proof.device = "2"; }],
  ["changed ACL", (o) => { o.entries[1].proof.acl_hash = "d".repeat(64); }],
  ["changed file", (o) => { o.entries.find((e) => e.proof.kind === "file").proof.sha256 = "d".repeat(64); }],
]) test(`C-C1a holds on ${name} and never clears the stop on a later good observation`, () => {
  const { model, entries } = ownership(), o = cleanup(structuredClone(entries)); change(o);
  assert.equal(model.assessCleanup(o).decision, "hold");
  assert.equal(model.assessCleanup(cleanup(entries)).decision, "hold"); assert.notEqual(model.describe().stopped, null);
});
for (const [name, change, reason] of [
  ["an unexpected .DS_Store", (o) => { o.entries.find((e) => e.path === "store").children.push(".DS_Store"); }, "directory_contents_changed"],
  ["a missing directory listing", (o) => { o.entries.find((e) => e.path === "").children = null; }, "directory_contents_changed"],
  ["a listed child gone", (o) => { o.entries.find((e) => e.path === "admission-witness").children = []; }, "directory_contents_changed"],
  ["a file with a listing", (o) => { o.entries.find((e) => e.path === "store/policy.json").children = []; }, "entry_changed"],
]) test(`C-C1a holds on ${name} before deleting anything`, () => {
  const { model, entries } = ownership(), o = cleanup(entries); change(o);
  const a = model.assessCleanup(o); assert.equal(a.decision, "hold"); assert.equal(a.reason, reason);
  assert.deepEqual(model.describe().removed_paths, []);
});
test("C-C1a permits only a supplied never-started rollback after setup abort", () => {
  const { model, r } = partial(), entry = proofFor(r.entries[0], 0); model.recordCreation(created(r.entries[0], 0)); model.abortSetup();
  const o = cleanup([entry], { worker: "never_started", query: "never_started", native: "never_started", original_operation_retired: false, query_released: false });
  assert.equal(model.assessCleanup(o).decision, "supplied_next_entry");
  model.recordRemoval({ observation: o, path: "", outcome: "removed", receipt_write: "confirmed" });
  assert.equal(model.assessCleanup({ ...o, entries: [], fixture_absent: true }).decision, "supplied_complete");
});
for (const [name, aborted, changes] of [
  ["a complete setup reported as never started", false, { worker: "never_started", query: "never_started", native: "never_started", original_operation_retired: false, query_released: false }],
  ["an aborted setup with a live worker", true, { worker: "live", query: "never_started", native: "never_started" }],
  ["an aborted setup with a settled query", true, { worker: "never_started", query: "settled", native: "never_started" }],
  ["an aborted setup with settled native work", true, { worker: "never_started", query: "never_started", native: "settled" }],
]) test(`C-C1a refuses rollback for ${name}`, () => {
  let model, entries;
  if (aborted) { const p = partial(); p.model.recordCreation(created(p.r.entries[0], 0)); p.model.abortSetup(); model = p.model; entries = [proofFor(p.r.entries[0], 0)]; }
  else ({ model, entries } = ownership());
  const a = model.assessCleanup(cleanup(entries, changes));
  assert.equal(a.decision, "hold"); assert.equal(a.reason, "release_unconfirmed");
});
test("C-C1a creation receipts stop on unrecorded or unsafe creations instead of adopting an observed tree", () => {
  for (const change of [(e) => { e.path = "../outside"; }, (e) => { e.proof.uid = "502"; }, (e) => { e.proof.inode = "100"; },
    (e) => { e.proof.flags = "1"; }, (e) => { e.proof.acl = "allow"; }, (e) => { e.proof.nlink = "2"; },
    (e) => { e.proof.size = "999"; }, (e) => { e.proof.sha256 = "f".repeat(64); }]) {
    const { model, r } = partial();
    model.recordCreation(created(r.entries[0], 0));
    for (let i = 1; i < 3; i++) model.recordCreation(created(r.entries[i], i));
    const e = created(r.entries[3], 3); change(e); assert.throws(() => model.recordCreation(e), /cc1a_/);
    assert.equal(model.describe().entries.length, 3); assert.notEqual(model.describe().stopped, null);
  }
});
const root = (m, r) => m.recordCreation(created(r.entries[0], 0));
const all = (m, r) => { r.entries.forEach((e, n) => m.recordCreation(created(e, n))); m.finishSetup(); };
const altered = (entry, n, change) => { const e = created(entry, n); change(e); return e; };
for (const [name, code, act] of [
  ["an unknown path", "creation_binding", (m, r) => { root(m, r); m.recordCreation({ ...created(r.entries[1], 1), path: "store2" }); }],
  ["a duplicate path", "creation_binding", (m, r) => { root(m, r); m.recordCreation(created(r.entries[0], 1)); }],
  ["a missing parent", "parent_required", (m, r) => { root(m, r); m.recordCreation(created(r.entries.find((e) => e.path === "store/policy.json"), 1)); }],
  ["a wrong kind", "creation_proof", (m, r) => { root(m, r); m.recordCreation(altered(r.entries[1], 1, (e) => { e.proof.kind = "file"; })); }],
  ["a wrong mode", "creation_proof", (m, r) => { root(m, r); m.recordCreation(altered(r.entries[3], 3, (e) => { e.proof.mode = "16832"; })); }],
  ["a wrong group", "creation_proof", (m, r) => { m.recordCreation(altered(r.entries[0], 0, (e) => { e.proof.gid = "0"; })); }],
  ["a directory hash", "creation_proof", (m, r) => { m.recordCreation(altered(r.entries[0], 0, (e) => { e.proof.sha256 = "c".repeat(64); })); }],
  ["a non-empty new directory", "creation_proof", (m, r) => { m.recordCreation(altered(r.entries[0], 0, (e) => { e.children = [".DS_Store"]; })); }],
  ["a file listing", "creation_proof", (m, r) => { root(m, r); m.recordCreation(altered(r.entries[3], 3, (e) => { e.children = []; })); }],
  ["a device crossing", "object_alias_or_device", (m, r) => { root(m, r); m.recordCreation(altered(r.entries[1], 1, (e) => { e.proof.device = "2"; })); }],
  ["an inode alias", "object_alias_or_device", (m, r) => { root(m, r); m.recordCreation(altered(r.entries[1], 1, (e) => { e.proof.inode = "100"; })); }],
  ["an early finish", "setup_incomplete", (m, r) => { root(m, r); m.finishSetup(); }],
  ["a creation after finish", "phase_order", (m, r) => { all(m, r); m.recordCreation(created(r.entries[0], 99)); }],
  ["an abort after finish", "phase_order", (m, r) => { all(m, r); m.abortSetup(); }],
]) test(`C-C1a creation refuses ${name} with ${code} and latches it`, () => {
  const { model, r } = partial();
  assert.throws(() => act(model, r), { message: `cc1a_${code}` });
  assert.equal(model.describe().stopped, code);
});
test("C-C1a keeps a creation whose receipt write failed but stops setup, abort and cleanup", () => {
  const { model, r } = partial(); root(model, r);
  assert.equal(model.recordCreation({ ...created(r.entries[1], 1), receipt_write: "failed" }).stopped, "creation_receipt_failure");
  assert.deepEqual(model.describe().entries.map((e) => e.path), ["", "store"]);
  assert.throws(() => model.abortSetup(), { message: "cc1a_model_stopped" });
  const never = { worker: "never_started", query: "never_started", native: "never_started", original_operation_retired: false, query_released: false };
  assert.equal(model.assessCleanup(cleanup(r.entries.slice(0, 2).map(proofFor), never)).decision, "hold");
});
test("C-C1a rejects a replayed receipt and out-of-order removal rather than minting cleanup authority", () => {
  const { model, entries } = ownership();
  assert.throws(() => api.createUnsignedOwnershipModel(model.describe()), /cc1a_invalid_input/);
  assert.throws(() => model.recordRemoval({ observation: cleanup(entries), path: "", outcome: "removed", receipt_write: "confirmed" }), /removal_order/);
  assert.deepEqual(model.describe().removed_paths, []); assert.notEqual(model.describe().stopped, null);
});
for (const [outcome, receipt_write] of [["missing", "confirmed"], ["changed", "confirmed"], ["error", "confirmed"], ["removed", "failed"]])
  test(`C-C1a retains partial cleanup on ${outcome}/${receipt_write} with no retry`, () => {
    const { model, entries } = ownership(), observation = cleanup(entries), next = model.assessCleanup(observation).next_entry.path;
    const before = model.describe(); model.recordRemoval({ observation, path: next, outcome, receipt_write });
    assert.equal(model.describe().removed_paths.includes(next), outcome === "removed");
    assert.equal(model.assessCleanup(observation).decision, "hold"); assert.equal(before.history.length + 1, model.describe().history.length);
    assert.throws(() => model.recordRemoval({ observation, path: next, outcome: "removed", receipt_write: "confirmed" }), /model_stopped/);
  });
test("C-C1a tolerates directory size/link changes from owned child work, never immutable identity changes", () => {
  const { model, entries } = ownership(), changed = structuredClone(entries);
  for (const e of changed) if (e.proof.kind === "directory") { e.proof.size = "2048"; e.proof.nlink = "5"; }
  assert.equal(model.assessCleanup(cleanup(changed)).decision, "supplied_next_entry");
  changed[0].proof.birthtime_ns = "124"; assert.equal(model.assessCleanup(cleanup(changed)).decision, "hold");
});
for (const [name, change] of [
  ["native stage", (m) => { m.stage = "C-C1b"; }], ["path override", (m) => { m.path = "/private/tmp/x"; }],
  ["backend", (m) => { m.backend = {}; }], ["clock", (m) => { m.clock = {}; }], ["grant", (m) => { m.grant = {}; }],
  ["approval", (m) => { m.approved = true; }], ["case override", (m) => { m.cases = []; }], ["mode override", (m) => { m.mode = "common"; }],
  ["extra signature", (m) => { m.signature_hex = "0".repeat(128); }], ["limits", (m) => { m.limits = {}; }],
  ["getter", (m) => { Object.defineProperty(m, "stage", { enumerable: true, get() { throw Error("getter_called"); } }); }],
  ["cyclic data", (m) => { m.cycle = m; }], ["hidden data", (m) => { Object.defineProperty(m, "secret", { value: true }); }],
]) test(`C-C1a rejects ${name} in a plan`, () => {
  const m = request(); change(m); assert.throws(() => api.describeUnsignedAcceptanceRun(m), /cc1a_/);
});
test("C-C1a binds every declaration and returns detached immutable reports", () => {
  const m = request(), a = api.describeUnsignedAcceptanceRun(m); m.patch_sha256 = "e".repeat(64);
  assert.notEqual(api.describeUnsignedAcceptanceRun(m).plan_sha256, a.plan_sha256);
  assert.equal(api.describeUnsignedAcceptanceRun(Object.fromEntries(Object.entries(request()).reverse())).plan_sha256, a.plan_sha256);
  const n = negative(); n.plan_sha256 = "e".repeat(64); assert.throws(() => api.assessUnsignedNegativeModel(n), /plan_binding/);
  const o = negative(), r = api.assessUnsignedNegativeModel(o); o.phases.length = 0;
  assert.ok(r.supplied_observation.phases.length); assert.throws(() => r.supplied_observation.phases.pop(), TypeError);
});
test("C-C1a rejects invented positive facts on paths that never captured bytes or inventoried markers", () => {
  const o = negative("u0-unavailable"); o.capture_matches_setup = true; o.markers_zero_unreadable = true;
  assert.deepEqual(api.assessUnsignedNegativeModel(o).blockers, ["byte_comparison", "marker_encoding"]);
});
test("C-C1a cases agree with C-C0's corrected refusal vocabulary without unlocking its ledger", async () => {
  const { describeJointAcceptancePlan } = await import("../helpers/jointAcceptanceContracts.mjs");
  const plan = api.describeUnsignedAcceptanceRun(request());
  const c0 = describeJointAcceptancePlan({ schema: "native-bar-joint-acceptance-plan-v1", run_id: "check-vocabulary", stage: "C-C1",
    source: { commit: "a".repeat(40), patch_sha256: "b".repeat(64) }, build: { mode: "normal", profile: "synthetic-only-protocol-6", source_sha256: "c".repeat(64), addon_sha256: null },
    ownership: { anchor: "private_tmp", creation: "exclusive_new", teardown: "receipt_bounded_node", ancestor_headroom_bytes: "196608" },
    cases: plan.cases.filter((c) => c.mode === "normal").map((c) => ({ case_id: c.case_id, row: c.row, expected_layer: c.expected_layer,
      expected_code: c.expected_code.slice(5), envelope_sha256: "d".repeat(64) })) });
  assert.equal(c0.cases.length, 12); assert.equal(c0.execution_available, false);
  assert.ok(c0.cases.every((c) => c.required_stage === "C-C1"));
});
test("C-C1a recipe bytes bind the v6 markers/profile and independent SHA-256 expectations", () => {
  for (const case_id of ["u1-unsigned", "u2-extra", "u3-maintenance", "u4-expected-inode"]) {
    const r = api.describeUnsignedFixture(fixture(case_id));
    for (const e of r.entries.filter((e) => e.kind === "file")) assert.equal(e.sha256, createHash("sha256").update(e.content).digest("hex"));
    const policy = r.entries.find((e) => e.path === "store/policy.json"), marker = JSON.parse(r.entries.find((e) => e.path === ".native-bar-admission-synthetic").content);
    assert.equal(policy.content, '{"schema":"native-bar-synthetic-admission-profile-v6"}'); assert.equal(marker.policy_hash, policy.sha256);
    assert.equal(marker.fixture_id, id(1)); assert.equal(marker.store_id, id(2));
    assert.equal(r.entries.find((e) => e.path === ".native-bar-fs-synthetic").size, "21");
  }
});
test("C-C1a rejects malformed ownership observations and has no persisted-receipt recovery or execution surface", () => {
  for (const change of [(o) => { o.entries[0].proof.kind = "symlink"; }, (o) => { o.entries[0].proof.flags = "1"; },
    (o) => { o.entries[0].proof.acl = "allow"; }, (o) => { Object.defineProperty(o, "query", { enumerable: true, get() { throw Error("getter_called"); } }); }]) {
    const { model, entries } = ownership(), o = cleanup(structuredClone(entries)); change(o);
    assert.throws(() => model.assessCleanup(o), /cc1a_/); assert.equal(model.assessCleanup(cleanup(entries)).decision, "hold");
    assert.equal(model.describe().cleanup_execution_available, false);
    for (const key of ["run", "execute", "restore", "loadReceipt", "cleanup", "beginRead"]) assert.equal(key in model, false);
  }
});
test("C-C1a's runner import is inert and native-stage arguments remain rejected", async () => {
  const { inspectJointAdmissionArguments } = await import("../../native/native_bar_fs/test_joint_admission.mjs");
  assert.throws(() => inspectJointAdmissionArguments([]), /cc1a_/);
  assert.throws(() => inspectJointAdmissionArguments(["--execute", "--stage", "C-C1b"]), /cc1a_/);
});
test("C-C1a cannot rewrite both resource samples to conceal a changed original baseline", () => {
  const { model, entries } = ownership(), o = cleanup(entries);
  o.resources = { fds_before: "1", fds_after: "1", roots_before: "2", roots_after: "2", workspace_before: "4096", workspace_after: "4096" };
  assert.equal(model.assessCleanup(o).decision, "hold");
  assert.equal(model.assessCleanup(cleanup(entries)).decision, "hold");
});
test("C-C1a latches the final absence uncertainty instead of accepting a later self-reported recovery", () => {
  const model = torndown("u1-unsigned", "normal", false);
  assert.equal(model.assessCleanup(cleanup([])).decision, "hold");
  assert.equal(model.describe().stopped, "absence_unconfirmed");
  assert.equal(model.assessCleanup(cleanup([], { fixture_absent: true })).decision, "hold");
});
for (const key of ["fds", "roots", "workspace"]) test(`C-C1a binds the original ${key} sample independently`, () => {
  const { model, entries } = ownership(), o = cleanup(entries);
  o.resources[`${key}_before`] = o.resources[`${key}_after`] = "1";
  const assessed = model.assessCleanup(o);
  assert.equal(assessed.decision, "hold"); assert.equal(assessed.reason, "resource_baseline_changed");
});
test("C-C1a detaches an explicit nonzero baseline and never silently assumes zero", () => {
  const initial = { fds: "3", roots: "2", workspace: "4096" }, { model, entries } = ownership("u1-unsigned", initial);
  initial.fds = "9";
  assert.deepEqual(model.describe().baseline_resources, { fds: "3", roots: "2", workspace: "4096" });
  assert.ok(Object.isFrozen(model.describe().baseline_resources));
  const o = cleanup(entries);
  for (const [key, value] of Object.entries(model.describe().baseline_resources)) o.resources[`${key}_before`] = o.resources[`${key}_after`] = value;
  assert.equal(model.assessCleanup(o).decision, "supplied_next_entry");
  assert.equal(model.assessCleanup(cleanup(entries)).decision, "hold");
});
test("C-C1a requires an explicit baseline rather than reconstructing one from cleanup observations", () => {
  const raw = { fixture: fixture(), supervisor_id: "s", worker_id: "w", uid: "501", gid: "20" };
  assert.throws(() => api.createUnsignedOwnershipModel(raw), /cc1a_invalid_input/);
  assert.throws(() => api.createUnsignedOwnershipModel({ ...raw, baseline_resources: { fds: "0", roots: "0" } }), /cc1a_invalid_input/);
});
