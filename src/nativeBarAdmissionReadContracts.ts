import { createHash, type KeyObject } from "node:crypto";
import { pid } from "node:process";
import { z } from "zod";
import { canonical, evidenceHash, nativeBarHash, nativeBarId } from "./nativeBarEvidence.js";
import { NATIVE_BAR_ADMISSION_LIMITS, NATIVE_BAR_ADMISSION_PROFILE } from "./nativeBarAdmission.js";
import { createSyntheticNativeBarAdmissionVerifier } from "./nativeBarAdmissionVerification.js";

const L = NATIVE_BAR_ADMISSION_LIMITS;
const uuid = nativeBarId.refine((v) => v === v.toLowerCase());
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const flags = uint.refine((v) => !/^[0-9]+$/.test(v) || BigInt(v) <= 4294967295n);
const utf8 = (v: string) => Buffer.from(v).toString("utf8") === v;
const absolute = z.string().min(1).refine((v) => utf8(v) && Buffer.byteLength(v) <= 4096
  && !v.includes("\\") && !v.includes("\0") && (v === "/" || v.startsWith("/") && v.slice(1).split("/").every((p) => p && p !== "." && p !== "..")));
const pinsSchema = z.strictObject({ fixture_id: uuid, store_id: uuid, epoch_id: uuid, authority_id: uuid, key_id: uuid,
  enrollment_hash: nativeBarHash, public_key_spki_sha256: nativeBarHash });
const bootstrapSchema = z.strictObject({ schema: z.literal("native-bar-admission-read-bootstrap-v1"), scope: z.literal("synthetic_fixture_only"),
  temp_anchor: absolute.refine((v) => v !== "/"), pins: pinsSchema, authority_reference: uuid });
const binding = z.strictObject({ device: uint, inode: uint, uid: uint, gid: uint, mode: uint, flags,
  birthtime_ns: uint, acl: z.enum(["none", "deny_only"]), acl_hash: nativeBarHash });
const privateDirectory = binding.extend({ mode: z.literal("16832") });
const markerProof = binding.extend({ mode: z.literal("33152"), nlink: z.literal("1"), size: uint, sha256: nativeBarHash });
export const nativeBarAdmissionReadRegistrationSchema = z.strictObject({ schema: z.literal("native-bar-admission-read-registration-v1"),
  scope: z.literal("synthetic_fixture_only"), pins: pinsSchema, authority_reference: uuid, temp_anchor: absolute.refine((v) => v !== "/"),
  fixture_name: z.string().regex(/^native-bar-fs-synthetic-[A-Za-z0-9]{6}$/), policy_hash: nativeBarHash,
  bindings: z.strictObject({ ancestors: z.array(z.strictObject({ path: absolute, proof: binding })).min(1).max(16),
    fixture_parent: privateDirectory, data: privateDirectory, witness: privateDirectory,
    markers: z.strictObject({ base: markerProof, admission: markerProof }) }),
  volume: z.strictObject({ filesystem: z.literal("apfs"), local: z.literal(true), ownership_enforced: z.literal(true),
    case_preserving: z.literal(true), case_sensitive: z.boolean(), read_only_mount: z.boolean() }) });
type Registration = z.infer<typeof nativeBarAdmissionReadRegistrationSchema>;
const noAuthority = Object.freeze({ scope: "synthetic_fixture_only" as const, verification_scope: "supplied_read_contracts_only" as const,
  native_read_available: false as const, native_bytes_verified: false as const, native_snapshot_verified: false as const,
  view_verified: false as const, fixture_signature_verified: false as const, checkpoint_pair_verified: false as const,
  logical_prefix_verified: false as const, authority_state_verified: false as const, original_intake_verified: false as const,
  admission_verified: false as const, approval_authenticated: false as const, execution_available: false as const,
  recovery_execution_available: false as const, committed_history_available: false as const, elapsed_clock_qualified: false as const,
  physical_capacity_verified: false as const, original_acknowledgement: "not_proven" as const, storage_visibility_at_as_of: "not_proven" as const });
