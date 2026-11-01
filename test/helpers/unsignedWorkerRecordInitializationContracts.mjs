import { z } from "zod";
import { uint, label, code, digestSchema as hash, count, parse, canonical, digest, byteLength, freeze, flags, LIMITS } from "./unsignedControllerData.mjs";
import { planUnsignedWorkerStartup } from "./unsignedWorkerStartupContracts.mjs";
import { describeUnsignedQualificationProfile } from "./unsignedCohortQualificationContracts.mjs";

const profile = describeUnsignedQualificationProfile();
const refuse = reason => { throw Error(`cc4c2ca_${reason}`); };
const base = () => ({ ...flags(), scope: "unsigned_worker_record_initialization_memory_only", runtime_completion_proven: false,
  runtime_producers: "unavailable", record_reader_available: false, startup_proof_issued: false });
const steps = ["record_open", "record_validate", "closed_set", "initialization", "modules", "cache", "complete"];
const gates = ["parser", "writer_language", "role_mapping", "initialization", "host_bridge", "loader_binding", "heap", "cost_profile"];
const status = z.enum(["unavailable", "matched_supplied", "refused"]), mode = z.enum(["normal", "ubsan"]), step = z.enum(steps);
const nullableBytes = uint.nullable(), metrics = ["hash_bytes", "read_bytes", "parser_steps", "helper_commands"];
const costSchema = z.object(Object.fromEntries(metrics.map(k => [k, nullableBytes]))).strict();
const concreteCost = z.object(Object.fromEntries(metrics.map(k => [k, uint]))).strict();
const extraNames = ["extra_record_hash_bytes", "subset_hash_bytes", "initialization_hash_bytes"];
const modeSchema = z.object({ mode, startups: z.literal(12), ...Object.fromEntries(extraNames.map(k => [k, nullableBytes])),
  extra_helper_commands: nullableBytes, steps: z.array(z.object({ step, cost: costSchema }).strict()).length(steps.length) }).strict();
const memoryNames = ["decoder", "pending_prepare", "status_lines", "record_input_page", "canonical_compare_page", "token_scratch", "current_row", "membership", "hash_scratch", "parser_queue"];
const memorySchema = z.object(Object.fromEntries(memoryNames.map(k => [k, nullableBytes]))).strict();
const rowSchema = z.object({ path_sha256: hash, identity_sha256: hash, bytes: uint, sha256: hash,
  kind: z.enum(["input", "artifact"]), mode: mode.nullable(), roles: z.array(z.enum(["source", "typescript", "runtime", "node", "compiler", "linker", "ubsan", "sdk_settings", "tool", "compiler_dependency", "js", "addon", "observer"])).min(1).max(10) }).strict();
