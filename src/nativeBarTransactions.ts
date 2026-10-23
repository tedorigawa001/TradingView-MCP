import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId as evidenceId, nativeBarTimestamp } from "./nativeBarEvidence.js";

export const NATIVE_BAR_TRANSACTION_LIMITS = Object.freeze({ artifact_bytes: 1024 ** 2, metadata_bytes: 16 * 1024 ** 2,
  inventory_bytes: 1024 ** 3, read_bytes: 256 * 1024 ** 2, response_bytes: 8 * 1024 ** 2, entries: 30000,
  targets: 1024, root_sessions: 8, live_targets: 32, descriptors: 512 });
const L = NATIVE_BAR_TRANSACTION_LIMITS;
const nativeBarId = evidenceId.refine((s) => s === s.toLowerCase(), "lower-case identifier required");
const UINT = /^(0|[1-9][0-9]{0,29})$/;
const uint = z.string().regex(UINT);
// A refinement still runs after its pattern failed, so it must not assume a valid decimal string.
const uintWhere = (check: (n: bigint) => boolean) => uint.refine((v) => !UINT.test(v) || check(BigInt(v)));
const integer = z.string().regex(/^(0|-?[1-9][0-9]{0,29})$/);
const pathSchema = z.string().min(1).max(512).refine((s) => !s.includes("\\") && !s.includes("\0")
  && s.split("/").every((p) => p !== "" && p !== "." && p !== ".."), "canonical relative path required");
const originSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("capture"), recording_id: nativeBarId }),
  z.strictObject({ kind: z.literal("stage"), recording_id: nativeBarId }),
  z.strictObject({ kind: z.literal("coordination"), owner_hash: nativeBarHash }),
]);
export const nativeBarTransactionClockSchema = z.strictObject({ utc_at: nativeBarTimestamp,
  elapsed: z.strictObject({ boot_id: nativeBarId, source_id: z.string().min(1).max(128), reading_ns: uint, qualified: z.boolean() }).nullable() });
export const nativeBarTransactionProofSchema = z.strictObject({ device: uint, inode: uint, uid: uint, gid: uint,
  mode: z.literal("33152"), nlink: z.literal("1"), acl: z.enum(["none", "deny_only"]), size: uintWhere((n) => n <= BigInt(L.artifact_bytes)),
  sha256: nativeBarHash, birthtime_ns: integer, mtime_ns: integer, ctime_ns: integer });
const parentSchema = z.strictObject({ path: pathSchema, device: uint, inode: uint, uid: uint,
  mode: z.literal("16832"), acl: z.enum(["none", "deny_only"]) });
const bindingSchema = z.strictObject({ profile: z.literal("native-bar-transaction-profile-v2"), policy_hash: nativeBarHash,
  root: z.strictObject({ device: uint, inode: uint, uid: uint, mode: z.literal("16832"), acl: z.enum(["none", "deny_only"]) }),
  backend_protocol: z.literal(2), capabilities_hash: nativeBarHash });
const targetSchema = z.strictObject({ target_id: nativeBarId, origin: originSchema, source_path: pathSchema,
  proof: nativeBarTransactionProofSchema, parents: z.array(parentSchema).max(16) });
export const nativeBarTransactionManifestSchema = z.strictObject({ schema: z.literal("native-bar-maintenance-manifest-v2"),
  maintenance_id: nativeBarId, chunk_id: nativeBarId, targets: z.array(targetSchema).min(1).max(L.targets) });
export const nativeBarTransactionIntentSchema = z.strictObject({ schema: z.literal("native-bar-maintenance-intent-v2"),
  maintenance_id: nativeBarId, kind: z.enum(["quarantine_abandoned", "purge_abandoned"]), binding: bindingSchema,
  created: nativeBarTransactionClockSchema, approval_plan_hash: nativeBarHash,
  baseline: z.strictObject({ inventory_hash: nativeBarHash, reference_hash: nativeBarHash }),
  manifests: z.array(z.strictObject({ chunk_id: nativeBarId, hash: nativeBarHash })).min(1).max(L.targets),
  target_count: z.number().int().min(1).max(L.targets),
  quarantine_refs: z.array(z.strictObject({ quarantine_id: nativeBarId, hash: nativeBarHash })).max(L.targets) });
export const nativeBarQuarantineEvidenceSchema = z.strictObject({ schema: z.literal("native-bar-quarantine-evidence-v2"),
  quarantine_id: nativeBarId, binding: bindingSchema, quarantined_at: nativeBarTimestamp,
  completed: nativeBarTransactionClockSchema, marker_proof: nativeBarTransactionProofSchema,
  targets: z.array(z.strictObject({ quarantine_target_id: nativeBarId, origin: originSchema,
    proof: nativeBarTransactionProofSchema })).min(1).max(L.targets) });
