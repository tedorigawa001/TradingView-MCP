import { createHash } from "node:crypto";
import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId } from "./nativeBarEvidence.js";
import { nativeBarAdmissionReadRegistrationSchema, validateSyntheticAdmissionReadRegistration,
  validateSyntheticAdmissionReadLimits, calculateSyntheticAdmissionReadBudget, classifySyntheticAdmissionReadEntry } from "./nativeBarAdmissionReadContracts.js";
import { calculateSyntheticAdmissionQueryProtocolBudget } from "./nativeBarAdmissionQueryProtocol.js";

const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const uuid = nativeBarId.refine((s) => s === s.toLowerCase());
const boundedUint = (max: bigint, positive = false) => uint.refine((s) => /^(0|[1-9][0-9]{0,29})$/.test(s)
  && BigInt(s) <= max && (!positive || s !== "0"));
const noAuthority = Object.freeze({ scope: "synthetic_joint_read_model_only" as const, verification_scope: "supplied_joint_contracts_only" as const,
  native_read_available: false as const, native_bytes_verified: false as const, native_snapshot_verified: false as const,
  fixture_signature_verified: false as const, checkpoint_requests_verified: false as const, checkpoint_pair_verified: false as const,
  logical_prefix_verified: false as const, view_verified: false as const, authority_state_verified: false as const,
  original_intake_verified: false as const, admission_verified: false as const, approval_authenticated: false as const,
  execution_available: false as const, recovery_execution_available: false as const, committed_history_available: false as const,
  elapsed_clock_qualified: false as const, physical_capacity_verified: false as const, capacity_verified: false as const,
  native_budget_enforced: false as const, challenge_generation_verified: false as const, actual_request_timing_verified: false as const,
  transaction_replay_verified: false as const, original_acknowledgement: "not_proven" as const, storage_visibility_at_as_of: "not_proven" as const });
const inventoryBound = z.strictObject({ entries: boundedUint(512n), inventory_bytes: boundedUint(1073741824n), metadata_bytes: boundedUint(16777216n) });
const workEnvelopeSchema = z.strictObject({ schema: z.literal("native-bar-joint-read-work-envelope-v1"),
  inventory: z.strictObject({ data: inventoryBound, witness: inventoryBound, common: inventoryBound }),
  objects: z.strictObject({ witness_records: boundedUint(512n, true), producer_mirrors: boundedUint(512n), payloads: boundedUint(512n),
    receipts: boundedUint(512n), maintenance_metadata: boundedUint(512n) }),
  selected_bytes: boundedUint(16777216n, true), decoded_bytes: boundedUint(16777216n, true), interpretation_bytes: boundedUint(8388608n, true) });
const roles = { witness_records: 16384n, producer_mirrors: 8192n, payloads: 1048576n, receipts: 16384n, maintenance_metadata: 65536n } as const;
type Envelope = z.infer<typeof workEnvelopeSchema>;
const bindingSchema = z.strictObject({ schema: z.literal("native-bar-joint-read-binding-v1"), scope: z.literal("synthetic_joint_read_model_only"),
  registration: nativeBarAdmissionReadRegistrationSchema, registration_hash: nativeBarHash });
