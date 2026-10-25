import { KeyObject, createHash, verify as verifySignature } from "node:crypto";
import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { NATIVE_BAR_ADMISSION_LIMITS, NATIVE_BAR_ADMISSION_RECORD_BYTES, NATIVE_BAR_ADMISSION_PROFILE,
  nativeBarAdmissionRecordSchema, nativeBarAdmissionBodyDigest, replayNativeBarAdmission } from "./nativeBarAdmission.js";

const L = NATIVE_BAR_ADMISSION_LIMITS;
const uuid = nativeBarId.refine((s) => s === s.toLowerCase(), "lower-case identifier required");
const uint = z.string().regex(/^[1-9][0-9]{0,29}$/);
const relative = z.string().min(1).max(512).refine((s) => !s.includes("\\") && !s.includes("\0")
  && s.split("/").every((p) => p && p !== "." && p !== ".."));
const locationSchema = z.strictObject({ root_role: z.enum(["data", "witness"]), path: relative });
const signature = z.string().regex(/^[a-f0-9]{128}$/);
const pinsSchema = z.strictObject({ fixture_id: uuid, store_id: uuid, epoch_id: uuid, authority_id: uuid, key_id: uuid,
  enrollment_hash: nativeBarHash, public_key_spki_sha256: nativeBarHash });
export const nativeBarSignedAdmissionRecordSchema = z.strictObject({ schema: z.literal("native-bar-signed-admission-record-v1"),
  scope: z.literal("synthetic_fixture_only"), algorithm: z.literal("ed25519"), fixture_id: uuid, key_id: uuid,
  record: nativeBarAdmissionRecordSchema, record_hash: nativeBarHash, placements: z.array(locationSchema).min(1).max(2), signature_hex: signature });
export const nativeBarSignedReadCheckpointSchema = z.strictObject({ schema: z.literal("native-bar-signed-read-checkpoint-v1"),
  scope: z.literal("synthetic_fixture_only"), algorithm: z.literal("ed25519"), fixture_id: uuid, store_id: uuid, epoch_id: uuid,
  authority_id: uuid, key_id: uuid, enrollment_hash: nativeBarHash, challenge: uuid, sequence: uint, tip_hash: nativeBarHash,
  observed_at: nativeBarTimestamp, signature_hex: signature });
const requestSchema = z.strictObject({ challenge: uuid, sent_at: nativeBarTimestamp, received_at: nativeBarTimestamp });
const checkpointInput = z.strictObject({ bytes: z.instanceof(Uint8Array), request: requestSchema });
const transcriptSchema = z.strictObject({ records: z.array(z.strictObject({ bytes: z.instanceof(Uint8Array), location: locationSchema })).min(1).max(L.entries),
  start: checkpointInput, end: checkpointInput, evaluated_at: nativeBarTimestamp });
const noAuthority = Object.freeze({ scope: "synthetic_fixture_only" as const, verification_scope: "in_memory_signature_and_model_only" as const,
  native_snapshot_verified: false as const, view_verified: false as const, admission_verified: false as const,
  execution_available: false as const, recovery_execution_available: false as const, approval_authenticated: false as const,
  committed_history_available: false as const, elapsed_clock_qualified: false as const, authority_state_verified: false as const,
  challenge_generation_verified: false as const, actual_request_timing_verified: false as const,
  original_intake_verified: false as const, original_acknowledgement: "not_proven" as const, storage_visibility_at_as_of: "not_proven" as const });
const byteSize = (value: unknown) => Buffer.byteLength(canonical(value));
const rawHash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
// The intrinsic ArrayBuffer getter throws for a SharedArrayBuffer from any realm, unlike instanceof.
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex"), P = 2n ** 255n - 19n;
const littleEndian = (bytes: Uint8Array) => BigInt(`0x${Buffer.from(bytes).reverse().toString("hex")}`);
// y of the eight small-order points, either x sign: identity, order 2, order 4 and both order-8 pairs.
const SMALL_ORDER_Y = new Set([0n, 1n, P - 1n, littleEndian(Buffer.from("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", "hex")),
  littleEndian(Buffer.from("c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a", "hex"))]);
