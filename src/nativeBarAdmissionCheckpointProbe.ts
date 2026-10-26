import { randomUUID } from "node:crypto";
import { hrtime } from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { claimSyntheticCheckpointProbe } from "./nativeBarAdmissionOracleRegistry.js";
import { checkpointProbeNoAuthority, checkpointProbeRefuse, checkpointProbeParse, checkpointProbeOptionsSchema,
  checkpointProbeDiagnosticSchema, checkpointProbeResultSchema, planCheckpointProbeBudget } from "./nativeBarAdmissionCheckpointContracts.js";

const wallNow = Date.now, steadyNow = hrtime.bigint, generateUUID = randomUUID;
const HostDate = Date, iso = Date.prototype.toISOString;
type Sample = { utc_at: string; monotonic_before_ns: string; monotonic_after_ns: string };
function sample(): Sample {
  try {
    const before = steadyNow(), wall = wallNow(), after = steadyNow();
    if (typeof before !== "bigint" || typeof after !== "bigint" || before < 0n || after < before || after > 999999999999999999999999999999n
      || !Number.isSafeInteger(wall) || wall < 0 || wall > 253402300799999) checkpointProbeRefuse("clock_invalid");
    return { utc_at: iso.call(new HostDate(wall)), monotonic_before_ns: String(before), monotonic_after_ns: String(after) };
  } catch { checkpointProbeRefuse("clock_invalid"); }
}
type Claim = ReturnType<typeof claimSyntheticCheckpointProbe>;
type Checkpoint = { handle: object; challenge: string; sequence: string; tip_hash: string; observed_at: string; sent: Sample; received: Sample };
type Query = { id: string; start: Sample; last: Sample; ordinal: bigint; ttl: number; failure: string | null; state: "probe_started" | "c0_outstanding" | "c0_authenticated" | "c1_outstanding" | "c1_authenticated" | "finishing" | "releasing" | "release_unconfirmed" | "released";
  lease: { release(): boolean }; timer?: ReturnType<typeof setTimeout>; cap: bigint; ids: number; dispatched: number; consumed: boolean;
  authenticated: number; responseBytes: number; c0?: Checkpoint; c1?: Checkpoint;
  operation?: ReturnType<Claim["dispatch"]>; reject?: (e: Error) => void };
function coded(error: unknown) { return error instanceof Error && error.message.length <= 96 && /^b3ba_[a-z_]+$/.test(error.message) ? error.message : "b3ba_invalid_input"; }

