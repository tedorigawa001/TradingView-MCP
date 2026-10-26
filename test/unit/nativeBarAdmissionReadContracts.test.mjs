import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, createHash } from "node:crypto";

const base = process.env.NATIVE_BAR_B3A_ISOLATED_TEST === "1" ? "../../build/b3a-validation/" : process.env.NATIVE_BAR_B2B_ISOLATED_TEST === "1" ? "../../build/b2b-validation/" : process.env.NATIVE_BAR_B2A_ISOLATED_TEST === "1" ? "../../build/b2a-validation/" : "../../build/";
const api = await import(new URL(`${base}nativeBarAdmissionReadContracts.js`, import.meta.url));
const { canonical, evidenceHash } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (b) => createHash("sha256").update(b).digest("hex");
// Published RFC 8032 test-1 public key. No signer/private key, fixture or key file is needed here.
const publicKey = createPublicKey({ key: Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"), type: "spki", format: "der" });
function fixture() {
  const pins = { fixture_id: id(1), store_id: id(2), epoch_id: id(3), authority_id: id(4), key_id: id(5),
    enrollment_hash: evidenceHash("invented enrollment"), public_key_spki_sha256: hash(publicKey.export({ format: "der", type: "spki" })) };
  const proof = (inode, uid = "501", mode = "16832") => ({ device: "1", inode: String(inode), uid, gid: "20", mode,
    flags: "0", birthtime_ns: "1", acl: "none", acl_hash: evidenceHash("invented ACL") });
  const policy_hash = evidenceHash({ schema: "native-bar-synthetic-admission-profile-v6" });
  const marker = { schema: "native-bar-admission-fixture-marker-v1", fixture_id: pins.fixture_id, store_id: pins.store_id,
    epoch_id: pins.epoch_id, policy_hash, data_root: "store", witness_root: "admission-witness" };
  const file = (inode, body) => ({ ...proof(inode, "501", "33152"), nlink: "1", size: String(Buffer.byteLength(body)), sha256: hash(body) });
  const bootstrap = { schema: "native-bar-admission-read-bootstrap-v1", scope: "synthetic_fixture_only", temp_anchor: "/private/tmp", pins, authority_reference: id(6) };
  const registration = { schema: "native-bar-admission-read-registration-v1", scope: "synthetic_fixture_only", pins: structuredClone(pins),
    authority_reference: id(6), temp_anchor: "/private/tmp", fixture_name: "native-bar-fs-synthetic-Ab123Z", policy_hash,
    bindings: { ancestors: [ { path: "/", proof: proof(10, "0", "16877") }, { path: "/private", proof: proof(11, "0", "16877") },
      { path: "/private/tmp", proof: proof(12, "0", "17407") } ], fixture_parent: proof(13), data: proof(14), witness: proof(15),
      markers: { base: file(16, "synthetic-fixture-v1\n"), admission: file(17, canonical(marker)) } },
    volume: { filesystem: "apfs", local: true, ownership_enforced: true, case_preserving: true, case_sensitive: false, read_only_mount: false } };
  return { bootstrap, registration };
}
test("B-2a registers only an immutable supplied binding and never makes a native read available", () => {
  const f = fixture(), before = canonical(f), bootstrap = api.createSyntheticAdmissionReadBootstrap(f.bootstrap, publicKey);
  const registry = api.createSyntheticAdmissionReadRegistry(bootstrap.token), ticket = registry.registerFixture(f.registration);
  const r = registry.describe(ticket);
  assert.equal(r.registration_hash, evidenceHash(f.registration));
  assert.equal(r.native_read_available, false); assert.equal(r.native_snapshot_verified, false); assert.equal(r.execution_available, false);
  assert.throws(() => registry.beginRead(ticket), /b2a_native_read_unavailable/);
  assert.throws(() => registry.describe(structuredClone(ticket)), /ticket/);
  assert.equal(canonical(f), before); registry.closeFixture(ticket); registry.closeFixture(ticket);
  assert.throws(() => registry.describe(ticket), /ticket/); bootstrap.close();
});
const classify = (root_role, path, kind = "file", size = "1", access = "supplied_safe") =>
  api.classifySyntheticAdmissionReadEntry({ root_role, path, kind, size, access });
test("B-2a classifies roles without granting a native read or treating pending/side files as completed evidence", () => {
  const w = classify("witness", "10.json");
  assert.equal(w.role, "witness_record"); assert.equal(w.raw_byte_limit, "16384"); assert.equal(w.raw_read_candidate, true);
  const p = classify("data", `producer/${id(10)}/2.json`);
  assert.equal(p.role, "producer_mirror"); assert.equal(p.raw_byte_limit, "8192");
  const pending = classify("data", `.producer-${id(11)}.tmp`);
  assert.equal(pending.pending, true); assert.equal(pending.raw_read_candidate, false);
  const side = classify("data", "receipts/2026-10-25/.DS_Store");
  assert.equal(side.role, "ordinary_side"); assert.equal(side.raw_read_candidate, false);
  assert.equal(classify("witness", "01.json").namespace_status, "blocked");
  assert.equal(classify("data", "Producer", "directory").namespace_status, "blocked");
  for (const r of [w, p, pending, side]) { assert.equal(r.native_read_available, false); assert.equal(r.native_snapshot_verified, false); }
});
function budget() {
  const occupied = () => ({ entries: "0", inventory_bytes: "0", metadata_bytes: "0" });
  return { registration: fixture().registration, inventory: { data: occupied(), witness: occupied(), common: occupied() },
    retained_metadata_bytes: "0", read_work: [], response: { supplied_bytes: "0", buffer_bytes: "0" },
    resources: { live_roots: "0", live_targets: "0", live_fds: "0" } };
}
test("B-2a counts data, witness, fixed controls and repeated reads in one supplied budget without qualifying native capacity", () => {
  const q = budget(), m = q.registration.bindings.markers;
  const controls = BigInt(m.base.size) + BigInt(m.admission.size) + BigInt(Buffer.byteLength(canonical({ schema: "native-bar-synthetic-admission-profile-v6" })));
  q.inventory.data.entries = "250"; q.inventory.witness.entries = "250";
  q.read_work = [{ kind: "content", bytes: "1000", count: "3" }, { kind: "acl", bytes: "500", count: "2" }];
  const r = api.calculateSyntheticAdmissionReadBudget(q);
  // Supplied ACL work as given; three content objects four times each with guard passes; four inventory passes; controls.
  assert.equal(r.model_fits, true); assert.equal(r.used.entries, "508");
  const fixed = 5n * (BigInt(q.registration.bindings.ancestors.length) + 4n) * 12288n;
  assert.equal(r.used.read_bytes, String(1000n + 4n * 3000n + 4n * 3n * 65536n + 4n * 508n * 4608n + controls * (6n + 4n * 3n) + fixed));
  assert.equal(r.capacity_verified, false); assert.equal(r.native_read_available, false);
  q.inventory.witness.entries = "255";
  assert.deepEqual(api.calculateSyntheticAdmissionReadBudget(q).blockers, ["entries_limit"]);
});

test("B-2a captures bootstrap/registration values, revokes all registries and refuses foreign tickets", () => {
  const f = fixture(), b = api.createSyntheticAdmissionReadBootstrap(f.bootstrap, publicKey);
  f.bootstrap.temp_anchor = "/invented/changed"; f.bootstrap.pins.fixture_id = id(99);
  const a = api.createSyntheticAdmissionReadRegistry(b.token), other = api.createSyntheticAdmissionReadRegistry(b.token);
  const t = a.registerFixture(f.registration), expected = a.describe(t).registration_hash;
  f.registration.bindings.data.inode = "999";
  const r = a.describe(t); r.registration_hash = "changed"; assert.equal(a.describe(t).registration_hash, expected);
  assert.throws(() => other.describe(t), /ticket/); assert.throws(() => a.describe({}), /ticket/);
  assert.throws(() => a.registerFixture(fixture().registration), /already_issued/);
  a.closeFixture(t); assert.throws(() => a.registerFixture(fixture().registration), /already_issued/);
  b.close(); b.close(); assert.throws(() => other.registerFixture(fixture().registration), /closed/);
  assert.throws(() => api.createSyntheticAdmissionReadRegistry(b.token), /bootstrap/); a.close(); other.close();
  assert.throws(() => api.createSyntheticAdmissionReadRegistry(structuredClone(b.token)), /bootstrap/);
  assert.equal(JSON.stringify(r).includes("/private/tmp"), false);
});
for (const [name, mutate] of [
  ["unknown field", (r) => { r.loader = "not allowed"; }],
  ["policy replacement", (r) => { r.policy_hash = "0".repeat(64); }],
  ["role alias", (r) => { r.pins.fixture_id = r.pins.store_id; }],
  ["authority reference alias", (r) => { r.authority_reference = r.pins.key_id; }],
  ["upper-case ID", (r) => { r.pins.fixture_id = "AAAAAAAA-0000-4000-8000-000000000001"; }],
  ["unqualified filesystem", (r) => { r.volume.filesystem = "other"; }],
  ["unknown case preservation", (r) => { r.volume.case_preserving = false; }],
  ["dot path", (r) => { r.temp_anchor = "/private/../tmp"; }],
  ["double separator", (r) => { r.temp_anchor = "/private//tmp"; }],
  ["trailing separator", (r) => { r.temp_anchor += "/"; }],
  ["root anchor", (r) => { r.temp_anchor = "/"; }],
  ["embedded NUL", (r) => { r.temp_anchor += "\0"; }],
  ["lossy UTF-8", (r) => { r.temp_anchor += "\ud800"; }],
  ["long path", (r) => { r.temp_anchor = "/" + "x".repeat(4096); }],
  ["fixture alias", (r) => { r.fixture_name += "/store"; }],
  ["extra root path", (r) => { r.data_root = "/other/store"; }],
  ["incomplete ancestry", (r) => { r.bindings.ancestors.pop(); }],
  ["wrong ancestor path", (r) => { r.bindings.ancestors[1].path = "/other"; }],
  ["root alias", (r) => { r.bindings.witness.inode = r.bindings.data.inode; }],
  ["marker alias", (r) => { r.bindings.markers.base.inode = r.bindings.fixture_parent.inode; }],
  ["another device", (r) => { r.bindings.witness.device = "2"; }],
  ["another owner", (r) => { r.bindings.data.uid = "502"; }],
  ["another group", (r) => { r.bindings.markers.admission.gid = "21"; }],
  ["unsafe root mode", (r) => { r.bindings.data.mode = "16895"; }],
  ["ACL grant", (r) => { r.bindings.fixture_parent.acl = "allow"; }],
  ["world-writable nonsticky ancestor", (r) => { r.bindings.ancestors[0].proof.mode = "16895"; }],
  ["ancestor wrong type", (r) => { r.bindings.ancestors[0].proof.mode = "33152"; }],
  ["flags overflow", (r) => { r.bindings.data.flags = "4294967296"; }],
  ["leading-zero inode", (r) => { r.bindings.data.inode = "01"; }],
  ["rounded counter", (r) => { r.bindings.data.inode = 9007199254740992; }],
  ["marker hardlink", (r) => { r.bindings.markers.base.nlink = "2"; }],
  ["base marker digest", (r) => { r.bindings.markers.base.sha256 = evidenceHash("synthetic-fixture-v1\n"); }],
  ["base marker length", (r) => { r.bindings.markers.base.size = "22"; }],
  ["E marker digest", (r) => { r.bindings.markers.admission.sha256 = "0".repeat(64); }],
]) test(`B-2a refuses registration ${name} before any IO`, () => {
  const f = fixture(); mutate(f.registration); assert.throws(() => api.validateSyntheticAdmissionReadRegistration(f.registration), /^Error: b2a_/);
});
for (const field of ["temp_anchor", "authority_reference", "pins"]) test(`B-2a registration cannot replace bootstrap ${field}`, () => {
  const f = fixture(), b = api.createSyntheticAdmissionReadBootstrap(f.bootstrap, publicKey), registry = api.createSyntheticAdmissionReadRegistry(b.token);
  if (field === "pins") f.registration.pins.enrollment_hash = "0".repeat(64);
  else if (field === "authority_reference") f.registration.authority_reference = id(88);
  else { f.registration.temp_anchor = "/private/new"; f.registration.bindings.ancestors[2].path = "/private/new"; }
  assert.throws(() => registry.registerFixture(f.registration), /bootstrap_binding/); b.close();
});
test("B-2a inherits the B-1 public-key boundary without signing or importing a private key", () => {
  const f = fixture();
  assert.throws(() => api.createSyntheticAdmissionReadBootstrap(f.bootstrap, publicKey.export({ type: "spki", format: "der" })), /public_key/);
  assert.throws(() => api.createSyntheticAdmissionReadBootstrap(f.bootstrap, Object.create(Object.getPrototypeOf(publicKey))), /public_key/);
  const weak = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from([1]), Buffer.alloc(31)]), type: "spki", format: "der" });
  f.bootstrap.pins.public_key_spki_sha256 = hash(weak.export({ type: "spki", format: "der" }));
  assert.throws(() => api.createSyntheticAdmissionReadBootstrap(f.bootstrap, weak), /public_key/);
});
test("B-2a bounds structured data and rejects getters, cycles and sparse arrays without exposing input in errors", () => {
  let called = false; const f = fixture();
  Object.defineProperty(f.registration, "private_secret", { enumerable: true, get() { called = true; return true; } });
  assert.throws(() => api.validateSyntheticAdmissionReadRegistration(f.registration), /non_json/); assert.equal(called, false);
  const cyclic = fixture().registration; cyclic.self = cyclic; assert.throws(() => api.validateSyntheticAdmissionReadRegistration(cyclic), /non_json/);
  const sparse = fixture().registration; sparse.bindings.ancestors = new Array(4294967295);
  assert.throws(() => api.validateSyntheticAdmissionReadRegistration(sparse), /depth_or_nodes/);
  const large = fixture().registration; large.extra = "x".repeat(65537); assert.throws(() => api.validateSyntheticAdmissionReadRegistration(large), /input_bytes/);
  const secret = fixture().registration; secret["/private/not-for-diagnostics"] = true;
  assert.throws(() => api.validateSyntheticAdmissionReadRegistration(secret), (e) => e.message === "b2a_invalid_input");
});

