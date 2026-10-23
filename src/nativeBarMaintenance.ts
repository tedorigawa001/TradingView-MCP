import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canonical, evidenceHash, nativeBarCaptureSchema, nativeBarHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { nativeBarReceiptSchema, nativeBarMaintenanceSchema } from "./nativeBarArtifacts.js";

const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const integer = z.string().regex(/^-?(0|[1-9][0-9]{0,29})$/);
const relativePath = z.string().min(1).max(512).refine((s) => !s.includes("\\") && !s.includes("\0")
  && s.split("/").every((p) => p !== "" && p !== "." && p !== ".."), "canonical relative path required");
const acl = z.enum(["none", "deny_only", "grant", "unknown"]);
const identity = z.strictObject({ device: uint, inode: uint });
const parent = identity.extend({ path: z.string().max(512), uid: uint, mode: uint, acl });
const proof = identity.extend({ uid: uint, gid: uint, mode: uint, nlink: uint, size: uint,
  sha256: nativeBarHash.nullable(), mtime_ns: integer, ctime_ns: integer, birthtime_ns: integer.optional() });
const baseOwner = z.strictObject({ pid: z.number().int().positive().safe(), token: nativeBarId });
const digest = z.string().regex(/^[0-9a-f]{12}$/).nullable();
const modernOwner = baseOwner.extend({ boot: digest, start: digest });
const ownerSchema = z.union([baseOwner, modernOwner]);
type Owner = z.infer<typeof ownerSchema>;
export const nativeBarProducerReservationSchema = z.strictObject({ schema: z.literal("native-bar-producer-reservation-v1"),
  operation_id: nativeBarId, policy_hash: nativeBarHash, root: identity, created_at: nativeBarTimestamp, owner: ownerSchema,
  artifact: z.strictObject({ kind: z.enum(["capture", "publication_stage"]), path: relativePath, recording_id: nativeBarId }) });
export const nativeBarCreatedEntrySchema = z.strictObject({ schema: z.literal("native-bar-created-entry-v1"),
  operation_id: nativeBarId, stage_id: nativeBarId, reservation_hash: nativeBarHash, path: relativePath,
  created_at: nativeBarTimestamp, object: identity.extend({ birthtime_ns: integer }) });
export const nativeBarAbandonedQuarantineSchema = z.strictObject({ schema: z.literal("native-bar-abandoned-quarantine-v1"),
  operation_id: nativeBarId, root: identity, policy_hash: nativeBarHash, quarantined_at: nativeBarTimestamp,
  targets: z.array(z.strictObject({ target_id: nativeBarId, source_path: relativePath, recording_id: nativeBarId.nullable(),
    proof: proof.extend({ sha256: nativeBarHash, birthtime_ns: integer }) })).min(1).max(1024) });
const entry = z.strictObject({ path: relativePath, kind: z.enum(["file", "directory", "symlink", "fifo", "socket", "other"]),
  acl, proof, parents: z.array(parent).max(16), bytes: z.instanceof(Uint8Array).nullable() });
const snapshotSchema = z.strictObject({ schema: z.literal("native-bar-cleanup-snapshot-v1"), as_of: nativeBarTimestamp,
  root: parent.extend({ path: z.literal(""), policy_hash: nativeBarHash, backend_protocol: z.literal(1), capabilities_hash: nativeBarHash }).nullable(),
  coverage_complete: z.boolean(), current_owner_tokens: z.array(nativeBarId).max(128),
  liveness: z.array(z.strictObject({ owner_hash: nativeBarHash, state: z.enum(["dead", "live", "unknown"]),
    reason: z.enum(["esrch", "boot_mismatch", "start_mismatch", "running", "unverified"]), checked_at: nativeBarTimestamp })).max(30000),
  entries: z.array(entry).max(30000) });
export type NativeBarCleanupSnapshot = z.input<typeof snapshotSchema>;
type Entry = z.infer<typeof entry>;
type Snapshot = z.infer<typeof snapshotSchema>;
type CleanupClass = "unknown" | "unsafe" | "hard_link_alias" | "committed" | "referenced" | "protected_metadata"
  | "integrity_failure" | "legacy_unverified" | "registered_pending_capture" | "registered_interrupted_stage"
  | "dead_coordination" | "live_or_unknown_producer" | "clock_quarantine" | "abandoned_quarantine";
