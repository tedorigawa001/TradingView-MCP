import { parentPort, workerData } from "node:worker_threads";
import module, { syncBuiltinESMExports } from "node:module";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { publicKey } from "./checkpointProbeFixture.mjs";
import { enrollUnsignedCheckpointOracle } from "../../helpers/unsignedCheckpointOracle.mjs";

// Disposable worker: refuse at the loader itself. No addon, fake native-positive backend, fixture or signer exists.
const { scenario, configuration: c } = workerData;
let attempts = 0, loads = 0, wall = Date.now();
module.createRequire = () => { attempts++; throw Error("invented_loader_unavailable"); };
process.dlopen = () => { loads++; throw Error("addon_must_not_load"); };
Date.now = () => wall;
if (scenario === "rng_failure") crypto.randomUUID = () => { throw Error("invented_rng_detail"); };
if (scenario === "rng_pin") crypto.randomUUID = () => c.binding.registration.pins.fixture_id;
if (scenario === "rng_invalid") crypto.randomUUID = () => "not-an-id";
if (scenario === "clock_throw") Date.now = () => { throw Error("invented_clock_detail"); };
if (scenario === "clock_rollback") crypto.randomUUID = () => { wall--; return "00000000-0000-4000-8000-000009999998"; };
if (scenario === "clock_expired") crypto.randomUUID = () => { wall += 600000; return "00000000-0000-4000-8000-000009999999"; };
syncBuiltinESMExports();
let bootstrap, owner, session;
try {
  const api = await import(new URL("nativeBarAdmissionJointReader.js", workerData.base));
  bootstrap = api.createSyntheticAdmissionJointBootstrap(c.binding, publicKey(), c.envelope);
  owner = enrollUnsignedCheckpointOracle(bootstrap.ownerEnrollment, "unavailable");
  session = api.enrollSyntheticAdmissionJointReader(bootstrap.jointReaderEnrollment);
  if (scenario === "rng_failure") assert.throws(() => session.beginJointRead(), /rng_unavailable/);
  else if (scenario === "rng_pin") assert.throws(() => session.beginJointRead(), /identity_reuse/);
  else if (scenario === "rng_invalid") assert.throws(() => session.beginJointRead(), /rng_invalid/);
  else if (scenario === "clock_throw") assert.throws(() => session.beginJointRead(), /clock_invalid/);
  else if (scenario === "budget") assert.throws(() => session.beginJointRead({ lower_limits: { read_bytes: 1 } }), /budget/);
  else if (scenario === "invalid_options") assert.throws(() => session.beginJointRead({ backend: {} }), /invalid_input/);
  else {
    const q = session.beginJointRead(), d = session.describe(q);
    assert.equal(d.state, "released"); assert.equal(d.failure, scenario === "native_refusal" ? "b3cb_native_unavailable" : scenario === "clock_rollback" ? "b3cb_clock_rollback" : "b3cb_deadline");
    assert.equal(d.requests_dispatched, 0); assert.equal(d.cleanup, "confirmed");
    for (const [k, v] of Object.entries(d)) if (/_verified$|_available$|_qualified$|_authenticated$|_enforced$/.test(k)) assert.equal(v, false, k);
    await assert.rejects(session.run(q), new RegExp(d.failure));
    assert.throws(() => session.describe(structuredClone(q)), /query_handle_required/);
    assert.equal(session.release(q).failure, d.failure);
  }
  assert.equal(attempts, scenario === "native_refusal" ? 1 : 0); assert.equal(loads, 0);
  assert.equal(bootstrap.describe().active_workspace_bytes, "0");
  parentPort.postMessage({ ok: true, scenario });
} catch (error) { parentPort.postMessage({ ok: false, scenario, message: String(error.message) }); }
finally { session?.close(); owner?.close(); bootstrap?.close(); }