const point = z.object({ clock_domain: label, monotonic_ns: uint }).strict();
const common = { session_id: label, generation: uint, at: point.nullable(), references: z.tuple([z.enum(["referenced", "unreferenced", "unknown"]), z.enum(["referenced", "unreferenced", "unknown"])]) };
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reserve"), ...common, action_id: label, step, cost: concreteCost }).strict(),
  z.object({ type: z.literal("begin"), ...common, action_id: label }).strict(),
  z.object({ type: z.literal("result"), ...common, action_id: label, outcome: z.enum(["returned", "refused", "unknown"]) }).strict(),
  z.object({ type: z.literal("stop"), ...common, reason: code }).strict(),
  z.object({ type: z.literal("close_begin"), ...common, resource: z.enum(["record", "cache"]), original_matches: z.boolean() }).strict(),
  z.object({ type: z.literal("close_result"), ...common, resource: z.enum(["record", "cache"]), outcome: z.enum(["confirmed", "unknown"]) }).strict(),
]);
const schema = z.object({ startup: z.unknown(), session_id: label, generation: uint,
  profiles: z.object(Object.fromEntries(gates.map(k => [k, status]))).strict(),
  record: z.object({ schema: z.literal("native-bar-cohort-private-build-v1"), bytes: count(profile.build_record_bytes, 1),
    rows: count(profile.manifest_rows, 1), pages: count(profile.manifest_pages, 1), manifest_bytes: count(profile.manifest_bytes, 1),
    sha256: hash, inputs_sha256: hash, artifacts_sha256: hash,
    expected_inputs_sha256: hash, expected_artifacts_sha256: hash, identity: status,
    canonical: z.enum(["unavailable", "hash_only", "exact_supplied"]), membership: status,
    page: z.object({ index: count(profile.manifest_pages - 1), bytes: count(profile.page_bytes, 1), rows: z.array(rowSchema).min(1).max(profile.page_rows) }).strict() }).strict(),
  modules: z.array(z.object({ id: label, mode, source_sha256: hash, artifact_sha256: hash, expected_artifact_sha256: hash,
    role: z.enum(["reader", "registry", "contracts", "fixed_owner", "unsigned_owner", "dependency", "addon"]),
    edges: z.array(label).max(32), exports: z.array(z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/)).max(16), effects: z.array(z.enum(["allocation", "hash", "capture", "finalizer", "selector", "await_import", "native_initializer"])).max(7) }).strict()).max(128),
  host: z.object({ source: z.enum(["unavailable", "supplied_parent", "supplied_worker", "candidate_self"]),
    namespace: status, acl: status, launch: status, native_profile: status, loader: status,
    clock_domain: label, generation: uint, identity_sha256: hash, expected_identity_sha256: hash }).strict(),
  work: z.object({ modes: z.array(modeSchema).length(2), prior_other_hash_bytes: nullableBytes, prior_other_helper_commands: nullableBytes }).strict(),
  memory: z.array(z.object({ step, retained: memorySchema, transient: memorySchema }).strict()).length(steps.length),
  events: z.array(eventSchema).max(LIMITS.trace_events) }).strict();

