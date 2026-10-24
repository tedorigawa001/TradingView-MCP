import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { nativeBarTransactionIntentSchema, nativeBarTransactionManifestSchema, nativeBarTransactionAttemptSchema,
  nativeBarTransactionEventSchema, nativeBarTransactionProofSchema, replayNativeBarTransaction } from "./nativeBarTransactions.js";

export const NATIVE_BAR_RECOVERY_LIMITS = Object.freeze({ targets: 2, attempts: 3, record_bytes: 65536,
  initial_entries: 128, recovery_entries: 512, metadata_bytes: 16 * 1024 ** 2, inventory_bytes: 1024 ** 3,
  read_bytes: 256 * 1024 ** 2, response_bytes: 8 * 1024 ** 2, roots: 8, descriptors: 512 });
const L = NATIVE_BAR_RECOVERY_LIMITS;
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const uuid = nativeBarId.refine((s) => s === s.toLowerCase(), "lower-case identifier required");
const relative = z.string().min(1).max(512).refine((s) => !s.includes("\\") && !s.includes("\0")
  && s.split("/").every((p) => p && p !== "." && p !== ".."), "canonical relative path required");
const ordinal = z.number().int().min(1).max(3);
const layoutInputSchema = z.strictObject({ maintenance_id: uuid, chunk_id: uuid, reserve_id: uuid,
  attempt_ids: z.tuple([uuid, uuid, uuid]), target_count: z.number().int().min(1).max(2), temporary_ids: z.array(uuid).min(69).max(111) });
const publicationSchema = z.strictObject({ role: z.enum(["manifest", "intent", "attempt", "event", "marker", "completion"]), path: relative,
  ordinal: ordinal.nullable(), sequence: z.number().int().min(1).max(28).nullable(),
  temporaries: z.array(z.strictObject({ ordinal, path: relative })).length(3) });
export const nativeBarRecoveryLayoutSchema = z.strictObject({ schema: z.literal("native-bar-recovery-layout-v5"), maintenance_id: uuid,
  chunk_id: uuid, reserve_id: uuid, attempt_ids: z.tuple([uuid, uuid, uuid]), target_count: z.number().int().min(1).max(2),
  reserve_path: relative, directories: z.array(relative).length(9), publications: z.array(publicationSchema).min(23).max(37), execution_available: z.literal(false) });
type Layout = z.infer<typeof nativeBarRecoveryLayoutSchema>;

export function createNativeBarRecoveryLayout(input: unknown): Layout {
  const v = layoutInputSchema.parse(input), count = 9 + 14 * v.target_count;
  const ids = [v.maintenance_id, v.chunk_id, v.reserve_id, ...v.attempt_ids, ...v.temporary_ids];
  if (v.temporary_ids.length !== 3 * count || new Set(ids).size !== ids.length) throw new Error("recovery_layout_identifiers");
  const prefix = `maintenance/${v.maintenance_id}`, holding = `maintenance-hold/${v.maintenance_id}`, final = `quarantine/abandoned/${v.maintenance_id}`;
  const publications: Omit<z.infer<typeof publicationSchema>, "temporaries">[] = [
    { role: "manifest", path: `${prefix}.manifest/${v.chunk_id}.json`, ordinal: null, sequence: null },
    { role: "intent", path: `${prefix}.json`, ordinal: null, sequence: null },
    ...v.attempt_ids.map((id, i) => ({ role: "attempt" as const, path: `${prefix}.attempts/${id}.json`, ordinal: i + 1, sequence: null })),
    ...Array.from({ length: 14 * v.target_count }, (_, i) => ({ role: "event" as const, path: `${prefix}.events/${i + 1}.json`, ordinal: null, sequence: i + 1 })),
    ...v.attempt_ids.map((id, i) => ({ role: "marker" as const, path: `${final}/${id}.timestamp.json`, ordinal: i + 1, sequence: null })),
    { role: "completion", path: `${prefix}.done.json`, ordinal: null, sequence: null }];
  return nativeBarRecoveryLayoutSchema.parse({ schema: "native-bar-recovery-layout-v5", maintenance_id: v.maintenance_id,
    chunk_id: v.chunk_id, reserve_id: v.reserve_id, attempt_ids: v.attempt_ids, target_count: v.target_count,
    reserve_path: `.quarantine-reserve-${v.reserve_id}.tmp`, directories: ["maintenance", `${prefix}.manifest`, `${prefix}.events`, `${prefix}.attempts`,
      "maintenance-hold", holding, "quarantine", "quarantine/abandoned", final],
    publications: publications.map((p, index) => ({ ...p, temporaries: v.attempt_ids.map((_, i) => ({ ordinal: i + 1,
      path: `.publication-${v.temporary_ids[3 * index + i]}.tmp` })) })), execution_available: false });
}
function validateLayout(layout: Layout) {
  const rebuilt = createNativeBarRecoveryLayout({ maintenance_id: layout.maintenance_id, chunk_id: layout.chunk_id,
    reserve_id: layout.reserve_id, attempt_ids: layout.attempt_ids, target_count: layout.target_count,
    temporary_ids: layout.publications.flatMap((p) => p.temporaries.map((t) => t.path.slice(".publication-".length, -4))) });
  if (canonical(layout) !== canonical(rebuilt)) throw new Error("recovery_layout_binding");
}
const flags = uint.refine((v) => !/^[0-9]+$/.test(v) || BigInt(v) <= 4294967295n);
const clockSchema = z.strictObject({ utc_at: nativeBarTimestamp, elapsed: z.null() });
const directorySchema = z.strictObject({ device: uint, inode: uint, uid: uint, gid: uint, mode: z.literal("16832"),
  birthtime_ns: uint, flags, acl: z.enum(["none", "deny_only"]), acl_hash: nativeBarHash });
const nativeProofSchema = nativeBarTransactionProofSchema.extend({ flags, acl_hash: nativeBarHash });
const nativeBindingSchema = z.strictObject({ root: directorySchema, ancestor_digest: nativeBarHash,
  targets: z.array(z.strictObject({ target_id: uuid, flags, acl_hash: nativeBarHash,
    parents: z.array(z.strictObject({ path: relative, proof: directorySchema })).min(1).max(16) })).min(1).max(2) });
export const nativeBarRecoveryInitialPlanSchema = z.strictObject({ schema: z.literal("native-bar-quarantine-plan-v5"), plan_id: uuid,
  opened_at: nativeBarTimestamp, expires_at: nativeBarTimestamp, binding: nativeBarTransactionIntentSchema.shape.binding,
  baseline: nativeBarTransactionIntentSchema.shape.baseline, native_binding: nativeBindingSchema,
  targets: nativeBarTransactionManifestSchema.shape.targets.max(2), layout: nativeBarRecoveryLayoutSchema, plan_hash: nativeBarHash });
