// C-C1a supplied-data models only. No file, native, key, clock or process capability is imported.
import { createHash } from "node:crypto";
import { z } from "zod";

const refuse = (code) => { throw Error(`cc1a_${code}`); };
function copyJson(input) {
  // Trusted test callers: descriptor values are bounded; hostile Proxy reflection is not isolated.
  let nodes = 0, bytes = 0;
  function text(s) { bytes += Buffer.byteLength(s); if (s.length > 8192 || bytes > 262144) refuse("input_bound"); }
  function visit(v, depth) {
    if (++nodes > 8192 || depth > 16) refuse("input_bound");
    if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isSafeInteger(v)) return v;
    if (typeof v === "string") { text(v); return v; }
    if (!v || typeof v !== "object") refuse("invalid_input");
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) refuse("invalid_input");
    if (keys.length > (array ? 257 : 64) || array && (v.length > 256 || keys.length !== v.length + 1)) refuse("input_bound");
    const out = array ? [] : Object.create(null);
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
        || array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) refuse("invalid_input");
      text(key); const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !d.enumerable || !("value" in d)) refuse("invalid_input");
      Object.defineProperty(out, key, { value: visit(d.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    return out;
  }
  return visit(input, 0);
}
function parse(schema, input) {
  const r = schema.safeParse(copyJson(input)); if (!r.success) refuse("invalid_input"); return r.data;
}
function frozen(v) {
  if (v && typeof v === "object") { for (const child of Object.values(v)) frozen(child); Object.freeze(v); } return v;
}
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const sha = (v) => createHash("sha256").update(v).digest("hex"), digest = (v) => sha(canonical(v));
const label = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/), modeSchema = z.enum(["normal", "ubsan"]);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const requestSchema = z.object({ schema: z.literal("native-bar-unsigned-acceptance-request-v1"), stage: z.literal("C-C1a"),
  run_id: label, source_commit: z.string().regex(/^[a-f0-9]{40}$/), patch_sha256: hash }).strict();
const catalog = frozen([
  ["u0-unavailable", "U0", "checkpoint_c0", "oracle_unavailable", "unavailable", ["1.json"], "none", 1, 0],
  ["u0-unsigned", "U0", "checkpoint_c0", "checkpoint_refused", "unsigned", ["1.json"], "none", 1, 0],
  ["u1-unsigned", "U1", "record", "record_refused", "fixed_memory", ["1.json"], "none", 1, 0],
  ["u2-missing", "U2", "prefix", "witness_prefix", "fixed_memory", [], "none", 1, 0],
  ["u2-extra", "U2", "prefix", "witness_prefix", "fixed_memory", ["1.json", "2.json"], "none", 2, 0],
  ["u2-gap", "U2", "prefix", "witness_prefix", "fixed_memory", ["2.json"], "none", 1, 0],
  ["u3-pending", "U3", "inventory", "publication_pending", "fixed_memory", ["1.json"], "pending", 1, 0],
  ["u3-writer", "U3", "inventory", "coordination_active", "fixed_memory", ["1.json"], "writer", 1, 0],
  ["u3-reserve", "U3", "inventory", "coordination_active", "fixed_memory", ["1.json"], "reserve", 1, 0],
  ["u3-maintenance", "U3", "interpretation", "transaction_mapping_pending", "fixed_memory", ["1.json"], "maintenance", 1, 1],
  ["u3-maintenance-bound", "U3", "inventory", "work_envelope", "fixed_memory", ["1.json"], "maintenance", 1, 0],
  ["u4-expected-inode", "U4", "native", "native_refused", "fixed_memory", ["1.json"], "none", 1, 0],
].map(([case_id, row, expected_layer, code, owner, witnesses, extra, witness_slots, maintenance_slots]) =>
  ({ case_id, row, expected_layer, expected_code: `b3cb_${code}`, owner, witnesses, extra, witness_slots, maintenance_slots })));
