import { z } from "zod";
import { uint, label, code, digestSchema as hash, count, parse, canonical, digest, sha, byteLength, freeze, flags, LIMITS } from "./unsignedControllerData.mjs";
import { readUnsignedControllerFrame, validateUnsignedWireBinding, readySchema, failureSchema } from "./unsignedControllerWireContracts.mjs";
import { describeUnsignedAcceptanceRun } from "./jointUnsignedAcceptanceContracts.mjs";
import { describeUnsignedQualificationProfile } from "./unsignedCohortQualificationContracts.mjs";

const refuse = reason => { throw Error(`cc4c2a_${reason}`); };
const base = () => ({ ...flags(), scope: "unsigned_worker_startup_memory_only", runtime_completion_proven: false });
const profile = describeUnsignedQualificationProfile();
const components = ["record_reader", "closed_set", "module_initialization", "metadata_host_profile", "native_profile", "work_plan"];
const state = z.enum(["unavailable", "matched_supplied", "refused"]);
const mode = z.enum(["normal", "ubsan"]), max = 999999999999999999999999999999n;
// Fixed conservative hash reservations cover canonical checks and digests, not V8 heap or measured runtime cost.
const wireCharge = 8 * LIMITS.frame_bytes, subjectCharge = 4 * LIMITS.frame_bytes;
const costs = ["record_bytes", "module_bytes", "pin_bytes", "metadata_hash_bytes"];
const modeWork = z.object({ mode, startups: z.literal(12), ...Object.fromEntries(costs.map(k => [k, uint.nullable()])),
  helper_commands: count(profile.helper_commands).nullable() }).strict();
const handoffSchema = z.object({ binding_sha256: hash, ready_payload: readySchema,
  write_return: z.boolean().nullable(), callback: z.enum(["pending", "completed", "uncertain"]),
  decision: z.enum(["pending", "completed", "uncertain", "withheld"]), status_closed: z.boolean(), status_error: code.nullable(),
  pending_prepare: z.object({ bytes: count(LIMITS.frame_bytes, 1), sha256: hash }).strict().nullable() }).strict();
const subjectSchema = z.object({ binding: z.unknown(), expected: z.object({ mode, binding_sha256: hash, closed_set_sha256: hash,
  module_set_sha256: hash, build_record_sha256: hash }).strict(),
  clock: z.object({ clock_domain: label, started_ns: uint, local_end_ns: uint }).strict(),
  components: z.object(Object.fromEntries(components.map(k => [k, state]))).strict(),
  manifest: z.object({ rows: count(profile.manifest_rows, 1), pages: count(profile.manifest_pages, 1), page_rows: count(profile.page_rows, 1),
    page_bytes: count(profile.page_bytes, 1), manifest_bytes: count(profile.manifest_bytes, 1), record_bytes: count(profile.build_record_bytes, 1), file_bytes: uint }).strict(),
  work: z.object({ case_count: z.literal(24), modes: z.array(modeWork).length(2), other_hash_bytes: uint.nullable(),
    other_helper_commands: count(profile.helper_commands).nullable() }).strict(), handoff: handoffSchema.nullable() }).strict();

function subject(input) {
  const d = parse(subjectSchema, input), b = validateUnsignedWireBinding(d.binding), m = d.manifest;
  work(d);
  if (b.setup !== null || b.mode !== d.expected.mode || digest(b) !== d.expected.binding_sha256
    || b.build_record_sha256 !== d.expected.build_record_sha256) refuse("subject_binding");
  const run = describeUnsignedAcceptanceRun({ schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: b.run_id,
    source_commit: b.source_commit, patch_sha256: b.patch_sha256 });
  if (run.plan_sha256 !== b.plan_sha256 || !run.cases.some(c => c.case_id === b.case_id && c.mode === b.mode)) refuse("plan_binding");
  const start = BigInt(d.clock.started_ns), end = BigInt(d.clock.local_end_ns);
  if (start + BigInt(LIMITS.preparation_ms) * 1000000n > max || end - start < 1000000n) refuse("clock_subject");
  if (new Set(d.work.modes.map(v => v.mode)).size !== 2 || m.rows > m.pages * m.page_rows || m.manifest_bytes > m.pages * m.page_bytes
    || m.manifest_bytes > m.record_bytes || BigInt(m.file_bytes) > BigInt(profile.file_bytes)
    || d.work.modes.some(v => v.record_bytes !== null && BigInt(v.record_bytes) !== BigInt(m.record_bytes))) refuse("manifest_work");
  const h = d.handoff;
  if (h) {
    if (h.binding_sha256 !== d.expected.binding_sha256 || h.ready_payload.pins_sha256 !== d.expected.binding_sha256
      || h.ready_payload.worker_clock_domain !== d.clock.clock_domain) refuse("handoff_binding");
    if (h.decision === "completed" && (h.callback !== "completed" || h.write_return === null)
      || h.decision === "withheld" && (h.write_return !== null || h.callback !== "pending")) refuse("handoff_outcome");
  }
  return { ...d, binding: b };
}