for (const [root, path, kind, role, limit, pending] of [
  ["fixture", ".native-bar-admission-synthetic", "file", "control", "4096", false],
  ["fixture", "store", "directory", "directory", null, false],
  ["data", "policy.json", "file", "control", "4096", false],
  ["data", `producer/${id(10)}`, "directory", "directory", null, false],
  ["data", `captures/2026-10-25/${id(10)}.json`, "file", "payload", "1048576", false],
  ["data", `receipts/2026-10-25/${id(10)}.json`, "file", "receipt", "16384", false],
  ["data", `maintenance/${id(10)}.manifest/${id(11)}.json`, "file", "maintenance_metadata", "65536", false],
  ["data", `maintenance/${id(10)}.events/28.json`, "file", "maintenance_metadata", "65536", false],
  ["data", `maintenance/${id(10)}.attempts`, "directory", "directory", null, false],
  ["data", `quarantine/abandoned/${id(10)}/${id(11)}.timestamp.json`, "file", "maintenance_metadata", "65536", false],
  ["data", `maintenance-hold/${id(10)}/${id(11)}`, "file", "payload", "1048576", false],
  ["data", `quarantine/abandoned/${id(10)}/${id(11)}`, "file", "payload", "1048576", false],
  ["data", `.ea-${id(10)}-37-3.tmp`, "file", "pending", "65536", true],
  ["data", `.writer-claim-${id(10)}.json`, "file", "coordination", "65536", false],
  ["data", `.writer-retired-${id(10)}.lock`, "file", "coordination", "65536", false],
  ["data", `.quarantine-reserve-${id(10)}.tmp`, "file", "reserve", null, false],
]) test(`B-2a structural ${role}: ${path}`, () => {
  const r = classify(root, path, kind); assert.equal(r.namespace_status, "recognized"); assert.equal(r.role, role);
  assert.equal(r.raw_byte_limit, limit); assert.equal(r.pending, pending); assert.equal(r.reservation_verified, false);
  assert.equal(r.raw_read_candidate, limit !== null && !pending && kind === "file");
});
for (const [root, path] of [["witness", "0.json"], ["witness", "1".repeat(31) + ".json"], ["witness", ".DS_Store"],
  ["data", `producer/${id(10)}/01.json`], ["data", `maintenance/${id(10)}.events/29.json`], ["data", `.ea-${id(10)}-38-1.tmp`],
  ["data", `.ea-${id(10)}-1-4.tmp`], ["data", "operations"], ["data", ".writer-unknown.tmp"], ["fixture", "helper"]])
  test(`B-2a blocks unrecognized private name ${path}`, () => assert.equal(classify(root, path).namespace_status, "blocked"));
