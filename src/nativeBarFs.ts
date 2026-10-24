import { createRequire } from "node:module";

type NativeBackend = {
  info(): { protocol: number; mode: string; read_protocol?: number; coordination_protocol?: number; quarantine_protocol?: number; recovery_read_protocol?: number; recovery_protocol?: number };
  openRecoveryCoordination(root: string, ttlMs: number): unknown;
  recoveryWindow(handle: unknown): { opened_at: string; expires_at: string };
  prepareRecovery(handle: unknown, original: Buffer, bundle: Buffer, audit: Buffer): unknown;
  recoveryCall(handle: unknown, action: string, approval: unknown, hook?: SyntheticReadHook): unknown;
  prepareQuarantine(coordination: unknown, indices: number[]): unknown;
  quarantineCall(handle: unknown, action: string, index: number | undefined, bytes: Buffer | undefined, hook: SyntheticReadHook | undefined): unknown;
  openCoordination(root: string, ttlMs: number): unknown;
  coordinationCall(handle: unknown, action: string, name: string | undefined, body: string | undefined): unknown;
  openRoot(root: string, ttlMs: number): unknown;
  closeRoot(handle: unknown): void;
  inspect(handle: unknown, area: string, day: string, name: string): unknown;
  status(target: unknown): SyntheticTargetStatus;
  stage(target: unknown, hook: SyntheticHook | undefined): SyntheticTargetStatus;
  purge(target: unknown, hook: SyntheticHook | undefined): SyntheticTargetStatus;
  openReadRoot(root: string, ttlMs: number): unknown;
  openRecoveryReadRoot(root: string, ttlMs: number): unknown;
  inventory(handle: unknown, hook: SyntheticReadHook | undefined, limits: SyntheticReadLimits | undefined): { report: SyntheticNativeInventory };
  readEvidence(handle: unknown, inventory: unknown, index: number, hook: SyntheticReadHook | undefined): {
    bytes: Buffer; proof: SyntheticReadProof & { sha256: string }; execution_available: false; lease_read_bytes: string };
  verifyInventory(handle: unknown, inventory: unknown, hook: SyntheticReadHook | undefined): boolean;
  closeInventory(handle: unknown, inventory: unknown): void;
};
const coordinationBindings = new WeakMap<object, { native: NativeBackend; handle: unknown }>();

export type SyntheticTargetStatus = {
  state: "previewed" | "preparing" | "staging" | "held_verified" | "conflict" | "durability_unknown" | "purged";
  moved: boolean;
  holding: string;
  proof: { device: string; inode: string; size: string; sha256: string;
    uid: string; gid: string; mode: string; nlink: string; mtime_ns: string; ctime_ns: string };
};
type SyntheticHook = (phase: string, status: SyntheticTargetStatus) => void;

function backend(): NativeBackend | null {
  if (process.platform !== "darwin") return null;
  try {
    const value = createRequire(import.meta.url)("./native-bar-fs/native_bar_fs.node") as NativeBackend;
    const info = value.info();
    return info.protocol === 1 && info.mode === "synthetic_only" ? value : null;
  } catch { return null; }
}

/** Optional, disconnected from the MCP server. Never compiles or downloads a backend. */
export function nativeBarFsAvailability() {
  return { available: backend() !== null, mode: "synthetic_only" as const, production_enabled: false as const };
}

export function openSyntheticNativeBarFs(root: string, ttlMs = 600000) {
  const native = backend();
  if (!native) throw new Error("native_bar_fs_unavailable: no pathname-based fallback");
  const handle = native.openRoot(root, ttlMs);
  return {
    close: () => native.closeRoot(handle),
    inspect(area: "captures" | "receipts", day: string, name: string) {
      const target = native.inspect(handle, area, day, name);
      return {
        status: () => native.status(target),
        stage: (hook?: SyntheticHook) => native.stage(target, hook),
        purge: (hook?: SyntheticHook) => native.purge(target, hook),
      };
    },
  };
}

export type SyntheticReadProof = { device: string; inode: string; uid: string; gid: string; mode: string;
  nlink: string; size: string; flags: string; birthtime_ns: string; mtime_ns: string; ctime_ns: string;
  acl: "none" | "deny_only" | "unsafe" | "unverified" };
export type SyntheticNativeInventory = { schema: "native-bar-native-inventory-v2"; execution_available: false;
  verification_scope: "synthetic_native_read_only"; inventory_complete: true; namespace_qualified: boolean;
  elapsed_clock_qualified: false; root: SyntheticReadProof; inventory_bytes: string; metadata_bytes: string;
  volume: { filesystem: "apfs"; local: true; ownership_enforced: true; case_preserving: true;
    case_sensitive: boolean; read_only_mount: boolean };
  entries: { path: string; kind: "file" | "directory" | "symlink" | "nonregular"; proof: SyntheticReadProof;
    readable_evidence: boolean; namespace_qualified: boolean; reason: string }[] };
