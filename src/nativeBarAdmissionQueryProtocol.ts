import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { NATIVE_BAR_ADMISSION_LIMITS } from "./nativeBarAdmission.js";
import { nativeBarAdmissionReadRegistrationSchema, validateSyntheticAdmissionReadRegistration,
  validateSyntheticAdmissionReadLimits, calculateSyntheticAdmissionReadBudget } from "./nativeBarAdmissionReadContracts.js";

const L = NATIVE_BAR_ADMISSION_LIMITS;
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/), uuid = nativeBarId.refine((v) => v === v.toLowerCase());
// A ledger always holds its enrollment record, so checkpoint and prefix sequences start at 1, as in B-1.
const sequence = z.string().regex(/^[1-9][0-9]{0,29}$/);
const observationSchema = z.strictObject({ utc_at: nativeBarTimestamp, monotonic_ns: uint });
type Observation = z.infer<typeof observationSchema>;
const registrationSchema = z.strictObject({ schema: z.literal("native-bar-admission-query-model-registration-v1"),
  scope: z.literal("synthetic_model_only"), registration: nativeBarAdmissionReadRegistrationSchema, registration_hash: nativeBarHash });
const onlyObservation = z.strictObject({ observation: observationSchema });
const claimSchema = z.strictObject({ fixture_id: uuid, store_id: uuid, epoch_id: uuid, authority_id: uuid, key_id: uuid,
  enrollment_hash: nativeBarHash, authority_reference: uuid, challenge: uuid, sequence, tip_hash: nativeBarHash, observed_at: nativeBarTimestamp });
const stateSchema = z.enum(["query_started", "c0_outstanding", "c0_model_received", "pair_open", "inventoried", "records_bound",
  "native_checked_before_c1", "c1_outstanding", "c1_model_received", "native_checked_after_c1", "interpretation_complete",
  "releasing", "release_unconfirmed", "released", "revoked"]);
type State = z.infer<typeof stateSchema>;
const noAuthority = Object.freeze({ scope: "synthetic_model_only" as const, verification_scope: "supplied_protocol_model_only" as const,
  native_read_available: false as const, native_bytes_verified: false as const, native_snapshot_verified: false as const,
  fixture_signature_verified: false as const, checkpoint_pair_verified: false as const, logical_prefix_verified: false as const,
  authority_state_verified: false as const, view_verified: false as const, original_intake_verified: false as const,
  admission_verified: false as const, approval_authenticated: false as const, execution_available: false as const,
  recovery_execution_available: false as const, committed_history_available: false as const, elapsed_clock_qualified: false as const,
  physical_capacity_verified: false as const, capacity_verified: false as const, native_budget_enforced: false as const,
  challenge_generation_verified: false as const, actual_request_timing_verified: false as const,
  original_acknowledgement: "not_proven" as const, storage_visibility_at_as_of: "not_proven" as const });
const qualificationShape = {
  ...Object.fromEntries(Object.entries(noAuthority).map(([k, v]) => [k, z.literal(v)])),
};
export const nativeBarAdmissionQueryModelResultSchema = z.strictObject({ ...qualificationShape,
  schema: z.literal("native-bar-admission-query-model-result-v1"), registration_hash: nativeBarHash, query_id: uuid,
  state: stateSchema, model_order_consistent: z.boolean(), failure: z.string().regex(/^b3a_[a-z_]+$/).nullable(),
  event_ordinal: uint, last_supplied_observation: observationSchema, checkpoint_claims_consumed: z.number().int().min(0).max(2),
  retained_state_bytes: uint }).refine((r) => !r.model_order_consistent || r.state === "released" && r.failure === null && r.checkpoint_claims_consumed === 2);
const bytes = (v: unknown) => Buffer.byteLength(canonical(v));
function refuse(reason: string): never { throw new Error(`b3a_${reason}`); }

