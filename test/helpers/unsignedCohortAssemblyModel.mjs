import { z } from "zod";
import { describeUnsignedAcceptanceRun, describeUnsignedFixture } from "./jointUnsignedAcceptanceContracts.mjs";
import { createUnsignedControllerProtocolModel, createUnsignedControllerWindowModel } from "./unsignedControllerContracts.mjs";
import { createUnsignedControllerEvidenceModel, createUnsignedControllerCohortModel, describeUnsignedControllerSerializationCapacity } from "./unsignedControllerEvidence.mjs";
import { uint, label, code, parse, canonical, digest, sha, byteLength, freeze, flags, LIMITS } from "./unsignedControllerData.mjs";

const refuse = (reason) => { throw Error(`cc4b2_${reason}`); };
const atSchema = z.object({ clock_domain: label, monotonic_ns: uint }).strict();
const eventKinds = ["resource", "frame", "write", "receipt", "receipt_readback", "command_close", "worker_exit", "report", "report_readback", "case_closes", "index_row", "index_readback", "shutdown_plan", "shutdown_write", "late_frame"];
const slotNames = ["worker", "observer", "helper", "fixture"];
const cachedReceipts = ["case_allocated", "setup_sealed", "baseline_bound", "go_intent", "release_checked", "absence_checked", "worker_finalized"];
const live = (slots) => Object.values(slots).some((s) => !["empty", "closed"].includes(s));
const equal = (a, b, reason) => { if (canonical(a) !== canonical(b)) refuse(reason); };
const reasonOf = (error) => /^(?:cc4[ab]2?_|cc1a_)[a-z_]+$/.test(error?.message) ? error.message.slice(error.message.indexOf("_") + 1) : "model_failure";
function capacityFor(a, protocol, evidence, window) {
  const h = "f".repeat(64), u = "9".repeat(30), l = "l".repeat(48), c = "c".repeat(96), p = protocol.describe();
  const binding = { ...p.binding, run_id: l, case_id: l, exchange_id: l, launch_nonce: l,
    setup: { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h } };
  const e = { ...evidence.describe(), binding, confirmed_records: 64, confirmed_bytes: 1048576, pending_readback: "receipt", stop_reason: c,
    case_stopped: false, removed_entries: 16, candidate_outcome: "MODEL_CONSISTENT", c1_violation: false, final_model_verdict: "MODEL_CONSISTENT",
    finalization: "pending_index_close", case_closes: { receipt: "unconfirmed", report: "unconfirmed", errors: Array(8).fill(c) },
    receipt_sha256: h, report_sha256: h, index_sha256: h };
  const w = { ...window.describe(), phase: "preparation", stopped: c, clock_invalid: false, phase_deadline_ns: u, cohort_deadline_ns: u, first_stop_ns: u,
    starts: Object.fromEntries(["preparation", "query", "settlement", "teardown"].map((k) => [k, u])) };
  const cap = { diagnostic_ceiling_bytes: 99999, coordinator_json_ceiling_bytes: 99999, diagnostic_limit_bytes: 16384,
    coordinator_json_limit_bytes: 65536, native_budget_changed: false, measurement: "canonical_payload_not_v8_heap" };
  const rows = Array(24).fill({ case_id: l, mode: "normal", model_verdict: "MODEL_CONSISTENT", cleanly_settled: false, c1_violation: false,
    index_readback: false, index_bytes: 5290, index_sha256: h, ordinal: 24, unindexed: false });
  const maximal = { ...flags(), schema: "native-bar-unsigned-assembly-model-v1", scope: "unsigned_cohort_assembly_memory_only",
    runtime_completion_proven: false, stopped: false, stop_reason: c, first_stop_ns: u, clock_invalid: false, cohort_deadline_ns: u, closed: false,
    rows, index_close: "unconfirmed", capacity: cap, active: { case_id: l, mode: "normal", binding, protocol_state: "FINALIZING", next_ordinals: { parent: 33, worker: 33 },
      frames: 32, go_submitted: false, baseline_sha256: h, observation_sha256: h, trace_events: 128, trace_chunks: 8, trace_sha256: h,
      worker_clock_domain: l, command_close: "unconfirmed", observer_calls: 64, evidence_frozen: false, stop_recorded: false, row_recorded: false,
      slots: Object.fromEntries(slotNames.map((k) => [k, "retained"])), window: w, evidence: e } };
  const diagnostic = byteLength(canonical(maximal));
  const serialization = describeUnsignedControllerSerializationCapacity(a);
  const cache = cachedReceipts.reduce((n, k) => n + serialization.receipt_kind_ceilings[k], 0);
  const pins = 3 * byteLength(canonical(a.artifacts)), labels = byteLength(canonical({ exchanges: Array(24).fill(l), nonces: Array(24).fill(l) }));
  const coordinator = diagnostic + cache + pins + labels + 4096;
  if (diagnostic > 16384 || coordinator > 65536) refuse("metadata_capacity");
  return freeze({ ...cap, diagnostic_ceiling_bytes: diagnostic, coordinator_json_ceiling_bytes: coordinator });
}