const scopeSchema = z.strictObject({ schema: z.literal("native-bar-recovery-scope-v5"), fixture_id: uuid,
  initial_plan_hash: nativeBarHash, native_binding_hash: nativeBarHash, manifest_hash: nativeBarHash, inputs_digest: nativeBarHash,
  layout_directories: z.array(z.strictObject({ path: relative, proof: directorySchema })).length(9),
  allocation: z.strictObject({ path: relative, proof: nativeProofSchema, allocated_bytes: uint, acknowledged: clockSchema }) });
export const nativeBarRecoveryOriginalSchema = z.strictObject({ schema: z.literal("native-bar-quarantine-intent-v5"),
  plan: nativeBarRecoveryInitialPlanSchema, scope: scopeSchema, scope_digest: nativeBarHash,
  intent: nativeBarTransactionIntentSchema, manifest: nativeBarTransactionManifestSchema });
type Original = z.infer<typeof nativeBarRecoveryOriginalSchema>;
const auditSchema = z.strictObject({ schema: z.literal("native-bar-recovery-attempt-plan-v5"), plan_id: uuid, maintenance_id: uuid, ordinal,
  scope_digest: nativeBarHash, original_envelope_hash: nativeBarHash, intent_hash: nativeBarHash,
  prefix_hash: nativeBarHash.nullable(), prefix_count: z.number().int().nonnegative().max(28), opened_at: nativeBarTimestamp,
  issued_at: nativeBarTimestamp, observed_at: nativeBarTimestamp, expires_at: nativeBarTimestamp,
  inventory_hash: nativeBarHash, reference_hash: nativeBarHash, current_reference_hash: nativeBarHash, native_binding_hash: nativeBarHash,
  observations: nativeBarTransactionAttemptSchema.shape.observations.max(2), actions: nativeBarTransactionAttemptSchema.shape.actions.max(6), plan_hash: nativeBarHash });
export const nativeBarRecoveryAttemptSchema = z.strictObject({ schema: z.literal("native-bar-recovery-attempt-v5"), ordinal,
  previous_envelope_hash: nativeBarHash.nullable(), attempt: nativeBarTransactionAttemptSchema, plan: auditSchema });
export const nativeBarRecoveryMarkerSchema = z.strictObject({ schema: z.literal("native-bar-recovery-timestamp-v5"), maintenance_id: uuid,
  attempt_id: uuid, intent_hash: nativeBarHash, last_event_hash: nativeBarHash,
  targets: z.array(z.strictObject({ target_id: uuid, proof: nativeBarTransactionProofSchema })).min(1).max(2),
  verified_at: nativeBarTimestamp });
const markerEvidenceSchema = z.strictObject({ record: nativeBarRecoveryMarkerSchema, proof: nativeProofSchema });
export const nativeBarRecoveryCompletionSchema = z.strictObject({ schema: z.literal("native-bar-recovery-completion-v5"), maintenance_id: uuid,
  intent_hash: nativeBarHash, last_event_hash: nativeBarHash, published_attempt_hashes: z.array(nativeBarHash).min(1).max(3),
  used_attempt_hashes: z.array(nativeBarHash).min(1).max(3), final_attempt_id: uuid, clock: clockSchema,
  marker: z.strictObject({ path: relative, hash: nativeBarHash, proof: nativeProofSchema,
    publication: z.strictObject({ before: clockSchema, after: clockSchema }) }),
  targets: z.array(z.strictObject({ target_id: uuid, proof: nativeBarTransactionProofSchema })).min(1).max(2) });
export const nativeBarRecoveryBundleSchema = z.strictObject({ schema: z.literal("native-bar-recovery-bundle-v5"),
  original: nativeBarRecoveryOriginalSchema.nullable(), attempts: z.array(nativeBarRecoveryAttemptSchema).max(3),
  events: z.array(nativeBarTransactionEventSchema).max(28), markers: z.array(markerEvidenceSchema).max(3),
  completion: nativeBarRecoveryCompletionSchema.nullable() });
