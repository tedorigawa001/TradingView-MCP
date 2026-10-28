import test from "node:test";
import assert from "node:assert/strict";
import crypto, { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import child from "node:child_process";
import workers from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";

const effects = [], restores = [];
function replace(object, name, fn) { const original = object[name]; object[name] = fn; restores.push(() => { object[name] = original; }); }
function forbid(object, names) { for (const name of names) replace(object, name, () => { effects.push(name); throw Error("cc1b_effect_forbidden"); }); }
forbid(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
forbid(workers, ["Worker"]);
forbid(crypto, ["sign", "createSign", "createPrivateKey", "createPublicKey", "generateKeyPair", "generateKeyPairSync"]);
forbid(process, ["dlopen"]);
const mutating = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename", "chmod", "symlink", "link", "utimes"];
forbid(fs, [...mutating.map((name) => `${name}Sync`), ...mutating, "createWriteStream"]);
forbid(fsp, mutating);
// Module source reads stay allowed under the helper/node_modules roots, also at their real paths (a symlinked node_modules
// loads by real path) and through fs.promises (an async ESM loader reads that way); every other read or write open refuses.
const roots = ["../helpers/", "../../node_modules/"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
roots.push(...roots.map((root) => fs.realpathSync(root) + sep));
const readFlag = (options) => typeof options === "object" && options !== null ? options.flag : undefined;
const readable = (path, flags) => {
  const p = resolve(path instanceof URL ? fileURLToPath(path) : String(path));
  return (flags === undefined || flags === "r" || flags === 0) && roots.some((root) => p.startsWith(root));
};
for (const [object, name, flags] of [[fs, "openSync", (a) => a[0]], [fs, "open", (a) => typeof a[0] === "function" ? undefined : a[0]],
  [fs, "readFileSync", (a) => readFlag(a[0])], [fsp, "open", (a) => a[0]], [fsp, "readFile", (a) => readFlag(a[0])]]) {
  const original = object[name];
  replace(object, name, (path, ...args) => {
    if (readable(path, flags(args))) return original.call(object, path, ...args);
    effects.push(name); throw Error("cc1b_read_forbidden");
  });
}
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach((restore) => restore()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });
const api = await import("../helpers/unsignedExecutionContracts.mjs");
const original = await import("../helpers/jointUnsignedAcceptanceContracts.mjs");

const h = (v) => createHash("sha256").update(v).digest("hex");
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = (case_id = "u1-unsigned", mode = "normal") => ({ request: {
  schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run",
  source_commit: "a".repeat(40), patch_sha256: "b".repeat(64) }, case_id, mode,
  fixture_name: "native-bar-fs-synthetic-Ab123Z",
  ids: Object.fromEntries(["fixture", "store", "epoch", "authority", "key", "reference", "extra"].map((s, n) => [s, id(n + 1)])) });
const declaration = (case_id, mode) => ({ fixture: fixture(case_id, mode), exchange_id: "exchange-1", provenance: {
  js_sha256: "c".repeat(64), addon_sha256: "d".repeat(64), observer_sha256: "e".repeat(64),
  registration_sha256: "f".repeat(64), envelope_sha256: "0".repeat(64) } });
function allocation(d = declaration()) {
  const { fixture_name, ...f } = d.fixture;
  const { registration_sha256, envelope_sha256, ...provenance } = d.provenance;
  return { fixture: f, exchange_id: d.exchange_id, supervisor_id: "supervisor-1", worker_id: "worker-1", provenance };
}

test("C-C1b-1's tripwire refuses mutation, signing and reads outside module roots", async () => {
  const before = effects.length, probe = "/nonexistent-cc1b-probe/x";
  for (const name of mutating) {
    assert.throws(() => fs[`${name}Sync`](probe, probe), /cc1b_effect_forbidden/, `${name}Sync`);
    assert.throws(() => fs[name](probe, probe, () => {}), /cc1b_effect_forbidden/, name);
    assert.throws(() => fsp[name](probe, probe), /cc1b_effect_forbidden/, `promises.${name}`);
  }
  assert.throws(() => fs.createWriteStream(probe), /cc1b_effect_forbidden/);
  assert.throws(() => crypto.createSign("sha256"), /cc1b_effect_forbidden/);
  for (const read of [() => fs.readFileSync(probe), () => fs.openSync(probe, "r"), () => fsp.readFile(probe), () => fsp.open(probe, "r"),
    () => fs.openSync(fileURLToPath(new URL("../helpers/unsignedExecutionContracts.mjs", import.meta.url)), "w")])
    assert.throws(read, /cc1b_read_forbidden/);
  effects.splice(before);
});
test("C-C1b-1 reserves receipts before creation and keeps observer work separate and unqualified", () => {
  const p = api.describeUnsignedExecutionCapacity({ owned_entries: 9, depth: 3, content_bytes: 131072 });
  assert.equal(p.receipt_reserved_records, 52);
  assert.equal(p.receipt_record_bytes, 16384);
  assert.equal(p.observer_nodes, 12);
  assert.equal(p.observer_acl_bytes, 12 * 2 * 65536);
  assert.equal(p.observer_content_bytes, 262144);
  assert.equal(p.observer_remaining_metadata_bytes, 4194304 - p.observer_acl_bytes - 262144 - 65536);
  assert.equal(p.observer_algorithm_verified, false);
  assert.equal(p.native_budget_changed, false);
  assert.equal(p.execution_available, false);
  assert.equal(p.native_status, "NOT_RUN");
  assert.equal(api.describeUnsignedExecutionCapacity({ owned_entries: 12, depth: 3, content_bytes: 0 }).receipt_reserved_records, 64);
  assert.throws(() => api.describeUnsignedExecutionCapacity({ owned_entries: 13, depth: 3, content_bytes: 0 }), /cc1b_receipt_capacity/);
  assert.throws(() => api.describeUnsignedExecutionCapacity({ owned_entries: 16, depth: 3, content_bytes: 0 }), /cc1b_receipt_capacity/);
});

const resources = () => ({ fds: "2", roots: "1", workspace: "4096", retained: "65536" });
function wire(model, kind, payload, direction = "parent", ordinal) {
  const d = model.describe();
  return canonical({ binding: d.binding, direction, ordinal: ordinal ?? d.next_ordinals[direction], kind, payload }) + "\n";
}
function prepared(model) {
  model.acceptFrame(wire(model, "PREPARE", {}));
  model.acceptFrame(wire(model, "BASELINED", { resources: resources(), clock_domain: "worker-1" }, "worker"));
}
const go = (m) => m.acceptFrame(wire(m, "GO", { baseline_sha256: m.describe().baseline_sha256,
  baseline_readback: true, go_intent_readback: true }));
function released(m, changes = {}) {
  const d = m.describe();
  return { baseline_sha256: d.baseline_sha256, resources: resources(), query: "settled", native: "settled",
    original_operation_retired: true, query_released: true, close_errors: [], diagnostic_sha256: "1".repeat(64),
    trace_chunks: d.trace_chunks, trace_events: d.trace_events, trace_sha256: d.trace_sha256,
    primary_code: "b3cb_record_refused", requests_dispatched: 1, authenticated_requests: 1,
    c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null, ...changes };
}
const torn = { decision: "removed", receipt_readback: true, anchor_same: true, root_removal_confirmed: true, absent: true };
function releasedModel() { const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m); m.acceptFrame(wire(m, "RELEASED", released(m), "worker")); return m; }
test("C-C1b-1 binds the original baseline before GO and models release/teardown/exit without authority", () => {
  const input = declaration(), m = api.createUnsignedExecutionProtocolModel(input);
  input.provenance.addon_sha256 = "9".repeat(64);
  assert.equal(m.describe().binding.addon_sha256, "d".repeat(64));
  prepared(m); const baselineHash = m.describe().baseline_sha256;
  assert.equal(m.describe().state, "BASELINED"); go(m);
  assert.equal(m.describe().retain, true);
  m.acceptFrame(wire(m, "RELEASED", released(m, { resources: { ...resources(), retained: "131072" } }), "worker"));
  assert.equal(m.describe().baseline_sha256, baselineHash);
  assert.equal(m.describe().state, "RELEASED"); assert.equal(m.describe().retain, false);
  m.finishTeardown(torn);
  m.acceptFrame(wire(m, "FINALIZE", {})); m.workerExit({ exit_code: 0, signal: null });
  assert.equal(m.describe().state, "DONE");
  assert.deepEqual(m.describe().worker_exit, { exit_code: 0, signal: null });
  assert.equal(m.describe().model_status, "consistent_supplied_lifecycle");
  assert.equal(m.describe().native_status, "NOT_RUN");
  assert.equal(m.describe().native_release_verified, false);
  assert.equal(m.describe().cleanup_execution_available, false);
});

for (const [name, change, error] of [
  ["changed original baseline", (p) => { p.resources.fds = "0"; }, "resources_changed"],
  ["workspace drift", (p) => { p.resources.workspace = "0"; }, "resources_changed"],
  ["root drift", (p) => { p.resources.roots = "2"; }, "resources_changed"],
  ["lower retained state", (p) => { p.resources.retained = "0"; }, "resources_changed"],
  ["another baseline", (p) => { p.baseline_sha256 = "9".repeat(64); }, "baseline_changed"],
  ["unconfirmed release", (p) => { p.query = "unconfirmed"; }, "release_unconfirmed"],
  ["unreleased query", (p) => { p.query_released = false; }, "release_unconfirmed"],
  ["invented never-started native", (p) => { p.native = "never_started"; }, "release_unconfirmed"],
  ["failed close", (p) => { p.close_errors = ["close_failed"]; }, "release_unconfirmed"],
  ["unretired original operation", (p) => { p.original_operation_retired = false; }, "release_unconfirmed"],
  ["missing trace chunk", (p) => { p.trace_chunks = 1; }, "trace_binding"],
  ["missing trace event", (p) => { p.trace_events = 1; }, "trace_binding"],
  ["another trace", (p) => { p.trace_sha256 = "9".repeat(64); }, "trace_binding"],
  ["a C1 dispatch", (p) => { p.requests_dispatched = 2; p.authenticated_requests = 2; }, "request_count"],
  ["authentication without dispatch", (p) => { p.requests_dispatched = 0; }, "request_count"],
  ["invented exact transport time", (p) => { p.retired_at = "123"; }, "invalid_input"],
]) test(`C-C1b-1 retains on ${name} and cannot reset with later good data`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  const p = released(m); change(p);
  assert.throws(() => m.acceptFrame(wire(m, "RELEASED", p, "worker")), { message: `cc1b_${error}` });
  assert.equal(m.describe().stop_reason, error);
  assert.equal(m.describe().retain, true);
  // A refused packet is kept apart from the accepted result.
  assert.equal(m.describe().result, null);
  if (error !== "invalid_input") assert.equal(m.describe().rejected_release.query, p.query);
  assert.throws(() => m.acceptFrame(wire(m, "RELEASED", released(m), "worker")), /cc1b_stopped/);
  assert.equal(m.describe().stop_reason, error);
});

