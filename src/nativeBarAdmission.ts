import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { nativeBarTransactionProofSchema } from "./nativeBarTransactions.js";
import { nativeBarReceiptSchema } from "./nativeBarArtifacts.js";

// E-A models caller-supplied evidence only. No result authenticates a witness, reads storage or grants execution.
export const NATIVE_BAR_ADMISSION_PROFILE = Object.freeze({ schema: "native-bar-synthetic-admission-profile-v6" });
export const NATIVE_BAR_ADMISSION_LIMITS = Object.freeze({ record_bytes: 65536, receipt_bytes: 16384,
  payload_bytes: 1048576, metadata_bytes: 16 * 1024 ** 2, inventory_bytes: 1024 ** 3, entries: 512,
  read_bytes: 256 * 1024 ** 2, response_bytes: 8 * 1024 ** 2, roots: 8, descriptors: 512, targets: 2 });
const L = NATIVE_BAR_ADMISSION_LIMITS, UINT = /^(0|[1-9][0-9]{0,29})$/;
export const NATIVE_BAR_ADMISSION_RECORD_BYTES = Object.freeze({ enrollment: 8192, producer_reserved: 8192,
  artifact_created: 4096, content_verified: 4096, publication_pending: 4096, publication_observed: 4096,
  receipt_prepared: 4096, receipt_linked: 4096, producer_reverify_consumed: 4096,
  maintenance_admitted: 16384, original_sealed: 8192, maintenance_attempt_consumed: 4096,
  publication_witness: 4096, coordination_witness: 8192 });
const uint = z.string().regex(UINT);
const positive = uint.refine((s) => !UINT.test(s) || BigInt(s) > 0n);
const flags = uint.refine((s) => !UINT.test(s) || BigInt(s) <= 4294967295n);
const uuid = nativeBarId.refine((s) => s === s.toLowerCase(), "lower-case identifier required");
const path = z.string().min(1).max(512).refine((s) => !s.includes("\\") && !s.includes("\0")
  && s.split("/").every((p) => p && p !== "." && p !== ".."), "canonical relative path required");
const directory = z.strictObject({ device: uint, inode: uint, uid: uint, gid: uint, mode: z.literal("16832"),
  flags, acl: z.enum(["none", "deny_only"]), acl_hash: nativeBarHash, birthtime_ns: uint });
const proof = nativeBarTransactionProofSchema.extend({ flags, acl_hash: nativeBarHash });
const window = z.strictObject({ opened_at: nativeBarTimestamp, expires_at: nativeBarTimestamp });
const bracket = z.strictObject({ before: nativeBarTimestamp, after: nativeBarTimestamp });
const header = { schema: z.literal("native-bar-admission-body-v6"), store_id: uuid, epoch_id: uuid, sequence: positive,
  previous_hash: nativeBarHash.nullable(), at: nativeBarTimestamp };
const enrollment = z.strictObject({ ...header, type: z.literal("enrollment"), data: z.strictObject({ authority_id: uuid,
  policy_hash: nativeBarHash, capabilities_hash: nativeBarHash, store_root: directory, witness_root: directory,
  store_ancestors_hash: nativeBarHash, witness_ancestors_hash: nativeBarHash }) });
const artifact = z.strictObject({ artifact_id: uuid, role: z.enum(["payload_stage", "payload_final", "receipt_stage", "receipt_final"]),
  path, from_artifact_id: uuid.nullable() });
const producerReserved = z.strictObject({ ...header, type: z.literal("producer_reserved"), data: z.strictObject({
  producer_id: uuid, recording_id: uuid, owner_incarnation_hash: nativeBarHash, window, partition_at: nativeBarTimestamp,
  payload_hash: nativeBarHash, payload_bytes: positive, restoration_hash: nativeBarHash, artifacts: z.array(artifact).length(4),
  reverify_attempt_ids: z.tuple([uuid, uuid]) }) });
const artifactCreated = z.strictObject({ ...header, type: z.literal("artifact_created"), data: z.strictObject({
  producer_id: uuid, artifact_id: uuid, reservation_hash: nativeBarHash, proof }) });
const contentVerified = z.strictObject({ ...header, type: z.literal("content_verified"), data: z.strictObject({
  producer_id: uuid, artifact_id: uuid, created_hash: nativeBarHash, proof }) });
const publicationPending = z.strictObject({ ...header, type: z.literal("publication_pending"), data: z.strictObject({
  producer_id: uuid, from_artifact_id: uuid, artifact_id: uuid, content_hash: nativeBarHash }) });
const publicationObserved = z.strictObject({ ...header, type: z.literal("publication_observed"), data: z.strictObject({
  producer_id: uuid, artifact_id: uuid, pending_hash: nativeBarHash, proof, publication: bracket }) });
const receiptPrepared = z.strictObject({ ...header, type: z.literal("receipt_prepared"), data: z.strictObject({
  producer_id: uuid, payload_publication_hash: nativeBarHash, receipt: nativeBarReceiptSchema }) });
const receiptLinked = z.strictObject({ ...header, type: z.literal("receipt_linked"), data: z.strictObject({
  producer_id: uuid, receipt_preparation_hash: nativeBarHash, receipt_publication_hash: nativeBarHash,
  verification_attempt_hash: nativeBarHash.nullable() }) });
const producerReverify = z.strictObject({ ...header, type: z.literal("producer_reverify_consumed"), data: z.strictObject({
  producer_id: uuid, ordinal: z.number().int().min(1).max(2), attempt_id: uuid, plan_hash: nativeBarHash, window,
  prefix_hash: nativeBarHash, purpose: z.literal("verify_existing_pair") }) });
const layoutInput = z.strictObject({ maintenance_id: uuid, scope_id: uuid, attempt_ids: z.tuple([uuid, uuid, uuid]), target_ids: z.array(uuid).min(1).max(2) });
const target = z.strictObject({ target_id: uuid, producer_id: uuid, artifact_id: uuid, source_path: path,
  publication_hash: nativeBarHash, proof, receipt_state: z.literal("absent"), producer_liveness: z.literal("dead") });
export const nativeBarAdmissionScopeSchema = z.strictObject({ schema: z.literal("native-bar-maintenance-admission-scope-v6"),
  maintenance_id: uuid, scope_id: uuid, attempt_ids: z.tuple([uuid, uuid, uuid]), enrollment_hash: nativeBarHash,
  layout_digest: nativeBarHash, reference_hash: nativeBarHash, inventory_hash: nativeBarHash, allocation_digest: nativeBarHash,
  capacity_digest: nativeBarHash, original_plan_hash: nativeBarHash, window, targets: z.array(target).min(1).max(2) });