// Bound plain structured input before Zod or hashing; never evaluate an accessor/toJSON.
function bounded(value: unknown, limit: number) {
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
    const keys = Reflect.ownKeys(v); if (array && keys.length !== v.length + 1) refuse("non_json");
    active.add(v);
    for (const k of keys) {
      if (array && k === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (typeof k !== "string" || !d.enumerable || !Object.hasOwn(d, "value")
        || array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) refuse("non_json");
      size += Buffer.byteLength(k); if (size > limit) refuse("input_bytes"); visit(d.value, depth + 1);
    }
    active.delete(v);
  }
  visit(value, 0); if (bytes(value) > limit) refuse("input_bytes");
}
function parse<T>(schema: z.ZodType<T>, input: unknown, limit: number = L.record_bytes): T {
  bounded(input, limit); const r = schema.safeParse(input); if (!r.success) refuse("invalid_input"); return r.data;
}
function registration(input: unknown) {
  const r = parse(registrationSchema, input, 128 * 1024);
  try { validateSyntheticAdmissionReadRegistration(r.registration); } catch { refuse("invalid_registration"); }
  if (evidenceHash(r.registration) !== r.registration_hash) refuse("registration_binding"); return r;
}
const token = () => Object.freeze(Object.create(null) as object);
type Request = { phase: "c0" | "c1"; challenge: string; sent: Observation; consumed: boolean };
type Query = { id: string; state: State; start: Observation; last: Observation; ordinal: bigint; failure: string | null;
  request?: Request; c0?: z.infer<typeof claimSchema>; claims: number };
