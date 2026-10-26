import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const base = process.env.NATIVE_BAR_B3BA_ISOLATED_TEST === "1" ? "../../build/b3ba-validation/" : process.env.NATIVE_BAR_B3A_ISOLATED_TEST === "1" ? "../../build/b3a-validation/" : "../../build/";
const api = await import(new URL(`${base}nativeBarAdmissionQueryProtocol.js`, import.meta.url));
const { canonical, evidenceHash } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
const { calculateSyntheticAdmissionReadBudget } = await import(new URL(`${base}nativeBarAdmissionReadContracts.js`, import.meta.url));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const obs = (ms = 0, ns = String(BigInt(ms) * 1000000n)) => ({ utc_at: new Date(Date.parse("2026-10-26T00:00:00.000Z") + ms).toISOString(), monotonic_ns: ns });
function fixture() {
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const pins = { fixture_id: id(1), store_id: id(2), epoch_id: id(3), authority_id: id(4), key_id: id(5),
    enrollment_hash: evidenceHash("invented enrollment"), public_key_spki_sha256: evidenceHash("invented public fingerprint") };
  const proof = (inode, uid = "501", mode = "16832") => ({ device: "1", inode: String(inode), uid, gid: "20", mode,
    flags: "0", birthtime_ns: "1", acl: "none", acl_hash: evidenceHash("invented ACL") });
  const policy_hash = evidenceHash({ schema: "native-bar-synthetic-admission-profile-v6" });
  const marker = { schema: "native-bar-admission-fixture-marker-v1", fixture_id: pins.fixture_id, store_id: pins.store_id,
    epoch_id: pins.epoch_id, policy_hash, data_root: "store", witness_root: "admission-witness" };
  const file = (inode, body) => ({ ...proof(inode, "501", "33152"), nlink: "1", size: String(Buffer.byteLength(body)), sha256: hash(body) });
  const registration = { schema: "native-bar-admission-read-registration-v1", scope: "synthetic_fixture_only", pins,
    authority_reference: id(6), temp_anchor: "/private/tmp", fixture_name: "native-bar-fs-synthetic-Ab123Z", policy_hash,
    bindings: { ancestors: [{ path: "/", proof: proof(10, "0", "16877") }, { path: "/private", proof: proof(11, "0", "16877") },
      { path: "/private/tmp", proof: proof(12, "0", "17407") }], fixture_parent: proof(13), data: proof(14), witness: proof(15),
      markers: { base: file(16, "synthetic-fixture-v1\n"), admission: file(17, canonical(marker)) } },
    volume: { filesystem: "apfs", local: true, ownership_enforced: true, case_preserving: true, case_sensitive: false, read_only_mount: false } };
  return { schema: "native-bar-admission-query-model-registration-v1", scope: "synthetic_model_only", registration,
    registration_hash: evidenceHash(registration) };
}
function setup(options) {
  const binding = fixture(), model = api.createSyntheticAdmissionQueryProtocolModel(binding, options);
  const begin = (n = 100, observation = obs()) => model.begin({ query_id: id(n), registration_hash: binding.registration_hash, observation });
  return { binding, model, begin, q: begin() };
}
function claim(binding, challenge, overrides = {}) {
  const { public_key_spki_sha256, ...pins } = binding.registration.pins;
  return { ...pins, authority_reference: binding.registration.authority_reference, challenge, sequence: "1",
    tip_hash: evidenceHash("invented tip"), observed_at: obs().utc_at, ...overrides };
}
function receive(s, phase, n, overrides = {}) {
  const r = s.model.issue(s.q, { phase, challenge: id(n), observation: obs() });
  s.model.receive(s.q, r, { observation: obs(), checkpoint_claim: claim(s.binding, id(n), overrides) });
  return r;
}
function beforeC1(s) {
  receive(s, "c0", 101);
  for (const phase of ["pair_open", "inventoried"]) s.model.advance(s.q, { phase, observation: obs() });
  s.model.bindRecords(s.q, { observation: obs(), sequence: "1", tip_hash: evidenceHash("invented tip"), record_role_ids: [id(200)] });
  s.model.advance(s.q, { phase: "native_checked_before_c1", observation: obs() });
}
function complete(s) {
  beforeC1(s); receive(s, "c1", 102);
  for (const phase of ["native_checked_after_c1", "interpretation_complete"]) s.model.advance(s.q, { phase, observation: obs() });
  s.model.finish(s.q, { observation: obs() });
  s.model.release(s.q, { observation: obs(), outcome: "confirmed" });
  return s.model.describe(s.q);
}
function budget() {
  const empty = () => ({ entries: "0", inventory_bytes: "0", metadata_bytes: "0" });
  return { binding: fixture(), inventory: { data: empty(), witness: empty(), common: empty() }, retained_metadata_bytes: "0",
    retained_protocol_bytes: "0", decoded_transcript_bytes: "0", verifier_work_bytes: "0", provider_work_bytes: "0",
    read_work: [], response: { supplied_bytes: "0", buffer_bytes: "0" }, resources: { live_roots: "0", live_targets: "0", live_fds: "0" } };
}
test("B3-A exposes a model-only protocol without a native or oracle entry", () => {
  assert.equal(typeof api.createSyntheticAdmissionQueryProtocolModel, "function");
  assert.throws(() => api.createSyntheticAdmissionQueryProtocolModel({}), /b3a_/);
});
test("B3-A models the full fixed order at equal supplied times without authenticating anything", () => {
  const s = setup(), r = complete(s);
  assert.equal(r.model_order_consistent, true); assert.equal(r.state, "released"); assert.equal(r.checkpoint_claims_consumed, 2);
  for (const [k, v] of Object.entries(r)) if (k.endsWith("_verified") || k.endsWith("_available") || k.endsWith("_qualified") || k.endsWith("_authenticated") || k.endsWith("_enforced")) assert.equal(v, false, k);
  assert.equal(r.original_acknowledgement, "not_proven"); assert.equal(r.storage_visibility_at_as_of, "not_proven");
  assert.ok(api.nativeBarAdmissionQueryModelResultSchema.safeParse(r).success);
  assert.equal(JSON.stringify(r).includes("/private/tmp"), false);
});
test("B3-A budgets a fixed six-inventory, five-content, two-request schedule above the B-2 floor", () => {
  const q = budget(); q.read_work = [{ kind: "content", bytes: "1000", count: "3" }];
  const r = api.calculateSyntheticAdmissionQueryProtocolBudget(q);
  const { binding, retained_protocol_bytes, decoded_transcript_bytes, verifier_work_bytes, provider_work_bytes, ...b2 } = q;
  const floor = calculateSyntheticAdmissionReadBudget({ ...b2, registration: binding.registration });
  assert.equal(r.model_fits, true); assert.equal(r.schedule.native_inventory_passes, 6);
  assert.equal(r.schedule.content_passes, 5); assert.equal(r.schedule.checkpoint_requests, 2);
  for (const k of ["read_bytes", "metadata_bytes", "response_bytes"]) assert.ok(BigInt(r.used[k]) > BigInt(floor.used[k]), k);
  assert.equal(r.capacity_verified, false); assert.equal(r.native_budget_enforced, false);
});
test("B3-A detaches registration and reports, and requires the whole intended-fixture digest", () => {
  const s = setup(); s.binding.registration.fixture_name = "native-bar-fs-synthetic-ZZ123Z";
  receive(s, "c0", 101);
  const r = s.model.describe(s.q); r.last_supplied_observation.utc_at = obs(1).utc_at; r.failure = "b3a_fake";
  assert.equal(s.model.describe(s.q).last_supplied_observation.utc_at, obs().utc_at);
  assert.equal(s.model.describe(s.q).failure, null);
  const b = fixture(); b.registration.fixture_name = "native-bar-fs-synthetic-ZZ123Z";
  assert.throws(() => api.createSyntheticAdmissionQueryProtocolModel(b), /registration_binding/);
  assert.throws(() => s.model.begin({ query_id: id(300), registration_hash: fixture().registration_hash, observation: obs() }), /already_active/);
});
test("B3-A copied, foreign and report-derived query handles do not poison the owner", () => {
  const s = setup(), other = setup();
  for (const h of [structuredClone(s.q), {}, s.model.describe(s.q), other.q]) {
    assert.throws(() => s.model.advance(h, { phase: "pair_open", observation: obs() }), /query_handle/);
  }
  assert.equal(s.model.describe(s.q).state, "query_started"); complete(s);
});
for (const mode of ["copy", "foreign", "duplicate", "malformed", "late", "extra", "oversize"]) test(`B3-A consumes and stops after ${mode} response`, () => {
  const s = setup(), h = s.model.issue(s.q, { phase: "c0", challenge: id(101), observation: obs() });
  let handle = h, data = { observation: obs(), checkpoint_claim: claim(s.binding, id(101)) };
  if (mode === "copy") handle = structuredClone(h);
  if (mode === "foreign") { const other = setup(); handle = other.model.issue(other.q, { phase: "c0", challenge: id(101), observation: obs() }); }
  if (mode === "duplicate") s.model.receive(s.q, h, data);
  if (mode === "malformed") data.checkpoint_claim.sequence = "01";
  if (mode === "late") data.observation = obs(600000);
  if (mode === "extra") data.signature_verified = true;
  if (mode === "oversize") data.extra = "x".repeat(4097);
  assert.throws(() => s.model.receive(s.q, handle, data), /b3a_/);
  assert.equal(s.model.describe(s.q).state, "releasing");
  assert.throws(() => s.model.receive(s.q, h, { observation: obs(), checkpoint_claim: claim(s.binding, id(101)) }), /release_only/);
  s.model.release(s.q, { observation: obs(600001), outcome: "confirmed" });
  assert.equal(s.model.describe(s.q).model_order_consistent, false);
});
for (const key of ["fixture_id", "store_id", "epoch_id", "authority_id", "key_id", "enrollment_hash", "authority_reference", "challenge"])
  test(`B3-A refuses substituted checkpoint ${key}`, () => {
    const s = setup(); assert.throws(() => receive(s, "c0", 101, { [key]: key === "enrollment_hash" ? evidenceHash("other") : id(500) }), /checkpoint_binding/);
  });