const original = z.strictObject({ schema: z.literal("native-bar-admission-original-v6"), maintenance_id: uuid,
  admission_hash: nativeBarHash, scope_digest: nativeBarHash, manifest_digest: nativeBarHash, layout_digest: nativeBarHash });
const maintenanceAdmitted = z.strictObject({ ...header, type: z.literal("maintenance_admitted"), data: z.strictObject({
  scope: nativeBarAdmissionScopeSchema, scope_digest: nativeBarHash }) });
const originalSealed = z.strictObject({ ...header, type: z.literal("original_sealed"), data: z.strictObject({
  maintenance_id: uuid, admission_hash: nativeBarHash, original, original_proof: proof, manifest_proof: proof }) });
const maintenanceConsumed = z.strictObject({ ...header, type: z.literal("maintenance_attempt_consumed"), data: z.strictObject({
  maintenance_id: uuid, ordinal: z.number().int().min(1).max(3), attempt_id: uuid, original_seal_hash: nativeBarHash,
  plan_hash: nativeBarHash, window, prefix_hash: nativeBarHash, event_prefix_hash: nativeBarHash.nullable(), current_reference_hash: nativeBarHash }) });
const publicationWitness = z.strictObject({ ...header, type: z.literal("publication_witness"), data: z.strictObject({
  maintenance_id: uuid, attempt_id: uuid, role: z.enum(["attempt", "event", "marker", "completion"]), path,
  content_hash: nativeBarHash, proof, publication: bracket }) });
const coordinationWitness = z.strictObject({ ...header, type: z.literal("coordination_witness"), data: z.strictObject({
  maintenance_id: uuid, attempt_id: uuid, owner_token: uuid, owner_incarnation_hash: nativeBarHash, own_delta_hash: nativeBarHash,
  entries: z.array(z.strictObject({ role: z.enum(["lock", "claim", "ticket"]), path, body_hash: nativeBarHash, proof })).length(3) }) });
export const nativeBarAdmissionBodySchema = z.discriminatedUnion("type", [enrollment, producerReserved, artifactCreated,
  contentVerified, publicationPending, publicationObserved, receiptPrepared, receiptLinked, producerReverify,
  maintenanceAdmitted, originalSealed, maintenanceConsumed, publicationWitness, coordinationWitness]);
export const nativeBarAdmissionRecordSchema = z.strictObject({ body: nativeBarAdmissionBodySchema,
  signature: z.strictObject({ schema: z.literal("native-bar-supplied-signature-v1"), algorithm: z.literal("unqualified-fixture-v1"),
    key_id: uuid, body_digest: nativeBarHash, signature_hex: z.string().regex(/^(?:[a-f0-9]{2}){1,256}$/) }) });
const check = z.enum(["valid", "invalid", "unverified"]);
const checkpoint = z.strictObject({ store_id: uuid, epoch_id: uuid, authority_id: uuid, key_id: uuid, challenge: uuid,
  sequence: positive, tip_hash: nativeBarHash, observed_at: nativeBarTimestamp, signature_status: check });
export const nativeBarAdmissionBundleSchema = z.strictObject({ schema: z.literal("native-bar-admission-bundle-v6"), as_of: nativeBarTimestamp,
  records: z.array(nativeBarAdmissionRecordSchema).min(1).max(L.entries), supplied_trust: z.strictObject({
    store_id: uuid, epoch_id: uuid, authority_id: uuid, key_id: uuid, challenge: uuid, enrollment_hash: nativeBarHash,
    signature_checks: z.array(z.strictObject({ record_hash: nativeBarHash, outcome: check })).max(L.entries), checkpoint: checkpoint.nullable() }) });

const noAuthority = Object.freeze({ verification_scope: "supplied_records_only" as const, execution_available: false as const,
  recovery_execution_available: false as const, admission_verified: false as const, signature_verified: false as const,
  checkpoint_authenticated: false as const, approval_authenticated: false as const, elapsed_clock_qualified: false as const,
  committed_history_available: false as const, original_acknowledgement: "not_proven" as const, storage_visibility_at_as_of: "not_proven" as const });
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const bytes = (value: unknown) => Buffer.byteLength(canonical(value));