const bytes = (v: unknown) => Buffer.byteLength(canonical(v));

// Structured contracts only: never traverse accessors, exotic arrays or unbounded strings before schema work.
function bounded(value: unknown, limit: number = L.record_bytes) {
  let size = 0, nodes = 0; const active = new Set<object>();
  function visit(v: unknown, depth: number) {
    if (++nodes > 262144 || depth > 64) throw new Error("b2a_input_depth_or_nodes");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("b2a_non_json"); return; }
    if (typeof v === "string") { size += Buffer.byteLength(v); if (size > limit) throw new Error("b2a_input_bytes"); return; }
    if (typeof v !== "object" || active.has(v)) throw new Error("b2a_non_json");
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error("b2a_non_json");
    if (array && v.length > 262144 - nodes) throw new Error("b2a_input_depth_or_nodes");
    const keys = Reflect.ownKeys(v); if (array && keys.length !== v.length + 1) throw new Error("b2a_non_json");
    active.add(v);
    for (const k of keys) {
      if (array && k === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (typeof k !== "string" || !d.enumerable || !Object.hasOwn(d, "value")
        || array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) throw new Error("b2a_non_json");
      size += Buffer.byteLength(k); if (size > limit) throw new Error("b2a_input_bytes"); visit(d.value, depth + 1);
    }
    active.delete(v);
  }
  visit(value, 0); if (bytes(value) > limit) throw new Error("b2a_input_bytes");
}
function parse<T>(schema: z.ZodType<T>, input: unknown, limit: number = L.record_bytes): T {
  bounded(input, limit); const result = schema.safeParse(input);
  if (!result.success) throw new Error("b2a_invalid_input"); return result.data;
}
function identities(pins: z.infer<typeof pinsSchema>, reference: string) {
  if (new Set([pins.fixture_id, pins.store_id, pins.epoch_id, pins.authority_id, pins.key_id, reference]).size !== 6)
    throw new Error("b2a_role_alias");
}
const prefixes = (path: string) => ["/", ...path.slice(1).split("/").map((_, i, a) => "/" + a.slice(0, i + 1).join("/"))];
export function validateSyntheticAdmissionReadRegistration(input: unknown) {
  const r = parse(nativeBarAdmissionReadRegistrationSchema, input); identities(r.pins, r.authority_reference);
  if (r.policy_hash !== evidenceHash(NATIVE_BAR_ADMISSION_PROFILE)) throw new Error("b2a_policy_binding");
  const paths = prefixes(r.temp_anchor);
  if (paths.length !== r.bindings.ancestors.length || paths.some((p, i) => r.bindings.ancestors[i].path !== p)) throw new Error("b2a_ancestor_chain");
  const { fixture_parent: parent, data, witness, markers, ancestors } = r.bindings;
  const all = [parent, data, witness, markers.base, markers.admission, ...ancestors.map((a) => a.proof)];
  if (new Set(all.map((p) => canonical([p.device, p.inode]))).size !== all.length) throw new Error("b2a_object_alias");
  if ([data, witness, markers.base, markers.admission].some((p) => p.device !== parent.device || p.uid !== parent.uid || p.gid !== parent.gid))
    throw new Error("b2a_root_binding");
  for (const a of ancestors) {
    const mode = BigInt(a.proof.mode);
    if ((mode & 61440n) !== 16384n || mode > 65535n || !["0", parent.uid].includes(a.proof.uid)
      || (mode & 18n) !== 0n && (mode & 512n) === 0n) throw new Error("b2a_ancestor_access");
  }
  const marker = { schema: "native-bar-admission-fixture-marker-v1", fixture_id: r.pins.fixture_id, store_id: r.pins.store_id,
    epoch_id: r.pins.epoch_id, policy_hash: r.policy_hash, data_root: "store", witness_root: "admission-witness" };
  if (markers.base.sha256 !== createHash("sha256").update("synthetic-fixture-v1\n").digest("hex") || markers.base.size !== "21"
    || markers.admission.sha256 !== evidenceHash(marker) || markers.admission.size !== String(bytes(marker))) throw new Error("b2a_marker_binding");
  return r;
}

