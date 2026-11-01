import { z } from "zod";
import { uint, label, code, digestSchema, count, parse, canonical, digest, byteLength, freeze, flags, LIMITS, baselineSchema } from "./unsignedControllerData.mjs";
import { validateUnsignedWorkerConfiguration } from "./unsignedWorkerConfiguration.mjs";
import { describeUnsignedQualificationProfile } from "./unsignedCohortQualificationContracts.mjs";
import { describeUnsignedWorkerTransportCapacity, createUnsignedWorkerLifetimeModel, encodeUnsignedTransportFrame } from "./unsignedWorkerTransportContracts.mjs";
import { describeUnsignedFixture } from "./jointUnsignedAcceptanceContracts.mjs";

const refuse = reason => { throw Error(`cc4c1_${reason}`); };
const names = ["closed_set", "build_record", "module_set", "host_profile", "native_profile", "work_plan"];
const component = z.enum(["unavailable", "matched_supplied", "refused"]);
const profile = describeUnsignedQualificationProfile();
const base = () => ({ ...flags(), scope: "unsigned_worker_preparation_memory_only", runtime_completion_proven: false });
const pointSchema = z.object({ clock_domain: label, monotonic_ns: uint }).strict();
const modeWork = z.object({ mode: z.enum(["normal", "ubsan"]), startups: z.literal(12), record_bytes: uint, module_bytes: uint, pin_bytes: uint,
  metadata_hash_bytes: uint, helper_commands: count(profile.helper_commands) }).strict();
const subjectSchema = z.object({ allocation: z.unknown(), launch_binding_sha256: digestSchema, closed_set_sha256: digestSchema, module_set_sha256: digestSchema,
  clock: z.object({ parent_domain: label, worker_domain: label, started_ns: uint, local_end_ns: uint }).strict(),
  components: z.object(Object.fromEntries(names.map(n => [n, component]))).strict(),
  manifest: z.object({ rows: count(profile.manifest_rows, 1), pages: count(profile.manifest_pages, 1), page_rows: count(profile.page_rows, 1),
    page_bytes: count(profile.page_bytes, 1), manifest_bytes: count(profile.manifest_bytes, 1), record_bytes: count(profile.build_record_bytes, 1), file_bytes: uint }).strict(),
  work: z.object({ case_count: z.literal(24), modes: z.array(modeWork).length(2), wire_hash_bytes_per_start: uint,
    other_hash_bytes: uint, other_helper_commands: count(profile.helper_commands) }).strict() }).strict();
function subject(input) {
  const d = parse(subjectSchema, input), m = d.manifest;
  // Static serialization calculation only: the preparation model retains no parent protocol/transport ledger.
  describeUnsignedWorkerTransportCapacity(d.allocation);
  if (d.clock.parent_domain === d.clock.worker_domain || BigInt(d.clock.local_end_ns) <= BigInt(d.clock.started_ns)
    || BigInt(d.clock.started_ns) + BigInt(LIMITS.preparation_ms) * 1000000n > 999999999999999999999999999999n) refuse("clock_subject");
  if (new Set(d.work.modes.map(v => v.mode)).size !== 2 || m.rows > m.pages * m.page_rows || m.manifest_bytes > m.pages * m.page_bytes
    || m.manifest_bytes > m.record_bytes || BigInt(m.file_bytes) > BigInt(profile.file_bytes)
    || d.work.modes.some(v => BigInt(v.record_bytes) !== BigInt(m.record_bytes))) refuse("manifest_work");
  return d;
}
function workPlan(d) {
  const startup = d.work.modes.reduce((n, v) => n + BigInt(v.startups) * (BigInt(v.record_bytes) + BigInt(v.module_bytes) + BigInt(v.pin_bytes) + BigInt(v.metadata_hash_bytes)), 0n);
  const hash = startup + 24n * BigInt(d.work.wire_hash_bytes_per_start) + BigInt(d.work.other_hash_bytes);
  const commands = d.work.modes.reduce((n, v) => n + v.startups * v.helper_commands, d.work.other_helper_commands);
  if (hash > BigInt(profile.hash_work_bytes) || commands > profile.helper_commands) refuse("work_bound");
  return { modeled_hash_bytes: String(hash), modeled_helper_commands: commands, startup_hash_bytes: String(startup) };
}

