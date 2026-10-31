import { z } from "zod";
import { uint, label, code, count, digestSchema, parse, canonical, byteLength, freeze, flags, LIMITS } from "./unsignedControllerData.mjs";
import { describeUnsignedQualificationProfile } from "./unsignedCohortQualificationContracts.mjs";

const refuse = reason => { throw Error(`cc4b4b1_${reason}`); };
const unit = 1000000n;
const base = () => ({ ...flags(), scope: "unsigned_parent_connection_memory_only", runtime_completion_proven: false });
const pointSchema = z.object({ clock_domain: label, monotonic_ns: uint }).strict();
const planSchema = z.object({ clock_domain: label, planned_ns: uint, phase_deadline_ns: uint, cohort_deadline_ns: uint }).strict();
const reservationSchema = planSchema.extend({ deadline_ns: uint }).strict();
const clockReasons = ["clock_unavailable", "clock_malformed", "clock_domain", "clock_rollback"];
const clockFailureSchema = z.object({ reason: z.enum(clockReasons) }).strict();
const commandKinds = ["LAUNCH", "PREPARE", "GO", "CANCEL", "FINALIZE"];
const exitSchema = z.object({ exit_code: count(255).nullable(), signal: z.string().regex(/^SIG[A-Z0-9]{1,12}$/).nullable() }).strict();
const commandSchema = z.object({ kind: z.enum(commandKinds), ordinal: count(32, 1), generation: count(5, 1), reservation: reservationSchema,
  sha256: digestSchema, bytes: count(LIMITS.frame_bytes, 1), started: z.boolean(), write_return_seen: z.boolean(), backpressure: z.boolean().nullable(),
  callback_seen: z.boolean(), observed_outcome: z.enum(["completed", "uncertain"]).nullable(), callback_at: pointSchema.nullable(),
  observation_point: pointSchema.nullable(), decision: z.enum(["planned", "started", "completed", "uncertain"]), shutdown: z.boolean() }).strict();
const pipeSchema = z.object({ present: z.boolean(), end_seen: z.boolean(), finish_seen: z.boolean(), close_seen: z.boolean(), error: code.nullable() }).strict();
const timerSchema = z.object({ owner: z.enum(["phase", "command", "helper"]), command_generation: count(5, 1).nullable(),
  generation: count(Number.MAX_SAFE_INTEGER, 1), segment: count(Number.MAX_SAFE_INTEGER, 1), deadline_ns: uint,
  referenced: z.boolean(), active: z.boolean(), cancel_attempted: z.boolean(), clear_unknown: z.boolean() }).strict();
const discardedSchema = z.object({ frames: count(LIMITS.frames + 1), bytes: count(LIMITS.frames * LIMITS.frame_bytes + 1), saturated: z.boolean() }).strict();
const terminalSchema = z.object({ schema: z.literal("native-bar-parent-terminal-facts-v1"), clock_domain: label,
  first_stop: z.object({ reason: code, at: pointSchema.nullable() }).strict().nullable(), clock_invalid: z.boolean(),
  launch: z.object({ reserved: z.boolean(), attempted: z.boolean(), returned: z.boolean() }).strict(), pending_generation: count(5, 1).nullable(),
  commands: z.array(commandSchema).max(5), child: z.object({ error: code.nullable(), exit: exitSchema.nullable(), close: exitSchema.nullable() }).strict(),
  pipes: z.object({ command: pipeSchema, status: pipeSchema, stdout: pipeSchema, stderr: pipeSchema }).strict(),
  command_end: z.object({ decision: z.enum(["not_requested", "withheld", "attempted"]), outcome: z.enum(["returned", "unknown"]).nullable() }).strict(),
  timers: z.object({ phase: timerSchema.nullable(), operation: timerSchema.nullable() }).strict(),
  helper: z.object({ active: z.boolean(), under_command_generation: count(5, 1).nullable() }).strict(),
  discarded_input: discardedSchema,
  secondary_errors: z.array(code).max(8) }).strict();
const costSchema = z.object({ hash_bytes: uint, helper_commands: count(131072) }).strict();
const workSchema = z.object({ case_count: z.literal(24), coverage: z.literal("invocation_totals_including_repeated_cases"), components: z.object({
  qualification: costSchema.nullable(), worker_startup: costSchema.nullable(), case_checks: costSchema.nullable(),
  wire_trace: costSchema.nullable(), supervision: costSchema.nullable() }).strict() }).strict();
