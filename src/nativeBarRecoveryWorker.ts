import { inheritedRecoveryChannel } from "./nativeBarRecoveryChannel.js";
import { createSyntheticNativeBarRecoveryWorkerEngine } from "./nativeBarRecoveryExecution.js";
import type { SyntheticRecoveryExecutionOwner } from "./nativeBarRecoveryController.js";
import { syntheticNativeBarRecoveryResources } from "./nativeBarFs.js";

// No CLI/environment/store bootstrap. A single fork-owned IPC session supplies the independent controller bridge.
let initialized = false, busy = false, nonce = "", last = 0;
let engine: ReturnType<typeof createSyntheticNativeBarRecoveryWorkerEngine> | undefined;
const approvals = new Map<number, object>();
process.on("disconnect", () => { try { engine?.close(); } finally { process.exit(1); } });
process.on("message", async (raw: unknown) => {
  const m = raw as { nonce: string; id: number; operation: string; args: any[]; parent: number };
  if (busy || !m || !Number.isSafeInteger(m.id) || m.id !== last + 1 || !Array.isArray(m.args)) { process.exit(2); }
  last = m.id; busy = true;
  try {
    let value: unknown;
    if (!initialized) {
      if (!["open", "open_initial"].includes(m.operation) || m.args.length || typeof m.nonce !== "string" || !/^[0-9a-f-]{36}$/.test(m.nonce)) throw new Error("recovery_worker_bootstrap_required");
      nonce = m.nonce; const call = inheritedRecoveryChannel(nonce, m.parent), boot = call("bootstrap");
      const owner: SyntheticRecoveryExecutionOwner = { root: boot.root, get original() { return call("original"); },
        alive: () => { call("alive"); }, originalWindow: () => { call("originalWindow"); }, read: () => call("read"), ledger: () => call("ledger"),
        consume: (ordinal) => { call("consume", [ordinal]); }, witnessed: (...args) => { call("witnessed", args); },
        consumeInitial: () => { call("consumeInitial"); }, retired: () => call("retired"), registerWorker() { throw new Error("worker_cannot_register"); }, observeWorker() { throw new Error("worker_cannot_observe_coordination"); },
        workerCoordination() { throw new Error("worker_cannot_retire"); }, acceptRetirement() { throw new Error("worker_cannot_retire"); } };
      engine = createSyntheticNativeBarRecoveryWorkerEngine(owner, m.operation === "open_initial"); initialized = true; value = { worker_pid: process.pid };
      // The native hook must receive a live parent answer before returning to the next guarded operation.
      workerHook = (phase, path) => { call("hook", [phase, path, syntheticNativeBarRecoveryResources()]); };
    } else {
      if (m.nonce !== nonce) throw new Error("recovery_worker_session_binding");
      if (m.operation === "prepare" && !m.args.length) value = engine!.prepare();
      else if (m.operation === "approve" && m.args.length === 2) {
        approvals.set(m.id, engine!.approveForSyntheticTest(m.args[0], m.args[1])); value = m.id;
      } else if (m.operation === "begin" && m.args.length === 3) {
        const approval = approvals.get(m.args[2]); approvals.delete(m.args[2]);
        if (!approval) throw new Error("recovery_worker_approval_required");
        value = await engine!.begin(m.args[0], m.args[1], approval, { hook: workerHook });
      } else if (m.operation === "step" && !m.args.length) value = engine!.step();
      else if (m.operation === "close" && !m.args.length) value = engine!.close();
      else throw new Error("recovery_worker_command_refused");
    }
    process.send!({ nonce, id: m.id, ok: true, value, resources: syntheticNativeBarRecoveryResources() }, () => { if (m.operation === "close") process.disconnect!(); });
  } catch (error) {
    let cleanup; try { cleanup = engine?.close(); } catch { cleanup = { coordination_released: false }; }
    process.send?.({ nonce, id: m.id, ok: false, error: error instanceof Error ? error.message : "recovery_worker_failed", cleanup });
  } finally { busy = false; }
});
let workerHook: (phase: string, path: string) => void;
