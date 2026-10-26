import { parentPort, workerData } from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import crypto from "node:crypto";
import process from "node:process";
import assert from "node:assert/strict";
import { binding, publicKey, id } from "./checkpointProbeFixture.mjs";

// Fixed cases in a disposable test worker, never a clock/provider argument to the application.
const scenario = workerData.scenario, b = binding(500), epoch = Date.parse("2026-10-26T00:00:00.000Z");
const original = { wall: Date.now, tick: process.hrtime.bigint, uuid: crypto.randomUUID };
let wall = epoch, tick = 5n, calls = 0, bootstrap, owner, session;
Date.now = () => { if (scenario === "wall_throw") throw Error("private_wall_detail"); return wall; };
process.hrtime.bigint = () => { if (scenario === "steady_throw") throw Error("private_steady_detail"); return tick; };
crypto.randomUUID = () => {
  calls++;
  if (scenario === "rng_throw") throw Error("private_rng_detail");
  if (scenario === "rng_invalid") return "not-a-uuid";
  if (scenario === "rng_pin") return b.registration.pins.fixture_id;
  if (scenario === "rng_challenge_reuse") return id(999999);
  if (scenario === "rng_old_challenge") return [id(999991), id(999992), id(999993), id(999992)][calls - 1];
  return original.uuid();
};
syncBuiltinESMExports();
try {
  const registry = await import(new URL("nativeBarAdmissionOracleRegistry.js", workerData.base));
  const probe = await import(new URL("nativeBarAdmissionCheckpointProbe.js", workerData.base));
  const helper = await import("../../helpers/unsignedCheckpointOracle.mjs");
  bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  owner = helper.enrollUnsignedCheckpointOracle(bootstrap.ownerEnrollment, scenario === "rollback_at_rejection" ? "pending_no_ack" : "unavailable");
  session = probe.enrollSyntheticCheckpointProbe(bootstrap.readerEnrollment);
  if (scenario === "state_exhaustion") {
    let refused = false;
    for (let n = 2000; n < 4000; n++) {
      try { registry.createSyntheticCheckpointOracleBootstrap(binding(n), publicKey()).close(); }
      catch (error) { assert.equal(error.message, "b3ba_state_budget"); refused = true; break; }
    }
    assert.equal(refused, true); assert.ok(BigInt(bootstrap.describe().retained_state_bytes) <= 16777216n);
    assert.throws(() => registry.createSyntheticCheckpointOracleBootstrap(b, publicKey()), /duplicate_enrollment/);
    assert.throws(() => registry.createSyntheticCheckpointOracleBootstrap(binding(5000), publicKey()), /state_budget/);
  } else if (["rng_throw", "rng_invalid", "rng_pin"].includes(scenario)) {
    assert.throws(() => session.beginProbe(), new RegExp(`b3ba_${{ rng_throw: "rng_unavailable", rng_invalid: "rng_invalid", rng_pin: "identity_reuse" }[scenario]}`));
  } else if (["invalid_wall", "invalid_tick", "wall_throw", "steady_throw"].includes(scenario)) {
    if (scenario === "invalid_wall") wall = NaN; if (scenario === "invalid_tick") tick = 5;
    assert.throws(() => session.beginProbe(), /b3ba_clock_invalid/);
  } else {
    const q = session.beginProbe({ ttl_ms: 1000 });
    let expected = "oracle_unavailable";
    if (scenario === "wall_rollback") { wall--; expected = "clock_rollback"; }
    if (scenario === "steady_rollback") { tick--; expected = "clock_rollback"; }
    if (scenario === "wall_deadline") { wall += 1000; expected = "deadline"; }
    if (scenario === "steady_deadline") { tick += 1000000000n; expected = "deadline"; }
    if (scenario === "rng_challenge_reuse") expected = "identity_reuse";
    const request = session.requestStart(q);
    if (scenario === "rollback_at_rejection") { wall--; owner.settlePending(); expected = "clock_rollback"; }
    await assert.rejects(request, new RegExp(`b3ba_${expected}`));
    const result = session.describe(q);
    assert.equal(result.state, "released"); assert.equal(result.checkpoint_requests_verified, false);
    assert.ok(result.last_observation.utc_at >= result.first_observation.utc_at);
    if (scenario === "rng_old_challenge") {
      const next = session.beginProbe(); await assert.rejects(session.requestStart(next), /identity_reuse/);
      assert.equal(session.describe(next).state, "released");
    }
  }
  assert.equal(bootstrap.describe().active_workspace_bytes, "0");
  parentPort.postMessage({ ok: true, scenario });
} catch (error) { parentPort.postMessage({ ok: false, scenario, message: String(error.message) }); }
finally {
  owner?.settlePending(); session?.close(); owner?.close(); bootstrap?.close();
  Date.now = original.wall; process.hrtime.bigint = original.tick; crypto.randomUUID = original.uuid; syncBuiltinESMExports();
}
