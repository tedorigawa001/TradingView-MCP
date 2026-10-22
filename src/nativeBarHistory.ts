import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, realpath, statfs, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { attemptLockFile, posixModeEnforced, publishImmutableFile, readRegularFile, releaseLockFileSync, syncDirectoryEntry } from "./fsDurability.js";
import { canonical, evidenceHash, nativeBarCaptureSchema, nativeBarHash, nativeBarId, nativeBarTargetsSchema,
  nativeBarTimestamp, NATIVE_BAR_SYMBOLS, projectNativeBarHistory } from "./nativeBarEvidence.js";
import type { AcceptedNativeCapture, NativeBarCapture, NativeBarTargets } from "./nativeBarEvidence.js";

const DAY = 86_400_000, RESERVE = 4 * 1024 * 1024;
const receiptSchema = z.strictObject({
  schema: z.literal("native-bar-receipt-v1"), recording_id: nativeBarId, plan_hash: nativeBarHash,
  policy_hash: nativeBarHash, payload_hash: nativeBarHash, sequence: z.number().int().positive(),
  recorded_at: nativeBarTimestamp, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
type Receipt = z.infer<typeof receiptSchema>;
type Pair = { receipt: Receipt; payload: NativeBarCapture; receipt_hash: string; bytes: number };
const pairRefSchema = z.strictObject({ recording_id: nativeBarId, sequence: z.number().int().positive(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payload_hash: nativeBarHash, receipt_hash: nativeBarHash, bytes: z.number().int().positive() });
const maintenanceSchema = z.strictObject({ schema: z.literal("native-bar-maintenance-v1"), id: nativeBarId,
  kind: z.enum(["prune", "clock_recovery"]), created_at: nativeBarTimestamp,
  pairs: z.array(pairRefSchema).max(4096), generation: nativeBarHash,
});
type Maintenance = z.infer<typeof maintenanceSchema>;
type State = { missing: boolean; pairs: Pair[]; maintenance: Maintenance[]; incomplete: Maintenance[];
  bytes: number; queryBytes: number; maintenanceBytes: number; generation: string; files: string[] };
type Plan = { plan_id: string; plan_hash: string; recording_id: string; kind: "record" | "prune" | "clock_recovery";
  expires_at: string; deadline: number; targets?: NativeBarTargets; generation: string; pairs: Maintenance["pairs"];
  resume_id?: string; policy_hash: string };
export type NativeHistoryOptions = {
  directory?: string; now?: () => Date; monotonic?: () => number; lockWaitMs?: number;
  /** Constructor-only seam. Never exposed through MCP requests or environment configuration. */
  testOnly?: { allowTemporaryRoot: true; quotaBytes?: number; queryBytesLimit?: number; maintenanceMetadataLimitBytes?: number;
    afterPublish?: (stage: string) => Promise<void> };
};

/** No constructor IO, background collection, durable grants or imports. */
export class NativeBarHistory {
  readonly directory: string;
  private readonly now: () => Date;
  private readonly monotonic: () => number;
  private readonly plans = new Map<string, Plan>();
  private readonly policy: object;
  private readonly policyHash: string;
  private readonly quota: number;
  private readonly queryBytesLimit: number;
  private readonly maintenanceMetadataLimitBytes: number;
  constructor(private readonly options: NativeHistoryOptions = {}) {
    this.directory = options.directory ?? process.env.TRADINGVIEW_MCP_NATIVE_BAR_HISTORY_DIR
      ?? join(homedir(), ".tradingview-mcp", "native-bar-history", "v1");
    this.now = options.now ?? (() => new Date());
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.quota = options.testOnly?.quotaBytes ?? 1024 ** 3;
    this.queryBytesLimit = options.testOnly?.queryBytesLimit ?? 256 * 1024 ** 2;
    this.maintenanceMetadataLimitBytes = options.testOnly?.maintenanceMetadataLimitBytes ?? 16 * 1024 ** 2;
    this.policy = { schema: "native-bar-policy-v1", directory: this.directory,
      symbols: NATIVE_BAR_SYMBOLS, timeframes: ["15", "60"], bars_per_series: 40,
      retention_elapsed_days: 90, quota_bytes: this.quota, capture_limit_bytes: 1024 ** 2,
      committed_capture_limit: 4096, maintenance_batch_limit: 1024, query_bytes_limit: this.queryBytesLimit,
      maintenance_metadata_limit_bytes: this.maintenanceMetadataLimitBytes,
      response_bytes_limit: 8 * 1024 ** 2, returned_occurrences_per_identity: 100,
      consent: "per_invocation; policy is not consent", exclusions: "studies, quotes, accounts, Pine, screenshots, credentials",
      maintenance: "explicit_exact_plan_only; no automatic deletion", contract: "native-bar-v1:successor-confirmed" };
    this.policyHash = evidenceHash(this.policy);
  }
  private clock() { return nativeBarTimestamp.parse(this.now().toISOString()); }
  private async safePath(path: string, file = false) {
    if (!isAbsolute(this.directory) || resolve(this.directory) !== this.directory) throw new Error("unsafe_root: canonical absolute directory required");
    if (!posixModeEnforced()) throw new Error("private_access_unverified: Windows ACL verification unavailable");
    const root = this.directory;
    if ((relative(root, path).startsWith(`..${sep}`) || relative(root, path) === "..")
      && (file || !(root.startsWith(path + sep) || path === sep))) throw new Error("path_outside_store");
    if (root === sep || root === homedir()) throw new Error("unsafe_root");
    if (!this.options.testOnly && ([tmpdir(), await realpath(tmpdir()), "/tmp", "/private/tmp", "/var/tmp"].some((p) => root === p || root.startsWith(`${p}/`))
      || /\/(\.codex|\.agents|\.ssh|\.aws|\.gnupg|\.kube|\.azure|\.password-store|\.git|automations|research[-_]?journal|Keychains)(\/|$)/i.test(root))) throw new Error("protected_or_temporary_root");
    const components: string[] = [];
    for (let p = path; ; p = dirname(p)) { components.unshift(p); if (dirname(p) === p) break; }
    for (const p of components) {
      let st;
      try { st = await lstat(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
      if (st.isSymbolicLink() || (p === path && file ? !st.isFile() : !st.isDirectory())) throw new Error("unsafe_path: link or nonregular entry");
      const owned = st.uid === process.getuid!();
      const inside = p === root || p.startsWith(`${root}/`);
      if ((inside && (!owned || (posixModeEnforced() && (st.mode & 0o077) !== 0)))
        || (!inside && !this.options.testOnly && ((st.mode & 0o022) !== 0 || (!owned && st.uid !== 0)))) throw new Error("unsafe_owner_or_permissions");
      if (!file || p !== path) {
        try { await lstat(join(p, ".git")); throw new Error("git_checkout_root_refused"); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      }
    }
  }
  private async read(path: string, max = 1024 ** 2) {
    await this.safePath(path, true);
    const bytes = await readRegularFile(path, "native bar history", max);
    const value = JSON.parse(bytes.toString("utf8"));
    if (!bytes.equals(Buffer.from(canonical(value), "utf8"))) throw new Error("noncanonical_or_duplicate_key_evidence");
    return value;
  }
  private async directories(path: string) {
    await this.safePath(path);
    try { await lstat(path); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    await this.directories(dirname(path));
    try { await mkdir(path, { mode: 0o700 }); await syncDirectoryEntry(dirname(path)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    await this.safePath(path);
  }
  private async publish(path: string, value: unknown) {
    await this.directories(dirname(path)); await this.safePath(path, true);
    const body = canonical(value);
    if (Buffer.byteLength(body) > 1024 ** 2) throw new Error("publication_size_limit");
    const result = await publishImmutableFile(path, body, "native bar history");
    if (result === "different") throw new Error("immutable_id_conflict");
    if (canonical(await this.read(path)) !== body) throw new Error("publication_readback_failed");
  }
  private paths(r: { day: string; recording_id: string }) {
    return { payload: join(this.directory, "captures", r.day, `${r.recording_id}.json`),
      receipt: join(this.directory, "receipts", r.day, `${r.recording_id}.json`) };
  }
  private async inventory(): Promise<{ files: string[]; bytes: number }> {
    const files: string[] = []; let bytes = 0, entries = 0;
    const walk = async (path: string) => {
      await this.safePath(path);
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (++entries > 30000) throw new Error("store_entry_limit");
        const p = join(path, entry.name);
        if (entry.isDirectory()) await walk(p);
        else { await this.safePath(p, true); const st = await lstat(p); bytes += st.size; files.push(p); }
        if (bytes > this.quota) throw new Error("store_over_quota");
      }
    };
    await walk(this.directory); return { files: files.sort(), bytes };
  }
  private async load(allowIncomplete = false): Promise<State> {
    await this.safePath(this.directory);
    try { await lstat(this.directory); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      return { missing: true, pairs: [], maintenance: [], incomplete: [], bytes: 0, queryBytes: 0, maintenanceBytes: 0,
        generation: evidenceHash({ receipts: [], maintenance: [] }), files: [] };
    }
    const { files, bytes } = await this.inventory();
    const policy = await this.read(join(this.directory, "policy.json"));
    if (evidenceHash(policy) !== this.policyHash) throw new Error("policy_mismatch_or_partial_initialization");
    const maintenance: Maintenance[] = [], incomplete: Maintenance[] = [];
    let maintenanceBytes = 0;
    for (const p of files.filter((p) => dirname(p) === join(this.directory, "maintenance") && p.endsWith(".json") && !p.endsWith(".done.json"))) {
      maintenanceBytes += (await lstat(p)).size;
      if (maintenanceBytes > this.maintenanceMetadataLimitBytes) throw new Error("maintenance_metadata_query_limit");
      const m = maintenanceSchema.parse(await this.read(p));
      if (p !== join(this.directory, "maintenance", `${m.id}.json`)) throw new Error("maintenance_path_mismatch");
      maintenance.push(m);
      const done = join(this.directory, "maintenance", `${m.id}.done.json`);
      if (!files.includes(done)) incomplete.push(m);
      else if (canonical(await this.read(done)) !== canonical({ id: m.id, intent_hash: evidenceHash(m) })) throw new Error("maintenance_completion_corrupt");
    }
    if (incomplete.length && !allowIncomplete) throw new Error("maintenance_incomplete: explicit recovery approval required; no partial history returned");
    const pairs: Pair[] = []; let queryBytes = 0;
    for (const p of files.filter((p) => p.startsWith(join(this.directory, "receipts") + sep))) {
      const receipt = receiptSchema.parse(await this.read(p, 16384));
      if (p !== this.paths(receipt).receipt || receipt.policy_hash !== this.policyHash || receipt.day !== receipt.recorded_at.slice(0, 10)) throw new Error("receipt_binding_corrupt");
      if (maintenance.some((m) => m.pairs.some((r) => r.recording_id === receipt.recording_id))) continue;
      const payload = nativeBarCaptureSchema.parse(await this.read(this.paths(receipt).payload));
      if (evidenceHash(payload) !== receipt.payload_hash || payload.series.some((s) => s.observed_at > receipt.recorded_at)) throw new Error("payload_hash_or_clock_corrupt");
      const pairBytes = (await lstat(p)).size + (await lstat(this.paths(receipt).payload)).size;
      queryBytes += pairBytes;
      if (pairs.length >= 4096 || queryBytes > this.queryBytesLimit) throw new Error("history_query_limit; no partial history returned");
      pairs.push({ receipt, payload, receipt_hash: evidenceHash(receipt), bytes: pairBytes });
    }
    pairs.sort((a, b) => a.receipt.sequence - b.receipt.sequence);
    if (new Set(pairs.map((p) => p.receipt.sequence)).size !== pairs.length || new Set(pairs.map((p) => p.receipt.recording_id)).size !== pairs.length
      || pairs.some((p, i) => i > 0 && (pairs[i - 1].receipt.recorded_at > p.payload.capture_as_of))) throw new Error("observation_order_corrupt");
    const generation = evidenceHash({ receipts: pairs.map((p) => p.receipt_hash), maintenance });
    const after = await this.inventory();
    if (canonical(files.filter((p) => !p.endsWith(".writer.lock"))) !== canonical(after.files.filter((p) => !p.endsWith(".writer.lock")))) throw new Error("store_changed_during_read: retry");
    return { missing: false, pairs, maintenance, incomplete, bytes, queryBytes, maintenanceBytes, generation, files };
  }
  private clockQuality(state: State) {
    const now = this.clock(), latest = state.pairs.at(-1)?.receipt.recorded_at ?? null;
    return { status: latest && latest > now ? "clock_ahead" : "ok", latest_recorded_at: latest,
      ahead_ms: latest ? Math.max(0, Date.parse(latest) - Date.parse(now)) : 0 };
  }
  private issue(kind: Plan["kind"], state: State, extra: Partial<Plan> = {}) {
    const tick = this.monotonic();
    for (const [id, p] of this.plans) if (p.deadline <= tick) this.plans.delete(id);
    if (this.plans.size >= 128) throw new Error("plan_registry_full");
    const body = { plan_id: randomUUID(), recording_id: randomUUID(), kind, expires_at: new Date(Date.parse(this.clock()) + 600000).toISOString(),
      generation: state.generation, pairs: [] as Maintenance["pairs"], policy_hash: this.policyHash, ...extra };
    const plan = { ...body, plan_hash: evidenceHash(body), deadline: tick + 600000 };
    this.plans.set(plan.plan_id, plan);
    const { deadline, ...publicPlan } = plan;
    return structuredClone({ ...publicPlan, directory: this.directory, policy: this.policy, store_status: state.missing ? "missing" : "existing",
      bindings_verified: false, warnings: ["confirm is not human authentication; host must obtain explicit per-invocation approval",
        "first confirmed write may initialize metadata even if capture later fails", "no automatic collection, deletion or notification"] });
  }
  async prepareRecording(targets: NativeBarTargets) {
    return this.issue("record", await this.load(), { targets: nativeBarTargetsSchema.parse(targets) });
  }
  private consume(id: string, hash: string, confirm: boolean, kind: Plan["kind"]) {
    if (confirm !== true) throw new Error("confirm_required");
    const plan = this.plans.get(nativeBarId.parse(id));
    if (!plan) throw new Error("plan_not_found: preview again in this MCP process");
    this.plans.delete(id);
    if (plan.kind !== kind || plan.plan_hash !== nativeBarHash.parse(hash) || plan.policy_hash !== this.policyHash) throw new Error("plan_binding_mismatch");
    if (this.monotonic() >= plan.deadline) throw new Error("plan_expired");
    return plan;
  }
  private async locked<T>(work: () => Promise<T>, initialize: boolean) {
    if (initialize) {
      await this.directories(this.directory);
      await this.publish(join(this.directory, "policy.json"), this.policy);
    }
    await this.safePath(this.directory);
    const lock = join(this.directory, ".writer.lock"), token = canonical({ pid: process.pid, token: randomUUID() });
    const started = this.monotonic();
    while (!(await attemptLockFile(lock, "native bar writer", token)).taken) {
      await this.safePath(lock, true);
      if (this.monotonic() - started >= (this.options.lockWaitMs ?? 1000)) throw new Error("store_lock_busy: charts not touched; no owner reclaimed");
      await new Promise((r) => setTimeout(r, 20));
    }
    try { return await work(); }
    finally { if (!releaseLockFileSync(lock, (s) => s === token)) throw new Error("store_lock_release_failed"); }
  }
  /** The collector rechecks the supplied guard after any chart-queue/lock wait, before native access. */
  async record(id: string, hash: string, confirm: boolean,
    captureFresh: (targets: NativeBarTargets, assertPlanActive: () => void) => Promise<NativeBarCapture>) {
    const plan = this.consume(id, hash, confirm, "record");
    const assertPlanActive = () => { if (this.monotonic() >= plan.deadline) throw new Error("plan_expired"); };
    return this.locked(async () => {
      const state = await this.load();
      if (state.generation !== plan.generation) throw new Error("store_changed: fresh preview required");
      assertPlanActive();
      if (this.clockQuality(state).status === "clock_ahead") throw new Error("clock_ahead: prepare_native_bar_clock_recovery or wait for clock; no charts touched");
      if (state.pairs.length >= 4096) throw new Error("committed_capture_limit: explicit maintenance decision required");
      const space = await statfs(this.directory);
      if (state.bytes + RESERVE + 2 * 1024 ** 2 > this.quota || Number(space.bavail) * Number(space.bsize) < RESERVE + 2 * 1024 ** 2) throw new Error("insufficient_capacity: no automatic deletion");
      const started = this.clock();
      assertPlanActive();
      const payload = nativeBarCaptureSchema.parse(await captureFresh(plan.targets!, assertPlanActive));
      const ended = this.clock(), last = state.pairs.at(-1)?.receipt.recorded_at;
      if (payload.capture_as_of < started || (last && payload.capture_as_of < last)
        || payload.series.some((s) => s.observed_at > ended) || ended < started) throw new Error("capture_clock_rollback_or_future");
      const payloadBytes = Buffer.byteLength(canonical(payload));
      if (payloadBytes > 1024 ** 2) throw new Error("capture_payload_limit");
      // Keep every committed batch readable by the same reader used for explicit maintenance.
      if (state.queryBytes + payloadBytes + 16384 > this.queryBytesLimit) {
        throw new Error("history_query_capacity: explicit maintenance decision required; no payload published");
      }
      const day = ended.slice(0, 10), paths = this.paths({ day, recording_id: plan.recording_id });
      await this.publish(paths.payload, payload);
      await this.options.testOnly?.afterPublish?.("payload");
      const recordedAt = this.clock();
      if (recordedAt < ended || recordedAt.slice(0, 10) !== day) throw new Error("clock_or_partition_changed: payload pending, not committed");
      const receipt: Receipt = { schema: "native-bar-receipt-v1", recording_id: plan.recording_id, day,
        sequence: state.maintenance.reduce((max, m) => m.pairs.reduce((n, p) => Math.max(n, p.sequence), max),
          state.pairs.reduce((n, p) => Math.max(n, p.receipt.sequence), 0)) + 1,
        plan_hash: hash, policy_hash: this.policyHash, payload_hash: evidenceHash(payload), recorded_at: recordedAt };
      await this.publish(paths.receipt, receipt);
      await this.options.testOnly?.afterPublish?.("receipt");
      const acknowledgedAt = this.clock();
      if (acknowledgedAt < recordedAt) throw new Error("acknowledgement_clock_rollback: check original recording status");
      return { status: "committed", receipt, acknowledged_at: acknowledgedAt, restoration_verified: true };
    }, true);
  }
  async status(recordingId: string) {
    nativeBarId.parse(recordingId);
    const state = await this.load(true);
    const removal = state.maintenance.find((m) => m.pairs.some((p) => p.recording_id === recordingId));
    const pair = state.pairs.find((p) => p.receipt.recording_id === recordingId);
    return { status: removal ? state.incomplete.includes(removal) ? "maintenance_incomplete" : removal.kind === "prune" ? "pruned" : "quarantined"
      : pair ? "committed" : state.files.some((p) => p.endsWith(`/${recordingId}.json`)) ? "pending" : "not_found",
      receipt: pair?.receipt ?? null, clock: this.clockQuality(state), store_status: state.missing ? "missing" : "initialized",
      storage_visibility_at_as_of: "not_proven" };
  }
  async history(input: Parameters<typeof projectNativeBarHistory>[1]) {
    const state = await this.load();
    const captures: AcceptedNativeCapture[] = state.pairs.map((p) => ({ ...p.receipt, capture: p.payload }));
    const result = { ...projectNativeBarHistory(captures, input, state.maintenance.some((m) => m.kind === "prune")),
      clock: this.clockQuality(state), coverage_generation: state.generation,
      quarantined_captures: state.maintenance.filter((m) => m.kind === "clock_recovery").reduce((n, m) => n + m.pairs.length, 0),
      store_status: state.missing ? "missing" : "existing" };
    if (Buffer.byteLength(canonical(result)) > 8 * 1024 ** 2) throw new Error("history_response_limit: narrow the query");
    return result;
  }
  private ref(pair: Pair) { return { recording_id: pair.receipt.recording_id, sequence: pair.receipt.sequence, day: pair.receipt.day,
    payload_hash: pair.receipt.payload_hash, receipt_hash: pair.receipt_hash, bytes: pair.bytes }; }
  async prepareMaintenance(kind: "prune" | "clock_recovery") {
    const state = await this.load(true), pending = state.incomplete;
    if (pending.length > 1 || (pending.length && pending[0].kind !== kind)) throw new Error("different_maintenance_incomplete");
    const cutoff = Date.parse(this.clock()) + (kind === "prune" ? -90 * DAY : 60000);
    const eligible = state.pairs.filter((p) => {
      const timestamp = Math.max(Date.parse(p.receipt.recorded_at), ...p.payload.series.map((s) => Date.parse(s.observed_at)));
      return kind === "prune" ? timestamp < cutoff : timestamp > cutoff;
    });
    const pairs = pending[0]?.pairs ?? (kind === "prune" ? eligible.slice(0, 1024) : eligible.slice(-1024)).map((p) => this.ref(p));
    return { ...this.issue(kind, state, { pairs, ...(pending[0] ? { resume_id: pending[0].id } : {}) }),
      bytes_affected: pairs.reduce((n, p) => n + p.bytes, 0), captures_remaining: state.pairs.length - (pending.length ? 0 : pairs.length),
      additional_eligible_batches: Math.max(0, eligible.length - pairs.length),
      affected_observations: state.pairs.filter((p) => pairs.some((r) => r.recording_id === p.receipt.recording_id)).map((p) => ({
        recording_id: p.receipt.recording_id, recorded_at: p.receipt.recorded_at,
        series: p.payload.series.map((s) => ({ symbol: s.symbol, timeframe: s.timeframe, series_context_id: s.series_context_id,
          observed_at: s.observed_at, bar_opens: s.bars.map((b) => b.bar_open_at) })),
      })),
      first_seen_effect: "affected identities may lose earliest/version evidence; no restamping or inferred boundary version",
      clock: this.clockQuality(state) };
  }
  async maintain(id: string, hash: string, confirm: boolean, kind: "prune" | "clock_recovery") {
    const plan = this.consume(id, hash, confirm, kind);
    const initial = await this.load(true);
    if (initial.missing || plan.pairs.length === 0) return { status: "nothing_to_do", affected: 0 };
    return this.locked(async () => {
      const state = await this.load(true);
      if (state.generation !== plan.generation || this.monotonic() >= plan.deadline) throw new Error("maintenance_plan_stale");
      const intent: Maintenance = plan.resume_id ? state.incomplete.find((m) => m.id === plan.resume_id)!
        : { schema: "native-bar-maintenance-v1", id: randomUUID(), kind, created_at: this.clock(), pairs: plan.pairs, generation: state.generation };
      if (!intent) throw new Error("maintenance_intent_missing");
      if (!plan.resume_id) {
        const cutoff = Date.parse(this.clock()) + (kind === "prune" ? -90 * DAY : 60000);
        for (const ref of plan.pairs) {
          const pair = state.pairs.find((p) => p.receipt.recording_id === ref.recording_id);
          if (!pair || canonical(this.ref(pair)) !== canonical(ref)) throw new Error("maintenance_evidence_changed");
          const stamp = Math.max(Date.parse(pair.receipt.recorded_at), ...pair.payload.series.map((s) => Date.parse(s.observed_at)));
          if (kind === "prune" ? stamp >= cutoff : stamp <= cutoff) throw new Error("maintenance_eligibility_changed");
        }
        if (state.maintenanceBytes + Buffer.byteLength(canonical(intent)) > this.maintenanceMetadataLimitBytes) {
          throw new Error("maintenance_metadata_capacity: explicit user decision required; no intent published");
        }
        await this.publish(join(this.directory, "maintenance", `${intent.id}.json`), intent);
      }
      for (const pair of intent.pairs) {
        const paths = this.paths(pair);
        for (const [label, path, expectedHash] of [["receipt", paths.receipt, pair.receipt_hash], ["payload", paths.payload, pair.payload_hash]] as const) {
          const destination = join(this.directory, "quarantine", intent.id, `${pair.recording_id}.${label}.json`);
          let value;
          try { value = await this.read(path); }
          catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT" || !plan.resume_id) throw e;
            if (kind === "clock_recovery" && evidenceHash(await this.read(destination)) !== expectedHash) throw new Error("quarantine_resume_mismatch");
            continue;
          }
          if (evidenceHash(value) !== expectedHash) throw new Error("maintenance_hash_mismatch");
          if (kind === "prune") await unlink(path);
          else {
            await this.directories(dirname(destination));
            // Exclusive link then unlink: no replacement of a pre-existing quarantine file.
            try { await link(path, destination); }
            catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "EEXIST" || !plan.resume_id
                || evidenceHash(await this.read(destination)) !== expectedHash) throw e;
            }
            await syncDirectoryEntry(dirname(destination));
            if (evidenceHash(await this.read(destination)) !== expectedHash) throw new Error("quarantine_readback_mismatch");
            await this.options.testOnly?.afterPublish?.("quarantine_linked");
            await unlink(path);
          }
          await syncDirectoryEntry(dirname(path));
          await this.options.testOnly?.afterPublish?.(`maintenance_${label}`);
        }
      }
      await this.publish(join(this.directory, "maintenance", `${intent.id}.done.json`), { id: intent.id, intent_hash: evidenceHash(intent) });
      return { status: "complete", kind, maintenance_id: intent.id, affected: intent.pairs.length };
    }, false);
  }
}
