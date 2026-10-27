import test from "node:test";
import assert from "node:assert/strict";
import module, { syncBuiltinESMExports } from "node:module";

const nativeLoads = [], originalRequire = module.createRequire, originalDlopen = process.dlopen;
module.createRequire = (...args) => new Proxy(originalRequire(...args), { apply(target, self, args) {
  if (/\.node$/.test(String(args[0]))) { nativeLoads.push(String(args[0])); throw Error("cc0_native_load_forbidden"); }
  return Reflect.apply(target, self, args);
} });
process.dlopen = (_module, file) => { nativeLoads.push(String(file)); throw Error("cc0_native_load_forbidden"); };
syncBuiltinESMExports();
test.after(() => { module.createRequire = originalRequire; process.dlopen = originalDlopen; syncBuiltinESMExports(); assert.deepEqual(nativeLoads, []); });
const api = await import("../helpers/jointAcceptanceContracts.mjs");
const hash = (n) => String(n).repeat(64);
function manifest() {
  return { schema: "native-bar-joint-acceptance-plan-v1", run_id: "invented-run-1", stage: "C-C0",
    source: { commit: "a".repeat(40), patch_sha256: hash(1) },
    build: { mode: "normal", profile: "synthetic-only-protocol-6", source_sha256: hash(2), addon_sha256: null },
    ownership: { anchor: "private_tmp", creation: "exclusive_new", teardown: "not_selected", ancestor_headroom_bytes: "4096" },
    cases: [{ case_id: "gate-1", row: "G0", expected_layer: "plan", expected_code: "stage_not_approved", envelope_sha256: null }] };
}
test("C-C0 detaches a declared plan without approving, observing or executing it", () => {
  const input = manifest(), result = api.describeJointAcceptancePlan(input);
  input.ownership.anchor = "changed";
  assert.equal(result.manifest.ownership.anchor, "private_tmp");
  assert.equal(result.execution_available, false);
  assert.equal(result.approval_authenticated, false);
  assert.equal(result.environment_observed, false);
  assert.equal(result.ownership_verified, false);
  assert.equal(result.native_read_available, false);
  assert.equal(result.disposition, "memory_contract_only");
  assert.equal(result.output_layout.mode_directory, "build/b3cc-validation/normal/");
  assert.ok(Object.isFrozen(result.manifest.ownership));
});
function observation(plan, changes = {}) {
  return { schema: "native-bar-joint-acceptance-memory-observation-v1", case_id: "gate-1",
    manifest_sha256: plan.manifest_sha256, evidence: "memory_contract_only", observed_layer: "plan", observed_code: "stage_not_approved",
    assertions: { no_native_load: true, no_fixture_io: true, no_signing: true },
    supplied_timing: { start_jst: "2026-10-28T10:00:00.000+09:00", end_jst: "2026-10-28T10:00:00.001+09:00", start_mono_ns: "100", end_mono_ns: "200" }, ...changes };
}
test("C-C0 keeps all memory attempts and never counts a future row as native acceptance", () => {
  const m = manifest(); m.cases.push({ case_id: "signed-1", row: "S0", expected_layer: "released",
    expected_code: "minimal_enrollment_consistent", envelope_sha256: hash(3) });
  const plan = api.describeJointAcceptancePlan(m), ledger = api.createJointAcceptanceMemoryLedger(m);
  assert.equal(ledger.describe().cases[0].status, "NOT_RUN");
  ledger.record(observation(plan, { observed_code: "invalid_input" }));
  const good = observation(plan); ledger.record(good); good.assertions.no_native_load = false;
  const report = ledger.describe();
  assert.equal(report.cases[0].status, "FAIL");
  assert.deepEqual(report.attempts.map((a) => a.status), ["FAIL", "PASS"]);
  assert.equal(report.attempts[1].observation.assertions.no_native_load, true);
  assert.equal(report.cases[1].status, "NOT_RUN");
  assert.equal(report.native_status, "NOT_RUN");
  assert.equal(report.view_verified, false);
  assert.equal(report.timing_verified, false);
  assert.equal(report.cleanup, "not_performed");
  assert.throws(() => ledger.record(observation(plan, { case_id: "signed-1" })), /native_case_not_implemented/);
  assert.equal(ledger.describe().attempts.length, 2);
});
for (const stage of ["C-C0", "C-C1", "C-C2", "C-C3"])
  for (const mode of ["normal", "ubsan"])
    test(`C-C0 only describes ${stage}/${mode}; neither flags nor plans authorize execution`, () => {
      const m = manifest(); m.stage = stage; m.build.mode = mode;
      const d = api.describeJointAcceptancePlan(m);
      assert.equal(d.disposition, stage === "C-C0" ? "memory_contract_only" : "separate_approval_required");
      assert.equal(d.output_layout.mode_directory, `build/b3cc-validation/${mode}/`);
      assert.equal(d.output_layout.exists, "not_observed");
      for (const [k, v] of Object.entries(d)) if (/_verified$|_available$|_authenticated$|_qualified$|_enforced$|_observed$/.test(k)) assert.equal(v, false, k);
      const ledger = api.createJointAcceptanceMemoryLedger(m);
      if (stage !== "C-C0") assert.throws(() => ledger.record(observation(d)), /native_case_not_implemented/);
      assert.equal(ledger.describe().native_status, "NOT_RUN");
    });
