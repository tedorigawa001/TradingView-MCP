import { z } from "zod";
import { createUnsignedControllerProtocolModel, createUnsignedControllerWindowModel } from "./unsignedControllerContracts.mjs";
import { describeUnsignedControllerSerializationCapacity } from "./unsignedControllerEvidence.mjs";
import { uint, label, code, parse, canonical, sha, byteLength, decode, freeze, flags, LIMITS } from "./unsignedControllerData.mjs";

const refuse = reason => { throw Error(`cc4b4a_${reason}`); };
const pointSchema = z.object({ clock_domain: label, monotonic_ns: uint }).strict();
const clockSchema = z.object({ clock_domain: label, started_ns: uint, cohort_limit_ms: uint }).strict();
const commands = ["LAUNCH", "PREPARE", "GO", "CANCEL", "FINALIZE"];
const workKinds = ["bootstrap", "owner", "reader", "query", "release", "status_write"];
const maximum = 999999999999999999999999999999n;
const base = () => ({ ...flags(), scope: "unsigned_worker_transport_memory_only", runtime_completion_proven: false });

function boundedFrame(value) {
  let bytes = 1; // Include LF before any stringification or aggregate concatenation.
  const charge = n => { if (bytes + n > LIMITS.frame_bytes) refuse("frame_bound"); bytes += n; };
  function string(s) {
    charge(2);
    for (let i = 0; i < s.length; i++) {
      const n = s.charCodeAt(i);
      if (n === 34 || n === 92 || [8, 9, 10, 12, 13].includes(n)) charge(2);
      else if (n < 32) charge(6);
      else if (n >= 0xd800 && n <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { charge(4); i++; }
      else if (n >= 0xd800 && n <= 0xdfff) charge(6);
      else charge(n < 128 ? 1 : n < 2048 ? 2 : 3);
    }
  }
  function visit(v) {
    if (v === null) charge(4);
    else if (typeof v === "string") string(v);
    else if (typeof v === "boolean") charge(v ? 4 : 5);
    else if (typeof v === "number" && Number.isSafeInteger(v)) charge(String(v).length);
    else if (Array.isArray(v)) { charge(2 + Math.max(0, v.length - 1)); for (const item of v) visit(item); }
    else if (v && typeof v === "object") {
      const keys = Object.keys(v); charge(2 + Math.max(0, keys.length - 1));
      for (const key of keys) { string(key); charge(1); visit(v[key]); }
    } else refuse("frame_shape");
  }
  visit(value);
  const line = canonical(value) + "\n";
  if (byteLength(line) !== bytes) refuse("frame_measurement"); return line;
}

export function describeUnsignedWorkerTransportCapacity(allocation) {
  const p = createUnsignedControllerProtocolModel(allocation), serialization = describeUnsignedControllerSerializationCapacity(allocation);
  const h = "f".repeat(64), l = "l".repeat(48), u = "9".repeat(30), c = "c".repeat(96);
  const binding = { ...p.describe().binding, run_id: l, case_id: l, exchange_id: l, launch_nonce: l,
    setup: { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h } };
  const write = { generation: 32, ordinal: 32, kind: "FINALIZE", bytes: 65536, sha256: h, deadline_ns: u,
    started: false, shutdown: false, decision: "uncertain", callback: "uncertain", callback_at: { clock_domain: l, monotonic_ns: u }, backpressure: false };
  const transport = { ...base(), schema: "native-bar-worker-transport-model-v1", binding, stopped: c, clock_invalid: false, writes: Array(commands.length).fill(write), pending_generation: 32,
    worker_clock_domain: l, protocol_state: "FINALIZING", frames: 32, go_submitted: false, shutdown_attempted: false, command_close: "unconfirmed",
    next_ordinals: { parent: 33, worker: 33 }, baseline_sha256: h, trace_chunks: 8, trace_events: 128, trace_sha256: h,
    worker_exit: { exit_code: 255, signal: "SIG" + "X".repeat(12) }, phase: "preparation", settlement_start_ns: u, phase_deadline_ns: u, cohort_deadline_ns: u };
  const work = { kind: "status_write", ordinal: 32, outcome: "confirmed" };
  const lifetime = { ...base(), schema: "native-bar-worker-lifetime-model-v1", session_id: l, attempted: false, stopped: c, ports: ["unreferenced", "unreferenced"],
    close_attempted: [false, false], works: [...Array(32).fill(work), ...workKinds.slice(0, -1).map(kind => ({ kind, ordinal: 1, outcome: "confirmed" }))] };
  const metadata = byteLength(canonical({ transport, lifetime }));
  if (metadata > 16384) refuse("diagnostic_capacity");
  // These are separate byte reservations, not a V8 heap measurement or extra native work allowance.
  const retained = { protocol_parent_lines: LIMITS.frames * LIMITS.frame_bytes, pending_command: LIMITS.frame_bytes,
    trace: LIMITS.trace_events * LIMITS.trace_event_bytes, decoder_pending: LIMITS.frame_bytes, output_prefixes: 2 * 8192 };
  const transient = { input_copy: LIMITS.frames * LIMITS.frame_bytes, decoded_batch: LIMITS.frames * LIMITS.frame_bytes,
    canonical_frame: LIMITS.frame_bytes };
  return freeze({ ...base(), schema: "native-bar-worker-transport-capacity-v1", diagnostic_ceiling_bytes: metadata,
    diagnostic_limit_bytes: 16384, coordinator_metadata_limit_bytes: 65536, serialization,
    retained_buffers: retained, retained_buffer_bytes: Object.values(retained).reduce((a, b) => a + b, 0),
    transient_buffers: transient, transient_buffer_bytes: Object.values(transient).reduce((a, b) => a + b, 0),
    command_slots: 1, command_records: commands.length, lifetime_pairs: 1, lifetime_ports: 2, lifetime_work_records: LIMITS.frames + workKinds.length - 1,
    calculation: "canonical_metadata_and_separate_enforced_buffer_geometry_not_v8_heap", native_budget_changed: false });
}

export function createUnsignedWorkerTransportModel(input) {
  const d = parse(z.object({ allocation: z.unknown(), clock: clockSchema, allocated_at: pointSchema }).strict(), input);
  const end = BigInt(d.clock.started_ns) + BigInt(d.clock.cohort_limit_ms) * 1000000n;
  if (BigInt(d.clock.cohort_limit_ms) < 1n || end > maximum) refuse("clock_bound");
  const capacity = describeUnsignedWorkerTransportCapacity(d.allocation), protocol = createUnsignedControllerProtocolModel(d.allocation);
  const window = createUnsignedControllerWindowModel(d.clock), writes = new Map();
  let last = BigInt(d.clock.started_ns), stopped = null, clockInvalid = false, pending = null, generation = 0, shutdownAttempted = false, qualifiedAt = null;
  function stop(reason, at = null, trigger = null) {
    if (stopped) return; stopped = reason; protocol.observeFailure({ reason });
    if (!clockInvalid && at && ["preparation", "query"].includes(window.describe().phase)) {
      try { window.startSettlement(trigger === null ? at : { clock_domain: d.clock.clock_domain, monotonic_ns: String(trigger) }); }
      catch { /* The original window remains expired or unqualified; no replacement grace. */ }
    }
  }
  const reasonOf = error => typeof error?.message === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(error.message) ? error.message : "invalid_input";
  function guard(action) {
    qualifiedAt = null;
    try { return action(); } catch (error) {
      stop(reasonOf(error), clockInvalid ? null : qualifiedAt); throw error;
    } finally { qualifiedAt = null; }
  }
  function point(raw) {
    if (clockInvalid) refuse("clock_invalid");
    let at; try { at = parse(pointSchema, raw); } catch (error) { clockInvalid = true; throw error; }
    const n = BigInt(at.monotonic_ns);
    if (at.clock_domain !== d.clock.clock_domain || n < last) { clockInvalid = true; refuse("clock_order"); }
    last = n; qualifiedAt = at; return at;
  }
  function timed(schema, raw) {
    try { return parse(schema, raw); } catch (error) { clockInvalid = true; throw error; }
  }
  function expireWrite(at) {
    if (pending && ["planned", "started"].includes(pending.decision) && last >= BigInt(pending.deadline_ns)) {
      if (pending.started) {
        pending.decision = "uncertain";
        if (pending.shutdown) protocol.noteShutdownWrite({ outcome: "uncertain" });
        else protocol.noteWrite({ ordinal: pending.ordinal, outcome: "uncertain" });
      }
      stop("write_deadline", at, BigInt(pending.deadline_ns));
      return true;
    }
    return false;
  }
  function inspect(raw, shutdown = false) {
    const at = point(raw); if (expireWrite(at) && !shutdown) refuse("write_deadline");
    if (stopped && !shutdown) refuse("stopped");
    try { return { at, window: shutdown ? window.inspectShutdown(at) : window.inspect(at, "command") }; }
    catch (error) { stop("phase_deadline", at); throw error; }
  }
  function reserve(line, at, w, shutdown) {
    if (pending || generation >= commands.length) refuse("command_busy");
    const frame = decode(line, LIMITS.frame_bytes), token = Object.freeze({});
    const deadline = BigInt(at.monotonic_ns) + BigInt(w.operation_window_ms) * 1000000n;
    pending = { token, generation: ++generation, ordinal: frame.ordinal, kind: frame.kind, line, bytes: byteLength(line), sha256: sha(line),
      deadline_ns: String(deadline), started: false, shutdown, decision: "planned", callback: null, callback_at: null, backpressure: null };
    writes.set(token, pending); return freeze({ reference: token, line, deadline_ns: pending.deadline_ns });
  }
  function current(token) { const w = writes.get(token); if (!w) refuse("command_reference"); return w; }
  const describe = () => freeze({ ...base(), schema: "native-bar-worker-transport-model-v1", binding: protocol.describe().binding,
    stopped, clock_invalid: clockInvalid, writes: [...writes.values()].map(({ token, line, ...w }) => ({ ...w })),
    pending_generation: pending?.generation ?? null, worker_clock_domain: protocol.describe().worker_clock_domain,
    protocol_state: protocol.describe().state, frames: protocol.describe().frames, go_submitted: protocol.describe().go_submitted, shutdown_attempted: shutdownAttempted,
    next_ordinals: protocol.describe().next_ordinals, baseline_sha256: protocol.describe().baseline_sha256,
    trace_chunks: protocol.describe().trace_chunks, trace_events: protocol.describe().trace_events, trace_sha256: protocol.describe().trace_sha256,
    command_close: protocol.describe().command_close, worker_exit: protocol.describe().worker_exit,
    phase: window.describe().phase, settlement_start_ns: window.describe().starts.settlement ?? null,
    phase_deadline_ns: window.describe().phase_deadline_ns, cohort_deadline_ns: String(end) });
  const initial = point(d.allocated_at); window.startPreparation(initial);
  return Object.freeze({
    planCommand(raw) { return guard(() => {
      const q = timed(z.object({ kind: z.enum(commands), payload: z.unknown(), binding: z.unknown().optional(), at: pointSchema }).strict(), raw);
      if (pending) refuse("command_busy"); const v = inspect(q.at), p = protocol.describe();
      const line = boundedFrame({ binding: q.binding === undefined ? p.binding : q.binding, direction: "parent", ordinal: p.next_ordinals.parent, kind: q.kind, payload: q.payload });
      protocol.acceptFrame(line); return reserve(line, v.at, v.window, false);
    }); },
    startWrite(token, raw) { return guard(() => {
      const q = timed(z.object({ at: pointSchema }).strict(), raw), w = current(token);
      if (w !== pending || w.started || w.decision !== "planned") refuse("write_once");
      const v = inspect(q.at, w.shutdown);
      // inspect() already refused an expired original write and a shutdown write follows a stop, so this anchors at the observation, never the future deadline.
      if (BigInt(v.at.monotonic_ns) >= BigInt(w.deadline_ns) || (BigInt(w.deadline_ns) - last) / 1000000n < 1n) { stop("write_deadline", v.at); refuse("write_deadline"); }
      if (w.shutdown) protocol.noteShutdownWrite({ outcome: "started" }); else protocol.noteWrite({ ordinal: w.ordinal, outcome: "started" });
      if (w.kind === "GO") window.submitGo(v.at);
      w.started = true; w.decision = "started"; return describe();
    }); },
    noteBackpressure(token, raw) { return guard(() => {
      const q = parse(z.object({ backpressure: z.boolean() }).strict(), raw), w = current(token);
      if (!w.started || w.callback !== null || w.backpressure !== null) refuse("write_return_once"); w.backpressure = q.backpressure; return describe();
    }); },
    completeWrite(token, raw) { return guard(() => {
      const q = timed(z.object({ outcome: z.enum(["completed", "uncertain"]), at: pointSchema.nullable() }).strict(), raw), w = current(token);
      if (!w.started || w.callback !== null) refuse("callback_once");
      let at = null;
      if (q.at === null) { clockInvalid = true; stop("clock_unavailable"); }
      else if (!stopped) try { at = inspect(q.at).at; } catch (error) { stop(reasonOf(error)); /* Still retain this original completion after its stop. */ }
      // An earlier stop does not waive the original deadline; a bad sample only latches the clock behind the first stop.
      else try { const p = point(q.at); if (!expireWrite(p)) at = p; } catch { /* Close only. */ }
      w.callback = q.outcome; w.callback_at = at; w.line = null;
      if ((!stopped || q.outcome === "uncertain" || w.shutdown && at !== null) && w.decision === "started") {
        if (w.shutdown) protocol.noteShutdownWrite({ outcome: q.outcome }); else protocol.noteWrite({ ordinal: w.ordinal, outcome: q.outcome });
        w.decision = q.outcome;
        if (q.outcome === "uncertain") stop("pipe_uncertain", at);
      }
      if (pending === w) pending = null; return describe();
    }); },
    receive(raw) { return guard(() => {
      const q = timed(z.object({ line: z.string().max(65536), at: pointSchema }).strict(), raw), v = inspect(q.at);
      // Lone surrogates would double while decode re-canonicalizes; the fatal UTF-8 decoder never yields them.
      if (!q.line.isWellFormed()) refuse("encoding");
      const f = decode(q.line, LIMITS.frame_bytes);
      if (f.direction !== "worker") refuse("receive_direction");
      if (f.kind === "READY" && f.payload?.worker_clock_domain === d.clock.clock_domain) refuse("worker_clock_domain");
      protocol.acceptFrame(q.line);
      if (f.kind === "RELEASED") window.startSettlement(v.at);
      if (protocol.describe().stop_reason) stop(protocol.describe().stop_reason, v.at); return describe();
    }); },
    stop(raw) { return guard(() => {
      const q = timed(z.object({ reason: code, at: pointSchema.nullable() }).strict(), raw);
      const at = q.at === null ? null : point(q.at); if (q.at === null) clockInvalid = true;
      // A passed phase deadline is the first stop, as inspect() records it for every other timed event.
      if (at && !expireWrite(at) && !stopped) try { window.inspect(at, "phase"); } catch { stop("phase_deadline", at); }
      stop(q.reason, at); return describe();
    }); },
    planShutdown(raw) { return guard(() => {
      if (shutdownAttempted) refuse("shutdown_once"); shutdownAttempted = true;
      const q = timed(z.object({ at: pointSchema.nullable(), worker_live: z.boolean(), pipe_qualified: z.boolean() }).strict(), raw);
      if (!stopped) refuse("shutdown_requires_stop");
      let v = null; if (!clockInvalid && q.at !== null) try { v = inspect(q.at, true); } catch { /* Close only. */ }
      // A started original write may still settle as known or uncertain; waiting for it spends no plan, frame or ordinal.
      if (v !== null && pending?.decision === "started") { shutdownAttempted = false; refuse("command_busy"); }
      // A reusable CANCEL with less than 1 ms of its original reservation left could never start.
      const startable = !(pending?.kind === "CANCEL" && !pending.started) || BigInt(pending.deadline_ns) - last >= 1000000n;
      const result = protocol.planShutdown({ binding_known: true, worker_live: q.worker_live, pipe_qualified: q.pipe_qualified && v !== null && startable,
        settlement_remaining_ms: v === null ? 0 : Number(v.window.operation_window_ms) });
      if (!result.frame) return freeze({ ...base(), decision: "CLOSE_ONLY", reference: null, line: null });
      if (pending && pending.kind === "CANCEL" && !pending.started) { pending.shutdown = true;
        return freeze({ ...base(), decision: result.decision, reference: pending.token, line: pending.line }); }
      const reservation = reserve(result.frame, v.at, v.window, true); return freeze({ ...base(), decision: result.decision, ...reservation });
    }); },
    closeCommand(raw) { return guard(() => { const q = parse(z.object({ outcome: z.enum(["confirmed", "unconfirmed"]) }).strict(), raw);
      protocol.noteCommandClose(q); if (protocol.describe().stop_reason) stop(protocol.describe().stop_reason); return describe(); }); },
    workerExit(raw) { return guard(() => { const q = parse(z.object({ exit_code: z.number().int().min(0).max(255).nullable(),
      signal: z.string().regex(/^SIG[A-Z0-9]{1,12}$/).nullable() }).strict(), raw); protocol.workerExit(q);
      if (protocol.describe().stop_reason) stop(protocol.describe().stop_reason); return describe(); }); },
    noteTeardown(raw) { return guard(() => {
      const q = timed(z.object({ action: z.enum(["started", "confirmed"]), proof: z.unknown().optional(), at: pointSchema }).strict(), raw), v = inspect(q.at);
      if (q.action === "started") { if (q.proof !== undefined) refuse("teardown_shape"); window.startTeardown(v.at); }
      else { if (window.describe().phase !== "teardown") refuse("teardown_phase"); protocol.finishTeardown(q.proof); }
      return describe();
    }); },
    describe, capacity: () => capacity,
  });
}

export function createUnsignedWorkerLifetimeModel(input) {
  const d = parse(z.object({ session_id: label }).strict(), input), works = new Map();
  let attempted = false, pair = null, stopped = null, ports = ["absent", "absent"], closeAttempted = [false, false];
  const stop = reason => { stopped ??= reason; };
  const guard = f => { try { return f(); } catch (error) { stop("invalid_lifetime_event"); throw error; } };
  const same = ref => { if (ref !== pair || pair === null) refuse("lifetime_reference"); };
  const describe = () => freeze({ ...base(), schema: "native-bar-worker-lifetime-model-v1", session_id: d.session_id, attempted, stopped,
    ports: [...ports], close_attempted: [...closeAttempted], works: [...works.values()].map(w => ({ ...w })) });
  return Object.freeze({
    allocate(raw) { return guard(() => {
      if (attempted) refuse("pair_once"); attempted = true;
      const q = parse(z.object({ ports: z.tuple([z.enum(["referenced", "unreferenced", "unknown", "absent"]), z.enum(["referenced", "unreferenced", "unknown", "absent"])]) }).strict(), raw);
      ports = [...q.ports]; pair = Object.freeze({}); if (ports.some(p => p !== "referenced")) stop("pair_unqualified"); return pair;
    }); },
    beginWork(ref, raw) { return guard(() => {
      same(ref); if (stopped || ports.some(p => p !== "referenced")) refuse("lifetime_stopped");
      const q = parse(z.object({ kind: z.enum(workKinds), ordinal: z.number().int().min(1).max(32) }).strict(), raw);
      const count = [...works.values()].filter(w => w.kind === q.kind).length;
      if (q.ordinal !== count + 1 || count >= (q.kind === "status_write" ? LIMITS.frames : 1)) refuse("work_once");
      const token = Object.freeze({}); works.set(token, { ...q, outcome: "pending" }); return token;
    }); },
    settleWork(token, raw) { return guard(() => {
      const q = parse(z.object({ outcome: z.enum(["confirmed", "unknown"]) }).strict(), raw), w = works.get(token);
      if (!w || w.outcome !== "pending") refuse("work_settle_once"); w.outcome = q.outcome;
      if (q.outcome === "unknown") stop("work_unknown"); return describe();
    }); },
    stop(raw) { return guard(() => { const q = parse(z.object({ reason: code }).strict(), raw); stop(q.reason); return describe(); }); },
    closePort(ref, raw) { return guard(() => {
      same(ref); const q = parse(z.object({ index: z.number().int().min(0).max(1), outcome: z.enum(["confirmed", "unconfirmed"]) }).strict(), raw);
      if ([...works.values()].some(w => w.outcome !== "confirmed") || ports[q.index] === "absent" || closeAttempted[q.index]) refuse("port_close_once");
      closeAttempted[q.index] = true; ports[q.index] = q.outcome === "confirmed" ? "closed" : "unconfirmed";
      if (q.outcome === "unconfirmed") stop("port_close_unknown"); return describe();
    }); },
    describe,
  });
}
