// C2b connection source only. Neither evaluation nor an exported call opens the private root.
export function runUnsignedCohortWorker() { throw Error("cc2b_execution_not_approved"); }

async function prepareOriginalWorkerStartup() {
  const policy = originalWorkerOperationalPolicy();
  const clock = originalWorkerClock();
  const { MessageChannel } = process.getBuiltinModule("node:worker_threads");
  const { Socket } = process.getBuiltinModule("node:net");
  const { setTimeout, clearTimeout } = process.getBuiltinModule("node:timers");
  const sessions = new WeakMap(), retained = new Set(), startupProofs = new WeakMap();
  let workerAllocated = false;
  let createUnsignedProtocolDecoder, readUnsignedControllerFrame, validateUnsignedWireBinding, validateUnsignedWorkerStartupEnvelope, canonical, flags, freeze;
  const s = allocateOriginalWorker();
  try {
    acquireOriginalWorkerPair(s); armOriginalWorkerTimer(s, "phase", s.phaseEnd); checkpointOriginalWorker(s);
    ({ createUnsignedProtocolDecoder } = await import("../../test/helpers/unsignedAdapterSupport.mjs")); checkpointOriginalWorker(s);
    ({ readUnsignedControllerFrame, validateUnsignedWireBinding } = await import("../../test/helpers/unsignedControllerWireContracts.mjs")); checkpointOriginalWorker(s);
    ({ validateUnsignedWorkerStartupEnvelope } = await import("../../test/helpers/unsignedWorkerStartupContracts.mjs")); checkpointOriginalWorker(s);
    ({ canonical, flags, freeze } = await import("../../test/helpers/unsignedControllerData.mjs")); checkpointOriginalWorker(s);
    s.decoder = createUnsignedProtocolDecoder(); s.helpers = true;
    bindOriginalWorkerPipes(s); checkpointOriginalWorker(s);
  } catch { stopOriginalWorker(s, "initialization_failed"); }
  return s.reference;

  function originalWorkerOperationalPolicy() { throw Error("cc2b_operational_profile_unavailable"); }
  function reserveOriginalWorkerWork() { throw Error("cc2c_work_producer_unavailable"); }
  async function qualifyOriginalWorkerStartup(ref) {
    const s = currentOriginalWorker(ref); s.startup.pending = false; s.startup.disposition = "refused";
    throw Error("cc2c_startup_producer_unavailable");
  }
  function disposeOriginalWorkerStartup() { throw Error("cc2c_startup_disposition_unavailable"); }
  function consumeOriginalWorkerPrepare() { throw Error("cc3_prepare_connection_unavailable"); }
  function rejectOriginalWorker(reason) { throw Error("cc2b_" + reason); }
  function originalWorkerClock() {
    const maximum = 999999999999999999999999999999n;
    let last = null, failed = false, previous = null, adjusted = false;
    function sample() {
      if (failed) rejectOriginalWorker("clock_unavailable");
      let n; try { n = process.hrtime.bigint(); } catch { failed = true; rejectOriginalWorker("clock_unavailable"); }
      if (typeof n !== "bigint" || n < 0n || n > maximum || last !== null && n < last) { failed = true; rejectOriginalWorker("clock_invalid"); }
      last = n; return n;
    }
    const start = sample(), end = start + 900000n * 1000000n;
    if (end > maximum) { failed = true; rejectOriginalWorker("clock_limit"); }
    const binding = Object.freeze({ clock_domain: "worker-" + start.toString(36), started_ns: String(start) });
    return Object.freeze({ binding, end_ns: String(end), point() { return { clock_domain: binding.clock_domain, monotonic_ns: String(sample()) }; },
      stamp() {
        const before = sample(); if (before >= end) rejectOriginalWorker("clock_deadline");
        let ms; try { ms = Date.now(); } catch { failed = true; rejectOriginalWorker("wall_unavailable"); }
        const after = sample();
        if (after >= end || !Number.isSafeInteger(ms) || ms < 0 || ms > 253402268399999) { failed = true; rejectOriginalWorker("wall_invalid"); }
        const slack = 999999n;
        if (previous) { const delta = BigInt(ms - previous.ms) * 1000000n;
          adjusted ||= delta < 0n || delta < before - previous.after - slack || delta > after - previous.before + slack; }
        let utc, jst; try { utc = new Date(ms).toISOString(); jst = new Date(ms + 32400000).toISOString().replace("Z", "+09:00"); }
        catch { failed = true; rejectOriginalWorker("wall_invalid"); }
        const completed = sample(); if (completed >= end) rejectOriginalWorker("clock_deadline");
        previous = { ms, before, after };
        return Object.freeze({ clock_domain: binding.clock_domain, monotonic_ns: String(completed), before_ns: String(before), after_ns: String(after), validation_end_ns: String(completed),
          wall_utc: utc, wall_jst: jst, wall_adjustment_possible: adjusted });
      } });
  }
  function allocateOriginalWorker() {
    if (!["normal", "ubsan"].includes(policy.mode) || workerAllocated || retained.size) rejectOriginalWorker("invocation_once");
    workerAllocated = true;
    const start = BigInt(clock.binding.started_ns), localEnd = BigInt(clock.end_ns), preparation = start + 120000n * 1000000n;
    const reference = Object.freeze(Object.create(null));
    const s = { reference, clock, mode: policy.mode, active: true, last: start, phaseEnd: preparation < localEnd ? preparation : localEnd,
      stopped: null, clockInvalid: false, sampling: false, progressing: false, receiving: false, helpers: false, decoder: null,
      binding: null, bindingHash: null, frames: 0, next: { parent: 1, worker: 1 }, pendingPrepare: null,
      startup: { attempted: false, pending: false, disposition: "not_started", proof: null, closeAttempted: false },
      pair: null, pairAttempted: false, pairUnknown: false, pairCloseAttempted: false, pairCloseReturned: false,
      pipes: { command: null, status: null }, pipeAttempted: false, pipeUnknown: false, pipesBound: false,
      commandEnd: false, commandClosed: false, statusEnd: false, statusFinish: false, statusClosed: false, statusError: null,
      endAttempted: false, endReturned: false, endUnknown: false,
      timers: { phase: null, operation: null }, timerGeneration: 0, pending: null, statuses: [], readyComplete: false,
      failureDecision: null, exitAttempted: false, errors: [], discardedBytes: 0, discardUnknown: false };
    sessions.set(reference, s); retained.add(s); return s;
  }
  function currentOriginalWorker(ref) {
    const s = sessions.get(ref);
    if (!s || !s.active || !retained.has(s) || s.clock !== clock) rejectOriginalWorker("original_session"); return s;
  }
  function liveOriginalWorker(s) { return sessions.get(s.reference) === s && retained.has(s) && s.active && s.clock === clock; }
  function noteOriginalWorkerError(s, code) { if (!s.errors.includes(code) && s.errors.length < 8) s.errors.push(code); }
  function sampleOriginalWorker(s) {
    if (!liveOriginalWorker(s) || s.clockInvalid) return null;
    if (s.sampling) { s.clockInvalid = true; stopOriginalWorker(s, "clock_reentrant"); return null; }
    s.sampling = true; let n = null, reason = null;
    try {
      const p = clock.point();
      if (!liveOriginalWorker(s) || p?.clock_domain !== clock.binding.clock_domain || typeof p.monotonic_ns !== "string"
        || !/^(0|[1-9][0-9]{0,29})$/.test(p.monotonic_ns) || BigInt(p.monotonic_ns) < s.last) throw Error("clock_invalid");
      s.last = BigInt(p.monotonic_ns);
      n = s.last;
      if (s.pending?.started && n >= s.pending.deadline) { s.pending.decision = "uncertain"; reason = "status_deadline"; }
      else if (n >= s.phaseEnd || n >= BigInt(clock.end_ns)) reason = "preparation_deadline";
    } catch { s.clockInvalid = true; reason = "clock_invalid"; }
    finally { s.sampling = false; }
    if (reason) stopOriginalWorker(s, reason); return n;
  }
  function referencesOriginalWorker(s) {
    if (!s.pair || s.pairUnknown || s.pairCloseAttempted) return false;
    return s.pair.every(p => {
      try { return !p.closed && p.listeners && p.port.hasRef === p.hasRef && p.port.ref === p.ref && p.port.close === p.close
        && Reflect.apply(p.hasRef, p.port, []) === true; } catch { return false; }
    });
  }
  function checkpointOriginalWorker(s, failure = false) {
    if (!liveOriginalWorker(s)) rejectOriginalWorker("original_session");
    const n = sampleOriginalWorker(s);
    if (n === null || s.stopped && !failure || n >= s.phaseEnd) rejectOriginalWorker("stopped");
    if (!referencesOriginalWorker(s)) { stopOriginalWorker(s, "lifetime_unreferenced"); rejectOriginalWorker("lifetime_unreferenced"); }
    const originalTimers = { ...s.timers };
    for (const slot of ["phase", "operation"]) {
      const t = s.timers[slot];
      if (slot === "phase" && !t) { stopOriginalWorker(s, "phase_timer_unavailable"); rejectOriginalWorker("phase_timer_unavailable"); }
      if (t) {
        let okay = false; try { okay = t.active && !t.installing && t.handle?.hasRef === t.hasRef && Reflect.apply(t.hasRef, t.handle, []) === true; } catch { /* Unknown is not referenced. */ }
        if (!okay || n >= t.deadline) { stopOriginalWorker(s, "timer_unqualified"); rejectOriginalWorker("timer_unqualified"); }
      }
    }
    const after = sampleOriginalWorker(s);
    if (!liveOriginalWorker(s) || after === null || s.stopped && !failure || after >= s.phaseEnd
      || Object.keys(originalTimers).some(k => s.timers[k] !== originalTimers[k] || s.timers[k] && !s.timers[k].active)) rejectOriginalWorker("checkpoint_changed");
    return after;
  }
  function acquireOriginalWorkerPair(s) {
    if (!liveOriginalWorker(s) || s.pairAttempted) rejectOriginalWorker("pair_once"); s.pairAttempted = true; s.pairUnknown = true;
    const pair = new MessageChannel();
    s.pair = [pair.port1, pair.port2].map(port => ({ port, on: port.on, ref: port.ref, hasRef: port.hasRef, close: port.close, listeners: false, closed: false }));
    checkOriginalWorkerPairStep(s);
    if (s.pair[0].port === s.pair[1].port || s.pair.some(p => typeof p.on !== "function" || typeof p.ref !== "function" || typeof p.hasRef !== "function"
      || typeof p.close !== "function" || Reflect.apply(p.hasRef, p.port, []) !== false)) rejectOriginalWorker("pair_default");
    s.pairUnknown = false;
    for (const p of s.pair) {
      Reflect.apply(p.on, p.port, ["message", () => { if (liveOriginalWorker(s)) stopOriginalWorker(s, "lifetime_message"); }]);
      checkOriginalWorkerPairStep(s);
      Reflect.apply(p.on, p.port, ["messageerror", () => { if (liveOriginalWorker(s)) stopOriginalWorker(s, "lifetime_message_error"); }]);
      checkOriginalWorkerPairStep(s);
      Reflect.apply(p.on, p.port, ["close", () => {
        if (!liveOriginalWorker(s) || p.closed) return; p.closed = true;
        if (!s.pairCloseAttempted) stopOriginalWorker(s, "lifetime_closed"); progressOriginalWorkerStop(s);
      }]);
      checkOriginalWorkerPairStep(s);
      p.listeners = true; Reflect.apply(p.ref, p.port, []);
      checkOriginalWorkerPairStep(s);
      if (Reflect.apply(p.hasRef, p.port, []) !== true) rejectOriginalWorker("pair_reference");
    }
  }
  function checkOriginalWorkerPairStep(s) {
    if (sampleOriginalWorker(s) === null || s.stopped) rejectOriginalWorker("pair_stopped");
  }
  function clearOriginalWorkerTimer(s, slot) {
    const t = s.timers[slot]; if (!t || t.clearAttempted) return;
    t.active = false;
    if (t.installing) { t.cancelRequested = true; return; }
    t.clearAttempted = true;
    try {
      if (t.armUnknown || !t.handle && !t.knownCleared) throw Error("timer_unknown");
      if (!t.knownCleared) clearTimeout(t.handle); t.handle = null; t.knownCleared = true; if (s.timers[slot] === t) s.timers[slot] = null;
    } catch { t.clearUnknown = true; noteOriginalWorkerError(s, "timer_clear_unknown"); stopOriginalWorker(s, "timer_clear_unknown"); }
  }
  function armOriginalWorkerTimer(s, slot, deadline) {
    if (!liveOriginalWorker(s) || s.timers[slot] || !["phase", "operation"].includes(slot)) rejectOriginalWorker("timer_once");
    const n = sampleOriginalWorker(s); if (n === null || deadline <= n || s.stopped && slot === "phase") rejectOriginalWorker("timer_window");
    const t = { generation: ++s.timerGeneration, segment: 0, deadline, active: true, handle: null, hasRef: null, installing: false,
      cancelRequested: false, clearAttempted: false, clearUnknown: false, armUnknown: false, knownCleared: true };
    if (!Number.isSafeInteger(t.generation)) rejectOriginalWorker("timer_generation"); s.timers[slot] = t;
    function schedule() {
      if (!liveOriginalWorker(s) || s.timers[slot] !== t || !t.active) return;
      reserveOriginalWorkerWork(s, 0, 1);
      const at = sampleOriginalWorker(s);
      if (at === null || at >= deadline || !liveOriginalWorker(s) || s.timers[slot] !== t || !t.active) { clearOriginalWorkerTimer(s, slot); return; }
      const segment = ++t.segment; if (!Number.isSafeInteger(segment)) rejectOriginalWorker("timer_segment");
      const delay = (deadline - at + 999999n) / 1000000n; if (delay < 1n) rejectOriginalWorker("timer_window");
      t.installing = true; t.knownCleared = false; let synchronous = false;
      try {
        t.handle = setTimeout(() => {
          if (!liveOriginalWorker(s) || s.timers[slot] !== t || !t.active || segment !== t.segment) return;
          if (t.installing) { synchronous = true; return; }
          const point = sampleOriginalWorker(s); if (point === null || point >= deadline || !t.active) { clearOriginalWorkerTimer(s, slot); return; }
          let referenced = false; try { referenced = Reflect.apply(t.hasRef, t.handle, []) === true; } catch { /* Refuse below. */ }
          if (!referenced) { stopOriginalWorker(s, "timer_unreferenced"); return; }
          t.installing = true;
          try { clearTimeout(t.handle); t.handle = null; t.knownCleared = true; } catch { t.clearUnknown = true; t.clearAttempted = true; t.active = false; stopOriginalWorker(s, "timer_clear_unknown"); return; }
          finally { t.installing = false; }
          if (t.cancelRequested || !t.active) { clearOriginalWorkerTimer(s, slot); progressOriginalWorkerStop(s); return; }
          if (liveOriginalWorker(s) && s.timers[slot] === t && t.active) try { schedule(); } catch { stopOriginalWorker(s, "timer_rearm_failed"); }
        }, Number(delay));
        t.hasRef = t.handle?.hasRef;
      } catch { t.armUnknown = true; stopOriginalWorker(s, "timer_arm_unknown"); }
      finally { t.installing = false; }
      if (t.cancelRequested || s.stopped && !(slot === "operation" && s.pending?.kind === "FAILED") || synchronous) {
        if (synchronous) stopOriginalWorker(s, "timer_reentrant"); clearOriginalWorkerTimer(s, slot);
      }
      if (t.active) {
        let okay = false; try { okay = typeof t.hasRef === "function" && Reflect.apply(t.hasRef, t.handle, []) === true; } catch { /* Refuse below. */ }
        if (!okay) stopOriginalWorker(s, "timer_unreferenced"); sampleOriginalWorker(s);
      }
    }
    try { schedule(); } catch { t.active = false; if (!t.handle) s.timers[slot] = null; throw Error("cc2b_timer_work_unavailable"); }
  }
  function bindOriginalWorkerPipes(s) {
    if (!liveOriginalWorker(s) || s.pipeAttempted) rejectOriginalWorker("pipe_once");
    checkpointOriginalWorker(s); s.pipeAttempted = true; s.pipeUnknown = true;
    const command = new Socket({ fd: 3, readable: true, writable: false, allowHalfOpen: false }); s.pipes.command = command;
    checkpointOriginalWorker(s);
    const status = new Socket({ fd: 4, readable: true, writable: true, allowHalfOpen: false }); s.pipes.status = status;
    Object.freeze(s.pipes);
    s.pipeUnknown = false;
    s.statusWrite = status.write; s.statusEndMethod = status.end;
    listenOriginalWorker(s, status, "error", () => terminalOriginalWorker(s, status, "status", "error"));
    listenOriginalWorker(s, status, "close", () => terminalOriginalWorker(s, status, "status", "close"));
    listenOriginalWorker(s, status, "finish", () => terminalOriginalWorker(s, status, "status", "finish"));
    listenOriginalWorker(s, status, "end", () => terminalOriginalWorker(s, status, "status", "end"));
    listenOriginalWorker(s, status, "data", () => terminalOriginalWorker(s, status, "status", "reverse"));
    listenOriginalWorker(s, command, "error", () => terminalOriginalWorker(s, command, "command", "error"));
    listenOriginalWorker(s, command, "close", () => terminalOriginalWorker(s, command, "command", "close"));
    listenOriginalWorker(s, command, "end", () => endOriginalWorkerCommand(s, command));
    listenOriginalWorker(s, command, "data", bytes => receiveOriginalWorker(s, command, bytes));
    s.pipesBound = true;
  }
  function listenOriginalWorker(s, pipe, event, callback) {
    checkpointOriginalWorker(s);
    if (pipe !== s.pipes.command && pipe !== s.pipes.status) rejectOriginalWorker("pipe_reference");
    pipe.on(event, callback); checkpointOriginalWorker(s);
  }
  function terminalOriginalWorker(s, pipe, slot, event) {
    if (!liveOriginalWorker(s) || s.pipes[slot] !== pipe) return;
    if (slot === "status") {
      if (event === "close") { if (s.statusClosed) return; s.statusClosed = true; }
      else if (event === "finish") s.statusFinish = true;
      else if (event === "end") s.statusEnd = true;
      else s.statusError ??= event === "reverse" ? "reverse_traffic" : "status_error";
      if (event !== "finish" && (event !== "end" || !s.endAttempted)) {
        if (s.pending?.started) s.pending.decision = "uncertain"; stopOriginalWorker(s, "status_" + event);
      }
    } else { if (event === "close") s.commandClosed = true; stopOriginalWorker(s, "command_" + event); }
    progressOriginalWorkerStop(s);
  }
  function discardOriginalWorker(s, bytes) {
    if (!Buffer.isBuffer(bytes)) { s.discardUnknown = true; return; }
    s.discardUnknown ||= s.discardedBytes + bytes.length > 2097152; s.discardedBytes = Math.min(2097152, s.discardedBytes + bytes.length);
  }
  function receiveOriginalWorker(s, pipe, bytes) {
    if (!liveOriginalWorker(s) || s.pipes.command !== pipe) return;
    if (s.stopped) { discardOriginalWorker(s, bytes); return; }
    if (s.receiving) { stopOriginalWorker(s, "receive_reentrant"); return; }
    s.receiving = true;
    try {
      checkpointOriginalWorker(s); if (s.frames >= 32) rejectOriginalWorker("frame_capacity");
      const lines = s.decoder.push(bytes);
      for (const line of lines) {
        checkpointOriginalWorker(s); if (s.frames >= 32) rejectOriginalWorker("frame_capacity");
        reserveOriginalWorkerWork(s, 524288, 0);
        const f = readUnsignedControllerFrame(line), initial = s.binding === null;
        const binding = initial ? validateUnsignedWireBinding(f.binding) : s.binding;
        const checked = validateUnsignedWorkerStartupEnvelope({ line, expected: { kind: initial ? "LAUNCH" : "PREPARE", direction: "parent",
          next_ordinal: s.next.parent, frames_spent: s.frames, binding, worker_clock_domain: clock.binding.clock_domain }, reserved_hash_bytes: "524288" });
        checkpointOriginalWorker(s);
        if (initial) {
          if (binding.mode !== s.mode) rejectOriginalWorker("mode_binding");
          s.binding = binding; s.bindingHash = checked.binding_sha256; s.frames++; s.next.parent++;
          void startOriginalWorker(s.reference).catch(() => stopOriginalWorker(s, "startup_connection_failed"));
        } else {
          if (!s.statuses.some(r => r.kind === "READY" && r.started) || s.pendingPrepare) rejectOriginalWorker("prepare_order");
          s.frames++; s.next.parent++; s.pendingPrepare = { line, sha256: checked.line_sha256, bytes: checked.bytes };
          if (s.readyComplete) try { consumeOriginalWorkerPrepare(s); } catch { stopOriginalWorker(s, "prepare_unavailable"); }
        }
      }
    } catch { stopOriginalWorker(s, "command_invalid"); }
    finally { s.receiving = false; progressOriginalWorkerStop(s); }
  }
  function endOriginalWorkerCommand(s, pipe) {
    if (!liveOriginalWorker(s) || s.pipes.command !== pipe || s.commandEnd) return; s.commandEnd = true;
    if (!s.stopped) { try { s.decoder.end(); } catch { stopOriginalWorker(s, "command_truncated"); } stopOriginalWorker(s, "command_end"); }
    progressOriginalWorkerStop(s);
  }
  async function startOriginalWorker(ref) {
    const s = currentOriginalWorker(ref); if (s.startup.attempted) rejectOriginalWorker("startup_once");
    checkpointOriginalWorker(s); s.startup.attempted = true; s.startup.pending = true; s.startup.disposition = "unknown";
    try {
      const proof = await qualifyOriginalWorkerStartup(ref), owned = startupProofs.get(proof);
      if (!liveOriginalWorker(s) || !owned || owned.owner !== s || owned.binding !== s.binding || owned.consumed
        || owned.mode !== s.mode || owned.addon_protocol !== 6 || owned.native_mode !== "synthetic_only") rejectOriginalWorker("startup_proof");
      owned.consumed = true; s.startup.pending = false; s.startup.proof = proof; s.startup.disposition = "acquired";
      checkpointOriginalWorker(s);
      const write = planOriginalWorkerStatus(s, "READY"); writeOriginalWorkerStatus(s, write);
    } catch { stopOriginalWorker(s, "startup_failed"); }
    finally { progressOriginalWorkerStop(s); }
  }
  function planOriginalWorkerStatus(s, kind) {
    if (!liveOriginalWorker(s) || s.frames >= 32 || !["READY", "FAILED"].includes(kind) || s.pending || s.statuses.length >= 2 || s.statuses.some(r => r.kind === kind)) rejectOriginalWorker("status_once");
    const at = checkpointOriginalWorker(s, kind === "FAILED");
    if (!s.helpers || !s.binding || !s.pipesBound || s.statusClosed || s.statusError || s.endAttempted || s.pendingPrepare
      || kind === "READY" && s.startup.disposition !== "acquired") rejectOriginalWorker("status_binding");
    const remaining = (s.phaseEnd - at) / 1000000n; if (remaining < 1n) rejectOriginalWorker("status_sub_ms");
    reserveOriginalWorkerWork(s, 524288, 0);
    const payload = kind === "READY" ? { addon_protocol: 6, mode: "synthetic_only", pins_sha256: s.bindingHash, worker_clock_domain: clock.binding.clock_domain }
      : { phase: "launch", primary_code: s.stopped, close_errors: [...s.errors], diagnostic_sha256: null, resources: null, query_created: false, instrumentation_overflow: s.discardUnknown };
    const line = canonical({ binding: s.binding, direction: "worker", ordinal: s.next.worker, kind, payload }) + "\n";
    const checked = validateUnsignedWorkerStartupEnvelope({ line, expected: { kind, direction: "worker", next_ordinal: s.next.worker,
      frames_spent: s.frames, binding: s.binding, worker_clock_domain: clock.binding.clock_domain }, reserved_hash_bytes: "524288" });
    const r = { kind, ordinal: s.next.worker, line, bytes: checked.bytes, sha256: checked.line_sha256, deadline: at + (remaining < 10000n ? remaining : 10000n) * 1000000n,
      started: false, returnSeen: false, returned: null, callbackSeen: false, callbackOkay: false, decision: "planned", pipe: s.pipes.status };
    s.statuses.push(r); s.pending = r; armOriginalWorkerTimer(s, "operation", r.deadline); return r;
  }
  function settleOriginalWorkerStatus(s, r) {
    if (!liveOriginalWorker(s) || s.pending !== r || !r.started || !r.returnSeen || !r.callbackSeen) return;
    let n = null;
    try { n = checkpointOriginalWorker(s, r.kind === "FAILED"); }
    catch { r.decision = "uncertain"; stopOriginalWorker(s, "status_completion_unqualified"); }
    if (r.decision !== "uncertain" && r.callbackOkay && n !== null && n < r.deadline && !s.clockInvalid && !s.statusClosed && !s.statusError && (!s.stopped || r.kind === "FAILED")) r.decision = "completed";
    else r.decision = "uncertain";
    r.line = null; s.pending = null; clearOriginalWorkerTimer(s, "operation");
    if (r.kind === "READY" && r.decision === "completed" && !s.stopped) {
      s.readyComplete = true;
      if (s.pendingPrepare) try { consumeOriginalWorkerPrepare(s); } catch { stopOriginalWorker(s, "prepare_unavailable"); }
    }
    progressOriginalWorkerStop(s);
  }
  function completeOriginalWorkerStatus(s, r, error) {
    if (!liveOriginalWorker(s) || s.pending !== r || r.pipe !== s.pipes.status || !r.started || r.callbackSeen) return;
    r.callbackSeen = true; r.callbackOkay = error == null;
    if (sampleOriginalWorker(s) === null || error != null) { r.decision = "uncertain"; stopOriginalWorker(s, "status_callback_failed"); }
    settleOriginalWorkerStatus(s, r);
  }
  function writeOriginalWorkerStatus(s, r) {
    if (!liveOriginalWorker(s) || s.pending !== r || r.started || r.decision !== "planned" || r.pipe !== s.pipes.status) rejectOriginalWorker("status_reference");
    try {
      const n = checkpointOriginalWorker(s, r.kind === "FAILED");
      if (s.frames >= 32 || s.statusClosed || s.statusError || s.endAttempted || r.pipe.write !== s.statusWrite || !s.timers.operation?.active
        || s.timers.operation.deadline !== r.deadline || (r.deadline - n) / 1000000n < 1n) rejectOriginalWorker("status_dispatch");
      r.started = true; r.decision = "started"; s.frames++; s.next.worker++;
      const value = Reflect.apply(s.statusWrite, r.pipe, [r.line, "utf8", error => completeOriginalWorkerStatus(s, r, error)]);
      if (typeof value !== "boolean") rejectOriginalWorker("status_return_unknown");
      r.returnSeen = true; r.returned = value; sampleOriginalWorker(s); settleOriginalWorkerStatus(s, r);
    } catch { if (r.started) r.decision = "uncertain"; stopOriginalWorker(s, "status_write_failed"); }
  }
  function stopOriginalWorker(s, reason) {
    if (!liveOriginalWorker(s)) return;
    s.stopped ??= reason;
    if (!s.exitAttempted) { s.exitAttempted = true; try { process.exitCode = 1; } catch { noteOriginalWorkerError(s, "exit_code_unknown"); } }
    const r = s.pending;
    if (r && !r.started) { r.decision = "withheld"; r.line = null; s.pending = null; clearOriginalWorkerTimer(s, "operation"); }
    // A stopped READY never qualifies. FAILED is written after the stop, so only its own completion and status-stream facts decide it.
    else if (r && r.started && r.kind !== "FAILED") r.decision = "uncertain";
    progressOriginalWorkerStop(s);
  }
  function progressOriginalWorkerStop(s) {
    if (!liveOriginalWorker(s) || !s.stopped || s.progressing) return; s.progressing = true;
    try {
      if (s.pending?.started) return;
      if (s.failureDecision === null) {
        s.failureDecision = "withheld";
        if (!s.startup.pending && s.helpers && s.binding && s.pipesBound && !s.statusClosed && !s.statusError && !s.pendingPrepare
          && !s.clockInvalid && !s.statuses.some(r => r.started && r.decision === "uncertain")) {
          try { const r = planOriginalWorkerStatus(s, "FAILED"); s.failureDecision = "attempted"; writeOriginalWorkerStatus(s, r); }
          catch { /* Unknown time, work or references never authorize a replacement write. */ }
        }
      }
      if (s.pending?.started) return;
      clearOriginalWorkerTimer(s, "operation"); clearOriginalWorkerTimer(s, "phase");
      if (s.startup.proof && !s.startup.closeAttempted) {
        s.startup.closeAttempted = true;
        try { disposeOriginalWorkerStartup(s); } catch { noteOriginalWorkerError(s, "startup_close_unknown"); }
      }
      if (s.pipes.status && !s.endAttempted && !s.statusClosed) {
        s.endAttempted = true;
        try { s.endReturned = s.pipes.status.end === s.statusEndMethod && Reflect.apply(s.statusEndMethod, s.pipes.status, []) === s.pipes.status;
          s.endUnknown = !s.endReturned; } catch { s.endUnknown = true; noteOriginalWorkerError(s, "status_end_unknown"); }
      }
      if (s.startup.pending || s.startup.proof || s.pairUnknown || s.pipeUnknown || Object.values(s.timers).some(Boolean)
        || s.pending || s.endUnknown || s.pipeAttempted && (!s.commandClosed || !s.statusClosed)) return;
      if (s.pair && !s.pairCloseAttempted) {
        if (!referencesOriginalWorker(s)) return;
        s.pairCloseAttempted = true;
        try { Reflect.apply(s.pair[0].close, s.pair[0].port, []); s.pairCloseReturned = true; } catch { noteOriginalWorkerError(s, "pair_close_unknown"); }
      }
      if (s.pairCloseReturned && s.pair.every(p => p.closed)) { s.active = false; retained.delete(s); sessions.delete(s.reference); }
    } finally { s.progressing = false; }
  }
  function describeOriginalWorker(s) {
    const view = { ...flags(), scope: "unsigned_worker_sealed_connection", runtime_completion_proven: false, retained: retained.has(s),
      stopped: s.stopped, clock_invalid: s.clockInvalid, frames: s.frames, next_ordinals: { ...s.next }, binding_sha256: s.bindingHash,
      startup: { attempted: s.startup.attempted, pending: s.startup.pending, disposition: s.startup.disposition, resource_retained: s.startup.proof !== null, close_attempted: s.startup.closeAttempted },
      ports: s.pair?.map(p => ({ listeners: p.listeners, closed: p.closed })) ?? null, pair_close_attempted: s.pairCloseAttempted, pair_close_returned: s.pairCloseReturned,
      pair_unknown: s.pairUnknown, pair_attempted: s.pairAttempted, pipes_bound: s.pipesBound,
      pipe_unknown: s.pipeUnknown, status_closed: s.statusClosed, status_error: s.statusError, command_closed: s.commandClosed,
      end_attempted: s.endAttempted, end_returned: s.endReturned, end_unknown: s.endUnknown, ready_complete: s.readyComplete,
      pending_prepare: s.pendingPrepare ? { bytes: s.pendingPrepare.bytes, sha256: s.pendingPrepare.sha256 } : null,
      failure_decision: s.failureDecision, discarded_bytes: s.discardedBytes, discard_unknown: s.discardUnknown, errors: [...s.errors],
      timers: Object.fromEntries(Object.entries(s.timers).map(([k, t]) => [k, t ? { generation: t.generation, segment: t.segment, deadline_ns: String(t.deadline),
        active: t.active, clear_attempted: t.clearAttempted, clear_unknown: t.clearUnknown, arm_unknown: t.armUnknown } : null])),
      statuses: s.statuses.map(r => ({ kind: r.kind, ordinal: r.ordinal, bytes: r.bytes, sha256: r.sha256, deadline_ns: String(r.deadline),
        started: r.started, return_seen: r.returnSeen, write_return: r.returned, callback_seen: r.callbackSeen, callback_okay: r.callbackOkay, decision: r.decision })) };
    if (Buffer.byteLength(canonical(view)) > 16384) rejectOriginalWorker("diagnostic_capacity"); return freeze(view);
  }
}

runUnsignedCohortWorker();
