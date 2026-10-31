import { z } from "zod";
import { describeUnsignedFixture } from "./jointUnsignedAcceptanceContracts.mjs";
import { validateUnsignedWorkerConfiguration } from "./unsignedWorkerConfiguration.mjs";
import { validateUnsignedControllerObservation } from "./unsignedControllerObservation.mjs";
import { uint, label, code, digestSchema as hash, count, parse, copyData, canonical, sha, digest, byteLength, decode,
  resourcesSchema, baselineSchema, traceSchema, freeze, flags, refuse, LIMITS } from "./unsignedControllerData.mjs";

const artifactSchema = z.object(Object.fromEntries(["js_set_sha256", "addon_sha256", "observer_sha256", "controller_sha256", "worker_sha256",
  "runtime_closure_sha256", "node_binary_sha256", "build_record_sha256", "reader_source_sha256", "reader_js_sha256"].map((k) => [k, hash]))).strict();
const allocationSchema = z.object({ fixture: z.object({ request: z.unknown(), case_id: label, mode: z.enum(["normal", "ubsan"]), ids: z.unknown() }).strict(),
  exchange_id: label, launch_nonce: label, source_tree_sha256: hash, signature_profile: z.literal("linker_adhoc"), artifacts: artifactSchema }).strict();
function allocation(input) {
  const d = parse(allocationSchema, input), recipe = describeUnsignedFixture({ ...d.fixture, fixture_name: "native-bar-fs-synthetic-Plan00" });
  const { fixture_name, ...logical } = recipe.declaration;
  return { input: d, binding: freeze({ protocol: "native-bar-unsigned-execution-v2", stage: "C-C1b-4", run_id: recipe.declaration.request.run_id,
    case_id: d.fixture.case_id, mode: d.fixture.mode, source_commit: recipe.declaration.request.source_commit,
    patch_sha256: recipe.declaration.request.patch_sha256, source_tree_sha256: d.source_tree_sha256,
    plan_sha256: recipe.plan_sha256, template_sha256: digest({ declaration: logical, entries: recipe.entries }),
    exchange_id: d.exchange_id, launch_nonce: d.launch_nonce, signature_profile: d.signature_profile, ...d.artifacts, setup: null }) };
}
const setupSchema = z.object({ fixture_name: z.string().regex(/^native-bar-fs-synthetic-[A-Za-z0-9]{6}$/), recipe_sha256: hash,
  registration_sha256: hash, envelope_sha256: hash }).strict();
const failureSchema = z.object({ phase: z.enum(["launch", "prepare", "go", "settlement", "finalize"]), primary_code: code, close_errors: z.array(code).max(8),
  diagnostic_sha256: hash.nullable(), resources: resourcesSchema.nullable(), query_created: z.boolean(), instrumentation_overflow: z.boolean() }).strict();
const releaseSchema = z.object({ baseline_sha256: hash, resources: resourcesSchema, query: z.literal("settled"), native: z.literal("settled"),
  original_operation_retired: z.literal(true), query_released: z.literal(true), close_errors: z.array(code).max(8),
  diagnostic_sha256: hash, observation_sha256: hash.nullable(), trace_chunks: count(8), trace_events: count(128), trace_sha256: hash,
  primary_code: code, requests_dispatched: count(2), authenticated_requests: count(2),
  c0_dispatched_at: z.null(), c0_authenticated_at: z.null(), retired_at: z.null() }).strict();
const exitSchema = z.object({ exit_code: count(255).nullable(), signal: z.string().regex(/^SIG[A-Z0-9]{1,12}$/).nullable() }).strict();
const frameSchema = z.object({ binding: z.unknown(), direction: z.enum(["parent", "worker"]), ordinal: count(32, 1),
  kind: z.enum(["LAUNCH", "READY", "PREPARE", "BASELINED", "GO", "TRACE_CHUNK", "OBSERVED", "RELEASED", "FAILED", "CANCEL", "FINALIZE"]), payload: z.unknown() }).strict();
