/** Stage 1: supplied canonical records only. No IO, clocks, grants or runtime integration. */
import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { nativeBarReceiptSchema, nativeBarMaintenanceSchema } from "./nativeBarArtifacts.js";
import { nativeBarCaptureSchema, nativeBarId, nativeBarHash, nativeBarTimestamp } from "./nativeBarEvidence.js";

export const COMMITTED_MAINTENANCE_LIMITS = Object.freeze({ input_bytes: 16 * 1024 ** 2,
  record_bytes: 1024 ** 2, output_bytes: 8 * 1024 ** 2, records: 30000,
  pairs: 1024, depth: 64, nodes_per_record: 262144, work: 4194304 });
class Rejected extends Error {}
export class CommittedMaintenanceBudget {
  #work = 0; #stopped: string | null = null;
  charge(n = 1) {
    if (this.#stopped) throw new Rejected(this.#stopped);
    if (!Number.isSafeInteger(n) || n < 0 || this.#work + n > COMMITTED_MAINTENANCE_LIMITS.work) this.stop("work_limit");
    this.#work += n;
  }
  stop(reason: string): never { this.#stopped ??= reason; throw new Rejected(this.#stopped); }
  get used() { return this.#work; }
}
const lengthOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const resizableOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const noAuthority = Object.freeze({ diagnostic_only: true as const, execution_available: false as const,
  recovery_execution_available: false as const, production_qualified: false as const,
  host_approval_authenticated: false as const, native_bytes_verified: false as const,
  history_read_available: false as const, original_acknowledgement: "not_proven" as const });
function collect(input: unknown, b: CommittedMaintenanceBudget): Buffer[] {
  if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) b.stop("input_array");
  const count = Object.getOwnPropertyDescriptor(input, "length")!.value as number;
  if (count < 1 || count > COMMITTED_MAINTENANCE_LIMITS.records) b.stop("record_count_limit");
  const sources: ArrayBuffer[] = []; let total = 0;
  for (let i = 0; i < count; i++) {
    b.charge();
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (!d || !Object.hasOwn(d, "value")) b.stop("input_accessor_or_sparse");
    const value = d.value;
    if (types.isProxy(value)) b.stop("input_buffer");
    let size: number;
    try {
      size = lengthOf.call(value);
      if (Object.getPrototypeOf(value) !== ArrayBuffer.prototype || !resizableOf || resizableOf.call(value)) b.stop("input_buffer");
      new Uint8Array(value); // Brand/attachment check, no user methods.
    } catch { return b.stop("input_buffer"); }
    if (size < 1 || size > COMMITTED_MAINTENANCE_LIMITS.record_bytes) b.stop("record_bytes_limit");
    total += size;
    if (total > COMMITTED_MAINTENANCE_LIMITS.input_bytes) b.stop("input_bytes_limit");
    sources.push(value);
  }
  b.charge(Math.ceil(total / 64)); // Prepay all copies, after every source length was checked.
  b.charge(sources.length);
  return sources.map(source => Buffer.from(new Uint8Array(source)));
}
const uuid = nativeBarId.refine(v => v === v.toLowerCase());
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const roleSchema = z.enum(["receipt_v1", "payload_v1", "legacy_v1", "legacy_completion_v1", "intent", "manifest", "attempt", "event", "completion"]);
const headerSchema = z.strictObject({ schema: z.literal("native-bar-committed-input-v2"), evaluation: z.strictObject({
  evaluation_id: uuid, at: nativeBarTimestamp, journal_hash: nativeBarHash, inventory_hash: nativeBarHash,
  intent_hash: nativeBarHash.nullable(), attempt_hash: nativeBarHash.nullable(),
  clock: z.strictObject({ clock_id: uuid, monotonic_ns: uint }).nullable() }),
  records: z.array(z.strictObject({ index: z.number().int().min(1).max(29999), role: roleSchema, hash: nativeBarHash })).max(29999) });
type Row = Record<string, any>;
type RecordRow = { index: number; role: z.infer<typeof roleSchema>; hash: string; bytes: number; nodes: number; value: Row };
const legacyDone = z.strictObject({ id: uuid, intent_hash: nativeBarHash });
const proofSchema = z.strictObject({ device: uint, inode: uint, uid: uint, gid: uint, mode: uint, nlink: uint, size: uint,
  flags: uint.refine(v => BigInt(v) <= 4294967295n), birthtime_ns: uint, mtime_ns: uint, ctime_ns: uint,
  acl: z.enum(["none", "deny_only"]), acl_hash: nativeBarHash });
const approvalSchema = z.strictObject({ reference: uuid, plan_hash: nativeBarHash, approved_at: nativeBarTimestamp });
const bindingSchema = z.strictObject({ root: proofSchema,
  parents: z.array(z.strictObject({ path: z.string().regex(/^(captures|receipts)(\/\d{4}-\d{2}-\d{2})?$/), proof: proofSchema })).max(2050),
  policy_hash: nativeBarHash, backend_profile: z.literal("committed-contract-stage1"), backend_protocol: z.literal(1), baseline_generation: nativeBarHash,
  baseline: z.strictObject({ receipts: z.array(nativeBarReceiptSchema).max(4096),
    maintenance: z.array(z.strictObject({ id: uuid, hash: nativeBarHash })).max(30000) }) });
const pairSchema = z.strictObject({ recording_id: uuid, sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), receipt_fields: nativeBarReceiptSchema, capture_as_of: nativeBarTimestamp,
  receipt_hash: nativeBarHash, payload_hash: nativeBarHash, recorded_at: nativeBarTimestamp, last_observed_at: nativeBarTimestamp,
  receipt_proof: proofSchema, payload_proof: proofSchema });
const manifestSchema = z.strictObject({ schema: z.literal("native-bar-committed-manifest-v2"), maintenance_id: uuid,
  chunk_id: uuid, pairs: z.array(pairSchema).min(1).max(1024) });
const intentSchema = z.strictObject({ schema: z.literal("native-bar-committed-intent-v2"), maintenance_id: uuid,
  kind: z.enum(["prune", "clock_recovery"]), binding: bindingSchema, approval: approvalSchema,
  manifests: z.array(z.strictObject({ chunk_id: uuid, hash: nativeBarHash })).min(1).max(1024), pair_count: z.number().int().min(1).max(1024) });
const role = z.enum(["receipt", "payload"]);
const action = z.enum(["stage", "unlink", "quarantine", "reconcile"]);
const attemptSchema = z.strictObject({ schema: z.literal("native-bar-committed-attempt-v2"), maintenance_id: uuid, attempt_id: uuid,
  intent_hash: nativeBarHash, approval: approvalSchema, expires_at: nativeBarTimestamp,
  monotonic: z.strictObject({ clock_id: uuid, issued_ns: uint, deadline_ns: uint, observed_ns: uint }),
  resume_after_event_hash: nativeBarHash.nullable(),
  actions: z.array(z.strictObject({ recording_id: uuid, role, action })).max(4096) });
const eventSchema = z.strictObject({ schema: z.literal("native-bar-committed-event-v2"), maintenance_id: uuid, intent_hash: nativeBarHash,
  attempt_id: uuid, attempt_hash: nativeBarHash, sequence: z.number().int().positive().max(30000), previous_event_hash: nativeBarHash.nullable(),
  recording_id: uuid, role, type: z.enum(["move_pending", "held_verified", "unlink_pending", "purged_verified", "quarantine_move_pending",
    "quarantined_verified", "conflict", "durability_unknown", "reconciled_source", "reconciled_held"]),
  at: nativeBarTimestamp, monotonic_ns: uint, sync: z.enum(["reported_success", "unknown"]),
  evidence: z.strictObject({ proof: proofSchema, sha256: nativeBarHash, from_ns: uint, through_ns: uint,
    source_present: z.boolean(), holding_present: z.boolean(), quarantine_present: z.boolean() }).nullable() });
const completionSchema = z.strictObject({ schema: z.literal("native-bar-committed-completion-v2"), maintenance_id: uuid, intent_hash: nativeBarHash,
  attempt_id: uuid, attempt_hash: nativeBarHash, last_event_hash: nativeBarHash, completed_at: nativeBarTimestamp, monotonic_ns: uint,
  targets: z.array(z.strictObject({ recording_id: uuid, receipt: z.enum(["purged_verified", "quarantined_verified"]),
    payload: z.enum(["purged_verified", "quarantined_verified"]) })).min(1).max(1024) });
const schemas: Partial<Record<z.infer<typeof roleSchema>, z.ZodType>> = { receipt_v1: nativeBarReceiptSchema,
  payload_v1: nativeBarCaptureSchema, legacy_v1: nativeBarMaintenanceSchema, legacy_completion_v1: legacyDone,
  intent: intentSchema, manifest: manifestSchema, attempt: attemptSchema, event: eventSchema, completion: completionSchema };
const blocks = (n: number) => Math.ceil(n / 64);
function digest(bytes: Uint8Array | string, b: CommittedMaintenanceBudget) {
  b.charge(blocks(typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength));
  return createHash("sha256").update(bytes).digest("hex");
}
function decode(bytes: Buffer, b: CommittedMaintenanceBudget): { value: Row; nodes: number } {
  b.charge(2 * blocks(bytes.length)); // UTF-8 validation/decode and lexical preflight.
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return b.stop("invalid_utf8"); }
  let nodes = 0, depth = 0, quoted = false, escaped = false, word = false;
  const node = () => { b.charge(); if (++nodes > COMMITTED_MAINTENANCE_LIMITS.nodes_per_record) b.stop("node_limit"); };
  for (const c of text) {
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { node(); quoted = true; word = false; }
    else if (c === "{" || c === "[") { node(); word = false; if (++depth > 64) b.stop("depth_limit"); }
    else if (c === "}" || c === "]") { depth--; word = false; }
    else if (c === "," || c === ":" || /\s/.test(c)) word = false;
    else if (!word) { node(); word = true; }
  }
  b.charge(nodes); // JSON.parse prepaid by preflight nodes, never by a caller's estimate.
  let value: unknown;
  try { value = JSON.parse(text); } catch { return b.stop("invalid_json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) b.stop("record_object_required");
  // Exact comparison also rejects duplicate keys, noncanonical numbers, spacing and key ordering.
  if (encode(value, COMMITTED_MAINTENANCE_LIMITS.record_bytes, b) !== text) b.stop("noncanonical_record");
  return { value: value as Row, nodes };
}
function encode(value: any, limit: number, b: CommittedMaintenanceBudget): string {
  const chunks: string[] = []; let size = 0;
  const append = (s: string) => {
    const n = Buffer.byteLength(s);
    if (size + n > limit) b.stop("encoded_bytes_limit");
    b.charge(Math.max(1, blocks(n))); size += n; chunks.push(s);
  };
  const quoted = (s: string) => {
    b.charge(blocks(s.length * 6 + 2)); // Conservative escaping prepayment, no refunds.
    let n = 2;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) n += 2;
      else if (c < 32) n += 6;
      else if (c < 128) n++;
      else if (c < 2048) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++; }
      else n += c >= 0xd800 && c <= 0xdfff ? 6 : 3;
      if (size + n > limit) b.stop("encoded_bytes_limit");
    }
    append(JSON.stringify(s));
  };
  const visit = (v: any) => {
    b.charge();
    if (typeof v === "string") { quoted(v); return; }
    if (v === null || typeof v === "boolean") { append(JSON.stringify(v)); return; }
    if (typeof v === "number") { if (!Number.isFinite(v)) b.stop("nonfinite_number"); append(JSON.stringify(v)); return; }
    if (Array.isArray(v)) {
      append("["); v.forEach((x, i) => { if (i) append(","); visit(x); }); append("]"); return;
    }
    if (!v || typeof v !== "object") b.stop("non_json");
    append("{");
    const keys = Object.keys(v).sort((a, c) => { b.charge(); return a < c ? -1 : a > c ? 1 : 0; });
    keys.forEach((k, i) => { if (i) append(","); quoted(k); append(":"); visit(v[k]); });
    append("}");
  };
  visit(value); return chunks.join("");
}
function parse<T>(schema: z.ZodType<T>, r: { value: Row; nodes: number; bytes?: number }, b: CommittedMaintenanceBudget): T {
  // Includes cloned schema output and opaque legacy context-hash/canonical helper passes.
  b.charge(8 * r.nodes + 8 * blocks(r.bytes ?? 0));
  const p = schema.safeParse(r.value);
  if (!p.success) b.stop("invalid_record");
  return p.data;
}
function freeze(value: any, b: CommittedMaintenanceBudget): any {
  b.charge();
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v, b); Object.freeze(value); }
  return value;
}
function select(records: RecordRow[], role: RecordRow["role"], b: CommittedMaintenanceBudget) {
  return records.filter(r => { b.charge(); return r.role === role; });
}
type Effects = { prune: { present: boolean; boundary_state: "none" | "known" | "unknown"; greatest_known_recorded_at: string | null };
  clock: { isolated_ids: string[] }; retired_ids: string[] };