for (const [key, value] of [["sequence", "2"], ["tip_hash", evidenceHash("different")]]) test(`B3-A refuses progressed C1 ${key} without retry`, () => {
  const s = setup(); beforeC1(s); assert.throws(() => receive(s, "c1", 102, { [key]: value }), /checkpoint_changed/);
  assert.throws(() => s.model.issue(s.q, { phase: "c1", challenge: id(103), observation: obs() }), /release_only/);
});
for (const phase of ["inventoried", "native_checked_before_c1", "native_checked_after_c1", "interpretation_complete"])
  test(`B3-A cannot skip straight to ${phase}`, () => {
    const s = setup(); assert.throws(() => s.model.advance(s.q, { phase, observation: obs() }), /event_order/);
    assert.equal(s.model.describe(s.q).model_order_consistent, false);
  });
test("B3-A cannot issue C1 first or C0 twice", () => {
  const s = setup(); assert.throws(() => s.model.issue(s.q, { phase: "c1", challenge: id(102), observation: obs() }), /event_order/);
  const t = setup(); receive(t, "c0", 101);
  assert.throws(() => t.model.issue(t.q, { phase: "c0", challenge: id(102), observation: obs() }), /event_order/);
});
for (const [ms, ns, success] of [[599999, "599999999999", true], [600000, "0", false], [0, "600000000000", false]])
  test(`B3-A exclusive deadlines: wall ${ms}, ticks ${ns}`, () => {
    const s = setup(), event = { phase: "c0", challenge: id(101), observation: obs(ms, ns) };
    if (success) s.model.issue(s.q, event); else assert.throws(() => s.model.issue(s.q, event), /expired/);
  });
