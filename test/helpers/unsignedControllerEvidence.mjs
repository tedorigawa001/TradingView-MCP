import { z } from "zod";
import { describeUnsignedFixture, describeUnsignedAcceptanceRun } from "./jointUnsignedAcceptanceContracts.mjs";
import { createUnsignedControllerProtocolModel } from "./unsignedControllerContracts.mjs";
import { observationSchema, validateUnsignedControllerObservation, assessUnsignedControllerAssertions } from "./unsignedControllerObservation.mjs";
import { uint, code, label, digestSchema as hash, count, parse, canonical, digest, sha, byteLength, descriptor, decode,
  resourcesSchema, traceSchema, freeze, flags, refuse, LIMITS } from "./unsignedControllerData.mjs";

const stopDetail = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("failed"), sha256: hash }).strict(),
  z.object({ kind: z.literal("cancel"), outcome: z.enum(["not_sent", "started", "completed", "uncertain"]), ordinal: count(32).nullable() }).strict(),
  z.object({ kind: z.literal("worker"), disposition: z.enum(["exited", "retained", "unknown"]), exit_code: count(255).nullable(), signal: z.string().regex(/^SIG[A-Z0-9]{1,12}$/).nullable() }).strict(),
  z.object({ kind: z.literal("output"), stream: z.enum(["stdout", "stderr"]), bytes: uint, sha256: hash }).strict(),
  z.object({ kind: z.literal("close"), errors: z.array(code).max(8) }).strict(),
]);
const proof = z.object({ kind: z.enum(["directory", "file"]), device: uint, inode: uint, uid: uint, gid: uint,
  mode: z.enum(["16832", "33152"]), flags: z.literal("0"), birthtime_ns: uint, mtime_ns: uint, ctime_ns: uint,
  nlink: uint, size: uint, allocated_bytes: uint, acl: z.enum(["none", "deny_only"]), acl_hash: hash, sha256: hash.nullable() }).strict();
const setup = z.object({ fixture_name: z.string().regex(/^native-bar-fs-synthetic-[A-Za-z0-9]{6}$/), recipe_sha256: hash, registration_sha256: hash, envelope_sha256: hash }).strict();
const result = z.enum(["MODEL_CONSISTENT", "FAIL", "BLOCKED", "NOT_RUN"]);
const receiptPayload = {
  case_allocated: z.object({}).strict(),
  create_intent: z.object({ entry_index: count(15), ready_sha256: hash.optional() }).strict(),
  create_result: z.object({ entry_index: count(15), proof, fixture_name: setup.shape.fixture_name.optional() }).strict(),
  setup_sealed: z.object({ inventory_sha256: hash, setup }).strict(),
  worker_prepared: z.object({}).strict(),
  baseline_bound: z.object({ baseline_sha256: hash, resources: resourcesSchema }).strict(),
  go_intent: z.object({ baseline_sha256: hash }).strict(),
  run_outcome: z.object({ primary_code: code, requests_dispatched: count(2), authenticated_requests: count(2),
    diagnostic_sha256: hash.nullable(), observation_sha256: hash.nullable(), observation_bytes: count(16384), trace_sha256: hash, trace_events: count(128) }).strict(),
  release_checked: z.object({ baseline_sha256: hash, resources: resourcesSchema, query_released: z.literal(true), original_operation_retired: z.literal(true), close_errors: z.array(code).max(8) }).strict(),
  cleanup_precheck: z.object({ inventory_sha256: hash }).strict(),
  delete_intent: z.object({ entry_index: count(15), proof }).strict(),
  delete_result: z.object({ entry_index: count(15), outcome: z.literal("removed") }).strict(),
  absence_checked: z.object({ anchor_same: z.literal(true), root_removed: z.literal(true), absent: z.literal(true) }).strict(),
  worker_finalized: z.object({ exit_code: z.literal(0), signal: z.null() }).strict(),
  ready_to_report: z.object({ candidate_outcome: result, assessment_sha256: hash.nullable() }).strict(),
  terminal: z.object({ report_sha256: hash }).strict(),
  stop_summary: z.object({ reason: code, details: z.array(stopDetail).max(6), fixture_name: setup.shape.fixture_name.optional() }).strict(),
};
const stamp = z.object({ clock_domain: label, monotonic_ns: uint }).strict();
const receiptInput = z.object({ kind: z.enum(Object.keys(receiptPayload)), payload: z.unknown(), stamp }).strict();
const comparisonSchema = z.object({ witness: z.object({ sha256: hash, bytes: uint }).strict().nullable(),
  registration_comparison: z.object({ correct: z.unknown(), supplied: z.unknown() }).strict().nullable(), work_envelope: z.unknown().nullable() }).strict();