type Bootstrap = { expected: z.infer<typeof bootstrapSchema>; ownerPid: number; closed: boolean; revocations: Set<() => void> };
const bootstraps = new WeakMap<object, Bootstrap>();
type NativeClaim = { registration: Registration; check(): void; release(): void };
const nativeRegistries = new WeakMap<object, (ticket: object, close: () => void) => NativeClaim>();
const token = () => Object.freeze(Object.create(null) as object);
export function createSyntheticAdmissionReadBootstrap(input: unknown, publicKey: KeyObject) {
  const expected = parse(bootstrapSchema, input); identities(expected.pins, expected.authority_reference);
  try { createSyntheticNativeBarAdmissionVerifier(expected.pins, publicKey); }
  catch { throw new Error("b2a_public_key_refused"); }
  const state: Bootstrap = { expected, ownerPid: pid, closed: false, revocations: new Set() }, t = token(); bootstraps.set(t, state);
  return Object.freeze({ token: t, close() {
    state.closed = true; let failed = false;
    for (const revoke of [...state.revocations]) try { revoke(); } catch { failed = true; }
    if (failed) throw new Error("b2a_release_unconfirmed");
  } });
}
export function createSyntheticAdmissionReadRegistry(bootstrap: object) {
  const b = bootstraps.get(bootstrap); if (!b || b.closed || b.ownerPid !== pid) throw new Error("b2a_bootstrap_required");
  let closed = false, issued = false;
  type Entry = { registration: Registration; closed: boolean; nativeClose?: () => void };
  const tickets = new WeakMap<object, Entry>(); let registered: Entry | undefined;
  function alive() { if (closed || b!.closed || b!.ownerPid !== pid) throw new Error("b2a_registry_closed"); }
  const close = () => { closed = true; registered?.nativeClose?.(); b.revocations.delete(close); }; b.revocations.add(close);
  function entry(t: object) {
    alive(); const e = tickets.get(t); if (!e || e.closed) throw new Error("b2a_fixture_ticket_required"); return e;
  }
  const registry = Object.freeze({
    registerFixture(input: unknown) {
      alive(); if (issued) throw new Error("b2a_registration_already_issued");
      const registration = validateSyntheticAdmissionReadRegistration(input);
      if (registration.temp_anchor !== b.expected.temp_anchor || registration.authority_reference !== b.expected.authority_reference
        || canonical(registration.pins) !== canonical(b.expected.pins)) throw new Error("b2a_bootstrap_binding");
      const t = token(); registered = { registration, closed: false }; tickets.set(t, registered); issued = true; return t;
    },
    describe(t: object) {
      const e = entry(t); return { ...noAuthority, schema: "native-bar-admission-read-registration-result-v1" as const,
        registration_hash: evidenceHash(e.registration), fixture_id: e.registration.pins.fixture_id, supplied_binding_valid: true as const,
        temporary_anchor_qualified: false as const, process_local_ticket: true as const };
    },
    beginRead(t: object, lowerLimits?: unknown): never {
      entry(t); readLimits(lowerLimits);
      throw new Error("b2a_native_read_unavailable");
    },
    closeFixture(t: object) {
      const e = tickets.get(t); if (!e) throw new Error("b2a_fixture_ticket_required"); e.closed = true; e.nativeClose?.();
    }, close,
  });
  nativeRegistries.set(registry, (t, onClose) => {
    const e = entry(t); if (e.nativeClose) throw new Error("b2a_read_already_active"); e.nativeClose = onClose;
    return { registration: structuredClone(e.registration), check() { entry(t); },
      release() { if (e.nativeClose === onClose) e.nativeClose = undefined; } };
  });
  return registry;
}