const empty = z.object({}).strict();
const readySchema = z.object({ addon_protocol: z.literal(6), mode: z.literal("synthetic_only"), pins_sha256: hash, worker_clock_domain: label }).strict();
const chunkSchema = z.object({ chunk_index: count(7), events: z.array(traceSchema).min(1).max(16) }).strict();
const singletonBits = { READY: 1, BASELINED: 2, OBSERVED: 4, RELEASED: 8, FAILED: 16 };
const errorCode = e => /^cc4a_[a-z_]+$/.test(e?.message) ? e.message.slice(5) : "invalid_input";
function readFrame(raw) {
  if (typeof raw !== "string") refuse("encoding");
  if (raw.length > LIMITS.frame_bytes) refuse("byte_bound");
  if (!raw.isWellFormed()) refuse("encoding");
  return parse(frameSchema, decode(raw, LIMITS.frame_bytes));
}
function workerPayload(kind, payload) {
  if (kind === "OBSERVED") return validateUnsignedControllerObservation(payload);
  const schema = { READY: readySchema, BASELINED: baselineSchema, TRACE_CHUNK: chunkSchema, RELEASED: releaseSchema, FAILED: failureSchema }[kind];
  if (!schema) refuse("protocol_direction"); return parse(schema, payload);
}

export function createUnsignedControllerProtocolModel(input) {
  const captured = allocation(input); let binding = captured.binding, state = "NEW", stopped = null, frames = 0;
  let baseline = null, baselineHash = null, observed = null, released = null, failure = null, exit = null, c1 = false, workerDomain = null;
  let submitted = false, cancelSpent = false, shutdownPlanned = false, close = null, teardown = false, lastTrace = null;
  const next = { parent: 1, worker: 1 }, writes = [], lines = new Map(), trace = [], late = []; let chunks = 0;
  let acceptedSeen = 0, lateCapture = null;
  const stop = (reason) => {
    stopped ??= reason;
    if (lateCapture === null) lateCapture = { diagnostic_only: true, semantic_verified: false, receive_at: null,
      capture: failure !== null || state === "DONE" ? "ended" : "open", reason: failure !== null || state === "DONE" ? "normal_terminal" : null,
      seen: acceptedSeen, worker_domain: workerDomain, trace_chunks: chunks, trace_events: trace.length,
      last_trace_ns: lastTrace === null ? null : String(lastTrace) };
    state = "STOPPED";
  };
  // A normal rejection or exhausted capacity only freezes intake, judging no traffic; invalid late traffic or a receive fault also closes writes.
  const freezeCapture = (reason, unjudged = false) => {
    if (lateCapture.capture === "refused" || lateCapture.capture === "frozen") return;
    lateCapture.capture = unjudged ? "frozen" : "refused"; lateCapture.reason = reason;
  };
  const fail = (reason) => { stop(reason); refuse(reason); };
  const at = (...allowed) => { if (!allowed.includes(state)) fail("protocol_order"); };
  const started = (kind) => writes.some((w) => w.kind === kind && w.started);
  const cancelPending = () => writes.some((w) => w.kind === "CANCEL" && w.outcome !== "completed");
  const describe = () => freeze({ schema: "native-bar-unsigned-controller-model-v2", ...flags(), binding, state, stop_reason: stopped,
    retain: stopped !== null || !["RELEASED", "FINALIZING", "DONE"].includes(state) || cancelPending(), frames, next_ordinals: { ...next },
    worker_clock_domain: workerDomain, baseline, baseline_sha256: baselineHash, observation: observed, observation_sha256: observed ? digest(observed) : null,
    release: released, failure, worker_exit: exit, c1_violation: c1, go_submitted: submitted, cancel_spent: cancelSpent, command_close: close,
    teardown_complete: teardown, trace_chunks: chunks, trace_events: trace.length, trace_sha256: digest(trace),
    writes: writes.map((v) => ({ ...v })), late_frames: [...late], late_capture: lateCapture === null ? null : { ...lateCapture },
    model_status: state === "DONE" ? "consistent_supplied_lifecycle" : "incomplete_supplied_lifecycle" });
  const lateView = () => freeze({ schema: "native-bar-late-frame-diagnostic-v1", ...flags(), binding, stopped: stopped !== null, stop_reason: stopped,
    frames, next_worker_ordinal: next.worker, late_capture: lateCapture === null ? null : { ...lateCapture }, late_frames: [...late] });
  function guard(action, allowStopped = false) {
    if (stopped && !allowStopped) refuse("stopped");
    try { return action(); } catch (e) { if (!stopped) stop(errorCode(e)); throw e; }
  }
  function accept(raw) {
    const f = readFrame(raw);
    if (frames >= LIMITS.frames) fail("frame_capacity");
    if (f.ordinal !== next[f.direction]) fail("protocol_ordinal");
    const parent = ["LAUNCH", "PREPARE", "GO", "CANCEL", "FINALIZE"].includes(f.kind);
    if (f.direction !== (parent ? "parent" : "worker")) fail("protocol_direction");
    let newBinding = binding;
    if (f.kind === "PREPARE") {
      const b = copyData(f.binding), setup = parse(setupSchema, b.setup); b.setup = null;
      if (canonical(b) !== canonical(binding)) fail("binding_changed");
      newBinding = freeze({ ...binding, setup });
    } else if (canonical(f.binding) !== canonical(binding)) fail("binding_changed");
    const p = f.payload;
    switch (f.kind) {
      case "LAUNCH": at("NEW"); parse(empty, p); state = "LAUNCHED"; break;
      case "READY": {
        at("LAUNCHED"); if (!started("LAUNCH")) fail("write_not_submitted");
        const r = workerPayload(f.kind, p);
        if (r.pins_sha256 !== digest(binding)) fail("ready_pins"); workerDomain = r.worker_clock_domain; state = "READY"; break;
      }
      case "PREPARE": {
        at("READY"); const r = parse(z.object({ configuration: z.unknown(), launch_nonce: label }).strict(), p), s = newBinding.setup;
        if (byteLength(canonical(r.configuration)) > LIMITS.configuration_bytes) fail("configuration_capacity");
        const fixture = { ...captured.input.fixture, fixture_name: s.fixture_name }, recipe = describeUnsignedFixture(fixture);
        if (r.launch_nonce !== binding.launch_nonce || s.recipe_sha256 !== recipe.recipe_sha256) fail("setup_binding");
        try { validateUnsignedWorkerConfiguration({ fixture, configuration: r.configuration, registration_sha256: s.registration_sha256, envelope_sha256: s.envelope_sha256 }); }
        catch { fail("worker_configuration"); }
        binding = newBinding; state = "PREPARING"; break;
      }
      case "BASELINED": at("PREPARING"); if (!started("PREPARE")) fail("write_not_submitted");
        baseline = freeze(workerPayload(f.kind, p)); if (baseline.clock_domain !== workerDomain) fail("baseline_clock_domain");
        baselineHash = digest(baseline); state = "BASELINED"; break;
      case "GO": {
        at("BASELINED"); const r = parse(z.object({ baseline_sha256: hash, baseline_readback: z.literal(true), go_intent_readback: z.literal(true) }).strict(), p);
        if (r.baseline_sha256 !== baselineHash) fail("baseline_changed"); state = "ACTIVE"; break;
      }
      case "CANCEL": at("ACTIVE"); parse(empty, p); if (!submitted || cancelSpent) fail("cancel_order"); cancelSpent = true; break;
      case "TRACE_CHUNK": {
        at("ACTIVE"); if (!submitted) fail("write_not_submitted");
        const r = workerPayload(f.kind, p);
        if (r.chunk_index !== chunks || chunks >= 8 || trace.length + r.events.length > 128) fail("trace_order");
        let last = lastTrace;
        for (const [i, e] of r.events.entries()) {
          if (e.ordinal !== trace.length + i + 1 || e.clock_domain !== baseline.clock_domain || byteLength(canonical(e)) > 1024
            || last !== null && BigInt(e.monotonic_ns) < last) fail("trace_order"); last = BigInt(e.monotonic_ns);
        }
        lastTrace = last; trace.push(...r.events.map(freeze)); chunks++; break;
      }
      case "OBSERVED": at("ACTIVE"); if (!submitted || observed !== null) fail("observation_order"); observed = workerPayload(f.kind, p); break;
      case "RELEASED": {
        at("ACTIVE"); if (!submitted) fail("write_not_submitted"); const r = workerPayload(f.kind, p);
        if (r.baseline_sha256 !== baselineHash) fail("baseline_changed");
        if (r.trace_chunks !== chunks || r.trace_events !== trace.length || r.trace_sha256 !== digest(trace)
          || r.observation_sha256 !== (observed ? digest(observed) : null) || r.authenticated_requests > r.requests_dispatched) fail("result_binding");
        if (r.close_errors.length || ["fds", "roots", "workspace"].some((k) => r.resources[k] !== baseline.resources[k])
          || BigInt(r.resources.retained) < BigInt(baseline.resources.retained)) fail("release_unconfirmed");
        // Request/projection mismatch is a case verdict, not a reason to withhold a genuine original release.
        // A dispatched C1 still latches a violation that stops the cohort after this case's teardown.
        if (r.requests_dispatched > 1) c1 = true;
        released = freeze(r); state = "RELEASED"; break;
      }
      case "FAILED": {
        at("LAUNCHED", "READY", "PREPARING", "BASELINED", "ACTIVE", "RELEASED", "FINALIZING");
        if (!started("LAUNCH")) fail("write_not_submitted"); const r = workerPayload(f.kind, p);
        // The worker can report only the lifecycle it has been sent; a query exists only after a started GO write.
        const phases = ["LAUNCHED", "READY"].includes(state) ? ["launch"] : ["PREPARING", "BASELINED"].includes(state) || !submitted ? ["prepare"]
          : state === "ACTIVE" ? ["go", "settlement"] : ["finalize"];
        if (!phases.includes(r.phase) || r.query_created && !submitted || r.phase === "finalize" && !r.query_created) fail("failure_binding");
        failure = freeze(r); break;
      }
      case "FINALIZE": at("RELEASED"); parse(empty, p); if (cancelPending()) fail("cancel_unsettled");
        if (!teardown) fail("teardown_unconfirmed"); state = "FINALIZING"; break;
    }
    frames++; next[f.direction]++;
    if (parent) { writes.push({ kind: f.kind, ordinal: f.ordinal, started: false, outcome: "planned" }); lines.set(f.ordinal, raw); }
    else acceptedSeen |= singletonBits[f.kind] ?? 0;
    if (f.kind === "FAILED") stop("worker_failed");
    return describe();
  }
  function appendLate(line) {
    if (!stopped) refuse("late_requires_stop");
    try {
      if (lateCapture.capture !== "open") refuse("late_closed");
      if (frames >= LIMITS.frames || late.length >= 4) { freezeCapture("late_capacity", true); refuse("late_capacity"); }
      const f = readFrame(line);
      if (f.direction !== "worker") refuse("protocol_direction");
      if (canonical(f.binding) !== canonical(binding)) refuse("binding_changed");
      if (f.ordinal !== next.worker) refuse("protocol_ordinal");
      const p = workerPayload(f.kind, f.payload), bit = singletonBits[f.kind] ?? 0;
      if (bit && (lateCapture.seen & bit)) refuse("late_duplicate");
      if ((lateCapture.seen & 8) && f.kind !== "FAILED") refuse("late_terminal");
      if (f.kind === "READY") {
        if (!started("LAUNCH")) refuse("write_not_submitted");
        if (p.pins_sha256 !== digest(binding)) refuse("ready_pins");
      } else if (f.kind === "BASELINED") {
        if (!started("PREPARE") || !(lateCapture.seen & 1)) refuse("write_not_submitted");
        if (p.clock_domain !== lateCapture.worker_domain) refuse("baseline_clock_domain");
      } else if (f.kind === "FAILED") {
        if (!started("LAUNCH")) refuse("write_not_submitted");
        // Same phase rule as the normal reducer, which keys on an accepted PREPARE rather than a started one.
        const phases = released !== null ? ["finalize"] : submitted ? ["go", "settlement"] : writes.some((w) => w.kind === "PREPARE") ? ["prepare"] : ["launch"];
        if (!phases.includes(p.phase) || p.query_created && !submitted || p.phase === "finalize" && !p.query_created) refuse("failure_binding");
      } else {
        if (!submitted || !(lateCapture.seen & 2)) refuse("write_not_submitted");
        if (f.kind === "TRACE_CHUNK") {
          if (p.chunk_index !== lateCapture.trace_chunks || lateCapture.trace_chunks >= 8
            || lateCapture.trace_events + p.events.length > 128) refuse("trace_order");
          let last = lateCapture.last_trace_ns;
          for (const [i, e] of p.events.entries()) {
            if (e.ordinal !== lateCapture.trace_events + i + 1 || e.clock_domain !== lateCapture.worker_domain || byteLength(canonical(e)) > 1024
              || last !== null && BigInt(e.monotonic_ns) < BigInt(last)) refuse("trace_order");
            last = e.monotonic_ns;
          }
        } else if (f.kind === "RELEASED") {
          if (p.baseline_sha256 !== baselineHash) refuse("baseline_changed");
          if (p.trace_chunks !== lateCapture.trace_chunks || p.trace_events !== lateCapture.trace_events
            || p.authenticated_requests > p.requests_dispatched) refuse("result_binding");
        }
      }
      // Only diagnostic wire metadata commits; normal release/trace/evidence fields never change.
      if (f.kind === "READY") lateCapture.worker_domain = p.worker_clock_domain;
      if (f.kind === "TRACE_CHUNK") {
        lateCapture.trace_chunks++; lateCapture.trace_events += p.events.length; lateCapture.last_trace_ns = p.events.at(-1).monotonic_ns;
      }
      lateCapture.seen |= bit; late.push({ sha256: sha(line), bytes: byteLength(line) }); frames++; next.worker++;
      if (f.kind === "RELEASED" || f.kind === "FAILED") { lateCapture.capture = "ended"; lateCapture.reason = "terminal"; }
      return describe();
    } catch (e) { freezeCapture(errorCode(e)); throw e; }
  }
  const model = {
    acceptFrame(line) { return guard(() => { try { return accept(line); }
      catch (e) { stop(errorCode(e)); freezeCapture("normal_rejected", true); throw e; } }); },
    noteWrite(input) {
      const d = parse(z.object({ ordinal: count(32, 1), outcome: z.enum(["started", "completed", "uncertain"]) }).strict(), input);
      const w = writes.find((v) => v.ordinal === d.ordinal); if (!w) fail("write_order");
      if (d.outcome === "started") {
        const expectedState = { LAUNCH: "LAUNCHED", PREPARE: "PREPARING", GO: "ACTIVE", CANCEL: "ACTIVE", FINALIZE: "FINALIZING" }[w.kind];
        // Parent-only admission: the sealed future worker must consume this original post-release CANCEL as a no-op.
        const releasedCancel = w.kind === "CANCEL" && !w.shutdown && state === "RELEASED" && released !== null
          && writes.every((v) => v === w || v.outcome === "completed");
        if (stopped || close !== null || exit !== null || state !== expectedState && !releasedCancel || w.outcome !== "planned" || writes.find((v) => !v.started) !== w) fail("write_order");
        w.started = true; w.outcome = "started";
        if (w.kind === "GO") submitted = true;
      } else { if (!w.started || w.outcome !== "started") fail("write_order"); w.outcome = d.outcome; if (d.outcome === "uncertain") stop("pipe_uncertain"); }
      return describe();
    },
    observeFailure(input) { const d = parse(z.object({ reason: code }).strict(), input); stop(d.reason); return describe(); },
    planShutdown(input) {
      const d = parse(z.object({ binding_known: z.boolean(), worker_live: z.boolean(), pipe_qualified: z.boolean(), settlement_remaining_ms: count(60000) }).strict(), input);
      if (!stopped) refuse("shutdown_requires_stop");
      if (close !== null) refuse("command_already_closed");
      let frame = null;
      // Only a possibly running original query is cancelled: RELEASED or FAILED has already ended it.
      const live = submitted && exit === null && released === null && failure === null && !shutdownPlanned && lateCapture.capture !== "refused"
        && d.binding_known && d.worker_live && d.pipe_qualified && d.settlement_remaining_ms > 0;
      const unstarted = writes.filter((w) => !w.started), known = writes.every((w) => !w.started || w.outcome !== "uncertain");
      if (live && known && !cancelSpent && !unstarted.length && frames < LIMITS.frames) {
        cancelSpent = shutdownPlanned = true; const ordinal = next.parent++;
        frame = canonical({ binding, direction: "parent", ordinal, kind: "CANCEL", payload: {} }) + "\n";
        if (byteLength(frame) > LIMITS.frame_bytes) fail("byte_bound");
        frames++; writes.push({ kind: "CANCEL", ordinal, started: false, outcome: "planned", shutdown: true }); lines.set(ordinal, frame);
      } else if (live && known && unstarted.length === 1 && unstarted[0].kind === "CANCEL") {
        // An accepted but unwritten ordinary CANCEL keeps its ordinal; the shutdown lane may start that same frame once.
        shutdownPlanned = true; unstarted[0].shutdown = true; frame = lines.get(unstarted[0].ordinal);
      }
      return freeze({ ...flags(), decision: frame ? "CANCEL_THEN_CLOSE" : "CLOSE_ONLY", frame, command_close_required: true });
    },
    noteShutdownWrite(input) {
      const d = parse(z.object({ outcome: z.enum(["started", "completed", "uncertain"]) }).strict(), input), w = writes.find((v) => v.shutdown);
      if (!stopped || !w) refuse("shutdown_write_order");
      if (d.outcome === "started" ? lateCapture.capture === "refused" || close !== null || exit !== null || w.outcome !== "planned" || writes.find((v) => !v.started) !== w : w.outcome !== "started") refuse("shutdown_write_order");
      w.outcome = d.outcome; if (d.outcome === "started") w.started = true; return describe();
    },
    noteCommandClose(input) { const d = parse(z.object({ outcome: z.enum(["confirmed", "unconfirmed"]) }).strict(), input);
      // A stop or the normal FINALIZE path ends the original command stream exactly once; an unconfirmed close is retained.
      if (close !== null || !stopped && !(["FINALIZING", "DONE"].includes(state) && started("FINALIZE"))) refuse("close_order");
      close = d.outcome; if (d.outcome !== "confirmed") stop("close_unconfirmed"); return describe(); },
    observeLateFrame: appendLate,
    closeLateCapture(input) {
      if (!stopped) refuse("late_requires_stop");
      const q = parse(z.object({ reason: code }).strict(), input);
      // A receive fault after a terminal frame changes nothing; the appender itself refuses traffic after it.
      if (lateCapture.capture !== "ended") freezeCapture(q.reason, q.reason === "normal_rejected"); return lateView();
    },
    describeLate: lateView,
    lateCapacity() {
      const h = "f".repeat(64), l = "l".repeat(48), u = "9".repeat(30), c = "c".repeat(96);
      const b = { ...binding, run_id: l, case_id: l, exchange_id: l, launch_nonce: l,
        setup: { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h } };
      const metadata = { diagnostic_only: true, semantic_verified: false, receive_at: null, capture: "refused", reason: c,
        seen: 31, worker_domain: l, trace_chunks: 8, trace_events: 128, last_trace_ns: u };
      const rows = Array(4).fill({ sha256: h, bytes: 65536 });
      const retained = byteLength(canonical({ late_capture: metadata, late_frames: rows }));
      const view = byteLength(canonical({ schema: "native-bar-late-frame-diagnostic-v1", ...flags(), binding: b, stopped: false, stop_reason: c,
        frames: 32, next_worker_ordinal: 33, late_capture: metadata, late_frames: rows }));
      return freeze({ retained_json_bytes: retained, diagnostic_ceiling_bytes: view, row_limit: 4, shared_frame_limit: LIMITS.frames });
    },
    finishTeardown(input) { return guard(() => { at("RELEASED");
      parse(z.object({ receipt_readback: z.literal(true), anchor_same: z.literal(true), root_removed: z.literal(true), absent: z.literal(true), worker_live: z.literal(true) }).strict(), input);
      if (cancelPending()) fail("cancel_unsettled");
      if (teardown) fail("teardown_order"); teardown = true; return describe(); }); },
    workerExit(input) { const d = parse(exitSchema, input); if (exit) fail("exit_order"); exit = freeze(d);
      if (stopped || state !== "FINALIZING" || !started("FINALIZE") || d.exit_code !== 0 || d.signal !== null) stop("worker_lost"); else state = "DONE"; return describe(); },
    describe,
  };
  return Object.freeze(Object.fromEntries(Object.entries(model).map(([name, method]) => [name,
    ["describe", "describeLate", "lateCapacity", "observeLateFrame", "closeLateCapture"].includes(name) ? method : (...args) => guard(() => method(...args), true)])));
}