type Bundle = z.infer<typeof nativeBarRecoveryBundleSchema>;
type NativeProof = z.infer<typeof nativeProofSchema>;
type Observation = z.infer<typeof nativeBarTransactionAttemptSchema>["observations"][number];
type Replay = ReturnType<typeof replayNativeBarTransaction>;
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function referenceGeneration(v: { inventory_hash: string; reference_hash: string; native_binding_hash: string }) {
  return evidenceHash({ inventory_hash: v.inventory_hash, original_reference_hash: v.reference_hash, native_binding_hash: v.native_binding_hash });
}
function hashFields(v: object, field = "plan_hash") { const fields = { ...v } as Record<string, unknown>; delete fields[field]; return evidenceHash(fields); }
function window(opened: string, expires: string) { if (Date.parse(expires) - Date.parse(opened) !== 600000) throw new Error("recovery_window_binding"); }
function recordSize(v: unknown) { if (Buffer.byteLength(canonical(v), "utf8") > L.record_bytes) throw new Error("recovery_record_limit"); }
function baseProof(p: NativeProof) { const { flags: f, acl_hash, ...proof } = p; void f; void acl_hash; return proof; }
function proofClock(p: z.infer<typeof nativeBarTransactionProofSchema>, at: string) {
  if (BigInt(p.birthtime_ns) < 0n || BigInt(p.birthtime_ns) > BigInt(p.ctime_ns)
    || [p.birthtime_ns, p.mtime_ns, p.ctime_ns].some((v) => BigInt(v) > BigInt(Date.parse(at)) * 1000000n + 999999n)) throw new Error("recovery_proof_clock");
}
function originalIdentifiers(o: Original) {
  const { plan: p, scope: s, manifest: m } = o;
  return [p.layout.maintenance_id, p.layout.chunk_id, p.layout.reserve_id, ...p.layout.attempt_ids, p.plan_id, s.fixture_id,
    ...p.layout.publications.flatMap((p) => p.temporaries.map((t) => t.path.slice(".publication-".length, -4))),
    ...m.targets.flatMap((t) => [t.target_id, t.origin.kind === "capture" ? t.origin.recording_id : "invalid"])];
}
function nativeDirectories(o: Original) {
  return [o.plan.native_binding.root, ...o.plan.native_binding.targets.flatMap((t) => t.parents.map((p) => p.proof)),
    ...o.scope.layout_directories.map((p) => p.proof)];
}
function validateOriginal(o: Original) {
  const { plan: p, intent: i, manifest: m, scope: s } = o; validateLayout(p.layout); window(p.opened_at, p.expires_at);
  if (hashFields(p) !== p.plan_hash || p.binding.policy_hash !== evidenceHash({ schema: "native-bar-synthetic-quarantine-recovery-profile-v5" })
    || i.kind !== "quarantine_abandoned" || i.maintenance_id !== p.layout.maintenance_id || m.maintenance_id !== i.maintenance_id
    || m.chunk_id !== p.layout.chunk_id || i.target_count !== p.layout.target_count || !same(p.targets, m.targets)
    || p.targets.length !== p.layout.target_count || !same(i.binding, p.binding) || !same(i.baseline, p.baseline)
    || i.approval_plan_hash !== p.plan_hash || i.created.utc_at !== p.opened_at || i.created.elapsed !== null || i.quarantine_refs.length
    || !same(i.manifests, [{ chunk_id: m.chunk_id, hash: evidenceHash(m) }])) throw new Error("recovery_original_binding");
  const root = p.native_binding.root;
  if (!same(i.binding.root, { device: root.device, inode: root.inode, uid: root.uid, mode: root.mode, acl: root.acl })
    || p.native_binding.targets.length !== m.targets.length || new Set(p.native_binding.targets.map((t) => t.target_id)).size !== m.targets.length)
    throw new Error("recovery_native_binding");
  const ids = originalIdentifiers(o);
  if (new Set(ids).size !== ids.length || ids.some((v) => !uuid.safeParse(v).success)) throw new Error("recovery_role_identifiers");
  const directories = new Map<string, z.infer<typeof directorySchema>>([[".", root]]);
  for (const { path, proof } of [{ path: ".", proof: root }, ...p.native_binding.targets.flatMap((t) => t.parents)]) {
    if (proof.device !== root.device || proof.uid !== root.uid || BigInt(proof.birthtime_ns) > BigInt(Date.parse(p.opened_at)) * 1000000n + 999999n
      || directories.has(path) && !same(directories.get(path), proof)) throw new Error("recovery_native_binding");
    directories.set(path, proof);
  }
  for (const t of m.targets) {
    const access = p.native_binding.targets.find((v) => v.target_id === t.target_id);
    if (t.origin.kind !== "capture" || t.source_path.split("/").at(-1) !== `${t.origin.recording_id}.json`
      || !/^captures\/[0-9]{4}-[0-9]{2}-[0-9]{2}\//.test(t.source_path) || t.source_path.split("/").length !== 3
      || !access || !same(access.parents.map(({ path, proof }) => ({ path, device: proof.device, inode: proof.inode,
        uid: proof.uid, mode: proof.mode, acl: proof.acl })), t.parents)) throw new Error("recovery_target_binding");
    nativeBarTimestamp.parse(t.source_path.split("/")[1] + "T00:00:00.000Z");
  }
  const allocation = s.allocation, b = BigInt((4 * (9 + 14 * m.targets.length) + 32) * 65536 + 1048576);
  if (!same(s.layout_directories.map((d) => d.path), p.layout.directories)) throw new Error("recovery_layout_directory_binding");
  const directoryIds = new Set([...directories.values()].map((d) => `${d.device}:${d.inode}`));
  for (const { proof } of s.layout_directories) {
    const key = `${proof.device}:${proof.inode}`;
    if (proof.device !== root.device || proof.uid !== root.uid || directoryIds.has(key)
      || BigInt(proof.birthtime_ns) > BigInt(Date.parse(allocation.acknowledged.utc_at)) * 1000000n + 999999n)
      throw new Error("recovery_layout_directory_binding");
    directoryIds.add(key);
  }
  if (o.scope_digest !== evidenceHash(s) || s.initial_plan_hash !== p.plan_hash || s.manifest_hash !== evidenceHash(m)
    || s.native_binding_hash !== evidenceHash(p.native_binding) || allocation.path !== p.layout.reserve_path
    || BigInt(allocation.allocated_bytes) < b || allocation.proof.size !== "0" || allocation.proof.device !== root.device
    || allocation.proof.uid !== root.uid || allocation.acknowledged.utc_at < p.opened_at || allocation.acknowledged.utc_at >= p.expires_at
    || BigInt(allocation.proof.birthtime_ns) < BigInt(Date.parse(p.opened_at)) * 1000000n
    || nativeDirectories(o).some((d) => d.device === allocation.proof.device && d.inode === allocation.proof.inode)
    || m.targets.some((t) => t.proof.device === allocation.proof.device && t.proof.inode === allocation.proof.inode)) throw new Error("recovery_scope_binding");
  proofClock(allocation.proof, allocation.acknowledged.utc_at);
  for (const r of [o, m, p, s]) recordSize(r);
}
function replayPrefix(b: Bundle, events = b.events) {
  return replayNativeBarTransaction({ schema: "native-bar-transaction-bundle-v2", intent: b.original!.intent,
    manifests: [b.original!.manifest], attempts: b.attempts.map((v) => v.attempt), events, quarantines: [], completion: null });
}
function observe(state: Replay["targets"][number], o: Observation, events: Bundle["events"], at: string) {
  const places = (["source", "holding", "quarantine"] as const).filter((p) => o[p] !== null);
  if (places.length !== 1) throw new Error("recovery_location_conflict");
  const place = places[0], proof = o[place]!, before = state.proof!;
  const allowed = state.state === "move_pending" ? ["source", "holding"] : state.state === "quarantine_move_pending" ? ["holding", "quarantine"]
    : [state.state === "quarantined" ? "quarantine" : state.state];
  if (!allowed.includes(place)) throw new Error("recovery_location_conflict");
  proofClock(proof, at);
  if (state.state === "move_pending" && place === "holding" || state.state === "quarantine_move_pending" && place === "quarantine") {
    const pending = [...events].reverse().find((e) => e.target_id === state.target_id && (e.type === "move_pending" || e.type === "quarantine_move_pending"));
    const { ctime_ns: oldTime, ...old } = before, { ctime_ns: newTime, ...fresh } = proof;
    if (!pending || !same(old, fresh) || BigInt(newTime) < BigInt(oldTime)
      || BigInt(newTime) < BigInt(Date.parse(pending.clock.utc_at)) * 1000000n) throw new Error("recovery_location_conflict");
  } else if (!same(before, proof)) throw new Error("recovery_location_conflict");
  return { place, proof };
}
function remainingSteps(place: "source" | "holding" | "quarantine", recover: boolean) {
  return [...(recover ? [`recovered_${place}`] : []), ...(place === "source" ? ["move_pending", "stage", "held_verified"] : []),
    ...(place !== "quarantine" ? ["quarantine_move_pending", "quarantine", "quarantined_verified"] : [])];
}
function permittedActions(target_id: string, steps: string[]) {
  return [...new Set(steps.flatMap((s) => s.startsWith("recovered_") ? ["verify" as const]
    : s === "stage" ? ["stage" as const] : s === "quarantine" ? ["quarantine" as const] : []))].map((action) => ({ target_id, action }));
}
function validateAttempts(b: Bundle) {
  const o = b.original!, ids = new Map(b.attempts.map((a) => [a.attempt.attempt_id, a.ordinal]));
  if (ids.size !== b.attempts.length || b.events.some((e) => !ids.has(e.attempt_id))) throw new Error("recovery_attempt_binding");
  let lastOrdinal = 0;
  for (const event of b.events) {
    const ord = ids.get(event.attempt_id)!;
    if (ord < lastOrdinal || event.clock.elapsed !== null || event.clock.utc_at < o.scope.allocation.acknowledged.utc_at
      || !["move_pending", "held_verified", "quarantine_move_pending", "quarantined_verified", "recovered_verified"].includes(event.type)
      || ord === 1 && event.type === "recovered_verified") throw new Error("recovery_event_scope");
    lastOrdinal = ord;
  }
  for (const [index, env] of b.attempts.entries()) {
    recordSize(env); const a = env.attempt, p = env.plan, prior = b.attempts[index - 1]; window(p.opened_at, p.expires_at);
    const prefix = b.events.filter((e) => ids.get(e.attempt_id)! < env.ordinal), own = b.events.filter((e) => e.attempt_id === a.attempt_id);
    const prefixHash = prefix.length ? evidenceHash(prefix.at(-1)) : null;
    if (prior && prior.ordinal >= env.ordinal || env.previous_envelope_hash !== (prior ? evidenceHash(prior) : null)
      || a.attempt_id !== o.plan.layout.attempt_ids[env.ordinal - 1] || p.ordinal !== env.ordinal || p.maintenance_id !== o.intent.maintenance_id
      || p.scope_digest !== o.scope_digest || p.original_envelope_hash !== evidenceHash(o) || p.intent_hash !== evidenceHash(o.intent)
      || hashFields(p) !== p.plan_hash || p.native_binding_hash !== evidenceHash(o.plan.native_binding)
      || p.prefix_count !== prefix.length || p.prefix_hash !== prefixHash || a.resume_after_event_hash !== prefixHash
      || a.issued.elapsed !== null || a.issued.utc_at !== p.opened_at || a.expires_at !== p.expires_at
      || env.ordinal === 1 && (p.opened_at !== o.plan.opened_at || p.expires_at !== o.plan.expires_at)
      || a.approval_plan_hash !== (env.ordinal === 1 ? o.plan.plan_hash : p.plan_hash)
      || p.reference_hash !== o.intent.baseline.reference_hash || p.current_reference_hash !== referenceGeneration(p)
      || !same(p.observations, a.observations) || !same(p.actions, a.actions)
      || p.issued_at < p.opened_at || p.observed_at <= p.issued_at || p.observed_at >= p.expires_at
      || prefix.some((e) => e.clock.utc_at > p.opened_at) || prior && prior.plan.observed_at > p.opened_at
      || own.some((e) => e.clock.utc_at < p.observed_at)) throw new Error("recovery_attempt_binding");
    const replay = replayPrefix(b, prefix);
    if (a.observations.length !== o.manifest.targets.length || new Set(a.observations.map((v) => v.target_id)).size !== a.observations.length) throw new Error("recovery_observation_binding");
    const planned = new Map<string, string[]>();
    const actions = o.manifest.targets.flatMap((t) => {
      const state = replay.targets.find((v) => v.target_id === t.target_id)!, observation = a.observations.find((v) => v.target_id === t.target_id);
      if (!observation) throw new Error("recovery_observation_binding");
      const { place } = observe(state, observation, prefix, p.opened_at), steps = remainingSteps(place, env.ordinal !== 1 && prefix.length > 0);
      planned.set(t.target_id, steps); return permittedActions(t.target_id, steps);
    });
    if (!same(a.actions, actions)) throw new Error("recovery_remaining_action_scope");
    for (const t of o.manifest.targets) {
      const events = own.filter((e) => e.target_id === t.target_id), types = events.map((e) => e.type);
      if (events.length > (env.ordinal === 1 ? 4 : 5) || new Set(types).size !== types.length) throw new Error("recovery_event_capacity");
      // A planned fresh verification must be the first step of this attempt for that target, not an optional extra.
      const first = planned.get(t.target_id)![0];
      if (events.length && first.startsWith("recovered_")
        && !(events[0].type === "recovered_verified" && events[0].location === first.slice("recovered_".length))) throw new Error("recovery_verification_required");
    }
  }
  const planIds = [...originalIdentifiers(o), ...b.attempts.map((e) => e.plan.plan_id)];
  if (new Set(planIds).size !== planIds.length) throw new Error("recovery_plan_identifier");
  for (const event of b.events) recordSize(event);
}
function terminalTargets(replay: Replay) { return replay.targets.map(({ target_id, proof }) => ({ target_id, proof })); }
function validateMarkers(b: Bundle) {
  const o = b.original!, seen = new Set<string>();
  const objects = new Set([...o.manifest.targets.map((t) => `${t.proof.device}:${t.proof.inode}`),
    ...nativeDirectories(o).map((d) => `${d.device}:${d.inode}`),
    `${o.scope.allocation.proof.device}:${o.scope.allocation.proof.inode}`]);
  let previousOrdinal = 0;
  for (const { record: m, proof } of b.markers) {
    recordSize(m); const envelope = b.attempts.find((a) => a.attempt.attempt_id === m.attempt_id);
    const index = b.events.findIndex((e) => evidenceHash(e) === m.last_event_hash), prefix = b.events.slice(0, index + 1);
    if (!envelope || index < 0 || seen.has(m.attempt_id) || envelope.ordinal <= previousOrdinal) throw new Error("recovery_marker_binding");
    seen.add(m.attempt_id); previousOrdinal = envelope.ordinal;
    const a = envelope.attempt, replay = replayPrefix(b, prefix), own = prefix.filter((e) => e.attempt_id === a.attempt_id);
    if (m.maintenance_id !== o.intent.maintenance_id || m.intent_hash !== evidenceHash(o.intent)
      || b.events[index].attempt_id !== a.attempt_id || b.events.some((e, i) => i > index && e.attempt_id === a.attempt_id)
      || replay.targets.some((t) => t.state !== "quarantined") || !same(m.targets, terminalTargets(replay))
      || m.targets.some((t) => { const last = [...own].reverse().find((e) => e.target_id === t.target_id);
        return !last || !(last.type === "quarantined_verified" || last.type === "recovered_verified" && last.location === "quarantine"); })
      || m.verified_at < b.events[index].clock.utc_at || m.verified_at < envelope.plan.observed_at || m.verified_at >= a.expires_at
      || b.attempts.some((e) => e.ordinal > envelope.ordinal && e.plan.opened_at < m.verified_at)
      || proof.device !== o.intent.binding.root.device || proof.uid !== o.intent.binding.root.uid
      || proof.sha256 !== evidenceHash(m) || proof.size !== String(Buffer.byteLength(canonical(m)))
      || [proof.birthtime_ns, proof.mtime_ns, proof.ctime_ns].some((v) => BigInt(v) < BigInt(Date.parse(m.verified_at)) * 1000000n
        || BigInt(v) >= BigInt(Date.parse(a.expires_at)) * 1000000n
        || b.attempts.some((e) => e.ordinal > envelope.ordinal && BigInt(v) > BigInt(Date.parse(e.plan.opened_at)) * 1000000n + 999999n))) throw new Error("recovery_marker_binding");
    proofClock(proof, a.expires_at);
    const identity = `${proof.device}:${proof.inode}`;
    if (objects.has(identity)) throw new Error("recovery_marker_alias"); objects.add(identity);
  }
}
function validateCompletion(b: Bundle, replay: Replay) {
  if (!b.completion) return;
  const c = b.completion, o = b.original!, final = b.attempts.at(-1);
  const m = b.markers.find((e) => e.record.attempt_id === c.final_attempt_id);
  const used = [...new Set(b.events.map((e) => e.attempt_id))]; recordSize(c);
  if (!final || !m || !b.events.length || c.maintenance_id !== o.intent.maintenance_id || c.intent_hash !== evidenceHash(o.intent)
    || c.final_attempt_id !== final.attempt.attempt_id || c.final_attempt_id !== b.events.at(-1)!.attempt_id
    || c.last_event_hash !== evidenceHash(b.events.at(-1)) || c.last_event_hash !== m.record.last_event_hash
    || !same(c.published_attempt_hashes, b.attempts.map(evidenceHash))
    || !same(c.used_attempt_hashes, used.map((id) => evidenceHash(b.attempts.find((a) => a.attempt.attempt_id === id)!.attempt)))
    || c.marker.path !== `quarantine/abandoned/${o.intent.maintenance_id}/${c.final_attempt_id}.timestamp.json`
    || c.marker.hash !== evidenceHash(m.record) || !same(c.marker.proof, m.proof) || replay.targets.some((t) => t.state !== "quarantined")
    || !same(c.targets, terminalTargets(replay)) || c.marker.publication.before.utc_at < m.record.verified_at
    || c.marker.publication.after.utc_at < c.marker.publication.before.utc_at
    || c.clock.utc_at < c.marker.publication.after.utc_at
    || [m.proof.birthtime_ns, m.proof.mtime_ns, m.proof.ctime_ns].some((v) => BigInt(v) < BigInt(Date.parse(c.marker.publication.before.utc_at)) * 1000000n
      || BigInt(v) > BigInt(Date.parse(c.marker.publication.after.utc_at)) * 1000000n + 999999n)
    || c.clock.utc_at >= final.attempt.expires_at) throw new Error("recovery_completion_binding");
  proofClock(c.marker.proof, c.clock.utc_at);
}

