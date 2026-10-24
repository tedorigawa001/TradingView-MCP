import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonical, evidenceHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";
import { coordinationOwnerDead, takeNativeWriterLockWithIo } from "./nativeBarAccess.js";
import { openSyntheticNativeBarQuarantineIo, openSyntheticNativeBarReader,
  type SyntheticReadHook, type SyntheticReadProof } from "./nativeBarFs.js";
import { nativeBarTransactionManifestSchema, nativeBarTransactionIntentSchema, nativeBarTransactionAttemptSchema,
  nativeBarTransactionEventSchema, nativeBarTransactionCompletionSchema, nativeBarTransactionProofSchema,
  replayNativeBarTransaction, type NativeBarTransactionProof, type NativeBarTransactionEvent,
  type NativeBarTransactionCompletion } from "./nativeBarTransactions.js";

const policy = { schema: "native-bar-synthetic-quarantine-profile-v4" };
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/), uuid = nativeBarId.refine((v) => v === v.toLowerCase());
const planSchema = z.strictObject({ schema: z.literal("native-bar-synthetic-quarantine-plan-v4"), plan_id: uuid,
  issued_at: nativeBarTimestamp, lease_opened_at: nativeBarTimestamp, expires_at: nativeBarTimestamp, generation: hashSchema,
  maintenance_id: uuid, chunk_id: uuid, attempt_id: uuid, reserve_path: z.string().regex(/^\.quarantine-reserve-[0-9a-f-]{36}\.tmp$/),
  budget_bytes: z.string().regex(/^[1-9][0-9]{0,9}$/), execution_available: z.literal(false), halted: z.literal(false), published_count: z.literal("0"),
  targets: z.array(z.strictObject({ target_id: uuid, source_path: z.string().max(512), holding_path: z.string().max(512), quarantine_path: z.string().max(512),
    proof: nativeBarTransactionProofSchema.extend({ flags: z.string().max(10).regex(/^(0|[1-9][0-9]*)$/) }), phase: z.literal("0") })).min(1).max(16),
  publications: z.array(z.string().max(512)).min(9).max(69), temporary_paths: z.array(z.string().regex(/^\.publication-[0-9a-f-]{36}\.tmp$/)).min(9).max(69),
  effects: z.tuple([z.literal("writer_coordination"), z.literal("retain_preallocated_reserve"), z.literal("immutable_metadata_publication"),
    z.literal("move_to_holding_then_quarantine"), z.literal("no_data_unlink")]), eligibility: z.literal("explicit_invented_capture_fixture_only"),
  host_approval_available: z.literal(false), elapsed_clock_qualified: z.literal(false), automatic_recovery: z.literal(false),
  recovery_execution_available: z.literal(false), plan_hash: hashSchema });
const envelopeSchema = z.strictObject({ schema: z.literal("native-bar-quarantine-intent-v4"), transaction: nativeBarTransactionIntentSchema, plan: planSchema });
function verifyPlan(plan: z.infer<typeof planSchema>) {
  const { plan_hash, ...contents } = plan, prefix = `maintenance/${plan.maintenance_id}`;
  const paths = [`${prefix}.manifest/${plan.chunk_id}.json`, `${prefix}.json`, `${prefix}.attempts/${plan.attempt_id}.json`,
    ...Array.from({ length: plan.targets.length * 4 }, (_, i) => `${prefix}.events/${i + 1}.json`),
    `quarantine/abandoned/${plan.maintenance_id}/timestamp.json`, `${prefix}.done.json`];
  if (evidenceHash(contents) !== plan_hash || canonical(paths) !== canonical(plan.publications)
    || plan.budget_bytes !== String((paths.length * 2 + 32) * 65536 + 1024 * 1024)
    || plan.temporary_paths.length !== paths.length || new Set([...plan.temporary_paths, plan.reserve_path]).size !== paths.length + 1
    || new Set(plan.targets.map((t) => t.target_id)).size !== plan.targets.length
    || plan.targets.some((t) => t.holding_path !== `maintenance-hold/${plan.maintenance_id}/${t.target_id}`
      || t.quarantine_path !== `quarantine/abandoned/${plan.maintenance_id}/${t.target_id}`)
    || Date.parse(plan.expires_at) - Date.parse(plan.lease_opened_at) !== 600000
    || plan.issued_at < plan.lease_opened_at || plan.issued_at >= plan.expires_at) throw new Error("quarantine_plan_binding");
}
const markerSchema = z.strictObject({ schema: z.literal("native-bar-quarantine-timestamp-v4"), maintenance_id: nativeBarId,
  intent_hash: z.string().regex(/^[0-9a-f]{64}$/), last_event_hash: z.string().regex(/^[0-9a-f]{64}$/),
  quarantined_at: nativeBarTimestamp, elapsed: z.null(),
  targets: z.array(z.strictObject({ target_id: nativeBarId, proof: nativeBarTransactionProofSchema })).min(1).max(16) });
