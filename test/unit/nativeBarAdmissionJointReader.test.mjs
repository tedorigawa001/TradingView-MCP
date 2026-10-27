import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { binding, id, publicKey } from "./helpers/checkpointProbeFixture.mjs";
import { enrollUnsignedCheckpointOracle } from "../helpers/unsignedCheckpointOracle.mjs";
import { enrollFixedMemoryCheckpointOracle } from "../helpers/fixedMemoryCheckpointOracle.mjs";
import module, { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

// Main-thread tripwire: every test here must refuse before any native begin. A regression must fail without loading the
// addon that a common build/ directory may contain; the refusal workers install their own refusing loader.
const nativeLoads = [], hostCreateRequire = module.createRequire;
module.createRequire = (...args) => new Proxy(hostCreateRequire(...args), { apply(target, self, list) {
  if (/\.node$/.test(String(list[0]))) { nativeLoads.push(String(list[0])); throw Error("main_thread_native_load_refused"); }
  return Reflect.apply(target, self, list);
} });
const nativeTrap = (_module, file) => { nativeLoads.push(String(file)); throw Error("main_thread_native_load_refused"); };
process.dlopen = nativeTrap;
syncBuiltinESMExports();

const base = process.env.NATIVE_BAR_B3BC_ISOLATED_TEST === "1" ? "../../build/b3bc-validation/" : "../../build/";
const joint = await import(new URL(`${base}nativeBarAdmissionJointReader.js`, import.meta.url));
const { enrollSyntheticCheckpointProbe } = await import(new URL(`${base}nativeBarAdmissionCheckpointProbe.js`, import.meta.url));
const registry = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
const { evidenceHash } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
function configuration(n) {
  return { binding: { ...binding(n), schema: "native-bar-joint-read-binding-v1", scope: "synthetic_joint_read_model_only" },
    envelope: { schema: "native-bar-joint-read-work-envelope-v1", inventory: {
      data: { entries: "1", inventory_bytes: "64", metadata_bytes: "64" }, witness: { entries: "1", inventory_bytes: "16384", metadata_bytes: "16384" },
      common: { entries: "8", inventory_bytes: "4096", metadata_bytes: "4096" } },
    objects: { witness_records: "1", producer_mirrors: "0", payloads: "0", receipts: "0", maintenance_metadata: "0" },
    selected_bytes: "16384", decoded_bytes: "102400", interpretation_bytes: "69632" } };
}
test("C-B creates distinct original joint/owner grants without loading native or creating a fixture", (t) => {
  const c = configuration(1300), b = joint.createSyntheticAdmissionJointBootstrap(c.binding, publicKey(), c.envelope);
  t.after(() => b.close());
  assert.notEqual(b.jointReaderEnrollment, b.ownerEnrollment);
  assert.equal(b.describe().native_read_available, false);
  for (const h of [{}, b.ownerEnrollment, structuredClone(b.jointReaderEnrollment), b.describe()])
    assert.throws(() => joint.enrollSyntheticAdmissionJointReader(h), /joint_grant_required/);
  assert.throws(() => enrollSyntheticCheckpointProbe(b.jointReaderEnrollment), /reader_grant_required/);
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, "unavailable"); t.after(() => owner.close());
  const s = joint.enrollSyntheticAdmissionJointReader(b.jointReaderEnrollment); t.after(() => s.close());
  assert.throws(() => joint.enrollSyntheticAdmissionJointReader(b.jointReaderEnrollment), /joint_grant_consumed/);
  assert.doesNotMatch(JSON.stringify(b.describe()), /temp_anchor|fixture_name|private|public_key/);
});
test("C-B refuses invalid work/options before any native construction or checkpoint request", (t) => {
  const c = configuration(1301), b = joint.createSyntheticAdmissionJointBootstrap(c.binding, publicKey(), c.envelope);
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, "unavailable"), s = joint.enrollSyntheticAdmissionJointReader(b.jointReaderEnrollment);
  t.after(() => { s.close(); owner.close(); b.close(); });
  for (const raw of [{ backend: {} }, { ttl_ms: 0 }, { work_envelope: c.envelope }, { lower_limits: { read_bytes: 1 } }])
    assert.throws(() => s.beginJointRead(raw), /b3cb_/);
  assert.equal(b.describe().active_workspace_bytes, "0");
});
test("C-B transport grants cannot cross probe/joint kinds; observed record IDs reserve original slots", async (t) => {
  const c = configuration(1302), b = registry.createSyntheticJointCheckpointOracleBootstrap(c.binding, publicKey(), c.envelope);
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, "unsigned"); t.after(() => { owner.close(); b.close(); });
  assert.throws(() => enrollSyntheticCheckpointProbe(b.readerEnrollment), /reader_grant_required/);
  const claim = registry.claimSyntheticJointCheckpointReader(b.readerEnrollment), lease = claim.acquire(8n * 4096n, 16777216n, () => {});
  t.after(() => lease.release());
  const query_id = "00000000-0000-4000-8000-000009999901", challenge = "00000000-0000-4000-8000-000009999902", record = "00000000-0000-4000-8000-000009999903";
  claim.identifier(query_id, 16777216n); claim.identifier(challenge, 16777216n);
  assert.throws(() => claim.bindRecordIds([record], 16777216n), /request_binding/);
  const { public_key_spki_sha256: _, ...pins } = c.binding.registration.pins;
  const op = claim.dispatch({ schema: "native-bar-checkpoint-probe-request-v1", scope: "synthetic_checkpoint_probe_only", ...pins,
    query_id, challenge, phase: "c0", registration_hash: c.binding.registration_hash, authority_reference: c.binding.registration.authority_reference });
  await op.promise; op.retire();
  const before = claim.accounting(); claim.bindRecordIds([record], 16777216n); const after = claim.accounting();
  assert.equal(after.retained - before.retained, 4096n); assert.equal(before.workspace - after.workspace, 4096n);
  claim.bindRecordIds([record], 16777216n); assert.deepEqual(claim.accounting(), after);
  assert.throws(() => claim.identifier(record, 16777216n), /identity_reuse/);
  assert.throws(() => claim.bindRecordIds([query_id], 16777216n), /identity_reuse/);
  const later = binding(1311); later.registration.authority_reference = record; later.registration_hash = evidenceHash(later.registration);
  const beforeRefusal = claim.accounting();
  assert.throws(() => registry.createSyntheticCheckpointOracleBootstrap(later, publicKey()), /identity_reuse/);
  assert.throws(() => registry.createSyntheticJointCheckpointOracleBootstrap({ ...later, schema: "native-bar-joint-read-binding-v1",
    scope: "synthetic_joint_read_model_only" }, publicKey(), c.envelope), /identity_reuse/);
  assert.deepEqual(claim.accounting(), beforeRefusal);
  const probe = registry.createSyntheticCheckpointOracleBootstrap(binding(1303), publicKey()); t.after(() => probe.close());
  assert.throws(() => registry.claimSyntheticJointCheckpointReader(probe.readerEnrollment), /reader_grant_required/);
});
test("C-B original lease checks survive release and still reject owner loss", (t) => {
  const c = configuration(1304), b = registry.createSyntheticJointCheckpointOracleBootstrap(c.binding, publicKey(), c.envelope);
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, "unavailable"); t.after(() => { owner.close(); b.close(); });
  const claim = registry.claimSyntheticJointCheckpointReader(b.readerEnrollment), lease = claim.acquire(4096n, 16777216n, () => {});
  t.after(() => lease.release());
  lease.check(); assert.equal(lease.release(), true); lease.check(); owner.close(); assert.throws(() => lease.check(), /oracle_unavailable/);
});
test("C-B an original lease still detects owner advancement after it released its active slot", (t) => {
  const c = configuration(1305), b = registry.createSyntheticJointCheckpointOracleBootstrap(c.binding, publicKey(), c.envelope);
  const owner = enrollFixedMemoryCheckpointOracle(b.ownerEnrollment, { sequence: "1", tip_hash: c.binding.registration.pins.enrollment_hash });
  t.after(() => { owner.close(); b.close(); });
  const claim = registry.claimSyntheticJointCheckpointReader(b.readerEnrollment), lease = claim.acquire(4096n, 16777216n, () => {});
  assert.equal(lease.release(), true); owner.advance({ sequence: "2", tip_hash: c.binding.registration.pins.enrollment_hash });
  assert.throws(() => lease.check(), /oracle_changed/); assert.equal(owner.describe().signed_requests, "0");
});
test("C-B owns detached full binding/envelope and cannot enroll an alias under a recomputed digest", (t) => {
  const c = configuration(1306), b = joint.createSyntheticAdmissionJointBootstrap(c.binding, publicKey(), c.envelope), before = b.describe();
  t.after(() => b.close()); c.envelope.selected_bytes = "1"; c.binding.registration.fixture_name = "native-bar-fs-synthetic-Changed";
  assert.deepEqual(b.describe(), before);
  assert.throws(() => joint.createSyntheticAdmissionJointBootstrap(configuration(1306).binding, publicKey(), configuration(1306).envelope), /duplicate_enrollment/);
  b.close(); assert.throws(() => joint.enrollSyntheticAdmissionJointReader(b.jointReaderEnrollment), /bootstrap_closed/);
});
test("C-B impossible work refuses before consuming namespace or owner/reader grants", (t) => {
  const c = configuration(1307); c.envelope.decoded_bytes = "1";
  assert.throws(() => joint.createSyntheticAdmissionJointBootstrap(c.binding, publicKey(), c.envelope), /budget/);
  const good = configuration(1307), b = joint.createSyntheticAdmissionJointBootstrap(good.binding, publicKey(), good.envelope); t.after(() => b.close());
  assert.equal(b.describe().revoked, false);
});
test("C-B does not invoke options getters or accept replacement path, response, clock or backend", (t) => {
  const c = configuration(1308), b = joint.createSyntheticAdmissionJointBootstrap(c.binding, publicKey(), c.envelope);
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, "unavailable"), s = joint.enrollSyntheticAdmissionJointReader(b.jointReaderEnrollment);
  t.after(() => { s.close(); owner.close(); b.close(); });
  for (const field of ["path", "response", "clock", "provider", "backend", "native_verified", "registration_hash"]) assert.throws(() => s.beginJointRead({ [field]: {} }), /invalid_input/);
  let calls = 0; const raw = {}; Object.defineProperty(raw, "ttl_ms", { enumerable: true, get() { calls++; return 100; } });
  assert.throws(() => s.beginJointRead(raw), /invalid_input/); assert.equal(calls, 0); assert.equal(b.describe().active_workspace_bytes, "0");
});
for (const [n, mode] of [[1309, "pending_ack"], [1310, "pending_no_ack"]])
  test(`C-B joint transport ${mode} consumes only the original cancellation/settlement`, async (t) => {
    const c = configuration(n), b = registry.createSyntheticJointCheckpointOracleBootstrap(c.binding, publicKey(), c.envelope);
    const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, mode); t.after(() => { owner.settlePending(); owner.close(); b.close(); });
    const claim = registry.claimSyntheticJointCheckpointReader(b.readerEnrollment), lease = claim.acquire(4n * 4096n, 16777216n, () => {});
    t.after(() => lease.release());
    const query_id = `00000000-0000-4000-8000-${n}00000001`, challenge = `00000000-0000-4000-8000-${n}00000002`;
    claim.identifier(query_id, 16777216n); claim.identifier(challenge, 16777216n);
    const { public_key_spki_sha256: _, ...pins } = c.binding.registration.pins;
    const op = claim.dispatch({ schema: "native-bar-checkpoint-probe-request-v1", scope: "synthetic_checkpoint_probe_only", ...pins,
      query_id, challenge, phase: "c0", registration_hash: c.binding.registration_hash, authority_reference: c.binding.registration.authority_reference });
    const rejected = assert.rejects(op.promise, /oracle_cancelled|oracle_rejected/); op.cancel(); op.retire();
    assert.equal(op.retired(), mode === "pending_ack"); owner.settlePending(); await rejected; op.retire(); assert.equal(op.retired(), true);
  });