// Bound structured inputs before recursive schema/canonical work. Accessors and non-JSON values are not evidence.
function bounded(value: unknown, limit = L.metadata_bytes) {
  let nodes = 0, size = 0; const active = new Set<object>();
  function visit(v: unknown, depth: number) {
    if (++nodes > 262144 || depth > 64) throw new Error("admission_input_depth_or_nodes");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("admission_non_json"); return; }
    if (typeof v === "string") { size += Buffer.byteLength(v); if (size > limit) throw new Error("admission_input_bytes"); return; }
    if (typeof v !== "object" || active.has(v)) throw new Error("admission_non_json");
    const array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new Error("admission_non_json");
    if (array && v.length > 262144 - nodes) throw new Error("admission_input_depth_or_nodes");
    const keys = Reflect.ownKeys(v);
    if (array && keys.length !== v.length + 1) throw new Error("admission_non_json");
    active.add(v);
    for (const key of keys) {
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value")) throw new Error("admission_non_json");
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) throw new Error("admission_non_json");
      size += Buffer.byteLength(key); if (size > limit) throw new Error("admission_input_bytes"); visit(d.value, depth + 1);
    }
    active.delete(v);
  }
  visit(value, 0); if (bytes(value) > limit) throw new Error("admission_input_bytes");
}
function parse(input: unknown) {
  bounded(input); const b = nativeBarAdmissionBundleSchema.parse(input);
  for (const r of b.records) if (bytes(r) > NATIVE_BAR_ADMISSION_RECORD_BYTES[r.body.type]) throw new Error("admission_record_bytes");
  return b;
}
// Count nesting and values on the raw bytes, so JSON.parse never builds a structure that bounded() would refuse.
function prescan(raw: Buffer) {
  let depth = 0, nodes = 1, quoted = false, escaped = false, opened = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) { if (escaped) escaped = false; else if (c === 0x5c) escaped = true; else if (c === 0x22) quoted = false; continue; }
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) continue;
    // The first token inside a container is one more value unless the container is empty.
    if (opened && c !== 0x5d && c !== 0x7d) ++nodes;
    opened = false;
    if (c === 0x22) quoted = true;
    else if (c === 0x5b || c === 0x7b) { if (++depth > 65) throw new Error("admission_input_depth_or_nodes"); opened = true; }
    else if (c === 0x5d || c === 0x7d) --depth;
    else if (c === 0x2c) ++nodes;
    if (nodes > 262144) throw new Error("admission_input_depth_or_nodes");
  }
}
export function decodeNativeBarAdmission(input: Uint8Array) {
  if (!(input instanceof Uint8Array) || input.byteLength > L.metadata_bytes) throw new Error("admission_input_bytes");
  const raw = Buffer.from(input); prescan(raw);
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  bounded(value); if (!raw.equals(Buffer.from(canonical(value)))) throw new Error("admission_noncanonical_bytes"); return parse(value);
}
export function nativeBarAdmissionBodyDigest(input: unknown) {
  bounded(input, L.record_bytes); return evidenceHash({ domain: "native-bar-admission-body-v6", body: nativeBarAdmissionBodySchema.parse(input) });
}
export function createNativeBarAdmissionLayout(input: unknown) {
  bounded(input, L.record_bytes); const v = layoutInput.parse(input), ids = [v.maintenance_id, v.scope_id, ...v.attempt_ids, ...v.target_ids];
  if (new Set(ids).size !== ids.length) throw new Error("admission_layout_id_reuse");
  const prefix = `maintenance/${v.maintenance_id}`, final = `quarantine/abandoned/${v.maintenance_id}`;
  const slots = [
    { role: "manifest", path: `${prefix}.manifest/${v.scope_id}.json`, ordinal: null },
    { role: "original", path: `${prefix}.json`, ordinal: null },
    ...v.attempt_ids.map((id, i) => ({ role: "attempt", path: `${prefix}.attempts/${id}.json`, ordinal: i + 1 })),
    ...Array.from({ length: 14 * v.target_ids.length }, (_, i) => ({ role: "event", path: `${prefix}.events/${i + 1}.json`, ordinal: null })),
    ...v.attempt_ids.map((id, i) => ({ role: "marker", path: `${final}/${id}.timestamp.json`, ordinal: i + 1 })),
    { role: "completion", path: `${prefix}.done.json`, ordinal: null }];
  return { schema: "native-bar-admission-layout-v6" as const, ...v,
    slots: slots.map((s, index) => ({ ...s, temporaries: v.attempt_ids.map((_, i) => `.ea-${v.scope_id}-${index + 1}-${i + 1}.tmp`) })), execution_available: false as const };
}
export function nativeBarAdmissionScopeDigest(input: unknown) {
  bounded(input, L.record_bytes); return evidenceHash({ domain: "native-bar-maintenance-admission-scope-v6", scope: nativeBarAdmissionScopeSchema.parse(input) });
}
const coordinationDigestInput = coordinationWitness.shape.data.omit({ own_delta_hash: true });
export function nativeBarAdmissionCoordinationDigest(input: unknown) {
  bounded(input, L.record_bytes);
  return evidenceHash({ domain: "native-bar-admission-coordination-v6", coordination: coordinationDigestInput.parse(input) });
}
type Proof = z.infer<typeof proof>;
type Window = z.infer<typeof window>;
type Producer = { reservation: z.infer<typeof producerReserved>["data"]; reserved_at: string; hash: string; state: string;
  artifacts: Map<string, { declaration: z.infer<typeof artifact>; created?: { hash: string; proof: Proof };
    content?: { hash: string; proof: Proof }; pending?: { hash: string; at: string; source: string };
    published?: { hash: string; at: string; proof: Proof }; moved?: boolean }>;
  receipt?: { hash: string; body: z.infer<typeof nativeBarReceiptSchema> }; linked: boolean;
  reverifications: { hash: string; at: string; window: Window; used: boolean }[] };
