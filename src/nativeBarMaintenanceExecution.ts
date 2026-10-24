import { randomUUID } from "node:crypto";
import { evidenceHash } from "./nativeBarEvidence.js";
import { openSyntheticNativeBarCoordination } from "./nativeBarFs.js";
import { coordinationOwnerDead, takeNativeWriterLockWithIo } from "./nativeBarAccess.js";

type Kind = "quarantine_abandoned" | "purge_abandoned";
type FixtureApproval = Readonly<{ fixture_only: true }>;

/** Isolated slice C registry. Never returns a native data-mutation or host-approval capability. */
export function createSyntheticNativeBarExecutionRegistry(root: string, ttlMs = 600000) {
  const openedWall = Date.now(), openedMono = performance.now();
  const io = openSyntheticNativeBarCoordination(root, ttlMs, { ownerDead: coordinationOwnerDead });
  let baseline: ReturnType<typeof io.preview>, generation: string;
  try {
    baseline = structuredClone(io.preview());
    generation = evidenceHash(baseline);
  } catch (error) {
    try { io.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "execution_registry_initialization_cleanup_failed"); }
    throw error;
  }
  let closed = false, consumed = false, busy = false;
  let closeResult: ReturnType<typeof io.close> | undefined;
  let plan: { plan_id: string; plan_hash: string; issued_at: string; expires_at: string; kind: Kind;
    generation: string; targets: { index: number; path: string; proof: typeof baseline.root }[] } | null = null;
  const approvals = new WeakSet<object>();
  const check = () => {
    if (closed) throw new Error("execution_registry_closed");
    io.check();
    if (Date.now() < openedWall || Date.now() >= openedWall + ttlMs || performance.now() >= openedMono + ttlMs) throw new Error("execution_registry_expired");
  };
  const binding = (id: string, hash: string) => {
    check();
    if (!plan || plan.plan_id !== id || plan.plan_hash !== hash) throw new Error("execution_plan_binding");
    if (consumed) throw new Error("execution_plan_consumed");
  };
  const close = () => {
    if (busy) throw new Error("execution_registry_busy");
    if (closeResult) return closeResult;
    closed = true; return closeResult = io.close();
  };
  return {
    prepare(kind: Kind, targetIndices: number[] = []) {
      check(); if (plan) throw new Error("execution_plan_already_issued");
      if (!["quarantine_abandoned", "purge_abandoned"].includes(kind)) throw new Error("unsupported_execution_kind");
      if (!Array.isArray(targetIndices) || targetIndices.length > 1024 || new Set(targetIndices).size !== targetIndices.length) throw new Error("invalid_execution_targets");
      const targets = targetIndices.map((index) => {
        const e = Number.isSafeInteger(index) && index >= 0 ? baseline.entries[index] : undefined;
        if (!e || e.kind !== "file" || !e.readable_evidence || e.path.startsWith(".writer")) throw new Error("unverified_execution_target");
        return { index, path: e.path, proof: structuredClone(e.proof) };
      });
      io.verifyBaseline(); check();
      const contents = { plan_id: randomUUID(), issued_at: new Date().toISOString(), expires_at: new Date(openedWall + ttlMs).toISOString(),
        kind, generation, targets };
      plan = { ...contents, plan_hash: evidenceHash(contents) };
      return { ...structuredClone(plan), schema: "native-bar-synthetic-coordination-plan-v3" as const,
        execution_available: false as const, host_approval_available: false as const,
        effects: ["publish_private_writer_claim_ticket_lock", "release_exact_owned_coordination", "retire_proven_dead_lock_requires_new_preview"],
        limitations: ["coordination_only", "eligibility_profile_capacity_and_elapsed_clock_not_integrated", "no_data_mutation_grant"] };
    },
    approveForSyntheticTest(id: string, hash: string): FixtureApproval {
      binding(id, hash); const approval = Object.freeze({ fixture_only: true as const }); approvals.add(approval); return approval;
    },
    async probe(id: string, hash: string, approval: FixtureApproval, options: { waitMs?: number; onLocked?: () => Promise<void> | void } = {}) {
      binding(id, hash);
      if (!approval || !approvals.delete(approval)) throw new Error("fixture_approval_required");
      consumed = true; // Single-use before the queue wait; failure never revives this plan or approval.
      busy = true;
      let lock: Awaited<ReturnType<typeof takeNativeWriterLockWithIo>> | undefined;
      let failure: unknown, failed = false;
      let delta: ReturnType<typeof io.delta> | null = null;
      try {
        check(); io.verifyBaseline();
        lock = await takeNativeWriterLockWithIo(io, options.waitMs ?? 1000);
        check(); io.verifyLocked(); io.verifyBaseline();
        await options.onLocked?.();
        check(); io.verifyLocked(); io.verifyBaseline();
        delta = io.delta();
      } catch (e) { failure = e; failed = true; }
      const released = lock?.release() ?? true;
      try { delta = io.delta(); } catch { /* an inaccessible namespace is not a verified delta */ }
      busy = false; const cleanup = close();
      if (failed || !released || !cleanup.coordination_released) {
        const error = new Error(`${failure instanceof Error ? failure.message : failed ? "coordination_probe_failed" : "coordination_release_failed"}`
          + (!released || !cleanup.coordination_released ? "; coordination_release_unconfirmed" : ""), { cause: failure });
        throw Object.assign(error, { execution_available: false, coordination_released: released && cleanup.coordination_released, coordination_delta: delta });
      }
      return { status: "synthetic_coordination_verified" as const, plan_id: id, plan_hash: hash, generation,
        execution_available: false as const, coordination_released: true, coordination_delta: delta };
    },
    close,
  };
}
