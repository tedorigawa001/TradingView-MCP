// Test planning only. This module never imports the joint reader, loads native code or touches a fixture.
import { createHash } from "node:crypto";
import { z } from "zod";

const refuse = (code) => { throw Error(`cc0_${code}`); };
function snapshot(value) {
  // Trusted test callers only: accessor values are refused; hostile Proxy reflection is not isolated.
  let nodes = 0, characters = 0;
  function copy(v, depth) {
    if (++nodes > 8192 || depth > 12) refuse("input_bound");
    if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isSafeInteger(v)) return v;
    if (typeof v === "string") {
      characters += v.length;
      if (v.length > 256 || characters > 65536) refuse("input_bound");
      return v;
    }
    if (typeof v !== "object" || v === null) refuse("invalid_input");
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) refuse("invalid_input");
    const keys = Reflect.ownKeys(v);
    if (keys.length > (array ? 257 : 32) || array && v.length > 256) refuse("input_bound");
    const result = array ? [] : Object.create(null);
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || array && !/^(0|[1-9][0-9]*)$/.test(key)) refuse("invalid_input");
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !d.enumerable || !("value" in d)) refuse("invalid_input");
      Object.defineProperty(result, key, { value: copy(d.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    if (array && result.length !== v.length || array && keys.length !== v.length + 1) refuse("invalid_input");
    return result;
  }
  return copy(value, 0);
}
function parse(schema, input) {
  const result = schema.safeParse(snapshot(input));
  if (!result.success) refuse("invalid_input");
  return result.data;
}
function freeze(value) {
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const label = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const codeName = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,9})$/);
const stage = z.enum(["C-C0", "C-C1", "C-C2", "C-C3"]);
const cases = {
  G0: { stage: "C-C0", layers: { plan: ["stage_not_approved", "invalid_input", "mixed_output_modes", "copied_grant_refused"] } },
  U0: { stage: "C-C1", layers: { checkpoint_c0: ["checkpoint_refused", "oracle_unavailable"] } },
  U1: { stage: "C-C1", layers: { record: ["record_refused"] } },
  U2: { stage: "C-C1", layers: { prefix: ["witness_prefix"] } },
  U3: { stage: "C-C1", layers: { inventory: ["publication_pending", "coordination_active", "work_envelope"], interpretation: ["transaction_mapping_pending"] } },
  U4: { stage: "C-C1", layers: { native: ["native_refused", "native_changed"], inventory: ["native_entry", "work_envelope"], binding: ["full_binding"] } },
  S0: { stage: "C-C2", layers: { released: ["minimal_enrollment_consistent"] } },
  S1: { stage: "C-C2", layers: { plan: ["budget"], released: ["minimal_enrollment_consistent"] } },
  F0: { stage: "C-C3", layers: { checkpoint_c1: ["checkpoint_refused", "changing"] } },
  F1: { stage: "C-C3", layers: { cancellation: ["cancelled", "oracle_cancelled", "oracle_unavailable", "phase_order", "release_unconfirmed"] } },
  F2: { stage: "C-C3", layers: { native_v1: ["native_changed", "native_refused"] } },
  F3: { stage: "C-C3", layers: { clock: ["deadline", "clock_invalid", "clock_rollback", "native_deadline_or_rollback", "rng_unavailable", "rng_invalid"] } },
  F4: { stage: "C-C3", layers: { native_begin: ["native_busy"] } },
  F5: { stage: "C-C3", layers: { cleanup: ["release_unconfirmed"] } },
  F6: { stage: "C-C3", layers: { native_begin: ["native_unavailable", "native_refused"] } },
  B0: { stage: "C-C1", layers: { plan: ["budget"], inventory: ["work_envelope"] } },
};
const caseSchema = z.object({ case_id: label, row: z.enum(Object.keys(cases)), expected_layer: codeName,
  expected_code: codeName, envelope_sha256: hash.nullable() }).strict();
const manifestSchema = z.object({ schema: z.literal("native-bar-joint-acceptance-plan-v1"), run_id: label, stage,
  source: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), patch_sha256: hash }).strict(),
  build: z.object({ mode: z.enum(["normal", "ubsan"]), profile: z.literal("synthetic-only-protocol-6"), source_sha256: hash, addon_sha256: hash.nullable() }).strict(),
  ownership: z.object({ anchor: z.enum(["private_tmp", "per_user_tmp"]), creation: z.literal("exclusive_new"),
    teardown: z.enum(["not_selected", "receipt_bounded_node", "descriptor_anchored_helper"]), ancestor_headroom_bytes: uint }).strict(),
  cases: z.array(caseSchema).min(1).max(64),
}).strict();
function manifest(input) {
  const m = parse(manifestSchema, input), ids = new Set();
  for (const c of m.cases) {
    if (ids.has(c.case_id)) refuse("duplicate_case");
    ids.add(c.case_id);
    const layers = cases[c.row].layers;
    if (!Object.hasOwn(layers, c.expected_layer) || !layers[c.expected_layer].includes(c.expected_code)) refuse("expectation_binding");
    if (c.row !== "G0" && c.envelope_sha256 === null || c.row === "G0" && c.envelope_sha256 !== null) refuse("envelope_binding");
  }
  return m;
}
const flags = () => ({ execution_available: false, approval_authenticated: false, environment_observed: false,
  ownership_verified: false, native_read_available: false, fixture_signature_verified: false, checkpoint_pair_verified: false,
  native_snapshot_verified: false, native_budget_enforced: false, view_verified: false, authority_state_verified: false,
  committed_history_available: false, elapsed_clock_qualified: false, physical_capacity_verified: false,
  recovery_execution_available: false, original_intake_verified: false, admission_verified: false, transaction_replay_verified: false,
  native_bytes_verified: false, checkpoint_requests_verified: false, logical_prefix_verified: false, timing_verified: false,
  original_acknowledgement: "not_proven", storage_visibility_at_as_of: "not_proven" });