export type SyntheticReadHook = (phase: string, path: string) => void;
export type SyntheticReadLimits = Partial<Record<"entries" | "inventory_bytes" | "read_bytes" | "metadata_bytes" | "response_bytes", number>>;

/** Synthetic-only read lease. Does not initialize a store or expose mutation targets. */
export function openSyntheticNativeBarReader(root: string, ttlMs = 600000) {
  const native = backend();
  if (!native || native.info().read_protocol !== 2) throw new Error("native_bar_read_unavailable: no filesystem fallback");
  const handle = native.openReadRoot(root, ttlMs);
  return {
    close: () => native.closeRoot(handle),
    inventory(options?: { hook?: SyntheticReadHook; limits?: SyntheticReadLimits }) {
      const started_at = new Date().toISOString();
      const snapshot = native.inventory(handle, options?.hook, options?.limits);
      return { report: snapshot.report, collection_started_at: started_at, collection_completed_at: new Date().toISOString(),
        readEvidence: (index: number, hook?: SyntheticReadHook) => native.readEvidence(handle, snapshot, index, hook),
        verify: (hook?: SyntheticReadHook) => ({ matches: native.verifyInventory(handle, snapshot, hook), execution_available: false as const }),
        close: () => native.closeInventory(handle, snapshot),
      };
    },
  };
}

export type SyntheticRecoveryProof = SyntheticReadProof & { acl_hash: string; allocated_bytes: string };
export type SyntheticRecoveryInventory = Omit<SyntheticNativeInventory, "schema" | "root" | "entries"> & {
  schema: "native-bar-native-recovery-inventory-v5"; root: SyntheticRecoveryProof; ancestors: SyntheticRecoveryProof[];
  available_bytes: string; lease_read_bytes: string; live_fds: string; live_sessions: string;
  entries: (Omit<SyntheticNativeInventory["entries"][number], "proof"> & { proof: SyntheticRecoveryProof })[];
};
/** V5 fixture-only read profile. No coordination, allocation or mutation handles are exposed. */
export function openSyntheticNativeBarRecoveryReader(root: string, ttlMs = 600000) {
  const native = backend();
  if (!native || native.info().recovery_read_protocol !== 5) throw new Error("native_bar_recovery_read_unavailable: no filesystem fallback");
  const handle = native.openRecoveryReadRoot(root, ttlMs);
  return {
    close: () => native.closeRoot(handle),
    inventory(options?: { hook?: SyntheticReadHook; limits?: SyntheticReadLimits }) {
      const snapshot = native.inventory(handle, options?.hook, options?.limits);
      return { report: snapshot.report as unknown as SyntheticRecoveryInventory,
        readEvidence: (index: number, hook?: SyntheticReadHook) => native.readEvidence(handle, snapshot, index, hook) as {
          bytes: Buffer; proof: SyntheticRecoveryProof & { sha256: string }; execution_available: false; lease_read_bytes: string },
        verify: (hook?: SyntheticReadHook) => ({ matches: true as const,
          report: native.verifyInventory(handle, snapshot, hook) as unknown as SyntheticRecoveryInventory, execution_available: false as const }),
        close: () => native.closeInventory(handle, snapshot),
      };
    },
  };
}