/** Supplied-memory model only. Its handles never enter the native/oracle capability registries. */
export function createSyntheticAdmissionQueryProtocolModel(input: unknown, options: unknown = {}) {
  const binding = registration(input), opt = parse(z.strictObject({ retained_state_limit_bytes: uint.optional() }), options);
  const cap = BigInt(opt.retained_state_limit_bytes ?? L.metadata_bytes);
  if (cap > BigInt(L.metadata_bytes)) refuse("state_limit_raise");
  let retained = BigInt(bytes(binding) + 65536), closed = false, active: Query | undefined;
  if (retained > cap) refuse("state_budget");
  const queries = new WeakMap<object, Query>(), requests = new WeakMap<object, { query: Query; request: Request }>();
  const roles = new Set([...Object.values(binding.registration.pins).filter((v) => uuid.safeParse(v).success), binding.registration.authority_reference]);
  const issued = new Set<string>();
  function reserve(ids: string[]) {
    const fresh = ids.filter((id) => !roles.has(id) && !issued.has(id));
    const charge = BigInt(fresh.length) * 4096n;
    if (retained + charge > cap) refuse("state_budget"); retained += charge;
  }
  function lookup(t: object) { const q = queries.get(t); if (!q) refuse("query_handle_required"); return q; }
  function failure(q: Query, reason: string) {
    q.failure ??= reason; if (q.request) q.request.consumed = true;
    if (q.state !== "released" && q.state !== "revoked") q.state = "releasing";
  }
  function observe(q: Query, o: Observation, cleanup = false) {
    const wall = Date.parse(o.utc_at), tick = BigInt(o.monotonic_ns);
    const bad = wall < Date.parse(q.last.utc_at) || tick < BigInt(q.last.monotonic_ns) ? "b3a_clock_rollback"
      : wall - Date.parse(q.start.utc_at) >= 600000 || tick - BigInt(q.start.monotonic_ns) >= 600000000000n ? "b3a_expired" : null;
    if (bad) { if (!cleanup) throw new Error(bad); failure(q, bad); }
    q.last = o; q.ordinal++;
  }
  function run<T>(t: object, action: (q: Query) => T) {
    const q = lookup(t);
    if (closed || q.state === "revoked") refuse("model_closed");
    if (q.state === "released") refuse("query_terminal");
    if (q.failure || q.state === "releasing" || q.state === "release_unconfirmed") refuse("release_only");
    try { return action(q); }
    catch (e) {
      const reason = e instanceof Error && /^b3a_[a-z_]+$/.test(e.message) ? e.message : "b3a_invalid_input";
      failure(q, reason); throw new Error(reason);
    }
  }
  function expect(q: Query, state: State) { if (q.state !== state) refuse("event_order"); }
  return Object.freeze({
    begin(raw: unknown) {
      if (closed) refuse("model_closed"); if (active) refuse("query_already_active");
      const a = parse(z.strictObject({ query_id: uuid, registration_hash: nativeBarHash, observation: observationSchema }), raw);
      if (a.registration_hash !== binding.registration_hash) refuse("registration_binding");
      if (issued.has(a.query_id) || roles.has(a.query_id)) refuse("identity_reuse"); reserve([a.query_id]); issued.add(a.query_id);
      const t = token(), q: Query = { id: a.query_id, state: "query_started", start: a.observation, last: a.observation, ordinal: 1n, failure: null, claims: 0 };
      queries.set(t, q); active = q; return t;
    },
    issue(t: object, raw: unknown) {
      return run(t, (q) => {
        const a = parse(z.strictObject({ phase: z.enum(["c0", "c1"]), challenge: uuid, observation: observationSchema }), raw);
        expect(q, a.phase === "c0" ? "query_started" : "native_checked_before_c1"); observe(q, a.observation);
        if (roles.has(a.challenge) || issued.has(a.challenge)) refuse("identity_reuse"); reserve([a.challenge]); issued.add(a.challenge);
        const r: Request = { phase: a.phase, challenge: a.challenge, sent: a.observation, consumed: false }, h = token();
        q.request = r; q.state = a.phase === "c0" ? "c0_outstanding" : "c1_outstanding"; requests.set(h, { query: q, request: r }); return h;
      });
    },
    receive(t: object, h: object, raw: unknown) {
      return run(t, (q) => {
        const stored = requests.get(h), outstanding = q.request;
        // Consume the current request before parsing even a malformed, foreign or late response.
        const reusable = outstanding && !outstanding.consumed; if (outstanding) outstanding.consumed = true;
        if (!stored || stored.query !== q || stored.request !== outstanding || !reusable) refuse("request_handle_required");
        expect(q, outstanding.phase === "c0" ? "c0_outstanding" : "c1_outstanding");
        const a = parse(z.strictObject({ observation: observationSchema, checkpoint_claim: claimSchema }), raw, 4096);
        observe(q, a.observation); const c = a.checkpoint_claim;
        for (const key of ["fixture_id", "store_id", "epoch_id", "authority_id", "key_id", "enrollment_hash"] as const)
          if (c[key] !== binding.registration.pins[key]) refuse("checkpoint_binding");
        if (c.authority_reference !== binding.registration.authority_reference || c.challenge !== outstanding.challenge) refuse("checkpoint_binding");
        if (Date.parse(c.observed_at) < Date.parse(outstanding.sent.utc_at) || Date.parse(c.observed_at) > Date.parse(a.observation.utc_at)) refuse("checkpoint_bracket");
        if (outstanding.phase === "c1" && (!q.c0 || c.sequence !== q.c0.sequence || c.tip_hash !== q.c0.tip_hash)) refuse("checkpoint_changed");
        if (outstanding.phase === "c0") q.c0 = c;
        q.claims++; q.state = outstanding.phase === "c0" ? "c0_model_received" : "c1_model_received";
      });
    },
    advance(t: object, raw: unknown) {
      return run(t, (q) => {
        const a = parse(z.strictObject({ phase: z.enum(["pair_open", "inventoried", "native_checked_before_c1", "native_checked_after_c1", "interpretation_complete"]), observation: observationSchema }), raw);
        const previous = { pair_open: "c0_model_received", inventoried: "pair_open", native_checked_before_c1: "records_bound",
          native_checked_after_c1: "c1_model_received", interpretation_complete: "native_checked_after_c1" } as const;
        expect(q, previous[a.phase]); observe(q, a.observation); q.state = a.phase;
      });
    },
    bindRecords(t: object, raw: unknown) {
      return run(t, (q) => {
        expect(q, "inventoried");
        const a = parse(z.strictObject({ observation: observationSchema, sequence, tip_hash: nativeBarHash, record_role_ids: z.array(uuid).max(L.entries) }), raw);
        observe(q, a.observation);
        if (!q.c0 || a.sequence !== q.c0.sequence || a.tip_hash !== q.c0.tip_hash) refuse("prefix_binding");
        if (new Set(a.record_role_ids).size !== a.record_role_ids.length || a.record_role_ids.some((id) => issued.has(id)
          || Object.values(binding.registration.pins).includes(id) || id === binding.registration.authority_reference)) refuse("identity_reuse");
        reserve(a.record_role_ids); for (const id of a.record_role_ids) roles.add(id); q.state = "records_bound";
      });
    },
    finish(t: object, raw: unknown) {
      run(t, (q) => { const a = parse(onlyObservation, raw); expect(q, "interpretation_complete"); observe(q, a.observation); q.state = "releasing"; });
    },
    cancel(t: object, raw: unknown) {
      const q = lookup(t); if (closed || q.state === "released") refuse("query_terminal");
      try { const a = parse(onlyObservation, raw); observe(q, a.observation, true); }
      catch { failure(q, "b3a_invalid_input"); throw new Error("b3a_invalid_input"); }
      failure(q, "b3a_cancelled");
    },
    release(t: object, raw: unknown) {
      const q = lookup(t); if (closed) refuse("model_closed"); if (q.state === "released") refuse("query_terminal");
      try {
        const a = parse(z.strictObject({ observation: observationSchema, outcome: z.enum(["confirmed", "unconfirmed"]) }), raw);
        if (q.state !== "releasing" && q.state !== "release_unconfirmed") refuse("release_order");
        observe(q, a.observation, true);
        if (a.outcome === "unconfirmed") { failure(q, "b3a_release_unconfirmed"); q.state = "release_unconfirmed"; }
        else { q.state = "released"; active = undefined; }
      } catch (e) {
        const reason = e instanceof Error && /^b3a_[a-z_]+$/.test(e.message) ? e.message : "b3a_invalid_input";
        failure(q, reason); throw new Error(reason);
      }
    },
    describe(t: object) {
      const q = lookup(t);
      return nativeBarAdmissionQueryModelResultSchema.parse({ ...noAuthority, schema: "native-bar-admission-query-model-result-v1",
        registration_hash: binding.registration_hash, query_id: q.id, state: closed ? "revoked" : q.state,
        model_order_consistent: !closed && q.state === "released" && q.failure === null && q.claims === 2,
        failure: q.failure, event_ordinal: String(q.ordinal), last_supplied_observation: q.last,
        checkpoint_claims_consumed: q.claims, retained_state_bytes: String(retained) });
    },
    close() { closed = true; if (active) { failure(active, "b3a_model_closed"); active.state = "revoked"; } },
  });
}

