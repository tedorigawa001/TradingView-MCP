import { createRequire } from "node:module";

type NativeBackend = {
  info(): { protocol: number; mode: string };
  openRoot(root: string, ttlMs: number): unknown;
  closeRoot(handle: unknown): void;
  inspect(handle: unknown, area: string, day: string, name: string): unknown;
  status(target: unknown): SyntheticTargetStatus;
  stage(target: unknown, hook: SyntheticHook | undefined): SyntheticTargetStatus;
  purge(target: unknown, hook: SyntheticHook | undefined): SyntheticTargetStatus;
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