test("B-2a refuses unsafe/nonregular/oversized candidates and preserves raw sequence identity", () => {
  for (const kind of ["directory", "symlink", "nonregular"]) assert.equal(classify("witness", "1.json", kind).raw_read_candidate, false);
  for (const access of ["unsafe", "unknown"]) assert.equal(classify("witness", "1.json", "file", "1", access).blocker, "access_unverified");
  assert.equal(classify("witness", "1.json", "file", "16384").raw_read_candidate, true);
  assert.equal(classify("witness", "1.json", "file", "16385").blocker, "oversize");
  const n = "999999999999999999999999999999"; assert.equal(classify("witness", n + ".json").sequence, n);
  assert.equal(classify("data", `.quarantine-reserve-${id(10)}.tmp`, "file", "999999999999999999999999999999").raw_read_candidate, false);
});
for (const path of ["/1.json", "../1.json", "x/./1.json", "x//1.json", "1.json/", "a\\b", "x\0y", "x".repeat(513), Array(17).fill("x").join("/")])
  test(`B-2a refuses noncanonical relative path ${JSON.stringify(path).slice(0, 35)}`, () => assert.throws(() => classify("data", path), /b2a_invalid_input/));
test("B-2a never claims full native Unicode name qualification from JavaScript case conversion", () => {
  const names = ["note", "NOTE"].map((path) => ({ root_role: "data", path }));
  assert.throws(() => api.checkSyntheticAdmissionReadNames(names), /name_collision/);
  assert.throws(() => api.checkSyntheticAdmissionReadNames([{ root_role: "data", path: "\u00df" }, { root_role: "data", path: "ss" }]), /native_name_check_required/);
  assert.equal(classify("data", "\u00df").namespace_status, "needs_native_name_check");
  const r = api.checkSyntheticAdmissionReadNames([{ root_role: "data", path: "1.json" }, { root_role: "witness", path: "1.json" }]);
  assert.equal(r.supplied_ascii_names_distinct, true); assert.equal(r.native_names_verified, false);
});
test("B-2a an ordinary supplied-safe side directory is traversable in principle, never readable as evidence", () => {
  const r = classify("data", "owner-notes", "directory");
  assert.equal(r.namespace_status, "ordinary_side"); assert.equal(r.blocker, null); assert.equal(r.raw_read_candidate, false);
  assert.equal(r.directory_candidate, true); assert.equal(r.native_snapshot_verified, false);
});