const observationSchema = z.strictObject({ target_id: nativeBarId, source: nativeBarTransactionProofSchema.nullable(),
  holding: nativeBarTransactionProofSchema.nullable(), quarantine: nativeBarTransactionProofSchema.nullable() });
export const nativeBarTransactionAttemptSchema = z.strictObject({ schema: z.literal("native-bar-maintenance-attempt-v2"),
  attempt_id: nativeBarId, maintenance_id: nativeBarId, intent_hash: nativeBarHash, binding_hash: nativeBarHash,
  approval_plan_hash: nativeBarHash, issued: nativeBarTransactionClockSchema, expires_at: nativeBarTimestamp,
  resume_after_event_hash: nativeBarHash.nullable(), reference_hash: nativeBarHash,
  actions: z.array(z.strictObject({ target_id: nativeBarId, action: z.enum(["stage", "quarantine", "unlink", "verify", "reconcile_absence"]) })).min(1).max(L.targets * 3),
  observations: z.array(observationSchema).min(1).max(L.targets) });
const eventBase = z.strictObject({ schema: z.literal("native-bar-maintenance-event-v2"), maintenance_id: nativeBarId,
  intent_hash: nativeBarHash, attempt_id: nativeBarId, attempt_hash: nativeBarHash,
  sequence: z.number().int().positive().max(L.entries), previous_event_hash: nativeBarHash.nullable(),
  target_id: nativeBarId, clock: nativeBarTransactionClockSchema });
export const nativeBarTransactionEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({ type: z.literal("move_pending"), proof: nativeBarTransactionProofSchema }),
  eventBase.extend({ type: z.literal("held_verified"), proof: nativeBarTransactionProofSchema }),
  eventBase.extend({ type: z.literal("quarantine_move_pending"), proof: nativeBarTransactionProofSchema }),
  eventBase.extend({ type: z.literal("quarantined_verified"), proof: nativeBarTransactionProofSchema }),
  eventBase.extend({ type: z.literal("unlink_pending"), proof: nativeBarTransactionProofSchema, reference_hash: nativeBarHash }),
  eventBase.extend({ type: z.literal("unlinked"), proof: nativeBarTransactionProofSchema,
    observed_absent: z.literal(true), remaining_links: z.literal("0"), synced: z.literal(true) }),
  eventBase.extend({ type: z.literal("recovered_verified"), location: z.enum(["source", "holding", "quarantine"]),
    proof: nativeBarTransactionProofSchema, from_pending_event_hash: nativeBarHash.nullable() }),
  eventBase.extend({ type: z.literal("reconciled_absence"), from_pending_event_hash: nativeBarHash }),
  eventBase.extend({ type: z.literal("terminal_absence_verified"), from_terminal_event_hash: nativeBarHash }),
  eventBase.extend({ type: z.literal("failure"), outcome: z.enum(["conflict", "durability_unknown"]),
    reason: z.enum(["object_changed", "namespace_changed", "sync_failed", "publication_failed", "interrupted", "deadline_expired", "unknown"]) }),
]);
export const nativeBarTransactionCompletionSchema = z.strictObject({ schema: z.literal("native-bar-maintenance-completion-v2"),
  maintenance_id: nativeBarId, intent_hash: nativeBarHash, last_event_hash: nativeBarHash,
  attempt_hashes: z.array(nativeBarHash).min(1).max(L.entries), clock: nativeBarTransactionClockSchema,
  outcome: z.enum(["complete", "resolved_with_uncertainty"]),
  targets: z.array(z.strictObject({ target_id: nativeBarId, state: z.enum(["quarantined", "purged", "absent_unconfirmed"]),
    proof: nativeBarTransactionProofSchema.nullable() })).min(1).max(L.targets),
  marker: z.strictObject({ path: pathSchema, proof: nativeBarTransactionProofSchema }).nullable() });
const bundleSchema = z.strictObject({ schema: z.literal("native-bar-transaction-bundle-v2"), intent: nativeBarTransactionIntentSchema,
  manifests: z.array(nativeBarTransactionManifestSchema).max(L.targets), quarantines: z.array(nativeBarQuarantineEvidenceSchema).max(L.targets),
  attempts: z.array(nativeBarTransactionAttemptSchema).max(L.entries), events: z.array(nativeBarTransactionEventSchema).max(L.entries),
  completion: nativeBarTransactionCompletionSchema.nullable() });