const occupied = z.strictObject({ entries: uint, inventory_bytes: uint, metadata_bytes: uint });
const lowerLimits = z.strictObject({ entries: z.number().int().positive().optional(), inventory_bytes: z.number().int().positive().optional(),
  metadata_bytes: z.number().int().positive().optional(), read_bytes: z.number().int().positive().optional(), response_bytes: z.number().int().positive().optional() });
const budgetSchema = z.strictObject({ binding: registrationSchema, limits: lowerLimits.optional(),
  inventory: z.strictObject({ data: occupied, witness: occupied, common: occupied }), retained_metadata_bytes: uint,
  retained_protocol_bytes: uint, decoded_transcript_bytes: uint, verifier_work_bytes: uint, provider_work_bytes: uint,
  read_work: z.array(z.strictObject({ kind: z.enum(["content", "directory", "acl", "metadata"]), bytes: uint, count: uint.refine((v) => v !== "0") })).max(L.entries),
  response: z.strictObject({ supplied_bytes: uint, buffer_bytes: uint }), resources: z.strictObject({ live_roots: uint, live_targets: uint, live_fds: uint }) });
const total = z.string().regex(/^(0|[1-9][0-9]{0,89})$/);
const totals = z.strictObject({ entries: total, inventory_bytes: total, metadata_bytes: total, read_bytes: total, response_bytes: total });
export const nativeBarAdmissionQueryModelBudgetResultSchema = z.strictObject({ ...qualificationShape,
  schema: z.literal("native-bar-admission-query-model-budget-v1"), model_fits: z.boolean(),
  blockers: z.array(z.enum(["entries_limit", "inventory_bytes_limit", "metadata_bytes_limit", "read_bytes_limit", "response_bytes_limit",
    "root_lease_limit", "live_target_limit", "descriptor_headroom_limit"])).max(8), used: totals, remaining: totals, native_allowance: totals,
  schedule: z.strictObject({ native_inventory_passes: z.literal(6), content_capture_passes: z.literal(3), final_rehashes: z.literal(2),
    content_passes: z.literal(5), checkpoint_requests: z.literal(2), checkpoint_response_byte_limit: z.literal(4096) }),
  two_root_slots_required: z.literal(2), descriptor_headroom_required: z.literal(48) }).refine((r) => r.model_fits === (r.blockers.length === 0));