function deadline(d) {
  const end = BigInt(d.phase_deadline_ns) < BigInt(d.cohort_deadline_ns) ? BigInt(d.phase_deadline_ns) : BigInt(d.cohort_deadline_ns);
  const left = (end - BigInt(d.planned_ns)) / unit;
  if (end <= BigInt(d.planned_ns) || left < 1n) refuse("reservation_remainder");
  return BigInt(d.planned_ns) + (left < BigInt(LIMITS.helper_ms) ? left : BigInt(LIMITS.helper_ms)) * unit;
}
function reservation(raw) {
  const r = parse(reservationSchema, raw);
  if (String(deadline(r)) !== r.deadline_ns) refuse("reservation_changed"); return r;
}

export function planUnsignedParentReservation(input) {
  const d = parse(planSchema, input), end = deadline(d);
  return freeze({ ...base(), schema: "native-bar-parent-reservation-model-v1", reservation: { ...d, deadline_ns: String(end) },
    operation_window_ms: String((end - BigInt(d.planned_ns)) / unit) });
}

export function validateUnsignedParentClockFailure(input) { return freeze(parse(clockFailureSchema, input)); }

function pointFailure(raw, domain, last) {
  if (raw === null) return { reason: "clock_unavailable", point: null };
  let at; try { at = parse(pointSchema, raw); } catch { return { reason: "clock_malformed", point: null }; }
  if (at.clock_domain !== domain) return { reason: "clock_domain", point: null };
  if (BigInt(at.monotonic_ns) < last) return { reason: "clock_rollback", point: null };
  return { reason: null, point: at };
}

export function planUnsignedParentCheckpoint(input) {
  const d = parse(z.object({ clock_domain: label, last_b2_ns: uint, at: z.unknown(), phase_deadline_ns: uint, cohort_deadline_ns: uint,
    pending: z.object({ reservation: reservationSchema, started: z.boolean() }).strict().nullable(), stopped: z.boolean(), clock_invalid: z.boolean() }).strict(), input);
  const last = BigInt(d.last_b2_ns), pending = d.pending === null ? null : reservation(d.pending.reservation);
  if (d.clock_invalid && !d.stopped) refuse("clock_state");
  if (pending && (pending.clock_domain !== d.clock_domain || pending.cohort_deadline_ns !== d.cohort_deadline_ns || BigInt(pending.planned_ns) > last)) refuse("reservation_binding");
  let bound = BigInt(d.phase_deadline_ns) < BigInt(d.cohort_deadline_ns) ? BigInt(d.phase_deadline_ns) : BigInt(d.cohort_deadline_ns), reason = "deadline";
  if (pending && BigInt(pending.deadline_ns) <= bound) { bound = BigInt(pending.deadline_ns); reason = "write_deadline"; }
  if (!d.stopped && last >= bound) refuse("checkpoint_order");
  const view = { ...base(), schema: "native-bar-parent-checkpoint-model-v1", route: "terminal_only", stop_first: null,
    forward_at: null, clock_failure: null, pending_expired: false, pending_disposition: null };
  if (d.clock_invalid) return freeze(view);
  const observed = pointFailure(d.at, d.clock_domain, last);
  if (observed.reason) return freeze({ ...view, route: "clock_failure", clock_failure: observed.reason,
    stop_first: d.stopped ? null : { reason: observed.reason, at: null } });
  const at = observed.point, expired = pending !== null && BigInt(at.monotonic_ns) >= BigInt(pending.deadline_ns);
  view.pending_expired = expired; view.pending_disposition = expired && d.pending.started ? "uncertain" : null;
  view.forward_at = at;
  if (!d.stopped && BigInt(at.monotonic_ns) >= bound) {
    view.route = "stop_before_input"; view.stop_first = { reason, at: { clock_domain: d.clock_domain, monotonic_ns: String(bound) } };
  } else view.route = d.stopped ? "terminal_only" : "normal";
  return freeze(view);
}