function caseFor(id) { const c = catalog.find((c) => c.case_id === id); if (!c) refuse("case_binding"); return c; }
const noAuthority = () => ({ scope: "unsigned_acceptance_memory_model_only", execution_available: false, cleanup_execution_available: false,
  approval_authenticated: false, ownership_verified: false, native_read_available: false, native_bytes_verified: false,
  fixture_signature_verified: false, checkpoint_pair_verified: false, native_snapshot_verified: false, view_verified: false,
  authority_state_verified: false, original_intake_verified: false, admission_verified: false, recovery_execution_available: false,
  checkpoint_requests_verified: false, logical_prefix_verified: false, transaction_replay_verified: false,
  physical_capacity_verified: false, committed_history_available: false, elapsed_clock_qualified: false, native_status: "NOT_RUN",
  original_acknowledgement: "not_proven", storage_visibility_at_as_of: "not_proven" });
const limits = frozen({ maximum_fixtures: 24, maximum_live_fixtures: 1, maximum_workers: 1, fixture_objects: 16,
  fixture_depth: 3, fixture_content_bytes: 131072, ancestor_headroom_bytes: "196608", receipt_records: 64,
  receipt_bytes: 1048576, case_report_bytes: 262144, trace_events: 128, run_index_bytes: 131072 });

export function describeUnsignedAcceptanceRun(input) {
  const declaration = parse(requestSchema, input);
  return frozen({ schema: "native-bar-unsigned-acceptance-plan-v1", ...noAuthority(), declaration,
    plan_sha256: digest({ declaration, catalog, limits }), modes: ["normal", "ubsan"], anchor: "/private/tmp", limits,
    cases: ["normal", "ubsan"].flatMap((mode) => catalog.map((c) => ({ ...c, mode, status: "NOT_RUN" }))),
    outputs: ["normal", "ubsan"].map((mode) => ({ mode, directory: `build/b3cc-validation/${mode}/`, state: "not_observed" })),
    execution_blocker: "C-C1b_not_approved_or_implemented" });
}

const fixtureSchema = z.object({ request: requestSchema, case_id: label, mode: modeSchema,
  fixture_name: z.string().regex(/^native-bar-fs-synthetic-[A-Za-z0-9]{6}$/),
  ids: z.object({ fixture: uuid, store: uuid, epoch: uuid, authority: uuid, key: uuid, reference: uuid, extra: uuid }).strict() }).strict();
export function describeUnsignedFixture(input) {
  const d = parse(fixtureSchema, input), c = caseFor(d.case_id), run = describeUnsignedAcceptanceRun(d.request), entries = [];
  if (new Set(Object.values(d.ids)).size !== 7) refuse("identity_alias");
  const dir = (path) => entries.push({ path, kind: "directory", mode: "16832" });
  const file = (path, content) => entries.push({ path, kind: "file", mode: "33152", content, size: String(Buffer.byteLength(content)), sha256: sha(content) });
  dir(""); dir("store"); dir("admission-witness");
  const policy = canonical({ schema: "native-bar-synthetic-admission-profile-v6" });
  file(".native-bar-fs-synthetic", "synthetic-fixture-v1\n");
  file(".native-bar-admission-synthetic", canonical({ schema: "native-bar-admission-fixture-marker-v1", fixture_id: d.ids.fixture,
    store_id: d.ids.store, epoch_id: d.ids.epoch, policy_hash: sha(policy), data_root: "store", witness_root: "admission-witness" }));
  file("store/policy.json", policy);
  for (const name of c.witnesses) file(`admission-witness/${name}`, '{"invented":"C-C1 unsigned"}\n');
  if (c.extra === "pending") file(`store/.producer-${d.ids.extra}.tmp`, '{"invented":"pending"}\n');
  if (c.extra === "writer") file("store/.writer.lock", '{"invented":"not a lock acquisition"}\n');
  if (c.extra === "reserve") file(`store/.quarantine-reserve-${d.ids.extra}.tmp`, "");
  if (c.extra === "maintenance") { dir("store/maintenance"); file(`store/maintenance/${d.ids.extra}.json`, "{}\n"); }
  const content_bytes = entries.reduce((n, e) => n + Number(e.size ?? "0"), 0);
  if (entries.length > limits.fixture_objects || content_bytes > limits.fixture_content_bytes
    || entries.some((e) => e.path && e.path.split("/").length > limits.fixture_depth)) refuse("recipe_bound");
  const recipe = { declaration: d, plan_sha256: run.plan_sha256, entries, content_bytes,
    binding_delta: c.row === "U4" ? "data_inode_only" : "none", witness_slots: c.witness_slots, maintenance_slots: c.maintenance_slots };
  return frozen({ schema: "native-bar-unsigned-fixture-description-v1", ...noAuthority(), ...recipe, recipe_sha256: digest(recipe) });
}