export function planUnsignedWorkerPreparation(input) {
  const d = subject(input), work = workPlan(d), blockers = names.filter(n => d.components[n] !== "matched_supplied").map(n => `${n}_${d.components[n]}`);
  return freeze({ ...base(), schema: "native-bar-worker-preparation-plan-v1", ...work, supplied_plan_complete: blockers.length === 0, blockers,
    case_count: 24, coverage: "invocation_totals_including_repeated_cases", native_budget_changed: false });
}

export function describeUnsignedWorkerPreparationCapacity(input) {
  const d = subject(input), work = workPlan(d), transport = describeUnsignedWorkerTransportCapacity(d.allocation);
  const maximal = maximumView(), diagnostic = byteLength(canonical(maximal));
  const retained = { status_payloads: 3 * LIMITS.frame_bytes, prepare_input: LIMITS.configuration_bytes,
    configuration_validation_copy: LIMITS.configuration_bytes, decoder_pending: LIMITS.frame_bytes, manifest_page: profile.page_bytes, hash_buffer: profile.hash_buffer_bytes };
  const transient = { bounded_input_copy: LIMITS.frames * LIMITS.frame_bytes, validation_copy: LIMITS.frames * LIMITS.frame_bytes, canonical_fact: LIMITS.frame_bytes };
  const sum = o => Object.values(o).reduce((n, v) => n + v, 0);
  if (diagnostic > 16384 || diagnostic > 65536 || sum(retained) > transport.retained_buffer_bytes || sum(transient) > transport.transient_buffer_bytes) refuse("capacity_bound");
  return freeze({ ...base(), schema: "native-bar-worker-preparation-capacity-v1", ...work, maximal_view: maximal,
    diagnostic_ceiling_bytes: diagnostic, diagnostic_limit_bytes: 16384, coordinator_metadata_limit_bytes: 65536,
    frame_kind_ceilings: Object.fromEntries(["READY", "BASELINED", "FAILED"].map(k => [k, transport.serialization.frame_kind_ceilings[k]])),
    shared_frame_limit: LIMITS.frames, lifetime_work_records: transport.lifetime_work_records, lifetime_pairs: 1, lifetime_ports: 2,
    retained_buffers: retained, transient_buffers: transient, retained_buffer_bytes: sum(retained), transient_buffer_bytes: sum(transient),
    retained_envelope_bytes: transport.retained_buffer_bytes, transient_envelope_bytes: transport.transient_buffer_bytes,
    hash_work_limit_bytes: profile.hash_work_bytes, helper_command_limit: profile.helper_commands,
    manifest_profile: { rows: profile.manifest_rows, pages: profile.manifest_pages, page_rows: profile.page_rows, page_bytes: profile.page_bytes,
      manifest_bytes: profile.manifest_bytes, record_bytes: profile.build_record_bytes, file_bytes: profile.file_bytes },
    full_record_retained: false, native_budget_changed: false, calculation: "canonical_schema_reservation_not_reachable_state_or_v8_heap" });
}

const referencesSchema = z.tuple([z.enum(["referenced", "unreferenced", "unknown", "absent"]), z.enum(["referenced", "unreferenced", "unknown", "absent"])]);
const setupSchema = z.object({ fixture_name: z.string().regex(/^native-bar-fs-synthetic-[A-Za-z0-9]{6}$/), recipe_sha256: digestSchema,
  registration_sha256: digestSchema, envelope_sha256: digestSchema }).strict();
