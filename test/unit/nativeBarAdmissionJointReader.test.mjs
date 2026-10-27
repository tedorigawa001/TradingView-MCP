import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { binding, publicKey } from "./helpers/checkpointProbeFixture.mjs";
import { enrollUnsignedCheckpointOracle } from "../helpers/unsignedCheckpointOracle.mjs";
import { enrollFixedMemoryCheckpointOracle } from "../helpers/fixedMemoryCheckpointOracle.mjs";

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
for (const scenario of ["native_refusal", "rng_failure", "rng_pin", "rng_invalid", "clock_expired", "clock_rollback", "clock_throw", "budget", "invalid_options"])
  test(`C-B ${scenario} is a memory-only refusal with no addon loaded`, async () => {
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./helpers/jointReaderRefusal.mjs", import.meta.url), {
        workerData: { scenario, configuration: configuration(1500), base: new URL(base, import.meta.url).href } });
      worker.once("message", resolve); worker.once("error", reject);
      worker.once("exit", (code) => { if (code) reject(new Error(`worker_exit_${code}`)); });
    });
    assert.deepEqual(result, { ok: true, scenario });
  });