function work(d) {
  const blockers = [], unknown = name => blockers.push(name + "_unknown");
  let hashBytes = BigInt(24 * (subjectCharge + LIMITS.frames * wireCharge)), helpers = 0;
  for (const v of d.work.modes) {
    for (const k of costs) { if (v[k] === null) unknown(v.mode + "_" + k); else hashBytes += 12n * BigInt(v[k]); }
    if (v.helper_commands === null) unknown(v.mode + "_helper_commands"); else helpers += 12 * v.helper_commands;
  }
  if (d.work.other_hash_bytes === null) unknown("other_hash_bytes"); else hashBytes += BigInt(d.work.other_hash_bytes);
  if (d.work.other_helper_commands === null) unknown("other_helper_commands"); else helpers += d.work.other_helper_commands;
  // A known lower bound can already refuse, even when another cost is unknown.
  if (hashBytes > BigInt(profile.hash_work_bytes) || helpers > profile.helper_commands) refuse("work_bound");
  return { blockers, known_hash_bytes: String(hashBytes), known_helper_commands: helpers,
    modeled_hash_bytes: blockers.some(k => !k.includes("helper_commands")) ? null : String(hashBytes),
    modeled_helper_commands: blockers.some(k => k.includes("helper_commands")) ? null : helpers };
}

function plan(d) {
  const w = work(d), blockers = [...components.filter(k => d.components[k] !== "matched_supplied").map(k => k + "_" + d.components[k]), ...w.blockers];
  const complete = blockers.length === 0, h = d.handoff, start = BigInt(d.clock.started_ns);
  const end = BigInt(d.clock.local_end_ns), phase = start + BigInt(LIMITS.preparation_ms) * 1000000n;
  return freeze({ ...base(), schema: "native-bar-worker-startup-plan-v1", binding_sha256: d.expected.binding_sha256, mode: d.binding.mode,
    closed_set_sha256: d.expected.closed_set_sha256, module_set_sha256: d.expected.module_set_sha256,
    build_record_sha256: d.expected.build_record_sha256, template_preimage: "deferred_to_c3", supplied_plan_complete: complete, blockers,
    clock: { clock_domain: d.clock.clock_domain, started_ns: d.clock.started_ns, original_local_end_ns: d.clock.local_end_ns,
      preparation_end_ns: String(end < phase ? end : phase), helper_limit_ms: LIMITS.helper_ms, phase_timer_slots: 1, operation_timer_slots: 1 },
    case_count: 24, starts_per_mode: 12, known_hash_bytes: w.known_hash_bytes, known_helper_commands: w.known_helper_commands,
    modeled_hash_bytes: w.modeled_hash_bytes, modeled_helper_commands: w.modeled_helper_commands,
    subject_hash_reservation_per_start: subjectCharge, wire_hash_reservation_per_frame: wireCharge,
    supplied_handoff_complete: !!(complete && h && h.decision === "completed" && h.callback === "completed" && h.write_return !== null
      && !h.status_closed && h.status_error === null), pending_prepare: h?.pending_prepare ?? null,
    native_budget_changed: false, runtime_producers: "unavailable" });
}

export function planUnsignedWorkerStartup(input) { return plan(subject(input)); }

