import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { nativeBarAdmissionReadRegistrationSchema, validateSyntheticAdmissionReadRegistration, validateSyntheticAdmissionReadLimits } from "./nativeBarAdmissionReadContracts.js";
import { calculateSyntheticAdmissionQueryProtocolBudget } from "./nativeBarAdmissionQueryProtocol.js";

export const checkpointProbeNoAuthority = Object.freeze({ scope: "synthetic_checkpoint_probe_only" as const,
  verification_scope: "unsigned_probe_lifecycle_only" as const, native_read_available: false as const, native_bytes_verified: false as const,
  native_snapshot_verified: false as const, view_verified: false as const, fixture_signature_verified: false as const,
  checkpoint_pair_verified: false as const, checkpoint_requests_verified: false as const, logical_prefix_verified: false as const,
  authority_state_verified: false as const, original_intake_verified: false as const, admission_verified: false as const,
  approval_authenticated: false as const, execution_available: false as const, recovery_execution_available: false as const,
  committed_history_available: false as const, elapsed_clock_qualified: false as const, physical_capacity_verified: false as const,
  capacity_verified: false as const, native_budget_enforced: false as const, challenge_generation_verified: false as const,
  actual_request_timing_verified: false as const, original_acknowledgement: "not_proven" as const, storage_visibility_at_as_of: "not_proven" as const });
export function checkpointProbeRefuse(code: string): never { throw new Error(`b3ba_${code}`); }
export const checkpointProbeBytes = (value: unknown) => Buffer.byteLength(canonical(value));

// As with the existing admission contracts, callers are trusted process-local test code, not hostile Proxies.
export function checkpointProbeParse<T>(schema: z.ZodType<T>, input: unknown, limit = 65536): T {
  let size = 0, nodes = 0; const active = new Set<object>();
  function visit(v: unknown, depth: number) {
    if (++nodes > 262144 || depth > 64) checkpointProbeRefuse("input_depth_or_nodes");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isFinite(v)) checkpointProbeRefuse("non_json"); return; }
    if (typeof v === "string") { size += Buffer.byteLength(v); if (size > limit) checkpointProbeRefuse("input_bytes"); return; }
    if (typeof v !== "object" || active.has(v)) checkpointProbeRefuse("non_json");
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) checkpointProbeRefuse("non_json");
    if (array && v.length > 262144 - nodes) checkpointProbeRefuse("input_depth_or_nodes");
    const keys = Reflect.ownKeys(v); if (array && keys.length !== v.length + 1) checkpointProbeRefuse("non_json");
    active.add(v);
    for (const k of keys) {
      if (array && k === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (typeof k !== "string" || !d.enumerable || !Object.hasOwn(d, "value")
        || array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) checkpointProbeRefuse("non_json");
      size += Buffer.byteLength(k); if (size > limit) checkpointProbeRefuse("input_bytes"); visit(d.value, depth + 1);
    }
    active.delete(v);
  }
  visit(input, 0); if (checkpointProbeBytes(input) > limit) checkpointProbeRefuse("input_bytes");
  const result = schema.safeParse(input); if (!result.success) checkpointProbeRefuse("invalid_input"); return result.data;
}
const bindingSchema = z.strictObject({ schema: z.literal("native-bar-checkpoint-oracle-binding-v1"),
  scope: z.literal("synthetic_checkpoint_probe_only"), registration: nativeBarAdmissionReadRegistrationSchema, registration_hash: nativeBarHash });
export function validateCheckpointOracleBinding(input: unknown) {
  const b = checkpointProbeParse(bindingSchema, input, 128 * 1024);
  try { validateSyntheticAdmissionReadRegistration(b.registration); } catch { checkpointProbeRefuse("invalid_registration"); }
  if (evidenceHash(b.registration) !== b.registration_hash) checkpointProbeRefuse("registration_binding"); return b;
}
export const checkpointProbeUint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
export const checkpointProbeId = nativeBarId.refine((v) => v === v.toLowerCase());
const lowerLimits = z.strictObject({ entries: z.number().int().min(1).max(512).optional(), inventory_bytes: z.number().int().min(1).max(1073741824).optional(),
  metadata_bytes: z.number().int().min(1).max(16777216).optional(), read_bytes: z.number().int().min(1).max(268435456).optional(),
  response_bytes: z.number().int().min(1).max(8388608).optional() });