export function assessUnsignedParentCallback(input) {
  const d = parse(z.object({ kind: z.enum(commandKinds), reservation: reservationSchema, last_ns: uint, at: z.unknown(), started: z.boolean(), callback_seen: z.boolean(),
    previous_decision: z.enum(["started", "uncertain"]), observed_outcome: z.enum(["completed", "uncertain"]),
    stopped: z.boolean(), shutdown: z.boolean(), clock_invalid: z.boolean() }).strict(), input);
  const r = reservation(d.reservation), last = BigInt(d.last_ns);
  if (d.shutdown && d.kind !== "CANCEL") refuse("shutdown_kind");
  if (d.shutdown && !d.stopped) refuse("shutdown_state");
  if (d.previous_decision === "uncertain" && !d.stopped) refuse("callback_state");
  if (!d.started || d.callback_seen) refuse("callback_once");
  if (last < BigInt(r.planned_ns) || d.clock_invalid && !d.stopped) refuse("callback_binding");
  if (!d.stopped && last >= BigInt(r.deadline_ns)) refuse("checkpoint_order");
  const observed = d.clock_invalid ? { reason: "clock_latched", point: null } : pointFailure(d.at, r.clock_domain, last);
  const expired = observed.point !== null && BigInt(observed.point.monotonic_ns) >= BigInt(r.deadline_ns);
  const at = expired ? null : observed.point;
  let decision = d.previous_decision, relay = null, stop = null;
  if (expired) decision = "uncertain";
  else if (d.observed_outcome === "uncertain" || (!d.stopped || d.shutdown) && at !== null) {
    if (decision === "started") decision = d.observed_outcome;
  }
  if (d.previous_decision === "started" && decision !== "started" && observed.point !== null) relay = decision;
  if (!d.stopped) {
    if (observed.reason) stop = { reason: observed.reason, at: null };
    else if (expired) stop = { reason: "write_deadline", at: { clock_domain: r.clock_domain, monotonic_ns: r.deadline_ns } };
    else if (d.observed_outcome === "uncertain") stop = { reason: "pipe_uncertain", at };
  }
  return freeze({ ...base(), schema: "native-bar-parent-callback-model-v1", observed_outcome: d.observed_outcome, observation_point: observed.point,
    callback_at: at, decision, relay_outcome: relay, stop_first: stop, clock_failure: observed.reason, deadline_expired: expired });
}

export function validateUnsignedParentTerminalFacts(input) {
  const d = parse(terminalSchema, input), kinds = new Set(); let ordinal = 0, cohortEnd = null;
  const sameDomain = at => { if (at !== null && at.clock_domain !== d.clock_domain) refuse("terminal_domain"); };
  sameDomain(d.first_stop?.at ?? null);
  if (d.clock_invalid && d.first_stop === null) refuse("clock_facts");
  checkCounter(d.discarded_input);
  if (d.launch.returned && !d.launch.attempted || d.launch.attempted && !d.launch.reserved) refuse("launch_facts");
  for (const [index, c] of d.commands.entries()) {
    const r = reservation(c.reservation);
    if (c.generation !== index + 1 || c.ordinal <= ordinal || kinds.has(c.kind)) refuse("command_facts");
    ordinal = c.ordinal; kinds.add(c.kind);
    if (r.clock_domain !== d.clock_domain || cohortEnd !== null && r.cohort_deadline_ns !== cohortEnd) refuse("reservation_binding");
    cohortEnd = r.cohort_deadline_ns; sameDomain(c.callback_at); sameDomain(c.observation_point);
    if (c.callback_seen !== (c.observed_outcome !== null) || c.callback_seen && !c.started || c.write_return_seen !== (c.backpressure !== null)
      || c.write_return_seen && !c.started || c.decision === "planned" && c.started || c.decision !== "planned" && !c.started
      || !c.callback_seen && (c.callback_at !== null || c.observation_point !== null)) refuse("callback_facts");
    if (c.shutdown && c.kind !== "CANCEL") refuse("shutdown_kind");
    if (c.shutdown && d.first_stop === null) refuse("shutdown_state");
    if (c.decision === "completed" && (!c.callback_seen || c.observed_outcome !== "completed" || c.callback_at === null)
      || c.callback_seen && c.observed_outcome === "uncertain" && c.decision !== "uncertain") refuse("callback_facts");
    if (c.callback_at !== null && (canonical(c.callback_at) !== canonical(c.observation_point) || BigInt(c.callback_at.monotonic_ns) >= BigInt(r.deadline_ns))) refuse("callback_facts");
    if (c.observation_point !== null && BigInt(c.observation_point.monotonic_ns) < BigInt(r.planned_ns)) refuse("callback_facts");
    if (c.observation_point !== null && BigInt(c.observation_point.monotonic_ns) >= BigInt(r.deadline_ns) && c.decision !== "uncertain") refuse("callback_facts");
  }
  const pending = d.commands.find(c => c.generation === d.pending_generation);
  if (d.pending_generation !== null && (!pending || pending.callback_seen || pending.decision === "completed"
    || pending.decision === "uncertain" && d.first_stop === null)) refuse("pending_facts");
  for (const [slot, t] of Object.entries(d.timers)) if (t !== null) {
    const command = d.commands.find(c => c.generation === t.command_generation);
    if ((slot === "phase") !== (t.owner === "phase") || t.owner === "command" && (!command || t.deadline_ns !== command.reservation.deadline_ns)
      || t.owner !== "command" && t.command_generation !== null || t.clear_unknown && (!t.cancel_attempted || t.active)) refuse("timer_facts");
    if (cohortEnd !== null && BigInt(t.deadline_ns) > BigInt(cohortEnd) || t.active && t.owner === "helper" && !d.helper.active) refuse("timer_facts");
  }
  if (d.helper.under_command_generation !== null && (!d.helper.active || !pending || pending.generation !== d.helper.under_command_generation
    || pending.started || d.timers.operation?.owner !== "command" || d.timers.operation.command_generation !== pending.generation)) refuse("helper_facts");
  if (d.helper.active && pending?.started) refuse("helper_facts");
  if (d.command_end.decision === "attempted" ? !d.pipes.command.present : d.command_end.outcome !== null) refuse("end_facts");
  return freeze({ ...base(), schema: "native-bar-parent-terminal-view-v1", facts: d, semantic_verified: false });
}

