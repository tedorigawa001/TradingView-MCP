import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, readFileSync, statfsSync,
  rmSync, symlinkSync, linkSync, renameSync, realpathSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";

const isolated = process.env.NATIVE_BAR_B2B_ISOLATED_TEST === "1";
const build = new URL(isolated ? "../../build/b2b-validation/" : "../../build/", import.meta.url);
const { canonical, evidenceHash } = await import(new URL("nativeBarEvidence.js", build));
const contracts = await import(new URL("nativeBarAdmissionReadContracts.js", build));
const { createSyntheticAdmissionNativeReadRegistry } = await import(new URL("nativeBarAdmissionReader.js", build));
const eligible = process.platform === "darwin" && isolated && Number(statfsSync("/private/tmp").type) === 0x1a;
const native = eligible ? createRequire(import.meta.url)(fileURLToPath(new URL("native-bar-fs/native_bar_fs.node", build))) : null;
const helper = fileURLToPath(new URL("admission-fixture-expectations", build));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const publicKey = createPublicKey({ key: Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"), type: "spki", format: "der" });
const hash = (v) => createHash("sha256").update(v).digest("hex");
const policy = canonical({ schema: "native-bar-synthetic-admission-profile-v6" });
const limits = { entries: 512, inventory_bytes: 1073741824, metadata_bytes: 16777216, read_bytes: 268435456, response_bytes: 8388608 };
const unsigned = Buffer.from('{"invented":"unsigned B-2b bytes, not admission evidence"}');
function fixture(t, setup = () => {}, anchor = "/private/tmp") {
  // This call exclusively creates the directory we own. Cleanup never accepts an external path.
  const base = mkdtempSync(`${anchor}/native-bar-fs-synthetic-`); chmodSync(base, 0o700);
  let bootstrap;
  t.after(() => { try { bootstrap?.close(); } finally { rmSync(base, { recursive: true, force: true }); } });
  const write = (path, bytes = unsigned) => {
    const dest = join(base, path); mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    writeFileSync(dest, bytes, { flag: "wx", mode: 0o600 }); return dest;
  };
  mkdirSync(join(base, "store"), { mode: 0o700 }); mkdirSync(join(base, "admission-witness"), { mode: 0o700 });
  const pins = { fixture_id: id(1), store_id: id(2), epoch_id: id(3), authority_id: id(4), key_id: id(5),
    enrollment_hash: evidenceHash("invented enrollment"), public_key_spki_sha256: hash(publicKey.export({ type: "spki", format: "der" })) };
  write(".native-bar-fs-synthetic", "synthetic-fixture-v1\n");
  write(".native-bar-admission-synthetic", canonical({ schema: "native-bar-admission-fixture-marker-v1", fixture_id: pins.fixture_id,
    store_id: pins.store_id, epoch_id: pins.epoch_id, policy_hash: hash(policy), data_root: "store", witness_root: "admission-witness" }));
  write("store/policy.json", policy); write("admission-witness/1.json"); write(`store/producer/${id(10)}/1.json`);
  setup({ base, write });
  const observed = spawnSync(helper, [base], { encoding: "utf8" });
  assert.equal(observed.status, 0, observed.stderr); const expectation = JSON.parse(observed.stdout);
  const registration = { schema: "native-bar-admission-read-registration-v1", scope: "synthetic_fixture_only", pins,
    authority_reference: id(6), temp_anchor: anchor, fixture_name: basename(base), policy_hash: hash(policy), ...expectation };
  bootstrap = contracts.createSyntheticAdmissionReadBootstrap({ schema: "native-bar-admission-read-bootstrap-v1", scope: "synthetic_fixture_only",
    pins, authority_reference: id(6), temp_anchor: anchor }, publicKey);
  const registry = createSyntheticAdmissionNativeReadRegistry(bootstrap.token), ticket = registry.registerFixture(registration);
  return { base, write, registration, registry, ticket, bootstrap, begin: (lower, ttl) => registry.beginRead(ticket, lower, ttl),
    raw: (lower = {}, ttl_ms = 600000) => native.beginAdmissionRead(Buffer.from(canonical({ registration, limits: { ...limits, ...lower }, ttl_ms }))) };
}
function noAuthority(facts) {
  for (const key of ["execution_available", "recovery_execution_available", "admission_verified", "approval_authenticated", "view_verified",
    "fixture_signature_verified", "checkpoint_pair_verified", "logical_prefix_verified", "authority_state_verified", "original_intake_verified",
    "committed_history_available", "elapsed_clock_qualified", "physical_capacity_verified"]) assert.equal(facts[key], false, key);
  assert.equal(facts.original_acknowledgement, "not_proven"); assert.equal(facts.storage_visibility_at_as_of, "not_proven");
}
const run = (name, fn) => test(name, { skip: !eligible && "macOS APFS and isolated B-2b build required; not qualified elsewhere" }, (t) => {
  const before = native.info(); t.after(() => {
    assert.equal(native.info().live_fds, before.live_fds, "all native FDs released");
    assert.equal(native.info().live_sessions, before.live_sessions, "all root leases released");
  }); return fn(t);
});
run("B-2b unsigned paired inventory/read/reverify has no admission authority and preserves fixture bytes", (t) => {
  const f = fixture(t), before = readFileSync(join(f.base, "admission-witness/1.json"));
  const c = f.begin(); assert.equal(native.info().live_sessions, 2); assert.equal(native.info().live_fds, 0);
  const snap = c.openPair().inventory(); noAuthority(snap.report); assert.equal(snap.report.inventory_complete, true);
  for (const role of ["witness", "data"]) {
    const e = snap.report.entries.find((e) => e.root_role === role && e.path.endsWith("1.json"));
    const result = snap.readEvidence(role, e.index); assert.deepEqual(result.bytes, unsigned); assert.equal(result.facts.sha256, hash(unsigned));
    assert.equal(result.facts.native_bytes_verified, true); noAuthority(result.facts);
  }
  const verified = snap.verify(); assert.equal(verified.native_snapshot_verified, true); noAuthority(verified);
  assert.equal(snap.verify().joint_generation, verified.joint_generation); snap.close(); snap.close(); c.close(); c.close();
  assert.deepEqual(readFileSync(join(f.base, "admission-witness/1.json")), before);
});
run("B-2b register and begin do not open missing fixture roots", (t) => {
  const f = fixture(t); renameSync(join(f.base, "admission-witness"), join(f.base, "witness-moved"));
  const c = f.begin(); assert.equal(native.info().live_fds, 0); assert.throws(() => c.openPair()); c.close();
});
for (const action of ["closeFixture", "close", "bootstrap"]) run(`B-2b ${action} revokes and releases an active pair`, (t) => {
  const f = fixture(t), c = f.begin(); c.openPair().inventory();
  if (action === "bootstrap") f.bootstrap.close(); else if (action === "close") f.registry.close(); else f.registry.closeFixture(f.ticket);
  assert.equal(native.info().live_fds, 0); assert.equal(native.info().live_sessions, 0); assert.throws(() => c.openPair(), /closed/); c.close();
});
run("B-2b refuses foreign/copied tickets and concurrent reads before native IO", (t) => {
  const f = fixture(t); assert.throws(() => f.registry.beginRead({}), /ticket/); assert.throws(() => f.registry.beginRead(structuredClone(f.ticket)), /ticket/);
  const c = f.begin(); assert.throws(() => f.begin(), /active/); c.close(); const again = f.begin(); again.close();
});
run("B-2b memory bridge is registry-bound, single-active and revokes before cleanup errors", (t) => {
  const f = fixture(t), r = contracts.createSyntheticAdmissionReadRegistry(f.bootstrap.token), ticket = r.registerFixture(f.registration);
  let failed = true, released = 0;
  const claim = contracts.claimSyntheticAdmissionNativeRead(r, ticket, () => { released++; if (failed) throw new Error("invented cleanup failure"); claim.release(); });
  assert.throws(() => contracts.claimSyntheticAdmissionNativeRead(f.registry, ticket, () => {}), /registry/);
  assert.throws(() => r.close()); assert.throws(() => claim.check(), /closed/); failed = false; r.close(); assert.equal(released, 2);
});
run("B-2b native root slots share the legacy global limit and begin never opens roots", (t) => {
  const f = fixture(t), all = [];
  try { for (let i = 0; i < 4; i++) all.push(f.raw()); assert.equal(native.info().live_sessions, 8);
    assert.throws(() => f.raw(), /root_lease/); assert.equal(native.info().live_fds, 0);
  } finally { for (const c of all) native.closeAdmissionRead(c); }
});
run("B-2b native handle tags cannot enter legacy read/mutation/coordination/recovery APIs", (t) => {
  const f = fixture(t), c = f.raw(); const pair = native.openAdmissionReadPair(c); const { snapshot } = native.admissionInventory(pair, undefined);
  try {
    for (const handle of [c, pair, snapshot, {}]) {
      assert.throws(() => native.closeRoot(handle)); assert.throws(() => native.inspect(handle, "captures", "2026-10-25", "invented.json"));
      assert.throws(() => native.inventory(handle, undefined, undefined)); assert.throws(() => native.openCoordination(handle));
      assert.throws(() => native.recoveryWindow(handle)); assert.throws(() => native.stage(handle, undefined));
    }
    assert.throws(() => native.openAdmissionReadPair(pair), /handle/);
    assert.throws(() => native.admissionInventory(c, undefined), /handle/);
  } finally { native.closeAdmissionRead(c); }
});
for (const [field, value] of [["entries", 1], ["inventory_bytes", 1], ["metadata_bytes", 1], ["read_bytes", 1], ["response_bytes", 1]])
  run(`B-2b lower ${field} budget fails closed without resetting per root`, (t) => {
    const f = fixture(t); let c; try { assert.throws(() => { c = f.begin({ [field]: value }); c.openPair().inventory(); }, /limit/); }
    finally { c?.close(); }
  });
run("B-2b wrong expected inode/flags/ACL/volume proof is not replaced by observed values", (t) => {
  const f = fixture(t);
  for (const edit of [(r) => r.bindings.data.inode = "1", (r) => r.bindings.witness.flags = "1", (r) => r.bindings.fixture_parent.acl_hash = "a".repeat(64),
    (r) => r.volume.case_sensitive = !r.volume.case_sensitive]) {
    const registration = structuredClone(f.registration); edit(registration);
    const c = native.beginAdmissionRead(Buffer.from(canonical({ registration, limits, ttl_ms: 600000 })));
    try { assert.throws(() => native.openAdmissionReadPair(c), /binding/); } finally { native.closeAdmissionRead(c); }
  }
});
for (const file of [".native-bar-fs-synthetic", ".native-bar-admission-synthetic", "store/policy.json"])
  run(`B-2b control bytes drift refused: ${file}`, (t) => {
    const f = fixture(t), c = f.begin(), snap = c.openPair().inventory(); writeFileSync(join(f.base, file), "invented drift");
    assert.throws(() => snap.verify(), /changed|control/);c.close();
  });
run("B-2b final verify catches in-place witness drift and invalidates the pair", (t) => {
  const f = fixture(t), c = f.begin(), snap = c.openPair().inventory(), e = snap.report.entries.find((e) => e.root_role === "witness");
  snap.readEvidence("witness", e.index); writeFileSync(join(f.base, "admission-witness/1.json"), Buffer.alloc(unsigned.length, 120));
  assert.throws(() => snap.verify(), /changed/); assert.throws(() => snap.readEvidence("witness", e.index), /closed/); c.close();
});
run("B-2b final verify rereads markers and policy against the original snapshot", (t) => {
  const f = fixture(t), c = f.begin(), snap = c.openPair().inventory();
  writeFileSync(join(f.base, "store/policy.json"), policy.replace("v6", "v5")); assert.throws(() => snap.verify(), /changed|control/); c.close();
});
run("B-2b ordinary side, Unicode side, pending and reserve names remain unread and preserved", (t) => {
  const paths = ["store/.DS_Store", "store/owner-notes/é.txt", `store/.producer-${id(11)}.tmp`, `store/.quarantine-reserve-${id(12)}.tmp`];
  const f = fixture(t, ({ write }) => paths.forEach((p) => write(p)));
  const c = f.begin(), snap = c.openPair().inventory();
  for (const p of paths) { const e = snap.report.entries.find((e) => e.root_role === "data" && e.path === p.slice(6));
    assert.equal(e.readable_evidence, false); assert.deepEqual(readFileSync(join(f.base, p)), unsigned); }
  assert.equal(snap.verify().native_snapshot_verified, true); c.close();
});
for (const kind of ["symlink", "hardlink", "fifo", "grant", "unknown", "oversize"]) run(`B-2b unqualified ${kind} cannot become readable evidence`, (t) => {
  const f = fixture(t, ({ base, write }) => {
    if (kind === "symlink") symlinkSync("../store/policy.json", join(base, "admission-witness/2.json"));
    if (kind === "hardlink") linkSync(join(base, "admission-witness/1.json"), join(base, "admission-witness/2.json"));
    if (kind === "fifo") assert.equal(spawnSync("/usr/bin/mkfifo", ["-m", "600", join(base, "admission-witness/2.json")]).status, 0);
    if (kind === "grant") assert.equal(spawnSync("/bin/chmod", ["+a", "everyone allow write", join(base, "admission-witness/1.json")]).status, 0);
    if (kind === "unknown") write("admission-witness/01.json");
    if (kind === "oversize") write("admission-witness/2.json", Buffer.alloc(16385));
  });
  const c = f.begin(); const snap = c.openPair().inventory();
  const e = snap.report.entries.find((e) => e.root_role === "witness" && e.path === (kind === "grant" ? "1.json" : kind === "unknown" ? "01.json" : "2.json"));
  assert.equal(e.readable_evidence, false); assert.throws(() => snap.readEvidence("witness", e.index), /readable/); c.close();
});
run("B-2b reads close after verify; root roles and snapshot ownership cannot be substituted", (t) => {
  const f = fixture(t), c = f.raw(), p = native.openAdmissionReadPair(c), s = native.admissionInventory(p, undefined);
  const e = s.report.entries.find((e) => e.root_role === "witness");
  try { assert.throws(() => native.readAdmissionEvidence(p, s.snapshot, "data", e.index, undefined), /role/); } finally { native.closeAdmissionRead(c); }
  const fresh = f.begin(), snap = fresh.openPair().inventory(); snap.verify();
  assert.throws(() => snap.readEvidence("witness", e.index), /window/); fresh.close();
});
run("B-2b native reentrancy and between-pass changes fail closed with no leaked FDs", (t) => {
  const f = fixture(t), c = f.raw(), p = native.openAdmissionReadPair(c);
  try { assert.throws(() => native.admissionInventory(p, () => native.closeAdmissionRead(c)), /busy/); }
  finally { native.closeAdmissionRead(c); }
  const next = f.raw(), pair = native.openAdmissionReadPair(next);
  try { assert.throws(() => native.admissionInventory(pair, () => { f.write("store/new-side"); }), /changed/); }
  finally { native.closeAdmissionRead(next); }
});
run("B-2b read hook swaps a selected witness, caught before bytes escape", (t) => {
  const f = fixture(t), c = f.raw(), p = native.openAdmissionReadPair(c), s = native.admissionInventory(p, undefined);
  const e = s.report.entries.find((e) => e.root_role === "witness");
  try { assert.throws(() => native.readAdmissionEvidence(p, s.snapshot, "witness", e.index, () => {
    renameSync(join(f.base, "admission-witness/1.json"), join(f.base, "admission-witness/moved.json"));
    symlinkSync("../store/policy.json", join(f.base, "admission-witness/1.json"));
  }), /changed|open_failed/); } finally { native.closeAdmissionRead(c); }
});
run("B-2b expired contexts release only and do not acquire a new deadline", async (t) => {
  const f = fixture(t), c = f.raw({}, 200); await new Promise((r) => setTimeout(r, 220));
  assert.throws(() => native.openAdmissionReadPair(c), /deadline/); native.closeAdmissionRead(c); native.closeAdmissionRead(c);
});
run("B-2b oversized required evidence blocks final native qualification", (t) => {
  const f = fixture(t, ({ write }) => write("admission-witness/2.json", Buffer.alloc(16385)));
  const c = f.begin(), snap = c.openPair().inventory(); assert.throws(() => snap.verify(), /unqualified/); c.close();
});
run("B-2b entry budget is shared exactly across both roots, including control/ancestry", (t) => {
  const f = fixture(t, ({ write }) => { for (let i = 2; i < 6; i++) { write(`admission-witness/${i}.json`); write(`store/side-${i}`); } });
  const first = f.begin(), size = first.openPair().inventory().report.entries.length; first.close();
  const exact = f.begin({ entries: size }); assert.equal(exact.openPair().inventory().report.entries.length, size); exact.close();
  const short = f.begin({ entries: size - 1 }); assert.throws(() => short.openPair().inventory(), /entry|inventory_limit/); short.close();
});
run("B-2b native snapshots cannot cross pairs; repeated close only releases", (t) => {
  const f = fixture(t), a = f.raw(), b = f.raw(), pa = native.openAdmissionReadPair(a), pb = native.openAdmissionReadPair(b);
  const sa = native.admissionInventory(pa, undefined), sb = native.admissionInventory(pb, undefined);
  try {
    assert.throws(() => native.closeAdmissionInventory(pa, sb.snapshot), /owner/);
    native.closeAdmissionInventory(pa, sa.snapshot); native.closeAdmissionInventory(pa, sa.snapshot);
    assert.throws(() => native.admissionInventory(pa, undefined), /once/);
    assert.throws(() => native.verifyAdmissionInventory(pb, sa.snapshot, undefined), /owner/);
  } finally { native.closeAdmissionRead(a); native.closeAdmissionRead(b); }
});
run("B-2b modified detached reports cannot select a caller pathname or proof", (t) => {
  const f = fixture(t), c = f.begin(), snap = c.openPair().inventory();
  const e = snap.report.entries.find((e) => e.root_role === "witness"), index = e.index;
  e.path = "../../invented";e.proof.inode = "0";e.readable_evidence = false;e.root_role = "data";
  assert.deepEqual(snap.readEvidence("witness", index).bytes, unsigned);snap.verify();c.close();
});
for (const path of ["store/Producer", "store/CAPTURES", "admission-witness/01.json", "admission-witness/1000000000000000000000000000000.json", "store/.ea-invalid.tmp"])
  run(`B-2b reserved/canonical namespace blocker ${path} stays visible`, (t) => {
    const f = fixture(t, ({ base, write }) => {
      if(path === "store/Producer") renameSync(join(base, "store/producer"), join(base, "store/Producer")); else write(path);
    }), c = f.begin(), snap = c.openPair().inventory();
    assert.equal(snap.report.namespace_qualified, false);assert.throws(() => snap.verify(), /unqualified/);c.close();
  });
run("B-2b explicit parent ACL grant refuses opening without changing permissions", (t) => {
  const f = fixture(t); assert.equal(spawnSync("/bin/chmod", ["+a", "everyone allow write", f.base]).status, 0);
  const c = f.begin();assert.throws(() => c.openPair(), /unsafe_acl/);c.close();
});
run("B-2b read-result construction does not invoke an inherited facts setter", (t) => {
  const f = fixture(t), c = f.raw(), p = native.openAdmissionReadPair(c), s = native.admissionInventory(p, undefined);
  const e = s.report.entries.find((e) => e.root_role === "witness");let invoked = false;
  Object.defineProperty(Object.prototype, "facts", { configurable: true, set() { invoked = true;
    writeFileSync(join(f.base, "admission-witness/1.json"), Buffer.alloc(unsigned.length, 121)); } });
  try { const result = native.readAdmissionEvidence(p, s.snapshot, "witness", e.index, undefined);
    assert.equal(invoked, false);assert.deepEqual(result.bytes, unsigned);assert.equal(result.facts.sha256, hash(unsigned)); }
  finally { delete Object.prototype.facts;native.closeAdmissionRead(c); }
});
run("B-2b unreachable adapter contexts release FDs and ticket activity through GC", async (t) => {
  assert.equal(typeof global.gc, "function", "dedicated runner enables GC");
  const f = fixture(t); (() => { const c = f.begin();c.openPair().inventory(); })();
  for (let i = 0; i < 30 && native.info().live_fds; i++) { global.gc();await new Promise((r) => setTimeout(r, 5)); }
  assert.equal(native.info().live_fds, 0);assert.equal(native.info().live_sessions, 0);
  const next = f.begin();next.close();
});
run("B-2b observation end includes injected read delay and the final native recheck", (t) => {
  const f = fixture(t), c = f.raw(), pair = native.openAdmissionReadPair(c), s = native.admissionInventory(pair, undefined);
  const e = s.report.entries.find((e) => e.root_role === "witness");let assembled = 0;
  try { const result = native.readAdmissionEvidence(pair, s.snapshot, "witness", e.index, () => {
    const until = Date.now() + 15;while (Date.now() < until) {}
    assembled = Date.now();
  });
    assert.ok(Date.parse(result.facts.observed_at) >= assembled);assert.ok(Date.parse(result.facts.context_started_at) <= assembled);
  } finally { native.closeAdmissionRead(c); }
});
run("B-2b response setters cannot change returned bytes while preserving the native hash", (t) => {
  const f = fixture(t), c = f.raw(), p = native.openAdmissionReadPair(c), s = native.admissionInventory(p, undefined);
  const e = s.report.entries.find((e) => e.root_role === "witness");let invoked = 0;
  Object.defineProperty(Object.prototype, "bytes", { configurable: true, set(value) {
    invoked++;value.fill(120);Object.defineProperty(this, "bytes", { value, enumerable: true, configurable: true });
  } });
  try { const result = native.readAdmissionEvidence(p, s.snapshot, "witness", e.index, undefined);
    assert.equal(hash(result.bytes), result.facts.sha256);assert.deepEqual(result.bytes, unsigned);assert.equal(invoked, 0);
  } finally { delete Object.prototype.bytes;native.closeAdmissionRead(c); }
});
run("B-2b final read counter includes postconstruction guards and fits the same exact budget", (t) => {
  const f = fixture(t);
  function query(read_bytes) {
    const c = f.raw(read_bytes === undefined ? {} : { read_bytes });
    try { const pair = native.openAdmissionReadPair(c), s = native.admissionInventory(pair, undefined);
      const e = s.report.entries.find((e) => e.root_role === "witness");native.readAdmissionEvidence(pair, s.snapshot, "witness", e.index, undefined);
      return Number(native.verifyAdmissionInventory(pair, s.snapshot, undefined).read_bytes);
    } finally { native.closeAdmissionRead(c); }
  }
  const reported = query();assert.equal(query(reported), reported);
});
run("B-2b all response wrappers define their own properties without prototype callbacks", (t) => {
  const f = fixture(t), c = f.raw(), pair = native.openAdmissionReadPair(c), keys = ["snapshot", "report", "bytes", "facts"];
  let invoked = 0;
  for (const key of keys) Object.defineProperty(Object.prototype, key, { configurable: true, set() { invoked++; } });
  try { const s = native.admissionInventory(pair, undefined);
    assert.ok(Object.hasOwn(s, "snapshot"));assert.ok(Object.hasOwn(s, "report"));
    const e = s.report.entries.find((e) => e.root_role === "witness");const bytes = native.readAdmissionEvidence(pair, s.snapshot, "witness", e.index, undefined);
    assert.ok(Object.hasOwn(bytes, "bytes"));assert.ok(Object.hasOwn(bytes, "facts"));assert.equal(invoked, 0);
    assert.equal(native.verifyAdmissionInventory(pair, s.snapshot, undefined).native_snapshot_verified, true);
  } finally { for (const key of keys) delete Object.prototype[key];native.closeAdmissionRead(c); }
});
run("B-2b unrelated new synthetic temp churn is not a fixture binding change", async (t) => {
  const f = fixture(t), signal = new SharedArrayBuffer(4), stop = new Int32Array(signal);
  const worker = new Worker(`
    const { workerData, parentPort } = require("node:worker_threads");
    const { mkdtempSync, rmdirSync } = require("node:fs");
    const stop = new Int32Array(workerData);
    parentPort.postMessage("ready");
    while (!Atomics.load(stop, 0)) {
      const own = mkdtempSync("/private/tmp/native-bar-fs-synthetic-");
      try { /* Empty invented fixture; never inspect or remove an existing path. */ }
      finally { rmdirSync(own); }
    }
  `, { eval: true, workerData: signal });
  const ended = new Promise((resolve, reject) => { worker.once("error", reject);worker.once("exit", (code) => code ? reject(new Error("synthetic_churn_failed")) : resolve()); });
  try {
    await new Promise((resolve, reject) => { worker.once("message", resolve);worker.once("error", reject); });
    for (let i = 0; i < 4; i++) { const c = f.begin();
      try { const snap = c.openPair().inventory();assert.equal(snap.verify().native_snapshot_verified, true); }
      finally { c.close(); }
    }
  } finally { Atomics.store(stop, 0, 1);await ended; }
});
run("B-2b native relative paths obey the same 16-component boundary as B-2a", (t) => {
  const allowed = fixture(t, ({ write }) => write(`store/${Array(15).fill("d").join("/")}/leaf`)), c = allowed.begin();
  try { const snap = c.openPair().inventory();assert.ok(snap.report.entries.some((e) => e.root_role === "data" && e.path.split("/").length === 16));snap.verify(); }
  finally { c.close(); }
  const rejected = fixture(t, ({ write }) => write(`store/${Array(16).fill("d").join("/")}/leaf`)), other = rejected.begin();
  try { assert.throws(() => other.openPair().inventory(), /depth_limit/); }
  finally { other.close(); }
});
run("B-2b a 120-record witness ledger is read and verified without listing shared directories into the read budget", (t) => {
  const f = fixture(t, ({ write }) => { for (let i = 2; i <= 120; ++i) write(`admission-witness/${i}.json`); });
  // Close in finally: a failed assertion must not hold the leases, which would also skip the fixture's own cleanup.
  const c = f.begin();
  try {
    const snap = c.openPair().inventory(), start = BigInt(snap.report.read_bytes);
    const witness = snap.report.entries.filter((e) => e.root_role === "witness" && e.readable_evidence); assert.equal(witness.length, 120);
    for (const e of witness) snap.readEvidence("witness", e.index);
    const verified = snap.verify(); assert.equal(verified.native_snapshot_verified, true);
    // Each 58-byte record cost about 2.2 MB when every exact-name check relisted the temp anchor and the witness root.
    assert.ok((BigInt(verified.read_bytes) - start) / 120n < 256n * 1024n, `per-record read work ${(BigInt(verified.read_bytes) - start) / 120n}`);
  } finally { c.close(); }
});
// The canonical per-user temp directory is an allowed anchor; on a busy host it holds far more than 512 unrelated entries.
const userTemp = eligible ? realpathSync(spawnSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).stdout.trim()) : null;
run("B-2b the per-user temp anchor opens regardless of how many unrelated entries it holds", (t) => {
  const f = fixture(t, () => {}, userTemp), c = f.begin();
  try { assert.equal(c.openPair().inventory().verify().native_snapshot_verified, true); } finally { c.close(); }
});
run("B-2b legacy v1/v5/R-D private names block the final view instead of passing as ordinary side files", (t) => {
  for (const legacy of ["retention.json", `.publication-${id(20)}.tmp`, `captures/2026-10-25/.${id(21)}-0123abcd-1-0123456789ab.stage`]) {
    const f = fixture(t, ({ write }) => write(`store/${legacy}`)), c = f.begin();
    try {
      const snap = c.openPair().inventory(), e = snap.report.entries.find((e) => e.root_role === "data" && e.path === legacy);
      assert.equal(e.role, "unknown_private", legacy); assert.equal(snap.report.namespace_qualified, false);
      assert.throws(() => snap.verify(), /unqualified/);
    } finally { c.close(); }
  }
});