/** Checks supplied record consistency only. Controller/OS/approval authentication belongs to R-B and later. */
export function validateNativeBarRecoveryBundle(input: unknown) {
  boundBundleArrays(input);
  const bundle = nativeBarRecoveryBundleSchema.parse(input);
  if (!bundle.original) return { schema: "native-bar-recovery-replay-v5" as const, status: "preparation_incomplete", verification_scope: "supplied_records_only" as const,
    execution_available: false as const, recovery_execution_available: false as const, original_acknowledgement: "not_proven" as const, targets: [],
    elapsed_clock_qualified: false as const };
  validateOriginal(bundle.original);
  validateAttempts(bundle);
  const replay = replayPrefix(bundle);
  validateMarkers(bundle); validateCompletion(bundle, replay);
  return { ...replay, schema: "native-bar-recovery-replay-v5" as const, status: bundle.completion ? "complete" : replay.status,
    recovery_execution_available: false as const, elapsed_clock_qualified: false as const };
}

function boundBundleArrays(input: unknown) {
  const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" ? v as Record<string, unknown> : {};
  const cap = (v: unknown, n: number) => { if (Array.isArray(v) && v.length > n) throw new Error("recovery_input_limit"); };
  const b = object(input), o = object(b.original), p = object(o.plan), layout = object(p.layout);
  cap(b.attempts, 3); cap(b.events, 28); cap(b.markers, 3); cap(object(o.manifest).targets, 2); cap(p.targets, 2);
  cap(layout.publications, 37); cap(layout.directories, 9);
  if (Array.isArray(layout.publications)) for (const v of layout.publications) cap(object(v).temporaries, 3);
}