function within(w: Window, at: string) {
  if (Date.parse(w.expires_at) - Date.parse(w.opened_at) !== 600000 || at < w.opened_at || at >= w.expires_at)
    throw new Error("admission_window");
}
// A later attempt gets a new window: it cannot reopen the previous window or start before the previous consumption.
function fresh(w: Window, previous: Window, previousAt: string) {
  if (w.opened_at <= previous.opened_at || w.opened_at < previousAt) throw new Error("admission_window_reuse");
}
// A producer holds the store writer exclusion until it links or every window it may still use has expired.
function active(p: Producer, at: string) {
  const attempt = p.reverifications.at(-1);
  return !p.linked && (at < p.reservation.window.expires_at || (!!attempt && !attempt.used && at < attempt.window.expires_at));
}
function proofAt(p: Proof, at: string) {
  const end = BigInt(Date.parse(at)) * 1000000n + 999999n;
  if ([p.birthtime_ns, p.mtime_ns, p.ctime_ns].some((t) => BigInt(t) < 0n || BigInt(t) > end)
    || BigInt(p.birthtime_ns) > BigInt(p.mtime_ns) || BigInt(p.birthtime_ns) > BigInt(p.ctime_ns)) throw new Error("admission_proof_clock");
}
function metadataProofAt(p: Proof, at: string) {
  proofAt(p, at);
  if (BigInt(p.size) > BigInt(L.record_bytes)) throw new Error("admission_metadata_object_bytes");
}
function identity(a: Proof, b: Proof, writing = false) {
  const fields = ["device", "inode", "uid", "gid", "mode", "nlink", "acl", "acl_hash", "birthtime_ns", "flags"] as const;
  if (fields.some((f) => a[f] !== b[f]) || (!writing && (a.sha256 !== b.sha256 || a.size !== b.size || a.mtime_ns !== b.mtime_ns))
    || BigInt(b.ctime_ns) < BigInt(a.ctime_ns)) throw new Error("admission_object_changed");
}
function producersOf(b: z.infer<typeof nativeBarAdmissionBundleSchema>, e: z.infer<typeof enrollment>["data"]) {
  const producers = new Map<string, Producer>(), ids = new Set([b.supplied_trust.store_id, b.supplied_trust.epoch_id,
    b.supplied_trust.authority_id, b.supplied_trust.key_id, b.supplied_trust.challenge]), identities = new Set<string>(), plans = new Set<string>();
  let lastSequence = 0, lastRecordedAt = "";
  function use(id: string) { if (ids.has(id)) throw new Error("admission_role_id_reuse"); ids.add(id); }
  // Approval digests are audit data for one consumption, never a reusable grant.
  function usePlan(hash: string) { if (plans.has(hash)) throw new Error("admission_plan_reuse"); plans.add(hash); }
  for (const r of b.records) {
    const v = r.body, hash = evidenceHash(r);
    if (v.type === "enrollment" || v.type === "maintenance_admitted" || v.type === "original_sealed"
      || v.type === "maintenance_attempt_consumed" || v.type === "publication_witness" || v.type === "coordination_witness") continue;
    const d = v.data;
    for (const [other, q] of producers) if (other !== d.producer_id && active(q, v.at)) throw new Error("admission_writer_overlap");
    if (v.type === "producer_reserved") {
      const d = v.data; use(d.producer_id); use(d.recording_id); within(d.window, v.at);
      for (const id of d.reverify_attempt_ids) use(id);
      if (d.partition_at < d.window.opened_at || d.partition_at > v.at || BigInt(d.payload_bytes) > BigInt(L.payload_bytes)) throw new Error("admission_producer_binding");
      const roles = new Map(d.artifacts.map((a) => [a.role, a]));
      if (roles.size !== 4) throw new Error("admission_artifact_roles");
      const day = d.partition_at.slice(0, 10);
      for (const a of d.artifacts) {
        use(a.artifact_id); const stage = a.role.endsWith("_stage"), payload = a.role.startsWith("payload");
        const expected = stage ? `.producer-${a.artifact_id}.tmp` : `${payload ? "captures" : "receipts"}/${day}/${d.recording_id}.json`;
        if (a.path !== expected || a.from_artifact_id !== (stage ? null : roles.get(payload ? "payload_stage" : "receipt_stage")!.artifact_id))
          throw new Error("admission_artifact_binding");
      }
      producers.set(d.producer_id, { reservation: d, reserved_at: v.at, hash, state: "reserved_only", artifacts: new Map(d.artifacts.map((a) => [a.artifact_id, { declaration: a }])),
        linked: false, reverifications: [] }); continue;
    }
    const p = producers.get(d.producer_id); if (!p) throw new Error("admission_producer_missing");
    if (v.type === "producer_reverify_consumed") {
      const d = v.data; within(d.window, v.at);
      if (!p.receipt || p.linked || ![...p.artifacts.values()].some((a) => a.declaration.role === "receipt_final" && a.published)
        || d.ordinal !== p.reverifications.length + 1 || d.attempt_id !== p.reservation.reverify_attempt_ids[d.ordinal - 1]
        || d.prefix_hash !== v.previous_hash) throw new Error("admission_reverification_binding");
      const previous = p.reverifications.at(-1);
      fresh(d.window, previous?.window ?? p.reservation.window, previous?.at ?? p.reserved_at); usePlan(d.plan_hash);
      p.reverifications.push({ hash, at: v.at, window: d.window, used: false }); continue;
    }
    if (v.type === "receipt_linked") {
      const d = v.data, a = [...p.artifacts.values()].find((a) => a.declaration.role === "receipt_final")!;
      if (!p.receipt || p.linked || d.receipt_preparation_hash !== p.receipt.hash || d.receipt_publication_hash !== a.published?.hash)
        throw new Error("admission_receipt_link_binding");
      if (d.verification_attempt_hash === null) {
        if (p.reverifications.length) throw new Error("admission_reverification_required"); within(p.reservation.window, v.at);
      } else {
        const attempt = p.reverifications.at(-1);
        if (!attempt || attempt.used || d.verification_attempt_hash !== attempt.hash) throw new Error("admission_reverification_consumed");
        within(attempt.window, v.at); attempt.used = true;
      }
      p.linked = true; p.state = "receipt_linked_model_only"; continue;
    }
    within(p.reservation.window, v.at);
    if (p.linked || p.reverifications.length) throw new Error("admission_producer_terminal");
    if (v.type === "receipt_prepared") {
      const d = v.data, payload = [...p.artifacts.values()].find((a) => a.declaration.role === "payload_final")!;
      const q = d.receipt;
      if (!Number.isSafeInteger(q.sequence) || q.sequence <= lastSequence) throw new Error("admission_receipt_sequence");
      if (p.receipt || !payload.published || d.payload_publication_hash !== payload.published.hash || q.recording_id !== p.reservation.recording_id
        || q.policy_hash !== e.policy_hash || q.payload_hash !== p.reservation.payload_hash || q.partition_at !== p.reservation.partition_at
        || q.day !== p.reservation.partition_at.slice(0, 10) || q.recorded_at < payload.published.at || q.recorded_at > v.at
        || bytes(q) > L.receipt_bytes) throw new Error("admission_receipt_binding");
      // v1 history refuses a later receipt recorded before an earlier one (observation_order_corrupt).
      if (q.recorded_at < lastRecordedAt) throw new Error("admission_receipt_clock_order");
      usePlan(q.plan_hash); lastSequence = q.sequence; lastRecordedAt = q.recorded_at; p.receipt = { hash, body: q }; p.state = "receipt_prepared"; continue;
    }
    const a = p.artifacts.get(v.data.artifact_id); if (!a) throw new Error("admission_artifact_missing");
    if (v.type === "artifact_created") {
      const d = v.data; proofAt(d.proof, v.at);
      const key = `${d.proof.device}:${d.proof.inode}`;
      if (a.created || !a.declaration.role.endsWith("_stage") || d.reservation_hash !== p.hash || d.proof.size !== "0"
        || d.proof.sha256 !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        || d.proof.device !== e.store_root.device || d.proof.uid !== e.store_root.uid || identities.has(key)
        || [e.store_root.inode, e.witness_root.inode].includes(d.proof.inode)
        || BigInt(d.proof.birthtime_ns) < BigInt(Date.parse(p.reserved_at)) * 1000000n)
        throw new Error("admission_created_binding");
      identities.add(key); a.created = { hash, proof: d.proof }; p.state = a.declaration.role + "_created";
    } else if (v.type === "content_verified") {
      const d = v.data; proofAt(d.proof, v.at);
      if (!a.created || a.content || d.created_hash !== a.created.hash) throw new Error("admission_content_without_creation");
      identity(a.created.proof, d.proof, true);
      const payload = a.declaration.role === "payload_stage", expected = payload ? p.reservation.payload_hash : p.receipt && evidenceHash(p.receipt.body);
      const size = payload ? p.reservation.payload_bytes : p.receipt && String(bytes(p.receipt.body));
      if (d.proof.sha256 !== expected || d.proof.size !== size || (!payload && !p.receipt)) throw new Error("admission_content_binding");
      a.content = { hash, proof: d.proof }; p.state = a.declaration.role + "_verified";
    } else if (v.type === "publication_pending") {
      const d = v.data, source = p.artifacts.get(d.from_artifact_id);
      if (a.pending || a.published || a.declaration.from_artifact_id !== d.from_artifact_id || !source?.content || source.moved
        || d.content_hash !== source.content.hash) throw new Error("admission_publication_pending_binding");
      a.pending = { hash, at: v.at, source: d.from_artifact_id }; p.state = a.declaration.role + "_pending";
    } else if (v.type === "publication_observed") {
      const d = v.data; proofAt(d.proof, v.at);
      if (!a.pending || a.published || d.pending_hash !== a.pending.hash || d.publication.before < a.pending.at
        || d.publication.after < d.publication.before || d.publication.after > v.at) throw new Error("admission_publication_observation_binding");
      const source = p.artifacts.get(a.pending.source)!; identity(source.content!.proof, d.proof);
      if (BigInt(d.proof.ctime_ns) < BigInt(Date.parse(d.publication.before)) * 1000000n
        || BigInt(d.proof.ctime_ns) > BigInt(Date.parse(d.publication.after)) * 1000000n + 999999n) throw new Error("admission_publication_clock");
      source.moved = true; a.published = { hash, at: v.at, proof: d.proof }; p.state = a.declaration.role === "receipt_final" ? "commit_unconfirmed" : "payload_pending";
    }
  }
  return { producers, plans };
}
type Maintenance = { scope: z.infer<typeof nativeBarAdmissionScopeSchema>; hash: string; admittedAt: string; seal?: string;
  consumed: { hash: string; at: string; data: z.infer<typeof maintenanceConsumed>["data"] }[];
  publications: Map<string, string>; coordination: Set<string>; lastPublication: string | null; terminalSeen: boolean };
