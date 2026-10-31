import { flags, freeze } from "./unsignedControllerData.mjs";

export function inspectUnsignedCohortAssembly() {
  return freeze({ ...flags(), scope: "unsigned_cohort_sealed_runtime_only", runtime_completion_proven: false,
    blockers: ["original_live_build_unavailable", "runtime_qualification_unavailable", "worker_entry_sealed", "execution_not_approved"] });
}

export function executeUnsignedCohortAssembly() { throw Error("cc4b2_execution_not_approved"); }

const retainedQualificationScopes = new Set();

// No exported entry calls this composition root. Operational policy remains sealed before clock access.
async function prepareOriginalQualification() {
  const policy = originalQualificationPolicy(), clock = originalQualificationClock();
  const fs = await import("node:fs"), path = await import("node:path"), url = await import("node:url"), crypto = await import("node:crypto");
  const { default: ts } = await import("typescript");
  const { builtinModules } = await import("node:module");
  const { canonical, digest } = await import("./unsignedControllerData.mjs");
  const { describeUnsignedQualificationProfile, describeUnsignedQualificationCapacity } = await import("./unsignedCohortQualificationContracts.mjs");
  const { describeUnsignedIsolatedBuild } = await import("./unsignedBuildPlan.mjs");
  const { createUnsignedCohortAssemblyModel } = await import("./unsignedCohortAssemblyModel.mjs");
  const { createUnsignedProtocolDecoder } = await import("./unsignedAdapterSupport.mjs");
  const { planUnsignedParentCheckpoint, validateUnsignedParentTerminalFacts, summarizeUnsignedParentDiscard,
    describeUnsignedParentConnectionCapacity } = await import("./unsignedParentConnectionContracts.mjs");
  const limits = describeUnsignedQualificationProfile(), root = path.resolve(url.fileURLToPath(new URL("../../", import.meta.url)));
  const buildReferences = new WeakMap(), namespaceReferences = new WeakMap();
  const parentOwners = new WeakMap(), parentSessions = new WeakMap();
  return buildAndQualify();

  function originalQualificationPolicy() { throw Error("cc4b3b_operational_profile_unavailable"); }
  function originalQualificationClock() {
    const maximum = 999999999999999999999999999999n, unit = 1000000n;
    if (typeof policy.total_limit_ms !== "string" || !/^[1-9][0-9]{0,29}$/.test(policy.total_limit_ms)) throw Error("cc4b3c_entry_limit");
    let last = null, failure = null, invalid = false, stopAt = null, previousWall = null, adjusted = false;
    const fail = (reason, clockInvalid = true, at = last) => {
      failure ??= `cc4b3c_${reason}`; invalid ||= clockInvalid; stopAt ??= at; throw Error(failure);
    };
    function sample() {
      if (failure) throw Error(failure);
      let n; try { n = process.hrtime.bigint(); } catch { return fail("monotonic_read"); }
      if (typeof n !== "bigint" || n < 0n || n > maximum) return fail("monotonic_value");
      if (last !== null && n < last) return fail("monotonic_rollback"); last = n; return n;
    }
    const start = sample(), end = start + BigInt(policy.total_limit_ms) * unit;
    if (end > maximum) fail("entry_limit");
    const binding = Object.freeze({ clock_domain: `parent-${start.toString(36)}`, started_ns: String(start), cohort_limit_ms: policy.total_limit_ms });
    function check() {
      const n = sample(); if (n >= end) return fail("entry_deadline", false, end); return n;
    }
    function stamp() {
      const before = check(); let ms;
      try { ms = Date.now(); } catch { return fail("wall_read"); }
      const after = check();
      if (!Number.isSafeInteger(ms) || ms < 0 || ms > 253402268399999) return fail("wall_value");
      let utc, jst;
      try { utc = new Date(ms).toISOString(); jst = new Date(ms + 32400000).toISOString().replace("Z", "+09:00"); }
      catch { return fail("wall_value"); }
      if (previousWall) {
        // Same sub-ms quantization slack as the reviewed 4-B3-A stamp model.
        const delta = BigInt(ms - previousWall.ms) * unit, slack = unit - 1n;
        adjusted ||= delta < 0n || delta < before - previousWall.after - slack || delta > after - previousWall.before + slack;
      }
      previousWall = { ms, before, after };
      return Object.freeze({ stamp: Object.freeze({ clock_domain: binding.clock_domain, monotonic_ns: String(after), wall_utc: utc, wall_jst: jst }),
        sampling: Object.freeze({ before_ns: String(before), after_ns: String(after), wall_ms: String(ms) }), wall_adjustment_possible: adjusted });
    }
    return Object.freeze({ binding, end_ns: String(end), check, stamp,
      point() { return Object.freeze({ clock_domain: binding.clock_domain, monotonic_ns: String(check()) }); },
      remaining(deadline = end) {
        if (typeof deadline !== "bigint" || deadline < start || deadline > end) return fail("deadline_binding");
        const now = check(), ms = (deadline - now) / unit;
        if (ms < 1n) throw Error("cc4b3c_remaining_sub_ms"); return ms;
      },
      describe() { return Object.freeze({ clock_invalid: invalid, failure, stop_ns: stopAt === null ? null : String(stopAt) }); } });
  }
  function armOriginalQualificationTimer(s, kind, onExpiry) {
    checkpoint(s);
    if (!retainedQualificationScopes.has(s) || s.qualificationTimer || typeof onExpiry !== "function"
      || !["compiler", "discovery", "metadata"].includes(kind)) refuse("timer_binding");
    const unit = 1000000n, now = clock.check(), entryEnd = BigInt(clock.end_ns);
    const deadline = kind === "compiler" || now + 10000n * unit > entryEnd ? entryEnd : now + 10000n * unit;
    clock.remaining(deadline);
    const generation = (s.timerGeneration ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) refuse("timer_generation"); s.timerGeneration = generation;
    let active = true, handle = null, cleared = false, clearUnknown = false, segment = 0;
    const current = () => active && s.qualificationTimer === timer && s.timerGeneration === generation;
    const clear = () => {
      if (cleared || handle === null) return; cleared = true;
      try { clearTimeout(handle); } catch { clearUnknown = true; s.timerCancelUnknown = true; stop(s, Error("cc4b3c_timer_cancel_unknown")); }
    };
    const cancel = () => { if (!active) return false; active = false; clear(); if (!clearUnknown && s.qualificationTimer === timer) s.qualificationTimer = null; return true; };
    const referenced = () => { try { return current() && handle !== null && handle.hasRef() === true; } catch { return false; } };
    const expire = error => {
      if (!current()) return;
      stop(s, error); cancel();
      s.timerDisposition = Object.freeze({ generation, deadline_ns: String(deadline), reason: code(error) });
      onExpiry(s.timerDisposition.reason);
    };
    const check = () => {
      if (!current()) throw Error("cc4b3c_timer_inactive");
      checkpoint(s); const at = clock.check();
      if (!referenced()) throw stop(s, Error("cc4b3c_timer_unreferenced"));
      if (at >= deadline) throw stop(s, Error("cc4b3c_timer_deadline"));
      clock.remaining(deadline); return at;
    };
    function schedule(at) {
      const ordinal = ++segment, ns = deadline - at;
      if (ns <= 0n) throw Error("cc4b3c_timer_deadline");
      const delay = Number((ns + unit - 1n) / unit > 2147483647n ? 2147483647n : (ns + unit - 1n) / unit);
      handle = setTimeout(() => {
        if (!current() || ordinal !== segment) return;
        if (s.stopped) { expire(Error(s.stopped)); return; }
        try {
          const observed = clock.check();
          if (!referenced()) return expire(Error("cc4b3c_timer_unreferenced"));
          if (observed >= deadline) return expire(Error("cc4b3c_timer_deadline"));
          clear(); if (s.stopped) return expire(Error(s.stopped)); schedule(clock.check());
        } catch (error) { expire(error); }
      }, delay);
      cleared = false;
      if (!referenced()) throw Error("cc4b3c_timer_unreferenced");
    }
    const timer = Object.freeze({ cancel, hasRef: referenced, check }); s.qualificationTimer = timer;
    try { schedule(clock.check()); } catch (error) { stop(s, error); cancel(); throw error; } return timer;
  }
  function originalCohortTiming(s, buildRef, namespaceRef) {
    const namespace = namespaceReferences.get(namespaceRef);
    if (!retainedQualificationScopes.has(s) || buildReferences.get(buildRef) !== s || namespace?.owner !== s
      || namespace.buildRef !== buildRef || !s.recordClosed || !s.recordIdentity || s.phase !== "NAMESPACE_BOUND") refuse("cohort_clock_binding");
    checkpoint(s, true);
    // Descriptive input for the private B2 consumer, never a writer or execution capability.
    return Object.freeze({ binding: clock.binding, at: clock.point() });
  }
  function originalParentScope(s, buildRef, namespaceRef, retained = false) {
    const namespace = namespaceReferences.get(namespaceRef);
    if (!retainedQualificationScopes.has(s) || buildReferences.get(buildRef) !== s || namespace?.owner !== s
      || namespace.buildRef !== buildRef || !s.recordClosed || !s.recordIdentity || !retained && (s.stopped || s.evidenceTainted
        || s.phase !== "NAMESPACE_BOUND" || s.qualificationTimer || s.helper || s.children.size)) refuse("parent_scope");
  }
  function originalParentInvocation() { throw Error("cc4b3b_parent_invocation_unavailable"); }
  function originalParentAllocation() { throw Error("cc4b3b_original_allocation_unavailable"); }
  function originalParentCaseReceipt() { throw Error("cc4b3b_original_case_receipt_unavailable"); }
  function originalParentWorkPlan() { throw Error("cc4b3b_runtime_work_plan_unavailable"); }
  function originalParentWorkerQualification() { throw Error("cc4b3b_qualified_worker_closure_unavailable"); }
  function createOriginalParentOwner(s, buildRef, namespaceRef) {
    originalParentScope(s, buildRef, namespaceRef);
    if (s.parentOwnerReserved) refuse("parent_owner_once"); s.parentOwnerReserved = true;
    const request = originalParentInvocation(); originalParentWorkPlan();
    const timing = originalCohortTiming(s, buildRef, namespaceRef), capacity = describeUnsignedParentConnectionCapacity({});
    const reservedBytes = capacity.coordinator_ceiling_bytes + Buffer.byteLength(canonical({ admission: null, terminal: null })) - 8;
    if (reservedBytes > 65536) refuse("parent_metadata_capacity");
    const coordinator = createUnsignedCohortAssemblyModel({ request, clock: timing.binding });
    const ref = Object.freeze(Object.create(null));
    parentOwners.set(ref, { s, buildRef, namespaceRef, coordinator, capacity: reservedBytes,
      lastNs: timing.binding.started_ns, active: null, generation: 0 });
    return ref;
  }
  function reserveOriginalParentSession(ownerRef) {
    const o = parentOwners.get(ownerRef); if (!o) refuse("parent_owner_reference");
    originalParentScope(o.s, o.buildRef, o.namespaceRef);
    if (o.active || o.generation >= 24) refuse("parent_session_once");
    const c = { owner: o, generation: ++o.generation, caseRef: null, decoder: null, child: null,
      pipes: { command: null, status: null, stdout: null, stderr: null }, receiveBusy: false, intakeClosed: false, facts: null };
    o.active = c;
    const allocation = originalParentAllocation(); originalParentCaseReceipt(); originalParentWorkerQualification();
    const at = clock.point(); c.caseRef = o.coordinator.beginCase({ allocation, at }); o.lastNs = at.monotonic_ns;
    const pipe = () => ({ present: false, end_seen: false, finish_seen: false, close_seen: false, error: null });
    c.facts = { schema: "native-bar-parent-terminal-facts-v1", clock_domain: clock.binding.clock_domain, first_stop: null, clock_invalid: false,
      launch: { reserved: true, attempted: false, returned: false }, pending_generation: null, commands: [],
      child: { error: null, exit: null, close: null }, pipes: { command: pipe(), status: pipe(), stdout: pipe(), stderr: pipe() },
      command_end: { decision: "not_requested", outcome: null }, timers: { phase: null, operation: null },
      helper: { active: false, under_command_generation: null }, discarded_input: { frames: 0, bytes: 0, saturated: false }, secondary_errors: [] };
    c.decoder = createUnsignedProtocolDecoder();
    const ref = Object.freeze(Object.create(null)); parentSessions.set(ref, c); return ref;
  }
  function currentOriginalParentSession(ref) {
    const c = parentSessions.get(ref);
    if (!c || c.owner.active !== c || c.owner.generation !== c.generation || !c.caseRef) refuse("parent_session_reference");
    originalParentScope(c.owner.s, c.owner.buildRef, c.owner.namespaceRef, true); return c;
  }
  function syncOriginalParent(c) {
    let d = c.owner.coordinator.describe();
    if (!d.stopped && (c.owner.s.stopped || c.owner.s.phase === "STOPPED" || c.owner.s.evidenceTainted)) {
      c.owner.coordinator.noteOwnerStop(c.caseRef); d = c.owner.coordinator.describe();
    }
    if (d.stopped) {
      c.facts.first_stop ??= { reason: d.stop_reason, at: d.first_stop_ns === null ? null
        : { clock_domain: c.facts.clock_domain, monotonic_ns: d.first_stop_ns } };
      c.owner.s.stopped ??= "cc4b3b_parent_stopped";
    }
    c.facts.clock_invalid ||= d.clock_invalid; return d;
  }
  function describeOriginalParent(ref) {
    const c = currentOriginalParentSession(ref), admission = syncOriginalParent(c);
    return freeze({ admission, terminal: validateUnsignedParentTerminalFacts(c.facts) });
  }
  function checkpointOriginalParent(c) {
    const o = c.owner, d = syncOriginalParent(c); if (d.stopped) return null;
    let at;
    try { at = clock.point(); }
    catch {
      const failure = clock.describe();
      if (!failure.clock_invalid && failure.stop_ns === clock.end_ns) at = { clock_domain: clock.binding.clock_domain, monotonic_ns: clock.end_ns };
      else { o.coordinator.noteClockFailure(c.caseRef, { reason: "clock_unavailable" }); syncOriginalParent(c); return null; }
    }
    const command = c.facts.commands.find(v => v.generation === c.facts.pending_generation);
    let q;
    try {
      q = planUnsignedParentCheckpoint({ clock_domain: clock.binding.clock_domain, last_b2_ns: o.lastNs, at,
        phase_deadline_ns: d.active.window.phase_deadline_ns, cohort_deadline_ns: d.cohort_deadline_ns,
        pending: command ? { reservation: command.reservation, started: command.started } : null, stopped: false, clock_invalid: false });
    } catch (error) {
      o.coordinator.noteClockFailure(c.caseRef, { reason: "clock_malformed" }); syncOriginalParent(c); throw error;
    }
    if (q.clock_failure) { o.coordinator.noteClockFailure(c.caseRef, { reason: q.clock_failure }); syncOriginalParent(c); return null; }
    if (q.stop_first) {
      o.coordinator.stop(q.stop_first); o.lastNs = q.stop_first.at.monotonic_ns;
      if (q.pending_disposition === "uncertain" && command.decision === "started") {
        command.decision = "uncertain";
        o.coordinator.applyModelEvent(c.caseRef, { kind: command.shutdown ? "shutdown_write" : "write",
          payload: command.shutdown ? { outcome: "uncertain" } : { ordinal: command.ordinal, outcome: "uncertain" }, at: q.stop_first.at });
      }
      syncOriginalParent(c); return null;
    }
    // Preserve B2's existing full-ms phase window, including its observation-time stop below 1 ms.
    const limit = BigInt(d.active.window.phase_deadline_ns) < BigInt(d.cohort_deadline_ns)
      ? BigInt(d.active.window.phase_deadline_ns) : BigInt(d.cohort_deadline_ns);
    if (limit - BigInt(q.forward_at.monotonic_ns) < 1000000n) {
      o.lastNs = q.forward_at.monotonic_ns; o.coordinator.stop({ reason: "deadline", at: q.forward_at });
      syncOriginalParent(c); return null;
    }
    return q.forward_at;
  }
  function faultOriginalParent(c, reason) {
    const at = checkpointOriginalParent(c);
    if (at) { c.owner.lastNs = at.monotonic_ns; c.owner.coordinator.stop({ reason, at }); }
    syncOriginalParent(c);
    c.owner.coordinator.endLateFrames(c.caseRef, { reason }); c.intakeClosed = true;
  }
  function discardOriginalParent(c, frames = 0, bytes = 0, unknown = false) {
    const next = summarizeUnsignedParentDiscard({ counter: c.facts.discarded_input, frames, bytes }).counter;
    c.facts.discarded_input = unknown ? { ...next, saturated: true } : next;
  }
  function discardOriginalParentBytes(c, chunk) {
    let bytes = null;
    try { bytes = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength").get.call(chunk); } catch { /* No property getter or decode fallback. */ }
    if (bytes !== 0) discardOriginalParent(c, 0, bytes ?? 0, true); return bytes;
  }
  function receiveOriginalParent(ref, status, chunk) {
    const c = currentOriginalParentSession(ref), o = c.owner;
    if (!status || status !== c.pipes.status) refuse("parent_status_reference");
    if (c.receiveBusy) refuse("parent_receive_reentrant"); c.receiveBusy = true;
    try {
      const d = syncOriginalParent(c), capture = d.active.late_capture;
      if (c.intakeClosed || d.active.frames >= 32 || d.stopped && (capture !== "open" || d.active.late_count >= 4)) {
        const bytes = discardOriginalParentBytes(c, chunk);
        if (c.intakeClosed && bytes === 0) return describeOriginalParent(ref);
        if (!d.stopped) {
          const at = checkpointOriginalParent(c);
          if (at) { o.lastNs = at.monotonic_ns; o.coordinator.stop({ reason: c.intakeClosed ? "stream_closed" : "frame_capacity", at }); }
        }
        if (capture === "open" || !d.stopped || capture === "ended" && bytes !== 0)
          try { o.coordinator.observeLateFrame(c.caseRef, { line: "" }); } catch { /* Closed/capacity refusal precedes parsing. */ }
        c.intakeClosed = true; return describeOriginalParent(ref);
      }
      let lines;
      try { lines = c.decoder.push(chunk); }
      catch { faultOriginalParent(c, "decoder_failure"); return describeOriginalParent(ref); }
      for (let index = 0; index < lines.length; index++) {
        try {
          const at = checkpointOriginalParent(c);
          if (at) {
            o.lastNs = at.monotonic_ns; o.coordinator.applyModelEvent(c.caseRef, { kind: "worker_frame", payload: { line: lines[index] }, at });
          } else o.coordinator.observeLateFrame(c.caseRef, { line: lines[index] });
        } catch {
          syncOriginalParent(c); c.intakeClosed = true;
          discardOriginalParent(c, lines.length - index - 1); break;
        }
      }
      const captureAfter = o.coordinator.describe().active.late_capture, pendingBytes = c.decoder.describe().pending_bytes;
      if (pendingBytes > 0 && (c.intakeClosed || ["ended", "frozen", "refused"].includes(captureAfter))) {
        discardOriginalParent(c, 0, pendingBytes, true); c.intakeClosed = true;
        if (captureAfter === "ended")
          try { o.coordinator.observeLateFrame(c.caseRef, { line: "" }); } catch { /* Reject the already-decoded terminal suffix without parsing it. */ }
      }
      return describeOriginalParent(ref);
    } finally { c.receiveBusy = false; }
  }
  function endOriginalParent(ref, status) {
    const c = currentOriginalParentSession(ref);
    if (!status || status !== c.pipes.status) refuse("parent_status_reference");
    if (c.receiveBusy) refuse("parent_receive_reentrant");
    const d = syncOriginalParent(c);
    if (c.intakeClosed || ["frozen", "refused", "ended"].includes(d.active.late_capture)) return describeOriginalParent(ref);
    try { c.decoder.end(); }
    catch { faultOriginalParent(c, "truncated_frame"); return describeOriginalParent(ref); }
    if (!d.stopped && ["FINALIZING", "DONE"].includes(d.active.protocol_state) && checkpointOriginalParent(c)) c.intakeClosed = true;
    else faultOriginalParent(c, "stream_closed");
    return describeOriginalParent(ref);
  }
  function recordOriginalParentTerminal(ref, original, slot, event, payload = null) {
    const c = currentOriginalParentSession(ref), child = slot === "child";
    if (!["child", "command", "status", "stdout", "stderr"].includes(slot) || !original
      || (child ? c.child : c.pipes[slot]) !== original) refuse("parent_terminal_reference");
    const old = child ? c.facts.child : c.facts.pipes[slot];
    const field = event === "error" ? "error" : child && ["exit", "close"].includes(event) ? event
      : !child && ["end", "finish", "close"].includes(event) ? event + "_seen" : null;
    if (!field) refuse("parent_terminal_event");
    if (child && event !== "error" && payload === null) refuse("parent_terminal_event");
    if (old[field] !== null && old[field] !== false) return describeOriginalParent(ref);
    const value = event === "error" ? "parent_terminal_error" : child ? payload : true;
    const changed = { ...old, [field]: value }, proposed = child ? { ...c.facts, child: changed }
      : { ...c.facts, pipes: { ...c.facts.pipes, [slot]: changed } };
    const checked = validateUnsignedParentTerminalFacts(proposed).facts;
    if (child) c.facts.child = checked.child; else c.facts.pipes = checked.pipes;
    if (slot === "status" && event === "error") { faultOriginalParent(c, "decoder_failure"); return describeOriginalParent(ref); }
    if (slot === "status" && ["end", "close"].includes(event)) return endOriginalParent(ref, original);
    const d = syncOriginalParent(c);
    if (!d.stopped && !["FINALIZING", "DONE"].includes(d.active.protocol_state)) {
      const at = checkpointOriginalParent(c);
      if (at) { c.owner.lastNs = at.monotonic_ns; c.owner.coordinator.stop({ reason: "parent_terminal_event", at }); }
    }
    return describeOriginalParent(ref);
  }
  function prepareOriginalParentCommand(ref, kind) {
    const c = currentOriginalParentSession(ref);
    if (kind === "LAUNCH") refuse("qualified_worker_closure_unavailable");
    if (kind === "PREPARE") refuse("original_sealed_setup_unavailable");
    if (kind === "GO") refuse("original_go_readback_proofs_unavailable");
    if (kind === "CANCEL") refuse(c.owner.coordinator.describe().stopped ? "original_shutdown_authority_unavailable" : "original_cancellation_decision_unavailable");
    if (kind === "FINALIZE") refuse("original_teardown_proofs_unavailable");
    refuse("parent_command_kind");
  }
  function verifyOriginalHostClosure() { throw Error("cc4b3b_host_closure_qualification_unavailable"); }
  function verifyOriginalNativeProfile() { throw Error("cc4b3b_signature_qualification_unavailable"); }
  function refuse(reason) { throw Error(`cc4b3b_${reason}`); }
  function code(error) { return typeof error?.message === "string" && error.message.length <= 96 && /^cc4b3[bc]_[a-z_]+$/.test(error.message) ? error.message : "cc4b3b_operation_failed"; }
  function stop(s, error, evidence = false) { s.stopped ??= code(error); s.phase = "STOPPED"; s.evidenceTainted ||= evidence; return error; }
  function checkpoint(s, evidence = false) {
    if (s.stopped || evidence && s.evidenceTainted) refuse("stopped");
    clock.check();
  }
  // A timer cannot interrupt a blocked synchronous OS call, so its late return stops before the next action.
  function afterSync(s, value) { checkpoint(s); return value; }
  function newQualificationState() {
    if (retainedQualificationScopes.size) refuse("invocation_retained");
    const s = { phase: "NEW", stopped: null, evidenceTainted: false, output: path.join(root, "build/b3cc-validation"), rootOwned: false,
      handles: new Map(), directories: new Map(), pins: new Map(), aliases: new Map(), helper: null, helperDisposition: null, children: new Set(),
      qualificationTimer: null, timerGeneration: 0, timerDisposition: null, timerCancelUnknown: false,
      hashBytes: 0n, passBytes: 0n, commands: 0, discoveryCommands: 0, recordIoBytes: 0, failures: [], recordClosed: false, closureReads: new Map(),
      environment: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", TZ: "Asia/Tokyo", XCRUN_CACHE_DISABLED: "1" },
      commandDigest: digest([]), inputs: null, artifacts: null, record: null, recordHash: null, recordIdentity: null };
    retainedQualificationScopes.add(s); return s;
  }
  function ownHandle(s, fd, file, kind) {
    const reference = Object.freeze(Object.create(null)), handle = { fd, file, kind, closeAttempted: false, initial: null };
    s.handles.set(reference, handle); return reference;
  }
  function closeOriginal(s, reference) {
    const h = s.handles.get(reference); if (!h || h.closeAttempted) refuse("close_once");
    h.closeAttempted = true;
    try { if (h.kind === "directory_stream") h.fd.closeSync(); else fs.closeSync(h.fd); s.handles.delete(reference); }
    catch (error) { if (s.failures.length < 8) s.failures.push("close_unknown"); throw stop(s, error); }
  }
  function closeRemaining(s) {
    for (const [reference, h] of s.handles) if (!h.closeAttempted) {
      try { closeOriginal(s, reference); } catch { /* Keep original unknown-close handles, without retry. */ }
    }
  }
  function identity(stat) {
    return Object.fromEntries(["dev", "ino", "uid", "gid", "mode", "size", "nlink", "ctimeNs", "mtimeNs"].map(k => [k, String(stat[k])]));
  }
  function sameIdentity(a, b, directory = false) {
    return (directory ? ["dev", "ino", "uid", "gid", "mode"] : Object.keys(a)).every(k => a[k] === b[k]);
  }
  function safeStat(stat, owned, mode, directory) {
    const uid = BigInt(process.getuid());
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || ![0n, uid].includes(stat.uid)
      || (stat.mode & 0o7022n) !== 0n || owned && stat.uid !== uid || mode !== null && (stat.mode & 0o7777n) !== mode
      || !directory && stat.nlink !== 1n) refuse("unsafe_metadata");
  }
  function fixedChain(file) {
    const chain = []; for (let p = path.resolve(file); ; p = path.dirname(p)) { chain.push(p); if (p === path.dirname(p)) break; }
    if (chain.length > limits.namespace_nodes) refuse("chain_bound"); return chain.reverse();
  }
  function metadataText(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > limits.acl_bytes) refuse("metadata_bound");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.endsWith("\n") || /[\r\0]/.test(text)) refuse("metadata_encoding"); return text.slice(0, -1).split("\n");
  }
  function parseMetadataListing(bytes, file, flags) {
    const lines = metadataText(bytes);
    if (lines.length < 1 || lines.length > limits.acl_entries + 1 || !lines[0].endsWith(` ${file}`)) refuse("metadata_listing");
    // Reject unknown columns, named flags and allow/inherited-allow ACLs rather than guessing their meaning.
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const head = new RegExp(`^[d-][rwxStTs-]{9}[+@]? +[0-9]+ +[^ ]+ +[^ ]+${flags ? " +-" : ""} +[0-9]+ +[^ ]+ +[0-9]+ +[0-9:]+ ${escaped}$`);
    if (!head.test(lines[0]) || lines.slice(1).some(line => !/^ +[0-9]+: [^\r\n]+ deny [a-z_,]+$/.test(line))) refuse("metadata_listing");
    return digest(lines.slice(1));
  }
  async function qualifyMetadata(s, file, owned = false, mode = null, directory = true) {
    checkpoint(s); const before = afterSync(s, fs.lstatSync(file, { bigint: true })); safeStat(before, owned, mode, directory);
    const acl = await runOriginalTool(s, "/bin/ls", ["-lde", file], "metadata");
    const aclHash = parseMetadataListing(acl, file, false); checkpoint(s);
    const flagged = await runOriginalTool(s, "/bin/ls", ["-ldeO", file], "metadata");
    if (parseMetadataListing(flagged, file, true) !== aclHash) refuse("metadata_changed"); checkpoint(s);
    const after = afterSync(s, fs.lstatSync(file, { bigint: true })); safeStat(after, owned, mode, directory);
    const pin = identity(after);
    if (!sameIdentity(identity(before), pin, directory)) refuse("metadata_changed");
    return { identity: pin, aclHash };
  }
  async function qualifyChain(s, file) {
    const chain = fixedChain(file);
    for (const p of chain) {
      const owned = p === s.output || s.directories.has(p), q = await qualifyMetadata(s, p, owned, owned ? 0o700n : null);
      const original = s.directories.get(p);
      if (original) {
        const h = s.handles.get(original.reference); if (!h || h.closeAttempted) refuse("directory_handle");
        if (!sameIdentity(original.identity, q.identity, true) || !sameIdentity(q.identity, identity(afterSync(s, fs.fstatSync(h.fd, { bigint: true }))), true)) refuse("directory_identity");
      }
    }
  }
  async function createOriginalDirectory(s, file) {
    await qualifyChain(s, path.dirname(file)); checkpoint(s);
    // mkdir is exclusive; an existing path blocks rather than being adopted or repaired.
    fs.mkdirSync(file, { mode: 0o700 });
    if (file === s.output) s.rootOwned = true;
    // Record each new resource before checking a late return, so it is retained or closed rather than lost.
    const known = { reference: null, identity: null }; s.directories.set(file, known); checkpoint(s);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    known.reference = ownHandle(s, fd, file, "directory"); checkpoint(s);
    const q = await qualifyMetadata(s, file, true, 0o700n); known.identity = q.identity;
    if (!sameIdentity(q.identity, identity(afterSync(s, fs.fstatSync(fd, { bigint: true }))), true)) refuse("directory_identity");
  }
  function allowedTool(s, program, args, kind) {
    if (kind === "metadata") return program === "/bin/ls" && args.length === 2 && ["-lde", "-ldeO"].includes(args[0]) && path.isAbsolute(args[1]);
    return s.toolPlans?.some(p => p.program === program && p.kind === kind && canonical(p.args) === canonical(args)) === true;
  }
  async function runOriginalTool(s, program, args, kind) {
    checkpoint(s); if (s.helper || !allowedTool(s, program, args, kind) || ++s.commands > limits.helper_commands) refuse("tool_plan");
    if (kind === "discovery" && ++s.discoveryCommands > limits.discovery_commands) refuse("discovery_bound");
    const commandOrdinal = s.commands;
    const { spawn } = await import("node:child_process"); checkpoint(s);
    if (s.helper) refuse("tool_busy");
    return new Promise((resolve, reject) => {
      let child = null, done = false, closed = false, count = 0; const out = [], err = [];
      const fail = reason => {
        if (done) return; done = true; const error = stop(s, Error(`cc4b3b_${reason}`)); timer.cancel();
        child?.stdout?.pause(); child?.stderr?.pause(); out.length = 0; err.length = 0;
        reject(error);
      };
      // Only an original deadline is reported as one; any other timer stop keeps its cause in s.stopped.
      const timer = armOriginalQualificationTimer(s, kind, reason => fail(/^cc4b3c_(?:timer|entry)_deadline$/.test(reason) ? "tool_deadline" : "tool_timer_stop"));
      if (!timer.hasRef()) { const error = stop(s, Error("cc4b3b_timer_unreferenced")); timer.cancel(); throw error; }
      try { checkpoint(s); timer.check(); } catch (error) { stop(s, error); return fail("tool_start"); }
      try {
        child = spawn(program, args, { cwd: root, env: s.environment, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true });
        s.helper = child; s.children.add(child);
        child.on("error", () => fail("tool_start"));
        child.on("close", (exitCode, signal) => {
          if (closed) return; closed = true;
          // A close after stop reads no clock; one arriving before its pending expiry callback is late by the same check.
          let late = done;
          if (!late) try { checkpoint(s); timer.check(); } catch (error) { stop(s, error); late = true; }
          const exitKnown = exitCode === null || Number.isSafeInteger(exitCode), signalKnown = signal === null || typeof signal === "string" && /^SIG[A-Z0-9]{1,12}$/.test(signal);
          s.helperDisposition = Object.freeze({ command_ordinal: commandOrdinal, exit_code: exitKnown ? exitCode : null,
            signal: signalKnown ? signal : null, known: exitKnown && signalKnown, late });
          s.children.delete(child); if (s.helper === child) s.helper = null;
          if (late) return fail("tool_completion");
          try {
            const stdout = Buffer.concat(out), stderr = Buffer.concat(err);
            s.commandDigest = digest({ previous: s.commandDigest, program, args, exit_code: exitCode, signal, stdout: hash(stdout), stderr: hash(stderr) });
            if (exitCode !== 0 || signal !== null || stderr.length && kind === "metadata") return fail("tool_exit");
            done = true; timer.cancel(); if (s.stopped) reject(Error(s.stopped)); else resolve(stdout);
          } catch (error) { stop(s, error); fail("tool_completion"); }
        });
        if (!child.stdout || !child.stderr) return fail("tool_pipe");
        for (const [stream, chunks] of [[child.stdout, out], [child.stderr, err]]) {
          stream.on("error", () => fail("tool_pipe"));
          stream.on("data", bytes => {
            if (done) return;
            try { checkpoint(s); timer.check(); } catch (error) { stop(s, error); return fail("tool_completion"); }
            count += bytes.length;
            if (count > limits.tool_capture_bytes) return fail("tool_output_bound"); chunks.push(Buffer.from(bytes));
          });
        }
      } catch { fail("tool_start"); }
    });
  }
  function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
  function chargeHash(s, count) {
    s.hashBytes += BigInt(count); s.passBytes += BigInt(count);
    if (s.hashBytes > BigInt(limits.hash_work_bytes) || s.passBytes > BigInt(limits.pass_bytes)) refuse("hash_work_bound");
  }
  function readPinnedFile(s, file, expected = null, keep = false) {
    checkpoint(s); const before = afterSync(s, fs.lstatSync(file, { bigint: true })); safeStat(before, false, null, false);
    if (before.size > BigInt(limits.file_bytes)) refuse("file_bound");
    if (expected && !sameIdentity(expected, identity(before))) refuse("input_changed");
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK), reference = ownHandle(s, fd, file, "input");
    let result, primary = null;
    try {
      checkpoint(s);
      if (!sameIdentity(identity(before), identity(afterSync(s, fs.fstatSync(fd, { bigint: true }))))) refuse("input_changed");
      const accumulator = crypto.createHash("sha256"), buffer = Buffer.alloc(limits.hash_buffer_bytes), chunks = []; let offset = 0;
      while (BigInt(offset) < before.size) {
        checkpoint(s); const length = Number(before.size - BigInt(offset) < BigInt(buffer.length) ? before.size - BigInt(offset) : BigInt(buffer.length));
        chargeHash(s, length); const n = afterSync(s, fs.readSync(fd, buffer, 0, length, offset));
        if (n < 1 || n > length) refuse("input_read");
        accumulator.update(buffer.subarray(0, n)); if (keep) chunks.push(Buffer.from(buffer.subarray(0, n))); offset += n;
      }
      if (afterSync(s, fs.readSync(fd, buffer, 0, 1, offset)) !== 0 || !sameIdentity(identity(before), identity(afterSync(s, fs.fstatSync(fd, { bigint: true }))))
        || !sameIdentity(identity(before), identity(afterSync(s, fs.lstatSync(file, { bigint: true }))))) refuse("input_changed");
      result = { path: file, identity: identity(before), bytes: String(offset), sha256: accumulator.digest("hex"), ...(keep ? { content: Buffer.concat(chunks) } : {}) };
    } catch (error) { primary = error; }
    try { closeOriginal(s, reference); } catch (error) { primary ??= error; }
    if (primary) throw primary; return afterSync(s, result);
  }
  function dependencyPaths(bytes) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\\\n/g, " ");
    if (!text.startsWith("qualification:") || /[\r\0$#\\]/.test(text)) refuse("dependency_format");
    const names = text.slice("qualification:".length).trim().split(/\s+/);
    if (!names.length || names.length > limits.manifest_rows || names.some(p => !/^(?:\/)?[A-Za-z0-9_@+.-]+(?:\/[A-Za-z0-9_@+.-]+)*$/.test(p)
      || p.split("/").some(v => v === "." || v === ".."))) refuse("dependency_format");
    return [...new Set(names.map(p => path.resolve(root, p)))].sort();
  }
  function typescriptPaths(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > limits.tool_capture_bytes) refuse("typescript_closure");
    const names = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimEnd().split("\n");
    if (!names.length || names.length > limits.manifest_rows || names.some(file => file.length > 512 || !path.isAbsolute(file) || !contained(root, file))) refuse("typescript_closure");
    return [...new Set(names)].sort();
  }
  async function recheckTypeScriptInputs(s, inputs) {
    const args = [path.join(root, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json", "--listFilesOnly"];
    const listed = typescriptPaths(await runOriginalTool(s, s.tools.node, args, "discovery"));
    if (canonical(listed) !== canonical(inputs.typed)) refuse("typescript_closure_changed");
  }
  function contained(base, file) { const rel = path.relative(base, file); return rel !== "" && !rel.startsWith("../") && !path.isAbsolute(rel); }
  function byteLengthRows(rows) { return Buffer.byteLength(canonical(rows)); }
  function directoryNames(s, file) {
    checkpoint(s); const stream = fs.opendirSync(file, { bufferSize: 32 }), ref = ownHandle(s, stream, file, "directory_stream"), names = [];
    let primary = null;
    try {
      checkpoint(s);
      for (let entry; (entry = afterSync(s, stream.readSync())) !== null;) {
        if (names.length >= limits.manifest_rows || entry.name.length > 512 || !/^[A-Za-z0-9_@+.-]+$/.test(entry.name) || [".", ".."].includes(entry.name)) refuse("directory_bound");
        names.push(entry.name);
      }
    } catch (error) { primary = error; }
    try { closeOriginal(s, ref); } catch (error) { primary ??= error; }
    if (primary) throw primary; return afterSync(s, names.sort());
  }
  function sourceFiles(s) {
    const files = []; let entries = 0;
    function visit(file) {
      if (++entries > limits.manifest_rows * 2 || file.length > 512) refuse("source_bound");
      const st = afterSync(s, fs.lstatSync(file, { bigint: true }));
      if (st.isSymbolicLink()) refuse("source_alias");
      if (st.isDirectory()) { for (const name of directoryNames(s, file)) visit(path.join(file, name)); }
      else if (st.isFile()) { if (files.length >= limits.manifest_rows) refuse("manifest_rows"); files.push(file); }
      else refuse("source_type");
    }
    for (const rel of ["src", "native/native_bar_fs", "test/helpers", "tsconfig.json", "package.json", "package-lock.json"]) visit(path.join(root, rel));
    return files.sort();
  }
  function runtimeClosure(s, seeds) {
    const pending = [...seeds], files = new Set();
    while (pending.length) {
      const file = pending.pop(); if (files.has(file)) continue;
      if (files.size >= limits.manifest_rows || !contained(root, file)) refuse("runtime_closure"); files.add(file);
      const read = readPinnedFile(s, file, null, true), text = new TextDecoder("utf-8", { fatal: true }).decode(read.content);
      s.pins.set(file, read.identity); s.closureReads.set(file, read.sha256);
      const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      if (tree.parseDiagnostics.length) refuse("runtime_closure");
      function moduleName(specifier) {
        if (typeof specifier !== "string") refuse("runtime_resolution");
        if (builtinModules.includes(specifier) || specifier.startsWith("node:") && builtinModules.includes(specifier.slice(5))) return;
        let target;
        if (specifier === "zod") target = path.join(root, "node_modules/zod/index.js");
        else if (specifier === "typescript") target = path.join(root, "node_modules/typescript/lib/typescript.js");
        else if (specifier.startsWith("./") || specifier.startsWith("../")) target = path.resolve(path.dirname(file), specifier);
        else refuse("runtime_resolution");
        if (!target.endsWith(".js") && !target.endsWith(".mjs")) refuse("runtime_resolution");
        if (!files.has(target) && !pending.includes(target)) {
          if (pending.length + files.size >= limits.manifest_rows) refuse("runtime_closure"); pending.push(target);
        }
      }
      function walk(n) {
        if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) moduleName(n.moduleSpecifier.text);
        if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(n.expression) && n.expression.text === "require")) {
          if (n.arguments.length !== 1 || !ts.isStringLiteral(n.arguments[0])) refuse("runtime_resolution"); moduleName(n.arguments[0].text);
        }
        ts.forEachChild(n, walk);
      }
      walk(tree);
    }
    return [...files].sort();
  }
  async function discoverOriginalInputs(s) {
    s.toolPlans = [
      { program: "/usr/bin/xcrun", args: ["--no-cache", "--find", "clang++"], kind: "discovery" },
      { program: "/usr/bin/xcrun", args: ["--no-cache", "--sdk", "macosx", "--show-sdk-path"], kind: "discovery" },
      { program: "/usr/bin/git", args: ["-c", "core.fsmonitor=false", "--no-optional-locks", "rev-parse", "HEAD"], kind: "discovery" },
      { program: "/usr/bin/git", args: ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "src", "native/native_bar_fs", "test/helpers", "tsconfig.json", "package.json", "package-lock.json"], kind: "discovery" },
    ];
    const text = b => new TextDecoder("utf-8", { fatal: true }).decode(b).trim();
    const compilerLaunch = text(await runOriginalTool(s, s.toolPlans[0].program, s.toolPlans[0].args, "discovery"));
    const sdkLaunch = text(await runOriginalTool(s, s.toolPlans[1].program, s.toolPlans[1].args, "discovery"));
    function hostPath(launch) {
      if (!path.isAbsolute(launch) || launch.length > 512) refuse("host_path"); const target = afterSync(s, fs.realpathSync(launch));
      if (target.length > 512) refuse("host_path");
      s.aliases.set(launch, { target, identity: identity(afterSync(s, fs.lstatSync(launch, { bigint: true }))) }); return target;
    }
    const compiler = hostPath(compilerLaunch), sdk = hostPath(sdkLaunch), node = hostPath(process.execPath), headers = path.resolve(path.dirname(node), "../include/node");
    const extra = ["-print-prog-name=ld", "-print-file-name=libclang_rt.ubsan_osx_dynamic.dylib", "-print-resource-dir"];
    for (const flag of extra) s.toolPlans.push({ program: compiler, args: [flag], kind: "discovery" });
    const linker = hostPath(text(await runOriginalTool(s, compiler, [extra[0]], "discovery")));
    const ubsan = hostPath(text(await runOriginalTool(s, compiler, [extra[1]], "discovery")));
    const resource = hostPath(text(await runOriginalTool(s, compiler, [extra[2]], "discovery")));
    const commit = text(await runOriginalTool(s, s.toolPlans[2].program, s.toolPlans[2].args, "discovery"));
    if (!/^[a-f0-9]{40}$/.test(commit)) refuse("source_commit");
    const status = await runOriginalTool(s, s.toolPlans[3].program, s.toolPlans[3].args, "discovery");
    const tsc = path.join(root, "node_modules/typescript/bin/tsc"), tscArgs = [tsc, "--project", "tsconfig.json", "--listFilesOnly"];
    s.toolPlans.push({ program: node, args: tscArgs, kind: "discovery" });
    const typed = typescriptPaths(await runOriginalTool(s, node, tscArgs, "discovery"));
    const sources = sourceFiles(s), runtime = runtimeClosure(s, [path.join(root, "test/helpers/unsignedCohortRuntime.mjs"),
      path.join(root, "native/native_bar_fs/test_unsigned_cohort_worker.mjs"), path.join(root, "node_modules/zod/index.js")]);
    const dependencies = [];
    s.tools = { compiler, sdk, headers, node, linker, ubsan, resource };
    for (const mode of ["normal", "ubsan"]) for (const kind of ["addon", "observer"]) {
      const source = kind === "addon" ? "native/native_bar_fs/native_bar_fs.cc" : "native/native_bar_fs/admission_unsigned_observer.cc";
      const args = ["-std=c++17", "-fno-modules", "-isysroot", sdk, "-I", headers, "-DNAPI_VERSION=8", "-DNATIVE_BAR_SYNTHETIC_ONLY=1",
        ...(mode === "ubsan" ? ["-fsanitize=undefined", "-fno-sanitize-recover=all"] : []), "-M", "-MT", "qualification", source];
      s.toolPlans.push({ program: compiler, args, kind: "discovery" });
      const discovered = dependencyPaths(await runOriginalTool(s, compiler, args, "discovery"));
      if (discovered.some(p => ![root, sdk, headers, resource].some(base => contained(base, p)))) refuse("compiler_closure");
      dependencies.push(...discovered); s[`${mode}_${kind}_dependencies`] = digest(discovered);
    }
    const packageFiles = ["node_modules/zod/package.json", "node_modules/typescript/package.json", "node_modules/typescript/lib/typescript.js", "node_modules/typescript/lib/tsc.js", "node_modules/typescript/lib/_tsc.js"].map(p => path.join(root, p));
    const helpers = ["/bin/ls", "/usr/bin/xcrun", "/usr/bin/git"];
    const files = [...new Set([...sources, ...runtime, ...typed, tsc, ...packageFiles, ...helpers, node, compiler, linker, ubsan, path.join(sdk, "SDKSettings.json"), ...dependencies])].sort();
    if (files.length > limits.manifest_rows || s.discoveryCommands > limits.discovery_commands) refuse("input_closure_bound");
    const roleMap = new Map(files.map(file => [file, new Set()]));
    for (const [role, list] of [["source", sources], ["runtime", [...runtime, ...packageFiles]], ["typescript", [...typed, tsc]],
      ["node", [node]], ["compiler", [compiler]], ["linker", [linker]], ["ubsan", [ubsan]], ["sdk_settings", [path.join(sdk, "SDKSettings.json")]],
      ["tool", helpers], ["compiler_dependency", dependencies]]) for (const file of list) roleMap.get(file).add(role);
    s.sourceIdentity = { commit, dirty: status.length !== 0, status_sha256: hash(status), node_launch: process.execPath, node, node_version: process.version,
      node_abi: process.versions.modules, architecture: process.arch, system_library_profile: "controlled_local_os_shared_cache_assumption" };
    return { files, sources, runtime, typed, roleMap };
  }
  async function snapshotInputs(s, inputs) {
    await recheckTypeScriptInputs(s, inputs);
    s.passBytes = 0n; const rows = [];
    for (const file of inputs.files) {
      await qualifyMetadata(s, file, false, null, false);
      const row = { ...readPinnedFile(s, file, s.pins.get(file) ?? null), roles: [...inputs.roleMap.get(file)].sort() };
      if (s.closureReads.has(file) && s.closureReads.get(file) !== row.sha256) refuse("runtime_closure_changed");
      if (byteLengthRows([...rows, row]) > limits.manifest_bytes) refuse("manifest_bound");
      rows.push(row); s.pins.set(file, row.identity);
    }
    for (const [launch, pin] of s.aliases) if (afterSync(s, fs.realpathSync(launch)) !== pin.target || !sameIdentity(pin.identity, identity(afterSync(s, fs.lstatSync(launch, { bigint: true }))) )) refuse("alias_changed");
    if (canonical(sourceFiles(s)) !== canonical(inputs.sources)) refuse("source_set_changed");
    await recheckTypeScriptInputs(s, inputs);
    const snapshot = { rows, sha256: digest(rows) };
    if (s.inputs && s.inputs.sha256 !== snapshot.sha256) refuse("input_changed"); return snapshot;
  }
  function compilePlans(s, mode) {
    const p = describeUnsignedIsolatedBuild(mode), expand = args => args.map(v => v === "$SDK" ? s.tools.sdk : v === "$HEADERS" ? s.tools.headers : v);
    const native = (kind) => {
      const args = expand(p[kind]); if (args.filter(v => v === "-Wl,-no_adhoc_codesign").length !== 1) refuse("build_profile");
      return [...args.filter(v => v !== "-Wl,-no_adhoc_codesign"), "-MD", "-MF", path.join(s.output, `scratch/${mode}-${kind}.d`), "-MT", "qualification"];
    };
    return [{ program: s.tools.node, args: p.typescript, kind: "compiler" }, ...["addon", "observer"].map(kind => ({ program: s.tools.compiler, args: native(kind), kind: "compiler" }))];
  }
  async function buildOriginalMode(s, mode, inputs) {
    await createOriginalDirectory(s, path.join(s.output, mode)); await createOriginalDirectory(s, path.join(s.output, mode, "native-bar-fs"));
    const before = await snapshotInputs(s, inputs); s.inputs ??= before;
    const plans = compilePlans(s, mode); s.toolPlans.push(...plans);
    for (const plan of plans) await runOriginalTool(s, plan.program, plan.args, plan.kind);
    for (const kind of ["addon", "observer"]) {
      const dep = path.join(s.output, `scratch/${mode}-${kind}.d`), row = readPinnedFile(s, dep, null, true);
      if (digest(dependencyPaths(row.content)) !== s[`${mode}_${kind}_dependencies`]) refuse("compiler_closure_changed");
    }
    if ((await snapshotInputs(s, inputs)).sha256 !== s.inputs.sha256) refuse("input_changed");
  }
  async function snapshotArtifacts(s, inputs) {
    if (!s.rootOwned) refuse("original_output_required");
    const rows = [], expected = inputs.sources.filter(p => contained(path.join(root, "src"), p) && p.endsWith(".ts") && !p.endsWith(".d.ts"))
      .map(p => path.relative(path.join(root, "src"), p).slice(0, -3) + ".js").sort();
    let entries = 0;
    for (const mode of ["normal", "ubsan"]) {
      const base = path.join(s.output, mode), found = [];
      await qualifyChain(s, base);
      async function visit(file) {
        checkpoint(s); if (++entries > limits.manifest_rows * 2 || file.length > 512) refuse("artifact_bound");
        const st = afterSync(s, fs.lstatSync(file, { bigint: true }));
        if (st.isDirectory() && !st.isSymbolicLink()) {
          await qualifyMetadata(s, file, true, 0o700n); for (const name of directoryNames(s, file)) await visit(path.join(file, name)); return;
        }
        const rel = path.relative(base, file), kind = rel === "native-bar-fs/native_bar_fs.node" ? "addon" : rel === "admission-unsigned-observer" ? "observer" : "js";
        if (kind === "js" && !expected.includes(rel)) refuse("artifact_set");
        if (kind === "addon" && st.mode === 0o100700n) {
          const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW), ref = ownHandle(s, fd, file, "new_addon");
          let primary = null;
          try {
            checkpoint(s); const opened = afterSync(s, fs.fstatSync(fd, { bigint: true })); safeStat(opened, true, 0o700n, false);
            if (!sameIdentity(identity(opened), identity(afterSync(s, fs.lstatSync(file, { bigint: true }))))) refuse("artifact_identity");
            fs.fchmodSync(fd, 0o600); checkpoint(s);
          } catch (error) { primary = error; }
          try { closeOriginal(s, ref); } catch (error) { primary ??= error; }
          if (primary) throw primary;
        }
        await qualifyMetadata(s, file, true, kind === "observer" ? 0o700n : 0o600n, false);
        const row = readPinnedFile(s, file, s.pins.get(file) ?? null); s.pins.set(file, row.identity);
        if (kind !== "js") await verifyOriginalNativeProfile(s, file, kind, row.sha256);
        const artifact = { ...row, mode, kind };
        if (rows.length + s.inputs.rows.length >= limits.manifest_rows || byteLengthRows([...s.inputs.rows, ...rows, artifact]) > limits.manifest_bytes) refuse("manifest_bound");
        rows.push(artifact); found.push(rel);
      }
      await visit(base);
      if (canonical(found.sort()) !== canonical([...expected, "native-bar-fs/native_bar_fs.node", "admission-unsigned-observer"].sort())) refuse("artifact_set");
    }
    const js = mode => rows.filter(r => r.mode === mode && r.kind === "js").map(r => [path.relative(path.join(s.output, mode), r.path), r.bytes, r.sha256]).sort();
    if (canonical(js("normal")) !== canonical(js("ubsan"))) refuse("javascript_parity");
    if (rows.length + s.inputs.rows.length > limits.manifest_rows) refuse("manifest_rows"); return { rows, sha256: digest(rows) };
  }
  async function saveOriginalBuildRecord(s) {
    await qualifyChain(s, s.output); checkpoint(s);
    const bytes = Buffer.from(canonical(s.record) + "\n"); if (bytes.length > limits.build_record_bytes) refuse("record_bound");
    const file = path.join(s.output, "build-record.json"), fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const ref = ownHandle(s, fd, file, "record"); let primary = null;
    try {
      checkpoint(s); const original = identity(afterSync(s, fs.fstatSync(fd, { bigint: true })));
      await qualifyMetadata(s, file, true, 0o600n, false); checkpoint(s);
      if (original.size !== "0" || !sameIdentity(original, identity(afterSync(s, fs.lstatSync(file, { bigint: true }))))) refuse("record_identity");
      let offset = 0;
      while (offset < bytes.length) {
        checkpoint(s); const current = afterSync(s, fs.fstatSync(fd, { bigint: true })); safeStat(current, true, 0o600n, false);
        if (!sameIdentity(original, identity(current), true) || current.size !== BigInt(offset)
          || !sameIdentity(identity(current), identity(afterSync(s, fs.lstatSync(file, { bigint: true }))))) refuse("record_identity");
        // Written and read bytes are counted before the late-return check, so the record keeps actual I/O.
        const n = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset); if (n < 1 || n > bytes.length - offset) refuse("record_write");
        offset += n; s.recordIoBytes += n; checkpoint(s);
      }
      fs.fsyncSync(fd); checkpoint(s); const copy = Buffer.alloc(bytes.length); offset = 0;
      while (offset < copy.length) {
        checkpoint(s); const n = fs.readSync(fd, copy, offset, copy.length - offset, offset); if (n < 1 || n > copy.length - offset) refuse("record_readback");
        offset += n; s.recordIoBytes += n; checkpoint(s);
      }
      const readbackIdentity = identity(afterSync(s, fs.fstatSync(fd, { bigint: true })));
      if (!copy.equals(bytes) || readbackIdentity.size !== String(bytes.length)) refuse("record_readback");
      await qualifyChain(s, s.output); await qualifyMetadata(s, file, true, 0o600n, false); checkpoint(s);
      safeStat(afterSync(s, fs.fstatSync(fd, { bigint: true })), true, 0o600n, false);
      const final = identity(afterSync(s, fs.fstatSync(fd, { bigint: true })));
      if (!sameIdentity(original, final, true) || !sameIdentity(readbackIdentity, final)
        || !sameIdentity(final, identity(afterSync(s, fs.lstatSync(file, { bigint: true }))))) refuse("record_identity");
      s.recordHash = hash(copy); s.recordIdentity = final;
    } catch (error) { primary = error; }
    try { closeOriginal(s, ref); } catch (error) { primary ??= error; }
    if (primary) throw primary; s.recordClosed = true;
  }
  async function qualifyOriginalNamespace(s, buildRef) {
    try {
      if (buildReferences.get(buildRef) !== s || !s.recordClosed || !s.recordIdentity) refuse("original_build_required"); checkpoint(s);
      const recordPath = path.join(s.output, "build-record.json");
      if (!sameIdentity(s.recordIdentity, identity(afterSync(s, fs.lstatSync(recordPath, { bigint: true }))))) refuse("record_changed");
      const reportRoot = path.join(s.output, "reports"), directory = path.join(reportRoot, s.runId);
      await createOriginalDirectory(s, reportRoot); await createOriginalDirectory(s, directory); await qualifyChain(s, directory); checkpoint(s);
      if (!sameIdentity(s.recordIdentity, identity(afterSync(s, fs.lstatSync(recordPath, { bigint: true }))))) refuse("record_changed");
      const ref = Object.freeze(Object.create(null)); namespaceReferences.set(ref, { owner: s, buildRef, directory }); return ref;
    } catch (error) { throw stop(s, error, true); }
  }
  async function buildAndQualify() {
    const s = newQualificationState(); let previousMask = null, primary = null;
    try {
      checkpoint(s);
      if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch) || process.execArgv.length
        || Object.keys(process.env).some(k => /^(NODE_|DYLD_)/.test(k) || ["LD_PRELOAD", "CFLAGS", "CXXFLAGS", "LDFLAGS", "SDKROOT", "DEVELOPER_DIR"].includes(k))) refuse("startup_policy");
      await qualifyChain(s, path.dirname(s.output)); checkpoint(s);
      try { fs.lstatSync(s.output); refuse("output_exists"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      checkpoint(s); previousMask = process.umask(0o077); checkpoint(s);
      s.environment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", TZ: "Asia/Tokyo", XCRUN_CACHE_DISABLED: "1" };
      await createOriginalDirectory(s, s.output);
      for (const rel of ["scratch", "scratch/tmp", "scratch/home", "scratch/modules", "scratch/cache"]) await createOriginalDirectory(s, path.join(s.output, rel));
      s.environment = { ...s.environment, HOME: path.join(s.output, "scratch/home"), CFFIXED_USER_HOME: path.join(s.output, "scratch/home"),
        TMPDIR: path.join(s.output, "scratch/tmp") + "/", CLANG_MODULE_CACHE_PATH: path.join(s.output, "scratch/modules"), XDG_CACHE_HOME: path.join(s.output, "scratch/cache") };
      s.runId = `run-${crypto.randomBytes(16).toString("hex")}`;
      const inputs = await discoverOriginalInputs(s);
      await verifyOriginalHostClosure(s, inputs);
      for (const mode of ["normal", "ubsan"]) await buildOriginalMode(s, mode, inputs);
      s.passBytes = 0n; await snapshotInputs(s, inputs); s.artifacts = await snapshotArtifacts(s, inputs);
      const manifestBytes = Buffer.byteLength(canonical([...s.inputs.rows, ...s.artifacts.rows]));
      if (manifestBytes > limits.manifest_bytes) refuse("manifest_bound");
      describeUnsignedQualificationCapacity({ rows: s.inputs.rows.length + s.artifacts.rows.length,
        input_bytes: String(s.inputs.rows.reduce((n, r) => n + BigInt(r.bytes), 0n)), artifact_bytes: String(s.artifacts.rows.reduce((n, r) => n + BigInt(r.bytes), 0n)),
        manifest_bytes: manifestBytes, record_fixed_bytes: 2097152, namespace_nodes: limits.namespace_nodes, discovery_commands: limits.discovery_commands });
      s.record = { schema: "native-bar-cohort-private-build-v1", native_status: "NOT_RUN", runtime_qualified: false, execution_available: false,
        source: s.sourceIdentity, profile: "linker_adhoc", inputs: s.inputs, artifacts: s.artifacts, tool_plans: s.toolPlans ?? [],
        commands: { count: s.commands, digest: s.commandDigest, coverage: "before_record_open" },
        qualification_work: { hash_bytes: String(s.hashBytes), includes_evidence_writer_work: false } };
      await saveOriginalBuildRecord(s); checkpoint(s);
      if (!s.recordClosed || !s.recordHash || s.helper || s.children.size) refuse("build_not_closed");
    } catch (error) { primary = error; }
    finally {
      if (previousMask !== null) try { process.umask(previousMask); } catch (error) { s.failures.push("umask_restore_unknown"); primary ??= error; }
    }
    if (!primary) try {
      checkpoint(s); const buildRef = Object.freeze(Object.create(null)); buildReferences.set(buildRef, s); s.phase = "BUILD_BOUND";
      const namespaceRef = await qualifyOriginalNamespace(s, buildRef); s.phase = "NAMESPACE_BOUND";
      const timing = originalCohortTiming(s, buildRef, namespaceRef); return Object.freeze({ buildRef, namespaceRef, timing });
    } catch (error) { primary = error; }
    stop(s, primary); closeRemaining(s);
    throw primary;
  }
}