const identity = (p) => { const { size, nlink, allocated_bytes, mtime_ns, ctime_ns, ...v } = p; return p.kind === "directory" ? v : p; };

export function createUnsignedControllerEvidenceModel(input) {
  const base = createUnsignedControllerProtocolModel(input).describe().binding;
  const original = parse(z.object({ fixture: z.unknown() }).passthrough(), input).fixture;
  const recipe = describeUnsignedFixture({ ...original, fixture_name: "native-bar-fs-synthetic-Plan00" });
  const planned = describeUnsignedAcceptanceRun(recipe.declaration.request).cases.find((c) => c.case_id === original.case_id && c.mode === original.mode);
  if (4 * recipe.entries.length + 16 > 64) refuse("receipt_capacity");
  const indexed = recipe.entries.map((e, entry_index) => ({ ...e, entry_index }));
  const depth = (p) => p ? p.split("/").length : 0;
  const order = [...indexed].sort((a, b) => depth(b.path) - depth(a.path) || (a.kind === b.kind ? 0 : a.kind === "file" ? -1 : 1)
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const schedule = [["case_allocated"], ...indexed.flatMap((e) => [["create_intent", e.entry_index], ["create_result", e.entry_index]]),
    ...["setup_sealed", "worker_prepared", "baseline_bound", "go_intent", "run_outcome", "release_checked", "cleanup_precheck"].map((k) => [k]),
    ...order.flatMap((e) => [["delete_intent", e.entry_index], ["delete_result", e.entry_index]]),
    ...["absence_checked", "worker_finalized", "ready_to_report", "terminal"].map((k) => [k])];
  let position = 0, pending = null, hardStop = null, lastNs = null, domain = null, binding = base, rootName = null;
  let baseline = null, inventoryHash = null, run = null, removed = 0, stopped = false, stops = 0, candidate = null;
  let report = null, reportReadback = false, closes = null, index = null, indexReadback = false;
  const lines = [], events = [], proofs = new Map(); let confirmedBytes = 0;
  const fail = (reason) => { hardStop ??= reason; refuse(reason); };
  const check = () => { if (hardStop) refuse("evidence_stopped"); };
  const describe = () => freeze({ schema: "native-bar-unsigned-controller-evidence-model-v2", ...flags(), binding,
    confirmed_records: events.length, confirmed_bytes: confirmedBytes, pending_readback: pending ? "receipt" : report && !reportReadback ? "report" : index && !indexReadback ? "index" : null,
    stop_reason: hardStop, case_stopped: stopped, removed_entries: removed, candidate_outcome: candidate?.candidate_outcome ?? null,
    final_model_verdict: indexReadback ? index.value.model_verdict : null, finalization: indexReadback ? "pending_index_close" : "incomplete", case_closes: closes,
    receipt_sha256: sha(lines.join("")), report_sha256: report?.sha256 ?? null, index_sha256: index?.sha256 ?? null });
  const model = {
    append(raw) {
      check(); if (pending || report && reportReadback && events.at(-1)?.kind === "terminal" || index) fail("evidence_order");
      const d = parse(receiptInput, raw), p = parse(receiptPayload[d.kind], d.payload); let effect = () => {};
      if (domain !== null && domain !== d.stamp.clock_domain || lastNs !== null && BigInt(d.stamp.monotonic_ns) < lastNs) fail("clock_order");
      if (d.kind === "stop_summary") {
        if (!events.length || candidate || stops >= 4) fail("stop_order");
        if (p.fixture_name && (rootName !== null && p.fixture_name !== rootName || !events.some((e) => e.kind === "create_intent" && e.payload.entry_index === 0))) fail("fixture_binding");
        effect = () => { stopped = true; stops++; rootName ??= p.fixture_name ?? null; };
      } else if (stopped && d.kind === "ready_to_report") {
        if (candidate || report) fail("report_order");
        if (p.candidate_outcome === "MODEL_CONSISTENT" || p.candidate_outcome === "NOT_RUN" && events.some((e) => e.kind === "go_intent")) fail("false_outcome");
        effect = () => { candidate = p; position = schedule.findIndex(([k]) => k === "terminal"); };
      } else {
        const expected = schedule[position];
        if (!expected || d.kind !== expected[0] || expected[1] !== undefined && p.entry_index !== expected[1] || stopped && d.kind !== "terminal") fail("evidence_order");
        const effects = [];
        if (d.kind === "create_intent" && p.entry_index === 0 && !p.ready_sha256) fail("ready_required");
        if (d.kind === "create_result") {
          const e = indexed[p.entry_index];
          if (p.proof.kind !== e.kind || p.proof.mode !== (e.kind === "file" ? "33152" : "16832")
            || e.kind === "file" && (p.proof.nlink !== "1" || p.proof.size !== e.size || p.proof.sha256 !== e.sha256)
            || e.kind === "directory" && p.proof.sha256 !== null) fail("creation_proof");
          if ([...proofs.values()].some((v) => v.device !== p.proof.device || v.uid !== p.proof.uid || v.gid !== p.proof.gid || v.inode === p.proof.inode)) fail("creation_identity");
          if (p.entry_index === 0 ? !p.fixture_name : p.fixture_name !== undefined) fail("fixture_binding");
          effects.push(() => { proofs.set(p.entry_index, p.proof); if (p.entry_index === 0) rootName = p.fixture_name; });
        }
        if (d.kind === "setup_sealed") {
          const full = describeUnsignedFixture({ ...original, fixture_name: rootName });
          if (p.setup.fixture_name !== rootName || p.setup.recipe_sha256 !== full.recipe_sha256) fail("setup_binding");
          effects.push(() => { binding = freeze({ ...base, setup: p.setup }); inventoryHash = p.inventory_sha256; });
        }
        if (d.kind === "baseline_bound") effects.push(() => { baseline = p; });
        if (d.kind === "go_intent" && p.baseline_sha256 !== baseline.baseline_sha256) fail("baseline_changed");
        if (d.kind === "run_outcome") {
          if ((p.observation_sha256 === null) !== (p.observation_bytes === 0) || p.authenticated_requests > p.requests_dispatched) fail("result_binding");
          effects.push(() => { run = p; });
        }
        if (d.kind === "release_checked" && (p.baseline_sha256 !== baseline.baseline_sha256 || p.close_errors.length
          || ["fds", "roots", "workspace"].some((k) => p.resources[k] !== baseline.resources[k])
          || BigInt(p.resources.retained) < BigInt(baseline.resources.retained))) fail("release_unconfirmed");
        if (d.kind === "cleanup_precheck" && p.inventory_sha256 !== inventoryHash) fail("inventory_changed");
        if (d.kind === "delete_intent" && canonical(identity(p.proof)) !== canonical(identity(proofs.get(p.entry_index)))) fail("delete_identity");
        if (d.kind === "delete_result") effects.push(() => { removed++; });
        if (d.kind === "ready_to_report") {
          if (p.candidate_outcome === "NOT_RUN" || p.candidate_outcome === "MODEL_CONSISTENT" && (!p.assessment_sha256
            || run.primary_code !== planned.expected_code || run.requests_dispatched !== 1
            || run.authenticated_requests !== (planned.owner === "fixed_memory" ? 1 : 0) || run.observation_sha256 === null)) fail("false_outcome");
          effects.push(() => { candidate = p; });
        }
        if (d.kind === "terminal" && (!reportReadback || p.report_sha256 !== report.sha256)) fail("report_binding");
        effect = () => { effects.forEach((f) => f()); position++; };
      }
      const event = { schema: "native-bar-unsigned-receipt-v2", ...flags(), binding,
        ordinal: events.length + 1, previous_sha256: events.length ? sha(lines.at(-1)) : null, ...d, payload: p };
      if (events.length >= 64) fail("receipt_capacity"); const encoded = descriptor(event, 16384);
      if (confirmedBytes + encoded.bytes > 1048576) fail("receipt_capacity");
      pending = { encoded, effect, event }; return encoded;
    },
    confirmReceipt(line) {
      check(); if (!pending || line !== pending.encoded.line) fail("readback_mismatch");
      pending.effect(); domain = pending.event.stamp.clock_domain; lastNs = BigInt(pending.event.stamp.monotonic_ns);
      confirmedBytes += pending.encoded.bytes; events.push(freeze(pending.event)); lines.push(line); pending = null; return describe();
    },
    createReport(raw) {
      check(); if (pending || !candidate || report || events.at(-1)?.kind !== "ready_to_report") fail("report_order");
      const d = parse(z.object({ observation: observationSchema.nullable(), trace: z.array(traceSchema).max(128), limitations: z.array(code).max(8),
        comparison: comparisonSchema.nullable().default(null) }).strict(), raw);
      if (d.observation) { validateUnsignedControllerObservation(d.observation);
        if (!run || digest(d.observation) !== run.observation_sha256 || byteLength(canonical(d.observation)) !== run.observation_bytes) fail("observation_binding"); }
      else if (run?.observation_sha256) fail("observation_binding");
      if (candidate.candidate_outcome === "MODEL_CONSISTENT") {
        const diagnostic = d.observation?.diagnostic;
        if (!diagnostic || diagnostic.sha256 !== run?.diagnostic_sha256 || d.observation.primary_code !== run.primary_code
          || diagnostic.requests_dispatched !== run.requests_dispatched || diagnostic.authenticated_requests !== run.authenticated_requests) fail("diagnostic_binding");
      }
      if (run ? run.trace_sha256 !== digest(d.trace) || run.trace_events !== d.trace.length : d.trace.length) fail("trace_binding");
      for (const [i, e] of d.trace.entries()) if (e.ordinal !== i + 1 || byteLength(canonical(e)) > 1024) fail("trace_order");
      let assessment = null;
      if (d.comparison) {
        if (byteLength(canonical(d.comparison)) > 16384 || !d.observation || !binding.setup) fail("assessment_binding");
        assessment = assessUnsignedControllerAssertions({ request: recipe.declaration.request, fixture: { ...original, fixture_name: binding.setup.fixture_name }, case_id: binding.case_id, observation: d.observation,
          reader_source_sha256: binding.reader_source_sha256, reader_js_sha256: binding.reader_js_sha256,
          registration_sha256: binding.setup.registration_sha256, envelope_sha256: binding.setup.envelope_sha256, ...d.comparison });
        if (byteLength(canonical(assessment)) > 4096) fail("assessment_capacity");
      }
      if (candidate.assessment_sha256 !== (assessment ? digest(assessment) : null)
        || candidate.candidate_outcome === "MODEL_CONSISTENT" && assessment?.model_outcome !== "CONSISTENT_SUPPLIED_ASSERTIONS") fail("assessment_binding");
      const value = { schema: "native-bar-unsigned-candidate-report-v2", ...flags(), binding, ...candidate,
        finalization: "pending_case_writer_closes", receipt_prefix_sha256: sha(lines.join("")), confirmed_records: events.length,
        observation: d.observation, trace: d.trace, comparison: d.comparison, assessment,
        failure_summaries: events.filter((e) => e.kind === "stop_summary").map((e) => e.payload), limitations: d.limitations };
      report = { ...descriptor(value, 262144), value: freeze(value) }; return freeze({ line: report.line, sha256: report.sha256, bytes: report.bytes });
    },
    confirmReport(line) { check(); if (!report || reportReadback || line !== report.line) fail("readback_mismatch"); reportReadback = true; return describe(); },
    noteCaseCloses(raw) {
      check(); if (pending || events.at(-1)?.kind !== "terminal" || closes) fail("close_order");
      closes = freeze(parse(z.object({ receipt: z.enum(["confirmed", "unconfirmed"]), report: z.enum(["confirmed", "unconfirmed"]), errors: z.array(code).max(8) }).strict(), raw)); return describe();
    },
    createIndexRow() {
      check(); if (!closes || index) fail("index_order");
      const clean = closes.receipt === "confirmed" && closes.report === "confirmed" && !closes.errors.length;
      const value = { schema: "native-bar-unsigned-case-index-v2", ...flags(), binding,
        report_sha256: report.sha256, terminal_receipt_sha256: sha(lines.at(-1)), case_closes: closes,
        model_verdict: clean ? candidate.candidate_outcome : "FAIL", finalization: "pending_index_close" };
      index = { ...descriptor(value, 5290), value: freeze(value) }; return freeze({ line: index.line, sha256: index.sha256, bytes: index.bytes });
    },
    confirmIndexRow(line) { check(); if (!index || indexReadback || line !== index.line) fail("readback_mismatch"); indexReadback = true; return describe(); },
    describe,
  };
  return Object.freeze(Object.fromEntries(Object.entries(model).map(([name, method]) => [name, name === "describe" ? method : (...args) => {
    check(); try { return method(...args); } catch (error) { hardStop ??= "invalid_input"; throw error; }
  }])));
}

export function createUnsignedControllerCohortModel(input) {
  const d = parse(z.object({ request: z.unknown() }).strict(), input), plan = describeUnsignedAcceptanceRun(d.request);
  let stopped = false, active = null, finalClose = null;
  const rows = []; let bytes = 0;
  const describe = () => freeze({ ...flags(), schema: "native-bar-unsigned-cohort-model-v2", run_id: plan.declaration.run_id, plan_sha256: plan.plan_sha256, rows: [...rows], active,
    stopped, confirmed_index_bytes: bytes, index_close: finalClose, runtime_completion_proven: false,
    model_status: !stopped && rows.length === 24 && finalClose === "confirmed" && !active && rows.every((r) => r.index_readback) ? "consistent_supplied_cohort" : "incomplete_supplied_cohort" });
  const model = {
    beginCase(raw) {
      const q = parse(z.object({ case_id: label, mode: z.enum(["normal", "ubsan"]), remaining_ms: uint }).strict(), raw);
      if (stopped || active || finalClose || rows.length >= 24) refuse("cohort_order");
      const expected = plan.cases[rows.length];
      if (q.case_id !== expected.case_id || q.mode !== expected.mode) refuse("cohort_case_binding");
      if (BigInt(q.remaining_ms) < 900000n) { stopped = true; return describe(); }
      active = { case_id: q.case_id, mode: q.mode }; return describe();
    },
    finishCase(raw) {
      const q = parse(z.object({ case_id: label, mode: z.enum(["normal", "ubsan"]), model_verdict: z.enum(["MODEL_CONSISTENT", "FAIL", "BLOCKED"]),
        cleanly_settled: z.boolean(), index_readback: z.boolean(), index_bytes: count(5290, 1) }).strict(), raw);
      if (stopped || !active || q.case_id !== active.case_id || q.mode !== active.mode || finalClose) refuse("cohort_order");
      if (!q.index_readback || !q.cleanly_settled) { stopped = true; return describe(); }
      if (bytes + q.index_bytes + 4096 > 131072) refuse("index_capacity");
      bytes += q.index_bytes; rows.push(freeze(q)); active = null; return describe();
    },
    stop() { stopped = true; return describe(); },
    finishNotRun() { if (!stopped) refuse("cohort_order");
      if (active) { rows.push(freeze({ ...active, model_verdict: "FAIL", unindexed: true, index_readback: false })); active = null; }
      while (rows.length < 24) rows.push(freeze({ ordinal: rows.length + 1, model_verdict: "NOT_RUN", index_readback: false })); return describe(); },
    closeIndex(raw) { const q = parse(z.object({ outcome: z.enum(["confirmed", "unconfirmed"]) }).strict(), raw);
      if (finalClose || rows.length !== 24) refuse("close_order"); finalClose = q.outcome; if (q.outcome !== "confirmed") stopped = true; return describe(); },
    describe,
  };
  return Object.freeze(Object.fromEntries(Object.entries(model).map(([name, method]) => [name, name === "describe" ? method : (...args) => {
    try { return method(...args); } catch (error) { stopped = true; throw error; }
  }])));
}

export function inspectUnsignedControllerEvidence(input) {
  const d = parse(z.object({ allocation: z.unknown(), receipt_lines: z.array(z.string()).min(1).max(64), report_line: z.string(), index_line: z.string() }).strict(), input);
  if (d.receipt_lines.reduce((n, s) => n + byteLength(s), 0) > 1048576) refuse("receipt_capacity");
  const report = decode(d.report_line, 262144), index = decode(d.index_line, 5290), model = createUnsignedControllerEvidenceModel(d.allocation);
  for (const line of d.receipt_lines) {
    const e = decode(line, 16384);
    if (e.kind === "terminal") {
      const encoded = model.createReport({ observation: report.observation, trace: report.trace, comparison: report.comparison, limitations: report.limitations });
      if (encoded.line !== d.report_line) refuse("report_binding"); model.confirmReport(d.report_line);
    }
    const encoded = model.append({ kind: e.kind, payload: e.payload, stamp: e.stamp });
    if (encoded.line !== line) refuse("receipt_binding"); model.confirmReceipt(line);
  }
  model.noteCaseCloses(index.case_closes); const encoded = model.createIndexRow();
  if (encoded.line !== d.index_line) refuse("index_binding"); model.confirmIndexRow(d.index_line);
  return freeze({ ...model.describe(), model_status: "consistent_supplied_evidence", replayed_runtime_completion: "NOT_PROVEN" });
}

export function describeUnsignedControllerSerializationCapacity(input) {
  const actual = createUnsignedControllerProtocolModel(input).describe().binding;
  const h = "f".repeat(64), u = "9".repeat(30), c = "c".repeat(96), l = "l".repeat(48);
  const binding = { ...actual, run_id: l, case_id: l, mode: "normal", exchange_id: l, launch_nonce: l,
    setup: { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h } };
  const detailVariants = [
    { kind: "failed", sha256: h }, { kind: "cancel", outcome: "uncertain", ordinal: 32 },
    { kind: "worker", disposition: "retained", exit_code: 255, signal: "SIG" + "X".repeat(12) },
    { kind: "output", stream: "stdout", bytes: u, sha256: h }, { kind: "output", stream: "stderr", bytes: u, sha256: h },
    { kind: "close", errors: Array(8).fill(c) },
  ].map((v) => parse(stopDetail, v));
  // Detail kinds may repeat, so each slot must reserve the largest allowed variant.
  const largestDetail = detailVariants.reduce((a, b) => byteLength(canonical(a)) >= byteLength(canonical(b)) ? a : b);
  const detail = Array(6).fill(largestDetail);
  const stop = parse(receiptPayload.stop_summary, { reason: c, details: detail, fixture_name: binding.setup.fixture_name });
  const stopRecord = { schema: "native-bar-unsigned-receipt-v2", ...flags(), binding, ordinal: 64, previous_sha256: h,
    kind: "stop_summary", payload: stop, stamp: { clock_domain: l, monotonic_ns: u } };
  const frame = (kind, payload) => ({ binding, direction: "worker", ordinal: 32, kind, payload });
  const size = (v) => byteLength(canonical(v)) + 1;
  const resources = { fds: u, roots: u, workspace: u, retained: u };
  const proof = { kind: "file", device: u, inode: u, uid: u, gid: u, mode: "33152", flags: "0", birthtime_ns: u, mtime_ns: u, ctime_ns: u,
    nlink: u, size: u, allocated_bytes: u, acl: "deny_only", acl_hash: h, sha256: h };
  const payloads = {
    case_allocated: {}, create_intent: { entry_index: 15, ready_sha256: h }, create_result: { entry_index: 15, proof, fixture_name: binding.setup.fixture_name },
    setup_sealed: { inventory_sha256: h, setup: binding.setup }, worker_prepared: {}, baseline_bound: { baseline_sha256: h, resources }, go_intent: { baseline_sha256: h },
    run_outcome: { primary_code: c, requests_dispatched: 2, authenticated_requests: 2, diagnostic_sha256: h, observation_sha256: h, observation_bytes: 16384, trace_sha256: h, trace_events: 128 },
    release_checked: { baseline_sha256: h, resources, query_released: true, original_operation_retired: true, close_errors: Array(8).fill(c) },
    cleanup_precheck: { inventory_sha256: h }, delete_intent: { entry_index: 15, proof }, delete_result: { entry_index: 15, outcome: "removed" },
    absence_checked: { anchor_same: true, root_removed: true, absent: true }, worker_finalized: { exit_code: 0, signal: null },
    ready_to_report: { candidate_outcome: "MODEL_CONSISTENT", assessment_sha256: h }, terminal: { report_sha256: h }, stop_summary: stop,
  };
  const receiptSizes = Object.fromEntries(Object.entries(payloads).map(([kind, payload]) => {
    const validated = parse(receiptPayload[kind], payload); return [kind, size({ ...stopRecord, kind, payload: validated })];
  }));
  const prepare = size(frame("PREPARE", { launch_nonce: l, configuration: null })) - 4 + 60000;
  const traceFrame = size(frame("TRACE_CHUNK", { chunk_index: 7, events: null })) - 4 + 2 + 16 * 1024 + 15;
  const report = { schema: "native-bar-unsigned-candidate-report-v2", ...flags(), binding,
    candidate_outcome: "MODEL_CONSISTENT", assessment_sha256: h, finalization: "pending_case_writer_closes", receipt_prefix_sha256: h,
    confirmed_records: 64, observation: null, trace: null, comparison: null, assessment: null, failure_summaries: Array(4).fill(stop), limitations: Array(8).fill(c) };
  const reportBytes = size(report) - 16 + 16384 + 16384 + 4096 + 2 + 128 * 1024 + 127;
  const row = { schema: "native-bar-unsigned-case-index-v2", ...flags(), binding, report_sha256: h, terminal_receipt_sha256: h,
    case_closes: { receipt: "unconfirmed", report: "unconfirmed", errors: Array(8).fill(c) }, model_verdict: "MODEL_CONSISTENT", finalization: "pending_index_close" };
  const released = { baseline_sha256: h, resources, query: "settled", native: "settled", original_operation_retired: true, query_released: true,
    close_errors: Array(8).fill(c), diagnostic_sha256: h, observation_sha256: h, trace_chunks: 8, trace_events: 128, trace_sha256: h,
    primary_code: c, requests_dispatched: 2, authenticated_requests: 2, c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null };
  const failure = { phase: "settlement", primary_code: c, close_errors: Array(8).fill(c), diagnostic_sha256: h, resources, query_created: true, instrumentation_overflow: true };
  const frameSizes = { LAUNCH: size(frame("LAUNCH", {})), READY: size(frame("READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: h })),
    PREPARE: prepare, BASELINED: size(frame("BASELINED", { resources, clock_domain: l })),
    GO: size(frame("GO", { baseline_sha256: h, baseline_readback: true, go_intent_readback: true })), TRACE_CHUNK: traceFrame,
    OBSERVED: size(frame("OBSERVED", null)) - 4 + 16384, RELEASED: size(frame("RELEASED", released)), FAILED: size(frame("FAILED", failure)),
    CANCEL: size(frame("CANCEL", {})), FINALIZE: size(frame("FINALIZE", {})) };
  const measured = { stop_summary_bytes: size(stopRecord), maximum_receipt_record_bytes: Math.max(...Object.values(receiptSizes)),
    prepare_frame_ceiling: prepare, trace_frame_ceiling: traceFrame, maximum_frame_bytes: Math.max(...Object.values(frameSizes)), report_ceiling: reportBytes, index_row_bytes: size(row) };
  if (measured.maximum_receipt_record_bytes > 16384 || measured.maximum_frame_bytes > 65536 || reportBytes > 262144 || measured.index_row_bytes > 5290) refuse("serialization_capacity");
  return freeze({ schema: "native-bar-unsigned-controller-serialization-capacity-v2", ...flags(), ...measured,
    calculation: "canonical_fixed_fields_plus_enforced_subvalue_byte_caps", maximum_stop_summaries: 4,
    receipt_maximum_bytes: 64 * 16384, index_reserved_bytes: 4096 + 24 * 5290,
    receipt_kind_ceilings: receiptSizes, frame_kind_ceilings: frameSizes, worst_stop_summary: descriptor(stopRecord, 16384), native_budget_changed: false });
}
