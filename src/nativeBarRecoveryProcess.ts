import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { syntheticNativeBarRecoveryExecutionOwner } from "./nativeBarRecoveryController.js";
import { RECOVERY_CHANNEL_LIMIT, recoveryFrame, decodeRecoveryFrame } from "./nativeBarRecoveryChannel.js";
import { nativeBarRecoveryBundleSchema, validateNativeBarRecoveryBundle } from "./nativeBarRecovery.js";
import { canonical, evidenceHash } from "./nativeBarEvidence.js";
import { coordinationFileOwnerDead } from "./nativeBarAccess.js";
import { openSyntheticNativeBarRecoveryRetirementIo, syntheticNativeBarRecoveryResources } from "./nativeBarFs.js";
let activeWorker = false;

/** Private fork transport for invented fixtures. No automatic recovery, disk authority or MCP registration. */
export async function createSyntheticNativeBarRecoveryProcess(capability: object,
  options: { hook?: (phase: string, path: string, workerPid: number) => void } = {}) {
  return createProcess(capability, options, false);
}
export async function createSyntheticNativeBarInitialProcess(capability: object,
  options: { hook?: (phase: string, path: string, workerPid: number) => void } = {}) {
  return createProcess(capability, options, true);
}
async function createProcess(capability: object, options: { hook?: (phase: string, path: string, workerPid: number) => void }, initial: boolean) {
  const owner = syntheticNativeBarRecoveryExecutionOwner(capability), nonce = randomUUID();
  if (activeWorker) throw new Error("recovery_process_worker_limit");
  const local = syntheticNativeBarRecoveryResources();
  if (local.roots || local.descriptors) throw new Error("recovery_process_native_resources_busy");
  activeWorker = true;
  let child: ReturnType<typeof fork>;
  try { child = fork(new URL("./nativeBarRecoveryWorker.js", import.meta.url), [], {
    execArgv: [], serialization: "advanced", stdio: ["ignore", "ignore", "pipe", "ipc", "pipe"],
  }); } catch (error) { activeWorker = false; throw error; }
  const pipe = child.stdio[4] as Duplex, approvals = new WeakMap<object, number>();
  let id = 0, rpcSequence = 0, closed = false, exited = false, buffered = Buffer.alloc(0), stderr = "";
  let pending: { id: number; resolve: (value: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  const opened = performance.now();
  let resolveExit: () => void;
  const exit = new Promise<void>((resolve) => { resolveExit = resolve; });
  function finishExit() { if (!exited) { exited = true; activeWorker = false; resolveExit(); } }
  const fail = (error: Error) => { if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = undefined; } };
  child.stderr!.on("data", (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-4096); });
  child.on("error", (error) => { fail(error); if (child.pid) child.kill("SIGKILL"); else finishExit(); });
  child.on("exit", (code, signal) => { finishExit(); fail(new Error(`recovery_worker_exited:${code ?? signal}:${stderr}`)); pipe.destroy(); });
  function resources(value: { roots: number; descriptors: number }, headroom = 48) {
    const local = syntheticNativeBarRecoveryResources();
    if (!value || !Number.isSafeInteger(value.roots) || !Number.isSafeInteger(value.descriptors) || value.roots < 0 || value.descriptors < 0
      || value.roots + local.roots > 8 || value.descriptors + local.descriptors + headroom > 512) throw new Error("recovery_process_resource_headroom");
  }
  pipe.on("error", (error) => { fail(error); child.kill("SIGKILL"); });
  pipe.on("data", (chunk: Buffer) => {
    try {
      if (buffered.length + chunk.length > RECOVERY_CHANNEL_LIMIT + 4) throw new Error("recovery_ipc_limit");
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const length = buffered.readUInt32BE(); if (!length || length > RECOVERY_CHANNEL_LIMIT) throw new Error("recovery_ipc_limit");
        if (buffered.length < length + 4) return;
        const m = decodeRecoveryFrame(buffered.subarray(4, 4 + length)) as { nonce: string; id: number; operation: string; args: any[] };
        buffered = buffered.subarray(4 + length);
        if (m.nonce !== nonce || m.id !== ++rpcSequence || rpcSequence > 65536 || !Array.isArray(m.args) || !pending) throw new Error("recovery_ipc_request_binding");
        let value: unknown = null, error: string | null = null;
        try {
          owner.alive();
          if (m.operation === "bootstrap" && !m.args.length && rpcSequence === 1) value = { root: owner.root };
          else if (m.operation === "alive" && !m.args.length) value = null;
          else if (m.operation === "originalWindow" && initial && !m.args.length) owner.originalWindow();
          else if (m.operation === "original" && !m.args.length) value = owner.original;
          else if (m.operation === "read" && !m.args.length) value = owner.read();
          else if (m.operation === "ledger" && !m.args.length) value = owner.ledger();
          else if (m.operation === "retired" && !m.args.length) value = owner.retired();
          else if (m.operation === "consume" && m.args.length === 1) owner.consume(m.args[0]);
          else if (m.operation === "consumeInitial" && !m.args.length) owner.consumeInitial();
          else if (m.operation === "witnessed" && m.args.length === 3) owner.witnessed(m.args[0], m.args[1], m.args[2]);
          else if (m.operation === "hook" && m.args.length === 3) {
            resources(m.args[2]);
            if (options.hook?.(m.args[0], m.args[1], child.pid!) !== undefined) throw new Error("test_hook_must_be_synchronous_void");
            owner.alive(); if (initial) owner.originalWindow(); resources(m.args[2]);
          } else throw new Error("recovery_controller_rpc_refused");
        } catch (e) { error = e instanceof Error ? e.message : "recovery_controller_refused"; }
        if (!exited && !pipe.destroyed) pipe.write(recoveryFrame({ nonce, id: m.id, ok: error === null, value, error }));
      }
    } catch (error) { fail(error as Error); pipe.destroy(); child.kill("SIGKILL"); }
  });
  child.on("message", (raw: unknown) => {
    const m = raw as { nonce: string; id: number; ok: boolean; value: any; error: string; cleanup: unknown; resources: { roots: number; descriptors: number } };
    if (!pending || m.nonce !== nonce || m.id !== pending.id) { fail(new Error("recovery_worker_response_binding")); child.kill("SIGKILL"); return; }
    const p = pending; clearTimeout(p.timer); pending = undefined;
    if (!m.ok) p.reject(Object.assign(new Error(m.error), { cleanup: m.cleanup }));
    else { try { resources(m.resources, m.resources.roots ? 48 : 0); p.resolve(m.value); } catch (error) { p.reject(error as Error); } }
  });
  function request(operation: string, args: unknown[] = []) {
    if (pending || closed || exited) return Promise.reject(new Error("recovery_process_busy_or_closed"));
    return new Promise<any>((resolve, reject) => {
      const timeout = operation === "close" ? 30000 : Math.max(1, opened + 600000 - performance.now());
      const next = ++id, timer = setTimeout(() => { fail(new Error("recovery_worker_transport_deadline")); child.kill("SIGKILL"); }, timeout);
      pending = { id: next, resolve, reject, timer };
      child.send({ nonce, id: next, operation, args, parent: process.pid }, (error) => { if (error) fail(error); });
    });
  }
  let closing: Promise<{ coordination_released: boolean; execution_available: false }> | undefined;
  function close() {
    return closing ??= (async () => {
      let cleanup = { coordination_released: false, execution_available: false as const };
      try { if (!exited && !pending) cleanup = await request("close"); }
      finally { closed = true; if (!exited) child.kill("SIGKILL"); await exit; }
      return cleanup;
    })();
  }
  try { owner.registerWorker(child.pid!); await request(initial ? "open_initial" : "open"); }
  catch (error) { try { await close(); } catch { /* original bootstrap failure is retained */ } throw error; }
  return { workerPid: child.pid!, waitForExit: () => exit,
    async prepare() { try { return await request("prepare"); } catch (error) { await close(); throw error; } },
    async approveForSyntheticTest(planId: string, hash: string) {
      owner.alive(); const value = await request("approve", [planId, hash]), approval = Object.freeze({}); approvals.set(approval, value); return approval;
    },
    async begin(planId: string, hash: string, approval: object) {
      owner.alive(); const value = approvals.get(approval); if (value === undefined) throw new Error("recovery_process_approval_required");
      approvals.delete(approval);
      try { const result = await request("begin", [planId, hash, value]); owner.observeWorker(child.pid!, result.coordination.entries); return result; }
      catch (error) { await close(); throw error; }
    },
    async step(...args: never[]) {
      if (args.length) throw new Error("recovery_no_caller_paths_phases_or_payload"); owner.alive();
      const value = await request("step"), bundle = nativeBarRecoveryBundleSchema.parse(value.bundle); validateNativeBarRecoveryBundle(bundle); owner.alive(); return { ...value, bundle };
    }, close,
  };
}