function maintenanceOf(b: z.infer<typeof nativeBarAdmissionBundleSchema>, ps: Map<string, Producer>, producerPlans: Set<string>, e: z.infer<typeof enrollment>["data"]) {
  const out = new Map<string, Maintenance>();
  const ids = new Set([b.supplied_trust.store_id, b.supplied_trust.epoch_id, b.supplied_trust.authority_id, b.supplied_trust.key_id, b.supplied_trust.challenge,
    ...[...ps.values()].flatMap((p) => [p.reservation.producer_id, p.reservation.recording_id, ...p.reservation.artifacts.map((a) => a.artifact_id),
      ...p.reservation.reverify_attempt_ids])]);
  const claimed = new Set<string>(), plans = new Set(producerPlans), incarnations = new Set<string>(), objects = new Set([e.store_root.inode, e.witness_root.inode,
    ...[...ps.values()].flatMap((p) => [...p.artifacts.values()].flatMap((a) => a.created ? [a.created.proof.inode] : []))]);
  function use(id: string) { if (ids.has(id)) throw new Error("admission_role_id_reuse"); ids.add(id); }
  function usePlan(hash: string) { if (plans.has(hash)) throw new Error("admission_plan_reuse"); plans.add(hash); }
  for (const r of b.records) {
    const v = r.body, hash = evidenceHash(r);
    if (v.type === "maintenance_admitted") {
      const s = v.data.scope; within(s.window, v.at);
      // Producer states are final here: replay already refuses every producer record after an admission.
      for (const p of ps.values()) if (active(p, v.at)) throw new Error("admission_writer_overlap");
      for (const id of [s.maintenance_id, s.scope_id, ...s.attempt_ids, ...s.targets.map((t) => t.target_id)]) use(id);
      usePlan(s.original_plan_hash);
      const layout = createNativeBarAdmissionLayout({ maintenance_id: s.maintenance_id, scope_id: s.scope_id,
        attempt_ids: s.attempt_ids, target_ids: s.targets.map((t) => t.target_id) });
      if (s.enrollment_hash !== b.supplied_trust.enrollment_hash || v.data.scope_digest !== nativeBarAdmissionScopeDigest(s)
        || s.layout_digest !== evidenceHash(layout)) throw new Error("admission_scope_binding");
      for (const t of s.targets) {
        const p = ps.get(t.producer_id), a = p?.artifacts.get(t.artifact_id); proofAt(t.proof, v.at);
        if (!p || p.receipt || p.linked || !a?.published || a.published.at > v.at || a.declaration.role !== "payload_final"
          || t.publication_hash !== a.published.hash || t.source_path !== a.declaration.path || !same(t.proof, a.published.proof)
          || claimed.has(t.artifact_id)) throw new Error("admission_target_lineage_or_reference");
        claimed.add(t.artifact_id);
      }
      out.set(s.maintenance_id, { scope: s, hash, admittedAt: v.at, consumed: [], publications: new Map(), coordination: new Set(), lastPublication: null, terminalSeen: false });
      continue;
    }
    if (v.type !== "original_sealed" && v.type !== "maintenance_attempt_consumed" && v.type !== "publication_witness" && v.type !== "coordination_witness") continue;
    const m = out.get(v.data.maintenance_id); if (!m) throw new Error("admission_maintenance_missing");
    const s = m.scope;
    if (v.type === "original_sealed") {
      const d = v.data; within(s.window, v.at);
      const manifest = { schema: "native-bar-admission-manifest-v6", maintenance_id: s.maintenance_id, targets: s.targets };
      const expected = { schema: "native-bar-admission-original-v6", maintenance_id: s.maintenance_id, admission_hash: m.hash,
        scope_digest: nativeBarAdmissionScopeDigest(s), manifest_digest: evidenceHash(manifest), layout_digest: s.layout_digest };
      if (m.seal || d.admission_hash !== m.hash || !same(d.original, expected)) throw new Error("admission_original_seal_binding");
      // The original hashes the admission record, so neither object can be written before that record exists.
      for (const [value, p] of [[expected, d.original_proof], [manifest, d.manifest_proof]] as const) {
        metadataProofAt(p, v.at);
        if (p.sha256 !== evidenceHash(value) || p.size !== String(bytes(value)) || p.device !== e.store_root.device || p.uid !== e.store_root.uid
          || objects.has(p.inode) || BigInt(p.birthtime_ns) < BigInt(Date.parse(m.admittedAt)) * 1000000n) throw new Error("admission_original_object_binding");
        objects.add(p.inode);
      }
      m.seal = hash; continue;
    }
    if (!m.seal) throw new Error("admission_original_not_sealed");
    if (v.type === "maintenance_attempt_consumed") {
      const d = v.data; within(d.window, v.at);
      if (m.terminalSeen || d.ordinal !== m.consumed.length + 1 || d.attempt_id !== s.attempt_ids[d.ordinal - 1]
        || d.original_seal_hash !== m.seal || d.prefix_hash !== v.previous_hash || d.event_prefix_hash !== m.lastPublication
        || (d.ordinal === 1 && (!same(d.window, s.window) || d.plan_hash !== s.original_plan_hash))) throw new Error("admission_attempt_binding");
      if (d.ordinal > 1) { const previous = m.consumed.at(-1)!; fresh(d.window, previous.data.window, previous.at); usePlan(d.plan_hash); }
      m.consumed.push({ hash, at: v.at, data: d }); continue;
    }
    const attempt = m.consumed.at(-1); if (!attempt || v.data.attempt_id !== attempt.data.attempt_id) throw new Error("admission_attempt_missing");
    within(attempt.data.window, v.at);
    if (v.type === "coordination_witness") {
      const d = v.data; use(d.owner_token);
      const roles = new Set(d.entries.map((x) => x.role)), ownIds = new Set<string>();
      const { own_delta_hash, ...delta } = d;
      // Each attempt is a fresh worker: its objects are born after its consumption, under a new incarnation.
      const born = BigInt(Date.parse(attempt.at)) * 1000000n;
      if (roles.size !== 3 || m.coordination.has(d.attempt_id) || incarnations.has(d.owner_incarnation_hash)
        || own_delta_hash !== nativeBarAdmissionCoordinationDigest(delta)) throw new Error("admission_coordination_binding");
      for (const x of d.entries) {
        metadataProofAt(x.proof, v.at); const expected = x.role === "lock" ? ".writer.lock" : `.writer-${x.role}-${d.owner_token}.json`;
        if (x.path !== expected || x.body_hash !== x.proof.sha256 || x.proof.device !== e.store_root.device || x.proof.uid !== e.store_root.uid
          || ownIds.has(x.proof.inode) || objects.has(x.proof.inode) || BigInt(x.proof.birthtime_ns) < born) throw new Error("admission_coordination_binding");
        ownIds.add(x.proof.inode);
      }
      for (const id of ownIds) objects.add(id); incarnations.add(d.owner_incarnation_hash); m.coordination.add(d.attempt_id); continue;
    }
    const d = v.data, layout = createNativeBarAdmissionLayout({ maintenance_id: s.maintenance_id, scope_id: s.scope_id,
      attempt_ids: s.attempt_ids, target_ids: s.targets.map((t) => t.target_id) });
    const attemptPath = layout.slots.find((x) => x.role === "attempt" && x.ordinal === attempt.data.ordinal)!.path;
    if (!m.coordination.has(d.attempt_id) || (d.role !== "attempt" && !m.publications.has(attemptPath)) || m.terminalSeen)
      throw new Error("admission_publication_witness_order");
    const slot = layout.slots.find((x) => x.path === d.path);
    metadataProofAt(d.proof, v.at);
    if (!slot || slot.role !== d.role || (slot.ordinal !== null && slot.ordinal !== attempt.data.ordinal) || m.publications.has(d.path)
      || d.content_hash !== d.proof.sha256 || d.proof.device !== e.store_root.device || d.proof.uid !== e.store_root.uid
      || d.publication.before < attempt.data.window.opened_at || d.publication.after < d.publication.before || d.publication.after > v.at
      || BigInt(d.proof.birthtime_ns) < BigInt(Date.parse(d.publication.before)) * 1000000n
      || BigInt(d.proof.ctime_ns) > BigInt(Date.parse(d.publication.after)) * 1000000n + 999999n)
      throw new Error("admission_publication_witness_binding");
    if (objects.has(d.proof.inode)) throw new Error("admission_publication_object_alias");
    objects.add(d.proof.inode); m.publications.set(d.path, d.content_hash); m.lastPublication = d.content_hash;
    if (d.role === "completion") m.terminalSeen = true;
  }
  return out;
}
export function replayNativeBarAdmission(input: unknown) {
  const b = parse(input), pins = b.supplied_trust, first = b.records[0], reasons: string[] = [];
  if (first.body.type !== "enrollment" || evidenceHash(first) !== pins.enrollment_hash) throw new Error("admission_enrollment_binding");
  const e = first.body.data;
  if (new Set([pins.store_id, pins.epoch_id, pins.authority_id, pins.key_id]).size !== 4
    || [e.store_root, e.witness_root].some((p) => BigInt(p.birthtime_ns) > BigInt(Date.parse(first.body.at)) * 1000000n + 999999n))
    throw new Error("admission_enrollment_roles_or_clock");
  if (e.policy_hash !== evidenceHash(NATIVE_BAR_ADMISSION_PROFILE) || e.store_root.device !== e.witness_root.device
    || e.store_root.uid !== e.witness_root.uid || e.store_root.inode === e.witness_root.inode) throw new Error("admission_root_profile_binding");
  if (e.authority_id !== pins.authority_id) reasons.push("authority_mismatch");
  const checks = new Map(pins.signature_checks.map((c) => [c.record_hash, c.outcome]));
  if (checks.size !== pins.signature_checks.length) throw new Error("admission_duplicate_signature_check");
  let previous: string | null = null, at = first.body.at, maintenancePending = false;
  for (const [i, r] of b.records.entries()) {
    const body = r.body, hash = evidenceHash(r);
    if (body.sequence !== String(i + 1) || body.previous_hash !== previous || body.at < at || body.at > b.as_of
      || (i > 0 && body.type === "enrollment")) throw new Error("admission_chain_binding");
    if (r.signature.body_digest !== nativeBarAdmissionBodyDigest(body)) throw new Error("admission_body_digest");
    if (body.type === "maintenance_admitted") {
      if (maintenancePending) throw new Error("admission_unresolved_maintenance");
      maintenancePending = true;
    }
    else if (maintenancePending && !["original_sealed", "maintenance_attempt_consumed", "publication_witness", "coordination_witness"].includes(body.type))
      throw new Error("admission_unresolved_maintenance_blocks_producer");
    if (body.store_id !== pins.store_id || body.epoch_id !== pins.epoch_id || r.signature.key_id !== pins.key_id) reasons.push("store_epoch_key_mismatch");
    if (checks.get(hash) !== "valid") reasons.push("signature_claim_unavailable");
    checks.delete(hash); previous = hash; at = body.at;
  }
  if (checks.size) throw new Error("admission_unrelated_signature_check");
  const c = pins.checkpoint;
  if (!c) reasons.push("checkpoint_unavailable");
  else if (c.store_id !== pins.store_id || c.epoch_id !== pins.epoch_id || c.authority_id !== pins.authority_id || c.key_id !== pins.key_id
    || c.challenge !== pins.challenge || c.sequence !== String(b.records.length) || c.tip_hash !== previous
    || c.observed_at < at || c.observed_at > b.as_of || c.signature_status !== "valid") reasons.push("checkpoint_mismatch_or_unverified");
  const { producers, plans } = producersOf(b, e), maintenance = maintenanceOf(b, producers, plans, e);
  return { ...noAuthority, schema: "native-bar-admission-replay-v6" as const,
    model_status: reasons.length ? "blocked_supplied_model" as const : "consistent_supplied_model" as const,
    model_blockers: [...new Set(reasons)], tip_hash: previous!, record_count: b.records.length,
    producers: [...producers.values()].map((p) => ({ producer_id: p.reservation.producer_id, recording_id: p.reservation.recording_id,
      state: p.state, receipt_hash: p.receipt ? evidenceHash(p.receipt.body) : null, linked: p.linked,
      consumed_reverifications: p.reverifications.length })), maintenance: [...maintenance.values()].map((m) => ({
      maintenance_id: m.scope.maintenance_id, state: m.seal ? "sealed_model_only" : "admitted_unsealed",
      consumed_ordinals: m.consumed.map((x) => x.data.ordinal), original_reference_hash: m.scope.reference_hash,
      current_reference_hash: m.consumed.at(-1)?.data.current_reference_hash ?? null,
      coordination_witnessed_ordinals: m.scope.attempt_ids.flatMap((id, i) => m.coordination.has(id) ? [i + 1] : []),
      witnessed_publications: m.publications.size, terminal_witness_present: m.terminalSeen,
      journal_replay_verified: false, capacity_verified: false, native_evidence_verified: false })) };
}