const stamp = (n) => ({ clock_domain: "parent-1", monotonic_ns: String(n),
  wall_utc: "2026-10-28T01:00:00.000Z", wall_jst: "2026-10-28T10:00:00.000+09:00" });
test("C-C1b-1 binds a report to its confirmed receipt prefix, then terminal and index without circular hashes", () => {
  const d = allocation(), e = api.createUnsignedExecutionEvidenceModel(d), lines = []; let tick = 0;
  const add = (kind, payload) => {
    const record = e.append({ kind, payload, stamp: stamp(++tick) });
    assert.equal(e.describe().pending_readback, "receipt");
    lines.push(record.line); e.confirmReceipt(record.line); return record;
  };
  add("case_allocated", {});
  add("stop_summary", { reason: "model_preflight_refused" });
  add("ready_to_report", { outcome: "NOT_RUN" });
  const report = e.createReport({ limitations: ["memory_only"], save_stamp: stamp(++tick) });
  assert.equal(JSON.parse(report.line).receipt_prefix_sha256, JSON.parse(lines.at(-1)).event_hash);
  e.confirmReport(report.line);
  add("terminal", { report_sha256: report.sha256 });
  const index = e.createIndex(); e.confirmIndex(index.line);
  assert.equal(JSON.parse(index.line).terminal_receipt_sha256, JSON.parse(lines.at(-1)).event_hash);
  assert.equal(JSON.parse(index.line).report_sha256, report.sha256);
  assert.equal(e.describe().evidence_saved, false);
  assert.equal(e.describe().model_status, "consistent_supplied_evidence");
  const replay = api.inspectUnsignedExecutionEvidence({ allocation: d, expected_declaration: null, receipt_lines: lines, report_line: report.line, index_line: index.line });
  assert.equal(replay.model_status, "consistent_supplied_evidence");
  assert.equal(replay.native_status, "NOT_RUN");
  assert.equal(replay.evidence_saved, false);
});

test("C-C1b-1 models only the remaining original phase window, never a fresh observer/read deadline", () => {
  const input = { phase: "query", limit_ms: 600000, started: { clock_domain: "worker-1", monotonic_ns: "1000000" },
    observed: { clock_domain: "worker-1", monotonic_ns: "599001000000" } };
  assert.equal(api.describeUnsignedExecutionWindow(input).observer_window_ms, 1000);
  assert.equal(api.describeUnsignedExecutionWindow({ ...input, observed: { ...input.observed, monotonic_ns: "1000000" } }).observer_window_ms, 10000);
  input.observed.monotonic_ns = "600001000000";
  assert.equal(api.describeUnsignedExecutionWindow(input).decision, "STOP_RETAIN");
  assert.equal(api.describeUnsignedExecutionWindow(input).termination_available, false);
  assert.throws(() => api.describeUnsignedExecutionWindow({ ...input, limit_ms: 600001 }), /cc1b_window_bound/);
  assert.throws(() => api.describeUnsignedExecutionWindow({ ...input, phase: "preparation", limit_ms: 120001 }), /cc1b_window_bound/);
  assert.throws(() => api.describeUnsignedExecutionWindow({ ...input, phase: "settlement", limit_ms: 60001 }), /cc1b_window_bound/);
  assert.throws(() => api.describeUnsignedExecutionWindow({ ...input, observed: { ...input.observed, clock_domain: "parent-1" } }), /cc1b_clock_domain/);
  assert.throws(() => api.describeUnsignedExecutionWindow({ ...input, observed: { ...input.observed, monotonic_ns: "0" } }), /cc1b_clock_rollback/);
});
test("C-C1b-1 stops instead of handing out a zero-length observer window", () => {
  const w = api.describeUnsignedExecutionWindow({ phase: "query", limit_ms: 1, started: { clock_domain: "w", monotonic_ns: "0" },
    observed: { clock_domain: "w", monotonic_ns: "500000" } });
  assert.equal(w.decision, "STOP_RETAIN"); assert.equal(w.observer_window_ms, 0); assert.equal(w.remaining_ns, "500000");
});