type Action = "quarantine" | "purge" | "legacy_review";
type Item = { candidate_id: string; path: string; classification: CleanupClass; eligible_for: Action | null; reasons: string[];
  proof: Entry["proof"]; parents: Entry["parents"] };
const LIMITS = Object.freeze({ entries: 30000, file_bytes: 1024 ** 2, scan_bytes: 256 * 1024 ** 2,
  metadata_bytes: 16 * 1024 ** 2, response_bytes: 8 * 1024 ** 2, quota_bytes: 1024 ** 3, batch: 1024 } as const);

const rawHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function bounded(input: NativeBarCleanupSnapshot) {
  const snapshot = snapshotSchema.parse(input);
  let inventory = 0n, metadata = 0n, scan = 0;
  const paths = new Set<string>();
  if (new Set(snapshot.liveness.map((v) => v.owner_hash)).size !== snapshot.liveness.length) throw new Error("cleanup_duplicate_liveness");
  for (const e of snapshot.entries) {
    if (paths.has(e.path)) throw new Error("cleanup_duplicate_path"); paths.add(e.path);
    if (e.kind !== "directory") inventory += BigInt(e.proof.size);
    if (metadataPath(e.path)) metadata += BigInt(e.proof.size);
    if (e.bytes) {
      if (e.bytes.byteLength > LIMITS.file_bytes) throw new Error("cleanup_artifact_read_limit");
      scan += e.bytes.byteLength;
    }
  }
  if (inventory > BigInt(LIMITS.quota_bytes)) throw new Error("cleanup_inventory_quota_exceeded");
  if (scan > LIMITS.scan_bytes) throw new Error("cleanup_evidence_scan_limit");
  if (metadata > BigInt(LIMITS.metadata_bytes)) throw new Error("cleanup_metadata_limit");
  return { snapshot, inventory, metadata };
}
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
function artifact(path: string, area: "captures" | "receipts") {
  const m = new RegExp(`^${area}/([0-9]{4}-[0-9]{2}-[0-9]{2})/(${uuid})\\.json$`).exec(path);
  if (!m || !nativeBarTimestamp.safeParse(`${m[1]}T00:00:00.000Z`).success || !nativeBarId.safeParse(m[2]).success) return null;
  return { day: m[1], recording_id: m[2] };
}
function maintenancePath(path: string) { return new RegExp(`^maintenance/(${uuid})(\\.done)?\\.json$`).exec(path); }
function metadataPath(path: string) {
  return path === "policy.json" || !!artifact(path, "receipts") || !!maintenancePath(path)
    || path.startsWith("operations/") || /^\.writer[-.]/.test(path) || /^quarantine\/abandoned\/[^/]+\/timestamp\.json$/.test(path)
    || new RegExp(`^maintenance/${uuid}\\.events/`).test(path);
}
function isStage(path: string) {
  return /^(captures|receipts)\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/\.[A-Za-z0-9._-]{1,64}-[0-9a-f]{8}-[1-9][0-9]*-[0-9a-f]{12}\.stage$/.test(path)
    && nativeBarTimestamp.safeParse(`${path.split("/")[1]}T00:00:00.000Z`).success;
}
function coordinationPath(path: string) {
  const match = new RegExp(`^\\.writer-(claim|ticket|retired)-(${uuid})\\.(json|lock)$`).exec(path);
  return match && ((match[1] === "retired") === (match[3] === "lock")) ? match : null;
}
function coordinationOwner(e: Entry, root: NonNullable<Snapshot["root"]>, match: RegExpExecArray) {
  if (BigInt(e.proof.size) > 256n) throw new Error("invalid_coordination");
  const value = json(e, root);
  const parsed = match[1] === "ticket" ? z.union([baseOwner.extend({ ticket: z.number().int().positive().safe() }),
    modernOwner.extend({ ticket: z.number().int().positive().safe() })]).parse(value) : ownerSchema.parse(value);
  const { ticket, ...rest } = parsed as Owner & { ticket?: number };
  const owner = ownerSchema.parse(rest);
  if (match[1] !== "retired" && owner.token !== match[2]) throw new Error("coordination_token");
  return owner;
}
function ownerDeathCheck(snapshot: Snapshot) {
  const current = new Set(snapshot.current_owner_tokens), liveness = new Map(snapshot.liveness.map((v) => [v.owner_hash, v]));
  return (owner: Owner) => {
    if (current.has(owner.token)) return false;
    const v = liveness.get(evidenceHash(owner));
    if (!v || v.checked_at !== snapshot.as_of || v.state !== "dead") return false;
    return v.reason === "esrch" || (v.reason === "boot_mismatch" && "boot" in owner && !!owner.boot)
      || (v.reason === "start_mismatch" && "start" in owner && !!owner.start);
  };
}
function safeEntry(e: Entry, root: NonNullable<Snapshot["root"]>) {
  const components = e.path.split("/").slice(0, -1);
  return e.kind === "file" && (BigInt(e.proof.mode) & 0o170000n) === 0o100000n
    && (BigInt(e.proof.mode) & 0o077n) === 0n && e.proof.uid === root.uid && e.proof.device === root.device
    && (e.acl === "none" || e.acl === "deny_only") && e.parents.length === components.length
    && e.parents.every((p, i) => p.path === components.slice(0, i + 1).join("/") && p.device === root.device
      && p.uid === root.uid && (BigInt(p.mode) & 0o170077n) === 0o40000n && (p.acl === "none" || p.acl === "deny_only"));
}
function content(e: Entry, root: NonNullable<Snapshot["root"]>) {
  if (!safeEntry(e, root) || e.proof.nlink !== "1" || !e.bytes || BigInt(e.bytes.byteLength) !== BigInt(e.proof.size)
    || rawHash(e.bytes) !== e.proof.sha256) throw new Error("unverified_content");
  return e.bytes;
}
function json(e: Entry, root: NonNullable<Snapshot["root"]>) {
  const bytes = content(e, root), value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!Buffer.from(bytes).equals(Buffer.from(canonical(value)))) throw new Error("noncanonical_metadata");
  return value;
}

