import { type KeyObject, randomUUID } from "node:crypto";
import { hrtime } from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { createSyntheticAdmissionReadBootstrap, classifySyntheticAdmissionReadEntry } from "./nativeBarAdmissionReadContracts.js";
import { createSyntheticAdmissionNativeReadRegistry } from "./nativeBarAdmissionReader.js";
import { createSyntheticJointCheckpointOracleBootstrap, claimSyntheticJointCheckpointReader } from "./nativeBarAdmissionOracleRegistry.js";
import { validateSyntheticAdmissionJointBinding, validateSyntheticAdmissionJointWorkEnvelope, planSyntheticAdmissionJointWork,
  checkSyntheticAdmissionJointWorkUsage, selectSyntheticAdmissionJointWitnesses, matchSyntheticAdmissionJointRecordBytes,
  matchSyntheticAdmissionJointContentBytes } from "./nativeBarAdmissionJointReadContracts.js";
import { checkpointProbeNoAuthority, checkpointProbeParse, checkpointProbeOptionsSchema, checkpointProbeObservationSchema } from "./nativeBarAdmissionCheckpointContracts.js";

type Oracle = ReturnType<typeof createSyntheticJointCheckpointOracleBootstrap>;
type Native = ReturnType<typeof createSyntheticAdmissionNativeReadRegistry>;
type Bootstrap = { binding: ReturnType<typeof validateSyntheticAdmissionJointBinding>; envelope: ReturnType<typeof validateSyntheticAdmissionJointWorkEnvelope>;
  oracle: Oracle; native: Native; ticket: object; used: boolean; closed: boolean };
const enrollments = new WeakMap<object, Bootstrap>();
const opaque = () => Object.freeze(Object.create(null) as object);
function refuse(code: string): never { throw new Error(`b3cb_${code}`); }
// The addon throws bare codes (a syscall failure appends ":errno"); B-2 adds b2a_/b2b_. Native refusals stay distinguishable
// from caller input: unavailable, deadline, changed state, contention for shared native slots, work limits, anything else.
const nativeCode = /^(?:b2[ab]_[a-z_]+|admission_[a-z_]+|native_[a-z_]+|session_expired|acl_entry_limit|unsafe_acl)(?::[0-9]{1,5})?$/;
function nativeClass(message: string) {
  const code = message.replace(/:[0-9]+$/, "").replace(/^b2[ab]_/, "");
  if (code === "native_unavailable" || code === "native_protocol") return "b3cb_native_unavailable";
  if (/deadline_or_rollback$/.test(code)) return "b3cb_native_deadline_or_rollback";
  if (/(?:^|_)deadline$/.test(code) || code === "session_expired") return "b3cb_deadline";
  if (/_changed$/.test(code) || code === "admission_inventory_between_passes") return "b3cb_native_changed";
  if (["admission_busy", "admission_root_lease_limit", "admission_fd_headroom", "native_session_limit", "native_fd_limit"].includes(code)) return "b3cb_native_busy";
  if (/_limit$/.test(code)) return "b3cb_native_budget";
  return "b3cb_native_refused";
}
function coded(error: unknown) {
  if (!(error instanceof Error)) return "b3cb_invalid_input";
  const m = error.message;
  if (/^b3cb_[a-z_]+$/.test(m) && m.length <= 96) return m;
  if (/^b3ba_(oracle_unavailable|oracle_changed|oracle_rejected|oracle_cancelled|response_bytes|request_binding|state_budget|identity_reuse|rng_invalid|query_already_active)$/.test(m))
    return m.replace("b3ba_", "b3cb_");
  if (nativeCode.test(m)) return nativeClass(m);
  if (/^b3ca_(native_hash|encoded_hash|expected_hash|mirror_bytes)$/.test(m)) return "b3cb_byte_hash";
  if (/^b3ca_(witness_bound|selected_byte_bound)$/.test(m)) return "b3cb_work_envelope";
  if (/^b3ca_witness_/.test(m)) return "b3cb_witness_prefix";
  return "b3cb_invalid_input";
}
const wallNow = Date.now, tickNow = hrtime.bigint, generateUUID = randomUUID, HostDate = Date, iso = Date.prototype.toISOString;
type Sample = { utc_at: string; monotonic_before_ns: string; monotonic_after_ns: string };
function sample(): Sample {
  try {
    const before = tickNow(), wall = wallNow(), after = tickNow();
    if (typeof before !== "bigint" || typeof after !== "bigint" || before < 0n || after < before || after > 999999999999999999999999999999n
      || !Number.isSafeInteger(wall) || wall < 0 || wall > 253402300799999) refuse("clock_invalid");
    return { utc_at: iso.call(new HostDate(wall)), monotonic_before_ns: String(before), monotonic_after_ns: String(after) };
  } catch { refuse("clock_invalid"); }
}
type Claim = ReturnType<typeof claimSyntheticJointCheckpointReader>;
type Context = ReturnType<Native["beginRead"]>;
type Snapshot = ReturnType<ReturnType<Context["openPair"]>["inventory"]>;
type Checkpoint = { bytes: Buffer; request: { challenge: string; sent_at: string; received_at: string }; sequence: string; tip_hash: string };
type Query = { id: string; start: Sample; last: Sample; ordinal: bigint; ttl: number; failure: string | null;
  state: string; running: boolean; lease: { check(): void; release(): boolean }; cap: bigint; plan: ReturnType<typeof planSyntheticAdmissionJointWork>;
  timer?: ReturnType<typeof setTimeout>; context?: Context; snapshot?: Snapshot; failedBegin: boolean; cleaning: boolean;
  operation?: ReturnType<Claim["dispatch"]>; reject?: (e: Error) => void; requests: number; authenticated: number; ids: number;
  nativeReads?: bigint; nativeStarted?: string };
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/), integer = z.string().regex(/^-?(0|[1-9][0-9]{0,29})$/);
const proofSchema = z.strictObject({ device: uint, inode: uint, uid: uint, gid: uint, mode: uint, flags: uint, size: uint, nlink: uint,
  birthtime_ns: integer, mtime_ns: integer, ctime_ns: integer, acl: z.enum(["none", "deny_only", "unverified", "unsafe"]),
  acl_hash: nativeBarHash.nullable(), allocated_bytes: uint });