const event = (n, changes = {}) => ({ ordinal: n, api: "info", edge: "end", clock_domain: "worker-1", monotonic_ns: String(n),
  code: null, byte_count: "0", sha256: null, ...changes });
test("C-C1b-1 transfers the full 128-event trace as eight bound chunks, not one oversized diagnostic", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m); const trace = [];
  for (let chunk_index = 0; chunk_index < 8; chunk_index++) {
    const events = Array.from({ length: 16 }, (_, n) => event(trace.length + n + 1)); trace.push(...events);
    m.acceptFrame(wire(m, "TRACE_CHUNK", { chunk_index, events }, "worker"));
  }
  assert.equal(m.describe().trace_events, 128); assert.equal(m.describe().trace_sha256, h(canonical(trace)));
  m.acceptFrame(wire(m, "RELEASED", released(m), "worker"));
  assert.equal(m.describe().frames, 12);
});
for (const [name, change] of [
  ["wrong chunk index", (p) => { p.chunk_index = 1; }],
  ["missing event", (p) => { p.events[0].ordinal = 2; }],
  ["foreign clock domain", (p) => { p.events[0].clock_domain = "parent-1"; }],
  ["raw arguments", (p) => { p.events[0].arguments = ["secret"]; }],
  ["seventeen events", (p) => { p.events = Array.from({ length: 17 }, (_, n) => event(n + 1)); }],
]) test(`C-C1b-1 stops for trace ${name}`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  const p = { chunk_index: 0, events: [event(1)] }; change(p);
  assert.throws(() => m.acceptFrame(wire(m, "TRACE_CHUNK", p, "worker")), /cc1b_/);
  assert.equal(m.describe().retain, true);
});
test("C-C1b-1 adds no event from a refused trace chunk", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  assert.throws(() => m.acceptFrame(wire(m, "TRACE_CHUNK", { chunk_index: 0, events: [event(1), event(3)] }, "worker")), { message: "cc1b_trace_order" });
  assert.equal(m.describe().trace_events, 0); assert.equal(m.describe().trace_chunks, 0);
});
test("C-C1b-1 cannot replace or roll back the worker clock after a trace chunk", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  m.acceptFrame(wire(m, "TRACE_CHUNK", { chunk_index: 0, events: [event(1, { monotonic_ns: "10" })] }, "worker"));
  assert.throws(() => m.acceptFrame(wire(m, "TRACE_CHUNK", { chunk_index: 1, events: [event(2)] }, "worker")), /cc1b_trace_order/);
});
const finalized = (m) => { m.finishTeardown(torn); m.acceptFrame(wire(m, "FINALIZE", {})); };
for (const [name, act, code] of [
  ["GO before baseline", (m) => go(m), "invalid_input"],
  ["a hashed GO before baseline", (m) => m.acceptFrame(wire(m, "GO", { baseline_sha256: "9".repeat(64), baseline_readback: true, go_intent_readback: true })), "protocol_order"],
  ["GO for another baseline", (m) => { prepared(m); m.acceptFrame(wire(m, "GO", { baseline_sha256: "9".repeat(64), baseline_readback: true, go_intent_readback: true })); }, "baseline_changed"],
  ["duplicate PREPARE", (m) => { prepared(m); m.acceptFrame(wire(m, "PREPARE", {})); }, "protocol_order"],
  ["duplicate baseline", (m) => { prepared(m); m.acceptFrame(wire(m, "BASELINED", { resources: resources(), clock_domain: "worker-1" }, "worker")); }, "protocol_order"],
  ["duplicate GO", (m) => { prepared(m); go(m); go(m); }, "protocol_order"],
  ["FINALIZE without teardown", (m) => { prepared(m); go(m); m.acceptFrame(wire(m, "RELEASED", released(m), "worker")); m.acceptFrame(wire(m, "FINALIZE", {})); }, "teardown_unconfirmed"],
  ["worker exit as release", (m) => { prepared(m); go(m); m.workerExit({ exit_code: 0, signal: null }); }, "worker_lost"],
  ["signal as release", (m) => m.workerExit({ exit_code: null, signal: "SIGKILL" }), "worker_lost"],
  ["a crash while active", (m) => { prepared(m); go(m); m.workerExit({ exit_code: null, signal: "SIGSEGV" }); }, "worker_lost"],
  ["a failed exit after finalization", (m) => { prepared(m); go(m); m.acceptFrame(wire(m, "RELEASED", released(m), "worker")); finalized(m); m.workerExit({ exit_code: 1, signal: null }); }, "worker_lost"],
]) test(`C-C1b-1 rejects ${name} with ${code}`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration());
  assert.throws(() => act(m), { message: `cc1b_${code}` }); assert.equal(m.describe().retain, true); assert.equal(m.describe().stop_reason, code);
});
test("C-C1b-1 keeps a crash signal from any state as worker loss", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  assert.throws(() => m.workerExit({ exit_code: null, signal: "SIGSEGV" }), { message: "cc1b_worker_lost" });
  assert.equal(m.describe().worker_exit.signal, "SIGSEGV"); assert.equal(m.describe().native_release_verified, false);
});
for (const [name, change] of [["a retained tree", (t) => { t.decision = "retained"; }], ["no receipt readback", (t) => { t.receipt_readback = false; }],
  ["a changed anchor", (t) => { t.anchor_same = false; }], ["an unconfirmed root removal", (t) => { t.root_removal_confirmed = false; }],
  ["no absence", (t) => { t.absent = false; }]]) test(`C-C1b-1 refuses teardown with ${name}`, () => {
  const m = releasedModel(), t = { ...torn }; change(t);
  assert.throws(() => m.finishTeardown(t), { message: "cc1b_teardown_unconfirmed" }); assert.equal(m.describe().retain, true);
});
test("C-C1b-1 refuses a second exit after completion", () => {
  const m = releasedModel(); finalized(m); m.workerExit({ exit_code: 0, signal: null });
  assert.throws(() => m.workerExit({ exit_code: 0, signal: null }), { message: "cc1b_protocol_order" });
});
for (const [name, mutate] of [
  ["mode", (f) => { f.binding.mode = "ubsan"; }],
  ["source", (f) => { f.binding.source_commit = "9".repeat(40); }],
  ["registration", (f) => { f.binding.registration_sha256 = "9".repeat(64); }],
  ["exchange", (f) => { f.binding.exchange_id = "other"; }],
  ["ordinal", (f) => { f.ordinal = 2; }],
  ["direction", (f) => { f.direction = "worker"; }],
  ["unknown field", (f) => { f.token = "not-approval"; }],
  ["signature payload", (f) => { f.payload.signature = "never-permitted"; }],
]) test(`C-C1b-1 refuses changed ${name} on a protocol frame`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()), f = JSON.parse(wire(m, "PREPARE", {})); mutate(f);
  assert.throws(() => m.acceptFrame(canonical(f) + "\n"), /cc1b_/); assert.equal(m.describe().retain, true);
});
for (const name of ["worker_lost", "observer_lost", "observer_timeout", "identity_changed", "receipt_failed", "source_changed",
  "deadline_exceeded", "unexpected_output", "supervisor_lost"]) test(`C-C1b-1 latches ${name} before any query and exposes no cleanup`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration());
  assert.throws(() => m.observeFailure({ reason: name }), new RegExp(`cc1b_${name}`));
  assert.equal(m.describe().baseline, null); assert.equal(m.describe().stop_reason, name);
  assert.equal(m.describe().cleanup_execution_available, false);
  assert.throws(() => prepared(m), /cc1b_stopped/);
});
test("C-C1b-1 rejects oversized frames before parsing and rejects duplicate keys/noncanonical framing", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()), saved = JSON.parse; let calls = 0;
  try {
    JSON.parse = () => { calls++; throw Error("must_not_parse"); };
    assert.throws(() => m.acceptFrame("{".repeat(65537)), /cc1b_frame_bound/);
    assert.equal(calls, 0);
  } finally { JSON.parse = saved; }
  for (const transform of [(s) => s.trimEnd(), (s) => s + "\n", (s) => ` ${s}`,
    (s) => s.replace('"direction":"parent"', '"direction":"worker","direction":"parent"')]) {
    const fresh = api.createUnsignedExecutionProtocolModel(declaration());
    assert.throws(() => fresh.acceptFrame(transform(wire(fresh, "PREPARE", {}))), /cc1b_frame_encoding/);
  }
});
test("C-C1b-1 keeps cancel tied to the active original query and never renews it", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  m.acceptFrame(wire(m, "CANCEL", {})); assert.equal(m.describe().cancelled, true);
  assert.throws(() => m.acceptFrame(wire(m, "CANCEL", {})), /cc1b_duplicate_cancel/);
});

