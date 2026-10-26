import test from "node:test";
import assert from "node:assert/strict";
import { binding, publicKey } from "./helpers/checkpointProbeFixture.mjs";
import { enrollUnsignedCheckpointOracle } from "../helpers/unsignedCheckpointOracle.mjs";
const base = process.env.NATIVE_BAR_B3BB_ISOLATED_TEST === "1" ? "../../build/b3bb-validation/" : process.env.NATIVE_BAR_B3BA_ISOLATED_TEST === "1" ? "../../build/b3ba-validation/" : "../../build/";
const api = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
const probe = await import(new URL(`${base}nativeBarAdmissionCheckpointProbe.js`, import.meta.url));
const { evidenceHash } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
let namespace = 200;
test("B3-Ba pins a detached enrollment and refuses replacement even after close", () => {
  const b = binding(), bootstrap = api.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  b.registration.fixture_name = "native-bar-fs-synthetic-ZZ123Z";
  assert.equal(bootstrap.describe().registration_hash, binding().registration_hash);
  assert.equal(bootstrap.describe().native_read_available, false);
  assert.notEqual(bootstrap.readerEnrollment, bootstrap.ownerEnrollment);
  bootstrap.close(); bootstrap.close();
  assert.throws(() => api.createSyntheticCheckpointOracleBootstrap(binding(), publicKey()), /b3ba_duplicate_enrollment/);
});
test("B3-Ba requires original, separate, one-use owner and reader grants", () => {
  const b = api.createSyntheticCheckpointOracleBootstrap(binding(++namespace), publicKey());
  assert.throws(() => probe.enrollSyntheticCheckpointProbe(b.readerEnrollment), /oracle_unavailable/);
  for (const h of [structuredClone(b.ownerEnrollment), b.readerEnrollment, b.describe(), {}]) assert.throws(() => enrollUnsignedCheckpointOracle(h), /owner_grant/);
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment);
  assert.throws(() => enrollUnsignedCheckpointOracle(b.ownerEnrollment), /consumed/);
  for (const h of [structuredClone(b.readerEnrollment), b.ownerEnrollment, {}]) assert.throws(() => probe.enrollSyntheticCheckpointProbe(h), /reader_grant/);
  const s = probe.enrollSyntheticCheckpointProbe(b.readerEnrollment);
  assert.throws(() => probe.enrollSyntheticCheckpointProbe(b.readerEnrollment), /consumed/); s.close(); owner.close(); b.close();
});
test("B3-Ba a failed owner attachment revokes the enrollment rather than allowing replacement", () => {
  const b = api.createSyntheticCheckpointOracleBootstrap(binding(++namespace), publicKey());
  assert.throws(() => enrollUnsignedCheckpointOracle(b.ownerEnrollment, "signed"), /invalid_input/);
  assert.equal(b.describe().revoked, true);
  assert.throws(() => enrollUnsignedCheckpointOracle(b.ownerEnrollment), /oracle_unavailable/);
  assert.throws(() => probe.enrollSyntheticCheckpointProbe(b.readerEnrollment), /oracle_unavailable/); b.close();
});
for (const [name, change] of [
  ["replacement digest", (b) => { b.registration.fixture_name = "native-bar-fs-synthetic-ZZ123Z"; }],
  ["extra provider", (b) => { b.provider = "not accepted"; }],
  ["cycle", (b) => { b.self = b; }], ["sparse", (b) => { b.registration.bindings.ancestors = new Array(1e8); }],
  ["large input", (b) => { b.extra = "x".repeat(131073); }],
  ["unsafe owner", (b) => { b.registration.bindings.data.acl = "allow"; }],
  ["extra key", (b) => { b.key = { private: true }; }],
]) test(`B3-Ba rejects enrollment ${name}`, () => {
  const b = binding(++namespace); change(b); assert.throws(() => api.createSyntheticCheckpointOracleBootstrap(b, publicKey()), /b3ba_/);
});
test("B3-Ba rejects key substitutes and never invokes enrollment accessors", () => {
  assert.throws(() => api.createSyntheticCheckpointOracleBootstrap(binding(++namespace), publicKey().export({ type: "spki", format: "der" })), /public_key/);
  let calls = 0; const b = binding(++namespace); Object.defineProperty(b, "private_path", { enumerable: true, get() { calls++; return "/secret"; } });
  assert.throws(() => api.createSyntheticCheckpointOracleBootstrap(b, publicKey()), (e) => e.message === "b3ba_non_json"); assert.equal(calls, 0);
});
test("B3-Ba aliases cannot enroll a different digest over an existing namespace", () => {
  const input = binding(++namespace), b = api.createSyntheticCheckpointOracleBootstrap(input, publicKey());
  const clone = binding(namespace); clone.registration.fixture_name = "native-bar-fs-synthetic-ZZ123Z";
  clone.registration_hash = evidenceHash(clone.registration);
  assert.throws(() => api.createSyntheticCheckpointOracleBootstrap(clone, publicKey()), /duplicate_enrollment/); b.close();
});
