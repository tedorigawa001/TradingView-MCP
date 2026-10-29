import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import child from "node:child_process";
import workers from "node:worker_threads";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import tls from "node:tls";
import http2 from "node:http2";
import dns from "node:dns";
import inspector from "node:inspector";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";

const mode = process.env.NATIVE_BAR_B3CC_MODE;
assert.ok(mode === undefined || ["normal", "ubsan"].includes(mode) && !["NATIVE_BAR_B2B_ISOLATED_TEST", "NATIVE_BAR_B3BA_ISOLATED_TEST", "NATIVE_BAR_B3BB_ISOLATED_TEST",
  "NATIVE_BAR_B3BC_ISOLATED_TEST", "NATIVE_BAR_B3CA_ISOLATED_TEST"].some((key) => process.env[key] === "1"), "b3cc_test_mode_refused");
const base = mode !== undefined ? `../../build/b3cc-validation/${mode}/`
  : process.env.NATIVE_BAR_B3BC_ISOLATED_TEST === "1" ? "../../build/b3bc-validation/" : process.env.NATIVE_BAR_B3BB_ISOLATED_TEST === "1" ? "../../build/b3bb-validation/" : "../../build/";
const effects = [], restores = [], blocked = [], privateKeys = new WeakSet(), privatePrototypes = new Set(); let keys = 0, signatures = 0, failNextSignature = false;
function refusePrivateExport() { effects.push("private_export"); throw Error("cc4b1_private_export"); }
// Accessor exports such as fs.ReadStream and fs.Utf8Stream are shadowed, not assigned, so a setter cannot redirect Node's own stream classes.
const replace = (o, k, f) => {
  const d = Object.getOwnPropertyDescriptor(o, k), accessor = d && !("value" in d);
  if (accessor) Object.defineProperty(o, k, { value: f, writable: true, configurable: true, enumerable: d.enumerable }); else o[k] = f;
  restores.push(() => { if (accessor) Object.defineProperty(o, k, d); else if (d) o[k] = d.value; else delete o[k]; });
};
// A constructible recorder: `new Worker()` or `new fs.Utf8Stream()` must reach it instead of failing as a non-constructor before recording.
const block = (o, names) => names.filter((k) => typeof o[k] === "function").forEach((k) => {
  blocked.push([o, k]); replace(o, k, function () { effects.push(k); throw Error("cc4b1_forbidden_effect"); });
});
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]); block(workers, ["Worker"]);
block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"]);
block(net, ["connect", "createConnection", "createServer"]); block(net.Socket.prototype, ["connect"]);
block(http, ["request", "get", "createServer"]); block(https, ["request", "get", "createServer"]); block(http2, ["connect", "createServer", "createSecureServer"]);
block(dgram, ["createSocket"]); block(tls, ["connect", "createServer"]); block(globalThis, ["fetch", "WebSocket", "EventSource"]);
for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter((k) => /^(lookup|resolve|reverse)/.test(k)));
block(inspector, ["open", "Session"]);
block(crypto, ["createSign", "createSecretKey", "generateKey", "generateKeySync", "generateKeyPair", "generateKeyPairSync",
  "privateEncrypt", "privateDecrypt", "publicEncrypt", "publicDecrypt", "diffieHellman", "createDiffieHellman", "createECDH"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "deriveKey", "deriveBits", "encrypt", "decrypt", "wrapKey", "unwrapKey"]);
const realPrivate = crypto.createPrivateKey, realSign = crypto.sign, realExport = crypto.KeyObject.prototype.export;
replace(crypto, "createPrivateKey", (input) => {
  assert.deepEqual(Object.keys(input).sort(), ["format", "key", "type"]); assert.equal(input.type, "pkcs8"); assert.equal(input.format, "der");
  assert.ok(Buffer.isBuffer(input.key));
  assert.equal(input.key.toString("hex"), "302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
  const key = realPrivate(input), prototype = Object.getPrototypeOf(key);
  if (!privatePrototypes.has(prototype)) { replace(prototype, "export", refusePrivateExport); privatePrototypes.add(prototype); }
  privateKeys.add(key); keys++; return key;
});
replace(crypto, "sign", (algorithm, bytes, key) => {
  assert.equal(algorithm, null); assert.ok(Buffer.isBuffer(bytes)); assert.ok(privateKeys.has(key));
  const body = JSON.parse(bytes.toString("utf8")); assert.equal(body.domain, "native-bar-eb-read-checkpoint-v1");
  assert.equal(body.envelope.schema, "native-bar-signed-read-checkpoint-v1"); signatures++;
  if (failNextSignature) { failNextSignature = false; throw Error("cc4b1_injected_sign_failure"); }
  return realSign(algorithm, bytes, key);
});
replace(crypto.KeyObject.prototype, "export", function (...args) {
  if (this.type === "private") return refusePrivateExport();
  return realExport.apply(this, args);
});
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "ftruncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename",
  "chmod", "fchmod", "lchmod", "chown", "fchown", "lchown", "symlink", "link", "utimes", "futimes", "lutimes"];