const proofSchema = z.object({ kind: z.enum(["directory", "file"]), device: uint, inode: uint, uid: uint, gid: uint,
  mode: z.enum(["16832", "33152"]), birthtime_ns: uint, flags: z.literal("0"), acl: z.enum(["none", "deny_only"]), acl_hash: hash,
  nlink: uint, size: uint, sha256: hash.nullable() }).strict();
const entrySchema = z.object({ path: z.string().max(128), proof: proofSchema }).strict();
const cleanupSchema = z.object({ entries: z.array(entrySchema).max(16), supervisor: z.enum(["live", "lost", "unknown"]),
  worker: z.enum(["live", "lost", "never_started", "unknown"]), ancestor_chain: z.enum(["same", "changed", "unknown"]),
  receipt: z.enum(["complete", "failed", "unknown"]), query: z.enum(["never_started", "settled", "unconfirmed"]),
  native: z.enum(["never_started", "settled", "unconfirmed"]), original_operation_retired: z.boolean(), query_released: z.boolean(),
  resources: z.object({ fds_before: uint, fds_after: uint, roots_before: uint, roots_after: uint, workspace_before: uint, workspace_after: uint }).strict(),
  fixture_absent: z.boolean() }).strict();
const baselineSchema = z.object({ fds: uint, roots: uint, workspace: uint }).strict();
const ownerSchema = z.object({ fixture: fixtureSchema, supervisor_id: label, worker_id: label, uid: uint, gid: uint,
  baseline_resources: baselineSchema }).strict();