function unique(values, reason) { if (new Set(values).size !== values.length) refuse(reason); }
const sum = values => values.reduce((n, v) => n + BigInt(v ?? 0), 0n);
const known = values => values.every(v => v !== null);
const max = (a, b) => a > b ? a : b;
function work(d, startup) {
  unique(d.work.modes.map(v => v.mode), "work_modes");
  let extraHash = BigInt(d.work.prior_other_hash_bytes ?? 0), extraHelpers = BigInt(d.work.prior_other_helper_commands ?? 0);
  let completeHash = d.work.prior_other_hash_bytes !== null, completeHelpers = d.work.prior_other_helper_commands !== null;
  let read = 0n, operations = 0n, completeRead = true, completeOperations = true;
  let startHash = 0n, baseHash = 0n, startHelpers = 0n, baseHelpers = 0n;
  for (const m of d.work.modes) {
    unique(m.steps.map(v => v.step), "work_steps");
    const b = d.startup.work.modes.find(v => v.mode === m.mode), extras = extraNames.map(k => m[k]);
    if (m.extra_record_hash_bytes !== null && BigInt(m.extra_record_hash_bytes) % BigInt(d.record.bytes) !== 0n) refuse("record_pass_cost");
    extraHash += 12n * sum(extras); extraHelpers += 12n * BigInt(m.extra_helper_commands ?? 0);
    completeHash &&= known(extras); completeHelpers &&= m.extra_helper_commands !== null;
    const expectedHash = [b.record_bytes, b.module_bytes, b.pin_bytes, b.metadata_hash_bytes, ...extras];
    const expectedHelpers = [b.helper_commands, m.extra_helper_commands];
    baseHash += 12n * sum([b.record_bytes, b.module_bytes, b.pin_bytes, b.metadata_hash_bytes]); baseHelpers += 12n * BigInt(b.helper_commands ?? 0);
    startHash += 12n * max(sum(expectedHash), sum(m.steps.map(v => v.cost.hash_bytes)));
    startHelpers += 12n * max(sum(expectedHelpers), sum(m.steps.map(v => v.cost.helper_commands)));
    for (const [key, expected] of [["hash_bytes", expectedHash], ["helper_commands", expectedHelpers]]) {
      const values = m.steps.map(v => v.cost[key]);
      if (known(values) && known(expected) && sum(values) !== sum(expected)
        || known(expected) && sum(values) > sum(expected) || known(values) && sum(values) < sum(expected)) refuse("step_cost_total");
    }
    const validation = m.steps.find(v => v.step === "record_validate").cost;
    for (const [stage, lower, reason] of [["record_open", sum([b.metadata_hash_bytes]), "metadata_hash_cost"],
      ["closed_set", sum([b.module_bytes, b.pin_bytes]), "closed_set_hash_cost"], ["initialization", sum([m.initialization_hash_bytes]), "initialization_hash_cost"]]) {
      const charged = m.steps.find(v => v.step === stage).cost.hash_bytes;
      if (charged !== null && BigInt(charged) < lower) refuse(reason);
    }
    if (validation.hash_bytes !== null && BigInt(validation.hash_bytes) < BigInt(d.record.bytes) + sum([m.extra_record_hash_bytes, m.subset_hash_bytes])) refuse("record_hash_cost");
    if (validation.read_bytes !== null && BigInt(validation.read_bytes) < BigInt(d.record.bytes) * 2n + sum([m.extra_record_hash_bytes])) refuse("record_compare_cost");
    if (validation.parser_steps !== null && BigInt(validation.parser_steps) < BigInt(d.record.bytes)) refuse("parser_work_cost");
    const perStartRead = sum(m.steps.map(v => v.cost.read_bytes));
    if (perStartRead > BigInt(profile.pass_bytes)) refuse("read_pass_bound");
    read += 12n * perStartRead; operations += 12n * sum(m.steps.map(v => v.cost.parser_steps));
    completeRead &&= known(m.steps.map(v => v.cost.read_bytes)); completeOperations &&= known(m.steps.map(v => v.cost.parser_steps));
    completeHash &&= known(m.steps.map(v => v.cost.hash_bytes)); completeHelpers &&= known(m.steps.map(v => v.cost.helper_commands));
  }
  const declaredHash = d.startup.work.other_hash_bytes, declaredHelpers = d.startup.work.other_helper_commands;
  if (completeHash && declaredHash !== null && BigInt(declaredHash) !== extraHash
    || completeHelpers && declaredHelpers !== null && BigInt(declaredHelpers) !== extraHelpers) refuse("other_work_mapping");
  const wire = 24n * BigInt(startup.subject_hash_reservation_per_start + LIMITS.frames * startup.wire_hash_reservation_per_frame);
  const hashBytes = wire + max(startHash + BigInt(d.work.prior_other_hash_bytes ?? 0), baseHash + BigInt(declaredHash ?? 0));
  const helpers = max(startHelpers + BigInt(d.work.prior_other_helper_commands ?? 0), baseHelpers + BigInt(declaredHelpers ?? 0));
  if (hashBytes > BigInt(profile.hash_work_bytes) || helpers > BigInt(profile.helper_commands)) refuse("work_bound");
  return { known_hash_bytes: String(hashBytes), known_helper_commands: String(helpers), additional_other_hash_bytes: String(extraHash),
    additional_other_helper_commands: String(extraHelpers), known_read_bytes: String(read), known_parser_steps: String(operations),
    modeled_hash_bytes: completeHash && startup.modeled_hash_bytes !== null ? String(hashBytes) : null,
    modeled_helper_commands: completeHelpers && startup.modeled_helper_commands !== null ? String(helpers) : null,
    modeled_read_bytes: completeRead ? String(read) : null, modeled_parser_steps: completeOperations ? String(operations) : null };
}
function capacity(d) {
  unique(d.memory.map(v => v.step), "memory_steps"); let retained = 0n, transient = 0n, complete = true;
  for (const p of d.memory) {
    const r = sum(Object.values(p.retained)), t = sum(Object.values(p.transient));
    if (r > 2375680n || t > 4259840n) refuse("capacity_bound");
    retained = max(retained, r); transient = max(transient, t); complete &&= known([...Object.values(p.retained), ...Object.values(p.transient)]);
    for (const [key, minimum] of [["decoder", 65536n], ["pending_prepare", 65536n], ["status_lines", 131072n]])
      if (p.retained[key] !== null && BigInt(p.retained[key]) < minimum) refuse("retained_floor");
    if (p.step === "record_validate") for (const key of ["record_input_page", "canonical_compare_page", "token_scratch", "current_row", "hash_scratch"])
      if (p.retained[key] !== null && BigInt(p.retained[key]) < (key === "token_scratch" || key === "current_row" ? 1n : BigInt(Math.min(d.record.bytes, 65536)))) refuse("parser_memory_floor");
  }
  return { known_retained_peak_bytes: String(retained), known_transient_peak_bytes: String(transient),
    retained_peak_bytes: complete ? String(retained) : null, transient_peak_bytes: complete ? String(transient) : null,
    retained_limit_bytes: 2375680, transient_limit_bytes: 4259840, complete, parent_wrapper_calculated: false,
    calculation: "supplied_phase_overlap_not_v8_native_or_runtime_qualification" };
}
function subject(input) {
  const d = parse(schema, input), startup = planUnsignedWorkerStartup(d.startup), r = d.record;
  const w = work(d, startup), memory = capacity(d);
  if (d.generation === "0" || d.startup.binding.setup !== null || r.sha256 !== d.startup.expected.build_record_sha256
    || r.bytes !== d.startup.manifest.record_bytes || r.rows !== d.startup.manifest.rows || r.pages !== d.startup.manifest.pages
    || r.manifest_bytes !== d.startup.manifest.manifest_bytes || r.page.index >= r.pages || r.page.rows.length > r.rows || r.page.bytes > r.manifest_bytes
    || r.page.rows.length > d.startup.manifest.page_rows || r.page.bytes > d.startup.manifest.page_bytes
    || byteLength(canonical(r.page.rows)) > r.page.bytes) refuse("record_projection");
  unique(r.page.rows.map(v => v.path_sha256), "row_alias");
  unique(r.page.rows.map(v => v.identity_sha256), "row_identity_alias");
  if (sum(r.page.rows.map(v => v.bytes)) > BigInt(profile.pass_bytes)) refuse("manifest_pass_bound");
  for (const row of r.page.rows) {
    unique(row.roles, "row_roles");
    if (BigInt(row.bytes) > BigInt(profile.file_bytes) || row.kind === "input" && (row.mode !== null || row.roles.some(v => ["js", "addon", "observer"].includes(v)))
      || row.kind === "artifact" && (row.mode === null || row.roles.length !== 1 || !["js", "addon", "observer"].includes(row.roles[0]))) refuse("row_role_mapping");
  }
  unique(d.modules.map(v => v.id), "module_alias");
  for (const m of d.modules) {
    unique(m.edges, "module_edges"); unique(m.exports, "module_exports"); unique(m.effects, "module_effects");
    if (m.mode !== d.startup.binding.mode || m.edges.some(edge => !d.modules.some(v => v.id === edge))) refuse("module_closure");
    if (m.role === "fixed_owner" && canonical(m.exports) !== '["enrollFixedMemoryCheckpointOracleC0Only"]'
      || m.role === "unsigned_owner" && canonical(m.exports) !== '["enrollUnsignedCheckpointOracle"]') refuse("owner_exports");
  }
  const blockers = [...startup.blockers, ...gates.filter(k => d.profiles[k] !== "matched_supplied").map(k => k + "_" + d.profiles[k])];
  for (const k of ["namespace", "acl", "launch", "native_profile", "loader"]) if (d.host[k] !== "matched_supplied") blockers.push("host_" + k + "_" + d.host[k]);
  if (d.host.source !== "supplied_worker") blockers.push("worker_host_observation_unavailable");
  if (d.host.clock_domain !== d.startup.clock.clock_domain || d.host.generation !== d.generation || d.host.identity_sha256 !== d.host.expected_identity_sha256) blockers.push("host_binding_mismatch");
  for (const k of ["identity", "membership"]) if (r[k] !== "matched_supplied") blockers.push("record_" + k + "_" + r[k]);
  if (r.canonical !== "exact_supplied") blockers.push("exact_canonical_comparison_unavailable");
  if (r.inputs_sha256 !== r.expected_inputs_sha256 || r.artifacts_sha256 !== r.expected_artifacts_sha256) blockers.push("record_subset_mismatch");
  const roles = ["reader", "registry", "contracts", "fixed_owner", "unsigned_owner", "addon"];
  if (roles.some(role => d.modules.filter(m => m.role === role).length !== 1) || d.modules.some(m => m.artifact_sha256 !== m.expected_artifact_sha256)) blockers.push("module_set_mismatch");
  if (d.modules.some(m => m.role === "addon" && m.artifact_sha256 !== d.startup.binding.addon_sha256
    || m.role === "reader" && (m.artifact_sha256 !== d.startup.binding.reader_js_sha256 || m.source_sha256 !== d.startup.binding.reader_source_sha256))) blockers.push("module_launch_pin_mismatch");
  if (!memory.complete) blockers.push("memory_overlap_unknown");
  for (const key of ["hash_bytes", "helper_commands", "read_bytes", "parser_steps"]) if (w["modeled_" + key] === null) blockers.push(key + "_unknown");
  return { d, startup, w, memory, blockers };
}
function replay(d, startup, blocked) {
  const origin = BigInt(d.startup.clock.started_ns), end = BigInt(startup.clock.preparation_end_ns);
  let last = origin, stopped = null, state = blocked ? "BLOCKED" : "PRECONDITIONS_KNOWN", index = 0, active = null, clockInvalid = false;
  const actions = new Map(), spent = Object.fromEntries(metrics.map(k => [k, 0n]));
  const resources = { record: { disposition: "absent", close_attempted: false }, cache: { disposition: "absent", close_attempted: false } };
  const stop = reason => {
    stopped ??= reason; state = "STOPPED";
    if (active !== null && !actions.get(active).begun) active = null;
  };
  for (const e of d.events) {
    if (e.session_id !== d.session_id || e.generation !== d.generation) { stop("foreign_event"); continue; }
    if (!e.at || e.at.clock_domain !== d.startup.clock.clock_domain || BigInt(e.at.monotonic_ns) < last) { clockInvalid = true; stop("clock_invalid"); }
    else { last = BigInt(e.at.monotonic_ns); if (last >= end) stop("preparation_deadline"); }
    if (e.references.some(v => v !== "referenced")) stop("lifetime_unqualified");
    if (active !== null && last >= actions.get(active).deadline) stop("operation_deadline");
    if (e.type === "stop") { stop(e.reason); continue; }
    if (e.type === "reserve") {
      if (stopped || blocked || active || index >= steps.length || e.step !== steps[index] || actions.has(e.action_id)) { stop("reservation_order"); continue; }
      const expected = d.work.modes.find(m => m.mode === d.startup.binding.mode).steps.find(v => v.step === e.step).cost;
      if (metrics.some(k => expected[k] === null || e.cost[k] !== expected[k])) { stop("reservation_cost"); continue; }
      for (const k of metrics) spent[k] += BigInt(e.cost[k]);
      const remaining = (end - last) / 1000000n;
      if (remaining < 1n) { stop("operation_window"); continue; }
      const deadline = last + (remaining < 10000n ? remaining : 10000n) * 1000000n;
      actions.set(e.action_id, { step: e.step, begun: false, outcome: null, deadline }); active = e.action_id; continue;
    }
    const a = actions.get(e.action_id);
    if (e.type === "begin") {
      if (stopped || blocked || !a || active !== e.action_id || a.begun) { stop("begin_without_reservation"); continue; }
      a.begun = true;
      if (a.step === "record_open") resources.record.disposition = "unknown";
      if (a.step === "cache") resources.cache.disposition = "unknown";
      state = a.step.toUpperCase() + "_PENDING"; continue;
    }
    if (e.type === "result") {
      if (!a || !a.begun || active !== e.action_id || a.outcome !== null && a.outcome !== "unknown") { stop("result_order"); continue; }
      a.outcome = e.outcome;
      if (e.outcome === "unknown") { stop("operation_unknown"); continue; }
      active = null;
      if (a.step === "record_open") resources.record.disposition = e.outcome === "returned" ? "owned" : "absent";
      if (a.step === "cache") resources.cache.disposition = e.outcome === "returned" ? "owned" : "absent";
      if (e.outcome === "refused") stop("operation_refused");
      if (!stopped) { index++; state = index === steps.length ? "SUPPLIED_COMPLETE" : a.step.toUpperCase() + "_RETURNED"; }
      continue;
    }
    const resource = resources[e.resource];
    if (!stopped) { stop("close_before_stop"); continue; }
    if (e.type === "close_begin") {
      // Expiry permits original cleanup; a failed clock/reference checkpoint does not start a new effect.
      if (clockInvalid || e.references.some(v => v !== "referenced")) { stop("close_checkpoint"); continue; }
      if (resource.close_attempted || resource.disposition !== "owned") { stop("close_order"); continue; }
      resource.close_attempted = true;
      resource.disposition = e.original_matches ? "closing" : "foreign_retained";
    } else if (e.type === "close_result") {
      if (resource.disposition !== "closing") { stop("close_result_order"); continue; }
      resource.disposition = e.outcome === "confirmed" ? "released" : "unknown";
    }
  }
  return { state, first_stop: stopped, clock_invalid: clockInvalid, last_ns: String(last), completed_steps: index,
    active_step: active === null ? null : actions.get(active).step, resources,
    spent: Object.fromEntries(metrics.map(k => [k, String(spent[k])])), refunded: false,
    retained: active !== null || Object.values(resources).some(r => !["absent", "released"].includes(r.disposition)),
    cache_replacement_overwritten: false, modeled_actions: actions.size };
}
function plan({ d, startup, w, memory, blockers }) {
  return freeze({ ...base(), schema: "native-bar-worker-record-initialization-plan-v1", binding_sha256: d.startup.expected.binding_sha256,
    mode: d.startup.binding.mode, record_sha256: d.record.sha256, module_projection_sha256: digest(d.modules), supplied_plan_complete: blockers.length === 0, blockers,
    ...w, memory, model: replay(d, startup, blockers.length !== 0), template_preimage: "deferred_to_c3",
    projection_scope: "one_supplied_page_not_complete_record_provenance", native_budget_changed: false });
}
export function planUnsignedWorkerRecordInitialization(input) { return plan(subject(input)); }
export function describeUnsignedWorkerRecordInitializationCapacity(input) {
  const context = subject(input), p = plan(context);
  // This bound is generated independently from field maxima, not from the caller's current event count.
  const u = "9".repeat(33), h = "f".repeat(64), c = "c".repeat(96);
  const maximum = { ...p, binding_sha256: h, record_sha256: h, module_projection_sha256: h, mode: "normal", blockers: Array(48).fill(c), supplied_plan_complete: false,
    ...Object.fromEntries(Object.keys(context.w).map(k => [k, u])),
    memory: { ...p.memory, complete: false, known_retained_peak_bytes: u, known_transient_peak_bytes: u, retained_peak_bytes: u, transient_peak_bytes: u },
    model: { ...p.model, state: "RECORD_VALIDATE_RETURNED", first_stop: c, clock_invalid: false, retained: false, last_ns: u, completed_steps: 7, active_step: "record_validate",
      resources: Object.fromEntries(["record", "cache"].map(k => [k, { disposition: "foreign_retained", close_attempted: false }])),
      spent: Object.fromEntries(metrics.map(k => [k, u])), modeled_actions: 7 } };
  const bytes = byteLength(canonical(maximum)); if (bytes > 16384) refuse("diagnostic_capacity");
  return freeze({ ...base(), schema: "native-bar-worker-record-initialization-capacity-v1", maximal_plan: maximum,
    diagnostic_ceiling_bytes: bytes, diagnostic_limit_bytes: 16384, parent_wrapper_calculated: false,
    event_limit: LIMITS.trace_events, projection_rows_per_call: profile.page_rows, module_summary_limit: 128,
    record_limit_bytes: profile.build_record_bytes, ...context.w, memory: context.memory, native_budget_changed: false });
}
