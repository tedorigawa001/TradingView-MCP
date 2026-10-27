import { type KeyObject } from "node:crypto";
import { pid } from "node:process";
import { z } from "zod";
import { createSyntheticNativeBarAdmissionVerifier } from "./nativeBarAdmissionVerification.js";
import { checkpointProbeNoAuthority, checkpointProbeRefuse, checkpointProbeBytes, checkpointProbeParse, checkpointProbeId, checkpointProbeRequestSchema, validateCheckpointOracleBinding } from "./nativeBarAdmissionCheckpointContracts.js";
import { validateSyntheticAdmissionJointBinding, validateSyntheticAdmissionJointWorkEnvelope } from "./nativeBarAdmissionJointReadContracts.js";

type Binding = ReturnType<typeof validateCheckpointOracleBinding>;
type Lease = { bytes: bigint; cap: bigint; released: boolean; ownerGeneration: bigint; requests: number; revoke: (reason: "oracle_unavailable" | "oracle_changed") => void; id?: string; challenge?: string };
type Operation = { promise: Promise<Uint8Array>; settled: boolean; retired: boolean; cancelRequested: boolean; reject: (e: Error) => void; resolve: (bytes: Uint8Array) => void };
type OwnerPacket = { token: object; request: z.infer<typeof checkpointProbeRequestSchema>; operation: Operation };
type OwnerMailbox = { queued?: OwnerPacket; inflight?: OwnerPacket; waiter?: (packet: Omit<OwnerPacket, "operation"> | null) => void };
const modes = ["unavailable", "unsigned", "unsigned_decorated", "unsigned_shared", "unsigned_oversize", "pending_ack", "pending_no_ack"] as const;
type Mode = typeof modes[number];
type Entry = { binding: Binding; ownerPid: number; closed: boolean; ownerUsed: boolean; readerUsed: boolean; ready: boolean; generation: number; ownerGeneration: bigint;
  recordRoles?: Set<string>; mode?: Mode; active?: Lease; pending?: Operation; mailbox?: OwnerMailbox; verifier: ReturnType<typeof createSyntheticNativeBarAdmissionVerifier> };
const readers = new WeakMap<object, Entry>(), owners = new WeakMap<object, Entry>(), aliases = new Set<string>();
const jointReaders = new WeakMap<object, Entry>();
const issuedIds = new Set<string>(), roleIds = new Set<string>();
const observedRecordIds = new Set<string>();
const activeLeases = new Set<Lease>();
let retainedBytes = 65536n, workspaceBytes = 0n;
const opaque = () => Object.freeze(Object.create(null) as object);
function live(e: Entry) { if (e.closed || e.ownerPid !== pid) checkpointProbeRefuse("oracle_unavailable"); }
function reserve(bytes: bigint, ceiling = 16777216n) {
  for (const lease of activeLeases) if (lease.cap < ceiling) ceiling = lease.cap;
  if (retainedBytes + workspaceBytes + bytes > ceiling) checkpointProbeRefuse("state_budget");
}
function deliverOwnerPacket(e: Entry) {
  const m = e.mailbox; if (!m?.waiter) return;
  if (m.queued) {
    const packet = m.queued, waiter = m.waiter; m.queued = undefined; m.waiter = undefined; m.inflight = packet;
    waiter(Object.freeze({ token: packet.token, request: Object.freeze({ ...packet.request }) }));
  } else if (e.closed && !m.inflight) { const waiter = m.waiter; m.waiter = undefined; waiter(null); }
}
function revoke(e: Entry) { e.closed = true; e.ready = false; e.generation++; e.ownerGeneration++; e.active?.revoke("oracle_unavailable"); deliverOwnerPacket(e); }