export function enrollSyntheticCheckpointProbe(reader: object) {
  const claim = claimSyntheticCheckpointProbe(reader), queries = new WeakMap<object, Query>(); let closed = false;
  function lookup(t: object) { const q = queries.get(t); if (!q) checkpointProbeRefuse("query_handle_required"); return q; }
  function cleanup(q: Query) {
    if (q.timer) clearTimeout(q.timer); q.timer = undefined;
    if (q.operation && !q.operation.retired()) { q.state = "release_unconfirmed"; return false; }
    q.operation = undefined; q.state = q.lease.release() ? "released" : "release_unconfirmed";
    return q.state === "released";
  }
  function fail(q: Query, reason: string) {
    q.failure ??= reason; if (q.dispatched) q.consumed = true;
    q.reject?.(new Error(q.failure)); q.reject = undefined;
    if (q.state !== "release_unconfirmed") q.state = "releasing";
    q.operation?.cancel(); cleanup(q);
  }
  function observe(q: Query, cleanupOnly = false) {
    try {
      const now = sample(), wall = Date.parse(now.utc_at), steady = BigInt(now.monotonic_after_ns);
      const rollback = wall < Date.parse(q.last.utc_at) || BigInt(now.monotonic_before_ns) < BigInt(q.last.monotonic_after_ns);
      if (!rollback) q.last = now; q.ordinal++;
      if (rollback) checkpointProbeRefuse("clock_rollback");
      if (wall - Date.parse(q.start.utc_at) >= q.ttl || steady - BigInt(q.start.monotonic_before_ns) >= BigInt(q.ttl) * 1000000n) checkpointProbeRefuse("deadline");
    } catch (error) { fail(q, coded(error)); if (!cleanupOnly) throw error; }
  }
  function describe(q: Query) {
    const account = claim.accounting();
    return checkpointProbeDiagnosticSchema.parse({ ...checkpointProbeNoAuthority, schema: "native-bar-checkpoint-probe-diagnostic-v1",
      registration_hash: claim.binding.registration_hash, query_id: q.id, state: q.state, revoked: closed || claim.revoked(),
      failure: q.failure, cleanup: q.state === "released" ? "confirmed" : q.state === "release_unconfirmed" ? "unconfirmed" : "not_requested",
      first_observation: q.start, last_observation: q.last, event_ordinal: String(q.ordinal), requests_dispatched: q.dispatched, ids_generated: q.ids,
      pending_consumed: q.consumed, authenticated_requests: q.authenticated, captured_response_bytes: q.responseBytes,
      retained_state_bytes: String(account.retained), active_workspace_bytes: String(account.workspace) });
  }
  function work(q: Query) {
    if (q.state === "released") checkpointProbeRefuse("query_terminal");
    try {
      if (closed) checkpointProbeRefuse("session_closed"); claim.check();
      if (q.failure || q.state === "releasing" || q.state === "release_unconfirmed") checkpointProbeRefuse("release_only"); observe(q);
    } catch (error) { fail(q, coded(error)); throw new Error(coded(error)); }
  }
  function request(t: object, phase: "c0" | "c1", previous?: object): Promise<object> {
    let q: Query | undefined;
    return new Promise((resolve, reject) => {
      try {
        q = lookup(t); work(q);
        if (q.state !== (phase === "c0" ? "probe_started" : "c0_authenticated")) checkpointProbeRefuse("phase_order");
        if (phase === "c1" && previous !== q.c0?.handle) checkpointProbeRefuse("checkpoint_handle_required");
        q.reject = reject; let challenge: string;
        try { challenge = generateUUID(); } catch { checkpointProbeRefuse("rng_unavailable"); }
        claim.identifier(challenge, q.cap); q.ids++; observe(q);
        const { public_key_spki_sha256: _fingerprint, ...pins } = claim.binding.registration.pins;
        const wire = { schema: "native-bar-checkpoint-probe-request-v1", scope: "synthetic_checkpoint_probe_only", ...pins,
          registration_hash: claim.binding.registration_hash, authority_reference: claim.binding.registration.authority_reference,
          query_id: q.id, phase, challenge };
        q.state = phase === "c0" ? "c0_outstanding" : "c1_outstanding";
        const sent = q.last, op = claim.dispatch(wire); q.operation = op; q.dispatched++; q.consumed = false; const owned = q;
        op.promise.then((bytes) => {
          let checkpoint: Checkpoint | undefined;
          try {
            if (owned.failure) return; owned.consumed = true; work(owned);
            const copy = capture(bytes); owned.responseBytes += copy.byteLength; observe(owned); const received = owned.last;
            let verified: ReturnType<Claim["verifier"]["verifyCheckpoint"]>;
            try { verified = claim.verifier.verifyCheckpoint(copy, { challenge, sent_at: sent.utc_at, received_at: received.utc_at }); }
            catch { checkpointProbeRefuse("checkpoint_refused"); }
            work(owned);
            const c = verified.checkpoint;
            if (phase === "c1" && (c.sequence !== owned.c0?.sequence || c.tip_hash !== owned.c0.tip_hash)) checkpointProbeRefuse("changing");
            checkpoint = { handle: Object.freeze(Object.create(null) as object), challenge, sequence: c.sequence, tip_hash: c.tip_hash,
              observed_at: c.observed_at, sent, received }; owned.authenticated++;
          } catch (error) { fail(owned, coded(error)); }
          finally {
            op.retire();
            if (owned.failure) cleanup(owned);
            else if (!op.retired() || !checkpoint) fail(owned, "b3ba_release_unconfirmed");
            else {
              owned.operation = undefined;
              try {
                work(owned); owned[phase] = checkpoint; owned.state = phase === "c0" ? "c0_authenticated" : "c1_authenticated";
                owned.reject = undefined; resolve(checkpoint.handle);
              } catch (error) { fail(owned, coded(error)); }
            }
          }
        }, (error) => {
          owned.consumed = true;
          try { if (!owned.failure) { claim.check(); observe(owned); } fail(owned, coded(error)); }
          catch (failure) { fail(owned, coded(failure)); }
          finally { op.retire(); cleanup(owned); }
        });
      } catch (error) { if (q && q.state !== "released") fail(q, coded(error)); reject(new Error(coded(error))); }
    });
  }
  return Object.freeze({ beginProbe(raw: unknown = {}) {
    const start = sample(); if (closed) checkpointProbeRefuse("session_closed"); claim.check();
    const opts = checkpointProbeParse(checkpointProbeOptionsSchema, raw), account = claim.accounting();
    const plan = planCheckpointProbeBudget({ binding: claim.binding, retained_state_bytes: String(account.retained), ...(opts.lower_limits ? { lower_limits: opts.lower_limits } : {}) });
    if (!plan.model_fits) checkpointProbeRefuse("budget");
    const cap = BigInt(plan.limits.metadata_bytes!), bytes = BigInt(plan.used.metadata_bytes) - account.retained;
    let q: Query | undefined;
    const lease = claim.acquire(bytes, cap, (reason) => { if (q) fail(q, `b3ba_${reason}`); });
    try {
      let id: string; try { id = generateUUID(); } catch { checkpointProbeRefuse("rng_unavailable"); }
      claim.identifier(id, cap);
      q = { id, start, last: start, ordinal: 1n, ttl: opts.ttl_ms ?? 600000, failure: null, state: "probe_started", lease, cap, ids: 1, dispatched: 0, consumed: false, authenticated: 0, responseBytes: 0 };
      observe(q); const owned = q;
      const remaining = Math.min(owned.ttl - (Date.parse(owned.last.utc_at) - Date.parse(start.utc_at)), Number((BigInt(owned.ttl) * 1000000n - (BigInt(owned.last.monotonic_after_ns) - BigInt(start.monotonic_before_ns)) + 999999n) / 1000000n));
      owned.timer = setTimeout(() => { if (owned.state === "released") return; try { observe(owned); fail(owned, "b3ba_clock_relation_unavailable"); } catch { /* observe records cleanup. */ } }, Math.max(1, remaining));
      // Unreferenced: an abandoned probe must not keep the process alive until its deadline. Timeliness never depends on
      // this timer; every entry and completion samples the actual clocks.
      owned.timer.unref();
      const t = Object.freeze(Object.create(null) as object); queries.set(t, owned); return t;
    } catch (error) { lease.release(); throw new Error(coded(error)); }
  }, requestStart(t: object) { return request(t, "c0"); }, requestEnd(t: object, start?: object) { return request(t, "c1", start); },
  async finishProbe(t: object, end?: object) {
    const q = lookup(t);
    if (q.state === "released") checkpointProbeRefuse("query_terminal");
    try {
      work(q); if (q.state !== "c1_authenticated") checkpointProbeRefuse("phase_order");
      if (end !== q.c1?.handle) checkpointProbeRefuse("checkpoint_handle_required");
      if (q.operation || q.authenticated !== 2 || !q.c0 || !q.c1) checkpointProbeRefuse("phase_order");
      q.state = "finishing";
      const summary = ({ handle: _handle, ...c }: Checkpoint) => c;
      const report = checkpointProbeResultSchema.parse({ ...describe(q), schema: "native-bar-checkpoint-probe-result-v1",
        verification_scope: "authenticated_checkpoint_requests_only", state: "released", cleanup: "confirmed",
        fixture_signature_verified: true, challenge_generation_verified: true, actual_request_timing_verified: true, checkpoint_requests_verified: true,
        completed_at: q.last.utc_at, c0: summary(q.c0), c1: summary(q.c1) });
      claim.check(); observe(q); q.state = "releasing";
      if (!cleanup(q)) checkpointProbeRefuse("release_unconfirmed");
      claim.check(); observe(q);
      report.last_observation = { ...q.last }; report.completed_at = q.last.utc_at; report.event_ordinal = String(q.ordinal);
      const account = claim.accounting(); report.retained_state_bytes = String(account.retained); report.active_workspace_bytes = String(account.workspace);
      return report;
    } catch (error) { fail(q, coded(error)); throw new Error(coded(error)); }
  }, cancel(t: object) { const q = lookup(t); if (q.state !== "released") { observe(q, true); fail(q, "b3ba_cancelled"); } return describe(q); },
    release(t: object) { const q = lookup(t); if (q.state !== "released") { observe(q, true); fail(q, "b3ba_release_order"); } return describe(q); },
    describe(t: object) { const q = lookup(t); if (q.state !== "released") { if (claim.revoked()) fail(q, "b3ba_oracle_unavailable"); observe(q, true); } return describe(q); },
    close() { if (!closed) { closed = true; claim.close(); } },
  });
}

const typed = Object.getPrototypeOf(Uint8Array.prototype), lengthOf = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!, bufferOf = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
const arrayLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
function capture(value: Uint8Array) {
  try {
    const length = lengthOf.call(value); arrayLength.call(bufferOf.call(value));
    if (!(value instanceof Uint8Array) || ![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(value)) || length > 4096
      || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key))) checkpointProbeRefuse("response_bytes");
    const copy = Buffer.alloc(length); Uint8Array.prototype.set.call(copy, value); return copy;
  } catch { checkpointProbeRefuse("response_bytes"); }
}