export const checkpointProbeOptionsSchema = z.strictObject({ ttl_ms: z.number().int().min(1).max(600000).optional(), lower_limits: lowerLimits.optional() });
export const checkpointProbeRequestSchema = z.strictObject({ schema: z.literal("native-bar-checkpoint-probe-request-v1"), scope: z.literal("synthetic_checkpoint_probe_only"),
  registration_hash: nativeBarHash, fixture_id: checkpointProbeId, store_id: checkpointProbeId, epoch_id: checkpointProbeId, authority_id: checkpointProbeId,
  key_id: checkpointProbeId, enrollment_hash: nativeBarHash, authority_reference: checkpointProbeId, query_id: checkpointProbeId,
  phase: z.literal("c0"), challenge: checkpointProbeId });
export const checkpointProbeObservationSchema = z.strictObject({ utc_at: nativeBarTimestamp, monotonic_before_ns: checkpointProbeUint,
  monotonic_after_ns: checkpointProbeUint });
const flags = Object.fromEntries(Object.entries(checkpointProbeNoAuthority).map(([k, v]) => [k, z.literal(v)]));
export const checkpointProbeDiagnosticSchema = z.strictObject({ ...flags, schema: z.literal("native-bar-unsigned-checkpoint-probe-diagnostic-v1"),
  registration_hash: nativeBarHash, query_id: checkpointProbeId, state: z.enum(["probe_started", "c0_outstanding", "releasing", "release_unconfirmed", "released"]),
  revoked: z.boolean(), failure: z.string().regex(/^b3ba_[a-z_]+$/).max(96).nullable(), cleanup: z.enum(["not_requested", "unconfirmed", "confirmed"]),
  first_observation: checkpointProbeObservationSchema, last_observation: checkpointProbeObservationSchema, event_ordinal: checkpointProbeUint,
  requests_dispatched: z.number().int().min(0).max(1), ids_generated: z.number().int().min(1).max(2), pending_consumed: z.boolean(),
  retained_state_bytes: checkpointProbeUint, active_workspace_bytes: checkpointProbeUint });
export function planCheckpointProbeBudget(input: unknown) {
  const q = checkpointProbeParse(z.strictObject({ binding: z.unknown(), retained_state_bytes: checkpointProbeUint, lower_limits: lowerLimits.optional() }), input, 256 * 1024);
  const b = validateCheckpointOracleBinding(q.binding), empty = () => ({ entries: "0", inventory_bytes: "0", metadata_bytes: "0" });
  const frame = 16384n + BigInt(b.registration.bindings.ancestors.length + 6) * 5120n;
  const limits = validateSyntheticAdmissionReadLimits(q.lower_limits);
  const plan = calculateSyntheticAdmissionQueryProtocolBudget({ binding: { ...b, schema: "native-bar-admission-query-model-registration-v1", scope: "synthetic_model_only" },
    ...(q.lower_limits ? { limits: q.lower_limits } : {}), inventory: { data: empty(), witness: empty(), common: empty() }, retained_metadata_bytes: "0",
    retained_protocol_bytes: String(BigInt(q.retained_state_bytes) + 3n * frame + 65536n + 4n * 1024n + 8n * 4096n),
    decoded_transcript_bytes: String(2n * 6n * 4096n), verifier_work_bytes: String(2n * 4096n), provider_work_bytes: String(2n * 4n * 4096n),
    read_work: [], response: { supplied_bytes: "65536", buffer_bytes: "4096" }, resources: { live_roots: "0", live_targets: "0", live_fds: "0" } });
  return { ...plan, ...checkpointProbeNoAuthority, schema: "native-bar-unsigned-checkpoint-probe-budget-v1" as const, limits };
}
