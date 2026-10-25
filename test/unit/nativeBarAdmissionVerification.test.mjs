import test from "node:test";
import assert from "node:assert/strict";
import { KeyObject, createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import vm from "node:vm";

const base = process.env.NATIVE_BAR_B2B_ISOLATED_TEST === "1" ? "../../build/b2b-validation/" : process.env.NATIVE_BAR_B1_ISOLATED_TEST === "1" ? "../../build/b1-validation/" : "../../build/";
const api = await import(new URL(`${base}nativeBarAdmissionVerification.js`, import.meta.url));
const { canonical, evidenceHash } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = (n) => new Date(Date.parse("2026-10-25T00:00:00.000Z") + 1000 * n).toISOString();
const rawHash = (b) => createHash("sha256").update(b).digest("hex");
// RFC 8032 section 7.1 test 1: public test material, never a production credential or a file.
const publicKey = createPublicKey({ key: Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"), type: "spki", format: "der" });
const privateKey = createPrivateKey({ key: Buffer.from("302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"), type: "pkcs8", format: "der" });
function signed(value, domain, key = privateKey) {
  return { ...value, signature_hex: sign(null, Buffer.from(canonical({ domain, envelope: value })), key).toString("hex") };
}
function resigned(value, domain = "native-bar-eb-signed-record-v1", key = privateKey) {
  const { signature_hex, ...body } = value; return signed(body, domain, key);
}
const bytes = (value) => Buffer.from(canonical(value));
function fixture() {
  const root = (inode) => ({ device: "1", inode, uid: "501", gid: "20", mode: "16832", flags: "0", acl: "none",
    acl_hash: evidenceHash("invented ACL"), birthtime_ns: String(BigInt(Date.parse(time(0))) * 1000000n) });
  const body = { schema: "native-bar-admission-body-v6", type: "enrollment", store_id: id(1), epoch_id: id(2), sequence: "1",
    previous_hash: null, at: time(1), data: { authority_id: id(3), policy_hash: evidenceHash({ schema: "native-bar-synthetic-admission-profile-v6" }),
      capabilities_hash: evidenceHash("invented capabilities"), store_root: root("10"), witness_root: root("11"),
      store_ancestors_hash: evidenceHash("data parents"), witness_ancestors_hash: evidenceHash("witness parents") } };
  const record = { body, signature: { schema: "native-bar-supplied-signature-v1", algorithm: "unqualified-fixture-v1", key_id: id(4),
    body_digest: evidenceHash({ domain: "native-bar-admission-body-v6", body }), signature_hex: "ab".repeat(64) } };
  const pins = { fixture_id: id(5), store_id: id(1), epoch_id: id(2), authority_id: id(3), key_id: id(4),
    enrollment_hash: evidenceHash(record), public_key_spki_sha256: rawHash(publicKey.export({ type: "spki", format: "der" })) };
  const outer = signed({ schema: "native-bar-signed-admission-record-v1", scope: "synthetic_fixture_only", algorithm: "ed25519",
    fixture_id: pins.fixture_id, key_id: pins.key_id, record, record_hash: evidenceHash(record),
    placements: [{ root_role: "witness", path: "1.json" }] }, "native-bar-eb-signed-record-v1");
  return { pins, record, outer, bytes: Buffer.from(canonical(outer)), location: { root_role: "witness", path: "1.json" } };
}
function checkpoint(f, challenge = id(6), observed = 3) {
  const body = { schema: "native-bar-signed-read-checkpoint-v1", scope: "synthetic_fixture_only", algorithm: "ed25519",
    fixture_id: f.pins.fixture_id, store_id: f.pins.store_id, epoch_id: f.pins.epoch_id, authority_id: f.pins.authority_id,
    key_id: f.pins.key_id, enrollment_hash: f.pins.enrollment_hash, challenge, sequence: f.record.body.sequence,
    tip_hash: evidenceHash(f.record), observed_at: time(observed) };
  return { bytes: Buffer.from(canonical(signed(body, "native-bar-eb-read-checkpoint-v1"))),
    request: { challenge, sent_at: time(observed - 1), received_at: time(observed + 1) } };
}
function transcript(f = fixture()) {
  return { records: [{ bytes: f.bytes, location: f.location }], start: checkpoint(f, id(6), 3), end: checkpoint(f, id(7), 8), evaluated_at: time(10) };
}
function producerPrefix(count = 11) {
  const f = fixture(), messages = [f.outer];
  for (let i = 0; i < count; ++i) {
    const sequence = String(i + 2), n = 120 + i * 10, at = 10 + 600 * i, producer_id = id(n), recording_id = id(n + 1);
    const artifacts = ["payload_stage", "payload_final", "receipt_stage", "receipt_final"].map((role, j) => ({ role, artifact_id: id(n + 2 + j),
      path: j % 2 === 0 ? `.producer-${id(n + 2 + j)}.tmp` : `${j === 1 ? "captures" : "receipts"}/${time(at).slice(0, 10)}/${recording_id}.json`,
      from_artifact_id: j % 2 === 0 ? null : id(n + 1 + j) }));
    const body = { schema: "native-bar-admission-body-v6", type: "producer_reserved", store_id: f.pins.store_id, epoch_id: f.pins.epoch_id,
      sequence, previous_hash: evidenceHash(f.record), at: time(at), data: { producer_id, recording_id, owner_incarnation_hash: evidenceHash(n),
        window: { opened_at: time(at), expires_at: time(at + 600) }, partition_at: time(at), payload_hash: evidenceHash("invented payload"),
        payload_bytes: "16", restoration_hash: evidenceHash("restored invented panes"), artifacts, reverify_attempt_ids: [id(n + 6), id(n + 7)] } };
    const record = { body, signature: { ...f.record.signature, body_digest: evidenceHash({ domain: "native-bar-admission-body-v6", body }) } };
    const outer = signed({ ...Object.fromEntries(Object.entries(f.outer).filter(([k]) => k !== "signature_hex")), record, record_hash: evidenceHash(record),
      placements: [{ root_role: "data", path: `producer/${producer_id}/${sequence}.json` }, { root_role: "witness", path: `${sequence}.json` }] }, "native-bar-eb-signed-record-v1");
    messages.push(outer); f.record = record;
  }
  const lastAt = 10 + 600 * (count - 1), q = { records: messages.map((outer) => ({ bytes: bytes(outer), location: outer.placements.at(-1) })),
    start: checkpoint(f, id(6), lastAt + 3), end: checkpoint(f, id(7), lastAt + 8), evaluated_at: time(lastAt + 10) };
  q.records.sort((a, b) => a.location.path.localeCompare(b.location.path)); return { f, q, messages };
}
test("B-1 verifies a pinned-public-key outer signature without authenticating the inner model or native storage", () => {
  const f = fixture(), before = canonical(f), verifier = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey);
  const r = verifier.verifyRecord(f.bytes, f.location);
  assert.equal(r.fixture_signature_verified, true); assert.equal(r.record_hash, evidenceHash(f.record));
  assert.equal(r.encoded_sha256, rawHash(f.bytes)); assert.notEqual(r.encoded_sha256, r.record_hash);
  assert.equal(r.native_snapshot_verified, false); assert.equal(r.admission_verified, false); assert.equal(r.execution_available, false);
  assert.deepEqual(r.record, f.record); assert.equal(canonical(f), before);
});
test("B-1 authenticates a checkpoint only for its exact pinned identities, challenge and supplied UTC request bracket", () => {
  const f = fixture(), c = checkpoint(f), verifier = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey);
  const r = verifier.verifyCheckpoint(c.bytes, c.request);
  assert.equal(r.fixture_signature_verified, true); assert.equal(r.checkpoint.challenge, c.request.challenge);
  assert.equal(r.challenge_generation_verified, false); assert.equal(r.authority_state_verified, false);
  assert.equal(r.execution_available, false);
  assert.throws(() => verifier.verifyCheckpoint(c.bytes, { ...c.request, challenge: id(7) }), /checkpoint_request/);
  assert.throws(() => verifier.verifyCheckpoint(c.bytes, { ...c.request, received_at: time(2.5) }), /checkpoint_request/);
});
test("B-1 verifies a complete signed in-memory transcript and projects only internally verified claims into E-A", () => {
  const f = fixture(), q = transcript(f), before = canonical(q), r = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey).verifyTranscript(q);
  assert.equal(r.fixture_signature_verified, true); assert.equal(r.checkpoint_pair_verified, true); assert.equal(r.logical_prefix_verified, true);
  assert.equal(r.model.model_status, "consistent_supplied_model"); assert.equal(r.model.signature_verified, false);
  assert.equal(r.model.checkpoint_authenticated, false); assert.equal(r.native_snapshot_verified, false); assert.equal(r.view_verified, false);
  assert.equal(r.authority_state_verified, false); assert.equal(r.actual_request_timing_verified, false); assert.equal(r.execution_available, false);
  assert.equal(r.model.tip_hash, f.pins.enrollment_hash); assert.equal(canonical(q), before);
});
test("B-1 raw byte views never consult user-added byte-length or serialization accessors", () => {
  const f = fixture(); let called = false;
  Object.defineProperty(f.bytes, "byteLength", { get() { called = true; return 1; } });
  const v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey);
  // The intrinsic length and copy read the actual bytes; the decoration is inert.
  assert.equal(v.verifyRecord(f.bytes, f.location).encoded_sha256, rawHash(Buffer.from(canonical(f.outer)))); assert.equal(called, false);
});
// S + L, the group order: the same signature encoded with an out-of-range scalar.
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
function scalarPlusOrder(signatureHex) {
  const s = BigInt(`0x${Buffer.from(signatureHex.slice(64), "hex").reverse().toString("hex")}`) + L;
  return signatureHex.slice(0, 64) + Buffer.from(s.toString(16).padStart(64, "0"), "hex").reverse().toString("hex");
}
test("B-1 uses the RFC 8032 public vector and rejects a modified or non-canonical signature", () => {
  const hex = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
  const signature = Buffer.from(hex, "hex");
  assert.equal(verify(null, Buffer.alloc(0), publicKey, signature), true);
  assert.equal(verify(null, Buffer.alloc(0), publicKey, Buffer.from(scalarPlusOrder(hex), "hex")), false);
  signature[0] ^= 1; assert.equal(verify(null, Buffer.alloc(0), publicKey, signature), false);
});
test("B-1 refuses small-order and non-canonical public keys whatever the runtime's OpenSSL accepts", () => {
  const f = fixture(); let constructed = 0;
  for (const point of ["01" + "00".repeat(31), "01" + "00".repeat(30) + "80", "ec" + "ff".repeat(30) + "7f", "00".repeat(32), "00".repeat(31) + "80",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a", "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
    "ed" + "ff".repeat(30) + "7f", "ee" + "ff".repeat(30) + "7f"]) {
    const spki = Buffer.from("302a300506032b6570032100" + point, "hex");
    let key; try { key = createPublicKey({ key: spki, format: "der", type: "spki" }); } catch { continue; }
    ++constructed;
    assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier({ ...f.pins, public_key_spki_sha256: rawHash(spki) }, key), /b1_public_key_weak/);
  }
  assert.ok(constructed > 0);
});
test("B-1 pins accept only an actual public Ed25519 KeyObject with its exact SPKI fingerprint", () => {
  const f = fixture(); let exported = false;
  for (const key of [privateKey, publicKey.export({ type: "spki", format: "der" }), { type: "public", asymmetricKeyType: "ed25519", export() { exported = true; } }])
    assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, key), /public_ed25519_key/);
  assert.equal(exported, false);
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier({ ...f.pins, public_key_spki_sha256: "0".repeat(64) }, publicKey), /pin_mismatch/);
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier({ ...f.pins, fixture_id: f.pins.store_id }, publicKey), /role_alias/);
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier({ ...f.pins, embedded_key: "not a trust source" }, publicKey));
});
test("B-1 a genuine different public test key cannot verify a signature from the pinned signer", () => {
  const f = fixture(), other = createPublicKey({ key: Buffer.from("302a300506032b65700321003d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "hex"), format: "der", type: "spki" });
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, other), /pin_mismatch/);
  const v = api.createSyntheticNativeBarAdmissionVerifier({ ...f.pins, public_key_spki_sha256: rawHash(other.export({ format: "der", type: "spki" })) }, other);
  assert.throws(() => v.verifyRecord(f.bytes, f.location), /signature_invalid/);
});
test("B-1 pin capture and returned records cannot be mutated to install a different verifier or grant", () => {
  const f = fixture(), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey);
  f.pins.fixture_id = id(99); const r = v.verifyRecord(f.bytes, f.location); r.record.body.at = time(99);
  assert.equal(v.verifyRecord(f.bytes, f.location).record.body.at, time(1));
  assert.throws(() => v.verifyRecord(r, f.location), /raw_input/);
  assert.equal(Object.isFrozen(v), true);
});
for (const [name, change] of [
  ["fixture substitution", (o) => { o.fixture_id = id(99); }],
  ["outer key substitution", (o) => { o.key_id = id(99); }],
  ["store substitution", (o) => { o.record.body.store_id = id(99); }],
  ["epoch substitution", (o) => { o.record.body.epoch_id = id(99); }],
  ["inner key substitution", (o) => { o.record.signature.key_id = id(99); }],
  ["different logical hash", (o) => { o.record_hash = "0".repeat(64); }],
  ["different body digest", (o) => { o.record.signature.body_digest = "0".repeat(64); }],
  ["unknown outer field", (o) => { o.verifier = "caller-selected"; }],
  ["algorithm negotiation", (o) => { o.algorithm = "ed25519ph"; }],
  ["inner algorithm upgrade", (o) => { o.record.signature.algorithm = "ed25519"; }],
  ["wrong witness slot", (o) => { o.placements[0].path = "2.json"; }],
  ["leading-zero slot", (o) => { o.placements[0].path = "01.json"; }],
  ["path traversal", (o) => { o.placements[0].path = "../1.json"; }],
  ["extra placement", (o) => { o.placements.push(structuredClone(o.placements[0])); }],
  ["mirror for non-producer", (o) => { o.placements.unshift({ root_role: "data", path: "producer/other/1.json" }); }],
]) test(`B-1 refuses signed ${name}`, () => {
  const f = fixture(), outer = structuredClone(f.outer); change(outer);
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey).verifyRecord(bytes(resigned(outer)), f.location));
});
for (const [name, mutate] of [
  ["flipped signature", (o) => { o.signature_hex = (o.signature_hex[0] === "a" ? "b" : "a") + o.signature_hex.slice(1); }],
  ["short signature", (o) => { o.signature_hex = o.signature_hex.slice(2); }],
  ["long signature", (o) => { o.signature_hex += "00"; }],
  ["uppercase signature", (o) => { o.signature_hex = o.signature_hex.toUpperCase(); }],
  ["out-of-range signature scalar", (o) => { o.signature_hex = o.signature_hex.slice(0, 64) + "ff".repeat(32); }],
  ["non-canonical scalar S + L", (o) => { o.signature_hex = scalarPlusOrder(o.signature_hex); }],
  ["invalid signature point", (o) => { o.signature_hex = "ff".repeat(32) + o.signature_hex.slice(64); }],
]) test(`B-1 refuses ${name} without fallback`, () => {
  const f = fixture(), o = structuredClone(f.outer); mutate(o);
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey).verifyRecord(bytes(o), f.location));
});
test("B-1 record/checkpoint domains and unwrapped EA claims are not interchangeable", () => {
  const f = fixture(), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey), c = checkpoint(f);
  assert.throws(() => v.verifyRecord(bytes(resigned(f.outer, "native-bar-eb-read-checkpoint-v1")), f.location), /signature_invalid/);
  assert.throws(() => v.verifyCheckpoint(bytes(resigned(JSON.parse(c.bytes), "native-bar-eb-signed-record-v1")), c.request), /signature_invalid/);
  assert.throws(() => v.verifyRecord(bytes(f.record), f.location)); assert.throws(() => v.verifyRecord(c.bytes, f.location));
  assert.throws(() => v.verifyCheckpoint(f.bytes, c.request));
});
for (const field of ["fixture_id", "store_id", "epoch_id", "authority_id", "key_id", "enrollment_hash"]) test(`B-1 rejects a signed checkpoint with another ${field}`, () => {
  const f = fixture(), c = checkpoint(f), o = JSON.parse(c.bytes); o[field] = field === "enrollment_hash" ? "0".repeat(64) : id(99);
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey).verifyCheckpoint(bytes(resigned(o, "native-bar-eb-read-checkpoint-v1")), c.request), /checkpoint_pin_mismatch/);
});
test("B-1 checkpoint counters are lossless canonical decimals, not rounded JavaScript numbers", () => {
  const f = fixture(), c = checkpoint(f), o = JSON.parse(c.bytes), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey);
  o.sequence = "999999999999999999999999999999";
  assert.equal(v.verifyCheckpoint(bytes(resigned(o, "native-bar-eb-read-checkpoint-v1")), c.request).checkpoint.sequence, o.sequence);
  for (const sequence of ["01", "0", "-1", "1e2", "1".repeat(31), 9007199254740992]) {
    o.sequence = sequence; assert.throws(() => v.verifyCheckpoint(bytes(resigned(o, "native-bar-eb-read-checkpoint-v1")), c.request));
  }
});
test("B-1 supplied request brackets are inclusive but the ten-minute deadline is exclusive", () => {
  const f = fixture(), c = checkpoint(f), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey);
  for (const request of [{ ...c.request, sent_at: time(3), received_at: time(3) }, { ...c.request, sent_at: time(0), received_at: time(599.999) }])
    assert.equal(v.verifyCheckpoint(c.bytes, request).fixture_signature_verified, true);
  for (const request of [{ ...c.request, sent_at: time(0), received_at: time(600) }, { ...c.request, sent_at: time(4), received_at: time(2) },
    { ...c.request, sent_at: time(3.001) }, { ...c.request, received_at: time(2.999) }, { ...c.request, challenge: f.pins.fixture_id },
    { ...c.request, provider: "caller-selected" }]) assert.throws(() => v.verifyCheckpoint(c.bytes, request));
});
for (const [name, mutate] of [
  ["reused challenge", (q) => { const o = JSON.parse(q.end.bytes); o.challenge = q.start.request.challenge; q.end.bytes = bytes(resigned(o, "native-bar-eb-read-checkpoint-v1")); q.end.request.challenge = o.challenge; }],
  ["changed final tip", (q) => { const o = JSON.parse(q.end.bytes); o.tip_hash = "0".repeat(64); q.end.bytes = bytes(resigned(o, "native-bar-eb-read-checkpoint-v1")); }],
  ["duplicate ledger record", (q) => { q.records.push(q.records[0]); }],
  ["missing ledger record", (q) => { q.records = []; }],
  ["overlapping requests", (q) => { q.end.request.sent_at = time(3); }],
  ["backward evaluation clock", (q) => { q.evaluated_at = time(4); }],
  ["old checkpoint with new evaluation label", (q) => { q.evaluated_at = time(610); }],
  ["precomputed valid assertions", (q) => { q.signature_checks = [{ outcome: "valid" }]; }],
  ["another report", (q) => { q.records[0].bytes = { fixture_signature_verified: true }; }],
]) test(`B-1 refuses transcript ${name}`, () => {
  const f = fixture(), q = transcript(f); mutate(q);
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey).verifyTranscript(q));
});
test("B-1 a genuine signed but semantically invalid EA chain cannot become a verified transcript", () => {
  const f = fixture(); f.record.body.previous_hash = "0".repeat(64);
  f.record.signature.body_digest = evidenceHash({ domain: "native-bar-admission-body-v6", body: f.record.body });
  f.outer.record_hash = evidenceHash(f.record); f.pins.enrollment_hash = f.outer.record_hash; f.outer = resigned(f.outer); f.bytes = bytes(f.outer);
  const v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey);
  assert.equal(v.verifyRecord(f.bytes, f.location).fixture_signature_verified, true);
  assert.throws(() => v.verifyTranscript(transcript(f)), /admission_chain_binding/);
});
test("B-1 raw codecs enforce canonical bytes, strict UTF-8 and early byte/depth bounds", () => {
  const f = fixture(), c = checkpoint(f);
  assert.deepEqual(api.decodeNativeBarSignedAdmissionRecord(f.bytes), f.outer);
  assert.equal(api.decodeNativeBarSignedReadCheckpoint(c.bytes).observed_at, time(3));
  for (const raw of [Buffer.concat([f.bytes, Buffer.from("\n")]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f.bytes]), Buffer.from([0xff]),
    Buffer.from(f.bytes.toString().replace('"algorithm":', '"algorithm":"other","algorithm":'))]) assert.throws(() => api.decodeNativeBarSignedAdmissionRecord(raw));
  assert.throws(() => api.decodeNativeBarSignedAdmissionRecord(Buffer.alloc(65537)), /raw_input_bytes/);
  assert.throws(() => api.decodeNativeBarSignedReadCheckpoint(Buffer.alloc(4097)), /raw_input_bytes/);
  assert.throws(() => api.decodeNativeBarSignedAdmissionRecord(Buffer.from("[".repeat(10000) + "0" + "]".repeat(10000))), /depth_or_nodes/);
  assert.throws(() => api.decodeNativeBarSignedAdmissionRecord(f.outer), /raw_input_bytes/);
});
test("B-1 verifies only the exact byte-view slice, rejects shared memory from any realm and ignores decorations", () => {
  const f = fixture(), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey), padded = Buffer.concat([Buffer.from("prefix"), f.bytes, Buffer.from("suffix")]);
  const slice = new Uint8Array(padded.buffer, padded.byteOffset + 6, f.bytes.length);
  assert.equal(v.verifyRecord(slice, f.location).encoded_sha256, rawHash(f.bytes));
  for (const buffer of [new SharedArrayBuffer(f.bytes.length), vm.runInNewContext(`new SharedArrayBuffer(${f.bytes.length})`),
    vm.runInNewContext(`new SharedArrayBuffer(${f.bytes.length}, { maxByteLength: ${2 * f.bytes.length} })`)]) {
    const shared = new Uint8Array(buffer); shared.set(f.bytes); assert.throws(() => v.verifyRecord(shared, f.location), /raw_input_bytes/);
  }
  const decorated = Buffer.from(f.bytes); decorated.extra = "ignored"; assert.equal(v.verifyRecord(decorated, f.location).encoded_sha256, rawHash(f.bytes));
});
test("B-1 malformed bytes, a detached view and a forged key object refuse with coded errors, never parser text", () => {
  const f = fixture();
  assert.throws(() => api.decodeNativeBarSignedAdmissionRecord(Buffer.from("secret-ish text")), (e) => e.message === "b1_malformed_json");
  assert.throws(() => api.decodeNativeBarSignedReadCheckpoint(Buffer.from([0xff])), (e) => e.message === "b1_invalid_utf8");
  const detached = new Uint8Array(f.bytes.length); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.throws(() => api.decodeNativeBarSignedAdmissionRecord(detached), (e) => e.message === "b1_raw_input_bytes");
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, Object.create(KeyObject.prototype)), (e) => e.message === "b1_public_ed25519_key_required");
});
test("B-1 whole-transcript accounting adds pins and request metadata beyond the structural guard", () => {
  const f = fixture(), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey), big = Buffer.alloc(65536);
  const attempt = (last) => {
    const q = transcript(f); q.records = [...Array.from({ length: 255 }, () => ({ bytes: big, location: f.location })), { bytes: Buffer.alloc(last), location: f.location }];
    try { v.verifyTranscript(q); return "verified"; } catch (e) { return e.message; }
  };
  let low = 0, high = 65536;
  assert.notEqual(attempt(low), "b1_input_bytes"); assert.equal(attempt(high), "b1_input_bytes");
  while (high - low > 1) { const mid = (low + high) >> 1; if (attempt(mid) === "b1_input_bytes") high = mid; else low = mid; }
  // Just inside the structural guard, the charged total (pins, locations, requests) is already over the ceiling.
  assert.equal(attempt(low), "b1_transcript_input_bytes");
});
test("B-1 bounds aggregate transcript bytes and counts repeated aliases without deduplication credit", () => {
  const f = fixture(), q = transcript(f), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey), big = Buffer.alloc(65536);
  q.records = Array.from({ length: 512 }, () => ({ bytes: big, location: f.location }));
  assert.throws(() => v.verifyTranscript(q), /input_bytes/);
  q.records = new Array(4294967295); assert.throws(() => v.verifyTranscript(q), /depth_or_nodes/);
});
test("B-1 structured inputs reject accessors and cycles before schema or crypto work", () => {
  const f = fixture(); let called = false;
  Object.defineProperty(f.pins, "request_selected_verifier", { enumerable: true, get() { called = true; return true; } });
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey), /non_json/); assert.equal(called, false);
  const good = fixture(), q = transcript(good); Object.defineProperty(q.records[0], "bytes", { enumerable: true, get() { called = true; return good.bytes; } });
  const v = api.createSyntheticNativeBarAdmissionVerifier(good.pins, publicKey);
  assert.throws(() => v.verifyTranscript(q), /non_json/); assert.equal(called, false);
  const cyclic = transcript(good); cyclic.self = cyclic; assert.throws(() => v.verifyTranscript(cyclic), /non_json/);
});
test("B-1 producer mirrors use exact declared data-then-witness placements and numeric ledger ordering", () => {
  const { f, q, messages } = producerPrefix(), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey);
  assert.deepEqual(q.records.slice(0, 3).map((r) => r.location.path), ["1.json", "10.json", "11.json"]);
  const r = v.verifyTranscript(q); assert.equal(r.model.record_count, 12); assert.equal(r.model.producers.length, 11);
  const producer = messages[1], mirror = v.verifyRecord(bytes(producer), producer.placements[0]);
  assert.equal(mirror.fixture_signature_verified, true); assert.equal(mirror.encoded_sha256, rawHash(bytes(producer)));
  const reversed = { ...producer, placements: [...producer.placements].reverse() };
  assert.throws(() => v.verifyRecord(bytes(resigned(reversed)), producer.placements[0]), /placement/);
  const wrongRole = structuredClone(q); wrongRole.records[0].location = producer.placements[0];
  assert.throws(() => v.verifyTranscript(wrongRole), /witness_required/);
});
test("B-1 an authenticated newer tip refuses a missing, duplicated or rolled-back logical prefix", () => {
  for (const change of [(q) => q.records.pop(), (q) => { q.records[1] = q.records[2]; }, (q) => { q.records = [q.records.find((r) => r.location.path === "1.json")]; }]) {
    const { f, q } = producerPrefix(); change(q);
    assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey).verifyTranscript(q), /transcript_sequence/);
  }
});
test("B-1 challenges cannot alias producer roles even when the checkpoint signature is genuine", () => {
  const { f, q, messages } = producerPrefix(), c = JSON.parse(q.start.bytes); c.challenge = messages[1].record.body.data.producer_id;
  q.start.bytes = bytes(resigned(c, "native-bar-eb-read-checkpoint-v1")); q.start.request.challenge = c.challenge;
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey).verifyTranscript(q), /challenge_role_alias/);
});
test("B-1 a fixture identity cannot also be a signed producer identity", () => {
  const { f, messages } = producerPrefix(1), o = messages[1]; o.record.body.data.producer_id = f.pins.fixture_id;
  o.record.signature.body_digest = evidenceHash({ domain: "native-bar-admission-body-v6", body: o.record.body });
  o.record_hash = evidenceHash(o.record); o.placements[0].path = `producer/${f.pins.fixture_id}/2.json`;
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey).verifyRecord(bytes(resigned(o)), o.placements[1]), /fixture_role_alias/);
});
test("B-1 wrapper-inclusive role size accepts its exact codec boundary and rejects one byte over", () => {
  const f = fixture(), o = structuredClone(f.outer);
  o.record.body.type = "receipt_linked"; o.record.body.sequence = "2";
  o.record.body.data = { producer_id: id(120), receipt_preparation_hash: evidenceHash("preparation"), receipt_publication_hash: evidenceHash("publication"), verification_attempt_hash: null };
  o.record.signature.signature_hex = "ab".repeat(256);
  o.placements = [{ root_role: "data", path: "a".repeat(512) }, { root_role: "witness", path: "a".repeat(512) }];
  let remaining = 4096 - bytes(o).length; assert.ok(remaining > 0 && remaining < 2048);
  for (const placement of o.placements) {
    const chars = [...placement.path];
    for (let i = 0; i < chars.length && remaining; ++i) { const add = Math.min(2, remaining); chars[i] = add === 2 ? "\u96ea" : "\u00e9"; remaining -= add; }
    placement.path = chars.join("");
  }
  assert.equal(remaining, 0); assert.equal(bytes(o).length, 4096); assert.ok(bytes(o.record).length < 4096);
  assert.deepEqual(api.decodeNativeBarSignedAdmissionRecord(bytes(o)), o); // Format only: this is not a valid logical linkage or placement.
  for (const placement of o.placements) {
    const chars = [...placement.path], index = chars.findIndex((c) => c !== "\u96ea");
    if (index < 0) continue; chars[index] = chars[index] === "a" ? "\u00e9" : "\u96ea"; placement.path = chars.join(""); break;
  }
  assert.equal(bytes(o).length, 4097); assert.throws(() => api.decodeNativeBarSignedAdmissionRecord(bytes(o)), /record_bytes/);
});
test("B-1 rejects an actual non-Ed25519 public KeyObject without algorithm fallback", () => {
  // Public P-256 generator point, not generated key material.
  const ec = createPublicKey({ key: Buffer.from("3059301306072a8648ce3d020106082a8648ce3d03010703420004"
    + "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"
    + "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5", "hex"), format: "der", type: "spki" });
  const f = fixture(); f.pins.public_key_spki_sha256 = rawHash(ec.export({ format: "der", type: "spki" }));
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, ec), /public_ed25519_key/);
});
test("B-1 pure verification is repeatable but does not generate, consume or independently authenticate requests", () => {
  const f = fixture(), v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey), q = transcript(f);
  assert.deepEqual(Object.keys(v).sort(), ["verifyCheckpoint", "verifyRecord", "verifyTranscript"]);
  assert.deepEqual(v.verifyTranscript(q), v.verifyTranscript(q));
  q.evaluated_at = time(601.999); assert.equal(v.verifyTranscript(q).logical_prefix_verified, true);
  q.evaluated_at = time(602); assert.throws(() => v.verifyTranscript(q), /transcript_time/);
});
test("B-1 the entire signed prefix must already exist at the first checkpoint observation", () => {
  for (const at of [3, 3.001, 6]) {
    const f = fixture(); f.record.body.at = time(at);
    f.record.signature.body_digest = evidenceHash({ domain: "native-bar-admission-body-v6", body: f.record.body });
    f.outer.record_hash = evidenceHash(f.record); f.pins.enrollment_hash = f.outer.record_hash;
    f.outer = resigned(f.outer); f.bytes = bytes(f.outer);
    const v = api.createSyntheticNativeBarAdmissionVerifier(f.pins, publicKey), q = transcript(f);
    if (at === 3) assert.equal(v.verifyTranscript(q).logical_prefix_verified, true);
    else assert.throws(() => v.verifyTranscript(q), /b1_checkpoint_prefix_clock/);
  }
});
test("B-1 a decorated public key cannot inject an export callback into fingerprint validation", () => {
  const f = fixture(), key = createPublicKey({ key: publicKey.export({ format: "der", type: "spki" }), format: "der", type: "spki" });
  let called = false; Object.defineProperty(key, "export", { get() { called = true; return publicKey.export.bind(publicKey); } });
  assert.throws(() => api.createSyntheticNativeBarAdmissionVerifier(f.pins, key), /public_ed25519_key/); assert.equal(called, false);
});