const entrySchema = z.strictObject({ index: z.number().int().min(0).max(511), root_role: z.enum(["data", "witness", "fixture"]),
  path: z.string().min(1).refine((p) => Buffer.byteLength(p) <= 512), kind: z.enum(["file", "directory", "symlink", "nonregular"]), proof: proofSchema,
  role: z.string().max(32), namespace_qualified: z.boolean(), access_qualified: z.boolean(), readable_evidence: z.boolean(), raw_byte_limit: uint });
const nativeFlags = { scope: z.literal("synthetic_fixture_only"), execution_available: z.literal(false), recovery_execution_available: z.literal(false),
  admission_verified: z.literal(false), approval_authenticated: z.literal(false), view_verified: z.literal(false), fixture_signature_verified: z.literal(false),
  checkpoint_pair_verified: z.literal(false), logical_prefix_verified: z.literal(false), authority_state_verified: z.literal(false), original_intake_verified: z.literal(false),
  committed_history_available: z.literal(false), elapsed_clock_qualified: z.literal(false), physical_capacity_verified: z.literal(false), native_snapshot_verified: z.boolean(),
  original_acknowledgement: z.literal("not_proven"), storage_visibility_at_as_of: z.literal("not_proven") };
const reportSchema = z.strictObject({ ...nativeFlags, schema: z.enum(["native-bar-native-admission-inventory-v6", "native-bar-native-admission-verification-v6"]),
  entries: z.array(entrySchema).max(512), joint_generation: nativeBarHash, inventory_complete: z.literal(true), namespace_qualified: z.literal(true),
  access_qualified: z.literal(true), inventory_bytes: uint, metadata_bytes: uint, read_bytes: uint, live_fds: uint, live_sessions: uint,
  context_started_at: nativeBarTimestamp, observed_at: nativeBarTimestamp, pending_candidates: uint });
type Entry = z.infer<typeof entrySchema>;
const diagnosticSchema = z.strictObject({ ...Object.fromEntries(Object.entries(checkpointProbeNoAuthority).map(([k, v]) => [k, z.literal(v)])),
  scope: z.literal("synthetic_joint_read_only"), verification_scope: z.literal("joint_read_lifecycle_only"), transaction_replay_verified: z.literal(false),
  schema: z.literal("native-bar-synthetic-joint-read-diagnostic-v1"), registration_hash: nativeBarHash, work_envelope_hash: nativeBarHash,
  query_id: nativeBarId, state: z.enum(["outer_started", "native_context_started", "c0_outstanding", "c0_authenticated", "v0_verified", "c1_outstanding",
    "c1_authenticated", "v1_verified", "releasing", "release_unconfirmed", "released"]), failure: z.string().regex(/^b3cb_[a-z_]+$/).max(96).nullable(),
  cleanup: z.enum(["confirmed", "unconfirmed", "not_requested"]), first_observation: checkpointProbeObservationSchema, last_observation: checkpointProbeObservationSchema,
  event_ordinal: uint, requests_dispatched: z.number().int().min(0).max(2), authenticated_requests: z.number().int().min(0).max(2),
  ids_generated: z.number().int().min(1).max(3), revoked: z.boolean(), retained_state_bytes: uint, active_workspace_bytes: uint });