/** Iterative, so arbitrarily deep input refuses cleanly before any recursive comparison. */
function boundDepth(value: unknown, max = 64) {
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (v === null || typeof v !== "object") continue;
    if (depth >= max) throw new Error("recovery_input_depth");
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
}
/** Canonical bytes supplied by a caller, never a file path or an authenticated native read. */
export function decodeNativeBarRecoveryBundle(input: Uint8Array): Bundle {
  if (!(input instanceof Uint8Array) || input.byteLength > L.response_bytes) throw new Error("recovery_input_limit");
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(input), value: unknown = JSON.parse(raw);
  boundDepth(value); boundBundleArrays(value);
  if (!Buffer.from(input).equals(Buffer.from(canonical(value)))) throw new Error("recovery_noncanonical_record");
  validateNativeBarRecoveryBundle(value); return nativeBarRecoveryBundleSchema.parse(value);
}
const capacitySchema = z.strictObject({ schema: z.literal("native-bar-recovery-capacity-v5"), target_count: z.number().int().min(1).max(2),
  phase: z.enum(["initial", "recovery"]), occupied_inventory_bytes: uint, occupied_metadata_bytes: uint, occupied_allocated_bytes: uint,
  occupied_entries: uint, remaining_publications: z.number().int().nonnegative().max(37), remaining_temporaries: z.number().int().nonnegative().max(111),
  available_bytes: uint.nullable(), reserve_allocated_bytes: uint.nullable(), read_bytes: uint, response_bytes: uint,
  roots: z.number().int().min(1).max(8), descriptors: z.number().int().nonnegative().max(512),
  additional_descriptors: z.number().int().min(48).max(512) });