const addonSchema = z.object({ mode: z.literal("synthetic_only"), protocol: z.literal(6) }).strict();
const common = { session: z.unknown(), at: z.unknown() }, action = { ...common, action: z.unknown() }, pairFields = { ...common, pair: z.unknown(), index: count(1) };
const factSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("launch"), at: z.unknown(), kind: z.literal("LAUNCH"), direction: z.literal("parent"), ordinal: z.literal(1), binding_sha256: digestSchema, setup: z.null() }).strict(),
  z.object({ type: z.literal("startup_begin"), ...common }).strict(),
  z.object({ type: z.literal("startup_result"), ...action, outcome: z.enum(["returned", "refused", "unknown"]),
    components: subjectSchema.shape.components.nullable(), pins: z.object({ closed_set_sha256: digestSchema, module_set_sha256: digestSchema, build_record_sha256: digestSchema }).strict().nullable(), addon: addonSchema.nullable() }).strict(),
  z.object({ type: z.literal("pair_allocate"), ...common, ports: referencesSchema }).strict(),
  z.object({ type: z.literal("pair_listeners"), ...pairFields, event: z.enum(["installed", "removed", "message", "messageerror"]) }).strict(),
  z.object({ type: z.literal("pair_reference"), ...pairFields, outcome: z.enum(["returned", "threw", "unknown"]), has_ref: z.boolean().nullable() }).strict(),
  z.object({ type: z.literal("pair_close"), ...pairFields, outcome: z.enum(["returned", "threw", "unknown"]) }).strict(),
  z.object({ type: z.literal("pair_closed"), ...pairFields }).strict(),
  z.object({ type: z.literal("status_plan"), ...common, kind: z.enum(["READY", "BASELINED", "FAILED"]), references: referencesSchema }).strict(),
  z.object({ type: z.literal("status_start"), ...action, references: referencesSchema }).strict(),
  z.object({ type: z.literal("status_return"), ...action, value: z.boolean().nullable() }).strict(),
  z.object({ type: z.literal("status_callback"), ...action, outcome: z.enum(["completed", "uncertain"]) }).strict(),
  z.object({ type: z.literal("status_close"), ...action }).strict(),
  z.object({ type: z.literal("status_error"), ...action, reason: code }).strict(),
  z.object({ type: z.literal("prepare"), ...common, kind: z.literal("PREPARE"), direction: z.literal("parent"), ordinal: z.literal(2), binding_sha256: digestSchema,
    launch_nonce: label, setup: setupSchema, configuration: z.unknown() }).strict(),
  z.object({ type: z.literal("bootstrap_begin"), ...common, references: referencesSchema }).strict(),
  z.object({ type: z.literal("bootstrap_result"), ...action, outcome: z.enum(["returned", "refused", "unknown"]) }).strict(),
  z.object({ type: z.literal("baseline"), ...action, clock_domain: label, native_info: z.object({ live_fds: uint, live_sessions: uint }).strict(),
    bootstrap_info: z.object({ active_workspace_bytes: uint, retained_state_bytes: uint }).strict() }).strict(),
  z.object({ type: z.literal("bootstrap_close_begin"), ...action }).strict(),
  z.object({ type: z.literal("bootstrap_close_result"), ...action, outcome: z.enum(["confirmed", "threw", "unknown"]) }).strict(),
  z.object({ type: z.literal("stop"), ...common, reason: code }).strict(),
  z.object({ type: z.literal("command"), ...common, kind: z.enum(["GO", "CANCEL", "FINALIZE"]) }).strict(),
]);
const token = () => Object.freeze(Object.create(null));
const bootstrapView = () => ({ attempted: false, outcome: null, baseline_seen: false, close_attempted: false, close_outcome: null,
  registration_sha256: null, supplied_registration_sha256: null, supplied_data_inode: null });
const wireStatus = (kind, ordinal, payload, deadline, ceiling) => ({ kind, ordinal, payload, payload_sha256: digest(payload), frame_ceiling_bytes: ceiling,
  deadline_ns: String(deadline), started: false, return_seen: false, write_return: null, callback_seen: false, observed_outcome: null, callback_at: null,
  close_seen: false, decision: "planned" });