function refuse(code: string): never { throw new Error(`b3ca_${code}`); }
// As with adjacent pure contracts, callers are trusted test code; hostile in-process Proxy traps are not isolated.
function parse<T>(schema: z.ZodType<T>, value: unknown, limit = 65536): T {
  let size = 0, nodes = 0; const active = new Set<object>();
  function visit(v: unknown, depth: number) {
    if (++nodes > 262144 || depth > 64) refuse("input_depth_or_nodes");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isFinite(v)) refuse("non_json"); return; }
    if (typeof v === "string") { size += Buffer.byteLength(v); if (size > limit) refuse("input_bytes"); return; }
    if (typeof v !== "object" || active.has(v)) refuse("non_json");
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) refuse("non_json");
    if (array && v.length > 262144 - nodes) refuse("input_depth_or_nodes");
    const keys = Reflect.ownKeys(v); if (array && keys.length !== v.length + 1) refuse("non_json"); active.add(v);
    for (const k of keys) {
      if (array && k === "length") continue; const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (typeof k !== "string" || !d.enumerable || !Object.hasOwn(d, "value")
        || array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) refuse("non_json");
      size += Buffer.byteLength(k); if (size > limit) refuse("input_bytes"); visit(d.value, depth + 1);
    }
    active.delete(v);
  }
  visit(value, 0); if (Buffer.byteLength(canonical(value)) > limit) refuse("input_bytes");
  const r = schema.safeParse(value); if (!r.success) refuse("invalid_input"); return r.data;
}
export function validateSyntheticAdmissionJointBinding(input: unknown) {
  const b = parse(bindingSchema, input, 128 * 1024);
  try { validateSyntheticAdmissionReadRegistration(b.registration); } catch { refuse("invalid_registration"); }
  if (evidenceHash(b.registration) !== b.registration_hash) refuse("registration_binding"); return b;
}
export function checkSyntheticAdmissionJointBindingMatch(input: unknown) {
  const q = parse(z.strictObject({ expected: z.unknown(), supplied: z.unknown() }), input, 256 * 1024);
  const expected = validateSyntheticAdmissionJointBinding(q.expected), supplied = validateSyntheticAdmissionJointBinding(q.supplied);
  if (expected.registration_hash !== supplied.registration_hash || canonical(expected.registration) !== canonical(supplied.registration)) refuse("full_binding");
  return { ...noAuthority, schema: "native-bar-joint-binding-comparison-model-v1" as const, registration_hash: expected.registration_hash, supplied_full_binding_matches: true as const };
}
export function validateSyntheticAdmissionJointWorkEnvelope(input: unknown) {
  const e = parse(workEnvelopeSchema, input);
  for (const bound of Object.values(e.inventory)) if (BigInt(bound.metadata_bytes) > BigInt(bound.inventory_bytes)) refuse("metadata_bound");
  const count = Object.values(e.objects).reduce((n, v) => n + BigInt(v), 0n);
  const selected = (Object.keys(roles) as (keyof typeof roles)[]).reduce((n, k) => n + BigInt(e.objects[k]) * roles[k], 0n);
  if (BigInt(e.objects.witness_records) > BigInt(e.inventory.witness.entries)
    || count - BigInt(e.objects.witness_records) + 1n > BigInt(e.inventory.data.entries)
    || BigInt(e.objects.producer_mirrors) > BigInt(e.objects.witness_records)
    || BigInt(e.selected_bytes) < count || BigInt(e.selected_bytes) > selected) refuse("object_bound");
  return e;
}
function envelopeForBinding(e: Envelope, b: ReturnType<typeof validateSyntheticAdmissionJointBinding>) {
  const r = b.registration, policy = BigInt(Buffer.byteLength(canonical({ schema: "native-bar-synthetic-admission-profile-v6" })));
  const markers = BigInt(r.bindings.markers.base.size) + BigInt(r.bindings.markers.admission.size);
  if (BigInt(e.inventory.common.entries) < BigInt(r.bindings.ancestors.length + 5)
    || BigInt(e.inventory.data.entries) < 1n || BigInt(e.inventory.data.inventory_bytes) < policy || BigInt(e.inventory.data.metadata_bytes) < policy
    || BigInt(e.inventory.common.inventory_bytes) < markers || BigInt(e.inventory.common.metadata_bytes) < markers) refuse("control_bound");
}
export function planSyntheticAdmissionJointWork(input: unknown) {
  const q = parse(z.strictObject({ binding: z.unknown(), work_envelope: z.unknown(), retained_state_bytes: uint, lower_limits: z.unknown().optional(),
    resources: z.strictObject({ live_roots: uint, live_targets: uint, live_fds: uint }) }), input, 256 * 1024);
  const b = validateSyntheticAdmissionJointBinding(q.binding), e = validateSyntheticAdmissionJointWorkEnvelope(q.work_envelope); envelopeForBinding(e, b);
  if (BigInt(q.retained_state_bytes) > 16777216n) refuse("state_budget");
  let limits: ReturnType<typeof validateSyntheticAdmissionReadLimits>;
  try { limits = validateSyntheticAdmissionReadLimits(q.lower_limits); } catch { refuse("limits"); }
  const groups = (Object.keys(roles) as (keyof typeof roles)[]).filter((k) => e.objects[k] !== "0");
  const count = groups.reduce((n, k) => n + BigInt(e.objects[k]), 0n), content = groups.reduce((n, k) => n + BigInt(e.objects[k]) * roles[k], 0n);
  const entries = Object.values(e.inventory).reduce((n, bound) => n + BigInt(bound.entries), 0n), ancestors = BigInt(b.registration.bindings.ancestors.length);
  const decoded = 6n * content + count * 4096n, interpretation = 65536n + count * 4096n;
  // Keep full namespace role caps per slot, even if the aggregate admission cap is smaller. No optimistic packing.
  const readWork = groups.map((k) => ({ kind: "content" as const, bytes: String(roles[k]), count: e.objects[k],
    cap_bytes: String(roles[k]) as "8192" | "16384" | "65536" | "1048576" }));
  // Additional maximum ACL text work: six inventories, five content passes (depth <=16), begin/open/guards/report.
  // aacl charges text twice; the unchanged B3-A/B-2 floors remain in addition to this conservative upper schedule.
  const aclCalls = 32n * (ancestors + 6n) + 6n * (3n * entries + 6n * (ancestors + 6n))
    + 5n * count * (2n * (ancestors + 6n) + 2n * 16n + 8n) + count * (ancestors + 6n);
  const frame = 16384n + entries * 5120n, max = (a: bigint, c: bigint) => a > c ? a : c;
  const protocol = BigInt(q.retained_state_bytes) + 3n * frame + 65536n + 4n * 1024n + 8n * 4096n
    + BigInt(Buffer.byteLength(canonical(e))) + max(interpretation, BigInt(e.interpretation_bytes));
  const verifier = 2n * content + count * 4096n + 2n * 4096n, provider = 2n * 4n * 4096n;
  const read_work = [...readWork, { kind: "acl" as const, bytes: "131072", count: String(aclCalls) }];
  const response = { supplied_bytes: String(max(65536n, BigInt(e.interpretation_bytes))), buffer_bytes: String(groups.reduce((n, k) => max(n, roles[k]), 0n)) };
  let plan: ReturnType<typeof calculateSyntheticAdmissionQueryProtocolBudget>, native: ReturnType<typeof calculateSyntheticAdmissionReadBudget>;
  try {
    native = calculateSyntheticAdmissionReadBudget({ registration: b.registration, ...(q.lower_limits === undefined ? {} : { limits: q.lower_limits }),
      inventory: e.inventory, retained_metadata_bytes: "0", read_work, response, resources: q.resources });
    plan = calculateSyntheticAdmissionQueryProtocolBudget({ binding: { ...b, schema: "native-bar-admission-query-model-registration-v1", scope: "synthetic_model_only" },
      ...(q.lower_limits === undefined ? {} : { limits: q.lower_limits }), inventory: e.inventory, retained_metadata_bytes: "0",
      retained_protocol_bytes: String(protocol), decoded_transcript_bytes: String(max(decoded, BigInt(e.decoded_bytes))),
      verifier_work_bytes: String(verifier), provider_work_bytes: String(provider), read_work, response, resources: q.resources });
  } catch { refuse("budget_input"); }
  const blockers: string[] = [...plan.blockers];
  if (BigInt(e.decoded_bytes) < decoded) blockers.push("decoded_work_bound");
  if (BigInt(e.interpretation_bytes) < interpretation) blockers.push("interpretation_work_bound");
  const outerRead = 3n * content + 10n * 4096n + 65536n + verifier + provider;
  const nativeBound = { ...native.used, read_bytes: String(BigInt(plan.used.read_bytes) - outerRead) };
  // Keep V1 inside native work: clamp to the planned native bound, never subtract that work from its allowance again.
  const nativeLimits = Object.fromEntries((Object.keys(nativeBound) as (keyof typeof nativeBound)[]).map((k) =>
    [k, String(BigInt(nativeBound[k]) < BigInt(plan.native_allowance[k]) ? BigInt(nativeBound[k]) : BigInt(plan.native_allowance[k]))]));
  return { ...plan, ...noAuthority, schema: "native-bar-joint-read-work-plan-v1" as const, model_fits: blockers.length === 0, blockers, limits,
    registration_hash: b.registration_hash, work_envelope_hash: evidenceHash(e), charged_selected_bytes: String(content), selected_byte_bound: e.selected_bytes,
    required_decoded_bytes: String(decoded), required_interpretation_bytes: String(interpretation), acl_calls_upper_bound: String(aclCalls),
    additional_acl_work_bytes: String(aclCalls * 131072n), native_limits: nativeLimits, outer_read_bytes: String(outerRead) };
}
const relative = z.string().min(1).refine((s) => Buffer.from(s).toString("utf8") === s && Buffer.byteLength(s) <= 512
  && !s.includes("\\") && !s.includes("\0") && s.split("/").length <= 16 && s.split("/").every((p) => p && p !== "." && p !== ".."));
