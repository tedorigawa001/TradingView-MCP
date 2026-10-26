import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { binding, publicKey } from "./helpers/checkpointProbeFixture.mjs";
import { enrollFixedMemoryCheckpointOracle } from "../helpers/fixedMemoryCheckpointOracle.mjs";

const base = process.env.NATIVE_BAR_B3BB_ISOLATED_TEST === "1" ? "../../build/b3bb-validation/" : "../../build/";
const registry = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
const probe = await import(new URL(`${base}nativeBarAdmissionCheckpointProbe.js`, import.meta.url));
const { evidenceHash } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
function setup(t, n, options) {
  const b = binding(n), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  const owner = enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash }, options);
  const session = probe.enrollSyntheticCheckpointProbe(bootstrap.readerEnrollment);
  t.after(() => { owner.close(); session.close(); bootstrap.close(); }); return { b, bootstrap, owner, session };
}
async function readFixture(session) {
  const q = session.beginProbe(); await assert.rejects(session.requestStart(q), /probe_completion_unavailable/); return session.describe(q);
}
test("B3-Bb signs one checkpoint with the fixed memory oracle, but cannot complete a probe", async (t) => {
  const b = binding(600), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  const owner = enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash });
  const session = probe.enrollSyntheticCheckpointProbe(bootstrap.readerEnrollment);
  t.after(() => { session.close(); owner.close(); bootstrap.close(); });
  const q = session.beginProbe(); await assert.rejects(session.requestStart(q), /b3ba_probe_completion_unavailable/);
  assert.equal(owner.describe().signed_requests, "1"); assert.equal(owner.describe().sequence, "1");
  assert.equal(session.describe(q).state, "released"); assert.equal(session.describe(q).checkpoint_requests_verified, false);
});
test("B3-Bb owner state advances independently between explicit queries", async (t) => {
  const { owner, session } = setup(t, 601); await readFixture(session);
  const next = { sequence: "2", tip_hash: evidenceHash("invented next tip") };
  owner.advance(next); next.sequence = "999";
  await readFixture(session);
  const after = owner.describe(); assert.equal(after.sequence, "2"); assert.equal(after.signed_requests, "2");
  assert.throws(() => owner.advance({ sequence: "2", tip_hash: evidenceHash("another tip") }), /state_not_advanced/);
  assert.deepEqual(owner.describe(), after);
});
test("B3-Bb state loss is terminal and cannot be filled from a previous checkpoint", async (t) => {
  const { owner, session, bootstrap } = setup(t, 602); await readFixture(session);
  owner.loseState(); assert.equal(owner.describe().state_known, false); assert.equal(owner.describe().tip_hash, null);
  assert.throws(() => session.beginProbe(), /oracle_unavailable/);
  assert.throws(() => owner.advance({ sequence: "2", tip_hash: evidenceHash("attempted restore") }), /oracle_unavailable/);
  assert.throws(() => enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "2", tip_hash: evidenceHash("attempted restore") }), /oracle_unavailable/);
});
test("B3-Bb cancellation of held signing work waits for original-owner acknowledgement", async (t) => {
  const { owner, session } = setup(t, 603, { mode: "hold" }), q = session.beginProbe();
  const observed = session.requestStart(q).then(() => null, (error) => error);
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(owner.describe().pending_request, true);
  const stopped = session.cancel(q); assert.equal(stopped.state, "release_unconfirmed");
  assert.match((await observed).message, /cancelled/); assert.equal(owner.describe().signed_requests, "0");
  owner.completePending(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.release(q).state, "released"); assert.equal(owner.describe().signed_requests, "0");
});
for (const [i, mode] of ["wrong_pin", "wrong_challenge", "outside_bracket", "bad_signature"].entries())
  test(`B3-Bb fixed signed fault ${mode} is rejected by B-1`, async (t) => {
    const { session, owner } = setup(t, 610 + i, { mode }), q = session.beginProbe();
    await assert.rejects(session.requestStart(q), /checkpoint_refused/);
    assert.equal(owner.describe().signed_requests, "1"); assert.equal(session.describe(q).state, "released");
  });