/** Supplied read-only evidence only. No filesystem, native addon, process probe or execution authority. */
export function classifyNativeBarCleanup(input: NativeBarCleanupSnapshot) {
  const { snapshot, inventory, metadata } = bounded(input);
  const items: Item[] = snapshot.entries.filter((e) => e.kind !== "directory").map((e) => ({
    candidate_id: evidenceHash({ root: snapshot.root, path: e.path, proof: e.proof, parents: e.parents }), path: e.path,
    classification: "unknown", eligible_for: null, reasons: ["unrecognized_preserve"], proof: e.proof, parents: e.parents,
  }));
  const blockers: string[] = snapshot.coverage_complete ? [] : ["incomplete_inventory"];
  const byPath = new Map(snapshot.entries.map((e) => [e.path, e]));
  const isDead = ownerDeathCheck(snapshot);
  const itemByPath = new Map(items.map((i) => [i.path, i]));
  const mark = (path: string, classification: CleanupClass, reason: string, eligible_for: Action | null = null) => {
    const item = itemByPath.get(path); if (item) Object.assign(item, { classification, eligible_for, reasons: [reason] });
  };
  const fail = (path: string) => { blockers.push(`integrity_failure:${path}`); mark(path, "integrity_failure", "recognized_evidence_invalid"); };
  const root = snapshot.root;
  const parentProofs = new Map<string, string>();
  const objectPaths = new Map<string, string>();
  const abandonedOperations = new Set<string>();
  for (const e of snapshot.entries) {
    const abandoned = new RegExp(`^quarantine/abandoned/(${uuid})(?:/|$)`).exec(e.path);
    if (abandoned) abandonedOperations.add(abandoned[1]);
    if (e.kind === "file") {
      const key = `${e.proof.device}:${e.proof.inode}`;
      if (objectPaths.has(key)) blockers.push(`duplicate_object_identity:${e.path}`);
      objectPaths.set(key, e.path);
    }
    if (new RegExp(`^(maintenance-hold/${uuid}/|maintenance/${uuid}\\.events/)`).test(e.path)) {
      blockers.push(`unsupported_transaction_state:${e.path}`);
      mark(e.path, "protected_metadata", "explicit_recovery_not_implemented");
    }
  }
  for (const operation of abandonedOperations) if (!byPath.has(`quarantine/abandoned/${operation}/timestamp.json`)) {
    blockers.push(`quarantine_recovery_required:${operation}`);
  }
  for (const e of snapshot.entries) for (const p of e.parents) {
    const saved = parentProofs.get(p.path), serialized = canonical(p), listed = byPath.get(p.path);
    if ((saved && saved !== serialized) || (listed && (listed.kind !== "directory"
      || listed.proof.device !== p.device || listed.proof.inode !== p.inode || listed.proof.uid !== p.uid
      || listed.proof.mode !== p.mode || listed.acl !== p.acl))) blockers.push(`inconsistent_parent:${p.path}`);
    parentProofs.set(p.path, serialized);
  }
  const references = new Set<string>(), committedPaths = new Set<string>();
  const registered = new Map<string, { reservation: z.infer<typeof nativeBarProducerReservationSchema>; created: z.infer<typeof nativeBarCreatedEntrySchema> }>();
  if (!root) { if (snapshot.entries.length) blockers.push("missing_root_with_entries"); }
  else {
    if ((BigInt(root.mode) & 0o170077n) !== 0o40000n || !["none", "deny_only"].includes(root.acl)) blockers.push("unsafe_root");
    const policy = byPath.get("policy.json");
    try { if (!policy || evidenceHash(json(policy, root)) !== root.policy_hash) throw new Error("policy_mismatch"); }
    catch { fail("policy.json"); }
    if (policy && !blockers.includes("integrity_failure:policy.json")) mark("policy.json", "protected_metadata", "policy_is_not_cleanup");
    // Every canonical receipt blocks abandonment of that ID, even when its content is corrupt.
    for (const e of snapshot.entries) {
      const receiptPath = artifact(e.path, "receipts"), maintenance = maintenancePath(e.path);
      if (receiptPath) {
        references.add(receiptPath.recording_id);
        try {
          const r = nativeBarReceiptSchema.parse(json(e, root));
          if (r.recording_id !== receiptPath.recording_id || r.day !== receiptPath.day || r.policy_hash !== root.policy_hash
            || r.day !== (r.partition_at ?? r.recorded_at).slice(0, 10) || (r.partition_at && r.partition_at > r.recorded_at)) throw new Error("receipt_binding");
          const path = `captures/${r.day}/${r.recording_id}.json`, captured = byPath.get(path);
          if (!captured) throw new Error("missing_capture");
          const value = nativeBarCaptureSchema.parse(json(captured, root));
          if (evidenceHash(value) !== r.payload_hash || value.series.some((s) => s.observed_at > r.recorded_at)
            || r.recorded_at > snapshot.as_of) throw new Error("capture_binding_or_clock");
          committedPaths.add(path); mark(path, "committed", "valid_receipt_payload_pair"); mark(e.path, "committed", "valid_receipt_payload_pair");
        } catch { fail(e.path); }
      } else if (maintenance) {
        mark(e.path, "protected_metadata", "maintenance_requires_separate_recovery");
        try {
          if (maintenance[2]) {
            const original = byPath.get(`maintenance/${maintenance[1]}.json`);
            const done = z.strictObject({ id: nativeBarId, intent_hash: nativeBarHash }).parse(json(e, root));
            if (!original || done.id !== maintenance[1] || evidenceHash(json(original, root)) !== done.intent_hash) throw new Error("completion_binding");
          } else {
            const m = nativeBarMaintenanceSchema.parse(json(e, root));
            if (m.id !== maintenance[1] || m.created_at > snapshot.as_of) throw new Error("intent_binding");
            for (const p of m.pairs) references.add(p.recording_id);
            if (!byPath.has(`maintenance/${m.id}.done.json`)) blockers.push(`maintenance_recovery_required:${m.id}`);
          }
        } catch { fail(e.path); }
      }
    }
    // Registration describes provenance, never consent. Created-entry identity is separate from mutable stage bytes.
    const reservations = new Map<string, { value: z.infer<typeof nativeBarProducerReservationSchema>; hash: string }>();
    const reservationByPath = new Map<string, z.infer<typeof nativeBarProducerReservationSchema>>();
    for (const e of snapshot.entries) {
      const match = new RegExp(`^operations/(${uuid})\\.reservation\\.json$`).exec(e.path);
      if (!match) continue;
      mark(e.path, "protected_metadata", "producer_provenance_is_not_cleanup");
      try {
        const r = nativeBarProducerReservationSchema.parse(json(e, root));
        const capture = artifact(r.artifact.path, "captures");
        if (r.operation_id !== match[1] || r.policy_hash !== root.policy_hash || canonical(r.root) !== canonical({ device: root.device, inode: root.inode })
          || r.created_at > snapshot.as_of || (r.artifact.kind === "capture" ? !capture || capture.recording_id !== r.artifact.recording_id : !isStage(r.artifact.path))) throw new Error("reservation_binding");
        if (reservationByPath.has(r.artifact.path)) throw new Error("duplicate_reservation_target");
        reservations.set(r.operation_id, { value: r, hash: evidenceHash(r) });
        reservationByPath.set(r.artifact.path, r);
      } catch { fail(e.path); }
    }
    for (const e of snapshot.entries) {
      const match = new RegExp(`^operations/(${uuid})\\.created/(${uuid})\\.json$`).exec(e.path);
      if (!match) continue;
      mark(e.path, "protected_metadata", "producer_provenance_is_not_cleanup");
      try {
        const c = nativeBarCreatedEntrySchema.parse(json(e, root)), r = reservations.get(c.operation_id);
        if (!r || c.operation_id !== match[1] || c.stage_id !== match[2] || c.reservation_hash !== r.hash
          || c.path !== r.value.artifact.path || c.created_at < r.value.created_at || c.created_at > snapshot.as_of
          || registered.has(c.path)) throw new Error("created_entry_binding");
        registered.set(c.path, { reservation: r.value, created: c });
      } catch { fail(e.path); }
    }
    const liveReferences = new Set([...reservations.values()].filter((r) => !isDead(r.value.owner))
      .map((r) => r.value.artifact.recording_id));
    for (const e of snapshot.entries) {
      if (e.kind === "directory" || committedPaths.has(e.path) || artifact(e.path, "receipts")) continue;
      if (e.path.startsWith("quarantine/")) {
        mark(e.path, e.path.startsWith("quarantine/abandoned/") ? "abandoned_quarantine" : "clock_quarantine", "quarantine_preserved_unless_separately_verified");
        continue;
      }
      const coordination = coordinationPath(e.path);
      if (e.path === ".writer.lock" || e.path === ".writer.takeover") { mark(e.path, "protected_metadata", "current_coordination_never_cleanup"); continue; }
      if (metadataPath(e.path) && !coordination) continue;
      if (!safeEntry(e, root)) { mark(e.path, "unsafe", "unsafe_type_owner_mode_acl_or_parent"); continue; }
      if (e.proof.nlink !== "1") { mark(e.path, "hard_link_alias", "links_require_separate_alias_recovery"); continue; }
      const asOfNs = BigInt(Date.parse(snapshot.as_of)) * 1000000n + 999999n;
      if ([e.proof.mtime_ns, e.proof.ctime_ns, e.proof.birthtime_ns].some((n) => n !== undefined && BigInt(n) > asOfNs)) {
        mark(e.path, "unsafe", "future_native_metadata"); continue;
      }
      const capture = artifact(e.path, "captures");
      if (coordination) {
        try {
          const owner = coordinationOwner(e, root, coordination);
          const dead = isDead(owner);
          mark(e.path, dead ? "dead_coordination" : "live_or_unknown_producer", dead ? "producer_death_verified" : "producer_live_unknown_or_current", dead ? "quarantine" : null);
        } catch { mark(e.path, "live_or_unknown_producer", "coordination_owner_unverified"); }
      } else if (capture || isStage(e.path)) {
        const registration = registered.get(e.path), reservation = reservationByPath.get(e.path);
        const refId = reservation?.artifact.recording_id ?? capture?.recording_id;
        if (refId && (references.has(refId) || liveReferences.has(refId))) {
          if (reservation && !isDead(reservation.owner)) mark(e.path, "live_or_unknown_producer", "producer_live_unknown_or_current");
          else mark(e.path, "referenced", "receipt_maintenance_or_live_producer_reference");
          continue;
        }
        try {
          content(e, root);
          if (capture) {
            const value = nativeBarCaptureSchema.parse(json(e, root));
            if (value.series.some((s) => s.observed_at > snapshot.as_of)) throw new Error("future_capture");
          }
          if (!registration) {
            if (reservation) mark(e.path, "live_or_unknown_producer", isDead(reservation.owner) ? "created_entry_missing" : "producer_live_unknown_or_current");
            else mark(e.path, "legacy_unverified", "no_registered_producer_provenance", "legacy_review");
            continue;
          }
          const { reservation: r, created: c } = registration;
          if (e.proof.device !== c.object.device || e.proof.inode !== c.object.inode || e.proof.birthtime_ns !== c.object.birthtime_ns
            || BigInt(c.object.birthtime_ns) < BigInt(Date.parse(r.created_at)) * 1000000n
            || BigInt(c.object.birthtime_ns) > BigInt(Date.parse(c.created_at)) * 1000000n + 999999n) throw new Error("created_object_mismatch");
          const dead = isDead(r.owner);
          mark(e.path, dead ? capture ? "registered_pending_capture" : "registered_interrupted_stage" : "live_or_unknown_producer",
            dead ? "registered_object_and_producer_death_verified" : "producer_live_unknown_or_current", dead ? "quarantine" : null);
        } catch { mark(e.path, "unsafe", "invalid_pending_content_or_registration_binding"); }
      }
    }
    for (const e of snapshot.entries) {
      const match = new RegExp(`^quarantine/abandoned/(${uuid})/timestamp\\.json$`).exec(e.path);
      if (!match) continue;
      mark(e.path, "protected_metadata", "quarantine_timestamp_is_not_cleanup");
      try {
        const q = nativeBarAbandonedQuarantineSchema.parse(json(e, root));
        if (q.operation_id !== match[1] || q.policy_hash !== root.policy_hash || q.quarantined_at > snapshot.as_of
          || canonical(q.root) !== canonical({ device: root.device, inode: root.inode })
          || new Set(q.targets.map((t) => t.target_id)).size !== q.targets.length
          || new Set(q.targets.map((t) => t.source_path)).size !== q.targets.length) throw new Error("quarantine_binding");
        const prefix = `quarantine/abandoned/${q.operation_id}/`;
        const leaves = new Set([e.path, ...q.targets.map((t) => `${prefix}${t.target_id}`)]);
        if (snapshot.entries.some((v) => v.path.startsWith(prefix) && !leaves.has(v.path))) throw new Error("quarantine_unexpected_entry");
        // Check the whole completed set before classifying any target as purge-eligible.
        for (const t of q.targets) {
          const path = `quarantine/abandoned/${q.operation_id}/${t.target_id}`, target = byPath.get(path);
          const source = artifact(t.source_path, "captures");
          const coordination = coordinationPath(t.source_path);
          if (!target || byPath.has(t.source_path) || !(source || isStage(t.source_path) || coordination)
            || (coordination ? t.recording_id !== null : t.recording_id === null)
            || (source && source.recording_id !== t.recording_id)
            || canonical(target.proof) !== canonical(t.proof)) throw new Error("quarantine_target_binding");
          content(target, root);
          if (source) {
            const captured = nativeBarCaptureSchema.parse(json(target, root));
            if (captured.series.some((s) => s.observed_at > q.quarantined_at)) throw new Error("future_quarantined_capture");
          }
          if (coordination && !isDead(coordinationOwner(target, root, coordination))) throw new Error("quarantined_producer_unverified");
        }
        const cutoff = (BigInt(Date.parse(snapshot.as_of)) - 90n * 86400000n) * 1000000n;
        for (const t of q.targets) {
          const path = `quarantine/abandoned/${q.operation_id}/${t.target_id}`, target = byPath.get(path)!;
          const clocks = [BigInt(Date.parse(q.quarantined_at)) * 1000000n, BigInt(target.proof.mtime_ns), BigInt(target.proof.ctime_ns),
            BigInt(target.proof.birthtime_ns!), BigInt(e.proof.mtime_ns), BigInt(e.proof.ctime_ns), e.proof.birthtime_ns ? BigInt(e.proof.birthtime_ns) : null];
          const referenced = t.recording_id !== null && (references.has(t.recording_id) || liveReferences.has(t.recording_id));
          const old = clocks.every((n) => n !== null && n < cutoff);
          mark(path, "abandoned_quarantine", referenced ? "receipt_or_maintenance_reference" : old ? "verified_quarantine_strictly_older_than_90_days" : "quarantine_age_or_native_clock_unverified",
            !referenced && old ? "purge" : null);
        }
      } catch { fail(e.path); }
    }
  }
  const generation = evidenceHash({ root, entries: [...snapshot.entries].sort((a, b) => a.path.localeCompare(b.path)).map((e) => ({ ...e,
    bytes: e.bytes ? rawHash(e.bytes) : null })), current_owner_tokens: [...snapshot.current_owner_tokens].sort(),
    liveness: snapshot.liveness.map(({ checked_at, ...v }) => v).sort((a, b) => a.owner_hash.localeCompare(b.owner_hash)), coverage_complete: snapshot.coverage_complete });
  const result = { schema: "native-bar-cleanup-classification-v1" as const, as_of: snapshot.as_of,
    verification_scope: "supplied_snapshot_only" as const, execution_available: false as const,
    execution_blocker: "cleanup_execution_not_implemented" as const, binding: root, generation, items, blockers,
    inventory_bytes: String(inventory), metadata_bytes: String(metadata), limits: LIMITS };
  if (Buffer.byteLength(canonical(result)) > LIMITS.response_bytes) throw new Error("cleanup_response_limit");
  return result;
}