for (const observation of [obs(1, "0"), obs(0, "1")]) test(`B3-A rejects rollback after ${JSON.stringify(observation)}`, () => {
  const s = setup(); const h = s.model.issue(s.q, { phase: "c0", challenge: id(101), observation });
  assert.throws(() => s.model.receive(s.q, h, { observation: obs(), checkpoint_claim: claim(s.binding, id(101)) }), /clock_rollback/);
  s.model.release(s.q, { observation: obs(), outcome: "confirmed" });
  assert.equal(s.model.describe(s.q).model_order_consistent, false);
});
test("B3-A brackets checkpoint claims without inventing timestamp tolerances", () => {
  for (const at of [obs(-1).utc_at, obs(1).utc_at]) {
    const s = setup(); assert.throws(() => receive(s, "c0", 101, { observed_at: at }), /checkpoint_bracket/);
  }
});
test("B3-A cancellation consumes pending work and cleanup cannot revive success", () => {
  const s = setup(), h = s.model.issue(s.q, { phase: "c0", challenge: id(101), observation: obs() });
  s.model.cancel(s.q, { observation: obs() });
  assert.throws(() => s.model.receive(s.q, h, { observation: obs(), checkpoint_claim: claim(s.binding, id(101)) }), /release_only/);
  s.model.release(s.q, { observation: obs(), outcome: "unconfirmed" });
  assert.throws(() => s.begin(300), /already_active/);
  s.model.release(s.q, { observation: obs(), outcome: "confirmed" });
  assert.equal(s.model.describe(s.q).model_order_consistent, false); s.begin(300);
});
test("B3-A unconfirmed release after a completed model remains a failure after cleanup retry", () => {
  const s = setup(); beforeC1(s); receive(s, "c1", 102);
  for (const phase of ["native_checked_after_c1", "interpretation_complete"]) s.model.advance(s.q, { phase, observation: obs() });
  s.model.finish(s.q, { observation: obs() }); s.model.release(s.q, { observation: obs(), outcome: "unconfirmed" });
  assert.equal(s.model.describe(s.q).failure, "b3a_release_unconfirmed");
  s.model.release(s.q, { observation: obs(), outcome: "confirmed" }); assert.equal(s.model.describe(s.q).model_order_consistent, false);
});
test("B3-A premature release invalidates the active model", () => {
  const s = setup(); assert.throws(() => s.model.release(s.q, { observation: obs(), outcome: "confirmed" }), /release_order/);
  assert.equal(s.model.describe(s.q).state, "releasing");
  assert.throws(() => s.model.issue(s.q, { phase: "c0", challenge: id(101), observation: obs() }), /release_only/);
});
test("B3-A terminal handles and model close cannot be reused", () => {
  const s = setup(); complete(s);
  assert.throws(() => s.model.cancel(s.q, { observation: obs() }), /terminal/);
  assert.throws(() => s.model.advance(s.q, { phase: "pair_open", observation: obs() }), /terminal/);
  s.model.close(); s.model.close(); assert.equal(s.model.describe(s.q).state, "revoked");
  assert.equal(s.model.describe(s.q).model_order_consistent, false); assert.throws(() => s.begin(300), /closed/);
});
test("B3-A retains query/challenge tombstones and discovered record roles across queries", () => {
  const s = setup(); complete(s);
  assert.throws(() => s.begin(), /identity_reuse/);
  assert.throws(() => s.begin(200), /identity_reuse/);
  s.q = s.begin(300);
  assert.throws(() => s.model.issue(s.q, { phase: "c0", challenge: id(101), observation: obs() }), /identity_reuse/);
});
for (const roles of [[id(101)], [id(100)], [id(1)], [id(200), id(200)]]) test(`B3-A discovers role aliases ${roles.join(",")}`, () => {
  const s = setup(); receive(s, "c0", 101);
  for (const phase of ["pair_open", "inventoried"]) s.model.advance(s.q, { phase, observation: obs() });
  assert.throws(() => s.model.bindRecords(s.q, { observation: obs(), sequence: "1", tip_hash: evidenceHash("invented tip"), record_role_ids: roles }), /identity_reuse/);
});
test("B3-A cannot bind a different supplied prefix", () => {
  const s = setup(); receive(s, "c0", 101);
  for (const phase of ["pair_open", "inventoried"]) s.model.advance(s.q, { phase, observation: obs() });
  assert.throws(() => s.model.bindRecords(s.q, { observation: obs(), sequence: "2", tip_hash: evidenceHash("invented tip"), record_role_ids: [] }), /prefix_binding/);
});
test("B3-A state accounting allows the exact bound, refuses one less, and never evicts used IDs", () => {
  const b = fixture(), used = BigInt(Buffer.byteLength(canonical(b)) + 65536 + 4096);
  const s = setup({ retained_state_limit_bytes: String(used) }); s.model.cancel(s.q, { observation: obs() });
  s.model.release(s.q, { observation: obs(), outcome: "confirmed" });
  assert.throws(() => s.begin(300), /state_budget/); assert.throws(() => s.begin(), /identity_reuse/);
  assert.throws(() => setup({ retained_state_limit_bytes: String(used - 1n) }), /state_budget/);
  assert.throws(() => setup({ retained_state_limit_bytes: "16777217" }), /state_limit_raise/);
});
for (const [label, mutate] of [
  ["extra", (v) => { v.native_read_available = true; }], ["cycle", (v) => { v.self = v; }],
  ["sparse", (v) => { v.registration.bindings.ancestors = new Array(1e8); }],
  ["symbol", (v) => { v[Symbol()] = 1; }], ["prototype", (v) => { Object.setPrototypeOf(v, { toJSON() { throw Error("called"); } }); }],
  ["bytes", (v) => { v.extra = "x".repeat(128 * 1024 + 1); }],
  ["depth", (v) => { let p = v; for (let i = 0; i < 66; i++) p = p.child = {}; }],
]) test(`B3-A refuses non-contract registration ${label}`, () => {
  const b = fixture(); mutate(b); assert.throws(() => api.createSyntheticAdmissionQueryProtocolModel(b), /b3a_/);
});
test("B3-A does not invoke input accessors or expose private input in errors", () => {
  const s = setup(); let calls = 0;
  const raw = { phase: "c0", challenge: id(101), observation: obs() };
  Object.defineProperty(raw, "/private/secret", { enumerable: true, get() { calls++; return 1; } });
  assert.throws(() => s.model.issue(s.q, raw), (e) => e.message === "b3a_non_json"); assert.equal(calls, 0);
  assert.equal(s.model.describe(s.q).failure, "b3a_non_json");
});
for (const key of ["entries", "inventory_bytes", "metadata_bytes", "read_bytes", "response_bytes"])
  test(`B3-A exact whole-query ${key} limit and one over`, () => {
    const q = budget(), used = api.calculateSyntheticAdmissionQueryProtocolBudget(q).used;
    q.limits = { [key]: Number(used[key]) };
    assert.equal(api.calculateSyntheticAdmissionQueryProtocolBudget(q).model_fits, true);
    q.limits[key]--; assert.ok(api.calculateSyntheticAdmissionQueryProtocolBudget(q).blockers.includes(`${key}_limit`));
  });