export function createSyntheticCheckpointOracleBootstrap(input: unknown, publicKey: KeyObject) {
  return oracleBootstrap(validateCheckpointOracleBinding(input), publicKey, false, 0);
}
/** Separate original joint-kind enrollment; a probe grant can never be promoted. */
export function createSyntheticJointCheckpointOracleBootstrap(input: unknown, publicKey: KeyObject, workEnvelope: unknown) {
  const b = validateSyntheticAdmissionJointBinding(input), envelope = validateSyntheticAdmissionJointWorkEnvelope(workEnvelope);
  return oracleBootstrap(validateCheckpointOracleBinding({ ...b, schema: "native-bar-checkpoint-oracle-binding-v1", scope: "synthetic_checkpoint_probe_only" }),
    publicKey, true, checkpointProbeBytes(envelope));
}
function oracleBootstrap(binding: Binding, publicKey: KeyObject, joint: boolean, configurationBytes: number) {
  const r = binding.registration;
  let verifier: ReturnType<typeof createSyntheticNativeBarAdmissionVerifier>;
  try { verifier = createSyntheticNativeBarAdmissionVerifier(r.pins, publicKey); } catch { checkpointProbeRefuse("public_key"); }
  const keys = [`fixture:${r.pins.fixture_id}`, `epoch:${r.pins.store_id}:${r.pins.epoch_id}`, `roots:${r.bindings.data.device}:${r.bindings.data.inode}:${r.bindings.witness.device}:${r.bindings.witness.inode}`];
  if (keys.some((k) => aliases.has(k))) checkpointProbeRefuse("duplicate_enrollment");
  const charge = BigInt(checkpointProbeBytes(binding) + 44 + 3 * 4096 + configurationBytes);
  if ([...Object.values(r.pins), r.authority_reference].some((id) => issuedIds.has(id) || observedRecordIds.has(id))) checkpointProbeRefuse("identity_reuse");
  reserve(charge); retainedBytes += charge;
  for (const key of keys) aliases.add(key);
  for (const id of [...Object.values(r.pins), r.authority_reference]) if (checkpointProbeId.safeParse(id).success) roleIds.add(id);
  const entry: Entry = { binding, ownerPid: pid, closed: false, ownerUsed: false, readerUsed: false, ready: false, generation: 0, ownerGeneration: 0n, verifier }, readerEnrollment = opaque(), ownerEnrollment = opaque();
  (joint ? jointReaders : readers).set(readerEnrollment, entry); owners.set(ownerEnrollment, entry);
  return Object.freeze({ readerEnrollment, ownerEnrollment,
    describe() { return { ...checkpointProbeNoAuthority, registration_hash: binding.registration_hash, revoked: entry.closed || entry.ownerPid !== pid,
      retained_state_bytes: String(retainedBytes), active_workspace_bytes: String(workspaceBytes) }; }, close() { if (!entry.closed) revoke(entry); } });
}

/** Internal, fixed unsigned test-harness entry. No callback, response bytes, key, time or signer is accepted. */
export function enrollUnsignedCheckpointOracleForHarness(owner: object, input: unknown) {
  const e = owners.get(owner); if (!e) checkpointProbeRefuse("owner_grant_required"); live(e);
  if (e.ownerUsed) checkpointProbeRefuse("owner_grant_consumed"); e.ownerUsed = true;
  try {
    const q = checkpointProbeParse(z.strictObject({ schema: z.literal("native-bar-unsigned-checkpoint-oracle-v1"), mode: z.enum(modes) }), input);
    e.mode = q.mode; e.ready = true; e.generation++;
  } catch (error) { revoke(e); throw error; }
  return Object.freeze({ close() { if (!e.closed) revoke(e); }, settlePending() {
    if (e.ownerPid !== pid) checkpointProbeRefuse("oracle_unavailable");
    const op = e.pending; if (op && !op.settled) { op.settled = true; op.reject(new Error("b3ba_oracle_rejected")); }
  } });
}

