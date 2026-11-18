/** Inactive stage-A preparation only. No replay, native IO, profile parameter or expanded constants. */
import { z } from "zod";
import { nativeBarReceiptSchema } from "../nativeBarArtifacts.js";
import { nativeBarHash } from "../nativeBarEvidence.js";
import { COMMITTED_MAINTENANCE_LIMITS as LIMITS, CommittedMaintenanceBudget, Rejected, noAuthority,
  collect, decode, encode, digest, parse, freeze, headerSchema, inventoryEntrySchema, pairSchema, schemas, uuid,
  type Row } from "./nativeBarCommittedKernel.js";

const kinds = ["baseline_maintenance", "baseline_receipts", "directory", "inventory", "manifest"] as const;
type Kind = typeof kinds[number];
const kindSchema = z.enum(kinds), count = z.number().int().min(0).max(LIMITS.records - 1);
const entries = {
  baseline_maintenance: z.strictObject({ id: uuid, hash: nativeBarHash }),
  baseline_receipts: nativeBarReceiptSchema,
  directory: headerSchema.shape.records.element,
  inventory: inventoryEntrySchema,
  manifest: pairSchema,
};
const pageRef = z.strictObject({ index: count, kind: kindSchema, ordinal: count, total_pages: count,
  entry_count: z.number().int().min(1).max(512), hash: nativeBarHash });
const rootSchema = z.strictObject({ schema: z.literal("native-bar-committed-pages-preparation-v1"),
  snapshot_generation: nativeBarHash, snapshot: z.strictObject({ policy_hash: nativeBarHash,
    evaluation: headerSchema.shape.evaluation, baseline_generation: nativeBarHash,
    collections: z.array(z.strictObject({ kind: kindSchema, commitment: nativeBarHash, total_entries: count })).length(kinds.length),
    pages: z.array(pageRef).max(LIMITS.records - 1) }) });