for (const [scenario, platform] of [["native_refusal"], ["native_refusal", "linux"], ["native_refusal", "win32"], ["rng_failure"], ["rng_pin"], ["rng_invalid"],
  ["clock_expired"], ["clock_rollback"], ["clock_throw"], ["budget"], ["invalid_options"]])
  test(`C-B ${scenario}${platform ? ` on ${platform}` : ""} is a memory-only refusal with no addon loaded`, async () => {
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./helpers/jointReaderRefusal.mjs", import.meta.url), {
        workerData: { scenario, platform, configuration: configuration(1500), base: new URL(base, import.meta.url).href } });
      worker.once("message", resolve); worker.once("error", reject);
      worker.once("exit", (code) => { if (code) reject(new Error(`worker_exit_${code}`)); });
    });
    assert.deepEqual(result, { ok: true, scenario });
  });

// C-B independent review corrections (2026-10-27). Source functions are extracted and run in this realm with the real built
// dependencies and a supplied native-shaped report or value only; no native backend, snapshot or success result exists.
const source = readFileSync(new URL("../../src/nativeBarAdmissionJointReader.ts", import.meta.url), "utf8");
const evidence = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
const readContracts = await import(new URL(`${base}nativeBarAdmissionReadContracts.js`, import.meta.url));
const jointContracts = await import(new URL(`${base}nativeBarAdmissionJointReadContracts.js`, import.meta.url));
const checkpointContracts = await import(new URL(`${base}nativeBarAdmissionCheckpointContracts.js`, import.meta.url));
function extract(names, deps = {}) {
  const parts = []; (function visit(n) {
    if (ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) parts.push(n.getText());
    else if (ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => names.includes(d.name.getText()))) parts.push(n.getText());
    ts.forEachChild(n, visit);
  })(ts.createSourceFile("joint.ts", source, ts.ScriptTarget.Latest, true));
  const js = ts.transpileModule(parts.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return vm.runInThisContext(`(function (${Object.keys(deps).join(", ")}) {\n${js}\nreturn { ${names.map((n) => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(", ")} };\n})`)(...Object.values(deps));
}
const reportDeps = { z, nativeBarHash: evidence.nativeBarHash, nativeBarTimestamp: evidence.nativeBarTimestamp, checkpointProbeParse: checkpointContracts.checkpointProbeParse,
  classifySyntheticAdmissionReadEntry: readContracts.classifySyntheticAdmissionReadEntry, checkSyntheticAdmissionJointWorkUsage: jointContracts.checkSyntheticAdmissionJointWorkUsage, work() {} };