export function createUnsignedCohortAssemblyModel(input) {
  const d = parse(z.object({ request: z.unknown(), clock: z.object({ clock_domain: label, started_ns: uint, cohort_limit_ms: uint }).strict() }).strict(), input);
  const plan = describeUnsignedAcceptanceRun(d.request), cohort = createUnsignedControllerCohortModel({ request: d.request });
  const end = BigInt(d.clock.started_ns) + BigInt(d.clock.cohort_limit_ms) * 1000000n;
  if (BigInt(d.clock.cohort_limit_ms) < 1n || end > 999999999999999999999999999999n) refuse("clock_bound");
  let last = BigInt(d.clock.started_ns), stopped = null, firstStop = null, clockInvalid = false, active = null, closed = false, notRun = false;
  let common = null, capacity = null; const modePins = new Map(), exchanges = new Set(), nonces = new Set();
  function latch(reason) {
    if (stopped) return;
    const w = active?.window.describe(), phaseEnd = w?.phase_deadline_ns === null || !w ? end : BigInt(w.phase_deadline_ns);
    const limit = phaseEnd < end ? phaseEnd : end;
    let trigger = w?.first_stop_ns ?? String(last);
    if (!clockInvalid && last >= limit) {
      reason = "deadline"; trigger = String(limit);
      if (active) try { active.window.inspect({ clock_domain: d.clock.clock_domain, monotonic_ns: String(last) }); } catch { /* Preserve the detected deadline. */ }
    }
    stopped = reason; firstStop = trigger;
    if (!active) cohort.stop();
    if (active) {
      active.evidenceFrozen = active.evidence.describe().candidate_outcome !== null || active.pendingReceipt === "ready_to_report";
      active.protocol.observeFailure({ reason });
      const w = active.window.describe();
      if (!clockInvalid && !w.starts.settlement && ["preparation", "query"].includes(w.phase)) {
        try { active.window.startSettlement({ clock_domain: d.clock.clock_domain, monotonic_ns: String(last) }); } catch { /* Preserve the original stop and expired window. */ }
      }
    }
  }
  function guard(action, shutdown = false, terminalDisposition = false) {
    if (closed && !(terminalDisposition && stopped && active)) refuse("closed");
    if (stopped && !shutdown) refuse("stopped");
    try { return action(); } catch (error) { latch(reasonOf(error)); throw error; }
  }
  function point(raw) {
    let at;
    try { at = parse(atSchema, raw); } catch (error) { clockInvalid = true; throw error; }
    if (at.clock_domain !== d.clock.clock_domain || BigInt(at.monotonic_ns) < last) { clockInvalid = true; refuse("clock_order"); }
    last = BigInt(at.monotonic_ns); return at;
  }
  function timedInput(schema, raw) {
    let q;
    try { q = parse(schema, raw); } catch (error) { clockInvalid = true; throw error; }
    return { ...q, at: point(q.at) };
  }
  function current(token) { if (!active || token !== active.token) refuse("case_reference"); return active; }
  function apply(c, q) {
    const p = c.protocol.describe();
    const cancelUnsettled = p.release !== null && p.writes.some((w) => w.kind === "CANCEL" && w.outcome !== "completed");
    if (q.kind === "resource") {
      const r = parse(z.object({ resource: z.enum(["worker", "observer", "helper"]), action: z.enum(["attach", "close"]), outcome: z.enum(["confirmed", "unconfirmed"]).optional() }).strict(), q.payload);
      const state = c.slots[r.resource];
      if (r.action === "attach") {
        if (cancelUnsettled) refuse("cancel_unsettled");
        if (stopped || r.outcome !== undefined || !["empty", "closed"].includes(state)
          || r.resource === "worker" && (state !== "empty" || p.state !== "NEW" || !c.confirmed.case_allocated)) refuse("resource_order");
        if (r.resource === "observer") { if (c.observerCalls >= 64) refuse("observer_capacity"); c.observerCalls++; }
        c.slots[r.resource] = "live";
      } else {
        if (state !== "live" || r.outcome === undefined || r.resource === "worker" && p.worker_exit === null) refuse("resource_order");
        c.slots[r.resource] = r.outcome === "confirmed" ? "closed" : "retained";
        if (r.outcome !== "confirmed") latch("resource_close");
      }
    } else if (q.kind === "frame") {
      const r = parse(z.object({ line: z.string().max(65536) }).strict(), q.payload);
      if (c.slots.worker !== "live") refuse("worker_reference");
      if (byteLength(r.line) > LIMITS.frame_bytes) refuse("frame_bound"); const f = JSON.parse(r.line);
      if (f.kind === "READY" && f.payload?.worker_clock_domain === d.clock.clock_domain) refuse("worker_clock_domain");
      if (f.kind === "PREPARE") equal(f.binding.setup, c.confirmed.setup_sealed?.setup, "setup_readback");
      if (f.kind === "GO") {
        if (!c.confirmed.baseline_bound || !c.confirmed.go_intent || c.evidence.describe().pending_readback) refuse("go_readback");
        equal(digest(c.confirmed.baseline_bound), p.baseline_sha256, "baseline_binding");
        equal(f.payload, { baseline_sha256: p.baseline_sha256, baseline_readback: true, go_intent_readback: true }, "go_readback");
      }
      c.protocol.acceptFrame(r.line); if (f.kind === "READY") c.readyHash = sha(r.line);
      if (f.kind === "RELEASED") c.window.startSettlement(q.at);
    } else if (q.kind === "write") {
      c.protocol.noteWrite(q.payload);
      if (q.payload.outcome === "started" && p.writes.find((w) => w.ordinal === q.payload.ordinal)?.kind === "GO") c.window.submitGo(q.at);
    }
    else if (q.kind === "receipt") {
      const r = q.payload;
      if (cancelUnsettled && ["cleanup_precheck", "delete_intent", "delete_result", "absence_checked"].includes(r.kind)) refuse("cancel_unsettled");
      if (stopped && !["stop_summary", "ready_to_report", "terminal"].includes(r.kind)) refuse("receipt_after_stop");
      if (stopped && c.evidenceFrozen) refuse("evidence_frozen");
      if (stopped && r.kind === "ready_to_report" && (!c.stopRecorded || r.payload.candidate_outcome !== "FAIL")) refuse("stopped_evidence");
      if (["create_intent", "create_result", "setup_sealed"].includes(r.kind) && p.state !== "READY") refuse("receipt_gate");
      if (r.kind === "create_intent" && r.payload.entry_index === 0) equal(r.payload.ready_sha256, c.readyHash, "ready_binding");
      if (["worker_prepared", "baseline_bound", "go_intent"].includes(r.kind) && p.state !== "BASELINED") refuse("receipt_gate");
      if (r.kind === "baseline_bound") equal(r.payload, p.baseline, "baseline_binding");
      if (r.kind === "go_intent" && (!c.confirmed.baseline_bound || digest(c.confirmed.baseline_bound) !== p.baseline_sha256)) refuse("baseline_binding");
      if (r.kind === "run_outcome") {
        if (!p.release) refuse("release_binding"); const v = p.release;
        equal(r.payload, { primary_code: v.primary_code, requests_dispatched: v.requests_dispatched, authenticated_requests: v.authenticated_requests,
          diagnostic_sha256: v.diagnostic_sha256, observation_sha256: p.observation_sha256,
          observation_bytes: p.observation ? byteLength(canonical(p.observation)) : 0, trace_sha256: p.trace_sha256, trace_events: p.trace_events }, "outcome_binding");
      }
      if (r.kind === "release_checked") {
        if (!p.release) refuse("release_binding"); const { bound_objects_sha256: _proof, ...rest } = r.payload;
        equal(rest, { baseline_sha256: p.release.baseline_sha256, resources: p.release.resources, query_released: true,
          original_operation_retired: true, close_errors: p.release.close_errors }, "release_binding");
      }
      if (["cleanup_precheck", "delete_intent", "delete_result", "absence_checked"].includes(r.kind) && (!c.confirmed.release_checked || p.state !== "RELEASED")) refuse("cleanup_gate");
      if (r.kind === "cleanup_precheck") c.window.startTeardown(q.at);
      if (r.kind === "worker_finalized" && (p.state !== "DONE" || c.slots.worker !== "closed" || p.command_close !== "confirmed")) refuse("worker_finalization");
      if (r.kind === "stop_summary" && (!stopped || r.payload.reason !== stopped)) refuse("stop_binding");
      equal(q.payload.stamp.clock_domain, q.at.clock_domain, "receipt_clock");
      equal(q.payload.stamp.monotonic_ns, q.at.monotonic_ns, "receipt_clock");
      const encoded = c.evidence.append(q.payload); c.pendingReceipt = r.kind;
      if (r.kind === "create_intent" && r.payload.entry_index === 0) c.slots.fixture = "reserved";
      return encoded;
    } else if (q.kind === "receipt_readback") {
      const r = parse(z.object({ line: z.string().max(16384) }).strict(), q.payload);
      c.evidence.confirmReceipt(r.line); c.pendingReceipt = null; const event = JSON.parse(r.line);
      if (event.kind === "stop_summary") c.stopRecorded = true;
      if (cachedReceipts.includes(event.kind)) c.confirmed[event.kind] = event.payload;
      if (event.kind === "create_result" && event.payload.entry_index === 0) c.slots.fixture = "live";
      if (event.kind === "absence_checked") {
        if (c.evidence.describe().removed_entries !== c.ownedEntries) refuse("absence_binding");
        c.slots.fixture = "closed";
        if (!stopped) c.protocol.finishTeardown({ receipt_readback: true, ...event.payload, worker_live: c.slots.worker === "live" });
      }
      if (event.kind === "worker_finalized" && !stopped) c.window.startReporting(q.at);
    } else if (q.kind === "command_close" || q.kind === "worker_exit") {
      if (c.slots.worker !== "live") refuse("worker_reference");
      if (q.kind === "command_close") c.protocol.noteCommandClose(q.payload); else c.protocol.workerExit(q.payload);
    }
    else if (q.kind === "report") {
      if (stopped && (c.evidenceFrozen || !c.stopRecorded || c.evidence.describe().candidate_outcome !== "FAIL")) refuse(c.evidenceFrozen ? "evidence_frozen" : "stopped_evidence");
      equal(q.payload.save_stamp.clock_domain, q.at.clock_domain, "report_clock"); equal(q.payload.save_stamp.monotonic_ns, q.at.monotonic_ns, "report_clock");
      return c.evidence.createReport(q.payload);
    } else if (q.kind === "report_readback" || q.kind === "index_readback") {
      const r = parse(z.object({ line: z.string().max(q.kind === "report_readback" ? 262144 : 5290) }).strict(), q.payload);
      if (q.kind === "report_readback") c.evidence.confirmReport(r.line);
      else { c.evidence.confirmIndexRow(r.line); const v = JSON.parse(r.line); c.row = { bytes: byteLength(r.line), sha256: sha(r.line), model_verdict: v.model_verdict }; }
    } else if (q.kind === "case_closes") c.evidence.noteCaseCloses(q.payload);
    else if (q.kind === "index_row") {
      parse(z.object({}).strict(), q.payload);
      if (stopped && (c.evidenceFrozen || !c.stopRecorded || c.evidence.describe().candidate_outcome !== "FAIL")) refuse(c.evidenceFrozen ? "evidence_frozen" : "stopped_evidence");
      return c.evidence.createIndexRow();
    }
    else if (q.kind === "late_frame") { const r = parse(z.object({ line: z.string().max(65536) }).strict(), q.payload); c.protocol.observeLateFrame(r.line); }
    else if (q.kind === "shutdown_write") {
      const r = parse(z.object({ outcome: z.enum(["started", "completed", "uncertain"]) }).strict(), q.payload);
      if (r.outcome === "started") {
        if (clockInvalid) refuse("shutdown_clock"); c.window.inspectShutdown(q.at);
        if (p.writes.some((w) => w.outcome === "uncertain")) refuse("shutdown_uncertain");
      }
      c.protocol.noteShutdownWrite(r);
    }
    else if (q.kind === "shutdown_plan") {
      parse(z.object({}).strict(), q.payload); let remaining = 0;
      if (!clockInvalid) try { remaining = Number(c.window.inspectShutdown(q.at).operation_window_ms); } catch { /* Close only when the original grace cannot be proven. */ }
      return c.protocol.planShutdown({ binding_known: true, worker_live: c.slots.worker === "live" && p.worker_exit === null,
        pipe_qualified: p.command_close === null, settlement_remaining_ms: remaining });
    } else refuse("event_kind");
    const after = c.protocol.describe(); if (after.stop_reason) latch(after.stop_reason);
    return summary();
  }
  function summary() {
    const p = active?.protocol.describe(), e = active?.evidence.describe();
    return freeze({ ...flags(), schema: "native-bar-unsigned-assembly-model-v1", scope: "unsigned_cohort_assembly_memory_only",
      runtime_completion_proven: false, stopped: stopped !== null, stop_reason: stopped, first_stop_ns: firstStop,
      clock_invalid: clockInvalid, cohort_deadline_ns: String(end), closed,
      rows: cohort.describe().rows, index_close: cohort.describe().index_close, capacity,
      active: active ? { case_id: p.binding.case_id, mode: p.binding.mode, binding: p.binding, protocol_state: p.state,
        next_ordinals: p.next_ordinals, frames: p.frames, go_submitted: p.go_submitted, baseline_sha256: p.baseline_sha256,
        observation_sha256: p.observation_sha256, trace_events: p.trace_events, trace_chunks: p.trace_chunks, trace_sha256: p.trace_sha256,
        worker_clock_domain: p.worker_clock_domain, command_close: p.command_close, observer_calls: active.observerCalls, evidence_frozen: active.evidenceFrozen,
        stop_recorded: active.stopRecorded, row_recorded: active.indexed, slots: { ...active.slots }, window: active.window.describe(), evidence: e } : null });
  }
  function recordCase(c) {
    const p = c.protocol.describe(), e = c.evidence.describe();
    if (c.indexed || notRun) refuse("case_recorded");
    if (!c.row || e.pending_readback) refuse("case_incomplete");
    const clean = p.state === "DONE" && p.command_close === "confirmed" && !live(c.slots) && c.slots.fixture === "closed"
      && c.slots.worker === "closed" && c.confirmed.absence_checked && c.confirmed.worker_finalized && p.release !== null
      && e.case_closes?.receipt === "confirmed" && e.case_closes?.report === "confirmed" && !e.case_closes.errors.length;
    cohort.finishCase({ case_id: p.binding.case_id, mode: p.binding.mode, model_verdict: c.row.model_verdict, cleanly_settled: !!clean,
      c1_violation: p.c1_violation, index_readback: true, index_bytes: c.row.bytes, index_sha256: c.row.sha256 });
    c.indexed = true; if (clean) active = null;
    if (stopped) cohort.stop(); else if (!clean || p.c1_violation) latch(p.c1_violation ? "c1_violation" : "case_retained");
  }
  return Object.freeze({
    beginCase(raw) { return guard(() => {
      const q = timedInput(z.object({ allocation: z.unknown(), at: z.unknown() }).strict(), raw), at = q.at;
      if (active || notRun || cohort.describe().rows.length >= 24) refuse("case_order");
      const expected = plan.cases[cohort.describe().rows.length], a = q.allocation;
      equal(a.fixture.request, d.request, "case_binding");
      if (a.fixture.case_id !== expected.case_id || a.fixture.mode !== expected.mode) refuse("case_binding");
      const protocol = createUnsignedControllerProtocolModel(a), evidence = createUnsignedControllerEvidenceModel(a);
      const window = createUnsignedControllerWindowModel(d.clock);
      if (end - last < 900000000000n) refuse("cohort_window"); window.startPreparation(at);
      const fixed = { source_tree_sha256: a.source_tree_sha256, signature_profile: a.signature_profile,
        artifacts: Object.fromEntries(["runtime_closure_sha256", "node_binary_sha256", "build_record_sha256", "controller_sha256", "worker_sha256", "reader_source_sha256"].map((k) => [k, a.artifacts[k]])) };
      if (common) equal(common, fixed, "source_binding");
      if (modePins.has(expected.mode)) equal(modePins.get(expected.mode), a.artifacts, "mode_binding");
      if (exchanges.has(a.exchange_id) || nonces.has(a.launch_nonce)) refuse("exchange_reused");
      const proposedCapacity = capacityFor(a, protocol, evidence, window);
      cohort.beginCase({ case_id: expected.case_id, mode: expected.mode, remaining_ms: String((end - last) / 1000000n) });
      capacity = proposedCapacity; common ??= fixed; modePins.set(expected.mode, a.artifacts); exchanges.add(a.exchange_id); nonces.add(a.launch_nonce);
      active = { token: Object.freeze({}), protocol, evidence, window, observerCalls: 0, evidenceFrozen: false, stopRecorded: false, pendingReceipt: null, indexed: false,
        ownedEntries: describeUnsignedFixture({ ...a.fixture, fixture_name: "native-bar-fs-synthetic-Plan00" }).entries.length,
        slots: Object.fromEntries(slotNames.map((s) => [s, "empty"])), confirmed: Object.create(null) };
      return active.token;
    }); },
    applyModelEvent(token, raw) { return guard(() => {
      const c = current(token), q = timedInput(z.object({ kind: z.enum(eventKinds), payload: z.unknown(), at: z.unknown() }).strict(), raw);
      if (closed && (!["resource", "write", "command_close", "worker_exit", "late_frame"].includes(q.kind)
        || q.kind === "resource" && q.payload.action !== "close")) refuse("terminal_event");
      if (notRun && ["receipt", "report", "index_row"].includes(q.kind)) refuse("not_run_evidence");
      if (stopped && q.kind === "write" && !["completed", "uncertain"].includes(q.payload.outcome)) refuse("stopped_write_start");
      if (stopped && !["resource", "write", "receipt", "receipt_readback", "command_close", "worker_exit", "report", "report_readback", "case_closes", "index_row", "index_readback", "shutdown_plan", "shutdown_write", "late_frame"].includes(q.kind)) refuse("stopped");
      if (!stopped) c.window.inspect(q.at); return apply(c, q);
    }, true, true); },
    finishCase(token, raw) { return guard(() => {
      const c = current(token), q = timedInput(z.object({ at: z.unknown() }).strict(), raw); if (!stopped) c.window.inspect(q.at);
      recordCase(c);
      return summary();
    }, true); },
    stop(raw) { return guard(() => { const q = timedInput(z.object({ reason: code, at: z.unknown() }).strict(), raw); latch(q.reason); return summary(); }, true); },
    finishNotRun() { return guard(() => {
      if (!stopped || notRun) refuse("not_run_order");
      if (active?.evidence.describe().pending_readback === "index") refuse("index_readback_pending");
      if (active?.row && !active.indexed) recordCase(active);
      cohort.stop(); cohort.finishNotRun(); notRun = true; return summary();
    }, true); },
    closeIndex(raw) { return guard(() => {
      const q = timedInput(z.object({ outcome: z.enum(["confirmed", "unconfirmed"]), at: z.unknown() }).strict(), raw);
      if (last >= end && !stopped) latch("deadline");
      cohort.closeIndex({ outcome: q.outcome }); if (q.outcome !== "confirmed") latch("index_close"); closed = true; return summary();
    }, true); },
    describe: summary,
  });
}
