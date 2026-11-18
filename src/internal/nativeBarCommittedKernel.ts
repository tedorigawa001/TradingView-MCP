/** Stage 1: supplied canonical records only. No IO, clocks, grants or runtime integration. */
import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { nativeBarReceiptSchema, nativeBarMaintenanceSchema } from "../nativeBarArtifacts.js";
import { nativeBarCaptureSchema, nativeBarId, nativeBarHash, nativeBarTimestamp } from "../nativeBarEvidence.js";

export const COMMITTED_MAINTENANCE_LIMITS = Object.freeze({ input_bytes: 16 * 1024 ** 2,
  record_bytes: 1024 ** 2, output_bytes: 8 * 1024 ** 2, records: 30000,
  pairs: 1024, store_receipts: 1024, depth: 64, nodes_per_record: 262144, work: 4194304 });
export class Rejected extends Error {}
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
export const noAuthority = Object.freeze({ diagnostic_only: true as const, execution_available: false as const,
  recovery_execution_available: false as const, production_qualified: false as const,
  host_approval_authenticated: false as const, native_bytes_verified: false as const,
  history_read_available: false as const, original_acknowledgement: "not_proven" as const });
export function collect(input: unknown, b: CommittedMaintenanceBudget): Buffer[] {
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
export const uuid = nativeBarId.refine(v => v === v.toLowerCase());
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
export const roleSchema = z.enum(["receipt_v1", "payload_v1", "legacy_v1", "legacy_completion_v1", "intent", "manifest", "attempt", "event", "completion"]);
export const inventoryEntrySchema = z.strictObject({ recording_id: uuid, role: z.enum(["receipt", "payload"]),
  location: z.enum(["source", "holding"]), hash: nativeBarHash });
export const headerSchema = z.strictObject({ schema: z.literal("native-bar-committed-input-v3"), policy_hash: nativeBarHash,
  inventory: z.array(inventoryEntrySchema).max(30000), evaluation: z.strictObject({
  evaluation_id: uuid, at: nativeBarTimestamp, journal_hash: nativeBarHash, inventory_hash: nativeBarHash, evidence_hash: nativeBarHash,
  intent_hash: nativeBarHash.nullable(), attempt_hash: nativeBarHash.nullable(),
  clock: z.strictObject({ clock_id: uuid, monotonic_ns: uint }).nullable() }),
  records: z.array(z.strictObject({ index: z.number().int().min(1).max(29999), role: roleSchema, hash: nativeBarHash })).max(29999) });
export type Row = Record<string, any>;
export type RecordRow = { index: number; role: z.infer<typeof roleSchema>; hash: string; bytes: number; nodes: number; value: Row;
  resolved_baseline?: { receipts: Row[]; maintenance: Row[] } };
const legacyDone = z.strictObject({ id: uuid, intent_hash: nativeBarHash });
const proofSchema = z.strictObject({ device: uint, inode: uint, uid: uint, gid: uint, mode: uint, nlink: uint, size: uint,
  flags: uint.refine(v => BigInt(v) <= 4294967295n), birthtime_ns: uint, mtime_ns: uint, ctime_ns: uint,
  acl: z.enum(["none", "deny_only"]), acl_hash: nativeBarHash });
const approvalSchema = z.strictObject({ reference: uuid, plan_hash: nativeBarHash, approved_at: nativeBarTimestamp });
export const bindingSchema = z.strictObject({ root: proofSchema,
  parents: z.array(z.strictObject({ path: z.string().regex(/^(captures|receipts)(\/\d{4}-\d{2}-\d{2})?$/), proof: proofSchema })).max(2050),
  policy_hash: nativeBarHash, backend_profile: z.literal("committed-contract-stage1"), backend_protocol: z.literal(1), baseline_generation: nativeBarHash,
  baseline: z.strictObject({ receipts: z.array(nativeBarReceiptSchema).max(4096),
    maintenance: z.array(z.strictObject({ id: uuid, hash: nativeBarHash })).max(30000) }) });
export const pairSchema = z.strictObject({ recording_id: uuid, sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), receipt_fields: nativeBarReceiptSchema, capture_as_of: nativeBarTimestamp,
  receipt_hash: nativeBarHash, payload_hash: nativeBarHash, recorded_at: nativeBarTimestamp, last_observed_at: nativeBarTimestamp,
  receipt_proof: proofSchema, payload_proof: proofSchema });