const witnessEntrySchema = z.strictObject({ index: z.number().int().min(0).max(511), root_role: z.literal("witness"), path: relative,
  kind: z.enum(["file", "directory", "symlink", "nonregular"]), size: uint, access: z.enum(["supplied_safe", "unsafe", "unknown"]) });
export function selectSyntheticAdmissionJointWitnesses(input: unknown) {
  const q = parse(z.strictObject({ work_envelope: z.unknown(), checkpoint_sequence: boundedUint(999999999999999999999999999999n, true),
    entries: z.array(witnessEntrySchema).max(512) }), input, 512 * 2048);
  const e = validateSyntheticAdmissionJointWorkEnvelope(q.work_envelope), n = BigInt(q.checkpoint_sequence);
  if (n > BigInt(e.objects.witness_records) || BigInt(q.entries.length) > BigInt(e.inventory.witness.entries)) refuse("witness_bound");
  if (n !== BigInt(q.entries.length)) refuse("witness_prefix");
  const indices = new Set<number>(), sorted = [...q.entries]; let total = 0n;
  for (const entry of sorted) {
    const c = classifySyntheticAdmissionReadEntry({ root_role: entry.root_role, path: entry.path, kind: entry.kind, size: entry.size, access: entry.access });
    if (c.role !== "witness_record" || c.blocker || !c.raw_read_candidate || entry.size === "0" || indices.has(entry.index)) refuse("witness_entry");
    indices.add(entry.index); total += BigInt(entry.size);
  }
  sorted.sort((a, b) => BigInt(a.path.slice(0, -5)) < BigInt(b.path.slice(0, -5)) ? -1 : 1);
  if (sorted.some((entry, i) => entry.path !== `${i + 1}.json`)) refuse("witness_prefix");
  if (total > BigInt(e.selected_bytes) || total > BigInt(e.inventory.witness.inventory_bytes) || total > BigInt(e.inventory.witness.metadata_bytes)) refuse("selected_byte_bound");
  return { ...noAuthority, schema: "native-bar-joint-witness-selection-model-v1" as const, work_envelope_hash: evidenceHash(e),
    selected_indices: sorted.map((entry) => entry.index), selected_bytes: String(total), supplied_prefix_complete: true as const };
}
const locationSchema = z.strictObject({ root_role: z.enum(["data", "witness"]), path: relative, index: z.number().int().min(0).max(511), size: uint });
function fields(input: unknown, allowed: string[], required: string[]) {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) refuse("non_json");
  const keys = Reflect.ownKeys(input); if (keys.length > allowed.length) refuse("invalid_input"); const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(input, k)!;
    if (typeof k !== "string" || !allowed.includes(k) || !d.enumerable || !Object.hasOwn(d, "value")) refuse("invalid_input"); out[k] = d.value;
  }
  if (required.some((k) => !Object.hasOwn(out, k))) refuse("invalid_input"); return out;
}
const typed = Object.getPrototypeOf(Uint8Array.prototype), byteLengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!,
  bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!, ordinaryLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
