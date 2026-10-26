import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { binding, publicKey } from "./helpers/checkpointProbeFixture.mjs";
import { enrollFixedMemoryCheckpointOracle } from "../helpers/fixedMemoryCheckpointOracle.mjs";

// Like every other suite: the isolated build only when explicitly selected, so the standard unit run (and CI) uses build/.
const base = process.env.NATIVE_BAR_B3BC_ISOLATED_TEST === "1" ? "../../build/b3bc-validation/" : "../../build/";
const registry = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
const { enrollSyntheticCheckpointProbe } = await import(new URL(`${base}nativeBarAdmissionCheckpointProbe.js`, import.meta.url));
const contracts = await import(new URL(`${base}nativeBarAdmissionCheckpointContracts.js`, import.meta.url));
function setup(t, n, options) {
  const b = binding(n), bootstrap = registry.createSyntheticCheckpointOracleBootstrap(b, publicKey());
  const owner = enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment, { sequence: "1", tip_hash: b.registration.pins.enrollment_hash }, options);
  const session = enrollSyntheticCheckpointProbe(bootstrap.readerEnrollment);
  t.after(() => { owner.close(); session.close(); bootstrap.close(); }); return { b, bootstrap, owner, session };
}
test("B3-Bc authenticates two original requests and publishes only checkpoint-probe qualifications after cleanup", async (t) => {
  const { session, owner } = setup(t, 700), q = session.beginProbe();
  const c0 = await session.requestStart(q);
  assert.equal(session.describe(q).checkpoint_requests_verified, false);
  const c1 = await session.requestEnd(q, c0);
  assert.equal(session.describe(q).checkpoint_requests_verified, false);
  const report = await session.finishProbe(q, c1);
  assert.equal(report.schema, "native-bar-checkpoint-probe-result-v1");
  for (const k of ["fixture_signature_verified", "challenge_generation_verified", "actual_request_timing_verified", "checkpoint_requests_verified"]) assert.equal(report[k], true, k);
  for (const k of ["checkpoint_pair_verified", "view_verified", "native_bytes_verified", "authority_state_verified", "committed_history_available", "execution_available", "elapsed_clock_qualified"]) assert.equal(report[k], false, k);
  assert.equal(report.cleanup, "confirmed"); assert.equal(report.requests_dispatched, 2); assert.equal(report.authenticated_requests, 2);
  assert.equal(report.ids_generated, 3); assert.equal(report.active_workspace_bytes, "0");
  assert.equal(owner.describe().signed_requests, "2"); assert.equal(session.describe(q).checkpoint_requests_verified, false);
  const next = session.beginProbe(); session.cancel(next);
});
for (const [i, mode, error] of [[0, "changed_tip_at_c1", /changing/], [1, "replay_at_c1", /checkpoint_refused/], [2, "bad_signature_c1", /checkpoint_refused/]])
  test(`B3-Bc refuses ${mode} without aggregate qualifications`, async (t) => {
    const { session, owner } = setup(t, 710 + i, { mode }), q = session.beginProbe(), c0 = await session.requestStart(q);
    await assert.rejects(session.requestEnd(q, c0), error);
    const report = session.describe(q); assert.equal(report.checkpoint_requests_verified, false); assert.equal(report.authenticated_requests, 1);
    assert.equal(report.state, "released"); assert.equal(owner.describe().signed_requests, mode === "replay_at_c1" ? "1" : "2");
  });