function evidencePrefix() {
  const d = allocation(), e = api.createUnsignedExecutionEvidenceModel(d), lines = []; let tick = 0;
  const add = (kind, payload) => { const r = e.append({ kind, payload, stamp: stamp(++tick) }); lines.push(r.line); e.confirmReceipt(r.line); return r; };
  add("case_allocated", {}); add("stop_summary", { reason: "invented_stop" });
  return { e, d, lines, add, nextStamp: () => stamp(++tick) };
}
function savedEvidence() {
  const p = evidencePrefix(); p.add("ready_to_report", { outcome: "FAIL" });
  const report = p.e.createReport({ limitations: ["invented_no_io"], save_stamp: p.nextStamp() }); p.e.confirmReport(report.line);
  p.add("terminal", { report_sha256: report.sha256 }); const index = p.e.createIndex(); p.e.confirmIndex(index.line);
  return { allocation: p.d, expected_declaration: null, receipt_lines: p.lines, report_line: report.line, index_line: index.line };
}
for (const [name, mutate, code] of [
  ["missing receipt", (d) => { d.receipt_lines.splice(1, 1); }, "evidence_order"],
  ["reordered receipt", (d) => { [d.receipt_lines[0], d.receipt_lines[1]] = [d.receipt_lines[1], d.receipt_lines[0]]; }, "evidence_order"],
  ["duplicate receipt", (d) => { d.receipt_lines.splice(1, 0, d.receipt_lines[0]); }, "evidence_order"],
  ["modified receipt hash", (d) => { const e = JSON.parse(d.receipt_lines[1]); e.event_hash = "9".repeat(64); d.receipt_lines[1] = canonical(e) + "\n"; }, "receipt_binding"],
  ["different report outcome", (d) => { const r = JSON.parse(d.report_line); r.outcome = "MODEL_CONSISTENT"; d.report_line = canonical(r) + "\n"; }, "report_binding"],
  ["saved-file claim", (d) => { const r = JSON.parse(d.report_line); r.evidence_saved = true; d.report_line = canonical(r) + "\n"; }, "report_binding"],
  ["raw signature", (d) => { const r = JSON.parse(d.report_line); r.signature = "forbidden"; d.report_line = canonical(r) + "\n"; }, "report_binding"],
  ["wrong index", (d) => { const r = JSON.parse(d.index_line); r.report_sha256 = "9".repeat(64); d.index_line = canonical(r) + "\n"; }, "index_binding"],
  ["another run", (d) => { d.allocation.fixture.request.run_id = "other-run"; }, "receipt_binding"],
  ["report self-reference", (d) => { const r = JSON.parse(d.report_line); r.terminal_receipt_sha256 = "9".repeat(64); d.report_line = canonical(r) + "\n"; }, "report_binding"],
  ["a terminal for another report", (d) => { const e = JSON.parse(d.receipt_lines.at(-1)); e.payload.report_sha256 = "9".repeat(64); d.receipt_lines[d.receipt_lines.length - 1] = canonical(e) + "\n"; }, "report_binding"],
]) test(`C-C1b-1 cannot replay ${name} as consistent evidence`, () => {
  const d = savedEvidence(); mutate(d); assert.throws(() => api.inspectUnsignedExecutionEvidence(d), { message: `cc1b_${code}` });
});
test("C-C1b-1 requires exact per-write readback and cannot repair an unknown or partial write", () => {
  const e = api.createUnsignedExecutionEvidenceModel(allocation()); const first = e.append({ kind: "case_allocated", payload: {}, stamp: stamp(1) });
  assert.throws(() => e.confirmReceipt(first.line.slice(0, -1)), /cc1b_readback_mismatch/);
  assert.equal(e.describe().retain, true); assert.equal(e.describe().confirmed_records, 0);
  assert.throws(() => e.confirmReceipt(first.line), /cc1b_evidence_stopped/);
});
test("C-C1b-1 refuses another intent before readback, premature report and a repeated report", () => {
  let e = api.createUnsignedExecutionEvidenceModel(allocation()); e.append({ kind: "case_allocated", payload: {}, stamp: stamp(1) });
  assert.throws(() => e.append({ kind: "create_intent", payload: { entry_index: 0 }, stamp: stamp(2) }), /cc1b_evidence_order/);
  assert.throws(() => e.append({ kind: "stop_summary", payload: { reason: "x" }, stamp: stamp(2) }), /cc1b_evidence_stopped/);
  e = evidencePrefix().e; assert.throws(() => e.createReport({ limitations: [], save_stamp: stamp(3) }), /cc1b_evidence_order/);
  const p = evidencePrefix(); p.add("ready_to_report", { outcome: "FAIL" });
  p.e.createReport({ limitations: [], save_stamp: p.nextStamp() });
  assert.throws(() => p.e.createReport({ limitations: [], save_stamp: p.nextStamp() }), /cc1b_evidence_order/);
});
test("C-C1b-1 reserves four failure summaries and never relabels a failure as success", () => {
  const p = evidencePrefix(); for (let n = 0; n < 3; n++) p.add("stop_summary", { reason: "another_summary" });
  assert.throws(() => p.add("stop_summary", { reason: "overflow" }), /cc1b_failure_capacity/);
  p.add("ready_to_report", { outcome: "FAIL" }); assert.equal(p.e.describe().outcome, "FAIL");
  const q = evidencePrefix(); assert.throws(() => q.add("ready_to_report", { outcome: "MODEL_CONSISTENT" }), /cc1b_false_success/);
});
test("C-C1b-1 preserves clock domains and rejects a rollback in parent evidence", () => {
  for (const changed of [stamp(0), { ...stamp(3), clock_domain: "worker-1" }]) {
    const p = evidencePrefix(); assert.throws(() => p.e.append({ kind: "stop_summary", payload: { reason: "later" }, stamp: changed }), /cc1b_clock_/);
  }
});
test("C-C1b-1 rejects accessors, functions, aliases and unknown capacity fields without invoking them", () => {
  let called = 0; const getter = Object.defineProperty({}, "fixture", { enumerable: true, get() { called++; return fixture(); } });
  for (const d of [getter, { ...declaration(), callback: () => called++ }, { ...declaration(), cleanup_path: "/elsewhere" },
    { ...declaration(), provenance: { ...declaration().provenance, signature: "x" } }])
    assert.throws(() => api.createUnsignedExecutionProtocolModel(d), /cc1b_/);
  assert.equal(called, 0);
  for (const d of [{ owned_entries: 0, depth: 0, content_bytes: 0 }, { owned_entries: 9, depth: 4, content_bytes: 0 },
    { owned_entries: 9, depth: 3, content_bytes: 131073 }, { owned_entries: 9, depth: 3, content_bytes: 0, receipt_records: 100 }])
    assert.throws(() => api.describeUnsignedExecutionCapacity(d), /cc1b_invalid_input/);
});