test("B3-Bb a state change cancels a held request without signing its old state", async (t) => {
  const { owner, session } = setup(t, 620, { mode: "hold" }), q = session.beginProbe();
  const stopped = session.requestStart(q).then(() => null, (error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  owner.advance({ sequence: "2", tip_hash: evidenceHash("new independent tip") });
  assert.match((await stopped).message, /oracle_changed/); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.release(q).state, "released"); assert.equal(owner.describe().signed_requests, "0");
  owner.setMode("normal"); await readFixture(session); assert.equal(owner.describe().sequence, "2");
});
test("B3-Bb replay is an old response, not a newly authenticated checkpoint", async (t) => {
  const { owner, session } = setup(t, 621); await readFixture(session);
  owner.setMode("replay_previous");
  const q = session.beginProbe(); await assert.rejects(session.requestStart(q), /checkpoint_refused/);
  assert.equal(owner.describe().signed_requests, "1"); assert.equal(session.describe(q).checkpoint_pair_verified, false);
});
test("B3-Bb replay without a previous response is unavailable, not synthesized", async (t) => {
  const { owner, session } = setup(t, 622, { mode: "replay_previous" }), q = session.beginProbe();
  await assert.rejects(session.requestStart(q), /oracle_unavailable/); assert.equal(owner.describe().signed_requests, "0");
});
test("B3-Bb immediate cancellation is acknowledged before signing", async (t) => {
  const { owner, session } = setup(t, 623), q = session.beginProbe(), stopped = assert.rejects(session.requestStart(q), /cancelled/);
  session.cancel(q); await stopped; await new Promise((resolve) => setImmediate(resolve));
  assert.equal(owner.describe().signed_requests, "0"); assert.equal(session.release(q).state, "released");
});
for (const [i, source] of ["owner", "session", "bootstrap"].entries()) test(`B3-Bb ${source} close during a held request cannot revive it`, async (t) => {
  const s = setup(t, 630 + i, { mode: "hold" }), q = s.session.beginProbe(), stopped = s.session.requestStart(q).then(() => null, (error) => error);
  await new Promise((resolve) => setImmediate(resolve)); s[source].close();
  assert.match((await stopped).message, /oracle_unavailable/); s.owner.completePending();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.session.release(q).state, "released"); assert.equal(s.owner.describe().state_known, false); assert.equal(s.owner.describe().signed_requests, "0");
});
test("B3-Bb signed-helper enrollment has an explicit bounded shared-account charge", (t) => {
  const b = binding(640), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  const before = BigInt(bootstrap.describe().retained_state_bytes);
  const owner = enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash });
  t.after(() => { owner.close(); bootstrap.close(); });
  assert.equal(BigInt(bootstrap.describe().retained_state_bytes) - before, 65536n);
  assert.throws(() => enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash }), /consumed/);
});
for (const [i, change] of [
  (s) => { s.sequence = "0"; }, (s) => { s.sequence = "01"; }, (s) => { s.tip_hash = "not-a-hash"; },
  (s) => { s.tip_hash = evidenceHash("not the enrollment"); }, (s) => { s.body = "caller signing body"; },
  (s) => { s.observed_at = "2026-10-26T00:00:00.000Z"; },
].entries()) test(`B3-Bb refuses unsafe initial state ${i} and consumes its failed owner enrollment`, () => {
  const b = binding(650 + i), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  const state = { sequence: "1", tip_hash: b.registration.pins.enrollment_hash }; change(state);
  assert.throws(() => enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, state), /b3b[ab]_/);
  assert.equal(bootstrap.describe().revoked, true); assert.throws(() => probe.enrollSyntheticCheckpointProbe(bootstrap.readerEnrollment), /oracle_unavailable/);
});
test("B3-Bb no caller key, body, signer, path or clock is accepted", () => {
  for (const [i, options] of [{ private_key: "not accepted" }, { signer: () => 1 }, { body: {} }, { path: "/not/opened" }, { clock: 1 }].entries()) {
    const b = binding(660 + i), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
    assert.throws(() => enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash }, options), /b3ba_/);
    assert.equal(bootstrap.describe().revoked, true);
  }
});
test("B3-Bb owner reports are detached, redacted and never an enrollment capability", (t) => {
  const { owner } = setup(t, 670), original = owner.describe(), report = owner.describe();
  report.sequence = "999"; report.authority_state_verified = true; assert.deepEqual(owner.describe(), original);
  assert.doesNotMatch(JSON.stringify(original), /signature_hex|private_key|\/.+|9d61b19d/);
  assert.throws(() => enrollFixedMemoryCheckpointOracle(report, { sequence: "2", tip_hash: evidenceHash("fake") }), /owner_grant/);
});
test("B3-Bb cannot alter fault behavior during an active query or use a client-selected tip", (t) => {
  const { owner, session } = setup(t, 671), before = owner.describe();
  assert.throws(() => session.beginProbe({ sequence: "9", tip_hash: evidenceHash("client-selected") }), /invalid_input/);
  assert.deepEqual(owner.describe(), before);
  const q = session.beginProbe(); assert.throws(() => owner.setMode("bad_signature"), /owner_busy/); session.cancel(q);
  assert.deepEqual(owner.describe(), before);
});
test("B3-Bb held work can sign only when explicitly completed inside its original window", async (t) => {
  const { owner, session } = setup(t, 680, { mode: "hold" }), q = session.beginProbe();
  const stopped = assert.rejects(session.requestStart(q), /probe_completion_unavailable/);
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(owner.describe().signed_requests, "0");
  assert.equal(owner.completePending(), true); await stopped;
  assert.equal(owner.completePending(), false); assert.equal(owner.describe().signed_requests, "1");
});
test("B3-Bb deadline cancellation retires held work without a late signature", async (t) => {
  const { owner, session } = setup(t, 681, { mode: "hold" }), q = session.beginProbe({ ttl_ms: 30 });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(session.requestStart(q), /deadline|clock_relation_unavailable/);
    assert.equal(session.describe(q).state, "release_unconfirmed"); owner.completePending();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.release(q).state, "released"); assert.equal(owner.describe().signed_requests, "0");
  } finally { clearTimeout(keepAlive); }
});
test("B3-Bb a different enrolled public encoding cannot select a different private signing key", () => {
  const b = binding(682), der = publicKey().export({ type: "spki", format: "der" }); der[der.length - 1] ^= 1;
  const otherPublic = createPublicKey({ key: der, type: "spki", format: "der" });
  b.registration.pins.public_key_spki_sha256 = createHash("sha256").update(der).digest("hex"); b.registration_hash = evidenceHash(b.registration);
  const bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, otherPublic);
  assert.throws(() => enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash }), /public_test_key_required/);
  assert.equal(bootstrap.describe().revoked, true);
});
