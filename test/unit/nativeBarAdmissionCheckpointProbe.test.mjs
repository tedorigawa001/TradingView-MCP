import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { binding, publicKey } from "./helpers/checkpointProbeFixture.mjs";
import { enrollUnsignedCheckpointOracle } from "../helpers/unsignedCheckpointOracle.mjs";
const base = process.env.NATIVE_BAR_B3BA_ISOLATED_TEST === "1" ? "../../build/b3ba-validation/" : "../../build/";
const registry = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
const api = await import(new URL(`${base}nativeBarAdmissionCheckpointProbe.js`, import.meta.url));
const contracts = await import(new URL(`${base}nativeBarAdmissionCheckpointContracts.js`, import.meta.url));
let namespace = 100;
function setup(t, n, mode = "unavailable") {
  const b = registry.createSyntheticCheckpointOracleBootstrap(binding(n), publicKey()), owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment, mode);
  const session = api.enrollSyntheticCheckpointProbe(b.readerEnrollment);
  t.after(() => { owner.settlePending?.(); session.close(); owner.close(); b.close(); }); return { b, owner, session };
}
test("B3-Ba cancels an original query before dispatch and releases its active claim", () => {
  const b = registry.createSyntheticCheckpointOracleBootstrap(binding(20), publicKey());
  const owner = enrollUnsignedCheckpointOracle(b.ownerEnrollment), session = api.enrollSyntheticCheckpointProbe(b.readerEnrollment);
  const q = session.beginProbe();
  assert.throws(() => session.beginProbe(), /already_active/);
  const report = session.cancel(q);
  assert.equal(report.state, "released"); assert.equal(report.failure, "b3ba_cancelled"); assert.equal(report.requests_dispatched, 0);
  assert.equal(report.view_verified, false); assert.equal(report.checkpoint_requests_verified, false);
  const next = session.beginProbe(); session.cancel(next); session.close(); owner.close(); b.close();
});
test("B3-Ba unsigned bytes are rejected by B-1 without publishing any verified fact", async (t) => {
  const { session } = setup(t, ++namespace, "unsigned"), q = session.beginProbe();
  await assert.rejects(session.requestStart(q), /b3ba_checkpoint_refused/);
  const r = session.describe(q); assert.equal(r.state, "released"); assert.equal(r.ids_generated, 2); assert.equal(r.requests_dispatched, 1);
  for (const [key, value] of Object.entries(r)) if (/_verified$|_qualified$|_available$|_authenticated$|_enforced$/.test(key)) assert.equal(value, false, key);
  assert.ok(contracts.checkpointProbeDiagnosticSchema.safeParse(r).success);
  assert.equal(JSON.stringify(r).includes("/private/tmp"), false);
});
for (const mode of ["unsigned_decorated", "unsigned_shared", "unsigned_oversize"]) test(`B3-Ba refuses ${mode} before decoding`, async (t) => {
  const { session } = setup(t, ++namespace, mode), q = session.beginProbe();
  await assert.rejects(session.requestStart(q), /b3ba_response_bytes/);
  const r = session.describe(q); assert.equal(r.state, "released"); assert.equal(r.fixture_signature_verified, false);
});
test("B3-Ba exact metadata fit does not charge issued IDs twice", (t) => {
  const { b, session } = setup(t, ++namespace);
  const plan = contracts.planCheckpointProbeBudget({ binding: binding(namespace), retained_state_bytes: b.describe().retained_state_bytes });
  const q = session.beginProbe({ lower_limits: { metadata_bytes: Number(plan.used.metadata_bytes) } });
  session.cancel(q);
});
test("B3-Ba a lower active metadata ceiling also limits competing enrollment", (t) => {
  const { b, session } = setup(t, ++namespace);
  const plan = contracts.planCheckpointProbeBudget({ binding: binding(namespace), retained_state_bytes: b.describe().retained_state_bytes });
  const q = session.beginProbe({ lower_limits: { metadata_bytes: Number(plan.used.metadata_bytes) } });
  const other = binding(++namespace);
  assert.throws(() => registry.createSyntheticCheckpointOracleBootstrap(other, publicKey()), /state_budget/);
  session.cancel(q);
  const allowed = registry.createSyntheticCheckpointOracleBootstrap(other, publicKey()); allowed.close();
});
test("B3-Ba unconfirmed cancellation keeps the claim until the original unsigned operation settles", async (t) => {
  const { owner, session } = setup(t, 21, "pending_no_ack"), q = session.beginProbe();
  const request = session.requestStart(q), stopped = assert.rejects(request, /b3ba_cancelled/);
  const report = session.cancel(q);
  assert.equal(report.state, "release_unconfirmed"); assert.equal(report.pending_consumed, true); assert.equal(report.requests_dispatched, 1);
  assert.throws(() => session.beginProbe(), /already_active/);
  assert.equal(session.release(q).state, "release_unconfirmed");
  owner.settlePending(); await stopped; await new Promise((resolve) => setImmediate(resolve));
  const done = session.release(q); assert.equal(done.state, "released"); assert.equal(done.failure, "b3ba_cancelled");
  assert.equal(done.checkpoint_requests_verified, false); const next = session.beginProbe(); session.cancel(next);
});
for (const mode of ["unavailable", "pending_ack"]) test(`B3-Ba ${mode} settles with no verified result`, async (t) => {
  const { session } = setup(t, ++namespace, mode), q = session.beginProbe();
  const p = session.requestStart(q), rejection = assert.rejects(p, mode === "unavailable" ? /oracle_unavailable/ : /cancelled/);
  if (mode === "pending_ack") session.cancel(q); await rejection; await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.describe(q).state, "released"); assert.equal(session.describe(q).active_workspace_bytes, "0");
});
test("B3-Ba original handles and detached diagnostics cannot be forged or mutate state", async (t) => {
  const a = setup(t, ++namespace), b = setup(t, ++namespace), qa = a.session.beginProbe(), qb = b.session.beginProbe();
  for (const h of [structuredClone(qa), {}, a.session.describe(qa), qb]) {
    await assert.rejects(a.session.requestStart(h), /query_handle_required/); assert.throws(() => a.session.cancel(h), /query_handle_required/);
  }
  const r = a.session.describe(qa); r.last_observation.utc_at = "changed"; r.failure = "b3ba_fake";
  assert.equal(a.session.describe(qa).failure, null); a.session.cancel(qa); b.session.cancel(qb);
});
test("B3-Ba repeated start consumes the original pending request and never makes another", async (t) => {
  const { owner, session } = setup(t, ++namespace, "pending_no_ack"), q = session.beginProbe();
  const first = assert.rejects(session.requestStart(q), /phase_order/);
  await assert.rejects(session.requestStart(q), /phase_order/); await first;
  assert.equal(session.describe(q).requests_dispatched, 1); assert.equal(session.describe(q).state, "release_unconfirmed");
  owner.settlePending(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(session.release(q).state, "released");
});
for (const method of ["requestEnd", "finishProbe"]) test(`B3-Ba ${method} cannot bypass the missing signed path`, async (t) => {
  const { session } = setup(t, ++namespace), q = session.beginProbe();
  await assert.rejects(session[method](q, {}), /phase_order/); assert.equal(session.describe(q).state, "released");
  assert.equal(session.describe(q).checkpoint_requests_verified, false);
});
for (const close of ["owner", "session", "b"]) test(`B3-Ba ${close} close holds pending work until genuine settlement`, async (t) => {
  const s = setup(t, ++namespace, "pending_no_ack"), q = s.session.beginProbe(), p = assert.rejects(s.session.requestStart(q), /oracle_unavailable/);
  s[close].close(); await p; assert.equal(s.session.describe(q).revoked, true); assert.equal(s.session.release(q).state, "release_unconfirmed");
  s.owner.settlePending(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(s.session.release(q).state, "released");
  assert.throws(() => s.session.beginProbe(), /session_closed|oracle_unavailable/);
});
test("B3-Ba actual elapsed expiry rejects pending work without renewing its original window", async (t) => {
  const { owner, session } = setup(t, ++namespace, "pending_no_ack"), q = session.beginProbe({ ttl_ms: 30 });
  await assert.rejects(session.requestStart(q), /deadline|clock_relation_unavailable/);
  assert.equal(session.describe(q).state, "release_unconfirmed"); owner.settlePending();
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(session.release(q).state, "released");
});
for (const raw of [{ ttl_ms: 0 }, { ttl_ms: 600001 }, { ttl_ms: 1.5 }, { challenge: "user-selected" }, { clock: "user-selected" },
  { lower_limits: { metadata_bytes: 16777217 } }, { lower_limits: { read_bytes: "1" } }]) test(`B3-Ba refuses query options ${JSON.stringify(raw)}`, (t) => {
  const { session } = setup(t, ++namespace); assert.throws(() => session.beginProbe(raw), /b3ba_/);
  const q = session.beginProbe(); session.cancel(q);
});
test("B3-Ba preflight budget failure and accessors allocate no query ID or workspace", (t) => {
  const { b, session } = setup(t, ++namespace), before = b.describe();
  assert.throws(() => session.beginProbe({ lower_limits: { read_bytes: 1 } }), /budget/);
  let calls = 0; const raw = {}; Object.defineProperty(raw, "ttl_ms", { enumerable: true, get() { calls++; return 10; } });
  assert.throws(() => session.beginProbe(raw), /non_json/); assert.equal(calls, 0);
  assert.deepEqual(b.describe(), before);
});
test("B3-Ba pure budget preserves the joint schedule and strictly rejects hidden inputs", () => {
  const b = binding(++namespace), r = contracts.planCheckpointProbeBudget({ binding: b, retained_state_bytes: "0" });
  assert.equal(r.model_fits, true); assert.equal(r.schedule.native_inventory_passes, 6); assert.equal(r.schedule.content_passes, 5);
  assert.equal(r.checkpoint_requests_verified, false); assert.equal(r.capacity_verified, false);
  assert.throws(() => contracts.planCheckpointProbeBudget({ binding: b, retained_state_bytes: "0", inventory_passes: 1 }), /invalid_input/);
});
for (const key of ["entries", "inventory_bytes", "metadata_bytes", "read_bytes", "response_bytes"])
  test(`B3-Ba exact and one-over ${key} plan boundary`, () => {
    const input = { binding: binding(++namespace), retained_state_bytes: "0" };
    const plan = contracts.planCheckpointProbeBudget(input), lower_limits = { [key]: Number(plan.used[key]) };
    assert.equal(contracts.planCheckpointProbeBudget({ ...input, lower_limits }).model_fits, true);
    lower_limits[key]--; assert.equal(contracts.planCheckpointProbeBudget({ ...input, lower_limits }).model_fits, false);
  });
for (const scenario of ["equal_samples", "rng_throw", "rng_invalid", "rng_pin", "rng_challenge_reuse", "rng_old_challenge", "invalid_wall", "invalid_tick",
  "wall_rollback", "steady_rollback", "wall_deadline", "steady_deadline", "rollback_at_rejection", "state_exhaustion", "wall_throw", "steady_throw"])
  test(`B3-Ba isolated host-source fault: ${scenario}`, async () => {
    const worker = new Worker(new URL("./helpers/checkpointProbeHostFault.mjs", import.meta.url), { workerData: { scenario, base: new URL(base, import.meta.url).href } });
    let timer;
    try {
      const message = await new Promise((resolve, reject) => {
        worker.once("message", resolve); worker.once("error", reject); timer = setTimeout(() => reject(Error("host-fault worker deadline")), 5000);
      }); assert.equal(message.ok, true, message.message);
    } finally { clearTimeout(timer); await worker.terminate(); }
  });