for (const key of ["entries", "inventory_bytes", "metadata_bytes", "read_bytes", "response_bytes"]) test(`B-2a exact shared ${key} limit and one over`, () => {
  const q = budget(), limit = { entries: 512, inventory_bytes: 1073741824, metadata_bytes: 16777216, read_bytes: 268435456, response_bytes: 8388608 }[key];
  const base = api.calculateSyntheticAdmissionReadBudget(q);
  function at(n) {
    if (key === "entries") q.inventory.data.entries = String(n - 8);
    else if (key === "inventory_bytes") q.inventory.witness.inventory_bytes = String(n - Number(base.used.inventory_bytes));
    else if (key === "metadata_bytes") q.retained_metadata_bytes = String(n - Number(base.used.metadata_bytes));
    else if (key === "read_bytes") q.read_work = [{ kind: "metadata", bytes: String(n - Number(base.used.read_bytes)), count: "1" }];
    else q.response.supplied_bytes = String(n);
    return api.calculateSyntheticAdmissionReadBudget(q);
  }
  assert.equal(at(limit).model_fits, true); assert.equal(at(limit).used[key], String(limit));
  assert.deepEqual(at(limit + 1).blockers, [`${key}_limit`]);
});
test("B-2a derives registration/control and Buffer-response floors even from understated counters", () => {
  const q = budget(), r = api.calculateSyntheticAdmissionReadBudget(q);
  assert.equal(r.used.entries, "9"); assert.ok(BigInt(r.used.metadata_bytes) > BigInt(Buffer.byteLength(canonical(q.registration))));
  assert.ok(BigInt(r.used.read_bytes) > 21n); assert.ok(BigInt(r.used.response_bytes) > 4096n);
  q.response.buffer_bytes = "2097152"; assert.ok(api.calculateSyntheticAdmissionReadBudget(q).blockers.includes("response_bytes_limit"));
  q.read_work = [{ kind: "content", bytes: "1048576", count: "999999999999999999999999999999" }];
  assert.ok(api.calculateSyntheticAdmissionReadBudget(q).blockers.includes("read_bytes_limit"));
});
for (const [field, exact, reason] of [["live_roots", "6", "root_lease_limit"], ["live_targets", "32", "live_target_limit"], ["live_fds", "464", "descriptor_headroom_limit"]])
  test(`B-2a accounts for existing ${field} and required headroom`, () => {
    const q = budget(); q.resources[field] = exact; assert.equal(api.calculateSyntheticAdmissionReadBudget(q).model_fits, true);
    q.resources[field] = String(BigInt(exact) + 1n); assert.deepEqual(api.calculateSyntheticAdmissionReadBudget(q).blockers, [reason]);
  });
