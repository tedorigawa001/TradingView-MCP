import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canonical, evidenceHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { nativeBarTransactionProofSchema } from "./nativeBarTransactions.js";
import { createNativeBarRecoveryLayout, calculateNativeBarRecoveryCapacity, nativeBarRecoveryInitialPlanSchema, nativeBarRecoveryOriginalSchema,
  nativeBarRecoveryBundleSchema, nativeBarRecoveryAttemptSchema, nativeBarRecoveryMarkerSchema, nativeBarRecoveryCompletionSchema,
  nativeBarRecoveryViewSchema, validateNativeBarRecoveryBundle, planNativeBarRecovery } from "./nativeBarRecovery.js";
import { nativeBarTransactionEventSchema } from "./nativeBarTransactions.js";
import { openSyntheticNativeBarRecoveryReader, type SyntheticRecoveryProof, type SyntheticReadHook } from "./nativeBarFs.js";

const policy = { schema: "native-bar-synthetic-quarantine-recovery-profile-v5" };
const seenRoots = new Set<string>();
const noExecution = { execution_available: false as const, recovery_execution_available: false as const,
  approval_authenticated: false as const, original_acknowledgement: "not_proven" as const, elapsed_clock_qualified: false as const };
type Plan = z.infer<typeof nativeBarRecoveryInitialPlanSchema>;
type Original = z.infer<typeof nativeBarRecoveryOriginalSchema>;
type Bundle = z.infer<typeof nativeBarRecoveryBundleSchema>;
type FileProof = ReturnType<typeof fileProof>;
type ReadOptions = { ttlMs?: number; hook?: SyntheticReadHook };
type Collection = ReturnType<typeof collect>;
function rawHash(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
function same(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
function directory(p: SyntheticRecoveryProof) {
  return { device: p.device, inode: p.inode, uid: p.uid, gid: p.gid, mode: p.mode as "16832", birthtime_ns: p.birthtime_ns,
    flags: p.flags, acl: p.acl as "none" | "deny_only", acl_hash: p.acl_hash };
}
function fileProof(p: SyntheticRecoveryProof & { sha256: string }) {
  const base = nativeBarTransactionProofSchema.parse(Object.fromEntries(Object.keys(nativeBarTransactionProofSchema.shape).map((k) => [k, p[k as keyof typeof p]])));
  return { ...base, flags: p.flags, acl_hash: p.acl_hash };
}
function stable(p: SyntheticRecoveryProof) { return directory(p); }
function readCheck(c: { opened: number; mono: number; ttl: number }) {
  if (Date.now() < c.opened || Date.now() >= c.opened + c.ttl || performance.now() >= c.mono + c.ttl) throw new Error("recovery_read_expired_or_clock_rollback");
}
function collect(root: string, options: ReadOptions = {}) {
  const opened = Date.now(), mono = performance.now(), ttl = options.ttlMs ?? 600000;
  const reader = openSyntheticNativeBarRecoveryReader(root, ttl);
  try {
    const snapshot = reader.inventory({ hook: options.hook, limits: { entries: 512 } });
    try {
      if (!snapshot.report.namespace_qualified) throw new Error("recovery_unqualified_namespace");
      const files = new Map<string, { proof: FileProof; allocated_bytes: string }>(), records = new Map<string, Buffer>();
      let readBytes = BigInt(snapshot.report.lease_read_bytes);
      for (const [index, entry] of snapshot.report.entries.entries()) {
        if (entry.kind === "directory") continue;
        if (entry.kind !== "file" || !entry.readable_evidence) throw new Error("recovery_unqualified_entry");
        const metadata = entry.path === "policy.json" || entry.path.startsWith("maintenance/") || entry.path.endsWith(".timestamp.json")
          || entry.path.startsWith(".publication-") || entry.path.startsWith(".writer");
        if (metadata && BigInt(entry.proof.size) > 65536n) throw new Error("recovery_record_limit");
        const value = snapshot.readEvidence(index, options.hook); readBytes = BigInt(value.lease_read_bytes);
        files.set(entry.path, { proof: fileProof(value.proof), allocated_bytes: value.proof.allocated_bytes });
        if (metadata) records.set(entry.path, value.bytes);
      }
      const report = snapshot.verify(options.hook).report;
      if (report.schema !== "native-bar-native-recovery-inventory-v5" || BigInt(report.lease_read_bytes) < readBytes) throw new Error("recovery_read_accounting");
      const out = { opened, mono, ttl, observed_at: new Date().toISOString(), report, files, records };
      readCheck(out); return out;
    } finally { snapshot.close(); }
  } finally { reader.close(); }
}
function nativeBinding(c: Collection, targets: Plan["targets"], layout?: Plan["layout"]) {
  return { root: directory(c.report.root), ancestor_digest: evidenceHash(c.report.ancestors.map(stable)),
    targets: targets.map((t) => {
      const file = c.files.get(t.source_path) ?? (layout && (c.files.get(`maintenance-hold/${layout.maintenance_id}/${t.target_id}`)
        ?? c.files.get(`quarantine/abandoned/${layout.maintenance_id}/${t.target_id}`)));
      if (!file) throw new Error("recovery_independent_input_missing");
      return { target_id: t.target_id, flags: file.proof.flags, acl_hash: file.proof.acl_hash,
        parents: t.parents.map((p) => {
          const e = c.report.entries.find((e) => e.path === p.path); if (!e || e.kind !== "directory") throw new Error("recovery_parent_missing");
          return { path: p.path, proof: directory(e.proof) };
        }) };
    }) };
}
function entries(c: Collection) {
  return c.report.entries.map((e) => ({ path: e.path, kind: e.kind === "directory" ? "directory" as const : "file" as const,
    size: e.proof.size, sha256: c.files.get(e.path)?.proof.sha256 ?? null, allocated_bytes: e.proof.allocated_bytes,
    proof: c.files.get(e.path)?.proof ?? null, directory_proof: e.kind === "directory" ? directory(e.proof) : null }));
}
function referenceHash(c: Collection, p: Pick<Plan, "layout" | "targets">, coordination: Iterable<string> = []) {
  const self = new Set([...p.layout.directories, p.layout.reserve_path, ...p.layout.publications.flatMap((v) => [v.path, ...v.temporaries.map((t) => t.path)]),
    ...p.targets.flatMap((t) => [t.source_path, `maintenance-hold/${p.layout.maintenance_id}/${t.target_id}`, `quarantine/abandoned/${p.layout.maintenance_id}/${t.target_id}`]), ...coordination]);
  return evidenceHash(c.report.entries.filter((e) => !self.has(e.path)).map((e) => e.kind === "directory"
    ? { path: e.path, kind: e.kind, proof: stable(e.proof) }
    : { path: e.path, kind: e.kind, proof: c.files.get(e.path)!.proof, allocated_bytes: e.proof.allocated_bytes }));
}
function parseRecord(bytes: Buffer | undefined): unknown {
  if (!bytes) throw new Error("recovery_record_missing");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (node === null || typeof node !== "object") continue;
    if (depth >= 64) throw new Error("recovery_record_depth");
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  if (!bytes.equals(Buffer.from(canonical(value)))) throw new Error("recovery_noncanonical_record"); return value;
}
type Admission = { root: string; plan: Plan; fixture_id: string; inputs_digest: string; mono: number; sealed: boolean; invalid: boolean;
  last_wall: number;
  initial_paths: Set<string>; pending?: Original; original?: Original; consumed: number[];
  acknowledged: Map<string, { path: string; hash: string; proof: FileProof }>;
  workers: Map<number, Map<string, { path: string; body: string; proof: FileProof }>>;
  retired: Map<string, { path: string; body: string; proof: FileProof }>; initialInvoked: boolean };
type Connection = { a: Admission; owner: object; alive: () => void; closed: boolean };
const connections = new WeakMap<object, Connection>();
export type SyntheticRecoveryExecutionOwner = { root: string; original: Original; alive: () => void;
  originalWindow: () => void;
  read: () => ReturnType<typeof inspectSyntheticNativeBarRecovery>;
  ledger: () => { original_envelope_hash: string; scope_digest: string; consumed_ordinals: number[]; known_publications: { path: string; hash: string; proof: FileProof }[] };
  consume: (ordinal: number) => void; witnessed: (path: string, record: unknown, proof: SyntheticRecoveryProof & { sha256: string }) => void;
  retired: () => { path: string; proof: FileProof }[];
  registerWorker: (pid: number) => void; observeWorker: (pid: number, nativeEntries: { path: string; present: boolean; proof: Record<string, string> }[]) => void;
  consumeInitial: () => void;
  workerCoordination: (pid: number) => { path: string; body: string; proof: FileProof }[];
  acceptRetirement: (pid: number, source: string, destination: string) => void };
const executionOwners = new WeakMap<object, SyntheticRecoveryExecutionOwner>();
/** Trusted R-C bootstrap bridge, not a root/JSON/reader-ticket promotion or a host approval. */
export function syntheticNativeBarRecoveryExecutionOwner(capability: object): SyntheticRecoveryExecutionOwner {
  const owner = executionOwners.get(capability); if (!owner) throw new Error("recovery_execution_owner_required"); owner.alive(); return owner;
}
function checkScope(a: Admission, c: Collection, live = new Map<string, { proof: FileProof }>()) {
  if (c.report.entries.some((e) => e.path.startsWith(".writer") && !a.retired.has(e.path) && !live.has(e.path))) throw new Error("recovery_coordination_prerequisite");
  for (const [path, entry] of [...a.retired, ...live]) if (!same(c.files.get(path)?.proof, entry.proof)) throw new Error("recovery_coordination_witness_changed");
  if (!same(nativeBinding(c, a.plan.targets, a.plan.layout), a.plan.native_binding)) { a.invalid = true; throw new Error("recovery_native_binding_changed"); }
  if (referenceHash(c, a.plan, [...a.retired.keys(), ...live.keys()]) !== a.plan.baseline.reference_hash) { a.invalid = true; throw new Error("recovery_references_changed"); }
  for (const expected of (a.original ?? a.pending)?.scope.layout_directories ?? []) {
    const e = c.report.entries.find((e) => e.path === expected.path);
    if (!e || e.kind !== "directory" || !same(directory(e.proof), expected.proof)) {
      a.invalid = true; throw new Error("recovery_layout_directory_changed");
    }
  }
  for (const known of a.acknowledged.values()) {
    if (!same(c.files.get(known.path)?.proof, known.proof) || !c.records.has(known.path) || rawHash(c.records.get(known.path)!) !== known.hash)
      throw new Error("recovery_acknowledged_record_changed");
  }
}
function readBundle(a: Admission, c: Collection): Bundle {
  const expected = a.original ?? a.pending; if (!expected) throw new Error("recovery_original_not_prepared");
  const layout = a.plan.layout, prefix = `maintenance/${layout.maintenance_id}`;
  const original = nativeBarRecoveryOriginalSchema.parse(parseRecord(c.records.get(prefix + ".json")));
  if (!same(original, expected)) throw new Error("recovery_original_not_admitted");
  if (!same(parseRecord(c.records.get(`${prefix}.manifest/${layout.chunk_id}.json`)), expected.manifest)) throw new Error("recovery_manifest_not_admitted");
  const present = (role: string) => layout.publications.filter((p) => p.role === role && c.records.has(p.path));
  const attempts = present("attempt").map((p) => {
    const v = nativeBarRecoveryAttemptSchema.parse(parseRecord(c.records.get(p.path)));
    if (v.ordinal !== p.ordinal || v.attempt.attempt_id !== layout.attempt_ids[p.ordinal! - 1]) throw new Error("recovery_attempt_path_binding"); return v;
  });
  const events = present("event").map((p) => {
    const v = nativeBarTransactionEventSchema.parse(parseRecord(c.records.get(p.path)));
    if (v.sequence !== p.sequence) throw new Error("recovery_event_path_binding"); return v;
  });
  const markers = present("marker").map((p) => {
    const record = nativeBarRecoveryMarkerSchema.parse(parseRecord(c.records.get(p.path)));
    if (record.attempt_id !== layout.attempt_ids[p.ordinal! - 1]) throw new Error("recovery_marker_path_binding");
    return { record, proof: c.files.get(p.path)!.proof };
  });
  const completion = c.records.has(prefix + ".done.json") ? nativeBarRecoveryCompletionSchema.parse(parseRecord(c.records.get(prefix + ".done.json"))) : null;
  const b = nativeBarRecoveryBundleSchema.parse({ schema: "native-bar-recovery-bundle-v5", original, attempts, events, markers, completion });
  validateNativeBarRecoveryBundle(b);
  if (b.attempts.some((p) => !a.consumed.includes(p.ordinal))) throw new Error("recovery_unconsumed_attempt");
  return b;
}
function knownPublication(a: Admission, c: Collection, path: string) {
  const value = c.files.get(path), bytes = c.records.get(path);
  if (!value || !bytes || !a.plan.layout.publications.some((p) => p.path === path)) throw new Error("recovery_publication_not_admitted");
  a.acknowledged.set(path, { path, hash: value.proof.sha256, proof: structuredClone(value.proof) });
}
function physicalBytes(c: Collection) {
  return String(c.report.entries.reduce((n, e) => n + BigInt(e.proof.allocated_bytes), BigInt(c.report.root.allocated_bytes)));
}

function evaluate(a: Admission, c: Collection, bundle: Bundle) {
  const layout = a.plan.layout;
  const list = entries(c);
  const generation = { inventory_hash: evidenceHash(list), original_reference_hash: referenceHash(c, a.plan, [...a.retired.keys(), ...[...a.workers.values()].flatMap((v) => [...v.keys()])]),
    native_binding_hash: evidenceHash(nativeBinding(c, a.plan.targets, layout)) };
  const view = nativeBarRecoveryViewSchema.parse({ schema: "native-bar-recovery-view-v5", observed_at: c.observed_at,
    inventory_complete: true, references_complete: true, allocation_complete: true, inventory_hash: evidenceHash(list),
    reference_hash: generation.original_reference_hash, current_reference_hash: evidenceHash(generation),
    native_binding: nativeBinding(c, a.plan.targets, layout), entries: list,
    locations: a.plan.targets.map((t) => ({ target_id: t.target_id, source: c.files.get(t.source_path)?.proof ?? null,
      holding: c.files.get(`maintenance-hold/${layout.maintenance_id}/${t.target_id}`)?.proof ?? null,
      quarantine: c.files.get(`quarantine/abandoned/${layout.maintenance_id}/${t.target_id}`)?.proof ?? null })),
    reserve: c.files.has(layout.reserve_path) ? c.files.get(layout.reserve_path) : null,
    accounting: { occupied_inventory_bytes: c.report.inventory_bytes, occupied_metadata_bytes: c.report.metadata_bytes,
      occupied_allocated_bytes: physicalBytes(c),
      available_bytes: c.report.available_bytes, read_bytes: c.report.lease_read_bytes,
      response_bytes: String(Buffer.byteLength(canonical(bundle)) + Buffer.byteLength(canonical(list))), roots: Number(c.report.live_sessions), descriptors: Number(c.report.live_fds), additional_descriptors: 48 } });
  const ordinal = Math.min(3, Math.max(...a.consumed) + 1), checked = Date.now();
  const result = planNativeBarRecovery({ schema: "native-bar-recovery-query-v5", bundle, view,
    controller: { original_envelope_hash: evidenceHash(a.original ?? a.pending), scope_digest: (a.original ?? a.pending)!.scope_digest,
      consumed_ordinals: [...a.consumed], known_publications: [...a.acknowledged.values()] },
    request: { plan_id: randomUUID(), ordinal, opened_at: new Date(c.opened).toISOString(), issued_at: new Date(c.opened).toISOString(),
      expires_at: new Date(c.opened + 600000).toISOString(), checked_at: new Date(checked).toISOString(), checked_elapsed_ns: String(Math.floor((performance.now() - c.mono) * 1e6)) } });
  return { ...noExecution, verification_scope: "synthetic_native_read_only" as const, controller_scope_verified: result.status !== "blocked",
    bundle, view, result };
}
/** A reader connection is process-local test scaffolding, never an execution or host-approval capability. */
export function inspectSyntheticNativeBarRecovery(ticket: object, options: ReadOptions = {}) {
  const link = connections.get(ticket); if (!link) throw new Error("recovery_wrong_connection");
  link.alive(); if (link.closed) throw new Error("recovery_connection_closed");
  const a = link.a, c = collect(a.root, options); link.alive(); checkScope(a, c);
  const out = evaluate(a, c, readBundle(a, c));
  if (Buffer.byteLength(canonical(out)) > 8 * 1024 ** 2) throw new Error("recovery_response_limit");
  readCheck(c); link.alive(); return out;
}

/** Trusted local fixture bootstrap only. Its objects are not serializable host approvals or execution grants. */
export function createSyntheticNativeBarRecoveryController() {
  let closed = false;
  const pid = process.pid;
  const owner = Object.freeze({});
  const admissions = new WeakMap<object, Admission>();
  function admission(handle: object) {
    if (closed || process.pid !== pid) throw new Error("recovery_controller_unavailable");
    const a = admissions.get(handle); if (!a) throw new Error("recovery_wrong_admission_issuer"); return a;
  }
  function alive(a: Admission) {
    if (closed || process.pid !== pid) throw new Error("recovery_controller_unavailable");
    if (a.invalid) throw new Error("recovery_admission_scope_invalid");
    const now = Date.now(); if (now < a.last_wall) throw new Error("recovery_controller_clock_rollback"); a.last_wall = now;
  }
  function originalWindow(a: Admission) {
    alive(a); const start = Date.parse(a.plan.opened_at);
    if (Date.now() < start || Date.now() >= Date.parse(a.plan.expires_at) || performance.now() >= a.mono + 600000) throw new Error("recovery_original_window_expired");
  }
  return {
    admit(root: string, inputs: { source_path: string; bytes: Buffer }[]) {
      if (closed) throw new Error("recovery_controller_unavailable");
      if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 2 || new Set(inputs.map((i) => i.source_path)).size !== inputs.length)
        throw new Error("recovery_independent_input_scope");
      inputs = inputs.map((i) => {
        if (!Buffer.isBuffer(i.bytes) || i.bytes.length > 1048576) throw new Error("recovery_independent_input_scope");
        return { source_path: i.source_path, bytes: Buffer.from(i.bytes) };
      });
      const c = collect(root);
      if (!same(parseRecord(c.records.get("policy.json")), policy)) throw new Error("recovery_synthetic_profile_required");
      if (c.report.entries.length > 128 || c.report.entries.some((e) => e.path !== "policy.json" && e.path !== "captures"
        && !/^captures\/[0-9]{4}-[0-9]{2}-[0-9]{2}(?:\/[0-9a-f-]{36}\.json)?$/.test(e.path))) throw new Error("recovery_fresh_fixture_required");
      const identity = `${c.report.root.device}:${c.report.root.inode}:${c.report.root.birthtime_ns}`;
      if (seenRoots.has(identity)) throw new Error("recovery_fixture_already_admitted");
      const targets: Plan["targets"] = inputs.map((i) => {
        const match = /^captures\/([0-9]{4}-[0-9]{2}-[0-9]{2})\/([0-9a-f-]{36})\.json$/.exec(i.source_path);
        const current = c.files.get(i.source_path);
        if (!match || !Buffer.isBuffer(i.bytes) || i.bytes.length > 1048576 || !current || current.proof.sha256 !== rawHash(i.bytes)
          || current.proof.size !== String(i.bytes.length)) throw new Error("recovery_independent_input_mismatch");
        nativeBarId.parse(match[2]); nativeBarTimestamp.parse(match[1] + "T00:00:00.000Z");
        const { flags, acl_hash, ...proof } = current.proof; void flags; void acl_hash;
        const parents = ["captures", `captures/${match[1]}`].map((path) => {
          const p = c.report.entries.find((e) => e.path === path)!.proof;
          return { path, device: p.device, inode: p.inode, uid: p.uid, mode: "16832" as const, acl: p.acl as "none" | "deny_only" };
        });
        return { target_id: randomUUID(), origin: { kind: "capture" as const, recording_id: match[2] }, source_path: i.source_path, proof, parents };
      });
      const count = 9 + 14 * targets.length, layout = createNativeBarRecoveryLayout({ maintenance_id: randomUUID(), chunk_id: randomUUID(), reserve_id: randomUUID(),
        attempt_ids: [randomUUID(), randomUUID(), randomUUID()], target_count: targets.length, temporary_ids: Array.from({ length: 3 * count }, () => randomUUID()) });
      const binding = nativeBinding(c, targets);
      const fields = { schema: "native-bar-quarantine-plan-v5" as const, plan_id: randomUUID(), opened_at: new Date(c.opened).toISOString(),
        expires_at: new Date(c.opened + 600000).toISOString(), binding: { profile: "native-bar-transaction-profile-v2" as const,
          policy_hash: evidenceHash(policy), root: { device: binding.root.device, inode: binding.root.inode, uid: binding.root.uid, mode: "16832" as const, acl: binding.root.acl },
          backend_protocol: 2 as const, capabilities_hash: evidenceHash({ recovery_read_protocol: 5, volume: c.report.volume }) },
        baseline: { inventory_hash: evidenceHash(entries(c)), reference_hash: referenceHash(c, { targets, layout }) }, native_binding: binding, targets, layout };
      const plan = nativeBarRecoveryInitialPlanSchema.parse({ ...fields, plan_hash: evidenceHash(fields) });
      const capacity = calculateNativeBarRecoveryCapacity({ schema: "native-bar-recovery-capacity-v5", phase: "initial", target_count: targets.length,
        occupied_entries: String(c.report.entries.length), occupied_inventory_bytes: c.report.inventory_bytes, occupied_metadata_bytes: c.report.metadata_bytes,
        occupied_allocated_bytes: physicalBytes(c),
        remaining_publications: count, remaining_temporaries: 3 * count, available_bytes: c.report.available_bytes, reserve_allocated_bytes: null,
        read_bytes: c.report.lease_read_bytes, response_bytes: String(Buffer.byteLength(canonical(plan))), roots: Number(c.report.live_sessions), descriptors: Number(c.report.live_fds), additional_descriptors: 48 });
      if (!capacity.fits) throw new Error(`recovery_capacity:${capacity.reasons.join(",")}`);
      const handle = Object.freeze({}); readCheck(c);
      if (closed || process.pid !== pid) throw new Error("recovery_controller_unavailable"); seenRoots.add(identity);
      admissions.set(handle, { root, plan, fixture_id: randomUUID(), inputs_digest: evidenceHash(inputs.map((i) => ({ source_path: i.source_path, sha256: rawHash(i.bytes) }))),
        mono: c.mono, sealed: false, invalid: false, last_wall: Date.now(), initial_paths: new Set(c.report.entries.map((e) => e.path)), consumed: [], acknowledged: new Map(), workers: new Map(), retired: new Map(), initialInvoked: false });
      return { ...noExecution, admission: handle, plan: structuredClone(plan), capacity };
    },
    prepareOriginal(handle: object, options: ReadOptions = {}) {
      const a = admission(handle); originalWindow(a);
      if (a.sealed || a.pending) throw new Error("recovery_original_already_prepared");
      const c = collect(a.root, options); originalWindow(a); checkScope(a, c);
      const layout = a.plan.layout, allowed = new Set([...a.initial_paths, ...layout.directories, layout.reserve_path]);
      if (c.report.entries.some((e) => !allowed.has(e.path)) || layout.directories.some((p) => !c.report.entries.some((e) => e.path === p && e.kind === "directory")))
        throw new Error("recovery_preparation_scope_changed");
      for (const t of a.plan.targets) {
        const { flags, acl_hash, ...proof } = c.files.get(t.source_path)?.proof ?? {}; void flags; void acl_hash;
        if (!same(proof, t.proof)) throw new Error("recovery_independent_input_changed");
      }
      const reserve = c.files.get(layout.reserve_path); if (!reserve) throw new Error("recovery_original_allocation_missing");
      const manifest = { schema: "native-bar-maintenance-manifest-v2" as const, maintenance_id: layout.maintenance_id, chunk_id: layout.chunk_id, targets: a.plan.targets };
      const scope = { schema: "native-bar-recovery-scope-v5" as const, fixture_id: a.fixture_id, initial_plan_hash: a.plan.plan_hash,
        native_binding_hash: evidenceHash(a.plan.native_binding), manifest_hash: evidenceHash(manifest), inputs_digest: a.inputs_digest,
        layout_directories: layout.directories.map((path) => ({ path, proof: directory(c.report.entries.find((e) => e.path === path)!.proof) })),
        allocation: { path: layout.reserve_path, ...reserve, acknowledged: { utc_at: c.observed_at, elapsed: null } } };
      const intent = { schema: "native-bar-maintenance-intent-v2" as const, maintenance_id: layout.maintenance_id, kind: "quarantine_abandoned" as const,
        binding: a.plan.binding, created: { utc_at: a.plan.opened_at, elapsed: null }, approval_plan_hash: a.plan.plan_hash, baseline: a.plan.baseline,
        manifests: [{ chunk_id: layout.chunk_id, hash: evidenceHash(manifest) }], target_count: a.plan.targets.length, quarantine_refs: [] };
      const original = nativeBarRecoveryOriginalSchema.parse({ schema: "native-bar-quarantine-intent-v5", plan: a.plan, scope, scope_digest: evidenceHash(scope), intent, manifest });
      validateNativeBarRecoveryBundle({ schema: "native-bar-recovery-bundle-v5", original, attempts: [], events: [], markers: [], completion: null });
      readCheck(c); originalWindow(a); a.pending = original; return structuredClone(original);
    },
    sealOriginal(handle: object, options: ReadOptions = {}) {
      const a = admission(handle); originalWindow(a); if (!a.pending || a.sealed) throw new Error("recovery_original_not_prepared_or_already_sealed");
      const c = collect(a.root, options); originalWindow(a); checkScope(a, c);
      a.consumed = [1];
      try {
        const b = readBundle(a, c);
        if (b.events.length || b.markers.length || b.completion || b.attempts.some((p) => p.ordinal !== 1)) throw new Error("recovery_original_seal_too_late");
        const allowed = new Set([...a.initial_paths, ...a.plan.layout.directories, a.plan.layout.reserve_path,
          ...a.plan.layout.publications.filter((p) => ["manifest", "intent", "attempt"].includes(p.role)).map((p) => p.path)]);
        if (c.report.entries.some((e) => !allowed.has(e.path))) throw new Error("recovery_original_seal_scope");
        const checked = evaluate(a, c, b);
        if (checked.result.status !== "planned_only") throw new Error(`recovery_original_seal_conflict:${checked.result.blocking_reasons.join(",")}`);
        readCheck(c); originalWindow(a);
        for (const p of a.plan.layout.publications) if (c.records.has(p.path)) knownPublication(a, c, p.path);
        a.original = a.pending; a.sealed = true; return { ...noExecution, original_sealed: true as const, scope_digest: a.original.scope_digest };
      } catch (error) { a.consumed = []; throw error; }
    },
    connect(handle: object) {
      const a = admission(handle); alive(a); if (!a.sealed) throw new Error("recovery_original_not_sealed");
      const ticket = Object.freeze({}); connections.set(ticket, { a, owner, alive: () => alive(a), closed: false }); return ticket;
    },
    connectExecutionForSyntheticTest(handle: object) {
      const a = admission(handle); alive(a); if (!a.sealed) throw new Error("recovery_original_not_sealed");
      const capability = Object.freeze({}), ticket = Object.freeze({});
      connections.set(ticket, { a, owner, alive: () => alive(a), closed: false });
      executionOwners.set(capability, Object.freeze({ root: a.root, get original() { alive(a); return structuredClone(a.original!); }, alive: () => alive(a),
        originalWindow: () => originalWindow(a),
        retired: () => { alive(a); return structuredClone([...a.retired.values()].map(({ path, proof }) => ({ path, proof }))); },
        registerWorker: (pid) => { alive(a); if (!Number.isSafeInteger(pid) || pid < 1 || a.workers.has(pid)) throw new Error("recovery_worker_registration"); a.workers.set(pid, new Map()); },
        consumeInitial: () => {
          originalWindow(a); if (a.initialInvoked || a.consumed.length !== 1 || a.consumed[0] !== 1) throw new Error("recovery_original_invocation_consumed");
          a.initialInvoked = true;
        },
        observeWorker: (pid, nativeEntries) => {
          alive(a); const known = a.workers.get(pid); if (!known || known.size) throw new Error("recovery_worker_registration");
          if (!Array.isArray(nativeEntries) || nativeEntries.length !== 3) throw new Error("recovery_worker_native_coordination_required");
          const c = collect(a.root), own = new Map<string, { path: string; body: string; proof: FileProof }>();
          for (const e of c.report.entries.filter((e) => e.path.startsWith(".writer") && !a.retired.has(e.path))) {
            const body = c.records.get(e.path)?.toString("utf8"); if (!body || body.length > 128) throw new Error("recovery_worker_coordination_unknown");
            const value = parseRecord(Buffer.from(body)) as { pid: number; token: string; ticket?: number };
            const actual = c.files.get(e.path)!.proof, native = nativeEntries.find((n) => n.path === e.path);
            if (!native?.present || Object.entries(native.proof).some(([key, value]) => actual[key as keyof FileProof] !== value)) throw new Error("recovery_worker_native_coordination_changed");
            if (value.pid !== pid || !nativeBarId.safeParse(value.token).success
              || e.path !== ".writer.lock" && e.path !== `.writer-claim-${value.token}.json` && e.path !== `.writer-ticket-${value.token}.json`)
              throw new Error("recovery_worker_coordination_unknown");
            own.set(e.path, { path: e.path, body, proof: c.files.get(e.path)!.proof });
          }
          if (own.size !== 3 || !own.has(".writer.lock")) throw new Error("recovery_worker_coordination_incomplete");
          checkScope(a, c, own); const b = readBundle(a, c); validateNativeBarRecoveryBundle(b);
          a.workers.set(pid, own); alive(a);
        },
        workerCoordination: (pid) => {
          alive(a); const own = a.workers.get(pid); if (!own?.size) throw new Error("recovery_worker_coordination_unwitnessed");
          const c = collect(a.root); checkScope(a, c, own); validateNativeBarRecoveryBundle(readBundle(a, c)); alive(a);
          return structuredClone([...own.values()]);
        },
        acceptRetirement: (pid, source, destination) => {
          alive(a); const own = a.workers.get(pid), before = own?.get(source);
          if (!before || !/^\.writer-retired-[0-9a-f-]{36}\.lock$/.test(destination) || a.retired.has(destination) || a.retired.size >= 16) throw new Error("recovery_retirement_scope");
          const c = collect(a.root), after = c.files.get(destination)?.proof;
          if (!after || c.files.has(source) || c.records.get(destination)?.toString("utf8") !== before.body) throw new Error("recovery_retirement_changed");
          const { ctime_ns: oldTime, ...oldProof } = before.proof, { ctime_ns: newTime, ...newProof } = after;
          if (!same(oldProof, newProof) || BigInt(newTime) < BigInt(oldTime)) throw new Error("recovery_retirement_changed");
          const remaining = new Map(own); remaining.delete(source); remaining.set(destination, { path: destination, body: before.body, proof: after });
          checkScope(a, c, remaining); a.retired.set(destination, remaining.get(destination)!); remaining.delete(destination); a.workers.set(pid, remaining); alive(a);
        },
        read: () => inspectSyntheticNativeBarRecovery(ticket),
        ledger: () => { alive(a); return structuredClone({ original_envelope_hash: evidenceHash(a.original), scope_digest: a.original!.scope_digest,
          consumed_ordinals: a.consumed, known_publications: [...a.acknowledged.values()] }); },
        consume: (ordinal) => { alive(a); if (ordinal < 2 || ordinal > 3 || ordinal !== Math.max(...a.consumed) + 1) throw new Error("recovery_ordinal_unavailable"); a.consumed.push(ordinal); },
        witnessed: (path, record, proof) => {
          alive(a); if (!a.plan.layout.publications.some((p) => p.path === path) || proof.sha256 !== evidenceHash(record)
            || proof.size !== String(Buffer.byteLength(canonical(record)))) throw new Error("recovery_publication_not_admitted");
          a.acknowledged.set(path, { path, hash: proof.sha256, proof: structuredClone(fileProof(proof)) });
        } })); return capability;
    },
    disconnect(ticket: object) {
      const link = connections.get(ticket); if (!link || link.owner !== owner) throw new Error("recovery_wrong_connection");
      link.alive(); link.closed = true;
    },
    consumeAttempt(handle: object, ordinal: number) {
      const a = admission(handle); alive(a); if (!a.sealed || ordinal < 2 || ordinal > 3 || ordinal !== Math.max(...a.consumed) + 1) throw new Error("recovery_ordinal_unavailable");
      a.consumed.push(ordinal); return { ...noExecution, consumed_ordinal: ordinal };
    },
    rememberPublication(handle: object, path: string, record: unknown, options: ReadOptions = {}) {
      const a = admission(handle); alive(a); if (!a.sealed) throw new Error("recovery_original_not_sealed");
      const c = collect(a.root, options); alive(a); checkScope(a, c); readBundle(a, c);
      if (!c.records.get(path)?.equals(Buffer.from(canonical(record)))) throw new Error("recovery_publication_bytes_changed");
      readCheck(c); alive(a); knownPublication(a, c, path); return { ...noExecution, publication_observed: path };
    },
    close() { closed = true; },
  };
}