const restart = z.strictObject({ bundle: nativeBarAdmissionBundleSchema, maintenance_id: uuid, now: nativeBarTimestamp,
  coordination: z.enum(["clear", "live", "suspended", "unknown", "known_dead", "unwitnessed"]), current_reference_hash: nativeBarHash });
export function assessNativeBarAdmissionRestart(input: unknown) {
  bounded(input); const q = restart.parse(input), r = replayNativeBarAdmission(q.bundle), m = r.maintenance.find((m) => m.maintenance_id === q.maintenance_id);
  const reasons = [...r.model_blockers], c = q.bundle.supplied_trust.checkpoint;
  // Freshness is measured from the checkpoint observation; as_of is only the caller's label for the view.
  if (!c || q.now < q.bundle.as_of || q.now < c.observed_at || Date.parse(q.now) - Date.parse(c.observed_at) >= 600000) reasons.push("fresh_view_required");
  if (!m || m.state !== "sealed_model_only") reasons.push("original_admission_unavailable");
  if (q.coordination !== "clear") reasons.push(q.coordination === "known_dead" ? "coordination_retirement_required" : "coordination_blocked");
  // E-A has no retirement evidence role, so witnessed coordination stays unretired in the ledger whatever the caller supplies.
  if (m?.coordination_witnessed_ordinals.length) reasons.push("ledger_coordination_unretired");
  if (m?.terminal_witness_present) reasons.push("terminal_journal_requires_verification");
  if (m && (m.current_reference_hash ?? m.original_reference_hash) !== q.current_reference_hash) reasons.push("current_references_changed");
  const next = Math.max(1, ...(m?.consumed_ordinals ?? [])) + 1;
  if (next > 3) reasons.push("attempts_exhausted");
  return { ...noAuthority, schema: "native-bar-admission-restart-v6" as const, original_invocation_invalid: true as const,
    decision: reasons.length ? "diagnostics_only" as const : "requires_fresh_admission" as const, model_blockers: [...new Set(reasons)],
    next_ordinal: reasons.length ? null : next, restored_grant: false as const,
    required_gates: ["authenticated_checkpoint", "native_scope_and_reference_verification", "transaction_journal_replay", "fresh_same_process_plan_and_host_approval"] };
}