const streams = ["ReadStream", "FileReadStream", "WriteStream", "FileWriteStream", "Utf8Stream"], scans = ["glob", "statfs", "watch", "mkdtempDisposable"];
block(fs, [...mutations, ...mutations.map((k) => k + "Sync"), "createWriteStream", ...streams, ...scans, ...scans.map((k) => k + "Sync"), "openAsBlob", "watchFile"]);
block(fsp, [...mutations, ...scans]);
const roots = ["../helpers/", "./helpers/", "../../node_modules/"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
const built = fileURLToPath(new URL(base, import.meta.url));
roots.push(...roots.map((p) => fs.realpathSync(p) + sep));
const metadata = ["stat", "lstat", "readdir", "opendir", "access", "readlink", "realpath"];
const readers = [[fs, "open", (a) => a[0]], [fs, "openSync", (a) => a[0]], [fs, "readFile", (a) => a[0]?.flag], [fs, "readFileSync", (a) => a[0]?.flag],
  [fs, "createReadStream", (a) => a[0]?.flags], [fs, "exists", () => undefined], [fs, "existsSync", () => undefined],
  ...metadata.flatMap((k) => [[fs, k, () => undefined], [fs, k + "Sync", () => undefined], [fsp, k, () => undefined]]),
  [fsp, "open", (a) => a[0]], [fsp, "readFile", (a) => a[0]?.flag]];
for (const [o, k, flag] of readers) {
  if (typeof o[k] !== "function") continue; const original = o[k]; replace(o, k, (p, ...args) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(args);
    if ((f === undefined || f === "r" || f === 0) && (roots.some((r) => full.startsWith(r)) || full.startsWith(built) && full.endsWith(".js"))) return original.call(o, p, ...args);
    effects.push(k); throw Error("cc4b1_forbidden_read");
  });
}
syncBuiltinESMExports();
test.after(() => {
  restores.reverse().forEach((f) => f()); syncBuiltinESMExports();
  assert.deepEqual(effects, []);
});
const helper = await import("../helpers/fixedMemoryCheckpointOracle.mjs");
const { enrollUnsignedCheckpointOracle } = await import("../helpers/unsignedCheckpointOracle.mjs");
const { binding, publicKey } = await import("./helpers/checkpointProbeFixture.mjs");
const registry = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
const probe = await import(new URL(`${base}nativeBarAdmissionCheckpointProbe.js`, import.meta.url));
let serial = 9000;
function setup(t, enroll = helper.enrollFixedMemoryCheckpointOracleC0Only) {
  const b = binding(++serial), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  const owner = enroll(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash });
  const session = probe.enrollSyntheticCheckpointProbe(bootstrap.readerEnrollment);
  t.after(() => { session.close(); owner.close(); bootstrap.close(); }); return { b, bootstrap, owner, session };
}
test("4-B1 signs and authenticates one original C0 using only the published memory key", async (t) => {
  assert.equal(typeof helper.enrollFixedMemoryCheckpointOracleC0Only, "function");
  const before = { keys, signatures }, s = setup(t), q = s.session.beginProbe();
  await s.session.requestStart(q);
  assert.equal(keys - before.keys, 1); assert.equal(signatures - before.signatures, 1);
  assert.equal(s.owner.describe().signed_requests, "1"); assert.equal(s.session.describe(q).state, "c0_authenticated");
  assert.equal(s.owner.describe().state_known, true);
  assert.equal(s.owner.describe().replay_available, false); assert.equal(s.owner.describe().c0_attempt_spent, true);
  assert.equal(s.owner.describe().c0_refusal, null); assert.equal(s.owner.describe().signing_available, false); assert.equal(s.owner.describe().mode, null);
  assert.equal(s.owner.describe().execution_available, false); assert.equal(s.session.describe(q).checkpoint_requests_verified, false);
});
test("4-B1 refuses C1 before a second signature and never verifies a checkpoint pair", async (t) => {
  const s = setup(t), q = s.session.beginProbe(), start = await s.session.requestStart(q); const before = signatures;
  // The owner closes right after refusing, so the reader records owner loss; the owner report keeps the refusal reason.
  await assert.rejects(s.session.requestEnd(q, start), /b3ba_oracle_unavailable/); assert.equal(s.session.describe(q).failure, "b3ba_oracle_unavailable");
  assert.equal(signatures, before); assert.equal(s.owner.describe().signed_requests, "1"); assert.equal(s.owner.describe().c0_refusal, "phase");
  assert.equal(s.session.describe(q).requests_dispatched, 2); assert.equal(s.session.describe(q).authenticated_requests, 1);
  assert.equal(s.session.describe(q).checkpoint_pair_verified, false); assert.equal(s.owner.describe().state_known, false);
});
test("4-B1 a second query cannot obtain another C0 signature from the original owner", async (t) => {
  const s = setup(t), q = s.session.beginProbe(); await s.session.requestStart(q); s.session.cancel(q);
  assert.equal(s.session.release(q).state, "released"); const before = signatures;
  const later = s.session.beginProbe(); await assert.rejects(s.session.requestStart(later), /b3ba_oracle_unavailable/);
  assert.equal(signatures, before); assert.equal(s.owner.describe().signed_requests, "1"); assert.equal(s.owner.describe().c0_refusal, "repeat");
  assert.equal(s.session.describe(later).requests_dispatched, 1); assert.equal(s.session.describe(later).authenticated_requests, 0);
});
test("4-B1 original cancellation consumes the attempt without a late signature or replay", async (t) => {
  const s = setup(t), q = s.session.beginProbe(), before = signatures;
  const pending = assert.rejects(s.session.requestStart(q), /cancelled/); s.session.cancel(q); await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signatures, before); assert.equal(s.owner.describe().c0_attempt_spent, true); assert.equal(s.owner.describe().c0_refusal, "cancelled");
  assert.equal(s.owner.describe().replay_available, false); assert.equal(s.owner.describe().state_known, false);
  assert.equal(s.session.release(q).state, "released"); assert.throws(() => s.session.beginProbe(), /oracle_unavailable/);
});
test("4-B1 exposes only close/loss/describe and retains the unchanged owner reservation", (t) => {
  const b = binding(++serial), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey()), before = BigInt(bootstrap.describe().retained_state_bytes);
  const owner = helper.enrollFixedMemoryCheckpointOracleC0Only(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash });
  t.after(() => { owner.close(); bootstrap.close(); });
  assert.deepEqual(Object.keys(owner).sort(), ["close", "describe", "loseState"]); assert.equal(Object.isFrozen(owner), true);
  assert.equal(BigInt(bootstrap.describe().retained_state_bytes) - before, 65536n);
  assert.equal(owner.describe().profile, "c0_only"); assert.equal(owner.describe().c0_attempt_spent, false);
  assert.equal(owner.describe().replay_available, false); assert.equal(owner.describe().signed_requests, "0");
  assert.equal(owner.describe().mode, null); assert.equal(owner.describe().c0_refusal, null); assert.equal(owner.describe().signing_available, true);
  const count = keys;
  assert.throws(() => helper.enrollFixedMemoryCheckpointOracleC0Only(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash }), /consumed/);
  assert.equal(keys, count);
});
test("4-B1 concrete private-key export tripwire is installed and callable without a key export", (t) => {
  setup(t); assert.ok(privatePrototypes.size > 0);
  for (const prototype of privatePrototypes) {
    assert.equal(Object.getOwnPropertyDescriptor(prototype, "export")?.value, refusePrivateExport);
    const before = effects.length;
    assert.throws(() => prototype["export"].call({}), /cc4b1_private_export/);
    assert.deepEqual(effects.splice(before), ["private_export"]);
  }
});
test("4-B1 enrollment is fixed to the original initial sequence and rejects caller state changes before key creation", () => {
  for (const change of [(v) => { v.sequence = "2"; }, (v) => { v.sequence = "0"; }, (v) => { v.tip_hash = "f".repeat(64); }, (v) => { v.mode = "normal"; }]) {
    const b = binding(++serial), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey()), before = keys;
    const state = { sequence: "1", tip_hash: b.registration.pins.enrollment_hash }; change(state);
    try {
      assert.throws(() => helper.enrollFixedMemoryCheckpointOracleC0Only(bootstrap.ownerEnrollment, state), /b3b[ab]_/);
      assert.equal(keys, before); assert.equal(bootstrap.describe().revoked, true);
    } finally { bootstrap.close(); }
  }
});
test("4-B1 extra arguments cannot enable an old fault mode or reach caller option getters", (t) => {
  const b = binding(++serial), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey()), before = keys; let getters = 0;
  const options = Object.defineProperty({}, "mode", { enumerable: true, get() { getters++; return "replay_previous"; } });
  const initial = { sequence: "1", tip_hash: b.registration.pins.enrollment_hash };
  t.after(() => bootstrap.close());
  assert.throws(() => helper.enrollFixedMemoryCheckpointOracleC0Only(bootstrap.ownerEnrollment, initial, options), /c0_only_arguments/);
  assert.equal(getters, 0); assert.equal(keys, before);
  const owner = helper.enrollFixedMemoryCheckpointOracleC0Only(bootstrap.ownerEnrollment, initial); t.after(() => owner.close());
  assert.equal(owner.describe().profile, "c0_only"); assert.equal(owner.setMode, undefined);
});
test("4-B1 state getters and caller key/body/path/clock inputs are refused before key creation", () => {
  for (const field of ["private_key", "signer", "body", "path", "clock", "observed_at"]) {
    const b = binding(++serial), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey()), before = keys; let getters = 0;
    const state = { sequence: "1", tip_hash: b.registration.pins.enrollment_hash };
    Object.defineProperty(state, field, { enumerable: true, get() { getters++; return "not accepted"; } });
    try {
      assert.throws(() => helper.enrollFixedMemoryCheckpointOracleC0Only(bootstrap.ownerEnrollment, state), /b3ba_/);
      assert.equal(getters, 0); assert.equal(keys, before); assert.equal(bootstrap.describe().revoked, true);
    } finally { bootstrap.close(); }
  }
});
test("4-B1 reports and cloned owner grants cannot reopen a consumed original enrollment", (t) => {
  const s = setup(t), before = keys, initial = { sequence: "1", tip_hash: s.b.registration.pins.enrollment_hash };
  for (const fake of [{}, structuredClone(s.bootstrap.ownerEnrollment), s.owner.describe(), s.bootstrap.describe()])
    assert.throws(() => helper.enrollFixedMemoryCheckpointOracleC0Only(fake, initial), /owner_grant_required/);
  assert.equal(keys, before);
  const original = s.owner.describe(), report = s.owner.describe(); report.c0_attempt_spent = true; report.sequence = "999";
  assert.deepEqual(s.owner.describe(), original); assert.doesNotMatch(JSON.stringify(original), /private_key|signature_hex|9d61b19d/);
});
for (const ending of ["close", "loseState"]) test(`4-B1 ${ending} before a request cannot recreate state or sign later`, (t) => {
  const s = setup(t), before = { keys, signatures }; s.owner[ending](); s.owner[ending]();
  assert.throws(() => s.session.beginProbe(), /oracle_unavailable/);
  assert.throws(() => helper.enrollFixedMemoryCheckpointOracleC0Only(s.bootstrap.ownerEnrollment, { sequence: "1", tip_hash: s.b.registration.pins.enrollment_hash }), /oracle_unavailable/);
  assert.equal(keys, before.keys); assert.equal(signatures, before.signatures); assert.equal(s.owner.describe().state_known, false);
  assert.equal(s.owner.describe().c0_refusal, null); assert.equal(s.owner.describe().signing_available, false);
});
test("4-B1 a signing exception consumes the original attempt and permits no retry", async (t) => {
  const s = setup(t), q = s.session.beginProbe(), before = signatures; failNextSignature = true;
  try { await assert.rejects(s.session.requestStart(q), /oracle_unavailable/); }
  finally { failNextSignature = false; }
  assert.equal(signatures - before, 1); assert.equal(s.owner.describe().signed_requests, "0");
  assert.equal(s.owner.describe().c0_attempt_spent, true); assert.equal(s.owner.describe().state_known, false);
  assert.equal(s.owner.describe().c0_refusal, "delivery_failed");
  assert.throws(() => s.session.beginProbe(), /oracle_unavailable/);
});
test("4-B1 a registry revoked after dispatch refuses C0 before signing even when the reader does not cancel", async (t) => {
  const b = binding(++serial), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  const owner = helper.enrollFixedMemoryCheckpointOracleC0Only(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash });
  t.after(() => { owner.close(); bootstrap.close(); });
  // The internal bridge with a no-op revoke callback models a reader that leaves its request uncancelled on revocation.
  const claim = registry.claimSyntheticCheckpointProbe(bootstrap.readerEnrollment); claim.acquire(65536n, 16777216n, () => {});
  const id = crypto.randomUUID(), challenge = crypto.randomUUID(); claim.identifier(id, 16777216n); claim.identifier(challenge, 16777216n);
  const { public_key_spki_sha256: _fingerprint, ...pins } = claim.binding.registration.pins;
  const op = claim.dispatch({ schema: "native-bar-checkpoint-probe-request-v1", scope: "synthetic_checkpoint_probe_only", ...pins,
    registration_hash: claim.binding.registration_hash, authority_reference: claim.binding.registration.authority_reference, query_id: id, phase: "c0", challenge });
  const before = signatures; bootstrap.close(); assert.equal(bootstrap.describe().revoked, true);
  await assert.rejects(op.promise, /b3ba_oracle_unavailable/);
  assert.equal(signatures, before); assert.equal(owner.describe().signed_requests, "0");
  assert.deepEqual([owner.describe().c0_attempt_spent, owner.describe().c0_refusal, owner.describe().signing_available], [true, "unavailable", false]);
});
test("4-B1 effect tripwires record calls, construction and out-of-scope reads", async () => {
  const outside = fileURLToPath(new URL("../../package.json", import.meta.url)), before = effects.length;
  for (const [o, k] of [[workers, "Worker"], [child, "ChildProcess"], [process, "getBuiltinModule"], [process, "binding"], [process, "loadEnvFile"],
    [fs, "statfsSync"], [fs, "openAsBlob"], [fs, "ReadStream"], [fs, "WriteStream"], [fsp, "statfs"], [dns, "lookup"], [dns.promises, "lookup"],
    [inspector, "Session"], [http2, "connect"], [net.Socket.prototype, "connect"], [globalThis, "fetch"]]) assert.ok(blocked.some(([x, y]) => x === o && y === k), k);
  for (const [o, k] of blocked) { assert.throws(() => o[k](), /cc4b1_forbidden_effect/, k); assert.throws(() => new o[k](), /cc4b1_forbidden_effect/, k); }
  for (const attempt of [() => fs.statSync(outside), () => fs.readFileSync(outside), () => fsp.readFile(outside),
    () => fs.readdirSync(fileURLToPath(new URL("../../", import.meta.url)))]) assert.throws(attempt, /cc4b1_forbidden_read/);
  assert.equal(effects.length, before + 2 * blocked.length + 4); effects.length = before;
});
for (const profile of ["unavailable", "unsigned"]) test(`4-B1 U0 ${profile} creates no private key or signature`, async (t) => {
  const before = { keys, signatures }, s = setup(t, (grant) => enrollUnsignedCheckpointOracle(grant, profile));
  const q = s.session.beginProbe(); await assert.rejects(s.session.requestStart(q), /oracle_unavailable|checkpoint_refused/);
  assert.equal(keys, before.keys); assert.equal(signatures, before.signatures);
});
test("4-B1 the legacy entry retains its separate controls and report shape", async (t) => {
  const s = setup(t, helper.enrollFixedMemoryCheckpointOracle), q = s.session.beginProbe();
  await s.session.requestStart(q); s.session.cancel(q); assert.equal(s.owner.describe().signed_requests, "1");
  assert.equal(typeof s.owner.advance, "function"); assert.equal(typeof s.owner.setMode, "function");
  assert.equal(s.owner.describe().profile, undefined); assert.equal(s.owner.describe().replay_available, true);
  s.owner.advance({ sequence: "2", tip_hash: s.b.registration.pins.enrollment_hash });
  const later = s.session.beginProbe(); await s.session.requestStart(later); assert.equal(s.owner.describe().signed_requests, "2");
});