/** Fixture-only descriptor coordination adapter, never a data mutation/host approval capability. */
export function openSyntheticNativeBarCoordination(root: string, ttlMs = 600000,
  options: { ownerDead?: (body: Buffer) => Promise<boolean> } = {}) {
  return openSyntheticCoordinationProfile(root, ttlMs, options, false);
}
function openSyntheticCoordinationProfile(root: string, ttlMs: number,
  options: { ownerDead?: (body: Buffer) => Promise<boolean> }, recovery: boolean) {
  const native = backend();
  if (!native || native.info().coordination_protocol !== 3) throw new Error("native_bar_coordination_unavailable: no filesystem fallback");
  if (recovery && native.info().recovery_protocol !== 5) throw new Error("native_bar_recovery_unavailable: no filesystem fallback");
  const handle = recovery ? native.openRecoveryCoordination(root, ttlMs) : native.openCoordination(root, ttlMs);
  const call = (action: string, name?: string, body?: string) => native.coordinationCall(handle, action, name, body);
  let closeResult: { coordination_released: boolean; execution_available: false } | undefined;
  const io = {
    check: () => { call("check"); },
    preview: () => call("preview") as SyntheticNativeInventory,
    verifyBaseline: () => { call("baseline"); },
    verifyLocked: () => { call("locked"); },
    delta: () => call("delta") as { entries: { path: string; present: boolean; proof: SyntheticReadProof & { sha256: string } }[];
      retired_count: string; retired_paths: string[]; unresolved_temporaries: string; temporary_paths: string[]; uncertain: boolean },
    async names() { return call("names") as string[]; },
    read,
    async publish(name: string, body: string): Promise<"created" | "exists"> {
      return call("publish", name, body) ? "created" : "exists";
    },
    removeOwn: (name: string, body: string, absentOk?: boolean) => call(absentOk ? "release_or_absent" : "release", name, body) as boolean,
    async retireDead(name: ".writer.lock" | ".writer.takeover") {
      // The native primitive is not a liveness oracle: retire only on a verdict reached in this call about the exact
      // body just read, which the native side then compares with the object it moves.
      if (!options.ownerDead) throw new Error("retirement_requires_liveness_judge");
      const body = await read(name);
      if (!body || !(await options.ownerDead(body))) throw new Error("retirement_owner_not_proven_dead");
      return call("retire", name) as boolean;
    },
    close() {
      if (closeResult) return closeResult;
      let released = false;
      try { released = call("cleanup") as boolean; }
      finally { call("close"); closeResult = { coordination_released: released, execution_available: false }; }
      return closeResult;
    },
  };
  coordinationBindings.set(io, { native, handle });
  return io;
  async function read(name: string) {
    for (let attempt = 0; ; ++attempt) {
      try { const value = call("read", name) as string | null; return value === null ? null : Buffer.from(value); }
      catch (e) {
        // Old immutable publication briefly has two links; ordinary release may retire a name mid-read.
        // Never accept that observation. Retry a bounded fresh native read, without resetting the lease.
        if (attempt >= 9 || !(e instanceof Error) || !/^(?:open_failed:2|namespace_changed(?::2)?|target_changed|artifact_read_changed|writer_read_changed|hard_link_refused)$/.test(e.message)) throw e;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }
}

/** Internal R-C fixture bridge. No paths, phases or metadata bytes can be supplied to a step. */
export function openSyntheticNativeBarRecoveryIo(root: string) {
  const coordination = openSyntheticCoordinationProfile(root, 600000, {}, true), binding = coordinationBindings.get(coordination)!;
  let handle: unknown;
  const call = (action: string, approval?: unknown, hook?: SyntheticReadHook) => {
    if (!handle) throw new Error("recovery_plan_required"); return binding.native.recoveryCall(handle, action, approval, hook);
  };
  return { coordination, window: () => binding.native.recoveryWindow(binding.handle),
    prepare(original: Buffer, bundle: Buffer, audit: Buffer) {
      if (handle) throw new Error("recovery_plan_already_issued");
      handle = binding.native.prepareRecovery(binding.handle, original, bundle, audit); return call("report");
    },
    approve: () => call("approve"), consume: (approval: unknown) => { call("consume", approval); },
    begin: () => { call("begin"); }, step: (hook?: SyntheticReadHook) => call("step", undefined, hook),
    verify: () => { call("verify"); }, report: () => call("report"),
    close() { let result; try { if (handle) call("close"); } finally { result = coordination.close(); } return result; },
  };
}

export type SyntheticQuarantinePlan = { maintenance_id: string; chunk_id: string; attempt_id: string; reserve_path: string;
  budget_bytes: string; execution_available: false; halted: boolean; published_count: string;
  targets: { target_id: string; source_path: string; holding_path: string; quarantine_path: string;
    proof: SyntheticReadProof & { sha256: string }; phase: string }[]; publications: string[]; temporary_paths: string[] };

/** Internal fixture protocol. All destinations come from the native plan, never request paths. */
export function openSyntheticNativeBarQuarantineIo(root: string, ttlMs: number,
  options: { ownerDead: (body: Buffer) => Promise<boolean> }) {
  const native = backend();
  if (!native || native.info().quarantine_protocol !== 4) throw new Error("native_bar_quarantine_unavailable: no filesystem fallback");
  const coordination = openSyntheticNativeBarCoordination(root, ttlMs, options);
  const binding = coordinationBindings.get(coordination)!;
  let handle: unknown;
  const call = (action: string, index?: number, bytes?: Buffer, hook?: SyntheticReadHook) => {
    if (!handle) throw new Error("quarantine_plan_required");
    return native.quarantineCall(handle, action, index, bytes, hook);
  };
  return { coordination,
    prepare(indices: number[]) {
      if (handle) throw new Error("quarantine_plan_already_issued");
      handle = native.prepareQuarantine(binding.handle, indices); return call("report") as SyntheticQuarantinePlan;
    },
    begin: (hook?: SyntheticReadHook) => { call("begin", undefined, undefined, hook); },
    verify: () => { call("verify"); },
    publish: (index: number, bytes: Buffer, hook?: SyntheticReadHook) => call("publish", index, bytes, hook) as SyntheticReadProof & { sha256: string },
    move: (index: number, final: boolean, hook?: SyntheticReadHook) => call(final ? "quarantine" : "stage", index, undefined, hook) as SyntheticReadProof & { sha256: string },
    report: () => call("report") as SyntheticQuarantinePlan,
    close() { let result; try { if (handle) call("close"); } finally { result = coordination.close(); } return result; },
  };
}