/** Separate single-use coordination-only operation; never unlinks dead entries or resumes data steps. */
export async function prepareSyntheticNativeBarWorkerRetirement(capability: object, pid: number) {
  const owner = syntheticNativeBarRecoveryExecutionOwner(capability), entries = owner.workerCoordination(pid);
  for (const e of entries) if (!await coordinationFileOwnerDead(e.path, Buffer.from(e.body))) throw new Error("recovery_worker_not_proven_dead");
  owner.alive(); const io = openSyntheticNativeBarRecoveryRetirementIo(owner.root), opened = Date.now(), mono = performance.now();
  let closed = false, consumed = false; const approvals = new WeakSet<object>();
  const fields = { schema: "native-bar-worker-retirement-plan-v5", plan_id: randomUUID(), pid,
    opened_at: new Date(opened).toISOString(), expires_at: new Date(opened + 600000).toISOString(), entries,
    effects: ["preserve_exact_dead_worker_coordination_by_native_retirement", "no_data_operations", "fresh_recovery_preview_required"], execution_available: false };
  const plan = { ...fields, plan_hash: evidenceHash(fields) };
  const check = () => { owner.alive(); if (closed || Date.now() < opened || Date.now() >= opened + 600000 || performance.now() >= mono + 600000) throw new Error("recovery_retirement_closed_or_expired"); };
  const bind = (id: string, hash: string) => { check(); if (id !== plan.plan_id || hash !== plan.plan_hash || consumed) throw new Error("recovery_retirement_binding_or_consumed"); };
  function close() { if (!closed) { closed = true; return io.close(); } return { coordination_released: false, execution_available: false }; }
  return { plan: structuredClone(plan),
    approveForSyntheticTest(id: string, hash: string) { bind(id, hash); const token = Object.freeze({}); approvals.add(token); return token; },
    async execute(id: string, hash: string, approval: object) {
      bind(id, hash); if (!approvals.delete(approval)) throw new Error("recovery_retirement_approval_required"); consumed = true;
      const retired: string[] = [];
      try {
        io.coordination.verifyBaseline();
        for (const entry of entries) {
          check(); const current = owner.workerCoordination(pid).find((e) => e.path === entry.path);
          if (!current || canonical(current) !== canonical(entry) || !await coordinationFileOwnerDead(entry.path, Buffer.from(entry.body))) throw new Error("recovery_retirement_changed_or_live");
          check(); const destination = await io.retire(entry.path, entry.body, Buffer.from(canonical(entry.proof))); owner.acceptRetirement(pid, entry.path, destination); retired.push(destination);
        }
        return { execution_available: false, recovery_execution_available: false, retired, fresh_preview_required: true };
      } finally { close(); }
    }, close,
  };
}