const occupied = z.strictObject({ entries: uint, inventory_bytes: uint, metadata_bytes: uint, allocated_bytes: uint });
export const nativeBarAdmissionCapacitySchema = z.strictObject({ schema: z.literal("native-bar-admission-capacity-v6"),
  producer_operations: z.number().int().min(0).max(2), maintenance_targets: z.number().int().min(0).max(2),
  data: occupied, witness: occupied, authority: occupied,
  // Replay requires the data and witness roots on one device, so they share one free-space figure; the authority may share it too.
  free_space: z.strictObject({ store_volume: uint.nullable(), authority: z.union([z.literal("store_volume"), uint]).nullable() }),
  read_bytes: uint, response_bytes: uint,
  roots: z.number().int().nonnegative(), live_targets: z.number().int().nonnegative(), descriptors: z.number().int().nonnegative() });
/** Full finite program, including retained failed metadata slots. Supplied accounting is not a native reservation. */
export function calculateNativeBarAdmissionCapacity(input: unknown) {
  bounded(input, L.record_bytes); const v = nativeBarAdmissionCapacitySchema.parse(input), reasons: string[] = [];
  if (!v.producer_operations && !v.maintenance_targets) throw new Error("admission_empty_capacity_scope");
  type Root = "data" | "witness" | "authority";
  const roots: Root[] = ["data", "witness", "authority"];
  const schedule: { root: Root; role: string; count: number; bytes_per_record: number; temporary_slots: number }[] = [];
  function add(root: Root, role: string, count: number, size: number, temporary_slots = 3) {
    if (count) schedule.push({ root, role, count, bytes_per_record: size, temporary_slots });
  }
  add("witness", "enrollment", 1, NATIVE_BAR_ADMISSION_RECORD_BYTES.enrollment);
  const producerRoles = { producer_reserved: 1, artifact_created: 2, content_verified: 2, publication_pending: 2,
    publication_observed: 2, receipt_prepared: 1, receipt_linked: 3, producer_reverify_consumed: 2 } as const;
  for (const [role, count] of Object.entries(producerRoles)) for (const root of ["data", "witness"] as const)
    add(root, role, count * v.producer_operations, NATIVE_BAR_ADMISSION_RECORD_BYTES[role as keyof typeof producerRoles]);
  if (v.maintenance_targets) {
    const nativeRoles = { manifest: 1, original: 1, attempt: 3, event: 14 * v.maintenance_targets, marker: 3, completion: 1 };
    for (const [role, count] of Object.entries(nativeRoles)) add("data", `maintenance_${role}`, count, L.record_bytes);
    // R-D's 32 recovery headroom slots for the same journal, in addition to the coordination objects below.
    add("data", "recovery_headroom", 32, L.record_bytes, 0);
    // Exclusive coordination creation has no publication temporary; retired objects remain charged.
    add("data", "maintenance_coordination", 9, L.record_bytes, 0);
    add("witness", "maintenance_admitted", 1, NATIVE_BAR_ADMISSION_RECORD_BYTES.maintenance_admitted);
    add("witness", "original_sealed", 1, NATIVE_BAR_ADMISSION_RECORD_BYTES.original_sealed);
    add("witness", "maintenance_attempt_consumed", 3, NATIVE_BAR_ADMISSION_RECORD_BYTES.maintenance_attempt_consumed);
    add("witness", "coordination_witness", 3, NATIVE_BAR_ADMISSION_RECORD_BYTES.coordination_witness);
    add("witness", "publication_witness", 7 + 14 * v.maintenance_targets, NATIVE_BAR_ADMISSION_RECORD_BYTES.publication_witness);
  }
  const checkpoints = schedule.filter((s) => s.root === "witness").reduce((n, s) => n + s.count, 0);
  add("authority", "checkpoint", checkpoints, 4096);
  const empty = () => ({ entries: 0n, inventory_bytes: 0n, metadata_bytes: 0n, allocated_bytes: 0n });
  const future = { data: empty(), witness: empty(), authority: empty() }, align = (n: bigint) => ((n + 4095n) / 4096n) * 4096n;
  for (const s of schedule) {
    const copies = BigInt(s.count * (1 + s.temporary_slots)), size = BigInt(s.bytes_per_record), r = future[s.root];
    r.entries += copies; r.inventory_bytes += copies * size; r.metadata_bytes += copies * size; r.allocated_bytes += copies * align(size);
  }
  if (v.producer_operations) {
    const count = BigInt(v.producer_operations); future.data.entries += 2n * count;
    future.data.inventory_bytes += count * BigInt(L.payload_bytes + L.receipt_bytes);
    future.data.allocated_bytes += count * (align(BigInt(L.payload_bytes)) + align(BigInt(L.receipt_bytes)));
    future.data.metadata_bytes += count * BigInt(L.receipt_bytes);
  }
  // R-D's bound for the same journal: (4P + 32) slots plus 1 MiB of headroom, also retained as a preallocated reserve.
  const reserve = v.maintenance_targets ? BigInt((4 * (9 + 14 * v.maintenance_targets) + 32) * L.record_bytes + 1048576) : 0n;
  if (reserve) {
    for (const key of ["inventory_bytes", "metadata_bytes", "allocated_bytes"] as const) future.data[key] += 1048576n;
    future.data.entries += 1n; future.data.allocated_bytes += reserve;
  }
  // Worst case: each producer may use its own partition day (captures/receipts) besides its producer directory.
  const directories = (v.producer_operations ? 3 + 3 * v.producer_operations : 0) + (v.maintenance_targets ? 9 : 0);
  future.data.entries += BigInt(directories); future.data.allocated_bytes += BigInt(directories) * 4096n;
  const peak = empty();
  for (const root of roots) {
    const current = v[root];
    if (BigInt(current.metadata_bytes) > BigInt(current.inventory_bytes)
      || (current.entries === "0" && (current.inventory_bytes !== "0" || current.allocated_bytes !== "0"))) reasons.push(`${root}_accounting_inconsistent`);
    for (const key of ["entries", "inventory_bytes", "metadata_bytes", "allocated_bytes"] as const) peak[key] += BigInt(current[key]) + future[root][key];
  }
  // R-D's free-space rule: the new reserve once plus twice every other new allocation, summed per volume.
  const shared = v.free_space.authority === "store_volume";
  const storeNeed = reserve + 2n * (future.data.allocated_bytes - reserve + future.witness.allocated_bytes + (shared ? future.authority.allocated_bytes : 0n));
  const authorityNeed = shared ? 0n : 2n * future.authority.allocated_bytes;
  if (v.free_space.store_volume === null) reasons.push("store_volume_space_unknown");
  else if (BigInt(v.free_space.store_volume) < storeNeed) reasons.push("store_volume_space_insufficient");
  if (!shared && v.free_space.authority === null) reasons.push("authority_space_unknown");
  else if (!shared && BigInt(v.free_space.authority!) < authorityNeed) reasons.push("authority_space_insufficient");
  for (const [key, limit] of [["entries", L.entries], ["inventory_bytes", L.inventory_bytes],
    ["metadata_bytes", L.metadata_bytes], ["allocated_bytes", L.inventory_bytes]] as const)
    if (peak[key] > BigInt(limit)) reasons.push(`${key}_capacity`);
  // Mandatory reads: every metadata byte once, plus a write/readback pair for each written or moved artifact.
  const mandatoryRead = peak.metadata_bytes + BigInt(v.producer_operations) * 2n * BigInt(L.payload_bytes + L.receipt_bytes)
    + BigInt(v.maintenance_targets) * 2n * BigInt(L.payload_bytes);
  const chargedRead = BigInt(v.read_bytes) > mandatoryRead ? BigInt(v.read_bytes) : mandatoryRead;
  if (chargedRead > BigInt(L.read_bytes)) reasons.push("read_capacity");
  if (BigInt(v.response_bytes) > BigInt(L.response_bytes)) reasons.push("response_capacity");
  if (v.roots + 3 > L.roots) reasons.push("root_capacity");
  if (v.live_targets + 2 > 32) reasons.push("target_capacity");
  if (v.descriptors + 48 > L.descriptors) reasons.push("descriptor_capacity");
  const strings = (value: ReturnType<typeof empty>) => Object.fromEntries(Object.entries(value).map(([k, n]) => [k, String(n)])) as Record<keyof ReturnType<typeof empty>, string>;
  return { ...noAuthority, schema: "native-bar-admission-capacity-result-v6" as const, fits: reasons.length === 0, reasons,
    verification_scope: "supplied_budget_only" as const, capacity_reservation: "not_reserved" as const,
    physical_capacity_verified: false as const, reserve_credit_bytes: "0" as const, program: "full_finite_program" as const,
    schedule, future: { data: strings(future.data), witness: strings(future.witness), authority: strings(future.authority) }, peak: strings(peak),
    retained_reserve_bytes: String(reserve), required_available_bytes: { store_volume: String(storeNeed), authority: shared ? "store_volume" : String(authorityNeed) },
    mandatory_read_bytes: String(mandatoryRead), charged_read_bytes: String(chargedRead),
    physical_model: "4096_byte_rounding_not_filesystem_qualification" as const, additional_roots: 3, additional_targets: 2, additional_descriptors: 48 };
}
