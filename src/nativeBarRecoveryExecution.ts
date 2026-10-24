import { randomUUID } from "node:crypto";
import { canonical } from "./nativeBarEvidence.js";
import { planNativeBarRecovery, nativeBarRecoveryBundleSchema, validateNativeBarRecoveryBundle } from "./nativeBarRecovery.js";
import { syntheticNativeBarRecoveryExecutionOwner } from "./nativeBarRecoveryController.js";
import { openSyntheticNativeBarRecoveryIo, type SyntheticReadHook, type SyntheticRecoveryProof } from "./nativeBarFs.js";
import { takeNativeWriterLockWithIo } from "./nativeBarAccess.js";

/** R-C local fixture stepping only. No RPC registration, pathname mutation or automatic retry. */
export function createSyntheticNativeBarRecoveryExecution(ownerCapability: object) {
  const owner = syntheticNativeBarRecoveryExecutionOwner(ownerCapability);
  const mono = performance.now(), io = openSyntheticNativeBarRecoveryIo(owner.root);
  let window: ReturnType<typeof io.window>;
  try { window = io.window(); } catch (error) { io.close(); throw error; }
  let closed = false, busy = false, consumed = false, begun = false, lastWall = Date.now();
  let plan: NonNullable<ReturnType<typeof planNativeBarRecovery>["attempt_plan"]> | undefined;
  let lock: Awaited<ReturnType<typeof takeNativeWriterLockWithIo>> | undefined;
  let activeHook: SyntheticReadHook | undefined;
  let closeResult: { coordination_released: boolean; execution_available: false } | undefined;
  const approvals = new WeakMap<object, unknown>();
  const check = (native = true) => {
    owner.alive(); if (closed) throw new Error("recovery_execution_closed"); if (native) io.coordination.check();
    const now = Date.now(); if (now < lastWall || now >= Date.parse(window.expires_at) || performance.now() >= mono + 600000) throw new Error("recovery_execution_expired_or_clock_rollback");
    lastWall = now;
  };
  function close() {
    if (busy) throw new Error("recovery_execution_busy");
    if (closed) return closeResult ?? { coordination_released: false, execution_available: false as const };
    closed = true; let released = true;
    try { if (lock) { released = lock.release(); lock = undefined; } }
    finally { const cleanup = io.close(); released = released && cleanup.coordination_released; }
    return closeResult = { coordination_released: released, execution_available: false as const };
  }
  const hook: SyntheticReadHook = (phase, path) => { check(false); if (activeHook?.(phase, path) !== undefined) throw new Error("test_hook_must_be_synchronous_void"); check(false); };
  function bind(id: string, hash: string) { check(); if (!plan || id !== plan.plan_id || hash !== plan.plan_hash || consumed) throw new Error("recovery_plan_binding_or_consumed"); }
  return {
    prepare() {
      check(); if (plan) throw new Error("recovery_plan_already_issued");
      try {
        const issued = new Date().toISOString(), snapshot = owner.read(), ledger = owner.ledger(), ordinal = Math.max(...ledger.consumed_ordinals) + 1;
        if (ordinal > 3) throw new Error("recovery_exhausted");
        const r = planNativeBarRecovery({ schema: "native-bar-recovery-query-v5", bundle: snapshot.bundle, view: snapshot.view, controller: ledger,
          request: { plan_id: randomUUID(), ordinal, opened_at: window.opened_at, issued_at: issued, expires_at: window.expires_at,
            checked_at: new Date().toISOString(), checked_elapsed_ns: String(Math.floor((performance.now() - mono) * 1e6)) } });
        if (r.status !== "planned_only" || !r.attempt_plan) throw new Error(`recovery_native_prepare_blocked:${r.blocking_reasons.join(",")}`);
        const native = io.prepare(Buffer.from(canonical(owner.original)), Buffer.from(canonical(snapshot.bundle)), Buffer.from(canonical(r.attempt_plan)));
        check(); plan = structuredClone(r.attempt_plan);
        return { ...r, native, eligibility: "independently_admitted_invented_fixture_only" as const,
          host_approval_available: false, automatic_recovery: false, effects: ["writer_coordination", "fixed_native_recovery_steps", "immutable_metadata_publication", "no_reserve_reallocation", "no_data_unlink"] };
      } catch (error) { close(); throw error; }
    },
    approveForSyntheticTest(id: string, hash: string) {
      bind(id, hash); const approval = Object.freeze({}); approvals.set(approval, io.approve()); return approval;
    },
    async begin(id: string, hash: string, approval: object, options: { waitMs?: number; hook?: SyntheticReadHook } = {}) {
      bind(id, hash); if (!approvals.has(approval)) throw new Error("recovery_fixture_approval_required");
      const native = approvals.get(approval); approvals.delete(approval); consumed = true; busy = true; activeHook = options.hook;
      try {
        owner.consume(plan!.ordinal); io.consume(native); check();
        lock = await takeNativeWriterLockWithIo(io.coordination, options.waitMs ?? 1000); check(); io.begin(); begun = true;
        return { execution_available: false, recovery_execution_available: false, synthetic_fixture_begun: true };
      } catch (error) { busy = false; const cleanup = close(); throw Object.assign(error instanceof Error ? error : new Error("recovery_begin_failed"), cleanup); }
      finally { busy = false; }
    },
    step(...args: never[]) {
      if (args.length) throw new Error("recovery_no_caller_paths_phases_or_payload");
      if (busy) throw new Error("recovery_step_unavailable"); busy = true;
      try {
        check(); if (!begun) throw new Error("recovery_step_unavailable");
        const raw = io.step(hook) as { state: { finished: boolean }; bundle: unknown;
          publication: { path: string; record: unknown; proof: SyntheticRecoveryProof & { sha256: string } } | null; publication_acknowledged_at: string };
        const bundle = nativeBarRecoveryBundleSchema.parse(raw.bundle); validateNativeBarRecoveryBundle(bundle);
        if (raw.publication) owner.witnessed(raw.publication.path, raw.publication.record, raw.publication.proof);
        hook("before_response", raw.state.finished ? "completion" : "step"); io.verify(); check();
        const result = { ...raw, bundle, execution_available: false as const, recovery_execution_available: false as const,
          approval_authenticated: false as const, original_acknowledgement: "not_proven" as const, elapsed_clock_qualified: false as const,
          synthetic_effects_performed: true, plan_hash: plan!.plan_hash };
        busy = false; if (raw.state.finished) return { ...result, cleanup: close() }; return result;
      } catch (error) { busy = false; const cleanup = close(); throw Object.assign(error instanceof Error ? error : new Error("recovery_step_failed"), cleanup); }
      finally { busy = false; }
    }, close,
  };
}