const resultSchema = diagnosticSchema.extend({ schema: z.literal("native-bar-synthetic-joint-read-result-v1"), scope: z.literal("synthetic_fixture_only"),
  verification_scope: z.literal("authenticated_synthetic_joint_read_only"), state: z.literal("released"), failure: z.null(), cleanup: z.literal("confirmed"),
  revoked: z.literal(false), requests_dispatched: z.literal(2), authenticated_requests: z.literal(2), ids_generated: z.literal(3),
  native_read_available: z.literal(true), native_bytes_verified: z.literal(true), native_snapshot_verified: z.literal(true), fixture_signature_verified: z.literal(true),
  checkpoint_pair_verified: z.literal(true), checkpoint_requests_verified: z.literal(true), logical_prefix_verified: z.literal(true), native_budget_enforced: z.literal(true),
  challenge_generation_verified: z.literal(true), actual_request_timing_verified: z.literal(true), completed_at: nativeBarTimestamp,
  record_count: z.number().int().min(1).max(512), captured_bytes: uint, joint_generation: nativeBarHash, sequence: uint.refine((s) => s !== "0"), tip_hash: nativeBarHash });
const typed = Object.getPrototypeOf(Uint8Array.prototype), lengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!,
  bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!, ordinaryLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
// Bytes are read only through intrinsic getters and copy, as in B-1, so own properties on a view are never consulted. Listing
// them would create one key per byte (about 87 MiB of transient heap for a 1 MiB payload), outside the planned work.
function capture(value: unknown, cap: number) {
  try {
    const n = lengthOf.call(value); ordinaryLength.call(bufferOf.call(value));
    if (!(value instanceof Uint8Array) || ![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(value)) || n < 1 || n > cap) refuse("response_bytes");
    const copy = Buffer.alloc(n); Uint8Array.prototype.set.call(copy, value); return copy;
  } catch { refuse("response_bytes"); }
}
export function createSyntheticAdmissionJointBootstrap(input: unknown, publicKey: KeyObject, workEnvelope: unknown) {
  const binding = validateSyntheticAdmissionJointBinding(input), envelope = validateSyntheticAdmissionJointWorkEnvelope(workEnvelope), r = binding.registration;
  try {
    if (!planSyntheticAdmissionJointWork({ binding, work_envelope: envelope, retained_state_bytes: "0",
      resources: { live_roots: "0", live_targets: "0", live_fds: "0" } }).model_fits) refuse("budget");
  } catch { refuse("budget"); }
  const nativeBootstrap = createSyntheticAdmissionReadBootstrap({ schema: "native-bar-admission-read-bootstrap-v1", scope: "synthetic_fixture_only",
    temp_anchor: r.temp_anchor, pins: r.pins, authority_reference: r.authority_reference }, publicKey);
  const native = createSyntheticAdmissionNativeReadRegistry(nativeBootstrap.token); let oracle: Oracle, ticket: object;
  try { oracle = createSyntheticJointCheckpointOracleBootstrap(binding, publicKey, envelope); }
  catch (error) { native.close(); nativeBootstrap.close(); throw error; }
  // Nothing registered above may stay open and unreachable when the fixture registration refuses.
  try { ticket = native.registerFixture(r); }
  catch (error) {
    for (const close of [() => oracle.close(), () => native.close(), () => nativeBootstrap.close()]) try { close(); } catch { /* The primary error wins. */ }
    throw error;
  }
  const state: Bootstrap = { binding, envelope, oracle, native, ticket, used: false, closed: false }, jointReaderEnrollment = opaque();
  enrollments.set(jointReaderEnrollment, state);
  return Object.freeze({ jointReaderEnrollment, ownerEnrollment: oracle.ownerEnrollment,
    describe() { return { ...oracle.describe(), work_envelope_hash: evidenceHash(envelope), scope: "synthetic_joint_read_only",
      revoked: state.closed || oracle.describe().revoked }; },
    close() { state.closed = true; let failed = false;
      try { oracle.close(); } catch { failed = true; }
      try { native.close(); } catch { failed = true; }
      try { nativeBootstrap.close(); } catch { failed = true; }
      if (failed) refuse("release_unconfirmed");
    } });
}
export function enrollSyntheticAdmissionJointReader(enrollment: object) {
  const b = enrollments.get(enrollment); if (!b) refuse("joint_grant_required");
  if (b.closed) refuse("bootstrap_closed"); if (b.used) refuse("joint_grant_consumed");
  const claim = claimSyntheticJointCheckpointReader(b.oracle.readerEnrollment); b.used = true;
  const queries = new WeakMap<object, Query>(); let closed = false, active: Query | undefined;
  function lookup(t: object) { const q = queries.get(t); if (!q) refuse("query_handle_required"); return q; }
  function cleanup(q: Query) {
    if (q.cleaning) return false; q.cleaning = true;
    try {
      if (q.timer) clearTimeout(q.timer); q.timer = undefined;
      let nativeClosed = true;
      try { q.snapshot?.close(); } catch { nativeClosed = false; q.failure ??= "b3cb_native_release_error"; }
      try { q.context?.close(); q.context = undefined; q.snapshot = undefined; nativeClosed = true; }
      catch { nativeClosed = false; q.failure ??= "b3cb_native_release_error"; }
      // A throwing begin may have retained a B-2 cleanup callback even though it returned no context.
      if (q.failedBegin) try { b!.native.close(); q.failedBegin = false; } catch { nativeClosed = false; }
      if (!nativeClosed || q.running || q.operation && !q.operation.retired()) { q.state = "release_unconfirmed"; return false; }
      q.operation = undefined; q.state = q.lease.release() ? "released" : "release_unconfirmed";
      if (q.state === "released" && active === q) active = undefined;
      return q.state === "released";
    } finally { q.cleaning = false; }
  }
  function fail(q: Query, reason: string) {
    q.failure ??= reason; q.reject?.(new Error(q.failure)); q.reject = undefined;
    if (q.state !== "release_unconfirmed") q.state = "releasing";
    q.operation?.cancel(); cleanup(q);
  }
  function observe(q: Query) {
    const now = sample(), rollback = now.utc_at < q.last.utc_at || BigInt(now.monotonic_before_ns) < BigInt(q.last.monotonic_after_ns);
    if (!rollback) q.last = now; q.ordinal++;
    if (rollback) refuse("clock_rollback");
    if (Date.parse(now.utc_at) - Date.parse(q.start.utc_at) >= q.ttl
      || BigInt(now.monotonic_after_ns) - BigInt(q.start.monotonic_before_ns) >= BigInt(q.ttl) * 1000000n) refuse("deadline");
  }
  function work(q: Query) {
    if (q.failure || q.state === "releasing" || q.state === "release_unconfirmed") refuse("release_only");
    if (q.state === "released") refuse("query_terminal"); if (closed || b!.closed) refuse("session_closed");
    claim.check(); observe(q);
  }
  function remaining(q: Query) {
    work(q); const left = Math.floor(Math.min(q.ttl - (Date.parse(q.last.utc_at) - Date.parse(q.start.utc_at)),
      Number((BigInt(q.ttl) * 1000000n - (BigInt(q.last.monotonic_after_ns) - BigInt(q.start.monotonic_before_ns))) / 1000000n)));
    if (left < 1) refuse("deadline"); return left;
  }
  // B-2 gets the floored remainder above. A Node timer can fire up to 1 ms before its delay (millisecond granularity), so
  // the deadline timer rounds the monotonic remainder up and adds that millisecond: it never fires before the TTL.
  function timerDelay(q: Query) {
    work(q); const elapsed = BigInt(q.last.monotonic_after_ns) - BigInt(q.start.monotonic_before_ns);
    return Math.max(1, Number((BigInt(q.ttl) * 1000000n - elapsed + 999999n) / 1000000n) + 1);
  }
  function describe(q: Query) {
    const account = claim.accounting();
    return diagnosticSchema.parse({ ...checkpointProbeNoAuthority, scope: "synthetic_joint_read_only", verification_scope: "joint_read_lifecycle_only",
      transaction_replay_verified: false, schema: "native-bar-synthetic-joint-read-diagnostic-v1", registration_hash: b!.binding.registration_hash,
      work_envelope_hash: evidenceHash(b!.envelope), query_id: q.id, state: q.state, failure: q.failure,
      cleanup: q.state === "released" ? "confirmed" : q.state === "release_unconfirmed" ? "unconfirmed" : "not_requested",
      first_observation: { ...q.start }, last_observation: { ...q.last }, event_ordinal: String(q.ordinal), requests_dispatched: q.requests,
      authenticated_requests: q.authenticated, ids_generated: q.ids, revoked: closed || b!.closed || claim.revoked(),
      retained_state_bytes: String(account.retained), active_workspace_bytes: String(account.workspace) });
  }
  function request(q: Query, phase: "c0" | "c1", previous?: Checkpoint): Promise<Checkpoint> {
    return new Promise((resolve, reject) => {
      try {
        work(q); if (q.state !== (phase === "c0" ? "native_context_started" : "v0_verified")) refuse("phase_order");
        q.reject = reject; let challenge: string;
        try { challenge = generateUUID(); } catch { refuse("rng_unavailable"); }
        claim.identifier(challenge, q.cap); q.ids++; work(q); const sent = { ...q.last };
        const { public_key_spki_sha256: _key, ...pins } = b!.binding.registration.pins;
        const op = claim.dispatch({ schema: "native-bar-checkpoint-probe-request-v1", scope: "synthetic_checkpoint_probe_only", ...pins,
          registration_hash: b!.binding.registration_hash, authority_reference: b!.binding.registration.authority_reference, query_id: q.id, phase, challenge });
        q.operation = op; q.requests++; q.state = `${phase}_outstanding`;
        op.promise.then((raw) => {
          let checkpoint: Checkpoint | undefined;
          try {
            if (q.failure) return; work(q); const bytes = capture(raw, 4096); work(q);
            const bracket = { challenge, sent_at: sent.utc_at, received_at: q.last.utc_at };
            let checked: ReturnType<Claim["verifier"]["verifyCheckpoint"]>;
            try { checked = claim.verifier.verifyCheckpoint(bytes, bracket); } catch { refuse("checkpoint_refused"); }
            work(q); const c = checked.checkpoint;
            if (previous && (c.sequence !== previous.sequence || c.tip_hash !== previous.tip_hash)) refuse("changing");
            checkpoint = { bytes, request: bracket, sequence: c.sequence, tip_hash: c.tip_hash }; q.authenticated++;
          } catch (error) { fail(q, coded(error)); }
          finally {
            op.retire();
            if (q.failure) cleanup(q);
            else if (!op.retired() || !checkpoint) fail(q, "b3cb_release_unconfirmed");
            else try { q.operation = undefined; work(q); q.state = `${phase}_authenticated`; q.reject = undefined; resolve(checkpoint); }
              catch (error) { fail(q, coded(error)); }
          }
        }, (error) => {
          try { if (!q.failure) { claim.check(); observe(q); } fail(q, coded(error)); }
          catch (failure) { fail(q, coded(failure)); }
          finally { op.retire(); cleanup(q); }
        });
      } catch (error) { fail(q, coded(error)); reject(new Error(coded(error))); }
    });
  }
  function nativeReport(q: Query, input: unknown, verified: boolean, generation?: string) {
    work(q); let report: z.infer<typeof reportSchema>;
    try { report = checkpointProbeParse(reportSchema, input, Number(q.plan.native_limits!.response_bytes)); } catch { refuse("native_report"); }
    if (report.schema !== (verified ? "native-bar-native-admission-verification-v6" : "native-bar-native-admission-inventory-v6")
      || report.native_snapshot_verified !== verified || generation && generation !== report.joint_generation
      || report.context_started_at < q.start.utc_at || report.observed_at > q.last.utc_at || report.observed_at < report.context_started_at
      || q.nativeStarted !== undefined && report.context_started_at !== q.nativeStarted
      || BigInt(report.read_bytes) < (q.nativeReads ?? 0n) || BigInt(report.read_bytes) > BigInt(q.plan.native_limits!.read_bytes)) refuse("native_report");
    q.nativeReads = BigInt(report.read_bytes); q.nativeStarted = report.context_started_at;
    const inventory = { data: { entries: 0n, inventory_bytes: 0n, metadata_bytes: 0n }, witness: { entries: 0n, inventory_bytes: 0n, metadata_bytes: 0n },
      common: { entries: 0n, inventory_bytes: 0n, metadata_bytes: 0n } };
    const objects = { witness_records: 0n, producer_mirrors: 0n, payloads: 0n, receipts: 0n, maintenance_metadata: 0n };
    for (const [i, e] of report.entries.entries()) {
      if (e.index !== i || !e.namespace_qualified || !e.access_qualified) refuse("native_entry");
      const structural = e.root_role === "fixture" && e.role === "directory" && e.kind === "directory"
        && ["fixture-parent", "store", "admission-witness", ...b!.binding.registration.bindings.ancestors.map((_, n) => `ancestor-${n}`)].includes(e.path);
      let c: ReturnType<typeof classifySyntheticAdmissionReadEntry> | null = null;
      if (!structural) try { c = classifySyntheticAdmissionReadEntry({ root_role: e.root_role, path: e.path, kind: e.kind, size: e.proof.size, access: "supplied_safe" }); }
      catch { refuse("native_entry"); }
      if (c && (c.role !== e.role || c.blocker)) refuse("native_entry");
      // The native reader reads the fixture-root controls (both markers) itself and never offers them, or a structural
      // directory, as evidence: they arrive with raw_byte_limit "0" and readable_evidence false, whatever their name's cap.
      const evidence = e.root_role !== "fixture" && c !== null;
      if (e.raw_byte_limit !== (evidence ? c!.raw_byte_limit ?? "0" : "0") || e.readable_evidence !== (evidence && c!.raw_read_candidate)) refuse("native_entry");
      if (e.role === "pending") refuse("publication_pending");
      if (e.role === "coordination" || e.role === "reserve") refuse("coordination_active");
      const counters = inventory[e.root_role === "fixture" ? "common" : e.root_role]; counters.entries++; counters.inventory_bytes += BigInt(e.proof.size);
      if (["control", "witness_record", "producer_mirror", "receipt", "maintenance_metadata", "coordination", "pending"].includes(e.role)) counters.metadata_bytes += BigInt(e.proof.size);
      const key = { witness_record: "witness_records", producer_mirror: "producer_mirrors", payload: "payloads", receipt: "receipts", maintenance_metadata: "maintenance_metadata" }[e.role] as keyof typeof objects | undefined;
      if (key) objects[key]++;
    }
    if (String(Object.values(inventory).reduce((n, c) => n + c.inventory_bytes, 0n)) !== report.inventory_bytes
      || String(Object.values(inventory).reduce((n, c) => n + c.metadata_bytes, 0n)) !== report.metadata_bytes || report.pending_candidates !== "0") refuse("native_report");
    const usage = { inventory: Object.fromEntries(Object.entries(inventory).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, count]) => [n, String(count)]))])),
      objects: Object.fromEntries(Object.entries(objects).map(([k, v]) => [k, String(v)])), selected_bytes: "0", decoded_bytes: "0", interpretation_bytes: "0" };
    if (!checkSyntheticAdmissionJointWorkUsage({ binding: b!.binding, work_envelope: b!.envelope, usage }).within_supplied_envelope) refuse("work_envelope");
    return report;
  }
  function nativeCapture(q: Query, e: Entry) {
    work(q); if (!q.snapshot || !e.readable_evidence || e.root_role === "fixture") refuse("native_entry");
    const out = q.snapshot.readEvidence(e.root_role, e.index); work(q);
    const { index: _index, ...expected } = e;
    const schema = z.strictObject({ ...nativeFlags, schema: z.literal("native-bar-native-admission-bytes-v6"), native_bytes_verified: z.literal(true),
      sha256: nativeBarHash, entry: entrySchema.omit({ index: true }), context_started_at: nativeBarTimestamp, observed_at: nativeBarTimestamp, read_bytes: uint });
    let facts: z.infer<typeof schema>;
    try { facts = checkpointProbeParse(schema, out.facts, 8192); } catch { refuse("native_bytes"); }
    if (canonical(facts.entry) !== canonical(expected) || facts.observed_at < facts.context_started_at || facts.context_started_at < q.start.utc_at
      || facts.context_started_at !== q.nativeStarted
      || facts.observed_at > q.last.utc_at || BigInt(facts.read_bytes) < (q.nativeReads ?? 0n)
      || BigInt(facts.read_bytes) > BigInt(q.plan.native_limits!.read_bytes)) refuse("native_bytes");
    q.nativeReads = BigInt(facts.read_bytes);
    const bytes = capture(out.bytes, Number(e.raw_byte_limit));
    if (String(bytes.byteLength) !== e.proof.size) refuse("native_bytes");
    return { bytes, location: { root_role: e.root_role, path: e.path, index: e.index, size: e.proof.size }, native_sha256: facts.sha256 };
  }
  return Object.freeze({ beginJointRead(raw: unknown = {}) {
    const start = sample(); let opts: ReturnType<typeof checkpointProbeOptionsSchema.parse>;
    if (closed || b.closed) refuse("session_closed");
    try { claim.check(); opts = checkpointProbeParse(checkpointProbeOptionsSchema, raw); } catch (error) { throw new Error(coded(error)); }
    if (active) refuse("query_already_active"); const account = claim.accounting();
    let plan: ReturnType<typeof planSyntheticAdmissionJointWork>;
    try { plan = planSyntheticAdmissionJointWork({ binding: b.binding, work_envelope: b.envelope,
      retained_state_bytes: String(account.retained + account.workspace), ...(opts.lower_limits ? { lower_limits: opts.lower_limits } : {}),
      // Other native users are checked by B-2's original global admission, not inferred as available by this model.
      resources: { live_roots: "0", live_targets: "0", live_fds: "0" } }); } catch { refuse("budget"); }
    if (!plan.model_fits) refuse("budget");
    const cap = BigInt(plan.limits.metadata_bytes!), bytes = BigInt(plan.used.metadata_bytes) - account.retained - account.workspace;
    let q: Query | undefined, lease: ReturnType<Claim["acquire"]>;
    // Another live lease may hold a lower shared cap than this plan saw; that refusal is coded like every other.
    try { lease = claim.acquire(bytes, cap, (reason) => { if (q) fail(q, `b3cb_${reason}`); }); } catch (error) { throw new Error(coded(error)); }
    try {
      let id: string; try { id = generateUUID(); } catch { refuse("rng_unavailable"); }
      claim.identifier(id, cap);
      q = { id, start, last: start, ordinal: 1n, ttl: opts.ttl_ms ?? 600000, failure: null, state: "outer_started", running: false,
        lease, cap, plan, failedBegin: false, cleaning: false, requests: 0, authenticated: 0, ids: 1 };
      const t = opaque(), owned = q; queries.set(t, owned); active = owned;
      try {
        const ttl = remaining(owned);
        if (!plan.native_limits) refuse("budget");
        const limits = Object.fromEntries(Object.entries(plan.native_limits).map(([k, v]) => [k, Number(v)]));
        // Only a native begin that actually threw closes the registration; earlier refusals leave the session usable.
        owned.failedBegin = true; owned.context = b.native.beginRead(b.ticket, limits, ttl); owned.failedBegin = false;
        work(owned); owned.state = "native_context_started";
        owned.timer = setTimeout(() => { if (owned.state === "released") return;
          try { observe(owned); fail(owned, "b3cb_clock_relation_unavailable"); } catch (error) { fail(owned, coded(error)); }
        }, timerDelay(owned)); owned.timer.unref();
      } catch (error) {
        if (owned.failedBegin) { closed = true; b.closed = true; }
        fail(owned, coded(error));
      }
      return t;
    } catch (error) { if (q) fail(q, coded(error)); else lease.release(); throw new Error(coded(error)); }
  },
  async run(t: object) {
    const q = lookup(t); if (q.failure) throw new Error(q.failure);
    if (q.state === "released") refuse("query_terminal");
    let ownsRun = false;
    try {
      work(q); if (q.running || q.state !== "native_context_started") refuse("phase_order"); q.running = true; ownsRun = true;
      const c0 = await request(q, "c0"); work(q);
      const pair = q.context!.openPair(); work(q); q.snapshot = pair.inventory(); work(q);
      const report = nativeReport(q, q.snapshot.report, false), entries = report.entries;
      // Maintenance metadata already decides the outcome (E-D), so no evidence is read before refusing it.
      if (entries.some((e) => e.role === "maintenance_metadata")) refuse("transaction_mapping_pending");
      const selected = selectSyntheticAdmissionJointWitnesses({ work_envelope: b.envelope, checkpoint_sequence: c0.sequence,
        entries: entries.filter((e) => e.root_role === "witness").map((e) => ({ index: e.index, root_role: e.root_role, path: e.path,
          kind: e.kind, size: e.proof.size, access: "supplied_safe" })) });
      const records: { bytes: Buffer; location: { root_role: "witness"; path: string } }[] = [];
      const verified: ReturnType<Claim["verifier"]["verifyRecord"]>["record"][] = [];
      const mirrors = new Set<number>(), roleIds = new Set<string>(); let selectedBytes = 0n, decodedBytes = 0n;
      function take(e: Entry) {
        const next = BigInt(e.proof.size);
        if (selectedBytes + next > BigInt(b!.envelope.selected_bytes) || decodedBytes + 6n * next + 4096n > BigInt(b!.envelope.decoded_bytes)) refuse("work_envelope");
        const captured = nativeCapture(q, e); selectedBytes += next; decodedBytes += 6n * next + 4096n; return captured;
      }
      function ids(value: unknown) {
        if (typeof value === "string" && nativeBarId.safeParse(value).success) { roleIds.add(value.toLowerCase()); if (roleIds.size > 512) refuse("work_envelope"); }
        else if (Array.isArray(value)) for (const v of value) ids(v);
        else if (value && typeof value === "object") for (const v of Object.values(value)) ids(v);
      }
      for (const index of selected.selected_indices) {
        const e = entries[index], captured = take(e), location = { root_role: "witness" as const, path: e.path };
        let checked: ReturnType<Claim["verifier"]["verifyRecord"]>;
        try { checked = claim.verifier.verifyRecord(captured.bytes, location); } catch { refuse("record_refused"); }
        work(q); const witness = { ...captured, encoded_sha256: checked.encoded_sha256 }, body = checked.record.body;
        if (body.sequence !== e.path.slice(0, -5)) refuse("record_binding");
        if (body.type === "enrollment" && (canonical(body.data.store_root) !== canonical(b.binding.registration.bindings.data)
          || canonical(body.data.witness_root) !== canonical(b.binding.registration.bindings.witness))) refuse("record_binding");
        if ("producer_id" in body.data) {
          const producer = body.data.producer_id, mirrorEntry = entries.find((v) => v.root_role === "data" && v.path === `producer/${producer}/${body.sequence}.json`);
          if (!mirrorEntry || mirrorEntry.role !== "producer_mirror" || mirrors.has(mirrorEntry.index)) refuse("mirror_binding");
          const mirror = take(mirrorEntry); let mirrorChecked: ReturnType<Claim["verifier"]["verifyRecord"]>;
          try { mirrorChecked = claim.verifier.verifyRecord(mirror.bytes, { root_role: "data", path: mirrorEntry.path }); } catch { refuse("record_refused"); }
          work(q); matchSyntheticAdmissionJointRecordBytes({ sequence: body.sequence, producer_id: producer, witness,
            mirror: { ...mirror, encoded_sha256: mirrorChecked.encoded_sha256 } }); mirrors.add(mirrorEntry.index);
        } else matchSyntheticAdmissionJointRecordBytes({ sequence: body.sequence, witness });
        ids(checked.record); verified.push(checked.record); records.push({ bytes: captured.bytes, location });
      }
      if (entries.some((e) => e.role === "producer_mirror" && !mirrors.has(e.index))) refuse("mirror_binding");
      claim.bindRecordIds([...roleIds], q.cap); work(q);
      // Current-location replay for maintenance moves/unlinks belongs to E-D, never inferred from a missing file.
      if (verified.some((r) => ["maintenance_admitted", "original_sealed", "maintenance_attempt_consumed", "publication_witness", "coordination_witness"].includes(r.body.type)))
        refuse("transaction_mapping_pending");
      const declarations = new Map<string, { path: string; role: string }>();
      const publications = new Map<string, { sha256: string; proof: Record<string, string> }>();
      for (const r of verified) {
        const body = r.body;
        if (body.type === "producer_reserved") for (const a of body.data.artifacts) {
          const key = `${body.data.producer_id}:${a.artifact_id}`; if (declarations.has(key)) refuse("content_binding"); declarations.set(key, a);
        }
        if (body.type === "publication_observed") {
          const key = `${body.data.producer_id}:${body.data.artifact_id}`, declaration = declarations.get(key);
          if (!declaration || publications.has(declaration.path)) refuse("content_binding");
          publications.set(declaration.path, { sha256: body.data.proof.sha256, proof: body.data.proof });
        }
      }
      for (const [path, publication] of publications) {
        const entry = entries.find((e) => e.root_role === "data" && e.path === path);
        if (!entry || !["payload", "receipt"].includes(entry.role)) refuse("publication_missing");
        for (const [key, value] of Object.entries(publication.proof)) if (key !== "sha256" && entry.proof[key as keyof Entry["proof"]] !== value) refuse("content_binding");
        const captured = take(entry);
        matchSyntheticAdmissionJointContentBytes({ role: entry.role, capture: { ...captured, encoded_sha256: publication.sha256 }, expected_sha256: publication.sha256 });
      }
      if (entries.some((e) => ["payload", "receipt"].includes(e.role) && !publications.has(e.path))) refuse("content_binding");
      work(q); nativeReport(q, q.snapshot.verify(), true, report.joint_generation); q.state = "v0_verified";
      const c1 = await request(q, "c1", c0); work(q);
      nativeReport(q, q.snapshot.verify(), true, report.joint_generation); q.state = "v1_verified"; work(q);
      let transcript: ReturnType<Claim["verifier"]["verifyTranscript"]>;
      try { transcript = claim.verifier.verifyTranscript({ records, start: { bytes: c0.bytes, request: c0.request },
        end: { bytes: c1.bytes, request: c1.request }, evaluated_at: q.last.utc_at }); } catch { refuse("transcript_refused"); }
      work(q);
      if (transcript.model.tip_hash !== c0.tip_hash || transcript.model.record_count !== records.length) refuse("transcript_refused");
      if (transcript.model.producers.some((p) => !p.linked)) refuse("producer_unlinked");
      if (Buffer.byteLength(canonical(transcript.model)) > BigInt(b.envelope.interpretation_bytes)) refuse("work_envelope");
      const result = resultSchema.parse({ ...describe(q), schema: "native-bar-synthetic-joint-read-result-v1", scope: "synthetic_fixture_only",
        verification_scope: "authenticated_synthetic_joint_read_only", state: "released", cleanup: "confirmed", revoked: false,
        native_read_available: true, native_bytes_verified: true, native_snapshot_verified: true, fixture_signature_verified: true,
        checkpoint_pair_verified: true, checkpoint_requests_verified: true, logical_prefix_verified: true, native_budget_enforced: true,
        challenge_generation_verified: true, actual_request_timing_verified: true, completed_at: q.last.utc_at,
        record_count: records.length, captured_bytes: String(selectedBytes), joint_generation: report.joint_generation,
        sequence: c1.sequence, tip_hash: c1.tip_hash });
      if (Buffer.byteLength(canonical(result)) > BigInt(q.plan.limits.response_bytes!)) refuse("response_bytes");
      work(q); q.running = false; q.state = "releasing"; if (!cleanup(q)) refuse("release_unconfirmed");
      if (q.failure) throw new Error(q.failure);
      // No await after release: the same owner generation and original exclusive deadline gate final publication.
      claim.check(); q.lease.check(); observe(q);
      result.last_observation = { ...q.last }; result.completed_at = q.last.utc_at; result.event_ordinal = String(q.ordinal);
      const account = claim.accounting(); result.retained_state_bytes = String(account.retained); result.active_workspace_bytes = String(account.workspace);
      // The published fields changed after the first check, so the returned object is validated and bounded again.
      const published = resultSchema.parse(result);
      if (Buffer.byteLength(canonical(published)) > BigInt(q.plan.limits.response_bytes!)) refuse("response_bytes");
      return published;
    } catch (error) { fail(q, coded(error)); throw new Error(q.failure!); }
    finally { if (ownsRun) { q.running = false; if (q.failure) cleanup(q); } }
  },
  cancel(t: object) { const q = lookup(t); if (q.state !== "released") fail(q, "b3cb_cancelled"); return describe(q); },
  release(t: object) { const q = lookup(t); if (q.state !== "released") fail(q, "b3cb_release_order"); return describe(q); },
  describe(t: object) { const q = lookup(t); if (q.state !== "released") {
    try { if (!q.failure) work(q); } catch (error) { fail(q, coded(error)); }
  } return describe(q); },
  close() { closed = true; if (active) fail(active, "b3cb_session_closed"); let failed = false;
    try { claim.close(); } catch { failed = true; } try { b.native.close(); } catch { failed = true; }
    if (failed) refuse("release_unconfirmed"); },
  });
}