// The full evidence schedule for one case, as [kind, payload] steps; tests replay a prefix and then try one changed step.
function steps(case_id = "u1-unsigned", mode = "normal") {
  const d = declaration(case_id, mode), r = original.describeUnsignedFixture(d.fixture);
  const c = original.describeUnsignedAcceptanceRun(d.fixture.request).cases.find((c) => c.case_id === case_id && c.mode === mode);
  const proofs = r.entries.map((entry, n) => ({ kind: entry.kind, device: "1", inode: String(100 + n), uid: "501", gid: "20", mode: entry.mode,
    birthtime_ns: "1", mtime_ns: "2", ctime_ns: "3", flags: "0", acl: "none", acl_hash: "1".repeat(64), nlink: entry.kind === "file" ? "1" : "2",
    size: entry.size ?? "96", allocated_bytes: "4096", sha256: entry.sha256 ?? null }));
  const baseline = { resources: resources(), clock_domain: "worker-1" }, list = [["case_allocated", {}]];
  r.entries.forEach((_, entry_index) => list.push(["create_intent", { entry_index }],
    ["create_result", { entry_index, proof: proofs[entry_index], ...(entry_index === 0 ? { fixture_name: d.fixture.fixture_name } : {}) }]));
  list.push(["setup_sealed", { inventory_sha256: "2".repeat(64), provenance: {
    registration_sha256: d.provenance.registration_sha256, envelope_sha256: d.provenance.envelope_sha256 } }], ["worker_prepared", {}],
  ["baseline_bound", { ...baseline, observation_sha256: "3".repeat(64) }], ["go_intent", { baseline_sha256: h(canonical(baseline)) }],
  ["run_outcome", { primary_code: c.expected_code, diagnostic_sha256: "1".repeat(64) }],
  ["release_checked", { baseline_sha256: h(canonical(baseline)), resources: resources(), query: "settled", native: "settled",
    original_operation_retired: true, query_released: true, close_errors: [], diagnostic_sha256: "1".repeat(64), trace_chunks: 0, trace_events: 0,
    trace_sha256: h("[]"), primary_code: c.expected_code, requests_dispatched: 1, authenticated_requests: c.owner === "fixed_memory" ? 1 : 0,
    c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null }],
  ["cleanup_precheck", { inventory_sha256: "2".repeat(64) }]);
  const depth = (path) => path === "" ? 0 : path.split("/").length;
  const order = r.entries.map((v, entry_index) => ({ ...v, entry_index })).sort((a, b) => depth(b.path) - depth(a.path)
    || (a.kind === b.kind ? 0 : a.kind === "file" ? -1 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { entry_index } of order) {
    const proof = { ...proofs[entry_index] };
    if (proof.kind === "directory") Object.assign(proof, { size: "32", nlink: "1", mtime_ns: "50", ctime_ns: "51", allocated_bytes: "8192" });
    list.push(["delete_intent", { entry_index, proof }], ["delete_result", { entry_index, outcome: "removed" }]);
  }
  list.push(["absence_checked", { anchor_same: true, root_removal_confirmed: true, absent: true }], ["worker_finalized", { exit_code: 0, signal: null }],
    ["ready_to_report", { outcome: "MODEL_CONSISTENT", negative_assessment: { status: "consistent_supplied_negative", sha256: "5".repeat(64) } }]);
  return { d, r, c, list, at: (kind, nth = 0) => list.map(([k], i) => [k, i]).filter(([k]) => k === kind)[nth][1] };
}
function play(s, until = s.list.length) {
  const e = api.createUnsignedExecutionEvidenceModel(allocation(s.d)), lines = []; let tick = 0;
  const add = (kind, payload) => { const record = e.append({ kind, payload, stamp: stamp(++tick) }); e.confirmReceipt(record.line); lines.push(record.line); return record; };
  for (const [kind, payload] of s.list.slice(0, until)) add(kind, payload);
  return { e, lines, add, nextStamp: () => stamp(++tick) };
}
function finish(p, s, outcome) {
  if (outcome) p.add("ready_to_report", outcome);
  const report = p.e.createReport({ limitations: ["memory_only_no_real_release_or_removal"], save_stamp: p.nextStamp() }); p.e.confirmReport(report.line);
  p.add("terminal", { report_sha256: report.sha256 }); const index = p.e.createIndex(); p.e.confirmIndex(index.line);
  return { allocation: allocation(s.d), expected_declaration: p.e.describe().binding === null ? null : s.d, receipt_lines: p.lines, report_line: report.line, index_line: index.line };
}
function completeEvidence(case_id, mode, stopAtEnd = false) {
  const s = steps(case_id, mode), last = s.list.length - 1, p = play(s, last);
  if (stopAtEnd) for (let n = 0; n < 4; n++) p.add("stop_summary", { reason: "invented_failure" });
  const data = finish(p, s, stopAtEnd ? { outcome: "FAIL" } : s.list[last][1]);
  return { e: p.e, r: s.r, data };
}
const cases = original.describeUnsignedAcceptanceRun(fixture().request).cases;
for (const c of cases) test(`C-C1b-1 models the complete ${c.mode}/${c.case_id} evidence schedule in memory only`, () => {
  const { e, r, data } = completeEvidence(c.case_id, c.mode), d = e.describe();
  assert.ok(r.entries.length <= 9); assert.equal(d.confirmed_records, 4 * r.entries.length + 12);
  assert.ok(d.confirmed_records <= d.capacity.receipt_reserved_records);
  assert.ok(d.confirmed_receipt_bytes <= 1048576); assert.equal(d.capacity.run_index_reserved_bytes, 131056);
  assert.equal(api.inspectUnsignedExecutionEvidence(data).model_status, "consistent_supplied_evidence");
  assert.equal(d.evidence_saved, false); assert.equal(d.native_release_verified, false); assert.equal(d.native_status, "NOT_RUN");
  const report = JSON.parse(data.report_line); assert.equal(report.timestamps_verified, false);
  assert.deepEqual(report.teardown, { removed_entries: r.entries.length, absence: { anchor_same: true, root_removal_confirmed: true, absent: true },
    worker_exit: { exit_code: 0, signal: null } });
  assert.equal(report.negative_assessment.status, "consistent_supplied_negative");
  assert.doesNotMatch(data.report_line + data.index_line, /native-bar-fs-synthetic-|\/private\/tmp|entry_index|signature/);
});
test("C-C1b-1 fits all four reserved failure summaries at the largest current recipe without dropping them", () => {
  const { e } = completeEvidence("u3-maintenance", "normal", true), d = e.describe();
  assert.equal(d.confirmed_records, 52); assert.equal(d.capacity.receipt_reserved_records, 52);
  assert.equal(d.retain, true); assert.equal(d.outcome, "FAIL"); assert.equal(d.evidence_saved, false);
});
for (const [name, locate, change, code] of [
  ["a root proof with an allow ACL", (s) => s.at("create_result"), (p) => { p.proof.acl = "allow"; }, "invalid_input"],
  ["a create proof with the wrong mode", (s) => s.at("create_result"), (p) => { p.proof.mode = "33152"; }, "proof_binding"],
  ["a file with other bytes", (s) => s.at("create_result", 3), (p) => { p.proof.sha256 = "9".repeat(64); }, "proof_binding"],
  ["an inode alias", (s) => s.at("create_result", 1), (p) => { p.proof.inode = "100"; }, "proof_alias"],
  ["a device crossing", (s) => s.at("create_result", 1), (p) => { p.proof.device = "2"; }, "proof_binding"],
  ["an owner change", (s) => s.at("create_result", 1), (p) => { p.proof.uid = "502"; }, "proof_binding"],
  ["a second returned name", (s) => s.at("create_result", 1), (p) => { p.fixture_name = "native-bar-fs-synthetic-Other1"; }, "fixture_name_changed"],
  ["a GO for another baseline", (s) => s.at("go_intent"), (p) => { p.baseline_sha256 = "9".repeat(64); }, "baseline_changed"],
  ["a release on another baseline", (s) => s.at("release_checked"), (p) => { p.baseline_sha256 = "9".repeat(64); }, "baseline_changed"],
  ["a release with drifted roots", (s) => s.at("release_checked"), (p) => { p.resources.roots = "2"; }, "resources_changed"],
  ["a release with lower retained state", (s) => s.at("release_checked"), (p) => { p.resources.retained = "0"; }, "resources_changed"],
  ["an unconfirmed release", (s) => s.at("release_checked"), (p) => { p.query = "unconfirmed"; }, "release_unconfirmed"],
  ["an unreleased query", (s) => s.at("release_checked"), (p) => { p.query_released = false; }, "release_unconfirmed"],
  ["a close error", (s) => s.at("release_checked"), (p) => { p.close_errors = ["close_failed"]; }, "release_unconfirmed"],
  ["another diagnostic", (s) => s.at("release_checked"), (p) => { p.diagnostic_sha256 = "9".repeat(64); }, "diagnostic_changed"],
  ["a C1 dispatch", (s) => s.at("release_checked"), (p) => { p.requests_dispatched = 2; p.authenticated_requests = 2; }, "request_count"],
  ["authentication without dispatch", (s) => s.at("release_checked"), (p) => { p.requests_dispatched = 0; }, "request_count"],
  ["a changed tree before removal", (s) => s.at("cleanup_precheck"), (p) => { p.inventory_sha256 = "4".repeat(64); }, "inventory_changed"],
  ["a changed delete identity", (s) => s.at("delete_intent"), (p) => { p.proof.inode = "999"; }, "proof_binding"],
  ["an out-of-order delete", (s) => s.at("delete_intent"), (p) => { p.entry_index = 0; }, "entry_order"],
  ["a consistent label without an assessment", (s) => s.at("ready_to_report"), (p) => { delete p.negative_assessment; }, "assessment_required"],
  ["a consistent label over an inconsistent assessment", (s) => s.at("ready_to_report"), (p) => { p.negative_assessment.status = "inconsistent_supplied_negative"; }, "assessment_required"],
  ["NOT_RUN after native work", (s) => s.at("ready_to_report"), (p) => { p.outcome = "NOT_RUN"; delete p.negative_assessment; }, "outcome_stage"],
]) test(`C-C1b-1 evidence refuses ${name} with ${code}, then still records the failure`, () => {
  const s = steps(), i = locate(s), p = play(s, i), [kind, payload] = s.list[i], changed = structuredClone(payload); change(changed);
  assert.throws(() => p.add(kind, changed), { message: `cc1b_${code}` });
  const d = p.e.describe(); assert.equal(d.stop_reason, code); assert.equal(d.retain, true); assert.equal(d.confirmed_records, i);
  // The refused record was never written; the stop that names it, a FAIL report and an index row still are.
  p.add("stop_summary", { reason: code });
  const replay = api.inspectUnsignedExecutionEvidence(finish(p, s, { outcome: "FAIL" }));
  assert.equal(replay.model_status, "consistent_supplied_evidence"); assert.equal(replay.retain, true); assert.equal(replay.outcome, "FAIL");
});
test("C-C1b-1 requires the stop after a refused record to name it before any report", () => {
  const s = steps(), i = s.at("release_checked"), p = play(s, i), changed = structuredClone(s.list[i][1]); changed.resources.fds = "9";
  assert.throws(() => p.add("release_checked", changed), { message: "cc1b_resources_changed" });
  assert.throws(() => p.add("ready_to_report", { outcome: "FAIL" }), { message: "cc1b_refusal_unrecorded" });
  assert.throws(() => p.add("stop_summary", { reason: "something_else" }), { message: "cc1b_refusal_binding" });
  p.add("stop_summary", { reason: "resources_changed", detail: { kind: "release", result: changed } });
  const report = JSON.parse(finish(p, s, { outcome: "FAIL" }).report_line);
  assert.equal(report.failure_summaries[0].detail.result.resources.fds, "9"); assert.equal(report.release, null);
});
test("C-C1b-1 keeps the returned root name when the root's creation result cannot be recorded", () => {
  const s = steps(), name = s.d.fixture.fixture_name, refused = structuredClone(s.list[2][1]); refused.proof.acl = "allow";
  const p = play(s, 2); assert.throws(() => p.add("create_result", refused), { message: "cc1b_invalid_input" });
  const stop = p.add("stop_summary", { reason: "invalid_input", fixture_name: name,
    detail: { kind: "entry", entry_index: 0, operation: "create", outcome: "changed", code: "root_access_refused" } });
  assert.equal(JSON.parse(stop.line).fixture_name, name);
  const data = finish(p, s, { outcome: "FAIL" });
  assert.equal(JSON.parse(data.receipt_lines.at(-1)).fixture_name, name); assert.doesNotMatch(data.report_line + data.index_line, new RegExp(name));
  const timeout = play(s, 2), r = timeout.add("stop_summary", { reason: "observer_timeout", fixture_name: name });
  assert.equal(JSON.parse(r.line).fixture_name, name);
});
test("C-C1b-1 accepts a returned root name in a stop only after the root intent and only once", () => {
  const s = steps(), name = s.d.fixture.fixture_name;
  assert.throws(() => play(s, 1).add("stop_summary", { reason: "early", fixture_name: name }), { message: "cc1b_fixture_name_changed" });
  const p = play(s, 3); assert.throws(() => p.add("stop_summary", { reason: "late", fixture_name: "native-bar-fs-synthetic-Other1" }), { message: "cc1b_fixture_name_changed" });
});
test("C-C1b-1 reports a cleanly settled wrong outcome as a torn-down FAIL, never as consistent", () => {
  const s = steps(), run = s.at("run_outcome"), release = s.at("release_checked"), last = s.list.length - 1;
  s.list[run][1].primary_code = s.list[release][1].primary_code = "b3cb_witness_prefix";
  let p = play(s, last); assert.throws(() => p.add("ready_to_report", s.list[last][1]), { message: "cc1b_outcome_binding" });
  p = play(s, last);
  const report = JSON.parse(finish(p, s, { outcome: "FAIL", negative_assessment: { status: "inconsistent_supplied_negative", sha256: "6".repeat(64) } }).report_line);
  assert.equal(report.outcome, "FAIL"); assert.equal(report.teardown.removed_entries, s.r.entries.length); assert.equal(p.e.describe().retain, false);
  const counts = steps("u0-unsigned"), i = counts.list.length - 1; counts.list[counts.at("release_checked")][1].authenticated_requests = 1;
  assert.throws(() => play(counts, i).add("ready_to_report", counts.list[i][1]), { message: "cc1b_outcome_binding" });
});
test("C-C1b-1 keeps NOT_RUN for work that never began and BLOCKED/FAIL for anything later", () => {
  const s = steps(), afterGo = play(s, s.at("go_intent") + 1); afterGo.add("stop_summary", { reason: "ancestor_size_excess" });
  assert.throws(() => afterGo.add("ready_to_report", { outcome: "NOT_RUN" }), { message: "cc1b_outcome_stage" });
  const blocked = play(s, s.at("go_intent") + 1); blocked.add("stop_summary", { reason: "ancestor_size_excess" });
  blocked.add("ready_to_report", { outcome: "BLOCKED" }); assert.equal(blocked.e.describe().outcome, "BLOCKED");
  const preflight = play(s, 1); preflight.add("stop_summary", { reason: "planning_refused" }); preflight.add("ready_to_report", { outcome: "NOT_RUN" });
  assert.equal(preflight.e.describe().outcome, "NOT_RUN");
});
test("C-C1b-1 publishes no outcome before its receipt line is read back", () => {
  const s = steps(), last = s.list.length - 1, p = play(s, last);
  const r = p.e.append({ kind: "ready_to_report", payload: s.list[last][1], stamp: p.nextStamp() });
  assert.equal(p.e.describe().outcome, null);
  assert.throws(() => p.e.confirmReceipt(r.line.slice(1)), { message: "cc1b_readback_mismatch" });
  assert.equal(p.e.describe().outcome, null); assert.equal(p.e.describe().stop_reason, "readback_mismatch");
  const q = play(s, last);
  assert.throws(() => q.e.append({ kind: "ready_to_report", payload: s.list[last][1], stamp: stamp(0) }), { message: "cc1b_clock_rollback" });
  assert.equal(q.e.describe().outcome, null);
});
test("C-C1b-1 ends the chain on a report-phase refusal such as a terminal for another report", () => {
  const s = steps(), last = s.list.length - 1, p = play(s, last + 1);
  const report = p.e.createReport({ limitations: [], save_stamp: p.nextStamp() }); p.e.confirmReport(report.line);
  assert.throws(() => p.add("terminal", { report_sha256: "9".repeat(64) }), { message: "cc1b_report_binding" });
  assert.throws(() => p.add("terminal", { report_sha256: report.sha256 }), { message: "cc1b_evidence_stopped" });
});
test("C-C1b-1 requires an exact create sequence and known-byte proof, not arbitrary cleanup locations", () => {
  const e = api.createUnsignedExecutionEvidenceModel(allocation());
  const r = e.append({ kind: "case_allocated", payload: {}, stamp: stamp(1) }); e.confirmReceipt(r.line);
  assert.throws(() => e.append({ kind: "create_intent", payload: { entry_index: 1 }, stamp: stamp(2) }), /cc1b_entry_order/);
  const p = evidencePrefix(); assert.throws(() => p.add("delete_intent", { entry_index: 0, path: "/elsewhere" }), /cc1b_invalid_input/);
});
test("C-C1b-1 does not invoke an injected receiver callback when methods are detached", () => {
  let calls = 0; const receiver = { describe() { calls++; } };
  const p = api.createUnsignedExecutionProtocolModel(declaration());
  assert.equal(p.acceptFrame.call(receiver, wire(p, "PREPARE", {})).state, "PREPARING");
  const e = api.createUnsignedExecutionEvidenceModel(allocation()), r = e.append({ kind: "case_allocated", payload: {}, stamp: stamp(1) });
  assert.equal(e.confirmReceipt.call(receiver, r.line).confirmed_records, 1);
  assert.equal(calls, 0);
});
test("C-C1b-1 rejects scalar evidence roots with a bounded contract error", () => {
  for (const line of ["null\n", "[]\n", "false\n", "12\n"]) {
    const d = savedEvidence(); d.report_line = line;
    assert.throws(() => api.inspectUnsignedExecutionEvidence(d), /cc1b_/);
  }
});
test("C-C1b-1 preserves an unconfirmed release and its primary/close failures without reporting release success", () => {
  const p = evidencePrefix(), m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  const failed = released(m, { query: "unconfirmed", query_released: false, close_errors: ["close_failed"], primary_code: "b3cb_record_refused" });
  p.add("stop_summary", { reason: "release_unconfirmed", detail: { kind: "release", result: failed } });
  p.add("ready_to_report", { outcome: "FAIL" });
  const report = p.e.createReport({ limitations: [], save_stamp: p.nextStamp() });
  const r = JSON.parse(report.line); assert.equal(r.failure_summaries.at(-1).detail.result.primary_code, "b3cb_record_refused");
  assert.deepEqual(r.failure_summaries.at(-1).detail.result.close_errors, ["close_failed"]);
  assert.equal(r.release, null); assert.equal(r.native_release_verified, false);
});
test("C-C1b-1 can confirm pre-creation intent without inventing a returned name or observed registration", () => {
  const a = allocation(), e = api.createUnsignedExecutionEvidenceModel(a);
  for (const [n, kind, payload] of [[1, "case_allocated", {}], [2, "create_intent", { entry_index: 0 }]]) {
    const r = e.append({ kind, payload, stamp: stamp(n) }); e.confirmReceipt(r.line);
    const record = JSON.parse(r.line);
    assert.equal(record.fixture_name, null); assert.equal(record.binding, null);
    assert.equal(record.creation_prefix, kind === "create_intent" ? "native-bar-fs-synthetic-" : null);
    assert.equal(record.allocation.run_id, "invented-run");
    assert.equal(record.allocation.supervisor_id, "supervisor-1"); assert.equal(record.allocation.worker_id, "worker-1");
    assert.doesNotMatch(r.line, /registration_sha256|envelope_sha256|Plan00/);
  }
  assert.equal(e.describe().binding, null);
});
test("C-C1b-1 preserves a spontaneous crash signal in a failure summary without signalling anything", () => {
  const p = evidencePrefix(); p.add("stop_summary", { reason: "worker_lost", detail: { kind: "worker_exit", exit_code: null, signal: "SIGABRT" } });
  p.add("ready_to_report", { outcome: "FAIL" });
  const report = p.e.createReport({ limitations: [], save_stamp: p.nextStamp() });
  assert.equal(JSON.parse(report.line).failure_summaries.at(-1).detail.signal, "SIGABRT");
});
test("C-C1b-1 rejects premature full provenance, returned names, missing identities and unknown allocation fields", () => {
  const { supervisor_id, ...anonymous } = allocation();
  for (const d of [declaration(), { ...allocation(), fixture: fixture() }, anonymous,
    { ...allocation(), provenance: declaration().provenance }, { ...allocation(), binding: "invented" }])
    assert.throws(() => api.createUnsignedExecutionEvidenceModel(d), /cc1b_invalid_input/);
});
function beforeRootResult() {
  const a = allocation(), e = api.createUnsignedExecutionEvidenceModel(a);
  const append = (kind, payload, n) => { const r = e.append({ kind, payload, stamp: stamp(n) }); e.confirmReceipt(r.line); return r; };
  append("case_allocated", {}, 1); append("create_intent", { entry_index: 0 }, 2);
  const proof = { kind: "directory", device: "1", inode: "100", uid: "501", gid: "20", mode: "16832", birthtime_ns: "1",
    mtime_ns: "2", ctime_ns: "3", flags: "0", acl: "none", acl_hash: "1".repeat(64), nlink: "2", size: "96", allocated_bytes: "4096", sha256: null };
  return { a, e, append, proof };
}
test("C-C1b-1 binds the returned root name only in its confirmed creation result", () => {
  const p = beforeRootResult(), name = "native-bar-fs-synthetic-Xy123Z";
  const r = p.e.append({ kind: "create_result", payload: { entry_index: 0, proof: p.proof, fixture_name: name }, stamp: stamp(3) });
  assert.equal(JSON.parse(r.line).fixture_name, name); assert.equal(p.e.describe().binding, null);
  assert.equal(p.e.describe().pending_readback, "receipt"); p.e.confirmReceipt(r.line);
  const next = p.append("create_intent", { entry_index: 1 }, 4);
  assert.equal(JSON.parse(next.line).fixture_name, name); assert.equal(JSON.parse(next.line).binding, null);
});
test("C-C1b-1 cannot omit or replace the returned name after root creation", () => {
  let p = beforeRootResult();
  assert.throws(() => p.append("create_result", { entry_index: 0, proof: p.proof }, 3), /cc1b_fixture_name_required/);
  p = beforeRootResult(); p.append("create_result", { entry_index: 0, proof: p.proof, fixture_name: fixture().fixture_name }, 3);
  p.append("create_intent", { entry_index: 1 }, 4);
  assert.throws(() => p.append("create_result", { entry_index: 1, proof: { ...p.proof, inode: "101" },
    fixture_name: "native-bar-fs-synthetic-Change" }, 5), /cc1b_fixture_name_changed/);
});
test("C-C1b-1 publishes the sealed binding only after the seal's readback", () => {
  const s = steps("u3-maintenance", "ubsan"), i = s.at("setup_sealed"), p = play(s, i);
  const r = p.e.append({ kind: "setup_sealed", payload: s.list[i][1], stamp: p.nextStamp() });
  assert.equal(p.e.describe().binding, null); assert.notEqual(JSON.parse(r.line).binding, null);
  p.e.confirmReceipt(r.line);
  assert.deepEqual(p.e.describe().binding, api.createUnsignedExecutionProtocolModel(s.d).describe().binding);
});
test("C-C1b-1 seals full binding after creation without rewriting earlier receipt bytes", () => {
  const { data } = completeEvidence("u3-maintenance", "ubsan"), records = data.receipt_lines.map(JSON.parse);
  const sealed = records.findIndex((e) => e.kind === "setup_sealed");
  assert.ok(records.slice(0, sealed).every((e) => e.binding === null));
  const p = api.createUnsignedExecutionProtocolModel(data.expected_declaration);
  for (const r of records.slice(sealed)) assert.deepEqual(r.binding, p.describe().binding);
  assert.equal(records[sealed].previous_event_hash, records[sealed - 1].event_hash);
  const changed = structuredClone(data); changed.expected_declaration.provenance.registration_sha256 = "9".repeat(64);
  assert.throws(() => api.inspectUnsignedExecutionEvidence(changed), /cc1b_binding_changed/);
  changed.expected_declaration = null;
  assert.throws(() => api.inspectUnsignedExecutionEvidence(changed), /cc1b_binding_changed/);
});
test("C-C1b-1 retains a failed allocation without requiring later setup facts for reporting or replay", () => {
  const data = savedEvidence(), report = JSON.parse(data.report_line);
  assert.equal(report.binding, null); assert.equal(report.allocation.run_id, "invented-run");
  assert.equal(api.inspectUnsignedExecutionEvidence(data).retain, true);
  assert.doesNotMatch(data.report_line + data.index_line, /registration_sha256|envelope_sha256|native-bar-fs-synthetic-/);
});
for (const signal of ["SIGABRT", "SIGSEGV", "SIGBUS", "SIGINT"]) test(`C-C1b-1 treats ${signal} as worker loss, not an invalid packet or release proof`, () => {
  const m = releasedModel(); finalized(m);
  assert.throws(() => m.workerExit({ exit_code: null, signal }), /cc1b_worker_lost/);
  assert.equal(m.describe().stop_reason, "worker_lost"); assert.equal(m.describe().native_release_verified, false);
});
