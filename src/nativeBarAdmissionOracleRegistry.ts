import { type KeyObject } from "node:crypto";
import { pid } from "node:process";
import { z } from "zod";
import { createSyntheticNativeBarAdmissionVerifier } from "./nativeBarAdmissionVerification.js";
import { checkpointProbeNoAuthority, checkpointProbeRefuse, checkpointProbeBytes, checkpointProbeParse, checkpointProbeId, checkpointProbeRequestSchema, validateCheckpointOracleBinding } from "./nativeBarAdmissionCheckpointContracts.js";

type Binding = ReturnType<typeof validateCheckpointOracleBinding>;
type Lease = { bytes: bigint; cap: bigint; released: boolean; revoke: () => void; id?: string; challenge?: string };
type Operation = { promise: Promise<Uint8Array>; settled: boolean; retired: boolean; reject: (e: Error) => void };
const modes = ["unavailable", "unsigned", "unsigned_decorated", "unsigned_shared", "unsigned_oversize", "pending_ack", "pending_no_ack"] as const;
type Mode = typeof modes[number];
type Entry = { binding: Binding; ownerPid: number; closed: boolean; ownerUsed: boolean; readerUsed: boolean; ready: boolean; generation: number;
  mode?: Mode; active?: Lease; pending?: Operation; verifier: ReturnType<typeof createSyntheticNativeBarAdmissionVerifier> };
const readers = new WeakMap<object, Entry>(), owners = new WeakMap<object, Entry>(), aliases = new Set<string>();
const issuedIds = new Set<string>(), roleIds = new Set<string>();
const activeLeases = new Set<Lease>();
let retainedBytes = 65536n, workspaceBytes = 0n;
const opaque = () => Object.freeze(Object.create(null) as object);
function live(e: Entry) { if (e.closed || e.ownerPid !== pid) checkpointProbeRefuse("oracle_unavailable"); }
function reserve(bytes: bigint, ceiling = 16777216n) {
  for (const lease of activeLeases) if (lease.cap < ceiling) ceiling = lease.cap;
  if (retainedBytes + workspaceBytes + bytes > ceiling) checkpointProbeRefuse("state_budget");
}
function revoke(e: Entry) { e.closed = true; e.ready = false; e.generation++; e.active?.revoke(); }

export function createSyntheticCheckpointOracleBootstrap(input: unknown, publicKey: KeyObject) {
  const binding = validateCheckpointOracleBinding(input), r = binding.registration;
  let verifier: ReturnType<typeof createSyntheticNativeBarAdmissionVerifier>;
  try { verifier = createSyntheticNativeBarAdmissionVerifier(r.pins, publicKey); } catch { checkpointProbeRefuse("public_key"); }
  const keys = [`fixture:${r.pins.fixture_id}`, `epoch:${r.pins.store_id}:${r.pins.epoch_id}`, `roots:${r.bindings.data.device}:${r.bindings.data.inode}:${r.bindings.witness.device}:${r.bindings.witness.inode}`];
  if (keys.some((k) => aliases.has(k))) checkpointProbeRefuse("duplicate_enrollment");
  const charge = BigInt(checkpointProbeBytes(binding) + 44 + 3 * 4096);
  if ([...Object.values(r.pins), r.authority_reference].some((id) => issuedIds.has(id))) checkpointProbeRefuse("identity_reuse");
  reserve(charge); retainedBytes += charge;
  for (const key of keys) aliases.add(key);
  for (const id of [...Object.values(r.pins), r.authority_reference]) if (checkpointProbeId.safeParse(id).success) roleIds.add(id);
  const entry: Entry = { binding, ownerPid: pid, closed: false, ownerUsed: false, readerUsed: false, ready: false, generation: 0, verifier }, readerEnrollment = opaque(), ownerEnrollment = opaque();
  readers.set(readerEnrollment, entry); owners.set(ownerEnrollment, entry);
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

/** Internal bridge for the disconnected timed probe only. */
export function claimSyntheticCheckpointProbe(reader: object) {
  const e = readers.get(reader); if (!e) checkpointProbeRefuse("reader_grant_required"); live(e);
  if (!e.ready) checkpointProbeRefuse("oracle_unavailable"); if (e.readerUsed) checkpointProbeRefuse("reader_grant_consumed"); e.readerUsed = true;
  const generation = e.generation;
  return Object.freeze({ binding: structuredClone(e.binding), verifier: e.verifier,
    check() { live(e); if (!e.ready || e.generation !== generation) checkpointProbeRefuse("oracle_unavailable"); },
    accounting() { return { retained: retainedBytes, workspace: workspaceBytes }; },
    acquire(bytes: bigint, cap: bigint, onRevoke: () => void) {
      live(e); if (e.active) checkpointProbeRefuse("query_already_active"); reserve(bytes, cap); workspaceBytes += bytes;
      const lease: Lease = { bytes, cap, released: false, revoke: onRevoke }; e.active = lease; activeLeases.add(lease);
      return Object.freeze({ release() {
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
        || wire.registration_hash !== e.binding.registration_hash || wire.authority_reference !== e.binding.registration.authority_reference)
        checkpointProbeRefuse("request_binding");
      for (const key of ["fixture_id", "store_id", "epoch_id", "authority_id", "key_id", "enrollment_hash"] as const)
        if (wire[key] !== e.binding.registration.pins[key]) checkpointProbeRefuse("request_binding");
      let resolve!: (bytes: Uint8Array) => void, reject!: (e: Error) => void;
      const promise = new Promise<Uint8Array>((yes, no) => { resolve = yes; reject = no; });
      const op: Operation = { promise, settled: false, retired: false, reject }; e.pending = op;
      if (e.mode?.startsWith("unsigned")) {
        let bytes: Uint8Array = Buffer.from('{"unsigned":true}');
        if (e.mode === "unsigned_decorated") Object.defineProperty(bytes, "invented_decoration", { value: true });
        if (e.mode === "unsigned_shared") bytes = new Uint8Array(new SharedArrayBuffer(16));
        if (e.mode === "unsigned_oversize") bytes = Buffer.alloc(4097);
        op.settled = true; resolve(bytes);
      }
      else if (e.mode === "unavailable") { op.settled = true; reject(new Error("b3ba_oracle_unavailable")); }
      return Object.freeze({ promise, cancel() {
        if (!op.settled && e.mode !== "pending_no_ack") { op.settled = true; reject(new Error("b3ba_oracle_cancelled")); }
      }, retire() { if (op.settled && e.ownerPid === pid) { op.retired = true; if (e.pending === op) e.pending = undefined; } },
      retired() { return op.retired; } });
    },
    close() { revoke(e); },
  });
}