export function describeJointAcceptancePlan(input) {
  const m = manifest(input);
  return freeze({ schema: "native-bar-joint-acceptance-description-v1", scope: "memory_acceptance_contract_only", manifest: m,
    manifest_sha256: digest(m), ...flags(), disposition: m.stage === "C-C0" ? "memory_contract_only" : "separate_approval_required",
    output_layout: { mode_directory: `build/b3cc-validation/${m.build.mode}/`, reports_directory: "build/b3cc-validation/reports/",
      exists: "not_observed", module_mode_binding: "required_not_verified" },
    requirements: { ownership: "required_not_verified", teardown: "required_not_verified", environment: "required_not_verified",
      signed_record_persistence: "separate_approval_required", native_cases: "not_implemented" },
    unchanged_native_contract: { scope: "declaration_only_not_enforced", entries: "512", inventory_bytes: "1073741824",
      metadata_bytes: "16777216", read_bytes: "268435456", response_bytes: "8388608", roots: "8", managed_fds: "512",
      fd_headroom: "48", inventory_passes: 6, content_passes: 5, full_publication: "planning_refusal_not_behavioral_coverage" },
    cases: m.cases.map((c) => ({ case_id: c.case_id, required_stage: cases[c.row].stage,
      disposition: c.row === "G0" ? "memory_contract_only" : "separate_approval_required" })) });
}

const jst = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+09:00$/);
const ns = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const observationSchema = z.object({ schema: z.literal("native-bar-joint-acceptance-memory-observation-v1"),
  case_id: label, manifest_sha256: hash, evidence: z.literal("memory_contract_only"), observed_layer: codeName, observed_code: codeName,
  assertions: z.object({ no_native_load: z.boolean(), no_fixture_io: z.boolean(), no_signing: z.boolean() }).strict(),
  supplied_timing: z.object({ start_jst: jst, end_jst: jst, start_mono_ns: ns, end_mono_ns: ns }).strict(),
}).strict();

// Self-reported memory observations, not an authenticated log, a permission token or native test evidence.
export function createJointAcceptanceMemoryLedger(input) {
  const plan = describeJointAcceptancePlan(input), attempts = [];
  return Object.freeze({
    record(input) {
      if (attempts.length >= 128) refuse("attempt_bound");
      const o = parse(observationSchema, input), c = plan.manifest.cases.find((c) => c.case_id === o.case_id);
      if (o.manifest_sha256 !== plan.manifest_sha256) refuse("manifest_binding");
      if (!c) refuse("case_binding");
      if (plan.manifest.stage !== "C-C0" || c.row !== "G0") refuse("native_case_not_implemented");
      if (Date.parse(o.supplied_timing.end_jst) < Date.parse(o.supplied_timing.start_jst)
        || BigInt(o.supplied_timing.end_mono_ns) < BigInt(o.supplied_timing.start_mono_ns)) refuse("timing_order");
      const matched = o.observed_layer === c.expected_layer && o.observed_code === c.expected_code;
      const a = freeze({ ordinal: attempts.length + 1, status: matched && Object.values(o.assertions).every((v) => v) ? "PASS" : "FAIL",
        observation: o, expected_layer: c.expected_layer, expected_code: c.expected_code });
      attempts.push(a);
      return a;
    },
    describe() {
      return freeze({ schema: "native-bar-joint-acceptance-memory-report-v1", scope: "self_reported_memory_only",
        run_id: plan.manifest.run_id, manifest_sha256: plan.manifest_sha256, plan_declaration: plan.manifest,
        artifact_facts: "not_observed", ...flags(), native_status: "NOT_RUN",
        cleanup: "not_performed", resources: "not_observed", environment: "not_observed", ownership: "not_observed",
        minimal_native_milestone: "NOT_RUN", attempts: [...attempts],
        cases: plan.manifest.cases.map((c) => {
          const observed = attempts.filter((a) => a.observation.case_id === c.case_id);
          return { case_id: c.case_id, row: c.row, required_stage: cases[c.row].stage,
            reached_phase: observed.length ? "memory_plan" : "not_started", evidence: "memory_contract_only",
            status: observed.some((a) => a.status === "FAIL") ? "FAIL" : observed.length ? "PASS" : "NOT_RUN" };
        }) });
    },
  });
}
