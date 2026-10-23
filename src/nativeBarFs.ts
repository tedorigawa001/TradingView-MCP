import { createRequire } from "node:module";

type NativeBackend = {
  info(): { protocol: number; mode: string; read_protocol?: number };
  openRoot(root: string, ttlMs: number): unknown;
  closeRoot(handle: unknown): void;
  inspect(handle: unknown, area: string, day: string, name: string): unknown;
  status(target: unknown): SyntheticTargetStatus;
  stage(target: unknown, hook: SyntheticHook | undefined): SyntheticTargetStatus;
  purge(target: unknown, hook: SyntheticHook | undefined): SyntheticTargetStatus;
  openReadRoot(root: string, ttlMs: number): unknown;
  inventory(handle: unknown, hook: SyntheticReadHook | undefined, limits: SyntheticReadLimits | undefined): { report: SyntheticNativeInventory };
  readEvidence(handle: unknown, inventory: unknown, index: number, hook: SyntheticReadHook | undefined): {
    bytes: Buffer; proof: SyntheticReadProof & { sha256: string }; execution_available: false; lease_read_bytes: string };
  verifyInventory(handle: unknown, inventory: unknown, hook: SyntheticReadHook | undefined): boolean;
  closeInventory(handle: unknown, inventory: unknown): void;
};

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