export type NativeBarTransactionProof = z.infer<typeof nativeBarTransactionProofSchema>;
export type NativeBarTransactionIntent = z.infer<typeof nativeBarTransactionIntentSchema>;
export type NativeBarTransactionAttempt = z.infer<typeof nativeBarTransactionAttemptSchema>;
export type NativeBarTransactionEvent = z.infer<typeof nativeBarTransactionEventSchema>;
export type NativeBarTransactionCompletion = z.infer<typeof nativeBarTransactionCompletionSchema>;
type Proof = NativeBarTransactionProof;
type Target = z.infer<typeof targetSchema>;
type Clock = z.infer<typeof nativeBarTransactionClockSchema>;
const utcNs = (clock: Clock) => BigInt(Date.parse(clock.utc_at)) * 1000000n;
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const handleCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const capacitySchema = z.strictObject({ schema: z.literal("native-bar-transaction-capacity-v2"),
  existing: z.strictObject({ inventory_bytes: uint, metadata_bytes: uint, entries: uint, available_bytes: uint.nullable() }),
  publications: z.array(z.strictObject({ role: z.enum(["intent", "manifest", "event", "attempt", "completion", "marker",
    "publication_temporary", "coordination", "directory"]), bytes: uint, count: uint })).max(L.entries),
  recovery_reserve: z.strictObject({ bytes: uintWhere((n) => n > 0n), entries: uintWhere((n) => n > 0n) }),
  reads: z.array(z.strictObject({ bytes: uint, count: uint })).max(L.entries), response_bytes: uint,
  handles: z.strictObject({ existing_roots: handleCount, additional_roots: handleCount, existing_descriptors: handleCount,
    additional_descriptors: handleCount, peak_targets_per_session: handleCount }) });
/** Logical upper-bound accounting only. The future native session must measure and reserve physical headroom. */
export function calculateNativeBarTransactionCapacity(input: unknown) {
  const v = capacitySchema.parse(input), reasons: string[] = [];
  const planned = v.publications.reduce((n, p) => n + BigInt(p.bytes) * BigInt(p.count), 0n);
  const added = planned + BigInt(v.recovery_reserve.bytes);
  const inventory = BigInt(v.existing.inventory_bytes) + added;
  const metadata = BigInt(v.existing.metadata_bytes) + added;
  const entries = BigInt(v.existing.entries) + BigInt(v.recovery_reserve.entries)
    + v.publications.reduce((n, p) => n + BigInt(p.count), 0n);
  const reads = v.reads.reduce((n, p) => n + BigInt(p.bytes) * BigInt(p.count), 0n);
  if (BigInt(v.existing.metadata_bytes) > BigInt(v.existing.inventory_bytes)) reasons.push("inconsistent_existing_bytes");
  if (v.existing.entries === "0" && v.existing.inventory_bytes !== "0") reasons.push("inconsistent_existing_entries");
  if (v.publications.some((p) => p.role === "directory" ? p.bytes !== "0" : BigInt(p.bytes) > BigInt(L.artifact_bytes))) reasons.push("artifact_limit");
  if (inventory > BigInt(L.inventory_bytes)) reasons.push("inventory_limit");
  if (metadata > BigInt(L.metadata_bytes)) reasons.push("metadata_limit");
  if (entries > BigInt(L.entries)) reasons.push("entry_limit");
  if (reads > BigInt(L.read_bytes)) reasons.push("read_limit");
  if (BigInt(v.response_bytes) > BigInt(L.response_bytes)) reasons.push("response_limit");
  if (BigInt(v.handles.existing_roots) + BigInt(v.handles.additional_roots) > BigInt(L.root_sessions)) reasons.push("root_session_limit");
  if (BigInt(v.handles.existing_descriptors) + BigInt(v.handles.additional_descriptors) > BigInt(L.descriptors)) reasons.push("descriptor_limit");
  if (v.handles.peak_targets_per_session > L.live_targets) reasons.push("live_target_limit");
  if (v.existing.available_bytes === null) reasons.push("available_space_unverified");
  else if (BigInt(v.existing.available_bytes) < added) reasons.push("insufficient_available_space");
  return { schema: "native-bar-transaction-capacity-result-v2" as const, fits: reasons.length === 0, reasons,
    peak_inventory_bytes: String(inventory), peak_metadata_bytes: String(metadata), peak_entries: String(entries),
    required_available_bytes: String(added), read_bytes: String(reads),
    verification_scope: "supplied_budget_only" as const, capacity_reservation: "not_reserved" as const, execution_available: false as const };
}
function clockOrder(before: Clock, after: Clock, newAttempt = false) {
  if (after.utc_at < before.utc_at) throw new Error("transaction_clock_rollback");
  const a = before.elapsed, b = after.elapsed;
  if (a && b) {
    if (a.boot_id === b.boot_id && a.source_id === b.source_id) {
      if (BigInt(b.reading_ns) < BigInt(a.reading_ns)) throw new Error("transaction_elapsed_rollback");
    } else if (!newAttempt) throw new Error("transaction_clock_source_changed");
  } else if (!!a !== !!b && !newAttempt) throw new Error("transaction_clock_source_changed");
}
function withinAttempt(a: NativeBarTransactionAttempt, clock: Clock) {
  clockOrder(a.issued, clock);
  if (clock.utc_at >= a.expires_at || (a.issued.elapsed && clock.elapsed
    && BigInt(clock.elapsed.reading_ns) - BigInt(a.issued.elapsed.reading_ns) >= 600000000000n)) throw new Error("transaction_attempt_expired");
}
function proofAt(proof: Proof, clock: Clock) {
  if (BigInt(proof.birthtime_ns) < 0n || BigInt(proof.birthtime_ns) > BigInt(proof.ctime_ns)
    || [proof.birthtime_ns, proof.mtime_ns, proof.ctime_ns].some((n) => BigInt(n) > utcNs(clock) + 999999n)) throw new Error("transaction_proof_clock");
}
function movedProof(before: Proof, after: Proof, start: Clock, end: Clock) {
  const { ctime_ns: oldTime, ...a } = before, { ctime_ns: newTime, ...b } = after;
  if (!same(a, b) || BigInt(newTime) < BigInt(oldTime) || BigInt(newTime) < utcNs(start)
    || BigInt(newTime) > utcNs(end) + 999999n) throw new Error("transaction_moved_proof");
  proofAt(after, end);
}
const ageSchema = z.strictObject({ quarantined_at: nativeBarTimestamp, completed: nativeBarTransactionClockSchema,
  observed: nativeBarTransactionClockSchema, native_times_ns: z.array(integer).min(1).max(L.targets * 3 + 3) });