/** Internal capability bridge. No path lookup, native loading or caller-supplied proof callback. */
export function claimSyntheticAdmissionNativeRead(registry: object, ticket: object, releaseOnly: () => void): NativeClaim {
  const claim = nativeRegistries.get(registry); if (!claim) throw new Error("b2a_registry_required");
  if (typeof releaseOnly !== "function") throw new Error("b2a_release_callback_required");
  return claim(ticket, releaseOnly);
}

const relative = z.string().min(1).refine((v) => utf8(v) && Buffer.byteLength(v) <= 512 && !v.includes("\\") && !v.includes("\0")
  && v.split("/").length <= 16 && v.split("/").every((p) => p && p !== "." && p !== ".."));
const roleSchema = z.enum(["data", "witness", "fixture"]);
const entrySchema = z.strictObject({ root_role: roleSchema, path: relative, kind: z.enum(["file", "directory", "symlink", "nonregular"]),
  size: uint, access: z.enum(["supplied_safe", "unsafe", "unknown"]) });
const U = "(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|0{8}-0{4}-0{4}-0{4}-0{12}|f{8}-f{4}-f{4}-f{4}-f{12})";
const S = "[1-9][0-9]{0,29}", D = "[0-9]{4}-[0-9]{2}-[0-9]{2}";
type Role = "directory" | "control" | "witness_record" | "producer_mirror" | "payload" | "receipt" | "maintenance_metadata"
  | "coordination" | "pending" | "reserve" | "ordinary_side" | "unknown_private";