function maximumView() {
  const l = "l".repeat(48), u = "9".repeat(30), h = "f".repeat(64), c = "c".repeat(96), point = { clock_domain: l, monotonic_ns: u };
  const baseline = { resources: { fds: u, roots: u, workspace: u, retained: u }, clock_domain: l };
  const payloads = { READY: { addon_protocol: 6, mode: "synthetic_only", pins_sha256: h, worker_clock_domain: l }, BASELINED: baseline,
    FAILED: { phase: "prepare", primary_code: c, close_errors: Array(8).fill(c), diagnostic_sha256: null, resources: baseline.resources, query_created: false, instrumentation_overflow: false } };
  const lifetime = { ...flags(), scope: "unsigned_worker_transport_memory_only", runtime_completion_proven: false, schema: "native-bar-worker-lifetime-model-v2", session_id: l,
    attempted: false, stopped: c, ports: ["unreferenced", "unreferenced"], original_ports: [false, false], listeners: [false, false], listener_attempted: [false, false],
    reference_attempted: [false, false], reference_confirmed: [false, false], close_attempted: false, close_index: null, close_outcome: "returned",
    close_events: [false, false], close_confirmed: false, references_at_close: ["unreferenced", "unreferenced"],
    works: [...Array(32).fill({ kind: "status_write", ordinal: 32, outcome: "confirmed" }), ...["bootstrap", "owner", "reader", "query", "release"].map(kind => ({ kind, ordinal: 1, outcome: "confirmed" }))] };
  return { ...base(), schema: "native-bar-worker-preparation-model-v1", state: "BOOTSTRAP_PENDING", first_stop: c, stop_at: point, secondary_errors: Array(8).fill(c),
    clock_domain: l, origin_ns: u, last_ns: u, preparation_end_ns: u, clock_invalid: false, startup: { attempted: false, outcome: "returned" }, prepare_seen: false,
    setup: { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h }, baseline, baseline_sha256: h,
    bootstrap: { attempted: false, outcome: "returned", baseline_seen: false, close_attempted: false, close_outcome: "confirmed", registration_sha256: h, supplied_registration_sha256: h, supplied_data_inode: u },
    statuses: ["READY", "BASELINED", "FAILED"].map((kind, i) => ({ ...wireStatus(kind, i + 1, payloads[kind], u, LIMITS.frame_bytes), callback_at: point,
      observed_outcome: "uncertain", write_return: false, decision: "uncertain" })),
    pending_status: null, status_closed: false, status_error: c, modeled_startup_hash_bytes: u, modeled_wire_hash_bytes: u, modeled_helper_commands: profile.helper_commands,
    supplied_plan_complete: false, blockers: names.map(n => `${n}_unavailable`), lifetime, model_status: "incomplete_supplied_preparation" };
}