export function describeUnsignedControllerCapacity(input) {
  const d = parse(z.object({ owned_entries: count(16, 1), depth: count(3), content_bytes: count(131072) }).strict(), input);
  const records = 4 * d.owned_entries + 16; if (records > LIMITS.receipt_records) refuse("receipt_capacity");
  // The unchanged observer schedule: two ACL observations per owned node plus its three anchors, and two content passes.
  const nodes = d.owned_entries + 3, acl = nodes * 2 * 65536, content = d.content_bytes * 2;
  const remaining = LIMITS.observer_work_bytes - acl - content - LIMITS.observer_response_bytes; if (remaining < 0) refuse("observer_capacity");
  return freeze({ schema: "native-bar-unsigned-controller-capacity-v2", ...flags(), ...d, limits: LIMITS,
    receipt_reserved_records: records, maximum_functional_frames: 17, run_index_reserved_bytes: 4096 + 24 * 5290,
    maximum_case_ms: 900000, observer_invocations: d.owned_entries + 6,
    observer_nodes: nodes, observer_acl_bytes: acl, observer_content_bytes: content, observer_remaining_metadata_bytes: remaining,
    teardown_observer_ms: (d.owned_entries + 2) * 10000, teardown_worst_case_fits: (d.owned_entries + 2) * 10000 <= LIMITS.teardown_ms,
    fixed_owner_reservation_bytes: 65536, u0_owner_reservation_bytes: 0,
    observer_work_separate_from_native: true, native_budget_changed: false });
}