const mutations = [
  ["missing stage", (m) => { delete m.stage; }], ["unknown stage", (m) => { m.stage = "C-C4"; }],
  ["backend", (m) => { m.backend = {}; }], ["clock", (m) => { m.clock = {}; }],
  ["grant", (m) => { m.grant = {}; }], ["copied grant", (m) => { m.enrollment = structuredClone({}); }],
  ["approval token", (m) => { m.approval = "approved"; }], ["execution", (m) => { m.execution_available = true; }],
  ["root path", (m) => { m.ownership.path = "/private/tmp/real"; }], ["anchor alias", (m) => { m.ownership.anchor = "/tmp"; }],
  ["existing fixture", (m) => { m.ownership.creation = "reuse"; }], ["recursive cleanup", (m) => { m.ownership.teardown = "recursive_force"; }],
  ["unknown mode", (m) => { m.build.mode = "production"; }], ["mixed outputs", (m) => { m.build.oracle_mode = "ubsan"; }],
  ["output override", (m) => { m.build.output_directory = "build/"; }], ["protocol override", (m) => { m.build.profile = "synthetic-only-protocol-7"; }],
  ["headroom number", (m) => { m.ownership.ancestor_headroom_bytes = 4096; }], ["leading zero", (m) => { m.ownership.ancestor_headroom_bytes = "01"; }],
  ["negative headroom", (m) => { m.ownership.ancestor_headroom_bytes = "-1"; }], ["oversize headroom", (m) => { m.ownership.ancestor_headroom_bytes = "1".repeat(30); }],
  ["unknown row", (m) => { m.cases[0].row = "F7"; }], ["duplicate case", (m) => { m.cases.push({ ...m.cases[0] }); }],
  ["unbound layer/code", (m) => { m.cases[0].expected_code = "record_refused"; }],
  ["fake envelope", (m) => { m.cases[0].envelope_sha256 = hash(4); }],
  ["empty cases", (m) => { m.cases = []; }], ["too many cases", (m) => { m.cases = Array.from({ length: 65 }, (_, n) => ({ ...m.cases[0], case_id: `gate-${n}` })); }],
  ["callback", (m) => { m.callback = () => {}; }], ["symbol", (m) => { m[Symbol()] = false; }],
  ["hidden property", (m) => { Object.defineProperty(m, "extra", { value: true }); }],
  ["cyclic value", (m) => { m.cycle = m; }], ["sparse cases", (m) => { m.cases.length = 2; }],
  ["decorated array", (m) => { m.cases.extra = false; }], ["non JSON object", (m) => { m.build = new Map(); }],
];
for (const [name, change] of mutations) test(`C-C0 refuses ${name} without invoking a runner`, () => {
  const m = manifest(); change(m); assert.throws(() => api.describeJointAcceptancePlan(m), /cc0_/);
});
test("C-C0 never evaluates input getters or toJSON methods", () => {
  let calls = 0;
  for (const key of ["stage", "source", "build", "ownership", "cases", "toJSON"]) {
    const m = manifest(); Object.defineProperty(m, key, { enumerable: true, get() { calls++; throw Error("must_not_call"); } });
    assert.throws(() => api.describeJointAcceptancePlan(m), /cc0_invalid_input/);
  }
  const m = manifest(); m.toJSON = () => { calls++; return {}; };
  assert.throws(() => api.describeJointAcceptancePlan(m), /cc0_invalid_input/); assert.equal(calls, 0);
});
test("C-C0 canonical digest is ordering-stable and binds the entire declaration", () => {
  const m = manifest(), a = api.describeJointAcceptancePlan(m);
  const reordered = Object.fromEntries(Object.entries(m).reverse());
  reordered.source = Object.fromEntries(Object.entries(m.source).reverse());
  assert.equal(api.describeJointAcceptancePlan(reordered).manifest_sha256, a.manifest_sha256);
  for (const change of [(m) => { m.build.mode = "ubsan"; }, (m) => { m.source.patch_sha256 = hash(5); },
    (m) => { m.ownership.ancestor_headroom_bytes = "8192"; }, (m) => { m.ownership.teardown = "receipt_bounded_node"; }]) {
    const changed = manifest(); change(changed); assert.notEqual(api.describeJointAcceptancePlan(changed).manifest_sha256, a.manifest_sha256);
  }
});
test("C-C0 future rows require an envelope and retain the exact expected refusal layer", () => {
  const m = manifest(); m.cases = [{ case_id: "maintenance-1", row: "U3", expected_layer: "interpretation",
    expected_code: "transaction_mapping_pending", envelope_sha256: hash(3) }];
  assert.equal(api.describeJointAcceptancePlan(m).cases[0].required_stage, "C-C1");
  m.cases[0].expected_layer = "inventory";
  assert.throws(() => api.describeJointAcceptancePlan(m), /expectation_binding/);
  m.cases[0].expected_code = "work_envelope";
  assert.equal(api.describeJointAcceptancePlan(m).manifest.cases[0].expected_code, "work_envelope");
  m.cases[0].envelope_sha256 = null; assert.throws(() => api.describeJointAcceptancePlan(m), /envelope_binding/);
});
test("C-C0 refuses inherited layer names with the normal coded refusal", () => {
  const m = manifest(); m.cases[0].expected_layer = "constructor";
  assert.throws(() => api.describeJointAcceptancePlan(m), /^Error: cc0_expectation_binding$/);
});
test("C-C0 validates every planned row but refuses to record any native-stage observation", () => {
  const rows = [
    ["U0", "checkpoint_c0", "checkpoint_refused"], ["U1", "record", "record_refused"], ["U2", "prefix", "witness_prefix"],
    ["U3", "inventory", "publication_pending"], ["U4", "native", "native_refused"], ["S0", "released", "minimal_enrollment_consistent"],
    ["S1", "plan", "budget"], ["F0", "checkpoint_c1", "changing"], ["F1", "cancellation", "oracle_cancelled"],
    ["F2", "native_v1", "native_changed"], ["F3", "clock", "clock_rollback"], ["F4", "native_begin", "native_busy"],
    ["F5", "cleanup", "release_unconfirmed"], ["F6", "native_begin", "native_unavailable"], ["B0", "plan", "budget"],
  ];
  for (const [row, expected_layer, expected_code] of rows) {
    const m = manifest(); m.cases = [{ case_id: "future-1", row, expected_layer, expected_code, envelope_sha256: hash(3) }];
    const plan = api.describeJointAcceptancePlan(m), ledger = api.createJointAcceptanceMemoryLedger(m);
    assert.throws(() => ledger.record(observation(plan, { case_id: "future-1" })), /native_case_not_implemented/);
    assert.equal(ledger.describe().cases[0].status, "NOT_RUN");
  }
});
test("C-C0 does not erase failures when an assertion fails or a different layer/code is reached", () => {
  const plan = api.describeJointAcceptancePlan(manifest()), ledger = api.createJointAcceptanceMemoryLedger(manifest());
  for (const change of [{ observed_layer: "record" }, { observed_code: "work_envelope" },
    ...["no_native_load", "no_fixture_io", "no_signing"].map((key) => ({ assertions: { no_native_load: true, no_fixture_io: true, no_signing: true, [key]: false } }))])
    assert.equal(ledger.record(observation(plan, change)).status, "FAIL");
  assert.equal(ledger.record(observation(plan)).status, "PASS");
  assert.equal(ledger.describe().cases[0].status, "FAIL");
  assert.equal(ledger.describe().attempts.length, 6);
});
test("C-C0 rejects forged report fields, rebound plans and invalid times without accepting evidence", () => {
  const plan = api.describeJointAcceptancePlan(manifest()), ledger = api.createJointAcceptanceMemoryLedger(manifest());
  for (const changes of [{ manifest_sha256: hash(9) }, { case_id: "unknown-1" }, { evidence: "native_verified" },
    { view_verified: true }, { native_read_available: true }, { cleanup: "confirmed" }, { signature: hash(1) }, { raw_bytes: "invented" },
    { path: "/private/tmp/example" }, { timing_verified: true }, { assertions: { no_native_load: true, no_fixture_io: true, no_signing: true, extra: true } }])
    assert.throws(() => ledger.record(observation(plan, changes)), /cc0_/);
  for (const change of [{ end_jst: "2026-10-28T09:59:59.000+09:00" }, { end_jst: "2026-10-28T01:00:00.001Z" },
    { end_jst: "2026-02-30T10:00:00.001+09:00" }, { end_mono_ns: "99" }, { end_mono_ns: "02" }]) {
    const o = observation(plan); Object.assign(o.supplied_timing, change); assert.throws(() => ledger.record(o), /cc0_/);
  }
  assert.equal(ledger.describe().attempts.length, 0);
});
test("C-C0 bounds the append-only memory ledger and freezes past reports", () => {
  const m = manifest(), plan = api.describeJointAcceptancePlan(m), ledger = api.createJointAcceptanceMemoryLedger(m), before = ledger.describe();
  for (let i = 0; i < 128; i++) assert.equal(ledger.record(observation(plan)).ordinal, i + 1);
  assert.throws(() => ledger.record(observation(plan)), /attempt_bound/);
  assert.equal(ledger.describe().attempts.length, 128); assert.equal(before.attempts.length, 0);
  assert.throws(() => ledger.describe().attempts.pop(), TypeError);
  assert.throws(() => before.cases[0].status = "PASS", TypeError);
  assert.throws(() => ledger.begin = () => {}, TypeError);
});