type AgeAnchor = { quarantined_at: string; completed: Clock; anchor: bigint };
const ageAnchor = (quarantinedAt: string, completed: Clock, nativeTimes: string[]): AgeAnchor => ({ quarantined_at: quarantinedAt, completed,
  anchor: [BigInt(Date.parse(quarantinedAt)) * 1000000n, utcNs(completed), ...nativeTimes.map(BigInt)].reduce((a, b) => a > b ? a : b) });
function ageReasons(q: AgeAnchor, observed: Clock) {
  const reasons: string[] = [], hold = 90n * 86400n * 1000000000n;
  if (q.quarantined_at > q.completed.utc_at || observed.utc_at < q.completed.utc_at) reasons.push("clock_inconsistent");
  if (utcNs(observed) - q.anchor <= hold) reasons.push("wall_or_native_age_not_over_90_days");
  const a = q.completed.elapsed, b = observed.elapsed;
  if (!a?.qualified || !b?.qualified || a.boot_id !== b.boot_id || a.source_id !== b.source_id) reasons.push("elapsed_clock_unverified");
  else if (BigInt(b.reading_ns) - BigInt(a.reading_ns) <= hold) reasons.push("elapsed_age_not_over_90_days");
  return reasons;
}
/** Structural clock assessment only; a qualified flag in supplied JSON is not OS attestation. */
export function assessNativeBarQuarantineAge(input: unknown) {
  const v = ageSchema.parse(input), reasons = ageReasons(ageAnchor(v.quarantined_at, v.completed, v.native_times_ns), v.observed);
  return { eligible: reasons.length === 0, reasons, verification_scope: "supplied_clock_evidence_only" as const, execution_available: false as const };
}
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
function originalPath(t: Target) {
  if (t.origin.kind === "capture") {
    const m = new RegExp(`^captures/([0-9]{4}-[0-9]{2}-[0-9]{2})/${t.origin.recording_id}\\.json$`).exec(t.source_path);
    return !!m && nativeBarTimestamp.safeParse(`${m[1]}T00:00:00.000Z`).success;
  }
  if (t.origin.kind === "stage") {
    const m = new RegExp(`^(?:captures|receipts)/([0-9]{4}-[0-9]{2}-[0-9]{2})/\\.${t.origin.recording_id}-[0-9a-f]{8}-[1-9][0-9]*-[0-9a-f]{12}\\.stage$`).exec(t.source_path);
    return !!m && nativeBarTimestamp.safeParse(`${m[1]}T00:00:00.000Z`).success;
  }
  return new RegExp(`^\\.writer-(?:(?:claim|ticket)-${uuid}\\.json|retired-${uuid}\\.lock)$`).test(t.source_path);
}
function recordBytes(value: unknown) {
  const bytes = Buffer.byteLength(canonical(value));
  if (bytes > L.artifact_bytes) throw new Error("transaction_artifact_limit");
  return bytes;
}
function validateTarget(t: Target, binding: z.infer<typeof bindingSchema>) {
  const parts = t.source_path.split("/").slice(0, -1);
  if (t.proof.device !== binding.root.device || t.proof.uid !== binding.root.uid || t.parents.length !== parts.length
    || t.parents.some((p, i) => p.path !== parts.slice(0, i + 1).join("/") || p.uid !== binding.root.uid || p.device !== binding.root.device)) {
    throw new Error("transaction_target_binding");
  }
}