// Some OpenSSL builds accept these keys, and then a constant signature verifies every message.
function weakPublicKey(spki: Buffer) {
  if (spki.length !== 44 || !spki.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) return true;
  const raw = Buffer.from(spki.subarray(12)); raw[31] &= 0x7f; const y = littleEndian(raw);
  return y >= P || SMALL_ORDER_Y.has(y);
}

// These limits precede schema/canonical work, including sparse arrays and inherited serialization methods.
function guard(value: unknown, limit: number, allowBytes = false) {
  let nodes = 0, size = 0; const active = new Set<object>();
  function visit(v: unknown, depth: number) {
    if (++nodes > 262144 || depth > 64) throw new Error("b1_input_depth_or_nodes");
    if (allowBytes && v instanceof Uint8Array) size += rawInput(v, L.record_bytes);
    else if (v === null || typeof v === "boolean") return;
    else if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("b1_non_json"); return; }
    else if (typeof v === "string") size += Buffer.byteLength(v);
    else {
      if (typeof v !== "object" || active.has(v)) throw new Error("b1_non_json");
      const array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error("b1_non_json");
      if (array && v.length > 262144 - nodes) throw new Error("b1_input_depth_or_nodes");
      const keys = Reflect.ownKeys(v);
      if (array && keys.length !== v.length + 1) throw new Error("b1_non_json");
      active.add(v);
      for (const key of keys) {
        if (array && key === "length") continue;
        const d = Object.getOwnPropertyDescriptor(v, key)!;
        if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value")
          || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length))) throw new Error("b1_non_json");
        size += Buffer.byteLength(key); if (size > limit) throw new Error("b1_input_bytes"); visit(d.value, depth + 1);
      }
      active.delete(v);
    }
    if (size > limit) throw new Error("b1_input_bytes");
  }
  visit(value, 0);
  if (!allowBytes && byteSize(value) > limit) throw new Error("b1_input_bytes");
}
// Bytes are read only through intrinsic getters and copy, so own properties on a view are never consulted.
function rawInput(input: unknown, limit: number): number {
  let length: number;
  try { length = typedLength.call(input); arrayBufferLength.call(typedBuffer.call(input)); }
  catch { throw new Error("b1_raw_input_bytes"); }
  if (!(input instanceof Uint8Array) || ![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(input)) || length > limit)
    throw new Error("b1_raw_input_bytes");
  return length;
}
function decode(input: unknown, limit: number) {
  // The intrinsic copy also refuses a detached view.
  const raw = Buffer.alloc(rawInput(input, limit));
  try { Uint8Array.prototype.set.call(raw, input as Uint8Array); } catch { throw new Error("b1_raw_input_bytes"); }
  let depth = 0, nodes = 1, quoted = false, escaped = false, opened = false;
  for (const c of raw) {
    if (quoted) { if (escaped) escaped = false; else if (c === 0x5c) escaped = true; else if (c === 0x22) quoted = false; continue; }
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) continue;
    if (opened && c !== 0x5d && c !== 0x7d) ++nodes;
    opened = false;
    if (c === 0x22) quoted = true;
    else if (c === 0x5b || c === 0x7b) { if (++depth > 65) throw new Error("b1_input_depth_or_nodes"); opened = true; }
    else if (c === 0x5d || c === 0x7d) --depth;
    else if (c === 0x2c) ++nodes;
    if (nodes > 262144) throw new Error("b1_input_depth_or_nodes");
  }
  // Coded refusals: a parser message would quote input bytes into diagnostics.
  let text: string, value: unknown;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { throw new Error("b1_invalid_utf8"); }
  try { value = JSON.parse(text); } catch { throw new Error("b1_malformed_json"); }
  guard(value, limit);
  if (!raw.equals(Buffer.from(canonical(value)))) throw new Error("b1_noncanonical_bytes");
  return { value, raw };
}
function decodeRecord(input: Uint8Array) {
  const decoded = decode(input, L.record_bytes), value = nativeBarSignedAdmissionRecordSchema.parse(decoded.value);
  if (decoded.raw.byteLength > NATIVE_BAR_ADMISSION_RECORD_BYTES[value.record.body.type]) throw new Error("b1_record_bytes");
  return { value, raw: decoded.raw };
}
export function decodeNativeBarSignedAdmissionRecord(input: Uint8Array) {
  return decodeRecord(input).value;
}
export function decodeNativeBarSignedReadCheckpoint(input: Uint8Array) {
  return nativeBarSignedReadCheckpointSchema.parse(decode(input, 4096).value);
}
function placements(record: z.infer<typeof nativeBarAdmissionRecordSchema>) {
  const b = record.body, witness = { root_role: "witness" as const, path: `${b.sequence}.json` };
  if ("producer_id" in b.data) return [{ root_role: "data" as const, path: `producer/${b.data.producer_id}/${b.sequence}.json` }, witness];
  return [witness];
}
function authenticate(value: { signature_hex: string }, domain: string, key: KeyObject) {
  const { signature_hex, ...envelope } = value;
  let valid = false;
  try { valid = verifySignature(null, Buffer.from(canonical({ domain, envelope })), key, Buffer.from(signature_hex, "hex")); }
  catch { throw new Error("b1_signature_verifier_unavailable"); }
  if (!valid) throw new Error("b1_signature_invalid");
}
function recordIds(records: z.infer<typeof nativeBarAdmissionRecordSchema>[]) {
  const ids = new Set<string>();
  function visit(value: unknown) {
    if (typeof value === "string" && nativeBarId.safeParse(value).success) ids.add(value.toLowerCase());
    else if (Array.isArray(value)) for (const v of value) visit(v);
    else if (value && typeof value === "object") for (const v of Object.values(value)) visit(v);
  }
  for (const r of records) visit(r); return ids;
}