function emptyEffects(): Effects { return { prune: { present: false, boundary_state: "none", greatest_known_recorded_at: null }, clock: { isolated_ids: [] }, retired_ids: [] }; }
function addEffect(e: Effects, kind: string, pairs: Row[], b: CommittedMaintenanceBudget) {
  for (const p of pairs) {
    b.charge();
    e.retired_ids.push(p.recording_id);
    if (kind === "clock_recovery") e.clock.isolated_ids.push(p.recording_id);
    else {
      e.prune.present = true;
      if (!p.recorded_at) e.prune.boundary_state = "unknown";
      else {
        if (e.prune.boundary_state === "none") e.prune.boundary_state = "known";
        if (e.prune.greatest_known_recorded_at === null || p.recorded_at > e.prune.greatest_known_recorded_at) e.prune.greatest_known_recorded_at = p.recorded_at;
      }
    }
  }
}
function legacyView(records: RecordRow[], b: CommittedMaintenanceBudget, holds: Set<string>, selected: Set<string>) {
  const receipts = select(records, "receipt_v1", b), payloads = new Map<string, RecordRow>();
  for (const r of select(records, "payload_v1", b)) { b.charge(); if (payloads.has(r.hash)) b.stop("payload_alias"); payloads.set(r.hash, r); }
  const ids = new Set<string>(), sequences = new Set<number>(), referenced = new Set<string>(), policies = new Set<string>();
  const byId = new Map<string, RecordRow>(), legacy = select(records, "legacy_v1", b), done = select(records, "legacy_completion_v1", b);
  const oldById = new Map<string, RecordRow>(), completed = new Set<string>(), retired = new Set<string>();
  const effects = emptyEffects();
  for (const r of legacy) { b.charge(); if (oldById.has(r.value.id)) b.stop("legacy_id_alias"); oldById.set(r.value.id, r); ids.add(r.value.id); }
  for (const d of done) {
    b.charge();
    if (completed.has(d.value.id) || oldById.get(d.value.id)?.hash !== d.value.intent_hash) b.stop("legacy_completion_binding");
    completed.add(d.value.id);
  }
  for (const r of legacy) {
    b.charge();
    for (const p of r.value.pairs) { b.charge(); if (retired.has(p.recording_id) || oldById.has(p.recording_id)) b.stop("maintenance_target_overlap"); retired.add(p.recording_id); }
    if (completed.has(r.value.id)) addEffect(effects, r.value.kind, r.value.pairs, b);
  }
  if (completed.size !== legacy.length) holds.add("legacy_unverifiable");
  if (receipts.length > COMMITTED_MAINTENANCE_LIMITS.pairs) b.stop("pair_limit");
  receipts.sort((a, c) => { b.charge(); return a.value.sequence - c.value.sequence; });
  let previousAt: string | null = null;
  for (const r of receipts) {
    b.charge(); const receipt = r.value, payload = payloads.get(receipt.payload_hash)?.value;
    if (ids.has(receipt.recording_id) || sequences.has(receipt.sequence) || receipt.day !== (receipt.partition_at ?? receipt.recorded_at).slice(0, 10)
      || receipt.partition_at && receipt.partition_at > receipt.recorded_at) b.stop("v1_binding");
    ids.add(receipt.recording_id); sequences.add(receipt.sequence); byId.set(receipt.recording_id, r); referenced.add(receipt.payload_hash);
    if (retired.has(receipt.recording_id)) continue;
    policies.add(receipt.policy_hash);
    if (payload) {
      for (const s of payload.series) { b.charge(); if (s.observed_at > receipt.recorded_at) b.stop("v1_binding"); }
      if (previousAt !== null && previousAt > payload.capture_as_of) b.stop("v1_binding");
    } else if (!selected.has(receipt.recording_id)) holds.add("source_evidence_missing");
    previousAt = receipt.recorded_at;
  }
  for (const id of retired) { b.charge(); ids.add(id); }
  if (policies.size > 1) b.stop("v1_policy_binding");
  // Payload-only evidence is legitimate when the paired receipt has already been purged.
  return { receipts, payloads, byId, referenced, legacy, oldById, retired, effects, ids };
}
function transactionView(records: RecordRow[], evaluation: Row, legacy: ReturnType<typeof legacyView>, b: CommittedMaintenanceBudget, holds: Set<string>) {
  const intents = select(records, "intent", b), manifests = select(records, "manifest", b);
  if (!intents.length) {
    if (records.some(r => { b.charge(); return ["manifest", "attempt", "event", "completion"].includes(r.role); })) b.stop("orphan_transaction_record");
    for (const p of legacy.payloads.values()) { b.charge(); if (!legacy.referenced.has(p.hash)) b.stop("unreferenced_payload"); }
    if (legacy.ids.has(evaluation.evaluation_id)) b.stop("evaluation_id_alias");
    return { completed: true, pairs: [] as Row[], approval_time_only: false, unconfirmed_completions: [] as Row[] };
  }
  if (intents.length !== 1) b.stop("intent_count");
  const intent = intents[0], iv = intent.value, binding = iv.binding;
  if (iv.manifests.length !== manifests.length) b.stop("manifest_set");
  const byChunk = new Map<string, RecordRow>();
  for (const m of manifests) { b.charge(); if (byChunk.has(m.value.chunk_id)) b.stop("manifest_binding"); byChunk.set(m.value.chunk_id, m); }
  b.charge(legacy.ids.size);
  const ids = new Set<string>(legacy.ids), snapshot = new Map<string, { value: Row; hash: string; previous_recorded_at: string | null }>(), snapshotSequences = new Map<number, string>();
  let previousSequence = 0, previousRecordedAt = "";
  for (const r of binding.baseline.receipts) {
    b.charge();
    if (snapshot.has(r.recording_id) || snapshotSequences.has(r.sequence) || r.sequence <= previousSequence || legacy.oldById.has(r.recording_id) ||
      r.policy_hash !== binding.policy_hash || r.recorded_at < previousRecordedAt || r.day !== (r.partition_at ?? r.recorded_at).slice(0,10) || r.partition_at && r.partition_at > r.recorded_at) b.stop("baseline_receipt_binding");
    b.charge(); const payload = legacy.payloads.get(r.payload_hash);
    if (payload && previousRecordedAt && payload.value.capture_as_of < previousRecordedAt) b.stop("baseline_observation_order");
    const hash = digest(encode(r, COMMITTED_MAINTENANCE_LIMITS.record_bytes, b), b);
    snapshot.set(r.recording_id, { value: r, hash, previous_recorded_at: previousRecordedAt || null }); snapshotSequences.set(r.sequence,r.recording_id);
    previousSequence = r.sequence; previousRecordedAt = r.recorded_at; ids.add(r.recording_id);
    const current = legacy.byId.get(r.recording_id);
    if (current && current.hash !== hash) b.stop("baseline_receipt_binding");
  }
  for (const r of legacy.receipts) { b.charge(); if (snapshotSequences.has(r.value.sequence) && snapshotSequences.get(r.value.sequence) !== r.value.recording_id) b.stop("baseline_sequence_binding"); }
  const prior = new Set<string>(), priorRetired = new Set<string>();
  for (const m of binding.baseline.maintenance) {
    b.charge(); if (prior.has(m.id) || legacy.oldById.get(m.id)?.hash !== m.hash) b.stop("baseline_maintenance_binding"); prior.add(m.id);
    for (const p of legacy.oldById.get(m.id)!.value.pairs) { b.charge(); priorRetired.add(p.recording_id); }
  }
  for (const r of binding.baseline.receipts) {
    b.charge();
    if (priorRetired.has(r.recording_id)) b.stop("baseline_retired_target");
  }
  if (binding.baseline_generation !== digest(encode(binding.baseline, COMMITTED_MAINTENANCE_LIMITS.input_bytes, b), b)) b.stop("baseline_generation");
  if (ids.has(iv.maintenance_id) || ids.has(iv.approval.reference) || iv.maintenance_id === iv.approval.reference) b.stop("transaction_id_alias");
  ids.add(iv.maintenance_id);
  const pairs: Row[] = [], selectedIds = new Set<string>(), objectIds = new Set<string>();
  const privateProof = (proof: Row, dir: boolean) => {
    b.charge();
    if (proof.mode !== (dir ? "16832" : "33152") || !dir && proof.nlink !== "1" || proof.device !== binding.root.device || proof.uid !== binding.root.uid || proof.gid !== binding.root.gid) b.stop("object_access_binding");
    const key = `${proof.device}:${proof.inode}`;
    if (objectIds.has(key)) b.stop("object_alias"); objectIds.add(key);
  };
  privateProof(binding.root, true);
  const parents = new Set<string>();
  for (const p of binding.parents) { b.charge(); if (parents.has(p.path)) b.stop("parent_alias"); parents.add(p.path); privateProof(p.proof, true); }
  const needed = new Set<string>(), sequences = new Set<number>();
  for (const mr of iv.manifests) {
    b.charge(); const m = byChunk.get(mr.chunk_id);
    if (!m || m.hash !== mr.hash || m.value.maintenance_id !== iv.maintenance_id || ids.has(mr.chunk_id) || mr.chunk_id === iv.approval.reference) b.stop("manifest_binding");
    ids.add(mr.chunk_id);
    for (const p of m.value.pairs) {
      b.charge();
      if (pairs.length >= COMMITTED_MAINTENANCE_LIMITS.pairs) b.stop("pair_limit");
      if (selectedIds.has(p.recording_id) || sequences.has(p.sequence)) b.stop("pair_alias");
      if (legacy.retired.has(p.recording_id)) b.stop("retired_target");
      selectedIds.add(p.recording_id); sequences.add(p.sequence);
      const original = snapshot.get(p.recording_id), rv = p.receipt_fields;
      if (original && original.previous_recorded_at !== null && p.capture_as_of < original.previous_recorded_at) b.stop("baseline_observation_order");
      const receiptText = encode(rv, COMMITTED_MAINTENANCE_LIMITS.record_bytes, b), receiptHash = digest(receiptText, b);
      if (!original || original.hash !== p.receipt_hash || receiptHash !== p.receipt_hash || rv.recording_id !== p.recording_id || rv.sequence !== p.sequence || rv.day !== p.day ||
        rv.day !== (rv.partition_at ?? rv.recorded_at).slice(0, 10) || rv.partition_at && rv.partition_at > rv.recorded_at || rv.policy_hash !== binding.policy_hash ||
        rv.payload_hash !== p.payload_hash || rv.recorded_at !== p.recorded_at || p.last_observed_at > p.recorded_at || p.capture_as_of > p.last_observed_at ||
        BigInt(p.payload_proof.size) < 1n || BigInt(p.payload_proof.size) > BigInt(COMMITTED_MAINTENANCE_LIMITS.record_bytes) ||
        p.receipt_proof.size !== String(Buffer.byteLength(receiptText))) b.stop("pair_evidence_binding");
      const payload = legacy.payloads.get(p.payload_hash);
      if (payload) {
        b.charge(); let latest = "";
        for (const s of payload.value.series) { b.charge(); if (s.observed_at > latest) latest = s.observed_at; }
        if (payload.bytes !== Number(p.payload_proof.size) || latest !== p.last_observed_at || payload.value.capture_as_of !== p.capture_as_of) b.stop("pair_evidence_binding");
      }
      legacy.referenced.add(p.payload_hash);
      privateProof(p.receipt_proof, false); privateProof(p.payload_proof, false);
      for (const area of ["captures", "receipts"]) { b.charge(); needed.add(area); needed.add(`${area}/${p.day}`); }
      const stamp = Math.max(Date.parse(p.recorded_at), Date.parse(p.last_observed_at)), approved = Date.parse(iv.approval.approved_at);
      if (iv.kind === "prune" ? stamp >= approved - 90 * 86400000 : stamp <= approved + 60000) b.stop("original_eligibility");
      pairs.push({ ...p, receipt: "source", payload: "source", stamp });
    }
  }
  if (pairs.length !== iv.pair_count || needed.size !== parents.size || [...needed].some(p => { b.charge(); return !parents.has(p); })) b.stop("target_scope_binding");
  for (const p of legacy.payloads.values()) { b.charge(); if (!legacy.referenced.has(p.hash)) b.stop("unreferenced_payload"); }
  if (ids.has(evaluation.evaluation_id) || evaluation.evaluation_id === iv.approval.reference) b.stop("evaluation_id_alias"); ids.add(evaluation.evaluation_id);
  const transactionHolds = new Set<string>();
  const view = replay(records, iv, intent.hash, pairs, ids, evaluation, b, transactionHolds);
  for (const p of pairs) for (const r of ["receipt", "payload"]) {
    b.charge(); const present = r === "receipt" ? legacy.byId.has(p.recording_id) : legacy.payloads.has(p.payload_hash);
    if (!present && p[r] !== "purged_verified") transactionHolds.add(p[r] === "unlink_pending" ? "unlink_outcome_unknown" : "source_evidence_missing");
  }
  const targetIds = new Set(pairs.map(p => { b.charge(); return p.recording_id; }));
  for (const [id] of snapshot) { b.charge(); if (!targetIds.has(id) && !legacy.byId.has(id) && !legacy.retired.has(id)) transactionHolds.add("baseline_source_missing"); }
  if (!view.completed) {
    for (const r of legacy.receipts) { b.charge(); if (!legacy.retired.has(r.value.recording_id) && !snapshot.has(r.value.recording_id)) transactionHolds.add("current_baseline_changed"); }
    if (prior.size !== legacy.legacy.length) transactionHolds.add("current_baseline_changed");
  }
  for (const r of legacy.receipts) {
    b.charge(); if (legacy.retired.has(r.value.recording_id)) continue;
    if (r.value.policy_hash !== binding.policy_hash) b.stop("v1_policy_binding");
    if (view.completed && !snapshot.has(r.value.recording_id)) {
      if (r.value.sequence <= previousSequence) b.stop("baseline_sequence_binding");
      const payload = legacy.payloads.get(r.value.payload_hash);
      if (payload && payload.value.capture_as_of < previousRecordedAt) b.stop("post_completion_order");
    }
  }
  const unconfirmedCompletions: Row[] = [];
  if (view.completed) {
    if (transactionHolds.size) {
      const effects = emptyEffects(); addEffect(effects, iv.kind, pairs, b);
      unconfirmedCompletions.push({ maintenance_id: iv.maintenance_id, kind: iv.kind, evidence_status: "unresolved", blockers: [...transactionHolds], effects });
    } else addEffect(legacy.effects, iv.kind, pairs, b);
  }
  for (const reason of transactionHolds) { b.charge(); holds.add(reason); }
  return { ...view, unconfirmed_completions: unconfirmedCompletions };
}

