import { z } from "zod";
import { describeUnsignedAcceptanceRun, describeUnsignedFixture } from "./jointUnsignedAcceptanceContracts.mjs";
import { validateUnsignedWorkerConfiguration } from "./unsignedWorkerConfiguration.mjs";
import { uint, digestSchema as hash, code, label, count, parse, canonical, digest, byteLength, freeze, flags, refuse, LIMITS } from "./unsignedControllerData.mjs";

const totals = z.object({ entries: count(512), inventory_bytes: uint, metadata_bytes: uint }).strict();
const objects = z.object(Object.fromEntries(["witness_records", "producer_mirrors", "payloads", "receipts", "maintenance_metadata"].map((k) => [k, uint]))).strict();
const diagnostic = z.object({ origin: z.literal("original_diagnostic"), sha256: hash,
  state: z.enum(["released", "release_unconfirmed", "releasing"]), cleanup: z.enum(["confirmed", "unconfirmed", "not_requested"]),
  requests_dispatched: count(2), authenticated_requests: count(2) }).strict();
const usage = z.object({ origin: z.literal("source_pinned_rederivation"), reader_source_sha256: hash, reader_js_sha256: hash,
  inventory_sha256: hash, totals_sha256: hash, blockers: z.array(code).max(32) }).strict();
// The worker's projection holds only facts the worker observed before RELEASED; bound-object proofs are the supervisor's.
export const observationSchema = z.object({ primary_code: code,
  available: z.object({ diagnostic: z.boolean(), inventory: z.boolean(), capture: z.boolean(), usage: z.boolean() }).strict(),
  diagnostic: diagnostic.nullable(),
  inventory: z.object({ origin: z.literal("original_inventory"), sha256: hash, complete: z.boolean(), sampled: z.boolean(), entry_count: count(512),
    totals: z.object({ data: totals, witness: totals, common: totals }).strict(),
    objects,
    markers: z.array(z.object({ marker: z.enum(["base", "admission"]), raw_byte_limit: uint, readable_evidence: z.boolean() }).strict()).max(2) }).strict().nullable(),
  capture: z.object({ origin: z.literal("native_capture"), sha256: hash, bytes: uint,
    path: z.enum(["admission-witness/1.json", "admission-witness/2.json"]) }).strict().nullable(),
  usage: usage.nullable(),
  native_throws: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}(?::[0-9]{1,5})?$/)).max(8), instrumentation_overflow: z.boolean(),
  c0_dispatched_at: z.null(), c0_authenticated_at: z.null(), retired_at: z.null(),
}).strict();

export function validateUnsignedControllerObservation(input) {
  const d = parse(observationSchema, input);
  if (byteLength(canonical(d)) > LIMITS.observation_bytes) refuse("observation_capacity");
  for (const k of Object.keys(d.available)) if (d.available[k] !== (d[k] !== null)) refuse("observation_availability");
  return freeze(d);
}