/** Internal original-owner mailbox. Only the fixed memory oracle test helper may consume it. No signer callback is registered. */
export function claimFixedMemoryCheckpointOracleOwner(owner: object) {
  const e = owners.get(owner); if (!e) checkpointProbeRefuse("owner_grant_required"); live(e);
  if (e.ownerUsed) checkpointProbeRefuse("owner_grant_consumed"); e.ownerUsed = true;
  try { reserve(65536n); retainedBytes += 65536n; e.mailbox = {}; }
  catch (error) { revoke(e); throw error; }
  const m = e.mailbox;
  function original(token: object) {
    if (e!.ownerPid !== pid) checkpointProbeRefuse("oracle_unavailable");
    const packet = m.inflight; if (!packet || packet.token !== token || packet.operation !== e!.pending || packet.operation.settled)
      checkpointProbeRefuse("owner_operation_required"); return packet;
  }
  function settle(token: object, bytes?: Uint8Array, failure?: "oracle_unavailable" | "oracle_cancelled" | "oracle_rejected") {
    const packet = original(token), op = packet.operation; op.settled = true; m.inflight = undefined;
    if (op.cancelRequested || failure) op.reject(new Error(`b3ba_${op.cancelRequested ? "oracle_cancelled" : failure}`));
    else {
      try { op.resolve(copyOwnerResponse(bytes)); } catch { op.reject(new Error("b3ba_response_bytes")); }
    }
    deliverOwnerPacket(e!);
  }
  return Object.freeze({ fixed: structuredClone({ pins: e.binding.registration.pins, authority_reference: e.binding.registration.authority_reference,
    registration_hash: e.binding.registration_hash }),
    activate() { live(e); if (e.ready) checkpointProbeRefuse("owner_grant_consumed"); e.ready = true; e.generation++; e.ownerGeneration++; },
    changed() { live(e); if (!e.ready) checkpointProbeRefuse("oracle_unavailable"); e.ownerGeneration++; e.active?.revoke("oracle_changed"); },
    check() { live(e); if (!e.ready) checkpointProbeRefuse("oracle_unavailable"); },
    busy() { live(e); return !!e.active; },
    next(): Promise<Omit<OwnerPacket, "operation"> | null> {
      if (e.ownerPid !== pid) return Promise.reject(new Error("b3ba_oracle_unavailable"));
      if (m.waiter || m.inflight) return Promise.reject(new Error("b3ba_owner_busy"));
      return new Promise((resolve) => { m.waiter = resolve; deliverOwnerPacket(e); });
    },
    cancelled(token: object) { return original(token).operation.cancelRequested; },
    respond(token: object, bytes: Uint8Array) { settle(token, bytes); },
    reject(token: object, failure: "oracle_unavailable" | "oracle_cancelled" | "oracle_rejected") { settle(token, undefined, failure); },
    close() { if (!e.closed) revoke(e); },
  });
}

