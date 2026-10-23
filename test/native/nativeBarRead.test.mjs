import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { openSyntheticNativeBarReader, openSyntheticNativeBarFs } from "../../build/nativeBarFs.js";

const native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node");
const id = "01234567-89ab-4cde-8fab-0123456789ab";
function fixture(t) {
  const base = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "native-bar-fs-synthetic-"));
  fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(join(base, ".native-bar-fs-synthetic"), "synthetic-fixture-v1\n", { mode: 0o600 });
  const root = join(base, "store"); fs.mkdirSync(root, { mode: 0o700 }); return { base, root };
}
function capture(f, bytes = "invented-only\n") {
  const dir = join(f.root, "captures", "2026-10-23"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.json`); fs.writeFileSync(path, bytes, { mode: 0o600 }); return path;
}
test("read-only native inventory qualifies an empty synthetic root without creating any entries", (t) => {
  const f = fixture(t), before = native.info().live_fds;
  const reader = openSyntheticNativeBarReader(f.root); const snapshot = reader.inventory();
  assert.equal(snapshot.report.schema, "native-bar-native-inventory-v2");
  assert.equal(snapshot.report.execution_available, false); assert.equal(snapshot.report.inventory_complete, true);
  assert.equal(snapshot.report.volume.filesystem, "apfs"); assert.deepEqual(snapshot.report.entries, []);
  snapshot.close(); reader.close(); reader.close();
  assert.deepEqual(fs.readdirSync(f.root), []); assert.equal(native.info().live_fds, before);
});
test("bounded native evidence has actual birthtime, ACL, hash and a final explicit inventory verification", (t) => {
  const f = fixture(t), path = capture(f), st = fs.statSync(path, { bigint: true });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
  const index = snapshot.report.entries.findIndex((e) => e.path.endsWith(`${id}.json`));
  const entry = snapshot.report.entries[index]; assert.equal(entry.proof.birthtime_ns, st.birthtimeNs.toString());
  assert.equal(entry.proof.ctime_ns, st.ctimeNs.toString()); assert.equal(entry.proof.acl, "none");
  assert.equal(snapshot.report.namespace_qualified, true); assert.equal(snapshot.report.elapsed_clock_qualified, false);
  const result = snapshot.readEvidence(index); assert.equal(result.bytes.toString(), "invented-only\n");
  assert.equal(result.proof.sha256, createHash("sha256").update(result.bytes).digest("hex"));
  assert.equal(result.proof.birthtime_ns, st.birthtimeNs.toString()); assert.deepEqual(snapshot.verify(), { matches: true, execution_available: false });
  snapshot.report.entries[index].path = "../../victim"; result.bytes.fill(0);
  assert.equal(snapshot.readEvidence(index).bytes.toString(), "invented-only\n");
  snapshot.close(); assert.throws(() => snapshot.readEvidence(index), /closed/);
});
test("read leases cannot enter legacy inspect/stage and closing snapshots or leases creates nothing", (t) => {
  const f = fixture(t); const path = capture(f), before = fs.readFileSync(path);
  const handle = native.openReadRoot(f.root, 600000);
  assert.throws(() => native.inspect(handle, "captures", "2026-10-23", `${id}.json`), /read_only_session/);
  assert.throws(() => native.stage(handle, undefined), /invalid_target_handle/);
  assert.throws(() => native.purge(handle, undefined), /invalid_target_handle/);
  native.closeRoot(handle); assert.deepEqual(fs.readFileSync(path), before);
  assert.deepEqual(fs.readdirSync(f.root), ["captures"]);
});
for (const kind of ["symlink", "fifo", "hardlink", "oversize", "unsafe-mode", "unknown"]) test(`inventory preserves ${kind} without reading or deleting its bytes`, (t) => {
  const f = fixture(t), path = capture(f); fs.unlinkSync(path);
  const victim = join(f.base, "victim"); fs.writeFileSync(victim, "outside-fixture-store", { mode: 0o600 });
  if (kind === "symlink") fs.symlinkSync(victim, path);
  else if (kind === "fifo") assert.equal(spawnSync("/usr/bin/mkfifo", [path]).status, 0);
  else if (kind === "hardlink") fs.linkSync(victim, path);
  else fs.writeFileSync(path, kind === "oversize" ? Buffer.alloc(1024 * 1024 + 1) : "invented", { mode: kind === "unsafe-mode" ? 0o644 : 0o600 });
  if (kind === "unknown") fs.renameSync(path, join(f.root, ".DS_Store"));
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
  const index = snapshot.report.entries.findIndex((e) => e.kind !== "directory");
  assert.equal(snapshot.report.entries[index].readable_evidence, false);
  assert.throws(() => snapshot.readEvidence(index), /evidence_not_readable/);
  assert.equal(fs.readFileSync(victim, "utf8"), "outside-fixture-store"); assert.equal(snapshot.verify().matches, true);
});
for (const phase of ["inventory_between_passes", "read_before_open", "read_after_bytes", "verify_before_scan"]) test(`read view rejects content or namespace changes at ${phase}`, (t) => {
  const f = fixture(t), path = capture(f), reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close());
  const change = (at) => { if (at === phase) fs.writeFileSync(path, "changed-invented-bytes"); };
  if (phase === "inventory_between_passes") assert.throws(() => reader.inventory({ hook: change }), /inventory_changed/);
  else {
    const snapshot = reader.inventory(), index = snapshot.report.entries.findIndex((e) => e.path.endsWith(".json"));
    assert.throws(() => phase === "verify_before_scan" ? snapshot.verify(change) : snapshot.readEvidence(index, change), /inventory_changed|evidence_read_changed/);
  }
  assert.equal(fs.readFileSync(path, "utf8"), "changed-invented-bytes");
});
for (const level of ["root", "parent", "file"]) test(`read cannot follow a substituted ${level} into a sibling victim`, (t) => {
  const f = fixture(t), path = capture(f), victim = join(f.base, "victim");
  fs.mkdirSync(victim, { mode: 0o700 }); fs.writeFileSync(join(victim, `${id}.json`), "outside", { mode: 0o600 });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
  const index = snapshot.report.entries.findIndex((e) => e.path.endsWith(".json"));
  const original = level === "root" ? f.root : level === "parent" ? join(path, "..") : path;
  assert.throws(() => snapshot.readEvidence(index, (phase) => {
    if (phase !== "read_before_open") return;
    const selected = level === "parent" ? join(f.root, "captures", "2026-10-23") : original;
    fs.renameSync(selected, selected + ".original"); fs.symlinkSync(level === "file" ? join(victim, `${id}.json`) : victim, selected);
  }), /namespace_changed|inventory_changed|open_failed/);
  assert.equal(fs.readFileSync(join(victim, `${id}.json`), "utf8"), "outside");
});
test("malformed private namespaces and case variants are visible but cannot qualify as execution evidence", (t) => {
  const f = fixture(t); fs.mkdirSync(join(f.root, "maintenance-hold", id), { recursive: true, mode: 0o700 });
  fs.writeFileSync(join(f.root, "maintenance-hold", id, "unexpected.stage"), "preserve", { mode: 0o600 });
  fs.mkdirSync(join(f.root, "Receipts"), { mode: 0o700 });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
  assert.equal(snapshot.report.inventory_complete, true); assert.equal(snapshot.report.namespace_qualified, false);
  const e = snapshot.report.entries.find((e) => e.path.endsWith("unexpected.stage")); assert.equal(e.readable_evidence, false);
  assert.equal(fs.readFileSync(join(f.root, e.path), "utf8"), "preserve");
});
test("opaque entry indices do not accept caller paths or a snapshot from another lease", (t) => {
  const f = fixture(t); capture(f); const a = native.openReadRoot(f.root, 600000), b = native.openReadRoot(f.root, 600000);
  t.after(() => { native.closeRoot(a); native.closeRoot(b); }); const snapshot = native.inventory(a, undefined, undefined);
  assert.throws(() => native.readEvidence(a, snapshot, "../../victim", undefined), /native_argument_error/);
  for (const index of [-1, 0.5, NaN, Infinity, 99999]) assert.throws(() => native.readEvidence(a, snapshot, index, undefined));
  assert.throws(() => native.readEvidence(b, snapshot, 2, undefined), /wrong_session/);
  assert.throws(() => native.verifyInventory(a, { report: snapshot.report }, undefined), /invalid_inventory_handle/);
});
test("only one live snapshot is retained per lease and read budgets survive close/re-enumeration", (t) => {
  const f = fixture(t); capture(f, "12345678"); const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close());
  const first = reader.inventory({ limits: { read_bytes: 8 } }), index = first.report.entries.findIndex((e) => e.path.endsWith(".json"));
  assert.throws(() => reader.inventory(), /inventory_already_open/); assert.equal(first.readEvidence(index).lease_read_bytes, "8");
  assert.throws(() => first.readEvidence(index), /evidence_read_budget/); first.close();
  const second = reader.inventory({ limits: { read_bytes: 8 } }); assert.throws(() => second.readEvidence(index), /evidence_read_budget/);
  reader.close(); assert.throws(() => second.verify(), /session_closed/);
});
for (const [field, limit, error] of [["entries", 2, /entry_limit/], ["inventory_bytes", 1, /byte_limit/], ["metadata_bytes", 1, /metadata_limit/], ["response_bytes", 1, /response_limit/]]) test(`native ${field} ceiling refuses without truncating the inventory`, (t) => {
  const f = fixture(t); capture(f); fs.writeFileSync(join(f.root, "policy.json"), "{}", { mode: 0o600 });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close());
  assert.throws(() => reader.inventory({ limits: { [field]: limit } }), error); assert.equal(fs.readFileSync(join(f.root, "policy.json"), "utf8"), "{}");
  assert.equal(reader.inventory().report.inventory_complete, true);
});
test("read limits cannot be raised or extended with unknown fields", (t) => {
  const f = fixture(t), reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close());
  for (const limits of [{ entries: 30001 }, { read_bytes: 256 * 1024 ** 2 + 1 }, { response_bytes: Infinity }, { entries: NaN }, { entries: 0 }, { force: true }]) {
    assert.throws(() => reader.inventory({ limits }), /invalid_read_limits/);
  }
});
test("missing/read-only roots never cause directory, marker, lock or capability-probe creation", (t) => {
  const f = fixture(t); fs.rmdirSync(f.root); assert.throws(() => openSyntheticNativeBarReader(f.root), /open_failed/);
  assert.equal(fs.existsSync(f.root), false); fs.mkdirSync(f.root, { mode: 0o500 });
  const reader = openSyntheticNativeBarReader(f.root), snapshot = reader.inventory(); snapshot.close(); reader.close();
  assert.deepEqual(fs.readdirSync(f.root), []); fs.chmodSync(f.root, 0o700);
});
test("expired read leases release references and cannot be renewed by a new snapshot", async (t) => {
  const f = fixture(t); capture(f); const before = native.info().live_fds, reader = openSyntheticNativeBarReader(f.root, 20);
  const snapshot = reader.inventory(); await new Promise((r) => setTimeout(r, 35));
  assert.throws(() => snapshot.readEvidence(2), /session_expired/); assert.throws(() => reader.inventory(), /session_closed/);
  assert.equal(native.info().live_fds, before); assert.equal(fs.readdirSync(f.root).includes("maintenance-hold"), false);
});
test("evidence serialization cannot return success after the original lease expires", (t) => {
  const f = fixture(t); capture(f); const before = native.info().live_fds;
  const reader = openSyntheticNativeBarReader(f.root, 1000); t.after(() => reader.close());
  const snapshot = reader.inventory(), index = snapshot.report.entries.findIndex((e) => e.path.endsWith(".json"));
  let serialized = false;
  // A JS setter can run while Node-API assembles the last response field.
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "lease_read_bytes");
  Object.defineProperty(Object.prototype, "lease_read_bytes", { configurable: true, set() {
    serialized = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
  } });
  try { assert.throws(() => snapshot.readEvidence(index), /session_expired/); }
  finally {
    if (previous) Object.defineProperty(Object.prototype, "lease_read_bytes", previous);
    else delete Object.prototype.lease_read_bytes;
  }
  assert.equal(serialized, true); assert.equal(native.info().live_fds, before);
  assert.throws(() => snapshot.verify(), /session_closed/);
});
for (const level of ["file", "parent", "root"]) test(`actual ACL allow at ${level} refuses a trusted read without permission repair`, (t) => {
  const f = fixture(t), path = capture(f), chosen = level === "file" ? path : level === "parent" ? join(f.root, "captures") : f.root;
  const add = spawnSync("/bin/chmod", ["+a", "everyone allow read,write", chosen]); assert.equal(add.status, 0, add.stderr?.toString());
  t.after(() => spawnSync("/bin/chmod", ["-N", chosen]));
  if (level === "root") assert.throws(() => openSyntheticNativeBarReader(f.root), /unsafe_acl/);
  else if (level === "parent") { const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); assert.throws(() => reader.inventory(), /unsafe_acl/); }
  else {
    // A grant on one file preserves that file as unreadable instead of aborting every inventory.
    const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
    const index = snapshot.report.entries.findIndex((e) => e.path.endsWith(".json")), entry = snapshot.report.entries[index];
    assert.equal(entry.proof.acl, "unsafe"); assert.equal(entry.reason, "preserved_unsafe_acl"); assert.equal(entry.readable_evidence, false);
    assert.throws(() => snapshot.readEvidence(index), /evidence_not_readable/); snapshot.close();
  }
  assert.equal(fs.readFileSync(path, "utf8"), "invented-only\n");
});
test("deny-only ACL survives native proof collection and an inherited grant is refused", (t) => {
  const f = fixture(t), path = capture(f);
  assert.equal(spawnSync("/bin/chmod", ["+a", "everyone deny write", path]).status, 0);
  t.after(() => spawnSync("/bin/chmod", ["-N", path]));
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
  const index = snapshot.report.entries.findIndex((e) => e.path.endsWith(".json"));
  assert.equal(snapshot.readEvidence(index).proof.acl, "deny_only"); snapshot.close();
  const inherited = join(f.root, "inherited"); fs.mkdirSync(inherited, { mode: 0o700 });
  assert.equal(spawnSync("/bin/chmod", ["+a", "everyone allow read,write,file_inherit,directory_inherit", inherited]).status, 0);
  t.after(() => spawnSync("/bin/chmod", ["-N", inherited])); fs.mkdirSync(join(inherited, "child"), { mode: 0o700 });
  t.after(() => spawnSync("/bin/chmod", ["-N", join(inherited, "child")]));
  assert.throws(() => reader.inventory(), /unsafe_acl/);
});
test("negative mtime is lossless and zero/exact-limit evidence is bounded before allocation", (t) => {
  const f = fixture(t), path = capture(f, Buffer.alloc(1024 * 1024, 65)); fs.utimesSync(path, new Date(-500), new Date(-500));
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); let snapshot = reader.inventory();
  let index = snapshot.report.entries.findIndex((e) => e.path.endsWith(".json"));
  assert.equal(snapshot.readEvidence(index).proof.mtime_ns, "-500000000"); snapshot.close();
  fs.writeFileSync(path, ""); snapshot = reader.inventory(); index = snapshot.report.entries.findIndex((e) => e.path.endsWith(".json"));
  assert.equal(snapshot.readEvidence(index).bytes.length, 0);
});
test("Unicode names are preserved as observed, canonical case renames invalidate an old snapshot", (t) => {
  const f = fixture(t), path = capture(f); fs.writeFileSync(join(f.root, "caf\u00e9"), "unknown", { mode: 0o600 });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
  assert.ok(snapshot.report.entries.some((e) => e.path.normalize("NFC") === "caf\u00e9" && !e.readable_evidence));
  fs.renameSync(path, join(path, "..", `${id.toUpperCase()}.json`));
  assert.throws(() => snapshot.readEvidence(snapshot.report.entries.findIndex((e) => e.path.endsWith(".json"))), /exact_name_changed|inventory_changed/);
  assert.throws(() => snapshot.verify(), /inventory_changed/);
});
test("wrong kinds at private directory names do not qualify", (t) => {
  const f = fixture(t); fs.writeFileSync(join(f.root, "maintenance"), "not-a-directory", { mode: 0o600 });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close());
  assert.equal(reader.inventory().report.namespace_qualified, false);
});
test("case variants of the abandoned namespace cannot qualify", (t) => {
  const f = fixture(t); fs.mkdirSync(join(f.root, "quarantine", "Abandoned"), { recursive: true, mode: 0o700 });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close());
  assert.equal(reader.inventory().report.namespace_qualified, false);
});
test("reentrant/async hooks cannot close an active lease or leave it unusable after refusal", (t) => {
  const f = fixture(t), reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close());
  assert.throws(() => reader.inventory({ hook: () => reader.close() }), /session_busy/);
  assert.throws(() => reader.inventory({ hook: async () => {} }), /test_hook_must_be_synchronous_void/);
  const snapshot = reader.inventory(); assert.equal(snapshot.verify().matches, true);
});
test("failed enumeration and explicit/GC close recover all native references without deletion", (t) => {
  const f = fixture(t), path = capture(f), before = native.info();
  for (let i = 0; i < 15; i++) {
    const reader = openSyntheticNativeBarReader(f.root);
    assert.throws(() => reader.inventory({ limits: { entries: 1 } }), /entry_limit/); reader.close();
  }
  assert.equal(native.info().live_fds, before.live_fds); assert.equal(native.info().live_sessions, before.live_sessions);
  const loader = new URL("../../build/nativeBarFs.js", import.meta.url).href;
  const addon = new URL("../../build/native-bar-fs/native_bar_fs.node", import.meta.url).pathname;
  const child = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
    import { createRequire } from 'node:module';
    const {openSyntheticNativeBarReader} = await import(${JSON.stringify(loader)});
    const native = createRequire(import.meta.url)(${JSON.stringify(addon)});
    (() => { const reader = openSyntheticNativeBarReader(${JSON.stringify(f.root)}); reader.inventory(); })();
    for(let i=0;i<8;i++){global.gc(); await new Promise(r=>setImmediate(r));}
    if(native.info().live_fds || native.info().live_sessions) process.exit(2);
  `], { encoding: "utf8" }); assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.readFileSync(path, "utf8"), "invented-only\n");
});
test("all eight root leases are bounded and read-only roots outside the fixture allowlist refuse", (t) => {
  const f = fixture(t), readers = [];
  try {
    for (let i = 0; i < 8; i++) readers.push(openSyntheticNativeBarReader(f.root));
    assert.throws(() => openSyntheticNativeBarReader(f.root), /native_session_limit/);
    assert.throws(() => openSyntheticNativeBarReader(join(f.base, "other")), /synthetic_root_required/);
    assert.throws(() => openSyntheticNativeBarReader(f.root + "/../store"), /synthetic_root_required/);
  } finally { for (const reader of readers) reader.close(); }
});
for (const name of ["policy.json", `maintenance/${id}.json`, `quarantine/abandoned/${id}/${id}`]) test(`a directory at expected evidence leaf ${name} cannot qualify`, (t) => {
  const f = fixture(t); fs.mkdirSync(join(f.root, name), { recursive: true, mode: 0o700 });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close());
  assert.equal(reader.inventory().report.namespace_qualified, false);
});
test("read traversal obeys the shared descriptor limit and recovers references after refusal", (t) => {
  const f = fixture(t); capture(f); const before = native.info(), writers = [], targets = [];
  const reader = openSyntheticNativeBarReader(f.root);
  try {
    for (let i = 0; i < 7; i++) writers.push(openSyntheticNativeBarFs(f.root));
    let limited = false;
    outer: for (const writer of writers) for (let i = 0; i < 32; i++) {
      try { targets.push(writer.inspect("captures", "2026-10-23", `${id}.json`)); }
      catch (error) { assert.match(error.message, /native_fd_limit/); limited = true; break outer; }
    }
    assert.equal(limited, true); assert.throws(() => reader.inventory(), /native_fd_limit/); assert.ok(native.info().live_fds <= 512);
  } finally { for (const writer of writers) writer.close(); reader.close(); }
  assert.equal(native.info().live_fds, before.live_fds); assert.equal(native.info().live_sessions, before.live_sessions);
});

