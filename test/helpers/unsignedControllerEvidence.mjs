import { z } from "zod";
import { describeUnsignedFixture, describeUnsignedAcceptanceRun } from "./jointUnsignedAcceptanceContracts.mjs";
import { createUnsignedControllerProtocolModel } from "./unsignedControllerContracts.mjs";
import { observationSchema, validateUnsignedControllerObservation, assessUnsignedControllerAssertions } from "./unsignedControllerObservation.mjs";
import { uint, code, label, digestSchema as hash, count, parse, canonical, digest, sha, byteLength, descriptor, decode,
  resourcesSchema, baselineSchema, traceSchema, freeze, flags, refuse, LIMITS } from "./unsignedControllerData.mjs";

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
  baseline_bound: baselineSchema,
  // The supervisor's independent bound-object proofs, taken before GO and after RELEASED, are committed by digest.
  go_intent: z.object({ baseline_sha256: hash, bound_objects_sha256: hash.nullable() }).strict(),
  run_outcome: z.object({ primary_code: code, requests_dispatched: count(2), authenticated_requests: count(2),
    diagnostic_sha256: hash.nullable(), observation_sha256: hash.nullable(), observation_bytes: count(16384), trace_sha256: hash, trace_events: count(128) }).strict(),
  release_checked: z.object({ baseline_sha256: hash, resources: resourcesSchema, query_released: z.literal(true), original_operation_retired: z.literal(true),
    close_errors: z.array(code).max(8), bound_objects_sha256: hash.nullable() }).strict(),
  cleanup_precheck: z.object({ inventory_sha256: hash }).strict(),
  delete_intent: z.object({ entry_index: count(15), proof }).strict(),
  delete_result: z.object({ entry_index: count(15), outcome: z.literal("removed") }).strict(),
  absence_checked: z.object({ anchor_same: z.literal(true), root_removed: z.literal(true), absent: z.literal(true) }).strict(),
  worker_finalized: z.object({ exit_code: z.literal(0), signal: z.null() }).strict(),
  ready_to_report: z.object({ candidate_outcome: result, assessment_sha256: hash.nullable() }).strict(),
  terminal: z.object({ report_sha256: hash }).strict(),
  stop_summary: z.object({ reason: code, details: z.array(stopDetail).max(6), fixture_name: setup.shape.fixture_name.optional() }).strict(),
};
const stamp = z.object({ clock_domain: label, monotonic_ns: uint,
  wall_utc: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/), wall_jst: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+09:00$/) }).strict();
const receiptInput = z.object({ kind: z.enum(Object.keys(receiptPayload)), payload: z.unknown(), stamp }).strict();
const comparisonSchema = z.object({ witness: z.object({ sha256: hash, bytes: uint }).strict().nullable(), configuration: z.unknown().nullable(),
  supplied_registration: z.unknown().nullable(), bound_objects: z.object({ pre: z.unknown(), post: z.unknown() }).strict().nullable() }).strict();
const identity = (p) => { const { size, nlink, allocated_bytes, mtime_ns, ctime_ns, ...v } = p; return p.kind === "directory" ? v : p; };
// Reports and index rows carry opaque labels; the cleanup locator stays only in the private receipts.
const publicBinding = (b) => freeze({ ...b, setup: b.setup && { recipe_sha256: b.setup.recipe_sha256, registration_sha256: b.setup.registration_sha256,
  envelope_sha256: b.setup.envelope_sha256, setup_sha256: digest(b.setup) } });