const envelopeSchema = z.object({ line: z.string(), expected: z.object({ kind: z.enum(["LAUNCH", "READY", "FAILED", "PREPARE"]),
  direction: z.enum(["parent", "worker"]), next_ordinal: count(LIMITS.frames, 1), frames_spent: count(LIMITS.frames),
  binding: z.unknown(), worker_clock_domain: label }).strict(), reserved_hash_bytes: uint }).strict();

export function validateUnsignedWorkerStartupEnvelope(input) {
  const d = parse(envelopeSchema, input);
  if (BigInt(d.reserved_hash_bytes) < BigInt(wireCharge)) refuse("wire_reservation");
  // Reservation is consumed before decode/canonical/hash. Failure carries the same debit; there is no refund or runtime ledger here.
  try {
    const expected = d.expected, b = validateUnsignedWireBinding(expected.binding), f = readUnsignedControllerFrame(d.line);
    if (expected.frames_spent >= LIMITS.frames) refuse("frame_capacity");
    if (f.kind !== expected.kind || f.ordinal !== expected.next_ordinal) refuse("wire_order");
    const direction = ["LAUNCH", "PREPARE"].includes(f.kind) ? "parent" : "worker";
    if (f.direction !== direction || expected.direction !== direction) refuse("wire_direction");
    const fb = validateUnsignedWireBinding(f.binding);
    let payload = null, configurationBytes = null;
    if (f.kind === "PREPARE") {
      if (b.setup !== null || fb.setup === null || canonical({ ...fb, setup: null }) !== canonical(b)) refuse("prepare_binding");
      const p = parse(z.object({ configuration: z.unknown(), launch_nonce: label }).strict(), f.payload);
      configurationBytes = byteLength(canonical(p.configuration));
      if (configurationBytes > LIMITS.configuration_bytes || p.launch_nonce !== b.launch_nonce) refuse("prepare_payload");
    } else {
      if (canonical(fb) !== canonical(b)) refuse("wire_binding");
      if (f.kind === "LAUNCH") {
        if (b.setup !== null || f.ordinal !== 1 || expected.frames_spent !== 0) refuse("launch_binding");
        parse(z.object({}).strict(), f.payload);
      } else if (f.kind === "READY") {
        payload = parse(readySchema, f.payload);
        if (b.setup !== null || payload.pins_sha256 !== digest(b) || payload.worker_clock_domain !== expected.worker_clock_domain) refuse("ready_binding");
      } else {
        payload = parse(failureSchema, f.payload);
        if (payload.query_created || payload.phase !== (b.setup === null ? "launch" : "prepare")) refuse("failure_binding");
      }
    }
    return freeze({ ...base(), schema: "native-bar-worker-startup-envelope-v1", kind: f.kind, direction: f.direction, ordinal: f.ordinal,
      frames_after: expected.frames_spent + 1, next_ordinal: f.ordinal + 1, binding_sha256: digest(fb), line_sha256: sha(d.line), bytes: byteLength(d.line),
      charged_hash_bytes: String(wireCharge), payload, configuration_bytes: configurationBytes,
      classification: f.kind === "PREPARE" ? "pending_c3_validation" : "consistent_supplied_envelope" });
  } catch (error) { error.startup_work = freeze({ charged_hash_bytes: String(wireCharge), refunded: false }); throw error; }
}

function maximumPlan() {
  const h = "f".repeat(64), l = "l".repeat(48), u = "9".repeat(30);
  return { ...base(), schema: "native-bar-worker-startup-plan-v1", binding_sha256: h, mode: "normal", closed_set_sha256: h, module_set_sha256: h,
    build_record_sha256: h, template_preimage: "deferred_to_c3", supplied_plan_complete: false,
    blockers: [...components.map(k => k + "_matched_supplied"), ...["normal", "ubsan"].flatMap(m => [...costs, "helper_commands"].map(k => m + "_" + k + "_unknown")), "other_hash_bytes_unknown", "other_helper_commands_unknown"],
    clock: { clock_domain: l, started_ns: u, original_local_end_ns: u, preparation_end_ns: u, helper_limit_ms: LIMITS.helper_ms, phase_timer_slots: 1, operation_timer_slots: 1 },
    case_count: 24, starts_per_mode: 12, known_hash_bytes: u, known_helper_commands: profile.helper_commands, modeled_hash_bytes: u,
    modeled_helper_commands: profile.helper_commands, subject_hash_reservation_per_start: subjectCharge, wire_hash_reservation_per_frame: wireCharge,
    supplied_handoff_complete: false, pending_prepare: { bytes: LIMITS.frame_bytes, sha256: h }, native_budget_changed: false, runtime_producers: "unavailable" };
}