for (const [i, kind] of ["copy", "plain", "query", "foreign"].entries()) test(`B3-Bc rejects ${kind} start handles and does not issue C1`, async (t) => {
  const a = setup(t, 720 + i), q = a.session.beginProbe(), c0 = await a.session.requestStart(q);
  const b = setup(t, 730 + i), qb = b.session.beginProbe(), foreign = await b.session.requestStart(qb);
  const handle = { copy: structuredClone(c0), plain: {}, query: q, foreign }[kind];
  await assert.rejects(a.session.requestEnd(q, handle), /checkpoint_handle_required/);
  assert.equal(a.owner.describe().signed_requests, "1"); assert.equal(a.session.describe(q).state, "released");
  assert.equal(b.session.describe(qb).failure, null); b.session.cancel(qb);
});
for (const [i, step] of ["before_c0", "after_c0", "wrong_end"].entries()) test(`B3-Bc cannot finish ${step}`, async (t) => {
  const { session } = setup(t, 740 + i), q = session.beginProbe(); let h = {};
  if (step !== "before_c0") h = await session.requestStart(q);
  if (step === "wrong_end") await session.requestEnd(q, h);
  await assert.rejects(session.finishProbe(q, h), /phase_order|checkpoint_handle_required/);
  assert.equal(session.describe(q).checkpoint_requests_verified, false); assert.equal(session.describe(q).state, "released");
});
test("B3-Bc a duplicate C0 after authentication invalidates the candidate without another request", async (t) => {
  const { session, owner } = setup(t, 750), q = session.beginProbe(); await session.requestStart(q);
  await assert.rejects(session.requestStart(q), /phase_order/); assert.equal(owner.describe().signed_requests, "1");
  assert.equal(session.describe(q).state, "released");
});
test("B3-Bc C1 cancellation retains the claim until original acknowledgement and cannot publish partial success", async (t) => {
  const { session, owner } = setup(t, 751, { mode: "hold_c1" }), q = session.beginProbe(), c0 = await session.requestStart(q);
  const stopped = assert.rejects(session.requestEnd(q, c0), /cancelled/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.cancel(q).state, "release_unconfirmed"); assert.throws(() => session.beginProbe(), /already_active/);
  await stopped; assert.equal(owner.describe().signed_requests, "1");
  owner.completePending(); await new Promise((resolve) => setImmediate(resolve));
  const r = session.release(q); assert.equal(r.state, "released"); assert.equal(r.authenticated_requests, 1); assert.equal(r.failure, "b3ba_cancelled");
  assert.equal(r.checkpoint_requests_verified, false); assert.equal(owner.describe().signed_requests, "1");
});
test("B3-Bc repeated C1 consumes pending work once and requires genuine cleanup", async (t) => {
  const { session, owner } = setup(t, 752, { mode: "hold_c1" }), q = session.beginProbe(), c0 = await session.requestStart(q);
  const first = assert.rejects(session.requestEnd(q, c0), /phase_order/);
  await assert.rejects(session.requestEnd(q, c0), /phase_order/); await first;
  assert.equal(session.describe(q).requests_dispatched, 2); owner.completePending();
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(session.release(q).state, "released");
});
for (const [i, source] of ["owner", "session", "bootstrap"].entries()) test(`B3-Bc ${source} loss after C0 withholds completion`, async (t) => {
  const s = setup(t, 760 + i), q = s.session.beginProbe(), c0 = await s.session.requestStart(q); s[source].close();
  await assert.rejects(s.session.requestEnd(q, c0), /query_terminal|oracle_unavailable/);
  assert.equal(s.session.describe(q).checkpoint_requests_verified, false); assert.equal(s.owner.describe().signed_requests, "1");
});
test("B3-Bc owner advancement invalidates authenticated C0 even before C1 dispatch", async (t) => {
  const s = setup(t, 763), q = s.session.beginProbe(), c0 = await s.session.requestStart(q);
  s.owner.advance({ sequence: "2", tip_hash: s.b.registration.pins.enrollment_hash });
  await assert.rejects(s.session.requestEnd(q, c0), /query_terminal|release_only/);
  assert.equal(s.session.describe(q).failure, "b3ba_oracle_changed"); assert.equal(s.owner.describe().signed_requests, "1");
});
test("B3-Bc synchronous event-loop stall cannot extend the original window after C1", async (t) => {
  const { session } = setup(t, 764), q = session.beginProbe({ ttl_ms: 1000 }), c0 = await session.requestStart(q), c1 = await session.requestEnd(q, c0);
  const until = process.hrtime.bigint() + 1050000000n; while (process.hrtime.bigint() < until) { /* Intentionally blocks timer delivery. */ }
  await assert.rejects(session.finishProbe(q, c1), /deadline/); assert.equal(session.describe(q).checkpoint_requests_verified, false);
});
test("B3-Bc completion is single-use and detached reports cannot become query/checkpoint/model handles", async (t) => {
  const { session, b } = setup(t, 765), q = session.beginProbe(), c0 = await session.requestStart(q), c1 = await session.requestEnd(q, c0);
  const r = await session.finishProbe(q, c1), original = structuredClone(r);
  assert.equal(contracts.checkpointProbeResultSchema.safeParse(r).success, true);
  await assert.rejects(session.finishProbe(q, c1), /query_terminal/);
  r.c0.challenge = "mutated"; r.checkpoint_requests_verified = false;
  assert.equal(session.describe(q).failure, null);
  const next = session.beginProbe(); await assert.rejects(session.requestEnd(next, original), /phase_order/);
  for (const handle of [r, c0, c1]) await assert.rejects(session.requestStart(handle), /query_handle_required/);
  const { createSyntheticAdmissionQueryProtocolModel } = await import(new URL(`${base}nativeBarAdmissionQueryProtocol.js`, import.meta.url));
  const model = createSyntheticAdmissionQueryProtocolModel({ ...b, schema: "native-bar-admission-query-model-registration-v1", scope: "synthetic_model_only" });
  for (const handle of [q, c0, c1, original]) assert.throws(() => model.describe(handle), /b3a_/);
  assert.doesNotMatch(JSON.stringify(original), /signature_hex|private_key|temp_anchor|fixture_name|\/private\//);
});
for (const [i, key] of ["entries", "inventory_bytes", "metadata_bytes", "read_bytes", "response_bytes"].entries())
  test(`B3-Bc completes at the planned ${key} boundary and refuses one less before dispatch`, async (t) => {
    const s = setup(t, 770 + i), before = s.bootstrap.describe();
    const p = contracts.planCheckpointProbeBudget({ binding: s.b, retained_state_bytes: before.retained_state_bytes });
    const exact = Number(p.used[key]); assert.throws(() => s.session.beginProbe({ lower_limits: { [key]: exact - 1 } }), /budget|invalid_input/);
    assert.equal(s.owner.describe().signed_requests, "0");
    const q = s.session.beginProbe({ lower_limits: { [key]: exact } }), c0 = await s.session.requestStart(q), c1 = await s.session.requestEnd(q, c0);
    const r = await s.session.finishProbe(q, c1); assert.equal(r.checkpoint_requests_verified, true);
    assert.equal(BigInt(r.retained_state_bytes) - BigInt(before.retained_state_bytes), 3n * 4096n);
    assert.ok(r.captured_response_bytes > 0 && r.captured_response_bytes <= 8192);
  });
for (const scenario of ["equal_samples", "c0_delivery_deadline", "c0_verification_deadline", "c0_retirement_deadline", "c0_verification_rollback",
  "c1_verification_deadline", "c1_verification_rollback", "c1_verification_steady", "finish_cleanup_deadline", "finish_publication_deadline",
  "finish_publication_rollback", "finish_publication_steady", "rng_pin_c1", "rng_reuse_c1"])
  test(`B3-Bc isolated source acceptance: ${scenario}`, async () => {
    const worker = new Worker(new URL("./helpers/checkpointCompletionHostFault.mjs", import.meta.url), { workerData: { scenario, base: new URL(base, import.meta.url).href } });
    let timer;
    try {
      const r = await new Promise((resolve, reject) => {
        worker.once("message", resolve); worker.once("error", reject); timer = setTimeout(() => reject(Error("completion worker deadline")), 10000);
      }); assert.equal(r.ok, true, r.message);
    } finally { clearTimeout(timer); await worker.terminate(); }
  });
test("B3-Bc an old checkpoint from the same session cannot authorize a later query", async (t) => {
  const { session } = setup(t, 780), oldQ = session.beginProbe(), oldC0 = await session.requestStart(oldQ); session.cancel(oldQ);
  const q = session.beginProbe(); await session.requestStart(q);
  await assert.rejects(session.requestEnd(q, oldC0), /checkpoint_handle_required/); assert.equal(session.describe(q).requests_dispatched, 1);
});
for (const [i, source] of ["owner", "session", "bootstrap"].entries()) test(`B3-Bc ${source} loss after C1 prevents final publication`, async (t) => {
  const s = setup(t, 781 + i), q = s.session.beginProbe(), c0 = await s.session.requestStart(q), c1 = await s.session.requestEnd(q, c0);
  s[source].close(); await assert.rejects(s.session.finishProbe(q, c1), /query_terminal/);
  const r = s.session.describe(q); assert.equal(r.authenticated_requests, 2); assert.equal(r.checkpoint_requests_verified, false);
});
for (const [i, first] of ["response", "cancel"].entries()) test(`B3-Bc same-turn C1 ${first}-first race preserves cancellation and original cleanup`, async (t) => {
  const { session, owner } = setup(t, 785 + i, { mode: "hold_c1" }), q = session.beginProbe(), c0 = await session.requestStart(q);
  const stopped = assert.rejects(session.requestEnd(q, c0), /cancelled/);
  await new Promise((resolve) => setImmediate(resolve));
  if (first === "response") owner.completePending(); session.cancel(q); if (first === "cancel") owner.completePending();
  await stopped; await new Promise((resolve) => setImmediate(resolve));
  const r = session.release(q); assert.equal(r.failure, "b3ba_cancelled"); assert.equal(r.state, "released"); assert.equal(r.authenticated_requests, 1);
  assert.equal(r.checkpoint_requests_verified, false); assert.equal(owner.describe().signed_requests, first === "response" ? "2" : "1");
});
test("B3-Bc held C1 expiry retains its claim without extending the window or signing late", async (t) => {
  const { session, owner } = setup(t, 787, { mode: "hold_c1" }), q = session.beginProbe({ ttl_ms: 200 }), c0 = await session.requestStart(q);
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    await assert.rejects(session.requestEnd(q, c0), /deadline|clock_relation_unavailable/);
    assert.equal(session.describe(q).state, "release_unconfirmed"); assert.throws(() => session.beginProbe(), /already_active/);
    owner.completePending(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(session.release(q).state, "released"); assert.equal(owner.describe().signed_requests, "1");
  } finally { clearTimeout(keepAlive); }
});
test("B3-Bc locally retires a cancelled owner-queued request without pulling or signing it", async (t) => {
  const { session, owner } = setup(t, 788, { mode: "defer_pull" }), q = session.beginProbe();
  const stopped = assert.rejects(session.requestStart(q), /cancelled/); session.cancel(q); await stopped;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.release(q).state, "released"); assert.equal(owner.describe().signed_requests, "0");
  const next = session.beginProbe(), ready = session.requestStart(next); owner.completePending(); await ready;
  assert.equal(owner.describe().signed_requests, "1"); session.cancel(next);
});