function transactionProof(p: SyntheticReadProof & { sha256: string }): NativeBarTransactionProof {
  const { flags, ...fields } = p; void flags; return nativeBarTransactionProofSchema.parse(fields);
}
const clock = () => ({ utc_at: new Date().toISOString(), elapsed: null });
type FixtureApproval = Readonly<{ quarantine_fixture_only: true }>;

/** Isolated slice D fixture coordinator. No host approval, producer adoption, purge or MCP registration. */
export function createSyntheticNativeBarQuarantineRegistry(root: string, ttlMs = 600000) {
  if (ttlMs !== 600000) throw new Error("quarantine_registry_requires_original_ten_minute_window");
  const opened = Date.now(), mono = performance.now(), deadline = new Date(opened + ttlMs).toISOString();
  const io = openSyntheticNativeBarQuarantineIo(root, ttlMs, { ownerDead: coordinationOwnerDead });
  let closed = false, busy = false, consumed = false, lastWall = opened;
  let cleanup: ReturnType<typeof io.close> | undefined;
  const close = () => { if (busy) throw new Error("quarantine_registry_busy"); if (!closed) { closed = true; cleanup = io.close(); } return cleanup!; };
  const check = () => {
    if (closed) throw new Error("quarantine_registry_closed"); io.coordination.check();
    const now = Date.now();
    if (now < lastWall || now >= opened + ttlMs || performance.now() >= mono + ttlMs) throw new Error("quarantine_registry_expired_or_clock_rollback");
    lastWall = now;
  };
  const approvals = new WeakSet<object>();
  let plan: z.infer<typeof planSchema> | undefined;
  let nativePlan: ReturnType<typeof io.prepare>;
  let bundle: ReturnType<typeof makeBundle>;
  function makeBundle(planHash: string) {
    const baseline = io.coordination.preview();
    const binding = { profile: "native-bar-transaction-profile-v2", policy_hash: evidenceHash(policy),
      root: { device: baseline.root.device, inode: baseline.root.inode, uid: baseline.root.uid, mode: baseline.root.mode, acl: baseline.root.acl },
      backend_protocol: 2, capabilities_hash: evidenceHash({ read_protocol: 2, quarantine_protocol: 4, synthetic_only: true, purge: false }) };
    const manifest = nativeBarTransactionManifestSchema.parse({ schema: "native-bar-maintenance-manifest-v2",
      maintenance_id: nativePlan.maintenance_id, chunk_id: nativePlan.chunk_id,
      targets: nativePlan.targets.map((t) => ({ target_id: t.target_id,
        origin: { kind: "capture", recording_id: t.source_path.split("/").at(-1)!.slice(0, -5) },
        source_path: t.source_path, proof: transactionProof(t.proof), parents: baseline.entries.filter((e) => e.kind === "directory" && t.source_path.startsWith(e.path + "/"))
          .map((e) => ({ path: e.path, device: e.proof.device, inode: e.proof.inode, uid: e.proof.uid, mode: e.proof.mode, acl: e.proof.acl })) })) });
    const intent = nativeBarTransactionIntentSchema.parse({ schema: "native-bar-maintenance-intent-v2", maintenance_id: nativePlan.maintenance_id,
      kind: "quarantine_abandoned", binding, created: { utc_at: new Date(opened).toISOString(), elapsed: null }, approval_plan_hash: planHash,
      baseline: { inventory_hash: evidenceHash(baseline), reference_hash: evidenceHash(baseline) },
      manifests: [{ chunk_id: manifest.chunk_id, hash: evidenceHash(manifest) }], target_count: manifest.targets.length, quarantine_refs: [] });
    return { schema: "native-bar-transaction-bundle-v2" as const, intent, manifests: [manifest], quarantines: [],
      attempts: [] as ReturnType<typeof nativeBarTransactionAttemptSchema.parse>[], events: [] as NativeBarTransactionEvent[], completion: null as NativeBarTransactionCompletion | null };
  }
  function prepare(indices: number[]) {
    check(); if (plan) throw new Error("quarantine_plan_already_issued");
    busy = true;
    try {
      nativePlan = io.prepare(indices);
      const contents = { schema: "native-bar-synthetic-quarantine-plan-v4" as const, plan_id: randomUUID(),
        issued_at: new Date().toISOString(), lease_opened_at: new Date(opened).toISOString(), expires_at: deadline,
        generation: evidenceHash(io.coordination.preview()), ...nativePlan,
        effects: ["writer_coordination", "retain_preallocated_reserve", "immutable_metadata_publication", "move_to_holding_then_quarantine", "no_data_unlink"],
        eligibility: "explicit_invented_capture_fixture_only" as const, host_approval_available: false as const,
        elapsed_clock_qualified: false as const, automatic_recovery: false as const, recovery_execution_available: false as const };
      const result = planSchema.parse({ ...contents, plan_hash: evidenceHash(contents) }); verifyPlan(result);
      bundle = makeBundle(result.plan_hash); replayNativeBarTransaction(bundle); check();
      plan = structuredClone(result); const detached = structuredClone(result); busy = false; return detached;
    } catch (error) {
      busy = false;
      try { close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "quarantine_preparation_cleanup_failed"); }
      throw error;
    }
  }
  function binding(id: string, hash: string) {
    check(); if (!plan || id !== plan.plan_id || hash !== plan.plan_hash) throw new Error("quarantine_plan_binding");
    if (consumed) throw new Error("quarantine_plan_consumed");
  }
  return { prepare,
    approveForSyntheticTest(id: string, hash: string): FixtureApproval {
      binding(id, hash); const approval = Object.freeze({ quarantine_fixture_only: true as const }); approvals.add(approval); return approval;
    },
    async execute(id: string, hash: string, approval: FixtureApproval, options: { waitMs?: number; hook?: SyntheticReadHook } = {}) {
      binding(id, hash); if (!approval || !approvals.delete(approval)) throw new Error("quarantine_fixture_approval_required");
      consumed = true; busy = true;
      let lock: Awaited<ReturnType<typeof takeNativeWriterLockWithIo>> | undefined;
      let failure: unknown, failed = false, publication = 0, acknowledgedAt: string | null = null;
      let result: ReturnType<typeof replayNativeBarTransaction> | undefined;
      const publish = (record: unknown) => { check(); return transactionProof(io.publish(publication++, Buffer.from(canonical(record)), options.hook)); };
      const event = (type: "move_pending" | "held_verified" | "quarantine_move_pending" | "quarantined_verified", target_id: string, proof: NativeBarTransactionProof) => {
        const attempt = bundle.attempts[0]; const e = nativeBarTransactionEventSchema.parse({ schema: "native-bar-maintenance-event-v2",
          maintenance_id: bundle.intent.maintenance_id, intent_hash: evidenceHash(bundle.intent), attempt_id: attempt.attempt_id,
          attempt_hash: evidenceHash(attempt), sequence: bundle.events.length + 1,
          previous_event_hash: bundle.events.length ? evidenceHash(bundle.events.at(-1)) : null, target_id, clock: clock(), type, proof });
        bundle.events.push(e); replayNativeBarTransaction(bundle); publish(e);
      };
      try {
        check(); io.coordination.verifyBaseline(); lock = await takeNativeWriterLockWithIo(io.coordination, options.waitMs ?? 1000);
        check(); io.coordination.verifyBaseline(); io.begin(options.hook);
        const manifest = bundle.manifests[0];
        const attempt = nativeBarTransactionAttemptSchema.parse({ schema: "native-bar-maintenance-attempt-v2", attempt_id: nativePlan.attempt_id,
          maintenance_id: nativePlan.maintenance_id, intent_hash: evidenceHash(bundle.intent), binding_hash: evidenceHash(bundle.intent.binding),
          approval_plan_hash: hash, issued: { utc_at: new Date(opened).toISOString(), elapsed: null }, expires_at: deadline, resume_after_event_hash: null,
          reference_hash: bundle.intent.baseline.reference_hash, actions: manifest.targets.flatMap((t) => ["stage", "quarantine"].map((action) => ({ target_id: t.target_id, action }))),
          observations: manifest.targets.map((t) => ({ target_id: t.target_id, source: t.proof, holding: null, quarantine: null })) });
        bundle.attempts.push(attempt); replayNativeBarTransaction(bundle);
        publish(manifest); publish(envelopeSchema.parse({ schema: "native-bar-quarantine-intent-v4", transaction: bundle.intent, plan })); publish(attempt);
        const final: { target_id: string; state: "quarantined"; proof: NativeBarTransactionProof }[] = [];
        for (const [index, t] of manifest.targets.entries()) {
          event("move_pending", t.target_id, t.proof); check();
          const held = transactionProof(io.move(index, false, options.hook)); event("held_verified", t.target_id, held);
          event("quarantine_move_pending", t.target_id, held); check();
          const q = transactionProof(io.move(index, true, options.hook)); event("quarantined_verified", t.target_id, q);
          final.push({ target_id: t.target_id, state: "quarantined", proof: q });
        }
        io.verify(); check();
        const marker = markerSchema.parse({ schema: "native-bar-quarantine-timestamp-v4", maintenance_id: nativePlan.maintenance_id,
          intent_hash: evidenceHash(bundle.intent), last_event_hash: evidenceHash(bundle.events.at(-1)), quarantined_at: clock().utc_at,
          elapsed: null, targets: final.map(({ target_id, proof }) => ({ target_id, proof })) });
        const markerProof = publish(marker); io.verify(); check();
        bundle.completion = nativeBarTransactionCompletionSchema.parse({ schema: "native-bar-maintenance-completion-v2",
          maintenance_id: nativePlan.maintenance_id, intent_hash: evidenceHash(bundle.intent), last_event_hash: evidenceHash(bundle.events.at(-1)),
          attempt_hashes: [evidenceHash(attempt)], clock: clock(), outcome: "complete", targets: final,
          marker: { path: `quarantine/abandoned/${nativePlan.maintenance_id}/timestamp.json`, proof: markerProof } });
        result = replayNativeBarTransaction(bundle); publish(bundle.completion); io.verify(); check();
        if (options.hook?.("before_response", nativePlan.maintenance_id) !== undefined) throw new Error("test_hook_must_be_synchronous_void");
        io.verify(); check();
        acknowledgedAt = clock().utc_at;
      } catch (error) { failed = true; failure = error; }
      const released = lock?.release() ?? true;
      let state: ReturnType<typeof io.report> | null = null; try { state = io.report(); } catch { /* report is only last acknowledged progress */ }
      busy = false; const cleanup = close();
      if (failed || !released || !cleanup.coordination_released) throw Object.assign(new Error(failure instanceof Error ? failure.message : "quarantine_incomplete", { cause: failure }),
        { execution_available: false, maintenance_id: nativePlan.maintenance_id, coordination_released: released && cleanup.coordination_released,
          progress: state, original_acknowledgement: "not_proven", recovery_execution_available: false,
          recovery: "executor_not_connected_fresh_plan_and_approval_required" });
      return { status: result!.status, maintenance_id: nativePlan.maintenance_id, execution_available: false as const,
        coordination_released: true, synthetic_effects_performed: true, original_acknowledgement: "not_proven" as const,
        logical_completed_at: bundle.completion!.clock.utc_at, publication_acknowledged_at: acknowledgedAt,
        durability_observed: "native_file_fullsync_directory_sync_and_readback", recovery_execution_available: false };
    }, close };
}

