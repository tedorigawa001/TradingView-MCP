/** Stage-A diagnostic connection only. Fixed old limits; no IO, profile switch or runtime integration. */
import { z } from "zod";
import { nativeBarReceiptSchema } from "../nativeBarArtifacts.js";
import { nativeBarHash } from "../nativeBarEvidence.js";
import { COMMITTED_MAINTENANCE_LIMITS as LIMITS, CommittedMaintenanceBudget, collect, decode, digest, encode, parse,
  uuid, headerSchema, inventoryEntrySchema, bindingSchema, intentSchema, manifestSchema, attemptSchema, eventSchema, completionSchema,
  schemas, type Row, type RecordRow } from "./nativeBarCommittedKernel.js";
import { verifyCommittedLogical, rejectCommittedLogical } from "./nativeBarCommittedSemantic.js";

const kinds = ["baseline_maintenance", "baseline_receipts", "directory", "inventory"] as const;
type Kind = typeof kinds[number];
const kindSchema = z.enum(kinds), count = z.number().int().min(0).max(LIMITS.records - 1);
const baselineCollectionRef = z.strictObject({ commitment: nativeBarHash, count });
const pagedBinding = bindingSchema.omit({ baseline: true }).extend({ backend_profile: z.literal("committed-contract-paged-stage-a"),
  backend_protocol: z.literal(2), baseline_ref: z.strictObject({ receipts: baselineCollectionRef, maintenance: baselineCollectionRef }) });
export const newSchemas = {
  intent: intentSchema.extend({ schema: z.literal("native-bar-committed-intent-v3"), binding: pagedBinding, manifest_commitment: nativeBarHash }),
  manifest: manifestSchema.extend({ schema: z.literal("native-bar-committed-manifest-v3"), pairs: manifestSchema.shape.pairs.max(64),
    ordinal: count, total_pages: z.number().int().min(1).max(LIMITS.pairs), collection_commitment: nativeBarHash }),
  attempt: attemptSchema.extend({ schema: z.literal("native-bar-committed-attempt-v3") }),
  event: eventSchema.extend({ schema: z.literal("native-bar-committed-event-v3") }),
  completion: completionSchema.extend({ schema: z.literal("native-bar-committed-completion-v3") }),
};
export const rowSchemas = { baseline_maintenance: z.strictObject({ id: uuid, hash: nativeBarHash }), baseline_receipts: nativeBarReceiptSchema,
  directory: headerSchema.shape.records.element, inventory: inventoryEntrySchema };
const refSchema = z.strictObject({ index: count, kind: kindSchema, ordinal: count, total_pages: count,
  entry_count: z.number().int().min(1).max(512), hash: nativeBarHash });
export const rootSchema = z.strictObject({ schema: z.literal("native-bar-committed-input-v4"), snapshot_generation: nativeBarHash,
  snapshot: z.strictObject({ policy_hash: nativeBarHash, baseline_generation: nativeBarHash.nullable(), manifest_commitment: nativeBarHash,
    evaluation: headerSchema.shape.evaluation, collections: z.array(z.strictObject({ kind: kindSchema, commitment: nativeBarHash, total_entries: count })).length(4),
    pages: z.array(refSchema).max(LIMITS.records - 1) }) });

