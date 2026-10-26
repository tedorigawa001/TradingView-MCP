import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { platform } from "node:process";
import { canonical } from "./nativeBarEvidence.js";
import { claimSyntheticAdmissionNativeRead, createSyntheticAdmissionReadRegistry,
  validateSyntheticAdmissionReadLimits } from "./nativeBarAdmissionReadContracts.js";

type Handle = object;
type Facts = Record<string, unknown>;
type Backend = {
  info(): { mode: string; admission_read_protocol: number };
  beginAdmissionRead(wire: Buffer): Handle;
  openAdmissionReadPair(context: Handle): Handle;
  admissionInventory(pair: Handle, hook: undefined): { snapshot: Handle; report: Facts };
  readAdmissionEvidence(pair: Handle, snapshot: Handle, role: string, index: number, hook: undefined): { bytes: Buffer; facts: Facts };
  verifyAdmissionInventory(pair: Handle, snapshot: Handle, hook: undefined): Facts;
  closeAdmissionInventory(pair: Handle, snapshot: Handle): void;
  closeAdmissionRead(context: Handle): void;
};
type Resource = { backend?: Backend; context?: Handle; released: boolean; releaseRequested: boolean; releaseClaim?: () => void };
function releaseResource(resource: Resource) {
  if (resource.released) return;
  resource.releaseRequested = true;
  if (resource.context) {
    try { resource.backend!.closeAdmissionRead(resource.context); } catch { throw new Error("b2b_release_unconfirmed"); }
  }
  resource.context = undefined; resource.released = true; resource.releaseClaim?.();
}
const abandonedClaims = new FinalizationRegistry<Resource>((resource) => {
  // A failed release remains retained by the registry's callback for an explicit retry.
  try { releaseResource(resource); } catch { /* Never throw from a GC callback. */ }
});
function weakRelease(close: () => void, resource: Resource) {
  const ref = new WeakRef(close);
  return () => { const live = ref.deref(); if (live) live(); else releaseResource(resource); };
}

/** Explicit synthetic entry only; importing or registering never opens a fixture or loads the addon. */
export function createSyntheticAdmissionNativeReadRegistry(bootstrap: object) {
  const registry = createSyntheticAdmissionReadRegistry(bootstrap);
  return Object.freeze({ ...registry, beginRead(ticket: object, lowerLimits?: unknown, ttlMs = 600000) {
    const limits = validateSyntheticAdmissionReadLimits(lowerLimits);
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 600000) throw new Error("b2b_deadline");
    const wall = Date.now(), steady = performance.now(); let lastWall = wall;
    const resource: Resource = { released: false, releaseRequested: false };
    let backend: Backend | undefined, context: Handle | undefined;
    let claim: ReturnType<typeof claimSyntheticAdmissionNativeRead> | undefined;
    function close() {
      releaseResource(resource); context = undefined; abandonedClaims.unregister(close);
    }
    claim = claimSyntheticAdmissionNativeRead(registry, ticket, weakRelease(close, resource));
    resource.releaseClaim = claim.release; abandonedClaims.register(close, resource, close);
    function check() {
      if (resource.released || resource.releaseRequested) throw new Error("b2b_context_closed"); claim!.check();
      const now = Date.now();
      if (now < lastWall || now >= wall + ttlMs || performance.now() >= steady + ttlMs) throw new Error("b2b_deadline_or_rollback");
      lastWall = now;
    }
    function call<T>(action: () => T): T {
      try { check(); const result = action(); check(); return result; }
      catch (error) { close(); throw error; }
    }
    try {
      check(); if (platform !== "darwin") throw new Error("b2b_native_unavailable");
      try { backend = createRequire(import.meta.url)("./native-bar-fs/native_bar_fs.node") as Backend; }
      catch { throw new Error("b2b_native_unavailable"); }
      if (backend.info().mode !== "synthetic_only" || backend.info().admission_read_protocol !== 6) throw new Error("b2b_native_protocol");
      resource.backend = backend;
      check(); const remaining = Math.floor(Math.min(wall + ttlMs - Date.now(), steady + ttlMs - performance.now()));
      if (remaining < 1) throw new Error("b2b_deadline_or_rollback");
      context = backend.beginAdmissionRead(Buffer.from(canonical({ registration: claim.registration, limits, ttl_ms: remaining })));
      resource.context = context;
      check();
    } catch (error) { close(); throw error; }
    let opened = false;
    return Object.freeze({ close, openPair() {
      return call(() => {
        if (opened) throw new Error("b2b_pair_already_opened"); opened = true;
        const pair = backend!.openAdmissionReadPair(context!); let inventoried = false;
        return Object.freeze({ close, inventory() {
          return call(() => {
            if (inventoried) throw new Error("b2b_inventory_once"); inventoried = true;
            const { snapshot, report } = backend!.admissionInventory(pair, undefined); let snapshotClosed = false;
            function snapshotCheck() { if (snapshotClosed) throw new Error("b2b_snapshot_closed"); }
            return Object.freeze({ report, readEvidence(role: "data" | "witness", index: number) {
              return call(() => { snapshotCheck(); return backend!.readAdmissionEvidence(pair, snapshot, role, index, undefined); });
            }, verify() {
              return call(() => { snapshotCheck(); return backend!.verifyAdmissionInventory(pair, snapshot, undefined); });
            }, close() {
              if (snapshotClosed || resource.released) return;
              // Release is allowed after expiry/revocation, without minting another read window.
              try { backend!.closeAdmissionInventory(pair, snapshot); snapshotClosed = true; }
              catch (error) { close(); throw error; }
            } });
          });
        } });
      });
    } });
  } });
}