/** Finite supplied-work floor, not a native reservation, provider authentication or physical capacity check. */
export function calculateSyntheticAdmissionQueryProtocolBudget(input: unknown) {
  const q = parse(budgetSchema, input, 256 * 1024), b = registration(q.binding), r = b.registration;
  const limits = validateSyntheticAdmissionReadLimits(q.limits);
  const floor = calculateSyntheticAdmissionReadBudget({ registration: r, ...(q.limits ? { limits: q.limits } : {}), inventory: q.inventory,
    retained_metadata_bytes: q.retained_metadata_bytes, read_work: q.read_work, response: q.response, resources: q.resources });
  const selected = q.read_work.filter((w) => w.kind === "content");
  const content = selected.reduce((n, w) => n + BigInt(w.bytes) * BigInt(w.count), 0n), objects = selected.reduce((n, w) => n + BigInt(w.count), 0n);
  const controls = BigInt(r.bindings.markers.base.size) + BigInt(r.bindings.markers.admission.size) + BigInt(bytes({ schema: "native-bar-synthetic-admission-profile-v6" }));
  const external = 10n * 4096n, scratch = 65536n, ledger = 65536n + BigInt(L.entries + 9) * 4096n + BigInt(bytes(b));
  // The extra V1 native passes (content, guards, inventory, controls and fixed overhead) are performed by the native reader
  // itself, inside native_allowance, so they are added to the plan but never subtracted from that allowance. Only outer
  // work is: framing, scratch, B-1 decoding/verification, provider work, retained copies and the request ledger.
  const v1Native = content + objects * 65536n + 2n * BigInt(floor.used.entries) * 3072n + controls * (3n + objects)
    + 3n * (BigInt(r.bindings.ancestors.length) + 4n) * 12288n;
  const outer: Record<keyof typeof limits, bigint> = {
    entries: 0n, inventory_bytes: 0n,
    metadata_bytes: 2n * content + external + scratch + ledger + BigInt(q.retained_protocol_bytes) + BigInt(q.decoded_transcript_bytes),
    read_bytes: 3n * content + external + scratch + BigInt(q.verifier_work_bytes) + BigInt(q.provider_work_bytes),
    response_bytes: 65536n + external,
  };
  const keys = Object.keys(limits) as (keyof typeof limits)[], blockers = floor.blockers.filter((k) => !k.endsWith("_bytes_limit") && k !== "entries_limit");
  const used = Object.fromEntries(keys.map((k) => [k, BigInt(floor.used[k]) + (k === "read_bytes" ? v1Native : 0n) + outer[k]])) as Record<keyof typeof limits, bigint>;
  for (const k of keys) if (used[k] > BigInt(limits[k]!)) blockers.push(`${k}_limit`);
  const remaining = Object.fromEntries(keys.map((k) => [k, String(BigInt(limits[k]!) > used[k] ? BigInt(limits[k]!) - used[k] : 0n)]));
  const native_allowance = Object.fromEntries(keys.map((k) => [k, String(BigInt(limits[k]!) > outer[k] ? BigInt(limits[k]!) - outer[k] : 0n)]));
  const result = { ...noAuthority, schema: "native-bar-admission-query-model-budget-v1" as const, model_fits: blockers.length === 0, blockers,
    used: Object.fromEntries(keys.map((k) => [k, String(used[k])])), remaining, native_allowance,
    schedule: { native_inventory_passes: 6 as const, content_capture_passes: 3 as const, final_rehashes: 2 as const,
      content_passes: 5 as const, checkpoint_requests: 2 as const, checkpoint_response_byte_limit: 4096 as const },
    two_root_slots_required: 2 as const, descriptor_headroom_required: 48 as const };
  if (bytes(result) > L.response_bytes) refuse("response_bytes"); return nativeBarAdmissionQueryModelBudgetResultSchema.parse(result);
}