export function describeUnsignedWorkerStartupCapacity(input) {
  const d = subject(input), p = plan(d), h = "f".repeat(64), l = "l".repeat(48), u = "9".repeat(30), c = "c".repeat(96);
  const binding = validateUnsignedWireBinding({ ...d.binding, mode: "normal", run_id: l, case_id: l, exchange_id: l, launch_nonce: l });
  const ready = { addon_protocol: 6, mode: "synthetic_only", pins_sha256: h, worker_clock_domain: l };
  const failure = { phase: "settlement", primary_code: c, close_errors: Array(8).fill(c), diagnostic_sha256: h,
    resources: { fds: u, roots: u, workspace: u, retained: u }, query_created: false, instrumentation_overflow: false };
  const frame = (kind, payload) => byteLength(canonical({ binding: kind === "READY" ? binding : { ...binding,
    setup: { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h } },
    direction: "worker", ordinal: 32, kind, payload }) + "\n");
  const envelope = { ...base(), schema: "native-bar-worker-startup-envelope-v1", kind: "PREPARE", direction: "worker", ordinal: 32,
    frames_after: 32, next_ordinal: 33, binding_sha256: h, line_sha256: h, bytes: LIMITS.frame_bytes, charged_hash_bytes: String(wireCharge), payload: failure,
    configuration_bytes: LIMITS.configuration_bytes, classification: "consistent_supplied_envelope" };
  const maximalPlan = maximumPlan(), metadata = byteLength(canonical({ plan: maximalPlan, envelope }));
  const retained = { decoder_pending: LIMITS.frame_bytes, pending_prepare: LIMITS.frame_bytes, status_lines: 2 * LIMITS.frame_bytes,
    manifest_page: profile.page_bytes, hash_buffer: profile.hash_buffer_bytes };
  const transient = { input_copy: LIMITS.frames * LIMITS.frame_bytes, validation_copy: LIMITS.frames * LIMITS.frame_bytes, canonical_frame: LIMITS.frame_bytes };
  const sum = values => Object.values(values).reduce((a, b) => a + b, 0);
  if (metadata > 16384 || sum(retained) > 2375680 || sum(transient) > 4259840) refuse("capacity_bound");
  return freeze({ ...base(), schema: "native-bar-worker-startup-capacity-v1", maximal_plan: maximalPlan, maximal_envelope: envelope,
    maximal_payloads: { READY: ready, FAILED: failure },
    diagnostic_ceiling_bytes: metadata, diagnostic_limit_bytes: 16384, coordinator_metadata_limit_bytes: 65536,
    frame_kind_ceilings: { READY: frame("READY", ready), FAILED: frame("FAILED", failure) }, shared_frame_limit: LIMITS.frames,
    retained_buffers: retained, retained_buffer_bytes: sum(retained), retained_limit_bytes: 2375680,
    transient_buffers: transient, transient_buffer_bytes: sum(transient), transient_limit_bytes: 4259840,
    lifetime_pairs: 1, lifetime_ports: 2, phase_timer_slots: 1, operation_timer_slots: 1,
    modeled_hash_bytes: p.modeled_hash_bytes, modeled_helper_commands: p.modeled_helper_commands,
    hash_work_limit_bytes: profile.hash_work_bytes, helper_command_limit: profile.helper_commands,
    full_record_retained: false, record_reader_available: false, native_budget_changed: false,
    parent_wrapper_calculated: false, calculation: "supplied_schema_and_separate_buffer_reservations_not_v8_heap_or_runtime_qualification" });
}