type Shape = { role: Role; limit: number | null; directory: boolean; pending: boolean; sequence?: string };
function shape(root: z.infer<typeof roleSchema>, p: string): Shape {
  const is = (pattern: string) => new RegExp(`^(?:${pattern})$`).test(p);
  const out = (role: Role, limit: number | null, directory = false, pending = false): Shape => ({ role, limit, directory, pending });
  if (root === "fixture") {
    if (p === "store" || p === "admission-witness") return out("directory", null, true);
    if (p === ".native-bar-fs-synthetic" || p === ".native-bar-admission-synthetic") return out("control", 4096);
    return out("unknown_private", null);
  }
  if (root === "witness") {
    if (is(`${S}\\.json`)) return { ...out("witness_record", 16384), sequence: p.slice(0, -5) };
    return out("unknown_private", null);
  }
  if (p === "policy.json") return out("control", 4096);
  if (is(`producer/${U}/${S}\\.json`)) return { ...out("producer_mirror", 8192), sequence: p.split("/")[2].slice(0, -5) };
  if (is(`producer|producer/${U}|captures|receipts|(?:captures|receipts)/${D}|maintenance|maintenance-hold|maintenance-hold/${U}|quarantine|quarantine/abandoned|quarantine/abandoned/${U}`))
    return out("directory", null, true);
  if (is(`captures/${D}/${U}\\.json|maintenance-hold/${U}/${U}|quarantine/abandoned/${U}/${U}`)) return out("payload", L.payload_bytes);
  if (is(`receipts/${D}/${U}\\.json`)) return out("receipt", L.receipt_bytes);
  if (is(`\\.producer-${U}\\.tmp`)) return out("pending", L.payload_bytes, false, true);
  // E-A declares 9 + 14*n maintenance slots for at most two targets, each with three temporary names.
  if (is(`\\.ea-${U}-(?:[1-9]|[12][0-9]|3[0-7])-[1-3]\\.tmp`)) return out("pending", L.record_bytes, false, true);
  if (is(`maintenance/${U}(?:\\.done)?\\.json|maintenance/${U}\\.(?:manifest|attempts)/${U}\\.json|maintenance/${U}\\.events/(?:[1-9]|1[0-9]|2[0-8])\\.json|quarantine/abandoned/${U}/${U}\\.timestamp\\.json`))
    return out("maintenance_metadata", L.record_bytes);
  if (is(`maintenance/${U}\\.(?:manifest|attempts|events)`)) return out("directory", null, true);
  if (is(`\\.writer\\.(?:lock|takeover)|\\.writer-(?:claim|ticket)-${U}\\.json|\\.writer-retired-${U}\\.lock`)) return out("coordination", L.record_bytes);
  if (is(`\\.quarantine-reserve-${U}\\.tmp`)) return out("reserve", null);
  // Legacy v1/v5/R-D private names (retention, v5 stages, R-D publication temporaries) never belong in a v6 store.
  if (/^(?:producer|maintenance|maintenance-hold|operations|quarantine)(?:\/|$)|^\.(?:ea-|producer-|writer|quarantine-reserve-|publication-)|^retention\.json$|^(?:captures|receipts)\/.*\.stage$/.test(p))
    return out("unknown_private", null);
  return out("ordinary_side", null);
}
export function classifySyntheticAdmissionReadEntry(input: unknown) {
  const e = parse(entrySchema, input), s = shape(e.root_role, e.path), folded = e.path.normalize("NFC").toLowerCase();
  const alias = folded !== e.path && shape(e.root_role, folded).role !== "ordinary_side";
  const parts = e.path.split("/"), parentBlock = parts.slice(0, -1).some((_, i) => {
    const path = parts.slice(0, i + 1).join("/"), parent = shape(e.root_role, path), lower = path.normalize("NFC").toLowerCase();
    return parent.role !== "ordinary_side" && !parent.directory || path !== lower && shape(e.root_role, lower).role !== "ordinary_side";
  });
  const directory = s.directory || s.role === "ordinary_side" && e.kind === "directory";
  const unicode = /[^\x20-\x7e]/.test(e.path), expectedKind = directory ? "directory" : "file";
  // Control bytes never qualify anywhere; the native classifier blocks them too, rather than deferring a decision.
  const namespace_status = alias || parentBlock || /[\x00-\x1f\x7f]/.test(e.path) || s.role === "unknown_private" || s.role !== "ordinary_side" && e.kind !== expectedKind
    ? "blocked" as const : unicode ? "needs_native_name_check" as const : s.role === "ordinary_side" ? "ordinary_side" as const : "recognized" as const;
  const blocker = namespace_status === "blocked" ? "namespace" : unicode ? "native_name_check_required"
    : e.access !== "supplied_safe" ? "access_unverified" : e.kind !== expectedKind ? "nonregular"
    : s.limit !== null && BigInt(e.size) > BigInt(s.limit) ? "oversize" : null;
  return { ...noAuthority, schema: "native-bar-admission-read-classification-v1" as const, role: s.role, namespace_status,
    sequence: s.sequence ?? null, pending: s.pending, native_names_verified: false as const, reservation_verified: false as const,
    raw_byte_limit: s.limit === null ? null : String(s.limit), blocker, directory_candidate: blocker === null && directory,
    raw_read_candidate: blocker === null && !s.directory && !s.pending && s.limit !== null };
}
export function checkSyntheticAdmissionReadNames(input: unknown) {
  // A full inventory of 512 entries with 512-byte paths must fit, so this input is not held to one record's 64 KiB.
  const names = parse(z.array(entrySchema.pick({ root_role: true, path: true })).max(L.entries), input, L.entries * 1024);
  const seen = new Set<string>(), exact = new Map<string, string>();
  for (const n of names) {
    if (/[^\x20-\x7e]/.test(n.path)) throw new Error("b2a_native_name_check_required");
    const key = canonical([n.root_role, n.path.toLowerCase()]);
    if (seen.has(key)) throw new Error("b2a_name_collision"); seen.add(key);
    // Implied parent folders collide too: "A" and "a/x" name one folder in two spellings, even when "a" is not listed.
    const parts = n.path.split("/");
    for (let i = 1; i <= parts.length; ++i) {
      const prefix = parts.slice(0, i).join("/"), folded = canonical([n.root_role, prefix.toLowerCase()]), known = exact.get(folded);
      if (known !== undefined && known !== prefix) throw new Error("b2a_name_collision"); exact.set(folded, prefix);
    }
  }
  return { ...noAuthority, supplied_ascii_names_distinct: true as const, native_names_verified: false as const };
}

