import { z } from "zod";
import { uint, digestSchema as hash, count, parse, canonical, byteLength, freeze, flags } from "./unsignedControllerData.mjs";

const refuse = reason => { throw Error(`cc4c2cb1_${reason}`); };
const state = z.enum(["unavailable", "matched_supplied", "refused"]);
const amount = uint.nullable();
const groups = ["pins", "initialization", "grammar", "finalization", "encoding", "canonical", "record_schema", "size_bounds", "chunking", "retention", "work_stop", "authority"];
const phases = ["initialization", "feed", "finish"];
const parts = ["decoder_carry", "text_suffix", "decoded_fragment", "scalar_scratch", "nesting_stack", "token_batch", "canonical_window", "projection", "diagnostics"];
const boundNames = ["carry_bytes", "suffix_bytes", "decoded_bytes", "scalar_bytes", "stack_bytes", "batch_bytes", "canonical_lag_bytes", "stack_entries", "batch_items", "steps_per_fragment", "flush_steps"];
const workNames = ["feed_byte_work", "decode_byte_work", "copy_byte_work", "encode_byte_work", "token_work", "flush_work"];
const effects = ["allocation", "shared_symbol_registry", "async_builtin_import", "suppressed_import_failure", "host_decoder_selection", "bom_normalization"];
const options = { packKeys: false, packStrings: false, packNumbers: false, streamKeys: true, streamStrings: true, streamNumbers: true, jsonStreaming: false };
const tuple = [{ name: "stream-json", version: "3.8.0" }, { name: "stream-chain", version: "4.4.1" }];
const limits = { record_bytes: 4194304, manifest_bytes: 2097152, rows: 4096, pages: 64, page_rows: 128, page_bytes: 65536,
  file_bytes: 67108864, pass_bytes: 268435456, retained_bytes: 2375680, transient_bytes: 4259840,
  hash_work_bytes: 2147483648, helper_commands: 131072, starts: 24, per_mode: 12, fragment_bytes: 256 };
const nullableHash = hash.nullable();
const sri = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/).nullable();
const commit = z.string().regex(/^[a-f0-9]{40}$/).nullable();
const packageSchema = z.object({ name: z.enum(["stream-json", "stream-chain"]), version: z.string().max(16), state,
  resolved: z.string().max(128).nullable(), integrity: sri, expected_integrity: sri, commit, expected_commit: commit,
  files_sha256: nullableHash, expected_files_sha256: nullableHash, exports_sha256: nullableHash, expected_exports_sha256: nullableHash,
  entry_sha256: nullableHash, expected_entry_sha256: nullableHash,
  license: z.literal("BSD-3-Clause").nullable(), files: count(256, 1).nullable(), bytes: amount }).strict();
const memory = z.object(Object.fromEntries(parts.map(k => [k, amount]))).strict();
const schema = z.object({ schema: z.literal("unsigned-worker-parser-acceptance-plan-v1"),
  packages: z.array(packageSchema).length(2),
  closure: z.object({ state, graph_sha256: nullableHash, expected_graph_sha256: nullableHash,
    lock_sha256: nullableHash, expected_lock_sha256: nullableHash, chain_instances: count(128).nullable(),
    dependency: z.literal("stream-json:stream-chain:^4.4.1"), entry: z.literal("stream-json/core/parser.js:jsonParser"),
    target: z.literal("stream-json/src/core/parser.js"), builtin: z.literal("node:string_decoder"), all_edges_enumerated: z.boolean().nullable() }).strict(),
  profile: z.object({ options: z.object(Object.fromEntries(Object.keys(options).map(k => [k, z.boolean()]))).strict(),
    decoder: z.enum(["independent_fatal", "replacement", "package_wrapper"]), finalization: z.enum(["decoder_then_parser_once", "parser_first", "repeatable"]),
    fragment_bytes: count(65536, 1), control_fragments: z.array(count(65536, 1)).length(4) }).strict(),
  initialization: z.object({ state, decision: z.enum(["pending", "approved_supplied", "refused"]),
    effects: z.array(z.enum(effects)).max(effects.length).nullable(), closure_sha256: nullableHash, expected_closure_sha256: nullableHash,
    runtime_sha256: nullableHash, source: z.enum(["unavailable", "synthetic_summary", "supplied_original_summary"]),
    readiness: z.enum(["unavailable", "fulfilled", "rejected"]), decoder_outcome: z.enum(["unavailable", "installed", "not_installed"]),
    settled_once: z.boolean().nullable() }).strict(),
  source_bounds: z.object({ state, source_sha256: nullableHash, includes_prior_state: z.boolean().nullable(),
    ...Object.fromEntries(boundNames.map(k => [k, amount])) }).strict(),
  memory: z.array(z.object({ phase: z.enum(phases), retained: memory, transient: memory }).strict()).length(phases.length),
  heap: state,
  work: z.object({ prior_hash_bytes: amount, prior_helper_commands: amount, cost_profile: state,
    modes: z.array(z.object({ mode: z.enum(["normal", "ubsan"]), starts: z.literal(12), record_bytes: count(limits.record_bytes, 1),
      c2a_record_hash_bytes: uint, additional_record_hash_passes: count(64).nullable(), subset_hash_bytes: amount,
      initialization_hash_bytes: amount, extra_helper_commands: amount,
      ...Object.fromEntries(workNames.map(k => [k, amount])) }).strict()).length(2) }).strict(),
  acceptance: z.array(z.object({ group: z.enum(groups), state, positive_cases: count(128, 1).nullable(), negative_cases: count(128, 1).nullable() }).strict()
    ).length(groups.length) }).strict();