/** Pure record validation. Supplied records never establish filesystem facts or permission to execute. */
export function replayNativeBarTransaction(input: unknown) {
  const bundle = bundleSchema.parse(input), intent = bundle.intent;
  const records = [intent, ...bundle.manifests, ...bundle.quarantines, ...bundle.attempts, ...bundle.events, ...(bundle.completion ? [bundle.completion] : [])];
  if (records.length > L.entries) throw new Error("transaction_entry_limit");
  const bytes = records.reduce((n, v) => n + recordBytes(v), 0);
  if (bytes > L.metadata_bytes) throw new Error("transaction_metadata_limit");
  if (new Set(intent.manifests.map((r) => r.chunk_id)).size !== intent.manifests.length
    || bundle.manifests.length !== intent.manifests.length) throw new Error("transaction_manifest_binding");
  const manifests = new Map(bundle.manifests.map((m) => [m.chunk_id, m]));
  if (manifests.size !== bundle.manifests.length) throw new Error("transaction_manifest_binding");
  const targets: Target[] = [];
  for (const ref of intent.manifests) {
    const m = manifests.get(ref.chunk_id);
    if (!m || m.maintenance_id !== intent.maintenance_id || evidenceHash(m) !== ref.hash) throw new Error("transaction_manifest_binding");
    targets.push(...m.targets);
  }
  if (targets.length !== intent.target_count || new Set(targets.map((t) => t.target_id)).size !== targets.length
    || new Set(targets.map((t) => t.source_path.normalize("NFC").toLowerCase())).size !== targets.length
    || new Set(targets.map((t) => `${t.proof.device}:${t.proof.inode}`)).size !== targets.length) throw new Error("transaction_duplicate_or_missing_target");
  const purge = intent.kind === "purge_abandoned", quarantineForTarget = new Map<string, z.infer<typeof nativeBarQuarantineEvidenceSchema>>();
  if (intent.quarantine_refs.length !== bundle.quarantines.length
    || new Set(intent.quarantine_refs.map((r) => r.quarantine_id)).size !== intent.quarantine_refs.length
    || new Set(bundle.quarantines.map((q) => q.quarantine_id)).size !== bundle.quarantines.length) throw new Error("transaction_quarantine_set");
  if (!purge && bundle.quarantines.length || purge && !bundle.quarantines.length) throw new Error("transaction_quarantine_set");
  for (const q of bundle.quarantines) {
    const ref = intent.quarantine_refs.find((r) => r.quarantine_id === q.quarantine_id);
    if (!ref || ref.hash !== evidenceHash(q) || !same(q.binding, intent.binding)
      || q.quarantined_at > q.completed.utc_at || q.completed.utc_at > intent.created.utc_at
      || new Set(q.targets.map((t) => t.quarantine_target_id)).size !== q.targets.length) throw new Error("transaction_quarantine_set");
    proofAt(q.marker_proof, q.completed);
    if (q.marker_proof.device !== intent.binding.root.device || q.marker_proof.uid !== intent.binding.root.uid
      || BigInt(q.marker_proof.birthtime_ns) < BigInt(Date.parse(q.quarantined_at)) * 1000000n
      || q.targets.some((t) => BigInt(t.proof.ctime_ns) > BigInt(q.marker_proof.birthtime_ns))) throw new Error("transaction_quarantine_set");
    for (const t of q.targets) {
      const selected = targets.filter((s) => s.source_path === `quarantine/abandoned/${q.quarantine_id}/${t.quarantine_target_id}`);
      if (selected.length !== 1 || !same(selected[0].origin, t.origin) || !same(selected[0].proof, t.proof)) throw new Error("transaction_quarantine_set");
      proofAt(t.proof, q.completed); quarantineForTarget.set(selected[0].target_id, q);
    }
  }
  const parentBindings = new Map<string, string>();
  const objects = new Map<string, string>([[`${intent.binding.root.device}:${intent.binding.root.inode}`, "."]]);
  const bindObject = (device: string, inode: string, role: string) => {
    const key = `${device}:${inode}`, previousRole = objects.get(key);
    if (previousRole && previousRole !== role) throw new Error("transaction_object_role");
    objects.set(key, role);
  };
  for (const t of targets) {
    validateTarget(t, intent.binding);
    if (purge ? !quarantineForTarget.has(t.target_id) : !originalPath(t)) throw new Error("transaction_source_role");
    proofAt(t.proof, intent.created);
    bindObject(t.proof.device, t.proof.inode, `file:${t.source_path}`);
    for (const p of t.parents) {
      if (parentBindings.has(p.path) && parentBindings.get(p.path) !== canonical(p)) throw new Error("transaction_parent_binding");
      parentBindings.set(p.path, canonical(p));
      bindObject(p.device, p.inode, `directory:${p.path}`);
    }
  }
  for (const q of bundle.quarantines) bindObject(q.marker_proof.device, q.marker_proof.inode, `marker:${q.quarantine_id}`);
  // One anchor per marker set: the latest of its quarantine time, completion and every marker/target native time.
  const anchors = new Map(bundle.quarantines.map((q) => [q.quarantine_id, ageAnchor(q.quarantined_at, q.completed,
    [q.marker_proof.birthtime_ns, q.marker_proof.mtime_ns, q.marker_proof.ctime_ns, ...q.targets.flatMap((t) => [t.proof.birthtime_ns, t.proof.mtime_ns, t.proof.ctime_ns])])]));
  const agedAt = (q: z.infer<typeof nativeBarQuarantineEvidenceSchema>, clock: Clock) => {
    if (ageReasons(anchors.get(q.quarantine_id)!, clock).length) throw new Error("transaction_purge_age_unverified");
  };
  // Staging is the first purge step and cannot be undone within purge, so age gates it as it gates unlink: a young
  // or post-reboot set must stay in place rather than be stranded in holding.
  if (purge) for (const q of bundle.quarantines) agedAt(q, intent.created);
  const hash = evidenceHash(intent), attempts = new Map(bundle.attempts.map((a) => [a.attempt_id, a]));
  if (attempts.size !== bundle.attempts.length) throw new Error("transaction_duplicate_attempt");
  const attemptHashes = new Map(bundle.attempts.map((a) => [a.attempt_id, evidenceHash(a)]));
  const targetIds = new Set(targets.map((t) => t.target_id));
  for (const a of attempts.values()) {
    if (a.maintenance_id !== intent.maintenance_id || a.intent_hash !== hash || a.binding_hash !== evidenceHash(intent.binding)
      || a.reference_hash !== intent.baseline.reference_hash || Date.parse(a.expires_at) - Date.parse(a.issued.utc_at) !== 600000
      || a.issued.utc_at < intent.created.utc_at || new Set(a.actions.map((s) => `${s.target_id}:${s.action}`)).size !== a.actions.length
      || a.actions.some((s) => !targetIds.has(s.target_id) || !(purge ? ["stage", "unlink", "verify", "reconcile_absence"] : ["stage", "quarantine", "verify"]).includes(s.action))
      || a.observations.length !== targets.length || new Set(a.observations.map((o) => o.target_id)).size !== targets.length
      || a.observations.some((o) => !targetIds.has(o.target_id))) throw new Error("transaction_attempt_binding");
    if (purge && a.actions.some((s) => s.action === "stage" || s.action === "unlink")) for (const q of bundle.quarantines) agedAt(q, a.issued);
  }
  type State = { target_id: string; state: string; proof: Proof; pending_clock?: Clock; pending_hash?: string;
    pending_attempt?: string; terminal_hash?: string; terminal_attempt?: string;
    blocked_attempt?: string; blocked?: "conflict" | "durability_unknown" };
  const states = new Map<string, State>(targets.map((t) => [t.target_id, { target_id: t.target_id, state: "source", proof: t.proof }]));
  let previous: string | null = null, previousClock = intent.created, active: string | null = null;
  const used = new Set<string>(), blocked = new Set<string>();
  let conflictRecorded = false;
  const observations = new Map<string, Map<string, z.infer<typeof observationSchema>>>();
  for (const [index, e] of bundle.events.entries()) {
    const a = attempts.get(e.attempt_id), state = states.get(e.target_id);
    if (!a || !state || e.maintenance_id !== intent.maintenance_id || e.intent_hash !== hash || e.attempt_hash !== attemptHashes.get(a.attempt_id)
      || e.sequence !== index + 1 || e.previous_event_hash !== previous) throw new Error("transaction_event_binding");
    if (active !== a.attempt_id) {
      if (used.has(a.attempt_id) || a.resume_after_event_hash !== previous) throw new Error("transaction_attempt_prefix");
      clockOrder(previousClock, a.issued, true);
      const checked = new Map(a.observations.map((o) => [o.target_id, o]));
      for (const s of states.values()) {
        const o = checked.get(s.target_id)!;
        const present = (["source", "holding", "quarantine"] as const).filter((p) => o[p] !== null);
        if (present.length > 1) throw new Error("transaction_observation_conflict");
        const place = present[0], p = place ? o[place]! : null;
        const allowed = s.state === "move_pending" ? ["source", "holding"] : s.state === "quarantine_move_pending" ? ["holding", "quarantine"]
          : s.state === "unlink_pending" ? ["holding", undefined] : s.state === "purged" || s.state === "absent_unconfirmed" ? [undefined]
          : [s.state === "quarantined" ? "quarantine" : s.state];
        if (!allowed.includes(place)) throw new Error("transaction_observation_conflict");
        if (p) {
          proofAt(p, a.issued);
          const moved = s.state === "move_pending" && place === "holding" || s.state === "quarantine_move_pending" && place === "quarantine";
          if (moved && s.pending_clock) movedProof(s.proof, p, s.pending_clock, a.issued);
          else if (!same(p, s.proof)) throw new Error("transaction_observation_conflict");
        }
      }
      observations.set(a.attempt_id, checked);
      active = a.attempt_id; used.add(active);
      previousClock = a.issued;
    }
    withinAttempt(a, e.clock); clockOrder(previousClock, e.clock, false);
    const action = e.type === "move_pending" || e.type === "held_verified" ? "stage" : e.type === "unlink_pending" || e.type === "unlinked" ? "unlink"
      : e.type === "recovered_verified" || e.type === "terminal_absence_verified" ? "verify" : e.type === "reconciled_absence" ? "reconcile_absence" : "quarantine";
    if (e.type !== "failure" && !a.actions.some((s) => s.target_id === e.target_id && s.action === action)) throw new Error("transaction_action_not_approved");
    if (blocked.size && !["recovered_verified", "reconciled_absence", "terminal_absence_verified", "failure"].includes(e.type)) throw new Error("transaction_blocked");
    // A conflict needs a separately reviewed resolution; ordinary recovery clears only durability_unknown.
    if (state.blocked === "conflict" && e.type !== "failure") throw new Error("transaction_conflict_requires_resolution");
    if (["held_verified", "quarantined_verified", "unlinked"].includes(e.type)
      && state.pending_attempt !== a.attempt_id) throw new Error("transaction_pending_attempt");
    if (e.type === "move_pending" || e.type === "quarantine_move_pending") {
      const expected = e.type === "move_pending" ? "source" : "holding";
      if (state.state !== expected || !same(state.proof, e.proof)) throw new Error("transaction_illegal_transition");
      if (purge && e.type === "move_pending") agedAt(quarantineForTarget.get(e.target_id)!, e.clock);
      state.state = e.type; state.pending_clock = e.clock; state.pending_hash = evidenceHash(e); state.pending_attempt = a.attempt_id;
    } else if (e.type === "failure") {
      state.blocked = state.blocked === "conflict" ? "conflict" : e.outcome; state.blocked_attempt = a.attempt_id;
      blocked.add(state.target_id); if (e.outcome === "conflict") conflictRecorded = true;
    } else if (e.type === "terminal_absence_verified") {
      const o = observations.get(a.attempt_id)!.get(e.target_id)!;
      if (!purge || !["purged", "absent_unconfirmed"].includes(state.state) || !a.resume_after_event_hash
        || a.attempt_id === state.terminal_attempt || a.attempt_id === state.blocked_attempt
        || e.from_terminal_event_hash !== state.terminal_hash || o.source || o.holding || o.quarantine) throw new Error("transaction_terminal_absence_binding");
      // Recheck current absence without rewriting the original terminal event or its certainty.
      delete state.blocked; delete state.blocked_attempt; blocked.delete(state.target_id);
    } else if (e.type === "recovered_verified" || e.type === "reconciled_absence") {
      if (!a.resume_after_event_hash || a.attempt_id === state.pending_attempt || a.attempt_id === state.blocked_attempt
        || e.from_pending_event_hash !== (state.pending_hash ?? null)) throw new Error("transaction_recovery_binding");
      const o = observations.get(a.attempt_id)!.get(e.target_id)!;
      if (e.type === "reconciled_absence") {
        if (!purge || state.state !== "unlink_pending" || o.source || o.holding || o.quarantine) throw new Error("transaction_recovery_binding");
        state.state = "absent_unconfirmed"; state.terminal_hash = evidenceHash(e); state.terminal_attempt = a.attempt_id;
      } else {
        const allowed = state.state === "move_pending" ? ["source", "holding"] : state.state === "quarantine_move_pending" ? ["holding", "quarantine"]
          : state.state === "unlink_pending" ? ["holding"]
          : ["source", "holding", "quarantined"].includes(state.state) ? [state.state === "quarantined" ? "quarantine" : state.state] : [];
        if (!allowed.includes(e.location) || !same(o[e.location], e.proof)) throw new Error("transaction_recovery_binding");
        state.proof = e.proof; state.state = e.location === "quarantine" ? "quarantined" : e.location;
      }
      delete state.blocked; delete state.blocked_attempt; delete state.pending_clock; delete state.pending_hash; delete state.pending_attempt;
      blocked.delete(state.target_id);
    } else if (e.type === "unlink_pending") {
      if (!purge || state.state !== "holding" || !same(state.proof, e.proof)
        || e.reference_hash !== intent.baseline.reference_hash || [...states.values()].some((s) => !["holding", "unlink_pending", "purged", "absent_unconfirmed"].includes(s.state))) throw new Error("transaction_illegal_unlink");
      agedAt(quarantineForTarget.get(e.target_id)!, e.clock);
      state.state = "unlink_pending"; state.pending_clock = e.clock; state.pending_hash = evidenceHash(e); state.pending_attempt = a.attempt_id;
    } else if (e.type === "unlinked") {
      if (!purge || state.state !== "unlink_pending" || !same(state.proof, e.proof)) throw new Error("transaction_illegal_transition");
      state.state = "purged"; state.terminal_hash = evidenceHash(e); state.terminal_attempt = a.attempt_id;
      delete state.pending_clock; delete state.pending_hash; delete state.pending_attempt;
    } else {
      const expected = e.type === "held_verified" ? "move_pending" : "quarantine_move_pending";
      if (state.state !== expected || !state.pending_clock) throw new Error("transaction_illegal_transition");
      movedProof(state.proof, e.proof, state.pending_clock, e.clock);
      state.state = e.type === "held_verified" ? "holding" : "quarantined"; state.proof = e.proof;
      delete state.pending_clock; delete state.pending_hash; delete state.pending_attempt;
    }
    previous = evidenceHash(e); previousClock = e.clock;
  }
  let status = [...states.values()].some((s) => s.blocked === "conflict") ? "conflict" : !bundle.events.length ? "not_started_or_unconfirmed"
    : [...states.values()].some((s) => s.blocked || s.state === "unlink_pending")
    ? "durability_unknown" : [...states.values()].every((s) => s.state === "quarantined") ? "quarantine_incomplete" : "incomplete";
  if (bundle.completion) {
    const c = bundle.completion, marker = c.marker;
    if (!previous || c.maintenance_id !== intent.maintenance_id || c.intent_hash !== hash || c.last_event_hash !== previous
      || !same(c.attempt_hashes, [...used].map((id) => attemptHashes.get(id)!))
      || c.outcome !== ([...states.values()].some((s) => s.state === "absent_unconfirmed") ? "resolved_with_uncertainty" : "complete")
      || c.targets.length !== targets.length || new Set(c.targets.map((t) => t.target_id)).size !== targets.length
      || c.targets.some((t) => states.get(t.target_id)?.state !== t.state || !same(purge ? null : states.get(t.target_id)?.proof, t.proof))
      || [...states.values()].some((s) => s.blocked || !(purge ? ["purged", "absent_unconfirmed"] : ["quarantined"]).includes(s.state))) throw new Error("transaction_completion_binding");
    clockOrder(previousClock, c.clock);
    withinAttempt(attempts.get(active!)!, c.clock);
    if (purge ? marker !== null : !marker || marker.path !== `quarantine/abandoned/${intent.maintenance_id}/timestamp.json`
      || marker.proof.device !== intent.binding.root.device || marker.proof.uid !== intent.binding.root.uid
      || BigInt(marker.proof.birthtime_ns) < utcNs(previousClock)) throw new Error("transaction_completion_binding");
    if (marker) {
      proofAt(marker.proof, c.clock);
      bindObject(marker.proof.device, marker.proof.inode, `marker:${intent.maintenance_id}`);
    }
    status = c.outcome;
  }
  const result = { schema: "native-bar-transaction-replay-v2" as const, status,
    verification_scope: "supplied_records_only" as const, execution_available: false as const,
    original_acknowledgement: "not_proven" as const, maintenance_id: intent.maintenance_id, intent_hash: evidenceHash(intent),
    targets: [...states.values()].map((s) => ({ target_id: s.target_id, state: s.blocked ?? s.state, phase: s.state,
      proof: ["purged", "absent_unconfirmed"].includes(s.state) ? null : s.proof })),
    spent_markers: purge && status === "complete" && !conflictRecorded ? bundle.quarantines.map((q) => q.quarantine_id) : [] as string[] };
  if (Buffer.byteLength(canonical(result)) > L.response_bytes) throw new Error("transaction_response_limit");
  return result;
}
