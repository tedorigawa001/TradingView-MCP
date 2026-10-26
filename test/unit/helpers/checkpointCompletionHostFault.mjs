import { parentPort, workerData } from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import crypto from "node:crypto";
import process from "node:process";
import assert from "node:assert/strict";
import { binding, publicKey, id } from "./checkpointProbeFixture.mjs";

// Fixed source substitutions stay inside this disposable worker; the runtime accepts no clock/RNG input.
const scenario = workerData.scenario, epoch = Date.parse("2026-10-26T00:00:00.000Z"), b = binding(900);
const original = { wall: Date.now, steady: process.hrtime.bigint, uuid: crypto.randomUUID };
let calls = 0, rng = 0, trigger = Infinity, bootstrap, owner, session;
Date.now = () => { calls++; return calls >= trigger ? epoch + (scenario.includes("rollback") ? -1 : scenario.includes("steady") ? 0 : 1000) : epoch; };
process.hrtime.bigint = () => calls >= trigger && scenario.includes("steady") ? 1000000005n : 5n;
crypto.randomUUID = () => {
  rng++;
  if (scenario === "rng_pin_c1" && rng === 3) return b.registration.authority_reference;
  if (scenario === "rng_reuse_c1") return [id(999981), id(999982), id(999982)][rng - 1];
  return original.uuid();
};
syncBuiltinESMExports();
try {
  const registry = await import(new URL("nativeBarAdmissionOracleRegistry.js", workerData.base));
  const probe = await import(new URL("nativeBarAdmissionCheckpointProbe.js", workerData.base));
  const helper = await import("../../helpers/fixedMemoryCheckpointOracle.mjs");
  bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  owner = helper.enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash });
  session = probe.enrollSyntheticCheckpointProbe(bootstrap.readerEnrollment);
  const q = session.beginProbe({ ttl_ms: 1000 });
  if (scenario === "equal_samples") {
    const c0 = await session.requestStart(q), c1 = await session.requestEnd(q, c0), r = await session.finishProbe(q, c1);
    assert.equal(r.checkpoint_requests_verified, true); assert.equal(r.first_observation.utc_at, r.completed_at);
    assert.notEqual(r.c0.challenge, r.c1.challenge); assert.ok(BigInt(r.event_ordinal) > 10n);
  } else {
    const expected = /rng_/.test(scenario) ? /identity_reuse/ : scenario.includes("rollback") ? /clock_rollback/ : /deadline/;
    let operation;
    if (scenario.startsWith("c0_")) { trigger = calls + (scenario.includes("delivery") ? 4 : scenario.includes("retirement") ? 7 : 6); operation = session.requestStart(q); }
    else {
      const c0 = await session.requestStart(q);
      if (scenario.startsWith("finish_")) {
        const c1 = await session.requestEnd(q, c0); trigger = calls + (scenario.includes("publication") ? 3 : 2); operation = session.finishProbe(q, c1);
      } else { trigger = scenario.startsWith("rng_") ? Infinity : calls + 6; operation = session.requestEnd(q, c0); }
    }
    await assert.rejects(operation, expected);
    const r = session.describe(q); assert.equal(r.checkpoint_requests_verified, false); assert.equal(r.state, "released");
    assert.equal(r.active_workspace_bytes, "0"); assert.match(r.failure, expected);
    if (scenario.startsWith("rng_")) { assert.equal(rng, 3); assert.equal(owner.describe().signed_requests, "1"); }
  }
  parentPort.postMessage({ ok: true, scenario });
} catch (error) { parentPort.postMessage({ ok: false, scenario, message: String(error.message) }); }
finally {
  owner?.close(); session?.close(); bootstrap?.close();
  Date.now = original.wall; process.hrtime.bigint = original.steady; crypto.randomUUID = original.uuid; syncBuiltinESMExports();
}