const rank = { MODEL_CONSISTENT: 0, CONSISTENT_SUPPLIED_ASSERTIONS: 0, BLOCKED: 1, FAIL: 2 };

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
  let position = 0, pending = null, hardStop = null, refusal = null, refusalRecorded = false, lastNs = null, domain = null, binding = base, rootName = null;
  let baseline = null, baselineHash = null, goIntent = null, release = null, absence = null, finalized = null;
  let inventoryHash = null, run = null, removed = 0, stopped = false, stops = 0, candidate = null;
  let report = null, reportReadback = false, closes = null, index = null, indexReadback = false;
  const lines = [], events = [], proofs = new Map(); let confirmedBytes = 0;
  const check = () => { if (hardStop) refuse("evidence_stopped"); };
  const c1 = () => (run?.requests_dispatched ?? 0) > 1;
  const clock = (s) => { if (domain !== null && domain !== s.clock_domain || lastNs !== null && BigInt(s.monotonic_ns) < lastNs) refuse("clock_order"); };
  const describe = () => freeze({ schema: "native-bar-unsigned-controller-evidence-model-v2", ...flags(), binding,
    confirmed_records: events.length, confirmed_bytes: confirmedBytes, pending_readback: pending ? "receipt" : report && !reportReadback ? "report" : index && !indexReadback ? "index" : null,
    stop_reason: hardStop ?? refusal ?? events.find((e) => e.kind === "stop_summary")?.payload.reason ?? null, case_stopped: stopped || refusal !== null,
    removed_entries: removed, candidate_outcome: candidate?.candidate_outcome ?? null, c1_violation: c1(),
    final_model_verdict: indexReadback ? index.value.model_verdict : null, finalization: indexReadback ? "pending_index_close" : "incomplete", case_closes: closes,
    receipt_sha256: sha(lines.join("")), report_sha256: report?.sha256 ?? null, index_sha256: index?.sha256 ?? null });
  const model = {
    append(raw) {
      if (pending || report && reportReadback && events.at(-1)?.kind === "terminal" || index) refuse("evidence_order");
      const d = parse(receiptInput, raw), p = parse(receiptPayload[d.kind], d.payload); let effect = () => {};
      clock(d.stamp);
      const halted = stopped || refusal !== null;
      if (d.kind === "stop_summary") {
        if (!events.length || candidate || stops >= 4) refuse("stop_order");
        if (refusal !== null && !refusalRecorded && p.reason !== refusal) refuse("refusal_binding");
        if (p.fixture_name && (rootName !== null && p.fixture_name !== rootName || !events.some((e) => e.kind === "create_intent" && e.payload.entry_index === 0))) refuse("fixture_binding");
        effect = () => { stopped = true; stops++; refusalRecorded ||= refusal !== null; rootName ??= p.fixture_name ?? null; };
      } else if (refusal !== null && !refusalRecorded) refuse("refusal_unrecorded");
      else if (halted && d.kind === "ready_to_report") {
        if (candidate || report) refuse("report_order");
        if (p.candidate_outcome === "MODEL_CONSISTENT" || p.candidate_outcome === "NOT_RUN" && events.some((e) => e.kind === "go_intent")
          || c1() && p.candidate_outcome !== "FAIL") refuse("false_outcome");
        effect = () => { candidate = p; position = schedule.findIndex(([k]) => k === "terminal"); };
      } else {
        const expected = schedule[position];
        if (!expected || d.kind !== expected[0] || expected[1] !== undefined && p.entry_index !== expected[1] || halted && d.kind !== "terminal") refuse("evidence_order");
        const effects = [];
        if (d.kind === "create_intent" && p.entry_index === 0 && !p.ready_sha256) refuse("ready_required");
        if (d.kind === "create_result") {
          const e = indexed[p.entry_index];
          if (p.proof.kind !== e.kind || p.proof.mode !== (e.kind === "file" ? "33152" : "16832")
            || e.kind === "file" && (p.proof.nlink !== "1" || p.proof.size !== e.size || p.proof.sha256 !== e.sha256)
            || e.kind === "directory" && p.proof.sha256 !== null) refuse("creation_proof");
          if ([...proofs.values()].some((v) => v.device !== p.proof.device || v.uid !== p.proof.uid || v.gid !== p.proof.gid || v.inode === p.proof.inode)) refuse("creation_identity");
          if (p.entry_index === 0 ? !p.fixture_name : p.fixture_name !== undefined) refuse("fixture_binding");
          effects.push(() => { proofs.set(p.entry_index, p.proof); if (p.entry_index === 0) rootName = p.fixture_name; });
        }
        if (d.kind === "setup_sealed") {
          const full = describeUnsignedFixture({ ...original, fixture_name: rootName });
          if (p.setup.fixture_name !== rootName || p.setup.recipe_sha256 !== full.recipe_sha256) refuse("setup_binding");
          effects.push(() => { binding = freeze({ ...base, setup: p.setup }); inventoryHash = p.inventory_sha256; });
        }
        // The baseline hash is computed from the recorded counters, never accepted beside them.
        if (d.kind === "baseline_bound") effects.push(() => { baseline = freeze(p); baselineHash = digest(p); });
        if (d.kind === "go_intent") { if (p.baseline_sha256 !== baselineHash) refuse("baseline_changed"); effects.push(() => { goIntent = p; }); }
        if (d.kind === "run_outcome") {
          if ((p.observation_sha256 === null) !== (p.observation_bytes === 0) || p.authenticated_requests > p.requests_dispatched) refuse("result_binding");
          effects.push(() => { run = p; });
        }
        if (d.kind === "release_checked") {
          if (p.baseline_sha256 !== baselineHash || p.close_errors.length
            || ["fds", "roots", "workspace"].some((k) => p.resources[k] !== baseline.resources[k])
            || BigInt(p.resources.retained) < BigInt(baseline.resources.retained)) refuse("release_unconfirmed");
          effects.push(() => { release = p; });
        }
        if (d.kind === "cleanup_precheck" && p.inventory_sha256 !== inventoryHash) refuse("inventory_changed");
        if (d.kind === "delete_intent" && canonical(identity(p.proof)) !== canonical(identity(proofs.get(p.entry_index)))) refuse("delete_identity");
        if (d.kind === "delete_result") effects.push(() => { removed++; });
        if (d.kind === "absence_checked") effects.push(() => { absence = p; });
        if (d.kind === "worker_finalized") effects.push(() => { finalized = p; });
        if (d.kind === "ready_to_report") {
          if (p.candidate_outcome === "NOT_RUN" || p.candidate_outcome === "MODEL_CONSISTENT" && (!p.assessment_sha256
            || run.primary_code !== planned.expected_code || run.requests_dispatched !== 1
            || run.authenticated_requests !== (planned.owner === "fixed_memory" ? 1 : 0) || run.observation_sha256 === null)
            || c1() && p.candidate_outcome !== "FAIL") refuse("false_outcome");
          effects.push(() => { candidate = p; });
        }
        if (d.kind === "terminal" && (!reportReadback || p.report_sha256 !== report.sha256)) refuse("report_binding");
        effect = () => { effects.forEach((f) => f()); position++; };
      }
      const event = { schema: "native-bar-unsigned-receipt-v2", ...flags(), binding,
        ordinal: events.length + 1, previous_sha256: events.length ? sha(lines.at(-1)) : null, ...d, payload: p };
      if (events.length >= 64) refuse("receipt_capacity"); const encoded = descriptor(event, 16384);
      if (confirmedBytes + encoded.bytes > 1048576) refuse("receipt_capacity");
      pending = { encoded, effect, event }; return encoded;
    },
    confirmReceipt(line) {
      if (!pending || line !== pending.encoded.line) refuse("readback_mismatch");
      pending.effect(); domain = pending.event.stamp.clock_domain; lastNs = BigInt(pending.event.stamp.monotonic_ns);
      confirmedBytes += pending.encoded.bytes; events.push(freeze(pending.event)); lines.push(line); pending = null; return describe();
    },
    createReport(raw) {
      if (pending || !candidate || report || events.at(-1)?.kind !== "ready_to_report") refuse("report_order");
      const d = parse(z.object({ observation: observationSchema.nullable(), trace: z.array(traceSchema).max(128), limitations: z.array(code).max(8),
        comparison: comparisonSchema.nullable(), save_stamp: stamp }).strict(), raw);
      clock(d.save_stamp);
      if (d.observation) { validateUnsignedControllerObservation(d.observation);
        if (!run || digest(d.observation) !== run.observation_sha256 || byteLength(canonical(d.observation)) !== run.observation_bytes) refuse("observation_binding"); }
      else if (run?.observation_sha256) refuse("observation_binding");
      if (candidate.candidate_outcome === "MODEL_CONSISTENT") {
        const diagnostic = d.observation?.diagnostic;
        if (!diagnostic || diagnostic.sha256 !== run?.diagnostic_sha256 || d.observation.primary_code !== run.primary_code
          || diagnostic.requests_dispatched !== run.requests_dispatched || diagnostic.authenticated_requests !== run.authenticated_requests) refuse("diagnostic_binding");
      }
      if (run ? run.trace_sha256 !== digest(d.trace) || run.trace_events !== d.trace.length : d.trace.length) refuse("trace_binding");
      // The same trace gates as the protocol: one worker clock domain from the bound baseline, in order.
      let previous = null;
      for (const [i, e] of d.trace.entries()) {
        if (e.ordinal !== i + 1 || byteLength(canonical(e)) > 1024 || e.clock_domain !== baseline?.clock_domain
          || previous !== null && BigInt(e.monotonic_ns) < previous) refuse("trace_order");
        previous = BigInt(e.monotonic_ns);
      }
      let assessment = null;
      if (d.comparison) {
        if (byteLength(canonical(d.comparison)) > LIMITS.comparison_bytes || !d.observation || !binding.setup) refuse("assessment_binding");
        assessment = assessUnsignedControllerAssertions({ request: recipe.declaration.request, fixture: { ...original, fixture_name: binding.setup.fixture_name }, case_id: binding.case_id, observation: d.observation,
          reader_source_sha256: binding.reader_source_sha256, reader_js_sha256: binding.reader_js_sha256,
          registration_sha256: binding.setup.registration_sha256, envelope_sha256: binding.setup.envelope_sha256, ...d.comparison,
          bound_object_receipts: { pre_sha256: goIntent?.bound_objects_sha256 ?? null, post_sha256: release?.bound_objects_sha256 ?? null } });
        if (byteLength(canonical(assessment)) > LIMITS.assessment_bytes) refuse("assessment_capacity");
      }
      // A candidate may add facts that worsen the computed assertions, never hide them.
      if (candidate.assessment_sha256 !== (assessment ? digest(assessment) : null)
        || assessment && rank[candidate.candidate_outcome] < rank[assessment.model_outcome]) refuse("assessment_binding");
      const value = { schema: "native-bar-unsigned-candidate-report-v2", ...flags(), binding: publicBinding(binding), ...candidate,
        finalization: "pending_case_writer_closes", receipt_prefix_sha256: sha(lines.join("")), confirmed_records: events.length,
        case_started: events[0].stamp, save_stamp: d.save_stamp, baseline, run_outcome: run, release,
        teardown: { removed_entries: removed, absence, worker_exit: finalized }, c1_violation: c1(),
        observation: d.observation, trace: d.trace, comparison: d.comparison, assessment,
        failure_summaries: events.filter((e) => e.kind === "stop_summary").map(({ payload: { fixture_name: _locator, ...summary } }) => summary), limitations: d.limitations };
      const encoded = descriptor(value, 262144);
      domain = d.save_stamp.clock_domain; lastNs = BigInt(d.save_stamp.monotonic_ns);
      report = { ...encoded, value: freeze(value) }; return freeze({ line: report.line, sha256: report.sha256, bytes: report.bytes });
    },
    confirmReport(line) { if (!report || reportReadback || line !== report.line) refuse("readback_mismatch"); reportReadback = true; return describe(); },
    noteCaseCloses(raw) {
      if (pending || events.at(-1)?.kind !== "terminal" || closes) refuse("close_order");
      closes = freeze(parse(z.object({ receipt: z.enum(["confirmed", "unconfirmed"]), report: z.enum(["confirmed", "unconfirmed"]), errors: z.array(code).max(8) }).strict(), raw)); return describe();
    },
    createIndexRow() {
      if (!closes || index) refuse("index_order");
      const clean = closes.receipt === "confirmed" && closes.report === "confirmed" && !closes.errors.length;
      const value = { schema: "native-bar-unsigned-case-index-v2", ...flags(), binding: publicBinding(binding),
        report_sha256: report.sha256, terminal_receipt_sha256: sha(lines.at(-1)), case_closes: closes, c1_violation: c1(),
        model_verdict: clean ? candidate.candidate_outcome : "FAIL", finalization: "pending_index_close" };
      index = { ...descriptor(value, 5290), value: freeze(value) }; return freeze({ line: index.line, sha256: index.sha256, bytes: index.bytes });
    },
    confirmIndexRow(line) { if (!index || indexReadback || line !== index.line) refuse("readback_mismatch"); indexReadback = true; return describe(); },
    describe,
  };
  return Object.freeze(Object.fromEntries(Object.entries(model).map(([name, method]) => [name, name === "describe" ? method : (...args) => {
    check();
    try { return method(...args); }
    catch (error) {
      // A refused record is never written. Before the outcome is fixed it becomes a recordable stop that the next summary
      // must name; a pending or unreadable write, a capacity refusal or any report-phase refusal ends the chain.
      const reason = /^cc4a_[a-z_]+$/.test(error?.message) ? error.message.slice(5) : "invalid_input";
      if (name === "append" && !pending && !candidate && !report && reason !== "receipt_capacity") refusal ??= reason;
      else hardStop ??= reason;
      throw error;
    }
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
      const q = parse(z.object({ case_id: label, mode: z.enum(["normal", "ubsan"]), model_verdict: result, cleanly_settled: z.boolean(), c1_violation: z.boolean(),
        index_readback: z.boolean(), index_bytes: count(5290, 1), index_sha256: hash.nullable() }).strict(), raw);
      if (stopped || !active || q.case_id !== active.case_id || q.mode !== active.mode || finalClose) refuse("cohort_order");
      if ((q.index_sha256 === null) === q.index_readback || q.c1_violation && q.model_verdict !== "FAIL") refuse("cohort_case_binding");
      // An unconfirmed row is no evidence of its verdict: the attempted case stays FAIL/unindexed.
      if (!q.index_readback) { stopped = true; return describe(); }
      if (bytes + q.index_bytes + 4096 > 131072) refuse("index_capacity");
      // A confirmed row keeps its own verdict; retention, uncertainty or a C1 violation then stops every later case.
      bytes += q.index_bytes; rows.push(freeze(q)); active = null;
      if (!q.cleanly_settled || q.c1_violation) stopped = true;
      return describe();
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
  const d = parse(z.object({ allocation: z.unknown(), expected_setup: setup.nullable(), receipt_lines: z.array(z.string()).min(1).max(64),
    report_line: z.string(), index_line: z.string() }).strict(), input);
  if (d.receipt_lines.reduce((n, s) => n + byteLength(s), 0) > 1048576) refuse("receipt_capacity");
  const report = decode(d.report_line, 262144), index = decode(d.index_line, 5290), model = createUnsignedControllerEvidenceModel(d.allocation);
  for (const line of d.receipt_lines) {
    const e = decode(line, 16384);
    if (e.kind === "terminal") {
      const encoded = model.createReport({ observation: report.observation, trace: report.trace, comparison: report.comparison, limitations: report.limitations, save_stamp: report.save_stamp });
      if (encoded.line !== d.report_line) refuse("report_binding"); model.confirmReport(d.report_line);
    }
    const encoded = model.append({ kind: e.kind, payload: e.payload, stamp: e.stamp });
    if (encoded.line !== line) refuse("receipt_binding"); model.confirmReceipt(line);
  }
  model.noteCaseCloses(index.case_closes); const encoded = model.createIndexRow();
  if (encoded.line !== d.index_line) refuse("index_binding"); model.confirmIndexRow(d.index_line);
  // As in v1, replay is anchored to the setup the caller expected, not only to the lines' own hashes.
  if (canonical(model.describe().binding.setup) !== canonical(d.expected_setup)) refuse("binding_changed");
  return freeze({ ...model.describe(), model_status: "consistent_supplied_evidence", replayed_runtime_completion: "NOT_PROVEN" });
}

export function describeUnsignedControllerSerializationCapacity(input) {
  const actual = createUnsignedControllerProtocolModel(input).describe().binding;
  const h = "f".repeat(64), u = "9".repeat(30), c = "c".repeat(96), l = "l".repeat(48);
  const binding = { ...actual, run_id: l, case_id: l, mode: "normal", exchange_id: l, launch_nonce: l,
    setup: { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h } };
  const at = { clock_domain: l, monotonic_ns: u, wall_utc: "2026-10-28T00:00:00.000Z", wall_jst: "2026-10-28T09:00:00.000+09:00" };
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
    kind: "stop_summary", payload: stop, stamp: at };
  const frame = (kind, payload) => ({ binding, direction: "worker", ordinal: 32, kind, payload });
  const size = (v) => byteLength(canonical(v)) + 1;
  const resources = { fds: u, roots: u, workspace: u, retained: u };
  const proof = { kind: "file", device: u, inode: u, uid: u, gid: u, mode: "33152", flags: "0", birthtime_ns: u, mtime_ns: u, ctime_ns: u,
    nlink: u, size: u, allocated_bytes: u, acl: "deny_only", acl_hash: h, sha256: h };
  const run = { primary_code: c, requests_dispatched: 2, authenticated_requests: 2, diagnostic_sha256: h, observation_sha256: h, observation_bytes: 16384, trace_sha256: h, trace_events: 128 };
  const checked = { baseline_sha256: h, resources, query_released: true, original_operation_retired: true, close_errors: Array(8).fill(c), bound_objects_sha256: h };
  const payloads = {
    case_allocated: {}, create_intent: { entry_index: 15, ready_sha256: h }, create_result: { entry_index: 15, proof, fixture_name: binding.setup.fixture_name },
    setup_sealed: { inventory_sha256: h, setup: binding.setup }, worker_prepared: {}, baseline_bound: { resources, clock_domain: l },
    go_intent: { baseline_sha256: h, bound_objects_sha256: h }, run_outcome: run, release_checked: checked,
    cleanup_precheck: { inventory_sha256: h }, delete_intent: { entry_index: 15, proof }, delete_result: { entry_index: 15, outcome: "removed" },
    absence_checked: { anchor_same: true, root_removed: true, absent: true }, worker_finalized: { exit_code: 0, signal: null },
    ready_to_report: { candidate_outcome: "MODEL_CONSISTENT", assessment_sha256: h }, terminal: { report_sha256: h }, stop_summary: stop,
  };
  const receiptSizes = Object.fromEntries(Object.entries(payloads).map(([kind, payload]) => {
    const validated = parse(receiptPayload[kind], payload); return [kind, size({ ...stopRecord, kind, payload: validated })];
  }));
  // The largest comparison the schemas admit: a maximal configuration, supplied registration and both non-data proof sets.
  const uuid = "00000000-0000-4000-8000-000000000000", bound = { device: u, inode: u, uid: u, gid: u, mode: u, flags: "4294967295", birthtime_ns: u, acl: "deny_only", acl_hash: h };
  const directory = { ...bound, mode: "16832", flags: "0" }, marker = { ...directory, mode: "33152", nlink: "1", size: u, sha256: h };
  const bindings = { ancestors: ["/", "/private", "/private/tmp"].map((path) => ({ path, proof: bound })), fixture_parent: directory, data: directory, witness: directory, markers: { base: marker, admission: marker } };
  const registration = { schema: "native-bar-admission-read-registration-v1", scope: "synthetic_fixture_only", temp_anchor: "/private/tmp", fixture_name: binding.setup.fixture_name,
    policy_hash: h, authority_reference: uuid, pins: { fixture_id: uuid, store_id: uuid, epoch_id: uuid, authority_id: uuid, key_id: uuid, enrollment_hash: h, public_key_spki_sha256: h },
    bindings, volume: { filesystem: "apfs", local: true, ownership_enforced: true, case_preserving: true, case_sensitive: false, read_only_mount: false } };
  const roleTotals = { entries: "512", inventory_bytes: "1073741824", metadata_bytes: "16777216" }, { data: _data, ...nondata } = bindings;
  const comparison = { witness: { sha256: h, bytes: u }, configuration: { schema: "native-bar-unsigned-worker-configuration-v1",
    binding: { schema: "native-bar-joint-read-binding-v1", scope: "synthetic_joint_read_model_only", registration_hash: h, registration },
    work_envelope: { schema: "native-bar-joint-read-work-envelope-v1", inventory: { data: roleTotals, witness: roleTotals, common: roleTotals },
      objects: Object.fromEntries(["witness_records", "producer_mirrors", "payloads", "receipts", "maintenance_metadata"].map((k) => [k, "512"])),
      selected_bytes: "16777216", decoded_bytes: "16777216", interpretation_bytes: "8388608" } },
    supplied_registration: registration, bound_objects: { pre: nondata, post: nondata } };
  const prepare = size(frame("PREPARE", { launch_nonce: l, configuration: null })) - 4 + 60000;
  const traceFrame = size(frame("TRACE_CHUNK", { chunk_index: 7, events: null })) - 4 + 2 + 16 * 1024 + 15;
  const { fixture_name: _locator, ...summary } = stop;
  const report = { schema: "native-bar-unsigned-candidate-report-v2", ...flags(), binding: publicBinding(binding),
    candidate_outcome: "MODEL_CONSISTENT", assessment_sha256: h, finalization: "pending_case_writer_closes", receipt_prefix_sha256: h,
    confirmed_records: 64, case_started: at, save_stamp: at, baseline: payloads.baseline_bound, run_outcome: run, release: checked,
    teardown: { removed_entries: 16, absence: payloads.absence_checked, worker_exit: payloads.worker_finalized }, c1_violation: false,
    observation: null, trace: null, comparison: null, assessment: null, failure_summaries: Array(4).fill(summary), limitations: Array(8).fill(c) };
  const reportBytes = size(report) - 16 + LIMITS.observation_bytes + LIMITS.comparison_bytes + LIMITS.assessment_bytes + 2 + 128 * 1024 + 127;
  const row = { schema: "native-bar-unsigned-case-index-v2", ...flags(), binding: publicBinding(binding), report_sha256: h, terminal_receipt_sha256: h,
    case_closes: { receipt: "unconfirmed", report: "unconfirmed", errors: Array(8).fill(c) }, c1_violation: false, model_verdict: "MODEL_CONSISTENT", finalization: "pending_index_close" };
  const released = { baseline_sha256: h, resources, query: "settled", native: "settled", original_operation_retired: true, query_released: true,
    close_errors: Array(8).fill(c), diagnostic_sha256: h, observation_sha256: h, trace_chunks: 8, trace_events: 128, trace_sha256: h,
    primary_code: c, requests_dispatched: 2, authenticated_requests: 2, c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null };
  const failure = { phase: "settlement", primary_code: c, close_errors: Array(8).fill(c), diagnostic_sha256: h, resources, query_created: false, instrumentation_overflow: false };
  const frameSizes = { LAUNCH: size(frame("LAUNCH", {})), READY: size(frame("READY", { addon_protocol: 6, mode: "synthetic_only", pins_sha256: h })),
    PREPARE: prepare, BASELINED: size(frame("BASELINED", { resources, clock_domain: l })),
    GO: size(frame("GO", { baseline_sha256: h, baseline_readback: true, go_intent_readback: true })), TRACE_CHUNK: traceFrame,
    OBSERVED: size(frame("OBSERVED", null)) - 4 + 16384, RELEASED: size(frame("RELEASED", released)), FAILED: size(frame("FAILED", failure)),
    CANCEL: size(frame("CANCEL", {})), FINALIZE: size(frame("FINALIZE", {})) };
  const measured = { stop_summary_bytes: size(stopRecord), maximum_receipt_record_bytes: Math.max(...Object.values(receiptSizes)),
    prepare_frame_ceiling: prepare, trace_frame_ceiling: traceFrame, maximum_frame_bytes: Math.max(...Object.values(frameSizes)), report_ceiling: reportBytes, index_row_bytes: size(row),
    comparison_ceiling: size(comparison) - 1 };
  if (measured.maximum_receipt_record_bytes > 16384 || measured.maximum_frame_bytes > 65536 || reportBytes > 262144 || measured.index_row_bytes > 5290
    || measured.comparison_ceiling > LIMITS.comparison_bytes) refuse("serialization_capacity");
  return freeze({ schema: "native-bar-unsigned-controller-serialization-capacity-v2", ...flags(), ...measured,
    calculation: "canonical_fixed_fields_plus_enforced_subvalue_byte_caps", maximum_stop_summaries: 4,
    receipt_maximum_bytes: 64 * 16384, index_reserved_bytes: 4096 + 24 * 5290,
    receipt_kind_ceilings: receiptSizes, frame_kind_ceilings: frameSizes, worst_stop_summary: descriptor(stopRecord, 16384), native_budget_changed: false });
}