/** Supplied accounting only: no allocation, deletion credit, native qualification or grant. */
export function calculateNativeBarRecoveryCapacity(input: unknown) {
  const v = capacitySchema.parse(input), publications = 9 + 14 * v.target_count, temporaries = 3 * publications;
  if (v.remaining_publications > publications || v.remaining_temporaries > temporaries
    || v.phase === "initial" && (v.remaining_publications !== publications || v.remaining_temporaries !== temporaries || v.reserve_allocated_bytes !== null)
    || BigInt(v.occupied_metadata_bytes) > BigInt(v.occupied_inventory_bytes)
    || v.occupied_entries === "0" && (v.occupied_inventory_bytes !== "0" || v.occupied_allocated_bytes !== "0")) throw new Error("recovery_capacity_binding");
  const full = BigInt(publications + temporaries + 32) * BigInt(L.record_bytes) + 1048576n;
  const remaining = BigInt(v.remaining_publications + v.remaining_temporaries + 32) * BigInt(L.record_bytes) + 1048576n;
  const newReserve = v.phase === "initial" ? full : 0n, required = newReserve + 2n * remaining;
  const inventory = BigInt(v.occupied_inventory_bytes) + remaining, metadata = BigInt(v.occupied_metadata_bytes) + remaining;
  const allocated = BigInt(v.occupied_allocated_bytes) + newReserve + remaining;
  const entries = BigInt(v.occupied_entries) + BigInt(v.remaining_publications + v.remaining_temporaries + 32) + (v.phase === "initial" ? 1n : 0n);
  const reasons: string[] = [];
  if (BigInt(v.occupied_entries) > BigInt(v.phase === "initial" ? L.initial_entries : L.recovery_entries) || entries > BigInt(L.recovery_entries)) reasons.push("entry_capacity");
  if (inventory > BigInt(L.inventory_bytes)) reasons.push("inventory_capacity");
  if (metadata > BigInt(L.metadata_bytes)) reasons.push("metadata_capacity");
  if (allocated > BigInt(L.inventory_bytes)) reasons.push("physical_capacity");
  if (v.phase === "recovery" && (v.reserve_allocated_bytes === null || BigInt(v.reserve_allocated_bytes) < full
    || BigInt(v.occupied_allocated_bytes) < BigInt(v.reserve_allocated_bytes))) reasons.push("original_allocation_unverified");
  if (v.available_bytes === null || BigInt(v.available_bytes) < required) reasons.push("available_space_unverified_or_insufficient");
  if (BigInt(v.read_bytes) > BigInt(L.read_bytes)) reasons.push("read_capacity");
  if (BigInt(v.response_bytes) > BigInt(L.response_bytes)) reasons.push("response_capacity");
  if (v.descriptors + v.additional_descriptors > L.descriptors) reasons.push("descriptor_capacity");
  return { publications, temporaries, peak_bytes: String(full), remaining_peak_bytes: String(remaining), required_available_bytes: String(required),
    peak_inventory_bytes: String(inventory), peak_metadata_bytes: String(metadata), peak_allocated_bytes: String(allocated), peak_entries: String(entries),
    fits: reasons.length === 0, reasons, verification_scope: "supplied_records_only" as const, capacity_reservation: "not_reserved" as const,
    execution_available: false as const, recovery_execution_available: false as const };
}

const entrySchema = z.strictObject({ path: relative, kind: z.enum(["file", "directory", "other"]), size: uint,
  sha256: nativeBarHash.nullable(), allocated_bytes: uint.nullable(), proof: nativeProofSchema.nullable(), directory_proof: directorySchema.nullable() });
const locationSchema = z.strictObject({ target_id: uuid, source: nativeProofSchema.nullable(), holding: nativeProofSchema.nullable(), quarantine: nativeProofSchema.nullable() });
const accountingSchema = capacitySchema.omit({ schema: true, target_count: true, phase: true, occupied_entries: true,
  remaining_publications: true, remaining_temporaries: true, reserve_allocated_bytes: true });
export const nativeBarRecoveryViewSchema = z.strictObject({ schema: z.literal("native-bar-recovery-view-v5"), observed_at: nativeBarTimestamp,
  inventory_complete: z.boolean(), references_complete: z.boolean(), allocation_complete: z.boolean(), inventory_hash: nativeBarHash,
  reference_hash: nativeBarHash, current_reference_hash: nativeBarHash, native_binding: nativeBindingSchema, entries: z.array(entrySchema).max(512), locations: z.array(locationSchema).max(2),
  reserve: z.strictObject({ proof: nativeProofSchema, allocated_bytes: uint }).nullable(), accounting: accountingSchema });
const controllerSchema = z.strictObject({ original_envelope_hash: nativeBarHash, scope_digest: nativeBarHash,
  consumed_ordinals: z.array(ordinal).min(1).max(3), known_publications: z.array(z.strictObject({ path: relative, hash: nativeBarHash,
    proof: nativeProofSchema })).max(37) });
const requestSchema = z.strictObject({ plan_id: uuid, ordinal, opened_at: nativeBarTimestamp, issued_at: nativeBarTimestamp,
  expires_at: nativeBarTimestamp, checked_at: nativeBarTimestamp, checked_elapsed_ns: uint });
export const nativeBarRecoveryQuerySchema = z.strictObject({ schema: z.literal("native-bar-recovery-query-v5"), bundle: nativeBarRecoveryBundleSchema,
  view: nativeBarRecoveryViewSchema.nullable(), controller: controllerSchema.nullable(), request: requestSchema });

function publishedRecords(b: Bundle) {
  const o = b.original!, id = o.intent.maintenance_id, prefix = `maintenance/${id}`;
  const records = new Map<string, unknown>([["policy.json", { schema: "native-bar-synthetic-quarantine-recovery-profile-v5" }],
    [`${prefix}.manifest/${o.manifest.chunk_id}.json`, o.manifest], [`${prefix}.json`, o]]);
  for (const a of b.attempts) records.set(`${prefix}.attempts/${a.attempt.attempt_id}.json`, a);
  for (const e of b.events) records.set(`${prefix}.events/${e.sequence}.json`, e);
  for (const m of b.markers) records.set(`quarantine/abandoned/${id}/${m.record.attempt_id}.timestamp.json`, m.record);
  if (b.completion) records.set(`${prefix}.done.json`, b.completion);
  return records;
}