test("B-2a lower limits cannot increase a ceiling, hide protocol fields or mint a read context", () => {
  const q = budget(), first = api.calculateSyntheticAdmissionReadBudget(q);
  for (const key of Object.keys(first.used)) {
    q.limits = { [key]: Number(first.used[key]) }; assert.equal(api.calculateSyntheticAdmissionReadBudget(q).model_fits, true);
    q.limits[key]--; assert.ok(api.calculateSyntheticAdmissionReadBudget(q).blockers.includes(`${key}_limit`));
  }
  for (const limits of [{ entries: 513 }, { read_bytes: 268435457 }, { entries: 0 }, { entries: 1.5 }, { entries: "1" }, { force: true }]) {
    q.limits = limits; assert.throws(() => api.calculateSyntheticAdmissionReadBudget(q), /invalid_input/);
  }
  const f = fixture(), b = api.createSyntheticAdmissionReadBootstrap(f.bootstrap, publicKey), registry = api.createSyntheticAdmissionReadRegistry(b.token), t = registry.registerFixture(f.registration);
  assert.throws(() => registry.beginRead(t, { force: true }), /invalid_input/);
  assert.throws(() => registry.beginRead(t, { entries: 1 }), /native_read_unavailable/); b.close();
});
for (const [root, path, limit] of [["data", `producer/${id(10)}/1.json`, 8192], ["data", "policy.json", 4096],
  ["data", `receipts/2026-10-25/${id(10)}.json`, 16384], ["data", `captures/2026-10-25/${id(10)}.json`, 1048576],
  ["data", `maintenance/${id(10)}.json`, 65536]]) test(`B-2a raw candidate limit ${limit} for ${path}`, () => {
    assert.equal(classify(root, path, "file", String(limit)).raw_read_candidate, true);
    assert.equal(classify(root, path, "file", String(limit + 1)).blocker, "oversize");
  });