/** B-1 only: pins/key are supplied by trusted synthetic test code, not established by this factory. */
export function createSyntheticNativeBarAdmissionVerifier(input: unknown, publicKey: KeyObject) {
  guard(input, L.record_bytes); const pins = Object.freeze(pinsSchema.parse(input));
  if (new Set([pins.fixture_id, pins.store_id, pins.epoch_id, pins.authority_id, pins.key_id]).size !== 5) throw new Error("b1_pin_role_alias");
  let spki: Buffer;
  // A forged KeyObject throws inside the native accessors; every such failure is the same coded refusal.
  try {
    if (!(publicKey instanceof KeyObject) || Reflect.ownKeys(publicKey).some((k) => typeof k === "string"
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(publicKey, k)!, "value"))
      || publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519") throw new Error("b1_public_ed25519_key_required");
    spki = publicKey.export({ type: "spki", format: "der" });
  } catch { throw new Error("b1_public_ed25519_key_required"); }
  if (weakPublicKey(spki)) throw new Error("b1_public_key_weak");
  if (rawHash(spki) !== pins.public_key_spki_sha256) throw new Error("b1_public_key_pin_mismatch");
  return Object.freeze({ verifyRecord, verifyCheckpoint, verifyTranscript });

  function verifyRecord(input: Uint8Array, suppliedLocation: unknown) {
    const { value: outer, raw } = decodeRecord(input), record = outer.record, b = record.body;
    guard(suppliedLocation, 1024); const location = locationSchema.parse(suppliedLocation);
    if (outer.fixture_id !== pins.fixture_id || outer.key_id !== pins.key_id || b.store_id !== pins.store_id
      || b.epoch_id !== pins.epoch_id || record.signature.key_id !== pins.key_id) throw new Error("b1_record_pin_mismatch");
    if (outer.record_hash !== evidenceHash(record) || record.signature.body_digest !== nativeBarAdmissionBodyDigest(b)) throw new Error("b1_record_digest");
    if (b.type === "enrollment" && (outer.record_hash !== pins.enrollment_hash || b.data.authority_id !== pins.authority_id
      || b.data.policy_hash !== evidenceHash(NATIVE_BAR_ADMISSION_PROFILE))) throw new Error("b1_enrollment_pin_mismatch");
    if (recordIds([record]).has(pins.fixture_id)) throw new Error("b1_fixture_role_alias");
    const expected = placements(record);
    if (canonical(outer.placements) !== canonical(expected) || !expected.some((p) => canonical(p) === canonical(location))) throw new Error("b1_record_placement");
    authenticate(outer, "native-bar-eb-signed-record-v1", publicKey);
    return { ...noAuthority, fixture_signature_verified: true as const, supplied_location_matches: true as const,
      record_hash: outer.record_hash, encoded_sha256: rawHash(raw), record };
  }
  function verifyCheckpoint(input: Uint8Array, suppliedRequest: unknown) {
    const checkpoint = decodeNativeBarSignedReadCheckpoint(input);
    guard(suppliedRequest, 1024); const request = requestSchema.parse(suppliedRequest);
    for (const field of ["fixture_id", "store_id", "epoch_id", "authority_id", "key_id", "enrollment_hash"] as const)
      if (checkpoint[field] !== pins[field]) throw new Error("b1_checkpoint_pin_mismatch");
    if ([pins.fixture_id, pins.store_id, pins.epoch_id, pins.authority_id, pins.key_id].includes(request.challenge)
      || checkpoint.challenge !== request.challenge || request.received_at < request.sent_at
      || checkpoint.observed_at < request.sent_at || checkpoint.observed_at > request.received_at
      || Date.parse(request.received_at) - Date.parse(request.sent_at) >= 600000) throw new Error("b1_checkpoint_request");
    authenticate(checkpoint, "native-bar-eb-read-checkpoint-v1", publicKey);
    return { ...noAuthority, fixture_signature_verified: true as const, checkpoint };
  }
  function verifyTranscript(input: unknown) {
    guard(input, L.metadata_bytes, true); const q = transcriptSchema.parse(input);
    const charged = q.records.reduce((sum, r) => sum + typedLength.call(r.bytes), typedLength.call(q.start.bytes) + typedLength.call(q.end.bytes))
      + byteSize({ pins, locations: q.records.map((r) => r.location), start_request: q.start.request, end_request: q.end.request, evaluated_at: q.evaluated_at });
    if (charged > L.metadata_bytes) throw new Error("b1_transcript_input_bytes");
    const start = verifyCheckpoint(q.start.bytes, q.start.request).checkpoint, end = verifyCheckpoint(q.end.bytes, q.end.request).checkpoint;
    if (start.challenge === end.challenge) throw new Error("b1_challenge_reused");
    if (start.sequence !== end.sequence || start.tip_hash !== end.tip_hash) throw new Error("b1_checkpoint_changed");
    if (q.start.request.received_at > q.end.request.sent_at || q.evaluated_at < q.end.request.received_at
      || Date.parse(q.evaluated_at) - Date.parse(q.start.request.sent_at) >= 600000
      || Date.parse(q.evaluated_at) - Date.parse(start.observed_at) >= 600000) throw new Error("b1_transcript_time");
    const records = q.records.map((r) => {
      if (r.location.root_role !== "witness") throw new Error("b1_transcript_witness_required");
      return verifyRecord(r.bytes, r.location).record;
    }).sort((a, b) => BigInt(a.body.sequence) < BigInt(b.body.sequence) ? -1 : BigInt(a.body.sequence) > BigInt(b.body.sequence) ? 1 : 0);
    if (records.some((r) => r.body.at > start.observed_at)) throw new Error("b1_checkpoint_prefix_clock");
    if (start.sequence !== String(records.length) || records.some((r, i) => r.body.sequence !== String(i + 1))) throw new Error("b1_transcript_sequence");
    const ids = recordIds(records);
    if (ids.has(start.challenge) || ids.has(end.challenge)) throw new Error("b1_challenge_role_alias");
    const model = replayNativeBarAdmission({ schema: "native-bar-admission-bundle-v6", as_of: q.evaluated_at, records,
      supplied_trust: { store_id: pins.store_id, epoch_id: pins.epoch_id, authority_id: pins.authority_id, key_id: pins.key_id,
        enrollment_hash: pins.enrollment_hash, challenge: end.challenge,
        signature_checks: records.map((r) => ({ record_hash: evidenceHash(r), outcome: "valid" })),
        checkpoint: { store_id: end.store_id, epoch_id: end.epoch_id, authority_id: end.authority_id, key_id: end.key_id,
          challenge: end.challenge, sequence: end.sequence, tip_hash: end.tip_hash, observed_at: end.observed_at, signature_status: "valid" } } });
    if (model.model_status !== "consistent_supplied_model") throw new Error("b1_model_inconsistent");
    const result = { ...noAuthority, schema: "native-bar-signed-admission-transcript-result-v1" as const,
      fixture_signature_verified: true as const, checkpoint_pair_verified: true as const, logical_prefix_verified: true as const,
      charged_input_bytes: String(charged), model };
    if (byteSize(result) > L.response_bytes) throw new Error("b1_response_bytes");
    return result;
  }
}