function maximalShapeView() {
  const l = "l".repeat(48), c = "c".repeat(96), u = "9".repeat(30), at = { clock_domain: l, monotonic_ns: u };
  const pipe = { present: false, end_seen: false, finish_seen: false, close_seen: false, error: c };
  const timer = { owner: "command", command_generation: null, generation: Number.MAX_SAFE_INTEGER, segment: Number.MAX_SAFE_INTEGER,
    deadline_ns: u, referenced: false, active: false, cancel_attempted: false, clear_unknown: false };
  const command = { kind: "FINALIZE", ordinal: 32, generation: 5, reservation: { clock_domain: l, planned_ns: u,
    phase_deadline_ns: u, cohort_deadline_ns: u, deadline_ns: u }, sha256: "f".repeat(64), bytes: LIMITS.frame_bytes,
    started: false, write_return_seen: false, backpressure: false, callback_seen: false, observed_outcome: "uncertain", callback_at: at,
    observation_point: at, decision: "uncertain", shutdown: false };
  // Independent leaf maxima deliberately overcount incompatible states; this is not a supplied lifecycle.
  const facts = parse(terminalSchema, { schema: "native-bar-parent-terminal-facts-v1", clock_domain: l, first_stop: { reason: c, at }, clock_invalid: false,
    launch: { reserved: false, attempted: false, returned: false }, pending_generation: null, commands: Array(5).fill(command),
    child: { error: c, exit: { exit_code: null, signal: "SIG" + "X".repeat(12) }, close: { exit_code: null, signal: "SIG" + "X".repeat(12) } },
    pipes: { command: pipe, status: pipe, stdout: pipe, stderr: pipe }, command_end: { decision: "not_requested", outcome: "returned" },
    timers: { phase: timer, operation: timer }, helper: { active: false, under_command_generation: null },
    discarded_input: { frames: LIMITS.frames + 1, bytes: LIMITS.frames * LIMITS.frame_bytes + 1, saturated: false }, secondary_errors: Array(8).fill(c) });
  return { ...base(), schema: "native-bar-parent-terminal-view-v1", facts, semantic_verified: false };
}