const ceilings = Object.freeze({ entries: L.entries, inventory_bytes: L.inventory_bytes, metadata_bytes: L.metadata_bytes,
  read_bytes: L.read_bytes, response_bytes: L.response_bytes });
const lowerLimitsSchema = z.strictObject({ entries: z.number().int().min(1).max(ceilings.entries).optional(),
  inventory_bytes: z.number().int().min(1).max(ceilings.inventory_bytes).optional(), metadata_bytes: z.number().int().min(1).max(ceilings.metadata_bytes).optional(),
  read_bytes: z.number().int().min(1).max(ceilings.read_bytes).optional(), response_bytes: z.number().int().min(1).max(ceilings.response_bytes).optional() });
function readLimits(input: unknown) { return input === undefined ? { ...ceilings } : { ...ceilings, ...parse(lowerLimitsSchema, input) }; }
export const validateSyntheticAdmissionReadLimits = (input?: unknown) => readLimits(input);
const occupied = z.strictObject({ entries: uint, inventory_bytes: uint, metadata_bytes: uint });
const count = z.string().regex(/^[1-9][0-9]{0,29}$/);
const budgetSchema = z.strictObject({ registration: nativeBarAdmissionReadRegistrationSchema, limits: lowerLimitsSchema.optional(),
  inventory: z.strictObject({ data: occupied, witness: occupied, common: occupied }), retained_metadata_bytes: uint,
  // cap_bytes is the native role cap of a content read (witness 16 KiB, mirror 8 KiB, payload 1 MiB, ...); the native
  // response check reserves four times that cap per read whatever the actual size, so a missing cap means 1 MiB.
  read_work: z.array(z.strictObject({ kind: z.enum(["content", "directory", "acl", "metadata"]), bytes: uint, count,
    cap_bytes: z.enum(["4096", "8192", "16384", "65536", "1048576"]).optional() })).max(L.entries),
  response: z.strictObject({ supplied_bytes: uint, buffer_bytes: uint }),
  resources: z.strictObject({ live_roots: uint, live_targets: uint, live_fds: uint }) });