/** Internal bridge for the disconnected timed probe only. */
export function claimSyntheticCheckpointProbe(reader: object) {
  return claimReader(readers, reader);
}
/** Internal bridge allowlisted only for the joint controller. */
export function claimSyntheticJointCheckpointReader(reader: object) {
  const claim = claimReader(jointReaders, reader), e = jointReaders.get(reader)!;
  return Object.freeze({ ...claim, bindRecordIds(input: unknown, cap: bigint) {
    live(e); const active = e.active;
    if (!active || active.released || active.requests !== 1 || e.pending || active.ownerGeneration !== e.ownerGeneration) checkpointProbeRefuse("request_binding");
    const ids = checkpointProbeParse(z.array(checkpointProbeId).max(512), input);
    if (new Set(ids).size !== ids.length) checkpointProbeRefuse("identity_reuse");
    const own = new Set([...Object.values(e.binding.registration.pins), e.binding.registration.authority_reference]);
    const known = e.recordRoles ?? new Set<string>(), fresh = ids.filter((id) => !own.has(id) && !known.has(id));
    if (ids.some((id) => issuedIds.has(id) || roleIds.has(id) && !own.has(id) && !known.has(id))) checkpointProbeRefuse("identity_reuse");
    const charge = BigInt(fresh.length) * 4096n;
    if (known.size + fresh.length > 512 || active.bytes < charge) checkpointProbeRefuse("state_budget");
    reserve(0n, cap); active.bytes -= charge; workspaceBytes -= charge; retainedBytes += charge;
    for (const id of fresh) { known.add(id); roleIds.add(id); observedRecordIds.add(id); } e.recordRoles = known;
  } });
}
function claimReader(registry: WeakMap<object, Entry>, reader: object) {
  const e = registry.get(reader); if (!e) checkpointProbeRefuse("reader_grant_required"); live(e);
  if (!e.ready) checkpointProbeRefuse("oracle_unavailable"); if (e.readerUsed) checkpointProbeRefuse("reader_grant_consumed"); e.readerUsed = true;
  const generation = e.generation;
  return Object.freeze({ binding: structuredClone(e.binding), verifier: e.verifier,
    check() { live(e); if (!e.ready || e.generation !== generation) checkpointProbeRefuse("oracle_unavailable");
      if (e.active && e.active.ownerGeneration !== e.ownerGeneration) checkpointProbeRefuse("oracle_changed"); },
    accounting() { return { retained: retainedBytes, workspace: workspaceBytes }; },
    acquire(bytes: bigint, cap: bigint, onRevoke: (reason: "oracle_unavailable" | "oracle_changed") => void) {
      live(e); if (e.active) checkpointProbeRefuse("query_already_active"); reserve(bytes, cap); workspaceBytes += bytes;
      const lease: Lease = { bytes, cap, released: false, ownerGeneration: e.ownerGeneration, requests: 0, revoke: onRevoke }; e.active = lease; activeLeases.add(lease);
      return Object.freeze({ check() { live(e); if (!e.ready || e.ownerGeneration !== lease.ownerGeneration) checkpointProbeRefuse("oracle_changed"); }, release() {
        if (lease.released) return true; if (e.ownerPid !== pid) return false;
        lease.released = true; workspaceBytes -= lease.bytes; activeLeases.delete(lease); if (e.active === lease) e.active = undefined; return true;
      } });
    },
    identifier(candidate: string, cap: bigint) {
      live(e);
      if (!checkpointProbeId.safeParse(candidate).success) checkpointProbeRefuse("rng_invalid");
      if (issuedIds.has(candidate) || roleIds.has(candidate)) checkpointProbeRefuse("identity_reuse");
      const active = e.active; if (!active || active.released || active.bytes < 4096n) checkpointProbeRefuse("state_budget");
      reserve(0n, cap);
      // The whole-query plan already reserved these slots. Transfer, rather than charge them twice.
      active.bytes -= 4096n; workspaceBytes -= 4096n; retainedBytes += 4096n; issuedIds.add(candidate);
      if (!e.active?.id) { if (e.active) e.active.id = candidate; } else if (e.active) e.active.challenge = candidate;
    },
    revoked() { return e.closed || e.ownerPid !== pid || e.generation !== generation; },
    dispatch(raw: unknown) {
      live(e); if (!e.ready || e.generation !== generation) checkpointProbeRefuse("oracle_unavailable");
      const wire = checkpointProbeParse(checkpointProbeRequestSchema, raw, 1024), active = e.active;
      if (!active || active.released || e.pending || wire.query_id !== active.id || wire.challenge !== active.challenge
        || active.ownerGeneration !== e.ownerGeneration || active.requests >= 2 || wire.phase !== (active.requests === 0 ? "c0" : "c1")
        || wire.registration_hash !== e.binding.registration_hash || wire.authority_reference !== e.binding.registration.authority_reference)
        checkpointProbeRefuse("request_binding");
      for (const key of ["fixture_id", "store_id", "epoch_id", "authority_id", "key_id", "enrollment_hash"] as const)
        if (wire[key] !== e.binding.registration.pins[key]) checkpointProbeRefuse("request_binding");
      let resolve!: (bytes: Uint8Array) => void, reject!: (e: Error) => void;
      const promise = new Promise<Uint8Array>((yes, no) => { resolve = yes; reject = no; });
      const op: Operation = { promise, settled: false, retired: false, cancelRequested: false, reject, resolve }; e.pending = op; active.requests++;
      if (e.mailbox) { e.mailbox.queued = { token: opaque(), request: wire, operation: op }; deliverOwnerPacket(e); }
      else if (e.mode?.startsWith("unsigned")) {
        let bytes: Uint8Array = Buffer.from('{"unsigned":true}');
        if (e.mode === "unsigned_decorated") Object.defineProperty(bytes, "invented_decoration", { value: true });
        if (e.mode === "unsigned_shared") bytes = new Uint8Array(new SharedArrayBuffer(16));
        if (e.mode === "unsigned_oversize") bytes = Buffer.alloc(4097);
        op.settled = true; resolve(bytes);
      }
      else if (e.mode === "unavailable") { op.settled = true; reject(new Error("b3ba_oracle_unavailable")); }
      return Object.freeze({ promise, cancel() {
        op.cancelRequested = true;
        if (!op.settled && e.mailbox?.queued?.operation === op) {
          // It never left this owner queue: removing the original packet is a local settlement, not an owner acknowledgement.
          e.mailbox.queued = undefined; op.settled = true; reject(new Error("b3ba_oracle_cancelled"));
        } else if (!op.settled && !e.mailbox && e.mode !== "pending_no_ack") { op.settled = true; reject(new Error("b3ba_oracle_cancelled")); }
      }, retire() { if (op.settled && e.ownerPid === pid) { op.retired = true; if (e.pending === op) e.pending = undefined; } },
      retired() { return op.retired; } });
    },
    close() { revoke(e); },
  });
}

const typedArray = Object.getPrototypeOf(Uint8Array.prototype), byteLength = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!,
  arrayBuffer = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!, ordinaryLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
function copyOwnerResponse(input: unknown) {
  const length = byteLength.call(input); ordinaryLength.call(arrayBuffer.call(input));
  if (!(input instanceof Uint8Array) || ![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(input)) || length > 4096
    || Reflect.ownKeys(input).some((k) => typeof k !== "string" || !/^(0|[1-9][0-9]*)$/.test(k))) checkpointProbeRefuse("response_bytes");
  const copy = Buffer.alloc(length); Uint8Array.prototype.set.call(copy, input); return copy;
}