export const manifestSchema = z.strictObject({ schema: z.literal("native-bar-committed-manifest-v2"), maintenance_id: uuid,
  chunk_id: uuid, pairs: z.array(pairSchema).min(1).max(1024) });
export const intentSchema = z.strictObject({ schema: z.literal("native-bar-committed-intent-v2"), maintenance_id: uuid,
  kind: z.enum(["prune", "clock_recovery"]), binding: bindingSchema, approval: approvalSchema,
  manifests: z.array(z.strictObject({ chunk_id: uuid, hash: nativeBarHash })).min(1).max(1024), pair_count: z.number().int().min(1).max(1024) });
const role = z.enum(["receipt", "payload"]);
const action = z.enum(["stage", "unlink", "quarantine", "reconcile"]);
export const attemptSchema = z.strictObject({ schema: z.literal("native-bar-committed-attempt-v2"), maintenance_id: uuid, attempt_id: uuid,
  intent_hash: nativeBarHash, approval: approvalSchema, expires_at: nativeBarTimestamp,
  monotonic: z.strictObject({ clock_id: uuid, issued_ns: uint, deadline_ns: uint, observed_ns: uint }),
  resume_after_event_hash: nativeBarHash.nullable(),
  actions: z.array(z.strictObject({ recording_id: uuid, role, action })).max(4096) });
export const eventSchema = z.strictObject({ schema: z.literal("native-bar-committed-event-v2"), maintenance_id: uuid, intent_hash: nativeBarHash,
  attempt_id: uuid, attempt_hash: nativeBarHash, sequence: z.number().int().positive().max(30000), previous_event_hash: nativeBarHash.nullable(),
  recording_id: uuid, role, type: z.enum(["move_pending", "held_verified", "unlink_pending", "purged_verified", "quarantine_move_pending",
    "quarantined_verified", "conflict", "durability_unknown", "reconciled_source", "reconciled_held"]),
  at: nativeBarTimestamp, monotonic_ns: uint, sync: z.enum(["reported_success", "unknown"]),
  evidence: z.strictObject({ proof: proofSchema, sha256: nativeBarHash, from_ns: uint, through_ns: uint,
    source_present: z.boolean(), holding_present: z.boolean(), quarantine_present: z.boolean() }).nullable() });
export const completionSchema = z.strictObject({ schema: z.literal("native-bar-committed-completion-v2"), maintenance_id: uuid, intent_hash: nativeBarHash,
  attempt_id: uuid, attempt_hash: nativeBarHash, last_event_hash: nativeBarHash, completed_at: nativeBarTimestamp, monotonic_ns: uint,
  targets: z.array(z.strictObject({ recording_id: uuid, receipt: z.enum(["purged_verified", "quarantined_verified"]),
    payload: z.enum(["purged_verified", "quarantined_verified"]) })).min(1).max(1024) });
export const schemas: Partial<Record<z.infer<typeof roleSchema>, z.ZodType>> = { receipt_v1: nativeBarReceiptSchema,
  payload_v1: nativeBarCaptureSchema, legacy_v1: nativeBarMaintenanceSchema, legacy_completion_v1: legacyDone,
  intent: intentSchema, manifest: manifestSchema, attempt: attemptSchema, event: eventSchema, completion: completionSchema };
export const blocks = (n: number) => Math.ceil(n / 64);
export function digest(bytes: Uint8Array | string, b: CommittedMaintenanceBudget) {
  b.charge(blocks(typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength));
  return createHash("sha256").update(bytes).digest("hex");
}
export function decode(bytes: Buffer, b: CommittedMaintenanceBudget): { value: Row; nodes: number } {
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
export function encode(value: any, limit: number, b: CommittedMaintenanceBudget): string {
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
export function parse<T>(schema: z.ZodType<T>, r: { value: Row; nodes: number; bytes?: number }, b: CommittedMaintenanceBudget): T {
  // Includes cloned schema output and opaque legacy context-hash/canonical helper passes.
  b.charge(8 * r.nodes + 8 * blocks(r.bytes ?? 0));
  const p = schema.safeParse(r.value);
  if (!p.success) b.stop("invalid_record");
  return p.data;
}
export function freeze(value: any, b: CommittedMaintenanceBudget): any {
  b.charge();
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v, b); Object.freeze(value); }
  return value;
}