function nativeShapedInventory(c) {
  // Entry order and fields follow acollect/aentry: chain directories, both roots, both markers, then the data and witness scans.
  const r = c.binding.registration, proof = (size, mode = "33152", nlink = "1") => ({ device: "1", inode: String(9000 + size), uid: "501", gid: "20", mode, flags: "0",
    size: String(size), nlink, birthtime_ns: "1", mtime_ns: "1", ctime_ns: "1", acl: "none", acl_hash: null, allocated_bytes: "4096" });
  const structural = (path, i) => ({ root_role: "fixture", path, kind: "directory", proof: proof(96 + i, "16832", "3"), role: "directory",
    namespace_qualified: true, access_qualified: true, readable_evidence: false, raw_byte_limit: "0" });
  const entries = [...r.bindings.ancestors.map((_, i) => structural(`ancestor-${i}`, i)), structural("fixture-parent", 7), structural("store", 8), structural("admission-witness", 9),
    ...[[".native-bar-fs-synthetic", r.bindings.markers.base.size], [".native-bar-admission-synthetic", r.bindings.markers.admission.size]].map(([path, size]) => ({
      root_role: "fixture", path, kind: "file", proof: proof(Number(size)), role: "control", namespace_qualified: true, access_qualified: true, readable_evidence: false, raw_byte_limit: "0" })),
    { root_role: "data", path: "policy.json", kind: "file", proof: proof(54), role: "control", namespace_qualified: true, access_qualified: true, readable_evidence: true, raw_byte_limit: "4096" },
    { root_role: "witness", path: "1.json", kind: "file", proof: proof(300), role: "witness_record", namespace_qualified: true, access_qualified: true, readable_evidence: true, raw_byte_limit: "16384" },
  ].map((e, index) => ({ index, ...e }));
  return { scope: "synthetic_fixture_only", execution_available: false, recovery_execution_available: false, admission_verified: false, approval_authenticated: false,
    view_verified: false, fixture_signature_verified: false, checkpoint_pair_verified: false, logical_prefix_verified: false, authority_state_verified: false,
    original_intake_verified: false, committed_history_available: false, elapsed_clock_qualified: false, physical_capacity_verified: false, native_snapshot_verified: false,
    original_acknowledgement: "not_proven", storage_visibility_at_as_of: "not_proven", schema: "native-bar-native-admission-inventory-v6", entries,
    joint_generation: evidenceHash("invented generation"), inventory_complete: true, namespace_qualified: true, access_qualified: true,
    inventory_bytes: String(entries.reduce((n, e) => n + Number(e.proof.size), 0)),
    metadata_bytes: String(entries.filter((e) => ["control", "witness_record"].includes(e.role)).reduce((n, e) => n + Number(e.proof.size), 0)),
    read_bytes: "4096", live_fds: "12", live_sessions: "1", context_started_at: "2026-10-27T13:00:00.001Z", observed_at: "2026-10-27T13:00:00.002Z", pending_candidates: "0" };
}
function reportCheck(c) {
  const { nativeReport } = extract(["refuse", "uint", "proofSchema", "entrySchema", "nativeFlags", "reportSchema", "nativeReport"], { ...reportDeps, b: { binding: c.binding, envelope: c.envelope } });
  const q = () => ({ start: { utc_at: "2026-10-27T13:00:00.000Z" }, last: { utc_at: "2026-10-27T13:00:00.003Z" }, plan: { native_limits: { response_bytes: "8388608", read_bytes: "268435456" } } });
  return (report) => nativeReport(q(), report, false);
}
test("C-B accepts the native-shaped fixture markers it never reads as evidence (failed before the fix)", () => {
  const c = configuration(1600), check = reportCheck(c), report = nativeShapedInventory(c), at = (r, path) => r.entries.find((e) => e.path === path);
  assert.equal(check(report).entries.length, report.entries.length);
  for (const change of [(r) => { at(r, ".native-bar-fs-synthetic").raw_byte_limit = "4096"; }, (r) => { at(r, ".native-bar-admission-synthetic").readable_evidence = true; },
    (r) => { at(r, "store").raw_byte_limit = "4096"; }, (r) => { at(r, "ancestor-0").readable_evidence = true; },
    (r) => { at(r, "1.json").raw_byte_limit = "0"; }, (r) => { at(r, "1.json").readable_evidence = false; }, (r) => { at(r, "policy.json").raw_byte_limit = "0"; }]) {
    const changed = structuredClone(report); change(changed); assert.throws(() => check(changed), /b3cb_native_entry/);
  }
});
test("C-B names pending stages, coordination and over-envelope inventory separately (failed before the fix)", () => {
  const c = configuration(1601), check = reportCheck(c), add = (entry) => { const r = nativeShapedInventory(c);
    r.entries.push({ index: r.entries.length, kind: "file", namespace_qualified: true, access_qualified: true, ...entry });
    r.inventory_bytes = String(BigInt(r.inventory_bytes) + BigInt(entry.proof.size)); if (entry.metadata) r.metadata_bytes = String(BigInt(r.metadata_bytes) + BigInt(entry.proof.size));
    delete r.entries.at(-1).metadata; return r; };
  const sample = nativeShapedInventory(c).entries.find((e) => e.path === "1.json").proof, proof = (size) => ({ ...sample, size: String(size) });
  assert.throws(() => check(add({ root_role: "data", path: `.producer-${id(1601)}.tmp`, proof: proof(10), role: "pending", readable_evidence: false, raw_byte_limit: "1048576", metadata: true })), /b3cb_publication_pending$/);
  assert.throws(() => check(add({ root_role: "data", path: ".writer.lock", proof: proof(10), role: "coordination", readable_evidence: true, raw_byte_limit: "65536", metadata: true })), /b3cb_coordination_active$/);
  assert.throws(() => check(add({ root_role: "data", path: "notes.txt", proof: proof(10), role: "ordinary_side", readable_evidence: false, raw_byte_limit: "0" })), /b3cb_work_envelope$/);
});
test("C-B keeps native, deadline, oracle and envelope refusals distinguishable from caller input (failed before the fix)", () => {
  const { coded } = extract(["nativeCode", "nativeClass", "coded"]), name = (message) => coded(new Error(message));
  for (const [message, expected] of [["admission_inventory_changed", "b3cb_native_changed"], ["admission_inventory_changed:2", "b3cb_native_changed"],
    ["admission_read_changed", "b3cb_native_changed"], ["admission_deadline", "b3cb_deadline"], ["session_expired", "b3cb_deadline"],
    ["b2b_deadline_or_rollback", "b3cb_native_deadline_or_rollback"], ["admission_deadline_or_rollback", "b3cb_native_deadline_or_rollback"],
    ["admission_busy", "b3cb_native_busy"], ["admission_root_lease_limit", "b3cb_native_busy"], ["native_session_limit", "b3cb_native_busy"],
    ["admission_read_limit", "b3cb_native_budget"], ["acl_entry_limit", "b3cb_native_budget"], ["admission_readdir:13", "b3cb_native_refused"],
    ["admission_temp_anchor_refused", "b3cb_native_refused"], ["b2b_native_unavailable", "b3cb_native_unavailable"], ["b2b_native_protocol", "b3cb_native_unavailable"],
    ["b2a_invalid_input", "b3cb_native_refused"], ["b3ba_oracle_rejected", "b3cb_oracle_rejected"], ["b3ba_oracle_cancelled", "b3cb_oracle_cancelled"],
    ["b3ba_response_bytes", "b3cb_response_bytes"], ["b3ba_state_budget", "b3cb_state_budget"], ["b3ca_witness_bound", "b3cb_work_envelope"],
    ["b3ca_witness_prefix", "b3cb_witness_prefix"], ["b3cb_changing", "b3cb_changing"], ["admission_inventory_changed\n", "b3cb_invalid_input"],
    ["private /path detail", "b3cb_invalid_input"]]) assert.equal(name(message), expected, message);
  assert.equal(coded(new TypeError("x")), "b3cb_invalid_input"); assert.equal(coded("admission_busy"), "b3cb_invalid_input");
});
test("C-B copies captured bytes without listing one key per byte (failed before the fix)", () => {
  const { capture } = extract(["refuse", "typed", "capture"]), bytes = Buffer.from("invented bytes"); bytes.extra = true; bytes[Symbol("tag")] = 1;
  const copy = capture(bytes, 64); assert.deepEqual(copy, Buffer.from("invented bytes")); assert.equal(Object.hasOwn(copy, "extra"), false);
  assert.throws(() => capture(new Uint16Array(4), 64), /b3cb_response_bytes/); assert.throws(() => capture(bytes, 4), /b3cb_response_bytes/);
});
test("C-B the deadline timer can never fire before the original TTL (failed before the fix)", () => {
  const begin = (function find(n) { return ts.isMethodDeclaration(n) && n.name.getText() === "beginJointRead" ? n : ts.forEachChild(n, find); })(ts.createSourceFile("joint.ts", source, ts.ScriptTarget.Latest, true));
  const timer = (function find(n) { return ts.isCallExpression(n) && n.expression.getText() === "setTimeout" ? n : ts.forEachChild(n, find); })(begin);
  const delayName = timer.arguments[1].expression.getText(), delay = extract(["refuse", delayName], { work() {} })[delayName];
  for (const [ttl, elapsedNs] of [[7, 3200000n], [7, 100n], [7, 5999999n], [50, 49500000n], [600000, 1n], [600000, 599998999999n]]) {
    const at = "2026-10-27T13:00:00.000Z", d = delay({ ttl, start: { utc_at: at, monotonic_before_ns: "1000" }, last: { utc_at: at, monotonic_after_ns: String(1000n + elapsedNs) } });
    // A millisecond-granularity timer may fire just after (d - 1) ms; that earliest firing must already be at or past the TTL.
    assert.ok(d >= 1 && elapsedNs + BigInt(d - 1) * 1000000n >= BigInt(ttl) * 1000000n, `${ttl} ${elapsedNs} ${d}`);
  }
});
test("C-B a lower shared cap held by a probe refuses the joint begin with a coded error (failed before the fix)", (t) => {
  const c = configuration(1602), b = joint.createSyntheticAdmissionJointBootstrap(c.binding, publicKey(), c.envelope);
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, "unavailable"), s = joint.enrollSyntheticAdmissionJointReader(b.jointReaderEnrollment);
  const probe = registry.createSyntheticCheckpointOracleBootstrap(binding(1603), publicKey()), probeOwner = enrollUnsignedCheckpointOracle(probe.ownerEnrollment, "unavailable");
  const probeSession = enrollSyntheticCheckpointProbe(probe.readerEnrollment);
  t.after(() => { probeSession.close(); probeOwner.close(); probe.close(); s.close(); owner.close(); b.close(); });
  const plan = checkpointContracts.planCheckpointProbeBudget({ binding: binding(1603), retained_state_bytes: probe.describe().retained_state_bytes });
  const pq = probeSession.beginProbe({ lower_limits: { metadata_bytes: Number(plan.used.metadata_bytes) } }), before = b.describe();
  assert.throws(() => s.beginJointRead(), /^Error: b3cb_state_budget$/); assert.deepEqual(b.describe(), before);
  probeSession.cancel(pq);
});
test("C-B observed record IDs may repeat the registration's pins but never its authority_reference or issued IDs (failed before the fix)", async (t) => {
  const c = configuration(1604), b = registry.createSyntheticJointCheckpointOracleBootstrap(c.binding, publicKey(), c.envelope);
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, "unsigned"); t.after(() => { owner.close(); b.close(); });
  const other = registry.createSyntheticCheckpointOracleBootstrap(binding(1605), publicKey()); t.after(() => other.close());
  const claim = registry.claimSyntheticJointCheckpointReader(b.readerEnrollment), lease = claim.acquire(8n * 4096n, 16777216n, () => {}); t.after(() => lease.release());
  const query_id = "00000000-0000-4000-8000-000016040001", challenge = "00000000-0000-4000-8000-000016040002", r = c.binding.registration;
  claim.identifier(query_id, 16777216n); claim.identifier(challenge, 16777216n);
  const { public_key_spki_sha256: _, ...pins } = r.pins;
  const op = claim.dispatch({ schema: "native-bar-checkpoint-probe-request-v1", scope: "synthetic_checkpoint_probe_only", ...pins,
    query_id, challenge, phase: "c0", registration_hash: c.binding.registration_hash, authority_reference: r.authority_reference });
  await op.promise; op.retire();
  const before = claim.accounting(); claim.bindRecordIds([r.pins.fixture_id, r.pins.authority_id], 16777216n); assert.deepEqual(claim.accounting(), before);
  for (const alias of [r.authority_reference, challenge, binding(1605).registration.pins.store_id])
    assert.throws(() => claim.bindRecordIds([alias], 16777216n), /identity_reuse/, alias);
  assert.deepEqual(claim.accounting(), before);
});
test("C-B main-thread tests never attempted a native addon load", () => {
  assert.equal(process.dlopen, nativeTrap); assert.deepEqual(nativeLoads, []);
});