export function inspectCommittedPagedMaintenanceStageA(input: unknown) {
  const b = new CommittedMaintenanceBudget();
  try {
    b.charge(256);
    const bytes = collect(input, b), head = decode(bytes[0], b), root = parse(rootSchema, { ...head, bytes: bytes[0].length }, b), s = root.snapshot;
    if (digest(encode(s, LIMITS.record_bytes, b), b) !== root.snapshot_generation) b.stop("page_snapshot_binding");
    const rows: Record<Kind, Row[]> = { baseline_maintenance: [], baseline_receipts: [], directory: [], inventory: [] };
    const totals = new Map<Kind, number>(), pageCounts = new Map<Kind, number>();
    for (let i = 0; i < kinds.length; i++) { b.charge(); if (s.collections[i].kind !== kinds[i]) b.stop("page_collection_order"); }
    let lastKind = -1, ordinal = -1;
    for (let i = 0; i < s.pages.length; i++) {
      b.charge(); const ref = s.pages[i], rank = kinds.indexOf(ref.kind);
      if (ref.index !== i + 1 || ref.index >= bytes.length || rank < lastKind || ref.ordinal !== (rank === lastKind ? ordinal + 1 : 0)) b.stop("page_order");
      lastKind = rank; ordinal = ref.ordinal;
      if (digest(bytes[ref.index], b) !== ref.hash) b.stop("page_hash");
      const decoded = decode(bytes[ref.index], b);
      const schema = z.strictObject({ schema: z.literal("native-bar-committed-page-v1"), kind: z.literal(ref.kind), commitment: nativeBarHash,
        ordinal: count, total_pages: count, entries: z.array(rowSchemas[ref.kind]).min(1).max(512) });
      const page = parse(schema, { ...decoded, bytes: bytes[ref.index].length }, b);
      if (page.commitment !== s.collections[rank].commitment || page.ordinal !== ref.ordinal || page.total_pages !== ref.total_pages ||
        page.entries.length !== ref.entry_count || ref.total_pages < 1 || ref.ordinal >= ref.total_pages ||
        totals.has(ref.kind) && totals.get(ref.kind) !== ref.total_pages) b.stop("page_collection_binding");
      if (ref.kind === "baseline_receipts" && rows[ref.kind].length + page.entries.length > LIMITS.store_receipts) b.stop("store_receipt_limit");
      totals.set(ref.kind, ref.total_pages); pageCounts.set(ref.kind, (pageCounts.get(ref.kind) ?? 0) + 1);
      b.charge(page.entries.length); rows[ref.kind].push(...page.entries);
    }
    for (let i = 0; i < kinds.length; i++) {
      b.charge(); const kind = kinds[i], c = s.collections[i];
      if (rows[kind].length !== c.total_entries || (totals.get(kind) ?? 0) !== (pageCounts.get(kind) ?? 0)) b.stop("page_collection_count");
      if (digest(encode({ schema: "native-bar-committed-collection-v1", kind, entries: rows[kind] }, LIMITS.input_bytes, b), b) !== c.commitment)
        b.stop("page_collection_commitment");
    }
    let inventoryKey = "", activeReceipts = 0;
    for (const entry of rows.inventory) {
      b.charge(); const key = encode(entry, LIMITS.record_bytes, b);
      if (key <= inventoryKey) b.stop("paged_inventory_order"); inventoryKey = key;
      if (entry.role === "receipt" && entry.location === "source" && ++activeReceipts > LIMITS.store_receipts) b.stop("store_receipt_limit");
    }
    if (rows.directory.length + s.pages.length + 1 !== bytes.length) b.stop("page_record_directory");
    const records: RecordRow[] = [], pairs: Row[] = [];
    for (let i = 0; i < rows.directory.length; i++) {
      b.charge(); const d = rows.directory[i]; if (d.index !== s.pages.length + 1 + i) b.stop("page_record_directory");
      const raw = bytes[d.index], hash = digest(raw, b); if (hash !== d.hash) b.stop("record_hash");
      const decoded = decode(raw, b), role = d.role as RecordRow["role"];
      const schema = role in newSchemas ? newSchemas[role as keyof typeof newSchemas] : schemas[role];
      if (!schema) b.stop("unsupported_role");
      const value = parse(schema! as z.ZodType<Row>, { ...decoded, bytes: raw.length }, b);
      records.push({ ...decoded, value, hash, role, index: d.index, bytes: raw.length });
      if (role === "manifest") for (const p of value.pairs) { b.charge(); pairs.push(p); }
    }
    if (s.manifest_commitment !== digest(encode({ schema: "native-bar-committed-manifest-collection-v1", pairs }, LIMITS.input_bytes, b), b)) b.stop("paged_manifest_collection");
    const receipts = s.collections[1], maintenance = s.collections[0]; let intents = 0;
    for (const r of records) {
      b.charge(); if (r.role !== "intent") continue; intents++;
      const v = r.value, ref = v.binding.baseline_ref;
      if (v.binding.baseline_generation !== s.baseline_generation || ref.receipts.commitment !== receipts.commitment || ref.receipts.count !== receipts.total_entries ||
        ref.maintenance.commitment !== maintenance.commitment || ref.maintenance.count !== maintenance.total_entries) b.stop("paged_baseline_declaration");
      if (v.manifest_commitment !== s.manifest_commitment) b.stop("paged_manifest_declaration");
      // Only identity is resolved here. Original receipt/time/generation semantics stay after the legacy snapshot.
      r.resolved_baseline = { receipts: rows.baseline_receipts, maintenance: rows.baseline_maintenance };
    }
    if (!intents && (rows.baseline_receipts.length || rows.baseline_maintenance.length || s.baseline_generation !== null)) b.stop("paged_orphan_baseline");
    return verifyCommittedLogical(records, { policy_hash: s.policy_hash, inventory: rows.inventory, evaluation: s.evaluation }, b, "paged-stage-a");
  } catch (error) { return rejectCommittedLogical(error, b, null, "paged-stage-a"); }
}