function replay(records: RecordRow[], intent: Row, intentHash: string, pairs: Row[], ids: Set<string>, evaluation: Row, b: CommittedMaintenanceBudget, holds: Set<string>) {
  const evaluationAt = evaluation.at;
  const terminal = intent.kind === "prune" ? "purged_verified" : "quarantined_verified";
  const byId = new Map(pairs.map(p => { b.charge(); return [p.recording_id, p]; }));
  const pendingOwner = new Map<string, string>(), ctimes = new Map<string, bigint>();
  const approvalRefs = new Set<string>(), approvalHashes = new Set<string>(), clockIds = new Set<string>();
  const clockTicks = new Map<string, bigint>();
  let active: RecordRow | null = null, lastHash: string | null = null, sequence = 0, lastAt: string | null = null;
  let lastTick = 0n, conflict = false, uncertain = false, completed = false;
  let permissions = new Set<string>();
  const key = (id: string, r: string, a: string) => `${id}|${r}|${a}`;
  const required = () => {
    const set = new Set<string>();
    for (const p of pairs) for (const r of ["receipt", "payload"]) {
      b.charge(); const s = p[r];
      const actions = uncertain || s.endsWith("_pending") ? ["reconcile"] : s === "source" ? ["stage", intent.kind === "prune" ? "unlink" : "quarantine"]
        : s === "held_verified" ? [intent.kind === "prune" ? "unlink" : "quarantine"] : [];
      for (const a of actions) { b.charge(); set.add(key(p.recording_id, r, a)); }
    }
    return set;
  };
  const use = (p: Row, r: string, a: string) => {
    b.charge();
    if (!permissions.delete(key(p.recording_id, r, a))) b.stop("action_not_approved");
  };
  const evidence = (event: Row, p: Row, place: "source" | "holding" | "quarantine" | "absent") => {
    const e = event.evidence, original = p[`${event.role}_proof`], k = key(p.recording_id, event.role, "proof");
    if (!e || e.sha256 !== p[`${event.role}_hash`]) b.stop("event_proof");
    for (const field of Object.keys(original)) {
      b.charge();
      if (!["ctime_ns", "nlink"].includes(field) && e.proof[field] !== original[field]) b.stop("event_proof");
    }
    const ctime = BigInt(e.proof.ctime_ns);
    if (e.proof.nlink !== (place === "absent" ? "0" : "1") || ctime < (ctimes.get(k) ?? BigInt(original.ctime_ns)) ||
      BigInt(e.from_ns) > ctime || ctime > BigInt(e.through_ns) ||
      e.source_present !== (place === "source") || e.holding_present !== (place === "holding") || e.quarantine_present !== (place === "quarantine")) b.stop("event_proof");
    ctimes.set(k, ctime);
  };
  for (const row of records) {
    b.charge();
    if (!["attempt", "event", "completion"].includes(row.role)) continue;
    const v = row.value;
    if (completed || conflict) b.stop(completed ? "after_completion" : "conflict_terminal");
    if (v.maintenance_id !== intent.maintenance_id || v.intent_hash !== intentHash) b.stop("transaction_binding");
    if (row.role === "attempt") {
      if (ids.has(v.attempt_id) || approvalRefs.has(v.approval.reference) || approvalHashes.has(v.approval.plan_hash) ||
        ids.has(v.approval.reference) || (ids.has(v.monotonic.clock_id) && !clockIds.has(v.monotonic.clock_id)) ||
        new Set([v.attempt_id, v.approval.reference, v.monotonic.clock_id]).size !== 3) b.stop("attempt_alias_or_replay");
      if (v.resume_after_event_hash !== lastHash || !active && (v.approval.reference !== intent.approval.reference ||
        v.approval.plan_hash !== intent.approval.plan_hash || v.approval.approved_at !== intent.approval.approved_at)) b.stop("approval_binding");
      const duration = Date.parse(v.expires_at) - Date.parse(v.approval.approved_at), ticks = BigInt(v.monotonic.deadline_ns) - BigInt(v.monotonic.issued_ns);
      if (duration <= 0 || duration > 600000 || ticks <= 0n || ticks > 600000000000n || BigInt(v.monotonic.observed_ns) < BigInt(v.monotonic.issued_ns)) b.stop("attempt_window");
      if (BigInt(v.monotonic.issued_ns) < (clockTicks.get(v.monotonic.clock_id) ?? 0n)) b.stop("clock_regression");
      const expected = required(), supplied = new Set<string>();
      for (const a of v.actions) { b.charge(); const k = key(a.recording_id, a.role, a.action); if (supplied.has(k) || !expected.has(k)) b.stop("remaining_action_scope"); supplied.add(k); }
      if (supplied.size !== expected.size) b.stop("remaining_action_scope");
      ids.add(v.attempt_id); ids.add(v.approval.reference); ids.add(v.monotonic.clock_id); clockIds.add(v.monotonic.clock_id);
      approvalRefs.add(v.approval.reference); approvalHashes.add(v.approval.plan_hash);
      active = row; permissions = supplied; lastTick = BigInt(v.monotonic.observed_ns);
      clockTicks.set(v.monotonic.clock_id, lastTick);
      continue;
    }
    if (!active || v.attempt_id !== active.value.attempt_id || v.attempt_hash !== active.hash) b.stop("attempt_binding");
    const a = active.value, at = row.role === "event" ? v.at : v.completed_at;
    if (at < a.approval.approved_at || at >= a.expires_at || lastAt !== null && at < lastAt) b.stop("event_window");
    if (at > evaluationAt) holds.add("evaluation_before_event");
    const tick = BigInt(v.monotonic_ns);
    if (tick < lastTick || tick < BigInt(a.monotonic.issued_ns) || tick >= BigInt(a.monotonic.deadline_ns)) b.stop("event_window");
    lastTick = tick; lastAt = at;
    clockTicks.set(a.monotonic.clock_id, tick);
    if (row.role === "completion") {
      if (!lastHash || v.last_event_hash !== lastHash || v.targets.length !== pairs.length || uncertain) b.stop("incomplete_completion");
      const seen = new Set();
      for (const t of v.targets) {
        b.charge(); const p = byId.get(t.recording_id);
        if (!p || seen.has(t.recording_id) || [p.receipt, p.payload, t.receipt, t.payload].some(x => x !== terminal)) b.stop("incomplete_completion");
        seen.add(t.recording_id);
      }
      completed = true; continue;
    }
    if (v.sequence !== sequence + 1 || v.previous_event_hash !== lastHash || !byId.has(v.recording_id)) b.stop("event_chain");
    if (v.sync !== (v.type === "durability_unknown" ? "unknown" : "reported_success")) b.stop("sync_outcome");
    const p = byId.get(v.recording_id)!, r = v.role, current = p[r], k = key(p.recording_id, r, "pending");
    const reconcile = () => { if (pendingOwner.get(k) !== a.attempt_id || uncertain) use(p, r, "reconcile"); };
    if (v.type === "conflict") { if (v.evidence !== null) b.stop("unexpected_evidence"); conflict = true; }
    else if (v.type === "durability_unknown") { if (v.evidence !== null) b.stop("unexpected_evidence"); uncertain = true; }
    else if (v.type === "move_pending") {
      if (current !== "source" || uncertain || v.evidence !== null) b.stop("invalid_transition");
      if (intent.kind === "prune" && p.stamp >= Math.min(Date.parse(intent.approval.approved_at), Date.parse(a.approval.approved_at), Date.parse(at)) - 90 * 86400000) b.stop("action_eligibility");
      use(p, r, "stage"); p[r] = v.type; pendingOwner.set(k, a.attempt_id);
    } else if (v.type === "held_verified") {
      if (current !== "move_pending") b.stop("invalid_transition");
      reconcile(); evidence(v, p, "holding"); p[r] = v.type;
    } else if (v.type === "unlink_pending" || v.type === "quarantine_move_pending") {
      const targetAction = v.type === "unlink_pending" ? "unlink" : "quarantine";
      if (targetAction !== (intent.kind === "prune" ? "unlink" : "quarantine") || current !== "held_verified" || uncertain || v.evidence !== null ||
        !["held_verified", terminal].includes(p.receipt) || !["held_verified", terminal].includes(p.payload)) b.stop("invalid_transition");
      if (intent.kind === "prune" && p.stamp >= Math.min(Date.parse(intent.approval.approved_at), Date.parse(a.approval.approved_at), Date.parse(at)) - 90 * 86400000) b.stop("action_eligibility");
      use(p, r, targetAction); p[r] = v.type; pendingOwner.set(k, a.attempt_id);
    } else if (v.type === "purged_verified" || v.type === "quarantined_verified") {
      if (v.type !== terminal || current !== (intent.kind === "prune" ? "unlink_pending" : "quarantine_move_pending")) b.stop("invalid_transition");
      if (v.type === "purged_verified" && pendingOwner.get(k) !== a.attempt_id) holds.add("unlink_outcome_unknown");
      reconcile(); evidence(v, p, intent.kind === "prune" ? "absent" : "quarantine"); p[r] = v.type;
    } else {
      if (!["reconciled_source", "reconciled_held"].includes(v.type) || pendingOwner.get(k) === a.attempt_id && !uncertain ||
        !(v.type === "reconciled_source" ? ["source", "move_pending"] : ["move_pending", "held_verified", "unlink_pending", "quarantine_move_pending"]).includes(current)) b.stop("invalid_reconciliation");
      use(p, r, "reconcile"); evidence(v, p, v.type === "reconciled_source" ? "source" : "holding"); p[r] = v.type === "reconciled_source" ? "source" : "held_verified";
    }
    sequence = v.sequence; lastHash = row.hash;
  }
  if (conflict) holds.add("conflict");
  if (uncertain) holds.add("durability_unknown");
  if (active) {
    if (!completed && (evaluationAt < active.value.approval.approved_at || evaluationAt >= active.value.expires_at)) holds.add("attempt_expired_or_clock_rollback");
    const clock = evaluation.clock;
    if (!clock || clock.clock_id !== active.value.monotonic.clock_id) { if (!completed) holds.add("evaluation_clock_unverified"); }
    else {
      const now = BigInt(clock.monotonic_ns);
      if (now < lastTick) holds.add("evaluation_clock_regression");
      if (!completed && now >= BigInt(active.value.monotonic.deadline_ns)) holds.add("attempt_expired_or_clock_rollback");
    }
  }
  if (!completed && intent.kind === "prune" && pairs.some(p => { b.charge(); return p.stamp >= Math.min(Date.parse(intent.approval.approved_at), Date.parse(evaluationAt)) - 90 * 86400000; })) holds.add("current_eligibility");
  return { completed, approval_time_only: intent.kind === "clock_recovery" && pairs.every(p => { b.charge(); return p.stamp <= Date.parse(evaluationAt) + 60000; }),
    pairs: pairs.map(p => { b.charge(); return { recording_id: p.recording_id, receipt: p.receipt, payload: p.payload }; }) };
}
export function inspectCommittedMaintenance(input: unknown) {
  const b = new CommittedMaintenanceBudget(), holds = new Set<string>();
  let diagnosticEffects: Effects | null = null;
  try {
    b.charge(256); // Bounded terminal diagnostic/statistics reserve; no history on failure.
    const bytes = collect(input, b), head = decode(bytes[0], b);
    if (head.value.schema === "native-bar-committed-input-v1") b.stop("unsupported_input_version");
    const header = parse(headerSchema, { ...head, bytes: bytes[0].length }, b);
    if (header.records.length !== bytes.length - 1) b.stop("record_directory");
    const records: RecordRow[] = [];
    for (let i = 0; i < header.records.length; i++) {
      b.charge(); const d = header.records[i];
      if (d.index !== i + 1) b.stop("record_directory");
      const raw = bytes[i + 1], sha = digest(raw, b);
      if (sha !== d.hash) b.stop("record_hash");
      const decoded = decode(raw, b), r = { ...decoded, index: i + 1, role: d.role, hash: sha, bytes: raw.length };
      const schema = schemas[r.role];
      if (!schema) b.stop("unsupported_role");
      r.value = parse(schema as z.ZodType<Row>, r, b); records.push(r);
    }
    const journal: Row[] = [], inventory: Row[] = [], selected = new Set<string>();
    let intentHash: string | null = null, attemptHash: string | null = null;
    for (const r of records) {
      b.charge();
      (r.role === "receipt_v1" || r.role === "payload_v1" ? inventory : journal).push({ role: r.role, hash: r.hash });
      if (r.role === "intent") intentHash = r.hash;
      if (r.role === "attempt") attemptHash = r.hash;
      if (r.role === "manifest") for (const p of r.value.pairs) { b.charge(); selected.add(p.recording_id); }
    }
    inventory.sort((a, c) => { b.charge(); return a.hash < c.hash ? -1 : a.hash > c.hash ? 1 : a.role < c.role ? -1 : a.role > c.role ? 1 : 0; });
    const e = header.evaluation;
    if (e.journal_hash !== digest(encode(journal, COMMITTED_MAINTENANCE_LIMITS.input_bytes, b), b) ||
      e.inventory_hash !== digest(encode(inventory, COMMITTED_MAINTENANCE_LIMITS.input_bytes, b), b) ||
      e.intent_hash !== intentHash || e.attempt_hash !== attemptHash) b.stop("evaluation_snapshot_binding");
    const legacy = legacyView(records, b, holds, selected);
    // Preserve a bounded frozen copy of previously checked effects even if the new transaction refuses.
    b.charge(legacy.effects.clock.isolated_ids.length + legacy.effects.retired_ids.length);
    const copy = { prune: { ...legacy.effects.prune }, clock: { isolated_ids: [...legacy.effects.clock.isolated_ids] }, retired_ids: [...legacy.effects.retired_ids] };
    freeze(copy, b); encode(copy, COMMITTED_MAINTENANCE_LIMITS.output_bytes - 2048, b); diagnosticEffects = copy;
    const view = transactionView(records, e, legacy, b, holds);
    const blockers = [...holds]; if (!view.completed) blockers.push("transaction_incomplete");
    const blocked = blockers.length !== 0, effects = legacy.effects;
    const result = { schema: "native-bar-committed-result-v2", ...noAuthority, status: holds.size ? "held" : "consistent", reason: [...holds][0] ?? null,
      effects, effects_status: "evaluated", remaining_effects_unknown: view.unconfirmed_completions.length !== 0,
      unconfirmed_completions: view.unconfirmed_completions,
      adoption: { state: blocked ? "blocked" : "conditional", blockers },
      read_effect: blocked ? "blocked" : effects.prune.present && effects.clock.isolated_ids.length ? "combined_conditionally" : effects.prune.present
        ? "apply_prune_boundary_conditionally" : effects.clock.isolated_ids.length ? "exclude_clock_quarantine_conditionally" : "unchanged_conditionally",
      prune_boundary: effects.prune.boundary_state === "known" ? effects.prune.greatest_known_recorded_at : null,
      approval_time_only: view.approval_time_only, pairs: view.pairs };
    freeze(result, b); encode(result, COMMITTED_MAINTENANCE_LIMITS.output_bytes - 64, b);
    return Object.freeze({ ...result, work_charged: b.used });
  } catch (error) {
    const reason = error instanceof Rejected ? error.message : "invalid_input";
    return Object.freeze({ schema: "native-bar-committed-result-v2", ...noAuthority, status: "rejected", reason,
      effects: diagnosticEffects, effects_status: diagnosticEffects ? "partial" : "not_evaluated", remaining_effects_unknown: true,
      unconfirmed_completions: Object.freeze([]),
      adoption: Object.freeze({ state: "blocked", blockers: Object.freeze([reason]) }),
      read_effect: "blocked", pairs: Object.freeze([]), work_charged: b.used });
  }
}