export function inspectCommittedPages(input: unknown) {
  const b = new CommittedMaintenanceBudget();
  const flags = { ...noAuthority, stage_a_only: true, semantic_replay_available: false } as const;
  try {
    b.charge(256);
    const bytes = collect(input, b), head = decode(bytes[0], b);
    const root = parse(rootSchema, { ...head, bytes: bytes[0].length }, b), s = root.snapshot;
    if (digest(encode(s, LIMITS.record_bytes, b), b) !== root.snapshot_generation) b.stop("page_snapshot_binding");
    const rows: Record<Kind, Row[]> = { baseline_maintenance: [], baseline_receipts: [], directory: [], inventory: [], manifest: [] };
    const pageCounts = new Map<Kind, number>();
    for (let i = 0; i < kinds.length; i++) {
      b.charge(); if (s.collections[i].kind !== kinds[i]) b.stop("page_collection_order");
    }
    let lastKind = -1, lastOrdinal = -1, lexicalNodes = head.nodes;
    for (let i = 0; i < s.pages.length; i++) {
      b.charge(); const ref = s.pages[i], rank = kinds.indexOf(ref.kind);
      if (ref.index !== i + 1 || ref.index >= bytes.length || rank < lastKind ||
        ref.ordinal !== (rank === lastKind ? lastOrdinal + 1 : 0)) b.stop("page_order");
      lastKind = rank; lastOrdinal = ref.ordinal;
      if (digest(bytes[ref.index], b) !== ref.hash) b.stop("page_hash");
      const decoded = decode(bytes[ref.index], b);
      const schema = z.strictObject({ schema: z.literal("native-bar-committed-page-preparation-v1"), kind: z.literal(ref.kind),
        commitment: nativeBarHash, ordinal: count, total_pages: count,
        entries: z.array(entries[ref.kind]).min(1).max(ref.kind === "manifest" ? 64 : 512) });
      const page = parse(schema, { ...decoded, bytes: bytes[ref.index].length }, b);
      const collection = s.collections[rank];
      if (page.commitment !== collection.commitment || page.ordinal !== ref.ordinal || page.total_pages !== ref.total_pages ||
        page.entries.length !== ref.entry_count || ref.total_pages < 1 || ref.ordinal >= ref.total_pages ||
        pageCounts.has(ref.kind) && pageCounts.get(ref.kind) !== ref.total_pages) b.stop("page_collection_binding");
      pageCounts.set(ref.kind, ref.total_pages);
      if (ref.kind === "baseline_receipts" && rows[ref.kind].length + page.entries.length > LIMITS.store_receipts) b.stop("store_receipt_limit");
      if (ref.kind === "manifest" && rows[ref.kind].length + page.entries.length > LIMITS.pairs) b.stop("pair_limit");
      b.charge(page.entries.length); rows[ref.kind].push(...page.entries); lexicalNodes += decoded.nodes;
    }
    for (let i = 0; i < kinds.length; i++) {
      b.charge(); const kind = kinds[i], collection = s.collections[i], values = rows[kind];
      const actualPages = s.pages.filter(p => { b.charge(); return p.kind === kind; }).length;
      if (values.length !== collection.total_entries || (pageCounts.get(kind) ?? 0) !== actualPages) b.stop("page_collection_count");
      if (digest(encode({ schema: "native-bar-committed-collection-preparation-v1", kind, entries: values }, LIMITS.input_bytes, b), b) !== collection.commitment)
        b.stop("page_collection_commitment");
    }
    const keys = new Set<string>(), sequences = new Set<number>(); let previousSequence = 0, previousAt = "";
    for (const r of rows.baseline_receipts) {
      b.charge();
      if (keys.has(r.recording_id) || sequences.has(r.sequence) || r.sequence <= previousSequence || r.recorded_at < previousAt ||
        r.policy_hash !== s.policy_hash || r.day !== (r.partition_at ?? r.recorded_at).slice(0, 10) || r.partition_at && r.partition_at > r.recorded_at)
        b.stop("baseline_receipt_binding");
      keys.add(r.recording_id); sequences.add(r.sequence); previousSequence = r.sequence; previousAt = r.recorded_at;
    }
    let previousKey = "", activeReceipts = 0; const inventoryKeys = new Set<string>();
    for (const r of rows.inventory) {
      b.charge(); const key = `${r.recording_id}|${r.role}`, text = encode(r, LIMITS.record_bytes, b);
      if (inventoryKeys.has(key) || text <= previousKey) b.stop("page_inventory_order");
      inventoryKeys.add(key); previousKey = text;
      if (r.role === "receipt" && r.location === "source" && ++activeReceipts > LIMITS.store_receipts) b.stop("store_receipt_limit");
    }
    previousKey = "";
    for (const r of rows.baseline_maintenance) {
      b.charge(); if (r.id <= previousKey || keys.has(r.id)) b.stop("page_baseline_maintenance_order"); previousKey = r.id;
    }
    previousSequence = 0; const manifestIds = new Set<string>();
    for (const r of rows.manifest) {
      b.charge();
      if (manifestIds.has(r.recording_id) || r.sequence <= previousSequence) b.stop("page_manifest_order");
      manifestIds.add(r.recording_id); previousSequence = r.sequence;
    }
    const baselineGeneration = digest(encode({ receipts: rows.baseline_receipts, maintenance: rows.baseline_maintenance }, LIMITS.input_bytes, b), b);
    if (s.baseline_generation !== baselineGeneration) b.stop("baseline_generation");
    const evidence: Row[] = [], journal: Row[] = []; let intentHash: string | null = null, attemptHash: string | null = null;
    if (rows.directory.length + s.pages.length + 1 !== bytes.length) b.stop("page_record_directory");
    for (let i = 0; i < rows.directory.length; i++) {
      b.charge(); const d = rows.directory[i];
      if (d.index !== s.pages.length + 1 + i) b.stop("page_record_directory");
      const raw = bytes[d.index];
      if (digest(raw, b) !== d.hash) b.stop("record_hash");
      const decoded = decode(raw, b), schema = schemas[d.role as keyof typeof schemas];
      if (!schema) b.stop("unsupported_role");
      parse(schema!, { ...decoded, bytes: raw.length }, b); lexicalNodes += decoded.nodes;
      (d.role === "receipt_v1" || d.role === "payload_v1" ? evidence : journal).push({ role: d.role, hash: d.hash });
      if (d.role === "intent") intentHash = d.hash;
      if (d.role === "attempt") attemptHash = d.hash;
    }
    evidence.sort((a, c) => { b.charge(); return a.hash < c.hash ? -1 : a.hash > c.hash ? 1 : a.role < c.role ? -1 : a.role > c.role ? 1 : 0; });
    const e = s.evaluation;
    if (e.journal_hash !== digest(encode(journal, LIMITS.input_bytes, b), b) ||
      e.evidence_hash !== digest(encode(evidence, LIMITS.input_bytes, b), b) ||
      e.inventory_hash !== digest(encode({ policy_hash: s.policy_hash, entries: rows.inventory }, LIMITS.input_bytes, b), b) ||
      e.intent_hash !== intentHash || e.attempt_hash !== attemptHash) b.stop("evaluation_snapshot_binding");
    const result = { ...flags, status: "validated", validation_scope: "page_structure_and_schema_only", adoption: { state: "blocked", blockers: ["stage_a_preparation_only"] },
      effects: null, effects_status: "not_evaluated", baseline_generation: baselineGeneration,
      snapshot_generation: root.snapshot_generation, counts: { frames: bytes.length, pages: s.pages.length,
        input_bytes: bytes.reduce((n, v) => { b.charge(); return n + v.length; }, 0), lexical_nodes: lexicalNodes } };
    freeze(result, b); encode(result, LIMITS.output_bytes - 64, b);
    return Object.freeze({ ...result, work_charged: b.used });
  } catch (error) {
    const reason = error instanceof Rejected ? error.message : "invalid_input";
    return Object.freeze({ ...flags, status: "rejected", reason, adoption: Object.freeze({ state: "blocked", blockers: Object.freeze([reason]) }),
      effects: null, effects_status: "not_evaluated", work_charged: b.used });
  }
}