function suppliedCapture(input: unknown, expectedRole: string) {
  const f = fields(input, ["bytes", "location", "native_sha256", "encoded_sha256"], ["bytes", "location", "native_sha256", "encoded_sha256"]);
  const m = parse(z.strictObject({ location: locationSchema, native_sha256: nativeBarHash, encoded_sha256: nativeBarHash }),
    { location: f.location, native_sha256: f.native_sha256, encoded_sha256: f.encoded_sha256 }, 4096);
  const c = classifySyntheticAdmissionReadEntry({ root_role: m.location.root_role, path: m.location.path, kind: "file", size: m.location.size, access: "supplied_safe" });
  if (c.role !== expectedRole || c.blocker || !c.raw_read_candidate || !c.raw_byte_limit) refuse("capture_role");
  let bytes: Buffer;
  try {
    const value = f.bytes, length = byteLengthOf.call(value); ordinaryLength.call(bufferOf.call(value));
    if (!(value instanceof Uint8Array) || ![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(value))
      || length < 1 || BigInt(length) > BigInt(c.raw_byte_limit) || String(length) !== m.location.size
      || Reflect.ownKeys(value).some((k) => typeof k !== "string" || !/^(0|[1-9][0-9]*)$/.test(k))) refuse("capture_bytes");
    bytes = Buffer.alloc(length); Uint8Array.prototype.set.call(bytes, value);
  } catch { refuse("capture_bytes"); }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== m.native_sha256) refuse("native_hash"); if (hash !== m.encoded_sha256) refuse("encoded_hash");
  return { bytes, hash, location: m.location };
}
export function matchSyntheticAdmissionJointRecordBytes(input: unknown) {
  const f = fields(input, ["sequence", "producer_id", "witness", "mirror"], ["sequence", "witness"]);
  const m = parse(z.strictObject({ sequence: boundedUint(999999999999999999999999999999n, true), producer_id: uuid.optional() }),
    { sequence: f.sequence, ...(Object.hasOwn(f, "producer_id") ? { producer_id: f.producer_id } : {}) });
  const witness = suppliedCapture(f.witness, "witness_record");
  if (witness.location.root_role !== "witness" || witness.location.path !== `${m.sequence}.json`) refuse("witness_location");
  let mirrorIndex: number | null = null;
  if (m.producer_id) {
    if (!Object.hasOwn(f, "mirror")) refuse("mirror_required"); const mirror = suppliedCapture(f.mirror, "producer_mirror");
    if (mirror.location.root_role !== "data" || mirror.location.path !== `producer/${m.producer_id}/${m.sequence}.json`
      || mirror.location.index === witness.location.index) refuse("mirror_location");
    if (mirror.hash !== witness.hash || Buffer.compare(mirror.bytes, witness.bytes) !== 0) refuse("mirror_bytes"); mirrorIndex = mirror.location.index;
  } else if (Object.hasOwn(f, "mirror")) refuse("unexpected_mirror");
  return { ...noAuthority, schema: "native-bar-joint-record-byte-binding-model-v1" as const, supplied_byte_hashes_match: true as const,
    sequence: m.sequence, sha256: witness.hash, bytes: String(witness.bytes.byteLength), witness_index: witness.location.index, mirror_index: mirrorIndex };
}
export function matchSyntheticAdmissionJointContentBytes(input: unknown) {
  const f = fields(input, ["role", "capture", "expected_sha256"], ["role", "capture", "expected_sha256"]);
  const m = parse(z.strictObject({ role: z.enum(["payload", "receipt", "maintenance_metadata"]), expected_sha256: nativeBarHash }),
    { role: f.role, expected_sha256: f.expected_sha256 });
  const captured = suppliedCapture(f.capture, m.role); if (captured.hash !== m.expected_sha256) refuse("expected_hash");
  return { ...noAuthority, schema: "native-bar-joint-content-byte-binding-model-v1" as const, supplied_byte_hashes_match: true as const,
    role: m.role, sha256: captured.hash, bytes: String(captured.bytes.byteLength), index: captured.location.index };
}
const countsSchema = z.strictObject({ witness_records: boundedUint(512n), producer_mirrors: boundedUint(512n), payloads: boundedUint(512n),
  receipts: boundedUint(512n), maintenance_metadata: boundedUint(512n) });