function immutableProof(p) {
  const { size, nlink, ...identity } = p; return p.kind === "directory" ? identity : p;
}
function deletionOrder(entries) {
  const depth = (p) => p === "" ? 0 : p.split("/").length;
  return [...entries].sort((a, b) => depth(b.path) - depth(a.path) || (a.proof.kind === b.proof.kind ? 0 : a.proof.kind === "file" ? -1 : 1)
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// A supplied-data lifecycle, not an importer of receipts, a live supervisor or a filesystem executor.
export function createUnsignedOwnershipModel(input) {
  const d = parse(ownerSchema, input), recipe = describeUnsignedFixture(d.fixture), created = [], removed = [], history = [];
  let setup = "incomplete", stopped = null;
  const fail = (reason) => { stopped ??= reason; return stopped; };
  function append(kind, detail) {
    const event = frozen({ ordinal: history.length + 1, kind, ...detail });
    if (history.length >= limits.receipt_records || Buffer.byteLength(canonical([...history, event])) > limits.receipt_bytes) {
      fail("receipt_bound"); refuse("receipt_bound");
    }
    history.push(event);
  }
  function change(action) {
    if (stopped) refuse("model_stopped");
    try { return action(); } catch (e) { fail(e instanceof Error && /^cc1a_[a-z_]+$/.test(e.message) ? e.message.slice(5) : "invalid_input"); throw e; }
  }
  function assess(raw) {
    const o = parse(cleanupSchema, raw), remaining = created.filter((e) => !removed.includes(e.path));
    const hold = (reason) => { fail(reason); return frozen({ ...noAuthority(), decision: "hold", reason: stopped, next_entry: null }); };
    if (stopped) return hold(stopped);
    if (o.supervisor !== "live" || o.worker === "lost" || o.worker === "unknown") return hold("controller_lost");
    if (o.ancestor_chain !== "same" || o.receipt !== "complete") return hold("ownership_or_receipt_unknown");
    const r = o.resources;
    for (const key of ["fds", "roots", "workspace"]) {
      if (r[`${key}_before`] !== d.baseline_resources[key]) return hold("resource_baseline_changed");
      if (r[`${key}_after`] !== d.baseline_resources[key]) return hold("resources_unconfirmed");
    }
    const rollback = setup === "aborted" && o.query === "never_started" && o.native === "never_started" && o.worker === "never_started";
    const settled = setup === "complete" && o.worker === "live" && o.query === "settled" && o.native === "settled"
      && o.original_operation_retired && o.query_released;
    if (!rollback && !settled) return hold("release_unconfirmed");
    if (new Set(o.entries.map((e) => e.path)).size !== o.entries.length || o.entries.length !== remaining.length) return hold("entry_set_changed");
    for (const e of remaining) {
      const actual = o.entries.find((v) => v.path === e.path);
      if (!actual || canonical(immutableProof(e.proof)) !== canonical(immutableProof(actual.proof))) return hold("entry_changed");
    }
    if (!remaining.length) {
      if (!o.fixture_absent) return hold("absence_unconfirmed");
      return frozen({ ...noAuthority(), decision: "supplied_complete", reason: null, next_entry: null });
    }
    if (o.fixture_absent) return hold("entry_set_changed");
    const next = deletionOrder(remaining)[0];
    return frozen({ ...noAuthority(), decision: "supplied_next_entry", reason: null,
      next_entry: { path: next.path, operation: next.proof.kind === "file" ? "unlink_nonrecursive" : "rmdir_empty" } });
  }
  return Object.freeze({
    recordCreation(raw) { return change(() => {
      if (setup !== "incomplete") refuse("phase_order");
      const e = parse(entrySchema, raw), expected = recipe.entries.find((v) => v.path === e.path), p = e.proof;
      if (!expected || created.some((v) => v.path === e.path)) refuse("creation_binding");
      const parent = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "";
      if (e.path !== "" && !created.some((v) => v.path === parent && v.proof.kind === "directory")) refuse("parent_required");
      if (p.kind !== expected.kind || p.mode !== expected.mode || p.uid !== d.uid || p.gid !== d.gid
        || p.kind === "file" && (p.nlink !== "1" || p.size !== expected.size || p.sha256 !== expected.sha256)
        || p.kind === "directory" && p.sha256 !== null) refuse("creation_proof");
      if (created.some((v) => v.proof.device !== p.device || v.proof.inode === p.inode)) refuse("object_alias_or_device");
      append("created", { entry: e }); created.push(frozen(e)); return Object.freeze({ ...noAuthority(), recorded_entries: created.length });
    }); },
    finishSetup() { return change(() => {
      if (setup !== "incomplete" || created.length !== recipe.entries.length) refuse("setup_incomplete");
      append("setup_complete", {}); setup = "complete";
    }); },
    abortSetup() { return change(() => {
      if (setup !== "incomplete") refuse("phase_order"); append("setup_aborted", {}); setup = "aborted";
    }); },
    assessCleanup(raw) { try { return assess(raw); } catch (e) { fail("invalid_observation"); throw e; } },
    recordRemoval(raw) { return change(() => {
      const v = parse(z.object({ observation: cleanupSchema, path: z.string().max(128), outcome: z.enum(["removed", "missing", "changed", "error"]),
        receipt_write: z.enum(["confirmed", "failed"]) }).strict(), raw);
      const a = assess(v.observation);
      if (a.decision !== "supplied_next_entry" || a.next_entry.path !== v.path) refuse("removal_order");
      append("removal", { path: v.path, outcome: v.outcome, receipt_write: v.receipt_write });
      if (v.outcome === "removed") removed.push(v.path);
      if (v.outcome !== "removed" || v.receipt_write !== "confirmed") fail("removal_or_receipt_failure");
    }); },
    describe() {
      return frozen({ schema: "native-bar-unsigned-ownership-memory-receipt-v1", ...noAuthority(),
        plan_sha256: recipe.plan_sha256, recipe_sha256: recipe.recipe_sha256, case_id: d.fixture.case_id, mode: d.fixture.mode,
        supervisor_id: d.supervisor_id, worker_id: d.worker_id, fixture_name: d.fixture.fixture_name,
        baseline_resources: { ...d.baseline_resources },
        setup, stopped, entries: [...created], removed_paths: [...removed], history: [...history], receipt_authenticated: false });
    },
  });
}

const phaseSchema = z.enum(["native_begin", "c0_dispatch", "c0_authenticated", "open_pair", "inventory", "witness_capture", "c1_dispatch", "v0", "v1", "transcript"]);
const negativeSchema = z.object({ request: requestSchema, case_id: label, mode: modeSchema, plan_sha256: hash,
  expected_layer: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/), observed_code: z.string().regex(/^b3cb_[a-z_]{1,64}$/),
  phases: z.array(phaseSchema).max(128), requests_dispatched: z.number().int().min(0).max(2), authenticated_requests: z.number().int().min(0).max(2),
  capture_matches_setup: z.boolean(), markers_zero_unreadable: z.boolean(), original_operation_retired: z.boolean(), query_released: z.boolean(),
  resources_at_baseline: z.boolean(), teardown: z.enum(["confirmed", "unconfirmed", "not_performed"]) }).strict();
export function assessUnsignedNegativeModel(input) {
  const o = parse(negativeSchema, input), run = describeUnsignedAcceptanceRun(o.request), c = caseFor(o.case_id);
  if (run.plan_sha256 !== o.plan_sha256) refuse("plan_binding");
  const phases = ["native_begin", "c0_dispatch"], blockers = [];
  if (c.owner === "fixed_memory") phases.push("c0_authenticated", "open_pair");
  if (c.owner === "fixed_memory" && c.row !== "U4") phases.push("inventory");
  if (c.row === "U1") phases.push("witness_capture");
  if (canonical(o.phases) !== canonical(phases)) blockers.push("phase_order");
  if (o.expected_layer !== c.expected_layer || o.observed_code !== c.expected_code) blockers.push("outcome_binding");
  if (o.requests_dispatched !== 1 || o.authenticated_requests !== (c.owner === "fixed_memory" ? 1 : 0)) blockers.push("request_count");
  if (o.capture_matches_setup !== (c.row === "U1")) blockers.push("byte_comparison");
  if (o.markers_zero_unreadable !== phases.includes("inventory")) blockers.push("marker_encoding");
  if (!o.original_operation_retired || !o.query_released || !o.resources_at_baseline || o.teardown !== "confirmed") blockers.push("settlement_or_teardown");
  const report = { schema: "native-bar-unsigned-negative-model-result-v1", ...noAuthority(), plan_sha256: run.plan_sha256,
    case_id: c.case_id, mode: o.mode, model_status: blockers.length ? "inconsistent_supplied_negative" : "consistent_supplied_negative",
    blockers, supplied_observation: o, minimal_positive_milestone: "NOT_RUN", timing_verified: false, native_budget_enforced: false };
  if (Buffer.byteLength(canonical(report)) > limits.case_report_bytes) refuse("report_bound");
  return frozen(report);
}

export function describeUnsignedHarnessArguments(input) {
  const a = parse(z.array(z.string().max(128)).length(9), input);
  if (a[0] !== "--inspect" || a[1] !== "--stage" || a[3] !== "--run-id" || a[5] !== "--source-commit" || a[7] !== "--patch-sha256") refuse("invalid_arguments");
  return describeUnsignedAcceptanceRun({ schema: "native-bar-unsigned-acceptance-request-v1", stage: a[2], run_id: a[4], source_commit: a[6], patch_sha256: a[8] });
}