export function createUnsignedWorkerPreparationModel(input) {
  const d = subject(input), plan = planUnsignedWorkerPreparation(d), mode = d.work.modes.find(v => v.mode === d.allocation.fixture.mode);
  const frames = describeUnsignedWorkerTransportCapacity(d.allocation).serialization.frame_kind_ceilings;
  // The only locator variation is six alphanumeric characters; its encoded recipe length is fixed before PREPARE.
  const recipeBytes = byteLength(canonical(describeUnsignedFixture({ ...d.allocation.fixture, fixture_name: "native-bar-fs-synthetic-Ab123Z" })));
  const origin = BigInt(d.clock.started_ns), phaseEnd = origin + BigInt(LIMITS.preparation_ms) * 1000000n;
  const end = phaseEnd < BigInt(d.clock.local_end_ns) ? phaseEnd : BigInt(d.clock.local_end_ns);
  const lifetime = createUnsignedWorkerLifetimeModel({ session_id: d.allocation.exchange_id });
  let state = "NEW", stopped = null, stopAt = null, clockInvalid = false, last = origin, session = null, pair = null;
  let startup = null, startupResult = null, setup = null, prepareSeen = false, bootstrap = null, baseline = null, pending = null;
  let wireHash = 0n, startupHash = 0n, helperCommands = 0, statusClosed = false, statusError = null;
  const boot = bootstrapView(), statuses = [], actions = new Map(), secondary = [];
  const settle = op => { if (!op.settled) { lifetime.settleWork(op.work, { outcome: "confirmed" }); op.settled = true; } };
  function stop(reason, point = null) {
    if (!stopped) { stopped = reason; stopAt = point; }
    else if (reason !== stopped && secondary.length < 8 && !secondary.includes(reason)) secondary.push(reason);
    state = "STOPPED";
    // The lifetime latch is separate: a healthy original pair may still track the narrow FAILED write.
    if (pending && !pending.fact.started) { pending.fact.decision = "withheld"; settle(pending); pending = null; }
  }
  const view = () => freeze({ ...base(), schema: "native-bar-worker-preparation-model-v1", state, first_stop: stopped, stop_at: stopAt, secondary_errors: [...secondary],
    clock_domain: d.clock.worker_domain, origin_ns: d.clock.started_ns, last_ns: String(last), preparation_end_ns: String(end), clock_invalid: clockInvalid,
    startup: { attempted: startup !== null, outcome: startupResult }, prepare_seen: prepareSeen, setup, baseline, baseline_sha256: baseline === null ? null : digest(baseline),
    bootstrap: { ...boot }, statuses: statuses.map(v => ({ ...v.fact })), pending_status: pending?.fact.ordinal ?? null, status_closed: statusClosed, status_error: statusError,
    modeled_startup_hash_bytes: String(startupHash), modeled_wire_hash_bytes: String(wireHash), modeled_helper_commands: helperCommands,
    supplied_plan_complete: plan.supplied_plan_complete, blockers: plan.blockers, lifetime: lifetime.describe(),
    model_status: state === "PREPARED" ? "consistent_supplied_preparation" : "incomplete_supplied_preparation" });
  function point(raw, terminal = false) {
    if (clockInvalid) { if (terminal) return null; refuse("clock_invalid"); }
    let q; try { q = parse(pointSchema, raw); }
    catch { clockInvalid = true; stop(raw === null ? "clock_unavailable" : "clock_malformed"); if (terminal) return null; refuse("clock_invalid"); }
    if (q.clock_domain !== d.clock.worker_domain || BigInt(q.monotonic_ns) < last) {
      clockInvalid = true; stop(q.clock_domain !== d.clock.worker_domain ? "clock_domain" : "clock_rollback"); if (terminal) return null; refuse("clock_invalid");
    }
    last = BigInt(q.monotonic_ns);
    if (pending && last >= BigInt(pending.fact.deadline_ns)) {
      if (pending.fact.started) pending.fact.decision = "uncertain";
      stop("status_deadline", { clock_domain: d.clock.worker_domain, monotonic_ns: pending.fact.deadline_ns });
    }
    if (last >= end) { stop("preparation_deadline", { clock_domain: d.clock.worker_domain, monotonic_ns: String(end) }); if (!terminal) refuse("deadline"); }
    return q;
  }
  function forward(at) { if (stopped) refuse("stopped"); const q = point(at); if (stopped) refuse("stopped"); return q; }
  function take(ref, kind) { const op = actions.get(ref); if (!op || op.kind !== kind) refuse("action_reference"); return op; }
  // A status stream close/error is stream-level: before any status write there is no action to name, yet it still gates FAILED.
  function statusAction(ref) { return ref === null ? null : take(ref, "status"); }
  function wireCharge(n) { if (wireHash + BigInt(n) > BigInt(d.work.wire_hash_bytes_per_start)) refuse("wire_work_bound"); wireHash += BigInt(n); }
  function promote(op) {
    if (!op.fact.callback_seen || !op.fact.return_seen) return;
    if (op.fact.observed_outcome === "completed" && op.fact.write_return !== null) settle(op);
    if (pending === op) pending = null;
    if (op.fact.decision === "uncertain" || stopped && op.fact.kind !== "FAILED") return;
    op.fact.decision = "completed";
    if (op.fact.kind === "READY") state = prepareSeen ? "PREPARE_ACCEPTED" : "READY_COMPLETE";
    if (op.fact.kind === "BASELINED") state = "PREPARED";
  }
  function matching(ref, expected) { if (ref !== expected || expected === null) refuse("original_reference"); }
  function liveReferences(references) {
    const l = lifetime.describe();
    if (references.some(v => v !== "referenced") || l.stopped !== null || l.close_attempted || !l.listeners.every(Boolean) || !l.reference_confirmed.every(Boolean)) {
      lifetime.stop({ reason: "pair_reference_lost" }); refuse("lifetime_reference");
    }
  }
  function record(raw) {
    const refs = Object.fromEntries(["session", "action", "pair"].map(k => [k, raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, k)?.value : null]));
    let actionRef = null, pairRef = null;
    try {
      const q = parse(factSchema, raw);
      encodeUnsignedTransportFrame(q);
      if (q.type !== "launch") matching(refs.session, session);
      switch (q.type) {
        case "launch":
          if (session !== null) refuse("launch_once");
          forward(q.at); if (q.binding_sha256 !== d.launch_binding_sha256) refuse("launch_binding");
          session = token(); state = "LAUNCH_ACCEPTED"; break;
        case "startup_begin": {
          forward(q.at); if (startup !== null || state !== "LAUNCH_ACCEPTED") refuse("startup_once");
          startup = token(); actionRef = startup; actions.set(startup, { kind: "startup" }); state = "STARTUP_PENDING";
          startupHash = BigInt(mode.record_bytes) + BigInt(mode.module_bytes) + BigInt(mode.pin_bytes) + BigInt(mode.metadata_hash_bytes);
          helperCommands = mode.helper_commands;
          if (!plan.supplied_plan_complete) { startupResult = "refused"; refuse("qualification_unavailable"); } break;
        }
        case "startup_result": {
          take(refs.action, "startup"); if (startupResult !== null) refuse("startup_result_once");
          point(q.at, true); startupResult = q.outcome;
          if (q.outcome !== "returned") { stop("startup_" + q.outcome); break; }
          if (q.addon === null || q.pins === null || q.components === null || names.some(n => q.components[n] !== "matched_supplied")
            || q.pins.closed_set_sha256 !== d.closed_set_sha256 || q.pins.module_set_sha256 !== d.module_set_sha256
            || q.pins.build_record_sha256 !== d.allocation.artifacts.build_record_sha256) refuse("startup_binding");
          break;
        }
        case "pair_allocate": forward(q.at); if (pair !== null) refuse("pair_once"); pair = lifetime.allocate({ ports: q.ports }); pairRef = pair; break;
        case "pair_listeners": matching(refs.pair, pair); if (q.event === "installed") forward(q.at); else point(q.at, true);
          lifetime.noteListeners(pair, { index: q.index, event: q.event }); break;
        case "pair_reference": forward(q.at); matching(refs.pair, pair); lifetime.referencePort(pair, { index: q.index, outcome: q.outcome, has_ref: q.has_ref }); break;
        case "pair_close":
          matching(refs.pair, pair); if (!stopped || startup !== null && !["returned", "refused"].includes(startupResult)) refuse("anchor_retained");
          lifetime.closePort(pair, { index: q.index, outcome: q.outcome }); break;
        case "pair_closed": matching(refs.pair, pair); lifetime.observeClose(pair, { index: q.index }); break;
        case "status_plan": {
          if (q.kind === "FAILED") { if (!stopped) refuse("failure_without_stop"); point(q.at); } else forward(q.at);
          if (statusError !== null) refuse("status_pipe_failed");
          if (statusClosed) refuse("status_closed");
          if (pending !== null || statuses.some(v => v.fact.kind === q.kind) || statuses.some(v => v.fact.decision === "uncertain")) refuse("status_once_or_unknown");
          if (q.kind === "READY" && (startupResult !== "returned" || prepareSeen || boot.attempted)) refuse("ready_order");
          if (q.kind === "BASELINED" && (baseline === null || !boot.attempted || boot.outcome !== "returned" || !prepareSeen)) refuse("baseline_order");
          const left = (end - last) / 1000000n; if (left < 1n) refuse("reservation_remainder");
          const deadline = last + (left < BigInt(LIMITS.helper_ms) ? left : BigInt(LIMITS.helper_ms)) * 1000000n;
          const payload = q.kind === "READY" ? { addon_protocol: 6, mode: "synthetic_only", pins_sha256: d.launch_binding_sha256, worker_clock_domain: d.clock.worker_domain }
            : q.kind === "BASELINED" ? baseline : { phase: prepareSeen ? "prepare" : "launch", primary_code: stopped, close_errors: [...secondary],
              diagnostic_sha256: null, resources: baseline?.resources ?? null, query_created: false, instrumentation_overflow: false };
          wireCharge(frames[q.kind]);
          const work = lifetime.beginWork(pair, { kind: "status_write", ordinal: statuses.length + 1, references: q.references }); actionRef = token();
          const op = { kind: "status", fact: wireStatus(q.kind, statuses.length + 1, payload, deadline, frames[q.kind]), work, settled: false };
          actions.set(actionRef, op); statuses.push(op); pending = op;
          if (q.kind !== "FAILED") state = q.kind === "READY" ? "READY_PENDING" : "BASELINED_PENDING";
          break;
        }
        case "status_start": {
          const op = take(refs.action, "status"); if (stopped && op.fact.kind !== "FAILED") refuse("stopped");
          point(q.at); if (pending !== op || op.fact.started || op.fact.decision !== "planned") refuse("status_start_once");
          if (statusError !== null) refuse("status_pipe_failed");
          if (statusClosed) refuse("status_closed"); liveReferences(q.references);
          if (last >= BigInt(op.fact.deadline_ns) || BigInt(op.fact.deadline_ns) - last < 1000000n) refuse("status_deadline");
          op.fact.started = true; op.fact.decision = "started"; break;
        }
        case "status_return": {
          const op = take(refs.action, "status"); if (!op.fact.started || op.fact.return_seen) refuse("status_return_once");
          const at = point(q.at, true); op.fact.return_seen = true; op.fact.write_return = q.value;
          if (at === null) op.fact.decision = "uncertain";
          if (q.value === null) { op.fact.decision = "uncertain"; stop("status_return_unknown"); }
          promote(op); break;
        }
        case "status_callback": {
          const op = take(refs.action, "status"); if (!op.fact.started || op.fact.callback_seen) refuse("status_callback_once");
          const at = point(q.at, true); op.fact.callback_seen = true; op.fact.observed_outcome = q.outcome; op.fact.callback_at = at;
          if (q.outcome !== "completed" || at === null || BigInt(at.monotonic_ns) >= BigInt(op.fact.deadline_ns)) {
            op.fact.decision = "uncertain"; stop(at === null ? "clock_unavailable" : q.outcome === "completed" ? "status_deadline" : "status_callback_unknown", at);
          }
          promote(op); break;
        }
        case "status_close": {
          const op = statusAction(refs.action); if (statusClosed) refuse("status_close_once");
          if (op) op.fact.close_seen = true; statusClosed = true; stop("status_closed"); break;
        }
        case "status_error": {
          // Only a started write still awaiting its callback or return becomes uncertain; a write with both known keeps its decision and
          // stop() withholds an unstarted one. The named action is an identity check only.
          statusAction(refs.action); statusError ??= q.reason; if (pending?.fact.started) pending.fact.decision = "uncertain";
          stop(q.reason, point(q.at, true)); break;
        }
        case "prepare": {
          forward(q.at); const ready = statuses.find(v => v.fact.kind === "READY");
          if (!ready?.fact.started || prepareSeen) refuse("prepare_order"); prepareSeen = true;
          if (q.binding_sha256 !== d.launch_binding_sha256 || q.launch_nonce !== d.allocation.launch_nonce) refuse("prepare_binding");
          wireCharge(2 * byteLength(canonical(q.configuration)) + recipeBytes);
          const fixture = { ...d.allocation.fixture, fixture_name: q.setup.fixture_name }, recipe = describeUnsignedFixture(fixture);
          if (q.setup.recipe_sha256 !== recipe.recipe_sha256) refuse("recipe_binding");
          const checked = validateUnsignedWorkerConfiguration({ fixture, configuration: q.configuration,
            registration_sha256: q.setup.registration_sha256, envelope_sha256: q.setup.envelope_sha256 }).configuration;
          setup = freeze(q.setup); boot.registration_sha256 = q.setup.registration_sha256;
          const supplied = JSON.parse(canonical(checked.binding.registration));
          if (recipe.binding_delta === "data_inode_only") {
            const b = supplied.bindings, used = new Set([b.fixture_parent, b.witness, ...Object.values(b.markers), ...b.ancestors.map(a => a.proof)].map(v => v.inode));
            let inode = BigInt(b.data.inode) + 1n; while (used.has(String(inode))) inode++;
            if (String(inode).length > 30) refuse("inode_delta_bound"); b.data.inode = String(inode);
          }
          boot.supplied_registration_sha256 = digest(supplied); boot.supplied_data_inode = supplied.bindings.data.inode;
          if (ready.fact.decision === "completed") state = "PREPARE_ACCEPTED"; break;
        }
        case "bootstrap_begin": {
          forward(q.at); if (boot.attempted || state !== "PREPARE_ACCEPTED" || pending !== null) refuse("bootstrap_order");
          boot.attempted = true;
          const work = lifetime.beginWork(pair, { kind: "bootstrap", ordinal: 1, references: q.references });
          bootstrap = token(); actionRef = bootstrap; actions.set(bootstrap, { kind: "bootstrap", work, settled: false }); state = "BOOTSTRAP_PENDING"; break;
        }
        case "bootstrap_result": {
          const op = take(refs.action, "bootstrap"); if (boot.outcome !== null) refuse("bootstrap_result_once");
          point(q.at, true); boot.outcome = q.outcome;
          if (q.outcome === "refused") { settle(op); stop("bootstrap_refused"); }
          else if (q.outcome === "unknown") stop("bootstrap_unknown"); break;
        }
        case "baseline": {
          forward(q.at); take(refs.action, "bootstrap");
          if (boot.outcome !== "returned" || boot.baseline_seen || q.clock_domain !== d.clock.worker_domain) refuse("baseline_binding");
          baseline = parse(baselineSchema, { resources: { fds: q.native_info.live_fds, roots: q.native_info.live_sessions,
            workspace: q.bootstrap_info.active_workspace_bytes, retained: q.bootstrap_info.retained_state_bytes }, clock_domain: q.clock_domain });
          boot.baseline_seen = true; break;
        }
        case "bootstrap_close_begin":
          take(refs.action, "bootstrap"); if (!stopped || boot.outcome !== "returned" || boot.close_attempted) refuse("bootstrap_close_once");
          boot.close_attempted = true; break;
        case "bootstrap_close_result": {
          const op = take(refs.action, "bootstrap"); if (!boot.close_attempted || boot.close_outcome !== null) refuse("bootstrap_close_result_once");
          boot.close_outcome = q.outcome; if (q.outcome === "confirmed") settle(op); else stop("bootstrap_close_" + q.outcome); break;
        }
        case "stop": stop(q.reason, point(q.at, true)); break;
        case "command": refuse("command_outside_preparation"); break;
      }
      const lifeStop = lifetime.describe().stopped; if (lifeStop !== null && stopped === null) stop(lifeStop);
      return Object.freeze({ session_ref: session, action_ref: actionRef, pair_ref: pairRef, view: view() });
    } catch (error) {
      const reason = /^cc4c1_([a-z_]+)$/.exec(error?.message)?.[1] ?? "invalid_fact"; stop(reason); throw error;
    }
  }
  return Object.freeze({ record, describe: view });
}