for (const [key, good, bad, blocker] of [["live_roots", "6", "7", "root_lease_limit"], ["live_targets", "32", "33", "live_target_limit"], ["live_fds", "464", "465", "descriptor_headroom_limit"]])
  test(`B3-A keeps global resource ceiling ${key}`, () => {
    const q = budget(); q.resources[key] = good; assert.equal(api.calculateSyntheticAdmissionQueryProtocolBudget(q).model_fits, true);
    q.resources[key] = bad; assert.ok(api.calculateSyntheticAdmissionQueryProtocolBudget(q).blockers.includes(blocker));
  });
test("B3-A charges additional copies/work and cannot lower its fixed schedule", () => {
  const q = budget(), before = api.calculateSyntheticAdmissionQueryProtocolBudget(q);
  q.retained_protocol_bytes = "100"; q.decoded_transcript_bytes = "200"; q.verifier_work_bytes = "300"; q.provider_work_bytes = "400";
  const after = api.calculateSyntheticAdmissionQueryProtocolBudget(q);
  // With no content, the transcript/verifier floors are zero, so those add in full; retained protocol bytes below the
  // three-report floor are absorbed by it, and only the excess above that floor adds.
  assert.equal(BigInt(after.used.metadata_bytes) - BigInt(before.used.metadata_bytes), 200n);
  assert.equal(BigInt(after.used.read_bytes) - BigInt(before.used.read_bytes), 700n);
  const reports = 3n * (16384n + BigInt(before.used.entries) * 5120n); q.retained_protocol_bytes = String(reports + 1000n);
  assert.equal(BigInt(api.calculateSyntheticAdmissionQueryProtocolBudget(q).used.metadata_bytes) - BigInt(before.used.metadata_bytes), 1200n);
  q.inventory_passes = 1; assert.throws(() => api.calculateSyntheticAdmissionQueryProtocolBudget(q), /invalid_input/);
});
test("B3-A uses bounded BigInt arithmetic instead of repeating work for huge counts", () => {
  // Each object is bounded by its native role cap (1 MiB at most); the object count itself may be huge.
  const q = budget(); q.read_work = [{ kind: "content", bytes: "1048576", count: "999999999999999999999999999999" }];
  const r = api.calculateSyntheticAdmissionQueryProtocolBudget(q); assert.equal(r.model_fits, false); assert.ok(BigInt(r.used.read_bytes) > 10n ** 35n);
});
test("B3-A strict result validation cannot qualify forged reports", () => {
  const s = setup(), r = complete(s);
  for (const k of Object.keys(r).filter((k) => r[k] === false)) assert.equal(api.nativeBarAdmissionQueryModelResultSchema.safeParse({ ...r, [k]: true }).success, false, k);
  assert.equal(api.nativeBarAdmissionQueryModelResultSchema.safeParse({ ...r, raw_signature: "no" }).success, false);
  assert.equal(api.nativeBarAdmissionQueryModelResultSchema.safeParse({ ...r, state: "query_started" }).success, false);
});
test("B3-A a delayed C0 response consumes the outstanding C1, without poisoning a foreign owner", () => {
  const s = setup(), old = receive(s, "c0", 101);
  for (const phase of ["pair_open", "inventoried"]) s.model.advance(s.q, { phase, observation: obs() });
  s.model.bindRecords(s.q, { observation: obs(), sequence: "1", tip_hash: evidenceHash("invented tip"), record_role_ids: [] });
  s.model.advance(s.q, { phase: "native_checked_before_c1", observation: obs() });
  const current = s.model.issue(s.q, { phase: "c1", challenge: id(102), observation: obs() });
  assert.throws(() => s.model.receive(s.q, old, { observation: obs(), checkpoint_claim: claim(s.binding, id(101)) }), /request_handle_required/);
  assert.throws(() => s.model.receive(s.q, current, { observation: obs(), checkpoint_claim: claim(s.binding, id(102)) }), /release_only/);
  const a = setup(), b = setup(), bh = b.model.issue(b.q, { phase: "c0", challenge: id(101), observation: obs() });
  a.model.issue(a.q, { phase: "c0", challenge: id(101), observation: obs() });
  assert.throws(() => a.model.receive(a.q, bh, {}), /request_handle_required/);
  b.model.receive(b.q, bh, { observation: obs(), checkpoint_claim: claim(b.binding, id(101)) });
  assert.equal(b.model.describe(b.q).state, "c0_model_received");
});
test("B3-A repeat record-role IDs are allowed across queries but cannot become fresh challenges", () => {
  const s = setup(); complete(s); s.q = s.begin(300); receive(s, "c0", 301);
  for (const phase of ["pair_open", "inventoried"]) s.model.advance(s.q, { phase, observation: obs() });
  s.model.bindRecords(s.q, { observation: obs(), sequence: "1", tip_hash: evidenceHash("invented tip"), record_role_ids: [id(200)] });
  s.model.advance(s.q, { phase: "native_checked_before_c1", observation: obs() });
  assert.throws(() => s.model.issue(s.q, { phase: "c1", challenge: id(200), observation: obs() }), /identity_reuse/);
});
for (const step of ["finish", "release"]) test(`B3-A includes ${step} in the original supplied deadline`, () => {
  const s = setup(); beforeC1(s); receive(s, "c1", 102);
  for (const phase of ["native_checked_after_c1", "interpretation_complete"]) s.model.advance(s.q, { phase, observation: obs() });
  if (step === "finish") assert.throws(() => s.model.finish(s.q, { observation: obs(600000) }), /expired/);
  else s.model.finish(s.q, { observation: obs() });
  s.model.release(s.q, { observation: obs(600000), outcome: "confirmed" });
  assert.equal(s.model.describe(s.q).model_order_consistent, false); assert.equal(s.model.describe(s.q).failure, "b3a_expired");
});
test("B3-A malformed cleanup is retry-only, and revoked/serialized handles cannot restart work", () => {
  const s = setup(); assert.throws(() => s.model.release(s.q, { observation: obs(), outcome: "confirmed", native_released: true }), /invalid_input/);
  assert.equal(s.model.describe(s.q).state, "releasing");
  s.model.release(s.q, { observation: obs(), outcome: "confirmed" });
  s.model.close(); assert.throws(() => s.model.issue(s.q, {}), /closed/);
  const b2 = calculateSyntheticAdmissionReadBudget;
  assert.throws(() => b2(s.model.describe(s.q)), /b2a_invalid_input/);
});
test("B3-A exact budget formula charges V1, copied content, bounded protocol state and independent work", () => {
  const q = budget(); q.read_work = [{ kind: "content", bytes: "1000", count: "3" }, { kind: "acl", bytes: "7", count: "2" }];
  const { binding, retained_protocol_bytes, decoded_transcript_bytes, verifier_work_bytes, provider_work_bytes, ...b2 } = q;
  const f = calculateSyntheticAdmissionReadBudget({ ...b2, registration: binding.registration }), r = api.calculateSyntheticAdmissionQueryProtocolBudget(q);
  const reg = binding.registration, controls = BigInt(reg.bindings.markers.base.size) + BigInt(reg.bindings.markers.admission.size)
    + BigInt(Buffer.byteLength(canonical({ schema: "native-bar-synthetic-admission-profile-v6" })));
  // V1 native passes run inside the native allowance; only outer work (B-1 decoding, framing, scratch) is subtracted from it.
  const v1Native = 3000n + 3n * 65536n + 2n * BigInt(f.used.entries) * 4608n + controls * 6n + 3n * BigInt(reg.bindings.ancestors.length + 4) * 12288n;
  // Supplied verifier/transcript/protocol counters are "0", so their schedule floors apply: two B-1 verifications plus
  // per-record overhead, one decoded copy, and the three retained native reports.
  const frame = 16384n + BigInt(f.used.entries) * 5120n, outer = 3n * 3000n + 10n * 4096n + 65536n + (2n * 3000n + 3n * 4096n);
  assert.equal(BigInt(r.used.read_bytes) - BigInt(f.used.read_bytes), v1Native + outer);
  assert.equal(BigInt(r.native_allowance.read_bytes), 268435456n - outer);
  assert.equal(BigInt(r.used.metadata_bytes) - BigInt(f.used.metadata_bytes),
    6000n + 10n * 4096n + 65536n + 65536n + 521n * 4096n + BigInt(Buffer.byteLength(canonical(binding))) + 3n * frame + 3000n);
  assert.ok(api.nativeBarAdmissionQueryModelBudgetResultSchema.safeParse(r).success);
  assert.equal(api.nativeBarAdmissionQueryModelBudgetResultSchema.safeParse({ ...r, model_fits: false }).success, false);
  assert.equal(api.nativeBarAdmissionQueryModelBudgetResultSchema.safeParse({ ...r, schedule: { ...r.schedule, final_rehashes: 1 } }).success, false);
});
for (const [label, mutate] of [
  ["raised limit", (q) => { q.limits = { read_bytes: 268435457 }; }],
  ["noninteger limit", (q) => { q.limits = { entries: 1.5 }; }],
  ["excess work slots", (q) => { q.read_work = Array.from({ length: 513 }, () => ({ kind: "content", bytes: "1", count: "1" })); }],
  ["zero count", (q) => { q.read_work = [{ kind: "content", bytes: "1", count: "0" }]; }],
  ["numeric count", (q) => { q.retained_protocol_bytes = 0; }],
  ["registration drift", (q) => { q.binding.registration.bindings.data.inode = "888"; }],
]) test(`B3-A rejects budget ${label}`, () => {
  const q = budget(); mutate(q); assert.throws(() => api.calculateSyntheticAdmissionQueryProtocolBudget(q), /b[23]a_/);
});
test("B3-A at an exact-fit limit the native allowance still covers the B-2 floor plus the V1 native passes", () => {
  const q = budget(); q.inventory.data.entries = "40"; q.inventory.witness.entries = "40"; q.read_work = [{ kind: "content", bytes: "16384", count: "40" }];
  q.limits = { read_bytes: Number(api.calculateSyntheticAdmissionQueryProtocolBudget(q).used.read_bytes) };
  const plan = api.calculateSyntheticAdmissionQueryProtocolBudget(q), reg = q.binding.registration;
  assert.equal(plan.model_fits, true); assert.equal(plan.remaining.read_bytes, "0");
  const { binding, retained_protocol_bytes, decoded_transcript_bytes, verifier_work_bytes, provider_work_bytes, limits, ...b2 } = q;
  const floor = BigInt(calculateSyntheticAdmissionReadBudget({ ...b2, registration: reg }).used.read_bytes);
  const controls = BigInt(reg.bindings.markers.base.size) + BigInt(reg.bindings.markers.admission.size)
    + BigInt(Buffer.byteLength(canonical({ schema: "native-bar-synthetic-admission-profile-v6" })));
  const v1Native = 40n * 16384n + 40n * 65536n + 2n * BigInt(plan.used.entries) * 4608n + controls * 43n + 3n * BigInt(reg.bindings.ancestors.length + 4) * 12288n;
  // Before the fix the allowance equalled the four-pass floor alone, about 4 MB short of the native work the plan counts.
  assert.ok(BigInt(plan.native_allowance.read_bytes) >= floor + v1Native, `${plan.native_allowance.read_bytes} < ${floor + v1Native}`);
});
test("B3-A checkpoint and prefix sequences start at 1, as in B-1", () => {
  const s = setup(), r = s.model.issue(s.q, { phase: "c0", challenge: id(200), observation: obs() });
  assert.throws(() => s.model.receive(s.q, r, { observation: obs(), checkpoint_claim: claim(s.binding, id(200), { sequence: "0" }) }), /invalid_input/);
});
function fullProtocol(s) {
  for (const [phase, n] of [["c0", 200]]) receive(s, phase, n);
  s.model.advance(s.q, { phase: "pair_open", observation: obs() }); s.model.advance(s.q, { phase: "inventoried", observation: obs() });
  s.model.bindRecords(s.q, { observation: obs(), sequence: "1", tip_hash: evidenceHash("invented tip"), record_role_ids: [] });
  s.model.advance(s.q, { phase: "native_checked_before_c1", observation: obs() });
  const c1 = receive(s, "c1", 201);
  s.model.advance(s.q, { phase: "native_checked_after_c1", observation: obs() }); s.model.advance(s.q, { phase: "interpretation_complete", observation: obs() });
  s.model.finish(s.q, { observation: obs() }); return c1;
}
test("B3-A an out-of-order event between finish and release is recorded, so the query cannot end consistent", () => {
  const control = setup(); fullProtocol(control); control.model.release(control.q, { observation: obs(), outcome: "confirmed" });
  assert.equal(control.model.describe(control.q).model_order_consistent, true);
  for (const event of [(s) => s.model.advance(s.q, { phase: "pair_open", observation: obs() }), (s) => s.model.finish(s.q, { observation: obs() }),
    (s) => s.model.issue(s.q, { phase: "c1", challenge: id(300), observation: obs() })]) {
    const s = setup(); fullProtocol(s); assert.throws(() => event(s), /release_only/);
    s.model.release(s.q, { observation: obs(), outcome: "confirmed" }); const d = s.model.describe(s.q);
    assert.equal(d.state, "released"); assert.equal(d.model_order_consistent, false); assert.equal(d.failure, "b3a_release_only");
  }
});
test("B3-A cleanup keeps release_unconfirmed, ignores rolled-back cleanup time, and reports a closed model", () => {
  const s = setup(); s.model.cancel(s.q, { observation: obs(5) });
  s.model.release(s.q, { observation: obs(6), outcome: "unconfirmed" }); s.model.cancel(s.q, { observation: obs(1) });
  const d = s.model.describe(s.q); assert.equal(d.state, "release_unconfirmed"); assert.equal(d.last_supplied_observation.utc_at, obs(6).utc_at);
  s.model.close(); assert.throws(() => s.model.cancel(s.q, { observation: obs(7) }), /b3a_model_closed/);
});
test("B3-A budget refusals use b3a codes, and verifier/transcript/report retention have schedule floors", () => {
  assert.throws(() => api.calculateSyntheticAdmissionQueryProtocolBudget({ ...budget(), limits: { read_bytes: 268435457 } }), (e) => e.message === "b3a_limits");
  const q = budget(); q.inventory.data.entries = "200"; q.read_work = [{ kind: "content", bytes: "16384", count: "100", cap_bytes: "16384" }];
  const low = api.calculateSyntheticAdmissionQueryProtocolBudget(q);
  q.verifier_work_bytes = String(2n * 100n * 16384n + 100n * 4096n); q.decoded_transcript_bytes = String(100n * 16384n);
  q.retained_protocol_bytes = String(3n * (16384n + BigInt(low.used.entries) * 5120n));
  const explicit = api.calculateSyntheticAdmissionQueryProtocolBudget(q);
  // Supplying the floors explicitly changes nothing: "0" was already charged at least that much.
  assert.equal(low.used.read_bytes, explicit.used.read_bytes); assert.equal(low.used.metadata_bytes, explicit.used.metadata_bytes);
});