const actionSchema = z.enum(["quarantine", "purge", "legacy_review"]);
const selectionSchema = z.strictObject({ action: actionSchema, candidate_ids: z.array(nativeBarHash).min(1).max(LIMITS.batch)
  .refine((ids) => new Set(ids).size === ids.length, "duplicate candidates") });
const validationSchema = z.strictObject({ plan_id: nativeBarId, plan_hash: nativeBarHash, action: actionSchema, confirm: z.literal(true) });
const PLAN_TTL_MS = 600000;
type Classification = ReturnType<typeof classifyNativeBarCleanup>;
type PlanTarget = { candidate_id: string; source_path: string; classification: CleanupClass; proof: Entry["proof"]; parents: Entry["parents"];
  effect: "move_without_purge" | "irreversible_unlink" | "review_only"; destination: string | null; holding_path: string | null };
type PlanBody = { schema: "native-bar-cleanup-plan-v1"; plan_id: string; issuer_id: string; operation_id: string; action: Action;
  issued_at: string; expires_at: string; snapshot_as_of: string; generation: string; binding: Classification["binding"]; targets: PlanTarget[];
  execution_available: false; execution_blocker: "cleanup_execution_not_implemented"; verification_scope: "supplied_snapshot_only";
  capacity_reservation: "unverified_no_execution"; inventory_bytes: string; metadata_bytes: string; limits: typeof LIMITS;
  warnings: string[] };