export function describeUnsignedParentConnectionCapacity(input) {
  const d = parse(z.object({ b2_coordinator_bytes: count(65536, 47087).default(47087), work_plan: workSchema.nullable().default(null) }).strict(), input);
  const maximal = maximalShapeView(), sidecar = byteLength(canonical(maximal)), combined = d.b2_coordinator_bytes + sidecar;
  if (sidecar > 16384 || combined > 65536) refuse("metadata_capacity");
  const limits = describeUnsignedQualificationProfile(), unknown = []; let hashes = 0n, helpers = 0;
  if (d.work_plan === null) unknown.push("runtime_work_plan_unavailable");
  else for (const [name, cost] of Object.entries(d.work_plan.components)) {
    if (cost === null) unknown.push(`${name}_work_unavailable`); else { hashes += BigInt(cost.hash_bytes); helpers += cost.helper_commands; }
  }
  if (hashes > BigInt(limits.hash_work_bytes) || helpers > limits.helper_commands) refuse("work_capacity");
  return freeze({ ...base(), schema: "native-bar-parent-connection-capacity-v1", sidecar_ceiling_bytes: sidecar,
    b2_coordinator_reserved_bytes: d.b2_coordinator_bytes, coordinator_ceiling_bytes: combined,
    diagnostic_limit_bytes: 16384, coordinator_limit_bytes: 65536, maximal_shape_view: maximal,
    maximum_shape_only: true, measurement: "canonical_metadata_not_v8_heap", native_budget_changed: false,
    retained_buffer_bytes: LIMITS.frames * LIMITS.frame_bytes + LIMITS.frame_bytes + LIMITS.trace_events * LIMITS.trace_event_bytes + LIMITS.frame_bytes + 2 * 8192,
    transient_buffer_bytes: 2 * LIMITS.frames * LIMITS.frame_bytes + LIMITS.frame_bytes,
    work_plan_status: d.work_plan === null ? "unavailable" : unknown.length ? "partial" : "complete_supplied_totals",
    supplied_hash_bytes: String(hashes), supplied_helper_commands: helpers, blockers: unknown, runtime_work_qualified: false,
    work_limits: { hash_bytes: limits.hash_work_bytes, helper_commands: limits.helper_commands } });
}

export function describeUnsignedParentConnectionProfile() {
  return freeze({ ...base(), schema: "native-bar-parent-connection-profile-v1", original_reference_verified: false,
    single_admission_owner: "b2_protocol_window", pending_commands: 1, command_records: 5, pipe_slots: 4, timer_slots: 2,
    helper_slots: 1, builder_timer_must_be_empty: true, clock_failure_reasons: [...clockReasons],
    producer_blockers: {
      LAUNCH: ["original_allocation_unavailable", "original_case_receipt_unavailable", "qualified_worker_closure_unavailable", "host_profile_unavailable", "runtime_work_plan_unavailable"],
      PREPARE: ["original_sealed_setup_unavailable"], GO: ["original_go_readback_proofs_unavailable"],
      CANCEL_ordinary: ["original_cancellation_decision_unavailable"], CANCEL_shutdown: ["original_shutdown_authority_unavailable"],
      FINALIZE: ["original_teardown_proofs_unavailable"],
    } });
}

function checkCounter(c) {
  if (!c.saturated && (c.frames > LIMITS.frames || c.bytes > LIMITS.frames * LIMITS.frame_bytes)) refuse("counter_facts");
}

export function summarizeUnsignedParentDiscard(input) {
  const d = parse(z.object({ counter: discardedSchema, frames: count(Number.MAX_SAFE_INTEGER), bytes: count(Number.MAX_SAFE_INTEGER) }).strict(), input);
  checkCounter(d.counter); let counter = d.counter;
  if (!counter.saturated) {
    const frames = BigInt(counter.frames) + BigInt(d.frames), bytes = BigInt(counter.bytes) + BigInt(d.bytes);
    const frameLimit = BigInt(LIMITS.frames + 1), byteLimit = BigInt(LIMITS.frames * LIMITS.frame_bytes + 1);
    counter = { frames: Number(frames < frameLimit ? frames : frameLimit), bytes: Number(bytes < byteLimit ? bytes : byteLimit),
      saturated: frames >= frameLimit || bytes >= byteLimit };
  }
  return freeze({ ...base(), schema: "native-bar-parent-discard-summary-v1", counter, complete_supplied_count: !counter.saturated });
}