export function checkSyntheticAdmissionJointWorkUsage(input: unknown) {
  const q = parse(z.strictObject({ binding: z.unknown(), work_envelope: z.unknown(), usage: z.strictObject({
    inventory: z.strictObject({ data: inventoryBound, witness: inventoryBound, common: inventoryBound }), objects: countsSchema,
    selected_bytes: uint, decoded_bytes: uint, interpretation_bytes: uint }) }), input, 256 * 1024);
  const b = validateSyntheticAdmissionJointBinding(q.binding), e = validateSyntheticAdmissionJointWorkEnvelope(q.work_envelope); envelopeForBinding(e, b);
  const blockers: string[] = [];
  for (const role of ["data", "witness", "common"] as const) for (const key of ["entries", "inventory_bytes", "metadata_bytes"] as const)
    if (BigInt(q.usage.inventory[role][key]) > BigInt(e.inventory[role][key])) blockers.push(`${role}_${key}`);
  for (const k of Object.keys(roles) as (keyof typeof roles)[]) if (BigInt(q.usage.objects[k]) > BigInt(e.objects[k])) blockers.push(k);
  for (const k of ["selected_bytes", "decoded_bytes", "interpretation_bytes"] as const) if (BigInt(q.usage[k]) > BigInt(e[k])) blockers.push(k);
  return { ...noAuthority, schema: "native-bar-joint-work-usage-model-v1" as const, registration_hash: b.registration_hash,
    work_envelope_hash: evidenceHash(e), within_supplied_envelope: blockers.length === 0, blockers };
}
const phaseOrder = ["native_context_started", "c0_authenticated", "inventoried", "bytes_bound", "v0_verified", "c1_authenticated",
  "v1_verified", "transcript_verified", "released"] as const;