type Plan = PlanBody & { plan_hash: string };

/** Process-local preview and destructive single-use validation only; intentionally has no executor. */
export class NativeBarCleanupPlans {
  private readonly issuer = randomUUID();
  private readonly pid = process.pid;
  private readonly plans = new Map<string, { plan: Plan; issued: number; tick: number }>();
  private readonly now: () => Date;
  private readonly monotonic: () => number;
  private lastWall = -Infinity;
  private lastTick = -Infinity;
  constructor(clocks: { now?: () => Date; monotonic?: () => number } = {}) {
    this.now = clocks.now ?? (() => new Date());
    this.monotonic = clocks.monotonic ?? (() => performance.now());
  }
  private clock() {
    const wall = this.now().getTime(), tick = this.monotonic();
    if (process.pid !== this.pid || !Number.isFinite(wall) || !Number.isFinite(tick) || tick < 0
      || wall < this.lastWall || tick < this.lastTick) {
      this.plans.clear(); throw new Error("cleanup_clock_or_process_changed");
    }
    this.lastWall = wall; this.lastTick = tick;
    return { wall, tick };
  }
  private freshness(asOf: string, wall: number) {
    if (Date.parse(asOf) > wall) throw new Error("cleanup_future_snapshot");
    if (wall - Date.parse(asOf) >= PLAN_TTL_MS) throw new Error("cleanup_stale_snapshot");
  }
  private classify(input: NativeBarCleanupSnapshot, wall: number) {
    const report = classifyNativeBarCleanup(input);
    if (!report.binding || report.blockers.length) throw new Error(`cleanup_blocked:${report.blockers.join(",") || "missing_root"}`);
    this.freshness(report.as_of, wall);
    return report;
  }
  prepare(input: NativeBarCleanupSnapshot, selection: z.input<typeof selectionSchema>): Plan {
    const selected = selectionSchema.parse(selection), start = this.clock();
    for (const [id, p] of this.plans) if (start.wall - p.issued >= PLAN_TTL_MS || start.tick - p.tick >= PLAN_TTL_MS) this.plans.delete(id);
    if (this.plans.size >= 128) throw new Error("cleanup_plan_capacity");
    const report = this.classify(input, start.wall), operationId = randomUUID();
    const byId = new Map(report.items.map((i) => [i.candidate_id, i]));
    const targets: PlanTarget[] = [...selected.candidate_ids].sort().map((id) => {
      const item = byId.get(id);
      if (!item || item.eligible_for !== selected.action) throw new Error("cleanup_candidate_not_eligible");
      const targetId = randomUUID();
      return { candidate_id: id, source_path: item.path, classification: item.classification, proof: item.proof, parents: item.parents,
        effect: selected.action === "quarantine" ? "move_without_purge" : selected.action === "purge" ? "irreversible_unlink" : "review_only",
        destination: selected.action === "quarantine" ? `quarantine/abandoned/${operationId}/${targetId}` : null,
        holding_path: selected.action === "legacy_review" ? null : `maintenance-hold/${operationId}/${targetId}` };
    });
    const body: PlanBody = { schema: "native-bar-cleanup-plan-v1", plan_id: randomUUID(), issuer_id: this.issuer, operation_id: operationId,
      action: selected.action, issued_at: new Date(start.wall).toISOString(), expires_at: new Date(start.wall + PLAN_TTL_MS).toISOString(),
      snapshot_as_of: report.as_of, generation: report.generation, binding: report.binding, targets,
      execution_available: false, execution_blocker: "cleanup_execution_not_implemented", verification_scope: "supplied_snapshot_only",
      capacity_reservation: "unverified_no_execution", inventory_bytes: report.inventory_bytes, metadata_bytes: report.metadata_bytes, limits: LIMITS,
      warnings: ["technical_confirmation_is_not_human_authorization", "verified_inventory_and_writer_exclusion_required_before_execution",
        "durable_journal_capacity_and_recovery_not_implemented", "no_automatic_next_batch", "no_secure_erase_guarantee"] };
    const plan: Plan = { ...body, plan_hash: evidenceHash(body) };
    const bytes = Buffer.byteLength(canonical(plan));
    if (bytes > LIMITS.response_bytes || BigInt(bytes) + BigInt(report.metadata_bytes) > BigInt(LIMITS.metadata_bytes)
      || BigInt(bytes) + BigInt(report.inventory_bytes) > BigInt(LIMITS.quota_bytes)) throw new Error("cleanup_plan_size_or_capacity");
    const end = this.clock();
    if (end.wall - start.wall >= PLAN_TTL_MS || end.tick - start.tick >= PLAN_TTL_MS) throw new Error("cleanup_plan_expired");
    this.freshness(report.as_of, end.wall);
    this.plans.set(plan.plan_id, { plan: structuredClone(plan), issued: start.wall, tick: start.tick });
    return plan;
  }
  consumeForSyntheticValidation(request: z.input<typeof validationSchema>, input: NativeBarCleanupSnapshot) {
    const selected = validationSchema.parse(request), saved = this.plans.get(selected.plan_id);
    if (!saved) throw new Error("cleanup_plan_not_found");
    this.plans.delete(selected.plan_id);
    const current = this.clock(), plan = saved.plan;
    const checkExpiry = (clock: { wall: number; tick: number }) => {
      if (clock.wall >= Date.parse(plan.expires_at) || clock.wall - saved.issued >= PLAN_TTL_MS
        || clock.tick - saved.tick >= PLAN_TTL_MS) throw new Error("cleanup_plan_expired");
    };
    checkExpiry(current);
    if (selected.plan_hash !== plan.plan_hash || selected.action !== plan.action) throw new Error("cleanup_plan_binding_mismatch");
    const report = this.classify(input, current.wall);
    if (report.as_of < plan.snapshot_as_of || report.generation !== plan.generation) throw new Error("cleanup_snapshot_changed");
    for (const target of plan.targets) {
      const item = report.items.find((i) => i.candidate_id === target.candidate_id);
      if (!item || item.eligible_for !== plan.action || item.classification !== target.classification) throw new Error("cleanup_candidate_changed");
    }
    const end = this.clock();
    checkExpiry(end);
    this.freshness(report.as_of, end.wall);
    return { status: "validated_only" as const, plan_id: plan.plan_id, plan_hash: plan.plan_hash, action: plan.action,
      execution_available: false as const, no_operation_performed: true as const, execution_blocker: plan.execution_blocker,
      targets: structuredClone(plan.targets) };
  }
}