test("B-2a all qualification flags stay false across registration, classification, name and budget results", () => {
  const f = fixture(), b = api.createSyntheticAdmissionReadBootstrap(f.bootstrap, publicKey), r = api.createSyntheticAdmissionReadRegistry(b.token);
  const t = r.registerFixture(f.registration);
  for (const result of [r.describe(t), classify("witness", "1.json"), api.checkSyntheticAdmissionReadNames([]), api.calculateSyntheticAdmissionReadBudget(budget())]) {
    for (const [key, value] of Object.entries(result)) if (key.endsWith("_verified") || key.endsWith("_available") || key.endsWith("_authenticated") || key.endsWith("_qualified")) assert.equal(value, false, key);
    assert.equal(result.original_acknowledgement, "not_proven"); assert.equal(result.storage_visibility_at_as_of, "not_proven");
  }
  b.close();
});
test("B-2a invalid registration does not consume the single registration slot", () => {
  const f = fixture(), b = api.createSyntheticAdmissionReadBootstrap(f.bootstrap, publicKey), r = api.createSyntheticAdmissionReadRegistry(b.token);
  assert.throws(() => r.registerFixture({ ...f.registration, unknown: true }), /invalid_input/);
  assert.equal(r.describe(r.registerFixture(f.registration)).supplied_binding_valid, true); b.close();
});
test("B-2a known-ticket close remains release-only and idempotent after registry/bootstrap revocation", () => {
  const f = fixture(), b = api.createSyntheticAdmissionReadBootstrap(f.bootstrap, publicKey), r = api.createSyntheticAdmissionReadRegistry(b.token);
  const t = r.registerFixture(f.registration); r.close(); b.close();
  assert.doesNotThrow(() => r.closeFixture(t)); assert.doesNotThrow(() => r.closeFixture(t));
  assert.throws(() => r.closeFixture(structuredClone(t)), /ticket/); assert.throws(() => r.describe(t), /closed/);
});
test("B-2a checks reserved parent names and refuses children beneath a known file role", () => {
  for (const path of ["CAPTURES/notes.txt", "RECEIPTS/2026-10-25/.DS_Store", "policy.json/notes.txt", `captures/2026-10-25/${id(10)}.json/child`]) {
    const r = classify("data", path); assert.equal(r.namespace_status, "blocked", path);
    assert.equal(r.raw_read_candidate, false); assert.equal(r.directory_candidate, false);
  }
  for (const path of ["captures/2026-10-25/notes.txt", "receipts/2026-10-25/.DS_Store", "owner-notes/policy.json"])
    assert.equal(classify("data", path).namespace_status, "ordinary_side", path);
});
test("B-2a derives inventory response and retained-proof floors from entry counts, not understated byte claims", () => {
  const q = budget(); q.inventory.data.entries = "500";
  const wide = "9".repeat(30), proof = { ...q.registration.bindings.data, device: wide, inode: wide, uid: wide, gid: wide, mode: "33152",
    size: "0", nlink: "1", flags: "4294967295", birthtime_ns: wide, mtime_ns: wide, ctime_ns: wide, allocated_bytes: wide, sha256: "f".repeat(64) };
  for (const char of ["x", "\x01"]) {
    const entries = Array.from({ length: 500 }, (_, i) => {
      const path = `owner-notes/${String(i).padStart(5, "0")}/` + char.repeat(490);
      return { path, kind: "file", proof, classification: classify("data", path), readable_evidence: false, namespace_qualified: true, reason: "preserved_unknown" };
    });
    // A detached report of existing native-style fields, entirely in memory; no fixture or backend is used.
    const observed = Buffer.byteLength(canonical({ schema: "native-bar-native-admission-inventory-v6", entries }));
    const report = api.calculateSyntheticAdmissionReadBudget(q);
    assert.ok(BigInt(report.used.response_bytes) >= BigInt(observed), "complete inventory response must fit its derived bound");
    assert.ok(BigInt(report.used.metadata_bytes) >= 3n * BigInt(observed), "baseline/recheck/read-set retention must be budgeted");
    for (const field of ["response_bytes", "metadata_bytes"]) {
      q.limits = { [field]: observed - 1 };
      assert.ok(api.calculateSyntheticAdmissionReadBudget(q).blockers.includes(`${field}_limit`));
    }
    delete q.limits;
  }
});
test("B-2a a full 512-entry name inventory fits the name check, and implied parent folders collide by case", () => {
  const names = Array.from({ length: 512 }, (_, i) => ({ root_role: "data", path: `quarantine/abandoned/${id(1)}/${id(i + 2)}.timestamp.json` }));
  assert.equal(api.checkSyntheticAdmissionReadNames(names).supplied_ascii_names_distinct, true);
  const long = Array.from({ length: 512 }, (_, i) => ({ root_role: "witness", path: `${"d".repeat(400)}/${String(i).padStart(100, "0")}.json` }));
  assert.equal(api.checkSyntheticAdmissionReadNames(long).supplied_ascii_names_distinct, true);
  for (const pair of [["A", "a/x"], ["A/x", "a/y"], ["producer/x", "Producer/y"]])
    assert.throws(() => api.checkSyntheticAdmissionReadNames(pair.map((path) => ({ root_role: "data", path }))), /name_collision/, pair.join(" "));
  assert.equal(api.checkSyntheticAdmissionReadNames([{ root_role: "data", path: "a/x" }, { root_role: "data", path: "a/y" }, { root_role: "witness", path: "A/z" }])
    .supplied_ascii_names_distinct, true);
});
test("B-2a read floor charges final rehash, per-read rechecks and every inventory pass even with no supplied work", () => {
  const q = budget(); q.inventory.data.entries = "500";
  const empty = BigInt(api.calculateSyntheticAdmissionReadBudget(q).used.read_bytes);
  assert.ok(empty >= 4n * 508n * 3072n, "four joint inventory passes over every entry");
  q.read_work = [{ kind: "content", bytes: "1048576", count: "1" }];
  const one = BigInt(api.calculateSyntheticAdmissionReadBudget(q).used.read_bytes);
  assert.ok(one - empty >= 4n * 1048576n, "three bounded reads plus the final rehash of the same object");
  q.limits = { read_bytes: Number(empty + 2n * 1048576n) }; assert.ok(api.calculateSyntheticAdmissionReadBudget(q).blockers.includes("read_bytes_limit"));
});
test("B-2a legacy v1/v5/R-D private names are blocked, not preserved as ordinary side files", () => {
  for (const path of [`.publication-${id(10)}.tmp`, "retention.json", `captures/2026-10-25/.${id(10)}-0123abcd-1-0123456789ab.stage`, `receipts/2026-10-25/x.stage`]) {
    const r = classify("data", path); assert.equal(r.role, "unknown_private", path); assert.equal(r.namespace_status, "blocked", path);
  }
  assert.equal(classify("data", "captures/2026-10-25/.DS_Store").namespace_status, "ordinary_side");
});
test("B-2a a budget request may carry any registration that validates alone", () => {
  const q = budget(), r = q.registration, root = structuredClone(r.bindings.ancestors[0].proof);
  // Sixteen ancestors (the maximum) whose first component is long enough to bring the registration just under 64 KiB.
  function stretch(length) {
    r.temp_anchor = "/" + ["a".repeat(length), ...Array.from({ length: 14 }, (_, i) => `t${i}`)].join("/");
    const paths = ["/", ...r.temp_anchor.slice(1).split("/").map((_, i, a) => "/" + a.slice(0, i + 1).join("/"))];
    r.bindings.ancestors = paths.map((path, i) => ({ path, proof: { ...structuredClone(root), inode: String(900000 + i) } }));
    return Buffer.byteLength(canonical(r));
  }
  const base = stretch(1); stretch(Math.min(4000, Math.floor((65536 - 256 - base) / 16)));
  assert.ok(Buffer.byteLength(canonical(r)) > 65536 - 4096 && Buffer.byteLength(canonical(r)) <= 65536);
  assert.equal(api.validateSyntheticAdmissionReadRegistration(r).schema, "native-bar-admission-read-registration-v1");
  assert.equal(api.calculateSyntheticAdmissionReadBudget(q).schema, "native-bar-admission-read-budget-v1");
});
test("B-2a control bytes block a path anywhere, including names that would otherwise be ordinary side files", () => {
  for (const path of [`producer/${id(10)}/2.json\n`, `producer/${id(10)}/1.json\r`, "maintenance/x\ny", ".writer\nnote", "notes\n.txt", "owner/\x7f"]) {
    const r = classify("data", path); assert.equal(r.namespace_status, "blocked", JSON.stringify(path)); assert.equal(r.raw_read_candidate, false);
  }
});
test("B-2a the response floor reserves four times the largest native role cap of any planned content read", () => {
  const q = budget(), base = BigInt(api.calculateSyntheticAdmissionReadBudget(q).used.response_bytes);
  q.read_work = [{ kind: "content", bytes: "58", count: "1", cap_bytes: "16384" }];
  assert.equal(BigInt(api.calculateSyntheticAdmissionReadBudget(q).used.response_bytes) - base, 4n * 16384n);
  q.read_work = [{ kind: "content", bytes: "58", count: "1" }]; // no cap: a payload-sized 1 MiB reservation
  assert.equal(BigInt(api.calculateSyntheticAdmissionReadBudget(q).used.response_bytes) - base, 4n * 1048576n);
  q.read_work = [{ kind: "content", bytes: "16385", count: "1", cap_bytes: "16384" }];
  assert.throws(() => api.calculateSyntheticAdmissionReadBudget(q), /b2a_invalid_input/);
});