/** Model of supplied counters only. It neither observes nor reserves a native resource. */
export function calculateSyntheticAdmissionReadBudget(input: unknown) {
  // The request carries a whole registration (itself capped at 64 KiB) plus counters, so it gets its own larger cap.
  const q = parse(budgetSchema, input, 256 * 1024), r = validateSyntheticAdmissionReadRegistration(q.registration), limits = readLimits(q.limits);
  const max = (a: bigint, b: bigint) => a > b ? a : b;
  const registrationBytes = BigInt(bytes(r) + 44), policyBytes = BigInt(bytes(NATIVE_BAR_ADMISSION_PROFILE));
  const markers = BigInt(r.bindings.markers.base.size) + BigInt(r.bindings.markers.admission.size);
  const commonEntries = BigInt(r.bindings.ancestors.length + 5);
  const data = q.inventory.data, witness = q.inventory.witness, common = q.inventory.common;
  const work = q.read_work.reduce((sum, w) => sum + BigInt(w.bytes) * BigInt(w.count), 0n);
  const reads = q.read_work.filter((w) => w.kind === "content");
  const contentObjects = reads.reduce((n, w) => n + BigInt(w.count), 0n), content = reads.reduce((n, w) => n + BigInt(w.bytes) * BigInt(w.count), 0n);
  if (reads.some((w) => BigInt(w.bytes) > BigInt(w.cap_bytes ?? "1048576"))) throw new Error("b2a_invalid_input");
  const largestCap = reads.reduce((n, w) => max(n, BigInt(w.cap_bytes ?? "1048576")), 0n);
  const entries = max(BigInt(data.entries), 1n) + BigInt(witness.entries) + max(BigInt(common.entries), commonEntries);
  // Per entry: bounded proofs/classification/Buffer headers plus worst-case escaping of a 512-byte path.
  // Retain baseline, recheck and read-set frames; the bounded ACL serialization scratch is separate.
  const inventoryFrame = 16384n + entries * (2048n + 6n * 512n);
  const used = {
    entries,
    inventory_bytes: max(BigInt(data.inventory_bytes), policyBytes) + BigInt(witness.inventory_bytes) + max(BigInt(common.inventory_bytes), markers),
    metadata_bytes: registrationBytes + 3n * inventoryFrame + BigInt(L.record_bytes) + BigInt(q.retained_metadata_bytes) + max(BigInt(data.metadata_bytes), policyBytes)
      + BigInt(witness.metadata_bytes) + max(BigInt(common.metadata_bytes), markers),
    // Mandatory protocol work, whatever the caller supplies. Each distinct content read is read three times (before/after
    // the bytes and after the response) and rehashed once in final verification, each pass with up to 64 KiB of guard,
    // control and parent rechecks. Four joint inventory passes (two initial, two around verification) observe every
    // entry's name, metadata and ACL: 4.5 KiB per entry covers the 1 KiB stat, up to three empty-ACL reads (a directory's
    // own ACL and its scan's start/end checks) and the directory record; deny-only ACL text beyond that is supplied as acl
    // work. Controls are reread at open, in every inventory pass, at final verification and
    // around every content pass. Other supplied work (directory/ACL/metadata beyond these) is added as given.
    // Fixed overhead per joint pass and at open: guards before and after, control rereads with their ACL charges and every
    // ancestor/root ACL observation, at 12 KiB per pinned chain element (ancestors plus parent, roots and controls).
    read_bytes: work - content + 4n * content + 4n * contentObjects * 65536n + 4n * entries * 4608n
      + (markers + policyBytes) * (6n + 4n * contentObjects) + 5n * (BigInt(r.bindings.ancestors.length) + 4n) * 12288n,
    response_bytes: max(BigInt(q.response.supplied_bytes), inventoryFrame + registrationBytes + 4n * max(BigInt(q.response.buffer_bytes), largestCap)),
  };
  const blockers: string[] = [];
  for (const key of Object.keys(ceilings) as (keyof typeof ceilings)[]) if (used[key] > BigInt(limits[key]!)) blockers.push(`${key}_limit`);
  if (BigInt(q.resources.live_roots) + 2n > BigInt(L.roots)) blockers.push("root_lease_limit");
  if (BigInt(q.resources.live_targets) > 32n) blockers.push("live_target_limit");
  if (BigInt(q.resources.live_fds) + 48n > 512n) blockers.push("descriptor_headroom_limit");
  const result = { ...noAuthority, schema: "native-bar-admission-read-budget-v1" as const, model_fits: !blockers.length,
    capacity_verified: false as const, native_budget_enforced: false as const, blockers,
    used: Object.fromEntries(Object.entries(used).map(([k, v]) => [k, String(v)])),
    remaining: Object.fromEntries((Object.keys(ceilings) as (keyof typeof ceilings)[]).map((k) => [k, String(max(0n, BigInt(limits[k]!) - used[k]))])),
    two_root_slots_required: 2 as const, descriptor_headroom_required: 48 as const };
  if (bytes(result) > L.response_bytes) throw new Error("b2a_response_bytes"); return result;
}