/** Descriptive plan over supplied evidence. No controller, approval, clock or filesystem claim is authenticated here. */
export function planNativeBarRecovery(input: unknown) {
  if (input && typeof input === "object") {
    const v = input as Record<string, unknown>; boundBundleArrays(v.bundle);
    if (v.view && typeof v.view === "object") { const entries = (v.view as Record<string, unknown>).entries;
      if (Array.isArray(entries) && entries.length > L.recovery_entries) throw new Error("recovery_input_limit"); }
  }
  const query = nativeBarRecoveryQuerySchema.parse(input), { bundle: b, view: v, controller: controller, request: request } = query;
  const replay = validateNativeBarRecoveryBundle(b), o = b.original;
  const reasons: string[] = [], remaining: { target_id: string; location: string; operations: string[] }[] = [];
  let capacity: ReturnType<typeof calculateNativeBarRecoveryCapacity> | null = null;
  let attempt_plan: z.infer<typeof auditSchema> | null = null;
  const common = { verification_scope: "supplied_records_only" as const, execution_available: false as const, recovery_execution_available: false as const,
    approval_authenticated: false as const, original_acknowledgement: "not_proven" as const, elapsed_clock_qualified: false as const,
    execution_blockers: ["native_recovery_not_connected", "controller_admission_not_authenticated", "fresh_approval_not_authenticated"], recorded_status: replay.status };
  const result = (status: "blocked" | "planned_only" | "complete_read_only") => ({ ...common, status,
    maintenance_id: o?.intent.maintenance_id ?? null, blocking_reasons: [...new Set(reasons)],
    remaining: status === "planned_only" ? remaining : [], attempt_plan: status === "planned_only" ? attempt_plan : null, capacity });
  if (!o) { reasons.push("original_incomplete"); return result("blocked"); }
  if (!v) { reasons.push("view_unavailable"); return result("blocked"); }
  const records = publishedRecords(b), layout = o.plan.layout, entries = new Map(v.entries.map((e) => [e.path, e]));
  if (!v.inventory_complete) reasons.push("inventory_incomplete");
  if (!v.references_complete || v.reference_hash !== o.intent.baseline.reference_hash) reasons.push("references_unverified_or_changed");
  if (v.current_reference_hash !== referenceGeneration({ ...v, native_binding_hash: evidenceHash(v.native_binding) })) reasons.push("current_reference_generation_changed");
  if (!same(v.native_binding, o.plan.native_binding)) reasons.push("native_binding_changed");
  if (v.inventory_hash !== evidenceHash(v.entries) || entries.size !== v.entries.length
    || new Set(v.entries.map((e) => e.path.normalize("NFC").toLowerCase())).size !== entries.size) reasons.push("inventory_binding");
  if (v.observed_at > request.checked_at || v.observed_at < (b.completion?.clock.utc_at ?? b.events.at(-1)?.clock.utc_at ?? o.intent.created.utc_at)
    || v.observed_at < o.scope.allocation.acknowledged.utc_at) reasons.push("observation_clock");
  const temporaries = new Map(layout.publications.flatMap((p) => p.temporaries.map((t) => [t.path, t.ordinal] as const)));
  const targetPaths = new Set(o.manifest.targets.flatMap((t) => [t.source_path, `maintenance-hold/${o.intent.maintenance_id}/${t.target_id}`,
    `quarantine/abandoned/${o.intent.maintenance_id}/${t.target_id}`]));
  const allowed = new Set([...layout.directories, ...records.keys(), ...targetPaths]);
  const maxConsumed = controller ? Math.max(...controller.consumed_ordinals) : 0;
  const objects = new Set(nativeDirectories(o).map((d) => `${d.device}:${d.inode}`));
  for (const e of v.entries) {
    const privatePath = /^(maintenance|maintenance-hold|quarantine|operations)(\/|$)/.test(e.path);
    if (privatePath && !allowed.has(e.path)) reasons.push("unplanned_transaction_entry");
    if (e.path.startsWith(".quarantine-reserve-") && e.path !== layout.reserve_path) reasons.push("unplanned_reserve");
    if (e.path.startsWith(".publication-") && !temporaries.has(e.path)) reasons.push("unplanned_temporary");
    if (temporaries.has(e.path) && (e.kind !== "file" || BigInt(e.size) > BigInt(L.record_bytes)
      || !b.completion && temporaries.get(e.path)! > maxConsumed)) reasons.push("temporary_binding");
    if (e.path.startsWith("receipts/") && o.manifest.targets.some((t) => e.path.split("/").at(-1) === t.source_path.split("/").at(-1))) reasons.push("receipt_reference");
    if (e.kind === "file") {
      if (e.directory_proof || !e.proof || e.proof.sha256 !== e.sha256 || e.proof.size !== e.size || e.proof.uid !== o.intent.binding.root.uid
        || e.proof.device !== o.intent.binding.root.device) reasons.push("entry_proof_binding");
      else {
        const key = `${e.proof.device}:${e.proof.inode}`;
        if (objects.has(key)) reasons.push("entry_object_alias"); objects.add(key);
        try { proofClock(e.proof, v.observed_at); } catch { reasons.push("observation_clock"); }
      }
    }
    if (e.kind === "directory" && (!e.directory_proof || e.proof || e.sha256
      || e.directory_proof.device !== o.intent.binding.root.device || e.directory_proof.uid !== o.intent.binding.root.uid
      || BigInt(e.directory_proof.birthtime_ns) > BigInt(Date.parse(v.observed_at)) * 1000000n + 999999n)) reasons.push("directory_missing_or_changed");
  }
  for (const { path, proof } of [...o.scope.layout_directories, ...o.plan.native_binding.targets.flatMap((t) => t.parents)])
    if (entries.get(path)?.kind !== "directory" || !same(entries.get(path)?.directory_proof, proof)) reasons.push("directory_missing_or_changed");
  for (const [path, record] of records) {
    const e = entries.get(path);
    if (!e || e.kind !== "file" || e.sha256 !== evidenceHash(record) || e.size !== String(Buffer.byteLength(canonical(record)))) reasons.push("published_record_missing_or_changed");
  }
  for (const m of b.markers) if (!same(entries.get(`quarantine/abandoned/${o.intent.maintenance_id}/${m.record.attempt_id}.timestamp.json`)?.proof, m.proof)) reasons.push("marker_proof_changed");
  if (v.locations.length !== o.manifest.targets.length || new Set(v.locations.map((t) => t.target_id)).size !== v.locations.length) reasons.push("location_scope");
  const observations: Observation[] = [];
  for (const t of o.manifest.targets) {
    const location = v.locations.find((p) => p.target_id === t.target_id), state = replay.targets.find((s) => s.target_id === t.target_id)!;
    if (!location) { reasons.push("location_scope"); continue; }
    const observation = { target_id: t.target_id, source: location.source ? baseProof(location.source) : null,
      holding: location.holding ? baseProof(location.holding) : null, quarantine: location.quarantine ? baseProof(location.quarantine) : null };
    const access = o.plan.native_binding.targets.find((v) => v.target_id === t.target_id)!;
    for (const place of ["source", "holding", "quarantine"] as const) {
      const path = place === "source" ? t.source_path : `${place === "holding" ? "maintenance-hold" : "quarantine/abandoned"}/${o.intent.maintenance_id}/${t.target_id}`;
      if (location[place] ? !same(entries.get(path)?.proof, location[place]) || entries.get(path)?.kind !== "file"
        || location[place]!.flags !== access.flags || location[place]!.acl_hash !== access.acl_hash : entries.has(path)) reasons.push("location_entry_binding");
    }
    // V2 attempt observations must predate this lease's opening, not merely the later inventory read.
    try { const observed = observe(state as Replay["targets"][number], observation, b.events, b.completion ? v.observed_at : request.opened_at);
      remaining.push({ target_id: t.target_id, location: observed.place, operations: remainingSteps(observed.place, b.events.length > 0) });
      observations.push(observation);
    } catch { reasons.push("location_conflict"); }
  }
  const logical = v.entries.reduce((n, e) => n + BigInt(e.size), 0n), allocated = v.entries.reduce((n, e) => n + BigInt(e.allocated_bytes ?? "0"), 0n);
  const metadata = [...records.values()].reduce<bigint>((n, r) => n + BigInt(Buffer.byteLength(canonical(r))), 0n)
    + v.entries.filter((e) => temporaries.has(e.path)).reduce((n, e) => n + BigInt(e.size), 0n);
  if (BigInt(v.accounting.occupied_inventory_bytes) < logical || BigInt(v.accounting.occupied_allocated_bytes) < allocated
    || BigInt(v.accounting.occupied_metadata_bytes) < metadata) reasons.push("accounting_underreported");
  if (!v.allocation_complete || v.entries.some((e) => e.allocated_bytes === null) || !v.reserve
    || !same(v.reserve.proof, o.scope.allocation.proof) || BigInt(v.reserve.allocated_bytes) < BigInt(o.scope.allocation.allocated_bytes)
    || !same(entries.get(layout.reserve_path)?.proof, v.reserve?.proof)
    || entries.get(layout.reserve_path)?.allocated_bytes !== v.reserve?.allocated_bytes) reasons.push("original_allocation_unverified");
  if (b.completion) return result(reasons.length ? "blocked" : "complete_read_only");
  if (!controller) reasons.push("controller_unavailable");
  else {
    if (controller.original_envelope_hash !== evidenceHash(o) || controller.scope_digest !== o.scope_digest
      || !same(controller.consumed_ordinals, Array.from({ length: maxConsumed }, (_, i) => i + 1))
      || b.attempts.some((a) => a.ordinal > maxConsumed) || new Set(controller.known_publications.map((p) => p.path)).size !== controller.known_publications.length) reasons.push("controller_binding");
    for (const p of controller.known_publications) if (!records.has(p.path) || evidenceHash(records.get(p.path)) !== p.hash || !same(entries.get(p.path)?.proof, p.proof)) reasons.push("acknowledged_record_missing_or_changed");
    if (maxConsumed >= 3) reasons.push("recovery_exhausted");
    if (request.ordinal !== maxConsumed + 1 || request.ordinal < 2) reasons.push("recovery_ordinal_unavailable");
  }
  if (Date.parse(request.expires_at) - Date.parse(request.opened_at) !== 600000 || request.issued_at < request.opened_at
    || v.observed_at <= request.issued_at || request.checked_at >= request.expires_at || request.checked_at < request.opened_at
    || BigInt(request.checked_elapsed_ns) >= 600000000000n || request.opened_at < (b.events.at(-1)?.clock.utc_at ?? o.intent.created.utc_at)
    || b.markers.some((m) => m.record.verified_at > request.opened_at)
    || b.attempts.some((a) => a.plan.observed_at > request.opened_at)) reasons.push("lease_expired_or_clock_binding");
  if ([...originalIdentifiers(o), ...b.attempts.map((a) => a.plan.plan_id)].includes(request.plan_id)) reasons.push("plan_identifier_reused");
  capacity = calculateNativeBarRecoveryCapacity({ ...v.accounting, schema: "native-bar-recovery-capacity-v5", phase: "recovery",
    target_count: o.manifest.targets.length, occupied_entries: String(v.entries.length),
    remaining_publications: layout.publications.filter((p) => !records.has(p.path)).length,
    remaining_temporaries: [...temporaries.keys()].filter((p) => !entries.has(p)).length,
    reserve_allocated_bytes: v.reserve?.allocated_bytes ?? null });
  reasons.push(...capacity.reasons);
  if (!reasons.length) {
    const contents = { schema: "native-bar-recovery-attempt-plan-v5" as const, plan_id: request.plan_id, maintenance_id: o.intent.maintenance_id,
      ordinal: request.ordinal, scope_digest: o.scope_digest, original_envelope_hash: evidenceHash(o), intent_hash: evidenceHash(o.intent),
      prefix_hash: b.events.length ? evidenceHash(b.events.at(-1)) : null, prefix_count: b.events.length,
      opened_at: request.opened_at, issued_at: request.issued_at, observed_at: v.observed_at, expires_at: request.expires_at,
      inventory_hash: v.inventory_hash, reference_hash: v.reference_hash, current_reference_hash: v.current_reference_hash,
      native_binding_hash: evidenceHash(v.native_binding), observations,
      actions: remaining.flatMap((t) => permittedActions(t.target_id, t.operations)) };
    attempt_plan = auditSchema.parse({ ...contents, plan_hash: evidenceHash(contents) }); recordSize(attempt_plan);
  }
  return result(reasons.length ? "blocked" : "planned_only");
}
