import { createHash } from "node:crypto";
import { z } from "zod";
import { describeUnsignedAcceptanceRun, describeUnsignedFixture } from "./jointUnsignedAcceptanceContracts.mjs";

const refuse = (code) => { throw Error(`cc1b_${code}`); };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const code = z.string().regex(/^[a-z][a-z0-9_]{0,95}$/);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const integer = (max, min = 0) => z.number().int().min(min).max(max);
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const digest = (v) => sha(canonical(v));
const bytes = (v) => Buffer.byteLength(v, "utf8");
const frozen = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(frozen); Object.freeze(v); } return v; };

// Descriptor-only JSON copying rejects accessors before any value is read. Hostile Proxies are outside the trusted-caller model.
function copy(input) {
  let nodes = 0, size = 0;
  const text = (s) => { size += bytes(s); if (size > 2097152 || bytes(s) > 262144) refuse("input_bound"); };
  function visit(v, depth) {
    if (++nodes > 8192 || depth > 16) refuse("input_bound");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isSafeInteger(v)) return v;
    if (typeof v === "string") { text(v); return v; }
    if (!v || typeof v !== "object") refuse("invalid_input");
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) refuse("invalid_input");
    if (keys.length > (array ? 257 : 64) || array && (v.length > 256 || keys.length !== v.length + 1)) refuse("input_bound");
    const result = array ? [] : Object.create(null);
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
        || array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) refuse("invalid_input");
      text(key); const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d?.enumerable || !("value" in d)) refuse("invalid_input");
      Object.defineProperty(result, key, { value: visit(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  return visit(input, 0);
}
const parse = (schema, input) => { const r = schema.safeParse(copy(input)); if (!r.success) refuse("invalid_input"); return r.data; };
const unqualified = () => ({ scope: "unsigned_execution_memory_contract_only", native_status: "NOT_RUN", execution_available: false,
  cleanup_execution_available: false, approval_authenticated: false, ownership_verified: false, evidence_saved: false,
  native_release_verified: false, native_bytes_verified: false, observer_algorithm_verified: false, history_verified: false });
const limits = frozen({ frames: 32, frame_bytes: 65536, trace_events: 128, trace_event_bytes: 1024, trace_chunks: 8,
  chunk_events: 16, receipt_records: 64, receipt_bytes: 1048576, receipt_record_bytes: 16384,
  report_bytes: 262144, run_index_bytes: 131072, observer_work_bytes: 4194304, observer_response_bytes: 65536,
  observer_invocations: 64, observer_ace_entries: 256, stdout_bytes: 8192, stderr_bytes: 8192,
  preparation_ms: 120000, query_ms: 600000, settlement_grace_ms: 60000, observer_ms: 10000 });
const geometry = z.object({ owned_entries: integer(16, 1), depth: integer(3), content_bytes: integer(131072) }).strict();
export function describeUnsignedExecutionCapacity(input) {
  const d = parse(geometry, input), records = 4 * d.owned_entries + 16;
  if (records > limits.receipt_records) refuse("receipt_capacity");
  const nodes = d.owned_entries + 3, acl = nodes * 2 * 65536, content = d.content_bytes * 2;
  return frozen({ schema: "native-bar-unsigned-execution-capacity-v1", ...unqualified(), ...d, limits,
    receipt_reserved_records: records, receipt_record_bytes: limits.receipt_record_bytes,
    observer_nodes: nodes, observer_acl_bytes: acl, observer_content_bytes: content,
    observer_remaining_metadata_bytes: limits.observer_work_bytes - acl - content - limits.observer_response_bytes,
    observer_schedule: "proposed_two_content_passes_two_acl_observations_per_node",
    observer_metadata_algorithm: "not_implemented_must_fit_remaining_budget",
    observer_case_maximum_work_bytes: limits.observer_work_bytes * limits.observer_invocations,
    maximum_trace_bytes: limits.trace_events * limits.trace_event_bytes, maximum_functional_frames: 6 + limits.trace_chunks,
    run_index_header_bytes: 4096, run_index_case_record_bytes: 5290, run_index_reserved_bytes: 4096 + 24 * 5290,
    observer_work_separate_from_native: true, native_budget_changed: false,
    ancestor_headroom_bytes: "196608", maximum_fixtures: 24, maximum_live_fixtures: 1 });
}

const clockPoint = z.object({ clock_domain: label, monotonic_ns: uint }).strict();
export function describeUnsignedExecutionWindow(input) {
  const d = parse(z.object({ phase: z.enum(["preparation", "query", "settlement"]), limit_ms: integer(Number.MAX_SAFE_INTEGER, 1),
    started: clockPoint, observed: clockPoint }).strict(), input);
  const cap = { preparation: limits.preparation_ms, query: limits.query_ms, settlement: limits.settlement_grace_ms }[d.phase];
  if (d.limit_ms > cap) refuse("window_bound");
  if (d.started.clock_domain !== d.observed.clock_domain) refuse("clock_domain");
  const elapsed = BigInt(d.observed.monotonic_ns) - BigInt(d.started.monotonic_ns);
  if (elapsed < 0n) refuse("clock_rollback");
  const remaining = BigInt(d.limit_ms) * 1000000n - elapsed, ms = remaining / 1000000n;
  // Under one whole millisecond left is a stop, as in C-B; a zero-length observer window would mean no timeout at all.
  const stop = ms < 1n;
  return frozen({ schema: "native-bar-unsigned-execution-window-v1", ...unqualified(), phase: d.phase,
    decision: stop ? "STOP_RETAIN" : "SUPPLIED_WINDOW_REMAINS", remaining_ns: String(remaining > 0n ? remaining : 0n),
    observer_window_ms: stop ? 0 : Number(ms < 10000n ? ms : 10000n),
    original_window_renewed: false, timestamps_verified: false, termination_available: false });
}

const artifacts = z.object({ js_sha256: hash, addon_sha256: hash, observer_sha256: hash }).strict();
const setupProvenance = z.object({ registration_sha256: hash, envelope_sha256: hash }).strict();
const provenance = artifacts.extend(setupProvenance.shape).strict();
const declaration = z.object({ fixture: z.unknown(), exchange_id: label, provenance }).strict();
function context(input) {
  const d = parse(declaration, input), recipe = describeUnsignedFixture(d.fixture);
  const capacity = describeUnsignedExecutionCapacity({ owned_entries: recipe.entries.length,
    depth: Math.max(...recipe.entries.map((e) => e.path ? e.path.split("/").length : 0)), content_bytes: recipe.content_bytes });
  return { recipe, capacity, binding: frozen({ protocol: "native-bar-unsigned-execution-v1", run_id: recipe.declaration.request.run_id,
    case_id: recipe.declaration.case_id, mode: recipe.declaration.mode, source_commit: recipe.declaration.request.source_commit,
    patch_sha256: recipe.declaration.request.patch_sha256, plan_sha256: recipe.plan_sha256, recipe_sha256: recipe.recipe_sha256,
    exchange_id: d.exchange_id, ...d.provenance }) };
}
const fixtureNameSchema = z.string().regex(/^native-bar-fs-synthetic-[A-Za-z0-9]{6}$/);
const allocationDeclaration = z.object({ fixture: z.object({ request: z.unknown(), case_id: label,
  mode: z.enum(["normal", "ubsan"]), ids: z.unknown() }).strict(), exchange_id: label, supervisor_id: label, worker_id: label,
  provenance: artifacts }).strict();
function allocationContext(input) {
  const d = parse(allocationDeclaration, input);
  // Only inspect the fixed logical recipe. This unused sentinel never becomes an observed name, binding, or cleanup locator.
  const recipe = describeUnsignedFixture({ ...d.fixture, fixture_name: "native-bar-fs-synthetic-Plan00" });
  const planned = describeUnsignedAcceptanceRun(recipe.declaration.request).cases
    .find((c) => c.case_id === recipe.declaration.case_id && c.mode === recipe.declaration.mode);
  const capacity = describeUnsignedExecutionCapacity({ owned_entries: recipe.entries.length,
    depth: Math.max(...recipe.entries.map((e) => e.path ? e.path.split("/").length : 0)), content_bytes: recipe.content_bytes });
  const allocation = frozen({ protocol: "native-bar-unsigned-receipt-allocation-v1", run_id: recipe.declaration.request.run_id,
    case_id: recipe.declaration.case_id, mode: recipe.declaration.mode, source_commit: recipe.declaration.request.source_commit,
    patch_sha256: recipe.declaration.request.patch_sha256, plan_sha256: recipe.plan_sha256,
    template_sha256: digest({ fixture: d.fixture, entries: recipe.entries }), exchange_id: d.exchange_id,
    supervisor_id: d.supervisor_id, worker_id: d.worker_id, ...d.provenance });
  return { declaration: d, recipe, capacity, allocation, planned };
}
const resourceSchema = z.object({ fds: uint, roots: uint, workspace: uint, retained: uint }).strict();
const baselineSchema = z.object({ resources: resourceSchema, clock_domain: label }).strict();
const empty = z.object({}).strict();
const traceEvent = z.object({ ordinal: integer(128, 1), api: z.enum(["info", "begin", "open_pair", "inventory", "capture", "verify", "close"]),
  edge: z.enum(["begin", "end", "throw"]), clock_domain: label, monotonic_ns: uint, code: code.nullable(), byte_count: uint, sha256: hash.nullable() }).strict();
const releasedSchema = z.object({ baseline_sha256: hash, resources: resourceSchema,
  query: z.enum(["settled", "unconfirmed", "never_started"]), native: z.enum(["settled", "unconfirmed", "never_started"]),
  original_operation_retired: z.boolean(), query_released: z.boolean(), close_errors: z.array(code).max(8),
  diagnostic_sha256: hash, trace_chunks: integer(8), trace_events: integer(128), trace_sha256: hash,
  primary_code: code, requests_dispatched: integer(2), authenticated_requests: integer(2),
  c0_dispatched_at: z.null(), c0_authenticated_at: z.null(), retired_at: z.null() }).strict();
const payloadSchemas = {
  PREPARE: empty, BASELINED: baselineSchema,
  GO: z.object({ baseline_sha256: hash, baseline_readback: z.literal(true), go_intent_readback: z.literal(true) }).strict(),
  CANCEL: empty, FINALIZE: empty,
  TRACE_CHUNK: z.object({ chunk_index: integer(7), events: z.array(traceEvent).min(1).max(16) }).strict(),
  RELEASED: releasedSchema,
};
const frameSchema = z.object({ binding: z.unknown(), direction: z.enum(["parent", "worker"]), ordinal: integer(32, 1),
  kind: z.enum(["PREPARE", "BASELINED", "GO", "CANCEL", "TRACE_CHUNK", "RELEASED", "FINALIZE"]), payload: z.unknown() }).strict();
function decodeLine(line, cap) {
  if (typeof line !== "string" || bytes(line) > cap) refuse("frame_bound");
  let d; try { d = copy(JSON.parse(line)); } catch { refuse("frame_encoding"); }
  if (!d || typeof d !== "object" || Array.isArray(d)) refuse("frame_encoding");
  // Canonical single-line frames also reject duplicate JSON keys without a second ad hoc JSON parser.
  if (line !== `${canonical(d)}\n`) refuse("frame_encoding");
  return d;
}
const teardown = z.object({ decision: z.enum(["removed", "retained"]), receipt_readback: z.boolean(), anchor_same: z.boolean(),
  root_removal_confirmed: z.boolean(), absent: z.boolean() }).strict();
const exitSchema = z.object({ exit_code: integer(255).nullable(), signal: z.string().regex(/^SIG[A-Z0-9]{1,12}$/).nullable() }).strict();
const failureSchema = z.object({ reason: z.enum(["worker_lost", "observer_lost", "observer_timeout", "identity_changed",
  "receipt_failed", "source_changed", "deadline_exceeded", "unexpected_output", "supervisor_lost"]) }).strict();

export function createUnsignedExecutionProtocolModel(input) {
  const { binding, capacity } = context(input), trace = [], ordinals = { parent: 1, worker: 1 };
  let state = "NEW", stopped = null, frames = 0, baseline = null, baselineHash = null, result = null, rejected = null, exit = null;
  let chunks = 0, cancelled = false, teardownComplete = false, traceClock = null;
  const fail = (reason) => { stopped ??= reason; state = "STOPPED"; refuse(reason); };
  const guard = (action) => { if (stopped) refuse("stopped"); try { return action(); }
    catch (e) { if (!stopped) { stopped = /^cc1b_[a-z_]+$/.test(e?.message) ? e.message.slice(5) : "invalid_input"; state = "STOPPED"; } throw e; } };
  const at = (expected) => { if (state !== expected) fail("protocol_order"); };
  // Until an accepted release, any interruption leaves the fixture in place.
  const describe = () => frozen({ schema: "native-bar-unsigned-execution-model-v1", ...unqualified(), binding, capacity, state,
    retain: stopped !== null || !["RELEASED", "FINALIZING", "DONE"].includes(state), stop_reason: stopped,
    model_status: state === "DONE" ? "consistent_supplied_lifecycle" : "incomplete_supplied_lifecycle",
    frames, next_ordinals: { ...ordinals }, baseline, baseline_sha256: baselineHash, result, rejected_release: rejected, worker_exit: exit, cancelled,
    trace_chunks: chunks, trace_events: trace.length, trace_sha256: digest(trace), teardown_complete: teardownComplete,
    exact_transport_times_available: false, provenance_verified: false, termination_available: false });
  return Object.freeze({
    acceptFrame(line) { return guard(() => {
      if (state === "DONE") fail("protocol_order");
      const f = parse(frameSchema, decodeLine(line, limits.frame_bytes));
      if (canonical(f.binding) !== canonical(binding)) fail("binding_changed");
      if (++frames > limits.frames) fail("frame_capacity");
      if (f.ordinal !== ordinals[f.direction]++) fail("protocol_ordinal");
      if ((["PREPARE", "GO", "CANCEL", "FINALIZE"].includes(f.kind) ? "parent" : "worker") !== f.direction) fail("protocol_direction");
      const p = parse(payloadSchemas[f.kind], f.payload);
      switch (f.kind) {
        case "PREPARE": at("NEW"); state = "PREPARING"; break;
        case "BASELINED": at("PREPARING"); baseline = frozen(p); baselineHash = digest(p); state = "BASELINED"; break;
        case "GO": at("BASELINED"); if (p.baseline_sha256 !== baselineHash) fail("baseline_changed"); state = "ACTIVE"; break;
        case "CANCEL": at("ACTIVE"); if (cancelled) fail("duplicate_cancel"); cancelled = true; break;
        case "TRACE_CHUNK": {
          // The whole chunk is checked before any event joins the trace.
          at("ACTIVE"); if (p.chunk_index !== chunks || chunks >= limits.trace_chunks) fail("trace_order");
          let last = traceClock;
          p.events.forEach((event, n) => {
            if (bytes(canonical(event)) > limits.trace_event_bytes || trace.length + n >= limits.trace_events) fail("trace_capacity");
            if (event.ordinal !== trace.length + n + 1 || event.clock_domain !== baseline.clock_domain
              || last !== null && BigInt(event.monotonic_ns) < last) fail("trace_order");
            last = BigInt(event.monotonic_ns);
          });
          chunks++; traceClock = last; trace.push(...p.events.map((event) => frozen(event))); break;
        }
        case "RELEASED": {
          // A refused packet stays visible as rejected, never as the accepted result.
          at("ACTIVE"); rejected = frozen(p);
          if (p.baseline_sha256 !== baselineHash) fail("baseline_changed");
          if (p.trace_chunks !== chunks || p.trace_events !== trace.length || p.trace_sha256 !== digest(trace)) fail("trace_binding");
          if (p.query !== "settled" || p.native !== "settled" || !p.original_operation_retired || !p.query_released || p.close_errors.length)
            fail("release_unconfirmed");
          if (["fds", "roots", "workspace"].some((key) => p.resources[key] !== baseline.resources[key])
            || BigInt(p.resources.retained) < BigInt(baseline.resources.retained)) fail("resources_changed");
          // C-C1 sends exactly one C0 and never C1; nothing authenticates without having been dispatched.
          if (p.requests_dispatched > 1 || p.authenticated_requests > p.requests_dispatched) fail("request_count");
          result = rejected; rejected = null; state = "RELEASED"; break;
        }
        case "FINALIZE": at("RELEASED"); if (!teardownComplete) fail("teardown_unconfirmed"); state = "FINALIZING"; break;
      }
      return describe();
    }); },
    finishTeardown(input) { return guard(() => {
      at("RELEASED"); const p = parse(teardown, input);
      if (teardownComplete) fail("protocol_order");
      if (p.decision !== "removed" || !p.receipt_readback || !p.anchor_same || !p.root_removal_confirmed || !p.absent) fail("teardown_unconfirmed");
      teardownComplete = true; return describe();
    }); },
    workerExit(input) { return guard(() => {
      // Every exit is kept; only a clean exit after finalization completes the lifecycle, and no exit proves release.
      const p = parse(exitSchema, input); if (state === "DONE") fail("protocol_order");
      exit = frozen(p);
      if (state !== "FINALIZING" || p.exit_code !== 0 || p.signal !== null) fail("worker_lost");
      state = "DONE"; return describe();
    }); },
    observeFailure(input) { return guard(() => { const p = parse(failureSchema, input); fail(p.reason); }); },
    describe,
  });
}

const stampSchema = z.object({ clock_domain: label, monotonic_ns: uint,
  wall_utc: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
  wall_jst: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+09:00$/) }).strict();
const proofSchema = z.object({ kind: z.enum(["directory", "file"]), device: uint, inode: uint, uid: uint, gid: uint,
  mode: z.enum(["16832", "33152"]), birthtime_ns: uint, mtime_ns: uint, ctime_ns: uint, flags: z.literal("0"),
  acl: z.enum(["none", "deny_only"]), acl_hash: hash, nlink: uint, size: uint, allocated_bytes: uint, sha256: hash.nullable() }).strict();
const entryIntent = z.object({ entry_index: integer(15) }).strict();
const entryProof = z.object({ entry_index: integer(15), proof: proofSchema }).strict();
const outcome = z.enum(["MODEL_CONSISTENT", "FAIL", "BLOCKED", "NOT_RUN"]);
const stopDetail = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("release"), result: releasedSchema }).strict(),
  z.object({ kind: z.literal("entry"), entry_index: integer(15), operation: z.enum(["create", "delete"]),
    outcome: z.enum(["missing", "changed", "error", "unconfirmed"]), code }).strict(),
  z.object({ kind: z.literal("output"), stream: z.enum(["stdout", "stderr"]), byte_count: uint, sha256: hash }).strict(),
  z.object({ kind: z.literal("worker_exit"), ...exitSchema.shape }).strict(),
]);
const receiptPayloads = {
  case_allocated: empty, create_intent: entryIntent, create_result: entryProof.extend({ fixture_name: fixtureNameSchema.optional() }).strict(),
  setup_sealed: z.object({ inventory_sha256: hash, provenance: setupProvenance }).strict(), worker_prepared: empty,
  baseline_bound: baselineSchema.extend({ observation_sha256: hash }).strict(),
  go_intent: z.object({ baseline_sha256: hash }).strict(),
  run_outcome: z.object({ primary_code: code, diagnostic_sha256: hash }).strict(),
  release_checked: releasedSchema, cleanup_precheck: z.object({ inventory_sha256: hash }).strict(),
  delete_intent: entryProof, delete_result: z.object({ entry_index: integer(15), outcome: z.literal("removed") }).strict(),
  absence_checked: z.object({ anchor_same: z.literal(true), root_removal_confirmed: z.literal(true), absent: z.literal(true) }).strict(),
  worker_finalized: z.object({ exit_code: z.literal(0), signal: z.null() }).strict(),
  ready_to_report: z.object({ outcome, negative_assessment: z.object({
    status: z.enum(["consistent_supplied_negative", "inconsistent_supplied_negative"]), sha256: hash }).strict().optional() }).strict(),
  terminal: z.object({ report_sha256: hash }).strict(),
  stop_summary: z.object({ reason: code, detail: stopDetail.optional(), fixture_name: fixtureNameSchema.optional() }).strict(),
};
const eventKind = z.enum(Object.keys(receiptPayloads));
const appendSchema = z.object({ kind: eventKind, payload: z.unknown(), stamp: stampSchema }).strict();
const reportInput = z.object({ limitations: z.array(code).max(8), save_stamp: stampSchema }).strict();
function entryIdentity(p) {
  if (p.kind === "file") return p;
  const { size, nlink, allocated_bytes, mtime_ns, ctime_ns, ...immutable } = p; return immutable;
}
function eventSchedule(recipe) {
  const indexed = recipe.entries.map((e, entry_index) => ({ ...e, entry_index }));
  const depth = (p) => p === "" ? 0 : p.split("/").length;
  const removed = [...indexed].sort((a, b) => depth(b.path) - depth(a.path)
    || (a.kind === b.kind ? 0 : a.kind === "file" ? -1 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return [ ["case_allocated"], ...indexed.flatMap((e) => [["create_intent", e.entry_index], ["create_result", e.entry_index]]),
    ...["setup_sealed", "worker_prepared", "baseline_bound", "go_intent", "run_outcome", "release_checked", "cleanup_precheck"].map((k) => [k]),
    ...removed.flatMap((e) => [["delete_intent", e.entry_index], ["delete_result", e.entry_index]]),
    ...["absence_checked", "worker_finalized", "ready_to_report", "terminal"].map((k) => [k]) ];
}

// Only supplied strings are acknowledged. No method writes, syncs, reads a file, or establishes live ownership.
export function createUnsignedExecutionEvidenceModel(input) {
  const { declaration: allocated, recipe, capacity, allocation, planned } = allocationContext(input), schedule = eventSchedule(recipe);
  const events = [], proofs = new Map();
  let binding = null, fixtureName = null;
  let position = 0, failures = 0, hardStop = null, refusal = null, pending = null, confirmedBytes = 0, report = null, reportConfirmed = false;
  let index = null, indexConfirmed = false, baseline = null, release = null, run = null, resultOutcome = null, assessment = null;
  let setupInventory = null, removedEntries = 0, absence = null, finalized = null, parentDomain = null, clock = null;
  // A refused record is never written. Before the outcome is fixed it becomes a recordable stop that the next summary must
  // name; a write that cannot be read back, a write while another is unconfirmed, or a report-phase refusal ends the chain.
  const guard = (f, recordable = false) => { if (hardStop) refuse("evidence_stopped"); try { return f(); }
    catch (e) {
      const reason = /^cc1b_[a-z_]+$/.test(e?.message) ? e.message.slice(5) : "invalid_input";
      if (recordable && !pending && !resultOutcome && reason !== "evidence_capacity") refusal ??= reason; else hardStop = reason;
      throw e;
    } };
  const ensure = (condition, reason = "evidence_order") => { if (!condition) refuse(reason); };
  const checkStamp = (s) => {
    ensure(parentDomain === null || s.clock_domain === parentDomain, "clock_domain");
    ensure(clock === null || BigInt(s.monotonic_ns) >= clock, "clock_rollback");
  };
  const commitStamp = (s) => { parentDomain = s.clock_domain; clock = BigInt(s.monotonic_ns); };
  const descriptor = (value, cap) => {
    const line = `${canonical(value)}\n`; ensure(bytes(line) <= cap, "evidence_capacity");
    return frozen({ line, sha256: sha(line), bytes: bytes(line) });
  };
  const describe = () => frozen({ schema: "native-bar-unsigned-evidence-model-v1", ...unqualified(), allocation, binding, capacity,
    confirmed_records: events.length, confirmed_receipt_bytes: confirmedBytes, last_event_hash: events.at(-1)?.event_hash ?? null,
    pending_readback: pending ? "receipt" : report && !reportConfirmed ? "report" : index && !indexConfirmed ? "index" : null,
    retain: failures > 0 || hardStop !== null || refusal !== null,
    stop_reason: hardStop ?? refusal ?? events.find((e) => e.kind === "stop_summary")?.payload.reason ?? null,
    model_status: indexConfirmed && !hardStop ? "consistent_supplied_evidence" : "incomplete_supplied_evidence",
    outcome: resultOutcome, report_sha256: report?.sha256 ?? null, index_sha256: index?.sha256 ?? null });
  return Object.freeze({
    append(input) { return guard(() => {
      ensure(!pending && !index && !indexConfirmed);
      const d = parse(appendSchema, input), p = parse(receiptPayloads[d.kind], d.payload), effects = [];
      let recordBinding = binding, recordName = fixtureName;
      ensure(events.at(-1)?.kind !== "terminal");
      const stopped = refusal !== null || failures > 0;
      if (d.kind === "stop_summary") {
        ensure(events.length > 0 && !resultOutcome && !report);
        ensure(failures < 4, "failure_capacity");
        if (refusal !== null && failures === 0) ensure(p.reason === refusal, "refusal_binding");
        // A root that was returned but whose creation result could not be recorded keeps its only locator here.
        if (p.fixture_name !== undefined) {
          ensure(fixtureName === null && events.some((e) => e.kind === "create_intent" && e.payload.entry_index === 0), "fixture_name_changed");
          recordName = p.fixture_name;
        }
        effects.push(() => { failures++; });
      } else if (stopped) {
        ensure(failures > 0, "refusal_unrecorded");
        ensure(d.kind === (resultOutcome ? "terminal" : "ready_to_report"));
      } else {
        const expected = schedule[position]; ensure(expected?.[0] === d.kind);
        if (expected.length === 2) ensure(p.entry_index === expected[1], "entry_order");
        effects.push(() => { position++; });
      }
      if (d.kind === "create_result" || d.kind === "delete_intent") {
        const entry = recipe.entries[p.entry_index]; ensure(!!entry, "entry_order");
        ensure(p.proof.kind === entry.kind && p.proof.mode === entry.mode
          && (entry.kind === "directory" ? p.proof.sha256 === null
            : p.proof.nlink === "1" && p.proof.size === entry.size && p.proof.sha256 === entry.sha256), "proof_binding");
        if (d.kind === "create_result") {
          if (p.entry_index === 0) { ensure(fixtureName === null && p.fixture_name !== undefined, "fixture_name_required"); recordName = p.fixture_name; }
          else {
            ensure(p.fixture_name === undefined, "fixture_name_changed");
            // The owned tree stays on the root's device and owner.
            const root = proofs.get(0);
            ensure(p.proof.device === root.device && p.proof.uid === root.uid && p.proof.gid === root.gid, "proof_binding");
          }
          ensure(![...proofs.values()].some((proof) => proof.device === p.proof.device && proof.inode === p.proof.inode), "proof_alias");
          effects.push(() => { proofs.set(p.entry_index, frozen(p.proof)); });
        } else ensure(digest(entryIdentity(proofs.get(p.entry_index))) === digest(entryIdentity(p.proof)), "proof_binding");
      }
      if (d.kind === "delete_result") effects.push(() => { removedEntries++; });
      if (d.kind === "setup_sealed") {
        ensure(binding === null && fixtureName !== null, "setup_binding");
        recordBinding = context({ fixture: { ...allocated.fixture, fixture_name: fixtureName }, exchange_id: allocated.exchange_id,
          provenance: { ...allocated.provenance, ...p.provenance } }).binding;
        effects.push(() => { setupInventory = p.inventory_sha256; });
      }
      if (d.kind === "baseline_bound") effects.push(() => { baseline = frozen({ resources: p.resources, clock_domain: p.clock_domain }); });
      if (d.kind === "go_intent") ensure(p.baseline_sha256 === digest(baseline), "baseline_changed");
      if (d.kind === "run_outcome") effects.push(() => { run = frozen(p); });
      if (d.kind === "release_checked") {
        ensure(p.baseline_sha256 === digest(baseline), "baseline_changed");
        ensure(p.query === "settled" && p.native === "settled" && p.query_released && p.original_operation_retired && !p.close_errors.length, "release_unconfirmed");
        ensure(["fds", "roots", "workspace"].every((k) => p.resources[k] === baseline.resources[k])
          && BigInt(p.resources.retained) >= BigInt(baseline.resources.retained), "resources_changed");
        ensure(p.primary_code === run.primary_code && p.diagnostic_sha256 === run.diagnostic_sha256, "diagnostic_changed");
        ensure(p.requests_dispatched <= 1 && p.authenticated_requests <= p.requests_dispatched, "request_count");
        effects.push(() => { release = frozen(p); });
      }
      // Nothing in the owned tree may have changed between sealing it and checking it before removal.
      if (d.kind === "cleanup_precheck") ensure(p.inventory_sha256 === setupInventory, "inventory_changed");
      if (d.kind === "absence_checked") effects.push(() => { absence = frozen(p); });
      if (d.kind === "worker_finalized") effects.push(() => { finalized = frozen(p); });
      if (d.kind === "ready_to_report") {
        // NOT_RUN means native work never began. MODEL_CONSISTENT also needs the case's expected code and request counts plus
        // a supplied consistent C-C1a assessment; FAIL/BLOCKED stay available, including a cleanly settled, torn-down FAIL.
        if (p.outcome === "NOT_RUN") ensure(!events.some((e) => e.kind === "go_intent"), "outcome_stage");
        if (p.outcome === "MODEL_CONSISTENT") {
          ensure(!stopped, "false_success");
          ensure(run.primary_code === planned.expected_code && release.requests_dispatched === 1
            && release.authenticated_requests === (planned.owner === "fixed_memory" ? 1 : 0), "outcome_binding");
          ensure(p.negative_assessment?.status === "consistent_supplied_negative", "assessment_required");
        }
        effects.push(() => { resultOutcome = p.outcome; assessment = p.negative_assessment ?? null; });
      }
      if (d.kind === "terminal") ensure(reportConfirmed && p.report_sha256 === report.sha256, "report_binding");
      checkStamp(d.stamp);
      ensure(events.length < capacity.receipt_reserved_records, "evidence_capacity");
      const body = { schema: "native-bar-unsigned-receipt-event-v1", allocation, binding: recordBinding, fixture_name: recordName,
        creation_prefix: d.kind === "create_intent" && p.entry_index === 0 ? "native-bar-fs-synthetic-" : null,
        ordinal: events.length + 1, kind: d.kind, payload: p, stamp: d.stamp, previous_event_hash: events.at(-1)?.event_hash ?? null };
      const event = frozen({ ...body, event_hash: digest(body) }), encoded = descriptor(event, limits.receipt_record_bytes);
      ensure(confirmedBytes + encoded.bytes <= limits.receipt_bytes, "evidence_capacity");
      pending = { event, encoded, binding: recordBinding, fixtureName: recordName, stamp: d.stamp, effects }; return encoded;
    }, true); },
    // Every state change of a record takes effect only once its exact line is read back.
    confirmReceipt(line) { return guard(() => {
      ensure(pending && line === pending.encoded.line, "readback_mismatch");
      events.push(pending.event); confirmedBytes += pending.encoded.bytes; commitStamp(pending.stamp);
      binding = pending.binding; fixtureName = pending.fixtureName; pending.effects.forEach((apply) => apply()); pending = null; return describe();
    }); },
    createReport(input) { return guard(() => {
      ensure(!pending && !report && events.at(-1)?.kind === "ready_to_report");
      const p = parse(reportInput, input); checkStamp(p.save_stamp); commitStamp(p.save_stamp);
      report = descriptor({ schema: "native-bar-unsigned-execution-report-v1", ...unqualified(), allocation, binding, outcome: resultOutcome,
        negative_assessment: assessment, teardown: { removed_entries: removedEntries, absence, worker_exit: finalized },
        receipt_prefix_sha256: events.at(-1).event_hash, receipt_prefix_records: events.length,
        // A root locator carried by a stop stays only in the private receipt.
        baseline, run_outcome: run, release, failure_summaries: events.filter((e) => e.kind === "stop_summary")
          .map(({ payload: { fixture_name: _locator, ...summary } }) => summary),
        limitations: p.limitations, save_stamp: p.save_stamp,
        observation_origin: "supplied_model_data_only", timestamps_verified: false,
        c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null }, limits.report_bytes);
      return report;
    }); },
    confirmReport(line) { return guard(() => {
      ensure(report && !reportConfirmed && line === report.line, "readback_mismatch"); reportConfirmed = true; return describe();
    }); },
    createIndex() { return guard(() => {
      ensure(!pending && reportConfirmed && !index && events.at(-1)?.kind === "terminal");
      index = descriptor({ schema: "native-bar-unsigned-execution-index-v1", allocation, binding, outcome: resultOutcome,
        terminal_receipt_sha256: events.at(-1).event_hash, report_sha256: report.sha256 }, 5290);
      return index;
    }); },
    confirmIndex(line) { return guard(() => {
      ensure(index && !indexConfirmed && line === index.line, "readback_mismatch"); indexConfirmed = true; return describe();
    }); },
    describe,
  });
}

export function inspectUnsignedExecutionEvidence(input) {
  const d = parse(z.object({ allocation: allocationDeclaration, expected_declaration: declaration.nullable(), receipt_lines: z.array(z.string()).min(1).max(64),
    report_line: z.string(), index_line: z.string() }).strict(), input);
  const model = createUnsignedExecutionEvidenceModel(d.allocation);
  const report = decodeLine(d.report_line, limits.report_bytes);
  for (const line of d.receipt_lines) {
    const event = decodeLine(line, limits.receipt_record_bytes);
    if (event.kind === "terminal") {
      const encoded = model.createReport({ limitations: report.limitations, save_stamp: report.save_stamp });
      if (encoded.line !== d.report_line) refuse("report_binding"); model.confirmReport(d.report_line);
    }
    const encoded = model.append({ kind: event.kind, payload: event.payload, stamp: event.stamp });
    if (encoded.line !== line) refuse("receipt_binding"); model.confirmReceipt(line);
  }
  if (model.createIndex().line !== d.index_line) refuse("index_binding"); model.confirmIndex(d.index_line);
  if (canonical(model.describe().binding) !== canonical(d.expected_declaration === null ? null : context(d.expected_declaration).binding)) refuse("binding_changed");
  return model.describe();
}