const qualificationShape = Object.fromEntries(Object.entries(noAuthority).map(([k, v]) => [k, z.literal(v)]));
export const nativeBarAdmissionJointModelResultSchema = z.strictObject({ ...qualificationShape, schema: z.literal("native-bar-joint-read-model-result-v1"),
  registration_hash: nativeBarHash, work_envelope_hash: nativeBarHash,
  model_status: z.enum(["consistent_supplied_model", "blocked_supplied_model"]), model_order_consistent: z.boolean(),
  model_blockers: z.array(z.enum(["binding", "byte_hash", "work_envelope", "publication_incomplete", "transaction_mapping_pending", "native_unavailable",
    "oracle_unavailable", "changing", "cancelled", "deadline", "integrity", "release_unconfirmed"])).max(12),
  primary_failure: z.string().regex(/^b3ca_[a-z_]+$/).max(96).nullable(), cleanup: z.literal("not_performed"),
  supplied_phases: z.array(z.enum(phaseOrder)).max(phaseOrder.length), selected_indices: z.array(z.number().int().min(0).max(511)).max(512)
}).refine((r) => r.supplied_phases.every((p, i) => p === phaseOrder[i]) && new Set(r.selected_indices).size === r.selected_indices.length
  && new Set(r.model_blockers).size === r.model_blockers.length && (r.model_status === "consistent_supplied_model"
    ? r.model_order_consistent && r.supplied_phases.length === phaseOrder.length && r.model_blockers.length === 0 && r.primary_failure === null
    : !r.model_order_consistent && (r.model_blockers.length > 0 || r.primary_failure !== null)));
export function validateSyntheticAdmissionJointModelResult(input: unknown) { return parse(nativeBarAdmissionJointModelResultSchema, input, 128 * 1024); }