export function describeUnsignedControllerLimitations() {
  return freeze({ ...flags(), assertions: [
    { id: "direct_c0_transport_timestamps", status: "BLOCKED", reason: "not_exposed_by_original_diagnostic" },
    { id: "direct_native_mismatch_location", status: "BLOCKED", reason: "bare_error_has_no_location" },
    { id: "direct_reader_usage_builder", status: "BLOCKED", reason: "reader_mapping_is_private" },
  ], substitute_expected_values: false });
}
function differences(a, b, prefix = "") {
  if (canonical(a) === canonical(b)) return [];
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return [prefix];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) =>
    !Object.hasOwn(a, k) || !Object.hasOwn(b, k) ? [prefix ? `${prefix}.${k}` : k] : differences(a[k], b[k], prefix ? `${prefix}.${k}` : k));
}
export function assessUnsignedControllerAssertions(input) {
  const d = parse(z.object({ request: z.unknown(), fixture: z.unknown(), case_id: label, observation: observationSchema,
    reader_source_sha256: hash, reader_js_sha256: hash, registration_sha256: hash, envelope_sha256: hash,
    witness: z.object({ sha256: hash, bytes: uint }).strict().nullable(), configuration: z.unknown().nullable(), supplied_registration: z.unknown().nullable(),
    bound_objects: z.object({ pre: z.unknown(), post: z.unknown() }).strict().nullable(),
    bound_object_receipts: z.object({ pre_sha256: hash.nullable(), post_sha256: hash.nullable() }).strict() }).strict(), input);
  const plan = describeUnsignedAcceptanceRun(d.request), c = plan.cases.find((v) => v.case_id === d.case_id);
  if (!c) refuse("case_binding"); const recipe = describeUnsignedFixture(d.fixture);
  if (recipe.declaration.case_id !== d.case_id || canonical(recipe.declaration.request) !== canonical(plan.declaration)) refuse("case_binding");
  const o = validateUnsignedControllerObservation(d.observation), missing = [], bad = [];
  const need = (k) => { if (!o.available[k]) missing.push(k); return o.available[k]; };
  // A supplied configuration counts only as the exact sealed one: same fixture, registration and envelope digests.
  const sealed = (configuration, registration_sha256) => {
    try { return validateUnsignedWorkerConfiguration({ fixture: d.fixture, configuration, registration_sha256, envelope_sha256: d.envelope_sha256 }).configuration; }
    catch { return null; }
  };
  let config = null;
  if (d.configuration !== null) { config = sealed(d.configuration, d.registration_sha256); if (!config) bad.push("configuration_origin"); }
  if (o.instrumentation_overflow) missing.push("instrumentation_overflow");
  if (o.primary_code !== c.expected_code) bad.push("expected_code");
  if (need("diagnostic")) {
    if (o.diagnostic.requests_dispatched !== 1 || o.diagnostic.authenticated_requests !== (c.owner === "fixed_memory" ? 1 : 0)) bad.push("request_counts");
    // The plan counts a leaked or unconfirmed resource as FAIL, not as a missing fact.
    if (o.diagnostic.state !== "released" || o.diagnostic.cleanup !== "confirmed") bad.push("original_release");
  }
  const hasInventory = c.owner === "fixed_memory" && c.row !== "U4";
  if (hasInventory && need("inventory")) {
    const i = o.inventory, roles = Object.values(i.totals), complete = i.complete && !i.sampled;
    if (!complete) missing.push("complete_inventory");
    // Rows that are present must be right; rows a partial projection lacks only make it incomplete.
    if (roles.some((r) => BigInt(r.metadata_bytes) > BigInt(r.inventory_bytes))) bad.push("inventory_totals");
    if (Object.values(i.objects).reduce((n, v) => n + BigInt(v), 0n) > BigInt(i.entry_count)) bad.push("inventory_object_counts");
    if (new Set(i.markers.map((m) => m.marker)).size !== i.markers.length || i.markers.some((m) => m.raw_byte_limit !== "0" || m.readable_evidence)) bad.push("marker_encoding");
    if (complete) {
      if (roles.reduce((n, v) => n + v.entries, 0) !== i.entry_count) bad.push("inventory_totals");
      if (i.markers.length !== 2) bad.push("marker_encoding");
      // The fixed recipe fixes every object count and lower-bounds each role by the files it places there.
      const expected = { witness_records: c.witnesses.length, producer_mirrors: 0, payloads: 0, receipts: 0, maintenance_metadata: c.extra === "maintenance" ? 1 : 0 };
      const files = (inRole) => recipe.entries.filter((e) => e.kind === "file" && inRole(e.path)).length;
      if (Object.entries(expected).some(([k, v]) => i.objects[k] !== String(v)) || i.totals.witness.entries < files((p) => p.startsWith("admission-witness/"))
        || i.totals.data.entries < files((p) => p.startsWith("store/")) || i.totals.common.entries < files((p) => !p.includes("/"))) bad.push("inventory_recipe");
    }
  }
  if (!hasInventory && o.available.inventory) bad.push("unexpected_inventory");
  if (c.row === "U1") {
    if (need("capture")) { if (!d.witness) missing.push("independent_witness");
      else {
        const known = recipe.entries.find((e) => e.path === "admission-witness/1.json");
        if (o.capture.sha256 !== d.witness.sha256 || o.capture.bytes !== d.witness.bytes || o.capture.path !== known.path
          || d.witness.sha256 !== known.sha256 || d.witness.bytes !== known.size) bad.push("capture_bytes");
      } }
  } else if (o.available.capture) bad.push("unexpected_capture");
  if (c.case_id === "u3-maintenance-bound" && need("usage")) {
    if (!o.inventory || !o.inventory.complete || o.inventory.sampled) missing.push("usage_inventory");
    else if (o.usage.inventory_sha256 !== o.inventory.sha256 || o.usage.totals_sha256 !== digest({ totals: o.inventory.totals, objects: o.inventory.objects })
      || o.usage.reader_source_sha256 !== d.reader_source_sha256 || o.usage.reader_js_sha256 !== d.reader_js_sha256) bad.push("usage_origin");
    if (d.configuration === null) missing.push("sealed_work_envelope");
    else if (config && o.inventory && o.inventory.complete && !o.inventory.sampled) {
      // The pinned reader uses these whole-inventory counters before capture, with zero decoded/selected work.
      const blockers = [], e = config.work_envelope, i = o.inventory;
      for (const role of ["data", "witness", "common"]) for (const key of ["entries", "inventory_bytes", "metadata_bytes"])
        if (BigInt(i.totals[role][key]) > BigInt(e.inventory[role][key])) blockers.push(`${role}_${key}`);
      for (const key of Object.keys(i.objects)) if (BigInt(i.objects[key]) > BigInt(e.objects[key])) blockers.push(key);
      if (canonical(blockers) !== canonical(o.usage.blockers) || canonical(blockers) !== '["maintenance_metadata"]') bad.push("usage_cause");
    }
  } else if (o.available.usage) bad.push("unexpected_usage");
  if (c.row === "U4") {
    const correct = config?.binding.registration ?? null, receipts = d.bound_object_receipts;
    if (d.configuration === null || d.supplied_registration === null) missing.push("registration_comparison");
    else if (correct) {
      // The supplied side must itself be a valid registration for this fixture, differing only in the data inode.
      const supplied = sealed({ ...config, binding: { ...config.binding, registration: d.supplied_registration, registration_hash: digest(d.supplied_registration) } },
        digest(d.supplied_registration))?.binding.registration;
      if (!supplied || canonical(differences(correct, supplied)) !== '["bindings.data.inode"]') bad.push("registration_delta");
    }
    // Independent supervisor proofs taken before GO and after RELEASED, bound by their receipt digests.
    if (!d.bound_objects || !receipts.pre_sha256 || !receipts.post_sha256) missing.push("bound_object_proofs");
    else {
      if (digest(d.bound_objects.pre) !== receipts.pre_sha256 || digest(d.bound_objects.post) !== receipts.post_sha256) bad.push("bound_object_origin");
      if (correct) {
        const { data: _data, ...nondata } = correct.bindings;
        if (canonical(d.bound_objects.pre) !== canonical(nondata) || canonical(d.bound_objects.post) !== canonical(nondata)) bad.push("bound_object_change");
      }
    }
    if (canonical(o.native_throws.map((s) => s.replace(/:[0-9]{1,5}$/, ""))) !== '["admission_expected_binding"]') bad.push("native_cause");
  } else {
    if (o.native_throws.length) bad.push("unexpected_native_throw");
    if (d.supplied_registration !== null || d.bound_objects !== null) bad.push("unexpected_registration_delta");
  }
  return freeze({ schema: "native-bar-unsigned-assertions-model-v2", ...flags(),
    model_outcome: bad.length ? "FAIL" : missing.length ? "BLOCKED" : "CONSISTENT_SUPPLIED_ASSERTIONS",
    mismatches: [...new Set(bad)], unavailable: [...new Set(missing)], observation_sha256: digest(o),
    attribution: c.row === "U4" || c.case_id === "u3-maintenance-bound" ? "source_constrained_inference" : "supplied_original_observations",
    direct_assertions: describeUnsignedControllerLimitations().assertions });
}