test("a store-sized inventory fits the response bound", (t) => {
  const f = fixture(t);
  for (const area of ["captures", "receipts"]) for (let d = 0; d < 3; d++) {
    const dir = join(f.root, area, `2026-10-2${d}`); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let i = 0; i < 800; i++) fs.writeFileSync(join(dir, `01234567-89ab-4cde-8fab-${String(d * 1000 + i).padStart(12, "0")}.json`), "x", { mode: 0o600 });
  }
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
  assert.equal(snapshot.report.entries.length, 4808); assert.ok(snapshot.report.entries.every((e) => e.kind === "directory" || e.readable_evidence));
  snapshot.close();
});
test("folded variants of evidence names are unqualified, and non-RFC identifiers are not evidence", (t) => {
  const f = fixture(t), path = capture(f), upper = path.replace(id, id.toUpperCase()); fs.renameSync(path, upper);
  fs.writeFileSync(join(f.root, "captures", "2026-10-23", "00000000-0000-0000-0000-000000000001.json"), "x", { mode: 0o600 });
  const reader = openSyntheticNativeBarReader(f.root); t.after(() => reader.close()); const snapshot = reader.inventory();
  const variant = snapshot.report.entries.find((e) => e.path.endsWith(`${id.toUpperCase()}.json`));
  assert.equal(variant.namespace_qualified, false); assert.equal(variant.readable_evidence, false);
  assert.equal(snapshot.report.namespace_qualified, false);
  const other = snapshot.report.entries.find((e) => e.path.endsWith("000000000001.json"));
  assert.equal(other.reason, "preserved_unknown"); assert.equal(other.readable_evidence, false);
  snapshot.close();
});