export function createUnsignedControllerWindowModel(input) {
  const d = parse(z.object({ clock_domain: label, started_ns: uint, cohort_limit_ms: uint }).strict(), input);
  if (BigInt(d.cohort_limit_ms) < 1n) refuse("window_bound");
  let phase = "IDLE", last = BigInt(d.started_ns), deadline = null, stopped = null, clockInvalid = false, firstStop = null;
  const end = last + BigInt(d.cohort_limit_ms) * 1000000n, starts = Object.create(null);
  const caseNs = BigInt(LIMITS.preparation_ms + LIMITS.query_ms + LIMITS.settlement_ms + LIMITS.teardown_ms) * 1000000n;
  const limitAt = () => deadline !== null && deadline < end ? deadline : end;
  const fail = (reason, at = last) => {
    if (reason === "clock_domain" || reason === "clock_rollback") clockInvalid = true;
    // Once a known deadline has passed, any later refusal is that deadline at its own time, not at the observation time.
    else if (at >= limitAt()) { reason = "deadline"; at = limitAt(); }
    if (!stopped) { stopped = reason; if (!clockInvalid) firstStop = at; }
    refuse(reason);
  };
  function point(raw) {
    let p;
    try { p = parse(z.object({ clock_domain: label, monotonic_ns: uint }).strict(), raw); }
    catch (error) { clockInvalid = true; stopped ??= "clock_invalid"; throw error; }
    if (p.clock_domain !== d.clock_domain) fail("clock_domain"); const n = BigInt(p.monotonic_ns);
    if (n < last) fail("clock_rollback"); last = n; return n;
  }
  const describe = () => freeze({ ...flags(), schema: "native-bar-unsigned-controller-window-v2", phase, stopped, clock_invalid: clockInvalid,
    phase_deadline_ns: deadline === null ? null : String(deadline), cohort_deadline_ns: String(end), first_stop_ns: firstStop === null ? null : String(firstStop), starts: { ...starts }, renewal_available: false });
  function inspect(at, operation) {
    const n = point(at);
    if (!["phase", "observer", "command", "helper"].includes(operation) || deadline === null) fail("window_order");
    const limit = limitAt(), remaining = limit - n, ms = remaining / 1000000n;
    if (remaining < 1000000n) fail("deadline", n);
    return freeze({ ...describe(), remaining_ms: String(ms), operation_window_ms: String(operation === "phase" || ms < 10000n ? ms : 10000n) });
  }
  function start(next, at, allowed, limit) {
    if (stopped) refuse("stopped"); const n = point(at);
    // Teardown removes only what a started query's original release covered; there is none before GO.
    if (!allowed.includes(phase) || starts[next] !== undefined || next === "teardown" && starts.query === undefined) fail("window_order");
    if (n >= limitAt()) fail("deadline");
    // A case starts only when its whole worst case fits, so the cohort end never cuts a later phase.
    if (next === "preparation" && end - n < caseNs) fail("cohort_window");
    phase = next; starts[next] = String(n); deadline = n + BigInt(limit) * 1000000n; return describe();
  }
  return Object.freeze({
    startPreparation(at) { return start("preparation", at, ["IDLE"], LIMITS.preparation_ms); },
    submitGo(at) { return start("query", at, ["preparation"], LIMITS.query_ms); },
    startSettlement(at) {
      if (clockInvalid || stopped && stopped !== "deadline") refuse("stopped");
      if (starts.settlement !== undefined) fail("window_order");
      // A timeout may trigger the original settlement grace; it is not another read window.
      const n = point(at); if (!["preparation", "query"].includes(phase)) fail("window_order");
      if (n >= end) fail("deadline");
      if (n >= deadline && !stopped) { stopped = "deadline"; firstStop = deadline; }
      const trigger = firstStop ?? n;
      phase = "settlement"; starts.settlement = String(trigger); deadline = trigger + BigInt(LIMITS.settlement_ms) * 1000000n;
      if (n >= deadline) fail("deadline"); return describe();
    },
    startTeardown(at) { return start("teardown", at, ["settlement"], LIMITS.teardown_ms); },
    startReporting(at) {
      if (stopped) refuse("stopped"); const n = point(at); if (phase !== "teardown") fail("window_order");
      if (n >= limitAt()) fail("deadline");
      phase = "reporting"; deadline = end; return describe();
    },
    inspect(at, operation = "phase") {
      if (stopped) refuse("stopped"); return inspect(at, operation);
    },
    inspectShutdown(at) {
      if (clockInvalid || phase !== "settlement" || stopped && stopped !== "deadline") refuse("shutdown_window");
      return inspect(at, "command");
    },
    canStartCase(at) { if (stopped) refuse("stopped"); const n = point(at); return freeze({ ...flags(), fits_supplied_cohort_window: end - n >= caseNs }); },
    describe,
  });
}