/** Read-only restart inspection. Never locks, resumes, repairs, or accepts an on-disk approval as authority. */
export function inspectSyntheticNativeBarQuarantine(root: string, maintenanceId: string) {
  nativeBarId.parse(maintenanceId); if (maintenanceId !== maintenanceId.toLowerCase()) throw new Error("canonical_maintenance_id_required");
  const reader = openSyntheticNativeBarReader(root);
  try {
    const snapshot = reader.inventory();
    try {
      if (!snapshot.report.namespace_qualified) throw new Error("quarantine_unqualified_namespace");
      const records = new Map<string, unknown>(), proofs = new Map<string, NativeBarTransactionProof>();
      for (const [index, entry] of snapshot.report.entries.entries()) {
        if (entry.kind !== "file" || !(entry.path === "policy.json" || entry.path.startsWith(`maintenance/${maintenanceId}`)
          || entry.path === `quarantine/abandoned/${maintenanceId}/timestamp.json`)) continue;
        if (BigInt(entry.proof.size) > 65536n) throw new Error("quarantine_metadata_limit");
        const value = snapshot.readEvidence(index), raw = new TextDecoder("utf-8", { fatal: true }).decode(value.bytes);
        const record: unknown = JSON.parse(raw); if (!value.bytes.equals(Buffer.from(canonical(record), "utf8"))) throw new Error("quarantine_noncanonical_metadata");
        records.set(entry.path, record); proofs.set(entry.path, transactionProof(value.proof));
      }
      if (canonical(records.get("policy.json")) !== canonical(policy)) throw new Error("quarantine_synthetic_profile_required");
      const prefix = `maintenance/${maintenanceId}`, rawIntent = records.get(prefix + ".json");
      if (!records.has(prefix + ".json")) { snapshot.verify(); return { status: "preparation_incomplete", data_effects: "unknown_without_complete_intent",
        execution_available: false, original_acknowledgement: "not_proven", recovery_execution_available: false,
        recovery: "executor_not_connected_fresh_plan_and_approval_required" }; }
      const envelope = envelopeSchema.parse(rawIntent), intent = envelope.transaction; verifyPlan(envelope.plan);
      const rootProof = snapshot.report.root;
      if (intent.kind !== "quarantine_abandoned" || intent.maintenance_id !== maintenanceId || intent.binding.policy_hash !== evidenceHash(policy)
        || envelope.plan.maintenance_id !== maintenanceId || envelope.plan.plan_hash !== intent.approval_plan_hash
        || envelope.plan.generation !== intent.baseline.inventory_hash || intent.created.utc_at !== envelope.plan.lease_opened_at
        || canonical(intent.binding.root) !== canonical({ device: rootProof.device, inode: rootProof.inode, uid: rootProof.uid, mode: rootProof.mode, acl: rootProof.acl })) throw new Error("quarantine_intent_binding");
      const manifests = intent.manifests.map((m) => nativeBarTransactionManifestSchema.parse(records.get(`${prefix}.manifest/${m.chunk_id}.json`)));
      const manifestTargets = manifests.flatMap((m) => m.targets);
      if (manifests.length !== 1 || manifests[0].chunk_id !== envelope.plan.chunk_id
        || canonical(manifestTargets.map((t) => ({ target_id: t.target_id, source_path: t.source_path, proof: t.proof })))
          !== canonical(envelope.plan.targets.map((t) => ({ target_id: t.target_id, source_path: t.source_path, proof: transactionProof(t.proof) })))) throw new Error("quarantine_manifest_plan_binding");
      const attempts = [...records].filter(([p]) => p.startsWith(prefix + ".attempts/")).map(([, r]) => nativeBarTransactionAttemptSchema.parse(r));
      if (attempts.length > 1 || attempts.some((a) => a.attempt_id !== envelope.plan.attempt_id || a.approval_plan_hash !== envelope.plan.plan_hash
        || a.issued.utc_at !== envelope.plan.lease_opened_at || a.expires_at !== envelope.plan.expires_at)) throw new Error("quarantine_attempt_plan_binding");
      const events = [...records].filter(([p]) => p.startsWith(prefix + ".events/")).map(([, r]) => nativeBarTransactionEventSchema.parse(r)).sort((a, b) => a.sequence - b.sequence);
      for (const attempt of attempts) if (canonical(records.get(`${prefix}.attempts/${attempt.attempt_id}.json`)) !== canonical(attempt)) throw new Error("quarantine_attempt_path_binding");
      for (const event of events) if (canonical(records.get(`${prefix}.events/${event.sequence}.json`)) !== canonical(event)) throw new Error("quarantine_event_path_binding");
      const allowed = new Set(["policy.json", ...envelope.plan.publications]);
      if ([...records.keys()].some((p) => !allowed.has(p))) throw new Error("quarantine_unknown_transaction_metadata");
      // Every entry in this transaction's namespaces must be planned, so a later purge trusting this result never meets an
      // object the transaction did not quarantine.
      const holdingDir = `maintenance-hold/${maintenanceId}`, quarantineDir = `quarantine/abandoned/${maintenanceId}`;
      const planned = new Set([...envelope.plan.publications, `${prefix}.manifest`, `${prefix}.events`, `${prefix}.attempts`, holdingDir, quarantineDir,
        ...envelope.plan.targets.flatMap((t) => [`${holdingDir}/${t.target_id}`, `${quarantineDir}/${t.target_id}`])]);
      const owned = (p: string) => p.startsWith(`${prefix}.`) || [holdingDir, quarantineDir].some((d) => p === d || p.startsWith(`${d}/`));
      if (snapshot.report.entries.some((e) => owned(e.path) && !planned.has(e.path))) throw new Error("quarantine_unplanned_transaction_entry");
      const completion = records.has(prefix + ".done.json") ? nativeBarTransactionCompletionSchema.parse(records.get(prefix + ".done.json")) : null;
      const replay = replayNativeBarTransaction({ schema: "native-bar-transaction-bundle-v2", intent, manifests, quarantines: [], attempts, events, completion });
      const current_locations = manifests.flatMap((m) => m.targets).map((target) => {
        const places = { source: target.source_path, holding: `maintenance-hold/${maintenanceId}/${target.target_id}`,
          quarantine: `quarantine/abandoned/${maintenanceId}/${target.target_id}` };
        const observed: { target_id: string; source: NativeBarTransactionProof | null; holding: NativeBarTransactionProof | null; quarantine: NativeBarTransactionProof | null } = {
          target_id: target.target_id, source: null, holding: null, quarantine: null };
        for (const place of ["source", "holding", "quarantine"] as const) {
          const index = snapshot.report.entries.findIndex((e) => e.path === places[place]);
          if (index >= 0) {
            const fresh = snapshot.readEvidence(index).proof;
            if (fresh.flags !== envelope.plan.targets.find((t) => t.target_id === target.target_id)!.proof.flags) throw new Error("quarantine_target_flags_changed");
            observed[place] = transactionProof(fresh);
            const { ctime_ns: before, ...original } = target.proof, { ctime_ns: after, ...actual } = observed[place];
            if (canonical(original) !== canonical(actual) || BigInt(after) < BigInt(before)) throw new Error("quarantine_location_conflict");
          }
        }
        if ([observed.source, observed.holding, observed.quarantine].filter(Boolean).length > 1
          || snapshot.report.entries.some((e) => e.path.startsWith("receipts/") && e.path.split("/").at(-1) === target.source_path.split("/").at(-1))) throw new Error("quarantine_location_conflict");
        return observed;
      });
      const markerPath = `quarantine/abandoned/${maintenanceId}/timestamp.json`;
      // A published timestamp must validate even if the completion publication was interrupted.
      if (records.has(markerPath)) {
        const marker = markerSchema.parse(records.get(markerPath)), last = events.at(-1), proof = proofs.get(markerPath)!;
        if (!last || replay.targets.some((t) => t.state !== "quarantined")
          || marker.intent_hash !== evidenceHash(intent) || marker.last_event_hash !== evidenceHash(last) || marker.maintenance_id !== maintenanceId
          || canonical(marker.targets) !== canonical(replay.targets.map(({ target_id, proof }) => ({ target_id, proof })))
          || marker.quarantined_at < last.clock.utc_at || marker.quarantined_at >= envelope.plan.expires_at
          || BigInt(proof.birthtime_ns) < BigInt(Date.parse(marker.quarantined_at)) * 1000000n
          || completion && (marker.quarantined_at > completion.clock.utc_at || canonical(proof) !== canonical(completion.marker?.proof))) throw new Error("quarantine_marker_binding");
        for (const t of marker.targets) {
          const location = current_locations.find((o) => o.target_id === t.target_id)!;
          if (location.source || location.holding || canonical(location.quarantine) !== canonical(t.proof)) throw new Error("quarantine_location_conflict");
        }
      } else if (completion) {
        throw new Error("quarantine_marker_binding");
      }
      snapshot.verify(); return { status: replay.status, replay, current_locations, execution_available: false, original_acknowledgement: "not_proven",
        recovery_execution_available: false, recovery: "executor_not_connected_fresh_plan_and_approval_required", elapsed_clock_qualified: false };
    } finally { snapshot.close(); }
  } finally { reader.close(); }
}