const sum = values => values.reduce((n, v) => n + BigInt(v ?? 0), 0n);
const known = values => values.every(v => v !== null);
const max = (a, b) => a > b ? a : b;
const cardinalityMinimum = value => max(256n, BigInt(value ?? 0));
function unique(values, reason) { if (new Set(values).size !== values.length) refuse(reason); }
function compare(a, b, reason, blockers) {
  if (a !== null && b !== null && a !== b) refuse(reason);
  if (a === null || b === null) blockers.push(reason + "_unavailable");
}
function pins(d, blockers) {
  unique(d.packages.map(p => p.name), "package_set");
  for (const selected of tuple) {
    const p = d.packages.find(p => p.name === selected.name);
    if (!p || p.version !== selected.version) refuse("evaluation_tuple");
    if (p.state !== "matched_supplied") blockers.push(p.name.replaceAll("-", "_") + "_" + p.state);
    const expected = `https://registry.npmjs.org/${p.name}/-/${p.name}-${p.version}.tgz`;
    if (p.resolved !== null && p.resolved !== expected) refuse("tarball_origin");
    for (const k of ["resolved", "license", "files", "bytes"]) if (p[k] === null) blockers.push(p.name.replaceAll("-", "_") + "_" + k + "_unavailable");
    for (const k of ["integrity", "commit", "files_sha256", "exports_sha256", "entry_sha256"]) compare(p[k], p["expected_" + k], k, blockers);
    for (const v of [p.integrity, p.expected_integrity]) if (v !== null && "sha512-" + Buffer.from(v.slice(7), "base64").toString("base64") !== v) refuse("integrity_encoding");
    if (p.bytes !== null && BigInt(p.bytes) === 0n) refuse("package_bytes");
  }
  // Distinct packages never share one tarball, source commit or package tree, as supplied or as expected.
  for (const k of ["integrity", "commit", "files_sha256"]) {
    const [a, b] = d.packages.map(p => [p[k], p["expected_" + k]].filter(v => v !== null));
    if (a.some(v => b.includes(v))) refuse("package_identity_alias");
  }
  const c = d.closure;
  if (c.state !== "matched_supplied") blockers.push("closure_" + c.state);
  for (const k of ["graph_sha256", "lock_sha256"]) compare(c[k], c["expected_" + k], k, blockers);
  if (c.chain_instances !== null && c.chain_instances !== 1) refuse("chain_instances");
  if (c.chain_instances === null || c.all_edges_enumerated !== true) blockers.push("closure_inventory_unavailable");
}
function initialization(d, blockers) {
  const i = d.initialization;
  if (i.effects !== null) {
    unique(i.effects, "initializer_effects");
    if (canonical([...i.effects].sort()) !== canonical([...effects].sort())) refuse("initializer_effects");
  } else blockers.push("initializer_inventory_unavailable");
  compare(i.closure_sha256, i.expected_closure_sha256, "initializer_closure", blockers);
  compare(i.closure_sha256, d.closure.graph_sha256, "initializer_binding", blockers);
  if (i.state !== "matched_supplied") blockers.push("initialization_" + i.state);
  if (i.decision !== "approved_supplied") blockers.push("initialization_decision_" + i.decision);
  if (i.runtime_sha256 === null) blockers.push("runtime_identity_unavailable");
  if (i.source !== "supplied_original_summary") blockers.push("original_readiness_unavailable");
  if (i.readiness !== "fulfilled" || i.settled_once !== true) blockers.push("readiness_unavailable");
  // Fulfilled readiness may have swallowed an import failure; it is not a decoder outcome.
  if (i.decoder_outcome !== "installed") blockers.push("decoder_outcome_unavailable");
}
function capacity(d, blockers) {
  unique(d.memory.map(p => p.phase), "memory_phases");
  const s = d.source_bounds;
  compare(s.source_sha256, d.packages.find(p => p.name === "stream-json").entry_sha256, "parser_source_binding", blockers);
  if (s.state !== "matched_supplied") blockers.push("source_bounds_" + s.state);
  if (s.source_sha256 === null || s.includes_prior_state !== true || !known(boundNames.map(k => s[k]))) blockers.push("source_bounds_incomplete");
  for (const k of ["stack_entries", "batch_items"]) if (s[k] !== null && BigInt(s[k]) < 256n) refuse("fragment_overshoot");
  // These are necessary logical minima, not a vendor allocation bound or a V8 size estimate.
  const minima = { carry_bytes: 3n, decoded_bytes: 256n, stack_bytes: cardinalityMinimum(s.stack_entries),
    batch_bytes: cardinalityMinimum(s.batch_items), steps_per_fragment: cardinalityMinimum(s.batch_items) };
  for (const [k, minimum] of Object.entries(minima))
    if (s[k] !== null && BigInt(s[k]) < minimum) refuse("source_geometry");
  const floors = { decoder_carry: "carry_bytes", text_suffix: "suffix_bytes", decoded_fragment: "decoded_bytes", scalar_scratch: "scalar_bytes",
    nesting_stack: "stack_bytes", token_batch: "batch_bytes", canonical_window: "canonical_lag_bytes" };
  let retained = 0n, transient = 0n, combined = 0n, complete = true;
  for (const p of d.memory) {
    let r = sum(Object.values(p.retained)), t = sum(Object.values(p.transient)), unassigned = 0n;
    if (p.phase === "feed") for (const [k, bound] of Object.entries(floors)) {
      const rk = p.retained[k], tk = p.transient[k], declared = sum([rk, tk]);
      const floor = max(minima[bound] ?? 0n, BigInt(s[bound] ?? 0));
      if (rk !== null && tk !== null && declared < floor) refuse("source_memory_floor");
      const missing = max(0n, floor - declared);
      if (rk === null && tk === null) unassigned += missing;
      else if (rk === null) r += missing;
      else if (tk === null) t += missing;
    }
    const joint = r + t + unassigned;
    // A shared unknown allocation is counted once; individual minima follow from the opposite ceiling.
    if (unassigned > 0n) { r = max(r, joint - 4259840n); t = max(t, joint - 2375680n); }
    if (r > 2375680n || t > 4259840n) refuse("capacity_bound");
    retained = max(retained, r); transient = max(transient, t); combined = max(combined, joint);
    complete &&= known([...Object.values(p.retained), ...Object.values(p.transient)]);
  }
  if (!complete) blockers.push("memory_unknown");
  // C2a's receive dispatch already reserves all transient capacity. B1 cannot prove a non-overlap boundary.
  if (transient > 0n) blockers.push("transient_overlap_unproven");
  if (d.heap !== "matched_supplied") blockers.push("heap_" + d.heap);
  return { known_retained_peak_bytes: String(retained), known_transient_peak_bytes: String(transient), known_combined_peak_bytes: String(combined),
    retained_peak_bytes: complete ? String(retained) : null, transient_peak_bytes: complete ? String(transient) : null,
    c2a_transient_reservation_bytes: "4259840", known_simultaneous_transient_bytes: String(4259840n + transient),
    complete, heap_runtime_qualified: false, parent_wrapper_calculated: false,
    calculation: "supplied_standalone_phases_not_heap_or_invocation_qualification" };
}
function work(d, blockers) {
  unique(d.work.modes.map(m => m.mode), "work_modes");
  if (d.work.modes.some(m => m.record_bytes !== d.work.modes[0].record_bytes)) refuse("shared_record_size");
  let raw = 0n, extra = 0n, helpers = 0n, hashComplete = d.work.prior_hash_bytes !== null, helperComplete = d.work.prior_helper_commands !== null;
  const totals = Object.fromEntries(workNames.map(k => [k, 0n])), totalsKnown = Object.fromEntries(workNames.map(k => [k, true]));
  for (const m of d.work.modes) {
    if (m.c2a_record_hash_bytes !== String(m.record_bytes)) refuse("raw_record_hash_mapping");
    raw += 12n * BigInt(m.record_bytes);
    extra += 12n * (BigInt(m.record_bytes) * BigInt(m.additional_record_hash_passes ?? 0) + sum([m.subset_hash_bytes, m.initialization_hash_bytes]));
    helpers += 12n * BigInt(m.extra_helper_commands ?? 0);
    hashComplete &&= known([m.additional_record_hash_passes, m.subset_hash_bytes, m.initialization_hash_bytes]); helperComplete &&= m.extra_helper_commands !== null;
    for (const k of ["feed_byte_work", "decode_byte_work", "encode_byte_work"]) if (m[k] !== null && BigInt(m[k]) < BigInt(m.record_bytes)) refuse("byte_work_floor");
    const b = d.source_bounds;
    const parserSteps = max(cardinalityMinimum(b.batch_items), BigInt(b.steps_per_fragment ?? 0));
    if (m.token_work !== null && BigInt(m.token_work) < BigInt(Math.ceil(m.record_bytes / 256)) * parserSteps) refuse("parser_work_floor");
    if (b.flush_steps !== null && m.flush_work !== null && BigInt(m.flush_work) < BigInt(b.flush_steps)) refuse("flush_work_floor");
    const minimumWork = { feed_byte_work: BigInt(m.record_bytes), decode_byte_work: BigInt(m.record_bytes), encode_byte_work: BigInt(m.record_bytes),
      token_work: BigInt(Math.ceil(m.record_bytes / 256)) * parserSteps, flush_work: BigInt(b.flush_steps ?? 0) };
    for (const k of workNames) { totals[k] += 12n * max(BigInt(m[k] ?? 0), minimumWork[k] ?? 0n); totalsKnown[k] &&= m[k] !== null; }
  }
  if (d.work.prior_hash_bytes !== null && BigInt(d.work.prior_hash_bytes) < raw) refuse("prior_hash_floor");
  // Prior work already includes C2a's single raw-record pass. Only additional passes are added.
  const hashBytes = max(BigInt(d.work.prior_hash_bytes ?? 0), raw) + extra;
  const helperCommands = BigInt(d.work.prior_helper_commands ?? 0) + helpers;
  if (hashBytes > 2147483648n || helperCommands > 131072n) refuse("work_bound");
  if (!hashComplete) blockers.push("hash_work_unknown");
  if (!helperComplete) blockers.push("helper_work_unknown");
  for (const k of workNames) if (!totalsKnown[k]) blockers.push(k + "_unknown");
  if (d.work.cost_profile !== "matched_supplied") blockers.push("cost_profile_" + d.work.cost_profile);
  return { starts: 24, c2a_raw_record_hash_bytes: String(raw), additional_hash_bytes: String(extra),
    known_hash_bytes: String(hashBytes), modeled_hash_bytes: hashComplete ? String(hashBytes) : null,
    known_helper_commands: String(helperCommands), modeled_helper_commands: helperComplete ? String(helperCommands) : null,
    units: Object.fromEntries(workNames.map(k => [k, { known: String(totals[k]), modeled: totalsKnown[k] ? String(totals[k]) : null }])),
    precharge_required: true, refunded: false, synchronous_preemption_proven: false, elapsed_time_qualified: false };
}
function subject(input) {
  const d = parse(schema, input), blockers = [];
  if (canonical(d.profile.options) !== canonical(options)) refuse("parser_options");
  if (d.profile.decoder !== "independent_fatal" || d.profile.finalization !== "decoder_then_parser_once") refuse("encoding_profile");
  if (d.profile.fragment_bytes !== 256 || canonical(d.profile.control_fragments) !== "[1,16,64,256]") refuse("fragment_profile");
  const pinBlockers = []; pins(d, pinBlockers); blockers.push(...pinBlockers); initialization(d, blockers);
  const memory = capacity(d, blockers), costs = work(d, blockers);
  unique(d.acceptance.map(a => a.group), "acceptance_groups");
  let acceptanceComplete = true;
  for (const a of d.acceptance) {
    if (a.state !== "matched_supplied" || a.positive_cases === null || a.negative_cases === null) {
      acceptanceComplete = false; blockers.push("acceptance_" + a.group + "_" + (a.state === "matched_supplied" ? "incomplete" : a.state));
    }
  }
  return { d, blockers: [...new Set(blockers)], memory, costs, pinsComplete: pinBlockers.length === 0, acceptanceComplete };
}
function result(input) {
  const s = subject(input);
  const out = { ...flags(), scope: "unsigned_worker_parser_acceptance_memory_only", runtime_producers: "unavailable",
    parser_executed: false, parser_available: false, runtime_completion_proven: false, startup_proof_issued: false,
    evaluation_tuple_selected: true, evaluation_tuple: tuple, pins_consistent_supplied: s.pinsComplete,
    synthetic_acceptance_complete: s.acceptanceComplete, acceptance_scope: "supplied_case_summary_not_parser_test_results",
    supplied_plan_complete: s.blockers.length === 0, blockers: s.blockers, limits,
    capacity: s.memory, work: s.costs, input_record_bytes_held: 0, actual_package_bytes_verified: false };
  if (byteLength(canonical(out)) > 16384) refuse("diagnostic_bound");
  return freeze(out);
}

export function planUnsignedWorkerParserAcceptance(input) { return result(input); }
export function describeUnsignedWorkerParserAcceptanceCapacity(input) { return result(input); }
